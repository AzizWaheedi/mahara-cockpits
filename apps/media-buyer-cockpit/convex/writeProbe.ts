import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { allAdAccounts, callTool, graph, graphPost, unwrap } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: Meta payloads
type Any = any;
declare const process: { env: Record<string, string | undefined> };

/**
 * Can the cockpit actually WRITE to each ad account?
 *
 * Reading works through the business edges even where writing does not: an
 * account the system user is not assigned to (or is assigned to as an
 * analyst) reads fine and fails the moment a button tries to pause, scale or
 * create. Meta's `execution_options=validate_only` runs the create-campaign
 * request through every permission and validation check and writes nothing,
 * so this is the honest test. Aziz, 2026-09-11: "make sure it actually works".
 */
export const accounts = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const all = await allAdAccounts();
    const out: Any[] = [];
    for (const a of all) {
      const id = String(a.account_id);
      const row: Any = { name: a.name, id };
      try {
        const info: Any = await graph(`act_${id}`, {
          fields:
            "account_status,disable_reason,currency,spend_cap,amount_spent",
        });
        row.status = info.account_status;
        row.currency = info.currency;
        if (info.disable_reason) row.disableReason = info.disable_reason;
      } catch (e) {
        row.read = `FAILED ${String(e).slice(0, 120)}`;
      }
      try {
        // validate_only: full permission + validation pass, nothing created.
        await graphPost(`act_${id}/campaigns`, {
          name: "cockpit write probe (never created)",
          objective: "OUTCOME_LEADS",
          status: "PAUSED",
          special_ad_categories: "[]",
          is_adset_budget_sharing_enabled: "false",
          execution_options: '["validate_only"]',
        });
        row.write = "ok";
        // The rest of a launch, validated against a real campaign in the
        // account: the ad set exactly as builder.launchDraft sends it, and a
        // status update the way "Turn it off" does.
        try {
          const cps: Any = await graph(`act_${id}/campaigns`, {
            fields: "id,name,status,objective",
            limit: "5",
          });
          const camp =
            (cps?.data ?? []).find(
              (c: Any) => c.objective === "OUTCOME_LEADS",
            ) ?? (cps?.data ?? [])[0];
          if (camp) {
            row.campaignUsed = camp.name;
            try {
              await graphPost(`act_${id}/adsets`, {
                campaign_id: String(camp.id),
                name: "cockpit write probe ad set (never created)",
                status: "PAUSED",
                daily_budget: "2000",
                targeting: JSON.stringify({
                  geo_locations: { countries: ["KW"] },
                }),
                optimization_goal: "LEAD_GENERATION",
                billing_event: "IMPRESSIONS",
                execution_options: '["validate_only"]',
              });
              row.adSet = "ok";
            } catch (e) {
              row.adSet = `FAILED ${String(e).slice(0, 220)}`;
            }
            try {
              await graphPost(String(camp.id), {
                status: String(camp.status ?? "PAUSED"),
                execution_options: '["validate_only"]',
              });
              row.update = "ok";
            } catch (e) {
              row.update = `FAILED ${String(e).slice(0, 160)}`;
            }
          } else row.adSet = "no campaign in the account to validate against";
        } catch (e) {
          row.adSet = `FAILED ${String(e).slice(0, 160)}`;
        }
      } catch (e) {
        const msg = String(e);
        row.write =
          /permission|\(#200\)|\(#10\)|not authorized|does not have/i.test(msg)
            ? `NO PERMISSION ${msg.slice(0, 160)}`
            : `FAILED ${msg.slice(0, 160)}`;
      }
      out.push(row);
    }
    const bad = out.filter(
      r =>
        r.write !== "ok" ||
        r.read ||
        (r.adSet && r.adSet !== "ok" && !/no campaign/.test(r.adSet)) ||
        (r.update && r.update !== "ok"),
    );
    console.log(
      `write probe: ${out.length} accounts, ${bad.length} cannot be written: ${bad
        .map(r => `${r.name} (${r.write ?? r.read})`)
        .join(" | ")
        .slice(0, 800)}`,
    );
    return {
      total: out.length,
      writable: out.length - bad.length,
      bad,
      all: out,
    };
  },
});

/**
 * A real launch rehearsal in Mahara's own ad account: campaign + ad set
 * created PAUSED exactly the way builder.launchDraft creates them, then
 * deleted. This is the only honest end-to-end test of "launch from the
 * cockpit"; validate_only cannot chain the two steps.
 */
export const launchRehearsal = internalAction({
  args: { accountId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { accountId }) => {
    const act = `act_${(accountId ?? "746108264865897").replace(/^act_/, "")}`;
    const steps: Any[] = [];
    let campaignId: string | undefined;
    let adSetId: string | undefined;
    try {
      const campaign: Any = await callTool("mcp_meta_ads_create_campaign", {
        ad_account_id: act,
        name: `REHEARSAL |MAHARA| delete me ${new Date().toISOString().slice(0, 16)}`,
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: [],
      });
      campaignId = unwrap(campaign)?.id;
      steps.push({
        step: "create campaign",
        ok: Boolean(campaignId),
        id: campaignId,
      });
      if (!campaignId) throw new Error("no campaign id returned");
      try {
        const pages: Any = await graph(`${act}/promote_pages`, {
          fields: "id,name",
          limit: "5",
        });
        const page = (pages?.data ?? [])[0];
        steps.push({
          step: "find a page to promote",
          ok: Boolean(page),
          id: page?.id,
          error: page ? undefined : "no page connected to this account",
        });
        const adSet: Any = await callTool("mcp_meta_ads_create_ad_set", {
          ad_account_id: act,
          campaign_id: campaignId,
          name: "REHEARSAL — new build",
          status: "PAUSED",
          daily_budget: "2000",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          targeting: { geo_locations: { countries: ["KW"] } },
          optimization_goal: "LEAD_GENERATION",
          billing_event: "IMPRESSIONS",
          ...(page ? { promoted_object: { page_id: String(page.id) } } : {}),
        });
        adSetId = unwrap(adSet)?.id;
        steps.push({
          step: "create ad set (builder's shape, no promoted_object)",
          ok: Boolean(adSetId),
          id: adSetId,
        });
      } catch (e) {
        steps.push({
          step: "create ad set (builder's shape, no promoted_object)",
          ok: false,
          error: String(e).slice(0, 300),
        });
      }
      try {
        await graphPost(campaignId, { status: "PAUSED" });
        steps.push({
          step: "update campaign status (Turn it off path)",
          ok: true,
        });
      } catch (e) {
        steps.push({
          step: "update campaign status",
          ok: false,
          error: String(e).slice(0, 200),
        });
      }
    } catch (e) {
      steps.push({
        step: "create campaign",
        ok: false,
        error: String(e).slice(0, 300),
      });
    } finally {
      for (const id of [adSetId, campaignId].filter(Boolean) as string[]) {
        try {
          const token = process.env.META_SYSTEM_TOKEN;
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${id}?access_token=${token}`,
            { method: "DELETE" },
          );
          const json: Any = await res.json();
          steps.push({
            step: `delete ${id}`,
            ok: Boolean(json?.success),
            error: json?.error?.message,
          });
        } catch (e) {
          steps.push({
            step: `delete ${id}`,
            ok: false,
            error: String(e).slice(0, 160),
          });
        }
      }
    }
    return { account: act, steps };
  },
});
