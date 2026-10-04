// TIME stress, second series, round 2: the dialer's confirmation call the
// evening before a booked intro, missed, then a video link the lead joins.
//
// bun test src/lib/stress2_time_r2_confirm_ui.test.ts   (from apps/sales-cockpit)
//
// Saturday 18:05 Kuwait: the dialer's "Confirm the intro tomorrow at 10:00"
// (dialer.ts appointmentWork, confirmFrom: 18:00 the evening before a
// morning call). No answer; the video link button shows on a confirm item
// (DialerPage bookedIntro: kind "intro" or "confirm"); the lead joins the
// room at 18:08 to say "yes, see you tomorrow". CallPane's step after a
// miss with a join (mode "unanswered" and joinedAt) is written for the
// intro itself: whatever the item, its title asks "How did the intro go?",
// and on any item but "intro" its first button is "Book the demo while they
// are warm". On a confirmation call the intro is tomorrow: the rep is asked
// how a call went that has not happened, offered to book the demo before
// it, and the confirmation's own question ("Are they coming?", which saves
// the lead's confirmation) is one press further away.
//
// The step is JSX inside DialerPage (no pure function), so its words are
// read from the source.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../pages/DialerPage.tsx", import.meta.url),
  "utf8",
);

/** The step shown after a miss once the lead joined the video room. */
function joinedStep(): string {
  const start = page.indexOf('mode === "unanswered" && joinedAt ? (');
  const end = page.indexOf(') : mode === "unanswered" ? (', start);
  if (start < 0 || end < 0)
    throw new Error("the joined step was not found in DialerPage.tsx");
  return page.slice(start, end);
}

describe("setup", () => {
  test("a confirm item for a booked intro gets the video link (bookedIntro covers kind confirm)", () => {
    expect(page).toMatch(
      /const bookedIntro =\s*\(kind === "intro" \|\| kind === "confirm"\) && appt\?\.type === "intro";/,
    );
  });
  test("the joined step is shown on any item kind (its condition does not read kind)", () => {
    expect(page).toContain(') : mode === "unanswered" && joinedAt ? (');
  });
});

describe("the lead joins the confirmation call's video room the evening before the intro", () => {
  test("the step does not ask 'How did the intro go?' on a confirm item", () => {
    const step = joinedStep();
    // The title, as written: one sentence for every kind.
    const title = /title=\{`[^`]*`\}/.exec(step)?.[0] ?? "";
    expect(title).toContain("How did the intro go?");
    // Found: nothing in the step tells a confirmation call from the intro;
    // a confirm item gets the intro's question and "Book the demo" first.
    expect(step).toMatch(/kind === "confirm"/);
  });
});
