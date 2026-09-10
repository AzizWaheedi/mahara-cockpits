import { v } from "convex/values";
import { api } from "./_generated/api";
import { internalQuery } from "./_generated/server";

/** Runs the queries behind the main screens and reports which ones throw. */
export const run = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const checks: { name: string; ok: boolean; error?: string; ms: number }[] =
      [];
    const t = async (name: string, fn: () => Promise<unknown>) => {
      const t0 = Date.now();
      try {
        await fn();
        checks.push({ name, ok: true, ms: Date.now() - t0 });
      } catch (e) {
        checks.push({
          name,
          ok: false,
          error: String(e).slice(0, 300),
          ms: Date.now() - t0,
        });
      }
    };
    await t("creative.snapshot", () => ctx.runQuery(api.creative.snapshot, {}));
    await t("comms.overview", () => ctx.runQuery(api.comms.overview, {}));
    return { app: "creative", ok: checks.every(c => c.ok), checks };
  },
});
