/**
 * The kickoff's daily budget as an amount and a currency, and its close rate as a number
 * (20261103f_stage4_kickoff_amounts.sql; plan build B5, item 5 forms half; docs/forms/WAVE56-CONTRACT.md 4.21).
 *
 * The ground: the Blueprint's tables and gates as blueprints-supabase.test.ts builds them, with
 * 20261024a and 20261025o applied whole; then what 20261103f reads or replaces, cut from its canonical
 * migration (20261103b's question list, 20261102o's answers check and Typeform answers list, 20261102j's
 * send, seat, read model and native answers, 20261102p's card_facts, 20261016111157's fixed rates,
 * 20261103e's reader of the kickoff budget). The ground proves each replaced body is the live one by the
 * md5 the drift guard names. Stand-in tables give the send what it writes; a stand-in planner plans only
 * card_facts, from the stored answers through the Typeform answers list, as the real builder hands it.
 * The bodies the file replaces are also kept under _b, _o, _j and _p names, so every part the file does not
 * mean to change is compared with what it was.
 *
 * Covered: the drift guard, the after values, a second apply, the window for version 2 in place (a sent
 * kickoff off the test card or the switch on stops it; the CEO's canary does not); the question list; the
 * answers check's cases (40 USD, 37.5 SAR, 0, 100001, three decimals, EUR, a plain string; 20, 101, 12.5);
 * the send's read model (budget with usd null for BHD and below a cent, 0.01 QAR: never 0; close_rate); Make's handoff lines 71 and 102; the
 * Typeform kickoffs' parity (their answers pass through as they came); cockpit_kickoff_budget (the native
 * side key and old Typeform text) and the launch desk's reader of it; card_facts planned or not; the
 * Blueprint's sources; the second source (the SQL dollars equal currency.ts on the same amounts, and the
 * typed-text rule equals blueprintPrefill.parseBudget); grants. Every client, card and answer is invented.
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
import { parseBudget } from "../../client-success-cockpit/src/present/blueprintPrefill";
import { budgetAmount } from "../../../supabase/functions/clickup-writeback/forms.ts";
import * as edgeCurrency from "../../../supabase/functions/cockpit-media-api/currency.ts";
import { USD_PER, usdToBudget } from "../convex/currency";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const F = "20261103f_stage4_kickoff_amounts.sql";
const B = "20261103b_onboarding_v2_hints.sql";
const O = "20261102o_stage4_match_make.sql";
const J = "20261102j_stage4_native.sql";
const P = "20261102p_stage4_better_data.sql";
const E = "20261103e_launch_agreed_budget.sql";
const BP = "20261024a_brand_blueprints.sql";
const DRAIN = "20261025o_blueprint_close_drain.sql";

/** md5(white space folded prosrc) of the bodies 20261103f replaces, as live holds them (read 2026-11-03). */
const LIVE = {
  "cockpit_form_stage4_fields(text)": "eadfda57d24997ad958ec6c68a1f5703",
  "cockpit_kickoff_answers_check(jsonb)": "8c3045bcdcf0906294d78d9ca7377a9b",
  "cockpit_kickoff_submit(text,jsonb,uuid)": "bc569e54e47b14ecf4c99d714fdb3e92",
  "cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)": "71dbdcbec818527002f08cdff97f36fa",
  "cockpit_blueprint_sources(text)": "91de3df5b9c21c0f45472bc9dc1dd615",
} as const;
const NEW_FNS = [
  "cockpit_kickoff_budget_of(numeric,text)",
  "cockpit_kickoff_budget_read(text)",
  "cockpit_kickoff_budget(text)",
] as const;

const CEO = "00000000-0000-4000-8000-0000000000c3";
const CSM = "00000000-0000-4000-8000-0000000000a1";
const TEST_CARD = "86eywg1cq";
/** Invented cards, each with one kickoff at most (a second needs a reason). */
const CARD = {
  sar: "taskSar0001",
  bhd: "taskBhd0001",
  usd: "taskUsd0001",
  none: "taskNone001",
  j: "taskJ000001",
  legacy: "taskLeg0001",
  legacyRange: "taskLeg0002",
  legacyNative: "taskLeg0003",
  blank: "taskBlank01",
  cent: "taskCent001",
} as const;
const REF = {
  budget: "cf53482c-3d7d-45ab-b294-0230e917ea5f",
  closeRate: "079812c4-bb7e-4cc3-8e57-24c3b9e886d9",
  payment: "75e97e7d-4c19-437a-b4b8-67570c29344f",
  consult: "c0000001-0000-4000-8000-000000000008",
  platforms: "7d16afbb-b99a-4ee9-8718-4418cbeba534",
  recording: "b5578678-d0c2-475b-b66f-7ea54d55fe31",
} as const;
const DAILY_BUDGET = "539743c2-b6cd-4eeb-bf2f-abaf64769a5e";
const SIX = ["USD", "SAR", "KWD", "AED", "QAR", "BHD"];

type Row = Record<string, any>;
let db: PGlite;
const groundMd5: Record<string, string> = {};
let auditBefore = -1;
let auditAfter = -2;

const json = (v: unknown) => JSON.stringify(v);
function fnDef(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Canonical definition missing: ${name}`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$;", open + 2);
  return sql.slice(start, close + 3);
}
function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
/** A body under another name; calls: the names it calls, each read under the _b name (20261103b's list). */
const renamed = (sql: string, name: string, suffix: string, calls: string[] = []) =>
  calls.reduce(
    (s, n) => s.replace(new RegExp(`public\\.${n}\\(`, "g"), `public.${n}_b(`),
    fnDef(sql, name).replace(`FUNCTION public.${name}(`, `FUNCTION public.${name}${suffix}(`),
  );
/** A file without its BEGIN and COMMIT, to run inside a rolled-back test. */
const inTest = (file: string) =>
  migration(file)
    .replace(/^BEGIN;/m, "")
    .replace(/COMMIT;\s*$/m, "");

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
}
async function as<T = any>(who: string, text: string, params: unknown[] = []): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
  } finally {
    await asOwner();
  }
}
async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error("Expected a refusal");
}
async function rolledBack(fn: () => Promise<void>) {
  await asOwner();
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    // A refusal aborts the transaction, so the rollback comes first.
    await db.exec("ROLLBACK");
    await asOwner();
  }
}
const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );
const setting = (key: string, value: unknown) =>
  db.query(
    "INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ($1, $2::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, json(value)],
  );
const check = (answers: unknown, suffix = "") =>
  one<Row>(`SELECT public.cockpit_kickoff_answers_check${suffix}($1::jsonb) AS r`, [json(answers)]);
/** card_facts on answers by ref; at: when the kickoff was sent (NULL: no call date, so Daily Budget stands alone). */
const facts = (byRef: Row, suffix = "", form = "kickoff", at: string | null = null) =>
  one<Row>(
    `SELECT public.cockpit_form_stage4_card_facts${suffix}($1, 'taskFacts01', $2::jsonb, $3::timestamptz) AS r`,
    [form, json(byRef), at],
  );
const budgetOf = (amount: number | string, currency: string) =>
  one<Row | null>("SELECT public.cockpit_kickoff_budget_of($1::numeric, $2) AS r", [String(amount), currency]);
const budgetRead = (text: string | null) =>
  one<Row | null>("SELECT public.cockpit_kickoff_budget_read($1) AS r", [text]);
const kickoffBudget = (task: string) =>
  one<Row | null>("SELECT public.cockpit_kickoff_budget($1) AS r", [task]);
const submit = (task: string, answers: unknown, suffix = "") =>
  as<Row>(CEO, `SELECT public.cockpit_kickoff_submit${suffix}($1, $2::jsonb, $3) AS r`, [
    task,
    json(answers),
    crypto.randomUUID(),
  ]);
const readModel = (task: string) =>
  one<Row>("SELECT forms->'kickoff' AS r FROM public.cockpit_client_onboarding WHERE clickup_task_id = $1", [task]);
const stored = (id: string) =>
  one<Row>("SELECT to_jsonb(x) AS r FROM public.cockpit_form_responses x WHERE x.id = $1", [id]);
/** The answers every send below carries beside the two questions (invented). */
const REST = {
  contractStatus: "Signed",
  serviceAdvertised: ["Interior design"],
  consultationTypes: ["Online", "In-office"],
  adPlatforms: "Meta",
  paymentAmount: 1500,
  callRecording: "https://fathom.video/share/inventedKick01",
  newMrrUsd: 1200,
};

// --- The ground ------------------------------------------------------------------------------------

/** The Blueprint's tables and gates, as blueprints-supabase.test.ts builds them, then 24a and 25o whole. */
async function blueprintGround() {
  const roster = migration("20260927v_csm_read_models.sql");
  await db.exec(cut(roster, /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/, "csm source state"));
  await db.exec(cut(roster, /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/, "csm source state rows"));
  await db.exec(cut(roster, /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/, "csm sources"));
  await db.exec("REVOKE ALL ON public.cockpit_csm_source_state, public.cockpit_csm_sources FROM anon, authenticated;");
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "cockpit_ask_ai_owner_allowed",
    ),
  );
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  await db.exec(cut(gate, /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/, "gate for actor"));
  await db.exec(cut(gate, /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/, "gate"));
  await db.exec(
    cut(
      migration("20260926m_cockpit_csm_state.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/,
      "cockpit_client_allowed",
    ),
  );
  await db.exec(migration("20260927s_creative_read_models.sql"));
  await db.exec(
    cut(
      migration("20261019120000_csm_decks.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_deck_prep \([\s\S]*?\n\);/,
      "deck prep",
    ),
  );
  await db.exec(
    cut(migration("20260927g_cockpit_media_actions.sql"), /CREATE TABLE public\.cockpit_media_actions \([\s\S]*?\n\);/, "media actions"),
  );
  await db.exec(
    cut(migration("20261003a_client_logos.sql"), /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/, "client logos"),
  );
  // Stand-ins with the live column names (blueprints-supabase.test.ts).
  await db.exec(`
    CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, clickup_id text, country text, city text,
      language text, service_mode text);
    CREATE TABLE public.editor_clients(task_id text PRIMARY KEY, name text, dos_donts text, brand_dna_url text, brand_dna text,
      offer_url text, offer text, drive_url text, website text, instagram text, docs_read_at timestamptz, synced_at timestamptz);
    CREATE TABLE public.cockpit_client_onboarding(clickup_task_id text PRIMARY KEY, client_name text NOT NULL, client_status text,
      csm text, signup_on date, onboarding_call_on date, launch_on date, links jsonb NOT NULL DEFAULT '{}',
      handover jsonb NOT NULL DEFAULT '{}', sales_transcript text, forms jsonb NOT NULL DEFAULT '{}', synced_at timestamptz);
    CREATE TABLE public.cockpit_csm_calls(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id text, kind text NOT NULL,
      starts_at timestamptz, ends_at timestamptz, status text NOT NULL);
    CREATE TABLE public.cockpit_people(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, email text,
      role text, active boolean NOT NULL DEFAULT true);`);
  await db.exec(
    cut(migration("20260921e_tap_charges.sql"), /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/, "sync state"),
  );
  await db.exec(migration(BP));
  await db.exec(migration(DRAIN));
}

/** What the send writes and reads beside the read model (the columns 20261102j names). */
const STAND_INS = `
  CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text, form_version integer,
    source text, external_id text, task_id text, client_name text, mode text, state text, answers jsonb, answer_meta jsonb,
    hidden jsonb, created_by text, created_by_id uuid, submitted_by text, submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_billing_accounts (clickup_task_id text PRIMARY KEY, client_name text, mrr_usd numeric,
    client_status text);
  CREATE TABLE public.cockpit_form_effects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_id uuid, effect_key text,
    state text, reason text, created_at timestamptz NOT NULL DEFAULT now());`;
/** The planner, standing in: card_facts only, from the stored answers as the Typeform answers list gives them. */
const PLAN_STAND_IN = `
  CREATE FUNCTION public.cockpit_form_stage4_plan(p_response_id uuid, p_apply boolean) RETURNS jsonb LANGUAGE sql STABLE
  SET search_path = '' AS $$
    SELECT jsonb_build_object('effects', jsonb_build_array(public.cockpit_form_stage4_card_facts('kickoff', r.task_id,
             (SELECT coalesce(jsonb_object_agg(a->>'ref', a->>'value'), '{}'::jsonb)
                FROM jsonb_array_elements(public.cockpit_form_stage4_typeform_answers('kickoff', r.answers)) a),
             r.submitted_at) || '{"state":"planned"}'::jsonb))
      FROM public.cockpit_form_responses r WHERE r.id = p_response_id
  $$;
  -- The stored onboarding call (20261102p): none here.
  CREATE FUNCTION public.cockpit_form_stage4_onboarding_call(p_task_id text, p_at timestamptz) RETURNS jsonb
  LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT NULL::jsonb $$;`;

async function formsGround() {
  await db.exec(
    cut(migration("20260921a_cockpit_settings.sql"), /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/, "settings"),
  );
  await db.exec(STAND_INS);
  await setting("forms.stage4", { kickoff: false, onboarding: false });
  await db.exec(fnDef(migration("20261016111157_board_facts.sql"), "cockpit_board_usd_rate"));
  const f27 = migration("20261027f_forms_core.sql");
  for (const name of ["cockpit_form_kuwait_day", "cockpit_form_seat", "cockpit_form_actor"]) await db.exec(fnDef(f27, name));
  await db.exec(fnDef(migration("20261102a_forms_invites.sql"), "cockpit_form_day_words"));
  await db.exec(fnDef(migration("20261025n_slack_notices.sql"), "cockpit_slack_notice_role_of"));
  const b = migration(B);
  await db.exec(fnDef(b, "cockpit_form_stage4_fields"));
  await db.exec(renamed(b, "cockpit_form_stage4_fields", "_b"));
  const j = migration(J);
  for (const name of [
    "cockpit_form_stage4_setting",
    "cockpit_form_stage4_on",
    "cockpit_form_stage4_ts",
    "cockpit_form_stage4_kickoff_at",
    "cockpit_form_stage4_text",
    "cockpit_form_stage4_native_answers",
    "cockpit_form_stage4_read_model",
    "cockpit_kickoff_seat",
    "cockpit_kickoff_submit",
  ])
    await db.exec(fnDef(j, name));
  await db.exec(renamed(j, "cockpit_form_stage4_native_answers", "_b", ["cockpit_form_stage4_fields"]));
  await db.exec(renamed(j, "cockpit_kickoff_submit", "_j"));
  const o = migration(O);
  for (const name of [
    "cockpit_form_typeform_text",
    "cockpit_form_stage4_make_text",
    "cockpit_form_stage4_handoff_text",
    "cockpit_form_stage4_typeform_answers",
    "cockpit_kickoff_answers_check",
  ])
    await db.exec(fnDef(o, name));
  await db.exec(renamed(o, "cockpit_form_stage4_typeform_answers", "_b", ["cockpit_form_stage4_fields"]));
  await db.exec(renamed(o, "cockpit_kickoff_answers_check", "_o", ["cockpit_form_stage4_fields"]));
  const p = migration(P);
  await db.exec(fnDef(p, "cockpit_form_stage4_link_kind"));
  await db.exec(fnDef(p, "cockpit_form_stage4_card_facts"));
  await db.exec(renamed(p, "cockpit_form_stage4_card_facts", "_p"));
  await db.exec(PLAN_STAND_IN);
  // The launch desk's reader of the kickoff budget (build B6, live).
  const e = migration(E);
  await db.exec(fnDef(e, "cockpit_launch_usd"));
  await db.exec(fnDef(e, "cockpit_launch_kickoff_budget"));
  // The Blueprint's sources as they were, beside the file's.
  await db.exec(renamed(migration(DRAIN), "cockpit_blueprint_sources", "_o"));
}

/** Invented cards: on the billing sheet, in both rosters, each with an onboarding record. */
async function seedCards() {
  const snap = "2026-11-02T08:00:00Z";
  const cards: [string, string][] = [
    [TEST_CARD, "Test card"],
    [CARD.sar, "Sidr Interiors Invented"],
    [CARD.bhd, "Bahar Build Invented"],
    [CARD.usd, "Usfur Homes Invented"],
    [CARD.none, "Nakhla Studio Invented"],
    [CARD.j, "Jasmine Works Invented"],
    [CARD.legacy, "Lulu Design Invented"],
    [CARD.legacyRange, "Ward Villas Invented"],
    [CARD.legacyNative, "Rimth Fitout Invented"],
    [CARD.blank, "Ghaf Living Invented"],
    [CARD.cent, "Sidra Rooms Invented"],
  ];
  for (const [task, name] of cards) {
    await db.query(
      "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, mrr_usd, client_status) VALUES ($1, $2, 1200, 'Onboarding')",
      [task, name],
    );
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, handover) VALUES ($1, $2, 'Brand Blueprint Booked', $3::jsonb)",
      [task, name, json({ daily_budget: 30 })],
    );
    await db.query(
      "INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [`cl-${task}`, [name], json({ _id: `cl-${task}`, taskId: task, name }), snap],
    );
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [`c-${task}`, [name], json({ _id: `c-${task}`, taskId: task, name, stage: "Brand Blueprint Booked", bucket: "onboarding" }), snap],
    );
  }
  await db.query(
    "UPDATE public.cockpit_creative_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [cards.length, snap],
  );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [cards.length, snap],
  );
  // Old Typeform kickoffs (tG7dnxBn) in the read model, as onboarding-sync writes them.
  const typeform = (value: string) => ({
    form_id: "tG7dnxBn",
    response_id: `tok${crypto.randomUUID().slice(0, 8)}`,
    submitted_at: "2026-10-20T10:00:00Z",
    answers: [
      { ref: REF.budget, title: "What is your daily budget for the ads?", value },
      { ref: REF.payment, title: "Payment Amount", value: "900" },
    ],
    payment: "900",
  });
  await db.query("UPDATE public.cockpit_client_onboarding SET forms = $2::jsonb WHERE clickup_task_id = $1", [
    CARD.legacy,
    json({ kickoff: typeform("$60") }),
  ]);
  await db.query("UPDATE public.cockpit_client_onboarding SET forms = $2::jsonb WHERE clickup_task_id = $1", [
    CARD.legacyRange,
    json({ kickoff: typeform("40 to 50 a day") }),
  ]);
  // A native kickoff sent before this file: its answer text, no side key.
  await db.query("UPDATE public.cockpit_client_onboarding SET forms = $2::jsonb WHERE clickup_task_id = $1", [
    CARD.legacyNative,
    json({
      kickoff: {
        form_id: "native",
        response_id: crypto.randomUUID(),
        submitted_at: "2026-11-02T10:00:00Z",
        answers: [{ ref: REF.budget, title: "What is your daily budget for the ads?", value: "45" }],
      },
    }),
  ]);
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await blueprintGround();
  await formsGround();
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "csm-kick@tests.invalid", ["csm"]);
  // A CSM on another client only: the Blueprint's gate refuses these cards.
  await db.query("UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2", [["Another Client Invented"], CSM]);
  await seedCards();
  for (const fn of Object.keys(LIVE)) groundMd5[fn] = await md5Of(fn);
  auditBefore = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log");
  await db.exec(migration(F));
  await db.exec(migration(F));
  auditAfter = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log");
}, 600_000);
afterAll(async () => {
  await db?.close();
});

/** The guard line of one replaced function in the file. */
const guardLine = (fn: string) =>
  migration(F)
    .split("\n")
    .find(x => x.includes(`('public.${fn}', '`)) ?? "";

// --- The file --------------------------------------------------------------------------------------

describe("20261103f: the file", () => {
  test("the ground holds the bodies the drift guard names: live's, with 20261103b's question list", () => {
    expect(groundMd5).toEqual({ ...LIVE });
    for (const [fn, md5] of Object.entries(LIVE)) expect(guardLine(fn)).toContain(`('public.${fn}', '${md5}', '`);
  });

  test("the after values are this file's bodies; applied twice it wrote no row", async () => {
    for (const fn of Object.keys(LIVE)) {
      const now = await md5Of(fn);
      expect(now).not.toBe(LIVE[fn as keyof typeof LIVE]);
      expect(guardLine(fn)).toContain(`', '${now}')`);
    }
    for (const fn of NEW_FNS) expect(await md5Of(fn)).toMatch(/^[0-9a-f]{32}$/);
    expect(auditAfter).toBe(auditBefore);
  });

  test("a second apply changes nothing, even once a kickoff is sent off the test card", async () => {
    const snapshot = () => Promise.all([...Object.keys(LIVE), ...NEW_FNS].map(fn => md5Of(fn)));
    await rolledBack(async () => {
      const before = await snapshot();
      await db.query(
        "INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, answers) VALUES ('kickoff', 2, 'cockpit', $1, '{}')",
        [CARD.usd],
      );
      await setting("forms.stage4", { kickoff: true, onboarding: false });
      await db.exec(inTest(F));
      expect(await snapshot()).toEqual(before);
    });
  });

  test("a changed body stops the file, naming the function", async () => {
    for (const fn of Object.keys(LIVE)) {
      await rolledBack(async () => {
        const name = fn.slice(0, fn.indexOf("("));
        const def = await one<string>("SELECT pg_get_functiondef(to_regprocedure($1)) AS r", [`public.${fn}`]);
        await db.exec(def.replace(/\$function\$\s*$/, "\n-- changed\n$function$"));
        const err = await refusal(() => db.exec(inTest(F)));
        expect(err.code).toBe("55000");
        expect(err.message).toBe(`${fn} changed since it was read for 20261103f; stop and re-read it.`);
        expect(name.length).toBeGreaterThan(0);
      });
    }
  });

  test("version 2 changes in place only before the kickoff is live: a send off the test card or the switch stops it; the CEO's canary does not", async () => {
    const restoreB0 = () => db.exec(fnDef(migration(B), "cockpit_form_stage4_fields"));
    // A native kickoff on a client card.
    await rolledBack(async () => {
      await restoreB0();
      expect(await md5Of("cockpit_form_stage4_fields(text)")).toBe(LIVE["cockpit_form_stage4_fields(text)"]);
      await db.query(
        "INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, answers, answer_meta) VALUES ('kickoff', 2, 'cockpit', $1, '{}', '{}')",
        [CARD.usd],
      );
      const err = await refusal(() => db.exec(inTest(F)));
      expect(err.code).toBe("55000");
      expect(err.message).toBe(
        "The kickoff is live in the cockpit (1 sent there outside the test card), so its questions cannot change in place: stop, and ask the amount and the close rate in a kickoff version 3.",
      );
    });
    // The switch on.
    await rolledBack(async () => {
      await restoreB0();
      await setting("forms.stage4", { kickoff: true, onboarding: false });
      const err = await refusal(() => db.exec(inTest(F)));
      expect(err.message).toContain("(0 sent there outside the test card, and its switch is on)");
    });
    // The CEO's canary on the test card, and the 8 Typeform kickoffs (both doors), do not stop it.
    await rolledBack(async () => {
      await restoreB0();
      await db.query(
        `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, answers, answer_meta) VALUES
           ('kickoff', 2, 'cockpit', $1, '{}', '{"canary": true}'),
           ('kickoff', 1, 'typeform_sync', $2, '{}', '{}'), ('kickoff', 1, 'typeform_webhook', $2, '{}', '{}')`,
        [TEST_CARD, CARD.legacy],
      );
      await db.exec(inTest(F));
      expect(await md5Of("cockpit_form_stage4_fields(text)")).not.toBe(LIVE["cockpit_form_stage4_fields(text)"]);
    });
    // A send on the test card that is not the canary's counts.
    await rolledBack(async () => {
      await restoreB0();
      await db.query(
        "INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, answers, answer_meta) VALUES ('kickoff', 2, 'cockpit', $1, '{}', '{}')",
        [TEST_CARD],
      );
      expect((await refusal(() => db.exec(inTest(F)))).message).toContain("(1 sent there outside the test card)");
    });
  });

  test("the prerequisites are named", async () => {
    await rolledBack(async () => {
      await db.exec("DROP FUNCTION public.cockpit_board_usd_rate(text) CASCADE");
      const err = await refusal(() => db.exec(inTest(F)));
      expect(err.message).toBe("Apply 20261016111157 and 20261102j before 20261103f.");
    });
  });

  test("everything made or replaced is the owner's only, but the send and the Blueprint's sources, which keep authenticated", async () => {
    const owner = [
      "cockpit_form_stage4_fields(text)",
      "cockpit_kickoff_answers_check(jsonb)",
      "cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)",
      ...NEW_FNS,
    ];
    for (const fn of owner)
      for (const role of ["anon", "authenticated", "service_role"])
        expect([fn, role, await one<boolean>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS r", [role, `public.${fn}`])]).toEqual([
          fn,
          role,
          false,
        ]);
    for (const fn of ["cockpit_kickoff_submit(text,jsonb,uuid)", "cockpit_blueprint_sources(text)"])
      expect(
        await Promise.all(
          ["anon", "authenticated", "service_role"].map(role =>
            one<boolean>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS r", [role, `public.${fn}`]),
          ),
        ),
      ).toEqual([false, true, false]);
  });
});

// --- The question list -----------------------------------------------------------------------------

describe("the kickoff's questions", () => {
  test("dailyBudget is an amount in six currencies, coldCloseRate a percent; every other question, and the onboarding's list, are 20261103b's", async () => {
    const now = await one<Row[]>("SELECT public.cockpit_form_stage4_fields('kickoff') AS r");
    const was = await one<Row[]>("SELECT public.cockpit_form_stage4_fields_b('kickoff') AS r");
    expect(now.length).toBe(46);
    const budget = now.find(f => f.key === "dailyBudget");
    expect(budget).toEqual({
      key: "dailyBudget",
      typeformRef: REF.budget,
      title: "What is your daily budget for the ads?",
      type: "amount",
      currencies: SIX,
      max: 100000,
      decimals: 2,
    });
    expect(now.find(f => f.key === "coldCloseRate")).toEqual({
      key: "coldCloseRate",
      typeformRef: REF.closeRate,
      title: "What is your current close rate on cold leads?",
      type: "percent",
      min: 0,
      max: 100,
    });
    const other = (list: Row[]) => list.filter(f => !["dailyBudget", "coldCloseRate"].includes(f.key));
    expect(json(other(now))).toBe(json(other(was)));
    expect(now.map(f => f.key)).toEqual(was.map(f => f.key));
    expect(json(await one("SELECT public.cockpit_form_stage4_fields('onboarding') AS r"))).toBe(
      json(await one("SELECT public.cockpit_form_stage4_fields_b('onboarding') AS r")),
    );
  });

  test("the kickoff sheet's test still finds the longest texts the check takes", () => {
    const body = fnDef(migration(F), "cockpit_kickoff_answers_check");
    expect(body).toMatch(/char_length\(v_text\)\s*>\s*\(CASE s->>'type' WHEN 'longtext' THEN 4000 ELSE 500 END\)/);
  });
});

// --- The answers check -----------------------------------------------------------------------------

describe("the answers check", () => {
  test("an amount and its currency are written as Make prints a typed answer, with the parts beside it", async () => {
    for (const [given, text, parts] of [
      [{ amount: 40, currency: "USD" }, "40 USD", { amount: 40, currency: "USD" }],
      [{ amount: 37.5, currency: "SAR" }, "37.5 SAR", { amount: 37.5, currency: "SAR" }],
      [{ amount: 150, currency: "SAR" }, "150 SAR", { amount: 150, currency: "SAR" }],
      [{ amount: 12.25, currency: "KWD" }, "12.25 KWD", { amount: 12.25, currency: "KWD" }],
      [{ amount: 20, currency: "BHD" }, "20 BHD", { amount: 20, currency: "BHD" }],
      [{ amount: 100000, currency: "AED" }, "100000 AED", { amount: 100000, currency: "AED" }],
      [{ amount: 0.01, currency: "QAR" }, "0.01 QAR", { amount: 0.01, currency: "QAR" }],
    ] as const) {
      const r = await check({ dailyBudget: given, newMrrUsd: 0 });
      expect([given, r.ok, r.errors]).toEqual([given, true, {}]);
      expect(r.answers.dailyBudget).toBe(text);
      expect(r.answers.dailyBudgetParts).toEqual(parts);
    }
  });

  test("0, 100001, three decimals, EUR and a plain string are refused with their codes", async () => {
    for (const [given, code] of [
      [{ amount: 0, currency: "USD" }, "range"],
      [{ amount: -5, currency: "USD" }, "range"],
      [{ amount: 100001, currency: "USD" }, "range"],
      [{ amount: 40.123, currency: "USD" }, "range"],
      [{ amount: 40, currency: "EUR" }, "option"],
      [{ amount: 40, currency: "usd" }, "option"],
      [{ amount: 40, currency: "OMR" }, "option"],
      [{ amount: 40 }, "option"],
      [{ amount: 40, currency: 1 }, "option"],
      ["40", "format"],
      ["$40 a day", "format"],
      [40, "format"],
      [["40", "USD"], "format"],
      [{ amount: "40", currency: "USD" }, "format"],
      [{ amount: 40, currency: "USD", usd: 40 }, "format"],
    ] as const) {
      const r = await check({ dailyBudget: given, newMrrUsd: 0 });
      expect([given, r.ok, r.errors]).toEqual([given, false, { dailyBudget: code }]);
      expect(r.answers.dailyBudget).toBeUndefined();
      expect(r.answers.dailyBudgetParts).toBeUndefined();
    }
  });

  test("an amount left blank is no answer, whatever the currency says, as a blank Typeform answer was", async () => {
    for (const given of [{ currency: "USD" }, { amount: null, currency: "SAR" }, { amount: "", currency: "USD" }, null, ""]) {
      const r = await check({ dailyBudget: given, newMrrUsd: 0 });
      expect([given, r.ok, r.answers]).toEqual([given, true, { newMrrUsd: 0 }]);
    }
  });

  test("the parts are the server's own: an answer that sends them is refused as unknown", async () => {
    const r = await check({ dailyBudget: { amount: 40, currency: "USD" }, dailyBudgetParts: { amount: 1, currency: "USD" }, newMrrUsd: 0 });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual({ dailyBudgetParts: "unknown" });
  });

  test("the close rate: 20 is 20%, 0 and 100 pass; 101, 12.5, a negative and a text are refused", async () => {
    for (const [given, text] of [
      [20, "20%"],
      [0, "0%"],
      [100, "100%"],
      [35.0, "35%"],
    ] as const) {
      const r = await check({ coldCloseRate: given, newMrrUsd: 0 });
      expect([given, r.ok, r.answers.coldCloseRate]).toEqual([given, true, text]);
    }
    for (const given of [101, 12.5, -1, "20%", "20", true])
      expect([given, (await check({ coldCloseRate: given, newMrrUsd: 0 })).errors]).toEqual([given, { coldCloseRate: "range" }]);
    expect((await check({ coldCloseRate: "", newMrrUsd: 0 })).answers).toEqual({ newMrrUsd: 0 });
  });

  test("every other answer is checked as 20261102o checked it", async () => {
    const answers = {
      ...REST,
      detailsCorrect: "Yes",
      detailsFix: "  Line one\r\nline two  ",
      whatsappAdd: "Two more people",
      maharaOsAccess: "Tech Issue",
      leadsLinks: "x".repeat(4001),
      adAccountName: "  Invented   Ads  ",
      contractStatus: "Maybe",
      serviceAdvertised: ["Interior design", "Interior design"],
    };
    expect(json(await check(answers))).toBe(json(await check(answers, "_o")));
    expect(json(await check(REST))).toBe(json(await check(REST, "_o")));
    // With the two questions, the rest of the result is o's; o took a typed budget and close rate as text.
    const both = { ...REST, dailyBudget: { amount: 150, currency: "SAR" }, coldCloseRate: 20 };
    const now = await check(both);
    const was = await check({ ...REST, dailyBudget: "150 SAR", coldCloseRate: "20%" }, "_o");
    expect(now.ok).toBe(true);
    expect({ ...now.answers, dailyBudgetParts: undefined }).toEqual({ ...was.answers, dailyBudgetParts: undefined });
    expect((await check({ ...REST, dailyBudget: "150 SAR" }, "_o")).ok).toBe(true);
  });
});

// --- The send and the read model -------------------------------------------------------------------

describe("the send: the read model's budget and close rate", () => {
  test("150 SAR and 20: the response keeps the texts and the parts; the read model gains budget {amount, currency, usd, rate, said} and close_rate", async () => {
    await setting("forms.stage4", { kickoff: true, onboarding: false });
    const r = await submit(CARD.sar, { ...REST, dailyBudget: { amount: 150, currency: "SAR" }, coldCloseRate: 20 });
    expect(r.ok).toBe(true);
    const row = await stored(r.responseId);
    expect(row.answers.dailyBudget).toBe("150 SAR");
    expect(row.answers.dailyBudgetParts).toEqual({ amount: 150, currency: "SAR" });
    expect(row.answers.coldCloseRate).toBe("20%");
    const k = await readModel(CARD.sar);
    expect(k.form_id).toBe("native");
    expect(k.budget).toEqual({ amount: 150, currency: "SAR", usd: 39.99, rate: 0.2666, said: "150 SAR" });
    expect(k.close_rate).toBe(20);
    // The Typeform-shaped answers keep the texts Make prints, and no internal key.
    const byRef = Object.fromEntries((k.answers as Row[]).map(a => [a.ref, a.value]));
    expect(byRef[REF.budget]).toBe("150 SAR");
    expect(byRef[REF.closeRate]).toBe("20%");
    expect(json(k.answers)).not.toContain("dailyBudgetParts");
    expect((k.answers as Row[]).length).toBe(
      (await one<Row[]>("SELECT public.cockpit_form_stage4_typeform_answers('kickoff', $1::jsonb) AS r", [json(row.answers)])).length,
    );
  });

  test("BHD: the amount is kept and usd is null (no fixed rate), never 0", async () => {
    const r = await submit(CARD.bhd, { ...REST, dailyBudget: { amount: 20, currency: "BHD" } });
    expect(r.ok).toBe(true);
    const k = await readModel(CARD.bhd);
    expect(k.budget).toEqual({ amount: 20, currency: "BHD", usd: null, rate: null, said: "20 BHD" });
    expect(Object.hasOwn(k.budget, "usd")).toBe(true);
    expect(Object.hasOwn(k, "close_rate")).toBe(false);
  });

  test("0.01 QAR: the check passes, the amount is kept, and usd is null (below a cent in dollars), never 0", async () => {
    const r = await submit(CARD.cent, { ...REST, dailyBudget: { amount: 0.01, currency: "QAR" } });
    expect(r.ok).toBe(true);
    expect((await stored(r.responseId)).answers.dailyBudget).toBe("0.01 QAR");
    const k = await readModel(CARD.cent);
    expect(k.budget).toEqual({ amount: 0.01, currency: "QAR", usd: null, rate: 0.2747, said: "0.01 QAR" });
    expect(Object.hasOwn(k.budget, "usd")).toBe(true);
    expect(await kickoffBudget(CARD.cent)).toEqual({ amount: 0.01, currency: "QAR", usd: null, rate: 0.2747, said: "0.01 QAR", from_text: false });
    expect((await one<Row>("SELECT public.cockpit_launch_kickoff_budget($1) AS r", [CARD.cent]))?.usd ?? null).toBeNull();
  });

  test("neither answered: no side key; a refused amount stores nothing", async () => {
    const r = await submit(CARD.none, REST);
    expect(r.ok).toBe(true);
    const k = await readModel(CARD.none);
    expect(Object.hasOwn(k, "budget")).toBe(false);
    expect(Object.hasOwn(k, "close_rate")).toBe(false);
    const refused = await submit(CARD.blank, { ...REST, dailyBudget: { amount: 40, currency: "EUR" }, coldCloseRate: 12.5 });
    expect(refused).toEqual({ ok: false, reason: "invalid", errors: { dailyBudget: "option", coldCloseRate: "range" } });
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_form_responses WHERE task_id = $1", [CARD.blank])).toBe(0);
  });

  test("the CEO's canary on the test card sends the new shape while the switch is off", async () => {
    await setting("forms.stage4", { kickoff: false, onboarding: false });
    const r = await submit(TEST_CARD, { ...REST, dailyBudget: { amount: 40, currency: "USD" }, coldCloseRate: 15 });
    expect(r.ok).toBe(true);
    expect((await stored(r.responseId)).answer_meta.canary).toBe(true);
    expect((await readModel(TEST_CARD)).budget).toEqual({ amount: 40, currency: "USD", usd: 40, rate: 1, said: "40 USD" });
    await setting("forms.stage4", { kickoff: true, onboarding: false });
  });

  test("everything else in the read model is 20261102j's", async () => {
    const answers = { ...REST, dailyBudget: { amount: 75, currency: "AED" }, coldCloseRate: 30 };
    const r = await submit(CARD.j, answers, "_j");
    expect(r.ok).toBe(true);
    const was = await readModel(CARD.j);
    expect(Object.hasOwn(was, "budget")).toBe(false);
    await rolledBack(async () => {
      await db.query("UPDATE public.cockpit_client_onboarding SET forms = '{}'::jsonb WHERE clickup_task_id = $1", [CARD.j]);
      await db.query("DELETE FROM public.cockpit_form_responses WHERE task_id = $1", [CARD.j]);
      const n = await submit(CARD.j, answers);
      const now = await readModel(CARD.j);
      const strip = (x: Row) => ({ ...x, response_id: null, submitted_at: null });
      expect(strip({ ...now, budget: undefined, close_rate: undefined })).toEqual(strip(was));
      expect(now.budget).toEqual({ amount: 75, currency: "AED", usd: 20.42, rate: 0.2723, said: "75 AED" });
      expect(now.close_rate).toBe(30);
      expect(n.ok).toBe(true);
    });
  });

  test("the planner plans Daily Budget from the stored answer: the dollars, onlyIfEmpty, source kickoff", async () => {
    const id = await one<string>("SELECT id::text AS r FROM public.cockpit_form_responses WHERE task_id = $1", [CARD.sar]);
    const plan = await one<Row>("SELECT public.cockpit_form_stage4_plan($1::uuid, false) AS r", [id]);
    const cf = plan.effects[0];
    expect(cf.key).toBe("card_facts");
    expect(cf.plan.fields.find((f: Row) => f.fieldId === DAILY_BUDGET)).toEqual({
      fieldId: DAILY_BUDGET,
      kind: "currency",
      label: "Daily Budget",
      value: 39.99,
      onlyIfEmpty: true,
      source: "kickoff",
    });
    expect(cf.plan.lines).toContain("Daily Budget, if empty on the card: 39.99 USD a day, from 150 SAR at the cockpit's rate");
  });
});

// --- Make's handoff and the Typeform kickoffs ------------------------------------------------------

const KICKOFF_TITLES = async () =>
  Object.fromEntries(
    (await one<Row[]>("SELECT public.cockpit_form_stage4_fields('kickoff') AS r")).map(f => [f.typeformRef, f.title]),
  );
const byRefOf = (list: Row[]) => Object.fromEntries(list.map(a => [a.ref, a.value]));
const handoff = (byRef: Row) =>
  one<string>("SELECT public.cockpit_form_stage4_handoff_text('{}'::jsonb, $1::jsonb) AS r", [json(byRef)]);
const line = (text: string, label: string) => text.split("\n").find(l => l.startsWith(label));

describe("Make's handoff (lines 71 and 102) and the Typeform kickoffs", () => {
  test("a native answer prints a text a CSM could have typed: *Daily ad budget:* 150 SAR, *Current cold-lead close rate:* 20%", async () => {
    const r = await check({ ...REST, dailyBudget: { amount: 150, currency: "SAR" }, coldCloseRate: 20 });
    const ta = await one<Row[]>("SELECT public.cockpit_form_stage4_typeform_answers('kickoff', $1::jsonb) AS r", [json(r.answers)]);
    const text = await handoff(byRefOf(ta));
    expect(line(text, "*Daily ad budget:*")).toBe("*Daily ad budget:* 150 SAR");
    expect(line(text, "*Current cold-lead close rate:*")).toBe("*Current cold-lead close rate:* 20%");
    // The same words typed into tG7dnxBn print byte for byte the same handoff.
    const typed = byRefOf(ta);
    expect(await handoff({ ...typed, [REF.budget]: "150 SAR", [REF.closeRate]: "20%" })).toBe(text);
    // Neither answered: Not provided, as Make writes it.
    const none = await handoff({});
    expect(line(none, "*Daily ad budget:*")).toBe("*Daily ad budget:* Not provided");
    expect(line(none, "*Current cold-lead close rate:*")).toBe("*Current cold-lead close rate:* Not provided");
    expect(text.split("\n").length).toBe(none.split("\n").length);
  });

  test("8 Typeform kickoffs: the parity plan's answers pass through as they came, so every text is 20261103b's", async () => {
    const titles = await KICKOFF_TITLES();
    // Shaped like the stored tG7dnxBn kickoffs (6 of 7 answered the budget, 4 of 30 the close rate); invented.
    const budgets = ["40", "$50", "60 USD", "$40 a day", "30$", "Not sure yet", "٤٠ دولار", null];
    const rates = ["20%", null, "15 %", null, "not sure", null, "25%", null];
    for (let i = 0; i < budgets.length; i++) {
      const fields = [
        { ref: REF.consult, title: titles[REF.consult], value: "Online" },
        { ref: REF.platforms, title: titles[REF.platforms], value: "Meta" },
        { ref: REF.payment, title: titles[REF.payment], value: "1500" },
        ...(budgets[i] === null ? [] : [{ ref: REF.budget, title: titles[REF.budget], value: budgets[i] }]),
        ...(rates[i] === null ? [] : [{ ref: REF.closeRate, title: titles[REF.closeRate], value: rates[i] }]),
      ];
      const nowNative = await one<Row>("SELECT public.cockpit_form_stage4_native_answers('kickoff', $1::jsonb) AS r", [json(fields)]);
      const wasNative = await one<Row>("SELECT public.cockpit_form_stage4_native_answers_b('kickoff', $1::jsonb) AS r", [json(fields)]);
      expect([i, nowNative]).toEqual([i, wasNative]);
      const now = await one<Row[]>("SELECT public.cockpit_form_stage4_typeform_answers('kickoff', $1::jsonb - '_unmapped') AS r", [
        json(nowNative),
      ]);
      const was = await one<Row[]>("SELECT public.cockpit_form_stage4_typeform_answers_b('kickoff', $1::jsonb - '_unmapped') AS r", [
        json(wasNative),
      ]);
      expect([i, json(now)]).toEqual([i, json(was)]);
      expect(await handoff(byRefOf(now))).toBe(await handoff(byRefOf(was)));
      if (budgets[i] !== null) expect(byRefOf(now)[REF.budget]).toBe(budgets[i]);
    }
  });
});

// --- The kickoff budget ----------------------------------------------------------------------------

describe("cockpit_kickoff_budget: the shape the launch desk reads", () => {
  test("a native kickoff: its side key, converted now; BHD keeps its amount with usd null", async () => {
    expect(await kickoffBudget(CARD.sar)).toEqual({
      amount: 150,
      currency: "SAR",
      usd: 39.99,
      rate: 0.2666,
      said: "150 SAR",
      from_text: false,
    });
    expect(await kickoffBudget(CARD.bhd)).toEqual({ amount: 20, currency: "BHD", usd: null, rate: null, said: "20 BHD", from_text: false });
    // A rate added later (the CEO's word on BHD) reaches a kickoff already sent.
    await rolledBack(async () => {
      await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_board_usd_rate(p_currency text) RETURNS numeric
        LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
          SELECT CASE upper(btrim(coalesce(p_currency, '')))
            WHEN 'USD' THEN 1 WHEN 'KWD' THEN 3.26 WHEN 'AED' THEN 0.2723 WHEN 'SAR' THEN 0.2666 WHEN 'QAR' THEN 0.2747
            WHEN 'BHD' THEN 2.6596 END::numeric; $$;`);
      expect((await kickoffBudget(CARD.bhd))?.usd).toBe(53.19);
    });
  });

  test("an old Typeform kickoff: a typed figure read as dollars (from_text), a range or another currency none", async () => {
    expect(await kickoffBudget(CARD.legacy)).toEqual({ amount: 60, currency: "USD", usd: 60, rate: 1, said: "$60", from_text: true });
    expect(await kickoffBudget(CARD.legacyRange)).toBeNull();
    // A native kickoff sent before this file: no side key, its text read the same way.
    expect(await kickoffBudget(CARD.legacyNative)).toEqual({ amount: 45, currency: "USD", usd: 45, rate: 1, said: "45", from_text: true });
    expect(await kickoffBudget(CARD.none)).toBeNull();
    expect(await kickoffBudget(CARD.blank)).toBeNull();
    expect(await kickoffBudget("taskNobody1")).toBeNull();
    expect(await kickoffBudget(null as unknown as string)).toBeNull();
  });

  test("the reader of typed text: the kickoff's own '<amount> <CUR>', else blueprintPrefill.parseBudget's rule", async () => {
    expect(await budgetRead("150 SAR")).toEqual({ amount: 150, currency: "SAR", usd: 39.99, rate: 0.2666, said: "150 SAR", from_text: false });
    expect(await budgetRead("37.5 SAR")).toMatchObject({ amount: 37.5, usd: 10, from_text: false });
    expect(await budgetRead("40 USD")).toMatchObject({ amount: 40, currency: "USD", usd: 40, from_text: false });
    for (const text of ["0 USD", "150 EUR", "150000 SAR", "", "   ", null, "TBD", "40 to 50", "KWD 15", "15 دينار", "100001", "0.5"])
      expect([text, await budgetRead(text)]).toEqual([text, null]);
    expect(await budgetRead("  $1,500 a month  ")).toEqual({ amount: 1500, currency: "USD", usd: 1500, rate: 1, said: "$1,500 a month", from_text: true });
    expect(await budgetRead("٤٠")).toMatchObject({ usd: 40, said: "٤٠", from_text: true });
    expect(await budgetRead("40.555")).toMatchObject({ amount: 40.56, usd: 40.56 });
  });

  test("the launch desk's reader (20261103e) takes it: Kickoff, 150 SAR; as typed: $60", async () => {
    const sar = await one<Row>("SELECT public.cockpit_launch_kickoff_budget($1) AS r", [CARD.sar]);
    expect(sar).toMatchObject({ amount: 150, currency: "SAR", usd: 39.99, fromText: false, said: null });
    expect(typeof sar.at).toBe("string");
    expect(await one<Row>("SELECT public.cockpit_launch_kickoff_budget($1) AS r", [CARD.legacy])).toMatchObject({
      amount: 60,
      currency: "USD",
      usd: 60,
      fromText: true,
      said: "$60",
    });
    expect(await one<Row>("SELECT public.cockpit_launch_kickoff_budget($1) AS r", [CARD.bhd])).toMatchObject({
      amount: 20,
      currency: "BHD",
      usd: null,
    });
    expect(await one<Row>("SELECT public.cockpit_launch_kickoff_budget($1) AS r", [CARD.legacyRange])).toBeNull();
  });
});

// --- card_facts ------------------------------------------------------------------------------------

const dailyOf = (r: Row) => (r.plan.fields as Row[]).find(f => f.fieldId === DAILY_BUDGET);
const withoutBudget = (r: Row) => ({
  ...r,
  plan: {
    ...r.plan,
    fields: (r.plan.fields as Row[]).filter(f => f.fieldId !== DAILY_BUDGET),
    lines: (r.plan.lines as string[]).filter(l => !l.startsWith("Daily Budget")),
  },
});

describe("card_facts: Daily Budget in dollars, only from 1 to 100,000, only while the card leaves it empty", () => {
  test("planned: the converted figure as a number the writer takes, onlyIfEmpty, with its source", async () => {
    for (const [answer, value, source, said] of [
      ["40 USD", 40, "kickoff", "Daily Budget, if empty on the card: 40 USD a day"],
      ["150 SAR", 39.99, "kickoff", "Daily Budget, if empty on the card: 39.99 USD a day, from 150 SAR at the cockpit's rate"],
      ["37.5 SAR", 10, "kickoff", "Daily Budget, if empty on the card: 10 USD a day, from 37.5 SAR at the cockpit's rate"],
      ["12.25 KWD", 39.94, "kickoff", "Daily Budget, if empty on the card: 39.94 USD a day, from 12.25 KWD at the cockpit's rate"],
      ["$60", 60, "kickoff_text", "Daily Budget, if empty on the card: 60 USD a day, read from the typed answer"],
    ] as const) {
      const r = await facts({ [REF.budget]: answer });
      expect([answer, dailyOf(r)]).toEqual([
        answer,
        { fieldId: DAILY_BUDGET, kind: "currency", label: "Daily Budget", value, onlyIfEmpty: true, source },
      ]);
      expect(r.plan.lines).toEqual([said]);
      expect(r.skip).toBeUndefined();
      // clickup-writeback's own check (build B1): a number, from 1 to 100,000, 2 decimals at most.
      expect(budgetAmount(dailyOf(r)?.value)).toBe(value);
    }
  });

  test("not planned, with the line that says why: no fixed rate, out of 1 to 100,000 dollars, no figure; nothing without an answer", async () => {
    for (const [answer, said] of [
      ["20 BHD", "Daily Budget: not filled, the cockpit has no fixed rate for BHD yet."],
      ["1 SAR", "Daily Budget: not filled, 0.27 USD a day is outside 1 to 100,000 dollars."],
      ["0.5 USD", "Daily Budget: not filled, 0.5 USD a day is outside 1 to 100,000 dollars."],
      ["100000 KWD", "Daily Budget: not filled, 326000 USD a day is outside 1 to 100,000 dollars."],
      ["0.01 QAR", "Daily Budget: not filled, 0.01 QAR a day is less than a cent in dollars, outside 1 to 100,000 dollars."],
      ["0.01 SAR", "Daily Budget: not filled, 0.01 SAR a day is less than a cent in dollars, outside 1 to 100,000 dollars."],
      ["Not sure yet", "Daily Budget: not filled, the answer is not an amount the cockpit can read."],
      ["40 to 50", "Daily Budget: not filled, the answer is not an amount the cockpit can read."],
    ] as const) {
      const r = await facts({ [REF.budget]: answer });
      expect([answer, dailyOf(r), r.plan.lines]).toEqual([answer, undefined, [said]]);
      expect(r.skip).toBe("No card field to fill from this kickoff.");
    }
    const none = await facts({});
    expect(none.plan.lines).toEqual([]);
    expect(none.skip).toBe("No card field to fill from this kickoff.");
  });

  test("every other field, line and skip is 20261102p's, for both forms", async () => {
    for (const byRef of [
      {},
      { [REF.consult]: "Online, In-office", [REF.platforms]: "Meta and TikTok", [REF.recording]: "https://fathom.video/share/x1" },
      { [REF.consult]: "Online", [REF.platforms]: "Snapchat", [REF.budget]: "150 SAR" },
      { [REF.budget]: "20 BHD", [REF.recording]: "https://example.invalid/rec" },
    ])
      for (const at of [null, "2026-11-03T08:00:00Z"])
        expect(json(withoutBudget(await facts(byRef, "", "kickoff", at)))).toBe(json(await facts(byRef, "_p", "kickoff", at)));
    for (const byRef of [{}, { "454a425f-2ac6-4d94-92db-cec08618600e": "https://cedar.example" }, { [REF.budget]: "40 USD" }])
      expect(json(await facts(byRef, "", "onboarding"))).toBe(json(await facts(byRef, "_p", "onboarding")));
  });
});

// --- The Blueprint's sources -----------------------------------------------------------------------

describe("the Blueprint's sources: kit.budgetUsd and kit.budgetCurrency", () => {
  const sources = async (task: string) => {
    const both = await as<Row>(
      CEO,
      "SELECT jsonb_build_object('now', public.cockpit_blueprint_sources($1), 'was', public.cockpit_blueprint_sources_o($1)) AS r",
      [task],
    );
    return both as { now: Row; was: Row };
  };

  test("the kickoff's dollars and currency beside the card's Daily Budget; every other key is 20261025o's", async () => {
    for (const [task, usd, currency] of [
      [CARD.sar, 39.99, "SAR"],
      [CARD.bhd, null, "BHD"],
      [CARD.legacy, 60, "USD"],
      [CARD.legacyRange, null, null],
      [CARD.none, null, null],
      [CARD.cent, null, "QAR"],
    ] as const) {
      const { now, was } = await sources(task);
      expect([task, now.kit.budgetUsd, now.kit.budgetCurrency]).toEqual([task, usd, currency]);
      expect(Object.hasOwn(now.kit, "budgetUsd") && Object.hasOwn(now.kit, "budgetCurrency")).toBe(true);
      expect(json({ ...now, kit: { ...now.kit, budgetUsd: undefined, budgetCurrency: undefined } })).toBe(json(was));
      expect(now.kit.handover).toEqual({ daily_budget: 30 });
    }
  });

  test("the gate is 20261025o's: a seat that may not open the card is refused by both", async () => {
    for (const fn of ["cockpit_blueprint_sources", "cockpit_blueprint_sources_o"]) {
      const err = await refusal(() => as(CSM, `SELECT public.${fn}($1) AS r`, [CARD.sar]));
      expect(err.code).toBe("42501");
    }
  });
});

// --- The second source -----------------------------------------------------------------------------

/** Dollars to the cent as currency.ts's cents() takes them (12 significant digits, then half up). */
const cents = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const AMOUNTS = [1, 1.5, 10, 25, 37.5, 40, 99.99, 150, 333.33, 1000, 12345.67, 99999.99, 100000];

describe("the second source: the SQL dollars equal currency.ts on the same amounts", () => {
  test("the fixed rates: cockpit_board_usd_rate equals both currency.ts copies; BHD has none in any", async () => {
    expect(edgeCurrency.USD_PER).toEqual(USD_PER);
    for (const c of SIX) {
      const sql = await one<string | null>("SELECT public.cockpit_board_usd_rate($1)::text AS r", [c]);
      expect([c, sql === null ? null : Number(sql)]).toEqual([c, USD_PER[c] ?? null]);
    }
  });

  test("usd is the amount at USD_PER to the cent, and usdToBudget gives the amount back within 2 hundredths", async () => {
    for (const c of SIX)
      for (const amount of AMOUNTS) {
        const b = await budgetOf(amount, c);
        const rate = USD_PER[c];
        expect([c, amount, b?.usd ?? null]).toEqual([c, amount, rate === undefined ? null : cents(amount * rate)]);
        if (b?.usd != null && ["USD", "SAR", "QAR", "AED"].includes(c))
          expect([c, amount, Math.abs(usdToBudget(b.usd, c) - Math.round(amount * 100)) <= 2]).toEqual([c, amount, true]);
      }
  });

  test("usd is never 0: dollars that round below a cent are null, as with no rate; the first cent is kept", async () => {
    for (const [amount, c, usd] of [
      [0.01, "QAR", null],
      [0.01, "SAR", null],
      [0.01, "AED", null],
      [0.01, "USD", 0.01],
      [0.01, "KWD", 0.03],
      [0.02, "QAR", 0.01],
      [0.01, "BHD", null],
    ] as const) {
      const b = await budgetOf(amount, c);
      expect([amount, c, b?.amount, b?.usd, Object.hasOwn(b ?? {}, "usd")]).toEqual([amount, c, amount, usd, true]);
      expect([amount, c, usd === null || cents(amount * USD_PER[c]) === usd]).toEqual([amount, c, true]);
    }
    expect(await budgetRead("0.01 QAR")).toEqual({ amount: 0.01, currency: "QAR", usd: null, rate: 0.2747, said: "0.01 QAR", from_text: false });
  });

  test("the typed-text rule equals blueprintPrefill.parseBudget on the same texts", async () => {
    const texts = [
      "$40 a day",
      "40 دولار",
      "٤٠",
      "40 to 50",
      "40-50 a day",
      "KWD 15",
      "15 دينار",
      "40",
      "$50",
      "60 USD",
      "30$",
      "1,500",
      "TBD",
      "around 45 dollars a day",
      "100001",
      "0.5",
      "50.25",
      "١٥٠ ريال",
      "SAR 150",
      "150 SR",
      "40 usd",
      "N/A",
      "Not provided",
      "$40 – $50",
      "۵۰",
    ];
    for (const text of texts)
      expect([text, (await budgetRead(text))?.usd ?? null]).toEqual([text, parseBudget(text)?.usd ?? null]);
    // Where they differ, on purpose: the kickoff's own '<amount> <CUR>' in another currency is converted.
    expect(parseBudget("150 SAR")?.usd).toBeNull();
    expect((await budgetRead("150 SAR"))?.usd).toBe(39.99);
  });
});
