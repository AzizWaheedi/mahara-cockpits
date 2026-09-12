import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { type App, bridge, calendarEvents, matchClient } from "./comms";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { emailOf } from "./gate";
import { assertRole } from "./roles";
import { googleAccessToken } from "./tools";

/**
 * Each person's own Google Calendar in their cockpit.
 *
 * Aziz, 2026-09-12: "every cockpit should also allow them to integrate their
 * Google Calendar so it can also tell them what meetings they have today
 * (team meetings, client meetings, all that stuff)."
 *
 * How it connects, with no OAuth and no new secrets: the person shares their
 * calendar with the cockpit's Google service account (see all event details)
 * and types their Google account email into the cockpit. This file reads
 * those calendars with the service account, tags every event as a client
 * meeting, a team meeting or other, and hands the rows to the cockpit the
 * link came from. Newly linked calendars are checked within a minute (from
 * the outbox drain); everything refreshes with the comms feed.
 */

// biome-ignore lint/suspicious/noExplicitAny: calendar rows
type Any = any;

export const SERVICE_ACCOUNT =
  "claude@studied-handler-508106-m5.iam.gserviceaccount.com";

const TEAM_WORDS =
  /\b(team|standup|stand-up|daily|weekly|monthly|sync|1:1|1-1|one on one|internal|huddle|all hands|retro|planning|review|training|onboarding)\b/i;

/** Client if it is about a client; team if only Mahara people are in it. */
export function classify(
  title: string,
  emails: string[],
  clientName: string | undefined,
): "client" | "team" | "other" {
  if (clientName) return "client";
  const outside = emails.filter(
    e => e && !/@maharamedia\.com$/i.test(e) && !/gserviceaccount/.test(e),
  );
  if (TEAM_WORDS.test(title)) return "team";
  if (emails.length > 1 && outside.length === 0) return "team";
  return "other";
}

/**
 * The link is keyed by the person's email. The auth JWT carries no email, so
 * keying on getUserIdentity() meant a new owner on every sign-in and device,
 * and a calendar that had to be linked again each time.
 */
// biome-ignore lint/suspicious/noExplicitAny: ctx from query or mutation
async function who(ctx: any): Promise<string> {
  await assertRole(ctx, "media_buyer");
  return await emailOf(ctx);
}

const kuwaitDay = (ms: number) =>
  new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

// --- This cockpit's own tables ------------------------------------------------------

export const links = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => await ctx.db.query("calendarLinks").collect(),
});

export const setStatus = internalMutation({
  args: { statuses: v.array(v.any()) },
  returns: v.null(),
  handler: async (ctx, { statuses }) => {
    const all = await ctx.db.query("calendarLinks").collect();
    for (const s of statuses) {
      const l = all.find(x => x.calendarId === s.calendarId);
      if (!l) continue;
      await ctx.db.patch(l._id, {
        status: String(s.status),
        note: s.note ? String(s.note) : undefined,
        events: Number(s.events ?? 0),
        checkedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Replace the calendar, or with `append` only the owners these rows belong to. */
export const store = internalMutation({
  args: { rows: v.array(v.any()), append: v.optional(v.boolean()) },
  returns: v.object({ events: v.number() }),
  handler: async (ctx, { rows, append }) => {
    if (rows.length === 0 && !append) return { events: 0 };
    const owners = new Set(rows.map(r => r.owner ?? ""));
    for (const old of await ctx.db.query("calendarEvents").collect())
      if (!append || owners.has(old.owner ?? "")) await ctx.db.delete(old._id);
    const now = Date.now();
    for (const r of rows)
      await ctx.db.insert("calendarEvents", { ...r, syncedAt: now });
    return { events: rows.length };
  },
});

export const link = authenticatedMutation({
  args: { calendarId: v.string() },
  returns: v.null(),
  handler: async (ctx, { calendarId }) => {
    const me = await who(ctx);
    const id = calendarId.trim().toLowerCase();
    if (!id.includes("@"))
      throw new Error(
        "Enter the Google account email the calendar belongs to.",
      );
    for (const l of await ctx.db
      .query("calendarLinks")
      .withIndex("by_owner", q => q.eq("owner", me))
      .collect())
      await ctx.db.delete(l._id);
    await ctx.db.insert("calendarLinks", {
      owner: me,
      calendarId: id,
      status: "pending",
      createdAt: Date.now(),
    });
    // Checked right away rather than on the next minute's drain.
    await ctx.scheduler.runAfter(
      0,
      internal.personalCalendars.checkPending,
      {},
    );
    return null;
  },
});

/** Link a calendar on someone's behalf (CLI or Hermes), checked on the next minute. */
export const linkFor = internalMutation({
  args: { owner: v.string(), calendarId: v.string() },
  returns: v.null(),
  handler: async (ctx, { owner, calendarId }) => {
    const me = owner.trim().toLowerCase();
    for (const l of await ctx.db
      .query("calendarLinks")
      .withIndex("by_owner", q => q.eq("owner", me))
      .collect())
      await ctx.db.delete(l._id);
    await ctx.db.insert("calendarLinks", {
      owner: me,
      calendarId: calendarId.trim().toLowerCase(),
      status: "pending",
      createdAt: Date.now(),
    });
    return null;
  },
});

export const unlink = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const me = await who(ctx);
    for (const l of await ctx.db
      .query("calendarLinks")
      .withIndex("by_owner", q => q.eq("owner", me))
      .collect())
      await ctx.db.delete(l._id);
    for (const e of await ctx.db.query("calendarEvents").collect())
      if (e.owner === me) await ctx.db.delete(e._id);
    return null;
  },
});

/**
 * One-off, after the owner key changed from session id to email: rows keyed
 * "<userId>|<sessionId>" are re-keyed to that user's email, or dropped when
 * the user is gone. Run once from the CLI:
 * `bunx convex run --prod personalCalendars:migrateOwners`.
 */
export const migrateOwners = internalMutation({
  args: {},
  returns: v.object({
    links: v.number(),
    events: v.number(),
    chat: v.number(),
    dropped: v.number(),
  }),
  handler: async ctx => {
    const emailFor = async (key: string): Promise<string | null> => {
      if (key.includes("@")) return key.trim().toLowerCase();
      const userId = ctx.db.normalizeId("users", key.split("|")[0]);
      const user = userId ? await ctx.db.get(userId) : null;
      const email = String(user?.email ?? "")
        .trim()
        .toLowerCase();
      return email || null;
    };
    const out = { links: 0, events: 0, chat: 0, dropped: 0 };
    // Newest link per person wins; older sessions' links are duplicates.
    const links = (await ctx.db.query("calendarLinks").collect()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const kept = new Set<string>();
    for (const l of links) {
      const owner = await emailFor(l.owner);
      if (!owner || kept.has(owner)) {
        await ctx.db.delete(l._id);
        out.dropped++;
        continue;
      }
      kept.add(owner);
      if (owner !== l.owner) {
        await ctx.db.patch(l._id, { owner });
        out.links++;
      }
    }
    for (const e of await ctx.db.query("calendarEvents").collect()) {
      if (!e.owner) continue;
      const owner = await emailFor(e.owner);
      if (!owner) {
        await ctx.db.delete(e._id);
        out.dropped++;
      } else if (owner !== e.owner) {
        await ctx.db.patch(e._id, { owner });
        out.events++;
      }
    }
    for (const m of await ctx.db.query("hermesChat").collect()) {
      const thread = await emailFor(m.thread);
      if (thread && thread !== m.thread) {
        await ctx.db.patch(m._id, { thread });
        out.chat++;
      }
    }
    return out;
  },
});

/** The signed-in person's link and today's meetings: theirs plus the shared client calendars. */
export const mine = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const me = await who(ctx);
    const link =
      (
        await ctx.db
          .query("calendarLinks")
          .withIndex("by_owner", q => q.eq("owner", me))
          .collect()
      )[0] ?? null;
    const todayKey = kuwaitDay(Date.now());
    const today = (await ctx.db.query("calendarEvents").collect())
      .filter(e => !e.owner || e.owner === me)
      .filter(e =>
        e.allDay
          ? e.start === todayKey
          : kuwaitDay(new Date(e.start).getTime()) === todayKey,
      )
      .sort((a, b) => a.start.localeCompare(b.start));
    return { link, today, saEmail: SERVICE_ACCOUNT };
  },
});

// --- Reading the linked calendars -----------------------------------------------

/**
 * Read one cockpit's linked calendars. Returns the rows (owner and kind set)
 * and reports each link's status back to that cockpit.
 */
export const rowsFor = internalAction({
  args: {
    app: v.string(),
    names: v.array(v.string()),
    onlyPending: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { app, names, onlyPending }): Promise<Any> => {
    const all: Any[] =
      app === "mb"
        ? await ctx.runQuery(internal.personalCalendars.links, {})
        : ((await bridge(app as App, "calendarLinks", {})) ?? []);
    // "Pending" and "error" links are retried every minute, so sharing the
    // calendar is enough: no button to press afterwards.
    const wanted = all.filter(l => !onlyPending || l.status !== "ok");
    if (wanted.length === 0) return { rows: [], statuses: [] };
    const token = await googleAccessToken();
    const rows: Any[] = [];
    const statuses: Any[] = [];
    for (const l of wanted) {
      try {
        const evs = await calendarEvents(String(l.calendarId), token);
        for (const e of evs) {
          const clientName = matchClient(
            `${e.title} ${e.attendees.join(" ")} ${e.description ?? ""}`,
            names,
          );
          const emails: string[] = e.emails ?? [];
          rows.push({
            ...e,
            emails: undefined,
            owner: String(l.owner),
            clientName,
            kind: classify(e.title, emails, clientName),
          });
        }
        statuses.push({
          calendarId: l.calendarId,
          status: "ok",
          events: evs.length,
        });
      } catch (e) {
        const msg = String(e);
        const note = /has not been used in project|is disabled/i.test(msg)
          ? "The Google Calendar API is not switched on for the cockpit's Google project yet. Aziz enables it once at console.cloud.google.com (APIs & Services, Google Calendar API, Enable) and every calendar connects from then on."
          : /not found|404|forbidden|403/i.test(msg)
            ? `Not shared yet. In Google Calendar, share this calendar with ${SERVICE_ACCOUNT} (see all event details), then check again.`
            : msg.slice(0, 200);
        statuses.push({ calendarId: l.calendarId, status: "error", note });
      }
    }
    if (app === "mb")
      await ctx.runMutation(internal.personalCalendars.setStatus, { statuses });
    else await bridge(app as App, "calendarLinkStatus", { statuses });
    return { rows, statuses };
  },
});

/** Runs every minute from the outbox drain: a calendar linked just now shows up within the minute. */
export const checkPending = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    const names: string[] = await ctx.runQuery(internal.comms.clientNames, {});
    const out: Record<string, unknown> = {};
    for (const app of ["mb", "csm", "creative"]) {
      try {
        const r: Any = await ctx.runAction(internal.personalCalendars.rowsFor, {
          app,
          names,
          onlyPending: true,
        });
        if (r.rows.length) {
          if (app === "mb")
            await ctx.runMutation(internal.personalCalendars.store, {
              rows: r.rows,
              append: true,
            });
          else
            await bridge(app as App, "storeCalendar", {
              rows: r.rows,
              append: true,
            });
        }
        if (r.statuses.length) out[app] = r.statuses;
      } catch (e) {
        out[app] = `FAILED ${String(e).slice(0, 160)}`;
      }
    }
    return out;
  },
});
