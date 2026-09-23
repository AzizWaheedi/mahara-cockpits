import { v } from "convex/values";
import {
  compareChange,
  kuwaitDay,
  shiftDay,
  windowResult,
} from "./changeResultsCore";
import { authenticatedQuery } from "./functions";
import { assertScope } from "./gate";
import { assertRole } from "./roles";

const MEANINGFUL =
  /budget|targeting|bid strategy|optimisation goal|optimization goal|created|ad updated|campaign status updated|ad set status updated/i;
const HOUSEKEEPING =
  /name updated|finishes ad review|billed|delivered|balance/i;

/** The existing Meta and manual histories, each with a guarded observed result. */
export const forCampaign = authenticatedQuery({
  args: { campaignName: v.string() },
  returns: v.any(),
  handler: async (ctx, { campaignName }) => {
    await assertRole(ctx, "media_buyer");
    await assertScope(ctx, { campaignName });
    const cutoff =
      Date.parse(`${shiftDay(kuwaitDay(Date.now()), -14)}T00:00:00Z`) -
      3 * 3_600_000;
    const [meta, manual, daily, bookings] = await Promise.all([
      ctx.db
        .query("adChanges")
        .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
        .collect(),
      ctx.db
        .query("manualChanges")
        .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
        .collect(),
      ctx.db
        .query("dailyStats")
        .withIndex("by_campaign_date", q =>
          q
            .eq("campaignName", campaignName)
            .gte("date", shiftDay(kuwaitDay(Date.now()), -18)),
        )
        .collect(),
      ctx.db
        .query("bookingEvents")
        .withIndex("by_campaign_date", q =>
          q
            .eq("campaignName", campaignName)
            .gte("date", shiftDay(kuwaitDay(Date.now()), -18)),
        )
        .collect(),
    ]);
    const changes = [
      ...meta
        .filter(
          row =>
            row.at >= cutoff &&
            row.actor &&
            row.actor !== "Meta" &&
            MEANINGFUL.test(row.eventType) &&
            !HOUSEKEEPING.test(row.eventType),
        )
        .map(row => ({
          id: `meta:${row.activityHash ?? row._id}`,
          source: "Meta" as const,
          at: row.at,
          actor: row.actor ?? "Unknown",
          label: row.objectName
            ? `${row.eventType} · ${row.objectName}`
            : row.eventType,
        })),
      ...manual
        .filter(row => row.at >= cutoff)
        .map(row => ({
          id: `manual:${row._id}`,
          source: "Buyer note" as const,
          at: row.at,
          actor: row.by,
          label: row.adName ? `${row.what} · ${row.adName}` : row.what,
        })),
    ].sort((a, b) => b.at - a.at);
    const at = changes.map(row => ({ id: row.id, at: row.at }));
    return {
      changes: changes.slice(0, 15).map(row => ({
        ...row,
        result: compareChange(row, at, daily, bookings, Date.now()),
      })),
      periodDays: 14,
      source:
        "Meta activity and buyer notes; spend and leads from the daily ad feed; matched bookings from GHL.",
    };
  },
});

/** One linked creative launch, measured with the same window and caveats. */
export const forCreativeLaunch = authenticatedQuery({
  args: {
    campaignName: v.string(),
    sourceAdId: v.string(),
    launchedAdId: v.string(),
    launchedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    await assertScope(ctx, { campaignName: args.campaignName });
    if (
      !Number.isFinite(args.launchedAt) ||
      args.launchedAt > Date.now() + 86_400_000
    )
      throw new Error("The launch date is invalid.");
    const day = kuwaitDay(args.launchedAt);
    const from = shiftDay(day, -3);
    const to = shiftDay(day, 3);
    const [daily, bookings, meta, manual] = await Promise.all([
      ctx.db
        .query("dailyStats")
        .withIndex("by_campaign_date", q =>
          q
            .eq("campaignName", args.campaignName)
            .gte("date", from)
            .lte("date", to),
        )
        .collect(),
      ctx.db
        .query("bookingEvents")
        .withIndex("by_campaign_date", q =>
          q
            .eq("campaignName", args.campaignName)
            .gte("date", from)
            .lte("date", to),
        )
        .collect(),
      ctx.db
        .query("adChanges")
        .withIndex("by_campaign", q => q.eq("campaignName", args.campaignName))
        .collect(),
      ctx.db
        .query("manualChanges")
        .withIndex("by_campaign", q => q.eq("campaignName", args.campaignName))
        .collect(),
    ]);
    const otherChanges = [
      ...meta
        .filter(
          row =>
            row.objectId !== args.launchedAdId &&
            row.actor &&
            row.actor !== "Meta" &&
            MEANINGFUL.test(row.eventType) &&
            !HOUSEKEEPING.test(row.eventType),
        )
        .map(row => ({ id: `meta:${row._id}`, at: row.at })),
      ...manual.map(row => ({ id: `manual:${row._id}`, at: row.at })),
    ];
    const campaign = compareChange(
      { id: "creative-launch", at: args.launchedAt },
      otherChanges,
      daily,
      bookings,
      Date.now(),
    );
    return {
      campaign,
      sourceBefore: windowResult(
        campaign.before.from,
        campaign.before.to,
        daily.filter(row => row.metaAdId === args.sourceAdId),
        bookings.filter(row => row.adId === args.sourceAdId),
      ),
      replacementAfter: windowResult(
        campaign.after.from,
        campaign.after.to,
        daily.filter(row => row.metaAdId === args.launchedAdId),
        bookings.filter(row => row.adId === args.launchedAdId),
      ),
    };
  },
});
