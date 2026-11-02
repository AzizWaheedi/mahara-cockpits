/**
 * supabase/migrations/20261102h_wins_pay.sql (docs/forms/WAVE56-CONTRACT.md
 * sections 2.4, 3.1-3.3, 4.2, 4.3, 4.8, 4.9 and 8, the wins-pay row) on one
 * isolated PostgreSQL with Supabase's default privileges on.
 *
 * The ground is the live chain as forms-editor-supabase.test.ts builds it
 * (the 2a base, the eight 2b files, 20261101l to r, 20261102a to f, the real
 * files in deploy order), plus the pay plans (20261009a hours, 20261011d,
 * 20261018a) and Offer Studio (20261026u, w). Then 20261102g: the real file
 * when money-rails' branch has landed it, else the three objects of it this
 * file reads, exactly as the contract names them (G_STUB: the billing kind
 * "win", the notice kind "win.logged", the door markers). Then 20261102h,
 * twice. The CEO's address is read from the CEO gate migration; every other
 * person, client and value is invented. Nothing here reaches ClickUp, Slack,
 * Typeform, WhatsApp or the live database.
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
import * as native from "../../../hermes/ceo-refresh/native/adapters/money.js";
import * as edge from "../../../supabase/functions/cockpit-ceo-api/finance/attribution";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(180_000);

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

// --- 20261102g, or the three objects of it this file reads (2.3) ---------------------------------

const G = "20261102g_money_rails_w5.sql";
const H = "20261102h_wins_pay.sql";
const PAY = [
  "20261009a_cockpit_team_hours.sql",
  "20261011d_ceo_commission_two_lines.sql",
  "20261018a_ceo_pay_plans.sql",
] as const;
/**
 * Offer Studio's catalog (20261026u, whole) and the proposals table with the
 * checks it carries (20261026w, cut). The proposal content shape is Offer
 * Studio's and its own tests cover it; here a proposal is a row in a state.
 */
async function offers() {
  await db.exec(withoutCron(migration("20261026u_upsell_catalog.sql")));
  const w = migration("20261026w_upsell_proposals.sql");
  await db.exec(
    cut(
      w,
      /CREATE OR REPLACE FUNCTION public\.cockpit_upsell_price_ok\(p jsonb\)[\s\S]*?\$\$;/,
      "price ok",
    ),
  );
  // A stand-in for the content shape check (Offer Studio's own tests cover the real one).
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_content_ok(p jsonb, p_offer text) RETURNS boolean
    LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT jsonb_typeof(p) = 'object' $$;`);
  await db.exec(
    cut(
      w,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_upsell_proposals \([\s\S]*?\n\);/,
      "proposals",
    ),
  );
  await db.exec(`ALTER TABLE public.cockpit_upsell_proposals ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_upsell_proposals FROM PUBLIC, anon, authenticated;`);
}

/** A CHECK on a text column gains values (the money-rails swap), read from the live definition. */
async function widen(table: string, constraint: string, add: string[]) {
  const def = (
    await db.query<{ d: string }>(
      "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2",
      [`public.${table}`, constraint],
    )
  ).rows[0]?.d;
  if (!def) throw new Error(`${table}.${constraint} is missing`);
  const values = [...def.matchAll(/'([^']+)'::text/g)].map(m => m[1]);
  const all = [...new Set([...values, ...add])].map(v => `'${v}'`).join(",");
  const column = def.match(/\(\(?\s*\(?([a-z_]+)\s*=/)?.[1] ?? "kind";
  await db.exec(`ALTER TABLE public.${table} DROP CONSTRAINT ${constraint};
    ALTER TABLE public.${table} ADD CONSTRAINT ${constraint} CHECK (${column} = ANY (ARRAY[${all}]::text[]));`);
}
async function gStub() {
  await widen("cockpit_billing_events", "cockpit_billing_events_kind_check", [
    "win",
    "reactivate",
  ]);
  await widen("cockpit_slack_notices", "cockpit_slack_notices_kind_check", [
    "win.logged",
    "receipt.in",
    "client.reactivated",
  ]);
  await db.exec(`UPDATE public.cockpit_settings SET value = '{"agent":false,"ltv":false,"wins":false,"receipts":false,"reactivate":false}'::jsonb || value
    WHERE key = 'forms.doors';`);
}

/** What the pay plans stand on besides the ground (as hoursTestDb builds it): the people's pay columns and the restored RPCs. */
async function payGround() {
  for (const file of [
    "20260920a_people_commission.sql",
    "20260922c_people_paused.sql",
    "20260922d_people_bot_engagement.sql",
  ]) {
    try {
      await db.exec(migration(file));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  const restore = migration("20261007c_cockpit_rpc_restore.sql");
  await db.exec(
    cut(
      restore,
      /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_people_set_pay\(p_patch jsonb\)[\s\S]*?END \$\$;/,
      "people_set_pay",
    ),
  );
  await db.exec(
    cut(
      restore,
      /CREATE OR REPLACE FUNCTION public\.cockpit_people_write_audit\(\)[\s\S]*?\$\$;/,
      "people_write_audit",
    ),
  );
  await db.exec(
    cut(
      migration("20261007e_cockpit_provider_rpc_restore.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_verified_actor_email\(p_actor_id uuid\)[\s\S]*?\n\$\$;/,
      "verified_actor_email",
    ),
  );
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb), public.cockpit_people_write_audit(),
      public.cockpit_ceo_verified_actor_email(uuid) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb) TO authenticated;`);
  // Storage as the deck files read it (upsellTestDb's cut).
  await db.exec(`ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
    ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(), ADD COLUMN IF NOT EXISTS owner uuid;
    GRANT USAGE ON SCHEMA storage TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;`);
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
  await realAPrereqs(PORTAL);
  for (const file of [
    ...W34,
    D,
    "20261102e_record_make_answer_size.sql",
    "20261102f_form_responses_answer_size.sql",
  ]) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await payGround();
  for (const file of PAY) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await offers();
  if (onBranch(G)) await db.exec(withoutCron(migration(G)));
  else await gStub();
  await db.exec(migration(H));
  await db.exec(migration(H));
}, 600_000);
afterAll(async () => {
  await db?.close();
});

// --- Fixtures (all invented) ---------------------------------------------------------------------

const CANARY = "86eywg1cq";
const PROOF = "https://g.page/r/review-fixture";
const AGREEMENT = "https://docs.example.test/agreement-fixture";
const CSM_PLAN = {
  version: 1,
  parts: [
    {
      key: "retention",
      kind: "band",
      label: "Retention bonus by churn",
      metric: "csm_churn",
      bands: [
        { upTo: 0, inclusive: true, amount: 2000 },
        { upTo: null, amount: 0 },
      ],
    },
    {
      key: "renewals",
      kind: "per_event",
      label: "Renewals",
      event: "renewal",
      amount: 300,
    },
    {
      key: "reactivations",
      kind: "per_event",
      label: "Reactivations",
      event: "reactivation",
      amount: 300,
    },
    {
      key: "upsells",
      kind: "share",
      label: "Backend upsells",
      of: "upsell_cash",
      steps: [{ fromMonth: 1, rate: 0.1 }],
    },
    {
      key: "recurring",
      kind: "share",
      label: "Recurring services",
      of: "recurring_revenue",
      steps: [
        { fromMonth: 1, rate: 0.2 },
        { fromMonth: 2, rate: 0.05 },
      ],
      ends: { onCancel: true, lapseDays: 30 },
    },
    {
      key: "referrals",
      kind: "per_event",
      label: "Referrals",
      event: "referral",
      amount: 250,
    },
    {
      key: "video_testimonials",
      kind: "per_event",
      label: "Video testimonials",
      event: "video_testimonial",
      amount: 150,
    },
    {
      key: "google_reviews",
      kind: "per_event",
      label: "Google reviews",
      event: "google_review",
      amount: 75,
    },
    {
      key: "podcasts",
      kind: "per_event",
      label: "Podcast case studies",
      event: "podcast_case_study",
      amount: 250,
    },
  ],
};
let TODAY = "";
let M0 = ""; // this Kuwait month, YYYY-MM
let NOURA = 0; // CSM of Acme on the roster
let HUDA = 0; // CSM of Beta on the roster
let CLOSER = 0;
let SENT_PROPOSAL = "";
let DRAFT_PROPOSAL = "";
let INVOICE = "";

const uuid = () => crypto.randomUUID();
const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const monthOf = (d: string) => d.slice(0, 7);
const monthWords = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const nextMonth = (ym: string) => {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};
const prevMonth = (ym: string) => {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

async function rpc<T = any>(
  who: string | null,
  fn: string,
  p: unknown,
): Promise<T> {
  return as<T>(who, `SELECT public.${fn}($1::jsonb) AS r`, [JSON.stringify(p)]);
}
async function log(who: string, p: Record<string, unknown>) {
  return rpc(who, "cockpit_csm_win_log", {
    requestId: uuid(),
    taskId: A,
    wonOn: TODAY,
    ...p,
  });
}
async function stage(who: string, p: Record<string, unknown>) {
  return rpc(who, "cockpit_csm_win_stage", { requestId: uuid(), ...p });
}
async function setting(key: string, value: unknown) {
  await ex(
    `UPDATE public.cockpit_settings SET value = value || '${JSON.stringify(value)}'::jsonb WHERE key = '${key}'`,
  );
}
async function moneySection(transactions: Record<string, unknown>[]) {
  await ex(`DELETE FROM public.cockpit_sections WHERE key = 'money'`);
  await q(
    "INSERT INTO public.cockpit_sections(key,label,computed_at,payload,sources) VALUES('money','Money',now(),$1::jsonb,'[]')",
    [JSON.stringify({ attribution: { transactions } })],
  );
}
const txn = (
  id: string,
  d: string,
  usd: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  day: d,
  rail: id.split(":")[0],
  direction: "in",
  usd,
  side: "back_end",
  clientTaskId: A,
  payerName: "Payer Acme Example",
  checked: true,
  ...extra,
});

async function fixtures() {
  TODAY = await one<string>("SELECT public.cockpit_billing_today()::text AS r");
  // Tap charges, which the ordinary tie reads (20260921e).
  await ex(
    cut(
      migration("20260921e_tap_charges.sql"),
      /create table if not exists public\.cockpit_tap_charges \([\s\S]*?\n\);/,
      "tap charges",
    ),
  );
  M0 = monthOf(TODAY);
  await ex(`
    UPDATE public.cockpit_billing_accounts SET csm = 'Noura  test' WHERE clickup_task_id = '${A}';
    UPDATE public.cockpit_billing_accounts SET csm = 'Huda Test' WHERE clickup_task_id = '${B}';
    INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage, client_status, source, synced_at)
    VALUES ('taskT1', 'Twin Studio', 'active', 'Active', 'sync', now()), ('taskT2', 'twin  studio', 'active', 'Active', 'sync', now()),
           ('taskN1', 'Nameless Co', 'active', 'Active', 'sync', now())
    ON CONFLICT DO NOTHING;
    INSERT INTO public.cockpit_people(name, email, role, active, added_by) VALUES ('Closer Test', 'closer@tests.invalid', 'Closer', true, 'test');
    INSERT INTO public.cockpit_client_billing_days(day, clickup_task_id, client_name) VALUES ('${TODAY}', '${A}', 'Acme Interiors'), ('${TODAY}', '${B}', 'Beta Build')
      ON CONFLICT DO NOTHING;`);
  NOURA = await one<number>(
    "SELECT id::int AS r FROM public.cockpit_people WHERE name = 'Noura Test'",
  );
  HUDA = await one<number>(
    "SELECT id::int AS r FROM public.cockpit_people WHERE name = 'Huda Test'",
  );
  CLOSER = await one<number>(
    "SELECT id::int AS r FROM public.cockpit_people WHERE name = 'Closer Test'",
  );
  const from = `${prevMonth(prevMonth(M0))}-01`;
  await q(
    "INSERT INTO public.cockpit_pay_plans(role, from_month, plan, set_by) VALUES ('Client success manager', $1, $2::jsonb, 'test')",
    [from, JSON.stringify(CSM_PLAN)],
  );
  // Huda's own plan pays renewals only, so a review on Beta waits.
  await q(
    "INSERT INTO public.cockpit_pay_plans(person_id, from_month, plan, set_by) VALUES ($1, $2, $3::jsonb, 'test')",
    [HUDA, from, JSON.stringify({ version: 1, parts: [CSM_PLAN.parts[1]] })],
  );
  // Signed deals: Acme's own deal (day 30 of its term today), a referred client, a voided one.
  await q(
    `INSERT INTO public.cockpit_sales_deals(response_id, submitted_at, closer, business_name, email, contracted_revenue, cash_collected, voided) VALUES
    ('resp_acme', $1::date, 'Closer Test', 'Acme Interiors', 'owner@acme.example.test', 6000, 500, false),
    ('resp_ref', $2::date, 'Closer Test', 'Referred Co', 'owner@referred.example.test', 3000, 1000, false),
    ('resp_void', $2::date, 'Closer Test', 'Voided Co', 'owner@void.example.test', 3000, 0, true)`,
    [day(-29), day(-3)],
  );
  // The deal ledger as the last refresh wrote it.
  await q(
    `INSERT INTO public.cockpit_deal_payments(payment_id, deal_response_id, day, usd, rail, kind, deposit_usd, matched_by, active) VALUES
    ('whop:pay_acme_dep', 'resp_acme', $1, 500, 'whop', 'deposit', 500, 'deal_id', true),
    ('whop:pay_acme_rem', 'resp_acme', $2, 900, 'whop', 'remainder', 0, 'card_email', true),
    ('whop:pay_acme_link', 'resp_acme', $2, 300, 'whop', 'remainder', 0, 'deal_id', true),
    ('whop:pay_acme_prior', 'resp_acme', $3, 400, 'whop', 'remainder', 0, 'card_name', true)`,
    [day(-28), day(-1), `${prevMonth(M0)}-15`],
  );
  await moneySection([
    txn("whop:pay_acme_dep", day(-28), 500, { side: "front_end" }),
    txn("whop:pay_acme_rem", day(-1), 900, { side: "front_end" }),
    txn("whop:pay_acme_link", day(-1), 300, { side: "front_end" }),
    txn("whop:pay_acme_prior", `${prevMonth(M0)}-15`, 400, {
      side: "front_end",
    }),
    txn("whop:pay_acme_free", day(-2), 1200),
    txn("whop:pay_acme_free2", day(-2), 600),
    txn("tap:chg_acme_old", day(-70), 999),
    txn("whop:pay_beta", day(-2), 800, { clientTaskId: B }),
    { ...txn("whop:pay_acme_out", day(-2), 50), direction: "out" },
  ]);
  await q(
    `INSERT INTO public.cockpit_manual_payments(id, day, amount, currency, amount_usd, usd_per_unit, client_name, client_key, clickup_task_id, rail, added_by)
    VALUES ('man-acme-1', $1, 700, 'USD', 700, 1, 'Acme Interiors', 'acmeinteriors', '${A}', 'bank_transfer', 'csm.a@tests.invalid')`,
    [day(-2)],
  );
  // Offer Studio: a draft and a sent proposal on Acme.
  DRAFT_PROPOSAL = uuid();
  SENT_PROPOSAL = uuid();
  await q(
    `INSERT INTO public.cockpit_upsell_proposals(id, request_id, task_id, client_name, offer_key, lang, content, list_price, valid_until, status, created_by, updated_by)
    VALUES ($1, gen_random_uuid(), '${A}', 'Acme Interiors', 'website', 'en', '{}'::jsonb, '{"build":2500,"care":null}'::jsonb, $2, 'draft', 'test', 'test')`,
    [DRAFT_PROPOSAL, day(30)],
  );
  await q(
    `INSERT INTO public.cockpit_upsell_proposals(id, request_id, task_id, client_name, offer_key, lang, content, list_price, valid_until, status,
      code, sent_content, sent_price, sent_list_price, sent_lang, sent_at, sent_by, created_by, updated_by)
    VALUES ($1, gen_random_uuid(), '${A}', 'Acme Interiors', 'website', 'en', '{}'::jsonb, '{"build":2500,"care":null}'::jsonb, $2, 'sent',
      'abcdefghjkmn', '{}'::jsonb, '{"parts":{"build":2000,"care":200},"split":false}'::jsonb, '{"build":2500,"care":null}'::jsonb, 'en', now(), 'test', 'test', 'test')`,
    [SENT_PROPOSAL, day(30)],
  );
  INVOICE = uuid();
  await q(
    `INSERT INTO public.cockpit_invoices(id, clickup_task_id, client_name, kind, amount_usd, description, issue_date, due_date, payments, status,
      attempts, requested_by, checkout_source)
    VALUES ($1, '${A}', 'Acme Interiors', 'checkout', 2000, 'Website build', $2, $3, '[]'::jsonb, 'queued', 0, 'test', 'ecom')`,
    [INVOICE, TODAY, day(7)],
  );
}

const winRow = async (id: string) =>
  (await q("SELECT * FROM public.cockpit_csm_wins WHERE id = $1", [id]))[0];
const events = async (id: string) =>
  (
    await q<{ event: string }>(
      "SELECT event FROM public.cockpit_csm_win_events WHERE win_id = $1 ORDER BY id",
      [id],
    )
  ).map(r => r.event);

beforeAll(async () => {
  await fixtures();
}, 600_000);

// --- The file -------------------------------------------------------------------------------------

describe("20261102h applies on the chain, twice, and guards against drift", () => {
  test("every table has row security, no browser grant, and refuses delete and truncate", async () => {
    for (const t of [
      "cockpit_csm_wins",
      "cockpit_csm_win_events",
      "cockpit_win_tie_proposals",
      "cockpit_pay_proposal_decisions",
    ]) {
      expect(
        await one<boolean>(
          "SELECT relrowsecurity AS r FROM pg_class WHERE oid = $1::regclass",
          [`public.${t}`],
        ),
      ).toBe(true);
      for (const role of ["anon", "authenticated"])
        expect(
          await one<boolean>(
            `SELECT has_table_privilege('${role}', 'public.${t}', 'SELECT,INSERT,UPDATE,DELETE') AS r`,
          ),
        ).toBe(false);
      expect(
        await one<boolean>(
          `SELECT has_table_privilege('service_role', 'public.${t}', 'DELETE') AS r`,
        ),
      ).toBe(false);
      await rolledBack(async () => {
        expect(
          (await refusal(() => ex(`TRUNCATE public.${t} CASCADE`))).message,
        ).toBe("Forms records are never deleted");
      });
    }
    // A row of each, then a delete of each.
    await rolledBack(async () => {
      const w = uuid();
      await ex(`INSERT INTO public.cockpit_csm_wins(id, request_id, task_id, client_name, kind, stage, won_on, proof_url, source, logged_by_role)
          VALUES ('${w}', gen_random_uuid(), '${A}', 'Acme Interiors', 'review', 'logged', '${TODAY}', '${PROOF}', 'cockpit', 'the CSM');
        INSERT INTO public.cockpit_csm_win_events(win_id, event, by_role) VALUES ('${w}', 'logged', 'the CSM');
        INSERT INTO public.cockpit_win_tie_proposals(win_id, payment_id, usd, paid_on, rail, proposed_by_role)
          VALUES ('${w}', 'whop:pay_x', 10, '${TODAY}', 'whop', 'the CSM');
        INSERT INTO public.cockpit_pay_proposal_decisions(key, month, decision, reason, decided_by)
          VALUES ('win:${w}:google_reviews:${M0}', '${M0}-01', 'declined', 'Not real', 'test');`);
      for (const t of [
        "cockpit_pay_proposal_decisions",
        "cockpit_win_tie_proposals",
        "cockpit_csm_win_events",
        "cockpit_csm_wins",
      ])
        expect(
          (await refusal(() => ex(`DELETE FROM public.${t}`))).message,
        ).toBe("Forms records are never deleted");
      expect(
        (
          await refusal(() =>
            ex("UPDATE public.cockpit_csm_win_events SET by_role = 'someone'"),
          )
        ).message,
      ).toBe("This record is written once and never changed.");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE entity_id = $1 AND entity_type = 'cockpit_csm_wins'",
          [w],
        ),
      ).toBe(1);
    });
    expect(
      await one<boolean>(
        "SELECT has_table_privilege('service_role', 'public.cockpit_csm_wins', 'SELECT,INSERT,UPDATE') AS r",
      ),
    ).toBe(true);
  });

  test("the drift guard refuses a replaced function whose body changed", async () => {
    await rolledBack(async () => {
      await ex(
        `CREATE OR REPLACE FUNCTION public.cockpit_ceo_payment_untie(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
      );
      const r = await refusal(() =>
        ex(
          migration(H)
            .replace(/^BEGIN;/m, "")
            .replace(/COMMIT;\s*$/, ""),
        ),
      );
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_ceo_payment_untie changed since the waves 5-6 contract read it; stop and re-read it.",
      );
    });
  });

  test("a re-apply after the go-live leaves the door and the switch on", async () => {
    await rolledBack(async () => {
      await setting("forms.doors", { wins: true });
      await setting("pay.proposals", { on: true });
      await ex(
        migration(H)
          .replace(/^BEGIN;/m, "")
          .replace(/COMMIT;\s*$/, ""),
      );
      expect(
        await one(
          "SELECT value->'wins' AS r FROM public.cockpit_settings WHERE key = 'forms.doors'",
        ),
      ).toBe(true);
      expect(
        await one(
          "SELECT value->'on' AS r FROM public.cockpit_settings WHERE key = 'pay.proposals'",
        ),
      ).toBe(true);
    });
  });

  test("the seeds: the registry row win and pay.proposals off", async () => {
    const f = (
      await q(
        "SELECT key, audience, provider, seats, effects, schema->>'lives' AS lives FROM public.cockpit_forms WHERE key = 'win'",
      )
    )[0];
    expect(f).toEqual({
      key: "win",
      audience: "team",
      provider: "native",
      seats: ["csm"],
      effects: [],
      lives: "cockpit",
    });
    expect(
      await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'pay.proposals'",
      ),
    ).toEqual({ on: false });
    expect(
      await one(
        "SELECT value->'wins' AS r FROM public.cockpit_settings WHERE key = 'forms.doors'",
      ),
    ).toBe(false);
  });

  test("the replaced bodies are this file's after values", async () => {
    const md5 = await q<{ proname: string; m: string }>(
      `SELECT p.proname, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS m FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('cockpit_ceo_pay_entry_save','cockpit_ceo_payment_tie','cockpit_ceo_payment_untie') ORDER BY 1`,
    );
    expect(md5).toEqual([
      {
        proname: "cockpit_ceo_pay_entry_save",
        m: "ea917bb7adf730d787bf34beadc7aa30",
      },
      {
        proname: "cockpit_ceo_payment_tie",
        m: "f0e9b33d147639c890966b9e83c2af48",
      },
      {
        proname: "cockpit_ceo_payment_untie",
        m: "ee27b60cc0c347be5fee32d71fb8086e",
      },
    ]);
  });
});

// --- The seat gate and the door -------------------------------------------------------------------

describe("who may log a win, and the door", () => {
  test("anon, a CSM on another client, a seat with no CSM role and finance are refused by every win RPC", async () => {
    const calls: [string, unknown][] = [
      [
        "cockpit_csm_win_log",
        {
          requestId: uuid(),
          taskId: A,
          kind: "review",
          wonOn: TODAY,
          proofUrl: PROOF,
        },
      ],
      [
        "cockpit_csm_win_stage",
        { requestId: uuid(), winId: uuid(), act: "void", reason: "nope" },
      ],
    ];
    for (const who of [null, CSM_B, NOBODY, FINANCE, CREATIVE]) {
      const r = await refusal(() =>
        rpc(who, "cockpit_csm_win_log", calls[0][1]),
      );
      expect(r.code).toBe("42501");
    }
    for (const who of [null, CSM_B, FINANCE])
      expect(
        (
          await refusal(() =>
            as(who, "SELECT public.cockpit_csm_wins_read($1) AS r", [A]),
          )
        ).code,
      ).toBe("42501");
    expect(
      (
        await refusal(() =>
          as(null, "SELECT public.cockpit_csm_wins_list(NULL, NULL) AS r"),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await refusal(() =>
          as(FINANCE, "SELECT public.cockpit_csm_wins_today() AS r"),
        )
      ).code,
    ).toBe("42501");
    for (const fn of [
      "cockpit_ceo_win_tie_decide",
      "cockpit_ceo_win_tie_clear",
      "cockpit_ceo_pay_proposal_decide",
    ])
      expect((await refusal(() => rpc(CSM_A, fn, {}))).code).toBe("42501");
    expect(
      (
        await refusal(() =>
          as(CSM_A, "SELECT public.cockpit_ceo_pay_proposals($1::date) AS r", [
            `${M0}-01`,
          ]),
        )
      ).code,
    ).toBe("42501");
    // A CSM never touches the test card.
    expect(
      (
        await refusal(() =>
          log(CSM_A, { taskId: CANARY, kind: "review", proofUrl: PROOF }),
        )
      ).code,
    ).toBe("42501");
    // Every function is closed to anon; only the seat RPCs open to authenticated.
    for (const fn of [
      "cockpit_csm_win_import(jsonb)",
      "cockpit_win_pay_rows(date)",
      "cockpit_win_closer_paid(text)",
      "cockpit_win_seat(text)",
    ])
      expect(
        await one<boolean>(
          `SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS r`,
        ),
      ).toBe(false);
    for (const fn of [
      "cockpit_csm_win_log(jsonb)",
      "cockpit_ceo_win_tie_clear(jsonb)",
    ])
      expect(
        await one<boolean>(
          `SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS r`,
        ),
      ).toBe(false);
  });

  test("the door is shut until its switch-on, except the CEO on the test card", async () => {
    const r = await refusal(() =>
      log(CSM_A, { kind: "review", proofUrl: PROOF }),
    );
    expect(r.message).toBe("Log a win opens after its switch-on.");
    await rolledBack(async () => {
      const ok = await log(CEO, {
        taskId: CANARY,
        kind: "review",
        proofUrl: PROOF,
      });
      expect(ok.ok).toBe(true);
      const w = await winRow(ok.winId);
      expect([w.source, w.client_name]).toEqual(["canary", "Test card"]);
      // A canary win posts no notice.
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`win:${ok.winId}`],
        ),
      ).toBe(0);
    });
    await setting("forms.doors", { wins: true });
  });
});

// --- Log a win ------------------------------------------------------------------------------------

describe("Log a win: proof per kind, the date, duplicates, one request", () => {
  test("each kind asks for its own proof, in the contract's words", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: "review" }, "Add the review link or a screenshot link."],
      [{ kind: "video_testimonial" }, "Add the video link."],
      [{ kind: "podcast" }, "Add the episode link."],
      [{ kind: "referral" }, "Pick the referred client's signed deal."],
      [
        { kind: "referral", referralDealResponseId: "resp_void" },
        "Pick the referred client's signed deal.",
      ],
      [{ kind: "upsell_smm", proofUrl: PROOF }, "Add the quoted price."],
      [
        { kind: "upsell_smm", quotedUsd: 900 },
        "Add a link that shows the offer, or mark it offered from its sent proposal.",
      ],
      [
        { kind: "upsell_smm", proofUrl: PROOF, quotedUsd: 900, listUsd: 1000 },
        "Say why the price is below the list price.",
      ],
      [
        {
          kind: "upsell_smm",
          proofUrl: PROOF,
          quotedUsd: 900,
          recurring: true,
        },
        "Add the monthly price.",
      ],
      [
        { kind: "review", proofUrl: "http://not-https.example.test" },
        "A link starts with https:// and is at most 1,000 characters.",
      ],
      [{ kind: "trophy" }, "Choose what kind of win this is."],
      [
        { kind: "review", proofUrl: PROOF, wonOn: "2026-01-01" },
        "The win date is today or within the last 30 days.",
      ],
    ];
    for (const [p, sentence] of cases) {
      const r = await refusal(() => log(CSM_A, p));
      expect([r.code, r.message]).toEqual(["22023", sentence]);
    }
    expect(
      (
        await refusal(() =>
          log(CSM_A, { kind: "review", proofUrl: PROOF, wonOn: day(1) }),
        )
      ).message,
    ).toBe("The win date is today or within the last 30 days.");
    expect(
      await one(
        "SELECT count(*)::int AS r FROM public.cockpit_csm_wins WHERE source = 'cockpit'",
      ),
    ).toBe(0);
  });

  test("a review logs once per request, writes the billing event, the notice and the response", async () => {
    await rolledBack(async () => {
      const req = uuid();
      const p = {
        requestId: req,
        taskId: A,
        kind: "review",
        wonOn: day(-3),
        proofUrl: PROOF,
      };
      const first = await rpc(CSM_A, "cockpit_csm_win_log", p);
      expect(first).toEqual({
        ok: true,
        winId: first.winId,
        stage: "logged",
        sentence: "Logged.",
      });
      const again = await rpc(CSM_A, "cockpit_csm_win_log", p);
      expect(again).toEqual({
        ok: true,
        repeat: true,
        winId: first.winId,
        stage: "logged",
        sentence: "Already saved.",
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_csm_wins WHERE request_id = $1",
          [req],
        ),
      ).toBe(1);
      const w = await winRow(first.winId);
      expect([
        Number(w.csm_person_id),
        w.logged_by_role,
        w.source,
        w.client_name,
      ]).toEqual([NOURA, "the CSM", "cockpit", "Acme Interiors"]);
      expect(await events(first.winId)).toEqual(["logged"]);
      const e = (
        await q(
          "SELECT kind, source, to_value, detail FROM public.cockpit_billing_events WHERE detail->>'win_id' = $1",
          [first.winId],
        )
      )[0];
      expect(e.kind).toBe("win");
      expect(e.source).toBe("csm");
      expect(e.detail).toEqual({
        win_id: first.winId,
        kind: "review",
        stage: "logged",
        won_on: day(-3),
        proof_url: PROOF,
        seat_role: "the CSM",
      });
      const n = (
        await q(
          "SELECT kind, facts FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`win:${first.winId}`],
        )
      )[0];
      expect(n.kind).toBe("win.logged");
      expect(JSON.stringify(n.facts)).not.toContain("@");
      const r = (
        await q(
          "SELECT form_key, state, source, answers->>'winId' AS win FROM public.cockpit_form_responses WHERE external_id = $1",
          [`req:${req}`],
        )
      )[0];
      expect(r).toEqual({
        form_key: "win",
        state: "confirmed",
        source: "cockpit",
        win: first.winId,
      });
      // A second review on the card within 30 days asks first and stores nothing.
      const warn = await log(CSM_A, { kind: "review", proofUrl: PROOF });
      expect(warn).toEqual({
        ok: false,
        warning: `A Google review was logged for Acme Interiors on ${await one("SELECT public.cockpit_billing_day_words($1::date) AS r", [day(-3)])}. Log this one too?`,
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_csm_wins WHERE kind = 'review'",
        ),
      ).toBe(1);
      expect(
        (
          await log(CSM_A, {
            kind: "review",
            proofUrl: PROOF,
            confirmDuplicate: true,
          })
        ).ok,
      ).toBe(true);
    });
  });

  test("a CSM on another client is refused by every act on a win of this client", async () => {
    await rolledBack(async () => {
      const up = await log(CSM_A, {
        kind: "upsell_smm",
        proofUrl: PROOF,
        quotedUsd: 900,
      });
      const tries: (() => Promise<unknown>)[] = [
        () =>
          stage(CSM_B, { winId: up.winId, act: "void", reason: "Not mine" }),
        () =>
          as(CSM_B, "SELECT public.cockpit_win_tie_candidates($1::uuid) AS r", [
            up.winId,
          ]),
        () =>
          rpc(CSM_B, "cockpit_csm_win_tie_propose", {
            requestId: uuid(),
            winId: up.winId,
            paymentId: "whop:pay_acme_free",
          }),
        () =>
          as(
            CSM_B,
            "SELECT public.cockpit_csm_win_invoice_link($1::uuid, $2) AS r",
            [up.winId, INVOICE],
          ),
        () =>
          as(null, "SELECT public.cockpit_win_tie_candidates($1::uuid) AS r", [
            up.winId,
          ]),
      ];
      for (const t of tries) expect((await refusal(t)).code).toBe("42501");
    });
  });

  test("a renewal within 30 days warns; a referral deal counts once; a manual reactivation never doubles a Reactivate", async () => {
    await rolledBack(async () => {
      const r1 = await log(CSM_A, { kind: "renewal" });
      expect(r1.next).toBe("Add the agreement link or tie a payment later.");
      expect((await log(CSM_A, { kind: "renewal" })).warning).toMatch(
        /^A renewal was logged for Acme Interiors on .+\. Log this one too\?$/,
      );
      const ref = await log(CSM_A, {
        kind: "referral",
        referralDealResponseId: "resp_ref",
      });
      expect(ref.ok).toBe(true);
      const dup = await refusal(() =>
        log(CSM_B, {
          taskId: B,
          kind: "referral",
          referralDealResponseId: "resp_ref",
        }),
      );
      expect(dup.message).toMatch(
        /^That deal is already logged as a referral win on .+\.$/,
      );
      // The index holds it too.
      expect(
        (
          await refusal(() =>
            ex(`INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on,
          referral_deal_response_id, source, logged_by_role) VALUES (gen_random_uuid(), '${B}', 'Beta Build', 'referral', 'logged', '${TODAY}',
          'resp_ref', 'cockpit', 'the CSM')`),
          )
        ).code,
      ).toBe("23505");
      // Reactivate's own win (client-tail inserts it) blocks a hand-logged one for 60 days.
      await ex(`INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, reason, source, created_by)
        VALUES ('Acme Interiors', '${A}', '${day(-90)}', 'Cancelled', 'cockpit', 'test')`);
      const dep = await one<number>(
        "SELECT max(id)::int AS r FROM public.cockpit_churn_departures",
      );
      await ex(`INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on, departure_id, source, logged_by_role)
        VALUES (gen_random_uuid(), '${A}', 'Acme Interiors', 'reactivation', 'logged', '${day(-10)}', ${dep}, 'reactivate', 'the CSM')`);
      const re = await refusal(() => log(CSM_A, { kind: "reactivation" }));
      expect(re.message).toMatch(
        /^Acme Interiors was reopened on .+ and that return already has its win\.$/,
      );
      // One non-void reactivation win per departure.
      expect(
        (
          await refusal(() =>
            ex(`INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on, departure_id, source,
          logged_by_role) VALUES (gen_random_uuid(), '${A}', 'Acme Interiors', 'reactivation', 'logged', '${TODAY}', ${dep}, 'reactivate', 'the CSM')`),
          )
        ).code,
      ).toBe("23505");
    });
  });
});

// --- Upsell stages --------------------------------------------------------------------------------

describe("upsell stages: offered, accepted, the stage guard", () => {
  test("a draft is never a win; a sent proposal is offered with its prices", async () => {
    await rolledBack(async () => {
      expect(
        (
          await refusal(() =>
            log(CSM_A, { kind: "upsell_website", proposalId: DRAFT_PROPOSAL }),
          )
        ).message,
      ).toBe("Send the proposal first. A draft is not a win.");
      // The sent price (2,200) is under the list (2,500): the reason is asked for.
      expect(
        (
          await refusal(() =>
            log(CSM_A, { kind: "upsell_website", proposalId: SENT_PROPOSAL }),
          )
        ).message,
      ).toBe("Say why the price is below the list price.");
      const r = await log(CSM_A, {
        kind: "upsell_website",
        proposalId: SENT_PROPOSAL,
        belowListReason: "Second site for the same client",
      });
      expect([r.stage, r.sentence]).toEqual([
        "quote_given",
        "Marked as offered.",
      ]);
      const w = await winRow(r.winId);
      expect([
        Number(w.quoted_usd),
        Number(w.list_usd),
        w.recurring,
        Number(w.monthly_usd),
      ]).toEqual([2200, 2500, true, 200]);
      expect(await events(r.winId)).toEqual(["offered"]);
      expect(
        (
          await refusal(() =>
            log(CSM_A, {
              kind: "upsell_website",
              proposalId: SENT_PROPOSAL,
              belowListReason: "again",
            }),
          )
        ).message,
      ).toMatch(/^That proposal is already marked as offered on .+\.$/);
      // Accepted needs the agreement.
      expect(
        (await refusal(() => stage(CSM_A, { winId: r.winId, act: "accept" })))
          .message,
      ).toBe("Add the signed agreement link to mark it accepted.");
      const acc = await stage(CSM_A, {
        winId: r.winId,
        act: "accept",
        agreementUrl: AGREEMENT,
      });
      expect([acc.stage, acc.sentence]).toEqual([
        "signed",
        "Marked as accepted.",
      ]);
      expect(await events(r.winId)).toEqual(["offered", "accepted"]);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_events WHERE detail->>'win_id' = $1",
          [r.winId],
        ),
      ).toBe(2);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`win:${r.winId}:accepted`],
        ),
      ).toBe(1);
    });
  });

  test("an upsell with its agreement at log is offered then accepted in one call", async () => {
    await rolledBack(async () => {
      const r = await log(CSM_A, {
        kind: "upsell_seo_geo",
        proofUrl: PROOF,
        quotedUsd: 5000,
        agreementUrl: AGREEMENT,
      });
      expect(r.stage).toBe("signed");
      expect(await events(r.winId)).toEqual(["offered", "accepted"]);
    });
  });

  test("the guard allows only the stage moves of 3.2", async () => {
    await rolledBack(async () => {
      const rv = await log(CSM_A, {
        kind: "video_testimonial",
        proofUrl: PROOF,
      });
      const up = await log(CSM_A, {
        kind: "upsell_smm",
        proofUrl: PROOF,
        quotedUsd: 900,
      });
      const bad = async (id: string, to: string) =>
        (
          await refusal(() =>
            ex(
              `UPDATE public.cockpit_csm_wins SET stage = '${to}' WHERE id = '${id}'`,
            ),
          )
        ).message;
      expect(await bad(rv.winId, "paid")).toMatch(
        /cockpit_csm_wins_stage_of_kind|That win cannot move from Logged to Paid\./,
      );
      expect(await bad(up.winId, "paid")).toBe(
        "That win cannot move from Offered to Paid.",
      );
      await ex(
        `UPDATE public.cockpit_csm_wins SET stage = 'signed', agreement_url = '${AGREEMENT}' WHERE id = '${up.winId}'`,
      );
      expect(await bad(up.winId, "quote_given")).toBe(
        "That win cannot move from Accepted to Offered.",
      );
      await ex(
        `UPDATE public.cockpit_csm_wins SET stage = 'paid' WHERE id = '${up.winId}'`,
      );
      expect(await bad(up.winId, "signed")).toBe(
        "That win cannot move from Paid to Accepted.",
      );
      // Void needs a reason; void is final.
      expect(
        (
          await refusal(() =>
            stage(CSM_A, { winId: rv.winId, act: "void", reason: "x" }),
          )
        ).message,
      ).toBe("Say why in 3 to 300 characters.");
      expect(
        (
          await stage(CSM_A, {
            winId: rv.winId,
            act: "void",
            reason: "Logged twice",
          })
        ).stage,
      ).toBe("void");
      expect(await bad(rv.winId, "logged")).toBe(
        "That win cannot move from Voided to Logged.",
      );
      expect(
        (
          await refusal(() =>
            ex(
              `UPDATE public.cockpit_csm_wins SET kind = 'podcast' WHERE id = '${rv.winId}'`,
            ),
          )
        ).message,
      ).toBe(
        "A win keeps its card, kind, day and price. Void it and log it again.",
      );
      // A paid win voids only for the CEO, and only after its tie is cleared.
      expect(
        (
          await refusal(() =>
            stage(CSM_A, {
              winId: up.winId,
              act: "void",
              reason: "Client cancelled",
            }),
          )
        ).message,
      ).toBe("Clear the payment tie first. Only the CEO voids a paid win.");
      expect(
        (
          await stage(CEO, {
            winId: up.winId,
            act: "void",
            reason: "Client cancelled",
          })
        ).stage,
      ).toBe("void");
    });
  });
});

// --- Ties -----------------------------------------------------------------------------------------

async function acceptedUpsell(
  kind = "upsell_backend",
  extra: Record<string, unknown> = {},
) {
  const r = await log(CSM_A, {
    kind,
    proofUrl: PROOF,
    quotedUsd: 3000,
    agreementUrl: AGREEMENT,
    wonOn: day(-20),
    ...extra,
  });
  return r.winId as string;
}
async function propose(who: string, winId: string, paymentId: string) {
  return rpc(who, "cockpit_csm_win_tie_propose", {
    requestId: uuid(),
    winId,
    paymentId,
  });
}
async function decide(proposalId: number, decision: string, reason?: string) {
  return rpc(CEO, "cockpit_ceo_win_tie_decide", {
    proposalId,
    decision,
    ...(reason ? { reason } : {}),
  });
}

describe("ties: candidates, the CSM's proposal, the CEO's confirm", () => {
  test("candidates: a rule-2 card-match remainder is in (with its closer), contract money and old payments are out", async () => {
    await rolledBack(async () => {
      const win = await acceptedUpsell();
      const c = await as(
        CSM_A,
        "SELECT public.cockpit_win_tie_candidates($1::uuid) AS r",
        [win],
      );
      const ids = c.map((x: { paymentId: string }) => x.paymentId).sort();
      expect(ids).toEqual([
        "manual:man-acme-1",
        "whop:pay_acme_free",
        "whop:pay_acme_free2",
        "whop:pay_acme_prior",
        "whop:pay_acme_rem",
      ]);
      const rem = c.find(
        (x: { paymentId: string }) => x.paymentId === "whop:pay_acme_rem",
      );
      expect(rem).toEqual({
        paymentId: "whop:pay_acme_rem",
        rail: "whop",
        usd: 900,
        paidOn: day(-1),
        checked: true,
        inDealLedger: { closerRole: "the closer", month: monthOf(day(-1)) },
        closerPaidMonth: null,
        payer: null,
      });
      const manual = c.find(
        (x: { paymentId: string }) => x.paymentId === "manual:man-acme-1",
      );
      expect([manual.checked, manual.payer]).toEqual([false, null]);
      // The CEO sees the payer.
      const ceo = await as(
        CEO,
        "SELECT public.cockpit_win_tie_candidates($1::uuid) AS r",
        [win],
      );
      expect(
        ceo.find(
          (x: { paymentId: string }) => x.paymentId === "whop:pay_acme_free",
        ).payer,
      ).toBe("Payer Acme Example");
    });
  });

  test("propose needs an accepted win and a candidate; the CEO's confirm needs a checked payment and writes one win tie", async () => {
    await rolledBack(async () => {
      const offered = await log(CSM_A, {
        kind: "upsell_smm",
        proofUrl: PROOF,
        quotedUsd: 900,
      });
      expect(
        (
          await refusal(() =>
            propose(CSM_A, offered.winId, "whop:pay_acme_free"),
          )
        ).message,
      ).toBe("Mark it accepted first.");
      const win = await acceptedUpsell();
      expect(
        (await refusal(() => propose(CSM_A, win, "whop:pay_acme_dep"))).message,
      ).toBe(
        "That payment is not one of this client's to tie. Refresh Money and pick it again.",
      );
      // A logged transfer is proposed, but not confirmed until checked.
      const pm = await propose(CSM_A, win, "manual:man-acme-1");
      expect([pm.sentence, pm.checked]).toEqual([
        "Sent to the CEO to confirm.",
        false,
      ]);
      expect(
        (await refusal(() => decide(pm.proposalId, "confirm"))).message,
      ).toBe(
        "This transfer is not checked yet. Check it first, then confirm the tie.",
      );
      await as(
        CEO,
        "SELECT public.cockpit_manual_payment_check('man-acme-1', 'checked', 'CBK fixture ref', NULL) AS r",
      );
      const ok = await decide(pm.proposalId, "confirm");
      expect([ok.state, ok.stage]).toEqual(["confirmed", "paid"]);
      const ties = await q(
        "SELECT payment_id, clickup_task_id, win_id, note FROM public.cockpit_payment_ties WHERE cleared_at IS NULL AND win_id IS NOT NULL",
      );
      expect(ties).toEqual([
        {
          payment_id: "manual:man-acme-1",
          clickup_task_id: A,
          win_id: win,
          note: "Upsell payment for Back-end programme",
        },
      ]);
      expect(await events(win)).toEqual([
        "offered",
        "accepted",
        "tie_proposed",
        "tie_confirmed",
        "paid",
      ]);
      expect(
        (await refusal(() => decide(pm.proposalId, "confirm"))).message,
      ).toBe("That proposal was already decided.");
    });
  });

  test("the ordinary tie and untie refuse a win tie and are unchanged otherwise", async () => {
    await rolledBack(async () => {
      const win = await acceptedUpsell();
      const pr = await propose(CSM_A, win, "whop:pay_acme_free");
      const ok = await decide(pr.proposalId, "confirm");
      const tieRow = (
        await q("SELECT id FROM public.cockpit_payment_ties WHERE id = $1", [
          ok.tieId,
        ])
      )[0];
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_payment_tie", {
              paymentId: "whop:pay_acme_free",
              clickupTaskId: B,
              note: "Move it",
            }),
          )
        ).message,
      ).toBe("This payment is tied to a win. Clear it from the win.");
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_payment_untie", {
              id: tieRow.id,
              reason: "Wrong",
            }),
          )
        ).message,
      ).toBe("This payment is tied to a win. Clear it from the win.");
      // An ordinary tie, a replace and an untie as before.
      const t1 = await rpc(CEO, "cockpit_ceo_payment_tie", {
        paymentId: "whop:pay_acme_free2",
        clickupTaskId: A,
        note: "Acme's card",
      });
      const t2 = await rpc(CEO, "cockpit_ceo_payment_tie", {
        paymentId: "whop:pay_acme_free2",
        clickupTaskId: B,
        note: "Beta's card",
      });
      expect(
        await one(
          "SELECT cleared_reason AS r FROM public.cockpit_payment_ties WHERE id = $1",
          [t1.id],
        ),
      ).toBe("Replaced by a new tie");
      expect(
        (
          await rpc(CEO, "cockpit_ceo_payment_untie", {
            id: t2.id,
            reason: "Not theirs",
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_payment_tie", {
              paymentId: "nope",
              clickupTaskId: A,
              note: "bad",
            }),
          )
        ).message,
      ).toBe("That is not a payment id from the Transactions tab");
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_payment_untie", {
              id: t2.id,
              reason: "again",
            }),
          )
        ).message,
      ).toBe("That tie is already removed");
      // One payment, one win: a second live win tie on the payment is refused by the index.
      const win2 = await acceptedUpsell("upsell_smm");
      expect(
        (
          await refusal(() =>
            ex(`INSERT INTO public.cockpit_payment_ties(payment_id, clickup_task_id, note, set_by, win_id)
          VALUES ('whop:pay_acme_free', '${A}', 'second', 'test', '${win2}')`),
          )
        ).code,
      ).toBe("23505");
      // A win tie is always a payment tie to the card.
      expect(
        (
          await refusal(() =>
            ex(`INSERT INTO public.cockpit_payment_ties(payer_email, clickup_task_id, note, set_by, win_id)
          VALUES ('x@y.example.test', '${A}', 'payer', 'test', '${win2}')`),
          )
        ).message,
      ).toContain("cockpit_payment_ties_win_is_payment_to_card");
    });
  });

  test("a card-match remainder needs the CEO's reason; cash in an approved closer month stays with the deal", async () => {
    await rolledBack(async () => {
      const win = await acceptedUpsell();
      const pr = await propose(CSM_A, win, "whop:pay_acme_rem");
      expect(
        (await refusal(() => decide(pr.proposalId, "confirm"))).message,
      ).toBe(
        "This payment counts for the closer now. Say why it is the upsell's.",
      );
      // The closer was paid for the prior month: that cash cannot move.
      await ex(`INSERT INTO public.cockpit_pay_months(person_id, month, status, parts_usd, result, result_hash, approved_by)
        VALUES (${CLOSER}, '${prevMonth(M0)}-01', 'approved', 0, '{}', '${"0".repeat(32)}', 'test')`);
      const prior = await propose(CSM_A, win, "whop:pay_acme_prior");
      expect(
        (
          await refusal(() =>
            decide(prior.proposalId, "confirm", "It was the website deposit"),
          )
        ).message,
      ).toBe(
        `This payment was paid to the closer in ${monthWords(prevMonth(M0))}. It stays with the deal.`,
      );
      const c = await as(
        CEO,
        "SELECT public.cockpit_win_tie_candidates($1::uuid) AS r",
        [win],
      );
      void c;
      expect(
        (
          await decide(
            pr.proposalId,
            "confirm",
            "The day-30 payment was the website build",
          )
        ).state,
      ).toBe("confirmed");
      expect(
        (await decide(prior.proposalId, "decline", "Stays with the deal"))
          .state,
      ).toBe("declined");
    });
  });
});

// --- The back-end rule, end to end ---------------------------------------------------------------

describe("the back-end rule reads the win tie from the database (both copies)", () => {
  test("an upsell payment on day 30 of a deal's term is back end, the CSM's, off the deal ledger; without the win it is the closer's", async () => {
    await rolledBack(async () => {
      const win = await acceptedUpsell();
      const pr = await propose(CSM_A, win, "whop:pay_acme_rem");
      await decide(pr.proposalId, "confirm", "Day-30 website build");
      const tieRows = (
        await q<{ t: Record<string, unknown> }>(
          "SELECT to_jsonb(t) AS t FROM public.cockpit_payment_ties t WHERE cleared_at IS NULL",
        )
      ).map(r => r.t);
      const deals = [
        {
          responseId: "resp_acme",
          day: day(-29),
          business: "Acme Interiors",
          email: "owner@acme.example.test",
          contactName: null,
          closer: "Closer Test",
          csm: "Noura Test",
          deposit: 500,
          paymentStructure: "Split",
          contracted: 6000,
        },
      ];
      const cards = [
        {
          taskId: A,
          names: ["Acme Interiors"],
          emails: ["pay@acme.example.test"],
          payerKeys: [],
          csm: "Noura Test",
        },
      ];
      const payments = [
        {
          id: "whop:pay_acme_dep",
          day: day(-28),
          usd: 500,
          rail: "whop",
          currency: "USD",
          amount: 500,
          payerEmail: "owner@acme.example.test",
          payerName: null,
          dealResponseId: "resp_acme",
          clickupTaskId: null,
          billingReason: null,
        },
        {
          id: "whop:pay_acme_rem",
          day: day(-1),
          usd: 900,
          rail: "whop",
          currency: "USD",
          amount: 900,
          payerEmail: "pay@acme.example.test",
          payerName: null,
          dealResponseId: null,
          clickupTaskId: null,
          billingReason: null,
        },
      ];
      const n = native.attributePayments(
        payments,
        deals,
        cards,
        tieRows,
      ) as edge.Attributed[];
      const e = edge.attribute(
        payments as edge.PaymentIn[],
        deals as edge.DealRef[],
        cards as edge.CardRef[],
        tieRows,
      );
      expect(n).toEqual(e);
      const rem = n.find(r => r.id === "whop:pay_acme_rem");
      expect([
        rem?.side,
        rem?.person,
        rem?.personRole,
        rem?.dealResponseId,
        rem?.clientTaskId,
      ]).toEqual(["back_end", "Noura Test", "csm", null, A]);
      expect(
        native
          .dealLedgerRows(n)
          .map((r: { payment_id: string }) => r.payment_id),
      ).toEqual(["whop:pay_acme_dep"]);
      // Without the win tie the same payment is the closer's (rule 2).
      const without = native.attributePayments(
        payments,
        deals,
        cards,
        [],
      ) as edge.Attributed[];
      expect(without.find(r => r.id === "whop:pay_acme_rem")?.side).toBe(
        "front_end",
      );
      // A cleared win tie falls back to the automatic rules.
      await rpc(CEO, "cockpit_ceo_win_tie_clear", {
        winId: win,
        reason: "Tied by mistake",
      });
      const cleared = (
        await q<{ t: Record<string, unknown> }>(
          "SELECT to_jsonb(t) AS t FROM public.cockpit_payment_ties t",
        )
      ).map(r => r.t);
      expect(
        (
          native.attributePayments(
            payments,
            deals,
            cards,
            cleared,
          ) as edge.Attributed[]
        ).find(r => r.id === "whop:pay_acme_rem")?.side,
      ).toBe("front_end");
    });
  });
});

// --- Clearing a win tie ---------------------------------------------------------------------------

describe("cockpit_ceo_win_tie_clear", () => {
  test("only the CEO; back to Accepted; lists the confirmed entries of open months; refused once paid in an approved month", async () => {
    await rolledBack(async () => {
      await setting("pay.proposals", { on: true });
      const win = await acceptedUpsell("upsell_backend", { wonOn: day(-2) });
      const pr = await propose(CSM_A, win, "whop:pay_acme_free");
      await decide(pr.proposalId, "confirm");
      expect(
        (
          await refusal(() =>
            rpc(CSM_A, "cockpit_ceo_win_tie_clear", {
              winId: win,
              reason: "no",
            }),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_win_tie_clear", { winId: win, reason: "x" }),
          )
        ).message,
      ).toBe("Say why in 3 to 300 characters.");
      const key = `win:${win}:upsells:${monthOf(day(-2))}`;
      const conf = await rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
        month: monthOf(day(-2)),
        key,
        decision: "confirm",
      });
      expect(conf.state).toBe("confirmed");
      const out = await rpc(CEO, "cockpit_ceo_win_tie_clear", {
        winId: win,
        reason: "Tied the wrong payment",
      });
      expect(out.stage).toBe("signed");
      expect(out.entries).toEqual([
        {
          entryId: conf.entryId,
          month: monthOf(day(-2)),
          person: "Noura Test",
          part: "Backend upsells",
          amountUsd: 120,
        },
      ]);
      expect(out.sentence).toBe(
        "Tie cleared. 1 pay entry came from this win; check them on Team & payroll.",
      );
      expect((await winRow(win)).stage).toBe("signed");
      expect(await events(win)).toContain("tie_cleared");
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_win_tie_clear", {
              winId: win,
              reason: "again",
            }),
          )
        ).message,
      ).toBe("This win has no payment tied.");
      // Tied again and the CSM's month approved: the clear is refused.
      const pr2 = await propose(CSM_A, win, "whop:pay_acme_free2");
      await decide(pr2.proposalId, "confirm");
      await ex(`INSERT INTO public.cockpit_pay_months(person_id, month, status, parts_usd, result, result_hash, approved_by)
        VALUES (${NOURA}, '${monthOf(day(-2))}-01', 'approved', 0, '{}', '${"0".repeat(32)}', 'test')`);
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_win_tie_clear", {
              winId: win,
              reason: "Wrong again",
            }),
          )
        ).message,
      ).toBe(
        `The CSM was paid for this upsell in ${monthWords(monthOf(day(-2)))}. It stays tied; add an adjustment in ${monthWords(nextMonth(monthOf(day(-2))))} if it was wrong.`,
      );
    });
  });
});

// --- Pay proposals --------------------------------------------------------------------------------

const rows = async (ym: string) =>
  (await q(
    "SELECT r.*, r.cleared_on::text AS cleared_on, r.posted_on::text AS posted_on FROM public.cockpit_win_pay_rows($1::date) r ORDER BY key",
    [`${ym}-01`],
  )) as Record<string, any>[];

describe("pay proposals follow 4.9's table", () => {
  test("reviews, videos, podcasts propose one each in the win month, priced with the plan", async () => {
    await rolledBack(async () => {
      const rv = await log(CSM_A, { kind: "review", proofUrl: PROOF });
      const vd = await log(CSM_A, {
        kind: "video_testimonial",
        proofUrl: PROOF,
      });
      const pc = await log(CSM_A, { kind: "podcast", proofUrl: PROOF });
      const r = await rows(M0);
      const of = (id: string) => r.find(x => x.win_id === id);
      expect([
        of(rv.winId)?.part_key,
        of(rv.winId)?.state,
        Number(of(rv.winId)?.quantity),
        Number(of(rv.winId)?.amount_usd),
        of(rv.winId)?.posted_on,
      ]).toEqual(["google_reviews", "proposed", 1, 75, TODAY]);
      expect([
        of(vd.winId)?.part_key,
        Number(of(vd.winId)?.amount_usd),
      ]).toEqual(["video_testimonials", 150]);
      expect([
        of(pc.winId)?.part_key,
        Number(of(pc.winId)?.amount_usd),
      ]).toEqual(["podcasts", 250]);
      expect(of(rv.winId)?.key).toBe(`win:${rv.winId}:google_reviews:${M0}`);
      expect(of(rv.winId)?.evidence_ref).toBe(`win:${rv.winId}`);
      expect(
        (await rows(nextMonth(M0))).find(x => x.win_id === rv.winId),
      ).toBeUndefined();
    });
  });

  test("a referral waits until the referred deal pays; renewals wait for an agreement or a tied payment", async () => {
    await rolledBack(async () => {
      const ref = await log(CSM_A, {
        kind: "referral",
        referralDealResponseId: "resp_ref",
      });
      const ren = await log(CSM_A, { kind: "renewal" });
      const ren2 = await log(CSM_B, {
        taskId: B,
        kind: "renewal",
        agreementUrl: AGREEMENT,
      });
      let r = await rows(M0);
      expect([
        r.find(x => x.win_id === ref.winId)?.state,
        r.find(x => x.win_id === ref.winId)?.why,
      ]).toEqual(["waiting", "The referred client has not paid yet."]);
      expect([
        r.find(x => x.win_id === ren.winId)?.state,
        r.find(x => x.win_id === ren.winId)?.why,
      ]).toEqual(["waiting", "No agreement link or tied payment yet."]);
      expect([
        r.find(x => x.win_id === ren2.winId)?.state,
        Number(r.find(x => x.win_id === ren2.winId)?.amount_usd),
      ]).toEqual(["proposed", 300]);
      await ex(`INSERT INTO public.cockpit_deal_payments(payment_id, deal_response_id, day, usd, rail, kind, deposit_usd, matched_by, active)
        VALUES ('whop:pay_ref_dep', 'resp_ref', '${TODAY}', 1000, 'whop', 'deposit', 1000, 'deal_id', true)`);
      r = await rows(M0);
      const x = r.find(y => y.win_id === ref.winId);
      expect([x?.state, x?.cleared_on, Number(x?.amount_usd)]).toEqual([
        "proposed",
        TODAY,
        250,
      ]);
    });
  });

  test("a part missing from the person's plan waits; an unmatched card asks for the person", async () => {
    await rolledBack(async () => {
      const rv = await log(CSM_B, {
        taskId: B,
        kind: "review",
        proofUrl: PROOF,
      });
      const x = (await rows(M0)).find(y => y.win_id === rv.winId);
      expect([x?.state, x?.why]).toEqual([
        "waiting",
        `Google reviews is not in the client success manager's plan for ${monthWords(M0)}.`,
      ]);
      await ex(
        `UPDATE public.cockpit_billing_accounts SET csm = 'Somebody Else' WHERE clickup_task_id = '${A}'`,
      );
      const rv2 = await log(CSM_A, { kind: "podcast", proofUrl: PROOF });
      const y = (await rows(M0)).find(z => z.win_id === rv2.winId);
      expect([y?.state, y?.person_id, y?.why]).toEqual([
        "proposed",
        null,
        "No CSM on the roster matches this card. Pick the person when you confirm.",
      ]);
    });
  });

  test("a paid upsell proposes 10% of its checked cash; a recurring one counts engagement months 1, 2, 3", async () => {
    await rolledBack(async () => {
      const one_ = await acceptedUpsell("upsell_backend", { wonOn: day(-2) });
      const pr = await propose(CSM_A, one_, "whop:pay_acme_free");
      await decide(pr.proposalId, "confirm");
      const x = (await rows(monthOf(day(-2)))).find(y => y.win_id === one_);
      expect([
        x?.part_key,
        Number(x?.cash_usd),
        x?.engagement_month,
        Number(x?.amount_usd),
        x?.cleared_on,
      ]).toEqual(["upsells", 1200, 1, 120, day(-2)]);
      // A recurring upsell: three tied payments in three months (written straight, as three confirmed proposals would).
      const rec = await acceptedUpsell("upsell_smm", {
        recurring: true,
        monthlyUsd: 1000,
        wonOn: day(-2),
      });
      const months = [
        monthOf(day(-2)),
        nextMonth(monthOf(day(-2))),
        nextMonth(nextMonth(monthOf(day(-2)))),
      ];
      for (const [i, ym] of months.entries()) {
        await ex(`WITH t AS (INSERT INTO public.cockpit_payment_ties(payment_id, clickup_task_id, note, set_by, win_id)
            VALUES ('whop:pay_rec_${i}', '${A}', 'Upsell payment', 'test', '${rec}') RETURNING id)
          INSERT INTO public.cockpit_win_tie_proposals(win_id, payment_id, usd, paid_on, rail, state, proposed_by_role, decided_by, decided_at, tie_id)
          SELECT '${rec}', 'whop:pay_rec_${i}', 1000, '${ym}-05', 'whop', 'confirmed', 'the CSM', 'test', now(), t.id FROM t`);
      }
      const got = [];
      for (const ym of months) {
        const r = (await rows(ym)).find(y => y.win_id === rec);
        got.push([r?.part_key, r?.engagement_month, Number(r?.amount_usd)]);
      }
      expect(got).toEqual([
        ["recurring", 1, 200],
        ["recurring", 2, 50],
        ["recurring", 3, 50],
      ]);
    });
  });
});

describe("the CEO confirms or declines a pay proposal", () => {
  test("both RPCs refuse while the switch is off", async () => {
    expect(
      (
        await refusal(() =>
          as(CEO, "SELECT public.cockpit_ceo_pay_proposals($1::date) AS r", [
            `${M0}-01`,
          ]),
        )
      ).message,
    ).toBe("Pay proposals open after their switch-on.");
    expect(
      (
        await refusal(() =>
          rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
            month: M0,
            key: "x",
            decision: "confirm",
          }),
        )
      ).message,
    ).toBe("Pay proposals open after their switch-on.");
  });

  test("confirm writes one entry through the save path; a second confirm is refused; decline needs a reason", async () => {
    await rolledBack(async () => {
      await setting("pay.proposals", { on: true });
      const rv = await log(CSM_A, { kind: "review", proofUrl: PROOF });
      const vd = await log(CSM_A, {
        kind: "video_testimonial",
        proofUrl: PROOF,
      });
      const list = await as(
        CEO,
        "SELECT public.cockpit_ceo_pay_proposals($1::date) AS r",
        [`${M0}-01`],
      );
      expect(list.on).toBe(true);
      const row = list.rows.find(
        (r: { winId: string }) => r.winId === rv.winId,
      );
      expect([
        row.person,
        row.partLabel,
        row.amountUsd,
        row.state,
        row.carryTo,
      ]).toEqual(["Noura Test", "Google reviews", 75, "proposed", null]);
      const ok = await rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
        month: M0,
        key: row.key,
        decision: "confirm",
      });
      expect([ok.state, ok.sentence, ok.month]).toEqual([
        "confirmed",
        "Confirmed.",
        M0,
      ]);
      const e = (
        await q(
          "SELECT person_id::int, month::text, part_key, quantity::int, evidence_ref, evidence, posted_on::text, entered_by, note FROM public.cockpit_pay_entries WHERE id = $1",
          [ok.entryId],
        )
      )[0];
      expect(e).toEqual({
        person_id: NOURA,
        month: `${M0}-01`,
        part_key: "google_reviews",
        quantity: 1,
        evidence_ref: `win:${rv.winId}`,
        evidence: PROOF,
        posted_on: TODAY,
        entered_by: CEO_EMAIL,
        note: "Google reviews",
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_pay_entries WHERE evidence_ref = $1",
          [`win:${rv.winId}`],
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'pay.entry' AND entity_id = $1",
          [String(ok.entryId)],
        ),
      ).toBe(1);
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
              month: M0,
              key: row.key,
              decision: "confirm",
            }),
          )
        ).message,
      ).toBe("That proposal was already confirmed.");
      const vkey = `win:${vd.winId}:video_testimonials:${M0}`;
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
              month: M0,
              key: vkey,
              decision: "decline",
            }),
          )
        ).message,
      ).toBe("Say why in 3 to 300 characters.");
      expect(
        (
          await rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
            month: M0,
            key: vkey,
            decision: "decline",
            reason: "Not a real testimonial",
          })
        ).state,
      ).toBe("declined");
      const after = (await rows(M0))
        .filter(r => [rv.winId, vd.winId].includes(r.win_id))
        .map(r => [r.state, r.entry_id === null]);
      expect(after.sort()).toEqual([
        ["confirmed", false],
        ["declined", true],
      ]);
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
              month: M0,
              key: "win:nope",
              decision: "confirm",
            }),
          )
        ).message,
      ).toBe(`That proposal is not in ${monthWords(M0)}. Reload the list.`);
    });
  });

  test("a proposal for an approved month is confirmed into the first open month, once", async () => {
    await rolledBack(async () => {
      await setting("pay.proposals", { on: true });
      const rv = await log(CSM_A, { kind: "review", proofUrl: PROOF });
      await ex(`INSERT INTO public.cockpit_pay_months(person_id, month, status, parts_usd, result, result_hash, approved_by)
        VALUES (${NOURA}, '${M0}-01', 'approved', 0, '{}', '${"0".repeat(32)}', 'test')`);
      const key = `win:${rv.winId}:google_reviews:${M0}`;
      const list = await as(
        CEO,
        "SELECT public.cockpit_ceo_pay_proposals($1::date) AS r",
        [`${M0}-01`],
      );
      expect(
        list.rows.find((r: { key: string }) => r.key === key).carryTo,
      ).toBe(nextMonth(M0));
      const ok = await rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
        month: M0,
        key,
        decision: "confirm",
      });
      expect([ok.month, ok.sentence]).toEqual([
        nextMonth(M0),
        `Added to ${monthWords(nextMonth(M0))}: ${monthWords(M0)} is approved.`,
      ]);
      const e = (
        await q(
          "SELECT month::text, note, evidence_ref FROM public.cockpit_pay_entries WHERE id = $1",
          [ok.entryId],
        )
      )[0];
      expect(e).toEqual({
        month: `${nextMonth(M0)}-01`,
        note: `For ${monthWords(M0)}: Google reviews`,
        evidence_ref: `win:${rv.winId}`,
      });
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_proposal_decide", {
              month: M0,
              key,
              decision: "confirm",
            }),
          )
        ).message,
      ).toBe("That proposal was already confirmed.");
      // Typed by hand for the same month, it is refused too (the For note counts).
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_entry_save", {
              personId: NOURA,
              month: nextMonth(M0),
              partKey: "google_reviews",
              quantity: 1,
              evidence: PROOF,
              postedOn: TODAY,
              evidenceRef: `win:${rv.winId}`,
              forMonth: M0,
            }),
          )
        ).message,
      ).toBe(`This win is already paid for ${monthWords(M0)}.`);
    });
  });
});

describe("the C7 rule on typed entries", () => {
  const typed = (extra: Record<string, unknown>) =>
    rpc(CEO, "cockpit_ceo_pay_entry_save", {
      personId: NOURA,
      month: M0,
      partKey: "google_reviews",
      quantity: 1,
      evidence: PROOF,
      postedOn: TODAY,
      ...extra,
    });

  test("while the switch is off, a typed entry is as before (a replay of the live shapes)", async () => {
    await rolledBack(async () => {
      expect((await typed({})).ok).toBe(true);
      expect(
        (
          await rpc(CEO, "cockpit_ceo_pay_entry_save", {
            personId: NOURA,
            month: M0,
            partKey: "upsells",
            cashUsd: 1000,
            engagementMonth: 1,
            client: "Acme Interiors",
            clearedOn: TODAY,
            evidenceRef: "whop:pay_x",
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await rpc(CEO, "cockpit_ceo_pay_entry_save", {
            personId: NOURA,
            month: M0,
            partKey: "adjustment",
            amountUsd: -50,
            note: "Correction",
            fromMonth: prevMonth(M0),
          })
        ).ok,
      ).toBe(true);
      expect(
        (await refusal(() => typed({ evidence: "not a link" }))).message,
      ).toBe("Paste the link to the review.");
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_entry_save", {
              personId: NOURA,
              month: M0,
              partKey: "upsells",
              cashUsd: 1000,
              engagementMonth: 1,
              client: "Acme Interiors",
              clearedOn: `${prevMonth(M0)}-10`,
              evidenceRef: "whop:pay_x",
            }),
          )
        ).message,
      ).toMatch(/^Cleared on .+: add it to .+\.$/);
    });
  });

  test("while it is on, a win-backed part names its win or says why it is outside the ledger", async () => {
    await rolledBack(async () => {
      await setting("pay.proposals", { on: true });
      expect((await refusal(() => typed({}))).message).toBe(
        "This part comes from the wins ledger. Confirm its proposal, or say why it is not in the ledger.",
      );
      expect(
        (await refusal(() => typed({ outsideLedger: "too short" }))).message,
      ).toBe(
        "This part comes from the wins ledger. Confirm its proposal, or say why it is not in the ledger.",
      );
      const out = await typed({
        outsideLedger: "Review posted before the ledger existed",
        note: "From the sheet",
      });
      expect(
        await one(
          "SELECT note AS r FROM public.cockpit_pay_entries WHERE id = $1",
          [out.id],
        ),
      ).toBe(
        "Outside the wins ledger: Review posted before the ledger existed. From the sheet",
      );
      const rv = await log(CSM_A, { kind: "review", proofUrl: PROOF });
      expect((await typed({ evidenceRef: `win:${rv.winId}` })).ok).toBe(true);
      expect(
        (await refusal(() => typed({ evidenceRef: `win:${rv.winId}` })))
          .message,
      ).toBe(`This win is already paid for ${monthWords(M0)}.`);
      expect(
        (await refusal(() => typed({ evidenceRef: `win:${uuid()}` }))).message,
      ).toBe("That win is not in the ledger, or it was voided.");
      // Adjustments and other parts are unchanged.
      expect(
        (
          await rpc(CEO, "cockpit_ceo_pay_entry_save", {
            personId: NOURA,
            month: M0,
            partKey: "adjustment",
            amountUsd: 25,
            note: "Bonus fix",
            fromMonth: prevMonth(M0),
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await refusal(() =>
            rpc(CEO, "cockpit_ceo_pay_entry_save", {
              personId: NOURA,
              month: M0,
              partKey: "retention",
              quantity: 1,
            }),
          )
        ).message,
      ).toBe(
        "This part is worked out by the cockpit; confirm its input instead of typing it.",
      );
    });
  });
});

// --- The import -----------------------------------------------------------------------------------

describe("the import of the old Typeform wins", () => {
  test("owner only; void wins with one imported event; a folded name with exactly one hit; idempotent; nothing else written", async () => {
    await rolledBack(async () => {
      const payload = {
        rows: [
          {
            importedFrom: "typeform:ETEynRgb:resp1",
            kind: "review",
            wonOn: "2026-05-05",
            clickupId: A,
            proofUrl: PROOF,
          },
          {
            importedFrom: "typeform:VP3zmaj2:resp2",
            kind: "upsell_website",
            wonOn: "2026-05-11",
            businessName: "  beta   BUILD ",
            quotedUsd: 2500,
          },
          {
            importedFrom: "typeform:VP3zmaj2:resp3",
            kind: "upsell_website",
            wonOn: "2026-05-11",
            businessName: "Twin Studio",
          },
          {
            importedFrom: "typeform:bAmbMKM2:resp4",
            kind: "referral",
            wonOn: "2026-05-06",
            businessName: "Nobody Here",
          },
        ],
      };
      expect(
        (
          await refusal(() =>
            as(CEO, "SELECT public.cockpit_csm_win_import($1::jsonb) AS r", [
              JSON.stringify(payload),
            ]),
          )
        ).code,
      ).toBe("42501");
      const before = {
        events: await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_events",
        ),
        notices: await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices",
        ),
        responses: await one<number>(
          "SELECT count(*)::int AS r FROM public.cockpit_form_responses",
        ),
      };
      const out = await one(
        "SELECT public.cockpit_csm_win_import($1::jsonb) AS r",
        [JSON.stringify(payload)],
      );
      expect(out).toEqual({
        ok: true,
        inserted: 2,
        alreadyThere: 0,
        noCard: 2,
      });
      expect(
        await one("SELECT public.cockpit_csm_win_import($1::jsonb) AS r", [
          JSON.stringify(payload),
        ]),
      ).toEqual({ ok: true, inserted: 0, alreadyThere: 2, noCard: 2 });
      const wins = await q(
        "SELECT task_id, kind, stage, source, void_reason FROM public.cockpit_csm_wins WHERE source = 'import' ORDER BY imported_from",
      );
      expect(wins).toEqual([
        {
          task_id: A,
          kind: "review",
          stage: "void",
          source: "import",
          void_reason: "imported, pre-cockpit",
        },
        {
          task_id: B,
          kind: "upsell_website",
          stage: "void",
          source: "import",
          void_reason: "imported, pre-cockpit",
        },
      ]);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_csm_win_events WHERE event = 'imported'",
        ),
      ).toBe(2);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_events",
        ),
      ).toBe(before.events);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices",
        ),
      ).toBe(before.notices);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_form_responses",
        ),
      ).toBe(before.responses);
      // Void wins pay nothing and are not in the view.
      expect((await rows("2026-05")).length).toBe(0);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_wins_v WHERE imported",
        ),
      ).toBe(0);
    });
  });
});

// --- Reads, Today, the invoice link and the view --------------------------------------------------

describe("reads, Today bands, the invoice link and cockpit_wins_v", () => {
  test("wins_read and wins_list carry WinRow; list totals count upsells by event day", async () => {
    await rolledBack(async () => {
      await log(CSM_A, { kind: "review", proofUrl: PROOF });
      const up = await acceptedUpsell("upsell_backend", { wonOn: day(-2) });
      const pr = await propose(CSM_A, up, "whop:pay_acme_free");
      await decide(pr.proposalId, "confirm");
      const read = await as(
        CSM_A,
        "SELECT public.cockpit_csm_wins_read($1) AS r",
        [A],
      );
      expect(read.doorOpen).toBe(true);
      const w = read.wins.find((x: { id: string }) => x.id === up);
      expect([
        w.stageLabel,
        w.tiedUsd,
        w.tiedCheckedUsd,
        w.tiePending,
        w.pay.state,
        w.pay.amountUsd,
      ]).toEqual(["Paid", 1200, 1200, null, "proposed", 120]);
      expect(JSON.stringify(read)).not.toContain("@");
      const list = await as(
        CEO,
        "SELECT public.cockpit_csm_wins_list($1::date, $2::date) AS r",
        [day(-30), TODAY],
      );
      expect(list.totals.upsellsOffered).toBe(1);
      expect(list.totals.upsellsAccepted).toBe(1);
      expect(list.totals.upsellCashChecked).toBe(1200);
      expect(list.totals.byKind).toEqual({ review: 1, upsell_backend: 1 });
      // A CSM sees only their own cards.
      const other = await as(
        CSM_B,
        "SELECT public.cockpit_csm_wins_list($1::date, $2::date) AS r",
        [day(-30), TODAY],
      );
      expect(other.wins).toEqual([]);
    });
  });

  test("Today: accepted with no agreement, a paid invoice not tied, ties waiting for the CEO", async () => {
    await rolledBack(async () => {
      await ex(
        `UPDATE public.cockpit_upsell_proposals SET status = 'accepted' WHERE id = '${SENT_PROPOSAL}'`,
      );
      const up = await acceptedUpsell("upsell_website");
      expect(
        (
          await refusal(() =>
            as(
              CSM_B,
              "SELECT public.cockpit_csm_win_invoice_link($1::uuid, $2) AS r",
              [up, INVOICE],
            ),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await as(
            CSM_A,
            "SELECT public.cockpit_csm_win_invoice_link($1::uuid, $2) AS r",
            [up, INVOICE],
          )
        ).sentence,
      ).toBe("Linked.");
      const second = await acceptedUpsell("upsell_smm");
      expect(
        (
          await refusal(() =>
            as(
              CSM_A,
              "SELECT public.cockpit_csm_win_invoice_link($1::uuid, $2) AS r",
              [second, INVOICE],
            ),
          )
        ).message,
      ).toBe("That invoice is already linked to a win.");
      await ex(
        `INSERT INTO public.cockpit_ecom_invoices(id, status, amount_kwd, usd, day, cockpit_invoice_id) VALUES ('INV_fixture_paid', 'PAID', 600, 2000, '${TODAY}', '${INVOICE}')`,
      );
      const today = await as(
        CSM_A,
        "SELECT public.cockpit_csm_wins_today() AS r",
      );
      const kinds = today.rows.map((r: { kind: string }) => r.kind).sort();
      expect(kinds).toEqual(["accepted_no_agreement", "invoice_paid_untied"]);
      expect(
        today.rows.find(
          (r: { kind: string }) => r.kind === "invoice_paid_untied",
        ).sentence,
      ).toBe("Invoice paid: tie it to the Website");
      expect(
        today.rows.find(
          (r: { kind: string }) => r.kind === "accepted_no_agreement",
        ).sentence,
      ).toBe("Client accepted: send the agreement");
      await propose(CSM_A, up, "whop:pay_acme_free");
      const ceo = await as(CEO, "SELECT public.cockpit_csm_wins_today() AS r");
      expect(ceo.rows.map((r: { kind: string }) => r.kind)).toContain(
        "tie_waiting",
      );
      expect(
        (
          await as(CSM_A, "SELECT public.cockpit_csm_wins_today() AS r")
        ).rows.map((r: { kind: string }) => r.kind),
      ).not.toContain("tie_waiting");
    });
  });

  test("cockpit_wins_v is readable by the read-only user and the service role, leaves out void wins, carries event days", async () => {
    await rolledBack(async () => {
      const up = await log(CSM_A, {
        kind: "upsell_smm",
        proofUrl: PROOF,
        quotedUsd: 900,
      });
      const rv = await log(CSM_A, { kind: "review", proofUrl: PROOF });
      await stage(CSM_A, {
        winId: rv.winId,
        act: "void",
        reason: "Fake review",
      });
      await ex("SET ROLE supabase_read_only_user");
      const viaReadOnly = await db.query<Record<string, unknown>>(
        "SELECT id, kind, stage, offered_on::text, accepted_on, imported FROM public.cockpit_wins_v",
      );
      await ex("RESET ROLE");
      expect(viaReadOnly.rows).toEqual([
        {
          id: up.winId,
          kind: "upsell_smm",
          stage: "quote_given",
          offered_on: TODAY,
          accepted_on: null,
          imported: false,
        },
      ]);
      const viaService = await as(
        "service",
        "SELECT count(*)::int AS r FROM public.cockpit_wins_v",
      );
      expect(viaService).toBe(1);
      for (const role of ["anon", "authenticated"])
        expect(
          await one<boolean>(
            `SELECT has_table_privilege('${role}', 'public.cockpit_wins_v', 'SELECT') AS r`,
          ),
        ).toBe(false);
    });
  });
});
