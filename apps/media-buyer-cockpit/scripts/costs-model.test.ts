import { describe, expect, test } from "bun:test";
import {
  type CostLine,
  monthlyUsd,
  type Payee,
  type Projection,
  payroll,
  totalOf,
} from "../convex/ceo/costsModel";

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
