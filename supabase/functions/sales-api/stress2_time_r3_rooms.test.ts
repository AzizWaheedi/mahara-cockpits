// bun test supabase/functions/sales-api/stress2_time_r3_rooms.test.ts
//
// TIME stress, second series, round 3: the clock around another seat's room.
//
// room.create refuses a second room for a lead whose room is open, and since
// stress2 round 2 says whose it is and when it closes (rooms.ts createRoom,
// LANE_COPY.lead_has_others_room: "The {role}'s video room for this lead is
// open until {until}. Call the lead, or send a link after that."). {until} is
// coalesce(lead_by, host_by, requested + fail): the room's deadline as it was
// set, read as the time it closes. A room keeps going past lead_by while the
// lead is in it (lead_in: only no_end_signal closes it, ends_at + 30 min) and
// for open_grace after the lead opened the link (the sweep's R4).
//
// A test that fails here is a finding. Everything runs on testfakes.ts.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const LEAD = "stress-time2r3-lead-000001";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };

/** Sunday 11 October 2026 in Kuwait (UTC+3). */
const kw = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

function setup(now: number, closerRoom: Row) {
  const w = fakeWorld(now);
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
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Cody Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(now - 5 * S) }]);
  w.db.seed("cockpit_sales_rooms", [
    {
      id: fakeUuid(),
      request_id: fakeUuid(),
      code: "K7Q2MX",
      contact_id: LEAD,
      purpose: "manual",
      call_kind: "demo",
      provider: "zoom",
      host_email: CLOSER,
      made_by: CLOSER,
      version: 4,
      send_on: "open",
      join_url: "https://us06web.zoom.us/j/85012345678?pwd=stress",
      provider_meeting_id: "85012345678",
      ...closerRoom,
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
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  return { ...w, rooms: makeRooms(deps) };
}

async function refusalOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e.message;
    throw e;
  }
  return "(no refusal)";
}

/** Every HH:MM the sentence names, as Kuwait instants on that Sunday. */
function timesNamed(text: string): number[] {
  return [...text.matchAll(/\b(\d{2}):(\d{2})\b/g)].map(m => kw(`${m[1]}:${m[2]}:00`));
}

const ask = (w: ReturnType<typeof setup>) =>
  w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    purpose: "manual",
    provider: "meet",
    call_kind: "intro",
  });

describe("Sunday 10:20: the lead is on video with the closer (joined 09:55); the setter presses Send a video link on the lead's page", () => {
  const closerRoom: Row = {
    state: "lead_in",
    requested_at: iso(kw("09:49:30")),
    opened_at: iso(kw("09:50:00")),
    link_sent_at: iso(kw("09:50:05")),
    host_in_at: iso(kw("09:51:00")),
    lead_in_at: iso(kw("09:55:00")),
    lead_in_seen_at: iso(kw("09:55:00")),
    host_by: iso(kw("10:05:00")),
    lead_by: iso(kw("10:00:05")),
    ends_at: iso(kw("10:50:00")),
  };

  test("the refusal never names a closing time that has already gone (the room is running, the lead is in it)", async () => {
    const w = setup(kw("10:20:00"), closerRoom);
    const said = await refusalOf(ask(w));
    // Found: "The closer's video room for this lead is open until 10:00.
    // Call the lead, or send a link after that." at 10:20, while the lead is
    // in that room with the closer: the setter is told the room closed twenty
    // minutes ago and to call the lead, who is on a video call right now.
    expect(said).toContain("closer");
    for (const t of timesNamed(said)) expect(t).toBeGreaterThanOrEqual(kw("10:20:00"));
  });

  test("and it does not tell the setter to call a lead who is in a video call", async () => {
    const w = setup(kw("10:20:00"), closerRoom);
    const said = await refusalOf(ask(w));
    expect(said).not.toContain("Call the lead");
  });
});

describe("Sunday 10:11: the lead opened the closer's link at 10:09:40, 25 s before lead_by (10:10:05); the sweep holds the room to 10:12:40", () => {
  test("the setter's refusal at 10:11 does not say the room is open until 10:10", async () => {
    const w = setup(kw("10:11:00"), {
      state: "host_in",
      requested_at: iso(kw("09:59:30")),
      opened_at: iso(kw("10:00:00")),
      link_sent_at: iso(kw("10:00:05")),
      host_in_at: iso(kw("10:01:00")),
      first_open_at: iso(kw("10:09:40")),
      last_open_at: iso(kw("10:09:40")),
      host_by: iso(kw("10:15:00")),
      lead_by: iso(kw("10:10:05")),
    });
    const said = await refusalOf(ask(w));
    // Found: "... open until 10:10." at 10:11: the room the lead is opening
    // right now is said to have closed a minute ago.
    for (const t of timesNamed(said)) expect(t).toBeGreaterThanOrEqual(kw("10:11:00"));
  });

  test("control: at 10:05, before lead_by, the time it names is ahead", async () => {
    const w = setup(kw("10:05:00"), {
      state: "host_in",
      requested_at: iso(kw("09:59:30")),
      opened_at: iso(kw("10:00:00")),
      link_sent_at: iso(kw("10:00:05")),
      host_in_at: iso(kw("10:01:00")),
      host_by: iso(kw("10:15:00")),
      lead_by: iso(kw("10:10:05")),
    });
    const said = await refusalOf(ask(w));
    expect(said).toContain("10:10");
  });
});

// ---------------------------------------------------------------------------
// The order of two presses a few seconds apart: the settle's phone evidence.
// ---------------------------------------------------------------------------
import { phoneSince } from "./roomlogic.ts";

describe("10:00:30 the intro call rings busy (Maqsam 'busy', 0 s, not auto-saved); the line says 'Save it as No answer or Call back, or send a video link'", () => {
  const T = kw("10:00:40"); // the room is asked for
  const attempt = (savedAt: number) => ({
    state: "saved",
    call_state: "busy",
    call_duration_s: 0,
    outcome: "callback",
    started_at: iso(kw("10:00:05")),
    saved_at: iso(savedAt),
  });
  const dial = { direction: "outbound", state: "busy", duration_s: 0, occurred_at: iso(kw("10:00:05")) };

  test("the setter sends the video link, then saves the busy call as Call back at 10:01: nobody was reached by phone", () => {
    // Found: "reached": the settle reads the unanswered call saved after the
    // room as the lead reached by phone, writes no no-show and raises "mark
    // this intro: the lead was reached by phone"; the intro stays confirmed
    // (a show in B2B's rate) until a person marks it.
    expect(phoneSince([attempt(kw("10:01:00"))], [dial], T, kw("10:20:30"))).toBeNull();
  });

  test("control: the same two presses the other way round (saved 10:00:35, link 10:00:40) read nobody reached", () => {
    expect(phoneSince([attempt(kw("10:00:35"))], [dial], T, kw("10:20:30"))).toBeNull();
  });
});
