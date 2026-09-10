import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const row = v.object({
  clientName: v.string(),
  title: v.string(),
  at: v.string(),
  url: v.string(),
  host: v.optional(v.string()),
  summary: v.optional(v.string()),
  kind: v.string(),
  source: v.string(),
});

/** Upsert calls by (clientName, url). Returns how many were new. */
export const put = internalMutation({
  args: { rows: v.array(row) },
  returns: v.object({ added: v.number(), updated: v.number() }),
  handler: async (ctx, { rows }) => {
    let added = 0;
    let updated = 0;
    for (const r of rows) {
      const existing = (
        await ctx.db
          .query("fathomCache")
          .withIndex("by_client", q => q.eq("clientName", r.clientName))
          .collect()
      ).find(x => x.url === r.url);
      if (existing) {
        await ctx.db.patch(existing._id, { ...r, addedAt: existing.addedAt });
        updated++;
      } else {
        await ctx.db.insert("fathomCache", { ...r, addedAt: Date.now() });
        added++;
      }
    }
    return { added, updated };
  },
});

/** Everything from the last `days` days, newest first. */
export const recent = internalQuery({
  args: { days: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, { days }) => {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const all = await ctx.db.query("fathomCache").collect();
    return all
      .filter(r => r.at >= since)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map(({ _id, _creationTime, addedAt, ...rest }) => rest);
  },
});
