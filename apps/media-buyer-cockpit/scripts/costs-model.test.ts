import { describe, expect, test } from "bun:test";
import {
  BASIS_ON,
  type CostLine,
  closedMonthPay,
  monthlyUsd,
  type Payee,
  type Projection,
  payroll,
  totalOf,
  unpricedToFix,
} from "../src/types/ceo/costsModel";

const FX = { USD: 1, KWD: 3.26 };
const say = {
  money: (v: number) => `$${Math.round(v)}`,
  count: (v: number) => String(Math.round(v)),
};

const line = (over: Partial<CostLine>): CostLine => ({
  id: 1,
  kind: "software",
  name: "Tool",
  category: null,
  billing: "monthly",
  seats: null,
  unitPrice: 0,
  currency: "USD",
  paidWith: null,
  match: null,
  status: "active",
  note: null,
  sort: 0,
  ...over,
});

describe("a line's monthly cost", () => {
  test("seats times the price per seat, so a new seat changes it", () => {
    expect(monthlyUsd(line({ seats: 3, unitPrice: 25 }), FX)).toBe(75);
    expect(monthlyUsd(line({ seats: 4, unitPrice: 25 }), FX)).toBe(100);
  });
  test("a flat price when it is not per seat, a twelfth of a yearly one", () => {
    expect(monthlyUsd(line({ unitPrice: 97 }), FX)).toBe(97);
    expect(
      monthlyUsd(line({ billing: "yearly", seats: 2, unitPrice: 300 }), FX),
    ).toBe(50);
  });
  test("in dollars at the cockpit's fixed rate, and no number without a rate", () => {
    expect(monthlyUsd(line({ unitPrice: 10, currency: "KWD" }), FX)).toBe(32.6);
    expect(monthlyUsd(line({ unitPrice: 10, currency: "GBP" }), FX)).toBeNull();
  });
});

describe("a kind's total", () => {
  test("active lines only, and the ones it could not price are named", () => {
    const lines = [
      line({ id: 1, seats: 3, unitPrice: 25 }),
      line({ id: 2, unitPrice: 20 }),
      line({ id: 3, unitPrice: 50, status: "cancelled" }),
      line({ id: 4, name: "Tesco", unitPrice: 5, currency: "GBP" }),
      line({ id: 5, kind: "marketing", unitPrice: 999 }),
    ];
    expect(totalOf(lines, "software", FX)).toEqual({
      usd: 95,
      lines: 3,
      seats: 3,
      unpriced: ["Tesco"],
    });
  });
});

describe("next month's pay", () => {
  const p: Projection = {
    newCash: 100000,
    contracted: 150000,
    introsShown: 200,
    demosShown: 90,
    closes: 20,
    mrrDue: 16000,
  };
  const person = (over: Partial<Payee>): Payee => ({
    id: 1,
    name: "Someone",
    monthlyUsd: 1000,
    currency: "USD",
    basis: "none",
    rate: null,
    ...over,
  });

  test("a closer on 10% of the cash they close, on $100k of new cash", () => {
    const out = payroll(
      [person({ basis: "closed_cash", rate: 0.1 })],
      p,
      FX,
      say,
    );
    expect(out.lines[0].commission).toBe(10000);
    expect(out.lines[0].on).toBe("10% of $100000");
    expect(out.total).toBe(11000);
  });

  test("two closers split what they are paid on", () => {
    const out = payroll(
      [
        person({ id: 1, basis: "closed_cash", rate: 0.1 }),
        person({ id: 2, basis: "closed_cash", rate: 0.1 }),
      ],
      p,
      FX,
      say,
    );
    expect(out.lines.map(l => l.commission)).toEqual([5000, 5000]);
    expect(out.commission).toBe(10000);
  });

  test("per-unit commissions in the person's currency, at the fixed rate", () => {
    const out = payroll(
      [person({ basis: "per_demo_shown", rate: 10, currency: "KWD" })],
      p,
      FX,
      say,
    );
    // KWD 10 a demo is $32.60, on 90 live demos.
    expect(out.lines[0].commission).toBe(2934);
  });

  test("a commission it cannot price is no number, and pay nobody set is named", () => {
    const out = payroll(
      [
        person({ id: 1, name: "Agent", basis: "other" }),
        person({ id: 2, name: "New hire", monthlyUsd: null }),
        person({ id: 3, name: "Closer", basis: "closed_cash", rate: null }),
      ],
      p,
      FX,
      say,
    );
    expect(out.unpriced).toEqual(["Agent", "Closer"]);
    expect(out.noPay).toEqual(["New hire"]);
    expect(out.base).toBe(2000);
    expect(out.commission).toBe(0);
  });

  test("with no plan number to price on, the commission is not invented", () => {
    const out = payroll(
      [person({ basis: "mrr_managed", rate: 0.05 })],
      { ...p, mrrDue: null },
      FX,
      say,
    );
    expect(out.lines[0].commission).toBeNull();
    expect(out.lines[0].total).toBe(1000);
  });
});

describe("the call centre's two client lines (PAY-PLANS.md decision 2)", () => {
  const p: Projection = {
    newCash: 100000,
    contracted: null,
    introsShown: null,
    demosShown: null,
    closes: null,
    mrrDue: null,
  };
  const agent = (id: number): Payee => ({
    id,
    name: `Agent ${id}`,
    monthlyUsd: 650,
    currency: "USD",
    basis: "per_client_appt_shown",
    rate: 5,
    basis2: "per_client_deal_closed",
    rate2: 20,
  });

  test("paid on client appointments shown and client deals closed", () => {
    expect(BASIS_ON.per_client_appt_shown).toBe("clientApptsShown");
    expect(BASIS_ON.per_client_deal_closed).toBe("clientDealsClosed");
  });

  test("no plan carries them yet: not priced and named, never $0", () => {
    const out = payroll([agent(1), agent(2)], p, FX, say);
    expect(out.lines.map(l => l.commission)).toEqual([null, null]);
    expect(out.unpriced).toEqual(["Agent 1", "Agent 2"]);
    expect(out.commission).toBe(0);
    expect(out.base).toBe(1300);
  });

  test("with the plan numbers, priced and split like any per-unit line", () => {
    const out = payroll(
      [agent(1), agent(2)],
      { ...p, clientApptsShown: 60, clientDealsClosed: 4 },
      FX,
      say,
    );
    // Each: $5 × 30 shown + $20 × 2 closed.
    expect(out.lines.map(l => l.commission)).toEqual([190, 190]);
    expect(out.lines[0].on).toBe(
      "$5 × 30 client appointments shown + $20 × 2 client deals closed",
    );
  });

  test("'give each a rule and a rate' names only what Costs can fix", () => {
    const people: Payee[] = [
      agent(1),
      { ...agent(2), rate2: null },
      { ...agent(3), basis: "other", rate: null },
      { ...agent(4), basis: "other", unknown: "per_client_appt_booked" },
      { ...agent(5), basis: "closed_cash", rate: 0.1, basis2: "none", rate2: null },
    ];
    const out = payroll(people, { ...p, newCash: null }, FX, say);
    // Every one is unpriced on the plan (the client lines are never projected)...
    expect(out.unpriced).toEqual(["Agent 1", "Agent 2", "Agent 3", "Agent 4", "Agent 5"]);
    // ...but the sentence names the line with no rate, the "other" rule and the plan number missing,
    // never the agent whose client lines are set, nor the rule this build cannot read.
    expect(unpricedToFix(people, out.lines)).toEqual(["Agent 2", "Agent 3", "Agent 5"]);
  });

  test("a line read as an unknown rule stays unpriced and named", () => {
    // ceoPeopleModel reads a basis it does not know as "other" (never "none").
    const out = payroll(
      [{ ...agent(1), basis: "other", rate: 5 }],
      { ...p, clientApptsShown: 60, clientDealsClosed: 4 },
      FX,
      say,
    );
    expect(out.lines[0].commission).toBeNull();
    expect(out.unpriced).toEqual(["Agent 1"]);
  });
});

describe("pay-plan parts in next month's pay (PAY-PLANS.md 8.7)", () => {
  const p: Projection = {
    newCash: 10000,
    contracted: null,
    introsShown: null,
    demosShown: null,
    closes: null,
    mrrDue: null,
  };
  const person = (over: Partial<Payee>): Payee => ({
    id: 1,
    name: "Someone",
    monthlyUsd: 1000,
    currency: "USD",
    basis: "none",
    rate: null,
    ...over,
  });

  test("each person's latest approved parts are added as an estimate, never split", () => {
    const out = payroll(
      [
        person({
          id: 1,
          name: "Buyer",
          planParts: { month: "2026-09", usd: 200 },
        }),
        person({
          id: 2,
          name: "Strategist",
          planParts: { month: "2026-09", usd: 200 },
        }),
        person({
          id: 3,
          name: "Closer",
          monthlyUsd: null,
          basis: "closed_cash",
          rate: 0.1,
          planParts: { month: "2026-08", usd: 250 },
        }),
      ],
      p,
      FX,
      say,
    );
    expect(out.lines.map(l => l.total)).toEqual([1200, 1200, 1250]);
    expect(out.lines[0].planParts).toEqual({ month: "2026-09", usd: 200 });
    expect(out.parts).toBe(650);
    expect(out.commission).toBe(1000);
    expect(out.total).toBe(2000 + 1000 + 650);
    expect(out.noPlanMonth).toEqual([]);
  });

  test("a deduction is signed, and a plan with no approved month adds nothing and is named", () => {
    const out = payroll(
      [
        person({
          id: 1,
          name: "Success",
          planParts: { month: "2026-09", usd: -250 },
        }),
        person({
          id: 2,
          name: "New plan",
          planParts: { month: null, usd: null },
        }),
        person({ id: 3, name: "No plan" }),
      ],
      p,
      FX,
      say,
    );
    expect(out.lines.map(l => l.total)).toEqual([750, 1000, 1000]);
    expect(out.parts).toBe(-250);
    expect(out.total).toBe(2750);
    expect(out.noPlanMonth).toEqual(["New plan"]);
    expect(out.lines[2].planParts).toBeUndefined();
  });
});

describe("a closed month with approved commission and parts (PAY-PLANS.md 8.7)", () => {
  const people = [
    { id: 1, name: "Agent", monthlyUsd: 650, approved: null, onPlan: true },
    { id: 2, name: "Closer", monthlyUsd: 1500, approved: null, onPlan: true },
    { id: 3, name: "Editor", monthlyUsd: 600, approved: null, onPlan: false },
    { id: 4, name: "Buyer", monthlyUsd: 700, approved: null, onPlan: true },
  ];
  const approvals = [
    {
      personId: 1,
      month: "2026-09",
      commissionUsd: 135,
      partsUsd: 0,
      notPriced: [],
    },
    {
      personId: 2,
      month: "2026-09",
      commissionUsd: 875,
      partsUsd: 250,
      notPriced: [],
    },
    // Approved with a line the month does not work out: named, not counted.
    {
      personId: 5,
      name: "Setter",
      month: "2026-09",
      commissionUsd: null,
      partsUsd: -20,
      notPriced: ["per_intro_shown"],
    },
    // Another month, and a repeat: neither counts.
    {
      personId: 4,
      month: "2026-08",
      commissionUsd: 0,
      partsUsd: 200,
      notPriced: [],
    },
    {
      personId: 1,
      month: "2026-09",
      commissionUsd: 135,
      partsUsd: 0,
      notPriced: [],
    },
  ];

  test("base pay, then commission and parts beside it; who is not approved is named", () => {
    const out = closedMonthPay(people, "2026-09", approvals);
    expect(out.total).toBe(3450);
    expect(out.plans).toEqual({
      commission: 1010,
      parts: 230,
      approved: 3,
      total: 3450 + 1010 + 230,
      notPriced: [{ name: "Setter", bases: ["per_intro_shown"] }],
      notApproved: ["Buyer"],
    });
  });

  test("unreadable is null, not asked is absent, and who is on a plan unknown is null", () => {
    expect(closedMonthPay(people, "2026-09", null).plans).toBeNull();
    expect("plans" in closedMonthPay(people, "2026-09")).toBe(false);
    const unknown = people.map(({ onPlan: _o, ...x }) => x);
    expect(
      closedMonthPay(unknown, "2026-09", approvals).plans?.notApproved,
    ).toBeNull();
  });
});
