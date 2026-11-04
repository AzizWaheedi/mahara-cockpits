/**
 * Client form schema version 2 and the structured onboarding, version 3 (20261104d_onboarding_schema_v2.sql;
 * docs/forms/WAVE56-CONTRACT.md 4.22; plan build B8; the CEO, 2026-11-02: "Do the whole redesign").
 *
 * The ground is stage4-match-make-supabase.test.ts's (the functions 20261102o reads or replaces, cut from their
 * canonical migrations, with stand-in tables), then the real 20261102o, 20261102p (with 20261025n's kickoff facts) and
 * 20261103b, the way live holds them (read 2026-11-03), plus what 20261104d replaces or reads beside them: 20261102a's
 * client version and client live, 20261102i's issue core, 20261102d's editor, 20261027f's forms audit trigger and
 * 20261101p's settings audit trigger, each cut from its canonical file; stand-ins for the card's workspace, the invite
 * events, the sale ties and the editor's seat. 20261102j's input and 20261102p's builder are also kept under _j and _p
 * names, so every version-2 plan is compared with what it was, byte for byte.
 *
 * Covered: the prerequisite and the drift guard on the live bodies; the after values; a second apply; the version-1
 * checks byte for byte under their own names; owner-only grants, the editor's read for signed-in seats and the
 * Typeform door's live grant; version 3 stored with one audit row and the registry untouched; the schema check of
 * version 2 (every new refusal) and of version 1 (unchanged); every row of the shared fixture's version-2 section
 * and every version-1 row through the same entry point; the printer equal to the design's reference printer on the
 * goldens (scripts/dev/fixtures/onboarding-v3-print.json), a printing mistake caught, version 2 byte for byte, the
 * map fitting version 3, no currency in a revenue line; Make 13's texts (make_parity.py's evaluator) on the printed
 * list equal to the cockpit's, and make_parity's read-model verdict naming structured; the input and the builder
 * (structured on a version-3 answer only, version 2 as before); the size of a version-3 answer at its limits; the
 * switch (off, canary, on, its refusals and audit rows, the registry following a native onboarding); the version an
 * invite gets and the server-set prefill; the Typeform door pinned to version 2; the editor's read-only rule on the
 * server and its read of the structured version. Every client, card, person and answer is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const A_FILE = "20261102a_forms_invites.sql";
const D_FILE = "20261102d_forms_editor.sql";
const F_FILE = "20261027f_forms_core.sql";
const I = "20261102i_client_tail.sql";
const J = "20261102j_stage4_native.sql";
const L = "20261102l_stage4_no_client_data_row.sql";
const M = "20261102o_stage4_match_make.sql";
const P = "20261102p_stage4_better_data.sql";
const B = "20261103b_onboarding_v2_hints.sql";
const H = "20261104d_onboarding_schema_v2.sql";
const N25 = "20261025n_slack_notices.sql";
const TITLES_FILE = "scripts/dev/forms-deploy/stage4-raw-titles.json";
const RAW_TITLES = JSON.parse(readFileSync(`${ROOT}${TITLES_FILE}`, "utf8"));
/** The printer goldens: the design's reference printer on synthetic answers (scripts/dev/fixtures). */
const GOLDENS = JSON.parse(
  readFileSync(`${ROOT}scripts/dev/fixtures/onboarding-v3-print.json`, "utf8"),
) as {
  version: number;
  cases: { name: string; answers: Row; printed: Answer[]; structured: Row }[];
};
/** The shared answers fixture (the portal copies it byte for byte). */
const FIXTURE = JSON.parse(
  readFileSync(
    new URL("./fixtures/client-form-answers.json", import.meta.url),
    "utf8",
  ),
) as {
  schemas: Record<string, Row>;
  rows: FixRow[];
  schemaV2Schemas: Record<string, Row>;
  schemaV2Rows: FixRow[];
};

/** md5(white space folded prosrc) of the bodies 20261104d replaces, as live holds them (read 2026-11-03). */
const BEFORE_H = {
  "cockpit_form_schema_check(jsonb)": "07f88396a8df9e1b2b42f41b5c3e189a",
  "cockpit_form_answers_check(jsonb,jsonb,jsonb)":
    "ac54af52c93ca8f2517a5f55b507cfa7",
  "cockpit_form_client_version(text)": "05e4c13d86b4bdf808c1bed93a9e9d23",
  "cockpit_form_stage4_input(uuid)": "a40d17418bda54193c278e63ae524fcd",
  "cockpit_form_stage4_build(jsonb)": "5f52c05d01472cc80a9706f0d726a190",
  "cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb)":
    "da7a50edf7252dc8ff3deb2779348e9a",
  "cockpit_form_onboarding_typeform(jsonb)": "ddefa9130061bc21b8b05c882d778d72",
  "cockpit_form_editor_kind(public.cockpit_forms)":
    "e3c824d512f8c313eae235bc31d71868",
  "cockpit_form_client_context(public.cockpit_form_invites)":
    "4c8c10adadf7908a8ae6a06472aa1d33",
} as const;
/** 20261104d's own bodies (the after values of its drift guard). */
const AFTER_H = {
  "cockpit_form_schema_check(jsonb)": "9bd159ba3782c744236ed92e6a75ee41",
  "cockpit_form_answers_check(jsonb,jsonb,jsonb)":
    "5c77fa86f3d2311b01c2031a83bb944e",
  "cockpit_form_client_version(text)": "4087f8f1b3fd759ecc8b0183a1db1fbd",
  "cockpit_form_stage4_input(uuid)": "dcc471e64ccd7c3a024054537290fc6f",
  "cockpit_form_stage4_build(jsonb)": "d2965481eba07d601ffd250715342bcd",
  "cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb)":
    "ba1e7b0240f5ab033b6f6ce9b4c2df2c",
  "cockpit_form_onboarding_typeform(jsonb)": "cb982b25868cf061dd336e9c49c06a12",
  "cockpit_form_editor_kind(public.cockpit_forms)":
    "b6500a6819836d0584bdaeb218d76ecf",
  "cockpit_form_client_context(public.cockpit_form_invites)":
    "92dcf3a241009f5dd08c9b2452da4a05",
} as const;
const NEW_FNS = [
  "cockpit_form_schema_check_v1(jsonb)",
  "cockpit_form_schema_check_v2(jsonb)",
  "cockpit_form_answers_check_v1(jsonb,jsonb,jsonb)",
  "cockpit_form_answers_check_v2(jsonb,jsonb,jsonb)",
  "cockpit_form_rows_blank_cell(jsonb)",
  "cockpit_form_schema_v2_state()",
  "cockpit_form_structured_version(text)",
  "cockpit_form_stage4_print_map(integer)",
  "cockpit_form_stage4_print_part(jsonb,jsonb)",
  "cockpit_form_stage4_print_problem(integer,jsonb)",
  "cockpit_form_stage4_print(text,integer,jsonb)",
  "cockpit_form_stage4_structured(integer,jsonb)",
  "cockpit_form_onboarding_context(text)",
  "cockpit_form_editor_structured(text)",
  "cockpit_form_schema_v2_switch(text,text)",
] as const;
/** md5 of the onboarding's stored definitions: version 2 after 20261104c and version 3 (this file's). */
const V2_B_MD5 = "230653a3d7bd14a79ee7edba40976cb4";
let oldV2Schema: unknown;
const V3_MD5 = "2e187490c06d61169588bc9724870aed";
const READ_ONLY = "Its structured questions change in a migration for now.";
const TEST_CARD = "86eywg1cq";
const TASK = "86exv3001";
const CONTACT = [
  "fullName",
  "phone",
  "email",
  "frontDeskPhone",
  "personalPhone",
];
/** KFRCXPFx refs this file reads by name. */
const R = {
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  lastRevenue: "7ff5d37a-df7f-4002-8248-d0b4af6c28e8",
  goal90: "791b99b8-c7e9-40a4-96d6-868399e1ae97",
  goal12: "f4b96a9b-bd7c-4398-98b4-6a28a7d3595a",
  appointments: "b370341c-6ea3-43c9-bd8c-16e278a2d2d5",
  facebookAds: "ddf2767d-5725-4df2-b200-f0aab77a2db5",
} as const;
const PROFILE_FIELD = "7755485f-74a8-496c-85d8-562588e77944";

type Row = Record<string, any>;
type Answer = { ref: string; title: string; value: string };
type FixRow = {
  name: string;
  schema: string;
  answers: Row;
  context: Row;
  ok: boolean;
  errors: Row;
  stored?: Row;
};
const json = (v: unknown) => JSON.stringify(v);

let db: PGlite;
const groundMd5: Record<string, string> = {};

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
const renamed = (sql: string, name: string, suffix: string) =>
  fnDef(sql, name).replace(
    `FUNCTION public.${name}(`,
    `FUNCTION public.${name}${suffix}(`,
  );
/** A file without its BEGIN and COMMIT, to run inside a rolled-back test. */
const inTest = (file: string) =>
  migration(file)
    .replace(/^BEGIN;/m, "")
    .replace(/COMMIT;\s*$/m, "");

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
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
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}
/** One step inside a rolled-back test that may fail, leaving the transaction usable. */
async function step<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("SAVEPOINT step");
  try {
    const out = await fn();
    await db.exec("RELEASE SAVEPOINT step");
    return out;
  } catch (e) {
    await db.exec("ROLLBACK TO SAVEPOINT step");
    throw e;
  }
}
const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );
const versionMd5 = (version: number) =>
  one<string>(
    "SELECT md5(schema::text) AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = $1",
    [version],
  );
const v3Schema = () =>
  one<Row>(
    "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 3",
  );
const setting = (key: string, value: unknown) =>
  db.query(
    "INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ($1, $2::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, json(value)],
  );
const schemaCheck = (schema: unknown) =>
  one<string | null>(
    "SELECT public.cockpit_form_schema_check($1::jsonb) AS r",
    [json(schema)],
  );
const answersCheck = (
  schema: unknown,
  answers: unknown,
  context: unknown = {},
) =>
  one<Row>(
    "SELECT public.cockpit_form_answers_check($1::jsonb, $2::jsonb, $3::jsonb) AS r",
    [json(schema), json(answers), json(context)],
  );
const printed = (version: number, answers: unknown, form = "onboarding") =>
  one<Answer[]>(
    "SELECT public.cockpit_form_stage4_print($1, $2, $3::jsonb) AS r",
    [form, version, json(answers)],
  );
const clientVersion = () =>
  one<number>("SELECT public.cockpit_form_client_version('onboarding') AS r");
const switchTo = (state: string, actor = "the tech lead") =>
  one<Row>("SELECT public.cockpit_form_schema_v2_switch($1, $2) AS r", [
    state,
    actor,
  ]);
const auditRows = (action: string) =>
  db
    .query<Row>(
      "SELECT action, entity_id, actor_email, before, after, metadata FROM public.cockpit_audit_log WHERE action = $1 ORDER BY id",
      [action],
    )
    .then(r => r.rows);
/** A stored response (invented), on the stand-in table. */
const respond = async (
  version: number,
  answers: unknown,
  task = TASK,
  extra: Row = {},
) =>
  one<string>(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state, answers,
       answer_meta, submitted_at)
     VALUES (gen_random_uuid(), 'onboarding', $1, $2, $3, 'Cedar Homes Invented', 'live', 'submitted', $4::jsonb, '{}'::jsonb,
             '2026-11-03T09:00:00Z')
     RETURNING id::text AS r`,
    [version, extra.source ?? "portal", task, json(answers)],
  );

// --- Make's side: make_parity.py's evaluator (python3, the standard library only) --------------------------------

const EVALUATOR = `
import json, sys
root = sys.argv[1]
sys.path.insert(0, root + "/scripts/dev")
import make_parity as mp
fx = root + "/scripts/dev/fixtures/make-parity"
make13 = mp.blueprint_of(mp.saved_file(fx, str(mp.MAKE13)))
onb = mp.saved_file(fx, mp.ONBOARDING_FORM)
out = {}
for case in json.load(sys.stdin):
    answers = mp.clean(case["answers"])
    mods = mp.make_modules(make13, mp.trigger_bundle(onb, answers, {"onboarding_client_id": case["task"]}))
    out[case["id"]] = {"raw": mods[47]["input"]["comment_text"],
                       "profile": mods[29]["input"]["custom_fields"][mp.FIELD["profile"]],
                       "dispatch": json.loads(mods[25]["input"]["jsonStringBodyContent"])["client_payload"],
                       "readModel": mp.read_model_verdict(case["readModel"])}
json.dump(out, sys.stdout, ensure_ascii=False)
`;
function evaluate(
  cases: { id: string; task: string; answers: Answer[]; readModel: Row }[],
): Row {
  const out = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-c", EVALUATOR, ROOT],
    {
      cwd: ROOT,
      encoding: "utf8",
      input: json(cases),
    },
  );
  if (out.status !== 0)
    throw new Error(`The evaluator stopped: ${out.stderr || out.stdout}`);
  return JSON.parse(out.stdout);
}

// --- The ground ----------------------------------------------------------------------------------------------------

/**
 * The columns the checks, the printer, the input, the builder and the planner, the issue core, the Typeform door, the
 * editor and the switch read (stand-ins), with the effects' plan check as 20261027f made it (20261102o widens it), and
 * the request plan as each part's payload, as stage4-match-make-supabase.test.ts makes them.
 */
const STAND_INS = `
  CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text, form_version integer,
    source text, external_id text, task_id text, client_name text, mode text, state text, answers jsonb, answer_meta jsonb,
    hidden jsonb, submitted_at timestamptz, created_by_id uuid, created_by text, submitted_by text,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_billing_accounts (clickup_task_id text PRIMARY KEY, client_name text, mrr_usd numeric, country text,
    stage_group text);
  CREATE TABLE public.cockpit_client_onboarding (clickup_task_id text PRIMARY KEY, client_name text, forms jsonb, links jsonb,
    synced_at timestamptz, in_onboarding boolean, signup_on date);
  CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, title text, audience text, provider text, typeform_id text,
    effects jsonb, version integer, schema jsonb, updated_by text, updated_at timestamptz);
  CREATE TABLE public.cockpit_form_versions (form_key text, version integer, schema jsonb, published_by text,
    published_at timestamptz NOT NULL DEFAULT now(), note text, PRIMARY KEY (form_key, version));
  CREATE TABLE public.cockpit_form_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id text, client_name text,
    location_id text, form_key text, form_version integer, purpose text, context jsonb NOT NULL DEFAULT '{}'::jsonb,
    channels text[], audience text, note text, lang text, origin text, state text NOT NULL DEFAULT 'open', issued_by uuid,
    issued_by_email text, issued_by_role text, issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
    push boolean, push_state text, message_id uuid, updated_at timestamptz);
  CREATE TABLE public.cockpit_form_effects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_id uuid, form_key text,
    effect_key text, dedupe_key text, owner text, delivery text,
    plan jsonb CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 131072), state text, reason text,
    delivery_ref text, receipt jsonb, UNIQUE (response_id, effect_key));
  CREATE TABLE public.cockpit_request_types (key text PRIMARY KEY, version integer, label text, enabled boolean,
    fields jsonb, targets jsonb, due_days integer, priority text);
  CREATE TABLE public.cockpit_requests (id uuid PRIMARY KEY, type_key text, type_version integer, type_label text,
    requester_member_id uuid, requester_email text, requester_label text, source text, client_task_id text,
    client_name text, answers jsonb, due_on date, priority text, state text, content_hash text, form_response_id uuid,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_request_parts (request_id uuid, part text, list_id text, team text, template_id text,
    template_name text, task_name text, owner_rule text, owner_clickup_id bigint, owner_how text, owner_label text,
    owner_note text, state text, queue_id uuid);
  CREATE TABLE public.cockpit_clickup_writeback_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dedupe_key text UNIQUE,
    kind text, source_table text, source_id text, campaign_name text, task_id text, payload jsonb, state text DEFAULT 'queued');
  CREATE TABLE public.cockpit_csm_calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source text, task_id text,
    kind text, status text, starts_at timestamptz, recording_url text, match_method text, match_confidence numeric);
  CREATE TABLE public.cockpit_csm_form_sends (response_id text PRIMARY KEY, second boolean NOT NULL);
  CREATE TABLE public.cockpit_sales_deals (response_id text, country text, submitted_at timestamptz);
  CREATE TABLE public.test_deal_cards (clickup_task_id text, deal_response_id text, conflict boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.cockpit_request_plan(p_type public.cockpit_request_types, p_request uuid, p_client_task text,
    p_client_name text, p_answers jsonb, p_due date, p_priority text, p_requester_label text, p_replaces text)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('part', g->>'part', 'listId', g->>'list_id', 'templateId', g->>'template_id',
             'taskName', p_client_name || ' - ' || p_type.label, 'owner', '{}'::jsonb,
             'payload', jsonb_build_object('requestId', p_request, 'part', g->>'part')) ORDER BY n), '[]'::jsonb)
      FROM jsonb_array_elements(p_type.targets) WITH ORDINALITY AS x(g, n)
  $$;
  -- The sale ties (cockpit_billing_deal_cards, 20261101m's shape) and the Typeform door's neighbours.
  CREATE FUNCTION public.cockpit_billing_deal_cards() RETURNS TABLE (clickup_task_id text, deal_response_id text, matched_by text,
    conflict boolean, conflict_with text[], linked_by text, other_forms jsonb)
    LANGUAGE sql STABLE AS $$ SELECT t.clickup_task_id, t.deal_response_id, 'test'::text, t.conflict, NULL::text[], NULL::text,
                                     NULL::jsonb FROM public.test_deal_cards t $$;
  CREATE FUNCTION public.cockpit_hours_require_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
  CREATE FUNCTION public.cockpit_billing_today() RETURNS date LANGUAGE sql AS $$ SELECT current_date $$;
  CREATE FUNCTION public.cockpit_form_hook_onboarding(p_response_id uuid) RETURNS jsonb
    LANGUAGE sql AS $$ SELECT '{"effects": []}'::jsonb $$;
  -- The issue core's neighbours: one card allowed, no portal workspace, the invite's events and the client hook kept.
  CREATE FUNCTION public.cockpit_form_card_allows(p_task_id text, p_form_key text) RETURNS text
    LANGUAGE sql AS $$ SELECT NULL::text $$;
  CREATE FUNCTION public.cockpit_form_workspace_of(p_task_id text) RETURNS jsonb
    LANGUAGE sql AS $$ SELECT CASE WHEN p_task_id = '86exv3001' THEN '{"n":1,"closed":false,"locationId":"locInvented1"}'::jsonb
                                   ELSE '{"n":0,"closed":false}'::jsonb END $$;
  CREATE TABLE public.test_invite_events (invite_id uuid, event text);
  CREATE FUNCTION public.cockpit_form_invite_event(p_invite uuid, p_source text, p_event text, p_person text, p_detail jsonb)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.test_invite_events VALUES (p_invite, p_event) $$;
  CREATE FUNCTION public.cockpit_form_client_issued(p_invite_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  -- The editor's seat: the test sets it.
  CREATE FUNCTION public.cockpit_form_actor() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('test.seat', true), ''), '{}')::jsonb $$;`;
/** What the planner and the request writer call, from their canonical migrations (stage4-match-make's list). */
const OTHER_FNS: [string, string][] = [
  ["20261029s_forms_registry.sql", "cockpit_form_effect_owner"],
  ["20261029w_forms_dispatch.sql", "cockpit_form_effect_note"],
  ["20261026r_requests.sql", "cockpit_request_due_default"],
  ["20261026r_requests.sql", "cockpit_request_hash"],
  ["20261026r_requests.sql", "cockpit_request_audit"],
  ["20261025n_slack_notices.sql", "cockpit_slack_notice_role_of"],
  [F_FILE, "cockpit_form_kuwait_day"],
  [A_FILE, "cockpit_form_schema_pair"],
  [A_FILE, "cockpit_form_schema_text_problem"],
  [A_FILE, "cockpit_form_client_version"],
  [A_FILE, "cockpit_form_client_settings"],
  [A_FILE, "cockpit_form_client_live"],
  [A_FILE, "cockpit_form_words"],
  [A_FILE, "cockpit_form_day_words"],
];
const I_FNS = [
  "cockpit_form_schema_check",
  "cockpit_form_answers_check",
  "cockpit_form_invite_issue_core",
] as const;
const J_FNS = [
  "cockpit_form_stage4_effects",
  "cockpit_form_stage4_fields",
  "cockpit_form_stage4_card_fields",
  "cockpit_form_stage4_hidden_map",
  "cockpit_form_stage4_setting",
  "cockpit_form_stage4_text",
  "cockpit_form_stage4_typeform_answers",
  "cockpit_form_stage4_native_answers",
  "cockpit_form_stage4_hidden",
  "cockpit_form_stage4_render",
  "cockpit_form_stage4_message",
  "cockpit_form_stage4_map_url",
  "cockpit_form_stage4_build",
  "cockpit_form_stage4_input",
  "cockpit_form_parity_plan",
  "cockpit_kickoff_answers_check",
  "cockpit_form_stage4_ts",
  "cockpit_form_stage4_kickoff_at",
  "cockpit_form_stage4_answered_at",
  "cockpit_request_create_system",
  "cockpit_form_stage4_plan",
  "cockpit_form_onboarding_typeform",
] as const;
/** The forms editor (20261102d), cut: its helpers, the drafts table and the browser RPCs. */
const D_FNS = [
  "cockpit_form_editor_version",
  "cockpit_form_editor_kind",
  "cockpit_form_editor_role",
  "cockpit_form_editor_texts",
  "cockpit_form_editor_effect_label",
  "cockpit_form_editor_read_map",
  "cockpit_form_editor_problem",
  "cockpit_form_editor_seat",
  "cockpit_form_editor_row",
  "cockpit_form_editor_read_one",
  "cockpit_form_draft_save",
  "cockpit_form_editor_publish_schema",
  "cockpit_form_publish",
  "cockpit_form_restore",
] as const;
/**
 * The portal's two reads of an invite, where a client gets its context: 20261102a's link page (portal_form_token_open)
 * and 20261102i's portal page (portal_form_get), with what they call cut from the same files. The expiry sweep and the
 * portal workspace check are stand-ins; 20261102a's client context is also kept as cockpit_form_client_context_a.
 */
const A_PORTAL_FNS = [
  "cockpit_form_invite_schema",
  "cockpit_form_invite_state",
  "cockpit_form_token_limited",
  "cockpit_form_token_limited_note",
  "cockpit_form_token_find",
  "cockpit_form_portal_invite",
  "cockpit_form_client_context",
  "portal_form_token_open",
] as const;
const PORTAL_STAND_INS = `
  CREATE FUNCTION public.cockpit_form_invites_expire() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.cockpit_form_portal_workspace(p_location_id text, p_clickup_id text) RETURNS void
    LANGUAGE sql AS $$ SELECT $$;`;
/** The onboarding's version 2 as 20261102j inserts it (20261102o and 20261103b change it in place, as live). */
const V2_INSERT = cut(
  migration(J),
  /INSERT INTO public\.cockpit_form_versions\(form_key, version, schema, published_by, note\)\nVALUES \('onboarding', 2,[\s\S]*?ON CONFLICT \(form_key, version\) DO NOTHING;/,
  "onboarding version 2",
);

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(
    cut(
      migration("20260921a_cockpit_settings.sql"),
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
    ),
  );
  await db.exec(fnDef(migration(A_FILE), "cockpit_client_text_ok"));
  await db.exec(STAND_INS);
  // The responses table's answers check as live holds it: 20261027f's, then 20261102f's.
  await db.exec(
    "ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_answers_check CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536)",
  );
  await db.exec(inTest("20261102f_form_responses_answer_size.sql"));
  // The writeback queue's audit trigger as live holds it (20261026t's body, 20261009f's grant and triggers).
  await db.exec(
    fnDef(
      migration("20261026t_task_alerts.sql"),
      "cockpit_clickup_writeback_audit",
    ),
  );
  const f9 = migration("20261009f_clickup_writeback_native.sql");
  await db.exec(
    cut(
      f9,
      /REVOKE ALL ON FUNCTION public\.cockpit_clickup_writeback_audit\(\) FROM PUBLIC,anon,authenticated;/,
      "audit grant",
    ),
  );
  for (const name of ["insert", "state"])
    await db.exec(
      cut(
        f9,
        new RegExp(
          `DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_${name} ON public\\.cockpit_clickup_writeback_queue;\\nCREATE TRIGGER[\\s\\S]*?EXECUTE FUNCTION public\\.cockpit_clickup_writeback_audit\\(\\);`,
        ),
        `queue audit trigger ${name}`,
      ),
    );
  // The forms audit trigger on the registry and the versions (20261027f), and the forms settings trigger (20261101p).
  const f = migration(F_FILE);
  await db.exec(fnDef(f, "cockpit_forms_audit"));
  for (const table of ["cockpit_forms", "cockpit_form_versions"])
    await db.exec(
      cut(
        f,
        new RegExp(
          `DROP TRIGGER IF EXISTS cockpit_forms_audit ON public\\.${table};\\nCREATE TRIGGER cockpit_forms_audit AFTER INSERT OR UPDATE ON public\\.${table}\\n  FOR EACH ROW EXECUTE FUNCTION public\\.cockpit_forms_audit\\(\\);`,
        ),
        `forms audit trigger on ${table}`,
      ),
    );
  const p101 = migration("20261101p_money_acts.sql");
  await db.exec(fnDef(p101, "cockpit_settings_forms_audit"));
  await db.exec(
    cut(
      p101,
      /DROP TRIGGER IF EXISTS cockpit_settings_forms_audit ON public\.cockpit_settings;\nCREATE TRIGGER[\s\S]*?EXECUTE FUNCTION public\.cockpit_settings_forms_audit\(\);/,
      "settings audit trigger",
    ),
  );
  const j = migration(J);
  await db.exec(
    cut(
      j,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_form_option_maps \([\s\S]*?\n\);/,
      "option maps",
    ),
  );
  await db.exec(
    cut(
      j,
      /INSERT INTO public\.cockpit_form_option_maps\(form_key, field_id, answer, option_name\) VALUES[\s\S]*?ON CONFLICT \(form_key, field_id, answer\) DO NOTHING;/,
      "option map rows",
    ),
  );
  for (const key of [
    "forms\\.stage4",
    "onboarding\\.map_urls",
    "stage4\\.messages",
    "stage4\\.templates",
  ])
    await db.exec(
      cut(
        j,
        new RegExp(
          `INSERT INTO public\\.cockpit_settings\\(key, value, updated_by\\)\\nVALUES \\('${key}'[^\\n]*\\n(ON CONFLICT[^\\n]*\\n(WHERE[^\\n]*\\n)?)?`,
        ),
        key,
      ),
    );
  for (const [file, name] of OTHER_FNS)
    await db.exec(fnDef(migration(file), name));
  for (const name of J_FNS) await db.exec(fnDef(j, name));
  await db.exec(
    `REVOKE ALL ON FUNCTION public.cockpit_form_onboarding_typeform(jsonb) FROM PUBLIC, anon, authenticated, service_role;
     GRANT EXECUTE ON FUNCTION public.cockpit_form_onboarding_typeform(jsonb) TO service_role;`,
  );
  const l = migration(L);
  await db.exec(fnDef(l, "cockpit_form_stage4_effects"));
  await db.exec(fnDef(l, "cockpit_form_stage4_build"));
  const i = migration(I);
  for (const name of I_FNS) await db.exec(fnDef(i, name));
  const d = migration(D_FILE);
  await db.exec(
    cut(
      d,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_form_schema_drafts \([\s\S]*?\n\);/,
      "drafts",
    ),
  );
  for (const name of D_FNS) await db.exec(fnDef(d, name));
  const a = migration(A_FILE);
  for (const table of [
    "cockpit_form_invite_events",
    "cockpit_form_invite_tokens",
    "cockpit_form_token_opens",
  ])
    await db.exec(
      cut(
        a,
        new RegExp(
          `CREATE TABLE IF NOT EXISTS public\\.${table} \\([\\s\\S]*?\\n\\);`,
        ),
        table,
      ),
    );
  await db.exec(PORTAL_STAND_INS);
  for (const name of A_PORTAL_FNS) await db.exec(fnDef(a, name));
  await db.exec(renamed(a, "cockpit_form_client_context", "_a"));
  await db.exec(fnDef(i, "cockpit_form_file_slots_state"));
  await db.exec(fnDef(i, "portal_form_get"));
  await db.exec(
    fnDef(
      migration("20261029170000_client_asks.sql"),
      "portal_client_ask_person",
    ),
  );
  // The registry as live holds it: both forms on Typeform with their version-1 arrays, and a native client form.
  await db.exec(V2_INSERT);
  await db.query(
    `INSERT INTO public.cockpit_forms(key, title, audience, provider, typeform_id, effects, version, schema, updated_by) VALUES
       ('kickoff', 'Kickoff', 'team', 'typeform', 'tG7dnxBn', public.cockpit_form_stage4_effects('kickoff', 1), 1, '{}', 'test'),
       ('onboarding', 'Client onboarding', 'client', 'typeform', 'KFRCXPFx', public.cockpit_form_stage4_effects('onboarding', 1), 1,
        '{}', 'test'),
       ('nps', 'NPS', 'client', 'native', NULL, '[]', 1, $1::jsonb, 'test')`,
    [json(FIXTURE.schemas.nps)],
  );
  await db.query(
    "INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by) VALUES ('nps', 1, $1::jsonb, 'test')",
    [json(FIXTURE.schemas.nps)],
  );
  await db.exec(migration(M));
  await db.exec(fnDef(migration(N25), "cockpit_slack_notice_kickoff_facts"));
  await db.exec(migration(P));
  await db.exec(migration(B));
  oldV2Schema = await one(
    "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
  );
  await setting("forms.stage4", { kickoff: false, onboarding: false });
  await db.exec(migration("20261104c_onboarding_v2_wording.sql"));
  // 20261102j's input and 20261102p's builder, kept beside this file's.
  await db.exec(
    renamed(j, "cockpit_form_stage4_input", "_j").replaceAll(
      "public.cockpit_form_stage4_input(",
      "public.cockpit_form_stage4_input_j(",
    ),
  );
  await db.exec(renamed(migration(P), "cockpit_form_stage4_build", "_p"));
  for (const fn of Object.keys(BEFORE_H)) groundMd5[fn] = await md5Of(fn);
  groundMd5.v2 = await versionMd5(2);
  await setting("onboarding.raw_titles", RAW_TITLES);
  await db.exec(migration(H));
}, 300_000);
afterAll(async () => {
  await db?.close();
});

/** The guard line of one replaced function in this file. */
const guardLine = (fn: string) =>
  migration(H)
    .split("\n")
    .find(x => x.includes(`('public.${fn}', '`)) ?? "";

// --- The file ------------------------------------------------------------------------------------------------------

describe("20261104d: the file", () => {
  test("the ground holds the guarded bodies and corrected version 2", () => {
    expect(groundMd5).toEqual({ ...BEFORE_H, v2: V2_B_MD5 });
    for (const [fn, md5] of Object.entries(BEFORE_H))
      expect(guardLine(fn)).toContain(`('public.${fn}', '${md5}', '`);
  });

  test("the after values are this file's bodies; the version-1 checks keep 20261102o's bodies byte for byte", async () => {
    const after: Record<string, string> = {};
    for (const fn of Object.keys(BEFORE_H)) after[fn] = await md5Of(fn);
    expect(after).toEqual({ ...AFTER_H });
    for (const fn of Object.keys(BEFORE_H)) {
      const now = await md5Of(fn);
      expect(now).not.toBe(BEFORE_H[fn as keyof typeof BEFORE_H]);
      expect(guardLine(fn)).toContain(`', '${now}')`);
    }
    expect(await md5Of("cockpit_form_schema_check_v1(jsonb)")).toBe(
      BEFORE_H["cockpit_form_schema_check(jsonb)"],
    );
    expect(
      await md5Of("cockpit_form_answers_check_v1(jsonb,jsonb,jsonb)"),
    ).toBe(BEFORE_H["cockpit_form_answers_check(jsonb,jsonb,jsonb)"]);
    expect(await versionMd5(3)).toBe(V3_MD5);
    expect(migration(H)).toContain(`v_md5 <> '${V3_MD5}'`);
    expect(migration(H)).toContain(
      `md5(v_schema::text) IS DISTINCT FROM '${V3_MD5}'`,
    );
  });

  test("version 3 uses the reviewed onboarding wording", async () => {
    const copy = await one<Row>(`SELECT jsonb_build_object(
      'intro_en', schema #>> '{intro,en}',
      'intro_ar', schema #>> '{intro,ar}',
      'free_hint', (SELECT f->'hint' FROM jsonb_array_elements(schema->'fields') f WHERE f->>'key' = 'freeConsults'),
      'challenge_hint_ar', (SELECT f #>> '{hint,ar}' FROM jsonb_array_elements(schema->'fields') f WHERE f->>'key' = 'challenges')
    ) AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 3`);
    expect(copy).toEqual({
      intro_en: "Tell us about your business so your onboarding call starts in the right place.",
      intro_ar: "عرّفونا على شغلكم عشان مكالمة الانطلاق تبدي من المكان الصح.",
      free_hint: null,
      challenge_hint_ar: "اذكروا جم شي نقدر نساعدكم فيه سيده.",
    });
  });

  test("a second apply changes nothing", async () => {
    const snapshot = async () => ({
      md5: await Promise.all(
        [...Object.keys(BEFORE_H), ...NEW_FNS].map(fn => md5Of(fn)),
      ),
      versions: await one(
        "SELECT jsonb_agg(jsonb_build_array(form_key, version, md5(schema::text)) ORDER BY form_key, version) AS r FROM public.cockpit_form_versions",
      ),
      registry: await one(
        "SELECT jsonb_agg(to_jsonb(f) - 'updated_at' ORDER BY key) AS r FROM public.cockpit_forms f",
      ),
      setting: await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'forms.client.schema_v2'",
      ),
      audit: await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_audit_log",
      ),
    });
    await rolledBack(async () => {
      const before = await snapshot();
      await db.exec(inTest(H));
      expect(await snapshot()).toEqual(before);
    });
  });

  test("it refuses the uncorrected version 2, schema drift, or a missing prerequisite", async () => {
    const stop = {
      code: "55000",
      message: "Apply 20261102p, 20261103b and 20261104c before 20261104d.",
    };
    await rolledBack(async () => {
      await db.query(
        "UPDATE public.cockpit_form_versions SET schema = $1::jsonb WHERE form_key = 'onboarding' AND version = 2",
        [json(oldV2Schema)],
      );
      expect(await refusal(() => db.exec(inTest(H)))).toEqual(stop);
    });
    await rolledBack(async () => {
      await db.exec(
        "UPDATE public.cockpit_form_versions SET schema = jsonb_set(schema, '{minutes}', '26') WHERE form_key = 'onboarding' AND version = 2",
      );
      expect(await refusal(() => db.exec(inTest(H)))).toEqual(stop);
    });
    await rolledBack(async () => {
      await db.exec(fnDef(migration(M), "cockpit_form_stage4_fields"));
      expect(await refusal(() => db.exec(inTest(H)))).toEqual(stop);
    });
    await rolledBack(async () => {
      await db.exec(
        "DROP FUNCTION public.cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)",
      );
      expect(await refusal(() => db.exec(inTest(H)))).toEqual(stop);
    });
  });

  test("a changed body stops the file, each by name", async () => {
    for (const fn of Object.keys(BEFORE_H))
      await rolledBack(async () => {
        const def = await one<string>(
          "SELECT pg_get_functiondef($1::regprocedure) AS r",
          [`public.${fn}`],
        );
        await db.exec(def.replace("BEGIN", "BEGIN  /* changed */"));
        expect(await refusal(() => db.exec(inTest(H)))).toEqual({
          code: "55000",
          message: `${fn.replace("public.", "")} changed since 20261103b; stop and re-read it.`,
        });
      });
  });

  test("a version 3 that is not this file's, or a version 4, stops it", async () => {
    await rolledBack(async () => {
      await db.exec(
        "UPDATE public.cockpit_form_versions SET schema = jsonb_set(schema, '{minutes}', '31') WHERE form_key = 'onboarding' AND version = 3",
      );
      const out = await refusal(() => db.exec(inTest(H)));
      expect(out.code).toBe("55000");
      expect(out.message).toMatch(
        /^The onboarding form already has a version 3 that is not this file's \(md5 [0-9a-f]{32}\); stop and re-read it\.$/,
      );
    });
    await rolledBack(async () => {
      await db.exec(
        "INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by) SELECT form_key, 4, schema, 'test' FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
      );
      expect(await refusal(() => db.exec(inTest(H)))).toEqual({
        code: "55000",
        message:
          "The onboarding form has a version after 3; stop and re-read it.",
      });
    });
  });

  test("every function it makes or replaces is the owner's only, but the editor's read and the Typeform door", async () => {
    const acl = (fn: string) =>
      one<string>(
        "SELECT coalesce(proacl::text, '') AS r FROM pg_proc WHERE oid = to_regprocedure($1)",
        [`public.${fn}`],
      );
    for (const fn of [...Object.keys(BEFORE_H), ...NEW_FNS]) {
      const want =
        fn === "cockpit_form_onboarding_typeform(jsonb)"
          ? "{postgres=X/postgres,service_role=X/postgres}"
          : fn === "cockpit_form_editor_structured(text)"
            ? "{postgres=X/postgres,authenticated=X/postgres}"
            : "{postgres=X/postgres}";
      expect([fn, await acl(fn)]).toEqual([fn, want]);
    }
  });

  test("version 3 is stored with one audit row; the registry, invites and version 2 are untouched; the switch is seeded off", async () => {
    const v3 = await v3Schema();
    const fields = v3.fields as Row[];
    expect([v3.v, v3.key, v3.minutes, fields.length]).toEqual([
      2,
      "onboarding",
      30,
      59,
    ]);
    const types = fields.map(f => f.type);
    expect([
      types.filter(t => t === "heading").length,
      types.filter(t => t === "note").length,
      types.filter(t => t === "rows").length,
      types.filter(t => !["heading", "note"].includes(t)).length,
    ]).toEqual([4, 1, 3, 54]);
    const shows = fields
      .filter(f => f.showIf)
      .map(f => Object.keys(f.showIf).find(k => k !== "key"));
    expect([
      shows.length,
      shows.filter(s => s === "equals").length,
      shows.filter(s => s === "in").length,
      shows.filter(s => s === "includes").length,
    ]).toEqual([13, 3, 1, 9]);
    expect(await schemaCheck(v3)).toBeNull();
    expect(
      await one(
        "SELECT public.cockpit_form_schema_text_problem($1::jsonb) AS r",
        [json(v3)],
      ),
    ).toBeNull();
    expect(
      await one(
        "SELECT public.cockpit_form_stage4_print_problem(3, $1::jsonb) AS r",
        [json(v3)],
      ),
    ).toBeNull();
    expect(await versionMd5(2)).toBe(V2_B_MD5);
    const stored = await auditRows("forms.onboarding_v3_stored");
    expect(stored.map(r => [r.entity_id, r.actor_email, r.after])).toEqual([
      [
        "onboarding:3",
        "migration 20261104d",
        { key: "onboarding", version: 3 },
      ],
    ]);
    expect(
      await one(
        "SELECT jsonb_build_object('provider', provider, 'version', version) AS r FROM public.cockpit_forms WHERE key = 'onboarding'",
      ),
    ).toEqual({ provider: "typeform", version: 1 });
    expect(
      await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'forms.client.schema_v2'",
      ),
    ).toEqual({ state: "off" });
    expect(
      (await auditRows("forms.switch_seeded"))
        .filter(r => r.entity_id === "forms.client.schema_v2")
        .map(r => r.after),
    ).toEqual([{ value: { state: "off" } }]);
    expect(await clientVersion()).toBe(2);
  });
});

// --- 1. The language checks ----------------------------------------------------------------------------------------

/** A copy of version 3 with one change, for the refusals. */
const withV3 = async (change: (s: Row) => void) => {
  const s = structuredClone(await v3Schema());
  change(s);
  return s;
};
const fieldOf = (s: Row, key: string) =>
  (s.fields as Row[]).find(f => f.key === key) as Row;

describe("client form schema version 2: the schema check", () => {
  test("version 3 and the fixture's structured form pass; every version-1 schema reads as before", async () => {
    expect(await schemaCheck(await v3Schema())).toBeNull();
    expect(await schemaCheck(FIXTURE.schemaV2Schemas.structured)).toBeNull();
    for (const [name, s] of Object.entries(FIXTURE.schemas))
      expect([name, await schemaCheck(s)]).toEqual([
        name,
        await one(
          "SELECT public.cockpit_form_schema_check_v1($1::jsonb) AS r",
          [json(s)],
        ),
      ]);
    // Version 1 still refuses what it does not know, in its own words.
    const v1 = structuredClone(FIXTURE.schemas.nps);
    v1.fields[0].type = "rows";
    expect(await schemaCheck(v1)).toBe(
      "Question recommend has a type client forms do not know.",
    );
    expect(await schemaCheck({ ...v1, v: 3 })).toBe(
      "The schema must be client form schema version 1.",
    );
  });

  test("every new rule refuses in plain words", async () => {
    const cases: [string, (s: Row) => void, string][] = [
      [
        "another form",
        s => {
          s.key = "nps";
        },
        "Client form schema version 2 is the client onboarding's only.",
      ],
      [
        "65 questions",
        s => {
          for (let n = 0; n < 6; n++)
            s.fields.push({
              ...fieldOf(s, "additionalInfo"),
              key: `extra${n}`,
            });
        },
        "A structured form needs 1 to 64 questions.",
      ],
      [
        "a choice of 13",
        s => {
          const f = fieldOf(s, "freeConsults");
          f.options = Array.from({ length: 13 }, (_, n) => ({
            value: `opt_${n}`,
            label: { en: `Option ${n}`, ar: `خيار ${n}` },
          }));
        },
        "Question freeConsults needs 2 to 12 choices.",
      ],
      [
        "several choices of 31",
        s => {
          const f = fieldOf(s, "areasSA");
          f.options = Array.from({ length: 31 }, (_, n) => ({
            value: `area_${n}`,
            label: { en: `Area ${n}`, ar: `منطقة ${n}` },
          }));
        },
        "Question areasSA needs 2 to 30 choices.",
      ],
      [
        "no columns",
        s => {
          fieldOf(s, "faqs").columns = [];
        },
        "Question faqs needs 1 to 6 columns.",
      ],
      [
        "seven columns",
        s => {
          const f = fieldOf(s, "services");
          f.columns.push(
            { ...f.columns[0], key: "extraOne" },
            { ...f.columns[0], key: "extraTwo" },
          );
        },
        "Question services needs 1 to 6 columns.",
      ],
      [
        "a column type rows does not take",
        s => {
          fieldOf(s, "faqs").columns[1].type = "date";
        },
        "Each column of question faqs needs a key, a type (text, longtext, number, choice or tick), English and Arabic labels and whether it is required.",
      ],
      [
        "two columns with one key",
        s => {
          fieldOf(s, "faqs").columns[1].key = "question";
        },
        "Question faqs has two columns called question.",
      ],
      [
        "a column setting its type does not take",
        s => {
          fieldOf(s, "consultants").columns[0].options = [];
        },
        "Column name of question consultants has a setting its type does not take.",
      ],
      [
        "a column text over the onboarding's limit",
        s => {
          fieldOf(s, "faqs").columns[1].maxLength = 10001;
        },
        "Column answer of question faqs allows at most 10000 characters.",
      ],
      [
        "a column currency from a later question",
        s => {
          fieldOf(s, "services").columns[1].currencyFrom = "areaCountries";
        },
        "Column price of question services reads its currency from areaCountries, which is not an earlier choice question.",
      ],
      [
        "more rows than 30",
        s => {
          fieldOf(s, "services").maxRows = 31;
        },
        "Question services takes from 0 to 30 rows, the fewest no more than the most.",
      ],
      [
        "the fewest over the most",
        s => {
          fieldOf(s, "faqs").minRows = 21;
        },
        "Question faqs takes from 0 to 30 rows, the fewest no more than the most.",
      ],
      [
        "no words for adding a row",
        s => {
          delete fieldOf(s, "faqs").addLabel;
        },
        "Question faqs needs English and Arabic words for adding a row, each 60 characters at most.",
      ],
      [
        "row settings on a text",
        s => {
          fieldOf(s, "serviceFocus").maxRows = 3;
        },
        "Question serviceFocus has row settings but is not a rows question.",
      ],
      [
        "a required note",
        s => {
          fieldOf(s, "metaAccess").required = true;
        },
        "Note metaAccess is shown, never answered, so it cannot be required.",
      ],
      [
        "a note's label over 300",
        s => {
          fieldOf(s, "metaAccess").label.en = "x".repeat(301);
        },
        "Question metaAccess needs an English and an Arabic label, each 300 characters at most.",
      ],
      [
        "a note linking another host",
        s => {
          fieldOf(s, "metaAccess").link.href =
            "https://example.com/give-access";
        },
        "The link of note metaAccess must be https on app.leadsie.com, with English and Arabic words of 60 characters at most.",
      ],
      [
        "a note linking without https",
        s => {
          fieldOf(s, "metaAccess").link.href = "http://app.leadsie.com/connect";
        },
        "The link of note metaAccess must be https on app.leadsie.com, with English and Arabic words of 60 characters at most.",
      ],
      [
        "a link on a text",
        s => {
          fieldOf(s, "website").link = fieldOf(s, "metaAccess").link;
        },
        "Question website has a link but is not a note.",
      ],
      [
        "a currency on a text",
        s => {
          fieldOf(s, "serviceFocus").currencyFrom = "currency";
        },
        "Question serviceFocus reads a currency but is not a number.",
      ],
      [
        "a currency from a later question",
        s => {
          fieldOf(s, "startYear").currencyFrom = "currency";
        },
        "Question startYear reads its currency from currency, which is not an earlier choice question.",
      ],
      [
        "two operators",
        s => {
          fieldOf(s, "website").showIf = {
            key: "noWebsite",
            equals: false,
            in: ["x"],
          };
        },
        "Question website shows on one earlier question: give its key and one of equals, in or includes.",
      ],
      [
        "in on a several-choices question",
        s => {
          fieldOf(s, "bookingOther").showIf = {
            key: "bookingTools",
            in: ["whatsapp"],
          };
        },
        "Question bookingOther shows on in: 1 to 12 choices of the earlier choice question bookingTools.",
      ],
      [
        "a missing label",
        s => {
          delete fieldOf(s, "serviceFocus").label;
        },
        "Question serviceFocus needs an English and an Arabic label, each 200 characters at most.",
      ],
      [
        "in naming a choice the question does not have",
        s => {
          fieldOf(s, "metaAccess").showIf = {
            key: "facebookAds",
            in: ["maybe"],
          };
        },
        "Question metaAccess shows on in: 1 to 12 choices of the earlier choice question facebookAds.",
      ],
      [
        "includes on a one-choice question",
        s => {
          fieldOf(s, "bookingOther").showIf = {
            key: "facebookAds",
            includes: "yes",
          };
        },
        "Question bookingOther shows on includes: one choice of the earlier several-choices question facebookAds.",
      ],
      [
        "includes naming a choice the question does not have",
        s => {
          fieldOf(s, "bookingOther").showIf = {
            key: "bookingTools",
            includes: "fax",
          };
        },
        "Question bookingOther shows on includes: one choice of the earlier several-choices question bookingTools.",
      ],
      [
        "a show-if on a later question",
        s => {
          fieldOf(s, "website").showIf = {
            key: "noFacebookPage",
            equals: false,
          };
        },
        "Question website can only follow an earlier question, and noFacebookPage is not before it.",
      ],
      [
        "a show-if on a note",
        s => {
          fieldOf(s, "bookingTools").showIf = {
            key: "metaAccess",
            equals: true,
          };
        },
        "Question bookingTools can only follow an earlier question, and metaAccess is not before it.",
      ],
      [
        "reads naming a note",
        s => {
          s.reads.profile.push("metaAccess");
        },
        "The reads list of profile names a question the form does not have.",
      ],
    ];
    for (const [what, change, problem] of cases)
      expect([what, await schemaCheck(await withV3(change))]).toEqual([
        what,
        problem,
      ]);
  });
});

describe("client form schema version 2: the answers check, on the shared fixture", () => {
  test("every row of the version-2 section gives exactly its ok, errors and stored answers", async () => {
    expect(FIXTURE.schemaV2Rows.length).toBeGreaterThanOrEqual(25);
    for (const row of FIXTURE.schemaV2Rows) {
      const out = await answersCheck(
        FIXTURE.schemaV2Schemas[row.schema],
        row.answers,
        row.context,
      );
      expect([row.name, out.ok, out.errors]).toEqual([
        row.name,
        row.ok,
        row.errors,
      ]);
      if (row.stored)
        expect([row.name, out.answers]).toEqual([row.name, row.stored]);
    }
    const codes = new Set(
      FIXTURE.schemaV2Rows.flatMap(r => Object.values(r.errors) as string[]),
    );
    for (const code of [
      "required",
      "hidden",
      "unknown",
      "rows_few",
      "rows_many",
      "length",
      "range",
      "option",
    ])
      expect(codes.has(code)).toBe(true);
  });

  test("an optional rows question may be left empty; once it has rows it takes its fewest to its most", async () => {
    const schema = structuredClone(FIXTURE.schemaV2Schemas.structured);
    (schema.fields as Row[]).find(f => f.key === "helpers")!.minRows = 2;
    const base = FIXTURE.schemaV2Rows[0]!.answers;
    const check = async (helpers: unknown) =>
      (await answersCheck(schema, { ...base, helpers })).errors;
    expect(await check([])).toEqual({});
    expect(await check([{ name: "A1" }])).toEqual({ helpers: "rows_few" });
    expect(await check([{ name: "A1" }, { name: "B2" }])).toEqual({});
  });

  test("more rows than maxRows is rows_many alone, before any cell is read, so a very long list is refused in one pass", async () => {
    const schema = FIXTURE.schemaV2Schemas.structured;
    const base = FIXTURE.schemaV2Rows[0]!.answers;
    const bad = { x: 1, price: -5 };
    // At most maxRows (3): every cell is still checked.
    expect(
      (await answersCheck(schema, { ...base, services: [bad, bad, bad] }))
        .errors,
    ).toEqual({
      "services.0.x": "unknown",
      "services.0.name": "required",
      "services.0.price": "range",
      "services.1.x": "unknown",
      "services.1.name": "required",
      "services.1.price": "range",
      "services.2.x": "unknown",
      "services.2.name": "required",
      "services.2.price": "range",
    });
    // One over: the count alone, no cell code.
    const over = await answersCheck(schema, {
      ...base,
      services: [bad, bad, bad, bad],
    });
    expect([over.ok, over.errors, "services" in over.answers]).toEqual([
      false,
      { services: "rows_many" },
      false,
    ]);
    // A broken client or a held link sending 20,000 rows: refused at once (cells grew per row before, in a lock).
    const started = performance.now();
    const many = await answersCheck(schema, {
      ...base,
      services: Array.from({ length: 20_000 }, () => ({ x: 1 })),
    });
    const took = performance.now() - started;
    expect(many.ok).toBe(false);
    expect(many.errors).toEqual({ services: "rows_many" });
    expect(took).toBeLessThan(10_000);
  });

  test("every version-1 row reads as before through the same entry point", async () => {
    for (const row of FIXTURE.rows) {
      const out = await answersCheck(
        FIXTURE.schemas[row.schema],
        row.answers,
        row.context,
      );
      const v1 = await one<Row>(
        "SELECT public.cockpit_form_answers_check_v1($1::jsonb, $2::jsonb, $3::jsonb) AS r",
        [
          json(FIXTURE.schemas[row.schema]),
          json(row.answers),
          json(row.context),
        ],
      );
      expect([row.name, out]).toEqual([row.name, v1]);
      expect([row.name, out.ok, out.errors]).toEqual([
        row.name,
        row.ok,
        row.errors,
      ]);
    }
  });

  test("a whole version-3 answer passes, and its limits fit the 1 MB answer and the 2 MB plan", async () => {
    const v3 = await v3Schema();
    const golden = GOLDENS.cases[0].answers;
    const out = await answersCheck(v3, golden);
    expect([out.ok, out.errors]).toEqual([true, {}]);
    // 25 services, 20 FAQs and 15 consultants at their longest, every other text at its limit, in Arabic.
    const ar = (n: number) => "ع".repeat(n);
    const big: Row = { ...golden };
    for (const f of v3.fields as Row[])
      if (
        ["text", "longtext"].includes(f.type) &&
        typeof big[f.key] === "string" &&
        !f.format
      )
        big[f.key] = ar(f.maxLength);
    big.services = Array.from({ length: 25 }, () => ({
      name: ar(300),
      price: 1000000000,
      unit: "starts_from",
      topPrice: true,
      topProfit: true,
    }));
    big.faqs = Array.from({ length: 20 }, () => ({
      question: ar(300),
      answer: ar(2000),
    }));
    big.consultants = Array.from({ length: 15 }, () => ({
      name: ar(300),
      speciality: ar(300),
      nationality: ar(200),
      qualifications: ar(1000),
    }));
    const checked = await answersCheck(v3, big);
    expect([checked.ok, checked.errors]).toEqual([true, {}]);
    const bytes = await one<number>(
      "SELECT octet_length($1::jsonb::text) AS r",
      [json(checked.answers)],
    );
    expect(bytes).toBeLessThan(1048576);
    await rolledBack(async () => {
      const id = await respond(3, checked.answers);
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1::uuid) AS r",
        [id],
      );
      const plan = await one<Row[]>(
        "SELECT public.cockpit_form_stage4_build($1::jsonb) AS r",
        [json(input)],
      );
      // Every effect's plan, the raw answers comment and the read model whole among them, fits the 2 MB a step keeps.
      const sizes = await Promise.all(
        plan.map(e =>
          one<number>("SELECT octet_length($1::jsonb::text) AS r", [
            json(e.plan ?? {}),
          ]),
        ),
      );
      expect(plan.map(e => e.key)).toContain("raw_answers_comment");
      expect(Math.max(...sizes)).toBeGreaterThan(131072);
      expect(Math.max(...sizes)).toBeLessThan(2097152);
    });
  });
});

// --- 3. The printer --------------------------------------------------------------------------------------------------

describe("the printer (cockpit_form_stage4_print)", () => {
  test("on every golden case it prints exactly what the design's reference printer printed", async () => {
    expect(GOLDENS.cases.length).toBeGreaterThanOrEqual(5);
    for (const c of GOLDENS.cases) {
      expect([c.name, await printed(3, c.answers)]).toEqual([
        c.name,
        c.printed,
      ]);
      expect([
        c.name,
        await one(
          "SELECT public.cockpit_form_stage4_structured(3, $1::jsonb) AS r",
          [json(c.answers)],
        ),
      ]).toEqual([c.name, c.structured]);
    }
  });

  test("a printing mistake is caught: one changed label fails the goldens", async () => {
    await rolledBack(async () => {
      const def = await one<string>(
        "SELECT pg_get_functiondef('public.cockpit_form_stage4_print_map(integer)'::regprocedure) AS r",
      );
      await db.exec(def.replace('"Down payment first"', '"Down payment"'));
      const c = GOLDENS.cases[0];
      expect(await printed(3, c.answers)).not.toEqual(c.printed);
    });
    await rolledBack(async () => {
      const def = await one<string>(
        "SELECT pg_get_functiondef('public.cockpit_form_stage4_print_part(jsonb,jsonb)'::regprocedure) AS r",
      );
      await db.exec(
        def.replace("'FM999,999,999,999,990'", "'FM999999999999990'"),
      );
      const c = GOLDENS.cases[0];
      expect(await printed(3, c.answers)).not.toEqual(c.printed);
    });
  });

  test("version 2 and every kickoff print byte for byte as cockpit_form_stage4_typeform_answers", async () => {
    const v2 = {
      fullName: "Invented Owner",
      businessName: "Cedar Homes Invented",
      facebookAds: "restricted",
      appointmentTypes: ["office", "online"],
      lastRevenue: 0,
      goal90: 60000,
      hours: "Sat to Thu\n9 to 5",
    };
    expect(await printed(2, v2)).toEqual(
      await one(
        "SELECT public.cockpit_form_stage4_typeform_answers('onboarding', $1::jsonb) AS r",
        [json(v2)],
      ),
    );
    const kickoff = {
      contractStatus: "Signed",
      serviceAdvertised: ["Interior design", "Other"],
      paymentAmount: 1500,
    };
    expect(await printed(2, kickoff, "kickoff")).toEqual(
      await one(
        "SELECT public.cockpit_form_stage4_typeform_answers('kickoff', $1::jsonb) AS r",
        [json(kickoff)],
      ),
    );
    expect(await printed(3, kickoff, "kickoff")).toEqual(
      await printed(2, kickoff, "kickoff"),
    );
    expect(
      await one(
        "SELECT public.cockpit_form_stage4_structured(2, $1::jsonb) AS r",
        [json(v2)],
      ),
    ).toBeNull();
  });

  test("the print map fits version 3, prints KFRCXPFx's 36 refs in version 2's order, and refuses a map that reads a question version 3 does not ask", async () => {
    const map = await one<Row>(
      "SELECT public.cockpit_form_stage4_print_map(3) AS r",
    );
    const fields = await one<Row[]>(
      "SELECT public.cockpit_form_stage4_fields('onboarding') AS r",
    );
    expect(map.refs.map((r: Row) => r.ref)).toEqual(
      fields.map(f => f.typeformRef),
    );
    expect(map.refs.map((r: Row) => r.title)).toEqual(fields.map(f => f.title));
    expect(map.sidecar.keysExcluded).toEqual(CONTACT);
    expect(
      await one("SELECT public.cockpit_form_stage4_print_map(2) AS r"),
    ).toBeNull();
    const v3 = await v3Schema();
    const without = structuredClone(v3);
    without.fields = without.fields.filter(
      (f: Row) => f.key !== "bookingOther",
    );
    expect(
      await one(
        "SELECT public.cockpit_form_stage4_print_problem(3, $1::jsonb) AS r",
        [json(without)],
      ),
    ).toBe(
      "The print map of version 3 reads bookingOther, which that version does not ask.",
    );
    expect(
      await one(
        "SELECT public.cockpit_form_stage4_print_problem(4, $1::jsonb) AS r",
        [json(v3)],
      ),
    ).toBe(
      "Version 4 has no print map, so its answers cannot reach Make's texts.",
    );
  });

  test("no currency in a revenue line: every golden revenue prints as a plain whole number", () => {
    for (const c of GOLDENS.cases)
      for (const x of c.printed)
        if ([R.lastRevenue, R.goal90, R.goal12].includes(x.ref as any))
          expect([c.name, x.value]).toEqual([
            c.name,
            expect.stringMatching(/^\d+$/),
          ]);
  });
});

// --- The input, the builder and Make's texts --------------------------------------------------------------------------

describe("the input and the plan of a version-3 answer", () => {
  test("the input prints the answer and carries structured; a version-2 answer's input is 20261102j's, byte for byte", async () => {
    await rolledBack(async () => {
      for (const c of GOLDENS.cases) {
        const id = await respond(3, c.answers);
        const input = await one<Row>(
          "SELECT public.cockpit_form_stage4_input($1::uuid) AS r",
          [id],
        );
        expect([c.name, input.answers, input.structured]).toEqual([
          c.name,
          c.printed,
          c.structured,
        ]);
        const was = await one<Row>(
          "SELECT public.cockpit_form_stage4_input_j($1::uuid) AS r",
          [id],
        );
        expect({ ...input, answers: null, structured: null }).toEqual({
          ...was,
          answers: null,
          structured: null,
        });
      }
      const v2 = {
        fullName: "Invented Owner",
        businessName: "Cedar Homes Invented",
        lastRevenue: 250000,
      };
      const id2 = await respond(2, v2);
      expect(
        await one("SELECT public.cockpit_form_stage4_input($1::uuid) AS r", [
          id2,
        ]),
      ).toEqual(
        await one("SELECT public.cockpit_form_stage4_input_j($1::uuid) AS r", [
          id2,
        ]),
      );
    });
  });

  test("the builder: a version-2 plan is 20261102p's byte for byte; a version-3 plan differs only by structured in the read model", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name) VALUES ($1, 'Cedar Homes Invented')",
        [TASK],
      );
      for (const c of GOLDENS.cases) {
        const id = await respond(3, c.answers);
        const input = await one<Row>(
          "SELECT public.cockpit_form_stage4_input($1::uuid) AS r",
          [id],
        );
        const now = await one<Row[]>(
          "SELECT public.cockpit_form_stage4_build($1::jsonb) AS r",
          [json(input)],
        );
        const was = await one<Row[]>(
          "SELECT public.cockpit_form_stage4_build_p($1::jsonb) AS r",
          [json(input)],
        );
        const strip = (plan: Row[]) =>
          plan.map(e =>
            e.key === "read_model"
              ? {
                  ...e,
                  plan: {
                    ...e.plan,
                    entry: { ...e.plan.entry, structured: undefined },
                  },
                }
              : e,
          );
        expect(JSON.parse(json(strip(now)))).toEqual(JSON.parse(json(was)));
        const entry = now.find(e => e.key === "read_model")?.plan.entry;
        expect([c.name, entry.structured, entry.answers]).toEqual([
          c.name,
          c.structured,
          c.printed,
        ]);
        for (const k of CONTACT) expect(entry.structured).not.toHaveProperty(k);
      }
      const v2 = {
        fullName: "Invented Owner",
        businessName: "Cedar Homes Invented",
        appointmentTypes: ["office"],
        lastRevenue: 0,
      };
      const input2 = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1::uuid) AS r",
        [await respond(2, v2)],
      );
      expect(input2).not.toHaveProperty("structured");
      expect(
        await one("SELECT public.cockpit_form_stage4_build($1::jsonb) AS r", [
          json(input2),
        ]),
      ).toEqual(
        await one("SELECT public.cockpit_form_stage4_build_p($1::jsonb) AS r", [
          json(input2),
        ]),
      );
    });
  });

  test("Make 13's texts on the printed list equal the cockpit's, and make_parity reads the read model as intended: read_model, structured", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name) VALUES ($1, 'Cedar Homes Invented')",
        [TASK],
      );
      const cases: {
        id: string;
        task: string;
        answers: Answer[];
        readModel: Row;
      }[] = [];
      const cockpit: Record<string, Row> = {};
      for (const [n, c] of GOLDENS.cases.entries()) {
        const id = await respond(3, c.answers);
        const input = await one<Row>(
          "SELECT public.cockpit_form_stage4_input($1::uuid) AS r",
          [id],
        );
        const plan = Object.fromEntries(
          (
            await one<Row[]>(
              "SELECT public.cockpit_form_stage4_build($1::jsonb) AS r",
              [json(input)],
            )
          ).map(e => [e.key, e]),
        );
        cockpit[`c${n}`] = {
          raw: plan.raw_answers_comment?.plan.comment_text ?? null,
          profile:
            plan.profile_fields?.plan.fields.find(
              (f: Row) => f.fieldId === PROFILE_FIELD,
            )?.value ?? null,
          dispatch: plan.github_dispatch?.plan.payload.client,
        };
        cases.push({
          id: `c${n}`,
          task: TASK,
          answers: c.printed,
          readModel: plan.read_model,
        });
      }
      const make = evaluate(cases);
      for (const c of cases) {
        expect([c.id, cockpit[c.id].raw]).toEqual([c.id, make[c.id].raw]);
        expect([c.id, cockpit[c.id].profile]).toEqual([
          c.id,
          make[c.id].profile,
        ]);
        expect([c.id, cockpit[c.id].dispatch]).toEqual([
          c.id,
          Object.values(make[c.id].dispatch).find(v => v !== TASK),
        ]);
        expect([c.id, make[c.id].readModel]).toEqual([
          c.id,
          "intended: read_model, structured",
        ]);
      }
    });
  });
});

// --- 2 and 8. The switch -------------------------------------------------------------------------------------------

describe("the switch (forms.client.schema_v2) and the version a client gets", () => {
  test("only on counts version 3; canary, off, anything else or no row keeps version 2", async () => {
    await rolledBack(async () => {
      expect(await clientVersion()).toBe(2);
      for (const [value, version] of [
        [{ state: "canary" }, 2],
        [{ state: "on" }, 3],
        [{ state: "maybe" }, 2],
        [{ state: true }, 2],
        ["on", 2],
        [{ state: "off" }, 2],
      ] as const) {
        await setting("forms.client.schema_v2", value);
        expect([value, await clientVersion()]).toEqual([value, version]);
      }
      await db.exec(
        "DELETE FROM public.cockpit_settings WHERE key = 'forms.client.schema_v2'",
      );
      expect([
        await clientVersion(),
        await one("SELECT public.cockpit_form_schema_v2_state() AS r"),
      ]).toEqual([2, "off"]);
      // Every other form keeps 20261102a's rule.
      expect(
        await one("SELECT public.cockpit_form_client_version('nps') AS r"),
      ).toBe(1);
      expect(
        await one("SELECT public.cockpit_form_structured_version('nps') AS r"),
      ).toBeNull();
      expect(
        await one(
          "SELECT public.cockpit_form_structured_version('onboarding') AS r",
        ),
      ).toBe(3);
    });
  });

  test("the switch refuses a missing actor or state, and on before a canary answer is stored; each change leaves its audit rows", async () => {
    await rolledBack(async () => {
      expect(await refusal(() => step(() => switchTo("on", " ")))).toEqual({
        code: "22023",
        message: "Say who switches the structured onboarding.",
      });
      expect(await refusal(() => step(() => switchTo("live")))).toEqual({
        code: "22023",
        message: "Say off, canary or on.",
      });
      expect(await refusal(() => step(() => switchTo("on")))).toEqual({
        code: "22023",
        message:
          "Version 3 opens to every client only after a canary answer on the test card 86eywg1cq is stored. Switch to canary first and answer it.",
      });
      expect(await switchTo("canary")).toEqual({
        state: "canary",
        before: "off",
        version: 3,
        issuing: 2,
        registry: "left as it was",
      });
      expect(await clientVersion()).toBe(2);
      // A canary answer on the test card, stored on version 3 (another card's answer does not count).
      await respond(3, GOLDENS.cases[0].answers, TASK);
      expect((await refusal(() => step(() => switchTo("on")))).code).toBe(
        "22023",
      );
      await respond(3, GOLDENS.cases[0].answers, TEST_CARD);
      expect(await switchTo("on")).toEqual({
        state: "on",
        before: "canary",
        version: 3,
        issuing: 3,
        registry: "left as it was",
      });
      expect(await clientVersion()).toBe(3);
      expect(await switchTo("off")).toEqual({
        state: "off",
        before: "on",
        version: 3,
        issuing: 2,
        registry: "left as it was",
      });
      // One row per change (the audit log's ids are not in time order, so the rows are compared sorted).
      const sorted = (rows: unknown[][]) =>
        rows.map(r => JSON.stringify(r)).sort();
      expect(
        sorted(
          (await auditRows("forms.schema_v2_switch")).map(r => [
            r.actor_email,
            r.before.state,
            r.after.state,
            r.metadata.issuing,
          ]),
        ),
      ).toEqual(
        sorted([
          ["the tech lead", "off", "canary", 2],
          ["the tech lead", "canary", "on", 3],
          ["the tech lead", "on", "off", 2],
        ]),
      );
      expect(
        sorted(
          (await auditRows("forms.switch_set"))
            .filter(r => r.entity_id === "forms.client.schema_v2")
            .map(r => [r.after.value.state]),
        ),
      ).toEqual(sorted([["canary"], ["on"], ["off"]]));
    });
  });

  test("a structured version that fails its checks cannot open; off always can", async () => {
    await rolledBack(async () => {
      await db.exec(
        "UPDATE public.cockpit_form_versions SET schema = jsonb_set(schema, '{minutes}', '90') WHERE form_key = 'onboarding' AND version = 3",
      );
      expect(await refusal(() => step(() => switchTo("canary")))).toEqual({
        code: "22023",
        message:
          "Version 3 cannot open: Minutes must be a whole number from 1 to 60.",
      });
      expect((await switchTo("off")).state).toBe("off");
    });
  });

  test("once the onboarding is native, the registry's copy follows the version clients get, with its audit row", async () => {
    await rolledBack(async () => {
      await db.exec(`UPDATE public.cockpit_forms f SET provider = 'native', version = 2, schema = v.schema
                       FROM public.cockpit_form_versions v WHERE f.key = 'onboarding' AND v.form_key = 'onboarding' AND v.version = 2`);
      await respond(3, GOLDENS.cases[0].answers, TEST_CARD);
      expect((await switchTo("canary")).registry).toBe("left as it was");
      expect((await switchTo("on")).registry).toBe("updated");
      expect(
        await one(
          "SELECT jsonb_build_object('version', version, 'md5', md5(schema::text)) AS r FROM public.cockpit_forms WHERE key = 'onboarding'",
        ),
      ).toEqual({ version: 3, md5: V3_MD5 });
      expect((await switchTo("off")).registry).toBe("updated");
      expect(
        await one(
          "SELECT jsonb_build_object('version', version, 'md5', md5(schema::text)) AS r FROM public.cockpit_forms WHERE key = 'onboarding'",
        ),
      ).toEqual({ version: 2, md5: V2_B_MD5 });
      expect(
        (await auditRows("forms.schema_v2_registry"))
          .map(r => `${r.before.version}>${r.after.version}`)
          .sort(),
      ).toEqual(["2>3", "3>2"]);
    });
  });
});

// --- 4. The invites and the prefill --------------------------------------------------------------------------------

const issue = (
  task: string,
  origin: string,
  channels: string[],
  context: Row = {},
) =>
  one<Row>(
    `SELECT public.cockpit_form_invite_issue_core($1, 'onboarding', $2::text[], NULL, 'ar', false, $3::jsonb, gen_random_uuid(), $4,
       '{"id": null, "email": null, "role": "the tech lead", "source": "cockpit"}'::jsonb) AS r`,
    [task, `{${channels.join(",")}}`, json(context), origin],
  );
const inviteOf = (id: string) =>
  one<Row>(
    "SELECT jsonb_build_object('version', form_version, 'context', context, 'origin', origin) AS r FROM public.cockpit_form_invites WHERE id = $1::uuid",
    [id],
  );
const contextOf = (task: string) =>
  one<Row>("SELECT public.cockpit_form_onboarding_context($1) AS r", [task]);

describe("the invites: the version they get and the server-set prefill", () => {
  test("the prefill: the billing sheet's country, else the newest sale tied without a conflict, else nothing; QT and QA are Qatar", async () => {
    await rolledBack(async () => {
      for (const [country, currency, area] of [
        ["SA", "sar", "sa"],
        ["KW", "kwd", "kw"],
        ["AE", "aed", "ae"],
        ["QT", "qar", "qa"],
        ["BH", "bhd", "bh"],
        ["OM", "omr", "om"],
        [" kw ", "kwd", "kw"],
      ]) {
        await db.query(
          "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ('taskCtx1', 'Ctx Invented', $1)",
          [country],
        );
        expect([country, await contextOf("taskCtx1")]).toEqual([
          country,
          { currency, areaCountries: [area] },
        ]);
        await db.exec(
          "DELETE FROM public.cockpit_billing_accounts WHERE clickup_task_id = 'taskCtx1'",
        );
      }
      // No billing country: the newest sale tied to the card, Qatar written QA there.
      await db.exec(`INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ('taskCtx2', 'Ctx Two', NULL), ('taskCtx3', 'Ctx Three', 'US');
        INSERT INTO public.cockpit_sales_deals VALUES ('sale-old', 'SA', '2026-09-01T09:00:00Z'), ('sale-new', 'QA', '2026-10-01T09:00:00Z'),
          ('sale-conflict', 'KW', '2026-10-05T09:00:00Z');
        INSERT INTO public.test_deal_cards VALUES ('taskCtx2', 'sale-old', false), ('taskCtx2', 'sale-new', false),
          ('taskCtx3', 'sale-conflict', true), ('taskCtx4', 'sale-old', false);`);
      expect(await contextOf("taskCtx2")).toEqual({
        currency: "qar",
        areaCountries: ["qa"],
      });
      // A country the cockpit does not price in falls to the sale; a conflicted tie is never read.
      expect(await contextOf("taskCtx3")).toEqual({});
      expect(await contextOf("taskCtx4")).toEqual({
        currency: "sar",
        areaCountries: ["sa"],
      });
      expect(await contextOf("taskNobody")).toEqual({});
    });
  });

  test("off: the canary and every invite stay on version 2 with an empty context; the caller still sends no onboarding fact", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ($1, 'Test card', 'SA')",
        [TEST_CARD],
      );
      const canary = await issue(TEST_CARD, "canary", ["copy"]);
      expect(await inviteOf(canary.inviteId)).toEqual({
        version: 2,
        context: {},
        origin: "canary",
      });
      expect(
        await refusal(() =>
          step(() => issue(TASK, "canary", ["copy"], { currency: "kwd" })),
        ),
      ).toEqual({
        code: "22023",
        message: "The canary writes only the test card 86eywg1cq.",
      });
      await db.exec(
        "UPDATE public.cockpit_form_invites SET state = 'withdrawn'",
      );
      expect(
        await refusal(() =>
          step(() => issue(TEST_CARD, "canary", ["copy"], { currency: "kwd" })),
        ),
      ).toEqual({
        code: "22023",
        message: "The onboarding form does not take currency.",
      });
    });
  });

  test("canary: only the test card's canary opens version 3, with the prefill; a client's invite stays on version 2", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ($1, 'Test card', 'SA'), ($2, 'Cedar Homes Invented', 'KW')",
        [TEST_CARD, TASK],
      );
      await db.exec(`UPDATE public.cockpit_forms SET provider = 'native' WHERE key = 'onboarding';
        UPDATE public.cockpit_settings SET value = '{"live":["onboarding"],"presence":false}' WHERE key = 'forms.client';`);
      await setting("forms.client", { live: ["onboarding"], presence: false });
      await switchTo("canary");
      const canary = await issue(TEST_CARD, "canary", ["copy"]);
      expect(await inviteOf(canary.inviteId)).toEqual({
        version: 3,
        context: { currency: "sar", areaCountries: ["sa"] },
        origin: "canary",
      });
      const client = await issue(TASK, "csm", ["portal"]);
      expect(await inviteOf(client.inviteId)).toEqual({
        version: 2,
        context: {},
        origin: "csm",
      });
      await db.exec(
        "UPDATE public.cockpit_form_invites SET state = 'withdrawn'",
      );
      expect(
        await refusal(() =>
          step(() =>
            issue(TEST_CARD, "canary", ["copy"], { areaCountries: ["kw"] }),
          ),
        ),
      ).toEqual({
        code: "22023",
        message: "The onboarding form does not take areaCountries.",
      });
    });
  });

  test("on: new invites get version 3 with the prefill; an open version-2 invite keeps version 2; off sends new ones back", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ($1, 'Cedar Homes Invented', 'KW')",
        [TASK],
      );
      await db.exec(
        "UPDATE public.cockpit_forms SET provider = 'native' WHERE key = 'onboarding'",
      );
      await setting("forms.client", { live: ["onboarding"], presence: false });
      const before = await issue(TASK, "csm", ["portal"]);
      expect(await inviteOf(before.inviteId)).toEqual({
        version: 2,
        context: {},
        origin: "csm",
      });
      await respond(3, GOLDENS.cases[0].answers, TEST_CARD);
      await switchTo("canary");
      await switchTo("on");
      expect((await inviteOf(before.inviteId)).version).toBe(2);
      await db.exec(
        "UPDATE public.cockpit_form_invites SET state = 'withdrawn'",
      );
      const after = await issue(TASK, "csm", ["portal"]);
      expect(await inviteOf(after.inviteId)).toEqual({
        version: 3,
        context: { currency: "kwd", areaCountries: ["kw"] },
        origin: "csm",
      });
      await db.exec(
        "UPDATE public.cockpit_form_invites SET state = 'withdrawn'",
      );
      await switchTo("off");
      const back = await issue(TASK, "csm", ["portal"]);
      expect(await inviteOf(back.inviteId)).toEqual({
        version: 2,
        context: {},
        origin: "csm",
      });
    });
  });
});

// --- 4b. The prefill reaches the client: the portal's two reads of an invite ------------------------------------

const NET = "a".repeat(64);
/** A copy link on an invite (only its hash is kept), opened as the link page opens it. */
const linkOpen = async (invite: string, digit: string) => {
  await db.query(
    "INSERT INTO public.cockpit_form_invite_tokens(invite_id, channel, token_sha256, made_by) VALUES ($1::uuid, 'copy', $2, 'the tech lead')",
    [invite, digit.repeat(64)],
  );
  return one<Row>("SELECT public.portal_form_token_open($1, $2, NULL) AS r", [
    digit.repeat(64),
    NET,
  ]);
};
/** The invite as the signed-in portal page reads it (an invented client person). */
const portalGet = (invite: string) =>
  one<Row>(
    "SELECT public.portal_form_get('locInvented1', $1, 'owner@cedar.example', 'admin', $2::uuid) AS r",
    [TASK, invite],
  );
/** What the client gets of an invite's context, beside what 20261102a's body gives the same row. */
const contextPair = (invite: string) =>
  one<Row>(
    `SELECT jsonb_build_object('now', public.cockpit_form_client_context(i), 'was', public.cockpit_form_client_context_a(i)) AS r
       FROM public.cockpit_form_invites i WHERE i.id = $1::uuid`,
    [invite],
  );

describe("the prefill reaches the client (portal_form_token_open, portal_form_get)", () => {
  test("canary: the canary's link page gets version 3 with currency and areaCountries; a version-2 invite still gets nothing", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ($1, 'Test card', 'KW'), ($2, 'Cedar Homes Invented', 'SA')",
        [TEST_CARD, TASK],
      );
      await db.exec(
        "UPDATE public.cockpit_forms SET provider = 'native' WHERE key = 'onboarding'",
      );
      await setting("forms.client", { live: ["onboarding"], presence: false });
      await switchTo("canary");
      const canary = await issue(TEST_CARD, "canary", ["copy"]);
      const opened = await linkOpen(canary.inviteId, "1");
      expect([opened.ok, opened.invite.version, opened.invite.context]).toEqual(
        [true, 3, { currency: "kwd", areaCountries: ["kw"] }],
      );
      // A client's invite stays on version 2: nothing of the prefill, even if its row held those keys.
      const client = await issue(TASK, "csm", ["portal"]);
      await db.query(
        `UPDATE public.cockpit_form_invites SET context = '{"currency":"sar","areaCountries":["sa"],"callId":"call-1"}'::jsonb
          WHERE id = $1::uuid`,
        [client.inviteId],
      );
      const got = await portalGet(client.inviteId);
      expect([got.invite.version, got.invite.context]).toEqual([2, {}]);
      expect((await linkOpen(client.inviteId, "2")).invite.context).toEqual({});
      expect(await contextPair(client.inviteId)).toEqual({ now: {}, was: {} });
    });
  });

  test("on: the portal page and the link page give a version-3 invite its prefill and nothing else; an open version-2 invite and every other form read as 20261102a's", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, country) VALUES ($1, 'Cedar Homes Invented', 'KW')",
        [TASK],
      );
      await db.exec(
        "UPDATE public.cockpit_forms SET provider = 'native' WHERE key = 'onboarding'",
      );
      await setting("forms.client", { live: ["onboarding"], presence: false });
      const before = await issue(TASK, "csm", ["portal"]);
      await respond(3, GOLDENS.cases[0].answers, TEST_CARD);
      await switchTo("canary");
      await switchTo("on");
      // The version-2 invite issued before the switch keeps version 2 and its empty context.
      expect((await portalGet(before.inviteId)).invite.context).toEqual({});
      await db.exec(
        "UPDATE public.cockpit_form_invites SET state = 'withdrawn'",
      );
      const after = await issue(TASK, "csm", ["portal"]);
      // Anything else the cockpit keeps on the invite stays in the cockpit.
      await db.query(
        `UPDATE public.cockpit_form_invites SET context = context || '{"callId":"call-1"}'::jsonb WHERE id = $1::uuid`,
        [after.inviteId],
      );
      const got = await portalGet(after.inviteId);
      expect([got.invite.version, got.invite.context]).toEqual([
        3,
        { currency: "kwd", areaCountries: ["kw"] },
      ]);
      const opened = await linkOpen(after.inviteId, "3");
      expect([opened.ok, opened.invite.version, opened.invite.context]).toEqual(
        [true, 3, { currency: "kwd", areaCountries: ["kw"] }],
      );
      expect(await contextPair(after.inviteId)).toEqual({
        now: { currency: "kwd", areaCountries: ["kw"] },
        was: {},
      });
      // Every other form: exactly 20261102a's (its declared facts, over14), the prefill keys never passed.
      const nps = await one<string>(
        `INSERT INTO public.cockpit_form_invites(task_id, form_key, form_version, context, channels, audience, origin, expires_at)
         VALUES ($1, 'nps', 1, '{"over14":true,"currency":"kwd","areaCountries":["kw"],"callId":"call-1"}'::jsonb, '{copy}', 'any',
                 'csm', now() + interval '14 days')
         RETURNING id::text AS r`,
        [TASK],
      );
      const pair = await contextPair(nps);
      expect(pair.now).toEqual(pair.was);
      expect(pair.now).toEqual({ over14: true });
      const v2 = await one<string>(
        `INSERT INTO public.cockpit_form_invites(task_id, form_key, form_version, context, channels, audience, origin, expires_at)
         VALUES ($1, 'onboarding', 2, '{"over14":false,"currency":"kwd","areaCountries":["kw"]}'::jsonb, '{copy}', 'any', 'csm',
                 now() + interval '14 days')
         RETURNING id::text AS r`,
        [TASK],
      );
      expect(await contextPair(v2)).toEqual({
        now: { over14: false },
        was: { over14: false },
      });
    });
  });
});

// --- 5. The Typeform door ------------------------------------------------------------------------------------------

describe("the Typeform door (X26)", () => {
  test("with version 3 open to every client, a KFRCXPFx delivery is still stored on version 2, mapped as before", async () => {
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage_group) VALUES ($1, 'Cedar Homes Invented', 'pipeline')",
        [TASK],
      );
      await respond(3, GOLDENS.cases[0].answers, TEST_CARD);
      await switchTo("canary");
      await switchTo("on");
      expect(await clientVersion()).toBe(3);
      const fields = [
        {
          ref: R.businessName,
          title: "Business Name",
          value: "Cedar Homes Invented",
        },
        {
          ref: R.facebookAds,
          title: "Meta",
          value: "My Account is restricted | حسابي مقيّد",
        },
        { ref: R.lastRevenue, title: "Revenue", value: "250000" },
      ];
      const out = await one<Row>(
        "SELECT public.cockpit_form_onboarding_typeform($1::jsonb) AS r",
        [
          json({
            formKey: "onboarding",
            externalId: "tokDoorV3pin01",
            submittedAt: "2026-11-03T09:00:00Z",
            answers: { fields },
            hidden: { onboarding_client_id: TASK },
            taskId: TASK,
          }),
        ],
      );
      expect(out).toMatchObject({
        inserted: true,
        stored: "native",
        taskId: TASK,
      });
      expect(
        await one(
          "SELECT jsonb_build_object('version', form_version, 'answers', answers) AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
          [out.responseId],
        ),
      ).toEqual({
        version: 2,
        answers: {
          businessName: "Cedar Homes Invented",
          facebookAds: "restricted",
          lastRevenue: 250000,
        },
      });
    });
  });
});

// --- 7. The forms editor -------------------------------------------------------------------------------------------

const seat = (who: Row | null) =>
  db.query("SELECT set_config('test.seat', $1, false)", [who ? json(who) : ""]);
const CEO_SEAT = { ceo: true, admin: false, email: "ceo@invented.invalid" };

describe("the forms editor: the structured onboarding is read only, on the server", () => {
  test("the onboarding reads read only with its sentence while its newest version is structured; other forms are as before", async () => {
    const kind = (key: string) =>
      one<Row>(
        "SELECT public.cockpit_form_editor_kind(f) AS r FROM public.cockpit_forms f WHERE f.key = $1",
        [key],
      );
    expect(await kind("onboarding")).toEqual({
      group: "client",
      editable: false,
      why: READ_ONLY,
    });
    expect(await kind("nps")).toEqual({
      group: "client",
      editable: true,
      why: null,
    });
    await rolledBack(async () => {
      // Before this file, the editor offered the onboarding's version 2 for editing.
      await db.exec(
        "DELETE FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 3",
      );
      expect(await kind("onboarding")).toEqual({
        group: "client",
        editable: true,
        why: null,
      });
    });
  });

  test("draft, publish and go back refuse with the sentence, whoever asks", async () => {
    await rolledBack(async () => {
      await seat(CEO_SEAT);
      const v2 = await one<Row>(
        "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
      );
      const versions = () =>
        one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding'",
        );
      const held = await versions();
      for (const [what, sql, params] of [
        [
          "draft",
          "SELECT public.cockpit_form_draft_save('onboarding', $1::jsonb, 2) AS r",
          [json({ ...v2, minutes: 26 })],
        ],
        [
          "publish",
          "SELECT public.cockpit_form_publish('onboarding', 'A small change', 2) AS r",
          [],
        ],
        [
          "go back",
          "SELECT public.cockpit_form_restore('onboarding', 2, NULL) AS r",
          [],
        ],
      ] as const)
        expect([
          what,
          await refusal(() => step(() => db.query(sql, params as unknown[]))),
        ]).toEqual([what, { code: "22023", message: READ_ONLY }]);
      expect(await versions()).toBe(held);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_form_schema_drafts",
        ),
      ).toBe(0);
      await seat(null);
    });
  });

  test("the editor reads the structured version, admin or CEO only; a version-1 form has none", async () => {
    await rolledBack(async () => {
      await seat(null);
      expect(
        await refusal(() =>
          step(() =>
            one(
              "SELECT public.cockpit_form_editor_structured('onboarding') AS r",
            ),
          ),
        ),
      ).toEqual({
        code: "42501",
        message: "Only an admin or the CEO edits forms.",
      });
      await seat({ ceo: false, admin: true, email: "admin@invented.invalid" });
      const out = await one<Row>(
        "SELECT public.cockpit_form_editor_structured('onboarding') AS r",
      );
      expect({ ...out, schema: null, publishedAt: null }).toEqual({
        version: 3,
        schema: null,
        publishedAt: null,
        publishedBy: "a migration",
        note: "The structured onboarding (client form schema version 2), stored and not live: forms.client.schema_v2 opens it.",
        state: "off",
        issuing: 2,
        answers: 0,
        openInvites: 0,
      });
      expect(out.schema).toEqual(await v3Schema());
      expect(
        await one("SELECT public.cockpit_form_editor_structured('nps') AS r"),
      ).toBeNull();
      await seat(null);
    });
  });
});
