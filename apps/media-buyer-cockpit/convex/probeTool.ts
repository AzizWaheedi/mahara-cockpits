import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { clientDataFor, readClientData } from "./clientData";
import { allAdAccounts, callTool, graph, unwrap } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: Meta payloads
type Any = any;
declare const process: { env: Record<string, string | undefined> };

/** Clear test rows out of the assist queue. Kept for future stress tests. */
export const clearAssist = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const rows = await ctx.db.query("assistRequests").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

/** Every Meta ad account the system-user token can see: name and id. For audits. */
export const visibleAdAccounts = internalAction({
  args: {},
  returns: v.array(v.object({ name: v.string(), id: v.string() })),
  handler: async () =>
    (await allAdAccounts()).map(a => ({
      name: String(a.name ?? ""),
      id: String(a.account_id ?? ""),
    })),
});

/**
 * What the Meta system user can reach directly (me/adaccounts) versus what the
 * business edges return, and which accounts hold campaigns matching a term.
 */
export const metaReach = internalAction({
  args: { terms: v.array(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { terms }) => {
    const viaBusiness = await allAdAccounts();
    const direct: Any[] = [];
    let url: string | undefined = "me/adaccounts";
    const params: Record<string, string> = {
      fields: "name,account_id,business,account_status",
      limit: "200",
    };
    for (let page = 0; page < 5 && url; page++) {
      const res: Any = await graph(url, params);
      direct.push(...(res?.data ?? []));
      url = res?.paging?.next ? res.paging.next : undefined;
      if (url) {
        for (const k of Object.keys(params)) delete params[k];
      }
    }
    const businessIds = new Set(viaBusiness.map(a => String(a.account_id)));
    const onlyDirect = direct.filter(
      a => !businessIds.has(String(a.account_id)),
    );
    const needles = terms.map(t => t.toLowerCase());
    const hits: Any[] = [];
    const all = [...viaBusiness, ...onlyDirect];
    for (const a of all) {
      try {
        const cps: Any = await graph(`act_${a.account_id}/campaigns`, {
          fields: "name,effective_status",
          limit: "200",
        });
        for (const c of cps?.data ?? []) {
          const n = String(c.name ?? "").toLowerCase();
          const hit = needles.find(
            t =>
              n.includes(t) ||
              String(a.name ?? "")
                .toLowerCase()
                .includes(t),
          );
          if (hit)
            hits.push({
              term: hit,
              account: a.name,
              accountId: a.account_id,
              campaign: c.name,
              status: c.effective_status,
            });
        }
      } catch (e) {
        hits.push({
          account: a.name,
          accountId: a.account_id,
          error: String(e).slice(0, 100),
        });
      }
    }
    return {
      viaBusiness: viaBusiness.length,
      direct: direct.length,
      onlyDirect: onlyDirect.map(a => ({
        name: a.name,
        id: a.account_id,
        business: a.business?.name,
      })),
      hits,
    };
  },
});

/** Try the agency GHL token against one client's location and return the raw answers. */
export const ghlAgencyProbe = internalAction({
  args: { client: v.string() },
  returns: v.any(),
  handler: async (_ctx, { client }) => {
    const rows = await readClientData();
    const row = clientDataFor(rows, client);
    const token = process.env.GHL_AGENCY_TOKEN ?? "";
    if (!row?.ghlLocationId) return { error: "no GHL ID on Client Data", row };
    const out: Any = {
      location: row.ghlLocationId,
      tokenPrefix: token.slice(0, 8),
      tokenLen: token.length,
    };
    const tries: [string, string, string][] = [
      [
        "pipelines",
        `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${row.ghlLocationId}`,
        "2021-07-28",
      ],
      [
        "location",
        `https://services.leadconnectorhq.com/locations/${row.ghlLocationId}`,
        "2021-07-28",
      ],
      [
        "calendars",
        `https://services.leadconnectorhq.com/calendars/?locationId=${row.ghlLocationId}`,
        "2021-04-15",
      ],
      [
        "locations-search",
        "https://services.leadconnectorhq.com/locations/search?limit=3",
        "2021-07-28",
      ],
    ];
    for (const [k, url, version] of tries) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: version,
          Accept: "application/json",
        },
      });
      out[k] = { status: res.status, body: (await res.text()).slice(0, 300) };
    }
    return out;
  },
});

/** Can the agency token mint a location token, and does that token read pipelines? */
export const ghlLocationTokenProbe = internalAction({
  args: { client: v.string() },
  returns: v.any(),
  handler: async (_ctx, { client }) => {
    const row = clientDataFor(await readClientData(), client);
    const token = process.env.GHL_AGENCY_TOKEN ?? "";
    if (!row?.ghlLocationId) return { error: "no GHL ID" };
    const loc = await fetch(
      `https://services.leadconnectorhq.com/locations/${row.ghlLocationId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      },
    ).then(r => r.json());
    const companyId = loc?.location?.companyId;
    const out: Any = { location: row.ghlLocationId, companyId };
    for (const [k, body, ctype] of [
      [
        "form",
        new URLSearchParams({
          companyId: String(companyId),
          locationId: row.ghlLocationId,
        }).toString(),
        "application/x-www-form-urlencoded",
      ],
      [
        "json",
        JSON.stringify({ companyId, locationId: row.ghlLocationId }),
        "application/json",
      ],
    ] as const) {
      const res = await fetch(
        "https://services.leadconnectorhq.com/oauth/locationToken",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Version: "2021-07-28",
            Accept: "application/json",
            "Content-Type": ctype,
          },
          body,
        },
      );
      const text = await res.text();
      out[`mint_${k}`] = { status: res.status, body: text.slice(0, 200) };
      if (res.ok) {
        const lt = JSON.parse(text)?.access_token;
        const p = await fetch(
          `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${row.ghlLocationId}`,
          {
            headers: {
              Authorization: `Bearer ${lt}`,
              Version: "2021-07-28",
              Accept: "application/json",
            },
          },
        );
        out.pipelinesWithLocationToken = {
          status: p.status,
          body: (await p.text()).slice(0, 160),
        };
        break;
      }
    }
    return out;
  },
});

/** What Mahara's own GHL location exposes: calendars with event counts, and a conversation sample. */
export const maharaGhlProbe = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const token = process.env.MAHARA_GHL_TOKEN ?? "";
    const loc = process.env.MAHARA_GHL_LOCATION || "wwG426bwruWWv9W3fazQ";
    const get = async (path: string, version = "2021-04-15") => {
      const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: version,
          Accept: "application/json",
        },
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
    const out: Any = { location: loc, tokenLen: token.length };
    const cals = await get(`/calendars/?locationId=${loc}`);
    out.calendarsStatus = cals.status;
    out.calendars = [];
    const from = Date.now() - 7 * 86400_000;
    const to = Date.now() + 21 * 86400_000;
    for (const c of (cals.json?.calendars ?? []) as Any[]) {
      const ev = await get(
        `/calendars/events?locationId=${loc}&calendarId=${c.id}&startTime=${from}&endTime=${to}`,
      );
      out.calendars.push({
        name: c.name,
        id: c.id,
        status: ev.status,
        events: (ev.json?.events ?? []).length,
        err: ev.json?.message,
      });
    }
    const conv = await get(
      `/conversations/search?locationId=${loc}&limit=20&sortBy=last_message_date&sort=desc`,
    );
    out.conversationsStatus = conv.status;
    out.conversationsTotal = conv.json?.total;
    out.conversationSample = ((conv.json?.conversations ?? []) as Any[])
      .slice(0, 8)
      .map(c => ({
        name: c.fullName ?? c.contactName,
        type: c.lastMessageType ?? c.type,
        dir: c.lastMessageDirection,
        at: c.lastMessageDate,
        unread: c.unreadCount,
      }));
    return out;
  },
});

/** Is the Fathom key live, and what does the last 30 days look like? */
export const fathomProbe = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const key = process.env.FATHOM_API_KEY ?? "";
    const since = new Date(Date.now() - 30 * 86400_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const res = await fetch(
      `https://api.fathom.ai/external/v1/meetings?${new URLSearchParams({ created_after: since, include_summary: "false" })}`,
      { headers: { "X-Api-Key": key } },
    );
    const json: Any = await res.json().catch(() => ({}));
    return {
      keyLen: key.length,
      status: res.status,
      items: (json.items ?? []).length,
      nextCursor: Boolean(json.next_cursor),
      sample: ((json.items ?? []) as Any[]).slice(0, 6).map(m => ({
        title: m.title,
        at: m.scheduled_start_time ?? m.created_at,
        external: (m.calendar_invitees ?? [])
          .filter((i: Any) => i.is_external)
          .map((i: Any) => i.name ?? i.email),
      })),
      error: json.message ?? json.error,
    };
  },
});

/** Cards on the Ads Managment board whose name or tags contain a term. */
export const boardCards = internalAction({
  args: { term: v.string() },
  returns: v.any(),
  handler: async (_ctx, { term }) => {
    const t = term.toLowerCase();
    const out: Any[] = [];
    for (let page = 0; page < 5; page++) {
      const d: Any = unwrap(
        await callTool("pd_clickup_proxy_get", {
          url: `https://api.clickup.com/api/v2/list/901817774521/task?include_closed=true&subtasks=true&page=${page}`,
        }),
      );
      const tasks: Any[] = d?.tasks ?? [];
      for (const k of tasks) {
        const tags = (k.tags ?? []).map((x: Any) => String(x.name));
        if (
          String(k.name).toLowerCase().includes(t) ||
          tags.some((x: string) => x.toLowerCase().includes(t))
        )
          out.push({
            id: k.id,
            name: k.name,
            status: k.status?.status,
            tags,
            updated: k.date_updated,
          });
      }
      if (tasks.length < 100) break;
    }
    return out;
  },
});

/** Calendar names in every client sub-account we hold a token for. */
export const ghlCalendarNames = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const rows = (await readClientData()).filter(
      r => r.ghlToken.startsWith("pit-") && r.ghlLocationId,
    );
    const out: Any[] = [];
    for (const r of rows) {
      try {
        const res = await fetch(
          `https://services.leadconnectorhq.com/calendars/?locationId=${r.ghlLocationId}`,
          {
            headers: {
              Authorization: `Bearer ${r.ghlToken}`,
              Version: "2021-04-15",
              Accept: "application/json",
            },
          },
        );
        const json: Any = await res.json();
        out.push({
          client: r.name,
          status: res.status,
          calendars: (json?.calendars ?? []).map((c: Any) => c.name),
        });
      } catch (e) {
        out.push({ client: r.name, error: String(e).slice(0, 100) });
      }
    }
    return out;
  },
});

/** Read a Google Doc as plain text (service account must have access). */
export const docText = internalAction({
  args: { docId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { docId }) => {
    const { googleAccessToken } = await import("./tools");
    const token = await googleAccessToken();
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${docId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const doc: Any = await res.json();
    if (!res.ok) return { status: res.status, error: doc?.error?.message };
    const lines: string[] = [];
    for (const el of doc.body?.content ?? []) {
      const t = (el.paragraph?.elements ?? [])
        .map((e: Any) => e.textRun?.content ?? "")
        .join("")
        .trim();
      if (t) lines.push(t);
    }
    return {
      title: doc.title,
      chars: lines.join("\n").length,
      head: lines.slice(0, 40),
    };
  },
});
