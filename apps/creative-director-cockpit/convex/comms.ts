import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/** Replace the calendar wholesale. An empty read keeps what is there. */
export const storeCalendar = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ events: v.number() }),
  handler: async (ctx, { rows }) => {
    if (rows.length === 0) return { events: 0 };
    for (const old of await ctx.db.query("calendarEvents").collect())
      await ctx.db.delete(old._id);
    const now = Date.now();
    for (const r of rows)
      await ctx.db.insert("calendarEvents", { ...r, syncedAt: now });
    return { events: rows.length };
  },
});

export const storeWhatsapp = internalMutation({
  args: { threads: v.array(v.any()), append: v.optional(v.boolean()) },
  returns: v.object({ threads: v.number() }),
  handler: async (ctx, { threads, append }) => {
    // Sent in chunks: the first call replaces, the rest append.
    if (threads.length === 0 && !append) return { threads: 0 };
    if (!append)
      for (const old of await ctx.db.query("waThreads").collect())
        await ctx.db.delete(old._id);
    const now = Date.now();
    for (const t of threads)
      await ctx.db.insert("waThreads", {
        ...t,
        recent: t.recent ?? [],
        syncedAt: now,
      });
    return { threads: threads.length };
  },
});

const kuwaitDay = (ms: number) =>
  new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

export const overview = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_start")
      .collect();
    const threads = await ctx.db.query("waThreads").collect();
    const now = Date.now();
    const todayKey = kuwaitDay(now);
    const startMs = (e: { start: string }) => new Date(e.start).getTime();
    const today = events.filter(e =>
      e.allDay ? e.start === todayKey : kuwaitDay(startMs(e)) === todayKey,
    );
    const upcoming = events
      .filter(
        e =>
          startMs(e) > now &&
          startMs(e) < now + 7 * 86400_000 &&
          kuwaitDay(startMs(e)) !== todayKey,
      )
      .slice(0, 60);
    const nextCall = new Map<string, (typeof events)[number]>();
    for (const e of events) {
      if (!e.clientName || startMs(e) < now) continue;
      if (!nextCall.has(e.clientName)) nextCall.set(e.clientName, e);
    }
    threads.sort((a, b) => {
      if (Boolean(a.waitingSince) !== Boolean(b.waitingSince))
        return a.waitingSince ? -1 : 1;
      return (b.lastAt ?? 0) - (a.lastAt ?? 0);
    });
    const syncedAt = Math.max(
      0,
      ...events.map(e => e.syncedAt),
      ...threads.map(t => t.syncedAt),
    );
    return {
      today,
      upcoming,
      nextCall: [...nextCall.values()].sort((a, b) => startMs(a) - startMs(b)),
      threads,
      calendarConfigured: events.length > 0,
      whatsappConfigured: threads.length > 0,
      syncedAt: syncedAt || undefined,
    };
  },
});
