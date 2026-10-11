import type { RangeKey } from "./chartKit";
import { month as monthName, shortDate } from "./format";
import type { Timeframe } from "./timeframe";
import { range as rangeText } from "./windows";

/**
 * The window one tab's timeframe bar picked, in the words its cards use
 * (A127/A170, Aziz 2026-09-21 and 09-22: "any number with a time dimension
 * gets the same timeframe control as the charts … This goes across the whole
 * CEO cockpit."). Pure, so it is tested without a browser
 * (scripts/ceo-fixes-screens.test.ts).
 */
export type TabWindow = {
  range: RangeKey;
  /** Inclusive Kuwait days. */
  from: string;
  to: string;
  /** "1 to 10 Oct", for a sentence. */
  label: string;
  /** "7d", "30d", "MTD", "Sep", "1–10 Oct", for a column head or a small label. */
  short: string;
};

const SHORT: Partial<Record<RangeKey, string>> = {
  "7d": "7d",
  "30d": "30d",
  mtd: "MTD",
  "90d": "90d",
  "6m": "6m",
  "12m": "12m",
  all: "all",
};

export function tabWindow(
  range: RangeKey,
  bounds: { from: string; to: string } | null,
): TabWindow | null {
  if (!bounds) return null;
  const { from, to } = bounds;
  const short =
    range === "lastMonth"
      ? monthName(from)
      : (SHORT[range] ??
        (from === to
          ? shortDate(from)
          : from.slice(0, 7) === to.slice(0, 7)
            ? `${Number(from.slice(8, 10))}–${shortDate(to)}`
            : `${shortDate(from)}–${shortDate(to)}`));
  return { range, from, to, label: rangeText(from, to), short };
}

export const inWindow = (date: string, w: { from: string; to: string }) =>
  date >= w.from && date <= w.to;

/**
 * A field summed over the rows inside the window. null when there are no
 * rows to read (the series is not kept), never 0: missing is never zero.
 */
export function sumIn<T extends { date: string }>(
  rows: T[] | null | undefined,
  w: { from: string; to: string },
  pick: (r: T) => number | null | undefined,
): number | null {
  if (!Array.isArray(rows)) return null;
  let total = 0;
  for (const r of rows)
    if (inWindow(r.date, w)) {
      const v = pick(r);
      if (typeof v === "number" && Number.isFinite(v)) total += v;
    }
  return Math.round(total * 100) / 100;
}

const DAY = 86_400_000;
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The run of days of the same length just before the window, for a delta. */
export function previousOf(w: { from: string; to: string }): {
  from: string;
  to: string;
} {
  const span = Math.round((Date.parse(w.to) - Date.parse(w.from)) / DAY) + 1;
  const to = addDays(w.from, -1);
  return { from: addDays(to, -(span - 1)), to };
}

/** The series starts after the window does, so its sums cover fewer days than chosen. */
export function startsLate(
  first: string | null | undefined,
  w: { from: string },
): boolean {
  return Boolean(first && first > w.from);
}

/**
 * The days a tab's bar covers when the tab also shows the server's own
 * month-to-date figures: "This month" runs through today, as those figures
 * do (and as Sales and Frontend say it, "1 to 11 Oct, compared with 1 to 11
 * Sep"); every other preset ends yesterday, the last whole day. A bar that
 * stopped at yesterday would name other days than the numbers under it, and
 * on the 1st would read all of last month.
 */
export function tabBounds(
  tf: Pick<Timeframe, "range" | "bounds">,
  today: string,
  first: string | null,
): { from: string; to: string } | null {
  return tf.range === "mtd"
    ? { from: `${today.slice(0, 7)}-01`, to: today }
    : tf.bounds(addDays(today, -1), first);
}
