// Live video rooms: the rules, with no IO (the foundation spec of
// 2026-10-03, with the consistency check's names and fixes). index.ts,
// rooms.ts, the sales-live door and the VPS worker make the calls; what they
// decide comes from here, so every rule can be tested on its own:
//   bun test supabase/functions/sales-api
//
// In order: names and settings; every sentence; times; the join code and the
// short link; deadlines; the room state machine and the sweep; the queue
// hold; which channel carries the link; who is staff in a Zoom call; link
// preview bots and devices; the Google event id; the live booking
// (countLive); presence; the health line; the browser's view of a room (never
// start_url); creating and wrapping a room; the panel's line.
//
// These rules hold everywhere and are tested on 10,000 random runs:
// - a final room (ended, expired, failed, cancelled) never changes state
//   again; the writes it still takes are "That was not the lead" within
//   5 minutes of the join, which only takes the count back, and a lead join
//   a timer's close raced, kept as evidence only (lateLeadIn);
// - no timer ends a room with the lead in it: a lead_in room is only closed
//   in the books at ends_at + no_end_signal ("No end signal"), and no
//   provider call is ever made for a room that reached lead_in;
// - no timer closes a room while one of its events still waits for the
//   replay (at most 5 minutes);
// - host_by, lead_by and ends_at only ever move later;
// - the link is asked for once: the write that asks also claims it
//   (link_claimed_at); the sweep asks again only for a claim that never
//   became a send, with the same request id;
// - a join is counted once, and an undo always lands, even after a crash:
//   the sweep asks again for a count or an undo that never finished.

import { isClient } from "./clients.ts";
import { BOOKING_CALENDARS } from "./dialer.ts";
import { dndFor, greetingName, redact, slackSafe, whatsappWindow } from "./lib.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const KUWAIT = 3 * HOUR;

// ---------------------------------------------------------------------------
// Names (consistency check 1.2 and 1.3)
// ---------------------------------------------------------------------------

export const ROOM_STATES = [
  "requested",
  "creating",
  "open",
  "host_in",
  "lead_in",
  "ended",
  "expired",
  "failed",
  "cancelled",
] as const;
export type RoomState = (typeof ROOM_STATES)[number];
export const FINAL_STATES: readonly RoomState[] = ["ended", "expired", "failed", "cancelled"];
export const LIVE_STATES: readonly RoomState[] = ["requested", "creating", "open", "host_in", "lead_in"];
const FINAL = new Set<string>(FINAL_STATES);

/**
 * Every move a room may make. Opened, sent and waiting are times, not states.
 * host_in → open is the host leaving before the lead came (P2); lead_in →
 * host_in is "That was not the lead" within 5 minutes. Final states have no
 * way out.
 */
export const TRANSITIONS: Readonly<Record<RoomState, readonly RoomState[]>> = {
  requested: ["creating", "failed", "cancelled"],
  creating: ["open", "failed", "cancelled"],
  open: ["host_in", "lead_in", "ended", "expired", "cancelled"],
  host_in: ["open", "lead_in", "ended", "expired", "cancelled"],
  lead_in: ["host_in", "ended"],
  ended: [],
  expired: [],
  failed: [],
  cancelled: [],
};

export const PURPOSES = ["fallback", "handover", "standby", "booked", "manual"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const CALL_KINDS = ["intro", "demo"] as const;
export type CallKind = (typeof CALL_KINDS)[number];
export const PROVIDERS = ["meet", "zoom"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const TRIGGERS = ["no_answer", "busy", "did_not_connect", "no_talk", "hung_up", "bad_number", "manual", "auto"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const ROOM_RESULTS = ["joined", "no_join", "moved_to_phone", "cancelled", "failed", "admit_blocked"] as const;
export type RoomResult = (typeof ROOM_RESULTS)[number];
/**
 * The live count's outcome. unclear: HighLevel may have made the booking (its
 * answer was lost) and nothing could confirm it, so nobody books by hand until
 * a person checks; already_counted: another room of the lead's already
 * counted this conversation; self_reported: only a hand press says the lead
 * came in, so nothing is booked until a manager confirms it.
 */
export const COUNT_RESULTS = [
  "booked",
  "moved",
  "not_a_lead",
  "failed",
  "undone",
  "unclear",
  "already_counted",
  "self_reported",
] as const;
export type CountResult = (typeof COUNT_RESULTS)[number];
export const SETTLED_MARKS = ["showed", "noshow", "none"] as const;
export type SettledMark = (typeof SETTLED_MARKS)[number];
export const SEND_ON = ["open", "host_in"] as const;
export type SendOn = (typeof SEND_ON)[number];
/** room.mark's `what` (contract). */
export const ROOM_MARKS = ["host_in", "lead_in", "not_lead", "still_on"] as const;
export type RoomMark = (typeof ROOM_MARKS)[number];
/** room.end's `reason` (contract), plus P1's "I can't let them in". */
export const END_REASONS = ["end", "on_phone", "finished", "cancel", "admit_blocked"] as const;
export type EndReason = (typeof END_REASONS)[number];
export const ZOOM_STATUSES = ["licensed", "basic", "pending", "missing"] as const;
export type ZoomStatus = (typeof ZOOM_STATUSES)[number];
export const LINK_CHANNELS = ["whatsapp_text", "whatsapp_template", "email"] as const;
export type LinkChannel = (typeof LINK_CHANNELS)[number];

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export function isRoomState(v: unknown): v is RoomState {
  return oneOf(ROOM_STATES, v);
}
export function isFinal(v: unknown): boolean {
  return typeof v === "string" && FINAL.has(v);
}
export function canMove(from: RoomState, to: RoomState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}
export const isPurpose = (v: unknown): v is Purpose => oneOf(PURPOSES, v);
export const isCallKind = (v: unknown): v is CallKind => oneOf(CALL_KINDS, v);
export const isProvider = (v: unknown): v is Provider => oneOf(PROVIDERS, v);

export function otherProvider(p: Provider): Provider {
  return p === "zoom" ? "meet" : "zoom";
}
export function providerName(p: unknown): string {
  return p === "zoom" ? "Zoom" : "Meet";
}

// ---------------------------------------------------------------------------
// Settings: `rooms` (consistency check 1.4). Anything not exactly `true` is
// off, so a damaged setting can only switch things off.
// ---------------------------------------------------------------------------

/** Every wait, in seconds (1.4 `rooms.waits_s`; meanings in 1.9). */
export interface Waits {
  ready: number;
  fail: number;
  meet_pending: number;
  manual_buttons: number;
  handover_host: number;
  standby_host: number;
  fallback_host: number;
  lead: number;
  open_grace: number;
  not_lead_undo: number;
  event_replay: number;
  settle: number;
  no_end_signal: number;
  standby_max: number;
  booked_guard: number;
  unconfirmed: number;
}

export const DEFAULT_WAITS: Readonly<Waits> = Object.freeze({
  ready: 15,
  fail: 60,
  meet_pending: 30,
  manual_buttons: 30,
  handover_host: 120,
  standby_host: 300,
  fallback_host: 900,
  lead: 600,
  open_grace: 180,
  not_lead_undo: 300,
  event_replay: 20,
  settle: 1200,
  no_end_signal: 1800,
  standby_max: 2100,
  booked_guard: 600,
  unconfirmed: 20,
});

/** A booked room's own deadlines (1.9): host by start + 15 min, lead by start + 20 min. */
export const BOOKED_HOST_MIN = 15;
export const BOOKED_LEAD_MIN = 20;
/** room.wrap runs from 30 minutes before a booked call, so a wrap never holds a lead or a host for hours. */
export const WRAP_EARLY_MIN = 30;
/** The worker's status row turns the health line red after this long (1.7). */
export const WORKER_RED_AFTER_S = 90;
/**
 * A room worker whose last report is older than this is down for room.create
 * (fix round 4): the rep is told at once to phone the lead or send their own
 * meeting link, never left on "Making your room" for a minute.
 */
export const WORKER_DOWN_AFTER_S = 180;

/**
 * What the room worker writes at the start of its status detail whenever it
 * is running but claims no room (its clock more than a minute off, the
 * rooms setting unreadable, the rooms tables missing): hermes/sales-desk
 * desk/rooms.py NOT_MAKING, the same words.
 */
export const NOT_MAKING_PREFIX = "Not making rooms: ";

/** The worker's own word that it is alive and making no rooms (final review). */
export function workerNotMaking(row: { ok?: unknown; detail?: unknown } | null | undefined): boolean {
  return row?.ok === false && String(row?.detail ?? "").startsWith(NOT_MAKING_PREFIX);
}

/**
 * The room worker is down for room.create: it last reported more than
 * WORKER_DOWN_AFTER_S ago, or its fresh report says it makes no rooms. The
 * create gate and the health line read the worker the same way (final
 * review), so a rep never sees "Making your room" for a room no run will
 * claim. A row never written is handled by the caller (the health line says
 * the worker has not run yet; room.create refuses).
 */
export function workerDown(lastRunAt: unknown, now: number, row?: { ok?: unknown; detail?: unknown } | null): boolean {
  if (workerNotMaking(row)) return true;
  const last = ms(lastRunAt);
  return last !== null && now - last > WORKER_DOWN_AFTER_S * S;
}
/** A stored door event older than this is left for a person, not replayed. */
export const REPLAY_MAX_AGE_S = 86_400;
/** A timer waits this long at most for a room's unhandled events to be replayed. */
export const PENDING_HOLD_MAX_S = 300;
/** The sweep asks again for a link, a count or an undo that was asked for this long ago and never finished. */
export const REASK_AFTER_S = 60;
/** A count claimed this long ago with no result is flagged to a person. */
export const COUNT_STUCK_S = 120;
/** Re-asks for a count or an undo stop this long after the join or the undo. */
export const REASK_WINDOW_S = 3_600;
/** A conditional write lost to another writer is read and tried again at most this many times. */
export const MAX_WRITE_TRIES = 5;
/** An event time ahead of the server clock by more than this is taken as now. */
const CLOCK_SKEW_S = 5;

function obj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}
function str(v: unknown, max = 200): string | null {
  const s = typeof v === "string" ? v.replaceAll("\u0000", "").trim().slice(0, max) : "";
  return s || null;
}
function lower(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}
function strList(v: unknown, max = 500): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => String(x ?? "").trim()).filter(Boolean))].slice(0, max);
}
function bounded(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
}

export function waitsFrom(raw: unknown): Waits {
  const r = obj(raw);
  const out = { ...DEFAULT_WAITS } as Waits;
  for (const k of Object.keys(DEFAULT_WAITS) as (keyof Waits)[]) out[k] = bounded(r[k], DEFAULT_WAITS[k], 7 * 86_400);
  return out;
}

export interface RoomsSetting {
  enabled: boolean;
  test_only: boolean;
  test_contacts: string[];
  test_calendar_id: string | null;
  /**
   * The dedicated "Live" calendar a joined lead's new booking goes on (D25):
   * outside B2B's show-rate map, so live calls never move the 60% and 75%
   * targets. Null: no new live booking is made at all.
   */
  live_calendar_id: string | null;
  providers: Record<Provider, boolean>;
  default_provider: { setter: Provider; closer: Provider };
  send: { whatsapp_text: boolean; whatsapp_template: boolean; email: boolean };
  template_route: string;
  count_on_join: boolean;
  short_link: boolean;
  waits_s: Waits;
  lengths_min: Record<CallKind, number>;
  booking_min: Record<CallKind, number>;
  available_hours: number;
  fallback: { scope: string; auto_on_miss: boolean; pilot_emails: string[]; ended_page_whatsapp: string | null };
}

/** The `rooms` setting exactly as it ships (1.4): everything off, test contact only. */
export const DEFAULT_ROOMS_JSON = Object.freeze({
  enabled: false,
  test_only: true,
  test_contacts: ["VjPfR4Cc1Y0OFvaqeor5"],
  test_calendar_id: null,
  live_calendar_id: null,
  providers: { zoom: false, meet: false },
  default_provider: { setter: "meet", closer: "zoom" },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  template_route: "call_link",
  count_on_join: false,
  short_link: false,
  waits_s: { ...DEFAULT_WAITS },
  lengths_min: { intro: 30, demo: 60 },
  booking_min: { intro: 15, demo: 45 },
  available_hours: 2,
  fallback: { scope: "intro", auto_on_miss: false, pilot_emails: [], ended_page_whatsapp: null },
});

export function roomsSetting(raw: unknown): RoomsSetting {
  const r = obj(raw);
  const on = (v: unknown) => v === true;
  const prov = obj(r.providers);
  const def = obj(r.default_provider);
  const send = obj(r.send);
  const len = obj(r.lengths_min);
  const book = obj(r.booking_min);
  const fb = obj(r.fallback);
  return {
    enabled: on(r.enabled),
    test_only: r.test_only !== false,
    test_contacts: strList(r.test_contacts),
    test_calendar_id: str(r.test_calendar_id, 80),
    live_calendar_id: str(r.live_calendar_id, 80),
    providers: { zoom: on(prov.zoom), meet: on(prov.meet) },
    default_provider: {
      setter: isProvider(def.setter) ? def.setter : "meet",
      closer: isProvider(def.closer) ? def.closer : "zoom",
    },
    send: { whatsapp_text: on(send.whatsapp_text), whatsapp_template: on(send.whatsapp_template), email: on(send.email) },
    template_route: str(r.template_route, 60) ?? "call_link",
    count_on_join: on(r.count_on_join),
    short_link: on(r.short_link),
    waits_s: waitsFrom(r.waits_s),
    lengths_min: { intro: bounded(len.intro, 30, 600), demo: bounded(len.demo, 60, 600) },
    booking_min: { intro: bounded(book.intro, 15, 600), demo: bounded(book.demo, 45, 600) },
    available_hours: bounded(r.available_hours, 2, 24),
    fallback: {
      scope: str(fb.scope, 20) ?? "intro",
      auto_on_miss: on(fb.auto_on_miss),
      pilot_emails: strList(fb.pilot_emails).map(e => e.toLowerCase()),
      ended_page_whatsapp: str(fb.ended_page_whatsapp, 40),
    },
  };
}

export const DEFAULT_ROOMS_SETTING: RoomsSetting = roomsSetting(DEFAULT_ROOMS_JSON);

/**
 * WhatsApp may carry a room link only once the WA Connector is confirmed off
 * and the single-copy test has passed (`whatsapp_guard`, 1.4).
 */
export function whatsappGuardOpen(guard: unknown): boolean {
  const g = obj(guard);
  const ok = ms(g.single_copy_ok_at);
  const off = ms(g.connector_off_at);
  // A single-copy test from before the connector last went off proves nothing (sendrules.ts gateOpen).
  return g.connector_off === true && ok !== null && (off === null || ok >= off);
}

/**
 * live.hours (glossary 1.10): the days live calls run (0 Sunday to 6
 * Saturday, on the zone's own calendar) and the clock window, "10:00" to
 * "20:00" (the end not included). A damaged value falls back to the shipped
 * window, never to "always".
 */
export interface LiveHours {
  days: number[];
  /** Minutes after the zone's midnight. */
  from: number;
  to: number;
  tz: string;
}
export const DEFAULT_LIVE_HOURS: Readonly<LiveHours> = Object.freeze({
  days: [6, 0, 1, 2, 3, 4],
  from: 10 * 60,
  to: 20 * 60,
  tz: "Asia/Kuwait",
});

function clockMinutes(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 && h * 60 + min <= 24 * 60 ? h * 60 + min : null;
}

function zoneOk(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function liveHoursOf(raw: unknown): LiveHours {
  const r = obj(raw);
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
    : null;
  const from = clockMinutes(r.from);
  const to = clockMinutes(r.to);
  const tz = typeof r.tz === "string" && r.tz.trim() && zoneOk(r.tz.trim()) ? r.tz.trim() : DEFAULT_LIVE_HOURS.tz;
  if (!days?.length || from === null || to === null || to <= from) return { ...DEFAULT_LIVE_HOURS, days: [...DEFAULT_LIVE_HOURS.days], tz };
  return { days, from, to, tz };
}

/** The zone's weekday (0 Sunday) and the time of day in seconds at `t`. */
function zoneClock(t: number, tz: string): { day: number; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, seconds: Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")) };
}

/**
 * Whether live calls run at `now` (live.hours), and when today's window
 * closes. Outside the window nobody is made Available with a standby room,
 * and Available never runs past the window's end.
 */
export function liveWindow(hours: unknown, now: number): { open: boolean; ends_at: number | null } {
  const h = liveHoursOf(hours);
  const { day, seconds } = zoneClock(now, h.tz);
  const open = h.days.includes(day) && seconds >= h.from * 60 && seconds < h.to * 60;
  if (!open) return { open, ends_at: null };
  let end = now + (h.to * 60 - seconds) * S - (now % S);
  // A window that runs to midnight and starts again at midnight the next
  // day (an all-day window) is one window: Available is not cut at 00:00.
  if (h.from === 0 && h.to === 24 * 60)
    for (let d = 1; d < 7 && h.days.includes((day + d) % 7); d++) end += 24 * 3600 * S;
  return { open, ends_at: end };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "Live calls run Saturday to Thursday, 10:00 to 20:00 Kuwait time.", for
 * the window live.hours sets (a manager may change it), so the strip's
 * refusal names the hours that really apply.
 */
export function outsideHoursText(hours: unknown): string {
  const h = liveHoursOf(hours);
  // The week as Kuwait counts it: Saturday first.
  const week = [6, 0, 1, 2, 3, 4, 5];
  const on = week.filter(d => h.days.includes(d));
  const idx = on.map(d => week.indexOf(d));
  const run = idx.every((v, i) => i === 0 || v === (idx[i - 1] as number) + 1);
  const days =
    on.length === 7
      ? "every day"
      : on.length === 1
        ? `on ${DAY_NAMES[on[0] as number]}`
        : run
          ? `${DAY_NAMES[on[0] as number]} to ${DAY_NAMES[on[on.length - 1] as number]}`
          : `on ${on
              .slice(0, -1)
              .map(d => DAY_NAMES[d])
              .join(", ")} and ${DAY_NAMES[on[on.length - 1] as number]}`;
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const zone = h.tz === "Asia/Kuwait" ? "Kuwait" : (h.tz.split("/").pop() ?? h.tz).replace(/_/g, " ");
  const times = h.from === 0 && h.to === 24 * 60 ? "all day" : `${hm(h.from)} to ${hm(h.to)}`;
  return `Live calls run ${days}, ${times} ${zone} time.`;
}

/** The context every room rule needs. */
export interface RoomCtx {
  waits: Waits;
  lengths_min: Record<CallKind, number>;
  /** The host's first name for "This room belongs to {host}."; else taken from the email. */
  host_first_name?: string | null;
  /** rooms.count_on_join: only then does the sweep ask again for a count that never ran. */
  count_on_join?: boolean;
}

export function roomCtx(
  setting?: Partial<Pick<RoomsSetting, "waits_s" | "lengths_min" | "count_on_join">> | null,
): RoomCtx {
  return {
    waits: setting?.waits_s ? { ...setting.waits_s } : { ...DEFAULT_WAITS },
    lengths_min: setting?.lengths_min ? { ...setting.lengths_min } : { intro: 30, demo: 60 },
    count_on_join: setting?.count_on_join === true,
  };
}

// ---------------------------------------------------------------------------
// Every sentence. ROOM_COPY is word for word from the specs (the source of
// each is noted); LANE_COPY holds the few the specs did not set, written in
// the same voice for review.
// ---------------------------------------------------------------------------

export const ROOM_COPY = {
  /** Refusals: F "Locking rules" and "Edge cases", P1 "Refused", P2 "Edge cases", the contract. */
  refusals: {
    lead_has_room: "This lead already has a room open. Open it.", // F locking 1
    lead_has_room_fallback: "A video room is already open for this lead. Use that one.", // P1 refused
    host_has_room: "You already have a room open. End it first.", // P1 refused
    taken: "Someone else took this lead.", // F locking 2
    live_call_open: "You already have a live call.", // F locking 2, P2
    stale: "This changed a moment ago.", // F locking 3
    not_host: "This room belongs to {host}.", // contract room.open
    confirm_end: "The lead is still in this room. End it anyway?", // contract room.end, F panel
    zoom_busy: "Your Zoom is in another meeting. End it or use Meet.", // F edge, P1 panel
    zoom_basic_demo: "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.", // F edge
    zoom_pending: "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.", // P1 panel
    // Meet rooms are made on the CEO's one Google sign-in on the room worker
    // (rooms.py writes the same google_ok to every seat), so a seat has
    // nothing of its own to connect (final review).
    no_google: "Meet rooms are down until the CEO reconnects Google on the room worker. Use Zoom, or call the lead.", // F edge
    meet_pending: "Google did not make the Meet link. Try Zoom.", // F edge
    client: "This contact is an active client. Client success looks after them.", // P1 refused
    dnd: "Do not disturb is on in HighLevel. No link can go.", // P1 refused
    booked_demo: "This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made.", // P1 refused
    phone_call: "This call is on the phone. There is no link to send.", // F flow, booked call
    handover_open: "A live call for this lead is already open, started by {setter} at {time}.", // P2 edge
    offer_taken: "{rep} took this lead at {time}.", // P2 edge
    offer_closed: "This offer closed at {time}. Nothing to do.", // P2 edge
    outside_hours: "Live calls run Saturday to Thursday, 10:00 to 20:00 Kuwait time.", // P2 edge
    nobody_took: "Book a demo instead.", // F flow, handover expired
    not_in_highlevel: "Not in HighLevel: book and mark it by hand.", // P2 edge
    zoom_failed_handover: "Zoom did not open your room: {error}. Use Meet.", // P2 edge
  },
  /** Room panel (F "Room panel"); used for every purpose but fallback. */
  panel: {
    making: "Making your {provider} room...",
    ready: "Room ready.",
    link_sent: "Link sent on {channel} at {time}.",
    not_confirmed: "Not confirmed on WhatsApp. Sent by email too.",
    not_sent: "Not sent: {reason}. Read it out: {link}",
    opened: "The lead opened the link at {time}{device}.",
    waiting_room: "The lead is in the waiting room. Admit them in Zoom.",
    host_in: "You are in. Waiting for the lead ({left} left).",
    joined_counted: "The lead joined at {time}. Booked and marked shown in HighLevel.",
    joined_not_lead: "The lead joined at {time}. Not counted: this contact is not a tagged lead.",
    no_join: "The lead did not join in {minutes} minutes. Room closed. Call again or send a message.",
    end_with_lead: "The lead is still in this room. End it anyway?",
    phone_call: "This call is on the phone. There is no link to send.",
    still_on_call: "Still on the call?", // consistency 1.9 no_end_signal
    no_end_signal: "No end signal from Zoom", // F states
    no_end_signal_any: "No end signal", // consistency 1.9 (both providers)
  },
  /** Room panel for the fallback room after a missed call (P1 "Room panel"). */
  panel_fallback: {
    making: "Making your {provider} room...",
    sent: "Link sent on {channel} at {time}. Waiting for {name} ({left} left).",
    not_sent: "Not sent: {reason}. Read it out: {link}",
    not_confirmed: "HighLevel did not confirm the WhatsApp template. The link went by email.",
    opened: "{name} opened the link at {time}. Join now.",
    waiting_room: "{name} is in the waiting room. Admit them in Zoom.",
    host_in: "You are in. Waiting for {name} ({left} left).",
    joined_marked: "{name} joined at {time}. The intro is marked shown.",
    joined_booked: "{name} joined. Booked as a live intro and marked shown.",
    joined_not_lead: "{name} joined. Not booked: this contact is not a tagged lead.",
    expired: "Nobody joined in {minutes} minutes. The room is closed. Mark the intro:",
    failed: "{provider} did not make the room: {reason}. Try {other}, or call again.",
    zoom_pending: "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
    zoom_busy: "Your Zoom is in another meeting. End it or use Meet.",
  },
  /** Buttons (F, P1, P2, and C42's "Video call" menu). */
  buttons: {
    open_room: "Open my room",
    copy_link: "Copy link",
    end_room: "End room",
    lead_is_in: "The lead is in",
    not_the_lead: "That was not the lead",
    available: "I'm available",
    join_room: "Join my room",
    go_away: "Go away",
    take: "Take it",
    not_now: "Not now",
    keep_available: "Keep me available",
    stop: "Stop",
    send_video_link: "Send a video link",
    meet: "Meet",
    zoom_instead: "Zoom instead",
    in_the_room: "I'm in the room",
    on_the_phone: "We are on the phone",
    cant_let_in: "I can't let them in",
    also_email: "Also send by email",
    finished: "Finished",
    no_show: "No-show",
    spoke_on_phone: "We spoke on the phone",
    im_in: "I'm in",
    they_joined: "They joined",
    use_meet: "Use Meet",
    open_lead: "Open lead",
    book_demo: "Book a demo",
    book_slot: "Book a slot",
    send_message: "Send a message",
    yes_cancel: "Yes, cancel",
    keep_it: "Keep it",
    send_when_they_write: "Send when they write",
    message_us: "Message us on WhatsApp",
    video_call: "Video call",
    demo_now: "Demo now with a closer",
    intro_now: "Intro now with me",
  },
  /** Availability strip (F "Availability strip"). */
  strip: {
    away: "Away",
    available: "Available until {until}. Join your room to get leads first.",
    ready: "In your room until {until}. The next live lead comes to you.",
    offer: "Live lead: {kind}, {country}, on the line with the setter. Note: {note}. {left} left.",
    taken: "Taken. Sending the link...",
    lost: "{name} took this one.",
    missed: "You missed a live lead at {time} and are now Away.",
    refresh: "Zoom closes a room 40 minutes after only one person is left. Stay available?",
    booked_call: "Your booked demo starts at {time}, so your room is closed. Press I'm available after it.",
  },
  /** The fallback room in the strip and on the lead page (P1 "Strip", "Lead page", "Team page"). */
  strip_fallback: {
    room: "Video room: {name}, {left} left. Open",
    update: "{name} {what}. Open",
    lead_page: "Video room on {provider}: sent {sent}, opened {opened}, joined {joined}.",
    team_zoom_ready: "Zoom: ready",
    team_zoom_pending: "Zoom: the setter's seat is pending",
  },
  /** The setter's handover strip (P2 "Setter strip"). */
  setter_strip: {
    searching: "Finding a closer: {left} left.",
    ready: "The closer is in the room. Link sent by {channel} at {time}.",
    window_closed:
      "WhatsApp is closed for this lead. Ask them to send 'hi' to our WhatsApp and the link goes as soon as they do.",
    read_out: "Read this out: {link}",
    nobody: "Nobody could take it. Book a slot instead.",
    joined: "They are in the room. You can end your call.",
    no_join: "They did not join in {minutes} minutes. The room is closed. Nothing was booked.",
    cancel: "Cancel? The room closes and nothing is booked.",
  },
  /** Health line (F "Health line"). */
  health: {
    working: "Rooms: working. Last run {time}. {rooms} today, {failed} failed.",
    down: "Video rooms are not being made (last check {time}). Call the lead on the phone, or send your own Zoom or Meet link.",
    mismatch: "Zoom and the cockpit disagree on {rooms} today. Open its timeline.",
  },
  /** Slack, app "Mahara Sales" (P2's table replaces F's, C43; the watchdog line is F's). */
  slack: {
    app_home: "Live calls. You are away.",
    app_home_ready: "Ready now: {closers} closers, {setters} setters.",
    available: "You are available until {until}. Opening your room...",
    room_open: "Your room is open. Join it so live leads can come straight to you.",
    in_room: "You are in your room. Ready until {until}.",
    offer:
      "Live demo for you: {name}, {company}, {country}. On the phone with the setter now. Note: {note}. Take it within 2 minutes.",
    taken: "You took it at {time}. Link sent by {channel}. They have 10 minutes to join.",
    lost: "{rep} took this lead at {time}.",
    waiting_room: "{name} is in your waiting room. Admit them in Zoom.",
    joined: "They joined at {time}. Booked and marked shown in HighLevel.",
    no_event: "Zoom has not told us yet. Press when it happens.",
    refresh: "You have waited 35 minutes. Zoom closes a room after 40 minutes alone, so here is a fresh one.",
    booked_empty: "Your booked demo starts at {time}, so your empty room is closed. Press I'm available after it.",
    booked_lead_in: "Your booked demo starts at {time} and this call is still running. Tell the setter if you need cover.",
    missed: "This offer ended at {time}. You are now away. Type /available when you are back.",
    after_call: "Call finished. Ready for the next one?",
    unavailable: "You are away. Live leads will not come to you.",
    unlinked: "Your Slack is not linked to a sales seat. Ask the manager to add your Slack ID on the Team page.",
    watchdog: "The room worker has not run since {time}. New video rooms cannot be made.",
  },
  /** Dialer (P1 "Dialer"). */
  dialer: {
    nobody_spoke: "Nobody spoke. Save it as No answer or Call back, or send a video link.",
    auto: "Sending a video link to {name} in 10 s.",
    picker: "The lead gets the link on {channel}.",
    picker_none: "No message can reach this lead. You can still make the room and read the link out.",
  },
  /** The short page on call.maharamedia.com (F "Lead messages", P1 ended page and unknown code). */
  short_page: {
    opening: "Opening your call with {rep}...",
    zoom_hint: "No Zoom app? Tap Join from your browser.",
    meet_hint: "Meet needs iOS 17 or the Meet app.",
    ended: "This call has ended. Reply to our last message and we will find a new time.",
    ended_fallback:
      "This call has ended. Reply to our last message, or message us on WhatsApp, and we will find a new time.",
    unknown: "This link is not valid. Reply to our message and we will send a new one.",
  },
  /**
   * Lead messages in English. C43: every lead message says "Mahara Media"
   * (F and P2 said "Mahara" in places, changed here). C24: one call_link
   * body for every spec. The Arabic is written under aziz-kuwaiti-voice
   * before launch and is not here.
   */
  lead_en: {
    manual_whatsapp: "Hi {first_name}, your call with {rep} from Mahara Media is ready now. Join here: {link}", // F (manual rooms, C43)
    manual_email_subject: "Your Mahara Media call is ready", // F, C43
    manual_email_body:
      "Hi {first_name}, your call with {rep} is ready now. Join here: {link}. If it does not open, reply to this email and we will call you.", // F
    call_link_template: "Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join.", // C24
    call_link_button: "Join the call", // C24
    call_link_fallback: "Hi {{1}}, your call with {{2}} from Mahara Media is ready. Join here: {{3}} See you there.", // C24
    fallback_booked:
      "Hi {first_name}, it's {rep} from Mahara Media. I just tried to call you for your intro call and couldn't get through. We can do it on video now instead: {link} I'll wait for you for the next 10 minutes. On a phone it opens in the {provider} app or your browser.", // P1
    fallback_unbooked:
      "Hi {first_name}, it's {rep} from Mahara Media. I tried to call you just now and couldn't get through. If you have 15 minutes, we can talk on video now: {link} I'll be there for the next 10 minutes.", // P1
    fallback_email_subject: "I tried to call you: join on video now", // P1
    fallback_email_sign: "{rep}, Mahara Media", // P1
    handover_zoom:
      "Hi {first_name}, {rep} from Mahara Media is ready for you now: {link} It opens in Zoom or your browser. They will let you in within a minute.", // P2, C43
    handover_meet:
      "Hi {first_name}, {rep} from Mahara Media is ready for you now: {link} Press 'Ask to join' and they will let you in.", // P2, C43
    after_reply: "Thanks {first_name}. Are you free for a quick video call now? {rep} is ready: {link}", // P2
    handover_email_subject: "Your call with {rep} is ready", // P2
    handover_email_tail: "If now is not good, reply and we will find a time.", // P2
  },
} as const;

/** Sentences the specs did not set, in the same voice. Each one is for review. */
export const LANE_COPY = {
  /** Zoom's daily cap on the host's meeting creates (desk rooms.py SAY zoom_daily_cap, stress2 round 2). */
  zoom_daily_cap: "Your Zoom user has made its rooms for today (Zoom allows 100 a day); Zoom allows more from 03:00 Kuwait. Use Meet.",
  /** The lead's open room is another seat's (stress2, round 2): never "Open it", which only its host can. */
  lead_has_others_room: "The {role}'s video room for this lead is open until {until}. Call the lead, or send a link after that.",
  disabled: "Video rooms are off for now. Call or message the lead instead.",
  provider_off: "{provider} rooms are off for now. Use {other}.",
  test_only: "Video rooms are in testing, so they work only for the test contact for now.",
  no_contact: "Choose a lead first.",
  contact_unread: "HighLevel did not answer, so we cannot check this lead yet. Try again in a minute.",
  /** HighLevel answered that the contact is not there (merged or deleted): an answer, never retried (stress2, round 1). */
  contact_gone: "This lead is not in HighLevel any more (merged or deleted). Find them again in the cockpit and make the room there.",
  fallback_scope: "For now, video links after a missed call are only for booked intros. Call again or send a message.",
  fallback_pilot: "Video links after a missed call are in a pilot that does not include your seat yet. Ask the manager to add you.",
  wrap_too_early: "This call's room opens at {time}, 30 minutes before it starts. Try again then.",
  host_link:
    "This call's link in HighLevel is the host's start link, which must never reach the lead. Put the meeting's join link in HighLevel, then try again.",
  zoom_missing: "Your email has no Zoom user on Mahara's account. Ask the CEO to add you in Zoom. Meet works now.",
  /** The seat's Zoom or Meet was not checked yet (no host row, or no value yet): the host check runs every 10 minutes. */
  zoom_unchecked: "Zoom is not checked for your seat yet. Try again in 10 minutes, or use Meet.",
  meet_unchecked: "Meet is not checked for your seat yet. Try again in 10 minutes, or use Zoom.",
  // The Zoom refusals when Meet cannot be used either (off, or no Google token): no "use Meet" advice.
  zoom_missing_no_meet: "Your email has no Zoom user on Mahara's account. Ask the CEO to add you in Zoom.",
  zoom_unchecked_no_meet: "Zoom is not checked for your seat yet. Try again in 10 minutes, or call the lead.",
  // The Meet refusals when Zoom cannot be used either: no "use Zoom" advice.
  meet_unchecked_no_zoom: "Meet is not checked for your seat yet. Try again in 10 minutes, or call the lead.",
  no_google_no_zoom: "Meet rooms are down until the CEO reconnects Google on the room worker. Call the lead for now.",
  zoom_pending_no_meet: "Your Zoom seat is not active yet. Accept Zoom's email invite.",
  zoom_busy_no_meet: "Your Zoom is in another meeting. End it first.",
  zoom_basic_demo_no_meet:
    "The closer's Zoom is Basic and ends at 40 minutes, too short for a demo. Ask the manager for a Zoom licence.",
  ended_mark_intro: "Nobody joined. The room is closed. Mark the intro:",
  offer_intro:
    "Live intro for you: {name}, {company}, {country}. On the phone with the setter now. Note: {note}. Take it within 2 minutes.",
  app_home_ready: "Ready now: {closers}, {setters}.",
  not_lead_late: "They joined more than {minutes} minutes ago, so this cannot be undone here. Fix the call in HighLevel.",
  too_early: "The room is not ready yet. Try again in a moment.",
  final: "This room has closed.",
  no_lead: "This room has no lead yet.",
  not_standby: "This room already has a lead.",
  not_requested: "Another worker already took this room.",
  not_claimed: "Claim the room before saving its link.",
  already_open: "This room is already open.",
  bad_link: "The room link is not a web address.",
  bad_input: "Something in this request is not right. Reload the page and try again.",
  call_over: "This call has already ended. There is no link to send.",
  call_nearly_over:
    "This call ends in under {minutes} minutes, so a room would close before the lead could join. Send the lead the call's own link.",
  take_host_busy: "You already have a live call or room open. End it, then take the next lead.",
  booked_other_rep: "This call is booked with another rep. Only they or a manager can make a room for it.",
  worker_late: "The room worker did not pick this room up in time.",
  worker_lost: "The room worker stopped half way through making this room.",
  worker_failed: "The room could not be made.",
  room_closed: "Room closed.",
  joined: "{name} joined at {time}.",
  health_never: "Video rooms are not being made: the room worker has not run yet. Call the lead on the phone, or send your own Zoom or Meet link.",
  worker_down: "Video rooms are down right now. Call the lead on the phone, or send your own Zoom or Meet link.",
  health_working_no_counts: "Rooms: working. Last run {time}.",
  health_mismatch_many: "Zoom and the cockpit disagree on {rooms} today. Open their timelines.",
  watchdog_never: "The room worker has never run. New video rooms cannot be made.",
  why_wa_off: "WhatsApp is off for video links",
  why_no_phone: "the lead has no phone number",
  why_wa_dnd: "do not disturb is on for WhatsApp",
  why_wa_gate: "WhatsApp waits for the single-copy test",
  why_wa_paused: "WhatsApp is paused after two identical messages",
  why_wa_health: "WhatsApp video links are failing",
  why_window: "the WhatsApp window is closed",
  why_no_template: "no call link template is live",
  why_template_waiting: "an earlier WhatsApp template to this lead has not arrived yet",
  why_no_short_link: "the short link is not live yet",
  why_email_off: "email is off for video links",
  why_no_email: "the lead has no email address",
  why_email_dnd: "do not disturb is on for email",
} as const;

/** Marks where an empty value was, so the comma or space before it can go too. A private-use character, never in copy. */
const GONE = "\uE000";

/**
 * Puts values into a sentence's {placeholders}. A key that was not passed
 * stays as it is (a later fill, or a template's {{1}} slot, which is left
 * alone). A key passed as empty (null, undefined or "") is a value too: its
 * placeholder goes, with the comma or space that led to it, so a screen
 * never shows a raw "{device}" or "Sara, , Kuwait". A clause that reads
 * badly without its value is left out by the builders below instead.
 */
export function fill(text: string, vars: Record<string, string | number | null | undefined> = {}): string {
  let gone = false;
  const out = text.replace(/\{([a-z_]+)\}/g, (all, k: string) => {
    if (!Object.hasOwn(vars, k)) return all;
    const v = vars[k];
    if (v === null || v === undefined || v === "") {
      gone = true;
      return GONE;
    }
    return String(v);
  });
  if (!gone) return out;
  return out
    .replace(/,[ \t]*\uE000(?=[ \t]*(?:[,.;:!?)]|$))/g, "")
    .replace(/\uE000[ \t]*,[ \t]*/g, "")
    .replace(/[ \t]+\uE000(?=[,.;:!?)]|$)/g, "")
    .replace(/\uE000[ \t]+/g, "")
    .replaceAll(GONE, "");
}

// ---------------------------------------------------------------------------
// Times. Every time a person reads is Kuwait time (UTC+3, no summer time).
// ---------------------------------------------------------------------------

export function ms(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
export function iso(t: number): string {
  return new Date(t).toISOString();
}
function isoOrNull(v: unknown): string | null {
  const t = ms(v);
  return t === null ? null : iso(t);
}
/**
 * When an event happened: the time Zoom (or the door, or the message
 * service) gave it, so a replayed event is stamped with when it happened,
 * not when it was handled. A missing time, one ahead of the server clock, or
 * one more than a day old reads as now.
 */
export function eventTime(at: unknown, now: number): number {
  const t = ms(at);
  if (t === null || t > now + CLOCK_SKEW_S * S || now - t > REPLAY_MAX_AGE_S * S) return now;
  return Math.min(t, now);
}
function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** "14:02", Kuwait time. */
export function kuwaitClock(t: number): string {
  const d = new Date(t + KUWAIT);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "14:03:58", Kuwait time. */
export function kuwaitClockSeconds(t: number): string {
  const d = new Date(t + KUWAIT);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
export function kuwaitDay(t: number): string {
  return new Date(t + KUWAIT).toISOString().slice(0, 10);
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "13:52", or "13:52 on Fri 2 Oct" when it was not today in Kuwait. */
export function clockWithDay(t: number, now: number): string {
  if (kuwaitDay(t) === kuwaitDay(now)) return kuwaitClock(t);
  const d = new Date(t + KUWAIT);
  return `${kuwaitClock(t)} on ${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "9:12" for what is left; never below 0:00. */
export function countdown(left: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(left) ? left : 0) / S));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// ---------------------------------------------------------------------------
// The join code, titles and the short link
// ---------------------------------------------------------------------------

/** A-H, J-N, P-Z and 2-9: 32 characters, none that reads as another (no I, O, 0, 1). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
/** 32^6 = 1,073,741,824 codes. */
export const CODE_SPACE = CODE_ALPHABET.length ** CODE_LENGTH;

export type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = n => crypto.getRandomValues(new Uint8Array(n));

/**
 * A new join code. 256 is a multiple of 32, so the low five bits of a random
 * byte pick every character with the same chance. The unique index on
 * `rooms.code` catches the rare repeat; the caller draws again.
 */
export function makeCode(random: RandomBytes = cryptoBytes): string {
  const bytes = random(CODE_LENGTH);
  if (!bytes || bytes.length < CODE_LENGTH) throw new Error("A join code needs 6 random bytes.");
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

export function isCode(v: unknown): v is string {
  return typeof v === "string" && CODE_RE.test(v);
}

/** A code as a person or a path gives it ("k7q2mx", "K7Q-2MX", "call.maharamedia.com/K7Q2MX/"), or null. */
export function parseCode(input: unknown): string | null {
  let s = typeof input === "string" ? input.trim() : "";
  if (!s || s.length > 200) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^call\.maharamedia\.com\/+/i, "");
  s = (s.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  s = s.replace(/[\s-]/g, "").toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

/** The Zoom topic and the Google event title: the code only, never a name. */
export function roomTitle(code: string): string {
  return `Mahara call ${code}`;
}
/** The code inside a Zoom topic, for recovering a room the worker lost track of. */
export function codeFromTopic(topic: unknown): string | null {
  const m = /\bMahara call ([A-HJ-NP-Z2-9]{6})\b/.exec(String(topic ?? ""));
  return m ? (m[1] ?? null) : null;
}

export const SHORT_HOST = "call.maharamedia.com";

const ZOOM_HOST = /(^|\.)zoom(gov)?\.(us|com)$/i;

/**
 * A host's own link: a Zoom start link (/s/{id}, /wc/{id}/start) or any
 * link carrying a zak token. It starts the meeting as the host, so it may
 * reach only the host, through room.open and room_secrets; never a
 * join_url, a RoomView, the short link or a message.
 */
export function isHostLink(v: unknown): boolean {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return false;
  if (/[?&;#]zak=/i.test(s)) return true;
  try {
    const u = new URL(s);
    return ZOOM_HOST.test(u.hostname) && (/^\/s\//i.test(u.pathname) || /\/start(\/|$)/i.test(u.pathname));
  } catch {
    return /zoom(gov)?\.(us|com)\/s\//i.test(s);
  }
}

/** A link a lead may be given: https, a host name, at most 2,000 characters, and never a host's start link. */
function safeUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 2000 || !/^https:\/\/\S+$/i.test(s)) return null;
  if (isHostLink(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname ? s : null;
  } catch {
    return null;
  }
}

/**
 * Text a person or a log will see (a worker's or provider's error): through
 * lib's redact (keys, tokens, JWTs; 300 characters), after taking out Zoom
 * start links and zak tokens, which lib's redact does not know.
 */
export function redactRoom(v: unknown): string | null {
  const s = typeof v === "string" ? v.replaceAll("\u0000", "").trim().slice(0, 4000) : "";
  if (!s) return null;
  const cleaned = s
    .replace(/https?:\/\/[^\s"'<>]*zoom(?:gov)?\.(?:us|com)\/(?:s\/|wc\/[^\s"'<>]*\/start)[^\s"'<>]*/gi, "[host link]")
    .replace(/([?&;#]zak=)[^&\s"'<>]+/gi, "$1[key]");
  return redact(cleaned).trim() || null;
}

/** `https://call.maharamedia.com/{code}` when the short link is on, else the room's own link (contract). */
export function shortUrl(code: unknown, joinUrl: unknown, shortLink: boolean): string | null {
  if (shortLink && isCode(code)) return `https://${SHORT_HOST}/${code}`;
  return safeUrl(joinUrl);
}

/** The link as a rep reads it out: "call.maharamedia.com/K7Q2MX". */
export function readOutLink(code: unknown, joinUrl: unknown, shortLink: boolean): string | null {
  const u = shortUrl(code, joinUrl, shortLink);
  return u ? u.replace(/^https:\/\//i, "") : null;
}

export type LinkTarget =
  | { kind: "join"; url: string; room_id: string }
  | { kind: "pending"; room_id: string }
  | { kind: "ended"; room_id: string }
  | { kind: "unknown" };

/**
 * Where the short link sends a lead right now. A booked room wraps the
 * closer's own meeting, which we never end, so its link works until ends_at
 * even after the room closed (C14).
 */
export function shortLinkTarget(room: RoomRow | null | undefined, now: number): LinkTarget {
  if (!room || !isRoomState(room.state)) return { kind: "unknown" };
  const url = safeUrl(room.join_url);
  if (room.state === "requested" || room.state === "creating") return { kind: "pending", room_id: room.id };
  if (!isFinal(room.state)) return url ? { kind: "join", url, room_id: room.id } : { kind: "pending", room_id: room.id };
  const ends = ms(room.ends_at);
  if (room.purpose === "booked" && room.state !== "cancelled" && url && ends !== null && now < ends)
    return { kind: "join", url, room_id: room.id };
  return { kind: "ended", room_id: room.id };
}

/**
 * The short link follows a replaced room (`replaced_by`), at most three
 * steps, so a handover re-routed after the link went out still lands.
 */
export function resolveShortLink(
  code: unknown,
  find: (by: { code?: string; id?: string }) => RoomRow | null | undefined,
  now: number,
): LinkTarget {
  const c = parseCode(code);
  if (!c) return { kind: "unknown" };
  let room = find({ code: c }) ?? null;
  if (!room) return { kind: "unknown" };
  const seen = new Set<string>([room.id]);
  for (let hop = 0; hop < 3; hop++) {
    const t = shortLinkTarget(room, now);
    if (t.kind !== "ended" || !room?.replaced_by || seen.has(room.replaced_by)) return t;
    const next: RoomRow | null = find({ id: room.replaced_by }) ?? null;
    if (!next) return t;
    seen.add(next.id);
    room = next;
  }
  return shortLinkTarget(room, now);
}

// ---------------------------------------------------------------------------
// The room row
// ---------------------------------------------------------------------------

/** A `cockpit_sales_rooms` row as the server reads it. Times are ISO strings or null. */
export interface RoomRow {
  id: string;
  code: string;
  contact_id: string | null;
  purpose: Purpose;
  call_kind: CallKind;
  provider: Provider;
  host_email: string;
  state: RoomState;
  version: number;
  request_id?: string | null;
  trigger?: string | null;
  made_by?: string | null;
  appointment_id?: string | null;
  /** The booked intro's start when the room was made, so a later move of that intro is never settled by this room. */
  appointment_start_at?: string | null;
  handover_id?: string | null;
  replaced_by?: string | null;
  attempt_id?: string | null;
  error?: string | null;
  result?: RoomResult | null;
  settled_mark?: SettledMark | null;
  provider_meeting_id?: string | null;
  join_url?: string | null;
  send_on?: SendOn | null;
  host_by?: string | null;
  lead_by?: string | null;
  ends_at?: string | null;
  requested_at?: string | null;
  claimed_at?: string | null;
  opened_at?: string | null;
  /** Set in the same write that asks for the link, so the link is asked for once (new column). */
  link_claimed_at?: string | null;
  link_sent_at?: string | null;
  first_open_at?: string | null;
  lead_waiting_at?: string | null;
  host_in_at?: string | null;
  lead_in_at?: string | null;
  /**
   * When the room first showed "The lead is in" (20261003d). A Zoom join
   * read late (an outage, the sweep's replay) keeps its own time in
   * lead_in_at; "That was not the lead" is measured from whichever is later,
   * so the host always has their five minutes from what the panel showed.
   */
  lead_in_seen_at?: string | null;
  ended_at?: string | null;
  open_device?: string | null;
  link_message_ids?: unknown;
  link_channels?: unknown;
  count_claimed_at?: string | null;
  count_appointment_id?: string | null;
  count_result?: CountResult | null;
  /** "That was not the lead": when it was pressed. A count that finishes after it undoes itself (new column). */
  count_undo_at?: string | null;
  /** A WhatsApp template was not seen within rooms.waits_s.unconfirmed, so email went too (new column). */
  link_unconfirmed_at?: string | null;
  /**
   * When Zoom said the meeting ended while the room went back to open (the
   * host left before the lead came, F9). A lead join Zoom delivers late from
   * before it then ends the room joined (stress2, round 2; 20261004a).
   */
  meeting_ended_at?: string | null;
  /** Why the link could not go, one sentence (the message service). */
  refusal?: string | null;
  /** The lead's first name when the room was made, for the panel. */
  contact_first_name?: string | null;
  /** Why the room is final, as the sweep or the claim wrote it. */
  end_reason?: string | null;
  last_open_at?: string | null;
  worker_run?: string | null;
  created_at?: string | null;
}

const ver = (room: RoomRow) => {
  const n = Number(room.version);
  return Number.isFinite(n) ? n : 0;
};
/** A standby room nobody has been given yet. */
export function standbyEmpty(room: RoomRow): boolean {
  return room.purpose === "standby" && !room.contact_id;
}

/**
 * The lead really joined: lead_in_at is set and "That was not the lead" did
 * not take that join back. lead_in_at itself is kept after an undo, as
 * evidence and so no provider call is ever made for that room.
 */
export function leadJoined(room: RoomRow): boolean {
  const joined = ms(room.lead_in_at);
  if (joined === null) return false;
  const undo = ms(room.count_undo_at);
  return undo === null || joined > undo;
}

/**
 * A join at `t` is the one "That was not the lead" took back, delivered
 * again (Zoom sends participant_jbh_joined beside participant_joined, and
 * the sweep replays a join whose first handling lost its finish): at or
 * before the taken-back join's own time. The guard in 20261003d keeps
 * lead_in_at on that press; under 20261003a's guard (it cleared lead_in_at)
 * the press's own time bounds it, since every join before the press is one
 * the host already saw.
 */
export function takenBack(room: RoomRow, t: number): boolean {
  const undo = ms(room.count_undo_at);
  if (undo === null) return false;
  const joined = ms(room.lead_in_at);
  if (joined !== null && joined > undo) return false;
  return t <= (joined ?? undo);
}

/** A count was claimed and has not written its result yet (a mark writes count_appointment_id). */
export function countInFlight(room: RoomRow): boolean {
  return Boolean(room.count_claimed_at) && !room.count_result && !room.count_appointment_id;
}

/** A booking or mark the count made still stands (an undo has something to take back). */
export function countStands(room: RoomRow): boolean {
  if (!room.count_claimed_at) return false;
  if (room.count_result === "booked" || room.count_result === "moved") return true;
  return !room.count_result && Boolean(room.count_appointment_id);
}

// ---------------------------------------------------------------------------
// Deadlines (consistency check 1.9)
// ---------------------------------------------------------------------------

/** How long the host has to get in once the room is open: 120 s handover, 300 s standby, 900 s fallback or manual. */
export function hostWaitS(purpose: Purpose, w: Waits): number {
  if (purpose === "handover") return w.handover_host;
  if (purpose === "standby") return w.standby_host;
  return w.fallback_host;
}
function lengthMs(kind: CallKind, ctx: RoomCtx): number {
  return (ctx.lengths_min[kind] ?? (kind === "demo" ? 60 : 30)) * MIN;
}
/** The later of a stored deadline and a new one: deadlines never move earlier. */
function laterIso(cur: unknown, cand: number): string {
  const c = ms(cur);
  return iso(c === null ? cand : Math.max(c, cand));
}

/** A booked room's deadlines from its appointment: host by start + 15, lead by start + 20, ends at the appointment's end (1.9, C14). */
export function bookedDeadlines(
  start: number,
  end: number | null,
  kind: CallKind,
  ctx: RoomCtx,
): { host_by: string; lead_by: string; ends_at: string } {
  return {
    host_by: iso(start + BOOKED_HOST_MIN * MIN),
    lead_by: iso(start + BOOKED_LEAD_MIN * MIN),
    ends_at: iso(end !== null && end > start ? end : start + lengthMs(kind, ctx)),
  };
}

export type SweepReason =
  | "fail"
  | "recover"
  | "host_by"
  | "lead_by"
  | "standby_max"
  | "booked_guard"
  | "availability"
  | "no_end_signal";

/**
 * The timers running on a room, each with when it fires. Every room that is
 * not final has at least one, so nothing can wait forever. Where a stored
 * deadline is missing (a damaged row), the spec's wait from the room's own
 * times stands in.
 *
 * - requested: fail at requested + 60 s.
 * - creating: recover at claimed + 60 s (the worker looks for the code in
 *   Zoom's topics or the Google event id), failed at claimed + 120 s. A
 *   room whose link the worker saved but whose worker.ready never landed
 *   is recovered at claimed + 15 s: the sweep opens it.
 * - open: host_by; lead_by when the room has a lead; standby_max for an
 *   empty standby room.
 * - host_in: lead_by when the room has a lead, else standby_max.
 * - lead_in: only no_end_signal, at ends_at + 1,800 s.
 */
export function timers(room: RoomRow, ctx: RoomCtx): { reason: SweepReason; at: number }[] {
  const w = ctx.waits;
  const opened = ms(room.opened_at) ?? ms(room.requested_at) ?? ms(room.created_at) ?? 0;
  switch (room.state) {
    case "requested":
      return [{ reason: "fail", at: (ms(room.requested_at) ?? ms(room.created_at) ?? 0) + w.fail * S }];
    case "creating": {
      const base = ms(room.claimed_at) ?? ms(room.requested_at) ?? ms(room.created_at) ?? 0;
      return [
        { reason: "recover", at: base + (safeUrl(room.join_url) ? w.ready : w.fail) * S },
        { reason: "fail", at: base + 2 * w.fail * S },
      ];
    }
    case "open": {
      const out: { reason: SweepReason; at: number }[] = [
        { reason: "host_by", at: ms(room.host_by) ?? opened + hostWaitS(room.purpose, w) * S },
      ];
      if (room.contact_id)
        out.push({ reason: "lead_by", at: ms(room.lead_by) ?? (ms(room.link_sent_at) ?? opened) + w.lead * S });
      if (standbyEmpty(room)) out.push({ reason: "standby_max", at: opened + w.standby_max * S });
      return out;
    }
    case "host_in":
      if (room.contact_id)
        return [
          {
            reason: "lead_by",
            at: ms(room.lead_by) ?? (ms(room.link_sent_at) ?? ms(room.host_in_at) ?? opened) + w.lead * S,
          },
        ];
      return [{ reason: "standby_max", at: opened + w.standby_max * S }];
    case "lead_in": {
      const ends = ms(room.ends_at) ?? (ms(room.lead_in_at) ?? opened) + lengthMs(room.call_kind, ctx);
      return [{ reason: "no_end_signal", at: ends + w.no_end_signal * S }];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface Actor {
  email: string;
  /** A manager or the CEO, who can end any room. */
  manager?: boolean;
}

/**
 * When the event happened, as its source gave it: Zoom's participant
 * join_time or leave_time, or its event_ts; the door's or the message
 * service's own clock. A person's press ignores it (the server's clock wins).
 */
type At = { at?: string | number | null };

export type RoomEvent =
  /** The worker's conditional claim: requested → creating. */
  | { kind: "claim"; worker_run?: string | null }
  /**
   * worker.ready: creating → open. The worker saved join_url and
   * provider_meeting_id on the creating row (guarded by its worker_run);
   * sales-api applies this, sets the deadlines and asks for the link once.
   * Without join_url the row's own is used.
   */
  | { kind: "ready"; join_url?: string | null; provider_meeting_id?: string | null }
  /** worker.failed: the provider refused, or the worker gave up: requested or creating → failed. */
  | { kind: "fail"; error: string }
  /** The message service sent the link (the first send starts the lead's 10 minutes). */
  | ({
      kind: "link_sent";
      channel?: LinkChannel | null;
      /**
       * The send was a WhatsApp template nobody saw yet: link_unconfirmed_at
       * is written in the same step as link_sent_at, so a run cut off after
       * this write never leaves a sure send behind (stress2, round 1).
       */
      unconfirmed?: boolean;
    } & At)
  /** The short page counted an open (bots excluded). */
  | ({ kind: "opened"; device?: Device | null } & At)
  /** Zoom put the lead in the waiting room. */
  | ({ kind: "lead_waiting" } & At)
  /** Zoom's host joined, or the rep's "I'm in". */
  | ({ kind: "host_in"; source: "zoom" | "mark"; actor?: Actor; version?: number } & At)
  /** Zoom's host left before the lead came. */
  | ({ kind: "host_left" } & At)
  /** A Zoom join from outside the account, or the rep's "The lead is in". */
  | ({ kind: "lead_in"; source: "zoom" | "mark"; actor?: Actor; version?: number } & At)
  /** "That was not the lead", within 5 minutes of the join, also once the room has closed. */
  | { kind: "not_lead"; actor?: Actor; version?: number }
  /**
   * "Still on it", the answer to "Still on the call?" (fix round 4): the
   * room's end moves to STILL_ON_ASK_AGAIN_S from now, so the sweep's R7
   * (ends_at + no_end_signal) counts from the rep's last answer.
   */
  | { kind: "still_on"; actor?: Actor; version?: number }
  /** room.end, or the system ending a room. */
  | { kind: "end"; reason: EndReason; actor?: Actor; version?: number; confirm?: boolean }
  /** Zoom's meeting.ended. */
  | ({ kind: "meeting_ended" } & At)
  /** Zoom's meeting.deleted: the host deleted the room's meeting in Zoom (stress2, round 2). */
  | ({ kind: "meeting_deleted" } & At)
  /** Take on a standby room: the lead is set and the room becomes a handover. Run adoptRefusal first. */
  | { kind: "adopt"; contact_id: string; call_kind: CallKind; handover_id?: string | null; actor?: Actor }
  /**
   * The sweep (room.event {kind: tick}), with what it read for this room:
   * - next_booked_start: the host's next booked call, if one is near;
   * - pending_events: this room's unhandled room_events still within the
   *   replay age (undefined: not counted, read as 0; null or anything not a
   *   count: could not be read, so timers wait, at most 5 minutes);
   * - available_until: for a standby room, the host's availability (null:
   *   away or run out; undefined: not given, so no fresh standby room).
   */
  | {
      kind: "tick";
      next_booked_start?: number | null;
      pending_events?: number | null;
      available_until?: string | number | null;
      /**
       * Who owns the timers (contract v2, S1). "sql": cockpit_sales_rooms_sweep()
       * moves every state on its timers, so this tick moves none and only
       * returns the re-asks and alerts SQL cannot do. Left out, roomlogic's own
       * timers fire (the reference model the tests drive).
       */
      owner?: "sql" | null;
    };

export const ROOM_EVENT_KINDS = [
  "claim",
  "ready",
  "fail",
  "link_sent",
  "opened",
  "lead_waiting",
  "host_in",
  "host_left",
  "lead_in",
  "not_lead",
  "still_on",
  "end",
  "meeting_ended",
  "meeting_deleted",
  "adopt",
  "tick",
] as const;

/**
 * What the caller must do after a change is written (or at once, for a
 * tick that changed nothing).
 * - send_link: the message service, with request_id = the room id, so a
 *   re-ask (retry) can never send a second message.
 * - close_provider: the worker ends or deletes the meeting, and never while
 *   Zoom shows anyone in it but the host.
 * - count_live: claim, then book or mark (countClaim, countLive, countFinish).
 * - undo_count: countUndo on the row as it is read now; nothing while the
 *   count is still in flight (the count undoes itself when it finishes).
 * - retry: the sweep asking again for something a crash lost.
 */
export type Effect =
  | { kind: "send_link"; retry?: true }
  /** The link was due and never claimed: claim it with a guarded write, then send (the sweep's re-ask). */
  | { kind: "claim_link" }
  | { kind: "close_provider" }
  | { kind: "delete_secret" }
  | { kind: "count_live"; retry?: true }
  | { kind: "undo_count"; retry?: true }
  | { kind: "recover" }
  | { kind: "refresh_standby" }
  | { kind: "replace"; provider: Provider }
  | { kind: "alert"; what: "booked_guard" | "count_stuck"; dedupe_key: string };

export interface Changed {
  ok: true;
  /** False when the event changes nothing (a duplicate, or a timer not due). */
  changed: boolean;
  from: RoomState;
  to: RoomState;
  room: RoomRow;
  /** The columns to write. */
  patch: Partial<RoomRow>;
  /**
   * What the write must still find, for a conditional PATCH: the state, the
   * version on a state change, and the old value of every column it writes.
   * An empty answer means someone else got there first: read again and
   * apply again. This keeps deadlines from moving back under concurrency.
   */
  expect: Partial<RoomRow>;
  effects: Effect[];
  reason: SweepReason | null;
}

export type RefusalCode =
  | "stale"
  | "not_host"
  | "confirm_end"
  | "not_lead_late"
  | "final"
  | "too_early"
  | "not_requested"
  | "not_claimed"
  | "already_open"
  | "bad_link"
  | "bad_input"
  | "no_lead"
  | "not_standby"
  | "no_contact"
  | "contact_unread"
  | "contact_gone"
  | "disabled"
  | "provider_off"
  | "test_only"
  | "client"
  | "dnd"
  | "booked_demo"
  | "fallback_scope"
  | "fallback_pilot"
  | "lead_has_room"
  | "host_has_room"
  | "zoom_busy"
  | "zoom_basic_demo"
  | "zoom_pending"
  | "zoom_capped"
  | "zoom_missing"
  | "zoom_unchecked"
  | "meet_unchecked"
  | "no_google"
  | "meet_pending"
  | "phone_call"
  | "host_link"
  | "call_over"
  | "call_nearly_over"
  | "take_host_busy"
  | "booked_other_rep"
  | "wrap_too_early"
  | "worker_down";

export interface Refused {
  ok: false;
  code: RefusalCode;
  message: string;
  status: number;
  /** True when the same event may succeed later (an early Zoom event): leave it unhandled for the replay. */
  retry: boolean;
  /** True when the worker made a meeting for a room that has since closed: it deletes the meeting. */
  cleanup: boolean;
}

export type Applied = Changed | Refused;

const R = ROOM_COPY.refusals;
const REFUSALS: Record<RefusalCode, { text: string; status: number; retry?: boolean }> = {
  stale: { text: R.stale, status: 409 },
  not_host: { text: R.not_host, status: 403 },
  confirm_end: { text: R.confirm_end, status: 409 },
  not_lead_late: { text: LANE_COPY.not_lead_late, status: 409 },
  final: { text: LANE_COPY.final, status: 409 },
  too_early: { text: LANE_COPY.too_early, status: 409, retry: true },
  not_requested: { text: LANE_COPY.not_requested, status: 409 },
  not_claimed: { text: LANE_COPY.not_claimed, status: 409, retry: true },
  already_open: { text: LANE_COPY.already_open, status: 409 },
  bad_link: { text: LANE_COPY.bad_link, status: 400 },
  bad_input: { text: LANE_COPY.bad_input, status: 400 },
  no_lead: { text: LANE_COPY.no_lead, status: 409 },
  not_standby: { text: LANE_COPY.not_standby, status: 409 },
  no_contact: { text: LANE_COPY.no_contact, status: 400 },
  contact_unread: { text: LANE_COPY.contact_unread, status: 503, retry: true },
  contact_gone: { text: LANE_COPY.contact_gone, status: 409 },
  disabled: { text: LANE_COPY.disabled, status: 409 },
  provider_off: { text: LANE_COPY.provider_off, status: 409 },
  zoom_capped: { text: LANE_COPY.zoom_daily_cap, status: 409 },
  test_only: { text: LANE_COPY.test_only, status: 409 },
  client: { text: R.client, status: 409 },
  dnd: { text: R.dnd, status: 409 },
  booked_demo: { text: R.booked_demo, status: 409 },
  fallback_scope: { text: LANE_COPY.fallback_scope, status: 409 },
  fallback_pilot: { text: LANE_COPY.fallback_pilot, status: 403 },
  lead_has_room: { text: R.lead_has_room, status: 409 },
  host_has_room: { text: R.host_has_room, status: 409 },
  zoom_busy: { text: R.zoom_busy, status: 409 },
  zoom_basic_demo: { text: R.zoom_basic_demo, status: 409 },
  zoom_pending: { text: R.zoom_pending, status: 409 },
  zoom_missing: { text: LANE_COPY.zoom_missing, status: 409 },
  zoom_unchecked: { text: LANE_COPY.zoom_unchecked, status: 409 },
  meet_unchecked: { text: LANE_COPY.meet_unchecked, status: 409 },
  no_google: { text: R.no_google, status: 409 },
  meet_pending: { text: R.meet_pending, status: 502 },
  phone_call: { text: R.phone_call, status: 409 },
  host_link: { text: LANE_COPY.host_link, status: 409 },
  call_over: { text: LANE_COPY.call_over, status: 409 },
  call_nearly_over: { text: LANE_COPY.call_nearly_over, status: 409 },
  take_host_busy: { text: LANE_COPY.take_host_busy, status: 409 },
  booked_other_rep: { text: LANE_COPY.booked_other_rep, status: 403 },
  wrap_too_early: { text: LANE_COPY.wrap_too_early, status: 409, retry: true },
  worker_down: { text: LANE_COPY.worker_down, status: 503 },
};

/** The Zoom refusals without their "use Meet" advice, for a host who cannot use Meet either. */
const NO_MEET: Partial<Record<RefusalCode, string>> = {
  zoom_missing: LANE_COPY.zoom_missing_no_meet,
  zoom_unchecked: LANE_COPY.zoom_unchecked_no_meet,
  zoom_pending: LANE_COPY.zoom_pending_no_meet,
  zoom_busy: LANE_COPY.zoom_busy_no_meet,
  zoom_basic_demo: LANE_COPY.zoom_basic_demo_no_meet,
};

/** The refusal for a code, its sentence filled in. A fallback room's "already open" uses P1's words. */
export function refuse(
  code: RefusalCode,
  vars: Record<string, string | number | null | undefined> = {},
  purpose?: Purpose | null,
): Refused {
  const r = REFUSALS[code];
  const text = code === "lead_has_room" && purpose === "fallback" ? R.lead_has_room_fallback : r.text;
  return { ok: false, code, message: fill(text, vars), status: r.status, retry: r.retry === true, cleanup: false };
}

function hostFirstName(room: RoomRow, ctx: RoomCtx): string {
  const given = greetingName(ctx.host_first_name, null);
  if (given) return given;
  const local = String(room.host_email ?? "").split("@")[0] ?? "";
  const first = local.split(/[._-]+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "another rep";
}

function mayAct(room: RoomRow, actor: Actor): boolean {
  return actor.manager === true || (lower(actor.email) !== "" && lower(actor.email) === lower(room.host_email));
}

/** A provider meeting may be ended or deleted only for a room no lead ever reached and that is not someone's booked meeting (C14, C15, H7). */
export function mayCloseProvider(room: RoomRow): boolean {
  return room.purpose !== "booked" && !room.lead_in_at && room.state !== "requested";
}

function finalEffects(room: RoomRow): Effect[] {
  const out: Effect[] = [{ kind: "delete_secret" }];
  if (mayCloseProvider(room)) out.push({ kind: "close_provider" });
  return out;
}

/**
 * The link is due: the room has a lead and a link a lead may get, nothing
 * was asked for or sent yet, and the room is at its `send_on` point (C20).
 * Whoever writes the change that makes it due also writes link_claimed_at,
 * in the same conditional write, so two writers can never both ask.
 */
export function linkDue(room: RoomRow): boolean {
  if (!room.contact_id || room.link_sent_at || room.link_claimed_at || !safeUrl(room.join_url)) return false;
  if (room.purpose === "booked" || room.purpose === "standby") return false;
  if (room.send_on === "host_in") return room.state === "host_in";
  return room.state === "open" || room.state === "host_in";
}

/** Adds the link's claim and the send to a change that makes the link due. */
function claimLink(next: RoomRow, patch: Partial<RoomRow>, effects: Effect[], at: string): void {
  if (!linkDue(next)) return;
  patch.link_claimed_at = at;
  effects.push({ kind: "send_link" });
}

function change(
  room: RoomRow,
  to: RoomState,
  patch: Partial<RoomRow>,
  effects: Effect[],
  reason: SweepReason | null = null,
  bump = false,
): Changed {
  const from = room.state;
  const p: Partial<RoomRow> = { ...patch };
  if (to !== from) p.state = to;
  if (bump || to !== from) p.version = ver(room) + 1;
  const expect: Partial<RoomRow> = { state: from };
  if (p.version !== undefined) expect.version = ver(room);
  const before = room as unknown as Row;
  const want = expect as unknown as Row;
  for (const k of Object.keys(patch)) if (k !== "state" && k !== "version") want[k] = before[k] ?? null;
  return { ok: true, changed: true, from, to, room: { ...room, ...p }, patch: p, expect, effects, reason };
}

function same(room: RoomRow, effects: Effect[] = [], reason: SweepReason | null = null): Changed {
  return { ok: true, changed: false, from: room.state, to: room.state, room, patch: {}, expect: {}, effects, reason };
}

/** The latest time the open grace may move lead_by to: the lead's 10 minutes plus one grace (F18), or a booked call's end. */
function graceCap(room: RoomRow, w: Waits): number | null {
  if (room.purpose === "booked") return ms(room.ends_at);
  const base = ms(room.link_sent_at) ?? ms(room.opened_at);
  return base === null ? null : base + (w.lead + w.open_grace) * S;
}

/** creating (or a row an older worker opened itself) → open: the deadlines, and the link asked for once. */
function openRoom(
  room: RoomRow,
  to: RoomState,
  url: string,
  meetingId: unknown,
  now: number,
  ctx: RoomCtx,
  reason: SweepReason | null = null,
): Changed {
  const w = ctx.waits;
  const at = iso(now);
  const patch: Partial<RoomRow> = {
    opened_at: at,
    join_url: url,
    provider_meeting_id: str(meetingId, 200) ?? room.provider_meeting_id ?? null,
  };
  if (room.purpose !== "booked") {
    patch.host_by = laterIso(room.host_by, now + hostWaitS(room.purpose, w) * S);
    if (room.contact_id) patch.lead_by = laterIso(room.lead_by, (ms(room.link_sent_at) ?? now) + w.lead * S);
    patch.ends_at = laterIso(room.ends_at, now + lengthMs(room.call_kind, ctx));
  }
  const effects: Effect[] = [];
  claimLink({ ...room, ...patch, state: to }, patch, effects, at);
  return change(room, to, patch, effects, reason);
}

/**
 * worker.ready on a room the worker already set open (contract v2, S2): the
 * worker opens the room itself and writes opened_at, host_by and ends_at
 * where they were unset, but never lead_by and never the link's claim. Two
 * steps, in one guarded write:
 * 1. only the deadlines that are missing: lead_by when the room has a lead,
 *    host_by and ends_at (an older worker's row also gets opened_at);
 * 2. the link's claim, when linkDue.
 * A repeat finds nothing missing and the claim taken, and changes nothing.
 */
function readyOnOpen(room: RoomRow, meetingId: unknown, now: number, ctx: RoomCtx): Changed {
  const w = ctx.waits;
  const at = iso(now);
  const patch: Partial<RoomRow> = {};
  const opened = ms(room.opened_at);
  if (opened === null) patch.opened_at = at;
  const meeting = str(meetingId, 200);
  if (!room.provider_meeting_id && meeting) patch.provider_meeting_id = meeting;
  if (room.purpose !== "booked") {
    if (!room.host_by) patch.host_by = laterIso(null, now + hostWaitS(room.purpose, w) * S);
    if (room.contact_id && !room.lead_by) patch.lead_by = laterIso(null, (ms(room.link_sent_at) ?? now) + w.lead * S);
    if (!room.ends_at) patch.ends_at = laterIso(null, now + lengthMs(room.call_kind, ctx));
  }
  const effects: Effect[] = [];
  claimLink({ ...room, ...patch }, patch, effects, at);
  return Object.keys(patch).length ? change(room, room.state, patch, effects) : same(room);
}

/**
 * "That was not the lead", within 5 minutes of the join (lead_in → host_in),
 * and also once the room has closed, where only the count is taken back
 * (F6). count_undo_at records the press; a count still in flight is marked
 * undone at once, so its own result write misses and it undoes what it
 * made (F7).
 */
function notLead(room: RoomRow, now: number, ctx: RoomCtx): Applied {
  const w = ctx.waits;
  const final = isFinal(room.state);
  if (!final && room.state !== "lead_in") return refuse("stale");
  if (final && !leadJoined(room)) return room.lead_in_at && room.count_undo_at ? same(room) : refuse("stale");
  const joined = ms(room.lead_in_at);
  // The five minutes run from when the panel first showed the join: a Zoom
  // join read late (an outage, the sweep's replay) keeps its own time.
  const shown = joined === null ? null : Math.max(joined, ms(room.lead_in_seen_at) ?? joined);
  if (shown === null || now - shown > w.not_lead_undo * S)
    return refuse("not_lead_late", { minutes: Math.round(w.not_lead_undo / 60) });
  const patch: Partial<RoomRow> = { count_undo_at: iso(now) };
  if (countInFlight(room)) patch.count_result = "undone";
  const effects: Effect[] = room.count_claimed_at ? [{ kind: "undo_count" }] : [];
  if (final) {
    if (room.result === "joined") patch.result = "no_join";
    return change(room, room.state, patch, effects);
  }
  // Back to waiting for the real lead, with at least the open grace left so the sweep does not close it at once.
  patch.lead_by = laterIso(room.lead_by, now + w.open_grace * S);
  return change(room, "host_in", patch, effects);
}

/** The end reasons of a room a timer closed (the SQL sweep's R3, R4 and R9), not a person or the provider. */
export const TIMER_END_REASONS = ["lead_no_show", "not_admitted", "host_not_in", "no_deadline"] as const;
/** A late join's own time may sit this far before the room opened (clocks are never exact). */
const LATE_JOIN_EARLY_S = 60;

/**
 * A lead join on a room a timer closed with nobody in it (contract v2 S1:
 * the sweep owns the timers and cannot see a webhook not yet stored): Zoom's
 * join whose own time is before the close, or that came within open_grace of
 * it, or the host's "The lead is in" pressed within open_grace of it. The
 * room stays closed (a final room never moves) but keeps the join: lead_in_at
 * and result joined, so the sweep's settle never marks the intro a no-show
 * and the count runs as for any join. Null when the rule does not apply.
 */
function lateLeadIn(room: RoomRow, event: Extract<RoomEvent, { kind: "lead_in" }>, now: number, ctx: RoomCtx): Changed | null {
  if (room.state !== "expired" || !room.contact_id || leadJoined(room) || room.result === "joined") return null;
  if (room.end_reason && !(TIMER_END_REASONS as readonly string[]).includes(room.end_reason)) return null;
  const ended = ms(room.ended_at);
  if (ended === null) return null;
  const t = event.source === "mark" ? now : eventTime(event.at, now);
  const opened = ms(room.opened_at) ?? ms(room.requested_at);
  if (opened !== null && t < opened - LATE_JOIN_EARLY_S * S) return null;
  if (t > ended + ctx.waits.open_grace * S) return null;
  // The join "That was not the lead" took back, delivered again: not a new join.
  if (takenBack(room, t)) return null;
  return change(room, room.state, { lead_in_at: iso(t), lead_in_seen_at: iso(now), result: "joined" }, [{ kind: "count_live" }]);
}

/**
 * Applies one event to a room at time `now`. Pure: it returns the patch, the
 * conditional-write guard and the follow-up effects; the caller writes it
 * with guardFilter(expect) and runs the effects only if the write landed.
 *
 * Order of checks: the event's shape; the actor (host or manager); a final
 * room (an End is a no-op, a tick only re-asks, "That was not the lead" may
 * still take the count back, a person's other press is stale, a system
 * event is dropped); the version the button saw; then the event's own rule.
 */
export function applyRoomEvent(room: RoomRow, event: RoomEvent, now: number, ctx: RoomCtx): Applied {
  if (!room || !isRoomState(room.state) || !isPurpose(room.purpose)) return refuse("bad_input");
  if (!event || typeof event !== "object" || !oneOf(ROOM_EVENT_KINDS, event.kind)) return refuse("bad_input");
  if (!Number.isFinite(now)) return refuse("bad_input");
  const w = ctx.waits;
  const at = iso(now);
  const actor = (event as { actor?: Actor }).actor;
  if (actor && !mayAct(room, actor)) return refuse("not_host", { host: hostFirstName(room, ctx) });
  const seen = (event as { version?: unknown }).version;
  const given = seen !== undefined && seen !== null;

  if (isFinal(room.state)) {
    if (event.kind === "end") return same(room);
    if (event.kind === "tick") return same(room, reasks(room, now, ctx));
    // The room's end is the one move that may have landed since the rep saw it.
    if (event.kind === "not_lead" && actor) {
      if (given && Number(seen) !== ver(room) && Number(seen) !== ver(room) - 1) return refuse("stale");
      return notLead(room, now, ctx);
    }
    // A lead join the timer's close raced (Zoom's webhook lag, or the lead
    // in the meeting a moment after the sweep ran): kept as evidence only.
    if (event.kind === "lead_in" && (!given || Number(seen) === ver(room) || Number(seen) === ver(room) - 1)) {
      const late = lateLeadIn(room, event, now, ctx);
      if (late) return late;
    }
    if (actor) return refuse("stale");
    const r = refuse("final");
    if (event.kind === "ready") r.cleanup = true;
    return r;
  }
  // The same press from a second tab (or a retry whose answer was slow): the
  // room is already where the press wanted it, one version on. A no-op, never
  // "This changed a moment ago." (contract: a repeat press is a no-op).
  if (actor && given && Number(seen) === ver(room) - 1) {
    if (event.kind === "lead_in" && room.state === "lead_in") return same(room);
    if (event.kind === "host_in" && room.state === "host_in") return same(room);
    if (event.kind === "not_lead" && room.state === "host_in" && room.count_undo_at && !leadJoined(room)) return same(room);
  }
  // A rep's press one version behind a room the worker has only claimed since
  // (requested to creating is the one move into creating) still cancels it
  // (contract v2 section 4, lc-worker finding 23).
  const claimedSince = event.kind === "end" && room.state === "creating" && Number(seen) === ver(room) - 1;
  if (given && Number(seen) !== ver(room) && !claimedSince) return refuse("stale");
  const early = room.state === "requested" || room.state === "creating";
  // A Zoom, door or message-service time; a person's press is now.
  const when = (e: At & { source?: string }) => (e.source === "mark" ? now : eventTime(e.at, now));

  switch (event.kind) {
    case "claim":
      if (room.state !== "requested") return refuse("not_requested");
      return change(
        room,
        "creating",
        {
          claimed_at: at,
          ...(str(event.worker_run, 80) ? { worker_run: str(event.worker_run, 80) } : {}),
        },
        [],
      );

    case "ready": {
      const url = safeUrl(event.join_url ?? room.join_url);
      if (!url) return refuse("bad_link");
      if (room.state === "requested") return refuse("not_claimed");
      if (room.state === "creating") return openRoom(room, "open", url, event.provider_meeting_id, now, ctx);
      // A second, different meeting for a room already open: refused, and the worker deletes the one it made (F14).
      if (safeUrl(room.join_url) !== url) return { ...refuse("already_open"), cleanup: true };
      if (room.state === "open" || room.state === "host_in") return readyOnOpen(room, event.provider_meeting_id, now, ctx);
      return same(room);
    }

    case "fail": {
      if (!early) return refuse("already_open");
      const error = redactRoom(event.error) ?? LANE_COPY.worker_failed;
      return change(room, "failed", { error, result: "failed", ended_at: at }, finalEffects(room));
    }

    case "link_sent": {
      if (!room.contact_id) return refuse("no_lead");
      if (early) return refuse("too_early");
      if (room.link_sent_at) return same(room);
      const t = when(event);
      const patch: Partial<RoomRow> = { link_sent_at: iso(t) };
      if (event.unconfirmed === true && !room.link_unconfirmed_at) patch.link_unconfirmed_at = iso(t);
      // A send nobody claimed (the rep's "Also send by email" first) still closes the claim.
      if (!room.link_claimed_at) patch.link_claimed_at = iso(t);
      if (room.state !== "lead_in") {
        const lead = laterIso(room.lead_by, t + w.lead * S);
        if (lead !== room.lead_by) patch.lead_by = lead;
      }
      return change(room, room.state, patch, []);
    }

    case "opened":
    case "lead_waiting": {
      if (event.kind === "lead_waiting" && early) return refuse("too_early");
      if (event.kind === "lead_waiting" && (room.state === "lead_in" || !room.contact_id)) return same(room);
      const t = when(event);
      const patch: Partial<RoomRow> = {};
      if (event.kind === "opened" && !room.first_open_at) {
        patch.first_open_at = iso(t);
        const device = oneOf(DEVICES, event.device) ? event.device : null;
        if (device && !room.open_device) patch.open_device = device;
      }
      if (event.kind === "lead_waiting" && !room.lead_waiting_at) patch.lead_waiting_at = iso(t);
      // An open (or a knock) in the last 3 minutes moves lead_by to open + 180 s, never past one grace (F18).
      const lead = ms(room.lead_by);
      if ((room.state === "open" || room.state === "host_in") && lead !== null && t + w.open_grace * S > lead) {
        const cap = graceCap(room, w);
        const want = cap === null ? t + w.open_grace * S : Math.min(t + w.open_grace * S, cap);
        if (want > lead) patch.lead_by = iso(want);
      }
      return Object.keys(patch).length ? change(room, room.state, patch, []) : same(room);
    }

    case "host_in": {
      if (early) return refuse("too_early");
      if (room.state !== "open") {
        // The host is already in: a later join (a rejoin after a drop, or
        // Zoom's meeting.started again) moves host_in_at on, so a leave Zoom
        // sent before it, delivered after it, reads as old (host_left and
        // meeting_ended compare with host_in_at). Never earlier, no new version.
        const t = when(event);
        const cur = ms(room.host_in_at);
        if ((room.state === "host_in" || room.state === "lead_in") && event.source !== "mark" && (cur === null || t > cur))
          return change(room, room.state, { host_in_at: iso(t) }, []);
        return same(room);
      }
      const patch: Partial<RoomRow> = { host_in_at: iso(when(event)) };
      const effects: Effect[] = [];
      claimLink({ ...room, ...patch, state: "host_in" }, patch, effects, at);
      return change(room, "host_in", patch, effects);
    }

    case "host_left": {
      if (early) return refuse("too_early");
      if (room.state !== "host_in") return same(room);
      const t = when(event);
      // Left before they last came in: an earlier session's event, late.
      if (t < (ms(room.host_in_at) ?? Number.NEGATIVE_INFINITY)) return same(room);
      // P2: the host left before the lead came; host_by gives them 120 s more, never less than it had.
      return change(room, "open", { host_by: laterIso(room.host_by, t + w.handover_host * S) }, []);
    }

    case "lead_in": {
      if (early) return refuse("too_early");
      if (room.state === "lead_in") return same(room);
      if (!room.contact_id) return refuse("no_lead");
      const t = when(event);
      // The join "That was not the lead" took back, delivered again (Zoom sends two join events): not a new join.
      if (takenBack(room, t)) return same(room);
      const patch: Partial<RoomRow> = { lead_in_at: iso(t), lead_in_seen_at: iso(now) };
      // Zoom's join from before the meeting ended, delivered after the end
      // (stress2, round 2): the lead did join and the meeting is over, so the
      // room ends joined at the meeting's end (the count stands), never left
      // lead_in on a meeting that is over.
      const meetingEnded = ms(room.meeting_ended_at);
      if (event.source === "zoom" && meetingEnded !== null && t <= meetingEnded)
        return change(room, "ended", { ...patch, result: "joined", ended_at: iso(meetingEnded) }, [
          { kind: "count_live" },
          { kind: "delete_secret" },
        ]);
      if (room.purpose !== "booked") {
        const ends = laterIso(room.ends_at, t + lengthMs(room.call_kind, ctx));
        if (ends !== room.ends_at) patch.ends_at = ends;
      }
      return change(room, "lead_in", patch, [{ kind: "count_live" }]);
    }

    case "not_lead":
      return notLead(room, now, ctx);

    case "still_on":
      // Only a call with the lead in it runs on; the end only moves later.
      if (room.state !== "lead_in") return refuse("stale");
      return change(room, "lead_in", { ends_at: laterIso(room.ends_at, now + STILL_ON_ASK_AGAIN_S * S) }, []);

    case "end": {
      const reason = event.reason;
      if (!oneOf(END_REASONS, reason)) return refuse("bad_input");
      // "I can't let them in" exists only where P1 defines it (stress2, round
      // 2): a Meet room with a lead, made as a fallback or a handover. Never
      // on an empty standby room or a Zoom room, whose replacement would be
      // another meeting made with no cap and no live-hours check.
      if (reason === "admit_blocked" && !admitBlockedAllowed(room)) return refuse("bad_input");
      if (room.state === "lead_in") {
        if (reason === "admit_blocked") return refuse("stale");
        if (reason !== "finished" && event.confirm !== true) return refuse("confirm_end");
        // A room with the lead in it: no provider call, ever (C15). "joined"
        // only for a join that stands (a join taken back is nobody).
        return change(room, "ended", { result: leadJoined(room) ? "joined" : "no_join", ended_at: at }, [{ kind: "delete_secret" }]);
      }
      if (reason === "cancel" || reason === "on_phone" || reason === "admit_blocked" || early) {
        const result: RoomResult =
          reason === "on_phone" ? "moved_to_phone" : reason === "admit_blocked" ? "admit_blocked" : "cancelled";
        const effects = finalEffects(room);
        if (reason === "admit_blocked") effects.push({ kind: "replace", provider: otherProvider(room.provider) });
        return change(room, "cancelled", { result, ended_at: at }, effects);
      }
      return change(room, "ended", { result: room.contact_id ? "no_join" : null, ended_at: at }, finalEffects(room));
    }

    case "meeting_ended": {
      if (early) return refuse("too_early");
      const t = when(event);
      // An earlier instance of the meeting ended, late; the one running now has people in it.
      const lastIn = Math.max(ms(room.host_in_at) ?? Number.NEGATIVE_INFINITY, ms(room.lead_in_at) ?? Number.NEGATIVE_INFINITY);
      if (t < lastIn) return same(room);
      // Zoom ends a meeting the host left empty (F9, UNVERIFIED in phase 0). Before the lead came, while
      // their 10 minutes run, that is the host leaving (P2): back to open, 120 s for the host, secret kept;
      // room.open fetches a fresh start link.
      const leadAhead = (ms(room.lead_by) ?? Number.NEGATIVE_INFINITY) > now;
      if ((room.state === "open" || room.state === "host_in") && room.contact_id && !leadJoined(room) && leadAhead) {
        const host_by = laterIso(room.host_by, now + w.handover_host * S);
        // The meeting's end is kept (stress2, round 2): Zoom does not order its
        // webhooks, and a lead's join from before it, delivered after it, ends
        // the room joined instead of leaving it lead_in on a meeting that is over.
        const ended = laterIso(room.meeting_ended_at, t);
        if (room.state === "open" && host_by === room.host_by && ended === room.meeting_ended_at) return same(room);
        return change(room, "open", { host_by, meeting_ended_at: ended }, []);
      }
      const result: RoomResult | null = room.state === "lead_in" && leadJoined(room) ? "joined" : room.contact_id ? "no_join" : null;
      return change(room, "ended", { result, ended_at: iso(t) }, [{ kind: "delete_secret" }]);
    }

    case "meeting_deleted": {
      // The host deleted the room's Zoom meeting in Zoom (stress2, round 2):
      // its link is dead (Zoom answers 3,001). A room with the lead in it
      // ends joined; any other room fails with the sentence that says what to
      // do next. A failed room is never settled as a no-show.
      const t = when(event);
      if (room.state === "lead_in")
        return change(room, "ended", { result: leadJoined(room) ? "joined" : "no_join", ended_at: iso(t) }, [{ kind: "delete_secret" }]);
      // Cancelled with result failed (the worker did not fail: its health
      // counts stay true), never ended no_join (a no-show for the settle).
      return change(room, "cancelled", { result: "failed", end_reason: "meeting_deleted", error: ZOOM_DELETED, ended_at: iso(t) }, finalEffects(room));
    }

    case "adopt": {
      if (!standbyEmpty(room)) return refuse("not_standby");
      if (early) return refuse("too_early");
      if (room.state !== "open" && room.state !== "host_in") return refuse("stale");
      const contact = str(event.contact_id, 80);
      if (!contact) return refuse("no_contact");
      if (!isCallKind(event.call_kind)) return refuse("bad_input");
      const patch: Partial<RoomRow> = {
        contact_id: contact,
        purpose: "handover",
        call_kind: event.call_kind,
        handover_id: str(event.handover_id, 80),
        // In the room already: the link goes at once. Not in yet: it goes when they are.
        send_on: room.state === "host_in" ? "open" : "host_in",
        lead_by: laterIso(room.lead_by, now + w.lead * S),
        ends_at: laterIso(room.ends_at, now + lengthMs(event.call_kind, ctx)),
      };
      if (room.state === "open") patch.host_by = laterIso(room.host_by, now + w.handover_host * S);
      const effects: Effect[] = [];
      claimLink({ ...room, ...patch }, patch, effects, at);
      return change(room, room.state, patch, effects, null, true);
    }

    case "tick":
      return tick(room, event, now, ctx);
  }
  return refuse("bad_input");
}

/**
 * What the sweep asks for again, each from when, and until when: a link
 * claimed and never sent; a count never claimed for a lead who joined (with
 * count_on_join on), or claimed and stuck (an alert); an undo that never
 * landed. Re-asks repeat on every sweep until their condition clears; each
 * handler is idempotent (the message service on request_id = the room id;
 * the count on its claim; the undo on the row as it is read).
 */
function reaskPlan(room: RoomRow, ctx: RoomCtx): { at: number; until: number; effect: Effect }[] {
  const out: { at: number; until: number; effect: Effect }[] = [];
  const again = REASK_AFTER_S * S;
  const claimed = ms(room.link_claimed_at);
  if (
    (room.state === "open" || room.state === "host_in") &&
    room.contact_id &&
    room.purpose !== "booked" &&
    room.purpose !== "standby" &&
    !room.link_sent_at &&
    safeUrl(room.join_url) &&
    claimed !== null
  )
    out.push({ at: claimed + again, until: Number.POSITIVE_INFINITY, effect: { kind: "send_link", retry: true } });
  // The link went only as a WhatsApp template nobody saw, and its email
  // backup may never have run (the run was cut off after link_sent_at):
  // asked again, and rooms.ts sendLink resumes the backup unless its line
  // says it already ran (stress2, round 1).
  const unconfirmed = ms(room.link_unconfirmed_at);
  if (
    unconfirmed !== null &&
    room.link_sent_at &&
    room.contact_id &&
    (room.state === "open" || room.state === "host_in" || room.state === "lead_in") &&
    unconfirmedOnly(room)
  )
    out.push({ at: unconfirmed + again, until: unconfirmed + REASK_WINDOW_S * S, effect: { kind: "send_link", retry: true } });
  // The link was due and nobody ever claimed it (worker.ready was lost or
  // given up, so the one write that asks for it never ran): the sweep claims
  // it itself, REASK_AFTER_S after the room opened. rooms.ts writes the claim
  // with the guarded write first, so two ticks never both send.
  const opened = ms(room.opened_at);
  if (claimed === null && opened !== null && linkDue(room))
    out.push({ at: opened + again, until: Number.POSITIVE_INFINITY, effect: { kind: "claim_link" } });
  const joined = ms(room.lead_in_at);
  if (ctx.count_on_join && room.contact_id && room.purpose !== "booked" && joined !== null && leadJoined(room)) {
    const until = joined + REASK_WINDOW_S * S;
    const claim = ms(room.count_claimed_at);
    // Never claimed, or claimed and then undone (a staff join taken back before the real lead came).
    if (countClaimable(room)) out.push({ at: joined + again, until, effect: { kind: "count_live", retry: true } });
    else if (claim !== null && countInFlight(room))
      out.push({
        at: claim + COUNT_STUCK_S * S,
        until,
        effect: { kind: "alert", what: "count_stuck", dedupe_key: `room:${room.id}:count_stuck:${iso(claim)}` },
      });
  }
  // An undo pressed after the count finished, still not landed. A claim clears count_undo_at, so this
  // undo is for the count that stands, even if the real lead has joined since: that join is counted
  // once the undo lands.
  const undo = ms(room.count_undo_at);
  if (undo !== null && countStands(room))
    out.push({ at: undo + again, until: undo + REASK_WINDOW_S * S, effect: { kind: "undo_count", retry: true } });
  return out;
}

function reasks(room: RoomRow, now: number, ctx: RoomCtx): Effect[] {
  return reaskPlan(room, ctx)
    .filter(p => now >= p.at && now <= p.until)
    .map(p => p.effect);
}

/**
 * When the sweep next has work for this room (a timer, or a re-ask), or null
 * for none. Final rooms can still have re-asks for a count or an undo. A
 * standby room's availability is not in the row: the sweep also ticks every
 * standby room each minute, or live.availability(away) ends it.
 */
export function nextDueAt(room: RoomRow, now: number, ctx: RoomCtx): number | null {
  if (!room || !isRoomState(room.state)) return null;
  const times = isFinal(room.state) ? [] : timers(room, ctx).map(t => t.at);
  for (const p of reaskPlan(room, ctx)) if (p.until >= now) times.push(p.at);
  const ok = times.filter(t => Number.isFinite(t));
  return ok.length ? Math.min(...ok) : null;
}

/** The pending-events count as the sweep gave it: 0 when not given, null when it could not be read. */
function pendingCount(v: unknown): number | null {
  if (v === undefined) return 0;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** A fresh standby room is asked for only while the host is still available and no booked call is inside its life (F2, F16). */
function refreshWanted(e: Extract<RoomEvent, { kind: "tick" }>, now: number, w: Waits): boolean {
  if (e.available_until === undefined) return false;
  const until = ms(e.available_until);
  if (until === null || until <= now) return false;
  const booked = finiteOrNull(e.next_booked_start);
  return booked === null || booked - now > (w.standby_max + w.booked_guard) * S;
}

/**
 * The sweep for one room. Fires the earliest timer that is due. A standby
 * room nobody has been given closes 10 minutes before the host's next booked
 * call, and when the host's availability ends; any other room near that call
 * only raises an alert, because a room with a lead in it is never ended
 * (H7). No timer closes a room while one of its events waits for the replay
 * (at most 5 minutes past the timer). Re-asks ride along.
 */
function tick(room: RoomRow, e: Extract<RoomEvent, { kind: "tick" }>, now: number, ctx: RoomCtx): Changed {
  const w = ctx.waits;
  const list = timers(room, ctx);
  const alerts: Effect[] = [];
  const live = room.state === "open" || room.state === "host_in";
  const nextBooked = finiteOrNull(e.next_booked_start);
  if (nextBooked !== null && room.purpose !== "booked") {
    const guardAt = nextBooked - w.booked_guard * S;
    if (now >= guardAt) {
      if (standbyEmpty(room) && live) list.push({ reason: "booked_guard", at: guardAt });
      else if (live || room.state === "lead_in")
        alerts.push({ kind: "alert", what: "booked_guard", dedupe_key: `room:${room.id}:booked_guard:${iso(nextBooked)}` });
    }
  }
  if (standbyEmpty(room) && live && e.available_until !== undefined) {
    const until = ms(e.available_until);
    if (until === null || until <= now) list.push({ reason: "availability", at: until ?? now });
  }
  const extra = [...alerts, ...reasks(room, now, ctx)];
  const at = iso(now);
  // The SQL sweep owns every timer (S1): no state moves here, only the
  // re-asks and alerts SQL cannot do.
  if (e.owner === "sql") return same(room, extra);
  if (room.state === "creating") {
    const fail = list.find(t => t.reason === "fail");
    const recover = list.find(t => t.reason === "recover");
    if (fail && now >= fail.at)
      return change(room, "failed", { error: LANE_COPY.worker_lost, result: "failed", ended_at: at }, finalEffects(room), "fail");
    if (recover && now >= recover.at) {
      // The worker saved the link but its worker.ready never landed: the sweep opens the room, once.
      const url = safeUrl(room.join_url);
      if (url) return openRoom(room, "open", url, null, now, ctx, "recover");
      return same(room, [{ kind: "recover" }, ...extra], "recover");
    }
    return same(room, extra);
  }
  const due = list.filter(t => t.reason !== "recover" && now >= t.at).sort((a, b) => a.at - b.at)[0];
  if (!due) return same(room, extra);
  if (room.state === "requested")
    return change(room, "failed", { error: LANE_COPY.worker_late, result: "failed", ended_at: at }, finalEffects(room), "fail");
  // An event for this room still waits for the replay (a knock the door could not forward): wait for it (F5).
  const pending = pendingCount(e.pending_events);
  if ((pending === null || pending > 0) && now < due.at + PENDING_HOLD_MAX_S * S) return same(room, extra);
  if (room.state === "lead_in") {
    // Closed in the books only. No end call goes to Zoom or Google (C15).
    const error = room.provider === "zoom" ? ROOM_COPY.panel.no_end_signal : ROOM_COPY.panel.no_end_signal_any;
    return change(room, "ended", { error, result: leadJoined(room) ? "joined" : "no_join", ended_at: at }, [{ kind: "delete_secret" }, ...alerts], "no_end_signal");
  }
  const effects = finalEffects(room);
  if (due.reason === "standby_max" && refreshWanted(e, now, w)) effects.push({ kind: "refresh_standby" });
  return change(room, "expired", { result: room.contact_id ? "no_join" : null, ended_at: at }, [...effects, ...alerts], due.reason);
}

/** Runs the sweep on one room: the same as applying a tick. */
export function sweepRoom(
  room: RoomRow,
  now: number,
  ctx: RoomCtx,
  nextBookedStart: number | null = null,
  read: { pending_events?: number | null; available_until?: string | number | null; owner?: "sql" | null } = {},
): Applied {
  return applyRoomEvent(room, { kind: "tick", next_booked_start: nextBookedStart, ...read }, now, ctx);
}

/** room.mark's three presses as room events. */
export function markEvent(what: unknown, actor: Actor, version: number): RoomEvent | null {
  if (what === "host_in") return { kind: "host_in", source: "mark", actor, version };
  if (what === "lead_in") return { kind: "lead_in", source: "mark", actor, version };
  if (what === "not_lead") return { kind: "not_lead", actor, version };
  // Only ever moves the end later, so it carries no version: an answer from a
  // tab a version behind still lands.
  if (what === "still_on") return { kind: "still_on", actor };
  return null;
}

/** "Still on the call?" is asked again this long after "Still on it" (the panel's STILL_ON_ASK_AGAIN_MS). */
export const STILL_ON_ASK_AGAIN_S = 600;

// ---------------------------------------------------------------------------
// Small timing rules for the worker, the door and the panel
// ---------------------------------------------------------------------------

/** "I'm in" and "The lead is in" show: always for Meet and booked rooms; for Zoom after 30 s of Zoom silence since the link (F, H6). */
export function manualButtons(room: RoomRow, now: number, w: Waits, lastZoomEventAt: unknown = null): boolean {
  if (room.state !== "open" && room.state !== "host_in") return false;
  if (room.provider === "meet" || room.purpose === "booked") return true;
  const base = ms(room.link_sent_at) ?? ms(room.opened_at);
  if (base === null) return false;
  const quietSince = Math.max(base, ms(lastZoomEventAt) ?? 0);
  return now - quietSince >= w.manual_buttons * S;
}

/** The panel asks "Still on the call?" once a call with the lead in it passes ends_at. */
export function stillOnCall(room: RoomRow, now: number): boolean {
  const ends = ms(room.ends_at);
  return room.state === "lead_in" && ends !== null && now >= ends;
}

/** The worker gives up on a Meet link still pending 30 s after the claim (F edge cases). */
export function meetPendingExpired(room: RoomRow, now: number, w: Waits): boolean {
  const claimed = ms(room.claimed_at);
  return room.provider === "meet" && room.state === "creating" && claimed !== null && now - claimed >= w.meet_pending * S;
}

/** A stored door event nobody handled is replayed after 20 s, and left for a person after a day. */
export function replayDue(ev: { handled_at?: unknown; received_at?: unknown; created_at?: unknown }, now: number, w: Waits): boolean {
  if (ms(ev.handled_at) !== null) return false;
  const t = ms(ev.received_at) ?? ms(ev.created_at);
  if (t === null) return false;
  const age = now - t;
  return age >= w.event_replay * S && age <= REPLAY_MAX_AGE_S * S;
}

/**
 * What the settle knows beyond the room row (rooms.ts reads it; the SQL
 * sweep's S1 reads the same things). Left out, every fact is unknown, and an
 * unknown never counts as evidence that nobody came.
 */
export interface SettleFacts {
  /** rooms.short_link: the lead got the short link, so an open of it would have been seen. */
  short_link?: boolean;
  /** A Zoom event for this room is still unhandled or was given up: what Zoom said is not known. */
  zoom_unclear?: boolean;
  /** Another room for the same intro (or for the lead since its start) has a lead join that stands. */
  sibling_joined?: boolean;
  /**
   * Another room for the same call is still open with no join (a second
   * try): the settle waits for it (rooms.ts releases the event; the SQL
   * sweep's S1 leaves the room out until it closes), never read as a join.
   */
  sibling_open?: boolean;
  /** A test contact whose intro is not on rooms.test_calendar_id (C34): never an official number. */
  test_off_calendar?: boolean;
  /** Zoom reported a join after the room closed (a join the close raced), or the worker kept the meeting open for someone in it. */
  late_join?: boolean;
  /**
   * Zoom itself reported this room's meeting: a handled meeting.started, or
   * a handled join of the host. Without it, Zoom's silence says nothing about
   * the lead (the subscription switched off, the door's secret changed, the
   * door down), so a Zoom room is no evidence that nobody came.
   */
  zoom_reported?: boolean;
  /**
   * The door stored the lead's open of this room's link (a door.open event,
   * not one after the room ended), whether or not its write of the room's
   * open times landed (fix round 4: a slow database).
   */
  opened?: boolean;
  /**
   * The lead on the phone since the room was asked for (stress2, round 2):
   * "open", a dial to them still placed or dialing (the settle waits for it
   * to be saved); "reached", a call they answered or made that was answered
   * (the intro may be held by phone, so a person marks it, never the timer).
   */
  phone?: "open" | "reached" | null;
  /**
   * The link's WhatsApp failed after it was sent (stress2, round 2): the
   * tick's late read stored link.failed_late, or every message the link went
   * on is failed now. The lead's ten minutes ran without the link.
   */
  link_failed?: boolean;
}

/** Maqsam's states for a call that connected (dialer.ts callSummary), and the dialer's own "answered". */
const PHONE_ANSWERED = new Set(["answered", "completed", "serviced"]);
/** A saved dial whose outcome says the rep and the lead spoke. */
const PHONE_TALKED = new Set(["callback", "booked", "not_interested", "disqualified", "handled", "confirmed", "rescheduled", "cancelled", "showed"]);

/**
 * The lead's phone since a room was asked for (SettleFacts.phone): the
 * dialer's attempts to them and Maqsam's calls with them (cockpit_sales_dials,
 * by contact or phone), read from `since`. An attempt still dialing or placed
 * is "open"; an answered call, or a saved attempt that spoke, is "reached".
 */
export function phoneSince(attempts: Row[], dials: Row[], since: number, now: number = Number.POSITIVE_INFINITY): "open" | "reached" | null {
  const after = (v: unknown) => {
    const t = ms(v);
    return t !== null && t >= since;
  };
  const mine = attempts.filter(a => after(a.started_at) || after(a.saved_at));
  // An attempt left open for two hours holds nothing (the sweep's S1 the same).
  const fresh = (a: Row) => after(a.started_at) && (ms(a.started_at) ?? 0) >= now - 2 * HOUR;
  if (mine.some(a => (a.state === "dialing" || a.state === "placed") && fresh(a))) return "open";
  const answered = (state: unknown, seconds: unknown) =>
    PHONE_ANSWERED.has(String(state ?? "").toLowerCase()) && (seconds === null || seconds === undefined || Number(seconds) > 0);
  if (mine.some(a => a.state === "saved" && (answered(a.call_state, a.call_duration_s) || PHONE_TALKED.has(String(a.outcome ?? "")))))
    return "reached";
  if (
    dials.some(
      d =>
        after(d.occurred_at) &&
        ((d.direction === "outbound" && answered(d.state, d.duration_s)) || (d.direction === "inbound" && String(d.state ?? "") === "serviced")),
    )
  )
    return "reached";
  return null;
}

/**
 * Why a room that closed with nobody in it is still not evidence that the
 * lead stayed away ("missing is never zero"), or null when it is. A no-show
 * is a hard number in the B2B show rate, so it is written only on evidence:
 * a Zoom room whose join events were all read and whose meeting Zoom itself
 * reported (it started, or the host joined), or a short link the lead
 * never opened. Meet sends no join signal (the host's press is the only one),
 * so an unpressed Meet room is evidence only when the short link went and
 * was never opened.
 */
export function noShowDoubt(room: RoomRow, facts: SettleFacts = {}): string | null {
  if (facts.opened || room.first_open_at || room.last_open_at) return "the lead opened the link";
  if (room.lead_waiting_at) return "the lead knocked";
  // A link that never reached the lead (refused on every channel, or "it may
  // have gone" and never confirmed): their staying away says nothing.
  if (room.purpose !== "booked" && !room.link_sent_at) return "the link never reached the lead";
  // Its only channel a WhatsApp template nobody saw (no text, no email that
  // went): the link may never have reached the lead either (fix round 4).
  if (room.purpose !== "booked" && unconfirmedOnly(room)) return "the link was not confirmed to have reached the lead";
  if (room.purpose !== "booked" && facts.link_failed) return "the link's WhatsApp failed after it was sent";
  if (facts.sibling_joined) return "the lead joined another room for this call";
  // The setter rang again after the room and the lead answered (or the lead
  // rang back): the intro may be held on the phone (stress2, round 2).
  if (facts.phone === "reached" || facts.phone === "open") return "the lead was reached by phone";
  if (facts.test_off_calendar) return "a test contact's call is not on the test calendar";
  if (facts.late_join) return "someone joined the meeting after the room closed";
  if (room.provider === "meet" && (room.purpose === "booked" || facts.short_link !== true))
    return "Meet sends no join signal and nobody pressed The lead is in";
  if (room.provider === "zoom" && facts.zoom_unclear !== false) return "a Zoom event for this room was not read";
  if (room.provider === "zoom" && facts.zoom_reported !== true) return "Zoom reported nothing for this room";
  return null;
}

/** A room whose Zoom meeting the host deleted in Zoom (room.error, as the panel says it). */
export const ZOOM_DELETED = "The Zoom meeting was deleted in Zoom, so its link no longer works. Make a new room.";

/**
 * Where "I can't let them in" (room.end admit_blocked) may be pressed: a Meet
 * room with a lead in a fallback or handover room (P1 edge case 9), the
 * panel's own condition. Its replacement is a room on the other provider.
 */
export function admitBlockedAllowed(room: Pick<RoomRow, "provider" | "contact_id" | "purpose">): boolean {
  return room.provider === "meet" && Boolean(room.contact_id) && (room.purpose === "fallback" || room.purpose === "handover");
}

/** The link went only as a WhatsApp template nobody saw: no free text and no email went with it. */
export function unconfirmedOnly(room: RoomRow): boolean {
  if (!room.link_unconfirmed_at) return false;
  const ch = Array.isArray(room.link_channels) ? (room.link_channels as unknown[]).map(String) : [];
  return !ch.includes("whatsapp_text") && !ch.includes("email");
}

/** The dialer's intro item opens this long before the intro's start (dialer.ts introWindow). */
export const INTRO_EARLY_MS = 5 * MIN;

/**
 * A moment inside a booked intro's own window: from five minutes before its
 * start (the dialer's own intro item, dialer.ts introWindow) to its start +
 * waits_s.settle. A room asked for, or a lead's join, outside it is about
 * another call (yesterday evening's confirmation call, the confirmation
 * call in the hour before, stress2 round 2), never about the intro itself.
 */
export function inIntroWindow(t: number | null, start: number, w: Waits): boolean {
  return t !== null && t >= start - INTRO_EARLY_MS && t <= start + w.settle * S;
}

/**
 * The room was made for the intro as it stands now: asked for inside the
 * intro's own window (inIntroWindow), and, when it stored the intro's start
 * as it was made, that start is still the intro's. A confirmation call's
 * room the evening before, or a room from before the intro was moved, never
 * settles the intro.
 */
export function roomForThisStart(room: RoomRow, start: number, w: Waits): boolean {
  const stored = ms(room.appointment_start_at);
  // A booked room is the appointment's own room (room.wrap): the start it
  // stored is enough, whenever it was wrapped.
  if (room.purpose === "booked" && stored !== null) return Math.abs(stored - start) < S;
  const asked = ms(room.requested_at) ?? ms(room.created_at);
  if (!inIntroWindow(asked, start, w)) return false;
  return stored === null || Math.abs(stored - start) < S;
}

/**
 * P1, decision D14: a fallback room for a booked intro that closed with
 * nobody joining becomes a no-show at the intro's start + 20 minutes
 * (room.settle). That is a room that expired, or one ended with no join
 * (End room, or Zoom's end before anyone came, F8), including a join taken
 * back by "That was not the lead". A room moved to the phone or cancelled
 * writes nothing, and nor does a room with no booking, a room from before
 * the intro moved, or one with any sign the lead came (noShowDoubt).
 */
export function settleDue(
  room: RoomRow,
  appointmentStart: unknown,
  marked: boolean,
  now: number,
  w: Waits,
  facts: SettleFacts = {},
): boolean {
  if (room.purpose === "booked" || room.call_kind !== "intro") return false;
  const closedEmpty =
    (room.state === "expired" && (room.result == null || room.result === "no_join")) ||
    (room.state === "ended" && room.result === "no_join");
  if (!closedEmpty || leadJoined(room)) return false;
  if (!room.appointment_id || room.settled_mark || marked) return false;
  const start = ms(appointmentStart);
  if (start === null || now < start + w.settle * S || !roomForThisStart(room, start, w)) return false;
  return noShowDoubt(room, facts) === null;
}

/**
 * What room.event's sweep.settle settles (contract v2 section 5): the
 * fallback room settleDue describes, and the room the SQL sweep's S1 posts,
 * a booked intro (room.wrap) that expired with no lead in it, settled at its
 * start + settle (D14: "becomes a no-show at start + 20 minutes"). A room
 * closed admit_blocked (the lead knocked and could not be let in) is never
 * a no-show, and neither is one already marked or settled, nor one with any
 * sign the lead came.
 */
export function settleWanted(
  room: RoomRow,
  appointmentStart: unknown,
  marked: boolean,
  now: number,
  w: Waits,
  facts: SettleFacts = {},
): boolean {
  if (room.result === "admit_blocked") return false;
  if (room.purpose !== "booked") return settleDue(room, appointmentStart, marked, now, w, facts);
  if (room.call_kind !== "intro" || room.state !== "expired" || room.lead_in_at) return false;
  if (!room.appointment_id || room.settled_mark || marked) return false;
  const start = ms(appointmentStart);
  if (start === null || now < start + w.settle * S || !roomForThisStart(room, start, w)) return false;
  return noShowDoubt(room, facts) === null;
}

// ---------------------------------------------------------------------------
// The queue hold (C6): a lead stays out of the dialer's queue while their
// room is not final and its deadline is still ahead.
// ---------------------------------------------------------------------------

/**
 * When the hold on a room's lead ends, or null for none:
 * coalesce(lead_by, host_by, requested_at + fail). A room still being made
 * holds until the time it would fail (F25). A room with the lead in it
 * holds until its no-end-signal time, so a lead on a video call is not
 * dialled; that is still bounded, so a stuck row cannot hold anyone for
 * good. A booked room holds nobody: its call is already on the calendar,
 * and the lead's own confirmation and call items must stay (F15).
 */
export function holdUntil(room: RoomRow, ctx: RoomCtx): number | null {
  if (!room.contact_id || !isRoomState(room.state) || isFinal(room.state)) return null;
  if (room.purpose === "booked") return null;
  if (room.state === "lead_in") return timers(room, ctx)[0]?.at ?? null;
  if (room.state === "requested" || room.state === "creating")
    return timers(room, ctx).find(t => t.reason === "fail")?.at ?? null;
  const t = ms(room.lead_by) ?? ms(room.host_by);
  if (t !== null) {
    // The sweep keeps a room open past lead_by for an open or a knock in the
    // last open_grace (R4, capped by graceCap): the lead is held that long too.
    const w = ctx.waits;
    const cap = graceCap(room, w) ?? Number.POSITIVE_INFINITY;
    const open = ms(room.last_open_at) ?? ms(room.first_open_at);
    const knock = ms(room.lead_waiting_at);
    const grace = (x: number | null) => (x === null ? Number.NEGATIVE_INFINITY : Math.min(x + w.open_grace * S, cap));
    return room.contact_id && ms(room.lead_by) !== null ? Math.max(t, grace(open), grace(knock)) : t;
  }
  const base = ms(room.requested_at) ?? ms(room.created_at);
  return base === null ? null : base + ctx.waits.fail * S;
}

export function roomHolds(room: RoomRow, now: number, ctx: RoomCtx): boolean {
  const t = holdUntil(room, ctx);
  return t !== null && t > now;
}

/** The contacts to leave out of candidates() now. */
export function heldContacts(rooms: readonly RoomRow[], now: number, ctx: RoomCtx): Set<string> {
  const out = new Set<string>();
  for (const r of rooms) if (r.contact_id && roomHolds(r, now, ctx)) out.add(r.contact_id);
  return out;
}

// ---------------------------------------------------------------------------
// Which channel carries the link (F "Message service", C27, C29, 1.4)
// ---------------------------------------------------------------------------

export interface WaHealthCfg {
  window: number;
  fail_share: number;
  min_sends: number;
}
/** Rooms pause WhatsApp when 30% of their last 20 sends failed (whatsapp_guard.health.room; minimum 5 sends). */
export const ROOM_WA_HEALTH: Readonly<WaHealthCfg> = Object.freeze({ window: 20, fail_share: 0.3, min_sends: 5 });

export function waHealthCfg(guard: unknown): WaHealthCfg {
  const g = obj(guard);
  const room = obj(obj(g.health).room);
  return {
    window: Math.floor(bounded(room.window, ROOM_WA_HEALTH.window, 1000)),
    fail_share: bounded(room.fail_share, ROOM_WA_HEALTH.fail_share, 1),
    min_sends: Math.floor(bounded(room.min_sends ?? g.min_sends, ROOM_WA_HEALTH.min_sends, 1000)),
  };
}

/**
 * Room WhatsApp health from the room source's own recent sends, newest
 * first, so a bad wave elsewhere never blocks a live call. A history that
 * could not be read is not healthy: missing is never zero.
 */
export function roomWhatsappHealth(
  sends: readonly { failed?: unknown }[] | null | undefined,
  cfg: WaHealthCfg = ROOM_WA_HEALTH,
): { ok: boolean; failed: number; counted: number; share: number | null } {
  if (!Array.isArray(sends)) return { ok: false, failed: 0, counted: 0, share: null };
  const last = sends.slice(0, Math.max(1, cfg.window));
  const failed = last.filter(s => s?.failed === true).length;
  const counted = last.length;
  const share = counted ? failed / counted : null;
  const ok = counted < cfg.min_sends || (share !== null && share < cfg.fail_share);
  return { ok, failed, counted, share };
}

export interface ChannelInput {
  /** The HighLevel contact (tags, dnd, dndSettings, phone, email). */
  contact: Row | null;
  /** The lead's last inbound message, for the 24-hour window. */
  last_inbound_at: string | null;
  now: number;
  setting: RoomsSetting;
  /** The global `messaging.whatsapp` switch. */
  whatsapp_on: boolean;
  /** The `whatsapp_guard` setting. */
  guard: unknown;
  /** The call_link route is active with a published workflow. */
  template_live: boolean;
  /** The room source's last WhatsApp sends, newest first; null when they could not be read. */
  room_wa: readonly { failed?: unknown }[] | null;
  /** Two identical outbound messages within 60 s paused WhatsApp (C28). */
  wa_paused?: boolean;
  /** "Bad number": email goes first (P1). */
  email_first?: boolean;
  /**
   * An earlier workflow template to this lead is still waiting in HighLevel
   * (enrolled, never seen): HighLevel's delayed workflow would send it with
   * the join field as it is now, so a second enrolment sends this room's
   * link twice (fix round 4). The template is skipped.
   */
  template_waiting?: boolean;
}

export interface ChannelPlan {
  refusal: "client" | "dnd" | null;
  /** Channels to try, in order; the first is the main one. */
  order: LinkChannel[];
  primary: LinkChannel | null;
  /** Email can follow a template that was not confirmed in 20 s. */
  email_backup: boolean;
  /** Nothing can go: the rep reads the link out. */
  read_out: boolean;
  skipped: { channel: LinkChannel; why: string }[];
  /** "Not sent: {reason}." when nothing can go. */
  not_sent_reason: string | null;
  /** The picker's line (P1). */
  line: string;
}

const CHANNEL_WORDS: Record<LinkChannel, string> = {
  whatsapp_text: "WhatsApp",
  whatsapp_template: "a WhatsApp template",
  email: "email",
};
/** The channel as "Link sent on {channel}" says it. */
export function channelName(c: unknown): string {
  return c === "email" ? "email" : "WhatsApp";
}

function hasPhone(c: Row | null): boolean {
  return String(c?.phone ?? "").replace(/\D/g, "").length >= 8;
}
function hasEmail(c: Row | null): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c?.email ?? "").trim());
}
function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Picks the channels for a room link: WhatsApp free text inside the window,
 * then the call_link template, then email, then nothing (read it out).
 * Clients and contacts with do-not-disturb on every channel are refused
 * before any room is made.
 */
export function channelPlan(i: ChannelInput): ChannelPlan {
  const c = i.contact;
  const L = LANE_COPY;
  const none = (refusal: "client" | "dnd"): ChannelPlan => ({
    refusal,
    order: [],
    primary: null,
    email_backup: false,
    read_out: false,
    skipped: [],
    not_sent_reason: null,
    line: ROOM_COPY.dialer.picker_none,
  });
  if (c && isClient(c)) return none("client");
  const waDnd = c ? dndFor(c, "whatsapp") : false;
  const emailDnd = c ? dndFor(c, "email") : false;
  if (waDnd && emailDnd) return none("dnd");

  const health = roomWhatsappHealth(i.room_wa, waHealthCfg(i.guard));
  const common = !i.whatsapp_on
    ? L.why_wa_off
    : !hasPhone(c)
      ? L.why_no_phone
      : waDnd
        ? L.why_wa_dnd
        : !whatsappGuardOpen(i.guard)
          ? L.why_wa_gate
          : i.wa_paused
            ? L.why_wa_paused
            : null;
  const window = whatsappWindow(i.last_inbound_at, i.now);
  // The room source's health gates the free text only (final_spec_foundation,
  // message service 1): a template still goes, so its sends can show the
  // number is fine again and the share recovers (stress2, round 1).
  const why: Record<LinkChannel, string | null> = {
    whatsapp_text:
      common ??
      (!i.setting.send.whatsapp_text ? L.why_wa_off : !window.open ? L.why_window : !health.ok ? L.why_wa_health : null),
    whatsapp_template:
      common ??
      (!i.setting.send.whatsapp_template
        ? L.why_wa_off
        : !i.setting.short_link
          ? L.why_no_short_link
          : !i.template_live
            ? L.why_no_template
            : i.template_waiting
              ? L.why_template_waiting
              : null),
    email: !i.setting.send.email ? L.why_email_off : !hasEmail(c) ? L.why_no_email : emailDnd ? L.why_email_dnd : null,
  };
  const ranked: LinkChannel[] = i.email_first
    ? ["email", "whatsapp_text", "whatsapp_template"]
    : ["whatsapp_text", "whatsapp_template", "email"];
  const order = ranked.filter(ch => why[ch] === null);
  const skipped = ranked.filter(ch => why[ch] !== null).map(ch => ({ channel: ch, why: why[ch] as string }));
  const primary = order[0] ?? null;
  const reasons = [...new Set(LINK_CHANNELS.map(ch => why[ch]).filter((x): x is string => Boolean(x)))];
  return {
    refusal: null,
    order,
    primary,
    email_backup: order.includes("email") && primary !== "email",
    read_out: primary === null,
    skipped,
    not_sent_reason: primary === null ? joinWords(reasons) : null,
    line: primary ? fill(ROOM_COPY.dialer.picker, { channel: CHANNEL_WORDS[primary] }) : ROOM_COPY.dialer.picker_none,
  };
}

/**
 * The link may go by email to this lead: email sends are on, the contact has
 * an address and no email do-not-disturb (channelPlan's email rule), so a
 * WhatsApp template nobody saw can be backed up by email.
 */
export function emailPossible(contact: Row | null, setting: Pick<RoomsSetting, "send">): boolean {
  return setting.send.email && hasEmail(contact) && !(contact ? dndFor(contact, "email") : false);
}

/** Do-not-disturb covers both channels a link can go on. */
export function dndEveryChannel(contact: Row | null | undefined): boolean {
  return Boolean(contact) && dndFor(contact as Row, "whatsapp") && dndFor(contact as Row, "email");
}

// ---------------------------------------------------------------------------
// Zoom: who is staff, and what an event means for the room
// ---------------------------------------------------------------------------

export interface ZoomParticipant {
  id?: unknown;
  user_id?: unknown;
  participant_user_id?: unknown;
  user_name?: unknown;
  email?: unknown;
  participant_uuid?: unknown;
  join_time?: unknown;
  leave_time?: unknown;
  /** The waiting-room events' time. */
  date_time?: unknown;
}

export interface ZoomEvent {
  event?: unknown;
  event_ts?: unknown;
  payload?: {
    account_id?: unknown;
    object?: {
      id?: unknown;
      uuid?: unknown;
      host_id?: unknown;
      topic?: unknown;
      participant?: ZoomParticipant;
    };
  };
}

export interface ZoomStaffCtx {
  /** The room host's Zoom user id (room_hosts.zoom_user_id). */
  host_zoom_user_id?: string | null;
  host_email?: string | null;
  /** Every room_hosts email: anyone signed in as one is staff. */
  staff_emails?: readonly string[];
  staff_zoom_user_ids?: readonly string[];
  /**
   * participant_uuids seen in this meeting's waiting room. Kept for the
   * timeline only: whether Zoom keeps one uuid from the waiting room into
   * the meeting is UNVERIFIED, so the role never depends on it (F17).
   */
  waited?: readonly string[];
}

/** The events subscribed (C19), and meeting.deleted (stress2, round 2). */
export const ZOOM_EVENTS = [
  "meeting.started",
  "meeting.ended",
  "meeting.deleted",
  "meeting.participant_joined",
  "meeting.participant_left",
  "meeting.participant_joined_waiting_room",
  "meeting.participant_jbh_waiting",
  "meeting.participant_jbh_joined",
] as const;

export type ZoomRole = "host" | "staff" | "lead";

/**
 * Staff or lead (F "Who is who"). In order:
 * 1. the host: Zoom's host id, the room host's Zoom user, or the host's email;
 * 2. staff: an email or Zoom user in room_hosts;
 * 3. everyone else is the lead.
 * Being signed in to Zoom says nothing: a lead signed in to their own Zoom
 * is still the lead, so the room never expires around them (F17). A staff
 * member who is not signed in and not in room_hosts looks like the lead;
 * "That was not the lead" takes that back. Zoom's field meanings are
 * UNVERIFIED on recorded payloads from this account (phase-0 test).
 */
export function zoomRole(p: ZoomParticipant | null | undefined, meetingHostId: unknown, ctx: ZoomStaffCtx): ZoomRole {
  const id = str(p?.id, 100);
  const puid = str(p?.participant_user_id, 100);
  const email = lower(p?.email);
  const hostIds = [str(meetingHostId, 100), str(ctx.host_zoom_user_id, 100)].filter((x): x is string => Boolean(x));
  if ((id && hostIds.includes(id)) || (puid && hostIds.includes(puid))) return "host";
  if (email && email === lower(ctx.host_email)) return "host";
  if (email && (ctx.staff_emails ?? []).some(e => lower(e) === email)) return "staff";
  if ((id && (ctx.staff_zoom_user_ids ?? []).includes(id)) || (puid && (ctx.staff_zoom_user_ids ?? []).includes(puid)))
    return "staff";
  return "lead";
}

/** When a Zoom event happened: the participant's own time, else the event's (RoomEvent.at). */
function zoomAt(evt: ZoomEvent | null | undefined, which: "join" | "leave" | "wait" | "event"): string | number | null {
  const p = evt?.payload?.object?.participant;
  const own = which === "join" ? p?.join_time : which === "leave" ? p?.leave_time : which === "wait" ? (p?.date_time ?? p?.join_time) : null;
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : typeof v === "number" && Number.isFinite(v) ? v : null);
  return pick(own) ?? pick(evt?.event_ts);
}

export type ZoomEffect = { room_event: RoomEvent; role: ZoomRole | null } | { ignore: string; role: ZoomRole | null };

/**
 * What a Zoom event does to its room, stamped with when it happened (the
 * participant's join or leave time, else event_ts), so a replay is stamped
 * right. The first lead in sets lead_in; later ones change nothing.
 */
export function zoomEffect(evt: ZoomEvent | null | undefined, ctx: ZoomStaffCtx): ZoomEffect {
  const name = String(evt?.event ?? "");
  const o = evt?.payload?.object;
  const p = o?.participant;
  const role = p ? zoomRole(p, o?.host_id, ctx) : null;
  const when = (which: "join" | "leave" | "wait" | "event") => {
    const at = zoomAt(evt, which);
    return at === null ? {} : { at };
  };
  switch (name) {
    case "meeting.started":
      return { room_event: { kind: "host_in", source: "zoom", ...when("event") }, role: null };
    case "meeting.ended":
      return { room_event: { kind: "meeting_ended", ...when("event") }, role: null };
    case "meeting.deleted":
      return { room_event: { kind: "meeting_deleted", ...when("event") }, role: null };
    case "meeting.participant_joined":
    case "meeting.participant_jbh_joined":
      if (role === "host") return { room_event: { kind: "host_in", source: "zoom", ...when("join") }, role };
      if (role === "lead") return { room_event: { kind: "lead_in", source: "zoom", ...when("join") }, role };
      return { ignore: "staff joined", role };
    case "meeting.participant_left":
      if (role === "host") return { room_event: { kind: "host_left", ...when("leave") }, role };
      return { ignore: role === "lead" ? "the lead left; the meeting's end closes the room" : "staff left", role };
    case "meeting.participant_joined_waiting_room":
    case "meeting.participant_jbh_waiting":
      if (role === "lead") return { room_event: { kind: "lead_waiting", ...when("wait") }, role };
      return { ignore: "staff waiting", role };
    default:
      return { ignore: "not a room event", role };
  }
}

/** The meeting id (the room's provider_meeting_id) a Zoom event is about. */
export function zoomMeetingId(evt: ZoomEvent | null | undefined): string | null {
  const id = evt?.payload?.object?.id;
  return id === null || id === undefined || id === "" ? null : String(id).slice(0, 40);
}

/** The room code in a Zoom event's topic. */
export function zoomCode(evt: ZoomEvent | null | undefined): string | null {
  return codeFromTopic(evt?.payload?.object?.topic);
}

/**
 * room_events.dedupe_key for a Zoom event: the event, the meeting instance,
 * and for a participant their participant_uuid and join or leave time (P1).
 * Zoom's retries of one event share it; a second join by the same person is
 * a new key and is deduplicated by the state machine instead.
 */
export function zoomDedupeKey(evt: ZoomEvent | null | undefined): string {
  const name = String(evt?.event ?? "unknown").slice(0, 80);
  const o = evt?.payload?.object;
  const meeting = String(o?.uuid ?? o?.id ?? "").slice(0, 120);
  const p = o?.participant;
  if (!p) return `zoom:${name}:${meeting}`;
  const who = String(p.participant_uuid ?? p.user_id ?? p.id ?? "").slice(0, 120);
  const when = String(p.join_time ?? p.leave_time ?? evt?.event_ts ?? "").slice(0, 60);
  return `zoom:${name}:${meeting}:${who}:${when}`;
}

// ---------------------------------------------------------------------------
// Link previews and devices (F "Short link")
// ---------------------------------------------------------------------------

export const DEVICES = ["phone", "tablet", "computer"] as const;
export type Device = (typeof DEVICES)[number];

const BOT_NAMES =
  /(facebookexternalhit|facebot|meta-externalagent|twitterbot|slackbot|slack-imgproxy|telegrambot|discordbot|linkedinbot|skypeuripreview|embedly|iframely|pinterestbot|redditbot|applebot|googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|feedfetcher-google|google-pagerenderer|bingbot|bingpreview|yandexbot|yandeximages|duckduckbot|baiduspider|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|bitlybot|vkshare|w3c_validator|zoominfobot|qwantify|ia_archiver|lighthouse|headlesschrome|phantomjs|python-requests|python-urllib|aiohttp|go-http-client|okhttp|java\/|curl\/|wget\/|libwww|httpclient|axios\/|node-fetch|undici|postmanruntime|scrapy|microsoft office|ms-office)/i;

/**
 * A link preview or another machine, not a person: a HEAD request, no
 * agent, WhatsApp's own preview fetcher ("WhatsApp/2.x", which never starts
 * with Mozilla), a named preview or search bot, an HTTP library, or a
 * headless browser. In-app browsers (Instagram, Facebook's FBAN, LINE,
 * Snapchat) are people and pass. The page counts opens through a script as
 * well, which previews do not run; this is the second filter.
 */
export function isPreviewBot(ua: unknown, method?: unknown): boolean {
  if (typeof method === "string" && method.toUpperCase() === "HEAD") return true;
  const s = typeof ua === "string" ? ua.trim() : "";
  if (!s) return true;
  if (/^whatsapp\//i.test(s)) return true;
  if (BOT_NAMES.test(s)) return true;
  if (/\b(bot|crawler|spider|scraper|preview)\b/i.test(s)) return true;
  return /(bot|crawler|spider)\//i.test(s);
}

/** What the lead opened the link on, for "on a phone"; null when unknown. */
export function deviceOf(ua: unknown): Device | null {
  const s = typeof ua === "string" ? ua : "";
  if (!s) return null;
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) return "tablet";
  if (/iPhone|iPod|Android|Mobile|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile/i.test(s)) return "phone";
  if (/Windows NT|Macintosh|Mac OS X|X11|Linux|CrOS/i.test(s)) return "computer";
  return null;
}

/** " on a phone", or "" when the device is unknown (for F's "opened" line). */
export function deviceWords(d: unknown): string {
  return d === "phone" ? " on a phone" : d === "tablet" ? " on a tablet" : d === "computer" ? " on a computer" : "";
}

/** The short page's app hint (F "Short page"). */
export function appHint(provider: unknown): string {
  return provider === "zoom" ? ROOM_COPY.short_page.zoom_hint : ROOM_COPY.short_page.meet_hint;
}

// ---------------------------------------------------------------------------
// The Google event id
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What Google allows in an event id: base32hex (0-9, a-v), 5 to 1,024 characters. */
export const GOOGLE_EVENT_ID_RE = /^[0-9a-v]{5,1024}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * The Meet room's Google event id: the room's UUID as 32 lower-case hex
 * digits (F: "id = room UUID hex"). Hex digits all sit inside base32hex,
 * so Google takes it, and a retried insert answers 409 instead of making a
 * second event. The worker computes the same id.
 */
export function googleEventId(roomId: unknown): string | null {
  const s = typeof roomId === "string" ? roomId.trim() : "";
  if (!UUID_RE.test(s)) return null;
  return s.replace(/-/g, "").toLowerCase();
}

/** The room id back from a Google event id this module made. */
export function roomIdFromGoogleEventId(id: unknown): string | null {
  const s = typeof id === "string" ? id.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{32}$/.test(s)) return null;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ---------------------------------------------------------------------------
// countLive: does a join book and mark a live call (F "Integrations", D2,
// C1, C21, C34). It runs at lead_in, behind rooms.count_on_join (off).
// ---------------------------------------------------------------------------

/** A lead is a contact tagged roas-qualified or roas-unqualified (the lead rule of 2026-09-21). */
export function isTaggedLead(tags: unknown): boolean {
  const t = Array.isArray(tags) ? tags.map(lower) : [];
  return t.includes("roas-qualified") || t.includes("roas-unqualified");
}
/** Both tags read as qualified, as the mirror's leadClass does. */
export function leadClassOf(tags: unknown): "qualified" | "unqualified" | null {
  const t = Array.isArray(tags) ? tags.map(lower) : [];
  if (t.includes("roas-qualified")) return "qualified";
  if (t.includes("roas-unqualified")) return "unqualified";
  return null;
}
/**
 * A test contact for the count: listed in rooms.test_contacts, or tagged
 * cockpit-test (C34). Read where it only keeps a booking off the official
 * calendars (the safe side), never to let a room through.
 */
export function isTestContact(contactId: unknown, tags: unknown, setting: Pick<RoomsSetting, "test_contacts">): boolean {
  if (isListedTestContact(contactId, setting)) return true;
  return Array.isArray(tags) && tags.some(t => lower(t) === "cockpit-test");
}

/**
 * Who may have a room while rooms.test_only is on: the contacts listed in
 * rooms.test_contacts only, which the CEO sets in the database. A HighLevel
 * tag is not enough (final review): anyone with HighLevel access could tag
 * a real lead cockpit-test and send them room links, with no audit row here.
 */
export function isListedTestContact(contactId: unknown, setting: Pick<RoomsSetting, "test_contacts">): boolean {
  const id = String(contactId ?? "").trim();
  return Boolean(id) && setting.test_contacts.includes(id);
}

/** "Live · {first name}". */
export function liveTitle(first: unknown, full?: unknown): string {
  const n = greetingName(first, full ?? null);
  return `Live · ${n || "lead"}`.slice(0, 120);
}

export interface CountInput {
  room: RoomRow;
  setting: RoomsSetting;
  /** The contact: tags, first name (firstName or first_name) and name. */
  contact: Row | null;
  /**
   * upcoming(contact, room.call_kind) (index.ts): the lead's next call of
   * the room's kind booked ahead, if any, with its end, its rep and its
   * status, so a move can be put back whole. upcoming() already filters by
   * kind; one given that differs is not moved. A call ahead with no known
   * end or rep is never moved: what cannot be put back is not taken.
   */
  upcoming: {
    id: string;
    start: number;
    end?: number | null;
    assigned_user_id?: string | null;
    status?: string | null;
    kind?: CallKind | null;
  } | null;
  /** The calendar of the booked intro the room is for (room.appointment_id), when there is one. */
  appointment_calendar_id?: string | null;
  host_ghl_user_id: string | null;
  location_id: string;
  /** The short link, or the room's own link before the CNAME. */
  link: string | null;
  calendars?: { intro_qualified: string; intro_unqualified: string; demo: string };
  /**
   * B2B's own calendars beyond BOOKING_CALENDARS (the calendars setting's
   * intro and demo ids): neither a test booking nor a live booking ever goes
   * on one of them (C34, D25).
   */
  official_calendar_ids?: readonly string[];
  /**
   * Another room of this lead's already counted this conversation (a booking,
   * a move or a mark that stands, joined within hours of this join): true.
   * "in_flight": another room's count was claimed and has no result yet (it
   * may have booked): nothing is claimed now, and the sweep asks again.
   */
  standing_count?: boolean | "in_flight";
  /**
   * Something from the lead says they came: Zoom's join, the short link
   * opened, or a knock. False when only a hand press says so; then a real
   * lead's join is recorded as self_reported and nothing is booked or marked
   * until a manager confirms it. Test contacts are exempt (their bookings
   * never move an official number).
   */
  lead_evidence?: boolean;
  /**
   * The booked intro is already held by B2B's rule (a rep's showed or
   * invalid mark, or HighLevel's status): the count adds nothing, and a
   * disqualification is never turned into a show.
   */
  appointment_shown?: boolean;
  /**
   * The start of the booked intro the room carries (room.appointment_id),
   * else room.appointment_start_at. The room marks that intro shown only for
   * a join inside the intro's own window (inIntroWindow); a join outside it
   * (a confirmation call's room the day before) is any other live join.
   */
  appointment_start?: number | null;
  /**
   * The lead's call of the room's kind that has already started (upcoming()
   * keeps only calls ahead): its start within the last lengths_min, not
   * cancelled, invalid or a no-show. `mine`: the host may mark it (their
   * own, or a manager's). The join is that call: marked shown when it is
   * theirs, counted already when it is another rep's; never a Live booking
   * beside it.
   */
  current_call?: { id: string; start: number; status?: string | null; mine: boolean } | null;
  /** The upcoming call is the host's own (or a manager's room): only then is it moved to now. */
  upcoming_mine?: boolean;
  /**
   * The call that was ahead at the join has started since, or was held
   * (showed or invalid), by the time the count runs (a manager's late
   * confirm, stress2, round 2): it is never moved back to the join, and
   * nothing is booked beside it. The join counts nothing.
   */
  upcoming_passed?: boolean;
  /** A manager confirmed a join only a hand press reported (room.count_confirm): it counts as evidence. */
  confirmed?: boolean;
}

export type CountSkip =
  | "switch_off"
  | "no_contact"
  | "not_joined"
  | "claimed"
  | "booked_room"
  | "client"
  | "not_a_lead"
  | "test_calendar_missing"
  | "test_calendar_official"
  | "test_not_on_test_calendar"
  | "host_not_in_highlevel"
  | "live_calendar_missing"
  | "already_counted"
  | "upcoming_unknown"
  | "sibling_counting"
  | "booked_other_rep"
  | "self_reported";

export type CountPlan =
  | { action: "none"; claim: boolean; count_result: CountResult | null; reason: CountSkip }
  | { action: "mark"; claim: true; appointment_id: string }
  | {
      action: "move";
      claim: true;
      appointment_id: string;
      from_start: string;
      from_end: string;
      from_assigned_user_id: string;
      from_status: string;
      start: string;
      end: string;
      body: Row;
    }
  | { action: "create"; claim: true; test: boolean; calendar_id: string; start: string; end: string; body: Row };

/**
 * The room carries its booked intro for this join: it has one, and the join
 * falls inside that intro's own window (from an hour before its start to
 * its start + settle). A start that is not known keeps the room's own
 * appointment, as rooms made before 20261003d did.
 */
export function carriesIntro(room: RoomRow, joined: number | null, start: number | null, w: Waits): boolean {
  if (!room.appointment_id) return false;
  const at = finiteOrNull(start) ?? ms(room.appointment_start_at);
  return at === null || inIntroWindow(joined, at, w);
}

/**
 * The claim may be taken: never taken, or taken and then undone ("That was
 * not the lead"). A join only a hand press reported (self_reported) is taken
 * again only when a manager confirms it (room.count_confirm).
 */
export function countClaimable(room: RoomRow, confirmed = false): boolean {
  return !room.count_claimed_at || room.count_result === "undone" || (confirmed && room.count_result === "self_reported");
}

/** B2B's calendars: BOOKING_CALENDARS and any other intro or demo calendar the caller names. */
export function officialCalendars(
  extra: readonly string[] = [],
  cal: { intro_qualified: string; intro_unqualified: string; demo: string } = BOOKING_CALENDARS,
): Set<string> {
  return new Set([...Object.values(cal), ...extra].map(x => String(x ?? "").trim()).filter(Boolean));
}

/**
 * What to do when the lead joins. The caller first claims with
 * countClaim (a conditional PATCH: count_claimed_at is null, or
 * count_result = undone) whenever `claim` is true, and does nothing if the
 * claim is lost; then it books or marks, and writes the outcome with
 * countFinish.
 *
 * - Switched off, standby, not joined (or the join was taken back),
 *   already claimed: nothing.
 * - A booked room (the closer's own demo): nothing; the closer marks it.
 * - A client: not a lead.
 * - A test contact first (C34): booked only on rooms.test_calendar_id,
 *   never moved, and nothing at all when that calendar is not set or is one
 *   of B2B's; its booked intro is marked only when it sits on the test
 *   calendar (F12).
 * - A real lead whose join only a hand press reports: self_reported.
 * - A fallback room for a booked intro: mark that intro shown.
 * - No roas tag: not a lead, nothing booked.
 * - Already counted from another room of theirs: nothing more.
 * - A host with no HighLevel user: failed (refuseMark needs one).
 * - A call of the same kind booked ahead: moved to now (PUT), when its end
 *   and its rep are known, so the undo can put it back whole.
 * - Otherwise a new booking (POST) on rooms.live_calendar_id (D25: never on
 *   an intro or demo calendar B2B's show rate counts), at the minute the
 *   lead joined, 15 or 45 minutes long; failed when that calendar is not set.
 */
export function countLive(i: CountInput): CountPlan {
  const { room, setting } = i;
  const official = officialCalendars(i.official_calendar_ids ?? [], i.calendars ?? BOOKING_CALENDARS);
  const none = (reason: CountSkip, claim: boolean, count_result: CountResult | null = null): CountPlan => ({
    action: "none",
    claim,
    count_result,
    reason,
  });
  if (!setting.count_on_join) return none("switch_off", false);
  if (!room.contact_id) return none("no_contact", false);
  const joined = ms(room.lead_in_at);
  if (joined === null || !leadJoined(room)) return none("not_joined", false);
  if (!countClaimable(room, i.confirmed === true)) return none("claimed", false);
  if (room.purpose === "booked") return none("booked_room", false);
  const c = i.contact ?? {};
  if (isClient(c)) return none("client", true, "not_a_lead");
  const test = isTestContact(room.contact_id, c.tags, setting);
  if (test && !setting.test_calendar_id) return none("test_calendar_missing", true, "not_a_lead");
  if (test && official.has(setting.test_calendar_id as string)) return none("test_calendar_official", true, "not_a_lead");
  if (!test && i.lead_evidence === false && i.confirmed !== true) return none("self_reported", true, "self_reported");
  if (carriesIntro(room, joined, i.appointment_start ?? null, setting.waits_s)) {
    if (test && str(i.appointment_calendar_id, 80) !== setting.test_calendar_id)
      return none("test_not_on_test_calendar", true, "not_a_lead");
    if (i.appointment_shown) return none("already_counted", true, "already_counted");
    return { action: "mark", claim: true, appointment_id: room.appointment_id as string };
  }
  // The lead's own call of this kind started a little before the join (the
  // intro running now, a room made from the lead page): the join is that call.
  const cur = i.current_call;
  if (!test && cur && cur.id) {
    // Held already by B2B's rule (showed, or invalid: a disqualified call is held): nothing to add.
    if (["showed", "invalid"].includes(String(cur.status ?? ""))) return none("already_counted", true, "already_counted");
    // Another rep's call running now: never marked with this host's rights,
    // and never counted nowhere without a word (stress2, round 2): that rep
    // or a manager is told to mark it, as for another rep's call ahead.
    if (!cur.mine) return none("booked_other_rep", true, "failed");
    return { action: "mark", claim: true, appointment_id: cur.id };
  }
  if (!test && !isTaggedLead(c.tags)) return none("not_a_lead", true, "not_a_lead");
  if (i.standing_count === "in_flight") return none("sibling_counting", false);
  if (i.standing_count) return none("already_counted", true, "already_counted");
  const host = str(i.host_ghl_user_id, 80);
  if (!host) return none("host_not_in_highlevel", true, "failed");

  const start = Math.floor(joined / MIN) * MIN;
  const end = start + (setting.booking_min[room.call_kind] ?? (room.call_kind === "demo" ? 45 : 15)) * MIN;
  const link = safeUrl(i.link);
  const where = {
    meetingLocationType: "custom",
    ...(link ? { address: link } : {}),
    overrideLocationConfig: true,
  };
  const up = i.upcoming;
  if (!test && up && up.id && (!up.kind || up.kind === room.call_kind) && i.upcoming_passed)
    return none("already_counted", true, "already_counted");
  const upEnd = finiteOrNull(up?.end ?? null);
  const upRep = str(up?.assigned_user_id, 80);
  // Another rep's call ahead is never moved to this host (the mark path's
  // rule): it would take that rep's call and its show. Nothing is booked
  // beside it either (two calls for one lead).
  if (!test && up && up.id && (!up.kind || up.kind === room.call_kind) && upRep && !(i.upcoming_mine ?? upRep === host))
    return none("booked_other_rep", true, "failed");
  if (
    !test &&
    up &&
    up.id &&
    (!up.kind || up.kind === room.call_kind) &&
    Number.isFinite(up.start) &&
    upEnd !== null &&
    upEnd > up.start &&
    upRep
  )
    return {
      action: "move",
      claim: true,
      appointment_id: up.id,
      from_start: iso(up.start),
      from_end: iso(upEnd),
      from_assigned_user_id: upRep,
      from_status: str(up.status, 20) ?? "confirmed",
      start: iso(start),
      end: iso(end),
      body: {
        startTime: iso(start),
        endTime: iso(end),
        assignedUserId: host,
        ignoreFreeSlotValidation: true,
        ignoreDateRange: true,
        toNotify: false,
        ...where,
      },
    };
  // A call ahead whose end or rep is not known is neither moved nor booked
  // beside (two intros for one lead): the sweep asks again.
  if (!test && up && up.id && (!up.kind || up.kind === room.call_kind)) return none("upcoming_unknown", false);
  const live = str(setting.live_calendar_id, 80);
  if (!test && (!live || official.has(live))) return none("live_calendar_missing", true, "failed");
  const calendarId = test ? (setting.test_calendar_id as string) : (live as string);
  return {
    action: "create",
    claim: true,
    test,
    calendar_id: calendarId,
    start: iso(start),
    end: iso(end),
    body: {
      calendarId,
      locationId: i.location_id,
      contactId: room.contact_id,
      startTime: iso(start),
      endTime: iso(end),
      title: liveTitle(c.firstName ?? c.first_name, c.name ?? c.contactName),
      appointmentStatus: "confirmed",
      assignedUserId: host,
      ignoreFreeSlotValidation: true,
      ignoreDateRange: true,
      toNotify: false,
      ...where,
    },
  };
}

/** What the count recorded before it changed the lead's own booked call, so its undo can put it back. */
export interface CountBefore {
  /** move: the call's start, end, rep and status before the move. */
  from_start?: unknown;
  from_end?: unknown;
  from_assigned_user_id?: unknown;
  from_status?: unknown;
  /** mark: the intro's status and its active disposition before the count's mark, and the count's own disposition. */
  prior_status?: unknown;
  prior_disposition_id?: unknown;
  own_disposition_id?: unknown;
  /** move: the call the count moved, and where it moved it to (count.moving). */
  appointment_id?: unknown;
  to_start?: unknown;
  /** create: the calendar and start of the live booking the count asked for (count.creating, fix round 4). */
  calendar_id?: unknown;
  start?: unknown;
}

export type UndoPlan =
  | { action: "none"; reason: "nothing" | "in_flight" | "moved_from_unknown" | "unmark_unknown" | "unclear_unknown" }
  | { action: "delete"; appointment_id: string }
  /** An unclear booking: looked for on the lead's calendar at its start, and deleted if it was made. */
  | { action: "find_delete"; calendar_id: string; start: string }
  | {
      action: "move_back";
      appointment_id: string;
      start: string;
      end: string | null;
      assigned_user_id: string | null;
      status: string;
    }
  | {
      action: "unmark";
      appointment_id: string;
      status: string;
      own_disposition_id: string | null;
      prior_disposition_id: string | null;
    };

/**
 * "That was not the lead": delete a booking countLive made, move a moved one
 * back whole (its start, end, rep and status as the count recorded them
 * before the move), or take back the count's own mark on a booked intro,
 * putting back the status it had. Never a mark of invalid, which B2B counts
 * as shown. `before` is the count's own record (the count.moving or
 * count.marking event); an older room's count.moved held only from_start.
 */
export function countUndo(room: RoomRow, before: CountBefore | string | null | unknown = null): UndoPlan {
  if (!room.count_claimed_at) return { action: "none", reason: "nothing" };
  const appt = str(room.count_appointment_id, 80);
  const b: CountBefore = typeof before === "string" ? { from_start: before } : (obj(before) as CountBefore);
  switch (room.count_result ?? null) {
    case "booked":
      return appt ? { action: "delete", appointment_id: appt } : { action: "none", reason: "in_flight" };
    case "moved": {
      const from = isoOrNull(b.from_start);
      if (!appt) return { action: "none", reason: "in_flight" };
      if (!from) return { action: "none", reason: "moved_from_unknown" };
      const end = isoOrNull(b.from_end);
      return {
        action: "move_back",
        appointment_id: appt,
        start: from,
        end: end && (ms(end) as number) > (ms(from) as number) ? end : null,
        assigned_user_id: str(b.from_assigned_user_id, 80),
        status: str(b.from_status, 20) ?? "confirmed",
      };
    }
    case null: {
      // A mark (the room's own intro, or the lead's call that had started).
      if (!appt) return { action: "none", reason: "in_flight" };
      // The status the intro had before the count's mark, as the count read it
      // (HighLevel's own, else the rep's mark, else the copy). Never guessed:
      // "confirmed" on a past intro is a show by the B2B rule.
      const prior = str(b.prior_status, 20);
      if (!prior) return { action: "none", reason: "unmark_unknown" };
      return {
        action: "unmark",
        appointment_id: appt,
        status: prior,
        own_disposition_id: str(String(b.own_disposition_id ?? ""), 80),
        prior_disposition_id: str(String(b.prior_disposition_id ?? ""), 80),
      };
    }
    case "unclear": {
      // The count's change may have landed (its answer was lost): put back
      // what it may have done, from its own record (fix round 4). A move is
      // moved back whole (writing the call as it was is harmless if the move
      // never landed); a booking is looked for and deleted if it was made.
      const moved = str(String(b.appointment_id ?? ""), 80);
      const from = isoOrNull(b.from_start);
      if (moved && from) {
        const end = isoOrNull(b.from_end);
        return {
          action: "move_back",
          appointment_id: moved,
          start: from,
          end: end && (ms(end) as number) > (ms(from) as number) ? end : null,
          assigned_user_id: str(b.from_assigned_user_id, 80),
          status: str(b.from_status, 20) ?? "confirmed",
        };
      }
      // A mark whose answer was lost (count.marking): taken back as a mark
      // is, from the status the count recorded before it (stress2, round 1).
      const prior = str(b.prior_status, 20);
      if (moved && prior)
        return {
          action: "unmark",
          appointment_id: moved,
          status: prior,
          own_disposition_id: str(String(b.own_disposition_id ?? ""), 80),
          prior_disposition_id: str(String(b.prior_disposition_id ?? ""), 80),
        };
      const cal = str(String(b.calendar_id ?? ""), 80);
      const start = isoOrNull(b.start);
      if (cal && start) return { action: "find_delete", calendar_id: cal, start };
      return { action: "none", reason: "unclear_unknown" };
    }
    default:
      return { action: "none", reason: "nothing" };
  }
}

/** A conditional write: the columns to set and what the row must still hold (see guardFilter). */
export interface GuardedWrite {
  patch: Partial<RoomRow>;
  expect: Partial<RoomRow>;
}

/**
 * The count's claim, or null when it cannot be taken. A plan that books
 * nothing (not a lead, failed) writes its result with the claim. A new
 * claim clears an earlier undo, so a real lead who joins after "That was
 * not the lead" is counted.
 *
 * The claim lands only on the row as the count read it: its claim, its
 * result, its undo and its join (fix round 4). "That was not the lead"
 * pressed while the count was still reading HighLevel writes count_undo_at
 * only (no claim yet), so the claim misses and the press is never erased;
 * the sweep's next re-ask reads the fresh row, where the join was taken back.
 * Only a claim built from a row whose join came after the undo clears it.
 */
export function countClaim(room: RoomRow, now: number, plan: CountPlan, confirmed = false): GuardedWrite | null {
  if (!plan.claim || !countClaimable(room, confirmed) || !leadJoined(room)) return null;
  return {
    patch: {
      count_claimed_at: iso(now),
      count_result: plan.action === "none" ? plan.count_result : null,
      count_appointment_id: null,
      count_undo_at: null,
    },
    expect: {
      count_claimed_at: room.count_claimed_at ?? null,
      count_result: room.count_result ?? null,
      count_undo_at: room.count_undo_at ?? null,
      lead_in_at: room.lead_in_at ?? null,
    },
  };
}

/**
 * The count's outcome, written only where its own claim still stands and no
 * undo came in while it ran (F7). A mark keeps count_result null and sets
 * count_appointment_id (countUndo reads it so). If this write misses, the
 * caller takes back what it made (countUndo on the row it would have
 * written) and then writes countUndone.
 */
export function countFinish(
  claimedAt: string,
  done: { count_result: CountResult | null; count_appointment_id: string | null },
): GuardedWrite {
  return {
    patch: { count_result: done.count_result, count_appointment_id: done.count_appointment_id },
    expect: { count_claimed_at: claimedAt, count_result: null, count_appointment_id: null, count_undo_at: null },
  };
}

/** After an undo landed: the count is "undone" and may be claimed again by a real join. */
export function countUndone(room: RoomRow): GuardedWrite {
  return {
    patch: { count_result: "undone" },
    expect: { count_claimed_at: room.count_claimed_at ?? null, count_result: room.count_result ?? null },
  };
}

// ---------------------------------------------------------------------------
// Presence (F "presence"): the first state that applies wins.
// ---------------------------------------------------------------------------

export type PresenceState = "on_call" | "ready" | "available" | "away";

export interface Presence {
  email: string;
  state: PresenceState;
  until: string | null;
  room_id: string | null;
  zoom_status: ZoomStatus | null;
  default_provider: Provider;
}

export interface PresenceInput {
  email: string;
  now: number;
  availability: { state?: unknown; until?: unknown } | null;
  /** This rep's rooms; final ones are ignored. */
  rooms: readonly RoomRow[];
  /** An open dial (attempts dialing or placed). */
  open_attempt: boolean;
  /** An appointment of theirs is running now. */
  appointment_now: boolean;
  /** A booked call of theirs starts within booked_guard (the view's booked_soon): away, so no live lead is offered. */
  booked_soon?: boolean;
  /** room_hosts.zoom_live_until: a live Zoom meeting seen by the host check. */
  zoom_live_until?: unknown;
  zoom_status?: ZoomStatus | null;
  default_provider: Provider;
}

/**
 * 1. on_call: an open dial, a room with the lead in it, an appointment now,
 *    a live Zoom meeting that is not one of their own open rooms, or a room
 *    of theirs waiting for its lead (one room per host means they cannot
 *    take another);
 * 2. ready: in their own standby room with no lead, while Available has not
 *    run out (F2: a closer who pressed Go away, or whose time ran out, gets
 *    no offers even if still sitting in the room; the sweep closes it);
 * 3. available: pressed Available and the time has not run out;
 * 4. away.
 * The `why` is for the timeline; presenceView gives the contract's shape.
 */
export function presenceOf(i: PresenceInput): Presence & { why: string } {
  const me = lower(i.email);
  const mine = i.rooms.filter(r => lower(r.host_email) === me && isRoomState(r.state) && !isFinal(r.state));
  const leadIn = mine.find(r => r.state === "lead_in");
  const waiting = mine.find(r => r.contact_id && r.purpose !== "booked" && r.state !== "lead_in");
  const standby = mine.find(r => standbyEmpty(r) && r.state === "host_in");
  const ownZoom = mine.some(r => r.provider === "zoom" && (r.state === "open" || r.state === "host_in"));
  const zoomUntil = ms(i.zoom_live_until);
  const zoomLive = zoomUntil !== null && zoomUntil > i.now && !ownZoom;
  const availUntil =
    i.availability && i.availability.state === "available" && (ms(i.availability.until) ?? 0) > i.now
      ? ms(i.availability.until)
      : null;
  const base = {
    email: me,
    zoom_status: oneOf(ZOOM_STATUSES, i.zoom_status) ? i.zoom_status : null,
    default_provider: i.default_provider,
  };
  const until = availUntil === null ? null : iso(availUntil);
  if (i.open_attempt) return { ...base, state: "on_call", until: null, room_id: null, why: "dialing" };
  if (leadIn) return { ...base, state: "on_call", until: null, room_id: leadIn.id, why: "lead_in" };
  if (i.appointment_now) return { ...base, state: "on_call", until: null, room_id: null, why: "appointment" };
  if (zoomLive) return { ...base, state: "on_call", until: null, room_id: null, why: "zoom" };
  if (waiting) return { ...base, state: "on_call", until: null, room_id: waiting.id, why: "room_waiting" };
  if (i.booked_soon) return { ...base, state: "away", until: null, room_id: null, why: "booked_soon" };
  if (availUntil === null) return { ...base, state: "away", until: null, room_id: null, why: "away" };
  if (standby) return { ...base, state: "ready", until, room_id: standby.id, why: "standby" };
  const openStandby = mine.find(r => standbyEmpty(r));
  return { ...base, state: "available", until, room_id: openStandby?.id ?? null, why: "available" };
}

/** Presence as the contract shapes it (live.status, live.availability): no `why`. */
export function presenceView(p: Presence & { why?: unknown }): Presence {
  return {
    email: p.email,
    state: p.state,
    until: p.until,
    room_id: p.room_id,
    zoom_status: p.zoom_status,
    default_provider: p.default_provider,
  };
}

/** live.availability(away): the rep's empty standby rooms, each to end with {kind: end, reason: end}. */
export function standbyToEnd(rooms: readonly RoomRow[], email: string): RoomRow[] {
  const me = lower(email);
  return rooms.filter(r => lower(r.host_email) === me && standbyEmpty(r) && isRoomState(r.state) && !isFinal(r.state));
}

/** The strip's line for a rep's presence (F "Availability strip"); null on a call, where the room panel speaks. */
export function stripLine(p: Pick<Presence, "state" | "until">, now: number): string | null {
  const until = ms(p.until);
  if (p.state === "on_call") return null;
  if (p.state === "ready" && until !== null) return fill(ROOM_COPY.strip.ready, { until: clockWithDay(until, now) });
  if (p.state === "available" && until !== null)
    return fill(ROOM_COPY.strip.available, { until: clockWithDay(until, now) });
  return ROOM_COPY.strip.away;
}

/**
 * The rep's room provider by default (D10): the host's own choice, else Meet
 * for the setter and Zoom for the closer; a provider the host cannot use
 * gives way to the other (a pending Zoom seat makes Meet the setter's).
 */
export function defaultProvider(
  role: unknown,
  host: { zoom_status?: ZoomStatus | null; google_ok?: boolean; default_provider?: unknown } | null,
  setting: Pick<RoomsSetting, "providers" | "default_provider">,
  /** The call the room is for: a closer's is a demo (60 minutes), which a Basic Zoom (40) cannot hold. */
  kind: CallKind = role === "closer" ? "demo" : "intro",
): Provider {
  const pref: Provider = isProvider(host?.default_provider)
    ? host.default_provider
    : role === "closer"
      ? setting.default_provider.closer
      : setting.default_provider.setter;
  // createRefusal's rule (stress2, round 1): a Basic Zoom is not usable for a
  // demo, so a Basic closer's standby room is made on Meet, never refused.
  const usable = (p: Provider) =>
    setting.providers[p] &&
    (p === "zoom"
      ? host?.zoom_status === "licensed" || (host?.zoom_status === "basic" && kind !== "demo")
      : host?.google_ok === true);
  if (usable(pref)) return pref;
  return usable(otherProvider(pref)) ? otherProvider(pref) : pref;
}

// ---------------------------------------------------------------------------
// The health line (F "Health line", 1.7)
// ---------------------------------------------------------------------------

export interface Health {
  worker_ok: boolean;
  last_run_at: string | null;
  /** null when it could not be read: missing is never 0 (F13). */
  rooms_today: number | null;
  failed_today: number | null;
  line: string;
}

function countOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
function rooms(n: number): string {
  return `${n} ${n === 1 ? "room" : "rooms"}`;
}

/**
 * The worker writes its status row at least every 30 s; the line turns red
 * at 90 s. A row from more than 5 minutes in the future is a clock fault and
 * reads as down. Counts that could not be read are left out of the line,
 * never shown as 0.
 */
export function roomsHealth(i: {
  now: number;
  last_run_at: unknown;
  rooms_today: unknown;
  failed_today: unknown;
  mismatched_today?: unknown;
  /** The worker's status row (ok and detail): a fresh row that says it makes no rooms is down. */
  status?: { ok?: unknown; detail?: unknown } | null;
}): Health {
  const last = ms(i.last_run_at);
  const fresh = last !== null && i.now - last <= WORKER_RED_AFTER_S * S && last - i.now <= 5 * MIN;
  const notMaking = fresh && workerNotMaking(i.status);
  const ok = fresh && !notMaking;
  const made = countOf(i.rooms_today);
  const failed = countOf(i.failed_today);
  const mismatched = countOf(i.mismatched_today);
  let line: string;
  if (notMaking)
    line = `The room worker is running but making no rooms: ${clause(String(i.status?.detail ?? "").slice(NOT_MAKING_PREFIX.length) || "no reason given")}. Call the lead or send your own link until it is fixed.`;
  else if (!ok)
    line = last === null ? LANE_COPY.health_never : fill(ROOM_COPY.health.down, { time: clockWithDay(last, i.now) });
  else if (mismatched !== null && mismatched > 0)
    line = fill(mismatched === 1 ? ROOM_COPY.health.mismatch : LANE_COPY.health_mismatch_many, { rooms: rooms(mismatched) });
  else if (made === null || failed === null)
    line = fill(LANE_COPY.health_working_no_counts, { time: kuwaitClockSeconds(last as number) });
  else line = fill(ROOM_COPY.health.working, { time: kuwaitClockSeconds(last as number), rooms: rooms(made), failed });
  return {
    worker_ok: ok,
    last_run_at: last === null ? null : iso(last),
    rooms_today: made,
    failed_today: failed,
    line,
  };
}

/** The watchdog's Slack line (F). */
export function watchdogLine(lastRunAt: unknown, now: number): string {
  const last = ms(lastRunAt);
  return last === null ? LANE_COPY.watchdog_never : fill(ROOM_COPY.slack.watchdog, { time: clockWithDay(last, now) });
}

// ---------------------------------------------------------------------------
// The browser's view of a room (contract RoomView). Built key by key from an
// allow-list, so start_url and anything else secret can never reach a seat.
// ---------------------------------------------------------------------------

export interface RoomView {
  id: string;
  code: string;
  contact_id: string | null;
  contact_first_name: string | null;
  purpose: Purpose;
  call_kind: CallKind;
  provider: Provider;
  host_email: string;
  state: RoomState;
  version: number;
  short_url: string | null;
  join_url: string | null;
  link_channels: string[];
  link_sent_at: string | null;
  first_open_at: string | null;
  open_device: Device | null;
  lead_waiting_at: string | null;
  host_in_at: string | null;
  lead_in_at: string | null;
  /** When the room first showed the join (a Zoom join read late keeps its own time in lead_in_at). */
  lead_in_seen_at: string | null;
  ended_at: string | null;
  host_by: string | null;
  lead_by: string | null;
  ends_at: string | null;
  result: RoomResult | null;
  count_result: CountResult | null;
  error: string | null;
  refusal: string | null;
  created_at: string | null;
  /** A WhatsApp template was not seen in time, so email went too ("Not confirmed" reads this, never a channel). */
  link_unconfirmed_at: string | null;
  trigger: string | null;
  attempt_id: string | null;
  /** The booked call a booked or fallback room is for. */
  appointment_id: string | null;
  handover_id: string | null;
  /** A booked room's appointment start, or the start of the booked intro a fallback room is for (not a column). */
  starts_at: string | null;
  /**
   * Why the sweep closed the room (lead_no_show, not_admitted, host_not_in,
   * events_lost, ...): the panel says a knock, or an unread Zoom, as itself,
   * never "nobody joined" (stress2, round 1).
   */
  end_reason: string | null;
  /** The lead's latest open of the link: the sweep holds the room open_grace past it (R4), and so does the panel's countdown. */
  last_open_at: string | null;
}

export const ROOM_VIEW_KEYS = [
  "id",
  "code",
  "contact_id",
  "contact_first_name",
  "purpose",
  "call_kind",
  "provider",
  "host_email",
  "state",
  "version",
  "short_url",
  "join_url",
  "link_channels",
  "link_sent_at",
  "first_open_at",
  "open_device",
  "lead_waiting_at",
  "host_in_at",
  "lead_in_at",
  "lead_in_seen_at",
  "ended_at",
  "host_by",
  "lead_by",
  "ends_at",
  "result",
  "count_result",
  "error",
  "refusal",
  "created_at",
  "link_unconfirmed_at",
  "trigger",
  "attempt_id",
  "appointment_id",
  "handover_id",
  "starts_at",
  "end_reason",
  "last_open_at",
] as const;

/** The channels the link went on, from link_channels or the keys of link_message_ids. */
export function linkChannelsOf(row: { link_channels?: unknown; link_message_ids?: unknown }): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = lower(v);
    if (oneOf(LINK_CHANNELS, s) && !out.includes(s)) out.push(s);
  };
  if (Array.isArray(row.link_channels)) row.link_channels.forEach(add);
  const ids = row.link_message_ids;
  if (Array.isArray(ids)) for (const m of ids) add(typeof m === "object" && m ? (m as Row).channel : m);
  else if (ids && typeof ids === "object") Object.keys(ids as Row).forEach(add);
  return out;
}

export function toRoomView(
  row: RoomRow,
  opts: { short_link: boolean; contact_first_name?: unknown; refusal?: string | null; starts_at?: unknown },
): RoomView {
  const first = greetingName(opts.contact_first_name ?? row.contact_first_name, null);
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    contact_id: str(row.contact_id, 80),
    contact_first_name: first || null,
    purpose: row.purpose,
    call_kind: row.call_kind,
    provider: row.provider,
    host_email: lower(row.host_email),
    state: row.state,
    version: ver(row),
    short_url: shortUrl(row.code, row.join_url, opts.short_link),
    join_url: safeUrl(row.join_url),
    link_channels: linkChannelsOf(row),
    link_sent_at: isoOrNull(row.link_sent_at),
    first_open_at: isoOrNull(row.first_open_at),
    open_device: oneOf(DEVICES, row.open_device) ? row.open_device : null,
    lead_waiting_at: isoOrNull(row.lead_waiting_at),
    host_in_at: isoOrNull(row.host_in_at),
    // A join "That was not the lead" took back is kept in the row as
    // evidence, and shown as nobody: the panel never says the lead joined.
    lead_in_at: leadJoined(row) ? isoOrNull(row.lead_in_at) : null,
    // When the room first showed the join: That was not the lead's five
    // minutes count from the later of this and lead_in_at (fix round 4).
    lead_in_seen_at: leadJoined(row) ? isoOrNull(row.lead_in_seen_at) : null,
    ended_at: isoOrNull(row.ended_at),
    host_by: isoOrNull(row.host_by),
    lead_by: isoOrNull(row.lead_by),
    ends_at: isoOrNull(row.ends_at),
    result: oneOf(ROOM_RESULTS, row.result) ? row.result : null,
    count_result: oneOf(COUNT_RESULTS, row.count_result) ? row.count_result : null,
    error: redactRoom(row.error),
    refusal: redactRoom(opts.refusal ?? row.refusal),
    created_at: isoOrNull(row.created_at) ?? isoOrNull(row.requested_at),
    link_unconfirmed_at: isoOrNull(row.link_unconfirmed_at),
    trigger: oneOf(TRIGGERS, row.trigger) ? row.trigger : null,
    attempt_id: str(row.attempt_id, 80),
    appointment_id: str(row.appointment_id, 80),
    handover_id: str(row.handover_id, 80),
    starts_at: isoOrNull(opts.starts_at),
    end_reason: /^[a-z_]{1,40}$/.test(String(row.end_reason ?? "")) ? String(row.end_reason) : null,
    last_open_at: isoOrNull(row.last_open_at),
  };
}

// ---------------------------------------------------------------------------
// Creating and wrapping a room
// ---------------------------------------------------------------------------

export interface HostFacts {
  zoom_status: ZoomStatus | null;
  /** The host check saw them in a live Zoom meeting. */
  zoom_live: boolean;
  /** The rep's Google calendar token works. */
  google_ok: boolean;
  /**
   * The host check has written a Google value for this seat (true or
   * false). False: not checked yet, so a Meet refusal says to try again
   * rather than that Google is down. Left out: checked.
   */
  google_checked?: boolean;
}

export interface CreateInput {
  setting: RoomsSetting;
  purpose: unknown;
  provider: unknown;
  call_kind: unknown;
  contact_id: string | null;
  /** The HighLevel contact; null when it could not be read, and then a room for a lead is refused (F4). */
  contact: Row | null;
  host: HostFacts | null;
  /** The rep making the room, for the fallback pilot list. */
  host_email: string | null;
  lead_room_open: boolean;
  host_room_open: boolean;
  /** The lead has a demo booked ahead: its Zoom link comes from HighLevel. */
  booked_demo: boolean;
  /** The lead has a booked intro (the dialer's call was for it): fallback.scope "intro" needs one. */
  booked_intro: boolean;
}

/**
 * The checks on the lead, the same for every way a lead reaches a room
 * (room.create, Take on a standby room): a contact that could not be read
 * is never treated as clear; then the test list, client and do-not-disturb.
 */
function contactRefusal(s: RoomsSetting, contactId: string, contact: Row | null): Refused | null {
  if (!contact) return refuse("contact_unread");
  if (s.test_only && !isListedTestContact(contactId, s)) return refuse("test_only");
  if (isClient(contact)) return refuse("client");
  if (dndEveryChannel(contact)) return refuse("dnd");
  return null;
}

/** A Zoom refusal, with its "use Meet" advice only when the host can use Meet (F21). */
function zoomRefusal(code: RefusalCode, meetUsable: boolean): Refused {
  const r = refuse(code);
  const plain = NO_MEET[code];
  return meetUsable || !plain ? r : { ...r, message: plain };
}

/** The Meet refusals without their "use Zoom" advice, for a host who cannot use Zoom either. */
const NO_ZOOM: Partial<Record<RefusalCode, string>> = {
  meet_unchecked: LANE_COPY.meet_unchecked_no_zoom,
  no_google: LANE_COPY.no_google_no_zoom,
};

/** A Meet refusal, with its "use Zoom" advice only when the host can use Zoom for this call. */
function meetRefusal(code: RefusalCode, zoomUsable: boolean): Refused {
  const r = refuse(code);
  const plain = NO_ZOOM[code];
  return zoomUsable || !plain ? r : { ...r, message: plain };
}

/**
 * room.create's checks, before anything is written: the switches; the
 * request's shape; both providers off; the lead (contact read, test list,
 * client, do-not-disturb; F "Security": before anything about the host);
 * the booked demo; the chosen provider; the fallback scope and pilot list;
 * one room per lead and per host; then the host's provider. Null means the
 * room may be made. Booked rooms come from room.wrap, never from here (C4).
 */
export function createRefusal(i: CreateInput): Refused | null {
  const s = i.setting;
  if (!s.enabled) return refuse("disabled");
  if (!isPurpose(i.purpose) || !isProvider(i.provider) || !isCallKind(i.call_kind) || i.purpose === "booked")
    return refuse("bad_input");
  const purpose = i.purpose;
  const provider = i.provider;
  const contact = str(i.contact_id, 80);
  if (purpose === "standby" && contact) return refuse("bad_input");
  if (purpose !== "standby" && !contact) return refuse("no_contact");
  if (!s.providers.zoom && !s.providers.meet) return refuse("disabled");
  if (contact) {
    const no = contactRefusal(s, contact, i.contact);
    if (no) return no;
  }
  if (i.booked_demo && (purpose === "fallback" || purpose === "manual")) return refuse("booked_demo");
  if (!s.providers[provider])
    return refuse("provider_off", { provider: providerName(provider), other: providerName(otherProvider(provider)) });
  if (purpose === "fallback") {
    if (s.fallback.scope !== "any" && !i.booked_intro) return refuse("fallback_scope");
    if (s.fallback.pilot_emails.length && !s.fallback.pilot_emails.includes(lower(i.host_email)))
      return refuse("fallback_pilot");
  }
  if (contact && i.lead_room_open) return refuse("lead_has_room", {}, purpose);
  if (i.host_room_open) return refuse("host_has_room");
  return providerRefusal(s, i.host, provider, i.call_kind);
}

/**
 * The host's own provider, for this kind of call: null when the host can use
 * it now (the provider is on, Zoom licensed or a Basic Zoom for an intro and
 * not in another meeting, or Google working for Meet). createRefusal's last
 * step, and the check "I can't let them in" and the panel's "Try {other}"
 * make before they offer the other provider (stress2, round 1).
 */
export function providerRefusal(
  s: Pick<RoomsSetting, "providers">,
  h: HostFacts | null,
  provider: Provider,
  callKind: CallKind,
): Refused | null {
  if (!s.providers[provider])
    return refuse("provider_off", { provider: providerName(provider), other: providerName(otherProvider(provider)) });
  if (provider === "zoom") {
    const meetUsable = s.providers.meet && h?.google_ok === true;
    const st = h?.zoom_status ?? null;
    // Split by cause (final review): not checked yet is not "missing".
    if (!st) return zoomRefusal("zoom_unchecked", meetUsable);
    if (st === "missing") return zoomRefusal("zoom_missing", meetUsable);
    if (st === "pending") return zoomRefusal("zoom_pending", meetUsable);
    if (st === "basic" && callKind === "demo") return zoomRefusal("zoom_basic_demo", meetUsable);
    if (h?.zoom_live) return zoomRefusal("zoom_busy", meetUsable);
  } else if (!h?.google_ok) {
    const st = h?.zoom_status ?? null;
    const zoomUsable =
      s.providers.zoom && !h?.zoom_live && (st === "licensed" || (st === "basic" && callKind !== "demo"));
    // No host row yet (before the first 10-minute check), or no Google value
    // written yet: not checked. A checked false: the worker's one Google
    // sign-in is down, which no seat can fix on its own.
    const unchecked = !h || h.google_checked === false;
    return meetRefusal(unchecked ? "meet_unchecked" : "no_google", zoomUsable);
  }
  return null;
}

/**
 * Take on a standby room (adopt): the lead's checks room.create runs, so a
 * handover never skips the switch, the test list, a client or
 * do-not-disturb (F17). Null means the room may be given the lead.
 */
export function adoptRefusal(i: { setting: RoomsSetting; contact_id: string | null; contact: Row | null }): Refused | null {
  if (!i.setting.enabled) return refuse("disabled");
  const contact = str(i.contact_id, 80);
  if (!contact) return refuse("no_contact");
  return contactRefusal(i.setting, contact, i.contact);
}

export interface NewRoomInput {
  id: string;
  request_id: string;
  code: string;
  contact_id: string | null;
  purpose: Purpose;
  call_kind: CallKind;
  provider: Provider;
  host_email: string;
  made_by: string;
  now: number;
  trigger?: string | null;
  attempt_id?: string | null;
  appointment_id?: string | null;
  handover_id?: string | null;
  send_on?: SendOn | null;
}

/** A new room, in requested. A handover made for a taker with no standby room sends its link when the host is in (F flow 3). */
export function newRoomRow(n: NewRoomInput): RoomRow {
  const t = iso(n.now);
  return {
    id: n.id,
    request_id: n.request_id,
    code: n.code,
    contact_id: n.contact_id,
    purpose: n.purpose,
    trigger: oneOf(TRIGGERS, n.trigger) ? n.trigger : null,
    call_kind: n.call_kind,
    provider: n.provider,
    host_email: lower(n.host_email),
    made_by: lower(n.made_by),
    appointment_id: n.appointment_id ?? null,
    handover_id: n.handover_id ?? null,
    replaced_by: null,
    attempt_id: n.attempt_id ?? null,
    state: "requested",
    version: 1,
    error: null,
    result: null,
    settled_mark: null,
    provider_meeting_id: null,
    join_url: null,
    send_on: n.send_on ?? (n.purpose === "handover" ? "host_in" : "open"),
    host_by: null,
    lead_by: null,
    ends_at: null,
    requested_at: t,
    claimed_at: null,
    opened_at: null,
    link_claimed_at: null,
    link_sent_at: null,
    first_open_at: null,
    lead_waiting_at: null,
    host_in_at: null,
    lead_in_at: null,
    ended_at: null,
    open_device: null,
    count_claimed_at: null,
    count_appointment_id: null,
    count_result: null,
    count_undo_at: null,
    created_at: t,
  };
}

/** Text (an appointment's address) holding a Zoom start link or a zak token anywhere in it. */
export function holdsHostLink(text: unknown): boolean {
  const s = typeof text === "string" ? text : "";
  return /[?&;#]zak=/i.test(s) || /zoom(gov)?\.(us|com)\/(s\/|wc\/\S*\/start)/i.test(s);
}

/**
 * The meeting an appointment's `address` holds: a Zoom join link (/j/ or
 * /my/) or a Meet link, or null for a phone call. A Zoom start link (/s/,
 * or a zak token) is never taken: it would let the lead in as the host (F3).
 */
export function meetingFromAddress(address: unknown): { provider: Provider; join_url: string; meeting_id: string | null } | null {
  const s = typeof address === "string" ? address : "";
  const zooms = s.matchAll(/https:\/\/(?:[a-z0-9-]+\.)*zoom\.us\/(?:j|my)\/[^\s<>"']+/gi);
  for (const zoom of zooms) {
    const url = safeUrl(zoom[0].replace(/[.,;)\]]+$/, ""));
    if (url) {
      const id = /\/j\/(\d{9,12})(?:[/?#]|$)/.exec(url);
      return { provider: "zoom", join_url: url, meeting_id: id ? (id[1] ?? null) : null };
    }
  }
  const meet = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s<>"']*)?/i.exec(s);
  if (meet) {
    const url = safeUrl(meet[0].replace(/[.,;)\]]+$/, ""));
    if (url) return { provider: "meet", join_url: url, meeting_id: null };
  }
  return null;
}

export interface WrapOk {
  ok: true;
  provider: Provider;
  join_url: string;
  provider_meeting_id: string | null;
  host_by: string;
  lead_by: string;
  ends_at: string;
}

/**
 * room.wrap: a booked call keeps its own meeting (C2). The room stores the
 * appointment's link in state open and makes no Zoom or Google call. The
 * rooms switch and the test list apply (F17). A phone call has no link to
 * send; a host's start link is refused (F3); a call that is over gets none
 * either; and a call more than 30 minutes away is too early (F15), so a
 * wrap never holds the lead or the one-room-per-lead slot for hours.
 */
export function wrapPlan(i: {
  setting: RoomsSetting;
  contact_id: string | null;
  /** The HighLevel contact if it was read: its cockpit-test tag counts for test_only. */
  contact?: Row | null;
  start: unknown;
  end?: unknown;
  address: unknown;
  call_kind: CallKind;
  now: number;
  ctx: RoomCtx;
}): WrapOk | Refused {
  if (!i.setting?.enabled) return refuse("disabled");
  const contact = str(i.contact_id, 80);
  if (!contact) return refuse("no_contact");
  if (i.setting.test_only && !isListedTestContact(contact, i.setting)) return refuse("test_only");
  const meeting = meetingFromAddress(i.address);
  if (!meeting) return refuse(holdsHostLink(i.address) ? "host_link" : "phone_call");
  const start = ms(i.start);
  if (start === null || !isCallKind(i.call_kind)) return refuse("bad_input");
  const d = bookedDeadlines(start, ms(i.end), i.call_kind, i.ctx);
  const ends = ms(d.ends_at) as number;
  if (i.now >= ends) return refuse("call_over");
  const opens = start - WRAP_EARLY_MIN * MIN;
  if (i.now < opens) return refuse("wrap_too_early", { time: clockWithDay(opens, i.now) });
  // A late wrap (the lead is late, or P4's late step) gets real deadlines from
  // now: the host the handover wait, the lead their 10 minutes, never past the
  // call's end. A room born past its own deadlines would close at the next
  // sweep and record a no-join before anyone could come in.
  const w = i.ctx.waits;
  const hostWait = i.now + w.handover_host * S;
  if (hostWait >= ends) return refuse("call_nearly_over", { minutes: Math.max(1, Math.ceil((w.handover_host * S) / MIN)) });
  const bookedHost = ms(d.host_by) as number;
  const bookedLead = ms(d.lead_by) as number;
  const hostBy = Math.max(bookedHost, hostWait);
  const leadWait = i.now + w.lead * S;
  const leadBy = bookedLead >= leadWait ? bookedLead : Math.max(hostBy, Math.min(leadWait, Math.max(ends, bookedLead)));
  return {
    ok: true,
    provider: meeting.provider,
    join_url: meeting.join_url,
    provider_meeting_id: meeting.meeting_id,
    host_by: iso(hostBy),
    lead_by: iso(leadBy),
    ends_at: d.ends_at,
  };
}

/** The booked room row for a wrap that passed. */
export function wrapRoomRow(n: Omit<NewRoomInput, "purpose" | "provider">, plan: WrapOk): RoomRow {
  return {
    ...newRoomRow({ ...n, purpose: "booked", provider: plan.provider, send_on: "open" }),
    state: "open",
    opened_at: iso(n.now),
    join_url: plan.join_url,
    provider_meeting_id: plan.provider_meeting_id,
    host_by: plan.host_by,
    lead_by: plan.lead_by,
    ends_at: plan.ends_at,
  };
}

// ---------------------------------------------------------------------------
// The panel's line for a room (F "Room panel"; P1's words for fallback rooms)
// ---------------------------------------------------------------------------

export type PanelMoment =
  | "making"
  | "failed"
  | "ready"
  | "link_sent"
  | "not_confirmed"
  | "not_sent"
  | "opened"
  | "waiting_room"
  | "host_in"
  | "joined"
  | "joined_counted"
  | "joined_not_lead"
  | "joined_marked"
  | "no_join"
  | "closed";

export interface PanelCtx {
  now: number;
  waits?: Waits;
  /** The lead's first name, when the view does not carry it. */
  first_name?: string | null;
  /** The first channel the link went on. */
  channel?: LinkChannel | null;
  /** The template was not seen within 20 s; email went too. */
  not_confirmed?: boolean;
  /** Nothing could go: the reason, for "Not sent: {reason}". */
  not_sent_reason?: string | null;
  /** "marked" for a booked intro whose mark was written at the join. */
  count?: "booked" | "moved" | "marked" | "not_a_lead" | null;
  short_link?: boolean;
  /** A fallback room for a booked intro (the room has an appointment_id). */
  booked_intro?: boolean;
}

const WHOLE_SENTENCE_ERRORS = new Set<string>([
  R.meet_pending,
  R.zoom_busy,
  R.zoom_pending,
  R.zoom_basic_demo,
  R.no_google,
  LANE_COPY.zoom_missing,
  LANE_COPY.zoom_unchecked,
  LANE_COPY.meet_unchecked,
  LANE_COPY.zoom_missing_no_meet,
  LANE_COPY.zoom_unchecked_no_meet,
  LANE_COPY.meet_unchecked_no_zoom,
  LANE_COPY.no_google_no_zoom,
]);

/** "The room worker stopped." → "the room worker stopped", for use inside a sentence. */
function clause(s: string): string {
  const t = s.trim().replace(/[.\s]+$/, "");
  return /^(The|A|An|This|That|It|Nobody|No|Your|There)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/** The one sentence the room panel shows now, and the "Still on the call?" prompt when it applies. */
export function panelLine(v: RoomView, c: PanelCtx): { moment: PanelMoment; text: string; prompt: string | null } {
  const P = ROOM_COPY.panel;
  const F1 = ROOM_COPY.panel_fallback;
  const w = c.waits ?? DEFAULT_WAITS;
  const fb = v.purpose === "fallback";
  const first = greetingName(c.first_name ?? v.contact_first_name, null);
  const Name = first || "The lead";
  const name = first || "the lead";
  const clock = (x: string | null) => {
    const t = ms(x);
    return t === null ? "" : kuwaitClock(t);
  };
  const left = (x: string | null) => countdown((ms(x) ?? c.now) - c.now);
  const out = (moment: PanelMoment, text: string, prompt: string | null = null) => ({ moment, text, prompt });

  switch (v.state) {
    case "requested":
    case "creating":
      return out("making", fill(fb ? F1.making : P.making, { provider: providerName(v.provider) }));
    case "failed": {
      const err = (v.error ?? "").trim();
      if (WHOLE_SENTENCE_ERRORS.has(err)) return out("failed", err);
      const reason = clause(err || LANE_COPY.worker_failed);
      if (v.purpose === "handover" && v.provider === "zoom")
        return out("failed", fill(R.zoom_failed_handover, { error: reason }));
      return out(
        "failed",
        fill(F1.failed, { provider: providerName(v.provider), reason, other: providerName(otherProvider(v.provider)) }),
      );
    }
    case "cancelled":
      return out("closed", LANE_COPY.room_closed);
    case "expired": {
      const leadPassed = (ms(v.lead_by) ?? Number.POSITIVE_INFINITY) <= (ms(v.ended_at) ?? c.now);
      if (!v.contact_id || v.purpose === "booked" || !leadPassed) return out("closed", LANE_COPY.room_closed);
      const minutes = Math.round(w.lead / 60);
      // P1's "Mark the intro:" only where there is an intro to mark.
      return out("no_join", fill(fb && c.booked_intro ? F1.expired : P.no_join, { minutes }));
    }
    case "ended":
      // A join "That was not the lead" took back reads as no join (its result is no_join).
      if (v.result === "joined" || (v.result == null && v.lead_in_at))
        return out("joined", fill(LANE_COPY.joined, { name: Name, time: clock(v.lead_in_at) }));
      // Ended by hand, or by Zoom, with nobody in: a booked intro still needs its mark (F8).
      if (v.contact_id && v.result === "no_join" && fb && c.booked_intro) return out("no_join", LANE_COPY.ended_mark_intro);
      return out("closed", LANE_COPY.room_closed);
    case "lead_in": {
      const prompt = (ms(v.ends_at) ?? Number.POSITIVE_INFINITY) <= c.now ? P.still_on_call : null;
      const count = c.count ?? v.count_result ?? null;
      const time = clock(v.lead_in_at);
      if (count === "marked") return out("joined_marked", fill(F1.joined_marked, { name: Name, time }), prompt);
      if (count === "booked" || count === "moved")
        return out("joined_counted", fb ? fill(F1.joined_booked, { name: Name }) : fill(P.joined_counted, { time }), prompt);
      if (count === "not_a_lead")
        return out("joined_not_lead", fb ? fill(F1.joined_not_lead, { name: Name }) : fill(P.joined_not_lead, { time }), prompt);
      return out("joined", fill(LANE_COPY.joined, { name: Name, time }), prompt);
    }
    default:
      break;
  }
  // open or host_in
  if (!v.contact_id) return out("ready", P.ready);
  const link = readOutLink(v.code, v.join_url, c.short_link ?? Boolean(v.short_url && v.short_url !== v.join_url));
  if (c.not_sent_reason && !v.link_sent_at)
    return out("not_sent", fill(fb ? F1.not_sent : P.not_sent, { reason: c.not_sent_reason, link: link ?? v.code }));
  if (v.lead_waiting_at) return out("waiting_room", fb ? fill(F1.waiting_room, { name: Name }) : P.waiting_room);
  if (v.state === "host_in")
    return out("host_in", fb ? fill(F1.host_in, { name, left: left(v.lead_by) }) : fill(P.host_in, { left: left(v.lead_by) }));
  if (v.first_open_at)
    return out(
      "opened",
      fb
        ? fill(F1.opened, { name: Name, time: clock(v.first_open_at) })
        : fill(P.opened, { time: clock(v.first_open_at), device: deviceWords(v.open_device) }),
    );
  if (c.not_confirmed) return out("not_confirmed", fb ? F1.not_confirmed : P.not_confirmed);
  if (v.link_sent_at) {
    const channel = channelName(c.channel ?? v.link_channels[0]);
    return out(
      "link_sent",
      fb
        ? fill(F1.sent, { channel, time: clock(v.link_sent_at), name, left: left(v.lead_by) })
        : fill(P.link_sent, { channel, time: clock(v.link_sent_at) }),
    );
  }
  return out("ready", P.ready);
}

// ---------------------------------------------------------------------------
// Lines with a clause that may be unknown (F10): the clause goes, never a
// raw {placeholder}. Slack's lines are written by the desk from the same
// sentences.
// ---------------------------------------------------------------------------

function plural(n: number, one: string): string {
  const k = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${k} ${k === 1 ? one : `${one}s`}`;
}

/** Slack's offer to a closer (P2): the company, country or note left out when not known. */
export function offerLine(o: {
  kind: CallKind;
  name?: string | null;
  company?: string | null;
  country?: string | null;
  note?: string | null;
}): string {
  // Posted to Slack: the lead's name and company (from their own form) and
  // the setter's note never reach it as markup.
  const safe = (v: string | null) => (v === null ? null : slackSafe(v));
  const note = safe(str(o.note, 200));
  let text: string = o.kind === "intro" ? LANE_COPY.offer_intro : ROOM_COPY.slack.offer;
  if (!note) text = text.replace(" Note: {note}.", "");
  return fill(text, {
    name: slackSafe(greetingName(o.name, null)) || "a lead",
    company: safe(str(o.company, 80)),
    country: safe(str(o.country, 60)),
    note,
  });
}

/** The strip's offer (F): the country or note left out when not known. */
export function stripOfferLine(o: { kind: CallKind; country?: string | null; note?: string | null; left_ms: number }): string {
  const note = str(o.note, 200);
  let text: string = ROOM_COPY.strip.offer;
  if (!note) text = text.replace(" Note: {note}.", "");
  return fill(text, { kind: o.kind, country: str(o.country, 60), note, left: countdown(o.left_ms) });
}

/** Slack's App Home count: "Ready now: 1 closer, 2 setters." (F21). */
export function appHomeReadyLine(closers: number, setters: number): string {
  return fill(LANE_COPY.app_home_ready, { closers: plural(closers, "closer"), setters: plural(setters, "setter") });
}

// ---------------------------------------------------------------------------
// Conditional writes (F24)
// ---------------------------------------------------------------------------

/**
 * The PostgREST filter for a conditional write's `expect`, every value
 * encoded. A stored time comes back from Postgres as "...+00:00", and an
 * unencoded "+" reads as a space, so the write would never match and a
 * re-read loop would never end. Null is `is.null`. A value that cannot
 * guard a write (an object or a list) throws, so a guard is never dropped
 * quietly. A lost write is read and tried again at most MAX_WRITE_TRIES times.
 */
export function guardFilter(expect: Partial<RoomRow> | Record<string, unknown>): string {
  return Object.entries(expect)
    .map(([k, v]) => {
      if (!/^[a-z_]+$/.test(k)) throw new Error(`Not a column: ${k}`);
      if (v === null || v === undefined) return `${k}=is.null`;
      if (typeof v === "number" && Number.isFinite(v)) return `${k}=eq.${v}`;
      if (typeof v === "boolean") return `${k}=is.${v}`;
      if (typeof v === "string") return `${k}=eq.${encodeURIComponent(v)}`;
      throw new Error(`A ${typeof v} cannot guard a write: ${k}`);
    })
    .join("&");
}
