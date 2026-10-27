/**
 * The door of cockpit-notices (contract 4.2). Deployed with the JWT check
 * off: pg_cron reaches it with the shared secret (vault
 * cockpit_notices_cron_secret = function secret NOTICES_CRON_SECRET), compared
 * in constant time before the body is read. There is no browser path: editors
 * reach the sender only through rows the database queues (a test, a channel
 * to check). Bodies are read strictly; anything else is 400 with the sentence
 * saying what to send, never a silent fallback.
 *
 *   {"job":"run"}                                         202, the run goes on in the background
 *   {"job":"doctor"}                                      200 Doctor
 *   {"job":"dryRun","responseId":"..."}                   200 DryRun (a kickoff from the mirror)
 *   {"job":"dryRun","kind":"...","taskId":"...","facts":{...},"variant"?:"..."}   200 DryRun
 *   {"job":"rehearse","kind"?:"...","to"?:"U..."}         200 the test's outcome
 */
import { type Doctor, runDoctor } from "./doctor.ts";
import { type DryRun, type DryRunJob, JobError, type Rehearsal, type RehearseJob, runDryRun, runNotices, runRehearse, type RunResult } from "./run.ts";
import type { NoticeDeps } from "./send.ts";
import { isNoticeKind, type NoticeKind, VARIANTS, type Variant } from "./text.ts";

export type DoorDeps = NoticeDeps & {
  cronSecret: () => string;
  waitUntil: (work: Promise<unknown>) => void;
  /** Swappable for tests; the real ones by default. */
  run?: (deps: NoticeDeps) => Promise<RunResult>;
  doctor?: (deps: NoticeDeps) => Promise<Doctor>;
  dryRun?: (deps: NoticeDeps, job: DryRunJob) => Promise<DryRun>;
  rehearse?: (deps: NoticeDeps, job: RehearseJob) => Promise<Rehearsal>;
};

/** Constant-time comparison of two strings (as cockpit-hours-watch's door). */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const SEND = 'Send {"job":"run"}, {"job":"doctor"}, {"job":"dryRun", ...} or {"job":"rehearse", ...}.';
const MAX_BODY = 32 * 1024;
const RESPONSE_ID = /^[A-Za-z0-9]{8,64}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const PERSON = /^[UW][A-Z0-9]{8,12}$/;

export type Job =
  | { job: "run" }
  | { job: "doctor" }
  | { job: "dryRun"; input: DryRunJob }
  | { job: "rehearse"; input: RehearseJob };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (b: Record<string, unknown>, keys: string[]) => Object.keys(b).every(k => keys.includes(k));

/** The body, strictly; a sentence saying what to send when it is anything else. */
export function readJob(body: unknown): Job | string {
  if (!isObj(body)) return SEND;
  const b = body;
  if (b.job === "run" || b.job === "doctor") return only(b, ["job"]) ? { job: b.job } : `Unknown field for ${b.job}. ${SEND}`;
  if (b.job === "dryRun") {
    if (b.responseId !== undefined) {
      if (!only(b, ["job", "responseId"])) return `A dry run takes a responseId alone, or kind, taskId and facts. ${SEND}`;
      if (typeof b.responseId !== "string" || !RESPONSE_ID.test(b.responseId)) return `responseId must be a Typeform response ID. ${SEND}`;
      return { job: "dryRun", input: { responseId: b.responseId } };
    }
    if (!only(b, ["job", "kind", "taskId", "facts", "variant"])) return `A dry run takes a responseId alone, or kind, taskId and facts. ${SEND}`;
    if (!isNoticeKind(b.kind)) return `kind must be one of the six notices. ${SEND}`;
    const kind: NoticeKind = b.kind;
    if (typeof b.taskId !== "string" || !TASK_ID.test(b.taskId)) return `taskId must be a ClickUp task ID. ${SEND}`;
    if (!isObj(b.facts) || JSON.stringify(b.facts).length > 16384) return `facts must be an object under 16 KB. ${SEND}`;
    if (b.variant !== undefined && !(typeof b.variant === "string" && (VARIANTS[kind] as readonly string[]).includes(b.variant))) {
      return `variant must be one of ${VARIANTS[kind].join(", ")} for ${kind}. ${SEND}`;
    }
    return { job: "dryRun", input: { kind, taskId: b.taskId, facts: b.facts, ...(b.variant !== undefined ? { variant: b.variant as Variant } : {}) } };
  }
  if (b.job === "rehearse") {
    if (!only(b, ["job", "kind", "to"])) return `A rehearsal takes kind and to only. ${SEND}`;
    if (b.kind !== undefined && !isNoticeKind(b.kind)) return `kind must be one of the six notices. ${SEND}`;
    if (b.to !== undefined && !(typeof b.to === "string" && PERSON.test(b.to))) return `to must be a person's Slack id (U or W). ${SEND}`;
    return { job: "rehearse", input: { kind: (b.kind as NoticeKind | undefined) ?? "kickoff", to: (b.to as string | undefined) ?? null } };
  }
  return SEND;
}

export function makeNoticesDoor(deps: DoorDeps) {
  const run = deps.run ?? runNotices;
  const doctor = deps.doctor ?? runDoctor;
  const dryRun = deps.dryRun ?? runDryRun;
  const rehearse = deps.rehearse ?? runRehearse;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
    const expected = deps.cronSecret().trim();
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!expected || !given || !sameSecret(given, expected)) return json({ ok: false, note: "not allowed" }, 401);
    let parsed: unknown = null;
    try {
      const raw = await req.text();
      parsed = raw.length > MAX_BODY ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const job = readJob(parsed);
    if (typeof job === "string") return json({ ok: false, note: job }, 400);
    try {
      if (job.job === "run") {
        deps.waitUntil(run(deps).catch(() => undefined));
        return json({ ok: true, started: "run" }, 202);
      }
      if (job.job === "doctor") return json(await doctor(deps));
      if (job.job === "dryRun") return json(await dryRun(deps, job.input));
      return json(await rehearse(deps, job.input));
    } catch (e) {
      const note = e instanceof Error && e.message ? e.message.slice(0, 240) : "The job could not finish.";
      // A refusal in words (the database's or the job's own) is the caller's to fix; anything else is ours.
      const theirs = e instanceof JobError || (e instanceof Error && typeof (e as { code?: unknown }).code === "string");
      return json({ ok: false, note }, theirs ? 400 : 500);
    }
  };
}
