// Task actions: one press in a cockpit's focus view, kind 'task_action'
// (docs/requests/CONTRACT.md 3.4 and 4.4), plus the two-minute check of a
// delivered request part (op 'verify', queued by migration 20261026r's sync
// trigger on delivery).
//
// Before any write the writer reads the task once. That read serves the
// precondition (the task is still on a list where the action works, the
// person is still on it, the step or status is still what they saw) and later
// the comparison for the read-back. A press made on stale information is
// skipped with a plain sentence, never forced onto ClickUp.

import type { Planned, Provider } from "./queue.ts";
import {
  ACTION_LISTS,
  CLIENT_CARDS,
  capital,
  findComment,
  halt,
  normName,
  outcomeOf,
  readTask,
  requestsDb,
  type RequestOutcome,
  type RequestsItem,
  type RunContext,
  type Save,
  StepBook,
  TARGET_LISTS,
} from "./requests.ts";
import type { Row } from "./rules.ts";

export const ACTION_SAY = {
  notYours: "This task is no longer yours in ClickUp. Open it there.",
  clientCard: "This is a client card. Open it in ClickUp.",
  /** Migration 20261026t refuses these words in cockpit_task_act; a row that carries them anyway is never posted. */
  markerWords: 'Leave out the words "Cockpit ref". The cockpit adds its own to every comment.',
  stepChanged: "ClickUp changed this step. Open the task there.",
  moved: "Someone moved this task in ClickUp. Open it there.",
  gone: "This task is no longer in ClickUp.",
  notShown: "ClickUp has not shown the change yet. The next run checks again.",
  commentLost: "The comment did not read back. The next run looks for it.",
  noDone: (list: string) => `${list} has no done status in ClickUp. Mark it done there.`,
  badAction: "This change has no usable ClickUp plan. Make it again from the task.",
  removed: (list: string) => `A ClickUp rule on ${list} keeps removing the owner.`,
  alsoAdded: "ClickUp also added another person.",
  rtOffLater: "Request Type could not be turned off for this type just now. The next run tries again.",
  ownerOff: "The owner is no longer on it.",
  /** Review R2: a check that runs late changes nothing; what it saw is named first. */
  late: (seen: string) => `${seen} This check ran too late to tell a ClickUp rule from a person's change, so the cockpit changed nothing.`,
} as const;

/**
 * Where Mark done is not offered, and why (review round 2, ask F12; migration 20261026t
 * cockpit_task_done_blocked holds the same two lists and sentences). Mark done writes the list's
 * done-type status, which on these two lists sets more off than closing a task: on Video Pipeline
 * done means the video is live, and on WhatsApp Reconnection a status change messages the client.
 */
export const DONE_BLOCKED: Record<string, string> = {
  "901816720767": "Mark done is not offered on Video Pipeline, where done means the video is live. Move it in ClickUp.",
  "901821803697": "Mark done is not offered on WhatsApp Reconnection, where a status change messages the client. Move it in ClickUp.",
};

/** Words that would read as a Cockpit ref (cockpit_task_act refuses the same pattern). */
const MARKER_WORDS = /cockpit\s+ref\s+[a-z0-9]/i;

/** The two-minute check is due this long after its part was delivered (migration 20261026r's sync trigger). */
export const VERIFY_DUE_MS = 2 * 60_000;
/**
 * Past its time by more than this, a move, a rename or a missing owner may be a person's own change rather than
 * a list rule, so the check turns nothing off and puts nobody back (review R2). A check waits through a switch-off
 * (the claim takes nothing in a dry run), a writer outage or the retry ladder, and can run days late.
 */
export const VERIFY_LATE_MS = 15 * 60_000;

/** An ISO time with its offset, as PostgreSQL writes a timestamptz into JSON (and cockpit_request_step_at reads). */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;
/**
 * A time migration 20261026r's sync trigger put on a 2-minute check (`ownerAt`, `madeAt`), in ms; anything
 * unreadable (absent, not a string, not such a time) is absent, so the check falls back to the next clock.
 */
export const stampMs = (v: unknown): number | null => {
  if (typeof v !== "string" || !STAMP.test(v.trim())) return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? ms : null;
};

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const OPS = new Set(["tick", "untick", "comment", "done", "verify"]);
const hasUser = (list: unknown, id: unknown) =>
  Array.isArray(list) && id !== null && id !== undefined && list.some((u: Row) => String(u?.id) === String(id));
const flat = (items: unknown): Row[] => (Array.isArray(items) ? items : []).flatMap((i: Row) => [i, ...flat(i.children)]);
const listName = (task: Row, fallback?: string) => ACTION_LISTS[String(task.list?.id ?? "")] ?? String(task.list?.name ?? fallback ?? "this list");

/** One step per action, keyed by its op. */
export const taskActionStepKeys = (p: Row) => [String(p.op)];

export const actionCommentText = (p: Row) =>
  `${capital(String(p.actor?.label ?? "a teammate"))} wrote in the cockpit: ${String(p.text ?? "")}\n\nCockpit ref ${p.ref}`;

export const RT_OFF_NOTE = (taskName: string) =>
  `ClickUp moved or renamed ${taskName} after its Request Type was set, so Request Type is off for this type.`;

/** What a task action would write, for the dry-run review. No ClickUp call. */
export function planTaskAction(item: RequestsItem): Planned[] {
  const p = item.payload ?? {};
  const base = { queueId: item.id, kind: "task_action", taskId: p.taskId ? String(p.taskId) : null };
  if (p.op === "tick" || p.op === "untick") return [{ ...base, field: `checklist step "${p.itemName}"`, old: p.from ?? null, new: p.to ?? null }];
  if (p.op === "comment") return [{ ...base, field: "comment", old: null, new: actionCommentText(p) }];
  if (p.op === "done") return [{ ...base, field: "status", old: p.statusSeen ?? null, new: "the list's done status" }];
  if (p.op === "verify")
    return [{ ...base, field: "owner check", old: null, new: p.ownerClickupId ?? null, note: "Reads the task again and puts the owner back once if a ClickUp rule removed them." }];
  return [{ ...base, field: String(p.op), old: null, new: null, note: ACTION_SAY.badAction }];
}

function actionProblem(p: Row): string | null {
  if (!OPS.has(String(p.op)) || !ID.test(String(p.taskId ?? ""))) return ACTION_SAY.badAction;
  if (p.op === "verify") return null;
  if (!/^T-[0-9a-f]{10}$/.test(String(p.ref ?? ""))) return ACTION_SAY.badAction;
  if ((p.op === "tick" || p.op === "untick") && (!ID.test(String(p.checklistId ?? "")) || !ID.test(String(p.itemId ?? "")) || typeof p.to !== "boolean"))
    return ACTION_SAY.badAction;
  if (p.op === "comment" && !(String(p.text ?? "").trim().length > 0 && String(p.text).length <= 2000)) return ACTION_SAY.badAction;
  // The reader names a comment's writer from the marker that ends it: words that hold one could pass as another
  // press's comment or the cockpit's own. The database refuses them at the press; this is the second guard.
  if (p.op === "comment" && MARKER_WORDS.test(String(p.text))) return ACTION_SAY.markerWords;
  return null;
}

/**
 * The task is on a list where this op works, and the person may still act on it, as cockpit_task_can
 * and cockpit_task_act say (migration 20261026t). A client card itself is written in ClickUp; its real
 * subtasks (ClickUp's `parent` set) and a seat's task on any other list take a tick, a comment and Mark
 * done (review round 2, ask F12), but Mark done on the two lists in DONE_BLOCKED.
 */
function preconditionProblem(p: Row, t: Row): string | null {
  const list = String(t.list?.id ?? "");
  const cardSubtask = list === CLIENT_CARDS && typeof t.parent === "string" && t.parent.trim() !== "";
  if (list === CLIENT_CARDS && !cardSubtask) return ACTION_SAY.clientCard;
  if (p.op === "done" && DONE_BLOCKED[list]) return DONE_BLOCKED[list];
  const actor = p.actor ?? {};
  const onIt = hasUser(t.assignees, actor.clickupUserId) || hasUser(t.watchers, actor.clickupUserId);
  if (!onIt && actor.isAdmin !== true && p.requesterOfTask !== true) return ACTION_SAY.notYours;
  return null;
}

async function tick(book: StepBook, provider: Provider, p: Row, t: Row) {
  const op = String(p.op);
  const resumed = book.get(op)?.state === "started";
  const checklist = (Array.isArray(t.checklists) ? t.checklists : []).find((c: Row) => String(c.id) === String(p.checklistId));
  const item = flat(checklist?.items).find(i => String(i.id) === String(p.itemId));
  if (!item || String(item.name) !== String(p.itemName)) throw halt("skipped", ACTION_SAY.stepChanged);
  const to = p.to === true;
  if (Boolean(item.resolved) === to) return book.set(op, resumed ? "done" : "unchanged");
  if (Boolean(item.resolved) !== (p.from === true)) throw halt("skipped", ACTION_SAY.stepChanged);
  await book.start(op);
  await book.write(() => provider.call("clickup", "PUT", `checklist/${p.checklistId}/checklist_item/${p.itemId}`, { resolved: to }));
  const after = await readTask(provider, String(p.taskId), true);
  if (!after) throw halt("skipped", ACTION_SAY.gone);
  const back = flat((Array.isArray(after.checklists) ? after.checklists : []).find((c: Row) => String(c.id) === String(p.checklistId))?.items).find(
    i => String(i.id) === String(p.itemId),
  );
  if (!back || Boolean(back.resolved) !== to) throw halt("unknown", ACTION_SAY.notShown);
  return book.set(op, "done");
}

async function comment(book: StepBook, provider: Provider, p: Row, createdAt: string) {
  const marker = `Cockpit ref ${p.ref}`;
  const st = book.get("comment");
  if (st?.state === "started") {
    const found = await findComment(provider, String(p.taskId), marker, book.startedAt("comment", createdAt) - 60_000);
    if (found) return book.set("comment", "done", { commentId: String(found.id) });
  }
  await book.start("comment");
  const since = book.startedAt("comment", createdAt) - 60_000;
  const made = await book.write(() => provider.call("clickup", "POST", `task/${p.taskId}/comment`, { comment_text: actionCommentText(p), notify_all: false }));
  const cid = made?.id === undefined || made?.id === null ? null : String(made.id);
  if (cid) await book.set("comment", "started", { commentId: cid });
  const back = await findComment(provider, String(p.taskId), marker, since, cid);
  if (!back) throw halt("unknown", ACTION_SAY.commentLost);
  return book.set("comment", "done", { commentId: String(back.id) });
}

async function markDone(book: StepBook, provider: Provider, p: Row, t: Row, ctx: RunContext) {
  const resumed = book.get("done")?.state === "started";
  const type = String(t.status?.type ?? "").toLowerCase();
  if (type === "done") return book.set("done", resumed ? "done" : "unchanged");
  if (normName(t.status?.status).toLowerCase() !== normName(p.statusSeen).toLowerCase()) throw halt("skipped", ACTION_SAY.moved);
  const listId = String(t.list?.id);
  const status = (await ctx.listStatuses(listId)).find(s => String(s.type).toLowerCase() === "done")?.status;
  if (!status) throw halt("failed", ACTION_SAY.noDone(listName(t)));
  await book.start("done", { status: String(status) });
  await book.write(() => provider.call("clickup", "PUT", `task/${p.taskId}`, { status: String(status) }));
  const after = await readTask(provider, String(p.taskId), true);
  if (!after) throw halt("skipped", ACTION_SAY.gone);
  if (normName(after.status?.status).toLowerCase() !== normName(status).toLowerCase() || String(after.status?.type ?? "").toLowerCase() !== "done")
    throw halt("unknown", ACTION_SAY.notShown);
  return book.set("done", "done");
}

/**
 * The two-minute check of a delivered request part: the task kept its list,
 * its name and its owner. A list rule that removed the owner gets them put
 * back once. A task ClickUp moved or renamed after Request Type was set turns
 * Request Type off for that type, and nothing is put back.
 *
 * Only on time (review R2): a check that runs more than VERIFY_LATE_MS after it
 * was due cannot tell a list rule from a person, so it reads the task, names
 * what changed and changes nothing. What an on-time attempt already saw or
 * started is finished however late the retry runs: a move it saw still turns
 * Request Type off, and an owner it began putting back is only read back.
 *
 * Due is measured from the writes the check judges, not from delivery (review
 * round 3; the sync trigger stamps them on the payload): Request Type from
 * `madeAt`, the owner from `ownerAt` (then `madeAt`), each falling back to the
 * check's own `created_at`. A later step retried for hours (the card comment,
 * the old ticket) delays delivery, and so the check, but never those writes.
 */
async function verify(book: StepBook, provider: Provider, p: Row, ctx: RunContext, createdAt: string) {
  const t = await readTask(provider, String(p.taskId), true);
  if (!t) throw halt("skipped", ACTION_SAY.gone);
  const progress = book.progress;
  const st = book.get("verify");
  const moved = String(t.list?.id ?? "") !== String(p.listId) || String(t.name ?? "") !== String(p.taskName);
  const where = `ClickUp shows it on ${listName(t)} as "${String(t.name ?? "")}".`;
  const owner = p.ownerClickupId === null || p.ownerClickupId === undefined ? null : Number(p.ownerClickupId);
  const ownerOff = owner !== null && !hasUser(t.assignees, owner);
  const sawMove = Boolean(st?.movedAt);
  const movedRt = moved && p.setRequestType === true;
  const created = Date.parse(createdAt);
  const madeMs = stampMs(p.madeAt) ?? created;
  const ownerMs = stampMs(p.ownerAt) ?? stampMs(p.madeAt) ?? created;
  const lateFrom = (ms: number) => ctx.now() - (ms + VERIFY_DUE_MS) > VERIFY_LATE_MS;
  // A move with Request Type on is judged by when Request Type was written (it puts nobody back); otherwise a
  // missing owner by when the owner was written.
  const late = !sawMove && !st?.putBack && (movedRt ? lateFrom(madeMs) : ownerOff && lateFrom(ownerMs));
  if (late) {
    const note = ACTION_SAY.late([movedRt ? where : "", ownerOff ? ACTION_SAY.ownerOff : ""].filter(Boolean).join(" "));
    delete progress.verify;
    progress.verifyNote = note;
    await book.set("verify", "skipped", { late: true });
    throw halt("skipped", note);
  }
  if (sawMove || movedRt) {
    // Recorded before the call, so a retry of a failed rt_off finishes it even when it runs late.
    if (!sawMove) await book.set("verify", "started", { movedAt: new Date(ctx.now()).toISOString() });
    try {
      await requestsDb(ctx.rpc).rtOff(String(p.typeKey), RT_OFF_NOTE(String(p.taskName)));
    } catch {
      // Nothing was written to ClickUp: the check runs again on the ladder.
      throw halt("retry", ACTION_SAY.rtOffLater);
    }
    // Parts of this type later in this run leave Request Type empty (requests.ts stepRequestType reads
    // the type again before writing it, so parts in later runs do too). Parts delivered inside these two
    // minutes each have their own check, which finds its own move.
    ctx.requestTypeTurnedOff(String(p.typeKey));
    progress.verify = "moved";
    progress.verifyNote = where;
    return book.set("verify", "done", { rtOff: true });
  }
  const notes: string[] = moved ? [where] : [];
  const others = (assignees: unknown) => (Array.isArray(assignees) ? assignees : []).some((u: Row) => owner === null || String(u?.id) !== String(owner));
  if (owner === null || !ownerOff) {
    if (owner !== null && others(t.assignees)) notes.push(ACTION_SAY.alsoAdded);
    // An owner this check put back on an earlier attempt (its answer was lost) was restored, not kept.
    progress.verify = book.get("verify")?.putBack ? "restored" : "kept";
    progress.verifyNote = notes.length ? notes.join(" ") : undefined;
    if (!progress.verifyNote) delete progress.verifyNote;
    return book.set("verify", "done");
  }
  // Missing: put the owner back once, then read again.
  if (!book.get("verify")?.putBack) {
    await book.start("verify", { putBack: true });
    await book.write(() => provider.call("clickup", "PUT", `task/${p.taskId}`, { assignees: { add: [owner], rem: [] } }));
  }
  const after = await readTask(provider, String(p.taskId), true);
  if (!after) throw halt("skipped", ACTION_SAY.gone);
  const list = TARGET_LISTS[String(p.listId)] ?? listName(after);
  if (!hasUser(after.assignees, owner)) {
    progress.verify = "removed";
    delete progress.verifyNote;
    await book.set("verify", "done", { putBack: true });
    throw halt("failed", ACTION_SAY.removed(list));
  }
  if (others(after.assignees)) notes.push(ACTION_SAY.alsoAdded);
  progress.verify = "restored";
  progress.verifyNote = notes.length ? notes.join(" ") : undefined;
  if (!progress.verifyNote) delete progress.verifyNote;
  return book.set("verify", "done", { putBack: true });
}

/** Whether a press that started on an earlier attempt already shows in ClickUp; settles it when it does. */
async function landed(book: StepBook, provider: Provider, p: Row, t: Row, createdAt: string): Promise<boolean> {
  const op = String(p.op);
  if (op === "tick" || op === "untick") {
    const checklist = (Array.isArray(t.checklists) ? t.checklists : []).find((c: Row) => String(c.id) === String(p.checklistId));
    const item = flat(checklist?.items).find(i => String(i.id) === String(p.itemId));
    if (!item || Boolean(item.resolved) !== (p.to === true)) return false;
  } else if (op === "comment") {
    const found = await findComment(provider, String(p.taskId), `Cockpit ref ${p.ref}`, book.startedAt("comment", createdAt) - 60_000);
    if (!found) return false;
    await book.set(op, "done", { commentId: String(found.id) });
    return true;
  } else if (op === "done") {
    if (String(t.status?.type ?? "").toLowerCase() !== "done") return false;
  } else return false;
  await book.set(op, "done");
  return true;
}

/** Carry out one task action. `save` persists the progress before and after every write. */
export async function executeTaskAction(item: RequestsItem, provider: Provider, save: Save, ctx: RunContext): Promise<RequestOutcome> {
  const p = item.payload ?? {};
  const book = new StepBook(structuredClone(item.progress ?? {}), save, ctx.now);
  const problem = actionProblem(p);
  if (problem) return { state: "failed", progress: book.progress, error: problem };
  const op = String(p.op);
  if (book.settled(op)) {
    // Settled on an earlier attempt whose last save did not land: report the same outcome again.
    if (op === "verify" && book.progress.verify === "removed")
      return { state: "failed", progress: book.progress, error: ACTION_SAY.removed(TARGET_LISTS[String(p.listId)] ?? "this list"), taskId: String(p.taskId) };
    if (op === "verify" && book.get(op)?.late) return { state: "skipped", progress: book.progress, error: book.progress.verifyNote, taskId: String(p.taskId) };
    return { state: "delivered", progress: book.progress, note: op === "verify" ? book.progress.verifyNote : undefined, taskId: String(p.taskId) };
  }
  try {
    if (op === "verify") {
      await verify(book, provider, p, ctx, item.created_at);
      return { state: "delivered", progress: book.progress, note: book.progress.verifyNote, taskId: String(p.taskId) };
    }
    const t = await readTask(provider, String(p.taskId), true);
    if (!t) throw halt("skipped", ACTION_SAY.gone);
    // A write that started on an earlier attempt may have landed: read it back first, so a person
    // taken off the task since then never turns a delivered press into a skipped one.
    if (book.get(op)?.state === "started" && (await landed(book, provider, p, t, item.created_at)))
      return { state: "delivered", progress: book.progress, taskId: String(p.taskId) };
    const refused = preconditionProblem(p, t);
    if (refused) throw halt("skipped", refused);
    if (op === "tick" || op === "untick") await tick(book, provider, p, t);
    else if (op === "comment") await comment(book, provider, p, item.created_at);
    else await markDone(book, provider, p, t, ctx);
    return { state: "delivered", progress: book.progress, taskId: String(p.taskId) };
  } catch (e) {
    return { ...outcomeOf(e, book, op), taskId: String(p.taskId) };
  }
}
