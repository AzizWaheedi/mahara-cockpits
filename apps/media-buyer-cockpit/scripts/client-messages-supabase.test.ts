/**
 * Client messages (20261029v_forms_client_messages.sql,
 * docs/forms/STAGE2B-CONTRACT.md 2.6, 3.7 and 4.3, build 3a) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * an object here as it would in production.
 *
 * It applies the 2a base as live (as checkin-notices-supabase.test.ts and the
 * Stage 2a fit build it: 20261025n, 20261025o, 20261026r, s and t, then
 * 20261027f, g and h), then 20261029s_forms_registry.sql once and
 * 20261029v_forms_client_messages.sql twice. The trigger cases at the end add
 * 20261029t, 20261029u and 20261029w_forms_dispatch.sql in letter order, each
 * twice, so the settle trigger moves the effect from the message's state
 * (contract 3.6). The WhatsApp inbox tables are cut from 20260920b and
 * 20261005g. Every person, client, group and message here is invented;
 * nothing reaches WhatsApp.
 *
 * The body-diff rule (contract 2.2): the guard is 20261027f's body with
 * exactly the three edits below, written as literal before/after pairs.
 * PGlite has one session, so the claim's advisory lock is proved by its text
 * (a second session's claim answers busy).
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
const NOTICES = "20261029u_forms_checkin_notices.sql";
const V = "20261029v_forms_client_messages.sql";
const DISPATCH = "20261029w_forms_dispatch.sql";

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
const CSM_B = "00000000-0000-4000-8000-0000000000b1"; // a csm seat, Beta only
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative only

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build
const GROUP = "120363000000000001@g.us"; // an invented group id

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
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return guarded(async () => {
    await asService();
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  });
}
async function svcRefused(
  text: string,
  params: unknown[] = [],
): Promise<Refusal> {
  return refusalOf(async () => {
    await asService();
    await db.query(text, params);
  }, text);
}
async function ownerRefused(
  text: string,
  params: unknown[] = [],
): Promise<Refusal> {
  return refusalOf(() => db.query(text, params), text);
}
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

// --- The guard's three edits (contract 4.3, 3a), literal before/after pairs on 20261027f's text --

const GUARD_EDITS: [string, string, [string, string][]][] = [
  [
    `cockpit_client_messages_guard`,
    ``,
    [
      [
        `    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id`,
        `    IF NEW.body_sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(NEW.body, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'The text and its fingerprint differ.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id`,
      ],
      [
        `    OR (OLD.state = 'unknown' AND NEW.state = 'failed' AND v_fix)) THEN`,
        `    OR (OLD.state = 'unknown' AND NEW.state = 'failed' AND v_fix)
    -- 2b: a person reopens a refused message, or a failed one as a fix, and
    -- may skip either; nothing ever leaves unknown or sent this way.
    OR (OLD.state = 'refused' AND NEW.state IN ('draft','skipped'))
    OR (OLD.state = 'failed' AND NEW.state = 'skipped')
    OR (OLD.state = 'failed' AND NEW.state = 'draft' AND v_fix)) THEN`,
      ],
      [
        `    RAISE EXCEPTION 'An approved message keeps its text' USING ERRCODE = '55000';
  END IF;
`,
        `    RAISE EXCEPTION 'An approved message keeps its text' USING ERRCODE = '55000';
  END IF;
  IF (NEW.body IS DISTINCT FROM OLD.body OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256)
     AND NEW.body_sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(NEW.body, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'The text and its fingerprint differ.' USING ERRCODE = '55000';
  END IF;
`,
      ],
    ],
  ],
];

/** The seats, the people, the roster, and the WhatsApp inbox tables team_today reads. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await q(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Beta Build"], CSM_B],
  );
  for (const [name, email, role] of [
    ["Noura Test", CSM_EMAIL, "Client success manager"],
    ["Sara Test", "csm-b@tests.invalid", "Client success manager"],
    ["Omar Test", "creative@tests.invalid", "Creative strategist"],
    ["Chief Test", CEO_EMAIL, "CEO"],
  ])
    await q(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );
  const snap = "2026-10-28T08:00:00Z";
  const clients = [
    [A, "Acme Interiors"],
    [B, "Beta Build"],
  ] as const;
  for (const [taskId, name] of clients)
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name }),
        snap,
      ],
    );
  await q(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [clients.length, snap],
  );
  const inbox = migration("20260920b_wa_inbox.sql");
  await db.exec(
    cut(
      inbox,
      /create table if not exists public\.wa_threads \([\s\S]*?\n\);/,
      "wa_threads",
    ),
  );
  await db.exec(
    cut(
      inbox,
      /create table if not exists public\.wa_messages \([\s\S]*?\n\);/,
      "wa_messages",
    ),
  );
  await db.exec(
    cut(
      migration("20261005g_cockpit_native_whatsapp.sql"),
      /ALTER TABLE public\.wa_threads ADD COLUMN IF NOT EXISTS provider_id text;[\s\S]*?ALTER TABLE public\.wa_messages ADD COLUMN IF NOT EXISTS speaker text;/,
      "wa columns",
    ),
  );
  await db.exec(`ALTER TABLE public.wa_threads ENABLE ROW LEVEL SECURITY; ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.wa_threads, public.wa_messages FROM anon, authenticated;`);
}

// --- Fixtures ----------------------------------------------------------------------------------

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

let recSeq = 900000800;
async function response(task = A, client = "Acme Interiors"): Promise<string> {
  const rec = String(recSeq++);
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, task_id, client_name, mode, state, answers,
       created_by, created_by_id, submitted_by, submitted_at)
     VALUES('checkin', 1, 'cockpit', $1, $2, 'live', 'submitted', $3::jsonb, $4, $5, $4, now()) RETURNING id`,
    [
      task,
      client,
      JSON.stringify({
        call: {
          kind: "fathom",
          recordingId: rec,
          startsAt: "2026-10-25T07:00:00Z",
          endsAt: "2026-10-25T07:30:00Z",
        },
      }),
      CSM_EMAIL,
      CSM,
    ],
  );
  return id;
}

const PATH: Record<string, string[]> = {
  draft: [],
  approved: ["approved"],
  claimed: ["approved", "claimed"],
  sending: ["approved", "claimed", "sending"],
  refused: ["approved", "claimed", "refused"],
  failed: ["approved", "claimed", "sending", "failed"],
  unknown: ["approved", "claimed", "sending", "unknown"],
  sent: ["approved", "claimed", "sending", "sent"],
  skipped: ["skipped"],
};
const STATES = Object.keys(PATH);
const BODY = (n: string) =>
  `مرحبا، هذا ملخص تجريبي ${n}.\n\nInvented recap ${n}.`;

/**
 * A recap message of a live response with the queued effect that points at it,
 * moved to `state` through the guard's own moves. The registry's recap owner is
 * the caller's to set.
 */
async function recap(
  state = "draft",
  opts: {
    task?: string;
    kind?: string;
    approver?: string;
    createdAt?: string;
  } = {},
) {
  const task = opts.task ?? A;
  const responseId = await response(
    task,
    task === A ? "Acme Interiors" : "Beta Build",
  );
  const body = BODY(responseId.slice(0, 8));
  const [{ id }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, response_id, body, body_sha256, created_at)
     VALUES($1::text || ':recap', $2, $3, $4, $1::uuid, $5, $6, coalesce($7::timestamptz, now())) RETURNING id`,
    [
      responseId,
      task,
      task === A ? "Acme Interiors" : "Beta Build",
      opts.kind ?? "recap_checkin",
      body,
      sha256(body),
      opts.createdAt ?? null,
    ],
  );
  const [{ id: effectId }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
     VALUES($1::uuid, 'checkin', 'recap', $1::text || ':recap', 'cockpit', 'client_message', '{}'::jsonb, 'planned') RETURNING id`,
    [responseId],
  );
  await q(
    "UPDATE public.cockpit_form_effects SET state='queued', delivery_ref=$2 WHERE id=$1",
    [effectId, id],
  );
  for (const step of PATH[state]) await move(id, step, opts.approver);
  return { id, responseId, effectId, body };
}
/** One move as the sender's RPCs would leave the columns. */
async function move(id: string, to: string, approver = CSM_EMAIL) {
  await q(
    `UPDATE public.cockpit_client_messages SET state = $2,
            approved_by = CASE WHEN $2 = 'approved' THEN $3 ELSE approved_by END,
            approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
            expires_at = CASE WHEN $2 = 'approved' THEN now() + interval '24 hours' ELSE expires_at END,
            claim_token = CASE WHEN $2 = 'claimed' THEN gen_random_uuid() ELSE claim_token END,
            claimed_at = CASE WHEN $2 = 'claimed' THEN now() ELSE claimed_at END,
            intent_at = CASE WHEN $2 = 'sending' THEN now() ELSE intent_at END,
            attempts = CASE WHEN $2 = 'sending' THEN attempts + 1 ELSE attempts END,
            provider_id = CASE WHEN $2 = 'sent' THEN 'wamid-test-0001' ELSE provider_id END,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
            reason = CASE WHEN $2 IN ('refused','failed','unknown') THEN 'Invented reason for ' || $2 || '.' ELSE reason END
      WHERE id = $1`,
    [id, to, approver],
  );
}
async function row(id: string): Promise<Row> {
  return (
    await q("SELECT * FROM public.cockpit_client_messages WHERE id=$1", [id])
  )[0];
}
async function effectOf(id: string): Promise<Row> {
  return (
    await q(
      "SELECT state, reason FROM public.cockpit_form_effects WHERE id=$1",
      [id],
    )
  )[0];
}
const approve = (
  id: string,
  body: string,
  opts: { hash?: string; actor?: string; warnings?: string[] } = {},
) =>
  `SELECT public.cockpit_client_message_approve('${id}'::uuid, ${dollar(body)}, '${opts.hash ?? sha256(body)}', '${opts.actor ?? CSM}'::uuid, ${
    opts.warnings
      ? `ARRAY[${opts.warnings.map(dollar).join(",")}]::text[]`
      : "NULL"
  }) AS r`;
const dollar = (s: string) => `$m$${s}$m$`;
const claimSql = (
  kinds = ["recap_checkin"],
  cards: string[] | null = null,
  limit = 1,
) =>
  `SELECT public.cockpit_client_message_claim(ARRAY[${kinds.map(k => `'${k}'`).join(",")}]::text[], ${
    cards === null
      ? "NULL"
      : `ARRAY[${cards.map(c => `'${c}'`).join(",")}]::text[]`
  }, ${limit}) AS r`;
async function claimOne(): Promise<Row> {
  return svc(claimSql());
}

/** Try a direct move as the owner, inside its own savepoint: true when the guard let it through. */
async function tryMove(id: string, to: string, fix = false): Promise<boolean> {
  await db.exec("SAVEPOINT try_move");
  try {
    if (fix)
      await db.query("SELECT set_config('cockpit.forms_fix', 'on', true)");
    await db.query(
      `UPDATE public.cockpit_client_messages
          SET state = $2, claim_token = coalesce(claim_token, gen_random_uuid()), provider_id = coalesce(provider_id, 'wamid-try')
        WHERE id = $1`,
      [id, to],
    );
    return true;
  } catch {
    return false;
  } finally {
    await db.exec("ROLLBACK TO SAVEPOINT try_move");
  }
}

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

const AUTH = "{postgres=X/postgres,authenticated=X/postgres}";
const SVC = "{postgres=X/postgres,service_role=X/postgres}";
const OWNER = "{postgres=X/postgres}";
const ACL: Record<string, string> = {
  "cockpit_client_messages_guard()": OWNER,
  "cockpit_client_message_view(public.cockpit_client_messages)": OWNER,
  "cockpit_client_messages_read(text)": AUTH,
  "cockpit_client_messages_waiting()": AUTH,
  "cockpit_client_message_read(uuid)": AUTH,
  "cockpit_client_message_skip(uuid,text)": AUTH,
  "cockpit_client_message_reopen(uuid)": AUTH,
  "cockpit_client_message_approve(uuid,text,text,uuid,text[])": SVC,
  "cockpit_client_message_claim(text[],text[],integer)": SVC,
  "cockpit_client_message_intent(uuid,uuid)": SVC,
  "cockpit_client_message_result(uuid,uuid,text,text,text,jsonb)": SVC,
  "cockpit_client_message_sweep()": SVC,
  "cockpit_client_message_work(integer)": SVC,
  "cockpit_client_message_fix(uuid,text,text)": SVC,
  "cockpit_client_message_team_today(text)": SVC,
};
const VIEW_KEYS = [
  "approvedAt",
  "approvedBy",
  "body",
  "callAt",
  "clientName",
  "effectState",
  "expiresAt",
  "id",
  "kind",
  "owner",
  "readBack",
  "reason",
  "responseId",
  "sentAt",
  "state",
  "taskId",
];

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await standOn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of [N, O, R, S2A, T2A, V2A, W2A, X2A])
    await db.exec(migration(file));
  await db.exec(migration(REGISTRY));
  await db.exec(migration(V));
  await db.exec(migration(V));
}, 300_000);
afterAll(async () => {
  await db?.close();
});

describe("the guard", () => {
  test("the move matrix: 2a's moves, the four new ones, and nothing out of unknown, sent or skipped", async () => {
    const allowed = new Set([
      "draft>approved",
      "draft>skipped",
      "approved>claimed",
      "approved>draft",
      "approved>skipped",
      "claimed>sending",
      "claimed>approved",
      "claimed>refused",
      "sending>sent",
      "sending>failed",
      "sending>unknown",
      "unknown>sent",
      // 2b: a person reopens a refused message and may skip a refused or failed one.
      "refused>draft",
      "refused>skipped",
      "failed>skipped",
    ]);
    const withFix = new Set([...allowed, "unknown>failed", "failed>draft"]);
    await rolledBack(async () => {
      for (const from of STATES) {
        const { id } = await recap(from);
        for (const to of STATES.filter(s => s !== from)) {
          expect([from, to, await tryMove(id, to)]).toEqual([
            from,
            to,
            allowed.has(`${from}>${to}`),
          ]);
          expect([from, to, "fix", await tryMove(id, to, true)]).toEqual([
            from,
            to,
            "fix",
            withFix.has(`${from}>${to}`),
          ]);
        }
      }
    });
  });

  test("the fingerprint: on insert, and whenever the text or the fingerprint changes", async () => {
    await rolledBack(async () => {
      const bad = await ownerRefused(
        `INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, kind, body, body_sha256) VALUES('fp:1', $1, 'recap_checkin', 'Invented.', $2)`,
        [A, sha256("Something else.")],
      );
      expect(bad).toEqual({
        code: "55000",
        message: "The text and its fingerprint differ.",
      });
      const { id } = await recap("draft");
      expect(
        (
          await ownerRefused(
            "UPDATE public.cockpit_client_messages SET body = 'Edited.' WHERE id=$1",
            [id],
          )
        ).message,
      ).toBe("The text and its fingerprint differ.");
      expect(
        (
          await ownerRefused(
            "UPDATE public.cockpit_client_messages SET body_sha256 = $2 WHERE id=$1",
            [id, sha256("x")],
          )
        ).message,
      ).toBe("The text and its fingerprint differ.");
      await q(
        "UPDATE public.cockpit_client_messages SET body = 'Edited.', body_sha256 = $2 WHERE id=$1",
        [id, sha256("Edited.")],
      );
      // An approved text never changes, whatever its fingerprint.
      await move(id, "approved");
      expect(
        (
          await ownerRefused(
            "UPDATE public.cockpit_client_messages SET body = 'Again.', body_sha256 = $2 WHERE id=$1",
            [id, sha256("Again.")],
          )
        ).message,
      ).toBe("An approved message keeps its text");
    });
  });

  test("the body is 20261027f's with exactly the three edits; the drift guard names it with 2.2's md5s", async () => {
    let text = cutFn(migration(V2A), "cockpit_client_messages_guard");
    expect(GUARD_EDITS).toHaveLength(1);
    for (const [before, after] of GUARD_EDITS[0][2]) {
      expect(text.split(before).length - 1).toBe(1);
      text = text.split(before).join(after);
    }
    const now = await installed("cockpit_client_messages_guard()");
    expect(norm(now.src)).toBe(norm(bodyOf(text)));
    expect(cutFn(migration(V), "cockpit_client_messages_guard")).toBe(text);
    const guard = cut(
      migration(V),
      /DO \$\$\nDECLARE g record; v_now text;[\s\S]*?END \$\$;/,
      "drift guard",
    );
    const rows = [
      ...guard.matchAll(
        /\('public\.([^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
      ),
    ];
    expect(rows.map(r => [r[1], r[2]])).toEqual([
      ["cockpit_client_messages_guard()", "6a0fe60fee0be51c3d22ddcd28986bdb"],
    ]);
    expect(now.md5).toBe(rows[0][3]);
    const stage2a = bodyOf(
      cutFn(migration(V2A), "cockpit_client_messages_guard"),
    );
    expect(
      (
        await q<{ m: string }>(
          "SELECT md5(regexp_replace($1, '\\s+', ' ', 'g')) m",
          [stage2a],
        )
      )[0].m,
    ).toBe(rows[0][2]);
  });

  test("the drift guard refuses a guard changed since the contract read it, and nothing applies", async () => {
    await asOwner();
    const standIn = `CREATE OR REPLACE FUNCTION public.cockpit_client_messages_guard() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN NEW; END $$;`;
    let error: { code?: string; message: string } | null = null;
    try {
      await db.exec(`BEGIN;\n${standIn}\n${inner(V)}`);
    } catch (e) {
      error = e as { code?: string; message: string };
    }
    await db.exec("ROLLBACK");
    expect(error?.code).toBe("55000");
    expect(error?.message).toBe(
      "cockpit_client_messages_guard() changed since the 2b contract read it; stop and re-read it.",
    );
    expect((await installed("cockpit_client_messages_guard()")).src).toContain(
      "The text and its fingerprint differ.",
    );
  });

  test("the grants: the guard and the view are the owner's, five browser RPCs, eight service RPCs; the indexes exist", async () => {
    for (const [sig, acl] of Object.entries(ACL))
      expect([sig, (await installed(sig)).acl]).toEqual([sig, acl]);
    expect(
      (
        await q<{ n: string }>(
          "SELECT indexname n FROM pg_indexes WHERE tablename='cockpit_client_messages' AND indexname LIKE 'cockpit_client_messages_%' ORDER BY 1",
        )
      ).map(r => r.n),
    ).toEqual(
      expect.arrayContaining([
        "cockpit_client_messages_open",
        "cockpit_client_messages_response",
        "cockpit_client_messages_task",
      ]),
    );
    // A browser can never approve, claim or send.
    expect(
      (await refused(CSM, approve("00000000-0000-4000-8000-000000000001", "x")))
        .code,
    ).toBe("42501");
    // The table stays the service role's to read only.
    for (const p of ["INSERT", "UPDATE", "DELETE"])
      expect(
        (
          await q<{ ok: boolean }>(
            "SELECT has_table_privilege('service_role','public.cockpit_client_messages',$1) ok",
            [p],
          )
        )[0].ok,
      ).toBe(false);
  });

  test("applying the file again changes no function, grant, row or index", async () => {
    const snapshot = async () => ({
      fns: await q(
        "SELECT p.oid::regprocedure::text s, md5(pg_get_functiondef(p.oid)) m, p.proacl::text a FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1",
      ),
      idx: await q(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='cockpit_client_messages' ORDER BY 1",
      ),
      rows: await count(
        "SELECT count(*) n FROM public.cockpit_client_messages",
      ),
    });
    const before = await snapshot();
    await asOwner();
    await db.exec(migration(V));
    expect(await snapshot()).toEqual(before);
  });
});

describe("the browser RPCs", () => {
  test("a card's messages: MessageView only, gated by the client gate, newest first", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const sent = await recap("sent", { createdAt: ago(60) });
      const draft = await recap("draft");
      const read = await one<Row>(
        CSM,
        "SELECT public.cockpit_client_messages_read($1) r",
        [A],
      );
      expect(read.taskId).toBe(A);
      expect(read.messages.map((m: Row) => m.id)).toEqual([draft.id, sent.id]);
      expect(Object.keys(read.messages[1]).sort()).toEqual(VIEW_KEYS);
      expect(read.messages[1]).toMatchObject({
        state: "sent",
        kind: "recap_checkin",
        taskId: A,
        clientName: "Acme Interiors",
        responseId: sent.responseId,
        body: sent.body,
        approvedBy: "the CSM",
        callAt: "2026-10-25T07:30:00.000Z",
        owner: "cockpit",
        effectState: "queued",
        readBack: null,
      });
      // Never the claim token or WhatsApp's id.
      const token = (await row(sent.id)).claim_token;
      expect(JSON.stringify(read)).not.toContain(token);
      expect(JSON.stringify(read)).not.toContain("wamid-test");
      expect(JSON.stringify(read)).not.toContain(CSM_EMAIL);
      for (const who of [CEO, ADMIN])
        expect(
          (
            await one<Row>(
              who,
              "SELECT public.cockpit_client_messages_read($1) r",
              [A],
            )
          ).messages,
        ).toHaveLength(2);
      expect(
        await refused(CSM_B, "SELECT public.cockpit_client_messages_read($1)", [
          A,
        ]),
      ).toEqual({
        code: "42501",
        message: "That client is not on your access list",
      });
      expect(
        (
          await refused(
            CREATIVE,
            "SELECT public.cockpit_client_messages_read($1)",
            [A],
          )
        ).message,
      ).toBe("Current confirmed client-success access is required");
      expect(
        (
          await one<Row>(
            CSM_B,
            "SELECT public.cockpit_client_messages_read($1) r",
            [B],
          )
        ).messages,
      ).toEqual([]);
    });
  });

  test("Today's rows: drafts, refused and failed of the seat's clients; unknown only for the CEO or an admin", async () => {
    await rolledBack(async () => {
      const a = {
        draft: await recap("draft"),
        refused: await recap("refused"),
        failed: await recap("failed"),
        unknown: await recap("unknown"),
      };
      await recap("sent");
      await recap("approved");
      const bDraft = await recap("draft", { task: B });
      const ids = async (who: string) =>
        (
          (
            await one<Row>(
              who,
              "SELECT public.cockpit_client_messages_waiting() r",
            )
          ).messages as Row[]
        )
          .map(m => m.id)
          .sort();
      expect(await ids(CSM)).toEqual(
        [a.draft.id, a.refused.id, a.failed.id, bDraft.id].sort(),
      );
      expect(await ids(CSM_B)).toEqual([bDraft.id]);
      for (const who of [CEO, ADMIN])
        expect(await ids(who)).toEqual(
          [
            a.draft.id,
            a.refused.id,
            a.failed.id,
            a.unknown.id,
            bDraft.id,
          ].sort(),
        );
      expect(
        (
          await refused(
            CREATIVE,
            "SELECT public.cockpit_client_messages_waiting()",
          )
        ).code,
      ).toBe("42501");
      // An incomplete roster is an error, never an empty list.
      await q(
        "UPDATE public.cockpit_csm_source_state SET ready=false WHERE table_name='clients'",
      );
      expect(
        (await refused(CSM, "SELECT public.cockpit_client_messages_waiting()"))
          .message,
      ).toBe("The client roster is incomplete. Refresh its native source");
    });
  });

  test("one message, gated by its card", async () => {
    await rolledBack(async () => {
      const m = await recap("draft");
      expect(
        (
          await one<Row>(
            CSM,
            "SELECT public.cockpit_client_message_read($1) r",
            [m.id],
          )
        ).id,
      ).toBe(m.id);
      expect(
        (
          await refused(
            CSM_B,
            "SELECT public.cockpit_client_message_read($1)",
            [m.id],
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await refused(CSM, "SELECT public.cockpit_client_message_read($1)", [
            "00000000-0000-4000-8000-00000000dead",
          ])
        ).message,
      ).toBe("There is no message with that ID.");
    });
  });

  test("Skip from draft, approved, refused and failed; never once it is sending, sent or unknown", async () => {
    await rolledBack(async () => {
      for (const state of ["draft", "approved", "refused", "failed"]) {
        const m = await recap(state);
        const view = await one<Row>(
          CSM,
          "SELECT public.cockpit_client_message_skip($1, NULL) r",
          [m.id],
        );
        expect([state, view.state, view.reason]).toEqual([
          state,
          "skipped",
          "Skipped by the CSM.",
        ]);
        expect((await row(m.id)).claim_token).toBeNull();
      }
      const own = await recap("draft");
      expect(
        (
          await one<Row>(
            CEO,
            "SELECT public.cockpit_client_message_skip($1, $2) r",
            [own.id, "  The client asked for a call instead.  "],
          )
        ).reason,
      ).toBe("The client asked for a call instead.");
      // Skipping twice changes nothing.
      expect(
        (
          await one<Row>(
            CSM,
            "SELECT public.cockpit_client_message_skip($1, NULL) r",
            [own.id],
          )
        ).reason,
      ).toBe("The client asked for a call instead.");
      for (const [state, sentence] of [
        ["sending", "This recap is being sent now, so it cannot be skipped."],
        ["claimed", "This recap is being sent now, so it cannot be skipped."],
        ["sent", "This recap was already sent, so there is nothing to skip."],
        [
          "unknown",
          "This recap may already be in the group. Look in the group; the tech lead settles it.",
        ],
      ] as const)
        expect(
          await refused(
            CSM,
            "SELECT public.cockpit_client_message_skip($1, NULL)",
            [(await recap(state)).id],
          ),
        ).toEqual({ code: "22023", message: sentence });
      expect(
        (
          await refused(
            CSM_B,
            "SELECT public.cockpit_client_message_skip($1, NULL)",
            [(await recap("draft")).id],
          )
        ).code,
      ).toBe("42501");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='forms.message_skipped' AND after::text LIKE '%Invented recap%'",
        ),
      ).toBe(0);
    });
  });

  test("Reopen: approved, refused or failed back to a draft, the approval and claim cleared; never from sent, unknown or skipped", async () => {
    await rolledBack(async () => {
      for (const state of ["approved", "refused", "failed"]) {
        const m = await recap(state);
        const view = await one<Row>(
          CSM,
          "SELECT public.cockpit_client_message_reopen($1) r",
          [m.id],
        );
        expect([
          state,
          view.state,
          view.approvedAt,
          view.expiresAt,
          view.reason,
        ]).toEqual([state, "draft", null, null, null]);
        const r = await row(m.id);
        expect([
          r.claim_token,
          r.claimed_at,
          r.intent_at,
          r.approved_by,
        ]).toEqual([null, null, null, null]);
        expect(r.attempts).toBe(state === "failed" ? 1 : 0);
      }
      for (const [state, sentence] of [
        ["sent", "This recap was already sent, so it cannot be reopened."],
        [
          "unknown",
          "This recap may already be in the group. Look in the group; the tech lead settles it.",
        ],
        [
          "skipped",
          "This recap was skipped. Nothing was sent, and a skipped recap stays skipped.",
        ],
        ["sending", "This recap is being sent now, so it cannot be reopened."],
      ] as const)
        expect(
          await refused(
            CSM,
            "SELECT public.cockpit_client_message_reopen($1)",
            [(await recap(state)).id],
          ),
        ).toEqual({ code: "22023", message: sentence });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='forms.message_reopened'",
        ),
      ).toBe(3);
    });
  });
});

describe("the approval (service only, the verified seat)", () => {
  test("stores the exact text and its fingerprint, the seat, now and 24 hours on; audited without the text; answers the view", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const m = await recap("draft");
      const edited = `${m.body}\nتعديل بسيط.`;
      const view = await svc<Row>(approve(m.id, edited));
      expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
      expect(view).toMatchObject({
        id: m.id,
        state: "approved",
        body: edited,
        approvedBy: "the CSM",
        owner: "cockpit",
        effectState: "queued",
        reason: null,
      });
      expect(Date.parse(view.expiresAt) - Date.parse(view.approvedAt)).toBe(
        24 * 3600_000,
      );
      const r = await row(m.id);
      expect([r.body, r.body_sha256, r.approved_by]).toEqual([
        edited,
        sha256(edited),
        CSM_EMAIL,
      ]);
      const audit = await q(
        "SELECT action, actor_email, source_system, before, after FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY test_seq",
        [m.id],
      );
      expect(audit.at(-1)).toMatchObject({
        action: "forms.message_approved",
        actor_email: CSM_EMAIL,
        source_system: "cockpit-forms-api",
      });
      expect(JSON.stringify(audit)).not.toContain("تعديل");
      expect(JSON.stringify(audit)).not.toContain("Invented recap");
    });
  });

  test("an old recap after a second cut-over: refused with Press Skip, and Skip works; the old sentence stays while the provider is typeform", async () => {
    const OLD_RECAP =
      "This recap is from before the latest switch-over, so it is not sent from here. Press Skip.";
    const MAKE_SENDS =
      "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.";
    /** The registry's provider, and when it last changed relative to now. */
    const provider = async (name: string, since: string) => {
      await q(
        "UPDATE public.cockpit_forms SET provider=$1 WHERE key='checkin'",
        [name],
      );
      await q(
        "UPDATE public.cockpit_forms SET provider_since = now() + $1::interval WHERE key='checkin'",
        [since],
      );
    };
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const m = await recap("draft");

      // Native, opened again after this recap's send: it belongs to the earlier hour.
      await provider("native", "1 hour");
      expect(await svcRefused(approve(m.id, m.body))).toEqual({
        code: "22023",
        message: OLD_RECAP,
      });
      const kept = await row(m.id);
      expect([kept.state, kept.approved_at, kept.expires_at]).toEqual([
        "draft",
        null,
        null,
      ]);
      expect(
        await q(
          "SELECT id FROM public.cockpit_audit_log WHERE action='forms.message_approved' AND entity_id=$1",
          [m.id],
        ),
      ).toEqual([]);

      // Back on Typeform after that hour: the same recap reads as Make's again.
      await provider("typeform", "1 hour");
      expect(await svcRefused(approve(m.id, m.body))).toEqual({
        code: "22023",
        message: MAKE_SENDS,
      });

      // Native, this recap's send inside the window, but the registry's recap owner is not the cockpit: not an old recap.
      await provider("native", "-1 hour");
      await owners(["recap"], "shadow");
      expect(await svcRefused(approve(m.id, m.body))).toEqual({
        code: "22023",
        message: MAKE_SENDS,
      });

      // The sentence's own instruction works: Skip takes the old recap.
      await owners(["recap"], "cockpit");
      await provider("native", "1 hour");
      const skipped = await one<Row>(
        CSM,
        "SELECT public.cockpit_client_message_skip($1, NULL) r",
        [m.id],
      );
      expect(skipped.state).toBe("skipped");
    });
    await rolledBack(async () => {
      // Native, sent inside the window: it is approved as usual.
      await owners(["recap"], "cockpit");
      const m = await recap("draft");
      await provider("native", "-1 hour");
      const view = await svc(approve(m.id, m.body));
      expect((view as Row).state).toBe("approved");
    });
  });

  test("Approve anyway: the accepted warnings are recorded, never the text", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const m = await recap("draft");
      await svc(
        approve(m.id, m.body, {
          warnings: ["The group already had a team message today.", " "],
        }),
      );
      const rows = await q(
        "SELECT actor_email, metadata FROM public.cockpit_audit_log WHERE action='forms.message_warnings_accepted' AND entity_id=$1",
        [m.id],
      );
      expect(rows).toEqual([
        {
          actor_email: CSM_EMAIL,
          metadata: {
            op: "approve",
            task_id: A,
            warnings: ["The group already had a team message today."],
          },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain("Invented recap");
    });
  });

  test("refusals: a changed text, the owner gate, a state, a seat without the client, an empty or long text", async () => {
    await rolledBack(async () => {
      const m = await recap("draft");
      // The registry still shadow: Make sends the recap.
      expect(await svcRefused(approve(m.id, m.body))).toEqual({
        code: "22023",
        message:
          "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.",
      });
      await owners(["recap"], "cockpit");
      expect(
        await svcRefused(
          approve(m.id, m.body, { hash: sha256("another text") }),
        ),
      ).toEqual({
        code: "22023",
        message: "The text changed after it was checked. Approve it again.",
      });
      expect((await svcRefused(approve(m.id, ""))).message).toBe(
        "The recap is empty or over 4,096 characters. Edit the text, then approve again.",
      );
      expect((await svcRefused(approve(m.id, "x".repeat(4097)))).message).toBe(
        "The recap is empty or over 4,096 characters. Edit the text, then approve again.",
      );
      expect(await svcRefused(approve(m.id, m.body, { actor: CSM_B }))).toEqual(
        { code: "42501", message: "That client is not on your access list" },
      );
      expect(
        (
          await svcRefused(
            approve(m.id, m.body, {
              actor: "00000000-0000-4000-8000-0000000000ff",
            }),
          )
        ).message,
      ).toBe("Sign in to the cockpit first.");
      // No effect points at a message: nothing was written.
      await q(
        "UPDATE public.cockpit_form_effects SET state='delivered' WHERE delivery_ref=$1",
        [m.id],
      );
      expect((await svcRefused(approve(m.id, m.body))).message).toBe(
        "This write was settled in the cockpit, so nothing was written.",
      );
      const approved = await recap("approved");
      expect(
        (await svcRefused(approve(approved.id, approved.body))).message,
      ).toBe(
        "This recap is already approved. It sends within about 3 minutes.",
      );
      expect(
        (await svcRefused(approve((await recap("refused")).id, "x"))).message,
      ).toBe("Reopen this recap first, then approve it.");
      expect((await row(m.id)).state).toBe("draft");
    });
  });
});

describe("the sender's claim and intent", () => {
  test("claims the oldest approval with a new token, three at most; kinds and cards limit it", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const first = await recap("approved");
      const out = await claimOne();
      expect(out.busy).toBe(false);
      expect(out.rows).toHaveLength(1);
      expect(Object.keys(out.rows[0]).sort()).toEqual(
        [
          "approvedAt",
          "bodySha256",
          "body",
          "claimToken",
          "claimedAt",
          "clientName",
          "id",
          "kind",
          "taskId",
        ].sort(),
      );
      expect(out.rows[0]).toMatchObject({
        id: first.id,
        taskId: A,
        kind: "recap_checkin",
        body: first.body,
        bodySha256: sha256(first.body),
      });
      expect(await row(first.id)).toMatchObject({
        state: "claimed",
        claim_token: out.rows[0].claimToken,
      });
      for (let i = 0; i < 4; i++)
        await recap("approved", { task: i % 2 ? B : A });
      expect((await svc<Row>(claimSql(["recap_kickoff"]))).rows).toEqual([]);
      const onlyB = await svc<Row>(claimSql(["recap_checkin"], [B], 3));
      expect(onlyB.rows.map((r: Row) => r.taskId)).toEqual([B, B]);
      expect(
        (await svc<Row>(claimSql(["recap_checkin"], [], 10))).rows,
      ).toHaveLength(2);
      expect((await svcRefused(claimSql(["phase6"]))).message).toBe(
        "Choose the kinds of message to claim.",
      );
    });
  });

  test("an approval older than 24 hours, the owner gate and a lost approver each settle the row instead", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const old = await recap("approved");
      await q(
        "UPDATE public.cockpit_client_messages SET expires_at = now() - interval '1 minute' WHERE id=$1",
        [old.id],
      );
      expect((await claimOne()).rows).toEqual([]);
      expect(await row(old.id)).toMatchObject({
        state: "draft",
        approved_by: null,
        reason: "The approval ran out after 24 hours. Approve it again.",
      });

      const lost = await recap("approved");
      await q(
        "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
        [["Beta Build"], CSM],
      );
      expect((await claimOne()).rows).toEqual([]);
      expect(await row(lost.id)).toMatchObject({
        state: "draft",
        reason:
          "The person who approved it no longer has this client. Approve it again.",
      });
      await q(
        "UPDATE public.cockpit_members SET clients='{}' WHERE auth_user_id=$1",
        [CSM],
      );

      const gated = await recap("approved");
      await owners(["recap"], "shadow");
      expect((await claimOne()).rows).toEqual([]);
      expect(await row(gated.id)).toMatchObject({
        state: "skipped",
        reason: "Make owns this again.",
      });

      // An incomplete roster claims nothing and changes nothing.
      await owners(["recap"], "cockpit");
      const waiting = await recap("approved");
      await q(
        "UPDATE public.cockpit_csm_source_state SET ready=false WHERE table_name='clients'",
      );
      expect((await claimOne()).rows).toEqual([]);
      expect((await row(waiting.id)).state).toBe("approved");
    });
  });

  test("the claim takes the advisory lock first and answers busy when another run holds it", async () => {
    const src = (
      await installed("cockpit_client_message_claim(text[],text[],integer)")
    ).src;
    expect(
      src.indexOf(
        "pg_try_advisory_xact_lock(hashtextextended('cockpit_client_messages', 0))",
      ),
    ).toBeGreaterThan(0);
    expect(src).toContain(
      "RETURN jsonb_build_object('busy', true, 'rows', '[]'::jsonb);",
    );
    expect(src.indexOf("pg_try_advisory_xact_lock")).toBeLessThan(
      src.indexOf("FOR m IN"),
    );
  });

  test("intent: sending with one more try; a lost claim posts nothing", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const m = await recap("approved");
      const token = (await claimOne()).rows[0].claimToken;
      expect(
        await svc(
          `SELECT public.cockpit_client_message_intent('${m.id}', '00000000-0000-4000-8000-00000000beef') AS r`,
        ),
      ).toEqual({
        ok: false,
        reason: "This run no longer holds the message, so nothing was sent.",
      });
      expect(
        await svc(
          `SELECT public.cockpit_client_message_intent('${m.id}', '${token}') AS r`,
        ),
      ).toEqual({ ok: true });
      expect(await row(m.id)).toMatchObject({ state: "sending", attempts: 1 });
      expect((await row(m.id)).intent_at).not.toBeNull();
    });
  });

  test("intent after a rollback of the registry: back to approved, then the next claim skips it with the reason", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const m = await recap("approved");
      const token = (await claimOne()).rows[0].claimToken;
      await owners(["recap"], "shadow");
      expect(
        await svc(
          `SELECT public.cockpit_client_message_intent('${m.id}', '${token}') AS r`,
        ),
      ).toEqual({ ok: false, reason: "Make owns this again." });
      expect(await row(m.id)).toMatchObject({
        state: "approved",
        claim_token: null,
        claimed_at: null,
        attempts: 0,
      });
      expect((await claimOne()).rows).toEqual([]);
      expect(await row(m.id)).toMatchObject({
        state: "skipped",
        reason: "Make owns this again.",
      });
    });
  });

  test("a fourth try is refused with the sentence, and the sweep never loops it back", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const m = await recap("approved");
      await q(
        "UPDATE public.cockpit_client_messages SET attempts = 3 WHERE id=$1",
        [m.id],
      );
      const token = (await claimOne()).rows[0].claimToken;
      const sentence =
        "WhatsApp refused this recap three times. Send it by hand in the group if it is still needed, then skip it here.";
      expect(
        await svc(
          `SELECT public.cockpit_client_message_intent('${m.id}', '${token}') AS r`,
        ),
      ).toEqual({ ok: false, reason: sentence });
      expect(await row(m.id)).toMatchObject({
        state: "refused",
        reason: sentence,
        attempts: 3,
      });
      await q(
        "UPDATE public.cockpit_client_messages SET claimed_at = now() - interval '1 hour' WHERE id=$1",
        [m.id],
      );
      await svc("SELECT public.cockpit_client_message_sweep() AS r");
      expect((await row(m.id)).state).toBe("refused");
      expect((await claimOne()).rows).toEqual([]);
    });
  });
});

describe("the sender's result, sweep, work and fix", () => {
  async function sending() {
    await owners(["recap"], "cockpit");
    const m = await recap("approved");
    const token = (await claimOne()).rows[0].claimToken as string;
    await svc(
      `SELECT public.cockpit_client_message_intent('${m.id}', '${token}') AS r`,
    );
    return { ...m, token };
  }
  const result = (
    id: string,
    token: string,
    outcome: string,
    pid: string | null,
    reason: string | null,
    readBack: Row | null,
  ) =>
    svc<Row>(
      "SELECT public.cockpit_client_message_result($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb) AS r",
      [
        id,
        token,
        outcome,
        pid,
        reason,
        readBack ? JSON.stringify(readBack) : null,
      ],
    );
  const resultRefused = (
    id: string,
    token: string,
    outcome: string,
    pid: string | null,
    reason: string | null,
    readBack: Row | null,
  ) =>
    svcRefused(
      "SELECT public.cockpit_client_message_result($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)",
      [
        id,
        token,
        outcome,
        pid,
        reason,
        readBack ? JSON.stringify(readBack) : null,
      ],
    );

  test("sent with WhatsApp's id, then one read-back by that id, never with a body", async () => {
    await rolledBack(async () => {
      const m = await sending();
      expect(
        (await resultRefused(m.id, m.token, "sent", null, null, null)).message,
      ).toBe("A sent message needs WhatsApp's message id.");
      const view = await result(
        m.id,
        m.token,
        "sent",
        "wamid-0001",
        null,
        null,
      );
      expect(view).toMatchObject({ state: "sent", readBack: null });
      expect(view.sentAt).not.toBeNull();
      expect(
        (
          await resultRefused(m.id, m.token, "read_back", null, null, {
            by: "message_id",
            providerId: "wamid-other",
          })
        ).message,
      ).toBe(
        "A read-back by message id must find the id WhatsApp gave the send.",
      );
      const read = await result(m.id, m.token, "read_back", null, null, {
        by: "message_id",
        providerId: "wamid-0001",
        body: "never kept",
      });
      expect(read.readBack).toMatchObject({ by: "message_id" });
      const r = await row(m.id);
      expect(Object.keys(r.read_back).sort()).toEqual([
        "at",
        "by",
        "providerId",
      ]);
      expect(JSON.stringify(r.read_back)).not.toContain("never kept");
      // A second read-back changes nothing.
      await result(m.id, m.token, "read_back", null, null, {
        by: "body_sha256",
        providerId: "wamid-0002",
      });
      expect((await row(m.id)).read_back).toEqual(r.read_back);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='forms.message_read_back' AND entity_id=$1",
          [m.id],
        ),
      ).toBe(1);
    });
  });

  test("failed and refused need a reason; unknown has its own; release goes back to approved; the claim and the state are checked", async () => {
    await rolledBack(async () => {
      const f = await sending();
      expect(
        (await resultRefused(f.id, f.token, "failed", null, null, null))
          .message,
      ).toBe("Say why in a plain sentence.");
      expect(
        (
          await result(
            f.id,
            f.token,
            "failed",
            null,
            "WhatsApp refused it (400).",
            null,
          )
        ).state,
      ).toBe("failed");
      const u = await sending();
      expect(
        await result(u.id, u.token, "unknown", null, null, null),
      ).toMatchObject({
        state: "unknown",
        reason:
          "WhatsApp did not confirm the send. Look in the group before anything else.",
      });
      await owners(["recap"], "cockpit");
      const c = await recap("approved");
      const token = (await claimOne()).rows[0].claimToken;
      expect(
        (await resultRefused(c.id, token, "refused", null, null, null)).message,
      ).toBe("Say why in a plain sentence.");
      expect(
        (
          await resultRefused(
            c.id,
            "00000000-0000-4000-8000-00000000beef",
            "release",
            null,
            null,
            null,
          )
        ).message,
      ).toBe("This run does not hold that message.");
      expect(
        await resultRefused(c.id, token, "sent", "wamid-x", null, null),
      ).toEqual({
        code: "55000",
        message: "A message goes from claimed to sent only through the sender",
      });
      expect(
        (await result(c.id, token, "release", null, null, null)).state,
      ).toBe("approved");
      expect((await row(c.id)).claim_token).toBeNull();
      expect(
        (await resultRefused(c.id, token, "bounced", null, null, null)).message,
      ).toBe(
        "Choose refused, release, sent, failed, unknown, reconciled or read_back.",
      );
    });
  });

  test("an unknown found in the group by its fingerprint is reconciled, read back by body_sha256", async () => {
    await rolledBack(async () => {
      const m = await sending();
      await result(m.id, m.token, "unknown", null, null, null);
      expect(
        (
          await resultRefused(m.id, m.token, "reconciled", "wamid-9", null, {
            by: "message_id",
          })
        ).message,
      ).toBe(
        "A reconciled message needs WhatsApp's message id and a read-back by its fingerprint.",
      );
      const view = await result(m.id, m.token, "reconciled", "wamid-9", null, {
        by: "body_sha256",
      });
      expect(view).toMatchObject({
        state: "sent",
        readBack: { by: "body_sha256" },
      });
      expect((await row(m.id)).provider_id).toBe("wamid-9");
    });
  });

  test("the sweep: a stopped send is unknown, a stale claim goes back, an old approval is a draft again", async () => {
    await rolledBack(async () => {
      const stopped = await sending();
      await q(
        "UPDATE public.cockpit_client_messages SET intent_at = now() - interval '11 minutes' WHERE id=$1",
        [stopped.id],
      );
      await owners(["recap"], "cockpit");
      const stale = await recap("approved");
      await claimOne();
      await q(
        "UPDATE public.cockpit_client_messages SET claimed_at = now() - interval '11 minutes' WHERE id=$1",
        [stale.id],
      );
      const old = await recap("approved");
      await q(
        "UPDATE public.cockpit_client_messages SET expires_at = now() - interval '1 minute' WHERE id=$1",
        [old.id],
      );
      expect(
        await svc("SELECT public.cockpit_client_message_sweep() AS r"),
      ).toEqual({ unknown: 1, released: 1, expired: 1 });
      expect(await row(stopped.id)).toMatchObject({
        state: "unknown",
        reason:
          "The sender stopped while sending. Look in the group before anything else.",
      });
      expect(await row(stale.id)).toMatchObject({
        state: "approved",
        claim_token: null,
      });
      expect(await row(old.id)).toMatchObject({
        state: "draft",
        reason: "The approval ran out after 24 hours. Approve it again.",
      });
      expect(
        await svc("SELECT public.cockpit_client_message_sweep() AS r"),
      ).toEqual({ unknown: 0, released: 0, expired: 0 });
    });
  });

  test("work reads the unknowns, the unread and the approved with the text to match, writing nothing", async () => {
    await rolledBack(async () => {
      const u = await sending();
      await result(u.id, u.token, "unknown", null, null, null);
      const s = await sending();
      await result(s.id, s.token, "sent", "wamid-s", null, null);
      await owners(["recap"], "cockpit");
      const a = await recap("approved");
      const before = await q(
        "SELECT id, state, updated_at FROM public.cockpit_client_messages ORDER BY id",
      );
      const work = await svc<Row>(
        "SELECT public.cockpit_client_message_work(5) AS r",
      );
      expect(work.unknowns.map((x: Row) => x.id)).toEqual([u.id]);
      expect(work.unknowns[0]).toMatchObject({
        body: u.body,
        bodySha256: sha256(u.body),
        claimToken: u.token,
      });
      expect(work.unread.map((x: Row) => [x.id, x.providerId])).toEqual([
        [s.id, "wamid-s"],
      ]);
      expect(work.approved.map((x: Row) => x.id)).toEqual([a.id]);
      expect(work.approved[0].body).toBeUndefined();
      expect(
        await q(
          "SELECT id, state, updated_at FROM public.cockpit_client_messages ORDER BY id",
        ),
      ).toEqual(before);
    });
  });

  test("fix not_sent: an unknown a person did not find in the group is failed with what they saw", async () => {
    await rolledBack(async () => {
      const m = await sending();
      await result(m.id, m.token, "unknown", null, null, null);
      expect(
        await svc<Row>(
          `SELECT public.cockpit_client_message_fix('${m.id}', 'not_sent', 'Checked the group at 14:20.') AS r`,
        ),
      ).toMatchObject({
        state: "failed",
        reason:
          "Checked by a person: not in the group. Checked the group at 14:20.",
      });
      expect(
        (
          await svcRefused(
            `SELECT public.cockpit_client_message_fix('${m.id}', 'not_sent', NULL)`,
          )
        ).code,
      ).toBe("55000");
      expect(
        (
          await svcRefused(
            `SELECT public.cockpit_client_message_fix('${m.id}', 'requeue', NULL)`,
          )
        ).message,
      ).toBe("Choose not_sent.");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='forms.message_fixed' AND entity_id=$1",
          [m.id],
        ),
      ).toBe(1);
    });
  });

  test("team_today: true for a team message in the linked group today, false otherwise, NULL with no group", async () => {
    await rolledBack(async () => {
      const today = (sql: string) =>
        svc(
          `SELECT public.cockpit_client_message_team_today('${A}') AS r`,
        ).then(r => [sql, r]);
      expect(await today("no thread")).toEqual(["no thread", null]);
      await q(
        "INSERT INTO public.wa_threads(id, location_id, contact_id, client_task_id, is_group) VALUES('th-1', 'loc', 'c1', $1, false)",
        [A],
      );
      expect(await today("a direct thread only")).toEqual([
        "a direct thread only",
        null,
      ]);
      await q(
        "INSERT INTO public.wa_threads(id, location_id, contact_id, client_task_id, is_group, provider_id) VALUES('th-2', 'loc', 'c2', $1, true, $2)",
        [A, GROUP],
      );
      await q(
        "INSERT INTO public.wa_messages(id, thread_id, direction, body, at, speaker) VALUES('m1', 'th-2', 'inbound', 'Invented.', now(), 'Client Person')",
      );
      await q(
        "INSERT INTO public.wa_messages(id, thread_id, direction, body, at) VALUES('m2', 'th-2', 'outbound', 'Invented.', now() - interval '2 days')",
      );
      expect(await today("a client message today, ours days ago")).toEqual([
        "a client message today, ours days ago",
        false,
      ]);
      await q(
        "INSERT INTO public.wa_messages(id, thread_id, direction, body, at, speaker) VALUES('m3', 'th-2', 'inbound', 'Invented.', now(), 'Sara | MaharaMedia')",
      );
      expect(await today("a team speaker today")).toEqual([
        "a team speaker today",
        true,
      ]);
      expect(
        (
          await svcRefused(
            "SELECT public.cockpit_client_message_team_today('bad id!')",
          )
        ).message,
      ).toBe("Choose a valid ClickUp client ID");
    });
  });
});

describe("with 20261029w: the settle trigger follows the message (contract 3.6)", () => {
  beforeAll(async () => {
    await asOwner();
    for (const file of [WRITEBACK, NOTICES]) await db.exec(migration(file));
    await db.exec(migration(DISPATCH));
    await db.exec(migration(DISPATCH));
  }, 120_000);

  test("skipping a refused recap skips its effect; a failed one's effect stays failed with no refused settle", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const refusedOne = await recap("refused");
      expect((await effectOf(refusedOne.effectId)).state).toBe("queued");
      await one(CSM, "SELECT public.cockpit_client_message_skip($1, NULL) r", [
        refusedOne.id,
      ]);
      expect(await effectOf(refusedOne.effectId)).toEqual({
        state: "skipped",
        reason: "Skipped by the CSM.",
      });
      const failedOne = await recap("failed");
      expect((await effectOf(failedOne.effectId)).state).toBe("failed");
      await one(CSM, "SELECT public.cockpit_client_message_skip($1, NULL) r", [
        failedOne.id,
      ]);
      expect((await effectOf(failedOne.effectId)).state).toBe("failed");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='forms.settle_refused' AND after::text LIKE '%skipped%'",
        ),
      ).toBe(0);
    });
  });

  test("reopening a failed recap puts its effect back in the queue; a sent one delivers it", async () => {
    await rolledBack(async () => {
      await owners(["recap"], "cockpit");
      const failedOne = await recap("failed");
      await one(CSM, "SELECT public.cockpit_client_message_reopen($1) r", [
        failedOne.id,
      ]);
      expect((await effectOf(failedOne.effectId)).state).toBe("queued");
      const sentOne = await recap("sent");
      expect((await effectOf(sentOne.effectId)).state).toBe("delivered");
      const view = await one<Row>(
        CSM,
        "SELECT public.cockpit_client_message_read($1) r",
        [sentOne.id],
      );
      expect(view.effectState).toBe("delivered");
    });
  });
});
