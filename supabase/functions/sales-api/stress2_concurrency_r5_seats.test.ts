// bun test supabase/functions/sales-api/stress2_concurrency_r5_seats.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. Two seats
// press for one lead at the same moment.
//
// Round 2 (lead-has-room-refusal-says-open-it-to-other-rep) taught
// createRoom to say whose room holds the lead ("The setter's video room for
// this lead is open until 14:10...") instead of "This lead already has a
// room open. Open it.", which only its host can do. That sentence is built
// only on the path where the lead's open room was READ before the insert.
// Two other paths still answer the bare "Open it" for another seat's room:
//   - two seats at once: the setter's dialer and the closer's lead page both
//     pass the read (no room yet), the setter's insert lands, the closer's
//     insert meets cockpit_sales_rooms_one_per_lead, and createRoom answers
//     refuse("lead_has_room") with no word of whose room it is;
//   - room.wrap (the closer opens their booked demo's room) while the
//     setter's room for the lead is open: no read of the lead's rooms at all,
//     the insert meets the same index, and the closer is told "Open it".
// The closer presses Open on a room that is not theirs and is refused
// (not_host), with the lead waiting on the call.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel, Zoom, Google or Slack; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const LEAD = "stress-lead-s2c5-000005";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };

function setup() {
  const w = fakeWorld();
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: false, whatsapp_template: false, email: false },
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "calendars", value: { "demo-cal": { type: "demo" } } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === "/calendars/events/appointments/demo-1")
      return {
        appointment: {
          id: "demo-1",
          contactId: LEAD,
          calendarId: "demo-cal",
          assignedUserId: "G-closer",
          startTime: new Date(w.clock.now + 2 * MIN).toISOString(),
          endTime: new Date(w.clock.now + 62 * MIN).toISOString(),
          address: "https://us06web.zoom.us/j/81234500100?pwd=stress",
        },
      };
    return null as unknown as Row;
  });
  /** The setter books the demo with the closer for now, while on the video call (the cockpit's "Book the call for now"). */
  const bookDemoNow = () =>
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "demo-1",
        contact_id: LEAD,
        call_type: "demo",
        calendar_id: "demo-cal",
        status: "confirmed",
        start_at: new Date(w.clock.now + 2 * MIN).toISOString(),
        assigned_user_id: "G-closer",
      },
    ]);
  // Both presses read the lead's rooms before either insert lands (two Edge
  // Function instances): the first room insert waits until two reads of the
  // lead's open rooms have been made.
  let reads = 0;
  let race = false;
  const io = {
    ...w.io,
    db: async (path: string, init?: { method?: string }) => {
      if (race && (init?.method ?? "GET") === "GET" && path.startsWith(`cockpit_sales_rooms?contact_id=eq.${LEAD}&state=in.(`)) reads++;
      if (race && init?.method === "POST" && path === "cockpit_sales_rooms")
        for (let i = 0; i < 200 && reads < 2; i++) await new Promise(r => setTimeout(r, 0));
      return await w.io.db(path, init as never);
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  return { ...w, rooms: makeRooms(deps), bookDemoNow, raceInserts: () => (race = true) };
}

async function answer(p: Promise<Row>): Promise<{ ok: boolean; message?: string; code?: string; room?: Row }> {
  try {
    const out = await p;
    return { ok: true, room: out.room as Row };
  } catch (e) {
    return { ok: false, message: String((e as Error).message), code: String((e as { code?: unknown }).code ?? "") };
  }
}

describe("two seats press for one lead at once", () => {
  test("lead-room-race-says-open-it-to-other-seat (room.create): the setter's dialer and the closer's lead page ask for a room for Huda at the same moment; the seat whose insert lost is told whose room it is, never 'Open it'", async () => {
    const w = setup();
    w.raceInserts();
    const [a, b] = await Promise.all([
      answer(w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "fallback", trigger: "no_answer" })),
      answer(w.rooms.actions["room.create"]!(closer, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "demo", purpose: "manual" })),
    ]);
    const lost = [a, b].find(x => !x.ok);
    const won = [a, b].find(x => x.ok);
    expect(Boolean(won && lost)).toBe(true);
    if (process.env.R5_DEBUG) console.log("won:", won?.room?.host_email, "lost:", lost);
    // Whose room it is, by role, as the read path says it; never "Open it" or
    // "Use that one" about a room only the other seat can open.
    expect({ told: lost?.message ?? "" }).not.toEqual({ told: "This lead already has a room open. Open it." });
    expect({ told: lost?.message ?? "" }).not.toEqual({ told: "A video room is already open for this lead. Use that one." });
    expect(lost?.message ?? "").toMatch(/\b(setter|closer|manager)'s\b|with the (setter|closer|manager)/);
  });

  test("lead-room-race-says-open-it-to-other-seat (room.wrap): the setter is on a video call with Huda and books the demo with the closer for now (the cockpit's 'Book the call for now'); the closer opens the demo's room: told whose room holds the lead, never 'Open it'", async () => {
    const w = setup();
    const s = await answer(w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "fallback", trigger: "no_answer" }));
    expect(s.ok).toBe(true);
    w.bookDemoNow();
    const c = await answer(w.rooms.actions["room.wrap"]!(closer, { request_id: crypto.randomUUID(), appointment_id: "demo-1" }));
    expect(c.ok).toBe(false);
    expect({ told: c.message }).not.toEqual({ told: "This lead already has a room open. Open it." });
  });
});
