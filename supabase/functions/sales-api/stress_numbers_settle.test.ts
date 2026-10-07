// bun test supabase/functions/sales-api/stress_numbers_settle.test.ts
//
// Stress round 1, numbers and data integrity: the settle (D14, contract v2
// 0b.2), which writes a no-show into HighLevel for a booked intro whose room
// closed with nobody joining. A no-show is a hard number in the B2B show
// rate, so it may only be written on evidence that nobody came: never from a
// missing press ("missing is never zero"), never while the lead was in another
// room for the same call, and once however many sweeps ask. Everything runs
// on testfakes.ts.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, settleWanted } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-0000000002";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };

function setup(rooms: Row = {}) {
  const w = fakeWorld();
  const marks: Row[] = [];
  const audits: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, settle: true, wrap: true, enabled: true, test_only: false, providers: { zoom: true, meet: true }, fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" }, ...rooms } },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: {} },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  const start = w.clock.now; // the intro starts now
  w.db.seed("cockpit_sales_appointments", [
    { appointment_id: "intro-1", contact_id: LEAD, call_type: "intro", calendar_id: BOOKING_CALENDARS.intro_qualified, status: "confirmed", start_at: new Date(start).toISOString(), assigned_user_id: "G-setter" },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"] } };
    if (m === "PUT" || m === "DELETE") return { ok: true };
    if (m === "POST") return { id: "live-x" };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status });
      const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (current && current.status === status) return { ...current, repeated: true };
      if (current) current.superseded_at = w.db.iso();
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null });
      return {};
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const api = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /** A closed fallback room for the booked intro, as the sweep leaves it. */
  function closedRoom(over: Row): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: "intro-1",
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        join_url: MEET_URL,
        requested_at: new Date(start + 1 * MIN).toISOString(),
        opened_at: new Date(start + 1 * MIN).toISOString(),
        link_sent_at: new Date(start + 2 * MIN).toISOString(),
        ended_at: new Date(start + 15 * MIN).toISOString(),
        version: 4,
        ...over,
      },
    ]);
    return id;
  }
  /** The SQL sweep's S1 event, posted to room.event as sweep.settle by the tick. */
  async function settle(ids: string[], at = start + 21 * MIN) {
    for (const id of ids)
      w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due to be settled." }, "ignore", "dedupe_key");
    w.clock.now = at;
    const out = await api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: ids } });
    await w.flush();
    return out;
  }
  const noshows = () => marks.filter(m => m.status === "noshow");
  return { ...w, api, marks, audits, room, closedRoom, settle, noshows, start };
}

// ---------------------------------------------------------------------------

describe("a no-show is written only on evidence that nobody came", () => {
  test("a Meet room the lead opened, with the setter in it, and no 'The lead is in' press: not a no-show", async () => {
    const w = setup();
    // Meet sends no join signal: the only one is the setter's press (updates.md 3, D6). The lead opened
    // the link at +3 min, the setter was in at +2 min, they talked; nobody pressed. R4 closed it no_join.
    const id = w.closedRoom({
      provider: "meet",
      host_in_at: new Date(w.start + 2 * 60_000).toISOString(),
      first_open_at: new Date(w.start + 3 * 60_000).toISOString(),
      last_open_at: new Date(w.start + 3 * 60_000).toISOString(),
      open_device: "phone",
    });
    await w.settle([id]);
    expect(w.noshows()).toHaveLength(0);
  });

  test("the pure rule agrees: settleWanted is false for a Meet room the lead opened and nobody marked", () => {
    const w = setup();
    const id = w.closedRoom({ provider: "meet", host_in_at: new Date(w.start + 2 * 60_000).toISOString(), first_open_at: new Date(w.start + 3 * 60_000).toISOString() });
    const r = w.room(id) as never;
    expect(settleWanted(r, new Date(w.start).toISOString(), false, w.start + 21 * 60_000, DEFAULT_ROOMS_JSON.waits_s as never)).toBe(false);
  });

  test("the lead joined a second room for the same intro (the first link ran out): the first room's settle writes no no-show", async () => {
    const w = setup(); // count_on_join is off, as shipped: the join in room B marks nothing
    const a = w.closedRoom({ provider: "zoom", join_url: ZOOM_URL });
    w.closedRoom({
      provider: "zoom",
      join_url: ZOOM_URL,
      state: "ended",
      result: "joined",
      end_reason: null,
      requested_at: new Date(w.start + 16 * 60_000).toISOString(),
      host_in_at: new Date(w.start + 17 * 60_000).toISOString(),
      lead_in_at: new Date(w.start + 18 * 60_000).toISOString(),
      ended_at: new Date(w.start + 40 * 60_000).toISOString(),
    });
    await w.settle([a], w.start + 41 * 60_000);
    expect(w.noshows()).toHaveLength(0);
  });

  test("a rep's own showed mark survives a mistaken 'That was not the lead' and is never settled into a no-show", async () => {
    const w = setup({ count_on_join: true });
    // The setter reached the lead by phone and marked the intro shown in the dialer.
    w.db.t("cockpit_sales_dispositions").push({ id: "rep-mark", appointment_id: "intro-1", status: "showed", marked_by: SETTER, superseded_at: null });
    (w.db.t("cockpit_sales_appointments")[0] as Row).status = "showed";
    const out = await w.api.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "intro", purpose: "fallback", appointment_id: "intro-1", trigger: "no_answer" });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "open", join_url: ZOOM_URL, opened_at: w.db.iso(), version: Number(w.room(id).version) + 1 } });
    await w.api.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    await w.api.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    // The mirror catches up with HighLevel (the undo wrote "confirmed"); the room then closes empty.
    const put = w.ghlCalls.filter(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-1").at(-1);
    if (put) (w.db.t("cockpit_sales_appointments")[0] as Row).status = (put.body as Row).appointmentStatus;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "expired", result: "no_join", lead_in_at: null } });
    await w.settle([id], w.start + 30 * 60_000);
    expect(w.noshows()).toHaveLength(0);
  });
});

describe("a test contact never moves an official number", () => {
  test("a test contact's booked intro on a B2B calendar is never settled into a no-show (C34: the count refuses to mark it too)", async () => {
    const w = setup({ test_contacts: [LEAD] });
    const id = w.closedRoom({ provider: "zoom", join_url: ZOOM_URL });
    await w.settle([id]);
    expect(w.noshows()).toHaveLength(0);
  });
});

describe("a settle is written once, and never for a room the lead knocked on", () => {
  test("fifty sweep.settle posts for one room at once mark one no-show", async () => {
    const w = setup();
    const id = w.closedRoom({ provider: "zoom", join_url: ZOOM_URL });
    // Zoom reported the meeting (its start, read by room.event): its silence about the lead is evidence.
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(w.start + 2 * 60_000).toISOString(), handled_at: new Date(w.start + 2 * 60_000).toISOString() },
    ]);
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    w.clock.now = w.start + 21 * 60_000;
    await Promise.all(Array.from({ length: 50 }, () => w.api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } })));
    await w.flush();
    expect(w.noshows()).toHaveLength(1);
    expect(w.room(id).settled_mark).toBe("noshow");
    expect(w.audits.filter(a => a.action === "room.settle")).toHaveLength(1);
  });

  test("a room closed admit_blocked (the lead knocked) and a Zoom room the lead joined are never settled", async () => {
    const w = setup();
    const knocked = w.closedRoom({ provider: "zoom", join_url: ZOOM_URL, result: "admit_blocked", end_reason: "not_admitted", lead_waiting_at: new Date(w.start + 4 * 60_000).toISOString() });
    const joined = w.closedRoom({ provider: "zoom", join_url: ZOOM_URL, state: "ended", result: "joined", lead_in_at: new Date(w.start + 4 * 60_000).toISOString() });
    await w.settle([knocked, joined]);
    expect(w.noshows()).toHaveLength(0);
  });

  test("a settle that is not due yet writes nothing and leaves the event for the next sweep", async () => {
    const w = setup();
    const id = w.closedRoom({ provider: "zoom", join_url: ZOOM_URL });
    await w.settle([id], w.start + 10 * 60_000);
    expect(w.noshows()).toHaveLength(0);
  });
});
