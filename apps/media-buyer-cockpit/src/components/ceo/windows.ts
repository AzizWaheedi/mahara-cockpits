/**
 * The window a tab is looking at, and the earlier window it is compared with.
 *
 * Frontend, Marketing and Sales all read the same `growth.windows` and all
 * offer the same four choices, so the choices, their names and their pairs
 * live here once. A cost per lead on the Frontend rollup and the same cost per
 * lead on Marketing then cover the same days, whatever either tab does with it.
 */

import type { GrowthPayload } from "../../../convex/ceo/payloads";
import type { FilterOption } from "./FilterChips";
import { date, shortDate } from "./format";

export const WINDOW_KEYS = ["yesterday", "last7", "mtd", "lastMonth"] as const;

export type WindowKey = (typeof WINDOW_KEYS)[number];

export const WINDOW_LABEL: Record<WindowKey, string> = {
  yesterday: "Yesterday",
  last7: "Last 7 days",
  mtd: "Month to date",
  lastMonth: "Last month",
};

/**
 * The matching earlier window for a delta. Yesterday and last month have none
 * in the payload, so those two are shown without a comparison rather than
 * against a window that does not line up with them.
 */
export const COMPARE_WITH: Record<
  WindowKey,
  keyof GrowthPayload["windows"] | null
> = {
  yesterday: null,
  last7: "prevLast7",
  mtd: "lastMonthToDate",
  lastMonth: null,
};

/** The chip row every window picker uses, with the same tooltips on every tab. */
export const WINDOW_CHIPS: FilterOption<WindowKey>[] = WINDOW_KEYS.map(key => ({
  key,
  label: WINDOW_LABEL[key],
  hint:
    COMPARE_WITH[key] === null
      ? "Shown on its own: the payload carries no matching earlier window."
      : "Compared with the matching earlier window.",
}));

/** "Mon 14 Sep", "1 to 15 Sep" or "28 Aug to 3 Sep". */
export function range(from: string, to: string): string {
  if (from === to) return date(from);
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${Number(from.slice(8, 10))} to ${shortDate(to)}`;
  // A window that crosses a new year reads as "23 Sep to 22 Sep" without the
  // years, which is either three days or a year and nobody can tell which.
  if (from.slice(0, 4) !== to.slice(0, 4))
    return `${shortDate(from)} ${from.slice(0, 4)} to ${shortDate(to)} ${to.slice(0, 4)}`;
  return `${shortDate(from)} to ${shortDate(to)}`;
}
