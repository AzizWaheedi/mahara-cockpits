// bun test supabase/functions/sales-api/m1_numbers_r2.test.ts
//
// Milestone 1, video-link round 2, NUMBERS AND RECORDS. The pilot's
// settings (m1-scope.md section 3): rooms on for the test contact only,
// Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
// auto_on_miss off, live off. What must hold on the video-link path:
//   - every room, send and mark leaves exactly one audit row, and a row says
//     what happened (a press that changed nothing is not recorded as a mark
//     or an end the person made);
//   - nothing books, marks or settles by itself;
//   - test contacts stay on the test path.
//
// Round 2's angle: a closer's Zoom room, where Zoom's webhook moves the room
// as well as the closer's presses (meeting.started, the lead's join,
// meeting.ended). The panel polls room.status every 4 s, so a press made on
// the view from before Zoom's move is the everyday case, not a race.
//
// A test that fails here is a finding; tests named "control" pass.
// sales-api's rooms.ts on testfakes.ts. Every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-m1num2-lead-0001";
const SETTER = "setter-m1num2@stress.invalid";
const CLOSER = "closer-m1num2@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEETING = "81234567890";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const PILOT_ROOMS = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: true,
  test_contacts: [LEAD],
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  count_on_join: false,
  settle: false,
  wrap: false,
  short_link: false,
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
};

function world() {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { lane: string; requestId: string; to: string; body: string }[] = [];
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false } },
    // The WhatsApp gate shut, as in production today: the link goes by email.
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contacts: Record<string, Row> = {
    [LEAD]: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: [], country: "KW" },
  };
  w.routes.push(async (m, p) => {
    for (const id of Object.keys(contacts)) {
      if (m === "GET" && p === `/contacts/${id}`) return { contact: contacts[id] };
      if (m === "GET" && p === `/contacts/${id}/appointments`) return { events: [] };
    }
    return null as unknown as Row;
  });
  const msgRows = new Map<string, Row>();
  const at = () => new Date(w.clock.now).toISOString();
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sent", created_at: at(), ghl_asked_at: at(), provider_status: "sent", ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push({ lane, requestId, to: String(extra.contact_id ?? ""), body });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      return {};
    },
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id, source: "room" }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        contact_id: t.contactId,
        source: "room",
      }),
    upcoming: async () => null,
    sentSince: async (_c, _since, text) => {
      if (!text) return null;
      const hit = delivered.find(d => d.lane !== "email" && d.body === text);
      return hit ? { id: `ghl-${hit.requestId.slice(0, 8)}`, status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  async function workerOpens(id: string, url = MEET_URL, meeting = `evt-${id.slice(-4)}`) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: meeting,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function make(who: Who, b: Row = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(who, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    return String((out.room as Row).id);
  }
  const ready = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });

  /** A closer's Zoom room, made, opened and its link sent. */
  async function zoomRoom(): Promise<string> {
    const id = await make(closer, { provider: "zoom", call_kind: "demo" });
    await workerOpens(id, ZOOM_URL, MEETING);
    await ready(id);
    await w.flush();
    return id;
  }

  /** Zoom's webhook, as sales-live stores it and passes it on (the door's forward). */
  async function zoom(id: string, event: string, participant: Row | null, extra: Row = {}): Promise<void> {
    const eventId = fakeUuid();
    const t = new Date(w.clock.now).toISOString();
    const object: Row = { id: MEETING, uuid: "u1==", host_id: "Z-closer", ...extra };
    if (participant) object.participant = { join_time: t, ...participant };
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eventId,
        room_id: id,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${eventId}`,
        at: t,
        detail: { event, event_ts: w.clock.now, payload: { object } },
      },
    ]);
    await rooms.desk["room.event"]!(desk, { kind: `zoom.${event}`, event_id: eventId, payload: {} });
    await w.flush();
  }
  const hostJoins = (id: string) => zoom(id, "meeting.participant_joined", { id: "Z-closer", user_name: "Sami Closer", participant_uuid: "pu-host" });
  const leadJoins = (id: string) => zoom(id, "meeting.participant_joined", { id: "", user_name: "Huda Ali", participant_uuid: "pu-lead" });
  const meetingEnds = (id: string) => zoom(id, "meeting.ended", null);

  const ledger = (id: string) => audits.filter(a => a.entityId === id).map(a => String(a.action));
  const count = (id: string, action: string) => ledger(id).filter(a => a === action).length;
  const lines = (id: string) =>
    w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id)
      .map(e => String(e.kind));
  const numbers = () => ({
    marks: marks.length,
    bookings: w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments").length,
    hl_writes: w.ghlCalls.filter(c => c.method !== "GET").length,
    dispositions: w.db.t("cockpit_sales_dispositions").length,
    appointments: w.db.t("cockpit_sales_appointments").length,
  });
  return { ...w, rooms, audits, delivered, marks, room, workerOpens, make, ready, zoomRoom, hostJoins, leadJoins, meetingEnds, ledger, count, lines, numbers };
}

const v = (w: ReturnType<typeof world>, id: string) => Number(w.room(id).version);
const NOTHING = { marks: 0, bookings: 0, hl_writes: 0, dispositions: 0, appointments: 0 };

// ---------------------------------------------------------------------------

describe("control: a closer's Zoom room moved only by Zoom", () => {
  test("control: Zoom's host join, the lead's join and the meeting's end leave one row each and book nothing", async () => {
    const w = world();
    const id = await w.zoomRoom();
    await w.hostJoins(id);
    expect(w.room(id).state).toBe("host_in");
    await w.leadJoins(id);
    expect(w.room(id).state).toBe("lead_in");
    w.clock.now += 20 * MIN;
    await w.meetingEnds(id);
    expect(w.room(id).state).toBe("ended");
    expect(w.room(id).result).toBe("joined");
    expect(w.count(id, "room.create")).toBe(1);
    expect(w.count(id, "room.link")).toBe(1);
    expect(w.count(id, "room.event.zoom.meeting.participant_joined")).toBe(2);
    expect(w.count(id, "room.event.zoom.meeting.ended")).toBe(1);
    expect(w.ledger(id).filter(a => a.startsWith("room.mark") || a === "room.end")).toEqual([]);
    expect(w.numbers()).toEqual(NOTHING);
  });

  test("control: on a Meet room, the second tab's I'm in press (same version) leaves the one row the first press wrote", async () => {
    const w = world();
    const id = await w.make(setter);
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    const seen = v(w, id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: seen, what: "host_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: seen, what: "host_in" });
    expect(w.count(id, "room.mark.host_in")).toBe(1);
  });
});

describe("a press Zoom's webhook already made true is no mark of the person's", () => {
  test("Zoom saw the closer join (meeting.started / host join); the closer's I'm in the room, pressed on the view from 2 s before, writes no room.mark.host_in row", async () => {
    const w = world();
    const id = await w.zoomRoom();
    const seen = v(w, id); // the panel's last read: open
    await w.hostJoins(id); // Zoom's webhook lands first
    expect(w.room(id).state).toBe("host_in");
    const before = w.ledger(id).length;
    w.clock.now += 2 * S;
    await w.rooms.actions["room.mark"]!(closer, { room_id: id, version: seen, what: "host_in" });
    await w.flush();
    // The room did not move (Zoom had moved it); the person's press is no
    // second record of the host coming in.
    expect(w.room(id).state).toBe("host_in");
    expect(w.ledger(id).slice(before)).toEqual([]);
    expect(w.count(id, "room.event.zoom.meeting.participant_joined") + w.count(id, "room.mark.host_in")).toBe(1);
  });

  test("Zoom saw the lead join; the closer's The lead is in, pressed on the view from 2 s before, writes no room.mark.lead_in row (the join is Zoom's, not a hand press)", async () => {
    const w = world();
    const id = await w.zoomRoom();
    await w.hostJoins(id);
    const seen = v(w, id); // host_in
    await w.leadJoins(id);
    expect(w.room(id).state).toBe("lead_in");
    const before = w.ledger(id).length;
    w.clock.now += 2 * S;
    await w.rooms.actions["room.mark"]!(closer, { room_id: id, version: seen, what: "lead_in" });
    await w.flush();
    expect(w.ledger(id).slice(before)).toEqual([]);
    // The timeline says one thing about the lead coming in: Zoom's join.
    expect(w.lines(id).filter(k => k === "room.mark.lead_in")).toEqual([]);
    expect(w.numbers()).toEqual(NOTHING);
  });
});

describe("a room Zoom ended is ended once in the record", () => {
  test("Zoom ended the meeting (lead joined); the closer's Finished, pressed on the view from before, writes no second end row", async () => {
    const w = world();
    const id = await w.zoomRoom();
    await w.hostJoins(id);
    await w.leadJoins(id);
    w.clock.now += 20 * MIN;
    const seen = v(w, id); // lead_in
    await w.meetingEnds(id);
    expect(w.room(id).state).toBe("ended");
    const before = w.ledger(id).length;
    w.clock.now += 2 * S;
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: seen, reason: "finished" });
    await w.flush();
    expect(w.ledger(id).slice(before)).toEqual([]);
    expect(w.count(id, "room.event.zoom.meeting.ended") + w.count(id, "room.end")).toBe(1);
  });

  test("Zoom ended the meeting with the lead in; We are on the phone pressed on the view from before is not recorded as the room's end (the room ended joined)", async () => {
    const w = world();
    const id = await w.zoomRoom();
    await w.hostJoins(id);
    await w.leadJoins(id);
    w.clock.now += 20 * MIN;
    const seen = v(w, id);
    await w.meetingEnds(id);
    expect(w.room(id).result).toBe("joined");
    w.clock.now += 2 * S;
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: seen, reason: "on_phone", confirm: true });
    await w.flush();
    const ends = w.audits.filter(a => a.entityId === id && a.action === "room.end");
    // No row says the room ended because the call moved to the phone.
    expect(ends.map(a => (a.metadata as Row | undefined)?.reason)).toEqual([]);
    expect(w.room(id).result).toBe("joined");
  });
});
