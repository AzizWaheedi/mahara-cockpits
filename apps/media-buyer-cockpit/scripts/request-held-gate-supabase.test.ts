/**
 * Every seat may save a request the writer cannot send now, and it is held
 * (supabase/migrations/20261029p_requests_held_for_every_seat.sql,
 * docs/requests/CLICKUP-DOWNGRADE.md section 4.2), on an isolated PostgreSQL
 * with Supabase's default privileges on, so a missing REVOKE opens the
 * function here as it would in production.
 *
 * It stands on 20261026r_requests.sql and its seed 20261026s as
 * requests-supabase.test.ts sets them up (the same canonical definitions, cut
 * from their migrations). The body 20261029p replaces is kept beside the new
 * one as cockpit_request_send_gate_before() (cut from 20261026r and renamed),
 * so the two answers can be compared in every mode. The CEO is read through
 * the gate's own seat flag (isCeo), so no real address is needed. Every seat,
 * client and card is invented. Nothing here reaches ClickUp: a write is a
 * queue row, and the writer's claim is called as the service role.
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

setDefaultTimeout(120_000);

const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const P = "20261029p_requests_held_for_every_seat.sql";
const WB = "20261009f_clickup_writeback_native.sql";

/** cockpit_request_send_gate(jsonb,text)'s prosrc md5, read live (read only) on 2026-10-29. */
const LIVE_MD5 = "945810c7e12cda1635830359a3793d7e";
const GATE = "public.cockpit_request_send_gate(jsonb,text)";

// Seats.
const SM = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm, every client
const CALL = "00000000-0000-4000-8000-0000000000b1"; // call centre, Acme Interiors only
const SALES = "00000000-0000-4000-8000-0000000000b2"; // sales
const VIDEO = "00000000-0000-4000-8000-0000000000f2"; // video editor, given the editor right by a row
const PLAIN = "00000000-0000-4000-8000-0000000000f3"; // video editor, no right
const PLAIN_SEATS = [CSM, CALL, SALES, PLAIN];
const EDITOR_SEATS = [SM, VIDEO];

// Client cards.
const ACME = "taskacme1";
const BETA = "taskbeta1";
const TEST_CARD = "86eywg1cq";

// The gate's notes, word for word (CLICKUP-DOWNGRADE.md 4.2).
const TESTING =
  "Requests are being tested on the internal test card only, where they go to ClickUp at once. Anything else you send is saved and goes to ClickUp by itself once they open to everyone.";
const NOT_OPEN =
  "Requests are not open yet. What you send is saved and goes to ClickUp by itself once they are.";
const QUIET_EDITOR =
  "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself once it runs with requests open. Check it on the Machine tab.";
const QUIET_TEAM =
  "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself when the writer is back.";
// cockpit_request_row's held notes (20261026r), already true for every seat.
const ROW_SILENT =
  "Saved, not sent yet: the requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again.";
const ROW_NOT_OPEN =
  "Saved, not sent yet. It goes to ClickUp once requests open.";

let db: PGlite;
type Row = Record<string, any>;
let seq = 0;
const uid = () => `20000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await asOwner();
  return (await db.query<T>(text, params)).rows;
}
async function one<T = any>(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
/** Applies a file as the deploy does; a refusal rolls its transaction back. */
async function apply(file: string): Promise<string | null> {
  await asOwner();
  try {
    await db.exec(migration(file));
    return null;
  } catch (e) {
    await db.exec("ROLLBACK");
    return (e as Error).message;
  }
}

/** The requests writer reports its mode, as each run of job requests does. */
const mode = (m: "dry_run" | "apply" | "apply_limited", cards: string[] = []) =>
  svc(
    "SELECT public.cockpit_clickup_requests_state(true,'test',$1,$2::text[],'{}'::jsonb) r",
    [m, cards],
  );
/** The writer's last report is 16 minutes old: the mode reads unknown. */
const quiet = () =>
  q(
    "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail,'{at}',to_jsonb(now() - interval '16 minutes')) WHERE key='clickup-writeback:requests'",
  );
const neverReported = () =>
  q(
    "DELETE FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests'",
  );
const writerMode = async () =>
  (await q<{ r: Row }>("SELECT public.cockpit_clickup_requests_mode() r"))[0].r;

/** The gate (new body) and the body it replaces, for one seat flag set and card. */
const gates = async (seat: Row, card: string | null) =>
  (
    await q<{ n: Row; o: Row }>(
      "SELECT public.cockpit_request_send_gate($1::jsonb,$2) n, public.cockpit_request_send_gate_before($1::jsonb,$2) o",
      [JSON.stringify(seat), card],
    )
  )[0];
/** The writer block a seat's form reads ({mode, canSend, held, note}). */
const writer = async (who: string) =>
  (await one<Row>(who, "SELECT public.cockpit_request_types_read() r")).writer;

type Submit = {
  id?: string;
  type: string;
  client?: string | null;
  answers?: Row;
};
const submit = (who: string, s: Submit) =>
  one<Row>(
    who,
    "SELECT public.cockpit_request_submit($1::uuid,$2,$3,$4::jsonb,$5::date,$6,$7,$8) r",
    [
      s.id ?? uid(),
      s.type,
      s.client ?? null,
      JSON.stringify(s.answers ?? {}),
      null,
      null,
      "requests_page",
      null,
    ],
  );
const get = (who: string, id: string) =>
  one<Row>(who, "SELECT public.cockpit_request_get($1) r", [id]);
const request = async (id: string) =>
  (await q("SELECT * FROM public.cockpit_requests WHERE id=$1", [id]))[0];
const parts = (id: string) =>
  q(
    "SELECT * FROM public.cockpit_request_parts WHERE request_id=$1 ORDER BY part",
    [id],
  );
const queueRows = (id: string) =>
  q(
    "SELECT * FROM public.cockpit_clickup_writeback_queue WHERE source_id=$1 ORDER BY dedupe_key",
    [id],
  );
const heldNow = async (id: string) =>
  (
    await q<{ h: boolean }>(
      "SELECT public.cockpit_request_held(r) h FROM public.cockpit_requests r WHERE r.id=$1",
      [id],
    )
  )[0].h;
const claim = (token: string) =>
  svc<Row[]>(
    "SELECT public.cockpit_clickup_writeback_claim_requests($1::uuid, 10) r",
    [token],
  );

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const BODY =
  /CREATE OR REPLACE FUNCTION public\.cockpit_request_send_gate\(p_seat jsonb, p_client_task text\)([\s\S]*?)AS \$\$([\s\S]*?)\$\$;/;
const DEF =
  /CREATE OR REPLACE FUNCTION public\.cockpit_request_send_gate\(p_seat jsonb, p_client_task text\)[\s\S]*?END \$\$;/;
function definitionOf(file: string) {
  const hit = migration(file).match(BODY);
  if (!hit) throw new Error(`No cockpit_request_send_gate in ${file}`);
  return { head: hit[1], body: hit[2] };
}
const GUARD = migration(P).match(
  /NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/,
);

/** Everything pg_proc says about the function. */
const facts = async () =>
  (
    await q(
      `SELECT md5(p.prosrc) md5, p.prosecdef, p.proconfig, p.provolatile, l.lanname, p.prorettype::regtype::text rettype,
              p.proretset, p.prokind, p.proparallel, p.proisstrict, p.proleakproof, p.procost::float8 cost,
              pg_get_userbyid(p.proowner) owner, p.proacl::text acl, pg_get_function_identity_arguments(p.oid) args
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = '${GATE}'::regprocedure`,
    )
  )[0];
const can = async (role: string) =>
  (
    await q<{ ok: boolean }>(
      `SELECT has_function_privilege($1,'${GATE}','EXECUTE') ok`,
      [role],
    )
  )[0].ok;

let before: Row;
let afterOnce: Row;
let afterTwice: Row;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The sync state (with its detail column), the people list (with schedules),
  // the onboarding mirror and the Blueprint settings, as requests-supabase.test.ts.
  await db.exec(
    cut(
      migration("20260921e_tap_charges.sql"),
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "cockpit_sync_state",
    ),
  );
  await db.exec(
    cut(
      migration("20261011c_csm_call_store.sql"),
      /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/,
      "detail",
    ),
  );
  await db.exec(
    cut(
      migration("20260919b_people.sql"),
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "cockpit_people",
    ),
  );
  await db.exec(
    cut(
      migration("20260921b_people_schedule.sql"),
      /alter table public\.cockpit_people\s+add column if not exists schedule jsonb;/,
      "schedule",
    ),
  );
  await db.exec(
    cut(
      migration("20261005a_client_onboarding.sql"),
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "cockpit_client_onboarding",
    ),
  );
  await db.exec(
    cut(
      migration("20261024a_brand_blueprints.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_blueprint_settings \([\s\S]*?\n\);/,
      "cockpit_blueprint_settings",
    ),
  );

  // The writeback queue as it is live.
  const wb = migration(WB);
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_config\([\s\S]*?\n\);/,
      "config",
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
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_runs_audit[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "runs trigger",
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
    await db.exec(cut(wb, pattern, what));
  await db.exec(
    cut(
      migration("20261009j_billing_clickup_writeback.sql"),
      /ALTER TABLE public\.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;\nALTER TABLE[\s\S]*?\)\);/,
      "billing kind",
    ),
  );
  // The two sources the live claim looks up (stand-ins: the id is all it reads).
  await db.exec(`
    CREATE TABLE public.cockpit_decisions (id bigint PRIMARY KEY);
    CREATE TABLE public.cockpit_media_native_records (id uuid PRIMARY KEY);
    REVOKE ALL ON public.cockpit_decisions, public.cockpit_media_native_records FROM anon, authenticated;`);
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_config ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue, public.cockpit_clickup_writeback_runs
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue,
      public.cockpit_clickup_writeback_runs TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_sync_state TO service_role;
    REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_audit(), public.cockpit_clickup_writeback_state(text,boolean,text,integer)
      FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) TO service_role;`);

  // The client gate, and the editor gate with its labels (Stage 1).
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/,
      "cockpit_is_team_only",
    ),
  );
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/,
      "cockpit_client_allowed",
    ),
  );
  const stage1 = migration("20261025n_slack_notices.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_forms_editors \([\s\S]*?\n\);/,
      "cockpit_forms_editors",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_role_of\(p_email text\)[\s\S]*?END \$\$;/,
      "role_of",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_seat_label\(p_email text, p_name text\)[\s\S]*?END \$\$;/,
      "seat_label",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_forms_editor_gate\(\)[\s\S]*?END \$\$;/,
      "editor gate",
    ],
  ] as const)
    await db.exec(cut(stage1, pattern, what));
  await db.exec(`
    ALTER TABLE public.cockpit_forms_editors ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_client_onboarding, public.cockpit_blueprint_settings,
      public.cockpit_forms_editors FROM anon, authenticated;
    REVOKE ALL ON FUNCTION public.cockpit_is_team_only(), public.cockpit_client_allowed(text), public.cockpit_slack_notice_role_of(text),
      public.cockpit_slack_notice_seat_label(text,text), public.cockpit_forms_editor_gate() FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;`);

  // Seats (invented).
  await member(db, SM, "sm@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CALL, "call@tests.invalid", ["call_center"]);
  await member(db, SALES, "sales@tests.invalid", ["sales"]);
  await member(db, VIDEO, "video@tests.invalid", ["editor"]);
  await member(db, PLAIN, "plain@tests.invalid", ["editor"]);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Acme Interiors"], CALL],
  );
  await db.query(
    "INSERT INTO public.cockpit_forms_editors(member_id, added_by) SELECT id, 'sm@tests.invalid' FROM public.cockpit_members WHERE auth_user_id=$1",
    [VIDEO],
  );

  // People, by role (invented).
  for (const [name, email, role] of [
    ["Sam Manager", "sm@tests.invalid", "Systems manager"],
    ["Nour Success", "csm@tests.invalid", "Client success manager"],
    ["Mo Video", "video@tests.invalid", "Video editor"],
    ["Rae Caller", "call@tests.invalid", "Call centre agent"],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );

  // Client cards (invented, but the internal test card's id is the canary's own).
  for (const [task, name, status, csm] of [
    [ACME, "Acme Interiors", "Active", "Nour Success"],
    [BETA, "Beta Build", "Active", null],
    [TEST_CARD, "Mahara Test Card", "Active", null],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, csm) VALUES($1,$2,$3,$4)",
      [task, name, status, csm],
    );

  // The requests build as it is live, and its send gate kept as it was.
  for (const file of [R, S]) expect(await apply(file)).toBeNull();
  await db.exec(
    cut(migration(R), DEF, "cockpit_request_send_gate").replace(
      "public.cockpit_request_send_gate(",
      "public.cockpit_request_send_gate_before(",
    ),
  );
  await db.exec(
    "REVOKE ALL ON FUNCTION public.cockpit_request_send_gate_before(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;",
  );
  before = await facts();

  // 20261029p, twice.
  expect(await apply(P)).toBeNull();
  afterOnce = await facts();
  expect(await apply(P)).toBeNull();
  afterTwice = await facts();
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe("20261029p on 20261026r and 20261026s", () => {
  test("applies twice: the guard takes the live body, then its own", () => {
    expect(GUARD).not.toBeNull();
    const [, oldMd5, newMd5] = GUARD as RegExpMatchArray;
    expect(oldMd5).toBe(LIVE_MD5);
    expect(md5(definitionOf(R).body)).toBe(LIVE_MD5);
    expect(before.md5).toBe(LIVE_MD5);
    expect(md5(definitionOf(P).body)).toBe(newMd5);
    expect(afterOnce.md5).toBe(newMd5);
    expect(afterTwice.md5).toBe(newMd5);
    // The header names both, for the deploy's check.
    const sql = migration(P);
    const header = sql.slice(0, sql.indexOf("BEGIN;"));
    expect(header).toContain(`prosrc md5 ${LIVE_MD5}`);
    expect(header).toContain(`${newMd5}), so a change made since`);
    expect(header).toContain(
      "SELECT md5(prosrc) FROM pg_catalog.pg_proc\n--    WHERE oid = 'public.cockpit_request_send_gate(jsonb,text)'::regprocedure;",
    );
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    // Only the send gate is defined; nothing else is created, dropped or granted.
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length).toBe(1);
    expect(sql).not.toMatch(
      /\bGRANT\b|\bDROP\b|\bALTER\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/,
    );
  });

  test("the signature, the settings and the grant are as live: nobody but the owner may call it", async () => {
    expect(definitionOf(P).head).toBe(definitionOf(R).head);
    const settings = (f: Row) =>
      Object.fromEntries(Object.entries(f).filter(([k]) => k !== "md5"));
    expect(settings(afterTwice)).toEqual(settings(before));
    expect(afterTwice).toMatchObject({
      prosecdef: true,
      proconfig: ['search_path=""'],
      provolatile: "s",
      lanname: "plpgsql",
      rettype: "jsonb",
      args: "p_seat jsonb, p_client_task text",
      acl: `{${before.owner}=X/${before.owner}}`,
    });
    for (const role of ["anon", "authenticated", "service_role"])
      expect(await can(role)).toBe(false);
  });
});

describe("every seat may file, by the writer's mode", () => {
  const PLAIN_FLAGS: Row = {};
  const PRIV_FLAGS: Row[] = [
    { isEditor: true },
    { isAdmin: true },
    { isCeo: true },
  ];
  const sends = { allowed: true, held: false, note: null };
  const held = (note: string) => ({ allowed: true, held: true, note });

  /** Every case: the writer's state, then the card, then what a plain seat and an editor get. */
  const CASES: Array<{
    name: string;
    set: () => Promise<unknown>;
    mode: string;
    card: string | null;
    plain: Row;
    priv: Row;
  }> = [
    {
      name: "apply",
      set: () => mode("apply"),
      mode: "apply",
      card: ACME,
      plain: sends,
      priv: sends,
    },
    {
      name: "apply_limited, on the test card",
      set: () => mode("apply_limited", [TEST_CARD]),
      mode: "apply_limited",
      card: TEST_CARD,
      plain: sends,
      priv: sends,
    },
    {
      name: "apply_limited, another card",
      set: () => mode("apply_limited", [TEST_CARD]),
      mode: "apply_limited",
      card: ACME,
      plain: held(TESTING),
      priv: held(TESTING),
    },
    {
      name: "apply_limited, no card",
      set: () => mode("apply_limited", [TEST_CARD]),
      mode: "apply_limited",
      card: null,
      plain: held(TESTING),
      priv: held(TESTING),
    },
    {
      name: "dry_run",
      set: () => mode("dry_run"),
      mode: "dry_run",
      card: ACME,
      plain: held(NOT_OPEN),
      priv: held(NOT_OPEN),
    },
    {
      name: "unknown, never reported",
      set: () => neverReported(),
      mode: "unknown",
      card: ACME,
      plain: held(NOT_OPEN),
      priv: held(QUIET_EDITOR),
    },
    {
      name: "unknown, last report apply",
      set: async () => {
        await mode("apply");
        await quiet();
      },
      mode: "unknown",
      card: ACME,
      plain: held(QUIET_TEAM),
      priv: held(QUIET_EDITOR),
    },
    {
      // The writer was sending this card when it went quiet, so the request
      // waits for the writer, as the row's held note says (writer_silent).
      name: "unknown, last report apply_limited, on the test card",
      set: async () => {
        await mode("apply_limited", [TEST_CARD]);
        await quiet();
      },
      mode: "unknown",
      card: TEST_CARD,
      plain: held(QUIET_TEAM),
      priv: held(QUIET_EDITOR),
    },
    {
      name: "unknown, last report apply_limited, another card",
      set: async () => {
        await mode("apply_limited", [TEST_CARD]);
        await quiet();
      },
      mode: "unknown",
      card: ACME,
      plain: held(TESTING),
      priv: held(QUIET_EDITOR),
    },
    {
      name: "unknown, last report apply_limited, no card",
      set: async () => {
        await mode("apply_limited", [TEST_CARD]);
        await quiet();
      },
      mode: "unknown",
      card: null,
      plain: held(TESTING),
      priv: held(QUIET_EDITOR),
    },
    {
      name: "unknown, last report dry_run",
      set: async () => {
        await mode("dry_run");
        await quiet();
      },
      mode: "unknown",
      card: null,
      plain: held(NOT_OPEN),
      priv: held(QUIET_EDITOR),
    },
  ];

  for (const c of CASES)
    test(`${c.name}: every seat is allowed, held and its note exactly as planned`, async () => {
      await c.set();
      expect((await writerMode()).mode).toBe(c.mode);
      const plain = await gates(PLAIN_FLAGS, c.card);
      expect(plain.n).toEqual(c.plain);
      for (const flags of PRIV_FLAGS) {
        const g = await gates(flags, c.card);
        expect(g.n).toEqual(c.priv);
        // An editor, an admin or the CEO was allowed and held before too; only the
        // note gains "by itself".
        expect({ allowed: g.o.allowed, held: g.o.held }).toEqual({
          allowed: g.n.allowed,
          held: g.n.held,
        });
        if (g.n.note) expect(g.o.note).toBe(g.n.note.replace(" by itself", ""));
      }
      // In apply nothing changed for a plain seat; in every other case the old
      // body refused it (even on the test card) and the new one lets it in.
      if (c.name === "apply") expect(plain.o).toEqual(plain.n);
      else expect(plain.o.allowed).toBe(false);
    });

  test("no note in any mode, for any seat, sends anyone to a ClickUp form", async () => {
    const notes = new Set<string>();
    for (const c of CASES) {
      await c.set();
      for (const flags of [PLAIN_FLAGS, ...PRIV_FLAGS])
        for (const card of [c.card, null, ACME, TEST_CARD]) {
          const g = (await gates(flags, card)).n;
          expect(g.allowed).toBe(true);
          if (g.note) notes.add(g.note);
        }
    }
    expect([...notes].sort()).toEqual(
      [TESTING, NOT_OPEN, QUIET_EDITOR, QUIET_TEAM].sort(),
    );
    for (const n of notes) {
      expect(n).not.toContain("ClickUp request form");
      expect(n).not.toMatch(/\bforms?\b/i);
    }
  });

  test("a quiet writer: the form's note and the list's held note say the same for every card", async () => {
    const silent = async (card: string | null) =>
      (
        await q<{ s: boolean }>(
          "SELECT public.cockpit_request_writer_silent($1) s",
          [card],
        )
      )[0].s;
    // Every way the writer can be quiet, every card: a plain seat is told the
    // writer is quiet exactly when the row will say so (cockpit_request_row
    // reads cockpit_request_writer_silent; NULL with no report reads as not
    // silent there and in the gate alike), and never "at once" then.
    const states: Array<[string, () => Promise<unknown>]> = [
      ["never reported", () => neverReported()],
      [
        "last apply",
        async () => {
          await mode("apply");
          await quiet();
        },
      ],
      [
        "last apply_limited",
        async () => {
          await mode("apply_limited", [TEST_CARD]);
          await quiet();
        },
      ],
      [
        "last dry_run",
        async () => {
          await mode("dry_run");
          await quiet();
        },
      ],
    ];
    const seen: string[] = [];
    for (const [name, set] of states) {
      await set();
      expect((await writerMode()).mode).toBe("unknown");
      for (const card of [null, ACME, TEST_CARD]) {
        const note = (await gates(PLAIN_FLAGS, card)).n.note;
        const quietCard = (await silent(card)) === true;
        expect({ name, card, quiet: note === QUIET_TEAM }).toEqual({
          name,
          card,
          quiet: quietCard,
        });
        if (quietCard) seen.push(`${name}:${card}`);
      }
    }
    expect(seen).toEqual([
      "last apply:null",
      `last apply:${ACME}`,
      `last apply:${TEST_CARD}`,
      `last apply_limited:${TEST_CARD}`,
    ]);

    // End to end, as the review found it: the writer was testing on the
    // internal test card and went quiet. A CSM seat (no editor right) files for
    // the test card: the form and the list both say the writer is quiet.
    await mode("apply_limited", [TEST_CARD]);
    await quiet();
    const onCard = await submit(CSM, {
      type: "general_tech",
      client: TEST_CARD,
      answers: { details: "Filed on the test card while the writer is quiet" },
    });
    expect(onCard).toMatchObject({
      state: "sending",
      held: true,
      note: QUIET_TEAM,
    });
    expect(await get(CSM, onCard.id)).toMatchObject({
      held: true,
      heldNote: ROW_SILENT,
    });
    // Off the test card the writer was never sending it: the testing note, and
    // the row says requests are not open.
    const offCard = await submit(CSM, {
      type: "general_tech",
      client: ACME,
      answers: { details: "Filed off the test card while the writer is quiet" },
    });
    expect(offCard).toMatchObject({
      state: "sending",
      held: true,
      note: TESTING,
    });
    expect(await get(CSM, offCard.id)).toMatchObject({
      held: true,
      heldNote: ROW_NOT_OPEN,
    });
    // Neither is claimed while the writer is quiet; cancel both so the later
    // claim counts stay this file's own.
    expect(await claim("00000000-0000-4000-8000-00000000c1b1")).toEqual([]);
    for (const id of [onCard.id, offCard.id])
      expect(
        (
          await one<Row>(
            CSM,
            "SELECT public.cockpit_request_cancel($1, 'test over') r",
            [id],
          )
        ).state,
      ).toBe("cancelled");
  });

  test("the form's writer block: every real seat may send; held says whether it waits", async () => {
    await mode("dry_run");
    for (const who of [...PLAIN_SEATS, ...EDITOR_SEATS])
      expect(await writer(who)).toEqual({
        mode: "dry_run",
        canSend: true,
        held: true,
        note: NOT_OPEN,
      });
    await mode("apply");
    await quiet();
    for (const who of PLAIN_SEATS)
      expect(await writer(who)).toEqual({
        mode: "unknown",
        canSend: true,
        held: true,
        note: QUIET_TEAM,
      });
    for (const who of EDITOR_SEATS)
      expect(await writer(who)).toEqual({
        mode: "unknown",
        canSend: true,
        held: true,
        note: QUIET_EDITOR,
      });
    // cockpit_request_can_send reads the same note.
    expect(
      (
        await q<{ n: string }>(
          "SELECT public.cockpit_request_can_send('{}'::jsonb, NULL) n",
        )
      )[0].n,
    ).toBe(QUIET_TEAM);
    await mode("apply");
    for (const who of [...PLAIN_SEATS, ...EDITOR_SEATS])
      expect(await writer(who)).toEqual({
        mode: "apply",
        canSend: true,
        held: false,
        note: null,
      });
  });
});

describe("a plain seat's request while the writer cannot send: saved, held, sent once", () => {
  test("dry run, then a quiet writer, then apply: nothing lost, nothing sent twice", async () => {
    // 1. Dry run: a CSM seat (no editor right) files a general tech request.
    await mode("dry_run");
    const dry = await submit(CSM, {
      type: "general_tech",
      answers: { details: "Held while requests are not open" },
    });
    expect(dry).toMatchObject({
      state: "sending",
      held: true,
      note: NOT_OPEN,
      reused: false,
      duplicateOf: null,
    });
    expect((await request(dry.id)).state).toBe("sending");
    expect((await parts(dry.id)).map(p => p.state)).toEqual(["queued"]);
    expect(
      (await queueRows(dry.id)).map(r => ({
        kind: r.kind,
        state: r.state,
        attempts: r.attempts,
      })),
    ).toEqual([{ kind: "request", state: "queued", attempts: 0 }]);
    expect(await heldNow(dry.id)).toBe(true);
    expect(await get(CSM, dry.id)).toMatchObject({
      held: true,
      heldNote: ROW_NOT_OPEN,
      mine: true,
    });
    // Submit wrote its audit row, as the plain seat.
    const audit = await q(
      "SELECT action, actor_email FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY created_at, action",
      [dry.id],
    );
    expect(audit.map(a => a.action)).toContain("request.submitted");
    expect(audit.find(a => a.action === "request.submitted")?.actor_email).toBe(
      "csm@tests.invalid",
    );
    // The same press sent again returns what it made, still held.
    expect(
      await submit(CSM, {
        id: dry.id,
        type: "general_tech",
        answers: { details: "Held while requests are not open" },
      }),
    ).toMatchObject({ id: dry.id, reused: true, held: true, note: NOT_OPEN });
    // The writer's claim takes nothing while it reports a dry run.
    expect(await claim("00000000-0000-4000-8000-00000000c1a1")).toEqual([]);

    // 2. Requests opened, then the writer went quiet: a call centre seat files a
    // client pause for its own client (two parts).
    await mode("apply");
    await quiet();
    const pause = await submit(CALL, { type: "client_pause", client: ACME });
    expect(pause).toMatchObject({
      state: "sending",
      held: true,
      note: QUIET_TEAM,
    });
    expect((await parts(pause.id)).map(p => p.state)).toEqual([
      "queued",
      "queued",
    ]);
    expect(
      (await queueRows(pause.id)).every(
        r => r.state === "queued" && r.attempts === 0,
      ),
    ).toBe(true);
    expect((await queueRows(pause.id)).length).toBe(2);
    expect(await heldNow(pause.id)).toBe(true);
    expect(await get(CALL, pause.id)).toMatchObject({
      held: true,
      heldNote: ROW_SILENT,
    });
    // The same pause filed again for the same card is the duplicate answer, and
    // nothing new is saved.
    const again = await submit(CALL, { type: "client_pause", client: ACME });
    expect(again).toMatchObject({
      id: null,
      state: "duplicate",
      duplicateOf: pause.id,
      held: false,
    });
    expect(
      (
        await q<{ n: number }>(
          "SELECT count(*)::int n FROM public.cockpit_requests WHERE type_key='client_pause' AND client_task_id=$1",
          [ACME],
        )
      )[0].n,
    ).toBe(1);
    // The claim takes nothing while the writer is quiet.
    expect(await claim("00000000-0000-4000-8000-00000000c1a2")).toEqual([]);

    // 3. The writer reports apply again: the claim takes every held row exactly once.
    await mode("apply");
    const first = await claim("00000000-0000-4000-8000-00000000c1a3");
    const mine = [dry.id, pause.id];
    expect(
      first
        .filter(c => mine.includes(c.source_id))
        .map(c => c.dedupe_key)
        .sort(),
    ).toEqual(
      [...(await queueRows(dry.id)), ...(await queueRows(pause.id))]
        .map(r => r.dedupe_key)
        .sort(),
    );
    expect(first.every(c => c.attempts === 1 && c.state === "sending")).toBe(
      true,
    );
    expect(await claim("00000000-0000-4000-8000-00000000c1a4")).toEqual([]);
    for (const id of mine) {
      expect(await heldNow(id)).toBe(false);
      for (const r of await queueRows(id))
        expect({ state: r.state, attempts: r.attempts }).toEqual({
          state: "sending",
          attempts: 1,
        });
    }
    expect((await get(CSM, dry.id)).held).toBe(false);
    expect((await get(CALL, pause.id)).heldNote).toBeNull();
  });
});

describe("the guard", () => {
  test("a body that is neither the live one nor this file's: the file raises and changes nothing", async () => {
    // Someone changed the gate since (here: a comment added to the new body).
    await asOwner();
    await db.exec(
      cut(migration(P), DEF, "the new send gate").replace(
        "BEGIN\n  CASE",
        "BEGIN\n  -- changed by hand\n  CASE",
      ),
    );
    const changed = await facts();
    expect(changed.md5).not.toBe(afterTwice.md5);
    expect(changed.md5).not.toBe(LIVE_MD5);
    const error = await apply(P);
    expect(error).toBe(
      `cockpit_request_send_gate is not the definition this file was written against (prosrc md5 ${changed.md5}). Re-read the live definition and rebase this file`,
    );
    expect(await facts()).toEqual(changed);
    // A database without the function at all is refused the same way.
    await db.exec(
      "ALTER FUNCTION public.cockpit_request_send_gate(jsonb,text) RENAME TO cockpit_request_send_gate_away",
    );
    expect(await apply(P)).toContain("(prosrc md5 missing)");
    await db.exec(
      "ALTER FUNCTION public.cockpit_request_send_gate_away(jsonb,text) RENAME TO cockpit_request_send_gate",
    );
    // Rolled back to 20261026r's body (the file's rollback), the file applies again.
    await db.exec(cut(migration(R), DEF, "the live send gate"));
    expect((await facts()).md5).toBe(LIVE_MD5);
    expect(await apply(P)).toBeNull();
    expect(await facts()).toEqual(afterTwice);
  });
});
