import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";

/**
 * The conversation attached to one campaign.
 *
 * This is deliberately not a chatbot. In-app AI generation runs through the
 * Viktor tool gateway, which is returning 500 for every call, so pretending to
 * answer would mean inventing numbers about a live ad account. Instead the
 * question is relayed to Slack together with the campaign's actual figures,
 * and the answer is written back into the same thread. From her side it reads
 * as one conversation either way. [aziz, 2026-09-06]
 */
export const thread = query({
  args: { campaignId: v.string() },
  returns: v.any(),
  handler: async (ctx, { campaignId }) => {
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_campaign", q => q.eq("campaignId", campaignId))
      .collect();
    return rows.sort((a, b) => a.at - b.at);
  },
});

/** Campaign ids that have any conversation, so the list can show a marker. */
export const active = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("campaignChat").collect();
    const out: Record<string, { messages: number; waiting: boolean }> = {};
    for (const r of rows) {
      const e = out[r.campaignId] ?? { messages: 0, waiting: false };
      e.messages += 1;
      if (r.author === "her" && r.pending) e.waiting = true;
      out[r.campaignId] = e;
    }
    return out;
  },
});

export const ask = mutation({
  args: {
    campaignId: v.string(),
    campaignName: v.string(),
    client: v.optional(v.string()),
    text: v.string(),
    authorName: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (!text) return { ok: false };

    // Attach the numbers as they stand right now. Without this the question
    // arrives in Slack as "should I scale this?" with nothing behind it, and
    // whoever answers has to go and look them up.
    // Campaigns are keyed by name in this schema, and the id she is looking at
    // is that same name — see CockpitPage.
    const campaign = await ctx.db
      .query("campaigns")
      .filter(q => q.eq(q.field("campaignName"), args.campaignName))
      .first();
    const context = campaign
      ? [
          `7d spend $${Math.round(campaign.spend7d ?? 0)}`,
          `${campaign.leads7d ?? 0} leads`,
          campaign.cpl ? `$${campaign.cpl.toFixed(2)} CPL` : "no CPL yet",
          // boardAdStatus is whether the ads are actually live; adStatus is the
          // ClickUp card column, which reads "to do" on a running campaign and
          // would make the relayed question look like it was about a dead one.
          campaign.boardAdStatus ? `ads ${campaign.boardAdStatus}` : null,
          campaign.daysLive ? `${campaign.daysLive}d live` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

    await ctx.db.insert("campaignChat", {
      campaignId: args.campaignId,
      campaignName: args.campaignName,
      client: args.client,
      author: "her",
      authorName: args.authorName,
      text,
      context,
      pending: true,
      status: "queued",
      kind: "question",
      at: Date.now(),
    });

    await ctx.runMutation(internal.outbox.enqueue, {
      role: "slack_request",
      args: {
        kind: "campaign_question",
        campaignId: args.campaignId,
        campaign: args.campaignName,
        client: args.client ?? "",
        who: args.authorName ?? "the media buyer",
        context: context ?? "",
        text,
      },
    });
    return { ok: true };
  },
});

/**
 * Viktor's answer, written back by the bridge. Clears the waiting state on
 * every outstanding question in that campaign.
 */
export const reply = internalMutation({
  args: {
    campaignId: v.string(),
    text: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { campaignId, text }) => {
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_campaign", q => q.eq("campaignId", campaignId))
      .collect();
    if (rows.length === 0) return { ok: false };
    for (const r of rows) {
      if (r.author === "her" && r.pending) {
        await ctx.db.patch(r._id, { pending: false, status: "answered" });
      }
    }
    await ctx.db.insert("campaignChat", {
      campaignId,
      campaignName: rows[0].campaignName,
      client: rows[0].client,
      author: "viktor",
      text,
      pending: false,
      status: "answered",
      kind: "question",
      at: Date.now(),
    });
    return { ok: true };
  },
});

/** Questions still waiting on an answer — the bridge prints these. */
export const waiting = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_pending", q => q.eq("pending", true))
      .collect();
    return rows
      .filter(r => r.author === "her")
      .map(r => ({
        campaignId: r.campaignId,
        campaign: r.campaignName,
        client: r.client ?? null,
        who: r.authorName ?? null,
        text: r.text,
        context: r.context ?? null,
        at: r.at,
      }));
  },
});

/** Housekeeping: drop chat rows for a campaign (used to clear test traffic). */
export const discard = internalMutation({
  args: { campaignId: v.string() },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, { campaignId }) => {
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_campaign", q => q.eq("campaignId", campaignId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { removed: rows.length };
  },
});

/**
 * Mark a relayed message as delivered.
 *
 * Called by the bridge the moment the question actually lands in Slack. The
 * difference between "queued" and "sent" is the difference between a box that
 * might be broken and one she can trust. [aziz, 2026-09-07]
 */
export const markSent = internalMutation({
  args: {
    campaignId: v.string(),
    text: v.optional(v.string()),
    ok: v.optional(v.boolean()),
  },
  returns: v.object({ marked: v.number() }),
  handler: async (ctx, { campaignId, text, ok }) => {
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_campaign", q => q.eq("campaignId", campaignId))
      .collect();
    let marked = 0;
    for (const r of rows) {
      if (r.author !== "her") continue;
      if (r.status && r.status !== "queued") continue;
      if (text && r.text !== text) continue;
      await ctx.db.patch(r._id, {
        status: ok === false ? "failed" : "sent",
        deliveredAt: Date.now(),
      });
      marked += 1;
    }
    return { marked };
  },
});

/**
 * Log something that happened to a campaign into its own thread.
 *
 * Every button in the cockpit writes here: paused an ad, raised a budget,
 * asked for a build. The thread then answers "what is going on with this
 * campaign, and did it work" without anyone having to ask. [aziz, 2026-09-07]
 */
export const logEvent = mutation({
  args: {
    campaignId: v.string(),
    campaignName: v.string(),
    client: v.optional(v.string()),
    text: v.string(),
    kind: v.optional(v.string()),
    ok: v.optional(v.boolean()),
    authorName: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.db.insert("campaignChat", {
      campaignId: args.campaignId,
      campaignName: args.campaignName,
      client: args.client,
      author: "her",
      authorName: args.authorName,
      text: args.text,
      pending: false,
      status: args.ok === false ? "failed" : "done",
      kind: args.kind ?? "action",
      ok: args.ok,
      at: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Everything happening right now, across every campaign: the newest messages,
 * what is still waiting to reach Viktor, and when the data last refreshed.
 */
export const activity = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("campaignChat").collect();
    rows.sort((a, b) => b.at - a.at);
    const lastSync = (await ctx.db.query("syncRuns").collect()).sort(
      (a, b) => b.at - a.at,
    )[0];
    return {
      recent: rows.slice(0, limit ?? 12),
      queued: rows.filter(
        r => r.author === "her" && (r.status ?? "queued") === "queued",
      ).length,
      waitingOnViktor: rows.filter(r => r.author === "her" && r.pending).length,
      lastSyncAt: lastSync?.at ?? null,
      lastSyncOk: lastSync?.ok ?? null,
      problems: lastSync?.problems ?? [],
    };
  },
});

/** Same as logEvent, for server-side callers (actions, the bridge). */
export const logInternal = internalMutation({
  args: {
    campaignName: v.string(),
    client: v.optional(v.string()),
    text: v.string(),
    kind: v.optional(v.string()),
    ok: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("campaignChat", {
      campaignId: args.campaignName,
      campaignName: args.campaignName,
      client: args.client,
      author: "her",
      text: args.text,
      pending: false,
      status: args.ok === false ? "failed" : "done",
      kind: args.kind ?? "action",
      ok: args.ok,
      at: Date.now(),
    });
    return null;
  },
});
