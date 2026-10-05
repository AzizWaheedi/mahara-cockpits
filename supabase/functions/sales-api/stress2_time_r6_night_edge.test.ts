// bun test supabase/functions/sales-api/stress2_time_r6_night_edge.test.ts
//
// TIME stress, second series, round 6: the lead at the door when the night
// rule's minute comes.
//
// "I can't let them in" (room.end admit_blocked, P1 edge case 9) cancels the
// Meet room the lead is knocking at, then makes its replacement on Zoom
// through createRoom (rooms.ts replacementFor). Its pre-checks (rooms.ts
// roomEnd) read whether the host can use Zoom and the room caps; since stress2
// round 5 createRoom also refuses every fallback room while it is night on the
// lead's clock (outside 09:00 to 21:00 on any of their clocks), and that check
// runs only after the Meet room is closed.
//
// A test that fails here is a finding. Everything runs on testfakes.ts.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter-t2r6n@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

function world(country: string, made: number, knocked: number) {
  const w = fakeWorld(made);
  const LEAD = `stress-t2r6n-${country.toLowerCase()}`;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        // As it ships: a video link for a lead with a booked intro.
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(knocked) }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country, tags: ["roas-qualified"] }]);
  // The lead's booked intro, two minutes before the room (the setter's call at its minute rang out).
  const start = made - 2 * MIN;
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "stress-t2r6n-intro",
      contact_id: LEAD,
      call_type: "intro",
      status: "confirmed",
      start_at: iso(start),
      end_at: iso(start + 30 * MIN),
      booked_at: iso(start - 3 * 24 * 60 * MIN),
      assigned_user_id: "G-setter",
      calendar_id: "stress-cal",
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: `${LEAD}@example.com`, tags: ["roas-qualified"], country } };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who, b) => ({ message: { id: fakeUuid(), request_id: b.request_id, state: "sent", ghl_message_id: "m-1", created_at: iso(w.clock.now) } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
    sentSince: async () => false,
  };
  const rooms = makeRooms(deps);
  // The Meet room after the setter's missed call: link sent, the setter in,
  // the lead knocking ("Ask to join") and the setter's Meet will not let them in.
  const id = fakeUuid();
  w.db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: fakeUuid(),
      code: "MEET21",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      appointment_id: "stress-t2r6n-intro",
      appointment_start_at: iso(start),
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      state: "host_in",
      join_url: "https://meet.google.com/abc-defg-hij",
      requested_at: iso(made),
      opened_at: iso(made + 10 * S),
      link_sent_at: iso(made + 15 * S),
      link_channels: ["whatsapp_text"],
      host_in_at: iso(made + 40 * S),
      lead_waiting_at: iso(knocked),
      first_open_at: iso(knocked - 20 * S),
      lead_by: iso(made + 15 * S + 10 * MIN),
      host_by: iso(made + 15 * MIN),
      ends_at: iso(made + 30 * MIN),
      version: 4,
    },
  ]);
  async function cantLetThemIn(at: number): Promise<Row> {
    w.clock.now = at;
    const v = (w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row).version;
    return await rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" });
  }
  return { ...w, rooms, id, LEAD, cantLetThemIn };
}

describe("Thursday 8 October 20:58 Kuwait: a Kuwait lead knocks at the setter's Meet room for their 20:50 intro (made 20:52); the setter presses I can't let them in at 21:00:20", () => {
  test("the lead knocking at the door is moved to Zoom, or keeps the Meet room, never left with no room and the setter told to call after 9 in the morning", async () => {
    const w = world("KW", kw("2026-10-08T20:52:00"), kw("2026-10-08T20:58:00"));
    const out = await w.cantLetThemIn(kw("2026-10-08T21:00:20"));
    const meet = w.db.t("cockpit_sales_rooms").find(r => r.id === w.id) as Row;
    // Found: the Meet room is cancelled (result admit_blocked) and the answer
    // carries no replacement, only "It is night where the lead is, so no video
    // link goes now. Call them after 9 in the morning, their time." The lead,
    // who is at the door this minute, has no room at all.
    expect({
      replacement: Boolean(out.replacement),
      meet_still_open: !["cancelled", "ended", "expired", "failed"].includes(String(meet.state)),
      said: out.replacement_refusal ?? null,
    }).toEqual({ replacement: true, meet_still_open: false, said: null });
  });

  test("control: the same press at 20:59:40 moves the lead to Zoom", async () => {
    const w = world("KW", kw("2026-10-08T20:52:00"), kw("2026-10-08T20:58:00"));
    const out = await w.cantLetThemIn(kw("2026-10-08T20:59:40"));
    expect(Boolean(out.replacement)).toBe(true);
  });
});

describe("Thursday 8 October 20:01 Kuwait: a lead in Dubai (21:01 there) knocks at the Meet room the setter sent at 19:57 Kuwait for their 19:55 intro", () => {
  test("the press does not close the knocking lead's room for a replacement that is then refused", async () => {
    const w = world("AE", kw("2026-10-08T19:57:00"), kw("2026-10-08T20:00:50"));
    const out = await w.cantLetThemIn(kw("2026-10-08T20:01:30"));
    const meet = w.db.t("cockpit_sales_rooms").find(r => r.id === w.id) as Row;
    expect({ replacement: Boolean(out.replacement), meet: meet.state, said: out.replacement_refusal ?? null }).toEqual({
      replacement: true,
      meet: "cancelled",
      said: null,
    });
  });
});
