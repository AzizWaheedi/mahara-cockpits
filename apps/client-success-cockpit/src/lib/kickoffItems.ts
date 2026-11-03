/**
 * Kickoff items as requests (CEO item 7; WAVE56-CONTRACT.md 4.20 and 5.16;
 * kickoff-requests.md 5): the shapes the five browser RPCs answer, read
 * leniently, and every sentence the screens say. Pure: no React, no I/O.
 *
 * Each open kickoff item that maps to a request type is one question with
 * equal Yes and No pills. Yes raises it through cockpit_request_submit on
 * the server; No is recorded. The server decides what may be done
 * (`actions`); this file only says it.
 */

export type ItemState =
  | "open"
  | "already_open"
  | "type_off"
  | "raised"
  | "declined"
  | "reopened";

export type ItemRoute = {
  teamLabel: string | null;
  ownerLabel: string | null;
  ownerNote: string | null;
  dueDefault: string | null;
  dueWords: string | null;
  priority: string | null;
  writer: { canSend: boolean; held: boolean; note: string | null } | null;
  /** The preview refused: its sentence. */
  note: string | null;
};

export type ItemDecision = {
  answer: "raised" | "declined";
  how: "one_tap" | "form" | "linked" | null;
  typeKey: string | null;
  byLabel: string | null;
  at: string | null;
  note: string | null;
  mine: boolean;
};

export type ItemRequest = {
  id: string | null;
  state: string;
  done: boolean;
  typeLabel: string | null;
  dueOn: string | null;
  priority: string | null;
  held: boolean;
  heldNote: string | null;
  url: string | null;
  partState: string | null;
  mayOpen: boolean;
  raisedBy: string | null;
};

export type ItemExisting = {
  requestId: string;
  typeLabel: string | null;
  createdAt: string | null;
  requesterLabel: string | null;
  imported: boolean;
  mayOpen: boolean;
};

export type ItemRow = {
  item: string;
  short: string;
  line: string;
  value: string | null;
  typeKey: string;
  typeLabel: string;
  typeEnabled: boolean;
  oneTap: boolean;
  details: string | null;
  priority: string | null;
  state: ItemState;
  offered: boolean;
  stillOpen: boolean;
  blocked: string | null;
  actions: { raise: boolean; decline: boolean; link: boolean };
  route: ItemRoute | null;
  decision: ItemDecision | null;
  request: ItemRequest | null;
  existing: ItemExisting | null;
};

export type ItemsRead = {
  asOf: string | null;
  taskId: string;
  kickoff: {
    at: string | null;
    day: string | null;
    answered: boolean;
    inOnboarding: boolean;
  } | null;
  inWindow: boolean;
  reason: "no_kickoff" | "no_answers" | "closed" | "none" | null;
  note: string | null;
  items: ItemRow[];
};

export type DueRow = {
  taskId: string;
  clientName: string;
  kickoffAt: string | null;
  kickoffDay: string | null;
  due: number;
  items: ItemRow[];
};

export type DueRead = {
  asOf: string | null;
  rows: DueRow[];
  more: boolean;
  note: string | null;
};

// --- Reading (lenient: a key the server does not send stays empty) -----------

type Any = Record<string, unknown>;
const obj = (v: unknown): Any | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Any) : null;
const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const yes = (v: unknown) => v === true;
const STATES: ItemState[] = [
  "open",
  "already_open",
  "type_off",
  "raised",
  "declined",
  "reopened",
];

function readRoute(v: unknown): ItemRoute | null {
  const r = obj(v);
  if (!r) return null;
  const w = obj(r.writer);
  return {
    teamLabel: txt(r.teamLabel),
    ownerLabel: txt(r.ownerLabel),
    ownerNote: txt(r.ownerNote),
    dueDefault: txt(r.dueDefault),
    dueWords: txt(r.dueWords),
    priority: txt(r.priority),
    writer: w
      ? { canSend: yes(w.canSend), held: yes(w.held), note: txt(w.note) }
      : null,
    note: txt(r.note),
  };
}

function readDecision(v: unknown): ItemDecision | null {
  const d = obj(v);
  if (!d || (d.answer !== "raised" && d.answer !== "declined")) return null;
  const how = d.how;
  return {
    answer: d.answer,
    how: how === "one_tap" || how === "form" || how === "linked" ? how : null,
    typeKey: txt(d.typeKey),
    byLabel: txt(d.byLabel),
    at: txt(d.at),
    note: txt(d.note),
    mine: yes(d.mine),
  };
}

function readRequest(v: unknown): ItemRequest | null {
  const r = obj(v);
  if (!r) return null;
  return {
    id: txt(r.id),
    state: txt(r.state) ?? "unknown",
    done: yes(r.done),
    typeLabel: txt(r.typeLabel),
    dueOn: txt(r.dueOn),
    priority: txt(r.priority),
    held: yes(r.held),
    heldNote: txt(r.heldNote),
    url: txt(r.url),
    partState: txt(r.partState),
    mayOpen: yes(r.mayOpen),
    raisedBy: txt(r.raisedBy),
  };
}

function readExisting(v: unknown): ItemExisting | null {
  const e = obj(v);
  const id = e ? txt(e.requestId) : null;
  if (!e || !id) return null;
  return {
    requestId: id,
    typeLabel: txt(e.typeLabel),
    createdAt: txt(e.createdAt),
    requesterLabel: txt(e.requesterLabel),
    imported: yes(e.imported),
    mayOpen: yes(e.mayOpen),
  };
}

/** One ItemRow, or null when it has no item key or a state this screen does not know. */
export function readItemRow(v: unknown): ItemRow | null {
  const r = obj(v);
  const item = r ? txt(r.item) : null;
  const state = r?.state as ItemState;
  if (!r || !item || !STATES.includes(state)) return null;
  const a = obj(r.actions) ?? {};
  const typeKey = txt(r.typeKey) ?? "";
  return {
    item,
    short: txt(r.short) ?? item,
    line: txt(r.line) ?? "",
    value: txt(r.value),
    typeKey,
    typeLabel: txt(r.typeLabel) ?? typeKey,
    typeEnabled: yes(r.typeEnabled),
    oneTap: yes(r.oneTap),
    details: txt(r.details),
    priority: txt(r.priority),
    state,
    offered: yes(r.offered),
    stillOpen: yes(r.stillOpen),
    blocked: txt(r.blocked),
    actions: {
      raise: yes(a.raise),
      decline: yes(a.decline),
      link: yes(a.link),
    },
    route: readRoute(r.route),
    decision: readDecision(r.decision),
    request: readRequest(r.request),
    existing: readExisting(r.existing),
  };
}

const rowsOf = (v: unknown): ItemRow[] =>
  Array.isArray(v)
    ? v.map(readItemRow).filter((x): x is ItemRow => x !== null)
    : [];

/** cockpit_kickoff_items_read's answer. */
export function readItems(v: unknown, taskId: string): ItemsRead {
  const r = obj(v) ?? {};
  const k = obj(r.kickoff);
  const reason = r.reason;
  return {
    asOf: txt(r.asOf),
    taskId: txt(r.taskId) ?? taskId,
    kickoff: k
      ? {
          at: txt(k.at),
          day: txt(k.day),
          answered: yes(k.answered),
          inOnboarding: yes(k.inOnboarding),
        }
      : null,
    inWindow: yes(r.inWindow),
    reason:
      reason === "no_kickoff" ||
      reason === "no_answers" ||
      reason === "closed" ||
      reason === "none"
        ? reason
        : null,
    note: txt(r.note),
    items: rowsOf(r.items),
  };
}

/** cockpit_kickoff_items_due's answer (Today). */
export function readDue(v: unknown): DueRead {
  const r = obj(v) ?? {};
  const rows: DueRow[] = (Array.isArray(r.rows) ? r.rows : [])
    .map(x => {
      const o = obj(x);
      const taskId = o ? txt(o.taskId) : null;
      if (!o || !taskId) return null;
      return {
        taskId,
        clientName: txt(o.clientName) ?? "This client",
        kickoffAt: txt(o.kickoffAt),
        kickoffDay: txt(o.kickoffDay),
        due: typeof o.due === "number" ? o.due : 0,
        items: rowsOf(o.items),
      };
    })
    .filter((x): x is DueRow => x !== null);
  return { asOf: txt(r.asOf), rows, more: yes(r.more), note: txt(r.note) };
}

// --- Words (kickoff-requests.md 5; 4.20) --------------------------------------

/** The screens' line while the five functions are not on the database (PGRST202). */
export const ITEMS_MISSING =
  "Kickoff items open after the next cockpit update.";
/** The page's line when the kickoff's answers are not stored (4.20 `no_answers`). */
export const NO_ANSWERS =
  "The kickoff's answers are not in the cockpit, so its open items cannot show here. They are in the card's Kickoff Handoff comment.";
/** After 60 seconds of re-reading a request that is still on its way. */
export const STILL_ON_ITS_WAY = "Still on its way. It shows in My requests.";

/** The kicker over the list: "Still open from the kickoff · 3". */
export const kickerWords = (n: number) => `Still open from the kickoff · ${n}`;

/** The ask: "Raise Card missing for ads?". */
export const askWords = (r: ItemRow) => `Raise ${r.typeLabel}?`;
export const yesLabel = (r: ItemRow, client: string) =>
  `Yes, raise ${r.typeLabel} for ${client}`;
export const NO_LABEL = "No, do not raise it";

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
const KUWAIT_MS = 3 * 3600_000;

/** "Tue 4 Nov" for a day or a timestamp, in Kuwait; empty when it is not a date. */
export function dayWords(v: string | null | undefined): string {
  if (!v) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  const ms = iso
    ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3])
    : Date.parse(v) + KUWAIT_MS;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** "10:42" in Kuwait; empty for a bare day or a value that is not a time. */
export function timeWords(v: string | null | undefined): string {
  if (!v || /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return "";
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + KUWAIT_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** A priority worth saying (anything but normal), in lower case. */
const priorityWords = (p: string | null | undefined) =>
  p && p.toLowerCase() !== "normal" ? p.toLowerCase() : null;

/**
 * Where a Yes would go, from the server's preview: "Client Success · the CSM
 * · due Tue 4 Nov · high". The screen sets it in mono capitals. Null when the
 * preview gave nothing; the preview's own refusal is said instead.
 */
export function routeLine(route: ItemRoute | null): string | null {
  if (!route) return null;
  if (route.note && !route.teamLabel) return route.note;
  const parts = [
    route.teamLabel,
    route.ownerLabel,
    route.dueWords
      ? `due ${route.dueWords}`
      : route.dueDefault
        ? `due ${dayWords(route.dueDefault)}`
        : null,
    priorityWords(route.priority),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "You" or the role, at the start of a sentence. */
function who(d: ItemDecision | null): string {
  if (!d || d.mine) return "You";
  const r = d.byLabel ?? "a team member";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** A raised item's request in words: where it stands in ClickUp. */
export function requestWords(r: ItemRequest | null): {
  text: string;
  tone: "good" | "warning" | "critical" | "neutral";
  url: string | null;
} {
  if (!r) return { text: "Sending to ClickUp", tone: "warning", url: null };
  if (!r.mayOpen)
    return {
      text: `Raised by ${r.raisedBy ?? "a team member"}.`,
      tone: "neutral",
      url: null,
    };
  if (r.state === "failed")
    return {
      text: "Did not reach ClickUp. Raise it again.",
      tone: "critical",
      url: null,
    };
  if (r.state === "cancelled")
    return {
      text: "The request was cancelled. Raise it again if it is still needed.",
      tone: "neutral",
      url: null,
    };
  if (r.held)
    return {
      text:
        r.heldNote ??
        "Saved, not sent yet. It goes to ClickUp once requests open.",
      tone: "warning",
      url: null,
    };
  if (r.done) return { text: "Done in ClickUp", tone: "good", url: r.url };
  if (r.url || r.state === "delivered" || r.partState === "delivered")
    return { text: "In ClickUp", tone: "good", url: r.url };
  return { text: "Sending to ClickUp", tone: "warning", url: null };
}

/** True while a raised request may still change on its own (the row re-reads it). */
export function stillSending(r: ItemRow): boolean {
  const q = r.request;
  if (r.state !== "raised" || !q || !q.mayOpen || q.held || q.done)
    return false;
  if (q.state === "failed" || q.state === "cancelled") return false;
  return !(q.url || q.state === "delivered" || q.partState === "delivered");
}

/**
 * The receipt of a decided item: the head ("Raised: Card missing for ads",
 * "Counted: …", "Not raised. You said No on Tue 4 Nov at 10:42.") and the
 * line under it. Null for an item still to decide.
 */
export function receiptWords(r: ItemRow): {
  head: string;
  sub: string | null;
} | null {
  const d = r.decision;
  if (r.state === "declined" && d) {
    const at = [dayWords(d.at), timeWords(d.at)].filter(Boolean);
    return {
      head: `Not raised. ${who(d)} said No${at.length ? ` on ${at[0]}${at[1] ? ` at ${at[1]}` : ""}` : ""}.`,
      sub: d.note,
    };
  }
  if ((r.state === "raised" || r.state === "reopened") && d) {
    const label = r.request?.typeLabel ?? r.typeLabel;
    const head =
      d.how === "linked"
        ? `Counted: ${label}`
        : d.how === "form"
          ? `Raised with the form: ${label}`
          : `Raised: ${label}`;
    const q = r.request;
    const sub = [
      q?.dueOn ? `due ${dayWords(q.dueOn)}` : null,
      priorityWords(q?.priority),
      d.mine ? "by you" : d.byLabel ? `by ${d.byLabel}` : null,
      [dayWords(d.at), timeWords(d.at)].filter(Boolean).join(" ") || null,
    ].filter(Boolean);
    return { head, sub: sub.length ? sub.join(" · ") : null };
  }
  return null;
}

/** "A General tech request request is already open…" reads badly: the label carries "request" itself when it ends so. */
const requestNoun = (label: string) =>
  /\brequest$/i.test(label) ? label : `${label} request`;

/** An open request of the item's type is already on the card. */
export function existingWords(r: ItemRow): string | null {
  const e = r.existing;
  if (!e) return null;
  const day = dayWords(e.createdAt);
  return `A ${requestNoun(e.typeLabel ?? r.typeLabel)} is already open for this client, raised ${day || "earlier"} by ${e.requesterLabel ?? "a team member"}.`;
}

/** The type is turned off in Requests settings: no pills. */
export const typeOffWords = (r: ItemRow) =>
  `${r.typeLabel} is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.`;

/** The type asks more than the kickoff has: only the form raises it. */
export const formOnlyWords = (r: ItemRow) =>
  `${r.typeLabel} needs answers the kickoff does not have.`;

/** Toasts, by what was pressed (the verb of the button, as said back). */
export const TOAST = {
  raised: (r: ItemRow) => `Raised: ${r.request?.typeLabel ?? r.typeLabel}.`,
  declined: "Saved: not raised.",
  counted: (r: ItemRow) => `Counted: ${r.request?.typeLabel ?? r.typeLabel}.`,
} as const;

/** The ring's tone and its mark for an item (the trail's StatusChip tones). */
export function itemTone(r: ItemRow): {
  tone: "good" | "warning" | "critical" | "neutral";
  mark: "check" | "dash" | "open" | "cross";
} {
  if (r.state === "raised") {
    const q = requestWords(r.request);
    return q.tone === "critical"
      ? { tone: "critical", mark: "cross" }
      : { tone: "good", mark: "check" };
  }
  if (r.state === "declined") return { tone: "neutral", mark: "dash" };
  if (r.state === "type_off") return { tone: "neutral", mark: "dash" };
  return { tone: "warning", mark: "open" };
}

/** The items a list shows: every item to decide, then the decided ones as receipts. */
export function orderItems(rows: ItemRow[]): ItemRow[] {
  const decided = (r: ItemRow) =>
    r.state === "raised" || r.state === "declined";
  return [...rows.filter(r => !decided(r)), ...rows.filter(decided)];
}

/** How many items still wait for a decision (the kicker's count, Today's count). */
export const toDecide = (rows: ItemRow[]) => rows.filter(r => r.offered).length;

/** The ticket form's details for "Change it first": the server's fixed sentence, else the row's line. */
export const ticketDetails = (r: ItemRow) => r.details ?? r.line;
