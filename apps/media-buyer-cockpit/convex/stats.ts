import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { assertScope } from "./gate";
import { assertRole } from "./roles";

/**
 * Any date range, at every level.
 *
 * The cockpit's headline numbers are a fixed 7-day window, which is the right
 * default and the wrong answer whenever the question is "what did we do
 * today?" or "how did last week compare?". This reads the raw daily grain
 * (`dailyStats`) and the attributed bookings (`bookingEvents`) and folds them
 * to whatever range is asked for, at campaign, ad set and ad level.
 * [aziz, 2026-09-07]
 */

/** Below this many impressions, link CTR and CPM are noise. Matches sync.ts. */
const MIN_IMPRESSIONS_FOR_RATE_CALLS = 1000;
const MIN_LINK_CLICKS_FOR_OPTIN = 50;

type Bucket = {
  key: string;
  spend: number;
  leads: number;
  impressions: number;
  linkClicks: number;
  frequency?: number;
  bookings: number;
  showed: number;
  /** False when no booking in this bucket could be tied to an ad. */
  bookingsAttributed: boolean;
  adIds: string[];
};

function empty(key: string): Bucket {
  return {
    key,
    spend: 0,
    leads: 0,
    impressions: 0,
    linkClicks: 0,
    frequency: undefined,
    bookings: 0,
    showed: 0,
    bookingsAttributed: true,
    adIds: [],
  };
}

function finish(b: Bucket) {
  const rateable = b.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS;
  return {
    key: b.key,
    spend: b.spend,
    leads: b.leads,
    impressions: b.impressions,
    linkClicks: b.linkClicks,
    cpl: b.leads > 0 ? b.spend / b.leads : undefined,
    linkCtr: rateable ? (b.linkClicks / b.impressions) * 100 : undefined,
    cpm: rateable ? (b.spend / b.impressions) * 1000 : undefined,
    optInRate:
      b.linkClicks >= MIN_LINK_CLICKS_FOR_OPTIN
        ? (b.leads / b.linkClicks) * 100
        : undefined,
    frequency: b.frequency,
    bookings: b.bookings,
    showed: b.showed,
    // A cost per booking of "infinity" is not a number, it is a warning; we
    // return undefined and the screen says so in words.
    costPerBooking: b.bookings > 0 ? b.spend / b.bookings : undefined,
    bookingRate: b.leads > 0 ? (b.bookings / b.leads) * 100 : undefined,
    bookingsAttributed: b.bookingsAttributed,
    adIds: b.adIds,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: shared by the public and internal wrappers
async function computeRange(
  // biome-ignore lint/suspicious/noExplicitAny: query ctx
  ctx: any,
  {
    campaignName,
    start,
    end,
  }: { campaignName: string; start: string; end: string },
) {
  {
    const rows = await ctx.db
      .query("dailyStats")
      .withIndex("by_campaign_date", (q: any) =>
        q.eq("campaignName", campaignName).gte("date", start).lte("date", end),
      )
      .collect();
    const bookings = await ctx.db
      .query("bookingEvents")
      .withIndex("by_campaign_date", (q: any) =>
        q.eq("campaignName", campaignName).gte("date", start).lte("date", end),
      )
      .collect();

    const total = empty("total");
    const bySet = new Map<string, Bucket>();
    const byAd = new Map<string, Bucket>();
    // Ad id -> its ad set, so an attributed booking can be credited upward.
    const setOfAd = new Map<string, string>();
    const adNameOfId = new Map<string, string>();
    const days = new Set<string>();

    for (const r of rows) {
      days.add(r.date);
      const setName = r.adSetName ?? "unnamed ad set";
      const s = bySet.get(setName) ?? empty(setName);
      const a = byAd.get(r.adName) ?? empty(r.adName);
      for (const b of [total, s, a]) {
        b.spend += r.spend;
        b.leads += r.leads;
        b.impressions += r.impressions;
        b.linkClicks += r.linkClicks;
        if (r.frequency !== undefined) {
          b.frequency = Math.max(b.frequency ?? 0, r.frequency);
        }
      }
      if (r.metaAdId) {
        setOfAd.set(r.metaAdId, setName);
        adNameOfId.set(r.metaAdId, r.adName);
        if (!a.adIds.includes(r.metaAdId)) a.adIds.push(r.metaAdId);
        if (!s.adIds.includes(r.metaAdId)) s.adIds.push(r.metaAdId);
        if (!total.adIds.includes(r.metaAdId)) total.adIds.push(r.metaAdId);
      }
      bySet.set(setName, s);
      byAd.set(r.adName, a);
    }

    let attributed = 0;
    for (const b of bookings) {
      total.bookings += 1;
      if (b.status === "showed") total.showed += 1;
      const adName = b.adId ? adNameOfId.get(b.adId) : undefined;
      const setName = b.adId ? setOfAd.get(b.adId) : undefined;
      if (b.adId) attributed += 1;
      if (setName) {
        const s = bySet.get(setName);
        if (s) {
          s.bookings += 1;
          if (b.status === "showed") s.showed += 1;
        }
      }
      if (adName) {
        const a = byAd.get(adName);
        if (a) {
          a.bookings += 1;
          if (b.status === "showed") a.showed += 1;
        }
      }
    }
    // Ad set and ad level cost per booking is only honest when the bookings in
    // this range could actually be traced to an ad. If none could, say nothing
    // rather than print a number that is really the campaign's.
    const anyAttributed = attributed > 0;
    for (const b of [...bySet.values(), ...byAd.values()]) {
      b.bookingsAttributed = anyAttributed;
    }

    return {
      campaignName,
      start,
      end,
      days: days.size,
      hasData: rows.length > 0,
      total: finish(total),
      bookingsTotal: bookings.length,
      bookingsAttributed: attributed,
      adSets: [...bySet.values()].map(finish).sort((x, y) => y.spend - x.spend),
      ads: [...byAd.values()].map(finish).sort((x, y) => y.spend - x.spend),
    };
  }
}

export const range = authenticatedQuery({
  args: {
    campaignName: v.string(),
    /** Inclusive, YYYY-MM-DD, Kuwait days — the same days the sheet stores. */
    start: v.string(),
    end: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    // The campaign name comes straight from the client; check its client is
    // on this person's list before computing anything.
    await assertScope(ctx, { campaignName: args.campaignName });
    return computeRange(ctx, args);
  },
});

/** Same numbers, callable from a script or a stress test. */
export const rangeInternal = internalQuery({
  args: { campaignName: v.string(), start: v.string(), end: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => computeRange(ctx, args),
});

/** The days we actually hold, so the picker cannot offer an empty range. */
export const coverage = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const rows = await ctx.db.query("dailyStats").take(20000);
    if (rows.length === 0) return { first: null, last: null, rows: 0 };
    let first = rows[0].date;
    let last = rows[0].date;
    for (const r of rows) {
      if (r.date < first) first = r.date;
      if (r.date > last) last = r.date;
    }
    return { first, last, rows: rows.length };
  },
});

/** Operational counts for the grain tables. Internal: for checks, not the UI. */
export const grainCounts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const daily = await ctx.db.query("dailyStats").take(30000);
    const bookings = await ctx.db.query("bookingEvents").take(10000);
    const campaigns = new Set(daily.map(d => d.campaignName));
    const dates = [...new Set(daily.map(d => d.date))].sort();
    return {
      dailyRows: daily.length,
      campaigns: campaigns.size,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      bookings: bookings.length,
      bookingsWithAd: bookings.filter(b => b.adId).length,
      bookingCampaigns: new Set(bookings.map(b => b.campaignName)).size,
    };
  },
});

/** Launch watch snapshot, for checks from a script. */
export const launchSummary = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("launchWatch").collect();
    const onb = await ctx.db.query("onboardings").collect();
    return {
      launching: rows.length,
      withAccount: rows.filter(r => r.accountId).length,
      withTask: rows.filter(r => r.hasTask).length,
      spending: rows.filter(r => r.spend7d > 0).length,
      onboardings: onb.map(o => ({
        client: o.client,
        accountId: o.accountId ?? null,
        accountName: o.accountName ?? null,
        source: o.accountIdSource ?? null,
      })),
    };
  },
});

/** Service mode per campaign, for verifying the DFY/DWY split. */
export const modes = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const cs = await ctx.db.query("campaigns").collect();
    return cs.map(c => ({
      client: c.clientName ?? c.accountName,
      mode: c.serviceMode ?? null,
      cpl: c.cpl ?? null,
      bookings: c.bookings7d ?? null,
      cpb: c.costPerBooking ?? null,
    }));
  },
});
