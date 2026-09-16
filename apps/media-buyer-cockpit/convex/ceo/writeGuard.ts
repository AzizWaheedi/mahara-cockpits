import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import schema from "../schema";
import { USD_PER } from "./data/tap";
import { isCeoEmail, requireCeo } from "./gate";
import { kuwaitDay } from "./time";

/**
 * The one door every CEO cockpit write goes through (2026-09-16).
 *
 * Until this pass the CEO cockpit only read. Every write it now makes is a
 * public `authenticatedMutation` whose handler is one call to `ceoWrite`:
 *
 * ```ts
 * export const add = authenticatedMutation({
 *   args: { day: v.string(), amount: v.number(), currency: vManualCurrency, ... },
 *   returns: v.id("ceoManualPayments"),
 *   handler: async (ctx, a) =>
 *     ceoWrite(ctx, async w => {
 *       const id = await ctx.db.insert("ceoManualPayments", {
 *         ...,
 *         addedBy: w.by,
 *         addedAt: w.at,
 *       });
 *       return {
 *         result: id,
 *         audit: {
 *           action: "manualPayment.add",
 *           table: "ceoManualPayments",
 *           rowId: id,
 *           what: "Logged $1,500 by bank transfer from Ardon",
 *           after: await ctx.db.get(id),
 *         },
 *         refresh: ["money", "clients"],
 *       };
 *     }),
 * });
 * ```
 *
 * What `ceoWrite` guarantees, so the write features cannot drift apart:
 *
 * 1. The CEO check runs first, with the same `requireCeo` from ./gate that
 *    every CEO read uses. Nobody else gets past it, and nothing is written
 *    before it passes.
 * 2. One clock: `w.by` (the CEO's email), `w.at` (epoch ms) and `w.day` (the
 *    Kuwait day of `w.at`) go on the row and on its audit entry alike.
 * 3. The audit row is written in the same transaction as the change. The
 *    callback must return at least one entry, and if the callback or the
 *    audit insert throws, Convex rolls the whole write back. A change never
 *    lands without its trail. The trail lives in `ceoAudit`, not in
 *    manualChanges or campaignChat: those are keyed by campaign and read as
 *    media buying work by the Management feed.
 * 4. The sections the change affects are recomputed in the background right
 *    after, the same job "Refresh now" starts, so the screen shows the
 *    change without waiting for the 15 minute refresh.
 *
 * What stays with the feature: validating its own arguments (with the v.*
 * validators below plus the assert helpers for what a validator cannot say)
 * and only ever writing Convex tables. No CEO write calls Supabase, ClickUp,
 * Whop, Tap or any outside system.
 *
 * This file registers no Convex function, so the PHI check and the schema
 * are unaffected by importing it.
 */

// --- Validators, taken from the schema so a table and its mutation can never disagree ---

const teamFields = schema.tables.ceoTeamStatus.validator.fields;
const paymentFields = schema.tables.ceoManualPayments.validator.fields;

/** "active" | "paused" | "left". */
export const vTeamStatus = teamFields.status;
/** "USD" | "KWD". */
export const vManualCurrency = paymentFields.currency;
/** "bank_transfer" | "cheque" | "cash" | "tap" | "other". */
export const vManualRail = paymentFields.rail;

export type TeamStatus = Infer<typeof vTeamStatus>;
export type ManualCurrency = Infer<typeof vManualCurrency>;
export type ManualRail = Infer<typeof vManualRail>;

/** Plain words for each rail, for audit sentences and the screen. */
export const MANUAL_RAIL_LABEL: Record<ManualRail, string> = {
  bank_transfer: "bank transfer",
  cheque: "cheque",
  cash: "cash",
  tap: "Tap",
  other: "other",
};

// --- The write itself ---

/** The backend section keys (convex/ceo/registry.ts), not the tab keys. */
export type CeoSectionKey =
  | "money"
  | "expenses"
  | "growth"
  | "delivery"
  | "calls"
  | "clients"
  | "team"
  | "portal"
  | "machine";

/** Tables a CEO write may change. Add a table here when a new write feature needs one. */
export type CeoWriteTable = "ceoTeamStatus" | "ceoManualPayments";

export type CeoAuditEntry = {
  /** "<feature>.<verb>", e.g. "manualPayment.add", "manualPayment.remove", "teamStatus.set". */
  action: string;
  table: CeoWriteTable;
  /** The row's id as a string. For ceoTeamStatus use the person key, so one person's history reads as one row. */
  rowId: string;
  /** One plain sentence saying what changed. Em dashes are replaced on the way in. */
  what: string;
  /** The row before the change (a Doc is fine; system fields are dropped). */
  before?: unknown;
  /** The row after the change. */
  after?: unknown;
};

/** Who is writing and when, fixed once per write. */
export type CeoWriter = {
  /** The CEO's email, lower case, from ./gate. Store it as setBy / addedBy / deletedBy. */
  by: string;
  /** Epoch ms, the same on the row and on its audit entry. */
  at: number;
  /** Kuwait day of `at`, YYYY-MM-DD. */
  day: string;
};

export type CeoWriteOutcome<T> = {
  /** What the mutation returns to the screen. */
  result: T;
  /** At least one entry. A write that changed nothing still says so. */
  audit: CeoAuditEntry | CeoAuditEntry[];
  /** Sections to recompute now. Omit or leave empty for none. */
  refresh?: CeoSectionKey[];
};

/** The ctx inside an `authenticatedMutation` handler (convex/functions.ts). */
export type CeoMutationCtx = MutationCtx & { userId: Id<"users"> };
/** The ctx inside an `authenticatedQuery` handler. */
export type CeoQueryCtx = QueryCtx & { userId: Id<"users"> };

const ACTION_RE = /^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/;

/**
 * Run one CEO write: gate, change, audit, refresh. See the file comment.
 * Throws a plain sentence on any refusal; nothing is written in that case.
 */
export async function ceoWrite<T>(
  ctx: CeoMutationCtx,
  write: (w: CeoWriter) => Promise<CeoWriteOutcome<T>>,
): Promise<T> {
  const by = await requireCeo(ctx);
  const at = Date.now();
  const out = await write({ by, at, day: kuwaitDay(at) });

  const entries = Array.isArray(out.audit) ? out.audit : [out.audit];
  if (entries.length === 0)
    throw new Error("A CEO write must leave an audit entry.");
  for (const e of entries) {
    if (!ACTION_RE.test(e.action))
      throw new Error(`"${e.action}" is not a CEO audit action name.`);
    const what = cleanText(e.what, 400);
    if (!what) throw new Error("A CEO audit entry needs a sentence.");
    const rowId = e.rowId.trim();
    if (!rowId) throw new Error("A CEO audit entry needs the changed row.");
    await ctx.db.insert("ceoAudit", {
      action: e.action,
      table: e.table,
      rowId,
      what,
      before: snapshot(e.before),
      after: snapshot(e.after),
      by,
      at,
    });
  }

  const sections = [...new Set(out.refresh ?? [])];
  if (sections.length)
    await ctx.scheduler.runAfter(0, internal.ceo.refresh.refreshAll, {
      only: sections,
    });
  return out.result;
}

/** A row as stored in the trail: no system fields, no undefined values. */
function snapshot(row: unknown): Record<string, unknown> | undefined {
  if (row === null || row === undefined || typeof row !== "object")
    return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(row as Record<string, unknown>))
    if (!k.startsWith("_") && !k.startsWith("$") && val !== undefined)
      out[k] = val;
  return out;
}

// --- Reading the trail back ---

/** One audit row as the screen may show it: the writer as a name, never an email. */
export type CeoAuditRow = {
  action: string;
  table: string;
  rowId: string;
  what: string;
  by: string;
  at: number;
};

/**
 * The newest audit rows, for a history list on a tab. Runs the CEO check
 * itself, so a feature's query can return it as is. Filter by table, or by
 * table and row for one payment's or one person's history.
 */
export async function auditTrail(
  ctx: CeoQueryCtx | CeoMutationCtx,
  filter: { table?: CeoWriteTable; rowId?: string; limit?: number } = {},
): Promise<CeoAuditRow[]> {
  await requireCeo(ctx);
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
  const { table, rowId } = filter;
  let rows: Doc<"ceoAudit">[];
  if (table && rowId)
    rows = await ctx.db
      .query("ceoAudit")
      .withIndex("by_row", q => q.eq("table", table).eq("rowId", rowId))
      .order("desc")
      .take(limit);
  else if (table)
    rows = await ctx.db
      .query("ceoAudit")
      .withIndex("by_row", q => q.eq("table", table))
      .order("desc")
      .take(limit);
  else
    rows = await ctx.db
      .query("ceoAudit")
      .withIndex("by_at")
      .order("desc")
      .take(limit);
  // by_row with only the table fixed sorts by row first, so re-sort by time.
  return rows
    .sort((a, b) => b.at - a.at)
    .map(r => ({
      action: r.action,
      table: r.table,
      rowId: r.rowId,
      what: r.what,
      by: writerLabel(r.by),
      at: r.at,
    }));
}

/**
 * The name a payload shows for a writer. Payloads carry no emails, and only
 * the CEO can write, so this is "Aziz" in practice.
 */
export function writerLabel(email: string | null | undefined): string {
  if (!email) return "unknown";
  if (isCeoEmail(email)) return "Aziz";
  const local = email.split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "unknown";
}

// --- Argument checks a v.* validator cannot express ---

/**
 * Trimmed, one line, no em or en dashes (house style), at most `max`
 * characters. Returns undefined for an empty string, so an optional field is
 * left off the row rather than stored as "". Free text is stored as typed
 * otherwise; payloads mask emails and phone numbers on the way out.
 */
export function cleanText(
  s: string | null | undefined,
  max = 500,
): string | undefined {
  const text = String(s ?? "")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return text || undefined;
}

/**
 * A real Kuwait day, YYYY-MM-DD, optionally inside a range (inclusive).
 * Returns the day so it can be used inline.
 */
export function assertKuwaitDay(
  day: string,
  label: string,
  range: { notBefore?: string; notAfter?: string } = {},
): string {
  const t = new Date(`${day}T00:00:00Z`);
  const ok =
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(t.getTime()) &&
    t.toISOString().slice(0, 10) === day;
  if (!ok) throw new Error(`${label} must be a date like 2026-09-16.`);
  if (range.notBefore && day < range.notBefore)
    throw new Error(`${label} cannot be before ${range.notBefore}.`);
  if (range.notAfter && day > range.notAfter)
    throw new Error(`${label} cannot be after ${range.notAfter}.`);
  return day;
}

/**
 * The team adapter's person key, "<role>:<first>": a lower case role key
 * (letters and underscores) and the letters of a first name in any script,
 * lower cased (Arabic has no case, so it is letters only). This is
 * TeamPerson.key exactly.
 */
export const TEAM_PERSON_KEY_RE = /^[a-z][a-z_]*:\p{L}+$/u;

export function assertPersonKey(key: string): string {
  if (!TEAM_PERSON_KEY_RE.test(key) || key !== key.toLowerCase())
    throw new Error(
      `"${key}" is not a Management person key (role:firstname).`,
    );
  return key;
}

/** Largest amount one hand entry may carry, in its own currency. Catches a slipped key. */
export const MANUAL_MAX_AMOUNT = 1_000_000;

/**
 * An amount as typed, checked, and its USD value at write time with the same
 * fixed USD_PER table money.ts uses for Tap (convex/ceo/data/tap.ts, which
 * matches convex/sync.ts). Keep `usdPerUnit` on the row so history never
 * moves when a rate is changed later.
 */
export function usdAtWrite(
  amount: number,
  currency: ManualCurrency,
  label = "The amount",
): { amount: number; usd: number; usdPerUnit: number } {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error(`${label} must be a number above 0.`);
  if (amount > MANUAL_MAX_AMOUNT)
    throw new Error(
      `${label} is over 1,000,000 ${currency}. Check it and enter it again.`,
    );
  // KWD has three decimals (fils); nothing smaller is money.
  if (Math.abs(Math.round(amount * 1000) - amount * 1000) > 1e-6)
    throw new Error(`${label} has more than three decimals.`);
  const usdPerUnit = USD_PER[currency];
  if (!usdPerUnit) throw new Error(`There is no fixed rate for ${currency}.`);
  return {
    amount,
    usd: Math.round(amount * usdPerUnit * 100) / 100,
    usdPerUnit,
  };
}
