/**
 * Live video rooms, the browser's half.
 *
 * sales-api makes, guards and counts every room (the shared contract in the
 * live-calls plan); this file holds what the screens need to say one in a
 * glance: the shapes the server sends, the calls with their request ids,
 * the polling, and pure functions that turn a room into its sentence, its
 * four steps and the one right button.
 *
 * Every sentence below is copied word for word from the specs' "Screens and
 * copy" tables (foundation, P1, P2, P3). The few lines the specs do not
 * have are marked "ours" and say only what is true.
 *
 * Pure functions take `now`, so the tests pin the clock. Times read in
 * Kuwait, as everywhere else in the cockpit (format.ts).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "./api";
import { ApiError, type ApiFailure, uncertain } from "./apiErrors";
import {
  CLAIM_MINUTE_STEP_MS,
  LINK_LATE_STEP_MS,
  linkRetrying,
  MAKING_LATE_STEP_MS,
  mayHaveGone,
  movedByEmailOnly,
} from "./dialerUi";
import { clock, KUWAIT } from "./format";

import { leadDeadline, OVERDUE_MS, roomDeadline, WAITS_S } from "./roomClock";

export {
  leadDeadline,
  linkRetrying,
  mayHaveGone,
  movedByEmailOnly,
  OVERDUE_MS,
  roomDeadline,
  WAITS_S,
};

// ---------------------------------------------------------------------------
// The contract: what sales-api sends the browser
// ---------------------------------------------------------------------------

export type RoomPurpose =
  | "fallback"
  | "handover"
  | "standby"
  | "booked"
  | "manual";
export type CallKind = "intro" | "demo";
export type Provider = "meet" | "zoom";
export type RoomState =
  | "requested"
  | "creating"
  | "open"
  | "host_in"
  | "lead_in"
  | "ended"
  | "expired"
  | "failed"
  | "cancelled";
export type CountResult =
  | "booked"
  | "moved"
  | "not_a_lead"
  | "failed"
  | "undone"
  | "unclear"
  | "already_counted"
  | "self_reported";
export type RoomResult =
  | "joined"
  | "no_join"
  | "moved_to_phone"
  | "cancelled"
  | "failed"
  | "admit_blocked";

/**
 * Where the link went: the glossary's `rooms.send` keys (1.4), which are
 * also sales-api's LINK_CHANNELS and the only values the database's check
 * allows (contract v2 section 3). There is no `read_out` and no bare
 * `whatsapp`: a link nobody sent is a room with no `link_sent_at`, and
 * anything else in the list is ignored. Whether a template went
 * unconfirmed is not a channel either: it is `link_unconfirmed_at`.
 */
export type LinkChannel = "whatsapp_text" | "whatsapp_template" | "email";
export const LINK_CHANNELS: readonly LinkChannel[] = [
  "whatsapp_text",
  "whatsapp_template",
  "email",
];

/** What the short page saw the lead open the link on; null when not known. */
export type Device = "phone" | "tablet" | "computer";
export const DEVICES: readonly Device[] = ["phone", "tablet", "computer"];

/**
 * Every key of a RoomView as contract v2 serves it (section 3): roomlogic's
 * ROOM_VIEW_KEYS plus the six it adds. `start_url` is never one of them.
 */
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
  "link_unconfirmed_at",
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
  "starts_at",
  "result",
  "count_result",
  "error",
  "refusal",
  "created_at",
  "trigger",
  "attempt_id",
  "appointment_id",
  "asked_appointment_id",
  "handover_id",
  "end_reason",
  "last_open_at",
  "last_link_at",
  "late_open_at",
  "moved_from",
  "opened_at",
  "link_claimed_at",
  "rang_at",
] as const;

/** A room as the browser sees it. `start_url` is never part of it. */
export interface RoomView {
  id: string;
  code: string;
  contact_id: string | null;
  contact_first_name: string | null;
  purpose: RoomPurpose;
  call_kind: CallKind;
  provider: Provider;
  host_email: string;
  state: RoomState;
  version: number;
  /** call.maharamedia.com/{code} once the short link is on, else join_url. */
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
  /** Why the room failed, as a plain sentence (the worker writes it). */
  error: string | null;
  /** Why the link could not go, as a plain sentence. */
  refusal: string | null;
  /** sales-api sends null when the row has neither time (roomlogic toRoomView). */
  created_at: string | null;
  // Contract v2 adds these six (section 3). They are read when present, so
  // an answer from a sales-api that does not send them yet still draws.
  /** The WhatsApp template was not seen within 20 s, so email went too. */
  link_unconfirmed_at?: string | null;
  /**
   * room.status only: a send of the link now would be held for night on the
   * lead's clock (sales-api nightHolds), so Send by email is not offered
   * (m1 round 4).
   */
  send_night?: boolean;
  /** When the room first showed the join (fix round 4): That was not the lead counts from the later of this and lead_in_at. */
  lead_in_seen_at?: string | null;
  /** What made the room, so "Try Zoom" makes the same kind of room. */
  trigger?: string | null;
  attempt_id?: string | null;
  /** The booked call a fallback or booked room is for. */
  appointment_id?: string | null;
  /** The booked intro the press named, whether or not the room carries it: a retry asks with it (m1 round 1). */
  asked_appointment_id?: string | null;
  handover_id?: string | null;
  /** A booked call's start; without it, host_by minus 15 minutes. */
  starts_at?: string | null;
  /**
   * Why the sweep closed the room: `not_admitted` (the lead knocked and was
   * not let in), `events_lost` (Zoom's events were not all read),
   * `lead_no_show`, `host_not_in`. The panel says each as itself.
   */
  end_reason?: string | null;
  /** The lead's latest open of the link: the sweep holds the room open_grace past it. */
  last_open_at?: string | null;
  /** When a later channel sent the link again: the lead's ten minutes count from it (stress2 round 5). */
  last_link_at?: string | null;
  /**
   * The lead opened the link after the room closed (the door showed them
   * "This call has ended"): the panel and the banner say to call them now,
   * never "nobody joined" (stress2 round 5).
   */
  late_open_at?: string | null;
  /**
   * The provider of the room this one replaces after "I can't let them in"
   * (m1 round 2): the lead is still at that room's door, so the panel says
   * to tell them where the new link is.
   */
  moved_from?: Provider | null;
  /**
   * When the room opened, and when its link was asked for (m1 round 3):
   * "The link has not gone yet" counts from the later of the two, never
   * from the press. Absent from an older sales-api: the press's time.
   */
  opened_at?: string | null;
  link_claimed_at?: string | null;
  /**
   * A call to the lead placed after their join (m1 round 3b): the rep rang
   * them again, so the video call may be over, which Meet never says. The
   * panel and the banner ask "Still on the call?". Absent from an older
   * sales-api: never asked on it.
   */
  rang_at?: string | null;
}

export interface RoomEvent {
  at: string;
  kind: string;
  source: string;
  text: string;
}

export interface Health {
  worker_ok: boolean;
  /** The worker runs and makes rooms but reports a problem: red line, never "not being made" (m1 round 3). */
  worker_trouble?: boolean;
  last_run_at: string | null;
  /** null when sales-api could not count them: missing is never 0. */
  rooms_today: number | null;
  failed_today: number | null;
  /** The exact health sentence from the foundation spec. */
  line: string;
}

export type PresenceState = "on_call" | "ready" | "available" | "away";
export type ZoomStatus = "licensed" | "basic" | "pending" | "missing";

export interface Presence {
  email: string;
  state: PresenceState;
  until: string | null;
  room_id: string | null;
  zoom_status: ZoomStatus | null;
  default_provider: Provider;
  // Contract v2 (section 3), read when present:
  /**
   * Why the seat is Away, as the database writes it: `missed_offer` (one
   * miss), `booked_call_soon` (the sweep closed the room before a booked
   * call), `expired`. When the key is absent the strip guesses a miss from
   * Away, as before.
   */
  reason?: string | null;
  /** The booked call's start and kind, with `booked_call_soon`. */
  booked_at?: string | null;
  booked_kind?: CallKind | null;
  /**
   * The seat's own last press (live.status, stress2 round 2): "away" when it
   * never pressed I'm available or set itself away, so a booked call's line
   * never says its room was closed.
   */
  availability?: "available" | "away" | null;
}

/** A live lead offered to this seat (project 2; empty until then). */
export interface Offer {
  id: string;
  version: number;
  kind: CallKind | string;
  contact_first_name: string | null;
  company: string | null;
  country: string | null;
  /** on_call, replied or manual. */
  reason: string;
  note: string | null;
  offer_until: string;
}

export interface LiveStatus {
  me: Presence;
  /** This seat's rooms that are not final. */
  rooms: RoomView[];
  offers: Offer[];
  /** null when the answer carried none it could read. */
  health: Health | null;
  // Contract v2 (section 4), read when present:
  /**
   * False while rooms are on and live calls are off: presence is still
   * sent, but `offers` is empty and the strip stays out of the way.
   */
  live_enabled?: boolean;
  /** Why the seat's standby room could not be made, as a sentence. */
  standby_error?: string | null;
  /** Whether Available makes a standby room at all (rooms and live standby on). */
  standby_on?: boolean;
  /**
   * False while video rooms are switched off: `rooms` are the seat's rooms
   * still in flight (a link already went), kept until they close (m1 round 1).
   */
  rooms_enabled?: boolean;
  /** The server's clock when it answered, so countdowns do not drift. */
  now?: string | null;
  /** The browser's own: rooms a press ended, by the version it saw. */
  gone?: Record<string, number>;
}

/** `room.status`; health is null only on a room seeded before its first read. */
export interface RoomFeed {
  room: RoomView;
  events: RoomEvent[];
  health: Health | null;
  /** The server's clock when it answered (asked of the contract). */
  now?: string | null;
  /**
   * Whether the room's host can use the other provider for this call now
   * (sales-api's own check): "Try {other}" and "I can't let them in" show
   * only then. Absent or null: not known, and they show.
   */
  other_ok?: boolean | null;
}

export type MarkWhat = "host_in" | "lead_in" | "not_lead" | "still_on";
/** room.end's reasons; `admit_blocked` is P1's "I can't let them in" (roomlogic END_REASONS). */
export type EndReason =
  | "end"
  | "on_phone"
  | "finished"
  | "cancel"
  | "admit_blocked";

// ---------------------------------------------------------------------------
// Reading an answer: whatever sales-api sends, the screens get these shapes
// or a failed read, never a throw while drawing.
// ---------------------------------------------------------------------------

const ROOM_STATES: readonly RoomState[] = [
  "requested",
  "creating",
  "open",
  "host_in",
  "lead_in",
  "ended",
  "expired",
  "failed",
  "cancelled",
];
const PURPOSES: readonly RoomPurpose[] = [
  "fallback",
  "handover",
  "standby",
  "booked",
  "manual",
];
const CALL_KINDS: readonly CallKind[] = ["intro", "demo"];
const PROVIDERS: readonly Provider[] = ["meet", "zoom"];
const ROOM_RESULTS: readonly RoomResult[] = [
  "joined",
  "no_join",
  "moved_to_phone",
  "cancelled",
  "failed",
  "admit_blocked",
];
const COUNT_RESULTS: readonly CountResult[] = [
  "booked",
  "moved",
  "not_a_lead",
  "failed",
  "undone",
  "unclear",
  "already_counted",
  "self_reported",
];
const PRESENCE_STATES: readonly PresenceState[] = [
  "on_call",
  "ready",
  "available",
  "away",
];
const ZOOM_STATUSES: readonly ZoomStatus[] = [
  "licensed",
  "basic",
  "pending",
  "missing",
];

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** A string with something in it, else null. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** A time the browser can read, else null. */
function when(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

/** Only web links: nothing else is ever copied or opened. */
function webUrl(v: unknown): string | null {
  return typeof v === "string" && /^https?:\/\/\S+$/i.test(v.trim())
    ? v.trim()
    : null;
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const OPTIONAL_TIMES = [
  "link_unconfirmed_at",
  "starts_at",
  "lead_in_seen_at",
  "last_open_at",
  "last_link_at",
  "late_open_at",
  "opened_at",
  "link_claimed_at",
  "rang_at",
] as const;
const OPTIONAL_TEXT = [
  "trigger",
  "attempt_id",
  "appointment_id",
  "asked_appointment_id",
  "handover_id",
  "end_reason",
] as const;

/**
 * A room as the screens can draw it, or null when it lacks what a room
 * cannot do without (an id, a known state, a version, a provider). Optional
 * fields are kept only when the answer had them, so a well-formed room
 * reads back unchanged.
 */
export function normalizeRoom(v: unknown): RoomView | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  if (
    !id ||
    !oneOf(ROOM_STATES, v.state) ||
    typeof v.version !== "number" ||
    !Number.isFinite(v.version) ||
    !oneOf(PROVIDERS, v.provider)
  )
    return null;
  const room: RoomView = {
    id,
    code: str(v.code) ?? "",
    contact_id: str(v.contact_id),
    contact_first_name: str(v.contact_first_name),
    purpose: oneOf(PURPOSES, v.purpose) ? v.purpose : "manual",
    call_kind: oneOf(CALL_KINDS, v.call_kind) ? v.call_kind : "intro",
    provider: v.provider,
    host_email: str(v.host_email) ?? "",
    state: v.state,
    version: v.version,
    short_url: webUrl(v.short_url),
    join_url: webUrl(v.join_url),
    link_channels: list(v.link_channels).filter(
      (c): c is string => typeof c === "string",
    ),
    link_sent_at: when(v.link_sent_at),
    first_open_at: when(v.first_open_at),
    open_device: oneOf(DEVICES, v.open_device) ? v.open_device : null,
    lead_waiting_at: when(v.lead_waiting_at),
    host_in_at: when(v.host_in_at),
    lead_in_at: when(v.lead_in_at),
    ended_at: when(v.ended_at),
    host_by: when(v.host_by),
    lead_by: when(v.lead_by),
    ends_at: when(v.ends_at),
    result: oneOf(ROOM_RESULTS, v.result) ? v.result : null,
    count_result: oneOf(COUNT_RESULTS, v.count_result) ? v.count_result : null,
    error: str(v.error),
    refusal: str(v.refusal),
    created_at: when(v.created_at),
  };
  for (const k of OPTIONAL_TIMES) if (k in v) room[k] = when(v[k]);
  for (const k of OPTIONAL_TEXT) if (k in v) room[k] = str(v[k]);
  if ("moved_from" in v)
    room.moved_from = oneOf(PROVIDERS, v.moved_from) ? v.moved_from : null;
  dropOpensBeforeLink(room);
  return room;
}

/**
 * A handover room's opens from before its link went are not the lead's: a
 * standby room adopted by a Take had no lead, and its code may have been
 * opened by the closer or a guesser (stress2 round 6,
 * standby-open-carried-into-handover). The database clears them on the
 * adoption; this is the panel's backstop for a row written before that.
 */
function dropOpensBeforeLink(room: RoomView): void {
  if (room.purpose !== "handover" || !room.first_open_at) return;
  const sent = room.link_sent_at ? Date.parse(room.link_sent_at) : Number.NaN;
  const last = room.last_open_at ? Date.parse(room.last_open_at) : Number.NaN;
  if (Number.isFinite(sent) && Date.parse(room.first_open_at) >= sent) return;
  if (Number.isFinite(sent) && Number.isFinite(last) && last >= sent) {
    room.first_open_at = room.last_open_at ?? null;
    return;
  }
  room.first_open_at = null;
  if ("last_open_at" in room) room.last_open_at = null;
  room.open_device = null;
}

export function normalizePresence(v: unknown): Presence | null {
  if (!isObj(v) || !oneOf(PRESENCE_STATES, v.state)) return null;
  const me: Presence = {
    email: str(v.email) ?? "",
    state: v.state,
    until: when(v.until),
    room_id: str(v.room_id),
    zoom_status: oneOf(ZOOM_STATUSES, v.zoom_status) ? v.zoom_status : null,
    default_provider: oneOf(PROVIDERS, v.default_provider)
      ? v.default_provider
      : "meet",
  };
  if ("reason" in v) me.reason = str(v.reason);
  if ("booked_at" in v) me.booked_at = when(v.booked_at);
  if ("booked_kind" in v)
    me.booked_kind = oneOf(CALL_KINDS, v.booked_kind) ? v.booked_kind : null;
  if ("availability" in v)
    me.availability =
      v.availability === "available" || v.availability === "away"
        ? v.availability
        : null;
  return me;
}

/**
 * The health line as the screens can trust it, or null. Without a yes or a
 * no in `worker_ok` the answer says nothing about the worker: null, so a
 * garbled answer never reads as "Video rooms are not being made" (a false alarm) or as
 * working.
 */
export function normalizeHealth(v: unknown): Health | null {
  if (!isObj(v) || typeof v.worker_ok !== "boolean") return null;
  return {
    worker_ok: v.worker_ok === true,
    ...(v.worker_ok === false && v.worker_trouble === true
      ? { worker_trouble: true }
      : {}),
    last_run_at: when(v.last_run_at),
    rooms_today: count(v.rooms_today),
    failed_today: count(v.failed_today),
    line: typeof v.line === "string" ? v.line : "",
  };
}

export function normalizeOffer(v: unknown): Offer | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const until = when(v.offer_until);
  if (!id || !until) return null;
  return {
    id,
    version:
      typeof v.version === "number" && Number.isFinite(v.version)
        ? v.version
        : 0,
    kind: str(v.kind) ?? "call",
    contact_first_name: str(v.contact_first_name),
    company: str(v.company),
    country: str(v.country),
    reason: str(v.reason) ?? "manual",
    note: str(v.note),
    offer_until: until,
  };
}

/** A read the browser could not use; the last good copy stays on screen. */
export const UNREADABLE =
  "The cockpit got an answer it could not read. It tries again by itself.";
/** A press whose answer could not be read: it may have gone through. */
export const UNREADABLE_PRESS =
  "The cockpit could not read the answer. Check the room before you press again.";

function unreadable(press = false): ApiError {
  return new ApiError(press ? UNREADABLE_PRESS : UNREADABLE, "server");
}

/**
 * live.status as the strip can draw it. Lists are coerced, rooms and offers
 * the screens cannot use are dropped, and an answer with no readable
 * presence is a failed read: "Away" is never said for "not known".
 */
export function normalizeLive(v: unknown): LiveStatus {
  if (!isObj(v)) throw unreadable();
  const me = normalizePresence(v.me);
  if (!me) throw unreadable();
  const out: LiveStatus = {
    me,
    rooms: list(v.rooms)
      .map(normalizeRoom)
      .filter((r): r is RoomView => r !== null),
    offers: list(v.offers)
      .map(normalizeOffer)
      .filter((o): o is Offer => o !== null),
    health: normalizeHealth(v.health),
  };
  if (typeof v.live_enabled === "boolean") out.live_enabled = v.live_enabled;
  if ("standby_error" in v) out.standby_error = str(v.standby_error);
  if (typeof v.standby_on === "boolean") out.standby_on = v.standby_on;
  if (typeof v.rooms_enabled === "boolean") out.rooms_enabled = v.rooms_enabled;
  if ("now" in v) out.now = when(v.now);
  return out;
}

/** The same, for drawing: null instead of a throw. */
export function readLive(v: unknown): LiveStatus | null {
  try {
    return normalizeLive(v);
  } catch {
    return null;
  }
}

export function normalizeRoomFeed(v: unknown): RoomFeed {
  if (!isObj(v)) throw unreadable();
  const room = normalizeRoom(v.room);
  if (!room) throw unreadable();
  const events: RoomEvent[] = [];
  for (const e of list(v.events)) {
    if (!isObj(e)) continue;
    const at = when(e.at);
    const text = str(e.text);
    if (!at || !text) continue;
    events.push({
      at,
      kind: str(e.kind) ?? "",
      source: str(e.source) ?? "",
      text,
    });
  }
  const out: RoomFeed = { room, events, health: normalizeHealth(v.health) };
  if ("now" in v) out.now = when(v.now);
  if (typeof v.other_ok === "boolean" || v.other_ok === null)
    out.other_ok = v.other_ok;
  return out;
}

/** A press's `{ room }` answer, or a failed press that may have landed. */
export function roomAnswer(v: unknown): { room: RoomView } {
  const room = isObj(v) ? normalizeRoom(v.room) : null;
  if (!room) throw unreadable(true);
  return { room };
}

// ---------------------------------------------------------------------------
// Waits and small helpers
// ---------------------------------------------------------------------------

/** A press with an Undo waits this long before it is sent (MarkControls). */
export const UNDO_MS = 5000;

/**
 * "That was not the lead" goes behind a 5 s Undo, and sales-api refuses it
 * after 300 s (not_lead_late). The button leaves this long before that, so a
 * press always lands in time: the Undo, plus 15 s for the trip.
 */
export const NOT_LEAD_SLACK_MS = 15_000;
export const NOT_LEAD_LAST_PRESS_MS =
  WAITS_S.not_lead_undo * 1000 - UNDO_MS - NOT_LEAD_SLACK_MS;

/** A booked call's host_by is its start plus this (glossary 1.9). */
const BOOKED_HOST_MS = 15 * 60_000;

/** "Still on the call?" asks again this long after "Still on it" (ours). */
export const STILL_ON_ASK_AGAIN_MS = 10 * 60_000;

/** The refresh prompt shows this long before the worker swaps the room (ours). */
const REFRESH_AHEAD_S = 300;

const FINAL: ReadonlySet<RoomState> = new Set([
  "ended",
  "expired",
  "failed",
  "cancelled",
]);

export function isFinal(s: RoomState): boolean {
  return FINAL.has(s);
}

/**
 * When the lead joined this room on video, or null: the room is in its
 * lead_in state, or it closed with the lead having joined. A join taken back
 * ("That was not the lead") is no join. The dialer reads it after a missed
 * call: the intro happened on video, so the card asks how it went (final
 * review), never "No answer".
 */
export function videoJoinedAt(
  room: RoomView | null | undefined,
): string | null {
  if (!room?.lead_in_at) return null;
  if (room.state === "lead_in") return room.lead_in_at;
  return isFinal(room.state) && room.result === "joined"
    ? room.lead_in_at
    : null;
}

/**
 * When the rep and the lead moved to the phone instead (We are on the
 * phone: the room closed moved_to_phone), or null. The dialer's step after
 * the miss then asks how the call went, never the missed-call WhatsApp or
 * another video link (stress2, round 2).
 */
export function spokeAt(room: RoomView | null | undefined): string | null {
  if (!room || !isFinal(room.state) || room.result !== "moved_to_phone")
    return null;
  return room.ended_at ?? room.created_at ?? null;
}

/** How long before the miss was seen a join (or a move to the phone) still belongs to that call: the call rang for up to a minute or two. */
export const MISS_JOIN_SLACK_MS = 5 * 60_000;

/**
 * The join (videoJoinedAt) or the move to the phone (spokeAt) of the call
 * that missed, or null (m1 round 3b,
 * meet-joined-room-left-open-hijacks-callback-miss): the room made for that
 * call (its attempt), or a join no older than the call itself. A room the
 * lead joined for an earlier call (an intro at 10:03, left open on Meet)
 * never says a call-back's miss at 10:25 was a video call.
 */
export function forThisMiss(
  at: string | null,
  room: RoomView | null | undefined,
  missed: { at: number; attemptId: string | null } | null | undefined,
): string | null {
  if (!at || !missed) return at;
  if (missed.attemptId && room?.attempt_id === missed.attemptId) return at;
  const when = t(at);
  return when !== null && when >= missed.at - MISS_JOIN_SLACK_MS ? at : null;
}

export function isMaking(s: RoomState): boolean {
  return s === "requested" || s === "creating";
}

export function providerName(p: Provider): "Meet" | "Zoom" {
  return p === "zoom" ? "Zoom" : "Meet";
}

export function otherProvider(p: Provider): Provider {
  return p === "zoom" ? "meet" : "zoom";
}

function t(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

/** "9:12" from milliseconds left; never below 0:00. */
export function mmss(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "14:03:58" in Kuwait, for the health line. */
export function clockSec(iso: string | null | undefined): string {
  const v = t(iso);
  if (v === null) return "--:--:--";
  return new Date(v).toLocaleTimeString("en-GB", {
    timeZone: KUWAIT,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function first(room: RoomView): string | null {
  return room.contact_first_name?.trim() || null;
}

/** The link the lead taps: the short link once it exists, else the room's own. */
export function shortLink(room: RoomView): string | null {
  return room.short_url || room.join_url || null;
}

/** Longer than this, a link is not something a person can say on the phone. */
const READ_OUT_MAX = 40;

/**
 * The link as it is read out: "call.maharamedia.com/K7Q2MX", or a Meet
 * link. Null when nobody could say it: a Zoom link with its passcode in the
 * query (before the short link exists) is copied, not read.
 */
export function readOut(room: RoomView): string | null {
  const url = shortLink(room);
  if (!url) return room.code || null;
  const said = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (/[?#]/.test(said) || said.length > READ_OUT_MAX) return null;
  return said;
}

/** The glossary's three channels; anything else says nothing. */
const CHANNEL: Record<string, string> = {
  whatsapp_text: "WhatsApp",
  whatsapp_template: "WhatsApp",
  email: "email",
};

/** "WhatsApp", "email", "WhatsApp and email", or null when none is known. */
export function channelWords(channels: readonly string[]): string | null {
  const names: string[] = [];
  for (const c of channels) {
    const n = Object.hasOwn(CHANNEL, c) ? CHANNEL[c] : undefined;
    if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "on WhatsApp", "by email", "on WhatsApp and by email" for channelWords' words. */
export function channelPhrase(words: string): string {
  if (words === "email") return "by email";
  if (words === "WhatsApp and email") return "on WhatsApp and by email";
  return `on ${words}`;
}

/** "phone", "tablet" or "computer" from what the short page saw. */
export function deviceWords(d: string | null | undefined): string | null {
  const s = String(d ?? "").toLowerCase();
  if (!s) return null;
  if (/tablet|ipad/.test(s)) return "tablet";
  if (/phone|mobile|ios|android/.test(s)) return "phone";
  if (/desktop|computer|laptop|mac|windows|linux|pc/.test(s)) return "computer";
  return null;
}

/**
 * The words that open a sentence and are not names. Only these lose their
 * capital after a colon; any other first word may be a name ("Sara",
 * "Zoom", "HighLevel") and keeps it.
 */
const OPENERS = new Set([
  "The",
  "This",
  "That",
  "These",
  "Those",
  "There",
  "No",
  "Nobody",
  "Nothing",
  "Your",
  "A",
  "An",
  "It",
  "Its",
  "We",
  "Our",
  "They",
  "Their",
  "You",
  "He",
  "She",
  "Do",
  "Did",
  "Not",
  "Only",
  "Every",
  "Some",
  "If",
  "When",
  "Too",
]);

/**
 * A server sentence set after a colon: no closing full stop, and a lower
 * first letter only when the first word is a known sentence opener.
 */
/** A server sentence as the panel shows it: its first letter capital, one full stop. */
export function reasonSentence(text: string | null | undefined): string {
  const t = String(text ?? "")
    .trim()
    .replace(/[.!]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
}

export function reasonWords(text: string | null | undefined): string {
  const s = String(text ?? "")
    .trim()
    .replace(/[.!]+$/, "");
  const word = s.split(/\s/, 1)[0] ?? "";
  if (OPENERS.has(word)) return s.charAt(0).toLowerCase() + s.slice(1);
  return s;
}

// ---------------------------------------------------------------------------
// Sentences: words, plus times and codes set in Geist Mono
// ---------------------------------------------------------------------------

/**
 * One piece of a sentence. A string is words; `mono` is a time or a code;
 * `left` is a countdown, drawn "(9:12 left)" or "1:47 left." and left out
 * of what a screen reader hears, so it is not read out every second. Its
 * `lead` (", ") is drawn before it and dropped with it; `spoken` is what a
 * screen reader hears instead (".").
 */
export type Part =
  | string
  | { mono: string }
  | {
      left: number;
      form: "paren" | "sentence";
      lead?: string;
      spoken?: string;
    };
export type Sentence = Part[];

/** "(9:12 left)" or "9:12 left." */
export function leftText(p: { left: number; form: "paren" | "sentence" }) {
  return p.form === "paren"
    ? `(${mmss(p.left)} left)`
    : `${mmss(p.left)} left.`;
}

/** Words with every clock time ("14:03", "14:03:58") set in Geist Mono. */
export function monoTimes(text: string): Sentence {
  const out: Sentence = [];
  const re = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ mono: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The sentence as text; `speak` drops the countdowns. */
export function sentenceText(s: Sentence, speak = false): string {
  const out = s
    .map(p => {
      if (typeof p === "string") return p;
      if ("mono" in p) return p.mono;
      if (speak) return p.spoken ?? "";
      return `${p.lead ?? ""}${leftText(p)}`;
    })
    .join("");
  if (!speak) return out;
  return out
    .replace(/\s+([.,)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// A room: its moment, sentence, steps, countdown and buttons
// ---------------------------------------------------------------------------

/** What the room panel is saying right now. */
export type RoomMoment =
  | "making"
  /** Still being made while the room worker is down: it will not be made. */
  | "making_down"
  /** Still being made well past the time a room takes (150 s). */
  | "making_late"
  | "failed"
  | "ready"
  | "standby_open"
  | "standby_in"
  | "sent"
  | "not_sent"
  /**
   * The link has not gone yet and sales-api tries it again in a minute
   * (HighLevel busy, a contact read that did not answer): the panel says
   * only that, never "Not sent" or "send it another way" (m1 round 4).
   */
  | "retrying"
  /**
   * The link may have gone (HighLevel took the send and its answer was
   * lost): never "Not sent", which asks for a second copy (m1 round 1).
   */
  | "unclear"
  | "link_late"
  | "not_confirmed"
  | "opened"
  | "waiting_room"
  | "host_in"
  /**
   * Meet, the rep in the room, and the lead opened the link: on Meet the
   * lead then knocks, and only the rep's press says they are in (final
   * review: the rep in the Meet tab must be called back).
   */
  | "host_in_opened"
  | "joined"
  | "still_on_call"
  /** Its deadline passed two minutes ago and the sweep has not closed it. */
  | "overdue"
  | "expired"
  /** Closed by the sweep while the lead knocked (or after they opened the link): never "nobody joined". */
  | "expired_knocked"
  /** Closed with some of Zoom's events unread: whether the lead joined is not known. */
  | "expired_unknown"
  /** Closed after the lead opened the link and never joined: a person decides, never "nobody joined". */
  | "expired_opened"
  /** Ended (by the rep, or by Zoom) with nobody in it. */
  | "ended_empty"
  /**
   * Closed by the sweep while its link was still being tried (link_not_sent,
   * m1 round 4): the lead never got it, so never "nobody joined" and never a
   * No-show press.
   */
  | "expired_unsent"
  | "closed";

function isStandby(room: RoomView): boolean {
  return room.purpose === "standby" && !room.contact_id;
}

/**
 * Whether the lead's link went through the short link (call.maharamedia.com),
 * the only way an open of it is ever seen. Off (as shipped), the lead got
 * Meet's own link, and no open can be.
 */
export function shortLinkOn(room: RoomView): boolean {
  // A booked call's link went with the booking (the calendar invite), never
  // the short link, so no open of it can be seen (stress2 round 5).
  if (room.purpose === "booked") return false;
  return Boolean(room.short_url) && room.short_url !== room.join_url;
}

/**
 * A Meet room that closed with nothing seen and nothing pressed, its link
 * Meet's own (stress2 round 4, short-link-off-meet-talk-reads-as-no-join):
 * Meet never says who came in, so whether the lead joined is not known,
 * exactly as the settle reads it ("Meet sends no join signal and nobody
 * pressed The lead is in"). Never "did not join", never a No-show press.
 */
function meetUnseen(room: RoomView): boolean {
  return (
    room.provider === "meet" &&
    Boolean(room.contact_id) &&
    !shortLinkOn(room) &&
    !room.lead_in_at &&
    linkReachedOrLeft(room)
  );
}

/**
 * The lead got the link, it may have gone, or it was left to the rep to
 * give (a refusal said as final: read it out): only then may the lead have
 * come into a Meet room unseen. A link still tried again, or never asked
 * for, reached nobody (m1 round 3b,
 * meet-ended-before-link-went-said-as-maybe-joined). A booked room's link
 * went with the booking.
 */
export function linkReachedOrLeft(room: {
  purpose?: string | null;
  link_sent_at?: string | null;
  refusal?: string | null;
}): boolean {
  if (room.purpose === "booked" || room.link_sent_at) return true;
  return Boolean(room.refusal) && !linkRetrying(room.refusal);
}

/** A video-link room (from the dialer or the lead page) whose link reached nobody. */
function linkReachedNobody(room: RoomView): boolean {
  return (
    Boolean(room.contact_id) &&
    (room.purpose === "fallback" || room.purpose === "manual") &&
    !linkReachedOrLeft(room) &&
    !room.first_open_at &&
    !room.last_open_at &&
    !room.late_open_at
  );
}

export function roomMoment(room: RoomView, now: number): RoomMoment {
  const s = room.state;
  if (isMaking(s)) {
    const asked = t(room.created_at);
    return asked !== null && now - asked >= MAKING_LATE_MS
      ? "making_late"
      : "making";
  }
  // A room whose Zoom meeting was deleted in Zoom closes cancelled with
  // result failed and its sentence in error (stress2, round 2).
  // The same for a room a timer had closed whose Zoom meeting, on Zoom's
  // own time, was deleted before the close (m1 round 4,
  // zoom-deleted-late-after-timer-close-kept-as-no-show): its link was
  // dead, so it is never the lead's no-show.
  if (
    s === "failed" ||
    (s === "cancelled" && room.result === "failed" && room.error) ||
    (s === "expired" &&
      room.result === "failed" &&
      room.end_reason === "meeting_deleted")
  )
    return "failed";
  if (isStandby(room)) {
    if (isFinal(s)) return "closed";
    return s === "open" ? "standby_open" : "standby_in";
  }
  // Only the sweep's own expiry says "did not join in 10 minutes": a room
  // the rep (or Zoom) ended with nobody in it says it ended. A knock that was
  // never let in, an open of the link, and events never read are each said
  // as themselves, never "nobody joined" (stress2, round 1).
  // A closed room whose lead's join stands (a press a few seconds after the
  // timer's close, or Zoom's join read after the meeting's end): the lead
  // joined, never "nobody joined" with a No-show press (m1 round 1).
  if (
    (s === "expired" || s === "ended") &&
    (room.result === "joined" || (room.result !== "no_join" && room.lead_in_at))
  )
    return "closed";
  if (s === "expired") {
    // The room made in place of one the lead knocked on (moved_from): she
    // came on time and our room locked her out, so it is never "nobody
    // joined" with a No-show (m1 round 4,
    // admit-blocked-replacement-expiry-offers-noshow).
    if (
      room.result === "admit_blocked" ||
      room.lead_waiting_at ||
      room.moved_from
    )
      return "expired_knocked";
    if (room.end_reason === "link_not_sent" && !room.link_sent_at)
      return "expired_unsent";
    if (room.end_reason === "events_lost") return "expired_unknown";
    if (linkReachedNobody(room)) return "expired_unsent";
    if (
      room.first_open_at ||
      room.last_open_at ||
      room.late_open_at ||
      meetUnseen(room)
    )
      return "expired_opened";
    return "expired";
  }
  // A room the rep (or Zoom) ended with nobody seen in it reads the same way
  // (stress2, round 2): a knock, or an open of the link, is never "nobody
  // joined" with a No-show press (the lead may have talked on Meet, which
  // sends no join signal).
  if (s === "ended" && room.result === "no_join") {
    if (room.lead_waiting_at || room.moved_from) return "expired_knocked";
    if (
      room.first_open_at ||
      room.last_open_at ||
      room.late_open_at ||
      meetUnseen(room)
    )
      return "expired_opened";
    // Ended before its link reached the lead (m1 round 3b): said as a link
    // that never went, never "nobody joined" with a No-show.
    if (linkReachedNobody(room)) return "expired_unsent";
    return "ended_empty";
  }
  if (s === "ended" || s === "cancelled") return "closed";
  if (s === "lead_in") {
    // Back in Zoom's waiting room after a drop (m1 round 4,
    // zoom-rejoin-waiting-room-unseen): sales-api's view carries only a
    // knock after the lead's join.
    const knock = t(room.lead_waiting_at);
    const joined = t(room.lead_in_at);
    if (knock !== null && (joined === null || knock > joined))
      return "waiting_room";
    // The rep rang the lead again after the join (m1 round 3b): the video
    // call may be over, which Meet never says, so the room asks.
    const rang = t(room.rang_at ?? null);
    if (rang !== null && joined !== null && rang > joined)
      return "still_on_call";
    const end = t(room.ends_at);
    return end !== null && now >= end ? "still_on_call" : "joined";
  }
  // Two minutes past its deadline and still open: the sweep is late, and a
  // countdown stuck at 0:00 tells the rep nothing.
  const deadline = roomDeadline(room);
  if (deadline !== null && now >= deadline + OVERDUE_MS) return "overdue";
  // open or host_in. A lead waiting in the room is the news even when no
  // message could go (the rep read the link out), so it comes first.
  if (room.lead_waiting_at) return "waiting_room";
  if (!room.link_sent_at && room.refusal)
    return mayHaveGone(room.refusal)
      ? "unclear"
      : linkRetrying(room.refusal)
        ? "retrying"
        : "not_sent";
  if (s === "host_in")
    return room.provider === "meet" && room.first_open_at
      ? "host_in_opened"
      : "host_in";
  // The rep opened their Meet room from this tab and the lead opened the
  // link: Meet says nothing more, so the next press is The lead is in, never
  // "Join now" to a rep already in the room (stress2 round 4).
  if (room.first_open_at)
    return room.provider === "meet" && openedHere.has(room.id)
      ? "host_in_opened"
      : "opened";
  if (room.link_unconfirmed_at) return "not_confirmed";
  if (room.link_sent_at) return "sent";
  // Well past a minute open with a lead, nothing sent and no reason: the link
  // was never asked for (a lost worker.ready) or its send died. The rep reads
  // it out. Not a booked call's room (its link went with the booking), nor a
  // handover room before its closer is in (its link waits for them).
  // Counted from the later of the room's open and the link's claim, never
  // from the press (m1 round 3, link-late-counts-from-press-not-open): a room
  // that opened late but on time, or a send asked a moment ago, is not late.
  const since = linkLateFrom(room);
  const waitsForHost = room.purpose === "handover" && s === "open";
  if (
    room.contact_id &&
    room.purpose !== "booked" &&
    !waitsForHost &&
    since !== null &&
    now - since >= LINK_LATE_MS
  )
    return "link_late";
  return "ready";
}

/** Where "The link has not gone yet" counts from: the later of the open (else the press) and the link's claim. */
export function linkLateFrom(room: RoomView): number | null {
  const opened = t(room.opened_at ?? null) ?? t(room.created_at);
  const claimed = t(room.link_claimed_at ?? null);
  if (opened === null) return claimed;
  return claimed === null ? opened : Math.max(opened, claimed);
}

/**
 * How long a room with a lead may say "Room ready." before the panel says
 * the link has not gone: the sweep asks for a link never claimed a minute
 * after the room opened, and a send has 90 s (sales-api SEND_BUDGET_MS),
 * counted from the later of the open and the link's claim (linkLateFrom).
 * sales-api never sends a link it claims this late after the open when the
 * link cannot be read out: the panel has told the rep to send it.
 */
export const LINK_LATE_MS = LINK_LATE_STEP_MS;

/**
 * How long "Making your room..." may say so: the sweep fails a room the
 * worker never picked up at a minute (R1) and one whose create never
 * answered at two (R2); past that the room is not coming (ours).
 */
export const MAKING_LATE_MS = MAKING_LATE_STEP_MS;

/** The sweep fails a room no worker claimed after a minute (R1); this one is past it. */
export const CLAIM_MINUTE_MS = CLAIM_MINUTE_STEP_MS;
function pastClaimMinute(room: RoomView, now: number): boolean {
  const asked = t(room.created_at);
  return asked === null || now - asked >= CLAIM_MINUTE_MS;
}

/** The moment, with "Still on the call?" answered "Still on it" for now. */
export function momentFor(room: RoomView, ctx: RoomCtx): RoomMoment {
  const m = roomMoment(room, ctx.now);
  if (m === "still_on_call" && ctx.stillOn) return "joined";
  // No worker is making rooms: this one will not be made. Said only once the
  // sweep's own minute for a claim has passed (m1 round 1,
  // worker-red-but-create-accepted): sales-api took the room, and a worker
  // a little late still makes it, so "will not be made" before then would
  // send the rep to give the lead a second link.
  if (
    (m === "making" || m === "making_late") &&
    ctx.workerDown &&
    pastClaimMinute(room, ctx.now)
  )
    return "making_down";
  return m;
}

/**
 * Whose words: P1 owns the copy of a fallback room, P2 of a handover, and
 * the foundation's lines cover every other room and every room whose lead
 * has no first name.
 */
export type Voice = "p1" | "p2" | "f";

export function voiceOf(room: RoomView): Voice {
  if (!first(room)) return "f";
  if (room.purpose === "fallback") return "p1";
  if (room.purpose === "handover") return "p2";
  return "f";
}

/** Milliseconds left on the room's countdown, or null when it has none. */
export function roomLeft(room: RoomView, now: number): number | null {
  const d = roomDeadline(room);
  return d === null ? null : Math.max(0, d - now);
}

/**
 * Zoom has had 30 s to say something since the link went (or the room
 * opened): the rep's own buttons show.
 */
export function manualButtons(room: RoomView, now: number): boolean {
  if (room.provider !== "zoom") return true;
  const from = t(room.link_sent_at) ?? t(room.created_at) ?? now;
  return now - from >= WAITS_S.manual_buttons * 1000;
}

/**
 * "That was not the lead" is allowed for 5 minutes after the join; the
 * button leaves early enough that a press, held 5 s behind its Undo, still
 * reaches sales-api inside them.
 */
export function canSayNotLead(room: RoomView, now: number): boolean {
  if (room.state !== "lead_in") return false;
  const joined = t(room.lead_in_at);
  if (joined === null) return false;
  // The server counts its five minutes from when the room first showed the
  // join (a Zoom join read late keeps Zoom's own time in lead_in_at).
  const at = Math.max(joined, t(room.lead_in_seen_at ?? null) ?? joined);
  return now - at <= NOT_LEAD_LAST_PRESS_MS;
}

/** Sentences the server sends whole; they are shown as they are. */
const WHOLE_SENTENCES = new Set([
  "Your Zoom is in another meeting. End it or use Meet.",
  "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.",
  "Meet rooms are down until the CEO reconnects Google on the room worker. Use Zoom, or call the lead.",
  "Meet rooms are down until the CEO reconnects Google on the room worker. Call the lead for now.",
  "Meet is not checked for your seat yet. Try again in 10 minutes, or use Zoom.",
  "Meet is not checked for your seat yet. Try again in 10 minutes, or call the lead.",
  "Zoom is not checked for your seat yet. Try again in 10 minutes, or use Meet.",
  "Zoom is not checked for your seat yet. Try again in 10 minutes, or call the lead.",
  "Your email has no Zoom user on Mahara's account. Ask the CEO to add you in Zoom. Meet works now.",
  "Your email has no Zoom user on Mahara's account. Ask the CEO to add you in Zoom.",
  "Google did not make the Meet link. Try Zoom.",
  "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
]);

/**
 * A failed room's sentence when the other provider cannot be used from the
 * seat (a setter's Zoom seat still pending): its "Try {other}" advice goes,
 * and it says to phone the lead (stress2, round 1).
 */
export function phoneInstead(text: string): string {
  const cut = text
    .replace(
      /\s*(Try|Use) (Zoom|Meet)(, or call( the lead)? again)?\.\s*$/i,
      "",
    )
    .replace(
      /,?\s*(and )?(try|use) (zoom|meet)(, or call( the lead)? again)?\.\s*$/i,
      ".",
    )
    .replace(/(Zoom|Meet) works now\.\s*$/i, "")
    .trim();
  const head = /[.!?]$/.test(cut) ? cut : `${cut}.`;
  return `${head} Call the lead on the phone.`;
}

/**
 * The sweep failed the room because no room worker made it (R1: never picked
 * up; R2: the make never answered): another room on the other provider
 * waits on the same worker, so the next step is the phone (m1 round 4,
 * worker-down-failed-room-says-try-zoom).
 */
export function workerNeverCame(room: Pick<RoomView, "error">): boolean {
  return /room worker did not (pick this room up|start this room)|making the room took (too long|more than)/i.test(
    String(room.error ?? ""),
  );
}

export function failedSentence(room: RoomView): Sentence {
  const P = providerName(room.provider);
  const O = providerName(otherProvider(room.provider));
  // The database's own failures start "Not made: " (the sweep's R1 and R2);
  // the sentence already says the room was not made, so that goes.
  const err = String(room.error ?? "")
    .trim()
    .replace(/^not made:\s*/i, "");
  // Ours: the provider gave no reason at all.
  if (!err) return [`${P} did not make the room. Try ${O}, or call again.`];
  if (WHOLE_SENTENCES.has(err) || /[.!?]\s+\S/.test(err)) return [err];
  if (room.purpose === "handover" && room.provider === "zoom")
    return [`Zoom did not open your room: ${reasonWords(err)}. Use Meet.`];
  return [
    `${P} did not make the room: ${reasonWords(err)}. Try ${O}, or call again.`,
  ];
}

function joinedSentence(room: RoomView, v: Voice): Sentence {
  const at = { mono: clock(room.lead_in_at) };
  const name = first(room) ?? "";
  const head = v === "p1" ? `${name} joined at ` : "The lead joined at ";
  switch (room.count_result) {
    case "booked":
    case "moved":
      if (v === "p1" && room.call_kind === "intro") {
        // The intro was already booked (moved to now, or this room was
        // made for it): it is marked, not booked again (P1 "Joined").
        if (room.count_result === "moved" || room.appointment_id)
          return [head, at, ". The intro is marked shown."];
        return [`${name} joined. Booked as a live intro and marked shown.`];
      }
      return [
        "The lead joined at ",
        at,
        ". Booked and marked shown in HighLevel.",
      ];
    case "not_a_lead":
      if (v === "p1")
        return [
          `${name} joined. Not booked: this contact is not a tagged lead.`,
        ];
      return [
        "The lead joined at ",
        at,
        ". Not counted: this contact is not a tagged lead.",
      ];
    case "failed":
      // The room carried the lead's booked intro: it is booked already, so
      // the rep marks it shown, never books a second call (stress2, round 2).
      if (room.appointment_id)
        return [
          head,
          at,
          ". The booked intro was not marked shown: mark it shown in the dialer.",
        ];
      // No call carried on the room, but the lead may have one booked
      // elsewhere (the count could not move it): never "book" here, which
      // would make two calls for one lead (stress2 round 4).
      return [
        head,
        at,
        ". Not counted in HighLevel: mark the lead's call there shown, or add this one if they have none.",
      ];
    case "unclear":
      // The booking's answer was lost: never "book it by hand" while one may stand.
      return [
        head,
        at,
        ". HighLevel may have booked it. Check the lead's calendar before booking by hand.",
      ];
    case "already_counted":
      return [head, at, ". Already counted: nothing more is booked."];
    case "self_reported":
      return [
        head,
        at,
        ". Not booked yet: a join marked by hand waits for a manager to count it.",
      ];
    default:
      return [head, at, "."];
  }
}

/**
 * What a closed room's sentence says: how it ended, once. The room line
 * above it already carries every time (sent, opened, joined), so the
 * sentence does not repeat them, nor the title's "Video room on Meet".
 */
export function summarySentence(room: RoomView): Sentence {
  const at = { mono: clock(room.ended_at ?? room.created_at) };
  if (room.result === "moved_to_phone")
    return ["Moved to the phone at ", at, ". Room closed."];
  // A join kept after the timer's close (or after Zoom's end): who joined, and when.
  if (room.state === "expired" && room.result === "joined" && room.lead_in_at)
    return [
      `${first(room) ?? "The lead"} joined at `,
      { mono: clock(room.lead_in_at) },
      ".",
    ];
  if (room.result === "joined" || (room.result === null && room.lead_in_at))
    return ["Finished at ", at, "."];
  if (room.result === "admit_blocked")
    return [
      "Closed at ",
      at,
      ` so the lead can move to ${providerName(otherProvider(room.provider))}.`,
    ];
  // Ours: cancelled while it was being made, or closed before anything happened.
  return ["Room closed at ", at, "."];
}

export interface RoomCtx {
  now: number;
  /** The rep can mark the booked intro this room was for (P1's expiry). */
  canMarkIntro?: boolean;
  /**
   * The page draws the call's own step below the panel (the dialer), where a
   * rep who spoke with the lead saves how it went (stress2 round 3).
   */
  talkBelow?: boolean;
  /** The seat's Available-until, for a standby room. */
  until?: string | null;
  /** "Still on the call?" was answered "Still on it" a moment ago. */
  stillOn?: boolean;
  /** The viewer is a manager: a join marked by hand can be counted (room.count_confirm). */
  manager?: boolean;
  /** The room worker is down (the health line is red): no room can be made, so a failed room offers no retry. */
  workerDown?: boolean;
  /**
   * Whether the host can use the other provider for this call now (room.status
   * `other_ok`). False: no "Try {other}", no "I can't let them in", and the
   * sentence says to phone the lead. Unknown: they show.
   */
  otherOk?: boolean | null;
  /**
   * The room line is on screen with its countdown: the sentence under it
   * leaves the countdown out, so it is not said twice.
   */
  lineShown?: boolean;
}

/** The sentence's next step when a Zoom link cannot be read out (no short link yet). */
const ZOOM_NOT_SAYABLE =
  "Copy the link and send it another way, or end this room and use Meet, whose link can be read out.";

/** The status sentence under the room line. */
export function roomSentence(room: RoomView, ctx: RoomCtx): Sentence {
  const m = momentFor(room, ctx);
  // A closed room whose link may have gone (HighLevel's answer lost, never
  // settled): the warning stays after the close, so nobody sends a second
  // link on top of one that may have reached the lead (m1 round 4,
  // unclear-link-room-closed-dialer-sends-second-link).
  if (
    linkMayHaveGoneClosed(room) &&
    (m === "expired" ||
      m === "expired_opened" ||
      m === "expired_unsent" ||
      m === "ended_empty")
  )
    return [
      `The room is closed. Its link may have gone ${/whatsapp/i.test(room.refusal ?? "") ? "on WhatsApp" : "by email"}: check the lead's conversation in HighLevel before sending another, or call them now.`,
    ];
  const v = voiceOf(room);
  const name = first(room) ?? "";
  const P = providerName(room.provider);
  const left = roomLeft(room, ctx.now);
  // The countdown in words only where no room line shows it.
  const paren = (lead: string): Sentence =>
    left !== null && !ctx.lineShown
      ? [lead, { left, form: "paren" }, "."]
      : [`${lead.trimEnd()}.`];
  const O = providerName(otherProvider(room.provider));
  // A Zoom link with its passcode in it, before the short link: nobody can
  // say it, so the sentence offers Meet, only while Meet is usable for this
  // seat and the room worker is up (m1 round 4, use-meet-ignores-other-ok:
  // Use Meet is hidden then, so the sentence never names it).
  const unsayable =
    room.provider === "zoom" &&
    !readOut(room) &&
    ctx.otherOk !== false &&
    !ctx.workerDown;
  switch (m) {
    case "making":
      return [`Making your ${P} room...`];
    case "making_down":
      return [
        "This room will not be made: video rooms are down. Call the lead on the phone, or send your own Zoom or Meet link.",
      ];
    case "making_late":
      return room.purpose === "booked" || ctx.otherOk === false
        ? ["This room is taking too long to make. Call the lead on the phone."]
        : [
            `This room is taking too long to make. Call the lead on the phone, or end it and try ${O}.`,
          ];
    case "overdue":
      return ["This room should have closed. Call the lead, or end the room."];
    case "failed":
      // The room in place of one the lead knocked on was not made (m1 round
      // 4, failed-replacement-try-meet-sends-missed-call-words): never back
      // to the door she was locked out of; a call now.
      if (room.moved_from && room.contact_id) {
        const from = providerName(room.moved_from === "zoom" ? "zoom" : "meet");
        return [
          `The ${P} room in place of the ${from} room was not made, and ${name || "the lead"} could not be let in. Call them on the phone now.`,
        ];
      }
      return ctx.otherOk === false ||
        ctx.workerDown === true ||
        workerNeverCame(room)
        ? [phoneInstead(sentenceText(failedSentence(room)))]
        : failedSentence(room);
    case "ready":
      return ["Room ready."];
    case "standby_open":
      return [
        "Your room is open. Join it so live leads can come straight to you.",
      ];
    case "standby_in":
      return ctx.until
        ? [
            "You are in your room. Ready until ",
            { mono: clock(ctx.until) },
            ".",
          ]
        : ["You are in your room."];
    case "sent": {
      const ch = channelWords(room.link_channels);
      const at = { mono: clock(room.link_sent_at) };
      // Ours: a link went but the server did not say where ("on" is left out).
      // "by email", "on WhatsApp" (m1 round 1: never "on email").
      const head = ch ? `Link sent ${channelPhrase(ch)} at ` : "Link sent at ";
      // The room in place of one the lead could not get into, its link by
      // email only: the lead still waits at the old room's door, so the rep
      // calls them to say where the new link is (m1 round 2).
      const moved = movedByEmailOnly(room);
      if (moved) return [head, at, `. ${moved}`];
      if (v === "p1" && left !== null)
        return [head, at, ".", ...paren(` Waiting for ${name} `)];
      return [head, at, "."];
    }
    case "not_confirmed": {
      // Fix round 4: a template nobody saw whose email backup did not go is
      // no send at all; the rep reads the link out.
      if (!(room.link_channels ?? []).includes("email")) {
        const said = readOut(room);
        const head =
          "WhatsApp did not confirm the template and the email did not go.";
        return said
          ? [`${head} Read the link out: `, { mono: said }]
          : [
              `${head} ${unsayable ? ZOOM_NOT_SAYABLE : "Copy the link and send it another way."}`,
            ];
      }
      // The link went by email only and HighLevel still holds it (sales-api's
      // pendingEmail, m1 round 4, email-pending-said-as-template-unconfirmed):
      // no WhatsApp went, so the rep reads the link out, never waits.
      if (!(room.link_channels ?? []).some(c => c.startsWith("whatsapp"))) {
        const said = readOut(room);
        const head = "HighLevel has not sent the email yet.";
        return said
          ? [`${head} Read the link out: `, { mono: said }]
          : [`${head} Copy the link and send it another way.`];
      }
      return v === "p1"
        ? [
            "HighLevel did not confirm the WhatsApp template. The link went by email.",
          ]
        : ["Not confirmed on WhatsApp. Sent by email too."];
    }
    case "link_late": {
      const said = readOut(room);
      if (!said)
        return unsayable
          ? [
              "The link has not gone yet. Copy it and send it another way, or end this room and use Meet, whose link can be read out.",
            ]
          : ["The link has not gone yet. Copy it and send it another way."];
      return ["The link has not gone yet. Read it out: ", { mono: said }];
    }
    case "unclear": {
      // Never "Not sent" and never "send it another way": the lead may
      // already have it (m1 round 1, may-have-gone-shown-as-not-sent).
      const how = /whatsapp/i.test(room.refusal ?? "")
        ? "on WhatsApp"
        : "by email";
      return [
        `The link may have gone ${how}. Check the lead's conversation in HighLevel before sending anything else.`,
      ];
    }
    case "retrying":
      // sales-api's own words ("..., so it is tried again in a minute"):
      // nothing for the rep to send, so nothing goes twice (m1 round 4).
      return [`${reasonSentence(room.refusal)}`];
    case "not_sent": {
      const said = readOut(room);
      // Night, and a link nobody can say (m1 round 4,
      // zoom-night-read-out-unsayable): never "read the link out", never
      // "send it another way" (a message at night): Meet's link can be read out.
      if (!said && nightRefusal(room.refusal))
        return [
          ctx.otherOk === false || ctx.workerDown
            ? "Not sent: it is night where the lead is, so no message went, and this Zoom link cannot be read out. Carry on by phone."
            : "Not sent: it is night where the lead is, so no message went, and this Zoom link cannot be read out. If you are speaking with them, end this room and use Meet, whose link can be read out.",
        ];
      // Ours: a link nobody could say (a Zoom link before the short link).
      if (!said)
        return [
          `Not sent: ${reasonWords(room.refusal)}. ${unsayable ? ZOOM_NOT_SAYABLE : "Copy the link and send it another way."}`,
        ];
      return [
        `Not sent: ${reasonWords(room.refusal)}. Read it out: `,
        { mono: said },
      ];
    }
    case "opened": {
      const at = { mono: clock(room.first_open_at) };
      if (v === "p1") return [`${name} opened the link at `, at, ". Join now."];
      const dev = deviceWords(room.open_device);
      return ["The lead opened the link at ", at, dev ? ` on a ${dev}.` : "."];
    }
    case "waiting_room":
      if (room.state === "lead_in")
        return [
          `${name || "The lead"} is back in the waiting room. Admit them in Zoom.`,
        ];
      if (v === "p1")
        return [`${name} is in the waiting room. Admit them in Zoom.`];
      if (v === "p2")
        return [`${name} is in your waiting room. Admit them in Zoom.`];
      return ["The lead is in the waiting room. Admit them in Zoom."];
    case "host_in": {
      const who = v === "p1" ? name : "the lead";
      // Meet never says a lead is knocking, and with the other provider out
      // of reach "I can't let them in" has nowhere to go: the next step for
      // a knock nobody can answer is said (m1 round 1, meet-knock-no-next-step).
      // The same while the room worker is down (m1 round 4,
      // worker-down-panel-keeps-admit-blocked): no other room can be made.
      if (
        room.provider === "meet" &&
        room.contact_id &&
        (ctx.otherOk === false || ctx.workerDown === true)
      )
        return [
          ...paren(`You are in. Waiting for ${who} `),
          " If Meet will not let them in, call them on the phone.",
        ];
      return paren(`You are in. Waiting for ${who} `);
    }
    case "host_in_opened": {
      const at = { mono: clock(room.first_open_at) };
      const who = v === "f" ? "The lead" : name;
      return [
        `${who} opened the link at `,
        at,
        ". Let them in, then press The lead is in.",
      ];
    }
    case "joined":
      return joinedSentence(room, v);
    case "still_on_call":
      return ["Still on the call?"];
    case "expired":
      if (room.end_reason === "host_not_in") return hostNotInSentence(room);
      return ctx.canMarkIntro
        ? ["Nobody joined in 10 minutes. The room is closed. Mark the intro:"]
        : [
            "The lead did not join in 10 minutes. Room closed. Call again or send a message.",
          ];
    case "expired_unsent":
      return [
        "The room closed and its link never reached the lead. Call them, or send a new video link.",
      ];
    case "expired_knocked": {
      const who = name || "The lead";
      if (room.moved_from && !room.lead_waiting_at) {
        const from = providerName(room.moved_from === "zoom" ? "zoom" : "meet");
        return [
          `${who} knocked on the ${from} room and could not be let in, and nobody came into this ${P} room. Call them now.`,
        ];
      }
      const at =
        room.lead_waiting_at ?? room.last_open_at ?? room.first_open_at;
      return [
        `${who} knocked at `,
        { mono: clock(at) },
        " and was not let in. Call them now and send a new link.",
      ];
    }
    case "expired_opened": {
      const who = name || "The lead";
      // Closed because nobody pressed I'm in: the host may be on the call
      // (a booked Meet call joined from the invite), so the line says the
      // close was the host's press, never the lead's (stress2 round 5).
      if (
        room.end_reason === "host_not_in" &&
        room.provider === "meet" &&
        !room.late_open_at
      )
        return hostNotInSentence(room);
      // The lead opened the link after the room closed: the door showed them
      // "This call has ended", so they are at the link now (stress2 round 5).
      if (room.late_open_at && !room.first_open_at && !room.last_open_at)
        return [
          `${who} opened the link at `,
          { mono: clock(room.late_open_at) },
          ", after the room closed. Call them now.",
        ];
      // Meet's own link, nothing seen and nothing pressed (stress2 round 4).
      if (
        room.provider === "meet" &&
        !room.first_open_at &&
        !room.last_open_at
      ) {
        const whom = name || "the lead";
        return [
          ctx.canMarkIntro
            ? `The room is closed, and Meet cannot say whether ${whom} came in. If you spoke, say so below; if not, call them now.`
            : ctx.talkBelow
              ? `The room is closed, and Meet cannot say whether ${whom} came in. If you spoke, save how it went below; if not, call them now.`
              : // The lead page (m1 round 3, lead-page-meet-closed-no-step-if-spoke): Meet reports nothing, so the usual case is that they spoke.
                `The room is closed, and Meet cannot say whether ${whom} came in. If you spoke, save how it went in the dialer; if not, call them now.`,
        ];
      }
      // Meet sends no join signal: the room cannot say they did not join
      // (stress2, round 2: the rep may have let them in and talked).
      if (room.provider === "meet")
        return [
          `${who} opened the link at `,
          { mono: clock(room.last_open_at ?? room.first_open_at) },
          // Only where something below takes the answer (stress2 round 3):
          // the intro's own marks, or the dialer's Save how it went.
          ctx.canMarkIntro
            ? ". The room is closed, and Meet cannot say whether they came in. If you spoke, say so below; if not, call them now."
            : ctx.talkBelow
              ? ". The room is closed, and Meet cannot say whether they came in. If you spoke, save how it went below; if not, call them now."
              : ". The room is closed, and Meet cannot say whether they came in. If you spoke, save how it went in the dialer; if not, call them now.",
        ];
      return [
        `${who} opened the link at `,
        { mono: clock(room.last_open_at ?? room.first_open_at) },
        " but did not join. Room closed. Call them now.",
      ];
    }
    case "expired_unknown":
      return [
        `Whether ${name || "the lead"} joined is not known: Zoom's events were not all read. ${
          ctx.canMarkIntro ? "Mark the intro by hand." : "Call them to check."
        }`,
      ];
    case "ended_empty": {
      const at = { mono: clock(room.ended_at ?? room.created_at) };
      // Ended inside the ten minutes the lead's link promised (m1 round 4,
      // end-early-offers-noshow-inside-promised-ten-minutes): the lead may
      // be opening the link now, so no No-show until then.
      const until = promisedWaitAhead(room, ctx.now);
      if (until !== null && ctx.canMarkIntro)
        return [
          "Room ended at ",
          at,
          `. Nobody joined. ${name || "The lead"} was told the room would wait until `,
          { mono: clock(new Date(until).toISOString()) },
          ", so mark the intro after that, or call them now.",
        ];
      return ctx.canMarkIntro
        ? ["Room ended at ", at, ". Nobody joined. Mark the intro:"]
        : [
            "Room ended at ",
            at,
            ". Nobody joined. Call again or send a message.",
          ];
    }
    case "closed":
      return summarySentence(room);
  }
}

/**
 * A room the sweep closed because the host was not seen in it in time
 * (end_reason host_not_in). On Meet only the host's I'm in says so, so the
 * host may well be on the call; on Zoom the host did not join. Never "the
 * lead did not join in 10 minutes" (stress2 round 5).
 */
function hostNotInSentence(room: RoomView): Sentence {
  if (room.provider === "meet")
    return [
      `Closed because nobody pressed I'm in. If you are on the call, carry on; mark the ${room.call_kind} after it.`,
    ];
  return [
    "Closed because you did not join the room in time. Call them again or send a message.",
  ];
}

/**
 * A second line when Zoom has said nothing at all 30 s after the link: the
 * rep's own buttons are the way now. Once Zoom has reported anything (the
 * lead waiting, the host in) its events are arriving and the line goes.
 */
export function roomHint(room: RoomView, now: number): Sentence | null {
  if (room.provider !== "zoom" || room.state !== "open" || isStandby(room))
    return null;
  if (room.lead_waiting_at || room.host_in_at) return null;
  if (!manualButtons(room, now)) return null;
  return ["Zoom has not said you are in. Press I'm in once you are."];
}

export type Tone = "now" | "good" | "owed" | "bad" | "quiet";

/**
 * A room that failed only because the host's Zoom seat is waiting on its
 * invite (the server's sentence, or the room worker's): something the rep
 * does, not a fault, so it is owed, not red.
 */
function waitsOnZoomSeat(room: RoomView | null | undefined): boolean {
  return /seat is not active yet|invite is not accepted yet/i.test(
    room?.error ?? "",
  );
}

/** The colour of the dot beside the sentence (the words stay in ink). */
export function roomTone(m: RoomMoment, room?: RoomView | null): Tone {
  switch (m) {
    case "joined":
      return "good";
    case "not_sent":
    case "retrying":
    case "unclear":
    case "link_late":
    case "expired_unsent":
    case "not_confirmed":
    case "expired":
    case "expired_knocked":
    case "expired_opened":
    case "expired_unknown":
    case "ended_empty":
    case "making_late":
    case "overdue":
      return "owed";
    case "failed":
      return waitsOnZoomSeat(room) ? "owed" : "bad";
    case "making_down":
      return "bad";
    case "closed":
      return "quiet";
    default:
      // "Still on the call?" asks for an answer now; it is not news of a join.
      return "now";
  }
}

export type StepKey = "sent" | "opened" | "in" | "lead";

export interface Step {
  key: StepKey;
  label: string;
  at: string | null;
  done: boolean;
  /** The step the room is waiting on; it carries the teal dot. */
  current: boolean;
  /** "read out" when the link could not go and the rep reads the code. */
  note: string | null;
}

/**
 * The room line: Link sent, Opened, You're in, Lead in. `frozen` draws no
 * step as current: what shows may be old, or the room is not moving.
 */
export function roomSteps(
  room: RoomView,
  opts: { frozen?: boolean } = {},
): Step[] {
  const s = room.state;
  const final = isFinal(s);
  // A link still tried again is neither read out nor "not sent" (m1 round 4).
  const readOutOnly =
    !room.link_sent_at && Boolean(room.refusal) && !linkRetrying(room.refusal);
  const steps: Step[] = [
    {
      key: "sent",
      label: "Link sent",
      at: room.link_sent_at,
      done: Boolean(room.link_sent_at),
      current: false,
      note: readOutOnly ? (readOut(room) ? "read out" : "not sent") : null,
    },
    {
      key: "opened",
      label: "Opened",
      at: room.first_open_at ?? room.lead_waiting_at,
      done: Boolean(
        room.first_open_at ||
          room.lead_waiting_at ||
          s === "lead_in" ||
          (final && room.lead_in_at),
      ),
      current: false,
      note: null,
    },
    {
      key: "in",
      label: "You're in",
      at: room.host_in_at,
      // A host who left before the lead came is out again (host_in → open).
      done: final
        ? Boolean(room.host_in_at)
        : s === "host_in" || s === "lead_in",
      current: false,
      note: null,
    },
    {
      key: "lead",
      label: "Lead in",
      at: room.lead_in_at,
      done: final ? Boolean(room.lead_in_at) : s === "lead_in",
      current: false,
      note: null,
    },
  ];
  if (!final && !isStandby(room) && !opts.frozen) {
    // Meet's own link reports no open while the short link is off: the
    // teal step is the one the room can still hear about (m1 round 4,
    // journey r4-6), never Opened.
    const blindOpen = room.provider === "meet" && !shortLinkOn(room);
    const next = steps.find(
      st =>
        !st.done &&
        !(st.key === "sent" && readOutOnly) &&
        !(st.key === "opened" && blindOpen),
    );
    if (next) next.current = true;
  }
  return steps;
}

export type RoomActionKey =
  | "open"
  | "copy"
  | "email"
  | "end"
  | "host_in"
  | "lead_in"
  | "not_lead"
  | "on_phone"
  | "finished"
  | "still_on"
  | "admit_blocked"
  | "retry"
  | "noshow"
  | "showed"
  | "count_confirm"
  /** The lead page's way to the dialer after a join: book the next call, or save how it went (stress2 round 4). */
  | "to_dialer";

export interface RoomAction {
  key: RoomActionKey;
  label: string;
}

const act = (key: RoomActionKey, label: string): RoomAction => ({
  key,
  label,
});

/** The one right button, and the quiet ones beside it. */
export function roomActions(
  room: RoomView,
  ctx: RoomCtx,
): { primary: RoomAction | null; quiet: RoomAction[] } {
  const out = momentActions(room, ctx);
  // A join only a hand press reported is not counted until a manager says
  // so (room.count_confirm); the manager sees the button, everyone the line.
  if (ctx.manager && room.count_result === "self_reported")
    return {
      ...out,
      quiet: [...out.quiet, act("count_confirm", "Count this join")],
    };
  return out;
}

function momentActions(
  room: RoomView,
  ctx: RoomCtx,
): { primary: RoomAction | null; quiet: RoomAction[] } {
  const m = momentFor(room, ctx);
  const hasLead = Boolean(room.contact_id);
  const booked = room.purpose === "booked";
  const other = providerName(otherProvider(room.provider));
  switch (m) {
    case "making":
    case "making_down":
      return { primary: null, quiet: booked ? [] : [act("end", "End room")] };
    case "making_late":
      // Ours: ending it and asking the other provider is one press.
      return {
        primary: null,
        quiet: booked
          ? []
          : [
              ...(hasLead && ctx.otherOk !== false
                ? [act("retry", `Try ${other}`)]
                : []),
              act("end", "End room"),
            ],
      };
    case "overdue":
      // The sweep is late: ending the room is the one thing left to do.
      return {
        primary: booked ? null : act("end", "End room"),
        quiet: shortLink(room) ? [act("copy", "Copy link")] : [],
      };
    case "failed": {
      return {
        primary:
          hasLead &&
          !booked &&
          !ctx.workerDown &&
          ctx.otherOk !== false &&
          // Never "Try {moved_from}" on a failed replacement: it sends the
          // lead back to the room she could not get into (m1 round 4).
          !room.moved_from
            ? // P2 says the handover's button as [Use Meet]; P1 says "Try Zoom".
              act(
                "retry",
                room.purpose === "handover" ? `Use ${other}` : `Try ${other}`,
              )
            : null,
        quiet: [],
      };
    }
    case "expired":
    case "ended_empty":
      return {
        primary: null,
        quiet: ctx.canMarkIntro
          ? promisedWaitAhead(room, ctx.now)
            ? [act("showed", "We spoke on the phone")]
            : [act("noshow", "No-show"), act("showed", "We spoke on the phone")]
          : [],
      };
    case "expired_unsent":
      // The link never went (m1 round 4): never a No-show press.
      return {
        primary: null,
        quiet: ctx.canMarkIntro ? [act("showed", "We spoke on the phone")] : [],
      };
    case "expired_knocked":
    case "expired_opened":
    case "expired_unknown":
      // The lead knocked, opened the link, or may have joined: never a
      // No-show press here (it is not quiet: HighLevel's no-show automation
      // writes to the lead), only what the rep can say (stress2, round 1).
      // A Meet room on the lead page: the way to the dialer, where how it
      // went is saved (m1 round 3).
      return {
        primary: null,
        quiet: ctx.canMarkIntro
          ? [act("showed", "We spoke on the phone")]
          : m === "expired_opened" && room.provider === "meet"
            ? saveInDialer(room, ctx)
            : [],
      };
    case "closed":
      // "I can't let them in" closed this room and its replacement was not
      // made (the server's answer was an error): the lead is knocking at a
      // closed room, so the one right action is the other provider.
      if (
        room.state === "cancelled" &&
        room.result === "admit_blocked" &&
        hasLead &&
        !booked
      )
        return {
          primary: act(
            "retry",
            `Try ${providerName(otherProvider(room.provider))}`,
          ),
          quiet: [],
        };
      return { primary: null, quiet: toDialer(room, ctx) };
    case "standby_in":
      return { primary: null, quiet: [] };
    case "standby_open":
      // Meet sends no join signal: the rep says they are in, so the seat is
      // Ready and the sweep keeps the room (stress2, round 1).
      return {
        primary: act("open", "Open my room"),
        quiet: room.provider === "meet" ? [act("host_in", "I'm in")] : [],
      };
    case "waiting_room":
      // On a call already: the lead dropped and is back at Zoom's door, so
      // the call's own presses stay (m1 round 4).
      if (room.state !== "lead_in") break;
      return { primary: null, quiet: [act("finished", "Finished")] };
    case "joined":
    case "still_on_call": {
      const quiet: RoomAction[] = [];
      if (canSayNotLead(room, ctx.now))
        quiet.push(act("not_lead", "That was not the lead"));
      // "Still on the call?" can be answered either way; Finished waits
      // behind its Undo, so a reflex tap does not end a call in progress.
      if (m === "still_on_call")
        return {
          primary: act("finished", "Finished"),
          quiet: [...quiet, act("still_on", "Still on it")],
        };
      quiet.push(act("finished", "Finished"));
      return { primary: null, quiet };
    }
  }
  // open or host_in, with a lead. A Meet room this tab opened, whose link the
  // lead opened, is one the rep is in (stress2 round 4): The lead is in first.
  const meet = room.provider === "meet";
  const hostIn = room.state === "host_in" || m === "host_in_opened";
  const quiet: RoomAction[] = [];
  const late = m === "link_late" && Boolean(shortLink(room));
  // The rep opened this Meet room from this tab: the next press is I'm in,
  // as the banner says it (m1 round 4, journey r4-7), never a second tab.
  const openedMeet = meet && !hostIn && openedHere.has(room.id);
  const primary = late
    ? act("copy", "Copy link")
    : hostIn
      ? act("lead_in", "The lead is in")
      : openedMeet
        ? act("host_in", "I'm in")
        : act("open", "Open my room");
  // Only someone in the room can let the lead in, so "The lead is in"
  // waits for "I'm in" (or Zoom's own word that the host joined).
  if (late)
    quiet.push(
      hostIn ? act("lead_in", "The lead is in") : act("open", "Open my room"),
    );
  if (hostIn) quiet.push(act("open", "Open my room"));
  else if (openedMeet) {
    if (!late) quiet.push(act("open", "Open my room"));
  }
  // One label for the one step ("You're in" on the line), on Meet and Zoom.
  else if (meet || manualButtons(room, ctx.now))
    quiet.push(act("host_in", "I'm in"));
  if (shortLink(room) && !late) quiet.push(act("copy", "Copy link"));
  if (
    hasLead &&
    !booked &&
    m !== "retrying" &&
    !room.link_channels.includes("email") &&
    !emailBlocked(room) &&
    // Night on the lead's clock: room.send would refuse it (m1 round 4).
    room.send_night !== true &&
    !nightRefusal(room.refusal)
  )
    quiet.push(
      act(
        "email",
        // "Also" only when the link already went another way.
        room.link_channels.length ? "Also send by email" : "Send by email",
      ),
    );
  // A Zoom link nobody can say, and nothing sent it: Meet's link can be read
  // out. Never on a room whose link went by email (m1 round 4,
  // use-meet-offered-on-room-whose-link-went): the press cancels the room
  // that email leads to. Never while Meet is not usable for this seat
  // (otherOk false), whose room sales-api would refuse.
  const linkWentByEmail =
    Boolean(room.link_sent_at) && room.link_channels.includes("email");
  if (
    !meet &&
    hasLead &&
    !booked &&
    !ctx.workerDown &&
    ctx.otherOk !== false &&
    !readOut(room) &&
    !linkWentByEmail &&
    (m === "not_sent" || m === "link_late" || m === "not_confirmed")
  )
    quiet.push(act("retry", "Use Meet"));
  if (room.purpose === "fallback" || room.purpose === "manual")
    quiet.push(act("on_phone", "We are on the phone"));
  // P1 edge case 9: a Meet knock the setter cannot admit moves the lead to
  // Zoom, only when the seat can use Zoom for this call (stress2, round 1).
  // The lead page's room too (m1 round 1, meet-knock-no-next-step).
  if (
    meet &&
    (room.purpose === "fallback" || room.purpose === "manual") &&
    hasLead &&
    ctx.otherOk !== false &&
    // Its replacement needs the room worker (m1 round 4): hidden while it is
    // down, as Try Zoom and Use Meet are.
    !ctx.workerDown
  )
    quiet.push(act("admit_blocked", "I can't let them in"));
  if (!booked) quiet.push(act("end", "End room"));
  return { primary, quiet };
}

/**
 * A closed room whose link may have reached the lead and was never settled
 * (sales-api's "The link may have gone ..."): the dialer offers no second
 * video link for the call while it stands, and sales-api refuses one
 * (link_may_have_gone).
 */
export function linkMayHaveGoneClosed(
  room: RoomView | null | undefined,
): boolean {
  return Boolean(
    room &&
      isFinal(room.state) &&
      room.contact_id &&
      !room.link_sent_at &&
      !room.lead_in_at &&
      mayHaveGone(room.refusal),
  );
}

/**
 * The lead's room holds a No-show for their calls, as sales-api does
 * (index.ts videoLinkHoldsNoShow): open; closed on the lead's knock or made
 * in place of a room they knocked on, with no join; or inside the wait the
 * link promised (m1 round 4).
 */
export function roomHoldsNoShow(
  room: RoomView | null | undefined,
  now: number,
): boolean {
  if (!room?.contact_id) return false;
  if (!isFinal(room.state)) return true;
  if (room.lead_in_at) return false;
  if (room.result === "admit_blocked" || room.moved_from) return true;
  return promisedWaitAhead(room, now) !== null;
}

/** sales-api's night refusals (lead_night_read_out, lead_night_unsayable): no message goes now. */
export function nightRefusal(refusal: string | null | undefined): boolean {
  return /^it is night where the lead is/i.test(String(refusal ?? "").trim());
}

/**
 * The end of the wait the lead's link promised ("I'll wait for you for the
 * next 10 minutes"), when it is still ahead: lead_by, else the latest link
 * plus the lead's ten minutes. sales-api holds a person's No-show until
 * then (index.ts videoLinkHoldsNoShow), whatever the room's state.
 */
export function promisedWaitAhead(room: RoomView, now: number): number | null {
  if (!room.contact_id || room.lead_in_at) return null;
  const sent = t(room.last_link_at ?? null) ?? t(room.link_sent_at);
  const until =
    t(room.lead_by) ?? (sent === null ? null : sent + WAITS_S.lead * 1000);
  return until !== null && until > now ? until : null;
}

/**
 * After a join that stands, on the lead page (no intro marks and no saved
 * outcome below the panel): the way to the dialer, where the next call is
 * booked and how it went is saved (stress2 round 4,
 * joined-banner-leads-to-page-with-no-booking).
 */
function toDialer(room: RoomView, ctx: RoomCtx): RoomAction[] {
  if (ctx.canMarkIntro || ctx.talkBelow || !room.contact_id) return [];
  if (room.purpose !== "fallback" && room.purpose !== "manual") return [];
  if (!room.lead_in_at) return [];
  return [act("to_dialer", "Book the next call")];
}

/**
 * A closed Meet room nothing was seen in, on the lead page (no intro marks
 * and no saved outcome below the panel): Meet reports nothing, so the rep
 * who spoke saves how it went in the dialer (m1 round 3).
 */
function saveInDialer(room: RoomView, ctx: RoomCtx): RoomAction[] {
  if (ctx.canMarkIntro || ctx.talkBelow || !room.contact_id) return [];
  if (room.purpose !== "fallback" && room.purpose !== "manual") return [];
  return [act("to_dialer", "Save how it went")];
}

/**
 * The link could not go for a reason email cannot get round either: the
 * lead has no email (or email is off, or do-not-disturb), or no message can
 * reach them at all. "Send by email" would only be refused.
 */
export function emailBlocked(room: RoomView): boolean {
  // "call links this hour": sales-api's cap on one lead (link_flood), which
  // room.send holds too, so the panel never offers a send it refuses.
  return /email|no link can go|active client|no message can reach|call links this hour/i.test(
    room.refusal ?? "",
  );
}

/** The label the undo strip shows while a press waits to be sent (ours). */
export function undoLabel(key: RoomActionKey): string {
  switch (key) {
    case "lead_in":
      return "Marking the lead as in";
    case "not_lead":
      return "Marking that it was not the lead";
    case "noshow":
      return "Marking no-show";
    case "showed":
      return "Marking that you spoke on the phone";
    case "finished":
      return "Ending the room";
    case "admit_blocked":
      return "Moving the lead to Zoom";
    default:
      return "Sending";
  }
}

/**
 * Presses that wait 5 seconds behind an Undo before they are sent: the
 * ones that write to HighLevel, end a call in progress, or send the lead a
 * second message.
 */
export function needsUndo(key: RoomActionKey): boolean {
  return (
    key === "lead_in" ||
    key === "not_lead" ||
    key === "noshow" ||
    key === "showed" ||
    key === "finished" ||
    key === "admit_blocked"
  );
}

/**
 * The request "Try Zoom" sends: the same lead, kind and purpose as the
 * room that failed, and what made it (trigger, attempt, booked call), so
 * the new room counts where the first would have.
 */
export function retryRequest(
  room: RoomView,
  firstAsk: CreateRoom | null | undefined,
  provider: Provider,
): CreateRoom {
  const out: CreateRoom = {
    contact_id: room.contact_id,
    provider,
    call_kind: room.call_kind,
    purpose: room.purpose,
  };
  const trigger = firstAsk?.trigger ?? room.trigger;
  const attempt = firstAsk?.attempt_id ?? room.attempt_id;
  // The booked intro the first press named (m1 round 1): a room that does
  // not carry it (a confirmation call's) still passed fallback.scope on it,
  // so its retry asks with it, as a confirmation call's room again.
  const appointment =
    firstAsk?.appointment_id ??
    room.appointment_id ??
    room.asked_appointment_id;
  if (trigger) out.trigger = trigger;
  if (attempt) out.attempt_id = attempt;
  if (appointment) out.appointment_id = appointment;
  if (firstAsk?.item_kind) out.item_kind = firstAsk.item_kind;
  else if (!room.appointment_id && room.asked_appointment_id)
    out.item_kind = "confirm";
  // The room this one follows (m1 round 4): one still open is replaced in
  // one server step, never cancelled first
  // (use-meet-cancel-then-create-refused-loses-room); a failed one is named
  // so a retry inside a day press's grace keeps that press's day
  // (failed-room-try-other-refused-at-night).
  out.replaces = room.id;
  out.replaces_version = room.version;
  return out;
}

/** A note before a Zoom room is made (the dialer's picker). */
export function zoomNote(
  zoom: ZoomStatus | null | undefined,
  kind: CallKind,
): string | null {
  if (zoom === "pending")
    return "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.";
  if (zoom === "basic" && kind === "demo")
    return "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.";
  return null;
}

// ---------------------------------------------------------------------------
// The banner's room line (P1's strip)
// ---------------------------------------------------------------------------

/** A booked call's start: `starts_at`, else host_by minus 15 minutes. */
export function bookedStart(room: RoomView): number | null {
  if (room.purpose !== "booked") return null;
  const start = t(room.starts_at);
  if (start !== null) return start;
  const hostBy = t(room.host_by);
  return hostBy === null ? null : hostBy - BOOKED_HOST_MS;
}

/** Something has happened in the room: the lead opened it, knocked, or someone is in. */
function stirred(room: RoomView): boolean {
  return Boolean(
    room.first_open_at ||
      room.lead_waiting_at ||
      room.state === "host_in" ||
      room.state === "lead_in",
  );
}

/** Moments whose panel sentence is also the banner's: each says what to do now. */
const BANNER_SAYS_PANEL: ReadonlySet<RoomMoment> = new Set([
  "waiting_room",
  "host_in_opened",
  "not_sent",
  "retrying",
  "unclear",
  "link_late",
  "making_down",
  "making_late",
  "overdue",
  // A knock nobody let in: call them now (stress2 round 3).
  "expired_knocked",
]);

/**
 * A lead's room that failed, or closed on a knock nobody let in, stays in the
 * banner this long after it ended, until the rep opens the lead (stress2
 * round 3): the one rep who should act is told, though they moved on.
 */
export const BANNER_FINAL_MS = 15 * 60_000;
const BANNER_KEEPS: ReadonlySet<RoomMoment> = new Set([
  "failed",
  "expired_knocked",
  // The lead opened the link and the room closed with nobody seen in it
  // (Meet's Ask to join is never reported): call them now (stress2 round 4).
  "expired_opened",
]);
const seenFinal = new Set<string>();

/** A closed room the rep has seen on its lead's panel: the banner lets it go. */
export function markFinalSeen(roomId: string): void {
  seenFinal.add(roomId);
}

/**
 * What a press of Next lead says once its room was asked for (DialerPage
 * sendOnLeave): "on its way" only for a room that was not refused or failed.
 */
export function leaveToast(
  room: RoomView,
  name: string,
): { ok: boolean; text: string } {
  if (roomMoment(room, Date.now()) === "failed" || room.state === "failed")
    return {
      ok: false,
      text: `The video link to ${name} was not sent. ${sentenceText(failedSentence(room))}`,
    };
  return { ok: true, text: `Video link on its way to ${name}.` };
}

/**
 * "Video room: Faisal, 7:40 left.", then "Faisal opened the link." With the
 * worker down, a room still being made says it will not be made.
 */
export function bannerRoomSentence(
  room: RoomView,
  now: number,
  ctx: { workerDown?: boolean } = {},
): Sentence {
  const m = momentFor(room, { now, workerDown: ctx.workerDown });
  const name = first(room);
  const Name = name ?? "The lead";
  if (m === "making")
    return [`Making your ${providerName(room.provider)} room...`];
  // A room that failed after the rep moved on (stress2 round 3).
  if (m === "failed" && isFinal(room.state)) {
    const failed = sentenceText(failedSentence(room));
    // No other room can be made while the worker is down (m1 round 4).
    const said =
      ctx.workerDown === true || workerNeverCame(room)
        ? phoneInstead(failed)
        : failed;
    return [
      `The link to ${name ?? "the lead"} was not sent. ${said} Open the lead.`,
    ];
  }
  // The lead opened the link and the room closed with nobody seen in it,
  // after the rep moved on (stress2 round 4): Meet's Ask to join is never
  // reported, so the one rep who should act is told.
  if (
    m === "expired_opened" &&
    isFinal(room.state) &&
    room.late_open_at &&
    !room.first_open_at &&
    !room.last_open_at
  )
    return [
      `${Name} opened the link at `,
      { mono: clock(room.late_open_at) },
      ", after the room closed. Call them now.",
    ];
  if (
    m === "expired_opened" &&
    isFinal(room.state) &&
    (room.first_open_at || room.last_open_at)
  )
    return [
      `${Name} opened the link at `,
      { mono: clock(room.last_open_at ?? room.first_open_at) },
      " and the room has closed. If you did not speak, call them now.",
    ];
  // The host opened their Meet room: Meet will not say when the lead is in,
  // so the banner says the next step (stress2, round 2).
  if (
    room.provider === "meet" &&
    room.state === "open" &&
    openedHere.has(room.id) &&
    room.first_open_at
  )
    return [
      `${Name} opened the link. Let them in, then open the lead and press The lead is in.`,
    ];
  // A template nobody saw with no email behind it is no send: the panel's
  // own sentence (read the link out), never a countdown (stress2 round 3).
  if (
    BANNER_SAYS_PANEL.has(m) ||
    (m === "not_confirmed" && !(room.link_channels ?? []).includes("email"))
  )
    return roomSentence(room, { now, workerDown: ctx.workerDown });
  if (m === "joined") return [`${Name} joined.`];
  // Past the call's planned end, or the rep rang the lead again since the
  // join (m1 round 3b): asked, never "joined" for an hour.
  if (m === "still_on_call")
    return [`Still on the call with ${name ?? "the lead"}?`];
  // The host opened their Meet room: Meet will not say when the lead is in,
  // so the banner says the next step (stress2, round 2).
  if (
    room.provider === "meet" &&
    room.state === "open" &&
    openedHere.has(room.id)
  )
    return room.first_open_at
      ? [
          `${Name} opened the link. Let them in, then open the lead and press The lead is in.`,
        ]
      : ["In your Meet room? Open the lead and press I'm in."];
  if (room.first_open_at) return [`${Name} opened the link.`];
  const start = bookedStart(room);
  // Ours: a booked call says when it is, not how long its room waits.
  if (start !== null && !stirred(room))
    return [
      `Booked ${room.call_kind} with ${name ?? "the lead"} at `,
      { mono: clock(new Date(start).toISOString()) },
      ".",
    ];
  const left = roomLeft(room, now);
  const head: Sentence = name
    ? [`Video room: ${name}`]
    : ["Video room: ", { mono: room.code }];
  // Meet's own link (the short link off): the lead's Ask to join reaches
  // nobody and is never reported while the rep is not in the room (m1
  // round 3b, short-link-off-meet-next-lead-lead-asks-to-join-empty-room).
  const beThere: Sentence =
    room.provider === "meet" &&
    room.state === "open" &&
    room.contact_id &&
    room.link_sent_at &&
    !shortLinkOn(room)
      ? [` Meet lets ${name ?? "the lead"} in only when you are in the room.`]
      : [];
  return left === null
    ? [...head, ".", ...beThere]
    : [
        ...head,
        { left, form: "sentence", lead: ", ", spoken: "." },
        ...beThere,
      ];
}

/**
 * Rooms this tab opened with Open my room. Meet sends no signal when the host
 * goes in, so once the host has opened a Meet room the banner leads to the
 * lead's page, where I'm in and The lead is in are (stress2, round 2).
 */
const openedHere = new Set<string>();

/** Whether this tab opened the room (Open my room). */
export function roomOpenedHere(roomId: string): boolean {
  return openedHere.has(roomId);
}

/** Get in while the room waits for its host; after that, go to the lead. */
export function bannerRoomAction(room: RoomView): {
  key: "open_room" | "open_lead";
  label: string;
} {
  const meetOpened = room.provider === "meet" && openedHere.has(room.id);
  return room.state === "open" && room.contact_id && !meetOpened
    ? { key: "open_room", label: "Open my room" }
    : { key: "open_lead", label: "Open the lead" };
}

const ROOM_URGENCY: Partial<Record<RoomMoment, number>> = {
  waiting_room: 0,
  host_in_opened: 0,
  expired_knocked: 1,
  expired_opened: 1,
  failed: 2,
  joined: 1,
  still_on_call: 1,
  opened: 2,
  host_in: 3,
};

/**
 * The room the banner shows: the seat's own live room with a lead in it.
 * A booked call's room waits until the call starts (or something happens
 * in it), so a link sent 15 minutes ahead does not cover the seat's strip.
 */
export function myRoom(
  rooms: readonly RoomView[],
  now: number,
): RoomView | null {
  const live = rooms.filter(r => {
    if (isStandby(r)) return false;
    if (isFinal(r.state)) {
      // Kept a while when it failed or closed on a knock, until the rep sees it on the lead's panel.
      if (!r.contact_id || seenFinal.has(r.id)) return false;
      // A late open is news from its own time (stress2 round 5).
      const ended =
        t(r.late_open_at ?? null) ?? t(r.ended_at) ?? t(r.created_at);
      const m = roomMoment(r, now);
      return (
        BANNER_KEEPS.has(m) &&
        // Only an open the door saw: a closed Meet room with nothing seen says nothing to the banner.
        (m !== "expired_opened" ||
          Boolean(r.first_open_at || r.last_open_at || r.late_open_at)) &&
        ended !== null &&
        now - ended < BANNER_FINAL_MS
      );
    }
    const start = bookedStart(r);
    return start === null || now >= start || stirred(r);
  });
  if (!live.length) return null;
  return [...live].sort((a, b) => {
    const ua = ROOM_URGENCY[roomMoment(a, now)] ?? 9;
    const ub = ROOM_URGENCY[roomMoment(b, now)] ?? 9;
    if (ua !== ub) return ua - ub;
    return (t(b.created_at) ?? 0) - (t(a.created_at) ?? 0);
  })[0];
}

/** The seat's standby room, when it has one. */
export function standbyRoom(rooms: readonly RoomView[]): RoomView | null {
  return rooms.find(r => isStandby(r) && !isFinal(r.state)) ?? null;
}

// ---------------------------------------------------------------------------
// The availability strip
// ---------------------------------------------------------------------------

/** Something the strip says for a moment after a press or a lost offer. */
export type StripFlash =
  | { kind: "taken"; at: number }
  | { kind: "lost"; at: number; by: string | null; text: string | null }
  | { kind: "closed"; at: number }
  | { kind: "missed"; at: number; missedAt: string }
  | { kind: "error"; at: number; text: string };

export type StripMoment =
  | "error"
  | "offer"
  | "taken"
  | "lost"
  | "closed"
  | "missed"
  | "refresh"
  | "booked_call"
  | "down"
  | "standby_failed"
  | "making"
  | "away"
  | "available"
  | "ready"
  | "on_call";

export type StripActionKey =
  | "available"
  | "away"
  | "join"
  /** "I'm in" for a standby room on Meet, which sends no join signal. */
  | "host_in"
  | "take"
  | "decline"
  | "keep"
  | "stop";

export interface StripAction {
  key: StripActionKey;
  label: string;
  disabled?: boolean;
}

export interface StripLine {
  moment: StripMoment;
  sentence: Sentence;
  primary: StripAction | null;
  quiet: StripAction[];
  /** The offer the line is about. */
  offer: Offer | null;
  /** True for an offer and what follows a press on it: it outranks a room. */
  urgent: boolean;
  tone: Tone;
  /** A press on the offer that failed, said under it (the offer stays). */
  note: string | null;
  /** The offer's own note from the setter, on a second line. */
  detail: string | null;
}

const OFFER_REASON: Record<string, string> = {
  on_call: "on the line with the setter",
  replied: "just replied on WhatsApp",
};

export function offerLeft(o: Offer, now: number): number {
  return Math.max(0, (t(o.offer_until) ?? now) - now);
}

/** How much of the two minutes is left, 1 to 0, for the draining bar. */
export function offerFraction(o: Offer, now: number): number {
  return Math.min(1, Math.max(0, offerLeft(o, now) / (WAITS_S.offer * 1000)));
}

/**
 * "Live demo lead, Saudi Arabia, on the line with the setter." The offer's
 * countdown is drawn on its own beside the buttons, and the setter's note
 * on a second line (`offerNote`), so the sentence reads at a glance.
 */
export function offerSentence(o: Offer, _now?: number): Sentence {
  const kind = String(o.kind ?? "").trim();
  const head = /^(demo|intro)$/i.test(kind)
    ? `Live ${kind.toLowerCase()} lead`
    : "Live lead";
  const bits = [o.country, OFFER_REASON[o.reason]]
    .map(x => String(x ?? "").trim())
    .filter(Boolean);
  return [`${[head, ...bits].join(", ")}.`];
}

/** The setter's one line for whoever takes the offer: "Note: Runs 3 crews." */
export function offerNote(o: Offer): string | null {
  const note = String(o.note ?? "").trim();
  if (!note) return null;
  return `Note: ${note}${/[.!?]$/.test(note) ? "" : "."}`;
}

/** The offers the strip can still put in front of the seat, soonest to close first. */
export function liveOffers(
  offers: readonly Offer[],
  now: number,
  hidden: readonly string[] = [],
): Offer[] {
  const gone = new Set(hidden);
  return offers
    .filter(o => !gone.has(o.id) && offerLeft(o, now) > 0)
    .sort((a, b) => (t(a.offer_until) ?? 0) - (t(b.offer_until) ?? 0));
}

/**
 * The sweep set this seat Away for a missed offer. With the database's
 * reason served, only `missed_offer` is a miss (Go away during an offer is
 * not); without it, Away after an offer left is read as one.
 */
function awayForMiss(me: Presence): boolean {
  if (me.state !== "away") return false;
  return me.reason === undefined || me.reason === "missed_offer";
}

/**
 * An offer that was on the strip and is gone: missed when the seat is now
 * Away for it (one miss sets Away), else closed by someone else or the
 * setter. Offers this seat answered are not news.
 */
export function offerGone(
  prev: readonly Offer[],
  next: readonly Offer[],
  me: Presence,
  answered: ReadonlySet<string>,
  now: number,
  /** The seat's rooms in the same read: a room made for the offer means it was taken here. */
  nextRooms: readonly RoomView[] = [],
): StripFlash | null {
  for (const o of prev) {
    if (answered.has(o.id) || next.some(n => n.id === o.id)) continue;
    // Taken in another tab of this seat: its room is the news, not "closed".
    if (nextRooms.some(r => r.handover_id === o.id)) continue;
    if (awayForMiss(me)) {
      const until = t(o.offer_until);
      return {
        kind: "missed",
        at: now,
        missedAt:
          until !== null && until <= now
            ? o.offer_until
            : new Date(now).toISOString(),
      };
    }
    return { kind: "closed", at: now };
  }
  return null;
}

const FLASH_MS: Record<StripFlash["kind"], number | null> = {
  taken: 20_000,
  lost: 8000,
  closed: 8000,
  error: 8000,
  missed: null,
};

/** The flash still worth saying, or null once it has run its course. */
export function activeFlash(
  flash: StripFlash | null,
  data: LiveStatus | null,
  now: number,
): StripFlash | null {
  if (!flash) return null;
  const life = FLASH_MS[flash.kind];
  if (life !== null && now - flash.at > life) return null;
  // Taken: the room it made is now the news.
  if (flash.kind === "taken" && data && myRoom(data.rooms, now)) return null;
  // Missed: said while the seat stays Away.
  if (flash.kind === "missed" && data && data.me.state !== "away") return null;
  return flash;
}

/** The standby room has waited long enough that Zoom will soon close it. */
export function needsRefresh(
  room: RoomView | null,
  now: number,
  kept: readonly string[] = [],
): boolean {
  if (room?.state !== "host_in" || kept.includes(room.id)) return false;
  // Zoom's 40-minute rule only: a Meet standby room is never refreshed (stress2 round 3).
  if (room.provider !== "zoom") return false;
  const since = t(room.host_in_at) ?? t(room.created_at);
  if (since === null) return false;
  return now - since >= (WAITS_S.standby_max - REFRESH_AHEAD_S) * 1000;
}

export interface StripInput {
  me: Presence;
  rooms: readonly RoomView[];
  offers: readonly Offer[];
  health: Health | null;
  now: number;
  flash: StripFlash | null;
  /** Offers answered here, hidden until the server drops them. */
  hidden?: readonly string[];
  /** Standby rooms the rep chose to keep. */
  kept?: readonly string[];
  /** Why the standby room could not be made (live.status `standby_error`). */
  standbyError?: string | null;
  /** Whether Available makes a standby room at all (live.status `standby_on`); unknown counts as yes. */
  standbyOn?: boolean;
}

const BOOKED_REASONS = new Set(["booked_call", "booked_call_soon"]);

/** sales-api's standby refusals a press again would only repeat (ROOMS_COPY standby_too_late, standby_booked_soon). */
const NO_RETRY_STANDBY =
  /^Live calls end in under \d+ minutes?\b|^Your booked call at .* starts soon\b/;

const A = (
  key: StripActionKey,
  label: string,
  disabled = false,
): StripAction => (disabled ? { key, label, disabled } : { key, label });

/** What the availability strip says, and its buttons. */
export function stripLine(i: StripInput): StripLine {
  const line = (
    moment: StripMoment,
    sentence: Sentence,
    primary: StripAction | null,
    quiet: StripAction[] = [],
    tone: Tone = "now",
    offer: Offer | null = null,
  ): StripLine => ({
    moment,
    sentence,
    primary,
    quiet,
    offer,
    urgent:
      moment === "offer" ||
      moment === "taken" ||
      moment === "lost" ||
      moment === "closed" ||
      moment === "error",
    tone,
    note: null,
    detail: null,
  });
  const f = i.flash;

  // An offer still open comes first: no flash hides it. A press on it that
  // failed is said under it, so it can be pressed again.
  const offer = liveOffers(i.offers, i.now, i.hidden)[0] ?? null;
  if (offer) {
    const l = line(
      "offer",
      offerSentence(offer, i.now),
      A("take", "Take it"),
      [A("decline", "Not now")],
      "now",
      offer,
    );
    if (f?.kind === "error") l.note = f.text;
    l.detail = offerNote(offer);
    return l;
  }

  if (f?.kind === "error") return line("error", [f.text], null, [], "bad");
  if (f?.kind === "taken")
    return line("taken", ["Taken. Sending the link..."], null, [], "good");
  if (f?.kind === "lost")
    return line(
      "lost",
      [
        f.by
          ? `${f.by} took this one.`
          : (f.text ?? "Someone else took this lead."),
      ],
      null,
      [],
      "quiet",
    );
  if (f?.kind === "closed")
    return line(
      "closed",
      [
        "This offer closed at ",
        { mono: clock(new Date(f.at).toISOString()) },
        ". Nothing to do.",
      ],
      null,
      [],
      "quiet",
    );

  if (f?.kind === "missed" && i.me.state === "away")
    return line(
      "missed",
      [
        "You missed a live lead at ",
        { mono: clock(f.missedAt) },
        " and are now Away.",
      ],
      A("available", "I'm available"),
      [],
      "owed",
    );

  const standby = standbyRoom(i.rooms);
  if (
    (i.me.state === "ready" || i.me.state === "available") &&
    needsRefresh(standby, i.now, i.kept)
  )
    return line(
      "refresh",
      [
        "Zoom closes a room 40 minutes after only one person is left. Stay available?",
      ],
      A("keep", "Keep me available"),
      [A("stop", "Stop")],
      "owed",
    );

  const until = i.me.until ? { mono: clock(i.me.until) } : null;
  // The room closed for a booked call: said until the call starts, with no
  // button, because I'm available now would open a room again. The database
  // serves this while the rep is still Available (or Away), so it comes
  // before both, and no offer reaches them meanwhile.
  const bookedAt = t(i.me.booked_at);
  if (
    i.me.state !== "on_call" &&
    i.me.state !== "ready" &&
    BOOKED_REASONS.has(i.me.reason ?? "") &&
    bookedAt !== null &&
    bookedAt > i.now
  )
    return line(
      "booked_call",
      [
        `Your booked ${i.me.booked_kind === "intro" ? "intro" : "demo"} starts at `,
        { mono: clock(i.me.booked_at) },
        // The button that will be there after the call: still Available,
        // "Get my room"; Away, "I'm available" (stress2, round 1). An Away
        // seat never had a room to close (stress2, round 2).
        i.me.state === "available"
          ? ", so your room is closed. Press Get my room after it."
          : i.me.availability === "away"
            ? ". Press I'm available after it."
            : ", so your room is closed. Press I'm available after it.",
      ],
      null,
      [],
      "quiet",
    );
  switch (i.me.state) {
    case "on_call":
      // Ours: the specs give this state no line.
      return line("on_call", ["On a call."], null, [], "good");
    case "ready":
      return line(
        "ready",
        until
          ? ["In your room until ", until, ". The next live lead comes to you."]
          : ["In your room. The next live lead comes to you."],
        // Waiting is the job here; leaving is the quiet choice.
        null,
        [A("away", "Set me away")],
      );
    case "available": {
      const open =
        standby !== null &&
        (standby.state === "open" || standby.state === "host_in");
      if (!open && i.health && workerDownOf(i.health))
        return line(
          "down",
          [healthSentence(i.health)],
          null,
          [A("away", "Set me away")],
          "bad",
        );
      // Meet sends no join signal, and a Zoom room that has said nothing for
      // manual_buttons (30 s) gets the rep's own I'm in too, as every other
      // Zoom room does (stress2, round 2: a lost host-join event).
      const meetOpen = standby?.provider === "meet" && standby.state === "open";
      const imIn =
        standby !== null &&
        standby.state === "open" &&
        (meetOpen || manualButtons(standby, i.now));
      if (open)
        return line(
          "available",
          until
            ? [
                "Available until ",
                until,
                meetOpen
                  ? ". Join your room, then press I'm in to get leads first."
                  : ". Join your room to get leads first.",
              ]
            : [
                meetOpen
                  ? "Available. Join your room, then press I'm in to get leads first."
                  : "Available. Join your room to get leads first.",
              ],
          A("join", "Join my room"),
          // A closer who steps away must be able to say so here, or offers
          // keep coming for up to two hours (final review). Meet sends no
          // join signal, so the rep says they are in (stress2, round 1).
          [...(imIn ? [A("host_in", "I'm in")] : []), A("away", "Set me away")],
        );
      // Ours, below: the room is not there to join, and the strip says why.
      if (standby && isMaking(standby.state))
        return line(
          "making",
          until
            ? ["Available until ", until, ". Making your room..."]
            : ["Available. Making your room..."],
          A("join", "Join my room", true),
          [A("away", "Set me away")],
        );
      // A refusal a press again would only repeat (live calls end in under
      // five minutes, the seat's booked call starts soon): said as it is,
      // with no Try again (stress2, round 2).
      if (i.standbyError && NO_RETRY_STANDBY.test(i.standbyError))
        return line(
          "standby_failed",
          [i.standbyError],
          null,
          [A("away", "Set me away")],
          "owed",
        );
      if (i.standbyError)
        return line(
          "standby_failed",
          [standbyFailedSentence(i.standbyError)],
          A("available", "Try again"),
          [A("away", "Set me away")],
          "owed",
        );
      // No room and no reason given: rooms for standby are switched off,
      // or the room closed for a booked call or a lead's room. While
      // standby rooms are on, the strip offers one again (stress2, round 1).
      return line(
        "available",
        until ? ["Available until ", until, "."] : ["Available."],
        i.standbyOn === false ? null : A("available", "Get my room"),
        [A("away", "Set me away")],
      );
    }
    default: {
      // A press refused a moment ago (outside live hours, say): its reason,
      // never the same Away line and button with nothing said (stress2).
      if (i.standbyError)
        return line(
          "away",
          [`Away. ${i.standbyError}`],
          A("available", "I'm available"),
          [],
          "owed",
        );
      return line(
        "away",
        ["Away. Live leads skip you."],
        A("available", "I'm available"),
        [],
        "quiet",
      );
    }
  }
}

/**
 * Why the standby room was not made, and what to do. The room worker's own
 * sentences are whole ("Your email has no Zoom user on Mahara's account.
 * Use Meet, ..."), so they are said as they are; a bare reason is set after
 * a colon. A reason that only repeats "could not be made" adds nothing.
 */
export function standbyFailedSentence(error: string): string {
  const err = String(error ?? "")
    .trim()
    .replace(/^not made:\s*/i, "");
  const next = "Try again, or set yourself away.";
  // sales-api's standby cap (final review) already says what to do.
  if (/^Your last standby room closed\b/.test(err)) return err;
  if (!err || /^(the )?room (could not be|was not) made\.?$/i.test(err))
    return `Your room was not made. ${next}`;
  if (/[.!?]\s+\S/.test(err) || /^[A-Z].*[.!?]$/.test(err))
    return `Your room was not made. ${/[.!?]$/.test(err) ? err : `${err}.`} ${next}`;
  return `Your room was not made: ${reasonWords(err)}. ${next}`;
}

// ---------------------------------------------------------------------------
// The banner: one thing at a time
// ---------------------------------------------------------------------------

/** P3's reply alert, when the follow-up agent's lane passes one in. */
export interface ReplyAlert {
  contact_id: string;
  name: string | null;
  at: string;
  /** A closer is free, so the alert also offers a call now. */
  closer_free?: boolean;
}

/** "{Lead} wrote 3 minutes ago. Answer now." */
export function replySentence(a: ReplyAlert, now: number): Sentence {
  const mins = Math.max(0, Math.floor((now - (t(a.at) ?? now)) / 60_000));
  const when =
    mins === 0
      ? "just now"
      : mins === 1
        ? "1 minute ago"
        : `${mins} minutes ago`;
  return [`${a.name?.trim() || "A lead"} wrote ${when}. Answer now.`];
}

export type BannerSlot = "offer" | "room" | "handover" | "reply" | "presence";

/**
 * The banner shows one thing, in this order: an offer, my open room, a
 * handover I started, a reply alert, then the seat's own strip with the
 * portal's banner.
 */
export function bannerSlot(i: {
  strip: StripLine | null;
  room: RoomView | null;
  handover: boolean;
  reply: boolean;
}): BannerSlot | null {
  if (i.strip?.urgent) return "offer";
  if (i.room) return "room";
  if (i.handover) return "handover";
  if (i.reply) return "reply";
  if (i.strip) return "presence";
  return null;
}

/** Room moments worth calling a rep back to the cockpit's tab for. */
export const CALL_BACK: ReadonlySet<RoomMoment> = new Set([
  "opened",
  "waiting_room",
  "host_in_opened",
]);

/**
 * What a hidden tab should call the rep back for, comparing two reads: a
 * new offer, or the seat's room turning to "opened" or "waiting room". The
 * key names the news once, so it is said once.
 */
export function liveNews(
  prev: LiveStatus | null,
  next: LiveStatus,
  now: number,
  hidden: readonly string[] = [],
): { key: string; text: string } | null {
  const had = new Set((prev?.offers ?? []).map(o => o.id));
  const offer = liveOffers(next.offers, now, hidden).find(o => !had.has(o.id));
  if (offer)
    return {
      key: `offer:${offer.id}`,
      text: [sentenceText(offerSentence(offer), true), offerNote(offer)]
        .filter(Boolean)
        .join(" "),
    };
  const before = new Map((prev?.rooms ?? []).map(r => [r.id, r]));
  for (const r of next.rooms) {
    const m = roomMoment(r, now);
    if (!CALL_BACK.has(m)) continue;
    const was = before.get(r.id);
    if (was && roomMoment(was, now) === m) continue;
    return {
      key: `room:${r.id}:${m}`,
      text: sentenceText(
        bannerRoomSentence(r, now, {
          workerDown: workerDownOf(next.health),
        }),
        true,
      ),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The health line
// ---------------------------------------------------------------------------

/**
 * The room worker is down for the screens: no rooms are being made. A
 * worker that runs and reports a problem (worker_trouble) is not down: its
 * red line says what is wrong, and the other provider is still offered.
 */
export function workerDownOf(
  h: Pick<Health, "worker_ok" | "worker_trouble"> | null | undefined,
): boolean {
  return h?.worker_ok === false && h.worker_trouble !== true;
}

export function healthTone(h: Health): "good" | "owed" | "bad" {
  if (!h.worker_ok) return "bad";
  if (/disagree/i.test(h.line ?? "")) return "owed";
  return "good";
}

/**
 * The health line under a room's panel (m1 round 4,
 * worker-red-line-under-live-room-says-send-own-link): under a room that is
 * already open (its link out, or the call on), the worker being down only
 * means no new room can be made, so the line says that and never "send your
 * own Zoom or Meet link", which would send the lead a second link. The full
 * sentence stays for the Team page and for rooms still being made or failed.
 */
export function panelHealthSentence(
  h: Health,
  room: Pick<RoomView, "state"> | null | undefined,
): string {
  if (
    workerDownOf(h) &&
    room &&
    (room.state === "open" ||
      room.state === "host_in" ||
      room.state === "lead_in")
  )
    return "New video rooms cannot be made right now. This room still works.";
  return healthSentence(h);
}

/** The server's sentence; the foundation's wording when it sent none. */
export function healthSentence(h: Health): string {
  const line = String(h.line ?? "").trim();
  if (line) return line;
  if (h.worker_ok) {
    const head = `Rooms: working. Last run ${clockSec(h.last_run_at)}.`;
    // Counts that could not be read are left out, never shown as 0.
    if (h.rooms_today === null || h.failed_today === null) return head;
    return `${head} ${h.rooms_today} ${h.rooms_today === 1 ? "room" : "rooms"} today, ${h.failed_today} failed.`;
  }
  if (!h.last_run_at)
    // Ours: the worker has never written its row.
    return "Video rooms are not being made: the room worker has not run yet. Call the lead on the phone, or send your own Zoom or Meet link.";
  return `Video rooms are not being made (last check ${clock(h.last_run_at)}). Call the lead on the phone, or send your own Zoom or Meet link.`;
}

// ---------------------------------------------------------------------------
// Merging what the server says with what a press already returned
// ---------------------------------------------------------------------------

/**
 * The later of two copies of a room. A poll that left before a press
 * answered carries an older version and must not undo what the press
 * showed.
 */
export function newer(a: RoomView | null | undefined, b: RoomView): RoomView {
  return a && a.id === b.id && a.version > b.version ? a : b;
}

/**
 * A read merged into what is on screen. `afterSet` is true when a press put
 * its answer on screen while this read was on its way: the read is older
 * than the press, so it may not take back what the press showed.
 */
export function mergeRoomFeed(
  prev: RoomFeed | null,
  next: RoomFeed,
  _afterSet = false,
): RoomFeed {
  if (!prev || prev.room.id !== next.room.id) return next;
  const room = newer(prev.room, next.room);
  return room === next.room ? next : { ...next, room };
}

/**
 * live.status merged into what is on screen. A room a press ended stays
 * gone from a read that left before the press (`gone`, by version), until
 * a read no longer lists it; presence from a read older than a press keeps
 * the press's answer, because presence has no version.
 */
export function mergeLive(
  prev: LiveStatus | null,
  next: LiveStatus,
  afterSet = false,
): LiveStatus {
  if (!prev) return next;
  const listed = new Set(next.rooms.map(r => r.id));
  const gone: Record<string, number> = {};
  for (const [id, v] of Object.entries(prev.gone ?? {}))
    if (listed.has(id)) gone[id] = v;
  const old = new Map(prev.rooms.map(r => [r.id, r]));
  const rooms = next.rooms
    .filter(r => !(r.id in gone && r.version <= gone[r.id]))
    .map(r => newer(old.get(r.id), r));
  const out: LiveStatus = {
    ...next,
    rooms,
    me: afterSet ? prev.me : next.me,
  };
  if (Object.keys(gone).length) out.gone = gone;
  else delete out.gone;
  return out;
}

/** A room a press returned, put into the strip's list (or taken out when final). */
export function withRoom(live: LiveStatus, room: RoomView): LiveStatus {
  const have = live.rooms.find(r => r.id === room.id);
  const next = newer(have, room);
  const rest = live.rooms.filter(r => r.id !== room.id);
  if (!isFinal(next.state)) return { ...live, rooms: [next, ...rest] };
  // A lead's room that failed (or closed on a knock) stays for the banner
  // to say so, until the rep opens the lead (stress2 round 3).
  if (
    next.contact_id &&
    !seenFinal.has(next.id) &&
    BANNER_KEEPS.has(roomMoment(next, Date.now()))
  )
    return { ...live, rooms: [next, ...rest] };
  return {
    ...live,
    rooms: rest,
    gone: { ...(live.gone ?? {}), [next.id]: next.version },
  };
}

// ---------------------------------------------------------------------------
// Request ids: a retry is the same request
// ---------------------------------------------------------------------------

/** A v4 UUID, also where `crypto.randomUUID` is missing (an old Safari). */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A press asked again within this long is a retry of the same request. */
export const RETRY_WINDOW_MS = 120_000;

const intents = new Map<string, { id: string; at: number }>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Send a write once. A second press while the first is on its way gets the
 * first one's answer and sends nothing. After an answer that may not have
 * landed (no answer, a cut connection, a 5xx), the next press within two
 * minutes sends the same `request_id`, so the server hands back the row it
 * already made instead of making a second. A clear yes or a clear no starts
 * a fresh id.
 */
export function once<T>(
  key: string,
  send: (requestId: string) => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const held = intents.get(key);
  const id = held && now - held.at < RETRY_WINDOW_MS ? held.id : newRequestId();
  intents.set(key, { id, at: now });
  const p: Promise<T> = Promise.resolve()
    .then(() => send(id))
    .then(
      out => {
        intents.delete(key);
        return out;
      },
      (e: unknown) => {
        if (!uncertain(e)) intents.delete(key);
        throw e;
      },
    )
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** The request id a retry of `key` would carry now (tests and debugging). */
export function heldRequestId(key: string): string | null {
  return intents.get(key)?.id ?? null;
}

/** Forget every held request id: on sign-out, on a change of seat, and in tests. */
export function forgetRequests(): void {
  intents.clear();
  inflight.clear();
  openedHere.clear();
  seat = null;
}

let seat: string | null = null;

/**
 * Tie held request ids to the signed-in seat: when another seat signs in on
 * the same tab, the last seat's retries are forgotten, so sales-api never
 * hands one seat's room to another.
 */
export function scopeRequests(email: string | null | undefined): void {
  const e = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!e) return;
  if (seat !== null && seat !== e) forgetRequests();
  seat = e;
}

// ---------------------------------------------------------------------------
// The calls (contract.md; live.take and live.decline are project 2's)
// ---------------------------------------------------------------------------

export interface CreateRoom {
  contact_id: string | null;
  provider: Provider;
  call_kind: CallKind;
  purpose: RoomPurpose;
  trigger?: string;
  attempt_id?: string;
  appointment_id?: string;
  /** The dialer item: a confirmation call's room never carries the intro (stress2, round 2). */
  item_kind?: "intro" | "confirm" | "lead";
  /**
   * "Use Meet" / "Try Zoom": the room this one follows and the version on
   * show. On a room still open sales-api checks the new room first and
   * cancels this one only when the new one will be made; on a failed one it
   * is the retry's first press (m1 round 4).
   */
  replaces?: string;
  replaces_version?: number;
}

type Versioned = Pick<RoomView, "id" | "version">;

/** A new room for this seat: the strip reads now instead of at its next poll. */
function nudge<T extends { room?: RoomView }>(p: Promise<T>): Promise<T> {
  return p.then(out => {
    roomsChanged(out.room ?? null);
    return out;
  });
}

/**
 * room.end's answer. After "I can't let them in" (`admit_blocked`)
 * sales-api makes the room on the other provider inside the same request:
 * `replacement` is that room, or `replacement_refusal` says why it could
 * not be made (contract v2 section 4).
 */
export interface EndAnswer {
  room: RoomView;
  replacement?: RoomView;
  replacement_refusal?: string;
}

export function endAnswer(v: unknown): EndAnswer {
  const out: EndAnswer = roomAnswer(v);
  const next = isObj(v) ? normalizeRoom(v.replacement) : null;
  if (next) out.replacement = next;
  const no = isObj(v) ? str(v.replacement_refusal) : null;
  if (no && !next) out.replacement_refusal = no;
  return out;
}

/** Said when "I can't let them in" was answered with neither a room nor a reason. */
export const ADMIT_NO_ANSWER =
  "This room has closed, so no new room was made. Send a new video link if the lead still needs one.";

/**
 * What the panel does after "I can't let them in": show the room sales-api
 * made, or say why it made none. Never a plain room of the panel's own
 * (m1 round 2, admit-blocked-on-closed-room-answers-neither): a room made
 * that way is no replacement (no "moved" words, the night rule, a second
 * link to a lead who may be on the phone).
 */
export function afterAdmitBlocked(
  out: EndAnswer,
): { kind: "show"; room: RoomView } | { kind: "refused"; text: string } {
  if (out.replacement) return { kind: "show", room: out.replacement };
  return { kind: "refused", text: out.replacement_refusal ?? ADMIT_NO_ANSWER };
}

/**
 * How long a live read waits. live.status and room.status are reads, safe
 * to ask again, so a hung one fails in 10 s and the screen says it is old.
 */
export const READ_TIMEOUT_MS = 10_000;

/** A Send a video link whose answer never came: it may have gone, so the rep checks before pressing again (m1 round 2). */
export const CREATE_LOST =
  "The answer did not come back, so the video link may have gone. Check the lead's room before you try again.";

const createKey = (input: CreateRoom) =>
  `room.create:${input.contact_id ?? "standby"}:${input.purpose}:${input.provider}`;

/**
 * Forget the request ids held for a lead's Send a video link once a room of
 * theirs is seen closed (m1 round 2, create-retry-id-returns-ended-room): a
 * press after that is a new request, never answered with the closed room.
 */
export function forgetCreates(contactId: string | null | undefined): void {
  if (!contactId) return;
  for (const k of [...intents.keys()])
    if (k.startsWith(`room.create:${contactId}:`)) intents.delete(k);
}

/** A room that is closed: the lead's held Send a video link ids are forgotten. */
function seenClosed<T extends { room?: RoomView | null }>(out: T): T {
  if (out.room && isFinal(out.room.state)) forgetCreates(out.room.contact_id);
  return out;
}

async function createRoom(input: CreateRoom): Promise<{ room: RoomView }> {
  const key = createKey(input);
  const send = () =>
    once(key, request_id =>
      api<unknown>("room.create", { ...input, request_id }).then(roomAnswer),
    );
  // A press carrying a held id (its first answer was lost) answered with a
  // room that has closed since: that was the last press's room, so this
  // press is asked once more as a new request (m1 round 2).
  // (A second press while the first is still on its way shares its answer.)
  const retry = heldRequestId(key) !== null && !inflight.has(key);
  let out: { room: RoomView };
  try {
    out = await send();
  } catch (e) {
    if (
      e instanceof ApiError &&
      (e.kind === "network" || e.kind === "timeout" || e.kind === "cut")
    )
      throw new ApiError(CREATE_LOST, e.kind, e.status, e.code);
    throw e;
  }
  if (retry && isFinal(out.room.state)) out = await send();
  return out;
}

export const roomsApi = {
  create: (input: CreateRoom) => nudge(createRoom(input)),
  status: (roomId: string) =>
    api<unknown>(
      "room.status",
      { room_id: roomId },
      { timeoutMs: READ_TIMEOUT_MS },
    ).then(v => {
      const feed = normalizeRoomFeed(v);
      // Another room's answer is never drawn as this one.
      if (feed.room.id !== roomId) throw unreadable();
      return seenClosed(feed);
    }),
  open: (roomId: string) =>
    api<unknown>("room.open", { room_id: roomId }).then(v => {
      const url = isObj(v) ? webUrl(v.start_url) : null;
      if (!url) throw unreadable(true);
      openedHere.add(roomId);
      return { start_url: url };
    }),
  mark: (room: Versioned, what: MarkWhat) =>
    api<unknown>("room.mark", {
      room_id: room.id,
      version: room.version,
      what,
    }).then(roomAnswer),
  /** A manager counts a join only a hand press reported. */
  countConfirm: (roomId: string) =>
    api<unknown>("room.count_confirm", { room_id: roomId }).then(roomAnswer),
  end: (room: Versioned, reason: EndReason, confirm = false) =>
    api<unknown>("room.end", {
      room_id: room.id,
      version: room.version,
      reason,
      ...(confirm ? { confirm: true } : {}),
    })
      .then(endAnswer)
      .then(seenClosed),
  sendEmail: (roomId: string) =>
    once(`room.send:${roomId}:email`, request_id =>
      api<unknown>("room.send", {
        room_id: roomId,
        request_id,
        channel: "email",
      }).then(roomAnswer),
    ),
  wrap: (appointmentId: string) =>
    nudge(
      once(`room.wrap:${appointmentId}`, request_id =>
        api<unknown>("room.wrap", {
          appointment_id: appointmentId,
          request_id,
        }).then(roomAnswer),
      ),
    ),
  availability: (state: "available" | "away") =>
    api<unknown>("live.availability", { state }).then(v => {
      const me = isObj(v) ? normalizePresence(v.me) : null;
      if (!me) throw unreadable(true);
      // Why no standby room was made, kept for the strip (stress2, round 1).
      return { me, standby_error: isObj(v) ? str(v.standby_error) : null };
    }),
  liveStatus: () =>
    api<unknown>("live.status", {}, { timeoutMs: READ_TIMEOUT_MS })
      .then(normalizeLive)
      .then(live => {
        for (const r of live.rooms)
          if (isFinal(r.state)) forgetCreates(r.contact_id);
        return live;
      }),
  /**
   * The claim carries no version: cockpit_sales_live_claim checks the
   * offer's own state, time and seat, so another write to the row (a Slack
   * post saved) does not make a Take fail.
   */
  take: (offer: Pick<Offer, "id">) =>
    nudge(
      once(`live.take:${offer.id}`, request_id =>
        api<unknown>("live.take", { live_id: offer.id, request_id }).then(v => {
          const room = isObj(v) ? normalizeRoom(v.room) : null;
          return room ? { room } : {};
        }),
      ),
    ),
  decline: (offer: Pick<Offer, "id">) =>
    once(`live.decline:${offer.id}`, request_id =>
      api<unknown>("live.decline", { live_id: offer.id, request_id }).then(
        () => ({}),
      ),
    ),
};

/**
 * The refusal's code when the server sent one (contract v2 section 3),
 * else null. Screens read the code first and match words only for an
 * answer without one.
 */
export function refusalCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

/**
 * A refusal the server sends when a press saw an older room: code `stale`,
 * or, from a sales-api that sends no code yet, its pinned sentence "This
 * changed a moment ago." (roomlogic.copy.test.ts).
 */
export function isStale(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code) return e.code === "stale";
  return /changed a moment ago/i.test(e.message);
}

/**
 * The server asks before it ends a room with the lead still in it: code
 * `confirm_end`, or the pinned sentence "The lead is still in this room.
 * End it anyway?".
 */
export function needsEndConfirm(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code) return e.code === "confirm_end";
  return /still in this room/i.test(e.message);
}

/**
 * What a failed Take means for the strip: the offer changed under the press
 * (read again, keep it up), another seat won (it goes, "lost"), or it may
 * have gone through (it stays, with the sentence under it, and a second
 * press is the same request).
 */
export function takeFailure(e: unknown): "stale" | "lost" | "uncertain" {
  if (isStale(e)) return "stale";
  if (e instanceof ApiError && e.kind === "refused") return "lost";
  return "uncertain";
}

/**
 * What a failed Not now means: a clear no is an offer already gone (nothing
 * to put back); anything else was not recorded, so the offer comes back,
 * because ending unanswered would set the seat Away as a miss.
 */
export function declineFailure(e: unknown): "gone" | "again" {
  return e instanceof ApiError && e.kind === "refused" ? "gone" : "again";
}

export const DECLINE_AGAIN =
  "Not now did not reach the server. Press it again.";

/**
 * The room a press held behind its Undo goes to: the one it was pressed on,
 * only while that room is still the one on show.
 */
export function heldTarget(
  heldRoomId: string,
  onShow: RoomView | null,
): RoomView | null {
  return onShow && onShow.id === heldRoomId ? onShow : null;
}

/** A failure as one sentence a rep can act on. */
export function errorText(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? "").trim();
  return m || "That did not work. Try again.";
}

// ---------------------------------------------------------------------------
// Browser helpers: the host's tab, the clipboard, a nudge to the strip
// ---------------------------------------------------------------------------

export type Opened = { kind: "opened" } | { kind: "blocked"; url: string };

/**
 * Open the host's own link in a new tab. A tab opened after a wait is
 * blocked as a pop-up, so the tab is opened at the press, empty, and sent
 * to the room when the link arrives. When the browser blocks even that, the
 * caller shows the link to tap.
 */
export async function openHostRoom(roomId: string): Promise<Opened> {
  // The press is the rep's gesture: the moment to wake the alerts that call
  // them back while they sit in the room's tab.
  primeAlerts();
  let tab: Window | null = null;
  try {
    tab = window.open("", "_blank");
    if (tab) {
      tab.document.title = "Opening your room";
      tab.document.body.textContent = "Opening your room...";
    }
  } catch {
    // A browser that refuses to open or write the tab: the link is shown instead.
  }
  try {
    const { start_url } = await roomsApi.open(roomId);
    if (tab && !tab.closed) {
      try {
        tab.opener = null;
      } catch {
        // Some browsers make opener read-only; the room still opens.
      }
      tab.location.href = start_url;
      return { kind: "opened" };
    }
    return { kind: "blocked", url: start_url };
  } catch (e) {
    try {
      tab?.close();
    } catch {
      // Already closed.
    }
    throw e;
  }
}

/** Copy text, with the old way for a browser without the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Not allowed here (an insecure page, a denied permission): try below.
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

const ROOMS_CHANGED = "mahara:rooms-changed";

/**
 * Tell the strip a room changed, so it reads now instead of in 30 s. With
 * the room a press returned, the strip puts it on screen at once, and a
 * read already on its way cannot bring an ended room back.
 */
export function roomsChanged(room: RoomView | null = null): void {
  try {
    window.dispatchEvent(new CustomEvent(ROOMS_CHANGED, { detail: room }));
  } catch {
    // No window (tests).
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/** The wait before the next read; failures back off to at most 30 s. */
export function backoff(baseMs: number, failures: number): number {
  if (failures <= 0) return baseMs;
  return Math.max(baseMs, Math.min(30_000, baseMs * 2 ** failures));
}

function failureOf(e: unknown): {
  kind: ApiFailure | null;
  status: number | null;
} {
  return e instanceof ApiError
    ? { kind: e.kind, status: e.status }
    : { kind: null, status: null };
}

/** The strip reads every 4 s, every 30 s when Away, every minute when switched off. */
export function liveDelay(
  data: LiveStatus | null,
  failures: number,
  error: unknown,
): number {
  const { kind } = failureOf(error);
  if (kind === "signin") return 0;
  if (kind === "refused") return 60_000;
  const quiet =
    data?.me.state === "away" &&
    !data.offers.length &&
    !data.rooms.some(r => !isFinal(r.state));
  return backoff(quiet ? 30_000 : 4000, failures);
}

/** A room reads every 2 s while it is being made, every 4 s after, and stops when final. */
export function roomDelay(
  data: RoomFeed | null,
  failures: number,
  error: unknown,
): number {
  const { kind, status } = failureOf(error);
  if (kind === "signin" || status === 403 || status === 404) return 0;
  if (data && isFinal(data.room.state) && !error) return 0;
  return backoff(data && !isMaking(data.room.state) ? 4000 : 2000, failures);
}

/**
 * How far the server's clock is ahead of the browser's, from one read: the
 * server's `now` against the middle of the trip. Null when it sent none.
 */
export function clockOffset(
  serverNow: string | null | undefined,
  sentAt: number,
  gotAt: number,
): number | null {
  const s = t(serverNow);
  if (s === null) return null;
  return Math.round(s - (sentAt + gotAt) / 2);
}

/** The parts of a page the poller uses; the tests pass their own. */
export interface PollEnv {
  doc: {
    visibilityState: string;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
  win: {
    setTimeout(fn: () => void, ms: number): number;
    clearTimeout(id: number): void;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
  now(): number;
  /** Hear of a new sign-in or a refreshed token; returns the way out. */
  onAuth?: (fn: () => void) => () => void;
}

const authListeners = new Set<() => void>();
let authWatch = false;

/**
 * One listener on the session for every poll: a token refreshed or a new
 * sign-in restarts a poll that stopped because the sign-in ran out.
 */
function onAuth(fn: () => void): () => void {
  authListeners.add(fn);
  if (!authWatch) {
    authWatch = true;
    // Loaded when first needed, so this file stays free of the client (the
    // tests run it without one): polls then restart on focus and online.
    import("./supabase")
      .then(({ supabase }) =>
        supabase.auth.onAuthStateChange(event => {
          if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") return;
          for (const f of [...authListeners]) f();
        }),
      )
      .catch(() => undefined);
  }
  return () => {
    authListeners.delete(fn);
  };
}

/**
 * Timers that still run in a hidden tab. After five minutes hidden, Chrome
 * runs a page's chained timers at most once a minute, so a closer sitting
 * in Zoom would hear an offer up to a minute late. A worker's timers are not
 * held back that way: each wait runs there and, as a backstop, on the page
 * too; whichever ends first fires, so a worker that fails changes nothing.
 */
const hiddenTimer = (() => {
  let worker: Worker | null | undefined;
  const pending = new Map<number, { fn: () => void; backup: number }>();
  let seq = 0;
  const fire = (id: number) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    window.clearTimeout(p.backup);
    p.fn();
  };
  const start = (): Worker | null => {
    if (worker !== undefined) return worker;
    worker = null;
    try {
      if (typeof Worker === "undefined" || typeof Blob === "undefined")
        return null;
      const src =
        "const t=new Map();onmessage=e=>{const d=e.data||{};if(d.ms<0){clearTimeout(t.get(d.id));t.delete(d.id);return}t.set(d.id,setTimeout(()=>{t.delete(d.id);postMessage(d.id)},d.ms))}";
      const url = URL.createObjectURL(
        new Blob([src], { type: "text/javascript" }),
      );
      const w = new Worker(url);
      w.onmessage = e => fire(Number(e.data));
      w.onerror = () => {
        worker = null;
      };
      worker = w;
    } catch {
      worker = null;
    }
    return worker;
  };
  return {
    set(fn: () => void, ms: number): number {
      const w =
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? start()
          : null;
      if (!w) return window.setTimeout(fn, ms);
      seq += 1;
      const id = -seq;
      const backup = window.setTimeout(() => fire(id), ms);
      pending.set(id, { fn, backup });
      try {
        w.postMessage({ id, ms });
      } catch {
        // The backstop fires on its own.
      }
      return id;
    },
    clear(id: number): void {
      const p = pending.get(id);
      if (!p) {
        window.clearTimeout(id);
        return;
      }
      pending.delete(id);
      window.clearTimeout(p.backup);
      try {
        worker?.postMessage({ id, ms: -1 });
      } catch {
        // Gone already.
      }
    },
  };
})();

function browserPollEnv(): PollEnv {
  return {
    doc: document,
    win: {
      setTimeout: (fn, ms) => hiddenTimer.set(fn, ms),
      clearTimeout: id => hiddenTimer.clear(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    },
    now: () => Date.now(),
    onAuth,
  };
}

export interface PollSnapshot<T> {
  data: T | null;
  error: unknown;
  /** When the last good read landed (browser ms). */
  okAt: number | null;
  failures: number;
  /** The poll stopped: the room is final, or the server refused this seat. */
  stopped: boolean;
  /** Server clock minus browser clock, from the last read that said. */
  offset: number;
  /** When the read on its way left (browser ms), or null between reads. */
  busySince?: number | null;
}

/** A read slower than this round trip says too little about the server's clock. */
export const CLOCK_MAX_RTT_MS = 2000;

export interface PollOptions<T> {
  fetcher: () => Promise<T>;
  delay: (data: T | null, failures: number, error: unknown) => number;
  merge: (prev: T | null, next: T, afterSet: boolean) => T;
  seed?: T | null;
  /**
   * Keep reading while the tab is hidden. Both live feeds do: a closer in
   * Zoom and a setter in Meet have the cockpit's tab in the background,
   * and that is exactly when an offer or a knock arrives.
   */
  whileHidden?: boolean;
  /** The server's clock in an answer, for the offset. */
  serverNow?: (data: T) => string | null | undefined;
  /** The offset to start from (the page's live read already knows it). */
  seedOffset?: number;
  onChange: (s: PollSnapshot<T>) => void;
  env?: PollEnv;
}

export interface Poller<T> {
  /** Read now (or as soon as the read on its way lands). */
  kick: () => void;
  /** Put a press's answer on screen now; a read already on its way merges as older. */
  set: (fn: (prev: T | null) => T | null) => void;
  stop: () => void;
  snapshot: () => PollSnapshot<T>;
}

/**
 * Read, then read again after `delay` (0 stops). One read at a time; one
 * at once when the tab comes back or the connection returns. The last good
 * answer stays through a failure. Every read is numbered against the
 * presses: a read that left before a press merges as the older copy.
 */
export function startPoll<T>(o: PollOptions<T>): Poller<T> {
  const env = o.env ?? browserPollEnv();
  let alive = true;
  let timer = 0;
  let busy = false;
  let again = false;
  let sets = 0;
  // Why reading stopped: a sign-in that ran out is read again as soon as
  // the session comes back (focus, the network, a refreshed token).
  let stoppedFor: ApiFailure | null = null;
  let snap: PollSnapshot<T> = {
    data: o.seed ?? null,
    error: null,
    okAt: null,
    failures: 0,
    stopped: false,
    offset:
      typeof o.seedOffset === "number" && Number.isFinite(o.seedOffset)
        ? o.seedOffset
        : 0,
    busySince: null,
  };
  const emit = (next: Partial<PollSnapshot<T>>) => {
    snap = { ...snap, ...next };
    o.onChange(snap);
  };

  const schedule = (ms: number) => {
    env.win.clearTimeout(timer);
    snap = { ...snap, stopped: ms <= 0 };
    if (ms > 0) timer = env.win.setTimeout(() => void run(), ms);
  };

  async function run(): Promise<void> {
    if (!alive) return;
    if (busy) {
      again = true;
      return;
    }
    if (!o.whileHidden && env.doc.visibilityState === "hidden") return;
    busy = true;
    const setsAtStart = sets;
    const sentAt = env.now();
    emit({ busySince: sentAt });
    let err: unknown = null;
    try {
      const next = await o.fetcher();
      if (!alive) return;
      const gotAt = env.now();
      const merged = o.merge(snap.data, next, sets !== setsAtStart);
      // A slow trip says little about the server's clock: only a quick one moves it.
      const off =
        gotAt - sentAt <= CLOCK_MAX_RTT_MS
          ? clockOffset(o.serverNow?.(next), sentAt, gotAt)
          : null;
      emit({
        data: merged,
        error: null,
        okAt: gotAt,
        failures: 0,
        offset: off ?? snap.offset,
        busySince: null,
      });
    } catch (e) {
      if (!alive) return;
      err = e;
      emit({ error: e, failures: snap.failures + 1, busySince: null });
    } finally {
      busy = false;
    }
    if (!alive) return;
    if (again) {
      again = false;
      schedule(1);
      return;
    }
    schedule(o.delay(snap.data, snap.failures, err));
    stoppedFor = snap.stopped ? failureOf(err).kind : null;
    if (snap.stopped) emit({});
  }

  /** Read again: always while reading, and after a stop only for a lapsed sign-in. */
  const wake = () => {
    if (!alive || busy) return;
    if (!snap.stopped || stoppedFor === "signin") schedule(1);
  };
  const onVisible = () => {
    if (env.doc.visibilityState === "visible") wake();
  };
  // Back online after a drop: read now rather than wait out the backoff.
  const onOnline = () => wake();
  env.doc.addEventListener("visibilitychange", onVisible);
  env.win.addEventListener("online", onOnline);
  const offAuth = env.onAuth?.(() => {
    if (snap.stopped && stoppedFor === "signin") schedule(1);
  });
  void run();

  return {
    kick: () => {
      if (!alive) return;
      if (busy) again = true;
      else schedule(1);
    },
    set: fn => {
      sets += 1;
      emit({ data: fn(snap.data) });
    },
    stop: () => {
      alive = false;
      env.win.clearTimeout(timer);
      env.doc.removeEventListener("visibilitychange", onVisible);
      env.win.removeEventListener("online", onOnline);
      offAuth?.();
    },
    snapshot: () => snap,
  };
}

export interface Poll<T> {
  data: T | null;
  error: string | null;
  errorKind: ApiFailure | null;
  errorStatus: number | null;
  /** When the last good read landed (ms). */
  okAt: number | null;
  failures: number;
  /** Reading stopped (final, refused or signed out); `error` says why if it failed. */
  stopped: boolean;
  /** Server clock minus browser clock (ms); add it to Date.now() for countdowns. */
  offset: number;
  /** When the read on its way left, or null between reads. */
  busySince: number | null;
  reload: () => void;
  /** Put a press's answer on screen now, through the same merge as a read. */
  set: (fn: (prev: T | null) => T | null) => void;
}

interface PollState<T> extends PollSnapshot<T> {
  key: string | null;
}

/** startPoll as a hook, restarted whenever `key` changes; null reads nothing. */
function usePoll<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  delay: (data: T | null, failures: number, error: unknown) => number,
  merge: (prev: T | null, next: T, afterSet: boolean) => T,
  seed: T | null = null,
  extra: Pick<PollOptions<T>, "whileHidden" | "serverNow" | "seedOffset"> = {},
): Poll<T> {
  const [st, setSt] = useState<PollState<T>>({
    key,
    data: seed,
    error: null,
    okAt: null,
    failures: 0,
    stopped: false,
    offset: 0,
  });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const delayRef = useRef(delay);
  delayRef.current = delay;
  const mergeRef = useRef(merge);
  mergeRef.current = merge;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const pollRef = useRef<Poller<T> | null>(null);

  useEffect(() => {
    if (!key) return;
    const poller = startPoll<T>({
      fetcher: () => fetchRef.current(),
      delay: (d, f, e) => delayRef.current(d, f, e),
      merge: (p, n, a) => mergeRef.current(p, n, a),
      seed: seedRef.current,
      whileHidden: extraRef.current.whileHidden,
      serverNow: extraRef.current.serverNow,
      seedOffset: extraRef.current.seedOffset,
      onChange: s => setSt({ ...s, key }),
    });
    pollRef.current = poller;
    setSt({ ...poller.snapshot(), key });
    return () => {
      poller.stop();
      if (pollRef.current === poller) pollRef.current = null;
    };
  }, [key]);

  const reload = useCallback(() => pollRef.current?.kick(), []);
  const set = useCallback(
    (fn: (prev: T | null) => T | null) => pollRef.current?.set(fn),
    [],
  );

  const mine = st.key === key;
  const { kind, status } = failureOf(mine ? st.error : null);
  return {
    data: mine ? st.data : seed,
    error: mine && st.error ? errorText(st.error) : null,
    errorKind: kind,
    errorStatus: status,
    okAt: mine ? st.okAt : null,
    failures: mine ? st.failures : 0,
    stopped: mine ? st.stopped : false,
    offset: mine ? st.offset : (extra.seedOffset ?? 0),
    busySince: mine ? (st.busySince ?? null) : null,
    reload,
    set,
  };
}

/** How old the strip's last good read may be before it says so. */
export const STALE_MS = 20_000;

/**
 * Whether what shows may be out of date, and since when: two failed reads
 * in a row, or a last good read older than 20 s. `since` is null when no
 * read has landed at all.
 */
export function readIsOld(
  poll: Pick<Poll<unknown>, "error" | "failures" | "okAt" | "stopped"> & {
    busySince?: number | null;
    errorKind?: ApiFailure | null;
  },
  now: number,
): { since: number | null; kind: ApiFailure | null } | null {
  if (poll.stopped) return null;
  // A read still on its way after 20 s is as good as a failed one: what
  // shows may be old although nothing has said so yet.
  const hung =
    typeof poll.busySince === "number" && now - poll.busySince > STALE_MS;
  if (!poll.error && !hung) return null;
  const old =
    hung ||
    poll.failures >= 2 ||
    (poll.okAt !== null && now - poll.okAt > STALE_MS);
  return old
    ? { since: poll.okAt, kind: poll.error ? (poll.errorKind ?? null) : null }
    : null;
}

export interface LiveFeed extends Poll<LiveStatus> {
  /** live.status refused this seat (switched off, or no seat): show nothing. */
  off: boolean;
  /**
   * The sign-in ran out: the banner says so with a way back in, and keeps
   * the last copy (an open room) on screen under it.
   */
  signedOut: boolean;
}

// ---------------------------------------------------------------------------
// live.status, read once for the whole page
// ---------------------------------------------------------------------------

/** What a page needs to subscribe to one shared read. */
export interface LiveStore {
  /** Listen; the current snapshot is said at once. Returns the way out. */
  join: (fn: (s: PollSnapshot<LiveStatus>) => void) => () => void;
  kick: () => void;
  set: (fn: (prev: LiveStatus | null) => LiveStatus | null) => void;
  snapshot: () => PollSnapshot<LiveStatus> | null;
  /** Whether a read is running (tests). */
  running: () => boolean;
}

/**
 * One live.status read for everyone on the page: the banner, the dialer's
 * room and the lead page's room all listen to the same poll, so a page with
 * three of them still reads every 4 s, not three times as often. The poll
 * starts with the first listener and stops a moment after the last one
 * leaves (a quick remount, as React's strict mode does, keeps it).
 */
export function createLiveStore(o: {
  fetcher: () => Promise<LiveStatus>;
  env?: PollEnv;
  /** How long the poll outlives its last listener (ms). */
  linger?: number;
}): LiveStore {
  const linger = o.linger ?? 1500;
  const subs = new Set<(s: PollSnapshot<LiveStatus>) => void>();
  let poller: Poller<LiveStatus> | null = null;
  let snap: PollSnapshot<LiveStatus> | null = null;
  let stopTimer: number | null = null;
  const env = () => o.env ?? browserPollEnv();
  const say = (next: PollSnapshot<LiveStatus>) => {
    snap = next;
    for (const fn of [...subs]) fn(next);
  };
  const start = () => {
    poller = startPoll<LiveStatus>({
      fetcher: o.fetcher,
      delay: liveDelay,
      merge: mergeLive,
      whileHidden: true,
      serverNow: d => d.now,
      onChange: say,
      env: env(),
    });
  };
  return {
    join(fn) {
      subs.add(fn);
      if (stopTimer !== null) {
        env().win.clearTimeout(stopTimer);
        stopTimer = null;
      }
      if (!poller) start();
      // A read that had stopped (a refusal, a sign-in that lapsed) is
      // tried again for a page that comes to it fresh.
      else if (snap?.stopped) poller.kick();
      const now = poller?.snapshot() ?? snap;
      if (now) fn(now);
      return () => {
        subs.delete(fn);
        if (subs.size || stopTimer !== null) return;
        stopTimer = env().win.setTimeout(() => {
          stopTimer = null;
          if (subs.size) return;
          poller?.stop();
          poller = null;
          snap = null;
        }, linger);
      };
    },
    kick: () => poller?.kick(),
    set: fn => poller?.set(fn),
    snapshot: () => poller?.snapshot() ?? snap,
    running: () => poller !== null,
  };
}

let pageLive: LiveStore | null = null;

/** The page's one live.status store, made on first use. */
function liveStore(): LiveStore {
  if (!pageLive) {
    const store = createLiveStore({ fetcher: () => roomsApi.liveStatus() });
    pageLive = store;
    // A press that made, changed or ended a room tells the strip at once,
    // with the room, so a read already on its way cannot bring it back.
    try {
      window.addEventListener(ROOMS_CHANGED, e => {
        const room = normalizeRoom((e as CustomEvent).detail);
        if (room) store.set(prev => (prev ? withRoom(prev, room) : prev));
        store.kick();
      });
    } catch {
      // No window (tests).
    }
  }
  return pageLive;
}

/**
 * The strip's single poll, shared by every part of the page that needs
 * the seat's presence, offers, open rooms and health.
 */
export function useLiveStatus(enabled: boolean): LiveFeed {
  const [snap, setSnap] = useState<PollSnapshot<LiveStatus> | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSnap(null);
      return;
    }
    return liveStore().join(setSnap);
  }, [enabled]);
  const reload = useCallback(() => liveStore().kick(), []);
  const set = useCallback(
    (fn: (prev: LiveStatus | null) => LiveStatus | null) => liveStore().set(fn),
    [],
  );
  const s = enabled ? snap : null;
  const { kind, status } = failureOf(s?.error ?? null);
  return {
    data: s?.data ?? null,
    error: s?.error ? errorText(s.error) : null,
    errorKind: kind,
    errorStatus: status,
    okAt: s?.okAt ?? null,
    failures: s?.failures ?? 0,
    stopped: s?.stopped ?? false,
    offset: s?.offset ?? 0,
    busySince: s?.busySince ?? null,
    reload,
    set,
    off: kind === "refused",
    signedOut: kind === "signin",
  };
}

/** One room, read until it is final. `seed` is what room.create returned. */
export function useRoomStatus(
  roomId: string | null,
  seed: RoomView | null = null,
): Poll<RoomFeed> {
  const fetcher = useCallback(() => roomsApi.status(String(roomId)), [roomId]);
  return usePoll<RoomFeed>(
    roomId,
    fetcher,
    roomDelay,
    mergeRoomFeed,
    seed && seed.id === roomId
      ? { room: seed, events: [], health: null }
      : null,
    {
      whileHidden: true,
      serverNow: d => d.now,
      // The page's live read already knows the server's clock: the panel's
      // countdown starts on it, not on the browser's own, so the banner and
      // the panel never show two different times left.
      seedOffset: pageLive?.snapshot()?.offset ?? 0,
    },
  );
}

// ---------------------------------------------------------------------------
// Calling a rep back to a hidden tab: the title, a short sound, and a
// notification when the browser allows one
// ---------------------------------------------------------------------------

export interface AlertEnv {
  doc: {
    visibilityState: string;
    title: string;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  } | null;
  chime?: () => void;
  notify?: (text: string, tag: string) => void;
}

let audio: AudioContext | null = null;

function chime(): void {
  const Ctx =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  audio ??= new Ctx();
  const a = audio;
  void a.resume?.();
  const at = a.currentTime;
  for (const [i, hz] of [880, 1320].entries()) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, at + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.08, at + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.16 + 0.15);
    osc.connect(gain).connect(a.destination);
    osc.start(at + i * 0.16);
    osc.stop(at + i * 0.16 + 0.16);
  }
}

function notify(text: string, tag: string): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const n = new Notification("Mahara sales", { body: text, tag });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

function browserAlertEnv(): AlertEnv {
  return {
    doc: typeof document === "undefined" ? null : document,
    chime,
    notify,
  };
}

/**
 * Called from a press (a user gesture): ask once for notifications, and
 * wake the sound, which a browser keeps silent until a person has pressed
 * something on the page.
 */
export function primeAlerts(): void {
  try {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    )
      void Notification.requestPermission().catch(() => undefined);
  } catch {
    // An old browser with the callback form only: the title still works.
  }
  try {
    const Ctx = globalThis.AudioContext;
    if (Ctx) {
      audio ??= new Ctx();
      void audio.resume?.();
    }
  } catch {
    // No sound here; the title and the notification still work.
  }
}

const alerted = new Set<string>();
let baseTitle: string | null = null;
let watching: (() => void) | null = null;

/**
 * Say `text` to a rep whose cockpit tab is hidden, once per `key`: in the
 * tab's title (put back when the tab shows), with a short sound, and as a
 * notification when allowed. A visible tab is already saying it, so this
 * does nothing there. True when it alerted.
 */
export function alertWhileHidden(
  key: string,
  text: string,
  env: AlertEnv = browserAlertEnv(),
): boolean {
  const doc = env.doc;
  if (doc?.visibilityState !== "hidden" || alerted.has(key)) return false;
  alerted.add(key);
  if (alerted.size > 200) {
    const oldest = alerted.values().next().value;
    if (oldest !== undefined) alerted.delete(oldest);
  }
  if (baseTitle === null) baseTitle = doc.title;
  doc.title = `${text} · ${baseTitle}`;
  if (!watching) {
    const back = () => {
      if (doc.visibilityState !== "visible") return;
      if (baseTitle !== null) doc.title = baseTitle;
      baseTitle = null;
      doc.removeEventListener("visibilitychange", back);
      watching = null;
    };
    watching = back;
    doc.addEventListener("visibilitychange", back);
  }
  try {
    env.chime?.();
  } catch {
    // Sound is a nicety; the title already says it.
  }
  try {
    env.notify?.(text, key);
  } catch {
    // Notifications refused or unsupported; the title already says it.
  }
  return true;
}

/** Forget what was alerted and put the title back (tests). */
export function resetAlerts(): void {
  alerted.clear();
  baseTitle = null;
  watching = null;
}

// ---------------------------------------------------------------------------
// Focus: a press that removes its own button leaves the keyboard where it was
// ---------------------------------------------------------------------------

/**
 * When the button that had focus goes (a press swaps it for the Undo strip,
 * the end question, or the next step), focus moves to the element marked
 * `data-autofocus` (Undo, "Keep it"), else back to the button pressed if it
 * is there again (`data-key`), else to the first button. Only when focus
 * was inside `ref` and has fallen to the page; a click elsewhere lets go.
 */
export function useFocusRescue(
  ref: { current: HTMLElement | null },
  shape: string,
): void {
  const had = useRef(false);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onIn = (e: FocusEvent) => {
      had.current = true;
      const k = (e.target as HTMLElement | null)?.dataset?.key;
      if (k) lastKey.current = k;
    };
    const onOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !el.contains(to)) had.current = false;
    };
    const onDown = (e: Event) => {
      if (!el.contains(e.target as Node)) had.current = false;
    };
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [ref]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the buttons change shape
  useEffect(() => {
    const el = ref.current;
    if (!el || !had.current) return;
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== document.documentElement
    )
      return;
    const pick = (sel: string) =>
      el.querySelector<HTMLElement>(`${sel}:not([disabled])`);
    // While a press is on its way every action waits disabled: focus waits
    // with them (the next shape, enabled again, places it) rather than
    // landing on something unrelated such as the timeline.
    const target =
      pick("[data-autofocus]") ??
      (lastKey.current ? pick(`[data-key="${lastKey.current}"]`) : null) ??
      pick("[data-key]") ??
      (el.querySelector("[data-key]") ? null : pick("button"));
    target?.focus();
  }, [shape]);
}

/**
 * A press held for five seconds behind an Undo, as marks are
 * (MarkControls). Leaving the page inside the window still sends it,
 * because the rep meant it.
 */
export function useUndo<K>(send: (k: K) => void, ms: number = UNDO_MS) {
  const [pending, setPending] = useState<K | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const held = useRef<{ k: K } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const start = useCallback(
    (k: K) => {
      if (timer.current) window.clearTimeout(timer.current);
      held.current = { k };
      setPending(k);
      setStartedAt(Date.now());
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const h = held.current;
        held.current = null;
        setPending(null);
        setStartedAt(null);
        if (h) sendRef.current(h.k);
      }, ms);
    },
    [ms],
  );

  const undo = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    held.current = null;
    setPending(null);
    setStartedAt(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      const h = held.current;
      held.current = null;
      if (h) sendRef.current(h.k);
    },
    [],
  );

  return { pending, start, undo, startedAt, ms };
}

/** Whole seconds left on a wait that started at `startedAt` and lasts `ms`; never below 0. */
export function secondsLeft(
  startedAt: number,
  ms: number,
  now: number,
): number {
  return Math.max(0, Math.ceil((startedAt + ms - now) / 1000));
}

// ---------------------------------------------------------------------------
// Which rooms a panel shows: the banner gives way to a panel on screen
// ---------------------------------------------------------------------------

const onScreen = new Map<string, number>();
const screenListeners = new Set<() => void>();
let screenVersion = 0;

function screenChanged() {
  screenVersion += 1;
  for (const f of [...screenListeners]) f();
}

/**
 * A room panel says its room is on screen while it is mounted, so the
 * banner above draws that room's button quietly (the panel holds the
 * primary) and drops "Open the lead" (the lead is right there).
 */
export function useRoomOnScreen(roomId: string | null): void {
  useEffect(() => {
    if (!roomId) return;
    onScreen.set(roomId, (onScreen.get(roomId) ?? 0) + 1);
    screenChanged();
    return () => {
      const n = (onScreen.get(roomId) ?? 1) - 1;
      if (n > 0) onScreen.set(roomId, n);
      else onScreen.delete(roomId);
      screenChanged();
    };
  }, [roomId]);
}

/** Whether a panel on this page shows the room. */
export function useRoomShown(roomId: string | null): boolean {
  useSyncExternalStore(subscribeScreen, screenSnapshot, serverSnapshot);
  return roomId !== null && onScreen.has(roomId);
}

function subscribeScreen(fn: () => void): () => void {
  screenListeners.add(fn);
  return () => {
    screenListeners.delete(fn);
  };
}

function screenSnapshot(): number {
  return screenVersion;
}

function serverSnapshot(): number {
  return 0;
}
