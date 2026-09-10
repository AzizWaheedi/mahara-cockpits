import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { buildOverview } from "./comms";
import { buildSnapshot } from "./csm";
import { gapsFor } from "./gaps";

/**
 * Runs the queries behind the main screens the way the browser would, minus
 * the sign-in, and reports which ones throw. Called through the bridge by
 * the media buyer backend every 15 minutes. Never throws itself.
 */
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
    await t("csm.snapshot", () => buildSnapshot(ctx, true));
    await t("comms.overview", () => buildOverview(ctx, true));
    await t("gaps.list", async () => {
      const clients = await ctx.db.query("clients").collect();
      const profiles = await ctx.db.query("clientProfiles").collect();
      const byName = new Map(profiles.map(p => [p.clientName, p]));
      for (const c of clients) gapsFor(c, byName.get(c.name));
    });
    return { app: "client-success", ok: checks.every(c => c.ok), checks };
  },
});
