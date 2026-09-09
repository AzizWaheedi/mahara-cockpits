import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * The drain side of the outbox. A scheduled Viktor job reads `pending`, performs the
 * ClickUp writes with its own credentials, then calls `markSent`. The app therefore
 * never needs an outbound integration connection of its own.
 */
export const pending = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    await ctx.db
      .query("outbox")
      .withIndex("by_sentAt", q => q.eq("sentAt", undefined))
      .take(50),
});

export const markSent = internalMutation({
  args: {
    id: v.id("outbox"),
    resultUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, resultUrl, error }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, {
      sentAt: error ? undefined : Date.now(),
      error,
      resultUrl,
    });
    if (!error && row.decisionId) {
      await ctx.db.patch(row.decisionId, {
        loggedAt: Date.now(),
        clickupTaskId: row.clientTaskId || undefined,
        clickupTaskUrl: resultUrl,
      });
    }
    if (!error && row.planItemId) {
      await ctx.db.patch(row.planItemId, {
        confirmed: true,
        clickupTaskUrl: resultUrl,
      });
    }
    if (!error && row.feedbackId) {
      await ctx.db.patch(row.feedbackId, { clickupTaskUrl: resultUrl });
    }
    return null;
  },
});

/** Snapshot ingestion is `csmSync.store`; this reports when it last ran. */
export const lastSync = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    await ctx.db.query("syncRuns").withIndex("by_at").order("desc").first(),
});
