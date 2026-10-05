// bun test supabase/functions/sales-api/stress2_time_r5_settle_edge.test.ts
//
// TIME stress, second series, round 5: the last minute of a booked intro's
// window, one second either side of start + settle.
//
// Thursday 8 October, the setter's 10:00 intro. 10:00 no answer, a Zoom
// fallback room A at 10:01 (it carries the intro), nobody opened it, R4
// closed it at 10:15. The dialer brings the intro back ("Intro call now" runs
// to 10:20, dialer.ts introWindow). 10:19:15 the setter rings again; no
// answer; Maqsam's record saves it as No answer at 10:19:55 (DialerPage
// useCallStatus), and the step after the miss offers Send a video link
// (automatic mode sends it ten seconds later, VideoLink).
//
// Two clocks meet here. The sweep's S1 posts room A's settle once start +
// settle (10:20:00) has passed; sales-api waits only while a call to the lead
// is still dialing or placed (roomlogic phoneSince "open"), and the attempt
// was saved five seconds before. And room.create judges whether a room is the
// intro's by the moment of the press (rooms.ts introNow), not by the call it
// follows: a press at 10:19:59 makes the intro's room, one at 10:20:01 a
// plain room for the lead.
//
// A test that fails here is a finding. Everything runs on testfakes.ts.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter-t2r5e@stress.invalid";
const LEAD = "stress-t2r5-edge-000001";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** Thursday 8 October 2026, 10:00 Kuwait. */
const START = Date.parse("2026-10-08T07:00:00.000Z");
const at = (m: number, s = 0) => START + m * MIN + s * S;
const iso = (t: number) => new Date(t).toISOString();

function setup() {
  const w = fakeWorld(START);
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: false, email: false },
        // As it ships: a video link for a lead with a booked intro.
        // Settling and automatic mode on: this file is about them (both ship off, Milestone 1).
        settle: true,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: true },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-1000",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: iso(START),
      booked_at: iso(START - 3 * 24 * 60 * MIN),
      assigned_user_id: "G-setter",
    },
  ]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(START - 2 * 60 * MIN) }]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status, at: w.clock.now });
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "written" });
      return { crm: "written" };
    },
    sendText: async (_who, b) => ({ message: { id: fakeUuid(), request_id: b.request_id, state: "sent", ghl_message_id: "m-1", created_at: iso(w.clock.now) } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const api = makeRooms(deps);
  // Room A: the intro's own room from the 10:00 miss, closed by R4 at 10:15 with nobody in it.
  const roomA = fakeUuid();
  w.db.seed("cockpit_sales_rooms", [
    {
      id: roomA,
      request_id: fakeUuid(),
      code: "AAAAAA",
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      provider: "zoom",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: "intro-1000",
      appointment_start_at: iso(START),
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      join_url: ZOOM_URL,
      provider_meeting_id: "81234567890",
      requested_at: iso(at(1)),
      opened_at: iso(at(1)),
      link_sent_at: iso(at(1, 5)),
      link_channels: ["whatsapp_text"],
      host_in_at: iso(at(2)),
      ended_at: iso(at(15)),
      version: 4,
    },
  ]);
  w.db.seed("cockpit_sales_room_events", [
    { room_id: roomA, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${roomA}`, at: iso(at(2)), handled_at: iso(at(2)) },
  ]);
  // The second try at the intro: rang 10:19:15, saved as No answer from Maqsam's record at 10:19:55.
  const attempt = fakeUuid();
  w.db.seed("cockpit_sales_attempts", [
    {
      id: attempt,
      contact_id: LEAD,
      rep_email: SETTER,
      appointment_id: "intro-1000",
      item_kind: "intro",
      state: "saved",
      outcome: "no_answer",
      call_state: "no_answer",
      call_duration_s: 0,
      started_at: iso(at(19, 15)),
      saved_at: iso(at(19, 55)),
    },
  ]);
  async function settleA(t: number) {
    w.db.insertOne(
      "cockpit_sales_room_events",
      { room_id: roomA, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${roomA}`, text: "Due." },
      "ignore",
      "dedupe_key",
    );
    w.clock.now = t;
    await api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [roomA] } });
    await w.flush();
  }
  async function linkAfterSecondMiss(t: number): Promise<Row> {
    w.clock.now = t;
    const out = await api.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "fallback",
      provider: "zoom",
      call_kind: "intro",
      trigger: "auto",
      attempt_id: attempt,
      appointment_id: "intro-1000",
      item_kind: "intro",
    });
    const id = String((out.room as Row).id);
    return w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  }
  /** The room worker: claims, makes the meeting, stores worker.ready, opens the room (contract v2 section 7). */
  async function workerOpens(id: string) {
    const r = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-b", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-b" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    const r2 = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-b`, {
      method: "PATCH",
      body: { state: "open", join_url: "https://us06web.zoom.us/j/89999999999?pwd=b", provider_meeting_id: "89999999999", opened_at: w.db.iso(), version: Number(r2.version) + 1 },
    });
    await api.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
  }
  const noshows = () => marks.filter(m => m.status === "noshow");
  return { ...w, api, settleA, linkAfterSecondMiss, workerOpens, noshows, roomA };
}

describe("10:19:55 the second try at the 10:00 intro is saved No answer; the link step follows", () => {
  test("the settle at 10:20:01 does not mark the intro a no-show in the seconds before the setter's video link", async () => {
    const w = setup();
    await w.settleA(at(20, 1));
    // Found: the no-show is written at 10:20:01 (the attempt is saved, so
    // "a call to the lead is under way" no longer holds, and the second room
    // does not exist yet). The link goes at 10:20:05 and the lead joins it.
    expect(w.noshows()).toEqual([]);
  });

  test("the room for that missed call carries the intro whether the link is pressed at 10:19:59 or 10:20:01", async () => {
    const before = await setup().linkAfterSecondMiss(at(19, 59));
    const after = await setup().linkAfterSecondMiss(at(20, 1));
    // Found: 10:19:59 -> appointment_id intro-1000 (the lead reads "I just
    // tried to call you for your intro call", and the room holds the settle
    // until it closes); 10:20:01 -> null (a plain room: "I tried to call you
    // just now", and the first room's settle goes ahead beside it).
    expect({ before: before.appointment_id ?? null, after: after.appointment_id ?? null }).toEqual({
      before: "intro-1000",
      after: "intro-1000",
    });
  });

  test("the whole minute: the no-show at 10:20:01, the link at 10:20:05, the lead in at 10:22; the intro still reads no-show", async () => {
    const w = setup();
    await w.settleA(at(20, 1));
    const b = await w.linkAfterSecondMiss(at(20, 5));
    await w.workerOpens(String(b.id));
    // The lead opens the link and joins room B; the setter presses I'm in and The lead is in at 10:22.
    w.clock.now = at(22);
    const v1 = (w.db.t("cockpit_sales_rooms").find(r => r.id === b.id) as Row).version;
    await w.api.actions["room.mark"]!(setter, { room_id: b.id, version: v1, what: "host_in" });
    const v2 = (w.db.t("cockpit_sales_rooms").find(r => r.id === b.id) as Row).version;
    await w.api.actions["room.mark"]!(setter, { room_id: b.id, version: v2, what: "lead_in" });
    await w.flush();
    const roomB = w.db.t("cockpit_sales_rooms").find(r => r.id === b.id) as Row;
    const intro = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-1000" && !d.superseded_at);
    expect(roomB.state).toBe("lead_in");
    // Found: the intro is a no-show in HighLevel (written quietly at 10:20:01)
    // while the lead is on video with the setter for it; room B carries no
    // appointment, so nothing in it ever reads or changes that mark.
    expect({ intro: intro.map(d => d.status), carried: roomB.appointment_id ?? null }).toEqual({ intro: [], carried: "intro-1000" });
  });
});
