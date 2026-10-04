// bun test supabase/functions/sales-api/stress2_time_tick.test.ts
//
// TIME stress, second series, round 1: the minute's tick (room.event kind
// tick, owner sql) on a setter's fallback room made in the five minutes
// before the intro it is for. The dialer shows an intro from five minutes
// before its start (dialer.ts introWindow); the setter rings at 10:58 for the
// 11:00 intro, no answer, and sends a video link: room.create gives the room
// the intro (inside its window, rooms.ts introNow). The tick reads the host's
// next booked call (rooms.ts nextBooked: the first one that starts after
// now) and, inside booked_guard (10 minutes) of it, raises "the host's booked
// call is near and this room still has a lead in it or waiting" for any room
// with a lead. Before 11:00 that next call is this very room's intro.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-time2-lead-000002";
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
/** Thursday 8 October 2026, 11:00 Kuwait. */
const START = Date.parse("2026-10-08T08:00:00.000Z");

function setup(opts: { next?: number | null } = {}) {
  const w = fakeWorld();
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true }, fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" } },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: {} },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  const appts: Row[] = [
    {
      appointment_id: "intro-own",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: new Date(START).toISOString(),
      assigned_user_id: "G-setter",
    },
  ];
  if (opts.next != null)
    appts.push({
      appointment_id: "intro-next",
      contact_id: "stress-time2-lead-000003",
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: new Date(opts.next).toISOString(),
      assigned_user_id: "G-setter",
    });
  w.db.seed("cockpit_sales_appointments", appts);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p.startsWith("/contacts/")) return { contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"] } };
    return { ok: true } as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const api = makeRooms(deps);
  const id = fakeUuid();
  // The fallback room the setter sent at 10:58 for the 11:00 intro: open,
  // the setter in, the link sent, the lead not in yet (lead_by 11:08).
  w.db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: fakeUuid(),
      code: "K7Q2MX",
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      provider: "zoom",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: "intro-own",
      appointment_start_at: new Date(START).toISOString(),
      state: "host_in",
      join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
      provider_meeting_id: "81234567890",
      requested_at: new Date(START - 2 * MIN).toISOString(),
      opened_at: new Date(START - 2 * MIN + 4 * S).toISOString(),
      link_claimed_at: new Date(START - 2 * MIN + 4 * S).toISOString(),
      link_sent_at: new Date(START - 2 * MIN + 5 * S).toISOString(),
      link_channels: ["whatsapp_text"],
      host_in_at: new Date(START - 2 * MIN + 30 * S).toISOString(),
      host_by: new Date(START + 13 * MIN).toISOString(),
      lead_by: new Date(START + 8 * MIN).toISOString(),
      version: 4,
    },
  ]);
  async function tick(at: number) {
    w.clock.now = at;
    await api.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
  }
  const guardAlerts = () => w.db.t("cockpit_sales_alerts").filter(a => a.kind === "room_booked_guard");
  return { ...w, id, tick, guardAlerts };
}

describe("a fallback room for the 11:00 intro, made at 10:58 (the dialer's intro window opens at 10:55)", () => {
  test("the ticks at 10:59 and 10:59:59 raise no 'booked call is near' alert about the room's own intro", async () => {
    const w = setup();
    await w.tick(START - 1 * MIN);
    await w.tick(START - 1 * S);
    expect(w.guardAlerts().map(a => a.message)).toEqual([]);
  });

  test("control: at 11:00:01 (the intro has started) the same room raises nothing", async () => {
    const w = setup();
    await w.tick(START + 1 * S);
    expect(w.guardAlerts()).toHaveLength(0);
  });

  test("control: the setter's next intro at 11:15 is near at 11:06 while the lead is still awaited: one alert (the rule itself)", async () => {
    const w = setup({ next: START + 15 * MIN });
    await w.tick(START + 6 * MIN);
    expect(w.guardAlerts()).toHaveLength(1);
  });
});
