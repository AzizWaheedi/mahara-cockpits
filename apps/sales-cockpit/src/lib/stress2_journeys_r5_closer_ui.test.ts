// Stress series 2, round 5, journeys: a closer's own dialer queue, a missed
// call, a video link, and the lead joins.
//
// bun test src/lib/stress2_journeys_r5_closer_ui.test.ts   (from apps/sales-cockpit)
//
// Walked in the harness first (/sales/harness.html?path=/dialer&call=noanswer,
// Closer queue): Khalid, "Showed, not signed yet" (dialer.ts rankForCloser,
// kind "lead": his demo was held), Call, Maqsam saves No answer, Send a video
// link: the room is made with call_kind "demo" (DialerPage roomKind for a
// closer). Khalid joins (room lead_in). The step under the panel reads
// "Khalid joined the video call. How did the intro go?" and "Book the demo
// while they are warm, or save how it went." with [Book the demo] as its
// primary button: a closer whose lead just had his closing call is asked
// about an intro that was held long ago and led to book him another demo.
// On the closer's "Confirm the demo" item (kind "confirm") the same step asks
// "Are they coming to the intro?" about a demo.
//
// The step is JSX inside DialerPage (no pure function), so its words are
// read from the source, as stress2_time_r2_confirm_ui.test.ts does.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../pages/DialerPage.tsx", import.meta.url),
  "utf8",
);
const dialer = readFileSync(
  new URL(
    "../../../../supabase/functions/sales-api/dialer.ts",
    import.meta.url,
  ),
  "utf8",
);

/** The step shown after a miss once the lead joined the video room. */
function joinedStep(): string {
  const start = page.indexOf('mode === "unanswered" && joinedAt ? (');
  const end = page.indexOf(') : mode === "unanswered" && spoke ? (', start);
  if (start < 0 || end < 0)
    throw new Error("the joined step was not found in DialerPage.tsx");
  return page.slice(start, end);
}

describe("setup: the closer's queue and room", () => {
  test("a closer's 'Showed, not signed yet' lead is a lead item (kind lead)", () => {
    expect(dialer).toMatch(/kind: "lead", why: "Showed, not signed yet"/);
  });
  test("a closer's video room is a demo (roomKind)", () => {
    expect(page).toMatch(
      /const roomKind: "intro" \| "demo" = as === "closer" \? "demo" : "intro";/,
    );
  });
});

describe("journey: Khalid (showed at his demo, not signed) misses the closer's call, joins the video link the closer sends", () => {
  test("the step after the join does not ask how 'the intro' went nor lead with Book the demo for a closer's demo call", () => {
    const step = joinedStep();
    const title = /title=\{`[^`]*`\}/.exec(step)?.[0] ?? "";
    // What should hold: the step reads the room's kind (a demo) or the seat
    // (as === "closer") before it names the call or its next booking.
    const readsDemo = /roomKind|as === "closer"|call_kind/.test(step);
    expect({
      readsDemo,
      asksAboutIntro: /How did the intro go\?/.test(title),
    }).toEqual({ readsDemo: true, asksAboutIntro: false });
  });

  test("on the closer's 'Confirm the demo' item the step does not ask whether they are coming to 'the intro'", () => {
    const step = joinedStep();
    const title = /title=\{`[^`]*`\}/.exec(step)?.[0] ?? "";
    expect(title).not.toMatch(/Are they coming to the intro\?/);
  });
});
