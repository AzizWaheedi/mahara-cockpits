// The ClickUp writeback jobs (kpi, log, dosdonts, requests, forms and the
// three doctors), with every dependency injected so the tests can run them end
// to end without a network.
//
// OUTWARD SAFETY. Five Edge Function secrets open writes to ClickUp, each
// only when it is exactly "true":
//   CLICKUP_WRITEBACK_APPLY              the log and Do's & Don'ts
//   CLICKUP_WRITEBACK_APPLY_CSM_TICKETS  client success tickets in the log, on
//                                        their own while the rest of the log
//                                        stays a dry run (live since 2026-10-12)
//   CLICKUP_WRITEBACK_APPLY_KPI          the board KPI columns, read by runKpi
//                                        only; CLICKUP_WRITEBACK_APPLY does not
//                                        write them (cost per booking build 2,
//                                        R12, 22 Oct 2026)
//   CLICKUP_WRITEBACK_APPLY_REQUESTS     the requests job's two kinds, request and
//                                        task_action, and nothing else; no other
//                                        switch opens them (requests.ts requestsGate).
//                                        CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS narrows
//                                        it to listed client cards (a canary)
//   CLICKUP_WRITEBACK_APPLY_FORMS        the 1-1 notes writes (kind form: the to-do
//                                        comment, Client Happiness, Last POC and Last
//                                        Check-in Call), and nothing else (forms.ts
//                                        formsGate). CLICKUP_WRITEBACK_FORMS_ONLY_CARDS
//                                        narrows it to listed client cards (a canary)
// With its switch off a job reads what it needs and records, in
// cockpit_clickup_writeback_runs (and on each queue item), exactly what it
// would write: task id, field, old value, new value.
// CLICKUP_WRITEBACK_ONLY_TASKS (comma-separated task ids) narrows a live run of
// the APPLY and APPLY_KPI switches to those cards, for a one-card check; it
// does not narrow client success tickets.
//
// The KPI run reports ok=false while its switch is off (a dry run), on a run
// limited to ONLY_TASKS, when no card had Last Updated written, and when a
// write failed, so the health line never says ok while the board's numbers are
// frozen. Skipped and held cards are named in the note; each keeps its old
// Last Updated on the card.

import { type KpiInputs, type KpiPlan, kuwaitDate, planKpi, shortDay } from "./kpi.ts";
import { ADS_LIST, CLIENTS_LIST, FIELD, FIELD_NAME, type Row } from "./rules.ts";
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
import {
  doctorChecks,
  executeRequest,
  planRequest,
  REQUEST_SECRETS,
  type RequestOutcome,
  type RequestsItem,
  requestsDb,
  requestsGate,
  requestStepKeys,
  runContext,
  SAY,
} from "./requests.ts";
import { executeTaskAction, planTaskAction, taskActionStepKeys } from "./taskActions.ts";
import {
  cardRefused,
  checkToken,
  executeForm,
  type FormItem,
  formStep,
  formsDb,
  formsDoctorChecks,
  formsGate,
  formsWords,
  frozenStep,
  planForm,
  SAY_FORMS,
} from "./forms.ts";

export type Deps = {
  env: (name: string) => string | undefined;
  rpc: (name: string, params?: Row) => Promise<any>;
  /** A provider whose every call lands in cockpit_media_provider_health under this action id. */
  providerFor: (actionId: string) => Provider;
  now: () => number;
  uuid: () => string;
  /** Wait between ClickUp calls so a run stays under ClickUp's per-minute limit. */
  pace?: () => Promise<void>;
  /** Upsert one cockpit_sync_state row by key (the requests doctor's health line). */
  syncState?: (key: string, row: Row) => Promise<void>;
};

/** The jobs index.ts runs, in the order the unknown-job sentence names them. */
export const JOBS = ["kpi", "log", "dosdonts", "doctor", "requests", "requests_doctor", "forms", "forms_doctor"] as const;
const jobList = `${JOBS.slice(0, -1).join(", ")} or ${JOBS.at(-1)}`;
export const unknownJobNote = (job: string) => `Unknown job "${job.slice(0, 40)}". Use ${jobList}.`;
export const noJobNote = `Send a JSON body with a job: ${jobList}.`;

export type JobResult = { ok: boolean; job: string; mode?: string; note: string; counts?: Row };

export function gate(env: Deps["env"]) {
  const apply = env("CLICKUP_WRITEBACK_APPLY") === "true";
  const only = new Set(
    String(env("CLICKUP_WRITEBACK_ONLY_TASKS") ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  );
  // Client success tickets can go live on their own, while the rest of the log
  // stays a dry run (2026-10-12).
  const csmTickets = env("CLICKUP_WRITEBACK_APPLY_CSM_TICKETS") === "true";
  return {
    apply,
    only,
    csmTickets,
    mode: !apply ? "dry_run" : only.size ? "apply_limited" : "apply",
    live: (taskId: string | null | undefined) => apply && (only.size === 0 || (taskId ? only.has(taskId) : false)),
  };
}

/** The KPI columns' own gate: CLICKUP_WRITEBACK_APPLY_KPI exactly "true", narrowed by ONLY_TASKS. */
export function kpiGate(env: Deps["env"]) {
  const { only } = gate(env);
  const apply = env("CLICKUP_WRITEBACK_APPLY_KPI") === "true";
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

/** The requests jobs' pace when CLICKUP_REQUESTS_CALLS_PER_MINUTE is not set (or is not a positive number). */
export const REQUESTS_CALLS_PER_MINUTE = 25;
/** Every other job's pace when CLICKUP_CALLS_PER_MINUTE is not set (or is not a positive number). */
export const CALLS_PER_MINUTE = 30;
/** No setting takes a job above this, nor below the floor. */
export const CALLS_MAX = 60;
export const CALLS_MIN = 5;

/**
 * ClickUp calls a minute for one job. ClickUp Business allows 100 a minute for the one token the Supabase
 * functions and the VPS workers share, and no job takes more than 60 (docs/requests/CLICKUP-DOWNGRADE.md).
 * requests and requests_doctor read CLICKUP_REQUESTS_CALLS_PER_MINUTE (25 by default); kpi, log, dosdonts and
 * doctor read CLICKUP_CALLS_PER_MINUTE (30 by default). A missing, non-numeric or non-positive value gives the
 * default; the result is always 5 to 60.
 */
export function writebackPerMinute(job: string, env: Deps["env"]): number {
  const requestsJob = job === "requests" || job === "requests_doctor";
  const set = Number(env(requestsJob ? "CLICKUP_REQUESTS_CALLS_PER_MINUTE" : "CLICKUP_CALLS_PER_MINUTE"));
  const pace = Number.isFinite(set) && set > 0 ? set : requestsJob ? REQUESTS_CALLS_PER_MINUTE : CALLS_PER_MINUTE;
  return Math.floor(Math.min(CALLS_MAX, Math.max(CALLS_MIN, pace)));
}

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

const cardsWord = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/** "A, B, C, D, E and 2 more": the names of the cards a sentence is about. */
export function cardList(names: string[], max = 5): string {
  const clean = names.map(n => n.trim());
  const shown = clean.slice(0, max);
  const more = clean.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
}

/** "The board still shows numbers last updated 7 Oct 2026. 9 cards show no numbers yet." */
export function boardAge(plan: Pick<KpiPlan, "oldestLastUpdated" | "noNumbers" | "undated">): string {
  const undated = plan.undated ? ` ${cardsWord(plan.undated)} ${plan.undated === 1 ? "shows" : "show"} numbers with no Last Updated date.` : "";
  const none = plan.noNumbers ? ` ${cardsWord(plan.noNumbers)} ${plan.noNumbers === 1 ? "shows" : "show"} no numbers yet.` : "";
  return plan.oldestLastUpdated === null
    ? `No card on the board shows numbers with a Last Updated date.${undated}${none}`
    : `The board still shows numbers last updated ${kuwaitDate(plan.oldestLastUpdated)}.${undated}${none}`;
}

export async function runKpi(deps: Deps): Promise<JobResult> {
  const g = kpiGate(deps.env);
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
    // A dry run counts what it would do; a live run counts only what reached ClickUp. In a run limited to
    // CLICKUP_WRITEBACK_ONLY_TASKS the other cards stay a dry run and are counted apart, never as updated.
    let updated = 0, failed = 0, skipped = 0, writes = 0, stamped = 0, outside = 0, outsideWrites = 0, reached = 0, stopped = "";
    const cardsWithWrites = new Set<string>();
    const skippedNames: string[] = [], failedNames: string[] = [];
    for (const card of plan.cards) {
      reached += 1;
      if (card.skipped) {
        skipped += 1;
        skippedNames.push(card.taskName);
        planned.push({ taskId: card.taskId, taskName: card.taskName, campaigns: card.campaigns, field: null, status: "skipped", note: card.skipped });
        continue;
      }
      const live = g.live(card.taskId);
      if (g.apply && !live) outside += 1;
      let cardFailed = false;
      let lastUpdated: "written" | "planned" | null = null;
      for (const w of card.writes) {
        const entry: Row = { taskId: w.taskId, taskName: w.taskName, campaigns: card.campaigns, field: w.field, fieldId: w.fieldId, old: w.old, new: w.new, notes: card.notes };
        if (!w.changed && w.fieldId !== FIELD.lastUpdated) { planned.push({ ...entry, status: "unchanged" }); continue; }
        if (!live) {
          planned.push({ ...entry, status: "planned" });
          if (g.apply) outsideWrites += 1;
          else { writes += 1; cardsWithWrites.add(card.taskId); }
          if (w.fieldId === FIELD.lastUpdated) lastUpdated = "planned";
          continue;
        }
        try {
          // Not queued on failure: the next hour writes fresher numbers (convex/writeback.ts pushMetrics).
          // Last Updated is the card's last write, so a failure before it leaves the old date standing.
          await provider.call("clickup", "POST", `task/${w.taskId}/field/${w.fieldId}`, { value: w.value });
          planned.push({ ...entry, status: "written" });
          writes += 1;
          cardsWithWrites.add(card.taskId);
          if (w.fieldId === FIELD.lastUpdated) lastUpdated = "written";
        } catch (e) {
          cardFailed = true;
          planned.push({ ...entry, status: "failed", error: redact(String(e instanceof Error ? e.message : e)) });
          if (classify(e) === "retry" || classify(e) === "config") stopped = redact(String(e instanceof Error ? e.message : e));
          break;
        }
      }
      // A stamp is Last Updated written on a live run, or planned on a dry run. A card left as a dry run
      // inside a live run, or whose write failed before Last Updated, is never counted as one.
      if (lastUpdated === (g.apply ? "written" : "planned")) stamped += 1;
      if (card.held)
        planned.push({
          taskId: card.taskId, taskName: card.taskName, campaigns: card.campaigns, field: FIELD_NAME[FIELD.lastUpdated], fieldId: FIELD.lastUpdated,
          old: card.lastUpdated === undefined ? null : new Date(card.lastUpdated).toISOString(), new: null, status: "held", note: card.held, notes: card.notes,
        });
      if (live && cardFailed) { failed += 1; failedNames.push(card.taskName); }
      // Updated means the card's numbers were refreshed: its Last Updated was written.
      else if (live && lastUpdated === "written") updated += 1;
      if (stopped) break;
    }
    const win = plan.window;
    const heldNames = plan.cards.filter(c => c.held).map(c => c.taskName);
    const counts = {
      cards: plan.cards.length, cardsWithWrites: cardsWithWrites.size, updated, failed, skipped, writes, stamped, held: heldNames.length,
      outside, outsideWrites, notReached: plan.cards.length - reached,
      from: win?.from ?? null, through: win?.through ?? null, windowSource: win?.source ?? null,
      oldestLastUpdated: plan.oldestLastUpdated === null ? null : new Date(plan.oldestLastUpdated).toISOString(),
      noNumbers: plan.noNumbers, undated: plan.undated,
    };
    const days = win ? ` The 7 days run ${shortDay(win.from)} to ${shortDay(win.through)}.` : "";
    const skippedNote = skipped
      ? ` ${cardsWord(skipped)} ${skipped === 1 ? "was" : "were"} skipped because the sources disagree or the card is gone: ${cardList(skippedNames)}.`
      : "";
    const held = heldNames.length
      ? ` Last Updated stays as it is on ${cardsWord(heldNames.length)} whose columns could not all be refreshed: ${cardList(heldNames)}.`
      : "";
    if (!g.apply)
      // A dry run is not a refreshed board: the health line reads ok=false until the KPI switch is on.
      return finish(
        deps, run.id, "kpi", g.mode, false,
        `Dry run: ${writes} writes planned on ${cardsWithWrites.size} cards, nothing written to ClickUp. ${boardAge(plan)}${days}${skippedNote}${held}`,
        counts, planned,
      );
    // ok only when the whole board took the numbers: no card left as a dry run, no failed write, at least one
    // Last Updated written, and the run not stopped. Skipped and held cards are named; their own Last Updated
    // stays old on the card, which says so.
    const ok = !stopped && failed === 0 && stamped > 0 && outside === 0;
    const limited = outside
      ? ` ${cardsWord(outside)} left as a dry run (not in CLICKUP_WRITEBACK_ONLY_TASKS), ${outsideWrites} ${outsideWrites === 1 ? "write" : "writes"} planned on ${outside === 1 ? "it" : "them"}.`
      : "";
    const failedNote = failed ? ` Failed: ${cardList(failedNames)}.` : "";
    const notReached = counts.notReached ? ` ${cardsWord(counts.notReached)} not reached.` : "";
    const frozen = stamped === 0 ? ` No card was refreshed. ${boardAge(plan)}` : "";
    const note = `${cardsWord(updated)} updated, ${failed} failed, ${skipped} skipped, Last Updated stamped on ${stamped}.${limited}${frozen}${days}${failedNote}${skippedNote}${held}${notReached}${stopped ? ` Stopped early: ${stopped}` : ""}`;
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
  const mode = !g.apply && g.csmTickets ? "apply_limited" : g.mode;
  const run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "log", p_mode: mode, p_exclusive: false });
  const counts = { claimed: items.length, delivered: 0, dryRun: 0, skipped: 0, retry: 0, unknown: 0, failed: 0 };
  const planned: Planned[] = [];
  const save = (id: string, patch: Row) => deps.rpc("cockpit_clickup_writeback_save", { p_id: id, p_token: token, p_patch: patch });
  let stop = "";
  try {
    const inputs = await deps.rpc("cockpit_clickup_writeback_inputs", { p_with_stats: false });
    const campaigns = ((inputs?.campaigns ?? []) as Row[]).filter(c => !c.internal) as any[];
    const launches = items.some(i => String(i.payload?.operation ?? "").startsWith("launch.")) ? await deps.rpc("cockpit_launch_writeback_campaigns", {}) : [];
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
        const built = item.steps?.length ? { steps: item.steps } : buildSteps(item, campaigns, deps.now(), launches);
        if ("skip" in built) {
          counts.skipped += 1;
          await save(item.id, { state: "skipped", error: built.skip });
          continue;
        }
        const tasks = stepTasks(built.steps);
        const createsTask = built.steps.some(s => s.type === "create_task");
        const csmTicket = item.kind === "decision" && item.payload?.role === "csm";
        const live =
          (csmTicket && g.csmTickets) ||
          (g.apply && tasks.every(t => g.live(t)) && (!createsTask || g.only.size === 0 || tasks.length > 0));
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
      : `Dry run: ${counts.dryRun} log entries planned, ${counts.skipped} stay in the cockpit. ${
          g.csmTickets
            ? `Client success tickets are live: ${counts.delivered} delivered, ${counts.retry + counts.unknown} to retry, ${counts.failed} failed.${stop ? ` Stopped: ${redact(stop)}` : ""}`
            : "Nothing was written to ClickUp."
        }`;
    return finish(deps, run.id, "log", mode, counts.failed === 0 && !stop, note, counts, planned);
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

/** The requests switch in words, for the doctors' notes. */
function requestsWords(env: Deps["env"]) {
  const rq = requestsGate(env);
  const cards = [...rq.onlyCards];
  return {
    mode: rq.mode,
    cards,
    text: !rq.apply
      ? "dry run (they are written only when CLICKUP_WRITEBACK_APPLY_REQUESTS is true)"
      : cards.length
        ? `apply_limited to the cards ${cards.join(", ")} (CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS)`
        : "apply",
  };
}

/** Configuration and queue health, with no provider call and no write. */
export async function runDoctor(deps: Deps): Promise<
  JobResult & { secrets: Row; queue: unknown; kpiMode: string; requestsMode: string; requestsOnlyCards: string[]; formsMode: string; formsOnlyCards: string[] }
> {
  const g = gate(deps.env);
  const kpi = kpiGate(deps.env);
  const rq = requestsWords(deps.env);
  // The 1-1 notes switch, from the environment only (no database read).
  const fw = formsWords(deps.env);
  const secrets = Object.fromEntries(
    ["CLICKUP_API_TOKEN", "META_SYSTEM_TOKEN", "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map(k => [k, Boolean(deps.env(k))]),
  );
  const queue = await deps.rpc("cockpit_clickup_writeback_doctor", {});
  const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  return {
    ok: missing.length === 0,
    job: "doctor",
    mode: g.mode,
    kpiMode: kpi.mode,
    requestsMode: rq.mode,
    requestsOnlyCards: rq.cards,
    formsMode: fw.mode,
    formsOnlyCards: fw.cards,
    note: `${missing.length ? `Missing secrets: ${missing.join(", ")}.` : `Ready. Mode: ${g.mode}.`} KPI columns: ${
      kpi.apply ? kpi.mode : "dry run (they are written only when CLICKUP_WRITEBACK_APPLY_KPI is true)"
    }. Requests and task changes: ${rq.text}. 1-1 notes writes: ${fw.text}.`,
    secrets,
    queue,
  };
}

// --- requests ------------------------------------------------------------------
// Tickets from /requests and presses in the focus views (requests.ts,
// taskActions.ts; docs/requests/CONTRACT.md section 4). Its own switch, its own
// claim, its own run rows and its own health key clickup-writeback:requests.

/** A run stops taking new items after this long, so it ends inside the Edge Function's wall clock. */
export const REQUESTS_RUN_BUDGET_MS = 100_000;
const HELD = "Held for the next run, so this run ends inside its time limit.";
const NOT_STARTED = "The requests run could not start, so this waits for the next run.";
/**
 * One requests run sends at a time, so CLICKUP_REQUESTS_CALLS_PER_MINUTE is the whole job's pace, not one Edge
 * Function call's (docs/requests/CLICKUP-DOWNGRADE.md 1.3). Every submit, every focus-view press and the minute
 * cron each start a run, and runs claim different rows, so without this three runs close together would make
 * three times the pace. A run that finds another one open hands back what it claimed, its tries untouched.
 */
export const BUSY_HELD = "Another requests run is still sending, so this waits for the next run.";
export const anotherRunNote = (n: number) =>
  `Another requests run is still sending, so this one handed back the ${n === 1 ? "row" : `${n} rows`} it claimed; the next run takes ${n === 1 ? "it" : "them"}.`;
/**
 * A run still open after this many minutes on the Kuwait clock stopped without reporting back (a live run stops
 * taking rows at 100 s and ends by about 150 s), so it no longer keeps the next one waiting. The database closes
 * it at 15 minutes (cockpit_clickup_writeback_begin). The requests and forms jobs share this rule, and the forms
 * kick waits on an open run for the same 4 minutes.
 */
export const STALE_RUN_MINUTES = 4;
/**
 * Minutes since the open run named in cockpit_clickup_writeback_begin's busy note started ("A requests run that
 * started at 14:05 Kuwait is still running.", or "A forms run ..."), on the Kuwait clock (UTC+3, no daylight
 * saving); null when the note does not say.
 */
export function openRunMinutes(note: unknown, now: number): number | null {
  const m = /started at ([01]\d|2[0-3]):([0-5]\d) Kuwait is still running/.exec(String(note ?? ""));
  if (!m) return null;
  const kuwait = new Date(now + 3 * 3_600_000);
  const nowMinute = kuwait.getUTCHours() * 60 + kuwait.getUTCMinutes();
  return (nowMinute - (Number(m[1]) * 60 + Number(m[2])) + 1440) % 1440;
}
const GAVE_UP = "Gave up after the retry ladder.";
/** A row the switch keeps out of ClickUp is handed back for this long, so the next rows in the queue get their turn. */
export const HOLD_MS = 5 * 60_000;
export const WAITING = {
  dry_run: "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.",
  apply_limited: "Waiting in the queue: requests are being tested on the canary card only, so this goes when they open to every card.",
} as const;
/** Attempts that counted: claims that only held a row back for the switch (progress.held) are not tries. */
export const triesOf = (item: RequestsItem) => Math.max(0, Number(item.attempts ?? 0) - Math.max(0, Number(item.progress?.held ?? 0) || 0));
/**
 * A request part whose ClickUp task exists: ClickUp answered its create with the task's id, or a task was adopted
 * (review round 3: a create still started with its id counts, so a task whose read-back kept failing for the whole
 * ladder is delivered with a note, never failed while it sits in ClickUp).
 */
export const taskMade = (item: RequestsItem, o: RequestOutcome) =>
  item.kind === "request" && Boolean(o.taskId || o.progress?.steps?.create?.id);
/**
 * A request part whose create may have reached ClickUp with no task the cockpit holds: started and never adopted
 * (an answer lost or with no id, two tasks matching, a search refused or unanswered). Failed would say nothing
 * reached ClickUp and invite a second task, so at the end of the ladder it stays unknown for a person (review round 3).
 */
export const createInDoubt = (item: RequestsItem, o: RequestOutcome) =>
  item.kind === "request" && !taskMade(item, o) && o.progress?.steps?.create?.state === "started";
/** After the ladder, a create in doubt is read again this often (the ladder's last step), until a person settles it. */
export const DOUBT_MINUTES = RETRY_MINUTES[RETRY_MINUTES.length - 1];
export const STILL_CHECKING = `The cockpit checks ClickUp again every ${DOUBT_MINUTES / 60} hours.`;
/** A settled part's note keeps the error's words but no promise of a next run: none follows once it is settled. */
export const finalWords = (error: string | undefined) =>
  String(error ?? "")
    .split(/(?<=\.)\s+/)
    .filter(s => !/\bnext run\b/i.test(s))
    .join(" ")
    .trim();

type Tally = { requests: number; actions: number; checks: number };
const tally = (): Tally => ({ requests: 0, actions: 0, checks: 0 });
const tallyKey = (item: RequestsItem): keyof Tally => (item.kind === "request" ? "requests" : item.payload?.op === "verify" ? "checks" : "actions");
const NOUNS: Record<keyof Tally, [string, string]> = { requests: ["request", "requests"], actions: ["task change", "task changes"], checks: ["owner check", "owner checks"] };
/** "3 requests", "2 requests and 1 task change"; with none, the noun of the first kind claimed. */
function itemsWords(t: Tally, claimed: Tally): string {
  const keys = Object.keys(NOUNS) as (keyof Tally)[];
  const parts = keys.filter(k => t[k] > 0).map(k => `${t[k]} ${NOUNS[k][t[k] === 1 ? 0 : 1]}`);
  if (!parts.length) return `0 ${NOUNS[keys.find(k => claimed[k] > 0) ?? "requests"][1]}`;
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

export async function runRequests(deps: Deps, limit = 6): Promise<JobResult> {
  const g = requestsGate(deps.env);
  const onlyCards = [...g.onlyCards];
  const db = requestsDb(deps.rpc);
  const report = (ok: boolean, note: string, counts: Row = {}) => db.state(ok, note, g.mode, onlyCards, counts);
  if (!deps.env("CLICKUP_API_TOKEN")) {
    await report(false, SAY.noToken);
    return { ok: false, job: "requests", mode: g.mode, note: SAY.noToken };
  }
  await db.sweep();
  const token = deps.uuid();
  const items = ((await db.claim(token, limit)) ?? []) as RequestsItem[];
  if (!items.length) {
    await report(true, "Nothing to write.");
    return { ok: true, job: "requests", mode: g.mode, note: "Nothing to write." };
  }
  const counts = { claimed: items.length, delivered: 0, dryRun: 0, skipped: 0, retry: 0, unknown: 0, failed: 0, held: 0 };
  const claimed = tally(), delivered = tally(), dry = tally();
  // The old ticket each routing request replaces, so every part checks it before making its task (review R2).
  // The claim names it on every part (replaces_task_id). On a database that does not send it yet, only the first
  // part's payload names it, and that serves the parts claimed in the same run.
  const routes = new Map<string, string>();
  for (const item of items) {
    const old = item.kind === "request" ? item.replaces_task_id || item.payload?.replacesTaskId : null;
    if (old && item.payload?.requestId) routes.set(String(item.payload.requestId), String(old));
  }
  const planned: Planned[] = [];
  const save = (id: string, patch: Row) => deps.rpc("cockpit_clickup_writeback_save", { p_id: id, p_token: token, p_patch: patch });
  /**
   * Hand a row this run will not send back to the queue without counting a try: the switch keeps it out of
   * ClickUp, the run's time is spent, a secret is missing, or another run is sending.
   * cockpit_clickup_writeback_release puts it back as it was (queued, or retry when it has ClickUp progress)
   * with the claim's attempt taken off. On a database without it, the row goes to retry with its progress
   * kept and progress.held counting the claims that were not tries (triesOf), so a row held back never loses
   * a rung of the retry ladder. `plan` null keeps the row's plan as it is.
   */
  const hold = async (item: RequestsItem, plan: Planned[] | null, note: string, waitMs = HOLD_MS) => {
    const next = new Date(deps.now() + waitMs).toISOString();
    try {
      // A null plan reaches the release as JSON null, which keeps the row's plan (migration 20261026r).
      await db.release(item.id, token, plan as unknown[], note, next);
      return;
    } catch {
      // Not there yet (or refused): the save below keeps the row retryable either way.
    }
    const progress = { ...(item.progress ?? {}), held: (Number(item.progress?.held ?? 0) || 0) + 1 };
    await save(item.id, { state: "retry", ...(plan ? { planned: plan } : {}), progress, error: note, next_attempt_at: next });
  };
  let runId: string | null = null;
  let stop = "";
  let went = "";
  try {
    let run: Row | null = null;
    try {
      // Exclusive: one requests run sends at a time, so the pace covers the whole job (BUSY_HELD).
      run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "requests", p_mode: g.mode, p_exclusive: true });
      const age = run?.id ? null : openRunMinutes(run?.note, deps.now());
      if (age !== null && age >= STALE_RUN_MINUTES) {
        // The open run stopped without reporting back: it no longer holds the job up.
        const since = /started at (\d{2}:\d{2})/.exec(String(run?.note))?.[1] ?? "";
        run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "requests", p_mode: g.mode, p_exclusive: false });
        went = `A requests run that started at ${since} Kuwait never reported back, so this one went ahead.`;
      }
    } catch (e) {
      run = { note: redact(String(e instanceof Error ? e.message : e)) };
    }
    if (!run?.id) {
      const busy = openRunMinutes(run?.note, deps.now()) !== null;
      // Nothing was sent: hand every claimed item back at once, its try not counted, instead of leaving it
      // claimed for ten minutes.
      for (const item of items) await hold(item, null, busy ? BUSY_HELD : NOT_STARTED, 0).catch(() => {});
      if (busy) {
        // Another run is sending: it, or the next minute's run, takes these rows. Not a failure.
        const note = anotherRunNote(items.length);
        await report(true, note, { claimed: items.length, handedBack: items.length });
        return { ok: true, job: "requests", mode: g.mode, note, counts: { claimed: items.length, handedBack: items.length } };
      }
      throw new Error(`${NOT_STARTED} ${String(run?.note ?? "")}`.trim());
    }
    runId = String(run.id);
    const started = deps.now();
    const ctx = runContext(paced(deps.providerFor(runId), deps.pace), deps.now, deps.rpc);
    for (const item of items) {
      const kind = tallyKey(item);
      claimed[kind] += 1;
      if (stop || deps.now() - started > REQUESTS_RUN_BUDGET_MS) {
        counts.held += 1;
        // Back to the queue for the next run, the claim's try taken off: nothing was sent for it. A held item
        // that cannot be handed back is claimed again after ten minutes; the run goes on.
        await hold(item, null, stop || HELD, 0).catch(() => {});
        continue;
      }
      try {
        if (item.source_exists === false) {
          await save(item.id, { state: "skipped", error: SAY.cancelled });
          counts.skipped += 1;
          continue;
        }
        // During the canary a request that routes an old form ticket goes only when that ticket's own card is a
        // canary card, so the rehearsal never closes a real ticket on All Tasks (review round 3, E-CANARY). The
        // claim keeps the same rule by the mode the writer last reported; this covers the run right after a
        // switch flip, which still claims by the old mode.
        const routesOld = item.kind === "request" && Boolean(item.replaces_task_id || routes.get(String(item.payload?.requestId)));
        const live =
          item.kind === "task_action" && item.payload?.op === "verify"
            ? g.apply
            : g.live(item.payload?.clientTaskId) && (!routesOld || g.live(item.replaces_client_task_id));
        if (!live) {
          // A dry run calls no provider: the plan comes from the frozen payload alone. The row is never
          // settled: it goes back to the queue, its progress untouched, and is sent once the switch lets it.
          const plan = item.kind === "request" ? planRequest(item) : planTaskAction(item);
          await hold(item, plan, g.mode === "apply_limited" ? WAITING.apply_limited : WAITING.dry_run);
          planned.push(...plan);
          counts.dryRun += 1;
          dry[kind] += 1;
          continue;
        }
        const keys = item.steps?.length ? item.steps : item.kind === "request" ? requestStepKeys(item.payload) : taskActionStepKeys(item.payload);
        if (!item.steps?.length) await save(item.id, { steps: keys });
        const provider = paced(deps.providerFor(item.id), deps.pace);
        const itemSave = async (patch: Row) => {
          await save(item.id, patch);
        };
        const routed = item.kind === "request" ? item.replaces_task_id || routes.get(String(item.payload?.requestId)) || null : null;
        const frozen = { ...item, steps: keys, ...(routed ? { replaces_task_id: routed } : {}) };
        const o: RequestOutcome =
          item.kind === "request" ? await executeRequest(frozen, provider, itemSave, ctx) : await executeTaskAction(frozen, provider, itemSave, ctx);
        const now = deps.now();
        const taskId = o.taskId ? { task_id: o.taskId } : {};
        const tries = triesOf(item);
        const gaveUp = o.state !== "delivered" && o.state !== "skipped" && o.state !== "failed" && tries > RETRY_MINUTES.length;
        const settle =
          o.state === "delivered"
            // A note on a delivered item (a field that did not save, a moved task) shows on its request part.
            ? { state: "delivered", progress: o.progress, delivered_at: new Date(now).toISOString(), error: o.note ? redact(o.note) : null, ...taskId }
            : o.state === "skipped"
              ? { state: "skipped", progress: o.progress, error: o.error ? redact(o.error) : null, ...taskId }
              : gaveUp && taskMade(item, o)
                // The task is in ClickUp: settling it failed would invite a second one. It is delivered, and
                // the step that never finished is named on the part.
                ? { state: "delivered", progress: o.progress, delivered_at: new Date(now).toISOString(), error: redact(`${SAY.unfinished} ${finalWords(o.error)}`.trim()), ...taskId }
                : gaveUp && createInDoubt(item, o)
                  // ClickUp may hold the task (two match, or an answer was lost): never "Nothing reached
                  // ClickUp". It stays unknown, the guardian names it, and it is read again every 4 hours, so a
                  // person who keeps one task and cancels the other sees it adopted.
                  ? {
                      state: "unknown",
                      progress: o.progress,
                      error: redact(`${o.error ?? ""} ${STILL_CHECKING}`.trim()),
                      next_attempt_at: new Date(now + DOUBT_MINUTES * 60_000).toISOString(),
                    }
                  : o.state === "failed" || gaveUp
                    ? { state: "failed", progress: o.progress, error: redact(o.error ?? GAVE_UP), ...taskId }
                    : {
                        state: o.state,
                        progress: o.progress,
                        error: o.error ? redact(o.error) : null,
                        next_attempt_at: new Date(now + RETRY_MINUTES[Math.min(Math.max(tries - 1, 0), RETRY_MINUTES.length - 1)] * 60_000).toISOString(),
                        ...taskId,
                      };
        // Counted only once its state is saved: an item whose last save failed is counted as unknown below.
        await save(item.id, settle);
        const settled = settle.state as "delivered" | "skipped" | "failed" | "retry" | "unknown";
        counts[settled] += 1;
        if (settled === "delivered") delivered[kind] += 1;
        if ((settled === "retry" || settled === "unknown") && o.stop) stop = redact(o.error ?? "A provider secret is missing.");
      } catch (e) {
        // Our own bookkeeping failed. The item may have reached ClickUp, so it is read back next time.
        counts.unknown += 1;
        await save(item.id, { state: "unknown", error: redact(String(e instanceof Error ? e.message : e)), next_attempt_at: new Date(deps.now() + 60_000).toISOString() }).catch(() => {});
      }
    }
    const toRetry = counts.retry + counts.unknown;
    const tail = [
      counts.skipped ? `${counts.skipped} skipped.` : "",
      counts.held ? `${counts.held} held for the next run.` : "",
      stop ? `Stopped: ${stop}` : "",
      went,
    ].filter(Boolean).join(" ");
    const note = !g.apply
      ? `Dry run: ${itemsWords(dry, claimed)} planned. Nothing was written to ClickUp. ${counts.dryRun === 1 ? "It waits" : "They wait"} in the queue for the switch.`
      : g.mode === "apply_limited"
        ? `Testing on the canary card: ${counts.delivered} delivered, ${counts.dryRun} held as a dry run (waiting in the queue).${toRetry || counts.failed ? ` ${toRetry} to retry, ${counts.failed} failed.` : ""}`
        : `${itemsWords(delivered, claimed)} delivered, ${toRetry} to retry, ${counts.failed} failed.${counts.dryRun ? ` ${counts.dryRun} held as a dry run.` : ""}`;
    const full = tail ? `${note} ${tail}` : note;
    const ok = counts.failed === 0 && !stop;
    await deps.rpc("cockpit_clickup_writeback_finish", { p_run: runId, p_ok: ok, p_note: full, p_counts: counts, p_planned: planned });
    await report(ok, full, counts);
    return { ok, job: "requests", mode: g.mode, note: full, counts };
  } catch (e) {
    const note = redact(String(e instanceof Error ? e.message : e));
    if (runId) await deps.rpc("cockpit_clickup_writeback_finish", { p_run: runId, p_ok: false, p_note: note, p_counts: counts, p_planned: planned }).catch(() => {});
    await report(false, note, counts).catch(() => {});
    return { ok: false, job: "requests", mode: g.mode, note, counts };
  }
}

/**
 * The requests doctor: reads only. Secrets by name (never a value), the mode,
 * and every template, Request Type option, field, named owner and done status
 * the request types rely on. Its result lands in cockpit_sync_state under
 * clickup-writeback:requests-doctor.
 */
export async function runRequestsDoctor(deps: Deps): Promise<JobResult & { problems: string[]; secrets: Row; onlyCards: string[] }> {
  const rq = requestsWords(deps.env);
  const secrets = Object.fromEntries(REQUEST_SECRETS.map(k => [k, Boolean(deps.env(k))]));
  const problems: string[] = [];
  let counts: Row = {};
  if (!secrets.CLICKUP_API_TOKEN) problems.push(SAY.noToken);
  if (!secrets.CRON_SECRET) problems.push("CRON_SECRET is not set on this Edge Function, so the cron cannot start a requests run.");
  if (secrets.CLICKUP_API_TOKEN) {
    try {
      const inputs = await requestsDb(deps.rpc).doctorInputs();
      const checked = await doctorChecks(inputs ?? {}, paced(deps.providerFor(deps.uuid()), deps.pace));
      problems.push(...checked.problems);
      counts = checked.counts;
    } catch (e) {
      problems.push(`Could not read the request types: ${redact(String(e instanceof Error ? e.message : e))}`);
    }
  }
  const ok = problems.length === 0;
  const head = `Requests and task changes: ${rq.text}.`;
  const note = ok
    ? `Ready. ${head} ${counts.types ?? 0} request types and ${counts.targets ?? 0} targets checked against ClickUp.`
    : `${problems.length} ${problems.length === 1 ? "problem" : "problems"}. ${head} ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? ` And ${problems.length - 5} more.` : ""}`;
  const at = new Date(deps.now()).toISOString();
  try {
    await deps.syncState?.("clickup-writeback:requests-doctor", {
      last_run_at: at,
      ...(ok ? { last_ok_at: at } : {}),
      ok,
      note: note.slice(0, 500),
      detail: { mode: rq.mode, onlyCards: rq.cards, secrets, problems, counts, at },
      updated_at: at,
    });
  } catch (e) {
    problems.push(`The doctor's result could not be saved: ${redact(String(e instanceof Error ? e.message : e))}`);
  }
  return { ok: ok && problems.length === 0, job: "requests_doctor", mode: rq.mode, note, problems, secrets, onlyCards: rq.cards, counts };
}

// --- forms ---------------------------------------------------------------------
// The 1-1 notes writes (forms.ts; docs/forms/STAGE2B-CONTRACT.md build 1): its own
// switch, its own claim (one lane per client card, the owner gate asked per row),
// its own run rows and its own health key clickup-writeback:forms.

/** A run stops taking new rows after this long, so it ends inside the Edge Function's wall clock. */
export const FORMS_RUN_BUDGET_MS = 100_000;
/**
 * The forms jobs' pace, CLICKUP_FORMS_CALLS_PER_MINUTE: 10 calls a minute unless set, never more than 60 and never
 * less than 5, the floor of every other ClickUp pace: below it a run outlasts the Edge wall clock (FORMS_RUN_BUDGET_MS
 * stops new rows at 100 s, the row in hand still sends, and at 5 a minute the last call is by about 125 s). The Business plan gives the one token every caller shares 100 calls a minute, the callers together
 * aim at about 80, and no single job takes more than 60 (docs/requests/CLICKUP-DOWNGRADE.md). About 11 calls write
 * one response's four rows, so the default writes a response in a little over a minute.
 */
export const FORMS_CALLS_PER_MINUTE = 10;
export const FORMS_CALLS_PER_MINUTE_MAX = 60;
export function formsPerMinute(env: Deps["env"]): number {
  // writebackPerMinute's shape: tested before it is floored, so 0.5 reads as the floor of 5 and never as the default of 10.
  const set = Number(env("CLICKUP_FORMS_CALLS_PER_MINUTE"));
  const pace = Number.isFinite(set) && set > 0 ? set : FORMS_CALLS_PER_MINUTE;
  return Math.floor(Math.min(FORMS_CALLS_PER_MINUTE_MAX, Math.max(CALLS_MIN, pace)));
}
const FORMS_NOT_STARTED = "The 1-1 notes run could not start, so this waits for the next run.";
const FORMS_SLOW_DOWN = "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run.";
const FORMS_CHECK_CARD = "An earlier try may have reached the card, so check it in ClickUp.";
/**
 * One 1-1 notes run sends at a time, so CLICKUP_FORMS_CALLS_PER_MINUTE is the whole job's pace, not one Edge
 * Function call's (review round 2; docs/requests/CLICKUP-DOWNGRADE.md 1.3 does the same for requests). The pacer
 * belongs to one call, a run of 8 rows at 10 a minute sends for about two minutes, and runs claim different cards'
 * rows, so two runs side by side would send twice the pace on the token every caller shares. The kick posts no run
 * while one is open (20261029t); a run that still finds another open hands back what it claimed, its tries untouched.
 */
export const FORMS_BUSY_HELD = "Another 1-1 notes run is still sending, so this waits for the next run.";
export const formsAnotherRunNote = (n: number) =>
  `Another 1-1 notes run is still sending, so this one handed back the ${n === 1 ? "write" : `${n} writes`} it claimed; the next run takes ${n === 1 ? "it" : "them"}.`;
const writesWord = (n: number) => `${n} ${n === 1 ? "write" : "writes"}`;
const isoAt = (ms: number) => new Date(ms).toISOString();

/**
 * What a forms run says when its claim took nothing (review round 3). The claim first settles every open row the
 * owner gate refuses, in every mode, so a row still open waits for the switch, a later try, or an older call on
 * its card (one lane per card). "Nothing to write." only when the queue holds no open form row: missing is never
 * zero, so a count that cannot be read is said, not reported as nothing.
 */
export async function formsIdle(db: ReturnType<typeof formsDb>, g: ReturnType<typeof formsGate>, now: number): Promise<{ note: string; counts: Row }> {
  let open: number | null = null;
  let next = NaN;
  try {
    const inputs = await db.doctorInputs();
    const byState = inputs?.queue;
    if (byState && typeof byState === "object" && !Array.isArray(byState)) {
      open = ["queued", "retry", "unknown"].reduce((n, s) => n + Math.max(0, Math.floor(Number(byState[s]) || 0)), 0);
      next = Date.parse(String(inputs?.oldestDue ?? ""));
    }
  } catch {
    open = null;
  }
  if (open === 0) return { note: "Nothing to write.", counts: { waiting: 0 } };
  if (open === null) return { note: "Nothing to write now. The 1-1 notes queue could not be counted, so it is not reported as empty.", counts: {} };
  const rows = `${writesWord(open)} ${open === 1 ? "waits" : "wait"}`;
  if (!g.apply) return { note: `Nothing written: ${rows} in the queue while the 1-1 notes writer is off.`, counts: { waiting: open } };
  if (Number.isFinite(next) && next > now) {
    const k = new Date(next + 3 * 3_600_000);
    const at = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
    return { note: `Nothing to write now: ${rows} for a later try, the next at ${at} Kuwait.`, counts: { waiting: open } };
  }
  const where = g.mode === "apply_limited" ? "on the other cards, behind an older call on their card, or for the next run" : "behind an older call on their card, or for the next run";
  return { note: `Nothing to write now: ${rows} ${where}.`, counts: { waiting: open } };
}

export async function runForms(deps: Deps, limit = 8): Promise<JobResult> {
  const g = formsGate(deps.env);
  const onlyCards = [...g.onlyCards];
  const db = formsDb(deps.rpc);
  // A card list the gate cannot read keeps the writer off, and every answer of this run says so first (the row keeps
  // 500 characters) and reads not ok: nothing is claimed, but the switch is wrong and someone has to correct it.
  const said = (ok: boolean, note: string) => ({ ok: ok && !g.error, note: g.error ? `${g.error} ${note}` : note });
  const report = (ok: boolean, note: string, counts: Row = {}) => {
    const s = said(ok, note);
    return db.state(s.ok, s.note, g.mode, onlyCards, counts);
  };
  if (!deps.env("CLICKUP_API_TOKEN")) {
    await report(false, SAY.noToken);
    return { ...said(false, SAY.noToken), job: "forms", mode: g.mode };
  }
  const token = deps.uuid();
  const items = ((await db.claim(token, limit)) ?? []) as FormItem[];
  if (!items.length) {
    const idle = await formsIdle(db, g, deps.now());
    await report(true, idle.note, idle.counts);
    return { ...said(true, idle.note), job: "forms", mode: g.mode };
  }
  // held = heldOff (the switch keeps the card out) + heldNext (the run's time is spent, or a 429 or a missing secret
  // stopped it); forms_state and the guardian read held, the note names the two apart.
  const counts = { claimed: items.length, delivered: 0, skipped: 0, retry: 0, unknown: 0, failed: 0, held: 0, heldOff: 0, heldNext: 0 };
  const planned: Row[] = [];
  const save = (id: string, patch: Row) => deps.rpc("cockpit_clickup_writeback_save", { p_id: id, p_token: token, p_patch: patch });
  /**
   * Hand a row back to the queue without counting a try (cockpit_clickup_writeback_release): queued, or retry
   * once its steps hold anything. Never dry_run: a held row is written once its switch lets it. Should the
   * release be refused, the row goes to retry with the note, still never settled.
   */
  const handBack = async (item: FormItem, note: string, waitMs: number) => {
    const next = isoAt(deps.now() + waitMs);
    try {
      await db.release(item.id, token, planForm(item), note, next);
    } catch {
      await save(item.id, { state: "retry", error: note, next_attempt_at: next }).catch(() => {});
    }
  };
  let runId: string | null = null;
  let stop = "";
  let went = "";
  // The provider's last wording this run, for the tech lead: the row and its effect carry a plain sentence instead.
  let lastSaid = "";
  // One check of the token a run is enough once it answers: further 401s in this run are their own cards'.
  let tokenAnswers = false;
  const refusedCards = new Set<string>();
  try {
    let run: Row | null = null;
    try {
      // Exclusive: one forms run sends at a time, so the pace covers the whole job (FORMS_BUSY_HELD).
      run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "forms", p_mode: g.mode, p_exclusive: true });
      const age = run?.id ? null : openRunMinutes(run?.note, deps.now());
      if (age !== null && age >= STALE_RUN_MINUTES) {
        // The open run stopped without reporting back: it no longer holds the job up.
        const since = /started at (\d{2}:\d{2})/.exec(String(run?.note))?.[1] ?? "";
        run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "forms", p_mode: g.mode, p_exclusive: false });
        went = `A 1-1 notes run that started at ${since} Kuwait never reported back, so this one went ahead.`;
      }
    } catch (e) {
      run = { note: redact(String(e instanceof Error ? e.message : e)) };
    }
    if (!run?.id) {
      const busy = openRunMinutes(run?.note, deps.now()) !== null;
      // Nothing was written: every claimed row goes back at once, its try not counted, instead of staying claimed
      // for ten minutes.
      for (const item of items) await handBack(item, busy ? FORMS_BUSY_HELD : FORMS_NOT_STARTED, 0);
      if (busy) {
        // Another run is sending: it, or the next run the kick posts, takes these rows. Not a failure.
        const note = formsAnotherRunNote(items.length);
        const handed = { claimed: items.length, handedBack: items.length };
        await report(true, note, handed);
        return { ...said(true, note), job: "forms", mode: g.mode, counts: handed };
      }
      throw new Error(`${FORMS_NOT_STARTED} ${String(run?.note ?? "")}`.trim());
    }
    runId = String(run.id);
    const started = deps.now();
    for (const item of items) {
      if (stop || deps.now() - started > FORMS_RUN_BUDGET_MS) {
        counts.held += 1;
        counts.heldNext += 1;
        await handBack(item, stop || HELD, 0);
        continue;
      }
      if (!g.live(item.task_id)) {
        // The switch keeps this card out of ClickUp: back to the queue, untouched, for when it opens.
        counts.held += 1;
        counts.heldOff += 1;
        planned.push(...planForm(item));
        await handBack(item, g.error ?? (g.mode === "apply_limited" ? SAY_FORMS.heldLimited : SAY_FORMS.heldOff), HOLD_MS);
        continue;
      }
      try {
        const checked = await formStep(item);
        const step = "step" in checked ? frozenStep(item, checked.step) : null;
        if (!step) {
          await save(item.id, { state: "failed", error: "fail" in checked ? checked.fail : SAY_FORMS.mismatch });
          counts.failed += 1;
          continue;
        }
        // Freeze the write before the first call, so a retry posts exactly the same text.
        if (!item.steps?.length) await save(item.id, { steps: [step] });
        const provider = paced(deps.providerFor(item.id), deps.pace);
        let o = await executeForm(item, step, provider, async patch => {
          await save(item.id, patch);
        }, deps.now);
        if (o.tokenRefused) {
          const check = tokenAnswers ? "good" : await checkToken(provider);
          tokenAnswers = check === "good";
          if (check !== "good") {
            // The token, or no way to tell: the row goes back with no try used and every later row waits. This row
            // waits out HOLD_MS; the rest are due at once. A bad token costs two calls a run (the refused call and the
            // check), so the mistake reads not ok until someone fixes it.
            await save(item.id, { progress: o.progress });
            stop = check === "refused" ? SAY_FORMS.tokenRefused : check === "slow" ? FORMS_SLOW_DOWN : SAY_FORMS.tokenUnsure;
            lastSaid = redact(o.error ?? "");
            counts.held += 1;
            counts.heldNext += 1;
            await handBack(item, stop, HOLD_MS);
            continue;
          }
          // The token answers, so this card refuses it: the ladder settles the row and the run goes on (forms.ts).
          o = cardRefused(o, step.key);
          if (item.task_id) refusedCards.add(item.task_id);
        }
        const now = deps.now();
        const tries = Math.max(0, Number(item.attempts ?? 0));
        const gaveUp = o.state !== "delivered" && o.state !== "skipped" && o.state !== "failed" && tries > RETRY_MINUTES.length;
        // The row's error is what the effect's trail prints (3.6). ClickUp's own wording, or the database's when our
        // save failed, stays out of it: it goes on progress.lastDetail and in the run's note. A retry row's error
        // reaches no effect, so it keeps the wording.
        const closing = o.state === "failed" || o.state === "unknown" || gaveUp;
        if (closing && o.plain) lastSaid = redact(o.error ?? "");
        const progress = closing && o.plain ? { ...o.progress, lastDetail: redact(o.error ?? "") } : o.progress;
        const settle: Row =
          o.state === "delivered"
            ? { state: "delivered", progress, delivered_at: isoAt(now), error: null }
            : o.state === "skipped"
              ? { state: "skipped", progress, error: o.error ? redact(o.error) : null }
              : o.state === "failed"
                ? { state: "failed", progress, error: redact(o.plain ?? o.error ?? GAVE_UP) }
                : gaveUp
                  ? { state: "failed", progress, error: redact(o.endsAs ?? `${GAVE_UP} ${o.state === "unknown" ? FORMS_CHECK_CARD : ""} ${o.plain ? "" : (o.error ?? "")}`.replace(/\s+/g, " ").trim()) }
                  : {
                      state: o.state,
                      progress,
                      error: redact((o.state === "unknown" ? o.plain : undefined) ?? o.error ?? "") || null,
                      next_attempt_at: isoAt(now + RETRY_MINUTES[Math.min(Math.max(tries - 1, 0), RETRY_MINUTES.length - 1)] * 60_000),
                    };
        await save(item.id, settle);
        const settled = settle.state as "delivered" | "skipped" | "failed" | "retry" | "unknown";
        counts[settled] += 1;
        // Whatever the row settled as, its last rung included: a 429 on the token every caller shares, or a missing
        // secret, stops ClickUp calls for the rest of this run.
        if (o.stop) stop = redact(o.error ?? "A provider secret is missing.");
        else if (/rejected the request \(429/.test(o.error ?? "")) stop = FORMS_SLOW_DOWN;
      } catch (e) {
        // Our own bookkeeping failed. The write may have reached ClickUp, so it is read back next time.
        counts.unknown += 1;
        lastSaid = redact(String(e instanceof Error ? e.message : e));
        await save(item.id, { state: "unknown", error: SAY.bookkeeping, next_attempt_at: isoAt(deps.now() + 60_000) }).catch(() => {});
      }
    }
    const toRetry = counts.retry + counts.unknown;
    const tail = [
      counts.skipped ? `${counts.skipped} kept as ClickUp has them.` : "",
      went,
      refusedCards.size ? `ClickUp refused the cockpit's token on ${refusedCards.size === 1 ? "card" : "cards"} ${[...refusedCards].join(", ")}.` : "",
      stop ? `Stopped: ${stop}` : "",
      lastSaid ? `Last detail: ${lastSaid}` : "",
    ].filter(Boolean).join(" ");
    const heldNext = counts.heldNext ? ` ${writesWord(counts.heldNext)} held for the next run.` : "";
    const note = !g.apply
      ? `Dry run: ${writesWord(counts.held)} held. Nothing was written to ClickUp: the 1-1 notes writer is off until the switch-over.`
      : g.mode === "apply_limited"
        ? `Testing on the test card: ${counts.delivered} written to ClickUp, ${toRetry} to retry, ${counts.failed} failed.${counts.heldOff ? ` ${writesWord(counts.heldOff)} held for the other cards.` : ""}${heldNext}`
        : `${writesWord(counts.delivered)} reached ClickUp, ${toRetry} to retry, ${counts.failed} failed.${heldNext}`;
    const full = tail ? `${note} ${tail}` : note;
    const ok = counts.failed === 0 && !stop;
    const out = said(ok, full);
    await deps.rpc("cockpit_clickup_writeback_finish", { p_run: runId, p_ok: out.ok, p_note: out.note, p_counts: counts, p_planned: planned });
    await report(ok, full, counts);
    return { ...out, job: "forms", mode: g.mode, counts };
  } catch (e) {
    const note = redact(String(e instanceof Error ? e.message : e));
    if (runId) await deps.rpc("cockpit_clickup_writeback_finish", { p_run: runId, p_ok: false, p_note: note, p_counts: counts, p_planned: planned }).catch(() => {});
    await report(false, note, counts).catch(() => {});
    return { ...said(false, note), job: "forms", mode: g.mode, counts };
  }
}

/** Secrets the forms jobs read, by name only (never a value). */
export const FORMS_SECRETS = ["CLICKUP_API_TOKEN", "CRON_SECRET", "CLICKUP_WRITEBACK_APPLY_FORMS", "CLICKUP_WRITEBACK_FORMS_ONLY_CARDS"];

/**
 * The forms doctor: reads only. Secrets by name, the mode, the six Client Happiness options and the two date
 * fields on Clients - Mahara, and the canary card on that list. Its result lands in cockpit_sync_state under
 * clickup-writeback:forms-doctor.
 */
export async function runFormsDoctor(deps: Deps): Promise<JobResult & { problems: string[]; secrets: Row; onlyCards: string[] }> {
  const fw = formsWords(deps.env);
  const secrets = Object.fromEntries(FORMS_SECRETS.map(k => [k, Boolean(deps.env(k))]));
  const problems: string[] = [];
  let counts: Row = {};
  let inputs: Row = {};
  if (!secrets.CLICKUP_API_TOKEN) problems.push(SAY.noToken);
  if (!secrets.CRON_SECRET) problems.push("CRON_SECRET is not set on this Edge Function, so the cron cannot start a 1-1 notes run.");
  if (fw.error) problems.push(fw.error);
  try {
    inputs = (await formsDb(deps.rpc).doctorInputs()) ?? {};
  } catch (e) {
    problems.push(`Could not read the 1-1 notes queue: ${redact(String(e instanceof Error ? e.message : e))}`);
  }
  if (secrets.CLICKUP_API_TOKEN) {
    try {
      const checked = await formsDoctorChecks(inputs, paced(deps.providerFor(deps.uuid()), deps.pace), fw.cards);
      problems.push(...checked.problems);
      counts = checked.counts;
    } catch (e) {
      problems.push(`Could not check ClickUp: ${redact(String(e instanceof Error ? e.message : e))}`);
    }
  }
  const ok = problems.length === 0;
  const head = `1-1 notes writes: ${fw.text}.`;
  const cards = counts.cards ? ` The test card ${(counts.cards as string[]).join(", ")} is on Clients - Mahara.` : "";
  const note = ok
    ? `Ready. ${head} Client Happiness has its six options and Last POC and Last Check-in Call are date fields on Clients - Mahara.${cards}`
    : `${problems.length} ${problems.length === 1 ? "problem" : "problems"}. ${head} ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? ` And ${problems.length - 5} more.` : ""}`;
  const at = new Date(deps.now()).toISOString();
  try {
    await deps.syncState?.("clickup-writeback:forms-doctor", {
      last_run_at: at,
      ...(ok ? { last_ok_at: at } : {}),
      ok,
      note: note.slice(0, 500),
      detail: { mode: fw.mode, onlyCards: fw.cards, secrets, problems, counts, owners: inputs.owners ?? null, queue: inputs.queue ?? null, at },
      updated_at: at,
    });
  } catch (e) {
    problems.push(`The doctor's result could not be saved: ${redact(String(e instanceof Error ? e.message : e))}`);
  }
  return { ok: ok && problems.length === 0, job: "forms_doctor", mode: fw.mode, note, problems, secrets, onlyCards: fw.cards, counts };
}
