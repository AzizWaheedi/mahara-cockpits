import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalQuery,
} from "./_generated/server";
import {
  type Account,
  accountRow,
  applyEdit,
  type Edit,
  logEvent,
  mirrorAccounts,
  readAccount,
  readAccounts,
  readSheet,
  reportCallsTo,
  type Sheet,
  sb,
} from "./billingCore";
import { authenticatedAction } from "./functions";
import { flush, note } from "./health";

declare const process: { env: Record<string, string | undefined> };

/**
 * The CEO cockpit's billing sheet.
 *
 * The rules live in billingCore.ts, shared with the client success cockpit.
 * This file adds what only the CEO side has: the ledger (the hand-logged
 * payments, Whop, Tap and the bank statements, attributed to clients by the
 * money section), the LTV built on it, and the money nobody has tied to a
 * client yet. It also runs the two jobs that keep the sheet honest: the
 * mirror of the ClickUp cards, and the inbox of payments logged elsewhere.
 */

// biome-ignore lint/suspicious/noExplicitAny: payload and PostgREST rows
type Any = Record<string, any>;

// Every ClickUp and Supabase call the billing core makes is noted on the
// health ledger; each action below flushes its notes when it ends.
reportCallsTo(note);

/**
 * A refusal the screen can read. In production Convex hides the text of an
 * error an action throws ("Server Error"), but not a ConvexError's data, so
 * every sentence written for a person is sent as one. [2026-09-23]
 */
function plain(e: unknown): ConvexError<{ message: string }> {
  if (e instanceof ConvexError) return e as ConvexError<{ message: string }>;
  const raw = e instanceof Error ? e.message : String(e);
  const message =
    raw
      .replace(/^[\s\S]*?Uncaught Error: /, "")
      .split("\n")[0]
      .trim()
      .slice(0, 300) || "That did not work. Try again in a minute.";
  return new ConvexError({ message });
}

async function noted<T>(ctx: ActionCtx, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw plain(e);
  } finally {
    await flush(ctx);
  }
}

function env(): { token: string; url: string; key: string } {
  const token =
    process.env.CLICKUP_API_TOKEN ?? process.env.CLICKUP_API_KEY ?? "";
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!token)
    throw new Error("CLICKUP_API_TOKEN is not set on this deployment.");
  if (!url || !key)
    throw new Error("Supabase is not configured on this deployment.");
  return { token, url, key };
}

/** The money section's attribution, for LTV, last payment and unassigned money. */
export const moneyFacts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const row = await ctx.db
      .query("ceoSections")
      .withIndex("by_key", q => q.eq("key", "money"))
      .first();
    const tx: Any[] = row?.payload?.attribution?.transactions ?? [];
    const inbound = tx.filter(
      t => t?.direction === "in" && typeof t.usd === "number",
    );
    const last = new Map<string, { day: string; usd: number; rail: string }>();
    for (const t of inbound) {
      if (!t.clientTaskId) continue;
      const cur = last.get(t.clientTaskId);
      if (!cur || t.day > cur.day)
        last.set(t.clientTaskId, { day: t.day, usd: t.usd, rail: t.rail });
    }
    // Money nobody has tied to a client, by who paid it: assign the payer
    // once and every payment they make from then on is theirs.
    const byPayer = new Map<
      string,
      {
        payer: string;
        count: number;
        usd: number;
        last: string;
        rails: Set<string>;
      }
    >();
    for (const t of inbound) {
      if (t.clientTaskId || t.side !== "unattributed") continue;
      const payer = String(
        t.payerName || t.payerEmail || "Unknown payer",
      ).trim();
      const g = byPayer.get(payer) ?? {
        payer,
        count: 0,
        usd: 0,
        last: t.day,
        rails: new Set<string>(),
      };
      g.count += 1;
      g.usd += t.usd;
      if (t.day > g.last) g.last = t.day;
      g.rails.add(String(t.rail));
      byPayer.set(payer, g);
    }
    return {
      computedAt: row?.computedAt ?? null,
      lastPaid: Object.fromEntries(last),
      unassigned: [...byPayer.values()]
        .map(g => ({
          ...g,
          usd: Math.round(g.usd * 100) / 100,
          rails: [...g.rails],
        }))
        .sort((a, b) => b.usd - a.usd),
    };
  },
});

export type SheetPayload = Sheet & {
  ltv: Record<
    string,
    { target: number; baseline: number; logged: number } | undefined
  >;
  lastPaid: Record<
    string,
    { day: string; usd: number; rail: string } | undefined
  >;
  unassigned: {
    payer: string;
    count: number;
    usd: number;
    last: string;
    rails: string[];
  }[];
  moneyAsOf: number | null;
};

export const sheet = authenticatedAction({
  args: { fresh: v.optional(v.boolean()) },
  returns: v.any(),
  handler: (ctx, a): Promise<SheetPayload> =>
    noted(ctx, async () => {
      await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
      const e = env();
      // "Fresh" re-reads every card from ClickUp first, for when somebody has
      // just edited a card there and does not want to wait for the sync.
      if (a.fresh)
        await mirrorAccounts(e.url, e.key, await readAccounts(e.token));
      const [base, facts, plan] = await Promise.all([
        readSheet(e.url, e.key),
        ctx.runQuery(internal.billing.moneyFacts, {}),
        ctx
          .runQuery(internal.ceo.ltv.plan, { userId: ctx.userId })
          .catch(() => null),
      ]);
      const ltv: SheetPayload["ltv"] = {};
      for (const r of (plan?.rows ?? []) as Any[])
        ltv[r.clickupTaskId] = {
          target: r.target,
          baseline: r.baseline,
          logged: r.logged,
        };
      return {
        ...base,
        ltv,
        lastPaid: facts.lastPaid,
        unassigned: facts.unassigned,
        moneyAsOf: facts.computedAt,
      };
    }),
});

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

/**
 * One decision on one client. ClickUp first, then the mirror and the log, so
 * nothing claims a change ClickUp refused.
 */
export const edit = authenticatedAction({
  args: { taskId: v.string(), edit: vEdit },
  returns: v.any(),
  handler: (ctx, a): Promise<Account> =>
    noted(ctx, async () => {
      const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
        userId: ctx.userId,
      });
      const e = env();
      const current = await readAccount(e.token, a.taskId);
      const { next, event } = await applyEdit(
        e.token,
        current,
        a.edit as Edit,
        {
          by,
          source: "ceo",
        },
      );
      await sb(
        e.url,
        e.key,
        "cockpit_billing_accounts?on_conflict=clickup_task_id",
        {
          method: "POST",
          body: accountRow(next),
          prefer: "resolution=merge-duplicates,return=minimal",
        },
      );
      await logEvent(e.url, e.key, event);
      return next;
    }),
});

/**
 * After a payment is in the ledger (the Money tab's own mutation logs it):
 * the line in the billing log, and the next payment date if one was given.
 */
export const afterPayment = authenticatedAction({
  args: {
    taskId: v.string(),
    amount: v.number(),
    currency: v.string(),
    day: v.string(),
    rail: v.string(),
    nextDate: v.optional(v.string()),
    reference: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<Account | null> =>
    noted(ctx, async () => {
      const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
        userId: ctx.userId,
      });
      const e = env();
      const current = await readAccount(e.token, a.taskId);
      let next: Account = current;
      if (a.nextDate) {
        const done = await applyEdit(
          e.token,
          current,
          { kind: "date", value: a.nextDate, reason: "Paid; next payment set" },
          { by, source: "ceo" },
        );
        next = done.next;
        await sb(
          e.url,
          e.key,
          "cockpit_billing_accounts?on_conflict=clickup_task_id",
          {
            method: "POST",
            body: accountRow(next),
            prefer: "resolution=merge-duplicates,return=minimal",
          },
        );
      }
      await logEvent(e.url, e.key, {
        clickup_task_id: current.taskId,
        client_name: current.name,
        kind: "payment",
        from_value: current.nextDate,
        to_value: a.nextDate ?? current.nextDate,
        reason: null,
        detail: {
          amount: a.amount,
          currency: a.currency,
          day: a.day,
          rail: a.rail,
          reference: a.reference ?? null,
        },
        source: "ceo",
        by_whom: by,
      });
      return next;
    }),
});

/** The line in the log when money is tied to a client from the sheet. */
export const afterAssign = authenticatedAction({
  args: {
    taskId: v.string(),
    clientName: v.string(),
    payer: v.string(),
    usd: v.number(),
    count: v.number(),
  },
  returns: v.null(),
  handler: (ctx, a): Promise<null> =>
    noted(ctx, async () => {
      const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
        userId: ctx.userId,
      });
      const e = env();
      await logEvent(e.url, e.key, {
        clickup_task_id: a.taskId,
        client_name: a.clientName,
        kind: "assign",
        from_value: null,
        to_value: a.payer,
        reason: `${a.count} ${a.count === 1 ? "payment" : "payments"} from ${a.payer}, $${a.usd.toLocaleString("en-US")}, tied to ${a.clientName}. They count as ${a.clientName}'s money from the next refresh; LTV adds only those from 19 Sep on.`,
        detail: { payer: a.payer, usd: a.usd, count: a.count },
        source: "ceo",
        by_whom: by,
      });
      return null;
    }),
});

/** Mirror every card. Runs with the CEO refresh, so ClickUp edits land within a cycle. */
export const syncMirror = internalAction({
  args: {},
  returns: v.string(),
  handler: (ctx): Promise<string> =>
    noted(ctx, async () => {
      const e = env();
      const accounts = await readAccounts(e.token);
      await mirrorAccounts(e.url, e.key, accounts);
      return `${accounts.length} cards mirrored`;
    }),
});

/**
 * Take every payment waiting in the inbox into the ledger, one at a time,
 * and mark each with what happened. Runs at the start of the CEO refresh, so
 * the money section counts them in the same cycle.
 */
export const ingestInbox = internalAction({
  args: {},
  returns: v.string(),
  handler: (ctx): Promise<string> =>
    noted(ctx, async () => {
      const e = env();
      const rows = await sb(
        e.url,
        e.key,
        "cockpit_billing_inbox?select=*&status=eq.pending&order=logged_at.asc&limit=50",
      );
      const counts = { ingested: 0, duplicate: 0, rejected: 0 };
      let stuck = 0;
      for (const r of rows) {
        let res: {
          status: "ingested" | "duplicate" | "rejected";
          id?: string;
          note: string;
        };
        try {
          res = await ctx.runMutation(
            internal.ceo.manualPayments.ingestFromInbox,
            {
              inboxId: Number(r.id),
              day: String(r.paid_on),
              amount: Number(r.amount),
              currency: r.currency,
              rail: r.method,
              clientName: String(r.client_name ?? r.clickup_task_id),
              clickupTaskId: String(r.clickup_task_id),
              note:
                [
                  r.reference ? `ref ${r.reference}` : null,
                  r.note,
                  r.evidence_url ? `receipt ${r.evidence_url}` : null,
                ]
                  .filter(Boolean)
                  .join("; ") || undefined,
              loggedBy: String(r.logged_by),
              source: String(r.source),
            },
          );
        } catch (err) {
          // A failure that is not a verdict (a conflict, a timeout) leaves the
          // payment waiting for the next refresh, with the reason beside it,
          // and never stops the rows after it.
          stuck += 1;
          await sb(
            e.url,
            e.key,
            `cockpit_billing_inbox?id=eq.${Number(r.id)}`,
            {
              method: "PATCH",
              body: {
                status_note: `Not taken in yet: ${String(err instanceof Error ? err.message : err).slice(0, 200)}. It is tried again at the next refresh.`,
              },
              prefer: "return=minimal",
            },
          ).catch(() => null);
          continue;
        }
        counts[res.status] += 1;
        await sb(e.url, e.key, `cockpit_billing_inbox?id=eq.${Number(r.id)}`, {
          method: "PATCH",
          body: {
            status: res.status,
            ledger_id: "id" in res ? res.id : null,
            status_note: res.note,
            settled_at: new Date().toISOString(),
          },
          prefer: "return=minimal",
        });
        if (res.status === "ingested")
          await logEvent(e.url, e.key, {
            clickup_task_id: String(r.clickup_task_id),
            client_name: r.client_name ?? null,
            kind: "payment",
            from_value: null,
            to_value: null,
            reason: null,
            detail: {
              amount: Number(r.amount),
              currency: r.currency,
              day: r.paid_on,
              rail: r.method,
              reference: r.reference ?? null,
              inbox: Number(r.id),
            },
            source: r.source === "maher" ? "maher" : "csm",
            by_whom: String(r.logged_by),
          });
      }
      return `${rows.length} waiting: ${counts.ingested} in, ${counts.duplicate} already there, ${counts.rejected} refused${stuck ? `, ${stuck} left for the next refresh` : ""}`;
    }),
});
