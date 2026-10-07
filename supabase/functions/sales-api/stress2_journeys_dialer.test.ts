// Stress series 2, round 1: the setter's whole journey through a missed
// intro call, a video link the lead joins, and "Book the demo" from the
// dialer's "{name} joined the video call. How did the intro go?" step
// (DialerPage.tsx CallPane, final review 96f1347), then the queue after it.
//
// bun test supabase/functions/sales-api/stress2_journeys_dialer.test.ts

import { describe, expect, test } from "bun:test";
import { type Appt, appointmentWork, introWaiting } from "./dialer.ts";

const MIN = 60_000;
/** Kuwait wall time on Thursday 8 October 2026. */
const kw = (hhmm: string) => Date.parse(`2026-10-08T${hhmm}:00+03:00`);

describe("journey: a missed intro call, the lead joins the video link, the setter books the demo", () => {
  test("after Book the demo the same intro must not come back to the top of the setter's queue as 'Intro call now'", () => {
    // 14:00 the setter's intro with Huda (booked yesterday, confirmed). The
    // dialer rings at 14:00, nobody answers: Maqsam's record saves No answer
    // on the intro item (attempt saved item_kind intro, outcome no_answer:
    // index.ts introTries is that save). The setter sends a Meet link; Huda
    // joins at 14:02 (The lead is in); they talk; Finished at 14:12. The
    // dialer says "Huda joined the video call. How did the intro go?" with
    // Book the demo as its first button. The setter books tomorrow's demo at
    // 14:13: book.create saves "booked" on the lead and never marks the
    // intro; Book the demo skips the "Held the intro" save (dial.save
    // outcome showed) that the held path makes first. The intro stays
    // confirmed, so it is still the lead's current appointment (index.ts
    // candidates: from twenty minutes ago on, not showed), and the room is
    // final, so rooms.held no longer holds the lead.
    const intro: Appt = {
      id: "appt-intro-huda",
      type: "intro",
      start: kw("14:00"),
      booked: kw("14:00") - 24 * 60 * MIN,
      status: "confirmed",
      assigned: "G-setter",
      confirmed: true,
      last_try: kw("14:00") + 30_000,
      // Fixed in fix round 1: index.ts candidates reads the room that carried
      // the intro, whose join stands (lead_in_at, not taken back), and the
      // dialer's Book the demo saves "Held the intro" first.
      room_joined: true,
    };
    const now = kw("14:13");
    expect(introWaiting(intro, now)).toBe(false);
    const job = appointmentWork(intro, now, "setter", "G-setter");
    // Tier 0, "Intro call now, booked for 14:00": the top of the queue, with
    // Call the primary button, for a lead who just had that intro on video
    // and booked a demo a minute ago.
    expect(job).toBeNull();
  });
});
