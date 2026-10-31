/**
 * Late Typeform 1-1 notes (20261029x_forms_late_typeform.sql;
 * docs/forms/STAGE2B-CONTRACT.md 2.8 and 4.9, build 9) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * a function here as it would in production.
 *
 * It stands on the 2a base of section 8 in order (20261025n, 20261025o,
 * 20261026r, 20261026s, 20261026t, 20261027f, 20261027g, 20261027h over
 * 20261024a), cut from or applied as the canonical migrations the way
 * stage2a-fit-supabase.test.ts stands on them, then
 * 20261029s_forms_registry.sql and 20261029x_forms_late_typeform.sql, each
 * twice. The registry is flipped through its own core
 * (cockpit_form_registry_apply with via 'cutover', the notes row and the
 * recording match on the cockpit, which need no later file) inside
 * rolled-back transactions.
 *
 * Covered: the CHECK; nothing reclassified while the provider is typeform;
 * after the flip, a row at or after provider_since late on insert and on an
 * upsert that re-sends checkin, and unlinked even when an old worker patches
 * the link; a row before it kept; sticky after a flip back; one
 * csm.checkin_late row per form, with no answers; one legacy response per
 * late row with a card, made when a later update sets the card; the late
 * form and its legacy row invisible to cockpit_form_call_noted_at,
 * cockpit_form_recording_tied's rule 3, cockpit_fathom_match_inputs,
 * cockpit_form_draft_inputs, cockpit_csm_calls_summary and the timeline's
 * call form; never tripping the one-live-recording index or blocking a
 * native send; a forced legacy failure still committing the store row;
 * grants. The CEO's address is read from the CEO gate migration, never
 * written here; every other person, client, recording and room is invented.
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
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

const BASE = [
  "20261025n_slack_notices.sql",
  "20261025o_blueprint_close_drain.sql",
  "20261026r_requests.sql",
  "20261026s_request_types_seed.sql",
  "20261026t_task_alerts.sql",
  "20261027f_forms_core.sql",
  "20261027g_fathom_intake.sql",
  "20261027h_checkin_plans.sql",
] as const;
const S = "20261029s_forms_registry.sql";
const X = "20261029x_forms_late_typeform.sql";

/** The CEO gate's own address (20260923m), so no address is written here. */
const CEO_EMAIL = (() => {
  const hit = migration("20260923m_cockpit_ceo_gate.sql").match(
    /IN \(\s*'([^']+@[^']+)'/,
  );
  if (!hit) throw new Error("The CEO gate names no address");
  return hit[1];
})();

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1";
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm only, every client
const EDITOR_ROW = "00000000-0000-4000-8000-0000000000f2";
const EDITOR_ROLE = "00000000-0000-4000-8000-0000000000f3";
const GONE = "00000000-0000-4000-8000-0000000000f4";
const NOBODY = "00000000-0000-4000-8000-0000000000f5";
const CSM_EMAIL = "csm@tests.invalid";

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// --- Sessions ---------------------------------------------------------------------------------

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
// Inside rolledBack every step runs under a savepoint, so a refusal the test
// expects leaves the transaction usable for the steps after it.
let depth = 0;
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
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0]?.r as T;
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
/** One value as a seat (its auth id) or as PostgREST with the service key. */
async function as<T = any>(
  who: string | "service",
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return guarded(async () => {
    if (who === "service") {
      await asOwner();
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      await db.exec("SET ROLE service_role");
    } else await actor(db, who);
    return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
  });
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

// --- The database the 2b files stand on (section 8's 2a base) ---------------------------------

/**
 * What Stage 1, the ticketing and the 2a forms read, each cut from its
 * canonical migration as stage2a-fit-supabase.test.ts cuts it; the sales
 * index and a few provider ledgers are stand-ins with the live column names.
 * PL/pgSQL resolves a declared row type when a function is created, so the
 * call store and the sync state come first.
 */
async function standOn() {
  for (const [file, pattern, what] of [
    [
      "20260921e_tap_charges.sql",
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "sync state",
    ],
    [
      "20261011c_csm_call_store.sql",
      /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/,
      "sync state detail",
    ],
    [
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "people",
    ],
    [
      "20260921b_people_schedule.sql",
      /alter table public\.cockpit_people\s+add column if not exists schedule jsonb;/,
      "schedule",
    ],
    [
      "20261015210000_eod_radar.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_eod_radar_slack_ids \([\s\S]*?\n\);/,
      "slack ids",
    ],
    [
      "20261005a_client_onboarding.sql",
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "onboarding",
    ],
    [
      "20261023a_csm_form_sends.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_form_sends \([\s\S]*?\n\);/,
      "form sends",
    ],
    [
      "20260921a_cockpit_settings.sql",
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
    ],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  const roster = migration("20260927v_csm_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "source state",
    ],
    [
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "source state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "csm sources",
    ],
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
    [
      /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
      "gate for actor",
    ],
    [
      /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
      "gate",
    ],
    [
      /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
      "gate grants",
    ],
  ] as const)
    await db.exec(cut(gate, pattern, what));
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/,
      "team only",
    ),
  );
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/,
      "client allowed",
    ),
  );

  const media = migration("20260927w_media_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_source_state\([\s\S]*?\n\);/,
      "media source state",
    ],
    [
      /INSERT INTO public\.cockpit_media_source_state[^\n]*\n/,
      "media source state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_sources\([\s\S]*?\n\);/,
      "media sources",
    ],
  ] as const)
    await db.exec(cut(media, pattern, what));
  await db.exec(
    cut(
      migration("20261005f_cockpit_csm_history.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_call_briefs \([\s\S]*?\n\);/,
      "call briefs",
    ),
  );

  const store = migration("20261011c_csm_call_store.sql");
  for (const table of [
    "cockpit_csm_calls",
    "cockpit_csm_call_forms",
    "cockpit_fathom_meetings",
    "cockpit_csm_meta_activities",
    "cockpit_csm_changes",
    "cockpit_csm_unmatched",
    "cockpit_csm_match_audit",
  ])
    await db.exec(
      cut(
        store,
        new RegExp(
          `CREATE TABLE IF NOT EXISTS public\\.${table}\\([\\s\\S]*?\\n\\);`,
        ),
        table,
      ),
    );
  for (const [pattern, what] of [
    [
      /DO \$\$\nDECLARE t text;\nBEGIN\n {2}FOREACH t IN ARRAY ARRAY\['cockpit_csm_calls'[\s\S]*?public\.cockpit_csm_match_audit_id_seq TO service_role;/,
      "store grants",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_visible_tasks\(\)[\s\S]*?TO authenticated, service_role;/,
      "visible tasks",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_calls_summary\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_calls_summary\(\) TO authenticated;/,
      "calls summary",
    ],
  ] as const)
    await db.exec(cut(store, pattern, what));
  const privacy = migration("20261011d_csm_match_privacy.sql");
  for (const [pattern, what] of [
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_unmatched_list\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_unmatched_list\(\) TO authenticated;/,
      "unmatched list",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_manual_match\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_manual_match\(bigint,text\) TO authenticated;/,
      "manual match",
    ],
  ] as const)
    await db.exec(cut(privacy, pattern, what));
  await db.exec(migration("20261011f_csm_eod_mentions.sql"));

  await db.exec(migration("20260927s_creative_read_models.sql"));
  for (const [file, pattern, what] of [
    [
      "20261019120000_csm_decks.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_deck_prep \([\s\S]*?\n\);/,
      "deck prep",
    ],
    [
      "20260927g_cockpit_media_actions.sql",
      /CREATE TABLE public\.cockpit_media_actions \([\s\S]*?\n\);/,
      "media actions",
    ],
    [
      "20261003a_client_logos.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/,
      "client logos",
    ],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  await db.exec(`
    CREATE TABLE public.cockpit_sales_recordings (
      recording_id text PRIMARY KEY, title text, recorded_by text, started_at timestamptz, duration_s integer,
      share_url text, contact_id text, appointment_id text, matched_by text, indexed_at timestamptz NOT NULL DEFAULT now(),
      source text, kind text, language text, people jsonb, summary text, action_items text, transcript_path text,
      transcript_chars integer, transcript_sha text, note_path text, duplicate_of text,
      hidden_reason text CHECK (hidden_reason IN ('duplicate','too short','client service','internal')));
    CREATE TABLE public.cockpit_sales_call_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recording_id text NOT NULL UNIQUE, contact_id text, call_type text,
      call_at timestamptz, rep text, notes jsonb NOT NULL, verdict text, verdict_why text, model text,
      written_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.cockpit_sales_recordings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_sales_call_notes ENABLE ROW LEVEL SECURITY;`);
  await db.exec(
    cut(
      migration("20261013112622_sales_client_call_exclusion.sql"),
      /create or replace function public\.cockpit_sales_call_exclusion\([\s\S]*?grant execute on function public\.cockpit_sales_call_exclusion\(text,text\) to service_role;/,
      "sales exclusion",
    ),
  );
  await db.exec(
    cut(
      migration("20261009a_cockpit_team_hours.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_hours_require_service\(\)[\s\S]*?\$\$;/,
      "require service",
    ),
  );
  await db.exec(
    "REVOKE ALL ON FUNCTION public.cockpit_hours_require_service() FROM PUBLIC, anon, authenticated, service_role;",
  );

  await db.exec(`
    CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, clickup_id text, country text, city text,
      language text, service_mode text);
    CREATE TABLE public.editor_clients(task_id text PRIMARY KEY, name text, dos_donts text, brand_dna_url text, brand_dna text,
      offer_url text, offer text, drive_url text, website text, instagram text, docs_read_at timestamptz, synced_at timestamptz);
    CREATE TABLE public.cockpit_csm_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid,
      method text NOT NULL, resource text NOT NULL, phase text NOT NULL, http_status integer, object_id text,
      created_at timestamptz NOT NULL DEFAULT now(), provider text NOT NULL DEFAULT 'clickup', run_key text);
    CREATE TABLE public.cockpit_media_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid,
      provider text NOT NULL, method text NOT NULL, resource text NOT NULL, phase text NOT NULL, http_status integer,
      object_id text, created_at timestamptz NOT NULL DEFAULT now(), native_run_id uuid, native_receipt_index integer);
    CREATE TABLE public.cockpit_decisions (id bigint PRIMARY KEY);
    CREATE TABLE public.cockpit_media_native_records (id uuid PRIMARY KEY);
    ALTER TABLE public.cockpit_settings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_eod_radar_slack_ids,
      public.cockpit_client_onboarding, public.cockpit_csm_form_sends,
      public.cockpit_csm_source_state, public.cockpit_csm_sources, public.cockpit_csm_deck_prep,
      public.cockpit_media_actions, public.cockpit_client_logos, public.ghl_clients, public.editor_clients,
      public.cockpit_csm_provider_health, public.cockpit_media_provider_health, public.cockpit_decisions,
      public.cockpit_media_native_records, public.cockpit_settings FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON public.cockpit_media_source_state, public.cockpit_media_sources, public.cockpit_media_call_briefs,
      public.cockpit_sales_recordings, public.cockpit_sales_call_notes FROM anon, authenticated;
    GRANT SELECT, INSERT ON public.cockpit_csm_provider_health, public.cockpit_media_provider_health TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_media_actions, public.cockpit_sync_state TO service_role;
    GRANT ALL ON public.cockpit_settings TO service_role;`);

  const wb = migration("20261009f_clickup_writeback_native.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_config\([\s\S]*?\n\);/,
      "config",
    ],
    [
      /INSERT INTO public\.cockpit_clickup_writeback_config[^\n]*\n/,
      "config row",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/,
      "queue",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_runs\([\s\S]*?\n\);/,
      "runs",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/,
      "audit",
    ],
    [
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "insert trigger",
    ],
    [
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_state[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "state trigger",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_state\([\s\S]*?END \$\$;/,
      "state",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_claim\([\s\S]*?END \$\$;/,
      "claim",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_save\([\s\S]*?END \$\$;/,
      "save",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_begin\([\s\S]*?END \$\$;/,
      "begin",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_finish\([\s\S]*?END \$\$;/,
      "finish",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_idle\([\s\S]*?END \$\$;/,
      "idle",
    ],
  ] as const)
    await db.exec(cut(wb, pattern, `20261009f ${what}`));
  await db.exec(
    cut(
      migration("20261009j_billing_clickup_writeback.sql"),
      /ALTER TABLE public\.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;\nALTER TABLE[\s\S]*?\)\);/,
      "billing kind",
    ),
  );
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_config ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue, public.cockpit_clickup_writeback_runs
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue,
      public.cockpit_clickup_writeback_runs TO service_role;
    REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) TO service_role;`);
}

/** The seats, the people by role, the roster the client gate reads and Acme's alias. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  await member(db, EDITOR_ROW, "buyer.editor@tests.invalid", ["media_buyer"]);
  await member(db, EDITOR_ROLE, "forms.editor@tests.invalid", ["forms_editor"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await q(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'nobody@tests.invalid',now())",
    [NOBODY],
  );
  for (const [name, email, role] of [
    ["Csm Test", CSM_EMAIL, "Client success manager"],
    ["Ceo Test", CEO_EMAIL, "CEO"],
  ])
    await q(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );
  const snap = "2026-10-28T08:00:00Z";
  const clients = [
    [A, "Acme Interiors", "Active", "Happy"],
    [B, "Beta Build", "Onboarding", null],
  ] as const;
  for (const [taskId, name, stage, happiness] of clients)
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name, stage, happiness }),
        snap,
      ],
    );
  await q(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [clients.length, snap],
  );
}

/** Every public function's definition md5 and ACL. */
async function functions() {
  return new Map(
    (
      await q<{ sig: string; md5: string; acl: string | null }>(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind IN ('f','p')`,
      )
    ).map(r => [r.sig, `${r.md5}|${r.acl}`]),
  );
}

let first: Map<string, string>;
let auditOnce = 0;
let auditTwice = 0;
let twiceFns: Map<string, string>;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The order audit rows were written in: two statements of one transaction
  // share created_at, and the ids are random.
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await standOn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE) await db.exec(migration(file));
  for (const file of [S, X]) await db.exec(migration(file));
  first = await functions();
  auditOnce = await count("SELECT count(*) n FROM public.cockpit_audit_log");
  for (const file of [S, X]) await db.exec(migration(file));
  twiceFns = await functions();
  auditTwice = await count("SELECT count(*) n FROM public.cockpit_audit_log");
}, 300_000);
afterAll(async () => {
  await db?.close();
});

// --- The store as its writers write it ------------------------------------------------------------

/** The registry flipped by its own core: only the two SQL effects, which need no later file. */
const flip = () =>
  one<Row>(
    `SELECT public.cockpit_form_registry_apply('checkin',
       '{"provider":"native","owners":{"call_form":"cockpit","call_match":"cockpit"}}'::jsonb,
       '{"via":"cutover","email":"cut-over"}'::jsonb) AS r`,
  );
const flipBack = () =>
  one<Row>(
    `SELECT public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}'::jsonb,
       '{"via":"cutover-rollback","email":"cut-over"}'::jsonb) AS r`,
  );
const since = () =>
  one<Date | null>("SELECT public.cockpit_form_native_since('checkin') AS r");

/** The csm-calls worker's REST upsert (on_conflict token, merge-duplicates): every column it names. */
async function workerWrites(f: {
  token: string;
  task?: string | null;
  at: string | Date;
  share?: string | null;
  kind?: string;
  linked?: number | null;
}) {
  const at = f.at instanceof Date ? f.at.toISOString() : f.at;
  await q(
    `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, typed_client, matched_by, submitted_at,
       answers, hidden, recording_url, linked_call_id, updated_at)
     VALUES ($1, 'fRokTITH', $2, $3, NULL, $4, $5, $6::jsonb, '{}'::jsonb, $7, $8, now())
     ON CONFLICT (token) DO UPDATE SET form_id = EXCLUDED.form_id, form_kind = EXCLUDED.form_kind,
       task_id = EXCLUDED.task_id, typed_client = EXCLUDED.typed_client, matched_by = EXCLUDED.matched_by,
       submitted_at = EXCLUDED.submitted_at, answers = EXCLUDED.answers, hidden = EXCLUDED.hidden,
       recording_url = EXCLUDED.recording_url, linked_call_id = EXCLUDED.linked_call_id, updated_at = EXCLUDED.updated_at`,
    [
      f.token,
      f.kind ?? "checkin",
      f.task === undefined ? A : f.task,
      (f.task === undefined ? A : f.task) ? "hidden_field" : null,
      at,
      JSON.stringify([
        {
          ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
          type: "multiple_choice",
          title: "Defcon Status",
          value: "Happy",
        },
        ...(f.share
          ? [
              {
                ref: "0773087f-beda-4e2c-bf50-acdac0dcbe05",
                type: "long_text",
                title: "Transcript",
                value: f.share,
              },
            ]
          : []),
      ]),
      f.share ?? null,
      f.linked ?? null,
    ],
  );
}
const form = (token: string) =>
  q<Row>(
    "SELECT token, form_kind, task_id, linked_call_id FROM public.cockpit_csm_call_forms WHERE token = $1",
    [token],
  ).then(r => r[0]);
const lateAudits = (token?: string) =>
  q<Row>(
    `SELECT entity_id, actor_email, before, after, metadata FROM public.cockpit_audit_log
      WHERE action = 'csm.checkin_late' AND ($1::text IS NULL OR entity_id = $1) ORDER BY test_seq`,
    [token ?? null],
  );
const legacy = (token: string) =>
  q<Row>(
    `SELECT form_key, form_version, source, external_id, task_id, client_name, mode, state, answers, hidden, created_by,
            created_by_id, submitted_at FROM public.cockpit_form_responses WHERE external_id = $1`,
    [token],
  );
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
let recSeq = 900000900;
/** A recording and its call row: on Acme by its room, or on no client, recorded in or outside Customer Success. */
async function recording(o: { task?: string | null; team?: string } = {}) {
  const rec = String(++recSeq);
  const share = `https://fathom.video/share/test-${rec}`;
  await q(
    `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
       external,invitees,url,share_url,summary,raw,class,room,recorder_team)
     VALUES($1,'Invented call',$2,$3,$4,'Invented Recorder',true,'[]'::jsonb,$5,$6,'Invented summary.','{}'::jsonb,'client',$7,$8)`,
    [
      rec,
      ago(70),
      ago(40),
      o.team === "Sales" ? "closer@tests.invalid" : CSM_EMAIL,
      `https://fathom.video/calls/${rec}`,
      share,
      `meet:rec-${rec}`,
      o.team ?? "Customer Success",
    ],
  );
  const task = o.task === undefined ? A : o.task;
  const [{ id }] = await q<{ id: number }>(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
       starts_at,ends_at,status,provider_status,host_email,recording_url,room)
     VALUES('fathom',$1,$2,$3,$4,$5,'checkin','Invented call',$6,$7,'held','recorded',$8,$9,$10) RETURNING id`,
    [
      rec,
      task,
      task ? "Acme Interiors" : null,
      task ? "same_room" : null,
      task ? 1 : null,
      ago(70),
      ago(40),
      CSM_EMAIL,
      `https://fathom.video/calls/${rec}`,
      `meet:rec-${rec}`,
    ],
  );
  return { rec, share, callId: Number(id) };
}

// ---------------------------------------------------------------------------------------------

describe("the migration", () => {
  test("is one transaction that reloads the schema, widens the kind, adds two triggers and applies twice", async () => {
    const sql = migration(X);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    expect([...first].filter(([sig, v]) => twiceFns.get(sig) !== v)).toEqual(
      [],
    );
    expect(auditTwice).toBe(auditOnce);
    expect(
      await one(
        "SELECT pg_get_constraintdef(oid) AS r FROM pg_constraint WHERE conrelid = 'public.cockpit_csm_call_forms'::regclass AND conname = 'cockpit_csm_call_forms_form_kind_check'",
      ),
    ).toBe(
      "CHECK ((form_kind = ANY (ARRAY['checkin'::text, 'onboarding'::text, 'kickoff'::text, 'kickoff_old'::text, 'blueprint'::text, 'checkin_late'::text])))",
    );
    expect(
      await q(
        `SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def FROM pg_trigger
          WHERE tgrelid = 'public.cockpit_csm_call_forms'::regclass AND tgname LIKE 'cockpit_csm_call_forms_%' ORDER BY tgname`,
      ),
    ).toEqual([
      {
        tgname: "cockpit_csm_call_forms_late",
        tgenabled: "O",
        def: "CREATE TRIGGER cockpit_csm_call_forms_late BEFORE INSERT OR UPDATE OF form_kind, submitted_at, form_id, linked_call_id ON public.cockpit_csm_call_forms FOR EACH ROW EXECUTE FUNCTION cockpit_csm_call_forms_late()",
      },
      {
        tgname: "cockpit_csm_call_forms_legacy",
        tgenabled: "O",
        def: "CREATE TRIGGER cockpit_csm_call_forms_legacy AFTER INSERT OR UPDATE OF task_id, form_kind ON public.cockpit_csm_call_forms FOR EACH ROW WHEN (((new.form_kind = 'checkin_late'::text) AND (new.task_id IS NOT NULL))) EXECUTE FUNCTION cockpit_csm_call_forms_legacy()",
      },
    ]);
    for (const sig of [
      "cockpit_csm_call_forms_late()",
      "cockpit_csm_call_forms_legacy()",
    ])
      expect(
        await one(
          "SELECT p.proacl::text AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
          [`public.${sig}`],
        ),
      ).toBe("{postgres=X/postgres}");
  });

  test("the kind's drift guard refuses a CHECK it did not read, and widens only the one it read", async () => {
    const block = (() => {
      const sql = migration(X);
      const from = sql.indexOf("-- 1. The kind");
      const to = sql.indexOf("-- 2. Late is decided here");
      expect(from).toBeGreaterThan(0);
      expect(to).toBeGreaterThan(from);
      return sql.slice(from, to);
    })();
    const apply = () =>
      guarded(async () => {
        await asOwner();
        await db.exec(block);
      });
    const refusal = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        const x = e as { code?: string; message: string };
        return { code: x.code ?? "", message: x.message };
      }
      throw new Error("Expected a refusal");
    };
    const NAME = "cockpit_csm_call_forms_form_kind_check";
    const def = () =>
      one<string | null>(
        `SELECT pg_get_constraintdef(oid) AS r FROM pg_constraint
          WHERE conrelid = 'public.cockpit_csm_call_forms'::regclass AND conname = '${NAME}'`,
      );
    const oid = () =>
      one<string>(
        `SELECT oid::text AS r FROM pg_constraint
          WHERE conrelid = 'public.cockpit_csm_call_forms'::regclass AND conname = '${NAME}'`,
      );
    const list = (...kinds: string[]) =>
      guarded(async () => {
        await asOwner();
        await db.exec(
          `ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS ${NAME};
           ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT ${NAME}
             CHECK (form_kind = ANY (ARRAY[${kinds.map(k => `'${k}'`).join(",")}]));`,
        );
      });
    const READ = [
      "checkin",
      "onboarding",
      "kickoff",
      "kickoff_old",
      "blueprint",
    ];
    const refused = {
      code: "55000",
      message: `${NAME} changed since the 2b contract read it; stop and re-read it.`,
    };
    const widened = `CHECK ((form_kind = ANY (ARRAY[${[...READ, "checkin_late"].map(k => `'${k}'::text`).join(", ")}])))`;
    await rolledBack(async () => {
      // Already widened: nothing is dropped.
      const before = await oid();
      await apply();
      expect(await oid()).toBe(before);
      expect(await def()).toBe(widened);
      // What the contract read is widened.
      await list(...READ);
      await apply();
      expect(await def()).toBe(widened);
      // Another session's kind stays, and the file stops.
      await list(...READ, "another_session");
      const theirs = await def();
      expect(await refusal(apply)).toEqual(refused);
      expect(await def()).toBe(theirs);
      await list(...READ, "checkin_late", "another_session");
      expect(await refusal(apply)).toEqual(refused);
      // No constraint at all is not what the contract read either.
      await guarded(async () => {
        await asOwner();
        await db.exec(
          `ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT ${NAME};`,
        );
      });
      expect(await refusal(apply)).toEqual(refused);
    });
  });
});

describe("before the switch-over", () => {
  test("nothing is reclassified while the provider is typeform", async () => {
    await rolledBack(async () => {
      expect(await since()).toBeNull();
      const { callId } = await recording();
      await workerWrites({
        token: "tf-typeform-0001",
        at: later(30),
        linked: callId,
      });
      expect(await form("tf-typeform-0001")).toMatchObject({
        form_kind: "checkin",
        linked_call_id: callId,
      });
      expect(await lateAudits()).toEqual([]);
      expect(await legacy("tf-typeform-0001")).toEqual([]);
    });
  });
});

describe("after the switch-over", () => {
  test("a row at or after provider_since is late on insert, unlinked, audited once, and leaves one legacy response", async () => {
    await rolledBack(async () => {
      await flip();
      const at = (await since()) as Date;
      const { callId } = await recording();
      await workerWrites({ token: "tf-late-0001", at, linked: callId });
      expect(await form("tf-late-0001")).toMatchObject({
        form_kind: "checkin_late",
        task_id: A,
        linked_call_id: null,
      });
      const audits = await lateAudits("tf-late-0001");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        before: { formKind: "checkin" },
        after: { formKind: "checkin_late" },
      });
      expect(Object.keys(audits[0].metadata).sort()).toEqual([
        "nativeSince",
        "submittedAt",
        "taskId",
      ]);
      expect(audits[0].metadata.taskId).toBe(A);
      expect(JSON.stringify(audits[0])).not.toContain("Happy");
      const rows = await legacy("tf-late-0001");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        form_key: "checkin",
        form_version: 1,
        source: "typeform_sync",
        external_id: "tf-late-0001",
        task_id: A,
        client_name: "Acme Interiors",
        mode: "live",
        state: "legacy",
        answers: {},
        created_by: "typeform",
        created_by_id: null,
      });
      expect(rows[0].hidden).toEqual({
        typeformToken: "tf-late-0001",
        formId: "fRokTITH",
        submittedAt: rows[0].hidden.submittedAt,
      });
      expect(new Date(rows[0].hidden.submittedAt)).toEqual(at);
      expect(rows[0].submitted_at).toEqual(at);
      // Its audit row names the late Typeform, never an answer.
      const ra = await q<Row>(
        "SELECT action, actor_email, after FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_form_responses' AND after->>'external_id' = 'tf-late-0001'",
      );
      expect(ra).toHaveLength(1);
      expect(ra[0]).toMatchObject({
        action: "forms.late_typeform",
        actor_email: "typeform",
      });
      expect(ra[0].after.answers).toEqual({});
      // No effect for a legacy response.
      expect(
        await count("SELECT count(*) n FROM public.cockpit_form_effects"),
      ).toBe(0);
    });
  });

  test("an upsert that re-sends checkin, and an old worker's link patch, keep it late and unlinked, with no second row anywhere", async () => {
    await rolledBack(async () => {
      // Stored as checkin before the switch (its submit time just after it), then re-sent.
      await workerWrites({ token: "tf-resent-0001", at: later(60) });
      expect((await form("tf-resent-0001")).form_kind).toBe("checkin");
      await flip();
      const { callId } = await recording();
      await workerWrites({
        token: "tf-resent-0001",
        at: later(60),
        linked: callId,
      });
      expect(await form("tf-resent-0001")).toMatchObject({
        form_kind: "checkin_late",
        linked_call_id: null,
      });
      for (let i = 0; i < 2; i++)
        await workerWrites({
          token: "tf-resent-0001",
          at: later(60),
          linked: callId,
        });
      await q(
        "UPDATE public.cockpit_csm_call_forms SET linked_call_id = $1 WHERE token = 'tf-resent-0001'",
        [callId],
      );
      await q(
        "UPDATE public.cockpit_csm_call_forms SET form_kind = 'checkin' WHERE token = 'tf-resent-0001'",
      );
      expect(await form("tf-resent-0001")).toMatchObject({
        form_kind: "checkin_late",
        linked_call_id: null,
      });
      expect(await lateAudits("tf-resent-0001")).toHaveLength(1);
      expect(await legacy("tf-resent-0001")).toHaveLength(1);
      // A first write that is itself an upsert: one row too.
      await workerWrites({ token: "tf-upsert-0002", at: later(5) });
      await workerWrites({ token: "tf-upsert-0002", at: later(5) });
      expect((await form("tf-upsert-0002")).form_kind).toBe("checkin_late");
      expect(await lateAudits("tf-upsert-0002")).toHaveLength(1);
    });
  });

  test("a row before provider_since stays checkin; a late row with no card gets its legacy response when a person places it", async () => {
    await rolledBack(async () => {
      await workerWrites({ token: "tf-before-0001", at: ago(60) });
      await flip();
      await workerWrites({ token: "tf-before-0001", at: ago(60) });
      expect((await form("tf-before-0001")).form_kind).toBe("checkin");
      await workerWrites({ token: "tf-nocard-0002", at: later(5), task: null });
      expect(await form("tf-nocard-0002")).toMatchObject({
        form_kind: "checkin_late",
        task_id: null,
      });
      expect(await legacy("tf-nocard-0002")).toEqual([]);
      await q(
        "UPDATE public.cockpit_csm_call_forms SET task_id = $1, matched_by = 'manual' WHERE token = 'tf-nocard-0002'",
        [B],
      );
      expect(await legacy("tf-nocard-0002")).toMatchObject([
        { task_id: B, client_name: "Beta Build", state: "legacy" },
      ]);
      expect(await lateAudits()).toHaveLength(1);
    });
  });

  test("late is sticky after a flip back; a new row then is checkin again", async () => {
    await rolledBack(async () => {
      await flip();
      await workerWrites({ token: "tf-sticky-0001", at: later(5) });
      await flipBack();
      expect(await since()).toBeNull();
      await workerWrites({ token: "tf-sticky-0001", at: later(5) });
      expect((await form("tf-sticky-0001")).form_kind).toBe("checkin_late");
      await workerWrites({ token: "tf-after-0002", at: later(10) });
      expect((await form("tf-after-0002")).form_kind).toBe("checkin");
      expect(await lateAudits()).toHaveLength(1);
    });
  });

  test("a legacy failure is recorded and never blocks the store's write", async () => {
    await rolledBack(async () => {
      await flip();
      // A registry version with no published schema: the legacy insert's foreign key refuses it.
      await q(
        "UPDATE public.cockpit_forms SET version = 99 WHERE key = 'checkin'",
      );
      await workerWrites({ token: "tf-failed-0001", at: later(5) });
      expect((await form("tf-failed-0001")).form_kind).toBe("checkin_late");
      expect(await legacy("tf-failed-0001")).toEqual([]);
      const failed = await q<Row>(
        "SELECT entity_id, metadata FROM public.cockpit_audit_log WHERE action = 'forms.late_typeform_failed'",
      );
      expect(failed).toHaveLength(1);
      expect(failed[0].entity_id).toBe("tf-failed-0001");
      expect(failed[0].metadata.error).toContain("foreign key");
      expect(
        await one("SELECT current_setting('cockpit.forms_action', true) AS r"),
      ).toBe("");
    });
  });
});

describe("a late form is never read as the client's notes", () => {
  test("invisible to call_noted_at, the tie rule's form link, the matcher, the drafts, the calls summary and the timeline's call form", async () => {
    await rolledBack(async () => {
      // An earlier Typeform note, before the switch-over (the baseline every reader shows).
      await workerWrites({ token: "tf-old-0001", at: ago(600) });
      await flip();
      // A closer's recording on no client: only a stored check-in form's link could tie it (rule 3).
      const sales = await recording({ task: null, team: "Sales" });
      // The CSM's recording on Acme, the call the late form names.
      const csm = await recording();
      await workerWrites({
        token: "tf-late-0001",
        at: later(5),
        share: sales.share,
        linked: sales.callId,
      });
      await workerWrites({
        token: "tf-late-0002",
        at: later(6),
        share: csm.share,
        linked: csm.callId,
      });
      const fathomCall = (r: { rec: string; share: string; callId: number }) =>
        JSON.stringify({
          kind: "fathom",
          recordingId: r.rec,
          shareUrl: r.share,
          callId: r.callId,
        });
      for (const r of [sales, csm])
        expect(
          await one(
            "SELECT public.cockpit_form_call_noted_at(gen_random_uuid(), $1::jsonb, NULL) AS r",
            [fathomCall(r)],
          ),
        ).toBeNull();
      expect(
        await one(
          "SELECT public.cockpit_form_recording_tied($1, $2, NULL) AS r",
          [sales.rec, A],
        ),
      ).toBe(false);
      const inputs = await as<Row>(
        "service",
        "SELECT public.cockpit_fathom_match_inputs($1::timestamptz, $2::timestamptz, $3) AS r",
        [ago(48 * 60), later(60).toISOString(), A],
      );
      expect(JSON.stringify(inputs.formLinks)).not.toContain(sales.share);
      expect(JSON.stringify(inputs.formLinks)).not.toContain(csm.share);
      const drafts = await as<Row>(
        "service",
        "SELECT public.cockpit_form_draft_inputs($1, $2) AS r",
        [A, csm.rec],
      );
      expect(new Date(drafts.lastForm.at)).toEqual(
        new Date(
          await one(
            "SELECT submitted_at AS r FROM public.cockpit_csm_call_forms WHERE token = 'tf-old-0001'",
          ),
        ),
      );
      const summary = await as<Row>(
        CSM,
        "SELECT public.cockpit_csm_calls_summary() AS r",
      );
      expect(new Date(summary.clients[A].lastNoteAt)).toEqual(
        new Date(drafts.lastForm.at),
      );
      const timeline = await as<Row>(
        CSM,
        "SELECT public.cockpit_csm_client_timeline($1) AS r",
        [A],
      );
      const call = (timeline.calls as Row[]).find(
        c => Number(c.id) === csm.callId,
      ) as Row;
      expect(call.form).toBeNull();
      // The control: the same link in a checkin form would tie it.
      await workerWrites({
        token: "tf-control-0003",
        at: ago(30),
        share: sales.share,
      });
      expect(
        await one(
          "SELECT public.cockpit_form_recording_tied($1, $2, NULL) AS r",
          [sales.rec, A],
        ),
      ).toBe(true);
    });
  });

  test("never trips the one-live-recording index and never blocks a native send of the same call", async () => {
    await rolledBack(async () => {
      await flip();
      const csm = await recording();
      await workerWrites({
        token: "tf-late-0001",
        at: later(5),
        share: csm.share,
        linked: csm.callId,
      });
      expect(await legacy("tf-late-0001")).toHaveLength(1);
      const id = "5e000000-0000-4000-8000-000000000001";
      const opened = await as<Row>(
        CSM,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [A, id],
      );
      expect(opened.form.mode).toBe("live");
      const saved = await as<Row>(
        CSM,
        "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-test-0001', $3) AS r",
        [
          id,
          JSON.stringify({
            call: {
              value: { kind: "fathom", recordingId: csm.rec, why: "picked" },
            },
            defcon: { value: "Happy" },
            priority: { value: "Medium" },
          }),
          opened.response.revision,
        ],
      );
      const sent = await as<Row>(
        CSM,
        "SELECT public.cockpit_form_submit($1::uuid, $2) AS r",
        [id, saved.row.revision],
      );
      expect(sent.response).toMatchObject({ mode: "live", state: "submitted" });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_form_responses WHERE form_key = 'checkin' AND mode = 'live'",
        ),
      ).toBe(2);
    });
  });
});
