/**
 * Receipts for Hubstaff watch, in the hours ledger
 * (cockpit_hours_provider_health). Hubstaff calls are receipted by
 * hubstaffGet itself; this file covers the watch's own callers: Slack, the
 * vision model (google-ai or openai), the screenshot downloads (hubstaff,
 * from the signed S3 link) and the private bucket (storage). The resource is
 * always a host-qualified template: no ids, no query string, never a key.
 * A receipt that cannot be saved throws, so no call is made without one.
 */
import type { HoursReceipt } from "../cockpit-ceo-api/tools.ts";

export type WatchProvider = "hubstaff" | "slack" | "google-ai" | "openai" | "storage";
export type WatchReceipt = {
  provider: WatchProvider;
  method: "GET" | "POST" | "DELETE";
  resource: string;
  phase: "intent" | "response" | "unknown";
  http_status?: number;
  error?: string;
};
export type WatchReceiptRow = WatchReceipt & { run_id: number | null; receipt_index: number | null };
export type WatchInsert = (row: WatchReceiptRow) => Promise<void>;
export type WatchHealth = (row: WatchReceipt) => Promise<void>;

/** Receipts into the hours ledger through PostgREST with the service key. */
export function restWatchReceipts(url: string, serviceKey: string, request: typeof fetch = fetch): WatchInsert {
  return async row => {
    const res = await request(`${url}/rest/v1/cockpit_hours_provider_health`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error("The watch's provider receipt could not be saved; no call was made without one.");
  };
}

/**
 * One run's receipts, numbered in order. `hubstaff` is the same callback typed
 * for hubstaffGet and hubstaffAccess, so every receipt of a run shares one
 * sequence.
 */
export function watchHealth(insert: WatchInsert, runId: number | null) {
  let index = 0;
  const health: WatchHealth = async row => {
    index += 1;
    await insert({ ...row, error: row.error?.slice(0, 240), run_id: runId, receipt_index: runId === null ? null : index });
  };
  const hubstaff = (row: HoursReceipt) => health(row as WatchReceipt);
  return { health, hubstaff, count: () => index };
}

/** host/path of a link, for a receipt: no query, no fragment, no credentials, ids folded to a template. */
export function linkTemplate(link: string, template: string): string {
  try {
    return `${new URL(link).host}/${template}`.slice(0, 300);
  } catch {
    return `unknown-host/${template}`;
  }
}
