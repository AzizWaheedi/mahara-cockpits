/**
 * Moving a recording to another client (20261029z_forms_move_recording.sql;
 * docs/forms/STAGE2B-CONTRACT.md 2.10, 3.8 and 4.11, build 11) on an
 * isolated PostgreSQL with Supabase's default privileges on, so a missing
 * REVOKE opens a function here as it would in production.
 *
 * It stands on the 2a base of section 8 in order (20261025n, 20261025o,
 * 20261026r, 20261026s, 20261026t, 20261027f, 20261027g, 20261027h over
 * 20261024a), cut from or applied as the canonical migrations the way
 * stage2a-fit-supabase.test.ts stands on them, then
 * 20261029s_forms_registry.sql and 20261029z_forms_move_recording.sql, each
 * twice. cockpit_settings is cut from 20260921a with its live grants (the
 * service role writes it in full, so the audit trigger is the only trace).
 *
 * Covered: every refusal and its sentence with nothing written; an admin's
 * and the CEO's move with the switch on, every column, the booking re-link
 * or none, the inherited kind dropped, the queue row resolved, one match
 * audit and one csm.recording_moved row; after a move the tie rule and the
 * CSM's save take the recording on its new client and not on its old one;
 * the drafts naming the recording held before the call row, with the send
 * after the move refused; the switch read; the settings audit for seed, set
 * and removal; grants.
 * The CEO's address is read from the CEO gate migration, never written here;
 * every other person, client, recording and room is invented.
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
const Z = "20261029z_forms_move_recording.sql";

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
type Refusal = { code: string; message: string };

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
let seedRows: Row[] = [];

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The order audit rows were written in: two statements of one transaction
  // share created_at, and the ids are random.
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await standOn();
  await seats();
  // A setting that is not a forms switch, there before the trigger.
  await db.exec(
    "INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ('working_hours', '{\"from\":\"10:00\"}', 'ceo')",
  );
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE) await db.exec(migration(file));
  for (const file of [S, Z]) await db.exec(migration(file));
  first = await functions();
  auditOnce = await count("SELECT count(*) n FROM public.cockpit_audit_log");
  for (const file of [S, Z]) await db.exec(migration(file));
  twiceFns = await functions();
  auditTwice = await count("SELECT count(*) n FROM public.cockpit_audit_log");
  seedRows = await q<Row>(
    "SELECT action, entity_type, entity_id, actor_email, source_system, before, after FROM public.cockpit_audit_log WHERE action LIKE 'forms.switch_%'",
  );
}, 300_000);
afterAll(async () => {
  await db?.close();
});

// --- The store ----------------------------------------------------------------------------------

let recSeq = 900001100;
/** A recording the worker placed on a client (by its room, linked to that client's booking when given). */
async function recording(
  o: {
    task?: string | null;
    booking?: number | null;
    cls?: string;
    gone?: boolean;
    candidate?: boolean;
    room?: string;
  } = {},
) {
  const rec = String(++recSeq);
  const room = o.room ?? `meet:rec-${rec}`;
  await q(
    `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
       external,invitees,url,share_url,summary,raw,class,room,recorder_team,gone_at)
     VALUES($1,'Invented call',$2,$3,$4,'Csm Test',true,'[]'::jsonb,$5,$6,'Invented summary.','{}'::jsonb,$7,$8,
            'Customer Success',$9)`,
    [
      rec,
      ago(70),
      ago(40),
      CSM_EMAIL,
      `https://fathom.video/calls/${rec}`,
      `https://fathom.video/share/test-${rec}`,
      o.cls ?? "client",
      room,
      o.gone ? ago(5) : null,
    ],
  );
  const task = o.task === undefined ? A : o.task;
  const [{ id }] = await q<{ id: number }>(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
       starts_at,ends_at,status,provider_status,host_email,recording_url,room,linked_call_id,candidate,hints)
     VALUES('fathom',$1,$2,$3,$4,$5,$6,'Invented call',$7,$8,'held','recorded',$9,$10,$11,$12,$13,'[{"why":"name"}]'::jsonb)
     RETURNING id`,
    [
      rec,
      task,
      task ? (task === A ? "Acme Interiors" : "Beta Build") : null,
      task ? "name" : null,
      task ? 0.6 : null,
      o.booking ? "checkin" : "other",
      ago(70),
      ago(40),
      CSM_EMAIL,
      `https://fathom.video/calls/${rec}`,
      room,
      o.booking ?? null,
      o.candidate ?? false,
    ],
  );
  return {
    rec,
    callId: Number(id),
    share: `https://fathom.video/share/test-${rec}`,
    room,
  };
}
/** A GoHighLevel booking of a client, in a room, around the recording's time. */
async function booking(task: string, room: string, kind = "checkin") {
  const [{ id }] = await q<{ id: number }>(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
       starts_at,ends_at,status,room)
     VALUES('ghl_appointment',$1,$2,$3,'client_id_field',1,$4,'Booked call',$5,$6,'confirmed',$7) RETURNING id`,
    [
      `appt-${++recSeq}`,
      task,
      task === A ? "Acme Interiors" : "Beta Build",
      kind,
      ago(72),
      ago(42),
      room,
    ],
  );
  return Number(id);
}
const switchOn = (on: boolean) =>
  q(
    "UPDATE public.cockpit_settings SET value = $1::jsonb, updated_by = 'test' WHERE key = 'forms.move_recording'",
    [JSON.stringify({ on })],
  );
const move = (who: string, rec: string, task: string) =>
  as<Row>(who, "SELECT public.cockpit_csm_move_recording($1, $2) AS r", [
    rec,
    task,
  ]);
const callRow = (id: number) =>
  q<Row>(
    `SELECT task_id, client_name, match_method, match_confidence::text AS confidence, candidate, settled_reason, hints,
            linked_call_id, kind FROM public.cockpit_csm_calls WHERE id = $1`,
    [id],
  ).then(r => r[0]);
const written = async () => ({
  audit: await count("SELECT count(*) n FROM public.cockpit_audit_log"),
  matchAudit: await count(
    "SELECT count(*) n FROM public.cockpit_csm_match_audit",
  ),
  calls: await q(
    "SELECT id, task_id, match_method, linked_call_id, kind FROM public.cockpit_csm_calls ORDER BY id",
  ),
});

// ---------------------------------------------------------------------------------------------

describe("the migration", () => {
  test("is one transaction that reloads the schema, seeds the switch off with one audit row, and applies twice", async () => {
    const sql = migration(Z);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    // The trigger is made before the seed.
    expect(
      sql.indexOf("CREATE TRIGGER cockpit_settings_forms_audit"),
    ).toBeLessThan(sql.indexOf("INSERT INTO public.cockpit_settings"));
    expect([...first].filter(([sig, v]) => twiceFns.get(sig) !== v)).toEqual(
      [],
    );
    expect(auditTwice).toBe(auditOnce);
    expect(
      await q(
        "SELECT key, value, updated_by FROM public.cockpit_settings ORDER BY key",
      ),
    ).toEqual([
      {
        key: "forms.move_recording",
        value: { on: false },
        updated_by: "migration",
      },
      { key: "working_hours", value: { from: "10:00" }, updated_by: "ceo" },
    ]);
    expect(seedRows).toEqual([
      {
        action: "forms.switch_seeded",
        entity_type: "cockpit_settings",
        entity_id: "forms.move_recording",
        actor_email: "migration",
        source_system: "supabase",
        before: null,
        after: { value: { on: false } },
      },
    ]);
  });

  test("grants: the move to authenticated only, the switch read to the service key only, the rest to no role", async () => {
    const acl = (sig: string) =>
      one<string | null>(
        "SELECT p.proacl::text AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
        [`public.${sig}`],
      );
    expect(await acl("cockpit_csm_move_recording(text,text)")).toBe(
      "{postgres=X/postgres,authenticated=X/postgres}",
    );
    expect(await acl("cockpit_forms_switch(text)")).toBe(
      "{postgres=X/postgres,service_role=X/postgres}",
    );
    expect(await acl("cockpit_settings_forms_audit()")).toBe(
      "{postgres=X/postgres}",
    );
    expect(await acl("cockpit_forms_switch_on(text)")).toBe(
      "{postgres=X/postgres}",
    );
    expect(
      (
        await refusal(() =>
          as(
            ADMIN,
            "SELECT public.cockpit_forms_switch('move_recording') AS r",
          ),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await refusal(() =>
          as(
            "service",
            "SELECT public.cockpit_csm_move_recording('900001', 'taskB1') AS r",
          ),
        )
      ).code,
    ).toBe("42501");
    // cockpit_settings keeps its live grants and row security.
    expect(
      await q(
        "SELECT relrowsecurity, relacl::text AS acl FROM pg_class WHERE oid = 'public.cockpit_settings'::regclass",
      ),
    ).toEqual([
      {
        relrowsecurity: true,
        acl: "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      },
    ]);
  });
});

describe("the switch", () => {
  test('reads off when missing, off when not a boolean, and on only when {"on": true}', async () => {
    await rolledBack(async () => {
      const read = (k: string) =>
        as<boolean>("service", "SELECT public.cockpit_forms_switch($1) AS r", [
          k,
        ]);
      expect(await read("move_recording")).toBe(false);
      expect(await read("nothing_here")).toBe(false);
      await switchOn(true);
      expect(await read("move_recording")).toBe(true);
      await q(
        "UPDATE public.cockpit_settings SET value = '{\"on\":\"yes\"}' WHERE key = 'forms.move_recording'",
      );
      expect(await read("move_recording")).toBe(false);
    });
  });

  test("every change of a forms switch leaves one audit row, whoever writes it; another setting none", async () => {
    await rolledBack(async () => {
      const rows = () =>
        q<Row>(
          "SELECT action, entity_id, actor_email, before, after FROM public.cockpit_audit_log WHERE action LIKE 'forms.switch_%' ORDER BY test_seq",
        );
      const before = (await rows()).length;
      // The service key through REST, as a person with the key could.
      await as(
        "service",
        "UPDATE public.cockpit_settings SET value = '{\"on\":true}', updated_by = 'someone-with-the-key' WHERE key = 'forms.move_recording' RETURNING 1 AS r",
      );
      // The cut-over hour's step 9.
      await q("SELECT set_config('cockpit.audit_actor', 'cut-over', true)");
      await q(
        "UPDATE public.cockpit_settings SET value = '{\"on\":false}', updated_by = 'cut-over' WHERE key = 'forms.move_recording'",
      );
      await q("SELECT set_config('cockpit.audit_actor', '', true)");
      await q(
        "INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ('forms.other', '{\"on\":true}', 'test')",
      );
      await q("DELETE FROM public.cockpit_settings WHERE key = 'forms.other'");
      await q(
        "UPDATE public.cockpit_settings SET value = '{\"from\":\"09:00\"}' WHERE key = 'working_hours'",
      );
      expect((await rows()).slice(before)).toEqual([
        {
          action: "forms.switch_set",
          entity_id: "forms.move_recording",
          actor_email: "someone-with-the-key",
          before: { value: { on: false } },
          after: { value: { on: true } },
        },
        {
          action: "forms.switch_set",
          entity_id: "forms.move_recording",
          actor_email: "cut-over",
          before: { value: { on: true } },
          after: { value: { on: false } },
        },
        {
          action: "forms.switch_seeded",
          entity_id: "forms.other",
          actor_email: "test",
          before: null,
          after: { value: { on: true } },
        },
        {
          action: "forms.switch_removed",
          entity_id: "forms.other",
          actor_email: "postgres",
          before: { value: { on: true } },
          after: null,
        },
      ]);
    });
  });

  test("a REST flip that leaves updated_by alone names the door it came through, never the seed's migration", async () => {
    await rolledBack(async () => {
      const rows = () =>
        q<Row>(
          "SELECT action, entity_id, actor_email, before, after FROM public.cockpit_audit_log WHERE action = 'forms.switch_set' ORDER BY test_seq",
        );
      // PostgREST logs in as authenticator and takes the key's role for the request.
      await q("CREATE ROLE authenticator NOINHERIT");
      await q("GRANT service_role TO authenticator");
      // PGlite restores neither RESET nor a savepoint rollback of the session
      // user, so the owner is set back by name, outside the step's own savepoint.
      const viaRest = (text: string) =>
        guarded(async () => {
          await db.exec(
            "SAVEPOINT rest; SET SESSION AUTHORIZATION authenticator; SET ROLE service_role",
          );
          try {
            await db.exec(text);
            await db.exec("RELEASE SAVEPOINT rest");
          } catch (e) {
            await db.exec("ROLLBACK TO SAVEPOINT rest");
            throw e;
          } finally {
            await db.exec("RESET ROLE; SET SESSION AUTHORIZATION postgres");
          }
        });
      await viaRest(
        "UPDATE public.cockpit_settings SET value = '{\"on\":true}', updated_at = now() WHERE key = 'forms.move_recording'",
      );
      // The service key outside the REST door (a script on the owner's session) reads as that session.
      await as(
        "service",
        "UPDATE public.cockpit_settings SET value = '{\"on\":false}', updated_at = now() WHERE key = 'forms.move_recording' RETURNING 1 AS r",
      );
      // A writer that names itself is still believed, and only when it changes updated_by.
      await viaRest(
        "UPDATE public.cockpit_settings SET value = '{\"on\":true}', updated_by = 'someone-with-the-key' WHERE key = 'forms.move_recording'",
      );
      await viaRest(
        "UPDATE public.cockpit_settings SET value = '{\"on\":false}' WHERE key = 'forms.move_recording'",
      );
      expect(
        await one<string>(
          "SELECT updated_by AS r FROM public.cockpit_settings WHERE key = 'forms.move_recording'",
        ),
      ).toBe("someone-with-the-key");
      expect(await rows()).toEqual([
        {
          action: "forms.switch_set",
          entity_id: "forms.move_recording",
          actor_email: "authenticator",
          before: { value: { on: false } },
          after: { value: { on: true } },
        },
        {
          action: "forms.switch_set",
          entity_id: "forms.move_recording",
          actor_email: "postgres",
          before: { value: { on: true } },
          after: { value: { on: false } },
        },
        {
          action: "forms.switch_set",
          entity_id: "forms.move_recording",
          actor_email: "someone-with-the-key",
          before: { value: { on: false } },
          after: { value: { on: true } },
        },
        {
          action: "forms.switch_set",
          entity_id: "forms.move_recording",
          actor_email: "authenticator",
          before: { value: { on: true } },
          after: { value: { on: false } },
        },
      ]);
    });
  });
});

describe("cockpit_csm_move_recording", () => {
  test("every refusal says why and writes nothing", async () => {
    await rolledBack(async () => {
      const wrong = await recording();
      const free = await recording({ task: null, candidate: true });
      const team = await recording({ cls: "internal" });
      const gone = await recording({ gone: true });
      const before = await written();
      const refused = async (who: string, rec: string, task: string) =>
        refusal(() => move(who, rec, task));
      // Off: even an admin.
      expect(await refused(ADMIN, wrong.rec, B)).toEqual({
        code: "22023",
        message: "Moving a recording is not switched on yet.",
      });
      await switchOn(true);
      const writtenOn = await written();
      expect(await refused(CSM, wrong.rec, B)).toEqual({
        code: "42501",
        message:
          "Only an admin or the CEO can move a recording to another client.",
      });
      expect(await refused(GONE, wrong.rec, B)).toEqual({
        code: "42501",
        message: "Sign in to the cockpit first.",
      });
      expect(
        (
          await refusal(() =>
            as(
              null as unknown as string,
              "SELECT public.cockpit_csm_move_recording('1', 'x') AS r",
            ),
          )
        ).code,
      ).toBe("42501");
      expect(await refused(ADMIN, wrong.rec, "bad id!")).toEqual({
        code: "22023",
        message: "Choose a valid ClickUp client ID",
      });
      expect(await refused(ADMIN, "12", B)).toEqual({
        code: "22023",
        message:
          "That recording is not in the cockpit yet. Check again in a minute.",
      });
      expect((await refused(ADMIN, wrong.rec, "taskZ9")).message).toBe(
        "The client ID is missing or ambiguous. Refresh its native source",
      );
      expect(await refused(ADMIN, free.rec, B)).toEqual({
        code: "22023",
        message:
          "That recording is not on another client. Pick it from the list.",
      });
      expect(await refused(ADMIN, "999999999", B)).toEqual({
        code: "22023",
        message:
          "That recording is not on another client. Pick it from the list.",
      });
      expect(await refused(ADMIN, wrong.rec, A)).toEqual({
        code: "22023",
        message: "That recording is already on this client.",
      });
      expect(await refused(ADMIN, team.rec, B)).toEqual({
        code: "22023",
        message: "That recording is a team meeting, not a client call.",
      });
      expect(await refused(CEO, gone.rec, B)).toEqual({
        code: "22023",
        message: "Fathom no longer has that recording. Pick another call.",
      });
      expect(await written()).toEqual(writtenOn);
      expect(writtenOn.calls).toEqual(before.calls);
    });
  });

  test("a recording with 1-1 notes stays: a form linked to it or its booking, a form with its link, a live sent check-in", async () => {
    await rolledBack(async () => {
      await switchOn(true);
      const sentence =
        "That recording has 1-1 notes on Acme Interiors. If those notes are on the wrong client too, tell the tech lead.";
      // A stored form linked to the recording's row.
      const r1 = await recording();
      await q(
        "INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at, linked_call_id) VALUES ('tf-link-1', 'fRokTITH', 'checkin', $1, 'hidden_field', now(), $2)",
        [A, r1.callId],
      );
      // A form linked to the booking the recording is linked to.
      const room = "meet:abc-defg-hij";
      const bk = await booking(A, room);
      const r2 = await recording({ booking: bk, room });
      await q(
        "INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at, linked_call_id) VALUES ('tf-link-2', 'fRokTITH', 'checkin', $1, 'hidden_field', now(), $2)",
        [A, bk],
      );
      // A form holding the recording's share link and linked to nothing.
      const r3 = await recording();
      await q(
        "INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at, recording_url) VALUES ('tf-link-3', 'fRokTITH', 'checkin', $1, 'hidden_field', now(), $2)",
        [A, r3.share],
      );
      // A live sent check-in naming the recording.
      const r4 = await recording();
      await q(
        `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, client_name, mode, state, answers,
           created_by, submitted_at)
         VALUES ('checkin', 1, 'import', $1, 'Acme Interiors', 'live', 'submitted', $2::jsonb, 'import', now())`,
        [A, JSON.stringify({ call: { kind: "fathom", recordingId: r4.rec } })],
      );
      const before = await written();
      for (const r of [r1, r2, r3, r4])
        expect(await refusal(() => move(ADMIN, r.rec, B))).toEqual({
          code: "22023",
          message: sentence,
        });
      expect(await written()).toEqual(before);
    });
  });

  test("a move holds the drafts naming the recording before its call row, so a send in flight is waited for and a later send is refused", async () => {
    await rolledBack(async () => {
      await switchOn(true);
      const r = await recording();
      const other = await recording();
      const draft = async (seat: string, rec: string) =>
        (
          await q<{ id: string }>(
            `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, client_name, mode, state, answers,
               created_by, created_by_id)
             VALUES ('checkin', 1, 'cockpit', $1, 'Acme Interiors', 'shadow', 'draft', $2::jsonb, 'csm@tests.invalid', $3::uuid)
             RETURNING id`,
            [
              A,
              JSON.stringify({
                call: {
                  kind: "fathom",
                  recordingId: rec,
                  why: "picked",
                  confirmed: true,
                },
                defcon: "At Risk",
                priority: "Invented priority",
              }),
              seat,
            ],
          )
        )[0].id;
      // A row lock leaves xmax set, even for the transaction that took it, and
      // PGlite's one connection cannot show the wait itself.
      const held = (id: string) =>
        one<boolean>(
          "SELECT xmax::text <> '0' AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
          [id],
        );
      const mine = await draft(CSM, r.rec);
      const second = await draft(ADMIN, r.rec);
      const elsewhere = await draft(CEO, other.rec);
      expect(await held(mine)).toBe(false);

      await move(ADMIN, r.rec, B);
      expect(await held(mine)).toBe(true);
      expect(await held(second)).toBe(true);
      expect(await held(elsewhere)).toBe(false);

      // The lock comes first: the send holds its response, then the attach
      // takes the call row, so the other order could deadlock with it.
      const body = await one<string>(
        "SELECT p.prosrc AS r FROM pg_proc p WHERE p.proname = 'cockpit_csm_move_recording'",
      );
      const drafts = body.indexOf("r.state = 'draft'");
      expect(drafts).toBeGreaterThan(0);
      expect(drafts).toBeLessThan(body.indexOf("public.cockpit_csm_calls x"));

      // The send that was waiting on that lock now reads the moved recording.
      expect(
        await refusal(() =>
          as(CSM, "SELECT public.cockpit_form_submit($1::uuid, NULL) AS r", [
            mine,
          ]),
        ),
      ).toEqual({
        code: "22023",
        message:
          "That recording is on Beta Build. If that is wrong, ask an admin to move it.",
      });
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
          [mine],
        ),
      ).toBe("draft");
    });
  });

  test("an admin moves it: every column, the target's booking linked, the queue row resolved, one match audit and one audit row", async () => {
    await rolledBack(async () => {
      await switchOn(true);
      const room = "meet:kln-opqr-stu";
      const acmeBooking = await booking(A, "meet:other-room");
      const r = await recording({ booking: acmeBooking, room });
      const betaBooking = await booking(B, room, "onboarding");
      await q(
        "INSERT INTO public.cockpit_csm_unmatched(item_kind, item_ref, reason) VALUES ('call', $1, 'The worker was not sure.')",
        [String(r.callId)],
      );
      const out = await move(ADMIN, r.rec, B);
      expect(out).toEqual({
        ok: true,
        callId: r.callId,
        fromTaskId: A,
        taskId: B,
      });
      expect(await callRow(r.callId)).toEqual({
        task_id: B,
        client_name: "Beta Build",
        match_method: "manual",
        confidence: "1",
        candidate: false,
        settled_reason: null,
        hints: [],
        linked_call_id: betaBooking,
        kind: "onboarding",
      });
      expect(
        await q(
          "SELECT resolved_task_id, resolved_by FROM public.cockpit_csm_unmatched WHERE item_ref = $1",
          [String(r.callId)],
        ),
      ).toEqual([{ resolved_task_id: B, resolved_by: "admin@tests.invalid" }]);
      expect(
        await q(
          "SELECT item_kind, item_ref, task_id, actor_id::text, actor_email FROM public.cockpit_csm_match_audit",
        ),
      ).toEqual([
        {
          item_kind: "call",
          item_ref: String(r.callId),
          task_id: B,
          actor_id: ADMIN,
          actor_email: "admin@tests.invalid",
        },
      ]);
      const audit = await q<Row>(
        "SELECT actor_email, before, after, metadata FROM public.cockpit_audit_log WHERE action = 'csm.recording_moved'",
      );
      expect(audit).toEqual([
        {
          actor_email: "admin@tests.invalid",
          before: {
            taskId: A,
            clientName: "Acme Interiors",
            matchMethod: "name",
            matchConfidence: 0.6,
            linkedCallId: acmeBooking,
            kind: "checkin",
          },
          after: {
            taskId: B,
            clientName: "Beta Build",
            matchMethod: "manual",
            matchConfidence: 1,
            linkedCallId: betaBooking,
            kind: "onboarding",
          },
          metadata: { recordingId: r.rec, callId: r.callId },
        },
      ]);
    });
  });

  test("the CEO moves one with no booking on the target: no link, and the kind it inherited from the old booking is dropped", async () => {
    await rolledBack(async () => {
      await switchOn(true);
      const acmeBooking = await booking(A, "meet:acme-room");
      const r = await recording({
        booking: acmeBooking,
        room: "meet:acme-room",
      });
      await move(CEO, r.rec, B);
      expect(await callRow(r.callId)).toMatchObject({
        task_id: B,
        linked_call_id: null,
        kind: "other",
        match_method: "manual",
      });
      // One with no old link keeps its own kind.
      const plain = await recording();
      await move(CEO, plain.rec, B);
      expect((await callRow(plain.callId)).kind).toBe("other");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'csm.recording_moved'",
        ),
      ).toBe(2);
    });
  });

  test("after a move the recording stands for its new client, for the CSM's save too, and no longer for the old one", async () => {
    await rolledBack(async () => {
      await switchOn(true);
      const r = await recording();
      const tied = (task: string) =>
        one<boolean>(
          "SELECT public.cockpit_form_recording_tied($1, $2, $3::uuid) AS r",
          [r.rec, task, CSM],
        );
      const save = async (task: string, id: string) => {
        // The seat's open draft for the card is resumed, whatever ID the window asks with.
        const opened = await as<Row>(
          CSM,
          "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
          [task, id],
        );
        return as<Row>(
          CSM,
          "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-test-0001', $3) AS r",
          [
            opened.response.id,
            JSON.stringify({
              call: {
                value: { kind: "fathom", recordingId: r.rec, why: "picked" },
              },
            }),
            opened.response.revision,
          ],
        );
      };
      expect(await tied(B)).toBe(false);
      expect(
        await refusal(() => save(B, "5f000000-0000-4000-8000-000000000001")),
      ).toEqual({
        code: "22023",
        message:
          "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.",
      });
      await move(ADMIN, r.rec, B);
      expect(await tied(B)).toBe(true);
      expect(await tied(A)).toBe(false);
      const saved = await save(B, "5f000000-0000-4000-8000-000000000002");
      expect(saved.row.answers.call).toMatchObject({
        kind: "fathom",
        recordingId: r.rec,
        confirmed: true,
      });
      // The send's attach still refuses another client's recording: moving it back stays a gesture.
      expect(
        (
          await refusal(() =>
            one(
              "SELECT public.cockpit_csm_attach_recording($1, 'Acme Interiors', $2, $3::jsonb) AS r",
              [
                A,
                r.rec,
                JSON.stringify({
                  actorId: ADMIN,
                  email: "admin@tests.invalid",
                }),
              ],
            ),
          )
        ).message,
      ).toBe(
        "That recording is on Beta Build. If that is wrong, ask an admin to move it.",
      );
    });
  });
});
