import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/** Store one section. A failed compute keeps the last good payload. */
export const saveSection = internalMutation({
  args: {
    key: v.string(),
    label: v.string(),
    ok: v.boolean(),
    payload: v.optional(v.any()),
    error: v.optional(v.string()),
    sources: v.array(v.any()),
    ms: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const now = Date.now();
    const row = await ctx.db
      .query("ceoSections")
      .withIndex("by_key", q => q.eq("key", a.key))
      .first();
    const next = {
      key: a.key,
      label: a.label,
      ok: a.ok,
      error: a.ok ? undefined : a.error,
      sources: a.sources,
      computedAt: now,
      ms: a.ms,
      ...(a.ok ? { payload: a.payload, lastOkAt: now } : {}),
    };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("ceoSections", next);
    return null;
  },
});

/** Upsert daily history points by (metric, scope, date). */
export const saveDaily = internalMutation({
  args: {
    points: v.array(
      v.object({
        date: v.string(),
        metric: v.string(),
        scope: v.string(),
        value: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { points }) => {
    const now = Date.now();
    for (const p of points) {
      const row = await ctx.db
        .query("ceoDaily")
        .withIndex("by_metric_scope_date", q =>
          q.eq("metric", p.metric).eq("scope", p.scope).eq("date", p.date),
        )
        .first();
      if (row) {
        if (row.value !== p.value)
          await ctx.db.patch(row._id, { value: p.value, at: now });
      } else await ctx.db.insert("ceoDaily", { ...p, at: now });
    }
    return points.length;
  },
});

export const sectionRows = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => await ctx.db.query("ceoSections").collect(),
});
