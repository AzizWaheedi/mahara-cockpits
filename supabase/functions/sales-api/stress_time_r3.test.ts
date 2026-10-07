// TIME stress, round 3 (sales-api): what a fake clock shows that a single
// moment does not. rooms.ts against testfakes.ts, and roomlogic's pure rules,
// over the hours a real day puts between two presses, a confirmation call and
// the intro it confirms, and a Zoom join read late.
//
//     bun test supabase/functions/sales-api/stress_time_r3.test.ts
//
// A test that fails here is a finding: its name says what should hold.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import {
  applyRoomEvent,
  DEFAULT_ROOMS_JSON,
  DEFAULT_WAITS,
  roomCtx,
  roomForThisStart,
  type RoomRow,
  settleWanted,
} from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { followupSettingsValue, hoursRefusal, laterHours } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;
const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const iso = (t: number) => new Date(t).toISOString();
const CLOSER = "closer-r3@stress.invalid";
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer-r3" };
const LIVE_HOURS = { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" };

function world(startIso: string) {
  const w = fakeWorld(Date.parse(startIso));
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: true, standby: true, closer_wait_s: 120, hours: LIVE_HOURS } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Closer", role: "closer", ghl_user_id: "G-closer-r3", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer-r3", zoom_status: "licensed", google_ok: true }]);
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

const standbyRooms = (w: ReturnType<typeof fakeWorld>) => w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby");

// ---------------------------------------------------------------------------
// 1. Two presses of I'm available in the last two hours of the live window
// ---------------------------------------------------------------------------

describe("I'm available, Away, I'm available again, in the last two hours of the live window", () => {
  // Thursday 8 October 2026, 18:30 Kuwait (15:30 UTC). Available runs two
  // hours, capped at the window's end (20:00), so every press from 18:00 on
  // gets the same `until` to the millisecond: 20:00:00.000.
  test("the second Available gets a fresh standby room (its own request id), not the first press's closed one", async () => {
    const { w, rooms } = world("2026-10-08T15:30:00.000Z");
    await rooms.actions["live.availability"]!(closer, { state: "available" });
    const first = standbyRooms(w);
    expect(first.length).toBe(1);
    // The room worker makes it and the closer comes in.
    Object.assign(first[0]!, { state: "host_in", opened_at: iso(w.clock.now + 5 * S), host_in_at: iso(w.clock.now + 30 * S), join_url: "https://us06web.zoom.us/j/81000000001?pwd=x", version: 3 });
    // 18:40: a phone call comes in; Away ends the empty standby room.
    w.clock.now += 10 * MIN;
    await rooms.actions["live.availability"]!(closer, { state: "away" });
    await w.flush();
    expect(String(standbyRooms(w)[0]!.state)).toBe("ended");
    // 18:55: back, Available again.
    w.clock.now += 15 * MIN;
    const out = (await rooms.actions["live.availability"]!(closer, { state: "available" })) as Row;
    await w.flush();
    const live = standbyRooms(w).filter(r => ["requested", "creating", "open", "host_in"].includes(String(r.state)));
    expect({ live_standby_rooms: live.length, standby_error: out.standby_error ?? null }).toEqual({ live_standby_rooms: 1, standby_error: null });
  });

  test("control: the same presses at 14:30 (until not capped) do get a fresh room", async () => {
    const { w, rooms } = world("2026-10-08T11:30:00.000Z");
    await rooms.actions["live.availability"]!(closer, { state: "available" });
    Object.assign(standbyRooms(w)[0]!, { state: "host_in", opened_at: iso(w.clock.now + 5 * S), host_in_at: iso(w.clock.now + 30 * S), join_url: "https://us06web.zoom.us/j/81000000002?pwd=x", version: 3 });
    w.clock.now += 10 * MIN;
    await rooms.actions["live.availability"]!(closer, { state: "away" });
    w.clock.now += 15 * MIN;
    await rooms.actions["live.availability"]!(closer, { state: "available" });
    await w.flush();
    const live = standbyRooms(w).filter(r => ["requested", "creating", "open", "host_in"].includes(String(r.state)));
    expect(live.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. A confirmation call's room, hours before the intro it confirms
// ---------------------------------------------------------------------------

describe("the setter's confirmation call the evening before a booked intro", () => {
  // The intro: Thursday 8 October 2026, 11:00 Kuwait (08:00 UTC). The dialer
  // puts the confirmation on Wednesday at 18:00 Kuwait (desk followups.py
  // confirm_from: 18:00 the evening before a call that starts before noon).
  // No answer, so the setter sends a video link (DialerPage: a "confirm" item
  // for a booked intro passes the intro's appointment_id). The lead never
  // opens it; the room closes at 18:15 with nobody in it (Zoom reported the
  // meeting: the setter was in it).
  const START = Date.parse("2026-10-08T08:00:00.000Z");
  const evening = START - 17 * HOUR;
  const room: RoomRow = {
    id: fakeUuid(),
    code: "K7Q2MX",
    contact_id: "stress-r3-lead",
    purpose: "fallback",
    call_kind: "intro",
    provider: "zoom",
    host_email: "setter-r3@stress.invalid",
    state: "expired",
    version: 6,
    result: "no_join",
    end_reason: "lead_no_show",
    appointment_id: "stress-r3-appt",
    appointment_start_at: iso(START),
    requested_at: iso(evening),
    opened_at: iso(evening + 5 * S),
    host_in_at: iso(evening + 40 * S),
    link_sent_at: iso(evening + 6 * S),
    lead_by: iso(evening + 6 * S + 10 * MIN),
    ended_at: iso(evening + 14 * MIN),
  };
  const facts = { zoom_reported: true, zoom_unclear: false, short_link: false };
  const w = { ...DEFAULT_WAITS };

  test("its empty room is not evidence about the intro 17 hours later: never settled a no-show at 11:21", () => {
    const at = START + 21 * MIN;
    expect({
      for_this_start: roomForThisStart(room, START, w),
      settle: settleWanted(room, iso(START), false, at, w, facts),
    }).toEqual({ for_this_start: false, settle: false });
  });

  test("control: the same empty room made at the intro's own time (10:58) is settled at 11:21", () => {
    const own = { ...room, requested_at: iso(START - 2 * MIN), opened_at: iso(START - 2 * MIN + 5 * S), ended_at: iso(START + 13 * MIN) };
    expect(settleWanted(own, iso(START), false, START + 21 * MIN, w, facts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. A Zoom join read late: the five minutes of "That was not the lead"
// ---------------------------------------------------------------------------

describe("a Zoom join the door stored during a sales-api outage, read four minutes later", () => {
  test("the host still has the undo window once the room first shows The lead is in", () => {
    const ctx = roomCtx({ waits_s: { ...DEFAULT_WAITS }, lengths_min: { intro: 30, demo: 60 }, count_on_join: false });
    const t0 = Date.parse("2026-10-08T10:00:00.000Z");
    const room: RoomRow = {
      id: fakeUuid(),
      code: "K7Q2MY",
      contact_id: "stress-r3-lead-z",
      purpose: "fallback",
      call_kind: "intro",
      provider: "zoom",
      host_email: "setter-r3@stress.invalid",
      state: "host_in",
      version: 4,
      requested_at: iso(t0),
      opened_at: iso(t0 + 5 * S),
      host_in_at: iso(t0 + 30 * S),
      link_sent_at: iso(t0 + 6 * S),
      lead_by: iso(t0 + 6 * S + 10 * MIN),
      ends_at: iso(t0 + 30 * MIN),
    };
    // Zoom's join_time 10:02:00; sales-api was down, the sweep's replay reads it at 10:06:10.
    const joinAt = t0 + 2 * MIN;
    const readAt = joinAt + 4 * MIN + 10 * S;
    const joined = applyRoomEvent(room, { kind: "lead_in", source: "zoom", at: iso(joinAt) }, readAt, ctx);
    if (!joined.ok) throw new Error(`the join was refused: ${joined.code}`);
    const after = joined.room;
    // The panel shows The lead is in at 10:06:10; the host sees it is a colleague and presses at 10:07:30.
    const press = applyRoomEvent(after, { kind: "not_lead", actor: { email: "setter-r3@stress.invalid" }, version: after.version }, readAt + 80 * S, ctx);
    expect(press.ok ? "taken back" : `refused: ${press.code} (${press.message})`).toBe("taken back");
  });
});

// ---------------------------------------------------------------------------
// 4. Quiet hours that end at midnight
// ---------------------------------------------------------------------------

describe("a manager's quiet hours from midnight to 09:00 (the save accepts quiet.from 0)", () => {
  const saved = followupSettingsValue({}, { quiet: { from: 0, to: 9 } }, ["no_show"]);
  test("the save keeps them", () => {
    expect(saved.ok ? (saved.value.quiet as Row) : saved.error).toEqual({ from: 0, to: 9 });
  });
  test("a later message at 22:30 Kuwait goes (the desk's quiet() reads 22:30 as not quiet, and drafts it)", () => {
    const followups = saved.ok ? saved.value : {};
    const at = Date.parse("2026-10-08T19:30:00.000Z"); // Thursday 22:30 Kuwait
    expect({ hours: laterHours(followups), refusal: hoursRefusal({ segment: "no_show", touch: 2, country: "KW", now: at, followups }) })
      .toEqual({ hours: [9, 24], refusal: null });
  });
});
