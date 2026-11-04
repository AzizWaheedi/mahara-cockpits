/**
 * Your tasks, the alerts bell and the focus view: the shapes the database
 * returns and the words the screens say (docs/requests/CONTRACT.md 3.3, 6.6).
 *
 * The same file sits in all five cockpits, byte for byte, and imports
 * nothing (scripts/check-shared.sh), so the rules for "late", "today" and the
 * sentences read the same in every cockpit and in the tests.
 *
 * Kuwait has no daylight saving: its day is UTC plus three hours, always.
 */

export type TaskPriority = "urgent" | "high" | "normal" | "low";

/** One open ClickUp task assigned to the seat (cockpit_my_tasks). */
export type TaskRow = {
  taskId: string;
  title: string;
  clientName: string | null;
  clientTaskId: string | null;
  listId: string;
  listName: string | null;
  status: string;
  statusType: string;
  /** The Kuwait day it is due, YYYY-MM-DD. */
  dueOn: string | null;
  dueAt: string | null;
  /** Null until the focus view has read the task once. */
  dueHasTime: boolean | null;
  overdue: boolean;
  dueToday: boolean;
  priority: TaskPriority | null;
  url: string;
  createdAt: string;
  parentId: string | null;
  checklist: { done: number; total: number } | null;
  requestId: string | null;
  requestTypeLabel: string | null;
};

export type TaskLink = "linked" | "not_linked";
/**
 * The seat's link row as the database holds it (review round 3): "cleared" is
 * an editor saying the seat has no ClickUp user, so nobody is asked to link
 * it; null when the hourly read has not checked the seat yet.
 */
export type TaskLinkState =
  | "ok"
  | "manual"
  | "not_found"
  | "ambiguous"
  | "cleared";

export type MyTasks = {
  asOf: string;
  /** When the task mirror last read ClickUp. */
  sourceAt: string | null;
  /** The mirror read ClickUp in the last ten minutes. */
  ready: boolean;
  link: TaskLink;
  linkState?: TaskLinkState | null;
  note: string | null;
  counts: { overdue: number; today: number; total: number };
  tasks: TaskRow[];
  /** Open tasks past the 200 returned. */
  more: number;
};

export type AlertKind =
  | "assigned"
  | "due_today"
  | "overdue"
  | "comment"
  | "mention"
  | "status"
  | "request_done"
  | "request_failed";

export const ALERT_KINDS: AlertKind[] = [
  "assigned",
  "due_today",
  "overdue",
  "comment",
  "mention",
  "status",
  "request_done",
  "request_failed",
];

export type AlertRow = {
  id: string;
  kind: AlertKind;
  taskId: string | null;
  requestId: string | null;
  title: string;
  body: string;
  clientName: string | null;
  at: string;
  read: boolean;
};

export type TaskAlerts = {
  asOf: string;
  sourceAt: string | null;
  ready: boolean;
  link: TaskLink;
  linkState?: TaskLinkState | null;
  note: string | null;
  unread: number;
  alerts: AlertRow[];
};

export type TaskOp = "tick" | "untick" | "comment" | "done";

/** A tick, comment or Mark done on its way through the writeback queue. */
export type TaskActionRow = {
  id: string;
  op: TaskOp | "verify";
  /** The queue's states: queued, sending, retry, unknown, delivered, dry_run, skipped, failed. */
  state: string;
  error: string | null;
  at: string;
  itemId: string | null;
};

export type ChecklistItem = { id: string; name: string; resolved: boolean };
export type Checklist = { id: string; name: string; items: ChecklistItem[] };

export type TaskComment = {
  id: string;
  authorLabel: string;
  mine: boolean;
  at: string;
  text: string;
};

export type TaskDetail = {
  asOf: string;
  task: TaskRow & { description: string | null };
  request: {
    id: string;
    typeLabel: string;
    requesterLabel: string;
    part: string;
  } | null;
  /** The request type's SOP link, when the task came from a request. */
  sopUrl: string | null;
  detail: {
    at: string;
    dueHasTime: boolean | null;
    description: string | null;
    checklists: Checklist[];
    subtasks: {
      id: string;
      name: string;
      status: string;
      statusType: string;
    }[];
    comments: TaskComment[];
  } | null;
  /** The sentence when the last live read of ClickUp failed. */
  detailNote: string | null;
  actions: TaskActionRow[];
  can: { tick: boolean; comment: boolean; done: boolean; why: string | null };
  writer: { mode: string; live: boolean };
};

/** The words of 6.6, used exactly. */
export const TASK_SENTENCES = {
  notLinked:
    "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.",
  /** A seat an editor cleared (linkState "cleared", review round 3): no link to ask for. */
  cleared:
    "Your seat has no ClickUp user, so no ClickUp tasks show here. Requests you raise show under My requests.",
  bellCleared:
    "Your seat has no ClickUp user, so only request alerts show here.",
  linkIt: "Link it in Requests settings",
  notRead:
    "Your tasks could not be read just now. They are still in ClickUp. Try again in a minute.",
  staleBefore: "Task updates are late. Last read at ",
  staleAfter: ". Open ClickUp for anything urgent.",
  /**
   * No open task for this seat in this cockpit. Every cockpit leaves the
   * client cards out (cockpit_task_hidden), so the sentence says so rather
   * than claim nothing is assigned in ClickUp; see emptySentence().
   */
  empty:
    "Nothing open is assigned to you outside the client cards. New ClickUp tasks show here within two minutes.",
  emptyEditor:
    "Nothing open is assigned to you outside Jobs and the client cards. New ClickUp tasks show here within two minutes.",
  bellEmpty: "No alerts in the last 14 days.",
  bellNotRead: "Alerts could not refresh. Try again.",
  bellChecked: "Checked every 2 minutes while this cockpit is open.",
  readNotSaved: "Read status could not save. Try again.",
  opening: "Opening…",
  saving: "Saving…",
  saved: "Saved",
  waiting: "Waiting for ClickUp to confirm.",
  testRun: "Not in ClickUp: the writer is in its test run.",
  markDone: "Mark done",
  done: "Done",
  notOpened: "This task could not be opened. Open it in ClickUp.",
  notSent: "That change could not be sent. Try again.",
} as const;

/**
 * The empty card's sentence for a cockpit. The server leaves lists out by
 * cockpit (the client cards everywhere, Video Pipeline in the editor, whose
 * Jobs page owns it), so the sentence names what is left out: an empty
 * card is never told "nothing is assigned to you in ClickUp".
 */
export function emptySentence(cockpit: string): string {
  return cockpit === "editor"
    ? TASK_SENTENCES.emptyEditor
    : TASK_SENTENCES.empty;
}

/**
 * When an alert came, short: "Just now", "12 min ago", "3 h ago",
 * "Yesterday 14:02", "Sun 25 Oct 09:10" (Kuwait time). "" for no time.
 */
export function agoWords(at: string | null | undefined, nowMs: number): string {
  const ms = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(ms)) return "";
  const mins = Math.floor((nowMs - ms) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const day = kuwaitDay(ms);
  const today = kuwaitDay(nowMs);
  if (day === today) return `${Math.floor(mins / 60)} h ago`;
  if (dayNumber(today) - dayNumber(day) === 1)
    return `Yesterday ${kuwaitTime(ms)}`;
  return `${dayWords(day, true)} ${kuwaitTime(ms)}`;
}

/** "Task updates are late. Last read at 14:02. Open ClickUp for anything urgent." */
export function staleSentence(time: string): string {
  return `${TASK_SENTENCES.staleBefore}${time}${TASK_SENTENCES.staleAfter}`;
}

const KUWAIT_MS = 3 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The Kuwait day of an instant, YYYY-MM-DD. */
export function kuwaitDay(ms: number): string {
  return new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);
}

/** The Kuwait clock time of an instant, HH:MM. */
export function kuwaitTime(ms: number): string {
  return new Date(ms + KUWAIT_MS).toISOString().slice(11, 16);
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** "Thu" or "Thu 6 Nov" for a Kuwait day. */
export function dayWords(day: string, withDate: boolean): string {
  const d = new Date(`${day}T00:00:00Z`);
  const name = WEEKDAY[d.getUTCDay()];
  return withDate
    ? `${name} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`
    : name;
}

export type DueTone = "late" | "today" | "none";

/**
 * The due word on a row: "3 days late", "1 day late", "Late, was 14:00",
 * "Today", "Today 15:00", "Thu", "Thu 6 Nov", or "" with no due date. The
 * tone colours the spine, never the words.
 */
export function dueWords(
  row: Pick<TaskRow, "dueOn" | "dueAt" | "dueHasTime">,
  nowMs: number,
): { text: string; tone: DueTone } {
  const atMs = row.dueAt ? Date.parse(row.dueAt) : Number.NaN;
  const day = row.dueOn ?? (Number.isFinite(atMs) ? kuwaitDay(atMs) : null);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    return { text: "", tone: "none" };
  const diff = dayNumber(day) - dayNumber(kuwaitDay(nowMs));
  const timed = row.dueHasTime === true && Number.isFinite(atMs);
  if (diff < 0) {
    const n = -diff;
    return { text: `${n} ${n === 1 ? "day" : "days"} late`, tone: "late" };
  }
  if (diff === 0) {
    if (!timed) return { text: "Today", tone: "today" };
    return atMs < nowMs
      ? { text: `Late, was ${kuwaitTime(atMs)}`, tone: "late" }
      : { text: `Today ${kuwaitTime(atMs)}`, tone: "today" };
  }
  // Within the week a weekday is enough; beyond it, the date too.
  return { text: dayWords(day, diff > 6), tone: "none" };
}

/** The first five rows, in the server's order (overdue, today, newest). */
export function firstFive<T>(tasks: readonly T[]): T[] {
  return tasks.slice(0, 5);
}

/** What each alert kind means, in the words the alert settings use. */
export function alertWords(kind: AlertKind): string {
  switch (kind) {
    case "assigned":
      return "A task is assigned to you";
    case "due_today":
      return "Tasks are due today";
    case "overdue":
      return "A task is late";
    case "comment":
      return "Someone comments on your task";
    case "mention":
      return "Someone mentions you in a comment";
    case "status":
      // ClickUp names nobody as the mover, so a seat's own move in ClickUp
      // alerts it too (contract 3.2, F9): never "someone".
      return "Your task moves";
    case "request_done":
      return "Your request is done";
    case "request_failed":
      return "A failed request";
  }
}

/**
 * A bell row's second line: the body, then the client, unless the title
 * already names it (a request alert's title is "{type}: {client}"), so the
 * client is said once. When the client follows, the body's closing full
 * stop goes, so the line never reads "Done in ClickUp. · Acme".
 */
export function alertLine(alert: {
  title: string;
  body: string;
  clientName?: string | null;
}): { body: string; client: string | null } {
  const client = alert.clientName?.trim() || null;
  const named =
    client !== null &&
    (alert.title ?? "")
      .toLocaleLowerCase()
      .includes(client.toLocaleLowerCase());
  if (!client || named) return { body: alert.body, client: null };
  return { body: alert.body.replace(/\.\s*$/, ""), client };
}

/** A request alert opens the request; every other alert opens its task. */
export function alertOpens(
  alert: Pick<AlertRow, "kind" | "taskId" | "requestId">,
): "request" | "task" | "list" {
  if (
    (alert.kind === "request_done" || alert.kind === "request_failed") &&
    alert.requestId
  )
    return "request";
  return alert.taskId ? "task" : "list";
}

export type StatusTone = "open" | "active" | "done" | "closed";

/** ClickUp's status type to the dot on a status chip. */
export function statusTone(statusType: string): StatusTone {
  if (statusType === "done") return "done";
  if (statusType === "closed") return "closed";
  if (statusType === "open") return "open";
  return "active";
}

/** A ClickUp task id as the address may carry it (?focus=). */
export function isTaskId(value: string | null | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]{1,40}$/.test(value);
}

/**
 * A comment or description without the writer's marker line ("Cockpit ref
 * R-1a2b3c4d5e-tech", "Cockpit ref T-…"): it is for the read-back, not for
 * people.
 */
export function withoutMarker(text: string): string {
  return text
    .replace(/(?:\r?\n)*\s*Cockpit ref [RT]-[0-9a-f]{10}[\w-]*\s*$/i, "")
    .trimEnd();
}

/** "the CSM" as the first word of a line: "The CSM". */
export function capitalFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "3 of 8 done" for one checklist. */
export function checklistWords(
  items: readonly { resolved: boolean }[],
): string {
  return `${items.filter(i => i.resolved).length} of ${items.length} done`;
}

/** The latest queue row for one action, by the id the act call answered. */
export function actionState(
  actions: readonly TaskActionRow[],
  ids: readonly string[],
): TaskActionRow | null {
  return actions.find(a => ids.includes(a.id)) ?? null;
}

/** Where an action stands for the control that sent it. */
export type ActionPhase =
  | { phase: "saving" }
  | { phase: "saved" }
  | { phase: "waiting" }
  | { phase: "error"; message: string };

/** The queue state of an action row as the control's words. */
export function actionPhase(row: TaskActionRow | null): ActionPhase {
  if (!row) return { phase: "saving" };
  if (row.state === "delivered") return { phase: "saved" };
  if (row.state === "dry_run")
    return { phase: "error", message: TASK_SENTENCES.testRun };
  if (row.state === "skipped" || row.state === "failed")
    return {
      phase: "error",
      message: row.error?.trim() || TASK_SENTENCES.notSent,
    };
  return { phase: "saving" };
}
