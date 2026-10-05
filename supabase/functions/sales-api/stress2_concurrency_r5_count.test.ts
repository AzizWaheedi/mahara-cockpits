// bun test supabase/functions/sales-api/stress2_concurrency_r5_count.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. Two live
// counts of one room, the first one's claim taken back while it was still
// booking, the second one's claim standing.
//
// The lead's assistant joins the setter's Zoom room first (Zoom sees a
// guest, the panel says "the lead is in") and the live count starts: its
// claim C1 lands and it asks HighLevel for the "Live · Huda" booking. That
// POST is slow (HighLevel's answer takes a few seconds; the cockpit, the
// mirror and the desk share one location). Inside those seconds:
//   1. the setter, seeing the name, presses "That was not the lead": the
//      count is in flight, so notLead writes count_result undone at once
//      (roomlogic notLead) and the room waits for the lead again;
//   2. Huda herself joins (Zoom's webhook): the room is lead_in again, and
//      a second count claims C2 (countClaimable: undone), books "Live ·
//      Huda" and writes booked.
// Then the first count's POST answers. Its own result write misses (its
// claim C1 is not the room's any more), so countResult takes back what it
// made, and then writes count_result "undone" guarded on the room as it
// reads it NOW (cur.count_claimed_at = C2, cur.count_result = booked), not
// on its own claim. That write lands on the second count: the room says the
// count was taken back while Huda's real booking stands in HighLevel and in
// the cockpit's calendar copy. The minute's re-ask then counts the join
// again (count_result undone and the lead joined).
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel, Zoom, Google or Slack; every lead and figure is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { GhlError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c5-000001";
const MEETING = "81234500095";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  count_on_join: true,
  test_calendar_id: "TESTCAL",
  live_calendar_id: "LIVECAL",
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

/** A gate: the first live-booking POST waits on it (HighLevel's slow answer). */
function gate() {
  let open!: () => void;
  const p = new Promise<void>(r => {
    open = r;
  });
  return { p, open };
}

function setup() {
  const w = fakeWorld();
  const hl = new Map<string, Row>();
  const posts: string[] = [];
  const first = gate();
  let firstPostSeen: (() => void) | null = null;
  const firstPostArrived = new Promise<void>(r => {
    firstPostSeen = r;
  });
  const jobs: Promise<unknown>[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.routes.push(async (m, p, body) => {
    const b = (body ?? {}) as Row;
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [...hl.values()] };
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `live-${fakeUuid()}`;
      hl.set(id, { id, ...b });
      posts.push(id);
      if (posts.length === 1) {
        // HighLevel made it; its answer is on its way (slow).
        firstPostSeen?.();
        await first.p;
      }
      return { id };
    }
    const del = /^\/calendars\/events\/([^/?]+)$/.exec(p);
    if (del && m === "DELETE") {
      const id = decodeURIComponent(del[1] as string);
      if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
      hl.delete(id);
      return { ok: true };
    }
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
      if (m === "GET") return { appointment: { ...hl.get(id) } };
      if (m === "PUT") {
        hl.set(id, { ...(hl.get(id) as Row), ...b });
        return { ok: true };
      }
    }
    return null as unknown as Row;
  });
  const io: LiveIO = {
    ...w.io,
    background: p => {
      jobs.push(p);
      w.io.background(p);
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async (_who, action, _t, id, _b, after) => {
      w.db.t("audit").push({ action, id, after });
    },
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /** Waits for every background job started from `from` on, except those still held at the gate. */
  async function settleFrom(from: number, skip: Set<Promise<unknown>>): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const now = jobs.slice(from).filter(j => !skip.has(j));
      await Promise.allSettled(now);
      if (jobs.slice(from).filter(j => !skip.has(j)).length === now.length) return;
    }
  }
  return { ...w, rooms, room, hl, posts, first, firstPostArrived, jobs, settleFrom };
}

/** The door's stored Zoom join of someone outside the team, then room.event for it. */
async function zoomJoin(w: ReturnType<typeof setup>, id: string, name: string, uuid: string, at: number): Promise<void> {
  const eventId = fakeUuid();
  const detail = {
    event: "meeting.participant_joined",
    event_ts: at,
    payload: { object: { id: MEETING, uuid: "u1==", host_id: "Z-setter", participant: { id: "", user_name: name, join_time: new Date(at).toISOString(), participant_uuid: uuid } } },
  };
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
      kind: "zoom.meeting.participant_joined",
      source: "zoom",
      dedupe_key: `zoom:meeting.participant_joined:${eventId}`,
      at: new Date(at).toISOString(),
      text: "Zoom: someone joined.",
      detail,
    },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eventId, payload: {} });
}

/** The setter's lead-page Zoom room, made and opened, its link gone, the setter in. */
async function hostedRoom(w: ReturnType<typeof setup>): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: ZOOM_URL,
      provider_meeting_id: MEETING,
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), link_claimed_at: w.db.iso(), first_open_at: w.db.iso() } });
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
  await w.flush();
  return id;
}

describe("two counts of one room: the first one's claim taken back while it was booking", () => {
  test("stale-count-takeback-undoes-next-claim: the assistant's join is being booked (HighLevel slow); That was not the lead, then Huda's own join is counted and booked; the first count's late answer must not mark Huda's standing booking as taken back", async () => {
    const w = setup();
    const id = await hostedRoom(w);
    // 14:03 the assistant joins: Zoom sees a guest outside the team.
    const from = w.jobs.length;
    const t1 = w.clock.now;
    seedLeadZoomJoin(w.db, id, { at: new Date(t1).toISOString(), name: "Sara (assistant)" });
    await zoomJoin(w, id, "Sara (assistant)", "p-assistant", t1);
    expect(w.room(id).state).toBe("lead_in");
    // The first count claims and asks HighLevel for the booking; its answer is slow.
    await w.firstPostArrived;
    const c1 = String(w.room(id).count_claimed_at);
    expect(c1).not.toBe("null");
    const held = new Set(w.jobs.slice(from));
    // 1. The setter presses That was not the lead (the count is in flight).
    w.clock.now += 5 * S;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    expect(w.room(id).state).toBe("host_in");
    // 2. Huda herself joins; the second count claims, books and writes booked.
    w.clock.now += 5 * S;
    const mark = w.jobs.length;
    await zoomJoin(w, id, "Huda Ali", "p-huda", w.clock.now);
    await w.settleFrom(mark, held);
    const second = w.room(id);
    expect(second.state).toBe("lead_in");
    expect(String(second.count_claimed_at)).not.toBe(c1);
    expect(second.count_result).toBe("booked");
    const b2 = String(second.count_appointment_id);
    expect(w.hl.has(b2)).toBe(true);
    // 3. The first count's POST answers now.
    w.first.open();
    await w.flush();
    const r = w.room(id);
    const liveInHighLevel = [...w.hl.keys()].filter(k => k.startsWith("live-"));
    const copies = w.db.t("cockpit_sales_appointments").filter(a => String(a.appointment_id).startsWith("live-")).map(a => String(a.appointment_id));
    expect({
      room_count_result: r.count_result,
      room_booking: r.count_appointment_id,
      live_bookings_in_highlevel: liveInHighLevel,
      copies_in_cockpit_calendar: copies,
    }).toEqual({
      room_count_result: "booked",
      room_booking: b2,
      live_bookings_in_highlevel: [b2],
      copies_in_cockpit_calendar: [b2],
    });
  });

  test("stale-count-takeback-then-reask-books-twice: the same race, then the minute's re-ask (the tick): one conversation must leave exactly one live booking standing in HighLevel", async () => {
    const w = setup();
    const id = await hostedRoom(w);
    const from = w.jobs.length;
    const t1 = w.clock.now;
    seedLeadZoomJoin(w.db, id, { at: new Date(t1).toISOString(), name: "Sara (assistant)" });
    await zoomJoin(w, id, "Sara (assistant)", "p-assistant", t1);
    await w.firstPostArrived;
    const held = new Set(w.jobs.slice(from));
    w.clock.now += 5 * S;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    w.clock.now += 5 * S;
    const mark = w.jobs.length;
    await zoomJoin(w, id, "Huda Ali", "p-huda", w.clock.now);
    await w.settleFrom(mark, held);
    w.first.open();
    await w.flush();
    // The sweep's minute: the tick re-asks whatever the room says is owed.
    for (let i = 0; i < 3; i++) {
      w.clock.now += MIN;
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.flush();
    }
    const liveInHighLevel = [...w.hl.keys()].filter(k => k.startsWith("live-"));
    const r = w.room(id);
    expect({
      live_bookings_in_highlevel: liveInHighLevel.length,
      room_points_at_a_standing_booking: liveInHighLevel.includes(String(r.count_appointment_id)),
      room_count_result: r.count_result,
    }).toEqual({ live_bookings_in_highlevel: 1, room_points_at_a_standing_booking: true, room_count_result: "booked" });
  });

  test("control: That was not the lead with no second join: the first count's late answer takes its own booking back and the room says undone", async () => {
    const w = setup();
    const id = await hostedRoom(w);
    const t1 = w.clock.now;
    seedLeadZoomJoin(w.db, id, { at: new Date(t1).toISOString(), name: "Sara (assistant)" });
    await zoomJoin(w, id, "Sara (assistant)", "p-assistant", t1);
    await w.firstPostArrived;
    w.clock.now += 5 * S;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    w.first.open();
    await w.flush();
    expect(w.room(id).count_result).toBe("undone");
    expect([...w.hl.keys()].filter(k => k.startsWith("live-"))).toEqual([]);
  });
});
