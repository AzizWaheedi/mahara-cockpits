/**
 * Spend with no lead on the Client Performance board (migration
 * 20261023s_board_cpl_no_lead.sql; the CEO's cost per booking decisions of 23 Oct 2026, 4:
 * "Depends on how much spend if 2x target cpl then yes bad if below that then not enough
 * data"; contract docs/client-performance/CPB-DECISIONS-20261023.md 1.4 and 3.4) on an
 * isolated PostgreSQL.
 *
 * It stands on the board's chain exactly as board-cpl-golden-rule-supabase.test.ts builds
 * it, with the golden rule (20261022y) applied, so the board's rows are the live body.
 * It checks that cockpit_board_ad_cells is the live body the file was written against,
 * reads the board, applies the file twice and reads it again:
 *   - the zero-lead cost per lead, called directly: $11.09 and $29.99 too few, $30.00 off,
 *     a $20 line (39.99 too few, 40.00 off), no line too few, unknown leads not measured;
 *   - clients over seven days: Madana's shape ($11.09, no lead), $29.99, $30.00, a client
 *     with its own $20 line at $39.99 and $40.00, and the golden rule (no lead on $35 beside
 *     a good cost per booking turns off into watch);
 *   - the same clients' ads on the client page (the tree);
 *   - unpriced spend (contract 1.4, 9): only the priced part is judged and the note says how
 *     many ad-days were left out; no priced lead-form row at all (a currency with no fixed
 *     USD rate, or no spend stored) reads not measured, never "$0.00".
 * The line is never typed here: it is NO_LEAD_MULTIPLE x CPL_GATE from src/lib/kpi.ts when
 * that export lands (the media-buyer group's M1), else 2 x CPL_GATE.
 * Every client, ad and number is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import * as kpi from "../src/lib/kpi";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261023s_board_cpl_no_lead.sql";
const SIG = "public.cockpit_board_ad_cells(jsonb,jsonb,jsonb)";
/** The live body on 23 Oct (20261016133300): the body the file was written against. */
const LIVE = "ee9b65892cd1a772109dfc3b318a6a17";

/** 2 x the cost per lead gate (NO_LEAD_MULTIPLE in kpi.ts once M1 lands). */
const MULTIPLE = Number(
  (kpi as unknown as Record<string, unknown>).NO_LEAD_MULTIPLE ?? 2,
);
const LINE = MULTIPLE * kpi.CPL_GATE;
const usd = (n: number) => `$${n.toFixed(2)}`;
const under = (spend: number, line = LINE, cpl = kpi.CPL_GATE) =>
  `No form lead yet for ${usd(spend)} of lead-campaign spend: under ${usd(line)} (${MULTIPLE} x the ${usd(cpl)} cost per lead line), too few to judge.`;
const over = (spend: number, line = LINE, cpl = kpi.CPL_GATE) =>
  `No form lead yet for ${usd(spend)} of lead-campaign spend: ${usd(line)} or more with no lead is off (${MULTIPLE} x the ${usd(cpl)} cost per lead line).`;
/** No lead-form row has a USD amount: not judged (contract 1.4, 9). */
const UNPRICED =
  "No form lead yet, and the lead-campaign spend is in a currency with no fixed USD rate, so it is not judged.";
const NO_SPEND =
  "No form lead yet, and no lead-campaign spend is stored, so it is not judged.";
const leftOut = (n: number) =>
  `${n} ad-day${n === 1 ? "" : "s"} in a currency with no fixed USD rate ${n === 1 ? "is" : "are"} left out, so spend is at least this.`;

/** The board's chain, as board-cpl-golden-rule-supabase.test.ts loads it, then the golden rule. */
const CHAIN_FIRST = [
  "20261013180000_cockpit_client_calls.sql",
  "20261015200000_cockpit_client_calls_whatsapp_chats.sql",
  "20261013180200_cockpit_client_callers.sql",
  "20261016111157_board_facts.sql",
  "20261016121700_meta_ad_days.sql",
];
const CHAIN_BOARD = [
  "20261016133300_board_api.sql",
  "20261016210000_board_facts_checked.sql",
  "20261016210100_meta_ad_days_checked.sql",
  "20261017100000_meta_budgets.sql",
  "20261016220000_board_read_checked.sql",
  "20261016220100_board_read_notes.sql",
  "20261017090000_board_active_only.sql",
  "20261017100100_board_budgets.sql",
  "20261017120000_board_budget_issue_scope.sql",
  "20261021a_board_skip_excluded_ads.sql",
  "20261022y_board_cpl_golden_rule.sql",
];

const CEO = "00000000-0000-4000-8000-0000000000a9";

/** Kuwait calendar days: kd(n) is n days before today. */
const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kd = (n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);
const FROM = kd(7);
const TO = kd(1);

const DIALER = (() => {
  const text = readFileSync(
    new URL("./board-facts-supabase.test.ts", import.meta.url),
    "utf8",
  );
  const hit = text.match(/const DIALER = String\.raw`([\s\S]*?)`;\n/);
  if (!hit || hit[1].includes("${"))
    throw new Error("The board facts test's DIALER block moved");
  return hit[1];
})();
const EXCLUDED_ADS = (() => {
  const hit = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);\nalter table public\.cockpit_excluded_ads enable row level security;\nrevoke all on public\.cockpit_excluded_ads from anon, authenticated;/,
  );
  if (!hit) throw new Error("The compromise list's table moved in 20261010a");
  return hit[0];
})();
const TEAM_ONLY = (() => {
  const sql = migration("20261017b_team_only_seats.sql");
  const fn = sql.match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\n\$\$;/,
  );
  const revoke = sql.match(
    /REVOKE ALL ON FUNCTION public\.cockpit_is_team_only\(\) FROM [^;]*;/,
  );
  const grant = sql.match(
    /GRANT EXECUTE ON FUNCTION public\.cockpit_is_team_only\(\) TO [^;]*;/,
  );
  if (!fn || !revoke || !grant)
    throw new Error("cockpit_is_team_only moved in 20261017b");
  return `${fn[0]}\n${revoke[0]}\n${grant[0]}`;
})();

let db: PGlite;
type Row = Record<string, any>;
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(text, params)).rows;
}
async function md5(): Promise<string | null> {
  return (
    await q<{ m: string | null }>(
      "SELECT (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)) m",
      [SIG],
    )
  )[0].m;
}
async function acl(): Promise<string> {
  return (
    await q<{ a: string }>(
      "SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  )[0].a;
}
async function apply() {
  await owner(db);
  await db.exec(migration(FILE));
}
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}
/** The official targets, or a client's own (cockpit_board_targets_map). */
async function targets(clickup: string | null = null): Promise<Row> {
  return (
    await q<{ t: Row }>("SELECT public.cockpit_board_targets_map($1) t", [
      clickup,
    ])
  )[0].t;
}
/** The ad cells for one sum of ad-days with no lead. */
async function cell(sums: Row, t: Row): Promise<Row> {
  return (
    await q<{ c: Row }>(
      "SELECT public.cockpit_board_ad_cells($1::jsonb, $2::jsonb) c",
      [JSON.stringify(sums), JSON.stringify(t)],
    )
  )[0].c;
}
const noLead = (spend: number, extra: Row = {}) => ({
  rows: 1,
  spend,
  lead_rows: 1,
  leads: 0,
  lead_spend: spend,
  imp: 1000,
  clicks: 10,
  ...extra,
});
/** The board's rows as the owner reads them, by client. */
async function rows(): Promise<Record<string, Row>> {
  const r = (
    await q<{ r: Row[] }>(
      "SELECT public.cockpit_board_rows($1::date,$2::date,NULL,public.cockpit_meta_ad_days_status()) r",
      [FROM, TO],
    )
  )[0].r;
  return Object.fromEntries(r.map(x => [x.clientName, x]));
}
/** A client's page as the CEO reads it. */
async function page(loc: string): Promise<Row> {
  await actor(db, CEO);
  try {
    return (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_board_client($1,$2::date,$3::date) r",
        [loc, FROM, TO],
      )
    ).rows[0].r;
  } finally {
    await owner(db);
  }
}
/** The ad of a one-ad client's tree. */
function adOf(p: Row): Row {
  return p.campaigns[0].adsets[0].ads[0].metrics;
}

let n = 0;
const locs: Record<string, string> = {};
/**
 * One client over the seven days: a lead campaign on its own account with no form lead,
 * `spend` in all on the last day (nothing on the others), `booked` confirmed bookings.
 * With `currency`, the account is in a currency with no fixed USD rate: no spend_usd.
 */
async function client(
  name: string,
  r: { spend: number; booked?: number; cpl?: number; currency?: string },
) {
  n += 1;
  const loc = `locNoLead${n}`;
  locs[name] = loc;
  const account = String(1_300_000_000 + n);
  await q(
    "INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES($1,$2,$3,'Active','DFY',$4)",
    [loc, `cuNoLead${n}`, name, [account]],
  );
  for (let d = 7; d >= 1; d--) {
    const i = 7 - d;
    await q(
      `INSERT INTO public.cockpit_client_days(location_id,day,confirmed_bookings,closes,closes_with_value,revenue_usd)
       VALUES($1,$2,$3,0,0,0)`,
      [loc, kd(d), i < (r.booked ?? 0) ? 1 : 0],
    );
    await q(
      `INSERT INTO public.cockpit_meta_ad_days(account_id,account_currency,account_timezone,day,campaign_id,campaign_name,objective,
         adset_id,ad_id,spend,spend_usd,usd_rate,impressions,link_clicks,leads,lead_actions,destination_type,fetched_at)
       VALUES($1,$7::text,'Asia/Kuwait',$2,$3,'Leads','OUTCOME_LEADS',$4,$5,$6::numeric,CASE WHEN $7::text = 'USD' THEN $6::numeric END,
         CASE WHEN $7::text = 'USD' THEN 1 END,1000,10,0,0,'ON_AD',now())`,
      [
        account,
        kd(d),
        String(5_300_000_000 + n),
        String(5_400_000_000 + n),
        String(5_500_000_000 + n),
        d === 1 ? r.spend : 0,
        r.currency ?? "USD",
      ],
    );
  }
  if (r.cpl !== undefined)
    await q(
      `INSERT INTO public.cockpit_board_targets(scope_key,metric,good,watch,direction,updated_by) VALUES
       ($1,'cpl',$2,$3,'lower','ceo')`,
      [`client:cuNoLead${n}`, r.cpl, r.cpl * 1.5],
    );
}

let before: {
  rows: Record<string, Row>;
  pages: Record<string, Row>;
  cells: Record<string, Row>;
  acl: string;
  md5: string | null;
};
const CASES: [
  string,
  { spend: number; booked?: number; cpl?: number; currency?: string },
][] = [
  ["Madana shape", { spend: 11.09 }],
  ["Just under", { spend: 29.99 }],
  ["On the line", { spend: 30 }],
  ["Own line under", { spend: 39.99, cpl: 20 }],
  ["Own line on", { spend: 40, cpl: 20 }],
  // No lead on $35 and one booking: cost per booking $35, good.
  ["Golden", { spend: 35, booked: 1 }],
  // A lead campaign in a currency with no fixed USD rate, no lead: nothing priced to judge.
  ["Unpriced", { spend: 50, currency: "EGP" }],
];

async function directCells(): Promise<Record<string, Row>> {
  const t = await targets();
  const own = { ...t, cpl: { ...t.cpl, good: 20, watch: 30 } };
  const noLine = { ...t };
  delete noLine.cpl;
  return {
    "11.09": (await cell(noLead(11.09), t)).cpl,
    "17.32": (await cell(noLead(17.32), t)).cpl,
    "29.99": (await cell(noLead(29.99), t)).cpl,
    "29.994": (await cell(noLead(29.994), t)).cpl,
    "29.995": (await cell(noLead(29.995), t)).cpl,
    "30": (await cell(noLead(30), t)).cpl,
    "41.65": (await cell(noLead(41.65), t)).cpl,
    "own 39.99": (await cell(noLead(39.99), own)).cpl,
    "own 40": (await cell(noLead(40), own)).cpl,
    "no line 100": (await cell(noLead(100), noLine)).cpl,
    unknown: (await cell({ ...noLead(50), lead_rows: 0, leads: null }, t)).cpl,
    partial: (
      await cell(
        noLead(31, {
          partial: true,
          partial_note: "Two days of this time frame are not in yet.",
        }),
        t,
      )
    ).cpl,
    leads: (await cell({ ...noLead(45), leads: 3 }, t)).cpl,
    // Unpriced spend (contract 1.4, 9). Both callers sum lead_spend over priced rows only,
    // so it is null when no lead-form row has a USD amount.
    "all unpriced": (
      await cell(
        { ...noLead(0), spend: null, lead_spend: null, unpriced: 1 },
        t,
      )
    ).cpl,
    "no spend stored": (
      await cell({ ...noLead(0), spend: null, lead_spend: null }, t)
    ).cpl,
    "unpriced partial days": (
      await cell(
        {
          ...noLead(0),
          spend: null,
          lead_spend: null,
          unpriced: 2,
          partial: true,
          partial_note: "Two days of this time frame are not in yet.",
        },
        t,
      )
    ).cpl,
    "part unpriced under": (await cell(noLead(12, { unpriced: 1 }), t)).cpl,
    "part unpriced over": (await cell(noLead(31, { unpriced: 2 }), t)).cpl,
  };
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  );
  const seat = migration("20261007d_cockpit_team_rpc_restore.sql").match(
    /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
  );
  if (!allowed || !seat) throw new Error("The seat checks moved");
  await db.exec(allowed[0]);
  await db.exec(seat[0]);
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) TO authenticated, service_role;`);
  await db.exec(DIALER);
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  for (const f of CHAIN_FIRST) await db.exec(migration(f));
  for (const f of CHAIN_BOARD) await db.exec(migration(f));
  for (const [name, r] of CASES) await client(name, r);

  const pages: Record<string, Row> = {};
  for (const [name] of CASES) pages[name] = await page(locs[name]);
  before = {
    rows: await rows(),
    pages,
    cells: await directCells(),
    acl: await acl(),
    md5: await md5(),
  };
  await apply();
  await apply();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("is written against the live body, which the repository chain reproduces", () => {
    expect(before.md5).toBe(LIVE);
    expect(migration(FILE)).toContain(`'${LIVE}'`);
    expect(migration(FILE)).not.toContain(String.fromCodePoint(0x2014));
  });

  test("applies twice; keeps owner, invoker, search path and grants (the owner's alone)", async () => {
    const mine = await md5();
    expect(mine).not.toBe(LIVE);
    expect(migration(FILE)).toContain(`'${mine}'`);
    expect(await acl()).toBe(before.acl);
    expect(before.acl).toBe("{postgres=X/postgres}");
    const [f] = await q<{ definer: boolean; cfg: string; vol: string }>(
      "SELECT prosecdef definer, proconfig::text cfg, provolatile vol FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    );
    expect(f).toEqual({
      definer: false,
      cfg: '{"search_path=\\"\\""}',
      vol: "i",
    });
  });

  test("never types the line in the body: it doubles the target", () => {
    const body = migration(FILE).split("$fn$")[1];
    expect(body).toBeTruthy();
    // Every line of the no-lead rule (its declarations, status and note).
    const rule = body
      .split("\n")
      .filter(l =>
        /no_lead_|cpl_line|lead-campaign spend|cost per lead line/.test(l),
      );
    expect(rule.length).toBeGreaterThanOrEqual(8);
    for (const l of rule)
      expect(l).not.toMatch(/(?<![0-9.,])(30|20|22\.5|15)(\.0+)?(?![0-9])/);
    expect(body).toContain("v_no_lead_multiple constant numeric := 2;");
    expect(body).toContain("(p_targets->'cpl'->>'good')::numeric");
  });

  test("a body changed since refuses and changes nothing", async () => {
    const def = (
      await q<{ d: string }>(
        "SELECT pg_get_functiondef(to_regprocedure($1)) d",
        [SIG],
      )
    )[0].d;
    const mine = await md5();
    await q(
      def.replace(
        "v_no_lead constant text := 'No lead-form campaign ran in this time frame.';",
        "v_no_lead constant text := 'Changed since.';",
      ),
    );
    const changed = await md5();
    expect(changed).not.toBe(mine);
    await refuses(
      migration(FILE),
      /cockpit_board_ad_cells is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect(await md5()).toBe(changed);
    await q(def);
    expect(await md5()).toBe(mine);
  });
});

describe("the zero-lead cost per lead", () => {
  test("before: judged as a floor on the $15 and $22.50 lines", () => {
    expect(before.cells["11.09"].status).toBe("too_few");
    expect(before.cells["17.32"].status).toBe("watch");
    expect(before.cells["29.99"].status).toBe("off");
  });

  test("off at 2 x the line, too few under it, on the cent", async () => {
    const c = await directCells();
    expect(c["11.09"]).toEqual({
      v: null,
      status: "too_few",
      num: 11.09,
      den: 0,
      sample: 0,
      note: under(11.09),
      target: "cpl",
      atLeast: 11.09,
    });
    expect(c["17.32"].status).toBe("too_few");
    expect(c["29.99"]).toMatchObject({ status: "too_few", note: under(29.99) });
    // Rounded to the cent before comparing.
    expect(c["29.994"]).toMatchObject({ status: "too_few", atLeast: 29.99 });
    expect(c["29.995"]).toMatchObject({ status: "off", atLeast: 30 });
    expect(c["30"]).toEqual({
      v: null,
      status: "off",
      num: 30,
      den: 0,
      sample: 0,
      note: over(30),
      target: "cpl",
      atLeast: 30,
    });
    expect(c["41.65"]).toMatchObject({ status: "off", note: over(41.65) });
  });

  test("a client's own line moves it: 2 x $20 = $40", async () => {
    const c = await directCells();
    expect(c["own 39.99"]).toMatchObject({
      status: "too_few",
      note: under(39.99, 2 * 20, 20),
    });
    expect(c["own 40"]).toMatchObject({
      status: "off",
      note: over(40, 2 * 20, 20),
    });
  });

  test("no line: too few; unknown leads: not measured; partial days and leads above 0 as before", async () => {
    const c = await directCells();
    expect(c["no line 100"]).toMatchObject({
      v: null,
      status: "too_few",
      atLeast: 100,
      note: "No form lead yet for $100.00 of lead-campaign spend, and no cost per lead line is set, so it is too few to judge.",
    });
    expect(c.unknown).toEqual(before.cells.unknown);
    expect(c.unknown).toMatchObject({ v: null, status: "not_measured" });
    expect(c.partial).toEqual({
      v: null,
      status: "off",
      num: 31,
      den: 0,
      sample: 0,
      note: `${over(31)} Two days of this time frame are not in yet.`,
      target: "cpl",
      atLeast: 31,
      partial: true,
    });
    expect(c.leads).toEqual(before.cells.leads);
    expect(c.leads).toMatchObject({ v: 15, status: "good" });
  });
});

describe("unpriced spend (contract 1.4, 9)", () => {
  test("before: no priced lead-form row read as $0.00 of spend, too few", () => {
    expect(before.cells["all unpriced"]).toMatchObject({
      status: "too_few",
      atLeast: 0,
      note: "No form lead yet for $0.00 of lead-campaign spend.",
    });
  });

  test("no lead-form row with a USD amount: not measured, with no amount", async () => {
    const c = await directCells();
    expect(c["all unpriced"]).toEqual({
      v: null,
      status: "not_measured",
      den: 0,
      sample: 0,
      note: UNPRICED,
      target: "cpl",
    });
    expect(c["no spend stored"]).toEqual({
      v: null,
      status: "not_measured",
      den: 0,
      sample: 0,
      note: NO_SPEND,
      target: "cpl",
    });
    expect(c["unpriced partial days"]).toEqual({
      v: null,
      status: "not_measured",
      den: 0,
      sample: 0,
      note: `${UNPRICED} Two days of this time frame are not in yet.`,
      target: "cpl",
    });
  });

  test("part of it priced: the priced part is judged, at least, and the note says what was left out", async () => {
    const c = await directCells();
    expect(c["part unpriced under"]).toEqual({
      v: null,
      status: "too_few",
      num: 12,
      den: 0,
      sample: 0,
      note: `${under(12)} ${leftOut(1)}`,
      target: "cpl",
      atLeast: 12,
    });
    expect(c["part unpriced over"]).toEqual({
      v: null,
      status: "off",
      num: 31,
      den: 0,
      sample: 0,
      note: `${over(31)} ${leftOut(2)}`,
      target: "cpl",
      atLeast: 31,
    });
    // Before, no word of the ad-days left out.
    expect(before.cells["part unpriced under"]).toMatchObject({
      atLeast: 12,
      note: "No form lead yet for $12.00 of lead-campaign spend.",
    });
  });

  test("a client whose lead campaign is in a currency with no fixed USD rate: not measured on the board and on its ads", async () => {
    expect(before.rows.Unpriced.values.cpl).toMatchObject({
      status: "too_few",
      atLeast: 0,
    });
    const after = await rows();
    expect(after.Unpriced.values.cpl).toEqual({
      v: null,
      status: "not_measured",
      den: 0,
      sample: 0,
      note: UNPRICED,
      target: "cpl",
    });
    const p = await page(locs.Unpriced);
    expect(adOf(p).cpl).toEqual(after.Unpriced.values.cpl);
    expect(p.campaigns[0].metrics.cpl).toEqual(after.Unpriced.values.cpl);
    expect(p.campaigns[0].adsets[0].metrics.cpl).toEqual(
      after.Unpriced.values.cpl,
    );
  });
});

describe("the board's rows", () => {
  test("Madana's shape and $29.99 read too few; $30.00 off", async () => {
    const after = await rows();
    expect(before.rows["Madana shape"].values.cpl.status).toBe("too_few");
    expect(before.rows["Just under"].values.cpl.status).toBe("off");
    expect(after["Madana shape"].values.cpl).toMatchObject({
      v: null,
      status: "too_few",
      atLeast: 11.09,
      note: under(11.09),
    });
    expect(after["Just under"].values.cpl).toMatchObject({
      status: "too_few",
      atLeast: 29.99,
    });
    expect(after["On the line"].values.cpl).toMatchObject({
      status: "off",
      atLeast: 30,
      note: over(30),
    });
  });

  test("a client's own $20 line: $39.99 too few, $40.00 off", async () => {
    const after = await rows();
    expect(after["Own line under"].values.cpl).toMatchObject({
      status: "too_few",
      note: under(39.99, 40, 20),
    });
    expect(after["Own line on"].values.cpl).toMatchObject({
      status: "off",
      note: over(40, 40, 20),
    });
  });

  test("the golden rule: no lead on $35 beside a good cost per booking is a watch line", async () => {
    const g = (await rows()).Golden.values;
    expect(g.costPerBooking).toMatchObject({ v: 35, status: "good" });
    expect(g.cpl.status).toBe("watch");
    expect(g.cpl.atLeast).toBe(35);
    expect(g.cpl.note).toBe(
      `${over(35)} Cost per booking is within the $60 gate, so a cost per lead over $15 is a watch line, not off (the golden rule).`,
    );
  });

  test("nothing but the cost per lead moves", async () => {
    const after = await rows();
    for (const [name, row] of Object.entries(after)) {
      const was = before.rows[name];
      const { values, ...rest } = row;
      const { values: wasValues, ...wasRest } = was;
      expect(rest).toEqual(wasRest);
      const changed = Object.keys(values).filter(
        k => JSON.stringify(values[k]) !== JSON.stringify(wasValues[k]),
      );
      expect([name, changed]).toEqual([name, ["cpl"]]);
    }
  });
});

describe("the client page's ads (the tree)", () => {
  test("each ad's cost per lead follows the same line", async () => {
    const want: Record<string, [string, string]> = {
      "Madana shape": ["too_few", under(11.09)],
      "Just under": ["too_few", under(29.99)],
      "On the line": ["off", over(30)],
      "Own line under": ["too_few", under(39.99, 40, 20)],
      "Own line on": ["off", over(40, 40, 20)],
      Golden: ["off", over(35)],
      Unpriced: ["not_measured", UNPRICED],
    };
    for (const [name, [status, note]] of Object.entries(want)) {
      const p = await page(locs[name]);
      const ad = adOf(p);
      expect([name, ad.cpl.status, ad.cpl.note]).toEqual([name, status, note]);
      // The campaign and ad set read the same sums.
      expect(p.campaigns[0].metrics.cpl.status).toBe(status);
      expect(p.campaigns[0].adsets[0].metrics.cpl.status).toBe(status);
      // Nothing else on the ad moves.
      const was = adOf(before.pages[name]);
      expect({ ...ad, cpl: null }).toEqual({ ...was, cpl: null });
    }
    expect(adOf(before.pages["Just under"]).cpl.status).toBe("off");
  });
});
