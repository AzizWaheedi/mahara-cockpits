/**
 * The forms core (20261027f_forms_core.sql, docs/forms/STAGE2-CONTRACT.md
 * 2.1 and 11) on an isolated PostgreSQL with Supabase's default privileges
 * on, so a missing REVOKE opens the object here as it would in production.
 *
 * v names w's columns and x's planner, so this file applies v, then the
 * Fathom intake w (20261027g) with a stub cockpit_form_checkin_plan standing
 * in for x (20261027h, the parity builder's), then both again. w goes in
 * before the vault stand-in exists, which proves the vault is touched only
 * inside function bodies. PL/pgSQL resolves a declared row type when the
 * function is created, so v needs the call store tables (20261011c) and w
 * the sync state too; everything else either file reads is resolved at run
 * time, and the planner x is called only from plpgsql.
 *
 * It stands on the real gates: the CEO gate (20260923m), the client gate
 * (20261006c with the roster of 20260927v and the seat rule of 20260927a),
 * cockpit_hours_require_service (20261009a), cockpit_blueprint_first_name
 * (20261024a) and cockpit_slack_notice_role_of (20261025n). The tables are
 * cut from their canonical migrations: the call store and the live bodies
 * w replaces (20261011c, 20261011d, 20261011f), the sync state (20260921e),
 * the people list (20260919b), the media client links (20260927w) and the
 * call briefs (20261005f). The sales index is a stand-in with the live
 * column names, and so is the vault (plain text, inside this test only).
 * Every person, client, recording and room is invented; Zoom ids are
 * 12345678901-style with passcode TEST, Meet codes come from the allow-list.
 *
 * The setup is the same in fathom-intake-supabase.test.ts; keep the two in step.
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

const V = "20261027f_forms_core.sql";
const W = "20261027g_fathom_intake.sql";

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1"; // admin seat
const CSM = "00000000-0000-4000-8000-0000000000a1"; // the CSM, every client
const CSM_B = "00000000-0000-4000-8000-0000000000b1"; // a csm seat, Beta only
const BUYER = "00000000-0000-4000-8000-0000000000f1"; // media buyer, no client success access
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, switched off

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build
const C = "taskC1"; // Cedar Homes

let db: PGlite;
type Row = Record<string, any>;
type Refusal = { code: string; message: string; constraint?: string };

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
/** PostgREST with the service key: role service_role in the claims. */
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
async function refusalOf(fn: () => Promise<unknown>, what: string) {
  try {
    await guarded(fn);
  } catch (e) {
    const x = e as { code?: string; message: string; constraint?: string };
    return {
      code: x.code ?? "",
      message: x.message,
      constraint: x.constraint,
    } as Refusal;
  }
  throw new Error(`Expected a refusal for ${what}`);
}

async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return guarded(async () => (await db.query<T>(text, params)).rows);
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
/** One value as a seat (null = signed out). */
async function one<T = any>(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return guarded(async () => {
    await actor(db, who);
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  });
}
async function refusal(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<Refusal> {
  return refusalOf(async () => {
    await actor(db, who);
    await db.query(text, params);
  }, text);
}
async function refused(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<string> {
  return (await refusal(who, text, params)).message;
}
/** One value as the service key. */
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return guarded(async () => {
    await asService();
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  });
}
async function svcRefusal(
  text: string,
  params: unknown[] = [],
): Promise<Refusal> {
  return refusalOf(async () => {
    await asService();
    await db.query(text, params);
  }, text);
}
async function svcRefused(
  text: string,
  params: unknown[] = [],
): Promise<string> {
  return (await svcRefusal(text, params)).message;
}
async function ownerRefusal(
  text: string,
  params: unknown[] = [],
): Promise<Refusal> {
  return refusalOf(() => db.query(text, params), text);
}
async function ownerRefused(
  text: string,
  params: unknown[] = [],
): Promise<string> {
  return (await ownerRefusal(text, params)).message;
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

/** The functions a migration file creates, by name. */
function functionsOf(file: string): string[] {
  const names = [
    ...migration(file).matchAll(
      /CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/gi,
    ),
  ].map(m => m[1].toLowerCase());
  return [...new Set(names)];
}

// ---------------------------------------------------------------------------
// The database the 1-1 notes stand on (identical in both test files).

const VAULT = `
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text NOT NULL DEFAULT '',
    secret text NOT NULL, key_id uuid, nonce bytea,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE VIEW vault.decrypted_secrets AS
    SELECT s.id, s.name, s.description, s.secret, s.secret AS decrypted_secret, s.key_id, s.nonce, s.created_at, s.updated_at
      FROM vault.secrets s;
  -- The live signatures and defaults (read 2026-10-27).
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

// Stands in for migration x: one element per registry effect, in registry
// order; a call with no recording skips the recording's effects.
const STUB_PLAN = `
  CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_plan(p_response public.cockpit_form_responses)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
  DECLARE v_none boolean := coalesce(p_response.answers->'call'->>'kind', 'none') <> 'fathom';
  BEGIN
    RETURN (SELECT jsonb_agg(jsonb_build_object(
        'effect', e->>'key', 'delivery', e->>'delivery',
        'state', CASE WHEN v_none AND e->>'key' IN ('call_match','grade_notice','recap') THEN 'skipped' ELSE 'planned' END,
        'reason', CASE WHEN v_none AND e->>'key' IN ('call_match','grade_notice','recap') THEN 'Stub: no recording.' END,
        'plan', jsonb_build_object('lines', jsonb_build_array('Stub plan for ' || (e->>'key') || '.'))) ORDER BY o)
      FROM public.cockpit_forms f CROSS JOIN LATERAL jsonb_array_elements(f.effects) WITH ORDINALITY q(e, o)
     WHERE f.key = 'checkin');
  END $$;
  REVOKE ALL ON FUNCTION public.cockpit_form_checkin_plan(public.cockpit_form_responses)
    FROM PUBLIC, anon, authenticated, service_role;`;

async function prerequisites() {
  await db.exec(
    cut(
      migration("20260921e_tap_charges.sql"),
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "cockpit_sync_state",
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;",
  );
  await db.exec(
    cut(
      migration("20260919b_people.sql"),
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "cockpit_people",
    ),
  );

  // The roster and the client gate.
  const roster = migration("20260927v_csm_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "cockpit_csm_source_state",
    ],
    [
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "cockpit_csm_source_state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "cockpit_csm_sources",
    ],
  ] as const)
    await db.exec(cut(roster, pattern, what));
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "cockpit_ask_ai_owner_allowed",
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

  // The media side's client links (aliases) and the call briefs the timeline reads.
  const media = migration("20260927w_media_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_source_state\([\s\S]*?\n\);/,
      "cockpit_media_source_state",
    ],
    [
      /INSERT INTO public\.cockpit_media_source_state[^\n]*\n/,
      "cockpit_media_source_state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_sources\([\s\S]*?\n\);/,
      "cockpit_media_sources",
    ],
  ] as const)
    await db.exec(cut(media, pattern, what));
  await db.exec(
    cut(
      migration("20261005f_cockpit_csm_history.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_call_briefs \([\s\S]*?\n\);/,
      "cockpit_media_call_briefs",
    ),
  );

  // The call store as production has it: 20261011c's tables and grants (the
  // service role keeps Supabase's default DELETE and TRUNCATE, as live), then
  // the live bodies of the queue, the manual match and the timeline.
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
      "cockpit_csm_visible_tasks",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_calls_summary\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_calls_summary\(\) TO authenticated;/,
      "cockpit_csm_calls_summary",
    ],
  ] as const)
    await db.exec(cut(store, pattern, what));
  const privacy = migration("20261011d_csm_match_privacy.sql");
  for (const [pattern, what] of [
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_unmatched_list\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_unmatched_list\(\) TO authenticated;/,
      "cockpit_csm_unmatched_list",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_manual_match\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_manual_match\(bigint,text\) TO authenticated;/,
      "cockpit_csm_manual_match",
    ],
  ] as const)
    await db.exec(cut(privacy, pattern, what));
  await db.exec(migration("20261011f_csm_eod_mentions.sql"));

  // The sales index, cut down with the live column names; the replaced
  // exclusion is LANGUAGE sql, so these exist before it is created.
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
      "cockpit_sales_call_exclusion",
    ),
  );

  // The helpers the forms call, each postgres-only as live.
  for (const [file, pattern, what, sig] of [
    [
      "20261009a_cockpit_team_hours.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_hours_require_service\(\)[\s\S]*?\$\$;/,
      "cockpit_hours_require_service",
      "cockpit_hours_require_service()",
    ],
    [
      "20261024a_brand_blueprints.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_blueprint_first_name\(p_email text\)[\s\S]*?END \$\$;/,
      "cockpit_blueprint_first_name",
      "cockpit_blueprint_first_name(text)",
    ],
    [
      "20261025n_slack_notices.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_role_of\(p_email text\)[\s\S]*?END \$\$;/,
      "cockpit_slack_notice_role_of",
      "cockpit_slack_notice_role_of(text)",
    ],
  ] as const) {
    await db.exec(cut(migration(file), pattern, what));
    await db.exec(
      `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`,
    );
  }

  await db.exec(`
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_csm_source_state,
      public.cockpit_csm_sources, public.cockpit_media_source_state, public.cockpit_media_sources,
      public.cockpit_media_call_briefs, public.cockpit_sales_recordings, public.cockpit_sales_call_notes
      FROM anon, authenticated;`);
}

async function seats() {
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Beta Build"], CSM_B],
  );
  for (const [name, email, role] of [
    ["Noura Test", "csm@tests.invalid", "Client success manager"],
    ["Sara Test", "csm-b@tests.invalid", "Client success manager"],
    ["Omar Test", "creative@tests.invalid", "Creative strategist"],
    ["Aziz Test", "aziz@maharamedia.com", "CEO"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );

  // The roster the client gate reads.
  const snap = "2026-10-27T08:00:00Z";
  const clients = [
    [A, "Acme Interiors", "Active", "Happy"],
    [B, "Beta Build", "Onboarding", null],
    [C, "Cedar Homes", "Active", "At Risk"],
  ] as const;
  for (const [taskId, name, stage, happiness] of clients)
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name, stage, happiness }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [clients.length, snap],
  );
  await db.query(
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
 * The store as w finds it: rows written by the old worker release, with no
 * class, room or team yet. 101 is the CSM's impromptu client-side call (a
 * candidate); 102 a Sales-team external meeting in the sales index, with its
 * content and a call row on no client (stripped, the transcript path kept);
 * 103 a Sales-team external call the sales desk marked client service, on
 * Acme (kept); 104 a Customer Success recording in the index (a candidate,
 * never sales); 105 a team meeting holding a summary (stripped); 106 a
 * calendared Acme call in the room of Acme's booking.
 */
async function store() {
  const raw = (o: Row) => JSON.stringify(o);
  const csm = {
    name: "Noura Test",
    email: "csm@tests.invalid",
    team: "Customer Success",
  };
  const sales = {
    name: "Sam Closer",
    email: "closer@tests.invalid",
    team: "Sales",
  };
  const meetings: Row[] = [
    {
      id: "900000101",
      title: "Impromptu Google Meet Meeting",
      start: ago(240),
      end: ago(210),
      by: csm,
      summary: "Invented summary of an impromptu call.",
      raw: {
        recorded_by: csm,
        calendar_invitees: [{ email: "csm@tests.invalid", is_external: false }],
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
        meeting_url: "https://meet.google.com/abc-defg-hij",
        default_summary: {
          markdown_formatted: "Invented summary of an impromptu call.",
        },
        created_at: ago(209),
      },
    },
    {
      id: "900000102",
      title: "Demo with a prospect",
      start: ago(300),
      end: ago(260),
      by: sales,
      summary: "Invented sales summary.",
      transcript: "fathom/900000102.txt",
      raw: {
        recorded_by: sales,
        calendar_invitees: [
          { email: "lead@prospect.invalid", is_external: true },
        ],
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
        default_summary: { markdown_formatted: "Invented sales summary." },
        action_items: [{ description: "Invented action" }],
        highlights: [{ text: "Invented highlight" }],
        created_at: ago(259),
      },
    },
    {
      id: "900000103",
      title: "Acme Interiors check-in",
      start: ago(500),
      end: ago(470),
      by: sales,
      summary: "Invented client summary.",
      raw: {
        recorded_by: sales,
        calendar_invitees: [{ email: "owner@acme.invalid", is_external: true }],
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
        default_summary: { markdown_formatted: "Invented client summary." },
        created_at: ago(469),
      },
    },
    {
      id: "900000104",
      title: "Impromptu Zoom Meeting",
      start: ago(700),
      end: ago(680),
      by: csm,
      summary: null,
      raw: {
        recorded_by: csm,
        calendar_invitees: [],
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
        meeting_url: "https://us05web.zoom.us/j/98765432101?pwd=TEST",
        created_at: ago(679),
      },
    },
    {
      id: "900000105",
      title: "Team daily",
      start: ago(800),
      end: ago(780),
      by: csm,
      summary: "Invented team summary.",
      raw: {
        recorded_by: csm,
        calendar_invitees: [{ email: "csm@tests.invalid", is_external: false }],
        calendar_invitees_domains_type: "only_internal",
        shared_with: "all_teams",
        default_summary: { markdown_formatted: "Invented team summary." },
        created_at: ago(779),
      },
    },
    {
      id: "900000106",
      title: "Acme Interiors monthly",
      start: ago(900),
      end: ago(860),
      by: csm,
      summary: "Invented Acme summary.",
      raw: {
        recorded_by: csm,
        calendar_invitees: [{ email: "owner@acme.invalid", is_external: true }],
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
        meeting_url: "https://us06web.zoom.us/j/12345678901?pwd=TEST",
        default_summary: { markdown_formatted: "Invented Acme summary." },
        created_at: ago(859),
      },
    },
  ];
  for (const m of meetings)
    await db.query(
      `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
         external,invitees,url,share_url,summary,transcript_path,raw)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb)`,
      [
        m.id,
        m.title,
        m.start,
        m.end,
        m.by.email,
        m.by.name,
        m.raw.calendar_invitees.some((i: Row) => i.is_external),
        JSON.stringify(m.raw.calendar_invitees),
        `https://fathom.video/calls/${Number(m.id) + 1000}`,
        `https://fathom.video/share/test-${m.id}`,
        m.summary,
        m.transcript ?? null,
        raw(m.raw),
      ],
    );
  await db.query(
    "INSERT INTO public.cockpit_sales_recordings(recording_id,title,hidden_reason) VALUES('900000102','Demo with a prospect',NULL),('900000103','Acme Interiors check-in','client service'),('900000104','Impromptu Zoom Meeting',NULL)",
  );
  // Acme's booking in the room of 106, and the old release's call rows.
  await db.query(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,starts_at,ends_at,status,join_url)
     VALUES('ghl_appointment','appt-acme-1',$1,'Acme Interiors','client_id_field',1,'checkin','Check-in',$2,$3,'confirmed',
            'https://us05web.zoom.us/j/12345678901?pwd=TEST')`,
    [A, ago(905), ago(875)],
  );
  await db.query(
    `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,starts_at,ends_at,status,summary,transcript_path,transcript_text,host_email)
     VALUES('fathom','900000102',NULL,NULL,NULL,NULL,'other','Demo with a prospect',$1,$2,'held','Invented sales summary.','fathom/900000102.txt','[00:00:01] Speaker: invented line','closer@tests.invalid'),
           ('fathom','900000103',$3,'Acme Interiors','invitee_email',1,'checkin','Acme Interiors check-in',$4,$5,'held','Invented client summary.',NULL,NULL,'closer@tests.invalid')`,
    [ago(300), ago(260), A, ago(500), ago(470)],
  );
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The order audit rows were written in, for auditSince: two quick
  // statements can share created_at on PGlite, and the ids are random.
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await prerequisites();
  await seats();
  await store();
  await db.exec(migration(V));
  // w before any vault exists; then the vault, the stub planner, and both again.
  await db.exec(migration(W));
  await db.exec(VAULT);
  await db.exec(STUB_PLAN);
  await db.exec(migration(V));
  await db.exec(migration(W));
}, 120_000);
afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------

const FORMS_TABLES = [
  "cockpit_forms",
  "cockpit_form_versions",
  "cockpit_form_responses",
  "cockpit_form_effects",
  "cockpit_form_drafts",
  "cockpit_client_messages",
];

describe("the migration", () => {
  test("is one transaction that reloads the schema, and a further apply of both files changes nothing", async () => {
    for (const file of [V, W]) {
      const sql = migration(file);
      expect(sql.startsWith("-- ")).toBe(true);
      expect(sql).toContain("\nBEGIN;\n");
      expect(
        sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
      ).toBe(true);
    }
    const snapshot = async () => ({
      audit: await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      forms: await count("SELECT count(*) n FROM public.cockpit_forms"),
      versions: await count(
        "SELECT count(*) n FROM public.cockpit_form_versions",
      ),
      responses: await count(
        "SELECT count(*) n FROM public.cockpit_form_responses",
      ),
      effects: await count(
        "SELECT count(*) n FROM public.cockpit_form_effects",
      ),
      drafts: await count("SELECT count(*) n FROM public.cockpit_form_drafts"),
      messages: await count(
        "SELECT count(*) n FROM public.cockpit_client_messages",
      ),
      unclassed: await count(
        "SELECT count(*) n FROM public.cockpit_fathom_meetings WHERE class IS NULL",
      ),
      strips: await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='fathom.privacy_strip'",
      ),
      registry: JSON.stringify(
        await q("SELECT * FROM public.cockpit_forms ORDER BY key"),
      ),
    });
    const before = await snapshot();
    expect(before).toMatchObject({
      forms: 3,
      versions: 3,
      responses: 0,
      effects: 0,
      drafts: 0,
      messages: 0,
      unclassed: 0,
      strips: 1,
    });
    await asOwner();
    await db.exec(migration(V));
    await db.exec(migration(W));
    expect(await snapshot()).toEqual(before);
  });

  test("the six tables: browser roles cannot touch them, the service role only reads them, row security on, no policy", async () => {
    const has = async (role: string, table: string, privilege: string) =>
      (
        await q<{ ok: boolean }>("SELECT has_table_privilege($1,$2,$3) ok", [
          role,
          `public.${table}`,
          privilege,
        ])
      )[0].ok;
    for (const table of FORMS_TABLES) {
      for (const role of ["anon", "authenticated"])
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
        ])
          expect([
            table,
            role,
            privilege,
            await has(role, table, privilege),
          ]).toEqual([table, role, privilege, false]);
      expect(await has("service_role", table, "SELECT")).toBe(true);
      for (const privilege of [
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ])
        expect([
          table,
          privilege,
          await has("service_role", table, privilege),
        ]).toEqual([table, privilege, false]);
      expect(
        (
          await q<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [`public.${table}`],
          )
        )[0].rls,
      ).toBe(true);
    }
    expect(
      await count(
        "SELECT count(*) n FROM pg_policy WHERE polrelid = ANY($1::regclass[])",
        [FORMS_TABLES.map(t => `public.${t}`)],
      ),
    ).toBe(0);
    expect(
      await refused(CSM, "SELECT * FROM public.cockpit_form_responses"),
    ).toContain("permission denied");
    expect(
      await svcRefused(
        "UPDATE public.cockpit_forms SET title='x' WHERE key='checkin'",
      ),
    ).toContain("permission denied");
    expect(await svc("SELECT count(*)::int r FROM public.cockpit_forms")).toBe(
      3,
    );
  });

  test("each function has exactly its grant, and every one is a definer with an empty search path", async () => {
    const browser = [
      "cockpit_form_entry(text)",
      "cockpit_form_open(text,text,uuid,boolean)",
      "cockpit_form_save(uuid,jsonb,text,integer)",
      "cockpit_form_submit(uuid,integer)",
      "cockpit_form_discard(uuid)",
      "cockpit_form_responses_read(uuid)",
      "cockpit_form_drafts_read(uuid)",
    ];
    const service = [
      "cockpit_forms_actor(uuid)",
      "cockpit_form_recordings_tied(text,text[],uuid,uuid)",
      "cockpit_form_draft_begin(jsonb)",
      "cockpit_form_draft_finish(uuid,jsonb)",
    ];
    // The contract's internal functions, by signature (section 2.1).
    const internal = [
      "cockpit_forms_effects_valid(jsonb)",
      "cockpit_forms_audit()",
      "cockpit_forms_refuse_delete()",
      "cockpit_form_responses_guard()",
      "cockpit_form_effects_guard()",
      "cockpit_form_drafts_guard()",
      "cockpit_client_messages_guard()",
      "cockpit_form_kuwait_day(timestamptz)",
      "cockpit_form_actor()",
      "cockpit_form_access(text,text,boolean)",
      "cockpit_form_checkin_value(text,jsonb,text)",
      "cockpit_form_recording_tied(text,text,uuid)",
      "cockpit_form_checkin_missing(jsonb)",
      "cockpit_form_plan_effects(public.cockpit_form_responses)",
      "cockpit_form_apply_sql_effects(uuid)",
      "cockpit_csm_attach_recording(text,text,text,jsonb)",
      "cockpit_form_effect_view(public.cockpit_form_effects)",
      "cockpit_form_response_view(public.cockpit_form_responses)",
      "cockpit_form_draft_view(public.cockpit_form_drafts)",
    ];
    const can = async (role: string, sig: string) =>
      (
        await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
          [role, `public.${sig}`],
        )
      )[0].ok;
    for (const fn of browser)
      expect([
        fn,
        await can("anon", fn),
        await can("authenticated", fn),
        await can("service_role", fn),
      ]).toEqual([fn, false, true, false]);
    for (const fn of service)
      expect([
        fn,
        await can("anon", fn),
        await can("authenticated", fn),
        await can("service_role", fn),
      ]).toEqual([fn, false, false, true]);
    for (const fn of internal)
      expect([
        fn,
        await can("anon", fn),
        await can("authenticated", fn),
        await can("service_role", fn),
      ]).toEqual([fn, false, false, false]);

    // Every function the file creates, its helpers included: one definition
    // each, a definer with an empty search path, and a grant only if listed.
    const nameOf = (sig: string) => sig.slice(0, sig.indexOf("("));
    const browserNames = new Set(browser.map(nameOf));
    const serviceNames = new Set(service.map(nameOf));
    const names = functionsOf(V);
    expect(names.length).toBeGreaterThanOrEqual(
      browser.length + service.length + internal.length,
    );
    for (const name of [...browser, ...service, ...internal].map(nameOf))
      expect(names).toContain(name);
    const fns = await q<{
      name: string;
      definer: boolean;
      config: string[] | null;
      anon: boolean;
      auth: boolean;
      svc: boolean;
      pub: boolean;
    }>(
      `SELECT p.proname AS name, p.prosecdef definer, p.proconfig config,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              (p.proacl IS NULL OR p.proacl::text ~ '(^|[{,])=X/') pub
         FROM pg_proc p
        WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1::text[])`,
      [names],
    );
    expect(fns.map(f => f.name).sort()).toEqual([...names].sort());
    for (const fn of fns)
      expect([
        fn.name,
        fn.definer,
        fn.config,
        fn.anon,
        fn.auth,
        fn.svc,
        fn.pub,
      ]).toEqual([
        fn.name,
        true,
        ['search_path=""'],
        false,
        browserNames.has(fn.name),
        serviceNames.has(fn.name),
        false,
      ]);
    expect(
      await refused(null, "SELECT public.cockpit_form_entry('checkin')"),
    ).toContain("permission denied");
    expect(
      await refused(CEO, "SELECT public.cockpit_form_draft_begin('{}'::jsonb)"),
    ).toContain("permission denied");
    expect(
      await svcRefused("SELECT public.cockpit_form_entry('checkin')"),
    ).toContain("permission denied");
    // The grant lets a signed-in client-success seat in; the gate inside decides.
    expect(
      await one(CSM, "SELECT public.cockpit_form_entry('checkin')->>'mode' r"),
    ).toBe("shadow");
    expect(
      await refused(BUYER, "SELECT public.cockpit_form_entry('checkin')"),
    ).toBe("Current confirmed client-success access is required");
  });
});

describe("the registry seeds", () => {
  const CHECKIN_EFFECTS = [
    ["call_form", "shadow", "sql", "Notes where the client brief reads them"],
    ["call_match", "shadow", "sql", "The recording on this client"],
    ["todo_comment", "shadow", "clickup_queue", "To-do comment on the card"],
    ["happiness", "shadow", "clickup_queue", "Client Happiness"],
    ["last_poc", "shadow", "clickup_queue", "Last POC"],
    ["last_checkin_call", "shadow", "clickup_queue", "Last Check-in Call"],
    [
      "grade_notice",
      "shadow",
      "slack_notice",
      "Call grade in #client-call-feedback",
    ],
    ["recap", "shadow", "client_message", "Recap for the client's group"],
  ];
  const effectsOf = (row: Row) =>
    (row.effects as Row[]).map(e => [e.key, e.owner, e.delivery, e.label]);

  test("three forms: checkin is the Typeform 1-1 form with eight shadow effects; kickoff and Blueprint as written", async () => {
    const rows = await q("SELECT * FROM public.cockpit_forms ORDER BY key");
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
    expect(Object.keys(byKey)).toEqual(["blueprint", "checkin", "kickoff"]);
    expect(byKey.checkin).toMatchObject({
      title: "1-1 call notes",
      audience: "team",
      provider: "typeform",
      typeform_id: "fRokTITH",
      version: 1,
      seats: ["csm"],
      client_scoped: true,
      updated_by: "migration",
    });
    expect(effectsOf(byKey.checkin)).toEqual(CHECKIN_EFFECTS);
    expect(byKey.kickoff).toMatchObject({
      title: "Kickoff",
      audience: "team",
      provider: "typeform",
      typeform_id: "tG7dnxBn",
      version: 1,
      seats: ["csm"],
      client_scoped: true,
      schema: { key: "kickoff", version: 1, fields: [], lives: "typeform" },
    });
    expect(effectsOf(byKey.kickoff)).toEqual([
      ["handoff_comment", "make", "clickup_queue", "Handoff comment"],
      ["onboarding_tasks", "make", "clickup_queue", "Onboarding tasks"],
      ["card_fields", "make", "clickup_queue", "Card fields"],
      ["map_phase4", "make", "clickup_queue", "Map phase 4"],
      ["phase4_whatsapp", "make", "client_message", "Phase 4 WhatsApp"],
      ["kickoff_notice", "cockpit", "slack_notice", "Kickoff notice"],
      ["recap", "shadow", "client_message", "Recap"],
    ]);
    expect(byKey.blueprint).toMatchObject({
      title: "Brand Blueprint",
      provider: "native",
      typeform_id: null,
      seats: ["creative", "csm"],
      client_scoped: true,
      schema: {
        key: "blueprint",
        version: 1,
        fields: [],
        lives: "apps/client-success-cockpit/src/present/blueprintForm.ts",
      },
    });
    expect(effectsOf(byKey.blueprint)).toEqual([
      ["launch_task", "cockpit", "creative_outbox", "Launch task"],
      ["close_card", "cockpit", "creative_outbox", "Close card"],
      ["offer_card", "cockpit", "creative_outbox", "Offer card"],
      ["close_notice", "cockpit", "slack_notice", "Close notice"],
      ["media_notice", "cockpit", "slack_notice", "Media notice"],
      ["phase5_whatsapp", "shadow", "client_message", "Phase 5 WhatsApp"],
      ["recap", "shadow", "client_message", "Recap"],
    ]);
    // Version 1 of each copies the stored schema.
    const versions = await q(
      `SELECT v.form_key, v.version, v.published_by, v.schema = f.schema AS same
         FROM public.cockpit_form_versions v JOIN public.cockpit_forms f ON f.key = v.form_key ORDER BY v.form_key`,
    );
    expect(versions).toEqual([
      {
        form_key: "blueprint",
        version: 1,
        published_by: "migration",
        same: true,
      },
      {
        form_key: "checkin",
        version: 1,
        published_by: "migration",
        same: true,
      },
      {
        form_key: "kickoff",
        version: 1,
        published_by: "migration",
        same: true,
      },
    ]);
  });

  test("each seed was written once, with its audit row named for the migration", async () => {
    const audits = (
      await q(
        `SELECT entity_type, entity_id, action, actor_email, source_system, after
           FROM public.cockpit_audit_log WHERE entity_type IN ('cockpit_forms','cockpit_form_versions')`,
      )
    ).sort((x, y) =>
      `${x.entity_type} ${x.entity_id}` < `${y.entity_type} ${y.entity_id}`
        ? -1
        : 1,
    );
    expect(audits.map(a => [a.entity_type, a.entity_id, a.action])).toEqual([
      [
        "cockpit_form_versions",
        "blueprint:1",
        "forms.cockpit_form_versions.insert",
      ],
      [
        "cockpit_form_versions",
        "checkin:1",
        "forms.cockpit_form_versions.insert",
      ],
      [
        "cockpit_form_versions",
        "kickoff:1",
        "forms.cockpit_form_versions.insert",
      ],
      ["cockpit_forms", "blueprint", "forms.cockpit_forms.insert"],
      ["cockpit_forms", "checkin", "forms.cockpit_forms.insert"],
      ["cockpit_forms", "kickoff", "forms.cockpit_forms.insert"],
    ]);
    for (const a of audits)
      expect([a.actor_email, a.source_system]).toEqual([
        "migration",
        "migration",
      ]);
    expect(audits.find(a => a.entity_id === "checkin")?.after).toMatchObject({
      key: "checkin",
      version: 1,
      provider: "typeform",
    });
  });

  test("the checkin schema v1 sits between its markers as one literal, and the registry stores exactly it", async () => {
    const sql = migration(V);
    expect(sql.split("$checkin_v1$").length - 1).toBe(2);
    const lines = sql.split("\n");
    const begin = lines.indexOf("-- checkin schema v1 begin");
    const end = lines.indexOf("-- checkin schema v1 end");
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const between = lines
      .slice(begin + 1, end)
      .join("\n")
      .trim();
    expect(between.startsWith("$checkin_v1$")).toBe(true);
    expect(between.endsWith("$checkin_v1$")).toBe(true);
    const schema = JSON.parse(between.slice(12, -12));
    const stored = (
      await q("SELECT schema FROM public.cockpit_forms WHERE key='checkin'")
    )[0].schema;
    expect(stored).toEqual(schema);
    expect(schema.fields.map((f: Row) => f.key)).toEqual([
      "call",
      "defcon",
      "priority",
      "we_owe",
      "they_owe",
      "client_notes",
    ]);
    expect(schema.fields[1].choices).toEqual([
      "Paused",
      "At Risk",
      "Neutral",
      "Happy",
      "Very Happy (testimonial)",
      "Churned",
    ]);
    expect(schema.fields[2].choices).toEqual(["911", "High", "Medium", "Low"]);
  });

  test("the registry CHECKs: checkin may keep fRokTITH once native; a Typeform form names its form; the effect list keeps its shape", async () => {
    await rolledBack(async () => {
      await db.query(
        "UPDATE public.cockpit_forms SET provider='native' WHERE key='checkin'",
      );
      expect(
        (
          await db.query<Row>(
            "SELECT provider, typeform_id FROM public.cockpit_forms WHERE key='checkin'",
          )
        ).rows[0],
      ).toEqual({ provider: "native", typeform_id: "fRokTITH" });
    });
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_forms SET typeform_id=NULL WHERE key='kickoff'",
      ),
    ).toContain("check");
    expect(
      await ownerRefused(
        "INSERT INTO public.cockpit_forms(key,title,audience,provider,schema,client_scoped,updated_by) VALUES('intake','Intake','client','typeform','{}'::jsonb,false,'test')",
      ),
    ).toContain("check");
    const effects = (list: unknown) =>
      ownerRefused(
        "UPDATE public.cockpit_forms SET effects=$1::jsonb WHERE key='blueprint'",
        [JSON.stringify(list)],
      );
    const ok = {
      key: "launch_task",
      owner: "cockpit",
      delivery: "creative_outbox",
      label: "Launch task",
    };
    for (const bad of [
      [{ ...ok, owner: "someone" }],
      [{ ...ok, delivery: "email" }],
      [{ ...ok, label: "" }],
      [{ ...ok, key: "Launch" }],
      [{ ...ok, extra: true }],
      [ok, ok],
      Array.from({ length: 21 }, (_, i) => ({ ...ok, key: `effect_${i}` })),
      { ...ok },
    ])
      expect(await effects(bad)).toContain("check");
    // The six tables refuse a delete and a truncate, whoever asks.
    for (const statement of [
      "DELETE FROM public.cockpit_form_versions WHERE form_key='kickoff'",
      "TRUNCATE public.cockpit_form_effects",
      "TRUNCATE public.cockpit_client_messages",
    ])
      expect(await ownerRefused(statement)).toContain(
        "Forms records are never deleted",
      );
  });
});

// ---------------------------------------------------------------------------
// The 1-1 notes as the window (the browser RPCs) and the forms door (the
// service RPCs) use them. Each test makes its own recordings and drafts;
// anything that switches the registry runs inside rolledBack.

const RID = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = "window-one-0001";
const S2 = "window-two-0002";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** HH:MM in Kuwait (UTC+3, no daylight saving). */
const kuwaitClock = (at: string) =>
  new Date(Date.parse(at) + 3 * 3_600_000).toISOString().slice(11, 16);
const CLIENT_NAMES: Record<string, string> = {
  [A]: "Acme Interiors",
  [B]: "Beta Build",
  [C]: "Cedar Homes",
};
const CHECKIN_KEYS = [
  "call_form",
  "call_match",
  "todo_comment",
  "happiness",
  "last_poc",
  "last_checkin_call",
  "grade_notice",
  "recap",
];
const NO_RECORDING = new Set(["call_match", "grade_notice", "recap"]);
const READY = { defcon: "Happy", priority: "Medium" };
const OPEN = "SELECT public.cockpit_form_open($1,$2,$3::uuid,$4) r";
const SAVE = "SELECT public.cockpit_form_save($1::uuid,$2::jsonb,$3,$4) r";
const SUBMIT = "SELECT public.cockpit_form_submit($1::uuid,$2) r";
const BEGIN_DRAFT = "SELECT public.cockpit_form_draft_begin($1::jsonb) r";

let nextRecording = 900000300;
/** A stored Fathom meeting with its class already set (the trigger keeps it). */
async function recording(
  o: {
    cls?: string;
    by?: string;
    team?: string;
    start?: string;
    end?: string;
    title?: string;
    room?: string | null;
    summary?: string | null;
    gone?: boolean;
  } = {},
): Promise<string> {
  const id = String(nextRecording++);
  const by = o.by ?? "csm@tests.invalid";
  const team = o.team ?? "Customer Success";
  await q(
    `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
       external,invitees,url,share_url,summary,raw,class,room,recorder_team,gone_at)
     VALUES($1,$2,$3,$4,$5,'Invented Recorder',false,'[]'::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
    [
      id,
      o.title ?? "Impromptu Google Meet Meeting",
      o.start ?? ago(120),
      o.end ?? ago(90),
      by,
      `https://fathom.video/calls/${Number(id) + 1000}`,
      `https://fathom.video/share/test-${id}`,
      o.summary === undefined ? "Invented summary." : o.summary,
      JSON.stringify({
        recorded_by: { name: "Invented Recorder", email: by, team },
        calendar_invitees: [],
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
      }),
      o.cls ?? "candidate",
      o.room ?? null,
      team,
      o.gone ? ago(5) : null,
    ],
  );
  return id;
}

let nextBooking = 1;
/** A GoHighLevel booking on a card. */
async function booking(
  task: string,
  o: {
    start: string;
    end?: string | null;
    status?: string;
    kind?: string;
    room?: string | null;
  },
): Promise<number> {
  return (
    await q<{ id: number }>(
      `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
         starts_at,ends_at,status,room)
       VALUES('ghl_appointment',$1,$2,$3,'client_id_field',1,$4,'Check-in',$5,$6,$7,$8) RETURNING id`,
      [
        `appt-core-${nextBooking++}`,
        task,
        CLIENT_NAMES[task],
        o.kind ?? "checkin",
        o.start,
        o.end ?? null,
        o.status ?? "confirmed",
        o.room ?? null,
      ],
    )
  )[0].id;
}

/** A recording's call row, as the worker writes it. */
async function callRow(
  rec: string,
  o: {
    task?: string | null;
    method?: string | null;
    /** match_confidence; 1 on a card unless given (null with no card). */
    confidence?: number | null;
    host?: string;
    linked?: number | null;
    kind?: string;
    candidate?: boolean;
    settled?: string | null;
    start?: string;
  } = {},
): Promise<number> {
  const task = o.task ?? null;
  return (
    await q<{ id: number }>(
      `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
         starts_at,status,host_email,linked_call_id,candidate,settled_reason)
       VALUES('fathom',$1,$2,$3,$4,$5,$6,'Recorded call',$7,'held',$11,$8,$9,$10) RETURNING id`,
      [
        rec,
        task,
        task ? CLIENT_NAMES[task] : null,
        o.method ?? (task ? "manual" : null),
        o.confidence !== undefined ? o.confidence : task ? 1 : null,
        o.kind ?? "other",
        o.start ?? ago(120),
        o.linked ?? null,
        o.candidate ?? false,
        o.settled ?? null,
        o.host ?? "csm@tests.invalid",
      ],
    )
  )[0].id;
}

const fathomCall = (
  rec: string,
  why = "latest_unlinked",
  confirmed = true,
) => ({
  kind: "fathom",
  recordingId: rec,
  why,
  confirmed,
});
function changes(
  values: Row,
  seen: Row = {},
  from: Record<string, string> = {},
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(values).map(([k, value]) => [
        k,
        { value, seen: seen[k] ?? null, ...(from[k] ? { from: from[k] } : {}) },
      ]),
    ),
  );
}
async function open(
  who: string,
  task: string,
  id: string | null,
  rehearse = false,
): Promise<Row> {
  return one(who, OPEN, ["checkin", task, id, rehearse]);
}
async function save(
  who: string,
  id: string,
  values: Row,
  o: {
    session?: string;
    base?: number | null;
    seen?: Row;
    from?: Record<string, string>;
  } = {},
): Promise<Row> {
  return one(who, SAVE, [
    id,
    changes(values, o.seen, o.from),
    o.session ?? S1,
    o.base ?? null,
  ]);
}
async function submit(
  who: string,
  id: string,
  base: number | null = null,
): Promise<Row> {
  return one(who, SUBMIT, [id, base]);
}
/** This seat's draft on the card is discarded, then a new one opens with this ID. */
async function fresh(who: string, task: string, id: string): Promise<Row> {
  for (const r of await q<{ id: string }>(
    "SELECT id FROM public.cockpit_form_responses WHERE form_key='checkin' AND task_id=$1 AND created_by_id=$2 AND state='draft'",
    [task, who],
  ))
    await one(who, "SELECT public.cockpit_form_discard($1::uuid) r", [r.id]);
  return open(who, task, id);
}
/** Open, fill and send, as the window does. */
async function send(
  who: string,
  task: string,
  id: string,
  answers: Row,
): Promise<Row> {
  await fresh(who, task, id);
  const saved = await save(who, id, answers);
  return submit(who, id, saved.row.revision);
}
async function switchTo(provider: "native" | "typeform") {
  await q("UPDATE public.cockpit_forms SET provider=$1 WHERE key='checkin'", [
    provider,
  ]);
}
async function stateOf(id: string): Promise<string> {
  return (
    await q<{ state: string }>(
      "SELECT state FROM public.cockpit_form_responses WHERE id=$1",
      [id],
    )
  )[0].state;
}
async function effectRows(id: string): Promise<number> {
  return count(
    "SELECT count(*) n FROM public.cockpit_form_effects WHERE response_id=$1",
    [id],
  );
}
/** The audit rows written for one entity after a known set of audit ids. */
async function auditIds(entity: string): Promise<string[]> {
  return (
    await q<{ id: string }>(
      "SELECT id FROM public.cockpit_audit_log WHERE entity_id=$1",
      [entity],
    )
  ).map(r => r.id);
}
async function auditSince(entity: string, seen: string[]): Promise<Row[]> {
  return q(
    `SELECT action, actor_email, source_app, source_system, before, after, metadata
       FROM public.cockpit_audit_log WHERE entity_id=$1 AND NOT (id = ANY($2::uuid[])) ORDER BY test_seq`,
    [entity, seen],
  );
}

async function begin(p: Row): Promise<Row> {
  return svc(BEGIN_DRAFT, [
    JSON.stringify({
      formKey: "checkin",
      again: false,
      actorEmail: "csm@tests.invalid",
      ...p,
    }),
  ]);
}
async function beginRefused(p: Row): Promise<Refusal> {
  return svcRefusal(BEGIN_DRAFT, [
    JSON.stringify({
      formKey: "checkin",
      again: false,
      actorEmail: "csm@tests.invalid",
      ...p,
    }),
  ]);
}
async function finish(id: string, p: Row): Promise<Row> {
  return svc("SELECT public.cockpit_form_draft_finish($1::uuid,$2::jsonb) r", [
    id,
    JSON.stringify({ actorEmail: "csm@tests.invalid", ...p }),
  ]);
}
/** A ready draft of one kind for a card and recording; returns its id. */
async function readyDraft(
  task: string,
  rec: string,
  kind: string,
  output: Row,
  o: { provider?: string; version?: string; input?: string } = {},
): Promise<string> {
  const b = await begin({
    taskId: task,
    recordingId: rec,
    kind,
    provider:
      o.provider ??
      (kind === "todos"
        ? "none"
        : kind === "client_notes"
          ? "deepseek"
          : "anthropic"),
    promptVersion: o.version ?? `checkin.${kind}.v1`,
    inputSha256: sha(o.input ?? `${task}:${rec}:${kind}`),
  });
  await finish(b.id, { state: "ready", output });
  return b.id;
}

describe("cockpit_form_entry", () => {
  test("the CSM, an admin and the CEO see the 1-1 form in Typeform with a shadow window; any other seat is refused; nothing is written", async () => {
    const audits = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log",
    );
    for (const who of [CSM, ADMIN, CEO])
      expect(
        await one(who, "SELECT public.cockpit_form_entry('checkin') r"),
      ).toEqual({
        key: "checkin",
        title: "1-1 call notes",
        provider: "typeform",
        typeformId: "fRokTITH",
        version: 1,
        native: true,
        mode: "shadow",
        now: expect.any(String),
      });
    // The kickoff opens only in Typeform in 2a: no window, so no mode.
    expect(
      await one(CSM, "SELECT public.cockpit_form_entry('kickoff') r"),
    ).toMatchObject({
      provider: "typeform",
      typeformId: "tG7dnxBn",
      native: false,
      mode: null,
    });
    expect(
      await refusal(BUYER, "SELECT public.cockpit_form_entry('checkin')"),
    ).toMatchObject({
      code: "42501",
      message: "Current confirmed client-success access is required",
    });
    expect(
      await refusal(GONE, "SELECT public.cockpit_form_entry('checkin')"),
    ).toMatchObject({
      code: "42501",
      message: "Sign in to the cockpit first.",
    });
    expect(
      await refused(CSM, "SELECT public.cockpit_form_entry('intake')"),
    ).toBe("There is no form called intake.");
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log")).toBe(
      audits,
    );
    // One registry value flips every entry point.
    await rolledBack(async () => {
      await switchTo("native");
      expect(
        await one(CSM, "SELECT public.cockpit_form_entry('checkin') r"),
      ).toMatchObject({ provider: "native", native: true, mode: "live" });
    });
  });
});

describe("cockpit_form_open", () => {
  test("a CSM seat opens a shadow draft with the browser's ID, a second open resumes it, and the CEO's draft is its own", async () => {
    const id = RID(101);
    const rows = await count(
      "SELECT count(*) n FROM public.cockpit_form_responses",
    );
    const o = await open(CSM, A, id);
    expect(o.form).toMatchObject({
      key: "checkin",
      title: "1-1 call notes",
      provider: "typeform",
      version: 1,
      mode: "shadow",
    });
    expect(o.form.schema.fields.map((f: Row) => f.key)).toEqual([
      "call",
      "defcon",
      "priority",
      "we_owe",
      "they_owe",
      "client_notes",
    ]);
    expect(o.form.effects.map((e: Row) => e.key)).toEqual(CHECKIN_KEYS);
    expect(o.response).toEqual({
      id,
      formKey: "checkin",
      formVersion: 1,
      mode: "shadow",
      state: "draft",
      revision: 1,
      taskId: A,
      clientName: "Acme Interiors",
      answers: {},
      meta: {},
      createdAt: expect.any(String),
      submittedAt: null,
    });
    // The DEFCON line's "On the card" value comes from the card's row.
    expect(o.client).toEqual({
      taskId: A,
      name: "Acme Interiors",
      stage: "Active",
      happiness: "Happy",
    });
    expect(o.rehearse).toBe(false);
    expect(
      (
        await q(
          "SELECT source, created_by, created_by_id, mode, client_name FROM public.cockpit_form_responses WHERE id=$1",
          [id],
        )
      )[0],
    ).toEqual({
      source: "cockpit",
      created_by: "csm@tests.invalid",
      created_by_id: CSM,
      mode: "shadow",
      client_name: "Acme Interiors",
    });
    expect(await auditSince(id, [])).toEqual([
      {
        action: "forms.opened",
        actor_email: "csm@tests.invalid",
        source_app: "client-success",
        source_system: "supabase",
        before: null,
        after: expect.objectContaining({ id, state: "draft", answers: {} }),
        metadata: {
          op: "insert",
          form_key: "checkin",
          task_id: A,
          changed: [],
        },
      },
    ]);
    // Resumed, whatever ID the window sends.
    expect((await open(CSM, A, RID(102))).response.id).toBe(id);
    expect((await open(CSM, A, null)).response.id).toBe(id);
    expect(
      await count("SELECT count(*) n FROM public.cockpit_form_responses"),
    ).toBe(rows + 1);
    // The CEO's own draft, on a card whose Client Happiness is not set.
    const ceo = await open(CEO, B, RID(103));
    expect(ceo.response).toMatchObject({
      id: RID(103),
      mode: "shadow",
      state: "draft",
      taskId: B,
      clientName: "Beta Build",
    });
    expect(ceo.client).toEqual({
      taskId: B,
      name: "Beta Build",
      stage: "Onboarding",
      happiness: null,
    });
  });

  test("a rehearsal opens the form and writes nothing", async () => {
    const rows = await count(
      "SELECT count(*) n FROM public.cockpit_form_responses",
    );
    const audits = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log",
    );
    const r = await open(CSM, C, RID(104), true);
    expect(r).toMatchObject({
      response: null,
      rehearse: true,
      form: { key: "checkin", mode: "shadow" },
      client: {
        taskId: C,
        name: "Cedar Homes",
        stage: "Active",
        happiness: "At Risk",
      },
    });
    expect(
      await count("SELECT count(*) n FROM public.cockpit_form_responses"),
    ).toBe(rows);
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log")).toBe(
      audits,
    );
  });

  test("another seat's notes are refused; this seat's notes from another card, or no ID and no draft, send it to the client page", async () => {
    expect(
      await refusal(CSM, OPEN, ["checkin", C, RID(103), false]),
    ).toMatchObject({
      code: "42501",
      message: "These notes belong to another seat.",
    });
    expect(
      await refusal(CSM, OPEN, ["checkin", C, RID(101), false]),
    ).toMatchObject({
      code: "22023",
      message: "Open the notes from the client page.",
    });
    expect(await refusal(CSM, OPEN, ["checkin", C, null, false])).toMatchObject(
      { code: "22023", message: "Open the notes from the client page." },
    );
  });

  test("the gate comes first: the client list, the seat, the form", async () => {
    expect(
      await refusal(CSM_B, OPEN, ["checkin", A, RID(105), false]),
    ).toMatchObject({
      code: "42501",
      message: "That client is not on your access list",
    });
    expect(await refused(BUYER, OPEN, ["checkin", A, RID(105), false])).toBe(
      "Current confirmed client-success access is required",
    );
    expect(await refused(CSM, OPEN, ["kickoff", A, RID(105), false])).toBe(
      "This form is filled in Typeform, not in the cockpit.",
    );
    expect(await refused(CSM, OPEN, ["intake", A, RID(105), false])).toBe(
      "There is no form called intake.",
    );
    expect(
      await refused(CSM, OPEN, ["checkin", "not a card", RID(105), false]),
    ).toBe("Choose a valid ClickUp client ID");
    expect(
      await refused(null, OPEN, ["checkin", A, RID(105), false]),
    ).toContain("permission denied");
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_form_responses WHERE id=$1",
        [RID(105)],
      ),
    ).toBe(0);
  });

  test("after the switch, this seat's shadow draft is closed and a live draft opens", async () => {
    await rolledBack(async () => {
      await switchTo("native");
      const live = await open(CSM, A, RID(106));
      expect(live.response).toMatchObject({
        id: RID(106),
        mode: "live",
        state: "draft",
      });
      expect(live.form.mode).toBe("live");
      expect(
        (
          await q(
            "SELECT state, mode FROM public.cockpit_form_responses WHERE id=$1",
            [RID(101)],
          )
        )[0],
      ).toEqual({ state: "void", mode: "shadow" });
      expect(
        await q(
          "SELECT before->>'state' b, after->>'state' a FROM public.cockpit_audit_log WHERE entity_id=$1 AND action='forms.shadow_closed'",
          [RID(101)],
        ),
      ).toEqual([{ b: "draft", a: "void" }]);
      expect((await open(CSM, A, null)).response.id).toBe(RID(106));
    });
  });

  test("this seat's own sent, confirmed or void notes come back to read and write nothing; a new ID then opens new notes; another seat's are refused", async () => {
    await rolledBack(async () => {
      const written = async () => [
        await count("SELECT count(*) n FROM public.cockpit_form_responses"),
        await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      ];
      // Discarded notes whose ID the window still holds.
      const discarded = RID(121);
      await fresh(CSM, C, discarded);
      await one(CSM, "SELECT public.cockpit_form_discard($1::uuid) r", [
        discarded,
      ]);
      const before = await written();
      expect((await open(CSM, C, discarded)).response).toMatchObject({
        id: discarded,
        state: "void",
        mode: "shadow",
      });
      expect(await written()).toEqual(before);
      // The window mints a new ID and opens again: new notes, sent, then confirmed.
      const sent = RID(122);
      expect((await open(CSM, C, sent)).response).toMatchObject({
        id: sent,
        state: "draft",
      });
      const saved = await save(CSM, sent, { call: { kind: "none" }, ...READY });
      await submit(CSM, sent, saved.row.revision);
      expect((await open(CSM, C, sent)).response).toMatchObject({
        id: sent,
        state: "submitted",
      });
      await q(
        "UPDATE public.cockpit_form_responses SET state='confirmed', confirmed_by='csm@tests.invalid', confirmed_at=now() WHERE id=$1",
        [sent],
      );
      const confirmed = await written();
      expect((await open(CSM, C, sent)).response).toMatchObject({
        id: sent,
        state: "confirmed",
      });
      expect(await written()).toEqual(confirmed);
      for (const id of [discarded, sent])
        expect(
          await refusal(CEO, OPEN, ["checkin", C, id, false]),
        ).toMatchObject({
          code: "42501",
          message: "These notes belong to another seat.",
        });
      // At the switch the window still holds its shadow draft's ID: that
      // draft is closed and comes back void, and a new ID opens live notes.
      const shadow = RID(123);
      await open(CSM, C, shadow);
      await switchTo("native");
      expect((await open(CSM, C, shadow)).response).toMatchObject({
        id: shadow,
        state: "void",
        mode: "shadow",
      });
      expect((await open(CSM, C, RID(124))).response).toMatchObject({
        id: RID(124),
        state: "draft",
        mode: "live",
      });
    });
  });
});

describe("cockpit_form_save", () => {
  test("the Blueprint's conflict rule, between two windows of one seat", async () => {
    const id = RID(201);
    await fresh(CSM, C, id);
    const first = await save(CSM, id, { defcon: "Happy" }, { base: 1 });
    expect(first).toEqual({
      row: {
        answers: { defcon: "Happy" },
        meta: { defcon: { at: expect.any(String), by: "Noura", from: null } },
        revision: 2,
      },
      applied: ["defcon"],
      conflicts: [],
    });
    // The other window still had revision 1 and saw nothing: a conflict, and
    // the stored value comes back so the window shows theirs.
    const stale = await save(
      CSM,
      id,
      { defcon: "At Risk" },
      { session: S2, base: 1 },
    );
    expect(stale.applied).toEqual([]);
    expect(stale.conflicts).toEqual([
      { key: "defcon", theirs: "Happy", by: "Noura", at: expect.any(String) },
    ]);
    expect(stale.row).toMatchObject({
      answers: { defcon: "Happy" },
      revision: 2,
    });
    // A window never conflicts with itself.
    expect(
      await save(CSM, id, { defcon: "Neutral" }, { base: 1 }),
    ).toMatchObject({
      applied: ["defcon"],
      conflicts: [],
      row: { answers: { defcon: "Neutral" }, revision: 3 },
    });
    // What the other window saw is what is stored: it applies.
    expect(
      await save(
        CSM,
        id,
        { defcon: "At Risk" },
        { session: S2, base: 1, seen: { defcon: "Neutral" } },
      ),
    ).toMatchObject({
      applied: ["defcon"],
      conflicts: [],
      row: { answers: { defcon: "At Risk" }, revision: 4 },
    });
    // The row's own revision applies everything.
    expect(
      await save(
        CSM,
        id,
        { defcon: "Happy" },
        { base: 4, seen: { defcon: "nonsense" } },
      ),
    ).toMatchObject({
      applied: ["defcon"],
      conflicts: [],
      row: { revision: 5 },
    });
    // A key nobody else saved applies from a stale revision, and the stored
    // value sent again is applied without a change.
    expect(
      await save(
        CSM,
        id,
        { priority: "High", defcon: "Happy" },
        { session: S2, base: 1 },
      ),
    ).toMatchObject({
      applied: ["defcon", "priority"],
      conflicts: [],
      row: { answers: { defcon: "Happy", priority: "High" }, revision: 6 },
    });
    // A null clears the answer and its meta.
    const cleared = await save(CSM, id, { priority: null }, { base: 6 });
    expect(cleared.row.answers).toEqual({ defcon: "Happy" });
    expect(Object.keys(cleared.row.meta)).toEqual(["defcon"]);
    expect(cleared.row.revision).toBe(7);
  });

  test("at most 40 answers, only the form's questions, each change as written, only this seat's draft", async () => {
    const id = RID(201);
    const revision = async () =>
      (
        await q<{ revision: number }>(
          "SELECT revision FROM public.cockpit_form_responses WHERE id=$1",
          [id],
        )
      )[0].revision;
    const before = await revision();
    const keys = (n: number) =>
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: n }, (_, i) => [`q${i}`, { value: "x" }]),
        ),
      );
    for (const [body, session, base, sentence] of [
      [keys(41), S1, null, "Save at most 40 answers at a time"],
      // Forty pass the count; the keys must still be the form's questions.
      [keys(40), S1, null, "That is not a question of this form."],
      [
        '{"mood":{"value":"calm"}}',
        S1,
        null,
        "That is not a question of this form.",
      ],
      [
        '{"defcon":"Happy"}',
        S1,
        null,
        "Each change carries its value, what this window saw, and where a suggestion came from",
      ],
      [
        '{"defcon":{"value":"Happy","by":"someone"}}',
        S1,
        null,
        "Each change carries its value, what this window saw, and where a suggestion came from",
      ],
      [
        '{"defcon":{"value":"Happy","from":"AI says"}}',
        S1,
        null,
        "That is not a prefill source",
      ],
      ["{}", S1, null, "There is nothing to save"],
      [
        '{"defcon":{"value":"Happy"}}',
        "short",
        null,
        "This window has no session ID. Reload it, then type again.",
      ],
      [
        '{"defcon":{"value":"Happy"}}',
        S1,
        0,
        "That is not a revision of these notes",
      ],
    ] as const)
      expect([
        body.slice(0, 30),
        await refusal(CSM, SAVE, [id, body, session, base]),
      ]).toEqual([
        body.slice(0, 30),
        expect.objectContaining({ code: "22023", message: sentence }),
      ]);
    expect(
      await refusal(CEO, SAVE, [id, changes({ defcon: "Paused" }), S1, null]),
    ).toMatchObject({
      code: "42501",
      message: "Only your own notes can be changed.",
    });
    expect(await refused(CSM, SAVE, [RID(299), changes(READY), S1, null])).toBe(
      "Open the notes from the client page.",
    );
    expect(await revision()).toBe(before);
  });

  test("every value refusal of 3.2 is the field's own sentence, and nothing is saved", async () => {
    const id = RID(201);
    const gone = await recording({ gone: true });
    const prospect = await recording({
      by: "closer@tests.invalid",
      team: "Sales",
      cls: "client",
    });
    const future = await booking(C, { start: ago(-60) });
    const cancelled = await booking(C, { start: ago(60), status: "cancelled" });
    const goneBooking = await booking(C, { start: ago(60), status: "gone" });
    const acme = await booking(A, { start: ago(60) });
    const salesRow = (
      await q<{ id: number }>(
        "SELECT id FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id='900000102'",
      )
    )[0].id;
    const answers = async () =>
      JSON.stringify(
        (
          await q(
            "SELECT answers, revision FROM public.cockpit_form_responses WHERE id=$1",
            [id],
          )
        )[0],
      );
    const before = await answers();
    const pick = "Pick the call these notes are for, or choose No recording.";
    const notStored =
      "That recording is not in the cockpit yet. Check again in a minute.";
    const team = "That recording is a team meeting, not a client call.";
    const notHere = "That booked call is not on this client.";
    const noText = "A line is missing its text.";
    const cases: [Row, string][] = [
      [{ call: "this one" }, pick],
      [{ call: { kind: "zoom", recordingId: "900000101" } }, pick],
      [{ call: {} }, pick],
      [{ call: { kind: "fathom", recordingId: "900000101" } }, pick],
      [
        { call: { kind: "fathom", recordingId: "abc", why: "picked" } },
        notStored,
      ],
      [
        { call: { kind: "fathom", recordingId: "999999999", why: "picked" } },
        notStored,
      ],
      [
        { call: { kind: "fathom", recordingId: gone, why: "picked" } },
        "Fathom no longer has that recording. Pick another call.",
      ],
      [
        { call: { kind: "fathom", recordingId: "900000102", why: "picked" } },
        team,
      ],
      [
        { call: { kind: "fathom", recordingId: "900000105", why: "picked" } },
        team,
      ],
      [
        { call: { kind: "fathom", recordingId: "900000103", why: "picked" } },
        "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.",
      ],
      [
        { call: { kind: "fathom", recordingId: prospect, why: "picked" } },
        "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.",
      ],
      [{ call: { kind: "booking", callId: acme } }, notHere],
      [{ call: { kind: "booking", callId: goneBooking } }, notHere],
      [{ call: { kind: "booking", callId: salesRow } }, notHere],
      [{ call: { kind: "booking", callId: "the 10:30" } }, notHere],
      [
        { call: { kind: "booking", callId: cancelled } },
        "That booked call was cancelled. Pick its recording or No recording.",
      ],
      [
        { call: { kind: "booking", callId: future } },
        "That booked call has not happened yet.",
      ],
      [{ defcon: "Ecstatic" }, '"Ecstatic" is not one of the answers.'],
      [{ defcon: "happy" }, '"happy" is not one of the answers.'],
      [{ priority: "Urgent" }, '"Urgent" is not one of the answers.'],
      [{ we_owe: "Send the brand kit" }, noText],
      [
        {
          they_owe: Array.from({ length: 31 }, (_, i) => ({
            text: `Line ${i}`,
          })),
        },
        "Keep it to 30 lines.",
      ],
      [
        { we_owe: [{ text: "x".repeat(301) }] },
        "Keep each line under 300 characters.",
      ],
      [{ we_owe: [{ text: "   " }] }, noText],
      [{ we_owe: ["Send the brand kit"] }, noText],
      [{ they_owe: [{ owner: "the client" }] }, noText],
      [{ client_notes: "x".repeat(4001) }, "Keep it under 4,000 characters."],
      [{ client_notes: { text: "Calm." } }, "Keep it under 4,000 characters."],
    ];
    for (const [values, sentence] of cases) {
      const r = await refusal(CSM, SAVE, [id, changes(values), S1, null]);
      expect([values, r.code, r.message]).toEqual([values, "22023", sentence]);
    }
    expect(await answers()).toBe(before);
    // The limits themselves are allowed.
    const ok = await save(CSM, id, {
      client_notes: "x".repeat(4000),
      we_owe: Array.from({ length: 30 }, (_, i) => ({
        text: `${i} ${"y".repeat(290)}`,
      })),
    });
    expect(ok.row.answers.client_notes).toHaveLength(4000);
    expect(ok.row.answers.we_owe).toHaveLength(30);
    await save(CSM, id, { client_notes: null, we_owe: null });
  });

  test("the call is read from the store, never from the browser, and confirmed follows why", async () => {
    const id = RID(201);
    const stored = async (rec: string) =>
      (
        await q(
          "SELECT jsonb_build_object('s', starts_at, 'e', ends_at) j FROM public.cockpit_fathom_meetings WHERE recording_id=$1",
          [rec],
        )
      )[0].j;
    const t101 = await stored("900000101");
    const r = await save(CSM, id, {
      call: {
        kind: "fathom",
        recordingId: "900000101",
        why: "latest_unlinked",
        confirmed: false,
        startsAt: "2020-01-01T00:00:00Z",
        title: "Typed in the browser",
        shareUrl: "https://fathom.video/share/forged",
        recorder: "other",
        callId: 1,
      },
    });
    expect(r.row.answers.call).toEqual({
      kind: "fathom",
      recordingId: "900000101",
      callId: null,
      shareUrl: "https://fathom.video/share/test-900000101",
      startsAt: t101.s,
      endsAt: t101.e,
      title: "Impromptu Google Meet Meeting",
      why: "latest_unlinked",
      recorder: "csm",
      confirmed: false,
    });
    const confirmed = async (why: string, value: boolean) =>
      (
        await save(CSM, id, {
          call: {
            kind: "fathom",
            recordingId: "900000101",
            why,
            confirmed: value,
          },
        })
      ).row.answers.call.confirmed;
    // An exact signal or a pick is confirmed; a guess waits for "Yes, this call".
    for (const why of [
      "same_room",
      "invitee_email",
      "pasted",
      "matched",
      "picked",
    ])
      expect([why, await confirmed(why, false)]).toEqual([why, true]);
    for (const why of [
      "speaker_name",
      "title",
      "domain",
      "near_booking",
      "latest_unlinked",
    ]) {
      expect([why, await confirmed(why, false)]).toEqual([why, false]);
      expect([why, await confirmed(why, true)]).toEqual([why, true]);
    }
    // The recorder: the CSM's seat, another Customer Success recorder, anyone
    // else (the CEO's Sales-team call, once it is on this card: the tie rule
    // is the next test's).
    const team = await recording({ by: "admin@tests.invalid" });
    const ceo = await recording({
      by: "aziz@maharamedia.com",
      team: "Sales",
      cls: "client",
    });
    await callRow(ceo, { task: C });
    for (const [rec, recorder] of [
      ["900000104", "csm"],
      [team, "team"],
      [ceo, "other"],
    ])
      expect(
        (await save(CSM, id, { call: fathomCall(rec, "picked") })).row.answers
          .call.recorder,
      ).toBe(recorder);
    // A recording already on this card carries its call row.
    const onAcme = await save(CSM, RID(101), {
      call: fathomCall("900000103", "matched", false),
    });
    expect(onAcme.row.answers.call).toMatchObject({
      recordingId: "900000103",
      callId: (
        await q<{ id: number }>(
          "SELECT id FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id='900000103'",
        )
      )[0].id,
      title: "Acme Interiors check-in",
      recorder: "other",
      confirmed: true,
    });
    // A booked call is read from its row, and No recording is always confirmed.
    const held = await booking(C, { start: ago(90), end: ago(60) });
    const times = (
      await q(
        "SELECT jsonb_build_object('s', starts_at, 'e', ends_at) j FROM public.cockpit_csm_calls WHERE id=$1",
        [held],
      )
    )[0].j;
    expect(
      (
        await save(CSM, id, {
          call: {
            kind: "booking",
            callId: held,
            why: "picked",
            startsAt: "2020-01-01T00:00:00Z",
            confirmed: false,
          },
        })
      ).row.answers.call,
    ).toEqual({
      kind: "booking",
      callId: held,
      startsAt: times.s,
      endsAt: times.e,
      why: "booking",
      confirmed: true,
    });
    expect(
      (await save(CSM, id, { call: { kind: "booking", callId: String(held) } }))
        .row.answers.call.callId,
    ).toBe(held);
    expect(
      (
        await save(CSM, id, {
          call: { kind: "none", why: "picked", confirmed: false },
        })
      ).row.answers.call,
    ).toEqual({ kind: "none", why: "none", confirmed: true });
    // To-dos are trimmed and kept once; notes are trimmed.
    const t = await save(CSM, id, {
      we_owe: [
        {
          text: "  Send the   brand kit  ",
          owner: "  the CSM  ",
          at: 75.9,
          href: "https://fathom.video/share/test-x?timestamp=75",
          from: "fathom",
          unsure: true,
        },
        { text: "send the brand kit" },
        {
          text: "Book the shoot",
          owner: 5,
          at: 90000,
          href: "https://elsewhere.invalid/x",
          from: "robot",
          unsure: "yes",
        },
      ],
      client_notes: "  Calm, asked about the next shoot.  ",
    });
    expect(t.row.answers.we_owe).toEqual([
      {
        text: "Send the brand kit",
        owner: "the CSM",
        at: 75,
        href: "https://fathom.video/share/test-x?timestamp=75",
        from: "fathom",
        unsure: true,
      },
      {
        text: "Book the shoot",
        owner: null,
        at: null,
        href: null,
        from: "csm",
        unsure: false,
      },
    ]);
    expect(t.row.answers.client_notes).toBe(
      "Calm, asked about the next shoot.",
    );
  });

  test("a recording made outside Customer Success is the call only when something ties it to this client, whatever the browser's why", async () => {
    await rolledBack(async () => {
      const id = RID(201); // the CSM's notes on Cedar Homes
      const outside =
        "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
      const answers = async () =>
        JSON.stringify(
          (
            await q(
              "SELECT answers, revision FROM public.cockpit_form_responses WHERE id=$1",
              [id],
            )
          )[0],
        );
      const pick = (rec: string, why = "picked") =>
        changes({ call: fathomCall(rec, why) });
      const refusedAs = async (who: string, rid: string, rec: string) =>
        refusal(who, SAVE, [rid, pick(rec), S1, null]);
      const sales = (o: Parameters<typeof recording>[0] = {}) =>
        recording({
          by: "aziz@maharamedia.com",
          team: "Sales",
          cls: "client",
          ...o,
        });
      const invite = (rec: string, emails: string[]) =>
        q(
          "UPDATE public.cockpit_fathom_meetings SET invitees=$2::jsonb WHERE recording_id=$1",
          [
            rec,
            JSON.stringify(
              emails.map(email => ({
                email,
                is_external: !email.endsWith("@maharamedia.com"),
              })),
            ),
          ],
        );
      const onBooking = (call: number, emails: string[]) =>
        q(
          "UPDATE public.cockpit_csm_calls SET external_invitees=$2::jsonb WHERE id=$1",
          [call, JSON.stringify(emails.map(email => ({ email })))],
        );
      const before = await answers();

      // The CEO's Sales-team call on no client, not indexed by the sales desk
      // yet: refused for every why, the exact ones included, and none of its
      // title, link or times comes back.
      const loose = await sales({ title: "Pricing call" });
      for (const why of [
        "picked",
        "pasted",
        "same_room",
        "invitee_email",
        "matched",
        "speaker_name",
        "title",
        "domain",
        "near_booking",
        "latest_unlinked",
      ]) {
        const r = await refusal(CSM, SAVE, [
          id,
          changes({ call: fathomCall(loose, why, true) }),
          S1,
          null,
        ]);
        expect([why, r.code, r.message]).toEqual([why, "22023", outside]);
      }
      // A call row on no client ties nothing; a closer's call, or a recorder
      // with no Fathom team who is not one of the CSM's seats, neither.
      await callRow(loose, { candidate: true });
      const closer = await recording({
        by: "closer@tests.invalid",
        team: "Sales",
        cls: "client",
      });
      const noTeam = await recording({
        by: "creative@tests.invalid",
        cls: "client",
      });
      await q(
        "UPDATE public.cockpit_fathom_meetings SET recorder_team=NULL, raw=raw #- '{recorded_by,team}' WHERE recording_id=$1",
        [noTeam],
      );
      for (const rec of [loose, closer, noTeam])
        expect([rec, (await refusedAs(CSM, id, rec)).message]).toEqual([
          rec,
          outside,
        ]);

      // Signs that name another card, or no card, tie nothing: a room another
      // card's booking also uses within 90 minutes, this card's room two hours
      // away, the client of another card on the invite, a Mahara address on
      // both, and the link in another card's 1-1 form.
      const shared = "zoom:55500011122";
      await booking(C, { start: ago(125), room: shared });
      await booking(A, { start: ago(150), room: shared });
      const far = "meet:far-away-roo";
      await booking(C, { start: ago(240), room: far });
      const acmeBooking = await booking(A, { start: ago(400) });
      await onBooking(acmeBooking, ["buyer@acme-co.invalid"]);
      const cedarStaff = await booking(C, { start: ago(400) });
      await onBooking(cedarStaff, ["ops@maharamedia.com"]);
      const inShared = await sales({ room: shared });
      const inFar = await sales({ room: far });
      const acmeInvite = await sales();
      await invite(acmeInvite, ["buyer@acme-co.invalid"]);
      const staffInvite = await sales();
      await invite(staffInvite, ["ops@maharamedia.com"]);
      const acmeForm = await sales();
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at,answers)
         VALUES('tf-tie-acme','fRokTITH','checkin',$1,'hidden_field',$2,$3::jsonb)`,
        [
          A,
          ago(30),
          JSON.stringify([
            {
              type: "url",
              title: "Fathom link",
              value: `https://fathom.video/share/test-${acmeForm}`,
            },
          ]),
        ],
      );
      for (const rec of [inShared, inFar, acmeInvite, staffInvite, acmeForm])
        expect([rec, (await refusedAs(CSM, id, rec)).message]).toEqual([
          rec,
          outside,
        ]);
      expect(await answers()).toBe(before);

      // What ties a recording to Cedar Homes: a Customer Success recorder,
      // one of the CSM's seats with no Fathom team, a call row on this card,
      // the same room as this card's booking alone, the client on the invite,
      // or the link in this card's stored 1-1 form.
      const csmNoTeam = await recording({ cls: "client" });
      await q(
        "UPDATE public.cockpit_fathom_meetings SET recorder_team=NULL, raw=raw #- '{recorded_by,team}' WHERE recording_id=$1",
        [csmNoTeam],
      );
      const csTeam = await recording({ by: "admin@tests.invalid" });
      const onCedar = await sales();
      await callRow(onCedar, { task: C });
      const room = "meet:cdr-room-one";
      await booking(C, { start: ago(130), room });
      const sameRoom = await sales({ room });
      const cedarBooking = await booking(C, { start: ago(2000) });
      await onBooking(cedarBooking, ["owner@cedar.invalid"]);
      const cedarInvite = await sales();
      await invite(cedarInvite, ["Owner@Cedar.invalid", "ops@maharamedia.com"]);
      const cedarForm = await sales();
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at,answers)
         VALUES('tf-tie-cedar','fRokTITH','checkin',$1,'hidden_field',$2,$3::jsonb)`,
        [
          C,
          ago(30),
          JSON.stringify([
            {
              type: "url",
              title: "Fathom link",
              value: `https://fathom.video/share/test-${cedarForm}`,
            },
          ]),
        ],
      );
      for (const [rec, why, recorder] of [
        [csmNoTeam, "picked", "csm"],
        [csTeam, "picked", "team"],
        [onCedar, "matched", "other"],
        [sameRoom, "same_room", "other"],
        [cedarInvite, "invitee_email", "other"],
        [cedarForm, "pasted", "other"],
      ])
        expect([
          rec,
          (await save(CSM, id, { call: fathomCall(rec, why) })).row.answers
            .call,
        ]).toEqual([
          rec,
          expect.objectContaining({ recordingId: rec, why, recorder }),
        ]);

      // A card off the clients list counts the client on the invite only
      // through its booking within 30 minutes (A7.13). The gate keeps the
      // window off such a card, so the rule is read straight, for the CSM's
      // seat (which may not place a recording itself, rule 4).
      const tied = async (rec: string, task: string) =>
        (
          await q<{ t: boolean }>(
            "SELECT public.cockpit_form_recording_tied($1,$2,$3) t",
            [rec, task, CSM],
          )
        )[0].t;
      const unlisted = "taskZ9";
      const z1 = (
        await q<{ id: number }>(
          `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
             starts_at,status,external_invitees)
           VALUES('ghl_appointment','appt-tie-z1',$1,'Zed Studio','client_id_field',1,'checkin','Check-in',$2,'confirmed',
                  '[{"email":"owner@zed.invalid"}]'::jsonb) RETURNING id`,
          [unlisted, ago(300)],
        )
      )[0].id;
      const zInvite = await sales({ start: ago(120), end: ago(90) });
      await invite(zInvite, ["owner@zed.invalid"]);
      expect(await tied(zInvite, unlisted)).toBe(false);
      await q("UPDATE public.cockpit_csm_calls SET starts_at=$2 WHERE id=$1", [
        z1,
        ago(140),
      ]);
      expect(await tied(zInvite, unlisted)).toBe(true);
      expect([await tied(zInvite, C), await tied(cedarInvite, A)]).toEqual([
        false,
        false,
      ]);

      // The send holds the rule too (step 7): a call tied when it was saved
      // and moved off the card since is refused, and nothing is planned.
      const ready = await save(CSM, id, {
        call: fathomCall(onCedar, "matched"),
        ...READY,
      });
      await q(
        "UPDATE public.cockpit_csm_calls SET task_id=NULL, client_name=NULL, match_method=NULL WHERE source='fathom' AND source_id=$1",
        [onCedar],
      );
      expect(
        await refusal(CSM, SUBMIT, [id, ready.row.revision]),
      ).toMatchObject({ code: "22023", message: outside });
      expect(await stateOf(id)).toBe("draft");
      expect(await effectRows(id)).toBe(0);

      // Another client is named only to a seat that may see it: Beta Build's
      // own seat reads "another client" for Acme's recording; an admin and
      // the CEO read the name.
      const onAcme = "900000103";
      await fresh(CSM_B, B, RID(202));
      expect((await refusedAs(CSM_B, RID(202), onAcme)).message).toBe(
        "That recording is on another client. If that is wrong, ask an admin to move it.",
      );
      for (const [who, rid] of [
        [ADMIN, RID(203)],
        [CEO, RID(204)],
      ]) {
        await fresh(who, B, rid);
        expect([who, (await refusedAs(who, rid, onAcme)).message]).toEqual([
          who,
          "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.",
        ]);
      }
    });
  });

  test("a seat that may place the recording itself (an admin, the CEO, its recorder) saves and sends it; the CSM is refused; a likely sign or a pasted link alone never ties", async () => {
    await rolledBack(async () => {
      const outside =
        "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
      // A Customer Success lead who also holds the ceo role: client-success
      // access to every card, but not one of the CSM's own seats (3.5), not an
      // admin and not the CEO.
      const LEAD = "00000000-0000-4000-8000-0000000000e1";
      await member(db, LEAD, "lead@tests.invalid", ["csm", "ceo"]);
      const seats: [string, string][] = [
        [CSM, RID(211)],
        [CEO, RID(212)],
        [ADMIN, RID(213)],
        [LEAD, RID(214)],
      ];
      for (const [who, rid] of seats) await fresh(who, C, rid);
      const ridOf = Object.fromEntries(seats);

      // A closer's Sales-team call whose title names Cedar Homes, a likely
      // sign only: refused for the CSM, saved for the CEO.
      const titled = await recording({
        by: "closer@tests.invalid",
        team: "Sales",
        cls: "client",
        title: "Cedar Homes pricing review",
      });
      expect(
        await refusal(CSM, SAVE, [
          ridOf[CSM],
          changes({ call: fathomCall(titled, "title") }),
          S1,
          null,
        ]),
      ).toMatchObject({ code: "22023", message: outside });
      expect(
        (await save(CEO, ridOf[CEO], { call: fathomCall(titled, "title") })).row
          .answers.call,
      ).toMatchObject({ recordingId: titled, why: "title", recorder: "other" });

      // The lead's own Sales-team call, pasted, with no sign at all: refused
      // for the CSM; saved for the CEO, an admin and its recorder.
      const pasted = await recording({
        by: "lead@tests.invalid",
        team: "Sales",
        cls: "client",
        title: "Pricing call",
      });
      expect(
        await refusal(CSM, SAVE, [
          ridOf[CSM],
          changes({ call: fathomCall(pasted, "pasted") }),
          S1,
          null,
        ]),
      ).toMatchObject({ code: "22023", message: outside });
      for (const who of [CEO, ADMIN, LEAD])
        expect([
          who,
          (await save(who, ridOf[who], { call: fathomCall(pasted, "pasted") }))
            .row.answers.call,
        ]).toEqual([
          who,
          expect.objectContaining({
            recordingId: pasted,
            why: "pasted",
            recorder: "other",
            confirmed: true,
          }),
        ]);
      // The send holds the same seat (step 7): the lead's notes go through.
      await save(LEAD, ridOf[LEAD], READY);
      const sent = await submit(LEAD, ridOf[LEAD]);
      expect(sent.response.state).toBe("submitted");
      expect(sent.effects).toHaveLength(CHECKIN_KEYS.length);

      // Read straight: the recorder counts only as a seat with client-success
      // access to the card (the queue's gate); a media buyer who recorded a
      // call, a switched-off seat, a malformed or missing seat tie nothing.
      const buyerCall = await recording({
        by: "buyer@tests.invalid",
        team: "Sales",
        cls: "client",
      });
      const goneCall = await recording({
        by: "gone@tests.invalid",
        team: "Sales",
        cls: "client",
      });
      const tied = async (rec: string, seat: string | null) =>
        (
          await q<{ t: boolean }>(
            "SELECT public.cockpit_form_recording_tied($1,$2,$3::uuid) t",
            [rec, C, seat],
          )
        )[0].t;
      expect([
        await tied(pasted, LEAD),
        await tied(pasted, CSM_B),
        await tied(buyerCall, BUYER),
        await tied(goneCall, GONE),
        await tied(pasted, null),
        await tied(titled, CSM),
        await tied(titled, CEO),
        await tied("999999999", CEO),
      ]).toEqual([true, false, false, false, false, false, true, false]);
      // A recording on another card stands for none here, whoever asks.
      expect(await tied("900000103", CEO)).toBe(false);
    });
  });

  test("cockpit_form_recordings_tied: the door reads the save's tie rule, each rule, a likely sign alone never, rule 4 with the response's own seat; the service role only", async () => {
    await rolledBack(async () => {
      const TIED =
        "SELECT public.cockpit_form_recordings_tied($1,$2::text[],$3::uuid,$4::uuid) r";
      const tiedFor = (
        task: string,
        ids: string[],
        actor: string | null,
        response: string | null = null,
      ) => svc<string[]>(TIED, [task, ids, actor, response]);
      const sales = (o: Parameters<typeof recording>[0] = {}) =>
        recording({
          by: "closer@tests.invalid",
          team: "Sales",
          cls: "client",
          ...o,
        });
      const invite = (rec: string, emails: string[]) =>
        q(
          "UPDATE public.cockpit_fathom_meetings SET invitees=$2::jsonb WHERE recording_id=$1",
          [
            rec,
            JSON.stringify(emails.map(email => ({ email, is_external: true }))),
          ],
        );
      const onBooking = (call: number, emails: string[]) =>
        q(
          "UPDATE public.cockpit_csm_calls SET external_invitees=$2::jsonb WHERE id=$1",
          [call, JSON.stringify(emails.map(email => ({ email })))],
        );
      const form = (token: string, task: string, rec: string) =>
        q(
          `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at,answers)
           VALUES($1,'fRokTITH','checkin',$2,'hidden_field',$3,$4::jsonb)`,
          [
            token,
            task,
            ago(30),
            JSON.stringify([
              {
                type: "url",
                title: "Fathom link",
                value: `https://fathom.video/share/test-${rec}`,
              },
            ]),
          ],
        );

      // Rule 1: a Customer Success recording. Rule 2: a call row on this card
      // (another card's row ties nothing here). Rule 3: the same room, the
      // client on the invite, the link in this card's stored form.
      const cs = await recording({ cls: "client" });
      const onCedar = await sales();
      await callRow(onCedar, { task: C });
      const onAcme = await sales();
      await callRow(onAcme, { task: A });
      const room = "meet:rt1-room-one";
      await booking(C, { start: ago(130), room });
      const sameRoom = await sales({ room });
      const cedarBooking = await booking(C, { start: ago(2000) });
      await onBooking(cedarBooking, ["owner@cedar-rt.invalid"]);
      const cedarInvite = await sales();
      await invite(cedarInvite, ["owner@cedar-rt.invalid"]);
      const cedarForm = await sales();
      await form("tf-rt-cedar", C, cedarForm);
      // Likely signs only (the title, the company domain), and no sign at all.
      const titled = await sales({ title: "Cedar Homes monthly review" });
      const domain = await sales();
      await invite(domain, ["someone-else@cedar-rt.invalid"]);
      const loose = await recording({
        by: "aziz@maharamedia.com",
        team: "Sales",
        cls: "client",
      });
      const all = [
        cs,
        onCedar,
        onAcme,
        sameRoom,
        cedarInvite,
        cedarForm,
        titled,
        domain,
        loose,
      ];
      const audits = () =>
        count("SELECT count(*) n FROM public.cockpit_audit_log");
      const auditsBefore = await audits();

      expect(await tiedFor(C, all, CSM)).toEqual([
        cs,
        onCedar,
        sameRoom,
        cedarInvite,
        cedarForm,
      ]);
      // Rule 4: the CEO and an admin may place any of them but another card's.
      for (const who of [CEO, ADMIN])
        expect([who, await tiedFor(C, all, who)]).toEqual([
          who,
          [
            cs,
            onCedar,
            sameRoom,
            cedarInvite,
            cedarForm,
            titled,
            domain,
            loose,
          ],
        ]);
      // A seat the gate refuses, or none, is no seat.
      expect(await tiedFor(C, [titled, loose], BUYER)).toEqual([]);
      expect(await tiedFor(C, [cs, titled, loose], null)).toEqual([cs]);
      // A read: no audit row.
      expect(await audits()).toBe(auditsBefore);

      // With a response, its own seat counts, never the caller's.
      const ceoNotes = RID(221);
      const csmNotes = RID(222);
      await fresh(CEO, C, ceoNotes);
      await fresh(CSM, C, csmNotes);
      expect(await tiedFor(C, [cs, titled, loose], CSM, ceoNotes)).toEqual([
        cs,
        titled,
        loose,
      ]);
      expect(await tiedFor(C, [cs, titled, loose], CEO, csmNotes)).toEqual([
        cs,
      ]);
      // A response of another card, or none at all, ties nothing.
      const acmeNotes = RID(223);
      await fresh(CEO, A, acmeNotes);
      expect(await tiedFor(C, [cs, titled], CEO, acmeNotes)).toEqual([]);
      expect(await tiedFor(C, [cs], CEO, RID(229))).toEqual([]);
      // An imported response has no seat: rules 1 to 3 only.
      const imported = RID(224);
      await q(
        `INSERT INTO public.cockpit_form_responses(id,form_key,form_version,source,task_id,client_name,mode,state,answers,created_by,submitted_at)
         VALUES($1,'checkin',1,'import',$2,'Cedar Homes','live','submitted','{}'::jsonb,'import',now())`,
        [imported, C],
      );
      expect(
        await tiedFor(C, [cs, onCedar, titled, loose], CEO, imported),
      ).toEqual([cs, onCedar]);

      // In the order asked, once each; a malformed or unknown id is not tied.
      expect(
        await tiedFor(C, [cedarForm, "12", cs, cedarForm, "999999999"], CSM),
      ).toEqual([cedarForm, cs]);
      expect(await tiedFor(C, [], CSM)).toEqual([]);

      // A7.14 word for word, as the door's model of this rule reads it: the
      // client on the invite ties a recording to each card whose booking holds
      // that address (any time for a listed card), even when it is on two
      // cards; a room two cards use within 90 minutes ties neither.
      const both = await sales({ start: ago(120), end: ago(90) });
      await invite(both, ["partner@shared-rt.invalid"]);
      await onBooking(await booking(C, { start: ago(3000) }), [
        "partner@shared-rt.invalid",
      ]);
      await onBooking(await booking(A, { start: ago(3100) }), [
        "partner@shared-rt.invalid",
      ]);
      expect([
        await tiedFor(C, [both], CSM),
        await tiedFor(A, [both], CSM),
      ]).toEqual([[both], [both]]);
      const sharedRoom = "zoom:66600011122";
      await booking(C, { start: ago(400), room: sharedRoom });
      await booking(A, { start: ago(420), room: sharedRoom });
      const inShared = await sales({
        start: ago(390),
        end: ago(360),
        room: sharedRoom,
      });
      expect([
        await tiedFor(C, [inShared], CSM),
        await tiedFor(A, [inShared], CSM),
        await tiedFor(C, [inShared], CEO),
      ]).toEqual([[], [], [inShared]]);

      // At most 50 ids; a well-formed card; the service role only.
      expect(
        (
          await svcRefusal(TIED, [
            C,
            Array.from({ length: 51 }, (_, i) => String(900001000 + i)),
            CSM,
            null,
          ])
        ).message,
      ).toBe("Ask about 50 recordings at most.");
      expect(
        (await svcRefusal(TIED, ["not a card", [cs], CSM, null])).message,
      ).toBe("Choose a valid ClickUp client ID");
      expect(await refused(CEO, TIED, [C, [cs], CEO, null])).toContain(
        "permission denied",
      );
    });
  });

  test("rule 2 counts a call row on this card only when an exact sign or a person placed it: a closer's call the worker put here by a client's name (0.6) or a company domain (invitee_email 0.8) is refused for the CSM at the save, the attach (with A7.14's second sentence, round 4) and the door's ask, and used by the CEO, an admin and its recorder; a known contact (0.9), a same-room, a manual row and a Customer Success recording still tie (A7.14 rule 2, round 3)", async () => {
    // The database here holds both files applied three times (twice at set-up,
    // once more by the first test), so this is the rule after a second apply.
    await rolledBack(async () => {
      const outside =
        "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
      // A7.14's second sentence (round 4, A7.18): the tie rule's refusal for a
      // call row on this card that a likely sign placed.
      const outsideLikely =
        "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";
      const ATTACH =
        "SELECT public.cockpit_csm_attach_recording($1,$2,$3,$4::jsonb) r";
      const TIED =
        "SELECT public.cockpit_form_recordings_tied($1,$2::text[],$3::uuid,$4::uuid) r";
      // The closer who recorded the calls holds a seat with client-success
      // access to every card, so rule 4 lets the recorder use them; not one of
      // the CSM's own seats (3.5), not an admin and not the CEO.
      const CLOSER = "00000000-0000-4000-8000-0000000000e2";
      const closerMail = "closer-seat@tests.invalid";
      await member(db, CLOSER, closerMail, ["csm", "ceo"]);
      const seats = [
        ["the CSM", CSM, "csm@tests.invalid", RID(231)],
        ["the CEO", CEO, "aziz@maharamedia.com", RID(232)],
        ["an admin", ADMIN, "admin@tests.invalid", RID(233)],
        ["its recorder", CLOSER, closerMail, RID(234)],
      ] as const;
      for (const [, who, , rid] of seats) await fresh(who, C, rid);
      const ridOf = Object.fromEntries(seats.map(s => [s[1], s[3]]));
      const mailOf = Object.fromEntries(seats.map(s => [s[1], s[2]]));
      const closerCall = (o: Parameters<typeof recording>[0] = {}) =>
        recording({ by: closerMail, team: "Sales", cls: "client", ...o });
      const invite = (rec: string, emails: string[]) =>
        q(
          "UPDATE public.cockpit_fathom_meetings SET invitees=$2::jsonb WHERE recording_id=$1",
          [
            rec,
            JSON.stringify(emails.map(email => ({ email, is_external: true }))),
          ],
        );
      const verdict = (e: unknown) => {
        const m = (e as Error).message;
        return m === outside
          ? "outside"
          : m === outsideLikely
            ? "outside, likely"
            : m;
      };
      // The save as each seat, on its own notes.
      const saveSays = async (who: string, rec: string) => {
        try {
          const r = await save(who, ridOf[who], {
            call: fathomCall(rec, "matched"),
          });
          return r.row.answers.call.recordingId === rec ? "tied" : "other call";
        } catch (e) {
          return verdict(e);
        }
      };
      // The call_match attach as the submitting seat, always undone.
      class Undone extends Error {}
      const attachSays = async (who: string, rec: string) => {
        try {
          await guarded(async () => {
            await db.query(ATTACH, [
              C,
              "Cedar Homes",
              rec,
              JSON.stringify({ actorId: who, email: mailOf[who] }),
            ]);
            throw new Undone("attached");
          });
          return "not undone";
        } catch (e) {
          return e instanceof Undone ? "tied" : verdict(e);
        }
      };
      // The door's ask for the viewer.
      const askSays = async (who: string | null, rec: string) =>
        (await svc<string[]>(TIED, [C, [rec], who, null])).includes(rec)
          ? "tied"
          : "outside";
      const sides = async (who: string, rec: string) => ({
        save: await saveSays(who, rec),
        attach: await attachSays(who, rec),
        ask: await askSays(who, rec),
      });
      const rowOf = async (rec: string) =>
        (
          await q(
            "SELECT task_id, match_method, match_confidence::text AS confidence FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id=$1",
            [rec],
          )
        )[0];

      // What the worker's matchMeeting writes for a closer's call the sales
      // desk has not indexed: a client's name in the title (name, 0.6), and an
      // invitee at the client's company domain who is on no booking of the
      // card (invitee_email, 0.8). Neither row settles the tie, so rules 1, 3
      // and 4 decide: the CSM is refused, the CEO, an admin and the recorder
      // may use it. The row is on this card, so the save and the attach say
      // so (A7.14's second sentence); the door's ask answers untied.
      const byName = await closerCall({ title: "Cedar Homes pricing review" });
      await callRow(byName, {
        task: C,
        method: "name",
        confidence: 0.6,
        host: closerMail,
      });
      const byDomain = await closerCall();
      await invite(byDomain, ["buyer@cedar-domain.invalid"]);
      await callRow(byDomain, {
        task: C,
        method: "invitee_email",
        confidence: 0.8,
        host: closerMail,
      });
      // An invitee_email row with no confidence is no known contact either.
      const noConfidence = await closerCall();
      await callRow(noConfidence, {
        task: C,
        method: "invitee_email",
        confidence: null,
        host: closerMail,
      });
      const got: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      for (const [name, rec] of [
        ["by the client's name", byName],
        ["by a company domain", byDomain],
        ["by an address with no confidence", noConfidence],
      ] as const)
        for (const [label, who] of seats) {
          got[`${name} · ${label}`] = await sides(who, rec);
          want[`${name} · ${label}`] =
            who === CSM
              ? {
                  save: "outside, likely",
                  attach: "outside, likely",
                  ask: "outside",
                }
              : { save: "tied", attach: "tied", ask: "tied" };
        }
      expect(got).toEqual(want);
      // Every attach above was undone: the rows stay as the worker wrote them.
      expect([await rowOf(byName), await rowOf(byDomain)]).toEqual([
        { task_id: C, match_method: "name", confidence: "0.6" },
        { task_id: C, match_method: "invitee_email", confidence: "0.8" },
      ]);
      // Rule 4 reads the response's own seat in the door's ask for the drafts
      // and the transcript: the CSM's notes, the CEO asking, are refused.
      expect(await svc<string[]>(TIED, [C, [byName], CEO, ridOf[CSM]])).toEqual(
        [],
      );
      expect(await svc<string[]>(TIED, [C, [byName], CSM, ridOf[CEO]])).toEqual(
        [byName],
      );
      // The recorder's send holds the same seat (submit step 7).
      await save(CLOSER, ridOf[CLOSER], READY);
      const sent = await submit(CLOSER, ridOf[CLOSER]);
      expect(sent.response.state).toBe("submitted");
      expect(sent.effects).toHaveLength(CHECKIN_KEYS.length);

      // An exact sign or a person still settles it for the CSM: a known
      // contact's address (invitee_email at 0.9, and above), the same room, a
      // booking's time, a stored 1-1 form's link, the Client ID field and the
      // manual match.
      const exact: [string, string, number][] = [
        ["invitee_email", "a known contact", 0.9],
        ["invitee_email", "a known contact, surer", 1],
        ["same_room", "the same room", 1],
        ["appointment_time", "a booking's time", 1],
        ["form_task_id", "a 1-1 form's link", 0.95],
        ["client_id_field", "the Client ID field", 1],
        ["manual", "a person", 1],
      ];
      const exactGot: Record<string, unknown> = {};
      const exactWant: Record<string, unknown> = {};
      for (const [method, name, confidence] of exact) {
        const rec = await closerCall();
        await callRow(rec, { task: C, method, confidence, host: closerMail });
        exactGot[name] = await sides(CSM, rec);
        exactWant[name] = { save: "tied", attach: "tied", ask: "tied" };
      }
      expect(exactGot).toEqual(exactWant);

      // A row a likely sign placed never hides the other rules: a Customer
      // Success recording (rule 1) and a closer's call in the room of this
      // card's booking alone (rule 3) still tie for the CSM.
      const csName = await recording({
        cls: "client",
        title: "Cedar Homes catch-up",
      });
      await callRow(csName, { task: C, method: "name", confidence: 0.6 });
      const room = "meet:rl2-room-one";
      await booking(C, { start: ago(130), room });
      const nameInRoom = await closerCall({ room });
      await callRow(nameInRoom, {
        task: C,
        method: "name",
        confidence: 0.6,
        host: closerMail,
      });
      expect({
        "rule 1": await sides(CSM, csName),
        "rule 3": await sides(CSM, nameInRoom),
      }).toEqual({
        "rule 1": { save: "tied", attach: "tied", ask: "tied" },
        "rule 3": { save: "tied", attach: "tied", ask: "tied" },
      });

      // A row on another card still ties nothing here, a likely sign's
      // included, whoever asks; the save and the attach name that card.
      const onAcme = await closerCall({ title: "Acme Interiors pricing" });
      await callRow(onAcme, {
        task: A,
        method: "name",
        confidence: 0.6,
        host: closerMail,
      });
      const elsewhere =
        "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.";
      expect(await sides(CEO, onAcme)).toEqual({
        save: elsewhere,
        attach: elsewhere,
        ask: "outside",
      });
      expect(
        (
          await q<{ t: boolean }>(
            "SELECT public.cockpit_form_recording_tied($1,$2,$3::uuid) t",
            [onAcme, C, CLOSER],
          )
        )[0].t,
      ).toBe(false);
    });
  });

  test("the tie rule's two sentences (A7.14, round 4, A7.18): a closer's call the worker put on this card by a client's name (0.6), a company domain (invitee_email 0.8) or an address with no confidence reads OUTSIDE_CS_LIKELY for the CSM at the save, the submit and the attach; a closer's call on no card, or with no call row, keeps OUTSIDE_CS; the CEO, an admin and its recorder still save, send and attach it (rule 4); another client and a team meeting are still refused first", async () => {
    // The database here holds both files applied three times (twice at set-up,
    // once more by the first test), so these are the sentences after a second
    // apply.
    await rolledBack(async () => {
      const OUTSIDE_CS =
        "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
      const OUTSIDE_CS_LIKELY =
        "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";
      const ATTACH =
        "SELECT public.cockpit_csm_attach_recording($1,$2,$3,$4::jsonb) r";
      // The closer holds a seat with client-success access to every card, so
      // rule 4 lets the recorder use its calls; not one of the CSM's own seats
      // (3.5), not an admin and not the CEO.
      const CLOSER = "00000000-0000-4000-8000-0000000000e3";
      const closerMail = "closer-four@tests.invalid";
      await member(db, CLOSER, closerMail, ["csm", "ceo"]);
      const seats = [
        ["the CSM", CSM, "csm@tests.invalid"],
        ["the CEO", CEO, "aziz@maharamedia.com"],
        ["an admin", ADMIN, "admin@tests.invalid"],
        ["its recorder", CLOSER, closerMail],
      ] as const;
      const mailOf: Record<string, string> = Object.fromEntries(
        seats.map(s => [s[1], s[2]]),
      );
      let nextNotes = 241;
      const verdict = (e: unknown) => {
        const m = (e as Error).message;
        return m === OUTSIDE_CS
          ? "OUTSIDE_CS"
          : m === OUTSIDE_CS_LIKELY
            ? "OUTSIDE_CS_LIKELY"
            : m;
      };
      /** The recording's call row: on a card or none, by a method; null = no call row. */
      type Place = {
        task: string | null;
        method: string | null;
        confidence: number | null;
      } | null;
      const place = async (rec: string, p: Place) => {
        if (!p) {
          await q(
            "DELETE FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id=$1",
            [rec],
          );
          return;
        }
        const n = await count(
          "SELECT count(*) n FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id=$1",
          [rec],
        );
        if (!n) {
          await callRow(rec, { ...p, host: closerMail });
          return;
        }
        await q(
          `UPDATE public.cockpit_csm_calls SET task_id=$2, client_name=$3, match_method=$4, match_confidence=$5
            WHERE source='fathom' AND source_id=$1`,
          [
            rec,
            p.task,
            p.task ? CLIENT_NAMES[p.task] : null,
            p.method,
            p.confidence,
          ],
        );
      };
      const rowOf = async (rec: string) =>
        (
          await q(
            "SELECT task_id, match_method, match_confidence::text AS confidence FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id=$1",
            [rec],
          )
        )[0] ?? null;
      // The save, on new notes of this seat.
      const saveSays = async (who: string, rec: string) => {
        const rid = RID(nextNotes++);
        await fresh(who, C, rid);
        try {
          const r = await save(who, rid, { call: fathomCall(rec, "matched") });
          return r.row.answers.call.recordingId === rec ? "saved" : "other";
        } catch (e) {
          return verdict(e);
        }
      };
      // The send (submit step 7) as the seat that owns the notes: they took
      // the call while a known contact's address placed it on this card
      // (invitee_email 0.9, so every seat may save it), and the call row is
      // as the worker left it when they are sent.
      const submitSays = async (who: string, rec: string, now: Place) => {
        const rid = RID(nextNotes++);
        await fresh(who, C, rid);
        await place(rec, { task: C, method: "invitee_email", confidence: 0.9 });
        const saved = await save(who, rid, {
          call: fathomCall(rec, "matched"),
          ...READY,
        });
        await place(rec, now);
        try {
          const sent = await submit(who, rid, saved.row.revision);
          return sent.response.state === "submitted" &&
            sent.effects.length === CHECKIN_KEYS.length
            ? "sent"
            : "half sent";
        } catch (e) {
          // Refused before anything is written: still a draft, no effect.
          expect([await stateOf(rid), await effectRows(rid)]).toEqual([
            "draft",
            0,
          ]);
          return verdict(e);
        }
      };
      // The call_match attach as the submitting seat, always undone.
      class Undone extends Error {}
      const attachSays = async (who: string, rec: string) => {
        try {
          await guarded(async () => {
            await db.query(ATTACH, [
              C,
              "Cedar Homes",
              rec,
              JSON.stringify({ actorId: who, email: mailOf[who] }),
            ]);
            throw new Undone("attached");
          });
          return "not undone";
        } catch (e) {
          return e instanceof Undone ? "attached" : verdict(e);
        }
      };

      // What the worker's matchMeeting writes for a closer's call the sales
      // desk has not indexed (a client's name in its title, an invitee at the
      // client's company domain who is on no booking of the card, an address
      // row with no confidence), a closer's call it could not place, and one
      // it never made a row for.
      const cases: [string, Place, Parameters<typeof recording>[0]][] = [
        [
          "on this card by the client's name (name 0.6)",
          { task: C, method: "name", confidence: 0.6 },
          { title: "Cedar Homes pricing review" },
        ],
        [
          "on this card by a company domain (invitee_email 0.8)",
          { task: C, method: "invitee_email", confidence: 0.8 },
          {},
        ],
        [
          "on this card by an address with no confidence",
          { task: C, method: "invitee_email", confidence: null },
          {},
        ],
        [
          "a call row on no card",
          { task: null, method: null, confidence: null },
          {},
        ],
        ["no call row", null, {}],
      ];
      const got: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      const worker: Record<string, unknown> = {};
      const asWritten: Record<string, unknown> = {};
      for (const [name, p, o] of cases) {
        const rec = await recording({
          by: closerMail,
          team: "Sales",
          cls: "client",
          ...o,
        });
        if (name.includes("company domain"))
          await q(
            "UPDATE public.cockpit_fathom_meetings SET invitees=$2::jsonb WHERE recording_id=$1",
            [
              rec,
              JSON.stringify([
                { email: "buyer@cedar-domain.invalid", is_external: true },
              ]),
            ],
          );
        await place(rec, p);
        for (const [label, who] of seats) {
          got[`${name} · ${label}`] = {
            save: await saveSays(who, rec),
            submit: await submitSays(who, rec, p),
            attach: await attachSays(who, rec),
          };
          const refusedAs =
            who !== CSM
              ? null
              : p?.task === C
                ? "OUTSIDE_CS_LIKELY"
                : "OUTSIDE_CS";
          want[`${name} · ${label}`] = refusedAs
            ? { save: refusedAs, submit: refusedAs, attach: refusedAs }
            : { save: "saved", submit: "sent", attach: "attached" };
        }
        // Every attach was undone: the row stays as the worker wrote it.
        worker[name] = await rowOf(rec);
        asWritten[name] = p
          ? {
              task_id: p.task,
              match_method: p.method,
              confidence: p.confidence === null ? null : String(p.confidence),
            }
          : null;
      }
      expect(got).toEqual(want);
      expect(worker).toEqual(asWritten);

      // The checks before the tie rule run first, unchanged: a closer's row a
      // likely sign put on another card names that card to the CSM (who may
      // see every client), and a sales-class recording with a row on this
      // card is a team meeting at the save.
      const onAcme = await recording({
        by: closerMail,
        team: "Sales",
        cls: "client",
        title: "Acme Interiors pricing",
      });
      await place(onAcme, { task: A, method: "name", confidence: 0.6 });
      const indexed = await recording({
        by: closerMail,
        team: "Sales",
        cls: "sales",
        title: "Cedar Homes pricing review",
      });
      await place(indexed, { task: C, method: "name", confidence: 0.6 });
      expect({
        save: await saveSays(CSM, onAcme),
        attach: await attachSays(CSM, onAcme),
        teamMeeting: await saveSays(CSM, indexed),
      }).toEqual({
        save: "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.",
        attach:
          "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.",
        teamMeeting: "That recording is a team meeting, not a client call.",
      });

      // The installed bodies carry each sentence once per function, word for
      // word, after the second apply.
      const bodies = await q<{ name: string; src: string }>(
        `SELECT p.proname AS name, p.prosrc AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname IN ('cockpit_form_checkin_value','cockpit_csm_attach_recording')
          ORDER BY p.proname`,
      );
      const times = (src: string, sentence: string) =>
        src.split(sentence.replaceAll("'", "''")).length - 1;
      expect(
        bodies.map(b => [
          b.name,
          times(b.src, OUTSIDE_CS),
          times(b.src, OUTSIDE_CS_LIKELY),
        ]),
      ).toEqual([
        ["cockpit_csm_attach_recording", 1, 1],
        ["cockpit_form_checkin_value", 1, 1],
      ]);
    });
  });

  test("a model's DEFCON or priority is taken only on its own question", async () => {
    const id = RID(201);
    for (const [key, value, from] of [
      ["priority", "High", "ai.defcon"],
      ["client_notes", "Calm.", "ai.defcon"],
      ["defcon", "Happy", "ai.priority"],
      ["we_owe", [], "ai.priority"],
    ] as const)
      expect(
        await refusal(CSM, SAVE, [
          id,
          changes({ [key]: value }, {}, { [key]: from }),
          S1,
          null,
        ]),
      ).toMatchObject({
        code: "22023",
        message: "That answer cannot come from a draft.",
      });
    const ok = await save(
      CSM,
      id,
      {
        defcon: "Neutral",
        priority: "Low",
        we_owe: [{ text: "Send the brief" }],
        call: fathomCall("900000101", "picked"),
      },
      {
        from: {
          defcon: "ai.defcon",
          priority: "ai.priority",
          we_owe: "fathom.action_items",
          call: "pick",
        },
      },
    );
    expect(ok.row.meta).toMatchObject({
      defcon: { from: "ai.defcon", by: "Noura" },
      priority: { from: "ai.priority" },
      we_owe: { from: "fathom.action_items" },
      call: { from: "pick" },
    });
  });

  test("one audit row per save that changes something, naming only the answer keys that changed, never answer_meta", async () => {
    const id = RID(201);
    const now = (
      await q(
        "SELECT answers, revision FROM public.cockpit_form_responses WHERE id=$1",
        [id],
      )
    )[0];
    const seen = await auditIds(id);
    await save(
      CSM,
      id,
      { defcon: "At Risk", priority: now.answers.priority },
      { base: now.revision },
    );
    const rows = await auditSince(id, seen);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "forms.saved",
      actor_email: "csm@tests.invalid",
      source_app: "client-success",
      metadata: {
        op: "update",
        form_key: "checkin",
        task_id: C,
        changed: ["defcon"],
      },
    });
    expect(rows[0].before.answers).toEqual({ defcon: now.answers.defcon });
    expect(rows[0].after.answers).toEqual({ defcon: "At Risk" });
    expect([rows[0].before.revision, rows[0].after.revision]).toEqual([
      now.revision,
      now.revision + 1,
    ]);
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain("answer_meta");
    expect(text).not.toContain(S1);
    // The same values again change nothing and write no audit row.
    const again = await auditIds(id);
    await save(CSM, id, { defcon: "At Risk" });
    expect(await auditSince(id, again)).toEqual([]);
  });
});

describe("cockpit_form_submit", () => {
  test("refuses notes that are not ready: the answers, an unconfirmed call, another window's revision, another seat", async () => {
    const id = RID(301);
    await fresh(CSM, B, id);
    const sendIt = (who: string, base: number | null = null) =>
      refusal(who, SUBMIT, [id, base]);
    const missing =
      "Pick the call these notes are for, then DEFCON and priority.";
    const confirm = "Confirm the call: press Yes, this call, or pick another.";
    expect(await sendIt(CSM)).toMatchObject({
      code: "22023",
      message: missing,
    });
    await save(CSM, id, READY);
    expect((await sendIt(CSM)).message).toBe(missing);
    await save(CSM, id, {
      call: fathomCall("900000104", "latest_unlinked", false),
    });
    expect(await sendIt(CSM)).toMatchObject({
      code: "22023",
      message: confirm,
    });
    // The unconfirmed call is named first, even with an answer missing too.
    await save(CSM, id, { priority: null });
    expect((await sendIt(CSM)).message).toBe(confirm);
    const ready = await save(CSM, id, {
      priority: "Medium",
      call: fathomCall("900000104", "latest_unlinked", true),
    });
    const revision = ready.row.revision;
    expect(await sendIt(CSM, revision - 1)).toMatchObject({
      code: "40001",
      message:
        "These notes changed in another window. Read them again, then send.",
    });
    // Beta Build's own CSM seat passes the card's gate but not the seat rule.
    for (const who of [CEO, CSM_B])
      expect(await sendIt(who, revision)).toMatchObject({
        code: "42501",
        message: "These notes belong to another seat.",
      });
    expect(await refused(CSM, SUBMIT, [RID(399), null])).toBe(
      "Open the notes from the client page.",
    );
    expect(await stateOf(id)).toBe("draft");
    expect(await effectRows(id)).toBe(0);
  });

  test("a shadow send plans the eight effects as dry_run or skipped, as a CSM seat and as the CEO, and writes nothing outside the forms tables", async () => {
    const held = await booking(A, { start: ago(200), end: ago(170) });
    const outside = async () =>
      JSON.stringify([
        await q("SELECT * FROM public.cockpit_csm_calls ORDER BY id"),
        await q("SELECT * FROM public.cockpit_csm_call_forms ORDER BY token"),
        await q(
          "SELECT * FROM public.cockpit_fathom_meetings ORDER BY recording_id",
        ),
        await q("SELECT * FROM public.cockpit_csm_unmatched ORDER BY id"),
      ]);
    const before = await outside();
    const audits = await auditIds(RID(301));

    // The CSM, on a recording (the notes of the previous test).
    const csm = await submit(CSM, RID(301), null);
    expect(csm.duplicate).toBe(false);
    expect(csm.response).toMatchObject({
      id: RID(301),
      mode: "shadow",
      state: "submitted",
      taskId: B,
      submittedAt: expect.any(String),
    });
    expect(
      csm.effects.map((e: Row) => [e.key, e.owner, e.state, e.reason, e.lines]),
    ).toEqual(
      CHECKIN_KEYS.map(k => [
        k,
        "shadow",
        "dry_run",
        null,
        [`Stub plan for ${k}.`],
      ]),
    );
    expect(csm.effects[3]).toEqual({
      key: "happiness",
      label: "Client Happiness",
      owner: "shadow",
      delivery: "clickup_queue",
      state: "dry_run",
      at: expect.any(String),
      reason: null,
      lines: ["Stub plan for happiness."],
    });
    expect((await auditSince(RID(301), audits)).map(a => a.action)).toEqual([
      "forms.submitted",
    ]);

    // The CEO, on a booked call with no recording.
    const ceo = await send(CEO, A, RID(302), {
      call: { kind: "booking", callId: held },
      ...READY,
    });
    expect(ceo.response).toMatchObject({ mode: "shadow", state: "submitted" });
    expect(
      ceo.effects.map((e: Row) => [e.key, e.owner, e.state, e.reason]),
    ).toEqual(
      CHECKIN_KEYS.map(k =>
        NO_RECORDING.has(k)
          ? [k, "shadow", "skipped", "Stub: no recording."]
          : [k, "shadow", "dry_run", null],
      ),
    );
    const rows = await q(
      `SELECT response_id, effect_key, dedupe_key, owner, settled_at IS NOT NULL settled, plan ? 'lines' lined
         FROM public.cockpit_form_effects WHERE response_id = ANY($1::uuid[]) ORDER BY response_id, effect_key`,
      [[RID(301), RID(302)]],
    );
    expect(rows).toHaveLength(16);
    for (const r of rows)
      expect(r).toEqual({
        response_id: r.response_id,
        effect_key: r.effect_key,
        dedupe_key: `${r.response_id}:${r.effect_key}`,
        owner: "shadow",
        settled: true,
        lined: true,
      });
    // One audit row per effect, with the card and never the plan.
    const effectAudits = await q(
      `SELECT a.metadata, a.after FROM public.cockpit_audit_log a JOIN public.cockpit_form_effects e ON e.id::text = a.entity_id
        WHERE e.response_id=$1`,
      [RID(302)],
    );
    expect(effectAudits).toHaveLength(8);
    for (const a of effectAudits) {
      expect(a.metadata).toMatchObject({
        op: "insert",
        form_key: "checkin",
        task_id: A,
      });
      expect(Object.keys(a.after).sort()).toEqual([
        "delivery_ref",
        "owner",
        "reason",
        "state",
      ]);
    }
    expect(await outside()).toBe(before);

    // Sent notes come back to read, and can no longer change.
    expect((await open(CSM, B, RID(301))).response).toMatchObject({
      id: RID(301),
      state: "submitted",
    });
    expect(
      await refusal(CSM, SAVE, [
        RID(301),
        changes({ defcon: "Paused" }),
        S1,
        null,
      ]),
    ).toMatchObject({
      code: "22023",
      message: "These notes are sent. They can no longer change.",
    });
    expect(
      await refused(CSM, "SELECT public.cockpit_form_discard($1::uuid)", [
        RID(301),
      ]),
    ).toBe("These notes are sent. They can no longer change.");
  });

  test("the same request again returns the first result with duplicate true, and plans nothing more", async () => {
    const first = await one(
      CSM,
      "SELECT public.cockpit_form_responses_read($1::uuid) r",
      [RID(301)],
    );
    const audits = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log",
    );
    const again = await submit(CSM, RID(301), 1);
    expect(again).toEqual({
      response: first.response,
      effects: first.effects,
      duplicate: true,
    });
    expect(await effectRows(RID(301))).toBe(8);
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log")).toBe(
      audits,
    );
  });

  test("the send adopts the newest ready drafts of the call with what was sent and whether it was edited; never the grade", async () => {
    const rec = await recording();
    const older = await readyDraft(
      A,
      rec,
      "todos",
      { items: [{ side: "we", text: "An older draft" }], nextSteps: [] },
      { input: "older" },
    );
    const todos = await readyDraft(
      A,
      rec,
      "todos",
      {
        items: [
          { side: "we", text: "Send the brand kit" },
          { side: "they", text: "Share the logo files" },
        ],
        nextSteps: [],
      },
      { input: "newer" },
    );
    const notes = await readyDraft(A, rec, "client_notes", {
      text: "Calm, wants faster replies.",
    });
    const dp = await readyDraft(A, rec, "defcon_priority", {
      defcon: { value: "Happy" },
      priority: { value: "Medium" },
    });
    const grade = await readyDraft(A, rec, "grade", {
      score: 7.1,
      color: "Green",
    });
    const id = RID(311);
    await send(CSM, A, id, {
      call: fathomCall(rec),
      defcon: "Happy",
      priority: "High",
      we_owe: [{ text: "Send the brand kit" }],
      they_owe: [{ text: "Share the logo files" }],
      client_notes: "Calm, wants faster replies. Asked for Sunday.",
    });
    const drafts = Object.fromEntries(
      (
        await q(
          "SELECT id, response_id, final, edited FROM public.cockpit_form_drafts WHERE recording_id=$1",
          [rec],
        )
      ).map(d => [d.id, d]),
    );
    const line = (text: string) => ({
      text,
      owner: null,
      at: null,
      href: null,
      from: "csm",
      unsure: false,
    });
    expect(drafts[todos]).toEqual({
      id: todos,
      response_id: id,
      final: {
        we_owe: [line("Send the brand kit")],
        they_owe: [line("Share the logo files")],
      },
      edited: false,
    });
    expect(drafts[older]).toMatchObject({
      response_id: null,
      final: null,
      edited: null,
    });
    expect(drafts[notes]).toMatchObject({
      response_id: id,
      final: "Calm, wants faster replies. Asked for Sunday.",
      edited: true,
    });
    expect(drafts[dp]).toMatchObject({
      response_id: id,
      final: { defcon: "Happy", priority: "High" },
      edited: true,
    });
    expect(drafts[grade]).toMatchObject({ response_id: null, final: null });
    expect(
      (
        await q(
          "SELECT answer_meta ? '_drafts' d FROM public.cockpit_form_responses WHERE id=$1",
          [id],
        )
      )[0].d,
    ).toBe(false);
    // The adoption is audited, as the seat that sent the notes.
    expect(
      (await auditSince(todos, [])).map(a => [
        a.action,
        a.actor_email,
        a.metadata.changed,
      ]),
    ).toEqual([
      [
        "forms.cockpit_form_drafts.insert",
        "csm@tests.invalid",
        ["attempt", "kind", "model", "provider", "response_id", "state"],
      ],
      ["forms.cockpit_form_drafts.update", "csm@tests.invalid", ["state"]],
      [
        "forms.cockpit_form_drafts.update",
        "csm@tests.invalid",
        ["response_id"],
      ],
    ]);
  });

  test("two seats send one call, a shadow run then (after the switch) a live one: both go through, the first keeps its drafts, the second records them", async () => {
    await rolledBack(async () => {
      const rec = await recording({ cls: "client" });
      const ids = {
        todos: await readyDraft(C, rec, "todos", {
          items: [{ side: "we", text: "Send the brand kit" }],
          nextSteps: [],
        }),
        client_notes: await readyDraft(C, rec, "client_notes", {
          text: "Calm.",
        }),
        defcon_priority: await readyDraft(C, rec, "defcon_priority", {
          defcon: { value: "Happy" },
          priority: { value: "Medium" },
        }),
      };
      const shadow = await send(CSM, C, RID(321), {
        call: fathomCall(rec, "picked"),
        ...READY,
        we_owe: [{ text: "Send the brand kit" }],
        client_notes: "Calm.",
      });
      expect(shadow.response.mode).toBe("shadow");
      await switchTo("native");
      const live = await send(ADMIN, C, RID(322), {
        call: fathomCall(rec, "picked"),
        defcon: "At Risk",
        priority: "911",
        client_notes: "Calm.",
      });
      expect(live.response).toMatchObject({ mode: "live", state: "submitted" });
      expect(live.response.meta._drafts).toBeUndefined();
      // The registry's owners are still shadow: planned, never delivered.
      expect(live.effects.map((e: Row) => [e.owner, e.state])).toEqual(
        CHECKIN_KEYS.map(() => ["shadow", "dry_run"]),
      );
      expect(
        (
          await q(
            "SELECT answer_meta->'_drafts' d FROM public.cockpit_form_responses WHERE id=$1",
            [RID(322)],
          )
        )[0].d,
      ).toEqual({
        todos: { draftId: ids.todos, edited: true },
        client_notes: { draftId: ids.client_notes, edited: false },
        defcon_priority: { draftId: ids.defcon_priority, edited: true },
      });
      expect(
        await q(
          "SELECT DISTINCT response_id FROM public.cockpit_form_drafts WHERE recording_id=$1",
          [rec],
        ),
      ).toEqual([{ response_id: RID(321) }]);
    });
  });

  test("after the switch a shadow draft cannot be sent and plans nothing; after a switch back a live draft cannot either", async () => {
    await rolledBack(async () => {
      const rec = await recording();
      await fresh(CSM, C, RID(331));
      const revision = (
        await save(CSM, RID(331), { call: fathomCall(rec), ...READY })
      ).row.revision;
      await switchTo("native");
      expect(await refusal(CSM, SUBMIT, [RID(331), revision])).toMatchObject({
        code: "22023",
        message:
          "These notes were started as a shadow run. Discard them and start again.",
      });
      expect(await stateOf(RID(331))).toBe("draft");
      expect(await effectRows(RID(331))).toBe(0);
      await fresh(CEO, C, RID(332));
      const live = (
        await save(CEO, RID(332), { call: fathomCall(rec), ...READY })
      ).row.revision;
      await switchTo("typeform");
      expect(await refusal(CEO, SUBMIT, [RID(332), live])).toMatchObject({
        code: "22023",
        message:
          "The 1-1 notes went back to the Typeform. Discard these notes and use the 1-1 form.",
      });
      expect(await effectRows(RID(332))).toBe(0);
    });
  });

  test("one record per call, for a live send: another live send or a Typeform form on the same recording or booking is refused with its time", async () => {
    await rolledBack(async () => {
      await switchTo("native");
      const typeform = (
        token: string,
        at: string,
        url: string | null,
        linked: number | null,
      ) =>
        q(
          `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at,answers,recording_url,linked_call_id)
           VALUES($1,'fRokTITH','checkin',$2,'hidden_field',$3,'[]'::jsonb,$4,$5)`,
          [token, C, at, url, linked],
        );
      const id = RID(342);
      await fresh(CEO, C, id);
      const refusedWith = async (call: Row, at: string) => {
        const revision = (await save(CEO, id, { call, ...READY })).row.revision;
        expect([call, await refusal(CEO, SUBMIT, [id, revision])]).toEqual([
          call,
          expect.objectContaining({
            code: "22023",
            message: `This call already has 1-1 notes, sent at ${kuwaitClock(at)}.`,
          }),
        ]);
      };
      // Another seat sent the same recording live.
      const r1 = await recording();
      const first = await send(CSM, C, RID(341), {
        call: fathomCall(r1),
        ...READY,
      });
      await refusedWith(fathomCall(r1), first.response.submittedAt);
      // A Typeform form carries the recording's share link.
      const r2 = await recording();
      const at2 = ago(20);
      await typeform(
        "tf-core-1",
        at2,
        `https://fathom.video/share/test-${r2}`,
        null,
      );
      await refusedWith(fathomCall(r2), at2);
      // A Typeform form is linked to the recording's own call row.
      const r3 = await recording();
      const row3 = await callRow(r3, { task: C });
      const at3 = ago(25);
      await typeform("tf-core-2", at3, null, row3);
      await refusedWith(fathomCall(r3), at3);
      // A Typeform form is linked to the booking the recording's row links to,
      // and so to the booking itself.
      const b1 = await booking(C, { start: ago(400) });
      const r4 = await recording();
      await callRow(r4, {
        task: C,
        method: "same_room",
        linked: b1,
        kind: "checkin",
      });
      const at4 = ago(30);
      await typeform("tf-core-3", at4, null, b1);
      await refusedWith(fathomCall(r4), at4);
      await refusedWith({ kind: "booking", callId: b1 }, at4);
      // A live booking send, then the recording of that booking (the other kind).
      const b2 = await booking(C, { start: ago(500) });
      const sentBooking = await send(CSM, C, RID(343), {
        call: { kind: "booking", callId: b2 },
        ...READY,
      });
      const r5 = await recording();
      await callRow(r5, {
        task: C,
        method: "same_room",
        linked: b2,
        kind: "checkin",
      });
      await refusedWith(fathomCall(r5), sentBooking.response.submittedAt);
      await refusedWith(
        { kind: "booking", callId: b2 },
        sentBooking.response.submittedAt,
      );
      // A live recording send linked to a booking, then that booking.
      const b3 = await booking(C, { start: ago(600) });
      const r6 = await recording();
      await callRow(r6, {
        task: C,
        method: "same_room",
        linked: b3,
        kind: "checkin",
      });
      const sentRecording = await send(CSM, C, RID(344), {
        call: fathomCall(r6),
        ...READY,
      });
      await refusedWith(
        { kind: "booking", callId: b3 },
        sentRecording.response.submittedAt,
      );
      // A call nobody noted goes through.
      const r7 = await recording();
      const revision = (await save(CEO, id, { call: fathomCall(r7) })).row
        .revision;
      expect((await submit(CEO, id, revision)).response).toMatchObject({
        mode: "live",
        state: "submitted",
      });
    });
  });

  test("two indexes keep one live record per recording and per booking, and a send that meets one says why", async () => {
    await rolledBack(async () => {
      const insert = (id: string, call: Row, mode = "live") =>
        db.query(
          `INSERT INTO public.cockpit_form_responses(id,form_key,form_version,source,task_id,mode,state,answers,created_by,submitted_at)
           VALUES($1,'checkin',1,'import',$2,$3,'submitted',$4::jsonb,'import',now())`,
          [id, A, mode, JSON.stringify({ call })],
        );
      const rec = await recording();
      await guarded(() =>
        insert(RID(351), { kind: "fathom", recordingId: rec }),
      );
      expect(
        await refusalOf(
          () => insert(RID(352), { kind: "fathom", recordingId: rec }),
          "a second live record",
        ),
      ).toMatchObject({
        code: "23505",
        constraint: "cockpit_form_responses_one_live_recording",
      });
      // Shadow runs are not records.
      await guarded(() =>
        insert(RID(353), { kind: "fathom", recordingId: rec }, "shadow"),
      );
      await guarded(() =>
        insert(RID(354), { kind: "fathom", recordingId: rec }, "shadow"),
      );
      const b = await booking(A, { start: ago(100) });
      await guarded(() => insert(RID(355), { kind: "booking", callId: b }));
      expect(
        await refusalOf(
          () => insert(RID(356), { kind: "booking", callId: b }),
          "a second live booking",
        ),
      ).toMatchObject({
        code: "23505",
        constraint: "cockpit_form_responses_one_live_booking",
      });
      // Two seats at the same moment: the plain read sees nothing yet, the
      // index stops the second send, and the seat reads the step 8 sentence.
      await switchTo("native");
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_form_call_noted_at(p_response_id uuid, p_call jsonb, p_booking bigint)
        RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
        BEGIN RETURN NULL; END $$`);
      await fresh(CSM, A, RID(357));
      const revision = (
        await save(CSM, RID(357), { call: fathomCall(rec), ...READY })
      ).row.revision;
      const r = await refusal(CSM, SUBMIT, [RID(357), revision]);
      expect(r.code).toBe("22023");
      expect(r.message).toMatch(
        /^This call already has 1-1 notes, sent at \d\d:\d\d\.$/,
      );
      expect(await stateOf(RID(357))).toBe("draft");
      expect(await effectRows(RID(357))).toBe(0);
    });
  });

  test("a kickoff or Blueprint response plans no effect; a planner that answers no list stops the send", async () => {
    await rolledBack(async () => {
      const plan = async (id: string) =>
        (
          await q(
            "SELECT public.cockpit_form_plan_effects(r) p FROM public.cockpit_form_responses r WHERE r.id=$1",
            [id],
          )
        )[0].p;
      for (const [key, id] of [
        ["kickoff", RID(361)],
        ["blueprint", RID(362)],
      ]) {
        await q(
          `INSERT INTO public.cockpit_form_responses(id,form_key,form_version,source,task_id,mode,state,answers,created_by,submitted_at)
           VALUES($1,$2,1,'import',$3,'live','submitted','{}'::jsonb,'import',now())`,
          [id, key, A],
        );
        expect(await plan(id)).toEqual([]);
        expect(await effectRows(id)).toBe(0);
      }
      expect(await plan(RID(301))).toHaveLength(8);
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_plan(p_response public.cockpit_form_responses)
        RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
        BEGIN RETURN '{}'::jsonb; END $$`);
      const rec = await recording();
      await fresh(CSM, A, RID(363));
      const revision = (
        await save(CSM, RID(363), { call: fathomCall(rec), ...READY })
      ).row.revision;
      expect(await refusal(CSM, SUBMIT, [RID(363), revision])).toMatchObject({
        code: "P0001",
        message: "The 1-1 notes could not be planned. Tell the tech lead.",
      });
      expect(await stateOf(RID(363))).toBe("draft");
    });
  });

  test("a plan holds the whole write-through of long Arabic notes, past 32 KB, and at most 131,072 bytes", async () => {
    await rolledBack(async () => {
      // A planner whose notes plan carries every answer, as 7.1's call_form
      // carries the write-through.
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_plan(p_response public.cockpit_form_responses)
        RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
        BEGIN
          RETURN jsonb_build_array(jsonb_build_object('effect', 'call_form', 'delivery', 'sql', 'state', 'planned',
            'plan', jsonb_build_object('row', jsonb_build_object('answers', p_response.answers),
              'lines', jsonb_build_array('Would save the notes where the client brief and Today read them.'))));
        END $$`);
      // An Arabic letter is two bytes: 30 and 30 lines of 300 characters,
      // and 4,000 characters of client notes.
      const letters = (n: number) => "\u0639".repeat(n);
      const lines = (side: string) =>
        Array.from({ length: 30 }, (_, i) => ({
          text: `${side}${String(i).padStart(2, "0")} ${letters(296)}`,
        }));
      const id = RID(371);
      const sent = await send(CSM, B, id, {
        call: { kind: "none" },
        ...READY,
        we_owe: lines("w"),
        they_owe: lines("t"),
        client_notes: letters(4000),
      });
      expect(sent.effects.map((e: Row) => [e.key, e.state])).toEqual([
        ["call_form", "dry_run"],
      ]);
      const bytes = (key: string) =>
        count(
          "SELECT octet_length(plan::text) n FROM public.cockpit_form_effects WHERE dedupe_key=$1",
          [`${id}:${key}`],
        );
      expect(await bytes("call_form")).toBeGreaterThan(32_768);
      // The limit itself: 131,072 bytes are kept, one more is refused.
      const PADDED = `INSERT INTO public.cockpit_form_effects(response_id,form_key,effect_key,dedupe_key,owner,delivery,plan,state)
        VALUES($1,'checkin',$2,$3,'shadow','sql',jsonb_build_object('pad', repeat('x', $4::int - 11)),'dry_run')`;
      const padded = (key: string, size: number) => [
        id,
        key,
        `${id}:${key}`,
        size,
      ];
      await q(PADDED, padded("plan_at_limit", 131_072));
      expect(await bytes("plan_at_limit")).toBe(131_072);
      expect(
        await ownerRefusal(PADDED, padded("plan_over_limit", 131_073)),
      ).toMatchObject({
        code: "23514",
        constraint: "cockpit_form_effects_plan_check",
      });
    });
  });
});

describe("the drafts", () => {
  test("begin: the same input comes back as it is; a changed input or Draft again starts the next attempt; finish settles a drafting attempt once; the audit names the seat", async () => {
    const rec = await recording();
    const p = {
      taskId: A,
      recordingId: rec,
      kind: "client_notes",
      provider: "deepseek",
      promptVersion: "checkin.client_notes.v1",
      inputSha256: sha("one"),
      actorEmail: "admin@tests.invalid",
    };
    const first = await begin(p);
    expect(first).toEqual({
      id: expect.any(String),
      existing: false,
      state: "drafting",
      attempt: 1,
    });
    expect(await begin(p)).toEqual({ ...first, existing: true });
    const view = await finish(first.id, {
      state: "ready",
      output: { text: "Invented draft." },
      text: "Invented draft.",
      model: "deepseek-flash",
      usage: { input_tokens: 10, output_tokens: 20 },
      actorEmail: "admin@tests.invalid",
    });
    expect(view).toEqual({
      kind: "client_notes",
      state: "ready",
      attempt: 1,
      provider: "deepseek",
      model: "deepseek-flash",
      promptVersion: "checkin.client_notes.v1",
      at: expect.any(String),
      reason: null,
      output: { text: "Invented draft." },
    });
    // Only a drafting attempt moves; a finished one comes back unchanged.
    expect(
      await finish(first.id, { state: "failed", reason: "Late." }),
    ).toEqual(view);
    expect(await begin(p)).toEqual({
      ...first,
      existing: true,
      state: "ready",
    });
    // The summary arrived: a changed input starts the next attempt.
    const second = await begin({ ...p, inputSha256: sha("two") });
    expect(second).toMatchObject({
      existing: false,
      state: "drafting",
      attempt: 2,
    });
    await finish(second.id, { state: "ready", output: { text: "Second." } });
    // Draft again on the same input starts one more.
    expect(
      await begin({ ...p, inputSha256: sha("two"), again: true }),
    ).toMatchObject({ existing: false, attempt: 3 });
    // The audit names the seat from actorEmail and the forms door, never the draft.
    const audits = await auditSince(first.id, []);
    expect(audits.map(a => [a.action, a.actor_email, a.source_system])).toEqual(
      [
        [
          "forms.cockpit_form_drafts.insert",
          "admin@tests.invalid",
          "cockpit-forms-api",
        ],
        [
          "forms.cockpit_form_drafts.update",
          "admin@tests.invalid",
          "cockpit-forms-api",
        ],
      ],
    );
    expect(audits[1].after).toEqual({
      kind: "client_notes",
      attempt: 1,
      state: "ready",
      provider: "deepseek",
      model: "deepseek-flash",
      response_id: null,
    });
    expect(JSON.stringify(audits)).not.toContain("Invented draft.");
    // Finish keeps a draft inside the columns' limits.
    const third = await begin({ ...p, inputSha256: sha("three") });
    await finish(third.id, {
      state: "failed",
      text: "t".repeat(9000),
      model: "m".repeat(90),
      reason: "r".repeat(300),
    });
    expect(
      (
        await q(
          "SELECT char_length(text) t, char_length(model) m, char_length(reason) r, finished_at IS NOT NULL done FROM public.cockpit_form_drafts WHERE id=$1",
          [third.id],
        )
      )[0],
    ).toEqual({ t: 8000, m: 80, r: 240, done: true });
  });

  test("begin and finish ask for the service role, the seat, and a well-formed request", async () => {
    const rec = await recording();
    const p = {
      taskId: A,
      recordingId: rec,
      kind: "todos",
      provider: "none",
      promptVersion: "checkin.todos.v1",
      inputSha256: sha("x"),
    };
    for (const [change, sentence] of [
      [{ actorEmail: "" }, "A draft names the seat that asked for it."],
      [{ formKey: "intake" }, "There is no form called intake."],
      [{ taskId: "not a card" }, "Choose a valid ClickUp client ID"],
      [
        { recordingId: "12" },
        "That recording is not in the cockpit yet. Check again in a minute.",
      ],
      [{ kind: "summary" }, "There is no draft called summary."],
      [{ provider: "openai" }, "Choose none, deepseek or anthropic."],
      [{ promptVersion: "v1" }, "That is not a prompt version."],
      [{ inputSha256: "abc" }, "The draft has no input hash."],
    ] as const)
      expect(await beginRefused({ ...p, ...change })).toMatchObject({
        code: "22023",
        message: sentence,
      });
    expect(await svcRefused(BEGIN_DRAFT, [JSON.stringify([p])])).toBe(
      "Send the draft as an object.",
    );
    const d = await begin(p);
    const FINISH =
      "SELECT public.cockpit_form_draft_finish($1::uuid,$2::jsonb) r";
    expect(
      await svcRefused(FINISH, [d.id, JSON.stringify({ state: "done" })]),
    ).toBe("Choose ready, failed, off or skipped.");
    expect(
      await svcRefused(FINISH, [RID(499), JSON.stringify({ state: "ready" })]),
    ).toBe("There is no draft with that ID.");
    expect(
      await svcRefused(FINISH, [
        d.id,
        JSON.stringify({ state: "ready", output: { text: "x".repeat(70000) } }),
      ]),
    ).toBe("The draft is too long to keep.");
    // A seat never reaches them, and a caller without the service claim is refused.
    expect(
      await refused(CSM, FINISH, [d.id, JSON.stringify({ state: "ready" })]),
    ).toContain("permission denied");
    expect(
      await ownerRefused(BEGIN_DRAFT, [
        JSON.stringify({ formKey: "checkin", ...p }),
      ]),
    ).toBe("This hours function needs the service role");
    expect(
      await ownerRefused("SELECT public.cockpit_forms_actor($1::uuid)", [CSM]),
    ).toBe("This hours function needs the service role");
    expect(
      await svc("SELECT public.cockpit_forms_actor($1::uuid) r", [CSM]),
    ).toEqual({
      actorId: CSM,
      email: "csm@tests.invalid",
      roles: ["csm"],
      ceo: false,
      admin: false,
      csm: true,
    });
    expect(
      await svc("SELECT public.cockpit_forms_actor($1::uuid) r", [CEO]),
    ).toMatchObject({ ceo: true, admin: false, csm: false });
    for (const who of [GONE, BUYER.replace("f1", "f9")])
      expect(
        await svcRefusal("SELECT public.cockpit_forms_actor($1::uuid)", [who]),
      ).toMatchObject({
        code: "42501",
        message: "Sign in to the cockpit first.",
      });
  });

  test("one grade per call: any card finds it by the recording, Draft again is refused, and no second grade row can exist", async () => {
    const rec = await recording();
    const g = {
      recordingId: rec,
      kind: "grade",
      provider: "anthropic",
      promptVersion: "checkin.grade.v1",
    };
    const first = await begin({ ...g, taskId: A, inputSha256: sha("a") });
    expect(first).toMatchObject({
      existing: false,
      state: "drafting",
      attempt: 1,
    });
    expect(await begin({ ...g, taskId: B, inputSha256: sha("b") })).toEqual({
      ...first,
      existing: true,
    });
    expect(
      await beginRefused({
        ...g,
        taskId: A,
        inputSha256: sha("a"),
        again: true,
      }),
    ).toMatchObject({ code: "22023", message: "A call is graded once." });
    const view = await finish(first.id, {
      state: "ready",
      output: {
        criteria: [{ name: "Rapport", score: 7, note: "Invented note." }],
        overall: "Invented feedback.",
        color: "Green",
        score: 7.1,
      },
    });
    // The window sees the score and the colour only.
    expect(view.output).toEqual({ score: 7.1, color: "Green" });
    expect(
      await begin({
        ...g,
        taskId: C,
        inputSha256: sha("c"),
        promptVersion: "checkin.grade.v2",
      }),
    ).toEqual({ ...first, existing: true, state: "ready" });
    expect(
      await ownerRefusal(
        `INSERT INTO public.cockpit_form_drafts(form_key,task_id,recording_id,kind,provider,prompt_version,input_sha256,state,created_by)
         VALUES('checkin',$1,$2,'grade','anthropic','checkin.grade.v1',$3,'drafting','server')`,
        [B, rec, sha("d")],
      ),
    ).toMatchObject({
      code: "23505",
      constraint: "cockpit_form_drafts_one_grade",
    });
  });

  test("a drafting attempt older than five minutes is settled failed first, so it never holds the call", async () => {
    const rec = await recording();
    const STALE = `INSERT INTO public.cockpit_form_drafts(form_key,task_id,recording_id,kind,attempt,provider,prompt_version,
        input_sha256,state,created_by,started_at)
      VALUES('checkin',$1,$2,$3,1,$4,$5,$6,'drafting','csm@tests.invalid',$7) RETURNING id`;
    const stale = (
      await q<{ id: string }>(STALE, [
        A,
        rec,
        "todos",
        "none",
        "checkin.todos.v1",
        sha("s"),
        ago(6),
      ])
    )[0].id;
    const p = {
      taskId: A,
      recordingId: rec,
      kind: "todos",
      provider: "none",
      promptVersion: "checkin.todos.v1",
      inputSha256: sha("s"),
    };
    // Settled, then shown for ten minutes like any failed draft of that input.
    expect(await begin(p)).toEqual({
      id: stale,
      existing: true,
      state: "failed",
      attempt: 1,
    });
    expect(
      (
        await q(
          "SELECT reason, finished_at IS NOT NULL done FROM public.cockpit_form_drafts WHERE id=$1",
          [stale],
        )
      )[0],
    ).toEqual({ reason: "The draft did not finish. Draft again.", done: true });
    const next = await begin({ ...p, again: true });
    expect(next).toMatchObject({
      existing: false,
      state: "drafting",
      attempt: 2,
    });
    // A drafting attempt under five minutes old is still running.
    expect(await begin(p)).toEqual({ ...next, existing: true });
    // A stale grade begun from another card no longer holds the one-grade index.
    const staleGrade = (
      await q<{ id: string }>(STALE, [
        B,
        rec,
        "grade",
        "anthropic",
        "checkin.grade.v1",
        sha("g"),
        ago(7),
      ])
    )[0].id;
    expect(
      await begin({
        taskId: A,
        recordingId: rec,
        kind: "grade",
        provider: "anthropic",
        promptVersion: "checkin.grade.v1",
        inputSha256: sha("g2"),
      }),
    ).toMatchObject({ existing: false, state: "drafting", attempt: 1 });
    expect(
      (
        await q("SELECT state FROM public.cockpit_form_drafts WHERE id=$1", [
          staleGrade,
        ])
      )[0].state,
    ).toBe("failed");
  });

  test("five ready or failed attempts is the limit, off and skipped attempts do not count, and a failed draft stands for ten minutes", async () => {
    const rec = await recording();
    const p = {
      taskId: B,
      recordingId: rec,
      kind: "client_notes",
      provider: "deepseek",
      promptVersion: "checkin.client_notes.v1",
    };
    const a1 = await begin({ ...p, inputSha256: sha("1") });
    await finish(a1.id, {
      state: "failed",
      reason: "The draft took too long. Draft again.",
    });
    expect(await begin({ ...p, inputSha256: sha("1") })).toEqual({
      ...a1,
      existing: true,
      state: "failed",
    });
    await q(
      "UPDATE public.cockpit_form_drafts SET finished_at = now() - interval '11 minutes' WHERE id=$1",
      [a1.id],
    );
    const a2 = await begin({ ...p, inputSha256: sha("1") });
    expect(a2).toMatchObject({ existing: false, attempt: 2 });
    await finish(a2.id, {
      state: "off",
      reason: "AI drafts are off: no DeepSeek key. Fill this by hand.",
    });
    const a3 = await begin({ ...p, inputSha256: sha("1") });
    expect(a3).toMatchObject({ existing: false, attempt: 3 });
    await finish(a3.id, { state: "skipped" });
    for (const n of [4, 5, 6, 7]) {
      const a = await begin({ ...p, inputSha256: sha(String(n)) });
      expect(a.attempt).toBe(n);
      await finish(a.id, {
        state: n === 7 ? "failed" : "ready",
        output: { text: `Draft ${n}.` },
      });
    }
    // Attempts 1 and 7 failed, 4 to 6 ready: five. Off (2) and skipped (3) do not count.
    for (const extra of [
      { inputSha256: sha("8") },
      { inputSha256: sha("7"), again: true },
    ])
      expect(await beginRefused({ ...p, ...extra })).toMatchObject({
        code: "22023",
        message: "Five drafts is the limit for this call.",
      });
    // The limit is per prompt version.
    expect(
      await begin({
        ...p,
        promptVersion: "checkin.client_notes.v2",
        inputSha256: sha("8"),
      }),
    ).toMatchObject({ existing: false, attempt: 1 });
  });

  test("the recap is begun only for sent notes, with their response at insert, and never answers another response", async () => {
    const rec = await recording();
    const p = {
      taskId: A,
      recordingId: rec,
      kind: "recap",
      provider: "anthropic",
      promptVersion: "checkin.recap.v1",
      inputSha256: sha("recap"),
    };
    const mine = RID(471);
    await fresh(CSM, A, mine);
    await save(CSM, mine, { call: fathomCall(rec), ...READY });
    const later = "The recap is drafted after you send the notes.";
    for (const responseId of [mine, undefined, "not-a-uuid", RID(479)])
      expect(await beginRefused({ ...p, responseId })).toMatchObject({
        code: "22023",
        message: later,
      });
    await submit(CSM, mine, null);
    const first = await begin({ ...p, responseId: mine });
    expect(first).toMatchObject({
      existing: false,
      state: "drafting",
      attempt: 1,
    });
    expect(
      (
        await q(
          "SELECT response_id FROM public.cockpit_form_drafts WHERE id=$1",
          [first.id],
        )
      )[0].response_id,
    ).toBe(mine);
    expect(await begin({ ...p, responseId: mine })).toEqual({
      ...first,
      existing: true,
    });
    // Another card, or another recording, is not this response's recap.
    expect(
      await beginRefused({ ...p, taskId: C, responseId: mine }),
    ).toMatchObject({
      message: later,
    });
    expect(
      await beginRefused({ ...p, recordingId: "900000101", responseId: mine }),
    ).toMatchObject({ message: later });
    // A second send on the same call (the CEO's shadow run) gets its own recap.
    const theirs = RID(472);
    await send(CEO, A, theirs, { call: fathomCall(rec), ...READY });
    const other = await begin({ ...p, responseId: theirs });
    expect(other).toMatchObject({
      existing: false,
      state: "drafting",
      attempt: 2,
    });
    await finish(first.id, {
      state: "ready",
      output: { message: "Mine." },
      text: "Mine.",
    });
    await finish(other.id, {
      state: "ready",
      output: { message: "Theirs." },
      text: "Theirs.",
    });
    const recaps = async (who: string, id: string) =>
      (
        await one(who, "SELECT public.cockpit_form_drafts_read($1::uuid) r", [
          id,
        ])
      ).drafts
        .filter((d: Row) => d.kind === "recap")
        .map((d: Row) => [d.attempt, d.output]);
    expect(await recaps(CSM, mine)).toEqual([
      [1, { message: "Mine.", text: "Mine." }],
    ]);
    expect(await recaps(CEO, theirs)).toEqual([
      [2, { message: "Theirs.", text: "Theirs." }],
    ]);
  });

  test("a ready recap carries its stored text, byte for byte, as output.text; a recap not ready and every other kind gain no text", async () => {
    await rolledBack(async () => {
      const rec = await recording();
      const id = RID(473);
      await send(CSM, A, id, { call: fathomCall(rec), ...READY });
      const p = {
        taskId: A,
        recordingId: rec,
        kind: "recap",
        provider: "anthropic",
        promptVersion: "checkin.recap.v1",
        inputSha256: sha("recap view"),
        responseId: id,
      };
      const recap = async () =>
        (
          await one(CSM, "SELECT public.cockpit_form_drafts_read($1::uuid) r", [
            id,
          ])
        ).drafts.find((d: Row) => d.kind === "recap");
      const first = await begin(p);
      expect(await recap()).toMatchObject({ state: "drafting", output: null });
      // As the door finishes it: the checked message, then the booking block.
      const output = {
        skip: false,
        message: "Invented recap.",
        checks: [{ rule: "booking_block", ok: true, note: null }],
      };
      const text = "Invented recap.\n\nInvented booking block.\n";
      expect(
        (await finish(first.id, { state: "ready", output, text })).output,
      ).toEqual({ ...output, text });
      expect((await recap()).output.text).toBe(text);
      // A refused recap keeps its text out of the window.
      const again = await begin({ ...p, again: true });
      const failed = await finish(again.id, {
        state: "failed",
        output,
        text,
        reason: "Invented refusal.",
      });
      expect([failed.state, failed.output]).toEqual(["failed", output]);
      const shown = await recap();
      expect([shown.attempt, shown.output]).toEqual([2, output]);
      // No other kind gains the stored text.
      for (const [kind, provider, out] of [
        ["todos", "none", { items: [], nextSteps: [] }],
        ["client_notes", "deepseek", { text: "From the draft." }],
      ] as const) {
        const b = await begin({
          ...p,
          kind,
          provider,
          promptVersion: `checkin.${kind}.v1`,
          responseId: undefined,
        });
        expect(
          (await finish(b.id, { state: "ready", output: out, text: "Stored." }))
            .output,
        ).toEqual(out);
      }
    });
  });
});

describe("the reads", () => {
  test("any client-success seat of the card reads a response, its effects and its drafts; the grade shows its score and colour only", async () => {
    const rec = await recording();
    // The grade was begun from another card's window: one grade per call.
    await readyDraft(C, rec, "grade", {
      criteria: [{ name: "Rapport", score: 7, note: "Invented note." }],
      overall: "Invented feedback.",
      color: "Green",
      score: 7.1,
    });
    await readyDraft(
      A,
      rec,
      "client_notes",
      { text: "First." },
      { input: "n1" },
    );
    await readyDraft(
      A,
      rec,
      "client_notes",
      { text: "Second." },
      { input: "n2" },
    );
    await readyDraft(A, rec, "todos", { items: [], nextSteps: [] });
    await readyDraft(
      B,
      rec,
      "todos",
      { items: [], nextSteps: [] },
      { input: "b" },
    );
    const id = RID(501);
    const sent = await send(CSM, A, id, { call: fathomCall(rec), ...READY });
    for (const who of [CSM, ADMIN, CEO]) {
      const r = await one(
        who,
        "SELECT public.cockpit_form_responses_read($1::uuid) r",
        [id],
      );
      expect(r.response).toEqual(sent.response);
      expect(r.effects).toEqual(sent.effects);
      expect(r.drafts.map((d: Row) => [d.kind, d.attempt, d.output])).toEqual([
        ["todos", 1, { items: [], nextSteps: [] }],
        ["client_notes", 2, { text: "Second." }],
        ["grade", 1, { score: 7.1, color: "Green" }],
      ]);
      expect(r.now).toEqual(expect.any(String));
    }
    expect(
      await refusal(
        CSM_B,
        "SELECT public.cockpit_form_responses_read($1::uuid)",
        [id],
      ),
    ).toMatchObject({
      code: "42501",
      message: "That client is not on your access list",
    });
    const drafts = await one(
      CSM,
      "SELECT public.cockpit_form_drafts_read($1::uuid) r",
      [id],
    );
    expect(drafts).toEqual({
      recordingId: rec,
      drafts: (
        await one(
          CSM,
          "SELECT public.cockpit_form_responses_read($1::uuid) r",
          [id],
        )
      ).drafts,
      now: expect.any(String),
    });
    // A call with no recording has no drafts.
    const none = RID(502);
    await send(CEO, A, none, { call: { kind: "none" }, ...READY });
    expect(
      await one(CEO, "SELECT public.cockpit_form_drafts_read($1::uuid) r", [
        none,
      ]),
    ).toEqual({ recordingId: null, drafts: [], now: expect.any(String) });
    expect(
      await refused(CSM, "SELECT public.cockpit_form_drafts_read($1::uuid)", [
        RID(599),
      ]),
    ).toBe("Open the notes from the client page.");
  });

  test("once the store says the call is gone or not a client call, every draft of it reads as skipped with no output; the rows stay as written", async () => {
    await rolledBack(async () => {
      const rec = await recording();
      await readyDraft(A, rec, "todos", {
        items: [{ text: "Invented action item." }],
        nextSteps: [],
      });
      await readyDraft(A, rec, "client_notes", { text: "Invented notes." });
      await readyDraft(A, rec, "grade", { score: 6.4, color: "Amber" });
      const id = RID(503);
      await send(CSM, A, id, { call: fathomCall(rec), ...READY });
      const read = async () => {
        const drafts = await one(
          CSM,
          "SELECT public.cockpit_form_drafts_read($1::uuid) r",
          [id],
        );
        const full = await one(
          ADMIN,
          "SELECT public.cockpit_form_responses_read($1::uuid) r",
          [id],
        );
        expect(full.drafts).toEqual(drafts.drafts);
        expect(drafts.recordingId).toBe(rec);
        return drafts.drafts.map((d: Row) => [
          d.kind,
          d.state,
          d.attempt,
          d.reason,
          d.output,
        ]);
      };
      const shown = [
        [
          "todos",
          "ready",
          1,
          null,
          { items: [{ text: "Invented action item." }], nextSteps: [] },
        ],
        ["client_notes", "ready", 1, null, { text: "Invented notes." }],
        ["grade", "ready", 1, null, { score: 6.4, color: "Amber" }],
      ];
      const hidden = shown.map(([kind, , attempt]) => [
        kind,
        "skipped",
        attempt,
        "That recording is not a client call.",
        null,
      ]);
      expect(await read()).toEqual(shown);
      const stored = await q(
        "SELECT id, state, output FROM public.cockpit_form_drafts WHERE recording_id=$1 ORDER BY kind",
        [rec],
      );
      // Deleted in Fathom (the gone pass), then reclassed by the store pass,
      // then its call row gone: each hides every draft, the grade too.
      for (const [sql, undo] of [
        [
          "UPDATE public.cockpit_fathom_meetings SET gone_at=now() WHERE recording_id=$1",
          "UPDATE public.cockpit_fathom_meetings SET gone_at=NULL WHERE recording_id=$1",
        ],
        [
          "UPDATE public.cockpit_fathom_meetings SET class='sales' WHERE recording_id=$1",
          "UPDATE public.cockpit_fathom_meetings SET class='candidate' WHERE recording_id=$1",
        ],
        [
          "UPDATE public.cockpit_fathom_meetings SET class='internal' WHERE recording_id=$1",
          "UPDATE public.cockpit_fathom_meetings SET class='candidate' WHERE recording_id=$1",
        ],
      ]) {
        await q(sql, [rec]);
        expect([sql, await read()]).toEqual([sql, hidden]);
        await q(undo, [rec]);
      }
      const row = await callRow(rec, { candidate: true });
      expect(await read()).toEqual(shown);
      await q("UPDATE public.cockpit_csm_calls SET status='gone' WHERE id=$1", [
        row,
      ]);
      expect(await read()).toEqual(hidden);
      // Nothing was rewritten or deleted: the view hides, the rows keep.
      expect(
        await q(
          "SELECT id, state, output FROM public.cockpit_form_drafts WHERE recording_id=$1 ORDER BY kind",
          [rec],
        ),
      ).toEqual(stored);
    });
  });
});

describe("the state guards", () => {
  const importResponse = (id: string, state: string, mode = "shadow") =>
    q(
      `INSERT INTO public.cockpit_form_responses(id,form_key,form_version,source,task_id,mode,state,created_by,submitted_at)
       VALUES($1,'checkin',1,'import',$2,$3,$4,'import',CASE WHEN $4 IN ('submitted','confirmed','legacy') THEN now() END)`,
      [id, B, mode, state],
    );

  test("a response keeps its form, card, mode and seat for good, its answers once sent, and moves only draft to submitted or void, submitted to confirmed", async () => {
    await rolledBack(async () => {
      const draft = RID(601);
      const sent = RID(602);
      await importResponse(draft, "draft");
      await importResponse(sent, "submitted");
      for (const [column, value] of [
        ["mode", "'live'"],
        ["task_id", `'${C}'`],
        ["form_key", "'kickoff'"],
        ["form_version", "2"],
        ["source", "'cockpit'"],
        ["created_by_id", `'${CEO}'`],
        ["created_at", "now() - interval '1 day'"],
        ["id", `'${RID(603)}'`],
      ])
        expect([
          column,
          await ownerRefused(
            `UPDATE public.cockpit_form_responses SET ${column} = ${value} WHERE id=$1`,
            [draft],
          ),
        ]).toEqual([
          column,
          "A response keeps its form, version, source, card, mode, seat and creation time",
        ]);
      for (const set of [
        `answers = '{"defcon":"Paused"}'::jsonb`,
        `answer_meta = '{"defcon":{}}'::jsonb`,
      ])
        expect(
          await ownerRefused(
            `UPDATE public.cockpit_form_responses SET ${set} WHERE id=$1`,
            [sent],
          ),
        ).toBe("Sent notes keep their answers");
      // A draft's answers change; updated_at follows every write.
      await q(
        `UPDATE public.cockpit_form_responses SET answers='{"defcon":"Happy"}'::jsonb, updated_at = now() - interval '1 day' WHERE id=$1`,
        [draft],
      );
      expect(
        (
          await q(
            "SELECT updated_at > now() - interval '1 minute' fresh FROM public.cockpit_form_responses WHERE id=$1",
            [draft],
          )
        )[0].fresh,
      ).toBe(true);
      const states = ["draft", "submitted", "confirmed", "legacy", "void"];
      const legal = new Set([
        "draft>submitted",
        "draft>void",
        "submitted>confirmed",
      ]);
      let n = 610;
      for (const from of states)
        for (const to of states) {
          if (from === to) continue;
          const id = RID(n++);
          await importResponse(id, from);
          const move =
            "UPDATE public.cockpit_form_responses SET state=$2, submitted_at=coalesce(submitted_at, now()) WHERE id=$1";
          if (legal.has(`${from}>${to}`)) {
            await q(move, [id, to]);
            expect([from, to, await stateOf(id)]).toEqual([from, to, to]);
          } else
            expect([from, to, await ownerRefused(move, [id, to])]).toEqual([
              from,
              to,
              `A response goes from ${from} to ${to} only through the cockpit`,
            ]);
        }
    });
  });

  test("an effect: only the cockpit's may be planned or later, it keeps its identity, and its state moves only as written", async () => {
    await rolledBack(async () => {
      const response = RID(640);
      await importResponse(response, "submitted");
      const INSERT = `INSERT INTO public.cockpit_form_effects(response_id,form_key,effect_key,dedupe_key,owner,delivery,state)
        VALUES($1,'checkin',$2,$3,$4,$5,$6) RETURNING id`;
      let n = 0;
      const row = (
        owner: string,
        state: string,
        delivery = "clickup_queue",
      ) => {
        const key = `e_${n++}`;
        return [response, key, `${response}:${key}`, owner, delivery, state];
      };
      const add = async (
        owner: string,
        state: string,
        delivery = "clickup_queue",
      ) => (await q<{ id: string }>(INSERT, row(owner, state, delivery)))[0].id;
      // Shadow and Make effects are dry_run or skipped, whatever writes them.
      for (const owner of ["shadow", "make"]) {
        for (const state of [
          "planned",
          "queued",
          "delivered",
          "failed",
          "unknown",
        ])
          expect(await ownerRefused(INSERT, row(owner, state))).toBe(
            `Only an effect the cockpit owns can be ${state}`,
          );
        const dry = await add(owner, "dry_run");
        expect(
          await ownerRefused(
            "UPDATE public.cockpit_form_effects SET state='queued' WHERE id=$1",
            [dry],
          ),
        ).toBe("Only an effect the cockpit owns can be queued");
      }
      // The table CHECK holds on its own.
      await q(
        "ALTER TABLE public.cockpit_form_effects DISABLE TRIGGER cockpit_form_effects_guard",
      );
      expect(
        await ownerRefusal(INSERT, row("shadow", "planned")),
      ).toMatchObject({ code: "23514" });
      await q(
        "ALTER TABLE public.cockpit_form_effects ENABLE TRIGGER cockpit_form_effects_guard",
      );
      // The cockpit's own start planned, dry_run or skipped.
      for (const state of ["queued", "delivered", "failed", "unknown"])
        expect(await ownerRefused(INSERT, row("cockpit", state))).toBe(
          "An effect starts planned, dry_run or skipped",
        );
      // Its identity: a dry_run of the cockpit's own, so only this rule speaks.
      const fixed = await add("cockpit", "dry_run");
      for (const [column, value] of [
        ["owner", "'shadow'"],
        ["delivery", "'sql'"],
        ["effect_key", "'other_key'"],
        ["dedupe_key", "'x:y'"],
        ["form_key", "'kickoff'"],
        ["created_at", "now() - interval '1 day'"],
        ["response_id", `'${RID(699)}'`],
      ])
        expect([
          column,
          await ownerRefused(
            `UPDATE public.cockpit_form_effects SET ${column} = ${value} WHERE id=$1`,
            [fixed],
          ),
        ]).toEqual([
          column,
          "An effect keeps its response, key, owner and delivery",
        ]);
      // Every move of a cockpit effect, from each state reached the legal way.
      const path: Record<string, string[]> = {
        planned: [],
        dry_run: [],
        skipped: [],
        queued: ["queued"],
        failed: ["failed"],
        delivered: ["queued", "delivered"],
        unknown: ["queued", "unknown"],
      };
      const reach = async (state: string, delivery = "clickup_queue") => {
        const start = ["dry_run", "skipped"].includes(state)
          ? state
          : "planned";
        const id = await add("cockpit", start, delivery);
        for (const step of path[state])
          await q(
            "UPDATE public.cockpit_form_effects SET state=$2 WHERE id=$1",
            [id, step],
          );
        return id;
      };
      const legal = new Set([
        "planned>queued",
        "planned>skipped",
        "planned>failed",
        "queued>delivered",
        "queued>failed",
        "queued>unknown",
        "queued>skipped",
        "unknown>delivered",
        "unknown>failed",
      ]);
      const move =
        "UPDATE public.cockpit_form_effects SET state=$2 WHERE id=$1";
      for (const from of Object.keys(path))
        for (const to of Object.keys(path)) {
          if (from === to) continue;
          const id = await reach(from);
          if (legal.has(`${from}>${to}`)) {
            await q(move, [id, to]);
            const row = (
              await q(
                "SELECT state, settled_at IS NOT NULL settled FROM public.cockpit_form_effects WHERE id=$1",
                [id],
              )
            )[0];
            expect([from, to, row]).toEqual([
              from,
              to,
              { state: to, settled: ["delivered", "skipped"].includes(to) },
            ]);
          } else
            expect([from, to, await ownerRefused(move, [id, to])]).toEqual([
              from,
              to,
              `An effect goes from ${from} to ${to} only through the cockpit`,
            ]);
        }
      // planned to delivered only for an effect the submit applies in SQL.
      const sql = await reach("planned", "sql");
      await q(move, [sql, "delivered"]);
      // failed to queued only while a person fixes it.
      const failed = await reach("failed");
      await q("SELECT set_config('cockpit.forms_fix','on',true)");
      await q(move, [failed, "queued"]);
      await q("SELECT set_config('cockpit.forms_fix','',true)");
      expect(
        (
          await q("SELECT state FROM public.cockpit_form_effects WHERE id=$1", [
            failed,
          ])
        )[0].state,
      ).toBe("queued");
      // dry_run and skipped are settled the moment they are written.
      for (const state of ["dry_run", "skipped"])
        expect(
          (
            await q(
              "SELECT settled_at IS NOT NULL s FROM public.cockpit_form_effects WHERE id=$1",
              [await reach(state)],
            )
          )[0].s,
        ).toBe(true);
    });
  });

  test("a draft: started drafting, off or skipped, finished once, never rewritten, adopted once", async () => {
    await rolledBack(async () => {
      const response = RID(660);
      await importResponse(response, "submitted");
      const INSERT = `INSERT INTO public.cockpit_form_drafts(form_key,task_id,recording_id,kind,attempt,provider,prompt_version,
          input_sha256,state,created_by)
        VALUES('checkin',$1,'900000998','client_notes',$2,'deepseek','checkin.client_notes.v1',$3,$4,'server') RETURNING id`;
      let n = 1;
      const add = async (state: string) =>
        (await q<{ id: string }>(INSERT, [B, n++, sha(`d${n}`), state]))[0].id;
      for (const state of ["ready", "failed"])
        expect(await ownerRefused(INSERT, [B, n++, sha("x"), state])).toBe(
          "A draft starts drafting, off or skipped",
        );
      const off = await add("off");
      expect(
        (
          await q(
            "SELECT finished_at IS NOT NULL done FROM public.cockpit_form_drafts WHERE id=$1",
            [off],
          )
        )[0].done,
      ).toBe(true);
      expect(
        await ownerRefused(
          "UPDATE public.cockpit_form_drafts SET state='ready' WHERE id=$1",
          [off],
        ),
      ).toBe("A draft goes from off to ready only once");
      const draft = await add("drafting");
      for (const [column, value] of [
        ["kind", "'todos'"],
        ["attempt", "19"],
        ["input_sha256", `'${sha("other")}'`],
        ["task_id", `'${C}'`],
        ["recording_id", "'900000997'"],
        ["prompt_version", "'checkin.client_notes.v2'"],
        ["created_by", "'someone@tests.invalid'"],
        ["started_at", "now() - interval '1 hour'"],
      ])
        expect([
          column,
          await ownerRefused(
            `UPDATE public.cockpit_form_drafts SET ${column} = ${value} WHERE id=$1`,
            [draft],
          ),
        ]).toEqual([column, "A draft keeps its call, kind, attempt and input"]);
      await q(
        `UPDATE public.cockpit_form_drafts SET state='ready', output='{"text":"Invented."}'::jsonb, text='Invented.', model='deepseek-flash' WHERE id=$1`,
        [draft],
      );
      expect(
        await ownerRefused(
          "UPDATE public.cockpit_form_drafts SET state='failed' WHERE id=$1",
          [draft],
        ),
      ).toBe("A draft goes from ready to failed only once");
      for (const set of [
        `output='{"text":"Rewritten."}'::jsonb`,
        "text='Rewritten.'",
        "model='another-model'",
        "provider='anthropic'",
      ])
        expect(
          await ownerRefused(
            `UPDATE public.cockpit_form_drafts SET ${set} WHERE id=$1`,
            [draft],
          ),
        ).toBe("A draft is never rewritten");
      // Adopted once: response, final and edited are set once and kept.
      await q(
        `UPDATE public.cockpit_form_drafts SET response_id=$2, final='"Invented."'::jsonb, edited=false WHERE id=$1`,
        [draft, response],
      );
      for (const set of [
        `response_id='${RID(301)}'`,
        `final='"Changed."'::jsonb`,
        "edited=true",
      ])
        expect(
          await ownerRefused(
            `UPDATE public.cockpit_form_drafts SET ${set} WHERE id=$1`,
            [draft],
          ),
        ).toBe("A draft is adopted once");
    });
  });

  test("a message: starts a draft, moves only as the outbox allows, keeps its text once approved", async () => {
    await rolledBack(async () => {
      const INSERT = `INSERT INTO public.cockpit_client_messages(dedupe_key,task_id,kind,body,body_sha256,state)
        VALUES($1,$2,'recap_checkin','Invented recap.',$3,$4) RETURNING id`;
      let n = 0;
      expect(
        await ownerRefused(INSERT, [`m-${n++}`, A, sha("b"), "approved"]),
      ).toBe("A message starts as a draft");
      const path: Record<string, string[]> = {
        draft: [],
        approved: ["approved"],
        claimed: ["approved", "claimed"],
        sending: ["approved", "claimed", "sending"],
        sent: ["approved", "claimed", "sending", "sent"],
        unknown: ["approved", "claimed", "sending", "unknown"],
        failed: ["approved", "claimed", "sending", "failed"],
        refused: ["approved", "claimed", "refused"],
        skipped: ["skipped"],
      };
      const move = `UPDATE public.cockpit_client_messages
          SET state=$2, claim_token=coalesce(claim_token, gen_random_uuid()),
              provider_id=CASE WHEN $2='sent' THEN 'wamid.TEST' ELSE provider_id END
        WHERE id=$1`;
      const reach = async (state: string) => {
        const id = (
          await q<{ id: string }>(INSERT, [`m-${n++}`, A, sha("b"), "draft"])
        )[0].id;
        for (const step of path[state]) await q(move, [id, step]);
        return id;
      };
      const legal = new Set([
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
      ]);
      for (const from of Object.keys(path))
        for (const to of Object.keys(path)) {
          if (from === to) continue;
          const id = await reach(from);
          if (legal.has(`${from}>${to}`)) await q(move, [id, to]);
          else
            expect([from, to, await ownerRefused(move, [id, to])]).toEqual([
              from,
              to,
              `A message goes from ${from} to ${to} only through the sender`,
            ]);
        }
      // unknown to failed only while a person fixes it.
      const unknown = await reach("unknown");
      await q("SELECT set_config('cockpit.forms_fix','on',true)");
      await q(move, [unknown, "failed"]);
      await q("SELECT set_config('cockpit.forms_fix','',true)");
      // The text is fixed once approved.
      const draft = await reach("draft");
      await q(
        "UPDATE public.cockpit_client_messages SET body='Edited recap.' WHERE id=$1",
        [draft],
      );
      const approved = await reach("approved");
      for (const set of [
        "body='Edited recap.'",
        `body_sha256='${sha("other")}'`,
      ])
        expect(
          await ownerRefused(
            `UPDATE public.cockpit_client_messages SET ${set} WHERE id=$1`,
            [approved],
          ),
        ).toBe("An approved message keeps its text");
    });
  });

  test("a read-back is written once, both columns together, only on a sent message, and never changes", async () => {
    await rolledBack(async () => {
      const INSERT = `INSERT INTO public.cockpit_client_messages(dedupe_key,task_id,kind,body,body_sha256,state,read_back_at,read_back)
        VALUES($1,$2,'recap_checkin','Invented recap.',$3,'draft',$4,$5::jsonb) RETURNING id`;
      const receipt = JSON.stringify({
        by: "message_id",
        providerId: "wamid.TEST",
        at: ago(1),
      });
      expect(
        await ownerRefused(INSERT, ["rb-0", A, sha("b"), ago(1), receipt]),
      ).toBe("A message is read back only after it is sent");
      const add = async (key: string) =>
        (await q<{ id: string }>(INSERT, [key, A, sha("b"), null, null]))[0].id;
      const step = (id: string, state: string) =>
        q(
          "UPDATE public.cockpit_client_messages SET state=$2, claim_token=coalesce(claim_token, gen_random_uuid()) WHERE id=$1",
          [id, state],
        );
      const READ =
        "UPDATE public.cockpit_client_messages SET read_back_at=now(), read_back=$2::jsonb WHERE id=$1";
      const draft = await add("rb-1");
      expect(await ownerRefused(READ, [draft, receipt])).toBe(
        "A message is read back only after it is sent",
      );
      const sending = await add("rb-2");
      for (const s of ["approved", "claimed", "sending"])
        await step(sending, s);
      expect(await ownerRefused(READ, [sending, receipt])).toBe(
        "A message is read back only after it is sent",
      );
      // Sent and read back in one write.
      await q(
        "UPDATE public.cockpit_client_messages SET state='sent', provider_id='wamid.TEST', read_back_at=now(), read_back=$2::jsonb WHERE id=$1",
        [sending, receipt],
      );
      // Both columns or neither.
      const sent = await add("rb-3");
      for (const s of ["approved", "claimed", "sending"]) await step(sent, s);
      await q(
        "UPDATE public.cockpit_client_messages SET state='sent', provider_id='wamid.TEST' WHERE id=$1",
        [sent],
      );
      expect(
        await ownerRefusal(
          "UPDATE public.cockpit_client_messages SET read_back_at=now() WHERE id=$1",
          [sent],
        ),
      ).toMatchObject({ code: "23514" });
      await q(READ, [sent, receipt]);
      for (const set of [
        "read_back_at = read_back_at + interval '1 minute'",
        `read_back = '{"by":"body_sha256"}'::jsonb`,
        "read_back_at = NULL, read_back = NULL",
      ])
        expect(
          await ownerRefused(
            `UPDATE public.cockpit_client_messages SET ${set} WHERE id=$1`,
            [sent],
          ),
        ).toBe("A read-back is kept as it was written");
    });
  });

  test("nothing in the six tables is ever deleted or truncated, and the service role cannot even try", async () => {
    await rolledBack(async () => {
      await q(
        `INSERT INTO public.cockpit_client_messages(dedupe_key,task_id,kind,body,body_sha256)
         VALUES('del-1',$1,'recap_checkin','Invented recap.',$2)`,
        [A, sha("b")],
      );
      for (const table of FORMS_TABLES) {
        expect(
          await count(`SELECT count(*) n FROM public.${table}`),
        ).toBeGreaterThan(0);
        for (const statement of [
          `DELETE FROM public.${table}`,
          `TRUNCATE public.${table} CASCADE`,
        ])
          expect([statement, await ownerRefusal(statement)]).toEqual([
            statement,
            expect.objectContaining({
              code: "55000",
              message: "Forms records are never deleted",
            }),
          ]);
        expect(await svcRefused(`DELETE FROM public.${table}`)).toContain(
          "permission denied",
        );
      }
    });
  });
});

// A planner with the shape of 7.1's two SQL effects, for the executor. It
// always offers ownCall, so the executor's own rule (only for No recording)
// is what is tested, and it skips call_match for a recording already on the
// card, as 7.1 does.
const SQL_PLAN = `
  CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_plan(p_response public.cockpit_form_responses)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
  DECLARE v_call jsonb := p_response.answers->'call'; v_kind text := v_call->>'kind'; v_on boolean;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.cockpit_csm_calls c WHERE c.source = 'fathom'
                     AND c.source_id = v_call->>'recordingId' AND c.task_id = p_response.task_id) INTO v_on;
    RETURN jsonb_build_array(
      jsonb_build_object('effect', 'call_form', 'delivery', 'sql', 'state', 'planned', 'reason', NULL,
        'plan', jsonb_build_object(
          'row', jsonb_build_object('token', 'cockpit:' || p_response.id, 'form_id', 'cockpit-checkin',
            'form_kind', 'checkin', 'task_id', p_response.task_id, 'typed_client', NULL, 'matched_by', 'cockpit_form',
            'submitted_at', p_response.submitted_at,
            'answers', jsonb_build_array(jsonb_build_object('ref', 'c484f390-9695-4ffa-9693-9cc219592713',
              'type', 'short_text', 'title', 'Client ID', 'value', p_response.task_id)),
            'hidden', '{}'::jsonb, 'recording_url', v_call->>'shareUrl', 'linked_call_id', NULL),
          'linkAfterMatch', v_kind = 'fathom' AND v_call->'callId' = 'null'::jsonb,
          'ownCall', jsonb_build_object('source', 'checkin_form', 'source_id', 'cockpit:' || p_response.id,
            'task_id', p_response.task_id, 'client_name', p_response.client_name, 'match_method', 'form_task_id',
            'match_confidence', 1, 'kind', 'checkin', 'title', 'Check-in call (1-1 notes in the cockpit)',
            'starts_at', p_response.submitted_at, 'status', 'held', 'provider_status', 'notes sent'),
          'lines', jsonb_build_array('Would save the notes where the client brief and Today read them.'))),
      jsonb_build_object('effect', 'call_match', 'delivery', 'sql',
        'state', CASE WHEN v_kind = 'fathom' AND NOT v_on THEN 'planned' ELSE 'skipped' END,
        'reason', CASE WHEN v_kind <> 'fathom' THEN 'No recording to put on this client.'
                       WHEN v_on THEN 'The recording is already on this client.' END,
        'plan', jsonb_build_object('recordingId', v_call->>'recordingId', 'callId', v_call->'callId',
          'taskId', p_response.task_id, 'method', 'manual',
          'lines', jsonb_build_array('Would put this recording on ' || p_response.client_name || '.'))));
  END $$;`;

describe("the SQL-effect executor (2b; tested with the owners flipped to the cockpit)", () => {
  async function cockpitOwnsTheSqlEffects() {
    await switchTo("native");
    await q(`UPDATE public.cockpit_forms SET effects = (
        SELECT jsonb_agg(CASE WHEN e->>'key' IN ('call_form','call_match') THEN jsonb_set(e, '{owner}', '"cockpit"') ELSE e END
                         ORDER BY o)
          FROM jsonb_array_elements(effects) WITH ORDINALITY x(e, o)) WHERE key='checkin'`);
    await q(SQL_PLAN);
  }
  const formRows = (token: string) =>
    q(
      "SELECT form_id, form_kind, task_id, matched_by, linked_call_id, answers, recording_url FROM public.cockpit_csm_call_forms WHERE token=$1",
      [token],
    );
  const acmeBooking = async () =>
    (
      await q<{ id: number }>(
        "SELECT id FROM public.cockpit_csm_calls WHERE source='ghl_appointment' AND source_id='appt-acme-1'",
      )
    )[0].id;

  test("a same-room recording with no call row: call_match attaches it and links the booking, then call_form lands once under that booking", async () => {
    await rolledBack(async () => {
      await cockpitOwnsTheSqlEffects();
      const booked = await acmeBooking();
      const id = RID(701);
      const token = `cockpit:${id}`;
      const audits = await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='csm.recording_attached'",
      );
      const sent = await send(CSM, A, id, {
        call: fathomCall("900000106", "same_room"),
        ...READY,
      });
      const byKey = Object.fromEntries(
        sent.effects.map((e: Row) => [e.key, e]),
      );
      expect(byKey.call_match).toMatchObject({
        owner: "cockpit",
        state: "delivered",
      });
      expect(byKey.call_form).toMatchObject({
        owner: "cockpit",
        state: "delivered",
      });
      const rec = (
        await q(
          `SELECT id, task_id, client_name, match_method, match_confidence::float c, linked_call_id, kind, candidate,
                  settled_reason, room, status, host_email
             FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id='900000106'`,
        )
      )[0];
      expect(rec).toEqual({
        id: rec.id,
        task_id: A,
        client_name: "Acme Interiors",
        match_method: "manual",
        c: 1,
        linked_call_id: booked,
        kind: "checkin",
        candidate: false,
        settled_reason: null,
        room: "zoom:12345678901",
        status: "held",
        host_email: "csm@tests.invalid",
      });
      // call_match ran first: call_form found the row it made and its booking.
      const effects = await q(
        "SELECT effect_key, receipt, delivery_ref FROM public.cockpit_form_effects WHERE response_id=$1 ORDER BY effect_key",
        [id],
      );
      expect(effects).toEqual([
        {
          effect_key: "call_form",
          receipt: { token, linkedCallId: booked },
          delivery_ref: token,
        },
        {
          effect_key: "call_match",
          receipt: { callId: rec.id },
          delivery_ref: String(rec.id),
        },
      ]);
      expect(await formRows(token)).toEqual([
        {
          form_id: "cockpit-checkin",
          form_kind: "checkin",
          task_id: A,
          matched_by: "cockpit_form",
          linked_call_id: booked,
          answers: [
            {
              ref: "c484f390-9695-4ffa-9693-9cc219592713",
              type: "short_text",
              title: "Client ID",
              value: A,
            },
          ],
          recording_url: "https://fathom.video/share/test-900000106",
        },
      ]);
      // The ownCall the plan offered is used only for No recording.
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_csm_calls WHERE source='checkin_form' AND source_id=$1",
          [token],
        ),
      ).toBe(0);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='csm.recording_attached'",
        ),
      ).toBe(audits + 1);
      // The client page shows one call: the booking, with the notes as its form.
      const timeline = await one(
        CSM,
        "SELECT public.cockpit_csm_client_timeline($1) r",
        [A],
      );
      const shown = timeline.calls.filter((c: Row) =>
        [booked, rec.id].includes(c.id),
      );
      expect(shown.map((c: Row) => [c.id, c.kind, c.form?.token])).toEqual([
        [booked, "checkin", token],
      ]);
      // Applying again, or the same send again, writes nothing more.
      await q("SELECT public.cockpit_form_apply_sql_effects($1::uuid)", [id]);
      expect((await submit(CSM, id, null)).duplicate).toBe(true);
      expect(await formRows(token)).toHaveLength(1);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_csm_match_audit WHERE item_ref=$1",
          [String(rec.id)],
        ),
      ).toBe(1);
    });
  });

  test("a booked call links the booking; No recording makes its own call row; a recording already on the card keeps its row's link", async () => {
    await rolledBack(async () => {
      await cockpitOwnsTheSqlEffects();
      // A booked call with no recording.
      const held = await booking(A, { start: ago(300), end: ago(270) });
      const b = await send(ADMIN, A, RID(711), {
        call: { kind: "booking", callId: held },
        ...READY,
      });
      expect(
        b.effects
          .filter((e: Row) => ["call_form", "call_match"].includes(e.key))
          .map((e: Row) => [e.key, e.state, e.reason]),
      ).toEqual([
        ["call_form", "delivered", null],
        ["call_match", "skipped", "No recording to put on this client."],
      ]);
      expect((await formRows(`cockpit:${RID(711)}`))[0].linked_call_id).toBe(
        held,
      );
      // No recording: the notes get their own call row.
      await send(CEO, A, RID(712), { call: { kind: "none" }, ...READY });
      const own = await q(
        `SELECT id, task_id, client_name, match_method, kind, title, status, provider_status
           FROM public.cockpit_csm_calls WHERE source='checkin_form' AND source_id=$1`,
        [`cockpit:${RID(712)}`],
      );
      expect(own).toEqual([
        {
          id: own[0]?.id,
          task_id: A,
          client_name: "Acme Interiors",
          match_method: "form_task_id",
          kind: "checkin",
          title: "Check-in call (1-1 notes in the cockpit)",
          status: "held",
          provider_status: "notes sent",
        },
      ]);
      expect((await formRows(`cockpit:${RID(712)}`))[0].linked_call_id).toBe(
        own[0].id,
      );
      // A recording already on this card whose booking is gone: its own row.
      const gone = await booking(A, { start: ago(800), status: "gone" });
      const rec = await recording({ cls: "client" });
      const row = await callRow(rec, {
        task: A,
        method: "invitee_email",
        linked: gone,
        kind: "checkin",
      });
      const r = await send(CSM, A, RID(713), {
        call: fathomCall(rec, "matched"),
        ...READY,
      });
      expect(r.effects.find((e: Row) => e.key === "call_match")).toMatchObject({
        state: "skipped",
        reason: "The recording is already on this client.",
      });
      expect((await formRows(`cockpit:${RID(713)}`))[0].linked_call_id).toBe(
        row,
      );
      for (const id of [RID(711), RID(713)])
        expect(
          await count(
            "SELECT count(*) n FROM public.cockpit_csm_calls WHERE source='checkin_form' AND source_id=$1",
            [`cockpit:${id}`],
          ),
        ).toBe(0);
    });
  });

  test("an effect the executor cannot apply is failed with the sentence; the notes still land, linked to no call of another card", async () => {
    await rolledBack(async () => {
      const id = RID(721);
      await q(
        `INSERT INTO public.cockpit_form_responses(id,form_key,form_version,source,task_id,client_name,mode,state,answers,created_by,submitted_at)
         VALUES($1,'checkin',1,'import',$2,'Cedar Homes','live','submitted',$3::jsonb,'import',now())`,
        [
          id,
          C,
          JSON.stringify({
            call: { kind: "fathom", recordingId: "900000103" },
          }),
        ],
      );
      for (const key of ["call_match", "call_form"])
        await q(
          `INSERT INTO public.cockpit_form_effects(response_id,form_key,effect_key,dedupe_key,owner,delivery,plan,state)
           VALUES($1,'checkin',$2,$3,'cockpit','sql',$4::jsonb,'planned')`,
          [
            id,
            key,
            `${id}:${key}`,
            JSON.stringify(
              key === "call_form" ? { row: {} } : { recordingId: "900000103" },
            ),
          ],
        );
      await q("SELECT public.cockpit_form_apply_sql_effects($1::uuid)", [id]);
      const rows = await q(
        "SELECT effect_key, state, reason, settled_at IS NOT NULL settled FROM public.cockpit_form_effects WHERE response_id=$1 ORDER BY effect_key",
        [id],
      );
      expect(rows).toEqual([
        {
          effect_key: "call_form",
          state: "delivered",
          reason: null,
          settled: true,
        },
        {
          effect_key: "call_match",
          state: "failed",
          // An imported row has no seat, so the other client is not named.
          reason:
            "That recording is on another client. If that is wrong, ask an admin to move it.",
          settled: false,
        },
      ]);
      // The notes are on the card, linked to no call: the recording's row is Acme's.
      expect(
        (
          await q(
            "SELECT task_id, linked_call_id FROM public.cockpit_csm_call_forms WHERE token=$1",
            [`cockpit:${id}`],
          )
        )[0],
      ).toEqual({ task_id: C, linked_call_id: null });
      // The recording stays where it was.
      expect(
        (
          await q(
            "SELECT task_id FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id='900000103'",
          )
        )[0].task_id,
      ).toBe(A);
    });
  });

  test("cockpit_csm_attach_recording: another client's recording is refused, named only to a seat that may see it; a recording the save's tie rule refuses for the submitting seat is refused; a candidate is put on the card with its booking by time and no hints, out of the queue, audited", async () => {
    await rolledBack(async () => {
      const attach =
        "SELECT public.cockpit_csm_attach_recording($1,$2,$3,$4::jsonb) r";
      const who = JSON.stringify({ actorId: CSM, email: "csm@tests.invalid" });
      expect(
        await ownerRefusal(attach, [C, "Cedar Homes", "900000103", who]),
      ).toMatchObject({
        code: "22023",
        message:
          "That recording is on Acme Interiors. If that is wrong, ask an admin to move it.",
      });
      // Beta Build's own seat may not see Acme; an admin may.
      for (const [seat, email, name] of [
        [CSM_B, "csm-b@tests.invalid", "another client"],
        [ADMIN, "admin@tests.invalid", "Acme Interiors"],
      ])
        expect(
          await ownerRefused(attach, [
            B,
            "Beta Build",
            "900000103",
            JSON.stringify({ actorId: seat, email }),
          ]),
        ).toBe(
          `That recording is on ${name}. If that is wrong, ask an admin to move it.`,
        );
      expect(
        await ownerRefused(attach, [C, "Cedar Homes", "999999999", who]),
      ).toBe(
        "That recording is not in the cockpit yet. Check again in a minute.",
      );
      expect(
        await ownerRefused(attach, [C, "Cedar Homes", "900000105", who]),
      ).toBe("That recording is a team meeting, not a client call.");
      // The CEO's Sales-team call and a closer's, on no client and tied to
      // none: refused, with no call row made and the existing row unplaced.
      const outside =
        "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
      const sales = await recording({
        by: "aziz@maharamedia.com",
        team: "Sales",
        cls: "client",
      });
      const closer = await recording({
        by: "closer@tests.invalid",
        team: "Sales",
        cls: "client",
      });
      await callRow(closer, { candidate: true });
      for (const rec of [sales, closer])
        expect([
          rec,
          await ownerRefused(attach, [C, "Cedar Homes", rec, who]),
        ]).toEqual([rec, outside]);
      expect(
        await q(
          "SELECT source_id, task_id FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id = ANY($1::text[]) ORDER BY source_id",
          [[sales, closer]],
        ),
      ).toEqual([{ source_id: closer, task_id: null }]);
      // Rule 4 for the submitting seat: the CEO's own untied call attaches for
      // the CEO's actor and stays refused for the CSM's; an actor whose id is
      // malformed is no seat, whatever its email says.
      const own = await recording({
        by: "aziz@maharamedia.com",
        team: "Sales",
        cls: "client",
      });
      const ceo = JSON.stringify({
        actorId: CEO,
        email: "aziz@maharamedia.com",
      });
      for (const actor of [
        who,
        JSON.stringify({
          actorId: "not-a-uuid",
          email: "aziz@maharamedia.com",
        }),
      ])
        expect(await ownerRefused(attach, [C, "Cedar Homes", own, actor])).toBe(
          outside,
        );
      expect(
        (await q<{ r: Row }>(attach, [C, "Cedar Homes", own, ceo]))[0].r,
      ).toMatchObject({ ok: true, taskId: C, inserted: true });
      expect(
        (
          await q(
            "SELECT task_id, match_method FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id=$1",
            [own],
          )
        )[0],
      ).toEqual({ task_id: C, match_method: "manual" });
      // The same Sales-team call in the room of Cedar's booking is tied.
      const room = "zoom:44400011122";
      await booking(C, { start: ago(110), room });
      await q(
        "UPDATE public.cockpit_fathom_meetings SET room=$2 WHERE recording_id=$1",
        [sales, room],
      );
      expect(
        (await q<{ r: Row }>(attach, [C, "Cedar Homes", sales, who]))[0].r,
      ).toMatchObject({ ok: true, taskId: C, inserted: true });
      // A set-aside candidate in the queue, recorded 10 minutes after a Beta
      // Build onboarding booking in another room.
      const start = ago(130);
      const rec = await recording({ start, room: "meet:kln-opqr-stu" });
      const onboarding = await booking(B, {
        start: ago(140),
        kind: "onboarding",
        room: "meet:vwx-yzab-cde",
      });
      const row = await callRow(rec, {
        candidate: false,
        settled: "not_client",
        start,
      });
      // Hints left from before A7.13: the attach clears them in its own update.
      await q(
        `UPDATE public.cockpit_csm_calls SET hints='[{"taskId":"${A}","clientName":"Acme Interiors","why":"near_booking"}]'::jsonb WHERE id=$1`,
        [row],
      );
      await q(
        "INSERT INTO public.cockpit_csm_unmatched(item_kind,item_ref,title,at,reason,host_email) VALUES('call',$1,'Impromptu',$2,'Invented reason.','csm@tests.invalid')",
        [String(row), start],
      );
      const r = await q<{ r: Row }>(attach, [B, "Beta Build", rec, who]);
      expect(r[0].r).toEqual({
        ok: true,
        callId: row,
        taskId: B,
        linkedCallId: onboarding,
        kind: "onboarding",
        inserted: false,
      });
      expect(
        (
          await q(
            "SELECT task_id, match_method, candidate, settled_reason, linked_call_id, kind, hints FROM public.cockpit_csm_calls WHERE id=$1",
            [row],
          )
        )[0],
      ).toEqual({
        task_id: B,
        match_method: "manual",
        candidate: false,
        settled_reason: null,
        linked_call_id: onboarding,
        kind: "onboarding",
        hints: [],
      });
      // An unplaced candidate with hints and no queue row: the same.
      const loose = await recording({ start: ago(400) });
      const looseRow = await callRow(loose, {
        candidate: true,
        start: ago(400),
      });
      await q(
        `UPDATE public.cockpit_csm_calls SET hints='[{"taskId":"${C}","clientName":"Cedar Homes","why":"title"}]'::jsonb WHERE id=$1`,
        [looseRow],
      );
      await q(attach, [C, "Cedar Homes", loose, who]);
      expect(
        (
          await q(
            "SELECT task_id, candidate, hints FROM public.cockpit_csm_calls WHERE id=$1",
            [looseRow],
          )
        )[0],
      ).toEqual({ task_id: C, candidate: false, hints: [] });
      expect(
        (
          await q(
            "SELECT resolved_task_id, resolved_by, resolved_at IS NOT NULL done FROM public.cockpit_csm_unmatched WHERE item_ref=$1",
            [String(row)],
          )
        )[0],
      ).toEqual({
        resolved_task_id: B,
        resolved_by: "csm@tests.invalid",
        done: true,
      });
      expect(
        await q(
          "SELECT task_id, actor_email FROM public.cockpit_csm_match_audit WHERE item_ref=$1",
          [String(row)],
        ),
      ).toEqual([{ task_id: B, actor_email: "csm@tests.invalid" }]);
      expect(
        await q(
          "SELECT entity_id, actor_email, metadata FROM public.cockpit_audit_log WHERE action='csm.recording_attached' AND entity_id=$1",
          [String(row)],
        ),
      ).toEqual([
        {
          entity_id: String(row),
          actor_email: "csm@tests.invalid",
          metadata: {
            recordingId: rec,
            callId: row,
            taskId: B,
            inserted: false,
          },
        },
      ]);
    });
  });
});

describe("a shadow run is never more than a plan", () => {
  test("a shadow response's effects are shadow and dry_run whatever the registry's owners say, and its send writes no call form", async () => {
    await rolledBack(async () => {
      await q(`UPDATE public.cockpit_forms SET effects = (
          SELECT jsonb_agg(jsonb_set(e, '{owner}', '"cockpit"') ORDER BY o)
            FROM jsonb_array_elements(effects) WITH ORDINALITY x(e, o)) WHERE key='checkin'`);
      await q(SQL_PLAN);
      const forms = await count(
        "SELECT count(*) n FROM public.cockpit_csm_call_forms",
      );
      const calls = await count(
        "SELECT count(*) n FROM public.cockpit_csm_calls",
      );
      const sent = await send(CSM, A, RID(801), {
        call: fathomCall("900000106", "same_room"),
        ...READY,
      });
      expect(sent.response.mode).toBe("shadow");
      expect(sent.effects.map((e: Row) => [e.key, e.owner, e.state])).toEqual([
        ["call_form", "shadow", "dry_run"],
        ["call_match", "shadow", "dry_run"],
      ]);
      expect(
        await count("SELECT count(*) n FROM public.cockpit_csm_call_forms"),
      ).toBe(forms);
      expect(
        await count("SELECT count(*) n FROM public.cockpit_csm_calls"),
      ).toBe(calls);
      expect(
        (
          await q(
            "SELECT task_id FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id='900000106'",
          )
        )[0],
      ).toBeUndefined();
    });
  });

  test("discard: only this seat's draft, once; sent notes stay sent", async () => {
    const DISCARD = "SELECT public.cockpit_form_discard($1::uuid) r";
    const id = RID(811);
    await fresh(CEO, C, id);
    expect(await refusal(CSM, DISCARD, [id])).toMatchObject({
      code: "42501",
      message: "Only your own notes can be changed.",
    });
    const seen = await auditIds(id);
    expect(await one(CEO, DISCARD, [id])).toEqual({ id, state: "void" });
    expect(await one(CEO, DISCARD, [id])).toEqual({ id, state: "void" });
    expect((await auditSince(id, seen)).map(a => a.action)).toEqual([
      "forms.discarded",
    ]);
    expect(await refused(CEO, DISCARD, [RID(899)])).toBe(
      "Open the notes from the client page.",
    );
    // A void draft frees the card: the next open starts new notes.
    expect((await open(CEO, C, RID(812))).response).toMatchObject({
      id: RID(812),
      state: "draft",
    });
    expect(
      await refused(CEO, SAVE, [id, changes({ defcon: "Happy" }), S1, null]),
    ).toBe("Open the notes from the client page.");
  });
});
