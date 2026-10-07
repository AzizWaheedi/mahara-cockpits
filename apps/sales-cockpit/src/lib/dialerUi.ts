/**
 * The dialer page's small rules, kept apart so they can be tested: how long
 * a skip holds, what the queue's chips count, the countdown in a few words,
 * the line about leads the dialer cannot call, what can be sent to a lead
 * who did not answer, missed calls, what follows a save, the saves
 * HighLevel has not taken, and which open call a late read of the queue
 * may show.
 */

import {
  countdown,
  DIAL_WITHIN_MS,
  mmss,
  type QueueItem,
  type UrgentEvent,
  urgentEvents,
} from "./dialer";
import { ago, clock, dayLabel } from "./format";
import { OVERDUE_MS, roomDeadline } from "./roomClock";

/** A queue item as sales-api sends it, with the lead's last missed call to us. */
export interface DialItem extends QueueItem {
  /** Their latest call to us in the last day that nobody answered. */
  inbound_call_at?: string | null;
}

/** What a dialer item is: a lead to call, the intro call itself, or a confirmation. */
export type ItemKind = "lead" | "intro" | "confirm";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

const msOf = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/** "4m", "3h", "2d", or "in 20m" for a time ahead: short enough for a queue row. */
export function shortAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const m = Math.round((now - Date.parse(iso)) / MIN_MS);
  if (!Number.isFinite(m)) return "";
  if (m < 0) {
    const f = -m;
    return f < 60
      ? `in ${f}m`
      : f < 2880
        ? `in ${Math.round(f / 60)}h`
        : `in ${Math.round(f / 1440)}d`;
  }
  if (m < 60) return `${Math.max(m, 0)}m`;
  if (m < 2880) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

// ---------------------------------------------------------------------------
// Missed calls: the lead called us and nobody picked up
// ---------------------------------------------------------------------------

/**
 * When the lead called and nobody answered, if that was in the last 24
 * hours and nobody has called them since (sales-api's missedCall); else null.
 */
export function missedCallAt(i: DialItem, now: number): number | null {
  const t = msOf(i.inbound_call_at);
  if (t === null || now - t > DAY_MS) return null;
  const last = msOf(i.last_dial_at);
  if (last !== null && last >= t) return null;
  return t;
}

/** The banner on the lead, the call centre's: "Missed their call at 14:05. Call them back." */
export function missedCallLine(i: DialItem, now: number): string | null {
  const t = missedCallAt(i, now);
  if (t === null) return null;
  const iso = new Date(t).toISOString();
  const day = dayLabel(iso, now);
  const at = day === "Today" ? "" : `${day.toLowerCase()} `;
  return `Missed their call ${at}at ${clock(iso)}. Call them back.`;
}

/**
 * The "call now" strip, missed calls included. A lead who called us has the
 * same two minutes as a new lead, counted from their call when it is the
 * latest thing they did (urgentEvents alone counts from when they came in,
 * which made a call from a minute ago look hours late). A call-back due in
 * the next five minutes keeps its own countdown.
 */
export function urgentFor(items: DialItem[], now: number): UrgentEvent[] {
  const missed: UrgentEvent[] = [];
  const rest: DialItem[] = [];
  for (const i of items) {
    const t =
      i.tier === 0 && (i.kind ?? "lead") === "lead"
        ? missedCallAt(i, now)
        : null;
    const callback = msOf(i.callback_at);
    const later = Math.max(
      msOf(i.inbound_at) ?? Number.NEGATIVE_INFINITY,
      msOf(i.created_at) ?? Number.NEGATIVE_INFINITY,
    );
    if (
      t === null ||
      (callback !== null && callback <= now + 5 * MIN_MS) ||
      later > t
    ) {
      rest.push(i);
      continue;
    }
    missed.push({
      key: `${i.contact_id}:missed:${t}`,
      contact_id: i.contact_id,
      name: i.name,
      title: "Missed their call",
      at: t,
      deadline: t + DIAL_WITHIN_MS,
      callback: false,
    });
  }
  return [...urgentEvents(rest, now), ...missed].sort(
    (a, b) => a.deadline - b.deadline || a.key.localeCompare(b.key),
  );
}

/**
 * The time at the end of a queue row: the booked call's clock, a call-back's
 * agreed time when it is close, how long ago they called us, or how long
 * ago they wrote or came in.
 */
export function rowTime(i: DialItem, now: number): string {
  if (i.kind === "intro" || i.kind === "confirm")
    return clock(i.appointment?.start_at ?? null);
  const callback = msOf(i.callback_at);
  if (callback !== null && i.tier === 0 && callback <= now + 5 * MIN_MS)
    return clock(i.callback_at);
  const missed = missedCallAt(i, now);
  if (missed !== null) return shortAgo(new Date(missed).toISOString(), now);
  return shortAgo(i.inbound_at ?? i.created_at, now);
}

/** The line under "Ready to call": why, how many tries, when last called (said once). */
export function readyLine(i: DialItem, now: number): string {
  return [
    i.why,
    i.step
      ? `${i.step} unanswered ${i.step === 1 ? "try" : "tries"} so far`
      : null,
    i.last_dial_at
      ? `last called ${ago(i.last_dial_at, now)}`
      : /never called/i.test(i.why)
        ? null
        : "never called",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// After a save: the next lead at once, unless a next step was asked for
// ---------------------------------------------------------------------------

/**
 * What the screen does once an outcome is saved: the next lead opens at
 * once (the call centre's way), except after an intro was held (book the
 * demo or set a call-back first) or a no-answer the rep chose to message.
 */
export function afterSave(
  kind: ItemKind,
  outcome: string,
  thenMessage: boolean,
): "next" | "held" | "message" {
  if (kind === "intro" && outcome === "showed") return "held";
  if (outcome === "no_answer" && thenMessage) return "message";
  return "next";
}

/**
 * A message to the lead went since the missed call (the missed-call
 * message, from the step or the conversation box: the cockpit's own sends,
 * never a room's link): the step no longer offers a video link, whose words
 * open with "I tried to call you" again (m1 round 6,
 * m1-journeys-r6-missed-call-message-then-video-link-two-tried-to-call).
 * The lead page's Video call still makes one.
 */
export function messagedSinceMiss(
  sends:
    | readonly {
        source?: string | null;
        state?: string | null;
        channel?: string | null;
        created_at?: string | null;
      }[]
    | null
    | undefined,
  since: number | null,
): boolean {
  if (since === null || !sends?.length) return false;
  return sends.some(s => {
    if (s.source === "room" || String(s.state ?? "") === "failed") return false;
    if (!["whatsapp", "email", "sms"].includes(String(s.channel ?? "")))
      return false;
    const at = Date.parse(String(s.created_at ?? ""));
    return Number.isFinite(at) && at >= since;
  });
}

/** Alt+→ opens the next lead, but not inside a text box, where it moves the cursor by a word. */
export function isNextLeadKey(
  e: {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  typing: boolean,
): boolean {
  return (
    e.key === "ArrowRight" &&
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !typing
  );
}

// ---------------------------------------------------------------------------
// A late read of the queue and the call this page just placed
// ---------------------------------------------------------------------------

/**
 * The open call after a read of the queue: the read's own when it has one;
 * the call this page placed after the read was asked for, when the read
 * cannot know it yet (a slow read must never end a call on screen); else
 * none, because a read asked after the call that shows none means the
 * server has let it go.
 */
export function openAfterRead<A>(
  read: A | null,
  placed: { attempt: A; at: number } | null,
  askedAt: number,
): A | null {
  if (read) return read;
  if (placed && placed.at >= askedAt) return placed.attempt;
  return null;
}

// ---------------------------------------------------------------------------
// Saved work: saves stored in the cockpit that HighLevel has not taken
// ---------------------------------------------------------------------------

export interface SavedWork {
  attempt_id: string;
  contact_id: string;
  name: string | null;
  outcome: string;
  saved_at: string;
  crm_note: "pending" | "failed" | string;
  error: string | null;
}

const OUTCOME_WORDS: Record<string, string> = {
  no_answer: "No answer",
  callback: "Call back",
  booked: "Booked",
  not_interested: "Not interested",
  disqualified: "Disqualified",
  wrong_number: "Wrong number",
  handled: "Handled",
  showed: "Intro held",
  noshow: "No-show",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

/** An outcome as the screen says it. */
export function outcomeWords(outcome: string): string {
  return OUTCOME_WORDS[outcome] ?? outcome.replace(/_/g, " ");
}

/** "1 save is not in HighLevel yet", "2 saves are …". */
export function savedWorkTitle(n: number): string {
  return n === 1
    ? "1 save is not in HighLevel yet"
    : `${n} saves are not in HighLevel yet`;
}

/**
 * A server sentence fit for the screen: a JSON blob in it becomes its
 * message (or goes), spaces are tidied, and it is cut to `max` characters.
 */
export function plainError(s: string | null | undefined, max = 160): string {
  let out = String(s ?? "");
  out = out.replace(/\{[^{}]*\}/g, blob => {
    try {
      const o = JSON.parse(blob) as Record<string, unknown>;
      const said = o.message ?? o.error ?? o.msg;
      return typeof said === "string" ? said : "";
    } catch {
      return blob;
    }
  });
  out = out.replace(/\s+/g, " ").replace(/:\s*$/, "").trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** Why a save is not in HighLevel, in a few words. */
export function savedWorkWhy(w: SavedWork): string {
  if (w.error) return plainError(w.error, 140);
  return w.crm_note === "failed"
    ? "HighLevel did not take it."
    : "Still not in HighLevel after two minutes.";
}

// ---------------------------------------------------------------------------
// Skips
// ---------------------------------------------------------------------------

/** A skip hides its lead for half an hour at most. */
export const SKIP_MS = 30 * 60_000;

export interface Skip {
  /** When the rep skipped the lead. */
  at: number;
  /** The lead's tier in the queue then. */
  tier: number;
  /** Why the lead was in the queue then (skipReason). */
  reason: string;
}

/**
 * Why a lead is in the queue: the queue's own words, and the moments behind
 * them, so a new message, a new missed call or a new call-back is a new
 * reason to call.
 */
export function skipReason(i: DialItem): string {
  return [
    i.kind ?? "lead",
    i.why,
    i.appointment?.id ?? "",
    i.inbound_at ?? "",
    i.callback_at ?? "",
    i.inbound_call_at ?? "",
  ].join("|");
}

export function skipFor(i: QueueItem, now: number): Skip {
  return { at: now, tier: i.tier, reason: skipReason(i) };
}

/** True while the skip still hides the lead: under 30 minutes, same tier, same reason. */
export function skipHolds(
  s: Skip | undefined,
  i: QueueItem | undefined,
  now: number,
): boolean {
  return Boolean(
    s &&
      i &&
      now - s.at < SKIP_MS &&
      s.tier === i.tier &&
      s.reason === skipReason(i),
  );
}

/**
 * The skips that still hold against this read of the queue. A lead that
 * left the queue, moved tier or came back for another reason is dropped for
 * good. The same object when nothing lapsed, so a state update is a no-op.
 */
export function liveSkips(
  skips: Record<string, Skip>,
  queue: QueueItem[],
  now: number,
): Record<string, Skip> {
  const byId = new Map(queue.map(i => [i.contact_id, i] as const));
  const out: Record<string, Skip> = {};
  let dropped = false;
  for (const [id, s] of Object.entries(skips)) {
    if (skipHolds(s, byId.get(id), now)) out[id] = s;
    else dropped = true;
  }
  return dropped ? out : skips;
}

/**
 * The queue's counts less the leads this page hides (skipped, or saved a
 * moment ago), so a chip never counts a lead the list does not show.
 */
export function countsShown(
  counts: readonly number[],
  queue: readonly QueueItem[],
  shown: readonly QueueItem[],
): number[] {
  const kept = new Set(shown.map(i => i.contact_id));
  const out = [...counts];
  for (const i of queue)
    if (!kept.has(i.contact_id) && out[i.tier] !== undefined)
      out[i.tier] = Math.max(0, out[i.tier] - 1);
  return out;
}

// ---------------------------------------------------------------------------
// The countdown, short enough to sit beside a name on a phone
// ---------------------------------------------------------------------------

/**
 * "Dial within 1:42", "Dial now", "10 min late" (past the two-minute
 * target), or a call-back's "Due in 4 min" / "3 min overdue".
 */
export function shortCountdown(e: UrgentEvent, now: number): string {
  if (e.callback) return countdown(e, now);
  const left = e.deadline - now;
  if (left > 0) return `Dial within ${mmss(left)}`;
  const late = Math.floor(-left / 60_000);
  return late >= 1 ? `${late} min late` : "Dial now";
}

/** The sentence behind a late label, for the line under the title. */
export function lateSentence(e: UrgentEvent, now: number): string | null {
  if (e.callback || e.deadline > now) return null;
  const waited = Math.max(1, Math.floor((now - e.at) / 60_000));
  return `Two-minute target passed, waiting ${waited} min.`;
}

// ---------------------------------------------------------------------------
// Leads the dialer cannot call
// ---------------------------------------------------------------------------

export interface Undialable {
  no_phone?: number | null;
  other?: number | null;
}

const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** One plain line about recent open leads the dialer cannot call, or null when there are none. */
export function undialableLine(
  u: Undialable | null | undefined,
): string | null {
  const none = whole(u?.no_phone);
  const abroad = whole(u?.other);
  const total = none + abroad;
  if (!total) return null;
  const leads = (n: number) => `${n} recent ${n === 1 ? "lead" : "leads"}`;
  const outside = (n: number) =>
    `${n === 1 ? "has a number" : "have numbers"} the dialer has no line for`;
  if (!abroad)
    return `${leads(none)} ${none === 1 ? "has" : "have"} no phone number, so the dialer can't call them.`;
  if (!none)
    return `${leads(abroad)} ${outside(abroad)}. Call ${abroad === 1 ? "it" : "them"} from the Maqsam softphone.`;
  return `${leads(total)} can't be dialed here: ${none} ${none === 1 ? "has" : "have"} no phone number, ${abroad} ${outside(abroad)}. Call ${abroad === 1 ? "that one" : "those"} from the Maqsam softphone.`;
}

// ---------------------------------------------------------------------------
// After a call nobody answered: what can be sent, said plainly
// ---------------------------------------------------------------------------

/** A channel as the conversation read reports it. */
export interface Reach {
  on: boolean;
  dnd: boolean;
  reachable: boolean;
  window?: { open: boolean } | null;
}

export type MissMoment = "missed_call" | "confirm";

/**
 * The panel's clocks for a room in the making (lib/rooms.ts MAKING_LATE_MS
 * and CLAIM_MINUTE_MS read these): the sweep fails a room no worker claimed
 * at a minute (R1) and one whose create never answered at two (R2).
 */
export const MAKING_LATE_STEP_MS = 150_000;
/** lib/rooms.ts LINK_LATE_MS: the panel's "The link has not gone yet", here for the step under it. */
export const LINK_LATE_STEP_MS = 90_000;
export const CLAIM_MINUTE_STEP_MS = 60_000;

/** sales-api's "may have gone" (ROOMS_COPY.may_have_gone_*): the link may be with the lead already. */
export function mayHaveGone(refusal: string | null | undefined): boolean {
  return /^the link may have gone/i.test(String(refusal ?? "").trim());
}

/**
 * sales-api's refusals the minute's re-ask tries again (roomlogic.ts
 * linkRetrying: they end "tried again in a minute"): the link has not gone
 * yet and goes by itself, so the panel never says "Not sent" or "send it
 * another way" for them (m1 round 4, not-sent-then-reask-sends-on-top).
 */
export function linkRetrying(refusal: string | null | undefined): boolean {
  return /tried again in a minute\.?$/i.test(String(refusal ?? "").trim());
}

/**
 * A room made in place of one the lead could not get into ("I can't let
 * them in"), whose link went by email only: the sentence that tells the rep
 * to call the lead, who is still at the old room's door; else null (m1
 * round 2, admit-blocked-email-replacement-lead-left-knocking).
 */
export function movedByEmailOnly(room: {
  moved_from?: string | null;
  provider?: string | null;
  link_channels?: readonly string[] | null;
  contact_first_name?: string | null;
  state?: string;
}): string | null {
  if (!room.moved_from || room.state === "lead_in") return null;
  const ch = room.link_channels ?? [];
  if (
    !ch.includes("email") ||
    ch.includes("whatsapp_text") ||
    ch.includes("whatsapp_template")
  )
    return null;
  const from = room.moved_from === "zoom" ? "Zoom" : "Meet";
  const to = room.provider === "zoom" ? "Zoom" : "Meet";
  const name = room.contact_first_name?.trim() || "The lead";
  return `${name} is still at the ${from} door. Call them and tell them the ${to} link is in their email.`;
}

export interface AfterMiss {
  title: string;
  text: string;
  /** What the main button opens: WhatsApp with the ready message, the email box, or nothing. */
  send: "whatsapp" | "email" | null;
  /**
   * The rep may have spoken with the lead on video (a closed Meet room whose
   * link the lead opened: Meet sends no join signal), so the step also
   * offers Save how it went (stress2 round 3).
   */
  talk?: true;
  /**
   * The lead was at the room's door a moment ago (they knocked and nobody
   * let them in, or they opened the link) and the room has closed: the
   * step's teal button is Call, never Next lead, and the WhatsApp opens
   * with no missed-call message (stress2 round 5).
   */
  callNow?: true;
}

const LEAD_IN: Record<MissMoment, string> = {
  missed_call:
    "A WhatsApp right after a missed call gets answered far more often than an email.",
  confirm:
    "A short WhatsApp asking them to confirm often gets the answer a call did not.",
};
const MESSAGE: Record<MissMoment, string> = {
  missed_call: "missed-call",
  confirm: "confirmation",
};
const TAIL: Record<MissMoment, string> = {
  missed_call: "",
  confirm: " The dialer tries the call again in two hours.",
};
const ASK_WHATSAPP = "No answer. Send them a WhatsApp?";
const ASK_EMAIL = "No answer. Send them an email?";
const NOTHING = "No answer. No message can go from here";
const NO_TEMPLATE =
  "They have not written in the last 24 hours, so WhatsApp takes only an approved template, and none is set up yet";
const MANAGER =
  " A manager connects the templates under Follow-ups, WhatsApp library.";

function blocked(c: Reach, channel: "whatsapp" | "email"): string | null {
  const wa = channel === "whatsapp";
  if (!c.on)
    return `Sending by ${wa ? "WhatsApp" : "email"} is switched off in the cockpit`;
  if (c.dnd)
    return `They asked not to be contacted ${wa ? "on WhatsApp" : "by email"}`;
  if (!c.reachable)
    return wa
      ? "They have no phone number in HighLevel for WhatsApp"
      : "They have no email address in HighLevel";
  return null;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The message the plain step after a miss would offer this lead now: a
 * WhatsApp where one can go (inside the window, or as a live template),
 * else an email, else none (m1 round 5).
 */
function nextMessage(o: {
  whatsapp: Reach | null | undefined;
  email: Reach | null | undefined;
  templatesLive: boolean | null;
}): { send: "whatsapp" | "email" | null; say: string } {
  const wa = o.whatsapp;
  if (!wa) return { send: "whatsapp", say: "send them a WhatsApp" };
  if (
    !blocked(wa, "whatsapp") &&
    (wa.window?.open || o.templatesLive !== false)
  )
    return { send: "whatsapp", say: "send them a WhatsApp" };
  const emWhy = o.email ? blocked(o.email, "email") : null;
  if (!emWhy) return { send: "email", say: "send them an email" };
  return { send: null, say: "" };
}

/**
 * The step after a no-answer. WhatsApp goes free within 24 hours of the
 * lead's last message and as an approved template after that; with no
 * template set up, only email goes. Unknown (still reading) offers WhatsApp
 * and lets the box say what can go.
 */
export function afterMiss(o: {
  moment: MissMoment;
  /** null while the conversation is being read. */
  whatsapp: Reach | null | undefined;
  email: Reach | null | undefined;
  /** Whether any WhatsApp template is live; null while being read. */
  templatesLive: boolean | null;
  /** Whether a ready-made message exists for the moment; null while being read. */
  messageReady: boolean | null;
  /**
   * The lead's video room after this miss, as the room panel reads it: while
   * its link is out (or on its way), the step says so and offers no
   * missed-call message, never a second "I tried to call you" (stress2,
   * round 2).
   */
  video?: {
    state: string;
    link_sent_at: string | null;
    link_channels?: readonly string[] | null;
    refusal?: string | null;
    provider?: string | null;
    first_open_at?: string | null;
    last_open_at?: string | null;
    short_url?: string | null;
    join_url?: string | null;
    lead_in_at?: string | null;
    result?: string | null;
    lead_waiting_at?: string | null;
    late_open_at?: string | null;
    created_at?: string | null;
    /** When the room opened and its link was asked for: the panel's "has not gone yet" counts from the later (m1 round 3). */
    opened_at?: string | null;
    link_claimed_at?: string | null;
    moved_from?: string | null;
    contact_first_name?: string | null;
    /** The room's deadlines (the panel's "should have closed", m1 round 4). */
    purpose?: string | null;
    contact_id?: string | null;
    lead_by?: string | null;
    host_by?: string | null;
    last_link_at?: string | null;
    ends_at?: string | null;
    /** The link's doubt, and what failed or is held by lane (m1 round 5, sales-api's view). */
    link_unconfirmed_at?: string | null;
    link_failed?: readonly string[] | null;
    link_held?: readonly string[] | null;
  } | null;
  /**
   * A Send a video link press whose room.create has not answered yet (the
   * moment it was pressed): a room on its way, so the step never offers the
   * missed-call message beside it (m1 round 4,
   * missed-call-message-offered-while-video-link-press-on-its-way).
   */
  videoPending?: number | null;
  /** Now, for how long a room has been in the making (the panel's clock). */
  now?: number;
  /** The room worker's health line is red (live.status health.worker_ok false). */
  workerDown?: boolean;
  /** The other provider is usable for this seat now (room.status other_ok); false hides Try {other}. */
  otherOk?: boolean;
}): AfterMiss {
  const { moment } = o;
  const now = o.now ?? Date.now();
  const v =
    o.video ??
    (o.videoPending != null
      ? {
          state: "requested",
          link_sent_at: null,
          created_at: new Date(o.videoPending).toISOString(),
        }
      : null);
  // The message a "call them now" step falls back to: the one the plain
  // step would offer for this lead now (m1 round 5,
  // m1-journeys-r5-call-now-steps-say-whatsapp-that-cannot-go), never a
  // WhatsApp that cannot go.
  const way = nextMessage(o);
  const ifNot = (extra = "") =>
    way.send ? `; if they do not answer, ${way.say}${extra}.` : ".";
  // The room made in place of one the lead knocked on ("I can't let them
  // in", moved_from) closed with nobody in it, or was not made: the lead
  // came on time and was locked out by our own room, so the step is a call
  // now, never "No answer" with the missed-call message (m1 round 4,
  // admit-blocked-replacement-expiry-offers-noshow,
  // failed-replacement-try-meet-sends-missed-call-words).
  if (
    v?.moved_from &&
    !v.lead_in_at &&
    ["ended", "expired", "cancelled", "failed"].includes(v.state)
  ) {
    const from = v.moved_from === "zoom" ? "Zoom" : "Meet";
    const to = v.provider === "zoom" ? "Zoom" : "Meet";
    return {
      title: "They knocked and were not let in. Call them now.",
      text:
        v.state === "failed"
          ? `They knocked on the ${from} room and could not be let in, and the ${to} room was not made. Call them now${ifNot()}`
          : `They knocked on the ${from} room and could not be let in, and nobody came into the ${to} room. Call them now${ifNot()}`,
      send: way.send,
      callNow: true,
    };
  }
  // The room failed and the panel above offers Try {other} (the worker up,
  // the other provider usable): that press sends its own message, so the
  // step offers no missed-call message beside it (m1 round 4,
  // failed-room-step-offers-missed-call-email-beside-try-zoom).
  if (
    v &&
    (v.state === "failed" ||
      (v.state === "cancelled" && v.result === "failed")) &&
    o.workerDown !== true &&
    o.otherOk !== false
  ) {
    const other = v.provider === "zoom" ? "Meet" : "Zoom";
    return {
      title: "The video room was not made",
      text: `The video room was not made. Try ${other} above, or call them again.`,
      send: null,
    };
  }
  // The lead knocked in the waiting room and nobody let them in, and the
  // room has closed: they were there a moment ago, so the step says to call
  // them now, never "No answer" with Next lead first (stress2 round 5).
  const closedEmpty =
    v && ["ended", "expired", "cancelled"].includes(v.state) && !v.lead_in_at;
  if (closedEmpty && (v.lead_waiting_at || v.result === "admit_blocked"))
    return {
      title: "They knocked and were not let in. Call them now.",
      text: `They waited at the room's door and nobody let them in, so the room closed. Call them now${ifNot(" with a new link")}`,
      send: way.send,
      callNow: true,
    };
  // They opened a Zoom link and never came in (Zoom reports joins), or
  // opened any link after its room closed: call them now.
  if (
    closedEmpty &&
    (v.late_open_at ||
      (v.provider !== "meet" && (v.first_open_at || v.last_open_at)))
  )
    return {
      title: "They opened the video link. Call them now.",
      text: `They opened the link but did not get in, and the room has closed. Call them now${ifNot(" with a new link")}`,
      send: way.send,
      callNow: true,
    };
  // The room closed with nothing seen and nothing pressed, and the lead's
  // link was Meet's own (rooms.short_link off, as shipped): Meet never says
  // who came in, so the rep may have talked on video for minutes. Asked,
  // never "No answer" (stress2 round 4).
  const shortLink = Boolean(v?.short_url) && v?.short_url !== v?.join_url;
  // Only a link that reached the lead (or may have, or was left to the rep
  // to read out): a link still tried again when the room closed reached
  // nobody, so there was no video call to ask about (m1 round 3b,
  // meet-ended-before-link-went-said-as-maybe-joined).
  const reached =
    Boolean(v?.link_sent_at) ||
    (Boolean(v?.refusal) && !linkRetrying(v?.refusal));
  if (
    v &&
    v.provider === "meet" &&
    ["ended", "expired"].includes(v.state) &&
    !v.lead_in_at &&
    !shortLink &&
    reached &&
    (v.result === "no_join" || v.result === null || v.result === undefined) &&
    !(v.first_open_at || v.last_open_at)
  )
    return {
      title: "Did you speak on video?",
      text: `Meet cannot say whether they came in. If you spoke, save how it went. If not, ${way.send ? way.say : "call them again"}.`,
      send: way.send,
      talk: true,
    };
  // The room closed after the lead opened its Meet link: they may have
  // talked on video, which Meet never reports. The step asks, with Save how
  // it went beside the WhatsApp, never "No answer" first (stress2 round 3).
  if (
    v &&
    v.provider === "meet" &&
    ["ended", "expired", "cancelled"].includes(v.state) &&
    (v.first_open_at || v.last_open_at)
  )
    return {
      title: "They opened the video link. Did you speak?",
      text: `Meet cannot say whether they came in. If you spoke, save how it went. If not, ${way.send ? way.say : "call them again"}.`,
      send: way.send,
      talk: true,
    };
  const live =
    v &&
    ["requested", "creating", "open", "host_in", "lead_in"].includes(v.state);
  // The lead is in Zoom's waiting room: the step says so and points to the
  // room, never the next lead (m1 round 3, step-next-lead-while-lead-in-
  // waiting-room).
  if (v && (v.state === "open" || v.state === "host_in") && v.lead_waiting_at)
    return {
      title: "They are in the waiting room",
      text: "They are waiting to be let in. Open your room and admit them.",
      send: null,
    };
  // Past its close and still open (the sweep is late): the panel says the
  // room should have closed, so the step says the same, never "Wait for
  // them here" (m1 round 4, overdue-room-step-says-wait-for-them).
  if (v && (v.state === "open" || v.state === "host_in")) {
    const deadline = roomDeadline(v);
    if (deadline !== null && now >= deadline + OVERDUE_MS)
      return {
        title: "This room should have closed",
        text: "This room should have closed. Call them now, or end the room.",
        send: null,
        callNow: true,
      };
  }
  if (v && live && v.link_sent_at) {
    // The room in place of one the lead could not get into, its link by
    // email only: they wait at the old door, so the step is a call to tell
    // them, never the next lead (m1 round 2).
    const moved = movedByEmailOnly(v);
    if (moved)
      return {
        title: "Tell them the new link is in their email",
        text: moved,
        send: null,
        callNow: true,
      };
    // What still reached them (m1 round 5,
    // late-failure-step-says-link-went-next-lead): a lane that failed after
    // it went (a bounce, Meta's late failure) or that HighLevel holds is no
    // link they have, and with none standing the step is a call now with
    // the link read out, never "go to the next lead".
    const off = new Set([...(v.link_failed ?? []), ...(v.link_held ?? [])]);
    const ch = (v.link_channels ?? []).filter(c => !off.has(c));
    if (v.link_unconfirmed_at && (v.link_channels ?? []).length && !ch.length)
      return {
        title: "The video link did not reach them",
        text: "The video link did not reach them. Call them now and read the link from the panel above.",
        send: null,
        callNow: true,
      };
    const how =
      ch.includes("whatsapp_text") || ch.includes("whatsapp_template")
        ? " on WhatsApp"
        : ch.includes("email")
          ? " by email"
          : "";
    return {
      title: "The video link went",
      text: `The video link went${how} at ${clock(v.link_sent_at)}. Wait for them here, or go to the next lead.`,
      send: null,
    };
  }
  // The link may have gone (HighLevel's answer was lost): the panel says to
  // check the conversation first, and so does the step, never a second
  // "I tried to call you" beside it (m1 round 2,
  // unclear-link-step-offers-missed-call-message).
  if (v && live && mayHaveGone(v.refusal)) {
    const how = /whatsapp/i.test(v.refusal ?? "") ? "on WhatsApp" : "by email";
    return {
      title: "The video link may have gone",
      text: `The video link may have gone ${how}. Check the conversation in HighLevel before writing to them.`,
      send: null,
    };
  }
  // The link is tried again by sales-api in a minute (m1 round 4): the step
  // says so too, never a message of its own beside it.
  if (v && live && linkRetrying(v.refusal) && !v.link_sent_at)
    return {
      title: "The video link has not gone yet",
      text: "The video link has not gone yet. It is tried again in a minute. Wait for them here, or go to the next lead.",
      send: null,
    };
  // The link did not go, said as final while the room still waits for the
  // lead (m1 round 3b, final-not-sent-step-offers-missed-call-email): the
  // step points to the room's link, never a missed-call message without it.
  if (
    v &&
    (v.state === "open" || v.state === "host_in") &&
    !v.link_sent_at &&
    v.refusal &&
    !mayHaveGone(v.refusal) &&
    !linkRetrying(v.refusal)
  )
    return {
      title: "The video link did not go",
      text: "The video link did not go. Call them now and read the link from the panel above.",
      send: null,
      callNow: true,
    };
  // A room still being made past the sweep's minute with the worker down, or
  // past the panel's own "taking too long": no link is on its way, so the
  // step says to call, as the panel does (m1 round 2).
  const making = v && (v.state === "requested" || v.state === "creating");
  const asked = v?.created_at ? Date.parse(v.created_at) : Number.NaN;
  if (
    v &&
    making &&
    !v.refusal &&
    Number.isFinite(asked) &&
    (now - asked >= MAKING_LATE_STEP_MS ||
      (o.workerDown === true && now - asked >= CLAIM_MINUTE_STEP_MS))
  )
    return {
      title: "The video room is late",
      text: "The video room has not been made, so no link has gone. Call them on the phone.",
      send: null,
      callNow: true,
    };
  // The panel's "The link has not gone yet" (lib/rooms.ts link_late, from
  // the later of the room's open and the link's claim): the step says the
  // same, a call with the link from the panel, never "on its way" or the
  // next lead (m1 round 3, step-on-its-way-under-link-late).
  if (
    v &&
    (v.state === "open" || v.state === "host_in") &&
    !v.link_sent_at &&
    !v.refusal
  ) {
    const t = (x: string | null | undefined) =>
      x ? Date.parse(x) : Number.NaN;
    const opened = Number.isFinite(t(v.opened_at))
      ? t(v.opened_at)
      : t(v.created_at);
    const claimed = t(v.link_claimed_at);
    const from = Number.isFinite(claimed)
      ? Number.isFinite(opened)
        ? Math.max(opened, claimed)
        : claimed
      : opened;
    if (Number.isFinite(from) && now - from >= LINK_LATE_STEP_MS)
      return {
        title: "The video link has not gone",
        text: "The video link has not gone yet. Call them now and give them the link from the panel above.",
        send: null,
        callNow: true,
      };
  }
  if (v && live && !v.refusal)
    return {
      title: "The video link is on its way",
      text: "The video link is on its way to them. Wait for them here, or go to the next lead.",
      send: null,
    };
  const tail = TAIL[moment];
  const unknown: AfterMiss = {
    title: ASK_WHATSAPP,
    text: `${LEAD_IN[moment]}${tail}`,
    send: "whatsapp",
  };
  const wa = o.whatsapp;
  if (!wa) return unknown;
  const waWhy = blocked(wa, "whatsapp");
  if (!waWhy) {
    if (wa.window?.open)
      return {
        title: ASK_WHATSAPP,
        text: `${LEAD_IN[moment]} ${
          o.messageReady === false
            ? "Write it in the box, then send."
            : `The ${MESSAGE[moment]} message is ready in the box; read it, then send.`
        }${tail}`,
        send: "whatsapp",
      };
    if (o.templatesLive === null) return unknown;
    if (o.templatesLive)
      return {
        title: ASK_WHATSAPP,
        text: `${LEAD_IN[moment]} They have not written in the last 24 hours, so it goes as an approved template${
          o.messageReady === false
            ? ": write its line in the box, then send."
            : `, with the ${MESSAGE[moment]} line ready in it. Read it, then send.`
        }${tail}`,
        send: "whatsapp",
      };
  }
  // WhatsApp cannot go now: say why, and whether email can.
  const why = waWhy ?? NO_TEMPLATE;
  const manager = waWhy ? "" : MANAGER;
  const emWhy = o.email ? blocked(o.email, "email") : null;
  if (!emWhy)
    return {
      title: ASK_EMAIL,
      text: `${why}: send an email instead.${manager}${tail}`,
      send: "email",
    };
  return {
    title: NOTHING,
    text: `${why}. Email is out too: ${lower(emWhy)}.${manager}${tail}`,
    send: null,
  };
}
