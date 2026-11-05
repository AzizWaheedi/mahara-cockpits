/**
 * The kickoff's daily budget as an amount and a currency (CEO item 5,
 * budget-ads.md 5.1 and 5.2; WAVE56-CONTRACT.md 4.21 and 5.16). Pure.
 *
 * The rates are the cockpit's fixed ones, the same table as
 * public.cockpit_board_usd_rate and the three currency.ts copies (Convex,
 * hermes/cockpit-sync, cockpit-media-api); scripts/kickoff-sheet.test.tsx
 * reads both and fails when they drift. The kickoff check (B5) converts on
 * the server; this file only says the dollars on screen before the send.
 * The BHD estimate below is display-only. It does not change the
 * server's launch or card-budget conversion or allow Meta budget writes.
 */

/** The currencies the kickoff asks, in the sheet's order; the first is the default. */
export const KICKOFF_CURRENCIES = [
  "USD",
  "SAR",
  "KWD",
  "AED",
  "QAR",
  "BHD",
] as const;
export type KickoffCurrency = (typeof KICKOFF_CURRENCIES)[number];

/** Dollars per unit, as cockpit_board_usd_rate holds them. BHD has none yet. */
export const USD_PER: Readonly<Record<string, number>> = {
  USD: 1,
  QAR: 0.2747,
  SAR: 0.2666,
  AED: 0.2723,
  KWD: 3.26,
};

/**
 * Indicative USD per unit, based on the Bahrain central bank's
 * 0.376 BHD per USD peg.
 * https://www.cbb.gov.bh/wp-content/uploads/2025/03/Feb-2025.pdf
 * This estimate is deliberately separate from the action-producing rates.
 */
export const INDICATIVE_ONLY_USD_PER: Readonly<Record<string, number>> = {
  BHD: 2.6596,
};

/** The amount in dollars to the cent at the cockpit's rate, or null with no rate. */
export function budgetUsd(amount: number, currency: string): number | null {
  const rate = USD_PER[currency.trim().toUpperCase()];
  if (!rate || !Number.isFinite(amount)) return null;
  // Rounded on the cents, as round(amount * rate, 2) does on a numeric.
  return Math.round(Math.round(amount * rate * 1e6) / 1e4) / 100;
}

/** "$39.99", "$40", "$1,200.50": the dollars as the sheet says them. */
export function dollarsWords(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The amount as Make's handoff line prints it: no thousands mark, no
 * trailing zeros ("40", "37.5", "1500"), as cockpit_kickoff_answers_check
 * writes it before the currency.
 */
export function amountText(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** "150 SAR": the answer as Make's text, which the kickoff check (B5) also writes. */
export function budgetText(amount: number, currency: string): string {
  return `${amountText(amount)} ${currency.trim().toUpperCase()}`;
}

/**
 * The live line under a non-USD amount (the field's signature): its dollars
 * at the cockpit's rate, or why there are none. Nothing for dollars, an empty
 * amount or one the rule refuses.
 */
export function budgetLine(
  amount: number | null,
  currency: string,
): string | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const c = currency.trim().toUpperCase();
  if (c === "USD") return null;
  const indicativeRate = INDICATIVE_ONLY_USD_PER[c];
  if (indicativeRate) {
    const estimate =
      Math.round(Math.round(amount * indicativeRate * 1e6) / 1e4) / 100;
    return `≈ ${dollarsWords(estimate)} a day. Estimate only; this is not yet used for launch or card budgets.`;
  }
  const usd = budgetUsd(amount, c);
  if (usd === null)
    return `No fixed rate for ${c} yet, so the media buyers see the amount as typed.`;
  return `≈ ${dollarsWords(usd)} a day at the cockpit's rate.`;
}

/**
 * The sale's figure (the card's Daily Budget, USD) as a one-tap fill, or
 * null: none on the card, or 1,000 and more, which looks like a month or
 * another currency (the media buyers' guard, B6), so it is never offered.
 */
export function saleQuick(
  saleUsd: number | null | undefined,
): { label: string; value: { amount: string; currency: "USD" } } | null {
  if (typeof saleUsd !== "number" || !Number.isFinite(saleUsd)) return null;
  if (saleUsd < 1 || saleUsd >= 1000) return null;
  return {
    label: `Same as the sale: ${dollarsWords(saleUsd)}`,
    value: { amount: amountText(saleUsd), currency: "USD" },
  };
}
