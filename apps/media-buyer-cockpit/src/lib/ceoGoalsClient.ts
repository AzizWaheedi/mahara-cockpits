import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSheet, type SheetData } from "../pages/ceo/goalsSheetData";
import { parseCallCenterReport } from "../types/ceo/callCenterContract";
import type { Board } from "../types/ceo/goals";
import { GROUPS, METRICS } from "../types/ceo/scoreboard";
import { addDays } from "../types/ceo/time";
import { costsSummary, getCostsContext, payOrNull } from "./ceoCostsClient";
import { readGoalSheet, type SheetContext } from "./ceoGoalSheetClient";
import { buildGoalsBoard, type GoalContext } from "./ceoGoalsModel";

function positiveId(id: unknown): asserts id is number {
  if (!Number.isSafeInteger(id) || Number(id) <= 0)
    throw new Error("Invalid goal ID");
}

function finiteFields(value: Record<string, unknown>) {
  for (const v of Object.values(value)) {
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Goal numbers must be finite");
  }
}

async function rpc(
  client: SupabaseClient | null,
  name: string,
  args: Record<string, unknown>,
) {
  if (!client) throw new Error("Sign in before changing goals");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || "Goals operation failed");
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Unrecognized goals response");
  return data;
}

export async function getGoalContext(
  client: SupabaseClient | null,
  planId?: number,
): Promise<GoalContext> {
  if (planId !== undefined) positiveId(planId);
  const data = await rpc(client, "cockpit_ceo_goals_context", {
    p_plan_id: planId ?? null,
  });
  if (
    !Array.isArray(data.plans) ||
    !Array.isArray(data.targets) ||
    !data.payloads ||
    typeof data.payloads !== "object" ||
    Array.isArray(data.payloads) ||
    typeof data.fingerprint !== "string" ||
    !/^[a-f0-9]{32}$/.test(data.fingerprint) ||
    typeof data.today !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.today) ||
    !(
      data.scorecardsDone === null ||
      (Number.isInteger(data.scorecardsDone) && data.scorecardsDone >= 0)
    )
  ) {
    throw new Error("Unrecognized goals context");
  }
  if (data.plan !== null) {
    positiveId(data.plan?.id);
    if (planId !== undefined && data.plan.id !== planId)
      throw new Error("Wrong plan returned");
  } else if (planId !== undefined || data.targets.length)
    throw new Error("Plan no longer exists");
  return data as GoalContext;
}

/**
 * The call centre's two reads, kept on the board so the quiet re-read after a
 * sheet save can hand them back (2026-11-02): a typed cell never changes the
 * call centre's numbers, and the report is the slow read.
 */
export type BoardCalls = {
  /** The sheet's month and its report by day, read over the sheet's own days on `today`; null when it failed. */
  month: string;
  today: string;
  daily: SheetContext["callDaily"];
  /** Lead to booking client by client over the plan's days, most leads first; null when it failed. */
  from: string;
  to: string;
  clients: Board["callClients"];
};

/** Lead to booking client by client over exactly the plan's days: a window's own distinct counts. */
async function readClients(
  client: SupabaseClient | null,
  from: string,
  to: string,
): Promise<Board["callClients"]> {
  try {
    const report = parseCallCenterReport(
      await rpc(client, "cockpit_ceo_call_center_report", {
        p_from: from,
        p_to: to,
      }),
      from,
      to,
    );
    return report.clients
      .filter(c => c.leads > 0)
      .map(c => ({
        name: c.name,
        leads: c.leads,
        bookings: c.confirmedBookings,
        rate: c.confirmedBookings / c.leads,
      }))
      .sort((a, b) => b.leads - a.leads);
  } catch {
    // Unreadable call data is missing, never a zero.
    return null;
  }
}

/** A failed read's reason, short, for the sentence beside the rows it leaves missing. */
function reasonOf(e: unknown): string {
  return String(e instanceof Error ? e.message : e)
    .replace(/\.$/, "")
    .slice(0, 200);
}

/**
 * The plan month's Goals sheet, read exactly as the sheet below reads it
 * (2026-11-02, truth/SYNTHESIS.md fix 3: the board reads the sheet's own
 * roll-up), beside the call report over the plan's days for the client list.
 * The sheet reads its call report over its own days on purpose: a day's
 * bookings can depend on the days asked for (a reschedule is not a second
 * booking inside them), so a report over other days could differ by a call.
 * A plan over more than one month, one with no finished day yet, or a sheet
 * that cannot be read leaves `sheet` null and says why.
 */
async function readPlanMonth(
  client: SupabaseClient | null,
  context: GoalContext,
  reuse: BoardCalls | null,
): Promise<{
  sheet: SheetData | null;
  why: string | null;
  calls: BoardCalls | null;
}> {
  const from = String(context.plan?.period_from);
  const to = String(context.plan?.period_to);
  const month = from.slice(0, 7);
  if (to.slice(0, 7) !== month)
    return {
      sheet: null,
      why: "This plan runs over more than one month and the Goals sheet reads one month at a time, so this reads missing here. Open each month on the sheet above.",
      calls: null,
    };
  // The sheet's newest complete day: yesterday, inside the plan.
  const through = [to, addDays(context.today, -1)].sort()[0];
  if (through < from) return { sheet: null, why: null, calls: null };
  // The sheet's report runs to today, so it is handed back only on the same day.
  const daily =
    reuse?.month === month && reuse.today === context.today
      ? reuse.daily
      : null;
  const [clients, read] = await Promise.all([
    reuse?.from === from && reuse.to === through && reuse.clients
      ? Promise.resolve(reuse.clients)
      : readClients(client, from, through),
    readGoalSheet(client, {
      month,
      // Undefined reads the report again; only a report that was read is handed back.
      callDaily: daily ?? undefined,
    }).then(
      ctx => ({ ctx, error: null }),
      (e: unknown) => ({ ctx: null, error: reasonOf(e) }),
    ),
  ]);
  const calls: BoardCalls = {
    month,
    today: context.today,
    daily: read.ctx?.callDaily ?? null,
    from,
    to: through,
    clients,
  };
  if (!read.ctx)
    return {
      sheet: null,
      why: `The Goals sheet could not be read (${read.error}), so this reads missing. Reload the page to try again.`,
      calls,
    };
  try {
    return { sheet: buildSheet(read.ctx), why: null, calls };
  } catch (e) {
    return {
      sheet: null,
      why: `The Goals sheet could not be worked out (${reasonOf(e)}), so this reads missing. Reload the page to try again.`,
      calls,
    };
  }
}

export async function readGoalsBoard(
  client: SupabaseClient | null,
  args: {
    planId?: number;
    /** The board's last call reads: each reused only when it covers the same days. */
    calls?: BoardCalls | null;
  } = {},
): Promise<Board & { calls: BoardCalls | null }> {
  const context = await getGoalContext(client, args.planId);
  // The same payroll the Costs page shows: the roster, commission and each
  // person's latest approved pay-plan parts (PAY-PLANS.md 8.7).
  const costs = Promise.all([getCostsContext(client), payOrNull(client)])
    .then(([c, pay]) => costsSummary(c, pay))
    .catch(() => null);
  let calls: BoardCalls | null = null;
  if (context.plan) {
    const month = await readPlanMonth(client, context, args.calls ?? null);
    context.sheet = month.sheet;
    context.sheetWhy = month.why;
    calls = month.calls;
    context.callClients = calls?.clients ?? null;
  }
  context.costs = await costs;
  return { ...buildGoalsBoard(context), calls };
}

export async function saveGoalPlan(
  client: SupabaseClient | null,
  plan: Record<string, unknown>,
) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan))
    throw new Error("Invalid plan");
  finiteFields(plan);
  if (plan.id !== undefined) positiveId(plan.id);
  const result = await rpc(client, "cockpit_ceo_goal_save_plan", {
    p_plan: plan,
  });
  positiveId(result.id);
  return { id: result.id as number };
}

export async function saveGoalTargets(
  client: SupabaseClient | null,
  args: { planId: number; targets: Record<string, unknown>[] },
) {
  positiveId(args.planId);
  if (!Array.isArray(args.targets)) throw new Error("Invalid target list");
  for (const target of args.targets) {
    if (!target || typeof target !== "object" || Array.isArray(target))
      throw new Error("Invalid target");
    finiteFields(target);
    if (target.id !== undefined) positiveId(target.id);
  }
  const result = await rpc(client, "cockpit_ceo_goal_save_targets", {
    p_plan_id: args.planId,
    p_targets: args.targets,
  });
  if (result.saved !== args.targets.length)
    throw new Error("Target save was not fully confirmed");
  return { saved: result.saved as number };
}

export async function removeGoalTarget(
  client: SupabaseClient | null,
  args: { id: number },
) {
  positiveId(args.id);
  const result = await rpc(client, "cockpit_ceo_goal_remove_target", {
    p_id: args.id,
  });
  if (result.ok !== true) throw new Error("Target removal was not confirmed");
  return { ok: true as const };
}

export async function copyGoalPlan(
  client: SupabaseClient | null,
  args: {
    fromPlanId: number;
    periodFrom: string;
    periodTo: string;
    title: string;
  },
) {
  positiveId(args.fromPlanId);
  const context = await getGoalContext(client, args.fromPlanId);
  if (!context.plan) throw new Error("No plan to start from");
  // The board's own numbers, the sheet's for every key it has (2026-11-02),
  // so a new plan's "Was" is what the board showed. The server binds this
  // edit to the unchanged source snapshot and validates every baseline.
  const month = await readPlanMonth(client, context, null);
  const baselines = buildGoalsBoard({
    ...context,
    sheet: month.sheet,
    sheetWhy: month.why,
  }).measured;
  const result = await rpc(client, "cockpit_ceo_goal_start_from", {
    p_args: args,
    p_baselines: baselines,
    p_expected_snapshot: context.fingerprint,
  });
  positiveId(result.id);
  if (result.targets !== context.targets.length)
    throw new Error("Copied targets were not fully confirmed");
  return { id: result.id as number, targets: result.targets as number };
}

export async function goalCatalogue(client: SupabaseClient | null) {
  await getGoalContext(client); // Server authorization also applies to this action.
  return { groups: GROUPS, metrics: METRICS };
}
