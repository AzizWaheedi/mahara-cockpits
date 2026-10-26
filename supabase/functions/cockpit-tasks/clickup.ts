/**
 * ClickUp, read only, for cockpit-tasks (docs/requests/CONTRACT.md 5).
 *
 * Every call is a GET through providerTools (cockpit-media-api/tools.ts), so
 * each one lands in cockpit_media_provider_health with the run's action id,
 * and a receipt that cannot be saved stops the call. This file has no way to
 * send anything else: the reader exposes get() only.
 *
 * The mapping functions turn ClickUp's task and comment shapes into the rows
 * the database functions of 20261026t take (MirrorTask, the comment list,
 * the focus view's cache).
 */
import { providerTools } from "../cockpit-media-api/tools.ts";

export type Row = Record<string, any>;
export type Env = (name: string) => string | undefined;
export type Rpc = (name: string, args?: Record<string, unknown>) => Promise<any>;

export const TEAM_ID = "90182518398";
export const CLIENT_CARDS = "901816559981";
export const VIDEO_PIPELINE = "901816720767";
export const ALL_TASKS = "901816723226";
export const FIELDS_LIST = "901816723190";
export const REQUEST_TYPE_FIELD = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e";
/** The CEO's ClickUp user, which the cockpit, Make and the agents all write as. */
export const API_USER = 284616470;
export const TASK_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** What every job needs; the door builds the real ones, the tests fake them. */
export type Deps = {
  env: Env;
  /** A service-key RPC on Creative Triage; throws the database's sentence. */
  rpc: Rpc;
  /** One provider receipt into cockpit_media_provider_health (the row carries action_id). */
  health: (row: Row) => Promise<void>;
  /** The fetch providerTools calls ClickUp with. */
  clickupFetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  uuid: () => string;
};

export const NO_TOKEN = "CLICKUP_API_TOKEN is not set on cockpit-tasks, so nothing was read from ClickUp. Add it to the function's secrets.";

/** Calls a minute, CLICKUP_TASKS_CALLS_PER_MINUTE, 120 by default (the token allows 1,000). */
export function callsPerMinute(env: Env): number {
  return Math.min(1000, Math.max(10, Number(env("CLICKUP_TASKS_CALLS_PER_MINUTE")) || 120));
}

/** Spaces calls evenly: at most `perMinute` a minute. */
export function pacer(perMinute: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  const gap = 60_000 / perMinute;
  let next = 0;
  return async () => {
    const t = now();
    const wait = next - t;
    next = Math.max(t, next) + gap;
    if (wait > 0) await sleep(wait);
  };
}

/** A read-only ClickUp for one run: GETs only, paced, each one receipted under the run's action id. */
export class ClickUpReader {
  calls = 0;
  /** X-RateLimit-Limit from the last answer (the doctor reports it). */
  rateLimit: number | null = null;
  private provider: ReturnType<typeof providerTools>;
  private pace: () => Promise<void>;

  constructor(deps: Deps, actionId: string) {
    const tap: typeof fetch = async (input, init) => {
      const res = await deps.clickupFetch(input, init);
      const limit = Number(res.headers.get("x-ratelimit-limit"));
      if (Number.isFinite(limit) && limit > 0) this.rateLimit = limit;
      return res;
    };
    this.provider = providerTools(deps.env, row => deps.health({ ...row, action_id: actionId }), tap);
    this.pace = pacer(callsPerMinute(deps.env), deps.now, deps.sleep);
  }

  async get(path: string): Promise<Row> {
    await this.pace();
    this.calls += 1;
    return this.provider.call("clickup", "GET", path);
  }
}

const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
/** A ClickUp time (a millisecond string or number) as a number, else null. */
export function ms(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  if (typeof v === "string" && /^[0-9]{10,15}$/.test(v)) return Number(v);
  return null;
}
const id = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^[0-9]{1,18}$/.test(v)) return Number(v);
  return null;
};
const userIds = (list: unknown): number[] =>
  (Array.isArray(list) ? list : []).map(u => id(isObj(u) ? u.id : u)).filter((n): n is number => n !== null);
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Checklist items with their nested children, in order. */
export function flatItems(items: unknown): Row[] {
  return (Array.isArray(items) ? items : []).flatMap((i: Row) => (isObj(i) ? [i, ...flatItems(i.children)] : []));
}

/** {done, total} over every checklist, or nulls when the answer carried none. */
export function checklistCounts(checklists: unknown): { done: number | null; total: number | null } {
  if (!Array.isArray(checklists)) return { done: null, total: null };
  const items = checklists.flatMap((c: Row) => flatItems(c?.items));
  return { done: items.filter(i => i.resolved === true).length, total: items.length };
}

/** A ClickUp task as cockpit_task_mirror_upsert takes it (MirrorTask); null when it cannot be read. */
export function mirrorTask(t: unknown): Row | null {
  if (!isObj(t)) return null;
  const taskId = String(t.id ?? "");
  const listId = str(t.list?.id);
  const created = ms(t.date_created);
  const updated = ms(t.date_updated);
  if (!TASK_ID.test(taskId) || !listId || !created || !updated || !String(t.name ?? "").trim()) return null;
  const counts = checklistCounts(t.checklists);
  const row: Row = {
    taskId,
    listId,
    listName: str(t.list?.name),
    folderId: str(t.folder?.id),
    spaceId: str(t.space?.id),
    parentId: typeof t.parent === "string" && TASK_ID.test(t.parent) ? t.parent : null,
    name: String(t.name).slice(0, 500),
    status: str(t.status?.status),
    statusType: str(t.status?.type),
    priority: str(t.priority?.priority),
    dueAtMs: ms(t.due_date),
    assigneeIds: userIds(t.assignees),
    watcherIds: userIds(t.watchers),
    creatorId: id(t.creator?.id),
    tags: (Array.isArray(t.tags) ? t.tags : []).map((g: Row) => (isObj(g) ? g.name : null)).filter((n: unknown): n is string => typeof n === "string" && !!n.trim()),
    url: str(t.url) ?? `https://app.clickup.com/t/${taskId}`,
    dateCreatedMs: created,
    dateUpdatedMs: updated,
    dateClosedMs: ms(t.date_closed),
    archived: t.archived === true,
    checklistDone: counts.done,
    checklistTotal: counts.total,
  };
  // Only GET task/{id} says whether the due date has a time.
  if (typeof t.due_date_time === "boolean") row.dueHasTime = t.due_date_time;
  return row;
}

/** One ClickUp comment as cockpit_task_mirror_comments takes it. */
export function commentRow(c: unknown, parentId: string | null = null): Row | null {
  if (!isObj(c) || c.id === undefined || c.id === null) return null;
  const parts = Array.isArray(c.comment) ? c.comment : [];
  return {
    id: String(c.id),
    authorId: id(c.user?.id),
    atMs: ms(c.date),
    text: String(c.comment_text ?? "").slice(0, 1000),
    tagIds: parts.filter((p: Row) => isObj(p) && p.type === "tag").map((p: Row) => id(p.user?.id)).filter((n: number | null) => n !== null),
    assigneeId: id(c.assignee?.id),
    parentId,
  };
}

/** The focus view's cache from GET task/{id} and its comments (cockpit_task_detail_cache). */
export function detailCache(t: Row, comments: Row[]): Row {
  return {
    dueHasTime: typeof t.due_date_time === "boolean" ? t.due_date_time : null,
    description: String(t.markdown_description ?? t.text_content ?? t.description ?? "").slice(0, 2000),
    checklists: (Array.isArray(t.checklists) ? t.checklists : []).filter(isObj).map((c: Row) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      items: flatItems(c.items).map(i => ({ id: String(i.id), name: String(i.name ?? ""), resolved: i.resolved === true })),
    })),
    subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).filter(isObj).map((s: Row) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
      status: str(s.status?.status),
      statusType: str(s.status?.type),
    })),
    comments: comments.map(c => commentRow(c)).filter((c): c is Row => c !== null).map(c => ({ id: c.id, authorId: c.authorId, atMs: c.atMs, text: c.text })),
    status: str(t.status?.status),
    statusType: str(t.status?.type),
  };
}

/** An old ticket on All Tasks as cockpit_request_import takes it; null when it is not one. */
export function importTask(t: unknown): Row | null {
  const row = mirrorTask(t);
  if (!row || !isObj(t)) return null;
  if (!row.name.startsWith("Form Submission")) return null;
  if (row.statusType === "done" || row.statusType === "closed") return null;
  const field = (Array.isArray(t.custom_fields) ? t.custom_fields : []).find((f: Row) => isObj(f) && f.id === REQUEST_TYPE_FIELD);
  if (!field || field.value === undefined || field.value === null || field.value === "") return null;
  let optionId: string | null = null;
  if (typeof field.value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(field.value)) optionId = field.value;
  else {
    // A drop-down's value is its option's orderindex.
    const index = Number(field.value);
    const option = (Array.isArray(field.type_config?.options) ? field.type_config.options : []).find((o: Row) => Number(o?.orderindex) === index);
    optionId = option?.id ? String(option.id) : null;
  }
  if (!optionId) return null;
  return {
    taskId: row.taskId,
    name: row.name,
    url: row.url,
    optionId,
    tags: row.tags,
    description: String(t.text_content ?? t.description ?? "").slice(0, 4000),
    dateCreated: row.dateCreatedMs,
    priority: row.priority,
    dueAt: row.dueAtMs,
    status: row.status,
    statusType: row.statusType,
  };
}

/** A sentence from an error, never longer than a note allows. */
export function sentence(e: unknown): string {
  const text = e instanceof Error && e.message ? e.message : String(e ?? "Something went wrong.");
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

/** HH:MM in Kuwait. */
export function kuwaitClock(at: number): string {
  return new Date(at + 3 * 3600_000).toISOString().slice(11, 16);
}

/** Rows in groups of n. */
export function chunks<T>(rows: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}
