// TIME stress, second series, round 1: the room panel in the minutes after
// lead_by, while the sweep still holds the room open for the lead's open.
//
// The SQL sweep's R4 (20261003d) closes an open or host_in room at
// max(lead_by, least(last open + open_grace, cap)): a lead who opened the
// link in the last 3 minutes keeps the room open until that open + 180 s
// (capped at link + lead + open_grace). The panel's deadline is lead_by alone
// (rooms.ts roomDeadline), and "overdue" ("This room should have closed.
// Call the lead, or end the room.") is checked before every other moment, two
// minutes after it (OVERDUE_MS), "the sweep is late".
//
//     bun test apps/sales-cockpit/src/lib/stress2_time_panel.test.ts

import { describe, expect, mock, test } from "bun:test";

mock.module("./api", () => ({ api: async () => ({ ok: true }) }));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");

const S = 1000;
const MIN = 60 * S;
const iso = (t: number) => new Date(t).toISOString();
/** lead_by: Thursday 8 October 2026, 11:08:05 Kuwait. */
const LEAD_BY = Date.parse("2026-10-08T08:08:05.000Z");
const GRACE = 180 * S; // rooms.waits_s.open_grace

/** The sweep's R4 due time for this room, as 20261003d computes it. */
function serverDue(linkSent: number, leadBy: number, lastOpen: number): number {
  const cap = linkSent + 600 * S + GRACE;
  return Math.max(leadBy, Math.min(lastOpen + GRACE, cap));
}

describe("a Meet room: the setter is in, the lead opens the link 10 s before lead_by and asks to join", () => {
  const linkSent = LEAD_BY - 600 * S;
  const opened = LEAD_BY - 10 * S;
  const room = F.baseRoom(LEAD_BY - 9 * MIN, {
    state: "host_in",
    provider: "meet",
    version: 6,
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(linkSent),
    lead_by: iso(LEAD_BY),
    host_in_at: iso(linkSent + 20 * S),
    first_open_at: iso(opened),
    open_device: "phone",
  });

  test("setup: the sweep keeps the room open until 11:10:55 (the open + 3 minutes)", () => {
    expect(serverDue(linkSent, LEAD_BY, opened)).toBe(opened + GRACE);
  });

  test("at 11:10:10, still inside the sweep's grace, the panel says to let them in (not 'should have closed ... end the room')", () => {
    const now = LEAD_BY + 2 * MIN + 5 * S;
    expect(now).toBeLessThan(serverDue(linkSent, LEAD_BY, opened));
    expect(R.roomMoment(room, now)).not.toBe("overdue");
    expect(R.roomMoment(room, now)).toBe("host_in_opened");
  });

  test("control: two minutes after the sweep's own due time the panel does say the room should have closed", () => {
    const now = serverDue(linkSent, LEAD_BY, opened) + 2 * MIN + S;
    expect(R.roomMoment(room, now)).toBe("overdue");
  });
});
