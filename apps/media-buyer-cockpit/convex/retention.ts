import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";

/**
 * Trims the log tables that nothing ever deleted (usage plan S1).
 *
 * DRY RUN ONLY. Aziz has not agreed the windows yet (plan section 6), so
 * this module deletes nothing: `RETENTION_DELETES_ON` is false and every
 * batch is forced to a dry run whatever the caller passes. A run counts
 * what it would delete and logs one line. Turning deletes on is a one-line
 * change here, made only after Aziz says yes to the windows below.
 *
 * The cron line ("prune logs", 01:40 UTC through runJob) and the JOBS entry
 * belong to other owners and are added with the phase that turns it on.
 */
export const RETENTION_DELETES_ON: boolean = false;

/** Proposed windows, in days. Deletes are permanent. */
export const WINDOWS_DAYS = {
  /** Finished Hermes jobs (done or failed only). */
  aiJobs: 7,
  /** The small finished-job records; the newest of each status is kept. */
  aiJobsDone: 30,
  /** Hermes action audit log. */
  agentActions: 90,
  /** Media buyer sync runs; the newest 10 are kept. */
  syncRuns: 30,
  /** Alerts; the newest 8 are kept. */
  alerts: 90,
  /** Delivered chat relays. */
  chatRelay: 7,
} as const;

/** Rows the admin page shows are kept whatever their age. */
const KEEP_NEWEST = { syncRuns: 10, alerts: 8 } as const;

/** Rows per transaction. */
const BATCH = 200;

/**
 * A dry run stops counting a table after this many pages, so its daily
 * reads stay small while old rows pile up undeleted. The result says
 * "capped" when it stopped early.
 */
const DRY_RUN_MAX_PAGES = 5;

const DAY_MS = 86_400_000;

/** One scan per entry. aiJobs are found through their small aiJobsDone rows. */
export const PASSES = [
  "aiJobs",
  "aiJobs:undated",
  "aiJobsDone",
  "aiJobsDone:undated",
  "agentActions",
  "syncRuns",
  "alerts",
  "chatRelay",
] as const;
type Pass = (typeof PASSES)[number];

const vPass = v.union(...PASSES.map(p => v.literal(p)));

type Page<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

type BatchResult = {
  scanned: number;
  matched: number;
  deleted: number;
  isDone: boolean;
  cursor: string | null;
};

const FINISHED = new Set(["done", "failed"]);

async function newestDoneIds(ctx: MutationCtx): Promise<Set<string>> {
  const keep = new Set<string>();
  for (const status of FINISHED) {
    const row = await ctx.db
      .query("aiJobsDone")
      .withIndex("by_status_doneAt", q => q.eq("status", status))
      .order("desc")
      .first();
    if (row) keep.add(row._id);
  }
  return keep;
}

/**
 * One page of one pass. Counts the rows the window would delete and, only
 * when deletes are on, deletes them.
 */
export const pruneBatch = internalMutation({
  args: {
    pass: vPass,
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    matched: v.number(),
    deleted: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<BatchResult> => {
    const dryRun = args.dryRun !== false || !RETENTION_DELETES_ON;
    const now = Date.now();
    const opts = { cursor: args.cursor ?? null, numItems: BATCH };
    const cutoff = (days: number) => now - days * DAY_MS;
    let matched = 0;
    let deleted = 0;
    const drop = async (id: Id<TableNames>) => {
      matched++;
      if (dryRun) return;
      await ctx.db.delete(id);
      deleted++;
    };
    const done = (page: Page<unknown>): BatchResult => ({
      scanned: page.page.length,
      matched,
      deleted,
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    });

    const pass = args.pass as Pass;
    switch (pass) {
      case "aiJobs":
      case "aiJobs:undated": {
        const before = cutoff(WINDOWS_DAYS.aiJobs);
        const page =
          pass === "aiJobs"
            ? await ctx.db
                .query("aiJobsDone")
                .withIndex("by_doneAt", q =>
                  q.gte("doneAt", 0).lt("doneAt", before),
                )
                .paginate(opts)
            : await ctx.db
                .query("aiJobsDone")
                .withIndex("by_doneAt", q =>
                  q.eq("doneAt", undefined).lt("_creationTime", before),
                )
                .paginate(opts);
        for (const rec of page.page) {
          if (!FINISHED.has(rec.status)) continue;
          if (dryRun) {
            matched++;
            continue;
          }
          const job = await ctx.db.get(rec.jobId);
          if (!job || job.status !== rec.status) continue;
          if (job._creationTime >= before) continue;
          if ((job.doneAt ?? job._creationTime) >= before) continue;
          await drop(job._id);
        }
        return done(page);
      }
      case "aiJobsDone":
      case "aiJobsDone:undated": {
        const before = cutoff(WINDOWS_DAYS.aiJobsDone);
        const keep = await newestDoneIds(ctx);
        const page =
          pass === "aiJobsDone"
            ? await ctx.db
                .query("aiJobsDone")
                .withIndex("by_doneAt", q =>
                  q.gte("doneAt", 0).lt("doneAt", before),
                )
                .paginate(opts)
            : await ctx.db
                .query("aiJobsDone")
                .withIndex("by_doneAt", q =>
                  q.eq("doneAt", undefined).lt("_creationTime", before),
                )
                .paginate(opts);
        for (const rec of page.page) {
          if (keep.has(rec._id)) continue;
          // Only once the job itself is gone (the aiJobs pass runs first).
          if (!dryRun && (await ctx.db.get(rec.jobId))) continue;
          await drop(rec._id);
        }
        return done(page);
      }
      case "agentActions": {
        const before = cutoff(WINDOWS_DAYS.agentActions);
        const page = await ctx.db
          .query("agentActions")
          .withIndex("by_creation_time", q => q.lt("_creationTime", before))
          .paginate(opts);
        for (const row of page.page) if (row.at < before) await drop(row._id);
        return done(page);
      }
      case "syncRuns": {
        const before = cutoff(WINDOWS_DAYS.syncRuns);
        const keep = new Set<string>(
          (
            await ctx.db
              .query("syncRuns")
              .withIndex("by_at")
              .order("desc")
              .take(KEEP_NEWEST.syncRuns)
          ).map(r => r._id),
        );
        const page = await ctx.db
          .query("syncRuns")
          .withIndex("by_at", q => q.lt("at", before))
          .paginate(opts);
        for (const row of page.page)
          if (!keep.has(row._id)) await drop(row._id);
        return done(page);
      }
      case "alerts": {
        const before = cutoff(WINDOWS_DAYS.alerts);
        const keep = new Set<string>(
          (
            await ctx.db.query("alerts").order("desc").take(KEEP_NEWEST.alerts)
          ).map(r => r._id),
        );
        const page = await ctx.db
          .query("alerts")
          .withIndex("by_creation_time", q => q.lt("_creationTime", before))
          .paginate(opts);
        for (const row of page.page)
          if (row.at < before && !keep.has(row._id)) await drop(row._id);
        return done(page);
      }
      case "chatRelay": {
        const before = cutoff(WINDOWS_DAYS.chatRelay);
        const page = await ctx.db
          .query("chatRelay")
          .withIndex("by_delivered", q =>
            q.gte("deliveredAt", 0).lt("deliveredAt", before),
          )
          .paginate(opts);
        for (const row of page.page) if (row.at < before) await drop(row._id);
        return done(page);
      }
    }
  },
});

const vPassResult = v.object({
  pass: vPass,
  scanned: v.number(),
  wouldDelete: v.number(),
  deleted: v.number(),
  capped: v.boolean(),
});

/** The daily run: every pass, page by page. Dry run while deletes are off. */
export const run = internalAction({
  args: {},
  returns: v.object({
    dryRun: v.boolean(),
    passes: v.array(vPassResult),
  }),
  handler: async ctx => {
    const dryRun = !RETENTION_DELETES_ON;
    const passes: {
      pass: Pass;
      scanned: number;
      wouldDelete: number;
      deleted: number;
      capped: boolean;
    }[] = [];
    for (const pass of PASSES) {
      let cursor: string | null = null;
      let scanned = 0;
      let wouldDelete = 0;
      let deleted = 0;
      let capped = false;
      for (let pageNo = 0; ; pageNo++) {
        if (dryRun && pageNo >= DRY_RUN_MAX_PAGES) {
          capped = true;
          break;
        }
        const r: BatchResult = await ctx.runMutation(
          internal.retention.pruneBatch,
          { pass, cursor, dryRun },
        );
        scanned += r.scanned;
        wouldDelete += r.matched;
        deleted += r.deleted;
        if (r.isDone || r.cursor === null) break;
        cursor = r.cursor;
      }
      passes.push({ pass, scanned, wouldDelete, deleted, capped });
    }
    console.log(
      `retention ${dryRun ? "dry run" : "run"}: ${passes
        .map(
          p =>
            `${p.pass} ${dryRun ? "would delete" : "deleted"} ${
              dryRun ? p.wouldDelete : p.deleted
            }${p.capped ? "+" : ""}`,
        )
        .join(", ")}`,
    );
    return { dryRun, passes };
  },
});
