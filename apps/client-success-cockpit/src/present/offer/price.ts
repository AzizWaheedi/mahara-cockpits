import { digits, type L, type Lang } from "../content";
import type { Overrides } from "../deckData";
import type { CatalogRow } from "./sources";
export type Price = Record<string, number>;
export const validPrice = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 1 &&
  v <= 1000000 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.000001;
export const CADENCE: Record<string, L> = {
  one_time: { en: "One time", ar: "مرة واحدة" },
  monthly: { en: "Monthly", ar: "شهرياً" },
  per_day: { en: "Per day", ar: "لليوم" },
  per_90_days: { en: "For 90 days", ar: "لمدة ٩٠ يوم" },
};
export function listOf(row: CatalogRow): Price | null {
  const out: Price = {};
  for (const p of row.parts) {
    if (p.amount === null) return null;
    out[p.key] = p.amount;
  }
  return out;
}
export function openingOf(row: CatalogRow, prep: Overrides): Price | null {
  const raw = prep.opening_price;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Price = {};
    for (const p of row.parts) {
      const v = (raw as Record<string, unknown>)[p.key];
      if (!validPrice(v)) return null;
      out[p.key] = v;
    }
    return out;
  }
  return listOf(row);
}
export function belowList(parts: Price | null, row: CatalogRow): boolean {
  return Boolean(
    parts && row.parts.some(p => p.amount !== null && parts[p.key] < p.amount),
  );
}
export function firstYearUsd(parts: Price, row: CatalogRow): number | null {
  if (
    row.parts.some(p => p.cadence === "per_day" || p.cadence === "per_90_days")
  )
    return null;
  return row.parts.reduce(
    (sum, p) => sum + parts[p.key] * (p.cadence === "monthly" ? 12 : 1),
    0,
  );
}
export function inCurrency(
  usd: number,
  currency: string,
  usdPer: number | null,
): { amount: number; currency: string } {
  return currency === "USD"
    ? { amount: usd, currency }
    : usdPer && usdPer > 0
      ? { amount: usd / usdPer, currency }
      : { amount: usd, currency: "USD" };
}
export function formatMoney(n: number, currency: string, lang: Lang): string {
  const en = new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    n,
  );
  const ar = en.replaceAll(",", n < 10000 ? "" : "\u202f").replace(".", "٫");
  return `${digits(lang === "ar" ? ar : en, lang)} ${currency}`;
}
