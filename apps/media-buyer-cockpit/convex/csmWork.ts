import { v } from "convex/values";
import { whatWeDid } from "../src/lib/clientUpdate";
import { internalQuery } from "./_generated/server";
import { kuwaitDay } from "./changeResultsCore";
import { normTight } from "./clientData";

/**
 * What the team did for each client this week, for the client success
 * cockpit's "What we did this week" message.
 *
 * Aziz, 2026-09-27: the CSM's touchpoints should pull "in the updates from
 * the ads management, the client success board, and maybe the video
 * pipeline, and help them proactively communicate ... actually telling them
 * what we've done". This is the ads half: the media buyer's decisions and
 * the change log, only the kinds a client can be told (lib/clientUpdate.ts),
 * and how the campaign is doing, without leads or cost per lead. The videos
 * and the board are read from ClickUp in fanout.ts.
 */

type AdsWeek = {
  client: string;
  /** Changes a client can be told, oldest first: the cockpit's own labels. */
  ads: { at: number; label: string }[];
  /** The biggest spender's 7-day call. */
  verdict?: string;
  /** The client's own 7-day bookings (every campaign carries the same count). */
  bookings: number;
  /** False for Done With You: they book their own appointments. */
  weBook: boolean;
  /** When the media buyer last sent them an update herself. */
  toldAt?: number;
};

export const adsWeek = internalQuery({
  args: { since: v.number() },
  returns: v.any(),
  handler: async (ctx, { since }): Promise<AdsWeek[]> => {
    const campaigns = (await ctx.db.query("campaigns").collect()).filter(
      c => !c.internal,
    );
    const clientOf = new Map<string, string>();
    const byClient = new Map<string, AdsWeek & { spend: number }>();
    for (const c of campaigns) {
      const client = String(c.clientName ?? c.campaignName);
      clientOf.set(c.campaignName, client);
      const key = normTight(client);
      const w = byClient.get(key) ?? {
        client,
        ads: [],
        bookings: 0,
        weBook: false,
        spend: -1,
      };
      if ((c.spend7d ?? 0) > w.spend) {
        w.spend = c.spend7d ?? 0;
        w.verdict = c.verdict;
      }
      w.bookings = Math.max(w.bookings, Number(c.bookings7d ?? 0));
      w.weBook ||= c.serviceMode !== "DWY";
      byClient.set(key, w);
    }
    // A build is filed under the client's name rather than a campaign's.
    const weekOf = (campaignName: string) =>
      byClient.get(normTight(clientOf.get(campaignName) ?? campaignName));

    const decisions = await ctx.db
      .query("decisions")
      .withIndex("by_day", q => q.gte("day", kuwaitDay(since)))
      .collect();
    for (const d of decisions) {
      if (d.role !== "media_buyer") continue;
      const w = weekOf(d.subject);
      if (!w) continue;
      const at = d.loggedAt ?? d._creationTime;
      if (d.kind === "touch") w.toldAt = Math.max(w.toldAt ?? 0, at);
      else if (d.kind !== "left" && whatWeDid(d.action, "en") !== null)
        w.ads.push({ at, label: d.action });
    }
    const changes = await ctx.db
      .query("manualChanges")
      .withIndex("by_at", q => q.gte("at", since))
      .collect();
    for (const m of changes) {
      const w = weekOf(m.campaignName);
      if (w && whatWeDid(m.what, "en") !== null)
        w.ads.push({ at: m.at, label: m.what });
    }
    return [...byClient.values()].map(({ spend: _spend, ...w }) => ({
      ...w,
      ads: w.ads.sort((a, b) => a.at - b.at),
    }));
  },
});

/**
 * Each client card's aliases (clientLinks, stored by the creative feed just
 * before this one), so a video tagged "liwan" finds "Liwan Limited".
 */
export const clientAliases = internalQuery({
  args: {},
  returns: v.array(
    v.object({ name: v.string(), aliases: v.array(v.string()) }),
  ),
  handler: async ctx =>
    (await ctx.db.query("clientLinks").collect()).map(r => ({
      name: r.name,
      aliases: r.aliases,
    })),
});
