import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * A tiny cache of raw HTTP response bodies, written by Viktor's bridge script.
 *
 * The Space's own tool gateway returns HTTP 500 for every integration call, so the CSM
 * snapshot can no longer fetch ClickUp or Typeform itself. The bridge fetches from
 * Viktor's side (where those APIs work) and pushes the bodies here; `csmSync` reads them
 * instead of calling out. Delete this file the day the gateway is fixed.
 */
export const put = internalMutation({
  args: {
    url: v.string(),
    part: v.number(),
    text: v.string(),
    reset: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.reset) {
      const old = await ctx.db
        .query("rawFetch")
        .withIndex("by_url", q => q.eq("url", args.url))
        .collect();
      for (const row of old) await ctx.db.delete(row._id);
    }
    await ctx.db.insert("rawFetch", {
      url: args.url,
      part: args.part,
      text: args.text,
      at: Date.now(),
    });
    return null;
  },
});

/** Returns the reassembled body, or null when nothing fresh is cached. */
export const get = internalQuery({
  args: { url: v.string(), maxAgeMs: v.optional(v.number()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("rawFetch")
      .withIndex("by_url", q => q.eq("url", args.url))
      .collect();
    if (rows.length === 0) return null;
    const newest = Math.max(...rows.map(r => r.at));
    if (Date.now() - newest > (args.maxAgeMs ?? 6 * 3600 * 1000)) return null;
    return rows
      .sort((a, b) => a.part - b.part)
      .map(r => r.text)
      .join("");
  },
});
