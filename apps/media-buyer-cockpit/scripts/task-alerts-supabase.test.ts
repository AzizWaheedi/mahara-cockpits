/**
 * Task alerts (20261026t_task_alerts.sql, docs/requests/CONTRACT.md 3 and 9)
 * on an isolated PostgreSQL with Supabase's default privileges on, so a
 * missing REVOKE opens the object here as it would in production.
 *
 * It stands on the real requests core (20261026r_requests.sql, and the seed
 * 20261026s when it is in the tree) and on the real gates: the CEO gate and
 * cockpit_has_role (20260923m), cockpit_client_allowed (20261017b), the
 * editor gate and the role labels (20261025n). The writeback queue, its runs,
 * its audit trigger and the live claim, save, begin, finish and idle are cut
 * from 20261009f. The other tables are cut from their canonical migrations:
 * the sync state (20260921e), the people list (20260919b) and its schedule
 * (20260921b), the onboarding mirror (20261005a) and the Blueprint settings
 * (20261024a). Every person, client, task and ClickUp id is invented. PGlite
 * has no pg_cron, vault or pg_net, so the guarded blocks skip and the kicks
 * only write their notes. Nothing here reaches ClickUp.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const T = "20261026t_task_alerts.sql";
const hasSeed = existsSync(new URL(`../../../supabase/migrations/${S}`, import.meta.url));

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM = "00000000-0000-4000-8000-0000000000a1";
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // the creative strategist
const EDITOR = "00000000-0000-4000-8000-0000000000e2"; // a video editor
const BUYER = "00000000-0000-4000-8000-0000000000f1"; // media buyer, no ClickUp user
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, deactivated

// Invented ClickUp users.
const CU = { ceo: 284616470, sm: 113459516, csm: 113688800, creative: 113520400, editor: 113492660, other: 119413219, outsider: 222000111 };

const TECH = "901816723190";
const CS_LIST = "901816723211";
const ALL_TASKS = "901816723226";
const CARDS = "901816559981";
const VIDEO = "901816720767";
const PERSONAL = "901899999999";

const CARD_A = "cardacme1"; // Acme Interiors
const CARD_B = "cardbeta1"; // Beta Build

let db: PGlite;
type Row = Record<string, any>;
const ids: Record<string, string> = {}; // seat member ids by auth id

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
async function one<T = any>(who: string | null, text: string, params: unknown[] = []): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function refused(who: string | null, text: string, params: unknown[] = []): Promise<{ message: string; code: string }> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    return { message: (e as Error).message, code: String((e as { code?: string }).code ?? "") };
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
async function svcRefused(text: string, params: unknown[] = []): Promise<string> {
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
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}

const MIN = 60_000;
const DAY = 86_400_000;
const KUWAIT = 3 * 3600_000;
const kuwaitDay = (ms: number) => new Date(ms + KUWAIT).toISOString().slice(0, 10);
/** 12:00 Kuwait on a Kuwait day. */
const noon = (day: string) => Date.parse(`${day}T09:00:00Z`);
const today = () => kuwaitDay(Date.now());
const addDays = (day: string, n: number) => kuwaitDay(noon(day) + n * DAY);
/** "Sun 1 Nov", as the alerts write a day. */
const dayWords = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`).toUTCString();
  return `${d.slice(0, 3)} ${Number(day.slice(8))} ${d.slice(8, 11)}`;
};

let clock = Date.now(); // date_updated values only ever go forward
const tick = () => (clock = Math.max(clock + 1, Date.now()));

type TaskIn = Partial<{
  taskId: string;
  listId: string;
  listName: string;
  parentId: string | null;
  name: string;
  status: string;
  statusType: string;
  priority: string | null;
  dueAtMs: number | null;
  dueHasTime: boolean;
  assigneeIds: number[];
  watcherIds: number[];
  creatorId: number | null;
  tags: string[];
  dateCreatedMs: number;
  dateUpdatedMs: number;
  archived: boolean;
  checklistDone: number | null;
  checklistTotal: number | null;
}>;
const tasks = new Map<string, Row>();
function task(id: string, t: TaskIn = {}): Row {
  const prev = tasks.get(id) ?? {};
  const row = {
    taskId: id,
    listId: TECH,
    listName: "Operations / Tech",
    folderId: "901812879297",
    spaceId: "901810248115",
    parentId: null,
    name: `Task ${id}`,
    status: "to do",
    statusType: "open",
    priority: null,
    dueAtMs: null,
    assigneeIds: [],
    watcherIds: [],
    creatorId: CU.outsider,
    tags: [],
    url: `https://app.clickup.com/t/${id}`,
    dateCreatedMs: Date.now() - 2 * DAY,
    dateClosedMs: null,
    archived: false,
    checklistDone: null,
    checklistTotal: null,
    ...prev,
    ...t,
    dateUpdatedMs: t.dateUpdatedMs ?? tick(),
  };
  tasks.set(id, row);
  return row;
}
const upsert = (rows: Row[], source = "delta") =>
  svc<Row>("SELECT public.cockpit_task_mirror_upsert($1::jsonb,$2) r", [JSON.stringify(rows), source]);
const comments = (taskId: string, list: Row[]) =>
  svc<Row>("SELECT public.cockpit_task_mirror_comments($1,$2::jsonb) r", [taskId, JSON.stringify(list)]);
const tickAt = async (ms: number) =>
  (await q<{ r: Row }>("SELECT public.cockpit_task_alerts_tick_at($1::timestamptz) r", [new Date(ms).toISOString()]))[0].r;
const alertsOf = (uid: string) =>
  q("SELECT * FROM public.cockpit_task_alerts WHERE member_id=$1 ORDER BY created_at, dedupe_key", [ids[uid]]);
const alertKeys = async (uid: string) => (await alertsOf(uid)).map(a => a.dedupe_key as string);
const myTasks = (uid: string, cockpit = "portal") => one<Row>(uid, "SELECT public.cockpit_my_tasks($1) r", [cockpit]);
const bell = (uid: string, cockpit = "portal") => one<Row>(uid, "SELECT public.cockpit_task_alerts($1) r", [cockpit]);
const detail = (uid: string, id: string) => one<Row>(uid, "SELECT public.cockpit_task_detail($1) r", [id]);
const act = (uid: string, actionId: string, taskId: string, op: string, payload: Row) =>
  one<Row>(uid, "SELECT public.cockpit_task_act($1,$2,$3,$4::jsonb) r", [actionId, taskId, op, JSON.stringify(payload)]);
const actRefused = (uid: string, actionId: string, taskId: string, op: string, payload: Row) =>
  refused(uid, "SELECT public.cockpit_task_act($1,$2,$3,$4::jsonb)", [actionId, taskId, op, JSON.stringify(payload)]);
const writerMode = (mode: string, onlyCards: string[] = []) =>
  q(
    `INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,detail,updated_at)
     VALUES('clickup-writeback:requests',now(),now(),true,'test',$1::jsonb,now())
     ON CONFLICT (key) DO UPDATE SET detail=EXCLUDED.detail,last_run_at=now(),updated_at=now()`,
    [JSON.stringify({ mode, onlyCards, counts: {}, at: new Date().toISOString() })],
  );
const mirrorState = (job: string, ok: boolean, detail: Row) =>
  svc("SELECT public.cockpit_task_mirror_state($1,$2,'test run',$3::jsonb) r", [job, ok, JSON.stringify(detail)]);
const uuid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
let uuidN = 100;
const nextUuid = () => uuid(uuidN++);

async function requestType(key: string): Promise<Row> {
  const rows = await q("SELECT * FROM public.cockpit_request_types WHERE key=$1", [key]);
  if (!rows[0]) throw new Error(`No request type ${key}`);
  return rows[0];
}
/** A request with one part on ClickUp task `taskId`, as the submit leaves it once the writer delivered. */
async function deliveredRequest(requester: string, taskId: string, opts: { client?: string; clientName?: string; state?: string } = {}) {
  const t = await requestType("general_tech");
  const id = nextUuid();
  await q(
    `INSERT INTO public.cockpit_requests(id,type_key,type_version,type_label,requester_member_id,requester_email,requester_label,source,
       client_task_id,client_name,answers,due_on,priority,state,content_hash)
     VALUES($1,$2,1,$3,$4,'x@tests.invalid','the CSM','requests_page',$5,$6,'{}'::jsonb,current_date+2,'normal',$7,md5($8))`,
    [id, t.key, t.label, ids[requester], opts.client ?? null, opts.clientName ?? null, opts.state ?? "delivered", id],
  );
  await q(
    `INSERT INTO public.cockpit_request_parts(request_id,part,list_id,team,task_name,owner_rule,owner_clickup_id,owner_how,owner_label,state,clickup_task_id,clickup_url)
     VALUES($1,'main',$2,'tech','Fix it','systems_manager',$3,'rule','the systems manager','delivered',$4,$5)`,
    [id, TECH, CU.sm, taskId, `https://app.clickup.com/t/${taskId}`],
  );
  return id;
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The sync state, the people list and its schedule, the onboarding mirror, the Blueprint settings.
  await db.exec(
    cut(migration("20260921e_tap_charges.sql"), /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/, "cockpit_sync_state"),
  );
  await db.exec("ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;");
  await db.exec(cut(migration("20260919b_people.sql"), /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/, "cockpit_people"));
  await db.exec(
    cut(migration("20260921b_people_schedule.sql"), /alter table public\.cockpit_people\s+add column if not exists schedule jsonb;/, "schedule"),
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

  // The writeback queue, its runs and config, its audit trigger and the live functions.
  const wb = migration("20261009f_clickup_writeback_native.sql");
  for (const [pattern, what] of [
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_config\([\s\S]*?\n\);/, "config"],
    [/INSERT INTO public\.cockpit_clickup_writeback_config[^\n]*\n/, "config row"],
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/, "queue"],
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_runs\([\s\S]*?\n\);/, "runs"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/, "audit"],
    [
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);\nDROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_state[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "queue audit triggers",
    ],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_state\([\s\S]*?END \$\$;/, "state"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_claim\([\s\S]*?END \$\$;/, "claim"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_save\([\s\S]*?END \$\$;/, "save"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_begin\([\s\S]*?END \$\$;/, "begin"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_finish\([\s\S]*?END \$\$;/, "finish"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_idle\([\s\S]*?END \$\$;/, "idle"],
  ] as const)
    await db.exec(cut(wb, pattern, `20261009f ${what}`));
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue, public.cockpit_clickup_writeback_runs
      FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_queue, public.cockpit_clickup_writeback_runs,
      public.cockpit_sync_state TO service_role;`);

  // The client gates and the editor gate with the role labels.
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(cut(teamOnly, /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/, "cockpit_is_team_only"));
  await db.exec(
    cut(teamOnly, /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/, "cockpit_client_allowed"),
  );
  const notices = migration("20261025n_slack_notices.sql");
  for (const [pattern, what] of [
    [/CREATE TABLE IF NOT EXISTS public\.cockpit_forms_editors \([\s\S]*?\n\);/, "cockpit_forms_editors"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_role_of\(p_email text\)[\s\S]*?END \$\$;/, "role_of"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_seat_label\(p_email text, p_name text\)[\s\S]*?END \$\$;/, "seat_label"],
    [/CREATE OR REPLACE FUNCTION public\.cockpit_forms_editor_gate\(\)[\s\S]*?END \$\$;/, "editor gate"],
  ] as const)
    await db.exec(cut(notices, pattern, `20261025n ${what}`));
  await db.exec(`
    ALTER TABLE public.cockpit_forms_editors ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_client_onboarding,
      public.cockpit_blueprint_settings, public.cockpit_forms_editors FROM anon, authenticated;
    REVOKE ALL ON FUNCTION public.cockpit_is_team_only(), public.cockpit_client_allowed(text),
      public.cockpit_slack_notice_role_of(text), public.cockpit_slack_notice_seat_label(text,text),
      public.cockpit_forms_editor_gate() FROM PUBLIC, anon, authenticated, service_role;`);

  // Seats and people.
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "sm@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await member(db, EDITOR, "editor@tests.invalid", ["editor"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  for (const uid of [CEO, ADMIN, CSM, CREATIVE, EDITOR, BUYER, GONE])
    ids[uid] = (await db.query<{ id: string }>("SELECT id FROM public.cockpit_members WHERE auth_user_id=$1", [uid])).rows[0].id;
  const week = (on: boolean, start = "09:00", end = "17:00") =>
    Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(d => [d, { on, start, end }]));
  for (const [name, email, role, schedule] of [
    ["Huda M", "sm@tests.invalid", "Systems manager", null],
    ["Noura A", "csm@tests.invalid", "Client success manager", { timezone: "Asia/Kuwait", week: week(true) }],
    ["Omar K", "creative@tests.invalid", "Creative strategist", { timezone: "Asia/Kuwait", week: week(false) }],
    ["Sami E", "editor@tests.invalid", "Video editor", null],
    ["Aziz W", "aziz@maharamedia.com", "CEO", null],
  ] as const)
    await db.query("INSERT INTO public.cockpit_people(name,email,role,active,added_by,schedule) VALUES($1,$2,$3,true,'test',$4::jsonb)", [
      name,
      email,
      role,
      schedule ? JSON.stringify(schedule) : null,
    ]);
  for (const [task, name, status] of [
    [CARD_A, "Acme Interiors", "Active"],
    [CARD_B, "Beta Build", "Active"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,client_status,csm) VALUES($1,$2,$3,'noura')",
      [task, name, status],
    );

  // The requests core, its seed, then this file, each twice.
  await db.exec(migration(R));
  if (hasSeed) await db.exec(migration(S));
  else {
    // Until the seed is in the tree: two types from the seed's own data.
    const data = JSON.parse(readFileSync(new URL("../../../docs/requests/request-types.json", import.meta.url), "utf8"));
    for (const t of data.types.filter((x: Row) => ["general_tech", "client_pause"].includes(x.key)))
      await db.query(
        `INSERT INTO public.cockpit_request_types(key,type_index,label,clickup_option_name,request_type_option_id,team,targets,fields,
           sop_steps,sop_steps_state,sop_url,due_days,priority,set_request_type,enabled,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,'migration') ON CONFLICT DO NOTHING`,
        [
          t.key,
          t.type_index,
          t.label,
          t.clickup_option_name,
          t.request_type_option_id,
          t.team,
          JSON.stringify(t.targets),
          JSON.stringify(t.fields),
          t.sop_steps ? JSON.stringify(t.sop_steps) : null,
          t.sop_steps_state,
          t.sop_url,
          t.due_days,
          t.priority,
          t.set_request_type,
          t.enabled,
        ],
      );
  }
  await db.exec(migration(T));
  await db.exec(migration(R));
  if (hasSeed) await db.exec(migration(S));
  await db.exec(migration(T));

  // The hourly members read links seats by exact email (20261026r).
  await svc("SELECT public.cockpit_clickup_members_sync($1::jsonb) r", [
    JSON.stringify([
      { id: CU.ceo, username: "aziz", email: "aziz@maharamedia.com" },
      { id: CU.sm, username: "huda", email: "sm@tests.invalid" },
      { id: CU.csm, username: "noura", email: "csm@tests.invalid" },
      { id: CU.creative, username: "omar", email: "creative@tests.invalid" },
      { id: CU.editor, username: "sami", email: "editor@tests.invalid" },
      { id: CU.other, username: "someone", email: "someone@tests.invalid" },
    ]),
  ]);
  // A deactivated seat with a hand-made link still gets nothing.
  await db.query(
    "INSERT INTO public.cockpit_member_clickup(member_id,clickup_user_id,state,matched_by,updated_by) VALUES($1,$2,'manual','editor','test')",
    [ids[GONE], CU.other],
  );
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe("the migration", () => {
  const TABLES = ["cockpit_task_mirror", "cockpit_task_alerts", "cockpit_task_alert_rules"];
  test("applies twice; browser roles cannot touch the three tables; the service role only reads them; row security is on", async () => {
    for (const table of TABLES) {
      for (const role of ["anon", "authenticated"])
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"])
          expect((await q<{ ok: boolean }>("SELECT has_table_privilege($1,$2,$3) ok", [role, `public.${table}`, privilege]))[0].ok).toBe(false);
      expect((await q<{ ok: boolean }>("SELECT has_table_privilege('service_role',$1,'SELECT') ok", [`public.${table}`]))[0].ok).toBe(true);
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
        expect((await q<{ ok: boolean }>("SELECT has_table_privilege('service_role',$1,$2) ok", [`public.${table}`, privilege]))[0].ok).toBe(false);
      expect((await q<{ rls: boolean }>("SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass", [`public.${table}`]))[0].rls).toBe(true);
    }
    expect((await refused(CSM, "SELECT * FROM public.cockpit_task_alerts")).message).toContain("permission denied");
    expect(await svcRefused("UPDATE public.cockpit_task_mirror SET name='x'")).toContain("permission denied");
  });

  test("each function has exactly its grant, and every one is a definer with an empty search path", async () => {
    const can = async (role: string, sig: string) =>
      (await q<{ ok: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') ok", [role, sig]))[0].ok;
    const service = [
      "cockpit_task_mirror_inputs()",
      "cockpit_task_mirror_upsert(jsonb,text)",
      "cockpit_task_mirror_seat(bigint,text[])",
      "cockpit_task_mirror_comment_due(integer)",
      "cockpit_task_mirror_comments(text,jsonb,timestamptz,boolean)",
      "cockpit_task_alerts_tick()",
      "cockpit_task_detail_cache(text,jsonb)",
      "cockpit_task_mirror_state(text,boolean,text,jsonb)",
    ];
    const browser = [
      "cockpit_my_tasks(text)",
      "cockpit_task_alerts(text)",
      "cockpit_task_alerts_seen(uuid[])",
      "cockpit_task_detail(text)",
      "cockpit_task_act(uuid,text,text,jsonb)",
      "cockpit_task_alert_rules_read(uuid)",
      "cockpit_task_alert_rules_set(uuid,jsonb)",
    ];
    const internal = [
      "cockpit_task_alert_kinds()",
      "cockpit_task_cockpit(text)",
      "cockpit_task_hidden(text,text,text,boolean)",
      "cockpit_task_alert_hidden(text,public.cockpit_task_alerts)",
      "cockpit_task_my_set(bigint,text,timestamptz)",
      "cockpit_task_mirror_changed(public.cockpit_task_mirror,public.cockpit_task_mirror,boolean,timestamptz)",
      "cockpit_task_audit(text,text,text,text,jsonb,jsonb,jsonb)",
      "cockpit_task_state()",
      "cockpit_task_baseline()",
      "cockpit_task_linked()",
      "cockpit_task_kinds(uuid)",
      "cockpit_task_alert_add(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,text)",
      "cockpit_task_actor_phrase(text,text)",
      "cockpit_task_client_of(text,text,text[])",
      "cockpit_task_row(public.cockpit_task_mirror)",
      "cockpit_task_may_open(jsonb,text)",
      "cockpit_task_requester_of(jsonb,text)",
      "cockpit_task_board(text)",
      "cockpit_task_writer_open(text)",
      "cockpit_task_can(jsonb,public.cockpit_task_mirror)",
      "cockpit_task_comment_author(bigint,text)",
      "cockpit_task_shift(uuid,timestamptz)",
      "cockpit_task_rules_view(uuid,boolean)",
      "cockpit_task_rules_target(jsonb,uuid)",
      "cockpit_task_alerts_guard()",
      "cockpit_task_alert_rules_audit()",
      "cockpit_task_request_failed()",
      "cockpit_task_alerts_tick_at(timestamptz)",
      "cockpit_task_mirror_kick(text)",
    ];
    for (const fn of service) {
      expect(await can("service_role", `public.${fn}`)).toBe(true);
      expect(await can("authenticated", `public.${fn}`)).toBe(false);
      expect(await can("anon", `public.${fn}`)).toBe(false);
    }
    for (const fn of browser) {
      expect(await can("authenticated", `public.${fn}`)).toBe(true);
      expect(await can("service_role", `public.${fn}`)).toBe(false);
      expect(await can("anon", `public.${fn}`)).toBe(false);
    }
    for (const fn of internal) for (const role of ["anon", "authenticated", "service_role"]) expect(await can(role, `public.${fn}`)).toBe(false);
    // Every function this file made is one of the above, a definer, with an empty search path.
    const made = await q<{ name: string; definer: boolean; config: string[] | null }>(
      `SELECT p.oid::regprocedure::text AS name, p.prosecdef AS definer, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND (p.proname LIKE 'cockpit_task%' OR p.proname IN ('cockpit_my_tasks'))`,
    );
    const bare = (sig: string) => sig.replaceAll("public.", "").replace(/\s+/g, "").replace(/timestampwithtimezone/g, "timestamptz");
    const listed = new Set([...service, ...browser, ...internal].map(bare));
    for (const fn of made) {
      if (!listed.has(bare(fn.name))) throw new Error(`Not in the grant lists: ${fn.name}`);
      expect(fn.definer).toBe(true);
      expect(fn.config).toContain('search_path=""');
    }
    expect(made.length).toBe(service.length + browser.length + internal.length);
  });

  test("the kick says what is missing and posts nothing without the vault", async () => {
    expect(await q("SELECT public.cockpit_task_mirror_kick('delta') r")).toEqual([{ r: null }]);
    const [row] = await q("SELECT ok, note FROM public.cockpit_sync_state WHERE key='task-mirror:kick'");
    expect(row.ok).toBe(false);
    expect(row.note).toBe("The vault has no cockpit_tasks_cron_secret, so the task mirror did not run. Add it to the vault.");
    await expect(q("SELECT public.cockpit_task_mirror_kick('other')")).rejects.toThrow("delta or seats");
  });

  test("the seats are linked by email and the inputs name them by role", async () => {
    const inputs = await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r");
    expect(inputs.teamId).toBe("90182518398");
    expect(inputs.allTasksList).toBe(ALL_TASKS);
    expect(inputs.fieldsList).toBe(TECH);
    expect(inputs.cursorMs).toBeNull();
    expect(inputs.baselinedAt).toBeNull();
    expect(inputs.linked.map((l: Row) => Number(l.clickupUserId)).sort()).toEqual([CU.ceo, CU.csm, CU.editor, CU.creative, CU.sm].sort());
    expect(inputs.linked.find((l: Row) => Number(l.clickupUserId) === CU.sm).label).toBe("the systems manager");
    expect(inputs.notLinked).toBe(1); // the media buyer
  });
});

describe("before the baseline", () => {
  test("no read makes an alert, and comments are not even asked for", async () => {
    const r = await upsert([task("pre1", { assigneeIds: [CU.csm], dueAtMs: noon(today()) })]);
    expect(r).toEqual({ upserted: 1, alerts: 0, skipped: 0 });
    expect(await comments("pre1", [{ id: "90001", authorId: CU.sm, atMs: Date.now(), text: "hello", tagIds: [CU.csm] }])).toEqual({ alerts: 0 });
    expect(await svc("SELECT public.cockpit_task_mirror_comment_due(40) r")).toEqual([]);
    expect(await tickAt(noon(today()) + 6 * 3600_000)).toEqual({ dueToday: 0, overdue: 0 });
    expect(await count("SELECT count(*) n FROM public.cockpit_task_alerts")).toBe(0);
  });

  test("a seats run that did not finish every seat sets no baseline; a complete one sets it once", async () => {
    await mirrorState("seats", false, { members: 6, linked: 5, seats: 4, complete: false });
    expect((await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r")).baselinedAt).toBeNull();
    await mirrorState("seats", true, { members: 6, linked: 5, seats: 5, complete: true, baselinedAt: "2020-01-01T00:00:00Z" });
    const first = (await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r")).baselinedAt;
    expect(first).not.toBeNull();
    expect(Date.parse(first)).toBeGreaterThan(Date.now() - 60 * MIN);
    await mirrorState("seats", true, { complete: true });
    expect((await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r")).baselinedAt).toBe(first);
    // One audit row a run, from the cron.
    const runs = await q("SELECT * FROM public.cockpit_audit_log WHERE action='task_mirror.run' AND entity_id='task-mirror:seats'");
    expect(runs.length).toBe(3);
    expect(runs.every(r => r.source_system === "cron" && r.source_app === "shared-cockpits")).toBe(true);
    // The delta's cursor never goes back.
    await mirrorState("delta", true, { cursorMs: 2000, pages: 1, tasks: 1 });
    await mirrorState("delta", true, { cursorMs: 1000, pages: 1, tasks: 1 });
    expect(Number((await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r")).cursorMs)).toBe(2000);
  });
});

describe("alerts after the baseline", () => {
  test("assigned: once, only to the seat added, from any read that carries ClickUp's change, never to the creator or the requester", async () => {
    // Added to an existing task in a delta.
    expect((await upsert([task("pre1", { assigneeIds: [CU.csm, CU.sm] })])).alerts).toBe(1);
    expect(await alertKeys(ADMIN)).toEqual([`assigned:pre1:${ids[ADMIN]}:${tasks.get("pre1")!.dateUpdatedMs}`]);
    const [a] = await alertsOf(ADMIN);
    expect(a.title).toBe("Task pre1");
    expect(a.body).toBe("Assigned to you");
    expect(a.kind).toBe("assigned");
    // The same read again changes nothing.
    expect((await upsert([tasks.get("pre1")!])).alerts).toBe(0);
    // Review 2026-10-26 (contract F1): an hourly seat read or a focus view read that carries a change
    // ClickUp made (its date_updated moved on) alerts like the delta would have; the delta that reads
    // the same change later says nothing more.
    expect((await upsert([task("pre1", { assigneeIds: [CU.csm, CU.sm, CU.creative] })], "seat")).alerts).toBe(1);
    expect(await alertKeys(CREATIVE)).toEqual([`assigned:pre1:${ids[CREATIVE]}:${tasks.get("pre1")!.dateUpdatedMs}`]);
    expect((await upsert([tasks.get("pre1")!])).alerts).toBe(0);
    // The mirror correcting itself (a seat read putting back an id the mirror took off, ClickUp
    // unchanged) says nothing.
    expect((await svc<Row>("SELECT public.cockpit_task_mirror_seat($1,ARRAY[]::text[]) r", [CU.creative])).removed).toBe(1);
    expect((await upsert([tasks.get("pre1")!], "seat")).alerts).toBe(0);
    expect((await q("SELECT assignee_ids FROM public.cockpit_task_mirror WHERE task_id='pre1'"))[0].assignee_ids.map(Number)).toContain(CU.creative);
    // A task new to the mirror from a focus view read, changed after the baseline, alerts.
    expect((await upsert([task("seat1", { assigneeIds: [CU.creative] })], "detail")).alerts).toBe(1);
    // An old task a seat read finds for the first time (unchanged since before the baseline) never
    // floods the bell, from any read.
    expect((await upsert([task("old-seat1", { assigneeIds: [CU.creative], dateUpdatedMs: Date.now() - 3 * DAY })], "seat")).alerts).toBe(0);
    expect((await upsert([task("old-seat2", { assigneeIds: [CU.creative], dateUpdatedMs: Date.now() - 3 * DAY })])).alerts).toBe(0);
    expect((await alertKeys(CREATIVE)).filter(k => k.startsWith("assigned:"))).toEqual([
      `assigned:pre1:${ids[CREATIVE]}:${tasks.get("pre1")!.dateUpdatedMs}`,
      `assigned:seat1:${ids[CREATIVE]}:${tasks.get("seat1")!.dateUpdatedMs}`,
    ]);
    // A new task: the seat that made it is not told; the other assignee is.
    expect((await upsert([task("new1", { assigneeIds: [CU.sm, CU.editor], creatorId: CU.sm })])).alerts).toBe(1);
    expect((await alertKeys(EDITOR)).some(k => k.startsWith("assigned:new1:"))).toBe(true);
    expect((await alertKeys(ADMIN)).some(k => k.startsWith("assigned:new1:"))).toBe(false);
    // Unlinked, deactivated and unknown people get nothing; a closed task says nothing.
    expect((await upsert([task("new2", { assigneeIds: [CU.other, CU.outsider] })])).alerts).toBe(0);
    expect((await upsert([task("new3", { assigneeIds: [CU.csm], status: "complete", statusType: "done" })])).alerts).toBe(0);
    // A client card itself is never an assignment alert; a real subtask on a card is (ask F2).
    expect((await upsert([task("cardx1", { listId: CARDS, assigneeIds: [CU.csm] })])).alerts).toBe(0);
    expect((await upsert([task("cardsub1", { listId: CARDS, parentId: "cardx1", assigneeIds: [CU.csm] })])).alerts).toBe(1);
    expect((await alertKeys(CSM)).some(k => k.startsWith("assigned:cardsub1:"))).toBe(true);
    expect(await count("SELECT count(*) n FROM public.cockpit_task_alerts WHERE member_id=$1", [ids[GONE]])).toBe(0);
  });

  test("assigned: the seat that filed the request is not told about its own ticket", async () => {
    const rid = await deliveredRequest(ADMIN, "req1");
    expect((await upsert([task("req1", { assigneeIds: [CU.sm, CU.csm], creatorId: CU.ceo })])).alerts).toBe(1);
    expect((await alertKeys(ADMIN)).some(k => k.startsWith("assigned:req1:"))).toBe(false);
    expect((await alertKeys(CSM)).some(k => k.startsWith("assigned:req1:"))).toBe(true);
    // The part takes the mirror's status and owners.
    const [part] = await q("SELECT * FROM public.cockpit_request_parts WHERE request_id=$1", [rid]);
    expect(part.status).toBe("to do");
    expect(part.status_type).toBe("open");
    expect(part.assignee_ids.map(Number).sort()).toEqual([CU.csm, CU.sm].sort());
    expect(part.mirrored_at).not.toBeNull();
  });

  test("status: a move by someone else alerts its assignees; the seat's own Mark done does not", async () => {
    expect((await upsert([task("pre1", { status: "in progress", statusType: "custom" })])).alerts).toBe(3);
    const [s] = (await alertsOf(CSM)).filter(a => a.kind === "status");
    expect(s.body).toBe("Moved to in progress");
    // The systems manager's own press settled delivered a moment ago.
    await q(
      `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload,state,delivered_at)
       VALUES('task:own-done','task_action','cockpit_task_mirror','pre1','pre1',$1::jsonb,'delivered',now())`,
      [JSON.stringify({ op: "done", actor: { memberId: ids[ADMIN] } })],
    );
    await upsert([task("pre1", { status: "review", statusType: "custom" })]);
    const adminStatus = (await alertsOf(ADMIN)).filter(a => a.kind === "status").map(a => a.body);
    expect(adminStatus).toEqual(["Moved to in progress"]);
    expect((await alertsOf(CSM)).filter(a => a.kind === "status").map(a => a.body)).toEqual(["Moved to in progress", "Moved to review"]);
  });

  test("a stale read never takes the mirror back", async () => {
    const before = (await q("SELECT status, date_updated FROM public.cockpit_task_mirror WHERE task_id='pre1'"))[0];
    await upsert([{ ...tasks.get("pre1")!, status: "to do", dateUpdatedMs: tasks.get("pre1")!.dateUpdatedMs - 5000 }]);
    const after = (await q("SELECT status, date_updated FROM public.cockpit_task_mirror WHERE task_id='pre1'"))[0];
    expect(after).toEqual(before);
  });

  test("a seat's rules decide its kinds", async () => {
    await one(EDITOR, "SELECT public.cockpit_task_alert_rules_set(NULL,$1::jsonb) r", [JSON.stringify({ kinds: ["mention"] })]);
    expect((await upsert([task("new4", { assigneeIds: [CU.editor] })])).alerts).toBe(0);
    await one(EDITOR, "SELECT public.cockpit_task_alert_rules_set(NULL,$1::jsonb) r", [
      JSON.stringify({ kinds: ["assigned", "due_today", "overdue", "comment", "mention", "status", "request_done"] }),
    ]);
  });

  test("comments and mentions: by someone else on the seat's task, never the writer, the cockpit's own notes alert nobody", async () => {
    // The last read of these comments was before the baseline, an hour ago.
    await q("UPDATE public.cockpit_task_mirror SET comments_read_at=now()-interval '1 hour' WHERE task_id='pre1'");
    const now = Date.now();
    const r = await comments("pre1", [
      { id: "c-old", authorId: CU.sm, atMs: now - 3 * 3600_000, text: "too old" },
      { id: "c1", authorId: CU.sm, atMs: now - 1000, text: "Can you check this?" },
      { id: "c2", authorId: CU.ceo, atMs: now - 900, text: "Cockpit · the CSM asked Operations / Tech: X\n\nCockpit ref R-1a2b3c4d5e-main-card" },
      { id: "c3", authorId: CU.csm, atMs: now - 800, text: "@Huda look", tagIds: [CU.sm] },
    ]);
    // c1 to the CSM and the creative strategist (assignees, not the writer); c3 mentions the systems
    // manager and is a comment for the creative strategist.
    expect(r.alerts).toBe(4);
    const csm = (await alertsOf(CSM)).filter(a => a.kind === "comment" || a.kind === "mention");
    expect(csm.map(a => [a.dedupe_key, a.body])).toEqual([[`comment:c1:${ids[CSM]}`, "The systems manager commented"]]);
    const sm = (await alertsOf(ADMIN)).filter(a => a.kind === "comment" || a.kind === "mention");
    expect(sm.map(a => [a.dedupe_key, a.body])).toEqual([[`mention:c3:${ids[ADMIN]}`, "The CSM mentioned you"]]);
    expect((await alertsOf(CREATIVE)).filter(a => a.kind === "comment").map(a => [a.dedupe_key, a.body])).toEqual([
      [`comment:c1:${ids[CREATIVE]}`, "The systems manager commented"],
      [`comment:c3:${ids[CREATIVE]}`, "The CSM commented"],
    ]);
    // The read moves the cut-off: the same comments again make nothing.
    expect((await comments("pre1", [{ id: "c1", authorId: CU.sm, atMs: now - 1000, text: "Can you check this?" }])).alerts).toBe(0);
    expect((await q("SELECT comments_read_at FROM public.cockpit_task_mirror WHERE task_id='pre1'"))[0].comments_read_at).not.toBeNull();
  });

  test("a teammate's focus view comment is told by that seat's role, and not to that seat", async () => {
    await upsert([task("cm2", { assigneeIds: [CU.ceo, CU.csm] })]);
    await q(
      `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload,state)
       VALUES('task:csm-comment','task_action','cockpit_task_mirror','cm2','cm2',$1::jsonb,'delivered')`,
      [JSON.stringify({ op: "comment", ref: "T-abcdef0123", actor: { memberId: ids[CSM], label: "the CSM" } })],
    );
    const r = await comments("cm2", [
      { id: "c9", authorId: CU.ceo, atMs: Date.now(), text: "The CSM wrote in the cockpit: done\n\nCockpit ref T-abcdef0123" },
    ]);
    expect(r.alerts).toBe(1);
    expect((await alertsOf(CEO)).filter(a => a.kind === "comment").map(a => a.body)).toEqual(["The CSM commented"]);
    expect((await alertsOf(CSM)).filter(a => a.dedupe_key.startsWith("comment:c9"))).toEqual([]);
  });

  test("the API user's note with no cockpit marker is the CEO's (F8): a mention in it alerts as the CEO; its plain notes alert nobody", async () => {
    await upsert([task("cm3", { assigneeIds: [CU.csm, CU.sm] })]);
    const r = await comments("cm3", [
      { id: "m1", authorId: CU.ceo, atMs: Date.now(), text: "Make: @Noura the kickoff is in", tagIds: [CU.csm] },
      { id: "m2", authorId: CU.ceo, atMs: Date.now(), text: "Make: card updated" },
    ]);
    expect(r.alerts).toBe(1);
    const [m] = (await alertsOf(CSM)).filter(a => a.task_id === "cm3" && a.kind !== "assigned");
    expect([m.kind, m.body, m.actor_label]).toEqual(["mention", "The CEO mentioned you", "the CEO"]);
    expect((await alertsOf(ADMIN)).filter(a => a.task_id === "cm3" && a.kind !== "assigned")).toEqual([]);
  });

  test("a mention on a client card alerts; a comment there does not", async () => {
    const r = await comments("cardx1", [
      { id: "k1", authorId: CU.sm, atMs: Date.now(), text: "@Noura see", tagIds: [CU.csm] },
      { id: "k2", authorId: CU.sm, atMs: Date.now(), text: "plain note" },
    ]);
    expect(r.alerts).toBe(1);
    expect((await alertsOf(CSM)).filter(a => a.task_id === "cardx1").map(a => a.kind)).toEqual(["mention"]);
  });

  test("comments due: changed after their cut-off, a linked seat's tasks first, capped", async () => {
    await upsert([task("cd1", { assigneeIds: [CU.outsider] }), task("cd2", { assigneeIds: [CU.csm] })]);
    const due = await svc<Row[]>("SELECT public.cockpit_task_mirror_comment_due(60) r");
    const order = due.map(d => d.taskId);
    expect(order).toContain("cd1");
    expect(order).toContain("cd2");
    expect(order.indexOf("cd2")).toBeLessThan(order.indexOf("cd1"));
    expect(order).not.toContain("cm2"); // read just now
    expect(due.every(d => typeof d.sinceMs === "number")).toBe(true);
    expect((await svc<Row[]>("SELECT public.cockpit_task_mirror_comment_due(1) r")).length).toBe(1);
    expect((await svc<Row[]>("SELECT public.cockpit_task_mirror_comment_due(500) r")).length).toBeLessThanOrEqual(60);
  });

  test("due today and overdue: after the shift starts, once, only for what fell due after the alerts began", async () => {
    // A working day at least two days ahead, Sunday to Thursday.
    let day = addDays(today(), 2);
    while (![0, 1, 2, 3, 4].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
    const yesterday = addDays(day, -1);
    await upsert([
      task("due1", { assigneeIds: [CU.sm, CU.csm, CU.creative, CU.editor], dueAtMs: noon(day) }),
      task("due2", { assigneeIds: [CU.sm], dueAtMs: noon(day) - 3 * 3600_000 }),
      task("late1", { assigneeIds: [CU.sm, CU.csm], dueAtMs: noon(yesterday) }),
      task("old1", { assigneeIds: [CU.sm], dueAtMs: noon(addDays(today(), -3)) }),
      task("card2", { listId: CARDS, assigneeIds: [CU.sm], dueAtMs: noon(day) }),
    ]);
    // 08:30 Kuwait: nobody's shift has started (the CSM starts at 09:00 by schedule).
    expect(await tickAt(Date.parse(`${day}T05:30:00Z`))).toEqual({ dueToday: 0, overdue: 0 });
    // The editor's own shift starts at 13:00.
    await one(EDITOR, "SELECT public.cockpit_task_alert_rules_set(NULL,$1::jsonb) r", [JSON.stringify({ shiftStart: "13:00", shiftEnd: "20:00" })]);
    // 12:00 Kuwait: the CSM (schedule) and the systems manager (the default 10:00) have started; the
    // creative strategist's schedule has every day off; the editor starts later. Both are late on
    // late1 and on pre1 (due today, real time, so late by then).
    const noonTick = await tickAt(noon(day));
    expect(noonTick).toEqual({ dueToday: 2, overdue: 4 });
    const sm = (await alertsOf(ADMIN)).filter(a => a.kind === "due_today" || a.kind === "overdue");
    expect(sm.map(a => [a.kind, a.title, a.body])).toEqual([
      ["due_today", "2 tasks are due today", "Open Your tasks to see them."],
      ["overdue", "Task late1", `Was due ${dayWords(yesterday)}`],
      ["overdue", "Task pre1", `Was due ${dayWords(today())}`],
    ]);
    expect((await alertsOf(CSM)).filter(a => a.kind === "due_today").map(a => a.title)).toEqual(["1 task is due today"]);
    expect((await alertsOf(CREATIVE)).filter(a => a.kind === "due_today")).toEqual([]);
    expect((await alertsOf(EDITOR)).filter(a => a.kind === "due_today")).toEqual([]);
    // Again the same day: nothing new. After 13:00 the editor's comes.
    expect(await tickAt(noon(day) + 30 * MIN)).toEqual({ dueToday: 0, overdue: 0 });
    expect(await tickAt(noon(day) + 90 * MIN)).toEqual({ dueToday: 1, overdue: 0 });
    // Overdue for a task that was already late when the alerts began: never.
    expect((await alertKeys(ADMIN)).some(k => k.startsWith("overdue:old1:"))).toBe(false);
  });

  test("request done: a part's task done or closed in ClickUp tells the seat that asked, once", async () => {
    const rid = await deliveredRequest(CSM, "req2", { client: CARD_A, clientName: "Acme Interiors" });
    await upsert([task("req2", { assigneeIds: [CU.sm] })]);
    expect((await alertsOf(CSM)).filter(a => a.kind === "request_done")).toEqual([]);
    await upsert([task("req2", { status: "complete", statusType: "done" })]);
    const done = (await alertsOf(CSM)).filter(a => a.kind === "request_done");
    expect(done.map(a => [a.dedupe_key, a.title, a.body, a.request_id])).toEqual([
      [`request_done:${rid}:main`, "General tech request: Acme Interiors", "Done in ClickUp.", rid],
    ]);
    expect((await q("SELECT done_at FROM public.cockpit_requests WHERE id=$1", [rid]))[0].done_at).not.toBeNull();
    // Reopened: done_at clears; closed again: no second alert.
    await upsert([task("req2", { status: "in progress", statusType: "custom" })]);
    expect((await q("SELECT done_at FROM public.cockpit_requests WHERE id=$1", [rid]))[0].done_at).toBeNull();
    await upsert([task("req2", { status: "closed", statusType: "closed" })]);
    expect((await alertsOf(CSM)).filter(a => a.kind === "request_done").length).toBe(1);
    // The task's client is the request's card.
    expect((await q("SELECT client_task_id FROM public.cockpit_task_mirror WHERE task_id='req2'"))[0].client_task_id).toBe(CARD_A);
  });

  test("request failed: a part that did not reach ClickUp tells the seat that asked, linked or not; a cancelled one does not", async () => {
    const t = await requestType("general_tech");
    const id = nextUuid();
    await q(
      `INSERT INTO public.cockpit_requests(id,type_key,type_version,type_label,requester_member_id,requester_email,requester_label,source,
         answers,due_on,priority,state,content_hash)
       VALUES($1,$2,1,$3,$4,'buyer@tests.invalid','the media buyer','requests_page','{}'::jsonb,current_date+2,'normal','sending',md5($5))`,
      [id, t.key, t.label, ids[BUYER], id],
    );
    const [queued] = await q<{ id: string }>(
      `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,payload)
       VALUES($1,'request','cockpit_requests',$2,$3::jsonb) RETURNING id`,
      [`request:${id}:main`, id, JSON.stringify({ requestId: id, part: "main", typeKey: t.key })],
    );
    await q(
      `INSERT INTO public.cockpit_request_parts(request_id,part,list_id,team,task_name,owner_rule,owner_how,owner_label,queue_id)
       VALUES($1,'main',$2,'tech','Fix','systems_manager','rule','the systems manager',$3)`,
      [id, TECH, queued.id],
    );
    await q("UPDATE public.cockpit_clickup_writeback_queue SET state='failed', error='clickup rejected the request (400)' WHERE id=$1", [queued.id]);
    const failed = (await alertsOf(BUYER)).filter(a => a.kind === "request_failed");
    expect(failed.map(a => [a.title, a.body])).toEqual([["General tech request", "Did not reach ClickUp: clickup rejected the request (400)"]]);
    // The unlinked seat's bell shows it.
    const b = await bell(BUYER);
    expect(b.link).toBe("not_linked");
    expect(b.alerts.map((a: Row) => a.kind)).toEqual(["request_failed"]);
    expect(b.unread).toBe(1);
    // Cancelled first, then skipped: no alert.
    const id2 = nextUuid();
    await q(
      `INSERT INTO public.cockpit_requests(id,type_key,type_version,type_label,requester_member_id,requester_label,source,
         answers,priority,state,content_hash)
       VALUES($1,$2,1,$3,$4,'the media buyer','requests_page','{}'::jsonb,'normal','cancelled',md5($5))`,
      [id2, t.key, t.label, ids[BUYER], id2],
    );
    await q(
      `INSERT INTO public.cockpit_request_parts(request_id,part,list_id,team,task_name,owner_rule,owner_how,owner_label,state)
       VALUES($1,'main',$2,'tech','Fix','systems_manager','rule','the systems manager','skipped')`,
      [id2, TECH],
    );
    expect((await alertsOf(BUYER)).filter(a => a.kind === "request_failed").length).toBe(1);
  });
});

describe("Your tasks", () => {
  test("not linked is said, never an empty list", async () => {
    const r = await myTasks(BUYER);
    expect(r.link).toBe("not_linked");
    expect(r.tasks).toEqual([]);
    expect(r.note).toBe("Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.");
  });

  test("open tasks only, late first (oldest due first), then today, then newest; subtasks under a listed parent fold in", async () => {
    const t0 = today();
    const created = Date.now() - 10 * DAY;
    await upsert([
      task("o-late2", { assigneeIds: [CU.other], dueAtMs: noon(addDays(t0, -2)), dateCreatedMs: created }),
      task("o-late5", { assigneeIds: [CU.other], dueAtMs: noon(addDays(t0, -5)), dateCreatedMs: created }),
      task("o-today", { assigneeIds: [CU.other], dueAtMs: noon(t0) + 8 * 3600_000, dateCreatedMs: created }),
      task("o-new", { assigneeIds: [CU.other], dateCreatedMs: Date.now() - DAY }),
      task("o-older", { assigneeIds: [CU.other], dateCreatedMs: Date.now() - 3 * DAY }),
      task("o-sub", { assigneeIds: [CU.other], parentId: "o-new", dateCreatedMs: Date.now() - 1000 }),
      task("o-orphan", { assigneeIds: [CU.other], parentId: "nobodys", dateCreatedMs: Date.now() - 4 * DAY }),
      task("o-done", { assigneeIds: [CU.other], status: "complete", statusType: "done" }),
      task("o-closed", { assigneeIds: [CU.other], status: "closed", statusType: "closed" }),
      task("o-arch", { assigneeIds: [CU.other], archived: true }),
      task("o-card", { assigneeIds: [CU.other], listId: CARDS }),
      task("o-video", { assigneeIds: [CU.other], listId: VIDEO, listName: "Video Pipeline", dateCreatedMs: Date.now() - 5 * DAY }),
    ]);
    // Link the media buyer to that ClickUp user by hand, as an editor would.
    await one(ADMIN, "SELECT public.cockpit_member_clickup_set($1,$2) r", [ids[BUYER], CU.other]);
    await mirrorState("delta", true, { cursorMs: Date.now(), pages: 1, tasks: 12 });
    const r = await myTasks(BUYER);
    expect(r.link).toBe("linked");
    expect(r.ready).toBe(true);
    expect(r.note).toBeNull();
    // new2 (an earlier test's, made two days ago) sits between the one-day and three-day ones.
    expect(r.tasks.map((t: Row) => t.taskId)).toEqual(["o-late5", "o-late2", "o-today", "o-new", "new2", "o-older", "o-orphan", "o-video"]);
    expect(r.counts).toEqual({ overdue: 2, today: 1, total: 8 });
    expect(r.more).toBe(0);
    const [late] = r.tasks;
    expect(late.overdue).toBe(true);
    expect(late.dueToday).toBe(false);
    expect(late.dueOn).toBe(addDays(t0, -5));
    expect(r.tasks[2].dueToday).toBe(true);
    // The editor cockpit leaves Video Pipeline to its Jobs page.
    expect((await myTasks(BUYER, "editor")).tasks.map((t: Row) => t.taskId)).not.toContain("o-video");
    await expect(myTasks(BUYER, "elsewhere")).rejects.toThrow("Unknown cockpit");
  });

  test("ready is false once the mirror is late or failed; the row says what it holds", async () => {
    await q("UPDATE public.cockpit_sync_state SET last_ok_at=now()-interval '11 minutes' WHERE key='task-mirror:delta'");
    const r = await myTasks(BUYER);
    expect(r.ready).toBe(false);
    expect(Date.parse(r.sourceAt)).toBeLessThan(Date.now() - 10 * MIN);
    await mirrorState("delta", false, { cursorMs: Date.now() });
    expect((await myTasks(BUYER)).ready).toBe(false);
    await mirrorState("delta", true, { cursorMs: Date.now() });
    expect((await myTasks(BUYER)).ready).toBe(true);
    const row = (await myTasks(CSM)).tasks.find((t: Row) => t.taskId === "req2");
    expect(row).toBeUndefined(); // closed
    const pre = (await myTasks(CSM)).tasks.find((t: Row) => t.taskId === "pre1");
    expect(pre).toMatchObject({ title: "Task pre1", listId: TECH, listName: "Operations / Tech", status: "review", url: "https://app.clickup.com/t/pre1" });
  });

  test("at most 200 rows, with the rest counted", async () => {
    const many = Array.from({ length: 201 }, (_, i) => task(`bulk${i}`, { assigneeIds: [CU.outsider] }));
    await upsert(many.slice(0, 200));
    await upsert(many.slice(200));
    await q(
      "INSERT INTO public.cockpit_member_clickup(member_id,clickup_user_id,state,matched_by,updated_by) VALUES($1,$2,'manual','editor','test') ON CONFLICT (member_id) DO UPDATE SET clickup_user_id=EXCLUDED.clickup_user_id, state='manual'",
      [ids[BUYER], CU.outsider],
    );
    const r = await myTasks(BUYER);
    expect(r.tasks.length).toBe(200);
    expect(r.counts.total).toBeGreaterThanOrEqual(201);
    expect(r.more).toBe(r.counts.total - 200);
    await expect(upsert(Array.from({ length: 201 }, (_, i) => task(`bulk${i}`)))).rejects.toThrow("at most 200");
    await one(ADMIN, "SELECT public.cockpit_member_clickup_set($1,$2) r", [ids[BUYER], CU.other]);
  });

  test("a seat read takes the seat off tasks it no longer holds; unseen rows go after 7 days", async () => {
    await upsert([task("gone1", { assigneeIds: [CU.other] }), task("gone2", { assigneeIds: [CU.other] })]);
    const r = await svc<Row>("SELECT public.cockpit_task_mirror_seat($1,$2::text[]) r", [CU.other, ["o-late2", "o-late5", "o-today", "o-new", "o-older", "o-sub", "o-orphan", "o-video", "gone2"]]);
    // gone1, and the open rows on lists Your tasks leaves out (new2, o-card, o-arch).
    expect(r.removed).toBe(4);
    expect((await q("SELECT assignee_ids FROM public.cockpit_task_mirror WHERE task_id='gone1'"))[0].assignee_ids).toEqual([]);
    expect((await q("SELECT assignee_ids FROM public.cockpit_task_mirror WHERE task_id='gone2'"))[0].assignee_ids.map(Number)).toEqual([CU.other]);
    await q("UPDATE public.cockpit_task_mirror SET seen_at=now()-interval '8 days' WHERE task_id='gone2'");
    await svc("SELECT public.cockpit_task_mirror_seat($1,$2::text[]) r", [CU.outsider, []]);
    expect((await q("SELECT gone_at FROM public.cockpit_task_mirror WHERE task_id='gone2'"))[0].gone_at).not.toBeNull();
    expect((await myTasks(BUYER)).tasks.map((t: Row) => t.taskId)).not.toContain("gone2");
    // A new read brings it back.
    await upsert([task("gone2", {})], "seat");
    expect((await q("SELECT gone_at FROM public.cockpit_task_mirror WHERE task_id='gone2'"))[0].gone_at).toBeNull();
  });
});

describe("the bell", () => {
  test("only the seat's own alerts, newest first, the cockpit's lists applied, with the unread count", async () => {
    const b = await bell(CSM);
    expect(b.link).toBe("linked");
    expect(b.note).toBeNull();
    expect(b.alerts.length).toBeGreaterThan(3);
    expect(b.alerts.every((a: Row) => typeof a.id === "string" && typeof a.read === "boolean")).toBe(true);
    const ats = b.alerts.map((a: Row) => Date.parse(a.at));
    expect([...ats].sort((x, y) => y - x)).toEqual(ats);
    expect(b.unread).toBe(b.alerts.filter((a: Row) => !a.read).length);
    // The client card mention shows; nobody else's alerts do.
    expect(b.alerts.some((a: Row) => a.kind === "mention" && a.taskId === "cardx1")).toBe(true);
    const mine = new Set((await alertsOf(CSM)).map(a => a.id));
    expect(b.alerts.every((a: Row) => mine.has(a.id))).toBe(true);
    // The editor desk shows its own Video Pipeline alerts (ask F1); only its Your tasks leaves them to
    // the Jobs page.
    await upsert([task("vid1", { listId: VIDEO, assigneeIds: [CU.editor] })]);
    expect((await bell(EDITOR, "portal")).alerts.some((a: Row) => a.taskId === "vid1")).toBe(true);
    expect((await bell(EDITOR, "editor")).alerts.some((a: Row) => a.taskId === "vid1")).toBe(true);
    expect((await myTasks(EDITOR, "editor")).tasks.some((t: Row) => t.taskId === "vid1")).toBe(false);
    expect((await myTasks(EDITOR, "portal")).tasks.some((t: Row) => t.taskId === "vid1")).toBe(true);
    // A card's subtask alert shows; the card's own (made before this rule) would not.
    expect(b.alerts.some((a: Row) => a.taskId === "cardsub1" && a.kind === "assigned")).toBe(true);
    // Alerts older than 14 days drop off.
    const old = (await alertsOf(CSM))[0];
    await q("ALTER TABLE public.cockpit_task_alerts DISABLE TRIGGER cockpit_task_alerts_guard");
    await q("UPDATE public.cockpit_task_alerts SET at=now()-interval '15 days' WHERE id=$1", [old.id]);
    await q("ALTER TABLE public.cockpit_task_alerts ENABLE TRIGGER cockpit_task_alerts_guard");
    expect((await bell(CSM)).alerts.some((a: Row) => a.id === old.id)).toBe(false);
  });

  test("mark read: only the seat's own unread alerts, at most 200, one audit row", async () => {
    const theirs = (await alertsOf(ADMIN))[0];
    const mine = (await alertsOf(CSM)).filter(a => !a.read_at).slice(0, 2);
    const r = await one<Row>(CSM, "SELECT public.cockpit_task_alerts_seen($1::uuid[]) r", [[...mine.map(a => a.id), theirs.id]]);
    expect(r).toEqual({ ok: true, marked: 2 });
    expect((await q("SELECT read_at FROM public.cockpit_task_alerts WHERE id=$1", [theirs.id]))[0].read_at).toBeNull();
    const audit = await q("SELECT * FROM public.cockpit_audit_log WHERE action='task_alerts.seen' AND entity_id=$1", [ids[CSM]]);
    expect(audit.length).toBe(1);
    expect(audit[0].actor_email).toBe("csm@tests.invalid");
    expect(audit[0].source_system).toBe("supabase");
    expect(audit[0].metadata.count).toBe(2);
    expect(await one<Row>(CSM, "SELECT public.cockpit_task_alerts_seen($1::uuid[]) r", [mine.map(a => a.id)])).toEqual({ ok: true, marked: 0 });
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log WHERE action='task_alerts.seen'")).toBe(1);
    const tooMany = Array.from({ length: 250 }, (_, i) => uuid(9000 + i));
    expect((await one<Row>(CSM, "SELECT public.cockpit_task_alerts_seen($1::uuid[]) r", [tooMany])).marked).toBe(0);
  });

  test("an alert changes once and is never deleted", async () => {
    const [a] = (await alertsOf(CSM)).filter(x => x.read_at);
    await expect(q("UPDATE public.cockpit_task_alerts SET read_at=now() WHERE id=$1", [a.id])).rejects.toThrow("only changes once");
    const [b] = (await alertsOf(CSM)).filter(x => !x.read_at);
    await expect(q("UPDATE public.cockpit_task_alerts SET title='x', read_at=now() WHERE id=$1", [b.id])).rejects.toThrow("only changes once");
    await expect(q("DELETE FROM public.cockpit_task_alerts WHERE id=$1", [b.id])).rejects.toThrow("never deleted");
    await expect(q("TRUNCATE public.cockpit_task_alerts")).rejects.toThrow("never deleted");
  });

  test("a seat that is deleted takes its alerts and rules with it", async () => {
    const TEMP = "00000000-0000-4000-8000-0000000000f9";
    await member(db, TEMP, "temp@tests.invalid", ["csm"]);
    const [m] = await q<{ id: string }>("SELECT id FROM public.cockpit_members WHERE auth_user_id=$1", [TEMP]);
    await q(
      `INSERT INTO public.cockpit_task_alerts(member_id,kind,dedupe_key,title,body,at) VALUES($1,'assigned','assigned:temp','T','Assigned to you',now())`,
      [m.id],
    );
    await q("INSERT INTO public.cockpit_task_alert_rules(member_id,updated_by) VALUES($1,'test')", [m.id]);
    await q("DELETE FROM public.cockpit_members WHERE id=$1", [m.id]);
    expect(await count("SELECT count(*) n FROM public.cockpit_task_alerts WHERE member_id=$1", [m.id])).toBe(0);
    expect(await count("SELECT count(*) n FROM public.cockpit_task_alert_rules WHERE member_id=$1", [m.id])).toBe(0);
  });
});

describe("the focus view", () => {
  test("opens for an assignee, a watcher, the seat that asked, an admin and the CEO; refuses anyone else", async () => {
    await upsert([task("f1", { assigneeIds: [CU.csm], watcherIds: [CU.creative], listId: CS_LIST, listName: "Client Success" })]);
    for (const uid of [CSM, CREATIVE, ADMIN, CEO]) expect((await detail(uid, "f1")).task.taskId).toBe("f1");
    const no = await refused(EDITOR, "SELECT public.cockpit_task_detail('f1')");
    expect(no.message).toBe("This task is not assigned to you. Open it in ClickUp.");
    expect(no.code).toBe("42501");
    expect((await refused(EDITOR, "SELECT public.cockpit_task_detail('not a task!')")).code).toBe("22023");
    expect((await refused(ADMIN, "SELECT public.cockpit_task_detail('nosuchtask')")).code).toBe("P0002");
    // The seat that asked opens its request's task before the mirror has read it.
    const rid = await deliveredRequest(EDITOR, "unread1", { client: CARD_B, clientName: "Beta Build" });
    const d = await detail(EDITOR, "unread1");
    expect(d.task).toMatchObject({ taskId: "unread1", title: "Fix it", clientName: "Beta Build", requestId: rid, listName: "Operations / Tech" });
    expect(d.request).toMatchObject({ id: rid, typeLabel: "General tech request", part: "main" });
    expect(d.can).toEqual({ tick: false, comment: false, done: false, why: "This task has not been read from ClickUp yet. Try again in two minutes." });
  });

  test("the cached read: checklists counted, comments by role, newest ten, the writer's mode", async () => {
    await upsert([task("f1", { dueHasTime: true, dueAtMs: Date.now() + 3600_000 })], "detail");
    const now = Date.now();
    await svc("SELECT public.cockpit_task_detail_cache('f1',$1::jsonb) r", [
      JSON.stringify({
        dueHasTime: true,
        description: "x".repeat(2500),
        checklists: [{ id: "cl1", name: "SOP steps", items: [{ id: "i1", name: "One", resolved: true }, { id: "i2", name: "Two", resolved: false }] }],
        subtasks: [{ id: "s1", name: "Sub", status: "to do", statusType: "open" }],
        comments: Array.from({ length: 12 }, (_, i) => ({ id: `cc${i}`, authorId: i === 0 ? CU.csm : CU.sm, atMs: now - i * 1000, text: `note ${i}` })),
        status: "in progress",
        statusType: "custom",
      }),
    ]);
    const d = await detail(CSM, "f1");
    expect(d.task.status).toBe("in progress");
    expect(d.task.checklist).toEqual({ done: 1, total: 2 });
    expect(d.task.dueHasTime).toBe(true);
    expect(d.task.description.length).toBe(2000);
    expect(d.detail.checklists).toEqual([{ id: "cl1", name: "SOP steps", items: [{ id: "i1", name: "One", resolved: true }, { id: "i2", name: "Two", resolved: false }] }]);
    expect(d.detail.subtasks).toEqual([{ id: "s1", name: "Sub", status: "to do", statusType: "open" }]);
    expect(d.detail.comments.length).toBe(10);
    expect(d.detail.comments[0]).toMatchObject({ id: "cc0", authorLabel: "the CSM", mine: true, text: "note 0" });
    expect(d.detail.comments[1]).toMatchObject({ authorLabel: "the systems manager", mine: false });
    expect(d.detailNote).toBeNull();
    expect(d.writer).toEqual({ mode: "unknown", live: false });
    expect(d.can.why).toBe("Changes from the cockpit are not switched on yet. Open the task in ClickUp.");
    await expect(svc("SELECT public.cockpit_task_detail_cache('nosuchtask','{}'::jsonb) r")).rejects.toThrow("not in the mirror");
  });
});

describe("tick, comment and Mark done", () => {
  const A1 = uuid(501);
  test("each refusal in order, in plain words", async () => {
    // Not linked: the editor seat with its link cleared.
    await one(ADMIN, "SELECT public.cockpit_member_clickup_set($1,NULL) r", [ids[BUYER]]);
    await upsert([task("w1", { assigneeIds: [CU.csm], watcherIds: [CU.other], listId: CS_LIST })]);
    expect((await actRefused(BUYER, uuid(502), "w1", "done", { statusSeen: "to do" })).message).toBe(
      "This task is not assigned to you. Open it in ClickUp.",
    );
    await one(ADMIN, "SELECT public.cockpit_member_clickup_set($1,$2) r", [ids[BUYER], CU.other]);
    // The writer is not live.
    expect((await actRefused(CSM, uuid(503), "w1", "done", { statusSeen: "to do" })).message).toBe(
      "Changes from the cockpit are not switched on yet. Open the task in ClickUp.",
    );
    await writerMode("apply_limited", [CARD_A]);
    expect((await actRefused(CSM, uuid(504), "w1", "done", { statusSeen: "to do" })).message).toBe(
      "Changes from the cockpit are not switched on yet. Open the task in ClickUp.",
    );
    await writerMode("apply");
    // Lists.
    await upsert([task("w2", { assigneeIds: [CU.csm], listId: PERSONAL }), task("w3", { assigneeIds: [CU.csm], listId: CARDS })]);
    expect((await actRefused(CSM, uuid(505), "w2", "tick", { checklistId: "cl1", itemId: "i1", itemName: "One", from: false })).message).toBe(
      "Ticking and Mark done work on the team request boards. Open this one in ClickUp.",
    );
    expect((await actRefused(CSM, uuid(506), "w3", "comment", { text: "hi" })).message).toBe("This is a client card. Open it in ClickUp.");
    // A comment on a list that is not a board is fine; a bad payload is not.
    expect((await actRefused(CSM, uuid(507), "w2", "comment", { text: "   " })).code).toBe("22023");
    expect((await actRefused(CSM, uuid(508), "w1", "tick", { checklistId: "cl1", itemId: "i1", from: false })).code).toBe("22023");
    expect((await actRefused(CSM, uuid(509), "w1", "launch", {})).message).toContain("Unknown change");
    // An admin who is not linked may act; a seat that is linked but not on the task may not.
    expect((await actRefused(EDITOR, uuid(510), "w1", "done", { statusSeen: "to do" })).code).toBe("42501");
  });

  test("a press is one queue row with the payload the writer reads, one audit row without the text, and a repeat is the same row", async () => {
    await writerMode("apply");
    const r = await act(CSM, A1, "w1", "tick", { checklistId: "cl1", itemId: "i1", itemName: "One", from: false });
    expect(r).toEqual({ id: A1, state: "queued", reused: false });
    const [row] = await q("SELECT * FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [A1]);
    expect(row.dedupe_key).toBe(`task:${A1}`);
    expect(row.kind).toBe("task_action");
    expect(row.source_table).toBe("cockpit_task_mirror");
    expect(row.source_id).toBe("w1");
    expect(row.task_id).toBe("w1");
    // The comment marker is chosen by the database, never from the browser's action id (SEC-5).
    expect(row.payload.ref).toMatch(/^T-[0-9a-f]{10}$/);
    expect(row.payload.ref).not.toBe(`T-${A1.replaceAll("-", "").slice(0, 10)}`);
    expect(row.payload).toEqual({
      actionId: A1,
      ref: row.payload.ref,
      op: "tick",
      taskId: "w1",
      listId: CS_LIST,
      clientTaskId: null,
      checklistId: "cl1",
      itemId: "i1",
      itemName: "One",
      from: false,
      to: true,
      text: null,
      statusSeen: null,
      actor: { memberId: ids[CSM], clickupUserId: CU.csm, label: "the CSM", isAdmin: false },
      requesterOfTask: false,
    });
    expect(await act(CSM, A1, "w1", "tick", { checklistId: "cl1", itemId: "i1", itemName: "One", from: false })).toEqual({
      id: A1,
      state: "queued",
      reused: true,
    });
    expect((await actRefused(CSM, A1, "w1", "untick", { checklistId: "cl1", itemId: "i1", itemName: "One", from: true })).message).toBe(
      "This change was already sent. Reload the task.",
    );
    const A2 = uuid(511);
    await act(CSM, A2, "w1", "comment", { text: "  Done on my side  " });
    const [c] = await q("SELECT payload FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [A2]);
    expect(c.payload.text).toBe("Done on my side");
    expect(c.payload.to).toBeNull();
    const audits = await q("SELECT * FROM public.cockpit_audit_log WHERE action='task.act' ORDER BY created_at");
    expect(audits.length).toBe(2);
    expect(audits[1].metadata).toEqual({ op: "comment", taskId: "w1", itemId: null, actionId: A2 });
    expect(JSON.stringify(audits)).not.toContain("Done on my side");
    // The writer's mode and the action rows show in the focus view.
    const d = await detail(CSM, "w1");
    expect(d.can).toEqual({ tick: true, comment: true, done: true, why: null });
    expect(d.writer).toEqual({ mode: "apply", live: true });
    expect(d.actions.map((a: Row) => [a.id, a.op, a.state])).toEqual([
      [A2, "comment", "queued"],
      [A1, "tick", "queued"],
    ]);
    // An admin not on the task, and the seat that asked, act as themselves.
    const A3 = uuid(512);
    await act(ADMIN, A3, "w1", "done", { statusSeen: "to do" });
    const [d3] = await q("SELECT payload FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [A3]);
    expect(d3.payload.actor).toEqual({ memberId: ids[ADMIN], clickupUserId: CU.sm, label: "the systems manager", isAdmin: true });
    expect(d3.payload.statusSeen).toBe("to do");
    // Each seat's focus view lists only its own presses; another seat's action ids never leave the database.
    expect((await detail(CSM, "w1")).actions.map((a: Row) => a.id)).toEqual([A2, A1]);
    expect((await detail(ADMIN, "w1")).actions.map((a: Row) => a.id)).toEqual([A3]);
    await upsert([task("unread1", { assigneeIds: [CU.sm], listId: TECH })]);
    const A4 = uuid(513);
    await act(EDITOR, A4, "unread1", "comment", { text: "Thanks" });
    expect((await q("SELECT payload FROM public.cockpit_clickup_writeback_queue WHERE id=$1", [A4]))[0].payload.requesterOfTask).toBe(true);
    // The canary card opens only its own tasks.
    await writerMode("apply_limited", [CARD_B]);
    expect((await detail(EDITOR, "unread1")).can.tick).toBe(true); // the request's card is Beta Build
    expect((await detail(CSM, "w1")).can.tick).toBe(false);
  });
});

describe("alert rules", () => {
  test("a seat reads and sets its own; another seat's needs the editor right", async () => {
    const own = await one<Row>(CSM, "SELECT public.cockpit_task_alert_rules_read() r");
    expect(own.member).toEqual({ id: ids[CSM], label: "the CSM" });
    expect(own.rules).toEqual({
      kinds: ["assigned", "due_today", "overdue", "comment", "mention", "status", "request_done", "request_failed"],
      shiftStart: null,
      shiftEnd: null,
      slackDm: false,
    });
    expect(own.shift).toEqual({ source: "schedule", start: "09:00", end: "17:00", days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] });
    expect(own.canEditOthers).toBe(false);
    expect(own.seats ?? null).toBeNull();
    expect((await refused(CSM, "SELECT public.cockpit_task_alert_rules_read($1)", [ids[ADMIN]])).code).toBe("42501");
    const byEditor = await one<Row>(ADMIN, "SELECT public.cockpit_task_alert_rules_read($1) r", [ids[CSM]]);
    expect(byEditor.member.label).toBe("Noura, Client success manager");
    expect(byEditor.canEditOthers).toBe(true);
    expect(byEditor.seats.length).toBe(6);
    const sm = await one<Row>(ADMIN, "SELECT public.cockpit_task_alert_rules_read() r");
    expect(sm.shift).toEqual({ source: "default", start: "10:00", end: "18:00", days: ["Sun", "Mon", "Tue", "Wed", "Thu"] });
    const ed = await one<Row>(EDITOR, "SELECT public.cockpit_task_alert_rules_read() r");
    expect(ed.shift).toMatchObject({ source: "rules", start: "13:00", end: "20:00" });
  });

  test("set: kinds, the shift, a failed request always on, Slack refused, every change audited", async () => {
    const set = (who: string, member: string | null, patch: Row) =>
      one<Row>(who, "SELECT public.cockpit_task_alert_rules_set($1,$2::jsonb) r", [member, JSON.stringify(patch)]);
    const setRefused = (who: string, member: string | null, patch: Row) =>
      refused(who, "SELECT public.cockpit_task_alert_rules_set($1,$2::jsonb)", [member, JSON.stringify(patch)]);
    const r = await set(CSM, null, { kinds: ["mention", "assigned"] });
    expect(r.rules.kinds).toEqual(["assigned", "mention", "request_failed"]);
    expect((await setRefused(CSM, null, { slackDm: true })).message).toBe(
      "Slack messages for alerts are not switched on yet. New assignments already post in your team's Slack channel.",
    );
    expect((await setRefused(CSM, null, { kinds: ["everything"] })).message).toContain("Unknown alert kind");
    expect((await setRefused(CSM, null, { shiftStart: "09:00" })).message).toBe("Set both the start and the end of the shift, or neither.");
    expect((await setRefused(CSM, null, { shiftStart: "18:00", shiftEnd: "09:00" })).message).toBe("The shift must end after it starts.");
    expect((await setRefused(CSM, null, { shiftStart: "9am", shiftEnd: "5pm" })).message).toContain("HH:MM");
    expect((await setRefused(CSM, null, { quietHours: true })).code).toBe("22023");
    expect((await setRefused(CSM, ids[ADMIN], { kinds: [] })).code).toBe("42501");
    expect((await set(CSM, null, { shiftStart: "08:30", shiftEnd: "16:30", slackDm: false })).shift).toMatchObject({ source: "rules", start: "08:30" });
    // An editor sets another seat's rules.
    expect((await set(ADMIN, ids[CSM], { shiftStart: null, shiftEnd: null })).rules.shiftStart).toBeNull();
    expect((await setRefused(ADMIN, ids[GONE], { kinds: [] })).message).toBe("That seat is not active. Pick another.");
    const audit = await q("SELECT * FROM public.cockpit_audit_log WHERE action='task_alert_rules.saved' AND entity_id=$1 ORDER BY created_at", [ids[CSM]]);
    expect(audit.length).toBe(3);
    expect(audit[0].before).toBeNull();
    expect(audit[2].before.shift_start).toBe("08:30:00");
    expect(audit[2].after.shift_start).toBeNull();
    expect(audit[2].actor_email).toBe("sm@tests.invalid");
    // Nothing changes: no new row, no audit.
    await set(CSM, null, { kinds: ["assigned", "mention"] });
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log WHERE action='task_alert_rules.saved' AND entity_id=$1", [ids[CSM]])).toBe(3);
    // The table holds the DM switch off.
    await expect(q("UPDATE public.cockpit_task_alert_rules SET slack_dm=true WHERE member_id=$1", [ids[CSM]])).rejects.toThrow("no_dm");
  });
});

describe("the service door", () => {
  test("a browser seat cannot call the mirror's writes", async () => {
    for (const sql of [
      "SELECT public.cockpit_task_mirror_upsert('[]'::jsonb,'delta')",
      "SELECT public.cockpit_task_alerts_tick()",
      "SELECT public.cockpit_task_mirror_state('delta',true,'x','{}'::jsonb)",
      "SELECT public.cockpit_task_mirror_inputs()",
    ])
      expect((await refused(ADMIN, sql)).message).toContain("permission denied");
  });

  test("the upsert refuses an unknown read and skips a row it cannot read", async () => {
    await expect(upsert([], "guess")).rejects.toThrow("delta, seat or detail");
    expect(await upsert([{ taskId: "bad id!", listId: TECH, name: "x", dateCreatedMs: Date.now(), dateUpdatedMs: Date.now() }])).toEqual({
      upserted: 0,
      alerts: 0,
      skipped: 1,
    });
    // A task tagged with one client's name belongs to that card.
    await upsert([task("tag1", { tags: ["Beta Build"] })]);
    expect((await q("SELECT client_task_id FROM public.cockpit_task_mirror WHERE task_id='tag1'"))[0].client_task_id).toBe(CARD_B);
    await upsert([task("card9", { listId: CARDS })]);
    expect((await q("SELECT client_task_id FROM public.cockpit_task_mirror WHERE task_id='card9'"))[0].client_task_id).toBe("card9");
  });

  test("the mirror leaves no audit row per task", async () => {
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type='cockpit_task_mirror' AND action<>'task.act'")).toBe(0);
  });
});

describe("review 2026-10-26", () => {
  const commentsAt = (taskId: string, list: Row[], readAt: string | null, failed = false) =>
    svc<Row>("SELECT public.cockpit_task_mirror_comments($1,$2::jsonb,$3::timestamptz,$4) r", [taskId, JSON.stringify(list), readAt, failed]);
  const due = async () => (await svc<Row[]>("SELECT public.cockpit_task_mirror_comment_due(60) r")).map(d => d.taskId as string);
  const mirrorRow = async (id: string) => (await q("SELECT * FROM public.cockpit_task_mirror WHERE task_id=$1", [id]))[0];

  test("ask F2: a real subtask of a client card is on Your tasks; the card itself is not", async () => {
    await upsert([
      task("rv-card", { listId: CARDS, assigneeIds: [CU.creative] }),
      task("rv-cardsub", { listId: CARDS, parentId: "rv-card", assigneeIds: [CU.creative] }),
    ]);
    const mine = (await myTasks(CREATIVE)).tasks.map((t: Row) => t.taskId);
    expect(mine).toContain("rv-cardsub");
    expect(mine).not.toContain("rv-card");
  });

  test("contract F2: due today counts what Your tasks shows; the editor desk, which keeps Video Pipeline on Jobs, gets its own count", async () => {
    let day = addDays(today(), 9);
    while (![0, 1, 2, 3, 4].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
    await upsert([
      task("rv-dvid", { listId: VIDEO, listName: "Video Pipeline", assigneeIds: [CU.editor], dueAtMs: noon(day) }),
      task("rv-dtech", { assigneeIds: [CU.editor], dueAtMs: noon(day) }),
      task("rv-dtechsub", { parentId: "rv-dtech", assigneeIds: [CU.editor], dueAtMs: noon(day) }),
      task("rv-dcard", { listId: CARDS, assigneeIds: [CU.editor], dueAtMs: noon(day) }),
    ]);
    // The editor's shift starts at 13:00 (an earlier test); 13:30 Kuwait.
    await tickAt(noon(day) + 90 * MIN);
    const dues = (await alertsOf(EDITOR)).filter(a => a.kind === "due_today" && a.dedupe_key.includes(day));
    expect(dues.map(a => [a.dedupe_key, a.title, a.scope, a.list_id])).toEqual([
      [`due_today:${ids[EDITOR]}:${day}`, "2 tasks are due today", "not_editor", null],
      [`due_today:${ids[EDITOR]}:${day}:editor`, "1 task is due today", "editor", null],
    ]);
    const [all, edOnly] = dues.map(a => a.id as string);
    const portal = (await bell(EDITOR, "portal")).alerts.map((a: Row) => a.id);
    const desk = (await bell(EDITOR, "editor")).alerts.map((a: Row) => a.id);
    expect([portal.includes(all), portal.includes(edOnly)]).toEqual([true, false]);
    expect([desk.includes(all), desk.includes(edOnly)]).toEqual([false, true]);
    // Ticking again that day adds nothing.
    await tickAt(noon(day) + 120 * MIN);
    expect((await alertsOf(EDITOR)).filter(a => a.kind === "due_today" && a.dedupe_key.includes(day)).length).toBe(2);
  });

  test("contract F1: a status the focus view's live read finds is told, once", async () => {
    // The systems manager wants every kind (the CSM's rules, set above, keep only assigned and mention).
    await upsert([task("rv-st", { assigneeIds: [CU.sm], status: "to do", statusType: "open" })]);
    await svc("SELECT public.cockpit_task_detail_cache('rv-st',$1::jsonb) r", [JSON.stringify({ status: "in review", statusType: "custom" })]);
    expect((await mirrorRow("rv-st")).status).toBe("in review");
    expect((await alertsOf(ADMIN)).filter(a => a.task_id === "rv-st" && a.kind === "status").map(a => a.body)).toEqual(["Moved to in review"]);
    // The delta that reads the same move later says nothing more.
    await upsert([task("rv-st", { status: "in review", statusType: "custom" })]);
    expect((await alertsOf(ADMIN)).filter(a => a.task_id === "rv-st" && a.kind === "status").length).toBe(1);
  });

  test("F6: a thread is read up to when its read began, so a comment posted meanwhile is read next time", async () => {
    await upsert([task("rv-rd", { assigneeIds: [CU.sm] })]);
    // Its last read was two minutes ago (after the baseline).
    await q("UPDATE public.cockpit_task_mirror SET comments_read_at=now()-interval '2 minutes' WHERE task_id='rv-rd'");
    const now = Date.now();
    const readAt = new Date(now - 30_000).toISOString();
    expect((await commentsAt("rv-rd", [{ id: "rd-1", authorId: CU.csm, atMs: now - 60_000, text: "first" }], readAt)).alerts).toBe(1);
    expect(new Date((await mirrorRow("rv-rd")).comments_read_at).toISOString()).toBe(readAt);
    // Posted while that read ran (after it began): the next read tells it.
    expect((await commentsAt("rv-rd", [{ id: "rd-2", authorId: CU.csm, atMs: now - 10_000, text: "meanwhile" }], null)).alerts).toBe(1);
    // The read time never goes back, and never past now; old callers (two arguments) still work.
    const later = new Date((await mirrorRow("rv-rd")).comments_read_at).getTime();
    await commentsAt("rv-rd", [], new Date(now - 3600_000).toISOString());
    expect(new Date((await mirrorRow("rv-rd")).comments_read_at).getTime()).toBe(later);
    await commentsAt("rv-rd", [], new Date(now + 3600_000).toISOString());
    expect(new Date((await mirrorRow("rv-rd")).comments_read_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await comments("rv-rd", [])).alerts).toBe(0);
  });

  test("a thread read that failed counts, leaves the read time and steps the task back: 2, 4, 8 minutes, at most an hour", async () => {
    await upsert([task("rv-fail", { assigneeIds: [CU.csm] })]);
    expect(await due()).toContain("rv-fail");
    const before = (await mirrorRow("rv-fail")).comments_read_at;
    expect(await commentsAt("rv-fail", [{ id: "f-1", authorId: CU.sm, atMs: Date.now(), text: "x" }], null, true)).toEqual({ alerts: 0 });
    let row = await mirrorRow("rv-fail");
    expect([row.comments_failures, row.comments_failed_at !== null, row.comments_read_at]).toEqual([1, true, before]);
    expect(await due()).not.toContain("rv-fail");
    // One failure waits 2 minutes.
    await q("UPDATE public.cockpit_task_mirror SET comments_failed_at=now()-interval '3 minutes' WHERE task_id='rv-fail'");
    expect(await due()).toContain("rv-fail");
    // Three in a row wait 8 minutes; a great many wait at most an hour.
    await q("UPDATE public.cockpit_task_mirror SET comments_failures=3, comments_failed_at=now()-interval '5 minutes' WHERE task_id='rv-fail'");
    expect(await due()).not.toContain("rv-fail");
    await q("UPDATE public.cockpit_task_mirror SET comments_failures=40, comments_failed_at=now()-interval '61 minutes' WHERE task_id='rv-fail'");
    expect(await due()).toContain("rv-fail");
    // A read that works resets the count.
    await commentsAt("rv-fail", [], null);
    row = await mirrorRow("rv-fail");
    expect([row.comments_failures, row.comments_failed_at]).toEqual([0, null]);
    expect(row.comments_read_at).not.toBeNull();
  });

  test("F8: in the focus view, the API user's comment with no marker is the CEO's; a cockpit marker is the cockpit's", async () => {
    await upsert([task("rv-f8", { assigneeIds: [CU.csm, CU.ceo] })], "detail");
    const now = Date.now();
    await svc("SELECT public.cockpit_task_detail_cache('rv-f8',$1::jsonb) r", [
      JSON.stringify({
        comments: [
          { id: "f8-1", authorId: CU.ceo, atMs: now - 1000, text: "Please move this up" },
          { id: "f8-2", authorId: CU.ceo, atMs: now - 2000, text: "Cockpit · the CSM asked Operations / Tech: X\n\nCockpit ref R-1a2b3c4d5e-main-card" },
        ],
      }),
    ]);
    const byCsm = (await detail(CSM, "rv-f8")).detail.comments.map((c: Row) => [c.id, c.authorLabel, c.mine]);
    expect(byCsm).toEqual([
      ["f8-1", "the CEO", false],
      ["f8-2", "the cockpit", false],
    ]);
    const byCeo = (await detail(CEO, "rv-f8")).detail.comments.map((c: Row) => [c.id, c.mine]);
    expect(byCeo).toEqual([
      ["f8-1", true],
      ["f8-2", false],
    ]);
  });

  test("the inputs say when the last delta stopped part way", async () => {
    await mirrorState("delta", false, { cursorMs: Date.now(), truncated: true });
    expect((await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r")).deltaTruncated).toBe(true);
    await mirrorState("delta", true, { cursorMs: Date.now(), truncated: false });
    expect((await svc<Row>("SELECT public.cockpit_task_mirror_inputs() r")).deltaTruncated).toBe(false);
  });
});
