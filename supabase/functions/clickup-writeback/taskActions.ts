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
  boards: "Ticking and Mark done work on the team request boards. Open this one in ClickUp.",
  clientCard: "This is a client card. Open it in ClickUp.",
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
} as const;

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
  return null;
}

/** The task is on a list where this op works, and the person may still act on it. */
function preconditionProblem(p: Row, t: Row): string | null {
  const list = String(t.list?.id ?? "");
  if (p.op === "comment") {
    if (list === CLIENT_CARDS) return ACTION_SAY.clientCard;
  } else if (!ACTION_LISTS[list]) return ACTION_SAY.boards;
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
 */
async function verify(book: StepBook, provider: Provider, p: Row, ctx: RunContext) {
  const t = await readTask(provider, String(p.taskId), true);
  if (!t) throw halt("skipped", ACTION_SAY.gone);
  const progress = book.progress;
  const moved = String(t.list?.id ?? "") !== String(p.listId) || String(t.name ?? "") !== String(p.taskName);
  const where = `ClickUp shows it on ${listName(t)} as "${String(t.name ?? "")}".`;
  if (moved && p.setRequestType === true) {
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
  const owner = p.ownerClickupId === null || p.ownerClickupId === undefined ? null : Number(p.ownerClickupId);
  const notes: string[] = moved ? [where] : [];
  const others = (assignees: unknown) => (Array.isArray(assignees) ? assignees : []).some((u: Row) => owner === null || String(u?.id) !== String(owner));
  if (owner === null || hasUser(t.assignees, owner)) {
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
    return { state: "delivered", progress: book.progress, note: op === "verify" ? book.progress.verifyNote : undefined, taskId: String(p.taskId) };
  }
  try {
    if (op === "verify") {
      await verify(book, provider, p, ctx);
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
