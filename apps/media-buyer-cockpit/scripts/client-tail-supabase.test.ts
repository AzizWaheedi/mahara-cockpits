/**
 * Waves 5 and 6, client tail: supabase/migrations/20261102i_client_tail.sql (docs/forms/WAVE56-CONTRACT.md
 * 2.5, 3.6, 3.7, 4.10 to 4.12 and the client-tail row of section 8) on one isolated PostgreSQL with
 * Supabase's default privileges on, so a missing REVOKE opens a function here as it would in production.
 *
 * The ground is forms-editor-supabase.test.ts's, word for word (waves 1-2 from 20261101l to r, then
 * 20261102a to d as the real files), then 20261102e and f, then 20261102g and h: the real files when
 * the money-rails and wins-pay branches have landed them, else the few objects this file reads,
 * exactly as the contract names them (G_STUB: billing kinds win and reactivate, the three notice
 * kinds, the door markers; H_STUB: the wins ledger and its events). h applies before i, as 2.1 orders.
 * Then 20261102i.
 *
 * Covered: the file applies twice and changes nothing, keeping a marker that was switched on; the drift
 * guard holds this file's own md5 for each replaced body and refuses a changed one; the answer check is
 * STABLE; the bucket is private with no policy; the tables' row security, grants, audit and no deletes;
 * every function's grant; the read-only user reads both views; the schema check's new types and every
 * refusal; every fixture row (waves 3-4 and 5-6) with its exact codes, Storage and slots seeded per row;
 * a slot of another invite refused at store; the portal's and the link page's slots (path, the same
 * file, the 6th refused, field, type, size, closed, not live, workspace, the open logged, the limits);
 * the bank receipt's issue rules, one open per card, the named transfer, a Stopped card, the Send
 * panel's rows; the answer's three paths (the inbox, the named transfer, one near match), two near
 * matches with the likely twin named, the duplicate twin's trigger, the canary rejected, the notice
 * once, no card change, logged until checked; View the receipt's gate; Ask the client on a logged
 * transfer; the onboarding rule of card allows; Client is back (the switch, the confirmed departure
 * and the next-step sentence, dates, why, status, the prefill, the guard on the return columns, the
 * one act with its event, return, win, MRR, notice and record, the repeat, one win per departure, the
 * lifecycle view, the closed exit survey, Back since); the retire registry's seed, moves, 14 quiet
 * days, rollback and read. The CEO's address is read from the CEO gate migration; every other person,
 * client and value is invented. Nothing here reaches Storage, ClickUp, Slack, Typeform, Make,
 * WhatsApp or the live database.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  CLIENT_SCHEMAS,
  EXIT_SURVEY_SCHEMA,
} from "../../client-success-cockpit/src/dev/formsEditorFixtures";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";
import { winsPayGround } from "./lib/w56Ground";

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

/**
 * What the real 20261102a stands on besides waves 1-2 (as forms-invites-supabase.test.ts and
 * client-voice-supabase.test.ts ground it): the portal's workspaces, pgcrypto's gen_random_bytes in
 * schema extensions (11.2-m), the CSM state audit, the client asks (20261029170000, live) and the
 * read-only role the CEO refresh uses (20261102c grants its views to it).
 */
async function realAPrereqs(portal: string | null) {
  await db.exec(`
    DO $r$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
        CREATE ROLE supabase_read_only_user BYPASSRLS;
      END IF;
    END $r$;
    GRANT pg_read_all_data TO supabase_read_only_user;
    CREATE SCHEMA IF NOT EXISTS extensions;
    GRANT USAGE ON SCHEMA extensions TO service_role, authenticated;
    CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
      $$ SELECT substring(decode(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'hex') FROM 1 FOR n) $$;`);
  if (portal) await db.exec(portal);
  await db.exec(
    cut(
      migration("20260926m_cockpit_csm_state.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_audit_csm_state\(\)[\s\S]*?END \$\$;/,
      "csm state audit",
    ),
  );
  await db.exec(migration("20261029170000_client_asks.sql"));
}

// --- Waves 5-6: e, f, then g and h (the real files when their branches have landed them), then i ---

const E = "20261102e_record_make_answer_size.sql";
const F = "20261102f_form_responses_answer_size.sql";
const G = "20261102g_money_rails_w5.sql";
const H = "20261102h_wins_pay.sql";
const I = "20261102i_client_tail.sql";
const HAS_G = onBranch(G);
const HAS_H = onBranch(H);

/**
 * The objects of 20261102g this file reads, exactly as the contract names them (2.3): billing kinds
 * win and reactivate, the three notice kinds, and the door markers (all false). Made only while g is
 * not on the branch.
 */
const G_STUB = String.raw`
ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN (
  'amount','assign','chase','churn','confirm','date','exclude','extension','invoice','late','link','ltv','method','mrr','note',
  'pause','payment','plan','resume','unconfirm','unexclude','unlink','survey','nps_sent','win','reactivate'));
DO $s$
DECLARE v text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v FROM pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check';
  IF v NOT LIKE '%receipt.in%' THEN
    v := regexp_replace(v, '\]\)\)\)$', ', ''win.logged''::text, ''receipt.in''::text, ''client.reactivated''::text])))');
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
    EXECUTE 'ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check ' || v;
  END IF;
END $s$;
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"agent":false,"ltv":false,"wins":false,"receipts":false,"reactivate":false}', 'migration 20261102g stand-in')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || public.cockpit_settings.value;`;

/** The objects of 20261102h this file writes (3.2): the wins ledger and its events, made only while h is not on the branch. */
const H_STUB = `
CREATE TABLE public.cockpit_csm_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('review','video_testimonial','podcast','referral','renewal','reactivation',
    'upsell_website','upsell_smm','upsell_backend','upsell_seo_geo','upsell_second_campaign')),
  stage text NOT NULL CHECK (stage IN ('logged','quote_given','signed','paid','void')),
  won_on date NOT NULL,
  proof_url text, proposal_id uuid, quoted_usd numeric, list_usd numeric, below_list_reason text,
  recurring boolean NOT NULL DEFAULT false, monthly_usd numeric, agreement_url text,
  referral_deal_response_id text,
  departure_id bigint REFERENCES public.cockpit_churn_departures(id),
  csm_person_id bigint REFERENCES public.cockpit_people(id),
  note text,
  source text NOT NULL CHECK (source IN ('cockpit','import','reactivate','canary')),
  imported_from text,
  logged_by uuid, logged_by_email text, logged_by_role text NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  voided_by text, voided_at timestamptz, void_reason text);
CREATE UNIQUE INDEX cockpit_csm_wins_one_per_departure ON public.cockpit_csm_wins (departure_id)
  WHERE kind = 'reactivation' AND stage <> 'void';
CREATE TABLE public.cockpit_csm_win_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  win_id uuid NOT NULL REFERENCES public.cockpit_csm_wins(id),
  at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (event IN ('logged','offered','accepted','proof_added','tie_proposed','tie_confirmed','tie_declined',
    'tie_cleared','paid','invoice_linked','voided','imported')),
  by_role text NOT NULL, by_email text, detail jsonb NOT NULL DEFAULT '{}');
ALTER TABLE public.cockpit_csm_wins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_win_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_wins, public.cockpit_csm_win_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_csm_wins TO service_role;
GRANT SELECT, INSERT ON public.cockpit_csm_win_events TO service_role;`;

/** What i stands on beyond a to h: Supabase's bucket column, and g and h (the real files, else their stand-ins). */
async function groundW56() {
  await db.exec(
    "ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[]; ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();",
  );
  for (const file of [E, F]) await db.exec(withoutCron(migration(file)));
  // The real h stands on the pay plans and Offer Studio (wins-pay's ground).
  if (HAS_H) await winsPayGround(db);
  if (HAS_G) await db.exec(withoutCron(migration(G)));
  else await db.exec(G_STUB);
  if (HAS_H) await db.exec(withoutCron(migration(H)));
  else await db.exec(H_STUB);
  // The churn read's CSM gate and scope, cut from their files as client-lifecycle-supabase.test.ts does;
  // its roster read is a stand-in with no roster (this file reads the departures only).
  if (
    !(await one<boolean>(
      "SELECT to_regprocedure('public.cockpit_csm_actor()') IS NOT NULL AS r",
    ))
  )
    await db.exec(
      cut(
        migration("20260926m_cockpit_csm_state.sql"),
        /CREATE OR REPLACE FUNCTION public\.cockpit_csm_actor\(\)[\s\S]*?END \$\$;/,
        "csm actor",
      ) +
        "\n" +
        cut(
          migration("20260927v_csm_read_models.sql"),
          /CREATE OR REPLACE FUNCTION public\.cockpit_csm_scope_all\(\)[\s\S]*?\n\$\$;/,
          "scope all",
        ) +
        `\nCREATE OR REPLACE FUNCTION public.cockpit_csm_source_read() RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS
        $$ SELECT '{"tables":{"clients":[],"rosterDays":[],"churnEvents":[]}}'::jsonb $$;` +
        "\nREVOKE ALL ON FUNCTION public.cockpit_csm_actor(), public.cockpit_csm_scope_all(), public.cockpit_csm_source_read() FROM PUBLIC, anon, authenticated, service_role;" +
        "\nGRANT EXECUTE ON FUNCTION public.cockpit_csm_actor(), public.cockpit_csm_scope_all(), public.cockpit_csm_source_read() TO authenticated;",
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
  if (REAL.length > 0) await realAPrereqs(PORTAL);
  else await db.exec(PORTAL);
  for (const file of REAL) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await standIns();
  await db.exec(migration(D));
  await groundW56();
  try {
    await db.exec(migration(I));
  } catch (e) {
    throw new Error(`${I}: ${(e as Error).message}`);
  }
}, 600_000);
afterAll(async () => {
  await db?.close();
});

// --- Helpers for this file -------------------------------------------------------------------

const json = (v: unknown) => JSON.stringify(v);
const rid = () => crypto.randomUUID();
const ACL_AUTH = "{postgres=X/postgres,authenticated=X/postgres}";
const ACL_SERVICE = "{postgres=X/postgres,service_role=X/postgres}";
const ACL_OWNER = "{postgres=X/postgres}";
const LOC_A = "locAlpha01";
const PERSON = "owner@acme.invalid";
const NET = "a".repeat(64);
const BROWSER = "c".repeat(64);
const SHA_A = "1".repeat(64);
const CTX = {
  part: "later",
  partNo: 2,
  expectedAmount: 250,
  currency: "KWD",
  dueOn: null,
};

type FixRow = {
  name: string;
  schema: string;
  answers: Row;
  context: Row;
  ok: boolean;
  errors: Row;
  stored?: Row;
  files?: {
    path: string;
    mime: string;
    bytes: number;
    sha256: string;
    slot: boolean;
    object: Row | null;
  }[];
  sqlOnly?: boolean;
};
const FIXTURE = JSON.parse(
  readFileSync(
    new URL("./fixtures/client-form-answers.json", import.meta.url),
    "utf8",
  ),
) as {
  schemas: Record<string, Row>;
  rows: FixRow[];
  wave5Schemas: Record<string, Row>;
  wave5Rows: FixRow[];
};
const FIX_INVITE = "00000000-0000-4000-8000-00000000f001";

let TODAY = "";
/** {today}, {today-N} and {today+N} as Kuwait days (the fixture's rule). */
function dated<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v).replace(
      /\{today([+-]\d+)?\}/g,
      (_m, d: string | undefined) => {
        const t = new Date(`${TODAY}T00:00:00Z`);
        t.setUTCDate(t.getUTCDate() + Number(d ?? 0));
        return t.toISOString().slice(0, 10);
      },
    ),
  ) as T;
}
const day = (offset: number) =>
  dated(`{today${offset >= 0 ? "+" : ""}${offset}}`);

/** A file row's ground: its invite, its slots and its storage objects (inside the caller's rolled-back transaction). */
async function seedFiles(row: FixRow) {
  if (!row.files) return;
  const ctx = { ...row.context };
  delete (ctx as Row).signer;
  await q(
    `INSERT INTO public.cockpit_form_invites(id, task_id, client_name, form_key, form_version, purpose, context, channels,
       audience, origin, issued_by_role, expires_at)
     VALUES ($1, 'taskFX1', 'Fixture Co', 'bank_receipt', 1, 'bank_receipt', $2::jsonb, '{portal}', 'admin', 'billing',
       'the CSM', now() + interval '14 days')`,
    [FIX_INVITE, json(ctx)],
  );
  for (const f of row.files) {
    if (f.slot)
      await q(
        `INSERT INTO public.cockpit_form_file_slots(invite_id, field_key, path, mime, bytes, sha256, made_via)
         VALUES ($1, 'receipt', $2, $3, $4, $5, 'portal')`,
        [FIX_INVITE, f.path, f.mime, f.bytes, f.sha256],
      );
    if (f.object)
      await q(
        "INSERT INTO storage.objects(bucket_id, name, metadata) VALUES ('cockpit-form-files', $1, $2::jsonb)",
        [f.path, json(f.object)],
      );
  }
}

const check = (schema: Row, answers: Row, context: Row) =>
  one<Row>(
    "SELECT public.cockpit_form_answers_check($1::jsonb, $2::jsonb, $3::jsonb) AS r",
    [json(schema), json(answers), json(context)],
  );
const schemaCheck = (s: Row) =>
  one<string | null>(
    "SELECT public.cockpit_form_schema_check($1::jsonb) AS r",
    [json(s)],
  );
const receiptSchema = () => FIXTURE.wave5Schemas.bank_receipt as any;
const withField = (f: Row) => {
  const s = structuredClone(receiptSchema());
  s.fields = [...s.fields, f];
  return s;
};
const label = { en: "A question", ar: "سؤال" };

const issue = (
  who: string,
  task: string,
  ctx: Row,
  origin = "billing",
  request = rid(),
  channels = ["portal"],
) =>
  as<Row>(
    who,
    "SELECT public.cockpit_form_invite_issue($1, 'bank_receipt', $2::text[], NULL, 'en', false, $3::jsonb, $4::uuid, $5) AS r",
    [task, `{${channels.join(",")}}`, json(ctx), request, origin],
  );
const slot = (
  invite: string,
  sha: string,
  mime = "image/jpeg",
  bytes = 182340,
  field = "receipt",
  loc = LOC_A,
  task = A,
) =>
  as<Row>(
    "service",
    "SELECT public.portal_form_file_slot($1, $2, $3, $4::uuid, $5, $6, $7, $8) AS r",
    [loc, task, PERSON, invite, field, mime, bytes, sha],
  );
const putObject = (path: string, mime: string, size: number) =>
  q(
    "INSERT INTO storage.objects(bucket_id, name, metadata) VALUES ('cockpit-form-files', $1, $2::jsonb)",
    [path, json({ mimetype: mime, size })],
  );
const submit = (invite: string, answers: Row) =>
  as<Row>(
    "service",
    "SELECT public.portal_form_submit($1, $2, $3, 'admin', $4::uuid, $5::jsonb, $6::uuid, 'en') AS r",
    [LOC_A, A, PERSON, invite, json(answers), rid()],
  );
/** One receipt from the portal, end to end: an invite, a slot, the object in the bucket, the answer. */
async function receiptFlow(ctx: Row, answers: Row = {}) {
  const sent = await issue(CSM_A, A, ctx);
  const s = await slot(sent.inviteId, SHA_A);
  expect(s.ok).toBe(true);
  await putObject(s.path, "image/jpeg", 182340);
  const got = await submit(sent.inviteId, {
    amount: 250,
    currency: "kwd",
    paidOn: day(-1),
    reference: "FT1102",
    receipt: {
      path: s.path,
      mime: "image/jpeg",
      bytes: 182340,
      sha256: SHA_A,
      name: "receipt.jpg",
    },
    ...answers,
  });
  expect(got.ok).toBe(true);
  return {
    inviteId: sent.inviteId as string,
    responseId: got.responseId as string,
    path: s.path as string,
  };
}
async function manualPayment(over: Row = {}): Promise<string> {
  const r = {
    day: day(-2),
    amount: 248,
    currency: "KWD",
    rail: "bank_transfer",
    check_state: "logged",
    task: A,
    ...over,
  } as any;
  return one<string>(
    `INSERT INTO public.cockpit_manual_payments(day, amount, currency, amount_usd, usd_per_unit, client_name, client_key,
       clickup_task_id, rail, kind, added_by, check_state, checked_at, checked_by, checked_ref)
     VALUES ($1::date, $2, $3, round($2 * 3.26, 2), 3.26, 'Acme Interiors', public.cockpit_manual_name_key('Acme Interiors'),
       $4, $5, 'payment', 'maher: the billing agent', $6, CASE WHEN $6 = 'logged' THEN NULL ELSE now() END,
       CASE WHEN $6 = 'logged' THEN NULL ELSE 'the CEO' END, CASE WHEN $6 = 'checked' THEN 'FT-REF-1' END)
     RETURNING id AS r`,
    [r.day, r.amount, r.currency, r.task, r.rail, r.check_state],
  );
}
const reactivate = (who: string, args: Row) =>
  as<Row>(
    who,
    "SELECT public.cockpit_client_lifecycle_confirm('reactivate', $1::jsonb) AS r",
    [json(args)],
  );
const setMarker = (on: boolean) =>
  q(
    "UPDATE public.cockpit_settings SET value = value || jsonb_build_object('reactivate', $1::boolean) WHERE key = 'forms.doors'",
    [on],
  );
/** The guard's three columns of this file: function, live md5, this file's own md5. */
function guardRows(): { fn: string; live: string; after: string }[] {
  const text = migration(I);
  return [
    ...text.matchAll(
      /\('(public\.[^']+)', '([0-9a-f]{32})', '([0-9a-f]{32}|@[A-Z_]+@)'\)/g,
    ),
  ].map(m => ({
    fn: m[1],
    live: m[2],
    after: m[3],
  }));
}

beforeAll(async () => {
  TODAY = await one<string>(
    "SELECT to_char((now() AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD') AS r",
  );
});

// --- The file --------------------------------------------------------------------------------

describe("the file", () => {
  test("is dark at deploy: bank_receipt is not live, Reactivate's marker is false", async () => {
    expect(
      await one("SELECT public.cockpit_form_client_live('bank_receipt') AS r"),
    ).toBe(false);
    expect(
      await one(
        "SELECT value->>'reactivate' AS r FROM public.cockpit_settings WHERE key = 'forms.doors'",
      ),
    ).toBe("false");
    expect(
      await one(
        "SELECT provider || '/' || audience || '/' || version AS r FROM public.cockpit_forms WHERE key = 'bank_receipt'",
      ),
    ).toBe("native/client/1");
    expect(
      await one(
        "SELECT provider || '/' || audience || '/' || schema::text AS r FROM public.cockpit_forms WHERE key = 'reactivate'",
      ),
    ).toBe('native/team/{"lives": "cockpit"}');
  });

  test("applies a second time and changes nothing, and keeps a marker that was switched on", async () => {
    await rolledBack(async () => {
      await setMarker(true);
      const snap = async () =>
        q(`SELECT (SELECT md5(string_agg(key || version || md5(schema::text), ',' ORDER BY key)) FROM public.cockpit_forms) AS f,
                  (SELECT count(*)::int FROM public.cockpit_form_versions) AS v,
                  (SELECT md5(string_agg(id || state || coalesce(quiet_since::text, ''), ',' ORDER BY id)) FROM public.cockpit_retire_items) AS r,
                  (SELECT count(*)::int FROM public.cockpit_retire_items) AS n`);
      const before = await snap();
      await db.exec(
        migration(I)
          .replace(/^BEGIN;$/m, "")
          .replace(/^COMMIT;$/m, ""),
      );
      expect(await snap()).toEqual(before);
      expect(
        await one(
          "SELECT value->>'reactivate' AS r FROM public.cockpit_settings WHERE key = 'forms.doors'",
        ),
      ).toBe("true");
    });
  });

  test("the drift guard holds this file's own md5 for every replaced body, and refuses a changed one", async () => {
    const rows = guardRows();
    expect(rows).toHaveLength(13);
    for (const r of rows) {
      const now = await one<string>(
        "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
        [r.fn],
      );
      expect([r.fn, now]).toEqual([r.fn, r.after]);
      expect(r.live).not.toBe(r.after);
    }
    const view = migration(I).match(
      /'43a401c28835ecd33b5c5c545eaa86cd', '([0-9a-f]{32})'/,
    )?.[1];
    expect(
      await one(
        "SELECT md5(regexp_replace(pg_get_viewdef('public.cockpit_client_lifecycle_v'::regclass), '\\s+', ' ', 'g')) AS r",
      ),
    ).toBe(view);
    await asOwner();
    await db.exec("BEGIN");
    try {
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.cockpit_form_card_allows(p_task_id text, p_form_key text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$",
      );
      const r = await refusal(() =>
        db.exec(
          migration(I)
            .replace(/^BEGIN;$/m, "")
            .replace(/^COMMIT;$/m, ""),
        ),
      );
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_form_card_allows(text,text) changed since the waves 5-6 contract read it; stop and re-read it.",
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  test("the answer check is STABLE now (it reads Storage); the schema check stays IMMUTABLE", async () => {
    expect(
      await one(
        "SELECT provolatile AS r FROM pg_proc WHERE oid = 'public.cockpit_form_answers_check(jsonb,jsonb,jsonb)'::regprocedure",
      ),
    ).toBe("s");
    expect(
      await one(
        "SELECT provolatile AS r FROM pg_proc WHERE oid = 'public.cockpit_form_schema_check(jsonb)'::regprocedure",
      ),
    ).toBe("i");
  });

  test("the bucket is private, 10 MB, photos and PDFs, with no policy for anon or authenticated", async () => {
    expect(
      await q(
        "SELECT id, public, file_size_limit::int AS l, allowed_mime_types AS m FROM storage.buckets WHERE id = 'cockpit-form-files'",
      ),
    ).toEqual([
      {
        id: "cockpit-form-files",
        public: false,
        l: 10485760,
        m: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "application/pdf",
        ],
      },
    ]);
    expect(
      await one(
        "SELECT count(*)::int AS r FROM pg_policies WHERE schemaname = 'storage' AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%cockpit-form-files%'",
      ),
    ).toBe(0);
  });

  test("every new table has row security, no browser grant, and refuses delete and truncate", async () => {
    for (const t of [
      "cockpit_form_file_slots",
      "cockpit_payment_receipts",
      "cockpit_retire_items",
    ]) {
      expect([
        t,
        await one(
          "SELECT relrowsecurity AS r FROM pg_class WHERE oid = $1::regclass",
          [`public.${t}`],
        ),
      ]).toEqual([t, true]);
      for (const role of ["anon", "authenticated"])
        expect([
          t,
          role,
          await one("SELECT has_table_privilege($1, $2, 'SELECT') AS r", [
            role,
            `public.${t}`,
          ]),
        ]).toEqual([t, role, false]);
      expect([
        t,
        await one(
          "SELECT count(*)::int AS r FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname IN ('cockpit_forms_no_delete','cockpit_forms_no_truncate','cockpit_client_tail_audit')",
          [`public.${t}`],
        ),
      ]).toEqual([t, 3]);
      expect((await refusal(() => ex(`TRUNCATE public.${t}`))).message).toBe(
        "Forms records are never deleted",
      );
    }
    expect(
      (
        await refusal(() =>
          q(
            "DELETE FROM public.cockpit_retire_items WHERE id = 'make:8063994'",
          ),
        )
      ).message,
    ).toBe("Forms records are never deleted");
    expect(
      await one(
        "SELECT has_table_privilege('service_role', 'public.cockpit_payment_receipts', 'UPDATE') AS r",
      ),
    ).toBe(false);
    expect(
      await one(
        "SELECT has_table_privilege('service_role', 'public.cockpit_retire_items', 'UPDATE') AS r",
      ),
    ).toBe(true);
  });

  test("each function carries exactly its grant", async () => {
    const acl = (fn: string) =>
      one<string>(
        "SELECT coalesce(proacl::text, 'none') AS r FROM pg_proc WHERE oid = to_regprocedure($1)",
        [fn],
      );
    for (const fn of [
      "public.cockpit_form_invite_view(text)",
      "public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text)",
      "public.cockpit_manual_payments_to_check()",
      "public.cockpit_client_lifecycle_confirm(text,jsonb)",
      "public.cockpit_csm_churn_read()",
      "public.cockpit_form_prefill(text,text)",
      "public.cockpit_form_file_read(uuid,text)",
      "public.cockpit_retire_items_read()",
    ])
      expect([fn, await acl(fn)]).toEqual([fn, ACL_AUTH]);
    for (const fn of [
      "public.portal_form_get(text,text,text,text,uuid)",
      "public.portal_form_file_slot(text,text,text,uuid,text,text,bigint,text)",
      "public.portal_form_token_file_slot(text,text,text,text,text,bigint,text)",
    ])
      expect([fn, await acl(fn)]).toEqual([fn, ACL_SERVICE]);
    for (const fn of [
      "public.cockpit_form_schema_check(jsonb)",
      "public.cockpit_form_answers_check(jsonb,jsonb,jsonb)",
      "public.cockpit_form_card_allows(text,text)",
      "public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb)",
      "public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text)",
      "public.cockpit_form_invite_canary(text,jsonb,text[])",
      "public.cockpit_form_hook_bank_receipt(uuid)",
      "public.cockpit_form_issue_hook_bank_receipt(uuid)",
      "public.cockpit_client_reactivate(jsonb)",
      "public.cockpit_retire_item_set(text,jsonb,text)",
    ])
      expect([fn, await acl(fn)]).toEqual([fn, ACL_OWNER]);
  });

  test("the guardian's and the CEO refresh's views are readable by the read-only user", async () => {
    await asOwner();
    await db.exec("SET ROLE supabase_read_only_user");
    try {
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM public.cockpit_retire_items_v",
          )
        ).rows[0],
      ).toBeTruthy();
      expect(
        (
          await db.query(
            "SELECT departure_state FROM public.cockpit_client_lifecycle_v LIMIT 1",
          )
        ).rows,
      ).toBeTruthy();
    } finally {
      await asOwner();
    }
  });
});

// --- Client form schema v1, wave 5 -----------------------------------------------------------

describe("the schema check (3.6)", () => {
  test("takes file, date, number and heading questions and the text formats; the fixture schemas pass", async () => {
    for (const [k, s] of Object.entries({
      ...FIXTURE.schemas,
      ...FIXTURE.wave5Schemas,
    }))
      expect([k, await schemaCheck(s)]).toEqual([k, null]);
  });

  test("the fixture's bank receipt is the registry's version 1, word for word", async () => {
    expect(
      await one(
        "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'bank_receipt' AND version = 1",
      ),
    ).toEqual(receiptSchema());
    expect(
      await one(
        "SELECT public.cockpit_form_schema_text_problem(schema) AS r FROM public.cockpit_forms WHERE key = 'bank_receipt'",
      ),
    ).toBeNull();
  });

  test("refuses what the bucket or the type cannot hold", async () => {
    const cases: [Row, string][] = [
      [
        {
          key: "x1",
          type: "file",
          required: true,
          label,
          accept: ["image/gif"],
          maxBytes: 1000,
        },
        "Question x1 takes photos (JPG, PNG, WEBP, HEIC) or PDFs only, each named once.",
      ],
      [
        {
          key: "x1",
          type: "file",
          required: true,
          label,
          accept: ["image/png"],
          maxBytes: 10485761,
        },
        "Question x1 takes files of 10 MB at most.",
      ],
      [
        { key: "x1", type: "file", required: true, label, maxBytes: 1000 },
        "Question x1 takes photos (JPG, PNG, WEBP, HEIC) or PDFs only, each named once.",
      ],
      [
        { key: "x1", type: "number", required: true, label, min: 5, max: 5 },
        "Question x1 needs a lowest and a highest number, the lowest below the highest.",
      ],
      [
        {
          key: "x1",
          type: "number",
          required: true,
          label,
          min: 0,
          max: 5,
          decimals: 4,
        },
        "Question x1 allows 0 to 3 decimals.",
      ],
      [
        {
          key: "x1",
          type: "date",
          required: true,
          label,
          notAfter: "tomorrow",
        },
        "Question x1 can only stop at today.",
      ],
      [
        { key: "x1", type: "date", required: true, label, notBeforeDays: 0 },
        "Question x1 goes back 1 to 3,650 days.",
      ],
      [
        { key: "x1", type: "text", required: true, label, format: "html" },
        "Question x1 has a format that is not plain, url, email or phone.",
      ],
      [
        { key: "x1", type: "longtext", required: true, label, format: "url" },
        "Question x1 has a text format but is not a short text.",
      ],
      [
        { key: "x1", type: "heading", required: true, label },
        "Heading x1 is shown, never answered, so it cannot be required.",
      ],
      [
        {
          key: "x1",
          type: "choice",
          required: true,
          label,
          accept: ["image/png"],
          options: [],
        },
        "Question x1 has file settings but is not a file.",
      ],
      [
        {
          key: "x1",
          type: "scale",
          required: true,
          label,
          min: 0,
          max: 5,
          decimals: 1,
          lowLabel: label,
          highLabel: label,
        },
        "Question x1 has decimals but is not a number.",
      ],
      [
        { key: "x1", type: "text", required: true, label, notAfter: "today" },
        "Question x1 has date limits but is not a date.",
      ],
    ];
    for (const [f, sentence] of cases)
      expect([f.key, f.type, await schemaCheck(withField(f))]).toEqual([
        f.key,
        f.type,
        sentence,
      ]);
  });

  test("a show-if or a read can never name a heading", async () => {
    const s = structuredClone(FIXTURE.wave5Schemas.kitchen5) as any;
    s.fields.push({
      key: "later",
      type: "tick",
      required: false,
      label,
      showIf: { key: "aboutYou", equals: true },
    });
    expect(await schemaCheck(s)).toBe(
      "Question later can only follow an earlier question, and aboutYou is not before it.",
    );
    const r = structuredClone(FIXTURE.wave5Schemas.kitchen5) as any;
    r.reads = { hook: ["aboutYou"] };
    expect(await schemaCheck(r)).toBe(
      "The reads list of hook names a question the form does not have.",
    );
  });
});

describe("the answer check (3.6)", () => {
  test("gives every waves 5-6 fixture row its codes, exactly (Storage and slots seeded per row)", async () => {
    expect(FIXTURE.wave5Rows.length).toBeGreaterThanOrEqual(25);
    for (const raw of FIXTURE.wave5Rows) {
      const row = dated(raw);
      await rolledBack(async () => {
        await seedFiles(row);
        const got = await check(
          FIXTURE.wave5Schemas[row.schema],
          row.answers,
          row.context,
        );
        expect([row.name, got.ok, got.errors]).toEqual([
          row.name,
          row.ok,
          row.errors,
        ]);
        if (row.stored)
          expect([row.name, got.answers]).toEqual([row.name, row.stored]);
      });
    }
  });

  test("every new code and type has a row", async () => {
    const codes = new Set(
      FIXTURE.wave5Rows.flatMap(r => Object.values(r.errors) as string[]),
    );
    for (const c of [
      "file_missing",
      "file_type",
      "file_size",
      "format",
      "range",
      "unknown",
      "required",
      "length",
      "option",
    ])
      expect([c, codes.has(c)]).toEqual([c, true]);
  });

  test("the waves 3-4 rows keep their codes", async () => {
    for (const row of FIXTURE.rows) {
      const got = await check(
        FIXTURE.schemas[row.schema],
        row.answers,
        row.context,
      );
      expect([row.name, got.ok, got.errors]).toEqual([
        row.name,
        row.ok,
        row.errors,
      ]);
      if (row.stored)
        expect([row.name, got.answers]).toEqual([row.name, row.stored]);
    }
  });

  test("a slot of another invite with the same facts is refused when the answer is stored", async () => {
    await rolledBack(async () => {
      await q(
        "SELECT public.cockpit_form_client_go_live('bank_receipt', true, 'the test')",
      );
      const one1 = await issue(CSM_A, A, CTX);
      const s = await slot(one1.inviteId, SHA_A);
      await putObject(s.path, "image/jpeg", 182340);
      // A second, identical invite on a card the fixture invents, holding the same facts.
      await q(
        `INSERT INTO public.cockpit_form_invites(id, task_id, client_name, location_id, form_key, form_version, purpose, context, channels,
           audience, origin, issued_by_role, expires_at)
         SELECT gen_random_uuid(), 'taskFX2', 'Other Co', 'locFX2', 'bank_receipt', 1, 'bank_receipt', context, '{portal}', 'admin', 'billing',
           'the CSM', now() + interval '14 days' FROM public.cockpit_form_invites WHERE id = $1`,
        [one1.inviteId],
      );
      const other = await one<string>(
        "SELECT id::text AS r FROM public.cockpit_form_invites WHERE task_id = 'taskFX2'",
      );
      const r = await refusal(() =>
        q(
          "SELECT public.cockpit_form_store_answer(i, 'portal', 'portal:x', 'owner@acme.invalid', 'admin', NULL, $2::jsonb, NULL, 'en') FROM public.cockpit_form_invites i WHERE i.id = $1",
          [
            other,
            json({
              amount: 250,
              currency: "kwd",
              paidOn: day(-1),
              receipt: {
                path: s.path,
                mime: "image/jpeg",
                bytes: 182340,
                sha256: SHA_A,
              },
            }),
          ],
        ),
      );
      expect(r.message).toBe("form_file_not_this_invite");
    });
  });
});

// --- File slots ------------------------------------------------------------------------------

describe("file slots (3.6)", () => {
  test("the portal's slot: the exact path, the same file again, the 6th slot refused, wrong field, type and size", async () => {
    await rolledBack(async () => {
      await q(
        "SELECT public.cockpit_form_client_go_live('bank_receipt', true, 'the test')",
      );
      const sent = await issue(CSM_A, A, CTX);
      const first = await slot(sent.inviteId, SHA_A);
      expect(first).toEqual({
        ok: true,
        path: `forms/${sent.inviteId}/receipt/${SHA_A}.jpg`,
      });
      expect(await slot(sent.inviteId, SHA_A)).toEqual(first);
      for (const n of [2, 3, 4, 5])
        expect(
          (await slot(sent.inviteId, String(n).repeat(64), "application/pdf"))
            .ok,
        ).toBe(true);
      expect(await slot(sent.inviteId, "6".repeat(64))).toEqual({
        ok: false,
        reason: "slots",
        sentence:
          "You can replace the file 4 times. Ask your account manager for a new link.",
      });
      expect(
        await slot(sent.inviteId, "7".repeat(64), "image/jpeg", 10, "amount"),
      ).toEqual({ ok: false, reason: "not_file" });
      expect(await slot(sent.inviteId, "7".repeat(64), "image/gif")).toEqual({
        ok: false,
        reason: "type",
      });
      expect(
        await slot(sent.inviteId, "7".repeat(64), "image/png", 10485761),
      ).toEqual({ ok: false, reason: "size" });
      expect(
        await as(
          "service",
          "SELECT public.portal_form_get($1, $2, $3, 'admin', $4::uuid) AS r",
          [LOC_A, A, PERSON, sent.inviteId],
        ).then((r: any) => r.invite.fileSlots),
      ).toEqual({ receipt: { made: 5, left: 0 } });
      expect(
        (
          await refusal(() =>
            slot(
              sent.inviteId,
              "8".repeat(64),
              "image/png",
              10,
              "receipt",
              "locZeta01",
              "taskZ1",
            ),
          )
        ).code,
      ).toBe("42501");
    });
  });

  test("a closed or switched-off invite gives no slot", async () => {
    await rolledBack(async () => {
      await q(
        "SELECT public.cockpit_form_client_go_live('bank_receipt', true, 'the test')",
      );
      const sent = await issue(CSM_A, A, CTX);
      await q(
        "UPDATE public.cockpit_settings SET value = jsonb_set(value, '{live}', '[]') WHERE key = 'forms.client'",
      );
      expect(await slot(sent.inviteId, SHA_A)).toEqual({
        ok: false,
        reason: "not_live",
      });
      await q(
        "SELECT public.cockpit_form_client_go_live('bank_receipt', true, 'the test')",
      );
      await as(
        CSM_A,
        "SELECT public.cockpit_form_invite_withdraw($1, $2::uuid, 'Sent by mistake') AS r",
        [A, sent.inviteId],
      );
      expect(await slot(sent.inviteId, SHA_A)).toEqual({
        ok: false,
        reason: "withdrawn",
      });
    });
  });

  test("the link page's slot logs the open and obeys the rate limits", async () => {
    await rolledBack(async () => {
      const c = await one<Row>(
        "SELECT public.cockpit_form_invite_canary('bank_receipt', '{}'::jsonb) AS r",
      );
      const token = String(c.url).split("#")[1];
      const sha = await one<string>(
        "SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS r",
        [token],
      );
      const before = await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_form_token_opens WHERE outcome = 'ok'",
      );
      const got = await as<Row>(
        "service",
        "SELECT public.portal_form_token_file_slot($1, $2, $3, 'receipt', 'image/png', 900, $4) AS r",
        [sha, NET, BROWSER, SHA_A],
      );
      expect(got).toEqual({
        ok: true,
        path: `forms/${c.inviteId}/receipt/${SHA_A}.png`,
      });
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_form_token_opens WHERE outcome = 'ok'",
        ),
      ).toBe(before + 1);
      expect(
        await one(
          "SELECT made_via AS r FROM public.cockpit_form_file_slots WHERE path = $1",
          [got.path],
        ),
      ).toBe("canary");
      await q(
        "INSERT INTO public.cockpit_form_token_opens(net_hash, browser_hash, outcome) SELECT $1, $2, 'ok' FROM generate_series(1, 30)",
        [NET, BROWSER],
      );
      expect(
        await as(
          "service",
          "SELECT public.portal_form_token_file_slot($1, $2, $3, 'receipt', 'image/png', 900, $4) AS r",
          [sha, NET, BROWSER, "9".repeat(64)],
        ),
      ).toEqual({ ok: false, reason: "limited" });
      expect(
        await as(
          "service",
          "SELECT public.portal_form_token_file_slot($1, $2, $3, 'receipt', 'image/png', 900, $4) AS r",
          ["e".repeat(64), "f".repeat(64), null, "9".repeat(64)],
        ),
      ).toEqual({ ok: false, reason: "unknown" });
    });
  });
});

// --- The bank receipt ------------------------------------------------------------------------

describe("the bank receipt invite (3.6, 4.10)", () => {
  beforeAll(async () => {
    await q(
      "SELECT public.cockpit_form_client_go_live('bank_receipt', true, 'the test')",
    );
  });

  test("goes only from Pending payments or Checks waiting, with its facts", async () => {
    await rolledBack(async () => {
      expect((await refusal(() => issue(CSM_A, A, CTX, "csm"))).message).toBe(
        "Ask for the receipt from Pending payments or Checks waiting.",
      );
      expect(
        (await refusal(() => issue(CSM_A, A, { ...CTX, expectedAmount: 0 })))
          .message,
      ).toBe("Send the amount due, above 0.");
      expect(
        (await refusal(() => issue(CSM_A, A, { ...CTX, currency: "EUR" })))
          .message,
      ).toBe("The currency is USD or KWD.");
      expect(
        (await refusal(() => issue(CSM_A, A, { ...CTX, part: "rent" })))
          .message,
      ).toBe("Say which payment the receipt is for.");
      expect(
        (await refusal(() => issue(CSM_A, A, { ...CTX, foo: 1 }))).message,
      ).toBe("The receipt request does not take foo.");
      expect((await refusal(() => issue(CSM_B, A, CTX))).code).toBe("42501");
      await q(
        "UPDATE public.cockpit_settings SET value = jsonb_set(value, '{live}', '[\"bank_receipt\",\"nps\"]') WHERE key = 'forms.client'",
      );
      const nps = await refusal(() =>
        as(
          CSM_A,
          "SELECT public.cockpit_form_invite_issue($1, 'nps', '{portal}', NULL, 'en', false, '{}'::jsonb, $2::uuid, 'billing') AS r",
          [A, rid()],
        ),
      );
      expect(nps.message).toBe(
        "Pending payments and Checks waiting send the receipt request only.",
      );
    });
  });

  test("one open request per card", async () => {
    await rolledBack(async () => {
      await issue(CSM_A, A, CTX);
      const r = await refusal(() => issue(CSM_A, A, CTX));
      expect(r.message).toMatch(
        /^A receipt request is already out to Acme Interiors, sent \d{1,2} [A-Z][a-z]{2} \d{4}\. Withdraw it to send a new one\.$/,
      );
    });
  });

  test("a named transfer must be this client's logged bank transfer without a receipt", async () => {
    await rolledBack(async () => {
      const checked = await manualPayment({ check_state: "checked" });
      const cash = await manualPayment({ rail: "cash" });
      const other = await manualPayment({ task: B });
      for (const id of [checked, cash, other, "nope"])
        expect(
          (
            await refusal(() =>
              issue(CSM_A, A, { ...CTX, manualPaymentId: id }),
            )
          ).message,
        ).toBe("That transfer is not a logged bank transfer of this client.");
      const ok = await manualPayment();
      const flow = await receiptFlow({ ...CTX, manualPaymentId: ok });
      void flow;
      expect(
        (await refusal(() => issue(CSM_A, A, { ...CTX, manualPaymentId: ok })))
          .message,
      ).toBe("This transfer already has its receipt.");
    });
  });

  test("a Stopped card gets no request", async () => {
    await rolledBack(async () => {
      await q(
        "UPDATE public.cockpit_billing_accounts SET client_status = 'Stopped' WHERE clickup_task_id = $1",
        [A],
      );
      expect((await refusal(() => issue(CSM_A, A, CTX))).message).toBe(
        "Acme Interiors has stopped, so no receipt request goes to them.",
      );
    });
  });

  test("the Send panel lists the bank receipt as preset only, and the onboarding form as not live", async () => {
    const v = await as<Row>(
      CSM_A,
      "SELECT public.cockpit_form_invite_view($1) AS r",
      [A],
    );
    const br = v.forms.find((f: Row) => f.key === "bank_receipt");
    expect(br).toMatchObject({
      live: true,
      sendable: true,
      why: null,
      presetOnly: true,
      audience: "admin",
      presetWhy: "Ask for the receipt from Pending payments or Checks waiting.",
    });
    expect(v.forms.find((f: Row) => f.key === "onboarding")).toMatchObject({
      live: false,
      sendable: false,
      why: "Opens to clients after its switch-on.",
    });
    expect(v.templates.bank_receipt.en).toBe(
      "Hi {client} team, could you send us the receipt of your bank transfer here: {form_link}",
    );
    expect(v.forms.map((f: Row) => f.key)).toEqual([
      "nps",
      "csat",
      "exit_survey",
      "pause_consent",
      "bank_receipt",
      "onboarding",
    ]);
  });
});

describe("the bank receipt answer (4.10.3)", () => {
  beforeAll(async () => {
    await q(
      "SELECT public.cockpit_form_client_go_live('bank_receipt', true, 'the test')",
    );
    await q(
      "UPDATE public.cockpit_manual_payment_state SET history_ready = true WHERE id",
    );
  });

  test("a transfer nobody logged: one portal inbox row, one notice, no card change; ingest takes it in as logged", async () => {
    await rolledBack(async () => {
      const card = await q(
        "SELECT * FROM public.cockpit_billing_accounts WHERE clickup_task_id = $1",
        [A],
      );
      const events = await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_billing_events",
      );
      const f = await receiptFlow(CTX);
      const inbox = await q<Row>(
        "SELECT * FROM public.cockpit_billing_inbox WHERE response_id = $1",
        [f.responseId],
      );
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        source: "portal",
        method: "bank_transfer",
        status: "pending",
        currency: "KWD",
        logged_by: "the client",
        evidence_url: `storage://cockpit-form-files/${f.path}`,
        reference: "FT1102",
        check_state: "logged",
      });
      expect(Number(inbox[0].amount)).toBe(250);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_payment_receipts",
        ),
      ).toBe(0);
      expect(
        await q(
          "SELECT kind, dedupe_key, state FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`receipt:${f.responseId}`],
        ),
      ).toEqual([
        {
          kind: "receipt.in",
          dedupe_key: `receipt:${f.responseId}`,
          state: "queued",
        },
      ]);
      expect(
        await q(
          "SELECT * FROM public.cockpit_billing_accounts WHERE clickup_task_id = $1",
          [A],
        ),
      ).toEqual(card);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_events",
        ),
      ).toBe(events);
      expect(
        await one(
          "SELECT used_by::text AS r FROM public.cockpit_form_file_slots WHERE path = $1",
          [f.path],
        ),
      ).toBe(f.responseId);
      // Re-running the hook queues nothing twice and writes no second row.
      await q("SELECT public.cockpit_form_hook_bank_receipt($1::uuid)", [
        f.responseId,
      ]);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_inbox WHERE response_id = $1",
          [f.responseId],
        ),
      ).toBe(1);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices WHERE kind = 'receipt.in'",
        ),
      ).toBe(1);
      // Ingest: logged, waiting on a check; never checked money by itself.
      const run = await q<Row>(
        "SELECT public.cockpit_billing_ingest_inbox(true, 50) AS r",
      );
      expect(run[0].r.ingested).toBe(1);
      const ledger = await one<string>(
        "SELECT ledger_id AS r FROM public.cockpit_billing_inbox WHERE response_id = $1",
        [f.responseId],
      );
      expect(
        await one(
          "SELECT check_state AS r FROM public.cockpit_manual_payments WHERE id = $1",
          [ledger],
        ),
      ).toBe("logged");
      const list = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_manual_payments_to_check() AS r",
      );
      const mine = list.find(x => x.id === ledger);
      expect(mine?.receipt).toMatchObject({
        responseId: f.responseId,
        field: "receipt",
        mime: "image/jpeg",
        bytes: 182340,
        attachedBy: "inbox",
        via: "portal",
        viewable: true,
        currency: "KWD",
      });
      expect(mine?.askable).toBe(false);
      expect(mine?.addedBy).toBe("Client portal");
    });
  });

  test("a named transfer: the receipt sits beside it, no inbox row", async () => {
    await rolledBack(async () => {
      const mp = await manualPayment();
      const f = await receiptFlow({ ...CTX, manualPaymentId: mp });
      expect(
        await q(
          "SELECT manual_payment_id, attached_by FROM public.cockpit_payment_receipts WHERE response_id = $1",
          [f.responseId],
        ),
      ).toEqual([{ manual_payment_id: mp, attached_by: "invite" }]);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_inbox WHERE response_id = $1",
          [f.responseId],
        ),
      ).toBe(0);
      const list = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_manual_payments_to_check() AS r",
      );
      expect(list.find(x => x.id === mp)?.receipt?.attachedBy).toBe("invite");
    });
  });

  test("the same transfer the agent already logged (same currency, within 1% and 3 days) gets the receipt, no inbox row", async () => {
    await rolledBack(async () => {
      const mp = await manualPayment({ amount: 248, day: day(-3) });
      const usd = await manualPayment({
        amount: 250,
        currency: "USD",
        day: day(-1),
      });
      const far = await manualPayment({ amount: 250, day: day(-6) });
      void usd;
      void far;
      const f = await receiptFlow(CTX);
      expect(
        await q(
          "SELECT manual_payment_id, attached_by FROM public.cockpit_payment_receipts WHERE response_id = $1",
          [f.responseId],
        ),
      ).toEqual([{ manual_payment_id: mp, attached_by: "near_match" }]);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_inbox WHERE response_id = $1",
          [f.responseId],
        ),
      ).toBe(0);
    });
  });

  test("two near matches: the receipt goes to the inbox, and Checks waiting names the likely twin", async () => {
    await rolledBack(async () => {
      await manualPayment({ amount: 249, day: day(-1) });
      await manualPayment({ amount: 251, day: day(-2) });
      const f = await receiptFlow(CTX);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_inbox WHERE response_id = $1",
          [f.responseId],
        ),
      ).toBe(1);
      await q("SELECT public.cockpit_billing_ingest_inbox(true, 50)");
      const ledger = await one<string>(
        "SELECT ledger_id AS r FROM public.cockpit_billing_inbox WHERE response_id = $1",
        [f.responseId],
      );
      const list = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_manual_payments_to_check() AS r",
      );
      expect(list.find(x => x.id === ledger)?.nearMatch?.sentence).toBe(
        `May be the same transfer as ${await one("SELECT public.cockpit_billing_day_words($1::date) AS r", [day(-1)])} 249 KWD`,
      );
    });
  });

  test("ingest marks the portal row duplicate of a checked twin: the trigger puts the receipt on the twin", async () => {
    await rolledBack(async () => {
      const twin = await manualPayment({
        amount: 250,
        day: day(-1),
        check_state: "checked",
      });
      const f = await receiptFlow(CTX);
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_payment_receipts",
        ),
      ).toBe(0);
      const run = await q<Row>(
        "SELECT public.cockpit_billing_ingest_inbox(true, 50) AS r",
      );
      expect(run[0].r.duplicate).toBe(1);
      expect(
        await q(
          "SELECT manual_payment_id, attached_by, path FROM public.cockpit_payment_receipts WHERE response_id = $1",
          [f.responseId],
        ),
      ).toEqual([
        { manual_payment_id: twin, attached_by: "twin", path: f.path },
      ]);
    });
  });

  test("a canary answer on the test card writes its inbox row rejected, so ingest never takes it in", async () => {
    await rolledBack(async () => {
      const c = await one<Row>(
        "SELECT public.cockpit_form_invite_canary('bank_receipt', '{}'::jsonb) AS r",
      );
      const token = String(c.url).split("#")[1];
      const sha = await one<string>(
        "SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS r",
        [token],
      );
      const s = await as<Row>(
        "service",
        "SELECT public.portal_form_token_file_slot($1, $2, $3, 'receipt', 'application/pdf', 900, $4) AS r",
        [sha, NET, BROWSER, SHA_A],
      );
      await putObject(s.path, "application/pdf", 900);
      const got = await as<Row>(
        "service",
        "SELECT public.portal_form_token_submit($1, $2, $3, $4::jsonb, 'Test Signer', $5::uuid, 'en') AS r",
        [
          sha,
          NET,
          BROWSER,
          json({
            amount: 1,
            currency: "kwd",
            paidOn: day(0),
            receipt: {
              path: s.path,
              mime: "application/pdf",
              bytes: 900,
              sha256: SHA_A,
            },
          }),
          rid(),
        ],
      );
      expect(got.ok).toBe(true);
      expect(
        await q(
          "SELECT status, status_note, check_state FROM public.cockpit_billing_inbox WHERE response_id = $1",
          [got.responseId],
        ),
      ).toEqual([
        {
          status: "rejected",
          status_note: "Canary on the test card",
          check_state: "rejected",
        },
      ]);
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`receipt:${got.responseId}`],
        ),
      ).toBe("muted");
    });
  });

  test("View the receipt: the file's place for a seat allowed on the client, never for another CSM", async () => {
    await rolledBack(async () => {
      const f = await receiptFlow(CTX);
      expect(
        await as(
          CSM_A,
          "SELECT public.cockpit_form_file_read($1::uuid, 'receipt') AS r",
          [f.responseId],
        ),
      ).toEqual({
        path: f.path,
        mime: "image/jpeg",
        bytes: 182340,
        name: "receipt.jpg",
        bucket: "cockpit-form-files",
      });
      expect(
        (
          await as<Row>(
            FINANCE,
            "SELECT public.cockpit_form_file_read($1::uuid, 'receipt') AS r",
            [f.responseId],
          )
        ).path,
      ).toBe(f.path);
      expect(
        (
          await refusal(() =>
            as(
              CSM_B,
              "SELECT public.cockpit_form_file_read($1::uuid, 'receipt') AS r",
              [f.responseId],
            ),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await refusal(() =>
            as(
              CSM_A,
              "SELECT public.cockpit_form_file_read($1::uuid, 'amount') AS r",
              [f.responseId],
            ),
          )
        ).message,
      ).toBe("That answer has no file there.");
      expect(
        (
          await refusal(() =>
            as(
              null,
              "SELECT public.cockpit_form_file_read($1::uuid, 'receipt') AS r",
              [f.responseId],
            ),
          )
        ).code,
      ).toBe("42501");
    });
  });

  test("Checks waiting offers Ask the client for the receipt on a logged transfer without one", async () => {
    await rolledBack(async () => {
      const mp = await manualPayment();
      let list = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_manual_payments_to_check() AS r",
      );
      expect(list.find(x => x.id === mp)).toMatchObject({
        receipt: null,
        askable: true,
        openReceiptInvite: null,
      });
      await issue(CSM_A, A, { ...CTX, manualPaymentId: mp });
      list = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_manual_payments_to_check() AS r",
      );
      expect(list.find(x => x.id === mp)).toMatchObject({
        askable: false,
        openReceiptInvite: { forThisPayment: true },
      });
    });
  });
});

// --- Who may receive which form --------------------------------------------------------------

describe("cockpit_form_card_allows (2.2)", () => {
  test("the onboarding form never goes to a card with a stored onboarding answer or kickoff, from any form", async () => {
    await rolledBack(async () => {
      const allows = () =>
        one<string | null>(
          "SELECT public.cockpit_form_card_allows($1, 'onboarding') AS r",
          [A],
        );
      expect(await allows()).toBeNull();
      await q(
        "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, forms) VALUES ($1, 'Acme Interiors', $2::jsonb)",
        [
          A,
          json({
            kickoff: {
              form_id: "tG7dnxBn",
              submitted_at: "2026-08-29T15:53:05Z",
            },
          }),
        ],
      );
      expect(await allows()).toBe(
        "A kickoff is already stored for Acme Interiors (29 Aug 2026), so the onboarding form is done.",
      );
      await q(
        "UPDATE public.cockpit_client_onboarding SET forms = forms || $2::jsonb WHERE clickup_task_id = $1",
        [
          A,
          json({
            onboarding: {
              form_id: "KFRCXPFx",
              submitted_at: "2026-08-29T14:18:35Z",
            },
          }),
        ],
      );
      expect(await allows()).toBe(
        "An onboarding answer is already stored for Acme Interiors (29 Aug 2026).",
      );
    });
    await rolledBack(async () => {
      await q(
        `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers,
           created_by, submitted_by, submitted_at)
         VALUES ('onboarding', 1, 'typeform_webhook', 'tf:x1', $1, 'Acme Interiors', 'live', 'submitted', '{}', 'typeform', 'typeform', '2026-09-01T10:00:00Z')`,
        [A],
      );
      expect(
        await one(
          "SELECT public.cockpit_form_card_allows($1, 'onboarding') AS r",
          [A],
        ),
      ).toBe(
        "An onboarding answer is already stored for Acme Interiors (1 Sep 2026).",
      );
    });
  });
});

// --- Reactivate ------------------------------------------------------------------------------

describe("Client is back (4.12)", () => {
  let departure = 0;
  const C = "taskC9";
  beforeAll(async () => {
    await q(
      "INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage, client_status, mrr_usd, csm) VALUES ($1, 'Cedar Fitout', 'Stopped', 'Stopped', 900, 'Huda Test')",
      [C],
    );
    await q(
      "UPDATE public.cockpit_billing_accounts SET csm = 'Huda  test' WHERE clickup_task_id = $1",
      [B],
    );
    const r = await as<Row>(
      CEO,
      "SELECT public.cockpit_client_lifecycle_confirm('churn', $1::jsonb) AS r",
      [
        json({
          taskId: B,
          requestId: rid(),
          leftOn: day(-5),
          reason: "Cancelled",
          churnType: "mid_programme",
          whyDetail: "The owner moved the budget to a showroom fit-out.",
          howToStop: "Agree the second campaign before day 45.",
          mrrLostUsd: 1500,
          surveyState: "not_sent",
        }),
      ],
    );
    departure = r.departureId;
  });
  const args = (over: Row = {}) => ({
    requestId: rid(),
    taskId: B,
    departureId: departure,
    returnOn: day(0),
    status: "Active",
    mrrUsd: 1800,
    why: "They came back after the summer break with a new branch.",
    agreementUrl: "https://drive.example/agreement",
    ...over,
  });

  test("waits for its switch-on, except on the test card", async () => {
    await setMarker(false);
    expect((await refusal(() => reactivate(CSM_B, args()))).message).toBe(
      "Reactivate opens after its switch-on.",
    );
    await setMarker(true);
  });

  test("needs a confirmed departure: a Stopped card without one is told the next step", async () => {
    expect(
      (
        await refusal(() =>
          reactivate(CEO, args({ taskId: C, departureId: null })),
        )
      ).message,
    ).toBe(
      "Cedar Fitout has no confirmed churn. Confirm the churn first with Client is leaving, then reopen.",
    );
    expect(
      (
        await refusal(() =>
          reactivate(CEO, args({ taskId: A, departureId: null })),
        )
      ).message,
    ).toBe("Acme Interiors is not marked as left. Nothing to reactivate.");
    expect((await refusal(() => reactivate(CSM_A, args()))).code).toBe("42501");
    expect((await refusal(() => reactivate(null, args()))).code).toBe("42501");
  });

  test("refuses a return before the day they left, far ahead, a short why and a wrong status", async () => {
    const dates =
      "The return date is on or after the day they left, and within 14 days from now.";
    expect(
      (await refusal(() => reactivate(CSM_B, args({ returnOn: day(-6) }))))
        .message,
    ).toBe(dates);
    expect(
      (await refusal(() => reactivate(CSM_B, args({ returnOn: day(15) }))))
        .message,
    ).toBe(dates);
    expect(
      (await refusal(() => reactivate(CSM_B, args({ why: "back" })))).message,
    ).toBe("Say why they came back in 10 to 500 characters.");
    expect(
      (await refusal(() => reactivate(CSM_B, args({ status: "Paused" }))))
        .message,
    ).toBe("Pick Active, or Onboarding again.");
    expect(
      (
        await refusal(() =>
          reactivate(CSM_B, args({ agreementUrl: "http://x" })),
        )
      ).message,
    ).toBe("The agreement link starts with https://.");
  });

  test("the prefill shows the departure it reopens, and the refusal for a card without one", async () => {
    const p = await as<Row>(
      CSM_B,
      "SELECT public.cockpit_form_prefill('reactivate', $1) AS r",
      [B],
    );
    expect(p.departure).toMatchObject({
      id: departure,
      reason: "Cancelled",
      churnType: "mid_programme",
    });
    expect(p.departure.words).toMatch(
      /^Left on \d{1,2} [A-Z][a-z]{2}( \d{4})? · Cancelled · mid-programme$/,
    );
    expect(p.values.find((v: Row) => v.key === "departureId").value).toBe(
      departure,
    );
    expect(p.refusal).toBeNull();
    const c = await as<Row>(
      CEO,
      "SELECT public.cockpit_form_prefill('reactivate', $1) AS r",
      [C],
    );
    expect(c.refusal).toBe(
      "Cedar Fitout has no confirmed churn. Confirm the churn first with Client is leaving, then reopen.",
    );
  });

  test("a direct write of a departure's return is refused", async () => {
    expect(
      (
        await refusal(() =>
          q(
            "UPDATE public.cockpit_churn_departures SET returned_on = now()::date WHERE id = $1",
            [departure],
          ),
        )
      ).message,
    ).toBe("A departure's return is written only by Client is back.");
  });

  test("reopens in one act: the event, the return, one win, the MRR, the notice, the record; the month they left keeps its churn", async () => {
    const before = await q(
      "SELECT id, left_on, removed_at FROM public.cockpit_churn_departures ORDER BY id",
    );
    const a = args();
    const r = await reactivate(CSM_B, a);
    expect(r).toMatchObject({
      departureId: departure,
      sentence: "Reopened. The card updates within a few minutes.",
    });
    const ev = await one<Row>(
      "SELECT to_jsonb(e) AS r FROM public.cockpit_billing_events e WHERE id = $1",
      [r.eventId],
    );
    expect(ev).toMatchObject({
      kind: "reactivate",
      source: "csm",
      from_value: "Stopped",
      to_value: "Active",
    });
    expect(ev.detail).toMatchObject({
      return_on: day(0),
      status: "Active",
      departure_id: departure,
      left_on: day(-5),
      reason_was: "Cancelled",
      type_was: "mid-programme",
      why: a.why,
      seat_role: "csm",
      request_id: a.requestId,
      win_id: r.winId,
      response_id: r.responseId,
    });
    expect(
      await one<Row>(
        "SELECT to_jsonb(d) - 'updated_at' - 'created_at' AS r FROM public.cockpit_churn_departures d WHERE id = $1",
        [departure],
      ),
    ).toMatchObject({
      returned_on: day(0),
      return_event_id: r.eventId,
      returned_by: "csm.b@tests.invalid",
      left_on: day(-5),
      removed_at: null,
    });
    expect(
      await q(
        "SELECT id, left_on, removed_at FROM public.cockpit_churn_departures ORDER BY id",
      ),
    ).toEqual(before);
    const win = await one<Row>(
      "SELECT to_jsonb(w) AS r FROM public.cockpit_csm_wins w WHERE id = $1",
      [r.winId],
    );
    expect(win).toMatchObject({
      kind: "reactivation",
      stage: "logged",
      source: "reactivate",
      departure_id: departure,
      task_id: B,
      agreement_url: a.agreementUrl,
      won_on: day(0),
    });
    expect(win.csm_person_id).toBe(
      await one(
        "SELECT id AS r FROM public.cockpit_people WHERE name = 'Huda Test'",
      ),
    );
    expect(
      await q(
        "SELECT event FROM public.cockpit_csm_win_events WHERE win_id = $1",
        [r.winId],
      ),
    ).toEqual([{ event: "logged" }]);
    const mrr = await one<Row>(
      "SELECT to_jsonb(e) AS r FROM public.cockpit_billing_events e WHERE id = $1",
      [r.mrrEventId],
    );
    expect(mrr).toMatchObject({
      kind: "mrr",
      from_value: "1500",
      to_value: "1800",
    });
    expect(mrr.detail).toMatchObject({
      reason_cat: "reactivation",
      effective: day(0),
      win_id: r.winId,
      seat_role: "csm",
      reason: `Reactivated: ${a.why}`,
    });
    expect(
      await q(
        "SELECT kind, state FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
        [`reactivate:${r.eventId}`],
      ),
    ).toEqual([{ kind: "client.reactivated", state: "queued" }]);
    expect(
      await one<Row>(
        "SELECT to_jsonb(x) AS r FROM public.cockpit_form_responses x WHERE id = $1",
        [r.responseId],
      ),
    ).toMatchObject({
      form_key: "reactivate",
      state: "confirmed",
      source: "cockpit",
      mode: "live",
    });
    expect(
      await one<Row>(
        "SELECT jsonb_build_object('s', client_status, 'g', stage_group, 'm', mrr_usd, 'c', churn_date) AS r FROM public.cockpit_billing_accounts WHERE clickup_task_id = $1",
        [B],
      ),
    ).toEqual({ s: "Active", g: "active", m: 1800, c: null });

    // A repeat of the press returns the first result and writes nothing.
    const events = await one<number>(
      "SELECT count(*)::int AS r FROM public.cockpit_billing_events",
    );
    const again = await reactivate(CSM_B, { ...a });
    expect(again).toMatchObject({ eventId: r.eventId, repeat: true });
    expect(
      await one<number>(
        "SELECT count(*)::int AS r FROM public.cockpit_billing_events",
      ),
    ).toBe(events);

    // Once back, there is nothing left to reopen; and the index keeps one win per departure.
    expect((await refusal(() => reactivate(CSM_B, args()))).message).toBe(
      "Beta Build is not marked as left. Nothing to reactivate.",
    );
    const dup = await refusal(() =>
      q(
        `INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on, departure_id, source, logged_by_role)
         VALUES (gen_random_uuid(), $1, 'Beta Build', 'reactivation', 'logged', now()::date, $2, 'cockpit', 'the CSM')`,
        [B, departure],
      ),
    );
    expect(dup.code).toBe("23505");
  });

  test("after the return: the lifecycle view says returned, the exit survey is closed, the churn tracker says Back since", async () => {
    expect(
      await one(
        "SELECT departure_state AS r FROM public.cockpit_client_lifecycle_v WHERE clickup_task_id = $1",
        [B],
      ),
    ).toBe("returned");
    expect(
      await one(
        "SELECT returned_on::text AS r FROM public.cockpit_client_lifecycle_v WHERE clickup_task_id = $1",
        [B],
      ),
    ).toBe(day(0));
    expect(
      await one(
        "SELECT public.cockpit_form_card_allows($1, 'exit_survey') AS r",
        [B],
      ),
    ).toBe("Mark Client is leaving first, then send the exit survey.");
    const read = await as<Row>(
      CEO,
      "SELECT public.cockpit_csm_churn_read() AS r",
    );
    const dep = read.deps.find((d: Row) => d.id === departure);
    expect(dep).toMatchObject({
      returnedOn: day(0),
      returned_role: expect.any(String),
    });
    expect(dep.backWords).toBe(
      `Back since ${await one("SELECT public.cockpit_billing_day_words($1::date) AS r", [day(0)])}`,
    );
  });

  test("the MRR event is left out when the MRR does not change", async () => {
    await rolledBack(async () => {
      await q(
        "UPDATE public.cockpit_billing_accounts SET client_status = 'Stopped' WHERE clickup_task_id = $1",
        [C],
      );
      const dep = await one<number>(
        `INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, reason, source, created_by, updated_by, confirmed_by, confirmed_at)
         VALUES ('Cedar Fitout', $1, $2::date, 'Ghosted', 'cockpit', 'the test', 'the test', 'the test', now()) RETURNING id AS r`,
        [C, day(-3)],
      );
      const r = await reactivate(
        CEO,
        args({
          taskId: C,
          departureId: dep,
          mrrUsd: 900,
          status: "Onboarding Booked",
          agreementUrl: null,
        }),
      );
      expect(r.mrrEventId).toBeNull();
      expect(
        await one(
          "SELECT source AS r FROM public.cockpit_billing_events WHERE id = $1",
          [r.eventId],
        ),
      ).toBe("ceo");
      expect(
        await one(
          "SELECT stage_group AS r FROM public.cockpit_billing_accounts WHERE clickup_task_id = $1",
          [C],
        ),
      ).toBe("pipeline");
    });
  });
});

// --- The retire registry ---------------------------------------------------------------------

describe("the C9 retire registry (3.7, 11.3)", () => {
  const set = (id: string, patch: Row) =>
    one<Row>(
      "SELECT public.cockpit_retire_item_set($1, $2::jsonb, 'the systems manager') AS r",
      [id, json(patch)],
    );

  test("is seeded from 11.3: every item with its owner, replacement and state", async () => {
    const counts = await q(
      "SELECT kind, count(*)::int AS n FROM public.cockpit_retire_items GROUP BY kind ORDER BY kind",
    );
    expect(counts).toEqual([
      { kind: "make", n: 39 },
      { kind: "typeform", n: 22 },
      { kind: "webhook", n: 15 },
    ]);
    for (const id of [
      "make:9805665",
      "make:8925654",
      "make:8922994",
      "make:9169735",
      "typeform:tG7dnxBn",
      "typeform:KFRCXPFx",
      "webhook:WHTP3991048",
    ])
      expect([
        id,
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_retire_items WHERE id = $1",
          [id],
        ),
      ]).toEqual([id, 1]);
    expect(
      await one(
        "SELECT state || '/' || switch_off_step AS r FROM public.cockpit_retire_items WHERE id = 'make:8925654'",
      ),
    ).toBe("on/D-S4K");
    expect(
      await one(
        "SELECT state AS r FROM public.cockpit_retire_items WHERE id = 'make:8979157'",
      ),
    ).toBe("kept");
    expect(
      await one(
        "SELECT count(*)::int AS r FROM public.cockpit_retire_items WHERE owner_role <> 'the systems manager'",
      ),
    ).toBe(0);
    expect(
      await one(
        "SELECT bool_and(ready) AS r FROM public.cockpit_retire_items_v WHERE id IN ('make:8063994','make:9783436','make:8962418')",
      ),
    ).toBe(true);
  });

  test("moves only as 3.7 says: off needs its step, archive waits 14 quiet days, kept is final", async () => {
    await rolledBack(async () => {
      expect(
        (await refusal(() => set("make:9122691", { state: "off" }))).message,
      ).toBe("Name the deploy step that switched it off.");
      expect(
        (
          await refusal(() =>
            set("make:9122691", { state: "closed", step: "D-C9" }),
          )
        ).message,
      ).toBe(
        "Only a Typeform is closed; switch a scenario off and remove a webhook.",
      );
      const off = await set("make:9122691", {
        state: "off",
        step: "D-C9",
        backupPath: "/opt/data/make-backups/9122691.json",
      });
      expect(off).toMatchObject({
        state: "off",
        switch_off_step: "D-C9",
        backup_path: "/opt/data/make-backups/9122691.json",
      });
      const r = await refusal(() => set("make:9122691", { state: "archived" }));
      expect(r.message).toMatch(
        /^Lead list \(Make\) has not been quiet for 14 days yet\. Archive it from \d{1,2} [A-Z][a-z]{2} \d{4}\.$/,
      );
      expect(await set("make:8063994", { state: "archived" })).toMatchObject({
        state: "archived",
      });
      expect(
        (
          await refusal(() =>
            set("make:8063994", { state: "on", note: "back", step: "D-X" }),
          )
        ).message,
      ).toBe("Monday-era ticketing (Make) cannot move from archived to on.");
      expect(
        (
          await refusal(() =>
            set("make:8979157", { state: "off", step: "D-C9" }),
          )
        ).message,
      ).toBe("New Client Form MAIN (Make) cannot move from kept to off.");
      expect(
        (await refusal(() => set("typeform:uXtImBuZ", { state: "closed" })))
          .message,
      ).toBe("Name the deploy step that switched it off.");
      expect(
        await set("typeform:uXtImBuZ", { state: "closed", step: "D-C9" }),
      ).toMatchObject({ state: "closed" });
      expect(
        await set("webhook:WHTP4077499", { state: "removed", step: "D-C9" }),
      ).toMatchObject({ state: "removed" });
      expect(
        (await refusal(() => set("webhook:WHTP4077499", { state: "archived" })))
          .message,
      ).toBe(
        "Lead list webhook (uXtImBuZ) cannot move from removed to archived.",
      );
    });
  });

  test("a later run moves quiet_since forward only; a rollback needs its reason and step and clears the quiet", async () => {
    await rolledBack(async () => {
      await set("make:9282377", {
        state: "off",
        step: "D-C9",
        offAt: "2026-11-03T08:00:00Z",
      });
      expect(
        await set("make:9282377", { quietSince: "2026-11-05T08:00:00Z" }),
      ).toMatchObject({ quiet_since: expect.stringContaining("2026-11-05") });
      expect(
        (
          await refusal(() =>
            set("make:9282377", { quietSince: "2026-11-04T08:00:00Z" }),
          )
        ).message,
      ).toBe("Quiet since only moves forward, on an item that is off.");
      expect(
        (await refusal(() => set("make:9282377", { state: "on" }))).message,
      ).toBe(
        "A rollback needs its reason (3 to 500 characters) and the deploy step that undid it.",
      );
      const back = await set("make:9282377", {
        state: "on",
        note: "The landing page requests broke; back on until fixed.",
        step: "D-C9-undo",
      });
      expect(back).toMatchObject({
        state: "on",
        off_at: null,
        quiet_since: null,
        switch_off_step: "D-C9-undo",
      });
      expect(
        await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_retire_items' AND entity_id = 'make:9282377'",
        ),
      ).toBeGreaterThanOrEqual(3);
    });
  });

  test("Old forms and scenarios: the CEO and admins read it, a CSM does not", async () => {
    const r = await as<Row>(
      CEO,
      "SELECT public.cockpit_retire_items_read() AS r",
    );
    expect(r.items).toHaveLength(76);
    expect(r.items[0]).toHaveProperty("archiveFrom");
    expect(
      (await as<Row>(ADMIN, "SELECT public.cockpit_retire_items_read() AS r"))
        .items,
    ).toHaveLength(76);
    expect(
      (
        await refusal(() =>
          as(CSM_A, "SELECT public.cockpit_retire_items_read() AS r"),
        )
      ).message,
    ).toBe("The old forms list is for the CEO and admins.");
  });
});
