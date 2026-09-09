import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * The winning ads database, exactly as the media buyer sees it.
 *
 * Aziz, 2026-09-07: the creative director gets the same view as the media
 * buyer cockpit, not a weaker copy, so a script starts from an ad that already
 * worked, with its hook, its copy, its transcript and its preview.
 *
 * This deployment does not compute winners. The media buyer Space owns that
 * logic; the sandbox sync mirrors the rows here so there is one definition of
 * "winning" in the company, not two that drift.
 */

function norm(x?: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const list = query({
  args: {
    serviceLine: v.optional(v.string()),
    excludeClient: v.optional(v.string()),
    liveOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const all = await ctx.db.query("winnersArchive").collect();
    const rows = all
      .filter(r => {
        if (args.serviceLine && r.serviceLine !== args.serviceLine)
          return false;
        if (args.excludeClient && norm(r.client) === norm(args.excludeClient)) {
          return false;
        }
        if (args.liveOnly && r.stillLive === false) return false;
        return true;
      })
      .sort((a, b) => a.cpl - b.cpl)
      .slice(0, args.limit ?? 40);

    const serviceLines = Array.from(
      new Set(all.map(r => r.serviceLine).filter(Boolean) as string[]),
    ).sort();

    return {
      rows,
      serviceLines,
      total: all.length,
      live: all.filter(r => r.stillLive).length,
      syncedAt: all[0]?.syncedAt ?? null,
    };
  },
});

/** Replace the mirror wholesale. Called by the sandbox sync. */
export const store = mutation({
  args: { rows: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, { rows }) => {
    // A partial or empty pull must never wipe the database he scripts from.
    if (rows.length === 0) return { skipped: "empty payload" };
    const now = Date.now();
    const existing = await ctx.db.query("winnersArchive").collect();
    const byAd = new Map(existing.map(r => [r.adId, r]));
    let inserted = 0;
    let patched = 0;
    for (const raw of rows) {
      const row = { ...raw, syncedAt: now };
      const prev = byAd.get(row.adId);
      if (prev) {
        await ctx.db.patch(prev._id, row);
        byAd.delete(row.adId);
        patched += 1;
      } else {
        await ctx.db.insert("winnersArchive", row);
        inserted += 1;
      }
    }
    for (const stale of byAd.values()) await ctx.db.delete(stale._id);
    return { inserted, patched, removed: byAd.size };
  },
});
