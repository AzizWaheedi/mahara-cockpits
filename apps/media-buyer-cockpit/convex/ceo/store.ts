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

/**
 * Just the payloads asked for, by key. The goals board needs four of the
 * thirteen sections and reading all of them to get four is a megabyte of
 * read bandwidth for nothing.
 */
export const payloadsFor = internalQuery({
  args: { keys: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { keys }) => {
    const want = new Set(keys);
    const rows = await ctx.db.query("ceoSections").collect();
    const out: Record<string, unknown> = {};
    for (const r of rows) if (want.has(r.key)) out[r.key] = r.payload ?? null;
    return out;
  },
});

/** One metric's daily points in a scope since a day, oldest first, for an adapter that needs its own history. */
export const series = internalQuery({
  args: { metric: v.string(), scope: v.string(), since: v.string() },
  returns: v.array(v.object({ date: v.string(), value: v.number() })),
  handler: async (ctx, { metric, scope, since }) => {
    const rows = await ctx.db
      .query("ceoDaily")
      .withIndex("by_metric_scope_date", q =>
        q.eq("metric", metric).eq("scope", scope).gte("date", since),
      )
      .collect();
    return rows.map(r => ({ date: r.date, value: r.value }));
  },
});
