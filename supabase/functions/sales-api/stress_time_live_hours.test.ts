// TIME stress for the live-call hours (glossary 1.10, settings live.hours:
// Saturday to Thursday, 10:00 to 20:00 Kuwait). rooms.ts against testfakes.ts
// on a fake clock: a closer pressing I'm available on their Friday, at 03:00,
// and one minute before and after the window's edges.
//
//     bun test supabase/functions/sales-api/stress_time_live_hours.test.ts

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, ROOM_COPY } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;
const CLOSER = "closer@stress.invalid";
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer" };
const LIVE_HOURS = { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" };

function world(startIso: string) {
  const w = fakeWorld(Date.parse(startIso));
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: true, standby: true, closer_wait_s: 120, hours: LIVE_HOURS } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
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

async function pressAvailable(at: string): Promise<{ standby: Row | undefined; out: Row }> {
  const { w, rooms } = world(at);
  const out = (await rooms.actions["live.availability"]!(closer, { state: "available" })) as Row;
  return { standby: w.db.t("cockpit_sales_rooms").find(r => r.purpose === "standby"), out };
}

describe("I'm available outside the live-call hours", () => {
  for (const [label, at] of [
    ["Friday 11:00 Kuwait (the day off)", "2026-10-09T08:00:00Z"],
    ["Thursday 03:00 Kuwait (night)", "2026-10-08T00:00:00Z"],
    ["Thursday 20:01 Kuwait (a minute after the window)", "2026-10-08T17:01:00Z"],
    ["Saturday 09:59 Kuwait (a minute before it)", "2026-10-10T06:59:00Z"],
  ] as const)
    test(`${label}: no standby room is made, and the strip says when live calls run`, async () => {
      const { standby, out } = await pressAvailable(at);
      expect(standby).toBeUndefined();
      expect(String(out.standby_error ?? "")).toBe(ROOM_COPY.refusals.outside_hours);
    });

  test("Thursday 10:00 Kuwait, inside the window: the standby room is asked for (control)", async () => {
    const { standby } = await pressAvailable("2026-10-08T07:00:00Z");
    expect(standby?.state).toBe("requested");
  });
});
