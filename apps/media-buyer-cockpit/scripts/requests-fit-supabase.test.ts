/**
 * Requests and task alerts fit (docs/requests/CONTRACT.md section 9, the
 * orchestrator's read): the three migrations of this build,
 * 20261026r_requests.sql, 20261026s_request_types_seed.sql and
 * 20261026t_task_alerts.sql, applied twice in that order on one database
 * over the whole of Stage 1 (20261024a, 20261025n, 20261025o), and every
 * piece that crosses a builder's boundary driven through its real code:
 *
 *   the portal's own calls (src/lib/requestsClient.ts, tasksClient.ts, read
 *   with requestsCore.ts and tasksCore.ts, the screens' words)
 *   -> the request and task RPCs (real SQL, called by name as PostgREST
 *      calls them, so a wrong parameter name fails here)
 *   -> the writeback queue (20261009f, as live)
 *   -> clickup-writeback's requests job (real run.ts, requests.ts and
 *      taskActions.ts, through cockpit-media-api/tools.ts into the provider
 *      ledger, against one made-up ClickUp)
 *   -> cockpit-tasks' seats, delta and detail (real door.ts, seats.ts,
 *      delta.ts and detail.ts, the same ClickUp, the same ledger)
 *   -> back to the seats' bells, Your tasks and My requests.
 *
 * Each builder's suite tests its piece against the contract with stand-ins;
 * this one only checks that the pieces fit. PGlite has no pg_cron, vault or
 * pg_net, so the kicks write their notes and the jobs are run by hand. Every
 * person, client, card and task is invented, except the three owner ids the
 * seed itself names.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeClickUp } from "../../../supabase/functions/clickup-writeback/requestsTestkit";
import {
  runRequests,
  runRequestsDoctor,
  type Deps as WriterDeps,
} from "../../../supabase/functions/clickup-writeback/run";
import { providerTools } from "../../../supabase/functions/cockpit-media-api/tools";
import type { Row } from "../../../supabase/functions/cockpit-tasks/clickup";
import { runDelta } from "../../../supabase/functions/cockpit-tasks/delta";
import { RpcError } from "../../../supabase/functions/cockpit-tasks/detail";
import {
  type DoorDeps,
  makeTasksDoor,
} from "../../../supabase/functions/cockpit-tasks/door";
import { runSeats } from "../../../supabase/functions/cockpit-tasks/seats";
import * as RC from "../src/lib/requestsClient";
import * as RQ from "../src/lib/requestsCore";
import { actOnTask, readTaskDetail } from "../src/lib/tasksClient";
import * as TC from "../src/lib/tasksCore";
import { importTaskId } from "../src/pages/requests/RequestPanel";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const T = "20261026t_task_alerts.sql";

// Seats (auth ids).
const CEO = "00000000-0000-4000-8000-0000000000c3";
const SM = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM = "00000000-0000-4000-8000-0000000000a1";
const CREATIVE = "00000000-0000-4000-8000-0000000000e1";
const SEATS = new Set([CEO, SM, CSM, CREATIVE]);

// ClickUp users: the seed's three named owners, and the API user every cockpit write comes from.
const CU = {
  sm: 113459516,
  csm: 113688800,
  creative: 113520400,
  api: 284616470,
};

const TECH = "901816723190";
const CS_LIST = "901816723211";
const ALL_TASKS = "901816723226";
const RT_FIELD = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e";
const GENERAL_TECH_OPTION = "71c628d0-ee1f-4dc6-90ce-b4da84b7b367";
// The cards the made-up ClickUp already holds (requestsTestkit), as the onboarding mirror has them.
const TEST_CARD = "86eywg1cq"; // "Test client", the canary card
const ACME = "86card0001"; // "Acme Interiors"

let db: PGlite;

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
/** One RPC with named arguments, as a seat (its auth id) or as the service role. */
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
    await asOwner();
    await db.exec("SET ROLE service_role");
  } else await actor(db, who);
  try {
    if (sig.ret === "void") {
      await db.query(`SELECT ${callSql}`, values);
      return null;
    }
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

// --- One made-up ClickUp, read and written over HTTP the way tools.ts calls it ------------------

const world = new FakeClickUp(() => Date.now());
world.members = [
  { id: CU.sm, username: "huda", email: "sm@tests.invalid" },
  { id: CU.csm, username: "noura", email: "csm@tests.invalid" },
  { id: CU.creative, username: "omar", email: "creative@tests.invalid" },
  { id: CU.api, username: "aziz", email: "aziz@maharamedia.com" },
];
const API = "https://api.clickup.com/api/v2/";
const http: { method: string; path: string }[] = [];
const open = (t: Row) => !["done", "closed"].includes(String(t.status?.type));
const stamp = (t: Row) => ({
  ...t,
  date_updated: String(t.date_updated ?? t.date_created),
});

/** The routes the writer's fake does not need: the workspace task reads, replies and the token's user. */
function extraRoute(method: string, path: string): Row | undefined {
  const [base, qs = ""] = path.split("?");
  const query = new URLSearchParams(qs);
  if (method === "GET" && /^team\/\d+\/task$/.test(base)) {
    const assignee = query.get("assignees[]");
    const since = Number(query.get("date_updated_gt") ?? 0);
    const tasks = [...world.tasks.values()]
      .map(stamp)
      .filter(t =>
        assignee
          ? t.assignees.some((a: Row) => String(a.id) === assignee)
          : true,
      )
      .filter(t => query.get("include_closed") === "true" || open(t))
      .filter(t => Number(t.date_updated) > since)
      .sort((a, b) => Number(a.date_updated) - Number(b.date_updated));
    return { tasks, last_page: true };
  }
  if (method === "GET" && /^comment\/[^/]+\/reply$/.test(base))
    return { comments: [] };
  if (method === "GET" && base === "user")
    return { user: { id: CU.api, username: "aziz" } };
  return undefined;
}
/** What ClickUp does on its side of a write: it stamps the task, and the cockpit writes as the API user. */
function afterWrite(method: string, path: string) {
  if (method === "GET") return;
  const now = String(Date.now());
  for (const t of world.tasks.values()) {
    if (t.creator?.id !== CU.api && t.date_updated === undefined)
      t.creator = { id: CU.api };
    if (t.date_updated === undefined) t.date_updated = t.date_created;
  }
  const taskId = /^task\/([^/?]+)/.exec(path)?.[1];
  const task = taskId ? world.task(taskId) : undefined;
  if (task) task.date_updated = now;
  if (taskId && method === "POST" && /\/comment$/.test(path.split("?")[0])) {
    const list = world.comments.get(taskId) ?? [];
    const last = list[list.length - 1];
    if (last) last.user = { id: CU.api };
  }
  for (const t of world.tasks.values())
    for (const cl of t.checklists ?? [])
      if (path.startsWith(`checklist/${cl.id}/`)) t.date_updated = now;
}
const clickupFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith(API)) throw new Error(`Not ClickUp: ${url}`);
  const path = url.slice(API.length);
  const method = String(init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  http.push({ method, path });
  try {
    let out =
      extraRoute(method, path) ??
      (await world.handle({
        actionId: "http",
        provider: "clickup",
        method,
        path,
        body,
      }));
    afterWrite(method, path);
    if (Array.isArray(out?.tasks))
      out = { ...out, tasks: out.tasks.map(stamp) };
    else if (out?.id && out?.list) out = stamp(out);
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": "1000",
      },
    });
  } catch (e) {
    const said = /\((\d{3})\)(?::\s*(.*))?/.exec((e as Error).message);
    if (!said) throw e;
    return new Response(JSON.stringify({ err: said[2] ?? "rejected" }), {
      status: Number(said[1]),
    });
  }
}) as typeof fetch;

// --- The functions' dependencies, built as index.ts and door.ts build them ----------------------

const ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "https://fit.supabase.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-placeholder",
  SUPABASE_ANON_KEY: "anon-placeholder",
  CLICKUP_API_TOKEN: "pk_fit_placeholder",
  CRON_SECRET: "cron-placeholder",
  TASKS_CRON_SECRET: "tasks-cron-placeholder",
  CLICKUP_WRITEBACK_APPLY_REQUESTS: "true",
  CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD,
};
const env = (k: string) => ENV[k];
async function ledger(row: Row) {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(
      "INSERT INTO public.cockpit_media_provider_health(action_id,provider,method,resource,phase,http_status,object_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        row.action_id,
        row.provider,
        row.method,
        row.resource,
        row.phase,
        row.http_status ?? null,
        row.object_id ?? null,
      ],
    );
  } finally {
    await asOwner();
  }
}
/** PostgREST's upsert of one cockpit_sync_state row (the requests doctor's health line). */
async function syncState(key: string, row: Row) {
  const cols = Object.keys(row);
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(
      `INSERT INTO public.cockpit_sync_state(key,${cols.join(",")}) VALUES($1,${cols.map((c, i) => (c === "detail" ? `$${i + 2}::jsonb` : `$${i + 2}`)).join(",")})
       ON CONFLICT (key) DO UPDATE SET ${cols.map(c => `${c}=EXCLUDED.${c}`).join(",")}`,
      [
        key,
        ...cols.map(c => (c === "detail" ? JSON.stringify(row[c]) : row[c])),
      ],
    );
  } finally {
    await asOwner();
  }
}
const writer: WriterDeps = {
  env,
  rpc: async (name, params = {}) => {
    try {
      return await rpcAs("service", name, params);
    } catch (e) {
      throw new Error(
        `Supabase 400: ${JSON.stringify({ code: (e as DbError).code, message: (e as Error).message })}`,
      );
    }
  },
  providerFor: actionId =>
    providerTools(
      env,
      row => ledger({ ...row, action_id: actionId }),
      clickupFetch,
    ),
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  syncState,
};
const background: Promise<unknown>[] = [];
const mirror: DoorDeps = {
  env,
  rpc: async (name, args = {}) => {
    try {
      return await rpcAs("service", name, args);
    } catch (e) {
      throw new RpcError((e as Error).message, (e as DbError).code || null);
    }
  },
  health: ledger,
  clickupFetch,
  now: () => Date.now(),
  sleep: async () => {},
  uuid: () => crypto.randomUUID(),
  cronSecret: () => ENV.TASKS_CRON_SECRET ?? "",
  signedIn: async jwt => SEATS.has(jwt),
  userRpc: async (jwt, name, args) => {
    try {
      return await rpcAs(jwt, name, args);
    } catch (e) {
      throw new RpcError((e as Error).message, (e as DbError).code || null);
    }
  },
  waitUntil: work => {
    background.push(work);
  },
};
const door = makeTasksDoor(mirror);

/** A signed-in cockpit as supabase-js gives it to the screens: rpc and functions.invoke. */
function browser(uid: string): SupabaseClient {
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
    functions: {
      invoke: async (fn: string, opts: { body: unknown }) => {
        expect(fn).toBe("cockpit-tasks");
        const res = await door(
          new Request(
            "https://fit.supabase.invalid/functions/v1/cockpit-tasks",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${uid}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(opts.body),
            },
          ),
        );
        if (res.ok) return { data: await res.json(), error: null };
        return {
          data: null,
          error: {
            name: "FunctionsHttpError",
            message: "Edge Function returned a non-2xx status code",
            context: res,
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}
const ceo = browser(CEO);
const sm = browser(SM);
const csm = browser(CSM);

/** The keys a screen reads, all present (the contract's shapes). */
function hasKeys(obj: unknown, keys: string[], what: string) {
  expect(obj, what).toBeTruthy();
  const missing = keys.filter(k => !(k in (obj as Row)));
  expect(missing, `${what} is missing ${missing.join(", ")}`).toEqual([]);
}
const TYPE_VIEW = [
  "key",
  "label",
  "team",
  "teamLabel",
  "enabled",
  "dueDays",
  "dueDefault",
  "priority",
  "fields",
  "parts",
  "sopUrl",
];
const PART_ROW = [
  "part",
  "listName",
  "teamLabel",
  "taskName",
  "owner",
  "state",
  "error",
  "url",
  "status",
  "statusType",
  "verifyState",
  "verifyNote",
];
const REQUEST_ROW = [
  "id",
  "typeKey",
  "typeLabel",
  "team",
  "teamLabel",
  "clientTaskId",
  "clientName",
  "requesterLabel",
  "mine",
  "dueOn",
  "priority",
  "state",
  "done",
  "createdAt",
  "source",
  "canCancel",
  "canRoute",
  "parts",
];
const TASK_ROW = [
  "taskId",
  "title",
  "clientName",
  "clientTaskId",
  "listId",
  "listName",
  "status",
  "statusType",
  "dueOn",
  "dueAt",
  "dueHasTime",
  "overdue",
  "dueToday",
  "priority",
  "url",
  "createdAt",
  "parentId",
  "checklist",
  "requestId",
  "requestTypeLabel",
];
const ALERT_ROW = [
  "id",
  "kind",
  "taskId",
  "requestId",
  "title",
  "body",
  "clientName",
  "at",
  "read",
];

const queueRows = (kind: string) =>
  q<Row>(
    "SELECT id, kind, state, task_id, error, payload, next_attempt_at FROM public.cockpit_clickup_writeback_queue WHERE kind = $1 ORDER BY created_at, id",
    [kind],
  );
const dueNow = () =>
  q(
    "UPDATE public.cockpit_clickup_writeback_queue SET next_attempt_at = now() - interval '1 second' WHERE kind IN ('request','task_action') AND state IN ('queued','retry')",
  );
async function runDeltaNow() {
  // The delta reads from ten minutes before its cursor; each run here reads every change since the last.
  const r = await runDelta(mirror);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r;
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // What Stage 1 reads, from the canonical migrations (as the Stage 1 fit builds it).
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
      "20261011c_csm_call_store.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_calls\([\s\S]*?\n\);/,
      "calls",
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
  // Stand-ins with the live column names (checked 2026-10-26 for the provider ledger).
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
      public.cockpit_client_onboarding, public.cockpit_csm_form_sends, public.cockpit_csm_calls,
      public.cockpit_csm_source_state, public.cockpit_csm_sources, public.cockpit_csm_deck_prep,
      public.cockpit_media_actions, public.cockpit_client_logos, public.ghl_clients, public.editor_clients,
      public.cockpit_csm_provider_health, public.cockpit_media_provider_health, public.cockpit_decisions,
      public.cockpit_media_native_records FROM PUBLIC, anon, authenticated, service_role;
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

  // Seats, people by role, and the client cards.
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, SM, "sm@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  for (const [name, email, role] of [
    ["Huda Example", "sm@tests.invalid", "Systems manager"],
    ["Noura Example", "csm@tests.invalid", "Client success manager"],
    ["Omar Example", "creative@tests.invalid", "Creative strategist"],
    ["Aziz Example", "aziz@maharamedia.com", "CEO"],
  ] as const)
    await q(
      "INSERT INTO public.cockpit_people(name,email,role,added_by) VALUES($1,$2,$3,'test')",
      [name, email, role],
    );
  await q(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,client_status,csm)
     VALUES($1,'Test client','Active',NULL), ($2,'Acme Interiors','Active','noura')`,
    [TEST_CARD, ACME],
  );

  // Stage 1 whole, then this build's three files, twice in order.
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  await db.exec(migration("20261025n_slack_notices.sql"));
  await db.exec(migration("20261025o_blueprint_close_drain.sql"));
  for (const file of [R, S, T, R, S, T]) await db.exec(migration(file));
}, 180000);
afterAll(async () => {
  await Promise.allSettled(background);
  await db?.close();
});

describe("the migrations", () => {
  test("r, s and t apply twice over Stage 1, and every browser function a screen calls exists by the names it sends", async () => {
    expect(
      (
        await q<{ n: number }>(
          "SELECT count(*)::int n FROM public.cockpit_request_types",
        )
      )[0].n,
    ).toBe(31);
    // Every name in the screens' wrappers resolves with the arguments they send (PGRST202 otherwise).
    const named: [string, Record<string, unknown>][] = [
      ["cockpit_request_types_read", {}],
      ["cockpit_request_clients", { p_search: null, p_include_stopped: false }],
      ["cockpit_requests_read", { p_view: "mine", p_limit: 50 }],
      ["cockpit_my_tasks", { p_cockpit: "portal" }],
      ["cockpit_task_alerts", { p_cockpit: "portal" }],
      ["cockpit_task_alert_rules_read", {}],
      ["cockpit_member_clickup_read", {}],
      ["cockpit_request_people", {}],
    ];
    for (const [name, args] of named) await rpcAs(SM, name, args);
  });
});

describe("before ClickUp is read", () => {
  test("the form says the writer has not reported, and Your tasks says the seat is not linked", async () => {
    const types = await RC.readRequestTypes(csm);
    hasKeys(types, ["asOf", "seat", "writer", "types"], "TypesRead");
    hasKeys(types.types[0], TYPE_VIEW, "TypeView");
    expect(types.writer.canSend).toBe(false);
    expect(types.writer.note).toBe(
      "Requests are not switched on yet. Use the ClickUp request form until then.",
    );
    const mine = (await csm.rpc("cockpit_my_tasks", { p_cockpit: "csm" }))
      .data as TC.MyTasks;
    expect(mine.link).toBe("not_linked");
    expect(mine.note).toBe(TC.TASK_SENTENCES.notLinked);
  });

  test("the hourly read links the seats by email and sets the baseline; the writer's first run sets the mode the form reads", async () => {
    const seats = await runSeats(mirror);
    expect(seats.members).toBe(4);
    expect(seats.complete).toBe(true);
    const state = (
      await q<Row>(
        "SELECT detail FROM public.cockpit_sync_state WHERE key='task-mirror:seats'",
      )
    )[0];
    expect(state.detail.baselinedAt).toBeTruthy();
    const links = (await rpcAs(SM, "cockpit_member_clickup_read")) as Row;
    expect(
      links.seats
        .filter((s: Row) => s.link?.state === "ok")
        .map((s: Row) => Number(s.link.clickupUserId))
        .sort(),
    ).toEqual([CU.sm, CU.csm, CU.creative, CU.api].sort());
    // Every ClickUp read went through tools.ts into the ledger.
    const receipts = await q<Row>(
      "SELECT DISTINCT resource FROM public.cockpit_media_provider_health WHERE phase='response'",
    );
    expect(receipts.map(r => r.resource)).toContain("team");

    const first = await runRequests(writer);
    expect(first).toMatchObject({
      ok: true,
      mode: "apply_limited",
      note: "Nothing to write.",
    });
    const types = await RC.readRequestTypes(csm);
    expect(types.writer).toMatchObject({
      mode: "apply_limited",
      canSend: false,
      note: "Requests are being tested. They open to everyone soon. Use the ClickUp request form until then.",
    });
  });
});

let techTask = "";
let techRequest = "";

describe("a request on the canary card", () => {
  test("the route line before Send matches what the writer makes in ClickUp, owner, SOP steps, tag and card comment", async () => {
    const types = await RC.readRequestTypes(ceo);
    const type = types.types.find(t => t.key === "general_tech") as RQ.TypeView;
    hasKeys(type, TYPE_VIEW, "TypeView");
    const answers = { details: "The lead form stopped sending to the sheet." };
    const preview = await RC.previewRequest(
      ceo,
      "general_tech",
      TEST_CARD,
      answers,
    );
    hasKeys(preview, ["parts", "note", "dueDefault", "writer"], "RoutePreview");
    expect(preview.writer.canSend).toBe(true);
    expect(
      RQ.validateAnswers(type, answers, TEST_CARD, preview.dueDefault),
    ).toEqual({});
    const line = RQ.routeLine(preview.parts[0], preview.dueDefault);
    expect(line).toContain("Goes to Operations / Tech");
    expect(line).toContain("Test client - General tech request");
    expect(line).toContain("the systems manager");
    expect(line).not.toContain("undefined");

    techRequest = RC.newRequestId();
    const sent = await RC.submitRequest(ceo, {
      requestId: techRequest,
      typeKey: "general_tech",
      clientTaskId: TEST_CARD,
      answers,
      dueOn: preview.dueDefault,
      priority: "normal",
      source: "requests_page",
    });
    hasKeys(
      sent,
      ["id", "state", "reused", "duplicateOf", "note", "parts"],
      "SubmitResult",
    );
    hasKeys(sent.parts[0], PART_ROW, "PartRow");
    expect(sent.state).toBe("sending");

    const run = await runRequests(writer);
    expect(run.ok, run.note).toBe(true);
    expect(run.note).toBe(
      "Testing on the canary card: 1 delivered, 0 held as a dry run.",
    );

    const made = [...world.tasks.values()].filter(t => t.list.id === TECH);
    expect(made).toHaveLength(1);
    const task = made[0];
    techTask = String(task.id);
    expect(task.name).toBe(preview.parts[0].taskName);
    expect(task.assignees.map((a: Row) => a.id)).toEqual([CU.sm]);
    expect(task.markdown_description).toContain(
      `Cockpit ref R-${techRequest.replaceAll("-", "").slice(0, 10)}-main`,
    );
    expect(task.markdown_description).toContain(answers.details);
    expect(task.tags.map((g: Row) => g.name)).toEqual(["test client"]);
    expect(task.checklists[0].name).toBe("SOP steps (draft)");
    expect(task.checklists[0].items.length).toBe(type.parts[0].stepCount);
    // The due day ClickUp keeps is the Kuwait day the form showed.
    expect(
      new Date(Number(task.due_date) + 3 * 3600_000).toISOString().slice(0, 10),
    ).toBe(preview.dueDefault);
    const cardComment = (world.comments.get(TEST_CARD) ?? []).at(-1);
    expect(cardComment?.comment_text).toContain(
      "asked Operations / Tech: General tech request",
    );
    expect(cardComment?.comment_text).toContain(task.url);
    // Each write went through tools.ts and left its receipts under the queue row's id.
    const [row] = await queueRows("request");
    const receipts = await q<Row>(
      "SELECT method, resource, phase FROM public.cockpit_media_provider_health WHERE action_id=$1",
      [row.id],
    );
    expect(
      receipts.some(
        r =>
          r.method === "POST" &&
          r.resource === `list/${TECH}/task` &&
          r.phase === "response",
      ),
    ).toBe(true);

    // The requester's list, read as the screen reads it.
    const mine = await RC.readRequests(ceo, "mine");
    hasKeys(mine, ["asOf", "view", "views", "rows", "note"], "RequestsRead");
    const req = mine.rows.find(r => r.id === techRequest) as RQ.RequestRow;
    hasKeys(req, REQUEST_ROW, "RequestRow");
    expect(req.state).toBe("delivered");
    expect(req.parts[0].url).toBe(task.url);
    expect(RQ.stateWords(req)).not.toContain("undefined");
    // The two-minute check is waiting on the same task.
    const [verify] = await queueRows("task_action");
    expect(verify).toMatchObject({ state: "queued", task_id: techTask });
    expect(verify.payload.op).toBe("verify");
  });

  test("the owner gets an assigned alert and the task on Your tasks; the requester gets nothing for their own request", async () => {
    await runDeltaNow();
    const bell = (await sm.rpc("cockpit_task_alerts", { p_cockpit: "portal" }))
      .data as TC.TaskAlerts;
    hasKeys(
      bell,
      ["asOf", "sourceAt", "ready", "link", "note", "unread", "alerts"],
      "TaskAlerts",
    );
    const assigned = bell.alerts.find(
      a => a.taskId === techTask,
    ) as TC.AlertRow;
    hasKeys(assigned, ALERT_ROW, "AlertRow");
    expect(assigned.kind).toBe("assigned");
    expect(TC.alertWords(assigned.kind)).toBeTruthy();
    const mine = (await sm.rpc("cockpit_my_tasks", { p_cockpit: "portal" }))
      .data as TC.MyTasks;
    expect(mine.link).toBe("linked");
    expect(mine.ready).toBe(true);
    const row = TC.firstFive(mine.tasks).find(
      t => t.taskId === techTask,
    ) as TC.TaskRow;
    hasKeys(row, TASK_ROW, "TaskRow");
    expect(row.requestTypeLabel).toBe("General tech request");
    expect(row.clientName).toBe("Test client");
    expect(TC.dueWords(row, Date.now()).text).not.toBe("");
    const ceoBell = (
      await ceo.rpc("cockpit_task_alerts", { p_cockpit: "portal" })
    ).data as TC.TaskAlerts;
    expect(ceoBell.alerts.filter(a => a.taskId === techTask)).toEqual([]);
  });

  test("the focus view opens through cockpit-tasks; a tick and a comment pressed before the two-minute check reach ClickUp", async () => {
    const detail = await readTaskDetail(sm, techTask, true);
    hasKeys(
      detail,
      [
        "asOf",
        "task",
        "request",
        "sopUrl",
        "detail",
        "detailNote",
        "actions",
        "can",
        "writer",
      ],
      "TaskDetail",
    );
    hasKeys(detail.task, TASK_ROW, "TaskDetail.task");
    expect(detail.request?.typeLabel).toBe("General tech request");
    expect(detail.can).toMatchObject({ tick: true, comment: true, done: true });
    expect(detail.writer.live).toBe(true);
    const list = detail.detail?.checklists[0] as TC.Checklist;
    expect(list.name).toBe("SOP steps (draft)");
    const item = list.items[0];

    const tick = await actOnTask(sm, {
      taskId: techTask,
      op: "tick",
      payload: {
        checklistId: list.id,
        itemId: item.id,
        itemName: item.name,
        from: false,
      },
    });
    const comment = await actOnTask(sm, {
      taskId: techTask,
      op: "comment",
      payload: { text: "Started on it; the sheet lost its share." },
    });
    expect([tick.state, comment.state]).toEqual(["queued", "queued"]);

    // One lane per task: the tick goes first, the comment in the next run.
    for (const _ of [1, 2]) {
      const run = await runRequests(writer);
      expect(run.ok, run.note).toBe(true);
      expect(run.counts).toMatchObject({ claimed: 1, delivered: 1 });
    }
    expect(world.task(techTask)?.checklists[0].items[0].resolved).toBe(true);
    const said = (world.comments.get(techTask) ?? []).at(-1)
      ?.comment_text as string;
    expect(said).toContain(
      "wrote in the cockpit: Started on it; the sheet lost its share.",
    );
    expect(said).toContain(
      `Cockpit ref T-${comment.actionId.replaceAll("-", "").slice(0, 10)}`,
    );
    // The comment's words never reach the audit log (3.4), only how long it was.
    const leaked = await q<{ n: number }>(
      "SELECT count(*)::int n FROM public.cockpit_audit_log WHERE \"after\"::text LIKE '%sheet lost its share%' OR \"before\"::text LIKE '%sheet lost its share%' OR metadata::text LIKE '%sheet lost its share%'",
    );
    expect(leaked[0].n).toBe(0);
    const kept = await q<{ n: number }>(
      "SELECT count(*)::int n FROM public.cockpit_audit_log WHERE entity_type='cockpit_clickup_writeback_queue' AND \"after\"->'payload'->>'text' = '(40 characters, left out of the audit)'",
    );
    expect(kept[0].n).toBeGreaterThan(0);
    // The check is still waiting, untouched by the two presses.
    const verify = (await queueRows("task_action")).find(
      r => r.payload.op === "verify",
    ) as Row;
    expect(verify.state).toBe("queued");

    const after = await readTaskDetail(sm, techTask, true);
    // The focus view finds each press by the id it was answered with, and both read Saved.
    for (const press of [tick, comment])
      expect(
        TC.actionPhase(
          TC.actionState(after.actions, [press.id, press.actionId]),
        ),
      ).toEqual({ phase: "saved" });
    expect(after.detail?.checklists[0].items[0].resolved).toBe(true);
    // The owner's own comment makes no comment alert for them.
    await runDeltaNow();
    const bell = (await sm.rpc("cockpit_task_alerts", { p_cockpit: "portal" }))
      .data as TC.TaskAlerts;
    expect(
      bell.alerts.filter(a => a.taskId === techTask).map(a => a.kind),
    ).toEqual(["assigned"]);
  });

  test("the two-minute check reads the owner back and the request panel says so", async () => {
    await dueNow();
    const run = await runRequests(writer);
    expect(run.ok, run.note).toBe(true);
    const detail = await RC.readRequest(ceo, techRequest);
    hasKeys(
      detail,
      [
        ...REQUEST_ROW,
        "answers",
        "details",
        "replacesTaskId",
        "routedTo",
        "history",
      ],
      "RequestDetail",
    );
    expect(detail.parts[0].verifyState).toBe("kept");
    expect(detail.history.length).toBeGreaterThan(0);
  });

  test("Mark done closes the task in ClickUp; the mirror marks the request done and tells the requester", async () => {
    const done = await actOnTask(sm, {
      taskId: techTask,
      op: "done",
      payload: { statusSeen: "to do" },
    });
    const run = await runRequests(writer);
    expect(run.ok, run.note).toBe(true);
    expect(world.task(techTask)?.status).toEqual({
      status: "complete",
      type: "done",
    });
    await runDeltaNow();
    const mine = await RC.readRequests(ceo, "mine");
    const req = mine.rows.find(r => r.id === techRequest) as RQ.RequestRow;
    expect(req.done).toBe(true);
    expect(RQ.stateChip(req).label).toBeTruthy();
    const ceoBell = (
      await ceo.rpc("cockpit_task_alerts", { p_cockpit: "portal" })
    ).data as TC.TaskAlerts;
    const doneAlert = ceoBell.alerts.find(
      a => a.kind === "request_done",
    ) as TC.AlertRow;
    expect(doneAlert).toMatchObject({
      requestId: techRequest,
      title: "General tech request: Test client",
    });
    expect(TC.alertOpens(doneAlert)).toBeTruthy();
    // The owner moved it, so the owner gets no status alert for their own Mark done.
    const smBell = (
      await sm.rpc("cockpit_task_alerts", { p_cockpit: "portal" })
    ).data as TC.TaskAlerts;
    expect(
      smBell.alerts.filter(a => a.taskId === techTask && a.kind === "status"),
    ).toEqual([]);
    // Done tasks leave Your tasks.
    const tasks = (await sm.rpc("cockpit_my_tasks", { p_cockpit: "portal" }))
      .data as TC.MyTasks;
    expect(tasks.tasks.some(t => t.taskId === techTask)).toBe(false);
    expect(done.state).toBe("queued");
  });
});

describe("an old form ticket on All Tasks", () => {
  test("the hourly read imports it to the team queue, and Make it a request routes it and closes the old ticket", async () => {
    const old = world.addTask({
      listId: ALL_TASKS,
      name: "Form Submission #4821",
      tags: [{ name: "test client" }],
      text_content: "The landing page shows the old phone number.",
      date_created: String(Date.now() - 3 * 86_400_000),
      date_updated: String(Date.now() - 3 * 86_400_000),
      creator: { id: CU.api },
    });
    const rt = old.custom_fields.find((f: Row) => f.id === RT_FIELD);
    rt.value = rt.type_config.options.find(
      (o: Row) => o.id === GENERAL_TECH_OPTION,
    ).orderindex;
    const seats = await runSeats(mirror);
    expect(seats.imported, seats.note).toBe(1);

    const queue = await RC.readRequests(sm, "team");
    const imported = queue.rows.find(
      r => r.source === "import",
    ) as RQ.RequestRow;
    hasKeys(imported, REQUEST_ROW, "RequestRow (import)");
    expect(imported).toMatchObject({
      state: "imported",
      canRoute: true,
      typeKey: "general_tech",
      clientTaskId: TEST_CARD,
    });
    expect(RQ.stateWords(imported)).toBe(
      "Came in through the old ClickUp form. Make it a request to route it.",
    );
    const panel = await RC.readRequest(sm, imported.id);
    expect(panel.details).toBe("The landing page shows the old phone number.");
    // "Make it a request" finds the old ticket from the panel as the server sends it.
    expect(importTaskId(panel)).toBe(String(old.id));

    const routed = await RC.submitRequest(sm, {
      requestId: RC.newRequestId(),
      typeKey: "general_tech",
      clientTaskId: TEST_CARD,
      answers: { details: panel.details as string },
      dueOn: null,
      priority: null,
      source: "requests_page",
      replacesTaskId: importTaskId(panel),
    });
    expect(routed.state).toBe("sending");
    const run = await runRequests(writer);
    expect(run.ok, run.note).toBe(true);
    expect(world.task(String(old.id))?.status).toEqual({
      status: "cancelled",
      type: "closed",
    });
    expect(
      (world.comments.get(String(old.id)) ?? []).at(-1)?.comment_text,
    ).toContain("Routed in the cockpit as General tech request");
    expect((await RC.readRequest(sm, imported.id)).state).toBe("routed");
  });
});

describe("open to everyone", () => {
  test("with the canary list cleared, a CSM's request goes to the card's CSM on Client Success", async () => {
    ENV.CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS = undefined;
    try {
      expect((await runRequests(writer)).mode).toBe("apply");
      const types = await RC.readRequestTypes(csm);
      expect(types.writer).toMatchObject({ mode: "apply", canSend: true });
      const clients = await RC.readRequestClients(csm, "acme");
      hasKeys(clients, ["clients", "more"], "ClientsRead");
      expect(clients.clients.map(c => c.taskId)).toEqual([ACME]);
      const preview = await RC.previewRequest(csm, "general_csm", ACME, {
        details: "Ask for the new logo files.",
      });
      expect(preview.parts[0].owner).toMatchObject({ how: "card" });
      expect(RQ.ownerNote(preview.parts[0].owner)).toBe(
        "The CSM named on the client card.",
      );
      const id = RC.newRequestId();
      await RC.submitRequest(csm, {
        requestId: id,
        typeKey: "general_csm",
        clientTaskId: ACME,
        answers: { details: "Ask for the new logo files." },
        dueOn: preview.dueDefault,
        priority: "normal",
        source: "client_page",
      });
      const run = await runRequests(writer);
      expect(run.ok, run.note).toBe(true);
      const made = [...world.tasks.values()].find(t => t.list.id === CS_LIST);
      expect(made?.assignees.map((a: Row) => a.id)).toEqual([CU.csm]);
      expect(
        (await RC.readRequests(csm, "mine")).rows.find(r => r.id === id)?.state,
      ).toBe("delivered");
    } finally {
      ENV.CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS = TEST_CARD;
    }
  });
});

describe("the doctors and the door", () => {
  test("the requests doctor checks the seeded types against ClickUp and saves its line; the task mirror's doctor answers through the door", async () => {
    const doctor = await runRequestsDoctor(writer);
    // The made-up ClickUp holds three of the 34 template objects, so the doctor names the rest.
    expect(doctor.ok).toBe(false);
    expect(doctor.problems.length).toBeGreaterThan(0);
    const saved = (
      await q<Row>(
        "SELECT ok, detail FROM public.cockpit_sync_state WHERE key='clickup-writeback:requests-doctor'",
      )
    )[0];
    expect(saved.ok).toBe(false);
    expect(saved.detail.secrets).toMatchObject({
      CLICKUP_API_TOKEN: true,
      CLICKUP_WRITEBACK_APPLY_REQUESTS: true,
    });
    expect(JSON.stringify(saved.detail)).not.toContain(
      String(ENV.CLICKUP_API_TOKEN),
    );

    const res = await door(
      new Request("https://fit.supabase.invalid/functions/v1/cockpit-tasks", {
        method: "POST",
        headers: {
          "x-cron-secret": String(ENV.TASKS_CRON_SECRET),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job: "doctor" }),
      }),
    );
    expect(res.status).toBe(200);
    const said = (await res.json()) as Row;
    expect(said.linked).toBe(4);
    const refused = await door(
      new Request("https://fit.supabase.invalid/functions/v1/cockpit-tasks", {
        method: "POST",
        headers: {
          "x-cron-secret": "wrong",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job: "delta" }),
      }),
    );
    expect(refused.status).toBe(401);
  });

  test("a seat that may not open a task hears the database's sentence through the door", async () => {
    await expect(readTaskDetail(csm, techTask, false)).rejects.toThrow(
      "This task is not assigned to you. Open it in ClickUp.",
    );
  });

  test("the task mirror only ever read ClickUp; every write came from the requests job", async () => {
    const reads = await q<Row>(
      "SELECT DISTINCT method FROM public.cockpit_media_provider_health h WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.id = h.action_id) AND NOT EXISTS (SELECT 1 FROM public.cockpit_clickup_writeback_runs r WHERE r.id = h.action_id)",
    );
    expect(reads.map(r => r.method)).toEqual(["GET"]);
    expect(http.some(c => c.method !== "GET")).toBe(true);
  });
});
