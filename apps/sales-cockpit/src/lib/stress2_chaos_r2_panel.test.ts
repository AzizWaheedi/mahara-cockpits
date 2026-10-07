// bun test apps/sales-cockpit/src/lib/stress2_chaos_r2_panel.test.ts
//
// Second series, round 2, chaos: what the room panel says when the server
// side was cut off half way (sales-api's stress2_chaos_r2_rooms.test.ts
// reproduces each server state). A test that fails here is a finding.
import { describe, expect, mock, test } from "bun:test";

mock.module("./api", () => ({
  api: async () => ({ ok: true }),
}));

const { roomSentence, sentenceText } = await import("./rooms");
const { baseRoom } = await import("../dev/roomFixtures");

const NOW = Date.parse("2026-10-04T08:00:00Z");
const MIN = 60_000;

describe("chaos2 r2: the panel after a count that failed on a database blip", () => {
  test("count-mark-blip-final-failed-silent (panel): the room carried the lead's booked intro and the count's mark failed: the sentence must never tell the rep to book a call (the intro is booked already)", () => {
    const room = baseRoom(NOW, {
      purpose: "fallback",
      call_kind: "intro",
      state: "lead_in",
      appointment_id: "intro-r2",
      contact_id: "stress-chaos2r2-lead-0001",
      contact_first_name: "Huda",
      link_sent_at: new Date(NOW - 4 * MIN).toISOString(),
      host_in_at: new Date(NOW - 3 * MIN).toISOString(),
      lead_in_at: new Date(NOW - 2 * MIN).toISOString(),
      count_result: "failed",
    });
    const said = sentenceText(
      roomSentence(room, { now: NOW, canMarkIntro: true }),
    );
    // Today: "Huda joined at 10:58. Not in HighLevel: book and mark it by hand."
    expect(said).not.toMatch(/\bbook\b/i);
  });
});
