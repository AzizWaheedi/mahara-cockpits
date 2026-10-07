import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCostsSheet, costsSummary, getCostsContext, readCostsSheet, removeCostLine, saveCostLine } from "../src/lib/ceoCostsClient";
import { readPeople, savePerson, setPersonPay } from "../src/lib/ceoPeopleClient";
import { getGoalContext, saveGoalPlan, saveGoalTargets } from "../src/lib/ceoGoalsClient";
import { payroll } from "../src/types/ceo/costsModel";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

let db: PGlite;
const founder = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const functions: Record<string, { sql: string; keys: string[] }> = {
  cockpit_ceo_costs_context: { sql: "select cockpit_ceo_costs_context() as result", keys: [] },
  cockpit_ceo_cost_save: { sql: "select cockpit_ceo_cost_save($1::jsonb) as result", keys: ["p_patch"] },
  cockpit_ceo_cost_remove: { sql: "select cockpit_ceo_cost_remove($1) as result", keys: ["p_id"] },
  cockpit_ceo_people_set_pay: { sql: "select cockpit_ceo_people_set_pay($1::jsonb) as result", keys: ["p_patch"] },
  cockpit_ceo_people_save: { sql: "select cockpit_ceo_people_save($1::jsonb) as result", keys: ["p_patch"] },
  cockpit_ceo_people_list: { sql: "select cockpit_ceo_people_list() as result", keys: [] },
  cockpit_ceo_goal_save_plan: { sql: "select cockpit_ceo_goal_save_plan($1::jsonb) as result", keys: ["p_plan"] },
  cockpit_ceo_goal_save_targets: { sql: "select cockpit_ceo_goal_save_targets($1,$2::jsonb) as result", keys: ["p_plan_id", "p_targets"] },
  cockpit_ceo_goals_context: { sql: "select cockpit_ceo_goals_context($1) as result", keys: ["p_plan_id"] },
};
const client = { async rpc(name: string, args: Record<string, unknown> = {}) {
  const fn = functions[name];
  if (!fn) throw new Error(`Unexpected RPC ${name}`);
  try {
    const result = await db.query<{ result: unknown }>(fn.sql, fn.keys.map(k =>
      typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
}} as unknown as SupabaseClient;

beforeAll(async () => {
  db = await cockpitTestDb();
  const core = migration("20260919_cockpit_core.sql");
  for (const pattern of [
    /create table if not exists public\.cockpit_payroll_months \([\s\S]*?\n\);/i,
    /create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i,
  ]) {
    const found = core.match(pattern);
    if (!found) throw new Error("Missing canonical payroll fixture");
    await db.exec(found[0]);
  }
  for (const file of [
    "20260919b_people.sql", "20260920a_people_commission.sql", "20260921b_people_schedule.sql",
    "20260922c_people_paused.sql", "20260922d_people_bot_engagement.sql", "20260927c_cockpit_people_access.sql",
    "20260922e_goals_and_people.sql", "20260921d_cockpit_metrics.sql", "20260926l_cockpit_ceo_goals_access.sql",
    "20260921c_bank_statements.sql", "20261002a_cost_lines.sql", "20261004b_cockpit_ceo_costs_goals.sql",
  ]) await db.exec(migration(file));
  await member(db, founder, "aziz@maharamedia.com", []);
  await member(db, admin, "admin@tests.invalid", ["admin", "ceo"]);
}, 20000);
afterAll(async () => { await db.close(); });

test("software saves preserve omitted fields, price by seat, audit changes and keep missing statements missing", async () => {
  await actor(db, founder);
  const saved = await saveCostLine(client, { kind: "software", name: "Seats", seats: 3, unitPrice: 25, note: "Human note" });
  await saveCostLine(client, { id: saved.line.id, seats: 4 });
  let sheet = await readCostsSheet(client);
  expect(sheet.lines.find(l => l.id === saved.line.id)).toMatchObject({ seats: 4, unitPrice: 25, note: "Human note" });
  expect(costsSummary(await getCostsContext(client)).softwareUsd).toBe(100);
  expect(sheet.statements).toBeNull();
  await expect(saveCostLine(client, { id: saved.line.id, unitPrice: -1 })).rejects.toThrow();
  await expect(saveCostLine(client, { id: saved.line.id, seats: Number.NaN })).rejects.toThrow();
  await removeCostLine(client, { id: saved.line.id });
  sheet = await readCostsSheet(client);
  expect(sheet.lines.find(l => l.id === saved.line.id)).toBeUndefined();
  await owner(db);
  const audit = await db.query<{ action: string }>("select action from cockpit_audit_log where entity_type='cockpit_cost_lines' and entity_id=$1 order by created_at,id", [String(saved.line.id)]);
  expect(audit.rows.map(r => r.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
});

test("drafts with identical days deduplicate and payroll responds to projections using only working people", async () => {
  await actor(db, founder);
  const input = { periodKind: "month", periodFrom: "2099-10-01", periodTo: "2099-10-31", title: "October", status: "draft", mission: "Keep mission" };
  const first = await saveGoalPlan(client, input);
  const again = await saveGoalPlan(client, { ...input, title: "Reviewed October" });
  expect(again.id).toBe(first.id);
  await saveGoalTargets(client, { planId: first.id, targets: [
    { groupKey: "front_end", metricKey: "newCash", target: 100000 },
  ] });
  const person = await savePerson(client, { name: "Closer", monthlyCost: 1000, commissionBasis: "closed_cash", commissionRate: 0.1, note: "Preserved" });
  await savePerson(client, { name: "Paused", monthlyCost: 500, pausedOn: "2026-10-01" });
  await savePerson(client, { name: "Bot", engagement: "bot" });
  await setPersonPay(client, { id: person.id, commissionBasis: "set_cash" });
  const kept = (await readPeople(client)).people.find(p => p.id === person.id);
  expect(kept).toMatchObject({ monthlyCost: 1000, note: "Preserved", commission: { basis: "set_cash", rate: 0.1 } });
  const sheet = await readCostsSheet(client, { planId: first.id });
  expect(sheet.people.map(p => p.name)).toEqual(["Closer"]);
  expect(payroll(sheet.people, sheet.projection, sheet.usdPer, { money: String, count: String }).total).toBe(11000);
  await setPersonPay(client, { id: person.id, monthlyCost: 0, commissionRate: null });
  expect((await readPeople(client)).people.find(p => p.id === person.id)).toMatchObject({ monthlyCost: 0, commission: { rate: null } });
  const source = await getGoalContext(client, first.id);
  await saveGoalPlan(client, { id: first.id, headline: "New human edit" });
  await expect(db.query("select cockpit_ceo_goal_start_from($1::jsonb,'{}'::jsonb,$2)", [
    JSON.stringify({ fromPlanId: first.id, periodFrom: "2099-11-01", periodTo: "2099-11-30", title: "November" }), source.fingerprint,
  ])).rejects.toMatchObject({ code: "40001" });
});

test("cost and pay endpoints reject anonymous, non-founder and revoked seats on the server", async () => {
  const queries = ["select cockpit_ceo_costs_context()", "select cockpit_ceo_cost_save('{}'::jsonb)",
    "select cockpit_ceo_cost_remove(1)", "select cockpit_ceo_people_set_pay('{}'::jsonb)"];
  for (const who of [null, admin]) {
    await actor(db, who);
    for (const sql of queries) await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
  }
  await owner(db);
  await db.query("update cockpit_members set active=false where auth_user_id=$1", [founder]);
  await actor(db, founder);
  for (const sql of queries) await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
  await expect(db.query("select * from cockpit_cost_lines")).rejects.toMatchObject({ code: "42501" });
  await expect(db.query("select cockpit_ceo_goal_save_plan_fields('{}'::jsonb)")).rejects.toMatchObject({ code: "42501" });
  await owner(db);
  await db.query("update cockpit_members set active=true where auth_user_id=$1", [founder]);
});

test("unknown currency stays unpriced and missing plan numbers do not become payroll commission zero", async () => {
  await actor(db, founder);
  await saveCostLine(client, { kind: "software", name: "Unknown FX", seats: 2, unitPrice: 100, currency: "XYZ" });
  const context = await getCostsContext(client);
  expect(costsSummary(context).unpriced).toEqual(["Unknown FX"]);
  const empty = buildCostsSheet({ ...context, plans: [], targets: [], bank: null });
  expect(empty.projection.newCash).toBeNull();
  const pay = payroll(empty.people, empty.projection, empty.usdPer, { money: String, count: String });
  expect(pay.unpriced).toContain("Closer");
  expect(empty.statements).toBeNull();
});
