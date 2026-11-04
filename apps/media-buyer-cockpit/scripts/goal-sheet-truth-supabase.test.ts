/**
 * Goals sheet round 2 (2026-11-02): supabase/migrations/20261102m_goal_sheet_truth.sql against PGlite.
 * The audit is hw-notes/goals-sheet/truth/SYNTHESIS.md (fixes 1, 4, 5, 6, 10).
 *
 * The ground is the goal sheet as production built it, in migration order: the core's metric days
 * (20260919), people, the registry (20260921d), goals (20260922e), the goals gate (20260926l), the
 * goal sheet (20261030a), then 20261101q_readers.sql, whose body is the live one m replaces. Tables
 * the sheet reads that no migration here creates are the readers test's stubs, and the two lifecycle
 * views are tables shaped as their contract (as readers-supabase.test.ts does). m is applied first
 * while the stores it reads from other slices (the wins ledger, the closer's EODs, the CEO's
 * exclusions, the Ecom invoices) are not there, then again once they are: real table definitions cut
 * from 20261102h, 20260924o and 20261024p, and cockpit_wins_v as a table shaped as the view. The CEO's
 * address is read from the CEO gate migration; every client, payment and number is invented.
 *
 * 2026-11-02 (fix 11, m amended before any apply): the growth payload starts as live publishes it today
 * (no frontEndMonths, no frontEndCash on the windows), then gains both as the CEO refresh release
 * publishes them, so frontEndMonths is checked absent, present, empty and cut to the tab's two months.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

setDefaultTimeout(60_000);

let db: PGlite;
const founder = "00000000-0000-4000-8000-000000000001";
const csm = "00000000-0000-4000-8000-000000000009";
const Q = "20261101q_readers.sql";
const M = "20261102m_goal_sheet_truth.sql";
/** The live body on 2026-11-02 (pg_get_functiondef, read-only), equal to q's. */
const LIVE_MD5 = "5be4703416750ab41d8a6032916ed97f";
/** m's own body (2026-11-02, with frontEndMonths and the windows' frontEndCash): the guard's second hash. */
const M_MD5 = "9317c8f0c73e1c7dc989c92055abc175";
const TEST_PAYMENT = "ecom:INV_20261023ma6YMqMr";

/** The CEO gate's own address (20260923m), so no address is written here. */
const CEO_EMAIL = (() => {
  const hit = migration("20260923m_cockpit_ceo_gate.sql").match(
    /IN \(\s*'([^']+@[^']+)'/,
  );
  if (!hit) throw new Error("The CEO gate names no address");
  return hit[1];
})();

function cut(file: string, pattern: RegExp, what: string): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what} in ${file}`);
  return hit[0];
}

type Ctx = Record<string, any>;

const bodyMd5 = async () =>
  (
    await db.query<{ v: string }>(
      "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS v FROM pg_proc p WHERE p.oid = 'public.cockpit_ceo_goal_sheet_context(text)'::regprocedure",
    )
  ).rows[0].v;

async function context(month: string): Promise<Ctx> {
  await actor(db, founder);
  try {
    const r = await db.query<{ c: Ctx }>(
      "SELECT public.cockpit_ceo_goal_sheet_context($1) AS c",
      [month],
    );
    return r.rows[0].c;
  } finally {
    await owner(db);
  }
}

async function one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  await owner(db);
  return (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
}

const count = (sql: string, params: unknown[] = []) =>
  one<number>(`SELECT (${sql})::int AS r`, params);

/** The keys the context returned before m, each built the same way after it. */
const OLD_KEYS = [
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
  "lifecycle",
  "manualLogged",
] as const;
const NEW_KEYS = [
  "cashExcluded",
  "winsDaily",
  "upsellCashDaily",
  "upsellContracted",
  "refundsDaily",
  "salesEodDaily",
  "extensionsDaily",
  "softwareByMonth",
  "frontEndMonths",
  "readsMissing",
] as const;

/** A window entry as q built it: m adds frontEndCash beside from and raw (2026-11-02, fix 11). */
const qWindows = (c: Ctx) =>
  (c.windows ?? []).map(({ frontEndCash: _, ...w }: Ctx) => w);

/**
 * cashDaily and cells are aggregated without an order (as live); compare them as sets. The windows
 * are compared without frontEndCash, which the tests check on their own.
 */
function oldPart(c: Ctx) {
  const out: Ctx = {};
  for (const k of OLD_KEYS) out[k] = c[k];
  out.windows = qWindows(c);
  out.cashDaily = [...(c.cashDaily ?? [])].sort((a: any, b: any) =>
    a.date.localeCompare(b.date),
  );
  out.cells = [...(c.cells ?? [])].sort((a: any, b: any) =>
    `${a.day}${a.key}`.localeCompare(`${b.day}${b.key}`),
  );
  return out;
}

/** The tables the sheet reads that no migration here creates, shaped as live (readers-supabase.test.ts). */
const STUBS = `
CREATE TABLE IF NOT EXISTS public.cockpit_media_daily_stats (day date, data jsonb);
CREATE TABLE IF NOT EXISTS public.cockpit_client_days (day date, closes numeric, lead_quality_sum numeric, lead_quality_count numeric);
CREATE TABLE IF NOT EXISTS public.cockpit_churn_months (month text PRIMARY KEY, active_at_start integer, lost_before_register integer);
CREATE TABLE IF NOT EXISTS public.cockpit_churn_departures (
  id bigserial PRIMARY KEY, client text NOT NULL, clickup_task_id text, left_on date NOT NULL, launched_on date,
  reason text NOT NULL, mrr_lost_usd numeric, csm text, note text, source text, created_by text,
  created_at timestamptz DEFAULT now(), updated_by text, updated_at timestamptz, removed_at timestamptz,
  removed_by text, removed_why text);
CREATE TABLE IF NOT EXISTS public.cockpit_csm_call_forms (
  token text PRIMARY KEY, form_id text NOT NULL, form_kind text NOT NULL, task_id text,
  submitted_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_id_check;
ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_id_check
  CHECK (form_id = ANY (ARRAY['fRokTITH','KFRCXPFx','tG7dnxBn','BbJy6xg4','oYZKtogO','cockpit-checkin']));
ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_kind_check;
ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_kind_check
  CHECK (form_kind = ANY (ARRAY['checkin','onboarding','kickoff','kickoff_old','blueprint','checkin_late']));
`;

/** The lifecycle views as tables shaped as their contract (WAVE12-CONTRACT 3.2, 2.6), as the readers test. */
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
INSERT INTO public.cockpit_extensions_v(grant_id,clickup_task_id,client_name,granted_on,weeks,from_date,until,reason,seat_role,state) VALUES
  (200,'taskS1','September Co','2026-09-25',1,'2026-09-25','2026-10-02','Launch slipped','csm','ended'),
  (115,'taskL1','Liwan Test','2026-10-19',2,'2026-10-19','2026-11-02','Ad account broke','the CSM','ended'),
  (301,'taskA1','Acme Interiors','2026-11-03',2,'2026-11-27','2026-12-11','Launch slipped','csm','live'),
  (302,'taskB1','Beta Build','2026-11-04',1,'2026-11-04','2026-11-11','Budget','ceo','replaced');
INSERT INTO public.cockpit_churn_departures(client,clickup_task_id,left_on,reason,churn_type,survey_state) VALUES
  ('Gone Co','taskG1','2026-10-18','Results','mid_programme','not_sent');
`;

/** Money in and out as the money refresh publishes it (attribution.transactions), invented. */
const MONEY = {
  rails: { manualLogged: { count: 1, usd: 250, oldestDay: "2026-11-01" } },
  book: {
    month: "2026-11",
    projectedMrr: 1000,
    collected: 0,
    history: [{ month: "2026-10", projected: 1500, collected: 700 }],
  },
  monthly: [
    { month: "2026-10", refunds: 300 },
    { month: "2026-11", refunds: 80 },
  ],
  bank: { lastStatementTo: "2026-10-02" },
  attribution: {
    from: "2026-06-01",
    to: "2026-11-02",
    transactions: [
      {
        id: "whop:pay_A",
        day: "2026-10-05",
        direction: "in",
        side: "front_end",
        rail: "whop",
        kind: "deposit",
        usd: 1000,
      },
      // Left out on a client's deal (the website, as Castello's of 21 Aug): still that client's money.
      {
        id: "whop:pay_web",
        day: "2026-10-12",
        direction: "in",
        side: "front_end",
        rail: "whop",
        kind: "remainder",
        usd: 1500,
      },
      // An exclusion withdrawn since: counts again.
      {
        id: "whop:pay_unk",
        day: "2026-10-14",
        direction: "in",
        side: "unattributed",
        rail: "whop",
        kind: "none",
        usd: 200,
      },
      // The CEO's own 1 KWD test beside a client's payment on the same day.
      {
        id: TEST_PAYMENT,
        day: "2026-10-23",
        direction: "in",
        side: "unattributed",
        rail: "ecom",
        kind: "none",
        usd: 3.26,
      },
      {
        id: "tap:chg_B",
        day: "2026-10-23",
        direction: "in",
        side: "back_end",
        rail: "tap",
        kind: "client",
        usd: 500,
      },
      // A bank line matched to nobody: never client cash (the old rule).
      {
        id: "bank:L1",
        day: "2026-10-24",
        direction: "in",
        side: "unattributed",
        rail: "bank",
        kind: "none",
        usd: 99,
      },
      {
        id: "whop:pay_nov",
        day: "2026-11-01",
        direction: "in",
        side: "back_end",
        rail: "whop",
        kind: "client",
        usd: 700,
      },
      {
        id: "whop-refund:pay_X",
        day: "2026-10-20",
        direction: "out",
        side: "out",
        rail: "whop",
        kind: "refund",
        usd: 300,
      },
      {
        id: "whop-refund:pay_Y",
        day: "2026-11-01",
        direction: "out",
        side: "out",
        rail: "whop",
        kind: "refund",
        usd: 80,
      },
      {
        id: "manual-refund:7",
        day: "2026-11-01",
        direction: "out",
        side: "out",
        rail: "manual",
        kind: "refund",
        usd: 120,
      },
      {
        id: "bank:out1",
        day: "2026-10-21",
        direction: "out",
        side: "out",
        rail: "bank",
        kind: "expense",
        usd: 50,
      },
    ],
  },
};
const GROWTH = {
  daily: [
    { date: "2026-10-02", spend: 50, leads: 2 },
    { date: "2026-11-01", spend: 84.34, leads: 3 },
  ],
  windows: {
    mtd: { from: "2026-11-01", raw: { spend: 84.34 } },
    lastMonth: { from: "2026-10-01", raw: { spend: 1654.51 } },
  },
};
const DELIVERY = { daily: [{ date: "2026-10-03", spend: 400, leads: 30 }] };

/**
 * The growth payload once the CEO refresh release publishes front-end cash by month (2026-11-02, fix
 * 11): each window's frontEndCash with paidOnWindowDeals, and frontEndMonths from September, in no
 * particular order and with one entry that names no month. Invented numbers.
 */
const FRONT_END_MTD = {
  paid: 900,
  total: 900,
  paidDeposit: 600,
  paidRemainder: 300,
  payments: 2,
  paidDeals: 2,
  paidOnWindowDeals: 600,
  byRail: { whop: 600, tap: 300 },
  byCloser: [{ name: "Closer A", usd: 900, payments: 2 }],
  typed: { deposit: 500, kickoff: null },
  typedNotSeen: { count: 0, usd: 0 },
  attributedAt: "2026-11-02T09:00:00Z",
};
const FRONT_END_LAST_MONTH = {
  ...FRONT_END_MTD,
  paid: 6000,
  total: 6000,
  paidOnWindowDeals: 5000,
  byCloser: [{ name: "Closer A", usd: 6000, payments: 5 }],
};
const FRONT_END_MONTHS = [
  { month: "2026-11", paid: 900, paidOnWindowDeals: 600 },
  { month: "2026-09", paid: 4000, paidOnWindowDeals: 3100 },
  { month: "2026-10", paid: 6000, paidOnWindowDeals: 5000 },
  { paid: 1 },
];
const GROWTH_R2 = {
  ...GROWTH,
  windows: {
    mtd: { ...GROWTH.windows.mtd, frontEndCash: FRONT_END_MTD },
    lastMonth: {
      ...GROWTH.windows.lastMonth,
      frontEndCash: FRONT_END_LAST_MONTH,
    },
  },
  frontEndMonths: FRONT_END_MONTHS,
};

/** Replace a refresh section's payload, as the CEO refresh writes it. */
async function section(key: string, payload: unknown, ok = true) {
  await owner(db);
  await db.query(
    "UPDATE public.cockpit_sections SET payload=$2, ok=$3, computed_at=now() WHERE key=$1",
    [key, JSON.stringify(payload), ok],
  );
}

let currentMonth = "";
let previousMonth = "";
let futureMonth = "";
let today = "";
const before: Record<string, Ctx> = {};
let months: string[] = [];

beforeAll(async () => {
  db = await cockpitTestDb();
  await db.exec(
    cut(
      "20260919_cockpit_core.sql",
      /create table if not exists public\.cockpit_metric_days \([\s\S]*?\n\);/,
      "metric days",
    ),
  );
  await db.exec(
    cut(
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i,
      "people",
    ),
  );
  for (const name of [
    "20260922e_goals_and_people.sql",
    "20260921d_cockpit_metrics.sql",
    "20260926l_cockpit_ceo_goals_access.sql",
  ])
    await db.exec(migration(name));
  await db.exec(
    cut(
      "20261002a_cost_lines.sql",
      /create table if not exists public\.cockpit_cost_lines \([\s\S]*?\n\);/,
      "cost lines",
    ),
  );
  await db.exec(STUBS);
  await db.exec(LIFECYCLE);
  await db.exec(migration("20261030a_goal_sheet.sql"));
  await db.exec(migration(Q));
  await member(db, founder, CEO_EMAIL, []);
  await member(db, csm, "csm@tests.invalid", ["csm"]);
  await owner(db);

  for (const [from, to, title] of [
    ["2026-10-01", "2026-10-31", "October 2026 plan"],
    ["2026-11-01", "2026-11-30", "November 2026 plan"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_goal_plans(period_kind,period_from,period_to,title,status,created_by) VALUES ('month',$1,$2,$3,'draft','test')",
      [from, to, title],
    );
  await db.query(
    "INSERT INTO public.cockpit_goal_targets(plan_id,group_key,metric_key,label,unit,direction,target,sort) SELECT id,'front_end','leads','Leads','count','up',100,1 FROM public.cockpit_goal_plans",
  );
  await db.query(
    "INSERT INTO public.cockpit_goal_sheet_cells(day,metric_key,kind,value,note,updated_by) VALUES ('2026-10-19','extensionsGiven','actual',3,'typed','test'),('2026-11-01','offersMade','actual',1,NULL,'test')",
  );
  for (const [key, payload] of [
    ["money", MONEY],
    ["growth", GROWTH],
    ["delivery", DELIVERY],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_sections(key,label,ok,payload,computed_at) VALUES ($1,$1,true,$2,now())",
      [key, JSON.stringify(payload)],
    );
  // Today's lines: two active USD software lines (100 x 2 seats monthly, 1,200 yearly = 100 a month);
  // a cancelled one, a KWD one and an overhead one are not software overhead in USD.
  await db.exec(`INSERT INTO public.cockpit_cost_lines(kind,name,billing,seats,unit_price,currency,status) VALUES
    ('software','Tool A','monthly',2,100,'USD','active'),
    ('software','Tool B','yearly',NULL,1200,'USD','active'),
    ('software','Tool C','monthly',1,50,'USD','cancelled'),
    ('software','Tool D','monthly',1,30,'KWD','active'),
    ('overhead','Office','monthly',1,999,'USD','active');`);

  const t = await one<string>(
    "SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS r",
  );
  today = t;
  currentMonth = t.slice(0, 7);
  previousMonth = await one<string>(
    "SELECT to_char(date_trunc('month', $1::date) - interval '1 month', 'YYYY-MM') AS r",
    [t],
  );
  futureMonth = await one<string>(
    "SELECT to_char(date_trunc('month', $1::date) + interval '2 month', 'YYYY-MM') AS r",
    [t],
  );
  months = [...new Set(["2026-10", "2026-11", currentMonth, futureMonth])];
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the drift guard and the apply", () => {
  test("the repo's q body is the live body this file was written against", async () => {
    expect(await bodyMd5()).toBe(LIVE_MD5);
    for (const m of months) before[m] = await context(m);
  });

  test("m applies over the live body, then again over its own, and its after md5 is the one in its guard", async () => {
    await owner(db);
    await db.exec(migration(M));
    const after = await bodyMd5();
    expect(after).not.toBe(LIVE_MD5);
    expect(after).toBe(M_MD5);
    expect(migration(M).includes(`v IS DISTINCT FROM '${after}'`)).toBe(true);
    // The draft before frontEndMonths was applied nowhere (2026-11-02): its hash is not let through.
    expect(migration(M)).not.toContain("742102665965e8ae5a078df4dd31ea57");
    await db.exec(migration(M));
    expect(await bodyMd5()).toBe(after);
  });

  test("a changed body is refused with the stop-and-re-read sentence", async () => {
    await owner(db);
    const def = (
      await db.query<{ d: string }>(
        "SELECT pg_get_functiondef('public.cockpit_ceo_goal_sheet_context(text)'::regprocedure) AS d",
      )
    ).rows[0].d;
    await db.exec(def.replace("'readsMissing'", "'readsMissing2'"));
    await expect(db.exec(migration(M))).rejects.toThrow(
      /changed since the goals sheet round 2 read it/,
    );
    await db.exec("ROLLBACK");
    await db.exec(def);
    expect(migration(M).includes(await bodyMd5())).toBe(true);
  });

  test("SECURITY DEFINER, search_path '' and the grants stay as live: authenticated and service_role, never anon", async () => {
    const r = await one<{ acl: string; secdef: boolean; config: string[] }>(
      "SELECT jsonb_build_object('acl', proacl::text, 'secdef', prosecdef, 'config', proconfig) AS r FROM pg_proc WHERE oid='public.cockpit_ceo_goal_sheet_context(text)'::regprocedure",
    );
    expect(r.secdef).toBe(true);
    expect(r.config).toEqual(['search_path=""']);
    expect(r.acl).toContain("authenticated=X");
    expect(r.acl).toContain("service_role=X");
    expect(r.acl).not.toContain("anon=");
    expect(r.acl).not.toMatch(/(^|[{,])=X/);
  });

  test("the CEO gate holds: a CSM and anon are refused", async () => {
    await actor(db, csm);
    await expect(
      db.query("SELECT public.cockpit_ceo_goal_sheet_context('2026-11')"),
    ).rejects.toThrow(/founder access/i);
    await actor(db, null);
    await expect(
      db.query("SELECT public.cockpit_ceo_goal_sheet_context('2026-11')"),
    ).rejects.toThrow();
    await owner(db);
  });
});

describe("before the stores m reads from other slices are live", () => {
  test("every old key is exactly what q returned, for October, November, this month and a future month", async () => {
    for (const m of months) {
      const c = await context(m);
      expect(oldPart(c)).toEqual(oldPart(before[m]));
      for (const k of NEW_KEYS) expect(Object.keys(c)).toContain(k);
      // The windows are q's, each with frontEndCash null: growth publishes none yet (live today).
      expect(c.windows).toEqual(
        before[m].windows.map((w: Ctx) => ({ ...w, frontEndCash: null })),
      );
    }
  });

  test("a store that is not live is null with its sentence, never an empty list", async () => {
    const c = await context("2026-11");
    expect(c.cashExcluded).toBeNull();
    expect(c.winsDaily).toBeNull();
    expect(c.upsellContracted).toBeNull();
    expect(c.upsellCashDaily).toBeNull();
    expect(c.salesEodDaily).toBeNull();
    // Growth as live publishes it today has no frontEndMonths: null with its sentence, not [].
    expect(c.frontEndMonths).toBeNull();
    const said = c.readsMissing.join(" ");
    for (const migrationName of ["20261024p", "20261102h", "20260924o"])
      expect(said).toContain(migrationName);
    expect(c.readsMissing).toContain(
      "Front-end cash by month is not read: the growth refresh does not publish frontEndMonths yet (the CEO refresh release of 2 Nov 2026), so UF cash % on the month's own deals is not known.",
    );
    expect(c.readsMissing).toHaveLength(5);
    // The lifecycle's own sentences are untouched: its views are live here.
    expect(c.lifecycle.missing).toEqual([]);
  });

  test("the October software point is written once, with one audit row", async () => {
    const point = await one(
      "SELECT jsonb_build_object('value', value, 'at', captured_at) AS r FROM public.cockpit_metric_days WHERE day='2026-10-01' AND metric='costs.software.monthly' AND scope='company'",
    );
    expect(point.value).toBe(5324.74);
    expect(new Date(point.at).toISOString()).toBe("2026-10-30T17:53:17.864Z");
    expect(
      await count(
        "SELECT count(*) FROM public.cockpit_audit_log WHERE action='metric.backfill' AND entity_id='2026-10-01|costs.software.monthly|company'",
      ),
    ).toBe(1);
  });
});

/** The four stores, as their own migrations make them (cockpit_wins_v as a table shaped as the view). */
async function makeStores() {
  await owner(db);
  await db.exec(
    cut(
      "20260924o_sales_eod.sql",
      /create table if not exists public\.cockpit_sales_eods \([\s\S]*?\n\);/,
      "sales eods",
    ),
  );
  await db.exec(
    "CREATE TABLE public.cockpit_upsell_proposals (id uuid PRIMARY KEY)",
  );
  await db.exec(
    cut(
      "20261102h_wins_pay.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_wins \([\s\S]*?\n\);/,
      "wins",
    ),
  );
  // 2026-11-02: the events and the ledger's own day rule, which date an upsell by its signing.
  await db.exec(
    cut(
      "20261102h_wins_pay.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_win_events \([\s\S]*?\n\);/,
      "win events",
    ),
  );
  await db.exec(
    cut(
      "20261102h_wins_pay.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_win_event_day\([\s\S]*?\n\$\$;/,
      "event day",
    ),
  );
  await db.exec(`CREATE TABLE public.cockpit_wins_v (
    id uuid, task_id text, client_name text, kind text, stage text, won_on date, quoted_usd numeric, recurring boolean,
    monthly_usd numeric, csm_person_id bigint, tied_checked_usd numeric, paid_on date, imported boolean, offered_on date,
    accepted_on date, ties jsonb, source text);`);
  await db.exec(
    cut(
      "20261009a_cockpit_team_hours.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_hours_refuse_delete\(\)[\s\S]*?\$\$;/,
      "refuse delete",
    ),
  );
  await db.exec(
    cut(
      "20261023x_billing_balances.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_billing_balance_row_lock\(\)[\s\S]*?END \$\$;/,
      "row lock",
    ),
  );
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_billing_payment_exclusions \([\s\S]*?\n\);/,
      "exclusions",
    ],
    [
      /CREATE UNIQUE INDEX IF NOT EXISTS cockpit_billing_payment_exclusions_live[\s\S]*?;/,
      "one live row",
    ],
    [
      /DROP TRIGGER IF EXISTS cockpit_billing_payment_exclusions_guard_delete[\s\S]*?cockpit_billing_balance_row_lock\('withdrawn_by', 'withdrawn_at', 'withdrawn_reason'\);/,
      "guards",
    ],
    [
      /ALTER TABLE public\.cockpit_billing_payment_exclusions ENABLE ROW LEVEL SECURITY;[\s\S]*?REVOKE ALL ON SEQUENCE public\.cockpit_billing_payment_exclusions_id_seq[^;]*;/,
      "row security",
    ],
  ] as const)
    await db.exec(
      cut("20261024p_billing_payment_exclusions.sql", pattern, what),
    );
  await db.exec(`CREATE TABLE public.cockpit_ecom_invoices (
    id text PRIMARY KEY, invoice_number text, status text, amount_kwd numeric, currency text, usd numeric, day date,
    description text, paid_at timestamptz);`);
}

let n = 0;
/**
 * One win, with its events as cockpit_csm_win_log and cockpit_csm_win_stage write them: offered (an
 * upsell) or logged on its won day, and accepted on `accepted` (Kuwait day; the won day when not
 * given) for a signed or paid upsell. `noAccept` leaves the accepted event out (never live).
 */
async function win(w: {
  task?: string;
  kind: string;
  stage: string;
  won: string;
  quoted?: number;
  source?: string;
  imported?: string;
  accepted?: string;
  noAccept?: boolean;
}) {
  n++;
  const upsell = w.kind.startsWith("upsell_");
  await owner(db);
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO public.cockpit_csm_wins(request_id,task_id,client_name,kind,stage,won_on,quoted_usd,agreement_url,
       referral_deal_response_id,source,imported_from,logged_by_role,voided_at,void_reason)
     VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'csm',$11,$12) RETURNING id`,
      [
        w.task ?? "taskA1",
        `Client ${n}`,
        w.kind,
        w.stage,
        w.won,
        w.quoted ?? null,
        upsell && ["signed", "paid"].includes(w.stage)
          ? "https://example.invalid/agreement"
          : null,
        w.kind === "referral" && w.source !== "import" ? `deal-${n}` : null,
        w.source ?? "cockpit",
        w.imported ?? null,
        w.stage === "void" ? "2026-11-02T08:00:00Z" : null,
        w.stage === "void" ? "Logged twice" : null,
      ],
    )
  ).rows[0].id;
  const event = (name: string, day: string) =>
    db.query(
      "INSERT INTO public.cockpit_csm_win_events(win_id,event,by_role,at) VALUES ($1,$2,'csm',$3::timestamptz)",
      [id, name, `${day}T12:00:00+03:00`],
    );
  await event(upsell ? "offered" : "logged", w.won);
  if (upsell && ["signed", "paid"].includes(w.stage) && !w.noAccept)
    await event("accepted", w.accepted ?? w.won);
  return id;
}

describe("with the stores live", () => {
  beforeAll(async () => {
    await makeStores();
    // The CEO refresh release now publishes front-end cash by month (2026-11-02, fix 11).
    await section("growth", GROWTH_R2);
    // Wins: what counts and what never does.
    await win({ kind: "review", stage: "logged", won: "2026-10-28" }); // backdated before the ledger opened
    await win({ kind: "review", stage: "logged", won: "2026-11-03" });
    await win({
      kind: "review",
      stage: "logged",
      won: "2026-11-03",
      task: "taskB1",
    });
    await win({
      kind: "video_testimonial",
      stage: "logged",
      won: "2026-11-04",
    });
    await win({ kind: "referral", stage: "logged", won: "2026-11-04" });
    await win({
      kind: "upsell_website",
      stage: "signed",
      won: "2026-11-05",
      quoted: 1200,
    });
    // Offered on 5 Nov, signed on 8 Nov: counted on the 8th.
    await win({
      kind: "upsell_smm",
      stage: "paid",
      won: "2026-11-05",
      accepted: "2026-11-08",
      quoted: 800,
    });
    // Offered on 27 Nov, signed on 2 Dec: December's upsell, never November's (finding 1, 2026-11-02).
    await win({
      kind: "upsell_website",
      stage: "signed",
      won: "2026-11-27",
      accepted: "2026-12-02",
      quoted: 1500,
      task: "taskE1",
    });
    await win({
      kind: "upsell_seo_geo",
      stage: "quote_given",
      won: "2026-11-05",
      quoted: 500,
    }); // a quote is not a sale
    await win({
      kind: "upsell_backend",
      stage: "void",
      won: "2026-11-05",
      quoted: 900,
    });
    await win({ kind: "review", stage: "void", won: "2026-11-06" });
    await win({
      kind: "review",
      stage: "logged",
      won: "2026-11-06",
      source: "canary",
      task: "86eywg1cq",
    });
    await win({
      kind: "review",
      stage: "logged",
      won: "2026-11-06",
      task: "86eywg1cq",
    }); // the internal test card
    await win({
      kind: "review",
      stage: "void",
      won: "2026-05-05",
      source: "import",
      imported: "typeform:ETEynRgb:resp1",
    });
    await win({ kind: "review", stage: "logged", won: "2026-12-01" }); // after both tabs
    // Ties as cockpit_win_tie_facts gives them.
    await db.exec(`INSERT INTO public.cockpit_wins_v(id,task_id,client_name,kind,stage,won_on,quoted_usd,tied_checked_usd,paid_on,ties,source) VALUES
      (gen_random_uuid(),'taskA1','A','upsell_website','paid','2026-11-05',1200,600,'2026-11-06',
        '[{"paymentId":"whop:p1","rail":"whop","usd":600,"paidOn":"2026-11-06","checked":true},{"paymentId":"whop:p2","rail":"whop","usd":600,"paidOn":"2026-11-07","checked":false}]','cockpit'),
      (gen_random_uuid(),'taskB1','B','upsell_smm','paid','2026-11-05',800,800,'2026-11-06',
        '[{"paymentId":"tap:c1","rail":"tap","usd":800,"paidOn":"2026-11-06","checked":true}]','cockpit'),
      (gen_random_uuid(),'taskC1','C','upsell_backend','paid','2026-10-29',250,250,'2026-10-30',
        '[{"paymentId":"manual:m1","rail":"manual","usd":250,"paidOn":"2026-10-30","checked":true}]','cockpit'),
      (gen_random_uuid(),'taskA1','A','review','logged','2026-11-03',NULL,50,'2026-11-06',
        '[{"paymentId":"whop:p3","rail":"whop","usd":50,"paidOn":"2026-11-06","checked":true}]','cockpit'),
      (gen_random_uuid(),'86eywg1cq','Test','upsell_smm','paid','2026-11-05',100,100,'2026-11-06',
        '[{"paymentId":"whop:p4","rail":"whop","usd":100,"paidOn":"2026-11-06","checked":true}]','canary'),
      (gen_random_uuid(),'taskD1','D','upsell_website','signed','2026-11-05',300,0,NULL,NULL,'cockpit');`);
    // The closer's EODs: two closers on one day, a zero, a non-number, a draft and a setter.
    await db.exec(`INSERT INTO public.cockpit_sales_eods(email,name,role,day,answers,submitted_at) VALUES
      ('closer.a@tests.invalid','Closer A','closer','2026-10-14','{"offers":3}',now()),
      ('closer.b@tests.invalid','Closer B','closer','2026-10-14','{"offers":2}',now()),
      ('closer.a@tests.invalid','Closer A','closer','2026-10-21','{"offers":0}',now()),
      ('closer.a@tests.invalid','Closer A','closer','2026-10-22','{"offers":"2"}',now()),
      ('closer.a@tests.invalid','Closer A','closer','2026-10-23','{"offers":4}',NULL),
      ('setter.a@tests.invalid','Setter A','setter','2026-10-14','{}',now()),
      ('closer.a@tests.invalid','Closer A','closer','2026-11-01','{"offers":1}',now()),
      ('closer.a@tests.invalid','Closer A','closer','2026-08-30','{"offers":9}',now());`);
    // The CEO's earlier marks: one on a client's deal (stays money in), one withdrawn since.
    await db.exec(`INSERT INTO public.cockpit_billing_payment_exclusions(payment_id,clickup_task_id,deal_response_id,reason,note,set_by) VALUES
      ('whop:pay_web','taskW1','dealW1','website','The website, sold beside the program','ceo@tests.invalid'),
      ('whop:pay_unk','taskU1','dealU1','other','Thought it was not ours','ceo@tests.invalid');
      UPDATE public.cockpit_billing_payment_exclusions SET withdrawn_by='ceo@tests.invalid', withdrawn_at=now(), withdrawn_reason='It was ours after all'
       WHERE payment_id='whop:pay_unk';`);
  });

  test("an Ecom invoice that is no longer the 1 KWD test is refused, and nothing is written", async () => {
    await owner(db);
    await db.exec(
      "INSERT INTO public.cockpit_ecom_invoices(id,invoice_number,status,amount_kwd,currency,usd,day,description) VALUES ('INV_20261023ma6YMqMr','T1','PAID',1.000,'KWD',3.30,'2026-10-23','Mahara payment test')",
    );
    await expect(db.exec(migration(M))).rejects.toThrow(
      /read it again before applying/,
    );
    await db.exec("ROLLBACK");
    expect(
      await count(
        "SELECT count(*) FROM public.cockpit_billing_payment_exclusions WHERE payment_id=$1",
        [TEST_PAYMENT],
      ),
    ).toBe(0);
    await db.exec(
      "UPDATE public.cockpit_ecom_invoices SET usd=3.26 WHERE id='INV_20261023ma6YMqMr'",
    );
  });

  test("the test payment is left out once, with its audit row, and a second and third apply write nothing", async () => {
    await owner(db);
    await db.exec(migration(M));
    const row = await one(
      "SELECT to_jsonb(x) AS r FROM public.cockpit_billing_payment_exclusions x WHERE payment_id=$1",
      [TEST_PAYMENT],
    );
    expect(row).toMatchObject({
      clickup_task_id: "none",
      deal_response_id: "none",
      reason: "other",
      set_by: "migration 20261102m",
      event_id: null,
      withdrawn_at: null,
    });
    expect(row.note).toContain("1 KWD Ecom test");
    const audit = () =>
      count(
        "SELECT count(*) FROM public.cockpit_audit_log WHERE action='billing.exclude' AND entity_type='cockpit_billing_payment_exclusions'",
      );
    const backfill = () =>
      count(
        "SELECT count(*) FROM public.cockpit_audit_log WHERE action='metric.backfill'",
      );
    expect(await audit()).toBe(1);
    const md5 = await bodyMd5();
    for (let i = 0; i < 2; i++) await db.exec(migration(M));
    expect(
      await count(
        "SELECT count(*) FROM public.cockpit_billing_payment_exclusions WHERE payment_id=$1",
        [TEST_PAYMENT],
      ),
    ).toBe(1);
    expect(await audit()).toBe(1);
    expect(await backfill()).toBe(1);
    expect(
      await count(
        "SELECT count(*) FROM public.cockpit_metric_days WHERE metric='costs.software.monthly'",
      ),
    ).toBe(1);
    expect(await bodyMd5()).toBe(md5);
  });

  test("money in leaves out only the test payment: the client's website payment, the withdrawn mark and bank lines keep their old rule", async () => {
    const c = await context("2026-10");
    const was = Object.fromEntries(
      before["2026-10"].cashDaily.map((d: any) => [d.date, d.usd]),
    );
    const now = Object.fromEntries(
      c.cashDaily.map((d: any) => [d.date, d.usd]),
    );
    expect(was).toEqual({
      "2026-10-05": 1000,
      "2026-10-12": 1500,
      "2026-10-14": 200,
      "2026-10-23": 503.26,
    });
    expect(now).toEqual({ ...was, "2026-10-23": 500 });
    expect(c.cashExcluded).toEqual([
      {
        date: "2026-10-23",
        id: TEST_PAYMENT,
        rail: "ecom",
        usd: 3.26,
        reason: "other",
        note: expect.stringContaining("1 KWD Ecom test"),
      },
    ]);
    // Withdrawing the mark puts the payment back (rolled back: the row lock allows one withdrawal).
    await owner(db);
    await db.exec("BEGIN");
    await db.exec(
      `UPDATE public.cockpit_billing_payment_exclusions SET withdrawn_by='ceo@tests.invalid', withdrawn_at=now(), withdrawn_reason='Counted after all' WHERE payment_id='${TEST_PAYMENT}'`,
    );
    const back = await context("2026-10");
    await db.exec("ROLLBACK");
    expect(
      Object.fromEntries(back.cashDaily.map((d: any) => [d.date, d.usd])),
    ).toEqual(was);
    expect(back.cashExcluded).toEqual([]);
  });

  test("every other old key is still exactly what q returned", async () => {
    for (const m of months) {
      const c = await context(m);
      const a = oldPart(c);
      const b = oldPart(before[m]);
      delete a.cashDaily;
      delete b.cashDaily;
      expect(a).toEqual(b);
    }
  });

  test("winsDaily: the ledger by day and kind, an upsell on the day it was signed, read from the day it opened", async () => {
    const nov = await context("2026-11");
    expect(nov.winsDaily).toMatchObject({
      from: "2026-11-02",
      through: today < "2026-11-30" ? today : "2026-11-30",
      ledgerFrom: "2026-11-02",
    });
    // The smm upsell offered on 5 Nov is on the 8th, when it was signed; the website upsell offered
    // on 27 Nov is not November's at all.
    expect(nov.winsDaily.rows).toEqual([
      { date: "2026-10-28", kind: "review", count: 1 },
      { date: "2026-11-03", kind: "review", count: 2 },
      { date: "2026-11-04", kind: "referral", count: 1 },
      { date: "2026-11-04", kind: "video_testimonial", count: 1 },
      { date: "2026-11-05", kind: "upsell_website", count: 1 },
      { date: "2026-11-08", kind: "upsell_smm", count: 1 },
    ]);
    expect(nov.winsDaily.source).toContain("2 Nov 2026");
    expect(nov.winsDaily.source).toContain("the day it was signed");
    // December: the upsell offered on 27 Nov and signed on 2 Dec is December's.
    const dec = await context("2026-12");
    expect(
      dec.winsDaily.rows.filter((r: any) => r.date >= "2026-12-01"),
    ).toEqual([
      { date: "2026-12-01", kind: "review", count: 1 },
      { date: "2026-12-02", kind: "upsell_website", count: 1 },
    ]);
    expect(dec.winsDaily.rows.some((r: any) => r.date === "2026-11-27")).toBe(
      false,
    );
    // October: the ledger was not open on any of its days, so none was read (missing, not 0).
    const oct = await context("2026-10");
    expect(oct.winsDaily).toMatchObject({
      from: null,
      through: null,
      ledgerFrom: "2026-11-02",
    });
    expect(oct.winsDaily.rows).toEqual([
      { date: "2026-10-28", kind: "review", count: 1 },
    ]);
  });

  test("upsellContracted: signed or paid upsells at their quoted price, by the day each was signed", async () => {
    const nov = await context("2026-11");
    expect(nov.upsellContracted.rows).toEqual([
      { date: "2026-11-05", usd: 1200, count: 1 },
      { date: "2026-11-08", usd: 800, count: 1 },
    ]);
    expect(nov.upsellContracted.from).toBe("2026-11-02");
    expect(nov.upsellContracted.source).toContain("the day each was signed");
    const dec = await context("2026-12");
    expect(dec.upsellContracted.rows.at(-1)).toEqual({
      date: "2026-12-02",
      usd: 1500,
      count: 1,
    });
    expect((await context("2026-10")).upsellContracted.rows).toEqual([]);
  });

  test("a signed upsell with no signing day is said in readsMissing, never counted on a day", async () => {
    await owner(db);
    await db.exec("BEGIN");
    try {
      await win({
        kind: "upsell_backend",
        stage: "signed",
        won: "2026-11-06",
        quoted: 400,
        task: "taskF1",
        noAccept: true,
      });
      const c = await context("2026-11");
      expect(c.readsMissing).toEqual([
        "Signed upsells with no signing day in the wins ledger: 1. No day counts them in upsells or Total contracted.",
      ]);
      expect(
        c.winsDaily.rows.some((r: any) => r.kind === "upsell_backend"),
      ).toBe(false);
      expect(c.upsellContracted.rows.map((r: any) => r.usd)).toEqual([
        1200, 800,
      ]);
    } finally {
      await owner(db);
      await db.exec("ROLLBACK");
    }
  });

  test("upsellCashDaily: checked upsell ties by paid day; unchecked, non-upsell and canary ties never count", async () => {
    const nov = await context("2026-11");
    expect(nov.upsellCashDaily.rows).toEqual([
      { date: "2026-10-30", usd: 250, payments: 1 },
      { date: "2026-11-06", usd: 1400, payments: 2 },
    ]);
    expect(nov.upsellCashDaily.ledgerFrom).toBe("2026-11-02");
    const oct = await context("2026-10");
    expect(oct.upsellCashDaily).toMatchObject({ from: null, through: null });
    expect(oct.upsellCashDaily.rows).toEqual([
      { date: "2026-10-30", usd: 250, payments: 1 },
    ]);
  });

  test("refundsDaily: the money rows' refunds by day, Whop (netted) and by hand (not) apart, over the refresh's window", async () => {
    const nov = await context("2026-11");
    expect(nov.refundsDaily).toMatchObject({
      from: "2026-10-01",
      through: "2026-11-02",
    });
    expect(nov.refundsDaily.rows).toEqual([
      {
        date: "2026-10-20",
        count: 1,
        usd: 300,
        whopCount: 1,
        whopUsd: 300,
        manualCount: 0,
        manualUsd: 0,
      },
      {
        date: "2026-11-01",
        count: 2,
        usd: 200,
        whopCount: 1,
        whopUsd: 80,
        manualCount: 1,
        manualUsd: 120,
      },
    ]);
    const oct = await context("2026-10");
    expect(oct.refundsDaily).toMatchObject({
      from: "2026-09-01",
      through: "2026-10-31",
    });
    expect(oct.refundsDaily.rows).toHaveLength(1);
  });

  test("salesEodDaily: filed closer EODs only, offers summed, a non-number is null, not 0", async () => {
    const oct = await context("2026-10");
    expect(oct.salesEodDaily.rows).toEqual([
      { date: "2026-10-14", offers: 5, eods: 2 },
      { date: "2026-10-21", offers: 0, eods: 1 },
      { date: "2026-10-22", offers: null, eods: 1 },
    ]);
    expect(oct.salesEodDaily.source).toContain("no EOD");
    const nov = await context("2026-11");
    expect(nov.salesEodDaily.rows.at(-1)).toEqual({
      date: "2026-11-01",
      offers: 1,
      eods: 1,
    });
  });

  test("extensionsDaily reads grants from the tab's from_day, never before the billing log began; lifecycle.extensions stays the month's", async () => {
    const nov = await context("2026-11");
    expect(nov.extensionsDaily).toMatchObject({
      from: "2026-10-01",
      through: today < "2026-11-30" ? today : "2026-11-30",
      logFrom: "2026-09-23",
    });
    expect(nov.extensionsDaily.source).toContain("23 Sep 2026");
    expect(nov.extensionsDaily.rows).toEqual([
      {
        date: "2026-10-19",
        count: 1,
        grants: [
          { grantId: 115, client: "Liwan Test", weeks: 2, state: "ended" },
        ],
      },
      {
        date: "2026-11-03",
        count: 1,
        grants: [
          { grantId: 301, client: "Acme Interiors", weeks: 2, state: "live" },
        ],
      },
      {
        date: "2026-11-04",
        count: 1,
        grants: [
          { grantId: 302, client: "Beta Build", weeks: 1, state: "replaced" },
        ],
      },
    ]);
    expect(nov.lifecycle.extensions.map((e: any) => e.grantId)).toEqual([
      301, 302,
    ]);
    // October's from_day is 1 Sep, but the billing log began on 23 Sep: 1-22 Sep are not known, not 0
    // (finding 2, 2026-11-02).
    const oct = await context("2026-10");
    expect(oct.extensionsDaily.from).toBe("2026-09-23");
    expect(oct.extensionsDaily.through).toBe("2026-10-31");
    expect(oct.extensionsDaily.rows.map((r: any) => r.date)).toEqual([
      "2026-09-25",
      "2026-10-19",
    ]);
    expect(oct.lifecycle.extensions.map((e: any) => e.grantId)).toEqual([115]);
    // September's from_day is 1 Aug: none of August is read.
    const sep = await context("2026-09");
    expect(sep.extensionsDaily).toMatchObject({
      from: "2026-09-23",
      through: "2026-09-30",
      logFrom: "2026-09-23",
    });
    expect(sep.extensionsDaily.rows.map((r: any) => r.date)).toEqual([
      "2026-09-25",
    ]);
    // A tab that has not started has no day read yet.
    const fut = await context(futureMonth);
    expect(fut.extensionsDaily).toMatchObject({
      from: null,
      through: null,
      rows: [],
    });
  });

  test("softwareByMonth: a past month reads its point, the current month today's lines, a missing point is missing", async () => {
    const oct = await context("2026-10");
    expect(oct.softwareByMonth).toEqual([
      expect.objectContaining({
        month: "2026-09",
        usd: null,
        basis: "missing",
        capturedAt: null,
      }),
      expect.objectContaining({
        month: "2026-10",
        usd: 5324.74,
        basis: "point",
      }),
    ]);
    expect(oct.softwareByMonth[1].source).toContain("kept on 30 Oct");
    expect(oct.softwareByMonth[1].source).toContain("Not what was charged");
    expect(oct.softwareMonthly).toBe(300); // the old key: today's lines, unchanged

    const cur = await context(currentMonth);
    expect(cur.softwareByMonth[1]).toMatchObject({
      month: currentMonth,
      usd: 300,
      basis: "lines",
      capturedAt: null,
    });
    expect(cur.softwareByMonth[0]).toMatchObject({
      month: previousMonth,
      basis: previousMonth === "2026-10" ? "point" : "missing",
      usd: previousMonth === "2026-10" ? 5324.74 : null,
    });
    const fut = await context(futureMonth);
    expect(fut.softwareByMonth.map((s: any) => s.basis)).toEqual([
      "not_started",
      "not_started",
    ]);
    expect(fut.softwareByMonth.map((s: any) => s.usd)).toEqual([null, null]);
  });

  test("a software point already there is kept: the backfill never overwrites it", async () => {
    await owner(db);
    await db.exec(
      "UPDATE public.cockpit_metric_days SET value=5000 WHERE day='2026-10-01' AND metric='costs.software.monthly' AND scope='company'",
    );
    await db.exec(migration(M));
    expect(
      await one<number>(
        "SELECT value AS r FROM public.cockpit_metric_days WHERE day='2026-10-01' AND metric='costs.software.monthly'",
      ),
    ).toBe(5000);
    expect(
      await count(
        "SELECT count(*) FROM public.cockpit_audit_log WHERE action='metric.backfill'",
      ),
    ).toBe(1);
    await db.exec(
      "UPDATE public.cockpit_metric_days SET value=5324.74 WHERE day='2026-10-01' AND metric='costs.software.monthly' AND scope='company'",
    );
  });

  test("frontEndMonths: growth's months cut to the tab's month and the month before, by month, as published", async () => {
    const novTab = await context("2026-11");
    // Published November first; read by month. September is outside November's two months, and the
    // entry with no month is never passed.
    expect(novTab.frontEndMonths).toEqual([
      { month: "2026-10", paid: 6000, paidOnWindowDeals: 5000 },
      { month: "2026-11", paid: 900, paidOnWindowDeals: 600 },
    ]);
    const octTab = await context("2026-10");
    // November is outside October's two months.
    expect(octTab.frontEndMonths).toEqual([
      { month: "2026-09", paid: 4000, paidOnWindowDeals: 3100 },
      { month: "2026-10", paid: 6000, paidOnWindowDeals: 5000 },
    ]);
    expect(octTab.readsMissing).toEqual([]);
    // September's month before (August) is not in growth's list: said, never 0, and not invented.
    const sepTab = await context("2026-09");
    expect(sepTab.frontEndMonths).toEqual([
      { month: "2026-09", paid: 4000, paidOnWindowDeals: 3100 },
    ]);
    expect(sepTab.readsMissing).toEqual([
      "Front-end cash for August 2026 is not in the growth refresh's months (the deal ledger was not read, or does not reach that month), so its UF cash % is not known.",
    ]);
    // A tab that has not started: nothing to read and nothing to say.
    const fut = await context(futureMonth);
    expect(fut.frontEndMonths).toEqual([]);
    expect(
      fut.readsMissing.filter((s: string) => s.startsWith("Front-end cash")),
    ).toEqual([]);
  });

  test("the windows carry growth's frontEndCash whole beside from and raw", async () => {
    const c = await context("2026-11");
    expect(c.windows).toEqual([
      {
        from: "2026-11-01",
        raw: { spend: 84.34 },
        frontEndCash: FRONT_END_MTD,
      },
      {
        from: "2026-10-01",
        raw: { spend: 1654.51 },
        frontEndCash: FRONT_END_LAST_MONTH,
      },
    ]);
    expect(c.windows[0].frontEndCash.paidOnWindowDeals).toBe(600);
    expect(c.windows[1].frontEndCash.paidOnWindowDeals).toBe(5000);
  });

  test("frontEndMonths empty (ledger not read), null, or growth not read: missing with a sentence, never 0", async () => {
    await owner(db);
    await db.exec("BEGIN");
    try {
      // The deal ledger was not read: growth publishes []. Both started months are said.
      await section("growth", { ...GROWTH_R2, frontEndMonths: [] });
      const empty = await context("2026-11");
      expect(empty.frontEndMonths).toEqual([]);
      expect(empty.readsMissing).toEqual([
        "Front-end cash for October 2026 is not in the growth refresh's months (the deal ledger was not read, or does not reach that month), so its UF cash % is not known.",
        "Front-end cash for November 2026 is not in the growth refresh's months (the deal ledger was not read, or does not reach that month), so its UF cash % is not known.",
      ]);
      // Published as null: not read, as before the release.
      await section("growth", { ...GROWTH_R2, frontEndMonths: null });
      const nul = await context("2026-11");
      expect(nul.frontEndMonths).toBeNull();
      expect(nul.readsMissing).toEqual([
        "Front-end cash by month is not read: the growth refresh does not publish frontEndMonths yet (the CEO refresh release of 2 Nov 2026), so UF cash % on the month's own deals is not known.",
      ]);
      // A window without frontEndCash reads null there, the other window keeps its own.
      expect(nul.windows[0].frontEndCash).toEqual(FRONT_END_MTD);
      await section("growth", {
        ...GROWTH_R2,
        windows: { ...GROWTH_R2.windows, mtd: GROWTH.windows.mtd },
      });
      const noMtd = await context("2026-11");
      expect(noMtd.windows[0]).toEqual({
        from: "2026-11-01",
        raw: { spend: 84.34 },
        frontEndCash: null,
      });
      expect(noMtd.windows[1].frontEndCash).toEqual(FRONT_END_LAST_MONTH);
      // The growth section failed its last refresh: nothing of it is read.
      await section("growth", GROWTH_R2, false);
      const down = await context("2026-11");
      expect(down.frontEndMonths).toBeNull();
      expect(down.readsMissing).toEqual([
        "Front-end cash by month is not read: the growth refresh has no payload, so UF cash % on the month's own deals is not known.",
      ]);
      expect(down.windows).toEqual([
        { from: null, raw: null, frontEndCash: null },
        { from: null, raw: null, frontEndCash: null },
      ]);
    } finally {
      await owner(db);
      await db.exec("ROLLBACK");
    }
    expect((await context("2026-11")).frontEndMonths).toHaveLength(2);
  });

  test("with every store live nothing is said missing, and no email reaches the new keys", async () => {
    const c = await context("2026-11");
    expect(c.readsMissing).toEqual([]);
    const text = JSON.stringify(NEW_KEYS.map(k => c[k]));
    expect(text).not.toMatch(/@/);
  });

  test("the gate still holds with the stores live", async () => {
    await actor(db, csm);
    await expect(
      db.query("SELECT public.cockpit_ceo_goal_sheet_context('2026-10')"),
    ).rejects.toThrow(/founder access/i);
    await owner(db);
  });
});
