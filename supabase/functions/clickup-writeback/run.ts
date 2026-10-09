// The three ClickUp writeback jobs, with every dependency injected so the
// tests can run them end to end without a network.
//
// OUTWARD SAFETY. Nothing is written to ClickUp unless the Edge Function
// secret CLICKUP_WRITEBACK_APPLY is exactly "true". Otherwise each job reads
// what it needs and records, in cockpit_clickup_writeback_runs (and on each
// queue item), exactly what it would write: task id, field, old value, new
// value. CLICKUP_WRITEBACK_ONLY_TASKS (comma-separated task ids) narrows a
// live run to those cards, for the first one-card verification.

import { type KpiInputs, planKpi } from "./kpi.ts";
import { ADS_LIST, CLIENTS_LIST, FIELD, type Row } from "./rules.ts";
import {
  boardFieldsLoader,
  buildSteps,
  classify,
  executeItem,
  listFieldsLoader,
  type Planned,
  planItem,
  type Provider,
  type QueueItem,
  RETRY_MINUTES,
  type Step,
} from "./queue.ts";
import { DOS_DONTS_LIST, dosDontsCandidates, type DosDontsResult, planDosDonts, tidyCard } from "./dosdonts.ts";

export type Deps = {
  env: (name: string) => string | undefined;
  rpc: (name: string, params?: Row) => Promise<any>;
  /** A provider whose every call lands in cockpit_media_provider_health under this action id. */
  providerFor: (actionId: string) => Provider;
  now: () => number;
  uuid: () => string;
  /** Wait between ClickUp calls so a run stays under ClickUp's per-minute limit. */
  pace?: () => Promise<void>;
};

export type JobResult = { ok: boolean; job: string; mode?: string; note: string; counts?: Row };

export function gate(env: Deps["env"]) {
  const apply = env("CLICKUP_WRITEBACK_APPLY") === "true";
  const only = new Set(
    String(env("CLICKUP_WRITEBACK_ONLY_TASKS") ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  );
  return {
    apply,
    only,
    mode: !apply ? "dry_run" : only.size ? "apply_limited" : "apply",
    live: (taskId: string | null | undefined) => apply && (only.size === 0 || (taskId ? only.has(taskId) : false)),
  };
}

export const redact = (s: string) =>
  s
    .replace(/\bpk_[A-Za-z0-9_]+/g, "[key]")
    .replace(/\bEAA[A-Za-z0-9]+/g, "[key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [key]")
    .slice(0, 300);

const NO_TOKEN = "CLICKUP_API_TOKEN is not set on this Edge Function. Add it under Edge Functions, Secrets, in the Supabase dashboard. Nothing was read or written.";

/** Rolling-window limiter: at most `perMinute` calls in any 60 seconds. */
export function pacer(perMinute: number, now: () => number = Date.now, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const calls: number[] = [];
  return async () => {
    while (true) {
      const t = now();
      while (calls.length && t - calls[0] >= 60_000) calls.shift();
      if (calls.length < perMinute) {
        calls.push(t);
        return;
      }
      await sleep(60_000 - (t - calls[0]) + 5);
    }
  };
}

function paced(provider: Provider, pace?: () => Promise<void>): Provider {
  if (!pace) return provider;
  return { call: async (p, m, path, body) => { if (p === "clickup") await pace(); return provider.call(p, m, path, body); } };
}

/** Every task on a list, closed ones included, 100 a page (ClickUp's page size). */
export async function listTasks(provider: Provider, listId: string, maxPages = 20): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 0; page < maxPages; page++) {
    const r = await provider.call("clickup", "GET", `list/${listId}/task?include_closed=true&subtasks=false&page=${page}`);
    if (!Array.isArray(r.tasks)) throw new Error(`ClickUp did not return the tasks of list ${listId}`);
    out.push(...r.tasks);
    if (r.tasks.length < 100 || r.last_page === true) return out;
  }
  throw new Error(`List ${listId} has more than ${maxPages * 100} tasks; the read stopped instead of guessing.`);
}

async function finish(deps: Deps, run: string, job: string, mode: string, ok: boolean, note: string, counts: Row, planned: unknown[]): Promise<JobResult> {
  await deps.rpc("cockpit_clickup_writeback_finish", { p_run: run, p_ok: ok, p_note: note, p_counts: counts, p_planned: planned });
  return { ok, job, mode, note, counts };
}

async function idle(deps: Deps, job: string, ok: boolean, note: string): Promise<JobResult> {
  await deps.rpc("cockpit_clickup_writeback_idle", { p_job: job, p_ok: ok, p_note: note });
  return { ok, job, note };
}

// --- kpi ---------------------------------------------------------------------

export async function runKpi(deps: Deps): Promise<JobResult> {
  const g = gate(deps.env);
  if (!deps.env("CLICKUP_API_TOKEN")) return idle(deps, "kpi", false, NO_TOKEN);
  const run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "kpi", p_mode: g.mode, p_exclusive: true });
  if (!run?.id) return { ok: true, job: "kpi", note: String(run?.note ?? "Another run is in progress.") };
  const planned: Row[] = [];
  try {
    const inputs = (await deps.rpc("cockpit_clickup_writeback_inputs", { p_with_stats: true })) as KpiInputs;
    const provider = paced(deps.providerFor(run.id), deps.pace);
    const tasks = await listTasks(provider, ADS_LIST);
    const fields = (await provider.call("clickup", "GET", `list/${ADS_LIST}/field`)).fields;
    if (!Array.isArray(fields)) throw new Error("ClickUp did not return the board fields");
    const plan = planKpi(inputs, tasks, fields, deps.now());
    if (plan.refused) return finish(deps, run.id, "kpi", g.mode, false, plan.refused, { cards: 0 }, []);
    let updated = 0, failed = 0, skipped = 0, writes = 0, stopped = "";
    for (const card of plan.cards) {
      if (card.skipped) {
        skipped += 1;
        planned.push({ taskId: card.taskId, taskName: card.taskName, campaigns: card.campaigns, field: null, status: "skipped", note: card.skipped });
        continue;
      }
      const live = g.live(card.taskId);
      let cardFailed = false;
      for (const w of card.writes) {
        const entry: Row = { taskId: w.taskId, taskName: w.taskName, campaigns: card.campaigns, field: w.field, fieldId: w.fieldId, old: w.old, new: w.new, notes: card.notes };
        if (!w.changed && w.fieldId !== FIELD.lastUpdated) { planned.push({ ...entry, status: "unchanged" }); continue; }
        if (!live) { planned.push({ ...entry, status: "planned" }); writes += 1; continue; }
        try {
          // Not queued on failure: the next hour writes fresher numbers (convex/writeback.ts pushMetrics).
          await provider.call("clickup", "POST", `task/${w.taskId}/field/${w.fieldId}`, { value: w.value });
          planned.push({ ...entry, status: "written" });
          writes += 1;
        } catch (e) {
          cardFailed = true;
          planned.push({ ...entry, status: "failed", error: redact(String(e instanceof Error ? e.message : e)) });
          if (classify(e) === "retry" || classify(e) === "config") stopped = redact(String(e instanceof Error ? e.message : e));
          break;
        }
      }
      if (live && cardFailed) failed += 1;
      else if (live) updated += 1;
      if (stopped) break;
    }
    const counts = { cards: plan.cards.length, updated, failed, skipped, writes, since7: plan.since7 };
    if (!g.apply)
      return finish(deps, run.id, "kpi", g.mode, true, `Dry run: ${writes} writes planned on ${plan.cards.length - skipped} cards, ${skipped} cards skipped. Nothing was written to ClickUp.`, counts, planned);
    // A run where no card took the numbers fails, so the ledger says so (convex/writeback.ts).
    const ok = !(updated === 0 && failed > 0) && !stopped;
    const note = `${updated} cards updated, ${failed} failed, ${skipped} skipped${g.only.size ? ` (limited to ${g.only.size} cards)` : ""}.${stopped ? ` Stopped early: ${stopped}` : ""}`;
    return finish(deps, run.id, "kpi", g.mode, ok, note, counts, planned);
  } catch (e) {
    return finish(deps, run.id, "kpi", g.mode, false, redact(String(e instanceof Error ? e.message : e)), {}, planned);
  }
}

// --- log ---------------------------------------------------------------------

const stepTasks = (steps: Step[]) => steps.flatMap(s => ("taskId" in s && s.taskId !== "$ticket" ? [s.taskId] : []));

export async function runLog(deps: Deps, limit = 15): Promise<JobResult> {
  const g = gate(deps.env);
  if (!deps.env("CLICKUP_API_TOKEN")) return idle(deps, "log", false, NO_TOKEN);
  const enqueued = Number(await deps.rpc("cockpit_clickup_writeback_sweep", {})) || 0;
  const token = deps.uuid();
  const items = ((await deps.rpc("cockpit_clickup_writeback_claim", { p_token: token, p_limit: limit })) ?? []) as QueueItem[];
  if (!items.length) return idle(deps, "log", true, `The ClickUp log queue is empty${enqueued ? ` after enqueuing ${enqueued}` : ""}.`);
  const run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "log", p_mode: g.mode, p_exclusive: false });
  const counts = { claimed: items.length, delivered: 0, dryRun: 0, skipped: 0, retry: 0, unknown: 0, failed: 0 };
  const planned: Planned[] = [];
  const save = (id: string, patch: Row) => deps.rpc("cockpit_clickup_writeback_save", { p_id: id, p_token: token, p_patch: patch });
  let stop = "";
  try {
    const inputs = await deps.rpc("cockpit_clickup_writeback_inputs", { p_with_stats: false });
    const campaigns = ((inputs?.campaigns ?? []) as Row[]).filter(c => !c.internal) as any[];
    const runProvider = paced(deps.providerFor(run.id), deps.pace);
    const boardFields = boardFieldsLoader(runProvider);
    // Billing edits write on Clients - Mahara cards; its dropdown options are read once per run.
    const clientFields = listFieldsLoader(runProvider, CLIENTS_LIST);
    for (const item of items) {
      if (stop) {
        await save(item.id, { state: "retry", next_attempt_at: new Date(deps.now()).toISOString(), error: stop });
        continue;
      }
      try {
        const provider = paced(deps.providerFor(item.id), deps.pace);
        const built = item.steps?.length ? { steps: item.steps } : buildSteps(item, campaigns, deps.now());
        if ("skip" in built) {
          counts.skipped += 1;
          await save(item.id, { state: "skipped", error: built.skip });
          continue;
        }
        const tasks = stepTasks(built.steps);
        const createsTask = built.steps.some(s => s.type === "create_task");
        const live = g.apply && tasks.every(t => g.live(t)) && (!createsTask || g.only.size === 0 || tasks.length > 0);
        if (!live) {
          const plan = await planItem(item, built.steps, provider, boardFields, clientFields);
          planned.push(...plan);
          counts.dryRun += 1;
          await save(item.id, { state: "dry_run", planned: plan, task_id: tasks[0] ?? null });
          continue;
        }
        // Freeze the text before the first write, so a retry posts exactly the same comment.
        if (!item.steps?.length) await save(item.id, { steps: built.steps, task_id: tasks[0] ?? null });
        const outcome = await executeItem(item, built.steps, provider, progress => save(item.id, { progress }), boardFields, clientFields);
        const now = deps.now();
        if (outcome.state === "delivered") {
          counts.delivered += 1;
          await save(item.id, { state: "delivered", progress: outcome.progress, delivered_at: new Date(now).toISOString(), error: null });
        } else if (outcome.state === "skipped") {
          counts.skipped += 1;
          await save(item.id, { state: "skipped", progress: outcome.progress, error: outcome.error ?? null });
        } else if (outcome.state === "failed" || item.attempts > RETRY_MINUTES.length) {
          counts.failed += 1;
          await save(item.id, { state: "failed", progress: outcome.progress, error: outcome.error ?? "Gave up after the retry ladder." });
        } else {
          counts[outcome.state] += 1;
          const wait = RETRY_MINUTES[Math.min(Math.max(item.attempts - 1, 0), RETRY_MINUTES.length - 1)];
          await save(item.id, { state: outcome.state, progress: outcome.progress, error: outcome.error ?? null, next_attempt_at: new Date(now + wait * 60_000).toISOString() });
          if (outcome.stop) stop = outcome.error ?? "A provider secret is missing.";
        }
      } catch (e) {
        // Our own bookkeeping failed. The item may have reached ClickUp, so it is read back next time.
        counts.unknown += 1;
        await save(item.id, { state: "unknown", error: redact(String(e instanceof Error ? e.message : e)), next_attempt_at: new Date(deps.now() + 60_000).toISOString() }).catch(() => {});
      }
    }
    const note = g.apply
      ? `${counts.delivered} delivered, ${counts.retry + counts.unknown} to retry, ${counts.failed} failed, ${counts.skipped} stay in the cockpit${counts.dryRun ? `, ${counts.dryRun} held as dry runs outside the allowed cards` : ""}.${stop ? ` Stopped: ${redact(stop)}` : ""}`
      : `Dry run: ${counts.dryRun} log entries planned, ${counts.skipped} stay in the cockpit. Nothing was written to ClickUp.`;
    return finish(deps, run.id, "log", g.mode, counts.failed === 0 && !stop, note, counts, planned);
  } catch (e) {
    return finish(deps, run.id, "log", g.mode, false, redact(String(e instanceof Error ? e.message : e)), counts, planned);
  }
}

// --- dosdonts ----------------------------------------------------------------

export async function runDosDonts(deps: Deps): Promise<JobResult> {
  const g = gate(deps.env);
  if (!deps.env("CLICKUP_API_TOKEN")) return idle(deps, "dosdonts", false, NO_TOKEN);
  const run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "dosdonts", p_mode: g.mode, p_exclusive: true });
  if (!run?.id) return { ok: true, job: "dosdonts", note: String(run?.note ?? "Another run is in progress.") };
  const planned: DosDontsResult[] = [];
  let failed = 0;
  try {
    const provider = paced(deps.providerFor(run.id), deps.pace);
    // convex/dosDonts.ts tidyAll read at most ten pages of Clients - Mahara.
    const candidates = dosDontsCandidates(await listTasks(provider, DOS_DONTS_LIST, 10));
    for (const c of candidates) {
      try {
        planned.push(...(g.live(c.taskId) ? await tidyCard(c.taskId, c.taskName, provider) : await planDosDonts(c, provider)));
      } catch (e) {
        failed += 1;
        planned.push({ taskId: c.taskId, taskName: c.taskName, field: "Do's & Don'ts", old: c.before, new: c.text || null, status: "failed", note: redact(String(e instanceof Error ? e.message : e)) });
        if (["retry", "config"].includes(classify(e))) break;
      }
    }
    const written = planned.filter(p => p.status === "written").length;
    const counts = { cards: candidates.length, written, failed };
    const note = g.apply
      ? `${candidates.length} cards needed the clean format: ${written} writes, ${failed} failed.`
      : `Dry run: ${candidates.length} cards need the clean format. Nothing was written to ClickUp.`;
    return finish(deps, run.id, "dosdonts", g.mode, failed === 0, note, counts, planned);
  } catch (e) {
    return finish(deps, run.id, "dosdonts", g.mode, false, redact(String(e instanceof Error ? e.message : e)), { failed }, planned);
  }
}

// --- doctor ------------------------------------------------------------------

/** Configuration and queue health, with no provider call and no write. */
export async function runDoctor(deps: Deps): Promise<JobResult & { secrets: Row; queue: unknown }> {
  const g = gate(deps.env);
  const secrets = Object.fromEntries(
    ["CLICKUP_API_TOKEN", "META_SYSTEM_TOKEN", "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map(k => [k, Boolean(deps.env(k))]),
  );
  const queue = await deps.rpc("cockpit_clickup_writeback_doctor", {});
  const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  return {
    ok: missing.length === 0,
    job: "doctor",
    mode: g.mode,
    note: missing.length ? `Missing secrets: ${missing.join(", ")}.` : `Ready. Mode: ${g.mode}.`,
    secrets,
    queue,
  };
}
