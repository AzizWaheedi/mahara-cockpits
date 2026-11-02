/**
 * Stage 4: the kickoff and the client onboarding native (20261102j_stage4_native.sql;
 * docs/forms/WAVE56-CONTRACT.md 2.6, 3.3 (j), 3.8, 4.13 to 4.15 and the stage4 row of section 8,
 * revision 1) on an isolated PostgreSQL with Supabase's default privileges on.
 *
 * It stands on the waves 1-2 chain and waves 3-4 exactly as forms-editor-supabase.test.ts builds
 * them (20261101l to r, then 20261102a to f), then on 20261102g, h and i when all three are on the
 * branch. While client-tail's 20261102i is not there yet, a stand-in gives j the objects it reads
 * by name (the invite purpose onboarding and origin portal, the heading type and the text format,
 * the issue path with origin portal, the onboarding rule of cockpit_form_card_allows), each the
 * live body with the smallest edit, so the merged branch runs this test on the real files.
 *
 * Covered: j applies twice and keeps a switched-on stage; the drift guard; the after-md5 values;
 * the registry on Typeform with the live version-1 arrays and version 2 present; the onboarding
 * schema passes the schema check and the text rule; the option maps; the CHECKs; the relay
 * delivery; row security and grants; the go-live writes the version-2 arrays and off restores
 * version 1 (recap never the cockpit's) and refuses on drift; the kickoff answers check; the submit
 * refused while not live except the CEO's canary on the test card; the read model in the Typeform
 * shape; every kickoff effect; New MRR with reason_cat new_client, none when equal, none for 0
 * against an empty MRR; one kickoff per card counting Typeform kickoffs (the reason, then only the
 * handoff comment); Make's dry runs before the go-live; the prefill; the native read model kept
 * against the sync; an old kickoff link stored legacy; the portal's open (one invite, answeredAt);
 * every onboarding effect once; the relay's claim, send, unknown and retry; a card with a stored
 * Typeform answer (no invite, no effects, legacy); the Typeform door equal to the portal answer;
 * system requests deduped; the phase messages' approve and claim; the parity plan writes nothing.
 * Every person, client and value is invented; the CEO's address is read from the CEO gate.
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
import { KICKOFF_SQL } from "../../../hermes/ceo-refresh/native/adapters/growth.js";
import {
  CLIENT_SCHEMAS,
  EXIT_SURVEY_SCHEMA,
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

// --- Waves 5-6 -------------------------------------------------------------------------------

const AFTER_W34 = [
  "20261102e_record_make_answer_size.sql",
  "20261102f_form_responses_answer_size.sql",
] as const;
const W56 = [
  "20261102g_money_rails_w5.sql",
  "20261102h_wins_pay.sql",
  "20261102i_client_tail.sql",
] as const;
const J = "20261102j_stage4_native.sql";
/** g, h and i when all three are on the branch (the merged branch); else client-tail's stand-in below. */
const REAL_W56 = W56.every(onBranch);

/**
 * What j reads of client-tail (20261102i) by name, made only while i is not on the branch: the
 * invite purpose onboarding and origin portal (2.5), the schema types heading and the text format
 * (3.6), the issue path for onboarding with origin portal, and the onboarding rule of
 * cockpit_form_card_allows (2.2: refused when the card holds any onboarding answer or kickoff).
 * Each is the live body with the smallest text edit, so the real i replaces it whole.
 */
const CLIENT_TAIL_STANDIN = String.raw`
DO $s$
DECLARE d text;
BEGIN
  ALTER TABLE public.cockpit_form_invites DROP CONSTRAINT IF EXISTS cockpit_form_invites_purpose_check;
  ALTER TABLE public.cockpit_form_invites ADD CONSTRAINT cockpit_form_invites_purpose_check
    CHECK (purpose IN ('pause_consent','exit_survey','nps','csat','bank_receipt','onboarding'));
  ALTER TABLE public.cockpit_form_invites DROP CONSTRAINT IF EXISTS cockpit_form_invites_origin_check;
  ALTER TABLE public.cockpit_form_invites ADD CONSTRAINT cockpit_form_invites_origin_check
    CHECK (origin IN ('csm','schedule','pause','churn','canary','billing','portal'));

  d := pg_get_functiondef('public.cockpit_form_schema_check(jsonb)'::regprocedure);
  d := replace(d, $q$'options','maxLength','showIf','boldIf')) THEN$q$, $q$'options','maxLength','showIf','boldIf','format')) THEN$q$);
  d := replace(d, $q$t NOT IN ('scale','choice','multi','text','longtext','tick') THEN$q$, $q$t NOT IN ('scale','choice','multi','text','longtext','tick','heading') THEN$q$);
  d := replace(d, $q$IF jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN$q$, $q$IF t <> 'heading' AND jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN$q$);
  EXECUTE d;

  d := pg_get_functiondef('public.cockpit_form_answers_check(jsonb,jsonb,jsonb)'::regprocedure);
  d := replace(d, E'    CONTINUE WHEN k IS NULL;\n', E'    CONTINUE WHEN k IS NULL;\n    CONTINUE WHEN t = ''heading'';\n');
  EXECUTE d;

  d := pg_get_functiondef('public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb)'::regprocedure);
  d := replace(d, $q$p_form_key NOT IN ('pause_consent','exit_survey','nps','csat') THEN$q$, $q$p_form_key NOT IN ('pause_consent','exit_survey','nps','csat','onboarding') THEN$q$);
  d := replace(d, $q$WHEN 'nps' THEN ARRAY['round']$q$, $q$WHEN 'nps' THEN ARRAY['round'] WHEN 'onboarding' THEN ARRAY['businessName']$q$);
  EXECUTE d;

  d := pg_get_functiondef('public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text)'::regprocedure);
  d := replace(d, $q$IF p_origin IS DISTINCT FROM 'schedule' THEN$q$, $q$IF p_origin NOT IN ('schedule','portal') THEN$q$);
  d := replace(d, $q$v_id, 'schedule', jsonb_build_object('id', NULL, 'email', NULL, 'role', 'the cockpit', 'source', 'schedule'));$q$,
                  $q$v_id, p_origin, jsonb_build_object('id', NULL, 'email', NULL, 'role', 'the cockpit', 'source', p_origin));$q$);
  EXECUTE d;

  d := pg_get_functiondef('public.cockpit_form_card_allows(text,text)'::regprocedure);
  d := replace(d, E'BEGIN\n  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;',
    E'BEGIN\n  IF p_form_key = ''onboarding'' THEN\n'
    || E'    IF EXISTS (SELECT 1 FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id\n'
    || E'                AND (jsonb_typeof(o.forms->''onboarding'') = ''object'' OR jsonb_typeof(o.forms->''kickoff'') = ''object''))\n'
    || E'       OR EXISTS (SELECT 1 FROM public.cockpit_form_responses r WHERE r.task_id = p_task_id\n'
    || E'                AND r.form_key IN (''onboarding'',''kickoff'') AND r.state NOT IN (''draft'',''void'') AND r.mode = ''live'') THEN\n'
    || E'      RETURN ''An onboarding answer is already stored for this client.'';\n'
    || E'    END IF;\n    RETURN NULL;\n  END IF;\n'
    || E'  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;');
  EXECUTE d;
END $s$;`;

const TEST_CARD = "86eywg1cq";
const C = "taskC1"; // Cedar Homes: on the sheet, no MRR, no answers, a portal workspace
const D_CARD = "taskD1"; // Dune Studio: a stored Typeform onboarding answer
const E = "taskE1"; // Elm Works: a portal workspace, answers by the old link after the go-live
const KREF = {
  payment: "75e97e7d-4c19-437a-b4b8-67570c29344f",
  recording: "b5578678-d0c2-475b-b66f-7ea54d55fe31",
  contract: "c0000001-0000-4000-8000-00000000000a",
  service: "c0000001-0000-4000-8000-000000000007",
  maharaOs: "ad562fc2-6858-4e37-81c5-c4cc2375a330",
};
const OREF = {
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  email: "7994f0d2-baeb-451b-983a-816290873a68",
  phone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  lastRevenue: "7ff5d37a-df7f-4002-8248-d0b4af6c28e8",
  freeConsults: "ec89854f-d006-402b-958a-91738e2b3e7a",
  appointments: "b370341c-6ea3-43c9-bd8c-16e278a2d2d5",
};

/** Invented onboarding answers on the read model's Typeform shape. */
const typeformOnboarding = (token: string, at: string) => ({
  form_id: "KFRCXPFx",
  response_id: token,
  submitted_at: at,
  answers: [
    {
      ref: OREF.businessName,
      title: "Business Name",
      value: "Acme Interiors Co",
    },
    { ref: OREF.email, title: "Email", value: "owner@acme.invalid" },
    { ref: OREF.phone, title: "Phone", value: "+96500000001" },
    {
      ref: OREF.lastRevenue,
      title: "Last Calendar Year - How Much Total Revenue did you do?",
      value: "120000",
    },
  ],
});

async function seedStage4() {
  await asOwner();
  // The queue's kinds as live has them (11.2-f): this chain applies 20261009j after 20261029t, which
  // narrows the kinds again; the live table takes form rows since 2b.
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;
    ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
      CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));`);
  await db.exec(`
    INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage, client_status, next_payment_date, mrr_usd)
    VALUES ('${C}', 'Cedar Homes', 'active', 'Brand Blueprint Booked', '2026-11-20', NULL),
           ('${D_CARD}', 'Dune Studio', 'active', 'Active', '2026-11-21', 1200),
           ('${E}', 'Elm Works', 'active', 'Onboarding Booked', '2026-11-22', NULL)
    ON CONFLICT DO NOTHING;
    INSERT INTO portal_data.workspaces(location_id, clickup_id, name, status) VALUES
      ('locCedar01', '${C}', 'Cedar Homes', 'Active'), ('locDune01', '${D_CARD}', 'Dune Studio', 'Active'),
      ('locElm01', '${E}', 'Elm Works', 'Active'), ('locTest01', '${TEST_CARD}', 'Test card', 'Active')
    ON CONFLICT DO NOTHING;`);
  const rows: [string, string, unknown][] = [
    [
      A,
      "Acme Interiors",
      { onboarding: typeformOnboarding("tokAcme0001", "2026-10-20T09:00:00Z") },
    ],
    [
      B,
      "Beta Build",
      {
        kickoff: {
          form_id: "tG7dnxBn",
          response_id: "tokBetaKick1",
          submitted_at: "2026-10-15T10:00:00Z",
          answers: [
            { ref: KREF.payment, title: "Payment Amount", value: "900" },
          ],
          payment: "900",
          recording: null,
        },
      },
    ],
    [C, "Cedar Homes", {}],
    [
      D_CARD,
      "Dune Studio",
      { onboarding: typeformOnboarding("tokDune0001", "2026-10-01T09:00:00Z") },
    ],
    [E, "Elm Works", {}],
    [TEST_CARD, "Test card", {}],
  ];
  for (const [task, name, forms] of rows)
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, forms) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING",
      [task, name, JSON.stringify(forms)],
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
  for (const file of [...CHAIN, R]) await db.exec(withoutCron(migration(file)));
  if (REAL.length > 0) await realAPrereqs(PORTAL);
  else await db.exec(PORTAL);
  for (const file of REAL) await db.exec(withoutCron(migration(file)));
  await standIns();
  await db.exec(withoutCron(migration(D)));
  for (const file of AFTER_W34) await db.exec(migration(file));
  if (REAL_W56)
    for (const file of W56) await db.exec(withoutCron(migration(file)));
  else await db.exec(CLIENT_TAIL_STANDIN);
  await db.exec(withoutCron(migration(J)));
  await seedStage4();
}, 900_000);
afterAll(async () => {
  await db?.close();
});

// --- Helpers for this file -------------------------------------------------------------------

const json = (v: unknown) => JSON.stringify(v);
const uuid = () => crypto.randomUUID();
const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [fn],
  );
const submit = (who: string, task: string, answers: unknown, req = uuid()) =>
  as<any>(who, "SELECT public.cockpit_kickoff_submit($1, $2::jsonb, $3) AS r", [
    task,
    json(answers),
    req,
  ]);
const effects = (responseId: string) =>
  q<Row>(
    "SELECT effect_key, owner, delivery, state, reason, delivery_ref, plan FROM public.cockpit_form_effects WHERE response_id = $1 ORDER BY created_at, effect_key",
    [responseId],
  );
const byKey = (rows: Row[]) =>
  Object.fromEntries(rows.map(r => [r.effect_key, r]));
const goLive = (form: string, on: boolean) =>
  one<any>(
    "SELECT public.cockpit_form_stage4_go_live($1, $2, 'test deploy') AS r",
    [form, on],
  );
const settings = (key: string, value: unknown) =>
  ex(`INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ('${key}', '${json(value).replace(/'/g, "''")}'::jsonb, 'test')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
const portalOpen = (loc: string, task: string) =>
  as<any>(
    "service",
    "SELECT public.portal_form_onboarding_open($1, $2, 'owner@client.invalid', 'admin') AS r",
    [loc, task],
  );
const KICKOFF_ANSWERS = {
  contractStatus: "Signed",
  serviceAdvertised: ["Fit out and renovation", "Design and build"],
  maharaOsAccess: "Logged In",
  paymentAmount: 1500,
  callRecording: "https://fathom.video/share/abcdef",
  newMrrUsd: 2500,
};
const MAPS = {
  3: "https://mahara-onboarding-map.vercel.app/?phase=3&cid={task}",
  4: "https://mahara-onboarding-map.vercel.app/?phase=4&cid={task}",
};
const MESSAGES = {
  phase3: "هلا فريق {client}، خلصنا المرحلة الثالثة. شوفوا الخريطة: {map_link}",
  phase4:
    "هلا فريق {client}، خلصنا مكالمة الانطلاق. المرحلة الرابعة هني: {map_link}",
};
async function addRequestTypes() {
  for (const [key, idx, team, list] of [
    ["client_onboarding", 90, "tech", "901816723190"],
    ["brand_dna", 91, "creative", "901818016338"],
  ] as const)
    await one(`SELECT public.cockpit_request_type_add($1::jsonb) AS r`, [
      json({
        key,
        type_index: idx,
        label: key === "brand_dna" ? "Brand DNA" : "Client onboarding",
        clickup_option_name: key,
        request_type_option_id: uuid(),
        team,
        targets:
          key === "brand_dna"
            ? [
                {
                  part: "creative",
                  name_suffix: " - Brand DNA",
                  list_id: list,
                  team,
                  template_id: null,
                  template_name: null,
                  owner_rule: "creative_strategist",
                  owner_clickup_id: null,
                  when: null,
                },
              ]
            : [
                {
                  part: "tech",
                  name_suffix: " - Technical Onboarding Check",
                  list_id: list,
                  team,
                  template_id: null,
                  template_name: null,
                  owner_rule: "systems_manager",
                  owner_clickup_id: null,
                  when: null,
                },
                {
                  part: "creative",
                  name_suffix: " - Creative Onboarding",
                  list_id: "901818016338",
                  team: "creative",
                  template_id: null,
                  template_name: null,
                  owner_rule: "creative_strategist",
                  owner_clickup_id: null,
                  when: null,
                },
              ],
        fields: [
          { key: "client", label: "Client", kind: "client", required: true },
          {
            key: "details",
            label: "Details",
            kind: "details",
            required: false,
          },
          { key: "deadline", label: "Due", kind: "deadline", required: false },
          {
            key: "priority",
            label: "Priority",
            kind: "priority",
            required: false,
          },
        ],
        due_days: 2,
        priority: "high",
      }),
    ]);
}

// --- The file --------------------------------------------------------------------------------

describe("the file (2.1, 2.6)", () => {
  test("applies a second time and keeps a switched-on stage", async () => {
    await rolledBack(async () => {
      await ex(
        `UPDATE public.cockpit_settings SET value = value || '{"kickoff":true}' WHERE key = 'forms.stage4'`,
      );
      await ex(
        withoutCron(migration(J))
          .replace(/^BEGIN;/m, "")
          .replace(/COMMIT;\s*$/m, ""),
      );
      expect(
        await one(
          "SELECT value->'kickoff' AS r FROM public.cockpit_settings WHERE key = 'forms.stage4'",
        ),
      ).toBe(true);
    });
    expect(
      await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'forms.stage4'",
      ),
    ).toEqual({ kickoff: false, onboarding: false });
  });

  test("the drift guard refuses a changed body", async () => {
    await rolledBack(async () => {
      const def = await one<string>(
        "SELECT pg_get_functiondef('public.cockpit_form_effect_gate(text,text)'::regprocedure) AS r",
      );
      await ex(
        def.replace(
          "-- A queued effect before an unknown one, then the oldest.",
          "-- changed",
        ),
      );
      const r = await refusal(() =>
        ex(
          withoutCron(migration(J))
            .replace(/^BEGIN;/m, "")
            .replace(/COMMIT;\s*$/m, ""),
        ),
      );
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_form_effect_gate(text,text) changed since the waves 5-6 contract read it; stop and re-read it.",
      );
    });
  });

  test("the after-md5 values in the guard are this file's bodies", async () => {
    const sql = migration(J);
    for (const fn of [
      "cockpit_forms_effects_valid(jsonb)",
      "cockpit_form_effect_gate(text,text)",
      "cockpit_client_message_claim(text[],text[],integer)",
      "cockpit_client_message_view(public.cockpit_client_messages)",
      "cockpit_client_message_approve(uuid,text,text,uuid,text[])",
      "cockpit_form_record_legacy(jsonb)",
    ]) {
      const md5 = await md5Of(`public.${fn}`);
      expect(sql).toContain(`('public.${fn}', '`);
      const line =
        sql.split("\n").find(l => l.includes(`('public.${fn}', '`)) ?? "";
      expect(line).toContain(`'${md5}')`);
    }
  });

  test("the registry stays on Typeform with the live version-1 arrays; version 2 is present", async () => {
    for (const form of ["kickoff", "onboarding"]) {
      const row = await one<any>(
        "SELECT to_jsonb(f) AS r FROM public.cockpit_forms f WHERE key = $1",
        [form],
      );
      expect(row.provider).toBe("typeform");
      expect(row.version).toBe(1);
      expect(row.effects).toEqual(
        await one("SELECT public.cockpit_form_stage4_effects($1, 1) AS r", [
          form,
        ]),
      );
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_form_versions WHERE form_key = $1 AND version = 2",
          [form],
        ),
      ).toBe(1);
    }
    const v2 = await one<any>(
      "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
    );
    expect(
      await one("SELECT public.cockpit_form_schema_check($1::jsonb) AS r", [
        json(v2),
      ]),
    ).toBeNull();
    expect(
      await one(
        "SELECT public.cockpit_form_schema_text_problem($1::jsonb) AS r",
        [json(v2)],
      ),
    ).toBeNull();
    expect(v2.fields.filter((f: any) => f.type === "heading")).toHaveLength(3);
    expect(v2.fields.filter((f: any) => f.type !== "heading")).toHaveLength(36);
    const k2 = await one<any>(
      "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'kickoff' AND version = 2",
    );
    expect(k2.lives).toBe("cockpit");
    expect(k2.fields).toHaveLength(42);
    expect(k2.fields.at(-1)).toMatchObject({
      key: "newMrrUsd",
      type: "number",
      required: true,
    });
  });

  test("the option maps hold the nine dropdowns, each answer its own option name", async () => {
    expect(
      await one(
        "SELECT count(DISTINCT field_id)::int AS r FROM public.cockpit_form_option_maps",
      ),
    ).toBe(9);
    expect(
      await one(
        "SELECT count(*)::int AS r FROM public.cockpit_form_option_maps WHERE answer <> option_name",
      ),
    ).toBe(0);
    expect(
      await one(
        "SELECT count(*)::int AS r FROM public.cockpit_form_option_maps",
      ),
    ).toBe(47);
  });

  test("CHECKs: phase kinds, form requests, relay deliveries", async () => {
    const def = (t: string, c: string) =>
      one<string>(
        "SELECT pg_get_constraintdef(oid) AS r FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2",
        [t, c],
      );
    expect(
      await def(
        "public.cockpit_client_messages",
        "cockpit_client_messages_kind_check",
      ),
    ).toContain("'phase4'");
    expect(
      await def("public.cockpit_requests", "cockpit_requests_source_check"),
    ).toContain("'form'");
    expect(
      await def("public.cockpit_requests", "cockpit_requests_check1"),
    ).toContain("'form'");
    expect(
      await def(
        "public.cockpit_form_effects",
        "cockpit_form_effects_delivery_check",
      ),
    ).toContain("'relay'");
  });

  test("effects_valid accepts relay and still refuses any other new delivery", async () => {
    const ok = (d: string) =>
      one<boolean>(
        "SELECT public.cockpit_forms_effects_valid($1::jsonb) AS r",
        [json([{ key: "x_y", owner: "make", delivery: d, label: "X" }])],
      );
    expect(await ok("relay")).toBe(true);
    expect(await ok("requests")).toBe(false);
    expect(await ok("sql")).toBe(true);
  });

  test("new tables: row security, no browser grant, no delete", async () => {
    for (const t of ["cockpit_form_option_maps", "cockpit_form_relay_outbox"]) {
      expect(
        await one(
          "SELECT relrowsecurity AS r FROM pg_class WHERE oid = $1::regclass",
          [`public.${t}`],
        ),
      ).toBe(true);
      for (const role of ["anon", "authenticated"])
        expect(
          await one("SELECT has_table_privilege($1, $2, 'SELECT') AS r", [
            role,
            `public.${t}`,
          ]),
        ).toBe(false);
    }
    const r = await refusal(() =>
      ex("DELETE FROM public.cockpit_form_option_maps"),
    );
    expect(r.message).toBe("Forms records are never deleted");
  });

  test("grants: two seat RPCs, the portal, relay and door RPCs for the service, everything else the owner's", async () => {
    const acl = (fn: string) =>
      one<string>(
        "SELECT coalesce(proacl::text, '') AS r FROM pg_proc WHERE oid = to_regprocedure($1)",
        [`public.${fn}`],
      );
    for (const fn of [
      "cockpit_kickoff_prefill(text)",
      "cockpit_kickoff_submit(text,jsonb,uuid)",
    ])
      expect(await acl(fn)).toBe(
        "{postgres=X/postgres,authenticated=X/postgres}",
      );
    for (const fn of [
      "portal_form_onboarding_open(text,text,text,text)",
      "cockpit_form_onboarding_typeform(jsonb)",
      "cockpit_form_relay_claim(integer)",
      "cockpit_form_relay_done(bigint,uuid,text,jsonb)",
      "cockpit_form_parity_plan(text,jsonb)",
    ])
      expect(await acl(fn)).toBe(
        "{postgres=X/postgres,service_role=X/postgres}",
      );
    for (const fn of [
      "cockpit_form_stage4_go_live(text,boolean,text)",
      "cockpit_form_stage4_plan(uuid,boolean)",
      "cockpit_request_create_system(text,text,jsonb,uuid)",
      "cockpit_form_hook_onboarding(uuid)",
      "cockpit_kickoff_answers_check(jsonb)",
      "cockpit_form_stage4_effects(text,integer)",
      "cockpit_form_effect_gate(text,text)",
      "cockpit_forms_effects_valid(jsonb)",
    ])
      expect(await acl(fn)).toBe("{postgres=X/postgres}");
  });
});

// --- The go-live -----------------------------------------------------------------------------

describe("the go-live (4.15.2)", () => {
  test("on writes exactly the version-2 arrays, off restores version 1, recap is never the cockpit's", async () => {
    await rolledBack(async () => {
      for (const form of ["kickoff", "onboarding"]) {
        const on = await goLive(form, true);
        const v2 = await one<any>(
          "SELECT public.cockpit_form_stage4_effects($1, 2) AS r",
          [form],
        );
        const row = await one<any>(
          "SELECT to_jsonb(f) AS r FROM public.cockpit_forms f WHERE key = $1",
          [form],
        );
        expect(row.effects).toEqual(v2);
        expect(row.provider).toBe("native");
        expect(row.version).toBe(2);
        expect(row.typeform_id).toBe(
          form === "kickoff" ? "tG7dnxBn" : "KFRCXPFx",
        );
        expect(on.on).toBe(true);
        expect(
          await one(
            "SELECT value->$1 AS r FROM public.cockpit_settings WHERE key = 'forms.stage4'",
            [form],
          ),
        ).toBe(true);
        if (form === "kickoff")
          expect(v2.find((e: any) => e.key === "recap").owner).toBe("shadow");
        await goLive(form, false);
        const back = await one<any>(
          "SELECT to_jsonb(f) AS r FROM public.cockpit_forms f WHERE key = $1",
          [form],
        );
        expect(back.effects).toEqual(
          await one("SELECT public.cockpit_form_stage4_effects($1, 1) AS r", [
            form,
          ]),
        );
        expect(back.provider).toBe("typeform");
        expect(back.version).toBe(1);
      }
      expect(
        await one("SELECT public.cockpit_form_client_live('onboarding') AS r"),
      ).toBe(false);
    });
    const arrays = await one<any>(
      "SELECT jsonb_build_array(public.cockpit_form_stage4_effects('kickoff', 2), public.cockpit_form_stage4_effects('onboarding', 2)) AS r",
    );
    for (const a of arrays)
      for (const e of a)
        if (e.key === "recap") expect(e.owner).not.toBe("cockpit");
    expect(arrays[1].map((e: any) => [e.key, e.delivery])).toEqual([
      ["profile_fields", "clickup_queue"],
      ["raw_answers_comment", "clickup_queue"],
      ["map_phase3", "clickup_queue"],
      ["client_data_row", "relay"],
      ["github_dispatch", "relay"],
      ["phase3_whatsapp", "client_message"],
      ["brand_dna_task", "sql"],
      ["read_model", "sql"],
    ]);
    expect(arrays[0].map((e: any) => [e.key, e.delivery])).toEqual([
      ["handoff_comment", "clickup_queue"],
      ["native_status", "clickup_queue"],
      ["card_fields", "clickup_queue"],
      ["onboarding_tasks", "sql"],
      ["map_phase4", "clickup_queue"],
      ["phase4_whatsapp", "client_message"],
      ["kickoff_notice", "slack_notice"],
      ["new_mrr", "sql"],
      ["recap", "client_message"],
    ]);
  });

  test("it refuses on drift", async () => {
    await rolledBack(async () => {
      await ex(
        `UPDATE public.cockpit_forms SET effects = '[]' WHERE key = 'kickoff'`,
      );
      const r = await refusal(() => goLive("kickoff", true));
      expect(r.code).toBe("55000");
      expect(r.message).toContain("The kickoff effects changed");
    });
  });
});

// --- The kickoff -----------------------------------------------------------------------------

describe("the kickoff (4.13, 3.3)", () => {
  test("the answers check: codes per question", async () => {
    const check = (a: unknown) =>
      one<any>("SELECT public.cockpit_kickoff_answers_check($1::jsonb) AS r", [
        json(a),
      ]);
    expect((await check(KICKOFF_ANSWERS)).ok).toBe(true);
    const bad = await check({
      contractStatus: "Maybe",
      serviceAdvertised: ["Pools"],
      paymentAmount: "x",
      callRecording: "not a link",
      whatsappAdd: "y".repeat(501),
      surprise: 1,
    });
    expect(bad.errors).toEqual({
      contractStatus: "option",
      serviceAdvertised: "option",
      paymentAmount: "range",
      callRecording: "format",
      whatsappAdd: "length",
      surprise: "unknown",
      newMrrUsd: "required",
    });
    expect((await check({ ...KICKOFF_ANSWERS, newMrrUsd: -1 })).errors).toEqual(
      { newMrrUsd: "range" },
    );
  });

  test("refused while not live, except the CEO's canary on the test card", async () => {
    const r = await refusal(() => submit(CSM_A, A, KICKOFF_ANSWERS));
    expect(r.message).toBe(
      "The kickoff opens here after its switch-on. Until then use the kickoff form as before.",
    );
    const other = await refusal(() => submit(CSM_A, B, KICKOFF_ANSWERS));
    expect(other.code).toBe("42501");
    await rolledBack(async () => {
      const out = await submit(CEO, TEST_CARD, KICKOFF_ANSWERS);
      expect(out.ok).toBe(true);
      const fx = byKey(await effects(out.responseId));
      expect(fx.handoff_comment).toMatchObject({
        owner: "cockpit",
        state: "queued",
      });
      expect(fx.native_status.state).toBe("queued");
      expect(fx.card_fields.state).toBe("queued");
      expect(fx.map_phase4).toMatchObject({
        state: "failed",
        reason:
          "The phase 4 map link is not set up yet (onboarding.map_urls), so the map was not moved.",
      });
      expect(fx.phase4_whatsapp.state).toBe("failed");
      expect(fx.onboarding_tasks).toMatchObject({
        state: "failed",
        reason:
          "The client_onboarding request type is not set up yet, so no task was made.",
      });
      expect(fx.new_mrr).toMatchObject({
        state: "skipped",
        reason:
          "This card is not on the billing sheet, so New MRR is not written.",
      });
      expect(fx.recap).toMatchObject({ owner: "shadow", state: "dry_run" });
      expect(fx.kickoff_notice.state).toBe("queued");
      // The gate lets the canary's card writes through before the go-live.
      const g = await one<any>(
        "SELECT public.cockpit_form_effect_gate('clickup_queue', $1) AS r",
        [fx.handoff_comment.delivery_ref],
      );
      expect(g.ok).toBe(true);
      const qrow = await one<any>(
        "SELECT payload AS r FROM public.cockpit_clickup_writeback_queue WHERE id = $1::uuid",
        [fx.card_fields.delivery_ref],
      );
      expect(qrow.formKey).toBe("kickoff");
      expect(
        qrow.fields.map((f: any) => [f.label, f.optionName ?? f.value]),
      ).toEqual([
        ["Client Status", "Brand Blueprint Booked♠️"],
        ["Mahara OS Access", "Logged In"],
        ["Contract Status", "Signed"],
        ["Service Advertised", "Design and build"],
        [
          "🧬 Brand Blueprint Form Link",
          `https://cockpit.maharamedia.com/client-success/clients/${TEST_CARD}/present/blueprint?view=prep`,
        ],
      ]);
    });
  });

  test("live: the read model in the Typeform shape, the effects, New MRR, a retry", async () => {
    await rolledBack(async () => {
      await goLive("kickoff", true);
      await settings("onboarding.map_urls", MAPS);
      await settings("stage4.messages", MESSAGES);
      await addRequestTypes();
      const req = uuid();
      const out = await submit(CSM_A, A, KICKOFF_ANSWERS, req);
      expect(out.ok).toBe(true);
      const model = await one<any>(
        "SELECT forms->'kickoff' AS r FROM public.cockpit_client_onboarding WHERE clickup_task_id = $1",
        [A],
      );
      expect(model.form_id).toBe("native");
      expect(model.response_id).toBe(out.responseId);
      expect(model.payment).toBe("1500");
      expect(model.recording).toBe("https://fathom.video/share/abcdef");
      expect(model.answers.find((a: any) => a.ref === KREF.service).value).toBe(
        "Design and build, Fit out and renovation",
      );
      expect(model.answers.find((a: any) => a.ref === KREF.contract)).toEqual({
        ref: KREF.contract,
        title: "Contract status",
        value: "Signed",
      });
      // growth.js reads the native kickoff's payment exactly as a Typeform one (4.13.2).
      const cash = await q<Row>(KICKOFF_SQL);
      expect(cash.find(r => r.clickup_task_id === A)).toMatchObject({
        payment: "1500",
      });
      expect(cash.find(r => r.clickup_task_id === B)).toMatchObject({
        payment: "900",
      });
      const fx = byKey(await effects(out.responseId));
      for (const k of [
        "handoff_comment",
        "native_status",
        "card_fields",
        "map_phase4",
        "phase4_whatsapp",
        "kickoff_notice",
      ])
        expect(fx[k].state).toBe("queued");
      expect(fx.onboarding_tasks.state).toBe("delivered");
      expect(fx.new_mrr.state).toBe("delivered");
      const ev = await one<any>(
        "SELECT to_jsonb(e) AS r FROM public.cockpit_billing_events e WHERE id = $1::bigint",
        [fx.new_mrr.delivery_ref],
      );
      expect(ev).toMatchObject({
        kind: "mrr",
        source: "csm",
        from_value: "2000",
        to_value: "2500",
      });
      expect(ev.detail).toMatchObject({
        reason_cat: "new_client",
        reason: "Kickoff: New MRR answer",
        seat_role: expect.any(String),
      });
      expect(
        await one(
          "SELECT mrr_usd::int AS r FROM public.cockpit_billing_accounts WHERE clickup_task_id = $1",
          [A],
        ),
      ).toBe(2500);
      const handoff = fx.handoff_comment.plan.comment_text as string;
      expect(handoff).toStartWith("KICKOFF HANDOFF for Acme Interiors");
      expect(handoff).toContain("Business name: Acme Interiors Co");
      expect(handoff).toContain("Contract status: Signed");
      expect(handoff).toContain("New MRR: $2500 a month");
      const msg = await one<any>(
        "SELECT to_jsonb(m) AS r FROM public.cockpit_client_messages m WHERE id = $1::uuid",
        [fx.phase4_whatsapp.delivery_ref],
      );
      expect(msg).toMatchObject({ kind: "phase4", state: "draft" });
      expect(msg.body).toContain(`?phase=4&cid=${A}`);
      const reqRow = await one<any>(
        "SELECT to_jsonb(q) AS r FROM public.cockpit_requests q WHERE id = $1::uuid",
        [fx.onboarding_tasks.delivery_ref],
      );
      expect(reqRow).toMatchObject({
        source: "form",
        form_response_id: out.responseId,
        type_key: "client_onboarding",
        client_task_id: A,
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_request_parts WHERE request_id = $1::uuid",
          [fx.onboarding_tasks.delivery_ref],
        ),
      ).toBe(2);
      const again = await submit(CSM_A, A, KICKOFF_ANSWERS, req);
      expect(again).toMatchObject({
        ok: true,
        reused: true,
        responseId: out.responseId,
      });
      // The system's requests: deduped per response, and per card for another answer.
      const sameResponse = await one<any>(
        "SELECT public.cockpit_request_create_system('client_onboarding', $1, '{}'::jsonb, $2::uuid) AS r",
        [A, out.responseId],
      );
      expect(sameResponse).toMatchObject({
        ok: true,
        reused: true,
        requestId: fx.onboarding_tasks.delivery_ref,
      });
      const other =
        await one<string>(`INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name,
          mode, state, answers, created_by, created_by_id, submitted_by, submitted_at)
        VALUES ('kickoff', 2, 'cockpit', 'req:test-other', '${A}', 'Acme Interiors', 'live', 'submitted', '{}'::jsonb,
                'csm.a@tests.invalid', '${CSM_A}', 'csm.a@tests.invalid', now()) RETURNING id::text AS r`);
      const perCard = await one<any>(
        "SELECT public.cockpit_request_create_system('client_onboarding', $1, '{}'::jsonb, $2::uuid) AS r",
        [A, other],
      );
      expect(perCard).toMatchObject({
        ok: false,
        skipped: "Already made for this client.",
        requestId: fx.onboarding_tasks.delivery_ref,
      });
      // The notice of the read model settles the kickoff_notice effect.
      await ex(
        `UPDATE public.cockpit_slack_notices SET state = 'muted', finished_at = now() WHERE id = '${fx.kickoff_notice.delivery_ref}'`,
      );
      expect(byKey(await effects(out.responseId)).kickoff_notice.state).toBe(
        "skipped",
      );
    });
  });

  test("New MRR: none when it equals the card, none for 0 against an empty card MRR", async () => {
    await rolledBack(async () => {
      await goLive("kickoff", true);
      const same = await submit(CEO, D_CARD, {
        ...KICKOFF_ANSWERS,
        newMrrUsd: 1200,
      });
      expect(byKey(await effects(same.responseId)).new_mrr).toMatchObject({
        state: "skipped",
        reason: "The card already shows that MRR.",
      });
      const zero = await submit(CEO, C, { ...KICKOFF_ANSWERS, newMrrUsd: 0 });
      expect(byKey(await effects(zero.responseId)).new_mrr).toMatchObject({
        state: "skipped",
        reason: "New MRR is 0 and the card's MRR is empty, so nothing changes.",
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_billing_events WHERE kind = 'mrr' AND clickup_task_id IN ($1, $2)",
          [D_CARD, C],
        ),
      ).toBe(0);
    });
  });

  test("one kickoff per card: a Typeform kickoff needs the reason, and a second runs only the handoff comment", async () => {
    await rolledBack(async () => {
      await goLive("kickoff", true);
      const r = await refusal(() => submit(CSM_B, B, KICKOFF_ANSWERS));
      expect(r.message).toBe(
        "A kickoff was sent for Beta Build on 15 Oct 2026. Say why you are sending it again.",
      );
      const out = await submit(CSM_B, B, {
        ...KICKOFF_ANSWERS,
        replaceReason: "The first one missed the payment.",
      });
      expect(out.second).toBe(true);
      const fx = byKey(await effects(out.responseId));
      expect(fx.handoff_comment.state).toBe("queued");
      for (const k of [
        "native_status",
        "card_fields",
        "onboarding_tasks",
        "map_phase4",
        "phase4_whatsapp",
        "kickoff_notice",
        "new_mrr",
      ])
        expect(fx[k]).toMatchObject({
          state: "skipped",
          reason: "A second kickoff posts only the handoff comment.",
        });
    });
  });

  test("before the go-live, a card other than the test card is Make's: dry runs only", async () => {
    await rolledBack(async () => {
      const id = await one<string>(
        `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name,
          mode, state, answers, created_by, created_by_id, submitted_by, submitted_at)
        VALUES ('kickoff', 2, 'cockpit', 'req:test-make', '${C}', 'Cedar Homes', 'live', 'submitted', $1::jsonb,
                'csm.a@tests.invalid', '${CSM_A}', 'csm.a@tests.invalid', now()) RETURNING id::text AS r`,
        [json(KICKOFF_ANSWERS)],
      );
      await one("SELECT public.cockpit_form_stage4_plan($1::uuid, true) AS r", [
        id,
      ]);
      const fx = await effects(id);
      expect(
        fx
          .filter(e => e.effect_key !== "recap")
          .every(e => e.owner === "make" && e.state === "dry_run"),
      ).toBe(true);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_clickup_writeback_queue WHERE payload->>'responseId' = $1",
          [id],
        ),
      ).toBe(0);
    });
  });

  test("prefill: hidden values with their sources and the card's MRR", async () => {
    const p = await as<any>(
      CSM_A,
      "SELECT public.cockpit_kickoff_prefill($1) AS r",
      [A],
    );
    expect(p.live).toBe(false);
    expect(p.why).toBe(
      "The kickoff moves into the cockpit after its switch-on.",
    );
    expect(p.fields.legal_name).toEqual({
      value: "Acme Interiors Co",
      source: "onboarding",
    });
    expect(p.fields.onboarding_client_id).toEqual({ value: A, source: "card" });
    expect(p.fields.newMrrUsd).toEqual({ value: 2000, source: "card" });
    const pb = await as<any>(
      CSM_B,
      "SELECT public.cockpit_kickoff_prefill($1) AS r",
      [B],
    );
    expect(pb.answered.at).toBeTruthy();
  });

  test("the read model keeps a native kickoff against the sync's wholesale replace", async () => {
    await rolledBack(async () => {
      await goLive("kickoff", true);
      await submit(CEO, C, KICKOFF_ANSWERS);
      await ex(
        `UPDATE public.cockpit_client_onboarding SET forms = '{}' WHERE clickup_task_id = '${C}'`,
      );
      expect(
        await one(
          "SELECT forms->'kickoff'->>'form_id' AS r FROM public.cockpit_client_onboarding WHERE clickup_task_id = $1",
          [C],
        ),
      ).toBe("native");
    });
  });

  test("a kickoff Typeform delivery after the go-live is stored legacy with legacy.received", async () => {
    await rolledBack(async () => {
      await goLive("kickoff", true);
      const out = await as<any>(
        "service",
        "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
        [
          json({
            formKey: "kickoff",
            externalId: "tokKickOld1",
            submittedAt: "2026-11-02T08:00:00Z",
            answers: {
              fields: [
                {
                  ref: KREF.contract,
                  title: "Contract status",
                  type: "dropdown",
                  value: "Signed",
                },
              ],
            },
            hidden: { onboarding_client_id: C, client_name: "Cedar Homes" },
            taskId: C,
            clientName: "Cedar Homes",
            backfill: false,
          }),
        ],
      );
      expect(out.inserted).toBe(true);
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
          [out.responseId],
        ),
      ).toBe("legacy");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`legacy:${out.responseId}`],
        ),
      ).toBe(1);
    });
    const before = await refusal(() =>
      as(
        "service",
        "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
        [
          json({
            formKey: "kickoff",
            externalId: "tokKickOld2",
            submittedAt: "2026-11-02T08:00:00Z",
            answers: { fields: [] },
          }),
        ],
      ),
    );
    expect(before.message).toBe(
      "The kickoff form is recorded by its own store until its go-live.",
    );
  });
});

// --- The onboarding ----------------------------------------------------------------------------

const ONB_ANSWERS = {
  fullName: "Cedar Owner",
  phone: "+965 5000 0002",
  email: "owner@cedar.invalid",
  businessName: "Owner Business Co",
  address: "Block 1, Street 2",
  website: "cedar.invalid",
  instagram: "@cedar",
  facebook: "cedar page",
  paymentOptions: "Full payment or two parts",
  frontDeskPhone: "+96550000003",
  personalPhone: "+96550000004",
  yearsInBusiness: "6 years",
  bookingSoftware: "None",
  facebookAds: "unsure",
  projectsDone: "40",
  hours: "Sun to Thu 9 to 5",
  services: "Fit out and interiors",
  serviceFocus: "Villas",
  faqs: "How long does it take? About three months.",
  idealProject: "A full villa",
  serviceAreas: "Kuwait City",
  appointmentTypes: ["online", "office"],
  landmark: "Next to the mall",
  appointmentLength: "One hour",
  consultants: "Two engineers",
  whyJoined: "To grow",
  freeConsults: "yes",
  marketing: "Instagram posts",
  lastRevenue: "250000",
  challenges: "Finding clients",
  goal90: "100000",
  goal12: "1000000",
};

describe("the onboarding (4.14, 3.3)", () => {
  test("not live: the portal shows the Typeform", async () => {
    expect(await portalOpen("locCedar01", C)).toEqual({ live: false });
  });

  test("live: one invite, the answer runs every effect once, then answeredAt", async () => {
    await rolledBack(async () => {
      await goLive("onboarding", true);
      await settings("onboarding.map_urls", MAPS);
      await settings("stage4.messages", MESSAGES);
      await addRequestTypes();
      const first = await portalOpen("locCedar01", C);
      expect(first.live).toBe(true);
      expect(first.inviteId).toBeTruthy();
      expect((await portalOpen("locCedar01", C)).inviteId).toBe(first.inviteId);
      const done = await as<any>(
        "service",
        "SELECT public.portal_form_submit('locCedar01', $1, 'owner@client.invalid', 'admin', $2::uuid, $3::jsonb, $4::uuid, 'en') AS r",
        [C, first.inviteId, json(ONB_ANSWERS), uuid()],
      );
      expect(done.ok).toBe(true);
      const fx = byKey(await effects(done.responseId));
      for (const k of [
        "profile_fields",
        "raw_answers_comment",
        "map_phase3",
        "client_data_row",
        "github_dispatch",
        "phase3_whatsapp",
      ])
        expect(fx[k].state).toBe("queued");
      expect(fx.brand_dna_task.state).toBe("delivered");
      expect(fx.read_model.state).toBe("delivered");
      const model = await one<any>(
        "SELECT forms->'onboarding' AS r FROM public.cockpit_client_onboarding WHERE clickup_task_id = $1",
        [C],
      );
      expect(model.form_id).toBe("native");
      expect(
        model.answers.find((a: any) => a.ref === OREF.freeConsults).value,
      ).toBe(
        "Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅",
      );
      expect(
        model.answers.find((a: any) => a.ref === OREF.appointments).value,
      ).toContain("| Online");
      const profile = fx.profile_fields.plan.fields;
      expect(profile[1]).toEqual({
        fieldId: "87d7d889-afea-42f8-9485-6f3ead5b857f",
        kind: "url",
        label: "Kickoff Form Link",
        value: `https://cockpit.maharamedia.com/client-success/clients/${C}?form=kickoff`,
      });
      expect(profile[0].value).toContain("Revenue last year: 250000");
      const relay = await q<Row>(
        "SELECT effect_key, state, payload FROM public.cockpit_form_relay_outbox WHERE response_id = $1 ORDER BY effect_key",
        [done.responseId],
      );
      expect(relay.map(r => [r.effect_key, r.state])).toEqual([
        ["client_data_row", "queued"],
        ["github_dispatch", "queued"],
      ]);
      expect(relay[1].payload).toEqual({ taskId: C, client: "Cedar Homes" });
      expect((await portalOpen("locCedar01", C)).answeredAt).toBeTruthy();
      // The relay: a claim, a send, a settle.
      const claim = await as<any>(
        "service",
        "SELECT public.cockpit_form_relay_claim(5) AS r",
      );
      expect(claim.rows).toHaveLength(2);
      const gh = claim.rows.find((r: any) => r.effectKey === "github_dispatch");
      const cd = claim.rows.find((r: any) => r.effectKey === "client_data_row");
      await as(
        "service",
        "SELECT public.cockpit_form_relay_done($1, $2::uuid, 'sent', '{\"reason\":\"Dispatched.\"}'::jsonb) AS r",
        [gh.id, gh.claim],
      );
      await as(
        "service",
        "SELECT public.cockpit_form_relay_done($1, $2::uuid, 'unknown', '{\"reason\":\"The sheet did not answer.\"}'::jsonb) AS r",
        [cd.id, cd.claim],
      );
      const after = byKey(await effects(done.responseId));
      expect(after.github_dispatch.state).toBe("delivered");
      expect(after.client_data_row.state).toBe("unknown");
      expect(
        (
          await as<any>(
            "service",
            "SELECT public.cockpit_form_relay_claim(5) AS r",
          )
        ).rows,
      ).toHaveLength(0);
      // The Brand DNA task once per card: a second answer's request is skipped.
      const dup = await one<any>(
        "SELECT public.cockpit_request_create_system('brand_dna', $1, '{}'::jsonb, $2::uuid) AS r",
        [C, done.responseId],
      );
      expect(dup.reused).toBe(true);
    });
  });

  test("the relay retries a failure under three attempts, after ten minutes", async () => {
    await rolledBack(async () => {
      await goLive("onboarding", true);
      const inv = await portalOpen("locCedar01", C);
      const done = await as<any>(
        "service",
        "SELECT public.portal_form_submit('locCedar01', $1, 'owner@client.invalid', 'member', $2::uuid, $3::jsonb, $4::uuid, 'ar') AS r",
        [C, inv.inviteId, json(ONB_ANSWERS), uuid()],
      );
      const c1 = (
        await as<any>(
          "service",
          "SELECT public.cockpit_form_relay_claim(1) AS r",
        )
      ).rows[0];
      await as(
        "service",
        "SELECT public.cockpit_form_relay_done($1, $2::uuid, 'failed', '{\"reason\":\"Google refused it (403).\"}'::jsonb) AS r",
        [c1.id, c1.claim],
      );
      expect(byKey(await effects(done.responseId))[c1.effectKey].state).toBe(
        "queued",
      );
      const soon = (
        await as<any>(
          "service",
          "SELECT public.cockpit_form_relay_claim(5) AS r",
        )
      ).rows.map((r: any) => r.id);
      expect(soon).not.toContain(c1.id);
      await ex(
        `UPDATE public.cockpit_form_relay_outbox SET updated_at = now() - interval '11 minutes' WHERE id = ${c1.id}`,
      );
      const later = (
        await as<any>(
          "service",
          "SELECT public.cockpit_form_relay_claim(5) AS r",
        )
      ).rows.map((r: any) => r.id);
      expect(later).toContain(c1.id);
    });
  });

  test("a card with a stored Typeform answer gets no invite, answeredAt, and nothing from a second answer", async () => {
    await rolledBack(async () => {
      await goLive("onboarding", true);
      const open = await portalOpen("locDune01", D_CARD);
      expect(open.inviteId).toBeNull();
      expect(open.answeredAt).toBeTruthy();
      const out = await as<any>(
        "service",
        "SELECT public.cockpit_form_onboarding_typeform($1::jsonb) AS r",
        [
          json({
            formKey: "onboarding",
            externalId: "tokDune0002",
            submittedAt: "2026-11-02T09:00:00Z",
            answers: {
              fields: [
                {
                  ref: OREF.businessName,
                  title: "Business Name",
                  value: "Dune again",
                },
              ],
            },
            hidden: { onboarding_client_id: D_CARD },
            taskId: D_CARD,
          }),
        ],
      );
      expect(out).toMatchObject({ inserted: true, stored: "legacy" });
      expect(await effects(out.responseId)).toHaveLength(0);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
          [`legacy:${out.responseId}`],
        ),
      ).toBe(1);
      // A card past onboarding (a kickoff on the read model) is answered too.
      expect((await portalOpen("locBeta01", B)).answeredAt).toBeTruthy();
    });
  });

  test("an onboarding Typeform delivery after the go-live runs the native planner, equal to the portal answer's plan", async () => {
    await rolledBack(async () => {
      await goLive("onboarding", true);
      await settings("onboarding.map_urls", MAPS);
      await settings("stage4.messages", MESSAGES);
      const v2 = await one<any>(
        "SELECT public.cockpit_form_stage4_typeform_answers('onboarding', $1::jsonb) AS r",
        [json(ONB_ANSWERS)],
      );
      // The onboarding sync read the same answer from Typeform first: its entry is not an earlier answer.
      await ex(`UPDATE public.cockpit_client_onboarding SET forms = jsonb_build_object('onboarding', jsonb_build_object(
        'form_id', 'KFRCXPFx', 'response_id', 'tokElm00001', 'submitted_at', '2026-11-02T09:00:00Z', 'answers', '[]'::jsonb))
        WHERE clickup_task_id = '${E}'`);
      const viaDoor = await as<any>(
        "service",
        "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
        [
          json({
            formKey: "onboarding",
            externalId: "tokElm00001",
            submittedAt: "2026-11-02T09:00:00Z",
            answers: { fields: v2 },
            hidden: { onboarding_client_id: E, client_name: "Elm Works" },
            taskId: E,
            backfill: false,
          }),
        ],
      );
      expect(viaDoor).toMatchObject({ inserted: true, stored: "native" });
      const door = await effects(viaDoor.responseId);
      const stored = await one<any>(
        "SELECT answers AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
        [viaDoor.responseId],
      );
      expect(stored).toEqual(ONB_ANSWERS);
      // The portal path on an equal card, compared effect by effect (texts with the card id folded).
      const inv = await portalOpen("locCedar01", C);
      const portal = await as<any>(
        "service",
        "SELECT public.portal_form_submit('locCedar01', $1, 'owner@client.invalid', 'admin', $2::uuid, $3::jsonb, $4::uuid, 'en') AS r",
        [C, inv.inviteId, json(ONB_ANSWERS), uuid()],
      );
      const viaPortal = await effects(portal.responseId);
      const fold = (rows: Row[], task: string, client: string) =>
        rows
          .filter(r => r.effect_key !== "read_model")
          .map(r => {
            const plan = structuredClone(r.plan);
            if (plan.payload) delete plan.payload.submittedAt;
            return [
              r.effect_key,
              r.state,
              JSON.stringify(plan)
                .split(task)
                .join("{task}")
                .split(client)
                .join("{client}"),
            ];
          });
      expect(fold(door, E, "Elm Works")).toEqual(
        fold(viaPortal, C, "Cedar Homes"),
      );
      expect(byKey(door).read_model.state).toBe("delivered");
      expect(
        await one(
          "SELECT forms->'onboarding'->>'response_id' AS r FROM public.cockpit_client_onboarding WHERE clickup_task_id = $1",
          [E],
        ),
      ).toBe("tokElm00001");
    });
  });
});

// --- Messages, parity, timeline ----------------------------------------------------------------

describe("phase messages (5.12, 5.16)", () => {
  test("approve takes the client text rule and 1,500 characters; claim takes the phase kinds", async () => {
    await rolledBack(async () => {
      await settings("onboarding.map_urls", MAPS);
      await settings("stage4.messages", MESSAGES);
      const out = await submit(CEO, TEST_CARD, KICKOFF_ANSWERS);
      const msgId = byKey(await effects(out.responseId)).phase4_whatsapp
        .delivery_ref;
      const approve = (body: string) =>
        as<any>(
          "service",
          "SELECT public.cockpit_client_message_approve($1::uuid, $2, encode(sha256(convert_to($2, 'UTF8')), 'hex'), $3::uuid, '{}') AS r",
          [msgId, body, CEO],
        );
      expect(
        (await refusal(() => approve("Your leads are coming in"))).message,
      ).toContain("never quote leads");
      expect((await refusal(() => approve("x".repeat(1501)))).message).toBe(
        "The message is empty or over 1,500 characters. Edit the text, then approve again.",
      );
      const ok = await approve(
        MESSAGES.phase4
          .replace("{client}", "Test card")
          .replace(
            "{map_link}",
            "https://mahara-onboarding-map.vercel.app/?phase=4&cid=86eywg1cq",
          ),
      );
      expect(ok).toMatchObject({
        kind: "phase4",
        state: "approved",
        formKey: "kickoff",
        owner: "cockpit",
      });
      const c = await as<any>(
        "service",
        "SELECT public.cockpit_client_message_claim(ARRAY['phase3','phase4'], ARRAY['86eywg1cq'], 1) AS r",
      );
      expect(c.rows).toHaveLength(1);
      expect(c.rows[0].kind).toBe("phase4");
    });
  });
});

describe("the parity plan (4.15.1)", () => {
  test("a recorded Make kickoff input plans the same effects as a native answer", async () => {
    const input = {
      taskId: C,
      client: "Cedar Homes",
      submittedAt: "2026-10-20T11:55:11Z",
      token: "tokParity01",
      cardMrr: 0,
      newMrrUsd: 1000,
      hidden: {
        onboarding_client_id: C,
        legal_name: "Cedar Homes Co",
        email: "owner@cedar.invalid",
        ignored_key: "x",
      },
      answers: [
        { ref: KREF.contract, title: "Contract status", value: "Signed" },
        {
          ref: KREF.service,
          title: "Which service are we advertising?",
          value: "Fit out and renovation, Interior design",
        },
        {
          ref: KREF.maharaOs,
          title: "Mahara OS Access Status",
          value: "Tech Issue",
        },
        { ref: KREF.payment, title: "Payment Amount", value: "1500" },
      ],
    };
    const out = await as<any>(
      "service",
      "SELECT public.cockpit_form_parity_plan('kickoff', $1::jsonb) AS r",
      [json(input)],
    );
    const fx = Object.fromEntries(out.effects.map((e: any) => [e.key, e]));
    expect(
      fx.card_fields.plan.fields.map((f: any) => f.optionName ?? f.value),
    ).toEqual([
      "Brand Blueprint Booked♠️",
      "Tech Issue",
      "Signed",
      "Interior design",
      `https://cockpit.maharamedia.com/client-success/clients/${C}/present/blueprint?view=prep`,
    ]);
    expect(fx.handoff_comment.plan.comment_text).toContain(
      "Business name: Cedar Homes Co",
    );
    expect(fx.handoff_comment.plan.comment_text).not.toContain("ignored_key");
    expect(fx.new_mrr.plan).toMatchObject({ from: 0, to: 1000 });
    expect(out.unmapped).toBeNull();
    const writes = await one(
      "SELECT count(*)::int AS r FROM public.cockpit_form_effects",
    );
    await as(
      "service",
      "SELECT public.cockpit_form_parity_plan('onboarding', $1::jsonb) AS r",
      [json({ taskId: E, answers: [] })],
    );
    expect(
      await one("SELECT count(*)::int AS r FROM public.cockpit_form_effects"),
    ).toBe(writes);
  });
});
