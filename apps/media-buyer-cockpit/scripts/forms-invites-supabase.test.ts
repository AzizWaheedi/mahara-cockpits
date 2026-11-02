/**
 * Form invites, the client channel's cockpit side (20261102a_forms_invites.sql;
 * docs/forms/WAVE34-CONTRACT.md 2.2, 2.3, 3.1 to 3.4, 3.6, 3.9, 3.10, 4.1 and
 * the invites-core row of section 8, the review's additions included) on an
 * isolated PostgreSQL with Supabase's default privileges on.
 *
 * It stands on waves 1 and 2 in their deploy order, exactly as
 * forms-w12-chain-supabase.test.ts builds them (20261101l to q), plus 20261101r
 * (with the read-only role), the asks (20261029170000), a cut-down
 * portal_data.workspaces with the live column names, and a gen_random_bytes
 * stand-in for pgcrypto. It then applies 20261102a. pause_consent and the exit
 * survey's version 2 are client-lifecycle's (20261102b); this test stands them
 * in from the shared fixture so every form's path is reached. The CEO's address
 * is read from the CEO gate migration; every other person, client and value is
 * invented. Nothing here reaches a provider.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
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

const A_FILE = "20261102a_forms_invites.sql";
const R_FILE = "20261101r_readers_read_only_grant.sql";
const ASKS = "20261029170000_client_asks.sql";
const FIXTURE = JSON.parse(
  readFileSync(
    new URL("./fixtures/client-form-answers.json", import.meta.url),
    "utf8",
  ),
) as {
  schemas: Record<string, Row>;
  rows: {
    name: string;
    schema: string;
    answers: Row;
    context: Row;
    ok: boolean;
    errors: Row;
    stored?: Row;
  }[];
};

const C = "taskC1"; // Cedar Fitout, Stopped
const D = "taskD1"; // Dune Homes, GHOSTED
const E = "taskE1"; // Elm Studio, SALES TEAM TO CONTACT
const F = "taskF1"; // Fern Interiors, Active, leaving
const TEST_CARD = "86eywg1cq";
const CSM_GENERAL = "C09RZ0GS0V9";
const NPS = "C09TTGBRQ0G";
const ADMIN_P = "owner@acme.invalid"; // the client admin in the portal
const MEMBER_P = "staff@acme.invalid"; // a client member
const NET = "a".repeat(64);
const NET2 = "b".repeat(64);
const BROWSER = "c".repeat(64);

/** The new cards, their portal workspaces, the asks and the stand-ins this file reads. */
async function invitesGround() {
  await db.exec(`
    CREATE ROLE supabase_read_only_user;
    CREATE SCHEMA IF NOT EXISTS extensions;
    GRANT USAGE ON SCHEMA extensions TO service_role, authenticated;
    -- pgcrypto's gen_random_bytes (live in schema extensions, 11.2-m), enough for a 32-byte token.
    CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
      $$ SELECT substring(decode(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'hex') FROM 1 FOR n) $$;
    CREATE SCHEMA portal_data;
    CREATE TABLE portal_data.workspaces(location_id text PRIMARY KEY, clickup_id text, name text NOT NULL, status text NOT NULL,
      language text);
    ALTER TABLE portal_data.workspaces ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON portal_data.workspaces FROM PUBLIC, anon, authenticated;
    INSERT INTO portal_data.workspaces VALUES
      ('locA', '${A}', 'Acme Interiors', 'Active', NULL),
      ('locB', '${B}', 'Beta Build', 'Cancelled', NULL),
      ('locF', '${F}', 'Fern Interiors', 'Active', NULL);
    INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage, client_status, next_payment_date, mrr_usd)
    VALUES ('${C}', 'Cedar Fitout', 'churned', 'Stopped', NULL, 1000),
           ('${D}', 'Dune Homes', 'active', 'GHOSTED', NULL, 1000),
           ('${E}', 'Elm Studio', 'active', 'SALES TEAM TO CONTACT', NULL, 1000),
           ('${F}', 'Fern Interiors', 'active', 'Active', '2026-11-20', 1200);`);
  await db.exec(
    migration("20260926m_cockpit_csm_state.sql").match(
      /CREATE OR REPLACE FUNCTION public\.cockpit_audit_csm_state\(\)[\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(migration(ASKS));
}

/** Waves 3-4's client-lifecycle file seeds these (b); the test stands them in to reach every form. */
async function lifecycleStandIns() {
  await db.query(
    `INSERT INTO cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
     VALUES ('pause_consent', 'Pause consent', 'client', 'native', NULL, 1, $1::jsonb, ARRAY['csm'], true,
             '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"}]'::jsonb, 'test')
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(FIXTURE.schemas.pause_consent)],
  );
  await db.query(
    `INSERT INTO cockpit_form_versions (form_key, version, schema, published_by, note)
     VALUES ('pause_consent', 1, $1::jsonb, 'test', NULL), ('exit_survey', 2, $2::jsonb, 'test', NULL)
     ON CONFLICT DO NOTHING`,
    [
      JSON.stringify(FIXTURE.schemas.pause_consent),
      JSON.stringify({
        ...FIXTURE.schemas.nps,
        key: "exit_survey",
        audience: "admin",
        signer: "typed",
      }),
    ],
  );
}

async function seatsMore() {
  // Cedar, Dune, Elm and Fern join the roster so the CEO's gate path sees them; CSM_A keeps Acme only.
  const snap = "2026-10-28T08:00:00Z";
  for (const [taskId, name] of [
    [C, "Cedar Fitout"],
    [D, "Dune Homes"],
    [E, "Elm Studio"],
    [F, "Fern Interiors"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name, stage: "Active" }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET row_count=6 WHERE table_name='clients'",
  );
  await db.query(
    "UPDATE public.cockpit_members SET name = 'Noura Al-Test' WHERE auth_user_id = $1",
    [CSM_A],
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
  for (const file of CHAIN) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await invitesGround();
  await db.exec(migration(R_FILE));
  await seatsMore();
  try {
    await db.exec(migration(A_FILE));
  } catch (e) {
    throw new Error(`${A_FILE}: ${(e as Error).message}`);
  }
  await lifecycleStandIns();
}, 600_000);
afterAll(async () => {
  await db?.close();
});

const rid = () => crypto.randomUUID();
const kuwaitToday = () =>
  one<string>("SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS r");
const sha = (s: string) =>
  new Bun.CryptoHasher("sha256").update(s).digest("hex");
const tokenOf = (url: string) => url.split("#")[1];

const golive = (key: string, on = true) =>
  one<Row>("SELECT public.cockpit_form_client_go_live($1, $2, 'tests') AS r", [
    key,
    on,
  ]);
const issue = (
  seat: string,
  task: string,
  form: string,
  channels: string[],
  o: {
    note?: string | null;
    lang?: string;
    push?: boolean;
    context?: Row;
    id?: string;
    origin?: string;
  } = {},
) =>
  as<Row>(
    seat,
    "SELECT public.cockpit_form_invite_issue($1,$2,$3::text[],$4,$5,$6,$7::jsonb,$8::uuid,$9) AS r",
    [
      task,
      form,
      channels,
      o.note ?? null,
      o.lang ?? "ar",
      o.push ?? false,
      JSON.stringify(o.context ?? {}),
      o.id ?? rid(),
      o.origin ?? "csm",
    ],
  );
const link = (seat: string, task: string, invite: string) =>
  as<Row>(seat, "SELECT public.cockpit_form_invite_link($1,$2::uuid) AS r", [
    task,
    invite,
  ]);
const withdraw = (
  seat: string,
  task: string,
  invite: string,
  reason = "They asked us to wait",
) =>
  as<Row>(
    seat,
    "SELECT public.cockpit_form_invite_withdraw($1,$2::uuid,$3) AS r",
    [task, invite, reason],
  );
const tokenOpen = (
  token: string,
  net = NET,
  browser: string | null = BROWSER,
) =>
  as<Row>("service", "SELECT public.portal_form_token_open($1,$2,$3) AS r", [
    sha(token),
    net,
    browser,
  ]);
const tokenSubmit = (
  token: string,
  answers: Row,
  signer: string | null = null,
  req = rid(),
  net = NET,
) =>
  as<Row>(
    "service",
    "SELECT public.portal_form_token_submit($1,$2,$3,$4::jsonb,$5,$6::uuid,'ar') AS r",
    [sha(token), net, BROWSER, JSON.stringify(answers), signer, req],
  );
const portalSubmit = (
  invite: string,
  answers: Row,
  o: {
    person?: string;
    role?: string;
    loc?: string;
    task?: string;
    req?: string;
  } = {},
) =>
  as<Row>(
    "service",
    "SELECT public.portal_form_submit($1,$2,$3,$4,$5::uuid,$6::jsonb,$7::uuid,'en') AS r",
    [
      o.loc ?? "locA",
      o.task ?? A,
      o.person ?? ADMIN_P,
      o.role ?? "admin",
      invite,
      JSON.stringify(answers),
      o.req ?? rid(),
    ],
  );
const forPerson = (
  person: string,
  invite: string | null = null,
  role = "admin",
  loc = "locA",
  task = A,
) =>
  as<Row>(
    "service",
    "SELECT public.portal_form_for_person($1,$2,$3,$4,$5::uuid) AS r",
    [loc, task, person, role, invite],
  );
const record = (
  invite: string,
  person: string,
  event: string,
  loc = "locA",
  task = A,
) =>
  as<Row>(
    "service",
    "SELECT public.portal_form_invite_record($1,$2,$3::uuid,$4,$5,'{}'::jsonb) AS r",
    [loc, task, invite, person, event],
  );
/** Moves an invite's clock back, as if days had passed. */
const ageInvite = (invite: string, days: number) =>
  q(
    `UPDATE cockpit_form_invites SET issued_at = issued_at - make_interval(days => $2), expires_at = expires_at - make_interval(days => $2)
      WHERE id = $1::uuid`,
    [invite, days],
  );
const presence = (loc: string, admins: number, members: number, daysAgo = 1) =>
  q(
    `INSERT INTO cockpit_portal_presence(location_id, last_session_at, admins, members, pushed_at)
     VALUES ($1, now() - make_interval(days => $4), $2, $3, now())
     ON CONFLICT (location_id) DO UPDATE SET last_session_at = EXCLUDED.last_session_at, admins = EXCLUDED.admins,
       members = EXCLUDED.members, pushed_at = now()`,
    [loc, admins, members, daysAgo],
  );

const STABLE_READS = [
  ["cockpit_form_invite_view(text)", "STABLE"],
  ["cockpit_form_invites_today()", "STABLE"],
  ["cockpit_form_answer_read(uuid)", "STABLE"],
  ["cockpit_form_client_live_list()", "STABLE"],
  ["portal_form_for_person(text,text,text,text,uuid)", "STABLE"],
  ["portal_form_list(text,text,text,text)", "STABLE"],
  ["portal_form_preview(text,boolean)", "STABLE"],
] as const;
const AUTH_ACL = "{postgres=X/postgres,authenticated=X/postgres}";
const SVC_ACL = "{postgres=X/postgres,service_role=X/postgres}";
const OWNER_ACL = "{postgres=X/postgres}";

describe("the file", () => {
  test("applies a second time and changes no body, grant, CHECK or seed", async () => {
    const snapshot = async () => ({
      fns: await q(
        `SELECT p.oid::regprocedure::text AS f, md5(regexp_replace(p.prosrc,'\\s+',' ','g')) AS m, coalesce(p.proacl::text,'') AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1`,
      ),
      checks: await q(
        `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS d FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
      ),
      seeds: await q(
        `SELECT (SELECT count(*) FROM cockpit_slack_notice_settings)::int AS settings,
                (SELECT count(*) FROM cockpit_forms)::int AS forms, (SELECT count(*) FROM cockpit_form_versions)::int AS versions,
                (SELECT value FROM cockpit_settings WHERE key = 'forms.client') AS client,
                (SELECT value FROM cockpit_settings WHERE key = 'forms.doors') AS doors,
                (SELECT count(*) FROM cockpit_audit_log)::int AS audit`,
      ),
    });
    const before = await snapshot();
    await ex(migration(A_FILE));
    const after = await snapshot();
    expect(after.fns).toEqual(before.fns);
    expect(after.checks).toEqual(before.checks);
    expect(after.seeds).toEqual(before.seeds);
    expect(before.seeds[0].client).toEqual({ live: [], presence: false });
    expect(before.seeds[0].doors.invites).toBe(true);
  });

  test("the drift guard refuses a changed body, and a changed messages guard", async () => {
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_form_doors() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN '{}'::jsonb; END $$",
      );
      const r = await refusal(() => ex(migration(A_FILE)));
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_form_doors() changed since the waves 3-4 contract read it; stop and re-read it.",
      );
    });
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_client_messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
      );
      const r = await refusal(() => ex(migration(A_FILE)));
      expect(r.message).toContain("cockpit_client_messages_guard changed");
    });
  });

  test("every new table has row security, no browser grant, and the invite tables refuse delete", async () => {
    for (const t of [
      "cockpit_form_invites",
      "cockpit_form_invite_events",
      "cockpit_form_invite_tokens",
      "cockpit_form_token_opens",
      "cockpit_portal_presence",
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
            "SELECT has_table_privilege($1, $2, 'SELECT') AS r",
            [role, `public.${t}`],
          ),
        ).toBe(false);
    }
    expect(
      await one<boolean>(
        "SELECT has_table_privilege('service_role', 'public.cockpit_form_invite_events', 'UPDATE') AS r",
      ),
    ).toBe(false);
    expect(
      await one<boolean>(
        "SELECT has_table_privilege('service_role', 'public.cockpit_form_token_opens', 'DELETE') AS r",
      ),
    ).toBe(true);
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CEO, A, "nps", ["portal"]);
      for (const t of ["cockpit_form_invites", "cockpit_form_invite_events"]) {
        const r = await refusal(() => q(`DELETE FROM ${t}`));
        expect(r.message).toBe("Forms records are never deleted");
      }
      await link(CEO, A, v.inviteId);
      expect(
        (await refusal(() => q("DELETE FROM cockpit_form_invite_tokens")))
          .message,
      ).toBe("Forms records are never deleted");
    });
  });

  test("every function keeps its live grant or has exactly 3.3's", async () => {
    const acl = async (fn: string) =>
      one<string>(
        "SELECT coalesce(proacl::text,'') AS r FROM pg_proc WHERE oid = $1::regprocedure",
        [`public.${fn}`],
      );
    for (const fn of [
      "cockpit_form_invite_view(text)",
      "cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text)",
      "cockpit_form_invite_withdraw(text,uuid,text)",
      "cockpit_form_invite_link(text,uuid)",
      "cockpit_form_invites_today()",
      "cockpit_form_answer_read(uuid)",
      "cockpit_form_client_live_list()",
      "cockpit_slack_notice_settings_read()",
      "cockpit_slack_notice_read(text)",
      "cockpit_form_doors()",
    ])
      expect(await acl(fn)).toBe(AUTH_ACL);
    for (const fn of [
      "portal_form_for_person(text,text,text,text,uuid)",
      "portal_form_list(text,text,text,text)",
      "portal_form_get(text,text,text,text,uuid)",
      "portal_form_invite_record(text,text,uuid,text,text,jsonb)",
      "portal_form_submit(text,text,text,text,uuid,jsonb,uuid,text)",
      "portal_form_token_open(text,text,text)",
      "portal_form_token_submit(text,text,text,jsonb,text,uuid,text)",
      "portal_form_preview(text,boolean)",
      "portal_form_invites_push_claim(integer)",
      "portal_form_invite_push_done(uuid,text,text,jsonb)",
      "portal_form_invite_display(text,text,uuid,text,text)",
      "portal_form_presence_put(jsonb)",
      "cockpit_client_message_invite_link(uuid,uuid)",
      "cockpit_client_message_approve(uuid,text,text,uuid,text[])",
      "cockpit_client_message_claim(text[],text[],integer)",
      "cockpit_slack_notice_inputs(jsonb)",
    ])
      expect(await acl(fn)).toBe(SVC_ACL);
    for (const fn of [
      "cockpit_client_text_ok(text)",
      "cockpit_form_schema_check(jsonb)",
      "cockpit_form_answers_check(jsonb,jsonb,jsonb)",
      "cockpit_form_client_live(text)",
      "cockpit_form_client_go_live(text,boolean,text)",
      "cockpit_form_card_allows(text,text)",
      "cockpit_form_client_version(text)",
      "cockpit_form_invite_gate(uuid)",
      "cockpit_form_invites_expire()",
      "cockpit_form_invites_withdraw_ineligible()",
      "cockpit_form_invite_issue_system(text,text,text[],jsonb,text)",
      "cockpit_form_invite_canary(text,jsonb,text[])",
      "cockpit_form_client_submitted(uuid)",
      "cockpit_form_client_issued(uuid)",
      "cockpit_form_client_link_out(uuid)",
      "cockpit_form_token_limited_note(text,text)",
      "cockpit_form_effect_gate(text,text)",
      "cockpit_slack_notice_live(cockpit_slack_notices)",
      "cockpit_client_message_view(cockpit_client_messages)",
    ])
      expect(await acl(fn)).toBe(OWNER_ACL);
    // Every new public function is granted to nobody but the lists above.
    const loose = await q<{ f: string }>(
      `SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (p.proname LIKE 'cockpit_form_invite%' OR p.proname LIKE 'portal_form_%'
              OR p.proname IN ('cockpit_form_token_mint','cockpit_form_store_answer','cockpit_form_token_find'))
          AND has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(loose).toEqual([]);
  });

  test("the volatility list of 3.3: every read is STABLE, the expiry VOLATILE", async () => {
    for (const [fn, want] of STABLE_READS)
      expect(
        await one<string>(
          "SELECT CASE provolatile WHEN 's' THEN 'STABLE' WHEN 'v' THEN 'VOLATILE' ELSE 'IMMUTABLE' END AS r FROM pg_proc WHERE oid = $1::regprocedure",
          [`public.${fn}`],
        ),
      ).toBe(want);
    expect(
      await one<string>(
        "SELECT provolatile::text AS r FROM pg_proc WHERE oid = 'public.cockpit_form_invites_expire()'::regprocedure",
      ),
    ).toBe("v");
  });

  test("the doors open the invites door; the others wait for their files", async () => {
    const d = await as<Row>(CSM_A, "SELECT public.cockpit_form_doors() AS r");
    expect(d.invites).toBe(true);
    expect(d.lifecycle).toBe(false);
    expect(d.voice).toBe(false);
    expect(d.editor).toBe(false);
    expect(d.churnConfirm).toBe(true);
  });
});

describe("schema v1 and the text rule", () => {
  test("the text rule refuses leads, CPL and guarantees in both languages", async () => {
    const rule = (t: string) =>
      one<string | null>("SELECT public.cockpit_client_text_ok($1) AS r", [t]);
    const leads =
      "Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.";
    expect(await rule("We got you 40 leads this month")).toBe(leads);
    expect(await rule("جبنا لكم ليدز وايد")).toBe(leads);
    expect(await rule("Your CPL dropped")).toBe(leads);
    expect(await rule("We guarantee more sales")).toBe(
      "Client forms never promise results. Remove the guarantee wording.",
    );
    expect(await rule("نضمن لك نتائج")).toBe(
      "Client forms never promise results. Remove the guarantee wording.",
    );
    expect(
      await rule(
        "How happy are you with the people who reached you through the ads?",
      ),
    ).toBeNull();
    expect(await rule("الناس اللي تواصلوا معاك من الإعلانات")).toBeNull();
  });

  test("the schema check accepts the seeds and the fixture schemas and names the first problem", async () => {
    const check = (s: Row) =>
      one<string | null>(
        "SELECT public.cockpit_form_schema_check($1::jsonb) AS r",
        [JSON.stringify(s)],
      );
    for (const [k, s] of Object.entries(FIXTURE.schemas))
      expect([k, await check(s)]).toEqual([k, null]);
    for (const k of ["nps", "csat", "portal_feedback"])
      expect(
        await one(
          "SELECT public.cockpit_form_schema_check(schema) AS r FROM cockpit_forms WHERE key = $1",
          [k],
        ),
      ).toBeNull();
    const nps = FIXTURE.schemas.nps;
    const withField = (f: Row) => ({ ...nps, fields: [...nps.fields, f] });
    expect(
      await check(
        withField({
          key: "receipt",
          type: "file",
          required: false,
          label: { en: "Receipt", ar: "الإيصال" },
        }),
      ),
    ).toBe(
      "Question receipt is a file question, which client forms cannot take yet.",
    );
    expect(
      await check(
        withField({
          key: "extra",
          type: "text",
          required: false,
          label: { en: "Extra" },
        }),
      ),
    ).toBe(
      "Question extra needs an English and an Arabic label, each 200 characters at most.",
    );
    expect(
      await check(
        withField({
          key: "recommend",
          type: "text",
          required: false,
          label: { en: "x", ar: "س" },
        }),
      ),
    ).toBe("Two questions share the key recommend.");
    const later = {
      ...nps,
      fields: [
        { ...nps.fields[0], showIf: { key: "results", equals: 5 } },
        ...nps.fields.slice(1),
      ],
    };
    expect(await check(later)).toBe(
      "Question recommend can only follow an earlier question, and results is not before it.",
    );
    expect(await check({ ...nps, signer: "none" })).toBeNull();
    expect(await check({ ...nps, signer: "session" })).toBe(
      "The signer must be none or typed.",
    );
    expect(
      await check({
        ...nps,
        invite: {
          ...nps.invite,
          whatsapp: { en: "No link here", ar: nps.invite.whatsapp.ar },
        },
      }),
    ).toBe(
      "The WhatsApp text needs {form_link} exactly once in each language.",
    );
    expect(await check({ ...nps, v: 2 })).toBe(
      "The schema must be client form schema version 1.",
    );
  });

  test("the seeded registry rows are native, for clients, not live, and equal the fixture's schemas", async () => {
    const rows = await q<Row>(
      "SELECT key, provider, audience, typeform_id, version, schema FROM cockpit_forms WHERE key IN ('nps','csat','portal_feedback') ORDER BY key",
    );
    expect(
      rows.map(r => [r.key, r.provider, r.audience, r.typeform_id, r.version]),
    ).toEqual([
      ["csat", "native", "client", "KbcbPA73", 1],
      ["nps", "native", "client", "fuPgs85S", 1],
      ["portal_feedback", "native", "client", null, 1],
    ]);
    expect(rows.find(r => r.key === "nps")!.schema).toEqual(
      FIXTURE.schemas.nps,
    );
    expect(rows.find(r => r.key === "csat")!.schema).toEqual(
      FIXTURE.schemas.csat,
    );
    expect(
      await one("SELECT public.cockpit_form_client_live('nps') AS r"),
    ).toBe(false);
    expect(
      await as(CSM_A, "SELECT public.cockpit_form_client_live_list() AS r"),
    ).toEqual([]);
  });

  test("the answer checker gives every fixture row its codes, exactly", async () => {
    for (const row of FIXTURE.rows) {
      const got = await one<Row>(
        "SELECT public.cockpit_form_answers_check($1::jsonb, $2::jsonb, $3::jsonb) AS r",
        [
          JSON.stringify(FIXTURE.schemas[row.schema]),
          JSON.stringify(row.answers),
          JSON.stringify(row.context),
        ],
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

  test("the newest v1 version is the client version: exit survey 2 while its registry reads 1", async () => {
    expect(
      await one(
        "SELECT public.cockpit_form_client_version('exit_survey') AS r",
      ),
    ).toBe(2);
    expect(
      await one(
        "SELECT version AS r FROM cockpit_forms WHERE key = 'exit_survey'",
      ),
    ).toBe(1);
    expect(
      await one(
        "SELECT public.cockpit_form_client_version('pause_request') AS r",
      ),
    ).toBeNull();
  });
});

describe("issuing from a seat", () => {
  test("the seat gate: another client's CSM is refused everywhere, anon too", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      for (const [sql, params] of [
        ["SELECT public.cockpit_form_invite_view($1) AS r", [A]],
        [
          "SELECT public.cockpit_form_invite_issue($1,'nps','{portal}',NULL,'ar',false,'{}'::jsonb,$2::uuid,'csm') AS r",
          [A, rid()],
        ],
        [
          "SELECT public.cockpit_form_invite_withdraw($1,$2::uuid,'Not needed now') AS r",
          [A, v.inviteId],
        ],
        [
          "SELECT public.cockpit_form_invite_link($1,$2::uuid) AS r",
          [A, v.inviteId],
        ],
      ] as const) {
        expect((await refusal(() => as(CSM_B, sql, [...params]))).code).toBe(
          "42501",
        );
        expect((await refusal(() => as(null, sql, [...params]))).code).toBe(
          "42501",
        );
      }
      expect(
        (
          await refusal(() =>
            as(null, "SELECT public.cockpit_form_invites_today() AS r"),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await refusal(() =>
            as(NOBODY, "SELECT public.cockpit_form_invites_today() AS r"),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await refusal(() =>
            as(
              null,
              "SELECT public.portal_form_presence_put('[]'::jsonb) AS r",
            ),
          )
        ).code,
      ).toBe("42501");
      // The portal's and the worker's functions answer the service key only: anon and a signed-in seat are refused.
      for (const sql of [
        "SELECT public.portal_form_for_person('locA','taskA1','a@b.c','admin',NULL) AS r",
        "SELECT public.portal_form_list('locA','taskA1','a@b.c','admin') AS r",
        "SELECT public.portal_form_get('locA','taskA1','a@b.c','admin',gen_random_uuid()) AS r",
        "SELECT public.portal_form_invite_record('locA','taskA1',gen_random_uuid(),'a@b.c','shown','{}'::jsonb) AS r",
        "SELECT public.portal_form_submit('locA','taskA1','a@b.c','admin',gen_random_uuid(),'{}'::jsonb,gen_random_uuid(),'ar') AS r",
        `SELECT public.portal_form_token_open('${"a".repeat(64)}','${"b".repeat(64)}',NULL) AS r`,
        `SELECT public.portal_form_token_submit('${"a".repeat(64)}','${"b".repeat(64)}',NULL,'{}'::jsonb,NULL,gen_random_uuid(),'ar') AS r`,
        "SELECT public.portal_form_preview('nps', false) AS r",
        "SELECT public.portal_form_invites_push_claim(5) AS r",
        "SELECT public.portal_form_invite_push_done(gen_random_uuid(),'locA','sent','{}'::jsonb) AS r",
        "SELECT public.portal_form_invite_display('locA','taskA1',gen_random_uuid(),'a@b.c','admin') AS r",
        "SELECT public.cockpit_client_message_invite_link(gen_random_uuid(),gen_random_uuid()) AS r",
        "SELECT public.cockpit_form_client_go_live('nps', true, 'x') AS r",
        "SELECT public.cockpit_form_invite_canary('nps', '{}'::jsonb) AS r",
        "SELECT public.cockpit_form_invites_expire() AS r",
      ]) {
        expect([sql, (await refusal(() => as(null, sql))).code]).toEqual([
          sql,
          "42501",
        ]);
        expect([sql, (await refusal(() => as(CSM_A, sql))).code]).toEqual([
          sql,
          "42501",
        ]);
      }
      for (const sql of [
        "SELECT public.cockpit_form_client_go_live('nps', true, 'x') AS r",
        "SELECT public.cockpit_form_invite_canary('nps', '{}'::jsonb) AS r",
      ])
        expect([sql, (await refusal(() => as("service", sql))).code]).toEqual([
          sql,
          "42501",
        ]);
    });
  });

  test("a form not live refuses; live, the invite is out once per card and form, and a retry returns the first", async () => {
    await rolledBack(async () => {
      expect(
        (await refusal(() => issue(CSM_A, A, "nps", ["portal"]))).message,
      ).toBe("This form opens to clients after its switch-on.");
      await golive("nps");
      const id = rid();
      const first = await issue(CSM_A, A, "nps", ["portal"], {
        id,
        push: true,
      });
      expect(first.inviteId).toBe(id);
      expect(first.delivered).toBe("portal");
      expect(first.view.open).toHaveLength(1);
      const again = await issue(CSM_A, A, "nps", ["portal"], {
        id,
        push: true,
      });
      expect(again.inviteId).toBe(id);
      expect(
        await one("SELECT count(*)::int AS r FROM cockpit_form_invites"),
      ).toBe(1);
      const dup = await refusal(() => issue(CSM_A, A, "nps", ["portal"]));
      expect(dup.message).toMatch(
        /^An NPS survey is already out to Acme Interiors, sent \d{1,2} [A-Z][a-z]{2} \d{4}\. Withdraw it to send a new one\.$/,
      );
      const row = await q<Row>(
        "SELECT push, push_state, origin, issued_by_role, issued_by_email, lang, audience FROM cockpit_form_invites WHERE id = $1::uuid",
        [id],
      );
      expect(row[0]).toMatchObject({
        push: true,
        push_state: "waiting",
        origin: "csm",
        issued_by_role: "the CSM",
        lang: "ar",
        audience: "any",
      });
      // The audit names the action; the seat's address is in the audit only.
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_audit_log WHERE action = 'forms.invite_issued' AND entity_id = $1",
          [id],
        ),
      ).toBe(1);
    });
  });

  test("CSAT is refused once filled; WhatsApp makes a draft with the template", async () => {
    await rolledBack(async () => {
      await golive("csat");
      const v = await issue(CSM_A, A, "csat", ["whatsapp"], { lang: "en" });
      expect(v.delivered).toBe("waiting_approval");
      const m = await q<Row>(
        "SELECT kind, state, body, dedupe_key, invite_id FROM cockpit_client_messages WHERE id = $1::uuid",
        [v.messageId],
      );
      expect(m[0]).toMatchObject({
        kind: "form_invite",
        state: "draft",
        dedupe_key: `invite:${v.inviteId}`,
        invite_id: v.inviteId,
      });
      expect(m[0].body).toBe(
        "Hi Acme Interiors team, now that your campaign is live, how was getting started with us? Tell us in a minute: {form_link}",
      );
      await presence("locA", 1, 0);
      const done = await portalSubmit(v.inviteId, { onboarding: 8 });
      expect(done.ok).toBe(true);
      const refused = await refusal(() => issue(CSM_A, A, "csat", ["portal"]));
      expect(refused.message).toMatch(
        /^They already filled the onboarding survey on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/,
      );
      // The draft was skipped when the answer came in.
      expect(
        await one(
          "SELECT state AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [v.messageId],
        ),
      ).toBe("skipped");
    });
  });

  test("card rules (V28): only Active cards with no open departure get NPS, CSAT and consent; the exit survey needs a departure or Stopped", async () => {
    await rolledBack(async () => {
      for (const k of ["nps", "csat", "pause_consent", "exit_survey"])
        await golive(k);
      const allows = (task: string, form: string) =>
        one<string | null>(
          "SELECT public.cockpit_form_card_allows($1,$2) AS r",
          [task, form],
        );
      for (const form of ["nps", "csat", "pause_consent"]) {
        expect(await allows(C, form)).toBe(
          "Cedar Fitout is not an active client, so this form does not go to them.",
        );
        expect(await allows(D, form)).toBe(
          "Dune Homes is not an active client, so this form does not go to them.",
        );
        expect(await allows(E, form)).toBe(
          "Elm Studio is not an active client, so this form does not go to them.",
        );
        expect(await allows(A, form)).toBeNull();
      }
      expect(await allows(A, "exit_survey")).toBe(
        "Mark Client is leaving first, then send the exit survey.",
      );
      expect(await allows(C, "exit_survey")).toBeNull();
      expect(await allows(TEST_CARD, "nps")).toBeNull();
      // Fern is Active and leaving.
      await q(
        "INSERT INTO cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by) VALUES ('Fern Interiors', $1, current_date + 10, 'Cancelled', 'test')",
        [F],
      );
      expect(await allows(F, "nps")).toBe(
        "Fern Interiors is leaving. Send the exit survey instead.",
      );
      expect(await allows(F, "exit_survey")).toBeNull();
      expect(
        (await refusal(() => issue(CEO, C, "nps", ["whatsapp"]))).message,
      ).toBe(
        "Cedar Fitout is not an active client, so this form does not go to them.",
      );
      expect(
        (await refusal(() => issue(CEO, A, "exit_survey", ["portal"]))).message,
      ).toBe("Mark Client is leaving first, then send the exit survey.");
      const exit = await issue(CEO, C, "exit_survey", ["whatsapp"]);
      expect(exit.delivered).toBe("waiting_approval");
      const exitF = await issue(CEO, F, "exit_survey", ["portal", "whatsapp"]);
      expect(exitF.inviteId).toBeTruthy();
    });
  });

  test("where it goes from: pause consent only from the pause sheet, an unknown origin refused", async () => {
    await rolledBack(async () => {
      await golive("pause_consent");
      const ctx = {
        start: await kuwaitToday(),
        restart: await one<string>("SELECT (current_date + 20)::text AS r"),
      };
      expect(
        (
          await refusal(() =>
            issue(CSM_A, A, "pause_consent", ["portal"], { context: ctx }),
          )
        ).message,
      ).toBe("Send the pause consent from Pause this client.");
      expect(
        (
          await refusal(() =>
            issue(CSM_A, A, "nps", ["portal"], { origin: "phone" }),
          )
        ).message,
      ).toBe("Pick where this form is sent from.");
      const v = await issue(CSM_A, A, "pause_consent", ["portal"], {
        context: ctx,
        origin: "pause",
      });
      const c = await one<Row>(
        "SELECT context AS r FROM cockpit_form_invites WHERE id = $1::uuid",
        [v.inviteId],
      );
      expect(c.over14).toBe(true);
      const late = {
        start: await one<string>(
          "SELECT (public.cockpit_form_kuwait_day(now()) + 15)::text AS r",
        ),
        restart: "2027-01-01",
      };
      await withdraw(CSM_A, A, v.inviteId);
      expect(
        (
          await refusal(() =>
            issue(CSM_A, A, "pause_consent", ["portal"], {
              context: late,
              origin: "pause",
            }),
          )
        ).message,
      ).toBe("The pause starts today or within 14 days.");
    });
  });

  test("the portal channel needs an open workspace; notes pass the text rule", async () => {
    await rolledBack(async () => {
      await golive("nps");
      expect(
        (await refusal(() => issue(CSM_B, B, "nps", ["portal"]))).message,
      ).toBe(
        "Beta Build has no open Mahara OS workspace. Send the WhatsApp link.",
      );
      expect(
        (
          await refusal(() =>
            issue(CSM_A, A, "nps", ["portal"], { note: "Your leads doubled!" }),
          )
        ).message,
      ).toContain("never quote leads");
      expect(
        (
          await refusal(() =>
            issue(CSM_A, A, "nps", ["portal"], { note: "مضمون نتائج" }),
          )
        ).message,
      ).toBe(
        "Client forms never promise results. Remove the guarantee wording.",
      );
      const ok = await issue(CSM_B, B, "nps", ["whatsapp"], {
        note: "Thanks for the time together",
      });
      expect(ok.delivered).toBe("waiting_approval");
    });
  });

  test("the view: presence, default channels per form, why each form waits", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await golive("pause_consent");
      let v = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_invite_view($1) AS r",
        [A],
      );
      expect(v.presence.note).toBe(
        "We can't see portal visits yet, so it goes to the portal and by WhatsApp.",
      );
      expect(v.presence.admins).toBeNull();
      expect(v.defaultChannels).toEqual(["portal", "whatsapp"]);
      const by = Object.fromEntries(v.forms.map((f: Row) => [f.key, f]));
      expect(by.nps).toMatchObject({ live: true, sendable: true, why: null });
      expect(by.csat).toMatchObject({
        live: false,
        sendable: false,
        why: "Opens to clients after its switch-on.",
      });
      expect(by.pause_consent.why).toBe("Sent from Pause this client.");
      expect(by.exit_survey.why).toBe("Opens to clients after its switch-on.");
      expect(v.templates.nps.en).toContain("{form_link}");
      // Members only, no admin in 14 days: the admin form adds WhatsApp (5.1).
      await presence("locA", 0, 3);
      v = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_invite_view($1) AS r",
        [A],
      );
      const f2 = Object.fromEntries(v.forms.map((f: Row) => [f.key, f]));
      expect(f2.nps.defaultChannels).toEqual(["portal"]);
      expect(f2.pause_consent.defaultChannels).toEqual(["portal", "whatsapp"]);
      expect(f2.pause_consent.note).toBe(
        "No admin has opened the portal in 14 days, so the WhatsApp link goes too.",
      );
      expect(v.presence.note).toBe("Opened the portal 1 day ago · 3 people");
      await presence("locA", 1, 0, 20);
      v = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_invite_view($1) AS r",
        [A],
      );
      expect(v.problem).toBe("no_recent_session");
      expect(v.defaultChannels).toEqual(["portal", "whatsapp"]);
      const beta = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_form_invite_view($1) AS r",
        [B],
      );
      expect(beta.problem).toBe("workspace_closed");
      expect(beta.defaultChannels).toEqual(["whatsapp"]);
    });
  });
});

describe("tokens and the link page", () => {
  test("a copy link is shown once: only its hash is stored, a new one revokes the last", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      const first = await link(CSM_A, A, v.inviteId);
      expect(first.url).toMatch(
        /^https:\/\/portal\.maharamedia\.com\/f#f1[A-Za-z0-9_-]{43}$/,
      );
      const second = await link(CSM_A, A, v.inviteId);
      const t1 = tokenOf(first.url);
      const t2 = tokenOf(second.url);
      expect(t1).not.toBe(t2);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invite_tokens WHERE revoked_at IS NULL AND invite_id = $1::uuid",
          [v.inviteId],
        ),
      ).toBe(1);
      expect((await tokenOpen(t1)).reason).toBe("unknown");
      expect((await tokenOpen(t2)).ok).toBe(true);
      // Neither token nor its hash in any text the database keeps but the token's own hash column.
      const dump = await one<string>(
        `SELECT string_agg(t::text, ' ') AS r FROM (
           SELECT to_jsonb(a) AS t FROM cockpit_audit_log a UNION ALL SELECT to_jsonb(e) FROM cockpit_form_invite_events e
           UNION ALL SELECT to_jsonb(i) FROM cockpit_form_invites i UNION ALL SELECT to_jsonb(m) FROM cockpit_client_messages m
           UNION ALL SELECT to_jsonb(o) FROM cockpit_form_token_opens o UNION ALL SELECT to_jsonb(s) FROM cockpit_sync_state s) x`,
      );
      for (const t of [t1, t2]) {
        expect(dump.includes(t)).toBe(false);
        expect(dump.includes(sha(t))).toBe(false);
      }
      // Every table of every schema, every column: the raw tokens nowhere, their hashes only in the tokens table.
      const tables = await q<{ t: string }>(
        `SELECT format('%I.%I', n.nspname, c.relname) AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY 1`,
      );
      for (const { t } of tables) {
        const text =
          (await one<string | null>(
            `SELECT string_agg(to_jsonb(x)::text, ' ') AS r FROM ${t} x`,
          )) ?? "";
        for (const tok of [t1, t2]) {
          expect([t, text.includes(tok)]).toEqual([t, false]);
          if (t !== "public.cockpit_form_invite_tokens")
            expect([t, text.includes(sha(tok))]).toEqual([t, false]);
        }
      }
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invite_tokens WHERE token_sha256 = $1",
          [sha(t2)],
        ),
      ).toBe(1);
    });
  });

  test("the token opens with its schema and the invite's language; refusals carry their codes", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await golive("csat");
      const v = await issue(CSM_A, A, "nps", ["portal"], { lang: "en" });
      const t = tokenOf((await link(CSM_A, A, v.inviteId)).url);
      const open = await tokenOpen(t);
      expect(open.ok).toBe(true);
      expect(open.invite).toMatchObject({
        id: v.inviteId,
        formKey: "nps",
        version: 1,
        lang: "en",
        signer: "none",
        clientName: "Acme Interiors",
        from: "Noura",
      });
      expect(open.invite.schema).toEqual(FIXTURE.schemas.nps);
      expect((await tokenOpen(`f1${"Z".repeat(43)}`)).reason).toBe("unknown");
      // Withdrawn.
      const w = await issue(CSM_A, A, "csat", ["portal"]);
      const tw = tokenOf((await link(CSM_A, A, w.inviteId)).url);
      await withdraw(CSM_A, A, w.inviteId);
      expect((await tokenOpen(tw)).reason).toBe("withdrawn");
      // Expired, read without writing, then after the expiry.
      await ageInvite(v.inviteId, 15);
      expect((await tokenOpen(t)).reason).toBe("expired");
      expect(
        await one(
          "SELECT state AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [v.inviteId],
        ),
      ).toBe("expired");
      // Not live: a fresh invite, then the form switched off.
      const n = await issue(CSM_A, A, "nps", ["portal"]);
      const tn = tokenOf((await link(CSM_A, A, n.inviteId)).url);
      await q(
        "UPDATE cockpit_settings SET value = jsonb_set(value, '{live}', '[\"csat\"]') WHERE key = 'forms.client'",
      );
      expect((await tokenOpen(tn)).reason).toBe("not_live");
      await q(
        "UPDATE cockpit_settings SET value = jsonb_set(value, '{live}', '[\"csat\",\"nps\"]') WHERE key = 'forms.client'",
      );
      expect((await tokenSubmit(tn, { recommend: 10 })).ok).toBe(true);
      expect((await tokenOpen(tn)).reason).toBe("answered");
      expect(
        await one(
          "SELECT outcome AS r FROM cockpit_form_token_opens ORDER BY id DESC LIMIT 1",
        ),
      ).toBe("used");
    });
  });

  test("rate limits: 30 a minute a browser, 120 a minute a network, 10 unknown in 10 minutes", async () => {
    await rolledBack(async () => {
      const unknown = `f1${"Y".repeat(43)}`;
      for (let i = 0; i < 10; i++)
        expect((await tokenOpen(unknown, NET2, null)).reason).toBe("unknown");
      expect((await tokenOpen(unknown, NET2, null)).reason).toBe("limited");
      // Another browser behind the same address is not locked out by those ten.
      expect((await tokenOpen(unknown, NET2, "e".repeat(64))).reason).toBe(
        "unknown",
      );
      // A flood leaves one limited row a minute, not one a request.
      for (let i = 0; i < 5; i++)
        expect((await tokenOpen(unknown, NET2, null)).reason).toBe("limited");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_token_opens WHERE outcome = 'limited' AND net_hash = $1",
          [NET2],
        ),
      ).toBe(1);
      // The whole network's ceiling: 50 unknown in 10 minutes from any browsers.
      await q("DELETE FROM cockpit_form_token_opens");
      await q(
        `INSERT INTO cockpit_form_token_opens(net_hash, browser_hash, outcome) SELECT $1, md5(g::text) || md5(g::text), 'unknown' FROM generate_series(1, 50) g`,
        [NET2],
      );
      expect((await tokenOpen(unknown, NET2, "f".repeat(64))).reason).toBe(
        "limited",
      );
      await q("DELETE FROM cockpit_form_token_opens");
      await q(
        `INSERT INTO cockpit_form_token_opens(net_hash, browser_hash, outcome) SELECT $1, $2, 'ok' FROM generate_series(1, 30)`,
        [NET, BROWSER],
      );
      expect((await tokenOpen(unknown, NET, BROWSER)).reason).toBe("limited");
      await q("DELETE FROM cockpit_form_token_opens");
      await q(
        `INSERT INTO cockpit_form_token_opens(net_hash, outcome) SELECT $1, 'ok' FROM generate_series(1, 120)`,
        [NET],
      );
      expect((await tokenOpen(unknown, NET, "d".repeat(64))).reason).toBe(
        "limited",
      );
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_token_opens WHERE outcome = 'limited'",
        ),
      ).toBe(1);
      expect(
        (
          await refusal(() =>
            as(
              "service",
              "SELECT public.portal_form_token_open('nothex', $1, NULL) AS r",
              [NET],
            ),
          )
        ).message,
      ).toBe("form_token_invalid");
    });
  });

  test("one answer per invite across channels; tokens revoked; the unsent message skipped; hidden answers refused", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await golive("pause_consent");
      const v = await issue(CSM_A, A, "nps", ["portal", "whatsapp"]);
      const t = tokenOf((await link(CSM_A, A, v.inviteId)).url);
      const bad = await tokenSubmit(t, { recommend: 12 });
      expect(bad).toEqual({
        ok: false,
        reason: "invalid",
        errors: { recommend: "range" },
      });
      const req = rid();
      const ok = await tokenSubmit(
        t,
        { recommend: 3, startStop: "  More   calls " },
        null,
        req,
      );
      expect(ok.ok).toBe(true);
      expect(ok.done).toEqual(FIXTURE.schemas.nps.done);
      expect(
        (await tokenSubmit(t, { recommend: 3 }, null, req)).responseId,
      ).toBe(ok.responseId);
      const second = await portalSubmit(v.inviteId, { recommend: 9 });
      expect(second).toEqual({ ok: false, reason: "answered" });
      const r = await q<Row>(
        "SELECT source, external_id, mode, state, answers, answer_meta, signer, invite_id FROM cockpit_form_responses WHERE id = $1::uuid",
        [ok.responseId],
      );
      expect(r[0]).toMatchObject({
        source: "public",
        mode: "live",
        state: "submitted",
        signer: null,
        invite_id: v.inviteId,
      });
      expect(r[0].answers).toEqual({ recommend: 3, startStop: "More calls" });
      expect(r[0].answer_meta).toMatchObject({
        invite_id: v.inviteId,
        channel: "copy",
      });
      expect(r[0].answer_meta.notice_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invite_tokens WHERE invite_id = $1::uuid AND revoked_at IS NULL",
          [v.inviteId],
        ),
      ).toBe(0);
      expect(
        await one(
          "SELECT state AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [v.messageId],
        ),
      ).toBe("skipped");
      expect(
        await one(
          "SELECT reason AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [v.messageId],
        ),
      ).toBe("Answered by link.");
      const inv = await q<Row>(
        "SELECT state, response_id FROM cockpit_form_invites WHERE id = $1::uuid",
        [v.inviteId],
      );
      expect(inv[0]).toEqual({ state: "answered", response_id: ok.responseId });
      // The pause consent: admin only in the portal, hidden answers refused, the typed name by link.
      await presence("locA", 1, 1);
      const start = await kuwaitToday();
      const p = await issue(CSM_A, A, "pause_consent", ["portal"], {
        origin: "pause",
        context: { start, restart: "2026-12-31" },
      });
      expect(
        await portalSubmit(
          p.inviteId,
          {
            reason: "travel",
            details: "Trip",
            consentTerm: true,
            consentOver14: true,
          },
          { person: MEMBER_P, role: "member" },
        ),
      ).toEqual({
        ok: false,
        reason: "admin_only",
      });
      const hidden = await portalSubmit(p.inviteId, {
        datesWrong: true,
        datesNote: "x",
        reason: "travel",
        details: "Trip",
        consentTerm: true,
      });
      expect(hidden).toEqual({
        ok: false,
        reason: "invalid",
        errors: { consentTerm: "hidden" },
      });
      // No copy link for a signed or admin-only form: the client gets it in the portal or by the approved message.
      expect((await refusal(() => link(CSM_A, A, p.inviteId))).message).toBe(
        "This form goes to the client only in the portal or by the approved WhatsApp message, so it has no link to copy.",
      );
      const tp = await one<string>(
        "SELECT public.cockpit_form_token_mint($1::uuid,'whatsapp',gen_random_uuid(),'the cockpit') AS r",
        [p.inviteId],
      );
      expect((await tokenOpen(tp)).invite.signer).toBe("typed");
      expect(
        (
          await tokenSubmit(
            tp,
            {
              reason: "travel",
              details: "Trip",
              consentTerm: true,
              consentOver14: true,
            },
            null,
          )
        ).errors,
      ).toEqual({ signer: "required" });
      const signed = await tokenSubmit(
        tp,
        {
          datesWrong: true,
          datesNote: "Start on the 10th",
          reason: "travel",
          details: "Trip",
        },
        "  Noura   Test ",
      );
      expect(signed.ok).toBe(true);
      expect(signed.done.en).toBe(
        "Sent. Your account manager will fix the dates and send it again.",
      );
      expect(
        await one(
          "SELECT signer AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [signed.responseId],
        ),
      ).toBe("Noura Test");
    });
  });

  test("the portal path: the workspace pair, a closed workspace refused while the link works", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      expect(
        (
          await refusal(() =>
            portalSubmit(
              v.inviteId,
              { recommend: 9 },
              { loc: "locF", task: A },
            ),
          )
        ).message,
      ).toBe("form_invite_not_in_workspace");
      expect(
        (
          await refusal(() =>
            portalSubmit(
              v.inviteId,
              { recommend: 9 },
              { loc: "locF", task: F },
            ),
          )
        ).message,
      ).toBe("form_invite_not_in_workspace");
      expect(
        (
          await refusal(() =>
            portalSubmit(
              v.inviteId,
              { recommend: 9 },
              { person: "not an email" },
            ),
          )
        ).message,
      ).toBe("client_ask_invalid_person");
      const b = await issue(CSM_B, B, "nps", ["whatsapp"]);
      expect(
        (
          await refusal(() =>
            portalSubmit(
              b.inviteId,
              { recommend: 9 },
              { loc: "locB", task: B },
            ),
          )
        ).message,
      ).toBe("form_invite_not_in_workspace");
      const tb = tokenOf((await link(CSM_B, B, b.inviteId)).url);
      const ok = await tokenSubmit(tb, { recommend: 9 });
      expect(ok.ok).toBe(true);
      const get = await as<Row>(
        "service",
        "SELECT public.portal_form_get('locA',$1,$2,'admin',$3::uuid) AS r",
        [A, ADMIN_P, v.inviteId],
      );
      expect(get.invite).toMatchObject({
        id: v.inviteId,
        state: "open",
        lang: "ar",
      });
      expect(get.invite.schema).toEqual(FIXTURE.schemas.nps);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invite_events WHERE invite_id = $1::uuid AND event = 'opened'",
          [v.inviteId],
        ),
      ).toBe(1);
      await as(
        "service",
        "SELECT public.portal_form_get('locA',$1,$2,'admin',$3::uuid) AS r",
        [A, ADMIN_P, v.inviteId],
      );
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invite_events WHERE invite_id = $1::uuid AND event = 'opened'",
          [v.inviteId],
        ),
      ).toBe(1);
      const list = await as<Row>(
        "service",
        "SELECT public.portal_form_list('locA',$1,$2,'member') AS r",
        [A, MEMBER_P],
      );
      expect(list.forms.map((f: Row) => [f.id, f.state])).toEqual([
        [v.inviteId, "open"],
      ]);
    });
  });

  test("a card that stops qualifying: its open NPS answers withdrawn in the portal and by link, then the sweep withdraws it", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      const t = tokenOf((await link(CSM_A, A, v.inviteId)).url);
      await q(
        "UPDATE cockpit_billing_accounts SET client_status = 'Stopped' WHERE clickup_task_id = $1",
        [A],
      );
      expect(
        (
          await as<Row>(
            "service",
            "SELECT public.portal_form_get('locA',$1,$2,'admin',$3::uuid) AS r",
            [A, ADMIN_P, v.inviteId],
          )
        ).reason,
      ).toBe("withdrawn");
      expect((await tokenOpen(t)).reason).toBe("withdrawn");
      expect((await portalSubmit(v.inviteId, { recommend: 9 })).reason).toBe(
        "withdrawn",
      );
      expect((await forPerson(ADMIN_P)).reason).toBe("nothing_waiting");
      expect(
        await one(
          "SELECT public.cockpit_form_invites_withdraw_ineligible() AS r",
        ),
      ).toBe(1);
      expect(
        await q(
          "SELECT state, closed_reason FROM cockpit_form_invites WHERE id = $1::uuid",
          [v.inviteId],
        ),
      ).toEqual([
        {
          state: "withdrawn",
          closed_reason: "The client is no longer active.",
        },
      ]);
    });
  });
});

describe("the pop-up and the forms page", () => {
  test("one pop-up a day across asks and invites; Not now waits 3 days; the deep link passes", async () => {
    await rolledBack(async () => {
      await golive("nps");
      // An ask shown today: the cap answers shown_today even with no invite open.
      const askId = rid();
      await q(
        `INSERT INTO cockpit_client_asks(id, task_id, client_name, location_id, kind, link, push, push_state, asked_by, asked_by_email)
         VALUES ($1::uuid, $2, 'Acme Interiors', 'locA', 'review', 'https://g.page/r/x/review', false, 'off', $3::uuid, 'csm.a@tests.invalid')`,
        [askId, A, CSM_A],
      );
      await q(
        "INSERT INTO cockpit_client_ask_events(ask_id, client_name, source, event, person) VALUES ($1::uuid, 'Acme Interiors', 'portal', 'shown', $2)",
        [askId, ADMIN_P],
      );
      expect(await forPerson(ADMIN_P)).toEqual({
        invite: null,
        reason: "shown_today",
      });
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      expect((await forPerson(ADMIN_P)).reason).toBe("shown_today");
      const deep = await forPerson(ADMIN_P, v.inviteId);
      expect(deep.invite).toMatchObject({
        id: v.inviteId,
        formKey: "nps",
        minutes: 1,
        from: "Noura",
        lang: "ar",
        audience: "any",
      });
      expect(deep.invite.title).toEqual(FIXTURE.schemas.nps.title);
      // Another person sees it, once; then it is their day's pop-up.
      expect((await forPerson(MEMBER_P, null, "member")).invite.id).toBe(
        v.inviteId,
      );
      expect(await record(v.inviteId, MEMBER_P, "shown")).toEqual({
        ok: true,
        recorded: true,
      });
      expect(await record(v.inviteId, MEMBER_P, "shown")).toEqual({
        ok: true,
        recorded: false,
      });
      expect((await forPerson(MEMBER_P, null, "member")).reason).toBe(
        "shown_today",
      );
      await q(
        "UPDATE cockpit_form_invite_events SET at = at - interval '21 hours' WHERE person = $1",
        [MEMBER_P],
      );
      expect(await record(v.inviteId, MEMBER_P, "later")).toEqual({
        ok: true,
        recorded: true,
      });
      expect((await forPerson(MEMBER_P, null, "member")).reason).toBe(
        "snoozed",
      );
      await q(
        "UPDATE cockpit_form_invite_events SET at = at - interval '3 days 1 hour' WHERE person = $1",
        [MEMBER_P],
      );
      expect((await forPerson(MEMBER_P, null, "member")).invite.id).toBe(
        v.inviteId,
      );
    });
  });

  test("members never see an admin-only form; the canary never reaches the portal", async () => {
    await rolledBack(async () => {
      await golive("pause_consent");
      const p = await issue(CSM_A, A, "pause_consent", ["portal"], {
        origin: "pause",
        context: { start: await kuwaitToday(), restart: "2026-12-31" },
      });
      expect((await forPerson(MEMBER_P, null, "member")).reason).toBe(
        "nothing_waiting",
      );
      expect((await forPerson(ADMIN_P, null, "admin")).invite.id).toBe(
        p.inviteId,
      );
      expect((await forPerson(ADMIN_P, null, "admin")).invite.audience).toBe(
        "admin",
      );
      expect(
        (
          await as<Row>(
            "service",
            "SELECT public.portal_form_get('locA',$1,$2,'member',$3::uuid) AS r",
            [A, MEMBER_P, p.inviteId],
          )
        ).reason,
      ).toBe("admin_only");
    });
  });

  test("presence is refused while off, and counts only once on", async () => {
    await rolledBack(async () => {
      const rows = JSON.stringify([
        {
          locationId: "locA",
          lastSessionAt: new Date().toISOString(),
          admins: 1,
          members: 2,
        },
      ]);
      expect(
        await as(
          "service",
          "SELECT public.portal_form_presence_put($1::jsonb) AS r",
          [rows],
        ),
      ).toEqual({ ok: false, reason: "off" });
      await q(
        "UPDATE cockpit_settings SET value = value || '{\"presence\":true}' WHERE key = 'forms.client'",
      );
      expect(
        await as(
          "service",
          "SELECT public.portal_form_presence_put($1::jsonb) AS r",
          [rows],
        ),
      ).toEqual({ ok: true, rows: 1 });
      expect(
        await q(
          "SELECT location_id, admins, members FROM cockpit_portal_presence",
        ),
      ).toEqual([{ location_id: "locA", admins: 1, members: 2 }]);
      const bad = JSON.stringify(
        [{ locationId: "locA", admins: 1, members: 2, email: "x@y" }].map(
          r => ({ ...r, admins: "1" }),
        ),
      );
      expect(
        (
          await refusal(() =>
            as(
              "service",
              "SELECT public.portal_form_presence_put($1::jsonb) AS r",
              [bad],
            ),
          )
        ).message,
      ).toBe("form_presence_invalid");
    });
  });

  test("phone alerts: claimed once, reported in counts, the display check follows the invite", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"], { push: true });
      const claim = await as<Row[]>(
        "service",
        "SELECT public.portal_form_invites_push_claim(20) AS r",
      );
      expect(claim).toHaveLength(1);
      expect(claim[0]).toMatchObject({
        id: v.inviteId,
        locationId: "locA",
        clickupId: A,
        formKey: "nps",
        lang: "ar",
      });
      expect(claim[0].push).toEqual(FIXTURE.schemas.nps.invite.push);
      expect(
        await as(
          "service",
          "SELECT public.portal_form_invites_push_claim(20) AS r",
        ),
      ).toEqual([]);
      const done = await as<Row>(
        "service",
        'SELECT public.portal_form_invite_push_done($1::uuid,\'locA\',\'sent\',\'{"devices":2,"accepted":2,"email":"x"}\'::jsonb) AS r',
        [v.inviteId],
      );
      expect(done).toEqual({ ok: true, pushState: "sent", recorded: true });
      expect(
        await one(
          "SELECT push_result AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [v.inviteId],
        ),
      ).toEqual({ devices: 2, accepted: 2 });
      expect(
        await as(
          "service",
          "SELECT public.portal_form_invite_display('locA',$1,$2::uuid,$3,'admin') AS r",
          [A, v.inviteId, ADMIN_P],
        ),
      ).toBe(true);
      // An NPS (audience any) shows to a member too; an unknown role shows nothing.
      expect(
        await as(
          "service",
          "SELECT public.portal_form_invite_display('locA',$1,$2::uuid,$3,'member') AS r",
          [A, v.inviteId, MEMBER_P],
        ),
      ).toBe(true);
      expect(
        await as(
          "service",
          "SELECT public.portal_form_invite_display('locA',$1,$2::uuid,$3,NULL) AS r",
          [A, v.inviteId, MEMBER_P],
        ),
      ).toBe(false);
      await withdraw(CSM_A, A, v.inviteId);
      expect(
        await as(
          "service",
          "SELECT public.portal_form_invite_display('locA',$1,$2::uuid,$3,'admin') AS r",
          [A, v.inviteId, ADMIN_P],
        ),
      ).toBe(false);
    });
  });

  test("an admin-only invite's alert: the claim says admin, and a member's device may not show it", async () => {
    await rolledBack(async () => {
      await golive("pause_consent");
      await presence("locA", 1, 1);
      const p = await issue(CSM_A, A, "pause_consent", ["portal"], {
        origin: "pause",
        push: true,
        context: { start: await kuwaitToday(), restart: "2026-12-31" },
      });
      const claim = await as<Row[]>(
        "service",
        "SELECT public.portal_form_invites_push_claim(20) AS r",
      );
      expect(claim.find(c => c.id === p.inviteId)?.audience).toBe("admin");
      const show = (role: string, person: string) =>
        as(
          "service",
          "SELECT public.portal_form_invite_display('locA',$1,$2::uuid,$3,$4) AS r",
          [A, p.inviteId, person, role],
        );
      expect(await show("admin", ADMIN_P)).toBe(true);
      expect(await show("member", MEMBER_P)).toBe(false);
    });
  });
});

describe("the WhatsApp link", () => {
  /** Approve as the CSM through the service RPC, as cockpit-forms-api's invite.approve does. */
  const approve = (messageId: string, body: string) =>
    as<Row>(
      "service",
      "SELECT public.cockpit_client_message_approve($1::uuid,$2,$3,$4::uuid,'{}'::text[]) AS r",
      [messageId, body, sha(body), CSM_A],
    );
  const claim = () =>
    as<Row>(
      "service",
      "SELECT public.cockpit_client_message_claim(ARRAY['form_invite'], NULL, 1) AS r",
    );
  const intent = (id: string, token: string) =>
    as<Row>(
      "service",
      "SELECT public.cockpit_client_message_intent($1::uuid,$2::uuid) AS r",
      [id, token],
    );
  const mint = (id: string, token: string) =>
    as<Row>(
      "service",
      "SELECT public.cockpit_client_message_invite_link($1::uuid,$2::uuid) AS r",
      [id, token],
    );

  test("approve keeps {form_link} exactly once and the text rule; claim, intent and the one mint", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["whatsapp"], { lang: "en" });
      const body = await one<string>(
        "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
        [v.messageId],
      );
      expect(
        (
          await refusal(() =>
            approve(v.messageId, body.replace("{form_link}", "")),
          )
        ).message,
      ).toBe(
        "Keep {form_link} in the message exactly once: the link goes there when it sends.",
      );
      expect(
        (await refusal(() => approve(v.messageId, `${body} {form_link}`)))
          .message,
      ).toBe(
        "Keep {form_link} in the message exactly once: the link goes there when it sends.",
      );
      expect(
        (await refusal(() => approve(v.messageId, `${body} 10 leads`))).message,
      ).toContain("never quote leads");
      const ok = await approve(v.messageId, body);
      expect(ok).toMatchObject({
        kind: "form_invite",
        state: "approved",
        formKey: "nps",
        inviteId: v.inviteId,
        owner: "cockpit",
      });
      expect((await refusal(() => approve(v.messageId, body))).message).toBe(
        "This message is already approved. It sends within about 3 minutes.",
      );
      const c = await claim();
      expect(c.rows).toHaveLength(1);
      const row = c.rows[0];
      expect(await mint(row.id, row.claimToken)).toEqual({
        ok: false,
        reason: "not_held",
      });
      expect((await intent(row.id, row.claimToken)).ok).toBe(true);
      const made = await mint(row.id, row.claimToken);
      expect(made.ok).toBe(true);
      expect(made.url).toMatch(
        /^https:\/\/portal\.maharamedia\.com\/f#f1[A-Za-z0-9_-]{43}$/,
      );
      expect(await mint(row.id, row.claimToken)).toEqual({
        ok: false,
        reason: "already_made",
      });
      expect((await tokenOpen(tokenOf(made.url))).ok).toBe(true);
      expect(
        await q(
          "SELECT channel FROM cockpit_form_invite_tokens WHERE message_id = $1::uuid",
          [row.id],
        ),
      ).toEqual([{ channel: "whatsapp" }]);
      expect(
        await one(
          "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [row.id],
        ),
      ).toBe(body);
    });
  });

  test("the gate passes an open live link and refuses a closed one with its reason; the exit survey goes to a Stopped card", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await golive("exit_survey");
      const v = await issue(CSM_A, A, "nps", ["whatsapp"]);
      const gate = (id: string) =>
        one<Row>(
          "SELECT public.cockpit_form_effect_gate('client_message', $1) AS r",
          [id],
        );
      expect(await gate(v.messageId)).toMatchObject({
        ok: true,
        reason: null,
        formKey: "nps",
        inviteId: v.inviteId,
      });
      await ageInvite(v.inviteId, 15);
      expect((await gate(v.messageId)).reason).toBe(
        "The form ran out after 14 days, so the link was not sent.",
      );
      const e = await issue(CEO, C, "exit_survey", ["whatsapp"]);
      expect((await gate(e.messageId)).ok).toBe(true);
      await withdraw(CEO, C, e.inviteId);
      expect((await gate(e.messageId)).reason).toBe(
        "The form was withdrawn, so the link was not sent.",
      );
      // A recap's gate is the 1-1 notes gate, unchanged.
      expect((await gate(rid())).reason).toBe(
        "No 1-1 notes effect points at this write, so nothing was written.",
      );
    });
  });

  test("an answer while the message is claimed or sending leaves it; the gate refuses it after", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal", "whatsapp"]);
      const body = await one<string>(
        "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
        [v.messageId],
      );
      await approve(v.messageId, body);
      const row = (await claim()).rows[0];
      expect((await portalSubmit(v.inviteId, { recommend: 9 })).ok).toBe(true);
      expect(
        await one(
          "SELECT state AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [row.id],
        ),
      ).toBe("claimed");
      // The live intent puts a gate refusal back to approved; the live sweep then skips it with the gate's reason.
      const i = await intent(row.id, row.claimToken);
      expect(i).toEqual({
        ok: false,
        reason:
          "The client already answered the form, so the link was not sent.",
      });
      await as("service", "SELECT public.cockpit_client_message_sweep() AS r");
      expect(
        await q(
          "SELECT state, reason FROM cockpit_client_messages WHERE id = $1::uuid",
          [row.id],
        ),
      ).toEqual([
        {
          state: "skipped",
          reason:
            "The client already answered the form, so the link was not sent.",
        },
      ]);
    });
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal", "whatsapp"]);
      const body = await one<string>(
        "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
        [v.messageId],
      );
      await approve(v.messageId, body);
      const row = (await claim()).rows[0];
      expect((await intent(row.id, row.claimToken)).ok).toBe(true);
      expect((await portalSubmit(v.inviteId, { recommend: 9 })).ok).toBe(true);
      expect(
        await one(
          "SELECT state AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [row.id],
        ),
      ).toBe("sending");
      expect(await mint(row.id, row.claimToken)).toEqual({
        ok: false,
        reason: "closed",
      });
    });
  });

  test("a draft or approved message is skipped on withdraw and when the form goes off", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await golive("csat");
      const a = await issue(CSM_A, A, "nps", ["whatsapp"]);
      await withdraw(CSM_A, A, a.inviteId, "Sent the wrong form");
      expect(
        await q(
          "SELECT state, reason FROM cockpit_client_messages WHERE id = $1::uuid",
          [a.messageId],
        ),
      ).toEqual([
        {
          state: "skipped",
          reason: "Withdrawn in the cockpit: Sent the wrong form",
        },
      ]);
      expect(
        await one(
          "SELECT detail AS r FROM cockpit_form_invite_events WHERE invite_id = $1::uuid AND event = 'withdrawn'",
          [a.inviteId],
        ),
      ).toEqual({
        by: "seat",
        reason: "Sent the wrong form",
      });
      const b = await issue(CSM_A, A, "csat", ["whatsapp"]);
      const body = await one<string>(
        "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
        [b.messageId],
      );
      await approve(b.messageId, body);
      const off = await golive("csat", false);
      expect(off).toMatchObject({ formKey: "csat", live: false, withdrawn: 1 });
      expect(
        await one(
          "SELECT state AS r FROM cockpit_client_messages WHERE id = $1::uuid",
          [b.messageId],
        ),
      ).toBe("skipped");
      expect(
        await one(
          "SELECT closed_reason AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [b.inviteId],
        ),
      ).toBe("Form switched off");
    });
  });
});

describe("reads, today and answers", () => {
  test("every STABLE read runs read-only and reports an invite past its end as expired, writing nothing", async () => {
    // Committed, so each read below runs in its own READ ONLY transaction (as PostgREST runs a STABLE function).
    await golive("nps");
    const v = await issue(CSM_A, A, "nps", ["portal"]);
    await ageInvite(v.inviteId, 15);
    const view = await as<Row>(
      CSM_A,
      "SELECT public.cockpit_form_invite_view($1) AS r",
      [A],
    );
    expect(view.open).toEqual([]);
    expect(view.history[0]).toMatchObject({
      id: v.inviteId,
      state: "expired",
      closedReason: "Ran out after 14 days.",
    });
    const reads: [string, string, unknown[]][] = [
      [CSM_A, "SELECT public.cockpit_form_invite_view($1) AS r", [A]],
      [CSM_A, "SELECT public.cockpit_form_invites_today() AS r", []],
      [CSM_A, "SELECT public.cockpit_form_client_live_list() AS r", []],
      [
        "service",
        "SELECT public.portal_form_for_person('locA',$1,$2,'admin',NULL) AS r",
        [A, ADMIN_P],
      ],
      [
        "service",
        "SELECT public.portal_form_list('locA',$1,$2,'admin') AS r",
        [A, ADMIN_P],
      ],
      ["service", "SELECT public.portal_form_preview('nps', true) AS r", []],
    ];
    const answers: unknown[] = [];
    for (const [who, sql, params] of reads) {
      await asOwner();
      await db.exec("BEGIN; SET TRANSACTION READ ONLY");
      try {
        if (who === "service") {
          await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ role: "service_role" }),
          ]);
          await db.exec("SET LOCAL ROLE service_role");
        } else await actor(db, who);
        answers.push((await db.query<Row>(sql, params)).rows[0].r);
      } finally {
        await db.exec("ROLLBACK");
        await asOwner();
      }
    }
    expect((answers[3] as Row).reason).toBe("nothing_waiting");
    expect((answers[4] as Row).forms).toEqual([]);
    expect(
      await one(
        "SELECT state AS r FROM cockpit_form_invites WHERE id = $1::uuid",
        [v.inviteId],
      ),
    ).toBe("open");
    // The write path expires it; then the form goes off again for the tests after this one.
    expect(await one("SELECT public.cockpit_form_invites_expire() AS r")).toBe(
      1,
    );
    expect(
      await one(
        "SELECT state AS r FROM cockpit_form_invites WHERE id = $1::uuid",
        [v.inviteId],
      ),
    ).toBe("expired");
    await golive("nps", false);
  });

  test("today: sent, not answered after 7 days, waiting approval, answered, exit survey due; never the canary", async () => {
    await rolledBack(async () => {
      for (const k of ["nps", "csat"]) await golive(k);
      const n = await issue(CSM_A, A, "nps", ["portal", "whatsapp"]);
      await ageInvite(n.inviteId, 8);
      const c = await issue(CSM_A, A, "csat", ["portal"]);
      expect((await portalSubmit(c.inviteId, { onboarding: 9 })).ok).toBe(true);
      await q(
        "INSERT INTO cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by) VALUES ('Fern Interiors', $1, current_date + 10, 'Cancelled', 'test')",
        [F],
      );
      await one(
        "SELECT public.cockpit_form_invite_canary('nps', '{}'::jsonb) AS r",
      );
      const rows = await as<Row[]>(
        CEO,
        "SELECT public.cockpit_form_invites_today() AS r",
      );
      const kinds = rows.map(r => `${r.kind}:${r.taskId}:${r.formKey}`).sort();
      expect(kinds).toEqual([
        `answered:${A}:csat`,
        `approve_link:${A}:nps`,
        `exit_survey_due:${F}:exit_survey`,
        `not_answered:${A}:nps`,
        `sent_today:${A}:csat`,
      ]);
      expect(rows.find(r => r.kind === "not_answered")!.days).toBe(8);
      expect(rows.some(r => r.taskId === TEST_CARD)).toBe(false);
      // A CSM sees their own clients only.
      const mine = await as<Row[]>(
        CSM_A,
        "SELECT public.cockpit_form_invites_today() AS r",
      );
      expect(mine.every(r => r.taskId === A)).toBe(true);
      const theirs = await as<Row[]>(
        CSM_B,
        "SELECT public.cockpit_form_invites_today() AS r",
      );
      expect(theirs).toEqual([]);
    });
  });

  test("an answer read in labels, with the signer's role and never an email", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      const s = await portalSubmit(
        v.inviteId,
        { recommend: 9, startStop: "Weekly reports" },
        { person: MEMBER_P, role: "member" },
      );
      const a = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_answer_read($1::uuid) AS r",
        [s.responseId],
      );
      expect(a).toMatchObject({
        formKey: "nps",
        title: "How are we doing?",
        source: "portal",
        signer: "a client member",
        lang: "en",
      });
      expect(a.fields).toEqual([
        {
          key: "recommend",
          label:
            "How likely are you to recommend Mahara to a friend or another business owner?",
          value: 9,
          display: "9/10",
        },
        {
          key: "startStop",
          label: "What should we start or stop doing?",
          value: "Weekly reports",
          display: "Weekly reports",
        },
      ]);
      expect(JSON.stringify(a).includes("@")).toBe(false);
      expect(
        (
          await refusal(() =>
            as(CSM_B, "SELECT public.cockpit_form_answer_read($1::uuid) AS r", [
              s.responseId,
            ]),
          )
        ).code,
      ).toBe("42501");
    });
  });
});

describe("hooks, the canary and go-live", () => {
  test("a submit hook that raises keeps the answer, closes the invite, writes hook_failed and answers ok", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await ex(`CREATE FUNCTION public.cockpit_form_hook_nps(p uuid) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at) VALUES ('hook-wrote', now(), true, 'x', now());
              RAISE EXCEPTION 'boom with an answer 9' USING ERRCODE = 'P0001'; END $$`);
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      const s = await portalSubmit(v.inviteId, { recommend: 9 });
      expect(s.ok).toBe(true);
      expect(
        await one(
          "SELECT state AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [v.inviteId],
        ),
      ).toBe("answered");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [s.responseId],
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT detail AS r FROM cockpit_form_invite_events WHERE invite_id = $1::uuid AND event = 'hook_failed'",
          [v.inviteId],
        ),
      ).toEqual({
        hook: "cockpit_form_hook_nps",
        sqlstate: "P0001",
      });
      // The hook's own write rolled back with it.
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_sync_state WHERE key = 'hook-wrote'",
        ),
      ).toBe(0);
      // An issue hook is a rule: its raise rolls the issue back.
      await ex(`CREATE FUNCTION public.cockpit_form_issue_hook_csat(p uuid) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'This client is already paused. Resume them first.' USING ERRCODE = '22023'; END $$`);
      await golive("csat");
      expect(
        (await refusal(() => issue(CSM_A, A, "csat", ["portal"]))).message,
      ).toBe("This client is already paused. Resume them first.");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invites WHERE form_key = 'csat'",
        ),
      ).toBe(0);
    });
  });

  test("the canary writes the test card only, its answer is shadow, its notices muted, never in today", async () => {
    await rolledBack(async () => {
      const r = await refusal(() =>
        one(
          "SELECT public.cockpit_form_invite_issue_core($1,'nps','{copy}',NULL,'ar',false,'{}'::jsonb,$2::uuid,'canary','{}'::jsonb) AS r",
          [A, rid()],
        ),
      );
      expect(r.message).toBe("The canary writes only the test card 86eywg1cq.");
      // A hook that queues a notice, as client-voice's will.
      await ex(`CREATE FUNCTION public.cockpit_form_hook_nps(p uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
        DECLARE r public.cockpit_form_responses;
        BEGIN SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p;
          PERFORM public.cockpit_slack_notice_queue('nps.received', 'nps:' || p::text, r.task_id, r.client_name,
            jsonb_build_object('responseId', p, 'score', (r.answers->>'recommend')::int), NULL, NULL, NULL); END $$`);
      const c = await one<Row>(
        "SELECT public.cockpit_form_invite_canary('nps', '{}'::jsonb, '{copy,whatsapp}') AS r",
      );
      expect(c.url).toMatch(/^https:\/\/portal\.maharamedia\.com\/f#f1/);
      expect(c.messageId).toBeTruthy();
      expect(
        await one("SELECT public.cockpit_form_client_live('nps') AS r"),
      ).toBe(false);
      const s = await tokenSubmit(tokenOf(c.url), { recommend: 2 });
      expect(s.ok).toBe(true);
      const resp = await q<Row>(
        "SELECT mode, answer_meta, task_id FROM cockpit_form_responses WHERE id = $1::uuid",
        [s.responseId],
      );
      expect(resp[0]).toMatchObject({ mode: "shadow", task_id: TEST_CARD });
      expect(resp[0].answer_meta.canary).toBe(true);
      expect(
        await q(
          "SELECT state, error FROM cockpit_slack_notices WHERE dedupe_key = $1",
          [`nps:${s.responseId}`],
        ),
      ).toEqual([
        { state: "muted", error: "Canary on the test card: not posted" },
      ]);
      expect(
        (
          await as<Row[]>(
            CEO,
            "SELECT public.cockpit_form_invites_today() AS r",
          )
        ).length,
      ).toBe(0);
      const notices = await as<Row>(
        CEO,
        "SELECT public.cockpit_form_notices_in() AS r",
      );
      expect(JSON.stringify(notices).includes(s.responseId)).toBe(false);
      // The answer reads for the test card only (the deploy's read-back).
      expect(
        (
          await as<Row>(
            CEO,
            "SELECT public.cockpit_form_answer_read($1::uuid) AS r",
            [s.responseId],
          )
        ).fields[0].value,
      ).toBe(2);
    });
  });

  test("go-live moves the exit survey to native at its v1 version; off withdraws; it never touches a staff form", async () => {
    await rolledBack(async () => {
      const audits = await one<number>(
        "SELECT count(*)::int AS r FROM cockpit_audit_log WHERE action = 'forms.client_go_live'",
      );
      const on = await golive("exit_survey");
      expect(on).toEqual({
        formKey: "exit_survey",
        live: true,
        version: 2,
        withdrawn: 0,
      });
      expect(
        await q(
          "SELECT provider, version, typeform_id FROM cockpit_forms WHERE key = 'exit_survey'",
        ),
      ).toEqual([{ provider: "native", version: 2, typeform_id: "knIe4eF3" }]);
      const e = await issue(CEO, C, "exit_survey", ["whatsapp"]);
      expect((await golive("exit_survey", false)).withdrawn).toBe(1);
      expect(
        await one(
          "SELECT state AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [e.inviteId],
        ),
      ).toBe("withdrawn");
      expect((await refusal(() => golive("pause"))).message).toBe(
        "Only a client form goes live here.",
      );
      expect((await refusal(() => golive("pause_request"))).message).toBe(
        "The pause_request form has no client version to go live with.",
      );
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_audit_log WHERE action = 'forms.client_go_live'",
        ),
      ).toBe(audits + 2);
    });
  });

  test("the schedule's issuer: NULL with the reason kept on a refusal, an invite otherwise", async () => {
    await rolledBack(async () => {
      expect(
        await one(
          "SELECT public.cockpit_form_invite_issue_system($1,'nps','{portal}','{}'::jsonb,'schedule') AS r",
          [A],
        ),
      ).toBeNull();
      expect(
        await one(
          "SELECT current_setting('cockpit.form_issue_refusal', true) AS r",
        ),
      ).toBe("This form opens to clients after its switch-on.");
      await golive("nps");
      const id = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system($1,'nps','{portal}','{\"round\":1}'::jsonb,'schedule') AS r",
        [A],
      );
      expect(
        await q(
          "SELECT origin, issued_by, issued_by_role, push_state, lang FROM cockpit_form_invites WHERE id = $1::uuid",
          [id],
        ),
      ).toEqual([
        {
          origin: "schedule",
          issued_by: null,
          issued_by_role: "the cockpit",
          push_state: "waiting",
          lang: "ar",
        },
      ]);
      expect(
        await one(
          "SELECT source AS r FROM cockpit_form_invite_events WHERE invite_id = $1::uuid AND event = 'issued'",
          [id],
        ),
      ).toBe("schedule");
      expect((await forPerson(ADMIN_P, id)).invite.from).toBeNull();
    });
  });
});

describe("the six notice kinds", () => {
  test("their settings rows, labels, shapes, and readers", async () => {
    const rows = await q<Row>(
      "SELECT kind, enabled, channel, mention_rule FROM cockpit_slack_notice_settings WHERE kind IN ('pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received') ORDER BY kind",
    );
    expect(
      rows.map(r => [r.kind, r.enabled, r.channel, r.mention_rule]),
    ).toEqual([
      ["csat.received", true, NPS, []],
      ["feedback.received", true, CSM_GENERAL, ["seat:csm"]],
      ["legacy.received", true, CSM_GENERAL, []],
      ["nps.received", true, NPS, []],
      ["pause.consent", true, CSM_GENERAL, ["seat:csm"]],
      ["voice.low", true, CSM_GENERAL, ["seat:csm"]],
    ]);
    for (const [kind, label] of [
      ["pause.consent", "Pause consent signed"],
      ["nps.received", "NPS answer in"],
      ["csat.received", "Onboarding survey answer in"],
      ["voice.low", "Low score"],
      ["feedback.received", "Portal feedback in"],
      ["legacy.received", "Old form link used"],
    ]) {
      expect(
        await one("SELECT public.cockpit_slack_notice_kind_label($1) AS r", [
          kind,
        ]),
      ).toBe(label);
      expect(
        await one("SELECT public.cockpit_slack_notice_shape($1) AS r", [kind]),
      ).toBe("post");
    }
    const read = await as<Row>(
      CSM_A,
      "SELECT public.cockpit_slack_notice_settings_read() AS r",
    );
    expect(read.notices.map((n: Row) => n.kind).slice(-6)).toEqual([
      "pause.consent",
      "nps.received",
      "csat.received",
      "voice.low",
      "feedback.received",
      "legacy.received",
    ]);
    const doctor = await as<Row>(
      "service",
      "SELECT public.cockpit_slack_notice_doctor_inputs() AS r",
    );
    expect(doctor.settings.map((s: Row) => s.kind).slice(-6)).toEqual([
      "pause.consent",
      "nps.received",
      "csat.received",
      "voice.low",
      "feedback.received",
      "legacy.received",
    ]);
  });

  test("live rules: a consent stops being news after a pause; a low score once its ticket is open; an old link needs no card", async () => {
    await rolledBack(async () => {
      await golive("nps");
      await golive("pause_consent");
      const p = await issue(CSM_A, A, "pause_consent", ["portal"], {
        origin: "pause",
        context: { start: await kuwaitToday(), restart: "2026-12-31" },
      });
      const s = await portalSubmit(p.inviteId, {
        reason: "travel",
        details: "Trip",
        consentTerm: true,
        consentOver14: true,
      });
      const id = await one<string>(
        "SELECT public.cockpit_slack_notice_queue('pause.consent', $1, $2, 'Acme Interiors', jsonb_build_object('responseId', $3::text), NULL, NULL, NULL)::text AS r",
        [`consent:${s.responseId}`, A, s.responseId],
      );
      const live = () =>
        one<Row>(
          "SELECT public.cockpit_slack_notice_live(n) AS r FROM cockpit_slack_notices n WHERE id = $1::uuid",
          [id],
        );
      expect(await live()).toEqual({ stillTrue: true, why: null });
      await q(
        "INSERT INTO cockpit_billing_events(clickup_task_id, kind, at, source, by_whom, detail) VALUES ($1, 'pause', now(), 'clickup', 'test', '{}'::jsonb)",
        [A],
      );
      expect(await live()).toEqual({
        stillTrue: false,
        why: "The pause was confirmed in the cockpit before the notice went out.",
      });
      // An old link with no card.
      const legacy = await one<string>(
        "SELECT public.cockpit_slack_notice_queue('legacy.received', 'legacy:x1', NULL, NULL, jsonb_build_object('responseId', $1::text), NULL, NULL, NULL)::text AS r",
        [s.responseId],
      );
      expect(legacy).toBeTruthy();
      // The low score: still news until a client_low_score request is raised for the card.
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      const low = await portalSubmit(v.inviteId, { recommend: 4 });
      const lid = await one<string>(
        "SELECT public.cockpit_slack_notice_queue('voice.low', $1, $2, 'Acme Interiors', jsonb_build_object('responseId', $3::text, 'score', 4), NULL, NULL, NULL)::text AS r",
        [`low:${low.responseId}`, A, low.responseId],
      );
      expect(
        (
          await one<Row>(
            "SELECT public.cockpit_slack_notice_live(n) AS r FROM cockpit_slack_notices n WHERE id = $1::uuid",
            [lid],
          )
        ).stillTrue,
      ).toBe(true);
      // Finance reads the client's voice; a creative-only seat never does.
      const fin = await as<Row>(
        FINANCE,
        "SELECT public.cockpit_slack_notice_read($1) AS r",
        [A],
      );
      expect(fin.notices.map((n: Row) => n.kind)).toContain("voice.low");
    });
  });
});

describe("pre-deploy review fixes (W34)", () => {
  const list = (loc: string, task = A, person = ADMIN_P, role = "admin") =>
    as<Row>("service", "SELECT public.portal_form_list($1,$2,$3,$4) AS r", [
      loc,
      task,
      person,
      role,
    ]);
  const get = (loc: string, invite: string, task = A, role = "admin") =>
    as<Row>(
      "service",
      "SELECT public.portal_form_get($1,$2,$3,$4,$5::uuid) AS r",
      [loc, task, ADMIN_P, role, invite],
    );

  test("a second open workspace on the card stops every portal read; a workspace that is not the invite's never sees or answers it", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["portal"]);
      expect(
        (await list("locA")).forms.map((f: Row) => f.id),
      ).toEqual([v.inviteId]);
      // A sheet mistake points a second open workspace at the same card: the card is no longer one workspace's.
      await q(
        "INSERT INTO portal_data.workspaces VALUES ('locA2', $1, 'Another client', 'Active', NULL)",
        [A],
      );
      for (const loc of ["locA", "locA2"]) {
        expect((await refusal(() => list(loc))).message).toBe(
          "form_invite_not_in_workspace",
        );
        expect((await refusal(() => get(loc, v.inviteId))).message).toBe(
          "form_invite_not_in_workspace",
        );
        expect(
          (await refusal(() => forPerson(ADMIN_P, null, "admin", loc))).message,
        ).toBe("form_invite_not_in_workspace");
      }
      // The first workspace closes: the second is now the card's only one, but the invite is still the first's.
      await q(
        "UPDATE portal_data.workspaces SET status = 'Cancelled' WHERE location_id = 'locA'",
      );
      expect((await list("locA2")).forms).toEqual([]);
      expect(await forPerson(ADMIN_P, null, "admin", "locA2")).toEqual({
        invite: null,
        reason: "nothing_waiting",
      });
      expect(
        await forPerson(ADMIN_P, v.inviteId, "admin", "locA2"),
      ).toEqual({ invite: null, reason: "nothing_waiting" });
      expect((await refusal(() => get("locA2", v.inviteId))).message).toBe(
        "form_invite_not_in_workspace",
      );
      expect(
        (await refusal(() => record(v.inviteId, ADMIN_P, "shown", "locA2")))
          .message,
      ).toBe("form_invite_not_in_workspace");
      expect(
        (
          await refusal(() =>
            portalSubmit(v.inviteId, { recommend: 9 }, { loc: "locA2" }),
          )
        ).message,
      ).toBe("form_invite_not_in_workspace");
      expect(
        await q(
          "SELECT id FROM cockpit_form_responses WHERE invite_id = $1::uuid",
          [v.inviteId],
        ),
      ).toEqual([]);
      expect(
        await q(
          "SELECT event FROM cockpit_form_invite_events WHERE invite_id = $1::uuid AND source = 'portal'",
          [v.inviteId],
        ),
      ).toEqual([]);
    });
  });

  test("a pause consent's context reaches the client as start, restart and over14 only: never the call id or the reason", async () => {
    await rolledBack(async () => {
      await golive("pause_consent");
      await presence("locA", 1, 1);
      const today = await kuwaitToday();
      const v = await issue(CSM_A, A, "pause_consent", ["portal", "whatsapp"], {
        origin: "pause",
        context: {
          start: today,
          restart: "2026-12-31",
          reasonCat: "client_asked",
          callId: "call-internal-123",
        },
      });
      // The cockpit keeps them on the invite.
      expect(
        await one<Row>(
          "SELECT context AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [v.inviteId],
        ),
      ).toMatchObject({ reasonCat: "client_asked", callId: "call-internal-123" });
      const portal = await get("locA", v.inviteId);
      expect(portal.invite.context).toEqual({
        start: today,
        restart: "2026-12-31",
        over14: true,
      });
      // The WhatsApp link, as the worker makes it.
      const body = await one<string>(
        "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
        [v.messageId],
      );
      await as(
        "service",
        "SELECT public.cockpit_client_message_approve($1::uuid,$2,$3,$4::uuid,'{}'::text[]) AS r",
        [v.messageId, body, sha(body), CSM_A],
      );
      const c = (
        await as<Row>(
          "service",
          "SELECT public.cockpit_client_message_claim(ARRAY['form_invite'], NULL, 1) AS r",
        )
      ).rows[0];
      await as(
        "service",
        "SELECT public.cockpit_client_message_intent($1::uuid,$2::uuid) AS r",
        [c.id, c.claimToken],
      );
      const made = await as<Row>(
        "service",
        "SELECT public.cockpit_client_message_invite_link($1::uuid,$2::uuid) AS r",
        [c.id, c.claimToken],
      );
      const open = await tokenOpen(tokenOf(made.url));
      expect(open.ok).toBe(true);
      expect(open.invite.context).toEqual({
        start: today,
        restart: "2026-12-31",
        over14: true,
      });
      expect(JSON.stringify(open)).not.toContain("call-internal-123");
      expect(JSON.stringify(portal)).not.toContain("client_asked");
    });
  });

  test("a failed or refused form link is not reopened: the refusal says to withdraw and send again", async () => {
    await rolledBack(async () => {
      await golive("nps");
      const v = await issue(CSM_A, A, "nps", ["whatsapp"], { lang: "en" });
      const body = await one<string>(
        "SELECT body AS r FROM cockpit_client_messages WHERE id = $1::uuid",
        [v.messageId],
      );
      for (const state of ["failed", "refused"]) {
        // Where the sender leaves it (its guard is not under test here).
        await q("SET session_replication_role = replica");
        await q(
          "UPDATE cockpit_client_messages SET state = $2 WHERE id = $1::uuid",
          [v.messageId, state],
        );
        await q("SET session_replication_role = origin");
        expect(
          (
            await refusal(() =>
              as<Row>(
                "service",
                "SELECT public.cockpit_client_message_approve($1::uuid,$2,$3,$4::uuid,'{}'::text[]) AS r",
                [v.messageId, body, sha(body), CSM_A],
              ),
            )
          ).message,
        ).toBe(
          "This message was not sent. Withdraw the form and send it again from Send a form.",
        );
      }
    });
  });
});
