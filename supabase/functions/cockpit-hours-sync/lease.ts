/** One lease at a time over cockpit_hours_sync_runs (atomic claim, token fenced at apply). */
import type { Rpc } from "./db.ts";

export type Mode = "recent" | "deep" | "month" | "doctor";
export type Claim =
  | { ok: true; runId: number; leaseToken: string }
  | { ok: false; busy: true; since: string | null; runId?: number };

export async function claimLease(rpc: Rpc, p: { mode: Mode; requestedBy: string; windowFrom?: string | null; windowTo?: string | null; dryRun?: boolean }): Promise<Claim> {
  const r = (await rpc("cockpit_hours_lease_claim", { p })) as Record<string, unknown>;
  if (r?.ok === true && typeof r.leaseToken === "string") return { ok: true, runId: Number(r.runId), leaseToken: r.leaseToken };
  return { ok: false, busy: true, since: typeof r?.since === "string" ? r.since : null, runId: r?.runId === undefined ? undefined : Number(r.runId) };
}

export async function renewLease(rpc: Rpc, runId: number, leaseToken: string): Promise<boolean> {
  const r = (await rpc("cockpit_hours_lease_renew", { p: { runId, leaseToken } })) as Record<string, unknown>;
  return r?.ok === true;
}

export type ProviderSummary = { state: string; calls: number; rows: number; accounts: number; note: string | null };

export async function finishRun(rpc: Rpc, runId: number, leaseToken: string, out: {
  state: "ok" | "failed"; hubstaff: ProviderSummary | null; timetastic: ProviderSummary | null; crosscheck?: unknown; error?: string | null;
}): Promise<void> {
  await rpc("cockpit_hours_run_finish", { p: { runId, leaseToken, ...out } });
}
