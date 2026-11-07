/**
 * The setter's whole day in the dialer (Aziz, 2026-11-05: one queue instead
 * of four Slack channels). Pure rules for the screen, kept apart so they are
 * tested:
 * - what each item is called and what its one primary action is (sales-api
 *   dialer.ts ItemCode);
 * - the browser tab's "(N) call now";
 * - the re-alerts the call centre's dialer gives (30 seconds before an
 *   item's deadline, and again when it passes; urgent-alerts.js:66-82);
 * - the words of the day strip: speed to lead today and the replies only
 *   Messages can answer. Nothing missing is ever drawn as zero.
 */

import type { QueueItem, SpeedToday, UrgentEvent } from "./dialer";
import { ago, clock, dayLabel } from "./format";

/** What the item's teal button does: call them, send the voice note, or mark the call. */
export type ItemAction = "call" | "voice" | "mark";

export interface ItemWords {
  /** The short label above the item's own words ("Just booked, call now"). */
  label: string;
  action: ItemAction;
  /** A sentence on what to do, or null when the item's own words say it. */
  detail: string | null;
}

const CODES: Record<string, ItemWords> = {
  intro_now: {
    label: "Your intro, now",
    action: "call",
    detail:
      "Intros are phone calls: call them at the booked time, then say how it went.",
  },
  new_lead: {
    label: "New lead, call now",
    action: "call",
    detail:
      "Call now, and again if nobody picks up. Do the intro then and there.",
  },
  just_booked: {
    label: "Just booked, call now",
    action: "call",
    detail:
      "They booked an intro. Call now anyway: if they pick up, do the intro then and there.",
  },
  second_try: {
    label: "Second try now",
    action: "call",
    detail:
      "The first call rang out. Call once more; if nobody picks up, send the voice note.",
  },
  voice_note: {
    label: "Send a voice note",
    action: "voice",
    detail:
      "Nobody picked up. Record the voice note on your phone's WhatsApp, then say you sent it.",
  },
  confirm: {
    label: "Confirm, 2.5 h before",
    action: "call",
    detail: "Not confirmed yet. Call to check they are still coming.",
  },
  confirm_last: {
    label: "Confirm, 60 min before",
    action: "call",
    detail:
      "The first confirmation call rang out. This is the last try before the call.",
  },
  confirm_early: {
    label: "Confirm, the day before",
    action: "call",
    detail: null,
  },
  reply_now: { label: "Wrote back, call now", action: "call", detail: null },
  reply_today: { label: "Wrote back today", action: "call", detail: null },
  reply_booked: {
    label: "Wrote back, has an intro",
    action: "call",
    detail: null,
  },
  reply_waiting: {
    label: "Still waiting on you",
    action: "call",
    detail:
      "They wrote and nobody has answered yet. Call them, or write back in the conversation.",
  },
  intro_cancelled: {
    label: "Cancelled the intro, rebook it",
    action: "call",
    detail: "They cancelled their intro. Call and book a new time.",
  },
  intro_noshow: {
    label: "Missed the intro, rebook it",
    action: "call",
    detail: null,
  },
  demo_noshow: {
    label: "Missed the demo, rebook it",
    action: "call",
    detail: null,
  },
  demo_cancelled: {
    label: "Cancelled the demo, rebook it",
    action: "call",
    detail: null,
  },
  mark_call: {
    label: "Mark the intro",
    action: "mark",
    detail:
      "Did it happen? A call nobody marks counts as shown in every show rate.",
  },
  callback_now: { label: "Call back now", action: "call", detail: null },
  callback_today: { label: "Call back today", action: "call", detail: null },
  callback_late: { label: "Call-back overdue", action: "call", detail: null },
  missed_call_now: {
    label: "Called us, call back now",
    action: "call",
    detail: null,
  },
  missed_call_today: {
    label: "Called us today",
    action: "call",
    detail: null,
  },
  hot_due: { label: "Hot lead, follow up now", action: "call", detail: null },
  hot_planned: { label: "Hot lead", action: "call", detail: null },
  showed_not_signed: {
    label: "Showed, not signed",
    action: "call",
    detail: null,
  },
  new_not_reached: {
    label: "New lead, not reached yet",
    action: "call",
    detail: null,
  },
  new_never_called: {
    label: "New lead, never called",
    action: "call",
    detail: null,
  },
  retry: { label: "Next try", action: "call", detail: null },
  never_called: { label: "Never called", action: "call", detail: null },
};

/**
 * The line an intro's confirmation call adds (the CEO, 2026-11-07: confirm,
 * and if he gets them on the phone, do the intro and book the demo then and
 * there). A demo's confirmation does not get it: a demo is marked at its
 * time. Nor does a seat that may not mark the intro (fix pass 2): the grid
 * has no Did the intro now for it.
 */
export const HELD_NOW_LINE =
  "Got them now? Do the intro, press Did the intro now, then Book the demo.";

/** The confirmation items, the day before, 2.5 hours before and 60 minutes before. */
const CONFIRM_CODES = new Set(["confirm", "confirm_last", "confirm_early"]);

/**
 * The item's label, its one primary action and what to do, from its code;
 * null for an item from a server older than the setter's one queue (no
 * code), which the page shows as before. `mayMark`: the seat may mark the
 * item's intro (dialerUi.ts mayMarkCall with its host), so an intro's
 * confirmation says to press Did the intro now.
 */
export function itemWords(
  item: QueueItem | null | undefined,
  mayMark = true,
): ItemWords | null {
  if (!item?.code) return null;
  const w = CODES[item.code];
  if (!w) return null;
  if (item.code === "mark_call") {
    const demo =
      String((item.mark_call as { call_type?: unknown } | null)?.call_type) ===
      "demo";
    return demo
      ? {
          label: "Mark the demo",
          action: "mark",
          detail: w.detail,
        }
      : { ...w };
  }
  if (
    CONFIRM_CODES.has(item.code) &&
    item.appointment?.type === "intro" &&
    mayMark
  )
    return {
      ...w,
      detail: w.detail ? `${w.detail} ${HELD_NOW_LINE}` : HELD_NOW_LINE,
    };
  // The second try once the voice note is no longer due: it went, so the
  // band does not ask for it again (or the voice notes cannot be read yet).
  if (item.code === "second_try" && item.voice_note && !item.voice_note.due)
    return {
      ...w,
      detail:
        item.voice_note.known === false
          ? "The first call rang out. Call once more."
          : "The first call rang out and the voice note went. Call once more.",
    };
  return { ...w };
}

/** The words of the step after a call nobody answered (dialerUi.ts afterMiss). */
export interface MissWords {
  title: string;
  text: string;
}

/**
 * The after-miss step's words while the voice note card is above it: one
 * message is enough, so the WhatsApp from the official line is offered as the
 * other way, not as a second message (2026-11-06 review: the lead got two
 * WhatsApps from two numbers within a minute). Any other step (the video
 * link, a lead at the door, email) keeps its own words.
 */
export function missStepWords(
  step: MissWords & { send?: string | null; callNow?: boolean },
  voiceFirst: boolean,
): MissWords {
  if (!voiceFirst || step.send !== "whatsapp" || step.callNow)
    return { title: step.title, text: step.text };
  return {
    title: "Or write from the official line",
    text: "One message is enough: the voice note above, or a WhatsApp from the official line. Not both.",
  };
}

// ---------------------------------------------------------------------------
// The tab title and the re-alerts
// ---------------------------------------------------------------------------

/** How many call-now items are waiting, the open call's lead left out. */
export function callNowCount(
  items: readonly QueueItem[],
  openContactId: string | null | undefined,
): number {
  return items.filter(i => i.tier === 0 && i.contact_id !== openContactId)
    .length;
}

/** "(3) call now · Sales · Mahara" while call-now items wait; the page's own title otherwise. */
export function callNowTitle(base: string, n: number): string {
  return n > 0 ? `(${n}) call now · ${base}` : base;
}

export type AlertStage = "30s" | "late";

/** The re-alert 30 seconds before an item's deadline. */
export const REALERT_BEFORE_MS = 30_000;

/**
 * The re-alerts owed between two looks at the clock (`from` exclusive, `to`
 * inclusive): 30 seconds before an item's deadline, and the moment it
 * passes. A crossing is said once, by the look that saw it; a page that
 * opens on an item already late owes nothing for it (its first chime says
 * it).
 */
export function alertCrossings(
  events: readonly UrgentEvent[],
  from: number,
  to: number,
): { key: string; stage: AlertStage }[] {
  if (!(to > from)) return [];
  const out: { key: string; stage: AlertStage }[] = [];
  for (const e of events) {
    const soon = e.deadline - REALERT_BEFORE_MS;
    if (soon > from && soon <= to) out.push({ key: e.key, stage: "30s" });
    if (e.deadline > from && e.deadline <= to)
      out.push({ key: e.key, stage: "late" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The day strip
// ---------------------------------------------------------------------------

/** A piece of the strip's sentence: a number set apart, or plain words. */
export interface Seg {
  text: string;
  num?: boolean;
}

/** "under 1 min", "4.5 min", "38 min", "2 h 5 min", "1 d 3 h". */
export function minutesWords(m: number): string {
  if (!Number.isFinite(m) || m < 0) return "not known";
  if (m < 1) return "under 1 min";
  if (m < 10) return `${String(Math.round(m * 10) / 10)} min`;
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = Math.round(m - h * 60);
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.round((m - d * 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/**
 * Today's speed to lead as the strip says it, or null when the server sent
 * no speed at all (one older than the strip). A speed that could not be
 * read says so; a day with no new lead says that, never "0 of 0".
 */
export function speedSegs(speed: SpeedToday | null | undefined): Seg[] | null {
  if (speed === undefined) return null;
  if (speed === null)
    return [
      {
        text: "not known right now: today's leads or calls could not be read.",
      },
    ];
  const n = Math.max(0, Math.floor(Number(speed.leads) || 0));
  if (!n) return [{ text: "No new leads yet today." }];
  const segs: Seg[] = [
    { text: String(n), num: true },
    { text: n === 1 ? " new lead today · " : " new leads today · " },
    { text: `${speed.within5} of ${n}`, num: true },
    { text: " called inside 5 min · " },
  ];
  if (speed.called > 0 && speed.median_min !== null)
    segs.push(
      { text: "median " },
      { text: minutesWords(speed.median_min), num: true },
      { text: " to the first call · " },
    );
  else segs.push({ text: "none called yet · " });
  if (speed.not_called > 0)
    segs.push(
      { text: String(speed.not_called), num: true },
      { text: " not called yet" },
    );
  else segs.push({ text: "every one called" });
  return segs;
}

/** The strip's sentence as plain text (tests, and the strip's label). */
export function segsText(segs: readonly Seg[] | null): string {
  return (segs ?? []).map(s => s.text).join("");
}

/** What the speed could not count, said under it, or null. */
export function speedGaps(speed: SpeedToday | null | undefined): string | null {
  const gaps = (speed?.not_known ?? []).filter(Boolean);
  return gaps.length ? `Not read just now: ${gaps.join(", ")}.` : null;
}

/**
 * The oldest lead still waiting for a first call, as a live clock: the
 * server's whole minutes at the read, plus the time since. "38:12", or
 * "1:05:12" past an hour.
 */
export function waitClock(
  minutes: number,
  loadedAt: number,
  now: number,
): string {
  const s = Math.max(
    0,
    Math.floor(minutes * 60 + Math.max(0, now - loadedAt) / 1000),
  );
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export interface WaitingMessages {
  count?: number | null;
  oldest_at?: string | null;
  source?: string | null;
}

/** The line for replies the dialer cannot call (DMs, numbers abroad), or null when there are none. */
export function messagesLine(
  m: WaitingMessages | null | undefined,
  now: number,
): string | null {
  const n = Math.max(0, Math.floor(Number(m?.count) || 0));
  if (!n) return null;
  const who = n === 1 ? "1 person wrote" : `${n} people wrote`;
  const oldest = m?.oldest_at
    ? `, ${n === 1 ? "" : "the oldest "}${ago(m.oldest_at, now)}`
    : "";
  return `${who} where only Messages can answer${oldest}.`;
}

/** The rep's own day in one line (dial.queue today): saves, answered calls, bookings, the queue. */
export function dayLine(
  t: {
    saved: number;
    calls: number;
    answered: number;
    booked: number;
  } | null,
  ready: number | null,
): string | null {
  if (!t) return null;
  return [
    `${t.saved} saved`,
    t.calls
      ? `${t.answered} of ${t.calls} answered`
      : "no calls through the dialer yet",
    `${t.booked} booked`,
    ready === null ? null : `${ready} in the queue`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "today at 18:00", "tomorrow at 09:00", "on Thu 24 Sep at 10:20" (Kuwait time), for the middle of a sentence. */
export function dayAt(
  iso: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const d = dayLabel(iso, now);
  const day = /^(Today|Tomorrow|Yesterday)$/.test(d)
    ? d.toLowerCase()
    : `on ${d}`;
  return `${day} at ${clock(iso)}`;
}

/** The item's label adds nothing when the item's own words already say it. */
export function labelSaysMore(
  words: ItemWords | null,
  why: string | null | undefined,
): boolean {
  if (!words) return false;
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return norm(words.label) !== norm(String(why ?? ""));
}
