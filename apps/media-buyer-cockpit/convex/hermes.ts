import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

// biome-ignore lint/suspicious/noExplicitAny: context blobs
type Any = any;

/**
 * The chat with Hermes for this cockpit.
 *
 * Messages live here; the media buyer backend relays each user message to
 * Hermes with this screen's context and writes the answer back through the
 * bridge (`chatPending`, `chatSent`, `chatAnswer`). One thread per signed-in
 * person, so the history reads like a conversation.
 */

const MAX_THREAD = 60;
const MAX_CONTEXT = 6000;

// biome-ignore lint/suspicious/noExplicitAny: ctx from query or mutation
async function who(ctx: any): Promise<string> {
  try {
    const id = await ctx.auth.getUserIdentity();
    return String(id?.email ?? id?.subject ?? "media-buyer");
  } catch {
    return "media-buyer";
  }
}

/** What this cockpit knows that Hermes should see for this question. */
// biome-ignore lint/suspicious/noExplicitAny: db ctx
async function contextFor(ctx: any, clientName?: string): Promise<string> {
  const campaigns = await ctx.db.query("campaigns").collect();
  const compact = (c: Any) => ({
    campaign: c.campaignName,
    client: c.clientName,
    account: c.accountName,
    status: c.adStatus,
    spend7d: c.spend7d,
    leads7d: c.leads7d,
    cpl: c.cpl,
    bookings7d: c.bookings7d,
    costPerBooking: c.costPerBooking,
    daysLive: c.daysLive,
    constraint: c.constraint,
    action: c.action,
  });
  if (clientName) {
    const key = clientName.toLowerCase();
    const mine = campaigns.filter(
      (c: Any) => String(c.clientName ?? "").toLowerCase() === key,
    );
    const watch = (await ctx.db.query("launchWatch").collect()).filter(
      (w: Any) => String(w.client).toLowerCase() === key,
    );
    return JSON.stringify({ campaigns: mine.map(compact), launchWatch: watch });
  }
  const watch = (await ctx.db.query("launchWatch").collect()).filter(
    (w: Any) => w.issues?.length && w.spend7d > 0,
  );
  return JSON.stringify({
    campaigns: campaigns.filter((c: Any) => !c.internal).map(compact),
    launchesWithIssues: watch.map((w: Any) => ({
      client: w.client,
      issues: w.issues,
    })),
  });
}

export const thread = query({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    const me = await who(ctx);
    const rows = await ctx.db
      .query("hermesChat")
      .withIndex("by_thread", q => q.eq("thread", me))
      .collect();
    rows.sort((a, b) => a.at - b.at);
    return rows.slice(-MAX_THREAD).map(({ context: _c, ...m }) => m);
  },
});

export const send = mutation({
  args: {
    text: v.string(),
    clientName: v.optional(v.string()),
    page: v.optional(v.string()),
  },
  returns: v.id("hermesChat"),
  handler: async (ctx, { text, clientName, page }) => {
    const me = await who(ctx);
    const context = (await contextFor(ctx, clientName)).slice(0, MAX_CONTEXT);
    return await ctx.db.insert("hermesChat", {
      thread: me,
      role: "user",
      text: text.trim().slice(0, 4000),
      clientName,
      page,
      context,
      status: "queued",
      at: Date.now(),
    });
  },
});

/** Start over: the old thread is deleted, not hidden. */
export const clear = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const me = await who(ctx);
    for (const m of await ctx.db
      .query("hermesChat")
      .withIndex("by_thread", q => q.eq("thread", me))
      .collect())
      await ctx.db.delete(m._id);
    return null;
  },
});

// --- Bridge side ---------------------------------------------------------------

/** User messages not yet relayed, with the last turns of their thread. */
export const pending = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    const queued = (await ctx.db.query("hermesChat").collect()).filter(
      m => m.role === "user" && m.status === "queued",
    );
    const out: Any[] = [];
    for (const m of queued.slice(0, 10)) {
      const history = (
        await ctx.db
          .query("hermesChat")
          .withIndex("by_thread", q => q.eq("thread", m.thread))
          .collect()
      )
        .filter(
          x =>
            x.at < m.at && (x.role === "assistant" || x.status === "answered"),
        )
        .sort((a, b) => a.at - b.at)
        .slice(-12)
        .map(x => ({ role: x.role, text: x.text }));
      out.push({
        id: m._id,
        text: m.text,
        clientName: m.clientName,
        page: m.page,
        context: m.context,
        history,
        by: m.thread,
      });
    }
    return out;
  },
});

export const markSent = internalMutation({
  args: { id: v.id("hermesChat"), jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, jobId }) => {
    await ctx.db.patch(id, { status: "sent", jobId });
    return null;
  },
});

export const answer = internalMutation({
  args: {
    id: v.id("hermesChat"),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, text, error }) => {
    const m = await ctx.db.get(id);
    if (!m) return null;
    if (error || !text) {
      await ctx.db.patch(id, { status: "failed", error: error ?? "no answer" });
      return null;
    }
    await ctx.db.patch(id, { status: "answered" });
    await ctx.db.insert("hermesChat", {
      thread: m.thread,
      role: "assistant",
      text,
      clientName: m.clientName,
      status: "answered",
      at: Date.now(),
    });
    return null;
  },
});

/** Hermes has picked the message up: show "typing" instead of "waiting". */
export const markReading = internalMutation({
  args: { id: v.id("hermesChat") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const m = await ctx.db.get(id);
    if (m && m.status === "sent") await ctx.db.patch(id, { status: "reading" });
    return null;
  },
});
