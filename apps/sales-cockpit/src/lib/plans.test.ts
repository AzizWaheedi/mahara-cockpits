import { describe, expect, test } from "bun:test";
import { PLANS, planFor, planHint } from "./plans";

describe("the two payment plans", () => {
  test("each adds up to the program fee, $500 first", () => {
    for (const p of PLANS) {
      expect(p.onCall + p.byOnboarding + p.later).toBe(p.total);
      expect(p.total).toBe(6000);
      expect(p.onCall).toBe(500);
    }
  });

  test("split pay is $500 on the call, $2,500 by onboarding, $3,000 30 days later", () => {
    const split = planFor("Split pay ($3,000 + $3,000 after 30 days)");
    expect(split).not.toBeNull();
    expect([split?.onCall, split?.byOnboarding, split?.later]).toEqual([
      500, 2500, 3000,
    ]);
  });

  test("a plan is found by its exact label only", () => {
    expect(planFor("Paid in full ($6,000)")?.later).toBe(0);
    expect(planFor(" Paid in full ($6,000) ")?.total).toBe(6000);
    expect(planFor("Paid in full (90 days)")).toBeNull();
    expect(planFor("Monthly")).toBeNull();
    expect(planFor(null)).toBeNull();
  });

  test("the hint gives both plans' amounts for one question", () => {
    expect(planHint("byOnboarding")).toBe(
      "Paid in full: 5500. Split pay: 2500.",
    );
    expect(planHint("later")).toBe("Paid in full: 0. Split pay: 3000.");
  });
});
