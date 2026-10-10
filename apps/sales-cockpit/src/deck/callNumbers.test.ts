import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { numbersFromCall, USES_CALL_NUMBERS } from "./callNumbers";
import { deckSlides } from "./slides";

describe("the deck's numbers: the call's, or typed on the slide", () => {
  const call = { leads_month: "60", booked_month: "9", showed_month: "" };

  test("two of the four counts saved on the call make them the call's", () => {
    expect(numbersFromCall(call, {})).toBe(true);
    expect(numbersFromCall({ leads_month: "60" }, {})).toBe(false);
    expect(numbersFromCall({ leads_month: " ", booked_month: "9" }, {})).toBe(
      false,
    );
    expect(numbersFromCall({}, {})).toBe(false);
  });

  test("what the closer typed in front of the prospect stays when the call's notes land", () => {
    expect(numbersFromCall(call, { leads_month: "100" })).toBe(false);
    // A blank typed field is not typing.
    expect(numbersFromCall(call, { leads_month: "  " })).toBe(true);
    // Only the four counts count: a project value typed on its own does not.
    expect(numbersFromCall(call, { project_value: "40000" })).toBe(true);
  });

  test("the slides that read the call's numbers again are in the deck, the closing before the numbers", () => {
    const ids = deckSlides().map(s => s.id);
    for (const id of USES_CALL_NUMBERS) expect(ids).toContain(id);
    expect(ids.indexOf("closing")).toBeLessThan(ids.indexOf("numbers"));
  });

  test("every slide that draws the numbers is one that reads them again", () => {
    // The slides' code reaches the numbers through ctx.numbers in two places:
    // closingGain (the closing slide) and numbersSlide.
    const src = readFileSync(new URL("./slides.tsx", import.meta.url), "utf8");
    const users = [
      ...src.matchAll(
        /^function (\w+)\([^)]*\) \{\n {2}const \{[^}]*\bnumbers\b[^}]*\} = ctx;/gm,
      ),
    ].map(m => m[1]);
    expect(users.sort()).toEqual(["closingGain", "numbersSlide"]);
    expect(src).not.toMatch(/\b(c|ctx)\.numbers\b/);
    expect(src).toContain("note: closingGain(c)");
  });
});
