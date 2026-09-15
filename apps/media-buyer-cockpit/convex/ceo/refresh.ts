import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ADAPTERS } from "./registry";
import type { Adapter, DailyPoint } from "./types";

/**
 * How long one section may take. Creative Triage can hang for minutes when it
 * is degraded (2026-09-15: its gateway returned 524 after 100 s), and one slow
 * source must not hold back the rest. A section that runs out of time keeps
 * its last good payload and shows the error.
 */
const SECTION_BUDGET_MS = 150_000;

function withBudget<T>(p: Promise<T>, key: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `${key} took longer than ${SECTION_BUDGET_MS / 1000} s; a source is slow or down`,
          ),
        ),
      SECTION_BUDGET_MS,
    );
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Recompute CEO sections (all, or the ones named). Sections run at the same
 * time, each within its budget, so the refresh takes as long as the slowest
 * section instead of the sum. One failing section never stops the rest.
 */
export const refreshAll = internalAction({
  args: { only: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (ctx, { only }): Promise<Record<string, string>> => {
    const report: Record<string, string> = {};
    const run = async (a: Adapter) => {
      const started = Date.now();
      try {
        const res = await withBudget(a.compute(ctx), a.key);
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
    };
    await Promise.all(
      ADAPTERS.filter(a => !only?.length || only.includes(a.key)).map(run),
    );
    return report;
  },
});
