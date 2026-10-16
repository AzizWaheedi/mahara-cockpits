/**
 * The cron door of meta-ad-days (JWT check off): only a caller with the
 * shared cron secret (vault cockpit_sync_secret = function secret
 * CRON_SECRET) gets past it, compared in constant time before the body is
 * read. The body is exactly one of:
 *
 *   {"job": "hourly"}                       yesterday and today, every spending account (202, in the background)
 *   {"job": "nightly"}                      the 28 days before today, and reach over the five windows at every level
 *   {"job": "backfill", "days": 90}         the N days before today (1 to 90); "accounts": ["123…"] for some only
 *   {"job": "continue"}                     work the queued tasks (pg_cron, every 2 minutes while some wait)
 *   {"job": "doctor"}                       reads only; the answer names what is missing (200)
 *
 * with "dryRun": true on hourly, nightly or backfill for the plan (accounts,
 * ties, reads) with nothing written, and "requestedBy": "<email>" to name who
 * asked. Anything else is 400.
 */
import { type Job, type RunDeps, startJob } from "./run.ts";

export type DoorDeps = RunDeps & {
  cronSecret: () => string;
  waitUntil: (work: Promise<unknown>) => void;
  /** Swappable for tests. */
  start?: (deps: RunDeps, job: Job) => Promise<Record<string, unknown>>;
};

/** Constant-time comparison of two strings. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;
const ALLOWED = new Set(["job", "days", "accounts", "dryRun", "requestedBy"]);
const JOBS = new Set(["hourly", "nightly", "backfill", "continue", "doctor"]);
const SEND =
  'Send {"job": "hourly"}, {"job": "nightly"}, {"job": "backfill", "days": 1 to 90}, {"job": "continue"} or {"job": "doctor"}, with "dryRun": true for a plan.';

/** The body, strictly; a sentence saying what to send when it is anything else. */
export function readJob(body: unknown): Job | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return SEND;
  const b = body as Record<string, unknown>;
  if (typeof b.job !== "string" || !JOBS.has(b.job)) return SEND;
  const extra = Object.keys(b).filter(k => !ALLOWED.has(k));
  if (extra.length) return `Unknown field ${extra[0].slice(0, 40)}. ${SEND}`;
  if (b.dryRun !== undefined && typeof b.dryRun !== "boolean") return `dryRun must be true or false. ${SEND}`;
  if (b.dryRun === true && (b.job === "continue" || b.job === "doctor")) return `dryRun goes with hourly, nightly or backfill. ${SEND}`;
  if (b.requestedBy !== undefined && (typeof b.requestedBy !== "string" || !EMAIL.test(b.requestedBy))) return `requestedBy must be an email address. ${SEND}`;
  if (b.days !== undefined && (b.job !== "backfill" || !Number.isInteger(b.days) || (b.days as number) < 1 || (b.days as number) > 90)) {
    return `days goes with a backfill, 1 to 90. ${SEND}`;
  }
  if (b.accounts !== undefined) {
    const list = b.accounts;
    if (b.job !== "backfill" || !Array.isArray(list) || !list.length || list.length > 60 || !list.every(a => typeof a === "string" && /^(act_)?[0-9]{5,25}$/.test(a))) {
      return `accounts goes with a backfill: a list of ad account ids. ${SEND}`;
    }
  }
  const requestedBy = typeof b.requestedBy === "string" ? b.requestedBy.toLowerCase() : "cron";
  const dryRun = b.dryRun === true;
  if (b.job === "backfill") {
    return {
      job: "backfill",
      days: typeof b.days === "number" ? b.days : 90,
      ...(Array.isArray(b.accounts) ? { accounts: (b.accounts as string[]).map(a => a.replace(/^act_/, "")) } : {}),
      dryRun,
      requestedBy,
    };
  }
  if (b.job === "hourly" || b.job === "nightly") return { job: b.job, dryRun, requestedBy };
  return { job: b.job as "continue" | "doctor", dryRun: false, requestedBy };
}

export function makeDoor(deps: DoorDeps) {
  const start = deps.start ?? startJob;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
    const expected = deps.cronSecret().trim();
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!expected || !given || !sameSecret(given, expected)) return json({ ok: false, note: "not allowed" }, 401);
    let parsed: unknown = null;
    try {
      parsed = await req.json();
    } catch {
      parsed = null;
    }
    const job = readJob(parsed);
    if (typeof job === "string") return json({ ok: false, note: job }, 400);
    try {
      if (job.job === "doctor" || job.dryRun) return json(await start(deps, job));
      deps.waitUntil(
        start(deps, job).then(
          r => console.log(`meta-ad-days ${job.job} ${r.ok === false ? "FAILED" : "ok"}: ${String(r.note ?? JSON.stringify(r)).slice(0, 300)}`),
          async e => {
            const note = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
            console.error(`meta-ad-days ${job.job} FAILED: ${note}`);
            // The failure is written where the board and the guardian read it, when the database answers.
            await deps
              .rpc("cockpit_meta_ad_days_record", { p: { job: job.job, ok: false, note: `The ${job.job} job stopped: ${note}`, requestedBy: job.requestedBy, detail: {} } })
              .catch(() => console.error("meta-ad-days FAILED to record its failure"));
          },
        ),
      );
      return json({ ok: true, started: job.job }, 202);
    } catch (e) {
      return json({ ok: false, note: e instanceof Error ? e.message.slice(0, 240) : "The job could not start." }, 500);
    }
  };
}
