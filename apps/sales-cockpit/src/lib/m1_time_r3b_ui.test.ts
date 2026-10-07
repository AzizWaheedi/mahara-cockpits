// Milestone 1, video-link round 3 (second run), the TIME angle, on the lead
// page's own gate (lib/videoLink.ts demoStillOn and videoLinkGate, as
// LeadPage.tsx calls them with the lead's appointments and Date.now()).
//
// bun test src/lib/m1_time_r3b_ui.test.ts   (from apps/sales-cockpit)
//
// A booked demo hides the lead page's Send a video link until it ends. The
// server (sales-api rooms.ts room.create) counts a demo until its stored end,
// else its start plus rooms.booking_min.demo (45 minutes, as shipped and in
// production); production's cockpit_sales_appointments stores no end at all
// (information_schema, 6 October 2026), so the server's rule is start + 45.
// supabase/functions/sales-api/m1_time_r3b.test.ts section 3 shows the
// server making the room at 13:50 for a 13:00 demo. A failing expectation is
// a finding. Every lead is invented.

import { describe, expect, mock, test } from "bun:test";

mock.module("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const { DEMO_LINK_LINE, demoStillOn, gateLine, videoLinkGate } = await import(
  "./videoLink"
);

const S = 1000;
const MIN = 60 * S;
const kw = (s: string) => Date.parse(`${s}+03:00`);
const LEAD = "stress-m1t3b-ui-lead";
/** rooms.booking_min.demo as shipped (roomlogic.ts DEFAULT_ROOMS_JSON) and in production. */
const SERVER_DEMO_MIN = 45;

const setting = {
  enabled: true,
  providers: { meet: true, zoom: true },
  test_only: true,
  test_contacts: [LEAD],
  fallback: {
    scope: "intro",
    pilot_emails: [] as string[],
    auto_on_miss: false,
  },
} as unknown as Parameters<typeof videoLinkGate>[0]["setting"];

describe("Tuesday 6 October: the lead's demo booked for 13:00 (no end stored); the lead page at 13:44:59 and 13:50", () => {
  const start = kw("2026-10-06T13:00:00");
  const rows = [
    {
      call_type: "demo",
      start_at: new Date(start).toISOString(),
      status: "confirmed",
    },
  ];
  const gateAt = (now: number) =>
    videoLinkGate({
      setting,
      contactId: LEAD,
      seatEmail: "setter-m1t3b@stress.invalid",
      purpose: "manual",
      bookedDemo: demoStillOn(rows, now),
      client: false,
      dnd: false,
    } as Parameters<typeof videoLinkGate>[0]);

  test("control: at 13:44:59 the page hides the link, as the server refuses it", () => {
    const g = gateAt(start + 44 * MIN + 59 * S);
    expect(g.show).toBe(false);
    expect(gateLine(g.why)).toBe(DEMO_LINK_LINE);
  });

  test("at 13:50 the page offers the link the server would make (the demo's 45 minutes are over on the server)", () => {
    const now = start + 50 * MIN;
    expect(now >= start + SERVER_DEMO_MIN * MIN).toBe(true);
    const g = gateAt(now);
    // Found when it fails: the page counts a demo for DEMO_MINUTES (60) from
    // its start, the server for booking_min.demo (45), so for 15 minutes
    // after every demo the lead page shows "This demo has its own Zoom link
    // from HighLevel. Send them that link, or call again." where Send a video
    // link should be, for a room the server would make.
    expect({ show: g.show, line: gateLine(g.why) }).toEqual({
      show: true,
      line: null,
    });
  });
});
