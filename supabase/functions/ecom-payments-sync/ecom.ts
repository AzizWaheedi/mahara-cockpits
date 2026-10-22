// Pure helpers for ecom-payments-sync, kept apart so they run under bun test.

export type Row = Record<string, unknown>;

/** USD per 1 KWD when an invoice did not come from the cockpit (tap-charges-sync's fixed rate). */
export const FIXED_USD_PER_KWD = 3.26;
const KUWAIT_OFFSET_MS = 3 * 3600 * 1000;

export const kuwaitDay = (ms: number) =>
  new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Ecom's signature string (docs, Webhook Signature): drop null values, sort the
 * keys case-insensitively, join key=value with "&". The docs' prose says
 * commas; every code sample joins with "&", and the samples are what Ecom runs.
 */
export function signatureString(data: Row): string {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("&");
}

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : null;
};
const str = (x: unknown, max = 300): string | null => {
  const s = String(x ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const ms = (x: unknown): number | null => {
  const t = Date.parse(String(x ?? ""));
  return Number.isFinite(t) ? t : null;
};

/**
 * One Ecom E-Links invoice (list or read) to a ledger row. `rates` maps an
 * Ecom invoice id to the USD per KWD the cockpit used when it made the link.
 */
export function ledgerRow(inv: Row, rates: Map<string, { usdPerKwd: number; cockpitId: string }>, now: Date): Row | null {
  const id = str(inv.id, 120);
  if (!id || !/^INV_/.test(id)) return null;
  const amount = (inv.amount ?? {}) as Row;
  const kwd = num(amount.value);
  if (kwd === null) return null;
  const currency = (str(amount.currency, 8) ?? "KWD").toUpperCase();
  const status = (str(inv.status, 40) ?? "UNKNOWN").toUpperCase();
  const paidAt = ms(inv.paidAt) ?? ms((inv.transaction as Row | undefined)?.paidAt);
  const createdAt = ms(inv.createdAt);
  const known = rates.get(id);
  const usdPerKwd = currency === "KWD" ? (known?.usdPerKwd ?? FIXED_USD_PER_KWD) : null;
  const customer = (inv.customer ?? {}) as Row;
  const meta = (inv.metadata ?? {}) as Row;
  const cockpitId = known?.cockpitId ?? (typeof meta.key1 === "string" && /^[0-9a-f-]{36}$/i.test(meta.key1) ? meta.key1 : null);
  const when = paidAt ?? createdAt ?? now.getTime();
  return {
    id,
    invoice_number: str(inv.invoiceNumber, 60),
    ecom_reference: str(inv.ecomReference, 60),
    merchant_reference: str(inv.merchantReference, 120),
    status,
    amount_kwd: Math.round(kwd * 1000) / 1000,
    currency,
    usd: usdPerKwd === null ? null : Math.round(kwd * usdPerKwd * 100) / 100,
    usd_rate: usdPerKwd,
    usd_rate_source: usdPerKwd === null ? null : known ? "invoice" : "fixed",
    payment_method: str(inv.paymentMethod, 40),
    paid_at: paidAt ? new Date(paidAt).toISOString() : null,
    day: kuwaitDay(when),
    customer_name: str(customer.fullName, 120),
    customer_email: str(customer.email, 160)?.toLowerCase() ?? null,
    description: str(inv.description, 200),
    payment_url: str(inv.paymentUrl, 500),
    cockpit_invoice_id: cockpitId,
    created_at: createdAt ? new Date(createdAt).toISOString() : null,
    raw: { paymentNetwork: inv.paymentNetwork ?? null, purposeEn: inv.purposeEn ?? null },
    synced_at: now.toISOString(),
  };
}
