import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

/**
 * Readers repointed (docs/forms/WAVE12-CONTRACT.md 2.8, 4.11, section 8 readers-guardian):
 * 20261101q_readers.sql against PGlite.
 *
 * The goal sheet's context is the live function of 20261030a_goal_sheet.sql, replaced by q. The
 * three lifecycle records q reads (cockpit_extensions_v and cockpit_late_payments_v from
 * 20261101p_money_acts.sql, the churn confirm columns from 20261101o_churn_confirm.sql) belong to
 * other slices; here they are tables shaped exactly as the contract's 3.2 and 2.6 columns, so this
 * file tests q's reads, not those views' rules (their own tests do).
 */

let db: PGlite;
const founder = "00000000-0000-4000-8000-000000000001";
const csm = "00000000-0000-4000-8000-000000000009";
const Q = "20261101q_readers.sql";
const LIVE_MD5 = "8ca5e4d3281f5035bf7fec046c4fef15";

const bodyMd5 = async () =>
  (
    await db.query<{ v: string }>(
      "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS v FROM pg_proc p WHERE p.oid = 'public.cockpit_ceo_goal_sheet_context(text)'::regprocedure",
    )
  ).rows[0].v;

async function context(month: string) {
  await actor(db, founder);
  const r = await db.query<{ c: Record<string, any> }>(
    "SELECT public.cockpit_ceo_goal_sheet_context($1) AS c",
    [month],
  );
  await owner(db);
  return r.rows[0].c;
}

/** The tables the sheet reads that no migration here creates, shaped as live. */
const STUBS = `
CREATE TABLE IF NOT EXISTS public.cockpit_media_daily_stats (day date, data jsonb);
CREATE TABLE IF NOT EXISTS public.cockpit_client_days (day date, closes numeric, lead_quality_sum numeric, lead_quality_count numeric);
CREATE TABLE IF NOT EXISTS public.cockpit_churn_months (month text PRIMARY KEY, active_at_start integer, lost_before_register integer);
CREATE TABLE IF NOT EXISTS public.cockpit_cost_lines (kind text, status text, currency text, unit_price numeric, seats numeric, billing text);
CREATE TABLE IF NOT EXISTS public.cockpit_churn_departures (
  id bigserial PRIMARY KEY, client text NOT NULL, clickup_task_id text, left_on date NOT NULL, launched_on date,
  reason text NOT NULL, mrr_lost_usd numeric, csm text, note text, source text, created_by text,
  created_at timestamptz DEFAULT now(), updated_by text, updated_at timestamptz, removed_at timestamptz,
  removed_by text, removed_why text);
CREATE TABLE IF NOT EXISTS public.cockpit_csm_call_forms (
  token text PRIMARY KEY,
  form_id text NOT NULL,
  form_kind text NOT NULL,
  task_id text,
  submitted_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_id_check;
ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_id_check
  CHECK (form_id = ANY (ARRAY['fRokTITH','KFRCXPFx','tG7dnxBn','BbJy6xg4','oYZKtogO','cockpit-checkin']));
ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_kind_check;
ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_kind_check
  CHECK (form_kind = ANY (ARRAY['checkin','onboarding','kickoff','kickoff_old','blueprint','checkin_late']));
`;

/** The contract's 3.2 columns of the two views, and 2.6's confirm columns, as tables. */
const LIFECYCLE = `
CREATE TABLE public.cockpit_extensions_v (
  grant_id bigint, clickup_task_id text, client_name text, granted_at timestamptz, granted_on date, weeks integer,
  from_date date, until date, ours boolean, at_risk boolean, reason text, limitations text[], call_id text,
  no_call_reason text, prevent text, response_id uuid, seat_role text, by_whom text, replaces_grant_id bigint,
  replaced_by bigint, state text, cleared_at timestamptz);
CREATE TABLE public.cockpit_late_payments_v (
  clickup_task_id text, client_name text, due_on date, amount_usd numeric, ended_on date, closed_how text,
  paid_on date, days_late integer, late_event_id bigint);
ALTER TABLE public.cockpit_churn_departures
  ADD COLUMN notice_on date, ADD COLUMN exit_call_id text, ADD COLUMN survey_response_id uuid,
  ADD COLUMN survey_state text NOT NULL DEFAULT 'not_sent', ADD COLUMN why_detail text, ADD COLUMN how_to_stop text,
  ADD COLUMN churn_type text, ADD COLUMN confirmed_by text, ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN billing_event_id bigint;
`;

beforeAll(async () => {
  db = await cockpitTestDb();
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
  await db.exec(STUBS);
  await db.exec(migration("20261030a_goal_sheet.sql"));
  await member(db, founder, "aziz@maharamedia.com", []);
  await member(db, csm, "csm@tests.invalid", ["csm"]);
  await owner(db);
  const plan = await db.query<{ id: number }>(
    "INSERT INTO public.cockpit_goal_plans(period_kind,period_from,period_to,title,status,created_by) VALUES ('month','2026-11-01','2026-11-30','November 2026 plan','draft','test') RETURNING id",
  );
  const october = await db.query<{ id: number }>(
    "INSERT INTO public.cockpit_goal_plans(period_kind,period_from,period_to,title,status,created_by) VALUES ('month','2026-10-01','2026-10-31','October 2026 plan','draft','test') RETURNING id",
  );
  let sort = 0;
  for (const [planId, key, source] of [
    [plan.rows[0].id, "extensionsGiven", null],
    [plan.rows[0].id, "clientsChurned", null],
    [plan.rows[0].id, "churnRate", "the.ceo.picked"],
    [plan.rows[0].id, "leads", null],
    [october.rows[0].id, "clientsChurned", null],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_goal_targets(plan_id,group_key,metric_key,label,unit,direction,target,actual_source,sort) VALUES ($1,'back_end',$2,$2,'count','down',1,$3,$4)",
      [planId, key, source, sort++],
    );
  await db.query(
    "INSERT INTO public.cockpit_sections(key,label,ok,payload,computed_at) VALUES ('money','Money',true,$1,now())",
    [
      JSON.stringify({
        rails: {
          manualLogged: { count: 2, usd: 3494.88, oldestDay: "2026-11-02" },
        },
      }),
    ],
  );
}, 30000);

afterAll(async () => {
  await db?.close();
});

describe("the drift guard and the apply", () => {
  test("the repo's 20261030a body is the live body the contract read", async () => {
    expect(await bodyMd5()).toBe(LIVE_MD5);
  });

  test("q applies over the live body, then again over its own, and its after md5 is the one in its guard", async () => {
    await owner(db);
    await db.exec(migration(Q));
    const after = await bodyMd5();
    expect(after).not.toBe(LIVE_MD5);
    expect(migration(Q).includes(`v IS DISTINCT FROM '${after}'`)).toBe(true);
    await db.exec(migration(Q));
    expect(await bodyMd5()).toBe(after);
  });

  test("a changed body is refused with the stop-and-re-read sentence", async () => {
    await owner(db);
    const def = (
      await db.query<{ d: string }>(
        "SELECT pg_get_functiondef('public.cockpit_ceo_goal_sheet_context(text)'::regprocedure) AS d",
      )
    ).rows[0].d;
    await db.exec(def.replace("'manualLogged'", "'manualLogged2'"));
    await expect(db.exec(migration(Q))).rejects.toThrow(
      /changed since the waves 1-2 contract read it/,
    );
    await db.exec("ROLLBACK");
    await db.exec(def);
    expect(migration(Q).includes(await bodyMd5())).toBe(true);
  });

  test("grants stay as live: authenticated and service_role run it, anon does not", async () => {
    await owner(db);
    const acl = (
      await db.query<{ a: string }>(
        "SELECT proacl::text AS a FROM pg_proc WHERE oid='public.cockpit_ceo_goal_sheet_context(text)'::regprocedure",
      )
    ).rows[0].a;
    expect(acl).toContain("authenticated=X");
    expect(acl).toContain("service_role=X");
    expect(acl).not.toContain("anon=");
    expect(acl).not.toMatch(/(^|[{,])=X/);
  });
});

describe("the month's lifecycle", () => {
  test("before the views and the confirm columns are live, each list is null with its sentence, never empty", async () => {
    const c = await context("2026-11");
    expect(c.lifecycle.extensions).toBeNull();
    expect(c.lifecycle.latePayments).toBeNull();
    expect(c.lifecycle.departures).toBeNull();
    expect(c.lifecycle.missing).toHaveLength(3);
    expect(c.lifecycle.missing.join(" ")).toContain("20261101p");
    expect(c.lifecycle.missing.join(" ")).toContain("20261101o");
    expect(c.manualLogged).toEqual({
      count: 2,
      usd: 3494.88,
      oldestDay: "2026-11-02",
    });
  });

  test("with them live, the month's grants, late spells and departures arrive with their source sentences", async () => {
    await owner(db);
    await db.exec(LIFECYCLE);
    await db.exec(`
      INSERT INTO public.cockpit_extensions_v(grant_id,clickup_task_id,client_name,granted_on,weeks,from_date,until,ours,at_risk,reason,seat_role,state) VALUES
        (115,'86ewvnqj5','Liwan Limited','2026-10-19',2,'2026-10-19','2026-11-02',NULL,NULL,'Ad account broke, on our side','the CSM','ended'),
        (301,'86eyurepc','Ardon','2026-11-03',2,'2026-11-27','2026-12-11',true,false,'Launch slipped','csm','live'),
        (302,'86ey8w5m1','ARCWANI','2026-11-04',1,'2026-11-04','2026-11-11',false,true,'Budget','ceo','replaced');
      INSERT INTO public.cockpit_late_payments_v(clickup_task_id,client_name,due_on,amount_usd,ended_on,closed_how,paid_on,days_late) VALUES
        ('86ex4m5ux','نهوض نجد','2026-10-07',700,NULL,'open',NULL,26),
        ('86ewvnqgz','Safad','2026-10-27',1300,'2026-11-03','date_moved','2026-11-02',6),
        ('86eynfnv5','Castello','2026-10-08',2000,'2026-10-20','stopped',NULL,12),
        ('86exnov01','December only','2026-12-02',500,NULL,'open',NULL,0);
      INSERT INTO public.cockpit_churn_departures(client,clickup_task_id,left_on,reason,why_detail,how_to_stop,churn_type,survey_state,confirmed_by,confirmed_at,removed_at) VALUES
        ('Atlantis Contracting','86eyjkdc8','2026-11-05','Results','Wanted closed deals, not leads, after 50 days','A dated backstop on pay-on-close offers','mid_programme','filled','csm@tests.invalid','2026-11-05T09:00:00Z',NULL),
        ('Joe and Sera','86ewvnqjb','2026-11-06','Non-payment',NULL,NULL,NULL,'not_sent',NULL,NULL,NULL),
        ('Removed one','86exremov','2026-11-07','Other',NULL,NULL,NULL,'not_sent',NULL,NULL,'2026-11-08T00:00:00Z'),
        ('October one','86eyqx2f6','2026-10-29','Non-payment',NULL,NULL,NULL,'not_sent',NULL,NULL,NULL);
    `);
    const c = await context("2026-11");
    expect(c.lifecycle.missing).toEqual([]);
    expect(c.lifecycle.extensions.map((e: any) => e.taskId)).toEqual([
      "86eyurepc",
      "86ey8w5m1",
    ]);
    expect(c.lifecycle.extensions[0]).toMatchObject({
      grantId: 301,
      weeks: 2,
      until: "2026-12-11",
      state: "live",
      seatRole: "csm",
    });
    expect(c.lifecycle.extensions[0].source).toBe(
      "Given in the cockpit on 3 Nov by the CSM; the grant runs to 11 Dec.",
    );
    expect(c.lifecycle.extensions[1].source).toBe(
      "Given in the cockpit on 4 Nov by the CEO; the grant was replaced by a longer one.",
    );
    // A spell overlapping the month, open or closed in it; one due after the month is left out.
    expect(c.lifecycle.latePayments.map((l: any) => l.client)).toEqual([
      "نهوض نجد",
      "Safad",
    ]);
    expect(c.lifecycle.latePayments[0].source).toBe(
      "The card's next payment date in the daily snapshots: due 7 Oct, still late, 26 days; no payment on the rails.",
    );
    expect(c.lifecycle.latePayments[1].source).toBe(
      "The card's next payment date in the daily snapshots: due 27 Oct, the date moved on the card; paid 2 Nov on the rails.",
    );
    expect(c.lifecycle.latePayments[0].amountUsd).toBe(700);
    expect(c.lifecycle.departures.map((d: any) => d.client)).toEqual([
      "Atlantis Contracting",
      "Joe and Sera",
    ]);
    expect(c.lifecycle.departures[0]).toMatchObject({
      confirmed: true,
      confirmedOn: "2026-11-05",
      churnType: "mid_programme",
      surveyState: "filled",
    });
    expect(c.lifecycle.departures[0].source).toBe(
      "Confirmed in the cockpit on 5 Nov; left 5 Nov.",
    );
    expect(c.lifecycle.departures[1]).toMatchObject({
      confirmed: false,
      whyDetail: null,
    });
    expect(c.lifecycle.departures[1].source).toBe(
      "Logged in the churn register, not confirmed; left 6 Nov.",
    );
    // Roles, not names: no email reaches the sheet.
    expect(JSON.stringify(c.lifecycle)).not.toContain("@");
  });

  test("October reads its own grants and its own departure; the old keys of the context are all still there", async () => {
    const c = await context("2026-10");
    expect(c.lifecycle.extensions.map((e: any) => e.grantId)).toEqual([115]);
    expect(c.lifecycle.extensions[0].source).toBe(
      // The view's words for the seat ("the CSM"), as the codes, read as the role; never "on the billing sheet".
      "Given in the cockpit on 19 Oct by the CSM; the grant ended 2 Nov.",
    );
    expect(c.lifecycle.departures.map((d: any) => d.client)).toEqual([
      "October one",
    ]);
    for (const key of [
      "today",
      "month",
      "plan",
      "plans",
      "targets",
      "metrics",
      "cells",
      "growthDaily",
      "windows",
      "cashDaily",
      "book",
      "refundsMonthly",
      "bankThrough",
      "deliveryDaily",
      "mediaDaily",
      "clientDaily",
      "churned",
      "churnMonths",
      "softwareMonthly",
      "lockin",
      "locked",
    ])
      expect(Object.keys(c)).toContain(key);
  });

  test("the gate is unchanged: a CSM and anon are refused", async () => {
    await actor(db, csm);
    await expect(
      db.query("SELECT public.cockpit_ceo_goal_sheet_context('2026-11')"),
    ).rejects.toThrow();
    await actor(db, null);
    await expect(
      db.query("SELECT public.cockpit_ceo_goal_sheet_context('2026-11')"),
    ).rejects.toThrow();
    await owner(db);
  });
});

describe("November's targets name their metric", () => {
  const sources = async () =>
    Object.fromEntries(
      (
        await db.query<{ k: string; p: string; s: string | null }>(
          "SELECT t.metric_key AS k, g.period_from::text AS p, t.actual_source AS s FROM public.cockpit_goal_targets t JOIN public.cockpit_goal_plans g ON g.id=t.plan_id ORDER BY t.id",
        )
      ).rows.map(r => [`${r.p.slice(0, 7)}:${r.k}`, r.s]),
    );

  test("extensionsGiven and clientsChurned are set; a source the CEO picked is kept; other months and keys are untouched", async () => {
    await owner(db);
    expect(await sources()).toEqual({
      "2026-11:extensionsGiven": "clients.extensions.granted",
      "2026-11:clientsChurned": "clients.churn.confirmed",
      "2026-11:churnRate": "the.ceo.picked",
      "2026-11:leads": null,
      "2026-10:clientsChurned": null,
    });
  });

  test("idempotent: a second apply writes no audit row", async () => {
    await owner(db);
    const before = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.cockpit_audit_log WHERE entity_type='cockpit_goal_targets'",
      )
    ).rows[0].n;
    await db.exec(migration(Q));
    const after = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.cockpit_audit_log WHERE entity_type='cockpit_goal_targets'",
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });

  test("a NULL churnRate is set to clients.churn.rate", async () => {
    await owner(db);
    await db.exec(
      "UPDATE public.cockpit_goal_targets SET actual_source=NULL WHERE metric_key='churnRate'",
    );
    await db.exec(migration(Q));
    expect((await sources())["2026-11:churnRate"]).toBe("clients.churn.rate");
  });
});

describe("the termination survey on the CSM's call store", () => {
  test("knIe4eF3 rows of kind exit_survey are accepted; an unknown form still is not", async () => {
    await owner(db);
    await db.exec(
      "INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id) VALUES ('exit-1','knIe4eF3','exit_survey','86eyjkdc8')",
    );
    await expect(
      db.exec(
        "INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind) VALUES ('x','zzzzzzzz','exit_survey')",
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        "INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind) VALUES ('y','knIe4eF3','termination')",
      ),
    ).rejects.toThrow();
  });
});

// ---- W19: the registry's staff-form record equals the code's definition -----------------------------
// The seed lives in forms-foundation's 20261101l and the definition in formsheet-client-page's
// formDefs.ts. Both land on forms-w12 before this slice merges; until then the test says so and skips.

const L = "20261101l_forms_stage3_base.sql";
const defsPath = new URL("../src/forms/staff/formDefs.ts", import.meta.url);
const haveW19 =
  existsSync(new URL(`../../../supabase/migrations/${L}`, import.meta.url)) &&
  existsSync(defsPath);
if (!haveW19)
  console.warn(
    `W19 skipped: ${L} or src/forms/staff/formDefs.ts is not on this branch yet.`,
  );

test.skipIf(!haveW19)(
  "the seeded staff-form schema keys equal formDefs.ts, form by form (W19)",
  async () => {
    const seed = migration(L).match(
      /INSERT INTO public\.cockpit_forms \(key[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/,
    );
    expect(seed).not.toBeNull();
    const scratch = await cockpitTestDb();
    try {
      await scratch.exec(`CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, title text, audience text, provider text,
      typeform_id text, version integer, schema jsonb, seats text[], client_scoped boolean, effects jsonb, updated_by text)`);
      await scratch.exec(seed![0]);
      const rows = (
        await scratch.query<{ key: string; keys: string[] }>(
          "SELECT key, ARRAY(SELECT f->>'key' FROM jsonb_array_elements(schema->'fields') f) AS keys FROM public.cockpit_forms WHERE provider='native' ORDER BY key",
        )
      ).rows;
      const { FORM_DEFS } = (await import(defsPath.href)) as {
        FORM_DEFS: Record<string, { fields: { key: string }[] }>;
      };
      expect(rows.map(r => r.key).sort()).toEqual(
        Object.keys(FORM_DEFS).sort(),
      );
      for (const r of rows)
        expect(r.keys).toEqual(FORM_DEFS[r.key].fields.map(f => f.key));
    } finally {
      await scratch.close();
    }
  },
);

// ---- The readers in code: the CEO refresh, the metrics, the goal sheet, the lock-in and pay ----------

describe("the CEO refresh reads extensions from the view, by card id", () => {
  const view = [
    { grant_id: 115, clickup_task_id: "86ewvnqj5", client_name: "Liwan Limited", granted_at: "2026-10-19 15:49:49+03", granted_on: "2026-10-19", weeks: 2, from_date: "2026-10-19", until: "2026-11-02", state: "ended", seat_role: null },
    { grant_id: 301, clickup_task_id: "86eyurepc", client_name: "Ardon", granted_at: "2026-11-03 10:00:00+03", granted_on: "2026-11-03", weeks: 2, from_date: "2026-11-27", until: "2026-12-11", state: "live", seat_role: "csm" },
  ];

  test("grants keep the card id; the month's weeks and who is covered come from it, not a typed name", async () => {
    const ext = await import("../../../hermes/ceo-refresh/native/extensions.js");
    const grants = ext.grantsOfView(view);
    expect(grants.map((g: any) => [g.clickupTaskId, g.day, g.weeks, g.state])).toEqual([
      ["86ewvnqj5", "2026-10-19", 2, "ended"],
      ["86eyurepc", "2026-11-03", 2, "live"],
    ]);
    // The card's name on the roster differs from the grant's: the id still finds it.
    const s = ext.summariseExtensions(grants, [{ taskId: "86eyurepc", name: "Ardon_mahar Real Estate" }, { taskId: "86ewvnqj5", name: "Liwan" }], "2026-11-10");
    expect(s.totalWeeks).toBe(2);
    expect(s.grants).toBe(1);
    expect(s.unmatched).toBe(0);
    expect(s.perClient).toEqual([{ client: "Ardon_mahar Real Estate", clickupTaskId: "86eyurepc", weeks: 2, until: "2026-12-11", live: true }]);
    expect(s.lastMonth).toMatchObject({ totalWeeks: 2, grants: 1 });
    expect(() => ext.grantsOfView([{ ...view[0], weeks: 3 }])).toThrow(/cockpit_extensions_v/);
    expect(ext.EXT_SQL).toMatch(/^select\b/);
    expect(ext.EXT_SQL).not.toMatch(/\blimit\s+\d+/i);
  });

  test("the lifecycle rows: a finished term does not count, a confirm is read, a broken row throws", async () => {
    const ext = await import("../../../hermes/ceo-refresh/native/extensions.js");
    const life = ext.lifecycleOf(
      [
        { id: 20, clickup_task_id: "86eyjkdc8", client: "Atlantis", left_on: "2026-11-05", reason: "Results", churn_type: "mid_programme", confirmed: true, confirmed_on: "2026-11-05" },
        { id: 23, clickup_task_id: "86eyfinsh", client: "Done", left_on: "2026-11-06", reason: "Completed term, did not renew", churn_type: "completed", confirmed: true, confirmed_on: "2026-11-06" },
      ],
      [{ clickup_task_id: "86ex4m5ux", client_name: "Nohod", due_on: "2026-10-07", ended_on: null, closed_how: "open", paid_on: null, days_late: 34, amount_usd: null }],
    );
    expect(life.departures.map((d: any) => [d.id, d.counts, d.confirmed])).toEqual([[20, true, true], [23, false, true]]);
    expect(life.latePayments[0]).toMatchObject({ daysLate: 34, amountUsd: null, endedOn: null });
    expect(() => ext.lifecycleOf([{ id: 1, left_on: "soon" }], [])).toThrow(/departure/);
  });

  test("one churn rule in all three readers: the confirm's type decides, a finished-term reason only when there is none", async () => {
    // September, so the other tests' months are untouched: a completed term that was cancelled (the day-90 default
    // can say completed for any reason), a finished term with no type yet, and a finished-term reason the CSM
    // confirmed as a mid-programme loss.
    await owner(db);
    await db.exec(`
      INSERT INTO public.cockpit_churn_departures(client,clickup_task_id,left_on,reason,churn_type,survey_state) VALUES
        ('Done Co','86eysep01','2026-09-10','Cancelled','completed','not_sent'),
        ('Finished Co','86eysep02','2026-09-12','Completed term, did not renew',NULL,'not_sent'),
        ('Kept Co','86eysep03','2026-09-14','Completed term, did not renew','mid_programme','not_sent'),
        ('Lost Co','86eysep04','2026-09-16','Cancelled','mid_programme','not_sent');
      INSERT INTO public.cockpit_churn_months(month, active_at_start, lost_before_register) VALUES ('2026-09', 20, 0)
        ON CONFLICT (month) DO NOTHING;`);
    const counted = ["Kept Co", "Lost Co"];
    // The goal sheet (q).
    const sheet = (await context("2026-09")).churned.map((d: any) => d.client).filter((c: string) => c.endsWith(" Co"));
    expect(sheet).toEqual(counted);
    // The CSM KPI (cockpit-sync's CHURN_SQL).
    const { CHURN_SQL } = await import("../../../hermes/cockpit-sync/csmProviders.ts");
    const sep = (await db.query<{ month: string; departed: number }>(CHURN_SQL)).rows.find(r => r.month === "2026-09");
    expect(Number(sep?.departed)).toBe(counted.length);
    // The CEO metric (ceo-refresh's lifecycleOf over its own select).
    const ext = await import("../../../hermes/ceo-refresh/native/extensions.js");
    const rows = (await db.query(ext.LIFECYCLE_SQL.departures)).rows;
    const life = ext.lifecycleOf(rows, []);
    expect(life.departures.filter((d: any) => d.leftOn.startsWith("2026-09") && d.counts).map((d: any) => d.client)).toEqual(counted);
  });

  test("projected MRR is the card sum over active monthly cards (integrity, 11.2-g: $11,333 over 7)", async () => {
    const ext = await import("../../../hermes/ceo-refresh/native/extensions.js");
    const cards = [
      ...[2000, 1300, 1333, 2000, 700, 2000, 2000].map((m, i) => ({ name: `Monthly ${i}`, stage: "Active", mrrUsd: m, paymentPlan: "Monthly" })),
      ...[2000, 2000, 2000, 2000, 1333].map((m, i) => ({ name: `PIF ${i}`, stage: "Active", mrrUsd: m, paymentPlan: "Paid in full (90 days)" })),
      ...[2000, 2000].map((m, i) => ({ name: `Split ${i}`, stage: "Active", mrrUsd: m, paymentPlan: "Split Pay (2x payments)" })),
      { name: "Stopped monthly", stage: "Stopped", mrrUsd: 1666, paymentPlan: "Monthly" },
      { name: "Ghosted monthly", stage: "GHOSTED", mrrUsd: 2000, paymentPlan: "Monthly" },
    ];
    const r = ext.averageRetainer(cards);
    expect(r.cards).toBe(7);
    expect(Math.round(r.averageUsd * r.cards)).toBe(11333);
    const sum = cards.filter(c => c.stage === "Active" && ext.isRecurringPlan(c.paymentPlan)).reduce((s, c) => s + c.mrrUsd, 0);
    expect(sum).toBe(11333);
  });
});

describe("the metric registry: the waves 1-2 rows", () => {
  test("every new metric is defined once, in both registries, with its source and what it leaves out", async () => {
    const native = await import("../../../hermes/ceo-refresh/native/metrics");
    const convex = await import("../convex/ceo/metricRegistry");
    for (const metric of ["clients.extensions.granted", "clients.churn.confirmed", "clients.churn.rate", "clients.late_payments", "money.logged_unchecked"]) {
      for (const defs of [native.DEFINITIONS, convex.DEFINITIONS]) {
        const hits = defs.filter((d: any) => d.metric === metric);
        expect(hits).toHaveLength(1);
        expect(hits[0].source.length).toBeGreaterThan(10);
        expect(hits[0].leavesOut?.length ?? 0).toBeGreaterThan(10);
      }
    }
    const weeks = native.DEFINITIONS.find((d: any) => d.metric === "clients.extension_weeks");
    expect(weeks?.source).toContain("cockpit_extensions_v");
    expect(weeks?.source).not.toContain("Typeform");
  });

  test("values: grants, confirmed churn, the register rate, late spells and logged money; missing lists write nothing", async () => {
    const { extract } = await import("../../../hermes/ceo-refresh/native/metrics");
    const clients = {
      counts: { active: 15, onboarding: 0, paused: 1, churned: 30, total: 46 },
      atRisk: [],
      rows: [],
      notes: [],
      extensions: { from: "2026-11-01", to: "2026-11-10", totalWeeks: 3, grants: 2, perClient: [], read: true, clickupField: { written: 0, note: "" }, grantRows: [
        { day: "2026-10-19", taskId: "86ewvnqj5", client: "Liwan", weeks: 2, until: "2026-11-02" },
        { day: "2026-11-03", taskId: "86eyurepc", client: "Ardon", weeks: 2, until: "2026-12-11" },
        { day: "2026-11-04", taskId: "86ey8w5m1", client: "ARCWANI", weeks: 1, until: "2026-11-11" },
      ] },
      churnRegister: { months: [{ month: "2026-11", activeAtStart: 18, newClients: null, churned: 0, churnPct: null, rolling3Pct: null }] },
      lifecycle: {
        read: true,
        departures: [
          { taskId: "86eyjkdc8", leftOn: "2026-11-05", counts: true, confirmed: true },
          { taskId: "86ewvnqjb", leftOn: "2026-11-06", counts: true, confirmed: false },
          { taskId: "86eyfinsh", leftOn: "2026-11-07", counts: false, confirmed: true },
        ],
        latePayments: [
          { taskId: "86ewvnqgz", dueOn: "2026-11-02", daysLate: 6 },
          { taskId: "86ewvnqgz", dueOn: "2026-11-08", daysLate: 2 },
          { taskId: "86ex4m5ux", dueOn: "2026-10-07", daysLate: 34 },
        ],
      },
    };
    const values = extract("clients", clients);
    const at = (metric: string, window: string, scope = "company") => values.find(v => v.metric === metric && v.window === window && v.scope === scope)?.value;
    expect(at("clients.extensions.granted", "mtd")).toBe(2);
    expect(at("clients.extensions.granted", "lastMonth")).toBe(1);
    expect(at("clients.churn.confirmed", "mtd")).toBe(1);
    expect(at("clients.churn.rate", "mtd")).toBeCloseTo(2 / 18, 4);
    expect(at("clients.churn.rate", "lastMonth")).toBeNull();
    expect(at("clients.late_payments", "mtd")).toBe(2);
    expect(at("clients.late_payments", "mtd", "client:86ewvnqgz")).toBe(8);
    expect(at("clients.late_payments", "lastMonth")).toBe(1);
    const older = extract("clients", { ...clients, lifecycle: undefined, extensions: { ...clients.extensions, grantRows: undefined } });
    for (const m of ["clients.extensions.granted", "clients.churn.confirmed", "clients.churn.rate", "clients.late_payments"])
      expect(older.some(v => v.metric === m)).toBe(false);
    const failed = extract("clients", { ...clients, lifecycle: { read: false, departures: [], latePayments: [] } });
    expect(failed.some(v => v.metric === "clients.churn.confirmed" || v.metric === "clients.late_payments")).toBe(false);
    const money = extract("money", { rails: { manualLogged: { count: 2, usd: 3494.88, oldestDay: "2026-11-02" } } });
    expect(money.find(v => v.metric === "money.logged_unchecked")).toMatchObject({ window: "snapshot", value: 3494.88 });
    expect(extract("money", { rails: {} }).some(v => v.metric === "money.logged_unchecked")).toBe(false);
  });
});

describe("the goal sheet and the lock-in read the lifecycle", () => {
  test("extensionsGiven is measured from the grants, and a typed day adds to it", async () => {
    const m = await import("../src/pages/ceo/goalsSheetModel");
    expect(m.COLUMN_BY_KEY.extensionsGiven.source).toBe("From the billing sheet and the client page; typed days add to it.");
    const life = m.lifecycleOf({ lifecycle: { extensions: [{ grantId: 301, grantedOn: "2026-11-03" }, { grantId: 302, grantedOn: "2026-11-03" }, { grantId: 303, grantedOn: "2026-11-04" }], latePayments: null, departures: null, missing: ["x"] } });
    expect(m.lifecycleDayParts(life)).toEqual({ "2026-11-03": { extensionsGiven: 2 }, "2026-11-04": { extensionsGiven: 1 } });
    expect(m.dayRow({ extensionsGiven: 2, leads: 5 }, { extensionsGiven: 1, leads: 9 })).toMatchObject({ extensionsGiven: 3, leads: 9 });
    expect(m.dayRow(undefined, { extensionsGiven: 1 })).toMatchObject({ extensionsGiven: 1 });
    expect(m.lifecycleOf({})).toBeNull();
  });

  test("measured lines per section, matched to lock-in rows by card; a section not live is null, not empty", async () => {
    const m = await import("../src/pages/ceo/goalsSheetModel");
    const life = m.lifecycleOf({
      lifecycle: {
        extensions: [{ grantId: 301, taskId: "86eyurepc", client: "Ardon", grantedOn: "2026-11-03", weeks: 2, from: "2026-11-27", until: "2026-12-11", state: "live", reason: "Launch slipped", source: "Given in the cockpit on 3 Nov by the CSM; the grant runs to 11 Dec." }],
        latePayments: [{ taskId: "86ex4m5ux", client: "Nohod", dueOn: "2026-10-07", amountUsd: null, endedOn: null, closedHow: "open", paidOn: null, daysLate: 34, source: "s" }],
        departures: [
          { departureId: 20, taskId: "86eyjkdc8", client: "Atlantis", leftOn: "2026-11-05", reason: "Results", churnType: "mid_programme", whyDetail: "Wanted closed deals", howToStop: "A dated backstop", surveyState: "filled", confirmed: true, confirmedOn: "2026-11-05", source: "Confirmed in the cockpit on 5 Nov; left 5 Nov." },
          { departureId: 21, taskId: "86ewvnqjb", client: "Joe and Sera", leftOn: "2026-11-06", reason: "Non-payment", churnType: null, whyDetail: null, howToStop: null, surveyState: "not_sent", confirmed: false, confirmedOn: null, source: "s" },
        ],
        missing: [],
      },
    });
    expect(m.measuredLines("extensions", life)).toEqual([{ taskId: "86eyurepc", client: "Ardon", value: "2 weeks, 27 Nov to 11 Dec", source: "Given in the cockpit on 3 Nov by the CSM; the grant runs to 11 Dec.", answers: { why: "Launch slipped" } }]);
    expect(m.measuredLines("late_payments", life)?.[0].value).toBe("amount missing due 7 Oct, 34 days late");
    const churned = m.measuredLines("churned", life) ?? [];
    expect(churned.map(l => l.value)).toEqual(["Left 5 Nov, Results", "Left 6 Nov, Non-payment, not confirmed"]);
    expect(churned[0].answers).toEqual({ why: "Wanted closed deals", prevent: "A dated backstop", form: "Filled in." });
    const { byRow, extra } = m.matchMeasured([{ id: 1, client_task_id: "86eyjkdc8" }, { id: 2, client_task_id: "86ezzzzzz" }], churned);
    expect(byRow.get(1)?.client).toBe("Atlantis");
    expect(byRow.has(2)).toBe(false);
    expect(extra.map(l => l.client)).toEqual(["Joe and Sera"]);
    const notLive = m.lifecycleOf({ lifecycle: { extensions: null, latePayments: null, departures: null, missing: ["Extensions are not read"] } });
    expect(m.measuredLines("extensions", notLive)).toBeNull();
    expect(m.manualLoggedOf({ manualLogged: { count: 2, usd: 3494.88, oldestDay: "2026-11-02" } })).toEqual({ count: 2, usd: 3494.88, oldestDay: "2026-11-02" });
    expect(m.manualLoggedOf({ manualLogged: null })).toBeNull();
  });

  test("the lock-in's 'Logged, not checked' line under Total new cash, and 'not read yet' when the refresh has not written it", async () => {
    const env = [process.env, (import.meta as any).env].filter(Boolean);
    for (const e of env) Object.assign(e, { VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co", VITE_SUPABASE_ANON_KEY: "test-placeholder-key" });
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { LoggedLine, Measured } = await import("../src/pages/ceo/goalsLockIn");
    const html = renderToStaticMarkup(createElement(LoggedLine, { logged: { count: 2, usd: 3494.88, oldestDay: "2026-11-02" } }));
    expect(html).toContain("Logged, not checked");
    expect(html).toContain("$3,495 (2)");
    expect(html).toContain("Not in the total until finance or the CEO checks each one against the bank.");
    const none = renderToStaticMarkup(createElement(LoggedLine, { logged: null }));
    expect(none).toContain("Logged, not checked: not read yet.");
    expect(none).not.toContain("$0");
    const measured = renderToStaticMarkup(createElement(Measured, { line: { taskId: "t", client: "Ardon", value: "2 weeks, 27 Nov to 11 Dec", source: "Given in the cockpit on 3 Nov by the CSM.", answers: {} } }));
    expect(measured).toContain("Measured");
    expect(measured).toContain("2 weeks, 27 Nov to 11 Dec");
  });
});

describe("pay: a commission line on unchecked cash waits", () => {
  const person = (over: Record<string, unknown> = {}) =>
    ({ personId: 7, name: "Closer", status: "ready", totalUsd: 1200, approval: null, missing: [], parts: [], notPriced: [], plan: { source: "role" }, commission: [{ line: 1, basis: "closed_cash", evidence: ["resp-1"], payments: [] }], ...over }) as any;
  const facts = (checked: boolean | undefined) => ({
    sales: { deals: [{ responseId: "resp-1", payments: [{ id: "p1", rail: "whop", usd: 2000, ...(checked === undefined ? {} : { checked: true }) }, { id: "p2", rail: "manual", usd: 3494.88, ...(checked === undefined ? {} : { checked }) }] }] },
  });

  test("a logged payment behind the line gives the chip and keeps the person out of Approve", async () => {
    const copy = await import("../src/pages/ceo/pay/payCopy");
    expect(copy.CASH_NOT_CHECKED).toBe("Cash not checked yet");
    const p = person();
    expect(copy.uncheckedCash(p.commission[0], facts(false))).toEqual({ count: 1, usd: 3494.88 });
    expect(copy.cashCheckSentence({ count: 1, usd: 3494.88 })).toBe("1 hand-logged payment ($3,494.88) behind this line is not checked against the bank yet. Finance or the CEO checks it on the Money tab; the line counts once checked.");
    const month = { month: "2026-11-01", people: [p], facts: facts(false) } as any;
    expect(copy.approvable(month)).toEqual([]);
    expect(copy.whyNotApproved(p, month.facts)).toContain("cash not checked yet");
  });

  test("once checked, or on a ledger from before the check, the line is approvable as before", async () => {
    const copy = await import("../src/pages/ceo/pay/payCopy");
    const p = person();
    for (const f of [facts(true), facts(undefined)]) {
      expect(copy.uncheckedCash(p.commission[0], f)).toBeNull();
      expect(copy.approvable({ month: "2026-11-01", people: [p], facts: f } as any).map(x => x.name)).toEqual(["Closer"]);
      expect(copy.whyNotApproved(p, f)).toBeNull();
    }
    expect(copy.manualLoggedOfFacts({ money: { manualLogged: { count: 2, usd: 3494.88, oldestDay: null } } })).toEqual({ count: 2, usd: 3494.88, oldestDay: null });
    expect(copy.manualLoggedOfFacts({})).toBeNull();
  });
});
