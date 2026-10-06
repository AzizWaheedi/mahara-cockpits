/**
 * The hot list as a sheet (Aziz, 2026-09-27: "the same way a spreadsheet is
 * for last follow-up, next follow-up"): a row's fields and their words, when
 * a lead was last followed up and by what, how due the next follow-up is,
 * the sheet's order, and the one-tap next dates. Pure, so bun tests it
 * (hot.test.ts); the screens are components/HotSheet.tsx (the list) and
 * components/HotList.tsx (one lead's page).
 */

import { kuwaitAt } from "./dialer";
import { dayLabel, kuwaitDay, money, num, when } from "./format";

export type Heat = "red_hot" | "hot" | "warm";
export type HotStatus = "nurturing" | "closed" | "lost";

/** A cockpit_sales_hot row as the browser reads it. */
export interface HotRow {
  contact_id: string;
  owner_email: string;
  next_at: string | null;
  next_how: string | null;
  last_objection: string | null;
  note: string | null;
  /** Absent until the 2026-09-27 migration is in; blank reads as "hot". */
  heat?: Heat | null;
  /** Absent until the 2026-09-27 migration is in; blank reads as nurturing. */
  status?: HotStatus | null;
  /** numeric: a number, or a string for a very large one. Blank is "not said". */
  amount?: number | string | null;
  amount_currency?: string | null;
  /** The last follow-up marked by hand. */
  last_fu_at?: string | null;
  added_by: string;
  added_at: string;
  updated_at: string;
  removed_at: string | null;
}

export const HEATS: [Heat, string][] = [
  ["red_hot", "Red hot"],
  ["hot", "Hot"],
  ["warm", "Warm"],
];
export const STATUSES: [HotStatus, string][] = [
  ["nurturing", "Nurturing"],
  ["closed", "Closed"],
  ["lost", "Lost"],
];
export const CURRENCIES = [
  "USD",
  "KWD",
  "SAR",
  "AED",
  "QAR",
  "BHD",
  "OMR",
] as const;

export const heatOf = (r: Pick<HotRow, "heat">): Heat => r.heat ?? "hot";
export const statusOf = (r: Pick<HotRow, "status">): HotStatus =>
  r.status ?? "nurturing";
/** Still being worked: not closed and not lost. */
export const isOpen = (r: Pick<HotRow, "status">) =>
  statusOf(r) === "nurturing";
export const heatWord = (h: Heat) => HEATS.find(([k]) => k === h)?.[1] ?? h;
export const statusWord = (s: HotStatus) =>
  STATUSES.find(([k]) => k === s)?.[1] ?? s;

const ms = (v: string | null | undefined): number | null => {
  const t = v ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/** The amount as money ("$5,000", "KWD 1,500"), or null when none is said. */
export function amountText(
  r: Pick<HotRow, "amount" | "amount_currency">,
): string | null {
  return num(r.amount) === null
    ? null
    : money(r.amount, r.amount_currency || "USD");
}

/**
 * What was typed in the amount cell: a number ("5000", "5,000", "$5,000",
 * "5k", "1.2m"), null for nothing, or NaN for something that is not one.
 */
export function parseAmount(text: string): number | null {
  const t = text
    .replace(/[\s,]/g, "")
    .replace(/^(\$|usd|kwd|sar|aed|qar|bhd|omr)/i, "");
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?|\.\d+)([km])?$/i.exec(t);
  if (!m) return Number.NaN;
  const scale =
    m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1;
  return Math.round(Number(m[1]) * scale * 100) / 100;
}

// ---------------------------------------------------------------------------
// Last follow-up: marked by hand, or the lead's own last call or WhatsApp
// ---------------------------------------------------------------------------

/** How far back the cockpit looks for a lead's calls and WhatsApp messages. */
export const TOUCH_DAYS = 120;

/** A lead's follow-ups the cockpit can see besides the one marked by hand. */
export interface Touches {
  /** The last outbound call, answered or not. */
  call: { at: number; answered: boolean } | null;
  /** The last WhatsApp message we sent that the cockpit can see. */
  whatsapp: number | null;
}

export type FollowUpBy = "marked" | "call" | "whatsapp";
export interface FollowUp {
  at: number;
  by: FollowUpBy;
}

export const BY_WORD: Record<FollowUpBy, string> = {
  marked: "marked",
  call: "call",
  whatsapp: "WhatsApp",
};

/** The latest follow-up the cockpit knows of, or null when there is none. */
export function lastFollowUp(
  markedAt: string | null | undefined,
  t: Touches | null | undefined,
): FollowUp | null {
  const list: FollowUp[] = [];
  const marked = ms(markedAt);
  if (marked !== null) list.push({ at: marked, by: "marked" });
  if (t?.call) list.push({ at: t.call.at, by: "call" });
  if (t?.whatsapp) list.push({ at: t.whatsapp, by: "whatsapp" });
  // The latest wins; on a tie, the one marked by hand (what the rep said).
  return list.sort((a, b) => b.at - a.at)[0] ?? null;
}

export interface DialTouch {
  contact_id: string | null;
  lead_phone8: string | null;
  occurred_at: string | null;
  state: string | null;
  direction?: string | null;
}
export interface InboxTouch {
  contact_id: string | null;
  last_message_at: string | null;
  last_direction: string | null;
  last_type: string | null;
}
export interface SentTouch {
  contact_id: string;
  created_at: string;
  channel: string;
  state: string;
}

/**
 * Each hot lead's last outbound call and last WhatsApp from us. A call
 * counts for the lead it is linked to, and one not linked yet for the lead
 * with its last eight digits; never for another lead that shares the digits
 * (the lead page's rule). WhatsApp is what the cockpit sent and still shows
 * as sent, and a conversation whose last message is our WhatsApp (the inbox
 * copy keeps only each conversation's last message).
 */
export function touchesFrom(
  leads: { contact_id: string; phone8: string | null }[],
  dials: DialTouch[],
  inbox: InboxTouch[],
  sent: SentTouch[],
): Map<string, Touches> {
  const out = new Map<string, Touches>();
  const of = (id: string): Touches => {
    let t = out.get(id);
    if (!t) {
      t = { call: null, whatsapp: null };
      out.set(id, t);
    }
    return t;
  };
  const ids = new Set(leads.map(l => l.contact_id));
  const byPhone = new Map<string, string[]>();
  for (const l of leads)
    if (l.phone8)
      byPhone.set(l.phone8, [...(byPhone.get(l.phone8) ?? []), l.contact_id]);
  for (const d of dials) {
    if (d.direction && d.direction !== "outbound") continue;
    const at = ms(d.occurred_at);
    if (at === null) continue;
    const whose = d.contact_id
      ? ids.has(d.contact_id)
        ? [d.contact_id]
        : []
      : d.lead_phone8
        ? (byPhone.get(d.lead_phone8) ?? [])
        : [];
    for (const id of whose) {
      const t = of(id);
      if (!t.call || at > t.call.at)
        t.call = { at, answered: d.state === "completed" };
    }
  }
  const whatsapp = (id: string, at: number | null) => {
    if (at === null || !ids.has(id)) return;
    const t = of(id);
    if (t.whatsapp === null || at > t.whatsapp) t.whatsapp = at;
  };
  for (const i of inbox)
    if (
      i.contact_id &&
      i.last_direction === "outbound" &&
      /whatsapp/i.test(String(i.last_type ?? ""))
    )
      whatsapp(i.contact_id, ms(i.last_message_at));
  for (const s of sent)
    if (
      s.channel === "whatsapp" &&
      ["sent", "delivered", "read"].includes(s.state)
    )
      whatsapp(s.contact_id, ms(s.created_at));
  return out;
}

/**
 * The last follow-up in words, for the cell's hover: what was marked, the
 * last call and the last WhatsApp, each said even when there is none.
 * `touches` is undefined when the calls and messages could not be read.
 */
export function followUpWords(
  markedAt: string | null | undefined,
  t: Touches | null | undefined,
  readFailed: boolean,
  now = Date.now(),
): string {
  const marked = ms(markedAt);
  const parts = [
    marked !== null
      ? `Marked by hand: ${when(new Date(marked).toISOString(), now)}`
      : "None marked by hand",
  ];
  if (readFailed) parts.push("Calls and WhatsApp could not be read");
  else {
    parts.push(
      t?.call
        ? `Last call: ${when(new Date(t.call.at).toISOString(), now)}, ${t.call.answered ? "answered" : "not answered"}`
        : `No call in the last ${TOUCH_DAYS} days`,
    );
    parts.push(
      t?.whatsapp
        ? `Last WhatsApp from us: ${when(new Date(t.whatsapp).toISOString(), now)}`
        : "No WhatsApp from us seen",
    );
  }
  return `${parts.join(". ")}.`;
}

// ---------------------------------------------------------------------------
// The next follow-up
// ---------------------------------------------------------------------------

export type Due = "overdue" | "today" | "later";

/** Overdue once its time has come; "today" while it is still ahead today (Kuwait). */
export function dueOf(
  nextAt: string | null | undefined,
  now: number,
): Due | null {
  const t = ms(nextAt);
  if (t === null) return null;
  if (t <= now) return "overdue";
  return kuwaitDay(t) === kuwaitDay(now) ? "today" : "later";
}

const KUWAIT_MS = 3 * 3_600_000;
/** Friday is the team's day off: a follow-up lands on Saturday instead. */
const notFriday = (t: number) =>
  new Date(t + KUWAIT_MS).getUTCDay() === 5 ? t + 86_400_000 : t;

/**
 * One-tap next follow-ups after a follow-up: the next working morning, three
 * days on and a week on, each at 10:00 Kuwait time, Fridays skipped.
 */
export function followUpPicks(now: number): { label: string; at: number }[] {
  const out: { label: string; at: number }[] = [];
  for (const days of [1, 3, 7]) {
    const at = notFriday(kuwaitAt(now, 10, 0, days));
    if (out.some(p => p.at === at)) continue;
    out.push({
      label: `${dayLabel(new Date(at).toISOString(), now)} 10:00`,
      at,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The sheet's order
// ---------------------------------------------------------------------------

export type SortKey =
  | "name"
  | "heat"
  | "status"
  | "objection"
  | "amount"
  | "last"
  | "next"
  | "note"
  | "owner";
export interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

/** The sheet opens on the next follow-up: overdue first, then the soonest. */
export const DEFAULT_SORT: Sort = { key: "next", dir: "asc" };

/** A column's first click: A to Z, hottest, biggest, longest ago, soonest. */
const FIRST_DIR: Record<SortKey, "asc" | "desc"> = {
  name: "asc",
  heat: "asc",
  status: "asc",
  objection: "asc",
  amount: "desc",
  last: "asc",
  next: "asc",
  note: "asc",
  owner: "asc",
};

/** A header clicked: its first direction, or the other way when it is already the sort. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
}

export interface SortContext {
  name: (contactId: string) => string | null;
  /** The last follow-up, as the Last follow-up column shows it. */
  last: (contactId: string) => number | null;
  owner: (email: string) => string;
}

const HEAT_RANK: Record<Heat, number> = { red_hot: 0, hot: 1, warm: 2 };
const STATUS_RANK: Record<HotStatus, number> = {
  nurturing: 0,
  closed: 1,
  lost: 2,
};

/** A closed or lost deal has no follow-up coming, whatever its row still says. */
const nextOf = (r: HotRow) => (isOpen(r) ? ms(r.next_at) : null);
const text = (s: string | null | undefined) => s?.trim() || null;

function sortValue(
  r: HotRow,
  key: SortKey,
  ctx: SortContext,
): number | string | null {
  switch (key) {
    case "name":
      return text(ctx.name(r.contact_id));
    case "heat":
      return HEAT_RANK[heatOf(r)];
    case "status":
      return STATUS_RANK[statusOf(r)];
    case "objection":
      return text(r.last_objection);
    case "amount":
      return num(r.amount);
    case "last":
      return ctx.last(r.contact_id);
    case "next":
      return nextOf(r);
    case "note":
      return text(r.note);
    case "owner":
      return text(ctx.owner(r.owner_email));
  }
}

const compare = (a: number | string, b: number | string) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

/** Nulls after values, whichever way the column is sorted. */
function blanksLast(
  a: number | string | null,
  b: number | string | null,
  dir: 1 | -1,
): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return dir * compare(a, b);
}

/**
 * The rows in the sheet's order. Blanks go last whichever way a column is
 * sorted (as a spreadsheet does); ties fall back to the soonest follow-up,
 * open deals before closed and lost ones, then the name, so the order never
 * shuffles between two reads.
 */
export function sortHot(
  rows: HotRow[],
  sort: Sort,
  ctx: SortContext,
): HotRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map(r => ({
      r,
      v: sortValue(r, sort.key, ctx),
      next: nextOf(r),
      status: STATUS_RANK[statusOf(r)],
      name: text(ctx.name(r.contact_id)),
    }))
    .sort(
      (x, y) =>
        blanksLast(x.v, y.v, dir) ||
        blanksLast(x.next, y.next, 1) ||
        x.status - y.status ||
        blanksLast(x.name, y.name, 1) ||
        x.r.contact_id.localeCompare(y.r.contact_id),
    )
    .map(x => x.r);
}

/**
 * The order kept while someone is editing, so a row never moves under the
 * cursor: rows that are gone drop out, new ones go at the end.
 */
export function keepOrder(before: string[], now: string[]): string[] {
  const here = new Set(now);
  const kept = before.filter(id => here.has(id));
  const seen = new Set(kept);
  return [...kept, ...now.filter(id => !seen.has(id))];
}

/** Of a row as read and as a save answered it, the one written last. */
export function newerRow<T extends { updated_at: string }>(
  read: T | null | undefined,
  saved: T | null | undefined,
): T | null {
  if (!saved) return read ?? null;
  if (!read) return saved;
  return Date.parse(saved.updated_at) > Date.parse(read.updated_at)
    ? saved
    : read;
}

/**
 * The list as it stands: the rows read, with each row a save answered here
 * in place of its read while it is the newer one. While the list shows one
 * seat's (`only`), anyone else's row leaves it: one given away here, or one
 * from the team's read still on screen after switching to Mine.
 */
export function mergeHot(
  read: HotRow[] | null,
  saved: Record<string, HotRow>,
  only: string | null,
): HotRow[] {
  const by = new Map(
    (read ?? [])
      .filter(r => only === null || r.owner_email === only)
      .map(r => [r.contact_id, r]),
  );
  for (const s of Object.values(saved)) {
    const r = newerRow(by.get(s.contact_id), s);
    if (!r || r.removed_at || (only !== null && r.owner_email !== only))
      by.delete(s.contact_id);
    else by.set(s.contact_id, r);
  }
  return [...by.values()];
}

/** How the list stands: open rows, the overdue and due-today ones, and the closed or lost. */
export function hotCounts(rows: HotRow[], now: number) {
  let open = 0;
  let overdue = 0;
  let today = 0;
  for (const r of rows) {
    if (!isOpen(r)) continue;
    open += 1;
    const d = dueOf(r.next_at, now);
    if (d === "overdue") overdue += 1;
    else if (d === "today") today += 1;
  }
  return { open, overdue, today, done: rows.length - open };
}
