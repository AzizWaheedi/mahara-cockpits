import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { allowedClients, assertRole, userEmail } from "./roles";

/** Replace the calendar wholesale. An empty read keeps what is there. */
export const storeCalendar = internalMutation({
  args: { rows: v.array(v.any()), append: v.optional(v.boolean()) },
  returns: v.object({ events: v.number() }),
  handler: async (ctx, { rows, append }) => {
    // The feed is the whole picture for the shared calendars, even when it
    // says "none"; stale shared rows used to linger. A person's own rows are
    // only replaced when the feed carries that person.
    const owners = new Set(rows.map(r => r.owner ?? ""));
    for (const old of await ctx.db.query("calendarEvents").collect())
      if (
        append
          ? owners.has(old.owner ?? "")
          : !old.owner || owners.has(old.owner)
      )
        await ctx.db.delete(old._id);
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
    // What this app added to a thread (Hermes's draft, a reply in flight)
    // must survive the refresh, which only knows what the CRM knows.
    const kept = new Map<string, Record<string, unknown>>();
    const existing = await ctx.db.query("waThreads").collect();
    for (const old of existing)
      kept.set(old.chatId, {
        draft: old.draft,
        draftAt: old.draftAt,
        repliedAt: old.repliedAt,
        sendingAt: old.sendingAt,
        sendError: old.sendError,
      });
    if (!append) for (const old of existing) await ctx.db.delete(old._id);
    else
      for (const t of threads)
        for (const old of existing)
          if (old.chatId === t.chatId) await ctx.db.delete(old._id);
    const now = Date.now();
    for (const t of threads) {
      const k = kept.get(t.chatId) ?? {};
      // A draft is for one client message; a newer message needs a new one.
      const sameMessage =
        k.draftAt && t.lastAt && Number(k.draftAt) >= Number(t.lastAt);
      await ctx.db.insert("waThreads", {
        ...t,
        draft: sameMessage ? k.draft : undefined,
        draftAt: sameMessage ? k.draftAt : undefined,
        repliedAt: t.lastFromUs ? undefined : k.repliedAt,
        sendingAt: k.sendingAt,
        sendError: k.sendError,
        recent: t.recent ?? [],
        syncedAt: now,
      });
    }
    return { threads: threads.length };
  },
});

/** The cockpit's Google service account: share a calendar with it and the cockpit can read it. */
const SERVICE_ACCOUNT =
  "claude@studied-handler-508106-m5.iam.gserviceaccount.com";

const kuwaitDay = (ms: number) =>
  new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

export const overview = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => buildOverview(ctx, false),
});

// biome-ignore lint/suspicious/noExplicitAny: payload shape is the screen's
export async function buildOverview(
  ctx: QueryCtx,
  smoke: boolean,
): Promise<any> {
  if (!smoke) await assertRole(ctx, "csm");
  const who = smoke ? "" : await userEmail(ctx);
  // A client list set in the portal hides the other clients' conversations.
  const scope = smoke ? null : await allowedClients(ctx);
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
  const allThreads = await ctx.db.query("waThreads").collect();
  // Threads matched to no client stay visible only to an unrestricted seat.
  const threads = allThreads.filter(t => inScope(scope, t.clientName));
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
    whatsappConfigured: allThreads.length > 0,
    syncedAt: syncedAt || undefined,
  };
}

/** No scope means every thread; a scoped seat sees only its own clients' threads. */
function inScope(scope: Set<string> | null, clientName?: string): boolean {
  if (!scope) return true;
  return Boolean(clientName && scope.has(clientName.trim().toLowerCase()));
}

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
      sendingAt: undefined,
      sendError: undefined,
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
export const sendReply = authenticatedMutation({
  args: { chatId: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { chatId, text }) => {
    await assertRole(ctx, "csm");
    const t = (await ctx.db.query("waThreads").collect()).find(
      x => x.chatId === chatId,
    );
    if (!t) throw new Error("thread not found");
    if (!inScope(await allowedClients(ctx), t.clientName))
      throw new Error("That client is not on your list.");
    await ctx.db.insert("outbox", {
      kind: "wa_send",
      clientTaskId: chatId,
      clientName: t.name,
      action: "WhatsApp reply",
      evidence: text.trim(),
      value: `${t.source ?? "ghl"}/${t.channel ?? "whatsapp"}`,
      note: t.contactId,
      createdAt: Date.now(),
    });
    // Not "replied" yet: that is stamped when the CRM confirms the send.
    await ctx.db.patch(t._id, { sendingAt: Date.now(), sendError: undefined });
    return null;
  },
});

/** The send failed: back to waiting, with the reason on the thread. */
export const sendFailed = internalMutation({
  args: { chatId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { chatId, error }) => {
    const t = (await ctx.db.query("waThreads").collect()).find(
      x => x.chatId === chatId,
    );
    if (t)
      await ctx.db.patch(t._id, {
        sendingAt: undefined,
        sendError: error.slice(0, 200),
      });
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
export const linkCalendar = authenticatedMutation({
  args: { calendarId: v.string() },
  returns: v.null(),
  handler: async (ctx, { calendarId }) => {
    await assertRole(ctx, "csm");
    const who = await userEmail(ctx);
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

export const unlinkCalendar = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    await assertRole(ctx, "csm");
    const who = await userEmail(ctx);
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
      if (
        l.status === String(st.status) &&
        l.note === (st.note ? String(st.note) : undefined) &&
        l.events === Number(st.events ?? 0)
      )
        continue;
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
