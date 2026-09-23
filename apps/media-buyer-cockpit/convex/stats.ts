import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { assertScope } from "./gate";
import { allowedClients, assertRole } from "./roles";

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
    // The first and the last day on record are the two ends of the date
    // index: two documents. This read twenty thousand to find them, and as a
    // live query it did so for every open screen on every sync.
    const first = await ctx.db
      .query("dailyStats")
      .withIndex("by_date")
      .order("asc")
      .first();
    if (!first) return { first: null, last: null, rows: null };
    const last = await ctx.db
      .query("dailyStats")
      .withIndex("by_date")
      .order("desc")
      .first();
    // `rows` was a count and nothing on screen reads it; counting needs the
    // whole table, so it is no longer computed.
    return { first: first.date, last: last?.date ?? first.date, rows: null };
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

/**
 * Trends for the start-of-day screen: spend, leads and cost per lead per
 * day across every campaign this person may see, last 30 days.
 */
export const portfolioTrend = authenticatedQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const scope = await allowedClients(ctx);
    const campaigns = await ctx.db.query("campaigns").collect();
    const allowed = new Set(
      campaigns
        .filter(
          c =>
            !c.internal &&
            (!scope ||
              scope.has(
                String(c.clientName ?? c.accountName ?? "").toLowerCase(),
              )),
        )
        .map(c => c.campaignName),
    );
    const since = new Date(Date.now() - 30 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const byDate = new Map<string, { spend: number; leads: number }>();
    // Thirty days, read as thirty days. This read the whole table and threw
    // eleven months of it away, for every open screen, on every sync.
    for (const d of await ctx.db
      .query("dailyStats")
      .withIndex("by_date", q => q.gte("date", since))
      .collect()) {
      if (!allowed.has(d.campaignName)) continue;
      const row = byDate.get(d.date) ?? { spend: 0, leads: 0 };
      row.spend += Number(d.spend ?? 0);
      row.leads += Number(d.leads ?? 0);
      byDate.set(d.date, row);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, r]) => ({
        date,
        spend: Math.round(r.spend * 100) / 100,
        leads: r.leads,
        cpl: r.leads ? Math.round((r.spend / r.leads) * 100) / 100 : null,
      }));
  },
});

/** One campaign's daily spend, leads and cost per lead for a range. */
export const campaignTrend = authenticatedQuery({
  args: { campaignName: v.string(), start: v.string(), end: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    await assertScope(ctx, { campaignName: args.campaignName });
    const byDate = new Map<string, { spend: number; leads: number }>();
    for (const d of await ctx.db
      .query("dailyStats")
      .withIndex("by_campaign_date", q =>
        q.eq("campaignName", args.campaignName),
      )
      .collect()) {
      if (d.date < args.start || d.date > args.end) continue;
      const row = byDate.get(d.date) ?? { spend: 0, leads: 0 };
      row.spend += Number(d.spend ?? 0);
      row.leads += Number(d.leads ?? 0);
      byDate.set(d.date, row);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, r]) => ({
        date,
        spend: Math.round(r.spend * 100) / 100,
        leads: r.leads,
        cpl: r.leads ? Math.round((r.spend / r.leads) * 100) / 100 : null,
      }));
  },
});
