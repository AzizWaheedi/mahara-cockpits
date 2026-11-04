/**
 * Stage 2a fit (docs/forms/STAGE2-CONTRACT.md section 11, "The orchestrator,
 * after all five"): Stage 1's two migrations (20261025n, 20261025o) and the
 * ticketing three (20261026r, s and t) over 20261024a, then this build's three,
 * 20261027f_forms_core.sql, 20261027g_fathom_intake.sql and
 * 20261027h_checkin_plans.sql, twice in that order, on one database, and one
 * shadow send driven through the 1-1 window's own calls
 * (client-success-cockpit src/forms/checkinClient.ts, every answer parsed by
 * the window's shapes) with the real planner:
 *
 *   the CSM's seat reads the entry (cockpit_form_entry) and opens the notes
 *   for a client (cockpit_form_open)
 *   -> saves the call she confirmed, an impromptu recording on no client yet,
 *      with DEFCON and priority (cockpit_form_save)
 *   -> sends (cockpit_form_submit): x plans the eight effects, each dry_run
 *      or skipped with its lines, and the window reads them back
 *      (cockpit_form_responses_read)
 *   -> nothing outside the forms tables moves: cockpit_csm_calls,
 *      cockpit_csm_call_forms, cockpit_fathom_meetings and what the matcher
 *      reads (cockpit_fathom_match_inputs) are exactly as before.
 *
 * Each builder's suite tests its piece against the contract; this one only
 * checks that the pieces fit. Everything else is cut from its canonical
 * migration, as the requests fit and the db builder's tests cut it; the sales
 * index is a stand-in with the live column names. PGlite has no pg_cron,
 * vault or pg_net: the guarded blocks skip, and nothing here reads a key.
 * Every person, client, recording and room is invented (Meet codes from the
 * contract's allow-list).
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
import {
  type EffectView,
  type FormClient,
  openCheckin,
  readEntry,
  readResponse,
  saveCheckin,
  submitCheckin,
} from "../../client-success-cockpit/src/forms/checkinClient";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

const N = "20261025n_slack_notices.sql";
const O = "20261025o_blueprint_close_drain.sql";
const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const T = "20261026t_task_alerts.sql";
const V = "20261027f_forms_core.sql";
const W = "20261027g_fathom_intake.sql";
const X = "20261027h_checkin_plans.sql";

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1";
const CSM = "00000000-0000-4000-8000-0000000000a1"; // the CSM, every client
const CSM_EMAIL = "csm@tests.invalid";

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build

/** Yesterday's check-in, on Acme in the room of its booking, and today's impromptu call on no client. */
const NOTED = "900000501";
const TODAY = "900000502";
/** The response the window mints before it opens (a fixed one here). */
const RID = "50000000-0000-4000-8000-000000000001";

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function q<X = Row>(text: string, params: unknown[] = []): Promise<X[]> {
  await asOwner();
  return (await db.query<X>(text, params)).rows;
}

// --- RPCs by name, as PostgREST calls them -----------------------------------------------------

type Sig = { names: string[]; types: string[]; required: number; ret: string };
const sigCache = new Map<string, Sig[]>();
async function signatures(name: string): Promise<Sig[]> {
  const known = sigCache.get(name);
  if (known) return known;
  const rows = await q<{
    names: string[] | null;
    types: string[];
    nargs: number;
    ndef: number;
    ret: string;
  }>(
    `SELECT p.proargnames AS names,
            ARRAY(SELECT format_type(u.t, NULL) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS u(t, i) ORDER BY u.i) AS types,
            p.pronargs AS nargs, p.pronargdefaults AS ndef, format_type(p.prorettype, NULL) AS ret
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [name],
  );
  const sigs = rows.map(r => ({
    names: (r.names ?? []).slice(0, r.nargs),
    types: r.types,
    required: r.nargs - r.ndef,
    ret: r.ret,
  }));
  sigCache.set(name, sigs);
  return sigs;
}
class DbError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
/** One RPC with named arguments, as a seat (its auth id) or as the service key. */
async function rpcAs(
  who: string | "service",
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const keys = Object.keys(args).filter(k => args[k] !== undefined);
  const sig = (await signatures(name)).find(
    s =>
      keys.every(k => s.names.includes(k)) &&
      s.names.slice(0, s.required).every(k => keys.includes(k)),
  );
  if (!sig)
    throw new DbError(
      `Could not find the function public.${name}(${keys.join(", ")}) in the schema cache`,
      "PGRST202",
    );
  const type = (k: string) => sig.types[sig.names.indexOf(k)];
  const values = keys.map(k =>
    args[k] === null
      ? null
      : type(k) === "jsonb"
        ? JSON.stringify(args[k])
        : args[k],
  );
  const callSql = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${type(k)}`).join(", ")})`;
  if (who === "service") {
    // PostgREST with the service key: role service_role in the claims.
    await asOwner();
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.exec("SET ROLE service_role");
  } else await actor(db, who);
  try {
    return (
      (
        await db.query<{ r: unknown }>(
          `SELECT to_jsonb(${callSql}) AS r`,
          values,
        )
      ).rows[0]?.r ?? null
    );
  } catch (e) {
    throw new DbError(
      (e as Error).message,
      String((e as { code?: string }).code ?? ""),
    );
  } finally {
    await asOwner();
  }
}

/** A signed-in cockpit as supabase-js gives it to the 1-1 window: rpc, and the session it guards. */
function seat(uid: string): FormClient {
  const session = { user: { id: uid } };
  return {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      try {
        return { data: await rpcAs(uid, name, args), error: null };
      } catch (e) {
        return {
          data: null,
          error: { message: (e as Error).message, code: (e as DbError).code },
        };
      }
    },
    auth: {
      getUser: async () => ({ data: { user: session.user }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    functions: {
      invoke: async () => {
        throw new Error("This fit calls no Edge Function");
      },
    },
  } as unknown as FormClient;
}

// --- The database the three files stand on ----------------------------------------------------

/**
 * What Stage 1 and the ticketing read (the requests fit's cut), and what v, w
 * and x read (the db builder's cut), each from its canonical migration. The
 * call store keeps 20261011c's own grants (the service role keeps Supabase's
 * default DELETE and TRUNCATE, as live, until w revokes them); PL/pgSQL
 * resolves a declared row type when a function is created, so the store and
 * the sync state come before v.
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

/** The seats, the people by role, the roster the client gate reads and Acme's alias. */
async function seats() {
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  for (const [name, email, role] of [
    ["Noura Test", CSM_EMAIL, "Client success manager"],
    ["Omar Test", "creative@tests.invalid", "Creative strategist"],
    ["Aziz Test", "aziz@maharamedia.com", "CEO"],
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
  await q(
    "INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clientLinks','l-taskA1',$1,$2::jsonb,$3)",
    [
      ["Acme Interiors"],
      JSON.stringify({
        _id: "l-taskA1",
        taskId: A,
        name: "Acme Interiors",
        aliases: ["Acme"],
      }),
      snap,
    ],
  );
}

/**
 * The store as the worker writes it: Acme's check-in booked yesterday in a Meet
 * room, its recording in that room on Acme, the Typeform 1-1 form noted for it
 * (with the recording's link, so MatchInputs has a form link and a last note),
 * and today's impromptu call by the CSM, a candidate on no client yet.
 */
async function store() {
  const csm = {
    name: "Noura Test",
    email: CSM_EMAIL,
    team: "Customer Success",
  };
  const contact = { email: "owner@acme.invalid", name: "Invented Contact" };
  const [{ id: booked }] = await q<{ id: number }>(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
       starts_at,ends_at,status,join_url,room,external_invitees)
     VALUES('ghl_appointment','appt-fit-1',$1,'Acme Interiors','client_id_field',1,'checkin','Check-in',$2,$3,'confirmed',
            'https://meet.google.com/abc-defg-hij','meet:abc-defg-hij',$4::jsonb) RETURNING id`,
    [A, ago(1560), ago(1530), JSON.stringify([contact])],
  );
  const meetings = [
    {
      id: NOTED,
      title: "Acme Interiors check-in",
      start: ago(1558),
      end: ago(1528),
      invitees: [
        { name: csm.name, email: csm.email, is_external: false },
        { ...contact, is_external: true },
      ],
      url: "https://meet.google.com/abc-defg-hij",
      summary: "Invented summary of yesterday's check-in.",
      cls: "client",
      room: "meet:abc-defg-hij",
    },
    {
      id: TODAY,
      title: "Impromptu Google Meet Meeting",
      start: ago(95),
      end: ago(60),
      invitees: [{ name: csm.name, email: csm.email, is_external: false }],
      url: "https://meet.google.com/kln-opqr-stu",
      summary: "Invented summary of an impromptu call.",
      cls: "candidate",
      room: "meet:kln-opqr-stu",
    },
  ];
  for (const m of meetings)
    await q(
      `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
         external,invitees,url,share_url,summary,raw,class,room,recorder_team)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,'Customer Success')`,
      [
        m.id,
        m.title,
        m.start,
        m.end,
        csm.email,
        csm.name,
        m.cls === "client",
        JSON.stringify(m.invitees),
        `https://fathom.video/calls/${Number(m.id) + 1000}`,
        `https://fathom.video/share/test-${m.id}`,
        m.summary,
        JSON.stringify({
          recording_id: Number(m.id),
          recorded_by: csm,
          calendar_invitees: m.invitees,
          calendar_invitees_domains_type: "one_or_more_external",
          shared_with: "all_teams",
          meeting_url: m.url,
          default_summary: { markdown_formatted: m.summary },
          action_items: [{ description: "Invented action", completed: false }],
          created_at: m.end,
        }),
        m.cls,
        m.room,
      ],
    );
  const [{ id: noted }] = await q<{ id: number }>(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
       starts_at,ends_at,status,provider_status,host_email,host_name,recording_url,summary,linked_call_id,room)
     VALUES('fathom',$1,$2,'Acme Interiors','same_room',1,'checkin','Acme Interiors check-in',$3,$4,'held','recorded',$5,
            'Noura Test',$6,'Invented summary of yesterday''s check-in.',$7,'meet:abc-defg-hij') RETURNING id`,
    [
      NOTED,
      A,
      ago(1558),
      ago(1528),
      CSM_EMAIL,
      `https://fathom.video/calls/${Number(NOTED) + 1000}`,
      booked,
    ],
  );
  await q(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,kind,title,starts_at,ends_at,status,provider_status,host_email,
       host_name,recording_url,summary,candidate,room)
     VALUES('fathom',$1,'other','Impromptu Google Meet Meeting',$2,$3,'held','recorded',$4,'Noura Test',$5,
            'Invented summary of an impromptu call.',true,'meet:kln-opqr-stu')`,
    [
      TODAY,
      ago(95),
      ago(60),
      CSM_EMAIL,
      `https://fathom.video/calls/${Number(TODAY) + 1000}`,
    ],
  );
  const share = `https://fathom.video/share/test-${NOTED}`;
  await q(
    `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,typed_client,matched_by,submitted_at,answers,
       recording_url,linked_call_id)
     VALUES('fit-checkin-0001','fRokTITH','checkin',$1,'Acme Interiors','hidden_field',$2,$3::jsonb,$4,$5)`,
    [
      A,
      ago(1500),
      JSON.stringify([
        { ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587", value: "Happy" },
        { ref: "0773087f-beda-4e2c-bf50-acdac0dcbe05", value: share },
      ]),
      share,
      noted,
    ],
  );
}

/** Every function's definition, every column, and every table's row count. */
async function shape() {
  const fns = new Map(
    (
      await q<{ sig: string; md5: string }>(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind IN ('f','p')`,
      )
    ).map(r => [r.sig, r.md5]),
  );
  const cols = new Map<string, Map<string, string>>();
  for (const r of await q<{ t: string; c: string; d: string }>(
    `SELECT table_name AS t, column_name AS c,
            data_type || '|' || is_nullable || '|' || coalesce(column_default, '') AS d
       FROM information_schema.columns WHERE table_schema = 'public'`,
  ))
    cols.set(r.t, (cols.get(r.t) ?? new Map()).set(r.c, r.d));
  const rows: Record<string, number> = {};
  for (const { t } of await q<{ t: string }>(
    "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'",
  ))
    rows[t] = (
      await q<{ n: number }>(`SELECT count(*)::int AS n FROM public."${t}"`)
    )[0].n;
  return { fns, cols, rows };
}
type Shape = Awaited<ReturnType<typeof shape>>;
let base: Shape; // after n, o, r, s and t
let once: Shape; // after v, w and x
let twice: Shape; // after v, w and x again

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await standOn();
  await seats();
  // Stage 1 whole and the ticketing, as live; then this build's three files, twice in order.
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of [N, O, R, S, T]) await db.exec(migration(file));
  base = await shape();
  for (const file of [V, W, X]) await db.exec(migration(file));
  once = await shape();
  for (const file of [V, W, X]) await db.exec(migration(file));
  twice = await shape();
  await store();
}, 300_000);
afterAll(async () => {
  await db?.close();
});

describe("the eight migrations together", () => {
  test("v, w and x keep what n, o, r, s and t built, and a second apply changes nothing", async () => {
    // They replace exactly the four functions 2.2 names, and no other function they find.
    const replaced = [...base.fns]
      .filter(([sig, md5]) => twice.fns.get(sig) !== md5)
      .map(([sig]) => sig)
      .sort();
    expect(replaced).toEqual([
      "cockpit_csm_calls_summary()",
      "cockpit_csm_manual_match(bigint,text)",
      "cockpit_csm_unmatched_list()",
      "cockpit_sales_call_exclusion(text,text)",
    ]);
    // Every column they find stays as it was; only the two store tables of 2.2 grow.
    const altered: string[] = [];
    const grown: Record<string, string[]> = {};
    for (const [table, cols] of base.cols) {
      const now = twice.cols.get(table) ?? new Map<string, string>();
      for (const [col, def] of cols)
        if (now.get(col) !== def) altered.push(`${table}.${col}`);
      const added = [...now.keys()].filter(c => !cols.has(c)).sort();
      if (added.length) grown[table] = added;
    }
    expect(altered).toEqual([]);
    expect(grown).toEqual({
      cockpit_csm_calls: ["candidate", "hints", "room", "settled_reason"],
      cockpit_fathom_meetings: [
        "class",
        "gone_at",
        "missing_since",
        "recorder_team",
        "room",
      ],
    });
    // They write no row into a table they find, but the audit log (their seeds' rows).
    expect(
      Object.keys(base.rows).filter(
        t => t !== "cockpit_audit_log" && base.rows[t] !== twice.rows[t],
      ),
    ).toEqual([]);
    // The second apply changes no function, column or row.
    expect(
      [...once.fns].filter(([sig, md5]) => twice.fns.get(sig) !== md5),
    ).toEqual([]);
    expect([...twice.fns.keys()].filter(sig => !once.fns.has(sig))).toEqual([]);
    expect(
      [...once.cols].filter(
        ([t, cols]) =>
          JSON.stringify([...cols].sort()) !==
          JSON.stringify([...(twice.cols.get(t) ?? [])].sort()),
      ),
    ).toEqual([]);
    expect(twice.rows).toEqual(once.rows);
    // The ticketing's seed is still there beside the registry's (2.1 seeds).
    expect(twice.rows.cockpit_request_types).toBe(31);
    expect(
      await q(
        "SELECT key, provider, typeform_id FROM public.cockpit_forms ORDER BY key",
      ),
    ).toEqual([
      { key: "blueprint", provider: "native", typeform_id: null },
      { key: "checkin", provider: "typeform", typeform_id: "fRokTITH" },
      { key: "kickoff", provider: "typeform", typeform_id: "tG7dnxBn" },
    ]);
  });
});

/** The rows a shadow send must leave alone, and what the matcher reads for Acme's window. */
async function outside(from: string, to: string) {
  return {
    calls: (
      await q<{ r: Row }>(
        "SELECT to_jsonb(c) AS r FROM public.cockpit_csm_calls c ORDER BY c.id",
      )
    ).map(x => x.r),
    forms: (
      await q<{ r: Row }>(
        "SELECT to_jsonb(f) AS r FROM public.cockpit_csm_call_forms f ORDER BY f.token",
      )
    ).map(x => x.r),
    meetings: (
      await q<{ r: Row }>(
        "SELECT to_jsonb(m) AS r FROM public.cockpit_fathom_meetings m ORDER BY m.recording_id",
      )
    ).map(x => x.r),
    matchInputs: (await rpcAs("service", "cockpit_fathom_match_inputs", {
      p_from: from,
      p_to: to,
      p_task_id: A,
    })) as Row,
  };
}

describe("a shadow send, through the window's own calls", () => {
  test("as the CSM: eight effects, each dry_run or skipped with its lines, and nothing outside the forms tables", async () => {
    const from = ago(48 * 60);
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const before = await outside(from, to);
    // What the matcher reads is the store's: the form link, the last note, the candidate on no client.
    expect(before.matchInputs.formLinks).toEqual([
      { shareUrl: `https://fathom.video/share/test-${NOTED}`, taskId: A },
    ]);
    expect(before.matchInputs.client.lastNoteAt).not.toBeNull();
    const today = before.matchInputs.store.find(
      (s: Row) => s.recordingId === TODAY,
    );
    expect([today?.class, today?.onTask, today?.notes]).toEqual([
      "candidate",
      null,
      null,
    ]);

    const csm = seat(CSM);
    const entry = await readEntry(csm);
    expect([
      entry.provider,
      entry.typeformId,
      entry.native,
      entry.mode,
    ]).toEqual(["typeform", "fRokTITH", true, "shadow"]);
    const opened = await openCheckin(csm, {
      taskId: A,
      responseId: RID,
      rehearse: false,
    });
    expect(opened.form.mode).toBe("shadow");
    expect(opened.client).toEqual({
      taskId: A,
      name: "Acme Interiors",
      stage: "Active",
      happiness: "Happy",
    });
    expect([opened.response?.id, opened.response?.state]).toEqual([
      RID,
      "draft",
    ]);
    // Today's call is her newest one on no client: the window asked, and she pressed Yes, this call.
    const saved = await saveCheckin(csm, {
      responseId: RID,
      changes: {
        call: {
          value: {
            kind: "fathom",
            recordingId: TODAY,
            why: "latest_unlinked",
            confirmed: true,
          },
          seen: null,
        },
        defcon: { value: "Neutral", seen: null },
        priority: { value: "Medium", seen: null },
      },
      session: "fit-session-0001",
      baseRevision: opened.response?.revision ?? null,
    });
    expect([...saved.applied].sort()).toEqual(["call", "defcon", "priority"]);
    expect(saved.row.answers.call).toMatchObject({
      kind: "fathom",
      recordingId: TODAY,
      why: "latest_unlinked",
      recorder: "csm",
      confirmed: true,
    });
    const sent = await submitCheckin(csm, {
      responseId: RID,
      baseRevision: saved.row.revision,
    });
    expect(sent.duplicate).toBe(false);
    expect([sent.response.state, sent.response.mode]).toEqual([
      "submitted",
      "shadow",
    ]);

    // The eight effects of the registry, in its order, each a shadow plan with its lines or its reason.
    expect(sent.effects.map(e => e.key)).toEqual(
      opened.form.effects.map(e => e.key),
    );
    expect(sent.effects).toHaveLength(8);
    const planned = (e: EffectView) =>
      e.owner === "shadow" &&
      (e.state === "dry_run"
        ? e.lines.length > 0 && e.lines.every(l => l.trim() !== "")
        : e.state === "skipped" && !!e.reason?.trim());
    expect(sent.effects.filter(e => !planned(e))).toEqual([]);
    const effect = (key: string) =>
      sent.effects.find(e => e.key === key) as EffectView;
    // The plan would put the recording on Acme, and set the card from her DEFCON; neither happens.
    expect(effect("call_match").state).toBe("dry_run");
    expect(effect("happiness").lines).toEqual([
      "Would set Client Happiness to Neutral.",
    ]);
    expect(
      await q(
        "SELECT effect_key, owner, state FROM public.cockpit_form_effects WHERE response_id = $1 ORDER BY effect_key",
        [RID],
      ),
    ).toEqual(
      [...sent.effects]
        .sort((a, b) => (a.key < b.key ? -1 : 1))
        .map(e => ({ effect_key: e.key, owner: "shadow", state: e.state })),
    );
    // The window's read after the send shows the same plans.
    const read = await readResponse(csm, RID);
    expect(read.effects.map(e => [e.key, e.state, e.lines])).toEqual(
      sent.effects.map(e => [e.key, e.state, e.lines]),
    );
    // Only EffectView reaches the browser (3.3): the plans' other keys stay in the database.
    const raw = (await rpcAs(CSM, "cockpit_form_responses_read", {
      p_response_id: RID,
    })) as Row;
    expect(
      [...new Set(raw.effects.flatMap((e: Row) => Object.keys(e)))].sort(),
    ).toEqual([
      "at",
      "delivery",
      "key",
      "label",
      "lines",
      "owner",
      "reason",
      "state",
    ]);

    // Nothing outside the forms tables moved, and the matcher reads exactly what it read before.
    expect(await outside(from, to)).toEqual(before);
  });
});
