import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * The work the app cannot do itself, queued for Viktor's scheduled job.
 *
 * Two kinds: a client report that has to become an editable Google Doc, and a question
 * the CSM asked the assistant. Both are written by the app, drained by the bridge, and
 * written back here — the UI shows "waiting", "ready" or the error verbatim, never a
 * guess.
 */

export const pendingReports = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    await ctx.db
      .query("reportDocs")
      .withIndex("by_builtAt", q => q.eq("builtAt", undefined))
      .take(10),
});

export const reportDone = internalMutation({
  args: {
    id: v.id("reportDocs"),
    docUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, docUrl, error }) => {
    await ctx.db.patch(id, {
      docUrl,
      error,
      builtAt: error ? undefined : Date.now(),
    });
    return null;
  },
});

export const pendingEods = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    await ctx.db
      .query("eodReports")
      .withIndex("by_exportedAt", q => q.eq("exportedAt", undefined))
      .take(10),
});

export const eodExported = internalMutation({
  args: {
    id: v.id("eodReports"),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, error }) => {
    // An export that failed stays pending, so the next run retries it rather than losing
    // a day of his accountability trail.
    await ctx.db.patch(id, {
      exportError: error,
      exportedAt: error ? undefined : Date.now(),
    });
    return null;
  },
});

export const pendingAsks = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    await ctx.db
      .query("asks")
      .withIndex("by_answeredAt", q => q.eq("answeredAt", undefined))
      .take(10),
});

export const answerAsk = internalMutation({
  args: {
    id: v.id("asks"),
    answer: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, answer, error }) => {
    await ctx.db.patch(id, {
      answer,
      error,
      answeredAt: error ? undefined : Date.now(),
    });
    return null;
  },
});

/** The last questions and answers, so Viktor can audit its own answer quality. */
export const recentAsks = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    await ctx.db.query("asks").withIndex("by_askedAt").order("desc").take(10),
});

/**
 * Clear the non-money loose ends on Viktor's side, so leadership can ask for the reset in chat
 * rather than clicking it. Same rule as the in-app button: money never clears.
 */
export const clearLoose = internalMutation({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const clients = await ctx.db.query("clients").collect();
    let cleared = 0;
    let kept = 0;
    for (const c of clients) {
      for (const text of c.loose) {
        if (/invoice|payment|past due|billing|pause|refund|card/i.test(text)) {
          kept += 1;
          continue;
        }
        const key = `${c.name}|${text}`;
        const existing = await ctx.db
          .query("looseDismissed")
          .withIndex("by_key", q => q.eq("key", key))
          .first();
        if (existing) continue;
        await ctx.db.insert("looseDismissed", {
          key,
          clientName: c.name,
          text,
          at: Date.now(),
          by: "viktor",
        });
        cleared += 1;
      }
    }
    return { cleared, kept };
  },
});

/** One client's stored profile, for the report writer. */
export const profileFor = internalQuery({
  args: { clientName: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientName }) =>
    await ctx.db
      .query("clientProfiles")
      .withIndex("by_client", q => q.eq("clientName", clientName))
      .first(),
});

/** Queue a report the way the CSM's button does, from the command line. */
export const enqueueReport = internalMutation({
  args: {
    clientName: v.string(),
    month: v.string(),
    language: v.optional(v.string()),
    note: v.optional(v.string()),
    extras: v.optional(v.array(v.string())),
  },
  returns: v.id("reportDocs"),
  handler: async (ctx, args) =>
    await ctx.db.insert("reportDocs", {
      clientName: args.clientName,
      month: args.month,
      language: args.language ?? "en",
      note: args.note,
      extras: args.extras,
      requestedBy: "command line",
      requestedAt: Date.now(),
    }),
});
