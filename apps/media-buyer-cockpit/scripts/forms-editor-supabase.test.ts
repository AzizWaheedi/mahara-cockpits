/**
 * The forms editor, ED (20261102d_forms_editor.sql; docs/forms/WAVE34-CONTRACT.md
 * 2.6, 4.9, 5.13 and the forms-editor row of section 8) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * a function here as it would in production.
 *
 * It stands on the waves 1-2 chain exactly as forms-w12-chain-supabase.test.ts
 * builds it (the 2a base, the eight 2b files, 20261101l to r), then on
 * 20261102a, b and c when they are on the branch, in that order and as far as
 * they go. While a file is not there yet, a contract-shaped stand-in gives
 * this file the objects it reads by name: 3.1's schema check and V18's text
 * rule (a), the pause consent and exit survey v2 rows (b), the schedules and
 * the low-score line (c). Every stand-in object is made only when the real
 * one is missing, so the merged branch runs this test on the real files.
 * Then 20261102d applies twice.
 *
 * Covered: the file applies twice and changes nothing the second time; the
 * drift guard refuses a changed registry body; the drafts table has row
 * security, no browser grant and refuses delete and truncate; every RPC's
 * grant; only an admin or the CEO reads or writes; the editor reads run in a
 * read-only transaction; the groups and read-only sentences of 4.9.6; a
 * stale base refused on save and publish; publish runs the schema check, the
 * text rule on every text (English "leads", "CPL", "guarantee", Arabic
 * "نضمن" and "ليدز"), the WhatsApp placeholder, and the field guard
 * (removing or hiding a read field, its type, range, requirement and choice
 * values frozen, its words free); a published key cannot be renamed and a
 * key keeps its type; audience and signer never change; publish adds one
 * version, moves the registry for a native form only (the exit survey on
 * Typeform keeps its row), removes the draft and writes audit rows; open
 * invites keep their version (with 20261102a); restore publishes an old
 * schema as a new version through the same checks; staff and Make forms
 * refuse with their sentences; cockpit_form_registry_apply keeps W19 and
 * sends client forms to the editor; the routing bounds and every rule key;
 * no address ever reaches a browser read. The CEO's address is read from the
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
import { existsSync, readdirSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  CLIENT_SCHEMAS,
  copy,
  EXIT_SURVEY_SCHEMA,
  NPS_SCHEMA,
} from "../../client-success-cockpit/src/dev/formsEditorFixtures";
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

const CHAIN = [
  "20261101m_billing_rails.sql",
  "20261101n_checked_money.sql",
  "20261101o_churn_confirm.sql",
  "20261101p_money_acts.sql",
  "20261101q_readers.sql",
] as const;

/** pg_cron is not in the test engine: a file's schedule block is left out. */
function withoutCron(text: string): string {
  const start = text.indexOf("-- cron:begin");
  if (start < 0) return text;
  const end = text.indexOf("-- cron:end", start);
  if (end < 0) throw new Error("The schedule block is missing its end marker");
  return text.slice(0, start) + text.slice(end + "-- cron:end".length);
}

function extract(file: string, pattern: RegExp): string {
  return cut(migration(file), pattern, `${file} ${pattern}`);
}

/** A function's newest CREATE in the migrations before this block, whatever its dollar tag. */
function newest(fn: string): string {
  const files = readdirSync(
    new URL("../../../supabase/migrations/", import.meta.url),
  )
    .filter(f => /^\d.*\.sql$/.test(f) && f < "20261101l")
    .sort();
  for (const file of files.reverse()) {
    const sql = migration(file);
    const at = sql.search(
      new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(`, "i"),
    );
    if (at < 0) continue;
    let last = at;
    for (;;) {
      const next = sql
        .slice(last + 1)
        .search(
          new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(`, "i"),
        );
      if (next < 0) break;
      last = last + 1 + next;
    }
    const tag = sql.slice(last).match(/AS\s+(\$[A-Za-z_]*\$)/);
    if (!tag || tag.index === undefined) continue;
    const bodyAt = last + tag.index + tag[0].length;
    const close = sql.indexOf(tag[1], bodyAt);
    const semi = sql.indexOf(";", close + tag[1].length);
    return sql.slice(last, semi + 1);
  }
  throw new Error(`No canonical body for ${fn}`);
}

/** The billing write, the manual payments and the snapshots m to q stand on (as billing-rails' and money-acts' tests build them). */
async function extras() {
  await db.exec(
    "CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE IF NOT EXISTS storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;",
  );
  for (const name of [
    "cockpit_client_billing_days",
    "cockpit_metric_days",
    "cockpit_payer_clients",
  ])
    await db.exec(
      extract(
        "20260919_cockpit_core.sql",
        new RegExp(
          `create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
  await db.exec(
    extract(
      "20260927x_cockpit_native_media_sync.sql",
      /ALTER TABLE public\.cockpit_client_billing_days[\s\S]*?source_record jsonb;/,
    ),
  );
  await db.exec(
    extract(
      "20261007d_cockpit_team_rpc_restore.sql",
      /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;",
  );
  for (const f of [
    "20260921c_bank_statements.sql",
    "20260921d_cockpit_metrics.sql",
    "20260921f_cockpit_feedback.sql",
    "20260922e_goals_and_people.sql",
    "20260923a_client_billing.sql",
  ])
    await db.exec(migration(f));
  await db.exec(
    extract(
      "20260924r_billing_and_comms_access.sql",
      /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/,
    ),
  );
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  await db.exec(migration("20260927h_cockpit_ceo_actions.sql"));
  await db.exec(
    withoutCron(migration("20261009a_billing_native_sync.sql")) +
      "\n" +
      migration("20261009h_billing_browser_writes_closed.sql"),
  );
  await db.exec(
    extract("20261022c_ecom_money_rails.sql", /DO \$body\$[\s\S]*?\$body\$;/),
  );
  await db.exec(migration("20261009j_billing_clickup_writeback.sql"));
  await csmReadModels();
  await financeAndBalances();
  // q's ground: the CEO goals and the goal sheet as live (20261030a).
  await db.exec(migration("20260926l_cockpit_ceo_goals_access.sql"));
  await db.exec(migration("20261030a_goal_sheet.sql"));
}

/** The CSM read models and the churn projections (as churn-confirm's and checked-money's tests build them). */
async function csmReadModels() {
  async function table(file: string, relation: string) {
    await db.exec(
      extract(
        file,
        new RegExp(
          `create table if not exists public\\.${relation}\\s*\\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
    await db.exec(`ALTER TABLE public.${relation} ENABLE ROW LEVEL SECURITY`);
  }
  await db.exec(
    "CREATE TABLE IF NOT EXISTS public.clients(id uuid PRIMARY KEY)",
  );
  for (const relation of [
    "cockpit_campaigns",
    "cockpit_ads",
    "cockpit_client_profiles",
    "cockpit_decisions",
  ])
    await table("20260923o_cockpit_domain_tables.sql", relation);
  await db.exec(migration("20260926a_cockpit_decision_details.sql"));
  await table("20260923p_cockpit_actions_and_rpcs.sql", "cockpit_plan_items");
  for (const relation of [
    "team_people",
    "team_meetings",
    "team_meeting_people",
  ])
    await table("20260922b_team_meetings.sql", relation);
  await table("20260923d_team_meetings_screen.sql", "team_changes");
  await db.exec(
    extract(
      "20260923d_team_meetings_screen.sql",
      /alter table public\.team_meeting_people\s+add column[\s\S]*?;/i,
    ),
  );
  await db.exec(
    extract(
      "20260927d_team_meetings_v5.sql",
      /alter table public\.team_meetings\s+add column[\s\S]*?;[ \t]*\r?$/im,
    ),
  );
  await db.exec(
    extract(
      "20260927g_renewals_projections_meeting.sql",
      /alter table public\.team_meetings add column if not exists embed text;/i,
    ),
  );
  for (const relation of ["cockpit_churn_months", "cockpit_churn_log"])
    await table("20261001a_churn_tracker.sql", relation);
  await table("20260922a_eod_outbox.sql", "eod_outbox");
  await table("20260920b_wa_inbox.sql", "wa_threads");
  // The projection tables and the three functions n replaces, each at its
  // newest canonical body (20261004a, 20261004b, 20261007e).
  const proj = migration("20261004a_csm_churn_projections.sql");
  for (const hit of proj.matchAll(
    /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_projection[a-z_]*\s*\([\s\S]*?\n\);/gi,
  ))
    await db.exec(hit[0]);
  for (const fn of [
    "cockpit_csm_projection_facts",
    "cockpit_csm_projection_refresh_billing",
    "cockpit_csm_projection_read",
    "cockpit_csm_churn_read",
  ])
    await db.exec(newest(fn));
}

/** n's ground: the finance refresh as live, the deal ledger, Ecom and the billing balances (as checked-money's test builds them). */
async function financeAndBalances() {
  const actions = migration("20260927h_cockpit_ceo_actions.sql");
  void actions;
  await db.exec(migration("20260927i_cockpit_finance_refresh.sql"));
  const restore = migration("20261007e_cockpit_provider_rpc_restore.sql");
  await db.exec(
    "ALTER TABLE public.cockpit_finance_refreshes ALTER COLUMN actor_id DROP NOT NULL",
  );
  for (const fn of [
    "cockpit_ceo_refresh_require_service",
    "cockpit_ceo_refresh_finance_snapshot",
    "cockpit_ceo_worker_begin_finance_refresh",
    "cockpit_finance_refresh_input",
  ])
    await db.exec(
      cut(
        restore,
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`,
        ),
        fn,
      ),
    );
  await db.exec(`
    REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_require_service(), public.cockpit_ceo_refresh_finance_snapshot(),
      public.cockpit_ceo_worker_begin_finance_refresh(), public.cockpit_finance_refresh_input(uuid) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ceo_worker_begin_finance_refresh(), public.cockpit_finance_refresh_input(uuid) TO service_role;`);
  await db.exec(
    extract(
      "20260924a_sales_cockpit.sql",
      /create table if not exists public\.cockpit_sales_deals \([\s\S]*?\n\);/i,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_sales_deals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_sales_deals FROM anon, authenticated;",
  );
  await db.exec(
    extract(
      "20261009a_cockpit_team_hours.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_hours_refuse_delete\(\)[\s\S]*?\$\$;/,
    ),
  );
  await db.exec(migration("20261018c_money_ties_deal_payments.sql"));
  await db.exec(
    extract(
      "20261011v_cockpit_invoices.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_invoices\([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    extract(
      "20261015a_cockpit_invoice_whop_links.sql",
      /ALTER TABLE public\.cockpit_invoices\n ADD COLUMN IF NOT EXISTS checkout_source[\s\S]*?;/,
    ),
  );
  await db.exec(
    extract(
      "20261022a_cockpit_invoice_tax_id.sql",
      /ALTER TABLE public\.cockpit_invoices\n ADD COLUMN IF NOT EXISTS client_tax_id[\s\S]*?;/,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_invoices ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_invoices FROM PUBLIC, anon, authenticated;",
  );
  await db.exec(migration("20261022b_ecom_payments.sql"));
  await db.exec(migration("20261022c_ecom_money_rails.sql"));
  await db.exec(migration("20261023x_billing_balances.sql"));
  await db.exec(migration("20261023y_billing_balance_write.sql"));
  await db.exec(migration("20261024p_billing_payment_exclusions.sql"));
}

// --- Waves 3-4 ---------------------------------------------------------------------------------

const R = "20261101r_readers_read_only_grant.sql";
const W34 = [
  "20261102a_forms_invites.sql",
  "20261102b_client_lifecycle.sql",
  "20261102c_client_voice.sql",
] as const;
const D = "20261102d_forms_editor.sql";
const onBranch = (file: string) =>
  existsSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url));
/** a, b and c as far as they are on the branch, in order (b and c stand on a). */
const REAL: string[] = [];
for (const file of W34) {
  if (!onBranch(file)) break;
  REAL.push(file);
}
const REAL_A = REAL.includes(W34[0]);

/** The portal's workspaces (portal_data.workspaces, 11.2-h), invented. */
const PORTAL = `
  CREATE SCHEMA IF NOT EXISTS portal_data;
  CREATE TABLE IF NOT EXISTS portal_data.workspaces (
    location_id text PRIMARY KEY, clickup_id text, name text, status text, timezone text, country text, city text,
    language text, service text, service_mode text, drive_url text, sheet_url text,
    source_updated_at timestamptz, captured_at timestamptz);
  INSERT INTO portal_data.workspaces(location_id, clickup_id, name, status) VALUES
    ('locZeta01', 'taskZ1', 'Zeta Kitchens', 'Active'),
    ('locAlpha01', '${A}', 'Acme Interiors', 'Active'),
    ('locBeta01', '${B}', 'Beta Build', 'Paused'),
    ('locGone01', 'taskG1', 'Gone Co', 'Cancelled')
  ON CONFLICT DO NOTHING;`;

/** V18's rule (20261102a), word for word from the contract; the leads pattern from 20261012f:77. */
const TEXT_OK = String.raw`
CREATE OR REPLACE FUNCTION public.cockpit_client_text_ok(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_text ~* '(^|[^ء-ي٠-٩A-Za-z0-9_])([وف]?(ال|لل|[بكل]|[بك]ال))?ليد(ز|ات)?(كم|كن|هم|هن|ها|ه|نا|ك)?($|[^ء-ي٠-٩A-Za-z0-9_])|(ال)?عملاء\s+(ال)?محتمل(ين|ون)|\mleads?\M|\mcpls?\M|\mcost\s+per\s+lead\M'
      THEN 'Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.'
    WHEN p_text ~* '\mguarantee[sd]?\M|\mguaranteeing\M|ضمان|نضمن|مضمون'
      THEN 'Client forms never promise results. Remove the guarantee wording.'
  END
$$;
REVOKE ALL ON FUNCTION public.cockpit_client_text_ok(text) FROM PUBLIC, anon, authenticated, service_role;`;

/** 3.1's client schema v1 check, as a stand-in: the first problem as a sentence, NULL when valid. */
const SCHEMA_CHECK = `
CREATE OR REPLACE FUNCTION public.cockpit_form_standin_text_bad(p jsonb, p_max integer, p_nullable boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p IS NULL OR p = 'null'::jsonb THEN NOT p_nullable
              ELSE jsonb_typeof(p) IS DISTINCT FROM 'object'
                OR coalesce(btrim(p->>'en'), '') = '' OR coalesce(btrim(p->>'ar'), '') = ''
                OR char_length(p->>'en') > p_max OR char_length(p->>'ar') > p_max END
$$;
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_check(p jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb; o jsonb; k text; e jsonb;
  v_keys text[] := '{}'; v_vals text[]; v_type text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'v' IS DISTINCT FROM '1' THEN RETURN 'A client form is schema version 1.'; END IF;
  IF coalesce(p->>'key', '') !~ '^[a-z][a-z0-9_]{1,30}$' THEN RETURN 'The form needs its key.'; END IF;
  IF public.cockpit_form_standin_text_bad(p->'title', 200, false) THEN RETURN 'The title needs English and Arabic, 200 characters at most.'; END IF;
  IF public.cockpit_form_standin_text_bad(p->'intro', 600, true) THEN RETURN 'The introduction needs English and Arabic, 600 characters at most.'; END IF;
  IF jsonb_typeof(p->'minutes') IS DISTINCT FROM 'number' OR (p->>'minutes') !~ '^([1-9]|10)$' THEN RETURN 'Minutes is a whole number from 1 to 10.'; END IF;
  IF coalesce(p->>'audience', '') NOT IN ('any','admin') THEN RETURN 'Who answers is any or admin.'; END IF;
  IF coalesce(p->>'signer', '') NOT IN ('none','typed') THEN RETURN 'The signer is none or typed.'; END IF;
  IF jsonb_typeof(p->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'fields') NOT BETWEEN 1 AND 40 THEN RETURN 'A form has 1 to 40 questions.'; END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p->'fields') x LOOP
    k := f->>'key';
    IF coalesce(k, '') !~ '^[a-z][a-zA-Z0-9]{1,30}$' THEN RETURN format('Question key %s is not a key.', coalesce(k, '(none)')); END IF;
    IF k = ANY(v_keys) THEN RETURN format('Two questions share the key %s.', k); END IF;
    v_type := f->>'type';
    IF v_type IN ('date','file') THEN RETURN format('Version 1 forms do not take %s questions yet.', v_type); END IF;
    IF coalesce(v_type, '') NOT IN ('scale','choice','multi','text','longtext','tick') THEN RETURN format('%s has no question type.', k); END IF;
    IF public.cockpit_form_standin_text_bad(f->'label', 200, false) THEN RETURN format('%s needs English and Arabic words.', k); END IF;
    IF public.cockpit_form_standin_text_bad(f->'hint', 600, true) THEN RETURN format('The hint of %s needs English and Arabic.', k); END IF;
    IF jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN RETURN format('Say whether %s is required.', k); END IF;
    IF v_type = 'scale' AND ((f->>'min') !~ '^[01]$' OR (f->>'max') !~ '^([2-9]|10)$' OR (f->>'min')::int >= (f->>'max')::int
        OR public.cockpit_form_standin_text_bad(f->'lowLabel', 200, false) OR public.cockpit_form_standin_text_bad(f->'highLabel', 200, false)) THEN
      RETURN format('The scale of %s runs from 0 or 1 to 10 at most, with both ends worded.', k);
    END IF;
    IF v_type IN ('choice','multi') THEN
      IF jsonb_typeof(f->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'options') NOT BETWEEN 2 AND 12 THEN
        RETURN format('%s has 2 to 12 choices.', k);
      END IF;
      v_vals := '{}';
      FOR o IN SELECT x FROM jsonb_array_elements(f->'options') x LOOP
        IF coalesce(o->>'value', '') !~ '^[a-z][a-z0-9_]{1,30}$' OR (o->>'value') = ANY(v_vals)
           OR public.cockpit_form_standin_text_bad(o->'label', 200, false) THEN
          RETURN format('A choice of %s needs its own value and English and Arabic words.', k);
        END IF;
        v_vals := v_vals || (o->>'value');
      END LOOP;
    END IF;
    IF v_type = 'text' AND coalesce(f->>'maxLength', '') !~ '^[0-9]+$' OR (v_type = 'text' AND (f->>'maxLength')::int NOT BETWEEN 1 AND 200) THEN
      RETURN format('A short answer is 200 characters at most (%s).', k);
    END IF;
    IF v_type = 'longtext' AND coalesce(f->>'maxLength', '') !~ '^[0-9]+$' OR (v_type = 'longtext' AND (f->>'maxLength')::int NOT BETWEEN 1 AND 2000) THEN
      RETURN format('A long answer is 2,000 characters at most (%s).', k);
    END IF;
    IF f->'showIf' IS NOT NULL AND f->'showIf' <> 'null'::jsonb AND NOT (f->'showIf'->>'key' = ANY(v_keys)) THEN
      RETURN format('%s can only show after an earlier question.', k);
    END IF;
    v_keys := v_keys || k;
  END LOOP;
  IF jsonb_typeof(p->'reads') IS DISTINCT FROM 'object' THEN RETURN 'The form says what the cockpit reads.'; END IF;
  FOR e IN SELECT x.value FROM jsonb_each(p->'reads') x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(e) y WHERE NOT (y = ANY(v_keys))) THEN
      RETURN 'The cockpit reads only questions this form has.';
    END IF;
  END LOOP;
  IF public.cockpit_form_standin_text_bad(p->'submit', 200, false) OR public.cockpit_form_standin_text_bad(p->'done', 600, false) THEN
    RETURN 'The button and the thank-you line need English and Arabic.';
  END IF;
  IF public.cockpit_form_standin_text_bad(p->'invite'->'whatsapp', 1000, false) OR public.cockpit_form_standin_text_bad(p->'invite'->'push', 200, false) THEN
    RETURN 'The WhatsApp and phone texts need English and Arabic.';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_form_schema_check(jsonb), public.cockpit_form_standin_text_bad(jsonb,integer,boolean)
  FROM PUBLIC, anon, authenticated, service_role;`;

/** 20261102c's schedules and settings (2.5), as a stand-in. */
const SCHEDULES = `
  CREATE TABLE IF NOT EXISTS public.cockpit_form_schedules (
    form_key text PRIMARY KEY REFERENCES public.cockpit_forms(key),
    "on" boolean NOT NULL,
    rule jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object' AND octet_length(rule::text) <= 2048),
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.cockpit_form_schedules ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.cockpit_form_schedules FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE ON public.cockpit_form_schedules TO service_role;
  INSERT INTO public.cockpit_form_schedules(form_key, "on", rule, updated_by) VALUES
    ('nps', true, '{"firstDay":60,"everyDays":90,"remindAfterDays":7}', 'migration 20261102c'),
    ('csat', true, '{"afterLaunchDays":0,"whatsappAfterDays":3,"snoozeDays":3,"reissues":3,"retryAfterDays":7,"maxAgeDays":60}', 'migration 20261102c')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES
    ('forms.schedule', '{"on":false,"maxPerRun":3,"hourKuwait":10}', 'migration 20261102c'),
    ('voice.low_score', '{"max":6}', 'migration 20261102c')
  ON CONFLICT DO NOTHING;`;

/** The objects 20261102d reads by name, made only where a, b or c did not make them. */
async function standIns() {
  await asOwner();
  const has = async (sql: string) =>
    Boolean((await db.query<{ r: unknown }>(`SELECT ${sql} AS r`)).rows[0]?.r);
  if (!(await has("to_regprocedure('public.cockpit_client_text_ok(text)')")))
    await db.exec(TEXT_OK);
  if (
    !(await has("to_regprocedure('public.cockpit_form_schema_check(jsonb)')"))
  )
    await db.exec(SCHEMA_CHECK);
  // The client forms (a's nps and csat, b's pause_consent and exit survey v2).
  for (const key of ["nps", "csat", "pause_consent"]) {
    const s = CLIENT_SCHEMAS[key];
    await db.query(
      `INSERT INTO public.cockpit_forms(key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
       VALUES ($1, $2, 'client', 'native', $3, 1, $4::jsonb, '{csm}', true, '[]', 'migration stand-in')
       ON CONFLICT (key) DO NOTHING`,
      [
        key,
        s?.title.en,
        key === "nps" ? "fuPgs85S" : key === "csat" ? "KbcbPA73" : null,
        JSON.stringify(s),
      ],
    );
    await db.query(
      `INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by, note)
       SELECT $1, 1, $2::jsonb, 'migration stand-in', NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_form_versions v WHERE v.form_key = $1)`,
      [key, JSON.stringify(s)],
    );
  }
  await db.query(
    `INSERT INTO public.cockpit_forms(key, title, audience, provider, version, schema, seats, client_scoped, effects, updated_by)
     VALUES ('portal_feedback', 'Portal feedback', 'client', 'native', 1,
       '{"key":"portal_feedback","fields":[{"key":"kind"},{"key":"topic"},{"key":"message"},{"key":"rating"},{"key":"contactOk"}]}',
       '{csm}', true, '[]', 'migration stand-in')
     ON CONFLICT (key) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by)
     SELECT 'portal_feedback', 1, f.schema, 'migration stand-in' FROM public.cockpit_forms f
      WHERE f.key = 'portal_feedback' AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_versions v WHERE v.form_key = 'portal_feedback')`,
  );
  await db.query(
    `INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by, note)
     SELECT 'exit_survey', 2, $1::jsonb, 'migration stand-in', 'The client schema of 5.6'
      WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_form_versions v WHERE v.form_key = 'exit_survey' AND v.schema->>'v' = '1')`,
    [JSON.stringify(EXIT_SURVEY_SCHEMA)],
  );
  if (!(await has("to_regclass('public.cockpit_form_schedules')")))
    await db.exec(SCHEDULES);
  else
    await db.exec(
      `INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ('voice.low_score', '{"max":6}', 'stand-in') ON CONFLICT DO NOTHING;`,
    );
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(VAULT);
  await standOn();
  await billingAndChurn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE_2A) await db.exec(migration(file));
  for (const file of FILES_2B) await db.exec(migration(file));
  await extras();
  await db.exec(migration(L));
  for (const file of [...CHAIN, R]) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await db.exec(PORTAL);
  for (const file of REAL) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await standIns();
  await db.exec(migration(D));
}, 600_000);
afterAll(async () => {
  await db?.close();
});

// --- Helpers for this file -------------------------------------------------------------------

type Hinted = Refusal & { hint: string };
async function refusedWith(fn: () => Promise<unknown>): Promise<Hinted> {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string; hint?: string };
    return { code: x.code ?? "", message: x.message, hint: x.hint ?? "" };
  }
  throw new Error("Expected a refusal");
}
const json = (v: unknown) => JSON.stringify(v);
const readOne = (who: string, key: string) =>
  as<any>(who, "SELECT public.cockpit_form_editor_read_one($1) AS r", [key]);
const save = (who: string, key: string, schema: unknown, base: number | null) =>
  as<any>(
    who,
    "SELECT public.cockpit_form_draft_save($1, $2::jsonb, $3) AS r",
    [key, schema === null ? null : json(schema), base],
  );
const publish = (
  who: string,
  key: string,
  note: string | null,
  base: number | null,
) =>
  as<any>(who, "SELECT public.cockpit_form_publish($1, $2, $3) AS r", [
    key,
    note,
    base,
  ]);
const restore = (
  who: string,
  key: string,
  version: number,
  note: string | null,
) =>
  as<any>(who, "SELECT public.cockpit_form_restore($1, $2, $3) AS r", [
    key,
    version,
    note,
  ]);
const routing = (who: string, patch: unknown) =>
  as<any>(who, "SELECT public.cockpit_form_routing_set($1::jsonb) AS r", [
    json(patch),
  ]);
const published = async (key: string) =>
  (await readOne(ADMIN, key)).published as { version: number; schema: any };
/** Saves a draft on the published version and publishes it; returns the publish answer. */
async function edit(
  key: string,
  change: (s: any) => void,
  who = ADMIN,
  note = "A test change",
) {
  const p = await published(key);
  const next = copy(p.schema);
  change(next);
  await save(who, key, next, p.version);
  return publish(who, key, note, p.version);
}
/** The draft's refusal at publish, the draft then discarded. */
async function refusedPublish(key: string, change: (s: any) => void) {
  const p = await published(key);
  const next = copy(p.schema);
  change(next);
  await save(ADMIN, key, next, p.version);
  const r = await refusedWith(() =>
    publish(ADMIN, key, "A test change", p.version),
  );
  await save(ADMIN, key, null, p.version);
  return r;
}
const fieldOf = (s: any, key: string) =>
  s.fields.find((f: any) => f.key === key);
const effectLabel = (form: string, effect: string) =>
  one<string>("SELECT public.cockpit_form_editor_effect_label($1, $2) AS r", [
    form,
    effect,
  ]);

const ACL_AUTH = "{postgres=X/postgres,authenticated=X/postgres}";
const ACL_OWNER = "{postgres=X/postgres}";

describe("the file", () => {
  test("applies a second time and changes nothing", async () => {
    const before = await q(
      "SELECT key, version, md5(schema::text) AS s FROM public.cockpit_forms ORDER BY key",
    );
    const versions = await one<number>(
      "SELECT count(*)::int AS r FROM public.cockpit_form_versions",
    );
    const audits = await one<number>(
      "SELECT count(*)::int AS r FROM public.cockpit_audit_log",
    );
    await ex(migration(D));
    expect(
      await q(
        "SELECT key, version, md5(schema::text) AS s FROM public.cockpit_forms ORDER BY key",
      ),
    ).toEqual(before);
    expect(
      await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_form_versions",
      ),
    ).toBe(versions);
    // The doors merge touches nothing the second time, so no settings audit row.
    expect(
      await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_audit_log",
      ),
    ).toBe(audits);
    expect(
      await one<boolean>(
        "SELECT (value->>'editor')::boolean AS r FROM public.cockpit_settings WHERE key = 'forms.doors'",
      ),
    ).toBe(true);
  });

  test("the drift guard refuses a changed registry body", async () => {
    await rolledBack(async () => {
      await ex(`CREATE OR REPLACE FUNCTION public.cockpit_form_registry_apply(p_form_key text, p_patch jsonb, p_actor jsonb)
        RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN '{}'::jsonb; END $$;`);
      const r = await refusal(() => ex(migration(D)));
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_form_registry_apply(text,jsonb,jsonb) changed since the waves 3-4 contract read it; stop and re-read it.",
      );
    });
  });

  test("the guard's after value is this file's own body", async () => {
    const md5 = await one<string>(
      `SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_catalog.pg_proc p
        WHERE p.oid = to_regprocedure('public.cockpit_form_registry_apply(text,jsonb,jsonb)')`,
    );
    expect(migration(D)).toContain(
      `'73a88dc6513b074e54d76ec4472d3539', '${md5}'`,
    );
  });

  test("drafts: row security on, no browser grant, no delete or truncate", async () => {
    expect(
      await one<boolean>(
        "SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.cockpit_form_schema_drafts'::regclass",
      ),
    ).toBe(true);
    const grants = await q<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'cockpit_form_schema_drafts' AND grantee <> 'postgres'
        ORDER BY grantee, privilege_type`,
    );
    expect(grants).toEqual([
      { grantee: "service_role", privilege_type: "DELETE" },
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "UPDATE" },
    ]);
    const anonRead = await refusal(() =>
      as(null, "SELECT count(*) AS r FROM public.cockpit_form_schema_drafts"),
    );
    expect(anonRead.code).toBe("42501");
    const seatRead = await refusal(() =>
      as(ADMIN, "SELECT count(*) AS r FROM public.cockpit_form_schema_drafts"),
    );
    expect(seatRead.code).toBe("42501");
    await rolledBack(async () => {
      const p = await published("nps");
      await save(
        ADMIN,
        "nps",
        {
          ...copy(p.schema),
          title: { en: "How are we doing now?", ar: "شلون شغلنا الحين؟" },
        },
        p.version,
      );
      const del = await refusal(() =>
        ex("DELETE FROM public.cockpit_form_schema_drafts"),
      );
      expect(del.message).toBe("Forms records are never deleted");
      const trunc = await refusal(() =>
        ex("TRUNCATE public.cockpit_form_schema_drafts"),
      );
      expect(trunc.message).toBe("Forms records are never deleted");
    });
  });

  test("each RPC's grant: the browser RPCs to signed-in seats, the registry apply and the helpers to nobody", async () => {
    const acl = async (fn: string) =>
      one<string>(
        "SELECT proacl::text AS r FROM pg_proc WHERE oid = to_regprocedure($1)",
        [`public.${fn}`],
      );
    for (const fn of [
      "cockpit_form_editor_read()",
      "cockpit_form_editor_read_one(text)",
      "cockpit_form_draft_save(text,jsonb,integer)",
      "cockpit_form_publish(text,text,integer)",
      "cockpit_form_restore(text,integer,text)",
      "cockpit_form_routing_set(jsonb)",
    ])
      expect(await acl(fn)).toBe(ACL_AUTH);
    for (const fn of [
      "cockpit_form_registry_apply(text,jsonb,jsonb)",
      "cockpit_form_editor_version(text)",
      "cockpit_form_editor_kind(cockpit_forms)",
      "cockpit_form_editor_role(text)",
      "cockpit_form_editor_texts(jsonb)",
      "cockpit_form_editor_effect_label(text,text)",
      "cockpit_form_editor_read_map(jsonb)",
      "cockpit_form_editor_problem(text,jsonb,jsonb)",
      "cockpit_form_editor_seat()",
      "cockpit_form_editor_routing()",
      "cockpit_form_editor_row(cockpit_forms)",
      "cockpit_form_editor_publish_schema(jsonb,cockpit_forms,jsonb,text,text,integer)",
      "cockpit_form_schema_drafts_audit()",
      "cockpit_form_schema_drafts_guard()",
    ])
      expect(await acl(fn)).toBe(ACL_OWNER);
    // Every function is SECURITY DEFINER with an empty search path.
    const loose = await q(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (p.proname LIKE 'cockpit_form_editor%' OR p.proname IN
          ('cockpit_form_draft_save','cockpit_form_publish','cockpit_form_restore','cockpit_form_routing_set'))
          AND (NOT p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=""']))`,
    );
    expect(loose).toEqual([]);
  });
});

describe("who edits forms", () => {
  test("only an admin or the CEO reads or writes; anyone else is told so", async () => {
    for (const who of [CSM_A, FINANCE, CREATIVE, NOBODY]) {
      for (const call of [
        () => as(who, "SELECT public.cockpit_form_editor_read() AS r"),
        () => readOne(who, "nps"),
        () => save(who, "nps", NPS_SCHEMA, 1),
        () => publish(who, "nps", "A test change", 1),
        () => restore(who, "nps", 1, null),
        () => routing(who, { lowScore: { max: 5 } }),
      ]) {
        const r = await refusal(call);
        expect(r.code).toBe("42501");
        expect(r.message).toBe("Only an admin or the CEO edits forms.");
      }
    }
    for (const call of [
      () => as(null, "SELECT public.cockpit_form_editor_read() AS r"),
      () => readOne(null as unknown as string, "nps"),
      () => routing(null as unknown as string, { lowScore: { max: 5 } }),
    ]) {
      const r = await refusal(call);
      expect(r.code).toBe("42501");
    }
    const admin = await as<any>(
      ADMIN,
      "SELECT public.cockpit_form_editor_read() AS r",
    );
    const ceo = await as<any>(
      CEO,
      "SELECT public.cockpit_form_editor_read() AS r",
    );
    expect(admin.forms.length).toBeGreaterThan(0);
    expect(ceo.forms.map((f: any) => f.key)).toEqual(
      admin.forms.map((f: any) => f.key),
    );
  });

  test("the editor reads run in a read-only transaction (PostgREST runs STABLE functions so)", async () => {
    for (const who of [ADMIN, CEO]) {
      await actor(db, who);
      await db.exec("BEGIN TRANSACTION READ ONLY");
      try {
        const all = (
          await db.query<{ r: any }>(
            "SELECT public.cockpit_form_editor_read() AS r",
          )
        ).rows[0]?.r;
        const nps = (
          await db.query<{ r: any }>(
            "SELECT public.cockpit_form_editor_read_one('nps') AS r",
          )
        ).rows[0]?.r;
        const staff = (
          await db.query<{ r: any }>(
            "SELECT public.cockpit_form_editor_read_one('extension') AS r",
          )
        ).rows[0]?.r;
        expect(all.forms.length).toBeGreaterThan(0);
        expect(nps.published.schema.key).toBe("nps");
        expect(staff.published).toBeNull();
      } finally {
        await db.exec("COMMIT");
        await asOwner();
      }
    }
  });

  test("no address reaches a browser read: roles, never emails", async () => {
    await rolledBack(async () => {
      await edit("nps", s => {
        fieldOf(s, "startStop").label.en =
          "What should we start, keep or stop doing?";
      });
      const p = await published("csat");
      await save(CEO, "csat", { ...copy(p.schema), minutes: 2 }, p.version);
      const all = json(
        await as(ADMIN, "SELECT public.cockpit_form_editor_read() AS r"),
      );
      const nps = await readOne(ADMIN, "nps");
      const csat = await readOne(ADMIN, "csat");
      for (const text of [all, json(nps), json(csat)])
        expect(text).not.toMatch(/@/);
      expect(nps.history[0].publishedBy).toBe("an admin");
      expect(csat.draft.savedBy).toBe("the CEO");
    });
  });
});

describe("the list (4.9.6, 5.9, 5.13)", () => {
  test("client forms are editable; staff, Typeform/Make and the portal's feedback are read only with their sentence", async () => {
    const read = await as<any>(
      ADMIN,
      "SELECT public.cockpit_form_editor_read() AS r",
    );
    const by = (k: string) => read.forms.find((f: any) => f.key === k);
    for (const k of ["nps", "csat", "pause_consent", "exit_survey"]) {
      expect(by(k).group).toBe("client");
      expect(by(k).editable).toBe(true);
    }
    // The exit survey is edited on its client version while the registry still reads Typeform's.
    expect(by("exit_survey").provider).toBe("typeform");
    expect(by("exit_survey").registryVersion).toBe(1);
    expect(by("exit_survey").version).toBeGreaterThanOrEqual(2);
    for (const k of ["extension", "pause", "resume", "churn_confirm", "mrr"]) {
      expect(by(k).group).toBe("staff");
      expect(by(k).editable).toBe(false);
      expect(by(k).why).toBe(
        "Set in the cockpit's code; the SQL checks these fields word for word.",
      );
    }
    // The 1-1 notes and the Blueprint read as where they are filled: the cockpit once native, Typeform before.
    for (const k of ["checkin", "blueprint"]) {
      expect(by(k).editable).toBe(false);
      expect(by(k).why).toBe(
        by(k).provider === "native"
          ? "Set in the cockpit's code; the SQL checks these fields word for word."
          : "Lives in Typeform; Make owns its effects until Stage 4.",
      );
    }
    for (const k of ["kickoff", "pause_request"]) {
      expect(by(k).group).toBe("typeform");
      expect(by(k).why).toBe(
        "Lives in Typeform; Make owns its effects until Stage 4.",
      );
    }
    expect(by("portal_feedback").editable).toBe(false);
    expect(by("portal_feedback").why).toBe(
      "The portal's Share feedback writes these; edit it in the portal.",
    );
    // Client forms first, then staff, then Typeform and Make.
    const groups = read.forms.map((f: any) => f.group);
    expect(groups).toEqual(
      [...groups].sort(
        (a: string, b: string) =>
          ["client", "staff", "typeform"].indexOf(a) -
          ["client", "staff", "typeform"].indexOf(b),
      ),
    );
    // The preview's workspaces: open ones, Active first by name; a cancelled one never.
    expect(read.workspaces.map((w: any) => w.locationId)).toEqual([
      "locAlpha01",
      "locZeta01",
      "locBeta01",
    ]);
    expect(read.portalBase).toBe("https://portal.maharamedia.com");
    expect(read.routing.lowScore).toEqual({ max: 6 });
    expect(read.routing.scheduleOn).toBe(false);
  });

  test("a staff form's read shows its record of keys, never a schema to edit", async () => {
    const ext = await readOne(ADMIN, "extension");
    expect(ext.published).toBeNull();
    expect(ext.form.editable).toBe(false);
    expect(ext.record.fields.length).toBeGreaterThan(0);
    expect(ext.record.lives).toBe(
      "apps/client-success-cockpit/src/forms/staff/formDefs.ts",
    );
  });
});

describe("drafts", () => {
  test("a stale or unknown base is refused; the draft belongs to its form; Discard removes it", async () => {
    await rolledBack(async () => {
      const p = await published("nps");
      const next = { ...copy(p.schema), minutes: 2 };
      const stale = await refusal(() =>
        save(ADMIN, "nps", next, p.version - 1),
      );
      expect(stale.message).toBe(
        `Someone published version ${p.version} since you opened this. Reload it.`,
      );
      const none = await refusal(() => save(ADMIN, "nps", next, null));
      expect(none.message).toBe(
        `Someone published version ${p.version} since you opened this. Reload it.`,
      );
      const ahead = await refusal(() =>
        save(ADMIN, "nps", next, p.version + 1),
      );
      expect(ahead.message).toBe(
        `There is no version ${p.version + 1} of this form. Reload it.`,
      );
      const other = await refusal(() =>
        save(ADMIN, "nps", { ...next, key: "csat" }, p.version),
      );
      expect(other.message).toBe(
        "This draft belongs to another form. Reload it.",
      );
      const big = await refusal(() =>
        save(
          ADMIN,
          "nps",
          { ...next, intro: { en: "x".repeat(70_000), ar: "س" } },
          p.version,
        ),
      );
      expect(big.message).toBe("A form is at most 64 KB. Shorten its texts.");

      const saved = await save(ADMIN, "nps", next, p.version);
      expect(saved.draft.baseVersion).toBe(p.version);
      expect(saved.draft.problem).toBeNull();
      expect(saved.form.draft.stale).toBe(false);
      const audit = await q<any>(
        "SELECT action, after FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_form_schema_drafts' AND metadata->>'op' = 'insert'",
      );
      expect(audit.length).toBe(1);
      expect(audit[0].action).toBe("forms.editor_draft");
      expect(audit[0].after.schema_md5).toBe(
        await one("SELECT md5($1::jsonb::text) AS r", [json(next)]),
      );
      expect(json(audit[0].after)).not.toContain("How are we doing");

      // The published schema as a draft reads "No changes yet." and cannot publish.
      const same = await save(ADMIN, "nps", p.schema, p.version);
      expect(same.draft.problem).toBe("No changes yet.");
      const nothing = await refusal(() =>
        publish(ADMIN, "nps", "Nothing new", p.version),
      );
      expect(nothing.message).toBe("No changes yet.");

      const gone = await save(ADMIN, "nps", null, p.version);
      expect(gone.draft).toBeNull();
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_form_schema_drafts' AND action = 'forms.editor_discard' AND metadata->>'op' = 'delete'",
        ),
      ).toBe(1);
      const noDraft = await refusal(() =>
        publish(ADMIN, "nps", "A test change", p.version),
      );
      expect(noDraft.message).toBe("No changes yet.");
    });
  });

  test("a draft reads the problem publish would refuse with, before anyone presses it", async () => {
    await rolledBack(async () => {
      const p = await published("nps");
      const next = copy(p.schema);
      next.fields = next.fields.filter((f: any) => f.key !== "recommend");
      const saved = await save(ADMIN, "nps", next, p.version);
      const label = fieldOf(p.schema, "recommend").label.en;
      expect(saved.draft.problem).toBe(
        `${label} is read by ${await effectLabel("nps", "low_score")}. Remove that effect first.`,
      );
      expect(saved.draft.where).toBe(".fields.recommend");
    });
  });
});

describe("publish (4.9.3, 4.9.4)", () => {
  test("a note is needed, and a stale base is refused", async () => {
    await rolledBack(async () => {
      const p = await published("csat");
      await save(ADMIN, "csat", { ...copy(p.schema), minutes: 2 }, p.version);
      for (const note of [null, "", "  ", "ok"]) {
        const r = await refusal(() => publish(ADMIN, "csat", note, p.version));
        expect(r.message).toBe(
          "Say what changed in a few words (3 to 240 characters); it shows in the history.",
        );
      }
      const stale = await refusal(() =>
        publish(ADMIN, "csat", "Two minutes", p.version - 1),
      );
      expect(stale.message).toBe(
        `Someone published version ${p.version} since you opened this. Reload it.`,
      );
    });
  });

  test("the schema check runs first: a file question is refused in its words", async () => {
    await rolledBack(async () => {
      const r = await refusedPublish("nps", s => {
        s.fields.push({
          key: "receipt",
          type: "file",
          label: { en: "Upload it", ar: "ارفعه" },
          required: false,
        });
      });
      const p = await published("nps");
      const expected = await one<string>(
        "SELECT public.cockpit_form_schema_check($1::jsonb) AS r",
        [
          json({
            ...p.schema,
            fields: [
              ...p.schema.fields,
              {
                key: "receipt",
                type: "file",
                label: { en: "Upload it", ar: "ارفعه" },
                required: false,
              },
            ],
          }),
        ],
      );
      expect(expected).toBeTruthy();
      expect(r.code).toBe("22023");
      expect(r.message).toBe(expected);
      // A missing Arabic text is a schema problem too.
      const ar = await refusedPublish("nps", s => {
        s.title.ar = "";
      });
      expect(ar.code).toBe("22023");
      expect(ar.message.length).toBeGreaterThan(0);
    });
  });

  test("the text rule runs on every text: leads, CPL and guarantee wording in either language", async () => {
    await rolledBack(async () => {
      const leads =
        "Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.";
      const guarantee =
        "Client forms never promise results. Remove the guarantee wording.";
      const cases: [string, (s: any) => void, string, string][] = [
        [
          "English leads",
          s => {
            fieldOf(s, "results").label.en =
              "How happy are you with your leads so far?";
          },
          leads,
          ".fields[1].label.en",
        ],
        [
          "CPL",
          s => {
            s.intro.en = "One minute about your CPL.";
          },
          leads,
          ".intro.en",
        ],
        [
          "Arabic ليدز",
          s => {
            fieldOf(s, "results").hint = {
              en: "Your results",
              ar: "شكثر عجبتك الليدز؟",
            };
          },
          leads,
          ".fields[1].hint.ar",
        ],
        [
          "guarantee",
          s => {
            s.done.en = "Thanks. We guarantee a reply.";
          },
          guarantee,
          ".done.en",
        ],
        [
          "Arabic نضمن",
          s => {
            s.invite.push.ar = "نضمن لك نتائج. اضغط وجاوب.";
          },
          guarantee,
          ".invite.push.ar",
        ],
      ];
      for (const [, change, message, where] of cases) {
        const r = await refusedPublish("nps", change);
        expect(r.message).toBe(message);
        expect(r.hint).toBe(where);
      }
      // Plain words about the people who reached them pass.
      const ok = await edit("nps", s => {
        fieldOf(s, "results").label.en =
          "How happy are you with the people who reached you so far?";
      });
      expect(ok.version).toBeGreaterThan(1);
    });
  });

  test("the WhatsApp text keeps {form_link} exactly once", async () => {
    await rolledBack(async () => {
      for (const text of [
        "Hi {client} team, answer here.",
        "Hi {form_link} and {form_link}",
      ]) {
        const r = await refusedPublish("nps", s => {
          s.invite.whatsapp.en = text;
        });
        expect(r.message).toMatch(/form_link|WhatsApp/);
        if (!REAL_A)
          expect(r.message).toBe(
            "The WhatsApp text needs {form_link} exactly once, where the link goes.",
          );
      }
    });
  });

  test("the field guard: a read field cannot go or hide, and keeps its type, range, requirement and choices", async () => {
    await rolledBack(async () => {
      const p = await published("nps");
      const label = fieldOf(p.schema, "recommend").label.en;
      const effect = await effectLabel("nps", "low_score");
      const gone = `${label} is read by ${effect}. Remove that effect first.`;
      const frozen = `${label} is read by ${effect}, so its type, range and choices stay as they are.`;
      const removed = await refusedPublish("nps", s => {
        s.fields = s.fields.filter((f: any) => f.key !== "recommend");
      });
      expect(removed.message).toBe(gone);
      const hidden = await refusedPublish("nps", s => {
        const rec = fieldOf(s, "recommend");
        s.fields = [
          fieldOf(s, "results"),
          rec,
          ...s.fields.filter(
            (f: any) => !["results", "recommend"].includes(f.key),
          ),
        ];
        rec.showIf = { key: "results", equals: 10 };
      });
      expect(hidden.message).toBe(gone);
      for (const change of [
        (f: any) => {
          f.max = 5;
        },
        (f: any) => {
          f.min = 1;
        },
        (f: any) => {
          f.required = false;
        },
        (f: any) => {
          f.type = "choice";
          f.options = [
            { value: "yes", label: { en: "Yes", ar: "إي" } },
            { value: "no", label: { en: "No", ar: "لا" } },
          ];
          delete f.min;
          delete f.max;
        },
      ]) {
        const r = await refusedPublish("nps", s =>
          change(fieldOf(s, "recommend")),
        );
        // A type change can trip the schema check first; the guard otherwise.
        if (!r.message.startsWith(label)) expect(r.code).toBe("22023");
        else expect(r.message).toBe(frozen);
      }
      // Words stay free: the label, its Arabic and the scale ends publish.
      const out = await edit("nps", s => {
        const rec = fieldOf(s, "recommend");
        rec.label.en =
          "How likely are you to recommend Mahara to another business owner?";
        rec.label.ar = "شكثر ممكن تنصح فينا صاحب شركة ثاني؟";
        rec.lowLabel.en = "0 = Not likely";
      });
      expect(out.version).toBe(p.version + 1);
    });
  });

  test("choice values of a read field stay; their labels change", async () => {
    await rolledBack(async () => {
      const p = await published("exit_survey");
      const label = fieldOf(p.schema, "reasons").label.en;
      const frozen = `${label} is read by ${await effectLabel("exit_survey", "card_comment")}, so its type, range and choices stay as they are.`;
      const renamedValue = await refusedPublish("exit_survey", s => {
        fieldOf(s, "reasons").options[0].value = "outcomes";
      });
      expect(renamedValue.message).toBe(frozen);
      const dropped = await refusedPublish("exit_survey", s => {
        fieldOf(s, "reasons").options.pop();
      });
      expect(dropped.message).toBe(frozen);
      const relabelled = await edit("exit_survey", s => {
        fieldOf(s, "reasons").options[0].label = {
          en: "The ads did not work for us",
          ar: "الإعلانات ما نفعت معانا",
        };
      });
      expect(relabelled.version).toBe(p.version + 1);
      // A choice of a field nothing reads may go (stored answers keep their value).
      const pc = await published("pause_consent");
      const dropReason = await edit("pause_consent", s => {
        fieldOf(s, "reason").options = fieldOf(s, "reason").options.filter(
          (o: any) => o.value !== "season",
        );
      });
      expect(dropReason.version).toBe(pc.version + 1);
    });
  });

  test("a published key cannot be renamed, and a key keeps its type for good", async () => {
    await rolledBack(async () => {
      const renamed = await refusedPublish("nps", s => {
        fieldOf(s, "communication").key = "teamTalk";
      });
      expect(renamed.message).toBe(
        "Question keys never change once published. Keep the key communication.",
      );
      // Removing a question nothing reads publishes; bringing its key back as another type is refused.
      const p = await published("nps");
      await edit("nps", s => {
        s.fields = s.fields.filter((f: any) => f.key !== "communication");
      });
      const back = await refusedPublish("nps", s => {
        s.fields.push({
          key: "communication",
          type: "longtext",
          required: false,
          maxLength: 500,
          showIf: null,
          hint: null,
          label: {
            en: "Tell us about communication",
            ar: "قول لنا عن التواصل",
          },
        });
      });
      expect(back.message).toBe(
        `communication was a scale question in version ${p.version}. Pick a new key.`,
      );
    });
  });

  test("who answers and what the cockpit reads never change in the editor", async () => {
    await rolledBack(async () => {
      for (const change of [
        (s: any) => {
          s.audience = "admin";
        },
        (s: any) => {
          s.signer = "typed";
        },
      ]) {
        const r = await refusedPublish("nps", change);
        expect(r.message).toBe(
          "Who answers this form is set in the cockpit's code.",
        );
      }
      const reads = await refusedPublish("nps", s => {
        s.reads = { low_score: ["recommend"] };
      });
      expect(reads.message).toBe(
        "Which questions the cockpit reads is set in its code.",
      );
      const facts = await refusedPublish("pause_consent", s => {
        s.context = s.context.filter((c: any) => c.key !== "restart");
      });
      expect(facts.message).toBe(
        "The facts shown from the invite are set in the cockpit's code. Change only their wording.",
      );
      // Their wording may change.
      const ok = await edit("pause_consent", s => {
        s.context[0].label = { en: "The pause starts", ar: "يبدأ الإيقاف من" };
      });
      expect(ok.version).toBeGreaterThan(1);
    });
  });

  test("publish adds one version, moves the registry, removes the draft and writes the audit rows", async () => {
    await rolledBack(async () => {
      const p = await published("nps");
      const before = await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_form_versions WHERE form_key = 'nps'",
      );
      const next = copy(p.schema);
      next.fields.push({
        key: "nextStep",
        type: "choice",
        required: false,
        showIf: null,
        hint: null,
        label: {
          en: "What would you like next?",
          ar: "شنو تبي الخطوة الياية؟",
        },
        options: [
          {
            value: "more_videos",
            label: { en: "More videos", ar: "فيديوهات أكثر" },
          },
          { value: "a_call", label: { en: "A call", ar: "مكالمة" } },
        ],
      });
      await save(CEO, "nps", next, p.version);
      const out = await publish(
        CEO,
        "nps",
        "Added what they want next",
        p.version,
      );
      expect(out.version).toBe(p.version + 1);
      expect(out.registryUpdated).toBe(true);
      expect(out.read.draft).toBeNull();
      expect(out.read.history[0]).toMatchObject({
        version: p.version + 1,
        publishedBy: "the CEO",
        note: "Added what they want next",
        current: true,
      });
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_form_versions WHERE form_key = 'nps'",
        ),
      ).toBe(before + 1);
      const reg = (
        await q<any>(
          "SELECT version, schema FROM public.cockpit_forms WHERE key = 'nps'",
        )
      )[0];
      expect(reg.version).toBe(p.version + 1);
      expect(reg.schema).toEqual(next);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_form_schema_drafts WHERE form_key = 'nps'",
        ),
      ).toBe(0);
      // The old version is untouched.
      expect(
        (
          await q<any>(
            "SELECT schema FROM public.cockpit_form_versions WHERE form_key = 'nps' AND version = $1",
            [p.version],
          )
        )[0].schema,
      ).toEqual(p.schema);
      const audit = await q<any>(
        "SELECT action, entity_type, entity_id, metadata FROM public.cockpit_audit_log WHERE action = 'forms.editor_publish' ORDER BY id",
      );
      const summary = audit.find(
        a => a.entity_type === "cockpit_forms" && a.metadata.op === "publish",
      );
      expect(summary.entity_id).toBe("nps");
      expect(summary.metadata.added).toEqual(["nextStep"]);
      expect(summary.metadata.registry).toBe("updated");
      expect(
        audit.some(
          a =>
            a.entity_type === "cockpit_form_versions" &&
            a.entity_id === `nps:${p.version + 1}`,
        ),
      ).toBe(true);
      // The base is now stale for anyone who opened the old version.
      const again = await refusal(() => save(ADMIN, "nps", next, p.version));
      expect(again.message).toBe(
        `Someone published version ${p.version + 1} since you opened this. Reload it.`,
      );
    });
  });

  test("the exit survey on Typeform: publish adds a version row and leaves the registry alone", async () => {
    await rolledBack(async () => {
      const regBefore = (
        await q<any>(
          "SELECT provider, version, md5(schema::text) AS s FROM public.cockpit_forms WHERE key = 'exit_survey'",
        )
      )[0];
      expect(regBefore.provider).toBe("typeform");
      const p = await published("exit_survey");
      const out = await edit("exit_survey", s => {
        s.intro.en =
          "We are sorry to see you go. Your answers reach your account manager and our CEO.";
      });
      expect(out.version).toBe(p.version + 1);
      expect(out.registryUpdated).toBe(false);
      expect(
        (
          await q<any>(
            "SELECT provider, version, md5(schema::text) AS s FROM public.cockpit_forms WHERE key = 'exit_survey'",
          )
        )[0],
      ).toEqual(regBefore);
      expect(out.read.form.version).toBe(p.version + 1);
      const summary = (
        await q<any>(
          "SELECT metadata FROM public.cockpit_audit_log WHERE action = 'forms.editor_publish' AND entity_id = 'exit_survey' AND entity_type = 'cockpit_forms' ORDER BY id DESC LIMIT 1",
        )
      )[0];
      expect(summary.metadata.registry).toBe("left as it was");
    });
  });

  test.skipIf(!REAL_A)(
    "open invites keep their version and their answers still pass its check (with 20261102a)",
    async () => {
      await rolledBack(async () => {
        const p = await published("nps");
        await ex(`INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ('forms.client', '{"live":["nps"],"presence":false}', 'test')
        ON CONFLICT (key) DO UPDATE SET value = '{"live":["nps"],"presence":false}'`);
        const invite = await as<any>(
          CEO,
          "SELECT public.cockpit_form_invite_issue($1, 'nps', ARRAY['portal'], NULL, 'ar', false, '{}'::jsonb, $2, 'csm') AS r",
          [A, crypto.randomUUID()],
        );
        await edit("nps", s => {
          s.fields = s.fields.filter((f: any) => f.key !== "startStop");
        });
        const row = (
          await q<any>(
            "SELECT form_version FROM public.cockpit_form_invites WHERE id = $1",
            [invite.inviteId],
          )
        )[0];
        expect(row.form_version).toBe(p.version);
        const answers = { recommend: 9, startStop: "Keep the weekly calls" };
        const checked = await one<any>(
          "SELECT public.cockpit_form_answers_check($1::jsonb, $2::jsonb, '{}'::jsonb) AS r",
          [json(p.schema), json(answers)],
        );
        expect(checked.ok).toBe(true);
      });
    },
  );
});

describe("go back to a version (4.9.5)", () => {
  test("restore publishes the old schema as a new version through the same checks", async () => {
    await rolledBack(async () => {
      const v1 = await published("csat");
      await edit("csat", s => {
        s.minutes = 2;
        s.fields.push({
          key: "bestPart",
          type: "text",
          required: false,
          maxLength: 200,
          showIf: null,
          hint: null,
          label: {
            en: "The best part, in a few words",
            ar: "أحلى شي، بكلمتين",
          },
        });
      });
      const out = await restore(
        ADMIN,
        "csat",
        v1.version,
        "The extra question was too much",
      );
      expect(out.version).toBe(v1.version + 2);
      expect(out.read.published.schema).toEqual(v1.schema);
      expect(out.read.history[0].note).toBe(
        `Restored version ${v1.version}: The extra question was too much`,
      );
      expect(
        (
          await q<any>(
            "SELECT version, schema FROM public.cockpit_forms WHERE key = 'csat'",
          )
        )[0],
      ).toEqual({
        version: v1.version + 2,
        schema: v1.schema,
      });
      const plain = await restore(ADMIN, "csat", v1.version + 1, null);
      expect(plain.read.history[0].note).toBe(
        `Restored version ${v1.version + 1}`,
      );
      const current = await refusal(() =>
        restore(ADMIN, "csat", plain.version, null),
      );
      expect(current.message).toBe(
        `Version ${plain.version} is the published one already.`,
      );
      const missing = await refusal(() => restore(ADMIN, "csat", 99, null));
      expect(missing.message).toBe("There is no version 99 of this form.");
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'forms.editor_restore' AND entity_type = 'cockpit_forms' AND metadata->>'op' = 'restore'",
        ),
      ).toBe(2);
    });
  });

  test("the exit survey's Typeform version cannot come back; the field guard holds on restore", async () => {
    await rolledBack(async () => {
      const typeform = await refusal(() =>
        restore(ADMIN, "exit_survey", 1, null),
      );
      expect(typeform.message).toBe(
        "Version 1 is not a portal form, so it cannot come back here.",
      );
      // An old version whose read field had another range is refused like a publish.
      const p = await published("csat");
      const odd = copy(p.schema);
      fieldOf(odd, "onboarding").max = 5;
      await ex(`INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by, note)
        VALUES ('csat', 50, '${json(odd).replace(/'/g, "''")}', 'migration test', 'odd')`);
      await ex(
        `UPDATE public.cockpit_forms SET version = 50, schema = '${json(odd).replace(/'/g, "''")}' WHERE key = 'csat'`,
      );
      const back = await refusal(() => restore(ADMIN, "csat", p.version, null));
      // The effect named is the first, by key, of those that read the field.
      const first = Object.entries(odd.reads as Record<string, string[]>)
        .filter(([, fields]) => fields.includes("onboarding"))
        .map(([e]) => e)
        .sort()[0] as string;
      expect(back.message).toBe(
        `${fieldOf(odd, "onboarding").label.en} is read by ${await effectLabel("csat", first)}, so its type, range and choices stay as they are.`,
      );
    });
  });
});

describe("read-only forms and the registry", () => {
  test("staff, Typeform/Make and the portal's feedback refuse a draft, a publish and a restore with their sentence", async () => {
    const checkin = await one<string>(
      "SELECT provider AS r FROM public.cockpit_forms WHERE key = 'checkin'",
    );
    const cases: [string, string][] = [
      [
        "extension",
        "Set in the cockpit's code; the SQL checks these fields word for word.",
      ],
      [
        "mrr",
        "Set in the cockpit's code; the SQL checks these fields word for word.",
      ],
      [
        "checkin",
        checkin === "native"
          ? "Set in the cockpit's code; the SQL checks these fields word for word."
          : "Lives in Typeform; Make owns its effects until Stage 4.",
      ],
      ["kickoff", "Lives in Typeform; Make owns its effects until Stage 4."],
      [
        "pause_request",
        "Lives in Typeform; Make owns its effects until Stage 4.",
      ],
      [
        "portal_feedback",
        "The portal's Share feedback writes these; edit it in the portal.",
      ],
    ];
    for (const [key, why] of cases) {
      for (const call of [
        () => save(ADMIN, key, { v: 1, key }, 1),
        () => publish(CEO, key, "A test change", 1),
        () => restore(CEO, key, 1, null),
      ]) {
        const r = await refusal(call);
        expect(r.code).toBe("22023");
        expect(r.message).toBe(why);
      }
    }
  });

  test("cockpit_form_registry_apply keeps W19 and sends client forms to the editor", async () => {
    await rolledBack(async () => {
      const apply = (
        key: string,
        patch: unknown,
        who: unknown = { via: "cockpit", who: "ceo", email: CEO_EMAIL },
      ) =>
        one<any>(
          "SELECT public.cockpit_form_registry_apply($1, $2::jsonb, $3::jsonb) AS r",
          [key, json(patch), json(who)],
        );
      for (const key of [
        "extension",
        "pause",
        "resume",
        "churn_confirm",
        "mrr",
      ]) {
        const r = await refusal(() => apply(key, { owners: "make" }));
        expect(r.message).toBe(
          "This form is set in the cockpit's code until the form editor ships.",
        );
      }
      for (const key of ["nps", "csat", "pause_consent"]) {
        const r = await refusal(() => apply(key, { owners: "cockpit" }));
        expect(r.message).toBe("Edit client forms in the forms editor.");
      }
      for (const patch of [
        { schema: NPS_SCHEMA },
        { version: 3 },
        { fields: [] },
      ]) {
        const r = await refusal(() => apply("exit_survey", patch));
        expect(r.message).toBe("Edit client forms in the forms editor.");
      }
      // Everything else as before: owners of the exit survey by the CEO, the checkin no-op, the old refusals.
      const effects = await one<any>(
        "SELECT effects AS r FROM public.cockpit_forms WHERE key = 'exit_survey'",
      );
      const owners = Object.fromEntries(
        effects.map((e: any) => [e.key, e.owner]),
      );
      const view = await apply("exit_survey", { owners });
      expect(view.key).toBe("exit_survey");
      const notCeo = await refusal(() =>
        apply("exit_survey", { owners }, { via: "cockpit", who: "csm" }),
      );
      expect(notCeo.message).toBe(
        "Only the CEO changes who delivers this form's steps.",
      );
      const blueprint = await refusal(() => apply("blueprint", { schema: {} }));
      expect(blueprint.message).toBe(
        "Change only provider and owners, with make, shadow or cockpit for effects this form has.",
      );
      const via = await refusal(() =>
        apply("nps", { owners: "make" }, { via: "browser" }),
      );
      expect(via.message).toBe(
        "The registry changes only from the cockpit or the cut-over.",
      );
    });
  });
});

describe("routing (4.9.2)", () => {
  test("each schedule key in its bounds; a whole number; every key always present", async () => {
    await rolledBack(async () => {
      const bad: [unknown, string][] = [
        [
          { nps: { rule: { firstDay: 29 } } },
          "The first NPS day after launch is a whole number from 30 to 180.",
        ],
        [
          { nps: { rule: { firstDay: 181 } } },
          "The first NPS day after launch is a whole number from 30 to 180.",
        ],
        [
          { nps: { rule: { everyDays: 366 } } },
          "The days between NPS rounds is a whole number from 30 to 365.",
        ],
        [
          { nps: { rule: { everyDays: 29 } } },
          "The days between NPS rounds is a whole number from 30 to 365.",
        ],
        [
          { nps: { rule: { firstDay: 60.5 } } },
          "The first NPS day after launch is a whole number from 30 to 180.",
        ],
        [
          { nps: { rule: { firstDay: "60" } } },
          "The first NPS day after launch is a whole number from 30 to 180.",
        ],
        [
          { csat: { rule: { whatsappAfterDays: 15 } } },
          "The day after launch the WhatsApp link goes is a whole number from 0 to 14.",
        ],
        [
          { csat: { rule: { snoozeDays: 0 } } },
          'The days "Not now" waits is a whole number from 1 to 14.',
        ],
        [
          { csat: { rule: { snoozeDays: 15 } } },
          'The days "Not now" waits is a whole number from 1 to 14.',
        ],
        [
          { csat: { rule: { reissues: 6 } } },
          "The number of re-tries is a whole number from 0 to 5.",
        ],
        [
          { csat: { rule: { retryAfterDays: 0 } } },
          "The days between re-tries is a whole number from 1 to 30.",
        ],
        [
          { csat: { rule: { retryAfterDays: 31 } } },
          "The days between re-tries is a whole number from 1 to 30.",
        ],
        [
          { csat: { rule: { maxAgeDays: 13 } } },
          "The last day after launch it can go is a whole number from 14 to 120.",
        ],
        [
          { csat: { rule: { maxAgeDays: 121 } } },
          "The last day after launch it can go is a whole number from 14 to 120.",
        ],
        [
          { csat: { rule: { afterLaunchDays: 20, maxAgeDays: 20 } } },
          "The last day it can go must come after the day it first goes.",
        ],
        [
          { csat: { rule: { surprise: 1 } } },
          "That rule has a setting the schedule does not read. Reload it.",
        ],
        [
          { csat: { on: "yes" } },
          "A schedule change is its switch and its rule.",
        ],
        [
          { checkin: { on: true } },
          "Change the NPS schedule, the onboarding survey schedule or the low-score line.",
        ],
        [
          { lowScore: { max: 9 } },
          "The low-score line is a whole number from 0 to 8.",
        ],
        [
          { lowScore: { max: -1 } },
          "The low-score line is a whole number from 0 to 8.",
        ],
        [
          { lowScore: { max: 6.5 } },
          "The low-score line is a whole number from 0 to 8.",
        ],
      ];
      for (const [patch, message] of bad) {
        const r = await refusal(() => routing(ADMIN, patch));
        expect(r.code).toBe("22023");
        expect(r.message).toBe(message);
      }
      const ok = await routing(CEO, {
        nps: { rule: { firstDay: 30, everyDays: 365 } },
        csat: { on: false, rule: { retryAfterDays: 1, maxAgeDays: 14 } },
        lowScore: { max: 8 },
      });
      expect(ok.schedules.nps.rule).toEqual({
        firstDay: 30,
        everyDays: 365,
        remindAfterDays: 7,
      });
      expect(ok.schedules.csat.on).toBe(false);
      expect(ok.schedules.csat.rule).toEqual({
        afterLaunchDays: 0,
        whatsappAfterDays: 3,
        snoozeDays: 3,
        reissues: 3,
        retryAfterDays: 1,
        maxAgeDays: 14,
      });
      expect(ok.schedules.nps.updatedBy).toBe("the CEO");
      expect(ok.lowScore).toEqual({ max: 8 });
      const audit = await q<any>(
        "SELECT entity_type, entity_id FROM public.cockpit_audit_log WHERE action = 'forms.routing_set' AND source_system = 'cockpit'",
      );
      expect(audit.map(a => `${a.entity_type}:${a.entity_id}`).sort()).toEqual([
        "cockpit_form_schedules:csat",
        "cockpit_form_schedules:nps",
        "cockpit_settings:voice.low_score",
      ]);
      // The same values again change nothing and write nothing.
      await routing(CEO, {
        nps: { rule: { firstDay: 30 } },
        lowScore: { max: 8 },
      });
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'forms.routing_set' AND source_system = 'cockpit'",
        ),
      ).toBe(3);
      // A stored rule missing a key cannot be saved until the key is set.
      await ex(
        `UPDATE public.cockpit_form_schedules SET rule = rule - 'retryAfterDays' WHERE form_key = 'csat'`,
      );
      const missing = await refusal(() =>
        routing(ADMIN, { csat: { rule: { snoozeDays: 4 } } }),
      );
      expect(missing.message).toBe(
        "The days between re-tries is missing. Set it, then save.",
      );
      const fixed = await routing(ADMIN, {
        csat: { rule: { snoozeDays: 4, retryAfterDays: 7 } },
      });
      expect(Object.keys(fixed.schedules.csat.rule).sort()).toEqual([
        "afterLaunchDays",
        "maxAgeDays",
        "reissues",
        "retryAfterDays",
        "snoozeDays",
        "whatsappAfterDays",
      ]);
    });
  });

  test("the routing read says when the schedule is off, and the low-score line keeps its other keys", async () => {
    await rolledBack(async () => {
      await ex(
        `UPDATE public.cockpit_settings SET value = '{"max":6,"note":"kept"}' WHERE key = 'voice.low_score'`,
      );
      const out = await routing(ADMIN, { lowScore: { max: 5 } });
      expect(out.note).toBe(
        "The automatic schedule is off for every client; these rules apply once it is turned on.",
      );
      expect(
        await one<any>(
          "SELECT value AS r FROM public.cockpit_settings WHERE key = 'voice.low_score'",
        ),
      ).toEqual({ max: 5, note: "kept" });
    });
  });
});

describe("the text walk", () => {
  test("every English and Arabic text of a schema, with its path", async () => {
    const rows = await q<{ path: string; value: string }>(
      "SELECT path, value FROM public.cockpit_form_editor_texts($1::jsonb)",
      [json(NPS_SCHEMA)],
    );
    expect(rows.find(r => r.path === ".title.ar")?.value).toBe(
      NPS_SCHEMA.title.ar,
    );
    expect(rows.find(r => r.path === ".fields[0].lowLabel.en")?.value).toBe(
      "0 = Not at all likely",
    );
    expect(
      rows.some(r => r.path.endsWith(".key") || r.path.endsWith(".type")),
    ).toBe(false);
    // Two texts for every {en, ar} object in the schema.
    expect(rows.length % 2).toBe(0);
  });
});
