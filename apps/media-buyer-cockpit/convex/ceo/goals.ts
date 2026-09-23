import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { rest } from "./sbWrite";
import {
  GROUPS,
  type GroupKey,
  METRIC_BY_KEY,
  METRICS,
  type Payloads,
  scoreboard,
  seriesBounds,
  type Unit,
} from "./scoreboard";
import { addDays, kuwaitDay } from "./time";

/**
 * The plan for a period, and how far through it we are.
 *
 * Aziz, 2026-09-22: "I need to make sure that I can easily put goals for each
 * department of the team and front-end and back-end goals for the company...
 * Make sure there's a goals section I can put for a specific timeframe or a
 * month or something."
 *
 * A plan is a list of targets. Each target names the metric that scores it,
 * so the plan is marked against the numbers the rest of the cockpit already
 * shows (`scoreboard.ts`) instead of anybody retyping a figure into a second
 * place. A target the cockpit cannot measure is still allowed and says so.
 *
 * Pace is the point of the screen. A target is a number for the whole period,
 * and what matters on the nineteenth of the month is whether the run rate
 * gets there. So a counted target carries `pacedTarget` — the share of it the
 * working days so far should have produced — and a rate target does not,
 * because a rate does not accumulate. Being behind on pace is the only thing
 * on the screen that gets a colour.
 */

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows
type Any = Record<string, any>;

const PLANS = "cockpit_goal_plans";
const TARGETS = "cockpit_goal_targets";

/** Saturday to Thursday, the way Mahara works (Friday off). */
const WORKING = new Set([6, 0, 1, 2, 3, 4]);

export type PlanRow = {
  id: number;
  periodKind: "month" | "quarter" | "custom";
  periodFrom: string;
  periodTo: string;
  title: string;
  mission: string | null;
  headline: string | null;
  status: "draft" | "live" | "closed";
  workingDays: number;
};

export type TargetRow = {
  id: number;
  groupKey: string;
  metricKey: string;
  label: string;
  unit: Unit;
  direction: "up" | "down";
  target: number | null;
  stretch: number | null;
  baseline: number | null;
  note: string | null;
  sort: number;
  /** Where the actual came from. */
  source: "measured" | "typed" | "none";
  sourceText: string;
  actual: number | null;
  /** What the days worked so far should have produced. Null for a rate. */
  pacedTarget: number | null;
  /** True when the number does not accumulate, so it has no pace mark. */
  level: boolean;
  /** Null when there is no target or no actual to judge it by. */
  onPace: boolean | null;
  /** actual ÷ target, clamped for the bar. Null when either is missing. */
  progress: number | null;
};

export type Board = {
  plan: PlanRow | null;
  plans: {
    id: number;
    title: string;
    periodFrom: string;
    periodTo: string;
    status: string;
  }[];
  /** The days the plan covers and how far into it we are. */
  pace: {
    workingDays: number;
    workedSoFar: number;
    daysLeft: number;
    share: number;
    /** The last day the numbers cover, which is yesterday, not today. */
    through: string;
  } | null;
  groups: {
    key: string;
    label: string;
    blurb: string;
    targets: TargetRow[];
  }[];
  /** Targets that are behind pace, worst first, for the one-line verdict. */
  behind: {
    label: string;
    actual: number | null;
    pacedTarget: number | null;
  }[];
  /** Metrics that can be added to the plan, for the editor. */
  catalogue: typeof METRICS;
  bounds: { first: string | null; last: string | null };
};

function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) {
    if (WORKING.has(new Date(t).getUTCDay())) n += 1;
  }
  return n;
}

function toPlan(r: Any): PlanRow {
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
    workingDays: Number(r.working_days) || workingDaysBetween(from, to),
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

export const record = internalMutation({
  args: { what: v.string(), rowId: v.string(), after: v.any(), by: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: "goals.save",
      table: "cockpit_goal_plans",
      rowId: a.rowId,
      what: a.what,
      before: {},
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

async function payloads(ctx: {
  // biome-ignore lint/suspicious/noExplicitAny: action ctx
  runQuery: any;
}): Promise<Payloads> {
  const p = await ctx.runQuery(internal.ceo.store.payloadsFor, {
    keys: ["growth", "money", "delivery", "organic"],
  });
  return p as Payloads;
}

async function livePlan(planId?: number): Promise<Any | null> {
  if (planId) {
    const rows = await rest(`${PLANS}?id=eq.${planId}&select=*`);
    return rows?.[0] ?? null;
  }
  const today = kuwaitDay();
  // The plan whose period we are inside; failing that, the newest one.
  const inside = await rest(
    `${PLANS}?period_from=lte.${today}&period_to=gte.${today}&status=neq.draft&order=period_from.desc&limit=1&select=*`,
  );
  if (inside?.[0]) return inside[0];
  const any = await rest(`${PLANS}?order=period_from.desc&limit=1&select=*`);
  return any?.[0] ?? null;
}

/**
 * The whole screen for one plan. Kept out of the action so the scheduled
 * mirror and the harness can build the same board without a signed-in user.
 */
export async function buildBoard(
  // biome-ignore lint/suspicious/noExplicitAny: action ctx
  ctx: { runQuery: any },
  planId?: number,
): Promise<Board> {
  {
    const a = { planId };
    const all =
      (await rest(
        `${PLANS}?select=id,title,period_from,period_to,status&order=period_from.desc&limit=48`,
      )) ?? [];
    const plans = all.map(r => ({
      id: Number(r.id),
      title: String(r.title ?? ""),
      periodFrom: String(r.period_from),
      periodTo: String(r.period_to),
      status: String(r.status),
    }));

    const row = await livePlan(a.planId);
    const p = await payloads(ctx);
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
    const yesterday = addDays(kuwaitDay(), -1);
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
      const done = await rest(
        `cockpit_scorecards?month=eq.${plan.periodFrom.slice(0, 7)}&status=eq.final&select=id`,
      );
      if (done) measured.scorecardsDone = done.length;
    }

    const targetRows =
      (await rest(
        `${TARGETS}?plan_id=eq.${plan.id}&select=*&order=group_key,sort,id`,
      )) ?? [];

    const targets: TargetRow[] = targetRows.map(t => {
      const key = String(t.metric_key);
      const def = METRIC_BY_KEY[key];
      const unit = (t.unit ?? def?.unit ?? "count") as Unit;
      const direction = (t.direction ?? def?.direction ?? "up") as
        | "up"
        | "down";
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
}

export const board = authenticatedAction({
  args: { planId: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<Board> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    return buildBoard(ctx, a.planId);
  },
});

export const savePlan = authenticatedAction({
  args: {
    id: v.optional(v.number()),
    periodKind: v.union(
      v.literal("month"),
      v.literal("quarter"),
      v.literal("custom"),
    ),
    periodFrom: v.string(),
    periodTo: v.string(),
    title: v.string(),
    mission: v.optional(v.string()),
    headline: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("live"), v.literal("closed")),
    workingDays: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ id: number }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (!DAY.test(a.periodFrom) || !DAY.test(a.periodTo))
      throw new Error("A plan needs a first and a last day.");
    if (a.periodTo < a.periodFrom)
      throw new Error("The first day has to come before the last.");
    const title = a.title.trim();
    if (title.length < 3) throw new Error("Give the plan a name.");
    const body = {
      period_kind: a.periodKind,
      period_from: a.periodFrom,
      period_to: a.periodTo,
      title,
      mission: a.mission?.trim() || null,
      headline: a.headline?.trim() || null,
      status: a.status,
      working_days:
        a.workingDays && a.workingDays > 0
          ? Math.round(a.workingDays)
          : workingDaysBetween(a.periodFrom, a.periodTo),
      created_by: by,
      updated_at: new Date().toISOString(),
    };
    const rows = a.id
      ? await rest(`${PLANS}?id=eq.${a.id}`, {
          method: "PATCH",
          body,
          prefer: "return=representation",
        })
      : await rest(PLANS, {
          method: "POST",
          body,
          prefer: "return=representation",
        });
    const id = Number(rows?.[0]?.id);
    if (!id) throw new Error("Supabase did not return the plan.");
    await ctx.runMutation(internal.ceo.goals.record, {
      what: `${a.id ? "Changed" : "Wrote"} the plan "${title}" for ${a.periodFrom} to ${a.periodTo}`,
      rowId: String(id),
      after: body,
      by,
    });
    return { id };
  },
});

export const saveTargets = authenticatedAction({
  args: {
    planId: v.number(),
    targets: v.array(
      v.object({
        id: v.optional(v.number()),
        groupKey: v.string(),
        metricKey: v.string(),
        label: v.string(),
        unit: v.string(),
        direction: v.string(),
        target: v.optional(v.number()),
        stretch: v.optional(v.number()),
        baseline: v.optional(v.number()),
        actualManual: v.optional(v.number()),
        note: v.optional(v.string()),
        sort: v.optional(v.number()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ saved: number }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    if (!a.targets.length) return { saved: 0 };
    const body = a.targets.map((t, i) => ({
      ...(t.id ? { id: t.id } : {}),
      plan_id: a.planId,
      group_key: t.groupKey,
      metric_key: t.metricKey,
      label: t.label.trim() || t.metricKey,
      unit: t.unit,
      direction: t.direction,
      target: t.target ?? null,
      stretch: t.stretch ?? null,
      baseline: t.baseline ?? null,
      actual_manual: t.actualManual ?? null,
      note: t.note?.trim() || null,
      sort: t.sort ?? i,
    }));
    await rest(`${TARGETS}?on_conflict=plan_id,group_key,metric_key`, {
      method: "POST",
      body,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    await ctx.runMutation(internal.ceo.goals.record, {
      what: `Set ${body.length} ${body.length === 1 ? "target" : "targets"} on plan ${a.planId}`,
      rowId: String(a.planId),
      after: { keys: body.map(x => `${x.group_key}.${x.metric_key}`) },
      by,
    });
    return { saved: body.length };
  },
});

export const removeTarget = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    await rest(`${TARGETS}?id=eq.${a.id}`, { method: "DELETE" });
    await ctx.runMutation(internal.ceo.goals.record, {
      what: `Took target ${a.id} off its plan`,
      rowId: String(a.id),
      after: {},
      by,
    });
    return { ok: true };
  },
});

/**
 * Start a period from the one before it: the same targets, the same shape,
 * with last period's actuals carried in as the new baselines. A plan is a
 * conversation with the month before it, not a blank page.
 */
export const startFrom = authenticatedAction({
  args: {
    fromPlanId: v.number(),
    periodFrom: v.string(),
    periodTo: v.string(),
    title: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ id: number; targets: number }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const source = (await rest(`${PLANS}?id=eq.${a.fromPlanId}&select=*`))?.[0];
    if (!source) throw new Error("No plan to start from.");
    const old = toPlan(source);
    const p = await payloads(ctx);
    const wasActual = scoreboard(p, old.periodFrom, old.periodTo);

    const made = await rest(PLANS, {
      method: "POST",
      body: {
        period_kind: old.periodKind,
        period_from: a.periodFrom,
        period_to: a.periodTo,
        title: a.title.trim() || `${old.title} (next)`,
        mission: old.mission,
        headline: null,
        status: "draft",
        working_days: workingDaysBetween(a.periodFrom, a.periodTo),
        created_by: by,
      },
      prefer: "return=representation",
    });
    const id = Number(made?.[0]?.id);
    if (!id) throw new Error("Supabase did not return the new plan.");

    const rows =
      (await rest(`${TARGETS}?plan_id=eq.${a.fromPlanId}&select=*`)) ?? [];
    const copies = rows.map(t => ({
      plan_id: id,
      group_key: t.group_key,
      metric_key: t.metric_key,
      label: t.label,
      unit: t.unit,
      direction: t.direction,
      target: t.target,
      stretch: t.stretch,
      // Last period's real number becomes this period's baseline, so the
      // change is visible on the row instead of in somebody's memory.
      baseline:
        wasActual[String(t.metric_key)] ?? t.actual_manual ?? t.baseline,
      actual_manual: null,
      note: t.note,
      sort: t.sort,
    }));
    if (copies.length)
      await rest(TARGETS, {
        method: "POST",
        body: copies,
        prefer: "return=minimal",
      });
    await ctx.runMutation(internal.ceo.goals.record, {
      what: `Started "${a.title}" from the plan before it, with ${copies.length} targets`,
      rowId: String(id),
      after: { from: a.fromPlanId, targets: copies.length },
      by,
    });
    return { id, targets: copies.length };
  },
});

/** The groups and the metric catalogue, for the plan editor. */
export const catalogue = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (
    ctx,
  ): Promise<{ groups: typeof GROUPS; metrics: typeof METRICS }> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    return { groups: GROUPS, metrics: METRICS };
  },
});

export type { GroupKey };
