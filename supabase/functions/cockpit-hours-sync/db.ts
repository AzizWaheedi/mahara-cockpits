/**
 * The service-role door to Creative Triage for the hours functions: RPCs
 * through PostgREST and receipts into cockpit_hours_provider_health. Errors
 * carry the database's sentence and code, never a key.
 */
import type { HoursReceipt } from "../cockpit-ceo-api/tools.ts";

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type ReceiptRow = HoursReceipt & { run_id: number | null; receipt_index: number | null };
export type InsertReceipt = (row: ReceiptRow) => Promise<void>;

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
    if (!/^cockpit_[a-z_]+$/.test(name)) throw new RpcError("Unknown hours function", null);
    const res = await request(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
      const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const message = typeof b.message === "string" ? b.message.replaceAll(serviceKey, "[key]").slice(0, 240) : `Database answered ${res.status}`;
      throw new RpcError(message, typeof b.code === "string" ? b.code : null);
    }
    return body;
  };
}

export function restReceipts(url: string, serviceKey: string, request: typeof fetch = fetch): InsertReceipt {
  return async row => {
    const res = await request(`${url}/rest/v1/cockpit_hours_provider_health`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error("The hours provider receipt could not be saved; no call was made without one.");
  };
}

/** A health callback for one run: numbers each receipt. */
export function runHealth(insert: InsertReceipt, runId: number | null) {
  let index = 0;
  const health = async (row: HoursReceipt) => {
    index += 1;
    await insert({ ...row, error: row.error?.slice(0, 240), run_id: runId, receipt_index: runId === null ? null : index });
  };
  return { health, count: () => index };
}
