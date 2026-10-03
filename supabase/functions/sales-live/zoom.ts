// Zoom's meeting events, as sales-live stores them in
// cockpit_sales_room_events. Pure functions: what to keep, the dedupe key,
// the room code a meeting's topic carries and the timeline line.
//
// The kept event has Zoom's own shape ({event, event_ts, payload: {account_id,
// object: {..., participant}}}) with fewer fields, so sales-api's room.event
// reads it exactly as it would read Zoom's body (roomlogic.ts zoomEffect).

import { sha256Hex } from "./sign.ts";
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
 * One key per real event, the same on every retry of it: the event name, the
 * meeting (instance uuid, else id), the participant, and the event's own time.
 * Zoom resends the identical body on a retry, so its retries collapse; two
 * joins by the same person (they left and came back) have two join times and
 * stay two events. event_ts is used only when an event carries no time of its
 * own (the join-before-host events).
 */
export async function zoomDedupeKey(d: ZoomDetail): Promise<string> {
  const o = d.payload.object;
  const p = o.participant ?? {};
  const meeting = o.uuid ?? o.id ?? "";
  const who = p.participant_uuid ?? p.participant_user_id ?? p.user_id ?? p.id ?? "";
  let when = [p.join_time, p.leave_time, p.date_time].filter(Boolean).join("|");
  if (!when && d.event === "meeting.started") when = o.start_time ?? "";
  if (!when && d.event === "meeting.ended") when = o.end_time ?? "";
  if (!when) when = d.event_ts !== undefined ? `ts${d.event_ts}` : "";
  const parts = [d.event, meeting, o.id ?? "", who, when];
  return `zoom:${d.event}:${(await sha256Hex(parts.join("\n"))).slice(0, 40)}`;
}

/** The room code in a topic the worker wrote ("Mahara call K7Q2MX"). */
export function codeFromTopic(topic: string | undefined): string | null {
  const m = /\bMahara call ([A-HJ-NP-Z2-9]{6})\b/.exec(topic ?? "");
  return m ? m[1] : null;
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
