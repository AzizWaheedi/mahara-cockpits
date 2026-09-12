import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { buildDetail, buildRoster } from "./clients";
import { buildOverview } from "./comms";
import { buildCalendar, buildScriptQueue, buildSnapshot } from "./creative";
import { buildFunnels } from "./funnels";
import {
  buildCreativePatterns,
  buildDimensions,
  buildMarketWinners,
  buildPlaybook,
} from "./market";
import { buildFreshness } from "./sync";
import { buildWinnersList } from "./winners";

/**
 * Runs the queries behind every screen the way the browser would, minus the
 * sign-in, and reports which ones throw. Called through the bridge by the
 * media buyer backend every 15 minutes; a failure there becomes a Slack DM
 * and a fix job for Hermes. Never throws itself.
 *
 * Each screen runs in its own transaction, like a browser tab does. One
 * transaction for all of them would count every repeated table scan against
 * Convex's per-transaction read cap and could fail the whole check on a
 * deployment where the screens themselves are fine.
 */
const CHECKS = [
  "creative.snapshot",
  "comms.overview",
  "clients.roster",
  "clients.detail",
  "funnels.list (client)",
  "creative.calendar",
  "creative.scriptQueue",
  "market.playbook",
  "market.dimensions",
  "market.creativePatterns",
  "market.winners",
  "funnels.list",
  "winners.list",
  "sync.freshness",
] as const;

/** The two checks that need a client name from the roster check. */
const PER_CLIENT = new Set<string>(["clients.detail", "funnels.list (client)"]);

type Check = {
  name: string;
  ok: boolean;
  error?: string;
  /** Worth showing in the admin view, but not a failure. */
  note?: string;
  ms: number;
};
type Result = { app: string; ok: boolean; checks: Check[] };

export const run = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Result> => {
    const checks: Check[] = [];
    let firstClient: string | undefined;
    for (const name of CHECKS) {
      if (PER_CLIENT.has(name) && !firstClient) continue;
      const t0 = Date.now();
      try {
        const out: {
          firstClient?: string | null;
          note?: string | null;
        } | null = await ctx.runQuery(internal.smoke.one, {
          name,
          client: firstClient,
        });
        if (name === "clients.roster")
          firstClient = out?.firstClient ?? undefined;
        const check: Check = { name, ok: true, ms: Date.now() - t0 };
        if (out?.note) check.note = out.note;
        checks.push(check);
      } catch (e) {
        checks.push({
          name,
          ok: false,
          error: String(e).slice(0, 300),
          ms: Date.now() - t0,
        });
      }
    }
    return { app: "creative", ok: checks.every(c => c.ok), checks };
  },
});

/**
 * One screen query, by name, in its own transaction. Returns nothing except
 * for the roster, which hands back the first client so the per-client checks
 * have a name to run against, and the freshness check, which hands back a
 * note when the feed is late.
 */
export const one = internalQuery({
  args: { name: v.string(), client: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { name, client }) => {
    switch (name) {
      case "creative.snapshot":
        await buildSnapshot(ctx, null);
        return null;
      case "comms.overview":
        await buildOverview(ctx, true);
        return null;
      case "clients.roster": {
        const r = await buildRoster(ctx, null);
        return { firstClient: r?.clients?.[0]?.name ?? null };
      }
      case "clients.detail":
        if (client) await buildDetail(ctx, client, null);
        return null;
      case "funnels.list (client)":
        if (client) await buildFunnels(ctx, client, null);
        return null;
      case "creative.calendar":
        await buildCalendar(ctx, null);
        return null;
      case "creative.scriptQueue":
        await buildScriptQueue(ctx, null);
        return null;
      case "market.playbook":
        await buildPlaybook(ctx, {});
        return null;
      case "market.dimensions":
        await buildDimensions(ctx);
        return null;
      case "market.creativePatterns":
        await buildCreativePatterns(ctx, {});
        return null;
      case "market.winners":
        await buildMarketWinners(ctx, {});
        return null;
      case "funnels.list":
        await buildFunnels(ctx, undefined, null);
        return null;
      case "winners.list":
        await buildWinnersList(ctx, {});
        return null;
      case "sync.freshness": {
        // A late feed is a note, not a failure. Failing here would file a
        // fix job for Hermes against this app, where there is nothing to
        // fix: the media buyer's own job watchdog (health.staleJobs) owns a
        // sync that stopped, and some fanout steps keep old rows on purpose
        // (no live lead forms, an empty Meta tree).
        const f = await buildFreshness(ctx);
        return {
          note: f.stale.length
            ? `feed stale (expected ${f.cadence}): ${f.stale.join(", ")}`
            : null,
        };
      }
      default:
        throw new Error(`unknown smoke check: ${name}`);
    }
  },
});
