import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

/**
 * The health ledger: one row per outside system the cockpits depend on.
 *
 * Aziz, 2026-09-12: "make this thing fully bulletproof … for any errors that
 * are repetitive make sure there is a fallback … if it does break it's a very
 * easy fix without me having to get involved."
 *
 * Every outbound call notes ok or fail here (see `note`, called from the
 * shared helpers in tools.ts and comms.ts). Three failures in a row raise one
 * alert with the runbook line for that system, so whoever reads it knows the
 * fix; a recovery closes it. The admin view shows the same table.
 */

// biome-ignore lint/suspicious/noExplicitAny: ledger rows
type Any = any;

export const ALERT_AFTER = 3;
const REALERT_AFTER_MS = 12 * 3600_000;

/** What to do when a system keeps failing. Plain words, no engineer needed. */
export const RUNBOOK: Record<
  string,
  { label: string; fix: string; owner: string }
> = {
  meta: {
    label: "Meta Ads (Graph API)",
    fix: "Usually a rate limit that clears by itself. If the error says the token is invalid (#190), make a new system-user token in Business Settings, then set META_SYSTEM_TOKEN on the media buyer deployment. If it says permission (#10/#200), the client has not shared the ad account with Mahara's business.",
    owner: "Aziz",
  },
  clickup: {
    label: "ClickUp",
    fix: "If 401: make a new personal API token in ClickUp (Settings, Apps) and set CLICKUP_API_TOKEN. If 429: it clears on the next run. If a list or task is 404: someone deleted or moved it; check the list ids in SOURCES.md.",
    owner: "Aziz",
  },
  sheets: {
    label: "Google Sheets",
    fix: "If 403: share the sheet with claude@studied-handler-508106-m5.iam.gserviceaccount.com (viewer is enough for reads, editor for the Client Data writes). If 429: quota; it clears within a minute. If 404: the sheet id in Client Data is wrong.",
    owner: "Client success",
  },
  docs: {
    label: "Google Docs",
    fix: "Share the document with claude@studied-handler-508106-m5.iam.gserviceaccount.com, or enable the Google Docs API on the service account's project if the error says the API is disabled.",
    owner: "Aziz",
  },
  calendar: {
    label: "Google Calendar",
    fix: "The person shares their calendar with claude@studied-handler-508106-m5.iam.gserviceaccount.com (see all event details). If the error says the API is disabled, enable Google Calendar API on the project.",
    owner: "Each person",
  },
  ghl: {
    label: "GoHighLevel (CRM)",
    fix: "If 401 on a client: their token in Client Data, GHL API column, is wrong or revoked; make a new private integration token in that sub-account. If 401 on Mahara's own sub-account: set MAHARA_GHL_TOKEN again. If 429: clears on the next run.",
    owner: "Client success",
  },
  fathom: {
    label: "Fathom (call recordings)",
    fix: "If 401: make a new API key in Fathom settings and set FATHOM_API_KEY. Briefs already written stay; new calls wait until the key works.",
    owner: "Aziz",
  },
  slack: {
    label: "Slack",
    fix: "If channel_not_found: the channel id or the user id in ALERT_SLACK_TO is wrong. If not_authed or invalid_auth: reinstall the Slack app and set its token again.",
    owner: "Aziz",
  },
  bridge_csm: {
    label: "Client success cockpit (bridge)",
    fix: "The client success deployment is not answering. Check its Convex dashboard for a failed deploy or a schema error; redeploy with scripts/ship.sh client-success. If 401: CSM_BRIDGE_TOKEN differs from BRIDGE_TOKEN on that deployment.",
    owner: "Hermes or Aziz",
  },
  bridge_creative: {
    label: "Creative cockpit (bridge)",
    fix: "The creative deployment is not answering. Check its Convex dashboard for a failed deploy or a schema error; redeploy with scripts/ship.sh creative. If 401: CREATIVE_BRIDGE_TOKEN differs from BRIDGE_TOKEN on that deployment.",
    owner: "Hermes or Aziz",
  },
  whapi: {
    label: "WHAPI (WhatsApp)",
    fix: "The WhatsApp channel disconnected. Reconnect the number in WHAPI and set the channel token again.",
    owner: "Aziz",
  },
  resend: {
    label: "Resend (email)",
    fix: "Set RESEND_API_KEY and AUTH_EMAIL_FROM on all three deployments; the sender domain must be verified in Resend.",
    owner: "Aziz",
  },
  jobs: {
    label: "Scheduled jobs",
    fix: "A job stopped running or keeps throwing. Hermes already has a fix job with the error. If nothing changes within an hour: scripts/ship.sh media-buyer, then read the Convex logs for the job name.",
    owner: "Hermes or Aziz",
  },
  hermes: {
    label: "Hermes (AI agent)",
    fix: "Hermes has not polled for jobs. Restart the Hermes poller on its host. While it is down, chat answers, reply drafts, call briefs and report narratives wait; nothing is lost, they run when it is back.",
    owner: "Aziz",
  },
};

/** Which system a URL belongs to. */
export function sourceFor(url: string): string | undefined {
  if (/graph\.facebook\.com/.test(url)) return "meta";
  if (/api\.clickup\.com/.test(url)) return "clickup";
  if (/sheets\.googleapis\.com/.test(url)) return "sheets";
  if (/docs\.googleapis\.com/.test(url)) return "docs";
  if (/googleapis\.com\/calendar/.test(url)) return "calendar";
  if (/leadconnectorhq\.com/.test(url)) return "ghl";
  if (/api\.fathom\.ai/.test(url)) return "fathom";
  if (/slack\.com/.test(url)) return "slack";
  if (/whapi\.cloud/.test(url)) return "whapi";
  if (/api\.resend\.com/.test(url)) return "resend";
  return undefined;
}

/** A rate limit or a blip is not a system down; only count real failures. */
export function transient(status: number): boolean {
  return (
    status === 429 ||
    status === 408 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

// --- In-flight notes, flushed by the action that made the calls -------------------------

const pending = new Map<string, { ok: boolean; error?: string }>();

/**
 * Remember how a call went. The last note per source in one action wins,
 * so a retry that succeeds clears an earlier blip. Flushed by `flush(ctx)`.
 */
export function note(source: string | undefined, ok: boolean, error?: string) {
  if (!source) return;
  const prev = pending.get(source);
  // One failure in an action full of successes is still a failure worth seeing.
  if (prev && !prev.ok && ok) return;
  pending.set(source, { ok, error: error?.slice(0, 200) });
}

export async function flush(ctx: ActionCtx): Promise<void> {
  if (pending.size === 0) return;
  const entries = [...pending.entries()].map(([source, r]) => ({
    source,
    ...r,
  }));
  pending.clear();
  try {
    await ctx.runMutation(internal.health.recordMany, { entries });
  } catch (e) {
    console.error(`health flush failed: ${String(e).slice(0, 120)}`);
  }
}

/** Record straight away, from an action that already knows the outcome. */
export async function recordManyDirect(
  ctx: ActionCtx,
  entries: { source: string; ok: boolean; error?: string }[],
): Promise<void> {
  await ctx.runMutation(internal.health.recordMany, { entries });
}

// --- Ledger --------------------------------------------------------------------------------

export const recordMany = internalMutation({
  args: {
    entries: v.array(
      v.object({
        source: v.string(),
        ok: v.boolean(),
        error: v.optional(v.string()),
      }),
    ),
  },
  returns: v.array(v.string()),
  handler: async (ctx, { entries }) => {
    const alerts: string[] = [];
    const now = Date.now();
    for (const e of entries) {
      const row = await ctx.db
        .query("sourceHealth")
        .withIndex("by_source", q => q.eq("source", e.source))
        .unique();
      const streak = e.ok ? 0 : (row?.streak ?? 0) + 1;
      const doc: Any = {
        source: e.source,
        ok: e.ok,
        streak,
        at: now,
        lastOkAt: e.ok ? now : row?.lastOkAt,
        lastFailAt: e.ok ? row?.lastFailAt : now,
        lastError: e.ok ? row?.lastError : e.error,
        alertedAt: row?.alertedAt,
      };
      // Alert once when the streak reaches the bar, again after half a day.
      if (
        !e.ok &&
        streak >= ALERT_AFTER &&
        (!row?.alertedAt || now - row.alertedAt > REALERT_AFTER_MS)
      ) {
        doc.alertedAt = now;
        const rb = RUNBOOK[e.source];
        alerts.push(
          `${rb?.label ?? e.source} has failed ${streak} times in a row.\nLast error: ${e.error ?? "unknown"}\nWhat to do (${rb?.owner ?? "Aziz"}): ${rb?.fix ?? "Check the deployment logs."}`,
        );
      }
      // Recovered after an alert: say so, and arm the next alert.
      if (e.ok && row?.alertedAt && (row.streak ?? 0) >= ALERT_AFTER) {
        doc.alertedAt = undefined;
        alerts.push(
          `${RUNBOOK[e.source]?.label ?? e.source} is working again.`,
        );
      }
      if (row) await ctx.db.patch(row._id, doc);
      else await ctx.db.insert("sourceHealth", doc);
    }
    if (alerts.length)
      await ctx.scheduler.runAfter(0, internal.health.notify, {
        texts: alerts,
      });
    return alerts;
  },
});

/** The Slack line, sent out of band so a Slack outage never fails the ledger. */
export const notify = internalMutation({
  args: { texts: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { texts }) => {
    for (const text of texts)
      await ctx.db.insert("alerts", {
        signature: `health:${text.slice(0, 60)}`,
        text,
        at: Date.now(),
      });
    await ctx.scheduler.runAfter(0, internal.health.slack, { texts });
    return null;
  },
});

export const slack = internalMutation({
  args: { texts: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { texts }) => {
    // Delivered by the smoke module's Slack path (an action); queued here so
    // the ledger write itself never waits on Slack.
    await ctx.scheduler.runAfter(0, internal.smoke.slackLines, { texts });
    return null;
  },
});

/** For the admin view: every source, with its runbook line. */
export const sources = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    const rows = await ctx.db.query("sourceHealth").collect();
    return Object.entries(RUNBOOK).map(([key, rb]) => {
      const r = rows.find(x => x.source === key);
      return {
        source: key,
        label: rb.label,
        owner: rb.owner,
        fix: rb.fix,
        ok: r ? r.ok : undefined,
        streak: r?.streak ?? 0,
        lastOkAt: r?.lastOkAt,
        lastFailAt: r?.lastFailAt,
        lastError: r?.lastError,
        at: r?.at,
      };
    });
  },
});

// --- Scheduled jobs ---------------------------------------------------------------------

/**
 * Every cron goes through `runJob`, so a job that starts throwing (a code
 * bug, a dead dependency) is a row here with its error, a fix job for Hermes
 * on the third failure, and an alert when it has not run at all. Before this
 * a crashing cron only showed in the Convex logs, which nobody reads.
 */
// biome-ignore lint/suspicious/noExplicitAny: function references of mixed shapes
const JOBS: Record<string, { ref: any; everyMin: number }> = {
  sync: { ref: internal.sync.runSync, everyMin: 10 },
  "market plays": {
    ref: internal.marketCollect.collectPlays,
    everyMin: 7 * 24 * 60,
  },
  "assist queue": { ref: internal.assistWorker.run, everyMin: 10 },
  "outbox drains": { ref: internal.outboxDrains.drainAll, everyMin: 1 },
  "board KPI columns": { ref: internal.writeback.pushMetrics, everyMin: 60 },
  "tracking audit": { ref: internal.tracking.audit, everyMin: 24 * 60 },
  "smoke check": { ref: internal.smoke.check, everyMin: 15 },
  "report docs": { ref: internal.reportDocs.drain, everyMin: 3 },
  "hermes relay": { ref: internal.hermesDrain.run, everyMin: 1 },
  "client comment watch": { ref: internal.commentWatch.scan, everyMin: 15 },
  "ceo refresh": { ref: internal.ceo.refresh.refreshAll, everyMin: 15 },
};

export const runJob = internalAction({
  args: { job: v.string() },
  returns: v.any(),
  handler: async (ctx, { job }): Promise<Any> => {
    const j = JOBS[job];
    if (!j) throw new Error(`unknown job ${job}`);
    const t0 = Date.now();
    let error: string | undefined;
    let result: Any;
    try {
      result = await ctx.runAction(j.ref, {});
    } catch (e) {
      error = String(e).slice(0, 400);
    }
    await ctx.runMutation(internal.health.beat, {
      job,
      ok: !error,
      ms: Date.now() - t0,
      error,
      everyMin: j.everyMin,
    });
    if (error) throw new Error(error);
    return result;
  },
});

export const beat = internalMutation({
  args: {
    job: v.string(),
    ok: v.boolean(),
    ms: v.number(),
    error: v.optional(v.string()),
    everyMin: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("cronRuns")
      .withIndex("by_job", q => q.eq("job", a.job))
      .unique();
    const streak = a.ok ? 0 : (row?.streak ?? 0) + 1;
    const doc = {
      job: a.job,
      ok: a.ok,
      at: Date.now(),
      ms: a.ms,
      error: a.error,
      streak,
      everyMin: a.everyMin,
    };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("cronRuns", doc);
    // Third failure in a row: Hermes gets the fix job and Aziz one line.
    if (streak === ALERT_AFTER) {
      await ctx.runMutation(internal.fixRequests.file, {
        source: "scheduled job",
        app: "media-buyer",
        title: `Job "${a.job}" keeps failing`,
        detail: a.error ?? "no error text",
      });
      await ctx.scheduler.runAfter(0, internal.health.notify, {
        texts: [
          `Scheduled job "${a.job}" has failed ${streak} times in a row.\nLast error: ${a.error ?? "unknown"}\nHermes has a fix job for it. If nothing changes within an hour: scripts/ship.sh media-buyer, then the Convex logs.`,
        ],
      });
    }
    if (a.ok && (row?.streak ?? 0) >= ALERT_AFTER)
      await ctx.scheduler.runAfter(0, internal.health.notify, {
        texts: [`Scheduled job "${a.job}" is running again.`],
      });
    return null;
  },
});

/** Jobs that should have run by now and have not, for the smoke check. */
export const staleJobs = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    const rows = await ctx.db.query("cronRuns").collect();
    const now = Date.now();
    return rows
      .filter(r => now - r.at > Math.max(3 * r.everyMin, 45) * 60_000)
      .map(r => ({
        job: r.job,
        at: r.at,
        minutes: Math.round((now - r.at) / 60_000),
      }));
  },
});

/** For the admin view. */
export const jobs = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx =>
    (await ctx.db.query("cronRuns").collect())
      .map(r => ({
        job: r.job,
        ok: r.ok,
        at: r.at,
        ms: r.ms,
        error: r.error,
        streak: r.streak,
        everyMin: r.everyMin,
      }))
      .sort((a, b) => a.job.localeCompare(b.job)),
});
