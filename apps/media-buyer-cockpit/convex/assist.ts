import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertScope, scopeFilter } from "./gate";
import { assertRole } from "./roles";

/**
 * The hand-off queue between the cockpit and Viktor.
 *
 * Everything the media buyer wants done that needs judgement rather than a
 * Meta API call goes through here: write me copy, pull these creatives off
 * Drive and load them into the account, set this new client's launch up with
 * me. She fills a box, the row queues, Viktor's worker picks it up and writes
 * the answer back into the same row — so the panel shows real progress instead
 * of an error when the in-app AI path is unavailable.
 *
 * Nothing in this file talks to an AI model or to Meta. That is deliberate:
 * this queue has to keep working when those do not.
 */

const VARIANT = v.object({
  headline: v.string(),
  message: v.string(),
  description: v.optional(v.string()),
  angle: v.optional(v.string()),
});

const MEDIA = v.object({
  name: v.string(),
  link: v.string(),
  kind: v.optional(v.string()),
  imageHash: v.optional(v.string()),
  videoId: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  error: v.optional(v.string()),
});

const STEP = v.object({
  label: v.string(),
  state: v.string(),
  detail: v.optional(v.string()),
});

/** She asks for something. Returns the id so the panel can watch it. */
export const enqueue = authenticatedMutation({
  args: {
    kind: v.string(),
    campaignName: v.optional(v.string()),
    client: v.optional(v.string()),
    brief: v.optional(v.string()),
    language: v.optional(v.string()),
    driveLinks: v.optional(v.array(v.string())),
  },
  returns: v.id("assistRequests"),
  handler: async (ctx, args) => {
    // The worker uploads footage into the client's ad account: a seat, on a
    // client on her list.
    await assertRole(ctx, "media_buyer");
    if (args.campaignName || args.client) {
      await assertScope(ctx, {
        campaignName: args.campaignName,
        clientName: args.client,
      });
    }
    const id = await ctx.db.insert("assistRequests", {
      ...args,
      driveLinks: (args.driveLinks ?? []).filter(l => l.trim().length > 0),
      status: "queued",
      requestedBy: ctx.userId ?? undefined,
      requestedAt: Date.now(),
    });
    // The worker now lives in the app (assistWorker.ts); wake it right away.
    await ctx.scheduler.runAfter(0, internal.assistWorker.run, {});
    return id;
  },
});

/** Same as enqueue, for automation and tests (no signed-in user). */
export const enqueueInternal = internalMutation({
  args: {
    kind: v.string(),
    campaignName: v.optional(v.string()),
    client: v.optional(v.string()),
    brief: v.optional(v.string()),
    language: v.optional(v.string()),
    driveLinks: v.optional(v.array(v.string())),
  },
  returns: v.id("assistRequests"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("assistRequests", {
      ...args,
      driveLinks: (args.driveLinks ?? []).filter(l => l.trim().length > 0),
      status: "queued",
      requestedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.assistWorker.run, {});
    return id;
  },
});

/** One request, polled by the panel that raised it. */
export const get = authenticatedQuery({
  args: { id: v.id("assistRequests") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "media_buyer");
    const row = await ctx.db.get(id);
    if (!row) return null;
    const visible = await scopeFilter(ctx);
    return visible(row) ? row : null;
  },
});

/** Everything open or recently finished for one campaign or client. */
export const recent = authenticatedQuery({
  args: {
    campaignName: v.optional(v.string()),
    client: v.optional(v.string()),
    kind: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { campaignName, client, kind }) => {
    await assertRole(ctx, "media_buyer");
    const visible = await scopeFilter(ctx);
    const rows = campaignName
      ? await ctx.db
          .query("assistRequests")
          .withIndex("by_campaign", (q: any) =>
            q.eq("campaignName", campaignName),
          )
          .collect()
      : client
        ? await ctx.db
            .query("assistRequests")
            .withIndex("by_client", (q: any) => q.eq("client", client))
            .collect()
        : await ctx.db.query("assistRequests").order("desc").take(40);
    return rows
      .filter(r => (!kind || r.kind === kind) && visible(r))
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, 12);
  },
});

/** How much is waiting for an answer right now — drives the status strip. */
export const queueDepth = authenticatedQuery({
  args: {},
  returns: v.object({ queued: v.number(), working: v.number() }),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const q = await ctx.db
      .query("assistRequests")
      .withIndex("by_status", (i: any) => i.eq("status", "queued"))
      .collect();
    const w = await ctx.db
      .query("assistRequests")
      .withIndex("by_status", (i: any) => i.eq("status", "working"))
      .collect();
    return { queued: q.length, working: w.length };
  },
});

/** The worker's view: what still needs doing, oldest first. */
export const pending = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const queued = await ctx.db
      .query("assistRequests")
      .withIndex("by_status", (i: any) => i.eq("status", "queued"))
      .collect();
    // A "working" row older than 20 minutes means the worker died mid-job.
    // Picking it back up is safer than leaving her watching a spinner.
    const stale = (
      await ctx.db
        .query("assistRequests")
        .withIndex("by_status", (i: any) => i.eq("status", "working"))
        .collect()
    ).filter(r => Date.now() - (r.startedAt ?? r.requestedAt) > 20 * 60_000);
    return [...queued, ...stale]
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .map(r => ({ ...r, id: r._id }));
  },
});

export const claim = internalMutation({
  args: { id: v.id("assistRequests") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "working", startedAt: Date.now() });
    return null;
  },
});

export const fulfill = internalMutation({
  args: {
    id: v.id("assistRequests"),
    status: v.string(),
    variants: v.optional(v.array(VARIANT)),
    media: v.optional(v.array(MEDIA)),
    steps: v.optional(v.array(STEP)),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch(id, { ...rest, completedAt: Date.now() });
    return null;
  },
});

/** Context the worker needs to answer well, gathered in one round trip. */
export const context = internalQuery({
  args: {
    campaignName: v.optional(v.string()),
    client: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { campaignName, client }) => {
    const campaigns = await ctx.db.query("campaigns").collect();
    const c = campaignName
      ? campaigns.find(x => x.campaignName === campaignName)
      : campaigns.find(x => (x.clientName ?? x.accountName) === client);
    const who = client ?? c?.clientName ?? c?.accountName;
    const winners = (await ctx.db.query("winnersArchive").collect())
      .sort((a, b) => a.cpl - b.cpl)
      .slice(0, 40);
    // Client names differ slightly between the sheet, ClickUp and Meta
    // ("City Wood" / "City Wood Industry"), so an exact match silently loses
    // the ad account and Viktor reports a blocker that is not real.
    const norm = (x: string) =>
      x.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, "");
    const like = (a?: string, b?: string) => {
      if (!a || !b) return false;
      const [x, y] = [norm(a), norm(b)];
      return x === y || x.startsWith(y) || y.startsWith(x);
    };
    const onboarding = who
      ? (await ctx.db.query("onboardings").collect()).find(o =>
          like(o.client, who),
        )
      : undefined;
    const watch = who
      ? (await ctx.db.query("launchWatch").collect()).find(w =>
          like(w.client, who),
        )
      : undefined;
    const prefs = who
      ? (await ctx.db.query("clientPrefs").collect()).find(
          p => p.clientName === who,
        )
      : undefined;
    return {
      campaign: c ?? null,
      client: who ?? null,
      onboarding: onboarding ?? null,
      launchWatch: watch ?? null,
      prefs: prefs ?? null,
      winners: winners.map(w => ({
        client: w.client,
        serviceLine: w.serviceLine,
        city: w.city,
        language: w.language,
        cpl: w.cpl,
        headline: w.headline,
        body: w.body,
        hook: w.hook,
        cta: w.cta,
        format: w.format,
        transcript: w.transcript ? w.transcript.slice(0, 1200) : undefined,
      })),
    };
  },
});
