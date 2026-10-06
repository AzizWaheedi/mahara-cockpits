/**
 * The churn tracker's rules, in one place (no Convex imports: the page uses
 * them too). They are mahara-context's churn tracker
 * (skills/meta/clickup-board-design/references/churn-tracker-build.md) and
 * the churn definition in the CSM contract
 * (skills/meta/comp-structure-design/references/churn-and-billing-timelines.md):
 *
 * - Churn is a client lost mid-programme, before day 90 from launch. A
 *   client who completes the term is never churn, renewed or not; that is
 *   the renewal line, so one client leaving is never counted twice.
 * - Per month: active at the start (typed, or carried from the month before)
 *   and new clients are typed; churned and completed come from the register;
 *   active at the end = start + new - churned - completed; churn rate =
 *   churned / start; the rolling three months is the number to manage
 *   against, because at 17 clients one departure is 5.9%.
 * - The bands match the CSM's retention bonus (src/lib/csmMoney.ts).
 */

export const PROGRAMME_DAYS = 90;
export const TARGET_PCT = 10;

/** Why a client left: the ClickUp card's "❌ Churn Reason" options, plus Other. */
export const REASONS = [
  "Cancelled",
  "Refund",
  "Chargeback",
  "Non-payment 14+ days",
  "Paused past 14 days",
  "Ghosted",
  "Completed term, did not renew",
  "Other",
] as const;
export type Reason = (typeof REASONS)[number];

export type Departure = {
  id: number;
  client: string;
  clickupTaskId: string | null;
  leftOn: string;
  launchedOn: string | null;
  reason: Reason;
  mrrLostUsd: number | null;
  csm: string | null;
  note: string | null;
  source: "cockpit" | "sheet";
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type CountsAs = "churn" | "completed" | "unknown";

const DAY_MS = 86_400_000;

/** Days from launch to the day they left; null without a launch date. */
export function daysIn(d: {
  leftOn: string;
  launchedOn: string | null;
}): number | null {
  if (!d.launchedOn) return null;
  return Math.round(
    (Date.parse(`${d.leftOn}T00:00:00Z`) -
      Date.parse(`${d.launchedOn}T00:00:00Z`)) /
      DAY_MS,
  );
}

/** Before day 90 is churn; day 90 or later finished the term. */
export function countsAs(d: {
  leftOn: string;
  launchedOn: string | null;
}): CountsAs {
  const n = daysIn(d);
  if (n === null) return "unknown";
  return n < PROGRAMME_DAYS ? "churn" : "completed";
}

export const monthOf = (day: string) => day.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** "October 2026" from "2026-10". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][m - 1]
  } ${y}`;
}

export type Band = {
  label: "Excellent" | "Good" | "On target" | "Watch" | "Bad" | "Critical";
  tone: "good" | "warn" | "bad";
};

/** The CSM contract's bands: 0-4 Excellent, 5-8 Good, 9-10 On target, 11-12 Watch, 13-15 Bad, over 15 Critical. */
export function bandOf(pct: number): Band {
  if (pct <= 4) return { label: "Excellent", tone: "good" };
  if (pct <= 8) return { label: "Good", tone: "good" };
  if (pct <= 10) return { label: "On target", tone: "good" };
  if (pct <= 12) return { label: "Watch", tone: "warn" };
  if (pct <= 15) return { label: "Bad", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

export type MonthInput = {
  month: string;
  activeAtStart: number | null;
  newClients: number | null;
  lostBeforeRegister: number | null;
  note: string | null;
};

export type MonthRow = {
  month: string;
  activeAtStart: number | null;
  /** The start came from the month before, not typed. */
  startCarried: boolean;
  newClients: number | null;
  churned: number;
  completed: number;
  /** Departures with no launch date: not counted until one is given. */
  unknown: number;
  /** The old sheet's count, for a month before the register. */
  lostBeforeRegister: number | null;
  activeAtEnd: number | null;
  churnPct: number | null;
  retentionPct: number | null;
  netGrowth: number | null;
  rolling3Pct: number | null;
  band: Band | null;
  note: string | null;
  /** Anything typed or logged: a month with nothing is left out of the list. */
  hasData: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Every month from the first one with anything in it to `through`, oldest
 * first. A blank start is carried from the month before when that month's
 * end is known; a month only the old sheet covered counts its lost clients
 * as churned, as the sheet did.
 */
export function rollUp(
  inputs: MonthInput[],
  departures: Pick<Departure, "leftOn" | "launchedOn">[],
  through: string,
): MonthRow[] {
  const byMonth = new Map(inputs.map(i => [i.month, i]));
  const months = [
    ...inputs.map(i => i.month),
    ...departures.map(d => monthOf(d.leftOn)),
    through,
  ].sort();
  const first = months[0];
  const out: MonthRow[] = [];
  let prevEnd: number | null = null;
  for (let m = first; m <= through; m = addMonths(m, 1)) {
    const input = byMonth.get(m);
    const mine = departures.filter(d => monthOf(d.leftOn) === m);
    const register = {
      churn: mine.filter(d => countsAs(d) === "churn").length,
      completed: mine.filter(d => countsAs(d) === "completed").length,
      unknown: mine.filter(d => countsAs(d) === "unknown").length,
    };
    // The old sheet's count stands only for a month the register does not
    // cover: once a departure is logged for it, the register is the count,
    // so one client is never counted from both.
    const lostBefore = mine.length ? null : (input?.lostBeforeRegister ?? null);
    const churned = register.churn + (lostBefore ?? 0);
    const typedStart = input?.activeAtStart ?? null;
    const start: number | null = typedStart ?? prevEnd;
    const fresh = input?.newClients ?? null;
    const end: number | null =
      start === null || fresh === null
        ? null
        : start + fresh - churned - register.completed;
    const churnPct = start ? round1((churned / start) * 100) : null;
    out.push({
      month: m,
      activeAtStart: start,
      startCarried: typedStart === null && start !== null,
      newClients: fresh,
      churned,
      completed: register.completed,
      unknown: register.unknown,
      lostBeforeRegister: lostBefore,
      activeAtEnd: end,
      churnPct,
      retentionPct: churnPct === null ? null : round1(100 - churnPct),
      netGrowth: fresh === null ? null : fresh - churned - register.completed,
      rolling3Pct: null,
      band: null,
      note: input?.note ?? null,
      hasData: Boolean(input) || mine.length > 0 || m === through,
    });
    prevEnd = end;
  }
  // The rolling three months: churned over starts, across the months with a start.
  for (let i = 0; i < out.length; i++) {
    const window = out
      .slice(Math.max(0, i - 2), i + 1)
      .filter(r => r.activeAtStart);
    const starts = window.reduce((s, r) => s + (r.activeAtStart ?? 0), 0);
    const lost = window.reduce((s, r) => s + r.churned, 0);
    out[i].rolling3Pct = starts ? round1((lost / starts) * 100) : null;
    out[i].band =
      out[i].rolling3Pct === null ? null : bandOf(out[i].rolling3Pct as number);
  }
  return out;
}

/** "Day 47: churn" style line for a departure, in plain words. */
export function verdictLine(d: {
  leftOn: string;
  launchedOn: string | null;
}): string {
  const n = daysIn(d);
  if (n === null) return "Needs a launch date before it counts either way";
  return n < PROGRAMME_DAYS
    ? `Day ${n} of ${PROGRAMME_DAYS}: counts as churn in ${monthName(monthOf(d.leftOn))}`
    : `Day ${n}: finished the term, not churn`;
}

/** What a typed departure must hold before it is saved. */
export function departureProblem(d: {
  client: string;
  leftOn: string;
  launchedOn: string | null;
  reason: string;
  mrrLostUsd: number | null;
}): string | null {
  if (!d.client.trim()) return "Name the client.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.leftOn)) return "Give the day they left.";
  if (d.launchedOn && !/^\d{4}-\d{2}-\d{2}$/.test(d.launchedOn))
    return "The launch date is not a date.";
  if (d.launchedOn && d.launchedOn > d.leftOn)
    return "The launch date is after the day they left.";
  if (!(REASONS as readonly string[]).includes(d.reason))
    return "Pick why they left.";
  if (
    d.mrrLostUsd !== null &&
    (!Number.isFinite(d.mrrLostUsd) || d.mrrLostUsd < 0)
  )
    return "MRR lost is a dollar amount, 0 or more.";
  return null;
}
