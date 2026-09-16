import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { readJobCounts, recordJobFinish } from "./migrations";

/**
 * The "Ask AI" queue.
 *
 * The cockpit has no model of its own. Anything that needs one — ad copy for a
 * build, the launch assistant's copy step — is written here as a job with the
 * full prompt and the JSON shape the answer must have. An outside worker
 * (Hermes, on its own Claude key) polls `GET /askai/pending`, answers, and
 * posts to `POST /askai/result`; `complete` then writes the answer into the
 * row the question came from, and the screen updates on its own.
 */

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          message: { type: "string" },
          description: { type: "string" },
          angle: { type: "string" },
        },
        required: ["headline", "message", "angle"],
      },
    },
    note: { type: "string" },
  },
  required: ["variants"],
};

export const enqueue = internalMutation({
  args: {
    kind: v.string(),
    refId: v.string(),
    prompt: v.string(),
    schema: v.optional(v.any()),
  },
  returns: v.id("aiJobs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiJobs", {
      kind: args.kind,
      refId: args.refId,
      prompt: args.prompt,
      schema: args.schema ?? VARIANT_SCHEMA,
      status: "queued",
      tries: 0,
      createdAt: Date.now(),
    });
  },
});

/** What the worker should answer now, oldest first. Claiming is implicit. */
export const pending = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.id("aiJobs"),
      kind: v.string(),
      prompt: v.string(),
      schema: v.any(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { limit }) => {
    // Every open job is listed on every poll. Hermes checks for work with one
    // call and answers with another; handing a job out only once (2026-09-12)
    // left the answering run with an empty queue, and every job died after
    // four rounds on 2026-09-13. An attempt is counted once per claim window,
    // not per poll, so a job nobody answers still fails after four attempts.
    const now = Date.now();
    const open = [
      ...(await ctx.db
        .query("aiJobs")
        .withIndex("by_status", q => q.eq("status", "queued"))
        .collect()),
      ...(await ctx.db
        .query("aiJobs")
        .withIndex("by_status", q => q.eq("status", "claimed"))
        .collect()),
    ];
    const inWindow = (r: { claimedAt?: number }) =>
      now - (r.claimedAt ?? 0) <= CLAIM_TTL_MS;
    const rows = open
      .filter(r => r.tries < 4 || (r.status === "claimed" && inWindow(r)))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit ?? 10);
    for (const r of rows)
      if (r.status === "queued" || !inWindow(r))
        await ctx.db.patch(r._id, {
          status: "claimed",
          tries: r.tries + 1,
          claimedAt: now,
        });
    return rows.map(r => ({
      id: r._id,
      kind: r.kind,
      prompt: r.prompt,
      schema: r.schema,
      createdAt: r.createdAt,
    }));
  },
});

// biome-ignore lint/suspicious/noExplicitAny: model output
function toVariants(list: any[]) {
  return (Array.isArray(list) ? list : []).slice(0, 5).map(x => ({
    headline: String(x.headline ?? "").slice(0, 120),
    message: String(x.message ?? x.primaryText ?? "").slice(0, 1200),
    description: x.description
      ? String(x.description).slice(0, 300)
      : undefined,
    angle: x.angle ? String(x.angle).slice(0, 60) : undefined,
  }));
}

/** The worker's answer, written into the row the question came from. */
export const complete = internalMutation({
  args: {
    id: v.id("aiJobs"),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), applied: v.string() }),
  handler: async (ctx, { id, result, error }) => {
    const job = await ctx.db.get(id);
    if (!job) return { ok: false, applied: "no such job" };
    if (job.status === "done") return { ok: true, applied: "already done" };

    if (error || !result) {
      const status = job.tries >= 4 ? "failed" : "queued";
      const doneAt = status === "queued" ? undefined : job.doneAt;
      await ctx.db.patch(id, {
        status,
        doneAt,
        error: (error ?? "empty result").slice(0, 400),
      });
      await recordJobFinish(ctx, { ...job, status, doneAt });
      return { ok: false, applied: "error recorded" };
    }

    const variants = toVariants(result.variants);
    const note: string | undefined = result.note
      ? String(result.note)
      : undefined;

    if (job.kind === "assist_copy") {
      const req = await ctx.db.get(job.refId as never);
      // biome-ignore lint/suspicious/noExplicitAny: assist request row
      const row: any = req;
      if (row && "steps" in row) {
        const steps = (row.steps ?? []).map((s: { label: string }) =>
          /^ad copy/i.test(s.label)
            ? {
                label: "Ad copy written",
                state: "done",
                detail: `${variants.length} options below.`,
              }
            : s,
        );
        await ctx.db.patch(row._id, {
          variants,
          note:
            note ??
            `${variants.length} copy options. Edit anything before you use them.`,
          steps,
        });
      } else if (row) {
        await ctx.db.patch(row._id, {
          variants,
          note:
            note ??
            `${variants.length} copy options. Edit anything before you use them.`,
        });
      }
    } else if (job.kind === "comment_digest") {
      // A client card comment, digested: store it and add any new rules to
      // the client's Do's & Don'ts (commentWatch.apply).
      const row = await ctx.db.get(job.refId as never);
      // biome-ignore lint/suspicious/noExplicitAny: client comment row
      const r: any = row;
      if (r && "commentId" in r) {
        await ctx.db.patch(r._id, {
          status: "done",
          digest: result,
          syncedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, internal.commentWatch.apply, {
          id: r._id,
        });
      }
    } else if (job.kind === "draft_copy") {
      const draft = await ctx.db.get(job.refId as never);
      // biome-ignore lint/suspicious/noExplicitAny: campaign draft row
      const d: any = draft;
      if (d) {
        await ctx.db.patch(d._id, {
          variants: variants.map(x => ({
            headline: x.headline,
            primaryText: x.message,
            description: x.description,
          })),
          note: note ?? "Copy written. Read it, edit anything, then launch.",
        });
      }
    }

    const doneAt = Date.now();
    await ctx.db.patch(id, {
      status: "done",
      result,
      doneAt,
      error: undefined,
    });
    await recordJobFinish(ctx, { ...job, status: "done", doneAt });
    return { ok: true, applied: job.kind };
  },
});

/** Queue depth, for the status strip and the worker's health check. */
export const health = internalQuery({
  args: {},
  returns: v.object({
    queued: v.number(),
    failed: v.number(),
    lastDoneAt: v.optional(v.number()),
  }),
  handler: async ctx => {
    const queued = await ctx.db
      .query("aiJobs")
      .withIndex("by_status", q => q.eq("status", "queued"))
      .collect();
    const counts = await readJobCounts(ctx);
    if (counts) {
      const last = await ctx.db
        .query("aiJobsDone")
        .withIndex("by_status_doneAt", q => q.eq("status", "done"))
        .order("desc")
        .first();
      return {
        queued: queued.length,
        failed: counts.failed,
        lastDoneAt: last?.doneAt || undefined,
      };
    }
    const failed = await ctx.db
      .query("aiJobs")
      .withIndex("by_status", q => q.eq("status", "failed"))
      .collect();
    const done = await ctx.db
      .query("aiJobs")
      .withIndex("by_status", q => q.eq("status", "done"))
      .collect();
    const lastDoneAt = done.reduce<number | undefined>(
      (m, r) => (r.doneAt && (!m || r.doneAt > m) ? r.doneAt : m),
      undefined,
    );
    return { queued: queued.length, failed: failed.length, lastDoneAt };
  },
});

/** Hermes polled: remembered as the heartbeat the watchdog reads. */
export const heartbeat = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const row = await ctx.db
      .query("sourceHealth")
      .withIndex("by_source", q => q.eq("source", "hermes"))
      .unique();
    const now = Date.now();
    if (
      row?.ok &&
      row.streak === 0 &&
      !row.alertedAt &&
      now - (row.lastOkAt ?? 0) < 2 * 60_000
    )
      return null;
    const doc = {
      source: "hermes",
      ok: true,
      streak: 0,
      at: now,
      lastOkAt: now,
      lastFailAt: row?.lastFailAt,
      lastError: row?.lastError,
      alertedAt: undefined,
    };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("sourceHealth", doc);
    return null;
  },
});

const CLAIM_TTL_MS = 20 * 60_000;

/**
 * A job Hermes took but never answered goes back in the queue after twenty
 * minutes; after four tries it is failed for good so the person asking is
 * told instead of waiting forever. Runs from the Hermes relay cron.
 */
export const reap = internalMutation({
  args: {},
  returns: v.object({ requeued: v.number(), failed: v.number() }),
  handler: async ctx => {
    const stale = (
      await ctx.db
        .query("aiJobs")
        .withIndex("by_status", q => q.eq("status", "claimed"))
        .collect()
    ).filter(j => Date.now() - (j.claimedAt ?? j.createdAt) > CLAIM_TTL_MS);
    let requeued = 0;
    let failed = 0;
    for (const j of stale) {
      if (j.tries >= 4) {
        await ctx.db.patch(j._id, {
          status: "failed",
          error: "Hermes took the job four times and never answered.",
          doneAt: Date.now(),
        });
        await recordJobFinish(ctx, {
          ...j,
          status: "failed",
          doneAt: Date.now(),
        });
        failed++;
      } else {
        await ctx.db.patch(j._id, { status: "queued", doneAt: undefined });
        await recordJobFinish(ctx, {
          ...j,
          status: "queued",
          doneAt: undefined,
        });
        requeued++;
      }
    }
    return { requeued, failed };
  },
});

/** Queue and heartbeat, for the watchdog and the admin view. */
export const waiting = internalQuery({
  args: {},
  returns: v.object({
    queued: v.number(),
    claimed: v.number(),
    lastPollAt: v.optional(v.number()),
  }),
  handler: async ctx => {
    const queued = await ctx.db
      .query("aiJobs")
      .withIndex("by_status", q => q.eq("status", "queued"))
      .collect();
    const claimed = await ctx.db
      .query("aiJobs")
      .withIndex("by_status", q => q.eq("status", "claimed"))
      .collect();
    const h = await ctx.db
      .query("sourceHealth")
      .withIndex("by_source", q => q.eq("source", "hermes"))
      .unique();
    return {
      queued: queued.length,
      claimed: claimed.length,
      lastPollAt: h?.lastOkAt,
    };
  },
});

/** Retire jobs whose person-facing message is gone, so Hermes never acts on them unseen. */
export const retire = internalMutation({
  args: { ids: v.array(v.id("aiJobs")), reason: v.string() },
  returns: v.number(),
  handler: async (ctx, { ids, reason }) => {
    let n = 0;
    for (const id of ids) {
      const j = await ctx.db.get(id);
      if (!j || j.status === "done" || j.status === "failed") continue;
      await ctx.db.patch(id, {
        status: "failed",
        error: reason,
        doneAt: Date.now(),
      });
      await recordJobFinish(ctx, {
        ...j,
        status: "failed",
        doneAt: Date.now(),
      });
      n++;
    }
    return n;
  },
});
