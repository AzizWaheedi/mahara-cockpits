import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { readClientData } from "./clientData";
import { googleAccessToken } from "./tools";

/**
 * Meetings and messages for the client success and creative cockpits.
 *
 * Two sources, both read-only here:
 *   - Google Calendar: each person shares their calendar with the service
 *     account; this reads a week back and three weeks ahead and tags events
 *     with the client they are about.
 *   - WhatsApp, through a WHAPI channel per business number: every group and
 *     private chat, the last messages in each, who spoke last, and how long a
 *     client has been waiting for a reply.
 *
 * Env on this deployment (all optional; a missing one skips that feed):
 *   MAHARA_GHL_TOKEN                          Mahara's own GHL sub-account: its
 *                                             calendars and conversations feed both cockpits
 *   MAHARA_GHL_LOCATION                       default wwG426bwruWWv9W3fazQ
 *   CSM_CALENDAR_IDS, CREATIVE_CALENDAR_IDS   comma-separated calendar ids
 *   CSM_WHAPI_TOKEN, CREATIVE_WHAPI_TOKEN     WHAPI channel tokens
 *   WHAPI_BASE_URL                            default https://gate.whapi.cloud
 */

declare const process: { env: Record<string, string | undefined> };

// biome-ignore lint/suspicious/noExplicitAny: external payloads
type Any = any;
export type App = "csm" | "creative";

const MSG_PER_CHAT = 40;
const MAX_CHATS = 150;

/**
 * A message body cut in the middle of an emoji leaves a lone surrogate; the
 * receiving JSON parser rejects it ("unexpected end of hex escape") and the
 * whole chunk is lost. Strip them from every string before sending.
 */
function wellFormed<T>(value: T): T {
  if (typeof value === "string")
    return value.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    ) as T;
  if (Array.isArray(value)) return value.map(wellFormed) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        wellFormed(v),
      ]),
    ) as T;
  return value;
}

export async function bridge(
  app: App,
  fn: string,
  args: Record<string, unknown>,
): Promise<Any> {
  const url =
    process.env[app === "creative" ? "CREATIVE_BRIDGE_URL" : "CSM_BRIDGE_URL"];
  const token =
    process.env[
      app === "creative" ? "CREATIVE_BRIDGE_TOKEN" : "CSM_BRIDGE_TOKEN"
    ];
  if (!url || !token) throw new Error(`${app} bridge not configured`);
  const res = await fetch(`${url}/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fn, args: wellFormed(args) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false)
    throw new Error(
      `${app}:${fn} → HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`,
    );
  return body.data;
}

/** Cut to `n` characters without splitting an emoji, and drop lone surrogates that break JSON. */
function clip(x: unknown, n: number): string {
  const chars = Array.from(
    String(x ?? "").replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    ),
  );
  return chars.slice(0, n).join("");
}

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Match free text to a client by name: exact containment, longest unique wins. */
export function matchClient(text: string, names: string[]): string | undefined {
  const blob = norm(text);
  const hits = names.filter(n => norm(n).length >= 4 && blob.includes(norm(n)));
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => norm(b).length - norm(a).length);
  if (hits.length === 1 || norm(hits[0]).length > norm(hits[1]).length)
    return hits[0];
  return undefined;
}

// --- Google Calendar ------------------------------------------------------------

export async function calendarEvents(calendarId: string, token: string) {
  const timeMin = new Date(Date.now() - 7 * 86400_000).toISOString();
  const timeMax = new Date(Date.now() + 21 * 86400_000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `calendar ${calendarId}: ${json?.error?.message ?? res.status}`,
    );
  return ((json.items ?? []) as Any[])
    .filter(e => e.status !== "cancelled")
    .map(e => ({
      eventId: String(e.id),
      calendarId,
      title: String(e.summary ?? "(no title)"),
      start: String(e.start?.dateTime ?? e.start?.date ?? ""),
      end: String(e.end?.dateTime ?? e.end?.date ?? ""),
      allDay: !e.start?.dateTime,
      location: e.location ? String(e.location) : undefined,
      meetLink:
        e.hangoutLink ??
        e.conferenceData?.entryPoints?.find(
          (p: Any) => p.entryPointType === "video",
        )?.uri ??
        undefined,
      attendees: ((e.attendees ?? []) as Any[])
        .map(a => String(a.displayName ?? a.email ?? ""))
        .filter(Boolean),
      /** Emails decide client vs team; dropped before the row is stored. */
      emails: ((e.attendees ?? []) as Any[])
        .map(a => String(a.email ?? "").toLowerCase())
        .filter(Boolean) as string[],
      description: e.description
        ? String(e.description).slice(0, 500)
        : undefined,
      htmlLink: e.htmlLink,
    }));
}

// --- WhatsApp (WHAPI) -----------------------------------------------------------

async function whapi(token: string, path: string): Promise<Any> {
  const base = process.env.WHAPI_BASE_URL || "https://gate.whapi.cloud";
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `WHAPI ${path} ${res.status}: ${String(json?.message ?? json?.error ?? "").slice(0, 160)}`,
    );
  return json;
}

/** Group id → client name from the Client Data tab. */
async function whatsappGroupsFromSheet(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (const r of await readClientData()) {
      if (/@g\.us$/.test(r.waGroupId)) out.set(r.waGroupId, r.name);
    }
  } catch (e) {
    console.log(
      `comms: Client Data unreadable, falling back to name matching: ${String(e).slice(0, 120)}`,
    );
  }
  return out;
}

async function whatsappThreads(token: string, names: string[]) {
  const groupOwner = await whatsappGroupsFromSheet();
  const health = await whapi(token, "/health");
  const code = health?.status?.code;
  if (code !== undefined && code !== 0) {
    throw new Error(
      `WhatsApp session not connected (${health?.status?.text ?? code}); the number needs a QR re-scan`,
    );
  }
  const groups: Any[] =
    (await whapi(token, `/groups?count=${MAX_CHATS}`)).groups ?? [];
  const chats: Any[] = (
    (await whapi(token, `/chats?count=${MAX_CHATS}`)).chats ?? []
  ).filter((c: Any) => !String(c.id ?? "").endsWith("@g.us"));
  const all = [
    ...groups.map(g => ({ ...g, isGroup: true })),
    ...chats.map(c => ({ ...c, isGroup: false })),
  ];
  const now = Date.now();
  const out: Any[] = [];
  for (const chat of all) {
    const id = String(chat.id ?? "");
    if (!id) continue;
    const name = String(chat.name ?? chat.subject ?? id);
    let msgs: Any[] = [];
    try {
      msgs =
        (
          await whapi(
            token,
            `/messages/list/${encodeURIComponent(id)}?count=${MSG_PER_CHAT}`,
          )
        ).messages ?? [];
    } catch (e) {
      out.push({
        chatId: id,
        name,
        isGroup: chat.isGroup,
        error: String(e).slice(0, 160),
        recent: [],
        syncedAt: now,
      });
      continue;
    }
    if (msgs.length === 0) continue;
    // WHAPI returns newest first.
    const newest = msgs[0];
    const lastAt = Number(newest.timestamp ?? 0) * 1000;
    const lastFromUs = Boolean(newest.from_me);
    // How long the other side has been waiting: from the newest message of
    // theirs that came after our last reply.
    let waitingSince: number | undefined;
    if (!lastFromUs) {
      const ours = msgs.findIndex(m => m.from_me);
      const theirs = ours === -1 ? msgs : msgs.slice(0, ours);
      const oldest = theirs[theirs.length - 1];
      waitingSince = Number(oldest?.timestamp ?? newest.timestamp ?? 0) * 1000;
    }
    const recent = msgs
      .slice(0, 12)
      .reverse()
      .map(m => ({
        at: Number(m.timestamp ?? 0) * 1000,
        fromMe: Boolean(m.from_me),
        who: m.from_me ? "Mahara" : String(m.from_name ?? m.from ?? ""),
        text: String(
          m.text?.body ?? m.caption ?? `[${m.type ?? "media"}]`,
        ).slice(0, 300),
      }));
    out.push({
      chatId: id,
      source: "whapi",
      name,
      isGroup: chat.isGroup,
      clientName: groupOwner.get(id) ?? matchClient(name, names),
      lastAt,
      lastFromUs,
      waitingSince,
      silentDays: lastAt ? Math.floor((now - lastAt) / 86400_000) : undefined,
      recent,
      syncedAt: now,
    });
  }
  return out;
}

// --- Mahara's own GHL sub-account: calendars and conversations --------------------
//
// Aziz, 2026-09-10: "keep them in the Mahara client account … as well as the
// WhatsApp groups … and the calendars as well from there." One token
// (MAHARA_GHL_TOKEN) on one location feeds both cockpits.

const GHL = "https://services.leadconnectorhq.com";
const MAHARA_LOCATION = () =>
  process.env.MAHARA_GHL_LOCATION || "wwG426bwruWWv9W3fazQ";
const CONVERSATION_LIMIT = 100;
const MESSAGES_PER_CONVERSATION = 10;

async function ghl(
  token: string,
  path: string,
  version = "2021-04-15",
): Promise<Any> {
  const res = await fetch(`${GHL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `GHL ${path} ${res.status}: ${String(json?.message ?? "").slice(0, 120)}`,
    );
  return json;
}

async function ghlCalendarEvents(token: string, names: string[]) {
  const loc = MAHARA_LOCATION();
  const from = Date.now() - 7 * 86400_000;
  const to = Date.now() + 21 * 86400_000;
  const cals: Any[] =
    (await ghl(token, `/calendars/?locationId=${loc}`)).calendars ?? [];
  const rows: Any[] = [];
  for (const cal of cals) {
    let d: Any;
    try {
      d = await ghl(
        token,
        `/calendars/events?locationId=${loc}&calendarId=${cal.id}&startTime=${from}&endTime=${to}`,
      );
    } catch (e) {
      console.warn(`calendar ${cal.name}: ${String(e).slice(0, 100)}`);
      continue;
    }
    const evs = (d?.events ?? []) as Any[];
    if (evs.length)
      console.log(
        `calendar ${cal.name}: ${evs.length} event(s), statuses ${[...new Set(evs.map(e => e.appointmentStatus))].join(",")}`,
      );
    for (const e of evs) {
      if (/cancel/i.test(String(e.appointmentStatus ?? ""))) continue;
      const title = String(e.title ?? cal.name ?? "(no title)");
      const who = String(e.contact?.name ?? e.contactName ?? "");
      rows.push({
        eventId: String(e.id),
        calendarId: String(cal.name ?? cal.id),
        title,
        start: String(e.startTime ?? ""),
        end: String(e.endTime ?? ""),
        allDay: false,
        location: e.address ? String(e.address) : undefined,
        meetLink: undefined,
        attendees: [who, String(e.assignedUserId ?? "")].filter(Boolean),
        description: e.notes ? clip(e.notes, 500) : undefined,
        htmlLink: undefined,
        clientName: matchClient(`${title} ${who} ${e.notes ?? ""}`, names),
      });
    }
  }
  return rows;
}

async function ghlThreads(token: string, names: string[]) {
  const loc = MAHARA_LOCATION();
  const d = await ghl(
    token,
    `/conversations/search?locationId=${loc}&limit=${CONVERSATION_LIMIT}&sortBy=last_message_date&sort=desc`,
  );
  // Only WhatsApp, and only from the day the number was (re)connected. The
  // older SMS/email conversations on this location belonged to a previous
  // CSM and were disconnected long ago. Aziz, 2026-09-10: "forget the old
  // WhatsApp messages … I'm going to sync all the WhatsApp groups with my
  // number." Override the date with WHATSAPP_SINCE (YYYY-MM-DD) if needed.
  const since = Date.parse(
    `${process.env.WHATSAPP_SINCE || "2026-09-10"}T00:00:00+03:00`,
  );
  const convos: Any[] = (d?.conversations ?? []).filter((c: Any) => {
    const type = String(c.lastMessageType ?? c.type ?? "").toUpperCase();
    const at = Number(c.lastMessageDate ?? 0);
    // SMS rides the same CRM door as WhatsApp, so it is read and answered here too.
    return (type.includes("WHATSAPP") || type.includes("SMS")) && at >= since;
  });
  const now = Date.now();
  const out: Any[] = [];
  for (const c of convos) {
    const id = String(c.id ?? "");
    if (!id) continue;
    const name = String(
      c.fullName ?? c.contactName ?? c.email ?? c.phone ?? id,
    );
    let msgs: Any[] = [];
    try {
      const m = await ghl(
        token,
        `/conversations/${id}/messages?limit=${MESSAGES_PER_CONVERSATION}`,
      );
      msgs = m?.messages?.messages ?? m?.messages ?? [];
    } catch (e) {
      out.push({
        chatId: id,
        name,
        isGroup: false,
        error: String(e).slice(0, 160),
        recent: [],
        syncedAt: now,
      });
      continue;
    }
    // GHL returns newest first.
    const ts = (m: Any) =>
      new Date(m.dateAdded ?? m.dateUpdated ?? 0).getTime();
    const outbound = (m: Any) => String(m.direction ?? "") === "outbound";
    const lastAt = msgs.length
      ? ts(msgs[0])
      : Number(c.lastMessageDate ?? 0) || undefined;
    const lastFromUs = msgs.length
      ? outbound(msgs[0])
      : String(c.lastMessageDirection ?? "") === "outbound";
    let waitingSince: number | undefined;
    if (!lastFromUs && msgs.length) {
      const ours = msgs.findIndex(outbound);
      const theirs = ours === -1 ? msgs : msgs.slice(0, ours);
      waitingSince = ts(theirs[theirs.length - 1]);
    } else if (!lastFromUs && lastAt) waitingSince = lastAt;
    const channel = String(c.lastMessageType ?? c.type ?? "")
      .replace(/^TYPE_/, "")
      .toLowerCase();
    const recent = msgs
      .slice(0, 12)
      .reverse()
      .map(m => ({
        at: ts(m),
        fromMe: outbound(m),
        who: outbound(m) ? "Mahara" : name,
        text: String(
          m.body ??
            m.text ??
            `[${String(m.messageType ?? "message")
              .replace(/^TYPE_/, "")
              .toLowerCase()}]`,
        ).slice(0, 300),
      }));
    out.push({
      chatId: id,
      source: "ghl",
      contactId: c.contactId ? String(c.contactId) : undefined,
      channel: channel.includes("sms") ? "sms" : "whatsapp",
      name: channel ? `${name} · ${channel}` : name,
      isGroup: false,
      clientName: matchClient(name, names),
      lastAt,
      lastFromUs,
      waitingSince,
      silentDays: lastAt ? Math.floor((now - lastAt) / 86400_000) : undefined,
      unread: Number(c.unreadCount ?? 0) || undefined,
      recent,
      syncedAt: now,
    });
  }
  return out;
}

// --- The feed --------------------------------------------------------------------

export const feedComms = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const report: Record<string, unknown> = {};
    // Client names for matching: the CSM roster plus campaign client names.
    const names: string[] = await ctx.runQuery(internal.comms.clientNames, {});

    // One Mahara GHL sub-account carries the calendars and every conversation
    // (WhatsApp included). When its token is set it feeds both cockpits and
    // the per-role calendar / WHAPI settings below are only used if present.
    const mahara = process.env.MAHARA_GHL_TOKEN;
    const covered = { calendar: false, whatsapp: false };
    // Shared client calendars (GHL) go to every cockpit; each person's own
    // Google Calendar is added per cockpit below.
    const ghlRows: Any[] = [];
    if (mahara) {
      try {
        ghlRows.push(...(await ghlCalendarEvents(mahara, names)));
        covered.calendar = true;
      } catch (e) {
        report["mahara.calendar"] = `FAILED ${String(e).slice(0, 160)}`;
      }
      try {
        const threads = await ghlThreads(mahara, names);
        // 25 threads per call keeps each bridge body well under the size
        // that broke a single 180-thread push (JSON cut mid-escape).
        for (const app of ["csm", "creative"] as const) {
          let stored = 0;
          for (let i = 0; i < Math.max(threads.length, 1); i += 25) {
            const r = await bridge(app, "storeWhatsapp", {
              threads: threads.slice(i, i + 25),
              append: i > 0,
              // A successful read that finds nothing still replaces what
              // was there: the old number's threads must not linger.
              clear: i === 0,
            });
            stored += Number(r?.threads ?? 0);
          }
          report[`${app}.whatsapp`] = { threads: stored };
        }
        covered.whatsapp = true;
        try {
          report["drafts"] = await ctx.runAction(internal.replyDrafts.queue, {
            threads: threads
              .filter((t: Any) => t.waitingSince)
              .map((t: Any) => ({
                chatId: t.chatId,
                name: t.name,
                clientName: t.clientName,
                lastAt: t.lastAt,
                recent: t.recent,
              })),
          });
        } catch (e) {
          report["drafts"] = `FAILED ${String(e).slice(0, 160)}`;
        }
      } catch (e) {
        report["mahara.conversations"] = `FAILED ${String(e).slice(0, 160)}`;
      }
    }

    // The media buyer cockpit's own calendar view.
    try {
      const own: Any = await ctx.runAction(internal.personalCalendars.rowsFor, {
        app: "mb",
        names,
      });
      report["mb.calendar"] = await ctx.runMutation(
        internal.personalCalendars.store,
        { rows: [...ghlRows, ...own.rows] },
      );
      if (own.statuses.length) report["mb.calendars"] = own.statuses;
    } catch (e) {
      report["mb.calendar"] = `FAILED ${String(e).slice(0, 160)}`;
    }

    for (const app of ["csm", "creative"] as const) {
      const prefix = app === "csm" ? "CSM" : "CREATIVE";
      const calendarIds = (process.env[`${prefix}_CALENDAR_IDS`] ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      const rows: Any[] = [...ghlRows];
      if (calendarIds.length) {
        try {
          const token = await googleAccessToken();
          for (const id of calendarIds) {
            try {
              for (const r of await calendarEvents(id, token))
                rows.push({
                  ...r,
                  emails: undefined,
                  clientName: matchClient(
                    `${r.title} ${r.attendees.join(" ")} ${r.description ?? ""}`,
                    names,
                  ),
                });
            } catch (e) {
              report[`${app}.calendar.${id}`] =
                `FAILED ${String(e).slice(0, 160)}`;
            }
          }
        } catch (e) {
          report[`${app}.calendar.google`] =
            `FAILED ${String(e).slice(0, 160)}`;
        }
      }
      try {
        const own: Any = await ctx.runAction(
          internal.personalCalendars.rowsFor,
          { app, names },
        );
        rows.push(...own.rows);
        if (own.statuses.length) report[`${app}.calendars`] = own.statuses;
      } catch (e) {
        report[`${app}.calendars`] = `FAILED ${String(e).slice(0, 160)}`;
      }
      try {
        report[`${app}.calendar`] = rows.length
          ? await bridge(app, "storeCalendar", { rows })
          : "not configured";
      } catch (e) {
        report[`${app}.calendar`] = `FAILED ${String(e).slice(0, 160)}`;
      }

      const waToken = process.env[`${prefix}_WHAPI_TOKEN`];
      if (waToken && !covered.whatsapp) {
        try {
          const threads = await whatsappThreads(waToken, names);
          report[`${app}.whatsapp`] = await bridge(app, "storeWhatsapp", {
            threads,
          });
        } catch (e) {
          report[`${app}.whatsapp`] = `FAILED ${String(e).slice(0, 160)}`;
        }
      } else if (!covered.whatsapp) {
        report[`${app}.whatsapp`] = "not configured";
      }
    }
    console.log(`comms feed: ${JSON.stringify(report)}`);
    return report;
  },
});

export const clientNames = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async ctx => {
    const names = new Set<string>();
    for (const c of await ctx.db.query("clients").collect()) names.add(c.name);
    for (const c of await ctx.db.query("campaigns").collect()) {
      if (c.clientName) names.add(c.clientName);
    }
    return [...names];
  },
});
