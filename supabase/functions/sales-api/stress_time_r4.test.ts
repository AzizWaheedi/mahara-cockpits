// TIME stress, round 4 (sales-api): rooms.ts against testfakes.ts on a fake
// clock, at the edges a real day puts in front of it: I'm available pressed in
// the last minutes of the live window, and a booked call wrapped from
// HighLevel's own answer. The SQL side of round 4 (whole days of the sweep and
// the watchdog) is supabase/migrations/tests/stress_time_r4.py; the panel's
// side is apps/sales-cockpit/src/lib/stress_time_r4.test.ts.
//
//     bun test supabase/functions/sales-api/stress_time_r4.test.ts
//
// A test that fails here is a finding: its name says what should hold.

import { describe, expect, test } from "bun:test";
import { ghlTime } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, DEFAULT_WAITS } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { HOURS_COPY, hoursRefusal } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;
const S = 1000;
const MIN = 60 * S;
const iso = (t: number) => new Date(t).toISOString();
const CLOSER = "closer-r4@stress.invalid";
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer-r4" };
const LIVE_HOURS = { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" };
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];

function world(startIso: string) {
  const w = fakeWorld(Date.parse(startIso));
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: true, standby: true, closer_wait_s: 120, hours: LIVE_HOURS } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer-r4", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer-r4", zoom_status: "licensed", google_ok: true }]);
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({}),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  } as unknown as RoomDeps;
  return { w, rooms: makeRooms(deps) };
}

const liveStandby = (w: ReturnType<typeof fakeWorld>) =>
  w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby" && LIVE.includes(String(r.state)));

// ---------------------------------------------------------------------------
// 1. I'm available in the live window's last minutes
// ---------------------------------------------------------------------------

describe("I'm available pressed in the last minutes of the live window (Thursday, the window ends at 20:00 Kuwait)", () => {
  // Available is capped at the window's end, so a press at 19:57:30 is
  // Available for 150 s. The sweep's R5 asks for a fresh standby room only
  // while Available lasts longer than standby_host (300 s): a room the host
  // has no time to come into is a Zoom meeting for nobody, closed by R8
  // (host_away) a minute or two later, and a strip that says Ready for 150 s.
  test("19:57:30, 150 s of Available left: no standby room is asked for (the same rule as the sweep's fresh room)", async () => {
    const { w, rooms } = world("2026-10-08T16:57:30.000Z");
    const out = (await rooms.actions["live.availability"]!(closer, { state: "available" })) as Row;
    const until = Date.parse(String((w.db.t("cockpit_sales_availability")[0] ?? {}).until));
    expect(until - w.clock.now).toBe(150 * S);
    expect({
      standby_rooms: liveStandby(w).length,
      fewer_than_standby_host_left: until - w.clock.now < DEFAULT_WAITS.standby_host * S,
      standby_error: out.standby_error ?? null,
    }).toEqual({ standby_rooms: 0, fewer_than_standby_host_left: true, standby_error: expect.any(String) });
  });

  test("control: 19:50, ten minutes left, the standby room is asked for", async () => {
    const { w, rooms } = world("2026-10-08T16:50:00.000Z");
    await rooms.actions["live.availability"]!(closer, { state: "available" });
    expect(liveStandby(w).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. room.wrap from HighLevel's own answer
// ---------------------------------------------------------------------------

describe("room.wrap of a booked demo at 15:00 Kuwait, pressed at 14:35, from HighLevel's appointment", () => {
  // rooms.ts reads the same endpoint (GET /calendars/events/appointments/{id})
  // through ghlTime when it checks a move (ghlAppointment), because HighLevel
  // writes the sub-account's wall time with no zone in some answers
  // ("2026-09-24 16:00:00", Kuwait; dialer.ts ghlTime). room.wrap hands the
  // same field to wrapPlan, which reads it with Date.parse: on the Edge
  // runtime's UTC clock a wall time with no zone is three hours late.
  const LEAD = "stress-r4-wrap-lead";
  const START_UTC = Date.parse("2026-10-08T12:00:00.000Z"); // 15:00 Kuwait

  async function wrapWith(startTime: string, endTime: string) {
    const { w, rooms } = world("2026-10-08T11:35:00.000Z"); // 14:35 Kuwait
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "appt-r4", contact_id: LEAD, call_type: "demo", start_at: iso(START_UTC), status: "confirmed", assigned_user_id: "G-closer-r4" },
    ]);
    w.routes.push((m, p) => {
      if (m === "GET" && p === "/calendars/events/appointments/appt-r4")
        return {
          appointment: {
            id: "appt-r4",
            contactId: LEAD,
            startTime,
            endTime,
            address: "https://us06web.zoom.us/j/81234567890?pwd=abc",
            assignedUserId: "G-closer-r4",
          },
        };
      if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { id: LEAD, firstName: "Huda", tags: [] } };
      return null as unknown as Row;
    });
    try {
      const out = (await rooms.actions["room.wrap"]!(closer, { appointment_id: "appt-r4", request_id: crypto.randomUUID() })) as Row;
      const stored = w.db.t("cockpit_sales_rooms").find(r => r.id === (out.room as Row).id) as Row;
      return { refused: null as string | null, host_by: String(stored.host_by), ends_at: String(stored.ends_at) };
    } catch (e) {
      return { refused: String((e as Error).message), host_by: null, ends_at: null };
    }
  }

  test("the field as HighLevel's wall time is the same instant ghlTime reads (the setup)", () => {
    expect(ghlTime("2026-10-08 15:00:00")).toBe(START_UTC);
  });

  test("a wall time with no zone (as ghlTime reads it elsewhere in rooms.ts): wrapped, host by 15:15 Kuwait, ends 15:45", async () => {
    const got = await wrapWith("2026-10-08 15:00:00", "2026-10-08 15:45:00");
    expect(got).toEqual({
      refused: null,
      host_by: iso(START_UTC + 15 * MIN),
      ends_at: iso(START_UTC + 45 * MIN),
    });
  });

  test("control: the same call with its offset (+03:00) is wrapped with those deadlines", async () => {
    const got = await wrapWith("2026-10-08T15:00:00+03:00", "2026-10-08T15:45:00+03:00");
    expect(got).toEqual({ refused: null, host_by: iso(START_UTC + 15 * MIN), ends_at: iso(START_UTC + 45 * MIN) });
  });
});

// ---------------------------------------------------------------------------
// 3. "Fridays off" on the clock of a lead whose weekend is not Friday
// ---------------------------------------------------------------------------

describe("the day off for a backlog opener to a lead in the United States (174 leads carry US)", () => {
  // followups.quiet_days is ["friday"] as shipped, read "on the lead's own
  // calendar" (hoursRefusal dayOff, the desk's lead_days). For a US lead
  // Friday is a working day and Saturday and Sunday are the weekend, yet the
  // refusal says "It is Friday where the lead is, their day off" and the
  // opener goes on their Saturday.
  const followups = { quiet: { from: 21, to: 9 }, first_hours: [9, 18], quiet_days: ["friday"] };
  const opener = (now: number) => hoursRefusal({ segment: "reactivate", touch: 1, country: "US", now, followups, dayOff: true });
  const FRI = Date.parse("2026-10-09T17:00:00.000Z"); // Friday 13:00 New York, 10:00 Los Angeles
  const SAT = Date.parse("2026-10-10T17:00:00.000Z"); // Saturday 13:00 New York, 10:00 Los Angeles
  const SUN = Date.parse("2026-10-11T17:00:00.000Z"); // Sunday 13:00 New York, 10:00 Los Angeles

  test("Friday 13:00 in New York (their working day) is not called their day off", () => {
    expect(opener(FRI)).not.toBe(HOURS_COPY.friday);
  });

  test("Saturday and Sunday 13:00 in New York (their weekend): the opener waits for their working day", () => {
    expect({ saturday: opener(SAT), sunday: opener(SUN) }).toEqual({ saturday: expect.any(String), sunday: expect.any(String) });
  });

  test("control: a Kuwait lead's Friday is their day off, and Saturday 10:00 Kuwait is a working day", () => {
    const kw = (now: number) => hoursRefusal({ segment: "reactivate", touch: 1, country: "KW", now, followups, dayOff: true });
    expect([kw(Date.parse("2026-10-09T07:00:00.000Z")), kw(Date.parse("2026-10-10T07:00:00.000Z"))]).toEqual([HOURS_COPY.friday, null]);
  });
});
