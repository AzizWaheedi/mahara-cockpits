import { v } from "convex/values";
import { importPKCS8 } from "jose";
import { internalAction, internalMutation } from "./_generated/server";
import { clientDataFor, readClientData } from "./clientData";
import { pkcs8Pem } from "./portal";
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

/** One Client Data row by client name, to see what the sheet holds for them. */
export const clientDataRow = internalAction({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (_ctx, { name }) => {
    const rows = await readClientData();
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return rows.filter(r =>
      String(r.name ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .includes(key),
    );
  },
});

/** Shape of the auth signing key as this deployment sees it (header only, never the key). */
export const jwtKeyShape = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const raw = process.env.JWT_PRIVATE_KEY ?? "";
    const shape = (k: string) => ({
      len: k.length,
      head: k.slice(0, 27),
      newline: k.includes("\n"),
      escapedNewline: k.includes("\\n"),
      spaces: k.includes(" "),
    });
    let decoded = "";
    try {
      decoded = atob(raw);
    } catch {
      decoded = "(not base64)";
    }
    return { raw: shape(raw), atob: shape(decoded) };
  },
});

export const pemProbe = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const pem = pkcs8Pem(process.env.JWT_PRIVATE_KEY);
    const out: Any = {
      len: pem.length,
      head: pem.slice(0, 40),
      tail: pem.slice(-40),
      codes: [...pem.slice(0, 32)].map(c => c.charCodeAt(0)),
      lines: pem.split("\n").length,
    };
    try {
      await importPKCS8(pem, "RS256");
      out.imported = true;
    } catch (e) {
      out.imported = String(e);
    }
    return out;
  },
});

/** Tracker sheet rows (data_fb) mentioning a name, to see whether the sync can even see a client. */
export const trackerRows = internalAction({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (_ctx, { name }) => {
    const rows: string[][] = await callTool("pd_google_sheets_proxy_get", {
      url: `https://sheets.googleapis.com/v4/spreadsheets/1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro/values/${encodeURIComponent("'data_fb'!A3:Y11005")}`,
    }).then((r: Any) => r?.values ?? []);
    const key = name.toLowerCase();
    const hits = rows.filter(r => r.join(" ").toLowerCase().includes(key));
    return {
      total: rows.length,
      hits: hits.length,
      sample: hits.slice(0, 5),
      newest: hits.slice(-3),
      accounts: [...new Set(hits.map(r => r[1]))].slice(0, 10),
    };
  },
});

/** Which Slack identity the cockpit posts as, and whether it can see a channel (no token returned). */
export const slackWhoAmI = internalAction({
  args: { channel: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { channel }) => {
    const token = process.env.SLACK_BOT_TOKEN ?? "";
    const call = async (method: string, params: Record<string, string>) => {
      const res = await fetch(
        `https://slack.com/api/${method}?${new URLSearchParams(params)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      return (await res.json()) as Any;
    };
    const me = await call("auth.test", {});
    const out: Any = {
      ok: me.ok,
      error: me.error,
      team: me.team,
      user: me.user,
      userId: me.user_id,
      botId: me.bot_id,
    };
    if (me.bot_id) {
      const bot = await call("bots.info", { bot: me.bot_id });
      out.appName = bot?.bot?.name;
    }
    if (channel) {
      const info = await call("conversations.info", { channel });
      out.channel = {
        ok: info.ok,
        error: info.error,
        name: info.channel?.name,
        isPrivate: info.channel?.is_private,
        isMember: info.channel?.is_member,
      };
    }
    return out;
  },
});

/** The last rows of a sheet tab, to confirm a write landed. */
export const sheetTail = internalAction({
  args: { sheetId: v.string(), tab: v.string(), rows: v.optional(v.number()) },
  returns: v.any(),
  handler: async (_ctx, { sheetId, tab, rows }) => {
    const res: Any = await callTool("pd_google_sheets_proxy_get", {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${tab}'!A:D`)}`,
    });
    const values: string[][] = res?.values ?? [];
    return { total: values.length, last: values.slice(-(rows ?? 3)) };
  },
});

/** The Ads Management list's custom fields: ids and dropdown options (no values from tasks). */
export const adsListFields = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const r: Any = await callTool("pd_clickup_proxy_get", {
      url: "https://api.clickup.com/api/v2/list/901817774521/field",
    });
    const fields: Any[] = unwrap(r)?.fields ?? r?.fields ?? [];
    return fields
      .filter(f => /status|client/i.test(f.name))
      .map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        options: (f.type_config?.options ?? []).map((o: Any) => ({
          id: o.id,
          name: o.name,
          orderindex: o.orderindex,
        })),
      }));
  },
});

/** A list's custom fields by name pattern, and how many tasks have a value in each (no values returned). */
export const listFieldUsage = internalAction({
  args: { listId: v.string(), pattern: v.string() },
  returns: v.any(),
  handler: async (_ctx, { listId, pattern }) => {
    const re = new RegExp(pattern, "i");
    const fr: Any = await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/list/${listId}/field`,
    });
    const fields: Any[] = (unwrap(fr)?.fields ?? fr?.fields ?? []).filter(
      (f: Any) => re.test(f.name),
    );
    const counts: Record<string, number> = {};
    let tasks = 0;
    for (let page = 0; page < 10; page++) {
      const tr: Any = await callTool("pd_clickup_proxy_get", {
        url: `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&page=${page}`,
      });
      const list: Any[] = unwrap(tr)?.tasks ?? tr?.tasks ?? [];
      tasks += list.length;
      for (const t of list)
        for (const cf of t.custom_fields ?? [])
          if (
            re.test(cf.name) &&
            cf.value !== undefined &&
            cf.value !== null &&
            String(cf.value).trim() !== ""
          )
            counts[cf.name] = (counts[cf.name] ?? 0) + 1;
      if (list.length < 100) break;
    }
    return {
      tasks,
      fields: fields.map(f => ({ id: f.id, name: f.name, type: f.type })),
      withValue: counts,
    };
  },
});

/** Read-only: which cards hold a value in one custom field, and where the field is defined (folder, space or workspace). */
export const fieldValues = internalAction({
  args: { listId: v.string(), fieldId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { listId, fieldId }) => {
    const get = async (url: string): Promise<Any> => {
      const r: Any = await callTool("pd_clickup_proxy_get", {
        url: `https://api.clickup.com/api/v2/${url}`,
      });
      return unwrap(r) ?? r;
    };
    const list = await get(`list/${listId}`);
    const where: Record<string, boolean> = {};
    const has = (fields: Any) =>
      (fields?.fields ?? []).some((f: Any) => f.id === fieldId);
    if (list?.folder?.id)
      where[`folder ${list.folder.name} (${list.folder.id})`] = has(
        await get(`folder/${list.folder.id}/field`),
      );
    if (list?.space?.id)
      where[`space ${list.space.id}`] = has(
        await get(`space/${list.space.id}/field`),
      );
    const cards: Any[] = [];
    for (let page = 0; page < 10; page++) {
      const tr = await get(
        `list/${listId}/task?include_closed=true&page=${page}`,
      );
      const tasks: Any[] = tr?.tasks ?? [];
      for (const t of tasks) {
        const cf = (t.custom_fields ?? []).find((f: Any) => f.id === fieldId);
        if (
          cf?.value !== undefined &&
          cf?.value !== null &&
          String(cf.value).trim() !== ""
        )
          cards.push({
            id: t.id,
            name: t.name,
            status: t.status?.status,
            tags: (t.tags ?? []).map((x: Any) => x.name),
            value: cf.value,
          });
      }
      if (tasks.length < 100) break;
    }
    return {
      list: list?.name,
      folder: list?.folder?.name,
      space: list?.space?.id,
      definedAt: where,
      cards,
    };
  },
});

/** Live Meta read for campaigns: effective status, and spend today and yesterday in the account's own timezone. */
export const metaSpendNow = internalAction({
  args: { campaignIds: v.array(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { campaignIds }) => {
    const out: Any[] = [];
    for (const id of campaignIds) {
      const c: Any = await graph(id, {
        fields: "name,status,effective_status,daily_budget,account_id",
      });
      const day = async (preset: string) => {
        const r: Any = await graph(`${id}/insights`, {
          fields: "spend,date_start",
          date_preset: preset,
        });
        return r?.data?.[0]
          ? `${r.data[0].spend} on ${r.data[0].date_start}`
          : "0";
      };
      const adsets: Any = await graph(`${id}/adsets`, {
        fields: "name,effective_status",
        limit: "50",
      });
      out.push({
        name: c?.name,
        status: c?.status,
        effective: c?.effective_status,
        today: await day("today"),
        yesterday: await day("yesterday"),
        adsets: (adsets?.data ?? []).map(
          (a: Any) => `${a.name}: ${a.effective_status}`,
        ),
      });
    }
    return out;
  },
});

/** Read-only: the latest comments on some client tasks, trimmed, to see what gets posted there. */
export const taskComments = internalAction({
  args: { taskIds: v.array(v.string()), chars: v.optional(v.number()) },
  returns: v.any(),
  handler: async (_ctx, { taskIds, chars }) => {
    const out: Any[] = [];
    for (const id of taskIds) {
      const r: Any = await callTool("pd_clickup_proxy_get", {
        url: `https://api.clickup.com/api/v2/task/${id}/comment`,
      });
      const list: Any[] = (unwrap(r) ?? r)?.comments ?? [];
      out.push({
        task: id,
        count: list.length,
        comments: list.slice(0, 6).map((c: Any) => ({
          id: c.id,
          by: c.user?.username ?? c.user?.email,
          at: new Date(Number(c.date)).toISOString().slice(0, 16),
          len: String(c.comment_text ?? "").length,
          replies: c.reply_count,
          text: String(c.comment_text ?? "")
            .replace(/\s+/g, " ")
            .slice(0, chars ?? 160),
        })),
      });
    }
    return out;
  },
});

/** Read-only: lines of one task comment that match a pattern (to check a digest against its source without reading the whole comment). */
export const commentLines = internalAction({
  args: { taskId: v.string(), commentId: v.string(), pattern: v.string() },
  returns: v.any(),
  handler: async (_ctx, { taskId, commentId, pattern }) => {
    const r: Any = await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/task/${taskId}/comment`,
    });
    const c = ((unwrap(r) ?? r)?.comments ?? []).find(
      (x: Any) => String(x.id) === commentId,
    );
    if (!c) return "comment not found";
    const re = new RegExp(pattern, "i");
    return String(c.comment_text ?? "")
      .split(/\n+/)
      .filter(l => re.test(l))
      .map(l =>
        l
          .replace(/\+?\d[\d\s-]{7,}\d/g, "[number]")
          .replace(/\S+@\S+/g, "[email]")
          .slice(0, 300),
      );
  },
});

/** Read-only: a labels/dropdown field's options and each card's current value, by option name. */
export const fieldOptions = internalAction({
  args: { listId: v.string(), fieldId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { listId, fieldId }) => {
    const fr: Any = await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/list/${listId}/field`,
    });
    const field = ((unwrap(fr) ?? fr)?.fields ?? []).find(
      (f: Any) => f.id === fieldId,
    );
    const options: Any[] = field?.type_config?.options ?? [];
    const name = (id: unknown) =>
      options.find(o => o.id === id)?.label ??
      options.find(o => o.id === id)?.name ??
      String(id);
    const cards: Any[] = [];
    const tr: Any = await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true`,
    });
    for (const t of (unwrap(tr) ?? tr)?.tasks ?? []) {
      const cf = (t.custom_fields ?? []).find((f: Any) => f.id === fieldId);
      if (Array.isArray(cf?.value) && cf.value.length)
        cards.push({ card: t.name, cities: cf.value.map(name) });
    }
    return {
      type: field?.type,
      options: options.map(o => ({
        id: o.id,
        label: o.label ?? o.name,
        color: o.color,
      })),
      cards,
    };
  },
});

/** Write test for a labels field: set a card to the ids it already has, read it back. Changes nothing. */
export const labelsRewriteProbe = internalAction({
  args: { listId: v.string(), fieldId: v.string(), cardName: v.string() },
  returns: v.any(),
  handler: async (_ctx, { listId, fieldId, cardName }) => {
    const tr: Any = await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true`,
    });
    const t = ((unwrap(tr) ?? tr)?.tasks ?? []).find(
      (x: Any) => x.name === cardName,
    );
    if (!t) return "card not found";
    const before =
      (t.custom_fields ?? []).find((f: Any) => f.id === fieldId)?.value ?? [];
    if (!Array.isArray(before) || !before.length)
      return "card has no value; nothing to rewrite";
    await callTool("pd_clickup_proxy_post", {
      url: `https://api.clickup.com/api/v2/task/${t.id}/field/${fieldId}`,
      json_body: { value: before },
    });
    const rr: Any = await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/task/${t.id}`,
    });
    const after =
      ((unwrap(rr) ?? rr)?.custom_fields ?? []).find(
        (f: Any) => f.id === fieldId,
      )?.value ?? [];
    return {
      taskId: t.id,
      before,
      after,
      same:
        JSON.stringify([...before].sort()) ===
        JSON.stringify([...after].sort()),
    };
  },
});
