/**
 * Goals sheet round 3 (2026-11-02): supabase/migrations/20261102n_goal_sheet_media_dedupe.sql against
 * PGlite. The audit is the second-source run of 2 Nov 2026 (Client CPM, link CTR and opt-in for
 * October, verified real): the media table held one Shades ad on 14-16 Oct under both its old and its
 * renamed campaign, and mediaDaily summed both.
 *
 * The ground is goal-sheet-truth-supabase.test.ts's, cut down: the goal sheet as production built it
 * (metric days, people, goals, the registry, the goals gate, cost lines, the goal sheet, then
 * 20261101q and 20261102m, whose body is the live one n replaces). The media table is its real
 * definition (20260927j), since n reads source_id and imported_at; the other tables the sheet reads
 * that no migration here creates are the readers test's stubs. The CEO's address is read from the CEO
 * gate migration; every ad, campaign and number is invented.
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
const M = "20261102m_goal_sheet_truth.sql";
const N = "20261102n_goal_sheet_media_dedupe.sql";
/** The live body on 2026-11-02 (pg_get_functiondef, read-only), equal to m's. */
const LIVE_MD5 = "9317c8f0c73e1c7dc989c92055abc175";
/** n's own body: the guard's second hash. */
const N_MD5 = "751dcbdc003977879a3f763dba01faa9";

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

/** A migration's CREATE OR REPLACE of the context through its GRANT line. */
function contextBlock(file: string): string {
  return cut(
    file,
    /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_goal_sheet_context\(p_month text\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_ceo_goal_sheet_context\(text\) TO authenticated, service_role;/,
    "the goal sheet context",
  );
}

type Ctx = Record<string, any>;
type Day = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
};

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

async function auditRows(): Promise<number> {
  await owner(db);
  return (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.cockpit_audit_log",
    )
  ).rows[0].n;
}

/** mediaDaily is aggregated without an order (as live); read it by day. */
const byDay = (c: Ctx): Record<string, Day> =>
  Object.fromEntries((c.mediaDaily ?? []).map((d: Day) => [d.date, d]));

/** Every key but mediaDaily, the unordered lists sorted, to compare m's context with n's. */
function rest(c: Ctx) {
  const { mediaDaily: _, ...out } = c;
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
INSERT INTO public.cockpit_client_days(day, closes, lead_quality_sum, lead_quality_count) VALUES
  ('2026-10-14', 1, 12, 2), ('2026-11-01', 0, 7, 1);
INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, reason) VALUES
  ('Gone Co', 'taskG1', '2026-10-18', 'Results');
`;

/**
 * The media sync's rows, invented. Ad 111 is renamed with its campaign ('Shop|old' to 'Shop|new'):
 * on 14 Oct the newer import is under the new name, on 15 Oct under the old one, so the import time
 * decides, never the name. Ad 222 runs beside it. Two rows carry no ad id (one has none, one an empty
 * one), each its own ad; one more has no ad id under the same source_id in two deployments.
 */
const ROWS: [
  deployment: string,
  sourceId: string,
  campaign: string,
  day: string,
  importedAt: string,
  data: Record<string, unknown>,
][] = [
  [
    "native",
    "native:dailyStats:a-old-14",
    "Shop|old",
    "2026-10-14",
    "2026-10-17T10:38:51Z",
    { metaAdId: "111", spend: 10, impressions: 3100, linkClicks: 8, leads: 1 },
  ],
  [
    "native",
    "native:dailyStats:a-new-14",
    "Shop|new",
    "2026-10-14",
    "2026-11-02T17:50:40Z",
    {
      metaAdId: "111",
      spend: 10.5,
      impressions: 3200,
      linkClicks: 9,
      leads: 1,
    },
  ],
  [
    "native",
    "native:dailyStats:b-14",
    "Shop|new",
    "2026-10-14",
    "2026-11-02T17:50:40Z",
    { metaAdId: "222", spend: 5, impressions: 1000, linkClicks: 4, leads: 0 },
  ],
  [
    "native",
    "native:dailyStats:c1-14",
    "Shop|new",
    "2026-10-14",
    "2026-11-02T17:50:40Z",
    { spend: 2, impressions: 200, linkClicks: 1, leads: 1 },
  ],
  [
    "native",
    "native:dailyStats:c2-14",
    "Shop|new",
    "2026-10-14",
    "2026-11-02T17:50:40Z",
    { metaAdId: "", spend: 3, impressions: 300, linkClicks: 2, leads: 0 },
  ],
  [
    "native",
    "native:dailyStats:a-old-15",
    "Shop|old",
    "2026-10-15",
    "2026-11-02T17:50:40Z",
    { metaAdId: "111", spend: 7, impressions: 700, linkClicks: 7, leads: 1 },
  ],
  [
    "native",
    "native:dailyStats:a-new-15",
    "Shop|new",
    "2026-10-15",
    "2026-10-20T09:00:00Z",
    { metaAdId: "111", spend: 6, impressions: 600, linkClicks: 6, leads: 0 },
  ],
  [
    "old-deployment",
    "native:dailyStats:d-16",
    "Shop|new",
    "2026-10-16",
    "2026-10-01T09:00:00Z",
    { spend: 1, impressions: 100, linkClicks: 1, leads: 0 },
  ],
  [
    "native",
    "native:dailyStats:d-16",
    "Shop|new",
    "2026-10-16",
    "2026-10-20T09:00:00Z",
    { spend: 2, impressions: 150, linkClicks: 1, leads: 1 },
  ],
  [
    "native",
    "native:dailyStats:b-17",
    "Shop|new",
    "2026-10-17",
    "2026-11-02T17:50:40Z",
    { metaAdId: "222", spend: 4, impressions: 400, linkClicks: 3, leads: 0 },
  ],
  [
    "native",
    "native:dailyStats:b-nov1",
    "Shop|new",
    "2026-11-01",
    "2026-11-02T17:50:40Z",
    { metaAdId: "222", spend: 8.25, impressions: 900, linkClicks: 5, leads: 1 },
  ],
];

/** What each day reads with one row per ad and day, the newest import. */
const ONCE: Record<string, Day> = {
  // Ad 111 from its 2 Nov import (new name), ad 222, and the two rows with no ad id.
  "2026-10-14": {
    date: "2026-10-14",
    spend: 20.5,
    impressions: 4700,
    clicks: 16,
    leads: 2,
  },
  // Ad 111 from its 2 Nov import, which is under the old name this time.
  "2026-10-15": {
    date: "2026-10-15",
    spend: 7,
    impressions: 700,
    clicks: 7,
    leads: 1,
  },
  // The no-id row is keyed by its source_id: the newer deployment's copy.
  "2026-10-16": {
    date: "2026-10-16",
    spend: 2,
    impressions: 150,
    clicks: 1,
    leads: 1,
  },
  "2026-10-17": {
    date: "2026-10-17",
    spend: 4,
    impressions: 400,
    clicks: 3,
    leads: 0,
  },
};

/** What m read: every row summed. */
const EVERY_ROW: Record<string, Day> = {
  ...ONCE,
  "2026-10-14": {
    date: "2026-10-14",
    spend: 30.5,
    impressions: 7800,
    clicks: 24,
    leads: 3,
  },
  "2026-10-15": {
    date: "2026-10-15",
    spend: 13,
    impressions: 1300,
    clicks: 13,
    leads: 1,
  },
  "2026-10-16": {
    date: "2026-10-16",
    spend: 3,
    impressions: 250,
    clicks: 2,
    leads: 1,
  },
};

const NOV_1: Day = {
  date: "2026-11-01",
  spend: 8.25,
  impressions: 900,
  clicks: 5,
  leads: 1,
};

let currentMonth = "";
let futureMonth = "";
let months: string[] = [];
const underM: Record<string, Ctx> = {};
let auditBeforeN = 0;

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
  await db.exec(
    cut(
      "20260927j_cockpit_media_statistics.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_daily_stats\([\s\S]*?\n\);/,
      "media daily stats",
    ),
  );
  await db.exec(STUBS);
  await db.exec(migration("20261030a_goal_sheet.sql"));
  await db.exec(migration("20261101q_readers.sql"));
  await db.exec(migration(M));
  await member(db, founder, CEO_EMAIL, []);
  await member(db, csm, "csm@tests.invalid", ["csm"]);
  await owner(db);

  await db.query(
    "INSERT INTO public.cockpit_goal_plans(period_kind,period_from,period_to,title,status,created_by) VALUES ('month','2026-10-01','2026-10-31','October 2026 plan','draft','test')",
  );
  await db.query(
    "INSERT INTO public.cockpit_goal_sheet_cells(day,metric_key,kind,value,note,updated_by) VALUES ('2026-10-14','clientSpend','actual',1,'typed','test')",
  );
  for (const [key, payload] of [
    [
      "money",
      {
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
          ],
        },
      },
    ],
    [
      "growth",
      {
        daily: [{ date: "2026-10-14", spend: 50, leads: 2 }],
        windows: { lastMonth: { from: "2026-10-01", raw: { spend: 50 } } },
      },
    ],
    ["delivery", { daily: [{ date: "2026-10-14", spend: 400, leads: 30 }] }],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_sections(key,label,ok,payload,computed_at) VALUES ($1,$1,true,$2,now())",
      [key, JSON.stringify(payload)],
    );
  for (const [dep, sid, campaign, day, at, data] of ROWS)
    await db.query(
      "INSERT INTO public.cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data,imported_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        dep,
        sid,
        campaign,
        day,
        JSON.stringify({ campaignName: campaign, date: day, ...data }),
        at,
      ],
    );

  const t = (
    await db.query<{ t: string }>(
      "SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS t",
    )
  ).rows[0].t;
  currentMonth = t.slice(0, 7);
  futureMonth = (
    await db.query<{ m: string }>(
      "SELECT to_char(date_trunc('month', $1::date) + interval '2 month', 'YYYY-MM') AS m",
      [t],
    )
  ).rows[0].m;
  months = [...new Set(["2026-10", "2026-11", currentMonth, futureMonth])];
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the drift guard and the apply", () => {
  test("the repo's m body is the live body n replaces, and it sums every row", async () => {
    expect(await bodyMd5()).toBe(LIVE_MD5);
    for (const m of months) underM[m] = await context(m);
    // The bug the audit found: the renamed ad counts twice on 14 and 15 Oct.
    expect(byDay(underM["2026-10"])).toEqual(EVERY_ROW);
  });

  test("n applies over the live body, then again over its own, and its after md5 is the one in its guard", async () => {
    await owner(db);
    auditBeforeN = await auditRows();
    await db.exec(migration(N));
    const after = await bodyMd5();
    expect(after).not.toBe(LIVE_MD5);
    expect(after).toBe(N_MD5);
    expect(migration(N).includes(`v IS DISTINCT FROM '${after}'`)).toBe(true);
    expect(migration(N).includes(`v IS DISTINCT FROM '${LIVE_MD5}'`)).toBe(
      true,
    );
    await db.exec(migration(N));
    expect(await bodyMd5()).toBe(after);
  });

  test("n's body is m's with only mediaDaily's read changed", () => {
    const m = contextBlock(M);
    const n = contextBlock(N);
    const old =
      "        FROM public.cockpit_media_daily_stats s WHERE s.day BETWEEN from_day AND last_day GROUP BY 1) x),\n";
    expect(m.split(old)).toHaveLength(2);
    const start = n.indexOf("        -- 2026-11-02 (round 3)");
    const end = n.indexOf("        GROUP BY 1) x),\n", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const back = `${n.slice(0, start)}${old}${n.slice(end + "        GROUP BY 1) x),\n".length)}`;
    expect(back).toBe(m);
  });

  test("n writes no data row and no audit row", async () => {
    expect(await auditRows()).toBe(auditBeforeN);
    expect(migration(N)).not.toMatch(/INSERT INTO|UPDATE public\.|DELETE FROM/);
  });

  test("a changed body is refused with the stop-and-re-read sentence", async () => {
    await owner(db);
    const def = (
      await db.query<{ d: string }>(
        "SELECT pg_get_functiondef('public.cockpit_ceo_goal_sheet_context(text)'::regprocedure) AS d",
      )
    ).rows[0].d;
    await db.exec(def.replace("'readsMissing'", "'readsMissing2'"));
    await expect(db.exec(migration(N))).rejects.toThrow(
      /changed since the goals sheet round 3 read it/,
    );
    await db.exec("ROLLBACK");
    await db.exec(def);
    expect(await bodyMd5()).toBe(N_MD5);
  });

  test("SECURITY DEFINER, search_path '' and the grants stay as live: authenticated and service_role, never anon", async () => {
    await owner(db);
    const r = (
      await db.query<{ acl: string; secdef: boolean; config: string[] }>(
        "SELECT proacl::text AS acl, prosecdef AS secdef, proconfig AS config FROM pg_proc WHERE oid='public.cockpit_ceo_goal_sheet_context(text)'::regprocedure",
      )
    ).rows[0];
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

describe("mediaDaily counts each Meta ad once a day", () => {
  test("a renamed ad stored twice on a day counts once, from its newest import, whichever name that is under", async () => {
    const days = byDay(await context("2026-10"));
    expect(days["2026-10-14"]).toEqual(ONCE["2026-10-14"]);
    expect(days["2026-10-15"]).toEqual(ONCE["2026-10-15"]);
  });

  test("two different ads on the same day both count, and the same ad counts on each of its days", async () => {
    const days = byDay(await context("2026-10"));
    // 14 Oct holds ads 111 and 222 (10.5 + 5 of its 20.5); ad 222 counts again on 17 Oct.
    expect(days["2026-10-14"].spend).toBe(20.5);
    expect(days["2026-10-17"]).toEqual(ONCE["2026-10-17"]);
    // Ad 111 counts on 14 and 15 Oct, once each.
    expect(days["2026-10-15"].impressions).toBe(700);
  });

  test("a row with no ad id falls back to its source_id: two such rows both count, one source_id twice counts once", async () => {
    const days = byDay(await context("2026-10"));
    // 14 Oct: the row with no metaAdId and the row with an empty one are two ads (2 + 3 of 20.5).
    expect(days["2026-10-14"].impressions).toBe(3200 + 1000 + 200 + 300);
    // 16 Oct: one source_id in two deployments is one row, the newest import.
    expect(days["2026-10-16"]).toEqual(ONCE["2026-10-16"]);
  });

  test("the October tab reads every day of its range once; the November tab reads October's days the same way", async () => {
    expect(byDay(await context("2026-10"))).toEqual(ONCE);
    expect(byDay(await context("2026-11"))).toEqual({
      ...ONCE,
      "2026-11-01": NOV_1,
    });
  });

  test("every other key is exactly what m returned, for October, November, this month and a future month", async () => {
    for (const m of months) {
      const c = await context(m);
      expect(rest(c)).toEqual(rest(underM[m]));
      // A month with no repeated ad-day reads as m read it.
      if (m !== "2026-10" && m !== "2026-11")
        expect(byDay(c)).toEqual(byDay(underM[m]));
    }
  });
});
