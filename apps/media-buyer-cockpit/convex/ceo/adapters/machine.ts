import { internal } from "../../_generated/api";
import type { MachinePayload, Note } from "../payloads";
import { B2B, num, type Row, sql, TRIAGE } from "../sb";
import { KUWAIT_OFFSET_MS, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

// biome-ignore lint/suspicious/noExplicitAny: internal query rows
type Any = any;

type Feed = MachinePayload["feeds"][number];

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Error text is written by outside systems, so mask anything that could be a
 * person or a secret before it is stored: emails (also cut ones), bearer and
 * query-string secrets, phone-like digit runs and long opaque tokens.
 */
const redact = (s: string) =>
  s
    .replace(/[^\s"'<>(),;]+@[^\s"'<>(),;]*/g, "[email]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [hidden]")
    .replace(
      /\b(access_token|token|api_?key|key|secret|password|signature|sig)=[^&\s"']+/gi,
      "$1=[hidden]",
    )
    .replace(/\+\d[\d\s-]{6,}\d|\b\d{8,}\b/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[hidden]");

const errText = (e: unknown) =>
  redact(String(e instanceof Error ? e.message : e)).slice(0, 160);

/** A source's error text, masked, without the dangling ": " some sync functions leave. */
const tidy = (x: unknown, fallback: string) =>
  redact(String(x ?? ""))
    .replace(/[\s:;,.-]+$/, "")
    .slice(0, 160) || fallback;

/** sync_state statuses that mean the feed works (the dashboard's b2b_sync_health uses the same list). */
const B2B_OK_STATUSES = new Set([
  "success",
  "partial",
  "success_no_attribution",
  "running",
]);

/** Epoch ms computed in SQL (Postgres "+00" and "+03" timestamps do not parse in JS). */
const epoch = (x: unknown): number | null =>
  x === null || x === undefined || x === "" ? null : num(x) || null;

/** "2026-09-15 12:40" on the Kuwait clock. */
const kuwaitStamp = (at: number) =>
  `${kuwaitDay(at)} ${new Date(at + KUWAIT_OFFSET_MS).toISOString().slice(11, 16)}`;

/**
 * Creative Triage's instance drops about half of management API connections
 * when it is degraded, so a read gets two more tries before it counts as down.
 * Only a quick failure is retried: a read that hung until a timeout would hang
 * again, and every section refreshes inside one action with a time limit.
 */
async function sqlRetry(project: string, query: string): Promise<Row[]> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      return await sql(project, query);
    } catch (e) {
      if (attempt >= 2 || Date.now() - started > 30_000) throw e;
      await wait((attempt + 1) * 3_000);
    }
  }
}

/** Values a cron field allows: "*", "7,22,37,52", "*\/15", "7-15/2". Null when unreadable. */
function cronField(field: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[3] ? Number(m[3]) : 1;
    const from = m[1] === undefined ? lo : Number(m[1]);
    const to =
      m[1] === undefined
        ? hi
        : m[2] !== undefined
          ? Number(m[2])
          : m[3]
            ? hi
            : from;
    if (step < 1 || from < lo || to > hi || from > to) return null;
    for (let x = from; x <= to; x += step) out.add(x);
  }
  return out;
}

/**
 * The longest wait in minutes between two runs of a pg_cron schedule, found
 * by walking one week minute by minute. "*\/30 7-15 * * *" is 930 (the night),
 * not 30. Null for day-of-month or month schedules and pg_cron's "30 seconds".
 */
export function cronGapMin(schedule: unknown): number | null {
  const f = String(schedule ?? "")
    .trim()
    .split(/\s+/);
  if (f.length !== 5 || f[2] !== "*" || f[3] !== "*") return null;
  const mins = cronField(f[0], 0, 59);
  const hours = cronField(f[1], 0, 23);
  const days = cronField(f[4], 0, 7);
  if (!mins?.size || !hours?.size || !days?.size) return null;
  if (days.has(7)) days.add(0);
  const WEEK = 7 * 1440;
  const runs: number[] = [];
  for (let t = 0; t < WEEK; t++)
    if (
      days.has(Math.floor(t / 1440)) &&
      hours.has(Math.floor(t / 60) % 24) &&
      mins.has(t % 60)
    )
      runs.push(t);
  if (!runs.length) return null;
  let gap = runs[0] + WEEK - runs[runs.length - 1];
  for (let i = 1; i < runs.length; i++)
    gap = Math.max(gap, runs[i] - runs[i - 1]);
  return gap;
}

/**
 * How far behind a feed may be before it counts as not ok: three runs, but
 * never more than one day past a run, so a weekly feed that misses its run
 * shows the next day instead of three weeks later.
 */
const allowedLagMin = (gapMin: number) => Math.min(3 * gapMin, gapMin + 1440);

/**
 * The live B2B feeds: one sync_state row per source with the account set.
 * Rows with a null account_id are orphans left by runs whose account lookup
 * came back empty (unique (source, account_id) lets nulls repeat); they are
 * what makes the dashboard's own b2b_sync_health say "stale". every_min is
 * the fallback when the cron schedule cannot be read.
 */
const B2B_FEEDS_SQL = `
with expected(source, label, job, every_min) as (values
  ('meta', 'Meta ads', 'b2b-meta-sync', 15),
  ('ghl_calls', 'GHL calls', 'b2b-ghl-calls-sync', 15),
  ('leads', 'GHL leads', 'b2b-leads-sync', 15),
  ('typeform', 'Closed deal form', 'b2b-typeform-sync', 15),
  ('typeform_eod', 'EOD forms', 'b2b-typeform-eod-sync', 15),
  ('maqsam_calls', 'Maqsam calls', 'b2b-maqsam-calls-sync', 15),
  ('fathom_calls', 'Fathom calls', 'b2b-fathom-calls-sync', 15),
  ('whop_payments', 'Whop payments', 'b2b-whop-payments-sync', 15),
  ('assets_wistia', 'Wistia assets', 'b2b-assets-wistia-sync', 1440),
  ('assets_web', 'Website assets', 'b2b-assets-web-sync', 10080),
  ('assets_social_youtube_mahara', 'YouTube assets', 'b2b-assets-youtube-sync', 10080),
  ('assets_social_ig_mahara', 'Instagram assets', 'b2b-assets-instagram-sync', 10080)
),
bound as (
  select distinct on (source) source, last_synced_at, last_sync_status, last_error
  from public.sync_state
  where account_id is not null
  order by source, last_synced_at desc nulls last
)
select coalesce(e.source, b.source) as source, e.label, e.every_min,
  j.schedule, j.active, j.jobid is not null as has_job,
  (extract(epoch from b.last_synced_at) * 1000)::bigint as last_success_ms,
  b.last_sync_status as status,
  case when b.last_sync_status not in ('success', 'partial', 'success_no_attribution', 'running')
    then left(b.last_error, 400) end as error
from expected e
full join bound b on b.source = e.source
left join cron.job j
  on j.jobname = coalesce(e.job, 'b2b-' || replace(b.source, '_', '-') || '-sync')
order by 1`;

/**
 * Creative Triage pg_cron jobs: the latest run, the latest succeeded run and
 * when the current failure streak began, through runid index lookups (the
 * instance hangs on parallel plans when degraded), plus one pass over the
 * last 24 hours for run counts. That pass is bounded to the newest 5,000 runs
 * through the runid key (about 150 runs a day today): the run log has no
 * other index and a full scan turns parallel once it passes 8 MB. Never select
 * cron.job.command: it can carry a bearer secret.
 */
const TRIAGE_JOBS_SQL = `
select j.jobname, j.schedule,
  last.status as last_status,
  (extract(epoch from last.start_time) * 1000)::bigint as last_run_ms,
  case when last.status = 'failed' then left(last.return_message, 400) end as last_error,
  (extract(epoch from ok.start_time) * 1000)::bigint as last_ok_ms,
  (extract(epoch from streak.first_fail) * 1000)::bigint as failing_since_ms,
  coalesce(day.failed, 0) as failed_24h,
  coalesce(day.runs, 0) as runs_24h
from cron.job j
left join lateral (
  select d.status, d.start_time, d.return_message
  from cron.job_run_details d
  where d.jobid = j.jobid
  order by d.runid desc
  limit 1
) last on true
left join lateral (
  select d.runid, d.start_time
  from cron.job_run_details d
  where d.jobid = j.jobid and d.status = 'succeeded'
  order by d.runid desc
  limit 1
) ok on true
left join lateral (
  select min(d.start_time) as first_fail
  from cron.job_run_details d
  where d.jobid = j.jobid and d.status = 'failed' and d.runid > coalesce(ok.runid, 0)
) streak on last.status = 'failed'
left join (
  select jobid, count(*) as runs, count(*) filter (where status = 'failed') as failed
  from cron.job_run_details
  where runid > (select max(runid) - 5000 from cron.job_run_details)
    and start_time > now() - interval '24 hours'
  group by jobid
) day on day.jobid = j.jobid
where j.active
order by j.jobname`;

/** Plain names for the Creative Triage jobs; an unknown job gets a tidied job name. */
const TRIAGE_LABELS: Record<string, string> = {
  "mahara-ghl-leads": "Client leads (GHL)",
  "mahara-ghl-leads-reconcile": "Client leads nightly reconcile (GHL)",
  "mahara-ghl-appointments": "Client appointments (GHL)",
  "mahara-appointment-outcomes-sync": "Appointment outcomes (stat sheets)",
  "mahara-ghl-pipelines": "Client pipelines (GHL)",
  "mahara-sync-business": "Client ad spend (daytime)",
  "mahara-sync-overnight": "Client ad spend (overnight)",
  "mahara-sync-client-config": "Client roster (Client Data sheet)",
  "mahara-provision-client-panels": "Client panel provisioning",
};

/** "mahara-sync-activities" as "Sync activities". */
const triageJobName = (job: string) => {
  const words = job.replace(/^mahara-/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The machine behind the numbers: scheduled jobs, data sources and Hermes. */
export const machine: Adapter = {
  key: "machine",
  label: "Machine and data trust",
  compute: async ctx => {
    const [jobs, sources, stale, hermes]: Any[] = await Promise.all([
      ctx.runQuery(internal.health.jobs, {}),
      ctx.runQuery(internal.health.sources, {}),
      ctx.runQuery(internal.health.staleJobs, {}),
      ctx.runQuery(internal.askAi.health, {}),
    ]);
    const now = Date.now();
    const sync = (jobs as Any[]).find(j => j.job === "sync");
    const failing = (jobs as Any[]).filter(j => !j.ok);
    const badSources = (sources as Any[]).filter(s => s.ok === false);
    const notes: Note[] = [];
    const stamps: SourceStamp[] = [
      { name: "Cockpit health ledger", freshestAt: sync?.at, ok: true },
    ];

    if (failing.length)
      notes.push({
        level: "warn",
        text: `Cockpit jobs failing: ${failing.map(j => j.job).join(", ")}.`,
      });
    if ((stale as Any[]).length)
      notes.push({
        level: "warn",
        text: `Cockpit jobs overdue: ${(stale as Any[]).map(j => (j.minutes === undefined ? `${j.job} (never ran)` : `${j.job} (${j.minutes} min)`)).join(", ")}.`,
      });
    if (badSources.length)
      notes.push({
        level: "warn",
        text: `Cockpit data sources failing: ${badSources.map(s => s.label ?? s.source).join(", ")}.`,
      });

    // --- B2B feeds (secondary: the Convex ledger still shows if Supabase is down).
    const feeds: Feed[] = [];
    let feedsComplete = true;
    try {
      const rows = await sqlRetry(B2B, B2B_FEEDS_SQL);
      let freshest: number | undefined;
      for (const r of rows) {
        const lastSuccessAt = epoch(r.last_success_ms);
        const lagMin =
          lastSuccessAt === null
            ? null
            : Math.max(0, Math.round((now - lastSuccessAt) / 60_000));
        const gap = cronGapMin(r.schedule) ?? (num(r.every_min) || null);
        const known = r.label !== null && r.label !== undefined;
        let error: string | undefined;
        if (r.status && !B2B_OK_STATUSES.has(String(r.status)))
          error = tidy(r.error, `Sync status ${r.status}`);
        else if (lastSuccessAt === null) error = "Never synced";
        else if (known && !r.has_job) error = "No scheduled job";
        else if (r.has_job && r.active === false)
          error = "Scheduled job is paused";
        const late =
          lagMin !== null && gap !== null && lagMin > allowedLagMin(gap);
        if (!error && late) error = "Missed its scheduled runs";
        if (lastSuccessAt !== null)
          freshest = Math.max(freshest ?? 0, lastSuccessAt);
        feeds.push({
          name: String(r.label ?? r.source),
          project: "b2b",
          lastSuccessAt,
          lagMin,
          ok: !error,
          ...(error ? { error: error.slice(0, 160) } : {}),
        });
      }
      stamps.push({ name: "B2B sync state", freshestAt: freshest, ok: true });
      for (const f of feeds.filter(x => x.project === "b2b" && !x.ok))
        notes.push({
          level: "warn",
          text:
            f.lastSuccessAt === null
              ? `B2B feed ${f.name}: ${f.error}.`
              : `B2B feed ${f.name}: ${f.error}. Last successful sync ${kuwaitStamp(f.lastSuccessAt)} Kuwait time.`,
        });
    } catch (e) {
      feedsComplete = false;
      stamps.push({ name: "B2B sync state", ok: false, note: errText(e) });
      notes.push({
        level: "warn",
        text: "B2B feed health could not be read, so B2B feeds are missing below.",
      });
    }

    // --- Creative Triage scheduled jobs (secondary, often slow when degraded).
    let triageFailed24h = 0;
    try {
      const rows = await sqlRetry(TRIAGE, TRIAGE_JOBS_SQL);
      const failingJobs: {
        name: string;
        since: number | null;
        error: string;
      }[] = [];
      let lastRun: number | undefined;
      for (const r of rows) {
        const lastSuccessAt = epoch(r.last_ok_ms);
        const lagMin =
          lastSuccessAt === null
            ? null
            : Math.max(0, Math.round((now - lastSuccessAt) / 60_000));
        const gap = cronGapMin(r.schedule);
        const name =
          TRIAGE_LABELS[r.jobname] ?? triageJobName(String(r.jobname));
        let error: string | undefined;
        if (r.last_status === "failed")
          error = tidy(r.last_error, "Run failed");
        else if (lastSuccessAt === null) error = "No successful run on record";
        else if (lagMin !== null && gap !== null && lagMin > allowedLagMin(gap))
          error = "Missed its scheduled runs";
        if (r.last_status === "failed")
          failingJobs.push({
            name,
            since: epoch(r.failing_since_ms),
            error: tidy(r.last_error, "Run failed"),
          });
        const ran = epoch(r.last_run_ms);
        if (ran !== null) lastRun = Math.max(lastRun ?? 0, ran);
        triageFailed24h += num(r.failed_24h);
        feeds.push({
          name,
          project: "triage",
          lastSuccessAt,
          lagMin,
          ok: !error,
          ...(error ? { error: error.slice(0, 160) } : {}),
        });
      }
      stamps.push({
        name: "Creative Triage scheduled jobs",
        freshestAt: lastRun,
        ok: true,
      });

      if (failingJobs.length) {
        const starts = failingJobs
          .map(j => j.since)
          .filter((x): x is number => x !== null);
        // Streaks start at different times (a job can succeed once mid-outage), so name the longest.
        const one = failingJobs.length === 1;
        const since = starts.length
          ? `${one ? " since" : ", the longest since"} ${kuwaitStamp(Math.min(...starts))} Kuwait time`
          : "";
        const errors = [...new Set(failingJobs.map(j => j.error))];
        const all = failingJobs.length === rows.length;
        const which = all
          ? `All ${rows.length} Creative Triage scheduled jobs are`
          : `${failingJobs.length} of ${rows.length} Creative Triage scheduled jobs (${failingJobs.map(j => j.name).join(", ")}) ${one ? "is" : "are"}`;
        // With every job down, client leads, bookings and spend all freeze.
        const impact = all
          ? " Client leads, appointments and ad spend from Creative Triage are not updating."
          : "";
        notes.push({
          level: "warn",
          text: `${which} failing${since}. ${triageFailed24h} failed run${triageFailed24h === 1 ? "" : "s"} in the last 24 hours. Last error: ${errors.slice(0, 2).join("; ")}.${impact}`,
        });
      } else if (triageFailed24h > 0)
        notes.push({
          level: "info",
          text: `Creative Triage scheduled jobs are running again after ${triageFailed24h} failed run${triageFailed24h === 1 ? "" : "s"} in the last 24 hours.`,
        });
      notes.push({
        level: "info",
        text: "A succeeded Creative Triage job run means the sync call went out, not that the sync itself worked.",
      });
    } catch (e) {
      feedsComplete = false;
      stamps.push({
        name: "Creative Triage scheduled jobs",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: "Creative Triage scheduled jobs could not be read, so they are missing below.",
      });
    }

    const today = kuwaitDay(now);
    const daily: DailyPoint[] = [
      {
        date: today,
        metric: "machine.failingJobs",
        scope: "company",
        value: failing.length,
      },
    ];
    // A partial feed list would undercount, so that day keeps its last full reading.
    if (feedsComplete)
      daily.push({
        date: today,
        metric: "machine.failingFeeds",
        scope: "company",
        value: feeds.filter(f => !f.ok).length,
      });

    const payload = {
      syncAgeMin: sync?.at ? Math.round((now - sync.at) / 60_000) : null,
      jobs: (jobs as Any[]).map(j => ({
        job: j.job,
        ok: j.ok,
        at: j.at,
        everyMin: j.everyMin,
        streak: j.streak,
        error: j.error ? redact(String(j.error)).slice(0, 200) : undefined,
      })),
      failingJobs: failing.length,
      staleJobs: (stale as Any[]).length,
      sources: (sources as Any[]).map(s => ({
        source: s.source ?? s.key,
        // A source with no health reading yet has ok undefined; like failingSources, it is not failing.
        ok: s.ok !== false,
        lastOkAt: s.lastOkAt,
        lastError: s.lastError
          ? redact(String(s.lastError)).slice(0, 200)
          : undefined,
      })),
      failingSources: badSources.length,
      hermes: {
        queued: hermes?.queued ?? 0,
        failed: hermes?.failed ?? 0,
        lastDoneAt: hermes?.lastDoneAt,
      },
      feeds,
      notes,
    } satisfies MachinePayload;

    return { payload, daily, sources: stamps };
  },
};
