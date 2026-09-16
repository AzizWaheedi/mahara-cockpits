import type { MoneyPayload } from "../../../convex/ceo/payloads";
import { count, humanize, isNum, money, pct, pct1 } from "./format";
import { Meter } from "./Meter";
import { gateTone } from "./StatusChip";

export type TargetItem = MoneyPayload["targets"]["items"][number];

/**
 * Every target from `monthly_targets` under one name, so Today, Frontend,
 * Sales and Money all call the same target the same thing. A metric with no
 * entry here falls back to its raw key as words.
 */
export const TARGET_LABELS: Record<string, string> = {
  revenue: "Contracted revenue",
  signed: "Deals signed",
  leads: "Leads",
  spend: "Lead-gen ad spend",
  cash_collected: "Cash collected",
  intros_booked: "Intros booked",
  demos_booked: "Demos booked",
  demos_shown: "Demos shown",
  close_rate: "Close rate",
  demo_show_rate: "Demo show rate",
  lead_to_demo: "Lead to demo rate",
  ctr: "Click-through rate",
  cost_per_lead: "Cost per lead",
  cost_per_intro: "Cost per intro",
  cac: "Cost per close",
};

/** The target metrics that belong to sales rather than marketing. */
export const SALES_TARGET_METRICS = [
  "signed",
  "revenue",
  "cash_collected",
  "demos_shown",
  "close_rate",
  "demo_show_rate",
] as const;

type TargetKind = {
  format: (v: number) => string;
  /** total and budget pace to month end; higher and lower compare as is. */
  judge: "total" | "budget" | "higher" | "lower";
};

// Mirrors the money adapter: rates arrive as fractions, costs and totals in
// dollars or counts. One rule for every tab, so the same target never changes
// colour from one screen to the next.
export function targetKind(metric: string): TargetKind {
  // The dashboard's funnel rates read to one decimal, as on the dashboard and
  // on the show rate, close rate and intro to demo tiles.
  if (/(show_rate|close_rate|intro_to_demo)$/.test(metric))
    return { format: pct1, judge: "higher" };
  if (/(_rate$|^ctr$|^lead_to_)/.test(metric))
    return { format: pct, judge: "higher" };
  if (/(^cost|cost$|^cp[abl]$|^cac$)/.test(metric))
    return { format: money, judge: "lower" };
  if (/(spend|budget)/.test(metric)) return { format: money, judge: "budget" };
  if (/(revenue|cash|contracted|mrr)/.test(metric))
    return { format: money, judge: "total" };
  return { format: count, judge: "total" };
}

/**
 * One target against its actual, with the pace to month end when the target
 * belongs to the running month. A null actual reads n/a, never 0.
 */
export function TargetMeter({
  item,
  dayOfMonth,
  daysInMonth,
  pace = true,
}: {
  item: TargetItem;
  dayOfMonth: number;
  daysInMonth: number;
  /** False when the target was filed for another month, so no pace is drawn. */
  pace?: boolean;
}) {
  const { format, judge } = targetKind(item.metric);
  const label = TARGET_LABELS[item.metric] ?? humanize(item.metric);
  const actual = item.actual;
  let tone: "emphasis" | "warning" | "serious" = "emphasis";
  let sub: string;

  if (!isNum(actual)) {
    sub = "The actual is not available yet.";
  } else if (judge === "total" || judge === "budget") {
    if (!pace) {
      sub = "No pace: the target is for another month.";
    } else {
      const projected =
        dayOfMonth > 0 ? (actual / dayOfMonth) * daysInMonth : 0;
      const share = item.target > 0 ? projected / item.target : null;
      sub = `On pace for ${format(projected)}${
        share !== null && judge === "total" ? `, ${pct(share)} of target` : ""
      }`;
      if (judge === "total" && share !== null)
        tone = share >= 1 ? "emphasis" : share >= 0.85 ? "warning" : "serious";
    }
  } else {
    const gate = gateTone(actual, item.target, {
      higherIsBetter: judge === "higher",
    });
    tone =
      gate === "warning"
        ? "warning"
        : gate === "serious"
          ? "serious"
          : "emphasis";
    const words =
      judge === "higher"
        ? {
            good: "At or above target",
            near: "A little under target",
            far: "Under target",
          }
        : {
            good: "At or under target",
            near: "A little over target",
            far: "Over target",
          };
    sub =
      gate === "good"
        ? words.good
        : gate === "warning"
          ? words.near
          : gate === "serious"
            ? words.far
            : "";
  }

  return (
    <Meter
      label={label}
      value={actual}
      target={item.target}
      format={format}
      tone={tone}
      sub={sub || undefined}
    />
  );
}
