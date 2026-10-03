/**
 * The two payment plans new clients get, and when each dollar comes in.
 *
 * Aziz, 2026-10-03: "we only have 2 options for newer clients $3k $3k after
 * 30 days or $6k pif", and "the $500 is the onboarding fee and $2500 is
 * collected on or before the onboarding call". The contract says the same:
 * a $500 deposit on the strategy call, the rest of the first payment on the
 * onboarding call. Paid in full is read the same way: $500 on the call and
 * the other $5,500 by the onboarding call.
 *
 * The 60 Day ($4,000) and Month To Month ($2,000 a month) contracts get plans
 * that fit their own fees (Aziz, 2026-10-03: "Fix the 60-day and month months
 * where they make sense in the contract"), with the same $500 first.
 *
 * The labels are the ones HighLevel's Payment Structure For Program, the New
 * Client Form and the contract card share, and the contract prints them, so
 * a plan is found by its exact label.
 */

export interface Plan {
  label: string;
  /** The contract it belongs to, for grouping hints. */
  program: "3 months" | "60 days" | "Monthly";
  /** The plan in a word or two, for hints. */
  short: string;
  /** Taken on the sales call: the $500 that books the onboarding. */
  onCall: number;
  /** Collected on or before the onboarding call. */
  byOnboarding: number;
  /** The second payment, 30 days later; 0 when paid in full. On a monthly plan, the next month's fee. */
  later: number;
  /** What the contract's term is worth. */
  total: number;
  /** The fee comes again every month until the client cancels. */
  renews?: boolean;
  /** When each part is due, in one line for the closer and the client success team. */
  schedule: string;
}

export const PLANS: readonly Plan[] = [
  {
    label: "Paid in full ($6,000)",
    program: "3 months",
    short: "paid in full",
    onCall: 500,
    byOnboarding: 5500,
    later: 0,
    total: 6000,
    schedule:
      "$500 on the call, then the other $5,500 on or before the onboarding call.",
  },
  {
    label: "Split pay ($3,000 + $3,000 after 30 days)",
    program: "3 months",
    short: "split",
    onCall: 500,
    byOnboarding: 2500,
    later: 3000,
    total: 6000,
    schedule:
      "$500 on the call, $2,500 on or before the onboarding call, then $3,000 30 days later.",
  },
  {
    label: "Paid in full ($4,000)",
    program: "60 days",
    short: "paid in full",
    onCall: 500,
    byOnboarding: 3500,
    later: 0,
    total: 4000,
    schedule:
      "$500 on the call, then the other $3,500 on or before the onboarding call.",
  },
  {
    label: "Split pay ($2,000 + $2,000 after 30 days)",
    program: "60 days",
    short: "split",
    onCall: 500,
    byOnboarding: 1500,
    later: 2000,
    total: 4000,
    schedule:
      "$500 on the call, $1,500 on or before the onboarding call, then $2,000 30 days later.",
  },
  {
    label: "Monthly ($2,000 a month)",
    program: "Monthly",
    short: "monthly",
    onCall: 500,
    byOnboarding: 1500,
    later: 2000,
    total: 2000,
    renews: true,
    schedule:
      "$500 on the call, $1,500 on or before the onboarding call, then $2,000 every month it continues.",
  },
];

/** The plan a payment structure names, or null for an older or unknown one. */
export function planFor(label: string | null | undefined): Plan | null {
  const want = (label ?? "").trim();
  return PLANS.find(p => p.label === want) ?? null;
}

/** Every plan's amount for one form question, by contract, as a hint when no plan is chosen yet. */
export function planHint(
  part: "onCall" | "byOnboarding" | "later" | "total",
): string {
  if (new Set(PLANS.map(p => p[part])).size === 1)
    return `${PLANS[0][part]} on every plan.`;
  const groups = new Map<string, Plan[]>();
  for (const p of PLANS)
    groups.set(p.program, [...(groups.get(p.program) ?? []), p]);
  return `${[...groups]
    .map(([program, plans]) =>
      new Set(plans.map(p => p[part])).size === 1
        ? `${program}: ${plans[0][part]}`
        : `${program}: ${plans.map(p => `${p[part]} ${p.short}`).join(", ")}`,
    )
    .join(". ")}.`;
}
