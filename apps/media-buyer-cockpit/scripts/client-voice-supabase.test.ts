/**
 * Waves 3 and 4, the client's voice (docs/forms/WAVE34-CONTRACT.md 2.5, 3.3 c, 3.5, 4.5 to 4.8, 8):
 * 20261102c_client_voice.sql on one isolated PostgreSQL with Supabase's default privileges on, after
 * the waves 1-2 block (20261101l to r) and the two files it stands on, 20261102a (invites) and
 * 20261102b (client lifecycle). When those two files are on this branch they are applied as they
 * are; until they land, a stand-in built to the contract's names and shapes (2.3, 3.2, 3.3, 3.10)
 * takes their place, so this file can be checked on its own. The integrator runs it again with the
 * real files.
 *
 * The ground is forms-w12-chain-supabase.test.ts's (the 2a base, the eight 2b files, the billing
 * sheet, the churn register, the CSM read models and finance). The vault is a plain-text
 * stand-in. The CEO's address is read from the CEO gate migration; every other person, client and
 * value is invented. No test reaches the live database, Typeform, Slack, ClickUp or WhatsApp.
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

// --- The files this one stands on --------------------------------------------------------------

const R = "20261101r_readers_read_only_grant.sql";
const A_FILE = "20261102a_forms_invites.sql";
const B_FILE = "20261102b_client_lifecycle.sql";
const C = "20261102c_client_voice.sql";
const onBranch = (file: string) =>
  existsSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url));
const TEST_CARD = "86eywg1cq";

/**
 * 20261102a's objects this file calls, to the contract's names and shapes (2.3, 3.2, 3.3, 3.10), for
 * as long as the real file is not on this branch. Only what the client voice reads or calls: the
 * invites and their events and tokens, the presence counts, the go-live list, the card rule, the
 * expiry and ineligible sweeps, the system issuer, the dispatchers, the portal and token submits,
 * the seat withdraw and the canary door. Never shipped: the real file replaces it.
 */
const STAND_IN_A = `
ALTER TABLE public.cockpit_form_responses ADD COLUMN IF NOT EXISTS invite_id uuid;
ALTER TABLE public.cockpit_form_responses ADD COLUMN IF NOT EXISTS signer text;
ALTER TABLE public.cockpit_form_responses ADD COLUMN IF NOT EXISTS lang text;
ALTER TABLE public.cockpit_form_responses DROP CONSTRAINT IF EXISTS cockpit_form_responses_source_check;
ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_source_check
  CHECK (source IN ('cockpit','embed','typeform_webhook','typeform_sync','public','import','portal'));
CREATE TABLE public.cockpit_form_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id text NOT NULL, client_name text NOT NULL, location_id text,
  form_key text NOT NULL REFERENCES public.cockpit_forms(key), form_version integer NOT NULL,
  purpose text NOT NULL, context jsonb NOT NULL DEFAULT '{}', channels text[] NOT NULL,
  audience text NOT NULL DEFAULT 'any', note text, lang text NOT NULL DEFAULT 'ar',
  origin text NOT NULL CHECK (origin IN ('csm','schedule','pause','churn','canary')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','withdrawn','expired')),
  issued_by uuid, issued_by_email text, issued_by_role text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, answered_at timestamptz, response_id uuid, closed_at timestamptz, closed_by text,
  closed_reason text, push boolean NOT NULL DEFAULT false, push_state text NOT NULL DEFAULT 'off', message_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX cockpit_form_invites_one_open ON public.cockpit_form_invites (task_id, form_key, purpose) WHERE state = 'open';
CREATE TABLE public.cockpit_form_invite_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, invite_id uuid NOT NULL REFERENCES public.cockpit_form_invites(id),
  at timestamptz NOT NULL DEFAULT now(), source text NOT NULL, event text NOT NULL, person text,
  detail jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.cockpit_form_invite_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, invite_id uuid NOT NULL REFERENCES public.cockpit_form_invites(id),
  channel text NOT NULL, token_sha256 text NOT NULL UNIQUE, made_by text NOT NULL, revoked_at timestamptz);
CREATE TABLE public.cockpit_form_token_opens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), net_hash text NOT NULL,
  browser_hash text, outcome text NOT NULL, token_id bigint);
CREATE TABLE public.cockpit_portal_presence (
  location_id text PRIMARY KEY, last_session_at timestamptz, admins integer NOT NULL, members integer NOT NULL,
  pushed_at timestamptz NOT NULL);
ALTER TABLE public.cockpit_form_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_invite_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_token_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_portal_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_invites, public.cockpit_form_invite_events, public.cockpit_form_invite_tokens,
  public.cockpit_form_token_opens, public.cockpit_portal_presence FROM PUBLIC, anon, authenticated;
ALTER TABLE public.cockpit_client_messages ADD COLUMN IF NOT EXISTS invite_id uuid;
ALTER TABLE public.cockpit_client_messages DROP CONSTRAINT IF EXISTS cockpit_client_messages_kind_check;
ALTER TABLE public.cockpit_client_messages ADD CONSTRAINT cockpit_client_messages_kind_check
  CHECK (kind IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5','form_invite'));
DO $k$
DECLARE r record; v_def text; v_live text[]; v_all text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES ('cockpit_slack_notices','cockpit_slack_notices_kind_check'),
                                 ('cockpit_slack_notice_settings','cockpit_slack_notice_settings_kind_check')) x(t, con) LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
     WHERE c.conrelid = ('public.' || r.t)::regclass AND c.conname = r.con;
    SELECT array_agg(DISTINCT m[1]) INTO v_live FROM regexp_matches(v_def, '''([a-z_.]+)''', 'g') AS m;
    SELECT array_agg(DISTINCT k ORDER BY k) INTO v_all
      FROM unnest(v_live || ARRAY['pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received']) AS k;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.t, r.con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (kind IN (%s))', r.t, r.con,
      (SELECT string_agg(quote_literal(k), ',') FROM unnest(v_all) AS k));
  END LOOP;
END $k$;
ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_check1;
ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_check1
  CHECK (kind IN ('rehearsal','termination.notice','legacy.received') OR task_id IS NOT NULL);
INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by) VALUES
  ('nps', 'NPS survey', 'client', 'native', 'fuPgs85S', 1,
   '{"v":1,"key":"nps","fields":[{"key":"recommend","type":"scale","min":0,"max":10,"required":true}],"reads":{"low_score":["recommend"],"nps_notice":["recommend","results"]}}',
   ARRAY['csm'], true, '[]', 'stand-in a'),
  ('csat', 'Onboarding survey', 'client', 'native', 'KbcbPA73', 1,
   '{"v":1,"key":"csat","fields":[{"key":"onboarding","type":"scale","min":1,"max":10,"required":true}],"reads":{"low_score":["onboarding"],"csat_notice":["onboarding"]}}',
   ARRAY['csm'], true, '[]', 'stand-in a'),
  ('portal_feedback', 'Portal feedback', 'client', 'native', NULL, 1, '{"v":1,"key":"portal_feedback","fields":[]}',
   ARRAY['csm'], true, '[]', 'stand-in a')
ON CONFLICT DO NOTHING;
INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by)
SELECT f.key, 1, f.schema, 'stand-in a' FROM public.cockpit_forms f WHERE f.key IN ('nps','csat','portal_feedback') ON CONFLICT DO NOTHING;
INSERT INTO public.cockpit_settings (key, value, updated_by) VALUES ('forms.client', '{"live":[],"presence":false}', 'stand-in a')
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.cockpit_form_client_live(p_form_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cockpit_forms f WHERE f.key = p_form_key AND f.provider = 'native' AND f.audience = 'client')
     AND coalesce((SELECT (c.value->'live') ? p_form_key FROM public.cockpit_settings c WHERE c.key = 'forms.client'), false)
$$;
CREATE FUNCTION public.cockpit_form_client_go_live(p_form_key text, p_on boolean, p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.cockpit_settings c SET value = jsonb_set(c.value, '{live}',
           CASE WHEN p_on THEN (c.value->'live') || to_jsonb(p_form_key) ELSE (c.value->'live') - p_form_key END),
         updated_by = p_actor
   WHERE c.key = 'forms.client';
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION public.cockpit_form_card_allows(p_task_id text, p_form_key text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cockpit_billing_accounts; v_dep boolean;
BEGIN
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_dep := EXISTS (SELECT 1 FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = p_task_id AND d.removed_at IS NULL);
  IF p_form_key = 'exit_survey' THEN
    RETURN CASE WHEN v_dep OR a.client_status = 'Stopped' THEN NULL ELSE 'Mark Client is leaving first, then send the exit survey.' END;
  END IF;
  IF a.client_status IS DISTINCT FROM 'Active' THEN
    RETURN format('%s is not an active client, so this form does not go to them.', a.client_name);
  END IF;
  IF v_dep THEN RETURN format('%s is leaving. Send the exit survey instead.', a.client_name); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION public.cockpit_form_invites_expire() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  WITH e AS (UPDATE public.cockpit_form_invites i SET state = 'expired', closed_at = now(), closed_reason = 'Expired', updated_at = now()
              WHERE i.state = 'open' AND i.expires_at <= now() RETURNING i.id)
  SELECT count(*) INTO n FROM e;
  UPDATE public.cockpit_form_invite_tokens t SET revoked_at = now()
   WHERE t.revoked_at IS NULL AND t.invite_id IN (SELECT x.id FROM public.cockpit_form_invites x WHERE x.state <> 'open');
  RETURN n;
END $$;
CREATE FUNCTION public.cockpit_form_invites_withdraw_ineligible() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer := 0; i record; v text;
BEGIN
  FOR i IN SELECT * FROM public.cockpit_form_invites x WHERE x.state = 'open' AND x.form_key IN ('nps','csat','pause_consent') LOOP
    v := public.cockpit_form_card_allows(i.task_id, i.form_key);
    IF v IS NOT NULL THEN
      UPDATE public.cockpit_form_invites x SET state = 'withdrawn', closed_at = now(), closed_by = 'the cockpit',
             closed_reason = CASE WHEN v ILIKE '%is leaving%' THEN 'The client is leaving.' ELSE 'The client is no longer active.' END,
             updated_at = now()
       WHERE x.id = i.id;
      INSERT INTO public.cockpit_form_invite_events(invite_id, source, event, detail) VALUES (i.id, 'schedule', 'withdrawn', '{"by":"schedule"}');
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
CREATE FUNCTION public.cockpit_form_client_issued(p_invite_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  SELECT x.form_key INTO k FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  IF to_regprocedure('public.cockpit_form_issue_hook_' || k || '(uuid)') IS NOT NULL THEN
    EXECUTE format('SELECT public.%I($1)', 'cockpit_form_issue_hook_' || k) USING p_invite_id;
  END IF;
END $$;
CREATE FUNCTION public.cockpit_form_client_submitted(p_response_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses; v_invite uuid;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  UPDATE public.cockpit_form_invites x SET state = 'answered', answered_at = now(), response_id = r.id, closed_at = now(), updated_at = now()
   WHERE x.id = r.invite_id AND x.state = 'open' RETURNING x.id INTO v_invite;
  IF v_invite IS NOT NULL THEN
    UPDATE public.cockpit_form_invite_tokens t SET revoked_at = now() WHERE t.invite_id = v_invite AND t.revoked_at IS NULL;
    INSERT INTO public.cockpit_form_invite_events(invite_id, source, event)
    VALUES (v_invite, CASE WHEN r.source = 'public' THEN 'token' ELSE 'portal' END, 'answered');
  END IF;
  IF to_regprocedure('public.cockpit_form_hook_' || r.form_key || '(uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE format('SELECT public.%I($1)', 'cockpit_form_hook_' || r.form_key) USING r.id;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.cockpit_form_invite_events(invite_id, source, event, detail)
      VALUES (r.invite_id, 'portal', 'hook_failed', jsonb_build_object('hook', 'cockpit_form_hook_' || r.form_key, 'sqlstate', SQLSTATE));
    END;
  END IF;
END $$;
CREATE FUNCTION public.cockpit_form_stand_in_issue(p_task_id text, p_form_key text, p_channels text[], p_context jsonb, p_origin text,
  p_role text, p_client text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := gen_random_uuid(); v_loc text; v_ver integer; v_msg uuid; v_body text;
BEGIN
  SELECT max(v.version) INTO v_ver FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key;
  IF (SELECT count(*) FROM portal_data.workspaces w WHERE w.clickup_id = p_task_id) = 1 THEN
    SELECT w.location_id INTO v_loc FROM portal_data.workspaces w WHERE w.clickup_id = p_task_id;
  END IF;
  INSERT INTO public.cockpit_form_invites(id, task_id, client_name, location_id, form_key, form_version, purpose, context, channels,
    origin, issued_by_role, expires_at, push)
  VALUES (v_id, p_task_id, p_client, v_loc, p_form_key, v_ver, p_form_key, coalesce(p_context, '{}'), p_channels,
    p_origin, p_role, now() + interval '14 days', 'portal' = ANY(p_channels));
  INSERT INTO public.cockpit_form_invite_events(invite_id, source, event)
  VALUES (v_id, CASE WHEN p_origin = 'schedule' THEN 'schedule' ELSE 'cockpit' END, 'issued');
  IF 'whatsapp' = ANY(p_channels) THEN
    v_body := 'Hi ' || p_client || ' team, a quick question: {form_link}';
    INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, body, body_sha256, invite_id)
    VALUES ('invite:' || v_id, p_task_id, p_client, 'form_invite', v_body, encode(sha256(convert_to(v_body, 'UTF8')), 'hex'), v_id)
    RETURNING id INTO v_msg;
    UPDATE public.cockpit_form_invites x SET message_id = v_msg WHERE x.id = v_id;
  END IF;
  PERFORM public.cockpit_form_client_issued(v_id);
  RETURN v_id;
END $$;
CREATE FUNCTION public.cockpit_form_invite_issue_system(p_task_id text, p_form_key text, p_channels text[], p_context jsonb, p_origin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_client text;
BEGIN
  IF NOT public.cockpit_form_client_live(p_form_key) OR public.cockpit_form_card_allows(p_task_id, p_form_key) IS NOT NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_form_invites i WHERE i.task_id = p_task_id AND i.form_key = p_form_key AND i.state = 'open') THEN RETURN NULL; END IF;
  IF p_form_key = 'csat' AND EXISTS (SELECT 1 FROM public.cockpit_form_responses r WHERE r.form_key = 'csat' AND r.task_id = p_task_id
                                       AND r.state IN ('submitted','confirmed')) THEN RETURN NULL; END IF;
  SELECT a.client_name INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  RETURN public.cockpit_form_stand_in_issue(p_task_id, p_form_key, p_channels, p_context, 'schedule', 'the cockpit', v_client);
END $$;
CREATE FUNCTION public.cockpit_form_invite_withdraw(p_task_id text, p_invite_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.cockpit_form_invites x SET state = 'withdrawn', closed_at = now(), closed_by = 'the CSM', closed_reason = p_reason, updated_at = now()
   WHERE x.id = p_invite_id AND x.task_id = p_task_id AND x.state = 'open';
  INSERT INTO public.cockpit_form_invite_events(invite_id, source, event, detail) VALUES (p_invite_id, 'cockpit', 'withdrawn', '{"by":"seat"}');
  UPDATE public.cockpit_client_messages m SET state = 'skipped', reason = 'Withdrawn in the cockpit: ' || p_reason
   WHERE m.invite_id = p_invite_id AND m.state IN ('draft','approved');
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION public.cockpit_form_invite_canary(p_form_key text, p_context jsonb, p_channels text[] DEFAULT '{copy}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_token text := 'f1' || substr(md5(random()::text) || md5(random()::text), 1, 43);
BEGIN
  v_id := public.cockpit_form_stand_in_issue('${TEST_CARD}', p_form_key, p_channels, p_context, 'canary', 'the cockpit', 'Internal test card');
  INSERT INTO public.cockpit_form_invite_tokens(invite_id, channel, token_sha256, made_by)
  VALUES (v_id, 'copy', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), 'the cockpit');
  RETURN jsonb_build_object('inviteId', v_id, 'url', 'https://portal.maharamedia.com/f#' || v_token, 'messageId', NULL);
END $$;
CREATE FUNCTION public.portal_form_submit(p_location_id text, p_clickup_id text, p_person text, p_access_role text, p_invite_id uuid,
  p_answers jsonb, p_request_id uuid, p_lang text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites; v_id uuid;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR i.task_id <> p_clickup_id OR i.location_id IS DISTINCT FROM p_location_id THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  IF i.state = 'answered' THEN RETURN jsonb_build_object('ok', false, 'reason', 'answered'); END IF;
  IF i.state <> 'open' OR i.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN i.state = 'withdrawn' THEN 'withdrawn' ELSE 'expired' END);
  END IF;
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers,
    answer_meta, hidden, created_by, submitted_by, submitted_at, invite_id, lang)
  VALUES (i.form_key, i.form_version, 'portal', 'portal:' || p_request_id, i.task_id, i.client_name, 'live', 'submitted', p_answers,
    jsonb_build_object('invite_id', i.id, 'person_role', p_access_role, 'notice_on', public.cockpit_form_kuwait_day(now())),
    '{}', 'portal', lower(p_person), now(), i.id, p_lang)
  RETURNING id INTO v_id;
  PERFORM public.cockpit_form_client_submitted(v_id);
  RETURN jsonb_build_object('ok', true, 'responseId', v_id);
END $$;
CREATE FUNCTION public.portal_form_token_submit(p_token_sha256 text, p_net text, p_browser text, p_answers jsonb, p_signer text,
  p_request_id uuid, p_lang text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.cockpit_form_invite_tokens; i public.cockpit_form_invites; v_id uuid; v_canary boolean;
BEGIN
  SELECT * INTO t FROM public.cockpit_form_invite_tokens x WHERE x.token_sha256 = p_token_sha256;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown'); END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = t.invite_id FOR UPDATE;
  IF i.state <> 'open' THEN RETURN jsonb_build_object('ok', false, 'reason', i.state); END IF;
  v_canary := i.origin = 'canary';
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers,
    answer_meta, hidden, created_by, submitted_by, submitted_at, invite_id, lang)
  VALUES (i.form_key, i.form_version, 'public', 'token:' || p_request_id, i.task_id, i.client_name,
    CASE WHEN v_canary THEN 'shadow' ELSE 'live' END, 'submitted', p_answers,
    jsonb_build_object('invite_id', i.id, 'channel', t.channel, 'notice_on', public.cockpit_form_kuwait_day(now()))
      || CASE WHEN v_canary THEN '{"canary":true}'::jsonb ELSE '{}'::jsonb END,
    '{}', 'token', 'token', now(), i.id, p_lang)
  RETURNING id INTO v_id;
  PERFORM public.cockpit_form_client_submitted(v_id);
  RETURN jsonb_build_object('ok', true, 'responseId', v_id);
END $$;
`;

/** 20261102b's billing kinds (survey, nps_sent), the one piece of b this file needs, until b is on this branch. */
const STAND_IN_B = `
DO $b$
DECLARE v_def text; v_live text[]; v_all text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check';
  SELECT array_agg(DISTINCT m[1]) INTO v_live FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO v_all FROM unnest(v_live || ARRAY['survey','nps_sent']) AS k;
  ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
  EXECUTE format('ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ') FROM unnest(v_all) AS k));
END $b$;
`;

const PORTAL = `
  CREATE SCHEMA IF NOT EXISTS portal_data;
  CREATE TABLE IF NOT EXISTS portal_data.workspaces(location_id text PRIMARY KEY, clickup_id text, name text, status text, language text);
  ALTER TABLE portal_data.workspaces ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON portal_data.workspaces FROM PUBLIC, anon, authenticated;
  INSERT INTO portal_data.workspaces VALUES ('locA', '${A}', 'Acme Interiors', 'Active', NULL), ('locB', '${B}', 'Beta Build', 'Active', NULL)
  ON CONFLICT DO NOTHING;`;

/** The read-only role the CEO refresh uses (Supabase: pg_read_all_data and BYPASSRLS). */
const READ_ONLY = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
      CREATE ROLE supabase_read_only_user BYPASSRLS;
    END IF;
  END $r$;
  GRANT pg_read_all_data TO supabase_read_only_user;`;

let realA = false;
let realB = false;

beforeAll(async () => {
  try {
    await setUp();
  } catch (e) {
    console.error(`setup: ${(e as Error).message}`);
    throw e;
  }
}, 600_000);

async function setUp() {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(VAULT);
  await db.exec(READ_ONLY);
  await standOn();
  await billingAndChurn();
  await seats();
  await db.exec(PORTAL);
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
  // What 20261102a stands on besides waves 1-2 (as forms-invites-supabase.test.ts grounds it): the client asks
  // (20261029170000, live; its person check is what the bridge reuses), the CSM state audit, and pgcrypto's
  // gen_random_bytes in schema extensions (11.2-m).
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    GRANT USAGE ON SCHEMA extensions TO service_role, authenticated;
    CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
      $$ SELECT substring(decode(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'hex') FROM 1 FOR n) $$;`);
  await db.exec(
    cut(
      migration("20260926m_cockpit_csm_state.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_audit_csm_state\(\)[\s\S]*?END \$\$;/,
      "csm state audit",
    ),
  );
  await db.exec(migration("20261029170000_client_asks.sql"));
  realA = onBranch(A_FILE);
  realB = onBranch(B_FILE);
  try {
    await db.exec(realA ? withoutCron(migration(A_FILE)) : STAND_IN_A);
    await db.exec(realB ? withoutCron(migration(B_FILE)) : STAND_IN_B);
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    console.error(`a or b: ${(e as Error).message}`);
    throw e;
  }
  try {
    await db.exec(withoutCron(migration(C)));
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    console.error(`${C}: ${(e as Error).message}`);
    throw new Error(`${C}: ${(e as Error).message}`);
  }
}
afterAll(async () => {
  await db?.close();
});

// --- Helpers -----------------------------------------------------------------------------------

const rid = () => crypto.randomUUID();
const today = () =>
  one<string>("SELECT public.cockpit_form_kuwait_day(now())::text AS r");
const daysAgo = (n: number) =>
  one<string>(
    "SELECT (public.cockpit_form_kuwait_day(now()) - $1::integer)::text AS r",
    [n],
  );
const sha = (s: string) =>
  one<string>("SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS r", [s]);

async function live(...forms: string[]) {
  for (const f of forms)
    await q("SELECT public.cockpit_form_client_go_live($1, true, 'test')", [f]);
}
async function scheduleOn(on = true) {
  await q(
    "UPDATE cockpit_settings SET value = jsonb_set(value, '{on}', to_jsonb($1::boolean)) WHERE key = 'forms.schedule'",
    [on],
  );
}
type CardOpts = {
  status?: string;
  launchedDaysAgo?: number | null;
  workspace?: "Active" | "Cancelled" | null;
  sessionDaysAgo?: number | null;
};
/** A card on the billing sheet, its first launch in the daily snapshots, its workspace and the portal's presence. */
async function card(task: string, name: string, o: CardOpts = {}) {
  const status = o.status ?? "Active";
  await q(
    "INSERT INTO cockpit_billing_accounts(clickup_task_id, client_name, stage, client_status, next_payment_date, mrr_usd) VALUES ($1,$2,'active',$3,'2026-12-01',1000)",
    [task, name, status],
  );
  if (o.launchedDaysAgo !== null && o.launchedDaysAgo !== undefined) {
    const launch = await daysAgo(o.launchedDaysAgo);
    // Two snapshots: the earlier one keeps the first launch, the later one a relaunch (V21).
    await q(
      "INSERT INTO cockpit_client_billing_days(day, clickup_task_id, client_name, launch_date) VALUES ($1::date, $2, $3, $1::date), ($1::date + 5, $2, $3, $1::date + 3)",
      [launch, task, name],
    );
  }
  if (o.workspace !== null) {
    await q(
      "INSERT INTO portal_data.workspaces VALUES ($1, $2, $3, $4, NULL)",
      [`loc-${task}`, task, name, o.workspace ?? "Active"],
    );
    if (o.sessionDaysAgo !== null && o.sessionDaysAgo !== undefined)
      await q(
        "INSERT INTO cockpit_portal_presence(location_id, last_session_at, admins, members, pushed_at) VALUES ($1, now() - make_interval(days => $2::integer), 1, 2, now())",
        [`loc-${task}`, o.sessionDaysAgo],
      );
  }
}
const run = (apply = true, at = "now()") =>
  one<any>(`SELECT public.cockpit_form_schedule_run(${at}, $1) AS r`, [apply]);
const invitesOf = (task: string, form?: string) =>
  q<any>(
    "SELECT id::text, form_key, state, channels, origin, context, message_id IS NOT NULL AS has_message FROM cockpit_form_invites WHERE task_id = $1 AND ($2::text IS NULL OR form_key = $2) ORDER BY issued_at",
    [task, form ?? null],
  );
/** Moves an invite into the past: issued n days ago, its 14 days over, then the sweep closes it. */
async function age(inviteId: string, days: number) {
  await q(
    "UPDATE cockpit_form_invites SET issued_at = issued_at - make_interval(days => $2::integer), expires_at = now() - interval '1 minute' WHERE id = $1::uuid",
    [inviteId, days],
  );
  await q("SELECT public.cockpit_form_invites_expire()");
}
/** A portal answer, through 20261102a's portal path (the person is invented). */
async function answer(
  task: string,
  inviteId: string,
  answers: Record<string, unknown>,
) {
  const loc = await one<string>(
    "SELECT location_id AS r FROM cockpit_form_invites WHERE id = $1::uuid",
    [inviteId],
  );
  return as<any>(
    "service",
    "SELECT public.portal_form_submit($1, $2, 'owner@client.invalid', 'admin', $3::uuid, $4::jsonb, $5::uuid, 'ar') AS r",
    [loc, task, inviteId, JSON.stringify(answers), rid()],
  );
}
const notices = (kind: string) =>
  q<any>(
    "SELECT kind, dedupe_key, task_id, client_name, facts, state, error FROM cockpit_slack_notices WHERE kind = $1 ORDER BY created_at",
    [kind],
  );

/** Applies a migration as the owner; a failure rolls its transaction back before it is rethrown. */
async function apply(file: string) {
  await asOwner();
  try {
    await db.exec(withoutCron(migration(file)));
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    throw e;
  }
}

// --- The file ----------------------------------------------------------------------------------

describe("20261102c: the file", () => {
  test("it applies after a and b, and a second time changes nothing", async () => {
    const before = await one<number>(
      "SELECT count(*)::integer AS r FROM cockpit_audit_log",
    );
    await apply(C);
    await apply(C);
    // A second apply seeds nothing again, so it writes no audit row of its own.
    expect(
      await one<number>("SELECT count(*)::integer AS r FROM cockpit_audit_log"),
    ).toBe(before);
    expect(
      await one<number>(
        "SELECT count(*)::integer AS r FROM cockpit_form_schedules",
      ),
    ).toBe(2);
  });

  test("the drift guard: each replaced function's after md5 in the file is its body here, and a changed body stops the file", async () => {
    const text = migration(C);
    const rows = await q<any>(
      `SELECT p.proname, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('cockpit_forms_door_seen','cockpit_forms_key_put','cockpit_forms_key_mark',
          'cockpit_forms_key_label','cockpit_forms_keys_status','cockpit_form_record_legacy')`,
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(text).toContain(`'${r.md5}')`);
    // The live md5s of 2.2, read 2026-11-01.
    for (const live of [
      "063bd0689f11f79aeebc6270b370d28a",
      "24478cd132a02c9a370f27bccff506dc",
      "1075daac5191d53bae1e17c87b296160",
      "85af18f124fd053ef832cca3eae6eb2b",
      "695113cef48b9994447a539ae5fd7949",
      "50c4257c579f6269e2f8b8318086c743",
    ])
      expect(text).toContain(`'${live}'`);
    await asOwner();
    await db.exec("BEGIN");
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.cockpit_forms_key_label(p_provider text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'x'::text $$",
    );
    let message = "";
    try {
      await db.exec(
        withoutCron(migration(C))
          .replace(/^BEGIN;/m, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    await db.exec("ROLLBACK");
    expect(message).toBe(
      "cockpit_forms_key_label(text) changed since the waves 3-4 contract read it; stop and re-read it.",
    );
  });

  test("the schedules table: row security on, no browser grant, the service role reads and writes, never deletes; both rows seeded on", async () => {
    expect(
      await one(
        "SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.cockpit_form_schedules'::regclass",
      ),
    ).toBe(true);
    for (const role of ["anon", "authenticated"])
      expect(
        await one(
          "SELECT has_table_privilege($1, 'public.cockpit_form_schedules', 'SELECT') AS r",
          [role],
        ),
      ).toBe(false);
    expect(
      await one(
        "SELECT has_table_privilege('service_role', 'public.cockpit_form_schedules', 'UPDATE') AS r",
      ),
    ).toBe(true);
    expect(
      await one(
        "SELECT has_table_privilege('service_role', 'public.cockpit_form_schedules', 'DELETE') AS r",
      ),
    ).toBe(false);
    const refused = await refusal(() =>
      q("DELETE FROM cockpit_form_schedules WHERE form_key = 'nps'"),
    );
    expect(refused.message).toBe("Forms records are never deleted");
    const rows = await q<any>(
      'SELECT form_key, "on", rule FROM cockpit_form_schedules ORDER BY form_key',
    );
    expect(rows).toEqual([
      {
        form_key: "csat",
        on: true,
        rule: {
          afterLaunchDays: 0,
          whatsappAfterDays: 3,
          snoozeDays: 3,
          reissues: 3,
          retryAfterDays: 7,
          maxAgeDays: 60,
        },
      },
      {
        form_key: "nps",
        on: true,
        rule: { firstDay: 60, everyDays: 90, remindAfterDays: 7 },
      },
    ]);
    expect(
      await one(
        "SELECT count(*)::integer AS r FROM cockpit_audit_log WHERE action = 'forms.schedule_seeded'",
      ),
    ).toBe(2);
  });

  test("the settings: the schedule off with 3 a day at 10:00, the low-score line at 6, the voice door open", async () => {
    expect(
      await one(
        "SELECT value AS r FROM cockpit_settings WHERE key = 'forms.schedule'",
      ),
    ).toEqual({ on: false, maxPerRun: 3, hourKuwait: 10 });
    expect(
      await one(
        "SELECT value AS r FROM cockpit_settings WHERE key = 'voice.low_score'",
      ),
    ).toEqual({ max: 6 });
    expect(
      await one(
        "SELECT value->'voice' AS r FROM cockpit_settings WHERE key = 'forms.doors'",
      ),
    ).toBe(true);
    expect(
      await one(
        "SELECT count(*)::integer AS r FROM cockpit_audit_log WHERE action = 'voice.setting_seeded'",
      ),
    ).toBe(1);
  });

  test("the registry: onboarding and the New Client Form are Typeform rows whose every effect is Make's, each with version 1", async () => {
    const rows = await q<any>(
      "SELECT key, audience, provider, typeform_id, version, seats, effects FROM cockpit_forms WHERE key IN ('onboarding','new_client') ORDER BY key",
    );
    expect(
      rows.map(r => [
        r.key,
        r.audience,
        r.provider,
        r.typeform_id,
        r.version,
        r.seats,
      ]),
    ).toEqual([
      ["new_client", "team", "typeform", "BTzMwXiw", 1, ["sales"]],
      ["onboarding", "client", "typeform", "KFRCXPFx", 1, ["csm"]],
    ]);
    expect(rows[0].effects.map((e: any) => e.key)).toEqual([
      "onboarding_main",
      "highlevel_workflow",
      "cortana",
      "b2b_closed_deals",
    ]);
    expect(rows[1].effects.map((e: any) => e.key)).toEqual([
      "card_fields",
      "client_data_row",
      "phase3_whatsapp",
      "brand_dna_task",
      "github_dispatch",
    ]);
    for (const r of rows)
      for (const e of r.effects) expect(e.owner).toBe("make");
    expect(
      await one(
        "SELECT count(*)::integer AS r FROM cockpit_form_versions WHERE form_key IN ('onboarding','new_client') AND version = 1",
      ),
    ).toBe(2);
  });

  test("the CHECKs: the two signing keys, and the call store's three native kinds", async () => {
    const def = (t: string, c: string) =>
      one<string>(
        "SELECT pg_get_constraintdef(oid) AS r FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2",
        [t, c],
      );
    expect(
      await def(
        "public.cockpit_forms_keys",
        "cockpit_forms_keys_provider_check",
      ),
    ).toContain("'typeform_new_client'");
    expect(
      await def(
        "public.cockpit_forms_keys",
        "cockpit_forms_keys_provider_check",
      ),
    ).toContain("'typeform_onboarding'");
    expect(
      await def(
        "public.cockpit_csm_call_forms",
        "cockpit_csm_call_forms_form_id_check",
      ),
    ).toContain("'cockpit-feedback'");
    expect(
      await def(
        "public.cockpit_csm_call_forms",
        "cockpit_csm_call_forms_form_kind_check",
      ),
    ).toContain("'portal_feedback'");
  });

  test("function grants: three seat reads, four service doors, the hooks and the run's helpers to nobody", async () => {
    const can = (role: string, fn: string) =>
      one<boolean>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS r", [
        role,
        fn,
      ]);
    for (const fn of [
      "public.cockpit_client_voice_read(text)",
      "public.cockpit_client_voice_today()",
      "public.cockpit_client_voice_summary(date,date)",
    ]) {
      expect(await can("authenticated", fn)).toBe(true);
      expect(await can("anon", fn)).toBe(false);
      expect(await can("service_role", fn)).toBe(false);
    }
    for (const fn of [
      "public.cockpit_form_schedule_run(timestamptz,boolean)",
      "public.portal_feedback_record(text,text,text,jsonb)",
      "public.cockpit_form_record_make(jsonb)",
      "public.portal_form_status(text,text,text)",
    ]) {
      expect(await can("service_role", fn)).toBe(true);
      expect(await can("authenticated", fn)).toBe(false);
      expect(await can("anon", fn)).toBe(false);
    }
    for (const fn of [
      "public.cockpit_form_hook_nps(uuid)",
      "public.cockpit_form_hook_csat(uuid)",
      "public.cockpit_form_issue_hook_nps(uuid)",
      "public.cockpit_form_issue_hook_csat(uuid)",
      "public.cockpit_client_voice_low_max()",
    ])
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, fn)).toBe(false);
    // The replaced ones keep their live grants.
    expect(
      await can("authenticated", "public.cockpit_forms_keys_status()"),
    ).toBe(true);
    expect(
      await can("service_role", "public.cockpit_form_record_legacy(jsonb)"),
    ).toBe(true);
    expect(
      await can("authenticated", "public.cockpit_form_record_legacy(jsonb)"),
    ).toBe(false);
  });

  test("the read-only role the CEO refresh uses can read both views (20261101r's lesson)", async () => {
    await asOwner();
    await db.exec("SET ROLE supabase_read_only_user");
    try {
      const a = await db.query<any>(
        "SELECT count(*)::integer AS n FROM public.cockpit_client_voice_v",
      );
      const b = await db.query<any>(
        "SELECT count(*)::integer AS n FROM public.cockpit_form_invites_daily_v",
      );
      expect(typeof a.rows[0].n).toBe("number");
      expect(typeof b.rows[0].n).toBe("number");
    } finally {
      await asOwner();
    }
    for (const role of ["anon", "authenticated"]) {
      expect(
        await one(
          "SELECT has_table_privilege($1, 'public.cockpit_client_voice_v', 'SELECT') AS r",
          [role],
        ),
      ).toBe(false);
      expect(
        await one(
          "SELECT has_table_privilege($1, 'public.cockpit_form_invites_daily_v', 'SELECT') AS r",
          [role],
        ),
      ).toBe(false);
    }
  });

  test("the schedule block names mahara-form-schedule at 07:00 UTC and calls the run directly", async () => {
    const text = migration(C);
    const block = text.slice(
      text.indexOf("-- cron:begin"),
      text.indexOf("-- cron:end"),
    );
    expect(block).toContain("'mahara-form-schedule', '0 7 * * *'");
    expect(block).toContain("select public.cockpit_form_schedule_run();");
    expect(
      text.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    expect(text.startsWith("--")).toBe(true);
  });
});

// --- The schedule (4.5.4), with a fake clock where a day must pass ----------------------------------

describe("the schedule run", () => {
  test("off: only the sweep runs (an invite past its 14 days expires), form-schedule says so, nothing is issued", async () => {
    await rolledBack(async () => {
      await live("nps", "csat");
      await card("c60", "Day Sixty", {
        launchedDaysAgo: 60,
        sessionDaysAgo: 1,
      });
      await card("cold", "Old Invite", {
        launchedDaysAgo: 100,
        sessionDaysAgo: 1,
      });
      const old = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('cold', 'nps', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      await q(
        "UPDATE cockpit_form_invites SET issued_at = now() - interval '15 days', expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
        [old],
      );
      const out = await run(true);
      expect(out).toMatchObject({
        ran: false,
        why: "The schedule is off.",
        swept: { expired: 1 },
      });
      expect(await invitesOf("c60")).toHaveLength(0);
      expect((await invitesOf("cold"))[0].state).toBe("expired");
      const st = await q<any>(
        "SELECT ok, note, detail FROM cockpit_sync_state WHERE key = 'form-schedule'",
      );
      expect(st[0].ok).toBe(true);
      expect(st[0].detail).toMatchObject({
        ran: false,
        why: "The schedule is off.",
      });
      expect(st[0].note).toStartWith("The schedule is off.");
    });
  });

  test("a dry plan writes nothing, even while the switch is off, and lists what would go", async () => {
    await rolledBack(async () => {
      await live("nps");
      await card("p60", "Plan Sixty", {
        launchedDaysAgo: 60,
        sessionDaysAgo: 2,
      });
      const audit = await one<number>(
        "SELECT count(*)::integer AS r FROM cockpit_audit_log",
      );
      const out = await run(false);
      expect(out.ran).toBe(true);
      expect(out.plan).toEqual([
        {
          taskId: "p60",
          client: "Plan Sixty",
          form: "nps",
          channels: ["portal"],
          firstLaunch: await daysAgo(60),
          daysSinceLaunch: 60,
        },
      ]);
      expect(out.note).toContain("once the schedule is on");
      expect(await invitesOf("p60")).toHaveLength(0);
      expect(
        await one(
          "SELECT count(*)::integer AS r FROM cockpit_sync_state WHERE key = 'form-schedule'",
        ),
      ).toBe(0);
      expect(
        await one<number>(
          "SELECT count(*)::integer AS r FROM cockpit_audit_log",
        ),
      ).toBe(audit);
    });
  });

  test("NPS goes on day 60 exactly, not 59, from the first launch the snapshots kept; again 90 days after, not 89", async () => {
    await rolledBack(async () => {
      await live("nps");
      await scheduleOn();
      await card("d59", "Day Fifty Nine", {
        launchedDaysAgo: 59,
        sessionDaysAgo: 1,
      });
      await card("d60", "Day Sixty", {
        launchedDaysAgo: 60,
        sessionDaysAgo: 1,
      });
      const first = await run();
      expect(first.issued).toEqual({ nps: 1, csat: 0 });
      expect(first.skipped.notLive).toBe(1); // CSAT is not switched on
      expect(await invitesOf("d59")).toHaveLength(0);
      const [inv] = await invitesOf("d60", "nps");
      expect(inv).toMatchObject({
        origin: "schedule",
        channels: ["portal"],
        context: { round: 1 },
      });
      // The run is idempotent the same day.
      expect((await run()).issued).toEqual({ nps: 0, csat: 0 });
      // 89 days later (the invite expired long ago): too soon.
      await age(inv.id, 89);
      const later = await run();
      expect(later.issued.nps).toBe(0);
      expect(await invitesOf("d60", "nps")).toHaveLength(1);
      // 90 days: round 2.
      await q(
        "UPDATE cockpit_form_invites SET issued_at = issued_at - interval '1 day' WHERE id = $1::uuid",
        [inv.id],
      );
      expect((await run()).issued.nps).toBe(1);
      const both = await invitesOf("d60", "nps");
      expect(both.map(i => i.context.round)).toEqual([1, 2]);
      const st = await q<any>(
        "SELECT ok, note, detail FROM cockpit_sync_state WHERE key = 'form-schedule'",
      );
      expect(st[0].detail).toMatchObject({
        ran: true,
        issued: { nps: 1, csat: 0 },
      });
      expect(st[0].note).toStartWith("Sent 1 NPS and 0 onboarding surveys.");
    });
  });

  test("NPS skips every card that is not Active, an Active card with an open departure, no launch date and an open invite", async () => {
    await rolledBack(async () => {
      await live("nps");
      await scheduleOn();
      for (const [task, status] of [
        ["gh", "GHOSTED"],
        ["sales", "SALES TEAM TO CONTACT"],
        ["stop", "Stopped"],
      ])
        await card(task, `Card ${task}`, {
          status,
          launchedDaysAgo: 70,
          sessionDaysAgo: 1,
        });
      await card("leav", "Leaving Co", {
        launchedDaysAgo: 70,
        sessionDaysAgo: 1,
      });
      await q(
        "INSERT INTO cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by) VALUES ('Leaving Co', 'leav', current_date + 10, 'Cancelled', 'test')",
      );
      await card("nolaunch", "No Launch", {
        launchedDaysAgo: null,
        sessionDaysAgo: 1,
      });
      await card("opn", "Open Invite", {
        launchedDaysAgo: 70,
        sessionDaysAgo: 1,
      });
      await q(
        "SELECT public.cockpit_form_invite_issue_system('opn', 'nps', ARRAY['portal'], '{}', 'schedule')",
      );
      const out = await run();
      expect(out.issued.nps).toBe(0);
      expect(out.skipped).toMatchObject({ notActive: 3, leaving: 1, open: 1 });
      // The seated cards A and B have no launch date either.
      expect(out.skipped.noLaunch).toBe(3);
      for (const t of ["gh", "sales", "stop", "leav", "nolaunch"])
        expect(await invitesOf(t)).toHaveLength(0);
    });
  });

  test("a form not switched on for clients is skipped as notLive and said in the note", async () => {
    await rolledBack(async () => {
      await scheduleOn();
      await card("nl", "Not Live", { launchedDaysAgo: 70, sessionDaysAgo: 1 });
      const out = await run();
      expect(out.issued).toEqual({ nps: 0, csat: 0 });
      expect(out.skipped.notLive).toBe(2);
      expect(out.note).toContain(
        "The NPS survey is not switched on for clients yet.",
      );
    });
  });

  test("a manual send resets the 90 days (V21)", async () => {
    await rolledBack(async () => {
      await live("nps");
      await scheduleOn();
      await card("man", "Manual Send", {
        launchedDaysAgo: 120,
        sessionDaysAgo: 1,
      });
      const id = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('man', 'nps', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      await q(
        "UPDATE cockpit_form_invites SET origin = 'csm', issued_by_role = 'the CSM' WHERE id = $1::uuid",
        [id],
      );
      await age(id, 10);
      const out = await run();
      expect(out.issued.nps).toBe(0);
      expect(out.skipped.tooSoon).toBeGreaterThanOrEqual(1);
    });
  });

  test("CSAT: a live session gets the portal on day 0; no session waits to day 3 for portal and WhatsApp; no workspace WhatsApp only; past 60 days never", async () => {
    await rolledBack(async () => {
      await live("csat");
      await scheduleOn();
      await card("s0", "Session Zero", {
        launchedDaysAgo: 0,
        sessionDaysAgo: 1,
      });
      await card("n0", "No Session Zero", {
        launchedDaysAgo: 0,
        sessionDaysAgo: null,
      });
      await card("n2", "No Session Two", {
        launchedDaysAgo: 2,
        sessionDaysAgo: 20,
      });
      await card("n3", "No Session Three", {
        launchedDaysAgo: 3,
        sessionDaysAgo: null,
      });
      await card("w3", "No Workspace Three", {
        launchedDaysAgo: 3,
        workspace: null,
      });
      await card("old", "Launched Long Ago", {
        launchedDaysAgo: 61,
        sessionDaysAgo: 1,
      });
      const out = await run();
      expect(out.issued.csat).toBe(3);
      expect(out.skipped.waitingForWhatsAppDay).toBe(2);
      expect(out.skipped.tooOld).toBe(1);
      expect((await invitesOf("s0"))[0]).toMatchObject({
        channels: ["portal"],
        has_message: false,
        context: { try: 1 },
      });
      expect(await invitesOf("n0")).toHaveLength(0);
      expect(await invitesOf("n2")).toHaveLength(0);
      expect((await invitesOf("n3"))[0]).toMatchObject({
        channels: ["portal", "whatsapp"],
        has_message: true,
      });
      expect((await invitesOf("w3"))[0]).toMatchObject({
        channels: ["whatsapp"],
        has_message: true,
      });
      expect(await invitesOf("old")).toHaveLength(0);
      // The WhatsApp links wait for a CSM's approval: the schedule never approves (V7).
      expect(
        await q(
          "SELECT state FROM cockpit_client_messages WHERE task_id IN ('n3','w3') ORDER BY task_id",
        ),
      ).toEqual([{ state: "draft" }, { state: "draft" }]);
    });
  });

  test("CSAT: never after an answer; a retry waits 7 days after the last close; later tries are portal only; no workspace gets no later try; at most 1 + 3 tries", async () => {
    await rolledBack(async () => {
      await live("csat");
      await scheduleOn();
      // Answered: filled.
      await card("ans", "Answered Co", {
        launchedDaysAgo: 5,
        sessionDaysAgo: 1,
      });
      await run();
      const [a1] = await invitesOf("ans");
      expect((await answer("ans", a1.id, { onboarding: 8 })).ok).toBe(true);
      // A retry for an unanswered first try.
      await card("rt", "Retry Co", {
        launchedDaysAgo: 20,
        sessionDaysAgo: null,
      });
      // No workspace: one WhatsApp link, then nothing.
      await card("nw", "No Workspace Co", {
        launchedDaysAgo: 20,
        workspace: null,
      });
      await run();
      const [r1] = await invitesOf("rt");
      const [w1] = await invitesOf("nw");
      expect(r1.channels).toEqual(["portal", "whatsapp"]);
      await age(r1.id, 14);
      await age(w1.id, 14);
      const shift = (id: string, days: number) =>
        q(
          "UPDATE cockpit_form_invites SET closed_at = closed_at - make_interval(days => $2::integer), expires_at = expires_at - make_interval(days => $2::integer) WHERE id = $1::uuid",
          [id, days],
        );
      await shift(r1.id, 6);
      await shift(w1.id, 8);
      let out = await run();
      expect(out.issued.csat).toBe(0);
      expect(out.skipped.filled).toBe(1);
      expect(out.skipped.tooSoon).toBe(1); // rt: closed 6 days ago
      expect(out.skipped.noPortal).toBe(1); // nw
      await shift(r1.id, 1);
      out = await run();
      expect(out.issued.csat).toBe(1);
      const rt = await invitesOf("rt");
      expect(rt.map(i => [i.channels, i.context.try])).toEqual([
        [["portal", "whatsapp"], 1],
        [["portal"], 2],
      ]);
      // Two more tries closed long ago make four: no fifth.
      for (let n = 0; n < 2; n++) {
        const last = (await invitesOf("rt")).at(-1)!;
        await age(last.id, 14);
        await shift(last.id, 8);
        expect((await run()).issued.csat).toBe(1);
      }
      const last = (await invitesOf("rt")).at(-1)!;
      expect(last.context.try).toBe(4);
      await age(last.id, 14);
      await shift(last.id, 8);
      out = await run();
      expect(out.issued.csat).toBe(0);
      expect(out.skipped.triesUsed).toBe(1);
    });
  });

  test("CSAT: a CSM's withdraw is final for the schedule (V26); Sent again is not", async () => {
    await rolledBack(async () => {
      await live("csat");
      await scheduleOn();
      for (const [task, name, loc] of [[A, "Acme Interiors", "locA"], [B, "Beta Build", "locB"]]) {
        await q("INSERT INTO cockpit_client_billing_days(day, clickup_task_id, client_name, launch_date) VALUES ($1::date, $2, $3, $1::date)", [await daysAgo(10), task, name]);
        await q("INSERT INTO cockpit_portal_presence(location_id, last_session_at, admins, members, pushed_at) VALUES ($1, now() - interval '1 day', 1, 1, now())", [loc]);
      }
      expect((await run()).issued.csat).toBe(2);
      const [a1] = await invitesOf(A, "csat");
      const [b1] = await invitesOf(B, "csat");
      await as(CSM_A, "SELECT public.cockpit_form_invite_withdraw($1, $2::uuid, 'The owner asked us not to send surveys') AS r", [A, a1.id]);
      await as(CSM_B, "SELECT public.cockpit_form_invite_withdraw($1, $2::uuid, 'Sent again') AS r", [B, b1.id]);
      for (const id of [a1.id, b1.id])
        await q("UPDATE cockpit_form_invites SET issued_at = issued_at - interval '21 days', closed_at = closed_at - interval '20 days' WHERE id = $1::uuid", [id]);
      const out = await run();
      expect(out.skipped.withdrawnBySeat).toBe(1);
      // Beta's was withdrawn to send again: the schedule tries again after 7 days; Acme's never.
      expect(out.issued.csat).toBe(1);
      expect(await invitesOf(A, "csat")).toHaveLength(1);
      expect(await invitesOf(B, "csat")).toHaveLength(2);
    });
  });

  test("at most 3 new invites per form a day, oldest launch first; a second run the same day adds none; the next day takes the rest", async () => {
    await rolledBack(async () => {
      await live("nps");
      await scheduleOn();
      for (const n of [70, 71, 72, 73, 74])
        await card(`cap${n}`, `Cap ${n}`, {
          launchedDaysAgo: n,
          sessionDaysAgo: 1,
        });
      const out = await run();
      expect(out.issued.nps).toBe(3);
      expect(out.skipped.cap).toBe(2);
      expect(out.note).toContain(
        "2 more wait for the next day's cap of 3 per form.",
      );
      const issued = (
        await q<any>(
          "SELECT task_id FROM cockpit_form_invites WHERE form_key = 'nps' ORDER BY task_id",
        )
      ).map(r => r.task_id);
      expect(issued).toEqual(["cap72", "cap73", "cap74"]);
      expect((await run()).issued.nps).toBe(0);
      const tomorrow = await run(true, "now() + interval '1 day'");
      expect(tomorrow.issued.nps).toBe(2);
    });
  });

  test("one client form per card a run: CSAT first, NPS the next day", async () => {
    await rolledBack(async () => {
      await live("nps", "csat");
      await scheduleOn();
      await card("both", "Both Due", {
        launchedDaysAgo: 60,
        sessionDaysAgo: 1,
      });
      const out = await run();
      expect(out.issued).toEqual({ nps: 0, csat: 1 });
      expect(out.skipped.oneFormToday).toBe(1);
      expect((await invitesOf("both")).map(i => i.form_key)).toEqual(["csat"]);
      const next = await run(true, "now() + interval '1 day'");
      expect(next.issued.nps).toBe(1);
    });
  });

  test("the sweep withdraws the open NPS and CSAT invites of a card that is no longer Active or is leaving", async () => {
    await rolledBack(async () => {
      await live("nps", "csat");
      await card("stp", "Stops Today", {
        launchedDaysAgo: 80,
        sessionDaysAgo: 1,
      });
      await card("lv", "Leaves Today", {
        launchedDaysAgo: 10,
        sessionDaysAgo: 1,
      });
      await q(
        "SELECT public.cockpit_form_invite_issue_system('stp', 'nps', ARRAY['portal'], '{}', 'schedule')",
      );
      await q(
        "SELECT public.cockpit_form_invite_issue_system('lv', 'csat', ARRAY['portal'], '{}', 'schedule')",
      );
      await q(
        "UPDATE cockpit_billing_accounts SET client_status = 'Stopped' WHERE clickup_task_id = 'stp'",
      );
      await q(
        "INSERT INTO cockpit_churn_departures(client, clickup_task_id, left_on, reason, created_by) VALUES ('Leaves Today', 'lv', current_date + 10, 'Cancelled', 'test')",
      );
      const out = await run();
      expect(out.withdrawn.ineligible).toBe(2);
      expect((await invitesOf("stp"))[0].state).toBe("withdrawn");
      expect((await invitesOf("lv"))[0].state).toBe("withdrawn");
    });
  });

  test("a rule key that is missing or not a whole number stops that form with ruleNotSet and says which key; it never sends", async () => {
    for (const [key, value] of [
      ["maxAgeDays", null],
      ["retryAfterDays", null],
      ["retryAfterDays", '"7"'],
    ] as const) {
      await rolledBack(async () => {
        await live("csat");
        await scheduleOn();
        await card("rule", "Rule Co", {
          launchedDaysAgo: 1,
          sessionDaysAgo: 1,
        });
        await q(
          value === null
            ? "UPDATE cockpit_form_schedules SET rule = rule - $1 WHERE form_key = 'csat'"
            : "UPDATE cockpit_form_schedules SET rule = jsonb_set(rule, ARRAY[$1], $2::jsonb) WHERE form_key = 'csat'",
          value === null ? [key] : [key, value],
        );
        const out = await run();
        expect(out.issued.csat).toBe(0);
        expect(out.skipped.ruleNotSet).toBe(1);
        expect(out.note).toContain(
          `The csat rule has no ${key}. Set it in the forms editor.`,
        );
        expect(await invitesOf("rule")).toHaveLength(0);
      });
    }
  });
});

// --- The hooks (4.5.2, 4.5.3) --------------------------------------------------------------------

describe("the NPS and CSAT hooks", () => {
  test("the NPS issue hook writes one nps_sent billing event with the day and the round; the CSAT issue hook counts the try", async () => {
    await rolledBack(async () => {
      await live("nps", "csat");
      await card("h1", "Hook One", { launchedDaysAgo: 90, sessionDaysAgo: 1 });
      const first = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('h1', 'nps', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      const events = await q<any>(
        "SELECT kind, source, by_whom, to_value, detail FROM cockpit_billing_events WHERE clickup_task_id = 'h1'",
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "nps_sent",
        source: "system",
        by_whom: "the cockpit",
        to_value: await today(),
      });
      expect(events[0].detail).toEqual({
        invite_id: first,
        on: await today(),
        round: 1,
      });
      await age(first, 100);
      await q(
        "SELECT public.cockpit_form_invite_issue_system('h1', 'nps', ARRAY['portal'], '{}', 'schedule')",
      );
      expect(
        (
          await q<any>(
            "SELECT detail->>'round' AS r FROM cockpit_billing_events WHERE clickup_task_id = 'h1' ORDER BY id",
          )
        ).map(r => r.r),
      ).toEqual(["1", "2"]);
      await q(
        "SELECT public.cockpit_form_invite_issue_system('h1', 'csat', ARRAY['portal'], '{}', 'schedule')",
      );
      expect((await invitesOf("h1", "csat"))[0].context.try).toBe(1);
    });
  });

  test("an answer queues its 'answer in' notice and, at 6 and not at 7, the low-score call; the facts carry no free text", async () => {
    await rolledBack(async () => {
      await live("nps", "csat");
      for (const t of ["six", "seven", "csat6"])
        await card(t, `Client ${t}`, {
          launchedDaysAgo: 70,
          sessionDaysAgo: 1,
        });
      const six = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('six', 'nps', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      const seven = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('seven', 'nps', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      const c6 = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('csat6', 'csat', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      const secret = "Please stop calling my personal number";
      expect(
        (
          await answer("six", six, {
            recommend: 6,
            results: 4,
            startStop: secret,
          })
        ).ok,
      ).toBe(true);
      expect((await answer("seven", seven, { recommend: 7 })).ok).toBe(true);
      expect(
        (await answer("csat6", c6, { onboarding: 6, liked: secret })).ok,
      ).toBe(true);
      const nps = await notices("nps.received");
      expect(
        nps.map(n => [
          n.task_id,
          n.facts.score,
          n.facts.results ?? null,
          n.state,
        ]),
      ).toEqual([
        ["six", 6, 4, "queued"],
        ["seven", 7, null, "queued"],
      ]);
      expect(nps[0].dedupe_key).toStartWith("nps:");
      expect(nps[0].facts).toMatchObject({
        client: "Client six",
        round: 1,
        survey: "NPS survey",
        form: "nps",
        taskId: "six",
      });
      const csat = await notices("csat.received");
      expect(csat.map(n => [n.task_id, n.facts.score])).toEqual([["csat6", 6]]);
      expect(csat[0].dedupe_key).toStartWith("csat:");
      const low = await notices("voice.low");
      // voice.low names its survey by facts.form, as cockpit-notices/text.ts reads it.
      expect(low.map(n => n.facts.form)).toEqual(["nps", "csat"]);
      expect(low.map(n => [n.task_id, n.facts.score, n.facts.survey])).toEqual([
        ["six", 6, "NPS survey"],
        ["csat6", 6, "onboarding survey"],
      ]);
      expect(low[0].dedupe_key).toStartWith("low:");
      for (const n of [...nps, ...csat, ...low])
        expect(JSON.stringify(n.facts)).not.toContain(secret);
      // The line moves with voice.low_score.
      await q(
        "UPDATE cockpit_settings SET value = '{\"max\":7}' WHERE key = 'voice.low_score'",
      );
      expect(
        await one("SELECT public.cockpit_client_voice_low_max() AS r"),
      ).toBe(7);
    });
  });

  test("a canary NPS on the test card: nps_sent by 'canary', the answer stored shadow, its notices muted, and the client voice untouched", async () => {
    await rolledBack(async () => {
      const before = await q<any>(
        "SELECT count(*)::integer AS n FROM cockpit_client_voice_v",
      );
      const canary = await one<any>(
        "SELECT public.cockpit_form_invite_canary('nps', '{\"round\":1}'::jsonb) AS r",
      );
      const ev = await q<any>(
        "SELECT by_whom, kind FROM cockpit_billing_events WHERE clickup_task_id = $1",
        [TEST_CARD],
      );
      expect(ev).toEqual([{ by_whom: "canary", kind: "nps_sent" }]);
      const token = String(canary.url).split("#")[1];
      const out = await as<any>(
        "service",
        "SELECT public.portal_form_token_submit($1, $2, $3, '{\"recommend\":5}'::jsonb, NULL, $4::uuid, 'en') AS r",
        [await sha(token), await sha("net"), await sha("browser"), rid()],
      );
      expect(out.ok).toBe(true);
      expect(
        await one(
          "SELECT mode AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [out.responseId],
        ),
      ).toBe("shadow");
      const muted = await q<any>(
        "SELECT kind, state, error FROM cockpit_slack_notices WHERE task_id = $1 ORDER BY kind",
        [TEST_CARD],
      );
      expect(muted).toEqual([
        {
          kind: "nps.received",
          state: "muted",
          error: "Canary on the test card: not posted",
        },
        {
          kind: "voice.low",
          state: "muted",
          error: "Canary on the test card: not posted",
        },
      ]);
      expect(
        await q<any>(
          "SELECT count(*)::integer AS n FROM cockpit_client_voice_v",
        ),
      ).toEqual(before);
      expect(
        await one(
          "SELECT count(*)::integer AS r FROM cockpit_form_invites_daily_v",
        ),
      ).toBe(0);
    });
  });
});

// --- The client's voice: the view, the number, the seat reads (3.3, 3.5) ------------------------------

/** One NPS answer through the invite path. */
async function nps(task: string, score: number) {
  const id = await one<string>(
    "SELECT public.cockpit_form_invite_issue_system($1, 'nps', ARRAY['portal'], '{}', 'schedule')::text AS r",
    [task],
  );
  const out = await answer(task, id, {
    recommend: score,
    results: 5,
    communication: 8,
  });
  expect(out.ok).toBe(true);
  return { inviteId: id, responseId: out.responseId as string };
}

describe("the client voice view and the NPS number", () => {
  test("3 promoters, 1 passive and 1 detractor make 40 over 5; a card that answers twice counts once on both sides, with no mismatch note", async () => {
    await rolledBack(async () => {
      await live("nps");
      for (const t of ["v1", "v2", "v3", "v4", "v5"])
        await card(t, `Voice ${t}`, { launchedDaysAgo: 70, sessionDaysAgo: 1 });
      const first = await nps("v1", 2);
      // Answers in one transaction share now(): the earlier one is moved a second back, so "latest" is plain.
      await q(
        "UPDATE cockpit_form_responses SET submitted_at = submitted_at - interval '1 second' WHERE id = $1::uuid",
        [first.responseId],
      );
      await q(
        "UPDATE cockpit_form_invites SET issued_at = issued_at - interval '1 day' WHERE id = $1::uuid",
        [first.inviteId],
      );
      await nps("v1", 10);
      await nps("v2", 9);
      await nps("v3", 9);
      await nps("v4", 8);
      await nps("v5", 3);
      const t = await today();
      const sum = await as<any>(
        CEO,
        "SELECT public.cockpit_client_voice_summary($1::date, $1::date) AS r",
        [t],
      );
      expect(sum.nps).toMatchObject({
        score: 40,
        n: 5,
        promoters: 3,
        passives: 1,
        detractors: 1,
        cardsAnswered: 5,
        note: "",
      });
      // The first invite was issued the day before the window, so the window sent 5 and took 6 answers.
      expect(sum.invites.nps).toEqual({
        sent: 5,
        answered: 6,
        cardsAnswered: 5,
      });
      const bands = await q<any>(
        "SELECT clickup_task_id, score, band FROM cockpit_client_voice_v WHERE form_key = 'nps' ORDER BY clickup_task_id, submitted_at",
      );
      expect(bands.map(b => b.band)).toEqual([
        "detractor",
        "promoter",
        "promoter",
        "promoter",
        "passive",
        "detractor",
      ]);
      // An answer with no answered invite behind it shows as a mismatch in the note.
      await q(
        "INSERT INTO cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers, created_by, submitted_at) VALUES ('nps', 1, 'portal', 'portal:stray', 'v2', 'Voice v2', 'live', 'submitted', '{\"recommend\":10}', 'test', now())",
      );
      await card("v6", "Voice v6", { launchedDaysAgo: 70 });
      await q(
        "INSERT INTO cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers, created_by, submitted_at) VALUES ('nps', 1, 'portal', 'portal:stray6', 'v6', 'Voice v6', 'live', 'submitted', '{\"recommend\":10}', 'test', now())",
      );
      const off = await as<any>(
        CEO,
        "SELECT public.cockpit_client_voice_summary($1::date, $1::date) AS r",
        [t],
      );
      expect(off.nps.n).toBe(6);
      expect(off.nps.note).toBe(
        "Cards with an answered invite 5, cards with an answer 6.",
      );
    });
  });

  test("the CEO refresh's own reads (voice.js) give the same NPS as the SQL summary, as the read-only role", async () => {
    const voice = await import("../../../hermes/ceo-refresh/native/voice.js");
    await rolledBack(async () => {
      await live("nps", "csat");
      for (const t of ["p1", "p2", "p3", "p4"])
        await card(t, `Parity ${t}`, {
          launchedDaysAgo: 70,
          sessionDaysAgo: 1,
        });
      await nps("p1", 10);
      await nps("p2", 6);
      await nps("p3", 7);
      const c = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system('p4', 'csat', ARRAY['portal'], '{}', 'schedule')::text AS r",
      );
      await answer("p4", c, { onboarding: 9 });
      await db.exec("SET LOCAL ROLE supabase_read_only_user");
      const rows = async (sql: string) => (await db.query<any>(sql)).rows;
      const payload = voice.voicePayload(
        {
          answers: voice.answersOf(await rows(voice.VOICE_SQL.answers)),
          answered: voice.answeredOf(await rows(voice.VOICE_SQL.answered)),
          daily: voice.dailyOf(await rows(voice.VOICE_SQL.daily)),
        },
        await today(),
      );
      await db.exec("RESET ROLE");
      const sum = await as<any>(
        CEO,
        "SELECT public.cockpit_client_voice_summary($1::date, $2::date) AS r",
        [payload.windows.mtd.from, payload.windows.mtd.to],
      );
      expect(payload.windows.mtd.nps).toEqual({
        score: sum.nps.score,
        n: sum.nps.n,
        promoters: sum.nps.promoters,
        passives: sum.nps.passives,
        detractors: sum.nps.detractors,
        cardsAnswered: sum.nps.cardsAnswered,
        note: sum.nps.note,
      });
      expect(payload.windows.mtd.nps.score).toBe(0);
      expect(payload.windows.mtd.csat).toEqual({ average: 9, n: 1 });
      expect(Number(sum.csat.average)).toBe(9);
      expect(payload.windows.mtd.invites).toEqual(sum.invites);
    });
  });

  test("no answers in the window: the score is NULL with 'No scores yet.', never 0", async () => {
    const sum = await as<any>(
      CEO,
      "SELECT public.cockpit_client_voice_summary('2020-01-01'::date, '2020-01-31'::date) AS r",
    );
    expect(sum.nps.score).toBeNull();
    expect(sum.nps.n).toBe(0);
    expect(sum.nps.note).toBe("No scores yet.");
    expect(sum.csat.average).toBeNull();
  });

  test("the view leaves out legacy Typeform answers and gives a feedback rating no band", async () => {
    await rolledBack(async () => {
      await as(
        "service",
        "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
        [
          JSON.stringify({
            formKey: "nps",
            externalId: "npsOld00001",
            submittedAt: "2026-10-28T08:00:00Z",
            answers: { fields: [] },
            hidden: { onboarding_client_id: A },
            backfill: true,
          }),
        ],
      );
      expect(
        await one(
          "SELECT count(*)::integer AS r FROM cockpit_client_voice_v WHERE form_key = 'nps'",
        ),
      ).toBe(0);
      await live("portal_feedback");
      await as(
        "service",
        "SELECT public.portal_feedback_record('locA', $1, 'owner@client.invalid', $2::jsonb) AS r",
        [
          A,
          JSON.stringify({
            feedbackId: "fb-0000001",
            kind: "idea",
            topic: "portal",
            message: "A calendar view would help.",
            rating: 4,
            contactOk: true,
            createdAt: Date.now(),
          }),
        ],
      );
      expect(
        await q<any>(
          "SELECT form_key, score, band FROM cockpit_client_voice_v",
        ),
      ).toEqual([{ form_key: "portal_feedback", score: 4, band: null }]);
    });
  });

  test("the seat reads: a CSM reads their own client, never another's; anon nothing; the source sentence counts the old answers", async () => {
    await rolledBack(async () => {
      await live("nps", "csat");
      await q(
        "INSERT INTO cockpit_client_billing_days(day, clickup_task_id, client_name, launch_date) VALUES (current_date - 80, $1, 'Acme Interiors', current_date - 80)",
        [A],
      );
      await nps(A, 9);
      const csatId = await one<string>(
        "SELECT public.cockpit_form_invite_issue_system($1, 'csat', ARRAY['portal'], '{}', 'schedule')::text AS r",
        [A],
      );
      await answer(A, csatId, {
        onboarding: 7,
        liked: "Fast launch",
        disliked: "Too many forms",
      });
      for (const tok of ["npsOld00001", "npsOld00002"])
        await as(
          "service",
          "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
          [
            JSON.stringify({
              formKey: tok === "npsOld00001" ? "nps" : "csat",
              externalId: tok,
              submittedAt: "2026-10-28T08:00:00Z",
              answers: { fields: [] },
              backfill: true,
            }),
          ],
        );
      const read = await as<any>(
        CSM_A,
        "SELECT public.cockpit_client_voice_read($1) AS r",
        [A],
      );
      expect(read.nps.latest).toMatchObject({
        score: 9,
        results: 5,
        communication: 8,
        round: 1,
      });
      expect(read.nps.history).toHaveLength(1);
      expect(read.csat).toMatchObject({
        score: 7,
        liked: "Fast launch",
        disliked: "Too many forms",
      });
      expect(read.open).toEqual([]);
      expect(read.source).toBe(
        "From the client's own answers in the portal or by link. The 2 old Typeform answers could not be matched to a client, so they are left out.",
      );
      expect(JSON.stringify(read)).not.toContain("@");
      const other = await refusal(() =>
        as(CSM_B, "SELECT public.cockpit_client_voice_read($1) AS r", [A]),
      );
      expect(other.code).toBe("42501");
      const anon = await refusal(() =>
        as(null, "SELECT public.cockpit_client_voice_read($1) AS r", [A]),
      );
      expect(["42501"]).toContain(anon.code);
      const fin = await refusal(() =>
        as(
          FINANCE,
          "SELECT public.cockpit_client_voice_summary(current_date - 30, current_date) AS r",
        ),
      );
      expect(fin.message).toBe(
        "The client voice summary is for client success and the CEO.",
      );
    });
  });

  test("Today's low score: listed for the client's CSM, ticketOpen once a client_low_score request for the card exists after the answer", async () => {
    await rolledBack(async () => {
      await live("nps");
      await q(
        "INSERT INTO cockpit_client_billing_days(day, clickup_task_id, client_name, launch_date) VALUES (current_date - 80, $1, 'Acme Interiors', current_date - 80)",
        [A],
      );
      const { responseId } = await nps(A, 4);
      let rows = await as<any[]>(
        CSM_A,
        "SELECT public.cockpit_client_voice_today() AS r",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "low_score",
        responseId,
        taskId: A,
        formKey: "nps",
        score: 4,
        ticketOpen: false,
      });
      expect(
        await as<any[]>(
          CSM_B,
          "SELECT public.cockpit_client_voice_today() AS r",
        ),
      ).toEqual([]);
      expect(
        await as<any[]>(CEO, "SELECT public.cockpit_client_voice_today() AS r"),
      ).toHaveLength(1);
      // The type D-R2 adds, cloned from a seeded type's questions (the request types guard checks their shape).
      await q(`INSERT INTO cockpit_request_types(key, type_index, label, clickup_option_name, request_type_option_id, team, targets, fields,
                 sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
               SELECT 'client_low_score', 90, 'Client low score', 'Client low score', gen_random_uuid(), t.team, t.targets, t.fields,
                      t.sop_steps, t.sop_steps_state, t.sop_url, t.due_days, t.priority, t.set_request_type, true, 1, 'test'
                 FROM cockpit_request_types t WHERE t.team = 'client_success' ORDER BY t.type_index LIMIT 1`);
      // A request raised before the answer does not cover it.
      const member = await one<string>(
        "SELECT id::text AS r FROM cockpit_members WHERE auth_user_id = $1::uuid",
        [CSM_A],
      );
      const req = (at: string) =>
        q(
          `INSERT INTO cockpit_requests(id, type_key, type_version, type_label, requester_member_id, requester_label, source, client_task_id,
                 client_name, priority, state, content_hash, created_at)
           VALUES (gen_random_uuid(), 'client_low_score', 1, 'Client low score', $1::uuid, 'the CSM', 'client_page', $2, 'Acme Interiors',
                   'high', 'delivered', 'x', ${at})`,
          [member, A],
        );
      await req("now() - interval '2 days'");
      rows = await as<any[]>(
        CSM_A,
        "SELECT public.cockpit_client_voice_today() AS r",
      );
      expect(rows[0].ticketOpen).toBe(false);
      await req("now() + interval '1 minute'");
      rows = await as<any[]>(
        CSM_A,
        "SELECT public.cockpit_client_voice_today() AS r",
      );
      expect(rows[0].ticketOpen).toBe(true);
    });
  });

  test("every STABLE read runs inside a read-only transaction", async () => {
    await rolledBack(async () => {
      await live("nps");
      await q(
        "INSERT INTO cockpit_client_billing_days(day, clickup_task_id, client_name, launch_date) VALUES (current_date - 80, $1, 'Acme Interiors', current_date - 80)",
        [A],
      );
      await nps(A, 9);
      await q(
        "INSERT INTO cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state, answers, answer_meta, created_by, submitted_at) VALUES ('onboarding', 1, 'typeform_webhook', 'onbRO00001', $1, 'Acme Interiors', 'live', 'submitted', '{\"fields\":[]}', '{\"match\":\"hidden_id_unverified\"}', 'forms-door', now())",
        [A],
      );
      await db.exec("SET TRANSACTION READ ONLY");
      expect(
        (
          await as<any>(
            CSM_A,
            "SELECT public.cockpit_client_voice_read($1) AS r",
            [A],
          )
        ).nps.latest.score,
      ).toBe(9);
      expect(
        await as<any[]>(CEO, "SELECT public.cockpit_client_voice_today() AS r"),
      ).toEqual([]);
      expect(
        (
          await as<any>(
            CEO,
            "SELECT public.cockpit_client_voice_summary(current_date - 1, current_date + 1) AS r",
          )
        ).nps.n,
      ).toBe(1);
      expect(
        (
          await as<any>(
            "service",
            "SELECT public.portal_form_status('locA', $1, 'onboarding') AS r",
            [A],
          )
        ).submitted,
      ).toBe(true);
    });
  });
});

// --- The feedback bridge (4.6) -------------------------------------------------------------------

describe("portal_feedback_record", () => {
  const feedback = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      feedbackId: "fb-0000042",
      kind: "problem",
      topic: "results",
      message: "The report link opened a blank page.",
      rating: 2,
      contactOk: false,
      createdAt: "2026-11-01T09:30:00Z",
      ...over,
    });
  const record = (
    loc: string,
    task: string,
    body: string,
    person = "owner@client.invalid",
  ) =>
    as<any>(
      "service",
      "SELECT public.portal_feedback_record($1, $2, $3, $4::jsonb) AS r",
      [loc, task, person, body],
    );

  test("refused as not_live until portal_feedback is switched on; nothing is stored", async () => {
    await rolledBack(async () => {
      expect(await record("locA", A, feedback())).toEqual({
        recorded: false,
        reason: "not_live",
      });
      expect(
        await one(
          "SELECT count(*)::integer AS r FROM cockpit_form_responses WHERE form_key = 'portal_feedback'",
        ),
      ).toBe(0);
    });
  });

  test("live: one response per feedback id, a feedback.received notice with names and codes only; a repeat stores nothing more", async () => {
    await rolledBack(async () => {
      await live("portal_feedback");
      const first = await record("locA", A, feedback());
      expect(first).toMatchObject({ recorded: true, inserted: true });
      const again = await record("locA", A, feedback());
      expect(again).toEqual({
        recorded: true,
        inserted: false,
        responseId: first.responseId,
      });
      const row = await q<any>(
        "SELECT form_key, source, external_id, task_id, client_name, state, mode, answers, submitted_by, submitted_at FROM cockpit_form_responses WHERE form_key = 'portal_feedback'",
      );
      expect(row).toHaveLength(1);
      expect(row[0]).toMatchObject({
        source: "portal",
        external_id: "feedback:fb-0000042",
        task_id: A,
        client_name: "Acme Interiors",
        state: "submitted",
        mode: "live",
        answers: {
          kind: "problem",
          topic: "results",
          rating: 2,
          contactOk: false,
          message: "The report link opened a blank page.",
        },
      });
      const n = await notices("feedback.received");
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({
        dedupe_key: `feedback:${first.responseId}`,
        task_id: A,
        client_name: "Acme Interiors",
        state: "queued",
      });
      // The fact names cockpit-notices/text.ts renders (feedbackKind, topic).
      expect(n[0].facts).toMatchObject({
        feedbackKind: "problem",
        topic: "results",
        client: "Acme Interiors",
        taskId: A,
      });
      expect(JSON.stringify(n[0].facts)).not.toContain("blank page");
      expect(JSON.stringify(n[0].facts)).not.toContain("@");
      // The rating never enters NPS.
      const sum = await as<any>(
        CEO,
        "SELECT public.cockpit_client_voice_summary(current_date - 30, current_date + 1) AS r",
      );
      expect(sum.nps.n).toBe(0);
    });
  });

  test("a workspace that is not this card's, or a closed one, raises form_invite_not_in_workspace; a bad person or shape is refused", async () => {
    await rolledBack(async () => {
      await live("portal_feedback");
      expect((await refusal(() => record("locB", A, feedback()))).message).toBe(
        "form_invite_not_in_workspace",
      );
      await q(
        "UPDATE portal_data.workspaces SET status = 'Cancelled' WHERE location_id = 'locA'",
      );
      expect((await refusal(() => record("locA", A, feedback()))).message).toBe(
        "form_invite_not_in_workspace",
      );
      await q(
        "UPDATE portal_data.workspaces SET status = 'Active' WHERE location_id = 'locA'",
      );
      expect(
        (await refusal(() => record("locA", A, feedback(), "not an email")))
          .message,
      ).toBe("client_ask_invalid_person");
      expect(await record("locA", A, feedback({ kind: "rant" }))).toEqual({
        recorded: false,
        reason: "invalid",
      });
      expect(await record("locA", A, feedback({ rating: 9 }))).toEqual({
        recorded: false,
        reason: "invalid",
      });
      expect(await record("locA", A, feedback({ message: "   " }))).toEqual({
        recorded: false,
        reason: "invalid",
      });
      // The portal's createdAt in epoch milliseconds is read too.
      expect(
        (
          await record(
            "locA",
            A,
            feedback({
              feedbackId: "fb-0000043",
              createdAt: Date.parse("2026-11-01T10:00:00Z"),
              rating: null,
            }),
          )
        ).recorded,
      ).toBe(true);
      expect(
        await one(
          "SELECT has_function_privilege('authenticated', 'public.portal_feedback_record(text,text,text,jsonb)', 'EXECUTE') AS r",
        ),
      ).toBe(false);
    });
  });
});

// --- Onboarding C6 and the New Client Form (4.7, 4.8) ------------------------------------------------

describe("cockpit_form_record_make and portal_form_status", () => {
  const onboarding = (
    token: string,
    at: string,
    card: string | null = A,
    extra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      formKey: "onboarding",
      externalId: token,
      submittedAt: at,
      answers: {
        fields: [
          { ref: "q-company", title: "Company name", value: "Acme Interiors" },
        ],
      },
      hidden: card
        ? {
            onboarding_client_id: card,
            client_name: "Acme Interiors",
            utm_source: "kept-out",
          }
        : {},
      ...extra,
    });
  const make = (body: string) =>
    as<any>(
      "service",
      "SELECT public.cockpit_form_record_make($1::jsonb) AS r",
      [body],
    );

  test("an onboarding answer on a mirrored card is stored submitted with no notice and fills the read model in the poll's shape, only when empty or older", async () => {
    await rolledBack(async () => {
      await q(
        'INSERT INTO cockpit_client_onboarding(clickup_task_id, client_name, forms) VALUES ($1, \'Acme Interiors\', \'{"kickoff":{"form_id":"tG7dnxBn","response_id":"kick0001","submitted_at":"2026-10-01T08:00:00Z","answers":[]}}\')',
        [A],
      );
      const noticesBefore = await one<number>(
        "SELECT count(*)::integer AS r FROM cockpit_slack_notices",
      );
      const out = await make(onboarding("onb00000001", "2026-10-20T08:00:00Z"));
      expect(out).toMatchObject({
        inserted: true,
        taskId: A,
        readModel: "written",
      });
      const r = await q<any>(
        "SELECT state, source, mode, task_id, hidden, answer_meta FROM cockpit_form_responses WHERE id = $1::uuid",
        [out.responseId],
      );
      expect(r[0]).toMatchObject({
        state: "submitted",
        source: "typeform_webhook",
        mode: "live",
        task_id: A,
        hidden: { onboarding_client_id: A, client_name: "Acme Interiors" },
        answer_meta: { match: "hidden_id_unverified", owner: "make" },
      });
      expect(
        await one(
          "SELECT forms->'onboarding' AS r FROM cockpit_client_onboarding WHERE clickup_task_id = $1",
          [A],
        ),
      ).toEqual({
        form_id: "KFRCXPFx",
        response_id: "onb00000001",
        submitted_at: "2026-10-20T08:00:00Z",
        answers: [
          { ref: "q-company", title: "Company name", value: "Acme Interiors" },
        ],
      });
      // The kickoff beside it is kept, and no notice of any kind is queued (V23).
      expect(
        await one(
          "SELECT forms->'kickoff'->>'response_id' AS r FROM cockpit_client_onboarding WHERE clickup_task_id = $1",
          [A],
        ),
      ).toBe("kick0001");
      expect(
        await one<number>(
          "SELECT count(*)::integer AS r FROM cockpit_slack_notices",
        ),
      ).toBe(noticesBefore);
      // An older answer keeps the newer one; a newer one replaces it; a repeat stores nothing.
      expect(
        (await make(onboarding("onb00000000", "2026-10-10T08:00:00Z")))
          .readModel,
      ).toBe("newer_kept");
      expect(
        (await make(onboarding("onb00000002", "2026-10-25T08:00:00Z")))
          .readModel,
      ).toBe("written");
      expect(
        await one(
          "SELECT forms->'onboarding'->>'response_id' AS r FROM cockpit_client_onboarding WHERE clickup_task_id = $1",
          [A],
        ),
      ).toBe("onb00000002");
      expect(
        (await make(onboarding("onb00000002", "2026-10-25T08:00:00Z")))
          .inserted,
      ).toBe(false);
      // A card the cockpit does not mirror is kept with no card, and the read model is not touched.
      expect(
        await make(
          onboarding("onb00000003", "2026-10-26T08:00:00Z", "notacard"),
        ),
      ).toMatchObject({ inserted: true, taskId: null, readModel: "no_card" });
    });
  });

  test("portal_form_status gives the card's newest stored onboarding answer, unverified, after the workspace check", async () => {
    await rolledBack(async () => {
      const none = await as<any>(
        "service",
        "SELECT public.portal_form_status('locA', $1, 'onboarding') AS r",
        [A],
      );
      expect(none).toEqual({
        submitted: false,
        submittedAt: null,
        reference: null,
        source: null,
        unverified: false,
      });
      await make(onboarding("onb00000010", "2026-10-20T08:00:00Z"));
      const newest = await make(
        onboarding("onb00000011", "2026-10-22T08:00:00Z", A, {
          backfill: true,
        }),
      );
      const st = await as<any>(
        "service",
        "SELECT public.portal_form_status('locA', $1, 'onboarding') AS r",
        [A],
      );
      expect(st).toMatchObject({
        submitted: true,
        reference: newest.responseId,
        source: "typeform_sync",
        unverified: true,
      });
      expect(
        (
          await refusal(() =>
            as(
              "service",
              "SELECT public.portal_form_status('locB', $1, 'onboarding') AS r",
              [A],
            ),
          )
        ).message,
      ).toBe("form_invite_not_in_workspace");
      expect(
        (
          await refusal(() =>
            as(
              "service",
              "SELECT public.portal_form_status('locA', $1, 'nps') AS r",
              [A],
            ),
          )
        ).message,
      ).toBe("form_status_unknown_form");
    });
  });

  test("the New Client Form is recorded only: its three hidden ids, no card, no read model, no notice", async () => {
    await rolledBack(async () => {
      const before = await one<number>(
        "SELECT count(*)::integer AS r FROM cockpit_slack_notices",
      );
      const out = await make(
        JSON.stringify({
          formKey: "new_client",
          externalId: "ncf00000001",
          submittedAt: "2026-10-30T12:00:00Z",
          answers: {
            fields: [
              { ref: "q-plan", title: "Payment plan", value: "Monthly" },
            ],
          },
          hidden: {
            contact_id: "ghl-contact-1",
            closer: "Closer Test",
            setter: "Setter Test",
            onboarding_client_id: A,
          },
        }),
      );
      expect(out).toMatchObject({
        inserted: true,
        taskId: null,
        readModel: "not_onboarding",
      });
      expect(
        await one(
          "SELECT hidden AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [out.responseId],
        ),
      ).toEqual({
        contact_id: "ghl-contact-1",
        closer: "Closer Test",
        setter: "Setter Test",
      });
      expect(
        await one<number>(
          "SELECT count(*)::integer AS r FROM cockpit_slack_notices",
        ),
      ).toBe(before);
      expect(
        (
          await refusal(() =>
            make(
              JSON.stringify({
                formKey: "kickoff",
                externalId: "ncf00000002",
                submittedAt: "2026-10-30T12:00:00Z",
                answers: { fields: [] },
              }),
            ),
          )
        ).message,
      ).toBe(
        "Only the client onboarding form and the New Client Form are recorded here.",
      );
      expect(
        (
          await refusal(() =>
            as(CEO, "SELECT public.cockpit_form_record_make('{}'::jsonb) AS r"),
          )
        ).code,
      ).toBe("42501");
    });
  });
});

// --- The legacy writer and the keys (2.2 replaced) ------------------------------------------------

describe("the replaced forms-door functions", () => {
  const legacy = (body: Record<string, unknown>) =>
    as<any>(
      "service",
      "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
      [JSON.stringify(body)],
    );

  test("the old NPS and CSAT answers come by the backfill only, with no card", async () => {
    await rolledBack(async () => {
      const out = await legacy({
        formKey: "nps",
        externalId: "npsOld00009",
        submittedAt: "2026-10-28T08:00:00Z",
        answers: { fields: [] },
        hidden: { onboarding_client_id: A, client_name: "Acme Interiors" },
        taskId: A,
        backfill: true,
      });
      expect(out).toMatchObject({ inserted: true, taskId: null });
      expect(
        await one(
          "SELECT state AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [out.responseId],
        ),
      ).toBe("legacy");
      expect(
        (
          await refusal(() =>
            legacy({
              formKey: "csat",
              externalId: "csatOld0009",
              submittedAt: "2026-10-28T08:00:00Z",
              answers: { fields: [] },
            }),
          )
        ).message,
      ).toBe(
        "The old NPS and onboarding survey answers are recorded only by the backfill.",
      );
    });
  });

  test("a termination survey after the exit survey goes native keeps version 1 and also posts 'Old form link used'", async () => {
    await rolledBack(async () => {
      const body = (token: string) => ({
        formKey: "exit_survey",
        externalId: token,
        submittedAt: "2026-11-01T08:00:00Z",
        answers: { fields: [] },
        hidden: { onboarding_client_id: A, client_name: "Acme Interiors" },
      });
      const before = await legacy(body("exitTok0001"));
      expect(await notices("legacy.received")).toHaveLength(0);
      expect(
        await one(
          "SELECT form_version AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [before.responseId],
        ),
      ).toBe(1);
      // C4b: version 2 (the client schema) published, the registry native on it.
      await q(`INSERT INTO cockpit_form_versions(form_key, version, schema, published_by)
               VALUES ('exit_survey', 2, '{"v":1,"key":"exit_survey","fields":[]}', 'test') ON CONFLICT DO NOTHING`);
      await q(
        'UPDATE cockpit_forms SET provider = \'native\', version = 2, schema = \'{"v":1,"key":"exit_survey","fields":[]}\' WHERE key = \'exit_survey\'',
      );
      const after = await legacy(body("exitTok0002"));
      expect(
        await one(
          "SELECT form_version AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [after.responseId],
        ),
      ).toBe(1);
      const n = await notices("legacy.received");
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({
        dedupe_key: `legacy:${after.responseId}`,
        task_id: A,
        client_name: "Acme Interiors",
      });
      expect(n[0].facts).toMatchObject({
        form: "exit_survey",
        matched: true,
        taskId: A,
      });
      expect((await notices("termination.notice")).length).toBe(2);
    });
  });

  test("the two Make forms' keys: saved, registered and said by name; the door's health row takes both forms", async () => {
    await rolledBack(async () => {
      const secret = "s".repeat(40);
      for (const [provider, noun] of [
        ["typeform_onboarding", "client onboarding form"],
        ["typeform_new_client", "New Client Form"],
      ]) {
        const saved = await as<any>(
          "service",
          "SELECT public.cockpit_forms_key_put($1::jsonb) AS r",
          [JSON.stringify({ provider, secret, savedBy: "server" })],
        );
        expect(saved).toMatchObject({ ok: true, provider, state: "unchecked" });
        const form = provider.slice(9);
        expect(
          await one("SELECT note AS r FROM cockpit_sync_state WHERE key = $1", [
            `forms-door:${form}`,
          ]),
        ).toBe(
          `The ${noun} signing key is saved; the webhook is not registered with it yet.`,
        );
        const savedAt = await one<string>(
          "SELECT saved_at::text AS r FROM cockpit_forms_keys WHERE provider = $1",
          [provider],
        );
        const marked = await as<any>(
          "service",
          "SELECT public.cockpit_forms_key_mark($1::jsonb) AS r",
          [
            JSON.stringify({
              provider,
              state: "connected",
              savedAt,
              meta: {
                webhookId: "cockpit",
                registeredAt: "2026-11-02T08:00:00Z",
                unregisteredAt: null,
              },
            }),
          ],
        );
        expect(marked.ok).toBe(true);
        expect(
          await one("SELECT note AS r FROM cockpit_sync_state WHERE key = $1", [
            `forms-door:${form}`,
          ]),
        ).toBe(`The ${noun} webhook is registered.`);
        await as(
          "service",
          "SELECT public.cockpit_forms_door_seen($1, 'recorded', NULL) AS r",
          [form],
        );
        expect(
          await one<string>(
            "SELECT note AS r FROM cockpit_sync_state WHERE key = $1",
            [`forms-door:${form}`],
          ),
        ).toStartWith(`A ${noun} arrived and was stored at `);
      }
      expect(
        await one(
          "SELECT public.cockpit_forms_key_label('typeform_onboarding') AS r",
        ),
      ).toBe("Client onboarding webhook");
      expect(
        await one(
          "SELECT public.cockpit_forms_key_label('typeform_new_client') AS r",
        ),
      ).toBe("New Client Form webhook");
      const status = await as<any>(
        CEO,
        "SELECT public.cockpit_forms_keys_status() AS r",
      );
      expect(status.typeform.map((t: any) => t.form)).toEqual([
        "kickoff",
        "exit_survey",
        "pause_request",
        "onboarding",
        "new_client",
      ]);
      expect(
        status.typeform.find((t: any) => t.form === "onboarding"),
      ).toMatchObject({ connected: true, registered: true });
      expect(
        (
          await refusal(() =>
            as(
              "service",
              "SELECT public.cockpit_forms_door_seen('nps', 'recorded', NULL) AS r",
            ),
          )
        ).message,
      ).toBe(
        "Only kickoff, the termination survey, the pause request, client onboarding and the New Client Form have a cockpit webhook.",
      );
      expect(
        JSON.stringify(
          await q(
            "SELECT * FROM cockpit_audit_log WHERE entity_type = 'cockpit_forms_keys'",
          ),
        ),
      ).not.toContain(secret);
    });
  });
});
