/**
 * supabase/migrations/20261102b_client_lifecycle.sql (docs/forms/WAVE34-CONTRACT.md
 * sections 2.4, 3.8, 4.3, 4.4, 8 and 9 D-B1) on one isolated PostgreSQL with
 * Supabase's default privileges on.
 *
 * The ground is waves 1 and 2 exactly as forms-w12-chain-supabase.test.ts
 * builds it (20261101l to q, the real files in deploy order), plus 20261101r.
 * Then 20261102a: the real file when invites-core's branch has landed it,
 * else the few objects of it this file reads, exactly as the contract names
 * them (A_STUB below: the invites table, the response columns, the go-live
 * list, the six notice kinds, the text rule and the two dispatchers). Then
 * 20261102b, twice. The CEO's address is read from the CEO gate migration;
 * every other person, client and value is invented. Nothing here reaches
 * ClickUp, Slack, Typeform, WhatsApp or the live database.
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

// --- 20261102a, or the part of it this file reads -----------------------------------------------

const FILE_A = "20261102a_forms_invites.sql";
const FILE_B = "20261102b_client_lifecycle.sql";
const R = "20261101r_readers_read_only_grant.sql";
const HAS_A = existsSync(
  new URL(`../../../supabase/migrations/${FILE_A}`, import.meta.url),
);

/** The contract's objects of 20261102a that 20261102b reads (2.3, 3.1, 3.2, 3.4, V19). */
const A_STUB = `
ALTER TABLE public.cockpit_form_responses
  ADD COLUMN invite_id uuid,
  ADD COLUMN signer text CHECK (signer IS NULL OR char_length(btrim(signer)) BETWEEN 2 AND 120),
  ADD COLUMN lang text CHECK (lang IS NULL OR lang IN ('ar','en'));
ALTER TABLE public.cockpit_form_responses DROP CONSTRAINT cockpit_form_responses_source_check;
ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_source_check
  CHECK (source IN ('cockpit','embed','typeform_webhook','typeform_sync','public','import','portal'));
CREATE TABLE public.cockpit_form_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text NOT NULL,
  location_id text,
  form_key text NOT NULL REFERENCES public.cockpit_forms(key),
  form_version integer NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('pause_consent','exit_survey','nps','csat')),
  context jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 4096),
  channels text[] NOT NULL CHECK (cardinality(channels) > 0 AND channels <@ ARRAY['portal','whatsapp','copy']),
  audience text NOT NULL CHECK (audience IN ('any','admin')),
  note text,
  lang text NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  origin text NOT NULL CHECK (origin IN ('csm','schedule','pause','churn','canary')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','withdrawn','expired')),
  issued_by uuid, issued_by_email text, issued_by_role text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  answered_at timestamptz, response_id uuid REFERENCES public.cockpit_form_responses(id),
  closed_at timestamptz, closed_by text, closed_reason text,
  push boolean NOT NULL DEFAULT false, push_state text NOT NULL DEFAULT 'off',
  message_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_key, form_version) REFERENCES public.cockpit_form_versions(form_key, version));
CREATE UNIQUE INDEX cockpit_form_invites_one_open ON public.cockpit_form_invites (task_id, form_key, purpose) WHERE state = 'open';
ALTER TABLE public.cockpit_form_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_invites FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_form_invites TO service_role;
ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_invite_fk
  FOREIGN KEY (invite_id) REFERENCES public.cockpit_form_invites(id);
CREATE UNIQUE INDEX cockpit_form_responses_one_per_invite ON public.cockpit_form_responses (invite_id)
  WHERE invite_id IS NOT NULL AND state IN ('submitted','confirmed');

ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check CHECK (kind = ANY (ARRAY['kickoff','kickoff.updated',
  'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','rehearsal','checkin.grade','checkin.recap_late',
  'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
  'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received']));

INSERT INTO public.cockpit_settings (key, value, updated_by) VALUES ('forms.client', '{"live":[],"presence":false}', 'migration 20261102a')
  ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.cockpit_form_client_live(p_form_key text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce((SELECT f.provider = 'native' AND f.audience = 'client'
                      AND coalesce((SELECT s.value->'live' FROM public.cockpit_settings s WHERE s.key = 'forms.client'), '[]'::jsonb) ? f.key
                     FROM public.cockpit_forms f WHERE f.key = p_form_key), false);
END $$;
CREATE FUNCTION public.cockpit_form_client_version(p_form_key text) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT max(v.version) FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key AND v.schema->>'v' = '1');
END $$;
CREATE FUNCTION public.cockpit_client_text_ok(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_text ~* '(^|[^ء-ي٠-٩A-Za-z0-9_])([وف]?(ال|لل|[بكل]|[بك]ال))?ليد(ز|ات)?(كم|كن|هم|هن|ها|ه|نا|ك)?($|[^ء-ي٠-٩A-Za-z0-9_])|(ال)?عملاء\\s+(ال)?محتمل(ين|ون)|\\mleads?\\M|\\mcpls?\\M|\\mcost\\s+per\\s+lead\\M' THEN
    RETURN 'Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.';
  END IF;
  IF p_text ~* '\\mguarantee[sd]?\\M|\\mguaranteeing\\M|ضمان|نضمن|مضمون' THEN
    RETURN 'Client forms never promise results. Remove the guarantee wording.';
  END IF;
  RETURN NULL;
END $$;
-- The stub's v1 check: the shape this test also checks field by field (3.1).
CREATE FUNCTION public.cockpit_form_schema_check(p_schema jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE f jsonb; v_keys text[] := '{}';
BEGIN
  IF p_schema->>'v' IS DISTINCT FROM '1' THEN RETURN 'The schema is not version 1.'; END IF;
  IF p_schema->>'signer' NOT IN ('none','typed') OR p_schema->>'audience' NOT IN ('any','admin') THEN RETURN 'Who answers is not set.'; END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p_schema->'fields') x LOOP
    IF f->>'key' !~ '^[a-z][a-zA-Z0-9]{1,30}$' OR f->>'key' = ANY(v_keys) THEN RETURN 'A field key is not valid or is used twice.'; END IF;
    IF f->>'type' NOT IN ('scale','choice','multi','text','longtext','tick') THEN RETURN 'A field type is not one of v1.'; END IF;
    IF coalesce(f->'label'->>'en','') = '' OR coalesce(f->'label'->>'ar','') = '' THEN RETURN 'A field needs English and Arabic.'; END IF;
    IF f->'showIf' IS NOT NULL AND f->'showIf' <> 'null'::jsonb AND NOT (f->'showIf'->>'key' = ANY(v_keys)) THEN
      RETURN 'A show-if names a later field.';
    END IF;
    v_keys := v_keys || (f->>'key');
  END LOOP;
  RETURN NULL;
END $$;
-- The dispatchers (V19): common steps, then the hook by name; a submit hook's raise is kept as hook_failed.
CREATE TABLE public.cockpit_form_invite_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES public.cockpit_form_invites(id), at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL, event text NOT NULL, person text, detail jsonb NOT NULL DEFAULT '{}');
ALTER TABLE public.cockpit_form_invite_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_invite_events FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.cockpit_form_client_issued(p_invite_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key text;
BEGIN
  SELECT form_key INTO v_key FROM public.cockpit_form_invites WHERE id = p_invite_id;
  IF to_regprocedure('public.cockpit_form_issue_hook_' || v_key || '(uuid)') IS NOT NULL THEN
    EXECUTE format('SELECT public.%I($1)', 'cockpit_form_issue_hook_' || v_key) USING p_invite_id;
  END IF;
END $$;
CREATE FUNCTION public.cockpit_form_client_submitted(p_response_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses WHERE id = p_response_id;
  UPDATE public.cockpit_form_invites SET state = 'answered', answered_at = r.submitted_at, response_id = r.id, updated_at = now()
   WHERE id = r.invite_id AND state = 'open';
  IF to_regprocedure('public.cockpit_form_hook_' || r.form_key || '(uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE format('SELECT public.%I($1)', 'cockpit_form_hook_' || r.form_key) USING p_response_id;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.cockpit_form_invite_events(invite_id, source, event, detail)
      VALUES (r.invite_id, 'portal', 'hook_failed', jsonb_build_object('hook', r.form_key, 'sqlstate', SQLSTATE));
    END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_form_client_live(text), public.cockpit_form_client_version(text),
  public.cockpit_client_text_ok(text), public.cockpit_form_schema_check(jsonb),
  public.cockpit_form_client_issued(uuid), public.cockpit_form_client_submitted(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
`;

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
  await db.exec(migration(R));
  // The churn read's CSM gate and scope, cut from their files (the whole files
  // would put back an older client rule than 20261017b's). Its roster read is
  // a stand-in with no roster: this test reads the departures and notices only.
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
  // 20261102a: the real file once it has landed, else the contract's objects of it.
  if (HAS_A)
    await realAPrereqs(`
      CREATE SCHEMA IF NOT EXISTS portal_data;
      CREATE TABLE IF NOT EXISTS portal_data.workspaces(location_id text PRIMARY KEY, clickup_id text, name text, status text, language text);
      ALTER TABLE portal_data.workspaces ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON portal_data.workspaces FROM PUBLIC, anon, authenticated;
      INSERT INTO portal_data.workspaces VALUES ('locA', '${A}', 'Acme Interiors', 'Active', NULL), ('locB', '${B}', 'Beta Build', 'Active', NULL)
      ON CONFLICT DO NOTHING;`);
  await db.exec(HAS_A ? withoutCron(migration(FILE_A)) : A_STUB);
  try {
    await db.exec(migration(FILE_B));
  } catch (e) {
    throw new Error(`${FILE_B}: ${(e as Error).message}`);
  }
}, 600_000);

afterAll(async () => {
  await db?.close();
});

// --- This file's helpers ---------------------------------------------------------------------------

const rid = () => crypto.randomUUID();
const kuwaitToday = () =>
  one<string>("SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS r");
const dayFrom = (today: string, n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
const TEST_CARD = "86eywg1cq";

/** The live 20261101p body of cockpit_billing_write, as the deploy saves it before D-B1. */
const OLD_BILLING_WRITE = cut(
  migration("20261101p_money_acts.sql"),
  /CREATE OR REPLACE FUNCTION public\.cockpit_billing_write\(p_action text, p_args jsonb DEFAULT '\{\}'::jsonb\)[\s\S]*?\nEND \$\$;/,
  "the live billing write",
);

const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );

async function goLive(keys: string[]) {
  await ex(
    `UPDATE public.cockpit_settings SET value = jsonb_set(value, '{live}', '${JSON.stringify(keys)}'::jsonb) WHERE key = 'forms.client'`,
  );
}

/** A call on the card, so the pause's call check passes (as money-acts' test seeds one). */
async function callOn(task: string): Promise<string> {
  return one<string>(
    `INSERT INTO cockpit_csm_calls(source,source_id,task_id,client_name,kind,starts_at,status)
     VALUES('fathom',$1,$2,'Acme Interiors','checkin',now() - interval '1 day','held') RETURNING id::text AS r`,
    [rid(), task],
  );
}

/** An invite issued as 20261102a's issue does it: the row, then the issue dispatcher (which runs the hook). */
async function issue(
  task: string,
  form: "pause_consent" | "exit_survey",
  context: Row,
  origin = form === "pause_consent" ? "pause" : "churn",
  channels = ["portal"],
): Promise<string> {
  const id = rid();
  await ex(`INSERT INTO public.cockpit_form_invites(id, task_id, client_name, form_key, form_version, purpose, context, channels,
      audience, lang, origin, issued_by_role, issued_at, expires_at)
    VALUES ('${id}', '${task}', coalesce((SELECT client_name FROM public.cockpit_billing_accounts WHERE clickup_task_id = '${task}'), 'Test card (canary)'),
      '${form}', public.cockpit_form_client_version('${form}'), '${form}', '${JSON.stringify(context).replace(/'/g, "''")}'::jsonb,
      ARRAY[${channels.map(c => `'${c}'`).join(",")}], 'admin', 'ar', '${origin}', 'the CSM',
      clock_timestamp(), clock_timestamp() + interval '14 days');
    SELECT public.cockpit_form_client_issued('${id}');`);
  return id;
}

/** A client's answer as 20261102a's portal or token submit stores it, then the submit dispatcher. */
async function answer(
  inviteId: string,
  answers: Row,
  opts: {
    source?: "portal" | "public";
    signer?: string | null;
    at?: string;
    shadow?: boolean;
  } = {},
): Promise<string> {
  const source = opts.source ?? "portal";
  const at = opts.at ? `timestamptz '${opts.at}'` : "clock_timestamp()";
  const id = rid();
  await ex(`INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, client_name, mode, state,
      answers, answer_meta, hidden, created_by, submitted_by, submitted_at, invite_id, signer, lang)
    SELECT '${id}', i.form_key, i.form_version, '${source}', '${source === "portal" ? "portal" : "token"}:${rid()}', i.task_id, i.client_name,
      '${opts.shadow ? "shadow" : "live"}', 'submitted', '${JSON.stringify(answers).replace(/'/g, "''")}'::jsonb,
      jsonb_build_object('invite_id', i.id, 'notice_on', ((${at}) AT TIME ZONE 'Asia/Kuwait')::date)
        || CASE WHEN ${opts.shadow ? "true" : "false"} THEN '{"canary":true}'::jsonb ELSE '{}'::jsonb END,
      '{}', 'portal', ${source === "portal" ? "'owner@client.invalid'" : "NULL"}, ${at}, i.id,
      ${opts.signer ? `'${opts.signer}'` : "NULL"}, 'ar'
    FROM public.cockpit_form_invites i WHERE i.id = '${inviteId}';
    SELECT public.cockpit_form_client_submitted('${id}');`);
  return id;
}

const SIGNED = {
  datesWrong: false,
  reason: "travel",
  details: "The owner travels for three weeks.",
  consentTerm: true,
  consentOver14: true,
};
const EXIT = {
  reasons: ["results", "cheaper_provider"],
  ads: 6,
  people: 4,
  comms: 9,
  recommend: 5,
  keptUs: "More calls in the first month.",
  comments: "Thank you for the work.",
};

function pauseEdit(
  task: string,
  restart: string,
  call: string,
  over: Row = {},
) {
  return JSON.stringify({
    taskId: task,
    source: "csm",
    edit: {
      kind: "pause",
      pauseKind: "client_request",
      restart,
      reasonCat: "client_asked",
      reason: "The owner travels for three weeks",
      callId: call,
      requestId: rid(),
      ...over,
    },
  });
}
async function pause(who: string, args: string): Promise<Row> {
  const out = await as<Row>(
    who,
    "SELECT public.cockpit_billing_write('edit', $1::jsonb) AS r",
    [args],
  );
  // The test runs in one transaction, so now() is its start: a real press comes after the answer.
  if (out?.eventId)
    await ex(
      `UPDATE public.cockpit_billing_events SET at = clock_timestamp() WHERE id = ${Number(out.eventId)}`,
    );
  return out;
}

// --- The tests ----------------------------------------------------------------------------------------

describe("20261102b applies on waves 1-2 and 20261102a", () => {
  test("it applies a second time and changes nothing that stops the next apply", async () => {
    await ex(migration(FILE_B));
    expect(
      await one(
        "SELECT count(*)::int AS r FROM cockpit_forms WHERE key = 'pause_consent'",
      ),
    ).toBe(1);
    expect(
      await one(
        "SELECT count(*)::int AS r FROM cockpit_form_versions WHERE (form_key, version) IN (('pause_consent',1),('exit_survey',2))",
      ),
    ).toBe(2);
  });

  test("the drift guard stops on a body changed since the contract read it", async () => {
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_form_prefill(p_form_key text, p_task_id text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
      );
      const r = await refusal(() => ex(migration(FILE_B)));
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_form_prefill(text,text) changed since the waves 3-4 contract read it; stop and re-read it.",
      );
    });
  });

  test("the guard's after values are this file's bodies, and its live values the waves 1-2 bodies", async () => {
    const sql = migration(FILE_B);
    for (const fn of [
      "cockpit_form_responses_guard()",
      "cockpit_billing_write(text,jsonb)",
      "cockpit_billing_writeback_writes(text,text,text,jsonb)",
      "cockpit_billing_writeback_comment(text,text,text,jsonb,text)",
      "cockpit_billing_detail(text,jsonb)",
      "cockpit_billing_canary(text,jsonb)",
      "cockpit_form_notices_in()",
      "cockpit_form_prefill(text,text)",
      "cockpit_csm_churn_read()",
    ]) {
      const row = sql.match(
        new RegExp(
          `\\('${fn.replace(/[()]/g, "\\$&")}', '([0-9a-f]{32})', '([0-9a-f]{32})'\\)`,
        ),
      );
      expect(row, fn).not.toBeNull();
      expect([fn, row?.[2]]).toEqual([fn, await md5Of(fn)]);
    }
  });

  test("the file needs 20261102a and says so", async () => {
    const sql = migration(FILE_B);
    expect(sql).toContain(
      "Apply 20261102a_forms_invites.sql (and waves 1-2) before 20261102b_client_lifecycle.sql.",
    );
    expect(sql.startsWith("--")).toBe(true);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
  });

  test("the registry: pause_consent native and not live; exit_survey stays version 1 on Typeform with version 2 beside it", async () => {
    expect(
      await q(
        "SELECT key, provider, audience, typeform_id, version, seats, client_scoped FROM cockpit_forms WHERE key IN ('pause_consent','exit_survey') ORDER BY key",
      ),
    ).toEqual([
      {
        key: "exit_survey",
        provider: "typeform",
        audience: "client",
        typeform_id: "knIe4eF3",
        version: 1,
        seats: ["csm"],
        client_scoped: true,
      },
      {
        key: "pause_consent",
        provider: "native",
        audience: "client",
        typeform_id: null,
        version: 1,
        seats: ["csm"],
        client_scoped: true,
      },
    ]);
    expect(
      await one(
        "SELECT schema->>'lives' AS r FROM cockpit_forms WHERE key = 'exit_survey'",
      ),
    ).toBe("typeform");
    expect(
      await one("SELECT public.cockpit_form_client_live('pause_consent') AS r"),
    ).toBe(false);
    expect(
      await one(
        "SELECT public.cockpit_form_client_version('exit_survey') AS r",
      ),
    ).toBe(2);
    expect(
      await one(
        "SELECT (value->>'lifecycle')::boolean AS r FROM cockpit_settings WHERE key = 'forms.doors'",
      ),
    ).toBe(true);
    // The registry's effects pass the effect rule and name the gate the schema's reads point to.
    const effects = await one<Row[]>(
      "SELECT effects AS r FROM cockpit_forms WHERE key = 'pause_consent'",
    );
    expect(effects.map(e => e.key)).toEqual([
      "record",
      "consent_notice",
      "consent_gate",
    ]);
  });

  test("both client schemas are v1 as contract 3.1 and 5.5/5.6 write them, and every line passes the client text rule", async () => {
    const pc = await one<Row>(
      "SELECT schema AS r FROM cockpit_form_versions WHERE form_key = 'pause_consent' AND version = 1",
    );
    const ex2 = await one<Row>(
      "SELECT schema AS r FROM cockpit_form_versions WHERE form_key = 'exit_survey' AND version = 2",
    );
    for (const s of [pc, ex2]) {
      expect(s.v).toBe(1);
      expect(s.audience).toBe("admin");
      expect(s.signer).toBe("typed");
      expect(
        await one("SELECT public.cockpit_form_schema_check($1::jsonb) AS r", [
          JSON.stringify(s),
        ]),
      ).toBeNull();
      const keys = new Set<string>();
      for (const f of s.fields as Row[]) {
        expect(f.key).toMatch(/^[a-z][a-zA-Z0-9]{1,30}$/);
        expect(keys.has(f.key)).toBe(false);
        if (f.showIf) expect(keys.has(f.showIf.key)).toBe(true); // only an earlier field
        keys.add(f.key);
        expect([
          "scale",
          "choice",
          "multi",
          "text",
          "longtext",
          "tick",
        ]).toContain(f.type);
        expect(f.label.en.length).toBeGreaterThan(0);
        expect(f.label.ar.length).toBeGreaterThan(0);
        if (f.type === "scale") {
          expect(
            Number.isInteger(f.min) &&
              Number.isInteger(f.max) &&
              f.min < f.max &&
              f.max <= 10,
          ).toBe(true);
          expect(f.lowLabel.ar && f.highLabel.ar).toBeTruthy();
        }
        if (f.type === "choice" || f.type === "multi") {
          expect(f.options.length >= 2 && f.options.length <= 12).toBe(true);
          for (const o of f.options)
            expect(o.value).toMatch(/^[a-z][a-z0-9_]{1,30}$/);
        }
        if (f.type === "longtext")
          expect(f.maxLength).toBeLessThanOrEqual(2000);
        if (f.boldIf) expect(f.type).toBe("tick");
      }
      for (const fields of Object.values(s.reads as Record<string, string[]>))
        for (const k of fields) expect(keys.has(k)).toBe(true);
      for (const lang of ["en", "ar"] as const) {
        expect(s.invite.whatsapp[lang].split("{form_link}").length).toBe(2);
        expect(s.title[lang].length).toBeLessThanOrEqual(200);
        expect(s.intro[lang].length).toBeLessThanOrEqual(600);
      }
      const texts: string[] = [];
      const walk = (x: unknown) => {
        if (x && typeof x === "object") {
          for (const [k, v] of Object.entries(x as Row)) {
            if ((k === "en" || k === "ar") && typeof v === "string")
              texts.push(v);
            else walk(v);
          }
        }
      };
      walk(s);
      expect(texts.length).toBeGreaterThan(20);
      for (const t of texts) {
        expect([
          t,
          await one("SELECT public.cockpit_client_text_ok($1) AS r", [t]),
        ]).toEqual([t, null]);
        // Arabic copy: no em dash, no quote marks, Arabic-Indic digits only (aziz-kuwaiti-voice).
        expect(t).not.toContain("—");
      }
      for (const t of texts.filter(t => /[؀-ۿ]/.test(t)))
        expect(t).not.toMatch(/[0-9"“”]/);
    }
    expect((pc.fields as Row[]).map(f => f.key)).toEqual([
      "datesWrong",
      "datesNote",
      "reason",
      "details",
      "consentTerm",
      "consentOver14",
      "anythingElse",
    ]);
    expect(pc.reads).toEqual({
      consent_gate: ["datesWrong", "consentTerm", "consentOver14"],
    });
    expect(
      (pc.fields as Row[]).find(f => f.key === "consentOver14")?.boldIf,
    ).toEqual({ context: "over14", equals: true });
    expect(
      (ex2.fields as Row[]).map(f => [
        f.key,
        f.type,
        f.min ?? null,
        f.max ?? null,
      ]),
    ).toEqual([
      ["reasons", "multi", null, null],
      ["ads", "scale", 1, 10],
      ["people", "scale", 1, 10],
      ["comms", "scale", 1, 10],
      ["recommend", "scale", 0, 10],
      ["keptUs", "longtext", null, null],
      ["comments", "longtext", null, null],
    ]);
    // The people rating asks about the people who reached them, never a count of leads.
    expect((ex2.fields as Row[])[2].label.en).toBe(
      "The people who reached you through the ads",
    );
  });

  test("privileges: hooks and helpers are the owner's; the browser reads keep their authenticated grant only", async () => {
    const can = (fn: string, role: string) =>
      one<boolean>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS r", [
        role,
        `public.${fn}`,
      ]);
    for (const fn of [
      "cockpit_pause_consent_for(text)",
      "cockpit_form_issue_hook_pause_consent(uuid)",
      "cockpit_form_hook_pause_consent(uuid)",
      "cockpit_form_issue_hook_exit_survey(uuid)",
      "cockpit_form_hook_exit_survey(uuid)",
      "cockpit_exit_survey_departure(text)",
      "cockpit_exit_survey_invite_for(text,bigint)",
      "cockpit_exit_survey_native_ratings(jsonb)",
      "cockpit_kuwait_stamp(timestamptz)",
      "cockpit_billing_writeback_writes(text,text,text,jsonb)",
      "cockpit_billing_writeback_comment(text,text,text,jsonb,text)",
      "cockpit_billing_detail(text,jsonb)",
      "cockpit_billing_canary(text,jsonb)",
      "cockpit_form_responses_guard()",
    ])
      for (const role of ["anon", "authenticated", "service_role"])
        expect([fn, role, await can(fn, role)]).toEqual([fn, role, false]);
    for (const fn of [
      "cockpit_billing_write(text,jsonb)",
      "cockpit_form_notices_in()",
      "cockpit_form_prefill(text,text)",
      "cockpit_csm_churn_read()",
    ]) {
      expect([fn, await can(fn, "authenticated")]).toEqual([fn, true]);
      expect([fn, await can(fn, "anon")]).toEqual([fn, false]);
      expect([fn, await can(fn, "service_role")]).toEqual([fn, false]);
    }
  });
});

describe("billing kinds survey and nps_sent (contract 3.8)", () => {
  test("the CHECK takes both; the trigger queues them from the cockpit and still never queues a system pause", async () => {
    await rolledBack(async () => {
      const ev = (kind: string, source: string, detail: Row) =>
        one<number>(
          `INSERT INTO cockpit_billing_events(clickup_task_id, client_name, kind, detail, source, by_whom)
           VALUES ($1, 'Acme Interiors', $2, $3::jsonb, $4, 'the cockpit') RETURNING id AS r`,
          [A, kind, JSON.stringify(detail), source],
        );
      const item = (id: number) =>
        q<{ payload: Row }>(
          "SELECT payload FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
          [`billing:${id}`],
        );
      const nps = await ev("nps_sent", "system", {
        invite_id: rid(),
        on: "2026-11-03",
        round: 1,
      });
      const npsItem = await item(nps);
      expect(npsItem).toHaveLength(1);
      expect(npsItem[0].payload.writes).toEqual([
        { field: "npsSent", value: "2026-11-03" },
      ]);
      expect(npsItem[0].payload.comment).toBeNull();
      const survey = await ev("survey", "system", {
        form_key: "exit_survey",
        response_id: rid(),
        notice_on: "2026-11-01",
        reasons: ["results"],
        ratings: { ads: 6, people: 4, comms: 9 },
        recommend: 5,
        via: "portal",
      });
      const surveyItem = await item(survey);
      expect(surveyItem).toHaveLength(1);
      expect(surveyItem[0].payload.writes).toEqual([]);
      expect(String(surveyItem[0].payload.comment)).toStartWith(
        "CONTRACT TERMINATION SURVEY (notice received 2026-11-01)",
      );
      // A system pause is not a card write (only a person pauses).
      expect(
        await item(await ev("pause", "system", { on: "2026-11-01" })),
      ).toEqual([]);
      // A person's survey or nps_sent is never queued either: they come from the cockpit itself.
      expect(
        await item(await ev("nps_sent", "csm", { on: "2026-11-03" })),
      ).toEqual([]);
      const bad = await refusal(() => ev("nps", "system", {}));
      expect(bad.message).toContain("cockpit_billing_events_kind_check");
    });
  });

  test("nps_sent writes NPS Survey Sent on the day it went out; survey writes no field and posts 3.8's comment", async () => {
    expect(
      await one(
        "SELECT public.cockpit_billing_writeback_writes('nps_sent', NULL, NULL, '{\"on\":\"2026-11-03\"}') AS r",
      ),
    ).toEqual([{ field: "npsSent", value: "2026-11-03" }]);
    expect(
      await one(
        "SELECT public.cockpit_billing_writeback_writes('nps_sent', NULL, NULL, '{}') AS r",
      ),
    ).toEqual([]);
    expect(
      await one(
        "SELECT public.cockpit_billing_writeback_writes('survey', NULL, NULL, '{\"recommend\":5}') AS r",
      ),
    ).toEqual([]);
    expect(
      await one(
        "SELECT public.cockpit_billing_writeback_comment('nps_sent', NULL, NULL, '{\"on\":\"2026-11-03\"}', 'Acme') AS r",
      ),
    ).toBeNull();
    const detail = await one<Row>(
      "SELECT public.cockpit_billing_detail('survey', $1::jsonb) AS r",
      [
        JSON.stringify({
          responseId: "11111111-1111-4111-8111-111111111111",
          inviteId: "22222222-2222-4222-8222-222222222222",
          noticeOn: "2026-11-01",
          seatRole: "system",
          reasons: ["results", "cheaper_provider", "BAD value"],
          ratings: { ads: 6, people: 4, comms: 11 },
          recommend: 5,
          keptUs: `  More   calls ${"x".repeat(400)}`,
          comments: "owner@client.invalid wrote this",
          via: "link",
        }),
      ],
    );
    expect(detail).toMatchObject({
      form_key: "exit_survey",
      response_id: "11111111-1111-4111-8111-111111111111",
      invite_id: "22222222-2222-4222-8222-222222222222",
      notice_on: "2026-11-01",
      reasons: ["results", "cheaper_provider"],
      ratings: { ads: 6, people: 4 },
      recommend: 5,
      via: "link",
    });
    expect(String(detail.kept_us).length).toBe(300);
    expect(String(detail.kept_us)).toStartWith("More calls x");
    const comment = await one<string>(
      "SELECT public.cockpit_billing_writeback_comment('survey', NULL, NULL, $1::jsonb, 'Acme') AS r",
      [
        JSON.stringify({
          ...detail,
          comments: "Thank you for the work.",
          seat_role: "system",
        }),
      ],
    );
    expect(comment.split("\n")).toEqual([
      "CONTRACT TERMINATION SURVEY (notice received 2026-11-01)",
      "Why: The results, A cheaper provider",
      "Ads 6/10 · The people who reached them 4/10 · Communication not rated",
      "Would recommend: 5/10",
      `What would have kept them: ${detail.kept_us}`,
      "Comments: Thank you for the work.",
      "Filled: by link",
      "Confirm the churn or answer the notice in the cockpit.",
    ]);
    const bare = await one<string>(
      'SELECT public.cockpit_billing_writeback_comment(\'survey\', NULL, NULL, \'{"notice_on":"2026-11-01","via":"portal"}\', \'Acme\') AS r',
    );
    expect(bare).toContain(
      "What would have kept them: not said\nComments: none\nFilled: in the portal",
    );
    expect(
      (
        await refusal(() =>
          q("SELECT public.cockpit_billing_detail('nps_sent', '{}')"),
        )
      ).message,
    ).toBe("An NPS sent event needs the day it went out (YYYY-MM-DD).");
    expect(
      (
        await refusal(() =>
          q(
            "SELECT public.cockpit_billing_detail('nps_sent', '{\"on\":\"3 Nov\"}')",
          ),
        )
      ).message,
    ).toBe("That is not a day (YYYY-MM-DD): 3 Nov.");
  });

  test("the canary takes survey and nps_sent on the test card only, from the cockpit itself", async () => {
    await rolledBack(async () => {
      const nps = await one<number>(
        'SELECT public.cockpit_billing_canary(\'nps_sent\', \'{"system":true,"on":"2026-11-03","round":1}\') AS r',
      );
      const row = await q<Row>(
        "SELECT clickup_task_id, kind, source, by_whom, detail FROM cockpit_billing_events WHERE id = $1",
        [nps],
      );
      expect(row[0]).toMatchObject({
        clickup_task_id: TEST_CARD,
        kind: "nps_sent",
        source: "system",
        by_whom: "canary",
      });
      expect(row[0].detail).toMatchObject({ on: "2026-11-03", round: 1 });
      expect(
        (
          await q<{ payload: Row }>(
            "SELECT payload FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
            [`billing:${nps}`],
          )
        )[0].payload.writes,
      ).toEqual([{ field: "npsSent", value: "2026-11-03" }]);
      const survey = await one<number>(
        "SELECT public.cockpit_billing_canary('survey', $1::jsonb) AS r",
        [
          JSON.stringify({
            system: true,
            noticeOn: "2026-11-01",
            reasons: ["results"],
            ratings: { ads: 7, people: 7, comms: 7 },
            recommend: 7,
            via: "link",
          }),
        ],
      );
      const item = await q<{ payload: Row }>(
        "SELECT payload FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
        [`billing:${survey}`],
      );
      expect(item[0].payload.writes).toEqual([]);
      expect(String(item[0].payload.comment)).toContain(
        "Ads 7/10 · The people who reached them 7/10 · Communication 7/10",
      );
      expect(String(item[0].payload.comment)).not.toContain("By:");
      for (const [args, message] of [
        [
          { system: true, on: "2026-11-03", taskId: A },
          "The canary writes only the test card 86eywg1cq.",
        ],
        [
          { on: "2026-11-03" },
          "A survey or NPS sent event comes from the cockpit itself: send system true.",
        ],
        [
          { system: true },
          "An NPS sent canary needs the day in on (YYYY-MM-DD).",
        ],
      ] as const)
        expect(
          (
            await refusal(() =>
              q("SELECT public.cockpit_billing_canary('nps_sent', $1::jsonb)", [
                JSON.stringify(args),
              ]),
            )
          ).message,
        ).toBe(message);
      expect(
        (
          await refusal(() =>
            q(
              "SELECT public.cockpit_billing_canary('pause', '{\"system\":true}')",
            ),
          )
        ).message,
      ).toBe(
        "Only an extension clear, a late event, a survey or NPS sent comes from the cockpit itself.",
      );
      expect(
        (
          await refusal(() =>
            q("SELECT public.cockpit_billing_canary('ltv', '{}')"),
          )
        ).message,
      ).toBe(
        "The canary takes churn, extension, pause, resume, mrr, late, date, survey or nps_sent.",
      );
    });
  });
});

describe("pause consent and Confirm pause (contract 4.3)", () => {
  test("while pause_consent is not live, W12's two ticks still pause, and so does the billing sheet live before the staff forms", async () => {
    await rolledBack(async () => {
      const today = await kuwaitToday();
      const call = await callOn(A);
      expect(
        (
          await refusal(() =>
            pause(CSM_A, pauseEdit(A, dayFrom(today, 20), call)),
          )
        ).message,
      ).toBe("Tick both consents the client gave on the call.");
      const out = await pause(
        CSM_A,
        pauseEdit(A, dayFrom(today, 20), call, {
          consentTerm: true,
          consentOver14: true,
        }),
      );
      expect(out.client_status).toBe("Paused");
      expect(
        await one(
          "SELECT detail->'consent' AS r FROM cockpit_billing_events WHERE id = $1",
          [out.eventId],
        ),
      ).toEqual({
        kind: "call",
        call_id: call,
        term_runs: true,
        over_14_ends: true,
      });
      // The older sheet: {kind:'pause', reason} under edit, no requestId.
      await ex(
        `UPDATE cockpit_billing_accounts SET client_status = 'Active', paused_on = NULL WHERE clickup_task_id = '${B}'`,
      );
      const old = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_billing_write('edit', $1::jsonb) AS r",
        [
          JSON.stringify({
            taskId: B,
            source: "csm",
            edit: { kind: "pause", reason: "Client asked for a month off" },
          }),
        ],
      );
      expect(old).toMatchObject({ client_status: "Paused", paused_on: today });
    });
  });

  test("with pause_consent live: refused without the consent, on an old one, on wrong dates, on another restart; accepted with the signed one", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const today = await kuwaitToday();
      const restart = dayFrom(today, 20);
      const call = await callOn(A);
      const send = (over: Row = {}) =>
        pause(CSM_A, pauseEdit(A, restart, call, over));
      // Nothing sent yet: the ticks no longer count.
      expect(
        (await refusal(() => send({ consentTerm: true, consentOver14: true })))
          .message,
      ).toBe(
        "Send the pause consent from this sheet, then confirm once the client signs.",
      );
      // Sent, not answered.
      const i1 = await issue(A, "pause_consent", {
        restart,
        reasonCat: "client_asked",
        callId: call,
      });
      expect(
        await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [A]),
      ).toMatchObject({ state: "sent", inviteId: i1 });
      expect((await refusal(() => send())).message).toBe(
        "Send the pause consent from this sheet, then confirm once the client signs.",
      );
      // Signed 15 days ago: too old.
      const old = await answer(i1, SIGNED, {
        at: new Date(Date.now() - 15 * 86_400_000).toISOString(),
      });
      expect(
        (
          await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [
            A,
          ])
        ).state,
      ).toBe("expired");
      expect(
        (await refusal(() => send({ consentResponseId: old }))).message,
      ).toBe(
        "The client has not signed the pause consent in the last 14 days. Send it again.",
      );
      // A new consent: the client says the dates are wrong.
      const i2 = await issue(A, "pause_consent", {
        restart,
        reasonCat: "client_asked",
        callId: call,
      });
      const wrong = await answer(i2, {
        datesWrong: true,
        datesNote: "We restart on the 1st.",
        reason: "travel",
        details: "Away.",
      });
      const wrongState = await one<Row>(
        "SELECT public.cockpit_pause_consent_for($1) AS r",
        [A],
      );
      expect(wrongState).toMatchObject({
        state: "dates_wrong",
        responseId: wrong,
        datesNote: "We restart on the 1st.",
      });
      expect(
        (await refusal(() => send({ consentResponseId: wrong }))).message,
      ).toBe(
        "The client says these dates are wrong. Change the restart and send a new consent.",
      );
      // A third, signed by link with a typed name.
      const i3 = await issue(A, "pause_consent", {
        restart,
        reasonCat: "client_asked",
        callId: call,
      });
      const signed = await answer(i3, SIGNED, {
        source: "public",
        signer: "Noor Al-Test",
      });
      const state = await one<Row>(
        "SELECT public.cockpit_pause_consent_for($1) AS r",
        [A],
      );
      expect(state).toMatchObject({
        state: "signed",
        inviteId: i3,
        responseId: signed,
        via: "link",
        signer: "Noor Al-Test",
        start: today,
        restart,
        over14: true,
      });
      expect(String(state.signedAt)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/,
      );
      expect((await refusal(() => send())).message).toBe(
        "Send the pause consent from this sheet, then confirm once the client signs.",
      );
      expect(
        (await refusal(() => send({ consentResponseId: wrong }))).message,
      ).toBe(
        "Send the pause consent from this sheet, then confirm once the client signs.",
      );
      const other = dayFrom(today, 21);
      const otherRefusal = await refusal(() =>
        pause(CSM_A, pauseEdit(A, other, call, { consentResponseId: signed })),
      );
      expect(otherRefusal.message).toMatch(
        /^The client signed a restart of .+\. Use that date or send a new consent\.$/,
      );
      // The signed one, the same restart: paused, and the consent says signed.
      const out = await send({ consentResponseId: signed.toUpperCase() });
      expect(out.client_status).toBe("Paused");
      const ev = await q<{ detail: Row }>(
        "SELECT detail FROM cockpit_billing_events WHERE id = $1",
        [out.eventId],
      );
      expect(ev[0].detail.consent).toEqual({
        kind: "signed",
        response_id: signed,
        signed_at: state.signedAt,
        via: "link",
        call_id: call,
        signed_start: today,
        over14: true,
      });
      const resp = await one<Row>(
        "SELECT answers AS r FROM cockpit_form_responses WHERE id = $1::uuid",
        [out.responseId],
      );
      expect(resp.consentResponseId).toBe(signed);
      expect(resp.consentTerm).toBeUndefined();
      const item = await q<{ payload: Row }>(
        "SELECT payload FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
        [`billing:${out.eventId}`],
      );
      const comment = String(item[0].payload.comment);
      expect(comment).toContain(
        `Consent: signed by link ${String(state.signedAt).slice(0, 10)}`,
      );
      expect(comment).not.toContain("Noor");
      expect(comment).not.toContain("@");
      // Used: the consent no longer allows a second pause.
      expect(
        (
          await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [
            A,
          ])
        ).state,
      ).toBe("none");
    });
  });

  test("a consent signed for a later start waits for that day: confirming early would pause longer than signed", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const today = await kuwaitToday();
      const start = dayFrom(today, 5);
      const restart = dayFrom(today, 15);
      const call = await callOn(A);
      const i = await issue(A, "pause_consent", {
        start,
        restart,
        reasonCat: "client_asked",
        callId: call,
      });
      expect(
        await one<Row>(
          "SELECT context->'over14' AS r FROM cockpit_form_invites WHERE id = $1::uuid",
          [i],
        ),
      ).toBe(false);
      const signed = await answer(i, SIGNED);
      const early = await refusal(() =>
        pause(
          CSM_A,
          pauseEdit(A, restart, call, { consentResponseId: signed }),
        ),
      );
      expect(early.message).toMatch(
        /^The client signed a pause from .+\. Confirm it on that day or send a new consent\.$/,
      );
      expect(
        await one(
          "SELECT client_status AS r FROM cockpit_billing_accounts WHERE clickup_task_id = $1",
          [A],
        ),
      ).not.toBe("Paused");
      // Five days on (the invite's days moved back five, as the clock cannot be): it goes through, and the record
      // keeps the signed start and the 14-day line worked out from the days the pause really runs (10).
      const later = dayFrom(today, 10);
      await q(
        "UPDATE cockpit_form_invites SET context = context || jsonb_build_object('start', $2::text, 'restart', $3::text) WHERE id = $1::uuid",
        [i, today, later],
      );
      const out = await pause(
        CSM_A,
        pauseEdit(A, later, call, { consentResponseId: signed }),
      );
      expect(out.client_status).toBe("Paused");
      const ev = await q<{ detail: Row }>(
        "SELECT detail FROM cockpit_billing_events WHERE id = $1",
        [out.eventId],
      );
      expect(ev[0].detail.consent).toMatchObject({
        signed_start: today,
        over14: false,
      });
    });
  });

  test("with pause_consent live the older sheet's {kind:'pause', reason} is refused: no pause without the consent", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const r = await refusal(() =>
        as<Row>(
          CSM_B,
          "SELECT public.cockpit_billing_write('edit', $1::jsonb) AS r",
          [
            JSON.stringify({
              taskId: B,
              source: "csm",
              edit: { kind: "pause", reason: "Client asked for a month off" },
            }),
          ],
        ),
      );
      expect(r.message).toBe(
        "That form is out of date. Reload the page and send it again.",
      );
      expect(
        await one(
          "SELECT client_status AS r FROM cockpit_billing_accounts WHERE clickup_task_id = $1",
          [B],
        ),
      ).not.toBe("Paused");
    });
  });

  test("a portal signature reads 'the client admin' and the comment says in the portal", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const today = await kuwaitToday();
      const restart = dayFrom(today, 10);
      const call = await callOn(A);
      const i = await issue(A, "pause_consent", { restart, callId: call });
      const signed = await answer(i, SIGNED);
      expect(
        await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [A]),
      ).toMatchObject({
        state: "signed",
        via: "portal",
        signer: "the client admin",
        over14: false,
      });
      const out = await pause(
        CSM_A,
        pauseEdit(A, restart, call, { consentResponseId: signed }),
      );
      const item = await q<{ payload: Row }>(
        "SELECT payload FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
        [`billing:${out.eventId}`],
      );
      expect(String(item[0].payload.comment)).toContain(
        `Consent: signed in the portal ${today}`,
      );
    });
  });

  test("a non-payment pause needs no consent, even with the form live", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const out = await pause(
        CSM_A,
        JSON.stringify({
          taskId: A,
          source: "csm",
          edit: {
            kind: "pause",
            pauseKind: "non_payment",
            reasonCat: "not_paying",
            reason: "Two invoices unpaid",
            requestId: rid(),
          },
        }),
      );
      expect(out.client_status).toBe("Paused");
      expect(
        await one(
          "SELECT detail->'consent' AS r FROM cockpit_billing_events WHERE id = $1",
          [out.eventId],
        ),
      ).toBeNull();
    });
  });

  test("the issue hook: start today to today + 14, restart after the start, over14 worked out; a Paused card refused", async () => {
    await rolledBack(async () => {
      const today = await kuwaitToday();
      const ctx = async (id: string) =>
        one<Row>(
          "SELECT context AS r FROM cockpit_form_invites WHERE id = $1",
          [id],
        );
      const at14 = await issue(A, "pause_consent", {
        start: dayFrom(today, 14),
        restart: dayFrom(today, 30),
      });
      expect(await ctx(at14)).toMatchObject({
        start: dayFrom(today, 14),
        restart: dayFrom(today, 30),
        over14: true,
      });
      await ex(
        `UPDATE cockpit_form_invites SET state = 'withdrawn', closed_at = now() WHERE id = '${at14}'`,
      );
      for (const [context, message] of [
        [
          { start: dayFrom(today, 15), restart: dayFrom(today, 30) },
          "The pause starts today or within 14 days.",
        ],
        [
          { start: dayFrom(today, -1), restart: dayFrom(today, 30) },
          "The pause starts today or within 14 days.",
        ],
        [
          { start: "next week", restart: dayFrom(today, 30) },
          "The pause starts today or within 14 days.",
        ],
        [{ restart: today }, "Pick the restart day, after the start."],
        [
          { start: dayFrom(today, 3), restart: dayFrom(today, 3) },
          "Pick the restart day, after the start.",
        ],
        [{}, "Pick the restart day, after the start."],
      ] as const) {
        const r = await refusal(() => issue(A, "pause_consent", context));
        expect([context, r.code, r.message]).toEqual([
          context,
          "22023",
          message,
        ]);
      }
      const short = await issue(A, "pause_consent", {
        restart: dayFrom(today, 14),
      });
      expect(await ctx(short)).toMatchObject({
        start: today,
        restart: dayFrom(today, 14),
        over14: false,
      });
      await ex(
        `UPDATE cockpit_form_invites SET state = 'withdrawn', closed_at = now() WHERE id = '${short}'`,
      );
      await ex(
        `UPDATE cockpit_billing_accounts SET client_status = 'Paused' WHERE clickup_task_id = '${A}'`,
      );
      expect(
        (
          await refusal(() =>
            issue(A, "pause_consent", { restart: dayFrom(today, 20) }),
          )
        ).message,
      ).toBe("This client is already paused. Resume them first.");
    });
  });

  test("the submit hook queues pause.consent once, with names and dates only, dates_wrong as its variant", async () => {
    await rolledBack(async () => {
      const today = await kuwaitToday();
      const i = await issue(A, "pause_consent", {
        restart: dayFrom(today, 20),
      });
      const r = await answer(
        i,
        { ...SIGNED, anythingElse: "Call me on +965 5000 0000" },
        { source: "public", signer: "Noor Al-Test" },
      );
      await ex(`SELECT public.cockpit_form_hook_pause_consent('${r}')`); // a re-run adds nothing
      const notes = await q<Row>(
        "SELECT kind, dedupe_key, task_id, client_name, state, facts FROM cockpit_slack_notices WHERE dedupe_key = $1",
        [`consent:${r}`],
      );
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        kind: "pause.consent",
        task_id: A,
        client_name: "Acme Interiors",
        state: "queued",
      });
      expect(notes[0].facts).toMatchObject({
        variant: "signed",
        datesWrong: false,
        via: "link",
        restart: dayFrom(today, 20),
        start: today,
      });
      const text = JSON.stringify(notes[0].facts);
      for (const secret of ["Noor", "+965", "@", "three weeks"])
        expect(text).not.toContain(secret);
      await ex(
        `UPDATE cockpit_form_invites SET state = 'withdrawn', closed_at = now() WHERE task_id = '${A}' AND state = 'open'`,
      );
      const i2 = await issue(A, "pause_consent", {
        restart: dayFrom(today, 20),
      });
      const r2 = await answer(i2, {
        datesWrong: true,
        datesNote: "Later",
        reason: "travel",
        details: "Away",
      });
      expect(
        await one<Row>(
          "SELECT facts AS r FROM cockpit_slack_notices WHERE dedupe_key = $1",
          [`consent:${r2}`],
        ),
      ).toMatchObject({
        variant: "dates_wrong",
        datesWrong: true,
        via: "portal",
      });
    });
  });

  test("Notices in lists a signed consent and drops it after the pause; a consent with wrong dates is listed too", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const today = await kuwaitToday();
      const restart = dayFrom(today, 20);
      const call = await callOn(A);
      const i = await issue(A, "pause_consent", { restart, callId: call });
      const signed = await answer(i, SIGNED, {
        source: "public",
        signer: "Noor Al-Test",
      });
      const rows = await as<Row[]>(
        CSM_A,
        "SELECT public.cockpit_form_notices_in() AS r",
      );
      const row = rows.find(r => r.responseId === signed);
      expect(row).toMatchObject({
        kind: "pause_consent",
        taskId: A,
        clientName: "Acme Interiors",
        matched: true,
        unverified: false,
        native: true,
        inviteId: i,
        via: "link",
        datesWrong: false,
        signer: "Noor Al-Test",
        start: today,
        restart,
      });
      // Another client's CSM never sees it.
      expect(
        (
          await as<Row[]>(CSM_B, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(r => r.responseId === signed),
      ).toBe(false);
      await pause(
        CSM_A,
        pauseEdit(A, restart, call, { consentResponseId: signed }),
      );
      expect(
        (
          await as<Row[]>(CSM_A, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(r => r.responseId === signed),
      ).toBe(false);
      // Beta: dates marked wrong, listed until a new consent goes out.
      const ib = await issue(B, "pause_consent", { restart });
      const wrong = await answer(ib, {
        datesWrong: true,
        datesNote: "Later",
        reason: "season",
        details: "Ramadan",
      });
      expect(
        (
          await as<Row[]>(CSM_B, "SELECT public.cockpit_form_notices_in() AS r")
        ).find(r => r.responseId === wrong),
      ).toMatchObject({
        kind: "pause_consent",
        datesWrong: true,
        via: "portal",
        signer: "the client admin",
      });
      await issue(B, "pause_consent", { restart: dayFrom(today, 25) });
      expect(
        (
          await as<Row[]>(CSM_B, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(r => r.responseId === wrong),
      ).toBe(false);
    });
  });

  test("the pause prefill carries the consent and whether the form is live", async () => {
    await rolledBack(async () => {
      const off = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_prefill('pause', $1) AS r",
        [A],
      );
      expect(off.consent).toMatchObject({ state: "none", live: false });
      await goLive(["pause_consent"]);
      const today = await kuwaitToday();
      const i = await issue(A, "pause_consent", { restart: dayFrom(today, 9) });
      const r = await answer(i, SIGNED);
      const on = await as<Row>(
        CSM_A,
        "SELECT public.cockpit_form_prefill('pause', $1) AS r",
        [A],
      );
      expect(on.consent).toMatchObject({
        state: "signed",
        live: true,
        responseId: r,
        restart: dayFrom(today, 9),
        signer: "the client admin",
      });
      expect(
        (
          await as<Row>(
            CSM_A,
            "SELECT public.cockpit_form_prefill('mrr', $1) AS r",
            [A],
          )
        ).consent,
      ).toBeNull();
    });
  });

  test("canary consents count only for the test card, and their notice is muted", async () => {
    await rolledBack(async () => {
      const today = await kuwaitToday();
      const i = await issue(
        TEST_CARD,
        "pause_consent",
        { restart: dayFrom(today, 7), reasonCat: "client_asked" },
        "canary",
        ["copy"],
      );
      const r = await answer(i, SIGNED, {
        source: "public",
        signer: "Mahara test",
        shadow: true,
      });
      expect(
        await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [
          TEST_CARD,
        ]),
      ).toMatchObject({
        state: "signed",
        responseId: r,
        signer: "Mahara test",
      });
      expect(
        await q(
          "SELECT state, error FROM cockpit_slack_notices WHERE dedupe_key = $1",
          [`consent:${r}`],
        ),
      ).toEqual([
        { state: "muted", error: "Canary on the test card: not posted" },
      ]);
      // A canary invite on a real card (never made by the canary door) does not count for that card.
      await ex(`INSERT INTO cockpit_form_invites(id, task_id, client_name, form_key, form_version, purpose, context, channels, audience, origin, issued_by_role, expires_at)
        VALUES ('${rid()}', '${A}', 'Acme Interiors', 'pause_consent', 1, 'pause_consent', '{"restart":"${dayFrom(today, 7)}"}', '{copy}', 'admin', 'canary', 'the cockpit', now() + interval '14 days')`);
      expect(
        (
          await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [
            A,
          ])
        ).state,
      ).toBe("none");
    });
  });

  test("rollback (D-B1): the saved billing write body and pause_consent back on Typeform take a client-request pause with the two ticks", async () => {
    await rolledBack(async () => {
      const today = await kuwaitToday();
      const call = await callOn(A);
      await ex(OLD_BILLING_WRITE);
      expect(await md5Of("cockpit_billing_write(text,jsonb)")).toBe(
        "8bdd972146ee2dfc0a5e1c6c0c5c47e4",
      );
      // With the registry row still native, the old body refuses every client-request pause (20261101p).
      expect(
        (
          await refusal(() =>
            pause(
              CSM_A,
              pauseEdit(A, dayFrom(today, 20), call, {
                consentTerm: true,
                consentOver14: true,
              }),
            ),
          )
        ).message,
      ).toBe(
        "The client has not signed the pause consent in the last 14 days. Send it from the client page first.",
      );
      // D-B1's registry step, in the same transaction as the restore.
      await ex(`SELECT set_config('cockpit.audit_actor', 'deploy D-B1 rollback', true);
        UPDATE public.cockpit_forms SET provider = 'typeform', typeform_id = 'CTUjv6l3', updated_by = 'deploy D-B1 rollback', updated_at = now()
         WHERE key = 'pause_consent';
        UPDATE public.cockpit_settings SET value = value || '{"lifecycle":false}' WHERE key = 'forms.doors';`);
      const out = await pause(
        CSM_A,
        pauseEdit(A, dayFrom(today, 20), call, {
          consentTerm: true,
          consentOver14: true,
        }),
      );
      expect(out.client_status).toBe("Paused");
      expect(
        await one(
          "SELECT detail->'consent'->>'kind' AS r FROM cockpit_billing_events WHERE id = $1",
          [out.eventId],
        ),
      ).toBe("call");
      // The trigger from its saved definition (20261101m): a system survey is no card write again.
      await ex(
        cut(
          migration("20261101m_billing_rails.sql"),
          /DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback[\s\S]*?EXECUTE FUNCTION public\.cockpit_billing_writeback_enqueue\(\);/,
          "the W12 trigger",
        ),
      );
      const survey = await one<number>(
        `INSERT INTO cockpit_billing_events(clickup_task_id, client_name, kind, detail, source, by_whom)
         VALUES ($1, 'Acme Interiors', 'survey', '{"notice_on":"2026-11-01"}', 'system', 'the cockpit') RETURNING id AS r`,
        [A],
      );
      expect(
        await q(
          "SELECT 1 FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
          [`billing:${survey}`],
        ),
      ).toEqual([]);
    });
  });
});

describe("the exit survey and C4b (contract 4.4)", () => {
  /** A logged departure for Beta, as the Client is leaving sheet logs one before the confirm. */
  const depart = (task = B, client = "Beta Build") =>
    one<number>(
      `INSERT INTO cockpit_churn_departures(client, clickup_task_id, left_on, reason, source, created_by)
       VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Kuwait')::date - 1, 'Cancelled', 'cockpit', 'csm.b@tests.invalid') RETURNING id AS r`,
      [client, task],
    );

  test("the issue hook marks the open departure's survey sent and names it on the invite", async () => {
    await rolledBack(async () => {
      const dep = await depart();
      const i = await issue(B, "exit_survey", {});
      expect(
        await one(
          "SELECT survey_state AS r FROM cockpit_churn_departures WHERE id = $1",
          [dep],
        ),
      ).toBe("sent");
      expect(
        await one(
          "SELECT context->>'departureId' AS r FROM cockpit_form_invites WHERE id = $1",
          [i],
        ),
      ).toBe(String(dep));
      expect(
        await one(
          "SELECT form_version AS r FROM cockpit_form_invites WHERE id = $1",
          [i],
        ),
      ).toBe(2);
      // A departure after which the client resumed is not open: nothing changes on it.
      await ex(`UPDATE cockpit_form_invites SET state = 'withdrawn', closed_at = now() WHERE id = '${i}';
        UPDATE cockpit_churn_departures SET survey_state = 'not_sent' WHERE id = ${dep};
        INSERT INTO cockpit_billing_events(clickup_task_id, client_name, kind, source, by_whom, at)
        VALUES ('${B}', 'Beta Build', 'resume', 'csm', 'csm.b@tests.invalid', now());`);
      const i2 = await issue(B, "exit_survey", {});
      expect(
        await one(
          "SELECT survey_state AS r FROM cockpit_churn_departures WHERE id = $1",
          [dep],
        ),
      ).toBe("not_sent");
      expect(
        await one(
          "SELECT context ? 'departureId' AS r FROM cockpit_form_invites WHERE id = $1",
          [i2],
        ),
      ).toBe(false);
    });
  });

  test("the submit hook: both termination notices once each, one survey event with 3.8's comment, the departure filled", async () => {
    await rolledBack(async () => {
      const dep = await depart();
      const i = await issue(B, "exit_survey", {});
      const r = await answer(i, EXIT, {
        source: "public",
        signer: "Fahad Test",
      });
      await ex(
        `SELECT public.cockpit_form_hook_exit_survey('${r}'); SELECT public.cockpit_form_client_submitted('${r}');`,
      );
      const notes = await q<Row>(
        "SELECT kind, dedupe_key, state, client_name, facts FROM cockpit_slack_notices WHERE dedupe_key IN ($1, $2) ORDER BY kind",
        [`termination:${r}`, `termination-sub:${r}`],
      );
      expect(notes.map(n => [n.kind, n.state, n.client_name])).toEqual([
        ["termination.notice", "queued", "Beta Build"],
        ["termination.submitted", "queued", "Beta Build"],
      ]);
      expect(notes[0].facts).toMatchObject({
        responseId: r,
        matched: true,
        client: "Beta Build",
        via: "link",
      });
      for (const word of ["Fahad", "first month", "Thank you"])
        expect(JSON.stringify(notes[0].facts)).not.toContain(word);
      const events = await q<Row>(
        "SELECT id, kind, source, by_whom, to_value, detail FROM cockpit_billing_events WHERE kind = 'survey' AND clickup_task_id = $1",
        [B],
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source: "system",
        by_whom: "the cockpit",
        to_value: null,
      });
      expect(events[0].detail).toMatchObject({
        form_key: "exit_survey",
        response_id: r,
        invite_id: i,
        reasons: ["results", "cheaper_provider"],
        ratings: { ads: 6, people: 4, comms: 9 },
        recommend: 5,
        kept_us: EXIT.keptUs,
        comments: EXIT.comments,
        via: "link",
      });
      const item = await q<{ payload: Row }>(
        "SELECT payload FROM cockpit_clickup_writeback_queue WHERE dedupe_key = $1",
        [`billing:${events[0].id}`],
      );
      expect(item[0].payload.writes).toEqual([]);
      const comment = String(item[0].payload.comment);
      expect(comment.split("\n").slice(1, 4)).toEqual([
        "Why: The results, A cheaper provider",
        "Ads 6/10 · The people who reached them 4/10 · Communication 9/10",
        "Would recommend: 5/10",
      ]);
      expect(comment).not.toContain("Fahad");
      expect(comment).not.toContain("@");
      expect(
        await q(
          "SELECT survey_state, survey_response_id::text AS rid FROM cockpit_churn_departures WHERE id = $1",
          [dep],
        ),
      ).toEqual([{ survey_state: "filled", rid: r }]);
      // No card field anywhere: the account is untouched.
      expect(
        await one(
          "SELECT client_status AS r FROM cockpit_billing_accounts WHERE clickup_task_id = $1",
          [B],
        ),
      ).toBe("Active");
    });
  });

  test("a canary exit survey mutes both notices, marks its event canary and touches no departure", async () => {
    await rolledBack(async () => {
      const i = await issue(TEST_CARD, "exit_survey", {}, "canary", ["copy"]);
      const r = await answer(i, EXIT, {
        source: "public",
        signer: "Mahara test",
        shadow: true,
      });
      expect(
        await q(
          "SELECT kind, state FROM cockpit_slack_notices WHERE dedupe_key IN ($1, $2) ORDER BY kind",
          [`termination:${r}`, `termination-sub:${r}`],
        ),
      ).toEqual([
        { kind: "termination.notice", state: "muted" },
        { kind: "termination.submitted", state: "muted" },
      ]);
      expect(
        await q(
          "SELECT by_whom, client_name FROM cockpit_billing_events WHERE kind = 'survey' AND clickup_task_id = $1",
          [TEST_CARD],
        ),
      ).toEqual([{ by_whom: "canary", client_name: "Test card (canary)" }]);
      // Shadow answers never reach Notices in.
      expect(
        (
          await as<Row[]>(CEO, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(x => x.responseId === r),
      ).toBe(false);
    });
  });

  test("Notices in lists a native survey (card by its invite); Not leaving answers it once, a second answer is refused", async () => {
    await rolledBack(async () => {
      await depart();
      const i = await issue(B, "exit_survey", {});
      const r = await answer(i, EXIT);
      const row = (
        await as<Row[]>(CSM_B, "SELECT public.cockpit_form_notices_in() AS r")
      ).find(x => x.responseId === r);
      expect(row).toMatchObject({
        kind: "termination",
        taskId: B,
        matched: true,
        unverified: false,
        native: true,
        inviteId: i,
        via: "portal",
      });
      expect(typeof row?.departureId).toBe("number");
      const first = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_form_notice_answer($1::uuid, 'staying', 'They renewed on the call') AS r",
        [r],
      );
      expect(first.answer).toBe("staying");
      const again = await refusal(() =>
        as(
          CSM_B,
          "SELECT public.cockpit_form_notice_answer($1::uuid, 'staying', 'Again') AS r",
          [r],
        ),
      );
      expect(again.message).toMatch(/^This notice was answered on /);
      // Anything else on the answer stays fixed.
      expect(
        (
          await refusal(() =>
            q(
              "UPDATE cockpit_form_responses SET answers = '{}' WHERE id = $1::uuid",
              [r],
            ),
          )
        ).message,
      ).toBe("Sent notes keep their answers");
      expect(
        (
          await as<Row[]>(CSM_B, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(x => x.responseId === r),
      ).toBe(false);
      // The carve-out is only the one answer, only under its setting.
      const r2 = await answer(await issue(A, "exit_survey", {}), EXIT);
      expect(
        (
          await refusal(() =>
            q(
              `UPDATE cockpit_form_responses SET answer_meta = answer_meta || '{"answered":{"by":"x"}}' WHERE id = $1::uuid`,
              [r2],
            ),
          )
        ).message,
      ).toBe("Sent notes keep their answers");
    });
  });

  test("a native survey whose card is not its invite's is not listed", async () => {
    await rolledBack(async () => {
      const i = await issue(B, "exit_survey", {});
      const r = await answer(i, EXIT);
      await ex(`ALTER TABLE cockpit_form_responses DISABLE TRIGGER cockpit_form_responses_guard;
        UPDATE cockpit_form_responses SET task_id = '${A}' WHERE id = '${r}';
        ALTER TABLE cockpit_form_responses ENABLE TRIGGER cockpit_form_responses_guard;`);
      expect(
        (
          await as<Row[]>(CEO, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(x => x.responseId === r),
      ).toBe(false);
    });
  });

  test("the churn tracker gives each departure its surveyInvite and a native survey its ratings", async () => {
    await rolledBack(async () => {
      const dep = await depart();
      const before = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_csm_churn_read() AS r",
      );
      expect(
        before.deps.find((d: Row) => d.id === dep).surveyInvite,
      ).toBeNull();
      const i = await issue(B, "exit_survey", {}, "churn", [
        "portal",
        "whatsapp",
      ]);
      const sent = (
        await as<Row>(CSM_B, "SELECT public.cockpit_csm_churn_read() AS r")
      ).deps.find((d: Row) => d.id === dep);
      expect(sent.survey_state).toBe("sent");
      expect(sent.surveyInvite).toMatchObject({
        inviteId: i,
        state: "open",
        channels: ["portal", "whatsapp"],
        answeredAt: null,
      });
      const r = await answer(i, EXIT);
      const read = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_csm_churn_read() AS r",
      );
      const filled = read.deps.find((d: Row) => d.id === dep);
      expect(filled.surveyInvite).toMatchObject({
        inviteId: i,
        state: "answered",
        responseId: r,
      });
      expect(filled.surveyInvite.answeredAt).not.toBeNull();
      const notice = read.notices.find((n: Row) => n.responseId === r);
      expect(notice.ratings).toEqual([
        { title: "Ads", value: 6 },
        { title: "The people who reached them", value: 4 },
        { title: "Communication", value: 9 },
        { title: "Would recommend", value: 5 },
      ]);
      // An open invite past its end reads expired, without a write.
      await ex(
        `UPDATE cockpit_form_invites SET state = 'open', closed_at = NULL, issued_at = now() - interval '15 days', expires_at = now() - interval '1 hour' WHERE id = '${i}'`,
      );
      expect(
        (
          await as<Row>(CSM_B, "SELECT public.cockpit_csm_churn_read() AS r")
        ).deps.find((d: Row) => d.id === dep).surveyInvite.state,
      ).toBe("expired");
    });
  });

  test("the churn confirm prefill offers the native survey (verified) and its invite", async () => {
    await rolledBack(async () => {
      await depart();
      const i = await issue(B, "exit_survey", {});
      const open = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_form_prefill('churn_confirm', $1) AS r",
        [B],
      );
      expect(open.surveyInvite).toMatchObject({ inviteId: i, state: "open" });
      expect(
        open.values.find((v: Row) => v.key === "surveyState"),
      ).toMatchObject({ value: "sent" });
      const r = await answer(i, EXIT, {
        source: "public",
        signer: "Fahad Test",
      });
      const p = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_form_prefill('churn_confirm', $1) AS r",
        [B],
      );
      expect(p.survey).toMatchObject({
        responseId: r,
        unverified: false,
        native: true,
        inviteId: i,
        via: "link",
        state: "submitted",
      });
      expect(p.values.find((v: Row) => v.key === "surveyState")).toMatchObject({
        value: "filled",
      });
      // The confirm takes it with no "This survey is from this client" tick.
      const today = await kuwaitToday();
      const done = await as<Row>(
        CSM_B,
        "SELECT public.cockpit_client_lifecycle_confirm('churn', $1::jsonb) AS r",
        [
          JSON.stringify({
            taskId: B,
            requestId: rid(),
            leftOn: today,
            noticeOn: today,
            reason: "Cancelled",
            churnType: "mid_programme",
            whyDetail: "The owner moved the budget to a showroom fit-out.",
            howToStop: "Agree the second campaign before day 45.",
            mrrLostUsd: 1500,
            exitCallId: null,
            surveyState: "filled",
            surveyResponseId: r,
          }),
        ],
      );
      expect(
        await one(
          "SELECT survey_response_id::text AS r FROM cockpit_churn_departures WHERE id = $1",
          [done.departureId],
        ),
      ).toBe(r);
    });
  });

  test("the live legacy recorder still stamps a Typeform termination answer with version 1", async () => {
    await rolledBack(async () => {
      const out = await as<Row>(
        "service",
        "SELECT public.cockpit_form_record_legacy($1::jsonb) AS r",
        [
          JSON.stringify({
            formKey: "exit_survey",
            externalId: "tfLegacy01",
            submittedAt: new Date().toISOString(),
            answers: { fields: [] },
            hidden: { client_name: "Acme Interiors" },
          }),
        ],
      );
      expect(
        await one(
          "SELECT form_version AS r FROM cockpit_form_responses WHERE id = $1::uuid",
          [out.responseId],
        ),
      ).toBe(1);
    });
  });

  test("the readers write nothing: each runs inside a read-only transaction (PostgREST runs STABLE functions so)", async () => {
    await rolledBack(async () => {
      await goLive(["pause_consent"]);
      const today = await kuwaitToday();
      await depart();
      const r = await answer(await issue(B, "exit_survey", {}), EXIT);
      await answer(
        await issue(A, "pause_consent", { restart: dayFrom(today, 9) }),
        SIGNED,
      );
      await ex(`UPDATE public.cockpit_form_invites SET state = 'open', closed_at = NULL, issued_at = now() - interval '15 days', expires_at = now() - interval '1 hour'
                 WHERE form_key = 'exit_survey' AND task_id = '${B}'`);
      // At the top of the block, not inside a step's savepoint (a released savepoint puts read-write back).
      await asOwner();
      await db.exec("SET TRANSACTION READ ONLY");
      expect(
        (
          await one<Row>("SELECT public.cockpit_pause_consent_for($1) AS r", [
            A,
          ])
        ).state,
      ).toBe("signed");
      expect(
        (
          await as<Row>(
            CSM_A,
            "SELECT public.cockpit_form_prefill('pause', $1) AS r",
            [A],
          )
        ).consent.state,
      ).toBe("signed");
      expect(
        (
          await as<Row>(
            CSM_B,
            "SELECT public.cockpit_form_prefill('churn_confirm', $1) AS r",
            [B],
          )
        ).surveyInvite.state,
      ).toBe("expired");
      expect(
        (
          await as<Row[]>(CEO, "SELECT public.cockpit_form_notices_in() AS r")
        ).some(x => x.responseId === r),
      ).toBe(true);
      expect(
        (await as<Row>(CSM_B, "SELECT public.cockpit_csm_churn_read() AS r"))
          .deps[0].surveyInvite.state,
      ).toBe("expired");
      // And a write in the same block is refused, so the block really is read only.
      expect(
        (
          await refusal(() =>
            q(
              "UPDATE public.cockpit_settings SET updated_by = 'x' WHERE key = 'forms.client'",
            ),
          )
        ).code,
      ).toBe("25006");
    });
  });

  test("a card id that is not one is refused before any read", async () => {
    expect(
      (
        await refusal(() =>
          q("SELECT public.cockpit_pause_consent_for('../x')"),
        )
      ).message,
    ).toBe("That is not a ClickUp card id.");
    expect(
      await one(
        "SELECT public.cockpit_exit_survey_invite_for(NULL, NULL) AS r",
      ),
    ).toBeNull();
    expect(
      await one("SELECT public.cockpit_exit_survey_departure(NULL) AS r"),
    ).toBeNull();
  });

  test("through the dispatchers: issue then submit, the way 20261102a's paths call the hooks", async () => {
    await rolledBack(async () => {
      const dep = await depart();
      const i = await issue(B, "exit_survey", {});
      const r = await answer(i, EXIT, {
        source: "public",
        signer: "Fahad Test",
      });
      expect(
        await q(
          "SELECT state, response_id::text AS rid FROM cockpit_form_invites WHERE id = $1",
          [i],
        ),
      ).toEqual([{ state: "answered", rid: r }]);
      expect(
        await one(
          "SELECT survey_state AS r FROM cockpit_churn_departures WHERE id = $1",
          [dep],
        ),
      ).toBe("filled");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_invite_events WHERE invite_id = $1 AND event = 'hook_failed'",
          [i],
        ),
      ).toBe(0);
    });
  });
});

describe("the pause consent's thank-you lines (contract 5.5, integration)", () => {
  test("dates wrong reads the dates-wrong line; a signed consent reads done", async () => {
    const done = (answers: Row) =>
      one<Row>(
        "SELECT public.cockpit_form_done_text((SELECT schema FROM public.cockpit_forms WHERE key = 'pause_consent'), $1::jsonb) AS r",
        [JSON.stringify(answers)],
      );
    if (!HAS_A) return;
    expect(
      await done({ datesWrong: true, datesNote: "From the 10th" }),
    ).toEqual({
      en: "Sent. Your account manager will fix the dates and send it again.",
      ar: "وصل. مدير حسابك بيعدّل التواريخ ويرسله لك مرة ثانية.",
    });
    expect(await done({ datesWrong: false })).toEqual({
      en: "Confirmed. Your account manager takes it from here.",
      ar: "تم التأكيد. مدير حسابك بيكمل الباقي.",
    });
    expect(
      await one<string | null>(
        "SELECT public.cockpit_form_schema_check((SELECT schema FROM public.cockpit_forms WHERE key = 'pause_consent')) AS r",
      ),
    ).toBeNull();
  });
});
