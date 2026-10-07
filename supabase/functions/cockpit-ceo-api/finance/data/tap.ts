export const USD_PER: Record<string, number> = {
  USD: 1,
  KWD: 3.26,
  AED: 0.2723,
  SAR: 0.2666,
  QAR: 0.2747,
};

/** One captured Tap charge, already placed on a Kuwait day. */
export type TapCharge = {
  id: string;
  /** Kuwait day the charge was made, YYYY-MM-DD. */
  day: string;
  /** When the charge was made, epoch ms. */
  at: number;
  currency: string;
  /** The amount in `currency`, as Tap gave it. */
  amount: number;
  /** `amount` in USD, or null when this file has no rate for the currency. */
  usd: number | null;
  /** The customer's email on the charge, lower case, so Tap can be matched like Whop (2026-09-21). */
  email: string | null;
  /** The customer's name on the charge, first and last, as Tap holds it. */
  name: string | null;
};

