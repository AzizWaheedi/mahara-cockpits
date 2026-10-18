// Pay plans core (supabase/migrations/20261018a_ceo_pay_plans.sql), PAY-PLANS.md section 9.
// PGlite with Supabase's default privileges. The four facts functions of 20261018b are stubbed
// with SQL functions that return made-up facts of the shapes in sections 4 and 5.2.
// Made-up people, clients and ids only; the CEO gate is pointed at a made-up address.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN, actor, CEO, call, hoursTestDb, MEMBER, owner, service } from "./lib/hoursTestDb";
import { migration } from "./lib/cockpitTestDb";

const CEO_EMAIL = "ceo@example.test";
const SEP = "2026-09-01", OCT = "2026-10-01", NOV = "2026-11-01", DEC = "2026-12-01";
let db: PGlite;
const ids: Record<string, number> = {};

const TABLES = ["cockpit_pay_plans", "cockpit_pay_entries", "cockpit_pay_confirmations", "cockpit_pay_months",
  "cockpit_commission_history", "cockpit_role_history"];
const SEQUENCES = ["cockpit_pay_plans_id_seq", "cockpit_pay_entries_id_seq", "cockpit_pay_confirmations_id_seq", "cockpit_pay_months_id_seq"];
const CEO_RPCS = ["cockpit_ceo_pay_plans_list()", "cockpit_ceo_pay_month('2026-09-01')", "cockpit_ceo_pay_costs()",
  ...["plan_save", "entry_save", "entry_void", "none_rest", "confirm", "month_approve", "month_withdraw"].map(n => `cockpit_ceo_pay_${n}('{}'::jsonb)`)];
const INTERNALS = ["cockpit_pay_compute('2026-09-01')", "cockpit_pay_plan_for(1,'2026-09-01')", "cockpit_pay_people_in('2026-09-01')",
  "cockpit_pay_plan_check('{}'::jsonb,true)", "cockpit_pay_band_pick('[]'::jsonb,1)", "cockpit_pay_last_approved(1)",
  "cockpit_pay_settle_day('2026-09-01')", "cockpit_pay_person(1,'2026-09-01','{}'::jsonb,'2026-10-05')"];

const PLANS: Record<string, unknown> = {
  "Media buyer": { version: 1, parts: [{ key: "cpl_bonus", kind: "band", label: "Bonus by cost per lead", metric: "cpl", covers: "all_clients",
    bands: [{ upTo: 8, inclusive: false, amount: 400 }, { upTo: 10, inclusive: false, amount: 300 }, { upTo: 13, inclusive: false, amount: 200 },
      { upTo: 15, inclusive: true, amount: 100 }, { upTo: null, amount: 0 }] }] },
  "Call centre agent": { version: 1, parts: [], commission: [{ basis: "per_client_appt_shown", rate: 5 }, { basis: "per_client_deal_closed", rate: 20 }] },
};
const MB_BANDS = (PLANS["Media buyer"] as { parts: { bands: unknown[] }[] }).parts[0].bands;
const CSM_BANDS = [{ upTo: 0, inclusive: true, amount: 2000 }, { upTo: 5, inclusive: false, amount: 1500 }, { upTo: 9, inclusive: false, amount: 1000 },
  { upTo: 11, inclusive: false, amount: 500 }, { upTo: 13, inclusive: false, amount: 250 }, { upTo: 15, inclusive: true, amount: 0 }, { upTo: null, amount: -250 }];

async function ceo(fn: string, p: unknown) { await actor(db, CEO); return call(db, fn, p) as Promise<any>; }
async function month(m: string): Promise<any> {
  await actor(db, CEO);
  return (await db.query<{ r: any }>("SELECT public.cockpit_ceo_pay_month($1::date) r", [m])).rows[0].r;
}
const one = (mo: any, name: string) => mo.people.find((p: any) => p.name === name);
const part = (p: any, key: string) => p.parts.find((x: any) => x.key === key);
async function today(d: string) { await owner(db); await db.query("SELECT set_config('test.today',$1,false)", [d]); }
async function facts(kind: string, m: string, body: unknown, ex = 0, fail = false) {
  await owner(db);
  await db.query(`INSERT INTO public.test_pay_facts(kind,month,ex,body,fail) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (kind,month,ex) DO UPDATE SET body=EXCLUDED.body, fail=EXCLUDED.fail`, [kind, m, ex, JSON.stringify(body), fail]);
}
async function person(name: string, extra: Record<string, unknown>) {
  const r = await ceo("cockpit_ceo_people_save", { name, startedOn: "2026-01-01", currency: "USD", ...extra });
  ids[name] = Number(r.id);
  return ids[name];
}
async function plan(p: Record<string, unknown>) { return ceo("cockpit_ceo_pay_plan_save", p); }
async function confirm(p: Record<string, unknown>) { return ceo("cockpit_ceo_pay_confirm", p); }
async function sqlAsOwner<T = any>(sql: string, params: unknown[] = []) { await owner(db); return (await db.query<T>(sql, params)).rows; }

beforeAll(async () => {
  db = await hoursTestDb();
  await owner(db);
  // The CEO gate, pointed at a made-up confirmed address instead of the real ones.
  const gate = migration("20260923m_cockpit_ceo_gate.sql").replace(/IN \(\s*'[^']+',\s*'[^']+'\s*\)/, `IN ('${CEO_EMAIL}')`);
  if (!gate.includes(CEO_EMAIL)) throw new Error("gate fixture not patched");
  await db.exec(gate);
  await db.query("UPDATE auth.users SET email=$1 WHERE id=$2", [CEO_EMAIL, CEO]);
  await db.query("UPDATE public.cockpit_members SET email=$1 WHERE auth_user_id=$2", [CEO_EMAIL, CEO]);
  // Kuwait today, steerable from the test.
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_hours_kw_today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS
    $$ SELECT coalesce(nullif(current_setting('test.today', true),'')::date, (pg_catalog.now() AT TIME ZONE 'Asia/Kuwait')::date) $$;`);
  await today("2026-08-20");
  await db.exec(migration("20261011d_ceo_commission_two_lines.sql"));
  // Saved before the migration: the seed must give them history from 2026-01-01.
  await person("Seeded One", { role: "General VA", monthlyCost: 300 });
  await owner(db);
  await db.exec(migration("20261018a_ceo_pay_plans.sql"));
  // Stub facts (20261018b): made-up bodies per kind and month, or a failure.
  await db.exec(`
    CREATE TABLE public.test_pay_facts(kind text NOT NULL, month date NOT NULL, ex int NOT NULL DEFAULT 0, body jsonb, fail boolean NOT NULL DEFAULT false,
      PRIMARY KEY (kind, month, ex));
    CREATE FUNCTION public.test_pay_fact(p_kind text, p_month date, p_ex int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE r public.test_pay_facts;
    BEGIN
      SELECT * INTO r FROM public.test_pay_facts t WHERE t.kind=p_kind AND t.month=date_trunc('month',p_month)::date AND t.ex=coalesce(p_ex,0);
      IF FOUND AND r.fail THEN RAISE EXCEPTION 'stub % unavailable', p_kind; END IF;
      RETURN coalesce(r.body, CASE p_kind
        WHEN 'calls' THEN '{"agents":[],"unattributed":{"due":0,"shows":0,"items":[]},"scorecard":null}'::jsonb
        WHEN 'ads' THEN '{"clients":[],"pooled":{"clients":0,"leads":0,"cpl":null,"bookings":0,"cpb":null,"outOfCpl":[],"outOfCpb":[]}}'::jsonb
        WHEN 'clients' THEN '{"logo":{"startSet":[],"lost":[],"candidates":[],"notInStart":[],"proposal":null},"byCsm":[],"ownedCreative":[]}'::jsonb
        ELSE '{"cashThrough":"2026-10-01T06:00:00Z","ledgerReady":true,"deals":[],"people":[],"unkeyed":[]}'::jsonb END);
    END $$;
    CREATE FUNCTION public.cockpit_pay_facts_calls(p_from date, p_to date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
      $$ SELECT public.test_pay_fact('calls',p_from,0) $$;
    CREATE FUNCTION public.cockpit_pay_facts_ads(p_from date, p_to date, p_exclude_days integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
      $$ SELECT public.test_pay_fact('ads',p_from,p_exclude_days) $$;
    CREATE FUNCTION public.cockpit_pay_facts_clients(p_month date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
      $$ SELECT public.test_pay_fact('clients',p_month,0) $$;
    CREATE FUNCTION public.cockpit_pay_facts_sales(p_from date, p_to date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
      $$ SELECT public.test_pay_fact('sales',p_from,0) $$;
    REVOKE ALL ON public.test_pay_facts FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON FUNCTION public.test_pay_fact(text,date,int), public.cockpit_pay_facts_calls(date,date), public.cockpit_pay_facts_ads(date,date,integer),
      public.cockpit_pay_facts_clients(date), public.cockpit_pay_facts_sales(date,date) FROM PUBLIC, anon, authenticated, service_role;`);

  const shown = { commissionBasis: "per_client_appt_shown", commissionRate: 5, commission2Basis: "per_client_deal_closed", commission2Rate: 20 };
  await person("Agent One", { role: "Call centre agent", monthlyCost: 650, email: "agent1@example.test", ...shown });
  await person("Agent Two", { role: "Call centre agent", monthlyCost: 650, email: "agent2@example.test", ...shown });
  await person("Agent Three", { role: "Call centre agent", monthlyCost: 650, commissionBasis: "other", commissionNote: "Made-up note" });
  await person("Leaver One", { role: "Call centre agent", monthlyCost: 650, email: "leaver1@example.test", ...shown });
  await person("Buyer One", { role: "Media buyer", monthlyCost: 700 });
  await person("Strategist One", { role: "Creative strategist", monthlyCost: 750 });
  await person("Success One", { role: "Client success manager", monthlyCost: 800 });
  await person("Systems One", { role: "Systems manager", monthlyCost: 1000 });
  await person("Closer One", { role: "Closer", commissionBasis: "closed_cash", commissionRate: 0.1, commission2Basis: "set_cash", commission2Rate: 0.05 });
  await person("Editor One", { role: "Video editor", monthlyCost: 600 });
  await person("Founder One", { role: "CEO" });
  await today("2026-09-20");
  await ceo("cockpit_ceo_people_save", { id: ids["Leaver One"], active: false, endedOn: "2026-09-12" });

  // September role plans for the call centre and the media buyer.
  for (const role of ["Call centre agent", "Media buyer"]) await plan({ role, fromMonth: SEP, plan: PLANS[role], note: "September" });

  // Made-up facts.
  await facts("calls", SEP, {
    from: SEP, to: "2026-09-30", agents: [
      { email: "agent1@example.test", personId: ids["Agent One"], name: "Agent One", due: 31, shows: 27, noShows: 3, unmarked: 1, booked: 40,
        showsBy: { console: 20, central: 5, sheet: 2 }, showIds: ["appt-s01", "appt-s02", "appt-s03"],
        closes: [
          { appointmentId: "appt-c1", locationId: "loc-a", client: "Client A", contactId: "ct-1", meetingAt: "2026-09-10T10:00:00+03:00", evidence: "portal", value: null, currency: null },
          { appointmentId: "appt-c1b", locationId: "loc-a", client: "Client A", contactId: "ct-1", meetingAt: "2026-09-12T10:00:00+03:00", evidence: "sheet", value: null, currency: null },
          { appointmentId: "appt-c2", locationId: "loc-b", client: "Client B", contactId: "ct-2", meetingAt: "2026-09-15T10:00:00+03:00", evidence: "sheet", value: null, currency: null }] },
      { email: "leaver1@example.test", personId: ids["Leaver One"], name: "Leaver One", due: 5, shows: 4, noShows: 1, unmarked: 0, booked: 6, showIds: ["appt-l1"], closes: [] }],
    unattributed: { due: 2, shows: 2, items: [] }, scorecard: null, scorecardNote: "Made-up stub",
  });
  await facts("ads", OCT, {
    from: OCT, to: "2026-10-31", clients: [
      { clickupId: "cu-a", name: "Client A", spendUsd: 900, leadSpendUsd: 800, nonLeadSpendUsd: 100, leads: 60, bookings: 10, notMeasured: { cpl: null, cpb: null } },
      { clickupId: "cu-b", name: "Client B", spendUsd: 600, leadSpendUsd: 445, nonLeadSpendUsd: 155, leads: 40, bookings: 5, notMeasured: { cpl: null, cpb: null } },
      { clickupId: "cu-c", name: "Client C", spendUsd: 45, leadSpendUsd: 0, nonLeadSpendUsd: 45, leads: 0, bookings: 0, notMeasured: { cpl: "1 unpriced spend row", cpb: null } }],
    pooled: { clients: 2, leadSpendUsd: 1245, nonLeadSpendUsd: 300, leads: 100, cpl: 12.45, spendUsd: 1545, bookings: 15, cpb: 103, cpbClients: 3,
      outOfCpl: [{ clickupId: "cu-c", name: "Client C", why: "1 unpriced spend row" }], outOfCpb: [] },
  });
  // The strategist's guarded read (14 days left out after each creative start): three owned clients.
  await facts("ads", OCT, {
    from: OCT, to: "2026-10-31", excludeDays: 14, clients: ["cu-a", "cu-b", "cu-d"].map((k, i) => ({ clickupId: k, name: `Client ${"ABD"[i]}`,
      spendUsd: 700, leadSpendUsd: 600, leads: 50, bookings: 5, after: { spendUsd: 500, leadSpendUsd: 450, leads: 40, bookings: 4 }, notMeasured: { cpl: null, cpb: null } })),
    pooled: { clients: 3, leads: 150, cpl: 12, bookings: 15, cpb: 140 },
  }, 14);
  for (const m of [OCT, NOV]) await facts("clients", m, {
    month: m, logo: { startSet: [], lost: [], candidates: [], notInStart: [], proposal: null },
    byCsm: [{ personId: ids["Success One"], name: "Success One", startSet: [{ clickupId: "cu-a" }, { clickupId: "cu-b" }], lost: [], candidates: [],
      proposal: { lost: 0, activeAtStart: 2, pct: 0 }, qualifying: { upperBound: 7, clients: [{ clickupId: "cu-a" }], paymentNotChecked: 0 } }],
    ownedCreative: [{ personId: ids["Strategist One"], name: "Strategist One", clients: [{ clickupId: "cu-a", name: "Client A" }], others: [] }],
  });
  await facts("sales", OCT, {
    from: OCT, to: "2026-10-31", cashThrough: "2026-10-18T06:00:00Z", ledgerReady: true, deals: [
      { responseId: "resp-1", signedDay: "2026-10-05", business: "Client E", contracted: 6000, closer: { name: "Closer One", personId: ids["Closer One"] },
        setter: { name: "Closer One", personId: ids["Closer One"], source: "form", disagree: false },
        payments: [{ paymentId: "whop:pay_made_up_1", rail: "whop", day: "2026-10-06", usd: 6000, matchedBy: "email" }], cashInMonth: 6000, cashToDate: 6000,
        pif: { state: "earned", day: "2026-10-06", shortUsd: 0 } },
      { responseId: "resp-2", signedDay: "2026-10-08", business: "Client F", contracted: 6000, closer: { name: "Closer One", personId: ids["Closer One"] },
        setter: { name: "Someone", personId: null, source: "form", disagree: false },
        payments: [{ paymentId: "tap:chg_made_up_2", rail: "tap", day: "2026-10-09", usd: 2750, matchedBy: "ceo" }], cashInMonth: 2750, cashToDate: 2750,
        pif: { state: "no", day: null, shortUsd: 3250 } }],
    people: [{ personId: ids["Closer One"], closedCashUsd: 8750, setCashUsd: 6000, setWaiting: [], pifDeals: ["resp-1"], pifWaiting: [] }], unkeyed: [],
  });
}, 120000);
afterAll(async () => { await db.close(); });

describe("access", () => {
  test("anon, a member, a non-CEO admin and a revoked CEO get 42501 on every RPC", async () => {
    await owner(db);
    await db.query("UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1", [CEO]);
    for (const who of [null, MEMBER, ADMIN, CEO]) {
      await actor(db, who);
      for (const sql of CEO_RPCS) await expect(db.query(`SELECT public.${sql}`)).rejects.toMatchObject({ code: "42501" });
    }
    await owner(db);
    await db.query("UPDATE public.cockpit_members SET active=true WHERE auth_user_id=$1", [CEO]);
    await actor(db, CEO);
    await expect(db.query("SELECT public.cockpit_ceo_pay_plans_list()")).resolves.toBeTruthy();
  });

  test("tables, sequences and internals are out of reach of browser roles; service_role only reads", async () => {
    for (const who of [null, CEO]) {
      await actor(db, who);
      for (const t of TABLES) await expect(db.query(`SELECT * FROM public.${t} LIMIT 1`)).rejects.toMatchObject({ code: "42501" });
      for (const f of INTERNALS) await expect(db.query(`SELECT public.${f}`)).rejects.toMatchObject({ code: "42501" });
    }
    await service(db);
    for (const t of TABLES) await expect(db.query(`SELECT * FROM public.${t} LIMIT 1`)).resolves.toBeTruthy();
    await expect(db.query("INSERT INTO public.cockpit_pay_confirmations(month,key,value,set_by) VALUES('2026-09-01','logo_churn','{}','x')")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("DELETE FROM public.cockpit_pay_plans")).rejects.toMatchObject({ code: "42501" });
    for (const f of INTERNALS) await expect(db.query(`SELECT public.${f}`)).rejects.toMatchObject({ code: "42501" });
    for (const s of SEQUENCES) await expect(db.query(`SELECT nextval('public.${s}')`)).rejects.toMatchObject({ code: "42501" });
    const rows = await sqlAsOwner<{ t: string; r: string; w: boolean; sel: boolean }>(`
      SELECT t, r, has_table_privilege(r, 'public.'||t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') w, has_table_privilege(r, 'public.'||t, 'SELECT') sel
      FROM unnest($1::text[]) t CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r`, [TABLES]);
    for (const x of rows) { expect(x.w).toBe(false); expect(x.sel).toBe(x.r === "service_role"); }
    const seq = await sqlAsOwner<{ ok: boolean }>(`SELECT bool_or(has_sequence_privilege(r, 'public.'||s, 'USAGE,SELECT,UPDATE')) ok
      FROM unnest($1::text[]) s CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r`, [SEQUENCES]);
    expect(seq[0].ok).toBe(false);
    const fns = await sqlAsOwner<{ proname: string; acl: string }>(`SELECT p.proname, coalesce(array_to_string(p.proacl, ','),'') acl FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'cockpit_pay\\_%' OR p.proname LIKE 'cockpit_ceo_pay\\_%')
        AND p.proname NOT LIKE 'cockpit_pay_facts\\_%'`);
    expect(fns.length).toBeGreaterThan(30);
    for (const f of fns) {
      expect(f.acl).not.toContain("anon=");
      expect(f.acl).not.toContain("service_role=");
      expect(f.acl).not.toMatch(/(^|,)=X/);
      if (f.proname.startsWith("cockpit_ceo_pay_")) expect(f.acl).toContain("authenticated=X");
      else expect(f.acl).not.toContain("authenticated=");
    }
  });
});

describe("history of lines and role", () => {
  test("the migration seeds every person's current lines and role from 2026-01-01", async () => {
    const h = await sqlAsOwner("SELECT from_month::text f, basis FROM public.cockpit_commission_history WHERE person_id=$1", [ids["Seeded One"]]);
    expect(h).toEqual([{ f: "2026-01-01", basis: "none" }]);
    const r = await sqlAsOwner("SELECT from_month::text f, role FROM public.cockpit_role_history WHERE person_id=$1", [ids["Seeded One"]]);
    expect(r).toEqual([{ f: "2026-01-01", role: "General VA" }]);
  });

  test("a change is dated to the 1st of the Kuwait month, so a past month keeps its lines and role", async () => {
    await today("2026-10-05");
    await ceo("cockpit_ceo_people_save", { id: ids["Agent Two"], role: "Media buyer", commissionBasis: "none", commission2Basis: null });
    await owner(db);
    const at = async (m: string) => (await db.query<any>("SELECT public.cockpit_pay_role_at($1,$2) r, (SELECT basis FROM public.cockpit_pay_lines_at($1,$2)) b",
      [ids["Agent Two"], m])).rows[0];
    expect(await at(SEP)).toEqual({ r: "Call centre agent", b: "per_client_appt_shown" });
    expect(await at(OCT)).toEqual({ r: "Media buyer", b: "none" });
    const planOf = async (m: string) => (await db.query<any>("SELECT public.cockpit_pay_plan_for($1,$2) p", [ids["Agent Two"], m])).rows[0].p;
    expect(await planOf(SEP)).toMatchObject({ source: "role", role: "Call centre agent" });
    expect(await planOf(OCT)).toMatchObject({ source: "role", role: "Media buyer" });
  });

  test("a person added after the month they started has their lines and role from that month, as their base", async () => {
    await today("2026-11-02");
    try {
      const id = await person("Late Closer", { role: "Closer", startedOn: "2026-10-15", monthlyCost: 0, email: "late1@example.test",
        commissionBasis: "closed_cash", commissionRate: 0.1 });
      await owner(db);
      const at = async (m: string) => (await db.query<any>("SELECT public.cockpit_pay_role_at($1,$2) r, (SELECT basis FROM public.cockpit_pay_lines_at($1,$2)) b",
        [id, m])).rows[0];
      expect(await at(OCT)).toEqual({ r: "Closer", b: "closed_cash" });
      expect(await at(SEP)).toEqual({ r: null, b: "none" });
      expect((await db.query<any>("SELECT effective_from::text f FROM public.cockpit_pay_history WHERE person_id=$1", [id])).rows).toEqual([{ f: "2026-10-15" }]);
      expect((await db.query<any>("SELECT count(*)::int n FROM public.cockpit_pay_people_in($1) x(id) WHERE x.id=$2", [OCT, id])).rows[0].n).toBe(1);
      // A later change is dated to the month it is made in (decision 15): October keeps 10%.
      await ceo("cockpit_ceo_people_save", { id, commissionBasis: "closed_cash", commissionRate: 0.12 });
      await owner(db);
      const rate = async (m: string) => Number((await db.query<any>("SELECT rate FROM public.cockpit_pay_lines_at($1,$2)", [id, m])).rows[0].rate);
      expect([await rate(OCT), await rate(NOV)]).toEqual([0.1, 0.12]);
    } finally {
      await today("2026-10-05");
    }
  });
});

describe("the seed", () => {
  test("seeds the six role plans and the ramp start as the CEO through the RPCs, twice", async () => {
    const seed = readFileSync(new URL("../../../docs/pay/seed-2026-10.sql", import.meta.url), "utf8")
      .replace(/v_ceo_email text:='[^']+'/, `v_ceo_email text:='${CEO_EMAIL}'`);
    expect(seed).toContain(CEO_EMAIL);
    for (let i = 0; i < 2; i++) { await owner(db); await db.exec(seed); }
    const plans = await sqlAsOwner<{ role: string; set_by: string }>("SELECT role, set_by FROM public.cockpit_pay_plans WHERE from_month='2026-10-01' AND role IS NOT NULL ORDER BY role");
    expect(plans.map(p => p.role)).toEqual(["Call centre agent", "Client success manager", "Closer", "Creative strategist", "Media buyer", "Systems manager"]);
    expect(plans.every(p => p.set_by === CEO_EMAIL)).toBe(true);
    const ramp = await sqlAsOwner<{ month: string; value: unknown }>("SELECT month::text, value FROM public.cockpit_pay_confirmations WHERE key=$1", [`ramp_start:${ids["Success One"]}`]);
    expect(ramp).toEqual([{ month: OCT, value: { day: "2026-10-02" } }]);
    const audit = await sqlAsOwner<{ action: string; n: number }>("SELECT action, count(*)::int n FROM public.cockpit_audit_log WHERE action IN ('pay.planSave','pay.planFix') AND after->>'fromMonth'='2026-10' GROUP BY 1 ORDER BY 1");
    expect(audit).toEqual([{ action: "pay.planFix", n: 6 }, { action: "pay.planSave", n: 6 }]);
    for (const p of await sqlAsOwner<{ c: string | null }>("SELECT public.cockpit_pay_plan_check(plan, true) c FROM public.cockpit_pay_plans WHERE role IS NOT NULL")) expect(p.c).toBeNull();
  });
});

describe("plans", () => {
  test("the check refuses unknown keys at every level and a band without inclusive", async () => {
    const bad = async (p: unknown, isRole = true) => (await sqlAsOwner<{ c: string }>("SELECT public.cockpit_pay_plan_check($1::jsonb,$2) c", [JSON.stringify(p), isRole]))[0].c;
    const mb = structuredClone(PLANS["Media buyer"]) as any;
    expect(await bad({ ...mb, extra: 1 })).toBe('Unknown field "extra" in the plan.');
    expect(await bad({ ...mb, parts: [{ ...mb.parts[0], colour: "red" }] })).toBe('Unknown field "colour" in part "cpl_bonus".');
    expect(await bad({ ...mb, parts: [{ ...mb.parts[0], guard: { minClients: 5, minSpend: 1 } }] })).toBe('Unknown field "minSpend" in the guard of part "cpl_bonus".');
    const typo = structuredClone(mb); typo.parts[0].bands[3] = { upTo: 15, inclusve: true, amount: 100 };
    expect(await bad(typo)).toBe('Unknown field "inclusve" in band 4 of part "cpl_bonus".');
    const noIncl = structuredClone(mb); delete noIncl.parts[0].bands[0].inclusive;
    expect(await bad(noIncl)).toBe('Band 1 of part "cpl_bonus" needs inclusive: true or false.');
    expect(await bad({ version: 1, parts: [{ key: "x", kind: "share", label: "X", of: "smm_revenue", steps: [{ fromMonth: 1, rate: 0.1, until: 2 }] }] }))
      .toBe('Unknown field "until" in step 1 of part "x".');
    expect(await bad({ version: 1, parts: [], commission: [{ basis: "per_client_appt_shown", rate: 5 }] }, false))
      .toBe("Only a role plan carries commission lines; set a person's lines on the roster.");
    await expect(plan({ role: "Media buyer", fromMonth: NOV, plan: noIncl })).rejects.toThrow('Band 1 of part "cpl_bonus" needs inclusive: true or false.');
    await expect(plan({ role: "Media buyer", fromMonth: "2026-11-02", plan: mb })).rejects.toThrow("Plans start on the 1st of a month.");
    await expect(plan({ role: "  ", fromMonth: NOV, plan: mb })).rejects.toThrow("Name the role.");
    await expect(plan({ personId: 999999, fromMonth: NOV, plan: null })).rejects.toThrow(/Nobody on the roster/);
    await expect(plan({ role: "Media buyer", fromMonth: NOV, plan: mb, colour: 1 })).rejects.toThrow("Unknown field: colour");
  });

  test("role, own and follow: a person's own plan wins from its month, a null row follows the role again", async () => {
    const own = { version: 1, parts: [{ key: "systems", kind: "per_event", label: "Systems", event: "system_built", amount: 50 }] };
    const r1 = await plan({ personId: ids["Buyer One"], fromMonth: NOV, plan: own });
    const r2 = await plan({ personId: ids["Buyer One"], fromMonth: DEC, plan: null, note: "Back on the role plan" });
    const planOf = async (m: string) => (await sqlAsOwner("SELECT public.cockpit_pay_plan_for($1,$2) p", [ids["Buyer One"], m]))[0].p;
    expect(await planOf(OCT)).toMatchObject({ source: "role", role: "Media buyer", follows: false });
    expect(await planOf(NOV)).toMatchObject({ source: "own", planId: r1.id });
    expect(await planOf(DEC)).toMatchObject({ source: "role", role: "Media buyer", follows: true });
    expect(r2.ok).toBe(true);
    // Same scope and month replaces it.
    const again = await plan({ personId: ids["Buyer One"], fromMonth: NOV, plan: own, note: "Typo fixed" });
    expect(again.id).toBe(r1.id);
    await actor(db, CEO);
    const list = (await db.query<any>("SELECT public.cockpit_ceo_pay_plans_list() r")).rows[0].r;
    expect(list.roles).toEqual(expect.arrayContaining(["Media buyer", "Call centre agent", "Video editor"]));
    expect(list.people.find((p: any) => p.name === "Buyer One")).toMatchObject({ role: "Media buyer", active: true });
    expect(list.plans.filter((p: any) => p.personId === ids["Buyer One"])).toHaveLength(2);
  });
});

describe("bands", () => {
  test("the shared vectors pick the same band (rounded first, half away from zero)", async () => {
    const pick = async (bands: unknown, v: number) => (await sqlAsOwner("SELECT public.cockpit_pay_band_pick($1::jsonb,$2::numeric) p", [JSON.stringify(bands), v]))[0].p;
    const mb: [number, number, number][] = [[12.45, 2, 200], [15.0, 3, 100], [15.4, 4, 0], [15.01, 4, 0], [0, 0, 400], [9.995, 2, 200], [12.995, 3, 100], [14.995, 3, 100]];
    for (const [v, index, amount] of mb) expect(await pick(MB_BANDS, v)).toEqual({ index, amount });
    for (const [v, index, amount] of [[4.55, 1, 1500], [4.995, 2, 1000], [0, 0, 2000], [15.01, 6, -250]] as const) expect(await pick(CSM_BANDS, v)).toEqual({ index, amount });
  });

  test("the media buyer's October bonus: pooled $12.45 pays $200, with non-lead spend in the note", async () => {
    const p = one(await month(OCT), "Buyer One");
    const b = part(p, "cpl_bonus");
    expect(b).toMatchObject({ amountUsd: 200, state: "known", band: { index: 2 }, input: { value: 12.45, unit: "usd", state: "measured" } });
    expect(b.input.note).toContain("$300 spent outside lead campaigns");
    expect(b.evidence).toEqual(["cu-a", "cu-b"]);
    // Cost per booking over the same clients, tracked beside it and never paid on.
    expect(b.input.alsoTracked).toEqual({ metric: "cpb", over: "every_client", value: 103, state: "measured", note: null });
  });

  test("not_met: fewer owned clients than the guard needs pays $0 and says why", async () => {
    let p = one(await month(OCT), "Strategist One");
    expect(part(p, "cpl_bonus")).toMatchObject({ state: "missing", amountUsd: null, input: { state: "missing" } });
    expect(part(p, "cpl_bonus").input.proposal.clients).toEqual([{ clickupId: "cu-a", name: "Client A" }]);
    await confirm({ month: OCT, key: `owned_creative:${ids["Strategist One"]}`, value: { clients: ["cu-a", "cu-b", "cu-d"] } });
    p = one(await month(OCT), "Strategist One");
    const b = part(p, "cpl_bonus");
    expect(b).toMatchObject({ state: "not_met", amountUsd: 0, input: { state: "not_met" } });
    expect(b.input.note).toBe("3 clients left after the guard; the bonus needs 5.");
    // "Change" starts from what was confirmed, not from the data's proposal.
    expect(b.input.confirmed).toEqual({ clients: ["cu-a", "cu-b", "cu-d"] });
    // Cost per booking over her own clients and the same guard: what a switch would pay on.
    expect(b.input.alsoTracked).toEqual({ metric: "cpb", over: "same", value: null, state: "not_met",
      note: "3 clients left after the guard; the bonus needs 5." });
  });

  test("the strategist's guarded cost per booking is over her own clients, never the company's pool", async () => {
    // Her three confirmed clients with the guard's bar at 2: measured, and cost per booking is hers (1,500 / 12), not the pooled $103.
    const sid = ids["Strategist One"];
    const body = async (ex: number) =>
      (await sqlAsOwner("SELECT body FROM public.test_pay_facts WHERE kind='ads' AND month=$1 AND ex=$2", [OCT, ex]))[0].body;
    const factsFor = { ads: await body(0), adsGuarded: { "14": await body(14) } };
    const bands = [{ upTo: 10, inclusive: false, amount: 300 }, { upTo: 13, inclusive: false, amount: 200 }, { upTo: null, amount: 0 }];
    const input = async (metric: string) => (await sqlAsOwner<{ r: any }>(
      "SELECT public.cockpit_pay_band_input($1,'Strategist One',$2::date,$3::jsonb,$4::jsonb) r",
      [sid, OCT, JSON.stringify({ key: "cpl_bonus", kind: "band", label: "Bonus", metric, covers: "owned_creative",
        guard: { minClients: 2, minSpendUsd: 500, excludeDays: 14 }, bands }), JSON.stringify(factsFor)]))[0].r;
    const onCpl = await input("cpl");
    expect(onCpl).toMatchObject({ state: "measured", value: 11.25 });
    expect(onCpl.alsoTracked).toEqual({ metric: "cpb", over: "same", value: 125, state: "measured", note: null });
    // Switched to cost per booking: paid on her $125, cost per lead tracked over the same clients.
    const onCpb = await input("cpb");
    expect(onCpb).toMatchObject({ state: "measured", value: 125 });
    expect(onCpb.alsoTracked).toMatchObject({ metric: "cpl", over: "same", value: 11.25 });
  });

  test("last month's churn is confirmed under September and paid in October", async () => {
    await confirm({ month: SEP, key: "logo_churn", value: { lost: 1, activeAtStart: 22, clients: ["cu-x"] } });
    const p = one(await month(OCT), "Strategist One");
    expect(part(p, "churn_bonus")).toMatchObject({ amountUsd: 1200, band: { index: 0 }, input: { value: 4.55, unit: "pct", state: "confirmed" } });
    expect(part(p, "churn_bonus").input.confirmed).toEqual({ lost: 1, activeAtStart: 22, clients: ["cu-x"] });
  });
});

describe("missing is never zero", () => {
  test("the CSM's unconfirmed retention keeps the total null and lowers lowestUsd by the -$250 band", async () => {
    const p = one(await month(OCT), "Success One");
    expect(p.totalUsd).toBeNull();
    expect(part(p, "retention")).toMatchObject({ state: "missing", amountUsd: null });
    expect(part(p, "renewals")).toMatchObject({ state: "missing", amountUsd: null, input: { note: "Waiting for your count." } });
    // A share of money waits for cash, not a count.
    expect(part(p, "upsells")).toMatchObject({ state: "missing", amountUsd: null, input: { unit: "cash", note: "Waiting for the month's cash." } });
    expect(p.missing).toContain("Backend upsells: Waiting for the month's cash.");
    expect(part(p, "over_20")).toMatchObject({ state: "known", amountUsd: 0, input: { value: 7, state: "measured" } });
    // base 800 + over-20 0 + floor top-up 400 (ramp start 2 Oct, 60 days)
    expect(Number(p.knownUsd)).toBe(1200);
    expect(Number(p.lowestUsd)).toBe(950);
    expect(p.status).toBe("in_progress");
    expect(p.missing).toContain("Renewals: Waiting for your count.");
  });

  test("the floor follows ramp_start: a top-up inside the 60 days, nothing after, missing without a start", async () => {
    expect(part(one(await month(OCT), "Success One"), "ramp")).toMatchObject({ state: "known", amountUsd: 400 });
    expect(part(one(await month(NOV), "Success One"), "ramp")).toMatchObject({ state: "known", amountUsd: 400 });
    const dec = part(one(await month(DEC), "Success One"), "ramp");
    expect(dec).toMatchObject({ state: "known", amountUsd: 0 });
    expect(dec.input.note).toBe("Outside the ramp guarantee (2 Oct 2026 to 30 Nov 2026).");
    await confirm({ month: OCT, key: `ramp_start:${ids["Success One"]}`, value: null });
    expect(part(one(await month(OCT), "Success One"), "ramp")).toMatchObject({ state: "missing", amountUsd: null, input: { note: "Type the contract start." } });
    await confirm({ month: SEP, key: `ramp_start:${ids["Success One"]}`, value: { day: "2026-10-02" } });
    expect((await sqlAsOwner("SELECT month::text m FROM public.cockpit_pay_confirmations WHERE key=$1", [`ramp_start:${ids["Success One"]}`]))).toEqual([{ m: OCT }]);
  });

  test("the closer: measured cash lines and the PIF bonus, but no base keeps the total null", async () => {
    const p = one(await month(OCT), "Closer One");
    expect(p.commission.map((l: any) => [l.basis, Number(l.amountUsd), l.state])).toEqual([["closed_cash", 875, "measured"], ["set_cash", 300, "measured"]]);
    expect(p.commission[0].evidence).toEqual(["resp-1", "resp-2"]);
    expect(p.commission[0].payments).toEqual(["tap:chg_made_up_2", "whop:pay_made_up_1"]);
    expect(part(p, "pif")).toMatchObject({ amountUsd: 250, state: "known", evidence: ["resp-1"] });
    expect(p.base).toMatchObject({ usd: null, source: "none" });
    expect(p.totalUsd).toBeNull();
    expect(p.missing[0]).toBe("No base set: set their pay on the roster (0 if they have none).");
    expect(p.roleCommission).toEqual({ matches: true });
  });

  test("an agent whose lines differ from the role plan's commission is told so", async () => {
    const p = one(await month(OCT), "Agent Three");
    expect(p.roleCommission.matches).toBe(false);
    expect(p.roleCommission.sentence).toBe("The Call centre agent plan pays $5 per client appointment shown and $20 per closed client deal; Agent Three's commission lines differ.");
    expect(p.commission[0]).toMatchObject({ basis: "other", state: "not_here", amountUsd: null });
    expect(p.notPriced).toEqual(["other"]);
    expect(p.totalUsd).toBeNull();
  });

  test("a facts function that fails leaves its parts missing, with the reason in the notes", async () => {
    await facts("ads", NOV, null, 0, true);
    const mo = await month(NOV);
    expect(part(one(mo, "Agent Two"), "cpl_bonus")).toMatchObject({ state: "missing", amountUsd: null, input: { note: "The ad figures could not be read." } });
    expect(mo.notes.some((n: string) => n.startsWith("The ads figures could not be read"))).toBe(true);
  });

  test("staff with no plan are named, a leaver is still listed in the month they worked", async () => {
    const mo = await month(SEP);
    expect(mo.notOnAPlan.map((x: any) => [x.name, x.why])).toEqual(expect.arrayContaining([["Editor One", 'No pay plan for the role "Video editor"']]));
    expect(mo.notOnAPlan.map((x: any) => x.name)).not.toContain("Founder One");
    const leaver = one(mo, "Leaver One");
    expect(leaver).toMatchObject({ active: false, endedOn: "2026-09-12" });
    expect(leaver.commission[0]).toMatchObject({ basis: "per_client_appt_shown", quantity: 4, state: "measured" });
    expect(one(await month(NOV), "Leaver One")).toBeUndefined();
    expect(mo.notes[0]).toBe("Earned in September, paid with October's payroll.");
  });

  test("an agent with no email, or one shared with someone else, can be credited nothing: the client lines are missing, not $0", async () => {
    const two = ids["Agent Two"];
    const lines = async () => one(await month(SEP), "Agent Two").commission.map((l: any) => [l.basis, l.state, l.amountUsd]);
    // On the roster with a unique email and no meetings in the facts: 0 shows is measured.
    expect(await lines()).toEqual([["per_client_appt_shown", "measured", 0], ["per_client_deal_closed", "measured", 0]]);
    try {
      await sqlAsOwner("UPDATE public.cockpit_people SET email=NULL WHERE id=$1", [two]);
      let p = one(await month(SEP), "Agent Two");
      expect(p.commission.map((l: any) => [l.state, l.amountUsd])).toEqual([["missing", null], ["missing", null]]);
      expect(p.commission[0].note).toBe("Agent Two has no email on the roster, so no meeting can be credited to them.");
      expect(p.missing).toContain("Line 1: Agent Two has no email on the roster, so no meeting can be credited to them. Set the email they book with.");
      expect(p.totalUsd).toBeNull();
      await sqlAsOwner("UPDATE public.cockpit_people SET email=' AGENT1@example.test' WHERE id=$1", [two]);
      p = one(await month(SEP), "Agent Two");
      expect(p.commission[1]).toMatchObject({ state: "missing", amountUsd: null,
        note: "Agent Two shares an email with someone else on the roster, so no meeting can be credited to them." });
    } finally {
      await sqlAsOwner("UPDATE public.cockpit_people SET email='agent2@example.test' WHERE id=$1", [two]);
    }
    expect(await lines()).toEqual([["per_client_appt_shown", "measured", 0], ["per_client_deal_closed", "measured", 0]]);
  });

  test("lines that differ from the role plan's: the floor takes each at the lower rate, so applying the plan never goes under it", async () => {
    const a1 = ids["Agent One"];
    await facts("calls", OCT, { agents: [{ email: "agent1@example.test", personId: a1, name: "Agent One", shows: 10, unmarked: 0, showIds: [],
      closes: [{ appointmentId: "appt-o1", locationId: "loc-a", contactId: "ct-9", evidence: "portal" }] }], unattributed: { due: 0, shows: 0, items: [] } });
    try {
      await ceo("cockpit_ceo_people_save", { id: a1, commissionBasis: "per_client_appt_shown", commissionRate: 5,
        commission2Basis: "per_client_deal_closed", commission2Rate: 25 });
      const before = one(await month(OCT), "Agent One");
      expect(before.roleCommission.matches).toBe(false);
      expect([Number(before.knownUsd), Number(before.lowestUsd), before.totalUsd]).toEqual([725, 720, null]);
      await ceo("cockpit_ceo_people_save", { id: a1, commissionBasis: "per_client_appt_shown", commissionRate: 5,
        commission2Basis: "per_client_deal_closed", commission2Rate: 20 });
      const after = one(await month(OCT), "Agent One");
      expect(after.roleCommission).toEqual({ matches: true });
      expect(Number(after.totalUsd)).toBe(720);
      expect(Number(after.totalUsd)).toBeGreaterThanOrEqual(Number(before.lowestUsd));
    } finally {
      await sqlAsOwner("DELETE FROM public.test_pay_facts WHERE kind='calls' AND month=$1", [OCT]);
    }
  });
});

describe("deal cash: a written ledger and names that key to someone", () => {
  let octSales: any;
  const setSales = async (body: unknown) => facts("sales", OCT, body);
  test("with the ledger not written, the cash lines and the paid-in-full part are missing, never a measured $0", async () => {
    octSales = (await sqlAsOwner("SELECT body FROM public.test_pay_facts WHERE kind='sales' AND month=$1", [OCT]))[0].body;
    try {
      await setSales({ ...octSales, ledgerReady: false });
      let p = one(await month(OCT), "Closer One");
      const why = "The Money section was published before the deal ledger existed: no deal cash is known until the next money refresh.";
      expect(p.commission.map((l: any) => [l.basis, l.state, l.amountUsd, l.note])).toEqual([
        ["closed_cash", "missing", null, why], ["set_cash", "missing", null, why]]);
      expect(part(p, "pif")).toMatchObject({ state: "missing", amountUsd: null, input: { note: why } });
      expect(p.missing).toContain("Line 1: the Money section was published before the deal ledger existed: no deal cash is known until the next money refresh.");
      await setSales({ ...octSales, cashThrough: null });
      p = one(await month(OCT), "Closer One");
      expect(p.commission.map((l: any) => l.note)).toEqual(["The money refresh has not run: no deal cash is known yet.",
        "The money refresh has not run: no deal cash is known yet."]);
      expect(p.status).toBe("in_progress");
    } finally {
      await setSales(octSales);
    }
  });

  test("a deal waiting for its setter or its paid in full is named on the receipt as the screen asks about it", async () => {
    // The facts give bare response ids; the month names the business, who the form and the intro say, and what is short.
    const noSetter = { responseId: "resp-5", signedDay: "2026-10-14", business: "Client N", contracted: 4000,
      closer: { name: "Closer One", personId: ids["Closer One"] }, setter: { name: null, personId: null, source: "none", state: "none", disagree: null },
      payments: [], cashInMonth: 500, cashToDate: 500, pif: { state: "no", day: null, shortUsd: 3500 } };
    const nearlyPaid = { ...octSales.deals[1], pif: { state: "waiting", day: "2026-10-09", shortUsd: 250, until: "2026-11-22", source: "cash" } };
    try {
      await setSales({ ...octSales, deals: [octSales.deals[0], nearlyPaid, noSetter],
        people: [{ ...octSales.people[0], setWaiting: ["resp-5"], pifWaiting: ["resp-2"] }] });
      const p = one(await month(OCT), "Closer One");
      expect(p.commission[1]).toMatchObject({ basis: "set_cash", state: "waiting",
        waiting: [{ responseId: "resp-5", business: "Client N", state: "none", form: null, intro: null }] });
      expect(part(p, "pif")).toMatchObject({ state: "waiting",
        input: { waiting: [{ responseId: "resp-2", business: "Client F", shortUsd: 250, day: "2026-10-09" }] } });
    } finally {
      await setSales(octSales);
    }
  });

  test("cash on a deal whose closer or setter keys to nobody makes every cash line wait, with the names, until they are keyed", async () => {
    const unkeyedDeal = { responseId: "resp-3", signedDay: "2026-10-12", business: "Client G", contracted: 3000,
      closer: { name: "Closer Typo", personId: null }, setter: { name: "Setter Typo", personId: null, source: "form", state: "known", disagree: null },
      payments: [{ paymentId: "whop:pay_made_up_3", rail: "whop", day: "2026-10-13", usd: 3000, matchedBy: "email" }], cashInMonth: 3000, cashToDate: 3000,
      pif: { state: "earned", day: "2026-10-13", shortUsd: 0 } };
    // An intro name that keys to nobody on a deal whose setter is known moves no money: no wait for it.
    const keyedSetter = { ...octSales.deals[0], responseId: "resp-4", business: "Client K", cashInMonth: 1000, payments: [], pif: { state: "no", day: null } };
    try {
      await setSales({ ...octSales, deals: [...octSales.deals, unkeyedDeal, keyedSetter],
        unkeyed: [{ responseId: "resp-3", name: "Closer Typo", role: "closer" }, { responseId: "resp-3", name: "Setter Typo", role: "setter" },
          { responseId: "resp-4", name: "Intro Typo", role: "setter" }] });
      const p = one(await month(OCT), "Closer One");
      expect(p.commission.map((l: any) => [l.basis, l.state, Number(l.amountUsd)])).toEqual([["closed_cash", "waiting", 875], ["set_cash", "waiting", 300]]);
      expect(p.commission[0].unkeyed).toEqual([expect.objectContaining({ responseId: "resp-3", name: "Closer Typo", business: "Client G" })]);
      expect(p.commission[1].unkeyed.map((x: any) => x.name)).toEqual(["Setter Typo"]);
      expect(p.missing).toContain("Closed cash: 1 deal with cash in October names a closer that matches nobody on the team list: Client G (Closer Typo). "
        + "Add the name to a sales rep's aliases, or the rep's seat email to the roster.");
      expect(part(p, "pif")).toMatchObject({ state: "waiting", amountUsd: 250, input: { state: "waiting" } });
      expect(p.status).not.toBe("ready");
      // What is settled is known; the floor never reads above it.
      expect(Number(p.knownUsd)).toBe(875 + 300 + 250);
      expect(Number(p.lowestUsd)).toBeLessThanOrEqual(Number(p.knownUsd));
    } finally {
      await setSales(octSales);
    }
    expect(one(await month(OCT), "Closer One").commission.map((l: any) => l.state)).toEqual(["measured", "measured"]);
  });
});

describe("entries", () => {
  test("typed parts follow the general conditions; worked-out parts are refused", async () => {
    const sid = ids["Success One"];
    const e = (x: Record<string, unknown>) => ceo("cockpit_ceo_pay_entry_save", { personId: sid, month: OCT, ...x });
    await expect(e({ partKey: "renewals", quantity: 1, client: "Client A", evidenceRef: "whop:pay_made_up_9" })).rejects.toThrow("Type the day the payment cleared.");
    await expect(e({ partKey: "renewals", quantity: 1, client: "Client A", clearedOn: "2026-11-03", evidenceRef: "x" })).rejects.toThrow("Cleared on 3 Nov: add it to November.");
    await expect(e({ partKey: "renewals", quantity: 1, client: "Client A", clearedOn: "2026-10-03" })).rejects.toThrow("Add the payment id or the signed contract id.");
    await expect(e({ partKey: "google_reviews", quantity: 1, evidence: "not a link", postedOn: "2026-10-04" })).rejects.toThrow("Paste the link to the review.");
    await expect(e({ partKey: "referrals", quantity: -1, client: "Client A", clearedOn: "2026-10-03", evidenceRef: "x" })).rejects.toThrow("A negative count is a clawback: say why in the note.");
    await expect(e({ partKey: "retention", quantity: 1 })).rejects.toThrow("This part is worked out by the cockpit; confirm its input instead of typing it.");
    await expect(e({ partKey: "nope", quantity: 1 })).rejects.toThrow(`Success One's plan for October has no part "nope".`);
    await expect(e({ partKey: "recurring", cashUsd: 100, client: "Client A" })).rejects.toThrow("Say which month of the engagement this is (1 for the first).");
    const ok = await e({ partKey: "renewals", quantity: 1, client: "Client A", clearedOn: "2026-10-03", evidenceRef: "whop:pay_made_up_9" });
    const rv = await e({ partKey: "google_reviews", quantity: 1, evidence: "https://example.test/review/1", postedOn: "2026-10-04" });
    await e({ partKey: "recurring", cashUsd: 1000, engagementMonth: 1, client: "Client A", clearedOn: "2026-10-05", evidenceRef: "tap:chg_made_up_3", cancelledOn: "2026-10-20" });
    const p = one(await month(OCT), "Success One");
    expect(part(p, "renewals")).toMatchObject({ amountUsd: 300, state: "known", evidence: [ok.id] });
    expect(part(p, "recurring")).toMatchObject({ amountUsd: 200, state: "known" });
    expect(p.reviewsToCheck).toEqual([{ entryId: rv.id, postedOn: "2026-10-04", checkBy: "2026-11-03", due: false }]);
    // A residual ends on the client's cancellation, or after a payment lapse over 30 days.
    await expect(ceo("cockpit_ceo_pay_entry_save", { personId: sid, month: NOV, partKey: "recurring", cashUsd: 1000, engagementMonth: 2, client: "Client A",
      clearedOn: "2026-11-05", evidenceRef: "tap:chg_made_up_4" })).rejects.toThrow("The residual ended: Client A cancelled on 20 Oct 2026.");
    await e({ partKey: "recurring", cashUsd: 500, engagementMonth: 1, client: "Client B", clearedOn: "2026-10-05", evidenceRef: "tap:chg_made_up_6" });
    await expect(ceo("cockpit_ceo_pay_entry_save", { personId: sid, month: DEC, partKey: "recurring", cashUsd: 500, engagementMonth: 2, client: "client b",
      clearedOn: "2026-12-05", evidenceRef: "tap:chg_made_up_7" })).rejects.toThrow("The residual ended: no payment for over 30 days after 5 Oct 2026.");
    await expect(ceo("cockpit_ceo_pay_entry_save", { personId: sid, month: NOV, partKey: "recurring", cashUsd: 500, engagementMonth: 2, client: "Client B",
      clearedOn: "2026-11-03", evidenceRef: "tap:chg_made_up_8" })).resolves.toMatchObject({ ok: true });
  });

  test("an entry is never edited; a void sets who, when and why once", async () => {
    // Systems One has no September plan; an adjustment needs none.
    const { id } = await ceo("cockpit_ceo_pay_entry_save", { personId: ids["Systems One"], month: SEP, partKey: "adjustment", amountUsd: 25, note: "Made-up correction" });
    expect(id).toBeGreaterThan(0);
    await owner(db);
    await expect(db.query("UPDATE public.cockpit_pay_entries SET amount_usd=99 WHERE id=$1", [id])).rejects.toThrow(/never edited/);
    await expect(db.query("UPDATE public.cockpit_pay_entries SET voided_at=now() WHERE id=$1", [id])).rejects.toThrow(/when, by whom and why/);
    await ceo("cockpit_ceo_pay_entry_void", { id, reason: "Typed twice" });
    await owner(db);
    await expect(db.query("UPDATE public.cockpit_pay_entries SET void_reason='other' WHERE id=$1", [id])).rejects.toThrow(/kept as it was/);
    await expect(ceo("cockpit_ceo_pay_entry_void", { id, reason: "Again" })).rejects.toThrow("That entry was already removed.");
  });

  test("Nothing else for the month sets every typed part still missing to none", async () => {
    let p = one(await month(OCT), "Systems One");
    expect(p.parts.map((x: any) => x.state)).toEqual(["missing", "missing"]);
    await ceo("cockpit_ceo_pay_entry_save", { personId: ids["Systems One"], month: OCT, partKey: "systems", quantity: 2 });
    expect(await ceo("cockpit_ceo_pay_none_rest", { personId: ids["Systems One"], month: OCT })).toEqual({ ok: true, parts: 1 });
    p = one(await month(OCT), "Systems One");
    expect(p.parts.map((x: any) => [x.key, x.amountUsd, x.state])).toEqual([["systems", 400, "known"], ["systems_large", 0, "known"]]);
    expect(Number(p.totalUsd)).toBe(1400);
    expect(p.status).toBe("in_progress"); // October is not closed until 3 November
  });
});

describe("approval", () => {
  let agent: any;
  test("refused before the settle day, then while a close waits", async () => {
    await today("2026-10-02");
    agent = one(await month(SEP), "Agent One");
    expect(agent.status).toBe("waiting");
    const r = await ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: ids["Agent One"], totalUsd: 0, resultHash: agent.resultHash }] });
    expect(r).toEqual({ ok: true, approved: 0, existing: 0, refused: [{ personId: ids["Agent One"], sentence: "Approve September from 3 October." }] });
    await today("2026-10-05");
    agent = one(await month(SEP), "Agent One");
    const close = agent.commission.find((l: any) => l.basis === "per_client_deal_closed");
    // One close per (client, contact): the portal win counts, the other contact waits.
    expect(close).toMatchObject({ quantity: 1, state: "waiting", waiting: [{ appointmentId: "appt-c2", client: "Client B" }] });
    const w = await ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: ids["Agent One"], totalUsd: 0, resultHash: agent.resultHash }] });
    expect(w.refused[0].sentence).toBe("Agent One is not ready for September: Closed client deals: 1 close waits for your confirmation.");
    await expect(ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: ids["Agent One"], totalUsd: 1, resultHash: agent.resultHash },
      { personId: ids["Agent One"], totalUsd: 1, resultHash: agent.resultHash }] })).rejects.toThrow("Each person can be approved once per call.");
  });

  test("ready after the close is confirmed; a stale hash is refused; approve twice is existing", async () => {
    await confirm({ month: SEP, key: "close:appt-c2", value: { confirmed: true } });
    agent = one(await month(SEP), "Agent One");
    expect(agent.status).toBe("ready");
    expect(Number(agent.totalUsd)).toBe(650 + 27 * 5 + 2 * 20);
    const stale = await ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: ids["Agent One"], totalUsd: Number(agent.totalUsd), resultHash: "0".repeat(32) }] });
    expect(stale.refused[0].sentence).toBe("The figures changed since you opened the month. Reload and check again.");
    const ok = await ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: ids["Agent One"], totalUsd: Number(agent.totalUsd), resultHash: agent.resultHash }] });
    expect(ok).toEqual({ ok: true, approved: 1, existing: 0, refused: [] });
    const again = await ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: ids["Agent One"], totalUsd: Number(agent.totalUsd), resultHash: agent.resultHash }] });
    expect(again).toEqual({ ok: true, approved: 0, existing: 1, refused: [] });
    const row = (await sqlAsOwner("SELECT base_usd::float b, commission_usd::float c, parts_usd::float p, total_usd::float t, result FROM public.cockpit_pay_months WHERE person_id=$1", [ids["Agent One"]]))[0];
    expect([row.b, row.c, row.p, row.t]).toEqual([650, 175, 0, 825]);
    expect(row.result.planJson).toEqual(PLANS["Call centre agent"]);
    expect(row.result.commission[0].evidence).toEqual(["appt-s01", "appt-s02", "appt-s03"]);
    expect(row.result.commission[1].evidence).toEqual(["appt-c1", "appt-c2"]);
  });

  test("an approved month is shown frozen, with the drift since approval", async () => {
    await facts("calls", SEP, {
      agents: [{ personId: ids["Agent One"], name: "Agent One", shows: 28, unmarked: 0, showIds: ["appt-s01", "appt-s02", "appt-s03", "appt-s04"],
        closes: [{ appointmentId: "appt-c1", locationId: "loc-a", contactId: "ct-1", evidence: "portal" }, { appointmentId: "appt-c2", locationId: "loc-b", contactId: "ct-2", evidence: "sheet" }] }],
    });
    const p = one(await month(SEP), "Agent One");
    expect(p.status).toBe("approved");
    expect(Number(p.totalUsd)).toBe(825);
    expect(p.approval).toMatchObject({ approvedBy: CEO_EMAIL });
    expect(p.sinceApproval.deltaUsd).toBe(5);
    expect(p.sinceApproval.changes).toEqual([expect.objectContaining({ kind: "line", what: "per_client_appt_shown",
      frozen: expect.objectContaining({ quantity: 27 }), now: expect.objectContaining({ quantity: 28 }), items: { added: ["appt-s04"], removed: [] } })]);
  });

  test("a figure that cannot be read after approval is unread, never a change to $0", async () => {
    const body = (await sqlAsOwner("SELECT body FROM public.test_pay_facts WHERE kind='calls' AND month=$1", [SEP]))[0].body;
    try {
      await facts("calls", SEP, body, 0, true);
      const p = one(await month(SEP), "Agent One");
      expect(p.status).toBe("approved");
      expect(p.sinceApproval.deltaUsd).toBeNull();
      expect(p.sinceApproval.unread).toBe(true);
      expect(p.sinceApproval.changes.map((c: any) => [c.what, c.unread, c.now.state, c.items])).toEqual([
        ["per_client_appt_shown", true, "missing", { added: [], removed: [] }],
        ["per_client_deal_closed", true, "missing", { added: [], removed: [] }]]);
    } finally {
      await facts("calls", SEP, body);
    }
    expect(one(await month(SEP), "Agent One").sinceApproval).toMatchObject({ deltaUsd: 5, unread: false });
  });

  test("an approved month refuses plan, entry and confirmation changes", async () => {
    await expect(plan({ role: "Call centre agent", fromMonth: SEP, plan: PLANS["Call centre agent"] }))
      .rejects.toThrow("September is approved for Agent One. Plans can change from October.");
    await expect(plan({ personId: ids["Agent One"], fromMonth: SEP, plan: null })).rejects.toThrow("September is approved for Agent One. Plans can change from October.");
    await expect(ceo("cockpit_ceo_pay_entry_save", { personId: ids["Agent One"], month: SEP, partKey: "adjustment", amountUsd: 5, note: "A late show" }))
      .rejects.toThrow("September is approved. Add it to October as an adjustment.");
    await expect(ceo("cockpit_ceo_pay_none_rest", { personId: ids["Agent One"], month: SEP })).rejects.toThrow("September is approved. Add it to October as an adjustment.");
    await expect(confirm({ month: SEP, key: "close:appt-c2", value: { confirmed: false } })).rejects.toThrow("September is approved for Agent One. Withdraw it first to change this.");
    await expect(confirm({ month: SEP, key: "close:appt-zz", value: { confirmed: true } })).rejects.toThrow("There is no close with that appointment in September's call centre figures.");
    await owner(db);
    await expect(db.query("UPDATE public.cockpit_pay_months SET total_usd=1 WHERE person_id=$1", [ids["Agent One"]])).rejects.toThrow(/lock/);
    await expect(db.query("UPDATE public.cockpit_pay_months SET status='withdrawn' WHERE person_id=$1", [ids["Agent One"]])).rejects.toThrow(/who, when and why/);
  });

  test("withdraw waits for a later approved month that carries an adjustment for it", async () => {
    await ceo("cockpit_ceo_pay_entry_save", { personId: ids["Agent One"], month: OCT, partKey: "adjustment", amountUsd: 5, note: "Show marked late (Sep)", fromMonth: SEP });
    await today("2026-11-05");
    const oct = one(await month(OCT), "Agent One");
    expect(part(oct, "adjustment")).toMatchObject({ amountUsd: 5, state: "known" });
    expect(oct.status).toBe("ready");
    const r = await ceo("cockpit_ceo_pay_month_approve", { month: OCT, people: [{ personId: ids["Agent One"], totalUsd: Number(oct.totalUsd), resultHash: oct.resultHash }] });
    expect(r.approved).toBe(1);
    await expect(ceo("cockpit_ceo_pay_month_withdraw", { personId: ids["Agent One"], month: SEP, reason: "Recount" }))
      .rejects.toThrow("October's pay includes an adjustment for September. Withdraw October first.");
    await expect(ceo("cockpit_ceo_pay_month_withdraw", { personId: ids["Agent One"], month: OCT, reason: "x" })).rejects.toThrow("Say why, in a few words.");
    await ceo("cockpit_ceo_pay_month_withdraw", { personId: ids["Agent One"], month: OCT, reason: "Recount" });
    await ceo("cockpit_ceo_pay_month_withdraw", { personId: ids["Agent One"], month: SEP, reason: "Recount" });
    await owner(db);
    await expect(db.query("UPDATE public.cockpit_pay_months SET withdraw_reason='changed' WHERE person_id=$1 AND month=$2", [ids["Agent One"], SEP])).rejects.toThrow(/kept as it was/);
    expect(one(await month(SEP), "Agent One").status).toBe("ready");
    const costs = await (async () => { await actor(db, CEO); return (await db.query<any>("SELECT public.cockpit_ceo_pay_costs() r")).rows[0].r; })();
    expect(costs).toEqual({ months: [] });
  });

  test("a setter confirmation is refused when the deal's deposit before signing sits in an approved month", async () => {
    const st = await person("Setter Two", { role: "B2B setter", monthlyCost: 500, email: "setter2@example.test", commissionBasis: "set_cash", commissionRate: 0.05 });
    const sep = one(await month(SEP), "Setter Two");
    expect(sep.status).toBe("ready");
    expect((await ceo("cockpit_ceo_pay_month_approve", { month: SEP, people: [{ personId: st, totalUsd: Number(sep.totalUsd), resultHash: sep.resultHash }] })).approved).toBe(1);
    const octSales = (await sqlAsOwner("SELECT body FROM public.test_pay_facts WHERE kind='sales' AND month=$1", [OCT]))[0].body;
    try {
      // Signed 2 Oct, deposit 28 Sep: September's set cash would count it for whoever is named.
      await facts("sales", OCT, { ...octSales, deals: [...octSales.deals, { responseId: "resp-5", signedDay: "2026-10-02", business: "Client M", contracted: 4000,
        closer: { name: "Closer One", personId: ids["Closer One"] }, setter: { name: null, personId: null, source: "none", state: "none", disagree: null },
        payments: [{ paymentId: "tap:chg_made_up_5", rail: "tap", day: "2026-09-28", usd: 500, matchedBy: "email" }], cashInMonth: 0, cashToDate: 500,
        pif: { state: "no", day: null, shortUsd: 3500 } }] });
      await expect(confirm({ month: OCT, key: "setter:resp-5", value: { personId: st } }))
        .rejects.toThrow("September is approved for Setter Two and could count this deal. Withdraw it first to change this.");
    } finally {
      await facts("sales", OCT, octSales);
      await ceo("cockpit_ceo_pay_month_withdraw", { personId: st, month: SEP, reason: "Made-up test approval" });
    }
  });

  test("costs lists approved months with what was not priced", async () => {
    const sys = one(await month(OCT), "Systems One");
    expect(sys.status).toBe("ready");
    await ceo("cockpit_ceo_pay_month_approve", { month: OCT, people: [{ personId: ids["Systems One"], totalUsd: Number(sys.totalUsd), resultHash: sys.resultHash }] });
    await actor(db, CEO);
    const costs = (await db.query<any>("SELECT public.cockpit_ceo_pay_costs() r")).rows[0].r;
    expect(costs.months).toEqual([{ personId: ids["Systems One"], month: OCT, commissionUsd: null, partsUsd: 400, notPriced: [] }]);
    const list = (await db.query<any>("SELECT public.cockpit_ceo_pay_plans_list() r")).rows[0].r;
    expect(list.lastApproved).toEqual([{ personId: ids["Systems One"], month: OCT }]);
    expect(list.approvedPlanIds).toHaveLength(1);
    await expect(plan({ role: "Systems manager", fromMonth: OCT, plan: { version: 1, parts: [] } })).rejects.toThrow("October is approved for Systems One. Plans can change from November.");
  });
});

describe("audit and re-runs", () => {
  test("pay audit rows carry ids, months, kinds and keys, never an amount", async () => {
    const rows = await sqlAsOwner<{ action: string; after: Record<string, unknown> }>("SELECT action, after FROM public.cockpit_audit_log WHERE action LIKE 'pay.%'");
    const actions = new Set(rows.map(r => r.action));
    for (const a of ["pay.planSave", "pay.planFix", "pay.entry", "pay.entryVoid", "pay.noneRest", "pay.confirm", "pay.approve", "pay.withdraw"]) expect(actions.has(a)).toBe(true);
    const allowed = new Set(["id", "personId", "month", "partKey", "kind", "role", "fromMonth", "follows", "parts", "kinds", "commission", "key", "removed", "resultHash", "planId"]);
    for (const r of rows) for (const [k, v] of Object.entries(r.after)) {
      expect(allowed.has(k)).toBe(true);
      // The only numbers in a pay audit row are ids.
      if (typeof v === "number") expect(["id", "personId", "planId"]).toContain(k);
      if (Array.isArray(v)) for (const x of v) expect(typeof x).toBe("string");
    }
  });

  test("delete and truncate are refused on plans, entries and approvals", async () => {
    await owner(db);
    for (const t of ["cockpit_pay_plans", "cockpit_pay_entries", "cockpit_pay_months", "cockpit_commission_history", "cockpit_role_history"]) {
      await expect(db.query(`DELETE FROM public.${t}`)).rejects.toThrow(/kept for good/);
      await expect(db.query(`TRUNCATE public.${t}`)).rejects.toThrow(/kept for good/);
    }
  });

  test("the migration applies twice without changing anything", async () => {
    const count = async () => sqlAsOwner<{ t: string; n: number }>(`SELECT 'plans' t, count(*)::int n FROM public.cockpit_pay_plans UNION ALL
      SELECT 'lines', count(*)::int FROM public.cockpit_commission_history UNION ALL SELECT 'roles', count(*)::int FROM public.cockpit_role_history UNION ALL
      SELECT 'months', count(*)::int FROM public.cockpit_pay_months`);
    const before = await count();
    await owner(db);
    await db.exec(migration("20261018a_ceo_pay_plans.sql"));
    expect(await count()).toEqual(before);
    await actor(db, CEO);
    await expect(db.query("SELECT public.cockpit_ceo_pay_plans_list()")).resolves.toBeTruthy();
    await actor(db, null);
    await expect(db.query("SELECT public.cockpit_ceo_pay_plans_list()")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("a paused person's base (the roster's rule)", () => {
  // Made-up editor on $3,100 a month: $100 a day in a 31-day month.
  const payPerson = async (id: number, m: string, on: string) =>
    (await sqlAsOwner("SELECT public.cockpit_pay_person($1,$2::date,'{}'::jsonb,$3::date) r", [id, m, on]))[0].r;

  test("paused days are held back from a roster base, said on the receipt, and left out of what is known", async () => {
    await today("2026-11-20");
    const id = await person("Paused One", { role: "Video editor", monthlyCost: 3100 });
    await ceo("cockpit_ceo_people_save", { id, pausedOn: "2026-12-16", pausedWhy: "Made-up pause" });
    const nov = await payPerson(id, NOV, "2026-12-05");
    expect(nov.base).toEqual({ usd: 3100, amount: 3100, currency: "USD", source: "roster" });
    // Paused from 16 Dec: 16 of 31 days held back.
    const dec = await payPerson(id, DEC, "2027-01-05");
    expect(dec.base).toMatchObject({ usd: 1500, amount: 1500, currency: "USD", source: "roster",
      paused: { days: 16, of: 31, from: "2026-12-16", to: "2026-12-31", fullUsd: 3100, heldUsd: 1600 } });
    expect(Number(dec.knownUsd)).toBe(1500);
    // Paused all of January: nothing of the base is paid, so the month knows $0 of it.
    const jan = await payPerson(id, "2027-01-01", "2027-02-05");
    expect(jan.base).toMatchObject({ usd: 0, paused: { days: 31, of: 31, from: "2027-01-01", to: "2027-01-31", heldUsd: 3100 } });
    expect(Number(jan.knownUsd)).toBe(0);
    // Back from 10 Feb: 9 days held back, the rest paid.
    await today("2027-02-10");
    await ceo("cockpit_ceo_people_save", { id, pausedOn: null, pausedWhy: null });
    const feb = await payPerson(id, "2027-02-01", "2027-03-05");
    expect(feb.base).toMatchObject({ usd: 2103.57, paused: { days: 9, of: 28, from: "2027-02-01", to: "2027-02-09" } });
    const mar = await payPerson(id, "2027-03-01", "2027-04-05");
    expect(mar.base).toEqual({ usd: 3100, amount: 3100, currency: "USD", source: "roster" });
  });
});
