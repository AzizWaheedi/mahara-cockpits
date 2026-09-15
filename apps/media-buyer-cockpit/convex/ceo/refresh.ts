import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ADAPTERS } from "./registry";
import type { DailyPoint } from "./types";

/**
 * Recompute CEO sections (all, or the ones named). Adapters run one after the
 * other so Supabase and the child deployments see one query at a time. One
 * failing adapter never stops the rest.
 */
export const refreshAll = internalAction({
  args: { only: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (ctx, { only }): Promise<Record<string, string>> => {
    const report: Record<string, string> = {};
    for (const a of ADAPTERS) {
      if (only?.length && !only.includes(a.key)) continue;
      const started = Date.now();
      try {
        const res = await a.compute(ctx);
        await ctx.runMutation(internal.ceo.store.saveSection, {
          key: a.key,
          label: a.label,
          ok: true,
          payload: res.payload,
          sources: res.sources,
          ms: Date.now() - started,
        });
        const daily: DailyPoint[] = res.daily ?? [];
        for (let i = 0; i < daily.length; i += 400)
          await ctx.runMutation(internal.ceo.store.saveDaily, {
            points: daily.slice(i, i + 400),
          });
        report[a.key] =
          `ok ${Date.now() - started}ms, ${daily.length} daily points`;
      } catch (e) {
        const error = String(e instanceof Error ? e.message : e).slice(0, 400);
        await ctx.runMutation(internal.ceo.store.saveSection, {
          key: a.key,
          label: a.label,
          ok: false,
          error,
          sources: [],
          ms: Date.now() - started,
        });
        report[a.key] = `FAILED ${error}`;
      }
    }
    return report;
  },
});
