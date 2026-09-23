import { type Infer, v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { internalQuery } from "../../_generated/server";
import { vManualCurrency, vManualRail, writerLabel } from "../writeGuard";

/**
 * Hand-logged payments (ceoManualPayments) as the CEO money section reads
 * them, plus the client names the duplicate check matches against.
 *
 * Nothing here writes. Emails never leave this file: `addedBy` and
 * `deletedBy` go out as a name ("Aziz"), and the typed client name and note
 * have anything that looks like an email or a phone number masked, the way
 * the clients loader masks digest summaries.
 */

/** One hand-logged payment as it leaves the backend (no emails). */
export const vManualRow = v.object({
  id: v.id("ceoManualPayments"),
  day: v.string(),
  amount: v.number(),
  currency: vManualCurrency,
  amountUsd: v.number(),
  usdPerUnit: v.number(),
  client: v.string(),
  clickupTaskId: v.union(v.string(), v.null()),
  rail: vManualRail,
  /** "payment" or "refund". */
  kind: v.union(v.literal("payment"), v.literal("refund")),
  dealContracted: v.union(v.number(), v.null()),
  dealContractedUsd: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  addedBy: v.string(),
  addedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
  deletedBy: v.union(v.string(), v.null()),
});

export type ManualRow = Infer<typeof vManualRow>;

/** Mask an email or a phone number someone typed into a free text field. */
export function maskContact(s: string): string {
  return s
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, m =>
      // A date like 2026-09-14 is not a phone number, nor is a short amount.
      /^\d{4}-\d{1,2}-\d{1,2}$/.test(m) || m.replace(/\D/g, "").length < 8
        ? m
        : "[number]",
    );
}

/** A stored row as the screen may see it. */
export function shapeManualRow(r: Doc<"ceoManualPayments">): ManualRow {
  return {
    id: r._id,
    day: r.day,
    amount: r.amount,
    currency: r.currency,
    amountUsd: r.amountUsd,
    usdPerUnit: r.usdPerUnit,
    client: maskContact(r.clientName),
    clickupTaskId: r.clickupTaskId ?? null,
    rail: r.rail,
    kind: r.kind ?? "payment",
    dealContracted: r.dealContracted ?? null,
    dealContractedUsd: r.dealContractedUsd ?? null,
    note: r.note ? maskContact(r.note) : null,
    addedBy: writerLabel(r.addedBy),
    addedAt: r.addedAt,
    deletedAt: r.deletedAt ?? null,
    deletedBy: r.deletedAt === undefined ? null : writerLabel(r.deletedBy),
  };
}

/** Newest day first, then newest entry first. */
export function byNewest(a: ManualRow, b: ManualRow): number {
  return a.day === b.day ? b.addedAt - a.addedAt : a.day < b.day ? 1 : -1;
}

/** A ClickUp task id from a card url (https://app.clickup.com/t/<id>). */
const taskIdFromUrl = (url: unknown): string | null =>
  /\/t\/([A-Za-z0-9_-]+)/.exec(String(url ?? ""))?.[1] ?? null;

const MAX_ROWS = 5000;

export const vManualLoad = v.object({
  /** Live entries dated `from` or later, oldest day first. */
  live: v.array(vManualRow),
  /** Removed entries dated in `month`. */
  removedThisMonth: v.array(vManualRow),
  /** True when at least one live entry exists, of any date. */
  anyLive: v.boolean(),
  /** True when `live` hit the row cap, so totals would read low. */
  truncated: v.boolean(),
  /** Newest add, removal or restore, epoch ms. */
  newestChangeAt: v.union(v.number(), v.null()),
  /** Every ClickUp client card with the names it is known by. */
  cards: v.array(
    v.object({
      taskId: v.string(),
      names: v.array(v.string()),
      /** The CSM on the card, a first name, or null. Who back-end money is credited to. */
      csm: v.union(v.string(), v.null()),
    }),
  ),
});

export type ManualLoad = Infer<typeof vManualLoad>;

/**
 * Live entries since `from` (the first day of the money section's twelve
 * month window), this month's removed ones, and the card names.
 */
export const load = internalQuery({
  args: { from: v.string(), month: v.string() },
  returns: vManualLoad,
  handler: async (ctx, { from, month }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(month))
      throw new Error("manual payments: bad day or month");

    const liveDocs = await ctx.db
      .query("ceoManualPayments")
      .withIndex("by_deleted_day", q =>
        q.eq("deletedAt", undefined).gte("day", from),
      )
      .take(MAX_ROWS);
    const anyLive =
      liveDocs.length > 0 ||
      (await ctx.db
        .query("ceoManualPayments")
        .withIndex("by_deleted_day", q => q.eq("deletedAt", undefined))
        .first()) !== null;

    const monthDocs = await ctx.db
      .query("ceoManualPayments")
      .withIndex("by_day", q =>
        q.gte("day", `${month}-01`).lte("day", `${month}-31`),
      )
      .take(MAX_ROWS);
    const removedThisMonth = monthDocs
      .filter(r => r.deletedAt !== undefined)
      .map(shapeManualRow);

    // The trail is written with every change, so its newest row is the
    // freshest the manual log has been.
    const recent = await ctx.db
      .query("ceoAudit")
      .withIndex("by_at")
      .order("desc")
      .take(200);
    const newestChangeAt =
      recent.find(r => r.table === "ceoManualPayments")?.at ?? null;

    // Card names and aliases, so "Something Studio KW" typed by hand and
    // "mergestudio.kw" on a deal can meet on the same card when the card
    // lists both. Only names leave this query.
    const names = new Map<string, Set<string>>();
    const csms = new Map<string, string>();
    const add = (taskId: string | null, name: unknown) => {
      const text = String(name ?? "").trim();
      if (!taskId || !text) return;
      const set = names.get(taskId) ?? new Set<string>();
      set.add(text);
      names.set(taskId, set);
    };
    for (const c of await ctx.db.query("clients").take(1000)) {
      add(c.taskId, c.name);
      const csm = String(c.csmAssigned ?? "").trim();
      if (csm) csms.set(c.taskId, csm.split(/\s+/)[0]);
    }
    for (const l of await ctx.db.query("clientLinks").take(1000)) {
      const taskId = taskIdFromUrl(l.url);
      add(taskId, l.name);
      for (const alias of l.aliases) add(taskId, alias);
    }

    return {
      live: liveDocs.map(shapeManualRow),
      removedThisMonth,
      anyLive,
      truncated: liveDocs.length >= MAX_ROWS,
      newestChangeAt,
      cards: [...names].map(([taskId, set]) => ({
        taskId,
        names: [...set],
        csm: csms.get(taskId) ?? null,
      })),
    };
  },
});
