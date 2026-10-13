/**
 * The evidence store (SPEC.md "Screenshots"): a screenshot judged not work is
 * copied, thumbnail and full image, into the private bucket
 * cockpit-hours-watch so it outlives Hubstaff's 2-hour link. Others are never
 * stored. Written with the service key through Storage's REST API; the CEO
 * reads through signed links under the bucket's own policy. Every call is
 * receipted (provider storage). Only paths of the watch's own shape are ever
 * written or deleted.
 */
import type { WatchHealth } from "./ledger.ts";
import { kuwaitDay } from "./text.ts";

export const BUCKET = "cockpit-hours-watch";
const PATH = /^\d{1,12}\/\d{4}-\d{2}-\d{2}\/\d{1,19}-(thumb|full)\.jpg$/;

export type StorageDeps = { url: string; serviceKey: string; health: WatchHealth; fetch: typeof fetch };

/** '<personId>/<kuwait-day>/<shotId>-thumb.jpg' and '-full.jpg', the day the screenshot was taken. */
export function shotPaths(personId: number, recordedAt: string, shotId: number): { thumb: string; full: string } {
  const base = `${personId}/${kuwaitDay(recordedAt)}/${shotId}`;
  return { thumb: `${base}-thumb.jpg`, full: `${base}-full.jpg` };
}

export const isShotPath = (path: unknown): path is string => typeof path === "string" && PATH.test(path);

class StorageError extends Error {}
export const STORAGE_TIMEOUT_MS = 20_000;

async function storageCall(deps: StorageDeps, method: "POST" | "DELETE", path: string | null, init: RequestInit, timeoutMs = STORAGE_TIMEOUT_MS): Promise<void> {
  const host = (() => { try { return new URL(deps.url).host; } catch { return "storage"; } })();
  const receipt = { provider: "storage" as const, method, resource: `${host}/storage/v1/object/${BUCKET}${path === null ? "" : "/{path}"}` };
  await deps.health({ ...receipt, phase: "intent" });
  let response: Response;
  try {
    response = await deps.fetch(`${deps.url}/storage/v1/object/${BUCKET}${path === null ? "" : `/${path}`}`, {
      ...init, method, headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}`, ...(init.headers as Record<string, string> ?? {}) },
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, STORAGE_TIMEOUT_MS))),
    });
  } catch {
    await deps.health({ ...receipt, phase: "unknown", error: "No answer from Storage" });
    throw new StorageError("Storage did not answer.");
  }
  await response.text().catch(() => "");
  await deps.health({ ...receipt, phase: "response", http_status: response.status, error: response.ok ? undefined : `HTTP ${response.status}` });
  if (!response.ok) throw new StorageError(`Storage answered ${response.status}.`);
}

/** Store one image (replacing an earlier copy of the same screenshot). */
export async function uploadImage(deps: StorageDeps, path: string, bytes: Uint8Array, timeoutMs = STORAGE_TIMEOUT_MS): Promise<void> {
  if (!isShotPath(path)) throw new StorageError("That is not a screenshot path the watch writes.");
  await storageCall(deps, "POST", path, { headers: { "Content-Type": "image/jpeg", "x-upsert": "true", "Cache-Control": "max-age=3600" }, body: bytes as unknown as BodyInit }, timeoutMs);
}

/** Delete the images the prune let go of, 100 at a time. Returns how many were sent for deletion. */
export async function deletePaths(deps: StorageDeps, paths: unknown[]): Promise<number> {
  const mine = [...new Set(paths.filter(isShotPath))];
  for (let i = 0; i < mine.length; i += 100)
    await storageCall(deps, "DELETE", null, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: mine.slice(i, i + 100) }) });
  return mine.length;
}
