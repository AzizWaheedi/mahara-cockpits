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
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ApiError, type ApiFailure, uncertain } from "./apiErrors";
import { clock, KUWAIT } from "./format";

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
  | "undone";
export type RoomResult =
  | "joined"
  | "no_join"
  | "moved_to_phone"
  | "cancelled"
  | "failed"
  | "admit_blocked";

/**
 * Where the link went. The contract types this as `string[]`; these are the
 * values the screens read. `template_unconfirmed` is a WhatsApp template
 * HighLevel took but that never showed in the conversation within 20 s,
 * after which email went too.
 */
export type LinkChannel =
  | "whatsapp"
  | "template"
  | "template_unconfirmed"
  | "email";

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
  open_device: string | null;
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
  created_at: string;
}

export interface RoomEvent {
  at: string;
  kind: string;
  source: string;
  text: string;
}

export interface Health {
  worker_ok: boolean;
  last_run_at: string | null;
  rooms_today: number;
  failed_today: number;
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
  /**
   * Not in the contract yet: why the seat is Away. With `booked_call` and
   * `booked_at`, the strip says the booked-call line; without them it says
   * "Away".
   */
  reason?: string | null;
  booked_at?: string | null;
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
  health: Health;
}

/** `room.status`; health is null only on a room seeded before its first read. */
export interface RoomFeed {
  room: RoomView;
  events: RoomEvent[];
  health: Health | null;
}

export type MarkWhat = "host_in" | "lead_in" | "not_lead";
export type EndReason = "end" | "on_phone" | "finished" | "cancel";

// ---------------------------------------------------------------------------
// Waits and small helpers
// ---------------------------------------------------------------------------

/** The waits the screens read (`rooms.waits_s`, `live.closer_wait_s`). */
export const WAITS_S = {
  manual_buttons: 30,
  not_lead_undo: 300,
  standby_max: 2100,
  offer: 120,
} as const;

/** A press with an Undo waits this long before it is sent (MarkControls). */
export const UNDO_MS = 5000;

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

/** The link as it is read out: "call.maharamedia.com/K7Q2MX". */
export function readOut(room: RoomView): string {
  const url = shortLink(room);
  if (!url) return room.code;
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

const CHANNEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  template: "WhatsApp",
  email: "email",
};

/** "WhatsApp", "email", "WhatsApp and email", or null when none is known. */
export function channelWords(channels: readonly string[]): string | null {
  const names: string[] = [];
  for (const c of channels) {
    const n = CHANNEL[c];
    if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

const KEEP_CAPS = new Set([
  "I",
  "Zoom",
  "Meet",
  "Google",
  "Slack",
  "Mahara",
  "Maqsam",
  "Gmail",
]);

/**
 * A server sentence set after a colon: no closing full stop, and a lower
 * first letter unless the first word is a name ("Zoom", "WhatsApp").
 */
export function reasonWords(text: string | null | undefined): string {
  const s = String(text ?? "")
    .trim()
    .replace(/[.!]+$/, "");
  const word = s.split(/\s/, 1)[0] ?? "";
  if (/^[A-Z][a-z]+$/.test(word) && !KEEP_CAPS.has(word))
    return s.charAt(0).toLowerCase() + s.slice(1);
  return s;
}

// ---------------------------------------------------------------------------
// Sentences: words, plus times and codes set in Geist Mono
// ---------------------------------------------------------------------------

/**
 * One piece of a sentence. A string is words; `mono` is a time or a code;
 * `left` is a countdown, drawn "(9:12 left)" or "1:47 left." and left out
 * of what a screen reader hears, so it is not read out every second.
 */
export type Part =
  | string
  | { mono: string }
  | { left: number; form: "paren" | "sentence" };
export type Sentence = Part[];

/** The sentence as text; `speak` drops the countdowns. */
export function sentenceText(s: Sentence, speak = false): string {
  const out = s
    .map(p => {
      if (typeof p === "string") return p;
      if ("mono" in p) return p.mono;
      if (speak) return "";
      return p.form === "paren"
        ? `(${mmss(p.left)} left)`
        : `${mmss(p.left)} left.`;
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
  | "failed"
  | "ready"
  | "standby_open"
  | "standby_in"
  | "sent"
  | "not_sent"
  | "not_confirmed"
  | "opened"
  | "waiting_room"
  | "host_in"
  | "joined"
  | "still_on_call"
  | "expired"
  | "closed";

function isStandby(room: RoomView): boolean {
  return room.purpose === "standby" && !room.contact_id;
}

export function roomMoment(room: RoomView, now: number): RoomMoment {
  const s = room.state;
  if (isMaking(s)) return "making";
  if (s === "failed") return "failed";
  if (isStandby(room)) {
    if (isFinal(s)) return "closed";
    return s === "open" ? "standby_open" : "standby_in";
  }
  if (s === "expired") return "expired";
  if (s === "ended" || s === "cancelled")
    return room.result === "no_join" ? "expired" : "closed";
  if (s === "lead_in") {
    const end = t(room.ends_at);
    return end !== null && now >= end ? "still_on_call" : "joined";
  }
  // open or host_in
  if (room.lead_waiting_at) return "waiting_room";
  if (!room.link_sent_at && room.refusal) return "not_sent";
  if (s === "host_in") return "host_in";
  if (room.first_open_at) return "opened";
  if (room.link_channels.includes("template_unconfirmed"))
    return "not_confirmed";
  if (room.link_sent_at) return "sent";
  return "ready";
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

/** When the room closes if nothing happens: the lead's or the host's deadline. */
export function roomDeadline(room: RoomView): number | null {
  if (room.state === "open") {
    const lead = t(room.lead_by);
    const host = t(room.host_by);
    if (lead !== null && host !== null) return Math.min(lead, host);
    return lead ?? host;
  }
  if (room.state === "host_in") return t(room.lead_by);
  return null;
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

/** "That was not the lead" is allowed for 5 minutes after the join. */
export function canSayNotLead(room: RoomView, now: number): boolean {
  if (room.state !== "lead_in") return false;
  const at = t(room.lead_in_at);
  return at !== null && now - at <= WAITS_S.not_lead_undo * 1000;
}

/** Sentences the server sends whole; they are shown as they are. */
const WHOLE_SENTENCES = new Set([
  "Your Zoom is in another meeting. End it or use Meet.",
  "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.",
  "Connect your Google calendar on the Team page first.",
  "Google did not make the Meet link. Try Zoom.",
  "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
]);

export function failedSentence(room: RoomView): Sentence {
  const P = providerName(room.provider);
  const O = providerName(otherProvider(room.provider));
  const err = String(room.error ?? "").trim();
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
      if (v === "p1" && room.call_kind === "intro")
        return [`${name} joined. Booked as a live intro and marked shown.`];
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
      return [head, at, ". Not in HighLevel: book and mark it by hand."];
    default:
      return [head, at, "."];
  }
}

/** P1's lead page line: "Video room on Meet: sent 14:03, opened 14:05, joined 14:06." */
export function summarySentence(room: RoomView): Sentence {
  const parts: Sentence = [];
  const add = (word: string, iso: string | null) => {
    if (!iso) return;
    if (parts.length) parts.push(", ");
    parts.push(`${word} `, { mono: clock(iso) });
  };
  add("sent", room.link_sent_at);
  add("opened", room.first_open_at);
  add("joined", room.lead_in_at);
  const head = `Video room on ${providerName(room.provider)}: `;
  // Ours: a room that closed before anything happened.
  if (!parts.length)
    return [
      head,
      "closed at ",
      { mono: clock(room.ended_at ?? room.created_at) },
      ".",
    ];
  return [head, ...parts, "."];
}

export interface RoomCtx {
  now: number;
  /** The rep can mark the booked intro this room was for (P1's expiry). */
  canMarkIntro?: boolean;
  /** The seat's Available-until, for a standby room. */
  until?: string | null;
}

/** The status sentence under the room line. */
export function roomSentence(room: RoomView, ctx: RoomCtx): Sentence {
  const m = roomMoment(room, ctx.now);
  const v = voiceOf(room);
  const name = first(room) ?? "";
  const P = providerName(room.provider);
  const left = roomLeft(room, ctx.now);
  switch (m) {
    case "making":
      return [`Making your ${P} room...`];
    case "failed":
      return failedSentence(room);
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
      // Ours: a link went but the server did not say where.
      if (!ch) return ["Link sent at ", at, "."];
      if (v === "p1" && left !== null)
        return [
          `Link sent on ${ch} at `,
          at,
          `. Waiting for ${name} `,
          { left, form: "paren" },
          ".",
        ];
      return [`Link sent on ${ch} at `, at, "."];
    }
    case "not_confirmed":
      return v === "p1"
        ? [
            "HighLevel did not confirm the WhatsApp template. The link went by email.",
          ]
        : ["Not confirmed on WhatsApp. Sent by email too."];
    case "not_sent":
      return [
        `Not sent: ${reasonWords(room.refusal)}. Read it out: `,
        { mono: readOut(room) },
      ];
    case "opened": {
      const at = { mono: clock(room.first_open_at) };
      if (v === "p1") return [`${name} opened the link at `, at, ". Join now."];
      const dev = deviceWords(room.open_device);
      return ["The lead opened the link at ", at, dev ? ` on a ${dev}.` : "."];
    }
    case "waiting_room":
      if (v === "p1")
        return [`${name} is in the waiting room. Admit them in Zoom.`];
      if (v === "p2")
        return [`${name} is in your waiting room. Admit them in Zoom.`];
      return ["The lead is in the waiting room. Admit them in Zoom."];
    case "host_in": {
      const who = v === "p1" ? name : "the lead";
      return left !== null
        ? ["You are in. Waiting for ", who, " ", { left, form: "paren" }, "."]
        : [`You are in. Waiting for ${who}.`];
    }
    case "joined":
      return joinedSentence(room, v);
    case "still_on_call":
      return ["Still on the call?"];
    case "expired":
      return ctx.canMarkIntro
        ? ["Nobody joined in 10 minutes. The room is closed. Mark the intro:"]
        : [
            "The lead did not join in 10 minutes. Room closed. Call again or send a message.",
          ];
    case "closed":
      return summarySentence(room);
  }
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
  return ["Zoom has not told us yet. Press when it happens."];
}

export type Tone = "now" | "good" | "owed" | "bad" | "quiet";

/** The colour of the dot beside the sentence (the words stay in ink). */
export function roomTone(m: RoomMoment): Tone {
  switch (m) {
    case "joined":
    case "still_on_call":
      return "good";
    case "not_sent":
    case "not_confirmed":
    case "expired":
      return "owed";
    case "failed":
      return "bad";
    case "closed":
      return "quiet";
    default:
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

/** The room line: Link sent, Opened, You're in, Lead in. */
export function roomSteps(room: RoomView): Step[] {
  const s = room.state;
  const final = isFinal(s);
  const readOutOnly = !room.link_sent_at && Boolean(room.refusal);
  const steps: Step[] = [
    {
      key: "sent",
      label: "Link sent",
      at: room.link_sent_at,
      done: Boolean(room.link_sent_at),
      current: false,
      note: readOutOnly ? "read out" : null,
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
  if (!final && !isStandby(room)) {
    const next = steps.find(
      st => !st.done && !(st.key === "sent" && readOutOnly),
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
  | "retry"
  | "noshow"
  | "showed";

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
  const m = roomMoment(room, ctx.now);
  const hasLead = Boolean(room.contact_id);
  const booked = room.purpose === "booked";
  switch (m) {
    case "making":
      return { primary: null, quiet: booked ? [] : [act("end", "End room")] };
    case "failed":
      return {
        primary:
          hasLead && !booked
            ? act("retry", `Try ${providerName(otherProvider(room.provider))}`)
            : null,
        quiet: [],
      };
    case "expired":
      return {
        primary: null,
        quiet: ctx.canMarkIntro
          ? [act("noshow", "No-show"), act("showed", "We spoke on the phone")]
          : [],
      };
    case "closed":
    case "standby_in":
      return { primary: null, quiet: [] };
    case "standby_open":
      return { primary: act("open", "Open my room"), quiet: [] };
    case "joined":
    case "still_on_call": {
      const quiet: RoomAction[] = [];
      if (canSayNotLead(room, ctx.now))
        quiet.push(act("not_lead", "That was not the lead"));
      if (m === "still_on_call")
        return { primary: act("finished", "Finished"), quiet };
      quiet.push(act("finished", "Finished"));
      return { primary: null, quiet };
    }
  }
  // open or host_in, with a lead
  const meet = room.provider === "meet";
  const hostIn = room.state === "host_in";
  const quiet: RoomAction[] = [];
  const primary = hostIn
    ? act("lead_in", "The lead is in")
    : act("open", "Open my room");
  // Only someone in the room can let the lead in, so "The lead is in"
  // waits for "I'm in" (or Zoom's own word that the host joined).
  if (hostIn) quiet.push(act("open", "Open my room"));
  else if (meet) quiet.push(act("host_in", "I'm in the room"));
  else if (manualButtons(room, ctx.now)) quiet.push(act("host_in", "I'm in"));
  if (shortLink(room)) quiet.push(act("copy", "Copy link"));
  if (hasLead && !booked && !room.link_channels.includes("email"))
    quiet.push(act("email", "Also send by email"));
  if (room.purpose === "fallback" || room.purpose === "manual")
    quiet.push(act("on_phone", "We are on the phone"));
  if (!booked) quiet.push(act("end", "End room"));
  return { primary, quiet };
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
    default:
      return "Sending";
  }
}

/** Presses that wait 5 seconds behind an Undo before they are sent. */
export function needsUndo(key: RoomActionKey): boolean {
  return (
    key === "lead_in" ||
    key === "not_lead" ||
    key === "noshow" ||
    key === "showed"
  );
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

/** "Video room: Faisal, 7:40 left.", then "Faisal opened the link." */
export function bannerRoomSentence(room: RoomView, now: number): Sentence {
  const m = roomMoment(room, now);
  const name = first(room);
  const Name = name ?? "The lead";
  if (m === "making")
    return [`Making your ${providerName(room.provider)} room...`];
  if (m === "waiting_room" || m === "not_sent")
    return roomSentence(room, { now });
  if (m === "joined" || m === "still_on_call") return [`${Name} joined.`];
  if (room.first_open_at) return [`${Name} opened the link.`];
  const left = roomLeft(room, now);
  const head: Sentence = name
    ? [`Video room: ${name}`]
    : ["Video room: ", { mono: room.code }];
  return left === null
    ? [...head, "."]
    : [...head, ", ", { left, form: "sentence" }];
}

/** Get in while the room waits for its host; after that, go to the lead. */
export function bannerRoomAction(room: RoomView): {
  key: "open_room" | "open_lead";
  label: string;
} {
  return room.state === "open" && room.contact_id
    ? { key: "open_room", label: "Open my room" }
    : { key: "open_lead", label: "Open" };
}

const ROOM_URGENCY: Partial<Record<RoomMoment, number>> = {
  waiting_room: 0,
  joined: 1,
  still_on_call: 1,
  opened: 2,
  host_in: 3,
};

/** The room the banner shows: the seat's own live room with a lead in it. */
export function myRoom(
  rooms: readonly RoomView[],
  now: number,
): RoomView | null {
  const live = rooms.filter(r => !isFinal(r.state) && !isStandby(r));
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
  | "away"
  | "available"
  | "ready"
  | "on_call";

export type StripActionKey =
  | "available"
  | "away"
  | "join"
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

/** "Live lead: demo, Saudi Arabia, on the line with the setter. Note: {note}. 1:47 left." */
export function offerSentence(o: Offer, now: number): Sentence {
  const bits = [o.kind, o.country, OFFER_REASON[o.reason]]
    .map(x => String(x ?? "").trim())
    .filter(Boolean);
  const out: Sentence = [`Live lead: ${bits.join(", ")}.`];
  const note = String(o.note ?? "").trim();
  if (note) out.push(` Note: ${note}${/[.!?]$/.test(note) ? "" : "."}`);
  out.push(" ", { left: offerLeft(o, now), form: "sentence" });
  return out;
}

/**
 * An offer that was on the strip and is gone: missed when the seat is now
 * Away (one miss sets Away), else closed by someone else or the setter.
 * Offers this seat answered are not news.
 */
export function offerGone(
  prev: readonly Offer[],
  next: readonly Offer[],
  me: Presence,
  answered: ReadonlySet<string>,
  now: number,
): StripFlash | null {
  for (const o of prev) {
    if (answered.has(o.id) || next.some(n => n.id === o.id)) continue;
    if (me.state === "away") {
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
  /** Offers declined here, hidden until the server drops them. */
  hidden?: readonly string[];
  /** Standby rooms the rep chose to keep. */
  kept?: readonly string[];
}

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
  });
  const f = i.flash;
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

  const hidden = new Set(i.hidden ?? []);
  const offer =
    [...i.offers]
      .filter(o => !hidden.has(o.id))
      .sort((a, b) => (t(a.offer_until) ?? 0) - (t(b.offer_until) ?? 0))[0] ??
    null;
  if (offer)
    return line(
      "offer",
      offerSentence(offer, i.now),
      A("take", "Take it"),
      [A("decline", "Not now")],
      "now",
      offer,
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
        [A("away", "Go away")],
      );
    case "available": {
      const open =
        standby !== null &&
        (standby.state === "open" || standby.state === "host_in");
      if (!open && i.health && !i.health.worker_ok)
        return line(
          "down",
          [healthSentence(i.health)],
          null,
          [A("away", "Go away")],
          "bad",
        );
      return line(
        "available",
        until
          ? ["Available until ", until, ". Join your room to get leads first."]
          : ["Available. Join your room to get leads first."],
        A("join", "Join my room", !open),
      );
    }
    default:
      if (i.me.reason === "booked_call" && i.me.booked_at)
        return line(
          "booked_call",
          [
            "Your booked demo starts at ",
            { mono: clock(i.me.booked_at) },
            ", so your room is closed. Press I'm available after it.",
          ],
          null,
          [A("available", "I'm available")],
          "quiet",
        );
      return line(
        "away",
        ["Away"],
        A("available", "I'm available"),
        [],
        "quiet",
      );
  }
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

// ---------------------------------------------------------------------------
// The health line
// ---------------------------------------------------------------------------

export function healthTone(h: Health): "good" | "owed" | "bad" {
  if (!h.worker_ok) return "bad";
  if (/disagree/i.test(h.line ?? "")) return "owed";
  return "good";
}

/** The server's sentence; the foundation's wording when it sent none. */
export function healthSentence(h: Health): string {
  const line = String(h.line ?? "").trim();
  if (line) return line;
  if (h.worker_ok)
    return `Rooms: working. Last run ${clockSec(h.last_run_at)}. ${h.rooms_today} rooms today, ${h.failed_today} failed.`;
  if (!h.last_run_at)
    // Ours: the worker has never written its row.
    return "Rooms are down. The room worker has not run yet. New rooms cannot be made.";
  return `Rooms are down. The room worker last ran at ${clock(h.last_run_at)}. New rooms cannot be made.`;
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

export function mergeRoomFeed(prev: RoomFeed | null, next: RoomFeed): RoomFeed {
  if (!prev || prev.room.id !== next.room.id) return next;
  const room = newer(prev.room, next.room);
  return room === next.room ? next : { ...next, room };
}

export function mergeLive(
  prev: LiveStatus | null,
  next: LiveStatus,
): LiveStatus {
  if (!prev) return next;
  const old = new Map(prev.rooms.map(r => [r.id, r]));
  return { ...next, rooms: next.rooms.map(r => newer(old.get(r.id), r)) };
}

/** A room a press returned, put into the strip's list (or taken out when final). */
export function withRoom(live: LiveStatus, room: RoomView): LiveStatus {
  const have = live.rooms.find(r => r.id === room.id);
  const next = newer(have, room);
  const rest = live.rooms.filter(r => r.id !== room.id);
  return { ...live, rooms: isFinal(next.state) ? rest : [next, ...rest] };
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

/** Forget every held request id (tests). */
export function forgetRequests(): void {
  intents.clear();
  inflight.clear();
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
}

type Versioned = Pick<RoomView, "id" | "version">;

/** A new room for this seat: the strip reads now instead of at its next poll. */
function nudge<T>(p: Promise<T>): Promise<T> {
  return p.then(out => {
    roomsChanged();
    return out;
  });
}

export const roomsApi = {
  create: (input: CreateRoom) =>
    nudge(
      once(
        `room.create:${input.contact_id ?? "standby"}:${input.purpose}:${input.provider}`,
        request_id =>
          api<{ room: RoomView }>("room.create", { ...input, request_id }),
      ),
    ),
  status: (roomId: string) =>
    api<RoomFeed & { health: Health }>("room.status", { room_id: roomId }),
  open: (roomId: string) =>
    api<{ start_url: string }>("room.open", { room_id: roomId }),
  mark: (room: Versioned, what: MarkWhat) =>
    api<{ room: RoomView }>("room.mark", {
      room_id: room.id,
      version: room.version,
      what,
    }),
  end: (room: Versioned, reason: EndReason, confirm = false) =>
    api<{ room: RoomView }>("room.end", {
      room_id: room.id,
      version: room.version,
      reason,
      ...(confirm ? { confirm: true } : {}),
    }),
  sendEmail: (roomId: string) =>
    once(`room.send:${roomId}:email`, request_id =>
      api<{ room: RoomView }>("room.send", {
        room_id: roomId,
        request_id,
        channel: "email",
      }),
    ),
  wrap: (appointmentId: string) =>
    nudge(
      once(`room.wrap:${appointmentId}`, request_id =>
        api<{ room: RoomView }>("room.wrap", {
          appointment_id: appointmentId,
          request_id,
        }),
      ),
    ),
  availability: (state: "available" | "away") =>
    api<{ me: Presence }>("live.availability", { state }),
  liveStatus: () => api<LiveStatus>("live.status", {}),
  take: (offer: Pick<Offer, "id" | "version">) =>
    nudge(
      once(`live.take:${offer.id}`, request_id =>
        api<{ room?: RoomView }>("live.take", {
          live_id: offer.id,
          version: offer.version,
          request_id,
        }),
      ),
    ),
  decline: (offer: Pick<Offer, "id" | "version">) =>
    api("live.decline", { live_id: offer.id, version: offer.version }),
};

/** A refusal the server sends when a press saw an older room. */
export function isStale(e: unknown): boolean {
  return e instanceof ApiError && /changed a moment ago/i.test(e.message);
}

/** The server asks before it ends a room with the lead still in it. */
export function needsEndConfirm(e: unknown): boolean {
  return e instanceof ApiError && /still in this room/i.test(e.message);
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

/** Tell the strip a room changed, so it reads now instead of in 30 s. */
export function roomsChanged(): void {
  try {
    window.dispatchEvent(new Event(ROOMS_CHANGED));
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

export interface Poll<T> {
  data: T | null;
  error: string | null;
  errorKind: ApiFailure | null;
  errorStatus: number | null;
  /** When the last good read landed (ms). */
  okAt: number | null;
  failures: number;
  reload: () => void;
  /** Put a press's answer on screen now, through the same merge as a read. */
  set: (fn: (prev: T | null) => T | null) => void;
}

interface PollState<T> {
  key: string | null;
  data: T | null;
  error: unknown;
  okAt: number | null;
  failures: number;
}

/**
 * Read, then read again after `delay` (0 stops). One read at a time, none
 * while the tab is hidden, one at once when it comes back. The last good
 * answer stays on screen through a failure.
 */
function usePoll<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  delay: (data: T | null, failures: number, error: unknown) => number,
  merge: (prev: T | null, next: T) => T,
  seed: T | null = null,
): Poll<T> {
  const [st, setSt] = useState<PollState<T>>({
    key,
    data: seed,
    error: null,
    okAt: null,
    failures: 0,
  });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const delayRef = useRef(delay);
  delayRef.current = delay;
  const mergeRef = useRef(merge);
  mergeRef.current = merge;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const dataRef = useRef<T | null>(seed);
  const kickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    let timer = 0;
    let busy = false;
    let again = false;
    let stopped = false;
    let failures = 0;
    dataRef.current = seedRef.current;
    setSt({
      key,
      data: seedRef.current,
      error: null,
      okAt: null,
      failures: 0,
    });

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      stopped = ms <= 0;
      if (!stopped) timer = window.setTimeout(run, ms);
    };

    async function run(): Promise<void> {
      if (!alive) return;
      if (busy) {
        again = true;
        return;
      }
      if (document.visibilityState === "hidden") return;
      busy = true;
      let err: unknown = null;
      try {
        const next = await fetchRef.current();
        if (!alive) return;
        failures = 0;
        const merged = mergeRef.current(dataRef.current, next);
        dataRef.current = merged;
        setSt({ key, data: merged, error: null, okAt: Date.now(), failures });
      } catch (e) {
        if (!alive) return;
        err = e;
        failures += 1;
        const f = failures;
        setSt(s => ({
          ...s,
          key,
          data: dataRef.current,
          error: e,
          failures: f,
        }));
      } finally {
        busy = false;
      }
      if (!alive) return;
      if (again) {
        again = false;
        schedule(1);
        return;
      }
      schedule(delayRef.current(dataRef.current, failures, err));
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) schedule(1);
    };
    // Back online after a drop: read now rather than wait out the backoff.
    const onOnline = () => {
      if (!stopped) schedule(1);
    };
    kickRef.current = () => {
      if (!alive) return;
      if (busy) again = true;
      else schedule(1);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    void run();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      kickRef.current = () => undefined;
    };
  }, [key]);

  const reload = useCallback(() => kickRef.current(), []);
  const set = useCallback((fn: (prev: T | null) => T | null) => {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setSt(s => ({ ...s, data: next }));
  }, []);

  const mine = st.key === key;
  const { kind, status } = failureOf(mine ? st.error : null);
  return {
    data: mine ? st.data : seed,
    error: mine && st.error ? errorText(st.error) : null,
    errorKind: kind,
    errorStatus: status,
    okAt: mine ? st.okAt : null,
    failures: mine ? st.failures : 0,
    reload,
    set,
  };
}

/** How old the strip's last good read may be before it says so. */
export const STALE_MS = 20_000;

export interface LiveFeed extends Poll<LiveStatus> {
  /** live.status refused this seat (switched off, or no seat): show nothing. */
  off: boolean;
}

/** The strip's single poll: presence, offers, open rooms and health. */
export function useLiveStatus(enabled: boolean): LiveFeed {
  const poll = usePoll<LiveStatus>(
    enabled ? "live.status" : null,
    roomsApi.liveStatus,
    liveDelay,
    mergeLive,
  );
  const { reload } = poll;
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(ROOMS_CHANGED, reload);
    return () => window.removeEventListener(ROOMS_CHANGED, reload);
  }, [enabled, reload]);
  return {
    ...poll,
    off: poll.errorKind === "refused" || poll.errorKind === "signin",
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
  );
}

/**
 * A press held for five seconds behind an Undo, as marks are
 * (MarkControls). Leaving the page inside the window still sends it,
 * because the rep meant it.
 */
export function useUndo<K>(send: (k: K) => void, ms: number = UNDO_MS) {
  const [pending, setPending] = useState<K | null>(null);
  const timer = useRef<number | null>(null);
  const held = useRef<{ k: K } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const start = useCallback(
    (k: K) => {
      if (timer.current) window.clearTimeout(timer.current);
      held.current = { k };
      setPending(k);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const h = held.current;
        held.current = null;
        setPending(null);
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

  return { pending, start, undo };
}
