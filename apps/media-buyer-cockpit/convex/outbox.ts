import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { deliverable, MAX_TRIES, STALE_MS, settled } from "./outboxCore";

/**
 * Durable queue for tool writes that could not be delivered.
 *
 * The Space's tool endpoint is down platform-side, so any ClickUp comment,
 * Slack post or sheet append attempted from inside the app fails. Losing those
 * silently would be worse than the outage itself — she would believe a client
 * was updated when nothing happened. So failures land here and the drain
 * (outboxDrains.drainOwn, every minute) delivers them.
 *
 * A row leaves the queue three ways: delivered, set aside after MAX_TRIES
 * with its error (`gaveUpAt`), or closed unsent once it is two days old. An
 * open row is never left where it can block the rows behind it. The rules
 * live in outboxCore.ts.
 */

export const enqueue = internalMutation({
  args: { role: v.string(), args: v.any(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { role, args, error }) => {
    await ctx.db.insert("outbox", {
      role,
      args,
      at: Date.now(),
      tries: 0,
      ...(error ? { lastError: error.slice(0, 300) } : {}),
    });
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
    // Read past any row that is exhausted, so one can never hold up the rest.
    const rows = await ctx.db
      .query("outbox")
      .withIndex("by_done", q => q.eq("doneAt", undefined))
      .take(500);
    return deliverable(rows).map(r => ({
      id: r._id,
      role: r.role,
      args: r.args,
      at: r.at,
    }));
  },
});

export const settle = internalMutation({
  args: {
    id: v.id("outbox"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.object({ gaveUp: v.boolean() }),
  handler: async (ctx, { id, ok, error }) => {
    const row = await ctx.db.get(id);
    if (!row) return { gaveUp: false };
    // A note can ride along with success (e.g. "stale, not sent").
    const next = settled(row, ok, Date.now(), error);
    await ctx.db.patch(id, next);
    return { gaveUp: next.gaveUpAt !== undefined };
  },
});

/**
 * Close what can no longer be sent: rows already tried MAX_TRIES times, and
 * rows older than two days (old numbers would overwrite fresh ones). Both
 * keep their row and their error, so what was not sent stays on record.
 */
export const closeDead = internalMutation({
  args: {},
  returns: v.object({ exhausted: v.number(), stale: v.number() }),
  handler: async ctx => {
    const now = Date.now();
    const rows = await ctx.db
      .query("outbox")
      .withIndex("by_done", q => q.eq("doneAt", undefined))
      .take(400);
    let exhausted = 0;
    let stale = 0;
    for (const r of rows) {
      if (r.tries >= MAX_TRIES) {
        exhausted++;
        await ctx.db.patch(r._id, {
          doneAt: now,
          gaveUpAt: now,
          lastError:
            `gave up after ${r.tries} tries: ${r.lastError ?? "no error text"}`.slice(
              0,
              300,
            ),
        });
      } else if (now - r.at > STALE_MS) {
        stale++;
        await ctx.db.patch(r._id, {
          doneAt: now,
          lastError:
            `stale after 48 h, not sent${r.lastError ? ` (${r.lastError})` : ""}`.slice(
              0,
              300,
            ),
        });
      }
    }
    return { exhausted, stale };
  },
});

/** What is still waiting, for the health line. */
export const open = internalQuery({
  args: {},
  returns: v.array(
    v.object({ at: v.number(), lastError: v.optional(v.string()) }),
  ),
  handler: async ctx =>
    (
      await ctx.db
        .query("outbox")
        .withIndex("by_done", q => q.eq("doneAt", undefined))
        .take(500)
    ).map(r => ({ at: r.at, lastError: r.lastError })),
});
