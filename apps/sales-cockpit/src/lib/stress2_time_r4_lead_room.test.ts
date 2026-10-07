// TIME stress, second series, round 4: a closer's demo in a video room made
// from the lead page, and the clock that room keeps.
//
// bun test src/lib/stress2_time_r4_lead_room.test.ts   (from apps/sales-cockpit)
//
// A room's planned length is rooms.lengths_min of its call_kind (intro 30,
// demo 60): the database's rooms guard sets ends_at = opened + that length
// when the worker opens it (20261003d), the panel asks "Still on the call?"
// once a room with the lead in it passes ends_at (lib/rooms.ts roomMoment
// "still_on_call"), and the sweep's R7 closes it "in the books" at ends_at +
// no_end_signal (30 min): presence then reads the host as free, and the
// short link says the call has ended. sales-api refuses a Basic Zoom only for
// a demo (roomlogic zoom_basic_demo). The lead page's "Send a video link" is
// the only video room a closer can make today (live.ask is not built), and
// LeadPage.tsx hands VideoPicker callKind="intro" whoever the seat is.
//
// The wiring is JSX inside LeadPage (no pure function), so it is read from
// the source. A test that fails here is a finding.

import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { RoomView } from "./rooms";

mock.module("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
const { roomMoment } = await import("./rooms");

const page = readFileSync(
  new URL("../pages/LeadPage.tsx", import.meta.url),
  "utf8",
);

/** The lead page's VideoPicker for a manual room. */
function manualPicker(): string {
  const start = page.indexOf("<VideoPicker");
  const end = page.indexOf("/>", page.indexOf("onCancel", start));
  if (start < 0 || end < 0)
    throw new Error(
      "the lead page's VideoPicker was not found in LeadPage.tsx",
    );
  return page.slice(start, end);
}

const kw = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}:00+03:00`);
const iso = (t: number) => new Date(t).toISOString();

/** The closer's lead-page room as sales-api serves it once the lead is in: made at 15:00, intro kind. */
function closerRoom(): RoomView {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    code: "K7Q2MX",
    contact_id: "stress-t2r4-lead-room",
    contact_first_name: "Huda",
    purpose: "manual",
    call_kind: "intro",
    provider: "zoom",
    host_email: "closer@stress.invalid",
    state: "lead_in",
    version: 6,
    short_url: null,
    join_url: "https://us06web.zoom.us/j/85012345678?pwd=stress",
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(kw("15:00")),
    link_unconfirmed_at: null,
    first_open_at: iso(kw("15:01")),
    open_device: "phone",
    lead_waiting_at: null,
    host_in_at: iso(kw("15:00")),
    lead_in_at: iso(kw("15:02")),
    ended_at: null,
    host_by: iso(kw("15:15")),
    lead_by: iso(kw("15:10")),
    // The guard's ends_at for an intro: opened + 30 minutes.
    ends_at: iso(kw("15:30")),
    result: null,
    count_result: null,
    error: null,
    refusal: null,
    created_at: iso(kw("15:00")),
  } as unknown as RoomView;
}

describe("Sunday 15:00: a closer takes a lead who wants their demo now into a video room from the lead page", () => {
  test("fixed: the lead page asks a manual room by the seat's role (a closer's is a demo)", () => {
    expect(manualPicker()).toContain("callKind={roomKind}");
    expect(page).toMatch(
      /const roomKind: "intro" \| "demo" = me\.role === "closer" \? "demo" : "intro";/,
    );
  });

  test("a closer's room is asked for as a demo (60 minutes), never as a 30-minute intro", () => {
    // Found: callKind="intro" for a closer too. The room's end is 15:30, the
    // panel asks "Still on the call?" half an hour into the demo, and with no
    // answer the sweep closes it at 16:00 while the demo goes on.
    expect(manualPicker()).not.toMatch(/callKind="intro"/);
  });

  test("consequence: 31 minutes into the demo the panel already asks 'Still on the call?'", () => {
    expect(roomMoment(closerRoom(), kw("15:31"))).toBe("still_on_call");
  });
});
