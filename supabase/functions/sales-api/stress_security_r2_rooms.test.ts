// bun test supabase/functions/sales-api/stress_security_r2_rooms.test.ts
//
// Security and abuse stress of sales-api's live-call actions, round 2,
// 3 October 2026: what a seat can make the server do to another rep's call
// through a room (a mark the normal path refuses, a request id the server
// itself uses), what a forged replay can close, and what a Zoom event for a
// meeting that is no room leaves behind. Each `test` held when written; each
// `test.failing` pins a confirmed finding (its key is in its name) and goes
// red when the fix lands, so the fix flips it to `test`. Against
// testfakes.ts; no network, no real row.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOST = "stress-host@stress.invalid";
const OTHER = "stress-other@stress.invalid";
const LEAD = "stress-lead-1";
const LEAD2 = "stress-lead-2";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";

const host: Who = { signed_in: true, seat: true, manager: false, email: HOST, name: "Stress Host", role: "setter", ghl_user_id: "G-host" };
const other: Who = { signed_in: true, seat: true, manager: false, email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
};

function setup(o: { rooms?: Row; live?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const marks: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: HOST, name: "Stress Host", role: "setter", ghl_user_id: "G-host", active: true },
    { email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: HOST, zoom_user_id: "Z-host", zoom_status: "licensed", google_ok: true },
    { email: OTHER, zoom_user_id: "Z-other", zoom_status: "licensed", google_ok: true },
  ]);
  w.routes.push((m, p) =>
    m === "GET" && (p === `/contacts/${LEAD}` || p === `/contacts/${LEAD2}`)
      ? { contact: { id: p.split("/")[2], firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: [], country: "KW" } }
      : (null as unknown as Row),
  );
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, anyRep: opts.anyRep === true, quiet: opts.quiet === true });
      return { id: fakeUuid() };
    },
    sendText: async (who, b) => {
      sends.push({ who: who.email, ...b });
      return { message: { id: fakeUuid(), state: "sent" } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, ...t });
      return { message: { id: fakeUuid(), state: "sent" } };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, audits, marks, sends, room };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

/**
 * The life of a fallback room for a booked intro, as `who` makes it: asked
 * for with the intro's appointment id, opened by the worker, closed by the
 * sweep with nobody in it, then settled at the intro's start + 20 minutes by
 * the sweep's stored `sweep.settle` event, exactly as the SQL sweep (S1) and
 * the cron door (sweep.settle) do it. Answers what the settle marked.
 */
async function fallbackThenSettle(w: ReturnType<typeof setup>, who: Who, apptId: string): Promise<{ roomId: string; carried: unknown }> {
  const out = await w.rooms.actions["room.create"]!(who, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "intro",
    purpose: "fallback",
    appointment_id: apptId,
  });
  const roomId = String((out.room as Row).id);
  const carried = w.room(roomId).appointment_id ?? null;
  // The worker opens it; Zoom reports the meeting's start; nobody comes; the sweep closes it as nobody joined.
  Object.assign(w.room(roomId), { state: "open", join_url: ZOOM_URL, provider_meeting_id: "81234567890", opened_at: w.db.iso(), link_sent_at: w.db.iso() });
  w.db.seed("cockpit_sales_room_events", [
    { room_id: roomId, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${roomId}`, handled_at: w.db.iso() },
  ]);
  w.clock.now += 12 * MIN;
  Object.assign(w.room(roomId), { state: "expired", result: "no_join", ended_at: w.db.iso() });
  // The intro's start + 20 minutes: the sweep stores its settle event and the cron door passes it on.
  const appt = w.db.t("cockpit_sales_appointments").find(a => a.appointment_id === apptId) as Row;
  w.clock.now = Date.parse(String(appt.start_at)) + 21 * MIN;
  w.db.seed("cockpit_sales_room_events", [
    { room_id: roomId, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${roomId}` },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [roomId] } });
  await w.flush();
  return { roomId, carried };
}

// ---------------------------------------------------------------------------

describe("security r2: marking another rep's booked call through a room", () => {
  function withIntro(assignedTo: string) {
    const w = setup();
    const start = new Date(w.clock.now + 10 * MIN).toISOString();
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "stress-appt-1", contact_id: LEAD, call_type: "intro", status: "confirmed", start_at: start, assigned_user_id: assignedTo, calendar_id: "cal-intro" },
    ]);
    return w;
  }

  test("the intro's own rep: a fallback room that closed empty settles their own intro as a no-show (the fixture works)", async () => {
    const w = withIntro("G-host");
    const { carried } = await fallbackThenSettle(w, host, "stress-appt-1");
    expect(carried).toBe("stress-appt-1");
    expect(w.marks).toEqual([{ who: HOST, id: "stress-appt-1", status: "noshow", anyRep: true, quiet: true }]);
  });

  test("the normal mark path and room.wrap refuse a seat another rep's booked call", async () => {
    const w = withIntro("G-host");
    w.routes.push((m, p) =>
      m === "GET" && p === "/calendars/events/appointments/stress-appt-1"
        ? { appointment: { id: "stress-appt-1", contactId: LEAD, assignedUserId: "G-host", calendarId: "cal-intro", startTime: new Date(w.clock.now + 10 * MIN).toISOString(), address: ZOOM_URL } }
        : (null as unknown as Row),
    );
    const r = await refused(w.rooms.actions["room.wrap"]!(other, { request_id: crypto.randomUUID(), appointment_id: "stress-appt-1" }));
    expect([r.status, r.extra.code]).toEqual([403, "not_host"]);
  });

  test("fallback-room-launders-mark-on-another-reps-intro: a seat's room carrying a colleague's intro gets that intro marked a no-show with a manager's rights", async () => {
    // room.create keeps any appointment_id whose intro is for the same
    // contact (createRoom's bookedIntro), never asking whose call it is.
    // room.wrap and the dialer's own mark both refuse a seat another rep's
    // call ("This call is booked with another rep."), but the settle marks
    // through markAppointment(..., {anyRep: true, quiet: true}), which reads
    // anyRep as a manager. So a setter who makes and lets lapse (or ends) a
    // Zoom fallback room for a colleague's intro gets that intro marked a
    // no-show in HighLevel, quietly, in the colleague's numbers; with
    // count_on_join on, a join in the room marks it shown the same way
    // (countMark). The second rep's room should carry no appointment_id.
    const w = withIntro("G-host");
    const { carried } = await fallbackThenSettle(w, other, "stress-appt-1");
    expect(carried).toBeNull();
    expect(w.marks.filter(m => m.id === "stress-appt-1")).toHaveLength(0);
  });

  test("an appointment id of another lead's intro is never carried by a room (contact must match)", async () => {
    const w = withIntro("G-other");
    w.db.t("cockpit_sales_appointments")[0]!.contact_id = LEAD2;
    const out = await w.rooms.actions["room.create"]!(other, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "manual",
      appointment_id: "stress-appt-1",
    });
    expect(w.room(String((out.room as Row).id)).appointment_id ?? null).toBeNull();
  });
});

describe("security r2: request ids the server derives from what any seat can read", () => {
  test.failing("handover-request-id-squat: a seat that makes a room under a handover's id (readable by every seat) leaves the closer who takes it with no room", async () => {
    // finishClaim makes the taker's room with request_id = the handover's
    // own id (cockpit_sales_live.id), and every seat can read that table.
    // room.create takes any UUID a seat sends as its request id. A seat that
    // sends the handover's id first owns that request id, so the closer's
    // room create finds "a repeat by another host" and is refused
    // (bad_input): the take answers no room and the lead waits until the
    // sweep ends the handover. The same holds for the admit_blocked
    // replacement (uuidFrom("mahara-room/replace/{room id}")) and the link's
    // message keys (uuidFrom("mahara-room/link/{room id}/{channel}")), which
    // any seat can compute from a room id it can read.
    const w = setup({ live: { enabled: true } });
    const liveId = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id: liveId, request_id: fakeUuid(), contact_id: LEAD, asked_by: OTHER, kind: "demo", reason: "on_call", state: "offered", offered_to: [HOST], offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    // Any seat can read the handover row (RLS: seat read) and squat its id.
    await w.rooms.actions["room.create"]!(other, { request_id: liveId, contact_id: LEAD2, provider: "meet", call_kind: "intro", purpose: "manual" });
    const out = await w.rooms.actions["live.take"]!({ ...host, role: "closer" }, { live_id: liveId, request_id: crypto.randomUUID() });
    expect(out.room).toBeDefined();
    expect(String((out.room as Row).contact_id)).toBe(LEAD);
  });

  test("without a squat, the same take makes the closer's handover room (the fixture works)", async () => {
    const w = setup({ live: { enabled: true } });
    const liveId = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id: liveId, request_id: fakeUuid(), contact_id: LEAD, asked_by: OTHER, kind: "demo", reason: "on_call", state: "offered", offered_to: [HOST], offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    const out = await w.rooms.actions["live.take"]!({ ...host, role: "closer" }, { live_id: liveId, request_id: crypto.randomUUID() });
    expect(String((out.room as Row).contact_id)).toBe(LEAD);
    expect(String((out.room as Row).host_email)).toBe(HOST);
  });
});

describe("security r2: what a forged sweep.replay can close (the cron secret, or the cron door)", () => {
  test.failing("replay-closes-non-replayable-events: event ids of a pending Slack reply and a pending no-show settle are marked handled, so neither ever happens", async () => {
    // The cron door passes on any 1 to 50 UUIDs as sweep.replay, and the
    // contract says a forged post "can only ask for a re-check of rows as
    // they stand". But replay() finishes (handled_at = now) every event whose
    // kind it does not replay: a slack.reply the VPS poster has not sent yet
    // (source door) and the sweep's own sweep.settle event (source settle).
    // Neither is ever replayed by the SQL sweep, so the DM is never sent and
    // the intro is never settled. replay() should take only the sources the
    // sweep replays (zoom, slack, worker, claim) and leave the rest alone.
    const w = setup();
    const roomId = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      { id: roomId, request_id: fakeUuid(), contact_id: LEAD, purpose: "fallback", call_kind: "intro", provider: "zoom", host_email: HOST, made_by: HOST, state: "expired", result: "no_join" },
    ]);
    w.db.seed("cockpit_sales_room_events", [
      { id: "00000000-0000-4000-8000-0000000a0001", room_id: null, kind: "slack.reply", source: "door", dedupe_key: "slack.reply:stress", text: "Live handover is not switched on yet.", detail: { slack_user_id: "U2CERLKJA" } },
      { id: "00000000-0000-4000-8000-0000000a0002", room_id: roomId, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${roomId}` },
    ]);
    await w.rooms.desk["room.event"]!(desk, {
      kind: "sweep.replay",
      payload: { event_ids: ["00000000-0000-4000-8000-0000000a0001", "00000000-0000-4000-8000-0000000a0002"] },
    });
    const ev = (id: string) => w.db.t("cockpit_sales_room_events").find(e => e.id === id) as Row;
    expect(ev("00000000-0000-4000-8000-0000000a0001").handled_at ?? null).toBeNull();
    expect(ev("00000000-0000-4000-8000-0000000a0002").handled_at ?? null).toBeNull();
  });

  test("a forged replay of a handled event, or one somebody holds, changes nothing", async () => {
    const w = setup();
    const at = w.db.iso();
    w.db.seed("cockpit_sales_room_events", [
      { id: "00000000-0000-4000-8000-0000000b0001", room_id: null, kind: "zoom.meeting.participant_joined", source: "zoom", dedupe_key: "zoom:x:1", handled_at: at, detail: {} },
      { id: "00000000-0000-4000-8000-0000000b0002", room_id: null, kind: "zoom.meeting.participant_joined", source: "zoom", dedupe_key: "zoom:x:2", lease_until: new Date(w.clock.now + 30_000).toISOString(), detail: {} },
    ]);
    const out = await w.rooms.desk["room.event"]!(desk, {
      kind: "sweep.replay",
      payload: { event_ids: ["00000000-0000-4000-8000-0000000b0001", "00000000-0000-4000-8000-0000000b0002"] },
    });
    expect(out.handled).toBe(0);
    expect(w.db.t("cockpit_sales_room_events").find(e => e.id === "00000000-0000-4000-8000-0000000b0002")!.handled_at ?? null).toBeNull();
  });
});

describe("security r2: Zoom events for a meeting that is no room", () => {
  test("zoom-foreign-meeting-attendees-kept: an event the door kept with no room (its lookup failed) still holds the attendee's name and email after sales-api finds no room", async () => {
    // The door stores a Zoom event with room_id null whenever its 500 ms room
    // lookup fails, whatever the meeting (the webinar, a client call, an
    // interview on the same Zoom account). sales-api's zoomEvent then finds
    // no room and only marks it handled ("no_room"): the attendee's name and
    // email stay in cockpit_sales_room_events, which every seat can read
    // (RLS seat_read), for good. On no_room the participant should go.
    const w = setup();
    const id = "00000000-0000-4000-8000-0000000c0001";
    w.db.seed("cockpit_sales_room_events", [
      {
        id,
        room_id: null,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: "zoom:meeting.participant_joined:web-1:pu-9:2026-10-04T07:00:00Z",
        text: "Zoom: Attendee Person joined.",
        detail: {
          event: "meeting.participant_joined",
          payload: { object: { id: "99887766554", topic: "Mahara weekly webinar", participant: { user_name: "Attendee Person", email: "stress-attendee@stress.invalid", join_time: "2026-10-04T07:00:00Z" } } },
        },
      },
    ]);
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: id });
    expect(out.skipped).toBe("no room");
    const kept = JSON.stringify(w.db.t("cockpit_sales_room_events").find(e => e.id === id));
    expect(kept).not.toContain("stress-attendee@stress.invalid");
    expect(kept).not.toContain("Attendee Person");
  });
});

describe("security r2: a Zoom event pinned to a room by its topic only", () => {
  test.failing("zoom-topic-code-beats-meeting-id: meeting.ended from another meeting on the account, titled with the room's code, ends a room the lead is in", async () => {
    // The door pins an event to a room by the topic's code first (zoom.ts
    // pickZoomRoom); sales-api's zoomEvent applies it to that room without
    // checking that the event's meeting id is the room's provider_meeting_id.
    // A meeting anyone on Mahara's Zoom account names "Mahara call {code}"
    // and then ends closes another rep's room while the lead is still in the
    // real meeting (the panel says the call is over; the count and the
    // settle read the closed room).
    const w = setup();
    const roomId = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id: roomId, request_id: fakeUuid(), code: "K7Q2MX", contact_id: LEAD, purpose: "manual", call_kind: "demo", provider: "zoom",
        host_email: HOST, made_by: HOST, state: "lead_in", join_url: ZOOM_URL, provider_meeting_id: "81234567890",
        opened_at: w.db.iso(), host_in_at: w.db.iso(), lead_in_at: w.db.iso(), version: 5,
        ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
      },
    ]);
    const id = "00000000-0000-4000-8000-0000000d0001";
    w.db.seed("cockpit_sales_room_events", [
      {
        id, room_id: roomId, kind: "zoom.meeting.ended", source: "zoom", dedupe_key: "zoom:meeting.ended:other-meeting==",
        detail: { event: "meeting.ended", event_ts: w.clock.now, payload: { object: { id: "11122233344", uuid: "other-meeting==", host_id: "someone-else", topic: "Mahara call K7Q2MX" } } },
      },
    ]);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.ended", event_id: id });
    await w.flush();
    expect(w.room(roomId).state).toBe("lead_in");
  });
});
