// Requests: one ClickUp ticket part per queue row, kind 'request'
// (docs/requests/CONTRACT.md section 4).
//
// The portal's request form (migration 20261026r) freezes everything the
// writer needs into the row's payload: list, template object, task name,
// description, SOP steps, owner, due day, priority, the ClickUp field values,
// the Request Type option and the client card. The writer never reads the
// request type table, so a change in Requests settings applies to the next
// request, never to one already queued.
//
// OUTWARD SAFETY. Only CLICKUP_WRITEBACK_APPLY_REQUESTS exactly "true" opens
// the kinds 'request' and 'task_action' (requestsGate). It opens nothing else,
// and CLICKUP_WRITEBACK_APPLY, _APPLY_CSM_TICKETS, _APPLY_KPI and _ONLY_TASKS
// neither open nor narrow it. CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS
// (comma-separated client card ids) narrows a live run to those cards: the
// rehearsal value is the internal test card 86eywg1cq.
//
// Retry safety, step by step (section 4.3): every write records 'started'
// before the call and 'done' after its read-back. The task id is saved the
// moment it is known. A step that started and never finished is read back
// before anything is written again: a created task is found by its Cockpit
// ref as a whole token (or, from a template, its exact name), a comment by
// its marker, a checklist by its name. Two matches are never guessed between:
// the row goes to 'unknown' for a person, and once they cancel all but one
// in ClickUp, the one left open is adopted.
//
// Dates read back by the Kuwait calendar day, never the millisecond: ClickUp
// stores a date-only due date at its own hour (06:00 Kuwait was seen for a
// 09:00 Kuwait write, writers map section 4).

import { classify, type Planned, type Provider } from "./queue.ts";
import { CLIENTS_LIST, type Row, TECH_FIELD } from "./rules.ts";

// --- Constants (contract 2.1) -------------------------------------------------

export const TEAM_ID = "90182518398";
export const SPACE_ID = "901810248115";
/** The folder field "Request Type" (31 options). Never the Marketing / ADs list field of the same name. */
export const REQUEST_TYPE_FIELD = TECH_FIELD.requestType;
/** Fields the cockpit never writes (CT F3): the Marketing / ADs list "Request Type" and Type of Submission. */
export const PROTECTED_FIELDS = new Set(["09abf737-302f-422a-9d17-8fb9619903d1", "d3ac52c5-b71c-4782-9fea-1f9371cbae47"]);
/** Operations / Tech: where the doctor reads the folder fields. */
export const FIELDS_LIST = "901816723190";
export const ALL_TASKS = "901816723226";
export const CLIENT_CARDS = CLIENTS_LIST;
/** The five department lists a request may be written to. */
export const TARGET_LISTS: Record<string, string> = {
  "901816723190": "Operations / Tech",
  "901816723196": "Marketing / ADs",
  "901816723206": "Call Center",
  "901816723211": "Client Success",
  "901818016338": "Media/Creative",
};
/**
 * The lists the cockpit names in its own words: the five department lists and All Tasks. A focus view
 * press works on a seat's task on any list but a client card itself (taskActions.ts preconditionProblem).
 */
export const ACTION_LISTS: Record<string, string> = { ...TARGET_LISTS, [ALL_TASKS]: "All Tasks" };

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const TEMPLATE_ID = /^t-[a-z0-9]{6,20}$/;
const KUWAIT_MS = 3 * 3_600_000;

// --- Copy (plain, active; contract 4) --------------------------------------------

export const SAY = {
  noToken:
    "CLICKUP_API_TOKEN is not set on this Edge Function. Add it under Edge Functions, Secrets, in the Supabase dashboard. Nothing was read or written.",
  cancelled: "The request was cancelled before it reached ClickUp.",
  twoTasks: "Two tasks match this request in ClickUp. Keep one and cancel the other.",
  /** Review round 3: every task that matched was cancelled, so none is adopted until a person reopens one. */
  allCancelled: "Every task that matches this request in ClickUp is cancelled. Reopen the one to keep, and the next run adopts it.",
  waiting: "Waiting to see whether ClickUp made this task. The next run looks for it by its Cockpit ref.",
  noId: "ClickUp did not return the new task's id. The next run looks for it by its Cockpit ref.",
  /** Review round 3: the search for a create in doubt was refused (a 4xx), so whether the task exists is not known. */
  searchRefused: "ClickUp refused the search for this request's task, so the cockpit cannot tell whether it was made. The next run searches again.",
  notYet: "ClickUp has not shown the new task yet. The next run reads it again.",
  gone: "The task is no longer in ClickUp, so the cockpit stopped. Raise the request again if it is still needed.",
  /** Review R2: a renamed or removed option never stops a request; the task is made and Request Type stays empty. */
  renamed:
    "ClickUp renamed or removed this type's Request Type option, so the cockpit left Request Type empty. The systems manager can rename it back in ClickUp or turn Set Request Type off for this type in Requests settings.",
  descriptionLost: "The task description did not read back with its Cockpit ref. The next run checks it again.",
  twoChecklists: "Two SOP checklists match this request in ClickUp. Keep one and delete the other.",
  checklistShort: "The SOP checklist did not read back in full. The next run adds what is missing.",
  noChecklistId: "ClickUp did not return the new checklist's id. The next run looks for it by name.",
  cardComment: "The link comment on the client card did not read back. The next run looks for it.",
  oldComment: "The comment on the old ticket did not read back. The next run looks for it.",
  oldGone: "The old ticket was already moved or closed.",
  /** Review R2: a routing request whose old ticket the team handled in ClickUp while it waited makes no task. */
  oldHandled: "The old ticket was already moved or closed in ClickUp, so no new task was made. Check it there.",
  /** The old ticket handled between this part's task and its routing step: the task stays, the note says so. */
  oldMovedAfter: "The old ticket was moved or closed in ClickUp before the cockpit could route it, so it was left as it is. Check that the work is not done twice.",
  badPayload: "This request has no usable ClickUp plan. Cancel it and raise it again.",
  bookkeeping: "The cockpit could not save its progress, so the next run reads ClickUp back before writing again.",
  unfinished: "The task is in ClickUp, but the cockpit could not finish every step on it. Check it in ClickUp.",
  noTemplateChecklist: "The template brought no checklist in ClickUp, and this request type has no SOP steps to add. Add them in Requests settings.",
  /** Off by a two-minute check (ClickUp moved one of the type's tasks) or by an editor in Requests settings. */
  rtTurnedOff: "Request Type is off for this type now, so the cockpit left it empty.",
  rtCheckLater: "The cockpit could not check whether Request Type is still on for this type. The next run tries again.",
} as const;

/** What a person reads when ClickUp refused a step after the task was made. The task stays; the part is delivered with this note. */
export const STEP_REFUSED: Record<string, string> = {
  /** Review round 3: ClickUp answered the create with the task's id, then refused to show the task (a 4xx but 404). */
  create: "ClickUp made the task but refused to show it to the cockpit. Check it in ClickUp.",
  description: "The request details did not save in the task description in ClickUp. They are in the cockpit.",
  owner_due_priority: "ClickUp refused the owner, due day or priority. Set them on the task in ClickUp.",
  checklist: "The SOP steps did not save as a checklist in ClickUp. Add them on the task there.",
  tag: "The client tag did not save in ClickUp.",
  fields: "Some fields did not save in ClickUp. They are in the description.",
  request_type: "Request Type did not save in ClickUp.",
  card_comment: "The link comment on the client card did not post in ClickUp. The task itself is there.",
  replaces: "The old ticket was not routed in ClickUp. Close it there.",
};

// --- Small helpers -------------------------------------------------------------------

/** The Kuwait calendar day of a ClickUp millisecond value, or null. */
export const kuwaitDay = (ms: unknown): string | null => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n + KUWAIT_MS).toISOString().slice(0, 10) : null;
};
/** 12:00 Kuwait (09:00 UTC) of a day: ClickUp's re-timing of a date-only value stays on the same Kuwait day. */
export const noonKuwait = (day: string) => Date.parse(`${day}T09:00:00Z`);
/** Option names carry stray spaces in ClickUp ("Connect a New Lead Form  🆕 "): compare trimmed and collapsed. */
export const normName = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const iso = (ms: number) => new Date(ms).toISOString();
export const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const commentText = (c: Row) =>
  String(c.comment_text ?? (Array.isArray(c.comment) ? c.comment.map((x: Row) => x.text ?? "").join("") : ""));
export const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 300);
const isMissing = (e: unknown) => /rejected the request \(404/.test(errorText(e));
const hasUser = (list: unknown, id: unknown) => Array.isArray(list) && id !== null && id !== undefined && list.some((u: Row) => String(u?.id) === String(id));
const statusType = (t: Row) => String(t.status?.type ?? "").toLowerCase();
const isClosed = (t: Row) => ["closed", "done"].includes(statusType(t));
const mdOf = (t: Row) => String(t.markdown_description ?? t.description ?? "");
const plainOf = (t: Row) => String(t.text_content ?? t.description ?? "");
const words = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? ""));

/** One ClickUp task, markdown included. A 404 is null when the caller allows it. */
export async function readTask(provider: Provider, id: string, allowMissing = false): Promise<Row | null> {
  try {
    return await provider.call("clickup", "GET", `task/${id}?include_markdown_description=true`);
  } catch (e) {
    if (allowMissing && isMissing(e)) return null;
    throw e;
  }
}

/**
 * The comment holding `marker` (and `id`, when given), newest first, paging back
 * with start and start_id until the comments are older than `sinceMs`.
 */
export async function findComment(provider: Provider, taskId: string, marker: string, sinceMs: number, id?: string | null, maxPages = 10): Promise<Row | undefined> {
  let query = "";
  for (let page = 0; page < maxPages; page++) {
    const r = await provider.call("clickup", "GET", `task/${taskId}/comment${query}`);
    const comments: Row[] = Array.isArray(r.comments) ? r.comments : [];
    const hit = comments.find(c => (!id || String(c.id) === String(id)) && commentText(c).includes(marker));
    if (hit) return hit;
    if (comments.length < 25) return undefined;
    const oldest = comments[comments.length - 1];
    if (!(Number(oldest.date) >= sinceMs)) return undefined;
    query = `?start=${encodeURIComponent(String(oldest.date))}&start_id=${encodeURIComponent(String(oldest.id))}`;
  }
  return undefined;
}

/** A value read back: a select by option id or its orderindex, a number by value, else the text. */
export function fieldMatches(task: Row, fieldId: string, kind: string, value: unknown): boolean {
  const cf = (Array.isArray(task.custom_fields) ? task.custom_fields : []).find((c: Row) => c.id === fieldId);
  const v = cf?.value;
  if (v === undefined || v === null || v === "") return false;
  if (kind === "select") {
    const opt = (cf.type_config?.options ?? []).find((o: Row) => String(o.id) === String(value));
    return String(v) === String(value) || (opt !== undefined && String(opt.orderindex) === String(v));
  }
  if (kind === "number") return Number(v) === Number(value);
  return String(v).trim() === String(value).trim();
}
const fieldEmpty = (task: Row, fieldId: string) => {
  const v = (Array.isArray(task.custom_fields) ? task.custom_fields : []).find((c: Row) => c.id === fieldId)?.value;
  return v === undefined || v === null || v === "";
};

/** A per-run cache whose failed loads are forgotten, so the next item reads again. */
export function cached<V>(load: (key: string) => Promise<V>) {
  const memo = new Map<string, Promise<V>>();
  return (key: string) => {
    let v = memo.get(key);
    if (!v) {
      v = load(key);
      memo.set(key, v);
      v.catch(() => memo.delete(key));
    }
    return v;
  };
}

// --- Gate (contract 4.1) ------------------------------------------------------------

export function requestsGate(env: (name: string) => string | undefined) {
  const apply = env("CLICKUP_WRITEBACK_APPLY_REQUESTS") === "true";
  const onlyCards = new Set(
    String(env("CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS") ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  );
  return {
    apply,
    onlyCards,
    mode: (!apply ? "dry_run" : onlyCards.size ? "apply_limited" : "apply") as "dry_run" | "apply_limited" | "apply",
    /** A request or a task action is live by its client card. */
    live: (clientTaskId: unknown) => apply && (onlyCards.size === 0 || (typeof clientTaskId === "string" && onlyCards.has(clientTaskId))),
  };
}

// --- Types ----------------------------------------------------------------------------

export type StepState = "started" | "done" | "unchanged" | "skipped" | "mismatch";
export type StepProgress = { state: StepState; at: string; startedAt?: string; [key: string]: unknown };
export type Progress = {
  steps?: Record<string, StepProgress>;
  task?: { id: string; url: string | null };
  verify?: "kept" | "restored" | "removed" | "moved";
  verifyNote?: string;
  note?: string;
  [key: string]: unknown;
};

export type RequestsItem = {
  id: string;
  kind: "request" | "task_action";
  payload: Row;
  attempts: number;
  created_at: string;
  steps?: string[] | null;
  progress?: Progress | null;
  task_id?: string | null;
  source_exists?: boolean;
  /**
   * The All Tasks ticket this row's request routes, on every part (review R2): the requests claim reads it
   * from cockpit_requests.replaces_task_id. A database that does not send it yet leaves only the first part's
   * payload.replacesTaskId, which runRequests copies to the parts claimed with it.
   */
  replaces_task_id?: string | null;
  /**
   * That old ticket's own client card (review round 3), null when it has none: during the canary
   * (apply_limited) a routing request goes only when this card is a canary card (runRequests; migration
   * 20261026r cockpit_request_replaces_ok). A database that does not send it holds every routing request
   * during the canary, the safe side.
   */
  replaces_client_task_id?: string | null;
};

export type RequestOutcome = {
  state: "delivered" | "skipped" | "retry" | "unknown" | "failed";
  progress: Progress;
  error?: string;
  /** Delivered with something worth reading: a field that did not save, a moved task. */
  note?: string;
  taskId?: string;
  /** A missing secret: the whole run stops. */
  stop?: boolean;
};

export type RunContext = {
  now: () => number;
  rpc: (name: string, params?: Row) => Promise<any>;
  /** The client tags of space 901810248115, by lower-case name, read once a run. */
  spaceTags: () => Promise<Map<string, string>>;
  /** A list's fields, read once a run. */
  listFields: (listId: string) => Promise<Row[]>;
  /** A list's statuses, read once a run. */
  listStatuses: (listId: string) => Promise<Row[]>;
  /**
   * Whether Request Type is still on for a type right now (cockpit_request_doctor_inputs, read once a
   * run). A type the database does not name follows its payload (true).
   */
  requestTypeOn: (typeKey: string) => Promise<boolean>;
  /** A two-minute check turned Request Type off for this type in this run. */
  requestTypeTurnedOff: (typeKey: string) => void;
  /** Of these ClickUp task ids, the ones another queue row already owns. */
  ownedElsewhere: (taskIds: string[], queueId: string) => Promise<Set<string>>;
};

export type Save = (patch: Row) => Promise<void>;

/**
 * The database calls of the requests job beyond the shared run rows (begin,
 * save, finish stay in run.ts on migration 20261009f). Each is defined in
 * migration 20261026r and granted to the service role only; requests.test.ts
 * checks that against the migration.
 */
export function requestsDb(rpc: (name: string, params?: Row) => Promise<any>) {
  return {
    sweep: () => rpc("cockpit_request_sweep", {}),
    claim: (token: string, limit: number) => rpc("cockpit_clickup_writeback_claim_requests", { p_token: token, p_limit: limit }),
    state: (ok: boolean, note: string, mode: string, onlyCards: string[], counts: Row = {}) =>
      rpc("cockpit_clickup_requests_state", { p_ok: ok, p_note: note, p_mode: mode, p_only_cards: onlyCards, p_counts: counts }),
    doctorInputs: () => rpc("cockpit_request_doctor_inputs", {}),
    rtOff: (key: string, note: string) => rpc("cockpit_request_type_rt_off", { p_key: key, p_note: note }),
    /**
     * Hand a claimed row back to the queue without counting a try (RT-1): queued again, or retry when it
     * has ClickUp progress, attempts less the claim's one, the plan kept for the review.
     */
    release: (id: string, token: string, planned: unknown[], note: string, nextAttemptAt: string) =>
      rpc("cockpit_clickup_writeback_release", { p_id: id, p_token: token, p_planned: planned, p_note: note, p_next_attempt_at: nextAttemptAt }),
    /** [{taskId, queueId}] for the ClickUp task ids queue rows of kind request already hold (migration r, RT-3). */
    taskOwners: (taskIds: string[]) => rpc("cockpit_clickup_writeback_task_owners", { p_task_ids: taskIds }),
  };
}

/** The run context's three shared reads, each once a run, through the run's own ledger id. */
export function runContext(provider: Provider, now: () => number, rpc: RunContext["rpc"]): RunContext {
  let tags: Promise<Map<string, string>> | undefined;
  let types: Promise<Map<string, boolean>> | undefined;
  const turnedOff = new Set<string>();
  return {
    now,
    rpc,
    spaceTags: () => {
      tags ??= provider.call("clickup", "GET", `space/${SPACE_ID}/tag`).then(r => {
        if (!Array.isArray(r.tags)) throw new Error("ClickUp did not return the space's tags");
        return new Map(r.tags.map((t: Row) => [String(t.name).toLowerCase(), String(t.name)]));
      });
      tags.catch(() => (tags = undefined));
      return tags;
    },
    listFields: cached(listId =>
      provider.call("clickup", "GET", `list/${listId}/field`).then(r => {
        if (!Array.isArray(r.fields)) throw new Error(`ClickUp did not return the fields of list ${listId}`);
        return r.fields as Row[];
      })),
    listStatuses: cached(listId =>
      provider.call("clickup", "GET", `list/${listId}`).then(r => {
        if (!Array.isArray(r.statuses)) throw new Error(`ClickUp did not return the statuses of list ${listId}`);
        return r.statuses as Row[];
      })),
    requestTypeOn: async (typeKey: string) => {
      if (turnedOff.has(typeKey)) return false;
      types ??= requestsDb(rpc).doctorInputs().then((r: Row) => {
        if (!Array.isArray(r?.types)) throw new Error("The request types did not come back from the database.");
        return new Map(r.types.map((t: Row) => [String(t.key), t.setRequestType === true]));
      });
      types.catch(() => (types = undefined));
      return (await types).get(typeKey) ?? true;
    },
    requestTypeTurnedOff: (typeKey: string) => {
      turnedOff.add(typeKey);
    },
    ownedElsewhere: async (taskIds: string[], queueId: string) => {
      if (!taskIds.length) return new Set();
      try {
        const rows = await requestsDb(rpc).taskOwners(taskIds);
        return new Set((Array.isArray(rows) ? rows : []).filter((r: Row) => String(r?.queueId) !== queueId).map((r: Row) => String(r.taskId)));
      } catch {
        // A database without the owners read: the Cockpit ref markers in the descriptions still exclude.
        return new Set();
      }
    },
  };
}

/** Thrown by a step that must end the item here with this state. */
class Halt extends Error {
  constructor(readonly state: RequestOutcome["state"], message: string) {
    super(message);
  }
}

/** Our own progress save failed. A write may have landed, so the item is read back before any new write. */
class Bookkeeping extends Error {}

/** The step machinery shared by requests and task actions. */
export class StepBook {
  /** True while a write call is in flight: a 429 there never landed. */
  writing = false;
  constructor(readonly progress: Progress, private readonly save: Save, private readonly now: () => number) {
    progress.steps ??= {};
  }
  get(key: string): StepProgress | undefined {
    return this.progress.steps?.[key];
  }
  /** Settled: done, unchanged, skipped or mismatch. */
  settled(key: string) {
    const s = this.get(key)?.state;
    return s !== undefined && s !== "started";
  }
  /** Record a step's state (ids learned so far are kept) and save the progress, with any extra patch. */
  async set(key: string, state: StepState, extra: Row = {}, patch: Row = {}) {
    const steps = (this.progress.steps ??= {});
    steps[key] = { ...(steps[key] ?? {}), ...extra, state, at: iso(this.now()) };
    try {
      await this.save({ progress: this.progress, ...patch });
    } catch (e) {
      throw new Bookkeeping(`${SAY.bookkeeping} ${errorText(e).slice(0, 120)}`);
    }
  }
  /** Mark a fresh start: the read-back windows count from here. */
  start(key: string, extra: Row = {}) {
    return this.set(key, "started", { ...extra, startedAt: iso(this.now()) });
  }
  startedAt(key: string, fallback: string) {
    const s = this.get(key);
    return Date.parse(String(s?.startedAt ?? s?.at ?? fallback));
  }
  async write<T>(fn: () => Promise<T>): Promise<T> {
    this.writing = true;
    const out = await fn();
    this.writing = false;
    return out;
  }
  /** After a 429 on a write that never landed, a step with no ids learned starts clean next time. */
  forget(key: string) {
    const s = this.get(key);
    if (s && s.state === "started" && !["id", "checklistId", "commentId"].some(k => s[k])) delete this.progress.steps![key];
  }
}

/**
 * ClickUp's own answer to a call: a status, as cockpit-media-api/tools.ts words it ("clickup rejected the request
 * (404)"), or a read that answered without what it should hold (runContext's "ClickUp did not return the space's
 * tags", which no retry changes).
 */
const CLICKUP_ANSWER = /rejected the request \(\d{3}|^ClickUp did not return /;

/**
 * The outbox ladder's class of an error (queue.ts classify), with one rule for this job (review R2): an error is
 * "refused" only when it carries ClickUp's own answer. Anything else leaves the call in doubt: tools.ts saves the
 * response receipt and reads the body after ClickUp has answered, so a receipt that could not be saved
 * ("Supabase 503: ..."), a timeout or a dropped body read can follow a write that landed. Such an error is
 * "unknown", read back before anything is written again (contract 4.2 item 7: a timeout is unknown, only another
 * 4xx is failed). Every requests catch asks this, never classify itself.
 */
export function errorKind(e: unknown): ReturnType<typeof classify> {
  const kind = classify(e);
  if (kind !== "refused") return kind;
  return CLICKUP_ANSWER.test(e instanceof Error ? e.message : String(e)) ? "refused" : "unknown";
}

/** The outcome of a thrown error, by the outbox's ladder (errorKind). */
export function outcomeOf(e: unknown, book: StepBook, key: string): RequestOutcome {
  if (e instanceof Halt) return { state: e.state, progress: book.progress, error: e.message };
  if (e instanceof Bookkeeping) return { state: "unknown", progress: book.progress, error: e.message };
  const kind = errorKind(e);
  const error = errorText(e);
  if (kind === "config") return { state: "retry", progress: book.progress, error, stop: true };
  if (kind === "retry") {
    if (book.writing) book.forget(key);
    return { state: "retry", progress: book.progress, error };
  }
  if (kind === "unknown") return { state: "unknown", progress: book.progress, error };
  return { state: "failed", progress: book.progress, error };
}

export const halt = (state: RequestOutcome["state"], message: string) => new Halt(state, message);

/**
 * A step that ClickUp refused for good once the task exists: ClickUp's own 4xx that is not a 429, or a step's
 * own "failed". Never the task itself gone, never our own bookkeeping, and never a 429, a 5xx, a lost answer
 * or an error with no ClickUp answer at all (errorKind), which retry from the step.
 */
export function refusedForGood(e: unknown): boolean {
  if (e instanceof Bookkeeping) return false;
  if (e instanceof Halt) return e.state === "failed" && e.message !== SAY.gone;
  return errorKind(e) === "refused";
}

// --- The request steps (contract 4.3) -------------------------------------------------

export const REQUEST_STEPS = ["create", "description", "owner_due_priority", "checklist", "tag", "fields", "request_type", "card_comment", "replaces"];

/** The steps this payload needs, in order. They are frozen on the row before the first write. */
export function requestStepKeys(p: Row): string[] {
  const keys = ["create"];
  if (p.templateId) keys.push("description", "owner_due_priority");
  // Every template part checks its checklist: the template's own, or the SOP steps when it brought none.
  if (p.templateId || hasSopSteps(p)) keys.push("checklist");
  if (p.clientTag) keys.push("tag");
  if (Array.isArray(p.fields) && p.fields.length) keys.push("fields");
  if (p.setRequestType === true) keys.push("request_type");
  if (p.clientTaskId) keys.push("card_comment");
  if (p.replacesTaskId) keys.push("replaces");
  return keys;
}

/** Why this payload cannot be written at all, or null. Ids are checked so no path can be bent. */
export function payloadProblem(p: Row): string | null {
  if (!p || typeof p !== "object") return SAY.badPayload;
  if (!TARGET_LISTS[String(p.listId)]) return "This request points at a list the cockpit does not write to. Cancel it and raise it again.";
  if (!String(p.taskName ?? "").trim() || String(p.taskName).length > 200) return SAY.badPayload;
  if (!/^R-[0-9a-f]{10}-[a-z_]{2,20}$/.test(String(p.ref ?? ""))) return SAY.badPayload;
  if (p.templateId && !TEMPLATE_ID.test(String(p.templateId))) return SAY.badPayload;
  for (const k of ["clientTaskId", "replacesTaskId"]) if (p[k] && !ID.test(String(p[k]))) return SAY.badPayload;
  if (p.ownerClickupId !== null && p.ownerClickupId !== undefined && !/^\d{1,15}$/.test(String(p.ownerClickupId))) return SAY.badPayload;
  if (p.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.dueOn))) return SAY.badPayload;
  return null;
}

const hasSopSteps = (p: Row) => Array.isArray(p.sopSteps) && p.sopSteps.length > 0;
/** When the SOP steps go on: always with no template, only into an empty template otherwise. */
const sopWhen = (p: Row): "always" | "if_template_empty" | null =>
  !hasSopSteps(p) ? null : p.templateId ? "if_template_empty" : "always";
const ownerOf = (p: Row): number | null => (p.ownerClickupId === null || p.ownerClickupId === undefined ? null : Number(p.ownerClickupId));
const dueMsOf = (p: Row): number | null => (Number.isFinite(Number(p.dueMs)) && Number(p.dueMs) > 0 ? Number(p.dueMs) : p.dueOn ? noonKuwait(String(p.dueOn)) : null);
const priorityValueOf = (p: Row): number | null => {
  const n = Number(p.priorityValue ?? { urgent: 1, high: 2, normal: 3, low: 4 }[String(p.priority)]);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
};
const fieldsOf = (p: Row): Row[] => (Array.isArray(p.fields) ? p.fields.filter((f: Row) => f && typeof f.fieldId === "string") : []);
export const markerOf = (p: Row) => `Cockpit ref ${p.ref}`;
/** Any request part's Cockpit ref ("R-" and the request's 10 hex, then the part). */
const ANY_REF = /Cockpit ref R-[0-9a-f]{10}-/;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Whether a text holds this part's Cockpit ref as a whole token (review round 3). Every part of a request shares
 * "R-{10 hex}-", and the type editor names a second task on a board `{board}_two`, so part `tech`'s ref is the
 * start of part `tech_two`'s: a letter, digit, underscore, hyphen or backslash after it (ClickUp's markdown writes
 * `tech\_two`) means another ref. The end of the text, a space, a newline or a full stop may follow it.
 */
export const holdsMarker = (text: unknown, marker: string) =>
  new RegExp(`${escapeRegExp(marker)}(?![A-Za-z0-9_\\\\-])`).test(String(text ?? ""));
/**
 * How long a task ClickUp answered the create with may stay out of sight (a 404 on its read) before the cockpit
 * takes it as gone. The first read already allows for a template applied a moment late; the retry ladder reads it
 * again at about 1, 6 and 21 minutes (review round 3: before, the second read a minute later called it gone).
 */
export const SHOW_WAIT_MS = 30 * 60_000;
const taskUrlOf = (progress: Progress) => progress.task?.url ?? (progress.task ? `https://app.clickup.com/t/${progress.task.id}` : "");

/** The create body for a type with no template (contract 4.3 step 1). Never custom_fields. */
export function createBody(p: Row): Row {
  const body: Row = { name: p.taskName, markdown_description: `${p.descriptionMarkdown ?? ""}\n\n${markerOf(p)}` };
  const owner = ownerOf(p);
  if (owner !== null) body.assignees = [owner];
  const priority = priorityValueOf(p);
  if (priority !== null) body.priority = priority;
  const due = dueMsOf(p);
  if (due !== null) {
    body.due_date = due;
    body.due_date_time = false;
  }
  body.status = "to do";
  body.notify_all = false;
  return body;
}

export const cardCommentText = (p: Row, taskUrl: string) =>
  `Cockpit · ${capital(String(p.requesterLabel ?? "the cockpit"))} asked ${p.listName ?? TARGET_LISTS[String(p.listId)]}: ${p.typeLabel}\n${taskUrl}\n\n${markerOf(p)}-card`;
export const oldTicketComment = (p: Row, taskUrl: string) => `Routed in the cockpit as ${p.typeLabel}: ${taskUrl}\n\n${markerOf(p)}-old`;

/** The Request Type option still exists on the folder field with the same name, trimmed and collapsed. */
async function requestTypeProblem(p: Row, ctx: RunContext): Promise<string | null> {
  const field = (await ctx.listFields(String(p.listId))).find(f => f.id === REQUEST_TYPE_FIELD);
  const option = (field?.type_config?.options ?? []).find((o: Row) => String(o.id) === String(p.requestTypeOptionId));
  return option && normName(option.name) === normName(p.requestTypeOptionName) ? null : SAY.renamed;
}

/** What a request would write, for the dry-run review. No ClickUp call. */
export function planRequest(item: RequestsItem): Planned[] {
  const p = item.payload ?? {};
  const base = { queueId: item.id, kind: "request" };
  const listName = TARGET_LISTS[String(p.listId)] ?? String(p.listName ?? p.listId);
  const out: Planned[] = [{
    ...base,
    taskId: null,
    field: p.templateId ? `new task from the template ${p.templateName ?? p.templateId} on ${listName}` : `new task on ${listName}`,
    old: null,
    new: { name: p.taskName, description: p.templateId ? `the template's text, then: ${p.descriptionMarkdown}` : p.descriptionMarkdown, owner: p.ownerLabel ?? null, ownerClickupId: ownerOf(p), dueOn: p.dueOn ?? null, priority: p.priority ?? null },
    note: markerOf(p),
  }];
  if (hasSopSteps(p))
    out.push({ ...base, taskId: null, field: String(p.sopChecklistName ?? "SOP steps"), old: null, new: p.sopSteps, ...(sopWhen(p) === "if_template_empty" ? { note: "Only when the template brings no checklist." } : {}) });
  else if (p.templateId)
    out.push({ ...base, taskId: null, field: "checklist", old: null, new: null, note: "Reads back that the template brought its checklist; this type has no SOP steps to add." });
  if (p.clientTag) out.push({ ...base, taskId: null, field: "tag", old: null, new: p.clientTag, note: "Only when the space has this tag." });
  for (const f of fieldsOf(p)) out.push({ ...base, taskId: null, field: String(f.label ?? f.fieldId), fieldId: f.fieldId, old: null, new: f.display ?? f.value });
  if (p.setRequestType === true) out.push({ ...base, taskId: null, field: "Request Type", fieldId: REQUEST_TYPE_FIELD, old: null, new: p.requestTypeOptionName });
  if (p.clientTaskId) out.push({ ...base, taskId: String(p.clientTaskId), field: "comment", old: null, new: cardCommentText(p, "(the new task's link)") });
  if (p.replacesTaskId)
    out.push({ ...base, taskId: String(p.replacesTaskId), field: "comment and status", old: null, new: { comment: oldTicketComment(p, "(the new task's link)"), status: "cancelled" } });
  return out;
}

type Ctx = { item: RequestsItem; p: Row; provider: Provider; book: StepBook; ctx: RunContext; notes: string[]; marker: string; latest: Row | null };

/** The task as last read; read again when a write may have changed it. */
async function current(x: Ctx): Promise<Row> {
  return x.latest ?? (await read(x));
}
async function read(x: Ctx): Promise<Row> {
  const id = x.book.progress.task?.id;
  if (!id) throw halt("unknown", SAY.noId);
  const t = await readTask(x.provider, id, true);
  if (!t) throw halt("failed", SAY.gone);
  x.latest = t;
  return t;
}
async function write<T>(x: Ctx, fn: () => Promise<T>): Promise<T> {
  x.latest = null;
  return x.book.write(fn);
}

async function adopt(x: Ctx, t: Row) {
  const { p, book } = x;
  const id = String(t.id);
  book.progress.task = { id, url: String(t.url ?? book.progress.task?.url ?? `https://app.clickup.com/t/${id}`) };
  x.latest = t;
  const listOk = String(t.list?.id ?? "") === String(p.listId);
  const nameOk = String(t.name ?? "") === String(p.taskName);
  if (listOk && nameOk) return book.set("create", "done", { id }, { task_id: id });
  const where = ACTION_LISTS[String(t.list?.id ?? "")] ?? "another list";
  x.notes.push(`ClickUp shows the new task on ${where} as "${String(t.name ?? "")}".`);
  return book.set("create", "mismatch", { id, sawList: t.list?.id ?? null, sawName: t.name ?? null }, { task_id: id });
}

/** A task read back: the task, null on a 404, or ClickUp's own refusal of the read (a 4xx but 404 and 429) in words. */
async function readBack(provider: Provider, id: string): Promise<{ task: Row | null; refused?: string }> {
  try {
    return { task: await readTask(provider, id, true) };
  } catch (e) {
    if (errorKind(e) !== "refused") throw e;
    return { task: null, refused: errorText(e) };
  }
}

/**
 * A task ClickUp made (it answered the create with the id) and then refused to show: it exists, so the part never
 * fails on it (RT-2, review round 3). The create is saved `mismatch` with the refusal and named in the note, and
 * the remaining steps run.
 */
async function adoptUnread(x: Ctx, id: string, refused: string) {
  const { book } = x;
  book.progress.task = { id, url: book.progress.task?.url ?? `https://app.clickup.com/t/${id}` };
  x.latest = null;
  x.notes.push(STEP_REFUSED.create);
  return book.set("create", "mismatch", { id, refused }, { task_id: id });
}

async function stepCreate(x: Ctx) {
  const { p, provider, book } = x;
  const st = book.get("create");
  // A task an earlier attempt learned about (or the row's own task id after a requeue) is read, never made again.
  const known = book.progress.task?.id ?? (x.item.task_id && ID.test(x.item.task_id) ? x.item.task_id : null);
  if (known) {
    const seen = await readBack(provider, known);
    if (seen.refused) return adoptUnread(x, known, seen.refused);
    if (seen.task) return adopt(x, seen.task);
    // A 404 on the task this create made and never saw (still started) is the delay the first read allows for: it
    // is read again on the ladder until 30 minutes after the create, never taken as gone a minute later. A task the
    // part adopted before, or a row's own task id after a requeue, that ClickUp no longer has is gone (review round 3).
    if (st?.state === "started" && x.ctx.now() - book.startedAt("create", x.item.created_at) < SHOW_WAIT_MS)
      throw halt("unknown", SAY.notYet);
    throw halt("failed", SAY.gone);
  }
  if (st?.state === "started") {
    const startedAt = book.startedAt("create", x.item.created_at);
    let r: Row;
    try {
      r = await provider.call("clickup", "GET", `list/${p.listId}/task?order_by=created&include_closed=true&date_created_gt=${startedAt - 60_000}`);
    } catch (e) {
      // The create may have landed, so ClickUp refusing the search never fails the part: failed would say nothing
      // reached ClickUp and invite a second task. It is searched again (review round 3).
      if (errorKind(e) === "refused") throw halt("unknown", `${SAY.searchRefused} ClickUp said: ${errorText(e)}`);
      throw e;
    }
    const tasks: Row[] = Array.isArray(r.tasks) ? r.tasks : [];
    const texts = (t: Row) => [t.text_content, t.description, t.markdown_description].map(s => String(s ?? ""));
    // Never a task another queue row already holds, however it matched (RT-3; review round 3 for the ref).
    const free = async (list: Row[]) => {
      if (!list.length) return list;
      const owned = await x.ctx.ownedElsewhere(list.map(t => String(t.id)), x.item.id);
      return list.filter(t => !owned.has(String(t.id)));
    };
    // This part's own Cockpit ref first, as a whole token: part `tech` never takes part `tech_two`'s task.
    let found = await free(tasks.filter(t => texts(t).some(s => holdsMarker(s, x.marker))));
    // A template task carries no marker until its description step: its exact name, leaving out any task whose
    // text holds another Cockpit ref.
    if (!found.length && p.templateId)
      found = await free(tasks.filter(t => String(t.name) === String(p.taskName) && !texts(t).some(s => ANY_REF.test(s))));
    if (found.length > 1) {
      // Two or more are never guessed between. A person keeps one and cancels the rest, as the error says: a
      // cancelled task (status type closed) no longer counts, and the one left open is adopted (review round 3).
      const open = found.filter(t => statusType(t) !== "closed");
      if (!open.length) throw halt("unknown", SAY.allCancelled);
      if (open.length > 1) throw halt("unknown", SAY.twoTasks);
      found = open;
    }
    if (found.length === 1) {
      // ClickUp listed it, so it is there: its own read carries the markdown, and the list's copy serves when
      // that read finds nothing or is refused.
      const seen = await readBack(provider, String(found[0].id));
      return adopt(x, seen.task ?? found[0]);
    }
    if (x.ctx.now() - startedAt < 5 * 60_000) throw halt("unknown", SAY.waiting);
  }
  await book.start("create");
  const made = await write(x, () =>
    p.templateId
      ? provider.call("clickup", "POST", `list/${p.listId}/taskTemplate/${p.templateId}`, { name: p.taskName })
      : provider.call("clickup", "POST", `list/${p.listId}/task`, createBody(p)));
  const id = String(made?.id ?? made?.task?.id ?? "");
  if (!ID.test(id)) throw halt("unknown", SAY.noId);
  book.progress.task = { id, url: String(made?.url ?? made?.task?.url ?? `https://app.clickup.com/t/${id}`) };
  await book.set("create", "started", { id }, { task_id: id });
  // A task ClickUp has not shown yet (a template applied a moment late) is read again next run, never made twice.
  const seen = await readBack(provider, id);
  if (seen.refused) return adoptUnread(x, id, seen.refused);
  if (!seen.task) throw halt("unknown", SAY.notYet);
  return adopt(x, seen.task);
}

async function stepDescription(x: Ctx) {
  const { p, provider, book } = x;
  const before = await read(x);
  // The ref as a whole token: a sibling part's longer ref (`tech_two` for `tech`) is not this part's (review round 3).
  const marked = (t: Row) => holdsMarker(mdOf(t), x.marker) || holdsMarker(plainOf(t), x.marker);
  if (marked(before)) return book.set("description", "done");
  const template = mdOf(before).trim();
  const templatePlain = plainOf(before).trim();
  await book.start("description");
  const content = template ? `${template}\n\n---\n\n${p.descriptionMarkdown ?? ""}\n\n${x.marker}` : `${p.descriptionMarkdown ?? ""}\n\n${x.marker}`;
  await write(x, () => provider.call("clickup", "PUT", `task/${book.progress.task!.id}`, { markdown_content: content }));
  const after = await read(x);
  if (!marked(after)) throw halt("unknown", SAY.descriptionLost);
  if (templatePlain && !normName(plainOf(after)).startsWith(normName(templatePlain))) {
    x.notes.push("ClickUp may have changed the template's text in the description. Check it in ClickUp.");
    return book.set("description", "mismatch");
  }
  return book.set("description", "done");
}

/** What the template task still lacks: owner, due day (Kuwait), priority. */
function ownerDueDiff(t: Row, p: Row): { patch: Row; missing: string[] } {
  const patch: Row = {};
  const missing: string[] = [];
  const owner = ownerOf(p);
  if (owner !== null && !hasUser(t.assignees, owner)) {
    patch.assignees = { add: [owner], rem: [] };
    missing.push("owner");
  }
  const due = dueMsOf(p);
  if (due !== null && kuwaitDay(t.due_date) !== String(p.dueOn ?? kuwaitDay(due))) {
    patch.due_date = due;
    patch.due_date_time = false;
    missing.push("due day");
  }
  const priority = priorityValueOf(p);
  if (priority !== null && String(t.priority?.priority ?? "").toLowerCase() !== String(p.priority).toLowerCase()) {
    patch.priority = priority;
    missing.push("priority");
  }
  return { patch, missing };
}

async function stepOwnerDue(x: Ctx) {
  const { p, provider, book } = x;
  const resumed = book.get("owner_due_priority")?.state === "started";
  const { patch } = ownerDueDiff(await current(x), p);
  if (!Object.keys(patch).length) return book.set("owner_due_priority", resumed ? "done" : "unchanged");
  await book.start("owner_due_priority");
  await write(x, () => provider.call("clickup", "PUT", `task/${book.progress.task!.id}`, patch));
  const { missing } = ownerDueDiff(await read(x), p);
  if (!missing.length) return book.set("owner_due_priority", "done");
  x.notes.push(`ClickUp did not keep the ${words(missing)} as sent.`);
  return book.set("owner_due_priority", "mismatch", { missing });
}

const itemNames = (cl: Row | undefined) =>
  [...(Array.isArray(cl?.items) ? cl.items : [])].sort((a: Row, b: Row) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0)).map((i: Row) => String(i.name));

async function stepChecklist(x: Ctx) {
  const { p, provider, book } = x;
  if (!hasSopSteps(p)) {
    // A template part with no SOP steps: read back that the template brought its checklist.
    const t = await current(x);
    const lists: Row[] = Array.isArray(t.checklists) ? t.checklists : [];
    if (lists.length) return book.set("checklist", "unchanged", { why: "The template brought its own checklist." });
    x.notes.push(SAY.noTemplateChecklist);
    return book.set("checklist", "mismatch", { why: SAY.noTemplateChecklist });
  }
  const steps: string[] = (p.sopSteps as unknown[]).map(String);
  const name = String(p.sopChecklistName || "SOP steps");
  const st = book.get("checklist");
  const resumed = st?.state === "started";
  const t = await current(x);
  const lists: Row[] = Array.isArray(t.checklists) ? t.checklists : [];
  let cl = st?.checklistId ? lists.find(c => String(c.id) === String(st.checklistId)) : undefined;
  if (!cl && resumed) {
    const since = book.startedAt("checklist", x.item.created_at) - 60_000;
    // A checklist ClickUp shows without a creation time is taken as possibly ours, never missed.
    const named = lists.filter(c => String(c.name) === name && !(Number(c.date_created) < since));
    if (named.length > 1) throw halt("unknown", SAY.twoChecklists);
    cl = named[0];
    if (cl) await book.set("checklist", "started", { checklistId: String(cl.id) });
  }
  let wrote = false;
  if (!cl) {
    if (sopWhen(p) === "if_template_empty" && lists.length > 0)
      return book.set("checklist", "skipped", { why: "The template brought its own checklist." });
    await book.start("checklist");
    const made = await write(x, () => provider.call("clickup", "POST", `task/${book.progress.task!.id}/checklist`, { name }));
    const cid = String(made?.checklist?.id ?? "");
    if (!cid) throw halt("unknown", SAY.noChecklistId);
    cl = made.checklist as Row;
    wrote = true;
    await book.set("checklist", "started", { checklistId: cid });
  }
  // Add only the steps it lacks, in order (a name used twice counts twice).
  const have = new Map<string, number>();
  for (const n of itemNames(cl)) have.set(n, (have.get(n) ?? 0) + 1);
  for (const s of steps) {
    const n = have.get(s) ?? 0;
    if (n > 0) {
      have.set(s, n - 1);
      continue;
    }
    await write(x, () => provider.call("clickup", "POST", `checklist/${cl!.id}/checklist_item`, { name: s }));
    wrote = true;
  }
  const after = await read(x);
  const back = (Array.isArray(after.checklists) ? after.checklists : []).find((c: Row) => String(c.id) === String(cl!.id));
  const names = itemNames(back);
  if (back && String(back.name) === name && names.length === steps.length && names.every((n, i) => n === steps[i]))
    return book.set("checklist", wrote || resumed ? "done" : "unchanged");
  const left = new Map<string, number>();
  for (const n of names) left.set(n, (left.get(n) ?? 0) + 1);
  const all = steps.every(s => {
    const n = left.get(s) ?? 0;
    left.set(s, n - 1);
    return n > 0;
  });
  if (!back || !all) throw halt("unknown", SAY.checklistShort);
  x.notes.push("The SOP steps are on the task, but not in the right order.");
  return book.set("checklist", "mismatch");
}

async function stepTag(x: Ctx) {
  const { p, provider, book } = x;
  const resumed = book.get("tag")?.state === "started";
  const tag = (await x.ctx.spaceTags()).get(String(p.clientTag).toLowerCase());
  if (!tag) return book.set("tag", "skipped", { why: "The ClickUp space has no tag for this client." });
  const has = (t: Row) => (Array.isArray(t.tags) ? t.tags : []).some((g: Row) => String(g.name).toLowerCase() === tag.toLowerCase());
  if (has(await current(x))) return book.set("tag", resumed ? "done" : "unchanged");
  await book.start("tag");
  try {
    await write(x, () => provider.call("clickup", "POST", `task/${book.progress.task!.id}/tag/${encodeURIComponent(tag)}`));
  } catch (e) {
    if (errorKind(e) !== "refused") throw e;
    x.notes.push("The client tag did not save in ClickUp.");
    return book.set("tag", "mismatch", { refused: errorText(e) });
  }
  if (has(await read(x))) return book.set("tag", "done");
  x.notes.push("The client tag did not save in ClickUp.");
  return book.set("tag", "mismatch");
}

async function stepFields(x: Ctx) {
  const { p, provider, book } = x;
  const resumed = book.get("fields")?.state === "started";
  const t = await current(x);
  const results: Record<string, string> = { ...((book.get("fields")?.fields as Record<string, string>) ?? {}) };
  const mismatched: string[] = [];
  let started = resumed;
  let wrote = false;
  for (const f of fieldsOf(p)) {
    const label = String(f.label ?? f.fieldId);
    // Never the two fields the cockpit never writes, and never Request Type here: only its own step sets it,
    // last, where the type's switch is on (R8). The database never freezes one into a payload (migration
    // 20261026r cockpit_request_never_written); this is the second guard.
    const fid = f.fieldId.toLowerCase();
    if (PROTECTED_FIELDS.has(fid) || fid === REQUEST_TYPE_FIELD) {
      results[f.fieldId] = "mismatch";
      mismatched.push(label);
      continue;
    }
    if (fieldMatches(t, f.fieldId, String(f.kind), f.value)) {
      results[f.fieldId] = results[f.fieldId] === "done" || resumed ? "done" : "unchanged";
      continue;
    }
    if (!started) {
      await book.start("fields", { fields: results });
      started = true;
    }
    try {
      await write(x, () => provider.call("clickup", "POST", `task/${book.progress.task!.id}/field/${f.fieldId}`, { value: f.value }));
      results[f.fieldId] = "written";
      wrote = true;
    } catch (e) {
      if (errorKind(e) !== "refused") throw e;
      results[f.fieldId] = "mismatch";
      mismatched.push(label);
    }
  }
  if (wrote) {
    const after = await read(x);
    for (const f of fieldsOf(p)) {
      if (results[f.fieldId] !== "written") continue;
      if (fieldMatches(after, f.fieldId, String(f.kind), f.value)) results[f.fieldId] = "done";
      else {
        results[f.fieldId] = "mismatch";
        mismatched.push(String(f.label ?? f.fieldId));
      }
    }
  }
  if (mismatched.length) {
    x.notes.push(`Some fields did not save in ClickUp: ${mismatched.join(", ")}. They are in the description.`);
    return book.set("fields", "mismatch", { fields: results, mismatched });
  }
  return book.set("fields", wrote || resumed ? "done" : "unchanged", { fields: results });
}

async function stepRequestType(x: Ctx) {
  const { p, provider, book } = x;
  const resumed = book.get("request_type")?.state === "started";
  const optionId = String(p.requestTypeOptionId);
  const t = await current(x);
  // Already there (a write whose answer was lost, or a rule that set it): nothing to decide.
  if (fieldMatches(t, REQUEST_TYPE_FIELD, "select", optionId)) return book.set("request_type", resumed ? "done" : "unchanged");
  // The payload is frozen, but Request Type may be off for this type now: a two-minute check turned it off
  // (ClickUp moved one of its tasks) or an editor did in Requests settings. The live switch is read first, so
  // a part filed or held while it was on leaves it empty (review R2).
  let on: boolean;
  try {
    on = await x.ctx.requestTypeOn(String(p.typeKey));
  } catch {
    throw halt("retry", SAY.rtCheckLater);
  }
  if (!on) {
    x.notes.push(SAY.rtTurnedOff);
    return book.set("request_type", "skipped", { why: SAY.rtTurnedOff });
  }
  // An option ClickUp renamed or removed is never written (it may mean another type now), and it never stops
  // the request: the task is in ClickUp, Request Type stays empty and the note says what to do (review R2).
  if (await requestTypeProblem(p, x.ctx)) {
    x.notes.push(SAY.renamed);
    return book.set("request_type", "skipped", { why: SAY.renamed });
  }
  if (!fieldEmpty(t, REQUEST_TYPE_FIELD)) {
    // Written only when empty: a value someone else set stays.
    x.notes.push("Request Type in ClickUp already shows another type, so the cockpit left it.");
    return book.set("request_type", "mismatch");
  }
  await book.start("request_type");
  try {
    await write(x, () => provider.call("clickup", "POST", `task/${book.progress.task!.id}/field/${REQUEST_TYPE_FIELD}`, { value: optionId }));
  } catch (e) {
    if (errorKind(e) !== "refused") throw e;
    x.notes.push("Request Type did not save in ClickUp.");
    return book.set("request_type", "mismatch", { refused: errorText(e) });
  }
  if (fieldMatches(await read(x), REQUEST_TYPE_FIELD, "select", optionId)) return book.set("request_type", "done");
  x.notes.push("Request Type did not save in ClickUp.");
  return book.set("request_type", "mismatch");
}

/** A comment posted once: found by its marker on resume, read back by id and marker after the post. */
async function postComment(x: Ctx, key: string, taskId: string, text: string, marker: string, missing: string) {
  const { provider, book } = x;
  const st = book.get(key);
  if (st?.state === "started") {
    const found = await findComment(provider, taskId, marker, book.startedAt(key, x.item.created_at) - 60_000);
    if (found) return String(found.id);
  }
  if (!st?.commentId) await book.start(key);
  const since = book.startedAt(key, x.item.created_at) - 60_000;
  const made = await write(x, () => provider.call("clickup", "POST", `task/${taskId}/comment`, { comment_text: text, notify_all: false }));
  const cid = made?.id === undefined || made?.id === null ? null : String(made.id);
  if (cid) await book.set(key, "started", { commentId: cid });
  const back = await findComment(provider, taskId, marker, since, cid);
  if (!back) throw halt("unknown", missing);
  return String(back.id);
}

async function stepCardComment(x: Ctx) {
  const { p, book } = x;
  const card = String(p.clientTaskId);
  const id = await postComment(x, "card_comment", card, cardCommentText(p, taskUrlOf(book.progress)), `${x.marker}-card`, SAY.cardComment);
  return book.set("card_comment", "done", { commentId: id });
}

async function stepReplaces(x: Ctx) {
  const { p, provider, book } = x;
  const oldId = String(p.replacesTaskId);
  const marker = `${x.marker}-old`;
  const st = book.get("replaces");
  // The task is made: an old ticket handled in ClickUp since the check before it stays as it is, and the part's
  // note says so, because the work may now be in two tasks (review R2; before, this skip was silent).
  const handled = () => {
    x.notes.push(SAY.oldMovedAfter);
    return book.set("replaces", "skipped", { why: SAY.oldGone });
  };
  let old = await readTask(provider, oldId, true);
  if (!old) return handled();
  let commentId = st?.commentId ? String(st.commentId) : null;
  if (!commentId && st?.state === "started") {
    const found = await findComment(provider, oldId, marker, book.startedAt("replaces", x.item.created_at) - 60_000);
    if (found) commentId = String(found.id);
  }
  if (!commentId) {
    if (String(old.list?.id ?? "") !== ALL_TASKS || isClosed(old)) return handled();
    commentId = await postComment(x, "replaces", oldId, oldTicketComment(p, taskUrlOf(book.progress)), marker, SAY.oldComment);
  }
  await book.set("replaces", "started", { commentId });
  // Someone may have closed or completed it since: that stays as it is.
  if (!isClosed(old)) {
    try {
      await write(x, () => provider.call("clickup", "PUT", `task/${oldId}`, { status: "cancelled" }));
    } catch (e) {
      if (errorKind(e) !== "refused") throw e;
      x.notes.push("The old ticket did not close in ClickUp. Close it there.");
      return book.set("replaces", "mismatch", { commentId, refused: errorText(e) });
    }
    old = await readTask(provider, oldId, true);
    if (!old || statusType(old) !== "closed") {
      x.notes.push("The old ticket did not close in ClickUp. Close it there.");
      return book.set("replaces", "mismatch", { commentId });
    }
  }
  return book.set("replaces", "done", { commentId });
}

const STEP_RUNNERS: Record<string, (x: Ctx) => Promise<unknown>> = {
  create: stepCreate,
  description: stepDescription,
  owner_due_priority: stepOwnerDue,
  checklist: stepChecklist,
  tag: stepTag,
  fields: stepFields,
  request_type: stepRequestType,
  card_comment: stepCardComment,
  replaces: stepReplaces,
};

/** "R-1a2b3c4d5e-": the part of a Cockpit ref every part of one request shares. */
const requestRefOf = (p: Row) => /^R-[0-9a-f]{10}-/.exec(String(p.ref ?? ""))?.[0] ?? null;

/**
 * Whether the old ticket a routing request replaces was handled in ClickUp while the request waited (held until
 * requests open, review R2): deleted, closed or done, or moved off All Tasks. Its sentence, or null while the
 * ticket still waits on All Tasks. A moved or closed ticket that carries a comment from this same request was
 * routed by it: the first part posts that comment and cancels the ticket in its last step, which never stops
 * another part of the request.
 */
async function oldTicketHandled(x: Ctx, oldId: string): Promise<string | null> {
  const old = await readTask(x.provider, oldId, true);
  if (old && String(old.list?.id ?? "") === ALL_TASKS && !isClosed(old)) return null;
  const ref = requestRefOf(x.p);
  if (old && ref) {
    const ours = await findComment(x.provider, oldId, `Cockpit ref ${ref}`, Date.parse(x.item.created_at) - 60_000);
    if (ours) return null;
  }
  return SAY.oldHandled;
}

/**
 * Write one request part to ClickUp, step by step. `save` persists the progress
 * (and the task id the moment it is known) before and after every write.
 */
export async function executeRequest(item: RequestsItem, provider: Provider, save: Save, ctx: RunContext): Promise<RequestOutcome> {
  const p = item.payload ?? {};
  const book = new StepBook(structuredClone(item.progress ?? {}), save, ctx.now);
  const problem = payloadProblem(p);
  if (problem) return { state: "failed", progress: book.progress, error: problem };
  // The old ticket this request routes: on the first part's payload, and on every part from the claim.
  const routes = p.replacesTaskId || item.replaces_task_id || null;
  if (routes && !ID.test(String(routes))) return { state: "failed", progress: book.progress, error: SAY.badPayload };
  const x: Ctx = { item, p, provider, book, ctx, notes: [], marker: markerOf(p), latest: null };
  const keys = (item.steps?.length ? item.steps : requestStepKeys(p)).filter(k => STEP_RUNNERS[k]);
  let key = "create";
  try {
    // A routing request reads its old ticket before it makes anything, so a ticket the team moved or closed in
    // ClickUp while the request was held gets no second task (review R2). Every part checks, before its create
    // starts; a part whose task may exist never stops here.
    const taskKnown = Boolean(book.progress.task?.id) || (typeof item.task_id === "string" && ID.test(item.task_id));
    if (routes && !book.get("create") && !taskKnown) {
      const handled = await oldTicketHandled(x, String(routes));
      if (handled) return { state: "skipped", progress: book.progress, error: handled };
    }
    // Request Type never stops a part before its task is made: its own step, last, reads the switch and the
    // option and leaves it empty with a note when either has changed (review R2).
    for (key of keys) {
      if (book.settled(key)) continue;
      book.writing = false;
      try {
        await STEP_RUNNERS[key](x);
      } catch (e) {
        // Once the task exists, a step ClickUp refused for good never fails the part: a failed part
        // invites a second request and a second task. The step is marked and named, the rest go on.
        if (key === "create" || !book.progress.task?.id || !refusedForGood(e)) throw e;
        x.latest = null;
        await book.set(key, "mismatch", { refused: errorText(e) });
        x.notes.push(e instanceof Halt ? e.message : (STEP_REFUSED[key] ?? SAY.unfinished));
      }
    }
  } catch (e) {
    return { ...outcomeOf(e, book, key), taskId: book.progress.task?.id };
  }
  const note = x.notes.length ? x.notes.join(" ") : undefined;
  if (note) book.progress.note = note;
  else delete book.progress.note;
  return { state: "delivered", progress: book.progress, note, taskId: book.progress.task?.id };
}

// --- The doctor's checks (contract 4.5), reads only ---------------------------------------

export const REQUEST_SECRETS = ["CLICKUP_API_TOKEN", "CRON_SECRET", "CLICKUP_WRITEBACK_APPLY_REQUESTS", "CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS"];

/**
 * Every template object a target names is in ClickUp, the Request Type option of
 * every type that sets it still exists with the same name, every field is on the folder, every
 * named owner is a workspace member and every target list has a done status.
 */
export async function doctorChecks(inputs: Row, provider: Provider): Promise<{ problems: string[]; counts: Row }> {
  const problems: string[] = [];
  const types: Row[] = Array.isArray(inputs?.types) ? inputs.types : [];
  if (!types.length) problems.push("No request types came back from the database. Apply migrations 20261026r and 20261026s first.");
  const tryRead = async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      problems.push(`Could not read ${what} from ClickUp: ${errorText(e).slice(0, 160)}`);
      return null;
    }
  };
  const templates = await tryRead("the task templates", async () => {
    const ids = new Map<string, string>();
    for (let page = 0; page <= 5; page++) {
      const r = await provider.call("clickup", "GET", `team/${TEAM_ID}/taskTemplate?page=${page}`);
      const list: Row[] = Array.isArray(r.templates) ? r.templates : [];
      for (const t of list) ids.set(String(t.id), String(t.name));
      if (!list.length) break;
    }
    return ids;
  });
  const fields = await tryRead("the Operations / Tech fields", async () => {
    const r = await provider.call("clickup", "GET", `list/${FIELDS_LIST}/field`);
    if (!Array.isArray(r.fields)) throw new Error("no field list came back");
    return r.fields as Row[];
  });
  const members = await tryRead("the workspace members", async () => {
    const r = await provider.call("clickup", "GET", "team");
    const teams: Row[] = Array.isArray(r.teams) ? r.teams : [];
    const team = teams.find(t => String(t.id) === TEAM_ID) ?? teams[0];
    if (!team) throw new Error("no workspace came back");
    return new Set((Array.isArray(team.members) ? team.members : []).map((m: Row) => String(m.user?.id ?? m.id)));
  });
  const listIds = [...new Set(types.flatMap(t => (Array.isArray(t.targets) ? t.targets : []).map((g: Row) => String(g.listId))))];
  const statuses = new Map<string, Row[]>();
  for (const id of listIds) {
    const r = await tryRead(`the ${TARGET_LISTS[id] ?? id} list`, () => provider.call("clickup", "GET", `list/${id}`));
    if (r) statuses.set(id, Array.isArray(r.statuses) ? r.statuses : []);
  }
  const rtField = fields?.find(f => f.id === REQUEST_TYPE_FIELD);
  if (fields && !rtField) problems.push("The Request Type field is not on the Operations / Tech list in ClickUp.");
  const fieldIds = new Set((fields ?? []).map(f => String(f.id)));
  let targets = 0;
  for (const t of types) {
    const key = String(t.key);
    // Only a type that sets Request Type uses its option; one switched off in Requests settings is fine as it is
    // (review R2: the doctor stayed red after the fix it names). The option name cannot be edited in the cockpit,
    // so the sentences name the two things that work.
    if (rtField && t.setRequestType !== false) {
      const option = (rtField.type_config?.options ?? []).find((o: Row) => String(o.id) === String(t.optionId));
      if (!option)
        problems.push(
          `${key}: its Request Type option is not in ClickUp any more, so its requests leave Request Type empty. Turn Set Request Type off for this type in Requests settings.`,
        );
      else if (normName(option.name) !== normName(t.optionName))
        problems.push(
          `${key}: ClickUp renamed its Request Type option to "${normName(option.name)}", so its requests leave Request Type empty. Rename it back in ClickUp, or turn Set Request Type off for this type in Requests settings.`,
        );
    }
    if (fields)
      for (const f of Array.isArray(t.fieldIds) ? t.fieldIds : [])
        if (!fieldIds.has(String(f))) problems.push(`${key}: the field ${f} is not on the Operations / Tech list in ClickUp.`);
    for (const g of Array.isArray(t.targets) ? t.targets : []) {
      targets += 1;
      if (templates && g.templateId && !templates.has(String(g.templateId)))
        problems.push(`${key}: the template ${g.templateId} for the ${g.part} part is not in ClickUp any more. Pick another in Requests settings.`);
      if (members && g.ownerClickupId !== null && g.ownerClickupId !== undefined && !members.has(String(g.ownerClickupId)))
        problems.push(`${key}: the named owner of the ${g.part} part (ClickUp user ${g.ownerClickupId}) is not in the workspace. Pick someone else in Requests settings.`);
    }
  }
  for (const [id, list] of statuses)
    if (!list.some(s => String(s.type).toLowerCase() === "done"))
      problems.push(`${TARGET_LISTS[id] ?? id} has no status of type done in ClickUp, so Mark done cannot work there.`);
  return {
    problems,
    counts: { types: types.length, targets, lists: listIds.length, templates: templates?.size ?? null, fields: fields?.length ?? null, members: members?.size ?? null },
  };
}
