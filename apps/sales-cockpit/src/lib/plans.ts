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
 * The labels are the ones HighLevel's Payment Structure For Program, the New
 * Client Form and the contract card share, and the contract prints them, so
 * a plan is found by its exact label.
 */

export interface Plan {
  label: string;
  /** Taken on the sales call: the $500 that books the onboarding. */
  onCall: number;
  /** Collected on or before the onboarding call. */
  byOnboarding: number;
  /** The second payment, 30 days later; 0 when paid in full. */
  later: number;
  total: number;
  /** When each part is due, in one line for the closer and the client success team. */
  schedule: string;
}

export const PLANS: readonly Plan[] = [
  {
    label: "Paid in full ($6,000)",
    onCall: 500,
    byOnboarding: 5500,
    later: 0,
    total: 6000,
    schedule:
      "$500 on the call, then the other $5,500 on or before the onboarding call.",
  },
  {
    label: "Split pay ($3,000 + $3,000 after 30 days)",
    onCall: 500,
    byOnboarding: 2500,
    later: 3000,
    total: 6000,
    schedule:
      "$500 on the call, $2,500 on or before the onboarding call, then $3,000 30 days later.",
  },
];

/** The plan a payment structure names, or null for an older or unknown one. */
export function planFor(label: string | null | undefined): Plan | null {
  const want = (label ?? "").trim();
  return PLANS.find(p => p.label === want) ?? null;
}

/** Each plan's amount for one form question, as a hint when no plan is chosen yet. */
export function planHint(
  part: "onCall" | "byOnboarding" | "later" | "total",
): string {
  return `Paid in full: ${PLANS[0][part]}. Split pay: ${PLANS[1][part]}.`;
}
