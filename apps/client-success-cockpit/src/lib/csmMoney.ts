/**
 * The CSM income plan.
 *
 * Every rate here is transcribed from "Client Success Manager - Pay Structure &
 * Commission" (the company's doc). Nothing is estimated. If a rate changes, change it
 * in the doc first, then here — never the other way round.
 */

export type Earner = {
  id: string;
  label: string;
  rate: number;
  unit: string;
  /** Which of the four Rs this belongs to. */
  r: "Resell" | "Renew" | "Refer" | "Review";
  note?: string;
  /** The form that makes it count. No form filled, no commission paid. */
  form?: string;
};

/** Base pay: $1,200 until 20 clients, then $50 per client above 20, uncapped. */
export function basePay(clients: number): number {
  return 1200 + Math.max(0, clients - 20) * 50;
}

/**
 * Retention bonus bands, on churn = clients lost this month ÷ active clients at the
 * start of the month (counting non-renewal, cancellation, refund, or a freeze over
 * 14 days). A penalty is a negative number, deliberately.
 */
export const CHURN_BANDS: { max: number; bonus: number; label: string }[] = [
  { max: 0, bonus: 2000, label: "0% churn" },
  { max: 4, bonus: 1500, label: "1–4%" },
  { max: 8, bonus: 1000, label: "5–8%" },
  { max: 10, bonus: 500, label: "9–10%" },
  { max: 12, bonus: 250, label: "11–12%" },
  { max: 15, bonus: 0, label: "13–15%" },
  { max: Number.POSITIVE_INFINITY, bonus: -250, label: "15%+" },
];

export function retentionBonus(churnPct: number): {
  bonus: number;
  band: string;
} {
  const hit = CHURN_BANDS.find(b => churnPct <= b.max) ?? CHURN_BANDS[0];
  return { bonus: hit.bonus, band: hit.label };
}

/** The target the company holds him to. Sub-10% keeps the $500 band alive. */
export const CHURN_TARGET = 10;

export const EARNERS: Earner[] = [
  {
    id: "website",
    form: "https://maharamedia.typeform.com/to/VP3zmaj2",
    label: "Website upsell ($2k)",
    rate: 200,
    unit: "each",
    r: "Resell",
    note: "10% of upfront cash collected",
  },
  {
    id: "ugc",
    label: "UGC pack ($3.5k)",
    rate: 350,
    unit: "each",
    r: "Resell",
  },
  {
    id: "seo",
    label: "SEO + GEO ($5k)",
    rate: 500,
    unit: "each",
    r: "Resell",
  },
  {
    id: "salesperson",
    label: "Salesperson placement ($4k)",
    rate: 400,
    unit: "each",
    r: "Resell",
  },
  {
    id: "cameraman",
    label: "Cameraman day ($800)",
    rate: 80,
    unit: "each",
    r: "Resell",
  },
  {
    id: "smm",
    form: "https://maharamedia.typeform.com/to/IVHO9BMC",
    label: "Social media management ($1k/mo)",
    rate: 200,
    unit: "each",
    r: "Resell",
  },
  {
    id: "renewal",
    label: "90-day renewal",
    rate: 300,
    unit: "each",
    r: "Renew",
  },
  // Reactivation is out until the right form exists. The Typeform we had here is the
  // card-declined form, which is an admin job, not an earner.
  {
    id: "referral",
    form: "https://maharamedia.typeform.com/to/bAmbMKM2",
    label: "Client referral that signs",
    rate: 250,
    unit: "each",
    r: "Refer",
  },
  {
    id: "testimonial",
    form: "https://maharamedia.typeform.com/to/ETEynRgb",
    label: "Video testimonial (real results)",
    rate: 150,
    unit: "each",
    r: "Review",
  },
  {
    id: "review",
    form: "https://maharamedia.typeform.com/to/ETEynRgb",
    label: "Google 5★ review (fully written)",
    rate: 75,
    unit: "each",
    r: "Review",
  },
  {
    id: "podcast",
    label: "Podcast case study (10 min+, approved)",
    rate: 250,
    unit: "each",
    r: "Review",
  },
];

export const PENALTIES: Earner[] = [
  {
    id: "extension",
    label: "Payment extension or freeze without a valid reason",
    rate: -50,
    unit: "each",
    r: "Renew",
  },
  {
    id: "rescue",
    label: "Client leadership had to step in and rescue",
    rate: -100,
    unit: "each",
    r: "Renew",
  },
];

/** Penalties cap at $500 a month, per the pay doc. */
export const PENALTY_CAP = 500;

export type Counts = Record<string, number>;

export function computePay(
  clients: number,
  churnPct: number | null,
  counts: Counts,
): {
  base: number;
  retention: number;
  band: string;
  commission: number;
  penalties: number;
  total: number;
} {
  const base = basePay(clients);
  const { bonus, band } =
    churnPct === null
      ? { bonus: 0, band: "churn unknown" }
      : retentionBonus(churnPct);
  const commission = EARNERS.reduce(
    (s, e) => s + (counts[e.id] ?? 0) * e.rate,
    0,
  );
  const rawPenalties = PENALTIES.reduce(
    (s, e) => s + (counts[e.id] ?? 0) * e.rate,
    0,
  );
  const penalties = Math.max(rawPenalties, -PENALTY_CAP);
  return {
    base,
    retention: bonus,
    band,
    commission,
    penalties,
    total: base + bonus + commission + penalties,
  };
}

export const FOUR_RS: { r: string; meaning: string }[] = [
  { r: "Refer", meaning: "Existing clients introduce new ones" },
  { r: "Resell", meaning: "Second service line, more budget, backend" },
  { r: "Renew", meaning: "They stay past 90 days instead of drifting" },
  { r: "Review", meaning: "Google reviews and video testimonials" },
];
