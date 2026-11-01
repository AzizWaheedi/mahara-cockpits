/**
 * The forms base for stage 3 (20261101l_forms_stage3_base.sql;
 * docs/forms/WAVE12-CONTRACT.md 2.3, 3.1, 3.4, 4.3, 4.4 and the
 * forms-foundation row of section 8) on an isolated PostgreSQL with
 * Supabase's default privileges on, so a missing REVOKE opens a function here
 * as it would in production.
 *
 * It stands on the 2a base and the eight 2b files exactly as
 * stage2b-fit-supabase.test.ts builds them (the same cut of the canonical
 * migrations), plus the billing sheet's two tables (20260923a) and the churn
 * register (20261001a), then applies 20261101l twice. The vault is a
 * plain-text stand-in, inside this test only.
 *
 * Covered: the file applies twice and changes nothing the second time; the
 * drift guard refuses a changed body; every replaced function keeps its live
 * grant and every new one has exactly 2.3's; the four CHECKs and the
 * outbox's card rule widen; the six settings rows and the two S0 channel rows
 * seed; a signing key saves for each new form and the door's health row is
 * written per form, kickoff's words unchanged; cockpit_form_record_legacy is
 * idempotent, dates the notice in Kuwait time, queues termination.notice once
 * for a live survey and nothing for a backfilled one or a pause request, and
 * links a departure only once 20261101o's columns exist; the registry's
 * allow-list and the W19 refusal; cockpit_form_staff_record's two sources;
 * cockpit_form_doors' flags; the gates of the match, the trail and the
 * notices in; the notice kinds' live rules; finance's and creative's views of
 * the notices; anon refused everywhere. The CEO's address is read from the
 * CEO gate migration, never written here; every other person, client and
 * value is invented.
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
setDefaultTimeout(180_000);

const BASE_2A = [
  "20261025n_slack_notices.sql",
  "20261025o_blueprint_close_drain.sql",
  "20261026r_requests.sql",
  "20261026s_request_types_seed.sql",
  "20261026t_task_alerts.sql",
  "20261027f_forms_core.sql",
  "20261027g_fathom_intake.sql",
  "20261027h_checkin_plans.sql",
] as const;
const FILES_2B = [
  "20261029s_forms_registry.sql",
  "20261029t_forms_clickup_writeback.sql",
  "20261029u_forms_checkin_notices.sql",
  "20261029v_forms_client_messages.sql",
  "20261029w_forms_dispatch.sql",
  "20261029x_forms_late_typeform.sql",
  "20261029y_forms_records.sql",
  "20261029z_forms_move_recording.sql",
] as const;
const L = "20261101l_forms_stage3_base.sql";

const AUTH = "{postgres=X/postgres,authenticated=X/postgres}";
const SVC = "{postgres=X/postgres,service_role=X/postgres}";
const OWNER = "{postgres=X/postgres}";
/** 2.2's replaced functions (and the responses guard) with the grant each keeps; 2.3's new ones with theirs. */
const ACL: [string, string][] = [
  ["cockpit_slack_notice_shape(text)", OWNER],
  ["cockpit_slack_notice_kind_label(text)", OWNER],
  ["cockpit_slack_notice_live(cockpit_slack_notices)", OWNER],
  ["cockpit_slack_notice_inputs(jsonb)", SVC],
  ["cockpit_slack_notice_doctor_inputs()", SVC],
  ["cockpit_slack_notice_settings_read()", AUTH],
  ["cockpit_slack_notice_settings_set(text,jsonb)", AUTH],
  ["cockpit_slack_channel_remove(text)", AUTH],
  ["cockpit_slack_notice_rehearse(text)", AUTH],
  ["cockpit_slack_notice_rehearse_service(text,text)", SVC],
  ["cockpit_slack_notice_read(text)", AUTH],
  ["cockpit_forms_key_put(jsonb)", SVC],
  ["cockpit_forms_key_mark(jsonb)", SVC],
  ["cockpit_forms_key_label(text)", OWNER],
  ["cockpit_forms_keys_status()", AUTH],
  ["cockpit_forms_door_seen(text,text,text)", SVC],
  ["cockpit_form_registry_apply(text,jsonb,jsonb)", OWNER],
  ["cockpit_form_responses_guard()", OWNER],
  ["cockpit_form_record_legacy(jsonb)", SVC],
  ["cockpit_form_legacy_match(uuid,text)", AUTH],
  ["cockpit_form_staff_record(text,text,jsonb,uuid,text)", OWNER],
  ["cockpit_form_trail(jsonb)", AUTH],
  ["cockpit_form_notices_in()", AUTH],
  ["cockpit_form_doors()", AUTH],
  ["cockpit_request_type_add(jsonb)", OWNER],
  ["cockpit_form_column_exists(text,text)", OWNER],
  ["cockpit_form_survey_link(uuid,text,text)", OWNER],
];
const SIX = [
  "termination.notice",
  "termination.submitted",
  "churn.confirmed",
  "extension.granted",
  "pause.agreed",
  "client.resumed",
] as const;
const CSM_GENERAL = "C09RZ0GS0V9";
const ANNOUNCE = "C09SNG5BP53";
const NPS = "C09TTGBRQ0G";

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
const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // CSM of Acme only
const CSM_B = "00000000-0000-4000-8000-0000000000a2"; // CSM of Beta only
const FINANCE = "00000000-0000-4000-8000-0000000000b1";
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative, every client
const NOBODY = "00000000-0000-4000-8000-0000000000f5"; // a seat with no role

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
async function ex(text: string): Promise<void> {
  await guarded(async () => {
    await asOwner();
    await db.exec(text);
  });
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0]?.r as T;
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
/** One value as a seat (its auth id), as anon (null) or as PostgREST with the service key. */
async function as<T = any>(
  who: string | null | "service",
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

const VAULT = `
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text NOT NULL DEFAULT '',
    secret text NOT NULL, key_id uuid, nonce bytea,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE VIEW vault.decrypted_secrets AS
    SELECT s.id, s.name, s.description, s.secret, s.secret AS decrypted_secret, s.key_id, s.nonce, s.created_at, s.updated_at
      FROM vault.secrets s;
  CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '',
    new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
  DECLARE v uuid;
  BEGIN
    INSERT INTO vault.secrets(name, description, secret, key_id)
    VALUES (new_name, coalesce(new_description, ''), new_secret, new_key_id) RETURNING id INTO v;
    RETURN v;
  END $$;
  CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL,
    new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
      description = coalesce(new_description, description), key_id = coalesce(new_key_id, key_id), updated_at = now()
     WHERE id = secret_id;
  END $$;
  REVOKE ALL ON SCHEMA vault FROM PUBLIC;
  REVOKE ALL ON FUNCTION vault.create_secret(text,text,text,uuid), vault.update_secret(uuid,text,text,text,uuid) FROM PUBLIC;`;

// --- The database the 2b files stand on (stage2b-fit-supabase.test.ts's cut) -------------------

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
      "20260921a_cockpit_settings.sql",
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
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

/** The billing sheet's two tables and the churn register, as their canonical migrations make them. */
async function billingAndChurn() {
  const billing = migration("20260923a_client_billing.sql");
  await db.exec(
    cut(
      billing,
      /create table if not exists public\.cockpit_billing_accounts \([\s\S]*?\n\);/,
      "billing accounts",
    ),
  );
  await db.exec(
    cut(
      billing,
      /create table if not exists public\.cockpit_billing_events \([\s\S]*?\n\);/,
      "billing events",
    ),
  );
  const churn = migration("20261001a_churn_tracker.sql");
  await db.exec(
    cut(
      churn,
      /create table if not exists public\.cockpit_churn_departures \([\s\S]*?\n\);/,
      "departures",
    ),
  );
  await db.exec(
    cut(
      churn,
      /create unique index if not exists cockpit_churn_departures_card_day[\s\S]*?;/,
      "departures card day",
    ),
  );
  await db.exec(`
    ALTER TABLE public.cockpit_billing_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_billing_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_churn_departures ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_billing_accounts, public.cockpit_billing_events, public.cockpit_churn_departures
      FROM PUBLIC, anon, authenticated;`);
}

/** The seats: the CEO, an admin, a CSM for each client, finance, a creative and a seat with no role. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM_A, "csm.a@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm.b@tests.invalid", ["csm"]);
  await member(db, FINANCE, "finance@tests.invalid", ["finance"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await member(db, NOBODY, "nobody@tests.invalid", ["editor"]);
  await db.query(
    "UPDATE public.cockpit_members SET clients = ARRAY['Acme Interiors'] WHERE auth_user_id = $1",
    [CSM_A],
  );
  await db.query(
    "UPDATE public.cockpit_members SET clients = ARRAY['Beta Build'] WHERE auth_user_id = $1",
    [CSM_B],
  );
  for (const [name, email, role] of [
    ["Noura Test", "csm.a@tests.invalid", "Client success manager"],
    ["Huda Test", "csm.b@tests.invalid", "Client success manager"],
    ["Ceo Test", CEO_EMAIL, "CEO"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );
  // The client roster the CSM gate reads (cockpit_csm_client_gate), as the fit test seeds it.
  const snap = "2026-10-28T08:00:00Z";
  for (const [taskId, name] of [
    [A, "Acme Interiors"],
    [B, "Beta Build"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({
          _id: `c-${taskId}`,
          taskId,
          name,
          stage: "Active",
          happiness: "Happy",
        }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=2,source_snapshot_at=$1 WHERE table_name='clients'",
    [snap],
  );
  await db.exec(`
    INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage, client_status, next_payment_date, mrr_usd)
    VALUES ('${A}', 'Acme Interiors', 'active', 'Active', '2026-11-05', 2000),
           ('${B}', 'Beta Build', 'active', 'Active', '2026-11-09', 1500);`);
}

/** Every public function's body md5 and grant, every CHECK, and the rows this file seeds. */
async function shape() {
  const fns = Object.fromEntries(
    (
      await q<{ sig: string; md5: string; acl: string | null }>(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind IN ('f','p')`,
      )
    ).map(r => [r.sig, `${r.md5}|${r.acl}`]),
  );
  const checks = Object.fromEntries(
    (
      await q<{ k: string; d: string }>(
        `SELECT c.conrelid::regclass::text || '.' || c.conname AS k, pg_get_constraintdef(c.oid) AS d
           FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`,
      )
    ).map(r => [r.k, r.d]),
  );
  const rows: Record<string, number> = {};
  for (const t of [
    "cockpit_slack_notice_settings",
    "cockpit_slack_channels",
    "cockpit_forms",
    "cockpit_form_versions",
    "cockpit_audit_log",
  ])
    rows[t] = await count(`SELECT count(*) n FROM public.${t}`);
  return { fns, checks, rows };
}
type Shape = Awaited<ReturnType<typeof shape>>;
let before: Shape;
let once: Shape;
let twice: Shape;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(VAULT);
  await standOn();
  await billingAndChurn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE_2A) await db.exec(migration(file));
  for (const file of FILES_2B) await db.exec(migration(file));
  before = await shape();
  await db.exec(migration(L));
  once = await shape();
  await db.exec(migration(L));
  twice = await shape();
}, 600_000);
afterAll(async () => {
  await db?.close();
});

const svc = (fn: string, args: unknown[] = []) =>
  as("service", `SELECT to_jsonb(public.${fn}) AS r`, args);
/** A legacy record through the service key, as forms-door and the backfill call it. */
const legacy = (p: Row) =>
  svc("cockpit_form_record_legacy($1::jsonb)", [JSON.stringify(p)]);
/** A termination survey on a card, submitted at 01:30 on 1 Nov in Kuwait (22:30 UTC the day before). */
const survey = (token: string, extra: Row = {}): Row => ({
  formKey: "exit_survey",
  externalId: token,
  submittedAt: "2026-10-31T22:30:00Z",
  answers: {
    fields: [
      {
        ref: "eafeb9cf-70b5-46c0-9432-4db2998d5bf1",
        title: "Reason",
        type: "multiple_choice",
        value: ["Results"],
      },
      {
        ref: "62edbc75-ca88-4f1f-875d-5e79939a7edf",
        title: "Ad performance",
        type: "rating",
        value: 4,
      },
    ],
  },
  hidden: {
    client_name: "Acme Interiors",
    onboarding_client_id: A,
    email: "owner@acme.invalid",
  },
  taskId: A,
  ...extra,
});

describe("the file applies on the 2b base", () => {
  test("a second apply changes no function, grant, CHECK or seeded row", () => {
    expect(twice.fns).toEqual(once.fns);
    expect(twice.checks).toEqual(once.checks);
    expect(twice.rows).toEqual(once.rows);
  });

  test("it replaces exactly 2.2's functions (and the responses guard), each to the body this file holds", async () => {
    const replaced = ACL.slice(0, 18).map(([sig]) => sig);
    for (const sig of replaced)
      expect(once.fns[sig], sig).not.toEqual(before.fns[sig]);
    const changed = Object.keys(before.fns).filter(
      sig => once.fns[sig] !== before.fns[sig],
    );
    expect(changed.sort()).toEqual([...replaced].sort());
    // Each body's after md5 is the value the file's drift guard names.
    const text = migration(L);
    for (const sig of replaced) {
      const name = sig.split("(")[0];
      const md5 = await one<string>(
        "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
        [
          `public.${sig.replace("(cockpit_slack_notices)", "(public.cockpit_slack_notices)")}`,
        ],
      );
      expect(text, `${name}'s after md5`).toContain(`', '${md5}')`);
    }
  });

  test("every function keeps or gets 2.3's grant", () => {
    for (const [sig, acl] of ACL)
      expect(once.fns[sig]?.split("|")[1], sig).toBe(acl);
  });

  test("the drift guard refuses a body changed since the contract read it", async () => {
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_kind_label(p_kind text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT p_kind $$",
      );
      const r = await refusal(() => ex(migration(L)));
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_slack_notice_kind_label(text) changed since the waves 1-2 contract read it; stop and re-read it.",
      );
    });
  });

  test("a CHECK changed by someone else stops the file", async () => {
    await rolledBack(async () => {
      await ex(`ALTER TABLE public.cockpit_forms_keys DROP CONSTRAINT cockpit_forms_keys_provider_check;
        ALTER TABLE public.cockpit_forms_keys ADD CONSTRAINT cockpit_forms_keys_provider_check CHECK (provider IN ('fathom','other'));`);
      const r = await refusal(() => ex(migration(L)));
      expect(r.message).toBe(
        "cockpit_forms_keys_provider_check changed since the waves 1-2 contract read it; stop and re-read it.",
      );
    });
  });

  test("the file opens with BEGIN and ends with the schema reload and COMMIT", () => {
    const text = migration(L);
    expect(text).toMatch(/\nBEGIN;\n/);
    expect(
      text.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
  });
});

describe("the six kinds and the S0 channels (3.4)", () => {
  test("the three settings CHECKs and the outbox's kinds take all six", () => {
    for (const k of [
      "cockpit_slack_notice_settings.cockpit_slack_notice_settings_kind_check",
      "cockpit_slack_notice_settings.cockpit_slack_notice_settings_check",
      "cockpit_slack_notices.cockpit_slack_notices_kind_check",
    ])
      for (const kind of SIX)
        expect(once.checks[k], `${k} ${kind}`).toContain(`'${kind}'::text`);
    expect(
      once.checks["cockpit_slack_notices.cockpit_slack_notices_check1"],
    ).toBe(
      "CHECK (((kind = ANY (ARRAY['rehearsal'::text, 'termination.notice'::text])) OR (task_id IS NOT NULL)))",
    );
    // The always-on variant rule is untouched.
    expect(
      once.checks[
        "cockpit_slack_notice_settings.cockpit_slack_notice_settings_check1"
      ],
    ).toBe(
      before.checks[
        "cockpit_slack_notice_settings.cockpit_slack_notice_settings_check1"
      ],
    );
  });

  test("the six settings rows seed as 3.4 says, with one audit row each", async () => {
    const rows = await q(
      "SELECT kind, enabled, channel, mention_rule, updated_by FROM public.cockpit_slack_notice_settings WHERE kind = ANY($1) ORDER BY kind",
      [[...SIX]],
    );
    expect(rows).toEqual([
      {
        kind: "churn.confirmed",
        enabled: true,
        channel: ANNOUNCE,
        mention_rule: [],
        updated_by: "migration",
      },
      {
        kind: "client.resumed",
        enabled: true,
        channel: ANNOUNCE,
        mention_rule: [],
        updated_by: "migration",
      },
      {
        kind: "extension.granted",
        enabled: true,
        channel: ANNOUNCE,
        mention_rule: [],
        updated_by: "migration",
      },
      {
        kind: "pause.agreed",
        enabled: true,
        channel: ANNOUNCE,
        mention_rule: [],
        updated_by: "migration",
      },
      {
        kind: "termination.notice",
        enabled: true,
        channel: CSM_GENERAL,
        mention_rule: ["seat:csm"],
        updated_by: "migration",
      },
      {
        kind: "termination.submitted",
        enabled: false,
        channel: ANNOUNCE,
        mention_rule: [],
        updated_by: "migration",
      },
    ]);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'notices.setting_seeded' AND entity_id = ANY($1)",
        [[...SIX]],
      ),
    ).toBe(6);
  });

  test("the two S0 channels are checking, public, with the CEO's line", async () => {
    const rows = await q(
      "SELECT id, name, private, state, note, added_by FROM public.cockpit_slack_channels WHERE id IN ($1, $2) ORDER BY id",
      [ANNOUNCE, NPS],
    );
    expect(rows).toEqual([
      {
        id: ANNOUNCE,
        name: "csm-announcements",
        private: false,
        state: "checking",
        note: "The CEO invites the bot (Q4); until then notices here read Not posted.",
        added_by: "migration 20261101l (S0)",
      },
      {
        id: NPS,
        name: "nps-survey-feedback",
        private: false,
        state: "checking",
        note: "The CEO invites the bot (Q4); until then notices here read Not posted.",
        added_by: "migration 20261101l (S0)",
      },
    ]);
  });

  test("shapes, labels and the settings order", async () => {
    const got = await q(
      "SELECT k AS kind, public.cockpit_slack_notice_shape(k) AS shape, public.cockpit_slack_notice_kind_label(k) AS label FROM unnest($1::text[]) k",
      [[...SIX]],
    );
    expect(got.map(r => [r.kind, r.shape, r.label])).toEqual([
      ["termination.notice", "post", "Termination notice in"],
      ["termination.submitted", "post", "Termination survey sent"],
      ["churn.confirmed", "post", "Client has left"],
      ["extension.granted", "post", "Extension given"],
      ["pause.agreed", "post", "Pause agreed"],
      ["client.resumed", "post", "Client resumed"],
    ]);
    const read = await as<Row>(
      CEO,
      "SELECT public.cockpit_slack_notice_settings_read() AS r",
    );
    expect(read.notices.map((n: Row) => n.kind).slice(-6)).toEqual([...SIX]);
    const doctor = await svc("cockpit_slack_notice_doctor_inputs()");
    expect(doctor.settings.map((s: Row) => s.kind).slice(-6)).toEqual([...SIX]);
    expect(doctor.channels.map((c: Row) => c.id)).toEqual(
      expect.arrayContaining([ANNOUNCE, NPS]),
    );
  });

  test("Termination survey sent stays off while Make's post runs, until forms.doors says c4b", async () => {
    await rolledBack(async () => {
      const r = await refusal(() =>
        as(
          CEO,
          "SELECT public.cockpit_slack_notice_settings_set('termination.submitted', '{\"on\":true}'::jsonb) AS r",
        ),
      );
      expect(r.message).toBe(
        "Termination survey sent stays off while the old Make post still runs in #csm-announcements. It turns on when that post is switched off.",
      );
      await ex(
        "INSERT INTO public.cockpit_settings(key, value) VALUES ('forms.doors', '{\"c4b\":true}')",
      );
      const ok = await as<Row>(
        CEO,
        "SELECT public.cockpit_slack_notice_settings_set('termination.submitted', '{\"on\":true}'::jsonb) AS r",
      );
      expect(
        ok.notices.find((n: Row) => n.kind === "termination.submitted").on,
      ).toBe(true);
    });
    // Turning another kind off and on is the 2b rule as before.
    await rolledBack(async () => {
      const off = await as<Row>(
        CEO,
        "SELECT public.cockpit_slack_notice_settings_set('pause.agreed', '{\"on\":false}'::jsonb) AS r",
      );
      expect(off.notices.find((n: Row) => n.kind === "pause.agreed").on).toBe(
        false,
      );
    });
  });

  test("a channel in use by a lifecycle kind cannot be removed, and the refusal names its label", async () => {
    await rolledBack(async () => {
      const r = await refusal(() =>
        as(CEO, "SELECT public.cockpit_slack_channel_remove($1) AS r", [
          ANNOUNCE,
        ]),
      );
      expect(r.message).toBe(
        "The Termination survey sent notice posts there. Choose another channel for it first.",
      );
    });
  });

  test("the rehearsals and the dry-run inputs know the six kinds", async () => {
    await rolledBack(async () => {
      for (const kind of SIX) {
        const id = await svc(
          "cockpit_slack_notice_rehearse_service($1, 'U0123456789')",
          [kind],
        );
        expect(typeof id.id).toBe("string");
      }
      const one = await as<Row>(
        CEO,
        "SELECT public.cockpit_slack_notice_rehearse('extension.granted') AS r",
      );
      expect(one.state).toBe("queued");
      const dry = await svc("cockpit_slack_notice_inputs($1::jsonb)", [
        JSON.stringify({
          kind: "churn.confirmed",
          taskId: A,
          facts: { client: "Acme Interiors", reason: "Cancelled" },
        }),
      ]);
      expect(dry).toMatchObject({ kind: "churn.confirmed", target: ANNOUNCE });
    });
  });
});

describe("the forms keys and the door's health row (2.2)", () => {
  const secret = "Invented" + "ExitSurveySigningKey" + "0123456789abcdefgh";
  test("a signing key saves for each new form, and the door row is the form's own", async () => {
    await rolledBack(async () => {
      for (const [provider, form, noun] of [
        ["typeform_exit_survey", "exit_survey", "termination survey"],
        ["typeform_pause_request", "pause_request", "pause request"],
      ]) {
        const out = await svc("cockpit_forms_key_put($1::jsonb)", [
          JSON.stringify({
            provider,
            secret,
            savedBy: "server",
            state: "unchecked",
            meta: { form, tag: "cockpit" },
          }),
        ]);
        expect(out).toMatchObject({
          ok: true,
          provider,
          last4: secret.slice(-4),
        });
        const door = (
          await q(
            "SELECT note, detail FROM public.cockpit_sync_state WHERE key = $1",
            [`forms-door:${form}`],
          )
        )[0];
        expect(door.note).toBe(
          `The ${noun} signing key is saved; the webhook is not registered with it yet.`,
        );
        const saved = (
          await q(
            "SELECT saved_at FROM public.cockpit_forms_keys WHERE provider = $1",
            [provider],
          )
        )[0];
        await svc("cockpit_forms_key_mark($1::jsonb)", [
          JSON.stringify({
            provider,
            state: "connected",
            savedAt: saved.saved_at,
            meta: {
              webhookId: "cockpit",
              tag: "cockpit",
              registeredAt: "2026-11-01T09:00:00Z",
              unregisteredAt: null,
            },
          }),
        ]);
        expect(
          (
            await q(
              "SELECT note FROM public.cockpit_sync_state WHERE key = $1",
              [`forms-door:${form}`],
            )
          )[0].note,
        ).toBe(`The ${noun} webhook is registered.`);
        await svc("cockpit_forms_key_mark($1::jsonb)", [
          JSON.stringify({
            provider,
            state: "refused",
            savedAt: saved.saved_at,
            meta: { unregisteredAt: "2026-11-01T10:00:00Z" },
          }),
        ]);
        expect(
          (
            await q(
              "SELECT note FROM public.cockpit_sync_state WHERE key = $1",
              [`forms-door:${form}`],
            )
          )[0].note,
        ).toBe(
          `The ${noun} webhook is not registered: its answers wait in Typeform until it is.`,
        );
      }
      const labels = await q(
        "SELECT public.cockpit_forms_key_label('typeform_exit_survey') AS a, public.cockpit_forms_key_label('typeform_pause_request') AS b",
      );
      expect(labels[0]).toEqual({
        a: "Termination survey webhook",
        b: "Pause request webhook",
      });
      const status = await as<Row>(
        CEO,
        "SELECT public.cockpit_forms_keys_status() AS r",
      );
      expect(status.typeform.map((t: Row) => t.form)).toEqual([
        "kickoff",
        "exit_survey",
        "pause_request",
      ]);
      expect(status.typeform[1]).toMatchObject({
        form: "exit_survey",
        last4: secret.slice(-4),
        registered: false,
      });
      expect(status.keys).toHaveLength(4);
    });
  });

  test("a bad secret is refused in the Typeform words; an unknown provider names all seven", async () => {
    const bad = await refusal(() =>
      svc("cockpit_forms_key_put($1::jsonb)", [
        JSON.stringify({
          provider: "typeform_exit_survey",
          secret: "short",
          savedBy: "server",
        }),
      ]),
    );
    expect(bad.message).toBe(
      "That doesn't look like a Typeform signing secret: 32 to 128 letters, digits, - or _. Nothing was changed.",
    );
    const other = await refusal(() =>
      svc("cockpit_forms_key_put($1::jsonb)", [
        JSON.stringify({
          provider: "typeform_checkin",
          secret,
          savedBy: "server",
        }),
      ]),
    );
    expect(other.message).toBe(
      "Choose fathom, fathom_webhook, anthropic, deepseek, typeform_kickoff, typeform_exit_survey or typeform_pause_request.",
    );
  });

  test("cockpit_forms_door_seen takes the two new forms; kickoff's words are unchanged; other forms are refused", async () => {
    await rolledBack(async () => {
      await svc("cockpit_forms_door_seen('exit_survey', 'recorded', NULL)");
      await svc("cockpit_forms_door_seen('pause_request', 'repeat', NULL)");
      await svc("cockpit_forms_door_seen('kickoff', 'ignored', 'x')");
      const rows = Object.fromEntries(
        (
          await q(
            "SELECT key, note, ok FROM public.cockpit_sync_state WHERE key LIKE 'forms-door:%'",
          )
        ).map(r => [r.key, r]),
      );
      expect(rows["forms-door:exit_survey"].note).toMatch(
        /^A termination survey arrived and was stored at \d\d:\d\d on /,
      );
      expect(rows["forms-door:pause_request"].note).toMatch(
        /^Typeform sent a pause request again at .*; it was already stored\.$/,
      );
      expect(rows["forms-door:kickoff"].note).toMatch(
        /^A signed delivery at .* was not a kickoff response, so nothing was stored\.$/,
      );
      expect(rows["forms-door:exit_survey"].ok).toBe(true);
      // No key saved and no webhook registered: a failure is quiet, never a failing job.
      await svc(
        "cockpit_forms_door_seen('pause_request', 'failed', 'No signing key saved')",
      );
      expect(
        (
          await q(
            "SELECT ok FROM public.cockpit_sync_state WHERE key = 'forms-door:pause_request'",
          )
        )[0].ok,
      ).toBe(true);
      const r = await refusal(() =>
        svc("cockpit_forms_door_seen('checkin', 'recorded', NULL)"),
      );
      expect(r.message).toBe(
        "Only kickoff, the termination survey and the pause request have a cockpit webhook.",
      );
    });
  });
});

describe("the registry (2.3, 4.3)", () => {
  test("the seven rows and their versions, the staff schemas a record of formDefs' keys", async () => {
    const rows = await q(
      "SELECT key, title, audience, provider, typeform_id, seats, client_scoped, version, updated_by FROM public.cockpit_forms WHERE key = ANY($1) ORDER BY key",
      [
        [
          "exit_survey",
          "pause_request",
          "extension",
          "pause",
          "resume",
          "churn_confirm",
          "mrr",
        ],
      ],
    );
    expect(
      rows.map(r => [r.key, r.audience, r.provider, r.typeform_id]),
    ).toEqual([
      ["churn_confirm", "team", "native", null],
      ["exit_survey", "client", "typeform", "knIe4eF3"],
      ["extension", "team", "native", null],
      ["mrr", "team", "native", null],
      ["pause", "team", "native", null],
      ["pause_request", "client", "typeform", "CTUjv6l3"],
      ["resume", "team", "native", null],
    ]);
    for (const r of rows) {
      expect(r.seats).toEqual(["csm"]);
      expect(r.client_scoped).toBe(true);
      expect(r.updated_by).toBe("migration 20261101l");
    }
    const keys = Object.fromEntries(
      (
        await q(
          "SELECT key, schema FROM public.cockpit_forms WHERE provider = 'native' AND key <> 'blueprint' AND key <> 'checkin'",
        )
      ).map(r => [r.key, r.schema.fields.map((f: Row) => f.key)]),
    );
    // Contract 3.7's field keys, in order.
    expect(keys).toEqual({
      extension: [
        "weeks",
        "reason",
        "ours",
        "limitations",
        "atRisk",
        "callId",
        "noCall",
        "noCallReason",
        "prevent",
      ],
      pause: [
        "pauseKind",
        "restart",
        "reasonCat",
        "reason",
        "callId",
        "consentTerm",
        "consentOver14",
      ],
      resume: ["on", "nextDate"],
      churn_confirm: [
        "leftOn",
        "noticeOn",
        "reason",
        "churnType",
        "whyDetail",
        "howToStop",
        "mrrLostUsd",
        "exitCallId",
        "surveyState",
      ],
      mrr: ["mrrUsd", "reasonCat", "reason", "effective"],
    });
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_form_versions WHERE version = 1 AND form_key IN ('exit_survey','pause_request','extension','pause','resume','churn_confirm','mrr')",
      ),
    ).toBe(7);
  });

  const apply = (key: string, patch: Row, actor: Row) =>
    q(
      "SELECT public.cockpit_form_registry_apply($1, $2::jsonb, $3::jsonb) AS r",
      [key, JSON.stringify(patch), JSON.stringify(actor)],
    );
  const ceo = { email: CEO_EMAIL, who: "ceo", via: "cockpit" };

  test("the five staff forms are refused with W19's sentence; any form off the list by migration only", async () => {
    for (const key of [
      "extension",
      "pause",
      "resume",
      "churn_confirm",
      "mrr",
    ]) {
      const r = await refusal(() => apply(key, { owners: "cockpit" }, ceo));
      expect(r.message).toBe(
        "This form is set in the cockpit's code until the form editor ships.",
      );
    }
    await rolledBack(async () => {
      await ex(`INSERT INTO public.cockpit_forms(key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
                VALUES ('nps', 'NPS', 'client', 'typeform', 'fuPgs85S', 1, '{}'::jsonb, ARRAY['csm'], true, '[]'::jsonb, 'test')`);
      const r = await refusal(() => apply("nps", { owners: "cockpit" }, ceo));
      expect(r.message).toBe(
        "That form changes only by migration until its editor ships.",
      );
    });
  });

  test("checkin keeps 2b's rules: native only through the cut-over", async () => {
    const r = await refusal(() =>
      apply("checkin", { provider: "native" }, ceo),
    );
    expect(r.message).toBe(
      "The 1-1 notes open in the cockpit only through the switch-over function at the cut-over hour.",
    );
  });

  test("the survey, the pause request, kickoff and Blueprint take owner changes from the CEO seat only", async () => {
    await rolledBack(async () => {
      const out = await apply(
        "exit_survey",
        { owners: { announcement: "shadow" } },
        ceo,
      );
      expect(
        out[0].r.effects.find((e: Row) => e.key === "announcement").owner,
      ).toBe("shadow");
      const kick = await apply("kickoff", { owners: { recap: "make" } }, ceo);
      expect(kick[0].r.effects.find((e: Row) => e.key === "recap").owner).toBe(
        "make",
      );
      for (const key of [
        "exit_survey",
        "pause_request",
        "kickoff",
        "blueprint",
      ]) {
        const r = await refusal(() =>
          apply(
            key,
            { owners: "make" },
            { email: "admin@tests.invalid", who: "admin", via: "cockpit" },
          ),
        );
        expect(r.message).toBe(
          "Only the CEO changes who delivers this form's steps.",
        );
      }
    });
  });

  test("only the two client forms move, forward, from Typeform to the cockpit", async () => {
    await rolledBack(async () => {
      const out = await apply("pause_request", { provider: "native" }, ceo);
      expect(out[0].r.provider).toBe("native");
      const back = await refusal(() =>
        apply("pause_request", { provider: "typeform" }, ceo),
      );
      expect(back.message).toBe(
        "Only the termination survey and the pause request move here, from Typeform to the cockpit.",
      );
      const kick = await refusal(() =>
        apply("kickoff", { provider: "native" }, ceo),
      );
      expect(kick.message).toBe(
        "Only the termination survey and the pause request move here, from Typeform to the cockpit.",
      );
    });
  });
});

describe("cockpit_form_record_legacy (3.1, 4.4)", () => {
  test("a survey on a card is stored once, dated in Kuwait, and queues one Termination notice in", async () => {
    await rolledBack(async () => {
      const first = await legacy(survey("tok00000001"));
      expect(first).toMatchObject({
        inserted: true,
        matched: false,
        noticeQueued: true,
        taskId: A,
      });
      const again = await legacy(survey("tok00000001"));
      expect(again).toMatchObject({
        inserted: false,
        responseId: first.responseId,
        noticeQueued: false,
      });
      const r = (
        await q("SELECT * FROM public.cockpit_form_responses WHERE id = $1", [
          first.responseId,
        ])
      )[0];
      expect(r).toMatchObject({
        form_key: "exit_survey",
        form_version: 1,
        source: "typeform_webhook",
        external_id: "tok00000001",
        task_id: A,
        client_name: "Acme Interiors",
        mode: "live",
        state: "legacy",
        created_by: "forms-door",
      });
      // The card came from the link's hidden id, which nobody signs: kept, and said to be unverified.
      expect(r.answer_meta).toEqual({
        notice_on: "2026-11-01",
        match: "hidden_id_unverified",
      });
      // Only the form's two hidden fields are kept; nothing else of the delivery.
      expect(r.hidden).toEqual({
        client_name: "Acme Interiors",
        onboarding_client_id: A,
      });
      const n = await q(
        "SELECT kind, dedupe_key, task_id, client_name, facts, state FROM public.cockpit_slack_notices WHERE kind = 'termination.notice'",
      );
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({
        dedupe_key: `termination:${first.responseId}`,
        task_id: A,
        client_name: "Acme Interiors",
        state: "queued",
      });
      expect(n[0].facts).toEqual({
        responseId: first.responseId,
        submittedAt: "2026-10-31T22:30:00.000Z",
        noticeOn: "2026-11-01",
        matched: true,
        client: "Acme Interiors",
      });
      // No address reached an audit row.
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE after::text LIKE '%owner@acme.invalid%'",
        ),
      ).toBe(0);
    });
  });

  test("a survey with no card id stays unmatched: stored, the form's name kept, a notice with no card", async () => {
    await rolledBack(async () => {
      const out = await legacy(
        survey("tok00000002", {
          taskId: null,
          hidden: { client_name: "Gamma Homes" },
        }),
      );
      expect(out).toMatchObject({
        inserted: true,
        taskId: null,
        noticeQueued: true,
      });
      const n = (
        await q(
          "SELECT task_id, client_name, facts FROM public.cockpit_slack_notices WHERE kind = 'termination.notice'",
        )
      )[0];
      expect(n).toMatchObject({ task_id: null, client_name: null });
      expect(n.facts).toMatchObject({
        matched: false,
        formClientName: "Gamma Homes",
      });
      // A hidden id that is not a card on the billing sheet matches nothing either (never a name guess, W12).
      const odd = await legacy(
        survey("tok00000003", {
          taskId: null,
          hidden: {
            client_name: "Acme Interiors",
            onboarding_client_id: "nocard9",
          },
        }),
      );
      expect(odd.taskId).toBeNull();
    });
  });

  test("a backfilled survey and a pause request queue no notice", async () => {
    await rolledBack(async () => {
      const back = await legacy(survey("tok00000004", { backfill: true }));
      expect(back).toMatchObject({ inserted: true, noticeQueued: false });
      expect(
        (
          await q(
            "SELECT source FROM public.cockpit_form_responses WHERE id = $1",
            [back.responseId],
          )
        )[0].source,
      ).toBe("typeform_sync");
      const pause = await legacy({
        ...survey("tok00000005"),
        formKey: "pause_request",
      });
      expect(pause).toMatchObject({ inserted: true, noticeQueued: false });
      expect(
        await count("SELECT count(*) n FROM public.cockpit_slack_notices"),
      ).toBe(0);
    });
  });

  test("a hidden id is no proof: the departure is never filled from it, before or after 20261101o's columns", async () => {
    await rolledBack(async () => {
      await ex(`INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by)
                VALUES ('Acme Interiors', '${A}', '2026-10-30', 'Cancelled', 'test')`);
      const before = await legacy(survey("tok00000006"));
      expect(before.matched).toBe(false);
      await ex(`ALTER TABLE public.cockpit_churn_departures ADD COLUMN survey_response_id uuid, ADD COLUMN survey_state text NOT NULL DEFAULT 'not_sent',
                ADD COLUMN confirmed_at timestamptz`);
      // Anyone holding a client's link can change the card id in it, so a person attaches the survey
      // (the churn confirm's pick); the notice still reaches the card's CSM to check.
      const after = await legacy(survey("tok00000007"));
      expect(after).toMatchObject({
        matched: false,
        noticeQueued: true,
        taskId: A,
      });
      expect(
        (
          await q(
            "SELECT survey_response_id, survey_state, updated_by FROM public.cockpit_churn_departures",
          )
        )[0],
      ).toEqual({
        survey_response_id: null,
        survey_state: "not_sent",
        updated_by: null,
      });
      // A departure already confirmed is never touched.
      await ex(
        "UPDATE public.cockpit_churn_departures SET confirmed_at = now(), survey_response_id = NULL",
      );
      expect((await legacy(survey("tok00000008"))).matched).toBe(false);
    });
  });

  test("refusals: the service key only, its two forms, a token, a time, answers as an object", async () => {
    const anon = await refusal(() =>
      as(null, "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r", [
        JSON.stringify(survey("tok00000009")),
      ]),
    );
    expect(anon.code).toBe("42501");
    const seat = await refusal(() =>
      as(CEO, "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r", [
        JSON.stringify(survey("tok00000009")),
      ]),
    );
    expect(seat.code).toBe("42501");
    expect(
      (
        await refusal(() =>
          legacy({ ...survey("tok00000009"), formKey: "kickoff" }),
        )
      ).message,
    ).toBe(
      "Only the termination survey and the pause request are recorded here.",
    );
    expect((await refusal(() => legacy(survey("bad token!")))).message).toBe(
      "That is not a Typeform response token.",
    );
    expect(
      (
        await refusal(() =>
          legacy(survey("tok00000009", { submittedAt: "soon" })),
        )
      ).message,
    ).toBe("The response has no readable submit time.");
    expect(
      (await refusal(() => legacy(survey("tok00000009", { answers: [] }))))
        .message,
    ).toBe("Send the answers as an object under 64 KB.");
  });
});

describe("the match, the trail and the notices in (3.1)", () => {
  test("a CSM picks a card only for their own clients; the CEO for any; once only", async () => {
    await rolledBack(async () => {
      const out = await legacy(
        survey("tok00000010", {
          taskId: null,
          hidden: { client_name: "Acme" },
        }),
      );
      const other = await refusal(() =>
        as(
          CSM_B,
          "SELECT public.cockpit_form_legacy_match($1::uuid, $2) AS r",
          [out.responseId, A],
        ),
      );
      expect(other).toEqual({
        code: "42501",
        message:
          "Acme Interiors is not one of your clients. Ask its CSM or the CEO to match it.",
      });
      const ok = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_legacy_match($1::uuid, $2) AS r",
        [out.responseId, A],
      );
      expect(ok).toEqual({
        responseId: out.responseId,
        taskId: A,
        clientName: "Acme Interiors",
        matched: false,
      });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'forms.legacy_match' AND entity_id = $1",
          [out.responseId],
        ),
      ).toBe(1);
      const twice = await refusal(() =>
        as(CEO, "SELECT public.cockpit_form_legacy_match($1::uuid, $2) AS r", [
          out.responseId,
          B,
        ]),
      );
      expect(twice.message).toBe("This survey is already matched to a card.");
      const nocard = await legacy(
        survey("tok00000011", { taskId: null, hidden: {} }),
      );
      const gone = await refusal(() =>
        as(
          CEO,
          "SELECT public.cockpit_form_legacy_match($1::uuid, 'zzzz1') AS r",
          [nocard.responseId],
        ),
      );
      expect(gone.message).toBe(
        "That card is not on the billing sheet. Pick another.",
      );
      expect(
        (
          await refusal(() =>
            as(
              FINANCE,
              "SELECT public.cockpit_form_legacy_match($1::uuid, $2) AS r",
              [nocard.responseId, A],
            ),
          )
        ).code,
      ).toBe("42501");
    });
  });

  test("the guard still refuses a card change outside the match", async () => {
    await rolledBack(async () => {
      const out = await legacy(survey("tok00000012"));
      const r = await refusal(() =>
        ex(
          `UPDATE public.cockpit_form_responses SET task_id = '${B}' WHERE id = '${out.responseId}'`,
        ),
      );
      expect(r.message).toBe(
        "A response keeps its form, version, source, card, mode, seat and creation time",
      );
      const a = await refusal(() =>
        ex(
          `UPDATE public.cockpit_form_responses SET answer_meta = answer_meta || '{"answered":{"answer":"staying"}}' WHERE id = '${out.responseId}'`,
        ),
      );
      expect(a.message).toBe("Sent notes keep their answers");
      // 20261101o's one answer, under its setting, once.
      await ex(`SELECT set_config('cockpit.forms_legacy', 'answer', true);
        UPDATE public.cockpit_form_responses SET answer_meta = answer_meta || '{"answered":{"answer":"staying"}}' WHERE id = '${out.responseId}'`);
      const second = await refusal(() =>
        ex(`SELECT set_config('cockpit.forms_legacy', 'answer', true);
          UPDATE public.cockpit_form_responses SET answer_meta = answer_meta || '{"answered":{"answer":"handled"}}' WHERE id = '${out.responseId}'`),
      );
      expect(second.message).toBe("Sent notes keep their answers");
    });
  });

  test("the notices in: matched rows for their CSM and the CEO, unmatched for every CSM, answered left out", async () => {
    await rolledBack(async () => {
      const acme = await legacy(survey("tok00000013"));
      const beta = await legacy(
        survey("tok00000014", {
          taskId: B,
          hidden: { client_name: "Beta Build", onboarding_client_id: B },
        }),
      );
      const lost = await legacy(
        survey("tok00000015", {
          taskId: null,
          hidden: { client_name: "Gamma Homes" },
        }),
      );
      const pause = await legacy({
        ...survey("tok00000016", {
          taskId: B,
          hidden: { onboarding_client_id: B },
        }),
        formKey: "pause_request",
      });
      const ids = (rows: Row[]) => rows.map(r => r.responseId).sort();
      const forA = await as<Row[]>(
        CSM_A,
        "SELECT public.cockpit_form_notices_in() AS r",
      );
      expect(ids(forA)).toEqual([acme.responseId, lost.responseId].sort());
      const forB = await as<Row[]>(
        CSM_B,
        "SELECT public.cockpit_form_notices_in() AS r",
      );
      expect(ids(forB)).toEqual(
        [beta.responseId, lost.responseId, pause.responseId].sort(),
      );
      const all = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_form_notices_in() AS r",
      );
      expect(all).toHaveLength(4);
      const gamma = all.find(r => r.responseId === lost.responseId);
      expect(gamma).toMatchObject({
        kind: "termination",
        taskId: null,
        clientName: "Gamma Homes",
        matched: false,
        noticeOn: "2026-11-01",
      });
      expect(all.find(r => r.responseId === pause.responseId)).toMatchObject({
        kind: "pause_request",
        taskId: B,
        clientName: "Beta Build",
      });
      // A pause recorded on the card after the request, and an answered survey, drop out.
      await ex(`INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, source, by_whom, at)
                VALUES ('${B}', 'Beta Build', 'pause', 'csm', 'csm.b@tests.invalid', now())`);
      await ex(`SELECT set_config('cockpit.forms_legacy', 'answer', true);
        UPDATE public.cockpit_form_responses SET answer_meta = answer_meta || '{"answered":{"answer":"staying"}}' WHERE id = '${acme.responseId}'`);
      expect(
        ids(
          await as<Row[]>(CEO, "SELECT public.cockpit_form_notices_in() AS r"),
        ),
      ).toEqual([beta.responseId, lost.responseId].sort());
      // The departure each matched survey would confirm.
      await ex(`INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by)
                VALUES ('Beta Build', '${B}', '2026-10-30', 'Cancelled', 'test')`);
      const dep = await one<number>(
        "SELECT id AS r FROM public.cockpit_churn_departures WHERE clickup_task_id = $1",
        [B],
      );
      expect(
        (
          await as<Row[]>(CSM_B, "SELECT public.cockpit_form_notices_in() AS r")
        ).find(r => r.responseId === beta.responseId)?.departureId,
      ).toBe(Number(dep));
      // Finance and a seat with no client success role are not shown notices in.
      expect(
        (
          await refusal(() =>
            as(FINANCE, "SELECT public.cockpit_form_notices_in() AS r"),
          )
        ).message,
      ).toBe("Notices in are for client success and the CEO.");
    });
  });

  test("a churn confirmed after the survey covers it (20261101o's columns, read by name)", async () => {
    await rolledBack(async () => {
      const acme = await legacy(survey("tok00000017"));
      await ex(`ALTER TABLE public.cockpit_churn_departures ADD COLUMN confirmed_at timestamptz;
                INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by, confirmed_at)
                VALUES ('Acme Interiors', '${A}', '2026-10-01', 'Cancelled', 'test', '2026-10-02T09:00:00Z')`);
      // An older confirmed churn (before a resume) does not hide a new survey.
      expect(
        (
          await as<Row[]>(CEO, "SELECT public.cockpit_form_notices_in() AS r")
        ).map(r => r.responseId),
      ).toContain(acme.responseId);
      await ex(
        "UPDATE public.cockpit_churn_departures SET left_on = '2026-11-02', confirmed_at = now()",
      );
      expect(
        (
          await as<Row[]>(CEO, "SELECT public.cockpit_form_notices_in() AS r")
        ).map(r => r.responseId),
      ).not.toContain(acme.responseId);
      // The notice's live rule says the same.
      const live = await one<Row>(
        "SELECT public.cockpit_slack_notice_live(n) AS r FROM public.cockpit_slack_notices n WHERE n.kind = 'termination.notice'",
      );
      expect(live).toMatchObject({
        stillTrue: false,
        matched: true,
        why: "The churn was confirmed in the cockpit before the notice went out.",
      });
    });
  });

  test("the trail: stored, the card held while its kind is off, the notice not posted for want of the bot", async () => {
    await rolledBack(async () => {
      await ex(`INSERT INTO public.cockpit_billing_events(id, clickup_task_id, client_name, kind, from_value, to_value, detail, source, by_whom)
                VALUES (901, '${A}', 'Acme Interiors', 'extension', '2026-11-05', '2026-11-19', '{"weeks":2}', 'csm', 'csm.a@tests.invalid')`);
      // The queue item as 20261009j's trigger writes it, held (dry_run) while billing card writes are off.
      await ex(`INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload, state)
                VALUES ('billing:901', 'billing', 'cockpit_billing_events', '901', '${A}', '{"kind":"extension"}', 'dry_run')`);
      await ex(`INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, client_name, facts)
                VALUES ('extension.granted', 'extension:901', '${A}', 'Acme Interiors', '{"eventId":901,"weeks":2,"until":"2026-11-19"}')`);
      await ex(`UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE dedupe_key = 'extension:901';
                UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
                       error = 'The channel for this notice is not ready (${ANNOUNCE}). Choose one in Settings, Notices and routing.'
                 WHERE dedupe_key = 'extension:901'`);
      await ex(`INSERT INTO public.cockpit_sync_state(key, detail) VALUES ('clickup-writeback:billing', '{"mode":"dry_run","kinds":[]}')
                ON CONFLICT (key) DO UPDATE SET detail = EXCLUDED.detail`);
      const t = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_trail('{\"eventId\":901}'::jsonb) AS r",
      );
      expect(t.stored.state).toBe("done");
      expect(t.card).toMatchObject({
        state: "held",
        mode: "dry_run",
        error: null,
      });
      expect(t.notice).toMatchObject({
        kind: "extension.granted",
        state: "failed",
        channelName: "csm-announcements",
        error:
          "Not posted: the bot is not in #csm-announcements. Ask the CEO to invite it.",
      });
      expect(JSON.stringify(t)).not.toContain("@tests.invalid");
      // Finance and the CEO read it too; another client's CSM does not.
      expect(
        (
          await as<Row>(
            FINANCE,
            "SELECT public.cockpit_form_trail('{\"eventId\":901}'::jsonb) AS r",
          )
        ).card.state,
      ).toBe("held");
      expect(
        (
          await refusal(() =>
            as(
              CSM_B,
              "SELECT public.cockpit_form_trail('{\"eventId\":901}'::jsonb) AS r",
            ),
          )
        ).message,
      ).toBe("That client is not on your access list");
      expect(
        (
          await refusal(() =>
            as(CSM_A, "SELECT public.cockpit_form_trail('{}'::jsonb) AS r"),
          )
        ).message,
      ).toBe("Say which saved form to follow.");
      // Delivered reads delivered.
      await ex(
        "UPDATE public.cockpit_clickup_writeback_queue SET state = 'delivered', delivered_at = now() WHERE dedupe_key = 'billing:901'",
      );
      expect(
        (
          await as<Row>(
            CEO,
            "SELECT public.cockpit_form_trail('{\"eventId\":901}'::jsonb) AS r",
          )
        ).card.state,
      ).toBe("delivered");
      // A survey's trail: its own notice by its dedupe key; an unmatched one any CSM may follow.
      const lost = await legacy(
        survey("tok00000018", {
          taskId: null,
          hidden: { client_name: "Gamma Homes" },
        }),
      );
      const s = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_form_trail($1::jsonb) AS r",
        [JSON.stringify({ responseId: lost.responseId })],
      );
      expect(s).toMatchObject({
        stored: { state: "done" },
        card: { state: "none" },
        notice: {
          kind: "termination.notice",
          state: "queued",
          channelName: "csm-general",
        },
      });
    });
  });
});

describe("cockpit_form_staff_record (3.1)", () => {
  const rid = "7a000000-0000-4000-8000-000000000001";
  // The money and churn functions (20261101o, p) call it inside their own
  // SECURITY DEFINER bodies; this stand-in does the same for a seat.
  const wrapper = `CREATE FUNCTION public.test_staff_record(p_form text, p_task text, p_answers jsonb, p_id uuid, p_source text DEFAULT 'cockpit')
    RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
      SELECT public.cockpit_form_staff_record(p_form, p_task, p_answers, p_id, p_source) $$;
    GRANT EXECUTE ON FUNCTION public.test_staff_record(text,text,jsonb,uuid,text) TO authenticated;`;
  test("from the cockpit: a signed-in seat, once per request id", async () => {
    await rolledBack(async () => {
      await ex(wrapper);
      const first = await as<string>(
        CSM_A,
        "SELECT public.test_staff_record('extension', $1, '{\"weeks\":2}'::jsonb, $2::uuid) AS r",
        [A, rid],
      );
      const again = await as<string>(
        CSM_A,
        "SELECT public.test_staff_record('extension', $1, '{\"weeks\":4}'::jsonb, $2::uuid) AS r",
        [A, rid],
      );
      expect(again).toBe(first);
      const r = (
        await q("SELECT * FROM public.cockpit_form_responses WHERE id = $1", [
          first,
        ])
      )[0];
      expect(r).toMatchObject({
        form_key: "extension",
        source: "cockpit",
        external_id: `req:${rid}`,
        state: "confirmed",
        mode: "live",
        task_id: A,
        client_name: "Acme Interiors",
        created_by: "csm.a@tests.invalid",
        created_by_id: CSM_A,
        answers: { weeks: 2 },
      });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'forms.staff_recorded'",
        ),
      ).toBe(1);
    });
  });

  test("cockpit with no signed-in seat is refused; import only with none", async () => {
    await rolledBack(async () => {
      const none = await refusal(() =>
        q(
          "SELECT public.cockpit_form_staff_record('churn_confirm', $1, '{}'::jsonb, $2::uuid) AS r",
          [A, rid],
        ),
      );
      expect(none).toEqual({
        code: "42501",
        message: "Sign in before saving a form.",
      });
      const imp = await one<string>(
        "SELECT public.cockpit_form_staff_record('churn_confirm', $1, '{}'::jsonb, $2::uuid, 'import') AS r",
        [A, rid],
      );
      expect(
        (
          await q(
            "SELECT source, created_by, created_by_id, confirmed_by FROM public.cockpit_form_responses WHERE id = $1",
            [imp],
          )
        )[0],
      ).toEqual({
        source: "import",
        created_by: "the CEO's word (Q5), 2026-11-01",
        created_by_id: null,
        confirmed_by: "the CEO's word (Q5), 2026-11-01",
      });
      await ex(wrapper);
      const seat = await refusal(() =>
        as(
          CEO,
          "SELECT public.test_staff_record('churn_confirm', $1, '{}'::jsonb, $2::uuid, 'import') AS r",
          [A, rid],
        ),
      );
      expect(seat.message).toBe(
        "An import runs only from the owner's SQL, never from a seat.",
      );
      expect(
        (
          await refusal(() =>
            q(
              "SELECT public.cockpit_form_staff_record('kickoff', $1, '{}'::jsonb, $2::uuid, 'import') AS r",
              [A, rid],
            ),
          )
        ).message,
      ).toBe("There is no staff form called kickoff.");
      expect(
        (
          await refusal(() =>
            q(
              "SELECT public.cockpit_form_staff_record('mrr', $1, '{}'::jsonb, $2::uuid, 'other') AS r",
              [A, rid],
            ),
          )
        ).message,
      ).toBe("Choose cockpit or import.");
    });
  });
});

describe("cockpit_form_doors (3.1)", () => {
  const doors = () => as<Row>(CSM_A, "SELECT public.cockpit_form_doors() AS r");
  test("all closed until a later file's functions and its marker are both there", async () => {
    expect(await doors()).toEqual({
      churnConfirm: false,
      extension: false,
      pause: false,
      mrr: false,
      reviews: false,
      checks: false,
      prefill: false,
    });
    await rolledBack(async () => {
      // n's two functions without its marker: still closed.
      await ex(`CREATE FUNCTION public.cockpit_manual_payment_check(text,text,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
                CREATE FUNCTION public.cockpit_manual_payments_to_check() RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;`);
      expect((await doors()).checks).toBe(false);
      await ex(
        "INSERT INTO public.cockpit_settings(key, value) VALUES ('forms.doors', '{\"checks\":true}')",
      );
      expect(await doors()).toMatchObject({
        checks: true,
        churnConfirm: false,
        extension: false,
      });
      // A rollback flips the marker: the restored function still exists, the door closes.
      await ex(
        "UPDATE public.cockpit_settings SET value = value || '{\"checks\":false}' WHERE key = 'forms.doors'",
      );
      expect((await doors()).checks).toBe(false);
      // o's door: its marker and its four functions (the match is this file's).
      await ex(`UPDATE public.cockpit_settings SET value = value || '{"churn":true}' WHERE key = 'forms.doors';
                CREATE FUNCTION public.cockpit_client_lifecycle_confirm(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
                CREATE FUNCTION public.cockpit_form_notice_answer(uuid,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
      expect((await doors()).churnConfirm).toBe(false);
      await ex(
        "CREATE FUNCTION public.cockpit_client_lifecycle_read(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;",
      );
      expect((await doors()).churnConfirm).toBe(true);
    });
    expect(
      (await refusal(() => as(null, "SELECT public.cockpit_form_doors() AS r")))
        .code,
    ).toBe("42501");
  });
});

describe("the notices each seat reads (2.2: cockpit_slack_notice_read)", () => {
  test("lifecycle news: the CSM and the CEO see it, finance sees only it, a creative never", async () => {
    await rolledBack(async () => {
      await ex(`INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, client_name, facts) VALUES
        ('kickoff', 'k:${A}', '${A}', 'Acme Interiors', '{"submittedAt":"2026-11-01T08:00:00Z"}'),
        ('churn.confirmed', 'churn:1', '${A}', 'Acme Interiors', '{"departureId":1}'),
        ('checkin.recap_late', 'recap:${A}', '${A}', 'Acme Interiors', '{}')`);
      const kinds = async (who: string) =>
        (
          await as<Row>(
            who,
            "SELECT public.cockpit_slack_notice_read($1) AS r",
            [A],
          )
        ).notices
          .map((n: Row) => n.kind)
          .sort();
      expect(await kinds(CSM_A)).toEqual([
        "checkin.recap_late",
        "churn.confirmed",
        "kickoff",
      ]);
      expect(await kinds(CEO)).toEqual([
        "checkin.recap_late",
        "churn.confirmed",
        "kickoff",
      ]);
      expect(await kinds(FINANCE)).toEqual(["churn.confirmed"]);
      expect(await kinds(CREATIVE)).toEqual(["kickoff"]);
      const other = await refusal(() =>
        as(CSM_B, "SELECT public.cockpit_slack_notice_read($1) AS r", [A]),
      );
      expect(other.code).toBe("42501");
    });
  });

  test("the live rules of the staff kinds: a removed departure and a voided event are no news", async () => {
    await rolledBack(async () => {
      await ex(`INSERT INTO public.cockpit_churn_departures(id, client, clickup_task_id, left_on, reason, created_by)
                VALUES (77, 'Acme Interiors', '${A}', '2026-10-30', 'Cancelled', 'test');
                INSERT INTO public.cockpit_billing_events(id, clickup_task_id, client_name, kind, source, by_whom)
                VALUES (902, '${A}', 'Acme Interiors', 'pause', 'csm', 'csm.a@tests.invalid');
                INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, client_name, facts) VALUES
                  ('churn.confirmed', 'churn:77', '${A}', 'Acme Interiors', '{"departureId":77}'),
                  ('pause.agreed', 'pause:902', '${A}', 'Acme Interiors', '{"eventId":902}')`);
      const live = (kind: string) =>
        one<Row>(
          "SELECT public.cockpit_slack_notice_live(n) AS r FROM public.cockpit_slack_notices n WHERE n.kind = $1",
          [kind],
        );
      expect(await live("churn.confirmed")).toEqual({
        stillTrue: true,
        why: null,
      });
      expect(await live("pause.agreed")).toEqual({
        stillTrue: true,
        why: null,
      });
      await ex(
        "UPDATE public.cockpit_churn_departures SET removed_at = now(), removed_by = 'test', removed_why = 'test' WHERE id = 77",
      );
      expect(await live("churn.confirmed")).toEqual({
        stillTrue: false,
        why: "The departure was removed from the register before the notice went out.",
      });
      // 20261101m's voids, read by name.
      await ex(`CREATE TABLE public.cockpit_billing_event_voids (event_id bigint PRIMARY KEY, reason text, voided_by text, voided_at timestamptz DEFAULT now());
                INSERT INTO public.cockpit_billing_event_voids(event_id, reason, voided_by) VALUES (902, 'test', 'test')`);
      expect(await live("pause.agreed")).toEqual({
        stillTrue: false,
        why: "The billing change was voided before the notice went out.",
      });
    });
  });
});

describe("cockpit_request_type_add (deploy step D-R1)", () => {
  test("adds one type with its version 1 and an audit row; refuses a key that exists", async () => {
    await rolledBack(async () => {
      const row = {
        key: "client_notice",
        type_index: 90,
        label: "Client notice",
        clickup_option_name: "Client notice",
        request_type_option_id: "9c000000-0000-4000-8000-000000000001",
        team: "client_success",
        targets: [
          {
            part: "main",
            name_suffix: "",
            list_id: "901816723211",
            team: "client_success",
            template_id: null,
            template_name: null,
            owner_rule: "csm_of_card",
            owner_clickup_id: null,
            when: null,
          },
        ],
        fields: [
          {
            key: "client",
            label: "Client",
            kind: "client",
            clickup_field_id: null,
            required: true,
            options: null,
            help: null,
          },
          {
            key: "details",
            label: "Details",
            kind: "details",
            clickup_field_id: null,
            required: true,
            options: null,
            help: null,
          },
          {
            key: "deadline",
            label: "Due",
            kind: "deadline",
            clickup_field_id: null,
            required: true,
            options: null,
            help: null,
          },
          {
            key: "priority",
            label: "Priority",
            kind: "priority",
            clickup_field_id: null,
            required: false,
            options: null,
            help: null,
          },
        ],
        due_days: 2,
        priority: "high",
      };
      const key = await one<string>(
        "SELECT public.cockpit_request_type_add($1::jsonb) AS r",
        [JSON.stringify(row)],
      );
      expect(key).toBe("client_notice");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_request_type_versions WHERE key = 'client_notice' AND version = 1",
        ),
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'request_type.added' AND entity_id = 'client_notice'",
        ),
      ).toBe(1);
      const again = await refusal(() =>
        q("SELECT public.cockpit_request_type_add($1::jsonb) AS r", [
          JSON.stringify(row),
        ]),
      );
      expect(again.message).toBe(
        "The request type client_notice already exists. Change it in the editor instead.",
      );
    });
  });
});

describe("anon and a seat with no role are refused everywhere", () => {
  test("every browser RPC refuses anon; the internal ones are not callable by any role", async () => {
    for (const sql of [
      "SELECT public.cockpit_form_trail('{\"eventId\":1}'::jsonb) AS r",
      "SELECT public.cockpit_form_notices_in() AS r",
      "SELECT public.cockpit_form_doors() AS r",
      "SELECT public.cockpit_form_legacy_match('7a000000-0000-4000-8000-000000000009'::uuid, 'taskA1') AS r",
    ])
      expect((await refusal(() => as(null, sql))).code, sql).toBe("42501");
    for (const sql of [
      "SELECT public.cockpit_form_staff_record('mrr', 'taskA1', '{}'::jsonb, gen_random_uuid(), 'import') AS r",
      "SELECT public.cockpit_request_type_add('{}'::jsonb) AS r",
      "SELECT public.cockpit_form_survey_link(gen_random_uuid(), 'taskA1', 'test') AS r",
    ]) {
      for (const who of [null, CEO, "service"] as const)
        expect((await refusal(() => as(who, sql))).code, `${who} ${sql}`).toBe(
          "42501",
        );
    }
    expect(
      (
        await refusal(() =>
          as(NOBODY, "SELECT public.cockpit_form_notices_in() AS r"),
        )
      ).code,
    ).toBe("42501");
  });
});
