import type { CommissionBasis } from "./commission";

/**
 * What a month costs, worked out. Pure, so the Costs page, next month's plan
 * and the tests all use the same arithmetic (scripts/costs-model.test.ts).
 *
 * Aziz, 2026-10-02: "especially for software that is per seat. If I add a
 * seat, it can easily just change how much the software expenses should
 * be... As well as the payroll, it should automatically calculate... depending
 * on who's active... with all of the projections that we put in... if I'm
 * projecting 100k new cash and my closer gets 10% of cash collected, it can
 * automatically tell me how much I'm projected to do for payroll."
 *
 * Two honesty rules. A line in a currency with no rate, or a commission the
 * cockpit cannot price ("other, see the note"), is no number rather than a
 * zero, and the totals say how many they leave out.
 */

export type CostKind = "software" | "overhead" | "marketing";
export type Billing = "monthly" | "yearly" | "usage";

export type CostLine = {
  id: number;
  kind: CostKind;
  name: string;
  category: string | null;
  billing: Billing;
  /** Seats paid for, or null when the line is not priced per seat. */
  seats: number | null;
  /** Per seat (or flat) per billing period; a usage line's monthly estimate. */
  unitPrice: number;
  currency: string;
  paidWith: string | null;
  match: string | null;
  status: "active" | "paused" | "cancelled";
  note: string | null;
  sort: number;
};

/** What a line costs a month in USD, or null when its currency has no rate. */
export function monthlyUsd(
  line: Pick<CostLine, "billing" | "seats" | "unitPrice" | "currency">,
  usdPer: Record<string, number>,
): number | null {
  const rate = usdPer[line.currency.toUpperCase()];
  if (rate === undefined) return null;
  const perPeriod = (line.seats ?? 1) * line.unitPrice;
  const perMonth = line.billing === "yearly" ? perPeriod / 12 : perPeriod;
  return Math.round(perMonth * rate * 100) / 100;
}

/** A kind's monthly total over its active lines, and what it could not price. */
export function totalOf(
  lines: CostLine[],
  kind: CostKind,
  usdPer: Record<string, number>,
): { usd: number; lines: number; seats: number; unpriced: string[] } {
  const live = lines.filter(l => l.kind === kind && l.status === "active");
  let usd = 0;
  let seats = 0;
  const unpriced: string[] = [];
  for (const l of live) {
    const m = monthlyUsd(l, usdPer);
    if (m === null) unpriced.push(l.name);
    else usd += m;
    seats += l.seats ?? 0;
  }
  return {
    usd: Math.round(usd * 100) / 100,
    lines: live.length,
    seats,
    unpriced,
  };
}

/** The plan numbers a commission can be priced on. */
export type Projection = {
  newCash: number | null;
  contracted: number | null;
  introsShown: number | null;
  demosShown: number | null;
  closes: number | null;
  mrrDue: number | null;
};

/** What each commission basis is paid on, in the plan's words. */
export const BASIS_ON: Record<CommissionBasis, keyof Projection | null> = {
  none: null,
  closed_cash: "newCash",
  set_cash: "newCash",
  closed_contract: "contracted",
  set_contract: "contracted",
  per_intro_shown: "introsShown",
  per_demo_shown: "demosShown",
  per_signed: "closes",
  mrr_managed: "mrrDue",
  other: null,
};

const SHARE = new Set<CommissionBasis>([
  "closed_cash",
  "set_cash",
  "closed_contract",
  "set_contract",
  "mrr_managed",
]);

export type Payee = {
  id: number;
  name: string;
  /** Base pay a month in USD, or null when none is set. */
  monthlyUsd: number | null;
  currency: string;
  basis: CommissionBasis;
  /** A fraction for the share bases; an amount in `currency` per unit otherwise. */
  rate: number | null;
  /**
   * Last month's approved pay from Hours and pay, when there is one. Only a
   * closed month reads it; next month's plan stays on roster pay, so a
   * joiner's half month or a month of unpaid leave never sets next month's cost.
   */
  approved?: {
    month: string;
    amountUsd: number | null;
    shadow: boolean;
  } | null;
};

/** A closed month's base pay: the approved figure where one exists, the roster's for the rest. */
export type ClosedMonthPay = {
  month: string;
  /** Base pay in USD, approved where approved, roster otherwise. */
  total: number;
  /** People counted at their approved figure. */
  approved: number;
  /** People counted at their roster pay. */
  roster: number;
  /** Approved in a currency with no dollar rate: counted at roster pay, and named. */
  noRate: string[];
  /** Neither approved nor a roster figure: left out, and named. */
  noPay: string[];
};

/**
 * Base pay for a closed month. `people` is everyone paid that month: the
 * working roster, plus anyone approved for it who has left since.
 */
export function closedMonthPay(
  people: Pick<Payee, "id" | "name" | "monthlyUsd" | "approved">[],
  month: string,
): ClosedMonthPay {
  let total = 0;
  let approved = 0;
  let roster = 0;
  const noRate: string[] = [];
  const noPay: string[] = [];
  for (const p of people) {
    const a = p.approved?.month === month ? p.approved : null;
    if (a && a.amountUsd !== null) {
      total += a.amountUsd;
      approved += 1;
      continue;
    }
    if (p.monthlyUsd !== null) {
      // Approved in a currency with no dollar rate: roster pay stands in.
      if (a) noRate.push(p.name);
      total += p.monthlyUsd;
      roster += 1;
    } else noPay.push(p.name);
  }
  return {
    month,
    total: Math.round(total * 100) / 100,
    approved,
    roster,
    noRate,
    noPay,
  };
}

export type PayLine = {
  id: number;
  name: string;
  base: number | null;
  /** The projected commission in USD; 0 with no commission; null when it cannot be priced. */
  commission: number | null;
  /** What the commission was priced on, in words. */
  on: string | null;
  total: number | null;
};

/**
 * Next month's pay, person by person. People on the same basis split what it
 * is paid on equally: two closers on 10% of the cash they close are, between
 * them, 10% of the new cash, each on half of it.
 */
export function payroll(
  people: Payee[],
  p: Projection,
  usdPer: Record<string, number>,
  say: { money: (v: number) => string; count: (v: number) => string },
): {
  lines: PayLine[];
  base: number;
  commission: number;
  total: number;
  /** Working people with no pay set: the base is a floor until they have one. */
  noPay: string[];
  /** Commissions that cannot be priced on the plan. */
  unpriced: string[];
} {
  const sharers = new Map<CommissionBasis, number>();
  for (const x of people)
    if (x.basis !== "none" && x.basis !== "other")
      sharers.set(x.basis, (sharers.get(x.basis) ?? 0) + 1);
  const lines: PayLine[] = people.map(x => {
    const of = BASIS_ON[x.basis];
    const base = x.monthlyUsd;
    if (x.basis === "none")
      return {
        id: x.id,
        name: x.name,
        base,
        commission: 0,
        on: null,
        total: base,
      };
    const amount = of ? p[of] : null;
    const share = 1 / (sharers.get(x.basis) ?? 1);
    let commission: number | null = null;
    let on: string | null = null;
    if (x.rate !== null && amount !== null && of) {
      if (SHARE.has(x.basis)) {
        commission = x.rate * amount * share;
        on = `${Math.round(x.rate * 1000) / 10}% of ${say.money(amount * share)}`;
      } else {
        const rate = usdPer[x.currency.toUpperCase()];
        if (rate !== undefined) {
          commission = x.rate * rate * amount * share;
          on = `${say.money(x.rate * rate)} × ${say.count(amount * share)}`;
        }
      }
    }
    const rounded =
      commission === null ? null : Math.round(commission * 100) / 100;
    return {
      id: x.id,
      name: x.name,
      base,
      commission: rounded,
      on,
      total:
        base === null && rounded === null ? null : (base ?? 0) + (rounded ?? 0),
    };
  });
  const sum = (xs: (number | null)[]) =>
    Math.round(xs.reduce<number>((n, v) => n + (v ?? 0), 0) * 100) / 100;
  const base = sum(lines.map(l => l.base));
  const commission = sum(lines.map(l => l.commission));
  return {
    lines,
    base,
    commission,
    total: Math.round((base + commission) * 100) / 100,
    noPay: people.filter(x => x.monthlyUsd === null).map(x => x.name),
    unpriced: lines.filter(l => l.commission === null).map(l => l.name),
  };
}
