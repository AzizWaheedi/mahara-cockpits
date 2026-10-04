import { describe, expect, test } from "bun:test";
import { PLANS, planFor, planHint } from "./plans";

describe("the payment plans", () => {
  test("each adds up to its contract's fee, $500 first", () => {
    const fee = { "3 months": 6000, "60 days": 4000, Monthly: 2000 } as const;
    for (const p of PLANS) {
      expect(p.onCall).toBe(500);
      expect(p.total).toBe(fee[p.program]);
      if (p.renews) {
        // The month is paid by onboarding; the same fee comes again each month.
        expect(p.onCall + p.byOnboarding).toBe(p.total);
        expect(p.later).toBe(p.total);
      } else expect(p.onCall + p.byOnboarding + p.later).toBe(p.total);
    }
  });

  test("split pay is $500 on the call, the rest of half by onboarding, the other half 30 days later", () => {
    const split = planFor("Split pay ($3,000 + $3,000 after 30 days)");
    expect([split?.onCall, split?.byOnboarding, split?.later]).toEqual([
      500, 2500, 3000,
    ]);
    const sixty = planFor("Split pay ($2,000 + $2,000 after 30 days)");
    expect([sixty?.onCall, sixty?.byOnboarding, sixty?.later]).toEqual([
      500, 1500, 2000,
    ]);
    const monthly = planFor("Monthly ($2,000 a month)");
    expect([monthly?.byOnboarding, monthly?.later, monthly?.renews]).toEqual([
      1500,
      2000,
      true,
    ]);
  });

  test("a plan is found by its exact label only", () => {
    expect(planFor("Paid in full ($6,000)")?.later).toBe(0);
    expect(planFor(" Paid in full ($4,000) ")?.total).toBe(4000);
    expect(planFor("Paid in full (90 days)")).toBeNull();
    expect(planFor("Monthly")).toBeNull();
    expect(planFor(null)).toBeNull();
  });

  test("the hint gives every contract's amounts for one question", () => {
    expect(planHint("onCall")).toBe("500 on every plan.");
    expect(planHint("byOnboarding")).toBe(
      "3 months: 5500 paid in full, 2500 split. 60 days: 3500 paid in full, 1500 split. Monthly: 1500.",
    );
    expect(planHint("total")).toBe(
      "3 months: 6000. 60 days: 4000. Monthly: 2000.",
    );
  });
});
