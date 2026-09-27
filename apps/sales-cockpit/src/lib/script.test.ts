import { describe, expect, test } from "bun:test";
import {
  firstSentence,
  lineParts,
  personalise,
  personaliseMarked,
} from "./script";

const tokens = {
  "PROJECT VALUE": "85,000 KWD",
  "GAP YEAR": "793,000 KWD",
  "GAP MONTH": "66,000 KWD",
  "BOOKING RATE": "18%",
  "YEARS IN BUSINESS": "12 years",
};

describe("filling the script's numbers", () => {
  test("named and numbers placeholders, the old dollar ones too", () => {
    expect(
      personalise("[NAME], at your average of $[V] that's $[gap] a year.", {
        name: "Faisal",
        tokens,
      }),
    ).toBe("Faisal, at your average of 85,000 KWD that's 793,000 KWD a year.");
    expect(
      personalise("another $[monthly figure] going to whoever picks up", {
        tokens,
      }),
    ).toBe("another 66,000 KWD going to whoever picks up");
    expect(
      personalise("So in the last [X years in business] you've never", {
        tokens,
      }),
    ).toBe("So in the last 12 years you've never");
    expect(personalise("من [X سنين في الشغل]", { tokens })).toBe("من 12 years");
  });

  test("what the rep works out on the call stays as written", () => {
    expect(
      personalise("[Company A] signed $[X] in [calculate]", { tokens }),
    ).toBe("[Company A] signed $[X] in [calculate]");
    expect(
      personalise("You're at [BOOKING RATE], ours [OUR BOOKING RATE]", {
        tokens,
      }),
    ).toBe("You're at 18%, ours [OUR BOOKING RATE]");
  });

  test("marked: what the notes filled, and the numbers still to ask for", () => {
    const marked = personaliseMarked(
      "You're at [BOOKING RATE], ours [OUR BOOKING RATE]. [X] too.",
      {
        tokens,
      },
    );
    expect(lineParts(marked)).toEqual([
      { kind: "text", text: "You're at " },
      { kind: "filled", text: "18%" },
      { kind: "text", text: ", ours " },
      { kind: "blank", token: "OUR BOOKING RATE" },
      { kind: "text", text: ". [X] too." },
    ]);
  });

  test("the bullet view never breaks a mark", () => {
    const marked = personaliseMarked(
      "Each one costs you about [PROJECT VALUE]. Then more.",
      {
        tokens,
      },
    );
    const parts = lineParts(firstSentence(marked));
    expect(parts).toEqual([
      { kind: "text", text: "Each one costs you about " },
      { kind: "filled", text: "85,000 KWD" },
      { kind: "text", text: "." },
    ]);
    // Cut mid-value, the value still closes.
    expect(lineParts(`${marked.slice(0, 28)}`)).toEqual([
      { kind: "text", text: "Each one costs you about " },
      { kind: "filled", text: "85" },
    ]);
  });
});
