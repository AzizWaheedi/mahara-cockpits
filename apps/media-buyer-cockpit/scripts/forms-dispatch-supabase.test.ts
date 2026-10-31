/**
 * The 1-1 notes effect dispatch (20261029w_forms_dispatch.sql;
 * docs/forms/STAGE2B-CONTRACT.md 2.7, 3.3 to 3.6, 3.11, 3.12 and 4.0, build
 * 0) on an isolated PostgreSQL with Supabase's default privileges on, so a
 * missing REVOKE opens a function here as it would in production.
 *
 * It stands on the 2a base of section 8 in order (20261025n, 20261025o,
 * 20261026r, 20261026s, 20261026t, 20261027f, 20261027g, 20261027h over
 * 20261024a), cut from or applied as the canonical migrations the way
 * stage2a-fit-supabase.test.ts stands on them, then the 2b files in letter
 * order, each twice: 20261029s_forms_registry.sql, the other builders'
 * 20261029t_forms_clickup_writeback.sql, 20261029u_forms_checkin_notices.sql
 * and 20261029v_forms_client_messages.sql, then 20261029w_forms_dispatch.sql.
 * A t, u or v file not in the tree yet is replaced by a stand-in of what this
 * file reads from it (the form kind and the forms claim; the Call grade kind,
 * row and channel; the recap approval and claim), and the suite says which.
 * PGlite has no pg_cron, vault or pg_net: the vault and net.http_post are
 * stand-ins that record what the kick would post.
 *
 * Covered (4.0's list): a live send with the registry flipped through
 * cockpit_form_registry_apply with via 'cutover' (each case rolled back)
 * queues one ClickUp row per card effect with 3.3's shape and no comment
 * text; the grade and recap wait, then queue the grade notice (ids and times
 * only) and the recap message (the draft's text byte for byte, its sha256);
 * a recap over 4,096 characters fails; every settle row of 3.6, unknown to
 * skipped included, and an illegal move recorded, never raised; shadow and
 * Make effects never dispatched; kickoff and Blueprint never dispatched by
 * the submit, the sweep or the drafts trigger; what a rolled-back hour left
 * open refused at the next cut-over, so nothing old reaches the writer or is
 * approved (Z70); the cut-over refusing a writer that reads apply, through the
 * hour's steps and a rollback; the 30-minute sentences and
 * an off grade's reason; idempotence; a refused queue insert keeping the
 * notes; the registry taking an effect back; the submit's body as 2a's plus
 * one line; a failed recap requeued within 24 hours only; grants; a dispatch
 * that raises leaving the send committed; the waiting reason written once;
 * the service drafts reader; the kick; the native window (a response outside
 * it queues nothing and asks for no draft, whatever the owners say); the
 * effects guard's two moves; the drift guard. The CEO's address is read from the CEO gate migration, never
 * written here; every other person, client, recording and room is invented.
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

const BASE = [
  "20261025n_slack_notices.sql",
  "20261025o_blueprint_close_drain.sql",
  "20261026r_requests.sql",
  "20261026s_request_types_seed.sql",
  "20261026t_task_alerts.sql",
  "20261027f_forms_core.sql",
  "20261027g_fathom_intake.sql",
  "20261027h_checkin_plans.sql",
] as const;
const S = "20261029s_forms_registry.sql";
const T = "20261029t_forms_clickup_writeback.sql";
const U = "20261029u_forms_checkin_notices.sql";
const V = "20261029v_forms_client_messages.sql";
const W = "20261029w_forms_dispatch.sql";
const present = (file: string) =>
  existsSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url));

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
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm only, every client
const EDITOR_ROW = "00000000-0000-4000-8000-0000000000f2";
const EDITOR_ROLE = "00000000-0000-4000-8000-0000000000f3";
const GONE = "00000000-0000-4000-8000-0000000000f4";
const NOBODY = "00000000-0000-4000-8000-0000000000f5";
const CSM_EMAIL = "csm@tests.invalid";

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build

const SENTENCE = {
  waitGrade: "Waiting for the grade.",
  waitRecap: "Waiting for the recap draft.",
  noGrader: "No grade: the grader did not answer.",
  noDrafter: "No recap: the drafter did not answer.",
  longRecap:
    "The recap draft is empty or over 4,096 characters. Draft it again.",
  dryRun: "The ClickUp writer ran this as a dry run; nothing was written.",
  muted: "The call grade notice is off in Notices and routing.",
  make: "Make owns this again.",
  dispatchFailed: (e: string) =>
    `The 1-1 notes dispatch failed: ${e.slice(0, 200)}. The notes are saved; the sweep tries again every minute.`,
  noVault:
    "The vault has no cockpit_notices_cron_secret, so the 1-1 notes sweep did not run. Add it to the vault.",
  noAnon:
    "The vault has no cockpit_anon_key, so the 1-1 notes sweep did not run. Add it to the vault.",
};

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
/** Several statements as the owner, no parameters. */
async function ex(text: string): Promise<void> {
  await guarded(async () => {
    await asOwner();
    await db.exec(text);
  });
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0]?.r as T;
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
/** One value as a seat (its auth id) or as PostgREST with the service key. */
async function as<T = any>(
  who: string | "service",
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

// --- The database the 2b files stand on (section 8's 2a base) ---------------------------------

/**
 * What Stage 1, the ticketing and the 2a forms read, each cut from its
 * canonical migration as stage2a-fit-supabase.test.ts cuts it; the sales
 * index and a few provider ledgers are stand-ins with the live column names.
 * PL/pgSQL resolves a declared row type when a function is created, so the
 * call store and the sync state come first.
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
    [
      "20260921a_cockpit_settings.sql",
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
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

/** The seats, the people by role, the roster the client gate reads and Acme's alias. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  await member(db, EDITOR_ROW, "buyer.editor@tests.invalid", ["media_buyer"]);
  await member(db, EDITOR_ROLE, "forms.editor@tests.invalid", ["forms_editor"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await q(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'nobody@tests.invalid',now())",
    [NOBODY],
  );
  for (const [name, email, role] of [
    ["Csm Test", CSM_EMAIL, "Client success manager"],
    ["Ceo Test", CEO_EMAIL, "CEO"],
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
}

/** Every public function's definition md5 and ACL. */
async function functions() {
  return new Map(
    (
      await q<{ sig: string; md5: string; acl: string | null }>(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind IN ('f','p')`,
      )
    ).map(r => [r.sig, `${r.md5}|${r.acl}`]),
  );
}

/** The vault (plain text, inside this test only) and pg_net, recording each post. */
const VAULT_AND_NET = `
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text NOT NULL DEFAULT '',
    secret text NOT NULL, key_id uuid, nonce bytea,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE VIEW vault.decrypted_secrets AS
    SELECT s.id, s.name, s.description, s.secret, s.secret AS decrypted_secret, s.key_id, s.nonce, s.created_at, s.updated_at
      FROM vault.secrets s;
  REVOKE ALL ON SCHEMA vault FROM PUBLIC;
  CREATE SCHEMA net;
  CREATE TABLE net.posted (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_ms integer);
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
    headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
    $$ INSERT INTO net.posted(url, body, headers, timeout_ms) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;
  REVOKE ALL ON SCHEMA net FROM PUBLIC;`;

/** What w reads from a 2b file not in the tree yet (applied once, after 20261029s). */
async function standIn(file: string) {
  if (file === T)
    await ex(`
      ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
      ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
        CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));
      CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim_forms(p_token uuid, p_limit integer DEFAULT 8)
        RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
      REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_claim_forms(uuid,integer) FROM PUBLIC, anon, authenticated;`);
  if (file === U)
    await ex(`
      ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
      ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
        CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                        'rehearsal','checkin.grade','checkin.recap_late'));
      ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT cockpit_slack_notice_settings_kind_check;
      ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_kind_check
        CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated','blueprint.close','blueprint.updated',
                        'blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late'));
      ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT cockpit_slack_notice_settings_check;
      ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_check
        CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late')) = (channel IS NOT NULL));
      INSERT INTO public.cockpit_slack_channels(id, name, private, state, note, added_by)
      VALUES ('C09SVG6FHGU','client-call-feedback',true,'checking','Stand-in for 20261029u.','test') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.cockpit_slack_notice_settings(kind, enabled, channel, updated_by)
      VALUES ('checkin.grade', true, 'C09SVG6FHGU', 'test') ON CONFLICT (kind) DO NOTHING;`);
  if (file === V)
    await ex(`
      CREATE OR REPLACE FUNCTION public.cockpit_client_messages_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      DECLARE v_fix boolean := coalesce(current_setting('cockpit.forms_fix', true), '') = 'on';
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.state <> 'draft' THEN RAISE EXCEPTION 'A message starts as a draft' USING ERRCODE = '55000'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
             (OLD.state = 'draft' AND NEW.state IN ('approved','skipped'))
          OR (OLD.state = 'approved' AND NEW.state IN ('claimed','draft','skipped'))
          OR (OLD.state = 'claimed' AND NEW.state IN ('sending','approved','refused'))
          OR (OLD.state = 'sending' AND NEW.state IN ('sent','failed','unknown'))
          OR (OLD.state = 'unknown' AND NEW.state = 'sent')
          OR (OLD.state = 'refused' AND NEW.state IN ('draft','skipped'))
          OR (OLD.state = 'failed' AND NEW.state = 'skipped')
          OR (OLD.state = 'failed' AND NEW.state = 'draft' AND v_fix)) THEN
          RAISE EXCEPTION 'A message goes from % to % only through the sender', OLD.state, NEW.state USING ERRCODE = '55000';
        END IF;
        NEW.updated_at := now();
        RETURN NEW;
      END $$;
      CREATE OR REPLACE FUNCTION public.cockpit_client_message_approve(p_id uuid, p_body text, p_body_sha256 text,
        p_actor uuid, p_warnings text[]) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      CREATE OR REPLACE FUNCTION public.cockpit_client_message_claim(p_kinds text[], p_only_cards text[] DEFAULT NULL,
        p_limit integer DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;`);
}

const used: Record<string, "file" | "stand-in"> = {};
let first: Map<string, string>;
let auditOnce = 0;
let auditTwice = 0;
let twiceFns: Map<string, string>;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The order audit rows were written in: two statements of one transaction
  // share created_at, and the ids are random.
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await standOn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE) await db.exec(migration(file));
  // The 2b files in letter order, then all of them again.
  for (const round of [1, 2]) {
    for (const file of [S, T, U, V, W]) {
      if (present(file)) {
        used[file] = "file";
        await db.exec(migration(file));
      } else if (round === 1) {
        used[file] = "stand-in";
        await standIn(file);
      }
    }
    if (round === 1) {
      first = await functions();
      auditOnce = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log",
      );
    } else {
      twiceFns = await functions();
      auditTwice = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log",
      );
    }
  }
  await db.exec(VAULT_AND_NET);
  // The sender checked #client-call-feedback: in the bot's channel list, private.
  await as(
    "service",
    "SELECT to_jsonb(public.cockpit_slack_channel_checked('C09SVG6FHGU', true, 'client-call-feedback', true, 'Checked.')) AS r",
  );
  console.info(
    `20261029w suite stands on: ${Object.entries(used)
      .map(([f, how]) => `${f.slice(0, 9)} ${how}`)
      .join(", ")}`,
  );
}, 300_000);
afterAll(async () => {
  await db?.close();
});

// --- A live 1-1 notes send, as the window makes it ----------------------------------------------

let seq = 0;
const nextId = () =>
  `5d000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
let recSeq = 900000700;
/** A recording the CSM made, on the client by its room (or on no client). */
async function recording(task: string | null = A): Promise<string> {
  const rec = String(++recSeq);
  await q(
    `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
       external,invitees,url,share_url,summary,raw,class,room,recorder_team)
     VALUES($1,'Invented check-in',$2,$3,$4,'Csm Test',true,'[]'::jsonb,$5,$6,'Invented summary.','{}'::jsonb,'client',$7,
            'Customer Success')`,
    [
      rec,
      ago(70),
      ago(40),
      CSM_EMAIL,
      `https://fathom.video/calls/${rec}`,
      `https://fathom.video/share/test-${rec}`,
      `meet:rec-${rec}`,
    ],
  );
  if (task)
    await q(
      `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
         starts_at,ends_at,status,provider_status,host_email,recording_url,room)
       VALUES('fathom',$1,$2,$3,'same_room',1,'checkin','Invented check-in',$4,$5,'held','recorded',$6,$7,$8)`,
      [
        rec,
        task,
        task === A ? "Acme Interiors" : "Beta Build",
        ago(70),
        ago(40),
        CSM_EMAIL,
        `https://fathom.video/calls/${rec}`,
        `meet:rec-${rec}`,
      ],
    );
  return rec;
}
const WE = [{ text: "Send the new ad drafts by Thursday", owner: "the CSM" }];
const THEY = [{ text: "Share the showroom photos with the team" }];
/** Open, save the call, DEFCON, priority and the to-dos, send (as the seat, through the window's RPCs). */
async function send(
  rec: string | null,
  o: { who?: string; task?: string; answers?: Row; id?: string } = {},
) {
  const who = o.who ?? CSM;
  const task = o.task ?? A;
  const id = o.id ?? nextId();
  const opened = await as<Row>(
    who,
    "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
    [task, id],
  );
  const answers = {
    call: rec
      ? { kind: "fathom", recordingId: rec, why: "picked" }
      : { kind: "none" },
    defcon: "At Risk",
    priority: "High",
    we_owe: WE,
    they_owe: THEY,
    ...(o.answers ?? {}),
  };
  const saved = await as<Row>(
    who,
    "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-test-0001', $3) AS r",
    [
      id,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(answers).map(([k, v]) => [k, { value: v }]),
        ),
      ),
      opened.response.revision,
    ],
  );
  const out = await as<Row>(
    who,
    "SELECT public.cockpit_form_submit($1::uuid, $2) AS r",
    [id, saved.row.revision],
  );
  return { id, out, rec: rec as string };
}
const flip = (owners: unknown = "cockpit") =>
  one<Row>(
    'SELECT public.cockpit_form_registry_apply(\'checkin\', $1::jsonb, \'{"via":"cutover","email":"cut-over"}\'::jsonb) AS r',
    [JSON.stringify({ provider: "native", owners })],
  );
/**
 * The cut-over was an hour ago. This transaction shares one clock, so a case
 * that dates a send back dates the flip back too, or the send falls outside
 * the native window.
 */
const nativeAnHourAgo = () =>
  q(
    "UPDATE public.cockpit_forms SET provider_since = now() - interval '26 hours' WHERE key = 'checkin'",
  );
/** A live send on a fresh recording of Acme, with the registry flipped. */
async function liveSend(o: { answers?: Row } = {}) {
  const rec = await recording(A);
  return send(rec, o);
}
async function effects(id: string): Promise<Record<string, Row>> {
  const rows = await q<Row>(
    "SELECT id::text, effect_key, owner, state, reason, delivery_ref, receipt, plan FROM public.cockpit_form_effects WHERE response_id = $1::uuid",
    [id],
  );
  return Object.fromEntries(rows.map(r => [r.effect_key, r]));
}
const sha = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Begin a draft as the forms door does (the service key) and finish it. */
async function draft(
  kind: "grade" | "recap",
  rec: string,
  finish: { state: string; text?: string; reason?: string } | null,
  o: { responseId?: string; again?: boolean } = {},
) {
  const begun = await as<Row>(
    "service",
    "SELECT public.cockpit_form_draft_begin($1::jsonb) AS r",
    [
      JSON.stringify({
        formKey: "checkin",
        taskId: A,
        recordingId: rec,
        responseId: o.responseId,
        kind,
        provider: "anthropic",
        promptVersion: `checkin.${kind}.v1`,
        inputSha256: sha(`${kind}:${rec}:${seq}`),
        again: o.again ?? false,
        actorEmail: CSM_EMAIL,
      }),
    ],
  );
  if (finish)
    await as(
      "service",
      "SELECT public.cockpit_form_draft_finish($1::uuid, $2::jsonb) AS r",
      [
        begun.id,
        JSON.stringify({
          state: finish.state,
          text: finish.text,
          reason: finish.reason,
          model: "invented-model",
          output:
            kind === "grade"
              ? {
                  score: 7.5,
                  color: "green",
                  criteria: [],
                  overall: "Invented overall.",
                }
              : { message: "Invented." },
          actorEmail: CSM_EMAIL,
        }),
      ],
    );
  return begun.id as string;
}
const RECAP = `Hello from Mahara. Thank you for today's call.\n\nمرحبا، شكرا على الاتصال اليوم.\n\nBook your next check-in: https://example.invalid/book`;

const queueRows = (id: string) =>
  q<Row>(
    "SELECT * FROM public.cockpit_clickup_writeback_queue WHERE kind = 'form' AND payload->>'responseId' = $1 ORDER BY dedupe_key",
    [id],
  );
/** A queue row through the writer's states (claim token while sending). */
async function queueTo(
  id: string,
  state: string,
  o: { error?: string; steps?: Row } = {},
) {
  await q(
    `UPDATE public.cockpit_clickup_writeback_queue
        SET state = $2, error = $3, claim_token = CASE WHEN $2 = 'sending' THEN gen_random_uuid() END,
            progress = CASE WHEN $4::jsonb IS NULL THEN progress ELSE jsonb_build_object('steps', $4::jsonb) END
      WHERE id = $1::uuid`,
    [id, state, o.error ?? null, o.steps ? JSON.stringify(o.steps) : null],
  );
}
async function noticeTo(
  id: string,
  state: string,
  error: string | null = null,
  fix = false,
) {
  await q("SELECT set_config('cockpit.notice_fix', $1, true)", [
    fix ? "on" : "",
  ]);
  await q(
    `UPDATE public.cockpit_slack_notices SET state = $2, error = $3,
        slack_ts = CASE WHEN $2 = 'posted' THEN '1730000000.000100' ELSE slack_ts END,
        channel = CASE WHEN $2 = 'posted' THEN 'C09SVG6FHGU' ELSE channel END
      WHERE id = $1::uuid`,
    [id, state, error],
  );
  await q("SELECT set_config('cockpit.notice_fix', '', true)");
}
async function messageTo(
  id: string,
  state: string,
  reason: string | null = null,
  fix = false,
) {
  await q("SELECT set_config('cockpit.forms_fix', $1, true)", [
    fix ? "on" : "",
  ]);
  await q(
    `UPDATE public.cockpit_client_messages
        SET state = $2, reason = $3,
            claim_token = CASE WHEN $2 IN ('claimed','sending') THEN coalesce(claim_token, gen_random_uuid()) ELSE NULL END,
            provider_id = CASE WHEN $2 = 'sent' THEN 'wamid.invented-1' ELSE provider_id END
      WHERE id = $1::uuid`,
    [id, state, reason],
  );
  await q("SELECT set_config('cockpit.forms_fix', '', true)");
}
const settleRefused = () =>
  q<Row>(
    "SELECT entity_id, before, after, metadata FROM public.cockpit_audit_log WHERE action = 'forms.settle_refused' ORDER BY test_seq",
  );
const reasonRows = (effectId: string) =>
  count(
    "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'forms.effect_reason' AND entity_id = $1",
    [effectId],
  );
const deliveries = async () => ({
  queue: await count(
    "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue WHERE kind = 'form'",
  ),
  notices: await count(
    "SELECT count(*) n FROM public.cockpit_slack_notices WHERE kind LIKE 'checkin.%'",
  ),
  messages: await count(
    "SELECT count(*) n FROM public.cockpit_client_messages",
  ),
});
const sweep = () => one<Row>("SELECT public.cockpit_form_effects_sweep() AS r");
const health = () =>
  q<Row>(
    "SELECT ok, note, detail FROM public.cockpit_sync_state WHERE key = 'forms-effects-kick'",
  ).then(r => r[0]);
const normalised = (text: string) =>
  one<string>("SELECT regexp_replace($1, '\\s+', ' ', 'g') AS r", [text]);
const body = async (sig: string) =>
  normalised(
    await one<string>(
      "SELECT p.prosrc AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
      [`public.${sig}`],
    ),
  );
/** A function's body as its canonical migration wrote it. */
function canonical(file: string, name: string): string {
  const hit = migration(file).match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    ),
  );
  if (!hit) throw new Error(`No body for ${name} in ${file}`);
  return hit[1];
}
/** Each before line must occur exactly once; it becomes its after text. */
function edited(text: string, pairs: [string, string][]): string {
  let out = text;
  for (const [before, after] of pairs) {
    expect(out.split(before).length - 1).toBe(1);
    out = out.replace(before, () => after);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe("the migration", () => {
  test("is one transaction that reloads the schema, opens with its drift guard, and a second apply changes nothing", async () => {
    const sql = migration(W);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toMatch(
      /\nBEGIN;\n\n-- -+\n-- 0\. The drift guard[\s\S]*?\nDO \$\$/,
    );
    expect(sql.indexOf("DO $$")).toBeLessThan(
      sql.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    expect([...first].filter(([sig, v]) => twiceFns.get(sig) !== v)).toEqual(
      [],
    );
    expect([...twiceFns.keys()].filter(sig => !first.has(sig))).toEqual([]);
    expect(auditTwice).toBe(auditOnce);
    // The live bodies the guard names are the canonical 2a bodies (2.2's live body md5).
    for (const [name, live] of [
      ["cockpit_form_submit", "fb609612258ad0d547b8fdfa4c0c91c7"],
      ["cockpit_form_effects_guard", "c981fe2cbc92a24ee393b974952de98f"],
    ])
      expect(
        await one("SELECT md5(regexp_replace($1, '\\s+', ' ', 'g')) AS r", [
          canonical("20261027f_forms_core.sql", name),
        ]),
      ).toBe(live);
    // Its after values are this file's bodies.
    for (const [sig, name] of [
      ["cockpit_form_submit(uuid,integer)", "cockpit_form_submit"],
      ["cockpit_form_effects_guard()", "cockpit_form_effects_guard"],
    ]) {
      const md5 = await one<string>(
        "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
        [`public.${sig}`],
      );
      expect(sql).toContain(`'${md5}'`);
      expect(await body(sig)).toBe(await normalised(canonical(W, name)));
    }
    // Nothing is dispatched at apply: no form row, no check-in notice, no message.
    expect(await deliveries()).toEqual({ queue: 0, notices: 0, messages: 0 });
    const triggers = await q<Row>(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgname LIKE 'cockpit_form_effects_from_%' OR tgname = 'cockpit_form_drafts_dispatch' ORDER BY tgname`,
    );
    expect(triggers).toEqual([
      { tgname: "cockpit_form_drafts_dispatch", tgenabled: "O" },
      { tgname: "cockpit_form_effects_from_messages", tgenabled: "O" },
      { tgname: "cockpit_form_effects_from_notices", tgenabled: "O" },
      { tgname: "cockpit_form_effects_from_queue", tgenabled: "O" },
    ]);
    expect(
      await one(
        "SELECT pg_get_indexdef('public.cockpit_form_effects_delivery_ref'::regclass) AS r",
      ),
    ).toBe(
      "CREATE INDEX cockpit_form_effects_delivery_ref ON public.cockpit_form_effects USING btree (delivery, delivery_ref) WHERE (delivery_ref IS NOT NULL)",
    );
  });

  test("the drift guard refuses a replaced body it did not read, naming the function", async () => {
    await rolledBack(async () => {
      const def = await one<string>(
        "SELECT pg_get_functiondef('public.cockpit_form_submit(uuid,integer)'::regprocedure) AS r",
      );
      await ex(def.replace("  -- 12.", "  -- 12, changed by someone else."));
      expect(await refusal(() => ex(migration(W)))).toEqual({
        code: "55000",
        message:
          "cockpit_form_submit(uuid,integer) changed since the 2b contract read it; stop and re-read it.",
      });
    });
  });

  test("cockpit_form_submit is 2a's body plus exactly the dispatch line, keeping its header and grant", async () => {
    const before = canonical("20261027f_forms_core.sql", "cockpit_form_submit");
    const expected = edited(before, [
      [
        "\n  -- 12.\n",
        "\n  PERFORM public.cockpit_form_dispatch(r.id);\n  -- 12.\n",
      ],
    ]);
    expect(await body("cockpit_form_submit(uuid,integer)")).toBe(
      await normalised(expected),
    );
    expect(
      await q(
        `SELECT p.prosecdef, p.proconfig, l.lanname, format_type(p.prorettype, NULL) AS ret, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.cockpit_form_submit(uuid,integer)'::regprocedure`,
      ),
    ).toEqual([
      {
        prosecdef: true,
        proconfig: ['search_path=""'],
        lanname: "plpgsql",
        ret: "jsonb",
        acl: "{postgres=X/postgres,authenticated=X/postgres}",
      },
    ]);
  });

  test("the effects guard is 2a's body plus exactly its two moves", async () => {
    const expected = edited(
      canonical("20261027f_forms_core.sql", "cockpit_form_effects_guard"),
      [
        [
          "    IF NEW.state NOT IN ('planned','dry_run','skipped') THEN\n",
          "    IF NEW.state NOT IN ('planned','dry_run','skipped')\n" +
            "       AND NOT (NEW.state = 'delivered' AND coalesce(current_setting('cockpit.forms_record', true), '') = 'on'\n" +
            "                AND NEW.owner = 'cockpit' AND NEW.delivery_ref IS NOT NULL AND NEW.form_key IN ('kickoff','blueprint')) THEN\n",
        ],
        [
          "      OR (OLD.state = 'unknown' AND NEW.state IN ('delivered','failed'))\n",
          "      OR (OLD.state = 'unknown' AND NEW.state IN ('delivered','failed','skipped'))\n",
        ],
      ],
    );
    expect(await body("cockpit_form_effects_guard()")).toBe(
      await normalised(expected),
    );
  });

  test("grants: the two readers to the service key only, every other new function to no role", async () => {
    const acl = (sig: string) =>
      one<string | null>(
        "SELECT p.proacl::text AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
        [`public.${sig}`],
      );
    for (const sig of [
      "cockpit_form_effects_waiting()",
      "cockpit_form_drafts_service(uuid)",
    ])
      expect(await acl(sig)).toBe(
        "{postgres=X/postgres,service_role=X/postgres}",
      );
    for (const sig of [
      "cockpit_form_effect_note(uuid,text)",
      "cockpit_form_effects_health(boolean,text,jsonb)",
      "cockpit_form_dispatch(uuid)",
      "cockpit_form_effects_settle(text,text,text,text,jsonb,boolean)",
      "cockpit_form_effects_from_queue()",
      "cockpit_form_effects_from_notices()",
      "cockpit_form_effects_from_messages()",
      "cockpit_form_effects_guard()",
      "cockpit_form_drafts_dispatch()",
      "cockpit_form_effects_sweep()",
      "cockpit_form_effects_waiting_rows()",
      "cockpit_form_effects_kick()",
    ])
      expect(await acl(sig)).toBe("{postgres=X/postgres}");
    // A seat reaches none of the service readers; the service key passes their gate.
    for (const text of [
      "SELECT public.cockpit_form_effects_waiting() AS r",
      `SELECT public.cockpit_form_drafts_service('${nextId()}'::uuid) AS r`,
      "SELECT public.cockpit_form_dispatch(gen_random_uuid()) AS r",
      "SELECT public.cockpit_form_effects_sweep() AS r",
    ])
      expect((await refusal(() => as(CSM, text))).code).toBe("42501");
    expect(
      await as("service", "SELECT public.cockpit_form_effects_waiting() AS r"),
    ).toEqual([]);
  });
});

describe("the dispatch at the send (registry flipped by the cut-over core, rolled back)", () => {
  test("one queue row per card effect with 3.3's shape and no comment text; each effect queued with its row", async () => {
    await rolledBack(async () => {
      await flip();
      const { id, out } = await liveSend();
      expect(out.response).toMatchObject({ mode: "live", state: "submitted" });
      const e = await effects(id);
      expect(e.call_form.state).toBe("delivered");
      expect(e.call_match).toMatchObject({
        state: "skipped",
        reason: "The recording is already on this client.",
      });
      const rows = await queueRows(id);
      expect(rows.map(r => r.dedupe_key)).toEqual(
        ["happiness", "last_checkin_call", "last_poc", "todo_comment"].map(
          k => `${id}:${k}`,
        ),
      );
      for (const row of rows) {
        const key = row.payload.effectKey;
        const effect = e[key];
        expect(effect).toMatchObject({
          state: "queued",
          delivery_ref: row.id,
          reason: null,
        });
        expect(effect.receipt).toEqual({ queueId: row.id });
        expect(row).toMatchObject({
          kind: "form",
          source_table: "cockpit_form_effects",
          source_id: effect.id,
          task_id: A,
          state: "queued",
          attempts: 0,
        });
        const plan = { ...effect.plan };
        delete plan.lines;
        delete plan.comment_text;
        const expected: Row = {
          formKey: "checkin",
          responseId: id,
          effectId: effect.id,
          effectKey: key,
          taskId: A,
          clientName: "Acme Interiors",
          ...plan,
        };
        if (key === "todo_comment")
          Object.assign(expected, {
            commentChars: [...effect.plan.comment_text].length,
            commentSha256: sha(effect.plan.comment_text),
          });
        expect(row.payload).toEqual(expected);
        expect(JSON.stringify(row.payload)).not.toContain(
          "Send the new ad drafts",
        );
      }
      // The queue's audit copies payloads: none holds the CSM's words.
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_clickup_writeback_queue' AND (after::text LIKE '%showroom%' OR after::text LIKE '%ad drafts%')",
        ),
      ).toBe(0);
      // The grade and the recap wait on their drafts, each saying so.
      expect(e.grade_notice).toMatchObject({
        state: "planned",
        reason: SENTENCE.waitGrade,
        delivery_ref: null,
      });
      expect(e.recap).toMatchObject({
        state: "planned",
        reason: SENTENCE.waitRecap,
        delivery_ref: null,
      });
      // The window's answer reads the same states.
      expect(
        Object.fromEntries((out.effects as Row[]).map(x => [x.key, x.state])),
      ).toEqual({
        call_form: "delivered",
        call_match: "skipped",
        todo_comment: "queued",
        happiness: "queued",
        last_poc: "queued",
        last_checkin_call: "queued",
        grade_notice: "planned",
        recap: "planned",
      });
    });
  });

  test("a ready grade queues grade:{recording} with ids and times only; a ready recap makes one message, its text byte for byte", async () => {
    await rolledBack(async () => {
      await flip();
      const { id, rec } = await liveSend();
      const g = await draft("grade", rec, { state: "ready" });
      const [n] = await q<Row>(
        "SELECT * FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
        [`grade:${rec}`],
      );
      const e = await effects(id);
      expect(n).toMatchObject({
        kind: "checkin.grade",
        state: "queued",
        task_id: A,
        client_name: "Acme Interiors",
        target: null,
      });
      expect(n.facts).toEqual({
        responseId: id,
        recordingId: rec,
        draftId: g,
        taskId: A,
        effectId: e.grade_notice.id,
        client: "Acme Interiors",
        submittedAt: n.facts.submittedAt,
      });
      expect(new Date(n.facts.submittedAt)).toEqual(
        await one(
          "SELECT submitted_at AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
          [id],
        ),
      );
      expect(e.grade_notice).toMatchObject({
        state: "queued",
        delivery_ref: n.id,
        reason: null,
      });
      expect(e.grade_notice.receipt).toEqual({ noticeId: n.id });

      const r = await draft(
        "recap",
        rec,
        { state: "ready", text: RECAP },
        { responseId: id },
      );
      const [m] = await q<Row>(
        "SELECT * FROM public.cockpit_client_messages WHERE response_id = $1::uuid",
        [id],
      );
      expect(m).toMatchObject({
        dedupe_key: `${id}:recap`,
        task_id: A,
        client_name: "Acme Interiors",
        kind: "recap_checkin",
        draft_id: r,
        body: RECAP,
        body_sha256: sha(RECAP),
        state: "draft",
        expires_at: null,
      });
      expect((await effects(id)).recap).toMatchObject({
        state: "queued",
        delivery_ref: m.id,
        reason: null,
      });
      expect(await deliveries()).toEqual({ queue: 4, notices: 1, messages: 1 });
    });
  });

  test("a recap draft over 4,096 characters fails the effect with its sentence; nothing is cut and no message is made", async () => {
    await rolledBack(async () => {
      await flip();
      const { id, rec } = await liveSend();
      await draft(
        "recap",
        rec,
        { state: "ready", text: "x".repeat(4097) },
        { responseId: id },
      );
      expect((await effects(id)).recap).toMatchObject({
        state: "failed",
        reason: SENTENCE.longRecap,
        delivery_ref: null,
      });
      expect(
        await count("SELECT count(*) n FROM public.cockpit_client_messages"),
      ).toBe(0);
    });
  });

  test("an off grade fails the effect with the draft's reason; an off recap found by the sweep does the same", async () => {
    await rolledBack(async () => {
      await flip();
      const { id, rec } = await liveSend();
      await draft("grade", rec, {
        state: "off",
        reason: "The Anthropic key is not connected.",
      });
      await q(
        `INSERT INTO public.cockpit_form_drafts(form_key, task_id, recording_id, response_id, kind, provider, prompt_version,
           input_sha256, state, reason, created_by)
         VALUES ('checkin', $1, $2, $3::uuid, 'recap', 'none', 'checkin.recap.v1', $4, 'off', 'Drafting is off for this call.', 'server')`,
        [A, rec, id, sha("off")],
      );
      expect((await effects(id)).recap.state).toBe("planned");
      await sweep();
      const e = await effects(id);
      expect(e.grade_notice).toMatchObject({
        state: "failed",
        reason: "No grade: The Anthropic key is not connected.",
      });
      expect(e.recap).toMatchObject({
        state: "failed",
        reason: "No recap: Drafting is off for this call.",
      });
      expect(await deliveries()).toEqual({ queue: 4, notices: 0, messages: 0 });
    });
  });
});

describe("settling an effect from its outbox (3.6)", () => {
  test("the ClickUp queue: delivered with its step, failed, skipped, unknown, unknown to skipped, dry run, and no change while it runs", async () => {
    await rolledBack(async () => {
      await flip();
      const a = await liveSend();
      const rows = Object.fromEntries(
        (await queueRows(a.id)).map(r => [r.payload.effectKey, r]),
      );
      // Running states move nothing.
      await queueTo(rows.todo_comment.id, "sending");
      await queueTo(rows.todo_comment.id, "retry", {
        error: "ClickUp was busy.",
      });
      expect((await effects(a.id)).todo_comment.state).toBe("queued");
      const step = { state: "done", commentId: "90120000001" };
      await queueTo(rows.todo_comment.id, "sending");
      await queueTo(rows.todo_comment.id, "delivered", {
        steps: { todo_comment: step },
      });
      await queueTo(rows.happiness.id, "failed", {
        error: "ClickUp refused the option.",
      });
      await queueTo(rows.last_poc.id, "unknown", {
        error: "No answer from ClickUp.",
      });
      await queueTo(rows.last_checkin_call.id, "dry_run");
      let e = await effects(a.id);
      expect(e.todo_comment).toMatchObject({
        state: "delivered",
        reason: null,
      });
      expect(e.todo_comment.receipt).toMatchObject({
        queueId: rows.todo_comment.id,
        table: "cockpit_clickup_writeback_queue",
        id: rows.todo_comment.id,
        state: "delivered",
        step,
      });
      expect(e.happiness).toMatchObject({
        state: "failed",
        reason: "ClickUp refused the option.",
      });
      expect(e.last_poc).toMatchObject({
        state: "unknown",
        reason: "No answer from ClickUp.",
      });
      expect(e.last_checkin_call).toMatchObject({
        state: "failed",
        reason: SENTENCE.dryRun,
      });
      // A read-back that proves nothing was written: unknown to skipped.
      await queueTo(rows.last_poc.id, "skipped", {
        error: "Last POC stays 3 Oct: it is newer than this call.",
      });
      e = await effects(a.id);
      expect(e.last_poc).toMatchObject({
        state: "skipped",
        reason: "Last POC stays 3 Oct: it is newer than this call.",
      });
      // The claim's gate skipping a queued row.
      const b = await liveSend();
      const [row] = await queueRows(b.id);
      await queueTo(row.id, "skipped", { error: SENTENCE.make });
      expect((await effects(b.id))[row.payload.effectKey]).toMatchObject({
        state: "skipped",
        reason: SENTENCE.make,
      });
      // The settle wrote each move under its own action and source.
      expect(
        await q(
          `SELECT DISTINCT action, source_system FROM public.cockpit_audit_log
            WHERE entity_type = 'cockpit_form_effects' AND action = 'forms.effect_settled'`,
        ),
      ).toEqual([
        { action: "forms.effect_settled", source_system: "clickup-writeback" },
      ]);
    });
  });

  test("an illegal move is recorded as forms.settle_refused and the outbox's own change still commits", async () => {
    await rolledBack(async () => {
      await flip();
      const a = await liveSend();
      const [row] = await queueRows(a.id);
      const key = row.payload.effectKey;
      await queueTo(row.id, "sending");
      await queueTo(row.id, "delivered", {
        steps: { [key]: { state: "done" } },
      });
      await queueTo(row.id, "failed", { error: "A late failure." });
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_clickup_writeback_queue WHERE id = $1::uuid",
          [row.id],
        ),
      ).toBe("failed");
      const e = (await effects(a.id))[key];
      expect(e.state).toBe("delivered");
      const refused = await settleRefused();
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({
        entity_id: e.id,
        before: { state: "delivered" },
        after: { state: "failed" },
        metadata: { delivery: "clickup_queue", ref: row.id },
      });
    });
  });

  test("the grade notice: posted, failed and fixed, unknown then posted, muted, skipped", async () => {
    await rolledBack(async () => {
      await flip();
      const ids: string[] = [];
      const notices: string[] = [];
      for (let i = 0; i < 4; i++) {
        const s = await liveSend();
        await draft("grade", s.rec, { state: "ready" });
        ids.push(s.id);
        notices.push(
          await one(
            "SELECT id::text AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
            [`grade:${s.rec}`],
          ),
        );
      }
      const grade = async (i: number) => (await effects(ids[i])).grade_notice;
      // 1. sending moves nothing; posted delivers with the channel and ts.
      await noticeTo(notices[0], "sending");
      expect((await grade(0)).state).toBe("queued");
      await noticeTo(notices[0], "posted");
      expect(await grade(0)).toMatchObject({
        state: "delivered",
        reason: null,
      });
      expect((await grade(0)).receipt).toMatchObject({
        noticeId: notices[0],
        channel: "C09SVG6FHGU",
        ts: "1730000000.000100",
      });
      // 2. failed, then a person's fix sends it again: the effect waits again; unknown; then posted.
      await noticeTo(notices[1], "sending");
      await noticeTo(notices[1], "failed", "Slack refused the post.");
      expect(await grade(1)).toMatchObject({
        state: "failed",
        reason: "Slack refused the post.",
      });
      await noticeTo(notices[1], "queued", null, true);
      expect(await grade(1)).toMatchObject({ state: "queued", reason: null });
      await noticeTo(notices[1], "sending");
      await noticeTo(notices[1], "unknown", "Slack did not answer.");
      expect(await grade(1)).toMatchObject({
        state: "unknown",
        reason: "Slack did not answer.",
      });
      await noticeTo(notices[1], "posted");
      expect((await grade(1)).state).toBe("delivered");
      // 3. muted in Notices and routing.
      await noticeTo(notices[2], "muted");
      expect(await grade(2)).toMatchObject({
        state: "skipped",
        reason: SENTENCE.muted,
      });
      // 4. skipped at claim.
      await noticeTo(
        notices[3],
        "skipped",
        "That recording is no longer a client call, so its grade was not posted.",
      );
      expect(await grade(3)).toMatchObject({
        state: "skipped",
        reason:
          "That recording is no longer a client call, so its grade was not posted.",
      });
      expect(await settleRefused()).toEqual([]);
    });
  });

  test("the recap message: sent, refused then skipped, failed then skipped or reopened, unknown then sent, a draft skipped", async () => {
    await rolledBack(async () => {
      await flip();
      const ids: string[] = [];
      const msgs: string[] = [];
      for (let i = 0; i < 6; i++) {
        const s = await liveSend();
        await draft(
          "recap",
          s.rec,
          { state: "ready", text: `${RECAP} ${i}` },
          { responseId: s.id },
        );
        ids.push(s.id);
        msgs.push(
          await one(
            "SELECT id::text AS r FROM public.cockpit_client_messages WHERE response_id = $1::uuid",
            [s.id],
          ),
        );
      }
      const recap = async (i: number) => (await effects(ids[i])).recap;
      // 0. approved, claimed, sending move nothing; sent delivers.
      for (const s of ["approved", "claimed", "sending"]) {
        await messageTo(msgs[0], s);
        expect((await recap(0)).state).toBe("queued");
      }
      await messageTo(msgs[0], "sent");
      expect(await recap(0)).toMatchObject({
        state: "delivered",
        reason: null,
      });
      // 1. refused waits on a person; a person's Skip closes the effect.
      await messageTo(msgs[1], "approved");
      await messageTo(msgs[1], "claimed");
      await messageTo(
        msgs[1],
        "refused",
        "No WhatsApp group on Client Data for this card.",
      );
      expect((await recap(1)).state).toBe("queued");
      await messageTo(msgs[1], "skipped", "Skipped by the CEO.");
      expect(await recap(1)).toMatchObject({
        state: "skipped",
        reason: "Skipped by the CEO.",
      });
      // 2. failed, then skipped: the effect stays failed, and nothing is refused.
      for (const s of ["approved", "claimed", "sending"])
        await messageTo(msgs[2], s);
      await messageTo(msgs[2], "failed", "WhatsApp answered 400.");
      expect(await recap(2)).toMatchObject({
        state: "failed",
        reason: "WhatsApp answered 400.",
      });
      await messageTo(msgs[2], "skipped", "Skipped by the CSM.");
      expect(await recap(2)).toMatchObject({
        state: "failed",
        reason: "WhatsApp answered 400.",
      });
      // 3. failed, then reopened (a fix): the effect waits on it again.
      for (const s of ["approved", "claimed", "sending"])
        await messageTo(msgs[3], s);
      await messageTo(msgs[3], "failed", "WhatsApp answered 400.");
      await messageTo(msgs[3], "draft", null, true);
      expect(await recap(3)).toMatchObject({ state: "queued", reason: null });
      // 4. unknown, then reconciled as sent.
      for (const s of ["approved", "claimed", "sending"])
        await messageTo(msgs[4], s);
      await messageTo(
        msgs[4],
        "unknown",
        "The sender stopped while sending. Look in the group before anything else.",
      );
      expect((await recap(4)).state).toBe("unknown");
      await messageTo(msgs[4], "sent");
      expect((await recap(4)).state).toBe("delivered");
      // 5. a draft skipped by a person.
      await messageTo(msgs[5], "skipped", "Skipped by the CSM.");
      expect((await recap(5)).state).toBe("skipped");
      expect(await settleRefused()).toEqual([]);
    });
  });
});

describe("what is never dispatched", () => {
  test("a shadow send and a Make effect make no delivery row, whatever the drafts do", async () => {
    await rolledBack(async () => {
      const { id, rec } = await liveSend();
      const e = await effects(id);
      expect(
        Object.values(e).every(x => ["dry_run", "skipped"].includes(x.state)),
      ).toBe(true);
      await draft("grade", rec, { state: "ready" });
      await draft(
        "recap",
        rec,
        { state: "ready", text: RECAP },
        { responseId: id },
      );
      await sweep();
      expect(await deliveries()).toEqual({ queue: 0, notices: 0, messages: 0 });
    });
    await rolledBack(async () => {
      await flip({
        call_form: "cockpit",
        call_match: "cockpit",
        todo_comment: "make",
        happiness: "cockpit",
        last_poc: "cockpit",
        last_checkin_call: "cockpit",
        grade_notice: "cockpit",
        recap: "cockpit",
      });
      const { id } = await liveSend();
      const e = await effects(id);
      expect(e.todo_comment).toMatchObject({
        owner: "make",
        state: "skipped",
        reason: "Make does this until the switch-over.",
      });
      expect((await queueRows(id)).map(r => r.payload.effectKey)).toEqual([
        "happiness",
        "last_checkin_call",
        "last_poc",
      ]);
    });
  });

  test("a live kickoff or Blueprint response is never dispatched by the submit, the sweep or the drafts trigger (Y49)", async () => {
    await rolledBack(async () => {
      await flip();
      const rec = await recording(A);
      const made: string[] = [];
      for (const form of ["kickoff", "blueprint"]) {
        const id = nextId();
        made.push(id);
        await q(
          `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state,
             answers, created_by, submitted_at)
           VALUES ($1::uuid, $2, 1, 'import', $3, 'Acme Interiors', 'live', 'submitted', $4::jsonb, 'import', now())`,
          [
            id,
            form,
            A,
            JSON.stringify({ call: { kind: "fathom", recordingId: rec } }),
          ],
        );
        for (const [key, delivery] of [
          ["kickoff_notice", "slack_notice"],
          ["grade_notice", "slack_notice"],
          ["recap", "client_message"],
          ["handoff_comment", "clickup_queue"],
        ])
          await q(
            `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
             VALUES ($1::uuid, $2, $3, $1 || ':' || $3, 'cockpit', $4, $5::jsonb, 'planned')`,
            [id, form, key, delivery, JSON.stringify({ recordingId: rec })],
          );
        expect(
          await one("SELECT public.cockpit_form_dispatch($1::uuid) AS r", [id]),
        ).toEqual({
          queued: 0,
          waiting: 0,
          failed: 0,
          skipped: 0,
        });
      }
      // The drafts trigger: a grade of that recording and a recap of each response leave drafting.
      await draft("grade", rec, { state: "ready" });
      for (const [i, id] of made.entries())
        await q(
          `INSERT INTO public.cockpit_form_drafts(form_key, task_id, recording_id, response_id, kind, attempt, provider,
             prompt_version, input_sha256, state, created_by)
           VALUES ('checkin', $1, $2, $3::uuid, 'recap', $4, 'anthropic', 'checkin.recap.v1', $5, 'drafting', 'server')`,
          [A, rec, id, i + 1, sha(id)],
        );
      await q(
        "UPDATE public.cockpit_form_drafts SET state = 'ready', text = 'Invented.' WHERE kind = 'recap' AND state = 'drafting'",
      );
      await sweep();
      await sweep();
      expect(await deliveries()).toEqual({ queue: 0, notices: 0, messages: 0 });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_form_effects WHERE response_id = ANY($1::uuid[]) AND state = 'planned' AND reason IS NULL",
          [made],
        ),
      ).toBe(8);
    });
  });
});

describe("the sweep", () => {
  test("30 minutes after the send it fails what is still planned, each with its sentence", async () => {
    await rolledBack(async () => {
      await flip();
      const { id } = await liveSend();
      // A ClickUp effect whose insert keeps failing (a stand-in CHECK refusing 'form').
      await ex(`
        ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
        ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
          CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action')) NOT VALID;`);
      const other = await liveSend();
      await nativeAnHourAgo();
      await q(
        "UPDATE public.cockpit_form_responses SET submitted_at = now() - interval '31 minutes' WHERE id = ANY($1::uuid[])",
        [[id, other.id]],
      );
      const out = await sweep();
      expect(out.timedOut).toBe(2 + 2 + 4);
      const e = await effects(id);
      expect(e.grade_notice).toMatchObject({
        state: "failed",
        reason: SENTENCE.noGrader,
      });
      expect(e.recap).toMatchObject({
        state: "failed",
        reason: SENTENCE.noDrafter,
      });
      const o = await effects(other.id);
      expect(o.happiness.state).toBe("failed");
      expect(o.happiness.reason).toContain(
        "cockpit_clickup_writeback_queue_kind_check",
      );
    });
  });

  test("a queue insert refused by a CHECK keeps the effect planned with its reason, and the notes commit", async () => {
    await rolledBack(async () => {
      await flip();
      await ex(`
        ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
        ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
          CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action')) NOT VALID;`);
      const { id, out } = await liveSend();
      expect(out.response.state).toBe("submitted");
      const e = await effects(id);
      expect(e.call_form.state).toBe("delivered");
      for (const k of [
        "todo_comment",
        "happiness",
        "last_poc",
        "last_checkin_call",
      ]) {
        expect(e[k].state).toBe("planned");
        expect(e[k].reason).toBe(
          'new row for relation "cockpit_clickup_writeback_queue" violates check constraint "cockpit_clickup_writeback_queue_kind_check"',
        );
      }
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_csm_call_forms WHERE token = $1",
          [`cockpit:${id}`],
        ),
      ).toBe(1);
      // The writer's lane back: the next sweep queues them.
      await ex(`
        ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
        ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
          CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));`);
      await sweep();
      expect((await queueRows(id)).length).toBe(4);
      expect((await effects(id)).happiness).toMatchObject({
        state: "queued",
        reason: null,
      });
    });
  });

  test("the registry taking an effect back skips it with Make owns this again", async () => {
    await rolledBack(async () => {
      await flip();
      const { id } = await liveSend();
      await as(
        ADMIN,
        'SELECT public.cockpit_form_registry_set(\'checkin\', \'{"owners":{"grade_notice":"shadow"}}\') AS r',
      );
      await sweep();
      const e = await effects(id);
      expect(e.grade_notice).toMatchObject({
        state: "skipped",
        reason: SENTENCE.make,
      });
      expect(e.recap).toMatchObject({
        state: "planned",
        reason: SENTENCE.waitRecap,
      });
    });
  });

  test("idempotent: the sweep twice, the trigger then the sweep, and the same send again add nothing", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      await draft("grade", s.rec, { state: "ready" });
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id },
      );
      const snap = async () => ({
        ...(await deliveries()),
        audit: await count("SELECT count(*) n FROM public.cockpit_audit_log"),
        effects: await q(
          "SELECT effect_key, state, reason, delivery_ref FROM public.cockpit_form_effects WHERE response_id = $1::uuid ORDER BY effect_key",
          [s.id],
        ),
      });
      const before = await snap();
      expect(before).toMatchObject({ queue: 4, notices: 1, messages: 1 });
      await sweep();
      await sweep();
      expect(
        await one("SELECT public.cockpit_form_dispatch($1::uuid) AS r", [s.id]),
      ).toEqual({
        queued: 0,
        waiting: 0,
        failed: 0,
        skipped: 0,
      });
      const again = await as<Row>(
        CSM,
        "SELECT public.cockpit_form_submit($1::uuid, NULL) AS r",
        [s.id],
      );
      expect(again.duplicate).toBe(true);
      expect(await snap()).toEqual(before);
    });
  });

  test("the waiting reason is written once across the send, a trigger and three sweeps; a changed error writes one more", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      const grade = (await effects(s.id)).grade_notice;
      expect(await reasonRows(grade.id)).toBe(1);
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id },
      );
      for (let i = 0; i < 3; i++) await sweep();
      expect(await reasonRows(grade.id)).toBe(1);
      expect((await effects(s.id)).grade_notice.reason).toBe(
        SENTENCE.waitGrade,
      );
      // The notice insert fails now: its error is the reason, once; later sweeps keep it.
      await ex(`
        ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
        ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
          CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','rehearsal')) NOT VALID;`);
      await draft("grade", s.rec, { state: "ready" });
      await sweep();
      await sweep();
      const after = (await effects(s.id)).grade_notice;
      expect(after.state).toBe("planned");
      expect(after.reason).toContain("cockpit_slack_notices_kind_check");
      expect(await reasonRows(grade.id)).toBe(2);
      const rows = await q<Row>(
        "SELECT before, after, metadata FROM public.cockpit_audit_log WHERE action = 'forms.effect_reason' AND entity_id = $1 ORDER BY test_seq",
        [grade.id],
      );
      expect(rows[0]).toMatchObject({
        before: { reason: null },
        after: { reason: SENTENCE.waitGrade },
      });
      expect(rows[0].metadata).toEqual({
        effectId: grade.id,
        responseId: s.id,
        state: "planned",
      });
      expect(rows[1].before).toEqual({ reason: SENTENCE.waitGrade });
    });
  });

  test("a failed recap with no message is requeued by a later ready recap within 24 hours, and not after", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      await draft(
        "recap",
        s.rec,
        { state: "failed", reason: "The model did not answer." },
        { responseId: s.id },
      );
      expect((await effects(s.id)).recap).toMatchObject({
        state: "failed",
        reason: "No recap: The model did not answer.",
      });
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id, again: true },
      );
      const [m] = await q<Row>(
        "SELECT id::text FROM public.cockpit_client_messages WHERE response_id = $1::uuid",
        [s.id],
      );
      expect((await effects(s.id)).recap).toMatchObject({
        state: "queued",
        delivery_ref: m.id,
        reason: null,
      });
    });
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      await draft(
        "recap",
        s.rec,
        { state: "failed", reason: "The model did not answer." },
        { responseId: s.id },
      );
      await nativeAnHourAgo();
      await q(
        "UPDATE public.cockpit_form_responses SET submitted_at = now() - interval '25 hours' WHERE id = $1::uuid",
        [s.id],
      );
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id, again: true },
      );
      await sweep();
      expect((await effects(s.id)).recap.state).toBe("failed");
      expect(
        await count("SELECT count(*) n FROM public.cockpit_client_messages"),
      ).toBe(0);
    });
  });

  test("a dispatch that raises outside its per-effect blocks leaves the send committed, the effects planned and forms-effects-kick not ok", async () => {
    await rolledBack(async () => {
      await flip();
      // The dispatch runs as a role that may not read the responses: its response read raises.
      await ex(`
        CREATE ROLE dispatch_probe NOLOGIN;
        GRANT USAGE ON SCHEMA public TO dispatch_probe;
        GRANT EXECUTE ON FUNCTION public.cockpit_form_effects_health(boolean,text,jsonb) TO dispatch_probe;
        ALTER FUNCTION public.cockpit_form_dispatch(uuid) OWNER TO dispatch_probe;`);
      const { id, out } = await liveSend();
      expect(out.response.state).toBe("submitted");
      const e = await effects(id);
      expect(e.call_form.state).toBe("delivered");
      for (const k of [
        "todo_comment",
        "happiness",
        "last_poc",
        "last_checkin_call",
        "grade_notice",
        "recap",
      ])
        expect(e[k]).toMatchObject({ state: "planned", reason: null });
      expect(await health()).toMatchObject({
        ok: false,
        note: SENTENCE.dispatchFailed(
          "permission denied for table cockpit_form_responses",
        ),
      });
      expect(await deliveries()).toEqual({ queue: 0, notices: 0, messages: 0 });
    });
  });
});

describe("the native window: nothing is queued or asked for outside it", () => {
  const dispatch = (id: string) =>
    one<Row>("SELECT public.cockpit_form_dispatch($1::uuid) AS r", [id]);
  const waiting = () =>
    as<Row[]>("service", "SELECT public.cockpit_form_effects_waiting() AS r");
  const rollBackProviderOnly = () =>
    one(
      `SELECT public.cockpit_form_registry_apply('checkin', '{"provider":"typeform"}'::jsonb,
         '{"via":"cutover-rollback","email":"cut-over"}'::jsonb) AS r`,
    );
  const vault = () =>
    q(
      "INSERT INTO vault.secrets(name, secret) VALUES ('cockpit_notices_cron_secret', 'cron-secret-for-tests'), ('cockpit_anon_key', 'anon-key-for-tests')",
    );
  const posts = () => count("SELECT count(*) n FROM net.posted");
  const OUTBOX_EFFECTS = [
    "grade_notice",
    "happiness",
    "last_checkin_call",
    "last_poc",
    "recap",
    "todo_comment",
  ];
  /**
   * A live response with all six outbox effects still planned: the dispatch is
   * silenced for the send and put back after it, in this rolled-back
   * transaction. It stands for the response only owner SQL can make, and for a
   * send whose dispatch never ran.
   */
  async function plannedSend() {
    const [{ def }] = await q<Row>(
      "SELECT pg_get_functiondef('public.cockpit_form_dispatch(uuid)'::regprocedure) AS def",
    );
    await ex(`CREATE OR REPLACE FUNCTION public.cockpit_form_dispatch(p_response_id uuid)
      RETURNS jsonb LANGUAGE sql AS $silent$ SELECT '{}'::jsonb $silent$`);
    const s = await liveSend();
    await ex(def);
    const e = await effects(s.id);
    expect(OUTBOX_EFFECTS.map(k => [k, e[k].state, e[k].owner])).toEqual(
      OUTBOX_EFFECTS.map(k => [k, "planned", "cockpit"]),
    );
    return s;
  }
  async function everyOutboxEffectSkipped(id: string) {
    const e = await effects(id);
    expect(OUTBOX_EFFECTS.map(k => [k, e[k].state, e[k].reason])).toEqual(
      OUTBOX_EFFECTS.map(k => [k, "skipped", SENTENCE.make]),
    );
  }

  test("provider typeform with every owner cockpit: the dispatch queues nothing, the list is empty and the kick posts nothing", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await plannedSend();
      await rollBackProviderOnly();
      await vault();
      // The owners stayed the cockpit's: only the provider says no.
      expect(
        await one(
          "SELECT public.cockpit_form_effect_owner('checkin', 'recap') AS r",
        ),
      ).toBe("cockpit");
      expect(await waiting()).toEqual([]);
      expect(await dispatch(s.id)).toEqual({
        queued: 0,
        waiting: 0,
        failed: 0,
        skipped: 6,
      });
      await everyOutboxEffectSkipped(s.id);
      expect(await deliveries()).toEqual({ queue: 0, notices: 0, messages: 0 });
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await posts()).toBe(0);
      expect(await health()).toMatchObject({
        ok: true,
        note: "Nothing waiting.",
      });
    });
  });

  test("the CEO seat's provider-only rollback after a real send: a draft finishing later queues no grade and no recap, and nothing is asked for", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      expect(await deliveries()).toEqual({ queue: 4, notices: 0, messages: 0 });
      await rollBackProviderOnly();
      await vault();
      expect(await waiting()).toEqual([]);
      // Both drafts come back after the rollback; their trigger dispatches.
      await draft("grade", s.rec, { state: "ready" });
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id },
      );
      expect(await deliveries()).toEqual({ queue: 4, notices: 0, messages: 0 });
      const e = await effects(s.id);
      expect([e.grade_notice.state, e.grade_notice.reason]).toEqual([
        "skipped",
        SENTENCE.make,
      ]);
      expect([e.recap.state, e.recap.reason]).toEqual([
        "skipped",
        SENTENCE.make,
      ]);
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await posts()).toBe(0);
    });
  });

  test("a response from before this flip, at a second cut-over: skipped with no draft asked for; a send after the flip still queues", async () => {
    await rolledBack(async () => {
      await flip();
      const old = await plannedSend();
      await one(
        `SELECT public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}'::jsonb,
           '{"via":"cutover-rollback","email":"cut-over"}'::jsonb) AS r`,
      );
      // Ten minutes between the hours: young enough to ask a draft for, had the window not said no.
      await q(
        "UPDATE public.cockpit_form_responses SET submitted_at = now() - interval '10 minutes' WHERE id = $1::uuid",
        [old.id],
      );
      await flip();
      await vault();
      expect(await waiting()).toEqual([]);
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await posts()).toBe(0);
      await everyOutboxEffectSkipped(old.id);
      expect(await deliveries()).toEqual({ queue: 0, notices: 0, messages: 0 });

      const fresh = await liveSend();
      expect((await effects(fresh.id)).happiness.state).toBe("queued");
      expect(await deliveries()).toEqual({ queue: 4, notices: 0, messages: 0 });
      expect((await waiting()).map(r => r.responseId)).toEqual([
        fresh.id,
        fresh.id,
      ]);
    });
  });

  test("a failed recap outside the window stays failed, with no message", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      await draft(
        "recap",
        s.rec,
        { state: "failed", reason: "The model did not answer." },
        { responseId: s.id },
      );
      expect((await effects(s.id)).recap.state).toBe("failed");
      await rollBackProviderOnly();
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id, again: true },
      );
      expect((await effects(s.id)).recap.state).toBe("failed");
      await sweep();
      expect((await effects(s.id)).recap.state).toBe("failed");
      expect(
        await count("SELECT count(*) n FROM public.cockpit_client_messages"),
      ).toBe(0);
    });
  });
});

describe("a rollback's leftovers at a later cut-over (Z70)", () => {
  test("what the first hour left open (no forms run between the hours, a draft recap) is refused at the second hour, and nothing old is written", async () => {
    await rolledBack(async () => {
      const cutover = () =>
        one<Row>("SELECT public.cockpit_form_checkin_cutover() AS r");
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at)
         VALUES ('tf-placed-0001', 'fRokTITH', 'checkin', $1, 'hidden_field', $2)`,
        [A, ago(600)],
      );
      const writer = (mode: "dry_run" | "apply") =>
        as(
          "service",
          "SELECT public.cockpit_clickup_forms_state(true, 'Nothing to write.', $1, NULL, '{}'::jsonb) AS r",
          [mode],
        );
      let claims = 0;
      const claimForms = () =>
        as<Row[]>(
          "service",
          "SELECT public.cockpit_clickup_writeback_claim_forms($1::uuid) AS r",
          [`7a000000-0000-4000-8000-${String(++claims).padStart(12, "0")}`],
        );
      const gate = (delivery: string, ref: string) =>
        one<Row>("SELECT public.cockpit_form_effect_gate($1, $2) AS r", [
          delivery,
          ref,
        ]);

      // The first hour: a live send, its grade and its recap. One row is in
      // retry and one unknown when the hour is rolled back.
      await cutover();
      const s = await liveSend();
      await draft("grade", s.rec, { state: "ready" });
      await draft(
        "recap",
        s.rec,
        { state: "ready", text: RECAP },
        { responseId: s.id },
      );
      const rows = Object.fromEntries(
        (await queueRows(s.id)).map(r => [r.payload.effectKey, r]),
      );
      await queueTo(rows.happiness.id, "sending");
      await queueTo(rows.happiness.id, "retry", {
        error: "ClickUp was busy.",
      });
      await queueTo(rows.last_poc.id, "unknown", {
        error: "No answer from ClickUp.",
      });
      const [notice] = await q<Row>(
        "SELECT id::text FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
        [`grade:${s.rec}`],
      );
      const [message] = await q<Row>(
        "SELECT id::text, body FROM public.cockpit_client_messages WHERE response_id = $1::uuid",
        [s.id],
      );
      const states = async () =>
        Object.fromEntries(
          (await queueRows(s.id)).map(r => [r.payload.effectKey, r.state]),
        );
      const open = {
        todo_comment: "queued",
        happiness: "retry",
        last_poc: "unknown",
        last_checkin_call: "queued",
      };
      expect(await states()).toEqual(open);

      // The rollback (11.3): the registry back and the writer a dry run. No
      // forms run comes before the next hour (its function down, say), and
      // nothing ever claims a draft recap, so all of it is still open then.
      await one(
        `SELECT public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}'::jsonb,
           '{"via":"cutover-rollback","email":"cut-over"}'::jsonb) AS r`,
      );
      await writer("dry_run");
      expect(await states()).toEqual(open);
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_client_messages WHERE id = $1::uuid",
          [message.id],
        ),
      ).toBe("draft");

      // The second hour, days later (this transaction shares one clock, so the
      // first send is dated back to stand for them).
      await q(
        "UPDATE public.cockpit_form_responses SET submitted_at = now() - interval '2 days' WHERE id = $1::uuid",
        [s.id],
      );
      expect((await cutover()).registry.provider).toBe("native");
      for (const key of Object.keys(open))
        expect(await gate("clickup_queue", rows[key].id)).toMatchObject({
          ok: false,
          responseId: s.id,
          effectKey: key,
          reason: SENTENCE.make,
        });
      expect(await gate("slack_notice", notice.id)).toMatchObject({
        ok: false,
        effectKey: "grade_notice",
        reason: SENTENCE.make,
      });
      expect(await gate("client_message", message.id)).toMatchObject({
        ok: false,
        effectKey: "recap",
        reason: SENTENCE.make,
      });

      // The writer opens: nothing of the first hour reaches it. The queued and
      // retry rows are skipped, the unknown one fails with the check-the-card sentence.
      await writer("apply");
      expect(await claimForms()).toEqual([]);
      const settled = Object.fromEntries(
        (await queueRows(s.id)).map(r => [
          r.payload.effectKey,
          [r.state, r.error],
        ]),
      );
      expect(settled).toEqual({
        todo_comment: ["skipped", SENTENCE.make],
        happiness: ["skipped", SENTENCE.make],
        last_poc: [
          "failed",
          "Make owns this again. An earlier try may have reached the card, so check it in ClickUp.",
        ],
        last_checkin_call: ["skipped", SENTENCE.make],
      });
      const e = await effects(s.id);
      expect(Object.keys(open).map(k => [k, e[k].state, e[k].reason])).toEqual([
        ["todo_comment", "skipped", SENTENCE.make],
        ["happiness", "skipped", SENTENCE.make],
        [
          "last_poc",
          "failed",
          "Make owns this again. An earlier try may have reached the card, so check it in ClickUp.",
        ],
        ["last_checkin_call", "skipped", SENTENCE.make],
      ]);

      // The first hour's recap cannot be approved; it stays a draft for Skip.
      expect(
        await refusal(() =>
          as(
            "service",
            "SELECT public.cockpit_client_message_approve($1::uuid, $2, $3, $4::uuid, '{}'::text[]) AS r",
            [message.id, message.body, sha(message.body), CSM],
          ),
        ),
      ).toEqual({
        code: "22023",
        message:
          "This recap is from before the latest switch-over, so it is not sent from here. Press Skip.",
      });
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_client_messages WHERE id = $1::uuid",
          [message.id],
        ),
      ).toBe("draft");

      // A send of the second hour reaches the writer.
      const next = await liveSend();
      const nextRows = (await queueRows(next.id)).map(r => r.id).sort();
      expect(nextRows).toHaveLength(4);
      expect(
        (await claimForms()).map((r: Row) => r.id as string).sort(),
      ).toEqual(nextRows);
    });
  });
});

describe("the cut-over and the writer's mode, through the hour's steps", () => {
  const OPEN =
    "Limit the 1-1 notes writer to the test card at step 6 first: it last reported apply, which writes on every client's card.";
  const TEST_CARD = "86eywg1cq";

  test("apply is refused and writes nothing, step 6's limit passes, and a rollback then a second hour runs once the writer is limited again", async () => {
    await rolledBack(async () => {
      const cutover = () =>
        one<Row>("SELECT public.cockpit_form_checkin_cutover() AS r");
      const refused = async () => {
        const before = await count(
          "SELECT count(*) n FROM public.cockpit_audit_log",
        );
        expect(await refusal(cutover)).toEqual({
          code: "55000",
          message: OPEN,
        });
        expect(
          await count("SELECT count(*) n FROM public.cockpit_audit_log"),
        ).toBe(before);
        expect(
          await one(
            "SELECT provider AS r FROM public.cockpit_forms WHERE key = 'checkin'",
          ),
        ).toBe("typeform");
      };
      const writer = (mode: string, cards: string[] | null = null) =>
        as(
          "service",
          "SELECT public.cockpit_clickup_forms_state(true, 'Nothing to write.', $1, $2::text[], '{}'::jsonb) AS r",
          [mode, cards],
        );
      const reads = () =>
        one<Row>("SELECT public.cockpit_clickup_forms_mode() AS r");
      const rollback = () =>
        one(
          `SELECT public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}'::jsonb,
             '{"via":"cutover-rollback","email":"cut-over"}'::jsonb) AS r`,
        );
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at)
         VALUES ('tf-placed-0002', 'fRokTITH', 'checkin', $1, 'hidden_field', $2)`,
        [A, ago(600)],
      );

      // The secret is on and the canary list is not.
      await writer("apply");
      expect((await reads()).mode).toBe("apply");
      await refused();
      // The report goes stale: the mode reads unknown, the writer has not closed.
      await q(
        `UPDATE public.cockpit_sync_state
            SET last_run_at = now() - interval '20 minutes',
                detail = detail || jsonb_build_object('at', now() - interval '20 minutes')
          WHERE key = 'clickup-writeback:forms'`,
      );
      expect(await reads()).toMatchObject({
        mode: "unknown",
        lastMode: "apply",
      });
      await refused();

      // Step 6, then 7b.
      await writer("apply_limited", [TEST_CARD]);
      expect(await reads()).toMatchObject({
        mode: "apply_limited",
        onlyCards: [TEST_CARD],
      });
      expect((await cutover()).registry.provider).toBe("native");

      // Step 9 opens it to all; the hour is rolled back with the secret still set.
      await writer("apply");
      await rollback();
      await refused();
      // 11.3 unsets the secret: the next report is dry_run. A second hour starts at step 6.
      await writer("dry_run");
      await writer("apply_limited", [TEST_CARD]);
      expect((await cutover()).registry.provider).toBe("native");

      // A rollback before step 9 leaves the limit on, and the next hour passes on it.
      await rollback();
      expect((await reads()).mode).toBe("apply_limited");
      expect((await cutover()).registry.provider).toBe("native");
    });
  });
});

describe("the forms door's readers and the kick", () => {
  test("cockpit_form_drafts_service answers as cockpit_form_drafts_read does, for the service key only", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      await draft("grade", s.rec, { state: "ready" });
      const seat = await as<Row>(
        CSM,
        "SELECT public.cockpit_form_drafts_read($1::uuid) AS r",
        [s.id],
      );
      const service = await as<Row>(
        "service",
        "SELECT public.cockpit_form_drafts_service($1::uuid) AS r",
        [s.id],
      );
      delete seat.now;
      delete service.now;
      expect(service).toEqual(seat);
      expect(service.recordingId).toBe(s.rec);
      expect(
        (
          await refusal(() =>
            as(
              CSM,
              "SELECT public.cockpit_form_drafts_service($1::uuid) AS r",
              [s.id],
            ),
          )
        ).code,
      ).toBe("42501");
      expect(
        await refusal(() =>
          as(
            "service",
            "SELECT public.cockpit_form_drafts_service($1::uuid) AS r",
            [nextId()],
          ),
        ),
      ).toEqual({
        code: "22023",
        message: "Open the notes from the client page.",
      });
    });
  });

  test("cockpit_form_effects_waiting lists a grade or recap no draft has begun, with the seat and the response", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      const e = await effects(s.id);
      const rows = await as<Row[]>(
        "service",
        "SELECT public.cockpit_form_effects_waiting() AS r",
      );
      expect(rows.map(r => [r.kind, r.effectId])).toEqual(
        expect.arrayContaining([
          ["grade", e.grade_notice.id],
          ["recap", e.recap.id],
        ]),
      );
      const g = rows.find(r => r.kind === "grade") as Row;
      expect(Object.keys(g).sort()).toEqual(
        [
          "actorId",
          "draftState",
          "effectId",
          "kind",
          "recordingId",
          "response",
          "responseId",
          "since",
          "taskId",
        ].sort(),
      );
      expect(g).toMatchObject({
        responseId: s.id,
        taskId: A,
        recordingId: s.rec,
        draftState: null,
        actorId: CSM,
      });
      expect(g.response).toMatchObject({
        id: s.id,
        formKey: "checkin",
        mode: "live",
        state: "submitted",
      });
      // A draft begun (drafting) takes it off the list.
      await draft("grade", s.rec, null);
      expect(
        (
          await as<Row[]>(
            "service",
            "SELECT public.cockpit_form_effects_waiting() AS r",
          )
        ).map(r => r.kind),
      ).toEqual(["recap"]);
    });
  });

  test("cockpit_form_effects_waiting leaves out an effect the registry has taken back, and the kick asks for no draft for it", async () => {
    await rolledBack(async () => {
      await flip();
      const s = await liveSend();
      const e = await effects(s.id);
      const waiting = () =>
        as<Row[]>(
          "service",
          "SELECT public.cockpit_form_effects_waiting() AS r",
        );
      expect((await waiting()).map(r => r.kind).sort()).toEqual([
        "grade",
        "recap",
      ]);
      // The owner moved in the registry; the effect's own row still says cockpit and planned.
      const recapBack = {
        ...Object.fromEntries(
          (
            await q<Row>(
              "SELECT x->>'key' AS k FROM public.cockpit_forms f, jsonb_array_elements(f.effects) x WHERE f.key = 'checkin'",
            )
          ).map(r => [r.k, "cockpit"]),
        ),
        recap: "make",
      };
      await one(
        'SELECT public.cockpit_form_registry_apply(\'checkin\', $1::jsonb, \'{"via":"cutover","email":"cut-over"}\'::jsonb) AS r',
        [JSON.stringify({ owners: recapBack })],
      );
      expect((await effects(s.id)).recap).toMatchObject({
        id: e.recap.id,
        owner: "cockpit",
        state: "planned",
      });
      expect((await waiting()).map(r => r.kind)).toEqual(["grade"]);
      // Both back: nothing is listed, so the kick posts nothing, with the vault in place.
      await one(
        'SELECT public.cockpit_form_registry_apply(\'checkin\', $1::jsonb, \'{"via":"cutover","email":"cut-over"}\'::jsonb) AS r',
        [JSON.stringify({ owners: { ...recapBack, grade_notice: "make" } })],
      );
      expect(await waiting()).toEqual([]);
      await q(
        "INSERT INTO vault.secrets(name, secret) VALUES ('cockpit_notices_cron_secret', 'cron-secret-for-tests'), ('cockpit_anon_key', 'anon-key-for-tests')",
      );
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await count("SELECT count(*) n FROM net.posted")).toBe(0);
    });
  });

  test("the kick: nothing waiting; a missing vault secret said plainly; one post every 2 minutes at most, with the cron secret", async () => {
    await rolledBack(async () => {
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await health()).toMatchObject({
        ok: true,
        note: "Nothing waiting.",
      });
      await flip();
      await liveSend();
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await health()).toMatchObject({
        ok: false,
        note: SENTENCE.noVault,
      });
      await q(
        "INSERT INTO vault.secrets(name, secret) VALUES ('cockpit_notices_cron_secret', 'cron-secret-for-tests'), ('cockpit_anon_key', 'anon-key-for-tests')",
      );
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).not.toBeNull();
      expect(await q("SELECT url, body, headers FROM net.posted")).toEqual([
        {
          url: "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-forms-api",
          body: { op: "effects.sweep" },
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": "cron-secret-for-tests",
            Authorization: "Bearer anon-key-for-tests",
          },
        },
      ]);
      // The door answers when its sweep ends, up to about 100 s (effects.ts
      // SWEEP_BUDGET_MS), so the post outlasts that run rather than hanging up on it.
      expect(await q("SELECT timeout_ms FROM net.posted")).toEqual([
        { timeout_ms: 150000 },
      ]);
      expect(await health()).toMatchObject({
        ok: true,
        note: "Asked the drafts for one set of 1-1 notes.",
      });
      // Within 2 minutes it asks nothing again.
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).toBeNull();
      expect(await count("SELECT count(*) n FROM net.posted")).toBe(1);
      expect((await health()).note).toMatch(
        /^Waiting for the drafts of one set of 1-1 notes; asked at \d\d:\d\d\.$/,
      );
      // Two notes waiting, the last post 3 minutes old: it asks again.
      await liveSend();
      await q(
        "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail, '{postedAt}', to_jsonb(now() - interval '3 minutes')) WHERE key = 'forms-effects-kick'",
      );
      expect(
        await one("SELECT public.cockpit_form_effects_kick() AS r"),
      ).not.toBeNull();
      expect(await count("SELECT count(*) n FROM net.posted")).toBe(2);
      expect((await health()).note).toBe("Asked the drafts for 2 1-1 notes.");
    });
  });

  test("the kick: a vault with only the cron secret, or a blank anon key, posts nothing and reads not ok, because the forms door checks the JWT (D11)", async () => {
    await rolledBack(async () => {
      const kick = () => one("SELECT public.cockpit_form_effects_kick() AS r");
      const refusedPlainly = async () => {
        expect(await kick()).toBeNull();
        expect(await count("SELECT count(*) n FROM net.posted")).toBe(0);
        expect(await health()).toMatchObject({
          ok: false,
          note: SENTENCE.noAnon,
          detail: { waiting: 1 },
        });
      };
      await flip();
      await liveSend();
      await q(
        "INSERT INTO vault.secrets(name, secret) VALUES ('cockpit_notices_cron_secret', 'cron-secret-for-tests')",
      );
      await refusedPlainly();
      await q(
        "INSERT INTO vault.secrets(name, secret) VALUES ('cockpit_anon_key', '   ')",
      );
      await refusedPlainly();
      // Added to the vault: the next minute's kick posts, with the header the door asks for.
      await q(
        "UPDATE vault.secrets SET secret = 'anon-key-for-tests' WHERE name = 'cockpit_anon_key'",
      );
      expect(await kick()).not.toBeNull();
      expect(await q("SELECT headers FROM net.posted")).toEqual([
        {
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": "cron-secret-for-tests",
            Authorization: "Bearer anon-key-for-tests",
          },
        },
      ]);
      expect(await health()).toMatchObject({
        ok: true,
        note: "Asked the drafts for one set of 1-1 notes.",
      });
    });
  });

  test("a dispatch that fails every minute keeps forms-effects-kick not ok through the kick, posting or not, until it works again", async () => {
    await rolledBack(async () => {
      await flip();
      // The dispatch runs as a role that may not read the responses, as in (13).
      await ex(`
        CREATE ROLE dispatch_probe NOLOGIN;
        GRANT USAGE ON SCHEMA public TO dispatch_probe;
        GRANT EXECUTE ON FUNCTION public.cockpit_form_effects_health(boolean,text,jsonb) TO dispatch_probe;
        ALTER FUNCTION public.cockpit_form_dispatch(uuid) OWNER TO dispatch_probe;`);
      const fault = "permission denied for table cockpit_form_responses";
      const failing = { ok: false, note: SENTENCE.dispatchFailed(fault) };
      const kick = () => one("SELECT public.cockpit_form_effects_kick() AS r");
      const neverOk = () =>
        one<boolean>(
          "SELECT last_ok_at IS NULL AS r FROM public.cockpit_sync_state WHERE key = 'forms-effects-kick'",
        );
      const s = await liveSend();
      expect(await health()).toMatchObject(failing);
      expect(await neverOk()).toBe(true);

      // No vault secret: the dispatch fault is the note; the blocked post is kept in the detail.
      expect(await kick()).toBeNull();
      const blocked = await health();
      expect(blocked).toMatchObject(failing);
      expect(blocked.detail).toMatchObject({
        sweep: { responses: 1, errors: 1, firstError: fault, queued: 0 },
        waiting: 1,
        blocked: SENTENCE.noVault,
      });

      // With the vault the post still goes out under its 2-minute rule, and the row stays not ok.
      await q(
        "INSERT INTO vault.secrets(name, secret) VALUES ('cockpit_notices_cron_secret', 'cron-secret-for-tests'), ('cockpit_anon_key', 'anon-key-for-tests')",
      );
      expect(await kick()).not.toBeNull();
      expect(await count("SELECT count(*) n FROM net.posted")).toBe(1);
      const posted = await health();
      expect(posted).toMatchObject(failing);
      expect(posted.detail.postedAt).toMatch(/^\d{4}-/);
      expect(posted.detail.blocked).toBeUndefined();

      // Within 2 minutes it asks nothing again, and still reads not ok.
      expect(await kick()).toBeNull();
      expect(await count("SELECT count(*) n FROM net.posted")).toBe(1);
      expect(await health()).toMatchObject(failing);

      // Nothing waits on a draft (both begun): still not ok.
      await draft("grade", s.rec, null);
      await draft("recap", s.rec, null, { responseId: s.id });
      expect(await kick()).toBeNull();
      expect(await health()).toMatchObject({
        ...failing,
        detail: { waiting: 0 },
      });
      expect(await neverOk()).toBe(true);

      // The dispatch works again: the next kick queues the cards and reads healthy.
      await ex(
        "ALTER FUNCTION public.cockpit_form_dispatch(uuid) OWNER TO postgres",
      );
      expect(await kick()).toBeNull();
      expect(await health()).toMatchObject({
        ok: true,
        note: "Nothing waiting.",
        detail: { sweep: { errors: 0, firstError: null } },
      });
      expect(await neverOk()).toBe(false);
      expect((await effects(s.id)).todo_comment.state).toBe("queued");
    });
  });

  test("the sweep counts a failed dispatch and keeps its first error", async () => {
    await rolledBack(async () => {
      await flip();
      await liveSend();
      await liveSend();
      await ex(`
        CREATE ROLE dispatch_probe NOLOGIN;
        GRANT USAGE ON SCHEMA public TO dispatch_probe;
        GRANT EXECUTE ON FUNCTION public.cockpit_form_effects_health(boolean,text,jsonb) TO dispatch_probe;
        ALTER FUNCTION public.cockpit_form_dispatch(uuid) OWNER TO dispatch_probe;`);
      expect(await sweep()).toMatchObject({
        responses: 2,
        errors: 2,
        firstError: "permission denied for table cockpit_form_responses",
        queued: 0,
      });
    });
  });
});

describe("the effects guard's added moves", () => {
  test("an insert in state delivered only for a kickoff or Blueprint record, under cockpit.forms_record, owned by the cockpit, naming its row", async () => {
    await rolledBack(async () => {
      const ids: Record<string, string> = {};
      for (const form of ["kickoff", "checkin"]) {
        ids[form] = nextId();
        await q(
          `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, mode, state, created_by, submitted_at)
           VALUES ($1::uuid, $2, 1, 'import', $3, 'live', 'submitted', 'import', now())`,
          [ids[form], form, A],
        );
      }
      const insert = (
        form: string,
        key: string,
        owner: string,
        ref: string | null,
      ) =>
        q(
          `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, delivery_ref, state)
           VALUES ($1::uuid, $2, $3, $1 || ':' || $3, $4, 'slack_notice', $5, 'delivered')`,
          [ids[form], form, key, owner, ref],
        );
      expect(
        (
          await refusal(() =>
            insert("kickoff", "kickoff_notice", "cockpit", "n-1"),
          )
        ).message,
      ).toBe("An effect starts planned, dry_run or skipped");
      await q("SELECT set_config('cockpit.forms_record', 'on', true)");
      expect(
        (
          await refusal(() =>
            insert("checkin", "grade_notice", "cockpit", "n-1"),
          )
        ).message,
      ).toBe("An effect starts planned, dry_run or skipped");
      expect(
        (
          await refusal(() =>
            insert("kickoff", "kickoff_notice", "cockpit", null),
          )
        ).message,
      ).toBe("An effect starts planned, dry_run or skipped");
      expect(
        (
          await refusal(() =>
            insert("kickoff", "handoff_comment", "make", "n-1"),
          )
        ).message,
      ).toBe("Only an effect the cockpit owns can be delivered");
      await insert("kickoff", "kickoff_notice", "cockpit", "n-1");
      expect(
        await q(
          "SELECT state, settled_at IS NOT NULL AS settled FROM public.cockpit_form_effects WHERE response_id = $1::uuid",
          [ids.kickoff],
        ),
      ).toEqual([{ state: "delivered", settled: true }]);
      await q("SELECT set_config('cockpit.forms_record', '', true)");
    });
  });
});
