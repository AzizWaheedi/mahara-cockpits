import { addDays } from "../../convex/ceo/time";
import type { PlanRow, TargetRow } from "../types/ceo/goals";
import {
  GROUPS,
  METRIC_BY_KEY,
  METRICS,
  type Payloads,
  scoreboard,
  seriesBounds,
  type Unit,
} from "../types/ceo/scoreboard";

export type GoalContext = {
  plan: Record<string, any> | null;
  plans: Record<string, any>[];
  targets: Record<string, any>[];
  payloads: Payloads;
  scorecardsDone: number | null;
  fingerprint: string;
  today: string;
};
const WORKING = new Set([6, 0, 1, 2, 3, 4]);
function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) {
    if (WORKING.has(new Date(t).getUTCDay())) n += 1;
  }
  return n;
}

function toPlan(r: Record<string, any>): PlanRow {
  const from = String(r.period_from);
  const to = String(r.period_to);
  return {
    id: Number(r.id),
    periodKind: r.period_kind,
    periodFrom: from,
    periodTo: to,
    title: String(r.title ?? ""),
    mission: r.mission ? String(r.mission) : null,
    headline: r.headline ? String(r.headline) : null,
    status: r.status,
    workingDays:
      r.working_days == null
        ? workingDaysBetween(from, to)
        : Number(r.working_days),
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Whether a target accumulates over the period.
 *
 * A count of leads does; a cost per lead does not, and neither does a rate, a
 * multiple, an average, a headcount or a per-day figure. Pacing one of those
 * would judge a $10 cost per lead against $7.31 three quarters of the way
 * through the month, which is not a target anybody set.
 */
function isLevel(unit: Unit, metricKey: string): boolean {
  if (unit === "rate" || unit === "x") return true;
  return METRIC_BY_KEY[metricKey]?.level === true;
}

// The existing goal pacing and scoring calculation, fed by the secured SQL context.
export function buildGoalsBoard(context: GoalContext, today = context.today) {
  const all = context.plans;
  const plans = all.map(r => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    status: String(r.status),
  }));

  const row = context.plan;
  const p = context.payloads;
  const bounds = seriesBounds(p);
  if (!row)
    return {
      plan: null,
      plans,
      pace: null,
      groups: [],
      behind: [],
      catalogue: METRICS,
      bounds,
    };

  const plan = toPlan(row);
  // Numbers run to the newest complete day, never to today, so a plan is
  // never judged on a day that is still happening: a morning's spend
  // against a whole day's target reads as a collapse every morning.
  const yesterday = addDays(today, -1);
  const through = [plan.periodTo, yesterday, bounds.last ?? yesterday]
    .filter(Boolean)
    .sort()[0] as string;
  const worked = Math.min(
    plan.workingDays,
    through >= plan.periodFrom
      ? workingDaysBetween(plan.periodFrom, through)
      : 0,
  );
  const share = plan.workingDays > 0 ? worked / plan.workingDays : 0;
  const measured = scoreboard(p, plan.periodFrom, through);
  // The one number the goals tables can answer themselves: how many
  // one-to-ones were actually held and signed off in the period.
  if (plan.periodFrom.slice(0, 7) === plan.periodTo.slice(0, 7)) {
    if (context.scorecardsDone !== null)
      measured.scorecardsDone = context.scorecardsDone;
  }

  const targetRows = context.targets;

  const targets: TargetRow[] = targetRows.map(t => {
    const key = String(t.metric_key);
    const def = METRIC_BY_KEY[key];
    const unit = (t.unit ?? def?.unit ?? "count") as Unit;
    const direction = (t.direction ?? def?.direction ?? "up") as "up" | "down";
    const target = t.target === null ? null : Number(t.target);
    const manualActual =
      t.actual_manual === null || t.actual_manual === undefined
        ? null
        : Number(t.actual_manual);
    const fromCockpit = measured[key];
    const actual =
      fromCockpit !== undefined
        ? r2(fromCockpit)
        : manualActual !== null
          ? r2(manualActual)
          : null;
    const source: TargetRow["source"] =
      fromCockpit !== undefined
        ? "measured"
        : manualActual !== null
          ? "typed"
          : "none";
    const level = isLevel(unit, key);
    const pacedTarget =
      target === null ? null : level ? target : r2(target * share);
    const onPace =
      actual === null || pacedTarget === null
        ? null
        : direction === "up"
          ? actual >= pacedTarget
          : actual <= pacedTarget;
    // The bar always reads the same way: fuller is better. For a number we
    // want up that is the share of the target reached; for a cost or a
    // churn rate it is how far under the ceiling we are, so a bar at a
    // third means a cost three times what it should be.
    const progress =
      target === null || actual === null || target === 0
        ? null
        : direction === "up"
          ? Math.max(0, Math.min(1, r2(actual / target)))
          : actual <= 0
            ? 1
            : Math.max(0, Math.min(1, r2(target / actual)));
    return {
      id: Number(t.id),
      groupKey: String(t.group_key),
      metricKey: key,
      label: String(t.label ?? def?.label ?? key),
      unit,
      direction,
      target,
      stretch: t.stretch === null ? null : Number(t.stretch),
      baseline: t.baseline === null ? null : Number(t.baseline),
      note: t.note ? String(t.note) : null,
      sort: Number(t.sort ?? 0),
      level,
      source,
      sourceText:
        source === "measured"
          ? (def?.source ??
            "Read from the cockpit's own numbers for these days.")
          : source === "typed"
            ? "Typed in: nothing in the cockpit measures this yet."
            : "Nothing recorded for this yet.",
      actual,
      pacedTarget,
      onPace,
      progress,
    };
  });

  const byGroup = new Map<string, TargetRow[]>();
  for (const t of targets) {
    const list = byGroup.get(t.groupKey) ?? [];
    list.push(t);
    byGroup.set(t.groupKey, list);
  }
  const known = new Map(GROUPS.map(g => [g.key as string, g]));
  const groups = [...byGroup.entries()]
    .map(([key, list]) => ({
      key,
      label: known.get(key)?.label ?? key,
      blurb: known.get(key)?.blurb ?? "",
      targets: list,
    }))
    .sort((x, y) => {
      const order = GROUPS.map(g => g.key as string);
      const a = order.indexOf(x.key);
      const b = order.indexOf(y.key);
      return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
    });

  const behind = targets
    .filter(t => t.onPace === false)
    .map(t => ({
      label: t.label,
      actual: t.actual,
      pacedTarget: t.pacedTarget,
      gap:
        t.pacedTarget && t.actual !== null && t.pacedTarget !== 0
          ? Math.abs(t.actual - t.pacedTarget) / Math.abs(t.pacedTarget)
          : 0,
    }))
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 5)
    .map(({ label, actual, pacedTarget }) => ({
      label,
      actual,
      pacedTarget,
    }));

  return {
    plan,
    plans,
    pace: {
      workingDays: plan.workingDays,
      workedSoFar: worked,
      daysLeft: Math.max(0, plan.workingDays - worked),
      share: r2(share),
      through,
    },
    groups,
    behind,
    catalogue: METRICS,
    bounds,
  };
}
