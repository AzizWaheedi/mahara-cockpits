/**
 * The 1-1 notes notices (20261029u_forms_checkin_notices.sql,
 * docs/forms/STAGE2B-CONTRACT.md 2.5 and 4.2, build 2) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * an object here as it would in production.
 *
 * It applies the 2a base as live (Stage 1's 20261025n and 20261025o, the
 * ticketing 20261026r, s and t over 20261024a, and 2a's 20261027f, g and h),
 * then 2b's 20261029s_forms_registry.sql and 20261029t_forms_clickup_writeback.sql
 * once each, then 20261029u_forms_checkin_notices.sql twice. The integration
 * cases at the end add 20261029v_forms_client_messages.sql and, once the db
 * builder's file is in the tree, 20261029w_forms_dispatch.sql, each twice.
 * Everything else is cut from its canonical migration, as the Stage 2a fit
 * cuts it (stage2a-fit-supabase.test.ts: keep the two in step). PGlite has no
 * pg_cron, vault or pg_net: the guarded blocks skip. Every person, client,
 * recording and Slack id here is invented; nothing reaches Slack.
 *
 * The body-diff rule (contract 2.2): each of the thirteen replaced functions
 * is 20261025n's body with exactly the edits below, written as literal
 * before/after pairs; the installed body is compared whitespace-normalised,
 * as the drift guard reads it.
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
import { existsSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

const N = "20261025n_slack_notices.sql";
const O = "20261025o_blueprint_close_drain.sql";
const R = "20261026r_requests.sql";
const S2A = "20261026s_request_types_seed.sql";
const T2A = "20261026t_task_alerts.sql";
const V2A = "20261027f_forms_core.sql";
const W2A = "20261027g_fathom_intake.sql";
const X2A = "20261027h_checkin_plans.sql";
const REGISTRY = "20261029s_forms_registry.sql";
const WRITEBACK = "20261029t_forms_clickup_writeback.sql";
const U = "20261029u_forms_checkin_notices.sql";
const MESSAGES = "20261029v_forms_client_messages.sql";
const DISPATCH = "20261029w_forms_dispatch.sql";
const migrationExists = (name: string) =>
  existsSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url));
const HAS_DISPATCH = migrationExists(DISPATCH);

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
const CSM = "00000000-0000-4000-8000-0000000000a1"; // the CSM, every client
const CSM_EMAIL = "csm@tests.invalid";
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative only, every client

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build

const FEEDBACK = "C09SVG6FHGU"; // #client-call-feedback
const CSM_GENERAL = "C09RZ0GS0V9";
const PUBLIC_CHANNEL = "C0PUBLIC001"; // an invented public channel

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
const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function asService() {
  await asOwner();
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
}

// Inside rolledBack every step runs under a savepoint, so a refusal the test
// expects leaves the transaction usable for the steps after it.
let txDepth = 0;
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (txDepth) await db.exec("SAVEPOINT step");
  try {
    const out = await fn();
    if (txDepth) await db.exec("RELEASE SAVEPOINT step");
    return out;
  } catch (e) {
    if (txDepth) await db.exec("ROLLBACK TO SAVEPOINT step");
    throw e;
  } finally {
    await asOwner();
  }
}
async function refusalOf(
  fn: () => Promise<unknown>,
  what: string,
): Promise<Refusal> {
  try {
    await guarded(fn);
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error(`Expected a refusal for ${what}`);
}
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return guarded(async () => (await db.query<T>(text, params)).rows);
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
/** One value as a seat. */
async function one<T = any>(
  who: string,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return guarded(async () => {
    await actor(db, who);
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  });
}
async function refused(
  who: string,
  text: string,
  params: unknown[] = [],
): Promise<Refusal> {
  return refusalOf(async () => {
    await actor(db, who);
    await db.query(text, params);
  }, text);
}
/** One value as the service key. */
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return guarded(async () => {
    await asService();
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  });
}
/** Runs inside a transaction that is always rolled back (now() stands still in it). */
async function rolledBack(fn: () => Promise<void>) {
  await asOwner();
  await db.exec("BEGIN");
  txDepth++;
  try {
    await fn();
  } finally {
    txDepth--;
    await db.exec("ROLLBACK");
  }
}
/** A migration as the deploy's dry run sends it: its own BEGIN and COMMIT taken off. */
function inner(file: string): string {
  return migration(file)
    .replace(/^BEGIN;\s*$/m, "")
    .replace(/^COMMIT;\s*$/m, "");
}

// --- The database the 2b files stand on (as the Stage 2a fit builds it) ---------------------

/**
 * What Stage 1, the ticketing and 2a read, each cut from its canonical migration
 * (as stage2a-fit-supabase.test.ts builds it).
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
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  // The client success roster and gate, and the seats' client rule.
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

  // The media side's client links (the matcher's aliases) and the call briefs the timeline reads.
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

  // The call store: 20261011c's tables and grants, the live bodies w replaces, and the timeline.
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

  // The creative read models, outbox and client action, whole; what the Blueprint migration reads beside them.
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

  // The sales index with the live column names; the exclusion w replaces is
  // LANGUAGE sql, so its tables exist before it is created.
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
  // The service gate of every service RPC, postgres-only as live (20261024a
  // brings cockpit_blueprint_first_name and 20261025n cockpit_slack_notice_role_of).
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

  // Stand-ins with the live column names (as the requests fit has them).
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
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_eod_radar_slack_ids,
      public.cockpit_client_onboarding, public.cockpit_csm_form_sends,
      public.cockpit_csm_source_state, public.cockpit_csm_sources, public.cockpit_csm_deck_prep,
      public.cockpit_media_actions, public.cockpit_client_logos, public.ghl_clients, public.editor_clients,
      public.cockpit_csm_provider_health, public.cockpit_media_provider_health, public.cockpit_decisions,
      public.cockpit_media_native_records FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON public.cockpit_media_source_state, public.cockpit_media_sources, public.cockpit_media_call_briefs,
      public.cockpit_sales_recordings, public.cockpit_sales_call_notes FROM anon, authenticated;
    GRANT SELECT, INSERT ON public.cockpit_csm_provider_health, public.cockpit_media_provider_health TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_media_actions, public.cockpit_sync_state TO service_role;`);

  // The writeback queue as it is live (20261009f with the billing kind of 20261009j).
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

// --- The thirteen edits of contract 4.2, literal before/after pairs on 20261025n's text ---------

const U_EDITS: [string, string, [string, string][]][] = [
  [
    `cockpit_slack_notice_shape`,
    `text`,
    [
      [
        `    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media') THEN 'post'`,
        `    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late') THEN 'post'`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_kind_label`,
    `text`,
    [
      [
        `    WHEN 'blueprint.offer' THEN 'Offer locked'
`,
        `    WHEN 'blueprint.offer' THEN 'Offer locked'
    WHEN 'checkin.grade' THEN 'Call grade'
    WHEN 'checkin.recap_late' THEN 'Recap not sent'
`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_live`,
    `public.cockpit_slack_notices`,
    [
      [
        `DECLARE v_status text; v_updated timestamptz; v_links jsonb; v_sub timestamptz; v_by text; v_launch timestamptz;
BEGIN
`,
        `DECLARE v_status text; v_updated timestamptz; v_links jsonb; v_sub timestamptz; v_by text; v_launch timestamptz;
  v_rec text; v_grade jsonb; v_class text; v_gone timestamptz; v_call_gone boolean; v_email text; v_starts timestamptz;
  v_share text; v_effect text; v_ref text; v_message text;
BEGIN
  -- A 1-1 notes notice (2b). The call grade's words come from the draft its
  -- facts name, read now and only once that draft is ready; they are never
  -- stored in the outbox (Z7). Who took the call is a role, never a name.
  IF p_row.kind = 'checkin.grade' THEN
    v_rec := p_row.facts->>'recordingId';
    IF coalesce(p_row.facts->>'draftId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT jsonb_build_object('criteria', d.output->'criteria', 'overall', d.output->'overall', 'color', d.output->'color',
                                'score', d.output->'score', 'draftId', d.id)
        INTO v_grade
        FROM public.cockpit_form_drafts d
       WHERE d.id = (p_row.facts->>'draftId')::uuid AND d.kind = 'grade' AND d.state = 'ready'
         AND d.recording_id = v_rec AND jsonb_typeof(d.output) = 'object';
    END IF;
    SELECT m.class, m.gone_at, lower(btrim(m.recorded_by_email)), m.starts_at, m.share_url
      INTO v_class, v_gone, v_email, v_starts, v_share
      FROM public.cockpit_fathom_meetings m WHERE m.recording_id = v_rec;
    v_call_gone := EXISTS (SELECT 1 FROM public.cockpit_csm_calls c
                            WHERE c.source = 'fathom' AND c.source_id = v_rec AND c.status = 'gone');
    v_by := CASE WHEN nullif(v_email, '') IS NOT NULL THEN public.cockpit_slack_notice_role_of(v_email) END;
    IF v_by IS NULL AND coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT public.cockpit_slack_notice_role_of(r.submitted_by) INTO v_by
        FROM public.cockpit_form_responses r WHERE r.id = (p_row.facts->>'responseId')::uuid;
    END IF;
    RETURN jsonb_build_object(
      'takenByRole', v_by,
      'callAt', public.cockpit_slack_notice_iso(v_starts),
      'shareUrl', v_share,
      'recordingShown', coalesce(v_class IN ('client','candidate') AND v_gone IS NULL AND NOT v_call_gone, false))
      || CASE WHEN v_grade IS NOT NULL THEN jsonb_build_object('grade', v_grade) ELSE '{}'::jsonb END;
  ELSIF p_row.kind = 'checkin.recap_late' THEN
    -- Where the recap is now: its effect, and the message the effect points at.
    IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT e.state, e.delivery_ref INTO v_effect, v_ref
        FROM public.cockpit_form_effects e
       WHERE e.response_id = (p_row.facts->>'responseId')::uuid AND e.effect_key = 'recap';
    END IF;
    IF coalesce(v_ref, '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT m.state INTO v_message FROM public.cockpit_client_messages m WHERE m.id = v_ref::uuid;
    END IF;
    RETURN jsonb_build_object('recap', jsonb_build_object('effectState', v_effect, 'messageState', v_message));
  END IF;
`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_claim`,
    `integer,uuid`,
    [
      [
        `  v_row jsonb;
BEGIN
`,
        `  v_row jsonb;
  v_gate jsonb;
  v_live jsonb;
BEGIN
`,
      ],
      [
        `                          public.cockpit_slack_notice_ts(r.facts->>'confirmedAt'),
                          r.created_at);`,
        `                          public.cockpit_slack_notice_ts(r.facts->>'confirmedAt'),
                          public.cockpit_slack_notice_ts(r.facts->>'dueAt'),
                          r.created_at);`,
      ],
      [
        `    -- 2. A reply waits for its first notice, then goes in its thread.
`,
        `    -- 1c. A call grade (2b): only while the cockpit owns it (the owner
    --     gate), for a recording still shown as a client call, with its grade
    --     in the cockpit, to a private channel. A refusal found after the
    --     claim goes through sending to failed: the guard lets a queued notice
    --     go only to sending, skipped or muted.
    IF r.kind = 'checkin.grade' THEN
      v_gate := public.cockpit_form_effect_gate('slack_notice', r.id::text);
      IF NOT coalesce((v_gate->>'ok')::boolean, false) THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = left(coalesce(nullif(v_gate->>'reason', ''), 'Make owns this again.'), 240)
         WHERE id = r.id;
        CONTINUE;
      END IF;
      v_live := public.cockpit_slack_notice_live(r);
      IF NOT coalesce((v_live->>'recordingShown')::boolean, false) THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'That recording is no longer a client call, so its grade was not posted.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_live->'grade') IS DISTINCT FROM 'object' THEN
        UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
        UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
               error = 'The call''s grade is not in the cockpit, so nothing was posted. Tell the tech lead.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c
                      WHERE c.id = public.cockpit_slack_notice_target(r.kind) AND c.private IS TRUE) THEN
        UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
        UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
               error = 'The call grade posts only in a private channel. Choose one in Settings, Notices and routing.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    -- 1d. A recap reminder (2b): not once the recap has gone or been
    --     skipped, nor once Make owns the recap again.
    IF r.kind = 'checkin.recap_late' THEN
      v_live := public.cockpit_slack_notice_live(r);
      IF v_live->'recap'->>'messageState' = 'sent' OR v_live->'recap'->>'effectState' = 'delivered' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'The recap was sent before this reminder went out.'
         WHERE id = r.id;
        CONTINUE;
      ELSIF v_live->'recap'->>'messageState' = 'skipped' OR v_live->'recap'->>'effectState' = 'skipped' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'The recap was skipped, so no reminder was posted.'
         WHERE id = r.id;
        CONTINUE;
      ELSIF public.cockpit_form_effect_owner('checkin', 'recap') IS DISTINCT FROM 'cockpit'
         OR public.cockpit_form_native_since('checkin') IS NULL THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'Make owns this again.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    -- 2. A reply waits for its first notice, then goes in its thread.
`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_inputs`,
    `jsonb`,
    [
      [
        `    IF v_kind IS NULL OR v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer') THEN`,
        `    IF v_kind IS NULL OR v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late') THEN`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_doctor_inputs`,
    ``,
    [
      [
        `                                             'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer'], s.kind))`,
        `                                             'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                                             'checkin.grade','checkin.recap_late'], s.kind))`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_settings_read`,
    ``,
    [
      [
        `                                   'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer'], x.kind)`,
        `                                   'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                                   'checkin.grade','checkin.recap_late'], x.kind)`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_settings_set`,
    `text,jsonb`,
    [
      [
        `  IF (v_on, v_channel, v_rule, v_people) IS NOT DISTINCT FROM (s.enabled, s.channel, s.mention_rule, s.mention_people) THEN
`,
        `  -- The call grade (2b) is about a person's call: it tags nobody and posts
  -- only in a channel the cockpit has checked as private.
  IF s.kind = 'checkin.grade' THEN
    IF cardinality(v_rule) > 0 OR cardinality(v_people) > 0 THEN
      RAISE EXCEPTION 'The call grade tags nobody.' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'channel' AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c
                                            WHERE c.id = v_channel AND c.private IS TRUE) THEN
      RAISE EXCEPTION 'The call grade posts only in a private channel. Choose one the cockpit has checked as private.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF (v_on, v_channel, v_rule, v_people) IS NOT DISTINCT FROM (s.enabled, s.channel, s.mention_rule, s.mention_people) THEN
`,
      ],
    ],
  ],
  [
    `cockpit_slack_channel_remove`,
    `text`,
    [
      [
        `   ORDER BY array_position(ARRAY['kickoff','blueprint.close','blueprint.media'], s.kind) LIMIT 1;`,
        `   ORDER BY array_position(ARRAY['kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late'], s.kind) LIMIT 1;`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_rehearse`,
    `text`,
    [
      [
        `  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer') THEN`,
        `  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late') THEN`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_rehearse_service`,
    `text,text`,
    [
      [
        `  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer') THEN`,
        `  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late') THEN`,
      ],
    ],
  ],
  [
    `cockpit_slack_notice_read`,
    `text`,
    [
      [
        `DECLARE v_ok boolean := false; v_msg text; v_code text; v_name text;`,
        `DECLARE v_ok boolean := false; v_msg text; v_code text; v_name text; v_checkin boolean := false;`,
      ],
      [
        `  IF coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false) THEN
    v_ok := true;
`,
        `  IF coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false) THEN
    v_ok := true;
    v_checkin := true;
`,
      ],
      [
        `      PERFORM public.cockpit_csm_client_gate(p_task_id);
      v_ok := true;
`,
        `      PERFORM public.cockpit_csm_client_gate(p_task_id);
      v_ok := true;
      v_checkin := true;
`,
      ],
      [
        `                                  WHERE x.task_id = p_task_id AND x.kind <> 'rehearsal'
`,
        `                                  WHERE x.task_id = p_task_id AND x.kind <> 'rehearsal'
                                    -- The 1-1 notes notices are client success's: never a creative-only seat's.
                                    AND (v_checkin OR x.kind NOT LIKE 'checkin.%')
`,
      ],
    ],
  ],
  [
    `cockpit_slack_notices_kick`,
    ``,
    [
      [
        `  v_note text;
BEGIN
`,
        `  v_note text;
BEGIN
  -- 2b (Z10): the recap reminders and the 1-1 notes dispatch sweep ride this
  -- kick. Each is noted with the queue's failures and never stops the rest.
  BEGIN
    PERFORM public.cockpit_slack_notice_sweep_checkin();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('The recap reminder sweep failed: ' || SQLERRM);
  END;
  BEGIN
    IF to_regprocedure('public.cockpit_form_effects_kick()') IS NOT NULL THEN
      PERFORM public.cockpit_form_effects_kick();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('The 1-1 notes sweep failed: ' || SQLERRM);
  END;
`,
      ],
    ],
  ],
];

/** The seats, the people by role, the roster the client gate reads, and the 2b fixtures' channels. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  for (const [name, email, role] of [
    ["Noura Test", CSM_EMAIL, "Client success manager"],
    ["Omar Test", "creative@tests.invalid", "Creative strategist"],
    ["Chief Test", CEO_EMAIL, "CEO"],
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
  for (const [taskId, name] of [
    [A, "Acme Interiors"],
    [B, "Beta Build"],
  ])
    await q(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [taskId, name],
    );
}

// --- Fixtures ----------------------------------------------------------------------------------

/** The checkin registry's owners: the named effects get `owner`, the rest stay as they are. */
async function owners(keys: string[], owner: string) {
  await q(
    `UPDATE public.cockpit_forms
        SET effects = (SELECT jsonb_agg(CASE WHEN e->>'key' = ANY($1::text[]) THEN jsonb_set(e, '{owner}', to_jsonb($2::text)) ELSE e END
                                        ORDER BY o)
                         FROM jsonb_array_elements(effects) WITH ORDINALITY q(e, o))
      WHERE key = 'checkin'`,
    [keys, owner],
  );
  // The owner gate passes only in a native window, so a cockpit owner here means the hour is open.
  if (owner === "cockpit") await nativeWindow();
}
/** The registry on native, opened long before any row of these cases. */
async function nativeWindow() {
  await q(
    "UPDATE public.cockpit_forms SET provider = 'native' WHERE key = 'checkin' AND provider <> 'native'",
  );
  await q(
    "UPDATE public.cockpit_forms SET provider_since = now() - interval '30 days' WHERE key = 'checkin'",
  );
}

let recSeq = 900000700;
/** A live (or shadow) check-in response for a recorded call, sent by the CSM. */
async function response(
  opts: {
    task?: string;
    client?: string;
    mode?: "live" | "shadow";
    submitted?: string;
    endsAt?: string | null;
    rec?: string;
  } = {},
): Promise<{ id: string; rec: string }> {
  const rec = opts.rec ?? String(recSeq++);
  const submitted = opts.submitted ?? ago(5);
  const ends = opts.endsAt === undefined ? ago(20) : opts.endsAt;
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, client_name, mode, state, answers,
       created_by, created_by_id, submitted_by, submitted_at)
     VALUES('checkin', 1, 'cockpit', $1, $2, $3, 'submitted', $4::jsonb, $5, $6, $5, $7) RETURNING id`,
    [
      opts.task ?? A,
      opts.client ?? "Acme Interiors",
      opts.mode ?? "live",
      JSON.stringify({
        call: {
          kind: "fathom",
          recordingId: rec,
          startsAt: ago(50),
          ...(ends ? { endsAt: ends } : {}),
        },
      }),
      CSM_EMAIL,
      CSM,
      submitted,
    ],
  );
  return { id, rec };
}

/** One effect of a response, planned and then moved to `state` with its delivery row. */
async function effect(
  responseId: string,
  key: string,
  delivery: string,
  state: string,
  ref: string | null,
  owner = "cockpit",
) {
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
     VALUES($1::uuid, 'checkin', $2, $1::text || ':' || $2, $3, $4, '{}'::jsonb, $5) RETURNING id`,
    [
      responseId,
      key,
      owner,
      delivery,
      owner === "cockpit" ? "planned" : "dry_run",
    ],
  );
  if (owner === "cockpit" && state !== "planned") {
    if (state !== "queued")
      await q(
        "UPDATE public.cockpit_form_effects SET state='queued', delivery_ref=$2 WHERE id=$1",
        [id, ref],
      );
    await q(
      "UPDATE public.cockpit_form_effects SET state=$2, delivery_ref=$3 WHERE id=$1",
      [id, state, ref],
    );
  }
  return id;
}

/** The recording as the intake stores it. */
async function meeting(
  rec: string,
  cls: string | null = "client",
  opts: { email?: string | null; gone?: boolean; task?: string } = {},
) {
  await q(
    `INSERT INTO public.cockpit_fathom_meetings(recording_id, title, starts_at, ends_at, recorded_by_email, recorded_by_name, raw,
       share_url, class, gone_at)
     VALUES($1, 'Acme Interiors check-in', $2, $3, $4, 'Noura Test', '{}'::jsonb, $5, $6, $7)`,
    [
      rec,
      ago(50),
      ago(20),
      opts.email === undefined ? CSM_EMAIL : opts.email,
      `https://fathom.video/share/test-${rec}`,
      cls,
      opts.gone ? ago(1) : null,
    ],
  );
}

const GRADE = {
  criteria: [
    { name: "Rapport", score: 8, note: "Invented note on rapport." },
    { name: "Knowledge", score: 7, note: "Invented note on knowledge." },
  ],
  overall: "INVENTED-OVERALL-FEEDBACK: steady call.",
  color: "Green",
  score: 7.5,
};
/** A grade draft of the recording, ready (or another state). */
async function gradeDraft(
  rec: string,
  state = "ready",
  task = A,
): Promise<string> {
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_form_drafts(form_key, task_id, recording_id, kind, provider, prompt_version, input_sha256, state, created_by)
     VALUES('checkin', $1, $2, 'grade', 'deepseek', 'checkin.grade.v1', $3, 'drafting', 'server') RETURNING id`,
    [task, rec, sha256(`input-${rec}`)],
  );
  if (state !== "drafting")
    await q(
      "UPDATE public.cockpit_form_drafts SET state=$2, output=$3::jsonb, model='deepseek-test' WHERE id=$1",
      [id, state, state === "ready" ? JSON.stringify(GRADE) : null],
    );
  return id;
}

/** A grade notice as 20261029w queues it (3.4): ids and times only. */
async function gradeNotice(
  r: { id: string; rec: string },
  draftId: string | null,
  opts: { submittedAt?: string; task?: string; client?: string } = {},
): Promise<string> {
  const facts = {
    responseId: r.id,
    recordingId: r.rec,
    draftId,
    taskId: opts.task ?? A,
    effectId: null,
    client: opts.client ?? "Acme Interiors",
    submittedAt: opts.submittedAt ?? ago(5),
  };
  const [{ id }] = await q<{ id: string }>(
    "SELECT public.cockpit_slack_notice_queue('checkin.grade', 'grade:' || $1, $2, $3, $4::jsonb, NULL, 'queued', NULL) AS id",
    [
      r.rec,
      opts.task ?? A,
      opts.client ?? "Acme Interiors",
      JSON.stringify(facts),
    ],
  );
  return id;
}

/** A recap message of a response in `state`, moved there through the guard's own moves. */
async function message(
  responseId: string,
  state: string,
  task = A,
): Promise<string> {
  const body = `Invented recap for ${responseId}.`;
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, response_id, body, body_sha256)
     VALUES($1::text || ':recap', $2, 'Acme Interiors', 'recap_checkin', $1::uuid, $3, $4) RETURNING id`,
    [responseId, task, body, sha256(body)],
  );
  const path: Record<string, string[]> = {
    draft: [],
    approved: ["approved"],
    refused: ["approved", "claimed", "refused"],
    failed: ["approved", "claimed", "sending", "failed"],
    unknown: ["approved", "claimed", "sending", "unknown"],
    sent: ["approved", "claimed", "sending", "sent"],
    skipped: ["skipped"],
  };
  for (const step of path[state])
    await q(
      `UPDATE public.cockpit_client_messages SET state=$2,
              approved_by = coalesce(approved_by, $3), approved_at = coalesce(approved_at, now()),
              expires_at = coalesce(expires_at, now() + interval '24 hours'),
              claim_token = CASE WHEN $2 IN ('claimed','sending','sent','refused','failed','unknown') THEN coalesce(claim_token, gen_random_uuid()) END,
              provider_id = CASE WHEN $2 = 'sent' THEN 'wamid-test-1' END,
              reason = CASE WHEN $2 IN ('refused','failed','unknown') THEN 'Invented reason.' END
        WHERE id=$1`,
      [id, step, CSM_EMAIL],
    );
  return id;
}

/** A recap reminder as sweep_checkin queues it. */
async function recapLate(responseId: string, dueAt: string): Promise<string> {
  const [{ id }] = await q<{ id: string }>(
    "SELECT public.cockpit_slack_notice_queue('checkin.recap_late', 'recap_late:' || $1, $2, 'Acme Interiors', $3::jsonb, NULL, 'queued', NULL) AS id",
    [
      responseId,
      A,
      JSON.stringify({
        taskId: A,
        client: "Acme Interiors",
        responseId,
        callAt: ago(60 * 25),
        dueAt,
      }),
    ],
  );
  return id;
}

async function claim(id: string): Promise<Row> {
  return svc("SELECT public.cockpit_slack_notice_claim(10, $1::uuid) AS r", [
    id,
  ]);
}
async function notice(id: string): Promise<Row> {
  return (
    await q("SELECT * FROM public.cockpit_slack_notices WHERE id=$1", [id])
  )[0];
}
/** The state moves a notice's audit rows recorded, in order. */
async function moves(id: string): Promise<string[]> {
  return (
    await q<{ action: string }>(
      "SELECT action FROM public.cockpit_audit_log WHERE entity_type='cockpit_slack_notices' AND entity_id=$1 ORDER BY test_seq",
      [id],
    )
  ).map(r => r.action);
}

/** The body between AS $$ and $$; of one function in a migration's text. */
function bodyOf(text: string): string {
  const m = text.match(/ AS \$\$([\s\S]*)\$\$;$/);
  if (!m) throw new Error("No body");
  return m[1];
}
const norm = (s: string) => s.replace(/\s+/g, " ");
function cutFn(src: string, name: string): string {
  return cut(
    src,
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*? AS \\$\\$[\\s\\S]*?\\$\\$;`,
    ),
    name,
  );
}
async function installed(
  sig: string,
): Promise<{ src: string; md5: string; acl: string }> {
  return (
    await q<{ src: string; md5: string; acl: string }>(
      `SELECT p.prosrc AS src, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS md5, p.proacl::text AS acl
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [`public.${sig}`],
    )
  )[0];
}

/** The drift guard's three columns, read from a migration's text. */
function driftRows(
  file: string,
): { fn: string; live: string; after: string }[] {
  const guard = cut(
    migration(file),
    /DO \$\$\nDECLARE g record; v_now text;[\s\S]*?END \$\$;/,
    `${file} drift guard`,
  );
  return [
    ...guard.matchAll(
      /\('public\.([^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
    ),
  ].map(m => ({
    fn: m[1],
    live: m[2],
    after: m[3],
  }));
}

// The live ACL of each replaced function (contract 2.2), kept by u.
const AUTH = "{postgres=X/postgres,authenticated=X/postgres}";
const SVC = "{postgres=X/postgres,service_role=X/postgres}";
const OWNER = "{postgres=X/postgres}";
const ACL: Record<string, string> = {
  "cockpit_slack_notices_kick()": OWNER,
  "cockpit_slack_notice_claim(integer,uuid)": SVC,
  "cockpit_slack_notice_live(public.cockpit_slack_notices)": OWNER,
  "cockpit_slack_notice_shape(text)": OWNER,
  "cockpit_slack_notice_kind_label(text)": OWNER,
  "cockpit_slack_notice_inputs(jsonb)": SVC,
  "cockpit_slack_notice_doctor_inputs()": SVC,
  "cockpit_slack_notice_settings_read()": AUTH,
  "cockpit_slack_notice_settings_set(text,jsonb)": AUTH,
  "cockpit_slack_channel_remove(text)": AUTH,
  "cockpit_slack_notice_rehearse(text)": AUTH,
  "cockpit_slack_notice_rehearse_service(text,text)": SVC,
  "cockpit_slack_notice_read(text)": AUTH,
  "cockpit_slack_notice_sweep_checkin()": OWNER,
};
const TEN = [
  "kickoff",
  "kickoff.late",
  "kickoff.second",
  "kickoff.updated",
  "blueprint.close",
  "blueprint.updated",
  "blueprint.media",
  "blueprint.offer",
  "checkin.grade",
  "checkin.recap_late",
];

let firstSeeded = 0;
let secondSeeded = 0;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The order audit rows were written in: two quick statements can share created_at on PGlite.
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await standOn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of [N, O, R, S2A, T2A, V2A, W2A, X2A])
    await db.exec(migration(file));
  await db.exec(migration(REGISTRY));
  await db.exec(migration(WRITEBACK));
  await db.exec(migration(U));
  firstSeeded = await count(
    "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='notices.setting_seeded'",
  );
  await db.exec(migration(U));
  secondSeeded = await count(
    "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='notices.setting_seeded'",
  );
  // #client-call-feedback as live: the sender has checked it, private and ok; and one public channel.
  await q(
    "UPDATE public.cockpit_slack_channels SET state='ok', private=true, checked_at=now() WHERE id=$1",
    [FEEDBACK],
  );
  await q(
    "INSERT INTO public.cockpit_slack_channels(id, name, private, state, note, added_by) VALUES($1, 'open-room', false, 'ok', 'Invented public channel.', 'test')",
    [PUBLIC_CHANNEL],
  );
}, 300_000);
afterAll(async () => {
  await db?.close();
});

describe("the migration", () => {
  test("the CHECKs name both kinds, the channel rule covers them, and the seeds are as the contract writes them", async () => {
    const defs = Object.fromEntries(
      (
        await q<{ n: string; d: string }>(
          `SELECT conname n, pg_get_constraintdef(oid) d FROM pg_constraint
            WHERE conname IN ('cockpit_slack_notice_settings_kind_check','cockpit_slack_notices_kind_check','cockpit_slack_notice_settings_check')`,
        )
      ).map(r => [r.n, r.d]),
    );
    for (const k of [
      "cockpit_slack_notice_settings_kind_check",
      "cockpit_slack_notices_kind_check",
      "cockpit_slack_notice_settings_check",
    ]) {
      expect(defs[k]).toContain("'checkin.grade'");
      expect(defs[k]).toContain("'checkin.recap_late'");
    }
    expect(defs.cockpit_slack_notices_kind_check).toContain("'rehearsal'");
    expect(defs.cockpit_slack_notice_settings_check).toContain(
      "(channel IS NOT NULL)",
    );
    expect(
      await q(
        "SELECT kind, enabled, channel, mention_rule, mention_people, updated_by FROM public.cockpit_slack_notice_settings WHERE kind LIKE 'checkin.%' ORDER BY kind",
      ),
    ).toEqual([
      {
        kind: "checkin.grade",
        enabled: true,
        channel: FEEDBACK,
        mention_rule: [],
        mention_people: [],
        updated_by: "migration",
      },
      {
        kind: "checkin.recap_late",
        enabled: true,
        channel: CSM_GENERAL,
        mention_rule: [],
        mention_people: [],
        updated_by: "migration",
      },
    ]);
    // One notices.setting_seeded row per seed on the first apply, none on the second.
    expect(firstSeeded).toBe(2);
    expect(secondSeeded).toBe(2);
    expect(
      await q(
        "SELECT entity_type, entity_id, actor_email, after FROM public.cockpit_audit_log WHERE action='notices.setting_seeded' ORDER BY entity_id",
      ),
    ).toEqual([
      {
        entity_type: "cockpit_slack_notice_settings",
        entity_id: "checkin.grade",
        actor_email: "migration",
        after: { kind: "checkin.grade", enabled: true, channel: FEEDBACK },
      },
      {
        entity_type: "cockpit_slack_notice_settings",
        entity_id: "checkin.recap_late",
        actor_email: "migration",
        after: {
          kind: "checkin.recap_late",
          enabled: true,
          channel: CSM_GENERAL,
        },
      },
    ]);
    // The channel seed, as a fresh database checks any added channel.
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_slack_channels WHERE id=$1 AND name='client-call-feedback'",
        [FEEDBACK],
      ),
    ).toBe(1);
    // A setting for a kind outside the list is still refused, and a 1-1 notes kind must name a channel.
    expect(
      (
        await refusalOf(
          () =>
            db.query(
              "INSERT INTO public.cockpit_slack_notice_settings(kind, channel, updated_by) VALUES('checkin.other', $1, 't')",
              [FEEDBACK],
            ),
          "kind",
        )
      ).code,
    ).toBe("23514");
    expect(
      (
        await refusalOf(
          () =>
            db.query(
              "UPDATE public.cockpit_slack_notice_settings SET channel=NULL WHERE kind='checkin.grade'",
            ),
          "channel",
        )
      ).code,
    ).toBe("23514");
  });

  test("ten kinds in order: the labels, the shape, the settings read and the doctor's inputs", async () => {
    expect(
      await q(
        "SELECT public.cockpit_slack_notice_kind_label('checkin.grade') a, public.cockpit_slack_notice_kind_label('checkin.recap_late') b",
      ),
    ).toEqual([{ a: "Call grade", b: "Recap not sent" }]);
    expect(
      await q(
        "SELECT public.cockpit_slack_notice_shape('checkin.grade') a, public.cockpit_slack_notice_shape('checkin.recap_late') b",
      ),
    ).toEqual([{ a: "post", b: "post" }]);
    const read = await one<Row>(
      CSM,
      "SELECT public.cockpit_slack_notice_settings_read() r",
    );
    expect(read.notices.map((n: Row) => n.kind)).toEqual(TEN);
    const grade = read.notices.find((n: Row) => n.kind === "checkin.grade");
    expect(grade).toMatchObject({
      shape: "post",
      on: true,
      fixedOn: false,
      channel: { id: FEEDBACK, name: "client-call-feedback" },
      mentionRule: [],
      last: null,
    });
    const doctor = await svc<Row>(
      "SELECT public.cockpit_slack_notice_doctor_inputs() r",
    );
    expect(doctor.settings.map((s: Row) => s.kind)).toEqual(TEN);
    expect(doctor.settings.at(-2)).toEqual({
      kind: "checkin.grade",
      enabled: true,
      channel: FEEDBACK,
      mentions: [],
    });
  });

  test("removing the Call grade's channel is refused until it posts elsewhere", async () => {
    await rolledBack(async () => {
      expect(
        (
          await refused(CEO, "SELECT public.cockpit_slack_channel_remove($1)", [
            FEEDBACK,
          ])
        ).message,
      ).toBe(
        "The Call grade notice posts there. Choose another channel for it first.",
      );
      // The Stage 1 refusal is unchanged for #csm-general, which three kinds share.
      expect(
        (
          await refused(CEO, "SELECT public.cockpit_slack_channel_remove($1)", [
            CSM_GENERAL,
          ])
        ).message,
      ).toBe(
        "The Kickoff complete notice posts there. Choose another channel for it first.",
      );
    });
  });

  test("settings_set: the call grade tags nobody and posts only in a private channel", async () => {
    await rolledBack(async () => {
      const set = (patch: Row) =>
        refused(
          CEO,
          "SELECT public.cockpit_slack_notice_settings_set('checkin.grade', $1::jsonb)",
          [JSON.stringify(patch)],
        );
      expect((await set({ mentionRule: ["seat:csm"] })).message).toBe(
        "The call grade tags nobody.",
      );
      const person = (
        await q<{ id: number }>(
          "SELECT id FROM public.cockpit_people WHERE email=$1",
          [CSM_EMAIL],
        )
      )[0].id;
      expect((await set({ mentionPeople: [Number(person)] })).message).toBe(
        "The call grade tags nobody.",
      );
      expect((await set({ channel: PUBLIC_CHANNEL })).message).toBe(
        "The call grade posts only in a private channel. Choose one the cockpit has checked as private.",
      );
      expect((await set({ channel: PUBLIC_CHANNEL })).code).toBe("22023");
      // Another private, checked channel and the on switch are fine; so is tagging for the recap reminder.
      const moved = await one<Row>(
        CEO,
        "SELECT public.cockpit_slack_notice_settings_set('checkin.grade', $1::jsonb) r",
        [JSON.stringify({ channel: CSM_GENERAL, on: false })],
      );
      expect(
        moved.notices.find((n: Row) => n.kind === "checkin.grade"),
      ).toMatchObject({ on: false, channel: { id: CSM_GENERAL } });
      const late = await one<Row>(
        CEO,
        "SELECT public.cockpit_slack_notice_settings_set('checkin.recap_late', $1::jsonb) r",
        [JSON.stringify({ mentionRule: ["seat:csm"] })],
      );
      expect(
        late.notices.find((n: Row) => n.kind === "checkin.recap_late")
          .mentionRule,
      ).toEqual(["seat:csm"]);
      // A non-editor still cannot change it.
      expect(
        (
          await refused(
            CSM,
            "SELECT public.cockpit_slack_notice_settings_set('checkin.grade', '{\"on\":false}'::jsonb)",
          )
        ).code,
      ).toBe("42501");
    });
  });

  test("the kind lists: a dry run, a rehearsal and the door's rehearsal take both kinds", async () => {
    await rolledBack(async () => {
      const inputs = await svc<Row>(
        "SELECT public.cockpit_slack_notice_inputs($1::jsonb) r",
        [
          JSON.stringify({
            kind: "checkin.recap_late",
            taskId: A,
            facts: { client: "Acme Interiors", dueAt: ago(1) },
          }),
        ],
      );
      expect(inputs).toMatchObject({
        kind: "checkin.recap_late",
        taskId: A,
        target: CSM_GENERAL,
        live: { recap: { effectState: null, messageState: null } },
      });
      const queued = await one<Row>(
        CEO,
        "SELECT public.cockpit_slack_notice_rehearse('checkin.grade') r",
      );
      expect(queued.state).toBe("queued");
      const door = await svc<Row>(
        "SELECT public.cockpit_slack_notice_rehearse_service('checkin.recap_late', 'U0TESTER001') r",
      );
      expect(door.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        (
          await refused(
            CEO,
            "SELECT public.cockpit_slack_notice_rehearse('checkin.other')",
          )
        ).message,
      ).toBe("There is no notice called checkin.other.");
    });
  });
});

describe("the call grade's claim (steps 1b and 1c)", () => {
  test("a good row is claimed with the stored grade read now, the facts unchanged, and nobody to tag", async () => {
    await rolledBack(async () => {
      await owners(["grade_notice"], "cockpit");
      const r = await response();
      await meeting(r.rec);
      const draft = await gradeDraft(r.rec);
      const id = await gradeNotice(r, draft);
      const facts = (await notice(id)).facts;
      await effect(r.id, "grade_notice", "slack_notice", "queued", id);
      const out = await claim(id);
      expect(out.rows).toHaveLength(1);
      const row = out.rows[0];
      expect(row).toMatchObject({
        kind: "checkin.grade",
        taskId: A,
        target: FEEDBACK,
        threadTs: null,
        mentions: { main: [] },
      });
      expect(row.facts).toEqual(facts);
      expect(row.live).toEqual({
        grade: { ...GRADE, draftId: draft },
        takenByRole: "the CSM",
        callAt: expect.stringMatching(/Z$/),
        shareUrl: `https://fathom.video/share/test-${r.rec}`,
        recordingShown: true,
      });
      expect((await notice(id)).state).toBe("sending");
      // The facts never carry the grade's words.
      expect(JSON.stringify(facts)).not.toContain("INVENTED-OVERALL");
    });
  });

  test("no recorder stored: who took the call is the role of whoever sent the notes", async () => {
    await rolledBack(async () => {
      await owners(["grade_notice"], "cockpit");
      const r = await response();
      await meeting(r.rec, "candidate", { email: null });
      const id = await gradeNotice(r, await gradeDraft(r.rec));
      await effect(r.id, "grade_notice", "slack_notice", "queued", id);
      const row = (await claim(id)).rows[0];
      expect(row.live.takenByRole).toBe("the CSM");
      expect(row.live.recordingShown).toBe(true);
    });
  });

  test("(i) the owner gate: no effect, the registry back on shadow, or a settled effect skip it with the gate's reason", async () => {
    await rolledBack(async () => {
      const r = await response();
      await meeting(r.rec);
      const draft = await gradeDraft(r.rec);
      // No effect points at it.
      const lone = await gradeNotice(r, draft);
      expect((await claim(lone)).rows).toEqual([]);
      expect(await notice(lone)).toMatchObject({
        state: "skipped",
        error:
          "No 1-1 notes effect points at this write, so nothing was written.",
      });
    });
    await rolledBack(async () => {
      // The registry still shadow: Make owns this again.
      const r = await response();
      await meeting(r.rec);
      const id = await gradeNotice(r, await gradeDraft(r.rec));
      await effect(r.id, "grade_notice", "slack_notice", "queued", id);
      expect((await claim(id)).rows).toEqual([]);
      expect(await notice(id)).toMatchObject({
        state: "skipped",
        error: "Make owns this again.",
      });
      expect(await moves(id)).toEqual([
        "slack_notice.queued",
        "slack_notice.skipped",
      ]);
    });
  });

  test("(ii) a recording no longer shown as a client call is skipped", async () => {
    for (const shape of [
      { cls: "internal" },
      { cls: "client", gone: true },
      { cls: null },
      { cls: "client", callGone: true },
    ]) {
      await rolledBack(async () => {
        await owners(["grade_notice"], "cockpit");
        const r = await response();
        await meeting(r.rec, shape.cls, { gone: shape.gone });
        if (shape.callGone)
          await q(
            "INSERT INTO public.cockpit_csm_calls(source, source_id, kind, title, starts_at, status) VALUES('fathom', $1, 'other', 'Gone call', now(), 'gone')",
            [r.rec],
          );
        const id = await gradeNotice(r, await gradeDraft(r.rec));
        await effect(r.id, "grade_notice", "slack_notice", "queued", id);
        expect((await claim(id)).rows).toEqual([]);
        expect(await notice(id)).toMatchObject({
          state: "skipped",
          error:
            "That recording is no longer a client call, so its grade was not posted.",
        });
      });
    }
  });

  test("(iii) no stored grade: through sending to failed, with the tech lead named", async () => {
    for (const draftState of ["none", "failed", "drafting", "another"]) {
      await rolledBack(async () => {
        await owners(["grade_notice"], "cockpit");
        const r = await response();
        await meeting(r.rec);
        let draft: string | null = null;
        if (draftState === "failed" || draftState === "drafting")
          draft = await gradeDraft(r.rec, draftState);
        if (draftState === "another")
          draft = await gradeDraft(String(recSeq++)); // a ready grade of another call
        const id = await gradeNotice(r, draft);
        await effect(r.id, "grade_notice", "slack_notice", "queued", id);
        expect((await claim(id)).rows).toEqual([]);
        expect(await notice(id)).toMatchObject({
          state: "failed",
          error:
            "The call's grade is not in the cockpit, so nothing was posted. Tell the tech lead.",
        });
        expect(await moves(id)).toEqual([
          "slack_notice.queued",
          "slack_notice.sending",
          "slack_notice.failed",
        ]);
      });
    }
  });

  test("(iv) a channel not checked as private: through sending to failed", async () => {
    await rolledBack(async () => {
      await owners(["grade_notice"], "cockpit");
      // An editor could not choose it; a channel that turned public since can still be on the row.
      await q(
        "UPDATE public.cockpit_slack_channels SET private=false WHERE id=$1",
        [FEEDBACK],
      );
      const r = await response();
      await meeting(r.rec);
      const id = await gradeNotice(r, await gradeDraft(r.rec));
      await effect(r.id, "grade_notice", "slack_notice", "queued", id);
      expect((await claim(id)).rows).toEqual([]);
      expect(await notice(id)).toMatchObject({
        state: "failed",
        error:
          "The call grade posts only in a private channel. Choose one in Settings, Notices and routing.",
      });
      expect(await moves(id)).toEqual([
        "slack_notice.queued",
        "slack_notice.sending",
        "slack_notice.failed",
      ]);
    });
  });

  test("turned off in Settings: muted before any check, as Stage 1 mutes", async () => {
    await rolledBack(async () => {
      await owners(["grade_notice"], "cockpit");
      await q(
        "UPDATE public.cockpit_slack_notice_settings SET enabled=false WHERE kind='checkin.grade'",
      );
      const r = await response();
      const id = await gradeNotice(r, null);
      expect((await claim(id)).rows).toEqual([]);
      expect(await notice(id)).toMatchObject({
        state: "muted",
        error: "Turned off in Settings, Notices and routing.",
      });
    });
  });

  test("1b: a grade notice 48 hours after the send is skipped as too old", async () => {
    await rolledBack(async () => {
      await owners(["grade_notice"], "cockpit");
      const r = await response({ submitted: ago(48 * 60 + 1) });
      await meeting(r.rec);
      const id = await gradeNotice(r, await gradeDraft(r.rec), {
        submittedAt: ago(48 * 60 + 1),
      });
      await effect(r.id, "grade_notice", "slack_notice", "queued", id);
      expect((await claim(id)).rows).toEqual([]);
      expect(await notice(id)).toMatchObject({
        state: "skipped",
        error:
          "This notice was more than 48 hours old by the time the cockpit could send it, so it was not posted.",
      });
    });
  });
});

describe("the recap reminder (the sweep, step 1d)", () => {
  /** A live response whose recap waits on its message; the call ended `endedMin` minutes ago. */
  async function waiting(
    opts: {
      endedMin?: number;
      submittedMin?: number;
      state?: string;
      effectState?: string;
      mode?: "live" | "shadow";
    } = {},
  ) {
    if (opts.mode !== "shadow") await owners(["recap"], "cockpit");
    const r = await response({
      endsAt: ago(opts.endedMin ?? 25 * 60),
      submitted: ago(opts.submittedMin ?? 25 * 60 - 10),
      mode: opts.mode,
    });
    if (opts.mode === "shadow") {
      await effect(r.id, "recap", "client_message", "dry_run", null, "shadow");
      return r;
    }
    const msg =
      opts.state === "none" ? null : await message(r.id, opts.state ?? "draft");
    await effect(
      r.id,
      "recap",
      "client_message",
      opts.effectState ?? (opts.state === "none" ? "planned" : "queued"),
      msg,
    );
    return r;
  }
  const sweep = () =>
    q<{ r: Row }>("SELECT public.cockpit_slack_notice_sweep_checkin() r").then(
      x => x[0].r,
    );
  const lates = () =>
    q(
      "SELECT dedupe_key, task_id, client_name, facts, state FROM public.cockpit_slack_notices WHERE kind='checkin.recap_late'",
    );

  test("queues once, 24 hours after the later of the call's end and the send, with ids and times only", async () => {
    await rolledBack(async () => {
      const r = await waiting({ endedMin: 26 * 60, submittedMin: 25 * 60 });
      expect(await sweep()).toEqual({ queued: 1 });
      const rows = await lates();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        dedupe_key: `recap_late:${r.id}`,
        task_id: A,
        client_name: "Acme Interiors",
        state: "queued",
      });
      expect(Object.keys(rows[0].facts).sort()).toEqual([
        "callAt",
        "client",
        "dueAt",
        "responseId",
        "taskId",
      ]);
      expect(rows[0].facts.responseId).toBe(r.id);
      // The send was later than the call's end: due 24 hours after the send.
      const due = Date.parse(rows[0].facts.dueAt);
      expect(
        Math.abs(due - (Date.parse(ago(25 * 60)) + 24 * 3600_000)),
      ).toBeLessThan(120_000);
      // Twice: nothing more.
      expect(await sweep()).toEqual({ queued: 0 });
      expect(await lates()).toHaveLength(1);
    });
  });

  test("an approved, refused or failed message, and a recap with no message yet, are reminded", async () => {
    for (const opts of [
      { state: "approved" },
      { state: "refused" },
      { state: "failed", effectState: "failed" },
      { state: "none" },
    ]) {
      await rolledBack(async () => {
        await waiting(opts);
        expect(await sweep()).toEqual({ queued: 1 });
      });
    }
  });

  test("never for a shadow run, a sent, skipped or unknown message, a failed recap with no message, too early or too late", async () => {
    for (const opts of [
      { mode: "shadow" as const },
      { state: "sent", effectState: "delivered" },
      { state: "skipped", effectState: "queued" },
      { state: "unknown", effectState: "unknown" },
      { state: "none", effectState: "failed" },
      { endedMin: 23 * 60, submittedMin: 23 * 60 },
      { endedMin: 49 * 60, submittedMin: 49 * 60 },
    ]) {
      await rolledBack(async () => {
        await waiting(opts);
        expect(await sweep()).toEqual({ queued: 0 });
        expect(await lates()).toEqual([]);
      });
    }
  });

  test("not again after its message is skipped, nor once its own reminder is skipped", async () => {
    await rolledBack(async () => {
      const r = await waiting();
      expect(await sweep()).toEqual({ queued: 1 });
      const msg = (
        await q<{ id: string }>(
          "SELECT id FROM public.cockpit_client_messages WHERE response_id=$1",
          [r.id],
        )
      )[0].id;
      await q(
        "UPDATE public.cockpit_client_messages SET state='skipped' WHERE id=$1",
        [msg],
      );
      expect(await sweep()).toEqual({ queued: 0 });
    });
  });

  test("the registry's owner decides: an effect row that says cockpit queues nothing while the registry says otherwise", async () => {
    for (const owner of ["shadow", "make"]) {
      await rolledBack(async () => {
        await waiting();
        await owners(["recap"], owner);
        expect([owner, await sweep()]).toEqual([owner, { queued: 0 }]);
        expect(await lates()).toEqual([]);
      });
    }
    // The same row is reminded as soon as the registry says cockpit.
    await rolledBack(async () => {
      await waiting();
      await owners(["recap"], "cockpit");
      expect(await sweep()).toEqual({ queued: 1 });
    });
  });

  test("while the provider is typeform nothing is reminded: cockpit owners alone queue nothing, and a queued reminder is skipped at the claim", async () => {
    await rolledBack(async () => {
      const r = await waiting();
      await q(
        "UPDATE public.cockpit_forms SET provider = 'typeform' WHERE key = 'checkin'",
      );
      expect(await sweep()).toEqual({ queued: 0 });
      expect(await lates()).toEqual([]);
      const id = await recapLate(r.id, ago(10));
      expect((await claim(id)).rows).toEqual([]);
      expect(await notice(id)).toMatchObject({
        state: "skipped",
        error: "Make owns this again.",
      });
    });
  });

  test("a recap sent before the latest cut-over is never reminded: the second window does not take in the first hour's rows", async () => {
    const lateFor = (id: string) =>
      count(
        "SELECT count(*) n FROM public.cockpit_slack_notices WHERE dedupe_key = 'recap_late:' || $1",
        [id],
      );
    await rolledBack(async () => {
      // A first-hour recap and one from the new window, both past due and in the 24 hours.
      const old = await waiting({ endedMin: 30 * 60, submittedMin: 29 * 60 });
      const fresh = await waiting({ endedMin: 26 * 60, submittedMin: 25 * 60 });
      await q(
        "UPDATE public.cockpit_forms SET provider_since = now() - interval '27 hours' WHERE key = 'checkin'",
      );
      expect(await sweep()).toEqual({ queued: 1 });
      expect(await lateFor(old.id)).toBe(0);
      expect(await lateFor(fresh.id)).toBe(1);
      // The rule the dispatch and the waiting list use: at the very moment is inside.
      await q(
        "UPDATE public.cockpit_forms SET provider_since = (SELECT submitted_at FROM public.cockpit_form_responses WHERE id = $1) WHERE key = 'checkin'",
        [old.id],
      );
      expect(await sweep()).toEqual({ queued: 1 });
      expect(await lateFor(old.id)).toBe(1);
    });
    // A rollback and a second cut-over after both: nothing.
    await rolledBack(async () => {
      await waiting();
      await q(
        "UPDATE public.cockpit_forms SET provider_since = now() - interval '1 minute' WHERE key = 'checkin'",
      );
      expect(await sweep()).toEqual({ queued: 0 });
      expect(await lates()).toEqual([]);
    });
  });

  test("the claim skips it once the recap was sent or skipped, or Make owns the recap again", async () => {
    for (const [state, owner, error] of [
      ["sent", "cockpit", "The recap was sent before this reminder went out."],
      [
        "skipped",
        "cockpit",
        "The recap was skipped, so no reminder was posted.",
      ],
      ["draft", "shadow", "Make owns this again."],
    ] as const) {
      await rolledBack(async () => {
        const r = await waiting({
          state:
            state === "skipped" ? "draft" : state === "sent" ? "sent" : "draft",
          effectState: state === "sent" ? "delivered" : "queued",
        });
        await owners(["recap"], owner);
        if (state === "skipped")
          await q(
            "UPDATE public.cockpit_client_messages SET state='skipped' WHERE response_id=$1",
            [r.id],
          );
        const id = await recapLate(r.id, ago(10));
        expect((await claim(id)).rows).toEqual([]);
        expect(await notice(id)).toMatchObject({ state: "skipped", error });
      });
    }
  });

  test("a waiting recap is claimed with where it is now; 48 hours after its due time it is too old", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const r = await waiting();
      const id = await recapLate(r.id, ago(10));
      const row = (await claim(id)).rows[0];
      expect(row).toMatchObject({
        kind: "checkin.recap_late",
        target: CSM_GENERAL,
        live: { recap: { effectState: "queued", messageState: "draft" } },
      });
      const old = await recapLate((await waiting()).id, ago(48 * 60 + 1));
      expect((await claim(old)).rows).toEqual([]);
      expect(await notice(old)).toMatchObject({
        state: "skipped",
        error:
          "This notice was more than 48 hours old by the time the cockpit could send it, so it was not posted.",
      });
    });
  });

  test("the kick runs the reminder sweep and the effects kick at its top, each noted when it fails", async () => {
    await rolledBack(async () => {
      await waiting();
      // A stand-in effects kick (20261029w's own, when in the tree, is tested by the db builder).
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_form_effects_kick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
               BEGIN
                 INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at) VALUES ('test-effects-kick', now(), true, 'Ran.', now())
                 ON CONFLICT (key) DO UPDATE SET note = 'Ran again.';
                 RETURN '{}'::jsonb;
               END $$`);
      await q("SELECT public.cockpit_slack_notices_kick()");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_slack_notices WHERE kind='checkin.recap_late'",
        ),
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_sync_state WHERE key='test-effects-kick'",
        ),
      ).toBe(1);
      // Both broken: noted with the queue's failures; the Stage 1 note is still written.
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_form_effects_kick() RETURNS jsonb LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'invented effects failure'; END $$`);
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_sweep_checkin() RETURNS jsonb LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'invented reminder failure'; END $$`);
      await q("SELECT public.cockpit_slack_notices_kick()");
      const note = (
        await q<{ note: string }>(
          "SELECT note FROM public.cockpit_sync_state WHERE key='slack-notices-queue'",
        )
      )[0].note;
      expect(note).toBe("The 1-1 notes sweep failed: invented effects failure");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_sync_state WHERE key='slack-notices-kick'",
        ),
      ).toBe(1);
    });
  });
});

describe("reads and audit", () => {
  test("a creative-only seat never sees the 1-1 notes notices; the CSM, an admin and the CEO do", async () => {
    await rolledBack(async () => {
      const r = await response();
      await gradeNotice(r, null);
      await recapLate(r.id, ago(10));
      await q(
        "SELECT public.cockpit_slack_notice_queue('kickoff', 'kickoff:respread00001', $1, 'Acme Interiors', '{\"submittedAt\":\"2020-01-01T00:00:00Z\"}'::jsonb, NULL, 'skipped', 'Invented.')",
        [A],
      );
      const kinds = async (who: string) =>
        (
          (
            await one<Row>(
              who,
              "SELECT public.cockpit_slack_notice_read($1) r",
              [A],
            )
          ).notices as Row[]
        )
          .map(n => n.kind)
          .sort();
      expect(await kinds(CREATIVE)).toEqual(["kickoff"]);
      for (const who of [CSM, ADMIN, CEO])
        expect(await kinds(who)).toEqual([
          "checkin.grade",
          "checkin.recap_late",
          "kickoff",
        ]);
    });
  });

  test("a posted grade's audit rows hold no text, blocks or grade words", async () => {
    await rolledBack(async () => {
      await owners(["grade_notice"], "cockpit");
      const r = await response();
      await meeting(r.rec);
      const id = await gradeNotice(r, await gradeDraft(r.rec));
      await effect(r.id, "grade_notice", "slack_notice", "queued", id);
      expect((await claim(id)).rows).toHaveLength(1);
      await svc(
        "SELECT public.cockpit_slack_notice_result($1, 'posted', '1792900500.000100', $2, NULL, $3::jsonb) r",
        [
          id,
          FEEDBACK,
          JSON.stringify({
            variant: "grade",
            text: "Call grade: INVENTED-OVERALL-FEEDBACK",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "INVENTED-OVERALL-FEEDBACK" },
              },
            ],
          }),
        ],
      );
      expect((await notice(id)).state).toBe("posted");
      const audit = JSON.stringify(
        await q("SELECT * FROM public.cockpit_audit_log WHERE entity_id=$1", [
          id,
        ]),
      );
      expect(audit).toContain("slack_notice.posted");
      expect(audit).not.toContain("INVENTED-OVERALL");
      expect(audit).not.toContain("blocks");
      expect(audit).not.toContain("mrkdwn");
    });
  });
});

describe("the bodies, the grants and the drift guard", () => {
  // E5's proof (contract 4.2's fallback): slack-notices-supabase.test.ts builds only what 20261025n
  // reads, so it cannot load the 2a base (20261025o needs cockpit_blueprint_settings, 20261026r the
  // ClickUp write-back queue, 20261027f the Fathom meetings), and its exact eight-kind assertions
  // would change with 20261029u's two seeded kinds. So this case is the proof that 20261029u leaves
  // Stage 1 as it was: each replaced function is 20261025n's body with exactly the contract's edits.
  test("each of the thirteen is 20261025n's body with exactly the contract's edits (the kick: Stage 1's body plus the two blocks)", async () => {
    const stage1 = migration(N);
    expect(U_EDITS).toHaveLength(13);
    for (const [name, args, edits] of U_EDITS) {
      let text = cutFn(stage1, name);
      for (const [before, after] of edits) {
        expect(text.split(before).length - 1).toBe(1);
        // split and join: a replacement string would read "$'" in the SQL as a pattern.
        text = text.split(before).join(after);
      }
      const now = await installed(`${name}(${args})`);
      expect(norm(now.src)).toBe(norm(bodyOf(text)));
      // And the text in this migration is that same function, byte for byte.
      expect(cutFn(migration(U), name)).toBe(text);
    }
    const kick = U_EDITS.find(e => e[0] === "cockpit_slack_notices_kick");
    expect(kick?.[2]).toHaveLength(1);
    expect(
      kick?.[2][0][1].split("\n").filter(l => /^\s*(BEGIN|END;)\s*$/.test(l)),
    ).toEqual(["BEGIN", "  BEGIN", "  END;", "  BEGIN", "  END;"]);
  });

  test("the drift guard names every replaced function with 2.2's live body md5 and this file's after md5", async () => {
    const rows = driftRows(U);
    expect(rows.map(r => r.fn).sort()).toEqual(
      U_EDITS.map(([n, a]) => `${n}(${a})`).sort(),
    );
    const live: Record<string, string> = {
      cockpit_slack_notices_kick: "49fd012b2325fbaeae9d28b7ea268dd1",
      cockpit_slack_notice_claim: "b415014351f4aa144aa845cbabf6cec0",
      cockpit_slack_notice_live: "3644e7cd5eb63c7719fd5ff3666a8d84",
      cockpit_slack_notice_shape: "4c02edfc21ceaa750e57f5cea8c9e547",
      cockpit_slack_notice_kind_label: "499725dbaac9baf12f000161438c63d7",
      cockpit_slack_notice_inputs: "b4c826e37e783201fb3d777e5309b902",
      cockpit_slack_notice_doctor_inputs: "0a5c57a07e31ab08c7259dcb8f3d18f4",
      cockpit_slack_notice_settings_read: "a6cf20c2d9129b5716de6cda89f4192d",
      cockpit_slack_notice_settings_set: "80e2a814b671a43e0e78fe95788db934",
      cockpit_slack_channel_remove: "1b21f1b259844b485b132f0a331bb97d",
      cockpit_slack_notice_rehearse: "b8264c6a7f918e76a56bf750ab46ecec",
      cockpit_slack_notice_rehearse_service: "036e4ea0b8088ff3b259b229ef79a0ec",
      cockpit_slack_notice_read: "4ae835e5809a599d0e4af167b8153dc0",
    };
    for (const r of rows) {
      expect(r.live).toBe(live[r.fn.split("(")[0]]);
      expect((await installed(r.fn)).md5).toBe(r.after);
      // 20261025n's body is the one the contract read live (2.2's body md5).
      const stage1 = bodyOf(cutFn(migration(N), r.fn.split("(")[0]));
      expect(
        (
          await q<{ m: string }>(
            "SELECT md5(regexp_replace($1, '\\s+', ' ', 'g')) m",
            [stage1],
          )
        )[0].m,
      ).toBe(r.live);
    }
  });

  test("the ACLs of 2.2 are kept, and the new sweep is the owner's alone", async () => {
    for (const [sig, acl] of Object.entries(ACL))
      expect([sig, (await installed(sig)).acl]).toEqual([sig, acl]);
    for (const role of ["anon", "authenticated", "service_role"])
      expect(
        (
          await q<{ ok: boolean }>(
            "SELECT has_function_privilege($1, 'public.cockpit_slack_notice_sweep_checkin()', 'EXECUTE') ok",
            [role],
          )
        )[0].ok,
      ).toBe(false);
  });

  test("the drift guard refuses a body changed since the contract read it, and nothing applies", async () => {
    await asOwner();
    const standIn = `CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_shape(p_kind text)
      RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 'post'::text $$;`;
    let error: { code?: string; message: string } | null = null;
    try {
      await db.exec(`BEGIN;\n${standIn}\n${inner(U)}`);
    } catch (e) {
      error = e as { code?: string; message: string };
    }
    await db.exec("ROLLBACK");
    expect(error?.code).toBe("55000");
    expect(error?.message).toBe(
      "cockpit_slack_notice_shape(text) changed since the 2b contract read it; stop and re-read it.",
    );
    expect(
      await q("SELECT public.cockpit_slack_notice_shape('checkin.grade') s"),
    ).toEqual([{ s: "post" }]);
    expect(
      await q("SELECT public.cockpit_slack_notice_shape('rehearsal') s"),
    ).toEqual([{ s: "test" }]);
  });

  test("each CHECK's drift guard refuses a definition it did not read, and widens only the one it read", async () => {
    const block = (() => {
      const sql = migration(U);
      const from = sql.indexOf("-- 1. The two kinds in the CHECKs");
      const to = sql.indexOf("-- 2. #client-call-feedback");
      expect(from).toBeGreaterThan(0);
      expect(to).toBeGreaterThan(from);
      return sql.slice(from, to);
    })();
    const apply = () =>
      guarded(async () => {
        await asOwner();
        await db.exec(block);
      });
    const typed = (kinds: string[]) =>
      kinds.map(k => `'${k}'::text`).join(", ");
    const named = (kinds: string[]) => kinds.map(k => `'${k}'`).join(",");
    const NEW_KINDS = ["checkin.grade", "checkin.recap_late"];
    const SETTINGS = "public.cockpit_slack_notice_settings";
    const CHECKS = [
      {
        table: SETTINGS,
        name: "cockpit_slack_notice_settings_kind_check",
        read: "CHECK ((kind = ANY (ARRAY['kickoff'::text, 'kickoff.late'::text, 'kickoff.second'::text, 'kickoff.updated'::text, 'blueprint.close'::text, 'blueprint.updated'::text, 'blueprint.media'::text, 'blueprint.offer'::text])))",
        kinds: [
          "kickoff",
          "kickoff.late",
          "kickoff.second",
          "kickoff.updated",
          "blueprint.close",
          "blueprint.updated",
          "blueprint.media",
          "blueprint.offer",
        ],
        rule: (list: string) => `kind IN (${list})`,
        def: (list: string) => `CHECK ((kind = ANY (ARRAY[${list}])))`,
      },
      {
        table: SETTINGS,
        name: "cockpit_slack_notice_settings_check",
        read: "CHECK (((kind = ANY (ARRAY['kickoff'::text, 'blueprint.close'::text, 'blueprint.media'::text])) = (channel IS NOT NULL)))",
        kinds: ["kickoff", "blueprint.close", "blueprint.media"],
        rule: (list: string) => `(kind IN (${list})) = (channel IS NOT NULL)`,
        def: (list: string) =>
          `CHECK (((kind = ANY (ARRAY[${list}])) = (channel IS NOT NULL)))`,
      },
      {
        table: "public.cockpit_slack_notices",
        name: "cockpit_slack_notices_kind_check",
        read: "CHECK ((kind = ANY (ARRAY['kickoff'::text, 'kickoff.updated'::text, 'blueprint.close'::text, 'blueprint.updated'::text, 'blueprint.media'::text, 'blueprint.offer'::text, 'rehearsal'::text])))",
        kinds: [
          "kickoff",
          "kickoff.updated",
          "blueprint.close",
          "blueprint.updated",
          "blueprint.media",
          "blueprint.offer",
          "rehearsal",
        ],
        rule: (list: string) => `kind IN (${list})`,
        def: (list: string) => `CHECK ((kind = ANY (ARRAY[${list}])))`,
      },
    ];
    type Guarded = (typeof CHECKS)[number];
    const def = async (c: Guarded) =>
      (
        await q<{ d: string }>(
          `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
            WHERE conrelid = '${c.table}'::regclass AND conname = '${c.name}'`,
        )
      )[0]?.d ?? null;
    const oid = async (c: Guarded) =>
      (
        await q<{ o: string }>(
          `SELECT oid::text o FROM pg_constraint
            WHERE conrelid = '${c.table}'::regclass AND conname = '${c.name}'`,
        )
      )[0]?.o ?? null;
    const set = (c: Guarded, kinds: string[]) =>
      guarded(async () => {
        await asOwner();
        await db.exec(
          `ALTER TABLE ${c.table} DROP CONSTRAINT IF EXISTS ${c.name};
           ALTER TABLE ${c.table} ADD CONSTRAINT ${c.name} CHECK (${c.rule(named(kinds))});`,
        );
      });
    const widened = (c: Guarded) => c.def(typed([...c.kinds, ...NEW_KINDS]));
    const refusal = (c: Guarded) =>
      refusalOf(async () => {
        await asOwner();
        await db.exec(block);
      }, c.name);

    await rolledBack(async () => {
      // Already widened: nothing is dropped.
      for (const c of CHECKS) {
        const before = await oid(c);
        await apply();
        expect(await oid(c)).toBe(before);
        expect(await def(c)).toBe(widened(c));
      }
      // What the contract read is widened. The seeded rows go first: the read
      // CHECKs do not allow them. Each read text here is live's, word for word.
      await guarded(async () => {
        await asOwner();
        await db.exec(
          `ALTER TABLE ${SETTINGS} DISABLE TRIGGER USER;
           DELETE FROM ${SETTINGS} WHERE kind LIKE 'checkin.%';
           ALTER TABLE ${SETTINGS} ENABLE TRIGGER USER;`,
        );
      });
      for (const c of CHECKS) {
        await set(c, c.kinds);
        expect(await def(c)).toBe(c.read);
      }
      await apply();
      for (const c of CHECKS) expect(await def(c)).toBe(widened(c));

      const refused = (c: Guarded) => ({
        code: "55000",
        message: `${c.name} changed since the 2b contract read it; stop and re-read it.`,
      });
      for (const c of CHECKS) {
        // Another session's kind stays, and the file stops.
        await set(c, [...c.kinds, "another_session"]);
        const theirs = await def(c);
        expect(await refusal(c)).toEqual(refused(c));
        expect(await def(c)).toBe(theirs);
        await set(c, [...c.kinds, ...NEW_KINDS, "another_session"]);
        expect(await refusal(c)).toEqual(refused(c));
        // No constraint at all is not what the contract read either.
        await guarded(async () => {
          await asOwner();
          await db.exec(`ALTER TABLE ${c.table} DROP CONSTRAINT ${c.name};`);
        });
        expect(await refusal(c)).toEqual(refused(c));
        // Back to widened, so the next CHECK's refusal is its own.
        await set(c, [...c.kinds, ...NEW_KINDS]);
        expect(await def(c)).toBe(widened(c));
      }
    });
  });

  test("applying the file again changes no function, grant, row or seed", async () => {
    const snapshot = async () => ({
      fns: await q(
        "SELECT p.oid::regprocedure::text s, md5(pg_get_functiondef(p.oid)) m, p.proacl::text a FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1",
      ),
      settings: await q(
        "SELECT * FROM public.cockpit_slack_notice_settings ORDER BY kind",
      ),
      channels: await q(
        "SELECT id, name, private, state FROM public.cockpit_slack_channels ORDER BY id",
      ),
      notices: await count(
        "SELECT count(*) n FROM public.cockpit_slack_notices",
      ),
      seeded: await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='notices.setting_seeded'",
      ),
      checks: await q(
        "SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid IN ('public.cockpit_slack_notices'::regclass, 'public.cockpit_slack_notice_settings'::regclass) ORDER BY 1",
      ),
    });
    const before = await snapshot();
    await asOwner();
    await db.exec(migration(U));
    expect(await snapshot()).toEqual(before);
  });
});

describe("with 20261029v (and 20261029w once it is in the tree): the outbox and the effect agree", () => {
  beforeAll(async () => {
    await asOwner();
    await db.exec(migration(MESSAGES));
    await db.exec(migration(MESSAGES));
    if (HAS_DISPATCH) {
      await db.exec(migration(DISPATCH));
      await db.exec(migration(DISPATCH));
    }
  }, 120_000);

  test("u's functions are untouched by v and w, and the sweep reads v's messages", async () => {
    for (const r of driftRows(U))
      expect((await installed(r.fn)).md5).toBe(r.after);
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const r = await response({
        endsAt: ago(26 * 60),
        submitted: ago(25 * 60),
      });
      const msg = await message(r.id, "refused");
      await effect(r.id, "recap", "client_message", "queued", msg);
      expect(
        await q<{ r: Row }>(
          "SELECT public.cockpit_slack_notice_sweep_checkin() r",
        ).then(x => x[0].r),
      ).toEqual({ queued: 1 });
    });
  });

  test.if(HAS_DISPATCH)(
    "a grade notice the claim skips moves its effect to skipped with the gate's reason (3.6)",
    async () => {
      await rolledBack(async () => {
        const r = await response();
        await meeting(r.rec);
        const id = await gradeNotice(r, await gradeDraft(r.rec));
        const eff = await effect(
          r.id,
          "grade_notice",
          "slack_notice",
          "queued",
          id,
        );
        expect((await claim(id)).rows).toEqual([]);
        expect(
          (
            await q(
              "SELECT state, reason FROM public.cockpit_form_effects WHERE id=$1",
              [eff],
            )
          )[0],
        ).toEqual({
          state: "skipped",
          reason: "Make owns this again.",
        });
      });
    },
  );

  test.if(HAS_DISPATCH)(
    "a grade notice that fails at (iii) fails its effect with the notice's sentence",
    async () => {
      await rolledBack(async () => {
        await owners(["grade_notice"], "cockpit");
        const r = await response();
        await meeting(r.rec);
        const id = await gradeNotice(r, null);
        const eff = await effect(
          r.id,
          "grade_notice",
          "slack_notice",
          "queued",
          id,
        );
        expect((await claim(id)).rows).toEqual([]);
        expect(
          (
            await q(
              "SELECT state, reason FROM public.cockpit_form_effects WHERE id=$1",
              [eff],
            )
          )[0],
        ).toEqual({
          state: "failed",
          reason:
            "The call's grade is not in the cockpit, so nothing was posted. Tell the tech lead.",
        });
      });
    },
  );
});
