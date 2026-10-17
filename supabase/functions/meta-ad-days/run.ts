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
 * The nightly run also reads, per account, the lead ids of its ads with form
 * leads in the last 31 days (GET <ad>/leads?fields=id,created_time: ids and
 * times only, never a name, phone or answer), so the board can say how many
 * Meta leads never became a CRM contact (cockpit_meta_leads_not_in_crm).
 *
 * Budgets (2026-10-17, the CEO: "the daily budget of all the campaigns in the
 * account and then how much is actually being spent"): the hourly run adds one
 * budgets task per account that spent or is tied to an Active client (the
 * database answers which, cockpit_meta_ad_days_inputs activeAccounts), which
 * waits 5 minutes so it lands after the :07 burst of other readers. It reads
 * GET act_<id>/campaigns once, with the ad sets and their ads' statuses
 * nested (parse.ts parseBudgets), and hands the rows to
 * cockpit_meta_budgets_apply. The nightly run (14 days) and a backfill (its
 * days) add one activities task per such account: the same campaigns read
 * for the live state, then GET act_<id>/activities over the days and up to
 * now, rebuilt backwards into each day's budget (history.ts) for
 * cockpit_meta_budget_history_apply.
 *
 * A days task also looks up the destination of its lead-campaign ad sets
 * (one act_<id>/adsets read per 50 of them; none when the account has no lead
 * campaign), so a WhatsApp or Messenger lead ad set's messaging leads never
 * count as form leads (parse.ts withDestinations).
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
import { type Account, discoverAccounts, INTERNAL_ACCOUNT_IDS } from "./accounts.ts";
import { type InsertReceipt, NOT_RETRIED, type Rpc, RpcError } from "./db.ts";
import { discoveryWindow, halves, historySpan, type JobKind, knownZone, MAX_BACKFILL_DAYS, type Span, spansFor, zonedDay } from "./days.ts";
import { ACTIVITY_FIELDS, parseActivities, rebuildBudgetHistory, toHistoryApplyRow } from "./history.ts";
import { GRAPH_VERSION, type GraphDeps, MAHARA_BUSINESS_ID, MetaError, metaGet, metaPages, type Row } from "./graph.ts";
import {
  type AdDayRow,
  DAY_FIELDS,
  dedupe,
  leadAdsetIds,
  type Level,
  ParseError,
  parseAdDay,
  parseDestinations,
  parseReach,
  REACH_LEVELS,
  toApplyRow,
  parseLeadIds,
  type LeadIdRow,
  type Window,
  windowSpans,
  withDestinations,
  type AccountSnapshot,
  BUDGET_FIELDS,
  CAMPAIGN_STATUSES,
  currencyOffset,
  minorUnits,
  noOffsetSentence,
  parseBudgets,
  toBudgetApplyRow,
} from "./parse.ts";

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
  kind: "days" | "reach_account" | "reach_all" | "lead_ids" | "budgets" | "activities";
  accountId: string;
  accountName: string | null;
  currency: string | null;
  timezone: string | null;
  since: string | null;
  until: string | null;
  windows: Window[];
  /** A lead_ids task's ads. */
  adIds: string[];
  /** A budgets or activities task's account as the business listing gave it (Meta's minor units). */
  accountState: { status: number | null; disableReason: number | null; spendCap: string | null; amountSpent: string | null; readAt: string | null } | null;
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
  if (e instanceof RpcError) return e.code !== "22023" && e.code !== "42501" && !NOT_RETRIED.has(e.code ?? "");
  return !(e instanceof ParseError);
}

async function record(deps: RunDeps, job: string, ok: boolean, note: string, requestedBy: string, detail: Record<string, unknown> = {}) {
  await deps.rpc("cockpit_meta_ad_days_record", { p: { job, ok, note: note.slice(0, 500), requestedBy, detail } });
}

function accountRow(a: Account) {
  return { accountId: a.accountId, name: a.name, currency: a.currency, timezone: a.timezone, status: a.status, spend: Math.round(a.spend * 100) / 100, edge: a.edge };
}

/** An account whose budgets a run reads: as the business listing gave it, when. */
function budgetAccountRow(a: Account, readAt: string) {
  return { ...accountRow(a), disableReason: a.disableReason, spendCap: a.spendCap, amountSpent: a.amountSpent, readAt };
}

/** The ad accounts tied to an Active client (cockpit_meta_ad_days_inputs); empty when an older database does not say. */
function activeAccounts(inputs: Row | null): Set<string> {
  const list = Array.isArray(inputs?.activeAccounts) ? (inputs?.activeAccounts as unknown[]) : [];
  return new Set(list.filter((x): x is string => typeof x === "string" && /^[0-9]{5,25}$/.test(x)));
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
  // The accounts with their names, so the "Not linked" list can name them; and
  // which accounts are tied to an Active client, whose budgets are read even
  // when they spent nothing. A database that does not answer leaves the
  // budgets to the accounts that spent; the run itself goes on.
  let inputs: Row | null = null;
  try {
    inputs = (await deps.rpc("cockpit_meta_ad_days_inputs", { p: { accounts } })) as Row | null;
  } catch (e) {
    if (job.dryRun) throw e;
  }
  const active = activeAccounts(inputs);
  const readAt = new Date(deps.now()).toISOString();
  const wanted = found.all.filter(a => a.spend > 0 || active.has(a.accountId));
  const listedIds = new Set(found.all.map(a => a.accountId));
  // Tied to an Active client but not on Mahara's business edges: named in the run's note, never read.
  const budgetUnlisted = [...active]
    .filter(id => !listedIds.has(id) && !found.internal.includes(id) && !INTERNAL_ACCOUNT_IDS.has(id) && (!only || only.has(id)))
    .sort();
  const budgetAccounts = kind === "hourly" ? wanted.map(a => budgetAccountRow(a, readAt)) : [];
  const activityAccounts =
    kind === "hourly"
      ? []
      : wanted.map(a => ({ ...budgetAccountRow(a, readAt), ...historySpan(kind, startedAt, a.timezone && knownZone(a.timezone) ? a.timezone : "Asia/Kuwait", days) }));
  if (job.dryRun) {
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
      budgetAccounts: budgetAccounts.length,
      historyAccounts: activityAccounts.length,
      budgetUnlisted,
      note: `${accounts.length} ad accounts spent between ${window.since} and ${window.until}; ${tasks.length} reads of up to 7 days are planned.${
        budgetAccounts.length ? ` Budgets are read for ${budgetAccounts.length} accounts.` : ""
      }${activityAccounts.length ? ` Budget history is rebuilt for ${activityAccounts.length} accounts.` : ""}`,
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
      // The nightly run also reads the lead ids of the ads with form leads.
      leadIds: kind === "nightly",
      // Budgets now (hourly) and their history (nightly, backfill); an older database ignores them.
      budgetAccounts,
      activityAccounts,
      budgetUnlisted,
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
    const state = isRow(x.accountState) ? x.accountState : null;
    const digitsOf = (v: unknown) => (typeof v === "string" && /^[0-9]{1,18}$/.test(v) ? v : null);
    return {
      id: x.id,
      runId: x.runId,
      job: x.job as JobKind,
      kind: x.kind as Task["kind"],
      accountId: x.accountId,
      accountName: typeof x.accountName === "string" ? x.accountName : null,
      currency: typeof x.currency === "string" ? x.currency : null,
      timezone: typeof x.timezone === "string" ? x.timezone : null,
      accountState: state
        ? {
            status: typeof state.status === "number" ? state.status : null,
            disableReason: typeof state.disableReason === "number" ? state.disableReason : null,
            spendCap: digitsOf(state.spendCap),
            amountSpent: digitsOf(state.amountSpent),
            readAt: typeof state.readAt === "string" ? state.readAt : null,
          }
        : null,
      since: typeof x.since === "string" ? x.since : null,
      until: typeof x.until === "string" ? x.until : null,
      windows,
      adIds: Array.isArray(x.adIds) ? x.adIds.filter((a): a is string => typeof a === "string" && /^[0-9]{5,25}$/.test(a)) : [],
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
    if (task.kind === "lead_ids") return { state: "done", rows: await workLeadIds(deps, graph, task) };
    if (task.kind === "budgets") return { state: "done", rows: await workBudgets(deps, graph, task) };
    if (task.kind === "activities") return { state: "done", rows: await workActivities(deps, graph, task) };
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

/** Every ad set status Meta lets the edge list (a deleted one it refuses to list at all: code 100/1815001). */
const ADSET_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "CAMPAIGN_PAUSED",
  "ARCHIVED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
];
const ADSETS_PER_READ = 50;

/** The destination of each lead-campaign ad set in `rows`, 50 ids a read; no read when there is none. */
export async function readDestinations(graph: GraphDeps, accountId: string, rows: AdDayRow[]): Promise<Map<string, string | null>> {
  const ids = leadAdsetIds(rows);
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += ADSETS_PER_READ) {
    const chunk = ids.slice(i, i + ADSETS_PER_READ);
    const raw = await metaPages(graph, `act_${accountId}/adsets`, {
      fields: "id,destination_type",
      filtering: JSON.stringify([{ field: "id", operator: "IN", value: chunk }]),
      effective_status: JSON.stringify(ADSET_STATUSES),
      limit: 500,
    });
    for (const [k, v] of parseDestinations(raw, chunk)) out.set(k, v);
  }
  return out;
}

async function workDays(deps: RunDeps, graph: GraphDeps, task: Task): Promise<number> {
  if (!task.since || !task.until) throw new Error("A day task came without its days.");
  const read = await readDays(graph, deps, task.accountId, { since: task.since, until: task.until });
  const { rows, unknown } = withDestinations(read.rows, await readDestinations(graph, task.accountId, read.rows));
  const splits = read.splits;
  const fetchedAt = new Date(deps.now()).toISOString();
  const payload = rows.map(toApplyRow);
  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < payload.length; i += APPLY_CHUNK) chunks.push(payload.slice(i, i + APPLY_CHUNK));
  if (!chunks.length) chunks.push([]);
  const note =
    [
      splits ? `Read in ${splits + 1} pieces: Meta could not build ${task.since} to ${task.until} in one go.` : null,
      unknown.length
        ? `Meta no longer lists lead ad set${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} (deleted), so ${unknown.length > 1 ? "their" : "its"} destination is unknown; messaging leads are left out by action type.`
        : null,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300) || null;
  for (let i = 0; i < chunks.length; i++) {
    await deps.rpc("cockpit_meta_ad_days_apply", {
      p: { taskId: task.id, leaseToken: task.leaseToken, fetchedAt, rows: chunks[i], final: i === chunks.length - 1, note },
    });
  }
  return rows.length;
}

async function readReachLevel(graph: GraphDeps, accountId: string, level: Level, windows: Window[]): Promise<Row[]> {
  const fields = `${level}_id,impressions,reach`;
  // Each span once: two windows can hold the same days (parse.ts windowSpans).
  const spans = windowSpans(windows);
  try {
    return await metaPages(graph, `act_${accountId}/insights`, {
      level,
      time_ranges: JSON.stringify(spans),
      fields,
      limit: 500,
    });
  } catch (e) {
    if (!(e instanceof MetaError && e.kind === "heavy") || spans.length < 2) throw e;
    // One span at a time when the windows together are too heavy.
    const out: Row[] = [];
    for (const span of spans) {
      out.push(...(await metaPages(graph, `act_${accountId}/insights`, { level, time_range: JSON.stringify(span), fields, limit: 500 })));
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

/** How far back an ad's leads are read: the 30-day window and a day's slack. */
export const LEAD_DAYS = 31;
const LEAD_CHUNK = 2000;

/**
 * One account's lead ids: every ad of the task, leads created in the last 31
 * days, ids and times only. An ad Meta will not show the leads of (the Page has
 * not given Mahara lead access, or the ad is gone) is counted in the task's
 * note and the rest go on; Meta's limits, Meta being slow or a refused token
 * stop the task so a later call tries again.
 */
async function workLeadIds(deps: RunDeps, graph: GraphDeps, task: Task): Promise<number> {
  const since = Math.floor(deps.now() / 1000) - LEAD_DAYS * 86_400;
  const rows: LeadIdRow[] = [];
  let closed = 0;
  let unread = 0;
  let firstUnread = "";
  for (const adId of task.adIds) {
    let raw: Row[];
    try {
      raw = await metaPages(graph, `${adId}/leads`, {
        fields: "id,created_time",
        filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
        limit: 500,
      });
    } catch (e) {
      if (e instanceof MetaError && e.kind === "permission") {
        closed += 1;
        continue;
      }
      if (e instanceof MetaError && e.kind === "other") {
        unread += 1;
        firstUnread ||= e.message.slice(0, 120);
        continue;
      }
      throw e;
    }
    rows.push(...parseLeadIds(raw, adId));
  }
  const note =
    [
      closed ? `Meta gives no lead access for ${closed} of ${task.adIds.length} ads (the Page has not given Mahara lead access).` : "",
      unread ? `${unread} ads could not be read: ${firstUnread}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300) || null;
  const fetchedAt = new Date(deps.now()).toISOString();
  const chunks = rows.length ? Array.from({ length: Math.ceil(rows.length / LEAD_CHUNK) }, (_, i) => rows.slice(i * LEAD_CHUNK, (i + 1) * LEAD_CHUNK)) : [[]];
  for (let i = 0; i < chunks.length; i++) {
    await deps.rpc("cockpit_meta_lead_ids_apply", {
      // adsUnread: the ads whose leads are not held, so the database knows a
      // client whose every lead ad is unread is unknown, never "0 not in the CRM".
      p: { taskId: task.id, leaseToken: task.leaseToken, fetchedAt, rows: chunks[i], final: i === chunks.length - 1, note, adsUnread: closed + unread },
    });
  }
  return rows.length;
}

// ---------------------------------------------------------------- budgets

/** Every campaign of an account with its ad sets and their ads' statuses, one read (smaller pages when Meta finds it heavy). */
export async function readCampaigns(graph: GraphDeps, accountId: string): Promise<Row[]> {
  const params = { fields: BUDGET_FIELDS, effective_status: JSON.stringify(CAMPAIGN_STATUSES) };
  try {
    return await metaPages(graph, `act_${accountId}/campaigns`, { ...params, limit: 100 });
  } catch (e) {
    if (!(e instanceof MetaError && e.kind === "heavy")) throw e;
    return await metaPages(graph, `act_${accountId}/campaigns`, { ...params, limit: 20 });
  }
}

/** The task's currency offset, or the sentence that refuses the account (never 100 by default). */
function offsetFor(task: Task): number {
  const offset = currencyOffset(task.currency);
  if (offset === null) throw new ParseError(noOffsetSentence(task.accountId, task.currency));
  return offset;
}

/** The account as the business listing gave it: spend_cap "0" is no limit. */
function accountSnapshot(task: Task): AccountSnapshot {
  const s = task.accountState;
  return {
    status: s?.status ?? null,
    disableReason: s?.disableReason ?? null,
    spendCap: minorUnits(s?.spendCap ?? null, "the spending limit"),
    amountSpent: minorUnits(s?.amountSpent ?? null, "the amount spent", false),
  };
}

/** One account's budgets now: one read, one write (cockpit_meta_budgets_apply). */
async function workBudgets(deps: RunDeps, graph: GraphDeps, task: Task): Promise<number> {
  const offset = offsetFor(task);
  const account = accountSnapshot(task);
  const raw = await readCampaigns(graph, task.accountId);
  const nowMs = deps.now();
  const fetchedAt = new Date(nowMs).toISOString();
  const { rows } = parseBudgets(raw, { account, offset, nowMs });
  const campaigns = rows.filter(r => r.level === "campaign");
  const on = campaigns.filter(r => r.switchedOn);
  const note = `${on.length} of ${campaigns.length} campaigns switched on, ${campaigns.filter(r => r.delivering).length} delivering.`;
  await deps.rpc("cockpit_meta_budgets_apply", {
    p: {
      taskId: task.id,
      leaseToken: task.leaseToken,
      fetchedAt,
      currency: task.currency,
      currencyOffset: offset,
      account: {
        status: account.status,
        disableReason: account.disableReason,
        spendCap: account.spendCap === null ? null : account.spendCap / offset,
        amountSpent: account.amountSpent === null ? null : account.amountSpent / offset,
        readAt: task.accountState?.readAt ?? fetchedAt,
      },
      rows: rows.map(r => toBudgetApplyRow(r, task.accountId)),
      note,
    },
  });
  return rows.length;
}

/** The most rows one history write takes (cockpit_meta_budget_history_apply). */
const HISTORY_ROWS = 10_000;

/**
 * One account's budget history over the task's days: the live budgets (the
 * same campaigns read), then Meta's activity log from the first day (14 hours
 * early, the earliest midnight of any clock) to now, undone back to each day.
 */
async function workActivities(deps: RunDeps, graph: GraphDeps, task: Task): Promise<number> {
  if (!task.since || !task.until) throw new Error("A budget history task came without its days.");
  const offset = offsetFor(task);
  const account = accountSnapshot(task);
  const raw = await readCampaigns(graph, task.accountId);
  const nowMs = deps.now();
  const { live } = parseBudgets(raw, { account, offset, nowMs });
  const events = await metaPages(graph, `act_${task.accountId}/activities`, {
    fields: ACTIVITY_FIELDS,
    since: Math.floor(Date.parse(`${task.since}T00:00:00Z`) / 1000) - 14 * 3600,
    until: Math.ceil(deps.now() / 1000),
    limit: 200,
  });
  const fetchedAt = new Date(deps.now()).toISOString();
  const parsed = parseActivities(events);
  const history = rebuildBudgetHistory({
    live,
    accountStatus: account.status,
    events: parsed.events,
    unreadable: parsed.unreadable,
    timezone: task.timezone && knownZone(task.timezone) ? task.timezone : "Asia/Kuwait",
    offset,
    since: task.since,
    until: task.until,
  });
  if (history.rows.length > HISTORY_ROWS) {
    throw new ParseError(`The budget history of act_${task.accountId} from ${task.since} to ${task.until} holds ${history.rows.length} campaign days; ask for fewer days.`);
  }
  await deps.rpc("cockpit_meta_budget_history_apply", {
    p: {
      taskId: task.id,
      leaseToken: task.leaseToken,
      fetchedAt,
      currency: task.currency,
      currencyOffset: offset,
      days: history.days,
      rows: history.rows.map(toHistoryApplyRow),
      note: history.note,
    },
  });
  return history.rows.length;
}

// ---------------------------------------------------------------- doctor

/**
 * Reads only (and its call receipts): the secrets by name, the token, the
 * version, the edges, the ties, the last runs; since 2026-10-17 whether
 * budgets (act_<id>/campaigns) and their history (act_<id>/activities) can be
 * read with META_SYSTEM_TOKEN on one account tied to an Active client, the
 * accounts whose budgets or history could not be read on the last run, and
 * listed accounts in a currency without Meta's offset.
 */
export async function runDoctor(deps: RunDeps): Promise<Record<string, unknown>> {
  const graph = graphFor(deps, null);
  const secrets = deps.secrets ? deps.secrets() : {};
  const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  const notes: string[] = [];
  let ok = missing.length === 0;
  if (missing.length) notes.push(`Missing function secrets: ${missing.join(", ")}.`);
  let who: string | null = null;
  let spending: Account[] = [];
  let all: Account[] = [];
  let listed = 0;
  if (deps.token().trim()) {
    try {
      const me = await metaGet(graph, "me", { fields: "id,name" });
      who = typeof me.name === "string" ? me.name : typeof me.id === "string" ? me.id : null;
      const today = zonedDay(deps.now(), "Asia/Kuwait");
      const found = await discoverAccounts(graph, discoveryWindow("hourly", deps.now()));
      spending = found.accounts;
      all = found.all;
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
    // The accounts with their names: with ids alone the "Not linked" list was always empty (2026-10-16).
    inputs = (await deps.rpc("cockpit_meta_ad_days_inputs", { p: { accounts: spending.map(accountRow) } })) as Row | null;
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
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter(isRow) as Row[]) : []);
  const hidden = list(inputs?.hidden);
  if (hidden.length) notes.push(`Hidden on purpose: ${hidden.map(a => `${a.name ?? a.accountId} (${a.accountId})`).join(", ")}.`);
  // Read by the board too (cockpit_meta_ad_days_status): spend for a client that
  // is gone, and tied accounts Meta does not let deliver (billing, disabled).
  const cancelled = list(status?.cancelledDelivering);
  if (cancelled.length) {
    notes.push(
      `Spent in the last 2 days for a cancelled or stopped client: ${cancelled
        .map(a => `${a.name ?? a.accountId} (${a.clientName ?? "?"}, ${a.clientStatus ?? "?"})`)
        .join(", ")}. Switch its ads off or confirm the client is back.`,
    );
  }
  const stopped = list(status?.billingStopped);
  if (stopped.length) {
    notes.push(
      `Meta stops delivery on: ${stopped
        .map(a => `${a.name ?? a.accountId} (${a.clientName ?? "?"}, ${a.statusLabel ?? a.status}${a.lastSpendDay ? `, last spend ${a.lastSpendDay}` : ""})`)
        .join(", ")}. Client success asks the client to settle billing.`,
    );
  }
  // Budgets and their history, with the function's own token, on one account tied to an Active client.
  const active = activeAccounts(inputs);
  const probe = who === null ? null : (all.find(a => active.has(a.accountId)) ?? spending[0] ?? all[0] ?? null);
  let budgetsReadable: boolean | null = null;
  let historyReadable: boolean | null = null;
  if (probe) {
    const label = `${probe.name ?? probe.accountId} (${probe.accountId})`;
    try {
      await metaGet(graph, `act_${probe.accountId}/campaigns`, { fields: "id,daily_budget", limit: 1 });
      budgetsReadable = true;
    } catch (e) {
      budgetsReadable = false;
      ok = false;
      notes.push(`Budgets cannot be read with META_SYSTEM_TOKEN on ${label}: ${sentence(e)}`);
    }
    const nowSec = Math.floor(deps.now() / 1000);
    try {
      await metaGet(graph, `act_${probe.accountId}/activities`, { fields: "event_type,event_time", since: nowSec - 7 * 86_400, until: nowSec, limit: 1 });
      historyReadable = true;
    } catch (e) {
      historyReadable = false;
      notes.push(`The budget history (Meta's activity log) cannot be read with META_SYSTEM_TOKEN on ${label}: ${sentence(e)} The history then starts the day budgets were first read.`);
    }
    if (budgetsReadable && historyReadable) notes.push(`Budgets and their history can be read with META_SYSTEM_TOKEN (checked on ${label}).`);
  }
  const budgets = isRow(status?.budgets) ? (status?.budgets as Row) : null;
  const named = (rows: Row[]) => rows.map(a => `${a.name ?? a.accountId} (${a.accountId}): ${String(a.error ?? "not read").slice(0, 160)}`).join("; ");
  const budgetsFailing = list(budgets?.failing);
  if (budgetsFailing.length) notes.push(`Budgets could not be read on the last run for ${named(budgetsFailing)}.`);
  const historyFailing = list(budgets?.historyFailing);
  if (historyFailing.length) notes.push(`The budget history could not be read on the last run for ${named(historyFailing)}.`);
  const noOffset = all.filter(a => (a.spend > 0 || active.has(a.accountId)) && currencyOffset(a.currency) === null);
  if (noOffset.length) {
    notes.push(
      `No Meta currency offset for ${noOffset.map(a => `${a.name ?? a.accountId} (${a.currency ?? "no currency"})`).join(", ")}, so their budgets are not read; add the currency to CURRENCY_OFFSETS in parse.ts.`,
    );
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
    budgetsReadable,
    historyReadable,
    budgetsCheckedOn: probe?.accountId ?? null,
    status,
    note: notes.join(" ") || "Ready.",
  };
  try {
    await record(deps, "doctor", ok, result.note, "doctor", {
      accountsSpending: spending.length,
      notLinked: notLinked.length,
      budgetsReadable,
      historyReadable,
      budgetsFailing: budgetsFailing.length,
    });
  } catch {
    // The answer itself says what the doctor found; the database line is a convenience.
  }
  return result;
}
