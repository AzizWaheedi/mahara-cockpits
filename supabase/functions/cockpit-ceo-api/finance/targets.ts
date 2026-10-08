import type { MoneyPayload, Note } from "./payloads.ts";

/**
 * The monthly targets (B2B `monthly_targets`) scored against the month to
 * date actuals, kept apart from the money adapter so the rules are tested on
 * their own (targets.test.ts).
 *
 * CTR is link CTR (the CEO, 2026-10-08): link clicks divided by impressions,
 * never CTR (all). The dashboard's window function returns both at the same
 * grain (lead-gen campaigns, month to date, in percent): `ctr` counts every
 * click and `ctr_link` only link clicks. So the `ctr` target is scored on
 * `ctr_link`. When no link CTR comes back the actual is left out, which
 * reads n/a: never 0, and never the all-clicks figure in its place.
 */

/** monthly_targets keeps these as percents; the payload wants fractions. */
export const PERCENT_METRICS = new Set([
  "close_rate",
  "ctr",
  "ctr_link",
  "demo_show_rate",
  "lead_to_demo",
]);

/** The first day the cockpit scored CTR as link CTR, Kuwait time. */
export const LINK_CTR_SINCE_MS = Date.parse("2026-10-08T00:00:00+03:00");

export type TargetRow = {
  month: string;
  metric: string;
  projection: number;
  /** When the target was last filed, epoch ms; null when unknown. */
  updatedMs: number | null;
};

type TargetItem = MoneyPayload["targets"]["items"][number];

/**
 * Scores the `ctr` target as link CTR: its actual becomes `ctr_link`, or is
 * left out when there is none. Mutates and returns `actuals`.
 */
export function scoreCtrAsLinkCtr(
  actuals: Record<string, number>,
): Record<string, number> {
  delete actuals.ctr;
  const link = actuals.ctr_link;
  if (typeof link === "number" && Number.isFinite(link)) actuals.ctr = link;
  return actuals;
}

/**
 * Each target against its actual, rates as fractions. `ctr` and `ctr_link`
 * are both link CTR now, so when both are filed only `ctr_link` is kept.
 */
export function targetItems(
  rows: Pick<TargetRow, "metric" | "projection">[],
  actuals: Record<string, number>,
): TargetItem[] {
  const hasLinkKey = rows.some(r => r.metric === "ctr_link");
  return rows
    .filter(r => !(hasLinkKey && r.metric === "ctr"))
    .map(r => {
      const pct = PERCENT_METRICS.has(r.metric) || r.metric.endsWith("_rate");
      const scale = (x: number) => (pct ? x / 100 : x);
      return {
        metric: r.metric,
        target: scale(r.projection),
        actual: r.metric in actuals ? scale(actuals[r.metric]) : null,
      };
    });
}

/**
 * What the targets card says about a CTR target: that it is scored as link
 * CTR, and, for a target filed before that, that it was set when CTR counted
 * every click, so the CEO resets it. Link CTR reads well under CTR (all):
 * 1.06% against 1.79% on lead-gen campaigns in August 2026.
 */
export function linkCtrTargetNote(
  rows: TargetRow[],
  monthName: (month: string) => string,
): Note | null {
  const ctr = rows.find(r => r.metric === "ctr");
  if (!ctr) return null;
  const scored =
    "CTR targets are scored as link CTR: link clicks divided by impressions. Not CTR (all).";
  if (ctr.updatedMs !== null && ctr.updatedMs >= LINK_CTR_SINCE_MS)
    return { level: "info", text: scored };
  return {
    level: "warn",
    text: `${scored} The ${monthName(ctr.month)} CTR target, ${ctr.projection}%, was set when CTR counted every click, so link CTR reads under it. Reset it as a link CTR figure in the B2B dashboard's monthly targets.`,
  };
}
