/**
 * The media buyers' agreed daily budget (migration 20261103e, plan build B6)
 * on an isolated PostgreSQL.
 *
 * It stands on the launch desk chain the desk's own test builds
 * (20261024b, the client workspace, the client hold wrapper 20261024172848 and
 * 20261026t's scope), then cockpit_board_client from 20261017100100 with its
 * board readers stubbed, then this file twice. It checks:
 * - the drift guard on each replaced body, the grants, and a second apply;
 * - the chain's order and labels (Ads card, Blueprint part 1 as sent, the
 *   kickoff in dollars, the sale), Blueprint's real {usd, said} shape, a
 *   Blueprint draft changed after the send, the $1,000 guard on the
 *   Blueprint, the kickoff and the sale, the $2.50 floor (twice it is the
 *   desk's $5 floor), a kickoff with no fixed rate, an old Typeform answer,
 *   nothing agreed (null, never 0);
 * - the Ads card's Daily Ad Spend from cockpit-sync's copy
 *   (cockpit_campaigns.raw_data.contractedBudget), which the boardCards
 *   mirror omits, on the desk and on the client page;
 * - the TypeScript chain (launchModel.agreedBudget) equals the SQL chain on
 *   every case: the second source for every figure;
 * - the pipeline's kickoffBudget and agreedBudget, read null-safe from
 *   forms.kickoff.budget, and through build B5's cockpit_kickoff_budget(text)
 *   when it exists;
 * - the scope's contractedUsd and contractSource (the desk's default and 2x cap);
 * - the client page's agreed note on Budget/day, and its one sentence when the
 *   note cannot be read.
 * Every client, card and figure is invented.
 */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
  type AgreedBudget,
  agreedBudget,
  type KickoffBudget,
} from "../src/lib/launchModel";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

let db: Awaited<ReturnType<typeof cockpitTestDb>>;
const BUYER = "00000000-0000-4000-8000-0000000000b6",
  CSM = "00000000-0000-4000-8000-0000000000c6";
const FILE = "20261103e_launch_agreed_budget.sql";
const SAR = 0.2666;
const STAMP = "2026-11-03T08:00:00Z";

function table(file: string, name: string) {
  const sql = migration(file),
    start = sql.search(
      new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? public\\.${name}\\s*\\(`),
    );
  if (start < 0) throw Error(name);
  return sql.slice(start, sql.indexOf("\n);", start) + 3);
}
const one = async <T = any>(sql: string, params: unknown[] = []) =>
  (await db.query<{ r: T }>(sql, params)).rows[0].r;
async function asBuyer<T>(fn: () => Promise<T>) {
  await actor(db, BUYER);
  try {
    return await fn();
  } finally {
    await owner(db);
  }
}
const pipeline = (id: string) =>
  asBuyer(() =>
    one("select cockpit_launch_pipeline($1)->'clients'->0 r", [id]),
  );
const scope = (id: string, account: string) =>
  asBuyer(() =>
    one("select cockpit_media_account_scope('launch.copy',$1,$2) r", [
      id,
      account,
    ]),
  );
const md5Of = (fn: string) =>
  one<string>(
    "select md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) r from pg_proc p where p.oid = to_regprocedure($1)",
    [fn],
  );
async function client(
  id: string,
  name: string,
  account: string,
  over: { handover?: unknown; forms?: unknown; status?: string } = {},
) {
  await db.query(
    `INSERT INTO cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES($1,$1,$2,$3,'DFY',ARRAY[$4])`,
    [id, name, over.status ?? "Active", account],
  );
  await db.query(
    "INSERT INTO cockpit_meta_account_state(account_id,account_status,currency,fetched_at,run_id) VALUES($1,1,'USD',now(),'00000000-0000-4000-8000-000000000099')",
    [account],
  );
  await db.query(
    "INSERT INTO cockpit_client_onboarding(clickup_task_id,in_onboarding,handover,links,forms) VALUES($1,true,$2,'{}',$3)",
    [id, over.handover ?? {}, over.forms ?? null],
  );
}
const kickoffForm = (budget: unknown) => ({
  kickoff: {
    answers: [],
    form_id: "native",
    response_id: "resp-test",
    submitted_at: STAMP,
    ...(budget === undefined ? {} : { budget }),
  },
});

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The launch desk, as launch-desk-supabase.test.ts builds it.
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY)");
  await db.exec(
    table("20260923o_cockpit_domain_tables.sql", "cockpit_campaigns"),
  );
  await db.exec(
    "ALTER TABLE cockpit_campaigns ADD COLUMN IF NOT EXISTS source_deleted boolean DEFAULT false;",
  );
  await db.exec(migration("20260927g_cockpit_media_actions.sql"));
  await db.exec(
    "CREATE TABLE cockpit_ad_drafts(id bigint PRIMARY KEY,status text,launch_action_id uuid,meta_campaign_id text,meta_adset_id text,meta_ad_ids text[],launched_at timestamptz,error text); CREATE TABLE cockpit_campaign_action_messages(id uuid PRIMARY KEY,campaign_name text,actor_id uuid,text text,at timestamptz,learning_started_at timestamptz);",
  );
  for (const [f, n] of [
    ["20260927w_media_read_models.sql", "cockpit_media_source_state"],
    ["20260927w_media_read_models.sql", "cockpit_media_sources"],
    ["20261016111157_board_facts.sql", "cockpit_board_clients"],
    ["20261016210000_board_facts_checked.sql", "cockpit_board_account_ties"],
    ["20261016121700_meta_ad_days.sql", "cockpit_meta_ad_days"],
    ["20261017100000_meta_budgets.sql", "cockpit_meta_account_state"],
    ["20261011c_csm_call_store.sql", "cockpit_csm_meta_activities"],
    ["20261024a_brand_blueprints.sql", "cockpit_blueprints"],
    ["20261024a_brand_blueprints.sql", "cockpit_blueprint_settings"],
  ])
    await db.exec(table(f, n));
  // forms holds the kickoff read model (forms.kickoff), as live.
  await db.exec(
    "ALTER TABLE cockpit_board_clients ADD COLUMN registry_status text, ADD COLUMN card_stage text; CREATE TABLE cockpit_client_onboarding(clickup_task_id text PRIMARY KEY,in_onboarding boolean,handover jsonb,links jsonb,forms jsonb); CREATE TABLE cockpit_excluded_ads(ad_id text,account_id text);",
  );
  await db.exec(
    table("20261004d_media_native_surface.sql", "cockpit_media_native_records"),
  );
  await db.exec(
    migration("20261024a_brand_blueprints.sql").match(
      /CREATE OR REPLACE FUNCTION public.cockpit_blueprint_part_answers[\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(migration("20261024b_media_launch_desk.sql"));
  await db.exec(migration("20261024125012_media_clients_workspace.sql"));
  await db.exec(
    migration("20261024131543_launch_creative_imports.sql").match(
      /CREATE OR REPLACE FUNCTION public.cockpit_media_clients\([\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(
    migration("20261024131543_launch_creative_imports.sql").match(
      /CREATE OR REPLACE FUNCTION public.cockpit_media_client_notices\(\)[\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(`CREATE FUNCTION public.cockpit_media_native_guard(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_launch_import_scope(uuid,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  await db.exec(migration("20261024172848_media_client_lifecycle.sql"));
  await db.exec(
    migration("20261024175515_media_client_lifecycle_revision_guard.sql"),
  );
  await db.exec(migration("20261026t_launch_card_at_switch_on.sql"));

  // The client page's read (20261017100100), its board readers stubbed: the
  // client's row comes from test_board_row.
  await db.exec(`
    CREATE TABLE public.test_board_row(location text PRIMARY KEY, row jsonb);
    CREATE TABLE public.cockpit_board_levers(location_id text, created_at timestamptz DEFAULT now());
    CREATE FUNCTION public.cockpit_has_active_seat() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL $$;
    CREATE FUNCTION public.cockpit_client_allowed(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.cockpit_board_check_window(date,date) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.cockpit_meta_ad_days_status() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_rows(date,date,text,jsonb) RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT coalesce(jsonb_build_array((SELECT row FROM public.test_board_row WHERE location = $3)), '[]'::jsonb) $$;
    CREATE FUNCTION public.cockpit_board_targets_map(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_marks_json(text,date,date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_ad_cover(text[],date,date,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_no_outcome_list(text,date,date,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_budget_list(text[],date,date,jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_lever_json(public.cockpit_board_levers) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  await db.exec(boardClientLive());
  await db.exec(
    "REVOKE ALL ON FUNCTION public.cockpit_board_client(text,date,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.cockpit_board_client(text,date,date) TO authenticated;",
  );

  await member(db, BUYER, "buyer-b6@tests.invalid", ["media_buyer"]);
  await member(db, CSM, "csm-b6@tests.invalid", ["csm"]);

  // Invented clients, one per question.
  await client("bp-object", "Cedar Test Studio", "710000001", {
    handover: { daily_budget: 30 },
    forms: kickoffForm({
      amount: 150,
      currency: "SAR",
      usd: 39.99,
      rate: SAR,
      said: "150 SAR",
    }),
  });
  await db.exec(
    `INSERT INTO cockpit_blueprints(task_id,client_name,answers,parts,updated_by) VALUES('bp-object','Cedar Test Studio','{"daily_budget":{"usd":45,"said":"45 dollars a day"},"red_lines":"No invented offers","best_client":"PRIVATE PART TWO"}','{"1":{"lastAt":"2026-11-02T09:00:00Z","sent":{"daily_budget":{"usd":45,"said":"45 dollars a day"}}},"2":{"secret":"NO"}}','test')`,
  );
  await client("kick-sar", "Dune Test Interiors", "710000002", {
    handover: { daily_budget: 30 },
    forms: kickoffForm({
      amount: 150,
      currency: "SAR",
      usd: 39.99,
      rate: SAR,
      said: "150 SAR",
    }),
  });
  await client("sale-only", "Harbour Test Fitout", "710000003", {
    handover: { daily_budget: 40 },
    forms: kickoffForm(undefined),
  });
  await client("sale-month", "Lantern Test Build", "710000004", {
    handover: { daily_budget: 1200 },
  });
  await client("kick-bhd", "Pearl Test Homes", "710000005", {
    handover: { daily_budget: 30 },
    forms: kickoffForm({
      amount: 20,
      currency: "BHD",
      usd: null,
      rate: null,
      said: "20 BHD",
    }),
  });
  await client("nothing", "Quiet Test Spaces", "710000006");
  await client("garbage", "Willow Test Works", "710000007", {
    handover: { daily_budget: "a lot" },
    forms: { kickoff: "not an object" },
  });
  await client("bp-draft", "Atlas Test Rooms", "710000008", {
    forms: kickoffForm({ amount: 60, currency: "USD", usd: 60, said: "60" }),
  });
  await db.exec(
    `INSERT INTO cockpit_blueprints(task_id,client_name,answers,parts,updated_by) VALUES('bp-draft','Atlas Test Rooms','{"daily_budget":{"usd":80,"said":"80"}}','{}','test')`,
  );
  // Part 1 sent at $45; on the call the draft became $150 and was not sent again.
  await client("bp-changed", "Fable Test Rooms", "710000010", {
    handover: { daily_budget: 30 },
  });
  await db.exec(
    `INSERT INTO cockpit_blueprints(task_id,client_name,answers,parts,updated_by) VALUES('bp-changed','Fable Test Rooms','{"daily_budget":{"usd":150,"said":"150"}}','{"1":{"lastAt":"2026-11-02T09:00:00Z","sent":{"daily_budget":{"usd":45,"said":"45"}}}}','test')`,
  );
  // Running ads: the Ads card's Daily Ad Spend is only in cockpit-sync's copy
  // (the boardCards mirror omits it). $50 on the card, $30 from the sale.
  await client("ads-card", "Gulf Test Kitchens", "710000009", {
    handover: { daily_budget: 30 },
  });
  await db.query(
    `INSERT INTO cockpit_campaigns(client_name,meta_account_id,task_id,raw_data,synced_at,source_deleted) VALUES
      ('Gulf Test Kitchens |MAHARA|','act_710000009','card-b6-a','{"taskId":"card-b6-a","contractedBudget":50}','2026-11-03T06:00:00Z',false),
      ('Gulf Test Kitchens |MAHARA|','act_710000009','card-b6-a','{"taskId":"card-b6-a","contractedBudget":45}','2026-11-01T06:00:00Z',false),
      ('Gulf Test Kitchens |MAHARA|','act_710000009','card-b6-0','{"taskId":"card-b6-0","contractedBudget":999}','2026-11-03T06:00:00Z',true),
      ('Gulf Test Kitchens |MAHARA|','act_710000009','card-b6-b','{"taskId":"card-b6-b"}','2026-11-03T06:00:00Z',false),
      ('Other Test Co','act_799999999','card-b6-c','{"taskId":"card-b6-c","clientName":"Kelp Test Gardens","contractedBudget":"40"}','2026-11-03T06:00:00Z',false),
      ('Other Test Co','act_799999998','card-b6-d','{"taskId":"card-b6-d","clientName":"Someone Else Test","contractedBudget":70}','2026-11-03T06:00:00Z',false)`,
  );
  // Matched by name only: the campaign's account is not the client's.
  await client("ads-name", "Kelp Test Gardens", "710000011", {
    handover: { daily_budget: 35 },
  });
  await db.query(
    "INSERT INTO test_board_row(location,row) VALUES($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)",
    [
      "kick-sar",
      { values: { dailyBudget: { v: 25, status: null } }, noOutcome: 0 },
      "nothing",
      {
        values: { dailyBudget: { v: null, status: "not_measured" } },
        noOutcome: 0,
      },
      "sale-only",
      {
        values: { dailyBudget: { v: 0, status: null, campaigns: 0 } },
        noOutcome: 0,
      },
      "sale-month",
      {
        values: { dailyBudget: { v: 80, status: null, atLeast: true } },
        noOutcome: 0,
      },
      "ads-card",
      { values: { dailyBudget: { v: 50, status: null } }, noOutcome: 0 },
    ],
  );

  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
}, 60000);
afterEach(async () => owner(db));
afterAll(async () => db?.close());

function boardClientLive() {
  return migration("20261017100100_board_budgets.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_board_client\(p_location text[\s\S]*?\nEND \$\$;/,
  )![0];
}

// ---------------------------------------------------------------------------
// The guard, the grants and a second apply.

test("each replaced body is guarded on its live md5, and a second apply is a no-op", async () => {
  const sql = migration(FILE);
  for (const [fn, live] of [
    [
      "public.cockpit_launch_pipeline(text)",
      "66e23b57d1bf4dfa4df22d62194813f4",
    ],
    [
      "public.cockpit_media_account_scope_before_client_hold(text,text,text,uuid)",
      "2507f3ec23805d4de14cceb51be68734",
    ],
    [
      "public.cockpit_board_client(text,date,date)",
      "f252d3696507ca814aa28eec57723e0a",
    ],
  ]) {
    const after = await md5Of(fn);
    // The guard names both: the live body (first apply) and this file's (a second apply).
    expect(sql).toContain(`'${fn}', '${live}', '${after}'`);
  }
  const before = await md5Of("public.cockpit_launch_pipeline(text)");
  await db.exec(sql);
  expect(await md5Of("public.cockpit_launch_pipeline(text)")).toBe(before);
});

test("a drifted body stops the file before anything is replaced", async () => {
  // Another build changes the client page's read: this file refuses, and the read stays theirs.
  const drifted = boardClientLive().replace(
    "DECLARE",
    "DECLARE\n  v_other_build integer; -- another change",
  );
  await db.exec(drifted);
  const theirs = await md5Of("public.cockpit_board_client(text,date,date)");
  await expect(db.exec(migration(FILE))).rejects.toThrow(
    "cockpit_board_client(text,date,date) changed since it was read for 20261103e",
  );
  // The refused file's own BEGIN is still open: close it as the runner would.
  await db.exec("ROLLBACK");
  expect(await md5Of("public.cockpit_board_client(text,date,date)")).toBe(
    theirs,
  );
  // Back to the live body, then this file again.
  await db.exec(boardClientLive());
  await db.exec(migration(FILE));
  expect(
    await one<boolean>(
      "select position('agreed' in prosrc) > 0 r from pg_proc where oid = 'public.cockpit_board_client(text,date,date)'::regprocedure",
    ),
  ).toBe(true);
});

test("the helpers have no grant; the reads keep their live grants", async () => {
  const can = (role: string, fn: string) =>
    one<boolean>("select has_function_privilege($1,$2,'EXECUTE') r", [
      role,
      fn,
    ]);
  for (const fn of [
    "cockpit_launch_usd(jsonb)",
    "cockpit_launch_usd_words(numeric)",
    "cockpit_launch_kickoff_budget(text)",
    "cockpit_launch_ads_cards(text[],text)",
    "cockpit_launch_budget_hold(text,numeric,text)",
    "cockpit_launch_agreed_chain(jsonb,jsonb,jsonb,jsonb)",
    "cockpit_launch_agreed_budget(text)",
    "cockpit_board_agreed_note(text,jsonb)",
    "cockpit_media_account_scope_before_client_hold(text,text,text,uuid)",
  ])
    for (const role of ["anon", "authenticated", "service_role"])
      expect(await can(role, fn)).toBe(false);
  for (const fn of [
    "cockpit_launch_pipeline(text)",
    "cockpit_board_client(text,date,date)",
  ]) {
    expect(await can("authenticated", fn)).toBe(true);
    expect(await can("anon", fn)).toBe(false);
    expect(await can("service_role", fn)).toBe(false);
  }
  // A seat that is not a media buyer still cannot read the desk.
  await actor(db, CSM);
  await expect(
    db.query("select cockpit_launch_pipeline('kick-sar')"),
  ).rejects.toThrow("Media buyer");
  await owner(db);
});

// ---------------------------------------------------------------------------
// The chain, in SQL and in TypeScript.

type ChainInput = {
  cards?: unknown;
  brief?: unknown;
  kickoffBudget?: Partial<KickoffBudget> | null;
  handover?: unknown;
};
const kick = (k: Partial<KickoffBudget>): KickoffBudget => ({
  amount: null,
  currency: null,
  usd: null,
  fromText: false,
  said: null,
  at: STAMP,
  ...k,
});
async function chain(input: ChainInput): Promise<AgreedBudget> {
  // Every part goes as JSON text, so a bare string is a JSON string, as in the row.
  const sql = await one<AgreedBudget>(
    "select cockpit_launch_agreed_chain($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) r",
    [
      JSON.stringify(input.cards ?? []),
      JSON.stringify(input.brief ?? null),
      JSON.stringify(input.kickoffBudget ?? null),
      JSON.stringify(input.handover ?? {}),
    ],
  );
  // The second source: the same rule in the cockpit gives the same answer.
  expect(
    agreedBudget({
      cards: (input.cards ?? []) as any[],
      brief: input.brief ?? null,
      kickoffBudget: (input.kickoffBudget ?? null) as KickoffBudget | null,
      handover: input.handover ?? {},
    }),
  ).toEqual(sql);
  return sql;
}
// Part 1 sent as it stands: the draft and the snapshot are the same.
const sent = (dailyBudget: unknown) => ({
  answers: { daily_budget: dailyBudget },
  sentAt: "2026-11-02T09:00:00Z",
  sentBudget: dailyBudget,
});

test("the chain runs Ads card, Blueprint part 1, kickoff, sale, and lists every source", async () => {
  const all = {
    cards: [
      { taskId: "card-b", dailyAdSpend: 22 },
      { taskId: "card-a", dailyAdSpend: "20" },
      { taskId: "card-0", dailyAdSpend: 0 },
    ],
    brief: sent({ usd: 30, said: "30 a day" }),
    kickoffBudget: kick({ amount: 150, currency: "SAR", usd: 39.99 }),
    handover: { daily_budget: 40 },
  };
  const a = await chain(all);
  expect(a).toMatchObject({
    usd: 20,
    key: "adsCard",
    source: "Ads card",
    from: "the Ads card",
  });
  expect(a.sources.map(s => [s.key, s.usd, s.used])).toEqual([
    ["adsCard", 20, true],
    ["blueprint", 30, false],
    ["kickoff", 39.99, false],
    ["sale", 40, false],
  ]);
  expect(a.sources.map(s => s.label)).toEqual([
    "Ads card",
    "Blueprint part 1",
    "Kickoff, 150 SAR",
    "Sale (card Daily Budget)",
  ]);
  // Blueprint's real shape {usd, said} now wins over the kickoff and the sale.
  expect(await chain({ ...all, cards: [] })).toMatchObject({
    usd: 30,
    source: "Blueprint part 1",
  });
  // A bare figure (the old test's shape) is still read.
  expect(await chain({ ...all, cards: [], brief: sent(35) })).toMatchObject({
    usd: 35,
    source: "Blueprint part 1",
  });
  expect(await chain({ ...all, cards: [], brief: null })).toMatchObject({
    usd: 39.99,
    source: "Kickoff, 150 SAR",
    from: "kickoff, 150 SAR",
  });
  // No kickoff: the sale, under its own name (it was mislabelled "Kickoff").
  expect(await chain({ handover: { daily_budget: 40 } })).toMatchObject({
    usd: 40,
    source: "Sale (card Daily Budget)",
    from: "the sale",
  });
  // A kickoff in dollars needs no currency in its name.
  expect(
    await chain({
      kickoffBudget: kick({ amount: 60, currency: "USD", usd: 60 }),
    }),
  ).toMatchObject({ usd: 60, source: "Kickoff" });
});

test("Blueprint part 1 counts once it is sent", async () => {
  const a = await chain({
    brief: { answers: { daily_budget: { usd: 80, said: "80" } }, sentAt: null },
    kickoffBudget: kick({ amount: 60, currency: "USD", usd: 60 }),
  });
  expect(a).toMatchObject({ usd: 60, source: "Kickoff" });
  expect(a.notes).toEqual([
    "Blueprint part 1 says $80 a day but is not sent yet, so it is not the default.",
  ]);
});

test("a sale figure of $1,000 or more is never the default", async () => {
  const a = await chain({ handover: { daily_budget: 1200 } });
  expect(a.usd).toBeNull();
  expect(a.source).toBeNull();
  expect(a.sources).toEqual([
    {
      key: "sale",
      label: "Sale (card Daily Budget)",
      from: "the sale",
      usd: 1200,
      used: false,
      note: "The sale's figure, $1,200 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
    },
  ]);
  expect((await chain({ handover: { daily_budget: 999.5 } })).usd).toBe(999.5);
  // $1,000 exactly is guarded too.
  expect((await chain({ handover: { daily_budget: 1000 } })).usd).toBeNull();
});

test("a kickoff with no fixed rate keeps its amount and is not the default", async () => {
  const a = await chain({
    kickoffBudget: kick({ amount: 20, currency: "BHD", usd: null }),
    handover: { daily_budget: 30 },
  });
  expect(a).toMatchObject({ usd: 30, key: "sale" });
  expect(a.sources[0]).toEqual({
    key: "kickoff",
    label: "Kickoff, 20 BHD",
    from: "kickoff, 20 BHD",
    usd: null,
    used: false,
    note: "No fixed rate for BHD yet, so the kickoff's 20 BHD is not the default.",
  });
  // Under $2.50 a day (1 SAR) is said, never taken.
  const tiny = await chain({
    kickoffBudget: kick({ amount: 1, currency: "SAR", usd: 0.27 }),
  });
  expect(tiny.usd).toBeNull();
  expect(tiny.notes).toEqual([
    "The kickoff's $0.27 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
  ]);
  // An amount with no currency and no dollars.
  expect((await chain({ kickoffBudget: kick({ amount: 75 }) })).notes).toEqual([
    "The kickoff's 75 has no currency, so it is not the default.",
  ]);
});

test("an old Typeform answer read as dollars names what was typed", async () => {
  const a = await chain({
    kickoffBudget: kick({
      amount: 60,
      currency: "USD",
      usd: 60,
      fromText: true,
      said: "$60",
    }),
    handover: { daily_budget: 30 },
  });
  expect(a).toMatchObject({
    usd: 60,
    source: "Kickoff, as typed: $60",
    from: "kickoff, as typed: $60",
  });
  // No text kept: the dollars, else the amount, name it.
  expect(
    (
      await chain({
        kickoffBudget: kick({ amount: 60, usd: 60, fromText: true }),
      })
    ).source,
  ).toBe("Kickoff, as typed: $60");
  expect(
    (
      await chain({
        kickoffBudget: kick({ amount: 45, currency: "USD", fromText: true }),
      })
    ).sources[0].label,
  ).toBe("Kickoff, as typed: 45");
});

test("nothing agreed is null with no sources, never 0; bad shapes are skipped", async () => {
  expect(await chain({})).toEqual({
    usd: null,
    key: null,
    source: null,
    from: null,
    sources: [],
    notes: [],
  });
  const odd = await chain({
    cards: "not a list",
    brief: { answers: { daily_budget: { usd: "lots" } }, sentAt: STAMP },
    kickoffBudget: kick({ amount: null, usd: null }),
    handover: { daily_budget: -5 },
  });
  expect(odd.usd).toBeNull();
  expect(odd.sources).toEqual([]);
  // Cents round as PostgreSQL rounds them, in both places.
  expect((await chain({ handover: { daily_budget: 30.005 } })).usd).toBe(30.01);
  expect((await chain({ handover: { daily_budget: "0.004" } })).usd).toBeNull();
});

test("Blueprint part 1 counts as it was sent; a later draft is listed, never the default", async () => {
  // Sent at $45; the creative director changed the draft to $150 and did not send it.
  const a = await chain({
    brief: {
      answers: { daily_budget: { usd: 150, said: "150" } },
      sentAt: "2026-11-02T09:00:00Z",
      sentBudget: { usd: 45, said: "45" },
    },
    handover: { daily_budget: 30 },
  });
  expect(a).toMatchObject({
    usd: 45,
    key: "blueprint",
    source: "Blueprint part 1",
  });
  expect(a.sources.map(s => [s.key, s.label, s.usd, s.used])).toEqual([
    ["blueprint", "Blueprint part 1", 45, true],
    ["blueprintDraft", "Blueprint part 1, change not sent", 150, false],
    ["sale", "Sale (card Daily Budget)", 30, false],
  ]);
  expect(a.notes).toEqual([
    "Blueprint part 1 now says $150 a day but the change is not sent yet, so it is not the default.",
  ]);
  // Sent before the figure was filled in: the draft's figure is not sent.
  const late = await chain({
    brief: {
      answers: { daily_budget: { usd: 80 } },
      sentAt: "2026-11-02T09:00:00Z",
      sentBudget: null,
    },
    handover: { daily_budget: 30 },
  });
  expect(late).toMatchObject({ usd: 30, key: "sale" });
  expect(late.sources[0]).toMatchObject({
    key: "blueprint",
    usd: 80,
    used: false,
  });
  expect(late.notes).toEqual([
    "Blueprint part 1 now says $80 a day but the change is not sent yet, so it is not the default.",
  ]);
  // The figure sent, as a bare number, equal to the draft: one source.
  expect(
    (
      await chain({
        brief: {
          answers: { daily_budget: { usd: 45 } },
          sentAt: STAMP,
          sentBudget: 45,
        },
      })
    ).sources.map(s => s.key),
  ).toEqual(["blueprint"]);
});

test("the $1,000 guard holds the Blueprint and the kickoff as well as the sale", async () => {
  // A card Daily Budget of 1200 prefills the Blueprint, which is then sent.
  const bp = await chain({
    brief: sent({ usd: 1200, said: "1200" }),
    handover: { daily_budget: 1200 },
  });
  expect(bp.usd).toBeNull();
  expect(bp.notes).toEqual([
    "Blueprint part 1's $1,200 a day looks like a month or another currency, so it is not the default. Ask the creative director.",
    "The sale's figure, $1,200 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
  ]);
  // An old kickoff typed as 1500 (a month) and read as dollars.
  const typed = await chain({
    kickoffBudget: kick({
      amount: 1500,
      currency: "USD",
      usd: 1500,
      fromText: true,
      said: "1500",
    }),
    handover: { daily_budget: 40 },
  });
  expect(typed).toMatchObject({ usd: 40, key: "sale" });
  expect(typed.notes).toEqual([
    "The kickoff's $1,500 a day looks like a month or another currency, so it is not the default. Ask the CSM.",
  ]);
  // A native kickoff at $1,000 or more is held too; under it, it stands.
  expect(
    (
      await chain({
        kickoffBudget: kick({ amount: 1000, currency: "USD", usd: 1000 }),
      })
    ).usd,
  ).toBeNull();
  expect(
    (
      await chain({
        kickoffBudget: kick({ amount: 999, currency: "USD", usd: 999 }),
      })
    ).usd,
  ).toBe(999);
  // The Ads card is the running contract: no guard.
  expect(
    (await chain({ cards: [{ taskId: "card-x", dailyAdSpend: 1200 }] })).usd,
  ).toBe(1200);
});

test("a figure whose 2x cap is under the desk's $5 floor is never the default", async () => {
  // Twice $2 is $4: no budget from $5 could pass.
  const two = await chain({
    kickoffBudget: kick({ amount: 2, currency: "USD", usd: 2 }),
    handover: { daily_budget: 30 },
  });
  expect(two).toMatchObject({ usd: 30, key: "sale" });
  expect(two.notes).toEqual([
    "The kickoff's $2 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
  ]);
  // 7 SAR is $1.87.
  expect(
    (
      await chain({
        kickoffBudget: kick({ amount: 7, currency: "SAR", usd: 1.87 }),
      })
    ).notes,
  ).toEqual([
    "The kickoff's $1.87 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
  ]);
  // Every source: the Ads card, the Blueprint, the sale.
  const low = await chain({
    cards: [{ taskId: "card-x", dailyAdSpend: 2 }],
    brief: sent({ usd: 2.49 }),
    handover: { daily_budget: 1 },
  });
  expect(low.usd).toBeNull();
  expect(low.notes).toEqual([
    "The Ads card's $2 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
    "Blueprint part 1's $2.49 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
    "The sale's $1 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
  ]);
  // $2.50 gives a $5 cap: it stands.
  expect((await chain({ handover: { daily_budget: 2.5 } })).usd).toBe(2.5);
});

test("the Ads card from cockpit-sync's copy is read as a card, the mirror's first on a tie", async () => {
  // The pipeline passes the mirror's cards, then adsCards; the first by task id wins.
  const a = await chain({
    cards: [{ taskId: "card-b", name: "Mirror card" }],
    handover: { daily_budget: 30 },
  });
  expect(a.key).toBe("sale");
  const b = await chain({
    cards: [
      { taskId: "card-b", name: "Mirror card" },
      { taskId: "card-b", dailyAdSpend: 50 },
      { taskId: "card-c", dailyAdSpend: 70 },
    ],
    handover: { daily_budget: 30 },
  });
  expect(b).toMatchObject({ usd: 50, source: "Ads card" });
  // Same task twice: as listed (the mirror's before the copy).
  expect(
    (
      await chain({
        cards: [
          { taskId: "card-b", dailyAdSpend: 55 },
          { taskId: "card-b", dailyAdSpend: 50 },
        ],
      })
    ).usd,
  ).toBe(55);
});

// ---------------------------------------------------------------------------
// The pipeline, the scope and the client page.

test("the pipeline adds the kickoff's budget and the chain for one client only", async () => {
  const c = await pipeline("kick-sar");
  expect(c.kickoffBudget).toEqual({
    amount: 150,
    currency: "SAR",
    usd: 39.99,
    fromText: false,
    said: null,
    at: STAMP,
  });
  expect(c.agreedBudget).toMatchObject({
    usd: 39.99,
    source: "Kickoff, 150 SAR",
  });
  expect(c.agreedBudget.sources.map((s: any) => s.key)).toEqual([
    "kickoff",
    "sale",
  ]);
  // The cockpit's own rule reads the same row the same way.
  expect(agreedBudget(c)).toEqual(c.agreedBudget);
  const list = await asBuyer(() => one("select cockpit_launch_pipeline() r"));
  for (const row of list.clients) {
    expect(row.kickoffBudget).toBeUndefined();
    expect(row.agreedBudget).toBeUndefined();
  }
  // The Blueprint's {usd, said} reaches the desk; part 2 never does.
  const bp = await pipeline("bp-object");
  expect(bp.agreedBudget).toMatchObject({
    usd: 45,
    source: "Blueprint part 1",
  });
  expect(JSON.stringify(bp)).not.toContain("PRIVATE PART TWO");
});

test("the pipeline reads the Ads card's Daily Ad Spend from cockpit-sync's copy", async () => {
  const c = await pipeline("ads-card");
  // The mirror holds no card for this client; the copy does. Its latest sync
  // per card; a dropped row and a card with no figure are left out.
  expect(c.cards).toEqual([]);
  expect(c.adsCards).toEqual([{ taskId: "card-b6-a", dailyAdSpend: 50 }]);
  expect(c.agreedBudget).toMatchObject({
    usd: 50,
    key: "adsCard",
    source: "Ads card",
    from: "the Ads card",
  });
  expect(
    c.agreedBudget.sources.map((s: any) => [s.key, s.usd, s.used]),
  ).toEqual([
    ["adsCard", 50, true],
    ["sale", 30, false],
  ]);
  expect(agreedBudget(c)).toEqual(c.agreedBudget);
  // Matched by the campaign's client name when the account is not the client's.
  const n = await pipeline("ads-name");
  expect(n.adsCards).toEqual([{ taskId: "card-b6-c", dailyAdSpend: 40 }]);
  expect(n.agreedBudget).toMatchObject({ usd: 40, key: "adsCard" });
  expect(agreedBudget(n)).toEqual(n.agreedBudget);
  // A client with no copy has none.
  expect((await pipeline("kick-sar")).adsCards).toEqual([]);
  // The list carries no adsCards.
  const list = await asBuyer(() => one("select cockpit_launch_pipeline() r"));
  for (const row of list.clients) expect(row.adsCards).toBeUndefined();
});

test("the pipeline's Blueprint is the figure sent, not a later draft", async () => {
  const c = await pipeline("bp-changed");
  expect(c.brief.sentBudget).toEqual({ usd: 45, said: "45" });
  expect(c.agreedBudget).toMatchObject({ usd: 45, key: "blueprint" });
  expect(c.agreedBudget.notes).toEqual([
    "Blueprint part 1 now says $150 a day but the change is not sent yet, so it is not the default.",
  ]);
  expect(agreedBudget(c)).toEqual(c.agreedBudget);
});

test("the kickoff is read null-safe from forms.kickoff.budget", async () => {
  expect((await pipeline("sale-only")).kickoffBudget).toBeNull();
  expect((await pipeline("nothing")).kickoffBudget).toBeNull();
  const g = await pipeline("garbage");
  expect(g.kickoffBudget).toBeNull();
  expect(g.agreedBudget).toMatchObject({ usd: null, sources: [] });
  const bhd = await pipeline("kick-bhd");
  expect(bhd.kickoffBudget).toMatchObject({
    amount: 20,
    currency: "BHD",
    usd: null,
  });
  expect(bhd.agreedBudget).toMatchObject({ usd: 30, key: "sale" });
});

test("build B5's cockpit_kickoff_budget(text) is read when it exists", async () => {
  // B5's helper reads old Typeform text as dollars; a stand-in returns its shape.
  await db.exec(`CREATE FUNCTION public.cockpit_kickoff_budget(p_task text) RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT CASE WHEN p_task = 'sale-only' THEN '{"amount":60,"currency":"USD","usd":60,"rate":1,"said":"  $60   a day ","from_text":true}'::jsonb END $$;`);
  try {
    const c = await pipeline("sale-only");
    expect(c.kickoffBudget).toEqual({
      amount: 60,
      currency: "USD",
      usd: 60,
      fromText: true,
      said: "$60 a day",
      at: STAMP,
    });
    expect(c.agreedBudget).toMatchObject({
      usd: 60,
      source: "Kickoff, as typed: $60 a day",
    });
    // A card B5 returns nothing for has no kickoff figure, even with a side key.
    expect((await pipeline("kick-sar")).kickoffBudget).toBeNull();
  } finally {
    await db.exec("DROP FUNCTION public.cockpit_kickoff_budget(text)");
  }
});

test("the scope's contract follows the chain, so the desk's default and 2x cap do", async () => {
  expect(await scope("kick-sar", "710000002")).toMatchObject({
    contractedUsd: 39.99,
    contractSource: "Kickoff, 150 SAR",
  });
  expect(await scope("bp-object", "710000001")).toMatchObject({
    contractedUsd: 45,
    contractSource: "Blueprint part 1",
  });
  expect(await scope("sale-only", "710000003")).toMatchObject({
    contractedUsd: 40,
    contractSource: "Sale (card Daily Budget)",
  });
  // The guarded sale gives no contract: the $100 seat cap applies.
  const month = await scope("sale-month", "710000004");
  expect(month.contractedUsd).toBeNull();
  expect(month.contractSource).toBeNull();
  // A draft Blueprint is not the default; the kickoff is.
  expect(await scope("bp-draft", "710000008")).toMatchObject({
    contractedUsd: 60,
    contractSource: "Kickoff",
  });
  // A draft changed after the send does not move the 2x cap: the figure sent does.
  expect(await scope("bp-changed", "710000010")).toMatchObject({
    contractedUsd: 45,
    contractSource: "Blueprint part 1",
  });
  // The Ads card's figure from cockpit-sync's copy, before the live card is read.
  expect(await scope("ads-card", "710000009")).toMatchObject({
    contractedUsd: 50,
    contractSource: "Ads card",
  });
});

const page = (location: string) =>
  asBuyer(() =>
    one(
      "select cockpit_board_client($1,'2026-10-20'::date,'2026-11-02'::date) r",
      [location],
    ),
  );

test("the client page's Budget/day cell says the agreed figure against the budget now", async () => {
  const p = await page("kick-sar");
  expect(p.client.values.dailyBudget.v).toBe(25);
  expect(p.client.values.dailyBudget.agreed).toMatchObject({
    usd: 39.99,
    key: "kickoff",
    from: "kickoff, 150 SAR",
    head: "Agreed $39.99 a day (kickoff, 150 SAR).",
    now: "Set now: $25 a day.",
    words: "Agreed $39.99 a day (kickoff, 150 SAR). Set now: $25 a day.",
    notes: [],
  });
  expect((await page("sale-only")).client.values.dailyBudget.agreed.words).toBe(
    "Agreed $40 a day (the sale). Set now: no daily budget switched on.",
  );
  const month = (await page("sale-month")).client.values.dailyBudget.agreed;
  expect(month.words).toBe(
    "No agreed budget yet. Set now: at least $80 a day.",
  );
  expect(month.notes).toEqual([
    "The sale's figure, $1,200 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
  ]);
  // Running ads: the Ads card's figure from cockpit-sync's copy, not the sale's.
  const ads = (await page("ads-card")).client.values.dailyBudget.agreed;
  expect(ads).toMatchObject({
    usd: 50,
    key: "adsCard",
    from: "the Ads card",
    words: "Agreed $50 a day (the Ads card). Set now: $50 a day.",
    notes: [],
  });
  expect(ads.sources.map((s: any) => [s.key, s.usd, s.used])).toEqual([
    ["adsCard", 50, true],
    ["sale", 30, false],
  ]);
  // The budget now not measured: the agreed part only, never "$0".
  const none = (await page("nothing")).client.values.dailyBudget.agreed;
  expect(none).toMatchObject({
    usd: null,
    now: null,
    words: "No agreed budget yet.",
  });
  // Only an active seat reads the page.
  await actor(db, null);
  await expect(
    db.query(
      "select cockpit_board_client('kick-sar','2026-10-20'::date,'2026-11-02'::date)",
    ),
  ).rejects.toThrow();
  await owner(db);
});

test("a note that cannot be read says so in one sentence and the page stands", async () => {
  const chainFn = migration(FILE).match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_launch_agreed_budget\(p_clickup_id text\)[\s\S]*?END \$\$;/,
  )![0];
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_launch_agreed_budget(p_clickup_id text)
    RETURNS jsonb LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'test: the chain is down'; END $$;`);
  try {
    const p = await page("kick-sar");
    expect(p.client.values.dailyBudget.v).toBe(25);
    expect(p.client.values.dailyBudget.agreed).toEqual({
      words:
        "The agreed budget could not be read just now. Reload the page; if it stays, the tech lead checks the launch desk's budget chain.",
    });
    expect(p.clientName).toBe("Dune Test Interiors");
  } finally {
    await db.exec(chainFn);
    await db.exec(
      "REVOKE ALL ON FUNCTION public.cockpit_launch_agreed_budget(text) FROM PUBLIC, anon, authenticated, service_role",
    );
  }
});

test("the migration writes no row and touches no outside system", async () => {
  const sql = migration(FILE);
  expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
  expect(sql).not.toMatch(/net\.http|http_post|pg_net/);
  // No rate is added: BHD and OMR wait for the CEO.
  expect(sql).not.toMatch(/cockpit_board_usd_rate\s*\(\s*p_currency/);
  expect(
    await one<string | null>("select public.cockpit_launch_usd_words(1200) r"),
  ).toBe("$1,200");
});
