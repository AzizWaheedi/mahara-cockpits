/**
 * Requests core (20261026r_requests.sql and its seed 20261026s, contract
 * docs/requests/CONTRACT.md sections 2 and 9 "db") on an isolated PostgreSQL
 * with Supabase's default privileges on, so a missing REVOKE opens an object
 * here as it would in production.
 *
 * It stands on the real definitions, cut from their canonical migrations:
 * the writeback queue, runs, audit trigger, state row and the live begin,
 * idle, claim, save and finish (20261009f, the billing kind of 20261009j);
 * the editor gate, its table and the role and seat labels (20261025n); the
 * CEO gate and cockpit_has_role (20260923m); cockpit_client_allowed and
 * cockpit_is_team_only (20261017b); the sync state (20260921e with the detail
 * column of 20261011c), the people list (20260919b with the schedule of
 * 20260921b), the onboarding mirror (20261005a) and the Blueprint settings
 * (20261024a). Every person, seat, client, ClickUp id and task is invented,
 * except the three owner ids the seed itself names. PGlite has no pg_cron,
 * vault or pg_net: the guarded blocks skip and the kick only writes its note.
 * Nothing here reaches ClickUp: a write is a queue row.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readSeedJson } from "../../../scripts/gen-request-types-seed";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const WB = "20261009f_clickup_writeback_native.sql";

// Seats.
const CEO = "00000000-0000-4000-8000-0000000000c3"; // the CEO's address, no roles
const SM = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm, every client
const CSM_B = "00000000-0000-4000-8000-0000000000a2"; // csm, Beta Build only, no people row
const CALL = "00000000-0000-4000-8000-0000000000b1"; // call centre, Acme Interiors only
const SALES = "00000000-0000-4000-8000-0000000000b2"; // sales
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative, the creative strategist
const BUYER = "00000000-0000-4000-8000-0000000000f1"; // media buyer
const VIDEO = "00000000-0000-4000-8000-0000000000f2"; // video editor, given the editor right by a row
const PLAIN = "00000000-0000-4000-8000-0000000000f3"; // video editor, no right
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, deactivated

// ClickUp users. The seed names the systems manager, the creative strategist
// and the CSM by id; the rest are invented.
const CU_SM = 113459516;
const CU_CS = 113520400;
const CU_CSM = 113688800;
const CU_BUYER = 900000004;
const CU_VIDEO = 900000005;
const CU_CEO = 900000006;
const CU_CALL = 900000007;
const CU_TWIN_A = 900000008; // two members share the sales seat's address
const CU_TWIN_B = 900000009;
const CU_OTHER = 900000010; // a member with no seat

// Client cards.
const ACME = "taskacme1";
const BETA = "taskbeta1";
const GAMMA = "taskgamma1"; // Stopped
const TEST_CARD = "86eywg1cq";

// ClickUp options the seed carries.
const OPT_TIKTOK = "c115bdfe-661f-4855-a86b-69a54b2e616a";
const OPT_ADS_ISSUE = "a2343b36-5d92-428d-9f73-ce47711480c2";
const OPT_BOTH = "0014e47b-560a-4109-830c-77d6d60d985c";
const OPT_CALL_ISSUE = "cf9d1709-8d52-489b-9600-21e6a0d6ac12";

let db: PGlite;
type Row = Record<string, any>;
let seq = 0;
const uid = () => `10000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

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
async function refused(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<string> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function refusedCode(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<{ message: string; code: string }> {
  await actor(db, who);
  try {
    await db.query(text, params);
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
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function svcRefused(
  text: string,
  params: unknown[] = [],
): Promise<string> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function ownerRefused(
  text: string,
  params: unknown[] = [],
): Promise<string> {
  await asOwner();
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
const memberId = async (uidv: string) =>
  (
    await q<{ id: string }>(
      "SELECT id FROM public.cockpit_members WHERE auth_user_id=$1",
      [uidv],
    )
  )[0].id;

/** The requests writer reports its mode, as each run of job requests does. */
const mode = (m: "dry_run" | "apply" | "apply_limited", cards: string[] = []) =>
  svc(
    "SELECT public.cockpit_clickup_requests_state(true,'test',$1,$2::text[],'{}'::jsonb) r",
    [m, cards],
  );
const modeGone = () =>
  q(
    "DELETE FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests'",
  );

const kuwaitToday = async () =>
  (
    await q<{ d: string }>(
      "SELECT to_char((now() AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') d",
    )
  )[0].d;
const kuwaitPlus = async (days: number) =>
  (
    await q<{ d: string }>(
      "SELECT to_char((now() AT TIME ZONE 'Asia/Kuwait')::date + $1::integer,'YYYY-MM-DD') d",
      [days],
    )
  )[0].d;

type Submit = {
  id?: string;
  type: string;
  client?: string | null;
  answers?: Row;
  due?: string | null;
  priority?: string | null;
  source?: string;
  replaces?: string | null;
};
const submitSql =
  "SELECT public.cockpit_request_submit($1::uuid,$2,$3,$4::jsonb,$5::date,$6,$7,$8) r";
const submitArgs = (s: Submit) => [
  s.id ?? uid(),
  s.type,
  s.client ?? null,
  JSON.stringify(s.answers ?? {}),
  s.due ?? null,
  s.priority ?? null,
  s.source ?? "requests_page",
  s.replaces ?? null,
];
const submit = (who: string, s: Submit) =>
  one<Row>(who, submitSql, submitArgs(s));
const submitRefused = (who: string, s: Submit) =>
  refused(who, submitSql, submitArgs(s));
const preview = (
  who: string,
  type: string,
  client: string | null = null,
  answers: Row = {},
) =>
  one<Row>(who, "SELECT public.cockpit_request_preview($1,$2,$3::jsonb) r", [
    type,
    client,
    JSON.stringify(answers),
  ]);
const request = async (id: string) =>
  (await q("SELECT * FROM public.cockpit_requests WHERE id=$1", [id]))[0];
const parts = (id: string) =>
  q(
    `SELECT p.* FROM public.cockpit_request_parts p JOIN public.cockpit_requests r ON r.id = p.request_id
      WHERE p.request_id=$1 ORDER BY p.created_at, public.cockpit_request_part_rank(r.type_key, p.part), p.part`,
    [id],
  );
const queueRows = (id: string) =>
  q(
    "SELECT * FROM public.cockpit_clickup_writeback_queue WHERE source_id=$1 ORDER BY created_at, dedupe_key",
    [id],
  );
const audits = (entity: string) =>
  q(
    "SELECT * FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY created_at, action",
    [entity],
  );
const typeRow = async (key: string) =>
  (
    await q("SELECT * FROM public.cockpit_request_types WHERE key=$1", [key])
  )[0];

/** Moves a queue row as the writer would: claim it, then save each state. */
async function writerMoves(queueId: string, patches: Row[]) {
  const token = uid();
  await q(
    "UPDATE public.cockpit_clickup_writeback_queue SET next_attempt_at = now() - interval '1 second' WHERE id=$1",
    [queueId],
  );
  await q(
    "UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() WHERE id=$1",
    [queueId, token],
  );
  for (const patch of patches) {
    await svc(
      "SELECT public.cockpit_clickup_writeback_save($1,$2,$3::jsonb) r",
      [queueId, token, JSON.stringify(patch)],
    );
    if (patch.state && patch.state !== "sending") break;
  }
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The sync state (with its detail column), the people list (with schedules),
  // the onboarding mirror and the Blueprint settings.
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

  // Seats.
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, SM, "sm@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, CALL, "call@tests.invalid", ["call_center"]);
  await member(db, SALES, "sales@tests.invalid", ["sales"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, VIDEO, "video@tests.invalid", ["editor"]);
  await member(db, PLAIN, "plain@tests.invalid", ["editor"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Acme Interiors"], CALL],
  );
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Beta Build"], CSM_B],
  );
  await db.query(
    "UPDATE public.cockpit_members SET name='Mona Video' WHERE auth_user_id=$1",
    [VIDEO],
  );
  await db.query(
    "INSERT INTO public.cockpit_forms_editors(member_id, added_by) SELECT id, 'aziz@maharamedia.com' FROM public.cockpit_members WHERE auth_user_id=$1",
    [VIDEO],
  );

  // People, by role.
  for (const [name, email, role] of [
    ["Huda Manager", "sm@tests.invalid", "Systems manager"],
    ["Omar Strategist", "creative@tests.invalid", "Creative strategist"],
    ["Noura Success", "csm@tests.invalid", "Client success manager"],
    ["Bilal Buyer", "buyer@tests.invalid", "Media buyer"],
    ["Mona Video", "video@tests.invalid", "Video editor"],
    ["Aziz W", "aziz@maharamedia.com", "CEO"],
    ["Rana Caller", "call@tests.invalid", "Call centre agent"],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );

  // Client cards.
  for (const [task, name, status, csm] of [
    [ACME, "Acme Interiors", "Active", "Noura Success"],
    [BETA, "Beta Build", "Active", "Somebody Unknown"],
    [GAMMA, "Gamma Design", "Stopped", null],
    [TEST_CARD, "Mahara Test Card", "Active", null],
    ["taskdelta1", "Delta Homes", "GHOSTED", null],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, csm) VALUES($1,$2,$3,$4)",
      [task, name, status, csm],
    );

  // Applied twice: the second run changes nothing and raises nothing.
  await db.exec(migration(R));
  await db.exec(migration(S));
  await db.exec(migration(R));
  await db.exec(migration(S));
}, 120000);
afterAll(async () => {
  await db?.close();
});

const SEED = readSeedJson();
const seedType = (key: string) => {
  const t = SEED.types.find(x => x.key === key);
  if (!t) throw new Error(`No seed type ${key}`);
  return t;
};
const catalogOption = (fieldId: string, name: string) => {
  const f = SEED.field_catalog.find(x => x.clickup_field_id === fieldId);
  const o = f?.options?.find(x => x.name === name);
  if (!o) throw new Error(`No option ${name} on ${fieldId}`);
  return o.id;
};
const fieldOf = (key: string, field: string) => {
  const f = seedType(key).fields.find(x => x.key === field);
  if (!f) throw new Error(`No field ${field} on ${key}`);
  return f;
};
const optionFor = (key: string, field: string, name: string) =>
  catalogOption(fieldOf(key, field).clickup_field_id as string, name);

/** Kuwait's working-day default, as the screens and the contract count it. */
function dueDefault(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  let n = 0;
  while (n < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![5, 6].includes(d.getUTCDay())) n++;
  }
  return d.toISOString().slice(0, 10);
}
const dayWords = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(/,/g, "");

const FUNCTIONS_IN_R = [
  ...migration(R).matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
].map(m => m[1]);
const SERVICE = [
  "cockpit_clickup_writeback_claim_requests(uuid,integer)",
  "cockpit_request_sweep()",
  "cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)",
  "cockpit_clickup_writeback_task_owners(text[])",
  "cockpit_clickup_requests_state(boolean,text,text,text[],jsonb)",
  "cockpit_request_doctor_inputs()",
  "cockpit_request_type_rt_off(text,text)",
  "cockpit_clickup_members_sync(jsonb)",
  "cockpit_request_field_catalog_sync(jsonb)",
  "cockpit_request_templates_sync(jsonb)",
  "cockpit_request_import(jsonb)",
  "cockpit_clickup_writeback_begin(text,text,boolean)",
  "cockpit_clickup_writeback_idle(text,boolean,text)",
  "cockpit_clickup_writeback_claim(uuid,integer)",
];
const BROWSER = [
  "cockpit_request_types_read()",
  "cockpit_request_clients(text,boolean)",
  "cockpit_request_preview(text,text,jsonb)",
  "cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)",
  "cockpit_request_cancel(uuid,text)",
  "cockpit_requests_read(text,integer)",
  "cockpit_request_get(uuid)",
  "cockpit_request_type_save(text,jsonb,integer)",
  "cockpit_request_type_versions(text)",
  "cockpit_request_type_restore(text,integer,integer)",
  "cockpit_request_people()",
  "cockpit_member_clickup_read()",
  "cockpit_member_clickup_set(uuid,bigint)",
];
const INTERNAL = [
  "cockpit_request_lists()",
  "cockpit_request_team_label(text)",
  "cockpit_request_list_team(text)",
  "cockpit_request_team_order(text)",
  "cockpit_request_teams(text[],boolean)",
  "cockpit_request_audit(text,text,text,text,jsonb,jsonb,jsonb)",
  "cockpit_request_by_label(text)",
  "cockpit_request_seat()",
  "cockpit_request_owner_label(bigint)",
  "cockpit_request_usable_member(bigint)",
  "cockpit_request_person_by_role(text)",
  "cockpit_request_owner(jsonb,text)",
  "cockpit_request_due_default(integer)",
  "cockpit_request_day_words(date)",
  "cockpit_request_type_problem(jsonb)",
  "cockpit_request_field_options(jsonb)",
  "cockpit_request_answered(jsonb)",
  "cockpit_request_answer_display(jsonb,jsonb)",
  "cockpit_request_answer_value(jsonb,jsonb)",
  "cockpit_request_target_runs(jsonb,jsonb)",
  "cockpit_request_step_count(public.cockpit_request_types,jsonb)",
  "cockpit_request_rule_label(jsonb)",
  "cockpit_request_type_view(public.cockpit_request_types,boolean)",
  "cockpit_request_plan(public.cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)",
  "cockpit_request_refresh(uuid)",
  "cockpit_clickup_requests_mode()",
  "cockpit_request_can_send(jsonb,text)",
  "cockpit_clickup_requests_kick()",
  "cockpit_request_part_rank(text,text)",
  "cockpit_request_part_row(public.cockpit_request_parts,jsonb)",
  "cockpit_request_owner_note(text,boolean)",
  "cockpit_request_owner_for(jsonb,boolean)",
  "cockpit_request_send_gate(jsonb,text)",
  "cockpit_request_writer_view(jsonb,text)",
  "cockpit_request_writer_takes(text)",
  "cockpit_request_held(public.cockpit_requests)",
  "cockpit_request_client_visible(public.cockpit_requests,jsonb)",
  "cockpit_request_can_route(public.cockpit_requests,jsonb)",
  "cockpit_request_cancellable(public.cockpit_requests,jsonb)",
  "cockpit_request_row(public.cockpit_requests,jsonb)",
  "cockpit_request_in_view(public.cockpit_requests,text,text,jsonb)",
  "cockpit_request_hash(text,text,jsonb,date,text,text)",
  "cockpit_request_targets_checked(jsonb,jsonb)",
  "cockpit_request_type_at(text,integer)",
  "cockpit_member_clickup_seat(uuid)",
  "cockpit_request_type_guard()",
  "cockpit_request_refuse_delete()",
  "cockpit_member_clickup_audit()",
  "cockpit_request_queue_sync()",
];
const TABLES = [
  "cockpit_request_field_catalog",
  "cockpit_request_templates",
  "cockpit_request_types",
  "cockpit_request_type_versions",
  "cockpit_clickup_members",
  "cockpit_member_clickup",
  "cockpit_requests",
  "cockpit_request_parts",
];
const can = async (role: string, sig: string) =>
  (
    await q<{ ok: boolean }>(
      "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
      [role, `public.${sig}`],
    )
  )[0].ok;

describe("the migrations", () => {
  test("r and s apply twice: the seed is there once", async () => {
    expect(
      await count("SELECT count(*) n FROM public.cockpit_request_types"),
    ).toBe(31);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_request_type_versions",
      ),
    ).toBe(31);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_request_field_catalog",
      ),
    ).toBe(24);
    expect(
      await count("SELECT count(*) n FROM public.cockpit_request_templates"),
    ).toBe(34);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_request_types, jsonb_array_elements(targets)",
      ),
    ).toBe(38);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_request_type_versions WHERE version=1 AND saved_by='migration' AND note=$1",
        ["Seeded 2026-10-26 from docs/requests/request-types.json"],
      ),
    ).toBe(31);
  });

  test("the stored types are the JSON's, each accepted by the guard", async () => {
    const rows = await q(
      "SELECT * FROM public.cockpit_request_types ORDER BY type_index",
    );
    expect(rows.map(r => r.key)).toEqual(
      [...SEED.types]
        .sort((a, b) => a.type_index - b.type_index)
        .map(t => t.key),
    );
    for (const r of rows) {
      const t = seedType(r.key);
      expect({
        type_index: r.type_index,
        label: r.label,
        clickup_option_name: r.clickup_option_name,
        request_type_option_id: r.request_type_option_id,
        team: r.team,
        targets: r.targets,
        fields: r.fields,
        sop_steps: r.sop_steps,
        sop_steps_state: r.sop_steps_state,
        sop_url: r.sop_url,
        due_days: r.due_days,
        priority: r.priority,
        set_request_type: r.set_request_type,
        enabled: r.enabled,
        version: r.version,
        updated_by: r.updated_by,
      }).toEqual({
        type_index: t.type_index,
        label: t.label,
        clickup_option_name: t.clickup_option_name,
        request_type_option_id: t.request_type_option_id,
        team: t.team,
        targets: t.targets,
        fields: t.fields,
        sop_steps: t.sop_steps,
        sop_steps_state: t.sop_steps_state,
        sop_url: t.sop_url,
        due_days: t.due_days,
        priority: t.priority,
        set_request_type: t.set_request_type,
        enabled: t.enabled,
        version: 1,
        updated_by: "migration",
      });
    }
    const v = (
      await q(
        "SELECT \"row\" FROM public.cockpit_request_type_versions WHERE key='client_pause' AND version=1",
      )
    )[0].row;
    expect(v.targets).toEqual(seedType("client_pause").targets);
    expect(v.key).toBe("client_pause");
  });

  test("the queue takes the two new kinds and the runs the requests job; nothing else changed", async () => {
    const defs = await q<{ conname: string; d: string }>(
      "SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname IN ('cockpit_clickup_writeback_queue_kind_check','cockpit_clickup_writeback_runs_job_check') ORDER BY 1",
    );
    for (const k of [
      "decision",
      "manual_change",
      "provider_action",
      "tracking_backlog",
      "billing",
      "request",
      "task_action",
    ])
      expect(defs[0].d).toContain(`'${k}'`);
    for (const k of ["kpi", "log", "dosdonts", "requests"])
      expect(defs[1].d).toContain(`'${k}'`);
    expect(
      await count(
        "SELECT count(*) n FROM pg_constraint WHERE conname='cockpit_clickup_writeback_queue_kind_check'",
      ),
    ).toBe(1);
    const run = await svc<Row>(
      "SELECT public.cockpit_clickup_writeback_begin('requests','dry_run',false) r",
    );
    expect(run.id).toBeTruthy();
    await svc(
      "SELECT public.cockpit_clickup_writeback_finish($1,true,'test') r",
      [run.id],
    ).catch(() => null);
    await svc(
      "SELECT public.cockpit_clickup_writeback_idle('requests',true,'idle') r",
    );
    expect(
      (
        await q(
          "SELECT ok FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests'",
        )
      )[0]?.ok,
    ).toBe(true);
    expect(
      await svcRefused(
        "SELECT public.cockpit_clickup_writeback_begin('forms','dry_run',false)",
      ),
    ).toContain("Unsupported writeback run");
    await modeGone();
  });

  test("browser roles cannot touch the eight tables; the service role only reads them; row security is on", async () => {
    for (const table of TABLES) {
      for (const role of ["anon", "authenticated"])
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"])
          expect(
            (
              await q<{ ok: boolean }>(
                "SELECT has_table_privilege($1,$2,$3) ok",
                [role, `public.${table}`, p],
              )
            )[0].ok,
          ).toBe(false);
      expect(
        (
          await q<{ ok: boolean }>(
            "SELECT has_table_privilege('service_role',$1,'SELECT') ok",
            [`public.${table}`],
          )
        )[0].ok,
      ).toBe(true);
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
        expect(
          (
            await q<{ ok: boolean }>(
              "SELECT has_table_privilege('service_role',$1,$2) ok",
              [`public.${table}`, p],
            )
          )[0].ok,
        ).toBe(false);
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
      await refused(CSM, "SELECT * FROM public.cockpit_requests"),
    ).toContain("permission denied");
    expect(
      await svcRefused("UPDATE public.cockpit_request_types SET label='x'"),
    ).toContain("permission denied");
  });

  test("each function has exactly its grant, and every one is a definer with an empty search path", async () => {
    const listed = [...SERVICE, ...BROWSER, ...INTERNAL].map(s =>
      s.slice(0, s.indexOf("(")),
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect([...new Set(FUNCTIONS_IN_R)].sort()).toEqual([...listed].sort());
    for (const sig of SERVICE) {
      expect(await can("service_role", sig)).toBe(true);
      for (const role of ["anon", "authenticated"])
        expect(await can(role, sig)).toBe(false);
    }
    for (const sig of BROWSER) {
      expect(await can("authenticated", sig)).toBe(true);
      expect(await can("anon", sig)).toBe(false);
      expect(await can("service_role", sig)).toBe(false);
    }
    for (const sig of INTERNAL)
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, sig)).toBe(false);
    const loose = await q<{ p: string }>(
      `SELECT p.oid::regprocedure::text p FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
          AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY(p.proconfig)))`,
      [FUNCTIONS_IN_R],
    );
    expect(loose).toEqual([]);
    expect(
      await count(
        "SELECT count(*) n FROM pg_proc WHERE proname = ANY($1::text[])",
        [FUNCTIONS_IN_R],
      ),
    ).toBe(listed.length);
    // PUBLIC holds no execute right on any of them.
    const open = await q<{ p: string }>(
      `SELECT p.oid::regprocedure::text p FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
              aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[]) AND a.grantee = 0`,
      [FUNCTIONS_IN_R],
    );
    expect(open).toEqual([]);
  });

  test("a request or a type is never deleted", async () => {
    expect(
      await ownerRefused(
        "DELETE FROM public.cockpit_request_types WHERE key='general_tech'",
      ),
    ).toBe("A request type is never deleted. Turn it off instead.");
    expect(
      await ownerRefused("DELETE FROM public.cockpit_request_type_versions"),
    ).toBe("A request type is never deleted. Turn it off instead.");
    expect(
      await ownerRefused("TRUNCATE public.cockpit_request_types CASCADE"),
    ).toBe("A request type is never deleted. Turn it off instead.");
    await q(
      "INSERT INTO public.cockpit_requests(id,type_key,type_version,type_label,requester_label,source,priority,state,imported_task_id,content_hash) VALUES($1,'general_tech',1,'x','the old ClickUp form','import','normal','imported','zzdel1','h')",
      [uid()],
    );
    expect(
      await ownerRefused(
        "DELETE FROM public.cockpit_requests WHERE imported_task_id='zzdel1'",
      ),
    ).toBe("A request is never deleted. Cancel it instead.");
    expect(await ownerRefused("TRUNCATE public.cockpit_request_parts")).toBe(
      "A request is never deleted. Cancel it instead.",
    );
    expect(await ownerRefused("TRUNCATE public.cockpit_requests CASCADE")).toBe(
      "A request is never deleted. Cancel it instead.",
    );
    await q(
      "ALTER TABLE public.cockpit_requests DISABLE TRIGGER cockpit_requests_no_delete",
    );
    await q(
      "DELETE FROM public.cockpit_requests WHERE imported_task_id='zzdel1'",
    );
    await q(
      "ALTER TABLE public.cockpit_requests ENABLE TRIGGER cockpit_requests_no_delete",
    );
  });
});

describe("the type guard", () => {
  const saveRefused = async (who: string, key: string, patch: Row) => {
    const v = (await typeRow(key)).version;
    return refused(
      who,
      "SELECT public.cockpit_request_type_save($1,$2::jsonb,$3)",
      [key, JSON.stringify(patch), v],
    );
  };
  const main = () => seedType("general_tech").targets[0];

  test("refuses a part on a list that is not a team board, a part with the wrong team, a duplicate part and a person rule with nobody", async () => {
    expect(
      await saveRefused(SM, "general_tech", {
        targets: [{ ...main(), list_id: "901816723226", team: "all_tasks" }],
      }),
    ).toBe("The main part needs one of the five team boards.");
    expect(
      await saveRefused(SM, "general_tech", {
        targets: [{ ...main(), team: "ads" }],
      }),
    ).toBe("The Operations / Tech part has the wrong team for its board.");
    expect(
      await saveRefused(SM, "general_tech", {
        targets: [main(), { ...main() }],
      }),
    ).toBe("Two parts share the name main.");
    expect(
      await saveRefused(SM, "general_tech", {
        targets: [{ ...main(), owner_rule: "person", owner_clickup_id: null }],
      }),
    ).toBe("Pick the person who owns the Operations / Tech part.");
    expect(await saveRefused(SM, "general_tech", { targets: [] })).toBe(
      "Pick between 1 and 3 parts.",
    );
    expect(
      await saveRefused(SM, "general_tech", {
        targets: [{ ...main(), owner_rule: "anyone" }],
      }),
    ).toBe("The Operations / Tech part needs an owner rule.");
  });

  test("refuses the wrong questions", async () => {
    const fields = seedType("general_tech").fields;
    expect(
      await saveRefused(SM, "general_tech", {
        fields: fields.filter(f => f.kind !== "deadline"),
      }),
    ).toBe("The form needs exactly one due day question.");
    expect(
      await saveRefused(SM, "general_tech", {
        fields: [...fields, { ...fields[1], key: "details_two" }],
      }),
    ).toBe("The form can have only one details question.");
    expect(
      await saveRefused(SM, "general_tech", {
        fields: [
          ...fields,
          {
            key: "colour",
            label: "Colour",
            kind: "select",
            clickup_field_id: null,
            required: false,
            options: null,
            help: null,
          },
        ],
      }),
    ).toBe("Colour: a choice question needs its choices.");
    expect(
      await saveRefused(SM, "general_tech", {
        fields: [
          ...fields,
          {
            key: "page",
            label: "Page",
            kind: "url",
            clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
            required: false,
            options: null,
            help: null,
          },
        ],
      }),
    ).toBe("Page: the ClickUp field holds a different kind of answer.");
    expect(
      await saveRefused(SM, "general_tech", {
        fields: [
          ...fields,
          {
            key: "page",
            label: "Page",
            kind: "url",
            clickup_field_id: "00000000-0000-4000-8000-000000000999",
            required: false,
            options: null,
            help: null,
          },
        ],
      }),
    ).toBe("Page: that ClickUp field is not in the field list.");
    expect(
      await saveRefused(SM, "general_tech", {
        fields: [...fields, { ...fields[1], key: "details" }],
      }),
    ).toBe("Two questions share the key details.");
  });

  test("a question a part reads to decide when it runs cannot be removed", async () => {
    const t = seedType("low_schedule_rate");
    expect(
      await saveRefused(SM, "low_schedule_rate", {
        fields: t.fields.filter(f => f.key !== "schedule_rate_issue"),
      }),
    ).toBe(
      "The Call Center part uses Where is the problem? to decide when it runs. Change that part first.",
    );
    const when = {
      field_key: "schedule_rate_issue",
      options: ["not-an-option"],
    };
    expect(
      await saveRefused(SM, "low_schedule_rate", {
        targets: [{ ...t.targets[0], when }, t.targets[1]],
      }),
    ).toBe(
      "The Call Center part runs on a choice that is not one of Where is the problem?.",
    );
    expect(
      await saveRefused(SM, "low_schedule_rate", {
        targets: [
          {
            ...t.targets[0],
            when: { field_key: "additional_notes", options: ["x"] },
          },
          t.targets[1],
        ],
      }),
    ).toBe(
      "The Call Center part decides when it runs from Notes, which is not a choice question.",
    );
    expect((await typeRow("low_schedule_rate")).version).toBe(1);
  });

  test("a type keeps its key and its ClickUp option", async () => {
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_request_types SET type_index=99 WHERE key='general_tech'",
      ),
    ).toBe("A request type keeps its key and its ClickUp option.");
    expect((await typeRow("general_tech")).version).toBe(1);
  });
});

const MEMBERS = [
  { id: CU_SM, username: "Huda Manager", email: "SM@tests.invalid" },
  { id: CU_CS, username: "Omar Strategist", email: "creative@tests.invalid" },
  { id: CU_CSM, username: "Noura Success", email: "csm@tests.invalid" },
  { id: CU_BUYER, username: "Bilal Buyer", email: "buyer@tests.invalid" },
  { id: CU_VIDEO, username: "Mona Video", email: "video@tests.invalid" },
  { id: CU_CEO, username: "Aziz W", email: "aziz@maharamedia.com" },
  { id: CU_CALL, username: "Rana Caller", email: "call@tests.invalid" },
  { id: CU_TWIN_A, username: "Sales One", email: "sales@tests.invalid" },
  { id: CU_TWIN_B, username: "Sales Two", email: "sales@tests.invalid" },
  { id: CU_OTHER, username: "Outside Person", email: "outside@tests.invalid" },
];
const membersSync = (list: Row[] = MEMBERS) =>
  svc<Row>("SELECT public.cockpit_clickup_members_sync($1::jsonb) r", [
    JSON.stringify(list),
  ]);
const link = async (uidv: string) =>
  (
    await q("SELECT * FROM public.cockpit_member_clickup WHERE member_id=$1", [
      await memberId(uidv),
    ])
  )[0] ?? null;

describe("seat links", () => {
  test("the hourly read links each seat by exact email: one, none or two members", async () => {
    expect(
      await svcRefused(
        "SELECT public.cockpit_clickup_members_sync('[]'::jsonb)",
      ),
    ).toBe("The ClickUp member list came back empty; nothing was changed.");
    const res = await membersSync();
    expect(res).toEqual({ members: 10, linked: 7, notFound: 2, ambiguous: 1 });
    expect(Number((await link(SM)).clickup_user_id)).toBe(CU_SM);
    expect((await link(SM)).state).toBe("ok");
    expect((await link(SM)).matched_by).toBe("email");
    expect((await link(SALES)).state).toBe("ambiguous");
    expect((await link(SALES)).clickup_user_id).toBeNull();
    expect((await link(PLAIN)).state).toBe("not_found");
    expect(await link(GONE)).toBeNull();
    // The member rows keep the address in lower case.
    expect(
      (
        await q(
          "SELECT email FROM public.cockpit_clickup_members WHERE clickup_user_id=$1",
          [CU_SM],
        )
      )[0].email,
    ).toBe("sm@tests.invalid");
    const linked = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='member_clickup.linked' AND entity_id=$1",
      [await memberId(SM)],
    );
    expect(linked.length).toBe(1);
    expect(linked[0].after.state).toBe("ok");
    expect(linked[0].actor_email).toBe("cockpit-tasks");
    expect(linked[0].source_system).toBe("cron");
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='clickup_members.synced'",
      ),
    ).toBe(1);
    // The same read again changes no link, so it writes no link row.
    await membersSync();
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='member_clickup.linked' AND entity_id=$1",
        [await memberId(SM)],
      ),
    ).toBe(1);
  });

  test("an editor links or clears a seat by hand, and the hourly read never undoes it", async () => {
    expect(
      await refused(CSM, "SELECT public.cockpit_member_clickup_set($1,$2)", [
        await memberId(PLAIN),
        CU_OTHER,
      ]),
    ).toBe(
      "Only the CEO, an admin or someone they add can change notices and routing.",
    );
    expect(
      await refused(VIDEO, "SELECT public.cockpit_member_clickup_set($1,$2)", [
        await memberId(PLAIN),
        123,
      ]),
    ).toBe(
      "That person is not in the ClickUp workspace. Pick someone from the list.",
    );
    const set = await one<Row>(
      VIDEO,
      "SELECT public.cockpit_member_clickup_set($1,$2) r",
      [await memberId(PLAIN), CU_OTHER],
    );
    expect(set.link).toMatchObject({
      state: "manual",
      clickupUserId: CU_OTHER,
      username: "Outside Person",
      matchedBy: "editor",
    });
    expect(set.label).toBe("plain, Video editor");
    const cleared = await one<Row>(
      SM,
      "SELECT public.cockpit_member_clickup_set($1,NULL) r",
      [await memberId(CSM_B)],
    );
    expect(cleared.link).toMatchObject({
      state: "cleared",
      clickupUserId: null,
      matchedBy: "editor",
    });
    await membersSync([
      ...MEMBERS,
      { id: 900000011, username: "CSM B", email: "csm-b@tests.invalid" },
    ]);
    expect((await link(PLAIN)).state).toBe("manual");
    expect((await link(CSM_B)).state).toBe("cleared");
    const rows = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='member_clickup.linked' AND entity_id=$1 ORDER BY created_at",
      [await memberId(PLAIN)],
    );
    expect(rows.at(-1)?.before.state).toBe("not_found");
    expect(rows.at(-1)?.after.state).toBe("manual");
    expect(rows.at(-1)?.actor_email).toBe("video@tests.invalid");
    // A member gone from the read is inactive and no longer offered.
    await membersSync();
    expect(
      (
        await q(
          "SELECT active FROM public.cockpit_clickup_members WHERE clickup_user_id=900000011",
        )
      )[0].active,
    ).toBe(false);
  });

  test("the People in ClickUp tab and the person picker", async () => {
    expect(
      await refused(CSM, "SELECT public.cockpit_member_clickup_read()"),
    ).toBe(
      "Only the CEO, an admin or someone they add can change notices and routing.",
    );
    const read = await one<Row>(
      SM,
      "SELECT public.cockpit_member_clickup_read() r",
    );
    expect(read.seats.length).toBe(10);
    const sm = read.seats.find((s: Row) => s.label === "Huda, Systems manager");
    expect(sm.link).toMatchObject({
      state: "ok",
      clickupUserId: CU_SM,
      username: "Huda Manager",
      matchedBy: "email",
    });
    expect(
      read.seats.find((s: Row) => s.label.startsWith("sales,")).link.state,
    ).toBe("ambiguous");
    expect(
      read.members.find((m: Row) => m.clickupUserId === CU_SM).linkedTo,
    ).toBe(await memberId(SM));
    expect(JSON.stringify(read)).not.toContain("@tests.invalid");
    const people = await one<Row>(
      VIDEO,
      "SELECT public.cockpit_request_people() r",
    );
    expect(people.people.length).toBe(10);
    expect(
      people.people.find((p: Row) => p.clickupUserId === CU_BUYER),
    ).toEqual({
      clickupUserId: CU_BUYER,
      label: "Bilal Buyer",
      seat: { memberId: await memberId(BUYER), label: "Bilal, Media buyer" },
    });
    expect(
      people.people.find((p: Row) => p.clickupUserId === CU_OTHER).seat.label,
    ).toBe("plain, Video editor");
    expect(JSON.stringify(people)).not.toContain("@");
  });
});

describe("owners", () => {
  const owner = async (target: Row, card: string | null = null) =>
    (
      await q<{ r: Row }>(
        "SELECT public.cockpit_request_owner($1::jsonb,$2) r",
        [JSON.stringify(target), card],
      )
    )[0].r;
  const label = async (id: number | null) =>
    (
      await q<{ r: string }>(
        "SELECT public.cockpit_request_owner_label($1) r",
        [id],
      )
    )[0].r;
  const base = {
    part: "main",
    name_suffix: "",
    list_id: "901816723190",
    team: "tech",
    template_id: null,
    template_name: null,
    when: null,
  };

  test("owners are named by role, never by name", async () => {
    expect(await label(CU_SM)).toBe("the systems manager");
    expect(await label(CU_CS)).toBe("the creative strategist");
    expect(await label(CU_CSM)).toBe("the CSM");
    expect(await label(CU_BUYER)).toBe("the media buyer");
    expect(await label(CU_VIDEO)).toBe("a video editor");
    expect(await label(CU_CEO)).toBe("the CEO");
    expect(await label(CU_CALL)).toBe("the call centre agent");
    expect(await label(CU_TWIN_A)).toBe("a team member");
    expect(await label(CU_OTHER)).toBe("a ClickUp member");
    expect(await label(424242)).toBe("a ClickUp member");
  });

  test("the systems manager, the creative strategist and a named person", async () => {
    expect(
      await owner({
        ...base,
        owner_rule: "systems_manager",
        owner_clickup_id: null,
      }),
    ).toEqual({
      clickupId: CU_SM,
      how: "rule",
      label: "the systems manager",
      note: null,
    });
    expect(
      await owner({
        ...base,
        owner_rule: "systems_manager",
        owner_clickup_id: CU_BUYER,
      }),
    ).toEqual({
      clickupId: CU_BUYER,
      how: "named",
      label: "the media buyer",
      note: null,
    });
    expect(
      await owner({
        ...base,
        owner_rule: "creative_strategist",
        owner_clickup_id: null,
      }),
    ).toEqual({
      clickupId: CU_CS,
      how: "rule",
      label: "the creative strategist",
      note: null,
    });
    expect(
      await owner({
        ...base,
        owner_rule: "person",
        owner_clickup_id: CU_VIDEO,
      }),
    ).toEqual({
      clickupId: CU_VIDEO,
      how: "named",
      label: "a video editor",
      note: null,
    });
    // A named person who has left the workspace falls back, visibly.
    expect(
      await owner({
        ...base,
        owner_rule: "person",
        owner_clickup_id: 900000011,
      }),
    ).toEqual({
      clickupId: CU_SM,
      how: "fallback",
      label: "the systems manager",
      note: "Nobody matched this rule, so the systems manager gets it.",
    });
  });

  test("the client's CSM: the card's CSM first, then the named person, then the role", async () => {
    const csm = {
      ...base,
      list_id: "901816723211",
      team: "client_success",
      owner_rule: "csm_of_card",
    };
    expect(await owner({ ...csm, owner_clickup_id: CU_VIDEO }, ACME)).toEqual({
      clickupId: CU_CSM,
      how: "card",
      label: "the CSM",
      note: "The CSM named on the client card.",
    });
    expect(await owner({ ...csm, owner_clickup_id: CU_VIDEO }, BETA)).toEqual({
      clickupId: CU_VIDEO,
      how: "named",
      label: "a video editor",
      note: null,
    });
    expect(await owner({ ...csm, owner_clickup_id: null }, BETA)).toEqual({
      clickupId: CU_CSM,
      how: "rule",
      label: "the CSM",
      note: null,
    });
    expect(await owner({ ...csm, owner_clickup_id: null }, null)).toEqual({
      clickupId: CU_CSM,
      how: "rule",
      label: "the CSM",
      note: null,
    });
  });

  test("the media buyer of record: named, then the Blueprint setting, then the systems manager with a note", async () => {
    const mb = {
      ...base,
      list_id: "901816723196",
      team: "ads",
      owner_rule: "media_buyer_of_record",
    };
    expect(await owner({ ...mb, owner_clickup_id: null })).toEqual({
      clickupId: CU_SM,
      how: "fallback",
      label: "the systems manager",
      note: "No media buyer of record is named on this request type, so the systems manager gets it. Set one in Requests settings.",
    });
    await q(
      "INSERT INTO public.cockpit_blueprint_settings(key,value,updated_by) VALUES('launch_assignee',$1,'test')",
      [String(CU_BUYER)],
    );
    expect(await owner({ ...mb, owner_clickup_id: null })).toEqual({
      clickupId: CU_BUYER,
      how: "rule",
      label: "the media buyer",
      note: null,
    });
    expect(await owner({ ...mb, owner_clickup_id: CU_VIDEO })).toEqual({
      clickupId: CU_VIDEO,
      how: "named",
      label: "a video editor",
      note: null,
    });
    await q(
      "DELETE FROM public.cockpit_blueprint_settings WHERE key='launch_assignee'",
    );
  });

  test("nobody found: no owner, said plainly", async () => {
    await q(
      "UPDATE public.cockpit_people SET active=false WHERE role IN ('Systems manager','Creative strategist')",
    );
    const none = {
      clickupId: null,
      how: "none",
      label: "Nobody yet",
      note: "No owner could be found. The task goes to ClickUp without one; route it there.",
    };
    expect(
      await owner({
        ...base,
        owner_rule: "systems_manager",
        owner_clickup_id: null,
      }),
    ).toEqual(none);
    expect(
      await owner({
        ...base,
        owner_rule: "creative_strategist",
        owner_clickup_id: null,
      }),
    ).toEqual(none);
    expect(
      await owner({
        ...base,
        list_id: "901816723196",
        team: "ads",
        owner_rule: "media_buyer_of_record",
        owner_clickup_id: null,
      }),
    ).toEqual(none);
    await q(
      "UPDATE public.cockpit_people SET active=true WHERE role IN ('Systems manager','Creative strategist')",
    );
    // Two people with one role is no rule at all: the systems manager takes it.
    await q(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES('Second Strategist','creative2@tests.invalid','Creative strategist',true,'test')",
    );
    expect(
      (
        await owner({
          ...base,
          owner_rule: "creative_strategist",
          owner_clickup_id: null,
        })
      ).how,
    ).toBe("fallback");
    await q(
      "UPDATE public.cockpit_people SET active=false WHERE email='creative2@tests.invalid'",
    );
  });
});

describe("the form's reads", () => {
  test("only a signed-in active seat reads requests", async () => {
    const out = await refusedCode(
      null,
      "SELECT public.cockpit_request_types_read()",
    );
    expect(out.message).toContain("permission denied");
    const gone = await refusedCode(
      GONE,
      "SELECT public.cockpit_request_types_read()",
    );
    expect(gone).toEqual({
      message: "Sign in with an active seat to use requests.",
      code: "42501",
    });
  });

  test("types: enabled types for the team in team order; editors see every type and its routing", async () => {
    await mode("apply");
    const csm = await one<Row>(
      CSM,
      "SELECT public.cockpit_request_types_read() r",
    );
    expect(csm.seat).toEqual({
      label: "the CSM",
      link: "linked",
      teams: ["client_success", "call_center"],
      editor: false,
      all: false,
    });
    expect(csm.writer).toEqual({ mode: "apply", canSend: true, held: false, note: null });
    expect(csm.types.length).toBe(31);
    const order = ["client_success", "tech", "ads", "creative", "call_center"];
    const teams = csm.types.map((t: Row) => order.indexOf(t.team));
    expect(teams).toEqual([...teams].sort((a: number, b: number) => a - b));
    expect(csm.types[0].key).toBe("ad_spend_invoice");
    const pause = csm.types.find((t: Row) => t.key === "client_pause");
    expect(pause).toEqual({
      key: "client_pause",
      label: "Client pause",
      team: "tech",
      teamLabel: "Operations / Tech",
      enabled: true,
      dueDays: 2,
      dueDefault: dueDefault(await kuwaitToday(), 2),
      priority: "normal",
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          required: true,
          options: null,
          help: pause.fields[0].help,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          required: true,
          options: null,
          help: pause.fields[1].help,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          required: true,
          options: null,
          help: pause.fields[2].help,
        },
      ],
      parts: [
        {
          part: "tech",
          listName: "Operations / Tech",
          teamLabel: "Operations / Tech",
          ruleLabel: "the systems manager",
          templateName: "Client Pause ⏸️ (Tech)",
          stepCount: null,
          stepsDraft: false,
        },
        {
          part: "media",
          listName: "Marketing / ADs",
          teamLabel: "Marketing / ADs",
          ruleLabel: "the media buyer of record",
          templateName: "Client Pause ⏸️ (Media)",
          stepCount: null,
          stepsDraft: false,
        },
      ],
      sopUrl: seedType("client_pause").sop_url,
    });
    expect(pause.version).toBeUndefined();
    const general = csm.types.find((t: Row) => t.key === "general_csm");
    expect(general.parts[0]).toMatchObject({
      templateName: null,
      stepCount: 5,
      stepsDraft: true,
      ruleLabel: "the client's CSM",
    });
    const ads = csm.types.find((t: Row) => t.key === "create_ad_account");
    expect(ads.fields[1].options.map((o: Row) => o.name)).toEqual([
      "Facebook/Meta",
      "Tiktok",
      "Snapchat",
    ]);
    const editor = await one<Row>(
      VIDEO,
      "SELECT public.cockpit_request_types_read() r",
    );
    expect(editor.seat).toMatchObject({
      editor: true,
      all: true,
      label: "the video editor",
      teams: [],
    });
    const e = editor.types.find((t: Row) => t.key === "client_pause");
    expect(e).toMatchObject({
      version: 1,
      typeIndex: 13,
      clickupOptionName: "Client Pause Request ⏸️",
      setRequestType: false,
      sopStepsState: "none",
      updatedByLabel: "the first setup",
    });
    expect(e.targets).toEqual(seedType("client_pause").targets);
    expect(e.fieldSpecs).toEqual(seedType("client_pause").fields);
    expect(editor.catalog.length).toBe(24);
    expect(
      editor.catalog.find((c: Row) => c.clickupName === "ADs Platform"),
    ).toEqual({
      clickupFieldId: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9",
      clickupName: "ADs Platform",
      label: "Ad platform",
      kind: "select",
      options: SEED.field_catalog[0].options,
      state: "ok",
    });
    expect(editor.templates.length).toBe(34);
    expect(editor.templates[0]).toEqual({
      id: "t-86ex6fpu3",
      name: "Ad Spend Invoice Request 🧾",
      state: "ok",
    });
    expect(csm.catalog).toBeUndefined();
    expect(csm.templates).toBeUndefined();
    expect(pause.fieldSpecs).toBeUndefined();
    const sales = await one<Row>(
      SALES,
      "SELECT public.cockpit_request_types_read() r",
    );
    expect(sales.seat).toEqual({
      label: "a team member",
      link: "not_linked",
      teams: [],
      editor: false,
      all: false,
    });
    const sm = await one<Row>(
      SM,
      "SELECT public.cockpit_request_types_read() r",
    );
    expect(sm.seat).toMatchObject({
      label: "the systems manager",
      teams: ["tech"],
      editor: true,
      all: true,
    });
    const ceo = await one<Row>(
      CEO,
      "SELECT public.cockpit_request_types_read() r",
    );
    expect(ceo.seat).toMatchObject({
      label: "the CEO",
      teams: ["client_success", "tech", "ads", "creative", "call_center"],
      all: true,
    });
  });

  test("clients: the seat's own cards, Stopped and GHOSTED only when asked", async () => {
    const all = await one<Row>(
      CSM,
      "SELECT public.cockpit_request_clients() r",
    );
    expect(all.clients.map((c: Row) => c.name)).toEqual([
      "Acme Interiors",
      "Beta Build",
      "Mahara Test Card",
    ]);
    expect(all.clients[0]).toEqual({
      taskId: ACME,
      name: "Acme Interiors",
      status: "Active",
    });
    expect(all.more).toBe(false);
    const stopped = await one<Row>(
      CSM,
      "SELECT public.cockpit_request_clients(NULL,true) r",
    );
    expect(stopped.clients.map((c: Row) => c.name)).toEqual([
      "Acme Interiors",
      "Beta Build",
      "Delta Homes",
      "Gamma Design",
      "Mahara Test Card",
    ]);
    expect(
      (
        await one<Row>(CSM, "SELECT public.cockpit_request_clients('bet') r")
      ).clients.map((c: Row) => c.taskId),
    ).toEqual([BETA]);
    expect(
      (await one<Row>(CSM, "SELECT public.cockpit_request_clients('100%') r"))
        .clients,
    ).toEqual([]);
    expect(
      (
        await one<Row>(
          CALL,
          "SELECT public.cockpit_request_clients(NULL,true) r",
        )
      ).clients.map((c: Row) => c.taskId),
    ).toEqual([ACME]);
    expect(
      (
        await one<Row>(CSM_B, "SELECT public.cockpit_request_clients() r")
      ).clients.map((c: Row) => c.taskId),
    ).toEqual([BETA]);
  });
});

const NOT_ON =
  "Requests are not switched on yet. Use the ClickUp request form until then.";
// Review 2026-10-26 (F3-F5): editors, admins and the CEO file while requests
// are not open, and the request is held (saved, queued, not sent).
const HELD = "Saved. Requests are not open yet, so this goes to ClickUp once they are.";
const STALE =
  "Saved. The requests writer has not reported in the last 15 minutes, so this goes to ClickUp once it runs with requests open. Check it on the Machine tab.";
const TESTING_CARD =
  "Saved. Requests are being tested on the internal test card only, so this goes to ClickUp once they open to everyone.";
const TESTING =
  "Requests are being tested. They open to everyone soon. Use the ClickUp request form until then.";

describe("who may send, by the writer's mode", () => {
  const writer = async (who: string) =>
    (await one<Row>(who, "SELECT public.cockpit_request_types_read() r"))
      .writer;
  const sendCode = async (who: string, client: string | null) =>
    refusedCode(
      who,
      submitSql,
      submitArgs({ type: "general_tech", client, answers: { details: "x" } }),
    );

  test("never reported, or not for 15 minutes: the team is pointed to ClickUp; an editor's request is held", async () => {
    await modeGone();
    expect(await writer(CSM)).toEqual({
      mode: "unknown",
      canSend: false,
      held: false,
      note: NOT_ON,
    });
    expect(await writer(VIDEO)).toEqual({
      mode: "unknown",
      canSend: true,
      held: true,
      note: STALE,
    });
    expect(await sendCode(CSM, null)).toEqual({
      message: NOT_ON,
      code: "55000",
    });
    const held = await submit(SM, { type: "general_tech", answers: { details: "Held while the writer is quiet" } });
    expect(held).toMatchObject({ state: "sending", held: true, note: STALE });
    await mode("apply");
    await q(
      "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail,'{at}',to_jsonb(now() - interval '16 minutes')) WHERE key='clickup-writeback:requests'",
    );
    expect(
      (
        await q<{ r: Row }>("SELECT public.cockpit_clickup_requests_mode() r")
      )[0].r,
    ).toMatchObject({ mode: "unknown", live: false });
    expect(await writer(CEO)).toEqual({
      mode: "unknown",
      canSend: true,
      held: true,
      note: STALE,
    });
  });

  test("dry run: editors, admins and the CEO file and the request is held, said plainly; everyone else is told to use ClickUp", async () => {
    await mode("dry_run");
    expect(await writer(CSM)).toEqual({
      mode: "dry_run",
      canSend: false,
      held: false,
      note: NOT_ON,
    });
    expect(await writer(SALES)).toEqual({
      mode: "dry_run",
      canSend: false,
      held: false,
      note: NOT_ON,
    });
    for (const who of [VIDEO, SM, CEO])
      expect(await writer(who)).toEqual({
        mode: "dry_run",
        canSend: true,
        held: true,
        note: HELD,
      });
    expect(await sendCode(CALL, ACME)).toEqual({
      message: NOT_ON,
      code: "55000",
    });
    const sent = await submit(VIDEO, {
      type: "general_tech",
      answers: { details: "Check the dry run" },
    });
    expect(sent).toMatchObject({ state: "sending", held: true, note: HELD });
    // The parts wait queued, untried; the list says it is held.
    expect(sent.parts.map((p: Row) => p.state)).toEqual(["queued"]);
    const row = await one<Row>(VIDEO, "SELECT public.cockpit_request_get($1) r", [sent.id]);
    expect(row).toMatchObject({ held: true, heldNote: "Saved, not sent yet. It goes to ClickUp once requests open." });
    // The requests claim takes nothing while the writer reports a dry run.
    expect(await svc("SELECT public.cockpit_clickup_writeback_claim_requests(gen_random_uuid(), 10) r")).toEqual([]);
    expect(
      await count("SELECT count(*) n FROM public.cockpit_clickup_writeback_queue WHERE source_id=$1 AND state='queued' AND attempts=0", [sent.id]),
    ).toBe(1);
    // Once requests open, the same row goes, and the request is no longer held.
    await mode("apply");
    const claimed = await svc<Row[]>("SELECT public.cockpit_clickup_writeback_claim_requests('00000000-0000-4000-8000-00000000c1a1', 10) r");
    expect(claimed.map(c => c.source_id)).toContain(sent.id);
    expect((await one<Row>(VIDEO, "SELECT public.cockpit_request_get($1) r", [sent.id])).held).toBe(false);
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET state='queued', claim_token=NULL, claimed_at=NULL, attempts=0 WHERE claim_token='00000000-0000-4000-8000-00000000c1a1'",
    );
  });

  test("the canary: the team waits; editors, admins and the CEO send on the listed card and file held anywhere else", async () => {
    await mode("apply_limited", [TEST_CARD]);
    expect(
      (
        await q<{ r: Row }>("SELECT public.cockpit_clickup_requests_mode() r")
      )[0].r,
    ).toMatchObject({
      mode: "apply_limited",
      onlyCards: [TEST_CARD],
      live: true,
    });
    expect(await writer(CSM)).toEqual({
      mode: "apply_limited",
      canSend: false,
      held: false,
      note: TESTING,
    });
    expect(await writer(SM)).toEqual({
      mode: "apply_limited",
      canSend: true,
      held: true,
      note: TESTING_CARD,
    });
    expect(await sendCode(CSM, TEST_CARD)).toEqual({
      message: TESTING,
      code: "55000",
    });
    const p = await preview(SM, "general_tech", TEST_CARD, {});
    expect(p.writer).toEqual({ canSend: true, held: false, note: null });
    expect((await preview(SM, "general_tech", ACME, {})).writer).toEqual({
      canSend: true,
      held: true,
      note: TESTING_CARD,
    });
    const sent = await submit(SM, {
      type: "general_tech",
      client: TEST_CARD,
      answers: { details: "Rehearsal" },
    });
    expect(sent).toMatchObject({ state: "sending", held: false, note: null });
    const off = await submit(SM, {
      type: "general_tech",
      client: ACME,
      answers: { details: "Not the canary" },
    });
    expect(off).toMatchObject({ state: "sending", held: true, note: TESTING_CARD });
    // The claim takes the canary card's row only; the other waits queued.
    const claimed = await svc<Row[]>("SELECT public.cockpit_clickup_writeback_claim_requests('00000000-0000-4000-8000-00000000c1a1', 10) r");
    expect(claimed.map(c => c.source_id)).toContain(sent.id);
    expect(claimed.map(c => c.source_id)).not.toContain(off.id);
    expect(claimed.every(c => c.payload.clientTaskId === TEST_CARD)).toBe(true);
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET state='queued', claim_token=NULL, claimed_at=NULL, attempts=0 WHERE claim_token='00000000-0000-4000-8000-00000000c1a1'",
    );
  });

  test("apply: every seat sends", async () => {
    await mode("apply");
    for (const who of [CSM, SALES, CALL, PLAIN])
      expect(await writer(who)).toEqual({
        mode: "apply",
        canSend: true,
        held: false,
        note: null,
      });
  });
});

describe("sending a request", () => {
  test("a CSM's ticket: one part, its owner, one queue row with the frozen payload, an audit row and a kick", async () => {
    await mode("apply");
    const id = uid();
    const today = await kuwaitToday();
    const due = dueDefault(today, 2);
    const sent = await submit(CSM, {
      id,
      type: "general_csm",
      client: ACME,
      answers: { details: "Please call the client back about the launch." },
    });
    expect(sent).toMatchObject({
      id,
      state: "sending",
      reused: false,
      duplicateOf: null,
      note: null,
    });
    expect(sent.parts).toEqual([
      {
        part: "main",
        listName: "Client Success",
        teamLabel: "Client Success",
        taskName: "Acme Interiors - General CSM ticket",
        owner: {
          label: "the CSM",
          how: "card",
          note: "The CSM named on the client card.",
        },
        state: "queued",
        error: null,
        url: null,
        status: null,
        statusType: null,
        verifyState: null,
        verifyNote: null,
      },
    ]);
    const r = await request(id);
    expect(r).toMatchObject({
      type_key: "general_csm",
      type_version: 1,
      type_label: "General CSM ticket",
      requester_member_id: await memberId(CSM),
      requester_email: "csm@tests.invalid",
      requester_label: "the CSM",
      source: "requests_page",
      client_task_id: ACME,
      client_name: "Acme Interiors",
      priority: "normal",
      state: "sending",
      done_at: null,
    });
    expect(r.due_on.toISOString().slice(0, 10)).toBe(due);
    const [part] = await parts(id);
    expect(part).toMatchObject({
      list_id: "901816723211",
      team: "client_success",
      owner_rule: "csm_of_card",
      owner_how: "card",
      state: "queued",
      template_id: null,
    });
    expect(Number(part.owner_clickup_id)).toBe(CU_CSM);
    const rows = await queueRows(id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      kind: "request",
      dedupe_key: `request:${id}:main`,
      source_table: "cockpit_requests",
      source_id: id,
      campaign_name: null,
      state: "queued",
      task_id: null,
    });
    expect(part.queue_id).toBe(rows[0].id);
    const hex = id.replace(/-/g, "").slice(0, 10);
    const url = `https://cockpit.maharamedia.com/requests?id=${id}`;
    const t = seedType("general_csm");
    expect(rows[0].payload).toEqual({
      requestId: id,
      part: "main",
      ref: `R-${hex}-main`,
      typeKey: "general_csm",
      typeLabel: "General CSM ticket",
      typeVersion: 1,
      requestTypeOptionId: t.request_type_option_id,
      requestTypeOptionName: t.clickup_option_name,
      setRequestType: false,
      listId: "901816723211",
      listName: "Client Success",
      templateId: null,
      templateName: null,
      taskName: "Acme Interiors - General CSM ticket",
      descriptionMarkdown: [
        `**General CSM ticket** for Acme Interiors\nRequested by the CSM in the cockpit on ${dayWords(today)}. Due ${dayWords(due)}. Priority normal.`,
        "Please call the client back about the launch.",
        `SOP steps are a draft until the systems manager checks them.\nClient card: https://app.clickup.com/t/${ACME}\nRequest in the cockpit: ${url}`,
      ].join("\n\n"),
      sopSteps: t.sop_steps,
      sopChecklistName: "SOP steps (draft)",
      sopStepsWhen: "always",
      clientTaskId: ACME,
      clientName: "Acme Interiors",
      clientTag: "acme interiors",
      ownerClickupId: CU_CSM,
      ownerLabel: "the CSM",
      dueOn: due,
      dueMs: Date.parse(`${due}T09:00:00Z`),
      priority: "normal",
      priorityValue: 3,
      fields: [],
      replacesTaskId: null,
      requesterLabel: "the CSM",
      requestUrl: url,
    });
    const audit = (await audits(id)).filter(
      a => a.action === "request.submitted",
    );
    expect(audit.length).toBe(1);
    expect(audit[0]).toMatchObject({
      entity_type: "cockpit_requests",
      actor_email: "csm@tests.invalid",
      source_app: "shared-cockpits",
      source_system: "supabase",
    });
    expect(audit[0].metadata).toEqual({
      type: "general_csm",
      type_version: 1,
      source: "requests_page",
      parts: ["main"],
      owners: ["the CSM"],
    });
    expect(audit[0].before).toBeNull();
    expect(audit[0].after.id).toBe(id);
    // No vault and no pg_net here: the kick says so and the request still went in.
    expect(
      (
        await q(
          "SELECT ok, note FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests-kick'",
        )
      )[0],
    ).toEqual({
      ok: false,
      note: "The vault has no cockpit_sync_secret, so the requests writer was not started. Add it to the vault.",
    });
  });

  test("the same press again returns what it made; other answers under the same id are refused", async () => {
    const id = uid();
    const s: Submit = {
      id,
      type: "general_csm",
      client: BETA,
      answers: { details: "Card on file is expiring." },
      priority: "high",
    };
    const first = await submit(CSM, s);
    const before = await count(
      "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue",
    );
    const again = await submit(CSM, s);
    expect(again).toMatchObject({ id, reused: true, state: first.state });
    expect(again.parts).toEqual(first.parts);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue",
      ),
    ).toBe(before);
    expect(
      await submitRefused(CSM, {
        ...s,
        answers: { details: "Something else" },
      }),
    ).toBe(
      "This request was already sent with other answers. Reload the form and send again.",
    );
    expect(await submitRefused(SM, s)).toBe(
      "This request was already sent with other answers. Reload the form and send again.",
    );
    expect((await request(id)).priority).toBe("high");
  });

  test("a call centre seat raises requests for its own clients only", async () => {
    const sent = await submit(CALL, {
      type: "low_show_rate",
      client: ACME,
      answers: { additional_notes: "Show rate fell this week" },
    });
    expect(sent.parts[0]).toMatchObject({
      listName: "Call Center",
      taskName: "Acme Interiors - Low show rate",
      owner: { how: "card", label: "the CSM" },
    });
    const row = await request(sent.id);
    expect(row.requester_label).toBe("a team member");
    expect(
      await submitRefused(CALL, { type: "low_show_rate", client: BETA }),
    ).toBe("You cannot raise a request for this client.");
    expect(
      await refused(
        CALL,
        "SELECT public.cockpit_request_preview('low_show_rate',$1)",
        [BETA],
      ),
    ).toBe("You cannot raise a request for this client.");
    expect(
      await submitRefused(CSM_B, { type: "low_show_rate", client: ACME }),
    ).toBe("You cannot raise a request for this client.");
  });

  test("a sales seat raises a request with no client", async () => {
    const sent = await submit(SALES, {
      type: "general_tech",
      answers: { details: "The dialer will not load." },
    });
    const [p] = await queueRows(sent.id);
    expect(p.payload.taskName).toBe(
      "General tech request - from a team member",
    );
    expect(
      p.payload.descriptionMarkdown.startsWith(
        "**General tech request** for no client\nRequested by a team member in the cockpit",
      ),
    ).toBe(true);
    expect(p.payload.descriptionMarkdown).not.toContain("Client card:");
    expect(p.payload).toMatchObject({
      clientTaskId: null,
      clientName: null,
      clientTag: null,
      ownerClickupId: CU_SM,
      ownerLabel: "the systems manager",
      priority: "normal",
      priorityValue: 3,
    });
    expect(sent.parts[0].owner).toEqual({
      label: "the systems manager",
      how: "named",
      note: null,
    });
  });

  test("answers are checked in the form's order, each with one sentence", async () => {
    const ns = (answers: Row, extra: Partial<Submit> = {}) =>
      submitRefused(CREATIVE, {
        type: "new_script",
        client: ACME,
        answers,
        ...extra,
      });
    const ok = {
      script_type: optionFor("new_script", "script_type", "Paid Ads Reel"),
      orientation: optionFor("new_script", "orientation", "Vertical 9:16"),
      script_quantity: 3,
      who_films: optionFor("new_script", "who_films", "Us"),
      script_language: optionFor("new_script", "script_language", "Arabic"),
    };
    expect(await ns({})).toBe("What are we writing?: pick one.");
    expect(await ns({ ...ok, script_type: "not-an-option" })).toBe(
      "What are we writing?: pick one of the choices.",
    );
    expect(await ns({ ...ok, script_quantity: "three" })).toBe(
      "How many scripts?: enter a whole number from 0 to 1000.",
    );
    expect(await ns({ ...ok, script_quantity: 1001 })).toBe(
      "How many scripts?: enter a whole number from 0 to 1000.",
    );
    expect(await ns({ ...ok, additional_notes: "x".repeat(501) })).toBe(
      "Notes: keep it under 500 characters.",
    );
    expect(await ns({ ...ok, client: ACME })).toBe(
      "Send the client, the due day and the priority on their own, not with the answers.",
    );
    expect(await ns({ ...ok, colour: "red" })).toBe(
      "One answer is not a question of this request type. Reload the form and send again.",
    );
    expect(await ns(ok, { due: await kuwaitPlus(-1) })).toBe(
      "Pick today or a later day.",
    );
    expect(await ns(ok, { due: await kuwaitPlus(400) })).toBe(
      "Pick a day within the next year.",
    );
    expect(await ns(ok, { priority: "whenever" })).toBe(
      "Priority: pick urgent, high, normal or low.",
    );
    expect(await ns(ok, { source: "slack" })).toBe(
      "Send requests from the Requests page or a client page.",
    );
    expect(
      await submitRefused(CREATIVE, {
        type: "whatsapp_reactivation",
        client: ACME,
        answers: { lead_list: "drive folder" },
      }),
    ).toBe(
      "Lead list link: paste a link that starts with http:// or https://.",
    );
    expect(
      await submitRefused(CREATIVE, {
        type: "dfy_to_dwy",
        client: ACME,
        answers: { details: "x".repeat(4001) },
      }),
    ).toBe("Details: keep it under 4000 characters.");
    expect(
      await submitRefused(CREATIVE, {
        type: "dfy_to_dwy",
        client: ACME,
        answers: { details: "   " },
      }),
    ).toBe("Details: fill this in.");
    expect(
      await submitRefused(CREATIVE, { type: "low_show_rate", answers: {} }),
    ).toBe("Client: pick a client.");
    expect(await submitRefused(CREATIVE, { type: "no_such_type" })).toBe(
      "That request type does not exist. Reload the form.",
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_requests WHERE requester_member_id=$1",
        [await memberId(CREATIVE)],
      ),
    ).toBe(0);
    // All good: the ClickUp fields go with the task, each with what it shows.
    const sent = await submit(CREATIVE, {
      type: "new_script",
      client: ACME,
      answers: { ...ok, additional_notes: "Two hooks please" },
      source: "client_page",
    });
    const [row] = await queueRows(sent.id);
    expect(row.payload.fields).toEqual([
      {
        fieldId: fieldOf("new_script", "script_type").clickup_field_id,
        kind: "select",
        value: ok.script_type,
        label: "What are we writing?",
        display: "Paid Ads Reel",
      },
      {
        fieldId: fieldOf("new_script", "orientation").clickup_field_id,
        kind: "select",
        value: ok.orientation,
        label: "Orientation",
        display: "Vertical 9:16",
      },
      {
        fieldId: fieldOf("new_script", "script_quantity").clickup_field_id,
        kind: "number",
        value: 3,
        label: "How many scripts?",
        display: "3",
      },
      {
        fieldId: fieldOf("new_script", "who_films").clickup_field_id,
        kind: "select",
        value: ok.who_films,
        label: "Who films it?",
        display: "Us",
      },
      {
        fieldId: fieldOf("new_script", "script_language").clickup_field_id,
        kind: "select",
        value: ok.script_language,
        label: "Script language",
        display: "Arabic",
      },
      {
        fieldId: fieldOf("new_script", "additional_notes").clickup_field_id,
        kind: "text",
        value: "Two hooks please",
        label: "Notes",
        display: "Two hooks please",
      },
    ]);
    expect(row.payload.descriptionMarkdown).toContain(
      "- What are we writing?: Paid Ads Reel\n- Orientation: Vertical 9:16\n- How many scripts?: 3\n- Who films it?: Us\n- Script language: Arabic\n- Notes: Two hooks please",
    );
    expect(row.payload.descriptionMarkdown).toContain(
      `SOP: ${seedType("new_script").sop_url}`,
    );
    expect(row.payload).toMatchObject({
      templateId: "t-86ex63j6n",
      templateName: "New Script Request✍️",
      sopSteps: null,
      sopStepsWhen: null,
      sopChecklistName: null,
      ownerLabel: "the creative strategist",
    });
    expect((await request(sent.id)).source).toBe("client_page");
  });

  test("a type that is turned off takes no requests", async () => {
    const v = (await typeRow("company_address")).version;
    await one(
      SM,
      "SELECT public.cockpit_request_type_save('company_address','{\"enabled\":false}'::jsonb,$1) r",
      [v],
    );
    expect(
      await submitRefused(CSM, {
        type: "company_address",
        client: ACME,
        answers: { new_company_address: "Block 3" },
      }),
    ).toBe(
      "This request type is turned off. Pick another or ask the systems manager.",
    );
    expect(
      (await one<Row>(CSM, "SELECT public.cockpit_request_types_read() r"))
        .types.length,
    ).toBe(30);
    expect(
      (await one<Row>(SM, "SELECT public.cockpit_request_types_read() r")).types
        .length,
    ).toBe(31);
    await one(
      SM,
      "SELECT public.cockpit_request_type_save('company_address','{\"enabled\":true}'::jsonb,$1) r",
      [v + 1],
    );
  });

  test("one open lifecycle request per card", async () => {
    const first = await submit(SM, { type: "client_pause", client: BETA });
    expect(
      first.parts.map((p: Row) => [
        p.part,
        p.listName,
        p.taskName,
        p.owner.how,
      ]),
    ).toEqual([
      [
        "tech",
        "Operations / Tech",
        "Beta Build - Client pause (Tech)",
        "named",
      ],
      [
        "media",
        "Marketing / ADs",
        "Beta Build - Client pause (Media)",
        "fallback",
      ],
    ]);
    // D12: the "set one" instruction is for editors (the systems manager here);
    // anyone else reads a plain owner line, on the preview and on the request.
    expect(first.parts[1].owner.note).toBe(
      "No media buyer of record is named on this request type, so the systems manager gets it. Set one in Requests settings.",
    );
    const csmPreview = await preview(CSM, "client_pause", BETA, {});
    expect(csmPreview.parts[1].owner.note).toBe("Goes to the systems manager.");
    expect((await preview(SM, "client_pause", BETA, {})).parts[1].owner.note).toMatch(/Set one in Requests settings\.$/);
    expect(
      (await one<Row>(BUYER, "SELECT public.cockpit_request_get($1) r", [first.id])).parts[1].owner.note,
    ).toBe("Goes to the systems manager.");
    const rows = await queueRows(first.id);
    expect(
      rows.map(r => [
        r.dedupe_key,
        r.payload.templateId,
        r.payload.replacesTaskId,
      ]),
    ).toEqual([
      [`request:${first.id}:media`, "t-86ex63qm7", null],
      [`request:${first.id}:tech`, "t-86ex63qk5", null],
    ]);
    const before = await count(
      "SELECT count(*) n FROM public.cockpit_requests",
    );
    const again = await submit(CSM, { type: "client_pause", client: BETA });
    expect(again).toEqual({
      held: false,
      id: null,
      state: "duplicate",
      reused: false,
      duplicateOf: first.id,
      parts: [],
      note: "An open client pause request for Beta Build already exists. Open it instead.",
    });
    expect(await count("SELECT count(*) n FROM public.cockpit_requests")).toBe(
      before,
    );
    // Another card, or another lifecycle type, is fine.
    expect(
      (await submit(SM, { type: "client_relaunch", client: BETA })).state,
    ).toBe("sending");
  });

  test("a part runs only when its choice holds; the preview always matches the send", async () => {
    const issue = optionFor("low_schedule_rate", "schedule_rate_issue", "Both");
    expect(issue).toBe(OPT_BOTH);
    const none = await preview(CSM, "low_schedule_rate", ACME, {});
    expect(none.parts).toEqual([]);
    expect(none.note).toBe("Pick Where is the problem? to see where it goes.");
    expect(none.dueDefault).toBe(dueDefault(await kuwaitToday(), 3));
    for (const [answer, expected] of [
      [OPT_BOTH, ["call_center", "ads"]],
      [OPT_ADS_ISSUE, ["ads"]],
      [OPT_CALL_ISSUE, ["call_center"]],
    ] as const) {
      const answers = { schedule_rate_issue: answer };
      const p = await preview(CSM, "low_schedule_rate", ACME, answers);
      expect(p.parts.map((x: Row) => x.part)).toEqual(expected);
      expect(p.note).toBeNull();
      const sent = await submit(CSM, {
        type: "low_schedule_rate",
        client: ACME,
        answers,
      });
      const stored = await parts(sent.id);
      expect(stored.map(x => x.part)).toEqual(expected);
      expect(
        p.parts.map((x: Row) => ({
          part: x.part,
          listName: x.listName,
          taskName: x.taskName,
          templateName: x.templateName,
          owner: x.owner,
        })),
      ).toEqual(
        stored.map((x, i) => ({
          part: x.part,
          listName: sent.parts[i].listName,
          taskName: x.task_name,
          templateName: x.template_name,
          owner: {
            clickupId:
              x.owner_clickup_id === null ? null : Number(x.owner_clickup_id),
            how: x.owner_how,
            label: x.owner_label,
            // The CSM is not an editor: the "set one" line is for editors (D12).
            note: x.owner_note?.includes("Set one in Requests settings.") ? "Goes to the systems manager." : x.owner_note,
          },
        })),
      );
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue WHERE source_id=$1 AND kind='request'",
          [sent.id],
        ),
      ).toBe(expected.length);
    }
    const both = await preview(CSM, "low_schedule_rate", ACME, {
      schedule_rate_issue: OPT_BOTH,
    });
    expect(
      both.parts.map((x: Row) => [x.taskName, x.templateName, x.owner.label]),
    ).toEqual([
      [
        "Acme Interiors - Low schedule rate (Call Center)",
        "Low Schedule Rate📉 (Call Center)",
        "the CSM",
      ],
      [
        "Acme Interiors - Low schedule rate (Ads)",
        "Low Schedule Rate📉 (Ads)",
        "the systems manager",
      ],
    ]);
  });

  test("an ad account request picks its template by platform", async () => {
    const sent = await submit(BUYER, {
      type: "create_ad_account",
      client: ACME,
      answers: { ads_platform: OPT_TIKTOK },
    });
    expect(sent.parts.map((p: Row) => p.part)).toEqual(["tiktok"]);
    const [row] = await queueRows(sent.id);
    expect(row.payload).toMatchObject({
      part: "tiktok",
      templateId: "t-86ex6ee7a",
      templateName: "Create TikTok Ad Account 🎵",
      taskName: "Acme Interiors - Create an ad account",
    });
    expect(row.payload.fields).toEqual([
      {
        fieldId: fieldOf("create_ad_account", "ads_platform").clickup_field_id,
        kind: "select",
        value: OPT_TIKTOK,
        label: "Ad platform",
        display: "Tiktok",
      },
    ]);
  });

  test("a template with no checklist of its own gets the SOP steps only when ClickUp shows none", async () => {
    const sent = await submit(CSM, {
      type: "whatsapp_connection",
      client: ACME,
    });
    const [row] = await queueRows(sent.id);
    const t = seedType("whatsapp_connection");
    expect(row.payload).toMatchObject({
      templateId: "t-86ex62m1b",
      sopSteps: t.sop_steps,
      sopStepsWhen: "if_template_empty",
      sopChecklistName: "SOP steps",
      priority: "high",
      priorityValue: 2,
    });
    expect(row.payload.descriptionMarkdown).toContain(
      `SOP: ${t.sop_url}\nClient card:`,
    );
    expect(row.payload.descriptionMarkdown).not.toContain("draft");
    const types = (
      await one<Row>(CSM, "SELECT public.cockpit_request_types_read() r")
    ).types;
    expect(
      types.find((x: Row) => x.key === "whatsapp_connection").parts[0],
    ).toMatchObject({ stepCount: null, stepsDraft: false });
  });
});

const queueOf = async (id: string, part = "main") =>
  (
    await q(
      "SELECT * FROM public.cockpit_clickup_writeback_queue WHERE dedupe_key=$1",
      [`request:${id}:${part}`],
    )
  )[0];
const verifyOf = async (id: string, part = "main") =>
  (
    await q(
      "SELECT * FROM public.cockpit_clickup_writeback_queue WHERE dedupe_key=$1",
      [`verify:${id}:${part}`],
    )
  )[0] ?? null;
const partOf = async (id: string, part = "main") =>
  (
    await q(
      "SELECT * FROM public.cockpit_request_parts WHERE request_id=$1 AND part=$2",
      [id, part],
    )
  )[0];
/** Holds every queue row but the named ones, so a claim sees only what a test is about. */
const holdAllBut = (ids: string[]) =>
  q(
    "UPDATE public.cockpit_clickup_writeback_queue SET next_attempt_at = now() + interval '1 day' WHERE NOT (id = ANY($1::uuid[])) AND state IN ('queued','retry','unknown')",
    [ids],
  );
const claimRequests = (limit = 6) =>
  svc<Row[]>(
    "SELECT public.cockpit_clickup_writeback_claim_requests($1,$2) r",
    [uid(), limit],
  );

describe("the writeback queue", () => {
  test("the deployed log claim never takes a request or a task action; the requests claim takes only those", async () => {
    const sent = await submit(SM, {
      type: "general_tech",
      answers: { details: "Claim test" },
    });
    const reqRow = await queueOf(sent.id);
    await q(
      "INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,payload) VALUES('tb:claim-test','tracking_backlog','x','claim-test','{\"n\":1}'::jsonb)",
    );
    const tb = (
      await q(
        "SELECT id FROM public.cockpit_clickup_writeback_queue WHERE dedupe_key='tb:claim-test'",
      )
    )[0].id;
    await holdAllBut([reqRow.id, tb]);
    const old = await svc<Row[]>(
      "SELECT public.cockpit_clickup_writeback_claim($1,50) r",
      [uid()],
    );
    expect(old.map(x => x.id)).toEqual([tb]);
    const mine = await claimRequests();
    expect(mine.map(x => [x.id, x.kind, x.source_exists, x.state])).toEqual([
      [reqRow.id, "request", true, "sending"],
    ]);
    expect(mine[0].payload.requestId).toBe(sent.id);
    expect(
      await svcRefused(
        "SELECT public.cockpit_clickup_writeback_claim_requests(NULL,6)",
      ),
    ).toBe("A claim token is required");
    expect(
      await refused(
        SM,
        "SELECT public.cockpit_clickup_writeback_claim_requests($1,6)",
        [uid()],
      ),
    ).toContain("permission denied");
    // Leave it as the writer would after a dry run.
    await svc(
      'SELECT public.cockpit_clickup_writeback_save($1,$2,\'{"state":"dry_run","planned":[]}\'::jsonb) r',
      [reqRow.id, mine[0].claim_token],
    );
    expect((await partOf(sent.id)).state).toBe("dry_run");
    expect((await request(sent.id)).state).toBe("dry_run");
  });

  test("one lane per ClickUp task: a newer row waits while an older one for the same task is open", async () => {
    const ins = (key: string, task: string, minutesAgo: number) =>
      q(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload,created_at)
         VALUES($1,'task_action','cockpit_task_mirror',$2,$2,'{"op":"comment"}'::jsonb, now() - $3 * interval '1 minute') RETURNING id`,
        [key, task, minutesAgo],
      );
    const a1 = (await ins("task:lane-a1", "cu-lane-a", 5))[0].id;
    const a2 = (await ins("task:lane-a2", "cu-lane-a", 3))[0].id;
    const b1 = (await ins("task:lane-b1", "cu-lane-b", 4))[0].id;
    await holdAllBut([a1, a2, b1]);
    const first = await claimRequests(10);
    expect(first.map(x => x.id)).toEqual([a1, b1]);
    expect(first.every(x => x.source_exists === true)).toBe(true);
    expect(await claimRequests(10)).toEqual([]);
    await svc(
      'SELECT public.cockpit_clickup_writeback_save($1,$2,\'{"state":"delivered"}\'::jsonb) r',
      [a1, first[0].claim_token],
    );
    expect((await claimRequests(10)).map(x => x.id)).toEqual([a2]);
  });

  test("a two-minute check not yet due holds no press on its task; once due, it goes first", async () => {
    const verify = (
      await q(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload,created_at,next_attempt_at)
         VALUES('verify:lane-v','task_action','cockpit_requests','lane-v','cu-lane-v','{"op":"verify"}'::jsonb,
                now() - interval '1 minute', now() + interval '1 minute') RETURNING id`,
      )
    )[0].id;
    const press = (
      await q(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload)
         VALUES('task:lane-v-press','task_action','cockpit_task_mirror','cu-lane-v','cu-lane-v','{"op":"tick"}'::jsonb) RETURNING id`,
      )
    )[0].id;
    await holdAllBut([verify, press]);
    // The check is due in a minute, the press now.
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET next_attempt_at = CASE WHEN id=$1 THEN now() + interval '1 minute' ELSE now() END WHERE id IN ($1,$2)",
      [verify, press],
    );
    const first = await claimRequests(10);
    expect(first.map(x => x.id)).toEqual([press]);
    await svc(
      'SELECT public.cockpit_clickup_writeback_save($1,$2,\'{"state":"delivered"}\'::jsonb) r',
      [press, first[0].claim_token],
    );
    // A second press waits behind the check once the check is due.
    const later = (
      await q(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload)
         VALUES('task:lane-v-later','task_action','cockpit_task_mirror','cu-lane-v','cu-lane-v','{"op":"comment"}'::jsonb) RETURNING id`,
      )
    )[0].id;
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET next_attempt_at = now() - interval '1 second' WHERE id = $1",
      [verify],
    );
    expect((await claimRequests(10)).map(x => x.id)).toEqual([verify]);
    expect(later).toBeTruthy();
  });

  test("the writer's moves carry to the part and the request, for every state", async () => {
    const sent = await submit(SM, {
      type: "general_tech",
      answers: { details: "State walk" },
    });
    const row = await queueOf(sent.id);
    await holdAllBut([row.id]);
    await writerMoves(row.id, [
      {
        state: "sending",
        progress: { steps: { create: { state: "started" } } },
      },
      {
        state: "retry",
        error: "ClickUp asked to wait (429).",
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      },
    ]);
    expect(await partOf(sent.id)).toMatchObject({
      state: "retry",
      error: "ClickUp asked to wait (429).",
    });
    expect((await request(sent.id)).state).toBe("sending");
    await writerMoves(row.id, [
      { state: "unknown", error: "ClickUp did not answer." },
    ]);
    expect((await partOf(sent.id)).state).toBe("unknown");
    expect((await request(sent.id)).state).toBe("sending");
    // Cancelling is refused once ClickUp may already have it.
    expect(
      await refused(
        SM,
        "SELECT public.cockpit_request_cancel($1,'No longer needed')",
        [sent.id],
      ),
    ).toBe("Part of this request is already in ClickUp. Close it there.");
    await writerMoves(row.id, [
      { task_id: "cu-walk-1" },
      {
        state: "delivered",
        task_id: "cu-walk-1",
        progress: {
          task: { id: "cu-walk-1", url: "https://app.clickup.com/t/cu-walk-1" },
        },
        error: null,
        delivered_at: new Date().toISOString(),
      },
    ]);
    expect(await partOf(sent.id)).toMatchObject({
      state: "delivered",
      error: null,
      clickup_task_id: "cu-walk-1",
      clickup_url: "https://app.clickup.com/t/cu-walk-1",
    });
    expect((await request(sent.id)).state).toBe("delivered");
    expect(
      await refused(
        SM,
        "SELECT public.cockpit_request_cancel($1,'No longer needed')",
        [sent.id],
      ),
    ).toBe("Part of this request is already in ClickUp. Close it there.");
    const verify = await verifyOf(sent.id);
    expect(verify).toMatchObject({
      kind: "task_action",
      source_table: "cockpit_requests",
      source_id: sent.id,
      task_id: "cu-walk-1",
      state: "queued",
    });
    expect(new Date(verify.next_attempt_at).getTime()).toBeGreaterThan(
      Date.now() + 60_000,
    );
    expect(verify.payload).toEqual({
      op: "verify",
      requestId: sent.id,
      part: "main",
      taskId: "cu-walk-1",
      listId: "901816723190",
      taskName: "General tech request - from the systems manager",
      ownerClickupId: CU_SM,
      typeKey: "general_tech",
      setRequestType: false,
      clientTaskId: null,
    });
    // A second delivery report never makes a second check.
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() WHERE id=$1",
      [row.id, uid()],
    );
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET state='delivered', claim_token=NULL, claimed_at=NULL WHERE id=$1",
      [row.id],
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue WHERE dedupe_key=$1",
        [`verify:${sent.id}:main`],
      ),
    ).toBe(1);
    // The 2-minute check records what it found on the part.
    await writerMoves(verify.id, [
      {
        state: "delivered",
        progress: {
          verify: "restored",
          verifyNote:
            "A ClickUp rule removed the owner; the cockpit put them back.",
        },
      },
    ]);
    expect(await partOf(sent.id)).toMatchObject({
      verify_state: "restored",
      verify_note:
        "A ClickUp rule removed the owner; the cockpit put them back.",
    });
    expect((await request(sent.id)).state).toBe("delivered");
    const row2 = await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [
      sent.id,
    ]);
    expect(row2.parts[0]).toMatchObject({
      state: "delivered",
      url: "https://app.clickup.com/t/cu-walk-1",
      verifyState: "restored",
    });
    expect(row2.canCancel).toBe(false);
    expect(row2.history.map((h: Row) => h.what)).toEqual(
      expect.arrayContaining([
        "Sent from the cockpit",
        "Operations / Tech: ClickUp asked to wait, trying again",
        "Operations / Tech: made in ClickUp",
        "Operations / Tech: owner checked two minutes after it was made",
      ]),
    );
  });

  test("a check that finds the owner removed again, or a failed, skipped or dry-run part", async () => {
    const removed = await submit(SM, {
      type: "general_tech",
      answers: { details: "Removed owner" },
    });
    const r1 = await queueOf(removed.id);
    await holdAllBut([r1.id]);
    await writerMoves(r1.id, [
      {
        state: "delivered",
        task_id: "cu-removed-1",
        progress: {
          task: {
            id: "cu-removed-1",
            url: "https://app.clickup.com/t/cu-removed-1",
          },
        },
      },
    ]);
    const v = await verifyOf(removed.id);
    await writerMoves(v.id, [
      {
        state: "failed",
        error: "A ClickUp rule on Operations / Tech keeps removing the owner.",
        progress: { verify: "removed" },
      },
    ]);
    expect(await partOf(removed.id)).toMatchObject({
      verify_state: "removed",
      verify_note:
        "A ClickUp rule on Operations / Tech keeps removing the owner.",
    });
    for (const [state, error, expected] of [
      ["failed", "ClickUp said 400: list not found", "failed"],
      [
        "skipped",
        "The request was cancelled before it reached ClickUp.",
        "failed",
      ],
      ["dry_run", null, "dry_run"],
    ] as const) {
      const s = await submit(SM, {
        type: "general_tech",
        answers: { details: `Walk ${state}` },
      });
      const qr = await queueOf(s.id);
      await holdAllBut([qr.id]);
      await writerMoves(qr.id, [{ state, ...(error ? { error } : {}) }]);
      expect(await partOf(s.id)).toMatchObject({ state, error });
      expect((await request(s.id)).state).toBe(expected);
    }
  });

  test("a two-part request with one part in ClickUp and one not is partial", async () => {
    const s = await submit(SM, { type: "client_relaunch", client: ACME });
    const tech = await queueOf(s.id, "tech");
    const media = await queueOf(s.id, "media");
    await holdAllBut([tech.id, media.id]);
    await writerMoves(tech.id, [
      {
        state: "delivered",
        task_id: "cu-relaunch-tech",
        progress: {
          task: {
            id: "cu-relaunch-tech",
            url: "https://app.clickup.com/t/cu-relaunch-tech",
          },
        },
      },
    ]);
    expect((await request(s.id)).state).toBe("sending");
    await writerMoves(media.id, [
      { state: "failed", error: "ClickUp said 403" },
    ]);
    expect((await request(s.id)).state).toBe("partial");
    const row = await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [
      s.id,
    ]);
    expect(row.parts.map((p: Row) => [p.part, p.state])).toEqual([
      ["tech", "delivered"],
      ["media", "failed"],
    ]);
  });

  test("the mirror's status marks a request done, and a reopened part clears it", async () => {
    const s = await submit(SM, {
      type: "general_tech",
      answers: { details: "Done walk" },
    });
    const qr = await queueOf(s.id);
    await holdAllBut([qr.id]);
    await writerMoves(qr.id, [
      {
        state: "delivered",
        task_id: "cu-done-1",
        progress: {
          task: { id: "cu-done-1", url: "https://app.clickup.com/t/cu-done-1" },
        },
      },
    ]);
    await q(
      "UPDATE public.cockpit_request_parts SET status='complete', status_type='done', mirrored_at=now() WHERE request_id=$1",
      [s.id],
    );
    await q("SELECT public.cockpit_request_refresh($1)", [s.id]);
    expect((await request(s.id)).done_at).not.toBeNull();
    expect(
      (await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [s.id]))
        .done,
    ).toBe(true);
    await q(
      "UPDATE public.cockpit_request_parts SET status='in progress', status_type='custom' WHERE request_id=$1",
      [s.id],
    );
    await q("SELECT public.cockpit_request_refresh($1)", [s.id]);
    expect((await request(s.id)).done_at).toBeNull();
  });
});

describe("cancelling", () => {
  test("before it reaches ClickUp: the requester, an editor, an admin or the CEO, with a reason", async () => {
    const s = await submit(CSM, {
      type: "general_csm",
      client: ACME,
      answers: { details: "Cancel me" },
    });
    expect(
      await refused(
        BUYER,
        "SELECT public.cockpit_request_cancel($1,'Not mine')",
        [s.id],
      ),
    ).toBe(
      "Only the person who asked, an editor, an admin or the CEO can cancel this request.",
    );
    expect(
      await refused(CSM, "SELECT public.cockpit_request_cancel($1,'  ')", [
        s.id,
      ]),
    ).toBe("Say why you are cancelling it, in under 240 characters.");
    const out = await one<Row>(
      CSM,
      "SELECT public.cockpit_request_cancel($1,'Asked by mistake') r",
      [s.id],
    );
    expect(out).toMatchObject({
      id: s.id,
      state: "cancelled",
      canCancel: false,
      mine: true,
    });
    expect(out.parts[0]).toMatchObject({
      state: "skipped",
      error: "Cancelled in the cockpit.",
    });
    expect(await queueOf(s.id)).toMatchObject({
      state: "skipped",
      error: "Cancelled in the cockpit.",
    });
    expect(await request(s.id)).toMatchObject({
      cancel_reason: "Asked by mistake",
      cancelled_by: "csm@tests.invalid",
    });
    const a = (await audits(s.id)).filter(
      x => x.action === "request.cancelled",
    );
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({
      before: { state: "sending" },
      after: { state: "cancelled", cancel_reason: "Asked by mistake" },
      actor_email: "csm@tests.invalid",
    });
    // Again: nothing more happens.
    expect(
      (
        await one<Row>(
          CSM,
          "SELECT public.cockpit_request_cancel($1,'Again') r",
          [s.id],
        )
      ).state,
    ).toBe("cancelled");
    expect(
      (await audits(s.id)).filter(x => x.action === "request.cancelled").length,
    ).toBe(1);
    // A cancelled request an operator requeued is claimed as gone, never written.
    const qr = await queueOf(s.id);
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET state='queued', next_attempt_at=now() - interval '1 second' WHERE id=$1",
      [qr.id],
    );
    await holdAllBut([qr.id]);
    const claimed = await claimRequests();
    expect(claimed.map(x => [x.id, x.source_exists])).toEqual([[qr.id, false]]);
    await svc(
      'SELECT public.cockpit_clickup_writeback_save($1,$2,\'{"state":"skipped","error":"The request was cancelled before it reached ClickUp."}\'::jsonb) r',
      [qr.id, claimed[0].claim_token],
    );
    expect((await request(s.id)).state).toBe("cancelled");
    // An editor may cancel someone else's.
    const s2 = await submit(CSM, {
      type: "general_csm",
      client: ACME,
      answers: { details: "Editor cancels" },
    });
    expect(
      (
        await one<Row>(
          VIDEO,
          "SELECT public.cockpit_request_cancel($1,'Duplicate of another ticket') r",
          [s2.id],
        )
      ).state,
    ).toBe("cancelled");
  });
});

const typeSave = (
  who: string,
  key: string,
  patch: Row,
  version: number | null,
) =>
  one<Row>(who, "SELECT public.cockpit_request_type_save($1,$2::jsonb,$3) r", [
    key,
    JSON.stringify(patch),
    version,
  ]);
const typeSaveRefused = (
  who: string,
  key: string,
  patch: Row,
  version: number | null,
) =>
  refusedCode(who, "SELECT public.cockpit_request_type_save($1,$2::jsonb,$3)", [
    key,
    JSON.stringify(patch),
    version,
  ]);

describe("editing a type", () => {
  test("only an editor saves, only the allowed keys, only on the version they opened", async () => {
    expect(
      (
        await typeSaveRefused(
          CSM,
          "general_marketing",
          { label: "Marketing ask" },
          1,
        )
      ).message,
    ).toBe(
      "Only the CEO, an admin or someone they add can change notices and routing.",
    );
    expect(
      (await typeSaveRefused(VIDEO, "general_marketing", { key: "other" }, 1))
        .message,
    ).toBe("That change is not allowed here: key.");
    expect(
      (
        await typeSaveRefused(
          VIDEO,
          "general_marketing",
          { request_type_option_id: "x" },
          1,
        )
      ).message,
    ).toBe("That change is not allowed here: request_type_option_id.");
    expect(
      await typeSaveRefused(
        VIDEO,
        "general_marketing",
        { label: "Marketing ask" },
        7,
      ),
    ).toEqual({
      message:
        "Someone saved this type since you opened it. Reload to see their change.",
      code: "40001",
    });
    expect(
      (await typeSaveRefused(VIDEO, "general_marketing", {}, 1)).message,
    ).toBe("There is nothing to save.");
    expect(
      (await typeSaveRefused(VIDEO, "general_marketing", { label: "No" }, 1))
        .message,
    ).toBe("The name must be 3 to 80 characters.");
    expect(
      (await typeSaveRefused(VIDEO, "general_marketing", { due_days: 61 }, 1))
        .message,
    ).toBe("Due in must be 0 to 60 working days.");
    expect(
      (
        await typeSaveRefused(
          VIDEO,
          "general_marketing",
          { sop_url: "http://plain.example" },
          1,
        )
      ).message,
    ).toBe(
      "The SOP link must start with https:// and be under 500 characters.",
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='request_type.saved' AND entity_id='general_marketing'",
      ),
    ).toBe(0);
  });

  test("a named person must be in the workspace; a template must still be in ClickUp", async () => {
    const t = seedType("general_marketing");
    expect(
      (
        await typeSaveRefused(
          VIDEO,
          "general_marketing",
          {
            targets: [
              {
                ...t.targets[0],
                owner_rule: "person",
                owner_clickup_id: 123456789,
              },
            ],
          },
          1,
        )
      ).message,
    ).toBe(
      "That person is not in the ClickUp workspace. Pick someone from the list.",
    );
    expect(
      (
        await typeSaveRefused(
          VIDEO,
          "general_marketing",
          {
            targets: [
              {
                ...t.targets[0],
                template_id: "t-zzzzzzzz",
                template_name: "Made up",
              },
            ],
          },
          1,
        )
      ).message,
    ).toBe("That template is not in ClickUp any more. Pick another.");
    await svc("SELECT public.cockpit_request_templates_sync($1::jsonb) r", [
      JSON.stringify(
        await q(
          "SELECT id, name FROM public.cockpit_request_templates WHERE id <> 't-86exy04v4'",
        ),
      ),
    ]);
    expect(
      (
        await q(
          "SELECT state FROM public.cockpit_request_templates WHERE id='t-86exy04v4'",
        )
      )[0].state,
    ).toBe("missing");
    expect(
      (
        await typeSaveRefused(
          VIDEO,
          "social_media",
          {
            targets: [
              {
                ...seedType("social_media").targets[0],
                template_id: "t-86exy04v4",
                template_name: "x",
              },
            ],
          },
          1,
        )
      ).message,
    ).toBe("That template is not in ClickUp any more. Pick another.");
  });

  test("a save is a new version with its versions row and an audit row holding both rows", async () => {
    const t = seedType("general_marketing");
    const targets = [{ ...t.targets[0], owner_clickup_id: CU_BUYER }];
    const steps = ["Read the ask.", "Do it.", "Tell the requester."];
    const view = await typeSave(
      VIDEO,
      "general_marketing",
      {
        label: "Marketing ask",
        targets,
        sop_steps: steps,
        due_days: 3,
        priority: "high",
      },
      1,
    );
    expect(view).toMatchObject({
      key: "general_marketing",
      label: "Marketing ask",
      version: 2,
      dueDays: 3,
      priority: "high",
      sopSteps: steps,
      sopStepsState: "saved",
      updatedByLabel: "the video editor",
    });
    expect(view.parts[0]).toMatchObject({
      ruleLabel: "the media buyer of record",
      stepCount: 3,
      stepsDraft: false,
    });
    const row = await typeRow("general_marketing");
    expect(row).toMatchObject({
      version: 2,
      sop_steps_state: "saved",
      updated_by: "video@tests.invalid",
    });
    const versions = await one<Row>(
      VIDEO,
      "SELECT public.cockpit_request_type_versions('general_marketing') r",
    );
    expect(
      await refused(
        CSM,
        "SELECT public.cockpit_request_type_versions('general_marketing')",
      ),
    ).toBe(
      "Only the CEO, an admin or someone they add can change notices and routing.",
    );
    expect(await refused(CSM, "SELECT public.cockpit_request_people()")).toBe(
      "Only the CEO, an admin or someone they add can change notices and routing.",
    );
    expect(
      versions.versions.map((v: Row) => [v.version, v.note, v.savedByLabel]),
    ).toEqual([
      [2, "Saved", "the video editor"],
      [
        1,
        "Seeded 2026-10-26 from docs/requests/request-types.json",
        "the first setup",
      ],
    ]);
    const a = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='request_type.saved' AND entity_id='general_marketing'",
    );
    expect(a.length).toBe(1);
    expect(a[0].before).toMatchObject({
      version: 1,
      label: "General marketing request",
      sop_steps_state: "draft",
    });
    expect(a[0].after).toMatchObject({
      version: 2,
      label: "Marketing ask",
      sop_steps_state: "saved",
    });
    expect(a[0]).toMatchObject({
      actor_email: "video@tests.invalid",
      source_app: "shared-cockpits",
      source_system: "supabase",
    });
    expect(a[0].metadata).toEqual({
      version: 2,
      keys: ["due_days", "label", "priority", "sop_steps", "targets"],
    });
    // The next request uses the new routing: the named media buyer.
    const sent = await submit(SM, {
      type: "general_marketing",
      client: ACME,
      answers: { details: "Pause the old ad set." },
    });
    expect(sent.parts[0]).toMatchObject({
      taskName: "Acme Interiors - Marketing ask",
      owner: { how: "named", label: "the media buyer" },
    });
    expect(await request(sent.id)).toMatchObject({
      type_version: 2,
      type_label: "Marketing ask",
      priority: "high",
    });
    expect((await queueOf(sent.id)).payload).toMatchObject({
      sopSteps: steps,
      sopChecklistName: "SOP steps",
      typeVersion: 2,
    });
    // The requester sees the answers labelled as they were asked.
    const got = await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [
      sent.id,
    ]);
    expect(got).toMatchObject({
      typeLabel: "Marketing ask",
      details: "Pause the old ad set.",
      answers: [],
    });
  });

  test("going back to a version writes it as a new one; the writer turns Request Type off by itself", async () => {
    expect(
      (
        await one<Row>(
          VIDEO,
          "SELECT public.cockpit_request_type_restore('general_marketing',9,2) r",
        ).catch(e => ({ message: (e as Error).message }))
      ).message,
    ).toBe("That version does not exist. Reload the versions.");
    expect(
      await refused(
        VIDEO,
        "SELECT public.cockpit_request_type_restore('general_marketing',1,1)",
      ),
    ).toBe(
      "Someone saved this type since you opened it. Reload to see their change.",
    );
    const back = await one<Row>(
      VIDEO,
      "SELECT public.cockpit_request_type_restore('general_marketing',1,2) r",
    );
    expect(back).toMatchObject({
      version: 3,
      label: "General marketing request",
      dueDays: 2,
      priority: "normal",
      sopStepsState: "draft",
    });
    expect((await typeRow("general_marketing")).targets).toEqual(
      seedType("general_marketing").targets,
    );
    expect(
      (
        await q(
          "SELECT note, saved_by FROM public.cockpit_request_type_versions WHERE key='general_marketing' AND version=3",
        )
      )[0],
    ).toEqual({
      note: "Back to version 1",
      saved_by: "video@tests.invalid",
    });
    const a = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='request_type.restored' AND entity_id='general_marketing'",
    );
    expect(a.length).toBe(1);
    expect(a[0].before.version).toBe(2);
    expect(a[0].after.version).toBe(3);
    expect(a[0].metadata).toEqual({ version: 3, from_version: 1 });

    expect((await typeRow("employee_offboarding")).set_request_type).toBe(true);
    expect(
      await refused(
        SM,
        "SELECT public.cockpit_request_type_rt_off('employee_offboarding','x')",
      ),
    ).toContain("permission denied");
    await svc(
      "SELECT public.cockpit_request_type_rt_off('employee_offboarding','ClickUp moved or renamed a task after its Request Type was set, so Request Type is off for this type.') r",
    );
    const t = await typeRow("employee_offboarding");
    expect(t).toMatchObject({
      set_request_type: false,
      version: 2,
      updated_by: "clickup-writeback",
    });
    expect(
      (
        await q(
          "SELECT saved_by, note FROM public.cockpit_request_type_versions WHERE key='employee_offboarding' AND version=2",
        )
      )[0],
    ).toEqual({
      saved_by: "clickup-writeback",
      note: "ClickUp moved or renamed a task after its Request Type was set, so Request Type is off for this type.",
    });
    const off = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='request_type.request_type_off' AND entity_id='employee_offboarding'",
    );
    expect(off.length).toBe(1);
    expect(off[0]).toMatchObject({
      actor_email: "clickup-writeback",
      source_system: "cron",
      before: { set_request_type: true },
      after: { set_request_type: false },
    });
    // Already off: nothing more.
    await svc(
      "SELECT public.cockpit_request_type_rt_off('employee_offboarding','again') r",
    );
    expect((await typeRow("employee_offboarding")).version).toBe(2);
    expect(
      (
        await one<Row>(SM, "SELECT public.cockpit_request_types_read() r")
      ).types.find((x: Row) => x.key === "employee_offboarding").updatedByLabel,
    ).toBe("the requests writer");
  });
});

describe("the old form's tickets in All Tasks", () => {
  const offOpt = seedType("client_offboarding").request_type_option_id;
  const csmOpt = seedType("general_csm").request_type_option_id;
  const tasks = [
    {
      taskId: "cuold001",
      name: "Form Submission #101",
      url: "https://app.clickup.com/t/cuold001",
      optionId: offOpt,
      tags: ["acme interiors", "urgent"],
      description: "Client is leaving at the end of the month.",
      dateCreated: String(Date.parse("2026-10-20T08:00:00Z")),
      priority: "high",
      dueAt: String(Date.parse("2026-10-30T09:00:00Z")),
      status: "to do",
      statusType: "open",
    },
    {
      taskId: "cuold002",
      name: "Form Submission #102",
      url: "https://app.clickup.com/t/cuold002",
      optionId: csmOpt,
      tags: [],
      description: "",
      dateCreated: String(Date.parse("2026-10-21T08:00:00Z")),
      priority: null,
      dueAt: null,
      status: "to do",
      statusType: "open",
    },
    {
      taskId: "cuold003",
      name: "Form Submission #103",
      url: "https://app.clickup.com/t/cuold003",
      optionId: "00000000-0000-4000-8000-00000000dead",
      tags: [],
      description: "x",
      dateCreated: null,
      priority: null,
      dueAt: null,
      status: "to do",
      statusType: "open",
    },
  ];
  const imported = async (task: string) =>
    (
      await q(
        "SELECT * FROM public.cockpit_requests WHERE imported_task_id=$1",
        [task],
      )
    )[0];

  test("each open ticket comes in once as an unrouted request on its team's queue", async () => {
    const out = await svc<Row>(
      "SELECT public.cockpit_request_import($1::jsonb) r",
      [JSON.stringify(tasks)],
    );
    expect(out).toEqual({
      imported: 2,
      skipped: [{ taskId: "cuold003", why: "Unknown request type" }],
    });
    const r = await imported("cuold001");
    expect(r).toMatchObject({
      type_key: "client_offboarding",
      source: "import",
      requester_member_id: null,
      requester_label: "the old ClickUp form",
      client_task_id: ACME,
      client_name: "Acme Interiors",
      state: "imported",
      priority: "high",
      answers: { details: "Client is leaving at the end of the month." },
    });
    expect(r.due_on.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(new Date(r.created_at).toISOString()).toBe(
      "2026-10-20T08:00:00.000Z",
    );
    expect(await parts(r.id)).toMatchObject([
      {
        part: "main",
        list_id: "901816723226",
        team: "all_tasks",
        owner_how: "import",
        owner_label: "Nobody yet",
        state: "imported",
        clickup_task_id: "cuold001",
        clickup_url: "https://app.clickup.com/t/cuold001",
        status: "to do",
        status_type: "open",
        queue_id: null,
      },
    ]);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue WHERE source_id=$1",
        [r.id],
      ),
    ).toBe(0);
    expect(await imported("cuold002")).toMatchObject({
      client_task_id: null,
      answers: {},
      priority: "normal",
      due_on: null,
    });
    const a = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='request.imported'",
    );
    expect(a.length).toBe(1);
    expect(a[0].metadata.taskIds).toEqual(["cuold001", "cuold002"]);
    expect(a[0]).toMatchObject({
      actor_email: "cockpit-tasks",
      source_system: "cron",
      entity_type: "cockpit_requests",
    });
    // The next hourly read finds them already in.
    expect(
      await svc<Row>("SELECT public.cockpit_request_import($1::jsonb) r", [
        JSON.stringify(tasks.slice(0, 2)),
      ]),
    ).toEqual({ imported: 0, skipped: [] });
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='request.imported'",
      ),
    ).toBe(1);
    // The systems manager's queue (tech) shows it, with a way to route it.
    const queue = await one<Row>(
      SM,
      "SELECT public.cockpit_requests_read('team') r",
    );
    const row = queue.rows.find((x: Row) => x.id === r.id);
    expect(row).toMatchObject({
      state: "imported",
      source: "import",
      requesterLabel: "the old ClickUp form",
      canRoute: true,
      canCancel: false,
      mine: false,
      team: "tech",
    });
    expect(row.parts[0]).toMatchObject({
      listName: "All Tasks",
      owner: { label: "Nobody yet", how: "import" },
    });
    // A CSM's queue does not hold a tech ticket; it holds the CSM one.
    const csm = await one<Row>(
      CSM,
      "SELECT public.cockpit_requests_read('team') r",
    );
    expect(csm.rows.some((x: Row) => x.id === r.id)).toBe(false);
    const csmImport = await imported("cuold002");
    expect(csm.rows.find((x: Row) => x.id === csmImport.id)).toMatchObject({
      canRoute: true,
      state: "imported",
    });
    expect(
      await refused(SM, "SELECT public.cockpit_request_cancel($1,'Old')", [
        r.id,
      ]),
    ).toBe("This ticket came from the old ClickUp form. Close it in ClickUp.");
  });

  test("making it a request routes it: the old one is routed, the new one names it", async () => {
    const r = await imported("cuold001");
    expect(
      await submitRefused(SM, {
        type: "client_offboarding",
        client: ACME,
        replaces: "cunotthere",
      }),
    ).toBe("That old ticket is not in the cockpit. Reload the queue.");
    const sent = await submit(SM, {
      type: "client_offboarding",
      client: ACME,
      answers: { additional_notes: "From the old form" },
      replaces: "cuold001",
    });
    expect(sent.state).toBe("sending");
    expect(await imported("cuold001")).toMatchObject({
      state: "routed",
      routed_to: sent.id,
    });
    const rows = await queueRows(sent.id);
    const byPart = Object.fromEntries(
      rows.map(x => [x.payload.part, x.payload]),
    );
    expect(byPart.tech.replacesTaskId).toBe("cuold001");
    expect(byPart.media.replacesTaskId).toBeNull();
    expect(byPart.tech).toMatchObject({
      setRequestType: true,
      templateId: "t-86ex629ve",
      taskName: "Acme Interiors - Client offboarding (Tech)",
    });
    expect((await request(sent.id)).replaces_task_id).toBe("cuold001");
    const a = await q(
      "SELECT * FROM public.cockpit_audit_log WHERE action='request.routed' AND entity_id=$1",
      [r.id],
    );
    expect(a.length).toBe(1);
    expect(a[0].metadata).toEqual({ task_id: "cuold001", request_id: sent.id });
    expect(
      await submitRefused(SM, {
        type: "client_offboarding",
        client: BETA,
        replaces: "cuold001",
      }),
    ).toBe("That old ticket was already routed.");
    // The open offboarding for the card now blocks a second one.
    expect(
      (await submit(CSM, { type: "client_offboarding", client: ACME })).state,
    ).toBe("duplicate");
    const got = await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [
      r.id,
    ]);
    expect(got).toMatchObject({
      state: "routed",
      routedTo: sent.id,
      details: "Client is leaving at the end of the month.",
    });
    expect(got.history.map((h: Row) => h.what)).toEqual([
      "Came in through the old ClickUp form",
      "Routed as a new request",
    ]);
    expect(
      (await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [sent.id]))
        .replacesTaskId,
    ).toBe("cuold001");
  });
});

describe("the request lists", () => {
  const read = (who: string, view: string, limit = 50) =>
    one<Row>(who, "SELECT public.cockpit_requests_read($1,$2) r", [
      view,
      limit,
    ]);

  test("each seat sees only its views, with counts; missing is never zero", async () => {
    const csm = await read(CSM, "mine");
    expect(csm.views.map((v: Row) => [v.key, v.label])).toEqual([
      ["mine", "My requests"],
      ["assigned", "Assigned to me"],
      ["team", "Team queue"],
    ]);
    expect(csm.views[0].count).toBe(csm.rows.length);
    expect(csm.rows.every((r: Row) => r.mine)).toBe(true);
    const buyer = await read(BUYER, "mine");
    expect(buyer.views.map((v: Row) => v.label)).toEqual([
      "My requests",
      "Assigned to me",
      "Marketing / ADs queue",
    ]);
    const sales = await read(SALES, "mine");
    expect(sales.views).toEqual([
      { key: "mine", label: "My requests", count: 1 },
      { key: "assigned", label: "Assigned to me", count: null },
    ]);
    const editor = await read(VIDEO, "all");
    expect(editor.views.at(-1)).toEqual({
      key: "all",
      label: "All requests",
      count: await count("SELECT count(*) n FROM public.cockpit_requests"),
    });
    expect(
      await refused(CSM, "SELECT public.cockpit_requests_read('all')"),
    ).toBe("Only an editor, an admin or the CEO can see all requests.");
    expect(
      await refused(CSM, "SELECT public.cockpit_requests_read('everything')"),
    ).toBe("Pick My requests, Assigned to me, a team queue or All requests.");
    expect((await read(SALES, "team")).note).toBe(
      "Your seat has no team queue. Use My requests to see what you asked for.",
    );
  });

  test("assigned to me: the parts a linked seat owns; an unlinked seat is told why it sees none", async () => {
    const mine = await read(CSM, "assigned");
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(
      mine.rows.every((r: Row) => r.state !== "cancelled" && !r.done),
    ).toBe(true);
    expect(mine.rows.some((r: Row) => r.typeKey === "general_csm")).toBe(true);
    const unlinked = await read(CSM_B, "assigned");
    expect(unlinked.rows).toEqual([]);
    expect(unlinked.note).toBe(
      "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it.",
    );
    // The mirror's assignees count too.
    const s = await submit(SM, {
      type: "general_tech",
      answers: { details: "Mirror assignee" },
    });
    expect(
      (await read(BUYER, "assigned")).rows.some((r: Row) => r.id === s.id),
    ).toBe(false);
    await q(
      "UPDATE public.cockpit_request_parts SET assignee_ids=$2::bigint[] WHERE request_id=$1",
      [s.id, [CU_BUYER]],
    );
    expect(
      (await read(BUYER, "assigned")).rows.some((r: Row) => r.id === s.id),
    ).toBe(true);
  });

  test("a team queue holds the type's team or a part's team; open first, then by due day", async () => {
    const buyer = await read(BUYER, "team", 200);
    expect(buyer.rows.length).toBeGreaterThan(0);
    for (const r of buyer.rows)
      expect(
        r.team === "ads" ||
          r.parts.some((p: Row) => p.teamLabel === "Marketing / ADs"),
      ).toBe(true);
    expect(buyer.rows.some((r: Row) => r.typeKey === "client_pause")).toBe(
      true,
    );
    const all = await read(CEO, "all", 200);
    const open = all.rows.map(
      (r: Row) => !r.done && !["cancelled", "routed"].includes(r.state),
    );
    expect(open).toEqual(
      [...open].sort((a: boolean, b: boolean) => Number(b) - Number(a)),
    );
    const dues = all.rows
      .filter((_: Row, i: number) => open[i])
      .map((r: Row) => r.dueOn ?? "9999-99-99");
    expect(dues).toEqual([...dues].sort());
    expect((await read(CEO, "all", 3)).rows.length).toBe(3);
    expect((await read(CEO, "all", 0)).rows.length).toBe(1);
  });

  test("one request: who may open it, its answers and its history", async () => {
    const s = await submit(CREATIVE, {
      type: "whatsapp_reactivation",
      client: ACME,
      answers: {
        lead_list: "https://docs.google.com/spreadsheets/d/abc",
        additional_notes: "Ramadan offer",
      },
    });
    expect(
      s.parts.map((p: Row) => [p.part, p.listName, p.owner.label]),
    ).toEqual([
      ["message", "Media/Creative", "the creative strategist"],
      ["send", "Operations / Tech", "the systems manager"],
    ]);
    const got = await one<Row>(
      CREATIVE,
      "SELECT public.cockpit_request_get($1) r",
      [s.id],
    );
    expect(got).toMatchObject({
      id: s.id,
      mine: true,
      typeLabel: "WhatsApp reactivation campaign",
      clientName: "Acme Interiors",
      requesterLabel: "the creative director",
      details: null,
      replacesTaskId: null,
      routedTo: null,
    });
    expect(got.answers).toEqual([
      {
        key: "lead_list",
        label: "Lead list link",
        display: "https://docs.google.com/spreadsheets/d/abc",
      },
      { key: "additional_notes", label: "Notes", display: "Ramadan offer" },
    ]);
    expect(got.history.map((h: Row) => [h.what, h.byLabel])).toEqual([
      ["Sent from the cockpit", "the creative director"],
    ]);
    expect(
      (await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [s.id]))
        .mine,
    ).toBe(false); // a part on tech, and an admin
    // The CSM's teams hold neither part, and the CSM owns neither: not theirs.
    for (const who of [CSM, PLAIN, BUYER])
      expect(
        await refused(who, "SELECT public.cockpit_request_get($1)", [s.id]),
      ).toBe("This request is not yours to see. Ask the person who raised it.");
    // An owner of a part may open it.
    await q(
      "UPDATE public.cockpit_request_parts SET owner_clickup_id=$2 WHERE request_id=$1 AND part='message'",
      [s.id, CU_BUYER],
    );
    expect(
      (await one<Row>(BUYER, "SELECT public.cockpit_request_get($1) r", [s.id]))
        .id,
    ).toBe(s.id);
    expect(
      await refused(SM, "SELECT public.cockpit_request_get($1)", [uid()]),
    ).toBe("That request is not in the cockpit. Reload the list.");
  });
});

describe("the writer's and the mirror's service calls", () => {
  test("the sweep queues a part that lost its queue row, once", async () => {
    const s = await submit(SM, {
      type: "general_tech",
      answers: { details: "Sweep me" },
    });
    const before = await queueOf(s.id);
    await q("DELETE FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [
      before.id,
    ]);
    await q(
      "UPDATE public.cockpit_request_parts SET queue_id=NULL, state='queued' WHERE request_id=$1",
      [s.id],
    );
    expect(await svc<number>("SELECT public.cockpit_request_sweep() r")).toBe(
      1,
    );
    const after = await queueOf(s.id);
    expect(after.payload).toEqual(before.payload);
    expect((await partOf(s.id)).queue_id).toBe(after.id);
    expect(await svc<number>("SELECT public.cockpit_request_sweep() r")).toBe(
      0,
    );
    expect(
      await refused(SM, "SELECT public.cockpit_request_sweep()"),
    ).toContain("permission denied");
  });

  test("the writer reports its mode on every run; a missing or old report is unknown", async () => {
    await svc(
      "SELECT public.cockpit_clickup_requests_state(false,'No token.','apply_limited',ARRAY['86eywg1cq'],'{\"delivered\":0}'::jsonb) r",
    );
    const row = (
      await q(
        "SELECT * FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests'",
      )
    )[0];
    expect(row).toMatchObject({ ok: false, note: "No token." });
    expect(row.detail).toMatchObject({
      mode: "apply_limited",
      onlyCards: ["86eywg1cq"],
      counts: { delivered: 0 },
    });
    const okAt = row.last_ok_at;
    await svc(
      "SELECT public.cockpit_clickup_requests_state(false,'Failed again.','apply',NULL,NULL) r",
    );
    expect(
      (
        await q(
          "SELECT last_ok_at FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests'",
        )
      )[0].last_ok_at,
    ).toEqual(okAt);
    expect(
      await svcRefused(
        "SELECT public.cockpit_clickup_requests_state(true,'x','live',NULL,NULL)",
      ),
    ).toBe("Unsupported requests mode");
    expect(
      await refused(
        SM,
        "SELECT public.cockpit_clickup_requests_state(true,'x','apply',NULL,NULL)",
      ),
    ).toContain("permission denied");
    await mode("apply");
  });

  test("the doctor's inputs name every type's option, parts, templates and fields", async () => {
    const d = await svc<Row>("SELECT public.cockpit_request_doctor_inputs() r");
    expect(d.types.length).toBe(31);
    expect(d.templates.length).toBe(34);
    expect(d.lists.map((l: Row) => l.listId)).toEqual([
      "901816723190",
      "901816723196",
      "901816723206",
      "901816723211",
      "901818016338",
      "901816723226",
    ]);
    const pause = d.types.find((t: Row) => t.key === "client_pause");
    expect(pause).toMatchObject({
      optionId: seedType("client_pause").request_type_option_id,
      optionName: "Client Pause Request ⏸️",
      setRequestType: false,
      fieldIds: [],
    });
    expect(pause.targets).toEqual([
      {
        part: "tech",
        listId: "901816723190",
        templateId: "t-86ex63qk5",
        ownerClickupId: CU_SM,
      },
      {
        part: "media",
        listId: "901816723196",
        templateId: "t-86ex63qm7",
        ownerClickupId: null,
      },
    ]);
    expect(
      d.types.find((t: Row) => t.key === "new_script").fieldIds.length,
    ).toBe(8);
  });

  test("the field read keeps ClickUp's names and choices; a field ClickUp lost is said on the form", async () => {
    const fields = SEED.field_catalog
      .filter(
        f =>
          f.clickup_field_id !==
          fieldOf("landing_page", "page_goal").clickup_field_id,
      )
      .map(f => ({
        id: f.clickup_field_id,
        name:
          f.clickup_field_id ===
          fieldOf("new_script", "who_films").clickup_field_id
            ? "Who Films It?"
            : f.clickup_name,
        type: "x",
        options: f.options
          ? [
              ...f.options,
              ...(f.clickup_name === "Who Films It"
                ? [
                    {
                      id: "new-opt",
                      name: "Both of us",
                      color: "#fff",
                      orderindex: 2,
                    },
                  ]
                : []),
            ]
          : null,
      }));
    expect(
      await svcRefused(
        "SELECT public.cockpit_request_field_catalog_sync('[]'::jsonb)",
      ),
    ).toBe("The ClickUp field list came back empty; nothing was changed.");
    expect(
      await svc<Row>(
        "SELECT public.cockpit_request_field_catalog_sync($1::jsonb) r",
        [JSON.stringify(fields)],
      ),
    ).toEqual({ updated: 23, missing: 1, added: 0, skipped: 0 });
    const who = (
      await q(
        "SELECT * FROM public.cockpit_request_field_catalog WHERE clickup_name='Who Films It?'",
      )
    )[0];
    expect(who.options.at(-1)).toEqual({ id: "new-opt", name: "Both of us" });
    const view = (
      await one<Row>(CSM, "SELECT public.cockpit_request_types_read() r")
    ).types.find((t: Row) => t.key === "landing_page");
    expect(view.fields.find((f: Row) => f.key === "page_goal").options).toEqual(
      [],
    );
    expect(
      await submitRefused(CSM, {
        type: "landing_page",
        client: ACME,
        answers: { page_goal: "33d8bef7-9176-4190-bc2d-d92bfa338232" },
      }),
    ).toBe(
      "Page goal: this choice could not be read from ClickUp. Ask the systems manager.",
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='request_fields.synced'",
      ),
    ).toBe(1);
    // Back in the next read: the form offers it again. A field ClickUp added is
    // added (state ok, used by no type until an editor maps it) when a request
    // can write its type; one it cannot (no type here, or a date) is skipped.
    const back = await svc<Row>(
      "SELECT public.cockpit_request_field_catalog_sync($1::jsonb) r",
      [
        JSON.stringify([
          ...SEED.field_catalog.map(f => ({
            id: f.clickup_field_id,
            name: f.clickup_name,
            options: f.options,
          })),
          {
            id: "00000000-0000-4000-8000-0000000000aa",
            name: "New field",
            options: null,
          },
          {
            id: "00000000-0000-4000-8000-0000000000ab",
            name: "Go live date",
            type: "date",
            options: null,
          },
          {
            id: "00000000-0000-4000-8000-0000000000ac",
            name: "Ad Language",
            type: "drop_down",
            options: [{ id: "lang-ar", name: "Arabic", orderindex: 0 }, { id: "lang-en", name: "English", orderindex: 1 }],
          },
        ]),
      ],
    );
    expect(back).toEqual({ updated: 24, missing: 0, added: 1, skipped: 2 });
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_request_field_catalog",
      ),
    ).toBe(25);
    expect(
      (await q("SELECT clickup_name, kind, label, options, state FROM public.cockpit_request_field_catalog WHERE clickup_field_id='00000000-0000-4000-8000-0000000000ac'"))[0],
    ).toEqual({
      clickup_name: "Ad Language",
      kind: "select",
      label: "Ad Language",
      options: [{ id: "lang-ar", name: "Arabic" }, { id: "lang-en", name: "English" }],
      state: "ok",
    });
    // An editor sees it in the catalog to map; no type uses it yet.
    expect(
      (await one<Row>(SM, "SELECT public.cockpit_request_types_read() r")).catalog.some(
        (c: Row) => c.clickupFieldId === "00000000-0000-4000-8000-0000000000ac",
      ),
    ).toBe(true);
    expect(
      (
        await one<Row>(CSM, "SELECT public.cockpit_request_types_read() r")
      ).types
        .find((t: Row) => t.key === "landing_page")
        .fields.find((f: Row) => f.key === "page_goal").options.length,
    ).toBe(5);
  });

  test("the template read marks what ClickUp no longer lists, and brings it back", async () => {
    expect(
      await svcRefused(
        "SELECT public.cockpit_request_templates_sync('[]'::jsonb)",
      ),
    ).toBe("The ClickUp template list came back empty; nothing was changed.");
    const all = (
      await q("SELECT id, name FROM public.cockpit_request_templates")
    ).map(t => ({ id: t.id, name: t.name }));
    expect(
      await svc<Row>(
        "SELECT public.cockpit_request_templates_sync($1::jsonb) r",
        [
          JSON.stringify([
            ...all,
            { id: "t-newone123", name: "A new template" },
          ]),
        ],
      ),
    ).toEqual({ seen: 35, missing: 0 });
    expect(
      (
        await q(
          "SELECT state FROM public.cockpit_request_templates WHERE id='t-86exy04v4'",
        )
      )[0].state,
    ).toBe("ok");
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='request_templates.synced'",
      ),
    ).toBe(2);
    // An editor may now pick the template that came back.
    const t = seedType("social_media");
    const v = (await typeRow("social_media")).version;
    const view = await typeSave(
      SM,
      "social_media",
      {
        targets: [
          {
            ...t.targets[0],
            template_id: "t-86exy04v4",
            template_name: "whatever the screen sent",
          },
        ],
      },
      v,
    );
    expect(view.parts[0]).toMatchObject({
      templateName: "Social Media Management Template",
      stepCount: null,
    });
    expect((await typeRow("social_media")).targets[0].template_name).toBe(
      "Social Media Management Template",
    );
  });

  test("every service call is closed to the browser", async () => {
    for (const sig of SERVICE)
      expect(await can("authenticated", sig)).toBe(false);
    expect(
      await refused(SM, "SELECT public.cockpit_request_import('[]'::jsonb)"),
    ).toContain("permission denied");
    expect(
      await refused(
        SM,
        "SELECT public.cockpit_clickup_members_sync('[]'::jsonb)",
      ),
    ).toContain("permission denied");
    expect(await refused(SM, "SELECT public.cockpit_request_seat()")).toContain(
      "permission denied",
    );
    expect(
      await refused(SM, "SELECT public.cockpit_clickup_requests_kick()"),
    ).toContain("permission denied");
  });
});

describe("review 2026-10-26: the team queue's client limit, routing, links, cancel and Request Type", () => {
  const read = (who: string, view: string) =>
    one<Row>(who, "SELECT public.cockpit_requests_read($1,50) r", [view]);
  const get = (who: string, id: string) => one<Row>(who, "SELECT public.cockpit_request_get($1) r", [id]);
  const getRefused = (who: string, id: string) => refused(who, "SELECT public.cockpit_request_get($1)", [id]);

  test("SEC-1: a team-only seat's queue and request view hold only its own clients; a seat with a client list too", async () => {
    await mode("apply");
    const callAnswers = { schedule_rate_issue: OPT_CALL_ISSUE };
    const acme = await submit(CSM, { type: "low_schedule_rate", client: ACME, answers: callAnswers });
    const beta = await submit(CSM, { type: "low_schedule_rate", client: BETA, answers: callAnswers });
    // The call centre seat (team-only, Acme Interiors only) sees Acme's, never Beta's.
    const call = await read(CALL, "team");
    expect(call.rows.some((r: Row) => r.id === acme.id)).toBe(true);
    expect(call.rows.some((r: Row) => r.id === beta.id)).toBe(false);
    expect(call.views.find((v: Row) => v.key === "team").count).toBe(
      call.rows.length,
    );
    expect((await get(CALL, acme.id)).id).toBe(acme.id);
    expect(await getRefused(CALL, beta.id)).toBe("This request is not yours to see. Ask the person who raised it.");
    // A request with no client is not a team-only seat's.
    const noClient = await submit(SM, { type: "general_csm", answers: { details: "Team note" }, priority: "normal" });
    await q("UPDATE public.cockpit_request_parts SET team='call_center' WHERE request_id=$1", [noClient.id]);
    expect((await read(CALL, "team")).rows.some((r: Row) => r.id === noClient.id)).toBe(false);
    expect(await getRefused(CALL, noClient.id)).toBe("This request is not yours to see. Ask the person who raised it.");
    // A CSM with a client list (Beta Build) sees Beta's and the no-client one, never Acme's.
    const csmB = await read(CSM_B, "team");
    expect(csmB.rows.some((r: Row) => r.id === beta.id)).toBe(true);
    expect(csmB.rows.some((r: Row) => r.id === acme.id)).toBe(false);
    expect(csmB.rows.some((r: Row) => r.id === noClient.id)).toBe(true);
    // The CSM with every client still sees both.
    const all = await read(CSM, "team");
    expect([acme.id, beta.id].every(id => all.rows.some((r: Row) => r.id === id))).toBe(true);
  });

  test("SEC-2 and RT-4: routing an old ticket needs its team or an editor, its own card, and the writer's rule for that card", async () => {
    const csmOpt = seedType("general_csm").request_type_option_id;
    await svc("SELECT public.cockpit_request_import($1::jsonb) r", [
      JSON.stringify([
        {
          taskId: "cuold010",
          name: "Form Submission #110",
          url: "https://app.clickup.com/t/cuold010",
          optionId: csmOpt,
          tags: ["beta build"],
          description: "Beta needs a call.",
          dateCreated: String(Date.now() - 3600_000),
          priority: null,
          dueAt: null,
          status: "to do",
          statusType: "open",
        },
      ]),
    ]);
    const imp = (await q("SELECT * FROM public.cockpit_requests WHERE imported_task_id='cuold010'"))[0];
    expect(imp.client_task_id).toBe(BETA);
    // A media buyer (ads) is not the ticket's team: no Route, and the submit refuses.
    expect(
      await submitRefused(BUYER, { type: "general_csm", client: BETA, answers: { details: "Mine now" }, priority: "normal", replaces: "cuold010" }),
    ).toBe("Only that team, an editor, an admin or the CEO can route this old ticket.");
    // The call centre seat is not client success, and not Beta's either.
    expect(
      await submitRefused(CALL, { type: "general_csm", client: ACME, answers: { details: "x" }, priority: "normal", replaces: "cuold010" }),
    ).toBe("Only that team, an editor, an admin or the CEO can route this old ticket.");
    // A CSM limited to Acme... CSM_B is Beta's: Route shows; a CSM routing it to another card is refused.
    expect((await read(CSM_B, "team")).rows.find((r: Row) => r.id === imp.id)).toMatchObject({ canRoute: true });
    expect(
      await submitRefused(CSM, { type: "general_csm", client: ACME, answers: { details: "x" }, priority: "normal", replaces: "cuold010" }),
    ).toBe("This old ticket is for Beta Build. Route it for that client.");
    expect(
      await submitRefused(CSM, { type: "general_csm", client: null, answers: { details: "x" }, priority: "normal", replaces: "cuold010" }),
    ).toBe("This old ticket is for Beta Build. Route it for that client.");
    // The writer's rule applies to the ticket's card: in the canary the team cannot route, an editor's is held.
    await mode("apply_limited", [TEST_CARD]);
    expect((await read(CSM_B, "team")).rows.find((r: Row) => r.id === imp.id)).toMatchObject({ canRoute: false });
    expect((await read(SM, "all")).rows.find((r: Row) => r.id === imp.id)).toMatchObject({ canRoute: true });
    await mode("dry_run");
    expect((await read(CSM, "team")).rows.find((r: Row) => r.id === imp.id)).toMatchObject({ canRoute: false });
    await mode("apply");
    const routed = await submit(CSM_B, { type: "general_csm", client: BETA, answers: { details: "Routed" }, priority: "normal", replaces: "cuold010" });
    expect(routed.state).toBe("sending");
    expect((await q("SELECT state, routed_to FROM public.cockpit_requests WHERE id=$1", [imp.id]))[0]).toEqual({ state: "routed", routed_to: routed.id });
  });

  test("SEC-3: one active seat per ClickUp user, no linking of one's own seat but the CEO's, and the API user only on the CEO's seat", async () => {
    const set = (who: string, member: string, cu: number | null) =>
      one<Row>(who, "SELECT public.cockpit_member_clickup_set($1,$2) r", [member, cu]);
    const setRefused = (who: string, member: string, cu: number | null) =>
      refusedCode(who, "SELECT public.cockpit_member_clickup_set($1,$2)", [member, cu]);
    // An editor never links (or clears) their own seat.
    expect(await setRefused(VIDEO, await memberId(VIDEO), CU_OTHER)).toEqual({
      message: "You cannot link your own seat. Ask the CEO or another editor to do it.",
      code: "42501",
    });
    expect((await setRefused(SM, await memberId(SM), null)).code).toBe("42501");
    // A ClickUp user another active seat holds is refused.
    expect(await setRefused(VIDEO, await memberId(PLAIN), CU_SM)).toEqual({
      message: "That ClickUp user is already linked to another seat. Clear that link first.",
      code: "23505",
    });
    // The API user goes only to the CEO's seat.
    await svc("SELECT public.cockpit_clickup_members_sync($1::jsonb) r", [
      JSON.stringify([
        { id: CU_SM, username: "Huda", email: "sm@tests.invalid" },
        { id: CU_CS, username: "Omar", email: "creative@tests.invalid" },
        { id: CU_CSM, username: "Noura", email: "csm@tests.invalid" },
        { id: CU_BUYER, username: "Bilal", email: "buyer@tests.invalid" },
        { id: CU_VIDEO, username: "Mona", email: "video@tests.invalid" },
        { id: CU_CALL, username: "Rana", email: "call@tests.invalid" },
        { id: CU_OTHER, username: "Outside Person", email: "outside@tests.invalid" },
        { id: 284616470, username: "Aziz API", email: "ceo-api@tests.invalid" },
      ]),
    ]);
    expect(await setRefused(VIDEO, await memberId(PLAIN), 284616470)).toEqual({
      message: "That ClickUp user is the CEO's own account, which the cockpit writes with. Link it only to the CEO's seat.",
      code: "22023",
    });
    // The CEO links their own seat to it; each change is audited with the editor's address.
    const ceo = await set(CEO, await memberId(CEO), 284616470);
    expect(ceo.link).toMatchObject({ state: "manual", clickupUserId: 284616470 });
    const a = await q(
      "SELECT actor_email FROM public.cockpit_audit_log WHERE action='member_clickup.linked' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1",
      [await memberId(CEO)],
    );
    expect(a[0].actor_email).toBe("aziz@maharamedia.com");
    // The hourly email match never takes a ClickUp user another seat holds.
    await set(VIDEO, await memberId(PLAIN), CU_OTHER);
    await q("UPDATE public.cockpit_members SET email='outside@tests.invalid' WHERE auth_user_id=$1", [GONE]);
    await q("UPDATE public.cockpit_members SET active=true WHERE auth_user_id=$1", [GONE]);
    await q("DELETE FROM public.cockpit_member_clickup WHERE member_id=$1", [await memberId(GONE)]);
    await svc("SELECT public.cockpit_clickup_members_sync($1::jsonb) r", [
      JSON.stringify([{ id: CU_OTHER, username: "Outside Person", email: "outside@tests.invalid" }, { id: CU_SM, username: "Huda", email: "sm@tests.invalid" }]),
    ]);
    expect((await q("SELECT state, clickup_user_id FROM public.cockpit_member_clickup WHERE member_id=$1", [await memberId(GONE)]))[0]).toEqual({
      state: "ambiguous",
      clickup_user_id: null,
    });
    await q("UPDATE public.cockpit_members SET active=false, email='gone@tests.invalid' WHERE auth_user_id=$1", [GONE]);
    await set(VIDEO, await memberId(PLAIN), null);
  });

  test("SEC-4: a part with a ClickUp task, even one waiting to retry, cannot be cancelled here", async () => {
    await mode("apply");
    const sent = await submit(CSM, { type: "general_csm", client: ACME, answers: { details: "Retry me" }, priority: "normal" });
    await q(
      "UPDATE public.cockpit_clickup_writeback_queue SET state='retry', task_id='curetry01', progress=jsonb_build_object('task', jsonb_build_object('id','curetry01')) WHERE source_id=$1",
      [sent.id],
    );
    expect((await parts(sent.id))[0]).toMatchObject({ state: "retry", clickup_task_id: "curetry01" });
    expect((await get(CSM, sent.id)).canCancel).toBe(false);
    expect(await refused(CSM, "SELECT public.cockpit_request_cancel($1,'Changed my mind')", [sent.id])).toBe(
      "Part of this request is already in ClickUp. Close it there.",
    );
    // A retry with no task yet can still be cancelled.
    const fresh = await submit(CSM, { type: "general_csm", client: ACME, answers: { details: "Retry, no task" }, priority: "normal" });
    await q("UPDATE public.cockpit_clickup_writeback_queue SET state='retry' WHERE source_id=$1", [fresh.id]);
    expect((await get(CSM, fresh.id)).canCancel).toBe(true);
    expect((await one<Row>(CSM, "SELECT public.cockpit_request_cancel($1,'Not needed') r", [fresh.id])).state).toBe("cancelled");
  });

  test("RT-5: Request Type turned off reaches the parts still waiting; one being sent keeps its own 2-minute check", async () => {
    await mode("apply");
    const t = await typeRow("csm_request");
    if (!t.set_request_type)
      await one(SM, "SELECT public.cockpit_request_type_save('csm_request','{\"set_request_type\":true}'::jsonb,$1) r", [t.version]);
    const waiting = await submit(CSM, { type: "csm_request", client: ACME, answers: { details: "Waiting" } });
    const retrying = await submit(CSM, { type: "csm_request", client: BETA, answers: { details: "Retrying" } });
    const sending = await submit(CSM, { type: "csm_request", client: ACME, answers: { details: "Sending" }, due: await kuwaitPlus(5) });
    await q("UPDATE public.cockpit_clickup_writeback_queue SET state='retry' WHERE source_id=$1", [retrying.id]);
    await q("UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claimed_at=now(), claim_token=gen_random_uuid() WHERE source_id=$1", [sending.id]);
    for (const id of [waiting.id, retrying.id, sending.id])
      expect((await queueRows(id))[0].payload.setRequestType).toBe(true);
    await svc("SELECT public.cockpit_request_type_rt_off('csm_request','ClickUp moved a task.') r");
    expect((await queueRows(waiting.id))[0].payload.setRequestType).toBe(false);
    expect((await queueRows(retrying.id))[0].payload.setRequestType).toBe(false);
    expect((await queueRows(sending.id))[0].payload.setRequestType).toBe(true);
    const a = await q(
      "SELECT metadata FROM public.cockpit_audit_log WHERE action='request_type.request_type_off' AND entity_id='csm_request' ORDER BY created_at DESC LIMIT 1",
    );
    expect(a[0].metadata.waitingRowsTurnedOff).toBe(2);
    // The part being sent is delivered: its 2-minute check still carries Request Type on.
    await q("UPDATE public.cockpit_clickup_writeback_queue SET state='delivered', task_id='cusent77', delivered_at=now(), claim_token=NULL WHERE source_id=$1 AND kind='request'", [sending.id]);
    const verify = (await q("SELECT payload FROM public.cockpit_clickup_writeback_queue WHERE dedupe_key=$1", [`verify:${sending.id}:main`]))[0];
    expect(verify.payload.setRequestType).toBe(true);
  });
});

describe("review 2026-10-26: the writer hands back what it will not send", () => {
  const TOKEN = "00000000-0000-4000-8000-00000000c1a2";
  const release = (id: string, token: string, planned: unknown, note: string | null, next: string | null) =>
    svc<Row>("SELECT public.cockpit_clickup_writeback_release($1,$2,$3::jsonb,$4,$5::timestamptz) r", [
      id,
      token,
      planned === null ? null : JSON.stringify(planned),
      note,
      next,
    ]);
  const releaseRefused = (id: string, token: string) =>
    svcRefused("SELECT public.cockpit_clickup_writeback_release($1,$2,'[]'::jsonb,'x',NULL)", [id, token]);

  test("release: only the claiming run, only request and task rows; back to queued (or retry with progress), the try taken off", async () => {
    await mode("apply");
    const sent = await submit(SM, { type: "general_tech", client: ACME, answers: { details: "Hand me back" } });
    // As the claim leaves it (older rows of the earlier tests are first in the queue).
    const claimAs = (id: string) =>
      q("UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now(), attempts=attempts+1 WHERE id=$1", [id, TOKEN]);
    const row = (await queueRows(sent.id))[0];
    await claimAs(row.id);
    expect(await releaseRefused(row.id, "00000000-0000-4000-8000-00000000dead")).toBe("This queue item is no longer claimed by this run");
    const note = "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.";
    const next = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(await release(row.id, TOKEN, [{ step: "create" }], note, next)).toEqual({ id: row.id, state: "queued" });
    const after = (await q("SELECT * FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [row.id]))[0];
    expect(after).toMatchObject({ state: "queued", attempts: 0, claim_token: null, claimed_at: null, planned: [{ step: "create" }], error: note });
    expect(new Date(after.next_attempt_at).toISOString()).toBe(next);
    // The part follows, and the request still reads as held once the writer would not take it.
    expect((await parts(sent.id))[0]).toMatchObject({ state: "queued", error: note });
    expect(await releaseRefused(row.id, TOKEN)).toBe("This queue item is no longer claimed by this run");
    // The state change is audited by the queue's own trigger, and the request's history says it waits.
    expect(
      await count("SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type='cockpit_clickup_writeback_queue' AND entity_id=$1 AND action='update:queued'", [row.id]),
    ).toBe(1);
    expect((await one<Row>(SM, "SELECT public.cockpit_request_get($1) r", [sent.id])).history.map((h: Row) => h.what)).toContain(
      "Operations / Tech: waiting in the queue until requests open",
    );
    // With ClickUp progress it goes back as retry.
    await claimAs(row.id);
    await q(
      `UPDATE public.cockpit_clickup_writeback_queue SET progress='{"steps":{"create":{"state":"started"}}}'::jsonb WHERE id=$1`,
      [row.id],
    );
    expect(await release(row.id, TOKEN, null, null, null)).toEqual({ id: row.id, state: "retry" });
    expect((await q("SELECT error, planned FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [row.id]))[0]).toEqual({
      error: note,
      planned: [{ step: "create" }],
    });
    expect((await parts(sent.id))[0].state).toBe("retry");
    // Another kind of row is never released here.
    const other = (
      await q(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, payload, state, claim_token, claimed_at)
         VALUES ('decision:release-test','decision','cockpit_decisions','1','{}'::jsonb,'sending',$1,now()) RETURNING id`,
        [TOKEN],
      )
    )[0].id;
    expect(await releaseRefused(other, TOKEN)).toBe("Only a request or a task change is handed back this way");
    await q("UPDATE public.cockpit_clickup_writeback_queue SET state='skipped', claim_token=NULL, claimed_at=NULL WHERE id=$1", [other]);
    expect(await svcRefused("SELECT public.cockpit_clickup_writeback_release($1,$2,'[]'::jsonb,'x',NULL)", [other, TOKEN])).toBe(
      "This queue item is no longer claimed by this run",
    );
  });

  test("task owners: which request rows made these ClickUp tasks", async () => {
    const sent = await submit(SM, { type: "general_tech", client: ACME, answers: { details: "Owner read" } });
    const qid = (await queueRows(sent.id))[0].id;
    await q("UPDATE public.cockpit_clickup_writeback_queue SET task_id='cuowned01' WHERE id=$1", [qid]);
    expect(await svc("SELECT public.cockpit_clickup_writeback_task_owners(ARRAY['cuowned01','cunobody']) r")).toEqual([
      { taskId: "cuowned01", queueId: qid },
    ]);
    expect(await svc("SELECT public.cockpit_clickup_writeback_task_owners(ARRAY[]::text[]) r")).toEqual([]);
    expect(await refused(SM, "SELECT public.cockpit_clickup_writeback_task_owners(ARRAY['cuowned01'])")).toMatch(/permission denied/);
  });
});
