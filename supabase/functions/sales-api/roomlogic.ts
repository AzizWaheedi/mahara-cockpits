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
// Three rules hold everywhere and are tested on 10,000 random runs:
// - a final room (ended, expired, failed, cancelled) never changes again;
// - no timer ends a room with the lead in it: a lead_in room is only closed
//   in the books at ends_at + no_end_signal ("No end signal"), and no
//   provider call is ever made for a room that reached lead_in;
// - host_by, lead_by and ends_at only ever move later.

import { isClient } from "./clients.ts";
import { BOOKING_CALENDARS } from "./dialer.ts";
import { dndFor, greetingName, whatsappWindow } from "./lib.ts";

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
export const COUNT_RESULTS = ["booked", "moved", "not_a_lead", "failed", "undone"] as const;
export type CountResult = (typeof COUNT_RESULTS)[number];
export const SETTLED_MARKS = ["showed", "noshow", "none"] as const;
export type SettledMark = (typeof SETTLED_MARKS)[number];
export const SEND_ON = ["open", "host_in"] as const;
export type SendOn = (typeof SEND_ON)[number];
/** room.mark's `what` (contract). */
export const ROOM_MARKS = ["host_in", "lead_in", "not_lead"] as const;
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
/** The worker's status row turns the health line red after this long (1.7). */
export const WORKER_RED_AFTER_S = 90;
/** A stored door event older than this is left for a person, not replayed. */
export const REPLAY_MAX_AGE_S = 86_400;

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
  return g.connector_off === true && ms(g.single_copy_ok_at) !== null;
}

/** The context every room rule needs. */
export interface RoomCtx {
  waits: Waits;
  lengths_min: Record<CallKind, number>;
  /** The host's first name for "This room belongs to {host}."; else taken from the email. */
  host_first_name?: string | null;
}

export function roomCtx(setting?: Pick<RoomsSetting, "waits_s" | "lengths_min"> | null): RoomCtx {
  return {
    waits: setting?.waits_s ? { ...setting.waits_s } : { ...DEFAULT_WAITS },
    lengths_min: setting?.lengths_min ? { ...setting.lengths_min } : { intro: 30, demo: 60 },
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
    no_google: "Connect your Google calendar on the Team page first.", // F edge
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
    down: "Rooms are down. The room worker last ran at {time}. New rooms cannot be made.",
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
  disabled: "Video rooms are off for now. Call or message the lead instead.",
  provider_off: "{provider} rooms are off for now. Use {other}.",
  test_only: "Video rooms are in testing, so they work only for the test contact for now.",
  no_contact: "Which lead?",
  zoom_missing: "Your Zoom user is not set up on Mahara's account yet. Ask the manager to add it on the Team page. Meet works now.",
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
  worker_late: "The room worker did not pick this room up in time.",
  worker_lost: "The room worker stopped half way through making this room.",
  worker_failed: "The room could not be made.",
  room_closed: "Room closed.",
  joined: "{name} joined at {time}.",
  health_never: "Rooms are down. The room worker has not run yet. New rooms cannot be made.",
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
  why_no_short_link: "the short link is not live yet",
  why_email_off: "email is off for video links",
  why_no_email: "the lead has no email address",
  why_email_dnd: "do not disturb is on for email",
} as const;

/** Puts values into a sentence's {placeholders}; an unknown one stays as it is. Template {{1}} slots are left alone. */
export function fill(text: string, vars: Record<string, string | number | null | undefined> = {}): string {
  return text.replace(/\{([a-z_]+)\}/g, (all, k: string) => {
    const v = vars[k];
    return v === null || v === undefined || v === "" ? all : String(v);
  });
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

function safeUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 2000 || !/^https:\/\/\S+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname ? s : null;
  } catch {
    return null;
  }
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
  link_sent_at?: string | null;
  first_open_at?: string | null;
  lead_waiting_at?: string | null;
  host_in_at?: string | null;
  lead_in_at?: string | null;
  ended_at?: string | null;
  open_device?: string | null;
  link_message_ids?: unknown;
  link_channels?: unknown;
  count_claimed_at?: string | null;
  count_appointment_id?: string | null;
  count_result?: CountResult | null;
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

export type SweepReason = "fail" | "recover" | "host_by" | "lead_by" | "standby_max" | "booked_guard" | "no_end_signal";

/**
 * The timers running on a room, each with when it fires. Every room that is
 * not final has at least one, so nothing can wait forever. Where a stored
 * deadline is missing (a damaged row), the spec's wait from the room's own
 * times stands in.
 *
 * - requested: fail at requested + 60 s.
 * - creating: recover at claimed + 60 s (the worker looks for the code in
 *   Zoom's topics or the Google event id), failed at claimed + 120 s.
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
        { reason: "recover", at: base + w.fail * S },
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

export type RoomEvent =
  /** The worker's conditional claim: requested → creating. */
  | { kind: "claim"; worker_run?: string | null }
  /** The worker saved the link: creating → open. */
  | { kind: "ready"; join_url: string; provider_meeting_id?: string | null }
  /** The provider refused, or the worker gave up: requested or creating → failed. */
  | { kind: "fail"; error: string }
  /** The message service sent the link (the first send starts the lead's 10 minutes). */
  | { kind: "link_sent"; channel?: LinkChannel | null }
  /** The short page counted an open (bots excluded). */
  | { kind: "opened"; device?: Device | null }
  /** Zoom put the lead in the waiting room. */
  | { kind: "lead_waiting" }
  /** Zoom's host joined, or the rep's "I'm in". */
  | { kind: "host_in"; source: "zoom" | "mark"; actor?: Actor; version?: number }
  /** Zoom's host left before the lead came. */
  | { kind: "host_left" }
  /** A Zoom join from outside the account, or the rep's "The lead is in". */
  | { kind: "lead_in"; source: "zoom" | "mark"; actor?: Actor; version?: number }
  /** "That was not the lead", within 5 minutes of the join. */
  | { kind: "not_lead"; actor?: Actor; version?: number }
  /** room.end, or the system ending a room. */
  | { kind: "end"; reason: EndReason; actor?: Actor; version?: number; confirm?: boolean }
  /** Zoom's meeting.ended. */
  | { kind: "meeting_ended" }
  /** Take on a standby room: the lead is set and the room becomes a handover. */
  | { kind: "adopt"; contact_id: string; call_kind: CallKind; handover_id?: string | null; actor?: Actor }
  /** The sweep, with the host's next booked call if one is near. */
  | { kind: "tick"; next_booked_start?: number | null };

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
  "end",
  "meeting_ended",
  "adopt",
  "tick",
] as const;

/** What the caller must do after a change is written. */
export type Effect =
  | { kind: "send_link" }
  | { kind: "close_provider" }
  | { kind: "delete_secret" }
  | { kind: "count_live" }
  | { kind: "undo_count" }
  | { kind: "recover" }
  | { kind: "refresh_standby" }
  | { kind: "replace"; provider: Provider }
  | { kind: "alert"; what: "booked_guard"; dedupe_key: string };

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
  | "disabled"
  | "provider_off"
  | "test_only"
  | "client"
  | "dnd"
  | "booked_demo"
  | "lead_has_room"
  | "host_has_room"
  | "zoom_busy"
  | "zoom_basic_demo"
  | "zoom_pending"
  | "zoom_missing"
  | "no_google"
  | "meet_pending"
  | "phone_call"
  | "call_over";

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
  disabled: { text: LANE_COPY.disabled, status: 409 },
  provider_off: { text: LANE_COPY.provider_off, status: 409 },
  test_only: { text: LANE_COPY.test_only, status: 409 },
  client: { text: R.client, status: 409 },
  dnd: { text: R.dnd, status: 409 },
  booked_demo: { text: R.booked_demo, status: 409 },
  lead_has_room: { text: R.lead_has_room, status: 409 },
  host_has_room: { text: R.host_has_room, status: 409 },
  zoom_busy: { text: R.zoom_busy, status: 409 },
  zoom_basic_demo: { text: R.zoom_basic_demo, status: 409 },
  zoom_pending: { text: R.zoom_pending, status: 409 },
  zoom_missing: { text: LANE_COPY.zoom_missing, status: 409 },
  no_google: { text: R.no_google, status: 409 },
  meet_pending: { text: R.meet_pending, status: 502 },
  phone_call: { text: R.phone_call, status: 409 },
  call_over: { text: LANE_COPY.call_over, status: 409 },
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

/** The link is due: the room has a lead and a link, nothing went yet, and the room is at its `send_on` point (C20). */
export function linkDue(room: RoomRow): boolean {
  if (!room.contact_id || room.link_sent_at || !room.join_url) return false;
  if (room.purpose === "booked" || room.purpose === "standby") return false;
  if (room.send_on === "host_in") return room.state === "host_in";
  return room.state === "open" || room.state === "host_in";
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

/**
 * Applies one event to a room at time `now`. Pure: it returns the patch, the
 * conditional-write guard and the follow-up effects; the caller writes it
 * with `state=eq.{from}` (and `version=eq.{v}` on a state change) and runs
 * the effects only if the write landed.
 *
 * Order of checks: the event's shape; the actor (host or manager); a final
 * room (an End is a no-op, a person's other press is stale, a system event is
 * dropped); the version the button saw; then the event's own rule.
 */
export function applyRoomEvent(room: RoomRow, event: RoomEvent, now: number, ctx: RoomCtx): Applied {
  if (!room || !isRoomState(room.state) || !isPurpose(room.purpose)) return refuse("bad_input");
  if (!event || typeof event !== "object" || !oneOf(ROOM_EVENT_KINDS, event.kind)) return refuse("bad_input");
  if (!Number.isFinite(now)) return refuse("bad_input");
  const w = ctx.waits;
  const at = iso(now);
  const actor = (event as { actor?: Actor }).actor;
  if (actor && !mayAct(room, actor)) return refuse("not_host", { host: hostFirstName(room, ctx) });

  if (isFinal(room.state)) {
    if (event.kind === "end" || event.kind === "tick") return same(room);
    if (actor) return refuse("stale");
    const r = refuse("final");
    if (event.kind === "ready") r.cleanup = true;
    return r;
  }
  const seen = (event as { version?: unknown }).version;
  if (seen !== undefined && seen !== null && Number(seen) !== ver(room)) return refuse("stale");
  const early = room.state === "requested" || room.state === "creating";

  switch (event.kind) {
    case "claim":
      if (room.state !== "requested") return refuse("not_requested");
      return change(room, "creating", {
        claimed_at: at,
        ...(str(event.worker_run, 80) ? { worker_run: str(event.worker_run, 80) } : {}),
      }, []);

    case "ready": {
      const url = safeUrl(event.join_url);
      if (!url) return refuse("bad_link");
      if (room.state === "requested") return refuse("not_claimed");
      if (room.state !== "creating") return room.join_url === url ? same(room) : refuse("already_open");
      const patch: Partial<RoomRow> = {
        opened_at: at,
        join_url: url,
        provider_meeting_id: str(event.provider_meeting_id, 200) ?? room.provider_meeting_id ?? null,
      };
      if (room.purpose !== "booked") {
        patch.host_by = laterIso(room.host_by, now + hostWaitS(room.purpose, w) * S);
        if (room.contact_id) patch.lead_by = laterIso(room.lead_by, (ms(room.link_sent_at) ?? now) + w.lead * S);
        patch.ends_at = laterIso(room.ends_at, now + lengthMs(room.call_kind, ctx));
      }
      const next: RoomRow = { ...room, ...patch, state: "open" };
      return change(room, "open", patch, linkDue(next) ? [{ kind: "send_link" }] : []);
    }

    case "fail": {
      if (!early) return refuse("already_open");
      const error = str(event.error, 300) ?? LANE_COPY.worker_failed;
      return change(room, "failed", { error, result: "failed", ended_at: at }, finalEffects(room));
    }

    case "link_sent": {
      if (!room.contact_id) return refuse("no_lead");
      if (early) return refuse("too_early");
      if (room.link_sent_at) return same(room);
      const patch: Partial<RoomRow> = { link_sent_at: at };
      if (room.state !== "lead_in") {
        const lead = laterIso(room.lead_by, now + w.lead * S);
        if (lead !== room.lead_by) patch.lead_by = lead;
      }
      return change(room, room.state, patch, []);
    }

    case "opened":
    case "lead_waiting": {
      if (event.kind === "lead_waiting" && early) return refuse("too_early");
      if (event.kind === "lead_waiting" && (room.state === "lead_in" || !room.contact_id)) return same(room);
      const patch: Partial<RoomRow> = {};
      if (event.kind === "opened" && !room.first_open_at) {
        patch.first_open_at = at;
        const device = oneOf(DEVICES, event.device) ? event.device : null;
        if (device && !room.open_device) patch.open_device = device;
      }
      if (event.kind === "lead_waiting" && !room.lead_waiting_at) patch.lead_waiting_at = at;
      // An open (or a knock) in the last 3 minutes moves lead_by to open + 180 s.
      const lead = ms(room.lead_by);
      if ((room.state === "open" || room.state === "host_in") && lead !== null && now + w.open_grace * S > lead)
        patch.lead_by = iso(now + w.open_grace * S);
      return Object.keys(patch).length ? change(room, room.state, patch, []) : same(room);
    }

    case "host_in": {
      if (early) return refuse("too_early");
      if (room.state !== "open") return same(room);
      const patch: Partial<RoomRow> = { host_in_at: at };
      const next: RoomRow = { ...room, ...patch, state: "host_in" };
      return change(room, "host_in", patch, linkDue(next) ? [{ kind: "send_link" }] : []);
    }

    case "host_left": {
      if (early) return refuse("too_early");
      if (room.state !== "host_in") return same(room);
      // P2: the host left before the lead came; host_by gives them 120 s more, never less than it had.
      return change(room, "open", { host_by: laterIso(room.host_by, now + w.handover_host * S) }, []);
    }

    case "lead_in": {
      if (early) return refuse("too_early");
      if (room.state === "lead_in") return same(room);
      if (!room.contact_id) return refuse("no_lead");
      const patch: Partial<RoomRow> = { lead_in_at: at };
      if (room.purpose !== "booked") {
        const ends = laterIso(room.ends_at, now + lengthMs(room.call_kind, ctx));
        if (ends !== room.ends_at) patch.ends_at = ends;
      }
      return change(room, "lead_in", patch, [{ kind: "count_live" }]);
    }

    case "not_lead": {
      if (room.state !== "lead_in") return refuse("stale");
      const joined = ms(room.lead_in_at);
      if (joined === null || now - joined > w.not_lead_undo * S)
        return refuse("not_lead_late", { minutes: Math.round(w.not_lead_undo / 60) });
      // Back to waiting for the real lead, with at least the open grace left so the sweep does not close it at once.
      const patch: Partial<RoomRow> = { lead_by: laterIso(room.lead_by, now + w.open_grace * S) };
      return change(room, "host_in", patch, room.count_claimed_at ? [{ kind: "undo_count" }] : []);
    }

    case "end": {
      const reason = event.reason;
      if (!oneOf(END_REASONS, reason)) return refuse("bad_input");
      if (room.state === "lead_in") {
        if (reason === "admit_blocked") return refuse("stale");
        if (reason !== "finished" && event.confirm !== true) return refuse("confirm_end");
        // A room with the lead in it: no provider call, ever (C15).
        return change(room, "ended", { result: "joined", ended_at: at }, [{ kind: "delete_secret" }]);
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
      const result: RoomResult | null = room.state === "lead_in" ? "joined" : room.contact_id ? "no_join" : null;
      return change(room, "ended", { result, ended_at: at }, [{ kind: "delete_secret" }]);
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
      const next: RoomRow = { ...room, ...patch };
      return change(room, room.state, patch, linkDue(next) ? [{ kind: "send_link" }] : [], null, true);
    }

    case "tick":
      return tick(room, now, ctx, event.next_booked_start ?? null);
  }
  return refuse("bad_input");
}

/**
 * The sweep for one room. Fires the earliest timer that is due. A standby
 * room nobody has been given closes 10 minutes before the host's next booked
 * call; any other room near that call only raises an alert, because a room
 * with a lead in it is never ended (H7).
 */
function tick(room: RoomRow, now: number, ctx: RoomCtx, nextBooked: number | null): Changed {
  const w = ctx.waits;
  const list = timers(room, ctx);
  const alerts: Effect[] = [];
  if (nextBooked !== null && Number.isFinite(nextBooked) && room.purpose !== "booked") {
    const guardAt = nextBooked - w.booked_guard * S;
    if (now >= guardAt) {
      if (standbyEmpty(room) && (room.state === "open" || room.state === "host_in"))
        list.push({ reason: "booked_guard", at: guardAt });
      else if (room.state === "open" || room.state === "host_in" || room.state === "lead_in")
        alerts.push({ kind: "alert", what: "booked_guard", dedupe_key: `room:${room.id}:booked_guard:${iso(nextBooked)}` });
    }
  }
  const at = iso(now);
  if (room.state === "creating") {
    const fail = list.find(t => t.reason === "fail");
    const recover = list.find(t => t.reason === "recover");
    if (fail && now >= fail.at)
      return change(room, "failed", { error: LANE_COPY.worker_lost, result: "failed", ended_at: at }, finalEffects(room), "fail");
    if (recover && now >= recover.at) return same(room, [{ kind: "recover" }, ...alerts], "recover");
    return same(room, alerts);
  }
  const due = list.filter(t => t.reason !== "recover" && now >= t.at).sort((a, b) => a.at - b.at)[0];
  if (!due) return same(room, alerts);
  if (room.state === "requested")
    return change(room, "failed", { error: LANE_COPY.worker_late, result: "failed", ended_at: at }, finalEffects(room), "fail");
  if (room.state === "lead_in") {
    // Closed in the books only. No end call goes to Zoom or Google (C15).
    const error = room.provider === "zoom" ? ROOM_COPY.panel.no_end_signal : ROOM_COPY.panel.no_end_signal_any;
    return change(room, "ended", { error, result: "joined", ended_at: at }, [{ kind: "delete_secret" }, ...alerts], "no_end_signal");
  }
  const effects = finalEffects(room);
  if (due.reason === "standby_max") effects.push({ kind: "refresh_standby" });
  return change(room, "expired", { result: room.contact_id ? "no_join" : null, ended_at: at }, [...effects, ...alerts], due.reason);
}

/** Runs the sweep on one room: the same as applying a tick. */
export function sweepRoom(room: RoomRow, now: number, ctx: RoomCtx, nextBookedStart: number | null = null): Applied {
  return applyRoomEvent(room, { kind: "tick", next_booked_start: nextBookedStart }, now, ctx);
}

/** room.mark's three presses as room events. */
export function markEvent(what: unknown, actor: Actor, version: number): RoomEvent | null {
  if (what === "host_in") return { kind: "host_in", source: "mark", actor, version };
  if (what === "lead_in") return { kind: "lead_in", source: "mark", actor, version };
  if (what === "not_lead") return { kind: "not_lead", actor, version };
  return null;
}

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
 * P1, decision D14: a fallback room for a booked intro that expired with no
 * mark becomes a no-show at the intro's start + 20 minutes (room.settle). A
 * room with no booking writes nothing.
 */
export function settleDue(room: RoomRow, appointmentStart: unknown, marked: boolean, now: number, w: Waits): boolean {
  if (room.state !== "expired" || room.purpose === "booked" || room.call_kind !== "intro") return false;
  if (!room.appointment_id || room.settled_mark || marked) return false;
  const start = ms(appointmentStart);
  return start !== null && now >= start + w.settle * S;
}

// ---------------------------------------------------------------------------
// The queue hold (C6): a lead stays out of the dialer's queue while their
// room is not final and its deadline is still ahead.
// ---------------------------------------------------------------------------

/**
 * When the hold on a room's lead ends, or null for none:
 * coalesce(lead_by, host_by, requested_at + fail). A room with the lead in it
 * holds until its no-end-signal time, so a lead on a video call is not
 * dialled; that is still bounded, so a stuck row cannot hold anyone for good.
 */
export function holdUntil(room: RoomRow, ctx: RoomCtx): number | null {
  if (!room.contact_id || !isRoomState(room.state) || isFinal(room.state)) return null;
  if (room.state === "lead_in") return timers(room, ctx)[0]?.at ?? null;
  const t = ms(room.lead_by) ?? ms(room.host_by);
  if (t !== null) return t;
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
            : !health.ok
              ? L.why_wa_health
              : null;
  const window = whatsappWindow(i.last_inbound_at, i.now);
  const why: Record<LinkChannel, string | null> = {
    whatsapp_text: common ?? (!i.setting.send.whatsapp_text ? L.why_wa_off : !window.open ? L.why_window : null),
    whatsapp_template:
      common ??
      (!i.setting.send.whatsapp_template
        ? L.why_wa_off
        : !i.setting.short_link
          ? L.why_no_short_link
          : !i.template_live
            ? L.why_no_template
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
  /** participant_uuids seen in this meeting's waiting room, which only people outside the account enter. */
  waited?: readonly string[];
}

/** The seven events subscribed (C19). */
export const ZOOM_EVENTS = [
  "meeting.started",
  "meeting.ended",
  "meeting.participant_joined",
  "meeting.participant_left",
  "meeting.participant_joined_waiting_room",
  "meeting.participant_jbh_waiting",
  "meeting.participant_jbh_joined",
] as const;

export type ZoomRole = "host" | "staff" | "lead";

/**
 * Staff or lead (F "Who is who", P1, P2). In order:
 * 1. the host: Zoom's host id, the room host's Zoom user, or the host's email;
 * 2. staff: an email or Zoom user in room_hosts;
 * 3. a lead: anyone who came through the waiting room, which the account
 *    sends only people outside it to, even if they signed in to Zoom;
 * 4. staff: anyone else Zoom gives a participant_user_id (signed in);
 * 5. otherwise the lead.
 * Step 3 keeps a lead signed in to their own Zoom from looking like staff,
 * which would let the room expire around them. Zoom's field meanings are
 * UNVERIFIED on recorded payloads from this account.
 */
export function zoomRole(p: ZoomParticipant | null | undefined, meetingHostId: unknown, ctx: ZoomStaffCtx): ZoomRole {
  const id = str(p?.id, 100);
  const puid = str(p?.participant_user_id, 100);
  const email = lower(p?.email);
  const uuid = str(p?.participant_uuid, 100);
  const hostIds = [str(meetingHostId, 100), str(ctx.host_zoom_user_id, 100)].filter((x): x is string => Boolean(x));
  if ((id && hostIds.includes(id)) || (puid && hostIds.includes(puid))) return "host";
  if (email && email === lower(ctx.host_email)) return "host";
  if (email && (ctx.staff_emails ?? []).some(e => lower(e) === email)) return "staff";
  if ((id && (ctx.staff_zoom_user_ids ?? []).includes(id)) || (puid && (ctx.staff_zoom_user_ids ?? []).includes(puid)))
    return "staff";
  if (uuid && (ctx.waited ?? []).includes(uuid)) return "lead";
  if (puid) return "staff";
  return "lead";
}

export type ZoomEffect = { room_event: RoomEvent; role: ZoomRole | null } | { ignore: string; role: ZoomRole | null };

/** What a Zoom event does to its room. The first lead in sets lead_in; later ones change nothing. */
export function zoomEffect(evt: ZoomEvent | null | undefined, ctx: ZoomStaffCtx): ZoomEffect {
  const name = String(evt?.event ?? "");
  const o = evt?.payload?.object;
  const p = o?.participant;
  const role = p ? zoomRole(p, o?.host_id, ctx) : null;
  switch (name) {
    case "meeting.started":
      return { room_event: { kind: "host_in", source: "zoom" }, role: null };
    case "meeting.ended":
      return { room_event: { kind: "meeting_ended" }, role: null };
    case "meeting.participant_joined":
    case "meeting.participant_jbh_joined":
      if (role === "host") return { room_event: { kind: "host_in", source: "zoom" }, role };
      if (role === "lead") return { room_event: { kind: "lead_in", source: "zoom" }, role };
      return { ignore: "staff joined", role };
    case "meeting.participant_left":
      if (role === "host") return { room_event: { kind: "host_left" }, role };
      return { ignore: role === "lead" ? "the lead left; the meeting's end closes the room" : "staff left", role };
    case "meeting.participant_joined_waiting_room":
    case "meeting.participant_jbh_waiting":
      if (role === "lead") return { room_event: { kind: "lead_waiting" }, role };
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
/** A test contact: listed in rooms.test_contacts, or tagged cockpit-test (C34). */
export function isTestContact(contactId: unknown, tags: unknown, setting: Pick<RoomsSetting, "test_contacts">): boolean {
  const id = String(contactId ?? "").trim();
  if (id && setting.test_contacts.includes(id)) return true;
  return Array.isArray(tags) && tags.some(t => lower(t) === "cockpit-test");
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
  /** upcoming() for the room's call kind: the lead's next call booked ahead, if any. */
  upcoming: { id: string; start: number; kind: CallKind } | null;
  host_ghl_user_id: string | null;
  location_id: string;
  /** The short link, or the room's own link before the CNAME. */
  link: string | null;
  calendars?: { intro_qualified: string; intro_unqualified: string; demo: string };
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
  | "host_not_in_highlevel";

export type CountPlan =
  | { action: "none"; claim: boolean; count_result: CountResult | null; reason: CountSkip }
  | { action: "mark"; claim: true; appointment_id: string }
  | { action: "move"; claim: true; appointment_id: string; from_start: string; start: string; end: string; body: Row }
  | { action: "create"; claim: true; test: boolean; calendar_id: string; start: string; end: string; body: Row };

/** The claim may be taken: never taken, or taken and then undone ("That was not the lead"). */
export function countClaimable(room: RoomRow): boolean {
  return !room.count_claimed_at || room.count_result === "undone";
}

/**
 * What to do when the lead joins. The caller first claims with a
 * conditional PATCH (count_claimed_at is null, or count_result = undone)
 * whenever `claim` is true, and does nothing if the claim is lost.
 *
 * - Switched off, standby, not joined, already claimed: nothing.
 * - A booked room (the closer's own demo): nothing; the closer marks it.
 * - A fallback room for a booked intro: mark that intro shown.
 * - A client: not a lead.
 * - A test contact: booked only on rooms.test_calendar_id, never moved, and
 *   nothing at all when that calendar is not set.
 * - No roas tag: not a lead, nothing booked.
 * - A host with no HighLevel user: failed (refuseMark needs one).
 * - A call of the same kind booked ahead: moved to now (PUT).
 * - Otherwise a new booking (POST): the intro calendar by tag, or the demo
 *   calendar, at the minute the lead joined, 15 or 45 minutes long.
 */
export function countLive(i: CountInput): CountPlan {
  const { room, setting } = i;
  const cal = i.calendars ?? BOOKING_CALENDARS;
  const none = (reason: CountSkip, claim: boolean, count_result: CountResult | null = null): CountPlan => ({
    action: "none",
    claim,
    count_result,
    reason,
  });
  if (!setting.count_on_join) return none("switch_off", false);
  if (!room.contact_id) return none("no_contact", false);
  const joined = ms(room.lead_in_at);
  if (joined === null) return none("not_joined", false);
  if (!countClaimable(room)) return none("claimed", false);
  if (room.purpose === "booked") return none("booked_room", false);
  if (room.appointment_id) return { action: "mark", claim: true, appointment_id: room.appointment_id };
  const c = i.contact ?? {};
  if (isClient(c)) return none("client", true, "not_a_lead");
  const test = isTestContact(room.contact_id, c.tags, setting);
  if (!test && !isTaggedLead(c.tags)) return none("not_a_lead", true, "not_a_lead");
  if (test && !setting.test_calendar_id) return none("test_calendar_missing", true, "not_a_lead");
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
  if (!test && i.upcoming && i.upcoming.id && i.upcoming.kind === room.call_kind && Number.isFinite(i.upcoming.start))
    return {
      action: "move",
      claim: true,
      appointment_id: i.upcoming.id,
      from_start: iso(i.upcoming.start),
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
  const calendarId = test
    ? (setting.test_calendar_id as string)
    : room.call_kind === "demo"
      ? cal.demo
      : leadClassOf(c.tags) === "qualified"
        ? cal.intro_qualified
        : cal.intro_unqualified;
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

export type UndoPlan =
  | { action: "none"; reason: "nothing" | "in_flight" | "moved_from_unknown" }
  | { action: "delete"; appointment_id: string }
  | { action: "move_back"; appointment_id: string; start: string }
  | { action: "unmark"; appointment_id: string };

/**
 * "That was not the lead": delete a booking countLive made, move a moved one
 * back (its old start is read from the room's count event), or take back the
 * mark on a booked intro. Never a mark of invalid, which B2B counts as shown.
 */
export function countUndo(room: RoomRow, movedFrom: unknown = null): UndoPlan {
  if (!room.count_claimed_at) return { action: "none", reason: "nothing" };
  const appt = str(room.count_appointment_id, 80);
  switch (room.count_result ?? null) {
    case "booked":
      return appt ? { action: "delete", appointment_id: appt } : { action: "none", reason: "in_flight" };
    case "moved": {
      const from = isoOrNull(movedFrom);
      if (!appt) return { action: "none", reason: "in_flight" };
      return from ? { action: "move_back", appointment_id: appt, start: from } : { action: "none", reason: "moved_from_unknown" };
    }
    case null:
      return appt && appt === room.appointment_id
        ? { action: "unmark", appointment_id: appt }
        : { action: "none", reason: "in_flight" };
    default:
      return { action: "none", reason: "nothing" };
  }
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
 * 2. ready: in their own standby room with no lead;
 * 3. available: pressed Available and the time has not run out;
 * 4. away.
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
  if (standby) return { ...base, state: "ready", until, room_id: standby.id, why: "standby" };
  if (availUntil !== null) {
    const openStandby = mine.find(r => standbyEmpty(r));
    return { ...base, state: "available", until, room_id: openStandby?.id ?? null, why: "available" };
  }
  return { ...base, state: "away", until: null, room_id: null, why: "away" };
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
): Provider {
  const pref: Provider = isProvider(host?.default_provider)
    ? host.default_provider
    : role === "closer"
      ? setting.default_provider.closer
      : setting.default_provider.setter;
  const usable = (p: Provider) =>
    setting.providers[p] &&
    (p === "zoom" ? host?.zoom_status === "licensed" || host?.zoom_status === "basic" : host?.google_ok === true);
  if (usable(pref)) return pref;
  return usable(otherProvider(pref)) ? otherProvider(pref) : pref;
}

// ---------------------------------------------------------------------------
// The health line (F "Health line", 1.7)
// ---------------------------------------------------------------------------

export interface Health {
  worker_ok: boolean;
  last_run_at: string | null;
  rooms_today: number;
  failed_today: number;
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
}): Health {
  const last = ms(i.last_run_at);
  const ok = last !== null && i.now - last <= WORKER_RED_AFTER_S * S && last - i.now <= 5 * MIN;
  const made = countOf(i.rooms_today);
  const failed = countOf(i.failed_today);
  const mismatched = countOf(i.mismatched_today);
  let line: string;
  if (!ok)
    line = last === null ? LANE_COPY.health_never : fill(ROOM_COPY.health.down, { time: clockWithDay(last, i.now) });
  else if (mismatched !== null && mismatched > 0)
    line = fill(mismatched === 1 ? ROOM_COPY.health.mismatch : LANE_COPY.health_mismatch_many, { rooms: rooms(mismatched) });
  else if (made === null || failed === null)
    line = fill(LANE_COPY.health_working_no_counts, { time: kuwaitClockSeconds(last as number) });
  else line = fill(ROOM_COPY.health.working, { time: kuwaitClockSeconds(last as number), rooms: rooms(made), failed });
  return {
    worker_ok: ok,
    last_run_at: last === null ? null : iso(last),
    rooms_today: made ?? 0,
    failed_today: failed ?? 0,
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
  ended_at: string | null;
  host_by: string | null;
  lead_by: string | null;
  ends_at: string | null;
  result: RoomResult | null;
  count_result: CountResult | null;
  error: string | null;
  refusal: string | null;
  created_at: string | null;
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
  "ended_at",
  "host_by",
  "lead_by",
  "ends_at",
  "result",
  "count_result",
  "error",
  "refusal",
  "created_at",
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
  opts: { short_link: boolean; contact_first_name?: unknown; refusal?: string | null },
): RoomView {
  const first = greetingName(opts.contact_first_name, null);
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
    lead_in_at: isoOrNull(row.lead_in_at),
    ended_at: isoOrNull(row.ended_at),
    host_by: isoOrNull(row.host_by),
    lead_by: isoOrNull(row.lead_by),
    ends_at: isoOrNull(row.ends_at),
    result: oneOf(ROOM_RESULTS, row.result) ? row.result : null,
    count_result: oneOf(COUNT_RESULTS, row.count_result) ? row.count_result : null,
    error: str(row.error, 300),
    refusal: str(opts.refusal, 300),
    created_at: isoOrNull(row.created_at) ?? isoOrNull(row.requested_at),
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
}

export interface CreateInput {
  setting: RoomsSetting;
  purpose: unknown;
  provider: unknown;
  call_kind: unknown;
  contact_id: string | null;
  contact: Row | null;
  host: HostFacts | null;
  lead_room_open: boolean;
  host_room_open: boolean;
  /** The lead has a demo booked ahead: its Zoom link comes from HighLevel. */
  booked_demo: boolean;
}

/**
 * room.create's checks, before anything is written, in the spec's order:
 * the switches, the test list, client and do-not-disturb first (F
 * "Security"), the booked demo, one room per lead and per host, then the
 * host's provider. Null means the room may be made. Booked rooms come from
 * room.wrap, never from here (C4).
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
  if (!s.providers[provider])
    return refuse("provider_off", { provider: providerName(provider), other: providerName(otherProvider(provider)) });
  if (contact && s.test_only && !isTestContact(contact, i.contact?.tags, s)) return refuse("test_only");
  if (contact && i.contact && isClient(i.contact)) return refuse("client");
  if (contact && dndEveryChannel(i.contact)) return refuse("dnd");
  if (i.booked_demo && (purpose === "fallback" || purpose === "manual")) return refuse("booked_demo");
  if (contact && i.lead_room_open) return refuse("lead_has_room", {}, purpose);
  if (i.host_room_open) return refuse("host_has_room");
  const h = i.host;
  if (provider === "zoom") {
    const st = h?.zoom_status ?? null;
    if (!st || st === "missing") return refuse("zoom_missing");
    if (st === "pending") return refuse("zoom_pending");
    if (st === "basic" && i.call_kind === "demo") return refuse("zoom_basic_demo");
    if (h?.zoom_live) return refuse("zoom_busy");
  } else if (!h?.google_ok) return refuse("no_google");
  return null;
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
    created_at: t,
  };
}

/** The meeting an appointment's `address` holds: a Zoom or Meet link, or null for a phone call. */
export function meetingFromAddress(address: unknown): { provider: Provider; join_url: string; meeting_id: string | null } | null {
  const s = typeof address === "string" ? address : "";
  const zoom = /https:\/\/(?:[a-z0-9-]+\.)*zoom\.us\/(?:j|w|my|s)\/[^\s<>"']+/i.exec(s);
  if (zoom) {
    const url = safeUrl(zoom[0].replace(/[.,;)\]]+$/, ""));
    if (url) {
      const id = /\/(?:j|w|s)\/(\d{9,12})(?:[/?#]|$)/.exec(url);
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
 * appointment's link in state open and makes no Zoom or Google call. A phone
 * call has no link to send; a call that is over gets none either.
 */
export function wrapPlan(i: {
  start: unknown;
  end?: unknown;
  address: unknown;
  call_kind: CallKind;
  now: number;
  ctx: RoomCtx;
}): WrapOk | Refused {
  const meeting = meetingFromAddress(i.address);
  if (!meeting) return refuse("phone_call");
  const start = ms(i.start);
  if (start === null || !isCallKind(i.call_kind)) return refuse("bad_input");
  const d = bookedDeadlines(start, ms(i.end), i.call_kind, i.ctx);
  if (i.now >= (ms(d.ends_at) as number)) return refuse("call_over");
  return { ok: true, provider: meeting.provider, join_url: meeting.join_url, provider_meeting_id: meeting.meeting_id, ...d };
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
      return v.lead_in_at
        ? out("joined", fill(LANE_COPY.joined, { name: Name, time: clock(v.lead_in_at) }))
        : out("closed", LANE_COPY.room_closed);
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
