// TIME stress, round 2 (sales-api): a booked call's whole window on a fake
// clock, minute by minute, and the live-call window's edges. The SQL side of
// the same day (the sweep every minute, settles, the watchdog) is
// supabase/migrations/tests/stress_time_day.py.
//
//     bun test supabase/functions/sales-api/stress_time_day.test.ts
//
// A test that fails here is a finding: its name says what should hold.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import {
  BOOKED_HOST_MIN,
  BOOKED_LEAD_MIN,
  DEFAULT_ROOMS_JSON,
  DEFAULT_ROOMS_SETTING,
  liveWindow,
  ROOM_COPY,
  type RoomRow,
  roomCtx,
  sweepRoom,
  timers,
  wrapPlan,
  wrapRoomRow,
} from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;
const S = 1000;
const MIN = 60 * S;
const iso = (t: number) => new Date(t).toISOString();
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const LEAD = "stress-tday-lead";
const CLOSER = "closer@stress.invalid";
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer" };
const ctx = roomCtx(DEFAULT_ROOMS_SETTING);
/** A booked demo at 15:00 Kuwait, Thursday 8 October 2026, 45 minutes. */
const START = Date.parse("2026-10-08T12:00:00.000Z");
const END = START + 45 * MIN;

/** The first timer the reference model (and the SQL sweep, R3 and R4) fires for a room. */
function firstDue(r: RoomRow): number {
  return Math.min(...timers(r, ctx).map(t => t.at));
}

function wrapAt(now: number) {
  const setting = { ...DEFAULT_ROOMS_SETTING, enabled: true, test_only: false };
  const plan = wrapPlan({ setting, contact_id: LEAD, start: iso(START), end: iso(END), address: ZOOM_URL, call_kind: "demo", now, ctx });
  if (!plan.ok) return { plan, room: null };
  const room = wrapRoomRow(
    { id: fakeUuid(), request_id: fakeUuid(), code: "K7Q2MX", contact_id: LEAD, call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now, appointment_id: "appt-1" },
    plan,
  );
  return { plan, room };
}

describe("room.wrap through a booked demo's whole window, minute by minute", () => {
  test("every wrap room.wrap accepts gives the closer at least one sweep (a minute) before a timer closes it", () => {
    const born: string[] = [];
    for (let t = START - 30 * MIN; t < END; t += MIN) {
      const { room } = wrapAt(t);
      if (!room) continue;
      // The closer has not pressed I'm in yet: the room is as wrapRoomRow inserts it.
      if (firstDue(room) < t + MIN) born.push(`${Math.round((t - START) / MIN)} min`);
    }
    // Accepted from 30 minutes before to the call's end; from 15 minutes in
    // (host_by) the room is closed by the next sweep, before anyone can join.
    expect(born).toEqual([]);
  });

  test("a wrap 21 minutes in: the room's own deadlines run from now, not from the call's start (they had passed)", () => {
    const now = START + 21 * MIN;
    const { plan, room } = wrapAt(now);
    expect(plan.ok).toBe(true);
    const r = room as RoomRow;
    // The booked call's own deadlines (start + 15, start + 20) are already past: the late wrap gets
    // the host's handover wait and the lead's 10 minutes from now, inside the call.
    expect(START + BOOKED_HOST_MIN * MIN).toBeLessThan(now);
    expect(START + BOOKED_LEAD_MIN * MIN).toBeLessThan(now);
    expect(Date.parse(r.host_by as string)).toBe(now + ctx.waits.handover_host * S);
    expect(Date.parse(r.lead_by as string)).toBe(now + ctx.waits.lead * S);
    // What the next minute's sweep does to it (the reference model of R3):
    const swept = sweepRoom(r, now + MIN, ctx);
    const closed = swept.ok && swept.changed && ["expired", "ended"].includes(String(swept.room.state));
    expect({ closedByNextSweep: closed, lead_by_in_future: Date.parse(r.lead_by as string) > now }).toEqual({
      closedByNextSweep: false,
      lead_by_in_future: true,
    });
  });
});

describe("room.wrap through rooms.ts, 21 minutes into the call", () => {
  test("answers a room the next sweep closes at once (or refuses with a sentence)", async () => {
    const w = fakeWorld(START + 21 * MIN);
    w.db.seed("cockpit_sales_settings", [
      { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } } },
      { key: "live", value: { enabled: false } },
    ]);
    w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "appt-1", contact_id: LEAD, call_type: "demo", start_at: iso(START), status: "confirmed", assigned_user_id: "G-closer" },
    ]);
    w.routes.push((m, p) => {
      if (m === "GET" && p === "/calendars/events/appointments/appt-1")
        return { appointment: { id: "appt-1", contactId: LEAD, startTime: iso(START), endTime: iso(END), address: ZOOM_URL, assignedUserId: "G-closer" } };
      if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { id: LEAD, firstName: "Huda", tags: [] } };
      return null as unknown as Row;
    });
    const deps = {
      io: w.io,
      audit: async () => {},
      markAppointment: async () => ({}),
      sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      upcoming: async () => null,
    } as unknown as RoomDeps;
    const rooms = makeRooms(deps);
    let answer: Row | null = null;
    let refusal: string | null = null;
    try {
      answer = (await rooms.actions["room.wrap"]!(closer, { appointment_id: "appt-1", request_id: crypto.randomUUID() })) as Row;
    } catch (e) {
      refusal = String((e as Error).message);
    }
    if (refusal !== null) return; // Refused with a sentence: the closer is told, nothing dead is made.
    const room = answer?.room as Row;
    const stored = w.db.t("cockpit_sales_rooms").find(r => r.id === room.id) as unknown as RoomRow;
    const now = w.clock.now;
    expect({
      state: room.state,
      host_by_past: Date.parse(String(stored.host_by)) < now,
      lead_by_past: Date.parse(String(stored.lead_by)) < now,
    }).toEqual({ state: "open", host_by_past: false, lead_by_past: false });
  });
});

describe("the live-call window (live.hours)", () => {
  const at = (s: string) => Date.parse(s);

  test("a window a manager sets (12:00 to 22:00) is the one the refusal names", () => {
    // 11:00 Kuwait on a Saturday: before a 12:00 to 22:00 window.
    const hours = { days: [6, 0, 1, 2, 3, 4], from: "12:00", to: "22:00", tz: "Asia/Kuwait" };
    expect(liveWindow(hours, at("2026-10-10T08:00:00Z")).open).toBe(false);
    // The sentence the strip shows (rooms.ts live.availability) is fixed to the shipped window.
    expect(ROOM_COPY.refusals.outside_hours).toContain("12:00");
  });

  test("an all-day window keeps a rep Available across midnight (Available is capped at the window's end)", () => {
    const hours = { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "24:00", tz: "Asia/Kuwait" };
    const now = at("2026-10-08T20:30:00Z"); // 23:30 Kuwait
    const w = liveWindow(hours, now);
    expect(w.open).toBe(true);
    // rooms.ts: until = min(now + available_hours, window.ends_at); the window runs on through the night.
    const until = Math.min(now + 2 * 3_600_000, w.ends_at ?? Number.POSITIVE_INFINITY);
    expect(until - now).toBe(2 * 3_600_000);
  });

  test("the window's edges, to the second, Saturday to Thursday 10:00 to 20:00 Kuwait (control)", () => {
    const h = { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" };
    expect(liveWindow(h, at("2026-10-08T06:59:59Z")).open).toBe(false);
    expect(liveWindow(h, at("2026-10-08T07:00:00Z")).open).toBe(true);
    expect(liveWindow(h, at("2026-10-08T16:59:59Z")).open).toBe(true);
    expect(liveWindow(h, at("2026-10-08T17:00:00Z")).open).toBe(false);
    expect(liveWindow(h, at("2026-10-09T08:00:00Z")).open).toBe(false); // Friday 11:00
    expect(liveWindow(h, at("2026-10-08T16:59:59Z")).ends_at).toBe(at("2026-10-08T17:00:00Z"));
  });
});
