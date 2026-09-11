import { v } from "convex/values";

// biome-ignore lint/suspicious/noExplicitAny: issue rows
type Any = any;

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { callTool, graph, unwrap } from "./tools";

/**
 * Tracking audit.
 *
 * Runs straight against Meta with the system-user token, so it works even while
 * the Spaces tool endpoint is down.
 *
 * The point is not tidiness. A lead that arrives with no UTM cannot be tied
 * back to the ad that produced it, which means the cost per lead we optimise
 * against is partly fiction. Same for a lead form that is missing entirely.
 */

export const store = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ found: v.number() }),
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("trackingIssues").collect()) {
      await ctx.db.delete(old._id);
    }
    for (const r of rows) {
      await ctx.db.insert("trackingIssues", { ...r, foundAt: Date.now() });
    }
    return { found: rows.length };
  },
});

/** Distinct client ad accounts we hold, from the winning-data database. */
export const accounts = internalQuery({
  args: {},
  returns: v.array(v.object({ accountId: v.string(), client: v.string() })),
  handler: async ctx => {
    const plays = await ctx.db.query("marketPlays").collect();
    const seen = new Map<string, string>();
    for (const p of plays) {
      if (!seen.has(p.accountId)) seen.set(p.accountId, p.client);
    }
    return [...seen].map(([accountId, client]) => ({ accountId, client }));
  },
});

export const audit = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), issues: v.number() }),
  handler: async (ctx): Promise<{ checked: number; issues: number }> => {
    const accounts: { accountId: string; client: string }[] =
      await ctx.runQuery(internal.tracking.accounts, {});

    const rows: Record<string, unknown>[] = [];
    let checked = 0;

    for (const acc of accounts) {
      let ads: { data?: Record<string, any>[] };
      try {
        ads = await graph(`act_${acc.accountId}/ads`, {
          fields:
            "name,creative{url_tags,object_story_spec},adset{destination_type,optimization_goal}",
          effective_status: '["ACTIVE"]',
          limit: 200,
        });
      } catch {
        // An unreadable account is an access problem, not a tracking fault —
        // don't report it as one.
        continue;
      }

      for (const ad of ads.data ?? []) {
        checked++;
        const creative = ad.creative ?? {};
        const spec = creative.object_story_spec;
        const adset = ad.adset ?? {};

        // URL parameters. Verified at creative level: when url_tags is absent
        // there is no other field carrying them, so this is a real gap and it
        // is the "Add URL parameters" step of our own buildout checklist.
        if (!creative.url_tags) {
          rows.push({
            client: acc.client,
            accountId: acc.accountId,
            adId: ad.id,
            adName: ad.name ?? "",
            issue: "No URL parameters",
            detail:
              "The buildout checklist requires the UTM string on every ad. Without it this ad cannot be told apart from the others in reporting.",
          });
        }

        // Lead form. Only judge this when the ad set actually delivers a lead
        // form on the ad AND the creative is readable. Dynamic creatives do not
        // expose object_story_spec, and a website ad is not supposed to have a
        // form — flagging either would be a false alarm, and 296 of 296 earlier
        // flags were exactly that.
        const readable = Boolean(spec);
        const wantsLeadForm = adset.destination_type === "ON_AD";
        if (readable && wantsLeadForm) {
          const data = spec.video_data ?? spec.link_data ?? {};
          const leadForm = data.call_to_action?.value?.lead_gen_form_id;
          if (!leadForm) {
            rows.push({
              client: acc.client,
              accountId: acc.accountId,
              adId: ad.id,
              adName: ad.name ?? "",
              issue: "No lead form attached",
              detail: "This ad set delivers a lead form, but this ad has none.",
            });
          }
        }
      }
    }

    const out = await ctx.runMutation(internal.tracking.store, { rows });
    // Aziz, 2026-09-11: "can you just backlog it?" One ClickUp task a week on
    // the Marketing / ADs list carries the per-client list; the cockpit only
    // shows a quiet count.
    try {
      await ctx.runAction(internal.tracking.backlogTask, {});
    } catch (e) {
      console.warn(`tracking backlog task: ${String(e).slice(0, 120)}`);
    }
    return { checked, issues: out.found };
  },
});

/** What she sees: tracking faults, worst clients first. */
export const issues = authenticatedQuery({
  args: {},
  returns: v.array(
    v.object({
      client: v.string(),
      count: v.number(),
      ads: v.array(v.object({ adName: v.string(), issue: v.string() })),
    }),
  ),
  handler: async ctx => {
    const all = await ctx.db.query("trackingIssues").collect();
    const byClient = new Map<string, { adName: string; issue: string }[]>();
    for (const r of all) {
      const list = byClient.get(r.client) ?? [];
      list.push({ adName: r.adName, issue: r.issue });
      byClient.set(r.client, list);
    }
    return [...byClient]
      .map(([client, ads]) => ({ client, count: ads.length, ads }))
      .sort((a, b) => b.count - a.count);
  },
});

/** Week key like 2026-W37, Kuwait time. */
function weekKey(): string {
  const d = new Date(Date.now() + 3 * 3600_000);
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(
    ((d.getTime() - jan1) / 86400_000 + new Date(jan1).getUTCDay() + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const backlogTask = internalAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const signature = `tracking-backlog:${weekKey()}`;
    const last = await ctx.runQuery(internal.smoke.alerted, { signature });
    if (last) return { skipped: "already filed this week" };
    const rows: Any[] = await ctx.runQuery(
      internal.tracking.issuesInternal,
      {},
    );
    const total = rows.reduce((n: number, r: Any) => n + r.count, 0);
    if (!total) return { skipped: "nothing to file" };
    const lines = rows.map(
      (r: Any) =>
        `• ${r.client}: ${r.count} (${[...new Set(r.ads.map((a: Any) => a.issue))].join(", ")})`,
    );
    const created: Any = unwrap(
      await callTool("pd_clickup_proxy_post", {
        url: "https://api.clickup.com/api/v2/list/901816723196/task",
        json_body: {
          name: `Tracking backlog · ${total} ads across ${rows.length} clients without UTM strings or a lead form (${weekKey()})`,
          description: [
            "Standing hygiene backlog from the Media Buyer Cockpit, refreshed weekly. The buildout checklist requires the UTM string on every ad and a lead form on every ON_AD ad set.",
            "",
            ...lines,
          ].join("\n"),
          priority: 4,
        },
      }),
    );
    await ctx.runMutation(internal.smoke.remember, {
      signature,
      text: String(created?.url ?? ""),
    });
    return { filed: created?.url, total };
  },
});

export const issuesInternal = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    const rows = await ctx.db.query("trackingIssues").collect();
    const byClient = new Map<string, Any[]>();
    for (const r of rows) {
      const list = byClient.get(r.client) ?? [];
      list.push({ adName: r.adName, issue: r.issue });
      byClient.set(r.client, list);
    }
    return [...byClient.entries()]
      .map(([client, ads]) => ({ client, count: ads.length, ads }))
      .sort((a, b) => b.count - a.count);
  },
});
