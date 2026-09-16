import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

/**
 * One-off backfills for the usage plan (docs: usage-design-full.md, S1).
 *
 * `aiJobsDone` and `aiJobCounts` let the admin page and the CEO machine
 * section count finished Ask AI jobs without reading the 6 KB job rows.
 * Both are kept by one rule, in `recordJobFinish` below:
 *
 *   for every job, aiJobsDone holds one row exactly when the job is done or
 *   failed, with the job's status and doneAt; aiJobCounts "all" moves by
 *   one whenever a row appears, disappears or changes status.
 *
 * Every write goes through that function, so the backfill and the live
 * writers (askAi complete, reap, retire) can run at the same time, in any
 * order, any number of times, and the counts stay exact. Rows the
 * retention job prunes later do not lower the counts: they stay all-time.
 *
 * How to run (after the schema deploy, and once more right after the
 * deploy that ships the live writers, to fill any gap between the two):
 *
 *   npx convex run migrations:backfillAiJobs '{}' --prod
 *   npx convex run migrations:backfillStatus '{}' --prod
 *
 * The first call handles one page and schedules the next one itself.
 */

export const JOB_COUNTS_KEY = "all";

const FINISHED = new Set(["done", "failed"]);

/** Jobs read per backfill page: about 6 KB each, so about 600 KB a page. */
const PAGE_SIZE = 100;

type JobState = {
  _id: Id<"aiJobs">;
  status: string;
  doneAt?: number;
};

type Counts = { failed: number; done: number };

async function countsRow(ctx: QueryCtx) {
  return await ctx.db
    .query("aiJobCounts")
    .withIndex("by_key", q => q.eq("key", JOB_COUNTS_KEY))
    .unique();
}

async function bumpCounts(
  ctx: MutationCtx,
  change: Partial<Record<"done" | "failed", number>>,
): Promise<void> {
  const row = await countsRow(ctx);
  const next: Counts = {
    done: (row?.done ?? 0) + (change.done ?? 0),
    failed: (row?.failed ?? 0) + (change.failed ?? 0),
  };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("aiJobCounts", { key: JOB_COUNTS_KEY, ...next });
}

function statusKey(status: string): "done" | "failed" | null {
  return status === "done" || status === "failed" ? status : null;
}

/**
 * Record a job's current state in aiJobsDone and aiJobCounts. Pass the job
 * as it is after the change (status and doneAt as just written). Writes
 * nothing when the record already matches, so it is safe to call on every
 * path that touches a job's status. Returns true when it wrote.
 *
 * The live writer (owner P's `markDone`) calls this in the same mutation
 * that patches the job, on every path that changes a job's status: complete
 * (done, and the error path that can set failed or put a failed job back in
 * the queue), reap and retire.
 */
export async function recordJobFinish(
  ctx: MutationCtx,
  job: JobState,
): Promise<boolean> {
  const rows = await ctx.db
    .query("aiJobsDone")
    .withIndex("by_job", q => q.eq("jobId", job._id))
    .collect();
  const [row, ...extra] = rows;
  const change: Partial<Record<"done" | "failed", number>> = {};
  const add = (status: string, n: number) => {
    const key = statusKey(status);
    if (key) change[key] = (change[key] ?? 0) + n;
  };
  // A second row for one job can only come from a bug; drop it and its count.
  for (const r of extra) {
    add(r.status, -1);
    await ctx.db.delete(r._id);
  }
  let wrote = extra.length > 0;
  if (!FINISHED.has(job.status)) {
    if (row) {
      add(row.status, -1);
      await ctx.db.delete(row._id);
      wrote = true;
    }
  } else if (!row) {
    add(job.status, 1);
    await ctx.db.insert("aiJobsDone", {
      jobId: job._id,
      status: job.status,
      doneAt: job.doneAt,
    });
    wrote = true;
  } else if (row.status !== job.status || row.doneAt !== job.doneAt) {
    if (row.status !== job.status) {
      add(row.status, -1);
      add(job.status, 1);
    }
    await ctx.db.replace(row._id, {
      jobId: job._id,
      status: job.status,
      doneAt: job.doneAt,
    });
    wrote = true;
  }
  if (change.done || change.failed) await bumpCounts(ctx, change);
  return wrote;
}

/**
 * The all-time counts, or null until the backfill has seen every job. A
 * reader that gets null keeps counting the job rows, as today.
 */
export async function readJobCounts(ctx: QueryCtx): Promise<Counts | null> {
  const row = await countsRow(ctx);
  if (!row?.backfilledAt) return null;
  return { failed: row.failed, done: row.done };
}

/** Walk every aiJobs row, a page per transaction, and record the finished ones. */
export const backfillAiJobs = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    /** False runs one page only (tests); the default chains to the end. */
    chain: v.optional(v.boolean()),
  },
  returns: v.object({
    seen: v.number(),
    wrote: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.pageSize ?? PAGE_SIZE, 500));
    const page = await ctx.db
      .query("aiJobs")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });
    let wrote = 0;
    for (const job of page.page) if (await recordJobFinish(ctx, job)) wrote++;
    if (page.isDone) {
      const row = await countsRow(ctx);
      const now = Date.now();
      if (row) await ctx.db.patch(row._id, { backfilledAt: now });
      else
        await ctx.db.insert("aiJobCounts", {
          key: JOB_COUNTS_KEY,
          failed: 0,
          done: 0,
          backfilledAt: now,
        });
      console.log(`backfillAiJobs: finished, last page wrote ${wrote}`);
    } else if (args.chain !== false) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillAiJobs, {
        cursor: page.continueCursor,
        pageSize,
      });
    }
    return {
      seen: page.page.length,
      wrote,
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Where the backfill stands: the counts row as stored. */
export const backfillStatus = internalQuery({
  args: {},
  returns: v.object({
    backfilledAt: v.union(v.number(), v.null()),
    failed: v.number(),
    done: v.number(),
  }),
  handler: async ctx => {
    const row = await countsRow(ctx);
    return {
      backfilledAt: row?.backfilledAt ?? null,
      failed: row?.failed ?? 0,
      done: row?.done ?? 0,
    };
  },
});
