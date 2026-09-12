import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertScope, scopeFilter } from "./gate";
import { assertRole } from "./roles";
import { callTool } from "./tools";

/**
 * The conversation attached to one campaign.
 *
 * This is deliberately not a chatbot. Inventing an answer about a live ad
 * account is worse than waiting for a real one, so the question goes to Aziz
 * on Slack together with the campaign's actual figures, and he answers there.
 * Every message shows whether it reached him. [aziz, 2026-09-06]
 */

declare const process: { env: Record<string, string | undefined> };

/** Aziz's Slack DM. A user id opens the DM; the old D... channel id is gone. */
const AZIZ_DM = process.env.ALERT_SLACK_TO || "U0AJQ8P1ACF";
/** Retry gaps in minutes: a Slack hiccup should not lose her question. */
const RETRY_MIN = [1, 5, 15];

export const thread = authenticatedQuery({
  args: { campaignId: v.string() },
  returns: v.any(),
  handler: async (ctx, { campaignId }) => {
    await assertRole(ctx, "media_buyer");
    // The id she is looking at is the campaign name (see CockpitPage).
    await assertScope(ctx, { campaignName: campaignId });
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_campaign", q => q.eq("campaignId", campaignId))
      .collect();
    return rows.sort((a, b) => a.at - b.at);
  },
});

/** Campaign ids that have any conversation, so the list can show a marker. */
export const active = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const visible = await scopeFilter(ctx);
    const rows = await ctx.db.query("campaignChat").collect();
    const out: Record<string, { messages: number; waiting: boolean }> = {};
    for (const r of rows) {
      if (!visible(r)) continue;
      const e = out[r.campaignId] ?? { messages: 0, waiting: false };
      e.messages += 1;
      if (r.author === "her" && r.pending) e.waiting = true;
      out[r.campaignId] = e;
    }
    return out;
  },
});

export const ask = authenticatedMutation({
  args: {
    campaignId: v.string(),
    campaignName: v.string(),
    client: v.optional(v.string()),
    text: v.string(),
    authorName: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    await assertScope(ctx, { campaignName: args.campaignName });
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

    const id = await ctx.db.insert("campaignChat", {
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
    // Straight to Slack from here. The old outbox relay had no runner on this
    // deployment, so every question sat at "queued" for good.
    await ctx.scheduler.runAfter(0, internal.chat.deliver, { id });
    return { ok: true };
  },
});

export const get = internalQuery({
  args: { id: v.id("campaignChat") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

/** Post one question to Aziz's DM, retrying a few times before giving up. */
export const deliver = internalAction({
  args: { id: v.id("campaignChat"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, attempt }) => {
    const row = await ctx.runQuery(internal.chat.get, { id });
    if (!row || row.author !== "her") return null;
    if ((row.status ?? "queued") !== "queued") return null;
    const text = [
      `*${row.authorName ?? "The media buyer"} asks about "${row.campaignName}"${row.client ? ` (${row.client})` : ""}*`,
      row.context ? `_${row.context}_` : null,
      row.text,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await callTool("coworker_send_slack_message", {
        channel_id: AZIZ_DM,
        text,
      });
      await ctx.runMutation(internal.chat.markSent, { id, ok: true });
    } catch (e) {
      const n = attempt ?? 0;
      console.warn(`campaign question ${id}: ${String(e).slice(0, 160)}`);
      if (n < RETRY_MIN.length) {
        await ctx.scheduler.runAfter(
          RETRY_MIN[n] * 60_000,
          internal.chat.deliver,
          { id, attempt: n + 1 },
        );
      } else {
        await ctx.runMutation(internal.chat.markSent, { id, ok: false });
      }
    }
    return null;
  },
});

/**
 * An answer written back into the thread. Clears the waiting state on
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

/** Questions not yet delivered. */
export const waiting = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const visible = await scopeFilter(ctx);
    const rows = await ctx.db
      .query("campaignChat")
      .withIndex("by_pending", q => q.eq("pending", true))
      .collect();
    return rows
      .filter(r => r.author === "her" && visible(r))
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
 * Mark a message as delivered (or given up on).
 *
 * The difference between "queued" and "sent" is the difference between a box
 * that might be broken and one she can trust. [aziz, 2026-09-07]
 * Aziz answers in Slack, not in this thread, so a delivered question is no
 * longer "waiting for an answer" here either.
 */
export const markSent = internalMutation({
  args: {
    id: v.optional(v.id("campaignChat")),
    campaignId: v.optional(v.string()),
    text: v.optional(v.string()),
    ok: v.optional(v.boolean()),
  },
  returns: v.object({ marked: v.number() }),
  handler: async (ctx, { id, campaignId, text, ok }) => {
    const one = id ? await ctx.db.get(id) : null;
    const rows = one
      ? [one]
      : campaignId
        ? await ctx.db
            .query("campaignChat")
            .withIndex("by_campaign", q => q.eq("campaignId", campaignId))
            .collect()
        : [];
    let marked = 0;
    for (const r of rows) {
      if (r.author !== "her") continue;
      if (r.status && r.status !== "queued") continue;
      if (text && r.text !== text) continue;
      await ctx.db.patch(r._id, {
        status: ok === false ? "failed" : "sent",
        deliveredAt: Date.now(),
        pending: false,
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
export const logEvent = authenticatedMutation({
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
    await assertRole(ctx, "media_buyer");
    await assertScope(ctx, { campaignName: args.campaignName });
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
 * what is still on its way to Aziz, and when the data last refreshed.
 */
export const activity = authenticatedQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    await assertRole(ctx, "media_buyer");
    const visible = await scopeFilter(ctx);
    const rows = (await ctx.db.query("campaignChat").collect()).filter(visible);
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

/**
 * One-off after 2026-09-13: campaign questions queued by the old outbox relay
 * (which never ran on this deployment) would show "sending to Aziz" for ever.
 * Anything queued more than a day ago is marked failed so the thread is honest.
 *   bunx convex run --prod chat:failLegacyQueued
 */
export const failLegacyQueued = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const cutoff = Date.now() - 86400_000;
    let n = 0;
    for (const row of await ctx.db.query("campaignChat").collect()) {
      if (
        row.author === "her" &&
        row.status === "queued" &&
        !row.deliveredAt &&
        row.at < cutoff
      ) {
        await ctx.db.patch(row._id, {
          status: "failed",
          pending: false,
          error: "not delivered: queued before the direct Slack relay existed",
        });
        n++;
      }
    }
    return n;
  },
});
