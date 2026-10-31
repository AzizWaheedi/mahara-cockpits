/**
 * Stage 2b fit (docs/forms/STAGE2B-CONTRACT.md section 8, "The fit test"): the
 * 2a base (20261025n, 20261025o, 20261026r, 20261026s, 20261026t, 20261027f,
 * 20261027g, 20261027h over 20261024a) and then the eight 2b files,
 * 20261029s_forms_registry.sql to 20261029z_forms_move_recording.sql, twice in
 * letter order, on one database with Supabase's default privileges on.
 *
 * It proves the pieces fit, never one builder's piece alone:
 *
 *   - every function of 2.2 is replaced by exactly its owning file: its
 *     whitespace-normalised body md5 equals the "after" value of that file's
 *     drift guard, its body is the text in that file, and its ACL is 2.2's;
 *     no other function the base made is replaced, and a second apply
 *     changes no function, column or row;
 *   - with every delivery path of 3.2 installed, cockpit_form_checkin_cutover()
 *     closes the shadow drafts and flips the registry (cut-over step 7b);
 *   - live check-ins sent through the 1-1 window's own calls
 *     (client-success-cockpit src/forms/checkinClient.ts, each answer parsed
 *     by the window's shapes): call_form and call_match delivered, four
 *     ClickUp rows queued in 3.3's shape, the grade waiting and then queued
 *     on a ready grade (3.4), a recap message on a ready recap (3.5);
 *   - every row of 3.6, end to end through the outboxes' own writers (the
 *     forms claim and the queue save, the notices claim, result and fix, the
 *     messages approve, claim, intent, result, reopen and skip);
 *   - the rollback restores the seeded registry row, and a delivery still
 *     queued is then refused by the owner gate (3.1);
 *   - no file of the 2b set holds a failing-marked case.
 *
 * PGlite has no pg_cron, vault or pg_net: the guarded blocks skip, and
 * nothing here reads a key or reaches a provider. The CEO's address is read
 * from the CEO gate migration, never written here; every other person,
 * client, recording and text is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
setDefaultTimeout(180_000);

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
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
/** The eight 2b files in letter order, by their full stems (2.1, "Names in tests"). */
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
const written = (file: string) =>
  existsSync(`${ROOT}supabase/migrations/${file}`);
const PRESENT = FILES_2B.filter(written);

const AUTH = "{postgres=X/postgres,authenticated=X/postgres}";
const SVC = "{postgres=X/postgres,service_role=X/postgres}";
const OWNER = "{postgres=X/postgres}";
/** Section 2.2: each replaced function, its owning 2b file, its live body md5 and the ACL it keeps. */
const REPLACED: [sig: string, file: string, live: string, acl: string][] = [
  [
    "cockpit_form_submit(uuid,integer)",
    "20261029w_forms_dispatch.sql",
    "fb609612258ad0d547b8fdfa4c0c91c7",
    AUTH,
  ],
  [
    "cockpit_form_effects_guard()",
    "20261029w_forms_dispatch.sql",
    "c981fe2cbc92a24ee393b974952de98f",
    OWNER,
  ],
  [
    "cockpit_slack_notices_kick()",
    "20261029u_forms_checkin_notices.sql",
    "49fd012b2325fbaeae9d28b7ea268dd1",
    OWNER,
  ],
  [
    "cockpit_slack_notice_claim(integer,uuid)",
    "20261029u_forms_checkin_notices.sql",
    "b415014351f4aa144aa845cbabf6cec0",
    SVC,
  ],
  [
    "cockpit_slack_notice_live(cockpit_slack_notices)",
    "20261029u_forms_checkin_notices.sql",
    "3644e7cd5eb63c7719fd5ff3666a8d84",
    OWNER,
  ],
  [
    "cockpit_slack_notice_shape(text)",
    "20261029u_forms_checkin_notices.sql",
    "4c02edfc21ceaa750e57f5cea8c9e547",
    OWNER,
  ],
  [
    "cockpit_slack_notice_kind_label(text)",
    "20261029u_forms_checkin_notices.sql",
    "499725dbaac9baf12f000161438c63d7",
    OWNER,
  ],
  [
    "cockpit_slack_notice_inputs(jsonb)",
    "20261029u_forms_checkin_notices.sql",
    "b4c826e37e783201fb3d777e5309b902",
    SVC,
  ],
  [
    "cockpit_slack_notice_doctor_inputs()",
    "20261029u_forms_checkin_notices.sql",
    "0a5c57a07e31ab08c7259dcb8f3d18f4",
    SVC,
  ],
  [
    "cockpit_slack_notice_settings_read()",
    "20261029u_forms_checkin_notices.sql",
    "a6cf20c2d9129b5716de6cda89f4192d",
    AUTH,
  ],
  [
    "cockpit_slack_notice_settings_set(text,jsonb)",
    "20261029u_forms_checkin_notices.sql",
    "80e2a814b671a43e0e78fe95788db934",
    AUTH,
  ],
  [
    "cockpit_slack_channel_remove(text)",
    "20261029u_forms_checkin_notices.sql",
    "1b21f1b259844b485b132f0a331bb97d",
    AUTH,
  ],
  [
    "cockpit_slack_notice_rehearse(text)",
    "20261029u_forms_checkin_notices.sql",
    "b8264c6a7f918e76a56bf750ab46ecec",
    AUTH,
  ],
  [
    "cockpit_slack_notice_rehearse_service(text,text)",
    "20261029u_forms_checkin_notices.sql",
    "036e4ea0b8088ff3b259b229ef79a0ec",
    SVC,
  ],
  [
    "cockpit_slack_notice_read(text)",
    "20261029u_forms_checkin_notices.sql",
    "4ae835e5809a599d0e4af167b8153dc0",
    AUTH,
  ],
  [
    "cockpit_clickup_writeback_claim(uuid,integer)",
    "20261029t_forms_clickup_writeback.sql",
    "39c142839f9d669354e9b0d0b6079842",
    SVC,
  ],
  [
    "cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)",
    "20261029t_forms_clickup_writeback.sql",
    "7329848a1ef67391a962c68b5ef67fd3",
    SVC,
  ],
  [
    "cockpit_clickup_writeback_begin(text,text,boolean)",
    "20261029t_forms_clickup_writeback.sql",
    "29906b33362f9cbcacd591e70071c0fa",
    SVC,
  ],
  [
    "cockpit_clickup_writeback_idle(text,boolean,text)",
    "20261029t_forms_clickup_writeback.sql",
    "e67840b5b981fe6fc5eca237a351c55c",
    SVC,
  ],
  [
    "cockpit_client_messages_guard()",
    "20261029v_forms_client_messages.sql",
    "6a0fe60fee0be51c3d22ddcd28986bdb",
    OWNER,
  ],
  [
    "cockpit_forms_key_put(jsonb)",
    "20261029y_forms_records.sql",
    "68763f4ab3de37be2fe538bc80155a43",
    SVC,
  ],
  [
    "cockpit_forms_key_mark(jsonb)",
    "20261029y_forms_records.sql",
    "db3c2859624bdbb75b43bf7de85f2672",
    SVC,
  ],
  [
    "cockpit_forms_key_label(text)",
    "20261029y_forms_records.sql",
    "5f01adc978c71ba5b7834b6083ea0b93",
    OWNER,
  ],
  [
    "cockpit_forms_keys_status()",
    "20261029y_forms_records.sql",
    "5ecbb4ae9493c0ef1c6f14cc78c84e12",
    AUTH,
  ],
];

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

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build
const GRADES = "C09SVG6FHGU";
/** Five impromptu calls the CSM recorded, each on no client yet; one live send for each. */
const SENDS = [
  { rid: "5b000000-0000-4000-8000-000000000001", rec: "900000601", task: A },
  { rid: "5b000000-0000-4000-8000-000000000002", rec: "900000602", task: B },
  { rid: "5b000000-0000-4000-8000-000000000003", rec: "900000603", task: A },
  { rid: "5b000000-0000-4000-8000-000000000004", rec: "900000604", task: B },
  { rid: "5b000000-0000-4000-8000-000000000005", rec: "900000605", task: A },
] as const;
/** A shadow note left open before the switch-over (cut-over step 7a voids it). */
const SHADOW = "5b000000-0000-4000-8000-0000000000aa";
const CARD_EFFECTS = [
  "todo_comment",
  "happiness",
  "last_poc",
  "last_checkin_call",
];

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** PostgreSQL's regexp_replace(s, '\s+', ' ', 'g'): its \s is exactly these six characters. */
const squash = (s: string) => s.replace(/[ \t\n\r\v\f]+/g, " ");

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function q<X = Row>(text: string, params: unknown[] = []): Promise<X[]> {
  await asOwner();
  return (await db.query<X>(text, params)).rows;
}
async function one<X = any>(text: string, params: unknown[] = []): Promise<X> {
  return ((await q<{ v: X }>(text, params))[0] as { v: X } | undefined)?.v as X;
}

// --- RPCs by name, as PostgREST calls them -----------------------------------------------------

type Sig = { names: string[]; types: string[]; required: number };
const sigCache = new Map<string, Sig[]>();
async function signatures(name: string): Promise<Sig[]> {
  const known = sigCache.get(name);
  if (known) return known;
  const rows = await q<{
    names: string[] | null;
    types: string[];
    nargs: number;
    ndef: number;
  }>(
    `SELECT p.proargnames AS names,
            ARRAY(SELECT format_type(u.t, NULL) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS u(t, i) ORDER BY u.i) AS types,
            p.pronargs AS nargs, p.pronargdefaults AS ndef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [name],
  );
  const sigs = rows.map(r => ({
    names: (r.names ?? []).slice(0, r.nargs),
    types: r.types,
    required: r.nargs - r.ndef,
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
): Promise<any> {
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
const service = (name: string, args: Record<string, unknown> = {}) =>
  rpcAs("service", name, args);

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

// --- The database the 2b files stand on (the 2a fit's cut, with the settings table) -----------

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

/** The seats, the people by role, the roster the client gate reads. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  for (const [name, email, role] of [
    ["Noura Test", CSM_EMAIL, "Client success manager"],
    ["Omar Test", "creative@tests.invalid", "Creative strategist"],
    ["Ceo Test", CEO_EMAIL, "CEO"],
  ])
    await q(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );
  const snap = "2026-10-28T08:00:00Z";
  const clients = [
    [A, "Acme Interiors", "Active", "Happy"],
    [B, "Beta Build", "Active", "Neutral"],
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

/**
 * The store as the worker writes it: the newest Typeform 1-1 form, on Acme with
 * its recording link (cut-over step 4 reads it), and the four impromptu calls
 * the CSM recorded today, each a candidate on no client yet.
 */
async function store() {
  const csm = {
    name: "Noura Test",
    email: CSM_EMAIL,
    team: "Customer Success",
  };
  for (const [i, s] of SENDS.entries()) {
    const start = ago(200 - i * 25);
    const end = ago(185 - i * 25);
    const invitees = [{ name: csm.name, email: csm.email, is_external: false }];
    await q(
      `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
         external,invitees,url,share_url,summary,raw,class,recorder_team)
       VALUES($1,'Impromptu Google Meet Meeting',$2,$3,$4,$5,false,$6::jsonb,$7,$8,'Invented summary.',$9::jsonb,'candidate',
              'Customer Success')`,
      [
        s.rec,
        start,
        end,
        csm.email,
        csm.name,
        JSON.stringify(invitees),
        `https://fathom.video/calls/${Number(s.rec) + 1000}`,
        `https://fathom.video/share/test-${s.rec}`,
        JSON.stringify({
          recording_id: Number(s.rec),
          recorded_by: csm,
          calendar_invitees: invitees,
          shared_with: "all_teams",
          default_summary: { markdown_formatted: "Invented summary." },
          action_items: [{ description: "Invented action", completed: false }],
          created_at: end,
        }),
      ],
    );
    await q(
      `INSERT INTO public.cockpit_csm_calls(source,source_id,kind,title,starts_at,ends_at,status,provider_status,host_email,
         host_name,recording_url,summary,candidate)
       VALUES('fathom',$1,'other','Impromptu Google Meet Meeting',$2,$3,'held','recorded',$4,'Noura Test',$5,
              'Invented summary.',true)`,
      [
        s.rec,
        start,
        end,
        CSM_EMAIL,
        `https://fathom.video/calls/${Number(s.rec) + 1000}`,
      ],
    );
  }
  const share = "https://fathom.video/share/test-900000500";
  await q(
    `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,typed_client,matched_by,submitted_at,answers,
       recording_url)
     VALUES('fit2bcheckin0001','fRokTITH','checkin',$1,'Acme Interiors','hidden_field',$2,$3::jsonb,$4)`,
    [
      A,
      ago(1500),
      JSON.stringify([
        { ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587", value: "Happy" },
        { ref: "0773087f-beda-4e2c-bf50-acdac0dcbe05", value: share },
      ]),
      share,
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
let base: Shape; // the 2a base
let once: Shape; // after the 2b files
let twice: Shape; // after the 2b files again
let seed: Row; // the registry's checkin row before the switch-over

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await standOn();
  await seats();
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE_2A) await db.exec(migration(file));
  await store();
  base = await shape();
  for (const file of PRESENT) await db.exec(migration(file));
  once = await shape();
  for (const file of PRESENT) await db.exec(migration(file));
  twice = await shape();
  seed = (
    await q(
      "SELECT provider, typeform_id, version, effects FROM public.cockpit_forms WHERE key = 'checkin'",
    )
  )[0];
}, 600_000);
afterAll(async () => {
  await db?.close();
});

const all2b = PRESENT.length === FILES_2B.length;
/** The live path needs the registry, the three outboxes' files and the dispatch (s to w); x, y and z add no delivery path. */
const paths = FILES_2B.slice(0, 5).every(written);

describe("the eight 2b files on the 2a base", () => {
  test("every 2b file is written", () => {
    expect(FILES_2B.filter(f => !written(f))).toEqual([]);
  });

  test("a second apply changes no function, column or row", () => {
    expect(
      [...once.fns].filter(([sig, h]) => twice.fns.get(sig) !== h),
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
  });

  test.skipIf(!all2b)(
    "they replace exactly the functions of 2.2, and keep every column the base made",
    async () => {
      const replaced = [...base.fns]
        .filter(([sig, h]) => twice.fns.get(sig) !== h)
        .map(([sig]) => sig)
        .sort();
      const expected = (
        await Promise.all(
          REPLACED.map(([sig]) =>
            one<string>("SELECT to_regprocedure($1)::text AS v", [
              `public.${sig}`,
            ]),
          ),
        )
      ).sort();
      expect(replaced).toEqual(expected);
      const altered: string[] = [];
      for (const [table, cols] of base.cols) {
        const now = twice.cols.get(table) ?? new Map<string, string>();
        for (const [col, def] of cols)
          if (now.get(col) !== def) altered.push(`${table}.${col}`);
      }
      expect(altered).toEqual([]);
      // The one new column (2.3), and no table.
      expect(
        [...twice.cols.get("cockpit_forms")!.keys()].filter(
          c => !base.cols.get("cockpit_forms")!.has(c),
        ),
      ).toEqual(["provider_since"]);
      expect([...twice.cols.keys()].filter(t => !base.cols.has(t))).toEqual([]);
      // Nothing turns on: the registry is the seed, and Move it here is off.
      expect(
        await q(
          "SELECT key, provider, provider_since FROM public.cockpit_forms ORDER BY key",
        ),
      ).toEqual([
        { key: "blueprint", provider: "native", provider_since: null },
        { key: "checkin", provider: "typeform", provider_since: null },
        { key: "kickoff", provider: "typeform", provider_since: null },
      ]);
      expect(seed.effects.map((e: Row) => e.owner)).toEqual(
        Array(8).fill("shadow"),
      );
      expect(
        await one(
          "SELECT value AS v FROM public.cockpit_settings WHERE key = 'forms.move_recording'",
        ),
      ).toEqual({ on: false });
    },
  );

  for (const [sig, file, live, acl] of REPLACED)
    test.skipIf(!written(file))(
      `${sig}: ${file}'s body and drift guard, and 2.2's ACL`,
      async () => {
        const name = sig.slice(0, sig.indexOf("("));
        const text = migration(file);
        // The drift guard's row for this function: (signature, live body md5, after), schema-qualified or not.
        const plain = (x: string) =>
          x
            .replace(/public\./g, "")
            .replace(/timestamp with time zone/g, "timestamptz")
            .replace(/\s+/g, "");
        const guard = [
          ...text.matchAll(
            /\(\s*'((?:public\.)?[a-z_]+\([^)]*\))'\s*,\s*'([0-9a-f]{32})'\s*,\s*'([0-9a-f]{32})'\s*\)/g,
          ),
        ].find(m => plain(m[1]) === plain(sig));
        expect(
          guard,
          `${file} has no drift guard row for ${sig}`,
        ).toBeDefined();
        expect(guard?.[2]).toBe(live);
        // The body this file installs: the last definition of the function in it.
        const defs = [
          ...text.matchAll(
            new RegExp(
              `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_]*\\$)([\\s\\S]*?)\\1`,
              "gi",
            ),
          ),
        ];
        expect(defs.length, `${file} does not define ${name}`).toBeGreaterThan(
          0,
        );
        const body = defs[defs.length - 1][2];
        const installed = (
          await q<{ src: string; h: string; acl: string; definer: boolean }>(
            `SELECT regexp_replace(p.prosrc, '\\s+', ' ', 'g') AS src, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS h,
                  p.proacl::text AS acl, p.prosecdef AS definer
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
            [`public.${sig}`],
          )
        )[0];
        expect(installed.src).toBe(squash(body));
        expect(installed.h).toBe(md5(squash(body)));
        expect(installed.h, `${file}'s drift guard "after" for ${sig}`).toBe(
          guard?.[3],
        );
        expect(installed.h).not.toBe(live);
        expect([installed.acl, installed.definer]).toEqual([acl, true]);
      },
    );
});

// --- The live path, end to end ------------------------------------------------------------------

/** The queue rows, notices and messages of one response, as the outboxes hold them. */
async function deliveries(rid: string) {
  const effects = await q(
    `SELECT effect_key, owner, state, reason, delivery, delivery_ref FROM public.cockpit_form_effects
      WHERE response_id = $1 ORDER BY effect_key`,
    [rid],
  );
  const byKey = Object.fromEntries(effects.map(e => [e.effect_key, e]));
  return { effects, byKey };
}
const effectOf = async (rid: string, key: string) =>
  (await deliveries(rid)).byKey[key] as Row;
const queueRows = (rid: string) =>
  q(
    "SELECT id, state, dedupe_key, source_table, source_id, task_id, payload FROM public.cockpit_clickup_writeback_queue WHERE kind = 'form' AND payload->>'responseId' = $1 ORDER BY dedupe_key",
    [rid],
  );

/** The CSM's live send through the window's calls: the call she picked, DEFCON, priority and both to-do lists. */
async function liveSend(s: (typeof SENDS)[number]) {
  const csm = seat(CSM);
  const opened = await openCheckin(csm, {
    taskId: s.task,
    responseId: s.rid,
    rehearse: false,
  });
  expect([opened.form.mode, opened.response?.state]).toEqual(["live", "draft"]);
  const todo = (text: string) => ({
    text,
    owner: null,
    at: null,
    href: null,
    from: "csm",
    unsure: false,
  });
  const saved = await saveCheckin(csm, {
    responseId: s.rid,
    changes: {
      call: {
        value: {
          kind: "fathom",
          recordingId: s.rec,
          why: "picked",
          confirmed: true,
        },
        seen: null,
      },
      defcon: { value: "Neutral", seen: null },
      priority: { value: "Medium", seen: null },
      we_owe: {
        value: [todo("Send the new ad drafts by Thursday")],
        seen: null,
      },
      they_owe: {
        value: [todo("Share the showroom photos with the team")],
        seen: null,
      },
    },
    session: `fit2b-${s.rec}`,
    baseRevision: opened.response?.revision ?? null,
  });
  return submitCheckin(csm, {
    responseId: s.rid,
    baseRevision: saved.row.revision,
  });
}

/** A ready draft, as cockpit-forms-api writes one (begin, then finish). */
async function readyDraft(
  kind: "grade" | "recap",
  s: (typeof SENDS)[number],
  text: string | null,
) {
  const begun = await service("cockpit_form_draft_begin", {
    p: {
      formKey: "checkin",
      taskId: s.task,
      recordingId: s.rec,
      kind,
      provider: "anthropic",
      promptVersion: `checkin.${kind}.v1`,
      inputSha256: sha256(`${kind}:${s.rid}`),
      again: false,
      actorEmail: CSM_EMAIL,
      ...(kind === "recap" ? { responseId: s.rid } : {}),
    },
  });
  const output =
    kind === "grade"
      ? {
          criteria: [{ name: "Rapport", score: 8, note: "Invented note." }],
          overall: "An invented, clear call.",
          color: "Green",
          score: 8,
        }
      : { skip: false, message: text };
  const view = await service("cockpit_form_draft_finish", {
    p_id: begun.id,
    p: {
      state: "ready",
      output,
      text,
      model: "invented-model",
      actorEmail: CSM_EMAIL,
    },
  });
  expect(view.state).toBe("ready");
  return { id: begun.id as string, ...view };
}

/** The forms writer's claim, with the mode its last report gives. */
async function claimForms(limit = 8): Promise<Row[]> {
  const token = crypto.randomUUID();
  const out = await service("cockpit_clickup_writeback_claim_forms", {
    p_token: token,
    p_limit: limit,
  });
  const rows: Row[] = Array.isArray(out) ? out : (out?.rows ?? []);
  return rows.map(r => ({ ...r, token }));
}
const saveQueue = (row: Row, patch: Row) =>
  service("cockpit_clickup_writeback_save", {
    p_id: row.id,
    p_token: row.token,
    p_patch: patch,
  });
const claimNotice = (id: string) =>
  service("cockpit_slack_notice_claim", { p_limit: 5, p_only: id });
const noticeResult = (
  id: string,
  outcome: string,
  error: string | null = null,
) =>
  service("cockpit_slack_notice_result", {
    p_id: id,
    p_outcome: outcome,
    p_ts:
      outcome === "posted"
        ? `1730${Math.floor(Math.random() * 1e6)}.000100`
        : null,
    p_channel: outcome === "posted" ? GRADES : null,
    p_error: error,
    p_detail: {},
  });
const noticeOf = async (rid: string) =>
  (
    await q(
      "SELECT id, state, error, kind, dedupe_key, facts, target FROM public.cockpit_slack_notices WHERE facts->>'responseId' = $1",
      [rid],
    )
  )[0];
const messageOf = async (rid: string) =>
  (
    await q(
      "SELECT id, state, reason, kind, body, body_sha256, dedupe_key, draft_id, task_id FROM public.cockpit_client_messages WHERE response_id = $1",
      [rid],
    )
  )[0];
async function claimMessage(id: string): Promise<string> {
  const out = await service("cockpit_client_message_claim", {
    p_kinds: ["recap_checkin"],
    p_only_cards: null,
    p_limit: 3,
  });
  const row = (out.rows as Row[]).find(r => r.id === id);
  expect(row, "the message was not claimed").toBeDefined();
  return row?.claimToken as string;
}
async function approveMessage(id: string) {
  const m = (
    await q("SELECT body FROM public.cockpit_client_messages WHERE id = $1", [
      id,
    ])
  )[0];
  return service("cockpit_client_message_approve", {
    p_id: id,
    p_body: m.body,
    p_body_sha256: sha256(m.body),
    p_actor: CSM,
    p_warnings: [],
  });
}
const messageResult = (
  id: string,
  claim: string,
  outcome: string,
  o: { providerId?: string; reason?: string; readBack?: Row } = {},
) =>
  service("cockpit_client_message_result", {
    p_id: id,
    p_claim: claim,
    p_outcome: outcome,
    p_provider_id: o.providerId ?? null,
    p_reason: o.reason ?? null,
    p_read_back: o.readBack ?? null,
  });

describe.skipIf(!paths)(
  "the switch-over and live 1-1 notes, end to end",
  () => {
    test("every delivery path is installed, and cockpit_form_checkin_cutover() closes the shadow drafts and flips the registry", async () => {
      // The grades channel as it is live (private, ok; G1); the file seeds it as checking.
      await q(
        "UPDATE public.cockpit_slack_channels SET state = 'ok', private = true WHERE id = $1",
        [GRADES],
      );
      for (const e of seed.effects as Row[])
        expect([
          e.key,
          await one(
            "SELECT public.cockpit_form_delivery_ready('checkin', $1) AS v",
            [e.key],
          ),
        ]).toEqual([e.key, null]);
      // A shadow note the CSM left open.
      const csm = seat(CSM);
      expect((await readEntry(csm)).mode).toBe("shadow");
      const shadow = await openCheckin(csm, {
        taskId: A,
        responseId: SHADOW,
        rehearse: false,
      });
      expect([shadow.form.mode, shadow.response?.state]).toEqual([
        "shadow",
        "draft",
      ]);

      const answer = await one<Row>(
        "SELECT public.cockpit_form_checkin_cutover() AS v",
      );
      expect(answer.voided).toBe(1);
      expect(answer.newestTypeform).toMatchObject({
        token: "fit2bcheckin0001",
        taskId: A,
      });
      expect(answer.unlinked14d).toEqual([]);
      expect(answer.nativeSince).toEqual(expect.any(String));
      expect(answer.auditId).toEqual(expect.any(String));
      const row = (
        await q(
          "SELECT provider, typeform_id, provider_since, effects FROM public.cockpit_forms WHERE key = 'checkin'",
        )
      )[0];
      expect([
        row.provider,
        row.typeform_id,
        row.provider_since !== null,
      ]).toEqual(["native", "fRokTITH", true]);
      expect(row.effects.map((e: Row) => e.owner)).toEqual(
        Array(8).fill("cockpit"),
      );
      expect(
        await one(
          "SELECT state AS v FROM public.cockpit_form_responses WHERE id = $1",
          [SHADOW],
        ),
      ).toBe("void");
      // The audit row is the second source of the cut-over time (Z13).
      const audit = (
        await q(
          "SELECT action, before->>'provider' AS was, after->>'provider' AS now, created_at FROM public.cockpit_audit_log WHERE id = $1",
          [answer.auditId],
        )
      )[0];
      expect([audit.action, audit.was, audit.now]).toEqual([
        "forms.registry_set",
        "typeform",
        "native",
      ]);
      expect(new Date(audit.created_at).getTime()).toBe(
        new Date(row.provider_since).getTime(),
      );
      // A second run refuses: the switch-over already ran.
      await expect(
        q("SELECT public.cockpit_form_checkin_cutover()"),
      ).rejects.toThrow("The 1-1 notes already open in the cockpit.");
    });

    test("a live send through the window: the notes rows delivered, four ClickUp rows queued, the grade and recap waiting", async () => {
      const entry = await readEntry(seat(CSM));
      expect([entry.provider, entry.mode]).toEqual(["native", "live"]);
      const s = SENDS[0];
      const sent = await liveSend(s);
      expect([sent.response.state, sent.response.mode, sent.duplicate]).toEqual(
        ["submitted", "live", false],
      );
      const state = (key: string) =>
        (sent.effects.find(e => e.key === key) as EffectView).state;
      expect(
        Object.fromEntries(sent.effects.map(e => [e.key, [e.owner, e.state]])),
      ).toEqual({
        call_form: ["cockpit", "delivered"],
        call_match: ["cockpit", "delivered"],
        todo_comment: ["cockpit", "queued"],
        happiness: ["cockpit", "queued"],
        last_poc: ["cockpit", "queued"],
        last_checkin_call: ["cockpit", "queued"],
        grade_notice: ["cockpit", "planned"],
        recap: ["cockpit", "planned"],
      });
      expect(state("call_form")).toBe("delivered");
      // The notes reached the store, and the recording is now on Acme.
      expect(
        await one(
          "SELECT count(*)::int AS v FROM public.cockpit_csm_call_forms WHERE form_id = 'cockpit-checkin' AND task_id = $1",
          [A],
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT task_id AS v FROM public.cockpit_csm_calls WHERE source = 'fathom' AND source_id = $1",
          [s.rec],
        ),
      ).toBe(A);

      // 3.3: one queue row per card effect, no comment text, the effect pointing at it.
      const rows = await queueRows(s.rid);
      expect(
        rows.map(r => [r.dedupe_key, r.state, r.source_table, r.task_id]),
      ).toEqual(
        [...CARD_EFFECTS]
          .sort()
          .map(k => [`${s.rid}:${k}`, "queued", "cockpit_form_effects", A]),
      );
      const { byKey } = await deliveries(s.rid);
      for (const r of rows) {
        const key = r.payload.effectKey;
        expect(r.payload).toMatchObject({
          formKey: "checkin",
          responseId: s.rid,
          effectKey: key,
          taskId: A,
          clientName: "Acme Interiors",
        });
        expect(r.payload.effectId).toBe(r.source_id);
        expect("comment_text" in r.payload || "lines" in r.payload).toBe(false);
        expect(byKey[key]).toMatchObject({
          state: "queued",
          delivery: "clickup_queue",
          delivery_ref: r.id,
        });
      }
      const comment = rows.find(r => r.payload.effectKey === "todo_comment")!;
      const plan = await one<Row>(
        "SELECT plan AS v FROM public.cockpit_form_effects WHERE id = $1",
        [comment.source_id],
      );
      expect(comment.payload.commentSha256).toBe(sha256(plan.comment_text));
      expect(comment.payload.commentChars).toBe([...plan.comment_text].length);
      expect(
        JSON.stringify(
          await q("SELECT payload FROM public.cockpit_clickup_writeback_queue"),
        ),
      ).not.toContain("ad drafts");
      // The grade and the recap wait for their drafts (3.12), with no delivery row yet.
      expect([byKey.grade_notice.reason, byKey.recap.reason]).toEqual([
        "Waiting for the grade.",
        "Waiting for the recap draft.",
      ]);
      expect(await noticeOf(s.rid)).toBeUndefined();
      expect(await messageOf(s.rid)).toBeUndefined();

      // The window's own read shows the same.
      const read = await readResponse(seat(CSM), s.rid);
      expect(read.effects.map(e => [e.key, e.state])).toEqual(
        sent.effects.map(e => [e.key, e.state]),
      );
    });

    test("a ready grade queues the notice (3.4) and a ready recap makes the message (3.5)", async () => {
      const s = SENDS[0];
      const grade = await readyDraft("grade", s, null);
      const notice = await noticeOf(s.rid);
      // 3.4 queues it with no target: the claim reads the Call grade setting's private channel.
      expect(notice).toMatchObject({
        kind: "checkin.grade",
        state: "queued",
        dedupe_key: `grade:${s.rec}`,
        target: null,
      });
      expect(Object.keys(notice.facts).sort()).toEqual([
        "client",
        "draftId",
        "effectId",
        "recordingId",
        "responseId",
        "submittedAt",
        "taskId",
      ]);
      expect(notice.facts).toMatchObject({
        responseId: s.rid,
        recordingId: s.rec,
        draftId: grade.id,
        taskId: A,
        client: "Acme Interiors",
      });
      expect(JSON.stringify(notice.facts)).not.toContain(
        "invented, clear call",
      );
      expect(await effectOf(s.rid, "grade_notice")).toMatchObject({
        state: "queued",
        delivery_ref: notice.id,
      });

      const text =
        "Thanks for the call today. Next: the new ad drafts by Thursday, and the showroom photos from you.";
      const recap = await readyDraft("recap", s, text);
      const message = await messageOf(s.rid);
      expect(message).toMatchObject({
        kind: "recap_checkin",
        state: "draft",
        body: text,
        body_sha256: sha256(text),
        dedupe_key: `${s.rid}:recap`,
        draft_id: recap.id,
        task_id: A,
      });
      expect(await effectOf(s.rid, "recap")).toMatchObject({
        state: "queued",
        delivery_ref: message.id,
      });
    });

    test("four more live sends, each with its grade and recap ready", async () => {
      for (const s of SENDS.slice(1)) {
        const sent = await liveSend(s);
        expect(
          sent.effects
            .filter(e => CARD_EFFECTS.includes(e.key))
            .map(e => e.state),
        ).toEqual(Array(4).fill("queued"));
        await readyDraft("grade", s, null);
        await readyDraft("recap", s, `Thanks for the call today (${s.rec}).`);
        const { byKey } = await deliveries(s.rid);
        expect([byKey.grade_notice.state, byKey.recap.state]).toEqual([
          "queued",
          "queued",
        ]);
      }
    });

    test("3.6, the ClickUp rows: delivered, failed, unknown then skipped, skipped, dry_run, and retry changing nothing", async () => {
      // The writer reports apply (its function secret), so its claim hands rows out.
      await service("cockpit_clickup_forms_state", {
        p_ok: true,
        p_note: "Nothing to write.",
        p_mode: "apply",
        p_only_cards: null,
        p_counts: {},
      });
      const [s1, s2] = SENDS;
      const first = await claimForms();
      // One lane per card: the two oldest responses, one per card, each whole, in Make's order.
      expect(
        first.map(r => [r.payload.responseId, r.payload.effectKey]),
      ).toEqual([
        ...CARD_EFFECTS.map(k => [s1.rid, k]),
        ...CARD_EFFECTS.map(k => [s2.rid, k]),
      ]);
      const todoRow = first.find(
        r =>
          r.payload.responseId === s1.rid &&
          r.payload.effectKey === "todo_comment",
      )!;
      expect(todoRow.effect.plan.comment_text).toEqual(expect.any(String));
      expect("lines" in todoRow.effect.plan).toBe(false);
      // A row the writer holds (sending) changes no effect.
      for (const s of [s1, s2])
        expect((await queueRows(s.rid)).map(r => r.state)).toEqual(
          Array(4).fill("sending"),
        );
      for (const s of [s1, s2])
        for (const key of CARD_EFFECTS)
          expect((await effectOf(s.rid, key)).state).toBe("queued");
      const pick = (rid: string, key: string) =>
        first.find(
          r => r.payload.responseId === rid && r.payload.effectKey === key,
        )!;
      await saveQueue(pick(s1.rid, "todo_comment"), {
        state: "delivered",
        delivered_at: new Date().toISOString(),
        progress: {
          steps: { todo_comment: { state: "done", commentId: "90001" } },
        },
      });
      await saveQueue(pick(s1.rid, "happiness"), {
        state: "failed",
        error: "Client Happiness has no such option on this card.",
      });
      await saveQueue(pick(s1.rid, "last_poc"), {
        state: "unknown",
        error: "The date did not read back.",
      });
      await saveQueue(pick(s1.rid, "last_checkin_call"), {
        state: "skipped",
        error: "Last check-in call stays 30 Oct: it is newer than this call.",
      });
      await saveQueue(pick(s2.rid, "todo_comment"), { state: "dry_run" });
      await saveQueue(pick(s2.rid, "happiness"), {
        state: "retry",
        error: "ClickUp answered 429.",
        next_attempt_at: new Date().toISOString(),
      });
      await saveQueue(pick(s2.rid, "last_poc"), {
        state: "delivered",
        delivered_at: new Date().toISOString(),
      });
      await saveQueue(pick(s2.rid, "last_checkin_call"), {
        state: "delivered",
        delivered_at: new Date().toISOString(),
      });
      const one1 = (await deliveries(s1.rid)).byKey;
      expect([
        one1.todo_comment.state,
        one1.happiness.state,
        one1.happiness.reason,
        one1.last_poc.state,
        one1.last_checkin_call.state,
        one1.last_checkin_call.reason,
      ]).toEqual([
        "delivered",
        "failed",
        "Client Happiness has no such option on this card.",
        "unknown",
        "skipped",
        "Last check-in call stays 30 Oct: it is newer than this call.",
      ]);
      const one2 = (await deliveries(s2.rid)).byKey;
      expect([
        one2.todo_comment.state,
        one2.todo_comment.reason,
        one2.happiness.state,
        one2.last_poc.state,
      ]).toEqual([
        "failed",
        "The ClickUp writer ran this as a dry run; nothing was written.",
        "queued",
        "delivered",
      ]);
      // The unknown and the retry are claimed again (an unknown effect passes the gate); the newer responses on
      // each card wait behind them. A read-back proves the date was not written: skipped, the guard's added
      // move. The retry is retried once more, and its effect still waits queued.
      const again = await claimForms();
      expect(
        again.map(r => [r.payload.responseId, r.payload.effectKey]),
      ).toEqual([
        [s1.rid, "last_poc"],
        [s2.rid, "happiness"],
      ]);
      await saveQueue(again[0], {
        state: "skipped",
        error: "Last POC stays 30 Oct: it is newer than this call.",
      });
      expect(await effectOf(s1.rid, "last_poc")).toMatchObject({
        state: "skipped",
        reason: "Last POC stays 30 Oct: it is newer than this call.",
      });
      await saveQueue(again[1], {
        state: "retry",
        error: "ClickUp answered 429.",
        next_attempt_at: new Date().toISOString(),
      });
      expect((await effectOf(s2.rid, "happiness")).state).toBe("queued");
    });

    test("3.6, the grade notices: unknown then posted, posted, failed then requeued, then muted by the kill switch", async () => {
      const [s1, s2, s3] = SENDS;
      // s1: the post did not confirm, then the sender found it in Slack.
      const n1 = await noticeOf(s1.rid);
      const claimed = await claimNotice(n1.id);
      expect((claimed.rows as Row[]).map(r => r.id)).toEqual([n1.id]);
      await noticeResult(n1.id, "unknown", "Slack did not answer in time.");
      expect(await effectOf(s1.rid, "grade_notice")).toMatchObject({
        state: "unknown",
        reason: "Slack did not answer in time.",
      });
      await noticeResult(n1.id, "posted");
      expect((await effectOf(s1.rid, "grade_notice")).state).toBe("delivered");
      // s3: posted at once.
      const n3 = await noticeOf(s3.rid);
      await claimNotice(n3.id);
      await noticeResult(n3.id, "posted");
      expect((await effectOf(s3.rid, "grade_notice")).state).toBe("delivered");
      // s2: failed, a person requeues it (the effect back in the queue under forms_fix), then the kill switch mutes it.
      const n2 = await noticeOf(s2.rid);
      await claimNotice(n2.id);
      await noticeResult(n2.id, "failed", "Slack refused the post.");
      expect(await effectOf(s2.rid, "grade_notice")).toMatchObject({
        state: "failed",
        reason: "Slack refused the post.",
      });
      await service("cockpit_slack_notice_fix", {
        p_id: n2.id,
        p_action: "requeue",
        p_note: "Tried again.",
      });
      expect((await effectOf(s2.rid, "grade_notice")).state).toBe("queued");
      await rpcAs(CEO, "cockpit_slack_notice_settings_set", {
        p_kind: "checkin.grade",
        p_patch: { on: false },
      });
      await claimNotice(n2.id);
      expect((await noticeOf(s2.rid)).state).toBe("muted");
      expect(await effectOf(s2.rid, "grade_notice")).toMatchObject({
        state: "skipped",
        reason: "The call grade notice is off in Notices and routing.",
      });
      await rpcAs(CEO, "cockpit_slack_notice_settings_set", {
        p_kind: "checkin.grade",
        p_patch: { on: true },
      });
    });

    test("3.6, the recap messages: sent, unknown then reconciled, failed then reopened, refused then skipped, failed then skipped", async () => {
      const [s1, s2, s3, s4] = SENDS;
      // s1: approved, claimed, the gate again at intent, then WhatsApp's id; the effect waits queued until sent.
      const m1 = await messageOf(s1.rid);
      await approveMessage(m1.id);
      const c1 = await claimMessage(m1.id);
      expect((await effectOf(s1.rid, "recap")).state).toBe("queued");
      expect(
        await service("cockpit_client_message_intent", {
          p_id: m1.id,
          p_claim: c1,
        }),
      ).toEqual({ ok: true });
      await messageResult(m1.id, c1, "sent", {
        providerId: "wamid.invented0001",
      });
      expect((await effectOf(s1.rid, "recap")).state).toBe("delivered");
      await messageResult(m1.id, c1, "read_back", {
        readBack: { by: "message_id", providerId: "wamid.invented0001" },
      });
      // s3: the send did not confirm, then the sender found it by its fingerprint.
      const m3 = await messageOf(s3.rid);
      await approveMessage(m3.id);
      const c3 = await claimMessage(m3.id);
      await service("cockpit_client_message_intent", {
        p_id: m3.id,
        p_claim: c3,
      });
      await messageResult(m3.id, c3, "unknown");
      expect((await effectOf(s3.rid, "recap")).state).toBe("unknown");
      await messageResult(m3.id, c3, "reconciled", {
        providerId: "wamid.invented0003",
        readBack: { by: "body_sha256" },
      });
      expect((await effectOf(s3.rid, "recap")).state).toBe("delivered");
      // s2: WhatsApp failed it; the CSM reopens it (the effect back in the queue), approves again, it is refused
      // (no group), and she skips it: the effect settles skipped.
      const m2 = await messageOf(s2.rid);
      await approveMessage(m2.id);
      let c2 = await claimMessage(m2.id);
      await service("cockpit_client_message_intent", {
        p_id: m2.id,
        p_claim: c2,
      });
      await messageResult(m2.id, c2, "failed", {
        reason: "WhatsApp answered 400.",
      });
      expect(await effectOf(s2.rid, "recap")).toMatchObject({
        state: "failed",
        reason: "WhatsApp answered 400.",
      });
      await rpcAs(CSM, "cockpit_client_message_reopen", { p_id: m2.id });
      expect((await effectOf(s2.rid, "recap")).state).toBe("queued");
      await approveMessage(m2.id);
      c2 = await claimMessage(m2.id);
      await messageResult(m2.id, c2, "refused", {
        reason: "No WhatsApp group on Client Data for this card.",
      });
      expect((await effectOf(s2.rid, "recap")).state).toBe("queued");
      await rpcAs(CSM, "cockpit_client_message_skip", {
        p_id: m2.id,
        p_reason: "Sent by hand in the group.",
      });
      expect(await effectOf(s2.rid, "recap")).toMatchObject({
        state: "skipped",
        reason: "Sent by hand in the group.",
      });
      // s4: failed, then skipped by a person: the message is skipped, its effect stays failed (Z55).
      const m4 = await messageOf(s4.rid);
      await approveMessage(m4.id);
      const c4 = await claimMessage(m4.id);
      await service("cockpit_client_message_intent", {
        p_id: m4.id,
        p_claim: c4,
      });
      await messageResult(m4.id, c4, "failed", {
        reason: "WhatsApp answered 400.",
      });
      await rpcAs(CSM, "cockpit_client_message_skip", {
        p_id: m4.id,
        p_reason: "Not needed any more.",
      });
      expect((await messageOf(s4.rid)).state).toBe("skipped");
      expect(await effectOf(s4.rid, "recap")).toMatchObject({
        state: "failed",
        reason: "WhatsApp answered 400.",
      });
    });

    test("the rollback restores the seeded registry row, and what is still queued is refused by the owner gate", async () => {
      const [, s2, s3, s4, s5] = SENDS;
      // s5's recap is approved and waiting for the sender when the rollback runs.
      const m5 = await messageOf(s5.rid);
      await approveMessage(m5.id);
      await one(
        `SELECT public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}'::jsonb,
         '{"via":"cutover-rollback","email":"cut-over"}'::jsonb) AS v`,
      );
      expect(
        (
          await q(
            "SELECT provider, typeform_id, version, effects FROM public.cockpit_forms WHERE key = 'checkin'",
          )
        )[0],
      ).toEqual(seed);
      expect((await readEntry(seat(CSM))).mode).toBe("shadow");
      // The ClickUp rows still waiting: s2's retry row and s3's four, then s4's and s5's once their lanes are
      // clear. Each is refused at the writer's claim, so nothing reaches the writer.
      expect(await claimForms()).toEqual([]);
      expect(await claimForms()).toEqual([]);
      expect(await effectOf(s2.rid, "happiness")).toMatchObject({
        state: "skipped",
        reason: "Make owns this again.",
      });
      for (const s of [s3, s4, s5])
        for (const key of CARD_EFFECTS)
          expect(await effectOf(s.rid, key)).toMatchObject({
            state: "skipped",
            reason: "Make owns this again.",
          });
      expect(
        await one<number>(
          "SELECT count(*)::int AS v FROM public.cockpit_clickup_writeback_queue WHERE kind = 'form' AND state IN ('queued','sending','retry','unknown')",
        ),
      ).toBe(0);
      // The grade notices still queued, at the notices' claim.
      for (const s of [s4, s5]) {
        await claimNotice((await noticeOf(s.rid)).id);
        expect(await noticeOf(s.rid)).toMatchObject({
          state: "skipped",
          error: "Make owns this again.",
        });
        expect(await effectOf(s.rid, "grade_notice")).toMatchObject({
          state: "skipped",
          reason: "Make owns this again.",
        });
      }
      // The approved recap, at the sender's claim: nothing is claimed, the message and its effect skipped.
      const claimed = await service("cockpit_client_message_claim", {
        p_kinds: ["recap_checkin"],
        p_only_cards: null,
        p_limit: 3,
      });
      expect(claimed.rows).toEqual([]);
      expect(await messageOf(s5.rid)).toMatchObject({
        state: "skipped",
        reason: "Make owns this again.",
      });
      expect(await effectOf(s5.rid, "recap")).toMatchObject({
        state: "skipped",
        reason: "Make owns this again.",
      });
      // The gate itself, for a write nothing points at and for one already settled (3.1).
      expect(
        await one(
          "SELECT public.cockpit_form_effect_gate('clickup_queue', $1) AS v",
          [crypto.randomUUID()],
        ),
      ).toMatchObject({
        ok: false,
        reason:
          "No 1-1 notes effect points at this write, so nothing was written.",
      });
      const settled = (await queueRows(SENDS[0].rid)).find(
        r => r.payload.effectKey === "todo_comment",
      )!;
      expect(
        await one(
          "SELECT public.cockpit_form_effect_gate('clickup_queue', $1) AS v",
          [settled.id],
        ),
      ).toMatchObject({
        ok: false,
        reason:
          "This write was settled in the cockpit, so nothing was written.",
      });
      // No effect was left between states, and every state move left its audit row.
      const open = await one<number>(
        "SELECT count(*)::int AS v FROM public.cockpit_form_effects e JOIN public.cockpit_form_responses r ON r.id = e.response_id WHERE r.mode = 'live' AND e.state IN ('planned','queued','unknown')",
      );
      expect(open).toBe(0);
      expect(
        await one<number>(
          "SELECT count(*)::int AS v FROM public.cockpit_audit_log WHERE action = 'forms.settle_refused'",
        ),
      ).toBe(0);
    });
  },
);

// --- No failing-marked case in the 2b set -------------------------------------------------------

/** Section 7's File | Owner table: every listed path. */
function section7(): string[] {
  const text = readFileSync(`${ROOT}docs/forms/STAGE2B-CONTRACT.md`, "utf8");
  const sec =
    text.split(/^## 7\. File ownership$/m)[1]?.split(/^## 8\./m)[0] ?? "";
  const lines = sec.split("\n");
  const head = lines.findIndex(l => l.startsWith("| File | Owner |"));
  const end = lines.findIndex((l, i) => i > head && !l.startsWith("|"));
  const rows = lines.slice(head + 2, end < 0 ? undefined : end);
  return rows.flatMap(r =>
    [
      ...r
        .split(" | ")
        .slice(0, -1)
        .join(" | ")
        .matchAll(/`([^`]+)`/g),
    ]
      .map(m => m[1])
      .filter(t =>
        /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:ts|tsx|sql|py|md|sh|json|css)$/.test(
          t,
        ),
      ),
  );
}

describe("the 2b set", () => {
  test("no file holds a failing-marked case (bun counts a failing one as a pass)", () => {
    const needle = "test." + "failing";
    const skip = new Set([
      "apps/media-buyer-cockpit/scripts/stage2b-fit-supabase.test.ts",
      "apps/media-buyer-cockpit/scripts/stage2b-ownership.test.ts",
      "docs/forms/STAGE2B-CONTRACT.md",
    ]);
    const files = section7().filter(f => !skip.has(f));
    expect(files.length).toBeGreaterThan(100);
    const marked = files.filter(
      f =>
        existsSync(`${ROOT}${f}`) &&
        readFileSync(`${ROOT}${f}`, "utf8").includes(needle),
    );
    expect(marked).toEqual([]);
  });

  // Section 8's ship paragraph names the suites; ClickUp Business reached ship.sh
  // and the readiness list in the rebase, so these read the three files together.
  const contract = readFileSync(
    `${ROOT}docs/forms/STAGE2B-CONTRACT.md`,
    "utf8",
  );
  const SUITES_2B = [
    ...contract
      .split("**The ship block**")[1]
      .split("**The gate report**")[0]
      .matchAll(/`([^`\s]+\/[^`\s]*test[^`\s]*\.(?:tsx?|py))`/g),
  ].map(m => m[1]);
  const CLICKUP = [
    "apps/media-buyer-cockpit/scripts/request-held-gate-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/clickup-cron-spread-supabase.test.ts",
    "supabase/functions/_shared/clickupRetry.test.ts",
    "supabase/functions/cockpit-media-api/tools.test.ts",
    "supabase/functions/cockpit-csm-api/tools.test.ts",
    "supabase/functions/cockpit-ceo-api/tools.test.ts",
    "apps/creative-director-cockpit/scripts/key-links.test.ts",
  ];
  const ship = readFileSync(`${ROOT}scripts/ship.sh`, "utf8");
  /** Every path ship.sh hands to bun test, from the repo root. */
  const shipRuns = [
    ...ship.matchAll(
      /^\s*\((?:PATH=\S+ )?(?:cd (\S+) && )?bun test ([^>\n]+?) >\/dev\/null/gm,
    ),
  ].flatMap(m => m[2].split(/\s+/).map(t => (m[1] ? `${m[1]}/${t}` : t)));
  const covered = (suite: string) =>
    shipRuns.some(r => r === suite || suite.startsWith(`${r}/`));

  test("the readiness list holds every 2b suite and every ClickUp entry, each once", () => {
    const listed = [
      ...readFileSync(`${ROOT}scripts/verify-cutover-readiness.py`, "utf8")
        .split("RELEVANT_TEST_FILES = [")[1]
        .split("\n]")[0]
        .replace(/#.*/g, "")
        .matchAll(/"([^"]+)"/g),
    ].map(m => m[1]);
    expect(SUITES_2B.length).toBe(23);
    expect([...SUITES_2B, ...CLICKUP].filter(f => !listed.includes(f))).toEqual(
      [],
    );
    expect(listed.filter((f, i) => listed.indexOf(f) !== i)).toEqual([]);
    expect(listed.filter(f => !existsSync(`${ROOT}${f}`))).toEqual([]);
  });

  test("ship.sh runs every 2b suite and every ClickUp entry, and the suites both claim only once", () => {
    // The ownership test and the Python tests stay out of the ship script (section 8).
    const out = (f: string) =>
      f.endsWith(".py") || f.endsWith("stage2b-ownership.test.ts");
    expect(
      [...SUITES_2B.filter(f => !out(f)), ...CLICKUP].filter(f => !covered(f)),
    ).toEqual([]);
    for (const suite of [
      "apps/media-buyer-cockpit/scripts/requests-supabase.test.ts",
      "supabase/functions/clickup-writeback",
    ])
      expect(
        shipRuns.filter(r => r === suite),
        suite,
      ).toEqual([suite]);
  });

  test("ship.sh's pinned forms-door import list is what fn_extras prints", () => {
    const pinned = /\[ "\$extras" = "([^"]+)" \]/.exec(ship)?.[1];
    const out = spawnSync(
      "python3",
      ["scripts/dev/fn_extras.py", ".", "forms-door"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(out.status).toBe(0);
    expect(pinned).toBe(out.stdout.trim());
  });

  // Section 9's read-back list is drawn from section 2's tables (Z89).
  test("section 2 names every function the 2b migrations create", () => {
    const tables = contract
      .split(/^## 2\. The migrations$/m)[1]
      .split(/^## 3\. /m)[0];
    const dir = `${ROOT}supabase/migrations/`;
    const made = readdirSync(dir)
      .filter(f => /^20261029[s-z]_forms_.*\.sql$/.test(f))
      .flatMap(f => [
        ...readFileSync(`${dir}${f}`, "utf8").matchAll(
          /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)/g,
        ),
      ])
      .map(m => m[1]);
    expect(made.length).toBeGreaterThan(30);
    expect(
      [...new Set(made)].filter(n => !new RegExp(`\\b${n}\\b`).test(tables)),
    ).toEqual([]);
  });

  test("D8 and D9 read the ACLs of the four internal helpers", () => {
    const row = (d: string) =>
      contract.split("\n").find(l => l.startsWith(`| ${d} |`)) ?? "";
    const reads = (name: string) =>
      new RegExp(`\`${name}\`[^;]*\`\\{postgres=X/postgres\\}\``);
    expect(row("D8")).toMatch(reads("cockpit_form_effects_health"));
    expect(row("D9")).toMatch(reads("cockpit_form_record_effect"));
    expect(row("D9")).toContain("`cockpit_form_record_kickoff`");
    expect(row("D9")).toMatch(reads("cockpit_forms_switch_on"));
  });

  test("2.10 states the settings audit's actor as the migration writes it (Z88)", () => {
    const clause =
      "coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), nullif(btrim(v_by), ''), session_user::text)";
    expect(
      readFileSync(
        `${ROOT}supabase/migrations/20261029z_forms_move_recording.sql`,
        "utf8",
      ),
    ).toContain(clause);
    expect(contract).toContain(clause);
    expect(contract).not.toContain("NEW.updated_by, current_user");
  });
});
