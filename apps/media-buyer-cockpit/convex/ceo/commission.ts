/**
 * What a commission is paid on. Pure constants, shared by the people module
 * and the Team & payroll screen, so the rule is written once.
 *
 * The share bases take a fraction (0.1 = 10%); the per-unit bases take an
 * amount in the person's currency. "other" means the note says how.
 */
export const COMMISSION_BASES = [
  "none",
  "closed_cash",
  "closed_contract",
  "set_cash",
  "set_contract",
  "per_intro_shown",
  "per_demo_shown",
  "per_signed",
  "mrr_managed",
  "other",
] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const SHARE_BASES: ReadonlySet<CommissionBasis> =
  new Set<CommissionBasis>([
    "closed_cash",
    "closed_contract",
    "set_cash",
    "set_contract",
    "mrr_managed",
  ]);

/** Long form, for a sentence. */
export const COMMISSION_LABEL: Record<CommissionBasis, string> = {
  none: "no commission",
  closed_cash: "of cash collected on deals they close",
  closed_contract: "of contract value on deals they close",
  set_cash: "of cash collected on deals they set",
  set_contract: "of contract value on deals they set",
  per_intro_shown: "per intro call that shows up",
  per_demo_shown: "per demo that shows up",
  per_signed: "per signed deal",
  mrr_managed: "of the monthly revenue of the clients they manage",
  other: "as written in the note",
};

/** Short form, for a select. */
export const COMMISSION_SHORT: Record<CommissionBasis, string> = {
  none: "No commission",
  closed_cash: "% of cash they close",
  closed_contract: "% of contracts they close",
  set_cash: "% of cash they set",
  set_contract: "% of contracts they set",
  per_intro_shown: "Per intro shown",
  per_demo_shown: "Per demo shown",
  per_signed: "Per signed deal",
  mrr_managed: "% of MRR they manage",
  other: "Other, see note",
};

/** "10% of cash collected on deals they close", "KWD 50 per demo that shows up", "Other: ...", or null. */
export function commissionText(
  c: { basis: CommissionBasis; rate: number | null },
  currency: string,
  note: string | null,
): string | null {
  if (c.basis === "none") return null;
  if (c.basis === "other") return note ? `Other: ${note}` : "Other";
  if (c.rate === null) return `Rate not set, ${COMMISSION_LABEL[c.basis]}`;
  const amount = SHARE_BASES.has(c.basis)
    ? `${Math.round(c.rate * 1000) / 10}%`
    : `${currency} ${c.rate.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${amount} ${COMMISSION_LABEL[c.basis]}`;
}
