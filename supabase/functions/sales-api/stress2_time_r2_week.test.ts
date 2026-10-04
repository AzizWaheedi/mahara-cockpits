// bun test supabase/functions/sales-api/stress2_time_r2_week.test.ts
//
// TIME stress, second series, round 2: a closer's Sunday morning around a
// booked demo. The sweep keeps a standby room out of a host's booked call:
// R6 ends an empty standby room booked_guard (10 minutes) before the host's
// next booked call, and R5 makes no fresh one when a booked call starts
// before the fresh room's life and its guard are over (roomlogic.ts
// refreshWanted). The presence view puts the host Away with reason
// booked_call_soon inside booked_guard. live.availability (rooms.ts
// liveAvailability) reads none of it before it asks for a standby room.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const CLOSER = "closer@stress.invalid";
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Cody Closer", role: "closer", ghl_user_id: "G-closer" };
/** Sunday 11 October 2026 in Kuwait. */
const kw = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}:00+03:00`);

function setup(at: number) {
  const w = fakeWorld(at);
  const audits: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } },
    },
    { key: "live", value: { enabled: true, standby: true, hours: { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" } } },
    { key: "whatsapp_guard", value: {} },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Cody Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(at - 5 * S).toISOString() }]);
  // The closer's booked demo at 10:30 with another lead.
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "demo-1030",
      contact_id: "stress-time2r2-lead-000009",
      call_type: "demo",
      calendar_id: BOOKING_CALENDARS.demo,
      status: "confirmed",
      start_at: new Date(kw("10:30")).toISOString(),
      assigned_user_id: "G-closer",
    },
  ]);
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const standby = () => w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby");
  return { ...w, rooms, audits, standby };
}

describe("Sunday 10:24: the closer presses I'm available six minutes before their 10:30 demo", () => {
  test("no standby room is asked for (the sweep's R6 would end it within the minute; its Zoom meeting is made for nothing)", async () => {
    const w = setup(kw("10:24"));
    const out = await w.rooms.actions["live.availability"]!(closer, { state: "available" });
    await w.flush();
    // Found: a standby room is asked for at 10:24 (requested, the worker will
    // make a Zoom meeting on the closer's own seat), inside booked_guard of
    // the 10:30 demo. The sweep's R6 ends it at the next minute ("Closed: the
    // host has a booked call starting within 10 minutes."), and it counts as
    // one of the closer's four standby rooms this hour.
    expect(w.standby().length).toBe(0);
    expect(String(out.standby_error ?? "")).not.toBe("");
  });

  test("control: at 10:00, with the demo 30 minutes on, a standby room is asked for", async () => {
    const w = setup(kw("10:00"));
    await w.rooms.actions["live.availability"]!(closer, { state: "available" });
    await w.flush();
    expect(w.standby().length).toBe(1);
  });
});
