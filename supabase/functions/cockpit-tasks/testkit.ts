/**
 * Fakes for the cockpit-tasks tests: a ClickUp that answers the GETs this
 * function makes from made-up tasks, comments, members, fields and
 * templates (and records every call, so a test can prove nothing but GET was
 * ever sent), an RPC that records each database call and answers it, and a
 * receipts recorder. Nothing here touches a network or a database.
 * Test-only: index.ts never imports it. Every client, task and person is
 * invented.
 */
import type { Deps, Row } from "./clickup.ts";
import { RpcError } from "./detail.ts";

export const NOW = Date.parse("2026-10-26T09:00:00Z"); // 12:00 in Kuwait, a Monday
export const TOKEN = "pk_fake_clickup_token_for_tests";

export type Call = { method: string; path: string; query: URLSearchParams; authorization: string | null };

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-RateLimit-Limit": "1000", ...headers } });

/** A ClickUp task as the API sends it. */
export function cuTask(id: string, t: Row = {}): Row {
  return {
    id,
    name: `Task ${id}`,
    status: { status: "to do", type: "open" },
    list: { id: "901816723190", name: "Operations / Tech" },
    folder: { id: "901812879297" },
    space: { id: "901810248115" },
    parent: null,
    priority: null,
    due_date: null,
    assignees: [],
    watchers: [],
    creator: { id: 222000111 },
    tags: [],
    url: `https://app.clickup.com/t/${id}`,
    date_created: String(NOW - 86_400_000),
    date_updated: String(NOW - 60_000),
    date_closed: null,
    archived: false,
    checklists: [],
    custom_fields: [],
    ...t,
  };
}

export class FakeClickUp {
  calls: Call[] = [];
  /** Workspace tasks for the delta, in the order ClickUp would page them. */
  delta: Row[] = [];
  /** Open tasks by assignee for the seats read. */
  byAssignee = new Map<number, Row[]>();
  /** Single tasks for GET task/{id}. */
  tasks = new Map<string, Row>();
  comments = new Map<string, Row[]>();
  replies = new Map<string, Row[]>();
  members: Row[] = [{ user: { id: 113459516, username: "huda", email: "sm@tests.invalid" } }];
  fields: Row[] = [{ id: "e9fd8024-8abe-4094-ac08-e6c0e736ad7e", name: "Request Type", type: "drop_down", type_config: { options: [{ id: "o1", name: "One", orderindex: 0 }] } }];
  templates: Row[][] = [[{ id: "t-86ex09tmh", name: "Connecting a new lead form" }]];
  allTasks: Row[] = [];
  /** Paths (no query) that answer with this status instead. */
  fail = new Map<string, number>();
  /** Every page of every list holds this many at most. */
  pageSize = 100;

  private page(list: Row[], query: URLSearchParams) {
    const n = Number(query.get("page") ?? 0);
    const tasks = list.slice(n * this.pageSize, (n + 1) * this.pageSize);
    return { tasks, last_page: (n + 1) * this.pageSize >= list.length };
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (url.hostname !== "api.clickup.com") throw new Error(`Unexpected host ${url.hostname}`);
    const path = url.pathname.replace(/^\/api\/v2\//, "");
    this.calls.push({ method, path, query: url.searchParams, authorization: headers.get("authorization") });
    if (method !== "GET") return answer({ err: "This fake only answers GET" }, 405);
    const failed = this.fail.get(path);
    if (failed) return answer({ err: "Something broke", ECODE: "FAKE_001" }, failed);
    let m: RegExpMatchArray | null;
    if (path === "user") return answer({ user: { id: 284616470, username: "api" } });
    if (path === "team") return answer({ teams: [{ id: "90182518398", name: "Mahara", members: this.members }] });
    if (path === "team/90182518398/task") {
      const assignee = url.searchParams.get("assignees[]");
      if (assignee) return answer(this.page(this.byAssignee.get(Number(assignee)) ?? [], url.searchParams));
      const since = Number(url.searchParams.get("date_updated_gt") ?? 0);
      return answer(this.page(this.delta.filter(t => Number(t.date_updated) > since), url.searchParams));
    }
    if (path === "team/90182518398/taskTemplate") {
      const n = Number(url.searchParams.get("page") ?? 0);
      return answer({ templates: this.templates[n] ?? [] });
    }
    if (path === "list/901816723190/field") return answer({ fields: this.fields });
    if (path === "list/901816723226/task") return answer(this.page(this.allTasks, url.searchParams));
    if ((m = path.match(/^task\/([A-Za-z0-9_-]+)\/comment$/))) return answer({ comments: this.comments.get(m[1]) ?? [] });
    if ((m = path.match(/^comment\/([A-Za-z0-9_-]+)\/reply$/))) return answer({ comments: this.replies.get(m[1]) ?? [] });
    if ((m = path.match(/^task\/([A-Za-z0-9_-]+)$/))) {
      const t = this.tasks.get(m[1]);
      return t ? answer(t) : answer({ err: "Task not found", ECODE: "ITEM_013" }, 404);
    }
    return answer({ err: `No fake for ${path}` }, 404);
  };

  gets(prefix = "") {
    return this.calls.filter(c => c.path.startsWith(prefix));
  }
}

export type RpcCall = { name: string; args: Record<string, unknown> };

/** A database that records each call and answers from handlers (a default for each name the jobs use). */
export class FakeRpc {
  calls: RpcCall[] = [];
  handlers: Record<string, (args: Row) => unknown> = {
    cockpit_task_mirror_inputs: () => ({
      cursorMs: null,
      baselinedAt: "2026-10-20T00:00:00Z",
      teamId: "90182518398",
      linked: [],
      notLinked: 0,
      allTasksList: "901816723226",
      fieldsList: "901816723190",
      states: { delta: null, seats: null },
    }),
    cockpit_task_mirror_upsert: a => ({ upserted: (a.p_tasks as unknown[]).length, alerts: 0, skipped: 0 }),
    cockpit_task_mirror_comment_due: () => [],
    cockpit_task_mirror_comments: () => ({ alerts: 0 }),
    cockpit_task_alerts_tick: () => ({ dueToday: 0, overdue: 0 }),
    cockpit_task_mirror_state: () => null,
    cockpit_task_mirror_seat: () => ({ removed: 0 }),
    cockpit_task_detail_cache: () => null,
    cockpit_clickup_members_sync: a => ({ members: (a.p_members as unknown[]).length, linked: 0, notFound: 0, ambiguous: 0 }),
    cockpit_request_field_catalog_sync: a => ({ updated: (a.p_fields as unknown[]).length, missing: 0 }),
    cockpit_request_templates_sync: a => ({ seen: (a.p_templates as unknown[]).length, missing: 0 }),
    // p_open_ids (review round 3) comes only after a complete read of All Tasks; the answer then counts which
    // imports left it and which came back.
    cockpit_request_import: a => ({
      imported: (a.p_tasks as unknown[]).length,
      skipped: [],
      ...(Array.isArray(a.p_open_ids) ? { left: 0, back: 0 } : {}),
    }),
  };

  rpc = async (name: string, args: Record<string, unknown> = {}) => {
    this.calls.push({ name, args });
    const h = this.handlers[name];
    if (!h) throw new RpcError(`No fake for ${name}`, null);
    return structuredClone(h(args as Row));
  };

  of(name: string) {
    return this.calls.filter(c => c.name === name);
  }
  last(name: string) {
    const all = this.of(name);
    return all[all.length - 1];
  }
}

/** Deps for a job, with a fake ClickUp, a fake database and a receipts list. */
export function kit(opts: { token?: string | null; env?: Record<string, string> } = {}) {
  const clickup = new FakeClickUp();
  const db = new FakeRpc();
  const receipts: Row[] = [];
  let failReceipts = false;
  let clock = NOW;
  let n = 0;
  const vars: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture",
    SUPABASE_ANON_KEY: "anon-key-fixture",
    TASKS_CRON_SECRET: "tasks-cron-secret-fixture",
    ...(opts.token === null ? {} : { CLICKUP_API_TOKEN: opts.token ?? TOKEN }),
    ...opts.env,
  };
  const deps: Deps = {
    env: name => vars[name],
    rpc: db.rpc,
    health: async row => {
      if (failReceipts) throw new Error("The provider receipt could not be saved, so ClickUp was not called.");
      receipts.push(row);
    },
    clickupFetch: clickup.fetch,
    now: () => clock,
    sleep: async ms => {
      clock += ms;
    },
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
  return {
    deps,
    clickup,
    db,
    receipts,
    vars,
    failReceipts: (v: boolean) => {
      failReceipts = v;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
