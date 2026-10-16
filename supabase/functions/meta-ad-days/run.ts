/**
 * One meta-ad-days job:
 *
 *   hourly / nightly / backfill
 *     1. the business edges: every ad account with spend in the job's window
 *        (accounts.ts), Mahara's own account left out;
 *     2. the pieces each account reads, on its own calendar (days.ts);
 *     3. cockpit_meta_ad_days_begin: the run row and its tasks (one account and
 *        up to 7 days each, plus one reach task per account: account level
 *        hourly, every level nightly, none for a backfill); the database ties
 *        each account to a client through cockpit_board_clients and lists the
 *        ones it cannot tie;
 *     4. the drain below.
 *   continue
 *     the drain only. pg_cron posts it every 2 minutes while tasks wait, so a
 *     run longer than one invocation (a nightly pass, a 90-day backfill)
 *     finishes over a few.
 *   doctor
 *     reads only: the token, the pinned Graph version, the edges, the ties
 *     and the last runs, in plain sentences.
 *
 * The drain claims up to 3 tasks at a time (leased 5 minutes, 4 tries), reads
 * Meta, and hands the rows to cockpit_meta_ad_days_apply or
 * cockpit_meta_reach_apply, which upsert by (ad_id, day) and (level, key,
 * window). It stops claiming 30 seconds before its budget so the invocation
 * ends inside the Edge Function's wall clock; a task it could not finish goes
 * back to the queue when its lease runs out. A failure is written on the task
 * with the sentence that says what to do, and the run's note gathers them.
 * Nothing here deletes a stored ad-day.
 *
 * A dry run does 1 and 2 and returns the plan with the ties: nothing is
 * written but the call receipts.
 */
import { type Account, discoverAccounts } from "./accounts.ts";
import { type InsertReceipt, type Rpc, RpcError } from "./db.ts";
import { discoveryWindow, halves, type JobKind, knownZone, MAX_BACKFILL_DAYS, type Span, spansFor, zonedDay } from "./days.ts";
import { GRAPH_VERSION, type GraphDeps, MAHARA_BUSINESS_ID, MetaError, metaGet, metaPages, type Row } from "./graph.ts";
import { DAY_FIELDS, dedupe, type Level, ParseError, parseAdDay, parseReach, REACH_LEVELS, toApplyRow, type Window } from "./parse.ts";

export type Job =
  | { job: "hourly" | "nightly"; dryRun: boolean; requestedBy: string }
  | { job: "backfill"; days: number; accounts?: string[]; dryRun: boolean; requestedBy: string }
  | { job: "continue" | "doctor"; dryRun: false; requestedBy: string };

export type RunDeps = {
  rpc: Rpc;
  insertReceipt: InsertReceipt;
  fetch: typeof fetch;
  /** META_SYSTEM_TOKEN, read by name; empty when it is not set. */
  token: () => string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Wall clock of one invocation (default 110 s, inside the 150 s limit). */
  budgetMs?: number;
  /** Tasks read at once (default 3). */
  concurrency?: number;
  /** Secrets present, by name only, for the doctor. */
  secrets?: () => Record<string, boolean>;
};

export type Task = {
  id: number;
  runId: string;
  job: JobKind;
  kind: "days" | "reach_account" | "reach_all";
  accountId: string;
  accountName: string | null;
  since: string | null;
  until: string | null;
  windows: Window[];
  leaseToken: string;
  attempt: number;
};

export type DrainResult = { claimed: number; done: number; failed: number; retried: number; rows: number; stoppedBy: "empty" | "budget" };

const BUDGET_MS = 110_000;
const STOP_BEFORE_MS = 30_000;
const APPLY_CHUNK = 1000;
const LEASE_SECONDS = 300;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** Graph access whose receipts carry the run they belong to. */
export function graphFor(deps: RunDeps, runId: string | null): GraphDeps {
  let index = 0;
  return {
    token: deps.token,
    fetch: deps.fetch,
    health: async receipt => {
      index += 1;
      await deps.insertReceipt({ ...receipt, error: receipt.error ? receipt.error.slice(0, 240) : null, run_id: runId, receipt_index: runId ? index : null });
    },
  };
}

/** What a failure means for the people who read the note: what happened, then what to do. */
export function sentence(e: unknown): string {
  if (e instanceof MetaError) {
    if (e.kind === "token") return `${e.message} Make a new system-user token in Business Settings and set META_SYSTEM_TOKEN on meta-ad-days.`;
    if (e.kind === "permission") return `${e.message} The ad account is not shared with Mahara's business, or the system user has no access to it.`;
    if (e.kind === "rate") return `${e.message} Meta's rate limit; a later run reads it again.`;
    if (e.kind === "heavy") return `${e.message} Meta could not build the answer even a day at a time; a later run tries again.`;
    return e.message;
  }
  if (e instanceof ParseError) return `${e.message} Nothing was written for this read.`;
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/** Worth another try later: Meta's limits, Meta being slow, or the database not answering (not the database refusing the rows). */
export function retryable(e: unknown): boolean {
  if (e instanceof MetaError) return e.kind === "rate" || e.kind === "heavy";
  if (e instanceof RpcError) return e.code !== "22023" && e.code !== "42501";
  return !(e instanceof ParseError);
}

async function record(deps: RunDeps, job: string, ok: boolean, note: string, requestedBy: string, detail: Record<string, unknown> = {}) {
  await deps.rpc("cockpit_meta_ad_days_record", { p: { job, ok, note: note.slice(0, 500), requestedBy, detail } });
}

function accountRow(a: Account) {
  return { accountId: a.accountId, name: a.name, currency: a.currency, timezone: a.timezone, status: a.status, spend: Math.round(a.spend * 100) / 100, edge: a.edge };
}

// ---------------------------------------------------------------- start

export async function startJob(deps: RunDeps, job: Job): Promise<Record<string, unknown>> {
  if (job.job === "continue") return { ok: true, job: "continue", ...(await drain(deps, deps.now())) };
  if (job.job === "doctor") return runDoctor(deps);
  const startedAt = deps.now();
  const kind: JobKind = job.job;
  const days = job.job === "backfill" ? job.days : MAX_BACKFILL_DAYS;
  const only = job.job === "backfill" && job.accounts?.length ? new Set(job.accounts) : undefined;
  const window = discoveryWindow(kind, startedAt, days);
  let found: Awaited<ReturnType<typeof discoverAccounts>>;
  try {
    found = await discoverAccounts(graphFor(deps, null), window, only);
  } catch (e) {
    const note = `The ad accounts could not be listed: ${sentence(e)}`;
    if (!job.dryRun) await record(deps, kind, false, note, job.requestedBy);
    return { ok: false, job: kind, note };
  }
  const tasks = found.accounts.flatMap(a =>
    spansFor(kind, startedAt, a.timezone && knownZone(a.timezone) ? a.timezone : "Asia/Kuwait", days).map(s => ({
      kind: "days",
      accountId: a.accountId,
      since: s.since,
      until: s.until,
    })),
  );
  const reach = kind === "hourly" ? "account" : kind === "nightly" ? "all" : null;
  const accounts = found.accounts.map(accountRow);
  if (job.dryRun) {
    const inputs = (await deps.rpc("cockpit_meta_ad_days_inputs", { p: { accountIds: found.accounts.map(a => a.accountId) } })) as Row | null;
    return {
      ok: true,
      dryRun: true,
      job: kind,
      graphVersion: GRAPH_VERSION,
      window,
      listed: found.listed,
      accounts,
      internal: found.internal,
      tasks: tasks.length,
      reachTasks: reach ? accounts.length : 0,
      ties: inputs?.ties ?? null,
      notLinked: inputs?.notLinked ?? null,
      windows: inputs?.windows ?? null,
      note: `${accounts.length} ad accounts spent between ${window.since} and ${window.until}; ${tasks.length} reads of up to 7 days are planned.`,
    };
  }
  const begun = (await deps.rpc("cockpit_meta_ad_days_begin", {
    p: {
      job: kind,
      requestedBy: job.requestedBy,
      graphVersion: GRAPH_VERSION,
      window: { since: window.since, until: window.until },
      accounts,
      internal: found.internal,
      unreadable: found.unreadable,
      tasks,
      reach,
    },
  })) as Row | null;
  if (!isRow(begun) || begun.started !== true) {
    return { ok: true, job: kind, started: false, note: "A run of this job is still working; this one did not start.", busy: begun };
  }
  const drained = await drain(deps, startedAt);
  return { ok: true, job: kind, started: true, runId: begun.runId, tasks: begun.tasks, notLinked: begun.notLinked, ...drained };
}

// ---------------------------------------------------------------- drain

export function readTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) throw new Error("The task queue answered without a list.");
  return raw.map(x => {
    if (!isRow(x) || typeof x.id !== "number" || typeof x.runId !== "string" || typeof x.leaseToken !== "string" || typeof x.accountId !== "string") {
      throw new Error("The task queue answered with a task it could not read.");
    }
    const windows = Array.isArray(x.windows)
      ? x.windows.filter(isRow).map(w => ({ key: String(w.key), from: String(w.from), to: String(w.to) }))
      : [];
    return {
      id: x.id,
      runId: x.runId,
      job: x.job as JobKind,
      kind: x.kind as Task["kind"],
      accountId: x.accountId,
      accountName: typeof x.accountName === "string" ? x.accountName : null,
      since: typeof x.since === "string" ? x.since : null,
      until: typeof x.until === "string" ? x.until : null,
      windows,
      leaseToken: x.leaseToken,
      attempt: typeof x.attempt === "number" ? x.attempt : 1,
    };
  });
}

export async function drain(deps: RunDeps, startedAt: number): Promise<DrainResult> {
  const budget = deps.budgetMs ?? BUDGET_MS;
  const k = Math.max(1, Math.min(deps.concurrency ?? 3, 5));
  const out: DrainResult = { claimed: 0, done: 0, failed: 0, retried: 0, rows: 0, stoppedBy: "empty" };
  while (true) {
    if (deps.now() - startedAt > budget - STOP_BEFORE_MS) {
      out.stoppedBy = "budget";
      return out;
    }
    const tasks = readTasks(await deps.rpc("cockpit_meta_ad_days_claim", { p: { limit: k, leaseSeconds: LEASE_SECONDS } }));
    if (!tasks.length) return out;
    out.claimed += tasks.length;
    const results = await Promise.all(tasks.map(t => work(deps, t)));
    for (const r of results) {
      if (r.state === "done") out.done += 1;
      else if (r.state === "retry") out.retried += 1;
      else out.failed += 1;
      out.rows += r.rows;
    }
  }
}

type WorkResult = { state: "done" | "retry" | "failed"; rows: number };

async function work(deps: RunDeps, task: Task): Promise<WorkResult> {
  const graph = graphFor(deps, task.runId);
  try {
    if (task.kind === "days") return { state: "done", rows: await workDays(deps, graph, task) };
    return { state: "done", rows: await workReach(deps, graph, task) };
  } catch (e) {
    const retry = retryable(e);
    try {
      const r = (await deps.rpc("cockpit_meta_ad_days_fail", {
        p: { taskId: task.id, leaseToken: task.leaseToken, error: sentence(e).slice(0, 500), retry },
      })) as Row | null;
      return { state: isRow(r) && r.state === "pending" ? "retry" : "failed", rows: 0 };
    } catch {
      // The lease was lost or the database did not answer: the task goes back to the queue when its lease runs out.
      return { state: "retry", rows: 0 };
    }
  }
}

/** Every ad-day of one account over the task's days; a span Meta cannot build is read in halves, down to one day. */
export async function readDays(graph: GraphDeps, deps: Pick<RunDeps, "sleep">, accountId: string, span: Span) {
  const queue: Span[] = [span];
  const rows = [];
  let splits = 0;
  const retried = new Set<string>();
  while (queue.length) {
    const piece = queue.shift() as Span;
    let raw: Row[];
    try {
      raw = await metaPages(graph, `act_${accountId}/insights`, {
        level: "ad",
        time_increment: 1,
        time_range: JSON.stringify({ since: piece.since, until: piece.until }),
        use_unified_attribution_setting: "true",
        fields: DAY_FIELDS,
        limit: 500,
      });
    } catch (e) {
      if (e instanceof MetaError && e.kind === "heavy") {
        const h = halves(piece);
        if (h) {
          splits += 1;
          queue.unshift(...h);
          continue;
        }
        const key = `${piece.since}|${piece.until}`;
        if (!retried.has(key)) {
          retried.add(key);
          await deps.sleep(2000);
          queue.unshift(piece);
          continue;
        }
      }
      throw e;
    }
    for (const r of raw) rows.push(parseAdDay(r, accountId));
  }
  return { rows: dedupe(rows), splits };
}

async function workDays(deps: RunDeps, graph: GraphDeps, task: Task): Promise<number> {
  if (!task.since || !task.until) throw new Error("A day task came without its days.");
  const { rows, splits } = await readDays(graph, deps, task.accountId, { since: task.since, until: task.until });
  const fetchedAt = new Date(deps.now()).toISOString();
  const payload = rows.map(toApplyRow);
  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < payload.length; i += APPLY_CHUNK) chunks.push(payload.slice(i, i + APPLY_CHUNK));
  if (!chunks.length) chunks.push([]);
  const note = splits ? `Read in ${splits + 1} pieces: Meta could not build ${task.since} to ${task.until} in one go.` : null;
  for (let i = 0; i < chunks.length; i++) {
    await deps.rpc("cockpit_meta_ad_days_apply", {
      p: { taskId: task.id, leaseToken: task.leaseToken, fetchedAt, rows: chunks[i], final: i === chunks.length - 1, note },
    });
  }
  return rows.length;
}

async function readReachLevel(graph: GraphDeps, accountId: string, level: Level, windows: Window[]): Promise<Row[]> {
  const fields = `${level}_id,impressions,reach`;
  try {
    return await metaPages(graph, `act_${accountId}/insights`, {
      level,
      time_ranges: JSON.stringify(windows.map(w => ({ since: w.from, until: w.to }))),
      fields,
      limit: 500,
    });
  } catch (e) {
    if (!(e instanceof MetaError && e.kind === "heavy") || windows.length < 2) throw e;
    // One window at a time when the five together are too heavy.
    const out: Row[] = [];
    for (const w of windows) {
      out.push(...(await metaPages(graph, `act_${accountId}/insights`, { level, time_range: JSON.stringify({ since: w.from, until: w.to }), fields, limit: 500 })));
    }
    return out;
  }
}

async function workReach(deps: RunDeps, graph: GraphDeps, task: Task): Promise<number> {
  if (!task.windows.length) throw new Error("A reach task came without its windows.");
  const levels: Level[] = task.kind === "reach_account" ? ["account"] : REACH_LEVELS;
  let total = 0;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const raw = await readReachLevel(graph, task.accountId, level, task.windows);
    const rows = parseReach(raw, level, task.windows, task.accountId);
    total += rows.length;
    await deps.rpc("cockpit_meta_reach_apply", {
      p: {
        taskId: task.id,
        leaseToken: task.leaseToken,
        level,
        computedAt: new Date(deps.now()).toISOString(),
        rows: rows.map(r => ({ key: r.key, window_key: r.windowKey, reach: r.reach, impressions: r.impressions })),
        final: i === levels.length - 1,
      },
    });
  }
  return total;
}

// ---------------------------------------------------------------- doctor

/** Reads only (and its call receipts): the secrets by name, the token, the version, the edges, the ties, the last runs. */
export async function runDoctor(deps: RunDeps): Promise<Record<string, unknown>> {
  const graph = graphFor(deps, null);
  const secrets = deps.secrets ? deps.secrets() : {};
  const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  const notes: string[] = [];
  let ok = missing.length === 0;
  if (missing.length) notes.push(`Missing function secrets: ${missing.join(", ")}.`);
  let who: string | null = null;
  let spending: Account[] = [];
  let listed = 0;
  if (deps.token().trim()) {
    try {
      const me = await metaGet(graph, "me", { fields: "id,name" });
      who = typeof me.name === "string" ? me.name : typeof me.id === "string" ? me.id : null;
      const today = zonedDay(deps.now(), "Asia/Kuwait");
      const found = await discoverAccounts(graph, discoveryWindow("hourly", deps.now()));
      spending = found.accounts;
      listed = found.listed;
      notes.push(`Graph ${GRAPH_VERSION} answers as ${who ?? "the system user"}; ${listed} ad accounts are listed under business ${MAHARA_BUSINESS_ID} and ${spending.length} spent around ${today}.`);
    } catch (e) {
      ok = false;
      notes.push(sentence(e));
    }
  } else {
    ok = false;
    if (!missing.includes("META_SYSTEM_TOKEN")) notes.push("META_SYSTEM_TOKEN is not set on meta-ad-days.");
  }
  let inputs: Row | null = null;
  let status: Row | null = null;
  try {
    inputs = (await deps.rpc("cockpit_meta_ad_days_inputs", { p: { accountIds: spending.map(a => a.accountId) } })) as Row | null;
    status = (await deps.rpc("cockpit_meta_ad_days_status", {})) as Row | null;
  } catch (e) {
    ok = false;
    notes.push(`The database did not answer: ${sentence(e)}`);
  }
  const ties = isRow(inputs?.ties) ? (inputs?.ties as Row) : null;
  if (ties?.source !== "board_clients") {
    notes.push(
      ties?.source === "empty"
        ? "cockpit_board_clients has no rows yet, so no account is tied to a client; reach is kept at account level."
        : "cockpit_board_clients does not exist yet, so no account is tied to a client; reach is kept at account level.",
    );
  }
  const notLinked = Array.isArray(inputs?.notLinked) ? (inputs?.notLinked as Row[]) : [];
  if (ties?.source === "board_clients" && notLinked.length) {
    notes.push(`Not linked to a client: ${notLinked.map(a => `${a.name ?? a.accountId} (${a.accountId})`).join(", ")}.`);
  }
  const result = {
    ok,
    job: "doctor",
    graphVersion: GRAPH_VERSION,
    secrets,
    systemUser: who,
    accountsListed: listed,
    accountsSpending: spending.map(accountRow),
    ties,
    notLinked,
    status,
    note: notes.join(" ") || "Ready.",
  };
  try {
    await record(deps, "doctor", ok, result.note, "doctor", { accountsSpending: spending.length, notLinked: notLinked.length });
  } catch {
    // The answer itself says what the doctor found; the database line is a convenience.
  }
  return result;
}
