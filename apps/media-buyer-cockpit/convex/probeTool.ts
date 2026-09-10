import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { clientDataFor, readClientData } from "./clientData";
import { allAdAccounts, graph } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: Meta payloads
type Any = any;

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
