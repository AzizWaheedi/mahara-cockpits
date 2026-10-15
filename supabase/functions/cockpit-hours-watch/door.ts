/**
 * The cron door of cockpit-hours-watch (JWT check off): only a caller with the
 * shared cron secret gets past it, compared in constant time before the body
 * is read. The body is exactly {"job": "watch" | "doctor", "dryRun"?: true};
 * anything else is 400, never a silent fallback. cockpit-hours-api's "Check
 * now" adds the CEO's verified email as requestedBy, so the run is recorded
 * as his.
 *
 *   watch           claim the lease, answer 202, work in the background
 *   watch + dryRun  claim the lease, answer the plan, write nothing
 *   doctor          name what is missing and check each provider once
 */
import { claimWatch, type DoctorResult, type RunDeps, type RunResult, runDoctor, runWatch } from "./run.ts";

export type DoorDeps = RunDeps & {
  cronSecret: () => string;
  waitUntil: (work: Promise<unknown>) => void;
  /** Swappable for tests; the real ones by default. */
  watch?: (deps: RunDeps, run: { runId: number; leaseToken: string; dryRun: boolean }) => Promise<RunResult>;
  doctor?: (deps: RunDeps) => Promise<DoctorResult>;
};

/** Constant-time comparison of two strings (the same as cockpit-hours-sync's door, kept here so this bundle stays small). */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;
const ALLOWED = new Set(["job", "dryRun", "requestedBy"]);

export type Job = { job: "watch" | "doctor"; dryRun: boolean; requestedBy: string };

/** The body, strictly; a sentence saying what to send when it is anything else. */
export function readJob(body: unknown): Job | string {
  const send = 'Send {"job": "watch"} or {"job": "doctor"}, with "dryRun": true for a plan.';
  if (!body || typeof body !== "object" || Array.isArray(body)) return send;
  const b = body as Record<string, unknown>;
  if (b.job !== "watch" && b.job !== "doctor") return send;
  const extra = Object.keys(b).filter(k => !ALLOWED.has(k));
  if (extra.length) return `Unknown field ${extra[0].slice(0, 40)}. ${send}`;
  if (b.dryRun !== undefined && typeof b.dryRun !== "boolean") return `dryRun must be true or false. ${send}`;
  if (b.requestedBy !== undefined && (typeof b.requestedBy !== "string" || !EMAIL.test(b.requestedBy))) return `requestedBy must be an email address. ${send}`;
  return { job: b.job, dryRun: b.dryRun === true, requestedBy: typeof b.requestedBy === "string" ? b.requestedBy.toLowerCase() : "cron" };
}

export function makeWatchDoor(deps: DoorDeps) {
  const watch = deps.watch ?? runWatch;
  const doctor = deps.doctor ?? runDoctor;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
    const expected = deps.cronSecret().trim();
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!expected || !given || !sameSecret(given, expected)) return json({ ok: false, note: "not allowed" }, 401);
    let parsed: unknown = null;
    try { parsed = await req.json(); } catch { parsed = null; }
    const job = readJob(parsed);
    if (typeof job === "string") return json({ ok: false, note: job }, 400);
    try {
      if (job.job === "doctor") return json(await doctor(deps));
      const claim = await claimWatch(deps.rpc, { requestedBy: job.requestedBy, dryRun: job.dryRun });
      if (!claim.ok) return json({ ok: false, busy: true, since: claim.since });
      const run = { runId: claim.runId, leaseToken: claim.leaseToken, dryRun: job.dryRun };
      if (job.dryRun) return json(await watch(deps, run));
      deps.waitUntil(watch(deps, run).catch(() => undefined));
      return json({ ok: true, runId: claim.runId }, 202);
    } catch (e) {
      return json({ ok: false, note: e instanceof Error ? e.message.slice(0, 240) : "The watch could not start." }, 500);
    }
  };
}
