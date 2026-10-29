/**
 * Every seat reads when each part of a request type runs and the SOP steps it
 * adds (supabase/migrations/20261028a_request_types_read_routes.sql, the read
 * change of the tickets-look-1028 round; docs/requests/CONTRACT.md 2.5) on an
 * isolated PostgreSQL with Supabase's default privileges on, so a missing
 * REVOKE opens the function here as it would in production.
 *
 * It stands on 20261026r_requests.sql and its seed 20261026s as
 * requests-supabase.test.ts sets them up (the same canonical definitions, cut
 * from their migrations). The body 20261028a replaces is kept beside the new
 * one as cockpit_request_types_read_before() (cut from 20261026r and renamed),
 * and both are read in one statement, so the two answers share one now() and
 * can be compared byte for byte. Every seat and client is invented. Nothing
 * here reaches ClickUp.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { readSeedJson } from "../../../scripts/gen-request-types-seed";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const N = "20261028a_request_types_read_routes.sql";
const WB = "20261009f_clickup_writeback_native.sql";

/** cockpit_request_types_read()'s prosrc md5, read live (read only) on 2026-10-28. */
const LIVE_MD5 = "2f12d9541235919c176db2c0cc400f95";

// Seats.
const ADMIN = "00000000-0000-4000-8000-0000000000d1"; // admin: a Requests editor
const EDITOR = "00000000-0000-4000-8000-0000000000f2"; // video editor given the right by a row
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm, every client
const CALL = "00000000-0000-4000-8000-0000000000b1"; // call centre, one client only
const SALES = "00000000-0000-4000-8000-0000000000b2"; // sales, no team queue
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, deactivated
const NOT_EDITORS = [CSM, CALL, SALES];
const EVERY_SEAT = [CSM, CALL, SALES, ADMIN, EDITOR];

// ClickUp options the seed carries.
const OPT = {
  meta: "88d55b4b-f296-4a0b-abc6-3b228889444a",
  tiktok: "c115bdfe-661f-4855-a86b-69a54b2e616a",
  snapchat: "97b22a7b-c18b-4be9-bd03-ff271bacfd77",
  adsIssue: "a2343b36-5d92-428d-9f73-ce47711480c2",
  callIssue: "cf9d1709-8d52-489b-9600-21e6a0d6ac12",
  both: "0014e47b-560a-4109-830c-77d6d60d985c",
};
const ISSUE_FIELD = "e58f563a-63c7-4f3a-b5cd-07cbb4a420d4";

/** A part's keys before 20261028a (TypePartView, contract 2.5). */
const OLD_PART_KEYS = [
  "part",
  "listName",
  "teamLabel",
  "ruleLabel",
  "templateName",
  "stepCount",
  "stepsDraft",
];

let db: PGlite;
type Row = Record<string, any>;

const SEED = readSeedJson();
const seedType = (key: string) => {
  const t = SEED.types.find(x => x.key === key);
  if (!t) throw new Error(`No seed type ${key}`);
  return t;
};

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
async function row(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<Row> {
  await actor(db, who);
  try {
    return (await db.query<Row>(text, params)).rows[0];
  } finally {
    await asOwner();
  }
}
async function refusedCode(
  who: string | null,
  text: string,
): Promise<{ message: string; code: string }> {
  await actor(db, who);
  try {
    await db.query(text);
  } catch (e) {
    return {
      message: (e as Error).message,
      code: (e as { code?: string }).code ?? "",
    };
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function svc(text: string, params: unknown[] = []): Promise<Row> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: Row }>(text, params)).rows[0].r;
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

/** The types read as a seat sees it. */
const read = async (who: string) =>
  (await row(who, "SELECT public.cockpit_request_types_read() r")).r as Row;
/** The new body's answer and the old body's, in one statement. */
const both = async (who: string) => {
  const r = await row(
    who,
    "SELECT public.cockpit_request_types_read() n, public.cockpit_request_types_read_before() o",
  );
  return { next: r.n as Row, before: r.o as Row };
};
/** The answer with the two keys of 20261028a taken out of every part. */
const withoutRoutes = (answer: Row): Row => ({
  ...answer,
  types: answer.types.map((t: Row) => ({
    ...t,
    parts: t.parts.map((p: Row) =>
      Object.fromEntries(
        Object.entries(p).filter(([k]) => k !== "when" && k !== "steps"),
      ),
    ),
  })),
});
/** Every other key of the answer is the old body's, byte for byte. */
async function expectOldAnswerKept(who: string) {
  const { next, before } = await both(who);
  expect(JSON.stringify(withoutRoutes(next))).toBe(JSON.stringify(before));
  expect(JSON.stringify(next)).not.toBe(JSON.stringify(before));
}
const typeOf = (answer: Row, key: string): Row => {
  const t = answer.types.find((x: Row) => x.key === key);
  if (!t) throw new Error(`No type ${key} in the answer`);
  return t;
};
const partOf = (type: Row, part: string): Row => {
  const p = type.parts.find((x: Row) => x.part === part);
  if (!p) throw new Error(`No part ${part} on ${type.key}`);
  return p;
};
const choicesOf = (type: Row, key: string): Row[] =>
  type.fields.find((f: Row) => f.key === key).options;
const typeRow = async (key: string) =>
  (
    await q("SELECT * FROM public.cockpit_request_types WHERE key=$1", [key])
  )[0];
const save = async (key: string, patch: Row) =>
  (
    await row(
      ADMIN,
      "SELECT public.cockpit_request_type_save($1,$2::jsonb,$3) r",
      [key, JSON.stringify(patch), (await typeRow(key)).version],
    )
  ).r as Row;

/** The hourly field read, as cockpit-tasks sends it, from the seed's catalog. */
const fieldRead = (change: (f: Row) => Row | null = f => f) =>
  svc("SELECT public.cockpit_request_field_catalog_sync($1::jsonb) r", [
    JSON.stringify(
      SEED.field_catalog
        .map(f =>
          change({
            id: f.clickup_field_id,
            name: f.clickup_name,
            type: "x",
            options: f.options,
          }),
        )
        .filter(Boolean),
    ),
  ]);

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const DEF =
  /CREATE OR REPLACE FUNCTION public\.cockpit_request_types_read\(\)[\s\S]*?END \$\$;/;
const BODY =
  /CREATE OR REPLACE FUNCTION public\.cockpit_request_types_read\(\)([\s\S]*?)AS \$\$([\s\S]*?)\$\$;/;
function definitionOf(file: string) {
  const hit = migration(file).match(BODY);
  if (!hit) throw new Error(`No cockpit_request_types_read in ${file}`);
  return { head: hit[1], body: hit[2] };
}
const GUARD = migration(N).match(
  /NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/,
);

/** Everything pg_proc says about the function but its body. */
const facts = async () =>
  (
    await q(
      `SELECT md5(p.prosrc) md5, p.prosecdef, p.proconfig, p.provolatile, l.lanname, p.prorettype::regtype::text rettype,
              p.proretset, p.prokind, p.proparallel, p.proisstrict, p.proleakproof, p.procost::float8 cost,
              pg_get_userbyid(p.proowner) owner, p.proacl::text acl, pg_get_function_identity_arguments(p.oid) args
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = 'public.cockpit_request_types_read()'::regprocedure`,
    )
  )[0];
const can = async (role: string) =>
  (
    await q<{ ok: boolean }>(
      "SELECT has_function_privilege($1,'public.cockpit_request_types_read()','EXECUTE') ok",
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
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, EDITOR, "video@tests.invalid", ["editor"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CALL, "call@tests.invalid", ["call_center"]);
  await member(db, SALES, "sales@tests.invalid", ["sales"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Acme Interiors"], CALL],
  );
  await db.query(
    "INSERT INTO public.cockpit_forms_editors(member_id, added_by) SELECT id, 'admin@tests.invalid' FROM public.cockpit_members WHERE auth_user_id=$1",
    [EDITOR],
  );

  // The requests build as it is live, and its types read kept as it was.
  for (const file of [R, S]) expect(await apply(file)).toBeNull();
  await db.exec(
    cut(migration(R), DEF, "cockpit_request_types_read").replace(
      "public.cockpit_request_types_read()",
      "public.cockpit_request_types_read_before()",
    ),
  );
  await db.exec(`
    REVOKE ALL ON FUNCTION public.cockpit_request_types_read_before() FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_request_types_read_before() TO authenticated;`);
  before = await facts();

  // 20261028a, twice.
  expect(await apply(N)).toBeNull();
  afterOnce = await facts();
  expect(await apply(N)).toBeNull();
  afterTwice = await facts();
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe("20261028a on 20261026r and 20261026s", () => {
  test("applies twice: the guard takes the live body, then its own", async () => {
    expect(GUARD).not.toBeNull();
    const [, oldMd5, newMd5] = GUARD as RegExpMatchArray;
    expect(oldMd5).toBe(LIVE_MD5);
    expect(md5(definitionOf(R).body)).toBe(LIVE_MD5);
    expect(before.md5).toBe(LIVE_MD5);
    expect(md5(definitionOf(N).body)).toBe(newMd5);
    expect(afterOnce.md5).toBe(newMd5);
    expect(afterTwice.md5).toBe(newMd5);
    // The header names both, for the deploy's check.
    const header = migration(N).slice(0, migration(N).indexOf("BEGIN;"));
    expect(header).toContain(`prosrc md5 ${LIVE_MD5}`);
    expect(header).toContain(`${newMd5}), so a change made since`);
    expect(header).toContain(
      "SELECT md5(prosrc) FROM pg_catalog.pg_proc\n--    WHERE oid = 'public.cockpit_request_types_read()'::regprocedure;",
    );
    const sql = migration(N);
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
  });

  test("the body is the live one with one statement added after the types are read", () => {
    const old = definitionOf(R);
    const next = definitionOf(N);
    expect(next.head).toBe(old.head);
    const a = old.body.split("\n");
    const b = next.body.split("\n");
    let head = 0;
    while (head < a.length && a[head] === b[head]) head++;
    let tail = 0;
    while (
      tail < a.length - head &&
      a[a.length - 1 - tail] === b[b.length - 1 - tail]
    )
      tail++;
    // Every line of the live body is kept, in order, around one added block.
    expect(head + tail).toBe(a.length);
    expect(a[head - 1]).toBe(
      "    INTO v_types FROM public.cockpit_request_types t WHERE t.enabled OR v_editor;",
    );
    expect(a[head]).toBe("  RETURN jsonb_build_object('asOf', now(),");
    const added = b.slice(head, b.length - tail).join("\n");
    expect(added).toContain("'when'");
    expect(added).toContain("'steps'");
    expect(added).not.toContain("RETURN");
    expect(added.trimEnd().endsWith(";")).toBe(true);
  });

  test("the grant and the function's settings are as they were", async () => {
    const settings = (f: Row) =>
      Object.fromEntries(Object.entries(f).filter(([k]) => k !== "md5"));
    const was = settings(before);
    const is = settings(afterTwice);
    expect(is).toEqual(was);
    expect(is).toMatchObject({
      prosecdef: true,
      proconfig: ['search_path=""'],
      provolatile: "s",
      lanname: "plpgsql",
      rettype: "jsonb",
      args: "",
    });
    expect(await can("authenticated")).toBe(true);
    expect(await can("anon")).toBe(false);
    expect(await can("service_role")).toBe(false);
    const grantees = await q<{ who: string }>(
      `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END who
         FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = 'public.cockpit_request_types_read()'::regprocedure ORDER BY 1`,
    );
    expect(grantees.map(g => g.who)).toEqual(
      [is.owner, "authenticated"].sort(),
    );
  });

  test("the gate is as it was: no seat, or one that is not active, is refused", async () => {
    expect(
      (await refusedCode(null, "SELECT public.cockpit_request_types_read()"))
        .message,
    ).toContain("permission denied");
    expect(
      await refusedCode(GONE, "SELECT public.cockpit_request_types_read()"),
    ).toEqual({
      message: "Sign in with an active seat to use requests.",
      code: "42501",
    });
  });
});

describe("every seat reads when each part runs and the steps it adds", () => {
  test("a seat that is not an editor reads both keys on every part", async () => {
    for (const who of NOT_EDITORS) {
      const answer = await read(who);
      expect(answer.seat.editor).toBe(false);
      expect(answer.types.length).toBe(31);
      for (const t of answer.types) {
        expect(t.targets).toBeUndefined();
        expect(t.sopSteps).toBeUndefined();
        expect(t.parts.length).toBe(seedType(t.key).targets.length);
        for (const p of t.parts)
          expect(Object.keys(p).sort()).toEqual(
            [...OLD_PART_KEYS, "when", "steps"].sort(),
          );
      }
    }
    // Editors read them too, beside their own fields.
    for (const who of [ADMIN, EDITOR]) {
      const answer = await read(who);
      expect(answer.seat.editor).toBe(true);
      for (const t of answer.types)
        for (const p of t.parts) {
          expect(p).toHaveProperty("when");
          expect(p).toHaveProperty("steps");
        }
    }
  });

  test("Low schedule rate: Call Center Issue or Both, and Ads issue or Both, named as its question names them", async () => {
    for (const who of NOT_EDITORS) {
      const t = typeOf(await read(who), "low_schedule_rate");
      expect(t.parts.map((p: Row) => p.part)).toEqual(["call_center", "ads"]);
      expect(partOf(t, "call_center").when).toEqual({
        fieldKey: "schedule_rate_issue",
        options: [
          { id: OPT.callIssue, name: "Call Center Issue" },
          { id: OPT.both, name: "Both" },
        ],
      });
      expect(partOf(t, "ads").when).toEqual({
        fieldKey: "schedule_rate_issue",
        options: [
          { id: OPT.adsIssue, name: "Ads issue" },
          { id: OPT.both, name: "Both" },
        ],
      });
      // The same ids and names, in the same order, as the question's own choices.
      const choices = choicesOf(t, "schedule_rate_issue");
      expect(choices.map((c: Row) => c.name)).toEqual([
        "Ads issue",
        "Call Center Issue",
        "Both",
      ]);
      for (const p of t.parts)
        expect(p.when.options).toEqual(
          choices.filter((c: Row) =>
            p.when.options.some((o: Row) => o.id === c.id),
          ),
        );
      // Both parts use a ClickUp template.
      for (const p of t.parts) {
        expect(p.steps).toBeNull();
        expect(p.stepCount).toBeNull();
      }
    }
  });

  test("Create an ad account: three parts, one platform each", async () => {
    const t = typeOf(await read(SALES), "create_ad_account");
    expect(
      t.parts.map((p: Row) => ({ part: p.part, when: p.when, steps: p.steps })),
    ).toEqual([
      {
        part: "meta",
        when: {
          fieldKey: "ads_platform",
          options: [{ id: OPT.meta, name: "Facebook/Meta" }],
        },
        steps: null,
      },
      {
        part: "tiktok",
        when: {
          fieldKey: "ads_platform",
          options: [{ id: OPT.tiktok, name: "Tiktok" }],
        },
        steps: null,
      },
      {
        part: "snapchat",
        when: {
          fieldKey: "ads_platform",
          options: [{ id: OPT.snapchat, name: "Snapchat" }],
        },
        steps: null,
      },
    ]);
  });

  test("a part that always runs reads when null; only the five routed parts read a choice", async () => {
    const answer = await read(CSM);
    const routed = answer.types.flatMap((t: Row) =>
      t.parts
        .filter((p: Row) => p.when !== null)
        .map((p: Row) => `${t.key}.${p.part}`),
    );
    const seeded = SEED.types.flatMap(t =>
      t.targets.filter(g => g.when !== null).map(g => `${t.key}.${g.part}`),
    );
    expect(routed.sort()).toEqual(seeded.sort());
    expect(routed.length).toBe(5);
    for (const key of ["client_pause", "client_offboarding", "general_tech"])
      for (const p of typeOf(answer, key).parts) expect(p.when).toBeNull();
    // Each routed part names its own question and exactly its stored choices.
    for (const t of SEED.types)
      for (const g of t.targets) {
        if (!g.when) continue;
        const p = partOf(typeOf(answer, t.key), g.part);
        expect(p.when.fieldKey).toBe(g.when.field_key);
        expect(p.when.options.map((o: Row) => o.id).sort()).toEqual(
          [...g.when.options].sort(),
        );
      }
  });

  test("steps: the type's SOP steps for a part with no template, null for a template part", async () => {
    const rows = await q(
      "SELECT key, targets, sop_steps, sop_steps_state FROM public.cockpit_request_types",
    );
    for (const who of [CSM, ADMIN]) {
      const answer = await read(who);
      let withSteps = 0;
      for (const r of rows) {
        const t = typeOf(answer, r.key);
        for (const g of r.targets) {
          const p = partOf(t, g.part);
          if (g.template_id) {
            expect(p.steps).toBeNull();
            expect(p.stepCount).toBeNull();
          } else {
            expect(p.steps).toEqual(r.sop_steps ?? []);
            expect(p.steps.length).toBe(p.stepCount);
            expect(p.stepsDraft).toBe(r.sop_steps_state === "draft");
            withSteps++;
          }
        }
      }
      expect(withSteps).toBe(13);
    }
    const answer = await read(CSM);
    // A template with fallback steps: they go only when the template brings no checklist.
    const whatsapp = partOf(typeOf(answer, "whatsapp_connection"), "main");
    expect(seedType("whatsapp_connection").sop_steps?.length).toBe(6);
    expect(whatsapp).toMatchObject({
      templateName: seedType("whatsapp_connection").targets[0].template_name,
      stepCount: null,
      stepsDraft: false,
      when: null,
      steps: null,
    });
    // A draft list, in order, as the writer adds it.
    expect(partOf(typeOf(answer, "general_tech"), "main")).toMatchObject({
      templateName: null,
      stepCount: 5,
      stepsDraft: true,
      when: null,
      steps: seedType("general_tech").sop_steps,
    });
    const dfy = partOf(typeOf(answer, "dfy_to_dwy"), "main");
    expect(dfy.steps).toEqual(seedType("dfy_to_dwy").sop_steps);
    expect(dfy.steps.length).toBe(9);
    expect(dfy.steps[0]).toBe(
      "Confirm the client has a call team and collect each caller's name, email and phone.",
    );
  });

  test("both keys say what the server makes: cockpit_request_plan runs exactly the parts each choice names, and adds exactly the steps listed", async () => {
    const plan = async (key: string, answers: Row) =>
      (
        await q<{ r: Row[] }>(
          "SELECT public.cockpit_request_plan(t, NULL, NULL, 'Acme Interiors', $1::jsonb, NULL, NULL, 'a seat', NULL) r FROM public.cockpit_request_types t WHERE t.key = $2",
          [JSON.stringify(answers), key],
        )
      )[0].r;
    const rows = await q(
      "SELECT key, targets FROM public.cockpit_request_types",
    );
    const answer = await read(CSM);
    let choices = 0;
    for (const r of rows) {
      const t = typeOf(answer, r.key);
      // Nothing answered: only the parts whose when is null run.
      const none = await plan(r.key, {});
      expect({ type: r.key, parts: none.map(p => p.part) }).toEqual({
        type: r.key,
        parts: t.parts
          .filter((p: Row) => p.when === null)
          .map((p: Row) => p.part),
      });
      // Each choice of each deciding question: the parts that name it, and those that always run.
      const deciding = [
        ...new Set(
          t.parts.filter((p: Row) => p.when).map((p: Row) => p.when.fieldKey),
        ),
      ] as string[];
      for (const key of deciding)
        for (const choice of choicesOf(t, key)) {
          const ran = await plan(r.key, { [key]: choice.id });
          expect({
            type: r.key,
            choice: choice.name,
            parts: ran.map(p => p.part),
          }).toEqual({
            type: r.key,
            choice: choice.name,
            parts: t.parts
              .filter(
                (p: Row) =>
                  p.when === null ||
                  (p.when.fieldKey === key &&
                    p.when.options.some((o: Row) => o.id === choice.id)),
              )
              .map((p: Row) => p.part),
          });
          choices++;
        }
      // Every part, each with the answer that runs it: steps is the checklist
      // the writer adds itself (sopStepsWhen 'always'), [] when it adds none,
      // and null when the part's ClickUp template brings its own.
      for (const g of r.targets) {
        const p = partOf(t, g.part);
        const runs = p.when
          ? await plan(r.key, { [p.when.fieldKey]: p.when.options[0].id })
          : none;
        const made = runs.find(x => x.part === g.part) as Row;
        expect(made, `${r.key}.${g.part}`).toBeDefined();
        expect({ part: `${r.key}.${g.part}`, steps: p.steps }).toEqual({
          part: `${r.key}.${g.part}`,
          steps: g.template_id
            ? null
            : made.payload.sopStepsWhen === "always"
              ? made.payload.sopSteps
              : [],
        });
      }
    }
    // Low schedule rate's three choices and Create an ad account's three.
    expect(choices).toBe(6);
  });

  test("every other key is the old body's, byte for byte, for every seat and writer mode", async () => {
    for (const who of EVERY_SEAT) await expectOldAnswerKept(who);
    expect(
      await svc(
        "SELECT public.cockpit_clickup_requests_state(true,'test','apply','{}'::text[],'{}'::jsonb) r",
      ),
    ).toBeDefined();
    for (const who of [CSM, ADMIN]) {
      expect((await read(who)).writer.mode).toBe("apply");
      await expectOldAnswerKept(who);
    }
  });
});

describe("when the types or ClickUp change", () => {
  test("an editor's choices come back in the order of the question's choices", async () => {
    const targets = seedType("low_schedule_rate").targets.map(g =>
      g.part === "ads"
        ? {
            ...g,
            when: {
              field_key: "schedule_rate_issue",
              options: [OPT.both, OPT.adsIssue],
            },
          }
        : g,
    );
    await save("low_schedule_rate", { targets });
    expect(
      (await typeRow("low_schedule_rate")).targets[1].when.options,
    ).toEqual([OPT.both, OPT.adsIssue]);
    const t = typeOf(await read(CSM), "low_schedule_rate");
    expect(partOf(t, "ads").when.options).toEqual([
      { id: OPT.adsIssue, name: "Ads issue" },
      { id: OPT.both, name: "Both" },
    ]);
    await expectOldAnswerKept(CSM);
  });

  test("a renamed choice, a choice ClickUp dropped and a question ClickUp lost follow the form's own choices", async () => {
    const issue = async () => typeOf(await read(CSM), "low_schedule_rate");
    // ClickUp renames a choice: the part's choice reads the new name, as the question does.
    await fieldRead(f =>
      f.id === ISSUE_FIELD
        ? {
            ...f,
            options: f.options.map((o: Row) =>
              o.id === OPT.callIssue ? { ...o, name: "Call centre issue" } : o,
            ),
          }
        : f,
    );
    let t = await issue();
    expect(partOf(t, "call_center").when.options).toEqual([
      { id: OPT.callIssue, name: "Call centre issue" },
      { id: OPT.both, name: "Both" },
    ]);
    expect(
      choicesOf(t, "schedule_rate_issue").map((c: Row) => c.name),
    ).toContain("Call centre issue");
    await expectOldAnswerKept(CSM);
    // ClickUp drops Both: the form cannot offer it, so no part reads it.
    await fieldRead(f =>
      f.id === ISSUE_FIELD
        ? {
            ...f,
            options: f.options.filter((o: Row) => o.id !== OPT.both),
          }
        : f,
    );
    t = await issue();
    expect(partOf(t, "call_center").when.options).toEqual([
      { id: OPT.callIssue, name: "Call Center Issue" },
    ]);
    expect(partOf(t, "ads").when.options).toEqual([
      { id: OPT.adsIssue, name: "Ads issue" },
    ]);
    await expectOldAnswerKept(CSM);
    // ClickUp loses the question: the form says so and no choice is named.
    await fieldRead(f => (f.id === ISSUE_FIELD ? null : f));
    t = await issue();
    expect(choicesOf(t, "schedule_rate_issue")).toEqual([]);
    for (const p of t.parts)
      expect(p.when).toEqual({ fieldKey: "schedule_rate_issue", options: [] });
    await expectOldAnswerKept(CSM);
    // Back as it was.
    await fieldRead();
    t = await issue();
    expect(partOf(t, "call_center").when.options).toEqual([
      { id: OPT.callIssue, name: "Call Center Issue" },
      { id: OPT.both, name: "Both" },
    ]);
  });

  test("a part with no template and no SOP steps adds none: steps is an empty list", async () => {
    expect(seedType("ad_spend_invoice").sop_steps).toBeNull();
    await save("ad_spend_invoice", {
      targets: seedType("ad_spend_invoice").targets.map(g => ({
        ...g,
        template_id: null,
        template_name: null,
      })),
    });
    expect(
      partOf(typeOf(await read(CSM), "ad_spend_invoice"), "main"),
    ).toMatchObject({
      templateName: null,
      stepCount: 0,
      when: null,
      steps: [],
    });
    await expectOldAnswerKept(CSM);
  });

  test("a choice question of the cockpit's own decides a part: its own choices name it", async () => {
    const seed = seedType("general_tech");
    const board = {
      key: "which_board",
      label: "Which board needs it?",
      kind: "select",
      clickup_field_id: null,
      required: false,
      options: [
        { id: "tech", name: "The tech board" },
        { id: "ads", name: "The ads board" },
      ],
      help: null,
    };
    await save("general_tech", {
      fields: [
        ...seed.fields.filter(
          f => f.kind !== "deadline" && f.kind !== "priority",
        ),
        board,
        ...seed.fields.filter(
          f => f.kind === "deadline" || f.kind === "priority",
        ),
      ],
    });
    await save("general_tech", {
      targets: [
        ...seed.targets,
        {
          part: "ads",
          name_suffix: " (Ads)",
          list_id: "901816723196",
          team: "ads",
          template_id: null,
          template_name: null,
          owner_rule: "media_buyer_of_record",
          owner_clickup_id: null,
          when: { field_key: "which_board", options: ["ads"] },
        },
      ],
    });
    for (const who of [SALES, ADMIN]) {
      const t = typeOf(await read(who), "general_tech");
      expect(t.parts.map((p: Row) => [p.part, p.when])).toEqual([
        ["main", null],
        [
          "ads",
          {
            fieldKey: "which_board",
            options: [{ id: "ads", name: "The ads board" }],
          },
        ],
      ]);
      expect(choicesOf(t, "which_board")).toEqual(board.options);
      for (const p of t.parts) expect(p.steps).toEqual(seed.sop_steps);
    }
    await expectOldAnswerKept(SALES);
    await expectOldAnswerKept(ADMIN);
  });

  test("a type an editor turned off: the team does not see it, editors still read its routes", async () => {
    await save("create_ad_account", { enabled: false });
    for (const who of NOT_EDITORS)
      expect(
        (await read(who)).types.some((t: Row) => t.key === "create_ad_account"),
      ).toBe(false);
    const t = typeOf(await read(ADMIN), "create_ad_account");
    expect(t.enabled).toBe(false);
    expect(t.parts.map((p: Row) => p.when.options[0].name)).toEqual([
      "Facebook/Meta",
      "Tiktok",
      "Snapchat",
    ]);
    for (const who of EVERY_SEAT) await expectOldAnswerKept(who);
    await save("create_ad_account", { enabled: true });
  });

  test("the type editor's save answer is as before: neither key", async () => {
    const view = await save("whatsapp_connection", { priority: "high" });
    expect(view.key).toBe("whatsapp_connection");
    for (const p of view.parts)
      expect(Object.keys(p).sort()).toEqual([...OLD_PART_KEYS].sort());
  });
});

describe("the guard", () => {
  test("a body changed since is never overwritten: the file refuses and changes nothing", async () => {
    const [, , newMd5] = GUARD as RegExpMatchArray;
    // Someone else's change: the old body with one more line.
    await db.exec(
      cut(migration(R), DEF, "cockpit_request_types_read").replace(
        "  v_types jsonb;\n",
        "  v_types jsonb;\n  -- changed since\n",
      ),
    );
    const moved = (await facts()).md5;
    expect([LIVE_MD5, newMd5]).not.toContain(moved);
    expect(await apply(N)).toBe(
      `cockpit_request_types_read is not the definition this file was written against (prosrc md5 ${moved}). Re-read the live definition and rebase this file`,
    );
    expect((await facts()).md5).toBe(moved);
    // No function at all.
    await q("DROP FUNCTION public.cockpit_request_types_read()");
    expect(await apply(N)).toBe(
      "cockpit_request_types_read is not the definition this file was written against (prosrc md5 missing). Re-read the live definition and rebase this file",
    );
    expect(
      await q(
        "SELECT 1 FROM pg_proc WHERE proname = 'cockpit_request_types_read'",
      ),
    ).toEqual([]);
    // The live body again (a new function here, so its default grants too):
    // the file applies and its grant lines put back exactly the screens' one.
    await db.exec(cut(migration(R), DEF, "cockpit_request_types_read"));
    expect(await can("anon")).toBe(true);
    expect(await apply(N)).toBeNull();
    const now = await facts();
    expect(now.md5).toBe(newMd5);
    expect(await can("authenticated")).toBe(true);
    expect(await can("anon")).toBe(false);
    expect(await can("service_role")).toBe(false);
    expect(now.acl).toBe(before.acl);
    await expectOldAnswerKept(CSM);
  });
});
