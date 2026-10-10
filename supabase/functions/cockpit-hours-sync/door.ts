/**
 * The cron door of cockpit-hours-sync (JWT check off): only a caller with
 * the shared cron secret gets past it, and the body is not read before the
 * secret is checked. It claims the lease, replies 202 at once and does the
 * work in the background. The body's requested_by is ignored: cron runs are
 * always recorded as cron.
 */
import type { InsertReceipt, Rpc } from "./db.ts";
import { claimLease, type Mode } from "./lease.ts";
import { runSync } from "./sync.ts";

export type DoorDeps = {
  cronSecret: () => string;
  rpc: Rpc;
  insertReceipt: InsertReceipt;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  waitUntil: (work: Promise<unknown>) => void;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time comparison of two strings. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function makeSyncDoor(deps: DoorDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
    const expected = deps.cronSecret().trim();
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!expected || !given || !sameSecret(given, expected)) return json({ ok: false, note: "not allowed" }, 401);
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await req.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch { /* an empty body is a recent read */ }
    const mode = (["recent", "deep", "doctor"].includes(String(body.mode)) ? body.mode : "recent") as Mode;
    const dryRun = body.dryRun === true;
    const claim = await claimLease(deps.rpc, { mode, requestedBy: "cron", dryRun });
    if (!claim.ok) return json({ ok: false, busy: true, since: claim.since });
    deps.waitUntil(runSync(deps, { runId: claim.runId, leaseToken: claim.leaseToken, mode, dryRun }).catch(() => undefined));
    return json({ ok: true, runId: claim.runId }, 202);
  };
}
