import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
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
 *   CSM_CALENDAR_IDS, CREATIVE_CALENDAR_IDS   comma-separated calendar ids
 *   CSM_WHAPI_TOKEN, CREATIVE_WHAPI_TOKEN     WHAPI channel tokens
 *   WHAPI_BASE_URL                            default https://gate.whapi.cloud
 */

declare const process: { env: Record<string, string | undefined> };

// biome-ignore lint/suspicious/noExplicitAny: external payloads
type Any = any;
type App = "csm" | "creative";

const MSG_PER_CHAT = 40;
const MAX_CHATS = 150;

async function bridge(
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
    body: JSON.stringify({ fn, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false)
    throw new Error(
      `${app}:${fn} → HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`,
    );
  return body.data;
}

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Match free text to a client by name: exact containment, longest unique wins. */
function matchClient(text: string, names: string[]): string | undefined {
  const blob = norm(text);
  const hits = names.filter(n => norm(n).length >= 4 && blob.includes(norm(n)));
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => norm(b).length - norm(a).length);
  if (hits.length === 1 || norm(hits[0]).length > norm(hits[1]).length)
    return hits[0];
  return undefined;
}

// --- Google Calendar ------------------------------------------------------------

async function calendarEvents(calendarId: string, token: string) {
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

const DATABASE = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";

/**
 * Client Data on the database sheet carries each client's WhatsApp group id
 * (column F, "…@g.us"). That beats guessing from the group name, which is
 * often the client's nickname or Arabic spelling. [Aziz, 2026-09-10]
 */
async function whatsappGroupsFromSheet(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const token = await googleAccessToken();
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${DATABASE}/values/${encodeURIComponent("Client Data!A1:F200")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    for (const row of ((data?.values ?? []) as string[][]).slice(1)) {
      const [, name = "", , , , group = ""] = row;
      if (name && /@g\.us$/.test(group.trim())) out.set(group.trim(), name);
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

// --- The feed --------------------------------------------------------------------

export const feedComms = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const report: Record<string, unknown> = {};
    // Client names for matching: the CSM roster plus campaign client names.
    const names: string[] = await ctx.runQuery(internal.comms.clientNames, {});

    for (const app of ["csm", "creative"] as const) {
      const prefix = app === "csm" ? "CSM" : "CREATIVE";
      const calendarIds = (process.env[`${prefix}_CALENDAR_IDS`] ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      if (calendarIds.length) {
        try {
          const token = await googleAccessToken();
          const rows: Any[] = [];
          for (const id of calendarIds) {
            try {
              rows.push(...(await calendarEvents(id, token)));
            } catch (e) {
              report[`${app}.calendar.${id}`] =
                `FAILED ${String(e).slice(0, 160)}`;
            }
          }
          for (const r of rows)
            r.clientName = matchClient(
              `${r.title} ${r.attendees.join(" ")} ${r.description ?? ""}`,
              names,
            );
          report[`${app}.calendar`] = await bridge(app, "storeCalendar", {
            rows,
          });
        } catch (e) {
          report[`${app}.calendar`] = `FAILED ${String(e).slice(0, 160)}`;
        }
      } else {
        report[`${app}.calendar`] = "not configured";
      }

      const waToken = process.env[`${prefix}_WHAPI_TOKEN`];
      if (waToken) {
        try {
          const threads = await whatsappThreads(waToken, names);
          report[`${app}.whatsapp`] = await bridge(app, "storeWhatsapp", {
            threads,
          });
        } catch (e) {
          report[`${app}.whatsapp`] = `FAILED ${String(e).slice(0, 160)}`;
        }
      } else {
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
