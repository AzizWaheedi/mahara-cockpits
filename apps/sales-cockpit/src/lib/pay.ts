/**
 * The arithmetic behind the Numbers and Team pages, kept free of React and
 * the network so every figure is pinned by a test (bun test src/lib/pay.test.ts):
 *
 * - pace: working days (Saturday to Thursday, Friday off, Kuwait days: the
 *   CEO cockpit's week, convex/ceo/goals.ts) and where a goal lands at the
 *   current rate;
 * - pay: a closer's estimate from the deals they signed, under the rule Aziz
 *   set on 2026-09-24 ("10% cash collected on contract so if it's $2k upfront
 *   and $6k contracted they get $200 now and the $400 while we collect it,
 *   and $250 PIF bonus");
 * - the team total of B2B's scorecard rows, whose rates are worked out again
 *   from the summed counts with B2B's own formulas, never averaged.
 */

import { kuwaitDay, money, num } from "./format";
import type {
  Dial,
  GoalKey,
  Goals,
  PayRule,
  Rep,
  Scorecard,
  WindowKey,
} from "./types";

const DAY_MS = 86_400_000;
const FRIDAY = 5;

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function isDay(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(dayMs(s))
  );
}

export function addDays(day: string, n: number): string {
  return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The Saturday that starts the Kuwait week holding `day`. */
export function weekStart(day: string): string {
  const dow = new Date(dayMs(day)).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((dow + 1) % 7));
}

/** "Thu 24 Sep" for a Kuwait day, in the app's en-GB style. */
export function dayWords(day: string): string {
  if (!isDay(day)) return "--";
  return new Date(dayMs(day)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Sat 19 Sep to Thu 24 Sep", or one day. */
export function rangeWords(from: string, to: string): string {
  return from === to ? dayWords(from) : `${dayWords(from)} to ${dayWords(to)}`;
}

/** The last day of the calendar month holding `day`. */
export function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * A window's first and last Kuwait day, the same rules the mirror uses when
 * it asks B2B for the scorecard (supabase/functions/sales-mirror/lib.ts).
 * The page takes the days from the scorecard row; this is the fallback when
 * the window has no row yet.
 */
export function windowDays(
  key: WindowKey,
  nowMs: number,
): { from: string; to: string } {
  const today = kuwaitDay(nowMs);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: monthStart, to: today };
    case "last_month":
      return { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd };
    case "d30":
      return { from: addDays(today, -29), to: today };
    case "d90":
      return { from: addDays(today, -89), to: today };
  }
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

/** Working days from `fromDay` to `toDay`, both included; Friday is off. */
export function workingDays(fromDay: string, toDay: string): number {
  if (!isDay(fromDay) || !isDay(toDay) || toDay < fromDay) return 0;
  let n = 0;
  for (let t = dayMs(fromDay); t <= dayMs(toDay); t += DAY_MS)
    if (new Date(t).getUTCDay() !== FRIDAY) n += 1;
  return n;
}

/**
 * Working days of a period that have begun by `today`, today included: the
 * scorecard B2B returns already holds today's calls, so today is counted as
 * a day worked. That never overstates the pace (the CEO cockpit, whose
 * numbers stop at yesterday, stops its count at yesterday for the same
 * reason). `untilDay` caps the count at the period's last day.
 */
export function elapsedWorkingDays(
  fromDay: string,
  today: string,
  untilDay?: string,
): number {
  const end = untilDay && untilDay < today ? untilDay : today;
  return workingDays(fromDay, end);
}

/** Where the period ends at this rate: actual ÷ elapsed × total. Null before its first working day. */
export function projection(
  actual: number | null,
  elapsed: number,
  total: number,
): number | null {
  if (actual === null || !Number.isFinite(actual) || elapsed <= 0 || total <= 0)
    return null;
  if (elapsed >= total) return actual;
  return (actual / elapsed) * total;
}

export interface GoalPeriod {
  from: string;
  to: string;
  kind: "weekly" | "monthly";
}

/**
 * The period a window's goals are judged against: This week is Saturday to
 * Thursday of the week, This month and Last month the calendar month. The
 * other windows have no goal (goals are weekly and monthly).
 */
export function goalPeriod(key: WindowKey, fromDay: string): GoalPeriod | null {
  if (!isDay(fromDay)) return null;
  if (key === "week") {
    const from = weekStart(fromDay);
    return { from, to: addDays(from, 5), kind: "weekly" };
  }
  if (key === "month" || key === "last_month")
    return {
      from: `${fromDay.slice(0, 8)}01`,
      to: monthEnd(fromDay),
      kind: "monthly",
    };
  return null;
}

export type PaceTone = "good" | "warning" | "critical";

/**
 * Met once the goal is reached; on track when the projection reaches it,
 * close within 80%, behind below that. A period that is over is met or
 * missed, nothing in between.
 */
export function paceVerdict(
  actual: number | null,
  goal: number,
  projected: number | null,
  finished: boolean,
): { tone: PaceTone; label: string } | null {
  if (actual === null || !(goal > 0)) return null;
  if (actual >= goal) return { tone: "good", label: "Met" };
  if (finished) return { tone: "critical", label: "Missed" };
  if (projected === null) return null;
  if (projected >= goal) return { tone: "good", label: "On track" };
  if (projected >= 0.8 * goal) return { tone: "warning", label: "Close" };
  return { tone: "critical", label: "Behind" };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/** The goals the cockpit can score, in the order they are shown. */
export const GOAL_FIELDS: { key: GoalKey; label: string; money?: boolean }[] = [
  { key: "booked", label: "Booked" },
  { key: "shown", label: "Shown" },
  { key: "closes", label: "Closes" },
  { key: "cash", label: "Cash collected", money: true },
  { key: "dials", label: "Outbound dials" },
];

/** What each goal is scored by: the scorecard's counts, or Maqsam's outbound dials. */
export function goalActual(
  key: GoalKey,
  card: Scorecard | null,
  outboundDials: number | null,
): number | null {
  if (key === "dials") return outboundDials;
  if (!card) return null;
  if (key === "booked") return num(card.calls_scheduled);
  if (key === "shown") return num(card.calls_shown);
  if (key === "closes") return num(card.closes);
  if (key === "cash") return num(card.cash_collected);
  return null;
}

export type GoalsForm = Record<"weekly" | "monthly", Record<string, string>>;

export function goalsToForm(goals: Goals | null | undefined): GoalsForm {
  const out: GoalsForm = { weekly: {}, monthly: {} };
  for (const period of ["weekly", "monthly"] as const)
    for (const { key } of GOAL_FIELDS) {
      const v = num(goals?.[period]?.[key]);
      out[period][key] = v === null ? "" : String(v);
    }
  return out;
}

/** Amounts typed as "1,500" or "1500"; blank is "no value". */
function amount(s: string): number | null | "bad" {
  const t = String(s ?? "")
    .replace(/,/g, "")
    .trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "bad";
}

/**
 * The goals to save. A blank box is no goal. Keys the page does not edit
 * (a conversations goal, say) are kept as they were.
 */
export function goalsFromForm(
  form: GoalsForm,
  keep?: Goals | null,
): { ok: true; goals: Goals } | { ok: false; error: string } {
  const goals: Goals = {};
  for (const period of ["weekly", "monthly"] as const) {
    const row: Partial<Record<GoalKey, number>> = { ...(keep?.[period] ?? {}) };
    for (const { key, label } of GOAL_FIELDS) {
      const v = amount(form[period][key] ?? "");
      if (v === "bad" || (v !== null && (v < 0 || v > 10_000_000)))
        return {
          ok: false,
          error: `The ${period} ${label.toLowerCase()} goal must be a number of 0 or more.`,
        };
      if (v === null) delete row[key];
      else row[key] = v;
    }
    if (Object.keys(row).length) goals[period] = row;
  }
  return { ok: true, goals };
}

// ---------------------------------------------------------------------------
// Pay rules
// ---------------------------------------------------------------------------

export const CURRENCIES = [
  "USD",
  "KWD",
  "SAR",
  "AED",
  "QAR",
  "BHD",
  "OMR",
] as const;

/** Aziz's closer plan of 2026-09-24: 10% of cash collected, $250 when a client pays in full. */
export const CLOSER_PLAN = {
  cash_rate: 0.1,
  pif_bonus: 250,
  currency: "USD",
} as const;

const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/** True when the rule pays anything. `{}` (or only a currency) is "not set yet", never $0. */
export function hasPayRule(rule: PayRule | null | undefined): boolean {
  if (!rule) return false;
  return [
    rule.cash_rate,
    rule.pif_bonus,
    rule.per_intro_shown,
    rule.per_demo_shown,
    rule.per_signed,
  ].some(v => positive(v) !== null);
}

/** 0.1 as "10%", 0.075 as "7.5%". */
export function ratePercent(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}

/**
 * The rule in words, e.g. "10% of the cash collected on your contracts as it
 * is collected, plus $250 when a client pays in full". Null when no rule is set.
 */
export function payWords(
  rule: PayRule | null | undefined,
  whose: "your" | "their" = "your",
): string | null {
  if (!rule || !hasPayRule(rule)) return null;
  const cur = rule.currency || "USD";
  const who = whose === "your" ? "you" : "they";
  const parts: string[] = [];
  const rate = positive(rule.cash_rate);
  if (rate !== null)
    parts.push(
      `${ratePercent(rate)} of the cash collected on ${whose} contracts as it is collected`,
    );
  const perSigned = positive(rule.per_signed);
  if (perSigned !== null)
    parts.push(`${money(perSigned, cur)} for each client ${who} sign`);
  const perDemo = positive(rule.per_demo_shown);
  if (perDemo !== null)
    parts.push(`${money(perDemo, cur)} for each demo that shows`);
  const perIntro = positive(rule.per_intro_shown);
  if (perIntro !== null)
    parts.push(`${money(perIntro, cur)} for each intro ${who} set that shows`);
  const pif = positive(rule.pif_bonus);
  if (pif !== null) parts.push(`${money(pif, cur)} when a client pays in full`);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")}, plus ${parts[parts.length - 1]}`;
}

export interface PayForm {
  cashPct: string;
  pif: string;
  perIntro: string;
  perDemo: string;
  perSigned: string;
  currency: string;
  note: string;
}

export function payToForm(rule: PayRule | null | undefined): PayForm {
  const s = (v: unknown) => {
    const n = num(v);
    return n === null ? "" : String(n);
  };
  const rate = num(rule?.cash_rate);
  return {
    cashPct: rate === null ? "" : String(Number((rate * 100).toFixed(4))),
    pif: s(rule?.pif_bonus),
    perIntro: s(rule?.per_intro_shown),
    perDemo: s(rule?.per_demo_shown),
    perSigned: s(rule?.per_signed),
    currency: rule?.currency || "USD",
    note: rule?.note ?? "",
  };
}

/** The rule to save: the percent becomes a share (10 → 0.10), blanks are left out. */
export function payFromForm(
  f: PayForm,
): { ok: true; pay: PayRule } | { ok: false; error: string } {
  const pay: PayRule = {};
  const pct = amount(f.cashPct);
  if (pct === "bad" || (pct !== null && (pct < 0 || pct > 100)))
    return { ok: false, error: "The cash share is a percent from 0 to 100." };
  if (pct !== null) pay.cash_rate = Number((pct / 100).toFixed(6));
  const fixed: [
    keyof PayForm,
    "pif_bonus" | "per_intro_shown" | "per_demo_shown" | "per_signed",
    string,
  ][] = [
    ["pif", "pif_bonus", "The paid-in-full bonus"],
    ["perIntro", "per_intro_shown", "The amount per intro shown"],
    ["perDemo", "per_demo_shown", "The amount per demo shown"],
    ["perSigned", "per_signed", "The amount per signed client"],
  ];
  for (const [field, key, label] of fixed) {
    const v = amount(f[field]);
    if (v === "bad" || (v !== null && (v < 0 || v > 100_000)))
      return {
        ok: false,
        error: `${label} must be an amount from 0 to 100,000.`,
      };
    if (v !== null) pay[key] = v;
  }
  const cur = (f.currency || "USD").toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(cur))
    return {
      ok: false,
      error: "Pay is in USD, KWD, SAR, AED, QAR, BHD or OMR.",
    };
  pay.currency = cur;
  const note = f.note.trim();
  if (note) pay.note = note.slice(0, 500);
  return { ok: true, pay };
}

// ---------------------------------------------------------------------------
// A closer's estimate
// ---------------------------------------------------------------------------

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** The names a closer signs deals under: B2B's closer aliases and the rep's display name. */
export function closerNames(
  rep: Pick<Rep, "display_name" | "closer_aliases"> | null | undefined,
): string[] {
  if (!rep) return [];
  return [
    ...new Set(
      [...(rep.closer_aliases ?? []), rep.display_name]
        .map(norm)
        .filter(Boolean),
    ),
  ];
}

/** Whether the New Client Form's closer is one of these names, ignoring case and outer spaces. */
export function isTheirDeal(
  closer: string | null | undefined,
  names: string[],
): boolean {
  const c = norm(closer);
  return c !== "" && names.includes(c);
}

export interface DealAmounts {
  cash_collected: unknown;
  contracted_revenue: unknown;
}

export interface PayEstimate {
  deals: number;
  /** Deals missing the deposit or the contract value, so left out of what depends on it. */
  incomplete: number;
  /** Σ deposits recorded. */
  cash: number;
  /** Σ max(0, contracted − deposit): what is still to be collected. */
  owed: number;
  /** cash_rate × cash. Null when the rule has no cash share. */
  earned: number | null;
  /** cash_rate × owed, earned as it is collected. */
  later: number | null;
  paidInFull: number;
  /** pif_bonus × deals paid in full. */
  bonuses: number | null;
  /** per_signed × deals. */
  signed: number | null;
}

const cents = (x: number) => Math.round(x * 100) / 100;

/**
 * What a closer's deals earn under their rule. A deal is paid in full when
 * its deposit covers a contract worth more than zero.
 */
export function payEstimate(
  rule: PayRule | null | undefined,
  deals: DealAmounts[],
): PayEstimate {
  let cash = 0;
  let owed = 0;
  let paidInFull = 0;
  let incomplete = 0;
  for (const d of deals) {
    const c = num(d.cash_collected);
    const k = num(d.contracted_revenue);
    if (c !== null) cash += c;
    if (c === null || k === null) {
      incomplete += 1;
      continue;
    }
    owed += Math.max(0, k - c);
    if (k > 0 && c >= k) paidInFull += 1;
  }
  const rate = positive(rule?.cash_rate);
  const pif = positive(rule?.pif_bonus);
  const perSigned = positive(rule?.per_signed);
  return {
    deals: deals.length,
    incomplete,
    cash: cents(cash),
    owed: cents(owed),
    earned: rate === null ? null : cents(rate * cash),
    later: rate === null ? null : cents(rate * owed),
    paidInFull,
    bonuses: pif === null ? null : cents(pif * paidInFull),
    signed: perSigned === null ? null : cents(perSigned * deals.length),
  };
}

// ---------------------------------------------------------------------------
// The team total and the dials
// ---------------------------------------------------------------------------

const COUNTS = [
  "calls_scheduled",
  "calls_due",
  "calls_shown",
  "calls_qualified",
  "demos_scheduled",
  "demos_due",
  "demos_shown",
  "demos_qualified",
  "disqualified_count",
  "noshow_count",
  "cancelled_count",
  "closes",
] as const;

/** part ÷ whole as a percentage to one decimal, B2B's rounding; null with nothing to divide by. */
function rate1(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((1000 * part) / whole) / 10 : null;
}

/**
 * Everyone's rows as one: the counts and money summed, each rate worked out
 * again from the sums with b2b_rep_scorecard's own formulas (show, no-show
 * and disqualified rates on due calls, close rate on qualified demos,
 * average deal on closes). Averaging the people's percentages would weigh a
 * rep with two calls the same as one with two hundred. With no rows it is
 * the all-zero card.
 */
export function teamTotal(cards: Scorecard[]): Scorecard {
  const sum = (k: keyof Scorecard) =>
    cards.reduce((a, c) => a + (num(c[k]) ?? 0), 0);
  const c = Object.fromEntries(COUNTS.map(k => [k, sum(k)])) as Record<
    (typeof COUNTS)[number],
    number
  >;
  const revenue = cents(sum("revenue"));
  return {
    person_key: "team",
    display_name: "Team total",
    role: null,
    is_known: null,
    ...c,
    show_rate: rate1(c.calls_shown, c.calls_due),
    noshow_rate: rate1(c.noshow_count, c.calls_due),
    disqualified_rate: rate1(c.disqualified_count, c.calls_due),
    revenue,
    cash_collected: cents(sum("cash_collected")),
    new_mrr: cents(sum("new_mrr")),
    close_rate: rate1(c.closes, c.demos_qualified),
    avg_deal: c.closes > 0 ? Math.round(revenue / c.closes) : null,
  };
}

export interface DialStats {
  outbound: number;
  /** Outbound calls Maqsam marks completed. */
  connected: number;
  /** Seconds on the line across the connected outbound calls. */
  talkSeconds: number;
  inbound: number;
}

export function dialStats(
  dials: Pick<Dial, "direction" | "state" | "duration_s">[],
): DialStats {
  const out: DialStats = {
    outbound: 0,
    connected: 0,
    talkSeconds: 0,
    inbound: 0,
  };
  for (const d of dials) {
    const dir = norm(d.direction);
    if (dir === "outbound") {
      out.outbound += 1;
      if (norm(d.state) === "completed") {
        out.connected += 1;
        out.talkSeconds += Math.max(0, num(d.duration_s) ?? 0);
      }
    } else if (dir === "inbound") out.inbound += 1;
  }
  return out;
}
