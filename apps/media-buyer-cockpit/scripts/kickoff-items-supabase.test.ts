/**
 * Kickoff items as requests, a Yes or No for the CSM (20261103d_kickoff_items.sql; the CEO's CEO-7, the
 * next-design plan's build B4, docs/forms/WAVE56-CONTRACT.md 4.20), on an isolated PostgreSQL with Supabase's
 * default privileges on, so a missing REVOKE opens an object here as it would in production.
 *
 * It stands on the requests build as it is live (20261026r, its seed 20261026s and 20261029p's send gate, applied
 * whole, as request-held-gate-supabase.test.ts applies them) and on the Stage 4 bodies the file reads, cut from
 * their canonical migrations: the kickoff seat rule, the timestamp and text readers (20261102j), the kickoff's
 * questions and the answers mapper (20261102o), the form seat (20261027f), the CSM client gate (20261006c), the
 * owner rule (20260927a), the role labels (20261025n) and the settings audit trigger (20261101p). The first test
 * proves each of those bodies is the live one: its white-space-folded prosrc md5 equals the md5 read live,
 * read only, on 2026-11-03. cockpit_form_responses is a stand-in with the columns the file reads.
 *
 * Covered: the guard (prerequisites, the submit's signature and source); two applies; grants and row security;
 * delete and truncate refused; the gate; the item mapping (exact options only, typed text never, the off items);
 * the switch and its audit, failing closed (a missing row or an on that is not a list turns every item off and is a
 * doctor problem); the window; the one-tap raise through the real submit (one request, its part, its
 * queue row, request.submitted and kickoff_item.raised; details only where the type asks; the type's due day and
 * priority); retry (its answer carries submit, held or not, as the submit's own retry) and a second press; an open request of the type (already_open, nothing written, then Count
 * it); No, Raise it after all, and No on a raised item refused; a cancelled or failed request reopening the item;
 * a type turned off and a type the kickoff cannot fill; Change it first counted as form; Today for each seat;
 * the native fallback; the doctor and its view; no client name in an audit row.
 * Every seat, client, card and answer is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const P29 = "20261029p_requests_held_for_every_seat.sql";
const J = "20261102j_stage4_native.sql";
const O = "20261102o_stage4_match_make.sql";
const D = "20261103d_kickoff_items.sql";

/** md5(white-space-folded prosrc) of every body this file calls or this test stands on, read live 2026-11-03. */
const LIVE: Record<string, string> = {
  "cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)": "b85da715750d58340dbc11442716e909",
  "cockpit_request_preview(text,text,jsonb)": "26ecb34d8bd836b25b1efd91b8018cec",
  "cockpit_request_may_open(cockpit_requests,jsonb)": "c340f09b8e1fad07b0a34b387d166851",
  "cockpit_request_row(cockpit_requests,jsonb)": "1249b7908d2b2a718bb0877351695884",
  "cockpit_request_seat()": "462314752b48429c92b046a5e8cf5dc6",
  "cockpit_request_due_default(integer)": "081cb8e185d7a738b421c821a4ed58b2",
  "cockpit_request_audit(text,text,text,text,jsonb,jsonb,jsonb)": "5b29444d3e660642b7d1848bc714f8e7",
  "cockpit_request_send_gate(jsonb,text)": "544eddad889f22cca30f203b4b2d8346",
  "cockpit_request_held(cockpit_requests)": "76956dbc25fe00fe5cb07690bb9f0fc2",
  "cockpit_request_plan(cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)": "2a789f5d13a8476defa5e23476992642",
  "cockpit_request_owner(jsonb,text)": "cec7133ac7efdb5331e4c4bc22435916",
  "cockpit_request_day_words(date)": "6c1afa7bf65ad5c2c1230eb4fa108e1c",
  "cockpit_clickup_requests_mode()": "b4ce4848c112c3ad3cf86817d0f4c626",
  "cockpit_kickoff_seat(text)": "fa32d5545129b919cc6d3c0e4605463a",
  "cockpit_form_actor()": "0a9096f4a85388a93f2f27b6b0283154",
  "cockpit_form_seat(uuid)": "68b716e56f448f084a98720ca533b2fb",
  "cockpit_form_stage4_fields(text)": "2b874cb1ed7fcf92a3d7fd9ca00547c5",
  "cockpit_form_stage4_typeform_answers(text,jsonb)": "c9ad150b861d72d497ccb6f3af16cf7e",
  "cockpit_form_stage4_text(jsonb)": "0be668ae76b51bf0549b53131498ea10",
  "cockpit_form_stage4_ts(text)": "9513099b155065b8f12f7d1a20dc064c",
  "cockpit_csm_client_gate(text)": "1ebce3b7ee79783fd85f09c1e97bd63e",
  "cockpit_csm_client_gate_for_actor(uuid,text)": "2bf272908c6cbf236ead2aa8516b6458",
  "cockpit_slack_notice_role_of(text)": "7653d91bc47b8e432a53cd04fdff06ea",
  "cockpit_ask_ai_owner_allowed(uuid,text,text)": "fd22984d6cd50705cabf5c454e2d52aa",
  "cockpit_client_allowed(text)": "d43fd0dd44416d7472c353c68631134d",
  "cockpit_settings_forms_audit()": "62e182efea828afc7b2fca393bf58b51",
  "cockpit_is_ceo()": "061efb941b998b18553dab8bf0dde722",
};
/** The three types as they are live (keys, kinds and required flags; read 2026-11-03). */
const LIVE_TYPES = {
  card_missing: { priority: "high", due: 1, fields: "client:client:true|deadline:deadline:true|priority:priority:false" },
  general_tech: { priority: "normal", due: 2, fields: "client:client:false|details:details:true|deadline:deadline:true|priority:priority:true" },
  whatsapp_connection: { priority: "high", due: 1, fields: "client:client:true|deadline:deadline:true|priority:priority:false" },
};

/** The CEO gate's own address (20260923m), so no address is written here. */
const CEO_EMAIL = (() => {
  const hit = migration("20260923m_cockpit_ceo_gate.sql").match(/IN \(\s*'([^']+@[^']+)'/);
  if (!hit) throw new Error("The CEO gate names no address");
  return hit[1];
})();

// Seats (invented).
const CEO = "00000000-0000-4000-8000-0000000000c3";
const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // CSM of Acme, Cedar, Elm and Fig
const CSM_B = "00000000-0000-4000-8000-0000000000a2"; // CSM of Beta only
const CSM_ALL = "00000000-0000-4000-8000-0000000000a3"; // a CSM with no client list (every client)
const ADMIN_CSM = "00000000-0000-4000-8000-0000000000a4"; // admin and csm
const ADMIN = "00000000-0000-4000-8000-0000000000d1"; // admin, the systems manager, no csm role
const FINANCE = "00000000-0000-4000-8000-0000000000b1";

// Cards (invented).
const ACME = "taskAcme1"; // in onboarding, Typeform kickoff 20 days ago: funded No, Mahara OS Tech Issue, WhatsApp Needs Integrating, training Need Tech Help
const BETA = "taskBeta1"; // launched, kickoff 3 days ago: funded No, WhatsApp Pending (an off item), Mahara OS Logged In
const CEDAR = "taskCedar1"; // launched, kickoff 40 days ago: funded No (outside the window)
const DUNE = "taskDune1"; // no onboarding row: a native kickoff 2 days ago sent by CSM_ALL
const ELM = "taskElm1"; // in onboarding, a kickoff stored without its answers
const FIG = "taskFig1"; // in onboarding, no kickoff
const GROVE = "taskGrove1"; // in onboarding, CSM no seat matches: unmatched

const NAMES: Record<string, string> = {
  [ACME]: "Acme Interiors",
  [BETA]: "Beta Build",
  [CEDAR]: "Cedar Homes",
  [DUNE]: "Dune Studio",
  [ELM]: "Elm Works",
  [FIG]: "Fig Design",
  [GROVE]: "Grove Living",
};

// The kickoff's refs (tG7dnxBn, as 20261102o lists them).
const REF = {
  funded: "8bee68fc-0764-41a8-b90a-db2a3f401e9d",
  maharaOs: "ad562fc2-6858-4e37-81c5-c4cc2375a330",
  whatsapp: "a813378f-06ce-499e-8f0e-14761b89b474",
  training: "c56a7e2d-6f18-4bf9-a9f6-11367eab4c11",
  facebook: "6fcbd33c-60e9-4df7-bfaa-e76b588dd887",
  calendarStatus: "b657c5a5-d199-42b5-8437-c8d04f78e376",
  contract: "c0000001-0000-4000-8000-00000000000a",
  adAccount: "e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728",
} as const;

let db: PGlite;
type Row = Record<string, any>;
type Refusal = { code: string; message: string };
let seq = 0;
const uid = () => `30000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const json = (v: unknown) => JSON.stringify(v);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
/** A function's whole CREATE, by its exact name and first argument text. */
function fnDef(sql: string, head: string, what: string): string {
  const start = sql.indexOf(head);
  if (start < 0) throw new Error(`Canonical definition missing: ${what}`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$;", open + 2);
  return sql.slice(start, close + 3);
}

/** Noon in Kuwait (09:00 UTC) on the Kuwait day n days ago, as the read model writes a time. */
function kuwaitNoon(daysAgo: number): string {
  const k = new Date(Date.now() + 3 * 3600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - daysAgo, 9, 0, 0))
    .toISOString()
    .replace(".000Z", "Z");
}

// --- Sessions ---------------------------------------------------------------------------------

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
let depth = 0;
/** Inside rolledBack each step runs under a savepoint, so an expected refusal leaves the transaction usable. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (depth) await db.exec("SAVEPOINT step");
  try {
    const out = await fn();
    if (depth) await db.exec("RELEASE SAVEPOINT step");
    return out;
  } catch (e) {
    if (depth) await db.exec("ROLLBACK TO SAVEPOINT step");
    throw e;
  } finally {
    await asOwner();
  }
}
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return guarded(async () => {
    await asOwner();
    return (await db.query<T>(text, params)).rows;
  });
}
async function ex(text: string): Promise<void> {
  await guarded(async () => {
    await asOwner();
    await db.exec(text);
  });
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0]?.r as T;
}
/** One value as a seat (its auth id), as anon (null) or as PostgREST with the service key. */
async function as<T = any>(who: string | null | "service", text: string, params: unknown[] = []): Promise<T> {
  return guarded(async () => {
    if (who === "service") {
      await asOwner();
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [json({ role: "service_role" })]);
      await db.exec("SET ROLE service_role");
    } else await actor(db, who);
    return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
  });
}
async function refusal(fn: () => Promise<unknown>): Promise<Refusal> {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error("Expected a refusal");
}
/** Runs as the owner inside a transaction that is always rolled back. */
async function rolledBack(fn: () => Promise<void>) {
  await asOwner();
  await db.exec("BEGIN");
  depth++;
  try {
    await fn();
  } finally {
    depth--;
    await db.exec("ROLLBACK");
    await asOwner();
  }
}

// --- The calls --------------------------------------------------------------------------------

const read = (who: string | null, task: string) =>
  as<Row>(who, "SELECT public.cockpit_kickoff_items_read($1) AS r", [task]);
const raise = (who: string, task: string, item: string, id: string | null = uid()) =>
  as<Row>(who, "SELECT public.cockpit_kickoff_item_raise($1,$2,$3::uuid) AS r", [task, item, id]);
const link = (who: string, task: string, item: string, id: string) =>
  as<Row>(who, "SELECT public.cockpit_kickoff_item_link($1,$2,$3::uuid) AS r", [task, item, id]);
const decline = (who: string, task: string, item: string, note: string | null = null) =>
  as<Row>(who, "SELECT public.cockpit_kickoff_item_decline($1,$2,$3) AS r", [task, item, note]);
const due = (who: string | null) => as<Row>(who, "SELECT public.cockpit_kickoff_items_due() AS r");
const doctor = () => as<Row>("service", "SELECT public.cockpit_kickoff_items_doctor() AS r");
const itemOf = (read: Row, item: string) => (read.items as Row[]).find(i => i.item === item);
const submitForm = (who: string, type: string, task: string, answers: Row = {}, id = uid()) =>
  as<Row>(
    who,
    "SELECT public.cockpit_request_submit($1::uuid,$2,$3,$4::jsonb,NULL,NULL,'client_page',NULL) AS r",
    [id, type, task, json(answers)],
  );
const requestOf = async (id: string) => (await q("SELECT * FROM public.cockpit_requests WHERE id = $1", [id]))[0];
const audits = (action: string) =>
  q("SELECT * FROM public.cockpit_audit_log WHERE action = $1 ORDER BY id", [action]);
const answerRow = async (task: string, item: string) =>
  (await q("SELECT * FROM public.cockpit_kickoff_item_answers WHERE task_id = $1 AND item = $2", [task, item]))[0];
const inTest = () => migration(D).replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
const fnMd5 = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );
/** Applies a file as the deploy does; a refusal rolls its transaction back. */
async function apply(file: string, text = migration(file)): Promise<string | null> {
  await asOwner();
  try {
    await db.exec(text);
    return null;
  } catch (e) {
    await db.exec("ROLLBACK");
    return (e as Error).message;
  }
}

// --- The ground -------------------------------------------------------------------------------

/** A read model answers list from {ref: value}. */
const answers = (byRef: Record<string, string>) =>
  Object.entries(byRef).map(([ref, value]) => ({ ref, title: "Stored title", value }));
const kickoffModel = (formId: string, responseId: string, daysAgo: number, byRef: Record<string, string> | null) => ({
  form_id: formId,
  response_id: responseId,
  submitted_at: kuwaitNoon(daysAgo),
  ...(byRef ? { answers: answers(byRef) } : {}),
});

async function ground() {
  // Tables the requests build and the gates read, as request-held-gate-supabase.test.ts cuts them.
  for (const [file, pattern, what] of [
    ["20260921e_tap_charges.sql", /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/, "sync state"],
    ["20261011c_csm_call_store.sql", /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/, "detail"],
    ["20260919b_people.sql", /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/, "people"],
    ["20260921b_people_schedule.sql", /alter table public\.cockpit_people\s+add column if not exists schedule jsonb;/, "schedule"],
    ["20261005a_client_onboarding.sql", /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/, "onboarding"],
    ["20261024a_brand_blueprints.sql", /CREATE TABLE IF NOT EXISTS public\.cockpit_blueprint_settings \([\s\S]*?\n\);/, "blueprint settings"],
    ["20260921a_cockpit_settings.sql", /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/, "settings"],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  const wb = migration("20261009f_clickup_writeback_native.sql");
  for (const [pattern, what] of [
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_config\([\s\S]*?\n\);/, "config"],
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/, "queue"],
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_runs\([\s\S]*?\n\);/, "runs"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/, "audit"],
    [/DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/, "insert trigger"],
    [/DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_state[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/, "state trigger"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_state\([\s\S]*?END \$\$;/, "state"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_claim\([\s\S]*?END \$\$;/, "claim"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_save\([\s\S]*?END \$\$;/, "save"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_begin\([\s\S]*?END \$\$;/, "begin"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_finish\([\s\S]*?END \$\$;/, "finish"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_idle\([\s\S]*?END \$\$;/, "idle"],
  ] as const)
    await db.exec(cut(wb, pattern, what));
  await db.exec(
    cut(
      migration("20261009j_billing_clickup_writeback.sql"),
      /ALTER TABLE public\.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;\nALTER TABLE[\s\S]*?\)\);/,
      "billing kind",
    ),
  );
  await db.exec(`
    CREATE TABLE public.cockpit_decisions (id bigint PRIMARY KEY);
    CREATE TABLE public.cockpit_media_native_records (id uuid PRIMARY KEY);
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_config ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_settings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue,
      public.cockpit_clickup_writeback_runs, public.cockpit_decisions, public.cockpit_media_native_records,
      public.cockpit_sync_state, public.cockpit_people, public.cockpit_client_onboarding, public.cockpit_blueprint_settings,
      public.cockpit_settings
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue,
      public.cockpit_clickup_writeback_runs, public.cockpit_sync_state TO service_role;
    GRANT ALL ON public.cockpit_settings TO service_role;`);

  // The settings audit trigger (20261101p's body, live).
  const money = migration("20261101p_money_acts.sql");
  await db.exec(fnDef(money, "CREATE OR REPLACE FUNCTION public.cockpit_settings_forms_audit()", "settings audit"));
  await db.exec(
    cut(
      money,
      /DROP TRIGGER IF EXISTS cockpit_settings_forms_audit ON public\.cockpit_settings;\nCREATE TRIGGER cockpit_settings_forms_audit[\s\S]*?EXECUTE FUNCTION public\.cockpit_settings_forms_audit\(\);/,
      "settings audit trigger",
    ),
  );

  // The client limit and the role labels (20261017b, 20261025n), as the requests build reads them.
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(cut(teamOnly, /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/, "team only"));
  await db.exec(
    cut(teamOnly, /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/, "client allowed"),
  );
  const stage1 = migration("20261025n_slack_notices.sql");
  for (const [pattern, what] of [
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_forms_editors \([\s\S]*?\n\);/, "forms editors"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_role_of\(p_email text\)[\s\S]*?END \$\$;/, "role_of"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_seat_label\(p_email text, p_name text\)[\s\S]*?END \$\$;/, "seat label"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_forms_editor_gate\(\)[\s\S]*?END \$\$;/, "editor gate"],
  ] as const)
    await db.exec(cut(stage1, pattern, what));

  // The client roster and the CSM client gate (20260927v, 20260927a, 20261006c).
  const roster = migration("20260927v_csm_read_models.sql");
  for (const [pattern, what] of [
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/, "source state"],
    [/INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/, "source state rows"],
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/, "csm sources"],
  ] as const)
    await db.exec(cut(roster, pattern, what));
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "owner allowed",
    ),
  );
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  for (const [pattern, what] of [
    [/CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/, "gate for actor"],
    [/CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/, "gate"],
    [
      /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
      "gate grants",
    ],
  ] as const)
    await db.exec(cut(gate, pattern, what));

  // The form seat (20261027f).
  const core = migration("20261027f_forms_core.sql");
  await db.exec(fnDef(core, "CREATE OR REPLACE FUNCTION public.cockpit_form_seat(p_actor uuid)", "form seat"));
  await db.exec(fnDef(core, "CREATE OR REPLACE FUNCTION public.cockpit_form_actor()", "form actor"));

  // cockpit_form_responses: a stand-in with the columns 20261103d reads (20261027f's names and CHECKs).
  await db.exec(`
    CREATE TABLE public.cockpit_form_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text NOT NULL, form_version integer NOT NULL,
      source text NOT NULL, external_id text, task_id text, client_name text,
      mode text NOT NULL CHECK (mode IN ('live','shadow')),
      state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','confirmed','legacy','void')),
      answers jsonb NOT NULL DEFAULT '{}'::jsonb, answer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text NOT NULL, created_by_id uuid, submitted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.cockpit_form_responses ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_form_responses FROM PUBLIC, anon, authenticated, service_role;`);

  // The Stage 4 readers 20261103d calls (20261102j, then 20261102o's replacements).
  const j = migration(J);
  await db.exec(fnDef(j, "CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_ts(p text)", "ts"));
  await db.exec(fnDef(j, "CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_text(p jsonb)", "text"));
  await db.exec(fnDef(j, "CREATE OR REPLACE FUNCTION public.cockpit_kickoff_seat(p_task_id text)", "kickoff seat"));
  const o = migration(O);
  await db.exec(fnDef(o, "CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_fields(p_form_key text)", "fields"));
  await db.exec(
    fnDef(o, "CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_typeform_answers(p_form_key text, p_answers jsonb)", "typeform answers"),
  );

  // Grants as live: these are the owner's only, but the client gates and the CEO flag.
  await db.exec(`
    ALTER TABLE public.cockpit_forms_editors ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_forms_editors, public.cockpit_csm_source_state, public.cockpit_csm_sources FROM anon, authenticated;
    REVOKE ALL ON FUNCTION public.cockpit_is_team_only(), public.cockpit_client_allowed(text), public.cockpit_slack_notice_role_of(text),
      public.cockpit_slack_notice_seat_label(text,text), public.cockpit_forms_editor_gate(), public.cockpit_ask_ai_owner_allowed(uuid,text,text),
      public.cockpit_form_seat(uuid), public.cockpit_form_actor(), public.cockpit_form_stage4_ts(text), public.cockpit_form_stage4_text(jsonb),
      public.cockpit_kickoff_seat(text), public.cockpit_form_stage4_fields(text), public.cockpit_form_stage4_typeform_answers(text,jsonb),
      public.cockpit_settings_forms_audit()
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ask_ai_owner_allowed(uuid,text,text) TO service_role;`);

  // The requests build as it is live.
  for (const file of [R, S, P29]) {
    const err = await apply(file);
    if (err) throw new Error(`${file}: ${err}`);
  }
}

async function seed() {
  // Seats.
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, CSM_A, "csm.a@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm.b@tests.invalid", ["csm"]);
  await member(db, CSM_ALL, "csm.all@tests.invalid", ["csm"]);
  await member(db, ADMIN_CSM, "lead@tests.invalid", ["admin", "csm"]);
  await member(db, ADMIN, "sm@tests.invalid", ["admin"]);
  await member(db, FINANCE, "finance@tests.invalid", ["finance"]);
  await db.query("UPDATE public.cockpit_members SET clients = $1 WHERE auth_user_id = $2", [["Acme Interiors", "Cedar Homes", "Elm Works", "Fig Design"], CSM_A]);
  await db.query("UPDATE public.cockpit_members SET clients = $1 WHERE auth_user_id = $2", [["Beta Build"], CSM_B]);
  // People by role, and the ClickUp members the owner rules read (invented ids).
  for (const [name, email, role] of [
    ["Noura Test", "csm.a@tests.invalid", "Client success manager"],
    ["Huda Test", "csm.b@tests.invalid", "Client success manager"],
    ["Sam Manager", "sm@tests.invalid", "Systems manager"],
  ])
    await db.query("INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')", [name, email, role]);
  for (const [id, username, email] of [
    [113459516, "Sam Manager", "sm@tests.invalid"],
    [700001, "Noura Test", "csm.a@tests.invalid"],
    [700002, "Huda Test", "csm.b@tests.invalid"],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_clickup_members(clickup_user_id, username, email, active, seen_at) VALUES($1,$2,$3,true,now())",
      [id, username, email],
    );
  // Cards.
  const cards: [string, boolean, string | null, Row | null][] = [
    [ACME, true, "Noura Test", { kickoff: kickoffModel("tG7dnxBn", "tokAcme01", 20, {
      [REF.funded]: "No", [REF.maharaOs]: "Tech Issue", [REF.whatsapp]: "Needs Integrating", [REF.training]: "Need Tech Help",
      [REF.contract]: "Signed", [REF.adAccount]: "Typed text: the card is not linked, call me",
    }) }],
    [BETA, false, "Huda Test", { kickoff: kickoffModel("tG7dnxBn", "tokBeta01", 3, {
      [REF.funded]: "No", [REF.whatsapp]: "Pending", [REF.maharaOs]: "Logged In",
    }) }],
    [CEDAR, false, "Noura Test", { kickoff: kickoffModel("BbJy6xg4", "tokCedar01", 40, { [REF.funded]: "No" }) }],
    [ELM, true, "Noura Test", { kickoff: kickoffModel("tG7dnxBn", "tokElm01", 5, null) }],
    [FIG, true, "Noura Test", {}],
    [GROVE, true, "Former Person", { kickoff: kickoffModel("tG7dnxBn", "tokGrove01", 6, {
      [REF.maharaOs]: "Didn't Receive Access", [REF.funded]: "Yes",
    }) }],
  ];
  for (const [task, inOnb, csm, forms] of cards)
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, in_onboarding, csm, forms) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [task, NAMES[task], inOnb ? "Onboarding Booked" : "Active", inOnb, csm, json(forms ?? {})],
    );
  // Dune has no onboarding row: a native kickoff, sent by CSM_ALL 2 days ago.
  await db.query(
    `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers,
       created_by, created_by_id, submitted_at)
     VALUES ('kickoff', 2, 'cockpit', 'req:dune', $1, 'Dune Studio', 'live', 'submitted', $2::jsonb, 'csm.all@tests.invalid', $3, $4)`,
    [DUNE, json({ cardLinked: "No", maharaOsAccess: "Didn't Receive Access", whatsappSynced: "Integrated" }), CSM_ALL, kuwaitNoon(2)],
  );
  // The client roster the CSM gate reads.
  const snap = "2026-11-01T08:00:00Z";
  for (const task of Object.keys(NAMES))
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [`c-${task}`, [NAMES[task]], json({ _id: `c-${task}`, taskId: task, name: NAMES[task], stage: "Active" }), snap],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready = true, row_count = $1, source_snapshot_at = $2 WHERE table_name = 'clients'",
    [Object.keys(NAMES).length, snap],
  );
  // The requests writer reports apply, so a request goes at once (as live, 2026-11-03).
  await db.query("SELECT public.cockpit_clickup_requests_state(true,'test','apply','{}'::text[],'{}'::jsonb)");
}

let groundMd5: Record<string, string> = {};
let applyOnce: string | null = "not run";
let applyTwice: string | null = "not run";

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await ground();
  await seed();
  for (const fn of Object.keys(LIVE)) groundMd5[fn] = await fnMd5(fn);
  applyOnce = await apply(D);
  applyTwice = await apply(D);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

// --- The tests --------------------------------------------------------------------------------

describe("20261103d on the live requests build and the Stage 4 readers", () => {
  test("the ground is the live database: every body this file calls has its live md5", () => {
    for (const [fn, want] of Object.entries(LIVE)) expect([fn, groundMd5[fn]]).toEqual([fn, want]);
  });

  test("the three types in the seed have the live shape (a second source for oneTap)", async () => {
    for (const [key, want] of Object.entries(LIVE_TYPES)) {
      const t = (await q("SELECT * FROM public.cockpit_request_types WHERE key = $1", [key]))[0];
      const fields = (t.fields as Row[]).map(f => `${f.key}:${f.kind}:${f.required === true}`).join("|");
      expect([key, t.priority, t.due_days, fields, t.enabled]).toEqual([key, want.priority, want.due, want.fields, true]);
      expect((t.targets as Row[]).every(g => g.when === null)).toBe(true);
    }
  });

  test("applies twice; the file's shape and its guard", async () => {
    expect(applyOnce).toBeNull();
    expect(applyTwice).toBeNull();
    const sql = migration(D);
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;")).toBe(true);
    expect(sql).toContain(LIVE["cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)"]);
    // It replaces no function that existed before it.
    const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)].map(m => m[1]);
    for (const name of created) expect([name, /^cockpit_kickoff_(item|request_item)/.test(name)]).toEqual([name, true]);
    for (const fn of Object.keys(LIVE)) expect(created).not.toContain(fn.slice(0, fn.indexOf("(")));
    // One setting row, seeded once.
    expect(await q("SELECT key, value FROM public.cockpit_settings WHERE key = 'forms.kickoff_items'")).toEqual([
      { key: "forms.kickoff_items", value: { on: ["funded_card", "mahara_os", "whatsapp_sync"] } },
    ]);
    const seeded = await audits("forms.switch_seeded");
    expect(seeded.map(a => [a.entity_id, a.actor_email])).toEqual([["forms.kickoff_items", "migration 20261103d"]]);
  });

  test("the guard: a submit without client_page, or without its 8 arguments, stops the file and changes nothing", async () => {
    await rolledBack(async () => {
      const def = fnDef(migration(R), "CREATE OR REPLACE FUNCTION public.cockpit_request_submit(", "submit");
      await q(def.replace("NOT IN ('requests_page','client_page')", "NOT IN ('requests_page')"));
      const r = await refusal(() => ex(inTest()));
      expect(r.code).toBe("55000");
      expect(r.message).toContain("cockpit_request_submit no longer has the 8 arguments");
    });
    await rolledBack(async () => {
      await q("ALTER FUNCTION public.cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text) RENAME TO cockpit_request_submit_old");
      const r = await refusal(() => ex(inTest()));
      expect(r.message).toContain("cockpit_request_submit no longer has the 8 arguments");
    });
    await rolledBack(async () => {
      await q("ALTER FUNCTION public.cockpit_kickoff_seat(text) RENAME TO cockpit_kickoff_seat_old");
      const r = await refusal(() => ex(inTest()));
      expect(r.message).toContain("before 20261103d");
    });
  });
});

describe("grants and row security", () => {
  test("the table: row security on, revoked from every role, SELECT for the service role only", async () => {
    const t = (await q(
      "SELECT relrowsecurity rls, relacl::text acl FROM pg_class WHERE oid = 'public.cockpit_kickoff_item_answers'::regclass",
    ))[0];
    expect(t.rls).toBe(true);
    expect(t.acl).toBe("{postgres=arwdDxtm/postgres,service_role=r/postgres}");
    for (const role of ["anon", "authenticated"])
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"])
        expect([role, priv, await one(`SELECT has_table_privilege('${role}','public.cockpit_kickoff_item_answers','${priv}') r`)]).toEqual([role, priv, false]);
    expect(await one("SELECT has_table_privilege('service_role','public.cockpit_kickoff_item_answers','SELECT') r")).toBe(true);
    for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
      expect(await one(`SELECT has_table_privilege('service_role','public.cockpit_kickoff_item_answers','${priv}') r`)).toBe(false);
    const v = "public.cockpit_kickoff_items_doctor_v";
    expect(await one(`SELECT has_table_privilege('service_role','${v}','SELECT') r`)).toBe(true);
    for (const role of ["anon", "authenticated"])
      expect(await one(`SELECT has_table_privilege('${role}','${v}','SELECT') r`)).toBe(false);
  });

  test("each function's grant: the five browser RPCs to authenticated, the doctor to the service role, the rest nobody", async () => {
    const rows = await q<Row>(
      `SELECT p.oid::regprocedure::text fn, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth, has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              p.prosecdef def, p.proconfig cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (p.proname LIKE 'cockpit_kickoff_item%' OR p.proname = 'cockpit_kickoff_request_items')
        ORDER BY 1`,
    );
    const browser = ["cockpit_kickoff_items_read(text)", "cockpit_kickoff_item_raise(text,text,uuid)",
      "cockpit_kickoff_item_link(text,text,uuid)", "cockpit_kickoff_item_decline(text,text,text)", "cockpit_kickoff_items_due()"];
    expect(rows.length).toBe(20);
    for (const r of rows) {
      expect([r.fn, r.def, r.cfg]).toEqual([r.fn, true, ['search_path=""']]);
      expect([r.fn, r.anon]).toEqual([r.fn, false]);
      expect([r.fn, r.auth]).toEqual([r.fn, browser.includes(r.fn)]);
      expect([r.fn, r.svc]).toEqual([r.fn, r.fn === "cockpit_kickoff_items_doctor()"]);
    }
  });

  test("delete and truncate are refused, even for the owner; anon and a browser seat cannot read the table", async () => {
    await rolledBack(async () => {
      await raise(CSM_A, ACME, "funded_card");
      const del = await refusal(() => q("DELETE FROM public.cockpit_kickoff_item_answers"));
      expect(del).toEqual({ code: "55000", message: "A kickoff item's answer is never deleted." });
      const tr = await refusal(() => q("TRUNCATE public.cockpit_kickoff_item_answers"));
      expect(tr.message).toBe("A kickoff item's answer is never deleted.");
      expect((await refusal(() => as(CSM_A, "SELECT count(*) r FROM public.cockpit_kickoff_item_answers"))).code).toBe("42501");
      expect(await as("service", "SELECT count(*)::int r FROM public.cockpit_kickoff_item_answers")).toBe(1);
    });
  });
});

describe("the gate: the CEO, or the client's CSM", () => {
  test("a seat that is not a CSM, a CSM without the client and anon are refused; the CEO and the CSM pass", async () => {
    for (const who of [FINANCE, ADMIN]) {
      const r = await refusal(() => read(who, ACME));
      expect(r).toEqual({ code: "42501", message: "Only the CEO or the client's CSM decides kickoff items." });
    }
    expect((await refusal(() => read(CSM_B, ACME))).code).toBe("42501");
    expect((await refusal(() => read(null, ACME))).code).toBe("42501");
    expect((await refusal(() => read(CSM_A, "bad id!"))).code).toBe("22023");
    for (const who of [CEO, CSM_A, CSM_ALL, ADMIN_CSM]) expect((await read(who, ACME)).items.length).toBeGreaterThan(0);
    // Every write is gated the same way.
    for (const call of [
      () => raise(CSM_B, ACME, "funded_card"),
      () => decline(FINANCE, ACME, "funded_card"),
      () => link(CSM_B, ACME, "funded_card", uid()),
    ])
      expect((await refusal(call)).code).toBe("42501");
    expect((await refusal(() => due(FINANCE))).message).toBe("Kickoff items are for the client success team.");
    expect((await refusal(() => due(ADMIN))).code).toBe("42501");
  });
});

describe("the items a kickoff leaves open", () => {
  const items = (byRef: Row) => one<Row[]>("SELECT public.cockpit_kickoff_request_items($1::jsonb) r", [json(byRef)]);

  test("only an exact option of the question counts; typed text and done answers never do", async () => {
    expect((await items({ [REF.funded]: "No" })).map(i => [i.item, i.typeKey, i.line])).toEqual([
      ["funded_card", "card_missing", "The card with funds is not linked to the ad account."],
    ]);
    expect(await items({ [REF.funded]: "Yes" })).toEqual([]);
    expect(await items({ [REF.funded]: "no" })).toEqual([]);
    expect(await items({ [REF.funded]: "false" })).toEqual([]);
    expect(await items({ [REF.funded]: "No, the card bounced" })).toEqual([]);
    for (const v of ["Logged In", "Doesn't Want To"]) expect(await items({ [REF.maharaOs]: v })).toEqual([]);
    for (const v of ["Tech Issue", "Didn't Receive Access"])
      expect((await items({ [REF.maharaOs]: ` ${v} ` })).map(i => [i.item, i.value, i.line])).toEqual([
        ["mahara_os", v, `Mahara OS access: ${v}.`],
      ]);
    expect((await items({ [REF.whatsapp]: "Needs Integrating" }))[0].item).toBe("whatsapp_sync");
    // The off items are found here; the switch keeps them out of every screen.
    expect((await items({ [REF.whatsapp]: "Pending" })).map(i => [i.item, i.defaultOn])).toEqual([["whatsapp_pending", false]]);
    expect((await items({ [REF.training]: "Need Tech Help", [REF.facebook]: "Need Tech Help", [REF.calendarStatus]: "Needs Integrating" }))
      .map(i => [i.item, i.typeKey])).toEqual([
      ["training_access", "general_tech"], ["facebook_access", "general_marketing"], ["calendar", "general_tech"],
    ]);
    // An option label the question no longer has is never offered (the doctor names it).
    expect(await items({ [REF.whatsapp]: "Needs Integration" })).toEqual([]);
  });

  test("the read shows the three items on, never typed text, and an off item stays out", async () => {
    const r = await read(CSM_A, ACME);
    expect(r.items.map((i: Row) => [i.item, i.state, i.value])).toEqual([
      ["funded_card", "open", "No"],
      ["mahara_os", "open", "Tech Issue"],
      ["whatsapp_sync", "open", "Needs Integrating"],
    ]);
    expect(JSON.stringify(r)).not.toContain("Typed text");
    expect(r.kickoff).toMatchObject({ formId: "tG7dnxBn", ref: "tokAcme01", source: "read_model", answered: true, inOnboarding: true });
    expect(r.inWindow).toBe(true);
    expect(r.reason).toBeNull();
    const b = await read(CSM_B, BETA);
    expect(b.items.map((i: Row) => i.item)).toEqual(["funded_card"]);
  });

  test("the details sentence is fixed: the option and the kickoff's Kuwait day are its only variable parts", async () => {
    const r = await read(CSM_A, ACME);
    const day = await one<string>("SELECT public.cockpit_request_day_words(($1::timestamptz AT TIME ZONE 'Asia/Kuwait')::date) r", [kuwaitNoon(20)]);
    expect(itemOf(r, "mahara_os")!.details).toBe(
      `Raised from the kickoff on ${day}: Mahara OS access is Tech Issue. Get the client logged in to Mahara OS, then tell their CSM.`,
    );
    // card_missing and whatsapp_connection ask no details question, so nothing is sent with them.
    expect(itemOf(r, "funded_card")!.details).toBeNull();
    expect(itemOf(r, "whatsapp_sync")!.details).toBeNull();
    expect(r.kickoff.day).toBe(day);
  });

  test("the switch turns an item on and off with an audit row; {} stops the feature and decisions stay", async () => {
    await rolledBack(async () => {
      expect(await one("SELECT public.cockpit_kickoff_items_switch(ARRAY['funded_card','training_access'], 'the systems manager') r"))
        .toEqual({ on: ["funded_card", "training_access"] });
      expect((await read(CSM_A, ACME)).items.map((i: Row) => i.item)).toEqual(["funded_card", "training_access"]);
      const set = await audits("forms.switch_set");
      expect(set.map(a => [a.entity_id, a.actor_email, a.after])).toEqual([
        ["forms.kickoff_items", "the systems manager", { value: { on: ["funded_card", "training_access"] } }],
      ]);
      expect((await refusal(() => q("SELECT public.cockpit_kickoff_items_switch(ARRAY['nope'], 'x')"))).message)
        .toContain("nope is not a kickoff item");
      expect((await refusal(() => q("SELECT public.cockpit_kickoff_items_switch(ARRAY['funded_card'], ' ')"))).code).toBe("22023");
      await decline(CSM_A, ACME, "funded_card");
      await q("SELECT public.cockpit_kickoff_items_switch('{}'::text[], 'the systems manager')");
      const r = await read(CSM_A, ACME);
      expect(r.items.map((i: Row) => [i.item, i.state])).toEqual([["funded_card", "declined"]]);
      // The switch is the owner's only.
      expect((await refusal(() => as(CEO, "SELECT public.cockpit_kickoff_items_switch(ARRAY['calendar'], 'x') r"))).code).toBe("42501");
    });
  });
});

describe("the window", () => {
  test("in onboarding, or a kickoff 14 or fewer Kuwait days ago; a launched card's old kickoff offers nothing", async () => {
    // Acme's kickoff is 20 days old, but the card is in onboarding.
    expect((await read(CSM_A, ACME)).items.length).toBe(3);
    // Beta is launched, its kickoff 3 days old.
    expect((await read(CSM_B, BETA)).inWindow).toBe(true);
    // Cedar is launched, its kickoff 40 days old.
    const c = await read(CSM_A, CEDAR);
    expect([c.inWindow, c.items, c.reason, c.note]).toEqual([false, [], "closed",
      "Kickoff items show while the client is in onboarding, or for 14 days after the kickoff."]);
    await rolledBack(async () => {
      for (const [days, offered] of [[14, true], [15, false]] as const) {
        await q("UPDATE public.cockpit_client_onboarding SET forms = jsonb_set(forms, '{kickoff,submitted_at}', to_jsonb($1::text)) WHERE clickup_task_id = $2",
          [kuwaitNoon(days), BETA]);
        expect([days, (await read(CSM_B, BETA)).items.length > 0]).toEqual([days, offered]);
      }
    });
  });

  test("no stored answers, no kickoff, and the native fallback for a card with no onboarding row", async () => {
    const e = await read(CSM_A, ELM);
    expect([e.reason, e.items]).toEqual(["no_answers", []]);
    expect(e.note).toBe("The kickoff's answers are not in the cockpit, so its open items cannot show here. They are in the card's Kickoff Handoff comment.");
    const f = await read(CSM_A, FIG);
    expect([f.reason, f.kickoff, f.note]).toEqual(["no_kickoff", null, "No kickoff is stored for this client yet."]);
    const d = await read(CSM_ALL, DUNE);
    expect(d.kickoff).toMatchObject({ source: "native", formId: "native", answered: true, inOnboarding: false });
    expect(d.items.map((i: Row) => [i.item, i.value, i.state])).toEqual([
      ["funded_card", "No", "open"], ["mahara_os", "Didn't Receive Access", "open"],
    ]);
    // Not on the requests' client list (no onboarding row): only a No can be recorded, and the row says why.
    const blocked = "This client is not on the cockpit's client list yet, so a request cannot be raised for it here. Raise it in ClickUp.";
    for (const i of d.items) expect([i.blocked, i.actions, i.route]).toEqual([blocked, { raise: false, decline: true, link: false }, null]);
    expect(await refusal(() => raise(CSM_ALL, DUNE, "funded_card"))).toEqual({ code: "55000", message: blocked });
    await rolledBack(async () => {
      expect((await decline(CSM_ALL, DUNE, "funded_card")).item.state).toBe("declined");
    });
    // A Typeform sync pointer row (version 1, three keys) is never read as a native kickoff.
    await rolledBack(async () => {
      await q(`INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
                 answers, created_by, submitted_at)
               VALUES ('kickoff', 1, 'typeform_sync', 'tokElmPointer', $1, 'Elm Works', 'live', 'submitted',
                 '{"form_id":"tG7dnxBn","response_id":"tokElm01","cardLinked":"No"}'::jsonb, 'import', now())`, [ELM]);
      const e2 = await read(CSM_A, ELM);
      expect([e2.reason, e2.kickoff.source, e2.kickoff.formId, e2.items]).toEqual(["no_answers", "read_model", "tG7dnxBn", []]);
    });
  });
});

describe("Yes: one tap through the unchanged submit", () => {
  test("one request with its part and queue row, request.submitted and kickoff_item.raised; the type's due day and priority", async () => {
    await rolledBack(async () => {
      const before = await read(CSM_A, ACME);
      const id = uid();
      const res = await raise(CSM_A, ACME, "funded_card", id);
      expect(res).toMatchObject({ ok: true, raised: true, reused: false, submit: { id, state: "sending", held: false } });
      expect(res.item).toMatchObject({ item: "funded_card", state: "raised", offered: false,
        decision: { answer: "raised", how: "one_tap", byLabel: "the CSM", mine: true },
        request: { id, state: "sending", typeLabel: "Card missing for ads", mayOpen: true } });
      const r = await requestOf(id);
      const t = (await q("SELECT * FROM public.cockpit_request_types WHERE key = 'card_missing'"))[0];
      expect(r).toMatchObject({ type_key: "card_missing", source: "client_page", client_task_id: ACME, client_name: "Acme Interiors",
        priority: t.priority, answers: {} });
      expect(r.due_on).toEqual((await q("SELECT public.cockpit_request_due_default($1) d", [t.due_days]))[0].d);
      const parts = await q("SELECT * FROM public.cockpit_request_parts WHERE request_id = $1", [id]);
      expect(parts.map(p => [p.part, p.team, p.owner_label, p.state])).toEqual([["main", "client_success", "the CSM", "queued"]]);
      const queue = await q("SELECT * FROM public.cockpit_clickup_writeback_queue WHERE source_id = $1", [id]);
      expect(queue.map(x => [x.kind, x.state, x.payload.typeKey, x.payload.clientTaskId])).toEqual([["request", "queued", "card_missing", ACME]]);
      expect((await audits("request.submitted")).map(a => a.entity_id)).toEqual([id]);
      const raised = await audits("kickoff_item.raised");
      expect(raised.map(a => [a.entity_type, a.entity_id, a.actor_email, a.before, a.metadata])).toEqual([[
        "cockpit_kickoff_item_answers", `${ACME}:funded_card`, "csm.a@tests.invalid", null,
        { item: "funded_card", type: "card_missing", requestId: id, kickoffRef: "tokAcme01", value: "No", how: "one_tap", again: false },
      ]]);
      expect(raised[0].source_app).toBe("shared-cockpits");
      expect(await answerRow(ACME, "funded_card")).toMatchObject({ answer: "raised", request_id: id, how: "one_tap", type_key: "card_missing",
        kickoff_ref: "tokAcme01", kickoff_value: "No", decided_by_email: "csm.a@tests.invalid", decided_by_label: "the CSM", note: null });
      // The route the row showed before the press is where it went.
      expect(itemOf(before, "funded_card")!.route).toMatchObject({ teamLabel: "Client Success", ownerLabel: "the CSM",
        priority: "high", dueDefault: (await one("SELECT to_char(public.cockpit_request_due_default(1),'YYYY-MM-DD') r")),
        writer: { canSend: true, held: false } });
      // A read afterwards shows the receipt.
      expect(itemOf(await read(CSM_A, ACME), "funded_card")!.state).toBe("raised");
    });
  });

  test("details go only where the type asks for them; an optional details question added in Requests settings gets the sentence", async () => {
    await rolledBack(async () => {
      const id = uid();
      await raise(CSM_A, ACME, "mahara_os", id);
      const r = await requestOf(id);
      const expected = itemOf(await read(CSM_A, ACME), "mahara_os")!.details;
      expect([r.type_key, r.priority, Object.keys(r.answers)]).toEqual(["general_tech", "normal", ["details"]]);
      expect(r.answers.details).toBe(expected);
      const parts = await q("SELECT owner_label, team FROM public.cockpit_request_parts WHERE request_id = $1", [id]);
      expect(parts).toEqual([{ owner_label: "the systems manager", team: "tech" }]);
      // The systems manager adds an optional details question to whatsapp_connection.
      await q(`UPDATE public.cockpit_request_types SET fields = fields || '[{"key":"details","label":"What happened?","kind":"details","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb
                WHERE key = 'whatsapp_connection'`);
      const w = uid();
      await raise(CSM_A, ACME, "whatsapp_sync", w);
      expect((await requestOf(w)).answers.details).toContain("WhatsApp is not synced to Mahara OS (Needs Integrating). Connect it with a QR scan.");
    });
  });

  test("a retry of the same press is reused; a second press with another id refuses; the lock serialises presses", async () => {
    await rolledBack(async () => {
      const id = uid();
      await raise(CSM_A, ACME, "funded_card", id);
      const again = await raise(CSM_A, ACME, "funded_card", id);
      expect([again.raised, again.reused, again.item.state]).toEqual([true, true, "raised"]);
      // The retry carries submit too (4.20), built from the counted request as the submit answers its own retry.
      expect(again.submit).toEqual({ id, state: "sending", held: false, note: null });
      const direct = await submitForm(CSM_A, "card_missing", ACME, {}, id);
      expect(direct.reused).toBe(true);
      expect(again.submit).toEqual({ id: direct.id, state: direct.state, held: direct.held, note: direct.note });
      // The writer stops taking requests (dry run): the same retry says the request is held, with the gate's note.
      await q("SELECT public.cockpit_clickup_requests_state(true,'test','dry_run','{}'::text[],'{}'::jsonb)");
      const held = await raise(CSM_A, ACME, "funded_card", id);
      expect([held.raised, held.reused]).toEqual([true, true]);
      expect(held.submit).toEqual({ id, state: "sending", held: true,
        note: "Requests are not open yet. What you send is saved and goes to ClickUp by itself once they are." });
      const directHeld = await submitForm(CSM_A, "card_missing", ACME, {}, id);
      expect(held.submit).toEqual({ id: directHeld.id, state: directHeld.state, held: directHeld.held, note: directHeld.note });
      await q("SELECT public.cockpit_clickup_requests_state(true,'test','apply','{}'::text[],'{}'::jsonb)");
      const second = await refusal(() => raise(CEO, ACME, "funded_card", uid()));
      expect(second.code).toBe("55000");
      expect(second.message).toMatch(/^Already raised on \w{3} \d{1,2} \w{3} by the CSM\.$/);
      expect(await one<number>("SELECT count(*)::int r FROM public.cockpit_requests WHERE client_task_id = $1", [ACME])).toBe(1);
      expect((await refusal(() => raise(CSM_A, ACME, "funded_card", null))).message)
        .toBe("Send the request id, so a second press raises nothing twice.");
      expect((await refusal(() => raise(CSM_A, ACME, "nope"))).message).toBe("That is not a kickoff item. Reload the page.");
      expect((await refusal(() => raise(CSM_A, ACME, "calendar"))).message).toBe("That item is not open on this client's kickoff any more.");
    });
    const body = migration(D);
    for (const fn of ["raise", "link", "decline"])
      expect(fnDef(body, `CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_${fn}(`, fn))
        .toContain("PERFORM pg_advisory_xact_lock(hashtext('kickoff_item:' || p_task_id || ':' || p_item));");
  });

  test("the CEO may raise on any card; the request names the CEO", async () => {
    await rolledBack(async () => {
      const id = uid();
      const res = await raise(CEO, BETA, "funded_card", id);
      expect(res.item.decision).toMatchObject({ byLabel: "the CEO", mine: true });
      expect((await requestOf(id)).requester_label).toBe("the CEO");
      // CSM_B sees the CEO's decision, not as their own.
      expect(itemOf(await read(CSM_B, BETA), "funded_card")!.decision).toMatchObject({ byLabel: "the CEO", mine: false });
    });
  });
});

describe("a request of the type that is already open", () => {
  test("already_open: Yes writes nothing and Count it links it; an old form ticket counts too", async () => {
    await rolledBack(async () => {
      const open = uid();
      await submitForm(CSM_A, "card_missing", ACME, {}, open);
      const r = await read(CSM_A, ACME);
      const row = itemOf(r, "funded_card")!;
      expect(row.state).toBe("already_open");
      expect(row.existing).toMatchObject({ requestId: open, typeLabel: "Card missing for ads", requesterLabel: "the CSM", imported: false, mayOpen: true });
      expect(row.actions).toEqual({ raise: false, decline: true, link: true });
      const res = await raise(CSM_A, ACME, "funded_card");
      expect([res.raised, res.state]).toEqual([false, "already_open"]);
      expect(await answerRow(ACME, "funded_card")).toBeUndefined();
      expect(await one<number>("SELECT count(*)::int r FROM public.cockpit_requests WHERE client_task_id = $1", [ACME])).toBe(1);
      // Count it, an hour later: linked.
      await q("UPDATE public.cockpit_requests SET created_at = now() - interval '1 hour' WHERE id = $1", [open]);
      const l = await link(CSM_A, ACME, "funded_card", open);
      expect(l.item).toMatchObject({ state: "raised", decision: { how: "linked" }, request: { id: open } });
      expect((await audits("kickoff_item.linked")).map(a => a.metadata.how)).toEqual(["linked"]);
      // The same request is never counted for a second item.
      expect((await refusal(() => link(CSM_A, ACME, "whatsapp_sync", open))).message)
        .toBe("That request is already counted for another kickoff item.");
    });
    await rolledBack(async () => {
      await q(`INSERT INTO public.cockpit_requests(id, type_key, type_version, type_label, requester_label, source, client_task_id, client_name,
                 answers, priority, state, imported_task_id, content_hash)
               VALUES ($1, 'whatsapp_connection', 1, 'WhatsApp connection issue', 'the old ClickUp form', 'import', $2, 'Acme Interiors',
                 '{}'::jsonb, 'high', 'imported', 'oldTicket1', 'x')`, [uid(), ACME]);
      expect(itemOf(await read(CSM_A, ACME), "whatsapp_sync")!.existing).toMatchObject({ imported: true });
    });
  });
});

describe("No, and Raise it after all", () => {
  test("a No is recorded with its note; a second No is reused; Raise it after all; No on a raised item is refused", async () => {
    await rolledBack(async () => {
      const res = await decline(CSM_A, ACME, "whatsapp_sync", "  The client  connects it   themselves ");
      expect(res.item).toMatchObject({ state: "declined", decision: { answer: "declined", note: "The client connects it themselves", mine: true },
        actions: { raise: true, decline: false, link: true } });
      expect((await audits("kickoff_item.declined")).map(a => [a.entity_id, a.metadata])).toEqual([[
        `${ACME}:whatsapp_sync`, { item: "whatsapp_sync", kickoffRef: "tokAcme01", value: "Needs Integrating", noted: true, again: false },
      ]]);
      expect((await decline(CSM_A, ACME, "whatsapp_sync")).reused).toBe(true);
      expect((await audits("kickoff_item.declined")).length).toBe(1);
      const long = await decline(CSM_A, ACME, "funded_card", "x".repeat(400));
      expect(long.item.decision.note.length).toBe(240);
      // Raise it after all.
      const id = uid();
      const again = await raise(CSM_A, ACME, "whatsapp_sync", id);
      expect(again.item).toMatchObject({ state: "raised", decision: { answer: "raised", note: null } });
      const raised = await audits("kickoff_item.raised");
      expect(raised[0].metadata.again).toBe(true);
      expect(raised[0].before).toMatchObject({ answer: "declined" });
      const r = await refusal(() => decline(CSM_A, ACME, "whatsapp_sync"));
      expect(r).toEqual({ code: "55000", message: "This was raised as a request. Cancel the request in My requests if it is not needed." });
    });
  });
});

describe("a cancelled or failed request reopens its item", () => {
  test("cancel, then the item is reopened and can be raised again; a failed one the same", async () => {
    await rolledBack(async () => {
      const id = uid();
      await raise(CSM_A, ACME, "funded_card", id);
      await as(CSM_A, "SELECT public.cockpit_request_cancel($1::uuid, 'Raised by mistake') r", [id]);
      const row = itemOf(await read(CSM_A, ACME), "funded_card")!;
      expect(row).toMatchObject({ state: "reopened", offered: true, actions: { raise: true, decline: true, link: true },
        request: { id, state: "cancelled" } });
      const next = uid();
      expect((await raise(CSM_A, ACME, "funded_card", next)).item).toMatchObject({ state: "raised", request: { id: next } });
      await q("UPDATE public.cockpit_requests SET state = 'failed' WHERE id = $1", [next]);
      expect(itemOf(await read(CSM_A, ACME), "funded_card")!.state).toBe("reopened");
      // A No after a cancel is allowed.
      expect((await decline(CSM_A, ACME, "funded_card")).item.state).toBe("declined");
    });
  });
});

describe("outside the window", () => {
  test("a reopened item on a launched card's old kickoff is a receipt that may be raised again, never on Today", async () => {
    await rolledBack(async () => {
      const id = uid();
      await q(`INSERT INTO public.cockpit_requests(id, type_key, type_version, type_label, requester_member_id, requester_email, requester_label,
                 source, client_task_id, client_name, answers, priority, state, content_hash)
               SELECT $1, 'card_missing', 1, 'Card missing for ads', m.id, m.email, 'the CSM', 'client_page', $2, 'Cedar Homes', '{}'::jsonb,
                 'high', 'cancelled', 'x' FROM public.cockpit_members m WHERE m.auth_user_id = $3`, [id, CEDAR, CSM_A]);
      await q(`INSERT INTO public.cockpit_kickoff_item_answers(task_id, item, kickoff_ref, kickoff_at, kickoff_value, answer, request_id, how,
                 type_key, decided_by_member, decided_by_email, decided_by_label)
               SELECT $1, 'funded_card', 'tokCedar01', now() - interval '40 days', 'No', 'raised', $2, 'one_tap', 'card_missing', m.id, m.email, 'the CSM'
                 FROM public.cockpit_members m WHERE m.auth_user_id = $3`, [CEDAR, id, CSM_A]);
      const c = await read(CSM_A, CEDAR);
      expect(c.items.map((i: Row) => [i.item, i.state, i.offered, i.actions.raise])).toEqual([["funded_card", "reopened", false, true]]);
      expect(((await due(CSM_A)).rows as Row[]).map(r => r.taskId)).toEqual([ACME]);
      expect((await raise(CSM_A, CEDAR, "funded_card")).item.state).toBe("raised");
    });
  });

  test("No on a raised item whose request was cancelled after the kickoff stopped asking: not open any more", async () => {
    await rolledBack(async () => {
      const id = uid();
      await raise(CSM_B, BETA, "funded_card", id);
      await as(CSM_B, "SELECT public.cockpit_request_cancel($1::uuid, 'Not needed') r", [id]);
      await q(`UPDATE public.cockpit_client_onboarding SET forms = jsonb_set(forms, '{kickoff,answers}',
                 '[{"ref":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","title":"t","value":"Yes"}]'::jsonb) WHERE clickup_task_id = $1`, [BETA]);
      expect(itemOf(await read(CSM_B, BETA), "funded_card")).toMatchObject({ state: "raised", stillOpen: false, request: { state: "cancelled" } });
      expect(await refusal(() => decline(CSM_B, BETA, "funded_card")))
        .toEqual({ code: "22023", message: "That item is not open on this client's kickoff any more." });
    });
  });
});

describe("a type turned off, and a type the kickoff cannot fill", () => {
  test("type_off: no pills and a sentence; oneTap false: Raise it with the form", async () => {
    await rolledBack(async () => {
      await q("UPDATE public.cockpit_request_types SET enabled = false WHERE key = 'whatsapp_connection'");
      const row = itemOf(await read(CSM_A, ACME), "whatsapp_sync")!;
      expect([row.state, row.typeEnabled, row.actions, row.route]).toEqual(["type_off", false, { raise: false, decline: false, link: true }, null]);
      const r = await refusal(() => raise(CSM_A, ACME, "whatsapp_sync"));
      expect(r).toEqual({ code: "55000",
        message: "WhatsApp connection issue is turned off in Requests settings, so it cannot be raised here. Ask the systems manager." });
      expect((await refusal(() => decline(CSM_A, ACME, "whatsapp_sync"))).code).toBe("55000");
      // Today does not count a turned-off item.
      expect((await due(CSM_A)).rows.find((x: Row) => x.taskId === ACME).due).toBe(2);
    });
    await rolledBack(async () => {
      await q(`UPDATE public.cockpit_request_types SET fields = fields || '[{"key":"ad_account","label":"Ad account","kind":"text","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb
                WHERE key = 'card_missing'`);
      const row = itemOf(await read(CSM_A, ACME), "funded_card")!;
      expect([row.state, row.oneTap, row.actions.raise, row.actions.link]).toEqual(["open", false, false, true]);
      expect(await refusal(() => raise(CSM_A, ACME, "funded_card"))).toEqual({ code: "55000",
        message: "Card missing for ads needs answers the kickoff does not have. Raise it with the form." });
      expect(await one<number>("SELECT count(*)::int r FROM public.cockpit_requests")).toBe(0);
    });
  });
});

describe("Change it first: the ticket form's request is counted", () => {
  test("a request the seat just sent counts as form; other clients, closed, old and unseen requests are refused", async () => {
    await rolledBack(async () => {
      const id = uid();
      await submitForm(CSM_A, "general_tech", ACME, { details: "Edited in the form" }, id);
      const res = await link(CSM_A, ACME, "funded_card", id);
      expect(res.item).toMatchObject({ state: "raised", typeKey: "card_missing", decision: { how: "form", typeKey: "general_tech" },
        request: { id, typeLabel: "General tech request" } });
      expect(await answerRow(ACME, "funded_card")).toMatchObject({ how: "form", type_key: "general_tech" });
      expect((await link(CSM_A, ACME, "funded_card", id)).reused).toBe(true);

      const other = uid();
      await submitForm(CSM_B, "general_tech", BETA, { details: "For another client" }, other);
      expect((await refusal(() => link(CSM_A, ACME, "mahara_os", other))).message).toBe("That request is not for this client.");
      const old = uid();
      await submitForm(CSM_A, "general_tech", ACME, { details: "Old" }, old);
      await q("UPDATE public.cockpit_requests SET created_at = now() - interval '30 days' WHERE id = $1", [old]);
      expect((await refusal(() => link(CSM_A, ACME, "mahara_os", old))).message)
        .toBe("That request is older than the kickoff, so it is not counted for it.");
      const gone = uid();
      await submitForm(CSM_A, "general_tech", ACME, { details: "Gone" }, gone);
      await q("UPDATE public.cockpit_requests SET state = 'cancelled' WHERE id = $1", [gone]);
      expect((await refusal(() => link(CSM_A, ACME, "mahara_os", gone))).code).toBe("55000");
      // A request this seat may not open (the CEO's general_tech, a team the CSM is not on).
      const ceos = uid();
      await submitForm(CEO, "general_tech", ACME, { details: "The CEO's" }, ceos);
      expect((await refusal(() => link(CSM_A, ACME, "mahara_os", ceos))).message).toBe("You cannot count that request. Ask whoever raised it.");
    });
  });
});

describe("Today: kickoff items to decide", () => {
  const cards = async (who: string) => ((await due(who)).rows as Row[]).map(r => [r.taskId, r.due]);

  test("each seat sees its own cards and the unmatched ones; the CEO and admins every allowed card; oldest kickoff first", async () => {
    // Acme (csm Noura -> CSM_A), Beta (Huda -> CSM_B), Dune (sent by CSM_ALL, no row), Grove (Former Person: unmatched).
    expect(await cards(CEO)).toEqual([[ACME, 3], [GROVE, 1], [BETA, 1], [DUNE, 2]]);
    expect(await cards(ADMIN_CSM)).toEqual([[ACME, 3], [GROVE, 1], [BETA, 1], [DUNE, 2]]);
    expect(await cards(CSM_A)).toEqual([[ACME, 3]]); // Grove is not on CSM_A's client list
    expect(await cards(CSM_B)).toEqual([[BETA, 1]]);
    expect(await cards(CSM_ALL)).toEqual([[GROVE, 1], [DUNE, 2]]);
    const row = (await due(CSM_A)).rows[0];
    expect(row).toMatchObject({ clientName: "Acme Interiors", kickoffAt: kuwaitNoon(20).replace("Z", "+00:00") });
    for (const item of row.items) expect(item.route).toBeUndefined();
  });

  test("a decided card leaves the band; the note says when nothing is left", async () => {
    await rolledBack(async () => {
      await decline(CSM_B, BETA, "funded_card");
      expect(await cards(CSM_B)).toEqual([]);
      expect((await due(CSM_B)).note).toBe("No kickoff items to decide.");
      await raise(CSM_A, ACME, "funded_card");
      expect(await cards(CSM_A)).toEqual([[ACME, 2]]);
    });
  });
});

describe("the doctor", () => {
  test("ok on the ground, with counts and no client data; its view gives the same one row to the service role", async () => {
    const d = await doctor();
    expect(d).toMatchObject({ ok: true, problems: [], notes: [], on: ["funded_card", "mahara_os", "whatsapp_sync"] });
    expect(d.items.map((i: Row) => [i.item, i.on, i.typeEnabled, i.oneTap, i.asked])).toEqual([
      ["funded_card", true, true, true, true],
      ["mahara_os", true, true, true, true],
      ["whatsapp_sync", true, true, true, true],
      ["training_access", false, true, true, true],
      ["facebook_access", false, true, true, true],
      ["calendar", false, true, true, true],
      ["whatsapp_pending", false, true, true, true],
    ]);
    expect(d.counts).toMatchObject({ cards: 4, offered: 7, typeOff: 0, reopened: 0, raised: 0, declined: 0, oldestUndecidedDays: 20 });
    const text = JSON.stringify(d);
    for (const name of Object.values(NAMES)) expect(text).not.toContain(name);
    for (const task of Object.keys(NAMES)) expect(text).not.toContain(task);
    const v = await as<Row>("service", "SELECT report r FROM public.cockpit_kickoff_items_doctor_v");
    expect(v).toMatchObject({ ok: true, counts: d.counts });
    expect((await refusal(() => as(CSM_A, "SELECT public.cockpit_kickoff_items_doctor() r"))).code).toBe("42501");
  });

  test("a type off, a type that needs more, a renamed option, the submit's source and a missing setting are each said", async () => {
    await rolledBack(async () => {
      await q("UPDATE public.cockpit_request_types SET enabled = false WHERE key = 'whatsapp_connection'");
      await q(`UPDATE public.cockpit_request_types SET fields = fields || '[{"key":"ad_account","label":"Ad account","kind":"text","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb
                WHERE key = 'card_missing'`);
      const fields = fnDef(migration(O), "CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_fields(p_form_key text)", "fields");
      await q(fields.replace('"Tech Issue",', '"Tech Problem",'));
      const def = fnDef(migration(R), "CREATE OR REPLACE FUNCTION public.cockpit_request_submit(", "submit");
      await q(def.replace("NOT IN ('requests_page','client_page')", "NOT IN ('requests_page')"));
      const d = await doctor();
      expect(d.ok).toBe(false);
      expect(d.problems).toEqual([
        "Funded card: Card missing for ads asks something the kickoff does not have, so Yes opens the form. Make that question optional in Requests settings.",
        "Mahara OS access: the kickoff no longer asks \"Mahara OS Access Status\" with the answer Tech Issue, so the item is never offered. Update the item list (20261103d's catalogue).",
        "WhatsApp sync: WhatsApp connection issue is turned off in Requests settings, so the item shows as turned off. Turn the type on, or turn the item off.",
        "cockpit_request_submit no longer has the 8 arguments or the client_page source that Yes calls, so Yes fails. Re-read it and fix 20261103d on a branch.",
      ]);
      expect(d.notes).toEqual([]);
      expect(d.counts.typeOff).toBe(1);
    });
  });

  test("the switch fails closed: a missing row or an on that is not a list turns every item off, and the doctor says so as a problem", async () => {
    const MISSING = "forms.kickoff_items: the setting is missing, so every kickoff item is off. Set it with cockpit_kickoff_items_switch: the items to keep on, or {} to stop them all.";
    const NOT_A_LIST = "forms.kickoff_items: the setting is not a list of items, so every kickoff item is off. Set it with cockpit_kickoff_items_switch: the items to keep on, or {} to stop them all.";
    const cases: [string, string, string][] = [
      ["the off every other forms switch takes", `UPDATE public.cockpit_settings SET value = '{"on": false}'::jsonb WHERE key = 'forms.kickoff_items'`, NOT_A_LIST],
      ["a string", `UPDATE public.cockpit_settings SET value = '{"on": "funded_card"}'::jsonb WHERE key = 'forms.kickoff_items'`, NOT_A_LIST],
      ["no on at all", `UPDATE public.cockpit_settings SET value = '{}'::jsonb WHERE key = 'forms.kickoff_items'`, NOT_A_LIST],
      ["a deleted row", "DELETE FROM public.cockpit_settings WHERE key = 'forms.kickoff_items'", MISSING],
    ];
    for (const [what, change, sentence] of cases) {
      await rolledBack(async () => {
        await decline(CSM_A, ACME, "mahara_os");
        await q(change);
        expect([what, await one("SELECT public.cockpit_kickoff_items_on() r")]).toEqual([what, []]);
        // Nothing is offered; a decision already made stays shown.
        const r = await read(CSM_A, ACME);
        expect([what, r.items.map((i: Row) => [i.item, i.state])]).toEqual([what, [["mahara_os", "declined"]]]);
        const yes = await refusal(() => raise(CSM_A, ACME, "funded_card"));
        expect([what, yes.code, yes.message]).toEqual([what, "22023", "That item is not open on this client's kickoff any more."]);
        expect(await one<number>("SELECT count(*)::int r FROM public.cockpit_requests WHERE client_task_id = $1", [ACME])).toBe(0);
        expect((await due(CSM_A)).rows.map((x: Row) => x.taskId)).not.toContain(ACME);
        const d = await doctor();
        expect([what, d.ok, d.on, d.problems, d.notes]).toEqual([what, false, [], [sentence], []]);
        // The switch is the way back.
        await q("SELECT public.cockpit_kickoff_items_switch(ARRAY['funded_card','mahara_os','whatsapp_sync'], 'the systems manager')");
        expect(await one("SELECT public.cockpit_kickoff_items_on() r")).toEqual(["funded_card", "mahara_os", "whatsapp_sync"]);
        expect((await doctor()).problems).toEqual([]);
      });
    }
    // {"on": []} is the deliberate stop: every item off, said as a note, not a problem.
    await rolledBack(async () => {
      await q("SELECT public.cockpit_kickoff_items_switch('{}'::text[], 'the systems manager')");
      const d = await doctor();
      expect([d.ok, d.on, d.problems, d.notes]).toEqual([true, [], [], ["Every kickoff item is off (forms.kickoff_items), so none is offered."]]);
    });
    // The defaults live only in the one-time seed.
    const on = fnDef(migration(D), "CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_on()", "items on");
    expect(on).not.toContain("defaultOn");
  });
});

describe("audit rows hold no client data", () => {
  test("every kickoff_item audit row names the card by id only, and the details sentence stays on the request", async () => {
    await rolledBack(async () => {
      await raise(CSM_A, ACME, "mahara_os");
      await decline(CSM_A, ACME, "funded_card");
      await link(CSM_A, ACME, "whatsapp_sync", (await submitForm(CSM_A, "whatsapp_connection", ACME)).id);
      const rows = await q("SELECT * FROM public.cockpit_audit_log WHERE action LIKE 'kickoff_item.%'");
      expect(rows.map(r => r.action).sort()).toEqual(["kickoff_item.declined", "kickoff_item.linked", "kickoff_item.raised"]);
      for (const r of rows) {
        const text = JSON.stringify([r.before, r.after, r.metadata]);
        expect(text).not.toContain("Acme Interiors");
        expect(text).not.toContain("Raised from the kickoff");
      }
    });
  });
});
