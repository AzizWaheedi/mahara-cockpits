/**
 * The Fathom intake (20261027g_fathom_intake.sql, docs/forms/STAGE2-CONTRACT.md
 * 2.2, 3.5, 3.6, 4.3 and 11) on an isolated PostgreSQL with Supabase's
 * default privileges on, so a missing REVOKE opens the object here as it
 * would in production.
 *
 * w stands on the forms core v (20261027f), so this file applies v, then w,
 * with a stub cockpit_form_checkin_plan standing in for x (20261027h, the
 * parity builder's), then both again. w goes in before the vault stand-in
 * exists, which proves the vault is touched only inside function bodies.
 * PL/pgSQL resolves a declared row type when the function is created, so v
 * needs the call store tables (20261011c) and w the sync state too;
 * everything else either file reads is resolved at run time.
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
 * The setup is the same in forms-core-supabase.test.ts; keep the two in step.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
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

const NEW_TABLES = [
  "cockpit_forms_keys",
  "cockpit_fathom_webhook_deliveries",
  "cockpit_forms_key_checks",
];
const STORE_TABLES = [
  "cockpit_csm_calls",
  "cockpit_csm_call_forms",
  "cockpit_fathom_meetings",
  "cockpit_csm_unmatched",
];
const PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];
const has = async (role: string, table: string, privilege: string) =>
  (
    await q<{ ok: boolean }>("SELECT has_table_privilege($1,$2,$3) ok", [
      role,
      `public.${table}`,
      privilege,
    ])
  )[0].ok;
/** The privileges a role holds on a table, from the seven. */
const held = async (role: string, table: string) => {
  const out: string[] = [];
  for (const privilege of PRIVILEGES)
    if (await has(role, table, privilege)) out.push(privilege);
  return out;
};

describe("the migration", () => {
  test("is one transaction that reloads the schema, and a further apply of both files changes nothing", async () => {
    const sql = migration(W);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    const snapshot = async () => ({
      audit: await count("SELECT count(*) n FROM public.cockpit_audit_log"),
      meetings: JSON.stringify(
        await q(
          "SELECT recording_id, class, room, recorder_team, summary, raw, transcript_path FROM public.cockpit_fathom_meetings ORDER BY recording_id",
        ),
      ),
      calls: JSON.stringify(
        await q(
          "SELECT source, source_id, room, candidate, hints, settled_reason, summary, transcript_text, transcript_path FROM public.cockpit_csm_calls ORDER BY source, source_id",
        ),
      ),
      keys: await count("SELECT count(*) n FROM public.cockpit_forms_keys"),
    });
    const before = await snapshot();
    await asOwner();
    await db.exec(migration(V));
    await db.exec(migration(W));
    expect(await snapshot()).toEqual(before);
    // The first apply classed every meeting and stripped the team and sales
    // content once: one audit row, with the counts and the recording ids
    // whose transcript objects the worker still has to remove.
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_fathom_meetings WHERE class IS NULL",
      ),
    ).toBe(0);
    const strips = await q(
      "SELECT entity_type, entity_id, actor_email, source_app, source_system, metadata FROM public.cockpit_audit_log WHERE action='fathom.privacy_strip'",
    );
    expect(strips).toEqual([
      {
        entity_type: "cockpit_fathom_meetings",
        entity_id: null,
        actor_email: "migration",
        source_app: "client-success",
        source_system: "migration",
        metadata: {
          meetings: 2,
          callRows: 1,
          pendingObjects: ["900000102"],
        },
      },
    ]);
  });

  test("the three new tables: row security on, keys reachable by no role, deliveries read by the service role, key checks read and written by it", async () => {
    for (const table of NEW_TABLES) {
      for (const role of ["anon", "authenticated"])
        expect([table, role, await held(role, table)]).toEqual([
          table,
          role,
          [],
        ]);
      expect(
        (
          await q<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [`public.${table}`],
          )
        )[0].rls,
      ).toBe(true);
    }
    expect(await held("service_role", "cockpit_forms_keys")).toEqual([]);
    expect(
      await held("service_role", "cockpit_fathom_webhook_deliveries"),
    ).toEqual(["SELECT"]);
    expect(await held("service_role", "cockpit_forms_key_checks")).toEqual([
      "SELECT",
      "INSERT",
    ]);
    expect(
      await count(
        "SELECT count(*) n FROM pg_policy WHERE polrelid = ANY($1::regclass[])",
        [NEW_TABLES.map(t => `public.${t}`)],
      ),
    ).toBe(0);
    expect(
      await svcRefused("SELECT * FROM public.cockpit_forms_keys"),
    ).toContain("permission denied");
    expect(
      await svcRefused(
        "DELETE FROM public.cockpit_forms_key_checks WHERE false",
      ),
    ).toContain("permission denied");
    // Nothing deletes them, whoever asks.
    for (const statement of [
      "TRUNCATE public.cockpit_forms_keys",
      "TRUNCATE public.cockpit_fathom_webhook_deliveries",
      "TRUNCATE public.cockpit_forms_key_checks",
    ])
      expect(await ownerRefused(statement)).toContain(
        "Forms records are never deleted",
      );
    await rolledBack(async () => {
      await db.query(
        "INSERT INTO public.cockpit_forms_keys(provider,vault_name,saved_by) VALUES('deepseek','cockpit_forms_key_deepseek','server')",
      );
      expect(
        await ownerRefused(
          "DELETE FROM public.cockpit_forms_keys WHERE provider='deepseek'",
        ),
      ).toContain("Forms records are never deleted");
    });
  });

  test("the call store keeps the service role's reads and writes and loses its DELETE and TRUNCATE; browsers still get nothing", async () => {
    for (const table of STORE_TABLES) {
      expect([table, await held("service_role", table)]).toEqual([
        table,
        ["SELECT", "INSERT", "UPDATE", "REFERENCES", "TRIGGER"],
      ]);
      for (const role of ["anon", "authenticated"])
        expect([table, role, await held(role, table)]).toEqual([
          table,
          role,
          [],
        ]);
    }
  });

  test("each function has exactly its grant; every one is a definer with an empty search path but the sales exclusion, which stays an invoker", async () => {
    const browser = [
      "cockpit_csm_candidate_settle(bigint,text,text)",
      "cockpit_forms_keys_status()",
      "cockpit_csm_calls_summary()",
      "cockpit_csm_manual_match(bigint,text)",
      "cockpit_csm_unmatched_list()",
    ];
    const service = [
      "cockpit_forms_key_get(text)",
      "cockpit_forms_key_put(jsonb)",
      "cockpit_forms_key_mark(jsonb)",
      "cockpit_fathom_ingest(jsonb,text)",
      "cockpit_fathom_match_inputs(timestamptz,timestamptz,text)",
      "cockpit_fathom_find_link(text)",
      "cockpit_fathom_pull_due()",
      "cockpit_fathom_pull_mark(boolean,integer,text)",
      "cockpit_fathom_webhook_seen(text,timestamptz)",
      "cockpit_fathom_webhook_settle(text,text,text,text)",
      "cockpit_form_draft_inputs(text,text)",
      "cockpit_forms_doctor_store()",
      "cockpit_sales_call_exclusion(text,text)",
    ];
    const internal = [
      "cockpit_call_room(text)",
      "cockpit_fathom_class(text,jsonb,text,timestamptz,timestamptz)",
      "cockpit_csm_booking_for(text,text,timestamptz)",
      "cockpit_fathom_meetings_privacy()",
    ];
    const can = async (role: string, sig: string) =>
      (
        await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
          [role, `public.${sig}`],
        )
      )[0].ok;
    for (const [list, grants] of [
      [browser, [false, true, false]],
      [service, [false, false, true]],
      [internal, [false, false, false]],
    ] as const)
      for (const fn of list)
        expect([
          fn,
          await can("anon", fn),
          await can("authenticated", fn),
          await can("service_role", fn),
        ]).toEqual([fn, ...grants]);

    const nameOf = (sig: string) => sig.slice(0, sig.indexOf("("));
    const browserNames = new Set(browser.map(nameOf));
    const serviceNames = new Set(service.map(nameOf));
    const names = functionsOf(W);
    for (const name of [...browser, ...service, ...internal].map(nameOf))
      expect(names).toContain(name);
    const fns = await q<{
      name: string;
      definer: boolean;
      config: string[] | null;
      lang: string;
      volatility: string;
      anon: boolean;
      auth: boolean;
      svc: boolean;
      pub: boolean;
    }>(
      `SELECT p.proname AS name, p.prosecdef definer, p.proconfig config, l.lanname lang, p.provolatile volatility,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              (p.proacl IS NULL OR p.proacl::text ~ '(^|[{,])=X/') pub
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
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
        fn.name !== "cockpit_sales_call_exclusion",
        ['search_path=""'],
        false,
        browserNames.has(fn.name),
        serviceNames.has(fn.name),
        false,
      ]);
    // The replaced functions keep their language and volatility.
    const byName = Object.fromEntries(fns.map(f => [f.name, f]));
    expect(
      [
        "cockpit_csm_calls_summary",
        "cockpit_sales_call_exclusion",
        "cockpit_csm_manual_match",
        "cockpit_csm_unmatched_list",
      ].map(n => [n, byName[n].lang, byName[n].volatility]),
    ).toEqual([
      ["cockpit_csm_calls_summary", "plpgsql", "s"],
      ["cockpit_sales_call_exclusion", "sql", "s"],
      ["cockpit_csm_manual_match", "plpgsql", "v"],
      ["cockpit_csm_unmatched_list", "plpgsql", "s"],
    ]);
    // The service RPCs ask for the service role in the claims, not only the grant.
    expect(
      await refused(CEO, "SELECT public.cockpit_fathom_pull_due()"),
    ).toContain("permission denied");
    expect(await svc("SELECT public.cockpit_fathom_pull_due()->'due' r")).toBe(
      true,
    );
    await asOwner();
    await db.exec("SET ROLE service_role");
    let message = "";
    try {
      await db.query("SELECT public.cockpit_fathom_pull_due()");
    } catch (e) {
      message = (e as Error).message;
    } finally {
      await asOwner();
    }
    expect(message).toContain("needs the service role");
    // The browser grant lets a seat in; the gate inside decides.
    expect(
      await one(
        CEO,
        "SELECT jsonb_array_length(public.cockpit_forms_keys_status()->'keys') r",
      ),
    ).toBe(4);
    expect(
      await refused(CSM, "SELECT public.cockpit_forms_keys_status()"),
    ).toBe("Only the CEO can see the 1-1 notes connections.");
  });

  test("adds no Slack channel: the call-feedback channel row comes in 2b", () => {
    for (const file of [V, W]) {
      const sql = migration(file);
      expect(sql).not.toContain("C09SVG6FHGU");
      expect(sql).not.toMatch(/INSERT INTO public\.cockpit_slack_channels/i);
    }
  });
});

describe("the room rule", () => {
  test("cockpit_call_room equals normalizeRoom on every pair of hermes/csm-calls/rooms.cases.json", async () => {
    const cases = JSON.parse(
      readFileSync(
        new URL("../../../hermes/csm-calls/rooms.cases.json", import.meta.url),
        "utf8",
      ),
    ) as { input: string | null; expected: string | null }[];
    expect(cases.length).toBeGreaterThanOrEqual(7);
    for (const c of cases)
      expect([
        c.input,
        (
          await q<{ r: string | null }>(
            "SELECT public.cockpit_call_room($1) r",
            [c.input],
          )
        )[0].r,
      ]).toEqual([c.input, c.expected ?? null]);
  });
});

// ---------------------------------------------------------------------------
// The intake as the worker, the pull, the webhook, the key script, the queue
// and the CEO card use it. Each test makes its own recordings and bookings;
// anything that would leak into another test runs inside rolledBack.

const CLIENT_NAMES: Record<string, string> = {
  [A]: "Acme Interiors",
  [B]: "Beta Build",
  [C]: "Cedar Homes",
};
const RID = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** "14:10 on Wed 28 Oct", Kuwait time, as the sync notes write it. */
const kuwaitTime = (at: string) => {
  const d = new Date(Date.parse(at) + 3 * 3_600_000);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][d.getUTCMonth()];
  return `${d.toISOString().slice(11, 16)} on ${day} ${d.getUTCDate()} ${month}`;
};

let nextRecording = 900000500;
const newRecording = () => String(nextRecording++);
const shareOf = (rec: string) => `https://fathom.video/share/test-${rec}`;
const callsUrlOf = (rec: string) =>
  `https://fathom.video/calls/${Number(rec) + 1000}`;

/** A stored meeting written as the store holds it (the trigger sets a missing class). */
async function meeting(
  o: {
    rec?: string;
    cls?: string | null;
    by?: string;
    team?: string;
    start?: string;
    end?: string;
    title?: string;
    room?: string | null;
    summary?: string | null;
    raw?: Row;
    transcript?: string | null;
    external?: boolean;
  } = {},
): Promise<string> {
  const rec = o.rec ?? newRecording();
  const by = o.by ?? "csm@tests.invalid";
  const team = o.team ?? "Customer Success";
  const invitees = o.external
    ? [
        {
          email: "owner@client.invalid",
          name: "Invented Owner",
          is_external: true,
        },
      ]
    : [];
  await q(
    `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
       external,invitees,url,share_url,summary,transcript_path,raw,class,room,recorder_team)
     VALUES($1,$2,$3,$4,$5,'Invented Recorder',$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
    [
      rec,
      o.title ?? "Impromptu Google Meet Meeting",
      o.start ?? ago(120),
      o.end ?? ago(90),
      by,
      !!o.external,
      JSON.stringify(invitees),
      callsUrlOf(rec),
      shareOf(rec),
      o.summary === undefined ? "Invented summary." : o.summary,
      o.transcript ?? null,
      JSON.stringify({
        recorded_by: { name: "Invented Recorder", email: by, team },
        calendar_invitees: invitees,
        calendar_invitees_domains_type: "one_or_more_external",
        shared_with: "all_teams",
        ...o.raw,
      }),
      o.cls === undefined ? "candidate" : o.cls,
      o.room ?? null,
      team,
    ],
  );
  return rec;
}

let nextBooking = 1;
async function booking(
  task: string,
  o: {
    start: string;
    end?: string | null;
    status?: string;
    kind?: string;
    room?: string | null;
    joinUrl?: string | null;
  },
): Promise<number> {
  return (
    await q<{ id: number }>(
      `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
         starts_at,ends_at,status,room,join_url,external_invitees)
       VALUES('ghl_appointment',$1,$2,$3,'client_id_field',1,$4,'Check-in',$5,$6,$7,$8,$9,
              '[{"email":"Owner@Client.invalid","name":"Invented Owner"}]'::jsonb) RETURNING id`,
      [
        `appt-intake-${nextBooking++}`,
        task,
        CLIENT_NAMES[task],
        o.kind ?? "checkin",
        o.start,
        o.end ?? null,
        o.status ?? "confirmed",
        o.room ?? null,
        o.joinUrl ?? null,
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
    confidence?: number | null;
    linked?: number | null;
    kind?: string;
    candidate?: boolean;
    settled?: string | null;
    start?: string;
    room?: string | null;
    hints?: Row[];
    transcriptPath?: string | null;
    transcriptText?: string | null;
    summary?: string | null;
    status?: string;
  } = {},
): Promise<number> {
  const task = o.task ?? null;
  return (
    await q<{ id: number }>(
      `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
         starts_at,status,host_email,linked_call_id,candidate,settled_reason,room,hints,transcript_path,transcript_text,
         summary,raw_hash,recording_url)
       VALUES('fathom',$1,$2,$3,$4,$5,$6,'Recorded call',$7,$8,'csm@tests.invalid',$9,$10,$11,$12,$13::jsonb,$14,$15,$16,
              'hash-test',$17) RETURNING id`,
      [
        rec,
        task,
        task ? CLIENT_NAMES[task] : null,
        o.method ?? (task ? "manual" : null),
        o.confidence ?? (task ? 1 : null),
        o.kind ?? "other",
        o.start ?? ago(120),
        o.status ?? "held",
        o.linked ?? null,
        o.candidate ?? false,
        o.settled ?? null,
        o.room ?? null,
        JSON.stringify(o.hints ?? []),
        o.transcriptPath ?? null,
        o.transcriptText ?? null,
        o.summary ?? null,
        shareOf(rec),
      ],
    )
  )[0].id;
}
async function queueItem(
  ref: string,
  o: { kind?: string; host?: string | null; resolved?: boolean } = {},
): Promise<number> {
  return (
    await q<{ id: number }>(
      `INSERT INTO public.cockpit_csm_unmatched(item_kind,item_ref,title,at,reason,hint,host_email,resolved_at)
       VALUES($1,$2,'Impromptu Google Meet Meeting',now(),'Invented reason.',NULL,$3,$4) RETURNING id`,
      [
        o.kind ?? "call",
        ref,
        o.host === undefined ? "csm@tests.invalid" : o.host,
        o.resolved ? ago(1) : null,
      ],
    )
  )[0].id;
}
async function callOf(rec: string): Promise<Row> {
  return (
    await q(
      `SELECT id, task_id, client_name, match_method, match_confidence::float AS confidence, linked_call_id, kind, candidate,
              settled_reason, hints, room, status, provider_status, summary, transcript_path, transcript_text, raw_hash
         FROM public.cockpit_csm_calls WHERE source='fathom' AND source_id=$1`,
      [rec],
    )
  )[0];
}
async function meetingOf(rec: string): Promise<Row> {
  return (
    await q(
      `SELECT recording_id, class, summary, raw, room, recorder_team, transcript_path, missing_since, gone_at
         FROM public.cockpit_fathom_meetings WHERE recording_id=$1`,
      [rec],
    )
  )[0];
}

/** One ingest item (3.6): the meeting and, unless null, its call. */
function item(
  rec: string,
  o: {
    cls?: string | null;
    by?: string;
    team?: string;
    summary?: string | null;
    raw?: Row;
    external?: boolean;
    start?: string;
    end?: string;
    room?: string | null;
    call?: Row | null;
  } = {},
): Row {
  const by = o.by ?? "csm@tests.invalid";
  const team = o.team ?? "Customer Success";
  const start = o.start ?? ago(60);
  const end = o.end ?? ago(30);
  const invitees = o.external
    ? [
        {
          email: "owner@client.invalid",
          name: "Invented Owner",
          is_external: true,
        },
      ]
    : [];
  const raw = {
    recorded_by: { name: "Invented Recorder", email: by, team },
    calendar_invitees: invitees,
    calendar_invitees_domains_type: "one_or_more_external",
    shared_with: "all_teams",
    ...o.raw,
  };
  return {
    meeting: {
      recording_id: rec,
      title: "Impromptu Google Meet Meeting",
      starts_at: start,
      ends_at: end,
      recorded_by_email: by,
      recorded_by_name: "Invented Recorder",
      external: !!o.external,
      invitees,
      url: callsUrlOf(rec),
      share_url: shareOf(rec),
      summary: o.summary ?? null,
      raw,
      class: o.cls === undefined ? "candidate" : o.cls,
      room: o.room ?? null,
      recorder_team: team,
    },
    call:
      o.call === null
        ? null
        : {
            source_id: rec,
            task_id: null,
            client_name: null,
            match_method: null,
            match_confidence: null,
            kind: "other",
            title: "Impromptu Google Meet Meeting",
            starts_at: start,
            ends_at: end,
            host_email: by,
            host_name: "Invented Recorder",
            recording_url: shareOf(rec),
            summary: o.summary ?? null,
            external_invitees: [],
            linked_call_id: null,
            candidate: true,
            room: o.room ?? null,
            hints: [],
            ...o.call,
          },
  };
}
async function ingest(items: Row[], via: "pull" | "webhook"): Promise<Row> {
  return svc("SELECT public.cockpit_fathom_ingest($1::jsonb,$2) r", [
    JSON.stringify(items),
    via,
  ]);
}
async function putKey(p: Row): Promise<Row> {
  return svc("SELECT public.cockpit_forms_key_put($1::jsonb) r", [
    JSON.stringify({ savedBy: "server", state: "unchecked", ...p }),
  ]);
}
async function markKey(p: Row): Promise<Row> {
  return svc("SELECT public.cockpit_forms_key_mark($1::jsonb) r", [
    JSON.stringify(p),
  ]);
}
async function keyOf(provider: string): Promise<Row> {
  return svc("SELECT public.cockpit_forms_key_get($1) r", [provider]);
}
async function syncRow(key: string): Promise<Row | undefined> {
  return (
    await q(
      "SELECT last_run_at, last_ok_at, ok, note, rows_seen, detail FROM public.cockpit_sync_state WHERE key=$1",
      [key],
    )
  )[0];
}
async function status(): Promise<Row> {
  return one(CEO, "SELECT public.cockpit_forms_keys_status() r");
}

const KEYS = {
  fathom: "fathom-test-key-0000000000000001",
  fathom_webhook: "whsec_TESTTESTTESTTEST0001",
  anthropic: "sk-ant-TESTTESTTESTTESTTEST0001",
  deepseek: "sk-TESTTESTTESTTESTTEST0001",
};

// The window's RPCs (migration v), for the shadow-run and summary cases here.
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
async function open(
  who: string,
  task: string,
  id: string | null,
): Promise<Row> {
  return one(
    who,
    "SELECT public.cockpit_form_open('checkin',$1,$2::uuid,false) r",
    [task, id],
  );
}
async function save(who: string, id: string, values: Row): Promise<Row> {
  const changes = Object.fromEntries(
    Object.entries(values).map(([k, value]) => [k, { value, seen: null }]),
  );
  return one(
    who,
    "SELECT public.cockpit_form_save($1::uuid,$2::jsonb,'window-one-0001',NULL) r",
    [id, JSON.stringify(changes)],
  );
}
async function submit(
  who: string,
  id: string,
  base: number | null = null,
): Promise<Row> {
  return one(who, "SELECT public.cockpit_form_submit($1::uuid,$2) r", [
    id,
    base,
  ]);
}
async function fresh(who: string, task: string, id: string): Promise<Row> {
  for (const r of await q<{ id: string }>(
    "SELECT id FROM public.cockpit_form_responses WHERE form_key='checkin' AND task_id=$1 AND created_by_id=$2 AND state='draft'",
    [task, who],
  ))
    await one(who, "SELECT public.cockpit_form_discard($1::uuid) r", [r.id]);
  return open(who, task, id);
}
const jsonTime = async (at: string | Date) =>
  (await q<{ t: string }>("SELECT to_jsonb($1::timestamptz) t", [at]))[0].t;

describe("the store's new columns and its widened CHECKs", () => {
  test("the three widened CHECKs read as written and take the new values; settled_reason, hints and class keep to their lists", async () => {
    const def = async (table: string, name: string) =>
      (
        await q<{ d: string }>(
          "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",
          [`public.${table}`, name],
        )
      )[0]?.d;
    expect(
      await def("cockpit_csm_calls", "cockpit_csm_calls_match_method_check"),
    ).toContain("'same_room'");
    expect(
      await def(
        "cockpit_csm_call_forms",
        "cockpit_csm_call_forms_form_id_check",
      ),
    ).toContain("'cockpit-checkin'");
    expect(
      await def(
        "cockpit_csm_call_forms",
        "cockpit_csm_call_forms_matched_by_check",
      ),
    ).toContain("'cockpit_form'");
    // The old values still pass.
    for (const value of [
      "client_id_field",
      "invitee_email",
      "appointment_time",
      "name",
      "manual",
      "form_task_id",
      "imported",
    ])
      expect(
        await def("cockpit_csm_calls", "cockpit_csm_calls_match_method_check"),
      ).toContain(`'${value}'`);
    await rolledBack(async () => {
      const rec = await meeting();
      const row = await callRow(rec, { task: A, method: "same_room" });
      const set = (sql: string) => ownerRefusal(sql, [row]);
      expect(
        await set(
          "UPDATE public.cockpit_csm_calls SET match_method='nearby' WHERE id=$1",
        ),
      ).toMatchObject({
        code: "23514",
      });
      for (const reason of [
        "part_of_call",
        "onboarding",
        "blueprint",
        "not_client",
      ])
        await q(
          "UPDATE public.cockpit_csm_calls SET settled_reason=$2 WHERE id=$1",
          [row, reason],
        );
      expect(
        await set(
          "UPDATE public.cockpit_csm_calls SET settled_reason='duplicate' WHERE id=$1",
        ),
      ).toMatchObject({
        code: "23514",
      });
      await q(
        `UPDATE public.cockpit_csm_calls SET hints='[{"taskId":"a"},{"taskId":"b"},{"taskId":"c"}]'::jsonb WHERE id=$1`,
        [row],
      );
      for (const hints of ["[{},{},{},{}]", '{"taskId":"a"}'])
        expect(
          await set(
            `UPDATE public.cockpit_csm_calls SET hints='${hints}'::jsonb WHERE id=$1`,
          ),
        ).toMatchObject({
          code: "23514",
        });
      expect(
        await ownerRefusal(
          "UPDATE public.cockpit_fathom_meetings SET class='hiring' WHERE recording_id=$1",
          [rec],
        ),
      ).toMatchObject({ code: "23514" });
      const form = `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at)
        VALUES($1,$2,'checkin',$3,$4,now())`;
      await q(form, ["cockpit:check-1", "cockpit-checkin", A, "cockpit_form"]);
      expect(
        await ownerRefusal(form, [
          "cockpit:check-2",
          "ABCDEFGH",
          A,
          "cockpit_form",
        ]),
      ).toMatchObject({ code: "23514" });
      expect(
        await ownerRefusal(form, [
          "cockpit:check-3",
          "cockpit-checkin",
          A,
          "guess",
        ]),
      ).toMatchObject({ code: "23514" });
    });
  });
});

describe("the class rule and the backfill", () => {
  test("cockpit_fathom_class, in order: the sales index (not client service, not Customer Success), an external invitee, the candidate rule, else internal", async () => {
    const cls = async (
      rec: string,
      raw: Row,
      summary: string | null,
      minutes: number,
    ) =>
      (
        await q<{ c: string }>(
          "SELECT public.cockpit_fathom_class($1,$2::jsonb,$3,now() - make_interval(mins => $4),now()) c",
          [rec, JSON.stringify(raw), summary, minutes],
        )
      )[0].c;
    const external = [{ email: "owner@client.invalid", is_external: true }];
    const flagged = {
      calendar_invitees: [],
      calendar_invitees_domains_type: "one_or_more_external",
      shared_with: "all_teams",
    };
    const cs = { recorded_by: { team: "Customer Success" } };
    const salesTeam = { recorded_by: { team: "Sales" } };
    const cases: [string, Row, string | null, number, string][] = [
      // 102 is indexed with no reason: a Sales-team recording is sales, a
      // Customer Success one never is.
      [
        "900000102",
        { ...salesTeam, calendar_invitees: external },
        null,
        30,
        "sales",
      ],
      ["900000102", { calendar_invitees: external }, null, 30, "sales"],
      ["900000102", { ...cs, calendar_invitees: external }, null, 30, "client"],
      ["900000102", { ...cs, ...flagged }, null, 30, "candidate"],
      // 103 is indexed as client service: classed like any other.
      [
        "900000103",
        { ...salesTeam, calendar_invitees: external },
        null,
        30,
        "client",
      ],
      ["900000103", { ...salesTeam, ...flagged }, "Summary.", 30, "internal"],
      // 104 is indexed with no reason and recorded by Customer Success.
      ["900000104", { ...cs, ...flagged }, null, 20, "candidate"],
      // Not indexed.
      [
        "900000199",
        { ...salesTeam, calendar_invitees: external },
        null,
        30,
        "client",
      ],
      ["900000199", { ...cs, ...flagged }, null, 2, "internal"],
      ["900000199", { ...cs, ...flagged }, "Summary.", 2, "candidate"],
      ["900000199", { ...cs, ...flagged }, null, 5, "candidate"],
      [
        "900000199",
        { ...cs, ...flagged, shared_with: "no_teams" },
        "Summary.",
        30,
        "internal",
      ],
      [
        "900000199",
        { ...cs, ...flagged, calendar_invitees_domains_type: "only_internal" },
        null,
        30,
        "internal",
      ],
      ["900000199", { ...salesTeam, ...flagged }, "Summary.", 30, "internal"],
      ["900000199", {}, null, 30, "internal"],
    ];
    for (const [rec, raw, summary, minutes, expected] of cases)
      expect([
        rec,
        raw,
        minutes,
        await cls(rec, raw, summary, minutes),
      ]).toEqual([rec, raw, minutes, expected]);
  });

  test("the backfill set each stored meeting's class, room and team, and each booking's room; no sales meeting is a Customer Success or client service one", async () => {
    expect(
      await q(
        "SELECT recording_id, class, room, recorder_team FROM public.cockpit_fathom_meetings WHERE recording_id LIKE '9000001%' ORDER BY recording_id",
      ),
    ).toEqual([
      {
        recording_id: "900000101",
        class: "candidate",
        room: "meet:abc-defg-hij",
        recorder_team: "Customer Success",
      },
      {
        recording_id: "900000102",
        class: "sales",
        room: null,
        recorder_team: "Sales",
      },
      {
        recording_id: "900000103",
        class: "client",
        room: null,
        recorder_team: "Sales",
      },
      {
        recording_id: "900000104",
        class: "candidate",
        room: "zoom:98765432101",
        recorder_team: "Customer Success",
      },
      {
        recording_id: "900000105",
        class: "internal",
        room: null,
        recorder_team: "Customer Success",
      },
      {
        recording_id: "900000106",
        class: "client",
        room: "zoom:12345678901",
        recorder_team: "Customer Success",
      },
    ]);
    expect(
      (
        await q(
          "SELECT room FROM public.cockpit_csm_calls WHERE source='ghl_appointment' AND source_id='appt-acme-1'",
        )
      )[0].room,
    ).toBe("zoom:12345678901");
    expect(
      await count(
        `SELECT count(*) n FROM public.cockpit_fathom_meetings m
          WHERE m.class = 'sales' AND (coalesce(m.recorder_team, '') = 'Customer Success'
             OR EXISTS (SELECT 1 FROM public.cockpit_sales_recordings s WHERE s.recording_id = m.recording_id AND s.hidden_reason = 'client service'))`,
      ),
    ).toBe(0);
  });
});

describe("the privacy strip and the privacy trigger", () => {
  test("the strip: the sales meeting and its call row and the team meeting lost their content, kept their transcript path; the client and candidate meetings kept theirs", async () => {
    const m102 = await meetingOf("900000102");
    expect(m102).toMatchObject({
      summary: null,
      transcript_path: "fathom/900000102.txt",
    });
    for (const key of [
      "default_summary",
      "action_items",
      "highlights",
      "transcript",
    ])
      expect([key, key in m102.raw]).toEqual([key, false]);
    expect(m102.raw.recorded_by).toMatchObject({ team: "Sales" });
    expect(await callOf("900000102")).toMatchObject({
      summary: null,
      transcript_text: null,
      transcript_path: "fathom/900000102.txt",
    });
    const m105 = await meetingOf("900000105");
    expect([m105.summary, "default_summary" in m105.raw]).toEqual([
      null,
      false,
    ]);
    const m101 = await meetingOf("900000101");
    expect([m101.summary, m101.raw.default_summary]).toEqual([
      "Invented summary of an impromptu call.",
      { markdown_formatted: "Invented summary of an impromptu call." },
    ]);
    expect((await meetingOf("900000103")).summary).toBe(
      "Invented client summary.",
    );
    expect((await callOf("900000103")).summary).toBe(
      "Invented client summary.",
    );
    expect((await meetingOf("900000106")).raw.default_summary).toEqual({
      markdown_formatted: "Invented Acme summary.",
    });
  });

  test("the trigger: the old release's upsert onto a sales meeting stores no content; an insert with no class gets one; a client meeting keeps its content; transcript_path is never touched", async () => {
    await rolledBack(async () => {
      // The old release, through PostgREST: every column it knows, no class.
      const oldRelease = `INSERT INTO public.cockpit_fathom_meetings AS m (recording_id,title,starts_at,ends_at,recorded_by_email,
          recorded_by_name,external,invitees,url,share_url,summary,raw,updated_at)
        VALUES($1,'Demo with a prospect',now() - interval '5 hours',now() - interval '4 hours','closer@tests.invalid','Sam Closer',
               true,'[]'::jsonb,$2,$3,'Old release summary.',$4::jsonb,now())
        ON CONFLICT (recording_id) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, raw=EXCLUDED.raw,
          external=EXCLUDED.external, updated_at=EXCLUDED.updated_at`;
      const content = {
        recorded_by: { team: "Sales" },
        calendar_invitees: [
          { email: "lead@prospect.invalid", is_external: true },
        ],
        default_summary: { markdown_formatted: "Old release summary." },
        action_items: [{ description: "Invented action" }],
        highlights: [{ text: "Invented highlight" }],
        transcript: [{ text: "Invented line" }],
      };
      await guarded(async () => {
        await asService();
        await db.query(oldRelease, [
          "900000102",
          callsUrlOf("900000102"),
          shareOf("900000102"),
          JSON.stringify(content),
        ]);
      });
      const stripped = await meetingOf("900000102");
      expect(stripped).toMatchObject({
        class: "sales",
        summary: null,
        transcript_path: "fathom/900000102.txt",
      });
      expect(Object.keys(stripped.raw).sort()).toEqual([
        "calendar_invitees",
        "recorded_by",
      ]);
      // A new meeting written with no class gets the rule's class.
      const fresh = newRecording();
      await q(
        "INSERT INTO public.cockpit_sales_recordings(recording_id, hidden_reason) VALUES($1, NULL)",
        [fresh],
      );
      await guarded(async () => {
        await asService();
        await db.query(
          `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,external,invitees,
             url,share_url,summary,transcript_path,raw)
           VALUES($1,'Demo',now() - interval '1 hour',now(),'closer@tests.invalid',true,'[]'::jsonb,$2,$3,'Summary.','fathom/x.txt',$4::jsonb)`,
          [fresh, callsUrlOf(fresh), shareOf(fresh), JSON.stringify(content)],
        );
      });
      expect(await meetingOf(fresh)).toMatchObject({
        class: "sales",
        summary: null,
        transcript_path: "fathom/x.txt",
      });
      const candidate = await meeting({
        cls: null,
        summary: "A real summary.",
        raw: { default_summary: { markdown_formatted: "A real summary." } },
      });
      expect(await meetingOf(candidate)).toMatchObject({
        class: "candidate",
        summary: "A real summary.",
      });
      // A client meeting keeps what it is given.
      await q(
        `UPDATE public.cockpit_fathom_meetings SET summary='New summary.', raw = raw || '{"action_items":[{"description":"Send it"}]}'::jsonb
          WHERE recording_id='900000103'`,
      );
      expect(await meetingOf("900000103")).toMatchObject({
        class: "client",
        summary: "New summary.",
      });
      expect((await meetingOf("900000103")).raw.action_items).toEqual([
        { description: "Send it" },
      ]);
      // A team meeting stays stripped, whoever writes.
      await q(
        `UPDATE public.cockpit_fathom_meetings SET summary='Team notes.', raw = raw || '{"transcript":[{"text":"x"}]}'::jsonb
          WHERE recording_id='900000105'`,
      );
      expect(await meetingOf("900000105")).toMatchObject({
        class: "internal",
        summary: null,
      });
      expect("transcript" in (await meetingOf("900000105")).raw).toBe(false);
      // The trigger exists, is enabled, and no role can call its function.
      expect(
        await q(
          "SELECT tgenabled e FROM pg_trigger WHERE tgrelid='public.cockpit_fathom_meetings'::regclass AND tgname='cockpit_fathom_meetings_privacy'",
        ),
      ).toEqual([{ e: "O" }]);
    });
  });
});

describe("the booking rule", () => {
  test("cockpit_csm_booking_for: the same room within 90 minutes on one card; a room another card uses there, or a booking days away, proves nothing; else the closest booking within 30 minutes; else none", async () => {
    await rolledBack(async () => {
      const base = Date.now() - 600 * 60_000;
      const at = (minutes: number) =>
        new Date(base + minutes * 60_000).toISOString();
      const rule = async (
        task: string | null,
        room: string | null,
        start: string | null,
      ) =>
        (
          await q<{ r: number | null }>(
            "SELECT public.cockpit_csm_booking_for($1,$2,$3) r",
            [task, room, start],
          )
        )[0].r;
      const roomA = await booking(A, {
        start: at(0),
        room: "meet:abc-defg-hij",
      });
      const plainA = await booking(A, { start: at(20) });
      // The room wins over a closer booking with no room, inside 90 minutes.
      expect(await rule(A, "meet:abc-defg-hij", at(40))).toBe(roomA);
      expect(await rule(A, "meet:abc-defg-hij", at(-85))).toBe(roomA);
      // Outside 90 minutes the room is no proof: the time rule speaks.
      expect(await rule(A, "meet:abc-defg-hij", at(100))).toBeNull();
      expect(await rule(A, "meet:abc-defg-hij", at(45))).toBe(roomA);
      // Two bookings of this card in the room: the closer one.
      const roomA2 = await booking(A, {
        start: at(60),
        room: "meet:abc-defg-hij",
      });
      expect(await rule(A, "meet:abc-defg-hij", at(50))).toBe(roomA2);
      // Another card's booking in that room inside the window: no room link,
      // so this card's booking within 30 minutes, the closest.
      await booking(C, { start: at(70), room: "meet:abc-defg-hij" });
      expect(await rule(A, "meet:abc-defg-hij", at(35))).toBe(plainA);
      expect(await rule(A, "meet:abc-defg-hij", at(130))).toBeNull();
      // Before the other card's booking enters the window, the room still links.
      expect(await rule(A, "meet:abc-defg-hij", at(-60))).toBe(roomA);
      // A booking three days away with the same room: no room link.
      const reused = await booking(B, {
        start: at(0),
        room: "zoom:12345678902",
      });
      expect(await rule(B, "zoom:12345678902", at(3 * 24 * 60))).toBeNull();
      expect(await rule(B, "zoom:12345678902", at(10))).toBe(reused);
      // A gone booking never links, by room or by time.
      await booking(B, {
        start: at(300),
        room: "zoom:12345678903",
        status: "gone",
      });
      expect(await rule(B, "zoom:12345678903", at(300))).toBeNull();
      // No room: the time rule alone; nothing within 30 minutes: none.
      expect(await rule(A, null, at(25))).toBe(plainA);
      expect(await rule(A, null, at(-31))).toBeNull();
      expect(await rule(null, "meet:abc-defg-hij", at(0))).toBeNull();
      expect(await rule(A, "meet:abc-defg-hij", null)).toBeNull();
    });
  });
});

describe("the keys", () => {
  test("a pasted key: each provider's format, the vault written once and then updated under the provider's lock, only last4 kept beside it, one audit row with no secret", async () => {
    await rolledBack(async () => {
      for (const [provider, bad, label] of [
        ["fathom", "short", "a Fathom"],
        ["fathom", "has a space in it, so it is no key", "a Fathom"],
        ["fathom_webhook", "whsec_short", "a Fathom webhook"],
        ["fathom_webhook", KEYS.fathom, "a Fathom webhook"],
        ["anthropic", KEYS.deepseek, "an Anthropic"],
        ["deepseek", KEYS.anthropic, "a DeepSeek"],
        ["deepseek", "sk-short", "a DeepSeek"],
      ])
        expect([
          provider,
          bad,
          await svcRefusal("SELECT public.cockpit_forms_key_put($1::jsonb)", [
            JSON.stringify({
              provider,
              secret: bad,
              savedBy: "server",
              state: "unchecked",
            }),
          ]),
        ]).toEqual([
          provider,
          bad,
          expect.objectContaining({
            code: "22023",
            message: `That doesn't look like ${label} key. Nothing was changed.`,
          }),
        ]);
      for (const [p, sentence] of [
        [
          { provider: "openai", secret: KEYS.deepseek },
          "Choose fathom, fathom_webhook, anthropic or deepseek.",
        ],
        [
          { provider: "fathom", secret: KEYS.fathom, savedBy: "the CEO" },
          "A key is saved by a verified email or the server.",
        ],
        [
          { provider: "fathom", secret: KEYS.fathom, state: "great" },
          "Choose connected, unchecked or refused.",
        ],
      ] as const)
        expect(
          await svcRefused("SELECT public.cockpit_forms_key_put($1::jsonb)", [
            JSON.stringify({ savedBy: "server", state: "unchecked", ...p }),
          ]),
        ).toBe(sentence);
      expect(await count("SELECT count(*) n FROM vault.secrets")).toBe(0);

      expect(
        await putKey({
          provider: "fathom",
          secret: KEYS.fathom,
          meta: { users: 3 },
        }),
      ).toEqual({
        ok: true,
        provider: "fathom",
        last4: "0001",
        state: "unchecked",
      });
      const vault = async () =>
        q(
          "SELECT id, name, secret, description FROM vault.secrets WHERE name='cockpit_forms_key_fathom'",
        );
      const created = await vault();
      expect(created).toEqual([
        {
          id: created[0]?.id,
          name: "cockpit_forms_key_fathom",
          secret: KEYS.fathom,
          description: "cockpit forms key: fathom",
        },
      ]);
      const row = async () =>
        (
          await q(
            "SELECT provider, vault_name, last4, state, saved_by, checked_at IS NOT NULL checked, meta FROM public.cockpit_forms_keys WHERE provider='fathom'",
          )
        )[0];
      expect(await row()).toEqual({
        provider: "fathom",
        vault_name: "cockpit_forms_key_fathom",
        last4: "0001",
        state: "unchecked",
        saved_by: "server",
        checked: false,
        meta: { users: 3 },
      });
      // Two pastes of one key at once take turns: the body takes the
      // provider's lock before it looks the vault secret up, so the second
      // finds the first's secret and updates it.
      const putBody = (
        await q<{ b: string }>(
          "SELECT pg_get_functiondef('public.cockpit_forms_key_put(jsonb)'::regprocedure) b",
        )
      )[0].b;
      const lockAt = putBody.indexOf(
        "PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_forms_key:' || v_provider, 0));",
      );
      const lookupAt = putBody.indexOf(
        "SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_name",
      );
      expect([lockAt > 0, lookupAt > lockAt]).toEqual([true, true]);
      expect(putBody.indexOf("vault.create_secret")).toBeGreaterThan(lookupAt);
      // A second paste updates the same vault secret and merges the meta.
      const second = "fathom-test-key-0000000000000002";
      await putKey({
        provider: "fathom",
        secret: second,
        savedBy: "Aziz@MaharaMedia.com",
        state: "connected",
        meta: { adminOk: true },
      });
      expect(await vault()).toEqual([{ ...created[0], secret: second }]);
      expect(await row()).toEqual({
        provider: "fathom",
        vault_name: "cockpit_forms_key_fathom",
        last4: "0002",
        state: "connected",
        saved_by: "aziz@maharamedia.com",
        checked: true,
        meta: { users: 3, adminOk: true },
      });
      const audits = await q(
        "SELECT actor_email, source_app, source_system, entity_id, metadata, before, after FROM public.cockpit_audit_log WHERE action='forms.keySaved' ORDER BY metadata->>'last4'",
      );
      expect(audits).toEqual([
        {
          actor_email: "server",
          source_app: "client-success",
          source_system: "forms_key.py",
          entity_id: "fathom",
          metadata: {
            provider: "fathom",
            savedBy: "server",
            state: "unchecked",
            last4: "0001",
          },
          before: null,
          after: null,
        },
        {
          actor_email: "aziz@maharamedia.com",
          source_app: "client-success",
          source_system: "cockpit-forms-api",
          entity_id: "fathom",
          metadata: {
            provider: "fathom",
            savedBy: "aziz@maharamedia.com",
            state: "connected",
            last4: "0002",
          },
          before: null,
          after: null,
        },
      ]);
      const text = JSON.stringify(
        await q(
          "SELECT * FROM public.cockpit_audit_log WHERE entity_type='cockpit_forms_keys'",
        ),
      );
      expect(text).not.toContain(KEYS.fathom);
      expect(text).not.toContain(second);
      // The secret goes back to the service role only.
      expect(await keyOf("fathom")).toEqual({
        provider: "fathom",
        secret: second,
        last4: "0002",
        state: "connected",
        savedAt: expect.any(String),
        meta: { users: 3, adminOk: true },
      });
      expect(await keyOf("deepseek")).toBeNull();
      expect(
        await refused(CEO, "SELECT public.cockpit_forms_key_get('fathom')"),
      ).toContain("permission denied");
      expect(
        await ownerRefused("SELECT public.cockpit_forms_key_get('fathom')"),
      ).toBe("This hours function needs the service role");
      // Mark compares the save time, so a key pasted meanwhile is never marked by the old check.
      expect(
        await markKey({
          provider: "fathom",
          state: "refused",
          note: "Fathom refused this key.",
          savedAt: ago(60),
        }),
      ).toEqual({ ok: false, note: "The key changed during the check" });
      expect((await row()).state).toBe("connected");
      const { savedAt } = await keyOf("fathom");
      expect(
        await markKey({
          provider: "fathom",
          state: "refused",
          note: "Fathom refused this key.",
          savedAt,
          meta: { csFilterOk: false },
        }),
      ).toEqual({ ok: true, provider: "fathom", state: "refused" });
      expect(await row()).toMatchObject({
        state: "refused",
        meta: { users: 3, adminOk: true, csFilterOk: false },
      });
      expect(
        await q(
          "SELECT actor_email, before, after FROM public.cockpit_audit_log WHERE action='forms.keyState' AND entity_id='fathom'",
        ),
      ).toEqual([
        {
          actor_email: "server",
          before: { state: "connected", registered: null },
          after: { state: "refused", registered: null },
        },
      ]);
    });
  });

  test("the CEO's connections card: the four rows in a fixed order with a sentence for each state (the webhook's names the notes' pull only with a Fathom key saved); only the CEO sees it", async () => {
    await rolledBack(async () => {
      const empty = await status();
      expect(empty.keys).toEqual([
        {
          provider: "fathom",
          label: "Fathom",
          connected: false,
          state: "missing",
          last4: null,
          savedAt: null,
          savedBy: null,
          checkedAt: null,
          sentence: "Not connected: calls come only from the 15-minute read.",
        },
        {
          provider: "fathom_webhook",
          label: "Fathom webhook",
          connected: false,
          state: "missing",
          last4: null,
          savedAt: null,
          savedBy: null,
          checkedAt: null,
          // No Fathom key: the notes pull nothing when they open (A7.16).
          sentence: "Not registered: calls arrive by the 15-minute read.",
        },
        {
          provider: "deepseek",
          label: "DeepSeek",
          connected: false,
          state: "missing",
          last4: null,
          savedAt: null,
          savedBy: null,
          checkedAt: null,
          sentence: "Not connected: client notes drafts are off.",
        },
        {
          provider: "anthropic",
          label: "Anthropic",
          connected: false,
          state: "missing",
          last4: null,
          savedAt: null,
          savedBy: null,
          checkedAt: null,
          sentence:
            "Not connected: DEFCON and priority suggestions, the call grade and the recap drafts are off.",
        },
      ]);
      expect(empty.webhook).toEqual({
        registered: false,
        triggeredFor: [],
        lastDeliveryAt: null,
        stored24h: 0,
        ignored24h: 0,
        failed24h: 0,
      });
      expect(empty.now).toEqual(expect.any(String));
      await putKey({
        provider: "fathom",
        secret: KEYS.fathom,
        savedBy: "aziz@maharamedia.com",
        state: "connected",
      });
      await putKey({
        provider: "deepseek",
        secret: KEYS.deepseek,
        savedBy: "csm@tests.invalid",
      });
      await putKey({ provider: "anthropic", secret: KEYS.anthropic });
      // With a Fathom key saved, the notes pull when they open, as the card says.
      expect((await status()).keys[1]).toMatchObject({
        provider: "fathom_webhook",
        state: "missing",
        sentence:
          "Not registered: calls arrive by the 15-minute read and when the notes open.",
      });
      const { savedAt } = await keyOf("anthropic");
      await markKey({
        provider: "anthropic",
        state: "refused",
        note: "Anthropic refused this key.",
        savedAt,
      });
      await putKey({
        provider: "fathom_webhook",
        secret: KEYS.fathom_webhook,
        state: "connected",
        meta: {
          webhookId: "wh_TEST0001",
          triggeredFor: ["shared_team_recordings"],
        },
      });
      const full = await status();
      expect(
        full.keys.map((k: Row) => [
          k.provider,
          k.connected,
          k.state,
          k.last4,
          k.savedBy,
          k.sentence,
        ]),
      ).toEqual([
        ["fathom", true, "connected", "0001", "the CEO", "Connected."],
        [
          "fathom_webhook",
          true,
          "connected",
          "0001",
          "the server",
          "Connected.",
        ],
        [
          "deepseek",
          false,
          "unchecked",
          "0001",
          "the CSM",
          "Saved, not checked yet.",
        ],
        [
          "anthropic",
          false,
          "refused",
          "0001",
          "the server",
          "Anthropic refused this key. Paste a new one.",
        ],
      ]);
      expect(full.keys[0].checkedAt).toEqual(expect.any(String));
      expect(full.webhook).toMatchObject({
        registered: true,
        triggeredFor: ["shared_team_recordings"],
      });
      for (const who of [CSM, ADMIN])
        expect(
          await refusal(who, "SELECT public.cockpit_forms_keys_status()"),
        ).toMatchObject({
          code: "42501",
          message: "Only the CEO can see the 1-1 notes connections.",
        });
      expect(
        await refused(null, "SELECT public.cockpit_forms_keys_status()"),
      ).toContain("permission denied");
      // Nothing on the card ever carries a secret.
      const text = JSON.stringify(full);
      for (const secret of Object.values(KEYS))
        expect(text).not.toContain(secret);
    });
  });

  test("the webhook registration: a put replaces the meta and registers it; a mark with unregisteredAt unregisters it; a second put registers again", async () => {
    await rolledBack(async () => {
      const createdAt = ago(30);
      await putKey({
        provider: "fathom_webhook",
        secret: KEYS.fathom_webhook,
        state: "connected",
        meta: {
          webhookId: "wh_TEST0001",
          triggeredFor: ["shared_team_recordings"],
          createdAt,
          destination: "https://example.invalid/hook",
        },
      });
      expect(await syncRow("fathom-webhook")).toMatchObject({
        note: "Registered webhook ending 0001",
        detail: {
          registered: true,
          webhookIdLast4: "0001",
          registeredAt: createdAt,
          unregisteredAt: null,
        },
      });
      const { savedAt } = await keyOf("fathom_webhook");
      const unregisteredAt = ago(1);
      expect(
        await markKey({
          provider: "fathom_webhook",
          state: "refused",
          note: "Unregistered by the build session.",
          meta: { unregisteredAt },
          savedAt,
        }),
      ).toEqual({ ok: true, provider: "fathom_webhook", state: "refused" });
      expect(await syncRow("fathom-webhook")).toMatchObject({
        note: `Webhook ending 0001 unregistered at ${kuwaitTime(unregisteredAt)}`,
        detail: {
          registered: false,
          webhookIdLast4: "0001",
          registeredAt: createdAt,
          unregisteredAt,
        },
      });
      expect(
        await q(
          "SELECT before, after FROM public.cockpit_audit_log WHERE action='forms.keyState' AND entity_id='fathom_webhook'",
        ),
      ).toEqual([
        {
          before: { state: "connected", registered: true },
          after: { state: "refused", registered: false },
        },
      ]);
      const off = await status();
      expect(off.webhook.registered).toBe(false);
      expect(off.keys[1]).toMatchObject({
        connected: false,
        state: "refused",
        sentence: "Not registered: calls arrive by the 15-minute read.",
      });
      // A Fathom key in any state is saved, so the notes pull when they open.
      await putKey({
        provider: "fathom",
        secret: KEYS.fathom,
        state: "refused",
      });
      expect((await status()).keys[1].sentence).toBe(
        "Not registered: calls arrive by the 15-minute read and when the notes open.",
      );
      // A new registration is a new meta: the old unregisteredAt does not stick.
      await putKey({
        provider: "fathom_webhook",
        secret: "whsec_TESTTESTTESTTEST0002",
        state: "connected",
        meta: {
          webhookId: "wh_TEST0002",
          triggeredFor: ["shared_team_recordings"],
        },
      });
      expect(
        (
          await q(
            "SELECT meta FROM public.cockpit_forms_keys WHERE provider='fathom_webhook'",
          )
        )[0].meta,
      ).toEqual({
        webhookId: "wh_TEST0002",
        triggeredFor: ["shared_team_recordings"],
      });
      expect((await syncRow("fathom-webhook"))?.detail).toMatchObject({
        registered: true,
        webhookIdLast4: "0002",
        unregisteredAt: null,
      });
      expect((await status()).webhook.registered).toBe(true);
      // A key saved without a webhook id registers nothing.
      await putKey({
        provider: "fathom_webhook",
        secret: "whsec_TESTTESTTESTTEST0003",
        state: "connected",
      });
      expect(await syncRow("fathom-webhook")).toMatchObject({
        note: "The webhook key is saved without a webhook ID.",
        detail: { registered: false, webhookIdLast4: null },
      });
    });
  });
});

describe("cockpit_fathom_ingest", () => {
  test("a webhook item stores the meeting and its candidate row; a pull keeps the summary and merges raw; both clear the gone marks and keep the transcript", async () => {
    await rolledBack(async () => {
      const rec = newRecording();
      const actions = [
        {
          description: "Send the brand kit",
          assignee: { email: "csm@tests.invalid" },
        },
      ];
      const first = await ingest(
        [
          item(rec, {
            summary: "Invented webhook summary.",
            raw: {
              default_summary: {
                markdown_formatted: "Invented webhook summary.",
              },
              action_items: actions,
              meeting_url: "https://meet.google.com/abc-defg-hij?authuser=0",
            },
          }),
        ],
        "webhook",
      );
      const row = await callOf(rec);
      expect(first).toEqual({
        ok: true,
        meetings: 1,
        calls: [{ recordingId: rec, callId: row.id, taskId: null }],
      });
      expect(await meetingOf(rec)).toMatchObject({
        class: "candidate",
        summary: "Invented webhook summary.",
        room: "meet:abc-defg-hij",
        recorder_team: "Customer Success",
        missing_since: null,
        gone_at: null,
      });
      expect(row).toMatchObject({
        task_id: null,
        candidate: true,
        status: "held",
        provider_status: "recorded",
        kind: "other",
        room: "meet:abc-defg-hij",
        summary: "Invented webhook summary.",
      });
      // The worker stored the transcript; then Fathom briefly lost the call.
      await q(
        "UPDATE public.cockpit_fathom_meetings SET transcript_path='fathom/x.txt', missing_since=now(), gone_at=now() WHERE recording_id=$1",
        [rec],
      );
      await q(
        "UPDATE public.cockpit_csm_calls SET transcript_path='fathom/x.txt', transcript_text='[00:00:01] invented' WHERE id=$1",
        [row.id],
      );
      // A light pull: no summary, a raw without it.
      await ingest(
        [
          item(rec, {
            raw: {
              meeting_url: "https://meet.google.com/abc-defg-hij",
              calendar_invitees_domains_type: "one_or_more_external",
              from_pull: true,
            },
          }),
        ],
        "pull",
      );
      const pulled = await meetingOf(rec);
      expect(pulled).toMatchObject({
        summary: "Invented webhook summary.",
        transcript_path: "fathom/x.txt",
        missing_since: null,
        gone_at: null,
      });
      expect(pulled.raw).toMatchObject({
        default_summary: { markdown_formatted: "Invented webhook summary." },
        action_items: actions,
        from_pull: true,
      });
      expect(await callOf(rec)).toMatchObject({
        summary: "Invented webhook summary.",
        transcript_path: "fathom/x.txt",
        transcript_text: "[00:00:01] invented",
        raw_hash: null,
      });
      // A webhook is the full meeting: its values are the meeting's.
      await ingest(
        [
          item(rec, {
            summary: "Rewritten summary.",
            raw: {
              default_summary: { markdown_formatted: "Rewritten summary." },
            },
          }),
        ],
        "webhook",
      );
      const hooked = await meetingOf(rec);
      expect(hooked.summary).toBe("Rewritten summary.");
      expect("action_items" in hooked.raw).toBe(false);
      expect(hooked.transcript_path).toBe("fathom/x.txt");
      // Refusals.
      expect(
        await svcRefused(
          "SELECT public.cockpit_fathom_ingest('[]'::jsonb,'sms')",
        ),
      ).toBe("Choose pull or webhook.");
      expect(
        await svcRefused(
          "SELECT public.cockpit_fathom_ingest($1::jsonb,'pull')",
          [JSON.stringify(Array.from({ length: 51 }, () => item(rec)))],
        ),
      ).toBe("Send at most 50 meetings at a time.");
      expect(
        await svcRefused(
          "SELECT public.cockpit_fathom_ingest($1::jsonb,'pull')",
          [JSON.stringify([{ meeting: { recording_id: "abc" } }])],
        ),
      ).toBe("Each item needs a meeting with its recording ID.");
      expect(
        await ownerRefused(
          "SELECT public.cockpit_fathom_ingest('[]'::jsonb,'pull')",
        ),
      ).toBe("This hours function needs the service role");
    });
  });

  test("internal and sales meetings store no content, whatever the item says, and get no call row", async () => {
    await rolledBack(async () => {
      const content = {
        default_summary: { markdown_formatted: "Invented." },
        action_items: [{ description: "Invented" }],
        highlights: [{ text: "Invented" }],
        transcript: [{ text: "Invented" }],
      };
      for (const cls of ["internal", "sales"]) {
        const rec = newRecording();
        const r = await ingest(
          [item(rec, { cls, summary: "Invented.", raw: content })],
          cls === "sales" ? "webhook" : "pull",
        );
        expect(r).toEqual({ ok: true, meetings: 1, calls: [] });
        const m = await meetingOf(rec);
        expect([
          cls,
          m.class,
          m.summary,
          Object.keys(content).filter(k => k in m.raw),
        ]).toEqual([cls, cls, null, []]);
        expect(await callOf(rec)).toBeUndefined();
      }
    });
  });

  test("the light pull never turns a client or candidate meeting internal and strips nothing; the webhook and the worker change a class; a new meeting the pull calls internal keeps no content", async () => {
    await rolledBack(async () => {
      const summary = "Invented short-call summary.";
      const content = {
        default_summary: { markdown_formatted: summary },
        action_items: [{ description: "Invented action" }],
      };
      // A four-minute Customer Success call with a summary is a candidate; the
      // light list has no summary, so the pull classes it internal.
      const short = { start: ago(64), end: ago(60) };
      const light = (rec: string, o: { team?: string; by?: string } = {}) =>
        item(rec, {
          ...short,
          ...o,
          cls: "internal",
          raw: { from_pull: true },
          call: null,
        });
      for (const [cls, external] of [
        ["candidate", false],
        ["client", true],
      ] as const) {
        const rec = await meeting({
          ...short,
          cls,
          external,
          summary,
          raw: content,
        });
        await callRow(rec, { candidate: cls === "candidate", summary });
        expect(await ingest([light(rec)], "pull")).toEqual({
          ok: true,
          meetings: 1,
          calls: [],
        });
        const m = await meetingOf(rec);
        expect([
          cls,
          m.class,
          m.summary,
          m.raw.default_summary,
          m.raw.action_items,
          m.raw.from_pull,
        ]).toEqual([
          cls,
          cls,
          summary,
          content.default_summary,
          content.action_items,
          true,
        ]);
        expect(await callOf(rec)).toMatchObject({
          candidate: cls === "candidate",
          summary,
        });
      }
      // The webhook sees the whole meeting: its class stands, and the privacy rule with it.
      const hooked = await meeting({ ...short, summary, raw: content });
      await ingest(
        [
          item(hooked, {
            ...short,
            cls: "internal",
            summary,
            raw: content,
            call: null,
          }),
        ],
        "webhook",
      );
      const downgraded = await meetingOf(hooked);
      expect([
        downgraded.class,
        downgraded.summary,
        Object.keys(content).filter(k => k in downgraded.raw),
      ]).toEqual(["internal", null, []]);
      // The pull's first sight of a meeting it calls internal stores no content;
      // the worker, which sees the summary, re-classes it, and later pulls keep that.
      const firstSeen = newRecording();
      await ingest(
        [
          item(firstSeen, {
            ...short,
            cls: "internal",
            summary,
            raw: content,
            call: null,
          }),
        ],
        "pull",
      );
      const stored = await meetingOf(firstSeen);
      expect([
        stored.class,
        stored.summary,
        Object.keys(content).filter(k => k in stored.raw),
      ]).toEqual(["internal", null, []]);
      expect(await callOf(firstSeen)).toBeUndefined();
      await guarded(async () => {
        await asService();
        await db.query(
          "UPDATE public.cockpit_fathom_meetings SET class='candidate', summary=$2, raw=raw || $3::jsonb WHERE recording_id=$1",
          [firstSeen, summary, JSON.stringify(content)],
        );
      });
      await ingest([light(firstSeen)], "pull");
      expect(await meetingOf(firstSeen)).toMatchObject({
        class: "candidate",
        summary,
        raw: expect.objectContaining(content),
      });
      // The sales index still decides on a pull.
      const sold = await meeting({
        cls: "client",
        team: "Sales",
        by: "closer@tests.invalid",
        external: true,
        summary,
        raw: content,
      });
      await q(
        "INSERT INTO public.cockpit_sales_recordings(recording_id, hidden_reason) VALUES($1, NULL)",
        [sold],
      );
      await ingest(
        [light(sold, { team: "Sales", by: "closer@tests.invalid" })],
        "pull",
      );
      expect(await meetingOf(sold)).toMatchObject({
        class: "sales",
        summary: null,
      });
    });
  });

  test("the sales index decides, whatever the item says: a Sales-team recording in it is sales; a Customer Success one, or one marked client service, keeps its content", async () => {
    await rolledBack(async () => {
      const content = (text: string) => ({
        default_summary: { markdown_formatted: text },
        action_items: [{ description: `${text} action` }],
      });
      const index = (rec: string, reason: string | null) =>
        q(
          "INSERT INTO public.cockpit_sales_recordings(recording_id, hidden_reason) VALUES($1,$2)",
          [rec, reason],
        );
      // A Sales-team recording in the index: the callers' class is overruled.
      const sales = newRecording();
      await index(sales, null);
      await ingest(
        [
          item(sales, {
            cls: "client",
            team: "Sales",
            by: "closer@tests.invalid",
            external: true,
            summary: "Sales talk.",
            raw: content("Sales talk."),
          }),
        ],
        "webhook",
      );
      expect(await meetingOf(sales)).toMatchObject({
        class: "sales",
        summary: null,
      });
      expect("action_items" in (await meetingOf(sales)).raw).toBe(false);
      expect(await callOf(sales)).toBeUndefined();
      // Customer Success recordings in the index, marked client service or not.
      for (const reason of ["client service", null]) {
        const rec = newRecording();
        await index(rec, reason);
        await ingest(
          [
            item(rec, {
              cls: null,
              summary: "Client talk.",
              raw: content("Client talk."),
            }),
          ],
          "webhook",
        );
        const m = await meetingOf(rec);
        expect([reason, m.class, m.summary, m.raw.action_items]).toEqual([
          reason,
          "candidate",
          "Client talk.",
          [{ description: "Client talk. action" }],
        ]);
        expect((await callOf(rec)).candidate).toBe(true);
      }
      // A Sales-team external recording the desk marked client service, on a client.
      const served = newRecording();
      await index(served, "client service");
      await ingest(
        [
          item(served, {
            cls: "client",
            team: "Sales",
            by: "closer@tests.invalid",
            external: true,
            summary: "Acme check-in talk.",
            raw: content("Acme check-in talk."),
            call: {
              task_id: A,
              client_name: "Acme Interiors",
              match_method: "invitee_email",
              match_confidence: 1,
              kind: "checkin",
              candidate: false,
            },
          }),
        ],
        "webhook",
      );
      expect(await meetingOf(served)).toMatchObject({
        class: "client",
        summary: "Acme check-in talk.",
      });
      expect(await callOf(served)).toMatchObject({
        task_id: A,
        match_method: "invitee_email",
        kind: "checkin",
        candidate: false,
        summary: "Acme check-in talk.",
      });
    });
  });

  test("a row already on a client keeps its whole match block; an unmatched row takes the item's, but never loses its link; a settled row stays settled", async () => {
    await rolledBack(async () => {
      const bA = await booking(A, { start: ago(200), kind: "onboarding" });
      const bC = await booking(C, { start: ago(200) });
      const block = (rec: string) =>
        callOf(rec).then(r => ({
          task_id: r.task_id,
          client_name: r.client_name,
          match_method: r.match_method,
          confidence: r.confidence,
          linked_call_id: r.linked_call_id,
          kind: r.kind,
          candidate: r.candidate,
        }));
      // The worker matched it by time to an onboarding booking.
      const matched = await meeting({ external: true, cls: "client" });
      await callRow(matched, {
        task: A,
        method: "appointment_time",
        confidence: 0.9,
        linked: bA,
        kind: "onboarding",
      });
      const kept = {
        task_id: A,
        client_name: "Acme Interiors",
        match_method: "appointment_time",
        confidence: 0.9,
        linked_call_id: bA,
        kind: "onboarding",
        candidate: false,
      };
      for (const call of [
        { task_id: null, kind: "other", linked_call_id: null, candidate: true },
        {
          task_id: C,
          client_name: "Cedar Homes",
          match_method: "same_room",
          match_confidence: 1,
          linked_call_id: bC,
          kind: "checkin",
        },
      ]) {
        for (const via of ["pull", "webhook"] as const) {
          await ingest(
            [item(matched, { cls: "client", external: true, call })],
            via,
          );
          expect([call.task_id, via, await block(matched)]).toEqual([
            call.task_id,
            via,
            kept,
          ]);
        }
      }
      // A manual match (the queue's "This is {client}") is kept the same way.
      const manual = await meeting();
      await callRow(manual, { task: B, method: "manual", kind: "checkin" });
      await ingest(
        [
          item(manual, {
            call: {
              task_id: C,
              match_method: "same_room",
              match_confidence: 1,
              kind: "other",
            },
          }),
        ],
        "webhook",
      );
      expect(await block(manual)).toMatchObject({
        task_id: B,
        match_method: "manual",
        kind: "checkin",
      });
      // An unmatched row: the item's block is written, and a stored link stays.
      const loose = await meeting();
      await callRow(loose, { candidate: true, linked: bC, kind: "checkin" });
      await ingest(
        [item(loose, { call: { linked_call_id: null, kind: "other" } })],
        "pull",
      );
      expect(await block(loose)).toMatchObject({
        task_id: null,
        linked_call_id: bC,
        kind: "other",
        candidate: true,
      });
      // An exact match in the item puts it on the client and ends the candidate.
      await ingest(
        [
          item(loose, {
            call: {
              task_id: C,
              client_name: "Cedar Homes",
              match_method: "same_room",
              match_confidence: 1,
              linked_call_id: bC,
              kind: "checkin",
              candidate: true,
            },
          }),
        ],
        "webhook",
      );
      expect(await block(loose)).toEqual({
        task_id: C,
        client_name: "Cedar Homes",
        match_method: "same_room",
        confidence: 1,
        linked_call_id: bC,
        kind: "checkin",
        candidate: false,
      });
      // Set aside as not a 1-1 call: settled, never a candidate again, and no
      // hints at all, its own included (A7.13).
      const settled = await meeting();
      await callRow(settled, {
        settled: "onboarding",
        hints: [
          { taskId: A, clientName: "Acme Interiors", why: "near_booking" },
        ],
      });
      for (const via of ["pull", "webhook"] as const)
        await ingest(
          [
            item(settled, {
              call: {
                candidate: true,
                hints: [{ taskId: C, clientName: "Cedar Homes", why: "title" }],
              },
            }),
          ],
          via,
        );
      expect(await callOf(settled)).toMatchObject({
        task_id: null,
        candidate: false,
        settled_reason: "onboarding",
        hints: [],
        raw_hash: "hash-test",
      });
    });
  });

  test("a settled row stays on no client (A7.13): an item's exact block, by pull or by webhook, leaves its stored block and its reason; only a person places it", async () => {
    await rolledBack(async () => {
      const block = (rec: string) =>
        callOf(rec).then(r => ({
          task_id: r.task_id,
          client_name: r.client_name,
          match_method: r.match_method,
          confidence: r.confidence,
          linked_call_id: r.linked_call_id,
          kind: r.kind,
          candidate: r.candidate,
          settled_reason: r.settled_reason,
          hints: r.hints,
        }));
      // The CSM set an impromptu call aside as onboarding; GoHighLevel later
      // syncs the onboarding booking in the same Meet room, 10 minutes apart.
      const room = "meet:kln-opqr-stu";
      const start = ago(130);
      const rec = await meeting({ start, room });
      await callRow(rec, { settled: "onboarding", start, room });
      const onboarding = await booking(A, {
        start: ago(140),
        kind: "onboarding",
        room,
      });
      const kept = {
        task_id: null,
        client_name: null,
        match_method: null,
        confidence: null,
        linked_call_id: null,
        kind: "other",
        candidate: false,
        settled_reason: "onboarding",
        hints: [],
      };
      for (const via of ["pull", "webhook", "pull"] as const) {
        const r = await ingest(
          [
            item(rec, {
              start,
              room,
              call: {
                task_id: A,
                client_name: "Acme Interiors",
                match_method: "same_room",
                match_confidence: 1,
                linked_call_id: onboarding,
                kind: "onboarding",
                candidate: false,
                hints: [
                  {
                    taskId: A,
                    clientName: "Acme Interiors",
                    why: "near_booking",
                  },
                ],
              },
            }),
          ],
          via,
        );
        expect(r.calls).toEqual([
          { recordingId: rec, callId: expect.any(Number), taskId: null },
        ]);
        expect([via, await block(rec)]).toEqual([via, kept]);
      }
      // A stored link stays as it is too.
      const linked = await meeting({ start, room });
      await callRow(linked, {
        settled: "part_of_call",
        start,
        room,
        linked: onboarding,
        kind: "onboarding",
      });
      await ingest(
        [
          item(linked, {
            start,
            room,
            call: {
              task_id: A,
              match_method: "same_room",
              match_confidence: 1,
              linked_call_id: null,
              kind: "checkin",
            },
          }),
        ],
        "webhook",
      );
      expect(await block(linked)).toEqual({
        ...kept,
        linked_call_id: onboarding,
        kind: "onboarding",
        settled_reason: "part_of_call",
      });
      // The client's timeline does not show it: not as a call, not on the booking.
      const recRow = (await callOf(rec)).id;
      const timeline = await one(
        CSM,
        "SELECT public.cockpit_csm_client_timeline($1) r",
        [A],
      );
      expect(timeline.calls.map((c: Row) => c.id)).toContain(onboarding);
      expect(timeline.calls.map((c: Row) => c.id)).not.toContain(recRow);
      expect(
        timeline.calls.map((c: Row) => c.recordingUrl ?? null),
      ).not.toContain(shareOf(rec));
      // The person's "This is {client}" does place it, and clears the reason.
      const queue = await queueItem(String(recRow));
      await one(CSM, "SELECT public.cockpit_csm_manual_match($1,$2) r", [
        queue,
        A,
      ]);
      expect(await block(rec)).toMatchObject({
        task_id: A,
        match_method: "manual",
        settled_reason: null,
        hints: [],
      });
    });
  });

  test("hints only on an unplaced, unsettled candidate (A7.12, A7.13): a row that ends on a client stores none, and so does a settled row or an item that is not a candidate, whatever the item says", async () => {
    await rolledBack(async () => {
      const bC = await booking(C, { start: ago(200) });
      const stored = [
        { taskId: A, clientName: "Acme Interiors", why: "near_booking" },
      ];
      const offered = [
        { taskId: C, clientName: "Cedar Homes", why: "title" },
        { taskId: B, clientName: "Beta Build", why: "domain" },
      ];
      // Four break the column's limit of three: written, they would fail the batch.
      const tooMany = [...offered, ...offered];
      const exact = {
        task_id: C,
        client_name: "Cedar Homes",
        match_method: "same_room",
        match_confidence: 1,
        linked_call_id: bC,
        kind: "checkin",
        candidate: false,
      };
      const state = (rec: string) =>
        callOf(rec).then(r => ({
          task_id: r.task_id,
          candidate: r.candidate,
          settled_reason: r.settled_reason,
          hints: r.hints,
        }));
      for (const via of ["pull", "webhook"] as const) {
        // A candidate on no client takes the item's hints.
        const loose = await meeting();
        await callRow(loose, { candidate: true, hints: stored });
        await ingest([item(loose, { call: { hints: offered } })], via);
        expect([via, await state(loose)]).toEqual([
          via,
          {
            task_id: null,
            candidate: true,
            settled_reason: null,
            hints: offered,
          },
        ]);
        // The item's exact block puts it on a client: the hints the item
        // still carries are not written, and the stored ones go.
        await ingest(
          [item(loose, { call: { ...exact, hints: tooMany } })],
          via,
        );
        expect([via, await state(loose)]).toEqual([
          via,
          { task_id: C, candidate: false, settled_reason: null, hints: [] },
        ]);
        // A row the worker matched, still holding hints from before A7.12:
        // an item that found no match keeps the block and clears them.
        const matched = await meeting({ external: true, cls: "client" });
        await callRow(matched, {
          task: A,
          method: "appointment_time",
          confidence: 0.9,
          hints: stored,
        });
        await ingest(
          [
            item(matched, {
              cls: "client",
              external: true,
              call: { candidate: false, hints: offered },
            }),
          ],
          via,
        );
        expect([via, await state(matched)]).toEqual([
          via,
          { task_id: A, candidate: false, settled_reason: null, hints: [] },
        ]);
        // A person's match ("This is {client}") the same way.
        const manual = await meeting();
        await callRow(manual, {
          task: B,
          method: "manual",
          kind: "checkin",
          hints: stored,
        });
        await ingest(
          [item(manual, { call: { candidate: true, hints: tooMany } })],
          via,
        );
        expect([via, await state(manual)]).toEqual([
          via,
          { task_id: B, candidate: false, settled_reason: null, hints: [] },
        ]);
        // Set aside as not a 1-1 call and on no client, still holding hints
        // from before A7.13: the item's never land and its own go.
        const settled = await meeting();
        await callRow(settled, { settled: "not_client", hints: stored });
        await ingest(
          [item(settled, { call: { candidate: true, hints: offered } })],
          via,
        );
        expect([via, await state(settled)]).toEqual([
          via,
          {
            task_id: null,
            candidate: false,
            settled_reason: "not_client",
            hints: [],
          },
        ]);
        // An item's exact block over a settled row: the row stays on no
        // client with its reason (A7.13), and still stores no hints.
        await ingest(
          [item(settled, { call: { ...exact, hints: offered } })],
          via,
        );
        expect([via, await state(settled)]).toEqual([
          via,
          {
            task_id: null,
            candidate: false,
            settled_reason: "not_client",
            hints: [],
          },
        ]);
        // An unplaced, unsettled row the item does not call a candidate (a
        // client-class recording with no match): no hints either.
        const plain = await meeting({ external: true, cls: "client" });
        await callRow(plain, { candidate: false, hints: stored });
        await ingest(
          [
            item(plain, {
              cls: "client",
              external: true,
              call: { candidate: false, hints: offered },
            }),
          ],
          via,
        );
        expect([via, await state(plain)]).toEqual([
          via,
          {
            task_id: null,
            candidate: false,
            settled_reason: null,
            hints: [],
          },
        ]);
      }
    });
  });

  test("after the worker's same-room match, a webhook item and a pull item, in either order, leave one call on the client page with the booking's kind", async () => {
    for (const order of [
      ["webhook", "pull"],
      ["pull", "webhook"],
    ] as const)
      await rolledBack(async () => {
        const booked = await booking(A, {
          start: ago(400),
          room: "meet:vwx-yzab-cde",
        });
        const rec = await meeting({
          start: ago(395),
          end: ago(365),
          room: "meet:vwx-yzab-cde",
        });
        // The worker, with the service key: the same-room match names the booking.
        await guarded(async () => {
          await asService();
          await db.query(
            `INSERT INTO public.cockpit_csm_calls AS c (source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
               starts_at,ends_at,status,provider_status,host_email,recording_url,summary,linked_call_id,room,candidate)
             VALUES('fathom',$1,$2,'Acme Interiors','same_room',1,'checkin','Impromptu Google Meet Meeting',$3,$4,'held','recorded',
                    'csm@tests.invalid',$5,'Invented summary.',$6,'meet:vwx-yzab-cde',false)
             ON CONFLICT (source, source_id) DO UPDATE SET task_id=EXCLUDED.task_id, linked_call_id=EXCLUDED.linked_call_id,
               kind=EXCLUDED.kind, updated_at=now()`,
            [rec, A, ago(395), ago(365), shareOf(rec), booked],
          );
        });
        const items = {
          webhook: item(rec, {
            start: ago(395),
            end: ago(365),
            room: "meet:vwx-yzab-cde",
            summary: "Invented summary.",
            call: {
              task_id: A,
              client_name: "Acme Interiors",
              match_method: "same_room",
              match_confidence: 1,
              linked_call_id: booked,
              kind: "checkin",
              candidate: false,
            },
          }),
          // The light pull computed no match: an empty block.
          pull: item(rec, {
            start: ago(395),
            end: ago(365),
            room: "meet:vwx-yzab-cde",
            call: { task_id: null, kind: "other", linked_call_id: null },
          }),
        };
        for (const via of order) await ingest([items[via]], via);
        const row = await callOf(rec);
        expect([
          order.join(" then "),
          row.task_id,
          row.linked_call_id,
          row.kind,
          row.match_method,
        ]).toEqual([order.join(" then "), A, booked, "checkin", "same_room"]);
        const timeline = await one(
          CSM,
          "SELECT public.cockpit_csm_client_timeline($1) r",
          [A],
        );
        const shown = timeline.calls.filter((c: Row) =>
          [booked, row.id].includes(c.id),
        );
        expect(
          shown.map((c: Row) => [c.id, c.kind, c.recordingUrl, c.summary]),
        ).toEqual([[booked, "checkin", shareOf(rec), "Invented summary."]]);
      });
  });
});

describe("cockpit_fathom_match_inputs", () => {
  const INPUTS = "SELECT public.cockpit_fathom_match_inputs($1,$2,$3) r";
  const inputs = (from: string, to: string, task: string | null = null) =>
    svc(INPUTS, [from, to, task]);

  test("the keys of 3.5; bookings of the window and two hours around it, every status but gone; the client only when a card is asked for", async () => {
    await rolledBack(async () => {
      const inside = await booking(A, {
        start: ago(300),
        room: "meet:abc-defg-hij",
      });
      const cancelled = await booking(B, {
        start: ago(200),
        status: "cancelled",
      });
      const early = await booking(C, { start: ago(24 * 60 + 100) });
      const future = await booking(A, { start: ago(-90) });
      const gone = await booking(A, { start: ago(250), status: "gone" });
      const outside = await booking(C, { start: ago(24 * 60 + 130) });
      const all = await inputs(ago(24 * 60), ago(0));
      expect(Object.keys(all).sort()).toEqual([
        "bookings",
        "client",
        "clients",
        "csmEmails",
        "formLinks",
        "from",
        "sales",
        "staff",
        "store",
        "to",
      ]);
      expect(all.client).toBeNull();
      const ids = all.bookings.map((b: Row) => b.id);
      for (const id of [inside, cancelled, early, future])
        expect(ids).toContain(id);
      for (const id of [gone, outside]) expect(ids).not.toContain(id);
      expect(all.bookings.find((b: Row) => b.id === inside)).toEqual({
        id: inside,
        taskId: A,
        clientName: "Acme Interiors",
        kind: "checkin",
        status: "confirmed",
        startsAt: expect.any(String),
        endsAt: null,
        room: "meet:abc-defg-hij",
        emails: ["owner@client.invalid"],
        contactNames: ["Invented Owner"],
      });
      expect(all.bookings.find((b: Row) => b.id === cancelled).status).toBe(
        "cancelled",
      );
      expect(Object.keys(all.store[0]).sort()).toEqual([
        "actionItems",
        "callId",
        "class",
        "editedTitle",
        "endsAt",
        "gone",
        "hasSummary",
        "hasTranscript",
        "inviteeEmails",
        "linkedCallId",
        "meetingTitle",
        "notes",
        "onTask",
        "onTaskConfidence",
        "onTaskMethod",
        "recorderEmail",
        "recorderTeam",
        "recordingId",
        "room",
        "settled",
        "shareUrl",
        "startsAt",
        "title",
      ]);
      expect(all.clients).toEqual([
        {
          taskId: A,
          name: "Acme Interiors",
          aliases: ["Acme", "Acme Interiors"],
        },
        { taskId: B, name: "Beta Build", aliases: [] },
        { taskId: C, name: "Cedar Homes", aliases: [] },
      ]);
      // The store item of 103: on Acme by invitee email, indexed client service.
      expect(
        all.store.find((s: Row) => s.recordingId === "900000103"),
      ).toMatchObject({
        class: "client",
        onTask: A,
        onTaskMethod: "invitee_email",
        onTaskConfidence: 1,
        recorderEmail: "closer@tests.invalid",
        recorderTeam: "Sales",
        shareUrl: shareOf("900000103"),
        inviteeEmails: ["owner@acme.invalid"],
        gone: false,
        settled: false,
        hasSummary: true,
        hasTranscript: false,
        actionItems: null,
        notes: null,
      });
      const acme = await inputs(ago(24 * 60), ago(0), A);
      expect(acme.client).toEqual({
        taskId: A,
        name: "Acme Interiors",
        lastNoteAt: null,
        onClient: [
          {
            recordingId: "900000103",
            callId: (await callOf("900000103")).id,
            method: "invitee_email",
            confidence: 1,
            startsAt: expect.any(String),
          },
        ],
      });
      expect(await svcRefused(INPUTS, [ago(0), ago(60), null])).toBe(
        "Choose a window: from, then to.",
      );
      expect(await svcRefused(INPUTS, [ago(60), ago(0), "not a card"])).toBe(
        "Choose a valid ClickUp client ID",
      );
    });
  });

  test("editedTitle is Fathom's own title as stored in raw, null when Fathom sent none; title keeps its calendar fallback (A7.13)", async () => {
    await rolledBack(async () => {
      const window = [ago(6 * 60), ago(0)] as const;
      const edited = await meeting({
        start: ago(100),
        end: ago(70),
        title: "Acme Interiors check-in",
        raw: { title: "Acme Interiors check-in", meeting_title: "Weekly sync" },
      });
      // The worker's title column falls back to meeting_title when Fathom sent no title.
      const untitled = await meeting({
        start: ago(100),
        end: ago(70),
        title: "Weekly sync",
        raw: { meeting_title: "Weekly sync" },
      });
      const odd = await meeting({
        start: ago(100),
        end: ago(70),
        title: "Weekly sync",
        raw: { title: null, meeting_title: "Weekly sync" },
      });
      const all = await inputs(...window);
      const of = (rec: string) =>
        all.store.find((s: Row) => s.recordingId === rec);
      expect(
        [edited, untitled, odd].map(rec => [
          of(rec).title,
          of(rec).editedTitle,
          of(rec).meetingTitle,
        ]),
      ).toEqual([
        ["Acme Interiors check-in", "Acme Interiors check-in", "Weekly sync"],
        ["Weekly sync", null, "Weekly sync"],
        ["Weekly sync", null, "Weekly sync"],
      ]);
      // An ingest item stores Fathom's raw title too, and the item reads it back.
      const viaHook = newRecording();
      const hook = item(viaHook, {
        start: ago(100),
        end: ago(70),
        raw: { title: "Cedar Homes launch", meeting_title: "Launch" },
      });
      await ingest([hook], "webhook");
      const again = await inputs(...window);
      expect(
        again.store.find((s: Row) => s.recordingId === viaHook).editedTitle,
      ).toBe("Cedar Homes launch");
    });
  });

  test("onTaskConfidence and onClient's confidence carry the call row's match_confidence beside its method, so the door reads rule 2 as the save does (A7.14 rule 2, round 3): a name row 0.6, a company-domain row 0.8, a known contact 0.9; null on no card and with no call row", async () => {
    await rolledBack(async () => {
      const window = [ago(6 * 60), ago(0)] as const;
      const closer = (start: number) =>
        meeting({
          by: "closer@tests.invalid",
          team: "Sales",
          cls: "client",
          start: ago(start),
          end: ago(start - 30),
        });
      const byName = await closer(100);
      await callRow(byName, {
        task: C,
        method: "name",
        confidence: 0.6,
        start: ago(100),
      });
      const byDomain = await closer(110);
      await callRow(byDomain, {
        task: C,
        method: "invitee_email",
        confidence: 0.8,
        start: ago(110),
      });
      const known = await closer(120);
      await callRow(known, {
        task: C,
        method: "invitee_email",
        confidence: 0.9,
        start: ago(120),
      });
      const loose = await closer(130);
      await callRow(loose, { candidate: true, start: ago(130) });
      const bare = await closer(140);
      const cedar = await inputs(...window, C);
      const of = (rec: string) =>
        cedar.store.find((s: Row) => s.recordingId === rec);
      expect(
        [byName, byDomain, known, loose, bare].map(rec => [
          of(rec).onTask,
          of(rec).onTaskMethod,
          of(rec).onTaskConfidence,
        ]),
      ).toEqual([
        [C, "name", 0.6],
        [C, "invitee_email", 0.8],
        [C, "invitee_email", 0.9],
        [null, null, null],
        [null, null, null],
      ]);
      expect(
        cedar.client.onClient.map((o: Row) => [
          o.recordingId,
          o.method,
          o.confidence,
        ]),
      ).toEqual([
        [byName, "name", 0.6],
        [byDomain, "invitee_email", 0.8],
        [known, "invitee_email", 0.9],
      ]);
      // A pasted link finds the same item, its confidence included.
      expect(
        (
          await svc("SELECT public.cockpit_fathom_find_link($1) r", [
            shareOf(byDomain),
          ])
        ).store,
      ).toMatchObject({
        recordingId: byDomain,
        onTask: C,
        onTaskMethod: "invitee_email",
        onTaskConfidence: 0.8,
      });
    });
  });

  test("onClient holds only a call row of this card whose recording may be offered: one now sales or internal, gone in the store or on the row, with no store row, or older than 14 days is left out (5.2; the item carries no class, so missing is never a guess)", async () => {
    await rolledBack(async () => {
      const window = [ago(6 * 60), ago(0)] as const;
      // Days before the window, so each reaches the door through onClient alone.
      const older = async (
        days: number,
        cls: string,
        method: string,
        o: { team?: string; status?: string } = {},
      ) => {
        const start = ago(days * 24 * 60);
        const rec = await meeting({
          by: o.team === "Sales" ? "closer@tests.invalid" : undefined,
          team: o.team,
          cls,
          start,
          end: ago(days * 24 * 60 - 30),
        });
        await callRow(rec, {
          task: C,
          method,
          confidence: 1,
          start,
          status: o.status,
        });
        return rec;
      };
      const client = await older(2, "client", "appointment_time", {
        team: "Sales",
      });
      const candidate = await older(3, "candidate", "same_room");
      // A closer's call placed on Cedar by its booking, then indexed as sales.
      const sales = await older(4, "sales", "appointment_time", {
        team: "Sales",
      });
      const internal = await older(5, "internal", "manual");
      const goneInStore = await older(6, "client", "appointment_time");
      await q(
        "UPDATE public.cockpit_fathom_meetings SET gone_at = now() WHERE recording_id=$1",
        [goneInStore],
      );
      const goneRow = await older(7, "client", "appointment_time", {
        status: "gone",
      });
      const stale = await older(15, "client", "appointment_time");
      // A call row whose recording has no store row: no class is known.
      const unstored = newRecording();
      await callRow(unstored, {
        task: C,
        method: "appointment_time",
        confidence: 1,
        start: ago(8 * 24 * 60),
      });
      const cedar = await inputs(...window, C);
      expect(
        cedar.client.onClient.map((o: Row) => [o.recordingId, o.method]),
      ).toEqual([
        [client, "appointment_time"],
        [candidate, "same_room"],
      ]);
      for (const rec of [
        sales,
        internal,
        goneInStore,
        goneRow,
        stale,
        unstored,
      ])
        expect(
          cedar.client.onClient.some((o: Row) => o.recordingId === rec),
        ).toBe(false);
      // The rows themselves are left as written.
      expect((await callOf(sales)).task_id).toBe(C);
      expect((await meetingOf(sales)).class).toBe("sales");
    });
  });

  test("a shadow run feeds nothing: its share link is in no form link, no lastNoteAt and no store notes; a live send and a Typeform form are", async () => {
    const rec = await meeting({ start: ago(100), end: ago(70) });
    const id = RID(101);
    await fresh(CSM, A, id);
    const saved = await save(CSM, id, {
      call: fathomCall(rec),
      defcon: "Happy",
      priority: "Medium",
    });
    expect((await submit(CSM, id, saved.row.revision)).response.mode).toBe(
      "shadow",
    );
    const window = [ago(6 * 60), ago(0), A];
    const after = await svc(INPUTS, window);
    expect(after.formLinks.map((l: Row) => l.shareUrl)).not.toContain(
      shareOf(rec),
    );
    expect(after.client.lastNoteAt).toBeNull();
    expect(
      after.store.find((s: Row) => s.recordingId === rec).notes,
    ).toBeNull();
    await rolledBack(async () => {
      await q(
        "UPDATE public.cockpit_forms SET provider='native' WHERE key='checkin'",
      );
      const live = RID(102);
      await fresh(CEO, A, live);
      const r = await save(CEO, live, {
        call: fathomCall(rec),
        defcon: "Happy",
        priority: "Medium",
      });
      const sent = await submit(CEO, live, r.row.revision);
      expect(sent.response.mode).toBe("live");
      const read = await svc(INPUTS, window);
      expect(read.store.find((s: Row) => s.recordingId === rec).notes).toEqual({
        at: sent.response.submittedAt,
        source: "cockpit",
      });
      expect(read.client.lastNoteAt).toBe(sent.response.submittedAt);
      expect(read.formLinks.map((l: Row) => l.shareUrl)).not.toContain(
        shareOf(rec),
      );
    });
    await rolledBack(async () => {
      const at = ago(30);
      await q(
        `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at,answers)
         VALUES('tf-intake-1','fRokTITH','checkin',$1,'hidden_field',$2,$3::jsonb)`,
        [
          A,
          at,
          JSON.stringify([
            {
              ref: "c484f390-9695-4ffa-9693-9cc219592713",
              type: "short_text",
              title: "Client ID",
              value: A,
            },
            {
              ref: "x",
              type: "long_text",
              title: "Clients Call Transcript",
              value: `${shareOf(rec)}?timestamp=12`,
            },
          ]),
        ],
      );
      const read = await svc(INPUTS, window);
      expect(read.formLinks).toContainEqual({
        shareUrl: shareOf(rec),
        taskId: A,
      });
      expect(read.client.lastNoteAt).toBe(await jsonTime(at));
      // The Typeform row names the link in its answers, not as recording_url: the
      // store's notes follow recording_url or the call link only.
      expect(
        read.store.find((s: Row) => s.recordingId === rec).notes,
      ).toBeNull();
      await q(
        "UPDATE public.cockpit_csm_call_forms SET recording_url=$1 WHERE token='tf-intake-1'",
        [shareOf(rec)],
      );
      expect(
        (await svc(INPUTS, window)).store.find(
          (s: Row) => s.recordingId === rec,
        ).notes,
      ).toEqual({
        at: await jsonTime(at),
        source: "typeform",
      });
    });
  });

  test("csmEmails holds only the CSM's own seats, never the CEO's or an admin's; every staff entry carries its role", async () => {
    await rolledBack(async () => {
      await member(
        db,
        "00000000-0000-4000-8000-0000000000e1",
        "lead@tests.invalid",
        ["csm", "admin"],
      );
      await member(
        db,
        "00000000-0000-4000-8000-0000000000e2",
        "owner-seat@tests.invalid",
        ["csm", "ceo"],
      );
      await q(
        "UPDATE public.cockpit_members SET roles=ARRAY['csm'] WHERE email='aziz@maharamedia.com'",
      );
      await q(
        "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES('Left Test','left@tests.invalid','Designer',false,'test')",
      );
      const all = await svc(INPUTS, [ago(60), ago(0), null]);
      expect(all.csmEmails).toEqual([
        "csm-b@tests.invalid",
        "csm@tests.invalid",
      ]);
      expect(all.staff).toEqual([
        { name: "Noura Test", email: "csm@tests.invalid", role: "the CSM" },
        { name: "Sara Test", email: "csm-b@tests.invalid", role: "the CSM" },
        {
          name: "Omar Test",
          email: "creative@tests.invalid",
          role: "a team member",
        },
        { name: "Aziz Test", email: "aziz@maharamedia.com", role: "the CEO" },
      ]);
    });
  });

  test("sales: the window's indexed recordings, but not one marked client service and not a Customer Success one", async () => {
    const all = await svc(INPUTS, [ago(24 * 60), ago(0), null]);
    expect(all.sales).toEqual(["900000102"]);
  });
});

describe("cockpit_fathom_find_link", () => {
  test("a pasted link is normalised and found in the whole store, whatever its date; a Fathom link not stored and a link that is not Fathom's say so", async () => {
    const old = await meeting({
      start: ago(120 * 24 * 60),
      end: ago(120 * 24 * 60 - 30),
    });
    const find = (url: string | null) =>
      svc("SELECT public.cockpit_fathom_find_link($1) r", [url]);
    const found = (rec: string) => ({
      found: true,
      store: expect.objectContaining({
        recordingId: rec,
        shareUrl: shareOf(rec),
      }),
    });
    for (const url of [
      shareOf("900000101"),
      `${shareOf("900000101")}?timestamp=120`,
      `${shareOf("900000101")}?tab=summary&timestamp=95.5`,
      `${shareOf("900000101")}#transcript`,
      `${shareOf("900000101")}/`,
      `HTTPS://FATHOM.VIDEO/share/test-900000101`,
      `  https://www.fathom.video/share/test-900000101  `,
      "fathom.video/share/test-900000101",
      callsUrlOf("900000101"),
      `${callsUrlOf("900000101")}?timestamp=3`,
    ])
      expect([url, await find(url)]).toEqual([url, found("900000101")]);
    expect(await find(shareOf(old))).toEqual(found(old));
    expect(await find(`${callsUrlOf(old)}/`)).toEqual(found(old));
    // The token keeps its case.
    expect(await find("https://fathom.video/share/TEST-900000101")).toEqual({
      found: false,
      fathom: true,
    });
    for (const url of [
      "https://fathom.video/share/not-stored-yet",
      "https://fathom.video/calls/123456789",
    ])
      expect([url, await find(url)]).toEqual([
        url,
        { found: false, fathom: true },
      ]);
    for (const url of [
      "https://zoom.us/j/12345678901",
      "https://fathom.video.example.invalid/share/test-900000101",
      "https://example.invalid/?u=https://fathom.video/share/test-900000101",
      "https://fathom.video/calls/abc",
      "https://fathom.video/",
      "",
      null,
    ])
      expect([url, await find(url)]).toEqual([
        url,
        { found: false, fathom: false },
      ]);
  });
});

describe("the drafts' read of the store and the doctor's numbers", () => {
  const INPUTS = "SELECT public.cockpit_form_draft_inputs($1,$2) r";
  test("cockpit_form_draft_inputs: content only for a client or candidate recording, the staff with their roles, the card, the last 1-1 form", async () => {
    await rolledBack(async () => {
      const actions = [
        {
          description: "Send the brand kit",
          assignee: { email: "csm@tests.invalid" },
        },
      ];
      const rec = await meeting({
        cls: "client",
        external: true,
        raw: { action_items: actions },
        summary: "Invented summary.",
      });
      await callRow(rec, {
        task: A,
        method: "invitee_email",
        transcriptPath: "fathom/call-only.txt",
      });
      const forms = `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at,answers)
        VALUES($1,'fRokTITH','checkin',$2,'hidden_field',$3,$4::jsonb)`;
      const answers = (
        defcon: string,
        priority: string,
        notes: string,
        more: string,
      ) =>
        JSON.stringify([
          {
            ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
            type: "multiple_choice",
            title: "Defcon Status",
            value: defcon,
          },
          {
            ref: "c9f99fb1-fec9-47e7-9baa-c5554733723d",
            type: "multiple_choice",
            title: "Task Priority",
            value: [priority],
          },
          {
            ref: "5d071906-da6a-4413-a729-0c76d0188d91",
            type: "long_text",
            title: "Client Notes",
            value: notes,
          },
          {
            ref: "82a6b434-15d9-4a14-8496-c20c94628536",
            type: "long_text",
            title: "Additional Notes",
            value: more,
          },
        ]);
      const newer = ago(60);
      await q(forms, [
        "tf-draft-1",
        A,
        ago(600),
        answers("Neutral", "Low", "Older.", "Mahara: older"),
      ]);
      await q(forms, [
        "tf-draft-2",
        A,
        newer,
        answers(
          "Happy",
          "High",
          "Calm, asked for a shoot.",
          "Mahara: Send the kit",
        ),
      ]);
      const r = await svc(INPUTS, [A, rec]);
      expect(Object.keys(r).sort()).toEqual([
        "actionItems",
        "class",
        "client",
        "endsAt",
        "gone",
        "lastForm",
        "recorderEmail",
        "recorderName",
        "recordingId",
        "shareUrl",
        "staff",
        "startsAt",
        "summary",
        "title",
        "transcriptPath",
      ]);
      expect(r).toMatchObject({
        recordingId: rec,
        class: "client",
        gone: false,
        summary: "Invented summary.",
        actionItems: actions,
        transcriptPath: "fathom/call-only.txt",
        shareUrl: shareOf(rec),
        recorderEmail: "csm@tests.invalid",
        recorderName: "Invented Recorder",
        client: {
          taskId: A,
          name: "Acme Interiors",
          stage: "Active",
          happiness: "Happy",
        },
        lastForm: {
          defcon: "Happy",
          priority: "High",
          notes: "Calm, asked for a shoot.\n\nMahara: Send the kit",
          at: await jsonTime(newer),
        },
      });
      expect(r.staff).toContainEqual({
        name: "Noura Test",
        email: "csm@tests.invalid",
        role: "the CSM",
      });
      expect(r.staff.every((s: Row) => typeof s.role === "string")).toBe(true);
      // The meeting's own transcript path comes first.
      await q(
        "UPDATE public.cockpit_fathom_meetings SET transcript_path='fathom/meeting.txt' WHERE recording_id=$1",
        [rec],
      );
      expect((await svc(INPUTS, [A, rec])).transcriptPath).toBe(
        "fathom/meeting.txt",
      );
      // A candidate is content too; a sales or team recording has none at all.
      expect(await svc(INPUTS, [A, "900000101"])).toMatchObject({
        class: "candidate",
        summary: "Invented summary of an impromptu call.",
      });
      // A sales or team recording: no content at all.
      for (const team of ["900000102", "900000105"])
        expect(await svc(INPUTS, [A, team])).toMatchObject({
          summary: null,
          actionItems: null,
          transcriptPath: null,
        });
      // Gone, and a card with no 1-1 form yet.
      await q(
        "UPDATE public.cockpit_fathom_meetings SET gone_at=now() WHERE recording_id=$1",
        [rec],
      );
      expect(await svc(INPUTS, [C, rec])).toMatchObject({
        gone: true,
        lastForm: null,
        client: {
          taskId: C,
          name: "Cedar Homes",
          stage: "Active",
          happiness: "At Risk",
        },
      });
      expect(await svcRefused(INPUTS, [A, "999999999"])).toBe(
        "That recording is not in the cockpit yet. Check again in a minute.",
      );
      expect(await svcRefused(INPUTS, ["not a card", rec])).toBe(
        "Choose a valid ClickUp client ID",
      );
      expect(await refused(CSM, INPUTS, [A, rec])).toContain(
        "permission denied",
      );
    });
  });

  test("cockpit_forms_doctor_store: Customer Success recordings first seen today, the week's candidates, the last pull and the last delivery", async () => {
    await rolledBack(async () => {
      await q(
        "UPDATE public.cockpit_fathom_meetings SET first_seen_at = now() - interval '2 days'",
      );
      await q(
        "UPDATE public.cockpit_csm_calls SET candidate = false WHERE candidate",
      );
      await meeting();
      await meeting({ team: "Customer Success", by: "csm-b@tests.invalid" });
      await meeting({
        team: "Sales",
        by: "closer@tests.invalid",
        cls: "client",
        external: true,
      });
      const week = await meeting();
      await callRow(week, { candidate: true, start: ago(3 * 24 * 60) });
      const older = await meeting();
      await callRow(older, { candidate: true, start: ago(8 * 24 * 60) });
      const empty = await svc("SELECT public.cockpit_forms_doctor_store() r");
      expect(empty).toEqual({
        csRecordings24h: 4,
        candidates7d: 1,
        lastPull: null,
        lastDelivery: null,
      });
      await svc(
        "SELECT public.cockpit_fathom_pull_mark(true, 3, 'Read 3 meetings.') r",
      );
      const deliveries = `INSERT INTO public.cockpit_fathom_webhook_deliveries(webhook_id,outcome,last_at) VALUES($1,$2,$3)`;
      const ignoredAt = ago(10);
      await q(deliveries, ["msg_TEST_d1", "stored", ago(30)]);
      await q(deliveries, ["msg_TEST_d2", "ignored", ignoredAt]);
      await q(deliveries, ["msg_TEST_d3", "failed", ago(1)]);
      expect(await svc("SELECT public.cockpit_forms_doctor_store() r")).toEqual(
        {
          csRecordings24h: 4,
          candidates7d: 1,
          lastPull: await jsonTime((await syncRow("fathom-pull"))?.last_run_at),
          lastDelivery: await jsonTime(ignoredAt),
        },
      );
      expect(
        await ownerRefused("SELECT public.cockpit_forms_doctor_store()"),
      ).toBe("This hours function needs the service role");
    });
  });
});

describe("the pull state and the webhook receipts", () => {
  test("the pull is due with no row, a minute after a good pull and fifteen seconds after a failed one; mark keeps the last good time", async () => {
    await rolledBack(async () => {
      const due = () => svc("SELECT public.cockpit_fathom_pull_due() r");
      expect(await due()).toEqual({
        due: true,
        lastRunAt: null,
        ok: null,
        note: null,
      });
      expect(
        await svc(
          "SELECT public.cockpit_fathom_pull_mark(true, 12, 'Read 12 meetings.') r",
        ),
      ).toEqual({
        ok: true,
        lastRunAt: expect.any(String),
      });
      const good = await syncRow("fathom-pull");
      expect(good).toMatchObject({
        ok: true,
        rows_seen: 12,
        note: "Read 12 meetings.",
      });
      expect(good?.last_ok_at).toEqual(good?.last_run_at);
      expect(await due()).toMatchObject({
        due: false,
        ok: true,
        note: "Read 12 meetings.",
      });
      const ranAgo = (seconds: number) =>
        q(
          "UPDATE public.cockpit_sync_state SET last_run_at = now() - make_interval(secs => $1) WHERE key='fathom-pull'",
          [seconds],
        );
      await ranAgo(59);
      expect((await due()).due).toBe(false);
      await ranAgo(61);
      expect((await due()).due).toBe(true);
      await svc("SELECT public.cockpit_fathom_pull_mark(false, 0, $1) r", [
        "x".repeat(300),
      ]);
      const bad = await syncRow("fathom-pull");
      expect(bad).toMatchObject({ ok: false, rows_seen: 0 });
      expect(bad?.note).toHaveLength(240);
      expect(bad?.last_ok_at).toEqual(good?.last_ok_at);
      await ranAgo(10);
      expect((await due()).due).toBe(false);
      await ranAgo(16);
      expect((await due()).due).toBe(true);
    });
  });

  test("a delivery: the first, a duplicate, a failed one retried, a received one stale for five minutes retried; settle writes the outcome and the sync line, never the registration detail", async () => {
    await rolledBack(async () => {
      await putKey({
        provider: "fathom_webhook",
        secret: KEYS.fathom_webhook,
        state: "connected",
        meta: {
          webhookId: "wh_TEST0001",
          triggeredFor: ["shared_team_recordings"],
        },
      });
      const detail = (await syncRow("fathom-webhook"))?.detail;
      expect(detail).toMatchObject({ registered: true });
      const seen = (id: string) =>
        svc(
          "SELECT public.cockpit_fathom_webhook_seen($1, now() - interval '1 minute') r",
          [id],
        );
      const settle = (id: string, outcome: string, rec: string | null = null) =>
        svc("SELECT public.cockpit_fathom_webhook_settle($1,$2,$3,$4) r", [
          id,
          outcome,
          rec,
          `Invented ${outcome}.`,
        ]);
      const delivery = async (id: string) =>
        (
          await q(
            "SELECT outcome, receipts, recording_id, reason, msg_timestamp IS NOT NULL stamped FROM public.cockpit_fathom_webhook_deliveries WHERE webhook_id=$1",
            [id],
          )
        )[0];
      expect(await seen("msg_TEST_1")).toEqual({ first: true, prior: null });
      expect(await delivery("msg_TEST_1")).toEqual({
        outcome: "received",
        receipts: 1,
        recording_id: null,
        reason: null,
        stamped: true,
      });
      expect(await seen("msg_TEST_1")).toEqual({
        first: false,
        prior: "received",
      });
      expect(await settle("msg_TEST_1", "stored", "900000101")).toEqual({
        ok: true,
        webhookId: "msg_TEST_1",
        outcome: "stored",
      });
      expect(await delivery("msg_TEST_1")).toMatchObject({
        outcome: "stored",
        receipts: 2,
        recording_id: "900000101",
      });
      const sync = await syncRow("fathom-webhook");
      expect(sync).toMatchObject({ ok: true, detail });
      expect(sync?.note).toBe(
        `Last delivery stored at ${kuwaitTime((await q("SELECT now() t"))[0].t.toISOString())}`,
      );
      expect(sync?.last_ok_at).toEqual(sync?.last_run_at);
      expect(await seen("msg_TEST_1")).toEqual({
        first: false,
        prior: "stored",
      });
      // Failed, then Fathom's retry is processed again.
      await seen("msg_TEST_2");
      await settle("msg_TEST_2", "failed");
      const failed = await syncRow("fathom-webhook");
      expect(failed).toMatchObject({ ok: false, detail });
      expect(failed?.last_ok_at).toEqual(sync?.last_ok_at);
      expect(await seen("msg_TEST_2")).toEqual({
        first: true,
        prior: "failed",
      });
      expect(await delivery("msg_TEST_2")).toMatchObject({
        outcome: "received",
        receipts: 2,
      });
      // A run that died after the first look: retried after five minutes.
      await seen("msg_TEST_3");
      expect(await seen("msg_TEST_3")).toEqual({
        first: false,
        prior: "received",
      });
      await q(
        "UPDATE public.cockpit_fathom_webhook_deliveries SET last_at = now() - interval '6 minutes' WHERE webhook_id='msg_TEST_3'",
      );
      expect(await seen("msg_TEST_3")).toEqual({
        first: true,
        prior: "received",
      });
      // Ignored counts as good; a settle with no first look still leaves its row; ids that are not digits are not kept.
      await settle("msg_TEST_4", "ignored", "not digits");
      expect(await delivery("msg_TEST_4")).toMatchObject({
        outcome: "ignored",
        receipts: 1,
        recording_id: null,
      });
      expect((await syncRow("fathom-webhook"))?.ok).toBe(true);
      expect((await syncRow("fathom-webhook"))?.detail).toEqual(detail);
      expect(
        await svcRefused(
          "SELECT public.cockpit_fathom_webhook_settle('msg_TEST_1','done',NULL,NULL)",
        ),
      ).toBe("Choose stored, ignored or failed.");
      expect(
        await svcRefused(
          "SELECT public.cockpit_fathom_webhook_seen('', now())",
        ),
      ).toBe("A delivery needs its webhook-id.");
      // The CEO card counts the last day's deliveries.
      expect((await status()).webhook).toMatchObject({
        registered: true,
        stored24h: 1,
        ignored24h: 1,
        failed24h: 0,
        lastDeliveryAt: expect.any(String),
      });
    });
  });
});

describe("the queue", () => {
  const SETTLE = "SELECT public.cockpit_csm_candidate_settle($1,$2,$3) r";
  const MATCH = "SELECT public.cockpit_csm_manual_match($1,$2) r";
  /** An impromptu recording with no client, in the CSM's queue. */
  async function candidate(
    o: {
      room?: string | null;
      start?: string;
      host?: string | null;
      hints?: Row[];
    } = {},
  ) {
    const start = o.start ?? ago(130);
    const rec = await meeting({ start, room: o.room ?? null });
    const row = await callRow(rec, {
      candidate: true,
      start,
      room: o.room ?? null,
      hints: o.hints,
    });
    const item = await queueItem(String(row), { host: o.host });
    return { rec, row, item };
  }

  /** The worker's hints on a candidate, which a person's decision ends (A7.13). */
  const HINTS = [
    { taskId: A, clientName: "Acme Interiors", why: "near_booking" },
    { taskId: C, clientName: "Cedar Homes", why: "title" },
  ];

  test("Not a 1-1 call: the host, an admin and the CEO set a candidate aside with its reason and no hints; the row leaves the queue with one audit row", async () => {
    await rolledBack(async () => {
      const other = await meeting();
      for (const [who, reason, sameAs] of [
        [CSM, "part_of_call", other],
        [ADMIN, "onboarding", null],
        [CEO, "blueprint", null],
        [CSM, "not_client", ""],
      ] as const) {
        const c = await candidate({ hints: HINTS });
        expect((await callOf(c.rec)).hints).toEqual(HINTS);
        expect(await one(who, SETTLE, [c.item, reason, sameAs])).toEqual({
          ok: true,
          callId: c.row,
          reason,
        });
        expect(await callOf(c.rec)).toMatchObject({
          task_id: null,
          candidate: false,
          settled_reason: reason,
          hints: [],
        });
        const actor = (
          await q<{ email: string }>(
            "SELECT email FROM auth.users WHERE id=$1",
            [who],
          )
        )[0].email;
        expect(
          (
            await q(
              "SELECT resolved_task_id, resolved_by, resolved_at IS NOT NULL done FROM public.cockpit_csm_unmatched WHERE id=$1",
              [c.item],
            )
          )[0],
        ).toEqual({ resolved_task_id: null, resolved_by: actor, done: true });
        expect(
          await q(
            "SELECT actor_email, entity_id, metadata FROM public.cockpit_audit_log WHERE action='csm.candidate_settled' AND entity_id=$1",
            [String(c.row)],
          ),
        ).toEqual([
          {
            actor_email: actor,
            entity_id: String(c.row),
            metadata: {
              callId: c.row,
              recordingId: c.rec,
              reason,
              sameAs: sameAs || null,
            },
          },
        ]);
      }
    });
  });

  test("Not a 1-1 call refuses another CSM's item, a recording that is not a candidate, a closed item, an unknown reason or recording", async () => {
    await rolledBack(async () => {
      const c = await candidate();
      const settle = (
        who: string,
        item: number,
        reason = "not_client",
        sameAs: string | null = null,
      ) => refusal(who, SETTLE, [item, reason, sameAs]);
      expect(await settle(CSM_B, c.item)).toMatchObject({
        code: "42501",
        message: "This item is outside your queue",
      });
      expect(await settle(BUYER, c.item)).toMatchObject({
        code: "42501",
        message: "Current confirmed client-success access is required",
      });
      expect(await settle(CSM, c.item, "duplicate")).toMatchObject({
        code: "22023",
        message: "Pick why this is not a 1-1 call.",
      });
      for (const sameAs of ["999999999", "abc", c.rec])
        expect(await settle(CSM, c.item, "part_of_call", sameAs)).toMatchObject(
          {
            code: "22023",
            message: "That recording is not in the cockpit.",
          },
        );
      // Not a candidate: matched to a client, or a calendared call row.
      const onClient = await meeting();
      const onClientRow = await callRow(onClient, {
        task: A,
        method: "manual",
      });
      const matchedItem = await queueItem(String(onClientRow));
      const plain = await meeting();
      const plainItem = await queueItem(
        String(await callRow(plain, { candidate: false })),
      );
      for (const item of [matchedItem, plainItem])
        expect(await settle(CSM, item)).toMatchObject({
          code: "22023",
          message:
            "Only an impromptu recording with no client can be set aside here.",
        });
      // Closed, a form, or gone from the queue.
      const closed = await queueItem(String(c.row + 100000), {
        resolved: true,
      });
      const form = await queueItem("tf-token-1", { kind: "form" });
      for (const item of [closed, form, 987654321])
        expect(await settle(CSM, item)).toMatchObject({
          code: "22023",
          message: "That item is no longer in the queue.",
        });
      expect(await callOf(c.rec)).toMatchObject({
        candidate: true,
        settled_reason: null,
      });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='csm.candidate_settled'",
        ),
      ).toBe(0);
    });
  });

  test("This is {client}: a candidate takes the client's booking by room or by time and its kind, stops being a candidate with no hints, and is audited", async () => {
    await rolledBack(async () => {
      // By room: the booking 30 minutes earlier in the same Meet room.
      const byRoom = await candidate({
        room: "meet:kln-opqr-stu",
        start: ago(130),
        hints: HINTS,
      });
      const roomBooking = await booking(A, {
        start: ago(160),
        kind: "onboarding",
        room: "meet:kln-opqr-stu",
      });
      await booking(A, { start: ago(125) });
      expect(await one(CSM, MATCH, [byRoom.item, A])).toEqual({
        ok: true,
        taskId: A,
        clientName: "Acme Interiors",
      });
      expect(await callOf(byRoom.rec)).toMatchObject({
        task_id: A,
        client_name: "Acme Interiors",
        match_method: "manual",
        confidence: 1,
        linked_call_id: roomBooking,
        kind: "onboarding",
        candidate: false,
        settled_reason: null,
        hints: [],
      });
      expect(
        await q(
          "SELECT actor_email, entity_type, metadata FROM public.cockpit_audit_log WHERE action='csm.manual_match' AND entity_id=$1",
          [String(byRoom.row)],
        ),
      ).toEqual([
        {
          actor_email: "csm@tests.invalid",
          entity_type: "cockpit_csm_calls",
          metadata: {
            itemKind: "call",
            itemRef: String(byRoom.row),
            taskId: A,
            linkedCallId: roomBooking,
          },
        },
      ]);
      expect(
        await q(
          "SELECT task_id, actor_email FROM public.cockpit_csm_match_audit WHERE item_ref=$1",
          [String(byRoom.row)],
        ),
      ).toEqual([{ task_id: A, actor_email: "csm@tests.invalid" }]);
      // By time: no room, a Beta Build booking 20 minutes later; a set-aside row comes back.
      const byTime = await candidate({ start: ago(300) });
      await q(
        "UPDATE public.cockpit_csm_calls SET candidate=false, settled_reason='not_client' WHERE id=$1",
        [byTime.row],
      );
      const timeBooking = await booking(B, {
        start: ago(280),
        kind: "blueprint",
      });
      await one(ADMIN, MATCH, [byTime.item, B]);
      expect(await callOf(byTime.rec)).toMatchObject({
        task_id: B,
        linked_call_id: timeBooking,
        kind: "blueprint",
        candidate: false,
        settled_reason: null,
      });
      // No booking near: put on the client with no link, its kind as it was.
      const lonely = await candidate({ start: ago(2000) });
      await one(CEO, MATCH, [lonely.item, C]);
      expect(await callOf(lonely.rec)).toMatchObject({
        task_id: C,
        linked_call_id: null,
        kind: "other",
        candidate: false,
      });
    });
  });

  test("This is {client} keeps the live rules: a stored link is cleared and the booking rule decides, a form is matched, a closed item says so, another CSM's is refused", async () => {
    await rolledBack(async () => {
      // The live body clears every call item's link: its "this card" test
      // names linked_call_id unqualified inside the subquery, which reads the
      // inner row (20261011d:108, kept as live; see the report). The booking
      // rule then links this card's booking near the call, and only that.
      const near = await booking(A, { start: ago(110), kind: "checkin" });
      const keepNear = await candidate({ start: ago(100) });
      await q(
        "UPDATE public.cockpit_csm_calls SET linked_call_id=$2 WHERE id=$1",
        [keepNear.row, near],
      );
      await one(CSM, MATCH, [keepNear.item, A]);
      expect((await callOf(keepNear.rec)).linked_call_id).toBe(near);
      const far = await booking(A, { start: ago(1700), kind: "checkin" });
      const keepFar = await candidate({ start: ago(1000) });
      await q(
        "UPDATE public.cockpit_csm_calls SET linked_call_id=$2 WHERE id=$1",
        [keepFar.row, far],
      );
      await one(CSM, MATCH, [keepFar.item, A]);
      expect((await callOf(keepFar.rec)).linked_call_id).toBeNull();
      const elsewhere = await booking(C, { start: ago(101) });
      const moved = await candidate({ start: ago(100) });
      await q(
        "UPDATE public.cockpit_csm_calls SET linked_call_id=$2 WHERE id=$1",
        [moved.row, elsewhere],
      );
      const nearB = await booking(B, { start: ago(110) });
      await one(CSM, MATCH, [moved.item, B]);
      expect((await callOf(moved.rec)).linked_call_id).toBe(nearB);
      // A form in the queue.
      await q(
        "INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,submitted_at) VALUES('tf-queue-1','fRokTITH','checkin',NULL,now())",
      );
      const formItem = await queueItem("tf-queue-1", { kind: "form" });
      await one(CSM, MATCH, [formItem, A]);
      expect(
        (
          await q(
            "SELECT task_id, matched_by FROM public.cockpit_csm_call_forms WHERE token='tf-queue-1'",
          )
        )[0],
      ).toEqual({ task_id: A, matched_by: "manual" });
      expect(
        (
          await q(
            "SELECT entity_type, metadata FROM public.cockpit_audit_log WHERE action='csm.manual_match' AND entity_id='tf-queue-1'",
          )
        )[0],
      ).toEqual({
        entity_type: "cockpit_csm_call_forms",
        metadata: {
          itemKind: "form",
          itemRef: "tf-queue-1",
          taskId: A,
          linkedCallId: null,
        },
      });
      // Closed, another CSM's, missing, and a client off the seat's list.
      expect(await one(CSM, MATCH, [formItem, B])).toEqual({
        ok: true,
        already: true,
        taskId: A,
      });
      const theirs = await candidate({ host: "csm-b@tests.invalid" });
      expect(
        await refusal(CSM, MATCH, [
          (await candidate({ host: "someone@tests.invalid" })).item,
          A,
        ]),
      ).toMatchObject({
        code: "42501",
        message: "This item is outside your queue",
      });
      expect(await one(CSM_B, MATCH, [theirs.item, B])).toMatchObject({
        ok: true,
        taskId: B,
      });
      expect(await refused(CSM, MATCH, [987654321, A])).toBe(
        "That item is no longer in the queue",
      );
      expect(await refusal(CSM_B, MATCH, [theirs.item, A])).toMatchObject({
        code: "42501",
        message: "That client is not on your access list",
      });
    });
  });

  test("the queue list says which call items are candidates", async () => {
    await rolledBack(async () => {
      const cand = await candidate({ start: ago(10) });
      const plain = await meeting();
      const plainItem = await queueItem(
        String(await callRow(plain, { candidate: false })),
      );
      const formItem = await queueItem("tf-list-1", { kind: "form" });
      const missingItem = await queueItem("987654321");
      const othersItem = await queueItem(
        String(await callRow(await meeting(), { candidate: true })),
        {
          host: "csm-b@tests.invalid",
        },
      );
      const list = await one(
        CSM,
        "SELECT public.cockpit_csm_unmatched_list() r",
      );
      const byId = Object.fromEntries(list.map((i: Row) => [i.id, i]));
      expect(byId[cand.item]).toMatchObject({
        kind: "call",
        candidate: true,
        host: "csm@tests.invalid",
      });
      expect(Object.keys(byId[cand.item]).sort()).toEqual([
        "at",
        "candidate",
        "hint",
        "host",
        "id",
        "kind",
        "reason",
        "title",
      ]);
      for (const item of [plainItem, formItem, missingItem])
        expect([item, byId[item]?.candidate]).toEqual([item, false]);
      // A CSM sees only her own; an admin sees every open item.
      expect(byId[othersItem]).toBeUndefined();
      const all = await one(
        ADMIN,
        "SELECT public.cockpit_csm_unmatched_list() r",
      );
      expect(all.map((i: Row) => i.id)).toContain(othersItem);
      expect(
        await refused(BUYER, "SELECT public.cockpit_csm_unmatched_list()"),
      ).toBe("Current confirmed client-success access is required");
    });
  });

  test("a candidate Fathom no longer has leaves the list before its limit, and its queue row stays open; every other item stays", async () => {
    await rolledBack(async () => {
      const LIST = "SELECT public.cockpit_csm_unmatched_list() r";
      const gone = await candidate();
      await q("UPDATE public.cockpit_csm_calls SET status='gone' WHERE id=$1", [
        gone.row,
      ]);
      // A gone call row that is not a candidate, a candidate still there, a form.
      const goneCall = await queueItem(
        String(
          await callRow(await meeting(), { candidate: false, status: "gone" }),
        ),
      );
      const held = await candidate();
      const formItem = await queueItem("tf-gone-1", { kind: "form" });
      for (const who of [CSM, ADMIN, CEO]) {
        const ids = (await one(who, LIST)).map((i: Row) => i.id);
        expect([who, ids.includes(gone.item)]).toEqual([who, false]);
        for (const item of [goneCall, held.item, formItem])
          expect([who, item, ids.includes(item)]).toEqual([who, item, true]);
      }
      expect(
        (
          await q(
            "SELECT resolved_at FROM public.cockpit_csm_unmatched WHERE id=$1",
            [gone.item],
          )
        )[0].resolved_at,
      ).toBeNull();
      // The newest item is the gone one; a full page of older items still comes back whole.
      await q(
        "UPDATE public.cockpit_csm_unmatched SET at = now() + interval '1 minute' WHERE id=$1",
        [gone.item],
      );
      await q(
        `INSERT INTO public.cockpit_csm_unmatched(item_kind,item_ref,title,at,reason,host_email)
         SELECT 'form', 'tf-page-' || n, 'Invented form', now() - n * interval '1 minute', 'Invented reason.', 'csm@tests.invalid'
           FROM generate_series(1, 100) n`,
      );
      const page = (await one(ADMIN, LIST)).map((i: Row) => i.id);
      expect(page).toHaveLength(100);
      expect(page).not.toContain(gone.item);
    });
  });
});

describe("the replaced calls summary and sales exclusion", () => {
  test("the calls summary reads every check-in form, adds lastNoteAt and an https join link, and on Typeform-only data equals the old output", async () => {
    await rolledBack(async () => {
      // The 20261011c body, kept under another name to compare with.
      await q(
        cut(
          migration("20261011c_csm_call_store.sql"),
          /CREATE OR REPLACE FUNCTION public\.cockpit_csm_calls_summary\(\)[\s\S]*?END \$\$;/,
          "the old summary",
        ).replace(
          "public.cockpit_csm_calls_summary()",
          "public.zz_old_calls_summary()",
        ),
      );
      const form = (
        token: string,
        formId: string,
        kind: string,
        task: string,
        at: string,
      ) =>
        q(
          `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,matched_by,submitted_at)
           VALUES($1,$2,$3,$4,'hidden_field',$5)`,
          [token, formId, kind, task, at],
        );
      const typeformAt = ago(50);
      await form("tf-sum-1", "fRokTITH", "checkin", A, typeformAt);
      await form("tf-sum-2", "fRokTITH", "checkin", C, ago(5000));
      await booking(A, {
        start: ago(-600),
        joinUrl: "https://meet.google.com/abc-defg-hij",
      });
      await booking(C, {
        start: ago(-600),
        joinUrl: "http://insecure.example.invalid/room",
      });
      const summaries = async () => ({
        now: await one(CSM, "SELECT public.cockpit_csm_calls_summary() r"),
        old: await one(CSM, "SELECT public.zz_old_calls_summary() r"),
      });
      const { now, old } = await summaries();
      expect(Object.keys(now.clients).sort()).toEqual(
        Object.keys(old.clients).sort(),
      );
      for (const task of Object.keys(old.clients)) {
        const {
          lastNoteAt,
          nextCallJoinUrl,
          joinCallAt,
          joinCallEndsAt,
          joinCallUrl,
          ...rest
        } = now.clients[task];
        expect([task, rest]).toEqual([task, old.clients[task]]);
        // Before any call starts, the booking to join is the next booking.
        expect([task, joinCallAt, joinCallUrl]).toEqual([
          task,
          rest.nextCallAt ?? null,
          nextCallJoinUrl,
        ]);
        expect(joinCallEndsAt).toBeNull();
        expect(typeof lastNoteAt === "string" || lastNoteAt === null).toBe(
          true,
        );
        expect(
          typeof nextCallJoinUrl === "string" || nextCallJoinUrl === null,
        ).toBe(true);
      }
      expect(now.health).toEqual(old.health);
      expect(now.clients[A]).toMatchObject({
        lastNoteAt: await jsonTime(typeformAt),
        nextCallJoinUrl: "https://meet.google.com/abc-defg-hij",
        lastCallKind: "checkin",
        lastCallSource: "checkin_form",
      });
      expect(now.clients[C].nextCallJoinUrl).toBeNull();
      expect(now.clients[B]).toMatchObject({
        lastNoteAt: null,
        nextCallJoinUrl: null,
      });
      // The native write-through counts as a check-in form; an onboarding form never does.
      const nativeAt = ago(20);
      await form(
        "cockpit:sum-native",
        "cockpit-checkin",
        "checkin",
        A,
        nativeAt,
      );
      await form("tf-sum-onboarding", "KFRCXPFx", "onboarding", A, ago(10));
      const after = await summaries();
      expect(after.now.clients[A]).toMatchObject({
        lastNoteAt: await jsonTime(nativeAt),
        lastCall: await jsonTime(nativeAt),
      });
      expect(after.old.clients[A].lastCall).toBe(await jsonTime(typeformAt));
    });
  });

  test("the calls summary keeps a booking in progress as the one to join until its end (8.3); nextCallAt still names the next booking", async () => {
    await rolledBack(async () => {
      const ROOM = "https://meet.google.com/abc-defg-hij";
      const NEXT = "https://meet.google.com/kln-opqr-stu";
      const LATE = "https://meet.google.com/vwx-yzab-cde";
      const started = ago(2);
      const ends = ago(-28);
      const now = await booking(B, {
        start: started,
        end: ends,
        joinUrl: ROOM,
      });
      const tomorrow = ago(-24 * 60);
      await booking(B, { start: tomorrow, joinUrl: NEXT });
      const summary = async () =>
        (await one(CSM, "SELECT public.cockpit_csm_calls_summary() r")).clients;
      // Two minutes in: the header still has the call to join.
      expect((await summary())[B]).toMatchObject({
        nextCallAt: await jsonTime(tomorrow),
        nextCallJoinUrl: NEXT,
        joinCallAt: await jsonTime(started),
        joinCallEndsAt: await jsonTime(ends),
        joinCallUrl: ROOM,
      });
      // At its end it hands over to the next booking.
      await q("UPDATE public.cockpit_csm_calls SET ends_at=$2 WHERE id=$1", [
        now,
        ago(1),
      ]);
      expect((await summary())[B]).toMatchObject({
        joinCallAt: await jsonTime(tomorrow),
        joinCallEndsAt: null,
        joinCallUrl: NEXT,
      });
      // With no end, an hour from its start; a cancelled booking never.
      const noEnd = ago(30);
      await booking(C, { start: noEnd, joinUrl: LATE });
      await booking(C, { start: ago(70), joinUrl: ROOM });
      await booking(C, { start: ago(5), status: "cancelled", joinUrl: NEXT });
      expect((await summary())[C]).toMatchObject({
        nextCallAt: null,
        nextCallJoinUrl: null,
        joinCallAt: await jsonTime(noEnd),
        joinCallEndsAt: null,
        joinCallUrl: LATE,
      });
      // A link that is not https is no link, as for the next call.
      await q(
        "UPDATE public.cockpit_csm_calls SET join_url='http://insecure.example.invalid/room' WHERE task_id=$1 AND source='ghl_appointment' AND starts_at=$2",
        [C, noEnd],
      );
      expect((await summary())[C]).toMatchObject({
        joinCallAt: await jsonTime(noEnd),
        joinCallUrl: null,
      });
    });
  });

  test("the sales exclusion: a same-room or 1-1 form link match is a strong client match, a Customer Success recording is client service, and an internal purpose still wins", async () => {
    await rolledBack(async () => {
      const exclusion = (rec: string, title = "Invented call") =>
        svc("SELECT public.cockpit_sales_call_exclusion($1,$2) r", [
          rec,
          title,
        ]);
      const sameRoom = await meeting({
        team: "Sales",
        by: "closer@tests.invalid",
        cls: "client",
        external: true,
      });
      await callRow(sameRoom, {
        task: A,
        method: "same_room",
        kind: "checkin",
      });
      expect(await exclusion(sameRoom)).toBe("client service");
      // The CEO's launch call with no booking, placed by the CSM's 1-1 form
      // link (5.2 row 3), then indexed by the sales desk under a title the
      // exclusion's words miss: still client service, so it keeps its content.
      const byForm = await meeting({
        team: "Sales",
        by: "ceo@tests.invalid",
        cls: "client",
        external: true,
      });
      await callRow(byForm, {
        task: A,
        method: "form_task_id",
        confidence: 0.95,
        kind: "launch",
      });
      expect(await exclusion(byForm, "Acme Interiors strategy")).toBe(
        "client service",
      );
      // The kind list is unchanged: an 'other' call is not client service by its match alone.
      const otherKind = await meeting({
        team: "Sales",
        by: "ceo@tests.invalid",
        cls: "client",
        external: true,
      });
      await callRow(otherKind, {
        task: A,
        method: "form_task_id",
        confidence: 0.95,
        kind: "other",
      });
      expect(await exclusion(otherKind, "Impromptu Zoom Meeting")).toBeNull();
      const weak = await meeting({
        team: "Sales",
        by: "closer@tests.invalid",
        cls: "client",
        external: true,
      });
      await callRow(weak, { task: A, method: "name", kind: "checkin" });
      expect(await exclusion(weak)).toBeNull();
      expect(await exclusion(weak, "Acme Interiors check-in")).toBe(
        "client service",
      );
      const service = await meeting({ team: "Customer Success" });
      expect(await exclusion(service)).toBe("client service");
      // The team read from raw when the column is not set yet.
      await q(
        "UPDATE public.cockpit_fathom_meetings SET recorder_team=NULL WHERE recording_id=$1",
        [service],
      );
      expect(await exclusion(service)).toBe("client service");
      await q(
        `INSERT INTO public.cockpit_sales_call_notes(recording_id, notes) VALUES($1, '{"call_purpose":"internal","call_purpose_evidence":"An invented team planning call."}'::jsonb)`,
        [service],
      );
      expect(await exclusion(service)).toBe("internal");
      expect(await exclusion("900000199")).toBeNull();
    });
  });
});

describe("the deploy read-backs (section 12, steps 2 and 4)", () => {
  test("step 2: both files run twice in one transaction and roll back with no error and no trace", async () => {
    const strip = (file: string) =>
      migration(file)
        .replace(/^BEGIN;$/m, "")
        .replace(/^COMMIT;$/m, "");
    const snapshot = async () =>
      JSON.stringify([
        await count("SELECT count(*) n FROM public.cockpit_audit_log"),
        await q(
          "SELECT key, provider, effects FROM public.cockpit_forms ORDER BY key",
        ),
        await q(
          "SELECT recording_id, class, summary FROM public.cockpit_fathom_meetings ORDER BY recording_id",
        ),
      ]);
    const before = await snapshot();
    await asOwner();
    await db.exec(
      `BEGIN;\n${strip(V)}\n${strip(W)}\n${strip(V)}\n${strip(W)}\nROLLBACK;`,
    );
    expect(await snapshot()).toBe(before);
  });

  test("step 4: the CHECKs, indexes, trigger and bodies read back as written", async () => {
    const defs = async (table: string) =>
      (
        await q<{ d: string }>(
          "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c'",
          [`public.${table}`],
        )
      ).map(r => r.d);
    expect(await defs("cockpit_forms")).toContainEqual(
      "CHECK (((provider <> 'typeform'::text) OR (typeform_id IS NOT NULL)))",
    );
    expect(await defs("cockpit_form_effects")).toContainEqual(
      "CHECK (((owner = 'cockpit'::text) OR (state = ANY (ARRAY['dry_run'::text, 'skipped'::text]))))",
    );
    expect((await defs("cockpit_csm_calls")).join(" ")).toContain(
      "'part_of_call'::text, 'onboarding'::text, 'blueprint'::text, 'not_client'::text",
    );
    const indexes = await q<{ name: string; def: string }>(
      "SELECT indexname name, indexdef def FROM pg_indexes WHERE tablename='cockpit_form_responses' AND indexname LIKE 'cockpit_form_responses_one_live_%' ORDER BY indexname",
    );
    expect(indexes.map(i => i.name)).toEqual([
      "cockpit_form_responses_one_live_booking",
      "cockpit_form_responses_one_live_recording",
    ]);
    for (const i of indexes) {
      expect(i.def).toContain("CREATE UNIQUE INDEX");
      expect(i.def).toContain("(mode = 'live'::text)");
    }
    const body = async (sig: string) =>
      (
        await q<{ b: string }>(
          "SELECT pg_get_functiondef($1::regprocedure) b",
          [`public.${sig}`],
        )
      )[0].b;
    const summary = await body("cockpit_csm_calls_summary()");
    for (const text of [
      "form_kind='checkin'",
      "'lastNoteAt'",
      "'nextCallJoinUrl'",
    ])
      expect(summary).toContain(text);
    expect(summary).not.toContain("form_id='fRokTITH'");
    const exclusionBody = await body("cockpit_sales_call_exclusion(text,text)");
    for (const text of [
      "'same_room'",
      "'form_task_id'",
      "= 'Customer Success'",
    ])
      expect(exclusionBody).toContain(text);
    expect(await body("cockpit_csm_manual_match(bigint,text)")).toContain(
      "public.cockpit_csm_booking_for(",
    );
    expect(await body("cockpit_csm_unmatched_list()")).toContain("'candidate'");
    // The objects of step 7: internal or sales rows still holding a transcript path, ids only.
    expect(
      (
        await q(
          "SELECT recording_id FROM public.cockpit_fathom_meetings WHERE class IN ('internal','sales') AND transcript_path IS NOT NULL ORDER BY 1",
        )
      ).map(r => r.recording_id),
    ).toEqual(["900000102"]);
  });
});

describe("the call store's DELETE and TRUNCATE revoke", () => {
  test("the service key cannot delete or truncate the four store tables, and still writes them", async () => {
    await rolledBack(async () => {
      for (const table of STORE_TABLES)
        for (const statement of [
          `DELETE FROM public.${table} WHERE false`,
          `TRUNCATE public.${table}`,
        ])
          expect([statement, await svcRefused(statement)]).toEqual([
            statement,
            expect.stringContaining("permission denied"),
          ]);
      await guarded(async () => {
        await asService();
        await db.query(
          "UPDATE public.cockpit_csm_calls SET updated_at=now() WHERE source='fathom' AND source_id='900000103'",
        );
      });
    });
  });
});
