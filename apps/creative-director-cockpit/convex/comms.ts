import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

/** Replace the calendar wholesale. An empty read keeps what is there. */
export const storeCalendar = internalMutation({
  args: { rows: v.array(v.any()), append: v.optional(v.boolean()) },
  returns: v.object({ events: v.number() }),
  handler: async (ctx, { rows, append }) => {
    if (rows.length === 0 && !append) return { events: 0 };
    // With `append`, only the owners in these rows are replaced.
    const owners = new Set(rows.map(r => r.owner ?? ""));
    for (const old of await ctx.db.query("calendarEvents").collect())
      if (!append || owners.has(old.owner ?? "")) await ctx.db.delete(old._id);
    const now = Date.now();
    for (const r of rows)
      await ctx.db.insert("calendarEvents", { ...r, syncedAt: now });
    return { events: rows.length };
  },
});

export const storeWhatsapp = internalMutation({
  args: {
    threads: v.array(v.any()),
    append: v.optional(v.boolean()),
    /** Wipe even when the read came back empty (a number reconnected, old threads gone). */
    clear: v.optional(v.boolean()),
  },
  returns: v.object({ threads: v.number() }),
  handler: async (ctx, { threads, append, clear }) => {
    // Sent in chunks: the first call replaces, the rest append.
    if (threads.length === 0 && !append && !clear) return { threads: 0 };
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

// biome-ignore lint/suspicious/noExplicitAny: ctx from query or mutation
async function me(ctx: any): Promise<string> {
  try {
    const id = await ctx.auth.getUserIdentity();
    return String(id?.email ?? id?.subject ?? "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

/** The cockpit's Google service account: share a calendar with it and the cockpit can read it. */
const SERVICE_ACCOUNT =
  "claude@studied-handler-508106-m5.iam.gserviceaccount.com";

const kuwaitDay = (ms: number) =>
  new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

export const overview = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const who = await me(ctx);
    const myLink =
      (
        await ctx.db
          .query("calendarLinks")
          .withIndex("by_owner", q => q.eq("owner", who))
          .collect()
      )[0] ?? null;
    // Shared client calendars for everyone, personal calendars only to their owner.
    const events = (
      await ctx.db.query("calendarEvents").withIndex("by_start").collect()
    ).filter(e => !e.owner || e.owner === who);
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
      myCalendar: myLink,
      saEmail: SERVICE_ACCOUNT,
      whatsappConfigured: threads.length > 0,
      syncedAt: syncedAt || undefined,
    };
  },
});

// --- Replies -----------------------------------------------------------------------

/** Hermes's recommended reply for a thread, from the media buyer backend. */
export const storeReplyDraft = internalMutation({
  args: { chatId: v.string(), draft: v.string(), draftAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { chatId, draft, draftAt }) => {
    const t = (await ctx.db.query("waThreads").collect()).find(
      x => x.chatId === chatId,
    );
    if (t) await ctx.db.patch(t._id, { draft, draftAt });
    return null;
  },
});

/** A reply went out: the thread is no longer waiting on us. */
export const markReplied = internalMutation({
  args: { chatId: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { chatId, text }) => {
    const t = (await ctx.db.query("waThreads").collect()).find(
      x => x.chatId === chatId,
    );
    if (!t) return null;
    const now = Date.now();
    await ctx.db.patch(t._id, {
      lastAt: now,
      lastFromUs: true,
      waitingSince: undefined,
      silentDays: 0,
      repliedAt: now,
      draft: undefined,
      recent: [
        ...(t.recent ?? []).slice(-11),
        { at: now, fromMe: true, who: "Mahara", text },
      ],
    });
    return null;
  },
});

/** Send a reply from the Meetings & messages page. Leaves within a minute through the media buyer backend. */
export const sendReply = mutation({
  args: { chatId: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { chatId, text }) => {
    const t = (await ctx.db.query("waThreads").collect()).find(
      x => x.chatId === chatId,
    );
    if (!t) throw new Error("thread not found");
    await ctx.db.insert("creativeOutbox", {
      kind: "wa_send",
      payload: {
        chatId,
        text: text.trim(),
        source: t.source ?? "ghl",
        contactId: t.contactId,
        channel: t.channel ?? "whatsapp",
      },
      state: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.patch(t._id, { repliedAt: Date.now() });
    return null;
  },
});

// --- Your own Google Calendar ---------------------------------------------------------

/**
 * Aziz, 2026-09-12: every cockpit should let people connect their Google
 * Calendar so it tells them today's meetings, team and client alike. The
 * person shares their calendar with the service account and types their
 * Google email here; the media buyer backend reads it within a minute.
 */
export const linkCalendar = mutation({
  args: { calendarId: v.string() },
  returns: v.null(),
  handler: async (ctx, { calendarId }) => {
    const who = await me(ctx);
    if (!who) throw new Error("Sign in first.");
    const id = calendarId.trim().toLowerCase();
    if (!id.includes("@"))
      throw new Error(
        "Enter the Google account email the calendar belongs to.",
      );
    for (const l of await ctx.db
      .query("calendarLinks")
      .withIndex("by_owner", q => q.eq("owner", who))
      .collect())
      await ctx.db.delete(l._id);
    await ctx.db.insert("calendarLinks", {
      owner: who,
      calendarId: id,
      status: "pending",
      createdAt: Date.now(),
    });
    return null;
  },
});

export const unlinkCalendar = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const who = await me(ctx);
    if (!who) throw new Error("Sign in first.");
    for (const l of await ctx.db
      .query("calendarLinks")
      .withIndex("by_owner", q => q.eq("owner", who))
      .collect())
      await ctx.db.delete(l._id);
    for (const e of await ctx.db.query("calendarEvents").collect())
      if (e.owner === who) await ctx.db.delete(e._id);
    return null;
  },
});

/** Bridge: every linked calendar, for the media buyer backend to read. */
export const calendarLinks = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => await ctx.db.query("calendarLinks").collect(),
});

/** Bridge: what the read found for each link. */
export const calendarLinkStatus = internalMutation({
  args: { statuses: v.array(v.any()) },
  returns: v.null(),
  handler: async (ctx, { statuses }) => {
    const all = await ctx.db.query("calendarLinks").collect();
    for (const st of statuses) {
      const l = all.find(x => x.calendarId === st.calendarId);
      if (!l) continue;
      await ctx.db.patch(l._id, {
        status: String(st.status),
        note: st.note ? String(st.note) : undefined,
        events: Number(st.events ?? 0),
        checkedAt: Date.now(),
      });
    }
    return null;
  },
});
