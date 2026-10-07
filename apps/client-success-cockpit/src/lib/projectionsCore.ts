/**
 * Projections and the renewal window: the rules, with nothing read or written.
 *
 * The CEO's brief (2026-09-27): every week the CSM sets a blood number (the
 * floor) and a stretch number for re-sells, renewals, cash, reviews and
 * referrals, and the actual fills itself in from what was logged. Every
 * client whose contract ends in the next 60 days has a renewal plan; inside
 * 30 days a client with no proactive call booked and no "not this cycle"
 * reason is red; a renewal date that passes with the plan still "planned"
 * is a missed renewal and counts against churn.
 *
 * Kept free of Convex so the tests in scripts/projections.test.ts run the
 * same code the screen and the bridge do.
 */

import {
  type ActualFrom,
  type Fact,
  METRICS,
  type Metric,
  type RowState,
  shortDay,
  type Verdict,
  type WindowFilter,
} from "./projectionsView";

export {
  type ActualFrom,
  type Fact,
  GOLD_TARGET,
  LIKELIHOOD_LABEL,
  LIKELIHOODS,
  type Likelihood,
  METRIC_LABEL,
  METRIC_UNIT,
  METRICS,
  type Metric,
  type PlanStatus,
  RENEWAL_FIELD,
  type RowState,
  STATE_LABEL,
  STATUS_LABEL,
  STATUSES,
  shortDay,
  VERDICT_LABEL,
  type Verdict,
  type WindowFilter,
} from "./projectionsView";

/** A client enters the renewal window this many days before the date. */
export const WINDOW_DAYS = 60;
/** Inside this many days, no booked call and no reason turns the row red. */
export const RED_DAYS = 30;

/** An outcome is logged: the row has left the open window. */
export const DONE: ReadonlySet<string> = new Set([
  "renewed",
  "resold",
  "not_this_cycle",
  "lost",
]);

// --- days, Kuwait ----------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(v: unknown): v is string {
  const s = String(v ?? "");
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function kuwaitDay(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
}

/** The Sunday a Kuwait working week starts on, for any day in it. */
export function weekStartOf(day: string): string {
  return addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay());
}

export function isSunday(day: string): boolean {
  return isDay(day) && new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
}

/** The first of the month after `day`, for "next one from 1 Oct". */
export function nextMonthStart(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// --- the renewal window ------------------------------------------------------------

export function daysToRenewal(renewalDate: string, today: string): number {
  return daysBetween(today, renewalDate);
}

/** In the window from 60 days out. A passed date stays until an outcome is logged. */
export function inWindow(
  renewalDate: string | null | undefined,
  today: string,
  status?: string | null,
): boolean {
  if (!renewalDate || !isDay(renewalDate)) return false;
  const days = daysToRenewal(renewalDate, today);
  if (days > WINDOW_DAYS) return false;
  if (days < 0) return !status || !DONE.has(status);
  return true;
}

export type PlanLike = {
  status?: string | null;
  callBookedFor?: string | null;
  notThisCycleReason?: string | null;
};

const open = (p: PlanLike) => !p.status || !DONE.has(p.status);

/** Inside 30 days, no call booked, no reason: "Proactive call not booked". */
export function isRed(
  renewalDate: string,
  plan: PlanLike,
  today: string,
): boolean {
  const days = daysToRenewal(renewalDate, today);
  return (
    days >= 0 &&
    days <= RED_DAYS &&
    open(plan) &&
    !plan.callBookedFor &&
    !plan.notThisCycleReason?.trim()
  );
}

/** Past the date with the plan still "planned": a missed renewal, which counts as churn. */
export function isMissed(
  renewalDate: string,
  plan: PlanLike,
  today: string,
): boolean {
  return (
    daysToRenewal(renewalDate, today) < 0 &&
    (plan.status ?? "planned") === "planned"
  );
}

export function rowState(
  renewalDate: string,
  plan: PlanLike,
  today: string,
): RowState {
  if (!open(plan)) return "done";
  if (isMissed(renewalDate, plan, today)) return "missed";
  if (isRed(renewalDate, plan, today)) return "red";
  // A booked call whose renewal date has gone by, with no outcome written.
  if (daysToRenewal(renewalDate, today) < 0) return "outcome_due";
  if (plan.callBookedFor || plan.status === "call_booked") return "booked";
  return "planned";
}

export function filtersOf(
  renewalDate: string,
  plan: PlanLike,
  today: string,
): WindowFilter[] {
  if (!open(plan)) return ["done"];
  const out: WindowFilter[] = [
    daysToRenewal(renewalDate, today) <= RED_DAYS ? "0-30" : "31-60",
  ];
  if (plan.callBookedFor || plan.status === "call_booked") out.push("booked");
  return out;
}

const LIKELY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/**
 * The hardest open row in this week's window, for Tuesday's role play: the
 * least likely first, then the nearest date. Rows with no likelihood set
 * count as 50-50.
 */
export function hardestOf<
  T extends { renewalDate: string; likelihood?: string | null } & PlanLike,
>(rows: T[], today: string): T | null {
  const live = rows.filter(r => open(r) && inWindow(r.renewalDate, today));
  live.sort(
    (a, b) =>
      (LIKELY_RANK[a.likelihood ?? "medium"] ?? 1) -
        (LIKELY_RANK[b.likelihood ?? "medium"] ?? 1) ||
      a.renewalDate.localeCompare(b.renewalDate),
  );
  return live[0] ?? null;
}

// --- one re-sell conversation a month, only after a first win -------------------------

/**
 * The words that make a logged decision a hot-list conversation. The same
 * rule the start-of-day screen has always used (upsell, referral, review),
 * with "re-sell" added so a won re-sell counts toward the month too.
 */
export const HOT_ACTION = /upsell|re-?sell|referral|review/i;

export type DecisionLike = {
  role: string;
  day: string;
  kind: string;
  action: string;
  subject: string;
};

/** Clients who already had their one conversation this month. */
export function hotUsedThisMonth(
  decisions: DecisionLike[],
  month: string,
): Set<string> {
  return new Set(
    decisions
      .filter(
        d => d.role === "csm" && d.day.startsWith(month) && d.kind !== "left",
      )
      .filter(d => HOT_ACTION.test(d.action))
      .map(d => d.subject),
  );
}

/** The media buyer's first-win rule (its csmSync hot list): Active and live 14 days. */
export function hasFirstWin(c: {
  stage?: string | null;
  liveDays?: number | null;
  firstWin?: boolean | null;
}): boolean {
  if (typeof c.firstWin === "boolean") return c.firstWin;
  return c.stage === "Active" && (c.liveDays ?? 0) >= 14;
}

export const FIRST_WIN_NEEDED = "First win needed before a re-sell";

export type Gate = { ok: true } | { ok: false; why: string };

/** Whether an offer may be written for this client this month. */
export function resellGate(
  c: {
    name: string;
    stage?: string | null;
    liveDays?: number | null;
    firstWin?: boolean | null;
  },
  used: Set<string>,
  today: string,
): Gate {
  if (!hasFirstWin(c)) return { ok: false, why: FIRST_WIN_NEEDED };
  if (used.has(c.name))
    return {
      ok: false,
      why: `One re-sell conversation a month, and this client has had this month's. The next one opens ${shortDay(nextMonthStart(today))}.`,
    };
  return { ok: true };
}

// --- the booked call's title ------------------------------------------------------------

/** Never in the title of a call booked with a client. */
export const BANNED_TITLE = /upgrad|up-?sell|renew/i;
const BANNED_WORD = /\S*(upgrad|up-?sell|renew)\S*/gi;

/** "Results and strategy review: <client>", with any banned word taken out of the name. */
export function reviewTitle(clientName: string): string {
  const name = clientName
    .replace(BANNED_WORD, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:,.-]+|[\s:,.-]+$/g, "")
    .trim();
  const title = name
    ? `Results and strategy review: ${name}`
    : "Results and strategy review";
  assertNeutralTitle(title);
  return title;
}

export function assertNeutralTitle(title: string): void {
  if (BANNED_TITLE.test(title))
    throw new Error(
      "A call booked with a client never says upgrade, upsell or renewal in its title.",
    );
}

// --- actuals ---------------------------------------------------------------------------

export type Actual = {
  value: number | null;
  from: ActualFrom;
  note: string;
};

/**
 * The week's actual: the source's number when the source can answer, the
 * number typed in by hand when it cannot, and nothing at all (never a zero)
 * when neither exists.
 */
export function actualOf(
  source:
    | { ok: true; value: number; note: string }
    | { ok: false; note: string },
  manual: number | null | undefined,
): Actual {
  if (source.ok)
    return { value: source.value, from: "source", note: source.note };
  if (typeof manual === "number" && Number.isFinite(manual))
    return {
      value: manual,
      from: "manual",
      note: `Entered by hand. ${source.note}`,
    };
  return { value: null, from: "missing", note: `Manual entry. ${source.note}` };
}

export function verdictOf(
  p: { blood?: number | null; stretch?: number | null },
  actual: number | null,
  weekOver: boolean,
): Verdict {
  if (p.blood === null || p.blood === undefined) return "unset";
  if (actual === null) return "no_actual";
  if (p.stretch !== null && p.stretch !== undefined && actual >= p.stretch)
    return "stretch";
  if (actual >= p.blood) return "hit";
  return weekOver ? "missed" : "behind";
}

/** Which metric a won decision's action counts toward. */
export function metricOfWin(action: string): Metric | null {
  const a = action.toLowerCase();
  if (/^won(?: undone)?: re-?sell|^won(?: undone)?: upsell/.test(a))
    return "resell";
  if (/^won(?: undone)?: renewal/.test(a)) return "renewal";
  if (/^won(?: undone)?: review/.test(a)) return "review";
  if (/^won(?: undone)?: referral/.test(a)) return "referral";
  return null;
}

/** Which metric a hot-list row's type is. */
export function metricOfHotType(
  type: string | null | undefined,
): Metric | null {
  const t = String(type ?? "").toLowerCase();
  if (t.startsWith("upsell")) return "resell";
  if (t.startsWith("referral")) return "referral";
  if (t.startsWith("review")) return "review";
  return null;
}

/**
 * Wins in a week, per metric, from the decision log: every "won" counts,
 * every "won undone" (a hot-list row taken back off Closed) takes one away.
 */
export function winsInWeek(
  decisions: DecisionLike[],
  weekStart: string,
): Record<Metric, number> {
  const end = addDays(weekStart, 6);
  const out: Record<Metric, number> = {
    resell: 0,
    renewal: 0,
    cash: 0,
    review: 0,
    referral: 0,
  };
  for (const d of decisions) {
    if (d.day < weekStart || d.day > end) continue;
    if (d.kind !== "won" && d.kind !== "unwon") continue;
    const m = metricOfWin(d.action);
    if (!m) continue;
    out[m] += d.kind === "won" ? 1 : -1;
  }
  for (const m of METRICS) out[m] = Math.max(0, out[m]);
  return out;
}

export function wonAction(metric: Metric, detail?: string): string {
  const head: Record<Metric, string> = {
    resell: "Won: re-sell",
    renewal: "Won: renewal",
    cash: "Won: cash",
    review: "Won: review",
    referral: "Won: referral",
  };
  return detail ? `${head[metric]}, ${detail}` : head[metric];
}

/** One internal line for the team channel. No person named: the client is the news. */
export function celebrationLine(
  metric: Metric,
  clientName: string,
  detail?: string,
): string {
  const what =
    metric === "renewal"
      ? "renewed"
      : metric === "resell"
        ? "took a re-sell"
        : metric === "review"
          ? "left a review"
          : metric === "referral"
            ? "sent a referral"
            : "paid";
  return `Client success win: ${clientName} ${what}${detail ? ` (${detail})` : ""}.`;
}

// --- where the client is ----------------------------------------------------------------

type ClientFacts = {
  stage?: string | null;
  liveDays?: number | null;
  launchDate?: string | null;
  happiness?: string | null;
  lastCall?: string | null;
  lastReport?: string | null;
  reportTracked?: boolean | null;
  paymentDate?: string | null;
  service?: string | null;
};

type Perf = {
  month?: Record<string, number | null> | null;
  monthLabel?: string | null;
  allTime?: Record<string, number | null> | null;
  error?: string | null;
} | null;

export type Paid = {
  usd: number;
  payments: number;
  since: string | null;
  source: "ledger" | "ltv";
} | null;

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Where the client stands, one line per fact, each with where it came
 * from. Missing facts are left out rather than written as zero.
 */
export function whereTheyAre(c: ClientFacts, perf: Perf, paid: Paid): Fact[] {
  const out: Fact[] = [];
  if (c.stage)
    out.push({ label: "Stage", value: c.stage, source: "ClickUp status" });
  if (typeof c.liveDays === "number" && c.launchDate)
    out.push({
      label: "Live",
      value: `${c.liveDays} days, since ${shortDay(c.launchDate)}`,
      source: "ClickUp launch date",
    });
  if (c.happiness)
    out.push({
      label: "Happiness",
      value: c.happiness,
      source: "ClickUp happiness",
    });
  if (c.service)
    out.push({ label: "Service", value: c.service, source: "ClickUp service" });
  const month = perf?.month ?? null;
  const label = perf?.monthLabel ? ` (${perf.monthLabel})` : " this month";
  const sheet = "the client's performance sheet";
  if (month && !perf?.error) {
    if (typeof month.leads === "number")
      out.push({
        label: `Leads${label}`,
        value: String(month.leads),
        source: sheet,
      });
    if (typeof month.booked === "number")
      out.push({
        label: `Booked${label}`,
        value: String(month.booked),
        source: sheet,
      });
    if (typeof month.closes === "number")
      out.push({
        label: `Closes${label}`,
        value: String(month.closes),
        source: sheet,
      });
  }
  const all = perf?.allTime ?? null;
  if (all && !perf?.error && typeof all.closes === "number")
    out.push({
      label: "Closes since launch",
      value: String(all.closes),
      source: sheet,
    });
  if (c.lastCall)
    out.push({
      label: "Last call",
      value: shortDay(c.lastCall),
      source: "ClickUp last call",
    });
  if (c.reportTracked && c.lastReport)
    out.push({
      label: "Last report sent",
      value: shortDay(c.lastReport),
      source: "ClickUp last report sent",
    });
  if (paid)
    out.push({
      label: "Paid so far",
      value: usd(paid.usd),
      source:
        paid.source === "ledger"
          ? `billing ledger, ${paid.payments} payment${paid.payments === 1 ? "" : "s"}${paid.since ? ` since ${shortDay(paid.since)}` : ""}`
          : "the LTV field on the ClickUp card",
    });
  if (c.paymentDate)
    out.push({
      label: "Next payment",
      value: shortDay(c.paymentDate),
      source: "ClickUp next payment",
    });
  return out;
}
