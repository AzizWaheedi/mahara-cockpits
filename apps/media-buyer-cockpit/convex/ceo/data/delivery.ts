import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { addDays, kuwaitDay } from "../time";

type Any = any;

/**
 * Days of grain the adapter needs: the 30-day trend, which also covers the
 * month to date, plus one day of slack. The sync rewrites the last 30 days on
 * every run and appends older booking days again each time, so reading further
 * back only reads copies (294 rows from 40 days against 80 from 30 on
 * 2026-09-15, and growing every sync).
 */
const GRAIN_DAYS = 31;
/** Per campaign cap on grain rows; a normal campaign has a few hundred. */
const GRAIN_CAP = 3000;

const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).slice(0, 160);

/**
 * Convex tables the CEO "delivery" adapter reads, in one bounded query.
 *
 * Every table here is rebuilt by the media buyer sync, so all but the grain
 * are a few dozen rows. The grain (dailyStats, bookingEvents) and the Meta
 * tree have no date index, so they are read per on-board campaign through
 * their campaign index, the grain with a 31-day bound. Only the fields the
 * section needs leave this query: never campaigns.lost (lead notes) or
 * anything lead-level.
 */
export const load = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const today = kuwaitDay();
    const since = addDays(today, -GRAIN_DAYS);

    const campaignRows: Any[] = await ctx.db.query("campaigns").take(500);
    const campaigns = campaignRows
      .filter(c => c.onBoard && !c.internal)
      .map(c => ({
        campaignName: c.campaignName as string,
        clientName: (c.clientName as string | undefined) ?? null,
        accountName: c.accountName as string,
        boardAdStatus: (c.boardAdStatus as string | undefined) ?? null,
        verdict: c.verdict as string,
        spend7d: Number(c.spend7d ?? 0),
        leads7d: Number(c.leads7d ?? 0),
        spendToday: Number(c.spendToday ?? 0),
        dataThrough: (c.dataThrough as string | undefined) ?? null,
        accountIssue: (c.accountIssue as string | undefined) ?? null,
        metaAccountId: (c.metaAccountId as string | undefined) ?? null,
        // The sync sets bookings7d only when it read the client's GHL (Done
        // For You with a working token); the booking grain exists only then.
        // It counts all of the client's GHL bookings, whichever ad bought them.
        bookingsTracked: c.bookings7d !== undefined,
        clientBookings7d: (c.bookings7d as number | undefined) ?? null,
        syncedAt: Number(c.syncedAt ?? 0),
      }));

    // Ad-level rows folded to campaign x day here, so the payload stays small.
    const daily: {
      campaignName: string;
      date: string;
      spend: number;
      leads: number;
    }[] = [];
    let firstDate: string | null = null;
    let lastDate: string | null = null;
    // Bookings by campaign x day. The sync rewrites the last 30 days on every
    // run, but older booking days are appended again each time, so the same
    // booking can sit in the table many times. A copy from an earlier sync is
    // dropped; rows with the same key from one sync are separate bookings.
    const bookings: {
      campaignName: string;
      date: string;
      count: number;
      copies: number;
    }[] = [];
    let bookingsSyncedAt = 0;
    let grainCapped = false;
    for (const c of campaigns) {
      const byDate = new Map<string, { spend: number; leads: number }>();
      const grain = await ctx.db
        .query("dailyStats")
        .withIndex("by_campaign_date", q =>
          q.eq("campaignName", c.campaignName).gte("date", since),
        )
        .take(GRAIN_CAP);
      if (grain.length === GRAIN_CAP) grainCapped = true;
      for (const r of grain) {
        const d = byDate.get(r.date) ?? { spend: 0, leads: 0 };
        d.spend += Number(r.spend ?? 0);
        d.leads += Number(r.leads ?? 0);
        byDate.set(r.date, d);
        if (!firstDate || r.date < firstDate) firstDate = r.date;
        if (!lastDate || r.date > lastDate) lastDate = r.date;
      }
      for (const [date, d] of byDate)
        daily.push({ campaignName: c.campaignName, date, ...d });

      const events = await ctx.db
        .query("bookingEvents")
        .withIndex("by_campaign_date", q =>
          q.eq("campaignName", c.campaignName).gte("date", since),
        )
        .take(GRAIN_CAP);
      if (events.length === GRAIN_CAP) grainCapped = true;
      // key -> syncedAt -> rows from that sync
      const groups = new Map<string, Map<number, number>>();
      for (const e of events) {
        bookingsSyncedAt = Math.max(bookingsSyncedAt, Number(e.syncedAt ?? 0));
        const key = [
          e.date,
          e.client ?? "",
          e.appointmentDate ?? "",
          e.status,
          e.adId ?? "",
        ].join("|");
        const bySync = groups.get(key) ?? new Map<number, number>();
        bySync.set(e.syncedAt, (bySync.get(e.syncedAt) ?? 0) + 1);
        groups.set(key, bySync);
      }
      const bookedByDate = new Map<string, { count: number; copies: number }>();
      for (const [key, bySync] of groups) {
        const kept = Math.max(...bySync.values());
        let all = 0;
        for (const n of bySync.values()) all += n;
        const date = key.slice(0, 10);
        const b = bookedByDate.get(date) ?? { count: 0, copies: 0 };
        b.count += kept;
        b.copies += all - kept;
        bookedByDate.set(date, b);
      }
      for (const [date, b] of bookedByDate)
        bookings.push({ campaignName: c.campaignName, date, ...b });
    }

    // Meta delivery per campaign: is any ad set or ad ACTIVE right now. A
    // campaign with no ad or ad set in the tree is left out, so the adapter
    // falls back to its spend.
    let tree: { campaignName: string; active: boolean }[] | null = null;
    let treeError: string | null = null;
    try {
      tree = [];
      for (const c of campaigns) {
        const nodes = (
          await ctx.db
            .query("metaTree")
            .withIndex("by_campaign", q => q.eq("campaignName", c.campaignName))
            .take(1000)
        ).filter(t => t.kind === "ad" || t.kind === "adset");
        if (nodes.length === 0) continue;
        tree.push({
          campaignName: c.campaignName,
          active: nodes.some(t => (t.effectiveStatus ?? t.status) === "ACTIVE"),
        });
      }
    } catch (e) {
      tree = null;
      treeError = errText(e);
    }

    let offBoard: Any[] | null = null;
    let offBoardError: string | null = null;
    try {
      offBoard = (await ctx.db.query("offBoardCampaigns").take(500)).map(o => ({
        clientName: o.clientName ?? null,
        spend7d: Number(o.spend7d ?? 0),
        leads7d: Number(o.leads7d ?? 0),
        syncedAt: o.syncedAt,
      }));
    } catch (e) {
      offBoardError = errText(e);
    }

    // Client cards (Clients - Mahara): the ClickUp task id per client name,
    // and which clients are still in an onboarding stage.
    let clients: Any[] | null = null;
    let clientsError: string | null = null;
    try {
      clients = (await ctx.db.query("clients").take(1000)).map(c => ({
        taskId: c.taskId,
        name: c.name,
        onboarding: c.bucket ? c.bucket === "onboarding" : c.onboarding,
        signupDays: c.signupDays ?? null,
        syncedAt: c.syncedAt,
      }));
    } catch (e) {
      clientsError = errText(e);
    }

    // Launches: each open launch task's checklist progress and what the
    // launch watch found blocking a launch.
    let launches: Any = null;
    let launchError: string | null = null;
    try {
      const tasks = (await ctx.db.query("onboardings").take(200)).map(o => {
        let done = 0;
        let total = 0;
        for (const g of o.groups)
          for (const i of g.items) {
            total += 1;
            if (i.done) done += 1;
          }
        return { client: o.client, done, total, syncedAt: o.syncedAt };
      });
      const watch = (await ctx.db.query("launchWatch").take(200))
        // Rows about a campaign with no board card are the off-board list,
        // not a launch.
        .filter(w => w.hasTask || w.sheetStatus.startsWith("card says"))
        .map(w => ({ client: w.client, issues: w.issues.slice(0, 3) }));
      launches = { tasks, watch };
    } catch (e) {
      launchError = errText(e);
    }

    // The health ledger's view of the three systems behind these tables.
    const health: Record<string, Any> = {};
    for (const source of ["meta", "ghl", "clickup"]) {
      const row = await ctx.db
        .query("sourceHealth")
        .withIndex("by_source", q => q.eq("source", source))
        .first();
      health[source] = row
        ? { ok: row.ok, streak: row.streak, lastOkAt: row.lastOkAt ?? null }
        : null;
    }

    return {
      today,
      since,
      campaigns,
      daily,
      firstDate,
      lastDate,
      grainCapped,
      bookings,
      bookingsSyncedAt: bookingsSyncedAt || null,
      tree,
      treeError,
      offBoard,
      offBoardError,
      clients,
      clientsError,
      launches,
      launchError,
      health,
    };
  },
});
