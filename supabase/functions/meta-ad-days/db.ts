/**
 * The service-role door to Creative Triage for meta-ad-days: its RPCs
 * through PostgREST and its receipts into cockpit_meta_ad_day_receipts.
 * Errors carry the database's sentence and code, never the key.
 */
import type { Receipt } from "./graph.ts";

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type ReceiptRow = Receipt & { run_id: string | null; receipt_index: number | null };
export type InsertReceipt = (row: ReceiptRow) => Promise<void>;

/**
 * The only RPCs this function calls (db.test.ts checks every deps.rpc name in
 * run.ts and door.ts is here). cockpit_meta_lead_ids_apply was missing until
 * 2026-10-17: every nightly lead-ids task was refused here and retried 4
 * times (292 wasted Meta lead reads on the night of 17 Oct).
 */
export const RPCS = new Set([
  "cockpit_meta_ad_days_inputs",
  "cockpit_meta_ad_days_begin",
  "cockpit_meta_ad_days_claim",
  "cockpit_meta_ad_days_apply",
  "cockpit_meta_reach_apply",
  "cockpit_meta_lead_ids_apply",
  "cockpit_meta_budgets_apply",
  "cockpit_meta_budget_history_apply",
  "cockpit_meta_ad_days_fail",
  "cockpit_meta_ad_days_record",
  "cockpit_meta_ad_days_status",
]);

/** Refusals no later try can fix: a name not on the list above, or the function's secrets not set. */
export const NOT_ALLOWED = "not_allowed";
export const NOT_SET = "not_set";
export const NOT_RETRIED = new Set([NOT_ALLOWED, NOT_SET]);

export class RpcError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export function restRpc(url: string, serviceKey: string, request: typeof fetch = fetch): Rpc {
  return async (name, args) => {
    if (!RPCS.has(name)) throw new RpcError(`meta-ad-days does not call ${name.slice(0, 60)}; add it to RPCS in db.ts.`, NOT_ALLOWED);
    if (!url || !serviceKey) throw new RpcError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on meta-ad-days.", NOT_SET);
    const res = await request(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const message = typeof b.message === "string" ? b.message.split(serviceKey).join("[key]").slice(0, 240) : `The database answered ${res.status}`;
      throw new RpcError(message, typeof b.code === "string" ? b.code : null);
    }
    return body;
  };
}

export function restReceipts(url: string, serviceKey: string, request: typeof fetch = fetch): InsertReceipt {
  return async row => {
    const res = await request(`${url}/rest/v1/cockpit_meta_ad_day_receipts`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("The Meta call receipt could not be saved; no call was made without one.");
  };
}
