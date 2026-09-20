/** The commission rule: what it is paid on, then the rate in that unit. */
import { describe, expect, test } from "bun:test";
import { commissionRule, commissionText } from "../convex/ceo/commission";

describe("commissionRule", () => {
  test("nothing given is no commission", () => {
    expect(commissionRule({})).toEqual({
      basis: "none",
      rate: null,
      pct: null,
    });
    expect(commissionRule({ basis: "none", rate: 0.5 })).toEqual({
      basis: "none",
      rate: null,
      pct: null,
    });
  });
  test("the old percent alone becomes a share of cash closed, mirrored", () => {
    expect(commissionRule({ pct: 0.1 })).toEqual({
      basis: "closed_cash",
      rate: 0.1,
      pct: 0.1,
    });
  });
  test("a basis given with a percent ignores the percent", () => {
    expect(
      commissionRule({ basis: "per_demo_shown", rate: 50, pct: 0.1 }),
    ).toEqual({
      basis: "per_demo_shown",
      rate: 50,
      pct: null,
    });
    expect(commissionRule({ basis: "per_signed", pct: 0.1 })).toEqual({
      basis: "per_signed",
      rate: null,
      pct: null,
    });
  });
  test("shares are fractions, amounts are amounts", () => {
    expect(commissionRule({ basis: "closed_contract", rate: 0.075 }).pct).toBe(
      0.075,
    );
    expect(() => commissionRule({ basis: "closed_cash", rate: 10 })).toThrow(
      "between 0 and 1",
    );
    expect(
      commissionRule({ basis: "per_intro_shown", rate: 12.3456 }).rate,
    ).toBe(12.3456);
    expect(commissionRule({ basis: "mrr_managed", rate: 0.123456 }).rate).toBe(
      0.1235,
    );
  });
  test("refuses nonsense", () => {
    expect(() => commissionRule({ basis: "closed_cash", rate: -1 })).toThrow(
      "below zero",
    );
    expect(() =>
      commissionRule({ basis: "per_signed", rate: Number.NaN }),
    ).toThrow("a number");
    expect(() =>
      commissionRule({ basis: "per_signed", rate: Number.POSITIVE_INFINITY }),
    ).toThrow("a number");
    // @ts-expect-error a basis the list does not know
    expect(() => commissionRule({ basis: "tips" })).toThrow(
      "not a commission basis",
    );
  });
  test("other keeps no rate; the note says how", () => {
    expect(commissionRule({ basis: "other", rate: 99 })).toEqual({
      basis: "other",
      rate: null,
      pct: null,
    });
  });
});

describe("commissionText", () => {
  test("reads as a sentence in the right unit", () => {
    expect(
      commissionText({ basis: "closed_cash", rate: 0.1 }, "USD", null),
    ).toBe("10% of cash collected on deals they close");
    expect(
      commissionText({ basis: "per_demo_shown", rate: 50 }, "KWD", null),
    ).toBe("KWD 50 per demo that shows up");
    expect(
      commissionText({ basis: "mrr_managed", rate: 0.0525 }, "USD", null),
    ).toBe("5.3% of the monthly revenue of the clients they manage");
    expect(
      commissionText(
        { basis: "other", rate: null },
        "USD",
        "bonus at 10 closes",
      ),
    ).toBe("Other: bonus at 10 closes");
    expect(
      commissionText({ basis: "per_signed", rate: null }, "USD", null),
    ).toBe("Rate not set, per signed deal");
    expect(
      commissionText({ basis: "none", rate: null }, "USD", "x"),
    ).toBeNull();
  });
});
