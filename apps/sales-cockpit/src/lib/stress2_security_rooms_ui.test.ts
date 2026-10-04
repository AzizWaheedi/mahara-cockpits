// bun test src/lib/stress2_security_rooms_ui.test.ts  (from apps/sales-cockpit)
//
// Second series, round 1 (4 October 2026): security and abuse, the room
// panel's side. Each test that was `test.failing` pinned a reproduced finding (its key
// is in its name); fixed in fix round 1, it stays as a regression test.

import { describe, expect, mock, test } from "bun:test";

mock.module("./api", () => ({
  api: async () => ({}),
}));

const R = await import("./rooms");

const NOW = Date.parse("2026-10-04T07:10:00Z");

/** sales-api's ROOMS_COPY.link_flood, word for word (rooms.ts). */
const LINK_FLOOD =
  "This lead has had three call links this hour, so no new one went. Read the code out on the phone.";

const flooded = R.normalizeRoom({
  id: "00000000-0000-4000-8000-0000000000aa",
  code: "K7Q2MX",
  contact_id: "stress-2-lead-1",
  contact_first_name: "Huda",
  purpose: "manual",
  call_kind: "intro",
  provider: "meet",
  host_email: "stress2-host@stress.invalid",
  state: "open",
  version: 3,
  join_url: "https://meet.google.com/abc-defg-hij",
  link_channels: [],
  link_sent_at: null,
  refusal: LINK_FLOOD,
  opened_at: new Date(NOW - 60_000).toISOString(),
  host_by: new Date(NOW + 14 * 60_000).toISOString(),
  ends_at: new Date(NOW + 29 * 60_000).toISOString(),
  created_at: new Date(NOW - 70_000).toISOString(),
});

describe("stress2 security: the panel on a room whose link the cap stopped", () => {
  test("the room is read as it comes (the fixture works)", () => {
    expect(flooded?.refusal).toBe(LINK_FLOOD);
  });

  test("link-flood-cap-bypassed-by-send-by-email: the panel offers Send by email on the fourth room, and room.send sends it", () => {
    const a = R.roomActions(flooded!, { now: NOW });
    const keys = [a.primary?.key, ...a.quiet.map(x => x.key)];
    // The cap said no link goes to this lead this hour; no button should send one.
    expect(R.emailBlocked(flooded!)).toBe(true);
    expect(keys).not.toContain("email");
  });
});
