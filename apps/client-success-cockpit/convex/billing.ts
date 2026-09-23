import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import {
  type Account,
  accountRow,
  amountProblem,
  applyEdit,
  type Edit,
  kuwaitToday,
  logEvent,
  mirrorAccounts,
  readAccount,
  readAccounts,
  readSheet,
  type Sheet,
  sb,
} from "./billingCore";
import { authenticatedAction } from "./functions";
import { allowedClients, hasAccess } from "./roles";

declare const process: { env: Record<string, string | undefined> };

/**
 * The client success cockpit's billing sheet: the same sheet as the CEO
 * cockpit's (the rules are in billingCore.ts, the same file in both apps),
 * read and written from here directly, so it keeps working when the media
 * buyer deployment is down.
 *
 * What differs from the CEO side. A success manager sees the clients the
 * portal gave them (all of them when it gave none). A payment logged here
 * does not go straight into the ledger: it waits in cockpit_billing_inbox,
 * and the CEO cockpit takes it in at its next refresh, where a payment
 * already there is caught instead of counted twice.
 */

function env(): { token: string; url: string; key: string } {
  const token =
    process.env.CLICKUP_API_TOKEN ?? process.env.CLICKUP_API_KEY ?? "";
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!token)
    throw new Error(
      "Billing cannot reach ClickUp from this cockpit: CLICKUP_API_TOKEN is not set on the client success deployment. Ask Aziz.",
    );
  if (!url || !key)
    throw new Error(
      "Billing cannot reach Supabase from this cockpit: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the client success deployment. Ask Aziz.",
    );
  return { token, url, key };
}

/** Who is asking, and which clients they may see (null: all of them). */
export const who = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({
    email: v.string(),
    clients: v.union(v.array(v.string()), v.null()),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!(await hasAccess(ctx, email)))
      throw new Error(
        "This cockpit is not yours. Ask Aziz to add you in the portal.",
      );
    const clients = await allowedClients({ ...ctx, userId });
    return { email, clients: clients ? [...clients] : null };
  },
});

type Who = { email: string; clients: string[] | null };

const mayBill = (w: Who, name: string) =>
  w.clients === null || w.clients.includes(name.trim().toLowerCase());

async function upsert(e: ReturnType<typeof env>, a: Account): Promise<void> {
  await sb(
    e.url,
    e.key,
    "cockpit_billing_accounts?on_conflict=clickup_task_id",
    {
      method: "POST",
      body: accountRow(a),
      prefer: "resolution=merge-duplicates,return=minimal",
    },
  );
}

export const sheet = authenticatedAction({
  args: { fresh: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<Sheet> => {
    const w: Who = await ctx.runQuery(internal.billing.who, {
      userId: ctx.userId,
    });
    const e = env();
    if (a.fresh)
      await mirrorAccounts(e.url, e.key, await readAccounts(e.token));
    const s = await readSheet(e.url, e.key);
    if (w.clients === null) return s;
    const mine = new Set(
      s.rows.filter(r => mayBill(w, r.name)).map(r => r.taskId),
    );
    const rows = s.rows.filter(r => mine.has(r.taskId));
    return {
      ...s,
      rows,
      cards: s.cards.filter(c => mine.has(c.taskId)),
      events: s.events.filter(x => mine.has(x.clickup_task_id)),
      inbox: s.inbox.filter(x => mine.has(String(x.clickup_task_id))),
      // The figures are this person's clients only, like the rows.
      totals: {
        ...s.totals,
        dueThisWeek: sum(
          rows,
          r =>
            r.ladder.days !== null &&
            r.ladder.days >= 0 &&
            r.ladder.days <= 7 &&
            r.group !== "paused",
        ),
        overdue: sum(
          rows,
          r =>
            r.ladder.days !== null && r.ladder.days < 0 && r.group !== "paused",
        ),
        paused: rows.filter(r => r.group === "paused").length,
        extended: rows.filter(r => (r.extensionWeeks ?? 0) > 0).length,
        noMethod: rows.filter(r => r.group === "active" && !r.method).length,
        noDate: rows.filter(r => r.group === "active" && !r.nextDate).length,
      },
    };
  },
});

function sum<T extends { nextUsd: number | null }>(
  rows: T[],
  keep: (r: T) => boolean,
): { count: number; usd: number } {
  const list = rows.filter(keep);
  return {
    count: list.length,
    usd: Math.round(list.reduce((t, r) => t + (r.nextUsd ?? 0), 0) * 100) / 100,
  };
}

const vEdit = v.union(
  v.object({ kind: v.literal("method"), value: v.string() }),
  v.object({ kind: v.literal("plan"), value: v.string() }),
  v.object({ kind: v.literal("amount"), value: v.number() }),
  v.object({
    kind: v.literal("date"),
    value: v.string(),
    reason: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("extension"),
    weeks: v.number(),
    reason: v.string(),
    ours: v.boolean(),
    moveDate: v.boolean(),
  }),
  v.object({
    kind: v.literal("pause"),
    reason: v.string(),
    on: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("resume"), nextDate: v.optional(v.string()) }),
  v.object({ kind: v.literal("note"), text: v.string() }),
);

/** One decision on one client: ClickUp first, then the mirror and the log. */
export const edit = authenticatedAction({
  args: { taskId: v.string(), edit: vEdit },
  returns: v.any(),
  handler: async (ctx, a): Promise<Account> => {
    const w: Who = await ctx.runQuery(internal.billing.who, {
      userId: ctx.userId,
    });
    const e = env();
    const current = await readAccount(e.token, a.taskId);
    if (!mayBill(w, current.name))
      throw new Error(
        `${current.name} is not one of your clients in the portal, so its billing is not yours to change.`,
      );
    const { next, event } = await applyEdit(e.token, current, a.edit as Edit, {
      by: w.email,
      source: "csm",
    });
    await upsert(e, next);
    await logEvent(e.url, e.key, event);
    return next;
  },
});

const RAILS = ["bank_transfer", "cheque", "cash", "tap", "other"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A payment a success manager saw arrive. It waits in the inbox until the
 * CEO cockpit takes it into the ledger; the next payment date moves on the
 * card now, because that is what the ladder reads.
 */
export const logPayment = authenticatedAction({
  args: {
    taskId: v.string(),
    day: v.string(),
    amount: v.number(),
    currency: v.union(v.literal("USD"), v.literal("KWD")),
    rail: v.union(
      v.literal("bank_transfer"),
      v.literal("cheque"),
      v.literal("cash"),
      v.literal("tap"),
      v.literal("other"),
    ),
    reference: v.optional(v.string()),
    evidenceUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    nextDate: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, a): Promise<string> => {
    const w: Who = await ctx.runQuery(internal.billing.who, {
      userId: ctx.userId,
    });
    const e = env();
    const today = kuwaitToday();
    if (!DAY.test(a.day) || a.day > today || a.day < "2025-01-01")
      throw new Error("Pick the day the money arrived, today or before.");
    const wrong = amountProblem(a.amount, a.currency);
    if (wrong) throw new Error(wrong);
    if (!(RAILS as readonly string[]).includes(a.rail))
      throw new Error("Pick how the money came.");
    const evidence = (a.evidenceUrl ?? "").trim();
    if (evidence && !/^https?:\/\/\S+$/.test(evidence))
      throw new Error(
        "The receipt has to be a link that opens, starting https://.",
      );
    // Maher's rule and the SOP's: a transfer without its photo is unpaid.
    if (a.rail === "bank_transfer" && !evidence)
      throw new Error(
        "Add the link to the transfer's receipt photo first. A bank transfer without its photo counts as unpaid.",
      );
    if (a.nextDate && (!DAY.test(a.nextDate) || a.nextDate <= a.day))
      throw new Error("Their next payment has to be after this one.");

    const current = await readAccount(e.token, a.taskId);
    if (!mayBill(w, current.name))
      throw new Error(
        `${current.name} is not one of your clients in the portal, so its payments are not yours to log.`,
      );
    const clip = (s: string | undefined, n: number) =>
      (s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || null;
    const [row] = await sb(e.url, e.key, "cockpit_billing_inbox", {
      method: "POST",
      body: {
        clickup_task_id: current.taskId,
        client_name: current.name,
        paid_on: a.day,
        amount: Math.round(a.amount * 1000) / 1000,
        currency: a.currency,
        method: a.rail,
        reference: clip(a.reference, 120),
        evidence_url: evidence || null,
        note: clip(a.note, 500),
        source: "csm",
        logged_by: w.email,
      },
      prefer: "return=representation",
    });

    let moved = "";
    if (a.nextDate && a.nextDate !== current.nextDate) {
      const { next, event } = await applyEdit(
        e.token,
        current,
        { kind: "date", value: a.nextDate, reason: "Paid; next payment set" },
        { by: w.email, source: "csm" },
        today,
      );
      await upsert(e, next);
      await logEvent(e.url, e.key, event);
      moved = `, and the card says they pay next on ${a.nextDate}`;
    }
    const paid =
      a.currency === "KWD"
        ? `${a.amount.toLocaleString("en-US")} KWD`
        : `$${a.amount.toLocaleString("en-US")}`;
    return `Logged ${paid} from ${current.name} (inbox ${row?.id ?? "row"})${moved}. It reaches the ledger and the client's LTV at the CEO cockpit's next refresh.`;
  },
});
