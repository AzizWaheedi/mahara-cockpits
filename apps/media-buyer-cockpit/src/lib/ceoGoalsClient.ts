import type { SupabaseClient } from "@supabase/supabase-js";
import { GROUPS, METRICS, scoreboard } from "../types/ceo/scoreboard";
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

export async function readGoalsBoard(
  client: SupabaseClient | null,
  args: { planId?: number } = {},
) {
  return buildGoalsBoard(await getGoalContext(client, args.planId));
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
  // Same pure calculation used by the board. The server binds this edit to the
  // unchanged source snapshot and validates all supplied baseline numbers.
  const baselines = scoreboard(
    context.payloads,
    context.plan.period_from,
    context.plan.period_to,
  );
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
