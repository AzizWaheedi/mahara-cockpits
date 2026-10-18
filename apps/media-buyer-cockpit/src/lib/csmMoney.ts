/**
 * The CSM income plan: his own estimate of the month, from the counts he types.
 *
 * Every rate here is the client success manager plan in docs/pay/PAY-PLANS.md
 * (section 2, from the CSM contract's section 7), which the CEO's Team & payroll
 * tab pays from. No rate here is a guess. If a rate changes, change it in the
 * contract first, then here and in the plan, never the other way round. What is
 * paid is the CEO's approved month; this screen only says where he stands.
 */

export type Earner = {
  id: string;
  label: string;
  /** "each": dollars per item. "share": the part of the cash typed, 0.10 = 10%. */
  kind: "each" | "share";
  rate: number;
  /** Which of the four Rs this belongs to. */
  r: "Resell" | "Renew" | "Refer" | "Review";
  note?: string;
  /** The form that tells the company. What pays is the CEO's entry with its evidence. */
  form?: string;
};

/** His base on the roster (PAY-PLANS.md decision 1). */
export const BASE_USD = 2000;
/** "Per qualifying client over 20": $50 each, uncapped. */
export const OVER_CLIENTS = 20;
export const PER_CLIENT_OVER_USD = 50;

/** Base pay: $2,000, plus $50 per qualifying client above 20. */
export function basePay(clients: number): number {
  const whole = Number.isFinite(clients) ? Math.floor(clients) : 0;
  return BASE_USD + Math.max(0, whole - OVER_CLIENTS) * PER_CLIENT_OVER_USD;
}

/**
 * The "Qualifying clients" pre-fill until he types his own: cards Active today,
 * live 30 days or more and not late on payment (paymentDue is days past due).
 * Qualifying is active and paid up 30 days running (PAY-PLANS.md 4.3); the count
 * the CEO confirms is what pays. Stopped, paused and onboarding cards never count.
 */
export function qualifyingFrom(
  clients: {
    stage?: string | null;
    liveDays?: number | null;
    paymentDue?: number | null;
  }[],
): number {
  return clients.filter(
    c =>
      c.stage === "Active" &&
      (c.liveDays ?? 0) >= 30 &&
      !((c.paymentDue ?? 0) >= 1),
  ).length;
}

/**
 * Retention bonus bands, on churn = clients lost this month before day 90 ÷ active
 * clients at the start of the month (cancellation, refund, chargeback, non-payment
 * or a pause past 14 days). A client who finishes the term and does not renew is a
 * renewal miss, not churn, so one client leaving is never counted twice
 * (mahara-context churn-tracker-build.md; the churn tracker, convex/churnCore.ts).
 *
 * A band runs until the next band starts (PAY-PLANS.md decision 4): "1–4%" covers
 * up to 4.99%, so 1 of 22 (4.55%) pays $1,500; "13–15%" is written "up to 15"
 * before "above 15", so 15% exactly pays $0. The same shape as the role plan's
 * `retention` part: the first band with `inclusive ? v <= upTo : v < upTo`, else
 * the last. A penalty is a negative number, deliberately.
 */
export type RetentionBand = {
  upTo: number | null;
  inclusive?: boolean;
  amount: number;
  label: string;
};

export const CHURN_BANDS: RetentionBand[] = [
  { upTo: 0, inclusive: true, amount: 2000, label: "0% churn" },
  { upTo: 5, inclusive: false, amount: 1500, label: "Above 0%, under 5%" },
  { upTo: 9, inclusive: false, amount: 1000, label: "5% to under 9%" },
  { upTo: 11, inclusive: false, amount: 500, label: "9% to under 11%" },
  { upTo: 13, inclusive: false, amount: 250, label: "11% to under 13%" },
  { upTo: 15, inclusive: true, amount: 0, label: "13% to 15%" },
  { upTo: null, amount: -250, label: "Over 15%" },
];

/**
 * A percent rounded to 0.01, half away from zero, read from its decimal text, as
 * the server rounds before it picks a band: 4.995 is 5.00, never 4.99 from the
 * binary 4.99499….
 */
export function roundPct(value: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const text = String(abs);
  if (/e/i.test(text)) return sign * (Math.round(abs * 100) / 100);
  return sign * Number(`${Math.round(Number(`${text}e2`))}e-2`);
}

export function retentionBonus(churnPct: number): {
  bonus: number;
  band: string;
} {
  const v = roundPct(churnPct);
  const hit =
    CHURN_BANDS.find(
      b => b.upTo !== null && (b.inclusive ? v <= b.upTo : v < b.upTo),
    ) ?? CHURN_BANDS[CHURN_BANDS.length - 1];
  return { bonus: hit.amount, band: hit.label };
}

/** The company's churn target, the tracker's line. Under it pays $500 or more. */
export const CHURN_TARGET = 10;

/** The contract's general conditions (7.4 to 7.6; PAY-PLANS.md decision 8). */
export const CONDITIONS =
  "Renewals, reactivations, upsells, recurring services and referrals count once the payment clears, with a signed agreement or the payment in the CRM, and are paid with the payroll after the month it cleared. A Google review taken down within 30 days is taken back.";

export const EARNERS: Earner[] = [
  {
    id: "upsell_cash",
    label: "Backend upsells, cash collected ($)",
    kind: "share",
    rate: 0.1,
    r: "Resell",
    note: "Website, UGC pack, SEO + GEO, salesperson placement, cameraman day: 10% of the cash collected",
  },
  {
    id: "recurring_first",
    form: "https://maharamedia.typeform.com/to/IVHO9BMC",
    label: "Recurring service, first month's revenue ($)",
    kind: "share",
    rate: 0.2,
    r: "Resell",
    note: "Social media management, care plans, sales management: 20% of the first month",
  },
  {
    id: "recurring_after",
    label: "Recurring service, later months' revenue ($)",
    kind: "share",
    rate: 0.05,
    r: "Resell",
    note: "5% of each later month, until the client cancels or is more than 30 days late",
  },
  {
    id: "renewal",
    label: "90-day renewal",
    kind: "each",
    rate: 300,
    r: "Renew",
  },
  {
    id: "reactivation",
    label: "Reactivation (gone 90 days or more, back on a paid term)",
    kind: "each",
    rate: 300,
    r: "Renew",
  },
  {
    id: "referral",
    form: "https://maharamedia.typeform.com/to/bAmbMKM2",
    label: "Client referral that signs",
    kind: "each",
    rate: 250,
    r: "Refer",
  },
  {
    id: "testimonial",
    form: "https://maharamedia.typeform.com/to/ETEynRgb",
    label: "Video testimonial (real results)",
    kind: "each",
    rate: 150,
    r: "Review",
  },
  {
    id: "review",
    form: "https://maharamedia.typeform.com/to/ETEynRgb",
    label: "Google 5★ review (fully written)",
    kind: "each",
    rate: 75,
    r: "Review",
    note: "Still up 30 days after it is posted",
  },
  {
    id: "podcast",
    label: "Podcast case study (10 min+, approved)",
    kind: "each",
    rate: 250,
    r: "Review",
  },
];

export type Counts = Record<string, number>;

/** A signed dollar amount: "-$250", never "$-250"; cents only when there are any. */
export function usd(n: number): string {
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100) % 100 !== 0;
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return `${n < 0 ? "-" : ""}$${text}`;
}

/** "$300 each" or "10% of cash". */
export function rateLabel(e: Earner): string {
  return e.kind === "share"
    ? `${Math.round(e.rate * 1000) / 10}% of cash`
    : `${usd(e.rate)} each`;
}

/** What one earner's typed number pays, to the cent. */
export function earned(e: Earner, typed: number | undefined): number {
  const n = Number.isFinite(typed) ? Math.max(0, typed as number) : 0;
  return Math.round(n * e.rate * 100) / 100;
}

export function computePay(
  clients: number,
  churnPct: number | null,
  counts: Counts,
): {
  base: number;
  retention: number;
  band: string;
  commission: number;
  total: number;
} {
  const base = basePay(clients);
  const { bonus, band } =
    churnPct === null || !Number.isFinite(churnPct)
      ? { bonus: 0, band: "churn unknown" }
      : retentionBonus(churnPct);
  const commission =
    Math.round(EARNERS.reduce((s, e) => s + earned(e, counts[e.id]), 0) * 100) /
    100;
  return {
    base,
    retention: bonus,
    band,
    commission,
    total: base + bonus + commission,
  };
}

/** What closes a gap: referrals, upsell cash, or video testimonials. */
export function closeTheGap(gap: number): {
  referrals: number;
  upsellCash: number;
  testimonials: number;
} {
  const g = Math.max(0, gap);
  // Rounded before the ceiling, so $250 / 0.10 is 2,500 and never 2,501.
  const over = (id: string) =>
    Math.ceil(
      Math.round((g / (EARNERS.find(e => e.id === id)?.rate ?? 1)) * 1e6) / 1e6,
    );
  return {
    referrals: over("referral"),
    upsellCash: over("upsell_cash"),
    testimonials: over("testimonial"),
  };
}

export const FOUR_RS: { r: string; meaning: string }[] = [
  { r: "Refer", meaning: "Existing clients introduce new ones" },
  { r: "Resell", meaning: "Second service line, more budget, backend" },
  { r: "Renew", meaning: "They stay past 90 days, or come back" },
  { r: "Review", meaning: "Google reviews, video testimonials, podcasts" },
];
