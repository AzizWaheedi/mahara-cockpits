// TIME stress for the strip and the panel's clock: the presence the database
// view really serves around a booked call (state available, reason
// booked_call_soon; supabase/migrations/tests/stress_time.py reads it from
// the view), a browser clock that is minutes off, and Kuwait's midnight.
//
//     bun test apps/sales-cockpit/src/lib/stress_time_strip.test.ts

import { describe, expect, mock, test } from "bun:test";
import type { Presence, RoomView } from "./rooms";

mock.module("./api", () => ({ api: async () => ({ ok: true }) }));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");

const S = 1000;
const MIN = 60 * S;
/** 13:51 in Kuwait, Thursday 8 October 2026; the closer's booked demo is at 14:00. */
const NOW = Date.parse("2026-10-08T10:51:00.000Z");
const iso = (t: number) => new Date(t).toISOString();

const strip = (me: Presence, rooms: RoomView[] = [], now = NOW) =>
  R.stripLine({
    me,
    rooms,
    offers: [],
    health: F.healthFixture(now),
    now,
    flash: null,
  });

describe("the strip in the 10 minutes before a booked call", () => {
  // What cockpit_sales_presence serves once the sweep's booked guard (R6) has
  // closed the closer's standby room: still Available (until 15:00), reason
  // booked_call_soon, the call at 14:00. live.status sends no final rooms.
  const served: Presence = {
    email: "closer@stress.invalid",
    state: "available",
    until: iso(NOW + 69 * MIN),
    room_id: null,
    zoom_status: "licensed",
    default_provider: "zoom",
    reason: "booked_call_soon",
    booked_at: iso(NOW + 9 * MIN),
    booked_kind: "demo",
  } as Presence;

  test("says the booked call, not 'Available until 15:00.'", () => {
    const line = strip(served);
    expect(R.sentenceText(line.sentence)).toContain(
      "Your booked demo starts at 14:00",
    );
  });
});

describe("a browser clock minutes off", () => {
  test("the countdown follows the server's clock, not the laptop's", () => {
    const server = NOW;
    const browser = NOW - 7 * MIN; // the laptop is 7 minutes slow
    const offset = R.clockOffset(iso(server), browser - 200, browser + 200);
    expect(offset).toBe(7 * MIN);
    const room = F.baseRoom(NOW, {
      state: "host_in",
      link_sent_at: iso(NOW - 48 * S),
      lead_by: iso(NOW + 552 * S),
    });
    expect(R.roomLeft(room, browser + (offset as number))).toBe(552 * S);
  });

  test("an offer's two minutes drain on the server's clock and stop at 0", () => {
    const o = F.offerFixture(NOW, { offer_until: iso(NOW + 30 * S) });
    expect(R.offerLeft(o, NOW + 31 * S)).toBe(0);
    expect(R.offerFraction(o, NOW + 31 * S)).toBe(0);
    expect(R.offerLeft(o, NOW + 29 * S)).toBe(S);
  });
});

describe("Kuwait's midnight on the panel", () => {
  test("a lead deadline at 00:05 Kuwait reads 00:05, not the browser's own zone", () => {
    const at = Date.parse("2026-10-08T21:05:00.000Z");
    const room = F.baseRoom(at - 5 * MIN, {
      state: "open",
      link_sent_at: iso(at - 10 * MIN),
      lead_by: iso(at),
    });
    const text = R.sentenceText(R.roomSentence(room, { now: at - 5 * MIN }));
    expect(text).not.toMatch(/\b2[1-3]:0[0-9]\b/);
  });
});
