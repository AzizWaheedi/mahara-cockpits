// Zoom's meeting events, as sales-live stores them in
// cockpit_sales_room_events. Pure functions: what to keep, the dedupe key,
// the room code a meeting's topic carries and the timeline line.
//
// The kept event has Zoom's own shape ({event, event_ts, payload: {account_id,
// object: {..., participant}}}) with fewer fields, so sales-api's room.event
// reads it exactly as it would read Zoom's body (roomlogic.ts zoomEffect).

import { stripControl } from "./util.ts";

/** The seven events the foundation subscribes to (glossary C19). */
export const ZOOM_EVENTS = new Set([
  "meeting.started",
  "meeting.ended",
  "meeting.participant_joined",
  "meeting.participant_left",
  "meeting.participant_joined_waiting_room",
  "meeting.participant_jbh_waiting",
  "meeting.participant_jbh_joined",
]);

export const VALIDATION_EVENT = "endpoint.url_validation";

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj =>
  Boolean(x) && typeof x === "object" && !Array.isArray(x);

/** A short, printable string, or undefined. Numbers (Zoom ids) become text. */
function str(x: unknown, max = 200): string | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  if (typeof x !== "string") return undefined;
  const t = stripControl(x).trim();
  return t ? t.slice(0, max) : undefined;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/** Drops undefined keys, so stored JSON stays small and stable. */
function compact<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export interface ZoomParticipant {
  user_id?: string;
  participant_user_id?: string;
  participant_uuid?: string;
  id?: string;
  user_name?: string;
  email?: string;
  join_time?: string;
  leave_time?: string;
  date_time?: string;
  leave_reason?: string;
}

export interface ZoomObject {
  id?: string;
  uuid?: string;
  host_id?: string;
  topic?: string;
  type?: number;
  start_time?: string;
  end_time?: string;
  duration?: number;
  participant?: ZoomParticipant;
}

export interface ZoomDetail {
  event: string;
  event_ts?: number;
  payload: { account_id?: string; object: ZoomObject };
}

/**
 * The fields the room logic needs, and nothing else. Left out on purpose:
 * phone numbers, IP addresses, customer keys and registrant ids. The email
 * and user ids stay, because they are how staff are told apart from the lead.
 */
export function cleanZoom(body: unknown): ZoomDetail | null {
  if (!isObj(body)) return null;
  const event = str(body.event, 80);
  if (!event) return null;
  const payload = isObj(body.payload) ? body.payload : {};
  const object = isObj(payload.object) ? payload.object : {};
  const p = isObj(object.participant) ? object.participant : null;
  return compact({
    event,
    event_ts: num(body.event_ts),
    payload: compact({
      account_id: str(payload.account_id, 64),
      object: compact({
        id: str(object.id, 40),
        uuid: str(object.uuid, 80),
        host_id: str(object.host_id, 64),
        topic: str(object.topic, 200),
        type: num(object.type),
        start_time: str(object.start_time, 40),
        end_time: str(object.end_time, 40),
        duration: num(object.duration),
        participant: p
          ? compact({
              user_id: str(p.user_id, 64),
              participant_user_id: str(p.participant_user_id, 64),
              participant_uuid: str(p.participant_uuid, 80),
              id: str(p.id, 64),
              user_name: str(p.user_name, 120),
              email: str(p.email, 160)?.toLowerCase(),
              join_time: str(p.join_time, 40),
              leave_time: str(p.leave_time, 40),
              date_time: str(p.date_time, 40),
              leave_reason: str(p.leave_reason, 200),
            })
          : undefined,
      }),
    }),
  });
}

/**
 * One key per real event, the same on every retry of it, in exactly the form
 * roomlogic.ts zoomDedupeKey builds (P1): `zoom:{event}:{meeting instance
 * uuid, else id}` for a meeting event, plus `:{participant_uuid, else
 * user_id, else id}:{join_time, else leave_time, else event_ts}` for a
 * participant's. Zoom resends the identical body on a retry, so its retries
 * collapse; a second join by the same person has a second join time and is a
 * second event. Built from the cleaned event, which is what room.event
 * receives, so both lanes get the same key for the same event; a test pins
 * the form. Cleaned fields are short, so the key stays under the table's 300.
 *
 * room.event does not need to work the key out at all: the door passes the
 * stored row's `event_id` (and this key), and room.event claims that row by
 * id (README "The contract the other lanes keep").
 */
export function zoomDedupeKey(d: ZoomDetail): string {
  const name = String(d.event ?? "unknown").slice(0, 80);
  const o = d.payload?.object ?? {};
  const meeting = String(o.uuid ?? o.id ?? "").slice(0, 120);
  const p = o.participant;
  if (!p) return `zoom:${name}:${meeting}`;
  const who = String(p.participant_uuid ?? p.user_id ?? p.id ?? "").slice(0, 120);
  const when = String(p.join_time ?? p.leave_time ?? d.event_ts ?? "").slice(0, 60);
  return `zoom:${name}:${meeting}:${who}:${when}`;
}

/** The room code in a topic the worker wrote ("Mahara call K7Q2MX"). */
export function codeFromTopic(topic: string | undefined): string | null {
  const m = /\bMahara call ([A-HJ-NP-Z2-9]{6})\b/.exec(topic ?? "");
  return m ? m[1] : null;
}

/** What a Zoom event's room can be found by: its meeting id and the code in its topic. */
export type ZoomLookup = { meetingId: string | null; code: string | null };

export function zoomLookup(d: ZoomDetail): ZoomLookup {
  const id = d.payload.object.id;
  return {
    meetingId: id && /^\d{6,20}$/.test(id) ? id : null,
    code: codeFromTopic(d.payload.object.topic),
  };
}

/**
 * The one PostgREST query that finds every room a Zoom event could belong
 * to (by meeting id or by the topic's code), newest first, or null when the
 * event carries neither, so it cannot be a cockpit room.
 */
export function zoomRoomQuery(look: ZoomLookup): string | null {
  const parts: string[] = [];
  if (look.meetingId) parts.push(`provider_meeting_id.eq.${look.meetingId}`);
  if (look.code) parts.push(`code.eq.${look.code}`);
  if (!parts.length) return null;
  return `cockpit_sales_rooms?or=(${parts.join(",")})&select=id,state,code,provider_meeting_id&order=created_at.desc&limit=10`;
}

export type ZoomRoomRow = { id: string; state: string; code: string | null; provider_meeting_id: string | null };

const FINAL = new Set(["ended", "expired", "failed", "cancelled"]);

/**
 * Which room the event is about, from the rows zoomRoomQuery found.
 * - `{ room: false }`: no row. The meeting is not a cockpit room (the
 *   webinar, a client call, an interview on the same Zoom account), so the
 *   door keeps nothing of it.
 * - `{ room: true, room_id }`: the room. The topic's code decides first;
 *   else the one live room on that meeting; else the only room on it.
 * - `{ room: true, room_id: null }`: a cockpit meeting, but two rooms wrap
 *   it and the topic does not say which; sales-api decides.
 */
export function pickZoomRoom(
  rows: ZoomRoomRow[] | null | undefined,
  look: ZoomLookup,
): { room: false } | { room: true; room_id: string | null } {
  const all = Array.isArray(rows) ? rows.filter(r => r && typeof r.id === "string") : [];
  if (!all.length) return { room: false };
  if (look.code) {
    const byCode = all.find(r => r.code === look.code);
    if (byCode) return { room: true, room_id: byCode.id };
  }
  const onMeeting = look.meetingId ? all.filter(r => String(r.provider_meeting_id ?? "") === look.meetingId) : [];
  const live = onMeeting.filter(r => !FINAL.has(r.state));
  if (live.length === 1) return { room: true, room_id: live[0].id };
  if (live.length === 0 && onMeeting.length === 1) return { room: true, room_id: onMeeting[0].id };
  return { room: true, room_id: null };
}

/** room_events.kind for a Zoom event: "zoom." plus Zoom's own name. */
export function zoomKind(event: string): string {
  return `zoom.${event}`;
}

/**
 * A plain timeline line for the event (room_events.text), before sales-api
 * decides whether the person was staff or the lead.
 */
export function zoomText(d: ZoomDetail): string {
  const who = d.payload.object.participant?.user_name?.slice(0, 60) || "Someone";
  switch (d.event) {
    case "meeting.started":
      return "Zoom: the meeting started.";
    case "meeting.ended":
      return "Zoom: the meeting ended.";
    case "meeting.participant_joined":
      return `Zoom: ${who} joined.`;
    case "meeting.participant_left":
      return `Zoom: ${who} left.`;
    case "meeting.participant_joined_waiting_room":
      return `Zoom: ${who} is in the waiting room.`;
    case "meeting.participant_jbh_waiting":
      return `Zoom: ${who} is waiting for the host.`;
    case "meeting.participant_jbh_joined":
      return `Zoom: ${who} joined before the host.`;
    default:
      return `Zoom: ${d.event}.`;
  }
}
