/**
 * The shadow replay of the 1-1 notes (docs/forms/STAGE2-CONTRACT.md 7.4): the
 * last ten real 1-1 forms (Typeform fRokTITH) planned by the native planner,
 * migration 20261027h, in PGlite, and compared with what Make 9209179 and
 * 9523861 wrote on those cards. Shapes, targets and values, never text: the
 * report holds ids, business names, counts, days, option ids and verdicts.
 *
 *   cd apps/media-buyer-cockpit && bun scripts/checkin-replay.ts --live \
 *     --fixture <notes/stage2/fixtures/replay-10.json> --out <notes/stage2/replay>
 *   cd apps/media-buyer-cockpit && bun scripts/checkin-replay.ts \
 *     --shadow <response id>,<response id> --out <folder>
 *
 * --live reads production through sq.py (spawned, read only, kept in memory):
 * the ten Typeform rows, the pinned recordings and their call rows, and what
 * the matcher would have read before each submit, rebuilt as of the submit.
 * An email leaves the database only with its local part hashed (the domain
 * stays, so the matcher's domain rules hold), a room only hashed, a contact
 * name never (an action item's assignee leaves as the staff member's own name
 * when its first word is a staff first name, else as `Contact ` and 8
 * characters of a hash, docs/forms/STAGE2B-CONTRACT.md 4.13), and
 * Fathom's action items and the Typeform's client notes only as hashes, so a
 * plan keeps its counts and sides but no text. The answers are built from
 * those rows, with todoItems from cockpit-forms-api's todos.ts (the one copy
 * of the rule), and planned on the canonical migrations. Each response counts
 * whom Fathom assigned its open action items to, and a to-do comment
 * difference from Make's comment carries the sentence that explains it when
 * one does; an empty side Fathom gave open items to never is explained.
 *
 * --shadow reads real shadow runs' plans (sq.py), each run's recording's
 * action items through the same masks as --live (so the run counts whom Fathom
 * assigned them to; a to-do comment difference carries its sentence only while
 * the CSM's list is still Fathom's items, else it stays unexplained), and,
 * for the same cards, what Make wrote, through the VPS GET route: one GET-only
 * script over ssh that reads the keys by name and prints shapes only. Both write a report under
 * --out: replay-report.json and .md for --live, shadow-report.json and .md for
 * --shadow.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import {
  type Booking,
  type ClientRef,
  collapseDuplicates,
  type Recording,
  rankForClient,
} from "../../../hermes/csm-calls/callMatch.ts";
import { actionItems } from "../../../hermes/csm-calls/fathomRules.ts";
import { todoItems } from "../../../supabase/functions/cockpit-forms-api/todos.ts";
import { sameName } from "../../../supabase/functions/cockpit-forms-api/transcript.ts";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

type Row = Record<string, any>;
export type Reader = (sql: string) => Promise<Row[]>;
export type Verdict = "same" | "better" | "differs" | "missing";

export const MIGRATIONS = [
  "20261027f_forms_core.sql",
  "20261027g_fathom_intake.sql",
  "20261027h_checkin_plans.sql",
] as const;
/** The effects of a check-in, in the registry's order (2.1 seeds). */
export const EFFECTS = [
  "call_form",
  "call_match",
  "todo_comment",
  "happiness",
  "last_poc",
  "last_checkin_call",
  "grade_notice",
  "recap",
] as const;

const DAY = 86_400_000;
const KUWAIT = 3 * 3_600_000;
const REF = {
  defcon: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
  priority: "c9f99fb1-fec9-47e7-9baa-c5554733723d",
  clientNotes: "5d071906-da6a-4413-a729-0c76d0188d91",
};
const GRADES_CHANNEL = "C09SVG6FHGU";
/** The methods a store knew at booking time; form_task_id and manual come from a form. */
const BOOKING_TIME = new Set([
  "client_id_field",
  "invitee_email",
  "appointment_time",
  "same_room",
]);
/** The why values cockpit_form_checkin_value accepts for a recording (3.1). */
const CALL_WHY = new Set([
  "same_room",
  "invitee_email",
  "pasted",
  "matched",
  "speaker_name",
  "title",
  "domain",
  "near_booking",
  "latest_unlinked",
  "picked",
]);
const VPS = "187.77.156.166";

// ---------------------------------------------------------------------------
// The database the planner stands on (also the parity test's harness).

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

/**
 * What v and w read when they are applied, and what their functions read when
 * they run, cut from the canonical migrations: the sync state, the people
 * list, the roster and the client gate, the media client links, the call
 * briefs, the call store with the live bodies w replaces and the timeline,
 * the sales index (a stand-in with the live column names) and the helpers the
 * forms call, each postgres-only as live. PL/pgSQL resolves a declared row
 * type when a function is created, so the call store comes before v.
 */
async function prerequisites(db: PGlite) {
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
      "cockpit_sales_call_exclusion",
    ),
  );

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

/**
 * An isolated PostgreSQL with Supabase's default privileges, the canonical
 * stand-ins, then v, w and x in order. No connection URL is accepted.
 */
export async function replayDb(): Promise<PGlite> {
  const db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  try {
    await prerequisites(db);
    for (const file of MIGRATIONS) await db.exec(migration(file));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The fixture and the pinned picks.

export type MakeComment = {
  lines: number | null;
  bulletLines: number | null;
  linkFirst: boolean | null;
};
export type Entry = {
  token: string;
  prefix: string;
  card: string;
  client: string;
  submittedAt: string;
  recording: string;
  make: {
    comments: MakeComment[];
    happinessOption: string | null;
    lastPocStored: string | null;
    gradeParts: number;
    recapSends: number;
  };
  cardLastCheckinCall: string | null;
};

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
/**
 * A numeric column as it crosses the read: sq.py prints numeric as text
 * ("0.9"), PGlite may give a number. Anything else, the empty text included,
 * is null, never zero.
 */
const numeric = (v: unknown) => {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === ""))
    return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The fixture's entries joined to the committed picks by the response prefix. */
export function loadEntries(fixture: Row, picks: Row): Entry[] {
  const pinned = new Map<string, Row>(
    (picks.picks ?? []).map((p: Row) => [String(p.response), p]),
  );
  const entries = (fixture.fixtures ?? []).map((f: Row): Entry => {
    const r = f.response ?? {};
    const token = String(r.id ?? "");
    const prefix = token.slice(0, 10);
    const pick = pinned.get(prefix);
    if (!pick) throw new Error(`The response ${prefix} has no pinned pick.`);
    if (pick.card !== r.card)
      throw new Error(`The pinned pick for ${prefix} names another card.`);
    const make = f.make_9209179 ?? {};
    const sends = f.make_9523861 ?? {};
    return {
      token,
      prefix,
      card: String(r.card),
      client: String(r.client ?? ""),
      submittedAt: String(r.submitted_at),
      recording: String(pick.recording),
      make: {
        comments: (make.todo_comment ?? []).map((c: Row) => ({
          lines: num(c.lines),
          bulletLines: num(c.bullet_lines),
          linkFirst:
            typeof c.recording_link_on_first_line === "boolean"
              ? c.recording_link_on_first_line
              : null,
        })),
        happinessOption: make.happiness?.option_id_out ?? null,
        lastPocStored: make.last_poc?.stored_expected ?? null,
        gradeParts: (make.grade_post?.parts ?? []).length,
        recapSends: num(sends.wa_messages) ?? (sends.runs ?? []).length,
      },
      cardLastCheckinCall: f.card_now?.last_checkin_call?.at ?? null,
    };
  });
  if (entries.length !== pinned.size)
    throw new Error(
      "The fixture and the pinned picks hold different responses.",
    );
  return entries;
}

// ---------------------------------------------------------------------------
// Reads. Every value is checked before it goes into a query.

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

/** An address as the replay keeps it: the local part hashed, the domain as is. */
export function maskEmail(e: unknown): string | null {
  const t = String(e ?? "")
    .replace(/^ +| +$/g, "")
    .toLowerCase();
  const at = t.indexOf("@");
  return at > 0 ? `${md5(t.slice(0, at))}@${t.split("@")[1]}` : null;
}
/**
 * A room (zoom:<id>, meet:<code>) as the replay keeps it: hashed. The matcher
 * only compares rooms, so a real meeting code never has to leave the database.
 */
export const maskRoom = (room: unknown): string | null =>
  typeof room === "string" && room !== "" ? `room:${md5(room)}` : null;
export const maskRoomSql = (e: string) =>
  `CASE WHEN ${e} IS NOT NULL AND ${e} <> '' THEN 'room:' || md5(${e}) END`;
/** The same mask in SQL, applied before an address leaves the database. */
export const maskSql = (e: string) =>
  `CASE WHEN position('@' IN lower(btrim(${e}))) > 1 THEN md5(split_part(lower(btrim(${e})), '@', 1)) || '@' || split_part(lower(btrim(${e})), '@', 2) END`;
/**
 * An assignee's name as it may leave the database (docs/forms/STAGE2B-CONTRACT.md
 * 4.13): the matching active cockpit_people name when its first word equals a
 * staff first name, else 'Contact ' and 8 characters of the name's md5; NULL
 * for no name. No contact's name crosses; todoItems still tells staff apart.
 */
export const maskNameSql = (e: string) =>
  `CASE WHEN nullif(btrim(${e}), '') IS NULL THEN NULL ELSE coalesce((SELECT btrim(p.name) FROM public.cockpit_people p WHERE p.active AND nullif(btrim(p.name), '') IS NOT NULL AND lower(split_part(regexp_replace(btrim(p.name), '\\s+', ' ', 'g'), ' ', 1)) = lower(split_part(regexp_replace(btrim(${e}), '\\s+', ' ', 'g'), ' ', 1)) ORDER BY p.id LIMIT 1), 'Contact ' || left(md5(lower(btrim(${e}))), 8)) END`;
/**
 * A meeting's Fathom action items as they may leave the database, for --live
 * and --shadow alike: each description only as a hash, each assignee's email
 * through maskSql and name through maskNameSql; NULL when the meeting holds no
 * action item list. `m` is the cockpit_fathom_meetings alias.
 */
export const actionItemsSql = (
  m: string,
) => `CASE WHEN jsonb_typeof(${m}.raw->'action_items') = 'array' THEN coalesce((
         SELECT jsonb_agg(jsonb_build_object(
                  'description', CASE WHEN nullif(btrim(x->>'description'), '') IS NULL THEN ''
                                      ELSE 'Item ' || left(md5(lower(btrim(regexp_replace(x->>'description', '\\s+', ' ', 'g')))), 12) END,
                  'completed', x->'completed', 'recording_timestamp', x->'recording_timestamp',
                  'assignee', jsonb_build_object('email', ${maskSql("x->'assignee'->>'email'")}, 'team', x->'assignee'->'team',
                                                 'name', ${maskNameSql("x->'assignee'->>'name'")}))
                ORDER BY q.o)
           FROM jsonb_array_elements(${m}.raw->'action_items') WITH ORDINALITY q(x, o) WHERE jsonb_typeof(q.x) = 'object'),
         '[]'::jsonb) END`;
const iso = (e: string) =>
  `to_char((${e}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
function lit(v: string, pattern: RegExp): string {
  if (!pattern.test(v))
    throw new Error("A value the replay reads is not valid.");
  return `'${v}'`;
}
const list = (vs: string[], pattern: RegExp) =>
  vs.length ? vs.map(v => lit(v, pattern)).join(", ") : "NULL";
const TOKEN = /^[A-Za-z0-9]{1,64}$/;
const DIGITS = /^[0-9]{3,20}$/;
const CARD = /^[A-Za-z0-9_-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const answerSql = (ref: string) =>
  `(SELECT a->>'value' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.answers) = 'array' THEN f.answers ELSE '[]'::jsonb END) a WHERE a->>'ref' = '${ref}' LIMIT 1)`;

/** sq.py, spawned from the home folder with nothing on its input; one JSON row a line. */
export function sqReader(
  opts: {
    python?: string;
    script?: string;
    home?: string;
    run?: typeof spawnSync;
  } = {},
): Reader {
  const home = opts.home ?? homedir();
  const python = opts.python ?? join(home, ".cache/mahara-ship/pybin/python");
  const script = opts.script ?? join(home, ".cache/mahara-ship/sq.py");
  const run = opts.run ?? spawnSync;
  return async sql => {
    const out = run(python, [script, sql], {
      cwd: home,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (out.status !== 0)
      throw new Error(
        `The read through sq.py failed (exit ${out.status}): ${String(out.stdout || out.stderr || "").slice(0, 300)}`,
      );
    return String(out.stdout)
      .split("\n")
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  };
}

export type Snapshot = {
  forms: Row[];
  formIndex: Row[];
  meetings: Row[];
  calls: Row[];
  clients: Row[];
  team: Row[];
};

/** 00:00 Kuwait of the day an instant falls on, in UTC milliseconds. */
export const kuwaitMidnight = (ms: number) =>
  Math.floor((ms + KUWAIT) / DAY) * DAY - KUWAIT;
const stamp = (ms: number) => new Date(ms).toISOString();

/** The live reads of --live: six SELECTs, read only. */
export async function readLive(
  read: Reader,
  entries: Entry[],
): Promise<Snapshot> {
  const tokens = list(
    entries.map(e => e.token),
    TOKEN,
  );
  const pinned = list(
    entries.map(e => e.recording),
    DIGITS,
  );
  const submits = entries.map(e => Date.parse(e.submittedAt));
  const first = Math.min(...submits);
  const last = Math.max(...submits);
  // The 14 days of each card's own calls cover 00:00 Kuwait of the day before.
  const lo = lit(stamp(first - 15 * DAY), STAMP);
  const hi = lit(stamp(last), STAMP);
  const bookLo = lit(stamp(kuwaitMidnight(first) - DAY - 2 * 3_600_000), STAMP);
  const bookHi = lit(stamp(last + 2 * 3_600_000), STAMP);
  const notes = `(SELECT CASE WHEN nullif(btrim(a->>'value'), '') IS NOT NULL THEN 'Client notes ' || left(md5(a->>'value'), 12) END FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.answers) = 'array' THEN f.answers ELSE '[]'::jsonb END) a WHERE a->>'ref' = '${REF.clientNotes}' LIMIT 1)`;

  const forms = await read(`-- replay:forms
SELECT f.token, f.task_id, ${iso("f.submitted_at")} AS submitted_at, f.recording_url, f.linked_call_id,
       lc.source AS linked_source, ${answerSql(REF.defcon)} AS defcon, ${answerSql(REF.priority)} AS priority,
       ${notes} AS client_notes
  FROM public.cockpit_csm_call_forms f LEFT JOIN public.cockpit_csm_calls lc ON lc.id = f.linked_call_id
 WHERE f.token IN (${tokens})`);
  const formIndex = await read(`-- replay:form_index
SELECT f.token, f.task_id, ${iso("f.submitted_at")} AS submitted_at,
       substring(f.answers::text FROM 'https://fathom\\.video/share/[A-Za-z0-9_-]+') AS share
  FROM public.cockpit_csm_call_forms f WHERE f.form_kind = 'checkin' AND f.task_id IS NOT NULL`);
  const meetings = await read(`-- replay:meetings
SELECT m.recording_id, ${iso("m.starts_at")} AS starts_at, ${iso("m.ends_at")} AS ends_at, ${maskRoomSql("m.room")} AS room, m.title,
       m.raw->>'meeting_title' AS meeting_title, m.class, ${maskSql("m.recorded_by_email")} AS recorder_email,
       coalesce(m.recorder_team, m.raw->'recorded_by'->>'team') AS recorder_team, m.share_url, m.url,
       ${iso("m.gone_at")} AS gone_at, m.raw->>'created_at' AS created_at,
       coalesce((SELECT jsonb_agg(DISTINCT ${maskSql("i->>'email'")})
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.invitees) = 'array' THEN m.invitees ELSE '[]'::jsonb END) i
                  WHERE nullif(btrim(i->>'email'), '') IS NOT NULL), '[]'::jsonb) AS invitee_emails,
       CASE WHEN m.recording_id IN (${pinned}) THEN ${actionItemsSql("m")} END AS action_items,
       c.id AS call_id, c.task_id, c.client_name, c.match_method, c.match_confidence, c.linked_call_id, c.status AS call_status,
       c.settled_reason, c.kind AS call_kind, ${iso("c.starts_at")} AS call_starts_at
  FROM public.cockpit_fathom_meetings m
  LEFT JOIN public.cockpit_csm_calls c ON c.source = 'fathom' AND c.source_id = m.recording_id
 WHERE m.starts_at BETWEEN ${lo} AND ${hi} OR m.recording_id IN (${pinned})`);
  const calls = await read(`-- replay:calls
SELECT b.id, b.source, b.task_id, b.client_name, b.kind, b.status, ${iso("b.starts_at")} AS starts_at,
       ${iso("b.ends_at")} AS ends_at, ${maskRoomSql("b.room")} AS room, b.linked_call_id, b.match_method,
       coalesce((SELECT jsonb_agg(DISTINCT ${maskSql("i->>'email'")})
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.external_invitees) = 'array' THEN b.external_invitees ELSE '[]'::jsonb END) i
                  WHERE nullif(btrim(i->>'email'), '') IS NOT NULL), '[]'::jsonb) AS emails
  FROM public.cockpit_csm_calls b
 WHERE (b.source = 'ghl_appointment' AND b.task_id IS NOT NULL AND b.status <> 'gone'
        AND b.starts_at BETWEEN ${bookLo} AND ${bookHi})
    OR b.id IN (SELECT c.linked_call_id FROM public.cockpit_csm_calls c
                 WHERE c.source = 'fathom' AND c.source_id IN (${pinned}) AND c.linked_call_id IS NOT NULL)
    OR b.id IN (SELECT f.linked_call_id FROM public.cockpit_csm_call_forms f
                 WHERE f.token IN (${tokens}) AND f.linked_call_id IS NOT NULL)`);
  const clients = await read(`-- replay:clients
SELECT s.data->>'taskId' AS task_id, btrim(s.data->>'name') AS name,
       coalesce((SELECT jsonb_agg(DISTINCT z.a ORDER BY z.a) FROM (
           SELECT btrim(l.data->>'name') AS a FROM public.cockpit_media_sources l
            WHERE l.table_name = 'clientLinks' AND l.data->>'taskId' = s.data->>'taskId'
           UNION ALL
           SELECT btrim(al) FROM public.cockpit_media_sources l
            CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.data->'aliases') = 'array'
                                                              THEN l.data->'aliases' ELSE '[]'::jsonb END) al
            WHERE l.table_name = 'clientLinks' AND l.data->>'taskId' = s.data->>'taskId') z
          WHERE nullif(z.a, '') IS NOT NULL), '[]'::jsonb) AS aliases
  FROM public.cockpit_csm_sources s
 WHERE s.table_name = 'clients' AND nullif(s.data->>'taskId', '') IS NOT NULL AND nullif(btrim(s.data->>'name'), '') IS NOT NULL`);
  // The team's seats and roster: the role of whoever sent the notes and of
  // each staff address, computed in PGlite by the real cockpit_slack_notice_role_of.
  const team = await read(`-- replay:team
SELECT 'person' AS kind, btrim(p.name) AS name, lower(btrim(p.email)) AS email, p.role, p.active,
       NULL::text[] AS roles, NULL::text AS updated_at, NULL::boolean AS csm_only
  FROM public.cockpit_people p WHERE p.active
UNION ALL
SELECT 'member', NULL, m.email, NULL, m.active, m.roles, ${iso("m.updated_at")},
       (m.active AND u.email_confirmed_at IS NOT NULL AND m.email = lower(btrim(u.email)) AND 'csm' = ANY(m.roles)
        AND NOT 'admin' = ANY(m.roles) AND NOT 'ceo' = ANY(m.roles)
        AND m.email NOT IN ('aziz@maharamedia.com','awaheedi2008@gmail.com'))
  FROM public.cockpit_members m LEFT JOIN auth.users u ON u.id = m.auth_user_id`);
  return { forms, formIndex, meetings, calls, clients, team };
}

// ---------------------------------------------------------------------------
// The pick, as of each submit (7.4 step 1).

const ms = (v: unknown) => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : null;
};
const between = (v: unknown, from: number, to: number) => {
  const t = ms(v);
  return t !== null && t >= from && t <= to;
};
const arr = (v: unknown): any[] => {
  const x = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(x) ? x : [];
};

export type Staff = { name: string; email: string | null; role: string | null };
export type Pick = {
  recording: string | null;
  signal: string | null;
  label: string | null;
  method: string | null;
  inStore: boolean;
};

/**
 * What rankForClient would have seen at the submit: the meetings Fathom had
 * listed by then (raw created_at) that started since 00:00 Kuwait of the day
 * before, plus the card's own calls of the 14 days before; a client match
 * only from a method the store knew at booking time (never form_task_id or
 * manual, which a form taught it), with the call row's match_confidence as
 * the window passes it (onTaskConfidence: an invitee_email row is a matched
 * sign only at 0.9 or more, 5.2 row 3b); form links and the last notes only from
 * forms sent before this one, never its own link; no pasted link; now = the
 * submit.
 */
export function pickAsOf(s: Snapshot, e: Entry, staff: Staff[]): Pick {
  const at = Date.parse(e.submittedAt);
  const from = kuwaitMidnight(at) - DAY;
  const listed = (m: Row) => {
    const t = ms(m.created_at);
    return t !== null && t < at;
  };
  const known = (m: Row) => BOOKING_TIME.has(String(m.match_method ?? ""));
  const store = s.meetings.filter(
    m => between(m.starts_at, from, at) && listed(m),
  );
  const own = s.meetings.filter(
    m =>
      m.task_id === e.card &&
      m.call_status !== "gone" &&
      known(m) &&
      listed(m) &&
      between(m.call_starts_at ?? m.starts_at, at - 14 * DAY, at),
  );
  const recs: Recording[] = [...store, ...own].map(m => ({
    recordingId: String(m.recording_id),
    startsAt: ms(m.starts_at) ?? 0,
    endsAt: ms(m.ends_at),
    room: m.room ?? null,
    title: m.title ?? null,
    meetingTitle: m.meeting_title ?? null,
    cls: m.class ?? "internal",
    recorderEmail: m.recorder_email ?? null,
    recorderTeam: m.recorder_team ?? null,
    inviteeEmails: arr(m.invitee_emails).filter(Boolean),
    shareUrl: m.share_url ?? null,
    gone: (ms(m.gone_at) ?? Number.POSITIVE_INFINITY) <= at,
    settled: false,
    onTask: known(m) ? (m.task_id ?? null) : null,
    onTaskMethod: known(m) ? (m.match_method ?? null) : null,
    // As the window's store item and onClient row carry it: callMatch.ts
    // placedExactly reads invitee_email as matched only at 0.9 or more.
    onTaskConfidence: known(m) ? numeric(m.match_confidence) : null,
  }));
  const bookings: Booking[] = s.calls
    .filter(
      b =>
        b.source === "ghl_appointment" &&
        b.task_id &&
        b.status !== "gone" &&
        between(b.starts_at, from - 2 * 3_600_000, at + 2 * 3_600_000),
    )
    .map(b => ({
      id: Number(b.id),
      taskId: String(b.task_id),
      clientName: String(b.client_name ?? ""),
      kind: String(b.kind ?? "other"),
      status: String(b.status ?? "booked"),
      startsAt: ms(b.starts_at) ?? 0,
      endsAt: ms(b.ends_at),
      room: b.room ?? null,
      emails: arr(b.emails).filter(Boolean),
      contactNames: [],
    }));
  const earlier = s.formIndex.filter(
    f => f.token !== e.token && (ms(f.submitted_at) ?? at) < at,
  );
  const formLinks = new Map<string, string>(
    earlier
      .filter(f => f.share)
      .sort(
        (a, b) =>
          String(a.share).localeCompare(String(b.share)) ||
          String(a.task_id).localeCompare(String(b.task_id)),
      )
      .map(f => [String(f.share), String(f.task_id)]),
  );
  const notes = earlier
    .filter(f => f.task_id === e.card)
    .map(f => ms(f.submitted_at) ?? 0);
  const clients: ClientRef[] = s.clients.map(c => ({
    taskId: String(c.task_id),
    name: String(c.name),
    aliases: arr(c.aliases).map(String),
  }));
  const roles = new Map(staff.map(p => [p.email, p.role]));
  const csmEmails = s.team
    .filter(t => t.kind === "member" && t.csm_only === true)
    .map(t => maskEmail(t.email))
    .filter((x): x is string => Boolean(x));
  const { picked } = rankForClient(
    e.card,
    collapseDuplicates(recs),
    bookings,
    clients,
    {
      formLinks,
      staffNames: staff.map(p => p.name).filter(Boolean),
      csmEmails,
      now: at,
      viewerEmail: null,
      roleOf: email => (email ? (roles.get(email) ?? null) : null),
      lastNoteAt: notes.length ? Math.max(...notes) : null,
      pastedShareUrl: null,
    },
  );
  const rec = recs.find(r => r.recordingId === picked?.recordingId);
  return {
    recording: picked?.recordingId ?? null,
    signal: picked?.signal ?? null,
    label: picked?.label ?? null,
    method: picked?.signal === "matched" ? (rec?.onTaskMethod ?? null) : null,
    inStore: recs.some(r => r.recordingId === e.recording),
  };
}

// ---------------------------------------------------------------------------
// The plans, in PGlite (7.4 steps 2 and 3).

/** Whom Fathom assigned a response's open (not completed) action items to. */
export type Assignees = {
  /** The recording's recorder, by address. */
  recorder: number;
  /** Another staff member: a maharamedia.com address, a Fathom team, or a staff name with neither. */
  staff: number;
  /** An address outside Mahara. */
  clientEmail: number;
  /** A name with no address or team that is not on the staff list. */
  nameOnly: number;
  /** No address, team or name. */
  none: number;
};
export const NO_ASSIGNEES: Assignees = {
  recorder: 0,
  staff: 0,
  clientEmail: 0,
  nameOnly: 0,
  none: 0,
};

/** The counts of Assignees for one recording's stored action items (masked as the SQL leaves them). */
export function assigneesOf(
  items: ReturnType<typeof actionItems>,
  recorderEmail: unknown,
  staff: Staff[],
): Assignees {
  const out = { ...NO_ASSIGNEES };
  const recorder = String(recorderEmail ?? "")
    .trim()
    .toLowerCase();
  for (const i of items) {
    if (i.completed) continue;
    const mail = String(i.assigneeEmail ?? "")
      .trim()
      .toLowerCase();
    const name = String(i.assigneeName ?? "").trim();
    if (mail && mail === recorder) out.recorder++;
    else if (/@maharamedia\.com$/.test(mail) || i.assigneeTeam) out.staff++;
    else if (mail) out.clientEmail++;
    else if (!name) out.none++;
    else if (staff.some(s => sameName(name, s.name))) out.staff++;
    else out.nameOnly++;
  }
  return out;
}
const openOf = (a: Assignees) =>
  a.recorder + a.staff + a.clientEmail + a.nameOnly + a.none;

export type Planned = {
  plans: Row[] | null;
  reason: string | null;
  todos: {
    items: number;
    ours: number;
    theirs: number;
    unsure: number;
    cut: number;
    assignees: Assignees | null;
  };
};

async function one<T = any>(
  db: PGlite,
  sql: string,
  params: unknown[],
): Promise<T> {
  return (await db.query<{ v: T }>(sql, params)).rows[0]?.v as T;
}
const checkinValue = (db: PGlite, key: string, value: unknown, card: string) =>
  one(db, "SELECT public.cockpit_form_checkin_value($1, $2::jsonb, $3) AS v", [
    key,
    JSON.stringify(value ?? null),
    card,
  ]);

/**
 * The team, the call rows and the pinned meetings, as the planner reads them.
 * Returns the staff list with each role from the real cockpit_slack_notice_role_of.
 */
export async function loadStore(
  db: PGlite,
  s: Snapshot,
  entries: Entry[],
): Promise<Staff[]> {
  for (const t of s.team) {
    if (t.kind === "member")
      await db.query(
        "INSERT INTO public.cockpit_members(email, roles, active, updated_at) VALUES ($1, $2, $3, coalesce($4::timestamptz, now()))",
        [t.email, t.roles ?? [], t.active !== false, t.updated_at ?? null],
      );
    else if (t.name)
      await db.query(
        "INSERT INTO public.cockpit_people(name, email, role, active, added_by) VALUES ($1, $2, $3, $4, 'replay')",
        [t.name, t.email ?? null, t.role ?? null, t.active !== false],
      );
  }
  const staff = (
    await db.query<Staff>(
      "SELECT p.name, lower(btrim(p.email)) AS email, public.cockpit_slack_notice_role_of(p.email) AS role FROM public.cockpit_people p WHERE p.active ORDER BY p.id",
    )
  ).rows.map(p => ({ ...p, email: maskEmail(p.email) }));

  // Call rows by id: the bookings and parents, then the recordings' own rows.
  const rows = new Map<number, Row>();
  for (const b of s.calls) rows.set(Number(b.id), { ...b });
  for (const m of s.meetings)
    if (m.call_id != null)
      rows.set(Number(m.call_id), {
        id: m.call_id,
        source: "fathom",
        source_id: m.recording_id,
        task_id: m.task_id,
        client_name: m.client_name,
        kind: m.call_kind,
        status: m.call_status,
        starts_at: m.call_starts_at ?? m.starts_at,
        ends_at: m.ends_at,
        room: m.room,
        linked_call_id: m.linked_call_id,
        match_method: m.match_method,
        // The tie rule's rule 2 (cockpit_form_recording_tied, through
        // cockpit_form_checkin_value) reads it: an invitee_email row ties only
        // at 0.9 or more, as on production.
        match_confidence: m.match_confidence,
        settled_reason: m.settled_reason,
      });
  // A row read with no confidence column (the bookings) keeps the stand-in:
  // 1 when a method placed it, else none.
  const confidenceOf = (r: Row) =>
    r.match_confidence !== undefined
      ? numeric(r.match_confidence)
      : r.match_method == null
        ? null
        : 1;
  const done = new Set<number>();
  const insert = async (id: number, path: Set<number>) => {
    const r = rows.get(id);
    if (!r || done.has(id) || path.has(id)) return;
    const parent = r.linked_call_id == null ? null : Number(r.linked_call_id);
    if (parent !== null) await insert(parent, new Set([...path, id]));
    done.add(id);
    await db.query(
      `INSERT INTO public.cockpit_csm_calls(id, source, source_id, task_id, client_name, match_method, match_confidence,
         kind, starts_at, ends_at, status, room, linked_call_id, settled_reason)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, $3, $4, $5, $6, $14::numeric, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        r.source,
        r.source === "fathom"
          ? String(r.source_id)
          : `${r.source}-replay-${id}`,
        r.task_id ?? null,
        r.client_name ?? null,
        r.match_method ?? null,
        r.kind ?? "other",
        r.starts_at ?? null,
        r.ends_at ?? null,
        r.status ?? "held",
        r.room ?? null,
        parent !== null && rows.has(parent) ? parent : null,
        r.settled_reason ?? null,
        confidenceOf(r),
      ],
    );
  };
  for (const id of rows.keys()) await insert(id, new Set());

  const pins = new Set(entries.map(e => e.recording));
  for (const m of s.meetings.filter(x => pins.has(String(x.recording_id))))
    await db.query(
      `INSERT INTO public.cockpit_fathom_meetings(recording_id, title, starts_at, ends_at, recorded_by_email, url, share_url,
         raw, class, room, recorder_team, gone_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
      [
        m.recording_id,
        m.title ?? null,
        m.starts_at ?? null,
        m.ends_at ?? null,
        m.recorder_email ?? null,
        m.url ?? null,
        m.share_url ?? null,
        JSON.stringify({
          meeting_title: m.meeting_title ?? null,
          recorded_by: { team: m.recorder_team ?? null },
          created_at: m.created_at ?? null,
          action_items: m.action_items ?? null,
        }),
        m.class ?? null,
        m.room ?? null,
        m.recorder_team ?? null,
        m.gone_at ?? null,
      ],
    );
  return staff;
}

/**
 * Each form's answers as the window would send them: the pinned recording,
 * normalised by the real cockpit_form_checkin_value and confirmed; DEFCON and
 * priority from the Typeform; We owe and They owe from the stored action
 * items through todoItems (no speaker side: the replay has no labelled
 * transcript, so a name-only item is ours when the name is on the staff list,
 * else theirs and unsure, 2b 4.13); the client notes. Then the response is
 * stored submitted, in shadow, and planned. loadStore runs first.
 */
export async function planEntries(
  db: PGlite,
  s: Snapshot,
  entries: Entry[],
  picks: Map<string, Pick>,
  staff: Staff[],
): Promise<Map<string, Planned>> {
  const sender =
    s.team
      .filter(t => t.kind === "member" && t.csm_only === true)
      .map(t => String(t.email))
      .sort()[0] ?? null;
  const planned = new Map<string, Planned>();
  for (const e of entries) {
    const form = s.forms.find(f => f.token === e.token);
    const meeting = s.meetings.find(
      m => String(m.recording_id) === e.recording,
    );
    const stored = actionItems({ action_items: arr(meeting?.action_items) });
    const todos: Planned["todos"] = {
      items: 0,
      ours: 0,
      theirs: 0,
      unsure: 0,
      cut: 0,
      assignees: meeting
        ? assigneesOf(stored, meeting.recorder_email, staff)
        : null,
    };
    const pick = picks.get(e.token);
    if (!form || !meeting) {
      planned.set(e.token, {
        plans: null,
        todos,
        reason: form
          ? "The pinned recording is not in the store."
          : "The Typeform row is not in the store.",
      });
      continue;
    }
    try {
      const why =
        pick?.recording === e.recording && CALL_WHY.has(String(pick.signal))
          ? pick.signal
          : "picked";
      const call = await checkinValue(
        db,
        "call",
        { kind: "fathom", recordingId: e.recording, why, confirmed: true },
        e.card,
      );
      const items = todoItems(stored, {
        shareUrl: call?.shareUrl ?? null,
        staff,
      }).map(i => ({ ...i, from: "fathom" }));
      todos.unsure = items.filter(i => i.unsure).length;
      const side = (s: "we" | "they") => {
        const list = items
          .filter(i => i.side === s)
          .map(({ side: _side, ...item }) => item);
        todos.cut += Math.max(0, list.length - 30);
        return list.slice(0, 30);
      };
      const answers: Row = { call };
      for (const [key, value] of [
        ["defcon", form.defcon],
        ["priority", form.priority],
        ["we_owe", side("we")],
        ["they_owe", side("they")],
        ["client_notes", form.client_notes],
      ] as const) {
        const v =
          value == null ? null : await checkinValue(db, key, value, e.card);
        if (v != null) answers[key] = v;
      }
      todos.ours = arr(answers.we_owe).length;
      todos.theirs = arr(answers.they_owe).length;
      todos.items = todos.ours + todos.theirs;
      const id = await one<string>(
        db,
        `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, client_name,
           mode, state, answers, created_by, submitted_by, submitted_at)
         VALUES (md5($1)::uuid, 'checkin', 1, 'import', $1, $2, $3, 'shadow', 'submitted', $4::jsonb, 'import', $5, $6)
         RETURNING id::text AS v`,
        [
          e.token,
          e.card,
          e.client || null,
          JSON.stringify(answers),
          sender,
          e.submittedAt,
        ],
      );
      const plans = await one<Row[]>(
        db,
        "SELECT public.cockpit_form_checkin_plan(r) AS v FROM public.cockpit_form_responses r WHERE r.id = $1::uuid",
        [id],
      );
      planned.set(e.token, { plans: arr(plans), reason: null, todos });
    } catch (error) {
      // The window's own sentence, less any quoted value (an answer is never
      // reported), whole: the reason stays within 240 characters, as every
      // reason in this contract does, and the window's longest sentence (the
      // tie rule's OUTSIDE_CS_LIKELY, 185, A7.14, A7.18) fits after the lead.
      const lead = "The window would refuse it: ";
      const said = String((error as Error).message)
        .replace(/"[^"]*"/g, "a value")
        .slice(0, 240 - lead.length);
      planned.set(e.token, { plans: null, todos, reason: `${lead}${said}` });
    }
  }
  return planned;
}

// ---------------------------------------------------------------------------
// Verdicts (7.4 step 4): shapes, targets and values, never text.

export type Judged = {
  effect: string;
  state: string | null;
  verdict: Verdict;
  reason: string;
  /** A difference whose cause is known and named in the reason (2b 4.13, to-do comments only). */
  explained?: true;
};

/** The two sentences that explain a to-do comment difference (docs/forms/STAGE2B-CONTRACT.md 4.13), word for word. */
export const TODO_EXPLAINED = {
  recorder: (n: number) =>
    `They owe is empty: Fathom assigned all ${n} action items to the recorder; none names the client side.`,
  gpt: (n: number) =>
    `Make's comment is GPT's list from the whole transcript and the Additional Notes ([3]); the plan is Fathom's ${n} action items, which the CSM edits before she sends.`,
};

/** The London date ClickUp keeps for a date-only value. */
export function londonDay(at: unknown): string | null {
  const t = ms(at);
  if (t === null) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}
/** A Fathom link without its query, fragment or trailing slash, host lower case. */
export function linkKey(url: unknown): string | null {
  const m = /^(https?:\/\/[^/?#\s]+)(\/[^?#\s]*)?/i.exec(
    String(url ?? "").trim(),
  );
  return m ? `${m[1].toLowerCase()}${(m[2] ?? "").replace(/\/+$/, "")}` : null;
}
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

type CardCalls = Map<number, Row>;
/**
 * Is the call the notes link one the card's timeline shows? The timeline
 * lists a card's calls that are not gone, less a row linked to a parent on the
 * same card that is not gone (20261011f_csm_eod_mentions.sql). A recording on
 * no client yet counts when call_match is planned: the executor puts it on the
 * card first and resolves the link again.
 */
function shown(
  link: unknown,
  calls: CardCalls,
  card: string,
  matchPlanned: boolean,
): boolean {
  const c = link == null ? undefined : calls.get(Number(link));
  if (!c || c.status === "gone") return false;
  if (c.task_id !== card && !(matchPlanned && c.source === "fathom"))
    return false;
  if (c.linked_call_id == null) return true;
  const parent = calls.get(Number(c.linked_call_id));
  return !(parent && parent.task_id === card && parent.status !== "gone");
}

export type Compare = {
  card: string;
  /** Make's comments on the card for this response, newest first as the fixture lists them. */
  makeComments: MakeComment[] | null;
  makeHappiness: string | null;
  makeLastPocDay: string | null;
  makeGradeParts: number | null;
  makeGradeError?: string | null;
  makeRecapSends: number | null;
  cardLastCheckinDay: string | null;
  typeform: {
    defcon: string | null;
    priority: string | null;
    recordingUrl: string | null;
    linkedSource: string | null;
  } | null;
  /** The pinned meeting's /calls/{n} page, which a Typeform row may hold instead of the share link. */
  meetingUrl: string | null;
  storedActionItems: number | null;
  /** Whom Fathom assigned the open action items to: --live always; --shadow only while the CSM's list still equals Fathom's open items, side by side; null when unknown or edited. */
  todoAssignees?: Assignees | null;
  calls: CardCalls;
  nativeLinkFirst: boolean | null;
};

/** A plan that would happen: planned in the planner's output, dry_run once a shadow submit stored it. */
const WOULD = new Set(["planned", "dry_run", "queued", "delivered"]);
const would = (p: Row | undefined) => WOULD.has(String(p?.state));

export function judge(plans: Row[] | null, c: Compare): Judged[] {
  const el = (k: string) => plans?.find(p => p.effect === k);
  const out: Judged[] = [];
  const add = (
    effect: string,
    verdict: Verdict,
    reason: string,
    state = el(effect)?.state ?? null,
  ) => out.push({ effect, state, verdict, reason });
  const explained = (effect: string, reason: string) =>
    out.push({
      effect,
      state: el(effect)?.state ?? null,
      verdict: "differs",
      reason,
      explained: true,
    });
  if (!plans) {
    for (const k of EFFECTS)
      add(k, "missing", "No plan: the response could not be planned.", null);
    return out;
  }

  // call_form
  {
    const p = el("call_form");
    if (!p) add("call_form", "missing", "No call_form plan.");
    else {
      const row = p.plan?.row ?? {};
      const answer = (title: string) =>
        arr(row.answers).find(a => a?.title === title)?.value ?? null;
      const tf = c.typeform;
      const labels =
        !!tf &&
        answer("Defcon Status") === tf.defcon &&
        answer("Task Priority") === tf.priority;
      const tfLink = linkKey(tf?.recordingUrl);
      const linkOk =
        !tfLink ||
        tfLink === linkKey(row.recording_url) ||
        tfLink === linkKey(c.meetingUrl);
      const matchPlanned = would(el("call_match"));
      const isShown =
        row.linked_call_id == null
          ? p.plan?.linkAfterMatch === true && matchPlanned
          : shown(row.linked_call_id, c.calls, c.card, matchPlanned);
      const target =
        row.linked_call_id == null
          ? null
          : c.calls.get(Number(row.linked_call_id));
      if (!labels)
        add(
          "call_form",
          "differs",
          "The planned row's DEFCON or priority differs from the Typeform row's.",
        );
      else if (!linkOk)
        add(
          "call_form",
          "differs",
          "The planned row's recording link differs from the Typeform row's.",
        );
      else if (!isShown)
        add(
          "call_form",
          "differs",
          row.linked_call_id == null
            ? "The planned row has no call to link and call_match is not planned."
            : `The planned row links call ${row.linked_call_id}, which the timeline hides under a live parent or does not hold.`,
        );
      else if (
        tf?.linkedSource === "checkin_form" &&
        (row.linked_call_id == null ||
          target?.source === "fathom" ||
          target?.source === "ghl_appointment")
      )
        add(
          "call_form",
          "better",
          row.linked_call_id == null
            ? "The Typeform row links its own checkin_form row; the plan links the recording once call_match has put it on the client: one call on the card instead of two."
            : `The Typeform row links its own checkin_form row; the plan links the ${target?.source === "fathom" ? "recording" : "booking"} (call ${row.linked_call_id}): one call on the card instead of two.`,
        );
      else
        add(
          "call_form",
          "same",
          row.linked_call_id == null
            ? "DEFCON, priority and the recording link equal the Typeform row's; the row links the recording once call_match has put it on the client."
            : `DEFCON, priority and the recording link equal the Typeform row's; the row links call ${row.linked_call_id}, which the timeline shows.`,
        );
    }
  }

  // call_match: Make never put a recording on a client; the check is that the
  // plan follows the store.
  {
    const p = el("call_match");
    if (!p) add("call_match", "missing", "No call_match plan.");
    else if (would(p))
      add(
        "call_match",
        "same",
        p.plan?.callId == null
          ? "The recording has no call row yet: it would be stored and put on this client."
          : `The recording's call row ${p.plan.callId} is on no client yet: it would be put on this client.`,
      );
    else add("call_match", "same", `Skipped: ${p.reason}`);
  }

  // todo_comment
  {
    const p = el("todo_comment");
    const make = c.makeComments ?? [];
    const bullets = make[0]?.bulletLines ?? null;
    if (!p) add("todo_comment", "missing", "No todo_comment plan.");
    else if (!would(p))
      add(
        "todo_comment",
        "differs",
        c.storedActionItems
          ? `Skipped (${p.reason}) although the recording has ${plural(c.storedActionItems, "stored action item")}.`
          : `Skipped (${p.reason}): the recording has no stored action item.`,
      );
    else {
      const items = Number(p.plan?.items ?? 0);
      const ours = Number(p.plan?.sides?.ours ?? 0);
      const theirs = Number(p.plan?.sides?.theirs ?? 0);
      const counts = `The plan has ${plural(items, "line")} (${ours} ours, ${theirs} theirs)`;
      // A content difference is explained when the replay knows whom Fathom
      // assigned the open items to and the plan is those items (--live always;
      // --shadow only while the CSM's list is still Fathom's). An empty side
      // is explained only when Fathom assigned it nothing: They owe when no
      // open item went to a client address or a name off the staff list (all
      // to the recorder: the recorder sentence; to other staff too: GPT's
      // list), We owe when none went to the recorder, other staff or no one.
      // Both sides empty, or an empty side Fathom gave items to, stays an
      // unexplained difference: it is the defect G3 guards (client items in
      // We owe), not GPT's list. Fewer lines than Make's bullets with both
      // sides planned is GPT's own list (module [3]).
      const a = c.todoAssignees ?? null;
      const open = a ? openOf(a) : 0;
      const gpt = (said: string) =>
        a && open
          ? explained("todo_comment", `${said} ${TODO_EXPLAINED.gpt(open)}`)
          : add("todo_comment", "differs", said);
      const emptySide = (said: string) => {
        if (!a || !open || (!ours && !theirs))
          add("todo_comment", "differs", said);
        else if (!theirs)
          a.clientEmail + a.nameOnly
            ? add("todo_comment", "differs", said)
            : a.recorder === open
              ? explained(
                  "todo_comment",
                  `${counts}. ${TODO_EXPLAINED.recorder(open)}`,
                )
              : gpt(said);
        else
          a.recorder + a.staff + a.none
            ? add("todo_comment", "differs", said)
            : gpt(said);
      };
      if (p.plan?.notify_all !== false)
        add("todo_comment", "differs", `${counts} but would notify everyone.`);
      else if (!ours || !theirs)
        emptySide(
          `${counts}: ${!ours && !theirs ? "both sides are" : !ours ? "We owe is" : "They owe is"} empty.`,
        );
      else if (bullets !== null && items * 2 < bullets)
        gpt(`${counts}; Make's comment had ${plural(bullets, "bullet line")}.`);
      else if (make.length >= 2)
        add(
          "todo_comment",
          "better",
          `${counts}; Make posted ${make.length} comments for this response.`,
        );
      else if (!make.length)
        add(
          "todo_comment",
          "better",
          `${counts}; Make posted no comment for this response.`,
        );
      else if (make[0].linkFirst === false && c.nativeLinkFirst)
        add(
          "todo_comment",
          "better",
          `${counts}, the recording link on line 1; Make's comment had ${plural(bullets ?? 0, "bullet line")} and no link on line 1.`,
        );
      else
        add(
          "todo_comment",
          "same",
          `${counts}; Make's comment had ${plural(bullets ?? 0, "bullet line")}.`,
        );
    }
  }

  // happiness
  {
    const p = el("happiness");
    if (!p) add("happiness", "missing", "No happiness plan.");
    else if (!would(p)) add("happiness", "differs", `Skipped: ${p.reason}`);
    else if (c.makeHappiness && p.plan?.value === c.makeHappiness)
      add("happiness", "same", `Option ${p.plan.value}, as Make wrote.`);
    else
      add(
        "happiness",
        "differs",
        `The plan sets option ${p.plan?.value}; Make wrote ${c.makeHappiness ?? "nothing"}.`,
      );
  }

  // last_poc
  {
    const p = el("last_poc");
    if (!p) add("last_poc", "missing", "No last_poc plan.");
    else if (c.makeLastPocDay && p.plan?.day === c.makeLastPocDay)
      add("last_poc", "same", `${p.plan.day}, the day Make's write keeps.`);
    else
      add(
        "last_poc",
        "differs",
        `The plan sets ${p.plan?.day}; Make's write keeps ${c.makeLastPocDay ?? "no day"}.`,
      );
  }

  // last_checkin_call: new (Make never wrote it); the card's value is information.
  {
    const p = el("last_checkin_call");
    if (!p) add("last_checkin_call", "missing", "No last_checkin_call plan.");
    else
      add(
        "last_checkin_call",
        "same",
        `New: Make never wrote it. The plan sets ${p.plan?.day}; the card shows ${c.cardLastCheckinDay ?? "no date"} now.`,
      );
  }

  // grade_notice
  {
    const p = el("grade_notice");
    if (!p) add("grade_notice", "missing", "No grade_notice plan.");
    else if (!would(p)) add("grade_notice", "differs", `Skipped: ${p.reason}`);
    else if (p.plan?.target !== GRADES_CHANNEL)
      add(
        "grade_notice",
        "differs",
        "The grade would post in another channel.",
      );
    else if (c.makeGradeParts && c.makeGradeParts > 0)
      add(
        "grade_notice",
        "same",
        `Planned once for the recording (${p.plan.dedupe}); Make posted the grade in ${plural(c.makeGradeParts, "part")}.`,
      );
    else
      add(
        "grade_notice",
        "differs",
        c.makeGradeError
          ? `Planned; Make's grade could not be read (${c.makeGradeError}).`
          : "Planned; Make posted no grade.",
      );
  }

  // recap
  {
    const p = el("recap");
    if (!p) add("recap", "missing", "No recap plan.");
    else if (!would(p)) add("recap", "differs", `Skipped: ${p.reason}`);
    else if (p.plan?.state !== "awaiting_approval")
      add("recap", "differs", "The recap would not wait for approval.");
    else if ((c.makeRecapSends ?? 0) >= 2)
      add(
        "recap",
        "better",
        `Held for approval and never sent; Make sent the recap ${c.makeRecapSends} times.`,
      );
    else add("recap", "same", "Held for approval in the cockpit; never sent.");
  }
  return out;
}

/** The pick's verdict: the pinned recording, decided by no form's own link. */
export function judgePick(pick: Pick, pinned: string): Judged {
  const base = { effect: "pick", state: pick.signal };
  if (!pick.inStore)
    return {
      ...base,
      verdict: "missing",
      reason: "The pinned recording was not in the store as of the submit.",
    };
  if (pick.recording !== pinned)
    return {
      ...base,
      verdict: "differs",
      reason: pick.recording
        ? `As of the submit the matcher picks ${pick.recording} (${pick.signal}), not ${pinned}.`
        : "As of the submit the matcher picks nothing.",
    };
  if (
    pick.signal === "pasted" ||
    (pick.signal === "matched" &&
      ["form_task_id", "manual"].includes(String(pick.method)))
  )
    return {
      ...base,
      verdict: "differs",
      reason: `Picked by ${pick.signal}${pick.method ? ` (${pick.method})` : ""}, which a form taught the store.`,
    };
  return {
    ...base,
    verdict: "same",
    reason: `Picked by ${pick.signal} (${pick.label}).`,
  };
}

// ---------------------------------------------------------------------------
// The report (7.4 step 5).

export type ResponseReport = {
  response: string;
  card: string;
  client: string;
  recording: string | null;
  planned: boolean;
  reason: string | null;
  pick: Judged;
  todos: Planned["todos"] & {
    makeBulletLines: number | null;
    makeComments: number;
  };
  effects: Judged[];
};
export type Pass = { check: string; count: number; of: number; pass: boolean };
export type Report = {
  report: "checkin-replay";
  mode: "live" | "shadow";
  contract: "docs/forms/STAGE2-CONTRACT.md 7.4";
  ranAt: string;
  responses: ResponseReport[];
  passes: Pass[];
  pass: boolean;
};

/** The passes of 7.4 ("part of 2a's proof"). */
export function passesOf(rs: ResponseReport[]): Pass[] {
  const of = rs.length;
  const eff = (r: ResponseReport, k: string) =>
    r.effects.find(e => e.effect === k);
  const count = (f: (r: ResponseReport) => boolean) => rs.filter(f).length;
  const checks: [string, number][] = [
    [
      "picks: the pinned recording, decided by no pasted link or form-taught match",
      count(r => r.pick.verdict === "same"),
    ],
    [
      "Client Happiness option as Make wrote",
      count(r => eff(r, "happiness")?.verdict === "same"),
    ],
    [
      "Last POC day as Make's write keeps",
      count(r => eff(r, "last_poc")?.verdict === "same"),
    ],
    [
      "a to-do comment planned, or skipped only where the recording has no stored action item",
      count(
        r =>
          WOULD.has(String(eff(r, "todo_comment")?.state)) ||
          (eff(r, "todo_comment")?.state === "skipped" &&
            /no stored action item/.test(eff(r, "todo_comment")?.reason ?? "")),
      ),
    ],
    [
      "the grade notice planned",
      count(r => WOULD.has(String(eff(r, "grade_notice")?.state))),
    ],
    [
      "call_form: DEFCON, priority and its link a shown call (or linkAfterMatch)",
      count(r =>
        ["same", "better"].includes(eff(r, "call_form")?.verdict ?? ""),
      ),
    ],
    [
      "to-dos: ours + theirs = the stored action items not completed",
      count(
        r =>
          r.planned &&
          r.todos.assignees !== null &&
          r.todos.ours + r.todos.theirs === openOf(r.todos.assignees),
      ),
    ],
    [
      "every to-do comment difference explained",
      count(
        r =>
          eff(r, "todo_comment")?.verdict !== "differs" ||
          eff(r, "todo_comment")?.explained === true,
      ),
    ],
  ];
  return checks.map(([check, n]) => ({
    check,
    count: n,
    of,
    pass: of > 0 && n === of,
  }));
}

export function reportOf(
  mode: Report["mode"],
  responses: ResponseReport[],
  passes: Pass[],
  now = new Date(),
): Report {
  return {
    report: "checkin-replay",
    mode,
    contract: "docs/forms/STAGE2-CONTRACT.md 7.4",
    ranAt: now.toISOString(),
    responses,
    passes,
    pass: passes.every(p => p.pass),
  };
}

const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "/");
/** " Fathom assigned the n open action items: ..." for the report, or nothing when unknown. */
function assigneeLine(a: Assignees | null | undefined): string {
  if (!a) return "";
  const parts = (
    [
      [a.recorder, "to the recorder"],
      [a.staff, "to other staff"],
      [a.clientEmail, "to a client address"],
      [a.nameOnly, "to a name off the staff list"],
      [a.none, "to no one"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, to]) => `${n} ${to}`);
  const open = openOf(a);
  return ` Fathom assigned ${plural(open, "open action item")}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}
export function reportMarkdown(r: Report): string {
  const lines = [
    `# 1-1 notes shadow replay (${r.mode})`,
    "",
    `Ran at ${r.ranAt} (docs/forms/STAGE2-CONTRACT.md 7.4). Shapes, targets and values only: no comment text, no answer text, no contact name.`,
    "",
  ];
  if (r.passes.length) {
    lines.push("| Check | Count | Pass |", "| --- | --- | --- |");
    for (const p of r.passes)
      lines.push(
        `| ${cell(p.check)} | ${p.count} of ${p.of} | ${p.pass ? "yes" : "no"} |`,
      );
    lines.push("", `Overall: ${r.pass ? "pass" : "not yet"}.`, "");
  }
  for (const x of r.responses) {
    lines.push(
      `## ${x.response} · ${cell(x.client)} · card ${x.card}`,
      "",
      `Recording ${x.recording ?? "none"}. ${x.planned ? "Planned." : `Not planned: ${cell(x.reason)}`}`,
      "",
      `To-dos: ${x.todos.items} planned (${x.todos.ours} ours, ${x.todos.theirs} theirs, ${x.todos.unsure} unsure${x.todos.cut ? `, ${x.todos.cut} over 30 left out` : ""}); Make's comment had ${x.todos.makeBulletLines ?? "no"} bullet lines (${plural(x.todos.makeComments, "comment")}).${assigneeLine(x.todos.assignees)}`,
      "",
      "| Effect | Plan | Verdict | Why |",
      "| --- | --- | --- | --- |",
      `| pick | ${cell(x.pick.state ?? "none")} | ${x.pick.verdict} | ${cell(x.pick.reason)} |`,
    );
    for (const e of x.effects)
      lines.push(
        `| ${e.effect} | ${cell(e.state ?? "none")} | ${e.verdict} | ${cell(e.reason)} |`,
      );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function writeReport(out: string, r: Report): string[] {
  mkdirSync(out, { recursive: true });
  const stem = r.mode === "live" ? "replay-report" : "shadow-report";
  const files = [join(out, `${stem}.json`), join(out, `${stem}.md`)];
  writeFileSync(files[0], `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(files[1], reportMarkdown(r));
  return files;
}

// ---------------------------------------------------------------------------
// --live

export async function runLive(opts: {
  entries: Entry[];
  read: Reader;
  now?: Date;
}): Promise<Report> {
  const s = await readLive(opts.read, opts.entries);
  const db = await replayDb();
  try {
    // The staff roles come from the real role_of in PGlite, and the picks
    // need them; each pick's signal is then the call's why.
    const staff = await loadStore(db, s, opts.entries);
    const picks = new Map(
      opts.entries.map(e => [e.token, pickAsOf(s, e, staff)] as const),
    );
    const planned = await planEntries(db, s, opts.entries, picks, staff);
    const calls: CardCalls = new Map();
    for (const b of s.calls) calls.set(Number(b.id), b);
    for (const m of s.meetings)
      if (m.call_id != null)
        calls.set(Number(m.call_id), {
          id: m.call_id,
          source: "fathom",
          task_id: m.task_id,
          status: m.call_status,
          linked_call_id: m.linked_call_id,
        });
    const responses = opts.entries.map((e): ResponseReport => {
      const p = planned.get(e.token);
      const form = s.forms.find(f => f.token === e.token);
      const meeting = s.meetings.find(
        m => String(m.recording_id) === e.recording,
      );
      const comment = p?.plans?.find(x => x.effect === "todo_comment")?.plan
        ?.comment_text;
      return {
        response: e.prefix,
        card: e.card,
        client: e.client,
        recording: e.recording,
        planned: Boolean(p?.plans),
        reason: p?.reason ?? null,
        pick: judgePick(
          picks.get(e.token) ?? {
            recording: null,
            signal: null,
            label: null,
            method: null,
            inStore: false,
          },
          e.recording,
        ),
        todos: {
          ...(p?.todos ?? {
            items: 0,
            ours: 0,
            theirs: 0,
            unsure: 0,
            cut: 0,
            assignees: null,
          }),
          makeBulletLines: e.make.comments[0]?.bulletLines ?? null,
          makeComments: e.make.comments.length,
        },
        effects: judge(p?.plans ?? null, {
          card: e.card,
          makeComments: e.make.comments,
          makeHappiness: e.make.happinessOption,
          makeLastPocDay: londonDay(e.make.lastPocStored),
          makeGradeParts: e.make.gradeParts,
          makeRecapSends: e.make.recapSends,
          cardLastCheckinDay: londonDay(e.cardLastCheckinCall),
          typeform: form
            ? {
                defcon: form.defcon ?? null,
                priority: form.priority ?? null,
                recordingUrl: form.recording_url ?? null,
                linkedSource: form.linked_source ?? null,
              }
            : null,
          meetingUrl: meeting?.url ?? null,
          storedActionItems: meeting?.action_items
            ? arr(meeting.action_items).length
            : null,
          todoAssignees: p?.todos.assignees ?? null,
          calls,
          nativeLinkFirst:
            typeof comment === "string"
              ? comment.split("\n")[0].startsWith("Call recording: https://")
              : null,
        }),
      };
    });
    return reportOf("live", responses, passesOf(responses), opts.now);
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// --shadow: real shadow runs against what Make wrote for the same calls.

/**
 * The VPS GET route: runs on the VPS with the keys of /opt/data/bibi/api-keys.env
 * (by name), makes GET calls only and prints one JSON line per card with
 * shapes only: the Make comment's line counts, sides and whether the recording
 * link is on line 1; the Client Happiness option and the Last POC and Last
 * Check-in Call days; the grade's part count in #client-call-feedback. Never a
 * key, a comment or a message text.
 */
export const VPS_SCRIPT = String.raw`
import base64, json, os, re, sys, urllib.error, urllib.request
from datetime import datetime, timezone
try:
    from zoneinfo import ZoneInfo
    LONDON = ZoneInfo("Europe/London")
except Exception:
    LONDON = None

REQ = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
CLICKUP = os.environ.get(REQ.get("clickupKey") or "CLICKUP_API_KEY", "").strip()
SLACK = os.environ.get(REQ.get("slackKey") or "SLACK_BOT_TOKEN", "").strip()
HAPPINESS = "4e3924e3-4898-4e98-aca1-cc1ac3015b73"
LAST_POC = "e183f2ce-8b7a-491a-b160-2287a247758b"
LAST_CHECKIN = "032203ad-e327-4d76-a0ce-c07496da6486"
MAKE_BOT = "B0925UM8VUN"
GRADES = "C09SVG6FHGU"


def get(url, headers):
    req = urllib.request.Request(url, headers=dict(headers, **{"User-Agent": "mahara-replay/1"}), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return None, None


def day(value):
    try:
        t = datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    except Exception:
        return None
    return (t.astimezone(LONDON) if LONDON else t).date().isoformat()


def shape(text):
    lines = [l.strip() for l in str(text or "").split("\n") if l.strip()]
    first = lines[0] if lines else ""
    return {
        "lines": len(lines),
        "bulletLines": len([l for l in lines if re.match(r"^([-*•]|\d+[.)])\s+", l)]),
        "linkFirst": bool(re.search(r"https?://(www\.)?fathom\.video/", first, re.I)),
        "ours": any(re.search(r"mahara|our team|\bwe\b|\bus\b", l, re.I) for l in lines),
        "theirs": any(re.search(r"client", l, re.I) for l in lines),
    }


def task(card):
    status, t = get("https://api.clickup.com/api/v2/task/%s" % card, {"Authorization": CLICKUP})
    out = {"status": status}
    for f in (t or {}).get("custom_fields") or []:
        v = f.get("value")
        if f.get("id") == HAPPINESS:
            out["happinessOption"] = None
            for o in (f.get("type_config") or {}).get("options") or []:
                if v is not None and (o.get("id") == v or str(o.get("orderindex")) == str(v)):
                    out["happinessOption"] = o.get("id")
        elif f.get("id") == LAST_POC:
            out["lastPocDay"] = day(v) if v else None
        elif f.get("id") == LAST_CHECKIN:
            out["lastCheckinDay"] = day(v) if v else None
    return out


def comments(card, after):
    found, status, start = [], None, None
    for _ in range(8):
        url = "https://api.clickup.com/api/v2/task/%s/comment" % card
        if start:
            url += "?start=%s&start_id=%s" % start
        status, c = get(url, {"Authorization": CLICKUP})
        page = (c or {}).get("comments") or []
        if not page:
            break
        for x in page:
            at = int(x.get("date") or 0)
            if after * 1000 <= at <= (after + 300) * 1000:
                found.append(x)
        oldest = page[-1]
        if int(oldest.get("date") or 0) < after * 1000:
            break
        start = (oldest.get("date"), oldest.get("id"))
    found.sort(key=lambda x: int(x.get("date") or 0))
    out = {"status": status, "found": len(found), "shapes": [shape(x.get("comment_text")) for x in found]}
    return out


def grade(after):
    if not SLACK:
        return {"error": "no_key"}
    url = "https://slack.com/api/conversations.history?channel=%s&oldest=%d&latest=%d&limit=100&inclusive=true" % (GRADES, after, after + 900)
    status, h = get(url, {"Authorization": "Bearer " + SLACK})
    if not h:
        return {"status": status, "error": "unreadable"}
    if not h.get("ok"):
        return {"status": status, "error": re.sub(r"[^a-z_]", "", str(h.get("error") or "refused"))[:40]}
    parts = [m for m in h.get("messages") or [] if m.get("bot_id") == MAKE_BOT]
    return {"status": status, "parts": len(parts)}


if not CLICKUP:
    print(json.dumps({"error": "The ClickUp key is not set on the VPS."}))
    sys.exit(1)
for item in REQ.get("cards") or []:
    card, after = str(item.get("card")), int(item.get("after"))
    if not re.match(r"^[A-Za-z0-9_-]{1,40}$", card):
        continue
    print(json.dumps({"card": card, "after": after, "task": task(card), "comment": comments(card, after), "grade": grade(after)}))
`;

export type MakeRead = {
  card: string;
  after: number;
  task?: {
    status?: number | null;
    happinessOption?: string | null;
    lastPocDay?: string | null;
    lastCheckinDay?: string | null;
  };
  comment?: {
    status?: number | null;
    found?: number | null;
    shapes?: {
      lines: number;
      bulletLines: number;
      linkFirst: boolean;
      ours: boolean;
      theirs: boolean;
    }[];
  };
  grade?: { status?: number | null; parts?: number; error?: string };
};
export type MakeReader = (
  cards: { card: string; after: number }[],
) => Promise<MakeRead[]>;

/** The VPS GET route over ssh: one connection for every card, the script on stdin. */
export function vpsReader(
  opts: {
    host?: string;
    clickupKey?: string;
    slackKey?: string;
    run?: typeof spawnSync;
  } = {},
): MakeReader {
  const run = opts.run ?? spawnSync;
  return async cards => {
    const req = Buffer.from(
      JSON.stringify({
        cards,
        clickupKey: opts.clickupKey ?? "CLICKUP_API_KEY",
        slackKey: opts.slackKey ?? "SLACK_BOT_TOKEN",
      }),
    ).toString("base64");
    const out = run(
      "ssh",
      [
        "-o",
        "ControlMaster=auto",
        "-o",
        `ControlPath=${join(homedir(), ".ssh/cm-%r@%h-%p")}`,
        "-o",
        "ControlPersist=20m",
        "-o",
        "ConnectTimeout=20",
        opts.host ?? VPS,
        `set -a; . /opt/data/bibi/api-keys.env; set +a; python3 - ${req}`,
      ],
      { input: VPS_SCRIPT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (out.status !== 0)
      throw new Error(
        `The VPS GET route failed (exit ${out.status}): ${String(out.stdout || out.stderr || "").slice(0, 200)}`,
      );
    return String(out.stdout)
      .split("\n")
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  };
}

/** The shadow runs' plans and the Typeform rows of the same cards (read only). */
export async function readShadow(read: Reader, ids: string[]) {
  const wanted = list(ids, UUID);
  const runs = await read(`-- replay:shadow
SELECT r.id::text AS id, r.task_id, r.client_name, r.mode, r.state, ${iso("r.submitted_at")} AS submitted_at,
       r.answers->'call'->>'kind' AS call_kind, r.answers->'call'->>'recordingId' AS recording_id,
       r.answers->'call'->>'shareUrl' AS share_url, r.answers->'call'->>'why' AS why,
       r.answers->'call'->>'startsAt' AS call_starts_at, r.answers->>'defcon' AS defcon, r.answers->>'priority' AS priority,
       coalesce((SELECT jsonb_agg(jsonb_build_object('effect', e.effect_key, 'state', e.state, 'owner', e.owner,
           'reason', e.reason,
           'plan', CASE e.effect_key
             WHEN 'todo_comment' THEN (e.plan - 'comment_text') || jsonb_build_object('linkFirst',
               coalesce(split_part(e.plan->>'comment_text', E'\\n', 1) LIKE 'Call recording: https://%', false))
             WHEN 'call_form' THEN (e.plan - 'row') || jsonb_build_object('row', ((e.plan->'row') - 'answers')
               || jsonb_build_object('answers', coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(e.plan->'row'->'answers') x
                                                           WHERE x->>'ref' IN ('${REF.defcon}', '${REF.priority}')), '[]'::jsonb)),
               'linkRow', (SELECT jsonb_build_object('id', c.id, 'source', c.source, 'task_id', c.task_id, 'status', c.status,
                                                     'linked_call_id', c.linked_call_id, 'parent_task_id', p.task_id,
                                                     'parent_status', p.status)
                             FROM public.cockpit_csm_calls c LEFT JOIN public.cockpit_csm_calls p ON p.id = c.linked_call_id
                            WHERE c.id = CASE WHEN (e.plan->'row'->>'linked_call_id') ~ '^[0-9]{1,18}$'
                                              THEN (e.plan->'row'->>'linked_call_id')::bigint END))
             ELSE e.plan END) ORDER BY e.created_at, e.effect_key)
          FROM public.cockpit_form_effects e WHERE e.response_id = r.id), '[]'::jsonb) AS effects
  FROM public.cockpit_form_responses r
 WHERE r.form_key = 'checkin' AND r.id IN (${wanted})`);
  const cards = [
    ...new Set(runs.map(r => String(r.task_id)).filter(c => CARD.test(c))),
  ];
  const since = runs
    .map(r => ms(r.call_starts_at) ?? ms(r.submitted_at))
    .filter((t): t is number => t !== null);
  const forms = cards.length
    ? await read(`-- replay:shadow_forms
SELECT f.token, f.task_id, ${iso("f.submitted_at")} AS submitted_at, f.recording_url, f.linked_call_id,
       ${answerSql(REF.defcon)} AS defcon, ${answerSql(REF.priority)} AS priority
  FROM public.cockpit_csm_call_forms f
 WHERE f.form_id = 'fRokTITH' AND f.task_id IN (${list(cards, CARD)})
   AND f.submitted_at >= ${lit(stamp(Math.min(...since) - DAY), STAMP)}`)
    : [];
  const { meetings, staff } = await readRecordings(
    read,
    runs.map(r => String(r.recording_id ?? "")),
  );
  return { runs, forms, meetings, staff };
}

/**
 * The shadow runs' recordings as --live reads its pinned ones (read only): the
 * recorder's address through maskSql and the action items through
 * actionItemsSql, so no contact's name or address and no item text leaves the
 * database; and the active staff names that assigneesOf tells staff by. Ids that
 * are not recording ids are left out; with none, nothing is read.
 */
export async function readRecordings(
  read: Reader,
  ids: string[],
): Promise<{ meetings: Row[]; staff: Staff[] }> {
  const wanted = [...new Set(ids.filter(id => DIGITS.test(id)))];
  if (!wanted.length) return { meetings: [], staff: [] };
  const meetings = await read(`-- replay:shadow_meetings
SELECT m.recording_id, ${maskSql("m.recorded_by_email")} AS recorder_email, ${actionItemsSql("m")} AS action_items
  FROM public.cockpit_fathom_meetings m
 WHERE m.recording_id IN (${list(wanted, DIGITS)})`);
  const staff = await read(`-- replay:shadow_staff
SELECT btrim(p.name) AS name FROM public.cockpit_people p
 WHERE p.active AND nullif(btrim(p.name), '') IS NOT NULL ORDER BY p.id`);
  return {
    meetings,
    staff: staff.map(p => ({ name: String(p.name), email: null, role: null })),
  };
}

/** The Typeform row for the shadow run's call: its link, else the first one sent after the call began. */
function typeformFor(run: Row, forms: Row[]): Row | null {
  const mine = forms
    .filter(f => f.task_id === run.task_id)
    .sort((a, b) => (ms(a.submitted_at) ?? 0) - (ms(b.submitted_at) ?? 0));
  const share = linkKey(run.share_url);
  const byLink = share
    ? mine.find(f => linkKey(f.recording_url) === share)
    : undefined;
  if (byLink) return byLink;
  const began = ms(run.call_starts_at) ?? ms(run.submitted_at) ?? 0;
  return (
    mine.find(f => {
      const t = ms(f.submitted_at) ?? 0;
      return t >= began && t <= began + 3 * DAY;
    }) ?? null
  );
}

export async function runShadow(opts: {
  ids: string[];
  read: Reader;
  make: MakeReader;
  now?: Date;
}): Promise<Report> {
  const { runs, forms, meetings, staff } = await readShadow(
    opts.read,
    opts.ids,
  );
  const pairs = runs.map(r => ({ run: r, form: typeformFor(r, forms) }));
  const asks = pairs
    .filter(p => p.form)
    .map(p => ({
      card: String(p.run.task_id),
      after: Math.floor((ms(p.form?.submitted_at) ?? 0) / 1000),
    }));
  const reads = asks.length ? await opts.make(asks) : [];
  const responses: ResponseReport[] = opts.ids.map(id => {
    const pair = pairs.find(p => p.run.id === id);
    const run = pair?.run;
    if (run?.mode !== "shadow" || run.state !== "submitted")
      return {
        response: id.slice(0, 8),
        card: String(run?.task_id ?? ""),
        client: String(run?.client_name ?? ""),
        recording: run?.recording_id ?? null,
        planned: false,
        reason: run
          ? "Not a submitted shadow run."
          : "No such response in the cockpit.",
        pick: {
          effect: "pick",
          state: null,
          verdict: "missing",
          reason: "No shadow run to compare.",
        },
        todos: {
          items: 0,
          ours: 0,
          theirs: 0,
          unsure: 0,
          cut: 0,
          assignees: null,
          makeBulletLines: null,
          makeComments: 0,
        },
        effects: judge(null, emptyCompare()),
      };
    const form = pair?.form ?? null;
    const after = form ? Math.floor((ms(form.submitted_at) ?? 0) / 1000) : null;
    const make = reads.find(m => m.card === run.task_id && m.after === after);
    const plans = arr(run.effects);
    const calls: CardCalls = new Map();
    const link = plans.find(p => p.effect === "call_form")?.plan?.linkRow;
    if (link) {
      calls.set(Number(link.id), {
        id: link.id,
        source: link.source,
        task_id: link.task_id,
        status: link.status,
        linked_call_id: link.linked_call_id,
      });
      if (link.linked_call_id != null)
        calls.set(Number(link.linked_call_id), {
          id: link.linked_call_id,
          task_id: link.parent_task_id,
          status: link.parent_status,
        });
    }
    const todo = plans.find(p => p.effect === "todo_comment")?.plan ?? {};
    // Whom Fathom assigned the run's recording's open action items to, as --live
    // counts them, for the report's count line. No stored recording: unknown.
    const meeting = meetings.find(
      m => String(m.recording_id) === String(run.recording_id ?? ""),
    );
    const stored = meeting
      ? actionItems({ action_items: arr(meeting.action_items) })
      : null;
    const assignees = stored
      ? assigneesOf(stored, meeting?.recorder_email, staff)
      : null;
    // A shadow run's plan is the CSM's own list, not Fathom's. The recorder and
    // GPT sentences (2b 4.13) say the plan is Fathom's open items, so they
    // explain a to-do comment difference only while the plan still holds
    // exactly what todoItems makes of those items, side by side; a list the
    // CSM edited stays an unexplained difference for a person to read.
    const fromFathom = stored
      ? todoItems(stored, { shareUrl: null, staff })
      : [];
    const planOurs = Number(todo.sides?.ours ?? 0);
    const planTheirs = Number(todo.sides?.theirs ?? 0);
    const asFathom =
      assignees !== null &&
      Number(todo.items ?? 0) === planOurs + planTheirs &&
      planOurs + planTheirs === openOf(assignees) &&
      planOurs === fromFathom.filter(i => i.side === "we").length &&
      planTheirs === fromFathom.filter(i => i.side === "they").length;
    const shapes = make?.comment?.shapes ?? null;
    const comments =
      shapes?.map(s => ({
        lines: s.lines,
        bulletLines: s.bulletLines,
        linkFirst: s.linkFirst,
      })) ?? null;
    const tfShare = linkKey(form?.recording_url);
    const runShare = linkKey(run.share_url);
    const pick: Judged = !form
      ? {
          effect: "pick",
          state: run.why ?? null,
          verdict: "missing",
          reason: "No Typeform row for this call yet.",
        }
      : tfShare && runShare
        ? {
            effect: "pick",
            state: run.why ?? null,
            verdict: tfShare === runShare ? "same" : "differs",
            reason:
              tfShare === runShare
                ? "The shadow run's recording is the one the Typeform row links."
                : "The Typeform row links another recording.",
          }
        : {
            effect: "pick",
            state: run.why ?? null,
            verdict: "missing",
            reason: runShare
              ? "The Typeform row has no recording link to compare."
              : "The shadow run has no recording.",
          };
    const effects = judge(plans, {
      card: String(run.task_id),
      makeComments: comments,
      makeHappiness: make?.task?.happinessOption ?? null,
      makeLastPocDay: make?.task?.lastPocDay ?? null,
      makeGradeParts: make?.grade?.parts ?? null,
      makeGradeError: make?.grade?.error ?? null,
      makeRecapSends: null,
      cardLastCheckinDay: make?.task?.lastCheckinDay ?? null,
      typeform: form
        ? {
            defcon: form.defcon ?? null,
            priority: form.priority ?? null,
            recordingUrl: form.recording_url ?? null,
            linkedSource: null,
          }
        : null,
      meetingUrl: null,
      storedActionItems: meeting?.action_items
        ? arr(meeting.action_items).length
        : null,
      todoAssignees: asFathom ? assignees : null,
      calls,
      nativeLinkFirst:
        typeof todo.linkFirst === "boolean" ? todo.linkFirst : null,
    }).map(j =>
      form
        ? j
        : [
              "call_form",
              "todo_comment",
              "happiness",
              "last_poc",
              "grade_notice",
            ].includes(j.effect)
          ? {
              ...j,
              verdict: "missing" as const,
              reason:
                "No Typeform row for this call yet, so Make's writes cannot be read.",
            }
          : j,
    );
    return {
      response: id.slice(0, 8),
      card: String(run.task_id),
      client: String(run.client_name ?? ""),
      recording: run.recording_id ?? null,
      planned: true,
      reason: null,
      pick,
      todos: {
        items: Number(todo.items ?? 0),
        ours: Number(todo.sides?.ours ?? 0),
        theirs: Number(todo.sides?.theirs ?? 0),
        unsure: 0,
        cut: 0,
        assignees,
        makeBulletLines: comments?.[0]?.bulletLines ?? null,
        makeComments: comments?.length ?? 0,
      },
      effects,
    };
  });
  return reportOf("shadow", responses, [], opts.now);
}

function emptyCompare(): Compare {
  return {
    card: "",
    makeComments: null,
    makeHappiness: null,
    makeLastPocDay: null,
    makeGradeParts: null,
    makeRecapSends: null,
    cardLastCheckinDay: null,
    typeform: null,
    meetingUrl: null,
    storedActionItems: null,
    calls: new Map(),
    nativeLinkFirst: null,
  };
}

// ---------------------------------------------------------------------------
// The command line.

export type Args = {
  mode: "live" | "shadow";
  fixture: string | null;
  picks: string;
  out: string;
  ids: string[];
  host: string;
  clickupKey: string;
  slackKey: string;
};

const here = dirname(fileURLToPath(import.meta.url));
export const PICKS = join(here, "fixtures/checkin-replay-picks.json");

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    mode: "live",
    fixture: null,
    picks: PICKS,
    out: "",
    ids: [],
    host: VPS,
    clickupKey: "CLICKUP_API_KEY",
    slackKey: "SLACK_BOT_TOKEN",
  };
  let mode: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
      return v;
    };
    if (flag === "--live") mode = "live";
    else if (flag === "--shadow") {
      mode = "shadow";
      a.ids = value()
        .split(/[\s,]+/)
        .filter(Boolean);
    } else if (flag === "--fixture") a.fixture = value();
    else if (flag === "--picks") a.picks = value();
    else if (flag === "--out") a.out = value();
    else if (flag === "--host") a.host = value();
    else if (flag === "--clickup-key") a.clickupKey = value();
    else if (flag === "--slack-key") a.slackKey = value();
    else throw new Error(`Unknown option ${flag}.`);
  }
  if (!mode) throw new Error("Say --live or --shadow <response ids>.");
  a.mode = mode as Args["mode"];
  if (!a.out) throw new Error("--out names the folder for the report.");
  if (a.mode === "live" && !a.fixture)
    throw new Error("--live needs --fixture <replay-10.json>.");
  if (a.mode === "shadow") {
    if (!a.ids.length) throw new Error("--shadow needs the response ids.");
    if (a.ids.some(id => !UUID.test(id)))
      throw new Error("Each shadow response id is a uuid.");
  }
  return a;
}

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const read = sqReader();
  const report =
    a.mode === "live"
      ? await runLive({
          entries: loadEntries(
            JSON.parse(readFileSync(String(a.fixture), "utf8")),
            JSON.parse(readFileSync(a.picks, "utf8")),
          ),
          read,
        })
      : await runShadow({
          ids: a.ids,
          read,
          make: vpsReader({
            host: a.host,
            clickupKey: a.clickupKey,
            slackKey: a.slackKey,
          }),
        });
  const files = writeReport(a.out, report);
  const verdicts = report.responses.flatMap(r => [r.pick, ...r.effects]);
  const differs = verdicts.filter(v => v.verdict === "differs").length;
  const missing = verdicts.filter(v => v.verdict === "missing").length;
  console.log(
    `${report.mode} replay: ${plural(report.responses.length, "response")}, ${differs} differs, ${missing} missing${report.passes.length ? `, passes ${report.pass ? "hold" : "do not hold yet"}` : ""}. Report: ${files.join(", ")}`,
  );
  return report.mode === "live"
    ? report.pass
      ? 0
      : 1
    : differs + missing
      ? 1
      : 0;
}

if (import.meta.main)
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    error => {
      console.error(String((error as Error).message ?? error));
      process.exit(2);
    },
  );
