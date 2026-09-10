import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { graph } from "./tools";

/**
 * Dry-run every cockpit write path against the live ad accounts.
 *
 * Read-only on purpose: for each campaign it resolves exactly what each button
 * would touch and whether Meta would accept it, without writing anything. The
 * point is to find the campaigns where a button would fail *before* the media
 * buyer finds them. [aziz, 2026-09-06]
 */
export const probe = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const perf: any = await ctx.runQuery(internal.stress.board);
    const rows: any[] = [];

    for (const c of perf.campaigns) {
      const row: any = { campaign: c.campaignName, client: c.clientName };
      const cid = c.metaCampaignId;
      if (!cid) {
        row.blocked = "no Meta campaign id synced";
        rows.push(row);
        continue;
      }

      try {
        const camp = await graph<any>(cid, {
          fields: "name,status,effective_status,daily_budget,lifetime_budget",
        });
        row.pause = camp.status ? "ok" : "no status field";

        // Where would a scale step land?
        if (camp.daily_budget) {
          row.scale = `campaign budget $${(Number(camp.daily_budget) / 100).toFixed(0)}/d → $${(
            (Number(camp.daily_budget) / 100) * 1.25
          ).toFixed(0)}/d`;
        } else if (camp.lifetime_budget) {
          row.scale = "REFUSES — lifetime budget";
        } else {
          const sets = await graph<any>(`${cid}/adsets`, {
            fields: "name,daily_budget,status",
            limit: "50",
          });
          const all = sets.data ?? [];
          const live = all.filter((s: any) => s.status === "ACTIVE");
          const pool = live.length > 0 ? live : all;
          if (pool.length === 0) row.scale = "REFUSES — no ad sets";
          else if (pool.length > 1)
            row.scale = `ASKS HER — ${pool.length} active ad sets`;
          else if (!pool[0].daily_budget)
            row.scale = "REFUSES — ad set has no daily budget";
          else
            row.scale = `ad set $${(Number(pool[0].daily_budget) / 100).toFixed(0)}/d → $${(
              (Number(pool[0].daily_budget) / 100) * 1.25
            ).toFixed(0)}/d`;
        }

        // Cut the worst ad
        const ads = await graph<any>(`${cid}/ads`, {
          fields:
            "name,effective_status,insights.date_preset(last_7d){spend,actions}",
          limit: "50",
        });
        const live = (ads.data ?? []).filter(
          (a: any) => a.effective_status === "ACTIVE",
        );
        const spent = live.filter(
          (a: any) => Number(a.insights?.data?.[0]?.spend ?? 0) > 0,
        );
        row.liveAds = live.length;
        if (live.length <= 1) row.cut = `REFUSES — only ${live.length} live`;
        else if (spent.length === 0) row.cut = "REFUSES — no spend in 7d";
        else row.cut = `ok — ${spent.length}/${live.length} scoreable`;

        // Copy test / add creative: is the creative spec readable?
        let copyable = 0;
        const sample = live.slice(0, 5);
        for (const a of sample) {
          const cr = await graph<any>(a.id, {
            fields: "creative{object_story_spec}",
          });
          if (cr.creative?.object_story_spec) copyable++;
        }
        row.copyTest =
          sample.length === 0
            ? "no live ads"
            : copyable === sample.length
              ? `ok — ${copyable}/${sample.length}`
              : `PARTIAL — ${copyable}/${sample.length} copyable (rest are dynamic)`;
      } catch (e) {
        row.blocked = e instanceof Error ? e.message.slice(0, 120) : String(e);
      }

      // Date ranges: does every window this campaign can be read over actually
      // return numbers, and do the parts add up to the whole? A range picker
      // that quietly returns nothing is worse than no range picker.
      // [aziz, 2026-09-07]
      try {
        const day = (n: number) =>
          new Date(Date.now() + 3 * 3600 * 1000 - n * 86400000)
            .toISOString()
            .slice(0, 10);
        const windows: [string, string, string][] = [
          ["today", day(0), day(0)],
          ["yesterday", day(1), day(1)],
          ["7d", day(6), day(0)],
          ["30d", day(29), day(0)],
        ];
        const got: string[] = [];
        let mismatch: string | undefined;
        for (const [label, start, end] of windows) {
          const r: any = await ctx.runQuery(internal.stats.rangeInternal, {
            campaignName: c.campaignName,
            start,
            end,
          });
          if (r.hasData) got.push(label);
          // Ad set spend must reconstruct the campaign spend exactly.
          const setSum = r.adSets.reduce((t: number, x: any) => t + x.spend, 0);
          const adSum = r.ads.reduce((t: number, x: any) => t + x.spend, 0);
          const off = (a: number, b: number) => Math.abs(a - b) > 0.02;
          if (off(setSum, r.total.spend) || off(adSum, r.total.spend)) {
            mismatch = `${label}: total $${r.total.spend.toFixed(2)} vs ad sets $${setSum.toFixed(2)} / ads $${adSum.toFixed(2)}`;
          }
        }
        row.ranges = got.length ? got.join(",") : "no data in any window";
        if (mismatch) row.rangeMismatch = mismatch;
      } catch (e) {
        row.rangeMismatch =
          e instanceof Error ? e.message.slice(0, 120) : String(e);
      }

      rows.push(row);
    }

    const summary = {
      campaigns: rows.length,
      pauseOk: rows.filter(r => r.pause === "ok").length,
      scaleWouldWork: rows.filter(r => r.scale?.includes("→")).length,
      scaleAsksHer: rows.filter(r => r.scale?.startsWith("ASKS")).length,
      scaleRefuses: rows.filter(r => r.scale?.startsWith("REFUSES")).length,
      cutOk: rows.filter(r => r.cut?.startsWith("ok")).length,
      cutRefuses: rows.filter(r => r.cut?.startsWith("REFUSES")).length,
      copyFullyOk: rows.filter(r => r.copyTest?.startsWith("ok")).length,
      copyPartial: rows.filter(r => r.copyTest?.startsWith("PARTIAL")).length,
      blocked: rows.filter(r => r.blocked).length,
      rangesOk: rows.filter(r => r.ranges && !r.rangeMismatch).length,
      rangeMismatches: rows.filter(r => r.rangeMismatch).length,
      noDataInAnyWindow: rows.filter(r => r.ranges === "no data in any window")
        .length,
    };
    return { summary, rows };
  },
});

export const board = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx: any) => {
    const campaigns = await ctx.db.query("campaigns").collect();
    return {
      campaigns: campaigns
        .filter((c: any) => c.onBoard)
        .map((c: any) => ({
          campaignName: c.campaignName,
          clientName: c.clientName,
          metaCampaignId: c.metaCampaignId,
        })),
    };
  },
});
