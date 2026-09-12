import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Durable queue for tool writes that could not be delivered.
 *
 * The Space's tool endpoint is down platform-side, so any ClickUp comment,
 * Slack post or sheet append attempted from inside the app fails. Losing those
 * silently would be worse than the outage itself — she would believe a client
 * was updated when nothing happened. So failures land here and the sandbox
 * bridge (skills/client_onboarding_launch/scripts/sync_cockpit.py) delivers them.
 */

export const enqueue = internalMutation({
  args: { role: v.string(), args: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("outbox", { ...args, at: Date.now(), tries: 0 });
    return null;
  },
});

export const pending = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("outbox"),
      role: v.string(),
      args: v.any(),
      at: v.number(),
    }),
  ),
  handler: async ctx => {
    const rows = await ctx.db
      .query("outbox")
      .withIndex("by_done", q => q.eq("doneAt", undefined))
      .take(50);
    // Give up after 5 attempts rather than retrying a poisoned payload forever.
    return rows
      .filter(r => r.tries < 5)
      .map(r => ({ id: r._id, role: r.role, args: r.args, at: r.at }));
  },
});

export const settle = internalMutation({
  args: {
    id: v.id("outbox"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ok, error }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, {
      doneAt: ok ? Date.now() : undefined,
      tries: row.tries + 1,
      // A note can ride along with success (e.g. "stale, not sent").
      lastError: error?.slice(0, 300),
    });
    return null;
  },
});
