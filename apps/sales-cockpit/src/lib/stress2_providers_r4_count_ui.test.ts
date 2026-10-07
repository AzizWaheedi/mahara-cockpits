// bun test apps/sales-cockpit/src/lib/stress2_providers_r4_count_ui.test.ts
//
// Second series, round 4, provider quirks: what the room panel says after
// HighLevel's burst limit (429) refused the live count's move of the lead's
// booked call to the join (sales-api's stress2_providers_r4_count.test.ts
// reproduces the server state: count_result "failed", no alert, never tried
// again). The room is the lead page's Video call (purpose manual), so it
// carries no appointment_id, though the lead has an intro booked tomorrow.
// A test that fails here is a finding.
import { describe, expect, mock, test } from "bun:test";

mock.module("./api", () => ({
  api: async () => ({ ok: true }),
}));

const { roomSentence, sentenceText } = await import("./rooms");
const { baseRoom } = await import("../dev/roomFixtures");

const NOW = Date.parse("2026-10-05T08:00:00Z");
const MIN = 60_000;

describe("providers2 r4: the panel after a 429 on the count's move", () => {
  test("count-429-final-move-says-book-by-hand (panel): the lead has an intro booked; the sentence must never tell the rep to book a call", () => {
    const room = baseRoom(NOW, {
      purpose: "manual",
      call_kind: "intro",
      state: "lead_in",
      appointment_id: null,
      contact_id: "stress-p2r4-count-000001",
      contact_first_name: "Huda",
      link_sent_at: new Date(NOW - 4 * MIN).toISOString(),
      host_in_at: new Date(NOW - 3 * MIN).toISOString(),
      lead_in_at: new Date(NOW - 2 * MIN).toISOString(),
      count_result: "failed",
    });
    const said = sentenceText(
      roomSentence(room, { now: NOW, canMarkIntro: true }),
    );
    // A second booking beside the intro the count failed to move is two
    // intros for one lead in B2B's numbers.
    expect(said, `the panel says: "${said}"`).not.toMatch(/\bbook\b/i);
  });
});
