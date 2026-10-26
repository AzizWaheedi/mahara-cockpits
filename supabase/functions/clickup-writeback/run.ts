// The ClickUp writeback jobs (kpi, log, dosdonts, requests and the two
// doctors), with every dependency injected so the tests can run them end to
// end without a network.
//
// OUTWARD SAFETY. Four Edge Function secrets open writes to ClickUp, each
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
export const JOBS = ["kpi", "log", "dosdonts", "doctor", "requests", "requests_doctor"] as const;
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
export async function runDoctor(deps: Deps): Promise<JobResult & { secrets: Row; queue: unknown; kpiMode: string; requestsMode: string; requestsOnlyCards: string[] }> {
  const g = gate(deps.env);
  const kpi = kpiGate(deps.env);
  const rq = requestsWords(deps.env);
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
    note: `${missing.length ? `Missing secrets: ${missing.join(", ")}.` : `Ready. Mode: ${g.mode}.`} KPI columns: ${
      kpi.apply ? kpi.mode : "dry run (they are written only when CLICKUP_WRITEBACK_APPLY_KPI is true)"
    }. Requests and task changes: ${rq.text}.`,
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
const GAVE_UP = "Gave up after the retry ladder.";

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
  const planned: Planned[] = [];
  const save = (id: string, patch: Row) => deps.rpc("cockpit_clickup_writeback_save", { p_id: id, p_token: token, p_patch: patch });
  let runId: string | null = null;
  let stop = "";
  try {
    let run: Row | null = null;
    try {
      run = await deps.rpc("cockpit_clickup_writeback_begin", { p_job: "requests", p_mode: g.mode, p_exclusive: false });
    } catch (e) {
      run = { note: redact(String(e instanceof Error ? e.message : e)) };
    }
    if (!run?.id) {
      // Nothing was written: hand every claimed item back at once instead of leaving it claimed for ten minutes.
      for (const item of items) await save(item.id, { state: "retry", next_attempt_at: new Date(deps.now()).toISOString(), error: NOT_STARTED }).catch(() => {});
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
        // A held item that cannot be handed back is claimed again after ten minutes; the run goes on.
        await save(item.id, { state: "retry", next_attempt_at: new Date(deps.now()).toISOString(), error: stop || HELD }).catch(() => {});
        continue;
      }
      try {
        if (item.source_exists === false) {
          await save(item.id, { state: "skipped", error: SAY.cancelled });
          counts.skipped += 1;
          continue;
        }
        const live = item.kind === "task_action" && item.payload?.op === "verify" ? g.apply : g.live(item.payload?.clientTaskId);
        if (!live) {
          // A dry run calls no provider: the plan comes from the frozen payload alone.
          const plan = item.kind === "request" ? planRequest(item) : planTaskAction(item);
          await save(item.id, { state: "dry_run", planned: plan });
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
        const frozen = { ...item, steps: keys };
        const o: RequestOutcome =
          item.kind === "request" ? await executeRequest(frozen, provider, itemSave, ctx) : await executeTaskAction(frozen, provider, itemSave, ctx);
        const now = deps.now();
        const taskId = o.taskId ? { task_id: o.taskId } : {};
        const settle =
          o.state === "delivered"
            // A note on a delivered item (a field that did not save, a moved task) shows on its request part.
            ? { state: "delivered", progress: o.progress, delivered_at: new Date(now).toISOString(), error: o.note ? redact(o.note) : null, ...taskId }
            : o.state === "skipped"
              ? { state: "skipped", progress: o.progress, error: o.error ? redact(o.error) : null, ...taskId }
              : o.state === "failed" || item.attempts > RETRY_MINUTES.length
                ? { state: "failed", progress: o.progress, error: redact(o.error ?? GAVE_UP), ...taskId }
                : {
                    state: o.state,
                    progress: o.progress,
                    error: o.error ? redact(o.error) : null,
                    next_attempt_at: new Date(now + RETRY_MINUTES[Math.min(Math.max(item.attempts - 1, 0), RETRY_MINUTES.length - 1)] * 60_000).toISOString(),
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
    ].filter(Boolean).join(" ");
    const note = !g.apply
      ? `Dry run: ${itemsWords(dry, claimed)} planned. Nothing was written to ClickUp.`
      : g.mode === "apply_limited"
        ? `Testing on the canary card: ${counts.delivered} delivered, ${counts.dryRun} held as a dry run.${toRetry || counts.failed ? ` ${toRetry} to retry, ${counts.failed} failed.` : ""}`
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
