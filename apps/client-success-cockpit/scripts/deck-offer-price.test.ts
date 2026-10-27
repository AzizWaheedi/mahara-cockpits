import { describe, expect, test } from "bun:test";
import { WEBSITE_ROW } from "../src/dev/offer/fixtures";
import {
  belowList,
  firstYearUsd,
  formatMoney,
  inCurrency,
  listOf,
  openingOf,
} from "../src/present/offer/price";
import { priceProblem } from "../src/present/offer/useOffer";

describe("offer price boundaries", () => {
  test("the first year uses the actual care price for all twelve months", () =>
    expect(firstYearUsd({ build: 1800, care: 225 }, WEBSITE_ROW)).toBe(4500));
  test("blank list is missing, and never treated as zero", () => {
    const r = structuredClone(WEBSITE_ROW);
    r.parts[1].amount = null;
    expect(listOf(r)).toBeNull();
    expect(openingOf(r, {})).toBeNull();
    expect(openingOf(r, { opening_price: { build: 1500, care: 175 } })).toEqual(
      { build: 1500, care: 175 },
    );
  });
  test("incomplete or non-positive typed prices cannot leak a partial bill", () => {
    for (const price of [
      { build: 2000 },
      { build: 2000, care: 0 },
      { build: NaN, care: 200 },
      { build: 1000001, care: 200 },
      { build: 1999.999, care: 200 },
    ])
      expect(openingOf(WEBSITE_ROW, { opening_price: price })).toBeNull();
  });
  test("CSM price is permitted below list with a reason", () => {
    expect(belowList({ build: 1500, care: 200 }, WEBSITE_ROW)).toBe(true);
    expect(
      priceProblem(WEBSITE_ROW, { opening_price: { build: 1500, care: 200 } }),
    ).toContain("one line");
    expect(
      priceProblem(WEBSITE_ROW, {
        opening_price: { build: 1500, care: 200 },
        opening_reason: "Existing project assets reduce the build.",
      }),
    ).toBeNull();
  });
  test("a locked price stays exactly at list", () =>
    expect(
      priceProblem(
        { ...WEBSITE_ROW, locked: true },
        { opening_price: { build: 1999, care: 200 } },
      ),
    ).toContain("locked"));
  test("BHD has no fabricated rate", () =>
    expect(inCurrency(4400, "BHD", null)).toEqual({
      amount: 4400,
      currency: "USD",
    }));
  test("fixed-rate conversion is division by USD per currency", () =>
    expect(inCurrency(3260, "KWD", 3.26).amount).toBeCloseTo(1000, 8));
  test("Arabic amounts use Eastern digits", () =>
    expect(formatMoney(2000, "USD", "ar")).toBe("٢٠٠٠ USD"));
});
