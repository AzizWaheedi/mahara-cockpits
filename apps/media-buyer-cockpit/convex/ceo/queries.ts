import { v } from "convex/values";
import { internal } from "../_generated/api";
import { authenticatedMutation, authenticatedQuery } from "../functions";
import { requireCeo } from "./gate";
import { addDays, kuwaitDay } from "./time";

/** Everything the CEO screens show: each section's prepared payload and its trust. */
export const today = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCeo(ctx);
    const rows = await ctx.db.query("ceoSections").collect();
    const sections: Record<string, unknown> = {};
    for (const r of rows)
      sections[r.key] = {
        label: r.label,
        ok: r.ok,
        error: r.error,
        computedAt: r.computedAt,
        lastOkAt: r.lastOkAt,
        sources: r.sources,
        payload: r.payload ?? null,
      };
    return { sections, day: kuwaitDay(), now: Date.now() };
  },
});

/** Daily history for a few metrics in one scope, oldest first. */
export const history = authenticatedQuery({
  args: {
    metrics: v.array(v.string()),
    scope: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { metrics, scope, days }) => {
    await requireCeo(ctx);
    const since = addDays(kuwaitDay(), -Math.min(days ?? 90, 400));
    const out: Record<string, { date: string; value: number }[]> = {};
    for (const metric of metrics.slice(0, 12)) {
      const rows = await ctx.db
        .query("ceoDaily")
        .withIndex("by_metric_scope_date", q =>
          q
            .eq("metric", metric)
            .eq("scope", scope ?? "company")
            .gte("date", since),
        )
        .collect();
      out[metric] = rows.map(r => ({ date: r.date, value: r.value }));
    }
    return out;
  },
});

/** "Refresh now" from the screen: recompute every section in the background. */
export const refreshNow = authenticatedMutation({
  args: { only: v.optional(v.array(v.string())) },
  returns: v.null(),
  handler: async (ctx, { only }) => {
    await requireCeo(ctx);
    await ctx.scheduler.runAfter(0, internal.ceo.refresh.refreshAll, { only });
    return null;
  },
});
