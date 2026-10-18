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
  // A074, 2026-10-11: the setter's rule, "$10 per showed qualfiwedd
  // appointment $50 per closed deal (fully closed not onboarding fee then
  // ghosted)". A person may carry two lines (commission2 on the roster).
  "per_qualified_intro_shown",
  "per_closed_deal",
  // The CEO, 2026-10-18, for the call centre agents: "$5 per sold client
  // appointment and $20 per closed client appointment. Add to the other
  // options, which is a closed client deal" (PAY-PLANS.md decision 2: "sold"
  // is read as shown). Per unit, measured on Team & payroll each month.
  "per_client_appt_shown",
  "per_client_deal_closed",
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
  per_qualified_intro_shown: "per qualified intro call that shows up",
  per_closed_deal:
    "per deal that fully closes (not a deposit and then gone: voided deals are left out)",
  per_client_appt_shown: "per client appointment that shows up",
  per_client_deal_closed: "per deal our client closes (confirmed)",
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
  per_qualified_intro_shown: "Per qualified intro shown",
  per_closed_deal: "Per fully closed deal",
  per_client_appt_shown: "Per client appointment shown",
  per_client_deal_closed: "Per closed client deal",
};

/**
 * A line as the roster holds it. `unknown` is a basis the database has and
 * this code does not know yet (the database learns a basis before the
 * installed app does): the line then reads as "other", so it is never priced
 * and never counted as no commission, and the raw value is kept to say so.
 * A screen shows it as "Unknown rule: <value>" and never saves it back.
 */
export type CommissionLine = {
  basis: CommissionBasis;
  rate: number | null;
  unknown?: string;
};

/** The raw basis of a line this code cannot read, or null. */
export const unknownBasis = (line: {
  basis: CommissionBasis;
  rate: number | null;
}): string | null => (line as CommissionLine).unknown ?? null;

/** "Unknown rule: per_client_appt_booked", for a line this code cannot read. */
export const unknownRuleText = (raw: string) => `Unknown rule: ${raw}`;

/** A basis that carries a rate (none and other do not). */
export const takesRate = (b: CommissionBasis) => b !== "none" && b !== "other";

/**
 * Both lines in one sentence: "$10 per qualified intro call that shows up,
 * plus $50 per deal that fully closes …", or null with no commission.
 */
export function commissionLines(
  lines: CommissionLine[],
  currency: string,
  note: string | null,
): string | null {
  const said = lines
    .map(l => commissionText(l, currency, note))
    .filter((x): x is string => Boolean(x));
  return said.length ? said.join(", plus ") : null;
}

/** "10% of cash collected on deals they close", "KWD 50 per demo that shows up", "Other: ...", "Unknown rule: ...", or null. */
export function commissionText(
  c: CommissionLine,
  currency: string,
  note: string | null,
): string | null {
  if (c.unknown) return unknownRuleText(c.unknown);
  if (c.basis === "none") return null;
  if (c.basis === "other") return note ? `Other: ${note}` : "Other";
  if (c.rate === null) return `Rate not set, ${COMMISSION_LABEL[c.basis]}`;
  const amount = SHARE_BASES.has(c.basis)
    ? `${Math.round(c.rate * 1000) / 10}%`
    : `${currency} ${c.rate.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${amount} ${COMMISSION_LABEL[c.basis]}`;
}

/**
 * The one place the rule is checked. Returns the columns to store, or throws
 * a sentence for the screen. `pct` is the old form (a share of what they
 * close) and only counts when no basis is given.
 */
export function commissionRule(input: {
  basis?: CommissionBasis | null;
  rate?: number | null;
  pct?: number | null;
}): { basis: CommissionBasis; rate: number | null; pct: number | null } {
  const basis: CommissionBasis =
    input.basis ??
    (input.pct !== undefined && input.pct !== null ? "closed_cash" : "none");
  if (!(COMMISSION_BASES as readonly string[]).includes(basis))
    throw new Error("That is not a commission basis this cockpit knows.");
  let rate: number | null =
    basis === "none"
      ? null
      : (input.rate ??
        (input.basis === undefined || input.basis === null
          ? (input.pct ?? null)
          : null));
  if (rate !== null && !Number.isFinite(rate))
    throw new Error("A commission rate is a number.");
  if (rate !== null && rate < 0)
    throw new Error("A commission rate cannot be below zero.");
  if (SHARE_BASES.has(basis) && rate !== null && rate > 1)
    throw new Error("A share is between 0 and 1, so 0.1 is 10%.");
  if (basis === "other") rate = null;
  if (rate !== null) rate = Math.round(rate * 10000) / 10000;
  return { basis, rate, pct: SHARE_BASES.has(basis) ? rate : null };
}
