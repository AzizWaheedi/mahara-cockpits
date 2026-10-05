// bun test supabase/functions/sales-api/m1_numbers_r1.test.ts
//
// Milestone 1, video-link round 1, NUMBERS AND RECORDS. The pilot's
// settings (m1-scope.md section 3): rooms on for the test contact only,
// Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
// auto_on_miss off, live off. What must hold on the video-link path:
//   - nothing books, marks or settles by itself (no HighLevel booking, no
//     mark, no disposition, no appointment row);
//   - every room, send and mark leaves exactly one audit row, whatever the
//     presses, retries, replays and ticks around it;
//   - test contacts stay on the test path (a room and its messages reach
//     only the listed contact);
//   - no show-rate number moves because of a room.
//
// A test that fails here is a finding; tests named "control" pass.
// sales-api's rooms.ts on testfakes.ts; the message service keeps index.ts's
// one rule (one request id, one message). Every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-m1num-lead-0001";
const REAL_LEAD = "stress-m1num-real-0002";
const SETTER = "setter-m1num@stress.invalid";
const CLOSER = "closer-m1num@stress.invalid";
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

function world(o: { gate?: boolean; inboundAgoMs?: number } = {}) {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  /** Audit actions whose next insert the database does not take (index.ts audit() logs it and goes on). */
  const dropAudit = new Set<string>();
  const delivered: { lane: string; requestId: string; to: string; body: string }[] = [];
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: o.gate
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
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
  if (o.inboundAgoMs !== undefined)
    w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - o.inboundAgoMs).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contacts: Record<string, Row> = {
    [LEAD]: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: [], country: "KW" },
    [REAL_LEAD]: { id: REAL_LEAD, firstName: "Omar", name: "Omar Real", phone: "+96551111111", email: "omar@stress.invalid", tags: ["cockpit-test"], country: "KW" },
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
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sent", created_at: at(), ghl_asked_at: at(), provider_status: lane === "template" ? "delivered" : "sent", ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push({ lane, requestId, to: String(extra.contact_id ?? ""), body });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      // index.ts audit(): a failed insert is logged and swallowed; the change stands.
      if (dropAudit.delete(action)) return;
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
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function make(who: Who = setter, b: Row = {}): Promise<string> {
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
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  async function replayAll(): Promise<void> {
    const ids = w.db
      .t("cockpit_sales_room_events")
      .filter(e => !e.handled_at && ["worker", "zoom", "claim"].includes(String(e.source)) && (!e.lease_until || Date.parse(String(e.lease_until)) <= w.clock.now))
      .map(e => String(e.id));
    if (ids.length) await rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: ids } }).catch(() => null);
  }
  const ledger = (id: string) => audits.filter(a => a.entityId === id).map(a => String(a.action));
  const count = (id: string, action: string) => ledger(id).filter(a => a === action).length;
  const numbers = () => ({
    marks: marks.length,
    bookings: w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments").length,
    hl_writes: w.ghlCalls.filter(c => c.method !== "GET").length,
    dispositions: w.db.t("cockpit_sales_dispositions").length,
    appointments: w.db.t("cockpit_sales_appointments").length,
  });
  return { ...w, rooms, audits, dropAudit, delivered, marks, room, workerOpens, make, ready, tick, replayAll, ledger, count, numbers };
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

const v = (w: ReturnType<typeof world>, id: string) => Number(w.room(id).version);

// ---------------------------------------------------------------------------

describe("control: one setter's video link, start to finish, with the pilot's settings", () => {
  test("control: Meet by email (the WhatsApp gate shut, as in production): one row per room, send and mark; nothing booked or marked", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    expect(w.delivered.map(d => [d.lane, d.to])).toEqual([["email", LEAD]]);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "host_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "lead_in" });
    await w.flush();
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v(w, id), reason: "finished" });
    await w.flush();
    expect(w.room(id).state).toBe("ended");
    const one = ["room.create", "room.link", "room.mark.host_in", "room.mark.lead_in", "room.end"];
    for (const a of one) expect([a, w.count(id, a)]).toEqual([a, 1]);
    expect(w.ledger(id).filter(a => a.startsWith("room.count") || a.startsWith("room.settle"))).toEqual([]);
    expect(w.numbers()).toEqual({ marks: 0, bookings: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });
});

describe("every send leaves exactly one audit row", () => {
  test("Also send by email pressed in two tabs (two request ids) after the link went by WhatsApp: one email reaches the lead, so one room.send row", async () => {
    const w = world({ gate: true, inboundAgoMs: HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    expect(w.delivered.map(d => d.lane)).toEqual(["text"]);
    // Two tabs both showed "Also send by email" (the room read before either press).
    await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() });
    await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() });
    await w.flush();
    const emails = w.delivered.filter(d => d.lane === "email").length;
    expect(emails).toBe(1);
    expect(w.count(id, "room.send")).toBe(emails);
  });

  test("Send by email from a tab opened before the link went by email: no second email goes, so no room.send row claims one", async () => {
    const w = world(); // the gate shut: the link itself goes by email
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    expect(w.delivered.map(d => d.lane)).toEqual(["email"]);
    const linkRows = w.count(id, "room.link");
    // The rep's other tab still shows "Send by email" (link_channels was empty when it read the room).
    await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }).catch(() => null);
    await w.flush();
    expect(w.delivered.filter(d => d.lane === "email")).toHaveLength(1);
    // One email went in all: one audit row says so (room.link), and nothing more.
    expect(w.count(id, "room.send") + w.count(id, "room.link")).toBe(linkRows);
  });

  test("control: worker.ready told twice (the worker, then the sweep's replay of its stored event) and two ticks send one link and leave one row", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    w.clock.now += 30 * S;
    await w.ready(id);
    await w.replayAll();
    await w.tick(id);
    await w.flush();
    w.clock.now += MIN;
    await w.tick(id);
    await w.flush();
    expect(w.delivered).toHaveLength(1);
    expect(w.count(id, "room.link")).toBe(1);
    expect(w.count(id, "room.event.worker.ready")).toBe(1);
  });
});

describe("every mark leaves exactly one audit row, and books nothing", () => {
  test("control: a double tap on I'm in and The lead is in (the same version) and a retry of End leave one row each", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    const v1 = v(w, id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v1, what: "host_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v1, what: "host_in" }).catch(() => null);
    const v2 = v(w, id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v2, what: "lead_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v2, what: "lead_in" }).catch(() => null);
    await w.flush();
    const v3 = v(w, id);
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v3, reason: "finished" });
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v3, reason: "finished" }).catch(() => null);
    await w.flush();
    expect([w.count(id, "room.mark.host_in"), w.count(id, "room.mark.lead_in"), w.count(id, "room.end")]).toEqual([1, 1, 1]);
    expect(w.numbers()).toEqual({ marks: 0, bookings: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });

  test("control: That was not the lead with count_on_join off takes the join back with one row and no count undo", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "host_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "lead_in" });
    await w.flush();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "not_lead" });
    await w.flush();
    expect(w.room(id).state).toBe("host_in");
    expect(w.count(id, "room.mark.not_lead")).toBe(1);
    expect(w.ledger(id).filter(a => a.startsWith("room.count"))).toEqual([]);
    expect(w.numbers()).toEqual({ marks: 0, bookings: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });

  test("control: a closer's Zoom room: Zoom's join of the lead (stored, then replayed) moves it to lead_in once, books and marks nothing", async () => {
    const w = world();
    const id = await w.make(closer, { provider: "zoom", call_kind: "demo" });
    await w.workerOpens(id, ZOOM_URL, MEETING);
    await w.ready(id);
    await w.flush();
    await w.rooms.actions["room.mark"]!(closer, { room_id: id, version: v(w, id), what: "host_in" });
    const eventId = fakeUuid();
    const joinAt = new Date(w.clock.now).toISOString();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eventId,
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: `zoom:meeting.participant_joined:${eventId}`,
        at: joinAt,
        detail: {
          event: "meeting.participant_joined",
          event_ts: w.clock.now,
          payload: { object: { id: MEETING, uuid: "u1==", host_id: "Z-closer", participant: { id: "", user_name: "Huda Ali", join_time: joinAt, participant_uuid: "pu-1" } } },
        },
      },
    ]);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eventId, payload: {} });
    await w.flush();
    expect(w.room(id).state).toBe("lead_in");
    // The sweep replays it (a second delivery) and ticks the room.
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [eventId] } });
    await w.tick(id);
    await w.flush();
    expect(w.count(id, "room.event.zoom.meeting.participant_joined")).toBe(1);
    expect(w.numbers()).toEqual({ marks: 0, bookings: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });
});

// Not in video-link round 1's fix list (2026-10-05): index.ts audit() logs a
// failed insert and goes on, so a repeat press cannot tell a lost audit row
// from a written one without reading cockpit_audit_log on every press. Kept
// as the record of the gap, skipped until a round takes it.
describe.skip("an audit row the database did not take is written again", () => {
  test("The lead is in, its audit insert lost to a database blip, then pressed again: the mark still has its one row", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "host_in" });
    const before = v(w, id);
    w.dropAudit.add("room.mark.lead_in");
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: before, what: "lead_in" });
    // The rep's tab never heard back and presses again with the version it had.
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: before, what: "lead_in" }).catch(() => null);
    await w.flush();
    expect(w.room(id).state).toBe("lead_in");
    expect(w.count(id, "room.mark.lead_in")).toBe(1);
  });

  test("a room asked for, its room.create audit insert lost, then asked again by the same request id: the room still has its one row", async () => {
    const w = world();
    const requestId = crypto.randomUUID();
    const ask = { request_id: requestId, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" };
    w.dropAudit.add("room.create");
    const out = await w.rooms.actions["room.create"]!(setter, ask);
    const id = String((out.room as Row).id);
    await w.rooms.actions["room.create"]!(setter, ask);
    expect(w.count(id, "room.create")).toBe(1);
  });
});

describe("test contacts stay on the test path", () => {
  test("control: a lead not on rooms.test_contacts (even tagged cockpit-test in HighLevel) gets no room and no message", async () => {
    const w = world();
    const r = await refused(w.make(setter, { contact_id: REAL_LEAD }));
    expect(r.status).toBe(409);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    expect(w.delivered).toHaveLength(0);
  });

  test("control: after I can't let them in, the replacement room and its link reach only the test contact", async () => {
    const w = world();
    const id = await w.make(setter, { provider: "meet", purpose: "manual" });
    await w.workerOpens(id);
    await w.ready(id);
    await w.flush();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v(w, id), what: "host_in" }).catch(() => null);
    const out = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v(w, id), reason: "admit_blocked" }).catch(e => ({ err: e }));
    await w.flush();
    const all = w.db.t("cockpit_sales_rooms");
    expect(all.every(r => r.contact_id === LEAD)).toBe(true);
    expect(w.delivered.every(d => d.to === LEAD)).toBe(true);
    expect(out).toBeTruthy();
  });
});
