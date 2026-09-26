import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  copyGoalPlan,
  getGoalContext,
  readGoalsBoard,
  removeGoalTarget,
  saveGoalPlan,
  saveGoalTargets,
} from "../src/lib/ceoGoalsClient";
import { buildGoalsBoard } from "../src/lib/ceoGoalsModel";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

let db: PGlite;
let planId: number;
let targetId: number;
const founder = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const unconfirmed = "00000000-0000-4000-8000-000000000003";
const functions: Record<string, { sql: string; keys: string[] }> = {
  cockpit_ceo_goals_context: {
    sql: "SELECT public.cockpit_ceo_goals_context($1) AS result",
    keys: ["p_plan_id"],
  },
  cockpit_ceo_goal_save_plan: {
    sql: "SELECT public.cockpit_ceo_goal_save_plan($1::jsonb) AS result",
    keys: ["p_plan"],
  },
  cockpit_ceo_goal_save_targets: {
    sql: "SELECT public.cockpit_ceo_goal_save_targets($1,$2::jsonb) AS result",
    keys: ["p_plan_id", "p_targets"],
  },
  cockpit_ceo_goal_remove_target: {
    sql: "SELECT public.cockpit_ceo_goal_remove_target($1) AS result",
    keys: ["p_id"],
  },
  cockpit_ceo_goal_start_from: {
    sql: "SELECT public.cockpit_ceo_goal_start_from($1::jsonb,$2::jsonb,$3) AS result",
    keys: ["p_args", "p_baselines", "p_expected_snapshot"],
  },
};
const client = {
  async rpc(name: string, args: Record<string, unknown>) {
    const fn = functions[name];
    if (!fn) throw new Error(`Unexpected RPC: ${name}`);
    expect(Object.keys(args).sort()).toEqual([...fn.keys].sort());
    try {
      const result = await db.query<{ result: unknown }>(
        fn.sql,
        fn.keys.map(k =>
          typeof args[k] === "object" && args[k] !== null
            ? JSON.stringify(args[k])
            : args[k],
        ),
      );
      return { data: result.rows[0].result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
} as unknown as SupabaseClient;

beforeAll(async () => {
  db = await cockpitTestDb();
  // Load the actual People table dependency, excluding unrelated payroll changes.
  const people = migration("20260919b_people.sql").match(
    /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i,
  );
  expect(people).not.toBeNull();
  await db.exec(people![0]);
  for (const name of [
    "20260922e_goals_and_people.sql",
    "20260921d_cockpit_metrics.sql",
    "20260926l_cockpit_ceo_goals_access.sql",
  ])
    await db.exec(migration(name));
  await member(db, founder, "aziz@maharamedia.com", []);
  await member(db, admin, "ordinary-admin@tests.invalid", ["admin", "ceo"]);
  await member(db, unconfirmed, "awaheedi2008@gmail.com", ["ceo"], true, false);
}, 15000);
afterAll(async () => {
  await db.close();
});

test("founder creates and edits a plan, preserving omitted human fields", async () => {
  await actor(db, founder);
  const empty = await readGoalsBoard(client);
  expect(empty.plan).toBeNull();
  expect(empty.plans).toEqual([]);
  const saved = await saveGoalPlan(client, {
    periodKind: "month",
    periodFrom: "2026-09-01",
    periodTo: "2026-09-30",
    title: "September plan",
    status: "live",
    mission: "Keep this human mission",
    headline: "Keep this headline",
  });
  planId = saved.id;
  await saveGoalPlan(client, { id: planId, title: "Reviewed September plan" });
  const ctx = await getGoalContext(client, planId);
  expect(ctx.plan?.mission).toBe("Keep this human mission");
  expect(ctx.plan?.headline).toBe("Keep this headline");
  expect(ctx.plan?.created_by).toBe("aziz@maharamedia.com");
  expect(ctx.plan?.working_days).toBe(26);
});

test("targets persist zero, human notes, source labels and correct pacing", async () => {
  await actor(db, founder);
  await saveGoalTargets(client, {
    planId,
    targets: [
      {
        groupKey: "custom_team",
        metricKey: "manual_count",
        label: "Manual count",
        unit: "count",
        direction: "up",
        target: 26,
        actualManual: 0,
        baseline: 7,
        note: "Retain this note",
      },
      {
        groupKey: "custom_team",
        metricKey: "unknown",
        label: "Unmeasured",
        unit: "count",
        direction: "up",
        target: 10,
      },
      {
        groupKey: "custom_team",
        metricKey: "manual_rate",
        label: "Manual rate",
        unit: "rate",
        direction: "up",
        target: 0.5,
        actualManual: 0.3,
      },
    ],
  });
  const context = await getGoalContext(client, planId);
  targetId = context.targets.find(t => t.metric_key === "manual_count")!.id;
  await saveGoalTargets(client, {
    planId,
    targets: [{ id: targetId, target: 26 }],
  });
  const refreshed = await getGoalContext(client, planId);
  expect(refreshed.targets.find(t => t.id === targetId)?.note).toBe(
    "Retain this note",
  );
  const board = buildGoalsBoard(refreshed, "2026-09-20");
  const targets = board.groups.flatMap(g => g.targets);
  expect(targets.find(t => t.metricKey === "manual_count")).toMatchObject({
    actual: 0,
    source: "typed",
    baseline: 7,
    pacedTarget: 16,
  });
  expect(targets.find(t => t.metricKey === "unknown")).toMatchObject({
    actual: null,
    source: "none",
    onPace: null,
  });
  expect(targets.find(t => t.metricKey === "manual_rate")?.pacedTarget).toBe(
    0.5,
  );
  expect(board.catalogue.length).toBeGreaterThan(10);
});

test("invalid later target rolls back the entire batch and its audits", async () => {
  await actor(db, founder);
  await owner(db);
  const before = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.cockpit_audit_log",
    )
  ).rows[0].n;
  await actor(db, founder);
  await expect(
    saveGoalTargets(client, {
      planId,
      targets: [
        { id: targetId, target: 999 },
        { groupKey: "x", metricKey: "bad", unit: "invalid", direction: "up" },
      ],
    }),
  ).rejects.toThrow();
  expect(
    (await getGoalContext(client, planId)).targets.find(t => t.id === targetId)
      ?.target,
  ).toBe(26);
  await owner(db);
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.cockpit_audit_log",
      )
    ).rows[0].n,
  ).toBe(before);
});

test("cloning preserves notes and zero baseline, clears actuals and binds source snapshot", async () => {
  await actor(db, founder);
  const old = await getGoalContext(client, planId);
  await saveGoalTargets(client, {
    planId,
    targets: [{ id: targetId, note: "Latest human note" }],
  });
  await expect(
    db.query(
      "SELECT public.cockpit_ceo_goal_start_from($1::jsonb,'{}'::jsonb,$2)",
      [
        JSON.stringify({
          fromPlanId: planId,
          periodFrom: "2026-10-01",
          periodTo: "2026-10-31",
          title: "October plan",
        }),
        old.fingerprint,
      ],
    ),
  ).rejects.toMatchObject({ code: "40001" });
  const copied = await copyGoalPlan(client, {
    fromPlanId: planId,
    periodFrom: "2026-10-01",
    periodTo: "2026-10-31",
    title: "October plan",
  });
  expect(copied.targets).toBe(3);
  const next = await getGoalContext(client, copied.id);
  expect(next.plan?.status).toBe("draft");
  expect(next.plan?.mission).toBe("Keep this human mission");
  const row = next.targets.find(t => t.metric_key === "manual_count");
  expect(row).toMatchObject({
    baseline: 0,
    actual_manual: null,
    note: "Latest human note",
  });
  await expect(
    saveGoalTargets(client, { planId, targets: [{ id: row!.id, target: 10 }] }),
  ).rejects.toThrow("belong");
});

test("all five server operations reject admins, unconfirmed and revoked users", async () => {
  const operations = [
    "SELECT public.cockpit_ceo_goals_context(NULL)",
    "SELECT public.cockpit_ceo_goal_save_plan('{}'::jsonb)",
    "SELECT public.cockpit_ceo_goal_save_targets(1,'[]'::jsonb)",
    "SELECT public.cockpit_ceo_goal_remove_target(1)",
    "SELECT public.cockpit_ceo_goal_start_from('{}'::jsonb,'{}'::jsonb,'x')",
  ];
  for (const id of [null, admin, unconfirmed]) {
    await actor(db, id);
    for (const sql of operations)
      await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
  }
  await owner(db);
  await db.query(
    "UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1",
    [founder],
  );
  await actor(db, founder);
  for (const sql of operations)
    await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
  await owner(db);
  await db.query(
    "UPDATE public.cockpit_members SET active=true WHERE auth_user_id=$1",
    [founder],
  );
});

test("delete is audited, repeat deletion is harmless, browser writes remain closed", async () => {
  await actor(db, founder);
  await expect(
    db.query("UPDATE public.cockpit_goal_targets SET target=0"),
  ).rejects.toMatchObject({ code: "42501" });
  await removeGoalTarget(client, { id: targetId });
  await removeGoalTarget(client, { id: targetId });
  await owner(db);
  const events = await db.query<{
    before: { note: string };
    actor_email: string;
  }>(
    "SELECT before,actor_email FROM public.cockpit_audit_log WHERE entity_type='cockpit_goal_targets' AND entity_id=$1 AND action='DELETE'",
    [String(targetId)],
  );
  expect(events.rows).toHaveLength(1);
  expect(events.rows[0].before.note).toBe("Latest human note");
  expect(events.rows[0].actor_email).toBe("aziz@maharamedia.com");
  await expect(
    db.query("DELETE FROM public.cockpit_audit_log"),
  ).rejects.toThrow("immutable");
  const before = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.cockpit_audit_log",
    )
  ).rows[0].n;
  await db.exec(migration("20260926l_cockpit_ceo_goals_access.sql"));
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.cockpit_audit_log",
      )
    ).rows[0].n,
  ).toBe(before);
});

test("client rejects empty success receipts and nonfinite input", async () => {
  const empty = {
    rpc: async () => ({ data: { ok: true }, error: null }),
  } as unknown as SupabaseClient;
  await expect(readGoalsBoard(empty)).rejects.toThrow("context");
  await expect(saveGoalPlan(empty, { title: "Valid" })).rejects.toThrow("ID");
  await expect(
    saveGoalTargets(empty, { planId: 1, targets: [{ target: Number.NaN }] }),
  ).rejects.toThrow("finite");
  await expect(readGoalsBoard(null)).rejects.toThrow("Sign in");
});

test("measured actuals, including zero, come from stored section facts and carry into copies", async () => {
  await owner(db);
  await db.query(
    "INSERT INTO public.cockpit_sections(key,label,computed_at,payload) VALUES('growth','Fixture',now(),$1::jsonb)",
    [
      JSON.stringify({
        daily: [
          { date: "2026-09-01", leads: 0, spend: 10.5 },
          { date: "2026-09-19", leads: 0, spend: 0 },
        ],
      }),
    ],
  );
  await actor(db, founder);
  await saveGoalTargets(client, {
    planId,
    targets: [
      {
        groupKey: "front_end",
        metricKey: "leads",
        label: "Leads",
        unit: "count",
        direction: "up",
        target: 20,
        actualManual: 99,
      },
      {
        groupKey: "front_end",
        metricKey: "spend",
        label: "Spend",
        unit: "usd",
        direction: "down",
        target: 100,
      },
    ],
  });
  const board = buildGoalsBoard(
    await getGoalContext(client, planId),
    "2026-09-20",
  );
  expect(
    board.groups.flatMap(g => g.targets).find(t => t.metricKey === "leads"),
  ).toMatchObject({ actual: 0, source: "measured" });
  expect(
    board.groups.flatMap(g => g.targets).find(t => t.metricKey === "spend"),
  ).toMatchObject({ actual: 10.5, source: "measured" });
  const copy = await copyGoalPlan(client, {
    fromPlanId: planId,
    periodFrom: "2026-12-01",
    periodTo: "2026-12-31",
    title: "December plan",
  });
  expect(
    (await getGoalContext(client, copy.id)).targets.find(
      t => t.metric_key === "leads",
    )?.baseline,
  ).toBe(0);
});

test("actual API dispatcher calls the real goals operations and rejects unknown routes", async () => {
  mock.module("../src/lib/supabase", () => ({ supabase: client }));
  const { api } = await import("../src/lib/cockpitApi");
  await actor(db, founder);
  expect((await api.ceo.goals.board({ planId })).plan.id).toBe(planId);
  expect(
    await api.ceo.goals.savePlan({
      id: planId,
      title: "Dispatcher-tested plan",
    }),
  ).toEqual({ id: planId });
  expect(await api.ceo.goals.saveTargets({ planId, targets: [] })).toEqual({
    saved: 0,
  });
  expect(await api.ceo.goals.removeTarget({ id: 99999 })).toEqual({ ok: true });
  const copy = await api.ceo.goals.startFrom({
    fromPlanId: planId,
    periodFrom: "2027-01-01",
    periodTo: "2027-01-31",
    title: "January plan",
  });
  expect(copy.id).toBeGreaterThan(planId);
  await expect(api.ceo.goals.notImplemented({})).rejects.toThrow(
    "Unknown goals operation",
  );
  expect(api.ceo.goals.board).toBe(api.ceo.goals.board);
});
