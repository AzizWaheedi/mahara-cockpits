import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
    const rows = (
      await ctx.db
        .query("aiJobs")
        .withIndex("by_status", q => q.eq("status", "queued"))
        .collect()
    )
      // A poisoned prompt must not be retried forever.
      .filter(r => r.tries < 4)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit ?? 10);
    for (const r of rows) {
      // Handed out once: "claimed" until Hermes answers or `reap` gives it back.
      await ctx.db.patch(r._id, {
        status: "claimed",
        tries: r.tries + 1,
        claimedAt: Date.now(),
      });
    }
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
      await ctx.db.patch(id, {
        status: job.tries >= 4 ? "failed" : "queued",
        error: (error ?? "empty result").slice(0, 400),
      });
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

    await ctx.db.patch(id, {
      status: "done",
      result,
      doneAt: Date.now(),
      error: undefined,
    });
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
        failed++;
      } else {
        await ctx.db.patch(j._id, { status: "queued" });
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
