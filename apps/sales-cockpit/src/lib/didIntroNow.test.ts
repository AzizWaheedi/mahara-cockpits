// Did the intro now (the CEO, 2026-11-07): "For confirming the intro, he
// should be able to confirm to book. If he gets them on the phone, he should
// be able to book them for the demo then and there."
//
// bun test src/lib/didIntroNow.test.ts   (from apps/sales-cockpit)
//
// On an intro's confirmation call the grid's held button is "Did the intro
// now": it is saved with held_now (sales-api marks the intro held before its
// booked time), and the held step with Book the demo opens. A demo's
// confirmation has no held button. The grid is JSX data inside DialerPage, so
// its words are read from the source, as m1_journeys_r6_ui.test.ts does.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { QueueItem } from "./dialer";
import { afterSave, heldNowAsked, outcomeOffered } from "./dialerUi";
import { HELD_NOW_LINE, itemWords } from "./setterDay";

const page = readFileSync(
  new URL("../pages/DialerPage.tsx", import.meta.url),
  "utf8",
);

/** The confirm grid's entries as written in DialerPage's OUTCOMES. */
function confirmGrid(): string {
  const start = page.indexOf(
    "const OUTCOMES: Record<ItemKind, OutcomeDef[]> = {",
  );
  const body = page.slice(start, page.indexOf("\n};", start));
  return body.slice(body.indexOf("confirm: ["));
}

describe("the confirm grid's held button", () => {
  test("keeps the key showed and reads Did the intro now, with what it does and what to tell the lead", () => {
    const grid = confirmGrid();
    const entry = grid.slice(
      grid.indexOf('key: "showed"'),
      grid.indexOf("},", grid.indexOf('key: "showed"')),
    );
    expect(entry).toContain('label: "Did the intro now"');
    expect(entry).toContain("needsNote: true");
    expect(entry).toContain(
      'hint: "You had the intro on this call, from the dialer or the Maqsam softphone, after at least 3 minutes on it. Marks it held now (in HighLevel too), then book the demo. Tell them the booked time is no longer needed."',
    );
    expect(grid).not.toContain('"Held the intro"');
  });

  test("shows on an intro's confirmation only", () => {
    expect(outcomeOffered("confirm", "showed", "intro")).toBe(true);
    expect(outcomeOffered("confirm", "showed", "demo")).toBe(false);
    expect(outcomeOffered("confirm", "showed", null)).toBe(false);
    expect(outcomeOffered("confirm", "showed", undefined)).toBe(false);
    // Every other button is as before, on every item.
    for (const key of ["confirmed", "no_answer", "rescheduled", "cancelled"])
      expect(outcomeOffered("confirm", key, "demo")).toBe(true);
    expect(outcomeOffered("intro", "showed", "intro")).toBe(true);
    expect(outcomeOffered("intro", "showed", "demo")).toBe(true);
    expect(outcomeOffered("lead", "callback", null)).toBe(true);
    // The page filters its grid with it (and with who may mark the intro).
    expect(page).toMatch(
      /\.filter\(o =>\s+outcomeOffered\(\s+kind,\s+o\.key,\s+appt\?\.type,/,
    );
  });
});

describe("saving it", () => {
  test("asks sales-api to mark it held now, except after the lead joined the video room", () => {
    expect(heldNowAsked("confirm", "showed", false)).toBe(true);
    // The joined step's Held the intro: the room's join lets the mark pass.
    expect(heldNowAsked("confirm", "showed", true)).toBe(false);
    for (const outcome of ["confirmed", "no_answer", "cancelled"])
      expect(heldNowAsked("confirm", outcome, false)).toBe(false);
    expect(heldNowAsked("intro", "showed", false)).toBe(false);
    expect(heldNowAsked("lead", "showed", false)).toBe(false);
    expect(page).toMatch(
      /\.\.\.\(heldNowAsked\(kind, d\.outcome, Boolean\(joinedAt\)\)\s*\?\s*\{ held_now: true \}\s*:\s*\{\}\)/,
    );
  });

  test("opens the held step (Book the demo) once the mark is saved; a demo's confirmation moves on", () => {
    expect(afterSave("confirm", "showed", false, "intro")).toBe("held");
    expect(afterSave("confirm", "showed", false, "demo")).toBe("next");
    expect(afterSave("confirm", "confirmed", false, "intro")).toBe("next");
    expect(page).toContain(
      'afterSave(kind, outcome, then === "message", appt?.type ?? null)',
    );
  });
});

describe("the confirmation item's words", () => {
  const confirm = (code: string, type: "intro" | "demo"): QueueItem =>
    ({
      contact_id: "c1",
      name: "Lead",
      tier: 0,
      kind: "confirm",
      code,
      why: "Confirm",
      appointment: {
        id: "a1",
        type,
        start_at: null,
        booked_at: null,
        assigned_user_id: null,
        confirmed: false,
      },
    }) as unknown as QueueItem;

  test("an intro's confirmation says how to do the intro now and book the demo", () => {
    expect(HELD_NOW_LINE).toBe(
      "Got them now? Do the intro, press Did the intro now, then Book the demo.",
    );
    expect(itemWords(confirm("confirm", "intro"))?.detail).toBe(
      `Not confirmed yet. Call to check they are still coming. ${HELD_NOW_LINE}`,
    );
    expect(itemWords(confirm("confirm_last", "intro"))?.detail).toBe(
      `The first confirmation call rang out. This is the last try before the call. ${HELD_NOW_LINE}`,
    );
    expect(itemWords(confirm("confirm_early", "intro"))?.detail).toBe(
      HELD_NOW_LINE,
    );
    expect(itemWords(confirm("confirm", "intro"))?.label).toBe(
      "Confirm, 2.5 h before",
    );
  });

  test("a seat that may not mark the intro is not told to press it (fix pass 2)", () => {
    for (const code of ["confirm", "confirm_last", "confirm_early"]) {
      expect(
        itemWords(confirm(code, "intro"), false)?.detail ?? "",
      ).not.toContain("Did the intro now");
      expect(itemWords(confirm(code, "intro"), true)?.detail).toContain(
        HELD_NOW_LINE,
      );
    }
    expect(itemWords(confirm("confirm", "intro"), false)?.detail).toBe(
      "Not confirmed yet. Call to check they are still coming.",
    );
    // The page passes who may mark the item's intro, in all three places.
    expect(page).toContain(
      "const mayMarkItem = mayMarkCall(me, item?.appointment?.assigned_user_id);",
    );
    expect(page.match(/itemWords\(item, mayMarkItem\)/g)).toHaveLength(3);
    expect(page).not.toMatch(/itemWords\(item\)/);
  });

  test("the call band says it too, on an intro's confirmation only, to a seat that may mark it", () => {
    expect(page).toMatch(
      /item\?\.appointment\?\.type === "intro" && mayMark \? ` \$\{HELD_NOW_LINE\}` : ""/,
    );
    expect(page).toContain("mayMark = false,");
    expect(page).toContain("mayMark={mayMarkCall(me, appt?.assigned_user_id)}");
    // Both of the band's confirmation lines (due now, and later today).
    expect(
      page.match(/not confirmed yet\.[^`]*\$\{heldNowLine\}`/g),
    ).toHaveLength(2);
  });

  test("a demo's confirmation keeps its words", () => {
    expect(itemWords(confirm("confirm", "demo"))?.detail).toBe(
      "Not confirmed yet. Call to check they are still coming.",
    );
    expect(itemWords(confirm("confirm_early", "demo"))?.detail).toBeNull();
  });
});
