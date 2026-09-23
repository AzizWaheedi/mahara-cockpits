import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { buildSnapshot } from "./cockpit";
import { bridge } from "./comms";
import { AZIZ_SLACK_ID } from "./constants";
import { scheduledJobHealth } from "./cronFreshness";
import { flush, recordManyDirect } from "./health";
import { runRotCheck } from "./previews";
import { callTool } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: check payloads
type Any = any;
declare const process: { env: Record<string, string | undefined> };

// Aziz's Slack user id: posting to a user id opens the DM; the old D… channel id
// belonged to another bot and returns channel_not_found. ALERT_SLACK_TO overrides.
const AZIZ_DM = process.env.ALERT_SLACK_TO || AZIZ_SLACK_ID;
const RE_ALERT_AFTER_H = 6;

/** Lines from the health ledger, delivered to Aziz's DM. */
export const slackLines = internalAction({
  args: { texts: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { texts }) => {
    for (const text of texts) {
      try {
        await callTool("coworker_send_slack_message", {
          channel_id: AZIZ_DM,
          text,
        });
      } catch (e) {
        console.error(`slack alert failed: ${String(e).slice(0, 120)}`);
      }
    }
    return null;
  },
});

/** This cockpit's own screens, without a signed-in user. */
export const local = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const checks: Any[] = [];
    const t0 = Date.now();
    try {
      await buildSnapshot(ctx, true);
      checks.push({ name: "cockpit.snapshot", ok: true, ms: Date.now() - t0 });
    } catch (e) {
      checks.push({
        name: "cockpit.snapshot",
        ok: false,
        error: String(e).slice(0, 300),
        ms: Date.now() - t0,
      });
    }
    return { app: "media-buyer", ok: checks.every(c => c.ok), checks };
  },
});

export const alerted = internalQuery({
  args: { signature: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { signature }) => {
    const row = await ctx.db
      .query("alerts")
      .withIndex("by_signature", q => q.eq("signature", signature))
      .order("desc")
      .first();
    return row?.at ?? null;
  },
});

export const remember = internalMutation({
  args: { signature: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { signature, text }) => {
    await ctx.db.insert("alerts", { signature, text, at: Date.now() });
    return null;
  },
});

/**
 * Every 15 minutes: run the main screen queries of all three cockpits the
 * way a browser would, and tell Aziz on Slack the first time one breaks.
 * Aziz, 2026-09-10: "make sure it doesn't happen again."
 */
export const check = internalAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const results: Any[] = [];
    const local: Any = await ctx.runQuery(internal.smoke.local, {});
    // Once a day (the 03:07 UTC run): do the saved ad pictures still load, and
    // does every winner and live ad have one? Its lines join this cockpit's
    // checks, so the Slack alert, the health record and the watchdog see them.
    const clock = new Date();
    if (clock.getUTCHours() === 3 && clock.getUTCMinutes() < 15) {
      try {
        const rot = await runRotCheck(ctx);
        local.checks = [...(local.checks ?? []), ...rot.checks];
        local.ok = Boolean(local.ok) && rot.ok;
      } catch (e) {
        local.checks = [
          ...(local.checks ?? []),
          {
            name: "previews check",
            ok: false,
            error: String(e).slice(0, 300),
          },
        ];
        local.ok = false;
      }
    }
    results.push(local);
    for (const app of ["csm", "creative"] as const) {
      try {
        results.push(await bridge(app, "smoke", {}));
      } catch (e) {
        results.push({
          app,
          ok: false,
          checks: [
            { name: "bridge", ok: false, error: String(e).slice(0, 300) },
          ],
        });
      }
    }
    for (const r of results)
      await ctx.runMutation(internal.portal.recordHealth, {
        app: String(r.app),
        ok: Boolean(r.ok),
        checks: r.checks ?? [],
      });
    const failures = results.flatMap((r: Any) =>
      (r.checks ?? [])
        .filter((c: Any) => !c.ok)
        .map((c: Any) => ({ app: r.app, name: c.name, error: c.error })),
    );
    for (const f of failures) {
      const signature = `${f.app}:${f.name}:${String(f.error).slice(0, 80)}`;
      const last = await ctx.runQuery(internal.smoke.alerted, { signature });
      if (last && Date.now() - last < RE_ALERT_AFTER_H * 3600_000) continue;
      const text = `Cockpit check failed: ${f.app} → ${f.name}\n${f.error}`;
      try {
        await callTool("coworker_send_slack_message", {
          channel_id: AZIZ_DM,
          text,
        });
      } catch (e) {
        console.error(`slack alert failed: ${String(e).slice(0, 120)}`);
      }
      await ctx.runMutation(internal.smoke.remember, { signature, text });
      // And a job for Hermes to go and fix it.
      try {
        await ctx.runMutation(internal.fixRequests.file, {
          source: "smoke check",
          app: String(f.app),
          title: `${f.name} throws`,
          detail: String(f.error),
        });
      } catch (e) {
        console.error(`fix request failed: ${String(e).slice(0, 120)}`);
      }
    }
    console.log(
      `smoke: ${results.map((r: Any) => `${r.app} ${r.ok ? "ok" : "FAILED"}`).join(" · ")}`,
    );
    // Hermes watchdog: jobs waiting and no poll for ten minutes is an outage.
    try {
      const w: Any = await ctx.runQuery(internal.askAi.waiting, {});
      if (
        w.queued > 0 &&
        w.lastPollAt &&
        Date.now() - w.lastPollAt > 10 * 60_000
      )
        await recordManyDirect(ctx, [
          {
            source: "hermes",
            ok: false,
            error: `${w.queued} job(s) waiting, last poll ${Math.round((Date.now() - w.lastPollAt) / 60_000)} min ago`,
          },
        ]);
    } catch (e) {
      console.error(`hermes watchdog: ${String(e).slice(0, 120)}`);
    }
    // Jobs that stopped running are an outage nobody sees in a screen.
    try {
      const stale: Any[] = await ctx.runQuery(internal.health.staleJobs, {});
      await recordManyDirect(ctx, scheduledJobHealth(stale));
    } catch (e) {
      console.error(`stale jobs: ${String(e).slice(0, 120)}`);
    }
    await flush(ctx);
    return { ok: failures.length === 0, failures, results };
  },
});
