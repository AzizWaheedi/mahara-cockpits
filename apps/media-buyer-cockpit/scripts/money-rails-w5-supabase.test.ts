/**
 * The money rails, waves 5 and 6 (supabase/migrations/20261102g_money_rails_w5.sql;
 * docs/forms/WAVE56-CONTRACT.md 2.1 to 2.3, 3.3 g, 3.4, 3.5, 3.9, 3.10, 4.1, 4.4 to 4.6 and the
 * money-rails row of section 8) on one isolated PostgreSQL with Supabase's default privileges on,
 * so a missing REVOKE opens a function here as it would in production.
 *
 * The ground is forms-editor-supabase.test.ts's, copied (the waves 1-2 chain, 20261101l to r, the
 * billing sheet, the churn register, the CSM read models and finance), then the real waves 3-4
 * files 20261102a to f in order, then 20261102g twice. The CEO's address is read from the CEO gate
 * migration; every other person, client, key and value is invented. Nothing here reaches ClickUp,
 * Slack, Make, the VPS or the live database.
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
import { readdirSync } from "node:fs";
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


// --- Waves 3-4, then the file under test --------------------------------------------------------

const R = "20261101r_readers_read_only_grant.sql";
const W34 = [
  "20261102a_forms_invites.sql",
  "20261102b_client_lifecycle.sql",
  "20261102c_client_voice.sql",
  "20261102d_forms_editor.sql",
  "20261102e_record_make_answer_size.sql",
  "20261102f_form_responses_answer_size.sql",
] as const;
const G_FILE = "20261102g_money_rails_w5.sql";
const G = () => withoutCron(migration(G_FILE));

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
  for (const file of W34) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await db.exec(G());
}, 600_000);
afterAll(async () => {
  await db?.close();
});

// --- Helpers for this file ---------------------------------------------------------------------

const json = (v: unknown) => JSON.stringify(v);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const KEY = `mak_${"A".repeat(20)}${"b".repeat(23)}`;
const KEY2 = `mak_${"C".repeat(43)}`;
const today = async () => one<string>("SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS r");
const setting = (key: string, value: unknown) =>
  q("INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ($1, $2::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, json(value)]);
const merge = (key: string, value: unknown) =>
  q("UPDATE public.cockpit_settings SET value = value || $2::jsonb WHERE key = $1", [key, json(value)]);
const md5Of = (fn: string) =>
  one<string>("SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure($1)", [fn]);
/** The file's first DO block, the drift guard, to run on its own inside a rolled-back test. */
const driftGuard = () => {
  const sql = migration(G_FILE);
  const start = sql.indexOf("DO $$");
  const end = sql.indexOf("END $$;", start);
  return sql.slice(start, end + "END $$;".length);
};

/** A billing event as a seat's act would insert it (the owner, as the RPCs do). */
async function event(kind: string, source: string, detail: Record<string, unknown>, from: string | null = null, to: string | null = null, task = A) {
  return one<number>(
    `INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
     VALUES ($1, 'Acme Interiors', $2, $3, $4, NULL, $5::jsonb, $6, 'tester@tests.invalid') RETURNING id AS r`,
    [task, kind, from, to, json(detail), source],
  );
}
const queued = (eventId: number) =>
  one<Row | null>("SELECT q.payload AS r FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || $1::text", [eventId]).then(r => r ?? null);

// --- LTV fixture ---------------------------------------------------------------------------------

/** Five cards: Ardon-like (a checked +2,000 and the same unchecked), a jump over the cap, one the card already shows, one without a baseline, one stopped. */
async function ltvFixture(opts: { stale?: boolean; noCheckedKey?: boolean } = {}) {
  await q("UPDATE public.cockpit_manual_payment_state SET history_ready = true, totals_revision = revision WHERE id");
  const day = await today();
  for (const [task, name, stage, ltv] of [
    ["ardon01", "Ardon Test", "Active", 2000],
    ["big0001", "Big Jump Test", "Active", 1000],
    ["same001", "Same Test", "Active", 500],
    ["nobase1", "No Base Test", "Onboarding Booked", 800],
    ["stop001", "Stopped Test", "Stopped", 900],
  ] as const)
    await q(
      `INSERT INTO public.cockpit_client_billing_days(day, clickup_task_id, client_name, stage, ltv_usd, captured_at)
       VALUES ($1::date, $2, $3, $4, $5, now() - interval '1 hour')`,
      [day, task, name, stage, ltv],
    );
  for (const [task, base] of [["ardon01", 2000], ["big0001", 1000], ["same001", 500], ["stop001", 900]] as const)
    await q("INSERT INTO public.cockpit_metric_days(day, metric, scope, value) VALUES ('2026-10-01', 'money.ltv.card', $1, $2)", [`client:${task}`, base]);
  const tx = [
    { direction: "in", clientTaskId: "ardon01", day: "2026-10-20", usd: 2000, checked: true },
    { direction: "in", clientTaskId: "ardon01", day: "2026-10-22", usd: 2000, checked: false },
    { direction: "in", clientTaskId: "ardon01", day: "2026-09-20", usd: 999, checked: true }, // before the baseline
    { direction: "out", clientTaskId: "ardon01", day: "2026-10-21", usd: 50, checked: true },
    { direction: "in", clientTaskId: "big0001", day: "2026-10-25", usd: 6000, checked: true },
    ...(opts.noCheckedKey ? [{ direction: "in", clientTaskId: "same001", day: "2026-10-26", usd: 10 }] : []),
  ];
  await q(
    `INSERT INTO public.cockpit_sections(key, label, ok, computed_at, payload) VALUES ('money', 'Money', true,
       now() - $1::interval, $2::jsonb) ON CONFLICT (key) DO UPDATE SET computed_at = EXCLUDED.computed_at, payload = EXCLUDED.payload, ok = true`,
    [opts.stale ? "25 hours" : "1 hour", json({ attribution: { transactions: tx } })],
  );
}
const plan = async () => {
  const rows = await q<Row>("SELECT * FROM public.cockpit_ltv_plan((now() AT TIME ZONE 'Asia/Kuwait')::date)");
  return Object.fromEntries(rows.map(r => [r.task_id, r]));
};
const ltvEvents = (task?: string) =>
  q<Row>("SELECT * FROM public.cockpit_billing_events WHERE kind = 'ltv' AND ($1::text IS NULL OR clickup_task_id = $1) ORDER BY id", [task ?? null]);

// --- The file itself -----------------------------------------------------------------------------

describe("20261102g applies, twice, and is dark at deploy", () => {
  test("a second apply changes no function body and keeps every seed", async () => {
    const fns = ["public.cockpit_billing_detail(text,jsonb)", "public.cockpit_ltv_plan(date)", "public.cockpit_billing_agent_write(text,text,jsonb,uuid)"];
    const before = await Promise.all(fns.map(md5Of));
    const settingsBefore = await q("SELECT key, value FROM public.cockpit_settings WHERE key IN ('billing.ltv','billing.confirm_date','billing.agent','forms.doors') ORDER BY key");
    await db.exec(G());
    expect(await Promise.all(fns.map(md5Of))).toEqual(before);
    expect(await q("SELECT key, value FROM public.cockpit_settings WHERE key IN ('billing.ltv','billing.confirm_date','billing.agent','forms.doors') ORDER BY key")).toEqual(settingsBefore);
  });

  test("every writer starts off: settings, door markers, notice rows, no agent key", async () => {
    const s = Object.fromEntries((await q<Row>("SELECT key, value FROM public.cockpit_settings WHERE key IN ('billing.ltv','billing.confirm_date','billing.agent','forms.doors')")).map(r => [r.key, r.value]));
    expect(s["billing.ltv"]).toEqual({ on: false, maxDeltaUsd: 5000 });
    expect(s["billing.confirm_date"]).toEqual({ on: false, windowDays: 7 });
    expect(s["billing.agent"]).toEqual({ separated: false });
    expect(s["forms.doors"]).toMatchObject({ agent: false, ltv: false, wins: false, receipts: false, reactivate: false });
    expect(await q("SELECT kind, enabled, channel FROM public.cockpit_slack_notice_settings WHERE kind IN ('win.logged','receipt.in','client.reactivated') ORDER BY kind")).toEqual([
      { kind: "client.reactivated", enabled: false, channel: "C09SNG5BP53" },
      { kind: "receipt.in", enabled: false, channel: "C09RZ0GS0V9" },
      { kind: "win.logged", enabled: false, channel: "C09SNG5BP53" },
    ]);
    expect(await one("SELECT count(*)::int AS r FROM public.cockpit_agent_keys")).toBe(0);
  });

  test("a re-apply after the go-lives leaves forms.doors.wins, billing.ltv.on and billing.confirm_date.on true", async () => {
    await rolledBack(async () => {
      await merge("forms.doors", { wins: true, ltv: true });
      await merge("billing.ltv", { on: true, maxDeltaUsd: 7000 });
      await merge("billing.confirm_date", { on: true });
      await merge("billing.agent", { separated: true });
      const sql = G().replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
      await db.exec(sql);
      const s = Object.fromEntries((await q<Row>("SELECT key, value FROM public.cockpit_settings WHERE key IN ('billing.ltv','billing.confirm_date','billing.agent','forms.doors')")).map(r => [r.key, r.value]));
      expect(s["forms.doors"].wins).toBe(true);
      expect(s["forms.doors"].ltv).toBe(true);
      expect(s["forms.doors"].agent).toBe(false);
      expect(s["billing.ltv"]).toEqual({ on: true, maxDeltaUsd: 7000 });
      expect(s["billing.confirm_date"].on).toBe(true);
      expect(s["billing.agent"].separated).toBe(true);
    });
  });

  test("a missing key is merged in while the existing keys win", async () => {
    await rolledBack(async () => {
      await setting("forms.doors", { churn: true, wins: true });
      await setting("billing.ltv", { on: true });
      await db.exec(G().replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
      const doors = await one<Row>("SELECT value AS r FROM public.cockpit_settings WHERE key = 'forms.doors'");
      expect(doors).toEqual({ churn: true, wins: true, agent: false, ltv: false, receipts: false, reactivate: false });
      expect(await one("SELECT value AS r FROM public.cockpit_settings WHERE key = 'billing.ltv'")).toEqual({ on: true, maxDeltaUsd: 5000 });
    });
  });

  test("the drift guard refuses a replaced function whose body changed since the contract read it", async () => {
    await rolledBack(async () => {
      await q("CREATE OR REPLACE FUNCTION public.cockpit_billing_canary(p_kind text, p_args jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$");
      const r = await refusal(() => db.exec(driftGuard()));
      expect(r.code).toBe("55000");
      expect(r.message).toBe("cockpit_billing_canary(text,jsonb) changed since the waves 5-6 contract read it; stop and re-read it.");
    });
    // The applied file's own bodies pass it (the second apply above ran it too).
    await db.exec(driftGuard());
  });

  test("tables: row security, no browser grant, no delete; the agent tables refuse delete and truncate", async () => {
    for (const t of ["cockpit_ltv_held", "cockpit_agent_keys", "cockpit_agent_calls"]) {
      expect(await one("SELECT relrowsecurity AS r FROM pg_class WHERE oid = $1::regclass", [`public.${t}`])).toBe(true);
      for (const role of ["anon", "authenticated"])
        expect(await one("SELECT has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT') AS r", [role, `public.${t}`])).toBe(false);
      expect(await one("SELECT has_table_privilege('service_role', $1, 'DELETE') AS r", [`public.${t}`])).toBe(false);
    }
    await rolledBack(async () => {
      await q("SELECT public.cockpit_agent_key_put_owner('billing_agent', $1, 'test', 'the tech lead')", [sha(KEY)]);
      await refusal(() => q("DELETE FROM public.cockpit_agent_keys"));
      await refusal(() => q("TRUNCATE public.cockpit_agent_calls"));
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_agent_keys")).toBe(1);
    });
  });

  test("grants: browser RPCs to signed-in seats, the door to the service key only, helpers to nobody", async () => {
    const can = (role: string, fn: string) => one<boolean>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS r", [role, fn]);
    for (const fn of ["public.cockpit_ltv_read()", "public.cockpit_ltv_release(text,numeric,text)", "public.cockpit_agent_keys_read()",
      "public.cockpit_agent_key_revoke(bigint,text)", "public.cockpit_billing_confirm_date_preview(text,jsonb)", "public.cockpit_form_doors()",
      "public.cockpit_billing_balance_write(text,jsonb)", "public.cockpit_billing_balances_read()", "public.cockpit_slack_notice_read(text)"]) {
      expect(await can("authenticated", fn)).toBe(true);
      expect(await can("anon", fn)).toBe(false);
    }
    for (const fn of ["public.cockpit_billing_agent_write(text,text,jsonb,uuid)", "public.cockpit_billing_agent_read(text,text,jsonb)",
      "public.cockpit_slack_notice_inputs(jsonb)", "public.cockpit_slack_notice_doctor_inputs()"]) {
      expect(await can("service_role", fn)).toBe(true);
      expect(await can("authenticated", fn)).toBe(false);
      expect(await can("anon", fn)).toBe(false);
    }
    for (const fn of ["public.cockpit_ltv_plan(date)", "public.cockpit_ltv_daily_step(date)", "public.cockpit_ltv_refusal()",
      "public.cockpit_agent_key_put_owner(text,text,text,text)", "public.cockpit_billing_confirm_date_apply(public.cockpit_billing_confirmations,jsonb,text,text,text)",
      "public.cockpit_billing_writeback_writes(text,text,text,jsonb)", "public.cockpit_billing_canary(text,jsonb)", "public.cockpit_billing_daily_run(date)"])
      for (const role of ["anon", "authenticated", "service_role"]) expect(await can(role, fn)).toBe(false);
  });
});

// --- Notices (3.9) -------------------------------------------------------------------------------

describe("three notice kinds", () => {
  test("they post top level, read as their labels and are in every list", async () => {
    for (const [kind, label] of [["win.logged", "Win logged"], ["receipt.in", "Receipt in"], ["client.reactivated", "Client is back"]]) {
      expect(await one("SELECT public.cockpit_slack_notice_shape($1) AS r", [kind])).toBe("post");
      expect(await one("SELECT public.cockpit_slack_notice_kind_label($1) AS r", [kind])).toBe(label);
    }
    const doctor = await as<Row>("service", "SELECT public.cockpit_slack_notice_doctor_inputs() AS r");
    expect(doctor.settings.map((s: Row) => s.kind).slice(-3)).toEqual(["win.logged", "receipt.in", "client.reactivated"]);
    const read = await as<Row>(CEO, "SELECT public.cockpit_slack_notice_settings_read() AS r");
    expect(read.notices.map((n: Row) => n.kind).slice(-3)).toEqual(["win.logged", "receipt.in", "client.reactivated"]);
    expect(read.notices.find((n: Row) => n.kind === "receipt.in")).toMatchObject({ on: false, shape: "post" });
  });

  test("Win logged waits for Log a win; the other two switch on as any notice", async () => {
    await rolledBack(async () => {
      const r = await refusal(() => as(CEO, "SELECT public.cockpit_slack_notice_settings_set('win.logged', '{\"on\":true}'::jsonb) AS r"));
      expect(r.message).toBe("Win logged stays off until Log a win is switched on, because the old Four Rs posts still run in #csm-announcements.");
      await q("UPDATE public.cockpit_slack_channels SET state = 'ok' WHERE id IN ('C09SNG5BP53', 'C09RZ0GS0V9')");
      await as(CEO, "SELECT public.cockpit_slack_notice_settings_set('receipt.in', '{\"on\":true}'::jsonb) AS r");
      await merge("forms.doors", { wins: true });
      await as(CEO, "SELECT public.cockpit_slack_notice_settings_set('win.logged', '{\"on\":true}'::jsonb) AS r");
      expect(await q("SELECT kind, enabled FROM public.cockpit_slack_notice_settings WHERE kind IN ('win.logged','receipt.in') ORDER BY kind")).toEqual([
        { kind: "receipt.in", enabled: true }, { kind: "win.logged", enabled: true }]);
    });
  });

  test("the live rules: a voided win, a gone receipt and a voided return are not posted", async () => {
    await rolledBack(async () => {
      const live = (kind: string, facts: Row) =>
        as<Row>("service", "SELECT (public.cockpit_slack_notice_inputs($1::jsonb))->'live' AS r", [json({ kind, taskId: A, facts })]);
      expect(await live("win.logged", { winId: "00000000-0000-4000-8000-00000000aaaa" })).toEqual({ stillTrue: false, why: "The win is no longer in the cockpit." });
      expect(await live("receipt.in", { responseId: "00000000-0000-4000-8000-00000000bbbb" })).toEqual({ stillTrue: false, why: "The receipt is no longer in the cockpit." });
      const ev = await event("reactivate", "csm", { status: "Active", return_on: "2026-11-02", seat_role: "csm" }, "Stopped", "Active");
      expect(await live("client.reactivated", { eventId: String(ev) })).toEqual({ stillTrue: true, why: null });
      await q("INSERT INTO public.cockpit_billing_event_voids(event_id, voided_by, reason) VALUES ($1, 'tester@tests.invalid', 'a test void')", [ev]);
      expect(await live("client.reactivated", { eventId: String(ev) })).toEqual({ stillTrue: false, why: "The return was voided before the notice went out." });
      // With the wins ledger (20261102h) in place, a live win is news and a voided one is not.
      await q("CREATE TABLE public.cockpit_csm_wins(id uuid PRIMARY KEY, stage text NOT NULL)");
      await q("INSERT INTO public.cockpit_csm_wins VALUES ('00000000-0000-4000-8000-00000000aaaa', 'logged'), ('00000000-0000-4000-8000-00000000cccc', 'void')");
      expect(await live("win.logged", { winId: "00000000-0000-4000-8000-00000000aaaa" })).toEqual({ stillTrue: true, why: null });
      expect(await live("win.logged", { winId: "00000000-0000-4000-8000-00000000cccc" })).toEqual({ stillTrue: false, why: "The win was voided before the notice went out." });
    });
  });

  test("finance and the CSM see the three on the client page; a creative-only seat never does", async () => {
    await rolledBack(async () => {
      for (const kind of ["win.logged", "receipt.in", "client.reactivated"])
        await q("INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, client_name, facts) VALUES ($1, $1 || ':t', $2, 'Acme Interiors', '{}'::jsonb)", [kind, A]);
      const kinds = async (who: string) => ((await as<Row>(who, "SELECT public.cockpit_slack_notice_read($1) AS r", [A])).notices as Row[]).map(n => n.kind).sort();
      expect(await kinds(FINANCE)).toEqual(["client.reactivated", "receipt.in", "win.logged"]);
      expect(await kinds(CSM_A)).toEqual(["client.reactivated", "receipt.in", "win.logged"]);
      expect(await kinds(CREATIVE)).toEqual([]);
    });
  });
});

// --- Billing kinds win and reactivate (3.5) --------------------------------------------------------

describe("billing kinds win and reactivate", () => {
  const winDetail = (over: Row = {}) => ({
    seatRole: "csm", winId: "00000000-0000-4000-8000-0000000000aa", kind: "review", stage: "logged", wonOn: "2026-11-01",
    proofUrl: "https://g.page/r/review-link", ...over,
  });
  test("the trigger queues a seat's win and reactivate; a system pause and the agent's chase are still never queued", async () => {
    await rolledBack(async () => {
      const win = await event("win", "csm", await one("SELECT public.cockpit_billing_detail('win', $1::jsonb) AS r", [json(winDetail())]));
      const p = await queued(win);
      expect(p?.writes).toEqual([]);
      expect(p?.comment).toBe("WIN: Google review on 2026-11-01\nStage: Logged\nProof: https://g.page/r/review-link\nBy: the CSM");
      const back = await event("reactivate", "ceo", await one("SELECT public.cockpit_billing_detail('reactivate', $1::jsonb) AS r", [json({
        seatRole: "ceo", returnOn: "2026-11-02", status: "Onboarding Booked", departureId: 4, leftOn: "2026-10-12",
        reasonWas: "Non-payment 14+ days", typeWas: "Mid-programme loss (counts as churn)", nextDate: "2026-11-20",
        why: "They paid the overdue invoice and asked to restart." })]), "Stopped", "Onboarding Booked");
      const r = await queued(back);
      expect(r?.writes).toEqual([
        { field: "status", value: "Onboarding Booked", old: "Stopped" },
        { field: "churnDate", value: null }, { field: "churnReason", value: null }, { field: "churnType", value: null },
        { field: "pausedOn", value: null }, { field: "resumeOn", value: null },
        { field: "nextDate", value: "2026-11-20" },
      ]);
      expect(r?.comment).toBe([
        "REACTIVATED 2026-11-02", "Back as: Onboarding Booked",
        "Churned 2026-10-12: Non-payment 14+ days (Mid-programme loss (counts as churn))",
        "Why they came back: They paid the overdue invoice and asked to restart.", "By: the CEO"].join("\n"));
      expect(r?.comment).not.toContain("@");
      expect(await queued(await event("pause", "system", { on: "2026-11-02" }))).toBeNull();
      expect(await queued(await event("chase", "maher", {}))).toBeNull();
    });
  });

  test("an upsell's stages read in the comment; the detail refuses what is not a win", async () => {
    const c = (d: Row) => one<string>("SELECT public.cockpit_billing_writeback_comment('win', NULL, NULL, public.cockpit_billing_detail('win', $1::jsonb), 'Acme') AS r", [json(d)]);
    expect(await c(winDetail({ kind: "upsell_website", stage: "quote_given", quotedUsd: 1500, proofUrl: null }))).toBe(
      "WIN: Website on 2026-11-01\nStage: Offered at $1,500\nProof: on file in the cockpit\nBy: the CSM");
    expect(await c(winDetail({ kind: "upsell_smm", stage: "signed", agreementUrl: "https://docs.example/agreement", proofUrl: null }))).toBe(
      "WIN: Social media management on 2026-11-01\nStage: Accepted\nProof: https://docs.example/agreement\nBy: the CSM");
    expect((await refusal(() => c(winDetail({ kind: "lead" }))))).toMatchObject({ code: "22023", message: "That is not a kind of win." });
    expect((await refusal(() => q("SELECT public.cockpit_billing_detail('reactivate', $1::jsonb)", [json({ status: "Active", returnOn: "2026-11-02", why: "short" })])))).toMatchObject({ message: "Say why they came back in 10 to 500 characters." });
    expect((await refusal(() => q("SELECT public.cockpit_billing_detail('reactivate', $1::jsonb)", [json({ status: "Paused", returnOn: "2026-11-02", why: "a long enough reason" })])))).toMatchObject({ message: "A returning client comes back as Active or Onboarding Booked." });
  });

  test("the mrr comment and detail label the two system categories", async () => {
    const d = await one<Row>("SELECT public.cockpit_billing_detail('mrr', $1::jsonb) AS r", [json({ seatRole: "csm", to: "1800", reasonCat: "new_client", reason: "Kickoff: New MRR answer", effective: "2026-11-02" })]);
    expect(d.reason_label).toBe("New client");
    expect(await one("SELECT public.cockpit_billing_writeback_comment('mrr', NULL, '1800', $1::jsonb, 'Acme') AS r", [json(d)])).toBe(
      "MRR none → $1,800 from 2026-11-02\nWhy: New client: Kickoff: New MRR answer\nBy: the CSM");
    expect(await one("SELECT public.cockpit_billing_writeback_comment('mrr', '1000', '1200', $1::jsonb, 'Acme') AS r", [json({ reason_cat: "reactivation", reason: "Reactivated: paid up", seat_role: "ceo" })])).toBe(
      "MRR $1,000 → $1,200\nWhy: Reactivation: Reactivated: paid up\nBy: the CEO");
    // Every other category reads as before.
    expect(await one("SELECT public.cockpit_billing_writeback_comment('mrr', '1000', '1200', $1::jsonb, 'Acme') AS r", [json({ reason_cat: "upsell", seat_role: "ceo" })])).toBe(
      "MRR $1,000 → $1,200\nWhy: upsell\nBy: the CEO");
  });

  test("the canary takes ltv, win, reactivate and date on the test card only", async () => {
    await rolledBack(async () => {
      const id = await one<number>("SELECT public.cockpit_billing_canary('reactivate', $1::jsonb) AS r", [json({ status: "Active", returnOn: "2026-11-02", why: "Canary on the test card" })]);
      expect(await one("SELECT to_value AS r FROM public.cockpit_billing_events WHERE id = $1", [id])).toBe("Active");
      expect(await one("SELECT from_value AS r FROM public.cockpit_billing_events WHERE id = $1", [id])).toBe("Stopped");
      expect(await one<number>("SELECT public.cockpit_billing_canary('ltv', $1::jsonb) AS r", [json({ system: true, to: "4021.2" })])).toBeGreaterThan(0);
      expect(await one<number>("SELECT public.cockpit_billing_canary('win', $1::jsonb) AS r", [json(winDetail())])).toBeGreaterThan(0);
      expect((await refusal(() => q("SELECT public.cockpit_billing_canary('ltv', $1::jsonb)", [json({ to: "10" })]))).message).toBe("An LTV event comes from the cockpit itself: send system true.");
      expect((await refusal(() => q("SELECT public.cockpit_billing_canary('win', $1::jsonb)", [json({ ...winDetail(), taskId: A })]))).message).toBe("The canary writes only the test card 86eywg1cq.");
    });
  });
});

// --- One LTV writer (4.4) -------------------------------------------------------------------------

describe("the LTV plan and the morning writer", () => {
  test("the plan is the preview's rule over checked money only", async () => {
    await rolledBack(async () => {
      await ltvFixture();
      const p = await plan();
      expect(p.ardon01).toMatchObject({ state: "write", checked_usd: "2000.00", rows: 1, target: "4000.00", delta: "2000.00", why: null });
      expect(p.big0001).toMatchObject({ state: "held", target: "7000.00", delta: "6000.00", why: "Over the $5,000 cap: waits for the CEO." });
      expect(p.same001).toMatchObject({ state: "same", checked_usd: "0.00" });
      expect(p.nobase1).toMatchObject({ state: "missing", why: "No starting value on record for this card." });
      expect(p.stop001).toMatchObject({ state: "out_of_scope" });
      // The preview (ltv.preview, unchanged) counts the unchecked +2,000 too: the plan leaves it out.
      const preview = await as<Row>(CEO, "SELECT public.cockpit_ceo_action('ltv.preview', '{}'::jsonb) AS r");
      expect(preview.rows.find((r: Row) => r.clickupTaskId === "ardon01").target).toBe(6000);
    });
  });

  test("a stale money section, or a tied payment without its check state, refuses the whole run", async () => {
    await rolledBack(async () => {
      await ltvFixture({ stale: true });
      const p = await plan();
      expect(p.ardon01).toMatchObject({ state: "missing", target: null, why: "Money attribution is missing or stale; refresh it before lifetime value." });
    });
    await rolledBack(async () => {
      await ltvFixture({ noCheckedKey: true });
      expect(await one("SELECT public.cockpit_ltv_refusal() AS r")).toBe("The money section has payments without their check state; refresh Money before LTV is written.");
      await merge("billing.ltv", { on: true });
      await setting("billing.daily", { on: true });
      const run = await one<Row>("SELECT public.cockpit_billing_daily_run(NULL) AS r");
      expect(run.ltv.refused).toBe("The money section has payments without their check state; refresh Money before LTV is written.");
      expect(await ltvEvents()).toHaveLength(0);
    });
  });

  test("off writes nothing; on writes, holds the jump, skips what is on its way and is idempotent", async () => {
    await rolledBack(async () => {
      await ltvFixture();
      await setting("billing.daily", { on: true });
      const off = await one<Row>("SELECT public.cockpit_billing_daily_run(NULL) AS r");
      expect(off.ltv).toEqual({ ran: false, why: "billing.ltv is off" });
      expect(await one("SELECT note AS r FROM public.cockpit_sync_state WHERE key = 'billing-daily'")).not.toContain("LTV");
      expect(await ltvEvents()).toHaveLength(0);

      await merge("billing.ltv", { on: true });
      const on = await one<Row>("SELECT public.cockpit_billing_daily_run(NULL) AS r");
      expect(on.ltv).toMatchObject({ ran: true, written: 1, held: 1, missing: 1, waiting: 0 });
      expect(await one("SELECT note AS r FROM public.cockpit_sync_state WHERE key = 'billing-daily'")).toContain("LTV: 1 written, 1 held for the CEO, 1 missing a baseline.");
      const [e] = await ltvEvents("ardon01");
      expect(e).toMatchObject({ source: "system", from_value: "2000", to_value: "4000" });
      expect(e.detail).toMatchObject({ sum: 2000, rows: 1, baseline: 2000, baseline_day: "2026-10-01", checked_usd: 2000, seat_role: "system" });
      expect((await queued(e.id))?.writes).toEqual([{ field: "ltv", value: 4000 }]);
      expect(await q("SELECT task_id, target, delta FROM public.cockpit_ltv_held WHERE released_at IS NULL")).toEqual([{ task_id: "big0001", target: "7000.00", delta: "6000.00" }]);
      expect(await ltvEvents("big0001")).toHaveLength(0);

      // A second run the same day: the item is on its way, so nothing is written again.
      const again = await one<Row>("SELECT public.cockpit_billing_daily_run(NULL) AS r");
      expect(again.ltv).toMatchObject({ written: 0, held: 1, waiting: 1 });
      expect(await ltvEvents()).toHaveLength(1);
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_ltv_held")).toBe(1);
      // Delivered, but the mirror has not read the card since: still nothing.
      await q("UPDATE public.cockpit_clickup_writeback_queue SET state = 'delivered' WHERE dedupe_key = 'billing:' || $1::text", [e.id]);
      expect((await one<Row>("SELECT public.cockpit_billing_daily_run(NULL) AS r")).ltv.written).toBe(0);
      expect(await ltvEvents()).toHaveLength(1);
    });
  });

  test("an error in the LTV step is written down and never undoes the rest of the daily run", async () => {
    await rolledBack(async () => {
      await ltvFixture();
      // A malformed money payload: a transaction day that is not a date.
      await q(`UPDATE public.cockpit_sections SET payload = jsonb_set(payload, '{attribution,transactions}',
                 (payload->'attribution'->'transactions') || '[{"direction":"in","clientTaskId":"ardon01","day":"not-a-day","usd":5,"checked":true}]'::jsonb)
               WHERE key = 'money'`);
      await merge("billing.ltv", { on: true });
      await setting("billing.daily", { on: true });
      const run = await one<Row>("SELECT public.cockpit_billing_daily_run(NULL) AS r");
      expect(run.ran).toBe(true);
      expect(run.ltv).toMatchObject({ ran: false, note: "LTV: not written (error)." });
      expect(typeof run.ltv.error).toBe("string");
      const daily = await one<Row>("SELECT to_jsonb(s.*) AS r FROM public.cockpit_sync_state s WHERE key = 'billing-daily'");
      expect(daily.ok).toBe(true);
      expect(daily.note).toContain("LTV: not written (error).");
      const ltv = await one<Row>("SELECT to_jsonb(s.*) AS r FROM public.cockpit_sync_state s WHERE key = 'billing-ltv'");
      expect(ltv.ok).toBe(false);
      expect(ltv.note).toContain("LTV: not written (error).");
      expect(await ltvEvents()).toHaveLength(0);
    });
  });

  test("the CEO releases a held jump at the amount he read; it can be held again later", async () => {
    await rolledBack(async () => {
      await ltvFixture();
      await setting("billing.daily", { on: true });
      await merge("billing.ltv", { on: true });
      await q("SELECT public.cockpit_billing_daily_run(NULL)");
      const read = await as<Row>(CEO, "SELECT public.cockpit_ltv_read() AS r");
      expect(read).toMatchObject({ on: true, maxDeltaUsd: 5000, refused: null, loggedWaiting: 1, writtenToday: 1 });
      expect(read.held).toEqual([{ taskId: "big0001", client: null, target: 7000, card: 1000, delta: 6000, heldOn: await today() }]);
      expect((await as<Row>(FINANCE, "SELECT public.cockpit_ltv_read() AS r")).held).toHaveLength(1);
      expect((await refusal(() => as(CSM_A, "SELECT public.cockpit_ltv_read() AS r"))).code).toBe("42501");

      expect(await refusal(() => as(FINANCE, "SELECT public.cockpit_ltv_release('big0001', 7000, NULL) AS r"))).toEqual({ code: "42501", message: "Only the CEO releases a lifetime value jump." });
      expect((await refusal(() => as(CEO, "SELECT public.cockpit_ltv_release('big0001', 6999, NULL) AS r"))).message).toBe("The amount changed since you looked. Reload it.");
      expect((await refusal(() => as(CEO, "SELECT public.cockpit_ltv_release('ardon01', 4000, NULL) AS r"))).message).toBe("There is no held lifetime value for this client.");
      const out = await as<Row>(CEO, "SELECT public.cockpit_ltv_release('big0001', 7000, 'Checked with finance') AS r");
      expect(out.sentence).toBe("Written. It reaches the card within a few minutes.");
      const [ev] = await ltvEvents("big0001");
      expect(ev).toMatchObject({ from_value: "1000", to_value: "7000", source: "system" });
      expect(ev.detail).toMatchObject({ released_by: "the CEO", note: "Checked with finance" });
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_ltv_held WHERE released_at IS NULL")).toBe(0);

      // The card catches up, then a new jump over the cap is held again in a second row.
      await q("UPDATE public.cockpit_clickup_writeback_queue SET state = 'delivered' WHERE payload->>'kind' = 'ltv'");
      await q("UPDATE public.cockpit_client_billing_days SET ltv_usd = 7000, captured_at = now() + interval '1 minute' WHERE clickup_task_id = 'big0001'");
      const money = await one<Row>("SELECT payload AS r FROM public.cockpit_sections WHERE key = 'money'");
      money.attribution.transactions.push({ direction: "in", clientTaskId: "big0001", day: "2026-10-30", usd: 5500, checked: true });
      await q("UPDATE public.cockpit_sections SET payload = $1::jsonb WHERE key = 'money'", [json(money)]);
      await q("SELECT public.cockpit_billing_daily_run(NULL)");
      expect(await q("SELECT target, released_at IS NULL AS open FROM public.cockpit_ltv_held WHERE task_id = 'big0001' ORDER BY id")).toEqual([
        { target: "7000.00", open: false }, { target: "12500.00", open: true }]);
    });
  });
});

// --- Confirm paid moves the next payment date (4.6) ---------------------------------------------

describe("Confirm paid moves the next payment date", () => {
  /** A live later-part confirmation on card A (deal dealA), as cockpit_billing_balance_write inserts it. */
  async function confirmation(partNo = 1) {
    return one<Row>(
      `INSERT INTO public.cockpit_billing_confirmations(clickup_task_id, deal_response_id, part, part_no, amount, currency, usd, rail, paid_on,
         source, confirmed_by, confirmed_by_ceo)
       VALUES ($1, 'dealA', 'later', $2, 2000, 'USD', 2000, 'whop', '2026-11-04', 'csm', 'csm.a@tests.invalid', false)
       RETURNING to_jsonb(cockpit_billing_confirmations.*) AS r`,
      [A, partNo],
    );
  }
  const apply = (conf: Row, args: Row) =>
    one<Row>("SELECT public.cockpit_billing_confirm_date_apply(jsonb_populate_record(NULL::public.cockpit_billing_confirmations, $1::jsonb), $2::jsonb, 'csm', 'csm.a@tests.invalid', 'client-success-cockpit') AS r",
      [json(conf), json(args)]);
  const preview = (args: Row) => as<Row>(CSM_A, "SELECT public.cockpit_billing_confirm_date_preview($1, $2::jsonb) AS r", [A, json(args)]);
  const cardDate = () => one<string>("SELECT next_payment_date::text AS r FROM public.cockpit_billing_accounts WHERE clickup_task_id = $1", [A]);
  const dateEvents = () => q<Row>("SELECT * FROM public.cockpit_billing_events WHERE kind = 'date' AND clickup_task_id = $1 ORDER BY id", [A]);

  test("off moves nothing", async () => {
    await rolledBack(async () => {
      const conf = await confirmation();
      expect(await apply(conf, { dueOn: "2026-11-05" })).toEqual({ on: false, moved: false });
      expect(await cardDate()).toBe("2026-11-05");
    });
  });

  test("a monthly later part due on the card's date moves it a month; the preview said so first; one date write", async () => {
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      await q("UPDATE public.cockpit_billing_accounts SET payment_plan = 'Monthly' WHERE clickup_task_id = $1", [A]);
      const args = { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-04" };
      expect(await preview(args)).toEqual({ on: true, from: "2026-11-05", dateIfConfirmed: "2026-12-05", fromRule: "plus_month", dateWhy: null });
      const out = await apply(await confirmation(), args);
      expect(out).toMatchObject({ moved: true, from: "2026-11-05", to: "2026-12-05", fromRule: "plus_month", sentence: "Confirmed. Next payment 5 Dec." });
      expect(await cardDate()).toBe("2026-12-05");
      const ev = await dateEvents();
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ source: "csm", from_value: "2026-11-05", to_value: "2026-12-05" });
      const p = await queued(ev[0].id);
      expect(p?.writes).toEqual([{ field: "nextDate", value: "2026-12-05", old: "2026-11-05" }]);
      expect(p?.comment).toBe("NEXT PAYMENT 2026-11-05 → 2026-12-05\nBecause: payment 2 of the plan was confirmed paid on 2026-11-04\nBy: the CSM");
      expect(await q("SELECT count(*)::int AS n FROM public.cockpit_clickup_writeback_queue WHERE task_id = $1 AND payload->>'kind' IN ('date','payment')", [A])).toEqual([{ n: 1 }]);
    });
  });

  test("on a split it moves to the next part's due day; a part not due on the card's date does not move", async () => {
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      const split = { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-06", nextPartNo: 2, nextDueOn: "2026-12-01" };
      expect((await preview(split)).dateIfConfirmed).toBe("2026-12-01");
      expect(await apply(await confirmation(), split)).toMatchObject({ moved: true, to: "2026-12-01", fromRule: "next_part" });
      expect(await cardDate()).toBe("2026-12-01");
    });
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      const early = { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-10-01" };
      expect(await preview(early)).toMatchObject({ dateIfConfirmed: null, dateWhy: "Next payment date stays 5 Nov: this payment was not the one due on it." });
      expect(await apply(await confirmation(), early)).toMatchObject({ moved: false, sentence: "Confirmed. Next payment date stays 5 Nov." });
      const none = { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-05" };
      expect((await preview(none)).dateWhy).toBe("Next payment date stays 5 Nov: there is no later payment on this plan. Set it by hand if they continue.");
      expect(await dateEvents()).toHaveLength(0);
      expect(await cardDate()).toBe("2026-11-05");
    });
  });

  test("with a launch day on record the server works the dates out; a crafted next date is refused, never written", async () => {
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      // Launched 5 Oct: part 1 is due 5 Nov (the card's date), part 2 on 5 Dec.
      await q(`INSERT INTO public.cockpit_client_billing_days(day, clickup_task_id, client_name, stage, launch_date, captured_at)
               VALUES ((now() AT TIME ZONE 'Asia/Kuwait')::date, $1, 'Acme Interiors', 'Active', '2026-10-05', now())
               ON CONFLICT DO NOTHING`, [A]);
      await q("UPDATE public.cockpit_client_billing_days SET launch_date = '2026-10-05' WHERE clickup_task_id = $1", [A]);
      const crafted = { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-05", nextPartNo: 2, nextDueOn: "2027-01-04" };
      const p = await preview(crafted);
      expect(p.dateIfConfirmed).toBeNull();
      expect(p.dateWhy).toBe("Next payment date stays 5 Nov: the payment plan changed since this page loaded. Reload the page and confirm again.");
      const conf0 = await confirmation();
      expect((await refusal(() => apply(conf0, crafted))).message).toBe(
        "The payment plan changed since this page loaded. Reload the page and confirm again.");
      expect(await cardDate()).toBe("2026-11-05");
      expect(await dateEvents()).toHaveLength(0);
      // A part the card's date is not for (the browser says part 1 is due 20 Nov) is refused the same way.
      expect((await preview({ part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-20" })).dateWhy).toContain("Reload the page");
      // The real next part moves the date to the server's own day.
      const real = { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-05", nextPartNo: 2, nextDueOn: "2026-12-05" };
      expect((await preview(real)).dateIfConfirmed).toBe("2026-12-05");
      expect(await apply(await confirmation(), real)).toMatchObject({ moved: true, to: "2026-12-05", fromRule: "next_part" });
      expect(await cardDate()).toBe("2026-12-05");
    });
  });

  test("withdraw moves it back only while the card still shows the moved date", async () => {
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      await q("UPDATE public.cockpit_billing_accounts SET payment_plan = 'Monthly' WHERE clickup_task_id = $1", [A]);
      const conf = await confirmation();
      await apply(conf, { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-05" });
      const out = await as<Row>(CEO, "SELECT public.cockpit_billing_balance_write('withdraw', $1::jsonb) AS r", [json({ taskId: A, confirmationId: conf.id, reason: "Paid by the wrong card" })]);
      expect(out.date).toMatchObject({ moved: true, to: "2026-11-05", sentence: "Withdrawn. Next payment back to 5 Nov." });
      expect(await cardDate()).toBe("2026-11-05");
      const [, back] = await dateEvents();
      expect(back.detail).toMatchObject({ from_rule: "withdraw", confirm_id: conf.id });
    });
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      await q("UPDATE public.cockpit_billing_accounts SET payment_plan = 'Monthly' WHERE clickup_task_id = $1", [A]);
      const conf = await confirmation();
      await apply(conf, { part: "later", partNo: 1, dealResponseId: "dealA", dueOn: "2026-11-05" });
      await q("UPDATE public.cockpit_billing_accounts SET next_payment_date = '2026-12-20' WHERE clickup_task_id = $1", [A]);
      const out = await as<Row>(CEO, "SELECT public.cockpit_billing_balance_write('withdraw', $1::jsonb) AS r", [json({ taskId: A, confirmationId: conf.id, reason: "Paid by the wrong card" })]);
      expect(out.date).toEqual({ moved: false, stays: "2026-12-20", sentence: "Withdrawn. The card's next payment date was changed since; it stays 20 Dec." });
      expect(await dateEvents()).toHaveLength(1);
    });
  });

  test("a confirm through the RPC carries its date answer; Pending payments reads each card's rule", async () => {
    await rolledBack(async () => {
      await merge("billing.confirm_date", { on: true });
      await q("UPDATE public.cockpit_billing_accounts SET stage_group = 'pipeline' WHERE clickup_task_id = $1", [A]);
      const out = await as<Row>(CSM_A, "SELECT public.cockpit_billing_balance_write('confirm', $1::jsonb) AS r", [json({
        taskId: A, rail: "whop", part: "all", amount: 500, currency: "USD", paidOn: await today() })]);
      expect(out.sentence).toBe("Confirmed by you · waiting for Whop");
      expect(out.date).toEqual({ on: true, moved: false, from: "2026-11-05", why: null, sentence: "Confirmed. Next payment date stays 5 Nov." });
      const read = await as<Row>(CSM_A, "SELECT public.cockpit_billing_balances_read() AS r");
      expect(read.cards.find((c: Row) => c.taskId === A).dateIfConfirmed).toEqual({
        on: true, windowDays: 7, cardDate: "2026-11-05", monthlyPlan: false, plusMonth: null, why: null });
    });
  });
});

// --- The agent's door (3.4) ----------------------------------------------------------------------

describe("the billing agent's own login", () => {
  const write = (key: string, op: string, body: Row, rid: string | null = null) =>
    as<Row>("service", "SELECT public.cockpit_billing_agent_write($1, $2, $3::jsonb, $4::uuid) AS r", [sha(key), op, json(body), rid]);
  const read = (key: string, what: string, args: Row = {}) =>
    as<Row>("service", "SELECT public.cockpit_billing_agent_read($1, $2, $3::jsonb) AS r", [sha(key), what, json(args)]);
  const putKey = (key: string) => q("SELECT public.cockpit_agent_key_put_owner('billing_agent', $1, 'VPS skill', 'the tech lead')", [sha(key)]);

  test("no key, an unknown key or a revoked key is refused; the identity is the row's agent", async () => {
    expect(await write(KEY, "chase", { taskId: A, step: "D+3" })).toEqual({ ok: false, outcome: "refused", status: 401, error: "This key is not known." });
    await rolledBack(async () => {
      await putKey(KEY);
      expect(await write(KEY2, "chase", { taskId: A, step: "D+3" })).toMatchObject({ status: 401, error: "This key is not known." });
      expect(await write(KEY, "chase", { taskId: A, step: "D+3", agent: "someone_else" })).toMatchObject({ ok: true, outcome: "ok" });
      const id = await one<number>("SELECT id AS r FROM public.cockpit_agent_keys");
      expect((await refusal(() => as(CSM_A, "SELECT public.cockpit_agent_key_revoke($1, 'leaked') AS r", [id]))).code).toBe("42501");
      expect((await as<Row>(CEO, "SELECT public.cockpit_agent_key_revoke($1, 'Leaked in a log') AS r", [id])).sentence).toBe("Revoked. The agent cannot write until a new key is set on the server.");
      expect(await write(KEY, "chase", { taskId: A, step: "D+3" })).toMatchObject({ ok: false, status: 401, error: "This key was revoked." });
      expect(await q("SELECT outcome FROM public.cockpit_agent_calls ORDER BY id")).toEqual([{ outcome: "ok" }, { outcome: "refused" }]);
      // A new key replaces the old one; only its hash is kept, and no read ever shows it.
      await putKey(KEY2);
      expect(await q("SELECT revoked_reason FROM public.cockpit_agent_keys ORDER BY id")).toEqual([{ revoked_reason: "Leaked in a log" }, { revoked_reason: null }]);
      const keys = await as<Row>(CEO, "SELECT public.cockpit_agent_keys_read() AS r");
      expect(JSON.stringify(keys)).not.toContain(sha(KEY2));
      expect(keys.keys[0]).toMatchObject({ agent: "billing_agent", note: "VPS skill", revokedAt: null, callsToday: 0 });
      const everywhere = await one<string>("SELECT string_agg(coalesce(before::text,'') || after::text || metadata::text, ' ') AS r FROM public.cockpit_audit_log WHERE entity_type IN ('cockpit_agent_keys','cockpit_agent_calls')");
      for (const secret of [KEY, KEY2, sha(KEY), sha(KEY2)]) expect(everywhere).not.toContain(secret);
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_agent_keys WHERE key_sha256 IN ($1, $2)", [KEY, KEY2])).toBe(0);
    });
  });

  test("chase, invoice and note are maher's billing events (never queued); a payment is a logged inbox row", async () => {
    await rolledBack(async () => {
      await putKey(KEY);
      const chase = await write(KEY, "chase", { taskId: A, step: "D+3 reminder", note: "Sent on WhatsApp" });
      const inv = await write(KEY, "invoice", { taskId: A, invoiceNo: "INV-104", amount: 2000, currency: "USD", dueOn: "2026-11-10" });
      const note = await write(KEY, "note", { taskId: A, text: "Client asked for a week." });
      const ev = await q<Row>("SELECT kind, source, by_whom, to_value, reason FROM public.cockpit_billing_events WHERE id = ANY($1::bigint[]) ORDER BY id",
        [[chase.result.eventId, inv.result.eventId, note.result.eventId]]);
      expect(ev).toEqual([
        { kind: "chase", source: "maher", by_whom: "maher", to_value: "D+3 reminder", reason: "Sent on WhatsApp" },
        { kind: "invoice", source: "maher", by_whom: "maher", to_value: "INV-104", reason: null },
        { kind: "note", source: "maher", by_whom: "maher", to_value: null, reason: "Client asked for a week." },
      ]);
      for (const id of [chase.result.eventId, inv.result.eventId, note.result.eventId]) expect(await queued(id)).toBeNull();
      expect(await write(KEY, "payment", { taskId: A, paidOn: await today(), amount: 650, currency: "KWD", method: "bank_transfer", reference: "FT123" })).toEqual({
        ok: false, outcome: "refused", status: 422, error: "A bank transfer needs its receipt link and the bank reference. Without them it counts as unpaid." });
      const pay = await write(KEY, "payment", { taskId: A, paidOn: await today(), amount: 650, currency: "KWD", method: "bank_transfer", reference: "FT123", evidenceUrl: "https://drive.example/receipt" });
      expect(pay.result).toMatchObject({ checkState: "logged", sentence: "Logged. It counts once finance or the CEO checks it." });
      expect(await q("SELECT source, status, check_state, logged_by FROM public.cockpit_billing_inbox WHERE id = $1", [pay.result.inboxId])).toEqual([
        { source: "maher", status: "pending", check_state: "logged", logged_by: "the billing agent" }]);
      expect(await write(KEY, "ltv", { taskId: A, to: 9999 })).toMatchObject({ ok: false, status: 422, error: "The agent writes chase, invoice, payment or note, not ltv." });
      expect(await write(KEY, "chase", { taskId: "notOnSheet", step: "D+1" })).toMatchObject({ error: "That card is not on the billing sheet." });
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_clickup_writeback_queue WHERE payload->>'source' = 'maher'")).toBe(0);
    });
  });

  test("a repeated request id returns the first result and writes a duplicate row with request_id NULL", async () => {
    await rolledBack(async () => {
      await putKey(KEY);
      const rid = "11111111-2222-4333-8444-555555555555";
      const first = await write(KEY, "chase", { taskId: A, step: "D+7" }, rid);
      const second = await write(KEY, "chase", { taskId: A, step: "D+7" }, rid);
      const calls = await q<Row>("SELECT id, request_id, outcome, detail FROM public.cockpit_agent_calls ORDER BY id");
      expect(second).toMatchObject({ ok: true, outcome: "duplicate", result: first.result, firstCallId: calls[0].id });
      expect(calls.map(c => [c.request_id, c.outcome])).toEqual([[rid, "ok"], [null, "duplicate"]]);
      expect(calls[1].detail).toEqual({ firstCallId: calls[0].id });
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_billing_events WHERE kind = 'chase' AND to_value = 'D+7'")).toBe(1);
    });
  });

  test("reads are VOLATILE, each writes exactly one calls row, and chases are the agent's own", async () => {
    for (const fn of ["cockpit_billing_agent_read", "cockpit_billing_agent_write"])
      expect(await one("SELECT provolatile AS r FROM pg_proc WHERE proname = $1", [fn])).toBe("v");
    await rolledBack(async () => {
      await putKey(KEY);
      await write(KEY, "chase", { taskId: A, step: "D+3" });
      await event("chase", "csm", {}, null, "a person's chase");
      await event("chase", "maher", {}, null, null); // an old agent row, before the door
      const before = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_agent_calls");
      const ch = await read(KEY, "chases");
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_agent_calls")).toBe(before + 1);
      expect(ch.result.map((r: Row) => [r.kind, r.step])).toEqual([["chase", "D+3"], ["chase", null]]);
      expect((await read(KEY, "ladder")).result).toEqual({ pauseReviewDay: 4, cancelReviewDay: 15 });
      const acc = await read(KEY, "accounts");
      expect(acc.result.map((r: Row) => r.taskId)).toEqual([A, B]);
      expect(JSON.stringify(acc.result)).not.toContain("@");
      expect((await read(KEY, "inbox")).result).toEqual([]);
      expect(Array.isArray((await read(KEY, "balances")).result)).toBe(true);
      expect(await read(KEY, "secrets")).toMatchObject({ ok: false, status: 422 });
      const rid = "21111111-2222-4333-8444-555555555555";
      await read(KEY, "ladder", { requestId: rid });
      const again = await read(KEY, "ladder", { requestId: rid });
      expect(again).toMatchObject({ ok: true, outcome: "duplicate", result: { pauseReviewDay: 4 } });
      expect(await q("SELECT request_id, outcome FROM public.cockpit_agent_calls ORDER BY id DESC LIMIT 2")).toEqual([
        { request_id: null, outcome: "duplicate" }, { request_id: rid, outcome: "ok" }]);
    });
  });

  test("the 61st call in a minute is limited", async () => {
    await rolledBack(async () => {
      await putKey(KEY);
      for (let i = 0; i < 60; i++) expect((await read(KEY, "ladder")).ok).toBe(true);
      expect(await read(KEY, "ladder")).toEqual({ ok: false, outcome: "limited", status: 429, error: "That is 60 calls in a minute. Wait a minute and try again." });
      expect(await one("SELECT count(*)::int AS r FROM public.cockpit_agent_calls WHERE outcome = 'limited'")).toBe(1);
    });
  });
});

// --- Doors (3.10) --------------------------------------------------------------------------------

describe("cockpit_form_doors", () => {
  test("each new flag is false until its functions and its marker exist, and says why", async () => {
    const d = await as<Row>(CEO, "SELECT public.cockpit_form_doors() AS r");
    expect({ wins: d.wins, receipts: d.receipts, reactivate: d.reactivate, kickoff: d.kickoff, agent: d.agent, ltv: d.ltv }).toEqual({
      wins: false, receipts: false, reactivate: false, kickoff: false, agent: false, ltv: false });
    expect(d.why).toEqual({ wins: "missing", receipts: "missing", reactivate: "missing", kickoff: "missing", agent: "off", ltv: "off" });
    // Every flag that was there keeps its value.
    expect(d).toMatchObject({ invites: true, editor: true });
    await rolledBack(async () => {
      await q("CREATE FUNCTION public.cockpit_csm_win_log(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$");
      expect((await as<Row>(CEO, "SELECT public.cockpit_form_doors() AS r")).why.wins).toBe("off");
      await merge("forms.doors", { wins: true, ltv: true });
      const open = await as<Row>(CEO, "SELECT public.cockpit_form_doors() AS r");
      expect([open.wins, open.ltv, open.why.wins, open.why.ltv]).toEqual([true, true, null, null]);
      await q("CREATE TABLE IF NOT EXISTS public.cockpit_churn_departures_probe(x int)");
      await q("ALTER TABLE public.cockpit_churn_departures ADD COLUMN returned_on date");
      expect((await as<Row>(CEO, "SELECT public.cockpit_form_doors() AS r")).why.reactivate).toBe("off");
    });
  });
});
