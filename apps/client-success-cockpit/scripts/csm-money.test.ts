import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as money from "../src/lib/csmMoney";
import {
  basePay,
  CHURN_BANDS,
  closeTheGap,
  computePay,
  EARNERS,
  earned,
  qualifyingFrom,
  rateLabel,
  retentionBonus,
  roundPct,
  usd,
} from "../src/lib/csmMoney";

const ROOT = resolve(import.meta.dir, "../../..");
const earner = (id: string) => {
  const e = EARNERS.find(x => x.id === id);
  if (!e) throw new Error(`no earner ${id}`);
  return e;
};

/** The client success manager plan as the contract seeds it (PAY-PLANS.md §2). */
function contractPlan(): {
  parts: { key: string; [k: string]: unknown }[];
} {
  const doc = readFileSync(resolve(ROOT, "docs/pay/PAY-PLANS.md"), "utf8");
  const m = doc.match(
    /\/\/ Client success manager\n([\s\S]*?)\n\n\/\/ Systems manager/,
  );
  if (!m) throw new Error("the CSM plan is not in PAY-PLANS.md section 2");
  return JSON.parse(m[1]);
}
const part = (key: string) => {
  const p = contractPlan().parts.find(x => x.key === key);
  if (!p) throw new Error(`no part ${key} in the contract`);
  return p as Record<string, any>;
};

describe("base pay", () => {
  test("$2,000, plus $50 per qualifying client over 20", () => {
    expect(basePay(0)).toBe(2000);
    expect(basePay(18)).toBe(2000);
    expect(basePay(20)).toBe(2000);
    expect(basePay(21)).toBe(2050);
    expect(basePay(26)).toBe(2300);
    // A part client is not a client; a blank count is no clients over 20.
    expect(basePay(20.9)).toBe(2000);
    expect(basePay(Number.NaN)).toBe(2000);
  });

  test("the pre-fill counts Active cards live 30 days and not late, nothing else", () => {
    expect(
      qualifyingFrom([
        { stage: "Active", liveDays: 30, paymentDue: 0 },
        { stage: "Active", liveDays: 120, paymentDue: -5 },
        { stage: "Active", liveDays: 64, paymentDue: null },
        { stage: "Active", liveDays: 29, paymentDue: 0 },
        { stage: "Active", liveDays: 90, paymentDue: 1 },
        { stage: "Active", liveDays: null, paymentDue: 0 },
        { stage: "Paused", liveDays: 200, paymentDue: 0 },
        { stage: "Stopped", liveDays: 200, paymentDue: 0 },
        { stage: "LAUNCH BOOKED", liveDays: 0, paymentDue: 0 },
      ]),
    ).toBe(3);
    expect(qualifyingFrom([])).toBe(0);
  });

  test("matches the contract's per-client part", () => {
    const over = part("over_20");
    expect(over.kind).toBe("per_above");
    expect(money.OVER_CLIENTS).toBe(over.over);
    expect(money.PER_CLIENT_OVER_USD).toBe(over.amount);
  });
});

describe("the retention bonus: a band runs until the next band starts", () => {
  test.each([
    [0, 2000],
    [4.55, 1500],
    [4.995, 1000],
    [8.7, 1000],
    [15, 0],
    [15.01, -250],
  ])("%p%% pays %p", (pct, bonus) => {
    expect(retentionBonus(pct).bonus).toBe(bonus);
  });

  test.each([
    [0.01, 1500],
    [5, 1000],
    [9, 500],
    [9.995, 500],
    [11, 250],
    [12.995, 0],
    [13, 0],
    [14.995, 0],
    [15.004, 0],
    [15.005, -250],
    [40, -250],
  ])("the edges: %p%% pays %p", (pct, bonus) => {
    expect(retentionBonus(pct).bonus).toBe(bonus);
  });

  test("1 of 22 lost (4.55%) pays $1,500, as decision 4 says", () => {
    expect(retentionBonus((1 / 22) * 100)).toEqual({
      bonus: 1500,
      band: "Above 0%, under 5%",
    });
  });

  test("rounds to 0.01 half away from zero from the decimal text", () => {
    expect(roundPct(4.995)).toBe(5);
    expect(roundPct(14.995)).toBe(15);
    expect(roundPct((1 / 22) * 100)).toBe(4.55);
    expect(roundPct(4.994)).toBe(4.99);
    expect(roundPct(0.0000001)).toBe(0);
    expect(roundPct(-4.995)).toBe(-5);
  });

  test("the bands are the contract's retention part, edge for edge", () => {
    const bands = part("retention").bands as {
      upTo: number | null;
      inclusive?: boolean;
      amount: number;
    }[];
    expect(
      CHURN_BANDS.map(b => ({
        upTo: b.upTo,
        ...(b.inclusive === undefined ? {} : { inclusive: b.inclusive }),
        amount: b.amount,
      })),
    ).toEqual(bands);
  });
});

describe("the earners", () => {
  test("every amount and rate is the contract's", () => {
    expect(earner("renewal").rate).toBe(part("renewals").amount);
    expect(earner("reactivation").rate).toBe(part("reactivations").amount);
    expect(earner("referral").rate).toBe(part("referrals").amount);
    expect(earner("testimonial").rate).toBe(part("video_testimonials").amount);
    expect(earner("review").rate).toBe(part("google_reviews").amount);
    expect(earner("podcast").rate).toBe(part("podcasts").amount);
    expect(earner("upsell_cash").rate).toBe(part("upsells").steps[0].rate);
    const recurring = part("recurring").steps;
    expect(recurring).toEqual([
      { fromMonth: 1, rate: 0.2 },
      { fromMonth: 2, rate: 0.05 },
    ]);
    expect(earner("recurring_first").rate).toBe(recurring[0].rate);
    expect(earner("recurring_after").rate).toBe(recurring[1].rate);
  });

  test("renewals and reactivations $300, referral $250, proof assets $150, $75, $250", () => {
    expect(
      [
        "renewal",
        "reactivation",
        "referral",
        "testimonial",
        "review",
        "podcast",
      ].map(id => [id, earner(id).kind, earner(id).rate]),
    ).toEqual([
      ["renewal", "each", 300],
      ["reactivation", "each", 300],
      ["referral", "each", 250],
      ["testimonial", "each", 150],
      ["review", "each", 75],
      ["podcast", "each", 250],
    ]);
  });

  test("upsells pay 10% of cash; recurring 20% of the first month, then 5%", () => {
    expect(earned(earner("upsell_cash"), 3500)).toBe(350);
    expect(earned(earner("upsell_cash"), 1234.5)).toBe(123.45);
    expect(earned(earner("recurring_first"), 1000)).toBe(200);
    expect(earned(earner("recurring_after"), 1000)).toBe(50);
    expect(rateLabel(earner("upsell_cash"))).toBe("10% of cash");
    expect(rateLabel(earner("recurring_first"))).toBe("20% of cash");
    expect(rateLabel(earner("recurring_after"))).toBe("5% of cash");
    expect(rateLabel(earner("renewal"))).toBe("$300 each");
  });

  test("no penalties: the contract has none", () => {
    expect("PENALTIES" in money).toBe(false);
    expect("PENALTY_CAP" in money).toBe(false);
    expect(EARNERS.every(e => e.rate > 0)).toBe(true);
    expect(EARNERS.map(e => e.id)).not.toContain("extension");
    expect(EARNERS.map(e => e.id)).not.toContain("rescue");
  });
});

describe("the month", () => {
  test("base + retention + commission, nothing taken off", () => {
    const pay = computePay(22, 4.55, {
      renewal: 1,
      reactivation: 1,
      upsell_cash: 2000,
      recurring_first: 1000,
      recurring_after: 1000,
      referral: 1,
      testimonial: 1,
      review: 2,
      podcast: 1,
      // Counts saved under the old plan are read as nothing.
      extension: 3,
      rescue: 2,
      smm: 4,
      website: 1,
    });
    expect(pay).toEqual({
      base: 2100,
      retention: 1500,
      band: "Above 0%, under 5%",
      commission: 300 + 300 + 200 + 200 + 50 + 250 + 150 + 150 + 250,
      total: 2100 + 1500 + 1850,
    });
  });

  test("over 15% churn takes $250 off; unknown churn is no bonus, said so", () => {
    expect(computePay(18, 15.01, {}).total).toBe(1750);
    expect(computePay(18, null, {})).toMatchObject({
      retention: 0,
      band: "churn unknown",
      total: 2000,
    });
    expect(computePay(18, Number.NaN, {}).band).toBe("churn unknown");
  });

  test("a gap reads in referrals, upsell cash and testimonials", () => {
    expect(closeTheGap(250)).toEqual({
      referrals: 1,
      upsellCash: 2500,
      testimonials: 2,
    });
    expect(closeTheGap(-10)).toEqual({
      referrals: 0,
      upsellCash: 0,
      testimonials: 0,
    });
  });

  test("dollars read signed, with cents only when there are any", () => {
    expect(usd(-250)).toBe("-$250");
    expect(usd(2000)).toBe("$2,000");
    expect(usd(123.4)).toBe("$123.40");
    expect(usd(0)).toBe("$0");
  });
});

test("the media buyer's copy is the same file", () => {
  const read = (app: string) =>
    readFileSync(resolve(ROOT, `apps/${app}/src/lib/csmMoney.ts`), "utf8");
  expect(read("media-buyer-cockpit")).toBe(read("client-success-cockpit"));
});
