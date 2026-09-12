import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * The drain side of the outbox. A scheduled Viktor job reads `pending`, performs the
 * ClickUp writes with its own credentials, then calls `markSent`. The app therefore
 * never needs an outbound integration connection of its own.
 */
const CLAIM_TTL_MS = 10 * 60_000;
/** Minutes to wait before each retry; after the last one the row is left with its error. */
const BACKOFF_MIN = [1, 5, 15, 60, 240];

export const pending = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const now = Date.now();
    return (
      await ctx.db
        .query("outbox")
        .withIndex("by_sentAt", q => q.eq("sentAt", undefined))
        .take(200)
    )
      .filter(
        r =>
          !r.gaveUpAt &&
          (r.nextTryAt ?? 0) <= now &&
          (!r.claimedAt || now - r.claimedAt > CLAIM_TTL_MS),
      )
      .slice(0, 50);
  },
});

/** The drain takes the row. False if another drain already has it. */
export const markSending = internalMutation({
  args: { id: v.id("outbox") },
  returns: v.boolean(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.sentAt || row.gaveUpAt) return false;
    if (row.claimedAt && Date.now() - row.claimedAt < CLAIM_TTL_MS)
      return false;
    await ctx.db.patch(id, { claimedAt: Date.now() });
    return true;
  },
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
    if (error) {
      // Retry with growing gaps; give up after the last one and keep the error.
      const attempts = (row.attempts ?? 0) + 1;
      const wait = BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1];
      await ctx.db.patch(id, {
        error,
        attempts,
        claimedAt: undefined,
        nextTryAt: Date.now() + wait * 60_000,
        gaveUpAt: attempts >= BACKOFF_MIN.length ? Date.now() : undefined,
      });
      return null;
    }
    await ctx.db.patch(id, {
      sentAt: Date.now(),
      error: undefined,
      resultUrl,
      claimedAt: undefined,
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
