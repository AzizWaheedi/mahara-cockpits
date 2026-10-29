/**
 * The 1-1 notes registry switch, the owner gate and the cut-over function
 * (20261029s_forms_registry.sql; docs/forms/STAGE2B-CONTRACT.md 2.3, 3.1,
 * 3.2, 3.12 and 4.7, build 7) on an isolated PostgreSQL with Supabase's
 * default privileges on, so a missing REVOKE opens a function here as it
 * would in production.
 *
 * It stands on the 2a base of section 8 in order (20261025n, 20261025o,
 * 20261026r, 20261026s, 20261026t, 20261027f, 20261027g, 20261027h over
 * 20261024a), each cut from or applied as its canonical migration the way
 * stage2a-fit-supabase.test.ts stands on them, then 20261029s twice. The
 * delivery paths of later 2b files (the dispatch of 20261029w, the ClickUp
 * lane of 20261029t, the Call grade kind and channel of 20261029u, the
 * recap approval of 20261029v) are stand-ins made inside rolled-back
 * transactions, so each readiness clause is seen missing and then present.
 *
 * Covered: the editor gate's seats and the registry's own refusal sentence;
 * owners by an editor, the provider back to typeform by the CEO seat and the
 * rollback, native only through via 'cutover' (the CEO seat refused too);
 * every refused patch; typeform_id kept; each readiness clause; one audit
 * row per change and none for a no-op; the flip voiding shadow drafts and a
 * live draft opening after it; provider_since and its audit row;
 * cockpit_form_native_since; the rollback restoring the seed; the owner
 * gate's answers, and an earlier switch-over's rows refused at a later one
 * (Z70); the cut-over function's refusals (no Typeform notes in the store among
 * them: missing is never a pass), its answer, every audit row of the
 * hour (step 7a's own SELECT included) credited to the cut-over, and a second
 * hour after a rollback with a live canary send in between; exact grants.
 * The CEO's address is read from the CEO gate migration, never written here;
 * every other person, client and recording is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
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
const EDITOR_ROW = "00000000-0000-4000-8000-0000000000f2"; // media buyer with a forms editor row
const EDITOR_ROLE = "00000000-0000-4000-8000-0000000000f3"; // the forms_editor role
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, switched off
const NOBODY = "00000000-0000-4000-8000-0000000000f5"; // signed in, no cockpit seat
const CSM_EMAIL = "csm@tests.invalid";

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build

const EFFECT_KEYS = [
  "call_form",
  "call_match",
  "todo_comment",
  "happiness",
  "last_poc",
  "last_checkin_call",
  "grade_notice",
  "recap",
];
const SENTENCE = {
  gate: "Only the CEO, an admin or someone they add can change where the 1-1 notes go.",
  otherForm:
    "Only the 1-1 notes change here in 2b. Kickoff and Brand Blueprint keep the Stage 1 path.",
  ceoOnly:
    "Only the CEO switches where the 1-1 notes are filled: it goes with closing the Typeform and turning Make off.",
  nativeOnly:
    "The 1-1 notes open in the cockpit only through the switch-over function at the cut-over hour.",
  sqlFirst:
    "Move the notes row and the recording match to the cockpit with the switch, or the notes reach no client brief.",
  bad: "Change only provider and owners, with make, shadow or cockpit for effects this form has.",
  unplaced:
    "Put the newest Typeform notes on their client from the queue first.",
  noTypeform:
    "The store holds no Typeform notes, so the newest cannot be checked. Run the Typeform sync first.",
  already: "The 1-1 notes already open in the cockpit.",
  none: "No 1-1 notes effect points at this write, so nothing was written.",
  settled: "This write was settled in the cockpit, so nothing was written.",
  make: "Make owns this again.",
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

let base: Map<string, string>;
let once: Map<string, string>;
let auditAfterOnce = 0;
let auditAfterTwice = 0;

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
  base = await functions();
  await db.exec(migration(S));
  once = await functions();
  auditAfterOnce = await count(
    "SELECT count(*) n FROM public.cockpit_audit_log",
  );
  await db.exec(migration(S));
  auditAfterTwice = await count(
    "SELECT count(*) n FROM public.cockpit_audit_log",
  );
  // An editor by row (the editor role needs none).
  await q(
    "INSERT INTO public.cockpit_forms_editors(member_id, added_by) SELECT id, 'test' FROM public.cockpit_members WHERE auth_user_id = $1",
    [EDITOR_ROW],
  );
}, 300_000);
afterAll(async () => {
  await db?.close();
});

// --- Helpers over the registry -------------------------------------------------------------------

const set = (who: string, form: string, patch: unknown) =>
  as<Row>(who, "SELECT public.cockpit_form_registry_set($1, $2::jsonb) AS r", [
    form,
    JSON.stringify(patch),
  ]);
const apply = (patch: unknown, via: string, email = "cut-over") =>
  one<Row>(
    "SELECT public.cockpit_form_registry_apply('checkin', $1::jsonb, $2::jsonb) AS r",
    [JSON.stringify(patch), JSON.stringify({ via, email })],
  );
const checkin = () =>
  q<Row>(
    "SELECT key, provider, typeform_id, version, effects, provider_since, updated_by, updated_at FROM public.cockpit_forms WHERE key = 'checkin'",
  ).then(r => r[0]);
const owners = async () =>
  Object.fromEntries(
    ((await checkin()).effects as Row[]).map(e => [e.key, e.owner]),
  );
const registryAudits = () =>
  q<Row>(
    `SELECT action, actor_email, source_system, before, after, created_at FROM public.cockpit_audit_log
      WHERE entity_type = 'cockpit_forms' AND entity_id = 'checkin' AND action = 'forms.registry_set'
      ORDER BY test_seq`,
  );
/** The transaction's audit actor and source as "actor|source" ('' when unset). */
const auditSettings = () =>
  one<string>(
    "SELECT coalesce(current_setting('cockpit.audit_actor', true), '') || '|' || coalesce(current_setting('cockpit.audit_source', true), '') AS r",
  );

/** Every delivery path of 3.2 as a stand-in for the later 2b files (inside a rolled-back transaction). */
async function standIns(
  only: ("dispatch" | "clickup" | "grade" | "recap")[] = [
    "dispatch",
    "clickup",
    "grade",
    "recap",
  ],
) {
  if (only.includes("dispatch"))
    await ex(`CREATE OR REPLACE FUNCTION public.cockpit_form_dispatch(p_response_id uuid) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`);
  if (only.includes("clickup"))
    await ex(`
      ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
      ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
        CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));
      CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim_forms(p_token uuid, p_limit integer DEFAULT 8)
        RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;`);
  if (only.includes("grade"))
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
      VALUES ('C09SVG6FHGU','client-call-feedback',true,'ok','Stand-in: checked private.','test') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.cockpit_slack_notice_settings(kind, enabled, channel, updated_by)
      VALUES ('checkin.grade', true, 'C09SVG6FHGU', 'test') ON CONFLICT (kind) DO NOTHING;`);
  if (only.includes("recap"))
    await ex(`
      CREATE OR REPLACE FUNCTION public.cockpit_client_message_approve(p_id uuid, p_body text, p_body_sha256 text,
        p_actor uuid, p_warnings text[]) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      CREATE OR REPLACE FUNCTION public.cockpit_client_message_claim(p_kinds text[], p_only_cards text[] DEFAULT NULL,
        p_limit integer DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;`);
}

// --- The live check-in the canary sends (through the window's RPCs) ----------------------------

let seq = 0;
const rid = () => `5b000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
/** A response stored as the seat that owns it: open, save No recording with DEFCON and priority, send. */
async function sendNotes(who: string, task: string, id = rid()) {
  const opened = await as<Row>(
    who,
    "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
    [task, id],
  );
  const saved = await as<Row>(
    who,
    "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-test-0001', $3) AS r",
    [
      id,
      JSON.stringify({
        call: { value: { kind: "none" } },
        defcon: { value: "Happy" },
        priority: { value: "High" },
      }),
      opened.response.revision,
    ],
  );
  return as<Row>(who, "SELECT public.cockpit_form_submit($1::uuid, $2) AS r", [
    id,
    saved.row.revision,
  ]);
}

// ---------------------------------------------------------------------------------------------

describe("the migration", () => {
  test("is one transaction that reloads the schema, adds only its column and functions, and a second apply changes nothing", async () => {
    const sql = migration(S);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    // It replaces no function the 2a base made.
    expect(
      [...base].filter(([sig, v]) => once.get(sig) !== v).map(([s]) => s),
    ).toEqual([]);
    expect([...once.keys()].filter(sig => !base.has(sig)).sort()).toEqual(
      [
        "cockpit_form_checkin_cutover()",
        "cockpit_form_delivery_ready(text,text)",
        "cockpit_form_effect_gate(text,text)",
        "cockpit_form_effect_owner(text,text)",
        "cockpit_form_native_since(text)",
        "cockpit_form_registry_apply(text,jsonb,jsonb)",
        "cockpit_form_registry_set(text,jsonb)",
        "cockpit_form_registry_view(cockpit_forms)",
        "cockpit_form_shadow_close(text)",
        "cockpit_forms_provider_since()",
      ].sort(),
    );
    // The second apply changes no function, grant or row.
    const twice = await functions();
    expect([...once].filter(([sig, v]) => twice.get(sig) !== v)).toEqual([]);
    expect(auditAfterTwice).toBe(auditAfterOnce);
    // It changes no registry row: checkin stays typeform with eight shadow effects.
    const c = await checkin();
    expect(c.provider).toBe("typeform");
    expect(c.typeform_id).toBe("fRokTITH");
    expect(c.provider_since).toBeNull();
    expect(Object.values(await owners())).toEqual(
      EFFECT_KEYS.map(() => "shadow"),
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_forms'",
      ),
    ).toBe(3);
    // The column and its trigger.
    expect(
      await q(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cockpit_forms' AND column_name = 'provider_since'`,
      ),
    ).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
    expect(
      await q(
        "SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.cockpit_forms'::regclass AND NOT tgisinternal ORDER BY tgname",
      ),
    ).toEqual([
      { tgname: "cockpit_forms_audit", tgenabled: "O" },
      { tgname: "cockpit_forms_no_delete", tgenabled: "O" },
      { tgname: "cockpit_forms_no_truncate", tgenabled: "O" },
      { tgname: "cockpit_forms_provider_since", tgenabled: "O" },
    ]);
  });

  test("grants: the browser RPC to authenticated only, every other function to no role", async () => {
    const acl = async (sig: string) =>
      one<string | null>(
        "SELECT p.proacl::text AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
        [`public.${sig}`],
      );
    expect(await acl("cockpit_form_registry_set(text,jsonb)")).toBe(
      "{postgres=X/postgres,authenticated=X/postgres}",
    );
    for (const sig of [
      "cockpit_forms_provider_since()",
      "cockpit_form_effect_owner(text,text)",
      "cockpit_form_native_since(text)",
      "cockpit_form_registry_view(public.cockpit_forms)",
      "cockpit_form_delivery_ready(text,text)",
      "cockpit_form_effect_gate(text,text)",
      "cockpit_form_shadow_close(text)",
      "cockpit_form_registry_apply(text,jsonb,jsonb)",
      "cockpit_form_checkin_cutover()",
    ])
      expect(await acl(sig)).toBe("{postgres=X/postgres}");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(
        await one<boolean>(
          "SELECT has_function_privilege($1, 'public.cockpit_form_checkin_cutover()', 'EXECUTE') AS r",
          [role],
        ),
      ).toBe(false);
      expect(
        await one<boolean>(
          "SELECT has_function_privilege($1, 'public.cockpit_form_registry_set(text,jsonb)', 'EXECUTE') AS r",
          [role],
        ),
      ).toBe(role === "authenticated");
    }
    // The service key cannot reach the core, the gate or the cut-over.
    for (const text of [
      'SELECT public.cockpit_form_registry_apply(\'checkin\', \'{"owners":"cockpit"}\', \'{"via":"cutover"}\') AS r',
      "SELECT public.cockpit_form_effect_gate('clickup_queue', 'x') AS r",
      "SELECT public.cockpit_form_checkin_cutover() AS r",
    ])
      expect((await refusal(() => as("service", text))).code).toBe("42501");
    // cockpit_forms keeps row security and no browser grant.
    expect(
      await q(
        "SELECT relrowsecurity, relacl::text AS acl FROM pg_class WHERE oid = 'public.cockpit_forms'::regclass",
      ),
    ).toEqual([
      {
        relrowsecurity: true,
        acl: "{postgres=arwdDxtm/postgres,service_role=r/postgres}",
      },
    ]);
  });
});

describe("cockpit_form_registry_set: the editor gate", () => {
  test("a CSM-only seat, a switched-off seat and a sign-in with no seat get 42501 with the registry's sentence", async () => {
    for (const who of [CSM, GONE, NOBODY])
      expect(
        await refusal(() =>
          set(who, "checkin", { owners: { call_form: "shadow" } }),
        ),
      ).toEqual({ code: "42501", message: SENTENCE.gate });
    // Signed out: no grant at all.
    expect(
      (
        await refusal(() =>
          as(
            null as unknown as string,
            "SELECT public.cockpit_form_registry_set('checkin', '{}') AS r",
          ),
        )
      ).code,
    ).toBe("42501");
  });

  test("an admin, the CEO, an editor row and the editor role change owners; each change writes one audit row", async () => {
    await rolledBack(async () => {
      const before = (await registryAudits()).length;
      const v1 = await set(ADMIN, "checkin", {
        owners: { call_form: "cockpit" },
      });
      expect(v1.effects.find((e: Row) => e.key === "call_form").owner).toBe(
        "cockpit",
      );
      await set(CEO, "checkin", { owners: { call_match: "cockpit" } });
      await set(EDITOR_ROW, "checkin", { owners: { call_form: "make" } });
      await set(EDITOR_ROLE, "checkin", { owners: { call_match: "make" } });
      const rows = await registryAudits();
      expect(rows.length - before).toBe(4);
      // The seat's own address names each row (the 2a audit reads auth.uid()).
      expect(rows.slice(before).map(r => r.actor_email)).toEqual([
        "admin@tests.invalid",
        CEO_EMAIL,
        "buyer.editor@tests.invalid",
        "forms.editor@tests.invalid",
      ]);
      expect(rows.at(-1)?.before.effects[1].owner).toBe("cockpit");
      expect(rows.at(-1)?.after.effects[1].owner).toBe("make");
      // Only owners moved: key, delivery and label kept; typeform_id and the provider untouched.
      const c = await checkin();
      expect(c.provider).toBe("typeform");
      expect(c.typeform_id).toBe("fRokTITH");
      expect(c.provider_since).toBeNull();
      expect(c.updated_by).toBe("forms.editor@tests.invalid");
      expect((c.effects as Row[]).map(e => Object.keys(e).sort())).toEqual(
        EFFECT_KEYS.map(() => ["delivery", "key", "label", "owner"]),
      );
    });
  });

  test("a no-op returns the view and writes nothing; the view carries no address", async () => {
    await rolledBack(async () => {
      const before = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log",
      );
      const c0 = await checkin();
      const v = await set(ADMIN, "checkin", { owners: "shadow" });
      const v2 = await set(CEO, "checkin", {
        provider: "typeform",
        owners: { recap: "shadow" },
      });
      expect(v2).toEqual(v);
      expect(
        await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      ).toBe(before);
      expect((await checkin()).updated_at).toEqual(c0.updated_at);
      expect(Object.keys(v).sort()).toEqual([
        "effects",
        "key",
        "nativeSince",
        "provider",
        "title",
        "typeformId",
        "updatedAt",
        "version",
      ]);
      expect(v).toMatchObject({
        key: "checkin",
        title: "1-1 call notes",
        provider: "typeform",
        typeformId: "fRokTITH",
        version: 1,
        nativeSince: null,
      });
      expect(v.effects).toEqual(c0.effects);
      expect(JSON.stringify(v)).not.toContain("@");
    });
  });

  test("every refused patch names what may change, and nothing is written", async () => {
    await rolledBack(async () => {
      const before = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log",
      );
      for (const patch of [
        [],
        "cockpit",
        {},
        { owners: "cockpit", typeform_id: "AAAAAAAA" },
        { version: 2 },
        { provider: "clickup" },
        { provider: 1 },
        { owners: "everyone" },
        { owners: [] },
        { owners: {} },
        { owners: { not_an_effect: "cockpit" } },
        { owners: { call_form: "nobody" } },
        { owners: { call_form: true } },
        { label: "x" },
      ])
        expect(await refusal(() => set(ADMIN, "checkin", patch))).toEqual({
          code: "22023",
          message: SENTENCE.bad,
        });
      for (const form of ["kickoff", "blueprint"])
        expect(
          await refusal(() => set(CEO, form, { owners: "cockpit" })),
        ).toEqual({ code: "22023", message: SENTENCE.otherForm });
      expect(
        await refusal(() => set(CEO, "nope", { owners: "cockpit" })),
      ).toEqual({ code: "22023", message: "There is no form called nope." });
      expect(
        await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      ).toBe(before);
    });
  });
});

describe("the provider", () => {
  test("native is refused for every seat, the CEO included, and allowed only through via 'cutover'", async () => {
    await rolledBack(async () => {
      await standIns();
      for (const who of [CEO, ADMIN, EDITOR_ROW, EDITOR_ROLE])
        expect(
          await refusal(() =>
            set(who, "checkin", { provider: "native", owners: "cockpit" }),
          ),
        ).toEqual({ code: "42501", message: SENTENCE.nativeOnly });
      expect(
        await refusal(() =>
          apply({ provider: "native", owners: "cockpit" }, "cutover-rollback"),
        ),
      ).toEqual({ code: "42501", message: SENTENCE.nativeOnly });
      expect((await checkin()).provider).toBe("typeform");
      const v = await apply(
        { provider: "native", owners: "cockpit" },
        "cutover",
      );
      expect(v.provider).toBe("native");
      expect(v.typeformId).toBe("fRokTITH");
      expect(v.effects.map((e: Row) => e.owner)).toEqual(
        EFFECT_KEYS.map(() => "cockpit"),
      );
    });
  });

  test("native needs the notes row and the recording match on the cockpit", async () => {
    await rolledBack(async () => {
      await standIns();
      for (const owners of [
        "shadow",
        { call_form: "cockpit" },
        { call_match: "cockpit", call_form: "make" },
      ])
        expect(
          await refusal(() => apply({ provider: "native", owners }, "cutover")),
        ).toEqual({ code: "22023", message: SENTENCE.sqlFirst });
      const v = await apply(
        {
          provider: "native",
          owners: { call_form: "cockpit", call_match: "cockpit" },
        },
        "cutover",
      );
      expect(v.provider).toBe("native");
      // While native, the two SQL effects cannot leave the cockpit.
      expect(
        await refusal(() =>
          set(ADMIN, "checkin", { owners: { call_match: "shadow" } }),
        ),
      ).toEqual({ code: "22023", message: SENTENCE.sqlFirst });
    });
  });

  test("an admin and an editor cannot move the provider back; the CEO and the cut-over's rollback can", async () => {
    await rolledBack(async () => {
      await standIns();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      for (const who of [ADMIN, EDITOR_ROW, EDITOR_ROLE])
        expect(
          await refusal(() =>
            set(who, "checkin", { provider: "typeform", owners: "shadow" }),
          ),
        ).toEqual({ code: "42501", message: SENTENCE.ceoOnly });
      const v = await set(CEO, "checkin", {
        provider: "typeform",
        owners: "shadow",
      });
      expect(v.provider).toBe("typeform");
      expect(v.nativeSince).toBeNull();
    });
    await rolledBack(async () => {
      await standIns();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      const v = await apply(
        { provider: "typeform", owners: "shadow" },
        "cutover-rollback",
      );
      expect(v.provider).toBe("typeform");
    });
  });

  test("the rollback patch restores the seed's provider, typeform_id, version and effects exactly", async () => {
    const seed = await checkin();
    await rolledBack(async () => {
      await standIns();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      await set(ADMIN, "checkin", { owners: { recap: "shadow" } });
      await apply(
        { provider: "typeform", owners: "shadow" },
        "cutover-rollback",
      );
      const after = await checkin();
      for (const k of ["provider", "typeform_id", "version", "effects"])
        expect(after[k]).toEqual(seed[k]);
      expect(after.provider_since).not.toBeNull();
      expect(after.updated_by).toBe("cut-over");
    });
  });

  test("provider_since is set only when the provider changes, equal to its audit row's time; native_since follows", async () => {
    await rolledBack(async () => {
      await standIns();
      expect(
        await one("SELECT public.cockpit_form_native_since('checkin') AS r"),
      ).toBeNull();
      await set(ADMIN, "checkin", { owners: { call_form: "cockpit" } });
      expect((await checkin()).provider_since).toBeNull();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      const c = await checkin();
      expect(c.provider_since).not.toBeNull();
      const audit = (await registryAudits()).at(-1) as Row;
      expect(audit.created_at).toEqual(c.provider_since);
      expect(audit.before.provider).toBe("typeform");
      expect(audit.after.provider).toBe("native");
      // The owner path names the cut-over, not a seat.
      expect(audit.actor_email).toBe("cut-over");
      expect(audit.source_system).toBe("cutover");
      expect(
        await one("SELECT public.cockpit_form_native_since('checkin') AS r"),
      ).toEqual(c.provider_since);
      // An owners-only change while native keeps the time.
      await set(ADMIN, "checkin", { owners: { recap: "shadow" } });
      expect((await checkin()).provider_since).toEqual(c.provider_since);
      // A native row never switched (provider_since NULL) reads its last update.
      await q(
        "UPDATE public.cockpit_forms SET provider_since = NULL, updated_at = '2026-10-01T00:00:00Z' WHERE key = 'checkin'",
      );
      expect(
        await one("SELECT public.cockpit_form_native_since('checkin') AS r"),
      ).toEqual(new Date("2026-10-01T00:00:00Z"));
      expect(
        await one("SELECT public.cockpit_form_native_since('kickoff') AS r"),
      ).toBeNull();
      expect(
        await one("SELECT public.cockpit_form_native_since('nope') AS r"),
      ).toBeNull();
      // The settings it set for its audit row are put back.
      expect(
        await one(
          "SELECT current_setting('cockpit.forms_action', true) || '|' || current_setting('cockpit.audit_actor', true) AS r",
        ),
      ).toBe("|");
    });
  });

  test("the flip voids every open shadow draft (forms.shadow_closed) and the window then opens a live draft", async () => {
    await rolledBack(async () => {
      await standIns();
      // Two seats' shadow drafts, on two clients.
      const d1 = rid();
      const d2 = rid();
      await as(
        CSM,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [A, d1],
      );
      await as(
        ADMIN,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [B, d2],
      );
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_form_responses WHERE state = 'draft' AND mode = 'shadow'",
        ),
      ).toBe(2);
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      expect(
        await q(
          "SELECT id::text, state, mode FROM public.cockpit_form_responses ORDER BY id",
        ),
      ).toEqual([
        { id: d1, state: "void", mode: "shadow" },
        { id: d2, state: "void", mode: "shadow" },
      ]);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action = 'forms.shadow_closed' AND entity_id IN ($1, $2)",
          [d1, d2],
        ),
      ).toBe(2);
      const live = rid();
      const opened = await as<Row>(
        CSM,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [A, live],
      );
      expect(opened.form.mode).toBe("live");
      expect(opened.response).toMatchObject({
        id: live,
        mode: "live",
        state: "draft",
      });
    });
  });
});

describe("cockpit_form_delivery_ready: each path's clause", () => {
  test("SQL effects are always ready; every other path names its missing piece until its stand-in exists", async () => {
    await rolledBack(async () => {
      const ready = (k: string) =>
        one<string | null>(
          "SELECT public.cockpit_form_delivery_ready('checkin', $1) AS r",
          [k],
        );
      expect(await ready("call_form")).toBeNull();
      expect(await ready("call_match")).toBeNull();
      expect(await ready("nope")).toBe("the registry has no such effect");
      for (const k of ["todo_comment", "grade_notice", "recap"])
        expect(await ready(k)).toBe("the effect dispatch is not installed");
      // The registry refuses with the clause, naming the effect by its label.
      expect(
        await refusal(() =>
          set(ADMIN, "checkin", { owners: { todo_comment: "cockpit" } }),
        ),
      ).toEqual({
        code: "55000",
        message:
          "To-do comment on the card cannot move to the cockpit yet: the effect dispatch is not installed.",
      });
      // The SQL effects move with no stand-in.
      await set(ADMIN, "checkin", {
        owners: { call_form: "cockpit", call_match: "cockpit" },
      });

      await standIns(["dispatch"]);
      expect(await ready("happiness")).toBe(
        "the ClickUp writer has no 1-1 notes lane",
      );
      expect(await ready("grade_notice")).toBe(
        "the Call grade notice has no ready private channel",
      );
      expect(await ready("recap")).toBe("the recap approval is not installed");
      expect(
        await refusal(() =>
          set(ADMIN, "checkin", { owners: { recap: "cockpit" } }),
        ),
      ).toEqual({
        code: "55000",
        message:
          "Recap for the client's group cannot move to the cockpit yet: the recap approval is not installed.",
      });

      // The ClickUp lane needs both the kind and the claim.
      await ex(`
        ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
        ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
          CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));`);
      expect(await ready("last_poc")).toBe(
        "the ClickUp writer has no 1-1 notes lane",
      );
      await standIns(["clickup"]);
      for (const k of [
        "todo_comment",
        "happiness",
        "last_poc",
        "last_checkin_call",
      ])
        expect(await ready(k)).toBeNull();

      // The Call grade: the kind, an enabled row, and a checked private channel.
      await standIns(["grade"]);
      expect(await ready("grade_notice")).toBeNull();
      await q(
        "UPDATE public.cockpit_slack_channels SET private = false WHERE id = 'C09SVG6FHGU'",
      );
      expect(await ready("grade_notice")).toBe(
        "the Call grade notice has no ready private channel",
      );
      await q(
        "UPDATE public.cockpit_slack_channels SET private = true, state = 'checking' WHERE id = 'C09SVG6FHGU'",
      );
      expect(await ready("grade_notice")).toBe(
        "the Call grade notice has no ready private channel",
      );
      await q(
        "UPDATE public.cockpit_slack_channels SET state = 'ok' WHERE id = 'C09SVG6FHGU'",
      );
      await q(
        "UPDATE public.cockpit_slack_notice_settings SET enabled = false WHERE kind = 'checkin.grade'",
      );
      expect(await ready("grade_notice")).toBe(
        "the Call grade notice has no ready private channel",
      );
      await q(
        "UPDATE public.cockpit_slack_notice_settings SET enabled = true WHERE kind = 'checkin.grade'",
      );
      expect(await ready("grade_notice")).toBeNull();

      // The recap: both service RPCs.
      await standIns(["recap"]);
      expect(await ready("recap")).toBeNull();
      const v = await set(ADMIN, "checkin", { owners: "cockpit" });
      expect(v.effects.map((e: Row) => e.owner)).toEqual(
        EFFECT_KEYS.map(() => "cockpit"),
      );
      expect(v.provider).toBe("typeform");
    });
  });
});

describe("cockpit_form_effect_gate (3.1)", () => {
  /** A response stored directly (as the owner) and one effect on it, moved to a state through the guard. */
  async function effectAt(
    o: {
      mode?: "live" | "shadow";
      key?: string;
      delivery?: string;
      state?: string;
      ref?: string;
      created?: string;
      submitted?: string;
    } = {},
  ) {
    const id = rid();
    await q(
      `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state,
         created_by, created_by_id, submitted_by, submitted_at)
       VALUES ($1, 'checkin', 1, 'cockpit', $2, 'Acme Interiors', $3, 'submitted', $4, $5, $4, coalesce($6::timestamptz, now()))`,
      [id, A, o.mode ?? "live", CSM_EMAIL, CSM, o.submitted ?? null],
    );
    const key = o.key ?? "todo_comment";
    const [{ id: eid }] = await q<{ id: string }>(
      `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, state, created_at)
       VALUES ($1::uuid, 'checkin', $2, $1::text || ':' || $2, 'cockpit', $3, 'planned', coalesce($4::timestamptz, now())) RETURNING id::text`,
      [id, key, o.delivery ?? "clickup_queue", o.created ?? null],
    );
    const path: Record<string, string[]> = {
      planned: [],
      queued: ["queued"],
      unknown: ["queued", "unknown"],
      delivered: ["queued", "delivered"],
      skipped: ["skipped"],
      failed: ["failed"],
    };
    for (const s of path[o.state ?? "queued"])
      await q(
        "UPDATE public.cockpit_form_effects SET state = $2, delivery_ref = $3 WHERE id = $1::uuid",
        [eid, s, o.ref ?? "q-1"],
      );
    if (
      (o.state ?? "queued") === "planned" ||
      path[o.state ?? "queued"][0] !== "queued"
    )
      await q(
        "UPDATE public.cockpit_form_effects SET delivery_ref = $2 WHERE id = $1::uuid",
        [eid, o.ref ?? "q-1"],
      );
    return { response: id, effect: eid };
  }
  const gate = (delivery: string, ref: string) =>
    one<Row>("SELECT public.cockpit_form_effect_gate($1, $2) AS r", [
      delivery,
      ref,
    ]);

  test("no effect points at the write", async () => {
    expect(await gate("clickup_queue", "nothing-here")).toEqual({
      ok: false,
      effectId: null,
      responseId: null,
      formKey: null,
      effectKey: null,
      effectState: null,
      reason: SENTENCE.none,
    });
  });

  test("a queued or unknown live effect the registry still gives the cockpit passes; a queued one before an unknown one, then the oldest", async () => {
    await rolledBack(async () => {
      await standIns();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      const u = await effectAt({
        state: "unknown",
        ref: "r1",
        created: ago(30),
      });
      expect(await gate("clickup_queue", "r1")).toEqual({
        ok: true,
        effectId: u.effect,
        responseId: u.response,
        formKey: "checkin",
        effectKey: "todo_comment",
        effectState: "unknown",
        reason: null,
      });
      const qd = await effectAt({
        state: "queued",
        ref: "r1",
        created: ago(5),
      });
      expect((await gate("clickup_queue", "r1")).effectId).toBe(qd.effect);
      const older = await effectAt({
        state: "queued",
        ref: "r1",
        created: ago(10),
      });
      expect((await gate("clickup_queue", "r1")).effectId).toBe(older.effect);
      // Another delivery with the same ref is another write.
      expect((await gate("slack_notice", "r1")).reason).toBe(SENTENCE.none);
    });
  });

  test("every effect settled reads settled; an owner, registry or mode change reads Make owns this again", async () => {
    await rolledBack(async () => {
      await standIns();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      for (const s of ["delivered", "skipped", "failed"])
        await effectAt({ state: s, ref: "settled" });
      expect(await gate("clickup_queue", "settled")).toMatchObject({
        ok: false,
        reason: SENTENCE.settled,
        formKey: "checkin",
      });
      // A shadow response's effect never passes, even owned by the cockpit.
      const sh = await effectAt({
        mode: "shadow",
        state: "queued",
        ref: "shadow",
      });
      expect(await gate("clickup_queue", "shadow")).toMatchObject({
        ok: false,
        effectId: sh.effect,
        effectState: "queued",
        reason: SENTENCE.make,
      });
      // The registry flipped back: an unknown effect says so, with its state.
      const un = await effectAt({ state: "unknown", ref: "flip" });
      expect((await gate("clickup_queue", "flip")).ok).toBe(true);
      await set(ADMIN, "checkin", { owners: { todo_comment: "shadow" } });
      expect(await gate("clickup_queue", "flip")).toEqual({
        ok: false,
        effectId: un.effect,
        responseId: un.response,
        formKey: "checkin",
        effectKey: "todo_comment",
        effectState: "unknown",
        reason: SENTENCE.make,
      });
      // A planned effect with a ref (never written by the dispatch) does not pass.
      await effectAt({ state: "planned", ref: "planned" });
      expect((await gate("clickup_queue", "planned")).reason).toBe(
        SENTENCE.make,
      );
    });
  });

  test("nothing passes while the provider is typeform, whatever the effects' owners say, and every outbox reads Make owns this again", async () => {
    await rolledBack(async () => {
      await standIns();
      expect((await checkin()).provider).toBe("typeform");
      expect((await checkin()).provider_since).toBeNull();
      // An admin may move every owner while the provider stays typeform.
      await set(ADMIN, "checkin", { owners: "cockpit" });
      expect(new Set(Object.values(await owners()))).toEqual(
        new Set(["cockpit"]),
      );
      expect((await checkin()).provider).toBe("typeform");
      // Live responses, sent now and an hour from now, on all three outboxes:
      // the Slack notice has no second switch, so this refusal is its only brake.
      const cases: [string, string, string, string, string | undefined][] = [
        ["todo_comment", "clickup_queue", "queued", "tf-queued", undefined],
        ["todo_comment", "clickup_queue", "unknown", "tf-unknown", undefined],
        ["grade_notice", "slack_notice", "queued", "tf-grade", undefined],
        ["grade_notice", "slack_notice", "queued", "tf-later", ago(-60)],
        ["recap", "client_message", "queued", "tf-recap", undefined],
      ];
      for (const [key, delivery, state, ref, submitted] of cases) {
        const e = await effectAt({ key, delivery, state, ref, submitted });
        expect(await gate(delivery, ref)).toEqual({
          ok: false,
          effectId: e.effect,
          responseId: e.response,
          formKey: "checkin",
          effectKey: key,
          effectState: state,
          reason: SENTENCE.make,
        });
      }
      // The same row passes once the cut-over has opened a window it belongs to,
      // which is what proves the refusal above came from the provider.
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      expect((await gate("slack_notice", "tf-later")).ok).toBe(true);
      // Sent at the flip's own clock, it is of this window as well.
      expect((await gate("slack_notice", "tf-grade")).ok).toBe(true);
      // Rolled back, owners moved again, sent just now: refused again.
      await apply(
        { provider: "typeform", owners: "shadow" },
        "cutover-rollback",
      );
      await set(ADMIN, "checkin", { owners: "cockpit" });
      expect(await gate("slack_notice", "tf-later")).toMatchObject({
        ok: false,
        effectKey: "grade_notice",
        reason: SENTENCE.make,
      });
    });
  });

  test("only a response sent since the registry's latest provider change passes (Z70); an earlier switch-over's rows read Make owns this again", async () => {
    await rolledBack(async () => {
      await standIns();
      await apply({ provider: "native", owners: "cockpit" }, "cutover");
      // Sent at the flip's own time (one transaction shares one clock): this window.
      const current = await effectAt({ state: "queued", ref: "window-now" });
      expect(await gate("clickup_queue", "window-now")).toMatchObject({
        ok: true,
        effectId: current.effect,
        reason: null,
      });
      // Sent a day before the flip: a queued and an unknown row of an earlier window.
      const day = ago(60 * 24);
      const oldQueued = await effectAt({
        state: "queued",
        ref: "window-old",
        submitted: day,
      });
      expect(await gate("clickup_queue", "window-old")).toEqual({
        ok: false,
        effectId: oldQueued.effect,
        responseId: oldQueued.response,
        formKey: "checkin",
        effectKey: "todo_comment",
        effectState: "queued",
        reason: SENTENCE.make,
      });
      const oldUnknown = await effectAt({
        state: "unknown",
        ref: "window-old-unknown",
        submitted: day,
      });
      expect(await gate("clickup_queue", "window-old-unknown")).toMatchObject({
        ok: false,
        effectId: oldUnknown.effect,
        effectState: "unknown",
        reason: SENTENCE.make,
      });
      // The grade notice and the recap message of that window, the same.
      await effectAt({
        key: "grade_notice",
        delivery: "slack_notice",
        state: "queued",
        ref: "notice-old",
        submitted: day,
      });
      expect(await gate("slack_notice", "notice-old")).toMatchObject({
        ok: false,
        effectKey: "grade_notice",
        reason: SENTENCE.make,
      });
      await effectAt({
        key: "recap",
        delivery: "client_message",
        state: "queued",
        ref: "message-old",
        submitted: day,
      });
      expect(await gate("client_message", "message-old")).toMatchObject({
        ok: false,
        effectKey: "recap",
        reason: SENTENCE.make,
      });
      // Rolled back, the provider is typeform since the rollback: even with every
      // owner moved to the cockpit again, a live response sent before it never passes.
      await apply(
        { provider: "typeform", owners: "shadow" },
        "cutover-rollback",
      );
      await set(ADMIN, "checkin", { owners: "cockpit" });
      await q(
        "UPDATE public.cockpit_form_responses SET submitted_at = now() - interval '1 hour' WHERE id = $1::uuid",
        [current.response],
      );
      expect(await gate("clickup_queue", "window-now")).toMatchObject({
        ok: false,
        effectId: current.effect,
        effectState: "queued",
        reason: SENTENCE.make,
      });
    });
  });
});

/** A placed Typeform 1-1 note in the store, as step 4 of the hour leaves it. */
const placedNotes = () =>
  q(
    `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at)
     VALUES ('tf-old-0001', 'fRokTITH', 'checkin', $1, 'hidden_field', $2)`,
    [A, ago(600)],
  );

describe("cockpit_form_checkin_cutover", () => {
  test("refuses with nothing written when the store holds no Typeform notes, even with every delivery path in place", async () => {
    await rolledBack(async () => {
      await standIns();
      // Another form's row does not count as the 1-1 notes.
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at)
         VALUES ('tf-other-0001', 'KFRCXPFx', 'checkin', $1, 'hidden_field', $2)`,
        [A, ago(60)],
      );
      const before = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log",
      );
      expect(
        await refusal(() =>
          one("SELECT public.cockpit_form_checkin_cutover() AS r"),
        ),
      ).toEqual({ code: "55000", message: SENTENCE.noTypeform });
      expect(
        await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      ).toBe(before);
      expect((await checkin()).provider).toBe("typeform");
    });
  });

  test("refuses with nothing written while a delivery path is missing, while the newest Typeform notes are on no client, and once native", async () => {
    await rolledBack(async () => {
      await placedNotes();
      let before = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log",
      );
      expect(
        await refusal(() =>
          one("SELECT public.cockpit_form_checkin_cutover() AS r"),
        ),
      ).toEqual({
        code: "55000",
        message:
          "To-do comment on the card cannot move to the cockpit yet: the effect dispatch is not installed.",
      });
      await standIns(["dispatch", "clickup", "grade"]);
      expect(
        (
          await refusal(() =>
            one("SELECT public.cockpit_form_checkin_cutover() AS r"),
          )
        ).message,
      ).toBe(
        "Recap for the client's group cannot move to the cockpit yet: the recap approval is not installed.",
      );
      await standIns(["recap"]);
      // The newest fRokTITH row is on no client.
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at)
         VALUES ('tf-new-0002', 'fRokTITH', 'checkin', NULL, NULL, $1)`,
        [ago(60)],
      );
      before = await count("SELECT count(*) n FROM public.cockpit_audit_log");
      expect(
        await refusal(() =>
          one("SELECT public.cockpit_form_checkin_cutover() AS r"),
        ),
      ).toEqual({ code: "55000", message: SENTENCE.unplaced });
      expect(
        await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      ).toBe(before);
      await q(
        "UPDATE public.cockpit_csm_call_forms SET task_id = $1 WHERE token = 'tf-new-0002'",
        [B],
      );
      await one("SELECT public.cockpit_form_checkin_cutover() AS r");
      expect(
        await refusal(() =>
          one("SELECT public.cockpit_form_checkin_cutover() AS r"),
        ),
      ).toEqual({ code: "55000", message: SENTENCE.already });
    });
  });

  test("closes the shadow drafts and flips in one go, and answers what the session note quotes", async () => {
    await rolledBack(async () => {
      await standIns();
      const draft = rid();
      await as(
        CSM,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [A, draft],
      );
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at, recording_url, linked_call_id)
         VALUES ('tf-link-0001', 'fRokTITH', 'checkin', $1, 'hidden_field', $2, 'https://fathom.video/share/test-1', NULL),
                ('tf-bare-0002', 'fRokTITH', 'checkin', $1, 'hidden_field', $3, NULL, NULL),
                ('tf-bare-0003', 'fRokTITH', 'checkin', $1, 'hidden_field', $4, NULL, NULL),
                ('tf-aged-0004', 'fRokTITH', 'checkin', $1, 'hidden_field', $5, NULL, NULL)`,
        [A, ago(30), ago(90), ago(60 * 24 * 3), ago(60 * 24 * 20)],
      );
      const out = await one<Row>(
        "SELECT public.cockpit_form_checkin_cutover() AS r",
      );
      const c = await checkin();
      expect(out.voided).toBe(1);
      expect(out.registry.provider).toBe("native");
      expect(out.registry.effects.map((e: Row) => e.owner)).toEqual(
        EFFECT_KEYS.map(() => "cockpit"),
      );
      expect(new Date(out.nativeSince)).toEqual(c.provider_since);
      const audit = await q<Row>(
        "SELECT id::text, action, after->>'provider' AS provider FROM public.cockpit_audit_log WHERE id = $1::uuid",
        [out.auditId],
      );
      expect(audit).toEqual([
        { id: out.auditId, action: "forms.registry_set", provider: "native" },
      ]);
      expect(out.newestTypeform).toMatchObject({
        token: "tf-link-0001",
        taskId: A,
      });
      expect(out.unlinked14d).toEqual(["tf-bare-0002", "tf-bare-0003"]);
      expect(
        await one(
          "SELECT state AS r FROM public.cockpit_form_responses WHERE id = $1::uuid",
          [draft],
        ),
      ).toBe("void");
      expect(c.updated_by).toBe("cut-over");
      // Every row the hour wrote is credited to the cut-over, the closed draft's first.
      expect(
        await q(
          `SELECT action, actor_email, source_system FROM public.cockpit_audit_log
            WHERE (action = 'forms.shadow_closed' AND entity_id = $1) OR id = $2::uuid ORDER BY test_seq`,
          [draft, out.auditId],
        ),
      ).toEqual([
        {
          action: "forms.shadow_closed",
          actor_email: "cut-over",
          source_system: "cutover",
        },
        {
          action: "forms.registry_set",
          actor_email: "cut-over",
          source_system: "cutover",
        },
      ]);
      expect(await auditSettings()).toBe("|");
    });
  });

  test("step 7a's own SELECT credits each closed draft to the cut-over, keeps an actor a caller named, and puts the settings back", async () => {
    await rolledBack(async () => {
      const first = rid();
      await as(
        CSM,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [A, first],
      );
      expect(
        await one("SELECT public.cockpit_form_shadow_close('checkin') AS r"),
      ).toBe(1);
      const closedBy = (id: string) =>
        q<Row>(
          "SELECT actor_email, source_system FROM public.cockpit_audit_log WHERE action = 'forms.shadow_closed' AND entity_id = $1",
          [id],
        );
      expect(await closedBy(first)).toEqual([
        { actor_email: "cut-over", source_system: "cutover" },
      ]);
      expect(await auditSettings()).toBe("|");
      // A caller that named itself keeps its name.
      const second = rid();
      await as(
        ADMIN,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [B, second],
      );
      await q(
        "SELECT set_config('cockpit.audit_actor', 'owner-session', true), set_config('cockpit.audit_source', 'owner-sql', true)",
      );
      expect(
        await one("SELECT public.cockpit_form_shadow_close('checkin') AS r"),
      ).toBe(1);
      expect(await closedBy(second)).toEqual([
        { actor_email: "owner-session", source_system: "owner-sql" },
      ]);
      expect(await auditSettings()).toBe("owner-session|owner-sql");
      await q(
        "SELECT set_config('cockpit.audit_actor', '', true), set_config('cockpit.audit_source', '', true)",
      );
    });
  });

  test("a live canary send, the rollback, and a second hour: the function runs again with all its checks", async () => {
    await rolledBack(async () => {
      await standIns();
      await placedNotes();
      await one("SELECT public.cockpit_form_checkin_cutover() AS r");
      const sent = await sendNotes(CSM, A);
      expect(sent.response).toMatchObject({ mode: "live", state: "submitted" });
      const byKey = Object.fromEntries(
        (sent.effects as Row[]).map(e => [e.key, e.state]),
      );
      expect(byKey.call_form).toBe("delivered");
      expect(byKey.todo_comment).toBe("skipped");
      expect(byKey.happiness).toBe("planned");
      // The rollback: every effect back to shadow; the live response stays a record.
      await apply(
        { provider: "typeform", owners: "shadow" },
        "cutover-rollback",
      );
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_form_responses WHERE form_key = 'checkin' AND mode = 'live'",
        ),
      ).toBe(1);
      // A queued effect of that send is now refused by the gate.
      await q(
        "UPDATE public.cockpit_form_effects SET state = 'queued', delivery_ref = 'canary-q' WHERE response_id = $1::uuid AND effect_key = 'happiness'",
        [sent.response.id],
      );
      expect(
        (
          await one<Row>(
            "SELECT public.cockpit_form_effect_gate('clickup_queue', 'canary-q') AS r",
          )
        ).reason,
      ).toBe(SENTENCE.make);
      // A shadow draft opened between the hours is closed by the second flip.
      const draft = rid();
      await as(
        ADMIN,
        "SELECT public.cockpit_form_open('checkin', $1, $2::uuid) AS r",
        [B, draft],
      );
      // The days between the hours: this transaction shares one clock, so the
      // canary's send is dated back to stand for them.
      await q(
        "UPDATE public.cockpit_form_responses SET submitted_at = now() - interval '2 days' WHERE id = $1::uuid",
        [sent.response.id],
      );
      const again = await one<Row>(
        "SELECT public.cockpit_form_checkin_cutover() AS r",
      );
      expect(again.voided).toBe(1);
      expect(again.registry.provider).toBe("native");
      // The canary's row, still queued from the first hour, stays refused (Z70):
      // nothing planned before the rollback reaches the card at the second hour.
      expect(
        await one<Row>(
          "SELECT public.cockpit_form_effect_gate('clickup_queue', 'canary-q') AS r",
        ),
      ).toMatchObject({
        ok: false,
        responseId: sent.response.id,
        effectKey: "happiness",
        effectState: "queued",
        reason: SENTENCE.make,
      });
      // A send of the second hour passes.
      const next = await sendNotes(CSM, B);
      await q(
        "UPDATE public.cockpit_form_effects SET state = 'queued', delivery_ref = 'second-q' WHERE response_id = $1::uuid AND effect_key = 'happiness'",
        [next.response.id],
      );
      expect(
        await one<Row>(
          "SELECT public.cockpit_form_effect_gate('clickup_queue', 'second-q') AS r",
        ),
      ).toMatchObject({ ok: true, responseId: next.response.id, reason: null });
      expect(
        (await registryAudits()).map(a => [
          a.before.provider,
          a.after.provider,
        ]),
      ).toEqual([
        ["typeform", "native"],
        ["native", "typeform"],
        ["typeform", "native"],
      ]);
    });
  });
});
