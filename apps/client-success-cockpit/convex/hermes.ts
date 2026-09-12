import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { allowedClients, assertRole, userEmail } from "./roles";

// biome-ignore lint/suspicious/noExplicitAny: context blobs
type Any = any;

/**
 * The chat with Hermes for this cockpit.
 *
 * Messages live here; the media buyer backend relays each user message to
 * Hermes with this screen's context and writes the answer back through the
 * bridge (`chatPending`, `chatSent`, `chatAnswer`). One thread per signed-in
 * person, keyed by their email, so the history reads like a conversation and
 * follows them across devices and sign-ins.
 */

const MAX_THREAD = 60;
const MAX_CONTEXT = 6000;

/** What this cockpit knows that Hermes should see for this question. */
// biome-ignore lint/suspicious/noExplicitAny: db ctx
async function contextFor(ctx: any, clientName?: string): Promise<string> {
  const clients = await ctx.db.query("clients").collect();
  if (clientName) {
    const c = clients.find((x: Any) => x.name === clientName);
    const p = await ctx.db
      .query("clientProfiles")
      .withIndex("by_client", (q: Any) => q.eq("clientName", clientName))
      .first();
    return JSON.stringify({
      client: c
        ? {
            name: c.name,
            stage: c.stage,
            csm: c.csmAssigned,
            todo: c.todo,
            level: c.level,
            launchDate: c.launchDate,
            liveDays: c.liveDays,
            lastPoc: c.lastPoc,
            silentDays: c.silentDays,
            paymentDue: c.paymentDue,
            happiness: c.happiness,
            loose: c.loose,
            commitments: c.commitments,
          }
        : null,
      performance: p?.performance
        ? {
            month: p.performance.month,
            lastMonth: p.performance.lastMonth,
            allTime: p.performance.allTime,
            staleCount: p.performance.staleCount,
            byAd: (p.performance.byAd ?? []).slice(0, 8),
          }
        : null,
      lostLeads: p?.lost?.reasons ?? null,
      recentCalls: (p?.calls ?? []).slice(0, 4).map((k: Any) => ({
        title: k.title,
        at: k.at,
        summary: String(k.summary ?? "").slice(0, 400),
      })),
      gaps: p?.gaps ?? [],
      links: p?.links ?? {},
    });
  }
  const active = clients.filter((c: Any) => c.bucket !== "inactive");
  return JSON.stringify({
    activeClients: active.map((c: Any) => ({
      name: c.name,
      stage: c.stage,
      level: c.level,
      todo: c.todo,
    })),
    inactiveCount: clients.length - active.length,
  });
}

export const thread = authenticatedQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    await assertRole(ctx, "csm");
    const me = await userEmail(ctx);
    const rows = await ctx.db
      .query("hermesChat")
      .withIndex("by_thread", q => q.eq("thread", me))
      .collect();
    rows.sort((a, b) => a.at - b.at);
    return rows.slice(-MAX_THREAD).map(({ context: _c, ...m }) => m);
  },
});

export const send = authenticatedMutation({
  args: {
    text: v.string(),
    clientName: v.optional(v.string()),
    page: v.optional(v.string()),
  },
  returns: v.id("hermesChat"),
  handler: async (ctx, { text, clientName, page }) => {
    await assertRole(ctx, "csm");
    const me = await userEmail(ctx);
    // The client list set in the portal applies here too: no asking about
    // a client the person cannot open.
    const scope = await allowedClients(ctx);
    if (clientName && scope && !scope.has(clientName.toLowerCase()))
      throw new Error("That client is not on your list.");
    const context = (await contextFor(ctx, clientName)).slice(0, MAX_CONTEXT);
    const id = await ctx.db.insert("hermesChat", {
      thread: me,
      role: "user",
      text: text.trim().slice(0, 4000),
      clientName,
      page,
      context,
      status: "queued",
      at: Date.now(),
    });
    // Keep the thread bounded: nothing reads past the last MAX_THREAD rows.
    const rows = await ctx.db
      .query("hermesChat")
      .withIndex("by_thread", q => q.eq("thread", me))
      .collect();
    rows.sort((a, b) => a.at - b.at);
    for (const old of rows.slice(0, Math.max(0, rows.length - MAX_THREAD)))
      await ctx.db.delete(old._id);
    return id;
  },
});

/** Start over: the old thread is deleted, not hidden. */
export const clear = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    await assertRole(ctx, "csm");
    const me = await userEmail(ctx);
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
    const queued = (
      await ctx.db
        .query("hermesChat")
        .withIndex("by_status", q => q.eq("status", "queued"))
        .take(10)
    ).filter(m => m.role === "user");
    const out: Any[] = [];
    for (const m of queued) {
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
    // A relay retry must not produce a second reply to the same question.
    if (m.status === "answered") return null;
    if (error || !text) {
      await ctx.db.patch(id, { status: "failed", error: error ?? "no answer" });
      return null;
    }
    // The screen context was for Hermes; once answered it is dead weight.
    await ctx.db.patch(id, { status: "answered", context: undefined });
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
