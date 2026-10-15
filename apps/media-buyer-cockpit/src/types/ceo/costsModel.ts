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
  /**
   * Of the intros shown, the share that qualified (B2B intros_qualified
   * over intros_shown), 0..1. A plan does not say it, so it is read from
   * recent months and the qualified intros are an estimate.
   */
  qualifiedIntroShare?: number | null;
  /** Qualified intros shown, when given; otherwise intros shown × qualifiedIntroShare. */
  introsQualifiedShown?: number | null;
  /** Deals that fully close; a plan's closes when not given (a plan cannot plan a void). */
  fullCloses?: number | null;
};

/**
 * The share of intros shown that qualified, over the growth windows given
 * (the server's last month and month to date: B2B intros_qualified over
 * intros_shown). The plan has no qualified intros, so the setter's line is
 * priced on the plan's intros held times this share, and says it is an
 * estimate. Windows that repeat the same days are counted once.
 */
export function qualifiedIntroShare(
  windows: (
    | { from: string; to: string; raw: Record<string, number | null> }
    | null
    | undefined
  )[],
): {
  share: number | null;
  qualified: number;
  shown: number;
  from: string | null;
  to: string | null;
} | null {
  const seen = new Set<string>();
  let qualified = 0;
  let shown = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (const w of windows) {
    if (!w?.raw) continue;
    const key = `${w.from}|${w.to}`;
    if (seen.has(key)) continue;
    const q = w.raw.intros_qualified;
    const n = w.raw.intros_shown;
    if (typeof q !== "number" || typeof n !== "number") continue;
    seen.add(key);
    qualified += q;
    shown += n;
    if (from === null || w.from < from) from = w.from;
    if (to === null || w.to > to) to = w.to;
  }
  if (!seen.size) return null;
  return {
    share: shown > 0 ? Math.round((qualified / shown) * 1000) / 1000 : null,
    qualified,
    shown,
    from,
    to,
  };
}

/** The plan number a basis is priced on, filling the two estimated ones. */
export function planAmount(
  p: Projection,
  key: keyof Projection,
): number | null {
  if (key === "introsQualifiedShown") {
    if (p.introsQualifiedShown !== undefined && p.introsQualifiedShown !== null)
      return p.introsQualifiedShown;
    if (
      p.introsShown === null ||
      p.qualifiedIntroShare === undefined ||
      p.qualifiedIntroShare === null
    )
      return null;
    // Whole intros, so "$10 × 53" is the figure the commission is priced on.
    return Math.round(p.introsShown * p.qualifiedIntroShare);
  }
  if (key === "fullCloses")
    return p.fullCloses !== undefined && p.fullCloses !== null
      ? p.fullCloses
      : p.closes;
  const v = p[key];
  return typeof v === "number" ? v : null;
}

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
  per_qualified_intro_shown: "introsQualifiedShown",
  per_closed_deal: "fullCloses",
};

/** The unit a per-event basis counts, for "$10 × 34 qualified intros". */
const UNIT: Partial<Record<CommissionBasis, string>> = {
  per_intro_shown: "intros held",
  per_demo_shown: "demos held",
  per_signed: "deals signed",
  per_qualified_intro_shown: "qualified intros held (estimate)",
  per_closed_deal: "deals fully closed",
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
  /** The second commission line (A074); absent or "none" when there is none. */
  basis2?: CommissionBasis;
  rate2?: number | null;
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
  /** The projected commission in USD, both lines; 0 with no commission; null when a line cannot be priced. */
  commission: number | null;
  /** What the commission was priced on, in words, both lines joined with " + ". */
  on: string | null;
  total: number | null;
  /** Each commission line on its own (one or two), for a screen that shows them apart. */
  parts?: {
    basis: CommissionBasis;
    commission: number | null;
    on: string | null;
  }[];
};

/**
 * Next month's pay, person by person. People on the same basis split what it
 * is paid on equally: two closers on 10% of the cash they close are, between
 * them, 10% of the new cash, each on half of it. A person's second line
 * (A074) is priced the same way and added; if either line cannot be priced
 * the person's commission is no number rather than a part of one.
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
  const linesOf = (x: Payee) =>
    [
      { basis: x.basis, rate: x.rate },
      ...(x.basis2 && x.basis2 !== "none"
        ? [{ basis: x.basis2, rate: x.rate2 ?? null }]
        : []),
    ].filter(l => l.basis !== "none");
  const sharers = new Map<CommissionBasis, number>();
  for (const x of people)
    for (const l of linesOf(x))
      if (l.basis !== "other")
        sharers.set(l.basis, (sharers.get(l.basis) ?? 0) + 1);
  const price = (
    x: Payee,
    l: { basis: CommissionBasis; rate: number | null },
  ): { commission: number | null; on: string | null } => {
    const of = BASIS_ON[l.basis];
    const amount = of ? planAmount(p, of) : null;
    const share = 1 / (sharers.get(l.basis) ?? 1);
    if (l.rate === null || amount === null || !of)
      return { commission: null, on: null };
    if (SHARE.has(l.basis))
      return {
        commission: Math.round(l.rate * amount * share * 100) / 100,
        on: `${Math.round(l.rate * 1000) / 10}% of ${say.money(amount * share)}`,
      };
    const rate = usdPer[x.currency.toUpperCase()];
    if (rate === undefined) return { commission: null, on: null };
    const unit = UNIT[l.basis];
    return {
      commission: Math.round(l.rate * rate * amount * share * 100) / 100,
      on: `${say.money(l.rate * rate)} × ${say.count(amount * share)}${unit ? ` ${unit}` : ""}`,
    };
  };
  const lines: PayLine[] = people.map(x => {
    const base = x.monthlyUsd;
    const mine = linesOf(x);
    if (!mine.length)
      return {
        id: x.id,
        name: x.name,
        base,
        commission: 0,
        on: null,
        total: base,
        parts: [],
      };
    const parts = mine.map(l => ({ basis: l.basis, ...price(x, l) }));
    const unpriced = parts.some(q => q.commission === null);
    const rounded = unpriced
      ? null
      : Math.round(parts.reduce((n, q) => n + (q.commission ?? 0), 0) * 100) /
        100;
    const said = parts.map(q => q.on).filter((t): t is string => Boolean(t));
    return {
      id: x.id,
      name: x.name,
      base,
      commission: rounded,
      on: said.length ? said.join(" + ") : null,
      total:
        base === null && rounded === null ? null : (base ?? 0) + (rounded ?? 0),
      parts,
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
