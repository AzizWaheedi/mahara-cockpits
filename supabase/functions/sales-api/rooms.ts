// sales-api's live-call actions (contract v2, 3 October 2026): video rooms,
// availability, the handover take, and room.event, the one way the room
// worker, the door (sales-live) and the SQL sweep reach sales-api.
//
// What each action decides comes from roomlogic.ts; this file reads, writes
// and calls out. Every write to a room is a conditional PATCH built from
// roomlogic's `expect` (guardFilter), read again and tried again at most
// MAX_WRITE_TRIES times, and its effects run only when the write landed.
// Every action leaves an audit row; every outside call has a timeout
// (liveio.ts); nothing here ever reads or returns a host's start link except
// room.open, to the host.
//
// index.ts builds it with makeRooms(deps) and spreads its three lists into
// ACTIONS (seats), DESK_ACTIONS (the service key) and CRON_ACTIONS.
//
//   bun test supabase/functions/sales-api

import { cleanText, greetingName, redact, type Who } from "./lib.ts";
import { ApiRefusal, DbError, isUnique, type LiveIO, uuidFrom } from "./liveio.ts";
import {
  adoptRefusal,
  type Applied,
  applyRoomEvent,
  type CallKind,
  type Changed,
  channelPlan,
  countClaim,
  countFinish,
  countLive,
  type CountPlan,
  countUndo,
  countUndone,
  createRefusal,
  defaultProvider,
  type Effect,
  END_REASONS,
  fill,
  guardFilter,
  heldContacts,
  type HostFacts,
  isCallKind,
  isFinal,
  isProvider,
  isPurpose,
  isUuid,
  LANE_COPY,
  type LinkChannel,
  markEvent,
  MAX_WRITE_TRIES,
  ms,
  newRoomRow,
  type Provider,
  type Purpose,
  REPLAY_MAX_AGE_S,
  type RefusalCode,
  type Refused,
  refuse,
  ROOM_COPY,
  ROOM_MARKS,
  type RoomEvent,
  type RoomRow,
  type RoomsSetting,
  roomCtx,
  roomsHealth,
  roomsSetting,
  settleWanted,
  shortUrl,
  standbyToEnd,
  sweepRoom,
  toRoomView,
  TRIGGERS,
  wrapPlan,
  wrapRoomRow,
  type ZoomEvent,
  zoomCode,
  zoomEffect,
  zoomMeetingId,
} from "./roomlogic.ts";

type Row = Record<string, unknown>;
type Action = (who: Who, b: Row) => Promise<Row>;

const S = 1000;
const enc = encodeURIComponent;
const ROOMS = "cockpit_sales_rooms";
const EVENTS = "cockpit_sales_room_events";
const LIVE_STATES = "requested,creating,open,host_in,lead_in";
/** The sales sub-account in HighLevel (index.ts LOCATION). */
const LOCATION = "7NI8yyJtwsh2OOWA5Icr";

/** live.take, live.decline and live.press while live.enabled is false. */
export const LIVE_OFF = "Live handover is not switched on yet.";
/** The offer is gone (taken, ended, never yours): the strip's "gone". */
export const OFFER_GONE = "This offer has ended.";

/** The words room.event and the screens use that roomlogic does not hold. */
export const ROOMS_COPY = {
  room_missing: "That room is not here any more. Reload the page.",
  live_missing: OFFER_GONE,
  claim_busy: "The lead has a booked call open, so no room was made.",
  claim_locked: "Someone is taking this lead right now. Try again in a moment.",
  not_yet: "Demo chats are not built yet, so there is nothing to tick.",
  reply_not_yet: "Reply alerts are not built yet.",
  status_unread: "The room worker's status could not be read. Try again in a minute.",
  contact_unread_send: "HighLevel did not answer, so the link has not gone yet. It is tried again in a minute.",
  all_failed: "the link did not go on any channel ({why})",
  handover_only_claimed: "Take the live lead first. A handover room is made for the closer who took it.",
  ask_not_yet: "Asking for a live handover is not built yet. Book the call for now.",
} as const;

/** Timeline lines this file writes (room_events.text): plain, no names, no links. */
export const EVENT_TEXT = {
  asked: "A {provider} room was asked for.",
  wrapped: "The booked call's own {provider} link was put in this room.",
  mark_host_in: "Marked by hand: the host is in.",
  mark_lead_in: "Marked by hand: the lead is in.",
  mark_not_lead: "Marked by hand: that was not the lead.",
  ended: "Room ended by hand ({reason}).",
  link_sent: "Link sent on WhatsApp.",
  link_sent_email: "Link sent by email.",
  link_unconfirmed: "The WhatsApp template was not seen in time, so the link went by email too.",
  not_sent: "Not sent: {why}.",
  counted: "Counted in HighLevel: {what}.",
  undone: "The live booking was taken back.",
  settled: "The booked intro was marked a no-show: nobody joined.",
  settle_skipped: "Not settled: {why}.",
} as const;

/** A timeline line for an event stored without one (contract v2, defect 8). */
const KIND_TEXT: Record<string, string> = {
  "worker.ready": "The room was made.",
  "worker.failed": "The room could not be made.",
  "worker.create_sent": "The room worker asked for the meeting.",
  "worker.closing": "The room worker is closing the meeting.",
  "worker.held": "The meeting was kept open: someone was still in it.",
  "report.checked": "Zoom's report was checked against the room.",
  "zoom.meeting.started": "Zoom: the meeting started.",
  "zoom.meeting.ended": "Zoom: the meeting ended.",
  "zoom.meeting.participant_joined": "Zoom: someone joined.",
  "zoom.meeting.participant_left": "Zoom: someone left.",
  "zoom.meeting.participant_joined_waiting_room": "Zoom: someone is in the waiting room.",
  "zoom.meeting.participant_jbh_waiting": "Zoom: someone is waiting for the host.",
  "zoom.meeting.participant_jbh_joined": "Zoom: someone joined before the host.",
  "live.claimed": "A closer took this lead live.",
  "live.replaced": "Closed: a closer took this lead live in another room.",
  "door.open": "The lead opened the link.",
};

export function eventText(e: { kind?: unknown; text?: unknown; source?: unknown }): string {
  const t = typeof e.text === "string" ? e.text.trim() : "";
  if (t) return redact(t);
  const kind = String(e.kind ?? "");
  if (KIND_TEXT[kind]) return KIND_TEXT[kind];
  if (kind.startsWith("sweep.")) return "The sweep closed or checked this room.";
  if (kind.startsWith("zoom.")) return "Zoom sent an event for this room.";
  return "Something changed in this room.";
}

// ---------------------------------------------------------------------------
// What index.ts hands in
// ---------------------------------------------------------------------------

export interface MarkOpts {
  reason?: string | null;
  note?: string | null;
  anyRep?: boolean;
  /** The mark changes the status in HighLevel without its automations. */
  quiet?: boolean;
}

export interface SendTextInput {
  contact_id: string;
  channel: "whatsapp" | "email";
  body: string;
  subject?: string | null;
  request_id: string;
}

export interface SendTemplateInput {
  contactId: string;
  key: string;
  line: string;
  requestId: string;
  followupId: string | null;
  source?: "rep" | "followup" | "room" | "thread";
  /** Sign as this seat (the room's host), not the lead's owner. */
  signAs?: string | null;
  /** The URL button's variable, written to the contact field first. */
  buttonVariable?: { join_code: string } | null;
  /** How long the send is read back before it counts as not seen. */
  readBackMs?: number;
  values?: { call_time?: string | null };
}

export interface RoomDeps {
  io: LiveIO;
  audit(
    who: Who,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata?: Row,
  ): Promise<void>;
  markAppointment(who: Who, id: string, status: string, opts: MarkOpts): Promise<Row>;
  sendText(who: Who, b: SendTextInput, opts: { source: "room"; readBackMs?: number }): Promise<{ message: Row; repeated?: boolean }>;
  sendTemplate(who: Who, o: SendTemplateInput): Promise<{ message: Row; repeated?: boolean }>;
  /** The lead's next intro or demo booked ahead (index.ts upcoming). */
  upcoming(contactId: string, kind: CallKind): Promise<{ id: string; start: number } | null>;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const isoAt = (t: number) => new Date(t).toISOString();

/** A roomlogic refusal as the answer: its sentence, status and code (desk callers also read retry and cleanup). */
export function asRefusal(r: Refused): ApiRefusal {
  return new ApiRefusal(r.message, r.status, { code: r.code, retry: r.retry, cleanup: r.cleanup });
}
function no(code: RefusalCode, vars: Record<string, string | number | null | undefined> = {}): ApiRefusal {
  return asRefusal(refuse(code, vars));
}
function plain(message: string, status: number, code: string, extra: Row = {}): ApiRefusal {
  return new ApiRefusal(message, status, { code, retry: false, cleanup: false, ...extra });
}

function requestIdOf(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!isUuid(s)) throw plain("Reload the page and try again.", 400, "bad_input");
  return s;
}
function roomIdOf(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!isUuid(s)) throw no("bad_input");
  return s;
}
function idList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out = [...new Set(list.map(x => String(x ?? "").trim().toLowerCase()).filter(isUuid))];
  if (!out.length || out.length > 50 || out.length !== new Set(list.map(x => String(x ?? "").toLowerCase())).size)
    throw no("bad_input");
  return out;
}

/** Kuwait's midnight that begins the day of `t`, as an instant. */
function kuwaitMidnight(t: number): string {
  const k = new Date(t + 3 * 3_600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3_600_000).toISOString();
}

/** Which language a lead reads (the desk's list of Arabic-speaking countries, ISO codes). */
const ARABIC = new Set(["sa", "kw", "ae", "qa", "bh", "om", "eg", "jo", "iq", "lb", "sy", "ye", "ps", "ly", "tn", "dz", "ma", "sd"]);
export function leadLanguage(contact: Row | null): "ar" | "en" {
  const c = lower(contact?.country);
  return ARABIC.has(c) || /kuwait|saudi|emirates|qatar|bahrain|oman|egypt|jordan|iraq/.test(c) ? "ar" : "en";
}

/** Insert body without the nulls: the database's defaults fill them, and a column a later migration adds is never named early. */
function compact(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
}

// ---------------------------------------------------------------------------
// The lead's messages (English; the Arabic lines come under aziz-kuwaiti-voice)
// ---------------------------------------------------------------------------

export function leadText(
  room: Pick<RoomRow, "purpose" | "provider" | "appointment_id">,
  channel: "whatsapp_text" | "email",
  v: { first_name: string; rep: string; link: string },
): { subject: string | null; body: string } {
  const L = ROOM_COPY.lead_en;
  const vars = { first_name: v.first_name || "there", rep: v.rep, link: v.link, provider: room.provider === "zoom" ? "Zoom" : "Meet" };
  if (room.purpose === "fallback") {
    const line = fill(room.appointment_id ? L.fallback_booked : L.fallback_unbooked, vars);
    if (channel === "whatsapp_text") return { subject: null, body: line };
    return { subject: L.fallback_email_subject, body: `${line}\n\n${fill(L.fallback_email_sign, vars)}` };
  }
  if (room.purpose === "handover") {
    const line = fill(room.provider === "zoom" ? L.handover_zoom : L.handover_meet, vars);
    if (channel === "whatsapp_text") return { subject: null, body: line };
    return { subject: fill(L.handover_email_subject, vars), body: `${line}\n\n${L.handover_email_tail}` };
  }
  if (channel === "whatsapp_text") return { subject: null, body: fill(L.manual_whatsapp, vars) };
  return { subject: L.manual_email_subject, body: fill(L.manual_email_body, vars) };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export interface Rooms {
  /** Seat actions (ACTIONS). */
  actions: Record<string, Action>;
  /** Service-key actions (DESK_ACTIONS). */
  desk: Record<string, Action>;
  /** The desk actions the cron secret may also ask for (CRON_ACTIONS). */
  cron: string[];
  /** The contacts the dialer's queue leaves out now (roomlogic heldContacts). */
  held(now: number): Promise<Set<string>>;
}

export function makeRooms(deps: RoomDeps): Rooms {
  const { io } = deps;
  const DESK: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };

  // ------------------------------------------------------------- reading

  async function settingsOf(keys: string[]): Promise<Record<string, unknown>> {
    const rows = await io.db(`cockpit_sales_settings?key=in.(${keys.map(enc).join(",")})&select=key,value`);
    return Object.fromEntries(rows.map(r => [String(r.key), r.value]));
  }
  async function roomsAndLive(): Promise<{ rooms: RoomsSetting; live: Row; raw: Record<string, unknown> }> {
    const raw = await settingsOf(["rooms", "live"]);
    return { rooms: roomsSetting(raw.rooms), live: obj(raw.live), raw };
  }
  const liveOn = (live: Row) => live.enabled === true;

  async function readRoom(id: string): Promise<RoomRow | null> {
    return ((await io.db(`${ROOMS}?id=eq.${enc(id)}&select=*`))[0] as unknown as RoomRow | undefined) ?? null;
  }
  async function mustRoom(id: string): Promise<RoomRow> {
    const r = await readRoom(id);
    if (!r) throw plain(ROOMS_COPY.room_missing, 404, "bad_input");
    return r;
  }
  async function personOf(email: string): Promise<Row | null> {
    if (!email || email === "sales-desk") return null;
    return (await io.db(`cockpit_sales_people?email=eq.${enc(email)}&select=email,name,name_ar,role,ghl_user_id,active`))[0] ?? null;
  }
  /** The host seat as a Who, for marking and sending as them (glossary 1.5: desk handlers act as the host). */
  async function hostWho(email: string): Promise<Who> {
    const p = await personOf(lower(email)).catch(() => null);
    return {
      signed_in: true,
      seat: true,
      manager: p?.role === "manager",
      email: lower(email),
      name: (p?.name as string | null) ?? null,
      role: (p?.role as string | null) ?? null,
      ghl_user_id: (p?.ghl_user_id as string | null) ?? null,
    };
  }
  async function readContact(contactId: string): Promise<Row | null> {
    try {
      const out = await io.ghl("GET", `/contacts/${enc(contactId)}`, undefined, "2021-07-28");
      const c = obj(out.contact);
      return Object.keys(c).length ? c : null;
    } catch (e) {
      io.log(`rooms: the contact could not be read: ${redact(String((e as Error)?.message ?? e))}`);
      return null;
    }
  }
  async function hostFacts(email: string, now: number): Promise<{ facts: HostFacts | null; row: Row | null }> {
    const row = (await io.db(`cockpit_sales_room_hosts?email=eq.${enc(email)}&select=*`))[0] ?? null;
    if (!row) return { facts: null, row: null };
    const until = ms(row.zoom_live_until);
    return {
      row,
      facts: {
        zoom_status: (["licensed", "basic", "pending", "missing"].includes(String(row.zoom_status))
          ? row.zoom_status
          : null) as HostFacts["zoom_status"],
        zoom_live: until !== null && until > now,
        google_ok: row.google_ok === true,
      },
    };
  }
  async function appointment(id: string | null | undefined): Promise<Row | null> {
    if (!id) return null;
    return (await io.db(`cockpit_sales_appointments?appointment_id=eq.${enc(id)}&select=*`))[0] ?? null;
  }
  async function startsOf(rows: RoomRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map(r => r.appointment_id).filter((x): x is string => Boolean(x)))];
    if (!ids.length) return new Map();
    try {
      const appts = await io.db(
        `cockpit_sales_appointments?appointment_id=in.(${ids.map(i => `"${enc(i)}"`).join(",")})&select=appointment_id,start_at`,
      );
      return new Map(appts.map(a => [String(a.appointment_id), String(a.start_at ?? "")]));
    } catch {
      return new Map();
    }
  }
  async function views(rows: RoomRow[], setting: RoomsSetting): Promise<Row[]> {
    const starts = await startsOf(rows);
    return rows.map(r => toRoomView(r, { short_link: setting.short_link, starts_at: r.appointment_id ? starts.get(r.appointment_id) : null }) as unknown as Row);
  }
  async function view(r: RoomRow, setting: RoomsSetting): Promise<Row> {
    return (await views([r], setting))[0] as Row;
  }

  // ------------------------------------------------------------- writing

  /** The conditional write: lands only where the row still holds `expect`. */
  async function patchRoom(id: string, patch: Partial<RoomRow> | Row, expect: Partial<RoomRow> | Row): Promise<RoomRow | null> {
    const guard = guardFilter(expect);
    const rows = await io.db(`${ROOMS}?id=eq.${enc(id)}${guard ? `&${guard}` : ""}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    return (rows[0] as unknown as RoomRow | undefined) ?? null;
  }

  /**
   * Read, apply, write; a write someone else beat is read again and applied
   * again, at most MAX_WRITE_TRIES times, then "This changed a moment ago."
   * `make` builds the event from the row as read (a person's event carries
   * the version they saw, so a real change in between is refused).
   */
  async function applyLoop(
    id: string,
    make: (room: RoomRow) => RoomEvent,
    setting: RoomsSetting,
    first?: RoomRow | null,
  ): Promise<{ room: RoomRow; applied: Changed } | { room: RoomRow | null; refused: Refused }> {
    let room = first ?? (await readRoom(id));
    if (!room) return { room: null, refused: { ...refuse("bad_input"), message: ROOMS_COPY.room_missing, status: 404 } };
    const host = await personOf(lower(room.host_email)).catch(() => null);
    const ctx = { ...roomCtx(setting), host_first_name: greetingName(host?.name, null) || null };
    for (let i = 0; i < MAX_WRITE_TRIES; i++) {
      const a: Applied = applyRoomEventSafe(room, make(room), io.now(), ctx);
      if (!a.ok) return { room, refused: a };
      if (!a.changed) return { room, applied: a };
      const landed = await patchRoom(room.id, a.patch, a.expect);
      if (landed) return { room: landed, applied: { ...a, room: landed } };
      const again = await readRoom(id);
      if (!again) return { room: null, refused: { ...refuse("bad_input"), message: ROOMS_COPY.room_missing, status: 404 } };
      room = again;
    }
    return { room, refused: refuse("stale") };
  }

  /** One line on the room's timeline; never fatal. */
  async function note(roomId: string | null, kind: string, text: string, detail: Row = {}, dedupe?: string): Promise<void> {
    try {
      await io.db(`${EVENTS}?on_conflict=dedupe_key`, {
        method: "POST",
        body: {
          room_id: roomId,
          kind,
          source: "sales-api",
          dedupe_key: (dedupe ?? `${kind}:${roomId ?? "none"}:${io.uuid()}`).slice(0, 300),
          handled_at: isoAt(io.now()),
          text: text.slice(0, 500),
          detail,
        },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
    } catch (e) {
      io.log(`rooms: a timeline line was not stored: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  async function alertSet(e: Extract<Effect, { kind: "alert" }>, room: RoomRow): Promise<void> {
    const words =
      e.what === "booked_guard"
        ? `Room ${room.code}: the host's booked call is near and this room still has a lead in it or waiting. Tell the setter if cover is needed.`
        : `Room ${room.code}: the live booking was claimed over 2 minutes ago and has no result. Check HighLevel for a "Live" booking on this lead.`;
    try {
      await io.rpc("cockpit_sales_alert_set", {
        p_key: e.dedupe_key,
        p_on: true,
        p_kind: e.what === "booked_guard" ? "room_booked_guard" : "room_count_stuck",
        p_subject: `Room ${room.code}`,
        p_message: words,
        p_detail: { room_id: room.id, code: room.code },
      });
    } catch (err) {
      io.log(`rooms: an alert was not raised: ${redact(String((err as Error)?.message ?? err))}`);
    }
  }

  async function deleteSecret(roomId: string): Promise<void> {
    try {
      await io.db(`cockpit_sales_room_secrets?room_id=eq.${enc(roomId)}`, { method: "DELETE", prefer: "return=minimal" });
    } catch (e) {
      io.log(`rooms: the host link was not deleted: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  /**
   * What a landed change asks for (roomlogic Effect). The link, the count
   * and the undo run in the background (waitUntil), so a press or an event
   * is answered at once; each is idempotent, so a re-ask never doubles.
   * close_provider is the worker's; recover and refresh_standby are SQL's
   * under owner sql, so both are dropped here. `replace` is room.end's.
   */
  async function carryOut(room: RoomRow, effects: Effect[]): Promise<void> {
    for (const e of effects) {
      if (e.kind === "delete_secret") await deleteSecret(room.id);
      else if (e.kind === "send_link") io.background(sendLink(room.id));
      else if (e.kind === "count_live") io.background(runCount(room.id));
      else if (e.kind === "undo_count") io.background(runUndo(room.id));
      else if (e.kind === "alert") await alertSet(e, room);
    }
  }

  // ------------------------------------------------------------- creating

  interface CreateAsk {
    who: Who;
    host: string;
    request_id: string;
    purpose: Purpose;
    provider: Provider;
    call_kind: CallKind;
    contact_id: string | null;
    trigger?: string | null;
    attempt_id?: string | null;
    appointment_id?: string | null;
    handover_id?: string | null;
    setting: RoomsSetting;
  }

  /** The room create path (room.create, a standby room, an admit_blocked replacement, a handover's room). */
  async function createRoom(a: CreateAsk): Promise<{ room: RoomRow } | { refused: Refused }> {
    const now = io.now();
    const repeat = (await io.db(`${ROOMS}?request_id=eq.${enc(a.request_id)}&select=*`))[0] as unknown as RoomRow | undefined;
    if (repeat) {
      if (lower(repeat.host_email) !== a.host) return { refused: refuse("bad_input") };
      return { room: repeat };
    }
    const contact = a.contact_id ? await readContact(a.contact_id) : null;
    const [{ facts }, leadRooms, hostRooms, demos, appt] = await Promise.all([
      hostFacts(a.host, now),
      a.contact_id
        ? io.db(`${ROOMS}?contact_id=eq.${enc(a.contact_id)}&state=in.(${LIVE_STATES})&select=id`)
        : Promise.resolve([]),
      io.db(`${ROOMS}?host_email=eq.${enc(a.host)}&state=in.(${LIVE_STATES})&purpose=neq.booked&select=id`),
      a.contact_id
        ? io.db(
            `cockpit_sales_appointments?contact_id=eq.${enc(a.contact_id)}&call_type=eq.demo&start_at=gt.${enc(isoAt(now))}&status=not.in.(cancelled,invalid,noshow)&select=appointment_id&limit=1`,
          )
        : Promise.resolve([]),
      appointment(a.appointment_id),
    ]);
    const bookedIntro = Boolean(
      appt &&
        appt.call_type === "intro" &&
        String(appt.contact_id ?? "") === String(a.contact_id ?? "") &&
        !["cancelled", "invalid"].includes(String(appt.status ?? "")),
    );
    const no = createRefusal({
      setting: a.setting,
      purpose: a.purpose,
      provider: a.provider,
      call_kind: a.call_kind,
      contact_id: a.contact_id,
      contact,
      host: facts,
      host_email: a.host,
      lead_room_open: leadRooms.length > 0,
      host_room_open: hostRooms.length > 0,
      booked_demo: demos.length > 0,
      booked_intro: bookedIntro,
    });
    if (no) return { refused: no };
    const row: Row = {
      ...newRoomRow({
        id: io.uuid(),
        request_id: a.request_id,
        code: "",
        contact_id: a.contact_id,
        purpose: a.purpose,
        call_kind: a.call_kind,
        provider: a.provider,
        host_email: a.host,
        made_by: lower(a.who.email),
        now,
        trigger: a.trigger ?? null,
        attempt_id: isUuid(a.attempt_id) ? a.attempt_id : null,
        appointment_id: a.appointment_id && bookedIntro ? a.appointment_id : null,
        handover_id: a.handover_id ?? null,
      }),
      contact_first_name: greetingName(contact?.firstName, contact?.name) || null,
    };
    // The database picks a code no room has (the guard trigger).
    delete row.code;
    let inserted: RoomRow;
    try {
      inserted = (await io.db(ROOMS, { method: "POST", body: compact(row), prefer: "return=representation" }))[0] as unknown as RoomRow;
    } catch (e) {
      if (isUnique(e, "cockpit_sales_rooms_request_id_key")) {
        const twin = (await io.db(`${ROOMS}?request_id=eq.${enc(a.request_id)}&select=*`))[0] as unknown as RoomRow | undefined;
        if (twin && lower(twin.host_email) === a.host) return { room: twin };
        return { refused: refuse("bad_input") };
      }
      if (isUnique(e, "cockpit_sales_rooms_one_per_lead")) return { refused: refuse("lead_has_room", {}, a.purpose) };
      if (isUnique(e, "cockpit_sales_rooms_one_per_host")) return { refused: refuse("host_has_room") };
      throw e;
    }
    await deps.audit(a.who, "room.create", ROOMS, inserted.id, null, {
      purpose: a.purpose,
      provider: a.provider,
      call_kind: a.call_kind,
      contact_id: a.contact_id,
      host_email: a.host,
      state: inserted.state,
      code: inserted.code,
    });
    await note(inserted.id, "room.asked", fill(EVENT_TEXT.asked, { provider: a.provider === "zoom" ? "Zoom" : "Meet" }), {
      purpose: a.purpose,
    }, `room.asked:${inserted.id}`);
    return { room: inserted };
  }

  /** room.create's wait: the worker has 15 s; the browser polls room.status after that. */
  async function waitForWorker(room: RoomRow, setting: RoomsSetting): Promise<RoomRow> {
    const until = io.now() + setting.waits_s.ready * S;
    let cur = room;
    while ((cur.state === "requested" || cur.state === "creating") && io.now() < until) {
      await io.sleep(500);
      cur = (await readRoom(room.id).catch(() => cur)) ?? cur;
    }
    return cur;
  }

  async function roomCreate(who: Who, b: Row): Promise<Row> {
    const requestId = requestIdOf(b.request_id);
    const host = lower(who.email);
    const { rooms: setting } = await roomsAndLive();
    const purpose = String(b.purpose ?? "");
    const contactId = cleanText(b.contact_id, 80) || null;
    let handoverId: string | null = null;
    if (purpose === "handover") {
      // A seat makes a handover room only for a lead it holds live (Try Zoom after a failed room).
      const held = contactId
        ? (await io.db(
            `cockpit_sales_live?contact_id=eq.${enc(contactId)}&claimed_by=eq.${enc(host)}&state=in.(claimed,room_ready)&select=id&limit=1`,
          ))[0]
        : null;
      if (!held) throw plain(ROOMS_COPY.handover_only_claimed, 409, "bad_input");
      handoverId = String(held.id);
    }
    if (!isPurpose(purpose) || purpose === "booked") throw no("bad_input");
    if (!isProvider(b.provider) || !isCallKind(b.call_kind)) throw no("bad_input");
    const trigger = (TRIGGERS as readonly string[]).includes(String(b.trigger)) ? String(b.trigger) : null;
    const made = await createRoom({
      who,
      host,
      request_id: requestId,
      purpose,
      provider: b.provider,
      call_kind: b.call_kind,
      contact_id: contactId,
      trigger,
      attempt_id: cleanText(b.attempt_id, 40) || null,
      appointment_id: cleanText(b.appointment_id, 80) || null,
      handover_id: handoverId,
      setting,
    });
    if ("refused" in made) throw asRefusal(made.refused);
    const room = await waitForWorker(made.room, setting);
    return { room: await view(room, setting) };
  }

  // ------------------------------------------------------------- reading a room

  async function health(now: number): Promise<Row> {
    const since = enc(kuwaitMidnight(now));
    const count = (p: Promise<Row[]>) => p.then(r => r.length).catch(() => null);
    const [status, made, failed, mism] = await Promise.all([
      io.db("cockpit_sales_worker_status?worker=eq.sales-desk&job=eq.rooms&select=at,ok,detail").catch(() => null),
      count(io.db(`${ROOMS}?requested_at=gte.${since}&select=id&limit=5000`)),
      count(io.db(`${ROOMS}?requested_at=gte.${since}&state=eq.failed&select=id&limit=5000`)),
      count(io.db(`cockpit_sales_alerts?kind=eq.room_report&resolved_at=is.null&raised_at=gte.${since}&select=id&limit=500`)),
    ]);
    if (status === null)
      return { worker_ok: false, last_run_at: null, rooms_today: made, failed_today: failed, line: ROOMS_COPY.status_unread };
    return roomsHealth({
      now,
      last_run_at: status[0]?.at ?? null,
      rooms_today: made,
      failed_today: failed,
      mismatched_today: mism,
    }) as unknown as Row;
  }

  async function roomStatus(_who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const now = io.now();
    const [room, events, { rooms: setting }] = await Promise.all([
      mustRoom(id),
      io.db(`${EVENTS}?room_id=eq.${enc(id)}&select=at,kind,source,text&order=at.desc&limit=20`),
      roomsAndLive(),
    ]);
    return {
      room: await view(room, setting),
      events: events.map(e => ({ at: e.at, kind: e.kind, source: e.source, text: eventText(e) })),
      health: await health(now),
      now: isoAt(now),
    };
  }

  async function roomOpen(who: Who, b: Row): Promise<Row> {
    const room = await mustRoom(roomIdOf(b.room_id));
    if (lower(room.host_email) !== lower(who.email)) {
      const host = await personOf(lower(room.host_email)).catch(() => null);
      throw no("not_host", { host: greetingName(host?.name, null) || lower(room.host_email).split("@")[0] });
    }
    if (isFinal(room.state)) throw no("final");
    if (room.state === "requested" || room.state === "creating") throw no("too_early");
    const secret = (await io.db(`cockpit_sales_room_secrets?room_id=eq.${enc(room.id)}&select=start_url,expires_at`))[0];
    const expires = ms(secret?.expires_at);
    const fresh = secret && /^https:\/\//.test(String(secret.start_url ?? "")) && (expires === null || expires > io.now());
    // Meet rooms and booked rooms have no host link: the host opens the meeting
    // they organise. A Zoom room whose start link has gone: the join link, which
    // Zoom opens as the host when they are signed in.
    const url = fresh ? String(secret.start_url) : String(room.join_url ?? "");
    if (!/^https:\/\//.test(url)) throw no("too_early");
    await deps.audit(who, "room.open", ROOMS, room.id, null, { state: room.state, host_link: Boolean(fresh) });
    return { start_url: url };
  }

  // ------------------------------------------------------------- presses

  async function roomMark(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const what = String(b.what ?? "");
    const version = Number(b.version);
    if (!(ROOM_MARKS as readonly string[]).includes(what) || !Number.isInteger(version)) throw no("bad_input");
    const { rooms: setting } = await roomsAndLive();
    const actor = { email: lower(who.email), manager: who.manager === true };
    const out = await applyLoop(id, () => markEvent(what, actor, version) as RoomEvent, setting);
    if ("refused" in out) throw asRefusal(out.refused);
    const { room, applied } = out;
    if (applied.changed) {
      await deps.audit(who, `room.mark.${what}`, ROOMS, room.id, { state: applied.from }, { state: applied.to });
      await note(room.id, `room.mark.${what}`, EVENT_TEXT[`mark_${what}` as "mark_host_in"], { by: "person" });
      await carryOut(room, applied.effects);
    }
    return { room: await view(room, setting) };
  }

  async function roomEnd(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const reason = String(b.reason ?? "");
    const version = Number(b.version);
    if (!(END_REASONS as readonly string[]).includes(reason) || !Number.isInteger(version)) throw no("bad_input");
    const { rooms: setting } = await roomsAndLive();
    const actor = { email: lower(who.email), manager: who.manager === true };
    const out = await applyLoop(
      id,
      () => ({ kind: "end", reason: reason as (typeof END_REASONS)[number], actor, version, confirm: b.confirm === true }),
      setting,
    );
    if ("refused" in out) throw asRefusal(out.refused);
    const { room, applied } = out;
    const answer: Row = {};
    if (applied.changed) {
      await deps.audit(who, "room.end", ROOMS, room.id, { state: applied.from }, { state: applied.to, result: room.result }, { reason });
      await note(room.id, "room.end", fill(EVENT_TEXT.ended, { reason: reason.replaceAll("_", " ") }), { reason });
      await carryOut(room, applied.effects);
      const replace = applied.effects.find(e => e.kind === "replace");
      if (replace && replace.kind === "replace") {
        // "I can't let them in": the same lead, the other provider, in this request.
        const made = await createRoom({
          who,
          host: lower(room.host_email),
          request_id: await uuidFrom(`mahara-room/replace/${room.id}`),
          purpose: room.purpose,
          provider: replace.provider,
          call_kind: room.call_kind,
          contact_id: room.contact_id,
          trigger: room.trigger ?? null,
          attempt_id: room.attempt_id ?? null,
          appointment_id: room.appointment_id ?? null,
          handover_id: room.handover_id ?? null,
          setting,
        });
        if ("refused" in made) answer.replacement_refusal = made.refused.message;
        else answer.replacement = await view(await waitForWorker(made.room, setting), setting);
      }
    }
    return { room: await view(room, setting), ...answer };
  }

  async function roomSend(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const requestId = requestIdOf(b.request_id);
    if (b.channel !== "email") throw no("bad_input");
    const { rooms: setting } = await roomsAndLive();
    const room = await mustRoom(id);
    if (lower(room.host_email) !== lower(who.email) && who.manager !== true) {
      const host = await personOf(lower(room.host_email)).catch(() => null);
      throw no("not_host", { host: greetingName(host?.name, null) || "another rep" });
    }
    if (!room.contact_id) throw no("no_lead");
    if (isFinal(room.state)) throw no("final");
    if (room.state === "requested" || room.state === "creating") throw no("too_early");
    if (!setting.send.email) throw plain(`Not sent: ${LANE_COPY.why_email_off}.`, 409, "disabled");
    const sent = await sendOn(room, "email", requestId, setting, who);
    if (!sent.ok) throw plain(`Not sent: ${sent.why}.`, sent.status, "send_failed");
    const after = await recordSent(room, "email", sent.message_id, setting);
    await deps.audit(who, "room.send", ROOMS, room.id, null, { channel: "email", message_id: sent.message_id });
    return { room: await view(after, setting) };
  }

  async function roomWrap(who: Who, b: Row): Promise<Row> {
    const requestId = requestIdOf(b.request_id);
    const apptId = cleanText(b.appointment_id, 80);
    if (!apptId) throw no("bad_input");
    const host = lower(who.email);
    const { rooms: setting, raw } = await roomsAndLive();
    const repeat = (await io.db(`${ROOMS}?request_id=eq.${enc(requestId)}&select=*`))[0] as unknown as RoomRow | undefined;
    if (repeat && lower(repeat.host_email) === host) return { room: await view(repeat, setting) };
    // The booked call's room already open (another tab, another request id): that one.
    const open = (await io.db(
      `${ROOMS}?appointment_id=eq.${enc(apptId)}&purpose=eq.booked&state=in.(${LIVE_STATES})&select=*&limit=1`,
    ))[0] as unknown as RoomRow | undefined;
    if (open) return { room: await view(open, setting) };
    let ap: Row;
    try {
      ap = obj((await io.ghl("GET", `/calendars/events/appointments/${enc(apptId)}`)).appointment);
    } catch {
      throw no("contact_unread");
    }
    const mirror = await appointment(apptId).catch(() => null);
    if (!Object.keys(ap).length && !mirror) throw plain("That appointment is not in HighLevel any more.", 404, "bad_input");
    const assigned = String(ap.assignedUserId ?? mirror?.assigned_user_id ?? "");
    if (!who.manager && (!who.ghl_user_id || assigned !== who.ghl_user_id))
      throw plain("This call is booked with another rep. Only they or a manager can open its room.", 403, "not_host");
    const contactId = String(ap.contactId ?? mirror?.contact_id ?? "") || null;
    const calendars = obj(raw.calendars);
    const type = String(mirror?.call_type ?? obj(calendars[String(ap.calendarId ?? "")]).type ?? "");
    const kind: CallKind = type === "demo" ? "demo" : "intro";
    if (type !== "demo" && type !== "intro") throw no("bad_input");
    const contact = contactId ? await readContact(contactId) : null;
    const now = io.now();
    const plan = wrapPlan({
      setting,
      contact_id: contactId,
      contact,
      start: ap.startTime ?? mirror?.start_at,
      end: ap.endTime ?? null,
      address: ap.address,
      call_kind: kind,
      now,
      ctx: roomCtx(setting),
    });
    if (!plan.ok) throw asRefusal(plan);
    const row: Row = {
      ...wrapRoomRow(
        { id: io.uuid(), request_id: requestId, code: "", contact_id: contactId, call_kind: kind, host_email: host, made_by: host, now, appointment_id: apptId },
        plan,
      ),
      contact_first_name: greetingName(contact?.firstName, contact?.name) || null,
    };
    delete row.code;
    let inserted: RoomRow;
    try {
      inserted = (await io.db(ROOMS, { method: "POST", body: compact(row), prefer: "return=representation" }))[0] as unknown as RoomRow;
    } catch (e) {
      if (isUnique(e, "cockpit_sales_rooms_request_id_key")) {
        const twin = (await io.db(`${ROOMS}?request_id=eq.${enc(requestId)}&select=*`))[0] as unknown as RoomRow;
        return { room: await view(twin, setting) };
      }
      if (isUnique(e, "cockpit_sales_rooms_one_per_lead")) throw no("lead_has_room");
      throw e;
    }
    await deps.audit(who, "room.wrap", ROOMS, inserted.id, null, { appointment_id: apptId, provider: plan.provider, state: inserted.state });
    await note(inserted.id, "room.wrapped", fill(EVENT_TEXT.wrapped, { provider: plan.provider === "zoom" ? "Zoom" : "Meet" }), {
      appointment_id: apptId,
    }, `room.wrapped:${inserted.id}`);
    return { room: await view(inserted, setting) };
  }

  // ------------------------------------------------------------- the message service

  /**
   * One channel, one message, keyed so a retry can never send twice: the
   * rep's own request id for "Also send by email", else an id made from the
   * room and the channel. Answers what went, or why not.
   */
  async function sendOn(
    room: RoomRow,
    channel: LinkChannel,
    requestId: string,
    setting: RoomsSetting,
    by?: Who,
    contact?: Row | null,
  ): Promise<{ ok: true; message_id: string | null; unseen: boolean } | { ok: false; why: string; status: number }> {
    const sender = by ?? (await hostWho(room.host_email));
    const c = contact ?? (room.contact_id ? await readContact(room.contact_id) : null);
    const host = await personOf(lower(room.host_email)).catch(() => null);
    const link = shortUrl(room.code, room.join_url, setting.short_link);
    if (!room.contact_id || !link) return { ok: false, why: LANE_COPY.no_lead, status: 409 };
    const vars = {
      // "Hi there, your call..." when HighLevel has no name.
      first_name: greetingName(c?.firstName, c?.name) || "there",
      rep: greetingName(host?.name, null) || "the sales team",
      link,
    };
    try {
      if (channel === "whatsapp_template") {
        const key = `${setting.template_route}_${leadLanguage(c)}`;
        const out = await deps.sendTemplate(sender, {
          contactId: room.contact_id,
          key,
          line: "",
          requestId,
          followupId: null,
          source: "room",
          signAs: lower(room.host_email),
          buttonVariable: { join_code: room.code },
          readBackMs: setting.waits_s.unconfirmed * S,
        });
        const m = out.message;
        if (m.state === "failed") return { ok: false, why: String(m.error ?? "the template failed"), status: 502 };
        return { ok: true, message_id: String(m.id ?? "") || null, unseen: String(m.provider_status ?? "") === "enrolled" };
      }
      const t = leadText(room, channel === "email" ? "email" : "whatsapp_text", vars);
      const out = await deps.sendText(
        sender,
        {
          contact_id: room.contact_id,
          channel: channel === "email" ? "email" : "whatsapp",
          body: t.body,
          subject: t.subject,
          request_id: requestId,
        },
        { source: "room", readBackMs: setting.waits_s.unconfirmed * S },
      );
      const m = out.message;
      if (m.state === "failed") return { ok: false, why: String(m.error ?? "the message failed"), status: 502 };
      return { ok: true, message_id: String(m.id ?? "") || null, unseen: false };
    } catch (e) {
      const why = e instanceof ApiRefusal ? e.message : redact(String((e as Error)?.message ?? e));
      const status = e instanceof ApiRefusal ? e.status : 502;
      return { ok: false, why: why.replace(/\.+$/, ""), status };
    }
  }

  /** A send that went: the link_sent event (the lead's 10 minutes start), the channel and the message id. */
  async function recordSent(room: RoomRow, channel: LinkChannel, messageId: string | null, setting: RoomsSetting): Promise<RoomRow> {
    const out = await applyLoop(room.id, () => ({ kind: "link_sent", channel, at: io.now() }), setting);
    const cur = ("refused" in out ? out.room : out.room) ?? room;
    const fresh = (await readRoom(room.id)) ?? cur;
    const channels = [...new Set([...(Array.isArray(fresh.link_channels) ? (fresh.link_channels as string[]) : []), channel])];
    const ids = { ...obj(fresh.link_message_ids), ...(messageId ? { [channel]: messageId } : {}) };
    // link_channels and link_message_ids never move the version; one send
    // per room per channel (the claim), so a plain write by id is enough.
    const rows = await io.db(`${ROOMS}?id=eq.${enc(room.id)}`, {
      method: "PATCH",
      body: { link_channels: channels, link_message_ids: ids, ...(fresh.refusal ? { refusal: null } : {}) },
      prefer: "return=representation",
    });
    await note(room.id, "link.sent", channel === "email" ? EVENT_TEXT.link_sent_email : EVENT_TEXT.link_sent, { channel }, `link.sent:${room.id}:${channel}`);
    return (rows[0] as unknown as RoomRow | undefined) ?? fresh;
  }

  async function recordNotSent(room: RoomRow, why: string): Promise<void> {
    const sentence = why.charAt(0).toUpperCase() + why.slice(1).replace(/\.+$/, "");
    try {
      const rows = await io.db(`${ROOMS}?id=eq.${enc(room.id)}&link_sent_at=is.null`, {
        method: "PATCH",
        body: { refusal: `${sentence}.`.slice(0, 500) },
        prefer: "return=representation",
      });
      if (rows.length)
        await deps.audit(DESK, "room.link.not_sent", ROOMS, room.id, { refusal: room.refusal ?? null }, { refusal: rows[0]?.refusal ?? null });
    } catch (e) {
      io.log(`rooms: the reason the link did not go was not saved: ${redact(String((e as Error)?.message ?? e))}`);
    }
    await note(room.id, "link.not_sent", fill(EVENT_TEXT.not_sent, { why: sentence.charAt(0).toLowerCase() + sentence.slice(1) }), {});
  }

  /**
   * The message service (contract v2 section 5, send_link): WhatsApp free
   * text inside the window, then the call_link template, then email; a
   * template not seen in rooms.waits_s.unconfirmed is followed by email and
   * link_unconfirmed_at. Nothing goes to a client or a lead with
   * do-not-disturb everywhere; when nothing can go, `refusal` says why and
   * the rep reads the link out.
   */
  async function sendLink(roomId: string): Promise<void> {
    const room = await readRoom(roomId);
    if (!room?.contact_id || room.link_sent_at || !room.link_claimed_at) return;
    if (room.state !== "open" && room.state !== "host_in") return;
    const raw = await settingsOf(["rooms", "whatsapp_guard", "messaging"]);
    const setting = roomsSetting(raw.rooms);
    const contact = await readContact(room.contact_id);
    if (!contact) {
      await recordNotSent(room, ROOMS_COPY.contact_unread_send);
      return;
    }
    const lang = leadLanguage(contact);
    const [inbox, route, roomWa] = await Promise.all([
      io
        .db(`cockpit_sales_inbox?contact_id=eq.${enc(room.contact_id)}&select=inbound_whatsapp_at&order=inbound_whatsapp_at.desc.nullslast&limit=1`)
        .catch(() => []),
      io
        .db(`cockpit_sales_wa_templates?key=eq.${enc(`${setting.template_route}_${lang}`)}&select=key,active,workflow_id`)
        .catch(() => []),
      io
        .db("cockpit_sales_messages?source=eq.room&channel=eq.whatsapp&state=in.(sent,delivered,read,failed)&select=state&order=created_at.desc&limit=20")
        .then(rows => rows.map(r => ({ failed: r.state === "failed" })))
        .catch(() => null),
    ]);
    const guard = obj(raw.whatsapp_guard);
    const plan = channelPlan({
      contact,
      last_inbound_at: (inbox[0]?.inbound_whatsapp_at as string | null) ?? null,
      now: io.now(),
      setting,
      whatsapp_on: obj(raw.messaging).whatsapp !== false,
      guard,
      template_live: Boolean(route[0]?.active && route[0]?.workflow_id),
      room_wa: roomWa,
      wa_paused: Boolean(guard.dup_paused_at),
      email_first: room.trigger === "bad_number",
    });
    if (plan.refusal) {
      await recordNotSent(room, plan.refusal === "client" ? ROOM_COPY.refusals.client : ROOM_COPY.refusals.dnd);
      return;
    }
    if (plan.read_out) {
      await recordNotSent(room, plan.not_sent_reason ?? LANE_COPY.why_wa_off);
      return;
    }
    const fails: string[] = [];
    for (const channel of plan.order) {
      const requestId = await uuidFrom(`mahara-room/link/${room.id}/${channel}`);
      const sent = await sendOn(room, channel, requestId, setting, undefined, contact);
      if (!sent.ok) {
        fails.push(sent.why);
        continue;
      }
      let after = await recordSent(room, channel, sent.message_id, setting);
      let unconfirmed = false;
      if (sent.unseen && plan.email_backup && channel === "whatsapp_template") {
        const backupId = await uuidFrom(`mahara-room/link/${room.id}/email`);
        const mail = await sendOn(after, "email", backupId, setting, undefined, contact);
        if (mail.ok) {
          after = await recordSent(after, "email", mail.message_id, setting);
          await io.db(`${ROOMS}?id=eq.${enc(room.id)}&link_unconfirmed_at=is.null`, {
            method: "PATCH",
            body: { link_unconfirmed_at: isoAt(io.now()) },
            prefer: "return=minimal",
          });
          unconfirmed = true;
          await note(room.id, "link.unconfirmed", EVENT_TEXT.link_unconfirmed, {}, `link.unconfirmed:${room.id}`);
        }
      }
      await deps.audit(DESK, "room.link", ROOMS, room.id, { link_sent_at: null }, {
        link_sent_at: after.link_sent_at ?? null,
        link_channels: after.link_channels ?? [channel],
        link_unconfirmed: unconfirmed,
      }, { host_email: lower(room.host_email) });
      return;
    }
    await recordNotSent(room, fill(ROOMS_COPY.all_failed, { why: fails.join("; ") || "no reason given" }));
  }

  // ------------------------------------------------------------- the live booking

  async function runCount(roomId: string): Promise<void> {
    const room = await readRoom(roomId);
    if (!room?.contact_id) return;
    const raw = await settingsOf(["rooms"]);
    const setting = roomsSetting(raw.rooms);
    if (!setting.count_on_join) return;
    const [contact, host, upcoming, appt] = await Promise.all([
      readContact(room.contact_id),
      hostWho(room.host_email),
      deps.upcoming(room.contact_id, room.call_kind).catch(() => null),
      appointment(room.appointment_id).catch(() => null),
    ]);
    if (!contact) return; // the sweep's re-ask comes back for it
    const plan: CountPlan = countLive({
      room,
      setting,
      contact,
      upcoming,
      appointment_calendar_id: (appt?.calendar_id as string | null) ?? null,
      host_ghl_user_id: host.ghl_user_id ?? null,
      location_id: LOCATION,
      link: shortUrl(room.code, room.join_url, setting.short_link),
    });
    const now = io.now();
    const claim = countClaim(room, now, plan);
    if (!claim) return;
    const claimed = await patchRoom(room.id, claim.patch, claim.expect);
    if (!claimed) return; // another count holds it
    const claimedAt = String(claimed.count_claimed_at ?? claim.patch.count_claimed_at);
    if (plan.action === "none") {
      await deps.audit(DESK, "room.count", ROOMS, room.id, null, { result: plan.count_result, reason: plan.reason });
      return;
    }
    let done: { count_result: "booked" | "moved" | "failed" | null; count_appointment_id: string | null };
    let what = "";
    try {
      if (plan.action === "mark") {
        await deps.markAppointment(host, plan.appointment_id, "showed", { quiet: true, anyRep: true, note: "Joined the video room." });
        done = { count_result: null, count_appointment_id: plan.appointment_id };
        what = "the booked intro is marked shown";
      } else if (plan.action === "move") {
        await io.ghl("PUT", `/calendars/events/appointments/${enc(plan.appointment_id)}`, plan.body);
        await io.ghl("PUT", `/calendars/events/appointments/${enc(plan.appointment_id)}`, { appointmentStatus: "showed", toNotify: false });
        await note(room.id, "count.moved", "The lead's booked call was moved to now and marked shown.", {
          appointment_id: plan.appointment_id,
          from_start: plan.from_start,
        }, `count.moved:${room.id}:${claimedAt}`);
        done = { count_result: "moved", count_appointment_id: plan.appointment_id };
        what = "the booked call moved to now and marked shown";
      } else {
        const out = await io.ghl("POST", "/calendars/events/appointments", plan.body);
        const id = String(out.id ?? obj(out.appointment).id ?? obj(out.event).id ?? "");
        if (!id) throw new Error("HighLevel made no booking id");
        await io.ghl("PUT", `/calendars/events/appointments/${enc(id)}`, { appointmentStatus: "showed", toNotify: false });
        done = { count_result: "booked", count_appointment_id: id };
        what = plan.test ? "booked on the test calendar and marked shown" : "booked as a live call and marked shown";
      }
    } catch (e) {
      io.log(`rooms: the live booking failed: ${redact(String((e as Error)?.message ?? e))}`);
      done = { count_result: "failed", count_appointment_id: null };
      what = "the booking failed";
    }
    const fin = countFinish(claimedAt, done);
    const landed = await patchRoom(room.id, fin.patch, fin.expect);
    if (!landed && done.count_appointment_id) {
      // "That was not the lead" came in while the count ran: take back what it made, then say so.
      const cur = (await readRoom(room.id)) ?? room;
      await undoPlan({ ...cur, ...fin.patch }, plan.action === "move" ? plan.from_start : null);
      await patchRoom(room.id, { count_result: "undone" }, { count_claimed_at: cur.count_claimed_at ?? null, count_result: cur.count_result ?? null });
      await deps.audit(DESK, "room.count", ROOMS, room.id, null, { result: "undone", made: done });
      return;
    }
    await deps.audit(DESK, "room.count", ROOMS, room.id, null, done, { plan: plan.action });
    await note(room.id, "count.done", fill(EVENT_TEXT.counted, { what }), { result: done.count_result }, `count.done:${room.id}:${claimedAt}`);
  }

  /** Carries out one undo plan. Never a mark of invalid, which B2B counts as shown. */
  async function undoPlan(room: RoomRow, movedFrom: unknown): Promise<boolean> {
    const plan = countUndo(room, movedFrom);
    if (plan.action === "none") return plan.reason !== "in_flight";
    if (plan.action === "delete") {
      await io.ghl("DELETE", `/calendars/events/${enc(plan.appointment_id)}`);
    } else if (plan.action === "move_back") {
      await io.ghl("PUT", `/calendars/events/appointments/${enc(plan.appointment_id)}`, {
        startTime: plan.start,
        appointmentStatus: "confirmed",
        ignoreFreeSlotValidation: true,
        ignoreDateRange: true,
        toNotify: false,
      });
    } else {
      await io.ghl("PUT", `/calendars/events/appointments/${enc(plan.appointment_id)}`, { appointmentStatus: "confirmed", toNotify: false });
      await io.db(
        `cockpit_sales_dispositions?appointment_id=eq.${enc(plan.appointment_id)}&status=eq.showed&superseded_at=is.null`,
        { method: "PATCH", body: { superseded_at: isoAt(io.now()) }, prefer: "return=minimal" },
      );
    }
    return true;
  }

  async function runUndo(roomId: string): Promise<void> {
    const room = await readRoom(roomId);
    if (!room) return;
    const moved = room.count_result === "moved"
      ? ((await io
          .db(`${EVENTS}?room_id=eq.${enc(roomId)}&kind=eq.count.moved&select=detail&order=at.desc&limit=1`)
          .catch(() => []))[0]?.detail as Row | undefined)
      : undefined;
    try {
      const did = await undoPlan(room, moved?.from_start ?? null);
      if (!did) return;
    } catch (e) {
      io.log(`rooms: the undo failed, the sweep asks again: ${redact(String((e as Error)?.message ?? e))}`);
      return;
    }
    const w = countUndone(room);
    const landed = await patchRoom(room.id, w.patch, w.expect);
    if (landed) {
      await deps.audit(DESK, "room.count.undo", ROOMS, room.id, { count_result: room.count_result }, { count_result: "undone" });
      await note(room.id, "count.undone", EVENT_TEXT.undone, {}, `count.undone:${room.id}:${room.count_claimed_at ?? ""}`);
    }
  }

  // ------------------------------------------------------------- availability and presence

  async function presenceOfSeat(email: string, now: number): Promise<Row> {
    const p = (await io.db(`cockpit_sales_presence?email=eq.${enc(email)}&select=*`))[0] ?? null;
    const me: Row = {
      email,
      state: ["on_call", "ready", "available", "away"].includes(String(p?.state)) ? p?.state : "away",
      until: p?.until ?? null,
      room_id: p?.room_id ?? null,
      zoom_status: ["licensed", "basic", "pending", "missing"].includes(String(p?.zoom_status)) ? p?.zoom_status : null,
      default_provider: isProvider(p?.default_provider) ? p?.default_provider : "meet",
      reason: null,
      booked_at: null,
      booked_kind: null,
    };
    // The view is the one source (contract-v2 S5): it carries reason,
    // booked_at and booked_kind itself. The reads below stand in only for a
    // view built before those columns.
    if (p && "reason" in p) {
      const reason = String(p.reason ?? "");
      me.reason = ["missed_offer", "expired", "booked_call_soon"].includes(reason) ? reason : null;
      me.booked_at = me.reason === "booked_call_soon" ? (p.booked_at ?? null) : null;
      me.booked_kind = me.reason === "booked_call_soon" && isCallKind(p.booked_kind) ? p.booked_kind : null;
      return me;
    }
    const why = String(p?.availability_reason ?? "");
    if (me.state === "away" && (why === "missed_offer" || why === "expired")) me.reason = why;
    if (p?.availability === "available") {
      const last = (await io
        .db(`${ROOMS}?host_email=eq.${enc(email)}&purpose=eq.standby&select=end_reason,state&order=requested_at.desc&limit=1`)
        .catch(() => []))[0];
      if (last?.end_reason === "booked_call_soon") {
        me.reason = "booked_call_soon";
        const person = await personOf(email).catch(() => null);
        if (person?.ghl_user_id) {
          const next = (await io
            .db(
              `cockpit_sales_appointments?assigned_user_id=eq.${enc(String(person.ghl_user_id))}&start_at=gte.${enc(isoAt(now - 30 * 60 * S))}&status=in.(new,confirmed)&select=start_at,call_type&order=start_at.asc&limit=1`,
            )
            .catch(() => []))[0];
          if (next) {
            me.booked_at = next.start_at ?? null;
            me.booked_kind = isCallKind(next.call_type) ? next.call_type : null;
          }
        }
      }
    }
    return me;
  }

  async function liveAvailability(who: Who, b: Row): Promise<Row> {
    const state = String(b.state ?? "");
    if (state !== "available" && state !== "away") throw no("bad_input");
    const email = lower(who.email);
    const { rooms: setting, live } = await roomsAndLive();
    if (!setting.enabled && !liveOn(live)) throw no("disabled");
    const now = io.now();
    const before = (await io.db(`cockpit_sales_availability?email=eq.${enc(email)}&select=*`))[0] ?? null;
    const until = state === "available" ? isoAt(now + setting.available_hours * 3_600_000) : null;
    await io.db("cockpit_sales_availability?on_conflict=email", {
      method: "POST",
      body: { email, state, until, via: "cockpit", reason: null },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    await deps.audit(who, "live.availability", "cockpit_sales_availability", email, before, { state, until });
    let standbyError: string | null = null;
    const mine = (await io.db(`${ROOMS}?host_email=eq.${enc(email)}&state=in.(${LIVE_STATES})&select=*`)) as unknown as RoomRow[];
    if (state === "away") {
      for (const r of standbyToEnd(mine, email)) {
        const out = await applyLoop(r.id, () => ({ kind: "end", reason: "end" }), setting, r);
        if ("applied" in out && out.applied.changed) {
          await deps.audit(who, "room.end", ROOMS, r.id, { state: out.applied.from }, { state: out.applied.to }, { reason: "away" });
          await carryOut(out.room, out.applied.effects);
        }
      }
    } else if (setting.enabled && liveOn(live) && live.standby !== false && !mine.some(r => r.purpose === "standby")) {
      const [{ row: hostRow }, person] = await Promise.all([hostFacts(email, now), personOf(email).catch(() => null)]);
      const role = String(person?.role ?? who.role ?? "");
      if (hostRow && (role === "closer" || role === "both" || role === "setter")) {
        const provider = defaultProvider(role, hostRow as never, setting);
        const made = await createRoom({
          who,
          host: email,
          request_id: await uuidFrom(`mahara-room/standby/${email}/${until}`),
          purpose: "standby",
          provider,
          call_kind: role === "closer" ? "demo" : "intro",
          contact_id: null,
          setting,
        });
        if ("refused" in made) standbyError = made.refused.message;
      }
    }
    const me = await presenceOfSeat(email, now);
    return standbyError ? { me, standby_error: standbyError } : { me };
  }

  async function offersFor(email: string, now: number): Promise<Row[]> {
    const rows = await io.db(
      `cockpit_sales_live?state=eq.offered&offer_until=gt.${enc(isoAt(now))}&offered_to=cs.${enc(`{${email}}`)}&select=id,version,kind,contact_id,reason,note,offer_until,declined_by&order=offer_until.asc&limit=5`,
    );
    const open = rows.filter(r => !(Array.isArray(r.declined_by) && (r.declined_by as string[]).includes(email)));
    if (!open.length) return [];
    const leads = await io
      .db(`cockpit_sales_leads?contact_id=in.(${open.map(r => `"${enc(String(r.contact_id))}"`).join(",")})&select=contact_id,name,country`)
      .catch(() => []);
    const by = new Map(leads.map(l => [String(l.contact_id), l]));
    return open.map(r => {
      const l = by.get(String(r.contact_id));
      return {
        id: r.id,
        version: r.version,
        kind: r.kind,
        contact_first_name: greetingName(null, l?.name) || null,
        company: null,
        country: (l?.country as string | null) ?? null,
        reason: r.reason,
        note: r.note ?? null,
        offer_until: r.offer_until,
      };
    });
  }

  async function liveStatus(who: Who, _b: Row): Promise<Row> {
    const email = lower(who.email);
    const { rooms: setting, live } = await roomsAndLive();
    const liveEnabled = liveOn(live);
    if (!setting.enabled && !liveEnabled) throw no("disabled");
    const now = io.now();
    const [me, mine, offers, h, avail] = await Promise.all([
      presenceOfSeat(email, now),
      io.db(`${ROOMS}?host_email=eq.${enc(email)}&state=in.(${LIVE_STATES})&select=*&order=requested_at.desc&limit=10`),
      liveEnabled ? offersFor(email, now) : Promise.resolve([]),
      health(now),
      io.db(`cockpit_sales_availability?email=eq.${enc(email)}&select=state,updated_at`).catch(() => []),
    ]);
    let standbyError: string | null = null;
    if (avail[0]?.state === "available") {
      const failed = (await io
        .db(
          `${ROOMS}?host_email=eq.${enc(email)}&purpose=eq.standby&requested_at=gte.${enc(String(avail[0].updated_at))}&select=state,error&order=requested_at.desc&limit=1`,
        )
        .catch(() => []))[0];
      if (failed?.state === "failed") standbyError = (failed.error as string | null) ?? LANE_COPY.worker_failed;
    }
    return {
      me,
      rooms: await views(mine as unknown as RoomRow[], setting),
      offers,
      health: h,
      live_enabled: liveEnabled,
      standby_error: standbyError,
      now: isoAt(now),
    };
  }

  // ------------------------------------------------------------- the handover take

  async function finishClaim(who: Who, l: Row, setting: RoomsSetting): Promise<Row> {
    const via = String(l.claim_room ?? "none");
    if (via === "busy") return { claim_room: via, line: ROOMS_COPY.claim_busy };
    if (via === "lead_room" && l.room_id) {
      const r = await readRoom(String(l.room_id));
      return { claim_room: via, ...(r ? { room: await view(r, setting) } : {}) };
    }
    if ((via === "standby" || via === "own_room") && l.room_id) {
      // The claim RPC adopted the room; the link is due once the taker is in
      // it (send_on). A room still being made sends when the worker opens it.
      const r = await readRoom(String(l.room_id));
      if (!r) return { claim_room: via };
      if (r.state !== "open" && r.state !== "host_in") return { claim_room: via, room: await view(r, setting) };
      const out = await applyLoop(r.id, () => ({ kind: "ready" }), setting, r);
      if ("applied" in out) {
        if (out.applied.changed) {
          await deps.audit(who, "live.room.ready", ROOMS, out.room.id, { state: out.applied.from }, {
            state: out.applied.to,
            link_claimed: Boolean(out.applied.patch.link_claimed_at),
          }, { handover_id: String(l.id), claim_room: via });
          await carryOut(out.room, out.applied.effects);
        }
        return { claim_room: via, room: await view(out.room, setting) };
      }
      return { claim_room: via, room: await view(out.room ?? r, setting) };
    }
    // none: the taker's room is made now, for this handover.
    const taker = lower(String(l.claimed_by ?? who.email));
    const [{ row: hostRow }, person] = await Promise.all([hostFacts(taker, io.now()), personOf(taker).catch(() => null)]);
    const provider = defaultProvider(person?.role ?? "closer", hostRow as never, setting);
    const reoffers = Number(l.reoffers ?? 0);
    const made = await createRoom({
      who,
      host: taker,
      request_id: reoffers > 0 ? await uuidFrom(`mahara-live/${l.id}/${reoffers}`) : String(l.id),
      purpose: "handover",
      provider,
      call_kind: isCallKind(l.kind) ? l.kind : "demo",
      contact_id: String(l.contact_id),
      handover_id: String(l.id),
      setting,
    });
    if ("refused" in made) return { claim_room: via, line: made.refused.message };
    try {
      const linked = await io.db(`cockpit_sales_live?id=eq.${enc(String(l.id))}&room_id=is.null`, {
        method: "PATCH",
        body: { room_id: made.room.id },
        prefer: "return=representation",
      });
      if (linked.length)
        await deps.audit(who, "live.room", "cockpit_sales_live", String(l.id), { room_id: null }, { room_id: made.room.id });
    } catch (e) {
      io.log(`rooms: the handover's room was not linked: ${redact(String((e as Error)?.message ?? e))}`);
    }
    return { claim_room: via, room: await view(made.room, setting) };
  }

  async function liveTake(who: Who, b: Row): Promise<Row> {
    const liveId = roomIdOf(b.live_id);
    requestIdOf(b.request_id);
    const { rooms: setting, live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    const l = (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=*`))[0];
    if (!l) throw plain(OFFER_GONE, 409, "gone");
    const email = lower(who.email);
    // Already this seat's (a second press of the same Take): finish it again.
    if (lower(l.claimed_by) === email && ["claimed", "room_ready", "lead_joined"].includes(String(l.state)))
      return await finishClaim(who, l, setting);
    const contact = await readContact(String(l.contact_id));
    const r = adoptRefusal({ setting, contact_id: String(l.contact_id), contact });
    if (r) throw asRefusal(r);
    let rows: Row[];
    try {
      rows = (await io.rpc("cockpit_sales_live_claim", { p_live_id: liveId, p_email: email, p_version: null })) as Row[];
    } catch (e) {
      if (isUnique(e, "cockpit_sales_live_one_claim_per_closer")) throw plain(ROOM_COPY.refusals.live_call_open, 409, "live_call_open");
      if (e instanceof DbError && e.code === "55P03") throw plain(ROOMS_COPY.claim_locked, 503, "busy", { retry: true });
      throw e;
    }
    const claimed = Array.isArray(rows) ? rows[0] : null;
    if (!claimed) throw plain(ROOM_COPY.refusals.taken, 409, "taken");
    const key = `live.claimed:${claimed.id}:${Number(claimed.reoffers ?? 0)}`;
    try {
      const out = await finishClaim(who, claimed, setting);
      await finishEvent({ dedupe_key: key }, {});
      await deps.audit(who, "live.take", "cockpit_sales_live", String(claimed.id), { state: "offered" }, { state: claimed.state, claim_room: claimed.claim_room });
      return out;
    } catch (e) {
      // The sweep replays live.claimed; every branch is idempotent.
      await releaseEvent({ dedupe_key: key });
      throw e;
    }
  }

  async function liveDecline(who: Who, b: Row): Promise<Row> {
    const liveId = roomIdOf(b.live_id);
    requestIdOf(b.request_id);
    const { live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    const email = lower(who.email);
    for (let i = 0; i < MAX_WRITE_TRIES; i++) {
      const l = (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=id,state,offer_until,offered_to,declined_by`))[0];
      if (l?.state !== "offered" || (ms(l.offer_until) ?? 0) <= io.now()) throw plain(OFFER_GONE, 409, "gone");
      const declined = Array.isArray(l.declined_by) ? (l.declined_by as string[]) : [];
      if (declined.includes(email)) return {};
      const next = [...declined, email];
      const rows = await io.db(
        `cockpit_sales_live?id=eq.${enc(liveId)}&state=eq.offered&declined_by=eq.${enc(`{${declined.join(",")}}`)}`,
        { method: "PATCH", body: { declined_by: next }, prefer: "return=representation" },
      );
      if (rows.length) {
        await deps.audit(who, "live.decline", "cockpit_sales_live", liveId, { declined_by: declined }, { declined_by: next });
        return {};
      }
    }
    throw no("stale");
  }

  // ------------------------------------------------------------- room.event (desk and cron)

  async function lease(by: { id?: string; dedupe_key?: string }, seconds: number): Promise<string | null> {
    const got = await io.rpc("cockpit_sales_room_event_lease", {
      p_event_id: by.id ?? null,
      p_dedupe_key: by.dedupe_key ?? null,
      p_seconds: seconds,
    });
    return typeof got === "string" && got ? got : null;
  }
  function eventFilter(by: { id?: string; dedupe_key?: string }): string {
    return by.id ? `id=eq.${enc(by.id)}` : `dedupe_key=eq.${enc(String(by.dedupe_key))}`;
  }
  async function finishEvent(by: { id?: string; dedupe_key?: string }, detail: Row, text?: string): Promise<void> {
    const cur = (await io.db(`${EVENTS}?${eventFilter(by)}&select=id,detail,text`).catch(() => []))[0];
    if (!cur) return;
    await io.db(`${EVENTS}?id=eq.${enc(String(cur.id))}`, {
      method: "PATCH",
      body: {
        handled_at: isoAt(io.now()),
        lease_until: null,
        ...(Object.keys(detail).length ? { detail: { ...obj(cur.detail), ...detail } } : {}),
        ...(!cur.text && text ? { text: text.slice(0, 500) } : {}),
      },
      prefer: "return=minimal",
    });
  }
  async function releaseEvent(by: { id?: string; dedupe_key?: string }): Promise<void> {
    try {
      await io.db(`${EVENTS}?${eventFilter(by)}&handled_at=is.null`, {
        method: "PATCH",
        body: { lease_until: null },
        prefer: "return=minimal",
      });
    } catch (e) {
      io.log(`rooms: an event's lease was not released: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  type Outcome = { ok: true; handled: boolean; room?: Row; skipped?: string } | { ok: false; refusal: ApiRefusal };

  /** A refusal for an event: retry ones leave it for the sweep, final ones are handled and recorded. */
  async function settleRefusal(by: { id?: string; dedupe_key?: string }, r: Refused): Promise<Outcome> {
    if (r.retry) await releaseEvent(by);
    else await finishEvent(by, { refused: { code: r.code, message: r.message } });
    return { ok: false, refusal: asRefusal(r) };
  }

  async function staffCtx(room: RoomRow): Promise<Parameters<typeof zoomEffect>[1]> {
    const hosts = await io.db("cockpit_sales_room_hosts?select=email,zoom_user_id&limit=500").catch(() => []);
    const host = hosts.find(h => lower(h.email) === lower(room.host_email));
    return {
      host_email: lower(room.host_email),
      host_zoom_user_id: (host?.zoom_user_id as string | null) ?? null,
      staff_emails: hosts.map(h => lower(h.email)).filter(Boolean),
      staff_zoom_user_ids: hosts.map(h => String(h.zoom_user_id ?? "")).filter(Boolean),
    };
  }

  async function zoomEvent(eventId: string, leased: boolean): Promise<Outcome> {
    const by = { id: eventId };
    if (!leased && !(await lease(by, 30))) return { ok: true, handled: false };
    const ev = (await io.db(`${EVENTS}?id=eq.${enc(eventId)}&select=*`))[0];
    if (!ev) return { ok: true, handled: false };
    const detail = obj(ev.detail) as ZoomEvent;
    let room: RoomRow | null = ev.room_id ? await readRoom(String(ev.room_id)) : null;
    if (!room) {
      const meeting = zoomMeetingId(detail);
      const code = zoomCode(detail);
      const found = meeting
        ? ((await io.db(`${ROOMS}?provider_meeting_id=eq.${enc(meeting)}&select=*&order=requested_at.desc&limit=1`))[0] as unknown as RoomRow | undefined)
        : undefined;
      room =
        found ??
        (code ? ((await io.db(`${ROOMS}?code=eq.${enc(code)}&select=*`))[0] as unknown as RoomRow | undefined) : undefined) ??
        null;
      if (room)
        await io.db(`${EVENTS}?id=eq.${enc(eventId)}`, { method: "PATCH", body: { room_id: room.id }, prefer: "return=minimal" });
    }
    if (!room) {
      await finishEvent(by, { refused: { code: "no_room", message: "No cockpit room has this meeting." } });
      return { ok: true, handled: true, skipped: "no room" };
    }
    const effect = zoomEffect(detail, await staffCtx(room));
    if ("ignore" in effect) {
      await finishEvent(by, { ignored: effect.ignore, role: effect.role });
      return { ok: true, handled: true, skipped: effect.ignore };
    }
    const { rooms: setting } = await roomsAndLive();
    const out = await applyLoop(room.id, () => effect.room_event, setting, room);
    if ("refused" in out) return await settleRefusal(by, out.refused);
    if (out.applied.changed) {
      await deps.audit(DESK, `room.event.${String(ev.kind).slice(0, 60)}`, ROOMS, out.room.id, { state: out.applied.from }, { state: out.applied.to }, {
        event_id: eventId,
        role: effect.role,
      });
      await carryOut(out.room, out.applied.effects);
    }
    await finishEvent(by, { role: effect.role }, eventText(ev));
    return { ok: true, handled: true, room: await view(out.room, setting) };
  }

  async function workerEvent(kind: "worker.ready" | "worker.failed", roomId: string, leased: boolean, payload: Row): Promise<Outcome> {
    const by = { dedupe_key: `${kind}:${roomId}` };
    if (!leased && !(await lease(by, 30))) return { ok: true, handled: false };
    const room = await readRoom(roomId);
    if (!room) {
      await finishEvent(by, { refused: { code: "no_room" } });
      return { ok: true, handled: true, skipped: "no room" };
    }
    const runMismatch = payload.worker_run && room.worker_run && String(payload.worker_run) !== String(room.worker_run)
      ? { worker_run_mismatch: { payload: String(payload.worker_run).slice(0, 80), row: String(room.worker_run).slice(0, 80) } }
      : {};
    if (kind === "worker.failed") {
      if (room.state !== "failed") {
        await releaseEvent(by);
        return { ok: true, handled: false };
      }
      await finishEvent(by, runMismatch, KIND_TEXT["worker.failed"]);
      return { ok: true, handled: true };
    }
    if (room.state === "requested" || room.state === "creating") {
      // The worker's own open is still in flight; the sweep replays this.
      await releaseEvent(by);
      return { ok: true, handled: false };
    }
    if (isFinal(room.state) || room.state === "lead_in") {
      await finishEvent(by, runMismatch, KIND_TEXT["worker.ready"]);
      return { ok: true, handled: true };
    }
    const { rooms: setting } = await roomsAndLive();
    const out = await applyLoop(room.id, () => ({ kind: "ready" }), setting, room);
    if ("refused" in out) return await settleRefusal(by, out.refused);
    if (out.applied.changed) {
      await deps.audit(DESK, "room.event.worker.ready", ROOMS, out.room.id, null, {
        link_claimed: Boolean(out.applied.patch.link_claimed_at),
      });
      await carryOut(out.room, out.applied.effects);
    }
    await finishEvent(by, runMismatch, KIND_TEXT["worker.ready"]);
    return { ok: true, handled: true, room: await view(out.room, setting) };
  }

  async function claimedEvent(eventId: string): Promise<Outcome> {
    const ev = (await io.db(`${EVENTS}?id=eq.${enc(eventId)}&select=*`))[0];
    if (!ev) return { ok: true, handled: false };
    const liveId = String(obj(ev.detail).handover_id ?? "");
    const l = isUuid(liveId) ? (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=*`))[0] : null;
    if (!l || !["claimed", "room_ready", "lead_joined"].includes(String(l.state))) {
      await finishEvent({ id: eventId }, { skipped: "the handover is no longer held" });
      return { ok: true, handled: true, skipped: "handover over" };
    }
    const { rooms: setting } = await roomsAndLive();
    try {
      await finishClaim(await hostWho(String(l.claimed_by)), l, setting);
    } catch (e) {
      await releaseEvent({ id: eventId });
      throw e;
    }
    await finishEvent({ id: eventId }, {});
    return { ok: true, handled: true };
  }

  async function replay(ids: string[]): Promise<Row> {
    const results: Row[] = [];
    for (const id of ids) {
      const ev = (await io.db(`${EVENTS}?id=eq.${enc(id)}&select=id,kind,source,room_id,handled_at,lease_until,detail`))[0];
      if (!ev || ev.handled_at || (ms(ev.lease_until) ?? 0) > io.now()) {
        results.push({ id, handled: false, skipped: ev ? "handled or held" : "missing" });
        continue;
      }
      const kind = String(ev.kind);
      const seconds = kind === "live.claimed" ? 60 : 30;
      if (!(await lease({ id }, seconds))) {
        results.push({ id, handled: false, skipped: "held" });
        continue;
      }
      try {
        let out: Outcome;
        if (String(ev.source) === "zoom" && kind.startsWith("zoom.")) out = await zoomEvent(id, true);
        else if ((kind === "worker.ready" || kind === "worker.failed") && ev.room_id)
          out = await workerEvent(kind, String(ev.room_id), true, obj(ev.detail));
        else if (kind === "live.claimed") out = await claimedEvent(id);
        else {
          await finishEvent({ id }, { skipped: "not a kind room.event replays" });
          out = { ok: true, handled: true, skipped: "kind" };
        }
        results.push(out.ok ? { id, handled: out.handled, ...(out.skipped ? { skipped: out.skipped } : {}) } : { id, handled: false, refused: out.refusal.message });
      } catch (e) {
        await releaseEvent({ id });
        results.push({ id, handled: false, error: redact(String((e as Error)?.message ?? e)) });
      }
    }
    return { handled: results.filter(r => r.handled).length, results };
  }

  async function settle(roomIds: string[]): Promise<Row> {
    const results: Row[] = [];
    const { rooms: setting } = await roomsAndLive();
    for (const roomId of roomIds) {
      const by = { dedupe_key: `sweep.settle:${roomId}` };
      if (!(await lease(by, 30))) {
        results.push({ room_id: roomId, handled: false });
        continue;
      }
      try {
        const room = await readRoom(roomId);
        if (!room) {
          await finishEvent(by, { skipped: "no room" });
          results.push({ room_id: roomId, handled: true, skipped: "no room" });
          continue;
        }
        const [appt, marks] = await Promise.all([
          appointment(room.appointment_id),
          room.appointment_id
            ? io.db(`cockpit_sales_dispositions?appointment_id=eq.${enc(room.appointment_id)}&superseded_at=is.null&select=status`)
            : Promise.resolve([]),
        ]);
        const marked =
          marks.length > 0 || ["showed", "noshow", "cancelled", "invalid"].includes(String(appt?.status ?? ""));
        if (!settleWanted(room, appt?.start_at, marked, io.now(), setting.waits_s)) {
          const why = marked ? "the call was already marked" : !appt ? "the booked call is not in the cockpit" : "not due";
          if (marked && !room.settled_mark) {
            const none = await patchRoom(room.id, { settled_mark: "none" }, { settled_mark: null }).catch(() => null);
            if (none)
              await deps.audit(DESK, "room.settle", ROOMS, room.id, { settled_mark: null }, { settled_mark: "none" }, {
                appointment_id: room.appointment_id,
                why,
              });
          }
          await finishEvent(by, { skipped: why });
          await note(room.id, "room.settle", fill(EVENT_TEXT.settle_skipped, { why }), {}, `room.settle:${room.id}`);
          results.push({ room_id: roomId, handled: true, skipped: why });
          continue;
        }
        const host = await hostWho(room.host_email);
        try {
          await deps.markAppointment(host, String(room.appointment_id), "noshow", {
            anyRep: true,
            note: "Nobody joined the video room, so the intro is marked a no-show.",
          });
        } catch (e) {
          if (e instanceof ApiRefusal) {
            await finishEvent(by, { refused: { message: e.message, status: e.status } });
            results.push({ room_id: roomId, handled: true, refused: e.message });
            continue;
          }
          throw e;
        }
        await patchRoom(room.id, { settled_mark: "noshow" }, { settled_mark: null });
        await deps.audit(DESK, "room.settle", ROOMS, room.id, { settled_mark: null }, { settled_mark: "noshow" }, {
          appointment_id: room.appointment_id,
        });
        await note(room.id, "room.settle", EVENT_TEXT.settled, {}, `room.settle:${room.id}`);
        await finishEvent(by, { settled: "noshow" });
        results.push({ room_id: roomId, handled: true, settled: "noshow" });
      } catch (e) {
        await releaseEvent(by);
        results.push({ room_id: roomId, handled: false, error: redact(String((e as Error)?.message ?? e)) });
      }
    }
    return { handled: results.filter(r => r.handled).length, results };
  }

  /** The tick (S1): no timers here, only the re-asks and alerts SQL cannot do. */
  async function tick(roomIds: string[]): Promise<Row> {
    const { rooms: setting } = await roomsAndLive();
    const ctx = roomCtx(setting);
    const now = io.now();
    const results: Row[] = [];
    for (const id of roomIds) {
      const room = await readRoom(id).catch(() => null);
      if (!room) {
        results.push({ room_id: id, effects: [] });
        continue;
      }
      const [pending, next, avail] = await Promise.all([
        io
          .db(
            `${EVENTS}?room_id=eq.${enc(id)}&handled_at=is.null&source=in.(zoom,worker,claim)&at=gte.${enc(isoAt(now - REPLAY_MAX_AGE_S * S))}&select=id&limit=50`,
          )
          .then(r => r.length)
          .catch(() => null),
        nextBooked(room.host_email, now),
        room.purpose === "standby"
          ? io
              .db(`cockpit_sales_availability?email=eq.${enc(lower(room.host_email))}&select=state,until`)
              .then(r => (r[0]?.state === "available" ? (r[0]?.until as string | null) ?? null : null))
              .catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      const a = sweepRoom(room, now, ctx, next, {
        pending_events: pending,
        ...(avail === undefined ? {} : { available_until: avail }),
        owner: "sql",
      });
      const effects = a.ok ? a.effects : [];
      const asked = effects.filter(e => e.kind === "send_link" || e.kind === "count_live" || e.kind === "undo_count" || e.kind === "alert");
      if (asked.length) io.background(carryOut(room, asked));
      results.push({ room_id: id, effects: asked.map(e => e.kind) });
    }
    return { handled: results.length, results };
  }

  async function nextBooked(hostEmail: string, now: number): Promise<number | null> {
    try {
      const person = await personOf(lower(hostEmail));
      if (!person?.ghl_user_id) return null;
      const a = (await io.db(
        `cockpit_sales_appointments?assigned_user_id=eq.${enc(String(person.ghl_user_id))}&start_at=gt.${enc(isoAt(now))}&status=in.(new,confirmed)&select=start_at&order=start_at.asc&limit=1`,
      ))[0];
      return ms(a?.start_at);
    } catch {
      return null;
    }
  }

  async function roomEventAction(_who: Who, b: Row): Promise<Row> {
    const kind = String(b.kind ?? "");
    const payload = obj(b.payload);
    let out: Outcome;
    if (kind === "sweep.replay") return await replay(idList(payload.event_ids));
    if (kind === "sweep.settle") return await settle(idList(payload.room_ids));
    if (kind === "tick") return await tick(idList(payload.room_ids));
    if (kind === "worker.ready" || kind === "worker.failed") out = await workerEvent(kind, roomIdOf(b.room_id), false, payload);
    else if (/^zoom\.[a-z_.]{1,80}$/.test(kind)) out = await zoomEvent(roomIdOf(b.event_id), false);
    else throw no("bad_input");
    if (!out.ok) throw out.refusal;
    const { ok: _ok, ...rest } = out;
    return rest;
  }

  // ------------------------------------------------------------- not built yet (their switches are off)

  async function livePress(_who: Who, _b: Row): Promise<Row> {
    const { live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    throw plain("Slack presses are not built yet. Use the cockpit.", 409, "disabled");
  }
  /** live.ask and live.cancel (project 2): a plain sentence, never "Unknown action.", until they are built. */
  async function liveAsk(_who: Who, _b: Row): Promise<Row> {
    const { live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    throw plain(ROOMS_COPY.ask_not_yet, 409, "disabled");
  }
  async function threadTick(): Promise<Row> {
    return { handled: false, note: ROOMS_COPY.not_yet };
  }
  async function replySeen(): Promise<Row> {
    return { handled: false, note: ROOMS_COPY.reply_not_yet };
  }

  // ------------------------------------------------------------- the dialer's queue hold

  async function held(now: number): Promise<Set<string>> {
    const [raw, rows] = await Promise.all([
      settingsOf(["rooms"]),
      io.db(`${ROOMS}?state=in.(${LIVE_STATES})&contact_id=not.is.null&select=*&limit=2000`),
    ]);
    return heldContacts(rows as unknown as RoomRow[], now, roomCtx(roomsSetting(raw.rooms)));
  }

  return {
    actions: {
      "room.create": roomCreate,
      "room.status": roomStatus,
      "room.open": roomOpen,
      "room.mark": roomMark,
      "room.end": roomEnd,
      "room.send": roomSend,
      "room.wrap": roomWrap,
      "live.availability": liveAvailability,
      "live.status": liveStatus,
      "live.take": liveTake,
      "live.decline": liveDecline,
      "live.ask": liveAsk,
      "live.cancel": liveAsk,
    },
    desk: {
      "room.event": roomEventAction,
      "live.press": livePress,
      "thread.tick": threadTick,
      "reply.seen": replySeen,
    },
    cron: ["room.event", "live.press", "thread.tick", "reply.seen"],
    held,
  };
}

/** applyRoomEvent that never throws (a damaged row is a refusal, never a crash). */
function applyRoomEventSafe(room: RoomRow, e: RoomEvent, now: number, ctx: ReturnType<typeof roomCtx>): Applied {
  try {
    return applyRoomEvent(room, e, now, ctx);
  } catch {
    return refuse("bad_input");
  }
}
