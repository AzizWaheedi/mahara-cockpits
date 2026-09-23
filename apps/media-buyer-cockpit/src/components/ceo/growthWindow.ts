import { useMemo } from "react";
import type { FunnelWindow, GrowthPayload } from "../../../convex/ceo/payloads";
import { dailyHasStages, type Timeframe, windowFromDaily } from "./timeframe";

/**
 * The growth window a tab shows for the chosen timeframe. A preset that
 * lines up with a server window uses it (it carries the exact median, the
 * confirmed share and intro to demo); any other run of days is rebuilt from
 * the daily series. The comparison window is the run of the same length
 * just before, or the server's pair for month to date and last 7 days.
 */
export function useGrowthWindow(
  g: GrowthPayload | null,
  tf: Timeframe,
  today: string,
): {
  current: FunnelWindow | null;
  previous: FunnelWindow | null;
  bounds: { from: string; to: string } | null;
  compare: { from: string; to: string } | null;
  derived: boolean;
  first: string | null;
  last: string | null;
} {
  return useMemo(() => {
    const days = (g?.daily ?? []).filter(d => d.date < today);
    const first = days[0]?.date ?? null;
    const last = days[days.length - 1]?.date ?? null;
    if (!g || !last)
      return {
        current: null,
        previous: null,
        bounds: null,
        compare: null,
        derived: false,
        first,
        last,
      };
    const bounds = tf.bounds(last, first);
    if (!bounds)
      return {
        current: null,
        previous: null,
        bounds: null,
        compare: null,
        derived: false,
        first,
        last,
      };
    const w = g.windows;
    // Presets the server already computed, with their own comparison pair.
    if (tf.range === "mtd" && w.mtd)
      return {
        current: w.mtd,
        previous: w.lastMonthToDate ?? null,
        bounds: { from: w.mtd.from, to: w.mtd.to },
        compare: w.lastMonthToDate
          ? { from: w.lastMonthToDate.from, to: w.lastMonthToDate.to }
          : null,
        derived: false,
        first,
        last,
      };
    if (tf.range === "lastMonth" && w.lastMonth)
      return {
        current: w.lastMonth,
        previous: null,
        bounds: { from: w.lastMonth.from, to: w.lastMonth.to },
        compare: null,
        derived: false,
        first,
        last,
      };
    if (tf.range === "7d" && w.last7 && w.last7.to === last)
      return {
        current: w.last7,
        previous: w.prevLast7 ?? null,
        bounds: { from: w.last7.from, to: w.last7.to },
        compare: w.prevLast7
          ? { from: w.prevLast7.from, to: w.prevLast7.to }
          : null,
        derived: false,
        first,
        last,
      };
    if (!dailyHasStages(g.daily))
      return {
        current: w.mtd ?? null,
        previous: null,
        bounds: w.mtd ? { from: w.mtd.from, to: w.mtd.to } : null,
        compare: null,
        derived: false,
        first,
        last,
      };
    const current = windowFromDaily(g.daily, bounds.from, bounds.to);
    const span =
      Math.round(
        (Date.parse(bounds.to) - Date.parse(bounds.from)) / 86_400_000,
      ) + 1;
    const prevTo = new Date(Date.parse(bounds.from) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const prevFrom = new Date(Date.parse(prevTo) - (span - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const havePrev = first !== null && prevFrom >= first;
    const previous = havePrev
      ? windowFromDaily(g.daily, prevFrom, prevTo)
      : null;
    return {
      current,
      previous,
      bounds,
      compare: havePrev ? { from: prevFrom, to: prevTo } : null,
      derived: true,
      first,
      last,
    };
  }, [g, tf, today]);
}

export const DERIVED_NOTE =
  "Rebuilt from the daily series for these days: every count is a sum of days and every rate a quotient of sums. Speed to lead is then the mean minutes over the leads called, and intro to demo is not available.";
