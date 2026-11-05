/** Synthetic transaction model only. It is not a database, migration, provider adapter,
 * source of evidence that a send occurred, or a replacement for real concurrent SQL tests.
 * Each method below models one atomic row-locked transaction in a single process.
 * A production protocol also needs permissions, owner-gate serialization, process-death
 * recovery and a way to prevent an old worker from sending after lease expiry. */
export type State = "queued" | "failed" | "claimed" | "unknown" | "sent";
type Claim = { id: string; until: number; phase: "reserved" | "started"; priorState: "queued" | "failed"; priorUpdated: number };
export class FenceModel {
  state: State;
  attempts: number;
  updated: number;
  private claimValue: Claim | null = null;
  constructor(state: "queued" | "failed", attempts: number, updated: number) {
    if (!Number.isInteger(attempts) || attempts < 0 || attempts >= 3 || (state === "queued" && attempts !== 0)) throw Error("invalid fixture");
    this.state = state; this.attempts = attempts; this.updated = updated;
  }
  claim(id: string, now: number, until: number): boolean {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !Number.isFinite(now) || !Number.isFinite(until) || until <= now ||
        !(this.state === "queued" || (this.state === "failed" && this.attempts < 3 && now - this.updated >= 600_000))) return false;
    this.claimValue = { id, until, phase: "reserved", priorState: this.state, priorUpdated: this.updated };
    this.state = "claimed"; this.attempts++; this.updated = now;
    return true;
  }
  begin(id: string, now: number): boolean {
    const c = this.claimValue;
    if (!Number.isFinite(now) || this.state !== "claimed" || !c || c.id !== id || c.until <= now || c.phase !== "reserved") return false;
    c.phase = "started"; return true;
  }
  release(id: string, now: number): boolean {
    const c = this.claimValue;
    if (!Number.isFinite(now) || this.state !== "claimed" || !c || c.id !== id || c.until <= now || c.phase !== "reserved") return false;
    this.state = c.priorState; this.updated = c.priorUpdated; this.attempts--; this.claimValue = null;
    return true;
  }
  settle(id: string, now: number, outcome: "sent" | "unknown"): boolean {
    const c = this.claimValue;
    if (!Number.isFinite(now) || this.state !== "claimed" || !c || c.id !== id || c.until <= now || c.phase !== "started") return false;
    this.state = outcome; this.updated = now; this.claimValue = null; return true;
  }
  expire(now: number): boolean {
    const c = this.claimValue;
    if (!Number.isFinite(now) || this.state !== "claimed" || !c || c.until > now) return false;
    this.state = "unknown"; this.updated = now; this.claimValue = null; return true;
  }
}
