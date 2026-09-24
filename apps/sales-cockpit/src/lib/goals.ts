import {
  elapsedWorkingDays,
  GOAL_FIELDS,
  goalActual,
  monthEnd,
  type PaceTone,
  paceVerdict,
  projection,
  workingDays,
} from "./pay";
import type { GoalKey, Scorecard } from "./types";

/**
 * The Goals page's arithmetic, kept pure so it can be tested: which goal is
 * in force for a month, what was done, where the pace lands, and whether
 * the month was met. Actuals are the same ones the Numbers page uses
 * (goalActual): B2B's scorecard counts, and Maqsam's outbound dials.
 */

export type GoalMetric = Exclude<GoalKey, "conversations">;
export const METRICS = GOAL_FIELDS as {
  key: GoalMetric;
  label: string;
  money?: boolean;
}[];

/** A row of cockpit_sales_goals. `month` is the month's first day. */
export interface GoalRow {
  person_key: string;
  month: string;
  metric: GoalMetric;
  goal: number | null;
  forecast: number | null;
  goal_by: string | null;
  goal_at: string | null;
  forecast_by: string | null;
  forecast_at: string | null;
}

const KUWAIT_OFFSET_MS = 3 * 3_600_000;

/** The Kuwait day holding `nowMs`, as "2026-09-24". */
export function kuwaitToday(nowMs: number): string {
  return new Date(nowMs + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-09" and the `back` months before it, newest first. */
export function monthKeys(nowMs: number, back = 11): string[] {
  const [y, m] = kuwaitToday(nowMs).split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i <= back; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** The month `n` months after "2026-09" (n may be negative). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** "September 2026". */
export function monthWords(month: string, short = false): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    month: short ? "short" : "long",
    year: "numeric",
  });
}

/**
 * The goal in force for one measure in one month: the month's own row, or
 * the standing monthly goal on the seat when the month has none. Which of
 * the two it was is returned, so the page can say so.
 */
export function goalFor(
  rows: GoalRow[],
  month: string,
  metric: GoalMetric,
  standing?: Partial<Record<GoalKey, number>> | null,
): { value: number | null; from: "month" | "standing" | null } {
  const row = rows.find(
    r => r.month.slice(0, 7) === month && r.metric === metric,
  );
  if (row && row.goal !== null && row.goal !== undefined)
    return { value: Number(row.goal), from: "month" };
  const s = standing?.[metric];
  if (typeof s === "number" && Number.isFinite(s))
    return { value: s, from: "standing" };
  return { value: null, from: null };
}

export function forecastFor(
  rows: GoalRow[],
  month: string,
  metric: GoalMetric,
): number | null {
  const row = rows.find(
    r => r.month.slice(0, 7) === month && r.metric === metric,
  );
  return row && row.forecast !== null && row.forecast !== undefined
    ? Number(row.forecast)
    : null;
}

export interface MonthLine {
  metric: GoalMetric;
  actual: number | null;
  goal: number | null;
  goalFrom: "month" | "standing" | null;
  forecast: number | null;
  /** Where this pace lands by the month's end; the actual once it is over. */
  projected: number | null;
  verdict: { tone: PaceTone; label: string } | null;
}

/**
 * One month for one person, measure by measure. `card` is that month's
 * scorecard row (null when B2B had nothing for them, which is shown as "no
 * data", never as zero); `dials` the month's outbound dials, or null when
 * the person has no Maqsam address.
 */
export function monthLines(opts: {
  month: string;
  nowMs: number;
  card: Scorecard | null;
  dials: number | null;
  rows: GoalRow[];
  standing?: Partial<Record<GoalKey, number>> | null;
}): MonthLine[] {
  const { month, nowMs, card, dials, rows, standing } = opts;
  const from = `${month}-01`;
  const to = monthEnd(from);
  const today = kuwaitToday(nowMs);
  const started = today >= from;
  const finished = today > to;
  const total = workingDays(from, to);
  const elapsed = started ? elapsedWorkingDays(from, today, to) : 0;
  return METRICS.map(({ key }) => {
    const actual = started ? goalActual(key, card, dials) : null;
    const g = goalFor(rows, month, key, standing);
    const projected = finished ? actual : projection(actual, elapsed, total);
    return {
      metric: key,
      actual,
      goal: g.value,
      goalFrom: g.from,
      forecast: forecastFor(rows, month, key),
      projected,
      verdict:
        g.value !== null
          ? paceVerdict(actual, g.value, projected, finished)
          : null,
    };
  });
}
