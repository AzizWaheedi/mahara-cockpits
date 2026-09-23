import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../_generated/server";
import { amountProblem } from "../billingCore";
import { authenticatedMutation, authenticatedQuery } from "../functions";
import {
  byNewest,
  maskContact,
  shapeManualRow,
  vManualRow,
} from "./data/money";
import { USD_PER } from "./data/tap";
import { requireCeo } from "./gate";
import { nameKey } from "./manualMatch";
import { kuwaitDay } from "./time";
import {
  assertKuwaitDay,
  auditTrail,
  type CeoMutationCtx,
  ceoWrite,
  cleanText,
  MANUAL_RAIL_LABEL,
  usdAtWrite,
  vManualCurrency,
  vManualRail,
} from "./writeGuard";

/**
 * Payments Aziz logs by hand on the Money tab (decision of 2026-09-16: cash
 * only, with an optional deal field). Money that arrived outside Whop and
 * Tap: bank transfers, cheques, cash, other, and Tap payments while Tap is
 * not connected.
 *
 * Every write goes through `ceoWrite` (convex/ceo/writeGuard.ts): the CEO
 * gate first, the audit row in the same transaction, then a background
 * recompute of the money and clients sections. Writes touch Convex only.
 *
 * The USD value is always worked out here, from the fixed rate table the
 * money section uses (convex/ceo/data/tap.ts), and stored with the rate, so
 * the screen never sends a dollar figure and history never moves.
 *
 * Tap and double counting: while TAP_SECRET_KEY holds a live key, Tap
 * charges reach the Tap rail by themselves, so a hand entry on the "tap"
 * rail is refused. While Tap is not connected (no key, or a test key) it is
 * accepted, and the rail itself is the mark: every live "tap" entry was
 * logged before Tap was connected. Once Tap is read, the money adapter drops
 * each such entry that a Tap charge matches (at most 3 days apart, within
 * 5%), so the money counts once, on the Tap rail.
 *
 * There is no edit. A wrong entry is removed (soft delete) and entered again,
 * and both steps are in the audit trail.
 */

/** Refusals reach the screen as this shape (a plain Error is hidden in production). */
export type ManualPaymentRefusal = {
  /** "repeat" when the same payment is already logged; resend with allowRepeat. */
  code: "refused" | "repeat";
  message: string;
};

const refuse = (message: string, code: ManualPaymentRefusal["code"]) =>
  new ConvexError<ManualPaymentRefusal>({ code, message });

/**
 * Run a write and turn any refusal into a ConvexError, so the one plain
 * sentence the check wrote is what the screen shows. Throwing still rolls
 * the whole write back, audit row included.
 */
async function plainRefusals<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ConvexError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw refuse(
      message.slice(0, 300) || "The payment was not saved.",
      "refused",
    );
  }
}

/** "$1,500.00" without Intl. */
/**
 * Whether Tap is connected: the money section's last good payload says so
 * (its charges come from the tap-charges-sync job in Supabase since
 * 2026-09-21; nothing on Convex holds a Tap key).
 */
async function tapConnected(ctx: { db: QueryCtx["db"] }): Promise<boolean> {
  const row = await ctx.db
    .query("ceoSections")
    .withIndex("by_key", q => q.eq("key", "money"))
    .first();
  return row?.payload?.rails?.tap?.connected === true;
}

function usdText(x: number): string {
  const [whole, cents] = x.toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

/** "460.125 KWD", three decimals at most, trailing zeros dropped. */
function amountText(amount: number, currency: string): string {
  const text = amount
    .toFixed(3)
    .replace(/\.?0+$/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${text} ${currency}`;
}

/** "$1,500.00" for USD, "$1,500.00 (460.125 KWD)" otherwise. */
function paidText(r: {
  amount: number;
  amountUsd: number;
  currency: string;
}): string {
  return r.currency === "USD"
    ? usdText(r.amountUsd)
    : `${usdText(r.amountUsd)} (${amountText(r.amount, r.currency)})`;
}

/** How the money came, as the audit sentence says it. */
const ARRIVED: Record<Doc<"ceoManualPayments">["rail"], string> = {
  bank_transfer: "by bank transfer",
  cheque: "by cheque",
  cash: "in cash",
  tap: "on Tap",
  other: "another way",
};

/** One payment in a sentence, for the audit trail. */
function paymentText(r: Doc<"ceoManualPayments">): string {
  return `the ${paidText(r)} payment from ${r.clientName} received ${r.day} (${MANUAL_RAIL_LABEL[r.rail]})`;
}

/**
 * usdAtWrite allows three decimals for every currency (KWD has fils). A
 * dollar amount has cents only, so a third decimal is a slipped key, and the
 * screen already refuses it: the server refuses it too.
 */
function assertCents(
  amount: number,
  currency: Doc<"ceoManualPayments">["currency"],
  label: string,
): void {
  if (
    currency === "USD" &&
    Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6
  )
    throw new Error(`${label} in USD has at most two decimals.`);
}

async function paymentOrRefuse(
  ctx: CeoMutationCtx,
  id: Doc<"ceoManualPayments">["_id"],
): Promise<Doc<"ceoManualPayments">> {
  const row = await ctx.db.get(id);
  if (!row) throw new Error("That payment is not in the log.");
  return row;
}

/**
 * A live entry that is the same payment: same day, currency and amount, for
 * the same client name or the same ClickUp card. `add` and `restore` both
 * ask before counting such a pair twice.
 */
async function liveTwin(
  // Only the database is read, so the inbox ingest (which has no signed-in
  // user) can run the same duplicate check as a payment typed by Aziz.
  ctx: { db: CeoMutationCtx["db"] },
  p: {
    day: string;
    currency: Doc<"ceoManualPayments">["currency"];
    amount: number;
    clientName: string;
    clickupTaskId?: string;
    except?: Doc<"ceoManualPayments">["_id"];
  },
): Promise<Doc<"ceoManualPayments"> | null> {
  const sameDay = await ctx.db
    .query("ceoManualPayments")
    .withIndex("by_deleted_day", q =>
      q.eq("deletedAt", undefined).eq("day", p.day),
    )
    .take(500);
  const key = nameKey(p.clientName);
  return (
    sameDay.find(
      r =>
        r._id !== p.except &&
        r.currency === p.currency &&
        Math.abs(r.amount - p.amount) < 0.0005 &&
        ((key !== "" && nameKey(r.clientName) === key) ||
          (p.clickupTaskId !== undefined &&
            r.clickupTaskId === p.clickupTaskId)),
    ) ?? null
  );
}

// --- Writes ---

/**
 * Whether a ClickUp card is a client card a payment can belong to: on the
 * CSM roster, or anywhere on the Clients - Mahara list. The roster leaves out
 * cards in onboarding and paused cards the CSM sync skips, and the billing
 * sheet logs payments against those too (2026-09-23).
 */
async function onClientCard(
  ctx: { db: CeoMutationCtx["db"] },
  taskId: string,
): Promise<boolean> {
  const cards = await ctx.db.query("clients").take(1000);
  if (cards.some(c => c.taskId === taskId)) return true;
  const billing = await ctx.db
    .query("ceoClientBilling")
    .withIndex("by_task", q => q.eq("taskId", taskId))
    .first();
  return billing !== null;
}

export const add = authenticatedMutation({
  args: {
    /** Kuwait day the money was received, YYYY-MM-DD. */
    day: v.string(),
    /** The amount as received, in `currency`. */
    amount: v.number(),
    currency: vManualCurrency,
    clientName: v.string(),
    /** The ClickUp client card, when picked from the roster. */
    clickupTaskId: v.optional(v.string()),
    rail: vManualRail,
    /** "refund" for money given back; absent or "payment" for money received. */
    kind: v.optional(v.union(v.literal("payment"), v.literal("refund"))),
    /** Contract value of a new deal signed with this payment, in `currency`. */
    dealContracted: v.optional(v.number()),
    note: v.optional(v.string()),
    /** Log it even though the same payment is already logged that day. */
    allowRepeat: v.optional(v.boolean()),
  },
  returns: v.id("ceoManualPayments"),
  handler: (ctx, a) =>
    plainRefusals(() =>
      ceoWrite(ctx, async w => {
        const day = assertKuwaitDay(a.day.trim(), "Day received", {
          notBefore: "2025-01-01",
          notAfter: w.day,
        });
        const clientName = cleanText(a.clientName, 120);
        if (!clientName) throw new Error("Type the client's name.");
        const paid = usdAtWrite(a.amount, a.currency);
        assertCents(a.amount, a.currency, "The amount");
        const deal =
          a.dealContracted === undefined
            ? null
            : usdAtWrite(a.dealContracted, a.currency, "The deal value");
        if (a.dealContracted !== undefined)
          assertCents(a.dealContracted, a.currency, "The deal value");
        const note = cleanText(a.note, 500);

        // Tap payments arrive on their own once Tap is connected.
        if (a.rail === "tap" && (await tapConnected(ctx)))
          throw new Error(
            "Tap is connected, so Tap payments reach the Tap rail by themselves. Logging one here would count it twice. If this money came another way, pick that rail.",
          );

        let clickupTaskId: string | undefined;
        const task = a.clickupTaskId?.trim();
        if (task) {
          if (!/^[A-Za-z0-9_-]{1,40}$/.test(task))
            throw new Error("That is not a ClickUp card id.");
          if (!(await onClientCard(ctx, task)))
            throw new Error(
              "That client card is not on the roster any more. Pick the client again.",
            );
          clickupTaskId = task;
        }

        // The same payment twice on one day is almost always a double click
        // or one payment logged twice. Ask before counting it twice.
        if (!a.allowRepeat) {
          const twin = await liveTwin(ctx, {
            day,
            currency: a.currency,
            amount: paid.amount,
            clientName,
            clickupTaskId,
          });
          if (twin)
            throw refuse(
              `${paidText(twin)} from ${twin.clientName} on ${day} is already logged (${MANUAL_RAIL_LABEL[twin.rail]}). Log this one as well only if it is a second payment.`,
              "repeat",
            );
        }

        const refund = a.kind === "refund";
        if (refund && deal)
          throw new Error("A refund cannot carry a new deal value.");
        const row = {
          day,
          amount: paid.amount,
          currency: a.currency,
          amountUsd: paid.usd,
          usdPerUnit: paid.usdPerUnit,
          clientName,
          rail: a.rail,
          ...(refund ? { kind: "refund" as const } : {}),
          addedBy: w.by,
          addedAt: w.at,
          ...(clickupTaskId ? { clickupTaskId } : {}),
          ...(deal
            ? { dealContracted: deal.amount, dealContractedUsd: deal.usd }
            : {}),
          ...(note ? { note } : {}),
        };
        const id = await ctx.db.insert("ceoManualPayments", row);

        const parts = [
          refund
            ? `Logged a refund of ${paidText(row)} ${ARRIVED[a.rail]} to ${clientName}, given back ${day}. It comes off cash and counts among refunds.`
            : `Logged ${paidText(row)} ${ARRIVED[a.rail]} from ${clientName}, received ${day}.`,
        ];
        if (deal)
          parts.push(
            `New deal worth ${paidText({ amount: deal.amount, amountUsd: deal.usd, currency: a.currency })}, added to contracted.`,
          );
        if (a.rail === "tap")
          parts.push(
            "Tap is not connected, so it counts on the Manual rail until Tap shows the same charge, then it drops out by itself.",
          );
        return {
          result: id,
          audit: {
            action: "manualPayment.add",
            table: "ceoManualPayments",
            rowId: id,
            what: parts.join(" "),
            after: row,
          },
          refresh: ["money", "clients"],
        };
      }),
    ),
});

/** Remove an entry from every total. The row stays, marked removed. */
export const softDelete = authenticatedMutation({
  args: {
    id: v.id("ceoManualPayments"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: (ctx, a) =>
    plainRefusals(() =>
      ceoWrite(ctx, async w => {
        const row = await paymentOrRefuse(ctx, a.id);
        if (row.deletedAt !== undefined)
          throw new Error("That payment was already removed.");
        const reason = cleanText(a.reason, 300);
        await ctx.db.patch(row._id, { deletedAt: w.at, deletedBy: w.by });
        return {
          result: null,
          audit: {
            action: "manualPayment.remove",
            table: "ceoManualPayments",
            rowId: row._id,
            what: `Removed ${paymentText(row)}${reason ? `. Reason: ${reason}` : ""}.`,
            before: row,
            after: { ...row, deletedAt: w.at, deletedBy: w.by },
          },
          refresh: ["money", "clients"],
        };
      }),
    ),
});

/** Put a removed entry back into the totals. */
export const restore = authenticatedMutation({
  args: {
    id: v.id("ceoManualPayments"),
    /** Restore it even though the same payment is logged and live that day. */
    allowRepeat: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: (ctx, a) =>
    plainRefusals(() =>
      ceoWrite(ctx, async () => {
        const row = await paymentOrRefuse(ctx, a.id);
        if (row.deletedAt === undefined)
          throw new Error("That payment is not removed.");
        // The same rule as add: once Tap is connected, Tap money is read from
        // Tap, and putting a hand-logged Tap payment back could count it twice.
        if (row.rail === "tap" && (await tapConnected(ctx)))
          throw new Error(
            "Tap is connected now, so Tap payments reach the Tap rail by themselves. Restoring this hand entry could count the money twice. If it came another way, log it again on that rail.",
          );
        // A removed entry is usually replaced by a corrected one. Putting the
        // old one back beside a live twin would count the money twice.
        const twin = a.allowRepeat
          ? null
          : await liveTwin(ctx, {
              day: row.day,
              currency: row.currency,
              amount: row.amount,
              clientName: row.clientName,
              clickupTaskId: row.clickupTaskId,
              except: row._id,
            });
        if (twin)
          throw refuse(
            `${paidText(twin)} from ${twin.clientName} on ${row.day} is already logged (${MANUAL_RAIL_LABEL[twin.rail]}), so restoring this one would count it twice. Restore it only if it really is a second payment.`,
            "repeat",
          );
        await ctx.db.patch(row._id, {
          deletedAt: undefined,
          deletedBy: undefined,
        });
        // The trail drops undefined fields, so this is the row as restored.
        const after = { ...row, deletedAt: undefined, deletedBy: undefined };
        return {
          result: null,
          audit: {
            action: "manualPayment.restore",
            table: "ceoManualPayments",
            rowId: row._id,
            what: `Restored ${paymentText(row)}.`,
            before: row,
            after,
          },
          refresh: ["money", "clients"],
        };
      }),
    ),
});

// --- Reads for the Money tab ---

/**
 * One month's entries, live and removed, newest first. Read straight from
 * the table, so a new entry shows at once; the totals catch up when the
 * money section recomputes.
 */
export const list = authenticatedQuery({
  args: {
    /** YYYY-MM, Kuwait. Defaults to this month. */
    month: v.optional(v.string()),
  },
  returns: v.array(vManualRow),
  handler: async (ctx, a) => {
    await requireCeo(ctx);
    const month = a.month ?? kuwaitDay().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw refuse("The month must look like 2026-09.", "refused");
    const rows = await ctx.db
      .query("ceoManualPayments")
      .withIndex("by_day", q =>
        q.gte("day", `${month}-01`).lte("day", `${month}-31`),
      )
      .take(2000);
    return rows.map(shapeManualRow).sort(byNewest);
  },
});

/** Every client card on the roster, for the client picker. */
export const clientOptions = authenticatedQuery({
  args: {},
  returns: v.array(
    v.object({
      name: v.string(),
      clickupTaskId: v.string(),
      bucket: v.union(v.string(), v.null()),
    }),
  ),
  handler: async ctx => {
    await requireCeo(ctx);
    const cards = await ctx.db.query("clients").take(1000);
    return cards
      .filter(c => c.name.trim())
      .map(c => ({
        name: c.name.trim(),
        clickupTaskId: c.taskId,
        bucket: c.bucket ?? null,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  },
});

/**
 * What the form needs to know before it sends: the rate the server will
 * convert at, whether a Tap entry would be refused, and the Kuwait day.
 */
export const formInfo = authenticatedQuery({
  args: {},
  returns: v.object({
    usdPerKwd: v.number(),
    tapLive: v.boolean(),
    today: v.string(),
  }),
  handler: async ctx => {
    await requireCeo(ctx);
    return {
      usdPerKwd: USD_PER.KWD,
      tapLive: await tapConnected(ctx),
      today: kuwaitDay(),
    };
  },
});

/** One entry's trail: when it was logged, removed and restored, and by whom. */
export const history = authenticatedQuery({
  args: { id: v.id("ceoManualPayments") },
  returns: v.array(
    v.object({
      action: v.string(),
      table: v.string(),
      rowId: v.string(),
      what: v.string(),
      by: v.string(),
      at: v.number(),
    }),
  ),
  handler: async (ctx, a) =>
    (
      await auditTrail(ctx, {
        table: "ceoManualPayments",
        rowId: a.id,
        limit: 20,
      })
    ).map(r => ({ ...r, what: maskContact(r.what) })),
});

/**
 * A payment logged outside the CEO cockpit, taken into the ledger.
 *
 * Maher and the client success cockpit log payments into the Supabase inbox
 * (cockpit_billing_inbox) rather than here, because neither can sign in as
 * Aziz. The refresh brings each one in through this mutation, with the same
 * rules as a payment typed on the Money tab: a real day, whole cents, a card
 * still on the roster, and the same payment on the same day for the same
 * client treated as one payment, not two. The row records who logged it
 * where, so the ledger still says where every entry came from.
 */
export const ingestFromInbox = internalMutation({
  args: {
    inboxId: v.number(),
    day: v.string(),
    amount: v.number(),
    currency: vManualCurrency,
    rail: vManualRail,
    clientName: v.string(),
    clickupTaskId: v.string(),
    note: v.optional(v.string()),
    loggedBy: v.string(),
    source: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("ingested"),
      v.literal("duplicate"),
      v.literal("rejected"),
    ),
    id: v.optional(v.string()),
    note: v.string(),
  }),
  handler: async (ctx, a) => {
    const reject = (note: string) => ({ status: "rejected" as const, note });
    const today = kuwaitDay();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(a.day) ||
      a.day > today ||
      a.day < "2025-01-01"
    )
      return reject(`The day ${a.day} is not a day money could have arrived.`);
    const wrong = amountProblem(a.amount, a.currency);
    if (wrong) return reject(wrong);
    if (a.rail === "tap" && (await tapConnected(ctx)))
      return reject(
        "Tap is connected, so a Tap payment arrives on the Tap rail by itself; logging it would count it twice.",
      );
    if (!(await onClientCard(ctx, a.clickupTaskId)))
      return reject("That client card is not on the roster any more.");
    const clientName = cleanText(a.clientName, 120) || a.clickupTaskId;
    let paid: ReturnType<typeof usdAtWrite>;
    try {
      paid = usdAtWrite(a.amount, a.currency);
    } catch (e) {
      return reject(e instanceof Error ? e.message : String(e));
    }
    const twin = await liveTwin(ctx, {
      day: a.day,
      currency: a.currency,
      amount: paid.amount,
      clientName,
      clickupTaskId: a.clickupTaskId,
    });
    if (twin)
      return {
        status: "duplicate" as const,
        id: String(twin._id),
        note: `${paidText(twin)} from ${twin.clientName} on ${a.day} was already in the ledger (${MANUAL_RAIL_LABEL[twin.rail]}), so this was not counted a second time.`,
      };
    const by = `${a.source}: ${cleanText(a.loggedBy, 80)}`;
    const note = cleanText(a.note, 500);
    const at = Date.now();
    const row = {
      day: a.day,
      amount: paid.amount,
      currency: a.currency,
      amountUsd: paid.usd,
      usdPerUnit: paid.usdPerUnit,
      clientName,
      rail: a.rail,
      clickupTaskId: a.clickupTaskId,
      addedBy: by,
      addedAt: at,
      ...(note ? { note } : {}),
    };
    const id = await ctx.db.insert("ceoManualPayments", row);
    await ctx.db.insert("ceoAudit", {
      action: "manualPayment.ingest",
      table: "ceoManualPayments",
      rowId: String(id),
      what: `Took ${paidText(row)} ${ARRIVED[a.rail]} from ${clientName}, received ${a.day}, into the ledger from the billing inbox (row ${a.inboxId}, logged by ${by}).`,
      before: {},
      after: row,
      by,
      at,
    });
    return {
      status: "ingested" as const,
      id: String(id),
      note: "In the ledger.",
    };
  },
});
