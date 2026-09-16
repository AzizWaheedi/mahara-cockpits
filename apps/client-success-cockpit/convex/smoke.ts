import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { buildOverview } from "./comms";
import {
  buildClientProfile,
  buildPerformanceOverview,
  buildSnapshot,
} from "./csm";
import { buildGapsList } from "./gaps";
import { stillsCopyProblem } from "./previews";

/** Minutes without a feed before the check fails, inside the working day. */
const STALE_AFTER_MIN = 45;
/**
 * The feed runs every 10 minutes from 06:00 to 22:00 Kuwait and hourly
 * overnight (crons on the media buyer deployment). Judging from 07:00 leaves
 * the first working-day run an hour to land before the overnight gap counts.
 */
const WORK_START_H = 7;
const WORK_END_H = 22;
const KUWAIT_OFFSET_MS = 3 * 3600_000;
/** Health rows that must all fail before the feed counts as failing, as in the ledger. */
const FAILURES_IN_A_ROW = 3;
/**
 * A health row's `ok` is false for any error in the run, including the side
 * errors of the profile builder (an expired Fathom key, a Meta account that
 * would not answer) while the roster and the profiles still landed. The media
 * buyer's ledger already alerts on those. The feed is down only when the
 * roster or the profiles themselves did not arrive.
 */
const FEED_ERROR_PREFIXES = ["client feed:", "client profiles:"];
type HealthRow = { campaigns: number; errors?: string[] };
const feedError = (r: HealthRow) =>
  (r.errors ?? []).find(e => FEED_ERROR_PREFIXES.some(p => e.startsWith(p)));
const feedDown = (r: HealthRow) =>
  r.campaigns === 0 || feedError(r) !== undefined;

/**
 * Copies of the media buyer's saved ad stills are checked once a day, in the
 * 03:00 UTC run the media buyer also uses for its own picture checks, so the
 * 15-minute check stays as cheap as it was.
 */
function dailyWindow(now = new Date()): boolean {
  return now.getUTCHours() === 3 && now.getUTCMinutes() < 15;
}

const kuwaitClock = (ms: number) =>
  new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");

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
    await t("csm.performanceOverview", () =>
      buildPerformanceOverview(ctx, true),
    );
    await t("csm.clientProfile", async () => {
      const p = await ctx.db.query("clientProfiles").first();
      if (p) await buildClientProfile(ctx, { clientName: p.clientName }, true);
    });
    await t("comms.overview", () => buildOverview(ctx, true));
    await t("gaps.list", () => buildGapsList(ctx, null));
    // A screen that renders without throwing but shows yesterday's numbers
    // is the failure the CSM acts on, so a feed that keeps failing, or stops
    // during the working day, fails the check too.
    await t("feed.fresh", async () => {
      const recent = await ctx.db
        .query("syncRuns")
        .withIndex("by_kind_at", q => q.eq("kind", "health"))
        .order("desc")
        .take(FAILURES_IN_A_ROW);
      const latest = recent[0];
      if (!latest) return;
      if (recent.length === FAILURES_IN_A_ROW && recent.every(feedDown))
        throw new Error(
          `feed failing: ${feedError(latest) ?? "no clients in the feed"}`,
        );
      const hour = new Date(Date.now() + KUWAIT_OFFSET_MS).getUTCHours();
      const working = hour >= WORK_START_H && hour < WORK_END_H;
      // Named by the last feed, not the minutes since, so the alert
      // signature stays the same until the feed recovers.
      if (working && Date.now() - latest.at > STALE_AFTER_MIN * 60_000)
        throw new Error(`no feed since ${kuwaitClock(latest.at)} Kuwait`);
    });
    if (dailyWindow())
      await t("stills copy", async () => {
        const problem = await stillsCopyProblem(ctx);
        if (problem) throw new Error(problem);
      });
    return { app: "client-success", ok: checks.every(c => c.ok), checks };
  },
});
