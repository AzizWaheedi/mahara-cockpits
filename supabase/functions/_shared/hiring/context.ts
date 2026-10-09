/**
 * What every hiring job and action runs with, and the one way a job runs:
 * configuration checked first, the run lock taken, the result written to
 * cockpit_hiring_runs and the freshness row to cockpit_sync_state.
 */

import { runEngine } from "./engine.ts";
import { runIntake } from "./intake.ts";
import { runMirror } from "./mirror.ts";
import {
  APPLY_NAME,
  applyEnabled,
  GateError,
  type Ghl,
  ghlClient,
  LOCATION_NAME,
  PIT_NAME,
  redact,
  SEND_NAME,
  sendEnabled,
  type Typeform,
  typeformClient,
  TYPEFORM_NAME,
} from "./providers.ts";
import type { Job, Row, Store, Trigger } from "./store.ts";

export type Env = (name: string) => string | undefined;

export type Ctx = {
  store: Store;
  env: Env;
  now: () => Date;
  ghl: Ghl | null;
  typeform: Typeform | null;
  /** HIRING_APPLY === "true": GoHighLevel contact, card and note writes. */
  apply: boolean;
  /** HIRING_SEND_ENABLED === "true": a CEO-pressed send may leave. */
  sendEnabled: boolean;
  /** The CEO's email for a browser action; null for the schedule. */
  actor: string | null;
  /** Set while a job holds its run lock, so receipts point at the run. */
  runId: string | null;
};

export function makeCtx(o: {
  env: Env;
  store: Store;
  actor: string | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}): Ctx {
  const ctx: Ctx = {
    store: o.store,
    env: o.env,
    now: o.now ?? (() => new Date()),
    ghl: null,
    typeform: null,
    apply: applyEnabled(o.env),
    sendEnabled: sendEnabled(o.env),
    actor: o.actor,
    runId: null,
  };
  const health = (row: Parameters<Store["health"]>[0]) => o.store.health(row);
  const pit = (o.env(PIT_NAME) ?? "").trim();
  const location = (o.env(LOCATION_NAME) ?? "").trim();
  if (pit && location)
    ctx.ghl = ghlClient({
      token: pit,
      location,
      apply: ctx.apply,
      sendEnabled: ctx.sendEnabled,
      fetch: o.fetch,
      sleep: o.sleep,
      health: row => health({ ...row, run_id: ctx.runId, actor_email: ctx.actor }),
    });
  const tf = (o.env(TYPEFORM_NAME) ?? "").trim();
  if (tf)
    ctx.typeform = typeformClient({
      token: tf,
      fetch: o.fetch,
      health: row => health({ ...row, run_id: ctx.runId, actor_email: ctx.actor }),
    });
  return ctx;
}

export const JOB_LABEL: Record<Job, string> = {
  mirror: "board pull",
  intake: "careers form import",
  engine: "message drafting",
};

const JOBS: Record<Job, (ctx: Ctx) => Promise<Row>> = {
  mirror: runMirror,
  intake: ctx => runIntake(ctx),
  engine: runEngine,
};

/** The sentence for a job that cannot start, or null when it can. */
export function missingFor(ctx: Ctx, job: Job): string | null {
  if (!ctx.ghl)
    return `The hiring sub-account is not connected: set ${PIT_NAME} and ${LOCATION_NAME} as Edge Function secrets.`;
  if (job === "intake" && !ctx.typeform)
    return `${TYPEFORM_NAME} is not set as an Edge Function secret, so the careers forms cannot be read.`;
  return null;
}

/** A short line for cockpit_sync_state.note. */
export function summary(job: Job, r: Row): string {
  if (job === "mirror")
    return `${r.added} new, ${r.moved} moved, ${r.kept} human values kept${r.contactsComplete ? "" : ", contacts read only in part"}${r.missingPipelines?.length ? `, no pipeline for ${r.missingPipelines.join(", ")}` : ""}`;
  if (job === "intake")
    return r.dryRun
      ? `Dry run: ${r.read} unseen applications, nothing written (${APPLY_NAME} is not true)`
      : `${r.read} read, ${r.added} added, ${r.skipped} skipped`;
  return `${r.drafted} drafted, ${r.failed} held back, ${r.considered} considered${r.lines?.length && !r.considered ? `. ${r.lines[0]}` : ""}`;
}

/** How many rows a run touched, for the freshness row. Null when unknown. */
const rowsSeen = (job: Job, r: Row): number | null => {
  if (job === "mirror") {
    const counts = (r.roles ?? []).map((x: Row) => x.candidates);
    return counts.some((n: unknown) => n === null) ? null : counts.reduce((t: number, n: number) => t + n, 0);
  }
  if (job === "intake") return Number.isFinite(r.read) ? r.read : null;
  return Number.isFinite(r.considered) ? r.considered : null;
};

export type JobOutcome = Row & { ok: boolean; job: Job; note: string };

export async function runJob(ctx: Ctx, job: Job, trigger: Trigger): Promise<JobOutcome> {
  const key = `hiring-sync:${job}`;
  const at = ctx.now().toISOString();
  const missing = missingFor(ctx, job);
  if (missing) {
    await ctx.store.syncState(key, { last_run_at: at, ok: false, note: missing, rows_seen: null });
    return { ok: false, job, note: missing };
  }
  const runId = await ctx.store.claimRun(job, trigger, ctx.actor, ctx.apply);
  if (!runId)
    return {
      ok: false,
      job,
      busy: true,
      note: `The ${JOB_LABEL[job]} is already running. Try again in a minute.`,
    };
  ctx.runId = runId;
  try {
    const result = await JOBS[job](ctx);
    const ok = result.ok !== false;
    const note = (ok ? summary(job, result) : redact(result.error ?? summary(job, result))).slice(0, 500);
    await ctx.store.finishRun(runId, ok ? "ok" : "failed", result, ok ? null : note);
    await ctx.store.syncState(key, {
      last_run_at: at,
      ok,
      note,
      rows_seen: rowsSeen(job, result),
      ...(ok ? { last_ok_at: ctx.now().toISOString() } : {}),
    });
    return { ...result, ok, job, runId, note };
  } catch (e) {
    const note = redact(e instanceof Error ? e.message : String(e)).slice(0, 500);
    await ctx.store.finishRun(runId, "failed", null, note).catch(() => undefined);
    await ctx.store
      .syncState(key, { last_run_at: at, ok: false, note, rows_seen: null })
      .catch(() => undefined);
    return { ok: false, job, runId, note, gate: e instanceof GateError };
  } finally {
    ctx.runId = null;
  }
}

/**
 * Which keys are set and which gates are open. Reads the environment only:
 * no provider call and no write, so it is safe to run at any time.
 */
export function doctor(env: Env): Row {
  const set = (n: string) => Boolean((env(n) ?? "").trim());
  const keys = Object.fromEntries(
    [PIT_NAME, LOCATION_NAME, TYPEFORM_NAME, "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map(
      n => [n, set(n)],
    ),
  );
  const notes: string[] = [];
  if (!keys[PIT_NAME] || !keys[LOCATION_NAME])
    notes.push(`Set ${PIT_NAME} and ${LOCATION_NAME}; until then every hiring job stops with that sentence.`);
  if (!keys[TYPEFORM_NAME]) notes.push(`Set ${TYPEFORM_NAME}; until then the careers forms are not read.`);
  notes.push(
    applyEnabled(env)
      ? `${APPLY_NAME} is "true": the form import and the CEO's grades write to GoHighLevel.`
      : `${APPLY_NAME} is not "true": every GoHighLevel write is a dry run.`,
  );
  notes.push(
    sendEnabled(env)
      ? `${SEND_NAME} is "true": a draft leaves when the CEO presses Send. The schedule never sends.`
      : `${SEND_NAME} is not "true": no candidate message can leave.`,
  );
  return { ok: Boolean(keys[PIT_NAME] && keys[LOCATION_NAME] && keys[TYPEFORM_NAME]), keys, apply: applyEnabled(env), sendEnabled: sendEnabled(env), notes };
}
