import { kuwaitDay } from "@/components/ceo/format";
import { supabase } from "@/lib/supabase";
import type { SignedDeal } from "./credit";

/**
 * The signed deals the Attribute sheet lists (MONEY-ATTRIBUTION.md section
 * 2), read straight from cockpit_sales_deals with the CEO's own session: the
 * seat policy (cockpit_sales_manager(), true for the CEO) lets the CEO read
 * it, and it is the table cockpit_ceo_payment_tie checks a deal against. The
 * window is the twelve months of payments the Money tab attributes plus the
 * deal term before them. Voided deals come back marked and are left out of
 * the list, never silently dropped here. No payer or amount is logged.
 */

const COLUMNS = [
  "response_id",
  "submitted_at",
  "closer",
  "business_name",
  "client_name",
  "email",
  "cash_collected",
  "contracted_revenue",
  "payment_structure",
  "voided",
].join(",");

/** Twelve months of payments plus the 120-day deal term, and a little over. */
const LOOKBACK_DAYS = 500;

type Row = {
  response_id: string;
  submitted_at: string | null;
  closer: string | null;
  business_name: string | null;
  client_name: string | null;
  email: string | null;
  cash_collected: number | string | null;
  contracted_revenue: number | string | null;
  payment_structure: string | null;
  voided: boolean | null;
};

const text = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const amount = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One row in the sheet's shape. Pure, for the tests. */
export function signedDeal(r: Row): SignedDeal | null {
  const id = text(r.response_id);
  if (!id) return null;
  const at = r.submitted_at ? Date.parse(r.submitted_at) : Number.NaN;
  return {
    responseId: id,
    business: text(r.business_name),
    contact: text(r.client_name),
    email: text(r.email)?.toLowerCase() ?? null,
    closer: text(r.closer),
    signedDay: Number.isFinite(at) ? kuwaitDay(at) : null,
    contracted: amount(r.contracted_revenue),
    deposit: amount(r.cash_collected),
    plan: text(r.payment_structure),
    voided: r.voided === true,
  };
}

export async function readSignedDeals(): Promise<SignedDeal[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("cockpit_sales_deals")
    .select(COLUMNS)
    .gte("submitted_at", since)
    .order("submitted_at", { ascending: false })
    .limit(1000);
  if (error)
    throw new Error(
      `The closer form's deals could not be read: ${error.message}`,
    );
  return ((data ?? []) as unknown as Row[])
    .map(signedDeal)
    .filter((d): d is SignedDeal => d !== null);
}
