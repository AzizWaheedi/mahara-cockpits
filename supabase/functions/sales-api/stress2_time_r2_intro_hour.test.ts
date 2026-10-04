// bun test supabase/functions/sales-api/stress2_time_r2_intro_hour.test.ts
//
// TIME stress, second series, round 2: the hour before a booked intro, and
// the intro moved on the same morning.
//
// The dialer's confirmation of a call booked more than a day ahead runs from
// 18:00 the evening before (a morning call) up to the call's start, and in
// its last three hours it is a "call now" item (dialer.ts appointmentWork,
// tier 0). The intro item itself shows from five minutes before the start
// (dialer.ts introWindow). The dialer passes the intro's id with a video link
// made on either item (videoLink.ts videoAppointmentId: "intro" or
// "confirm"), and room.create keeps it on the room when the room is asked
// for inside inIntroWindow: from an HOUR before the start.
//
// index.ts candidates (lines 2938-2962) reads every room with an
// appointment id whose lead joined in the last three hours, and the dialer
// then never shows that intro as "Intro call now" (room_joined). It matches
// by the appointment id alone: not by when the intro starts now, nor by
// whether the join was inside the intro's own window.
//
// A test that fails here is a finding. Everything runs on testfakes.ts.
import { describe, expect, test } from "bun:test";
import { type Appt, appointmentWork, BOOKING_CALENDARS, roomJoinedFor } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, type RoomRow } from "./roomlogic.ts";
import { leadText, makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-time2r2-lead-000001";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** Sunday 11 October 2026 in Kuwait (UTC+3). */
const kw = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}:00+03:00`);
const INTRO = kw("10:00");

/**
 * index.ts candidates as it reads the joins since fix round 2: the rooms the
 * lead joined in the last three hours, then dialer.ts roomJoinedFor for the
 * call as it starts now.
 */
function joinedFor(rooms: Row[], now: number, appt: { id: string; start: number }): boolean {
  const ms = (v: unknown) => (v ? Date.parse(String(v)) : null);
  const roomJoins = rooms.filter(r => r.appointment_id != null && (ms(r.lead_in_at) ?? 0) >= now - 3 * 3_600_000);
  return roomJoinedFor(roomJoins, appt);
}

function setup() {
  const w = fakeWorld(kw("08:00"));
  const sent: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: false, email: false },
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  // Booked on Thursday for Sunday 10:00 (more than a day ahead: the dialer confirms it).
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-sun",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: new Date(INTRO).toISOString(),
      booked_at: new Date(INTRO - 3 * 24 * HOUR).toISOString(),
      assigned_user_id: "G-setter",
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who, b) => {
      sent.push(b as Row);
      return { message: { id: fakeUuid(), state: "sent" } };
    },
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room, sent };
}

/** The dialer's view of the Sunday intro at `now` (index.ts candidates' appt). */
function introAppt(w: ReturnType<typeof setup>, now: number): Appt {
  const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === "intro-sun") as Row;
  return {
    id: "intro-sun",
    type: "intro",
    start: Date.parse(String(a.start_at)),
    booked: Date.parse(String(a.booked_at)),
    status: String(a.status),
    assigned: "G-setter",
    confirmed: true,
    last_try: null,
    room_joined: joinedFor(w.db.t("cockpit_sales_rooms"), now, { id: "intro-sun", start: Date.parse(String(a.start_at)) }),
  };
}

describe("Sunday 09:05: the setter's confirmation call for the 10:00 intro (tier 0 'Confirm the intro today at 10:00'), no answer, a video link", () => {
  test("setup: the dialer offers the confirmation, not the intro, at 09:05", () => {
    const a: Appt = { id: "intro-sun", type: "intro", start: INTRO, booked: INTRO - 72 * HOUR, status: "confirmed", assigned: "G-setter", confirmed: false, last_try: null };
    const job = appointmentWork(a, kw("09:05"), "setter", "G-setter");
    expect(job?.kind).toBe("confirm");
    expect(job?.tier).toBe(0);
  });

  test("the confirmation call's room does not carry the intro (it is not the intro's own call: the intro rings at 10:00)", async () => {
    const w = setup();
    w.clock.now = kw("09:05");
    // DialerPage: kind "confirm", appt intro -> videoAppointmentId gives the intro's id.
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      provider: "meet",
      call_kind: "intro",
      appointment_id: "intro-sun",
    });
    const id = String((out.room as Row).id);
    // What the lead's WhatsApp says for this room (rooms.ts sendLink -> leadText).
    const words = leadText(w.room(id) as unknown as RoomRow, "whatsapp_text", { first_name: "Huda", rep: "Tara", link: "https://call.example/K7Q2MX" }).body;
    // At 09:05 the lead is told "I just tried to call you for your intro call
    // and couldn't get through. We can do it on video now instead", 55
    // minutes before the intro they booked for 10:00.
    expect(words).not.toContain("your intro call");
    expect(w.room(id).appointment_id ?? null).toBeNull();
  });

  test("the lead joins that room at 09:08 to confirm; at 09:56 the dialer still puts 'Intro call now' at the top for the 10:00 intro", async () => {
    const w = setup();
    w.clock.now = kw("09:05");
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      provider: "meet",
      call_kind: "intro",
      appointment_id: "intro-sun",
    });
    const id = String((out.room as Row).id);
    // 09:08 the lead is in ("yes, talk at 10"); 09:11 the setter ends the room.
    Object.assign(w.room(id), {
      state: "ended",
      result: "lead_joined",
      lead_in_at: new Date(kw("09:08")).toISOString(),
      ended_at: new Date(kw("09:11")).toISOString(),
    });
    const now = kw("09:56");
    const job = appointmentWork(introAppt(w, now), now, "setter", "G-setter");
    // Found: room_joined is true (a join 48 minutes ago on a room with the
    // intro's id), so the 10:00 intro never comes up and nobody rings the
    // lead who just confirmed it.
    expect(job?.kind).toBe("intro");
  });
});

describe("fix round 2: the dialer says which item the room is for", () => {
  test("a confirmation item's room at 09:57 (inside the intro's five minutes) never carries the intro; the intro item's does", async () => {
    const w = setup();
    w.clock.now = kw("09:57");
    const ask = (item_kind: string) =>
      w.rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: "fallback",
        trigger: "no_answer",
        provider: "meet",
        call_kind: "intro",
        appointment_id: "intro-sun",
        item_kind,
      });
    const confirmRoom = String(((await ask("confirm")).room as Row).id);
    expect(w.room(confirmRoom).appointment_id ?? null).toBeNull();
    // The rep ends it; the intro item's own room carries the intro.
    Object.assign(w.room(confirmRoom), { state: "cancelled", result: "cancelled" });
    const introRoom = String(((await ask("intro")).room as Row).id);
    expect(w.room(introRoom).appointment_id).toBe("intro-sun");
  });
});

describe("Sunday: the lead joins the intro's own video room at 10:02 and asks for 11:30; the setter moves the intro (same id) to 11:30", () => {
  test("at 11:26 the dialer puts the moved intro up as 'Intro call now'", async () => {
    const w = setup();
    w.clock.now = kw("10:00") + 30 * S;
    // 10:00 rang out; the setter's video link for the intro (inside its own window).
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      provider: "meet",
      call_kind: "intro",
      appointment_id: "intro-sun",
    });
    const id = String((out.room as Row).id);
    expect(w.room(id).appointment_id).toBe("intro-sun");
    expect(w.room(id).appointment_start_at).toBe(new Date(INTRO).toISOString());
    // 10:02 the lead is in: "I'm driving, can we do 11:30?". 10:04 ended.
    Object.assign(w.room(id), {
      state: "ended",
      result: "lead_joined",
      lead_in_at: new Date(kw("10:02")).toISOString(),
      ended_at: new Date(kw("10:04")).toISOString(),
    });
    // 10:05 the setter moves the intro in the dialer (book.move, same id), and
    // B2B's mirror has it by 10:08.
    const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === "intro-sun") as Row;
    a.start_at = new Date(kw("11:30")).toISOString();
    const now = kw("11:26");
    const job = appointmentWork(introAppt(w, now), now, "setter", "G-setter");
    // Found: the 10:02 join is inside the last three hours and carries the
    // same appointment id, so the moved 11:30 intro is read as already had.
    expect(job?.kind).toBe("intro");
    expect(job?.tier).toBe(0);
  });

  test("control: moved to the afternoon (16:00, more than three hours on), the intro comes up", async () => {
    const w = setup();
    w.db.seed("cockpit_sales_rooms", [
      {
        id: fakeUuid(),
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "fallback",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        appointment_id: "intro-sun",
        appointment_start_at: new Date(INTRO).toISOString(),
        state: "ended",
        result: "lead_joined",
        lead_in_at: new Date(kw("10:02")).toISOString(),
        requested_at: new Date(kw("10:00")).toISOString(),
      },
    ]);
    const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === "intro-sun") as Row;
    a.start_at = new Date(kw("16:00")).toISOString();
    const now = kw("15:56");
    expect(appointmentWork(introAppt(w, now), now, "setter", "G-setter")?.kind).toBe("intro");
  });
});

void desk;
