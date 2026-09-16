import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { stillsWatermark } from "./previews";
import { assertRole } from "./roles";

/**
 * Ingestion for the creative director's cockpit.
 *
 * This Space deliberately has no integration credentials and no write path back
 * to ClickUp or Meta. The sandbox bridge
 * (`skills/client_onboarding_launch/scripts/sync_cockpit.py`) does all the
 * fetching and pushes finished rows in here. Keeping it read-only is what makes
 * it safe to give the creative director his own URL: there is nothing on this
 * deployment that can touch an ad account.
 */

/** Replace the client roster (Clients - Mahara). The spine for every screen. */
export const storeClients = internalMutation({
  args: { clients: v.array(v.any()) },
  returns: v.object({ clients: v.number() }),
  handler: async (ctx, { clients }) => {
    const now = Date.now();
    if (clients.length === 0) {
      throw new Error(
        "storeClients received an empty roster — refusing to wipe the spine",
      );
    }
    for (const row of await ctx.db.query("clients").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of clients) {
      await ctx.db.insert("clients", { ...row, syncedAt: now });
    }
    return { clients: clients.length };
  },
});

/** Replace the three ClickUp boards wholesale. */
export const storeCreative = internalMutation({
  args: {
    tasks: v.array(v.any()),
    videos: v.array(v.any()),
    posts: v.array(v.any()),
  },
  returns: v.object({
    tasks: v.number(),
    videos: v.number(),
    posts: v.number(),
  }),
  handler: async (ctx, { tasks, videos, posts }) => {
    const now = Date.now();

    // Refuse to blank a board. An empty array here almost always means the
    // fetch failed upstream, and overwriting good rows with nothing would make
    // the cockpit quietly lie about having no work. Same rule as the sheet
    // writes: never let a failed read look like an empty result.
    if (tasks.length === 0 && videos.length === 0 && posts.length === 0) {
      throw new Error(
        "storeCreative received three empty boards — refusing to wipe the cockpit",
      );
    }

    for (const row of await ctx.db.query("creativeTasks").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of tasks) {
      await ctx.db.insert("creativeTasks", { ...row, syncedAt: now });
    }

    for (const row of await ctx.db.query("videoJobs").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of videos) {
      await ctx.db.insert("videoJobs", { ...row, syncedAt: now });
    }

    for (const row of await ctx.db.query("contentPosts").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of posts) {
      await ctx.db.insert("contentPosts", { ...row, syncedAt: now });
    }

    return { tasks: tasks.length, videos: videos.length, posts: posts.length };
  },
});

/**
 * Mirror the media buyer's computed ad performance.
 *
 * Only the fields the creative screens read — no spend totals beyond what a
 * CPL needs, no budgets, no revenue. He sees which creative is working, not the
 * commercials of the account.
 *
 * Preview links are no longer kept (they expire in a day). Each ad carries
 * the key of its saved still and the media buyer's copies of it instead.
 * The answer includes `stillsWatermark`, which tells the media buyer which
 * saved stills this cockpit still needs.
 */
export const storeAdPerformance = internalMutation({
  args: {
    ads: v.array(v.any()),
    campaigns: v.array(v.any()),
    tree: v.optional(v.array(v.any())),
  },
  returns: v.object({
    ads: v.number(),
    campaigns: v.number(),
    stillsWatermark: v.number(),
  }),
  handler: async (ctx, { ads, campaigns, tree }) => {
    const now = Date.now();
    if (ads.length === 0) {
      throw new Error("storeAdPerformance received no ads — refusing to wipe");
    }

    for (const row of await ctx.db.query("ads").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of ads) {
      await ctx.db.insert("ads", {
        campaignName: row.campaignName,
        adName: row.adName,
        spend: row.spend,
        leads: row.leads,
        cpl: row.cpl,
        // The media buyer's ads table calls it linkCtr; older pushes sent ctr.
        ctr: row.ctr ?? row.linkCtr,
        frequency: row.frequency,
        thumbnailUrl: row.thumbnailUrl,
        metaAdId: row.metaAdId,
        stillKey: row.stillKey,
        stillUrl: row.stillUrl,
        stillTinyUrl: row.stillTinyUrl,
        syncedAt: now,
      });
    }

    for (const row of await ctx.db.query("campaigns").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of campaigns) {
      await ctx.db.insert("campaigns", {
        campaignName: row.campaignName,
        accountName: row.accountName,
        clientName: row.clientName,
        clientTag: row.clientTag,
        serviceType: row.serviceType,
        spend7d: row.spend7d,
        leads7d: row.leads7d,
        cpl: row.cpl,
        bookings7d: row.bookings7d,
        showed7d: row.showed7d,
        costPerBooking: row.costPerBooking,
        bookingRate: row.bookingRate,
        showRate: row.showRate,
        boardAdStatus: row.boardAdStatus,
        metaAccountId: row.metaAccountId,
        metaCampaignId: row.metaCampaignId,
        syncedAt: now,
      });
    }

    if (tree && tree.length) {
      for (const row of await ctx.db.query("metaTree").collect()) {
        await ctx.db.delete(row._id);
      }
      for (const row of tree) {
        await ctx.db.insert("metaTree", {
          campaignName: row.campaignName,
          kind: row.kind,
          metaId: row.metaId,
          name: row.name,
          status: row.status,
          effectiveStatus: row.effectiveStatus,
          adsetId: row.adsetId,
          thumbUrl: row.thumbUrl,
          accountId: row.accountId,
          creativeId: row.creativeId,
          stillKey: row.stillKey,
          stillUrl: row.stillUrl,
          stillTinyUrl: row.stillTinyUrl,
          syncedAt: now,
        });
      }
    }

    return {
      ads: ads.length,
      campaigns: campaigns.length,
      stillsWatermark: await stillsWatermark(ctx),
    };
  },
});

/**
 * Brand Blueprint submissions.
 *
 * This is the honest signal that creative onboarding is finished: the client
 * sat through the call and the answers exist. A closed ClickUp task only proves
 * somebody ticked a box. [aziz, 2026-09-06]
 *
 * Unlike the board tables this one does NOT refuse an empty payload — there
 * genuinely are zero submissions today, and pretending otherwise would be the
 * lie we are trying to remove.
 */
export const storeBlueprints = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ blueprints: v.number() }),
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    for (const row of await ctx.db.query("blueprints").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of rows) {
      await ctx.db.insert("blueprints", {
        responseId: row.responseId,
        client: row.client,
        submittedAt: row.submittedAt,
        brandDnaStatus: row.brandDnaStatus,
        brandDnaDoc: row.brandDnaDoc,
        offerSheet: row.offerSheet,
        stillMissing: row.stillMissing,
        approvalNeeded: row.approvalNeeded,
        editor: row.editor,
        launchCallDate: row.launchCallDate,
        answers: row.answers,
        syncedAt: now,
      });
    }
    return { blueprints: rows.length };
  },
});

/** Row counts, to confirm what actually crossed from the media buyer's Space. */
export const counts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => ({
    ads: (await ctx.db.query("ads").collect()).length,
    campaigns: (await ctx.db.query("campaigns").collect()).length,
    metaTree: (await ctx.db.query("metaTree").collect()).length,
    blueprints: (await ctx.db.query("blueprints").collect()).length,
  }),
});

/**
 * Freshness of every synced table.
 *
 * Aziz, 2026-09-07: "have a sync every 15 minutes so nothing breaks and
 * everything updates." A sync that silently stops feeding one tab is worse
 * than one that fails loudly, so the app asks this and says so on screen.
 * Tables he writes himself (touchpoints, plan, EOD) are not listed: they have
 * no upstream source and going quiet is normal.
 */
const freshnessShape = v.object({
  tables: v.array(
    v.object({
      table: v.string(),
      rows: v.number(),
      syncedAt: v.optional(v.number()),
    }),
  ),
  oldestSyncedAt: v.optional(v.number()),
  stale: v.array(v.string()),
  empty: v.array(v.string()),
  /** How often the feed is meant to land right now, in minutes. */
  expectedEveryMin: v.number(),
  /** The schedule in words, so every screen phrases it the same way. */
  cadence: v.string(),
});

export const CADENCE =
  "every 10 minutes through the working day, hourly overnight";

export const freshness = authenticatedQuery({
  args: {},
  returns: freshnessShape,
  handler: async ctx => {
    await assertRole(ctx, "creative");
    return await buildFreshness(ctx);
  },
});

export async function buildFreshness(ctx: QueryCtx) {
  // `blueprints` is not listed: the Typeform read has not been ported, so the
  // table would sit in `empty` forever and teach people to ignore the banner.
  const names = [
    "clients",
    "creativeTasks",
    "videoJobs",
    "contentPosts",
    "ads",
    "campaigns",
    "metaTree",
    "winnersArchive",
    "marketPlays",
    "funnels",
  ] as const;
  const tables: { table: string; rows: number; syncedAt?: number }[] = [];
  for (const table of names) {
    const rows = await ctx.db.query(table).collect();
    const syncedAt = rows.reduce<number | undefined>((max, r) => {
      const t = (r as { syncedAt?: number }).syncedAt;
      return t && (!max || t > max) ? t : max;
    }, undefined);
    tables.push({ table, rows: rows.length, syncedAt });
  }
  // The media buyer feeds this app after every sync: every 10 minutes from
  // 06:00 to 22:00 Kuwait and on the hour overnight. The cutoff follows that
  // schedule, otherwise the banner cries wolf every night. The day window
  // starts at 06:15 so the first ten-minute run has landed before it applies.
  const now = Date.now();
  const kuwaitMinutes = Math.floor(
    ((now + 3 * 3600_000) % 86_400_000) / 60_000,
  );
  const daytime = kuwaitMinutes >= 6 * 60 + 15 && kuwaitMinutes < 22 * 60;
  const expectedEveryMin = daytime ? 10 : 60;
  const cutoff = now - (daytime ? 45 : 75) * 60_000;
  const fed = tables.filter(t => t.rows > 0);
  return {
    tables,
    oldestSyncedAt: fed.reduce<number | undefined>(
      (min, t) => (t.syncedAt && (!min || t.syncedAt < min) ? t.syncedAt : min),
      undefined,
    ),
    stale: fed
      .filter(t => !t.syncedAt || t.syncedAt < cutoff)
      .map(t => t.table),
    empty: tables.filter(t => t.rows === 0).map(t => t.table),
    expectedEveryMin,
    cadence: CADENCE,
  };
}
