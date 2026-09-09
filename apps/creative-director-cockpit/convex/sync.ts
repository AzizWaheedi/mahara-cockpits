import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

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
 */
export const storeAdPerformance = internalMutation({
  args: {
    ads: v.array(v.any()),
    campaigns: v.array(v.any()),
    tree: v.optional(v.array(v.any())),
  },
  returns: v.object({ ads: v.number(), campaigns: v.number() }),
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
        ctr: row.ctr,
        frequency: row.frequency,
        thumbnailUrl: row.thumbnailUrl,
        previewSrc: row.previewSrc,
        metaAdId: row.metaAdId,
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
          previewSrc: row.previewSrc,
          thumbUrl: row.thumbUrl,
          syncedAt: now,
        });
      }
    }

    return { ads: ads.length, campaigns: campaigns.length };
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

/** Mirror the media buyer's marketPlays rows so "What works" is identical. */
export const storePlays = mutation({
  args: { plays: v.array(v.any()) },
  returns: v.object({ plays: v.number() }),
  handler: async (ctx, { plays }) => {
    if (plays.length === 0) {
      throw new Error("storePlays received nothing — refusing to wipe the playbook");
    }
    const now = Date.now();
    for (const row of await ctx.db.query("marketPlays").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of plays) {
      await ctx.db.insert("marketPlays", { ...row, syncedAt: now });
    }
    return { plays: plays.length };
  },
});

/** Funnel destinations from Meta: forms, their questions, and landing pages. */
export const storeFunnels = mutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ funnels: v.number() }),
  handler: async (ctx, { rows }) => {
    if (rows.length === 0) {
      throw new Error("storeFunnels received nothing — refusing to wipe");
    }
    const now = Date.now();
    for (const row of await ctx.db.query("funnels").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of rows) {
      await ctx.db.insert("funnels", { ...row, syncedAt: now });
    }
    return { funnels: rows.length };
  },
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
export const freshness = query({
  args: {},
  returns: v.object({
    tables: v.array(
      v.object({ table: v.string(), rows: v.number(), syncedAt: v.optional(v.number()) }),
    ),
    oldestSyncedAt: v.optional(v.number()),
    stale: v.array(v.string()),
    empty: v.array(v.string()),
  }),
  handler: async ctx => {
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
      "blueprints",
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
    // 45 minutes: three missed runs of a 15 minute cron.
    const cutoff = Date.now() - 45 * 60_000;
    const fed = tables.filter(t => t.rows > 0);
    return {
      tables,
      oldestSyncedAt: fed.reduce<number | undefined>(
        (min, t) => (t.syncedAt && (!min || t.syncedAt < min) ? t.syncedAt : min),
        undefined,
      ),
      stale: fed.filter(t => !t.syncedAt || t.syncedAt < cutoff).map(t => t.table),
      empty: tables.filter(t => t.rows === 0).map(t => t.table),
    };
  },
});
