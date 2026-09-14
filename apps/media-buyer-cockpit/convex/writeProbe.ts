import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { duplicateAdSetCore, setDailyBudget } from "./edit";
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

// --- Every button, for real, in Mahara's own account -----------------------------

export const makeTestDraft = internalMutation({
  args: { accountId: v.string() },
  returns: v.id("campaignDrafts"),
  handler: async (ctx, { accountId }) =>
    await ctx.db.insert("campaignDrafts", {
      clientTag: "rehearsal",
      clientName: "REHEARSAL delete me",
      accountId,
      kind: "campaign",
      brief:
        "Button rehearsal. Everything created here is deleted in the same run.",
      creativeLinks: [],
      dailyBudget: 20,
      language: "en",
      variants: [],
      status: "ready",
      at: Date.now(),
      by: "rehearsal",
    } as Any),
});

export const readDraft = internalQuery({
  args: { id: v.id("campaignDrafts") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const dropDraft = internalMutation({
  args: { id: v.id("campaignDrafts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return null;
  },
});

/**
 * Launch through the real builder, then run every edit the cockpit offers
 * against what it made (budget, duplicate ad set, new ad from an existing
 * one, pause), then delete all of it. Aziz, 2026-09-11: "try to actually
 * edit a campaign and launch a new campaign and see what happens".
 */
export const buttonsRehearsal = internalAction({
  args: { accountId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { accountId }) => {
    const acc = (accountId ?? "746108264865897").replace(/^act_/, "");
    const act = `act_${acc}`;
    const steps: Any[] = [];
    const made: string[] = [];
    const ok = (step: string, extra: Any = {}) =>
      steps.push({ step, ok: true, ...extra });
    const fail = (step: string, e: unknown) =>
      steps.push({ step, ok: false, error: String(e).slice(0, 260) });
    const draftId = await ctx.runMutation(internal.writeProbe.makeTestDraft, {
      accountId: acc,
    });
    let campaignId: string | undefined;
    let adSetId: string | undefined;
    try {
      // 1. Launch: the real code path behind "Launch".
      await ctx.runAction(internal.builder.launchDraft, { id: draftId });
      const draft: Any = await ctx.runQuery(internal.writeProbe.readDraft, {
        id: draftId,
      });
      campaignId = draft?.metaCampaignId;
      adSetId = draft?.metaAdSetId;
      if (draft?.status === "launched" && campaignId && adSetId) {
        ok("Launch (builder.launchDraft)", { campaignId, adSetId });
        made.push(adSetId, campaignId);
      } else
        throw new Error(
          `draft status ${draft?.status}: ${draft?.error ?? "no ids"}`,
        );

      // 2. Budget change: the same helper the budget button calls.
      try {
        const where = await setDailyBudget(adSetId, 25);
        ok(
          `Set budget, budget on the ad set ($20 → $25, wrote to the ${where.level})`,
        );
      } catch (e) {
        fail("Set budget, budget on the ad set", e);
      }
      // 3. Scale: the "Scale the winner" call (+25%, ad-set level).
      try {
        await graphPost(adSetId, { daily_budget: 3100 });
        ok("Scale the winner (+25%)");
      } catch (e) {
        fail("Scale the winner", e);
      }
      // 4. Duplicate ad set: the same helper the duplicate button calls.
      try {
        const copy = await duplicateAdSetCore({
          adsetId: adSetId,
          newName: "REHEARSAL copy",
        });
        made.unshift(copy.id);
        ok("Duplicate ad set, budget on the ad set", { id: copy.id });

        // 4b. The same two buttons on a campaign that holds its own budget,
        // which is how client campaigns are built and what failed for Nada on
        // 2026-09-14 ("You can only set an ad set budget or a campaign budget").
        const src: Any = await graph(adSetId, {
          fields:
            "billing_event,optimization_goal,promoted_object,destination_type,targeting",
        });
        const cbo: Any = await graphPost(`${act}/campaigns`, {
          name: `REHEARSAL campaign budget ${new Date().toISOString().slice(0, 16)}`,
          objective: "OUTCOME_LEADS",
          status: "PAUSED",
          special_ad_categories: "[]",
          daily_budget: 2000,
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        });
        made.push(String(cbo.id));
        const cboSetPayload: Record<string, string | number> = {
          name: "REHEARSAL campaign-budget ad set",
          campaign_id: String(cbo.id),
          billing_event: src.billing_event,
          optimization_goal: src.optimization_goal,
          targeting: JSON.stringify(src.targeting),
          status: "PAUSED",
        };
        if (src.promoted_object)
          cboSetPayload.promoted_object = JSON.stringify(src.promoted_object);
        if (src.destination_type)
          cboSetPayload.destination_type = src.destination_type;
        const cboSet: Any = await graphPost(`${act}/adsets`, cboSetPayload);
        made.unshift(String(cboSet.id));
        try {
          const where = await setDailyBudget(String(cboSet.id), 25);
          const back: Any = await graph(String(cbo.id), {
            fields: "daily_budget",
          });
          if (
            where.level !== "campaign" ||
            String(back.daily_budget) !== "2500"
          )
            throw new Error(
              `wrote to the ${where.level}; campaign budget reads ${back.daily_budget}`,
            );
          ok(
            "Set budget, budget on the campaign ($20 → $25, read back from Meta)",
          );
        } catch (e) {
          fail("Set budget, budget on the campaign", e);
        }
        try {
          const copy2 = await duplicateAdSetCore({
            adsetId: String(cboSet.id),
            newName: "REHEARSAL campaign-budget copy",
          });
          made.unshift(copy2.id);
          ok("Duplicate ad set, budget on the campaign", { id: copy2.id });
        } catch (e) {
          fail("Duplicate ad set, budget on the campaign", e);
        }
      } catch (e) {
        fail("Duplicate ad set", e);
      }
      // 5. An ad: creative + ad, then a second ad from it (newAdsFromExisting).
      let sourceAdId: string | undefined;
      try {
        const pages: Any = await graph(`${act}/promote_pages`, {
          fields: "id",
          limit: "1",
        });
        const pageId = pages?.data?.[0]?.id;
        if (!pageId) throw new Error("no page on the account");
        const creative: Any = await graphPost(`${act}/adcreatives`, {
          name: "REHEARSAL creative",
          object_story_spec: JSON.stringify({
            page_id: String(pageId),
            link_data: {
              link: "https://maharamedia.com",
              message: "Rehearsal, never delivered.",
              name: "Rehearsal",
            },
          }),
        });
        const ad: Any = await graphPost(`${act}/ads`, {
          name: "REHEARSAL ad",
          adset_id: adSetId,
          creative: JSON.stringify({ creative_id: creative.id }),
          status: "PAUSED",
        });
        sourceAdId = String(ad.id);
        made.unshift(sourceAdId);
        ok("Create an ad (creative + ad)", { id: sourceAdId });
      } catch (e) {
        fail("Create an ad (creative + ad)", e);
      }
      if (sourceAdId) {
        try {
          const src: Any = await graph(sourceAdId, {
            fields: "name,adset_id,account_id,creative{object_story_spec}",
          });
          const spec = src.creative?.object_story_spec;
          const creative: Any = await graphPost(
            `act_${src.account_id}/adcreatives`,
            {
              name: "REHEARSAL copy creative",
              object_story_spec: JSON.stringify({
                ...spec,
                link_data: { ...spec.link_data, message: "Rehearsal copy" },
              }),
            },
          );
          const ad: Any = await graphPost(`act_${src.account_id}/ads`, {
            name: "REHEARSAL copy ad",
            adset_id: src.adset_id,
            creative: JSON.stringify({ creative_id: creative.id }),
            status: "PAUSED",
          });
          made.unshift(String(ad.id));
          ok("New ad from an existing ad (newAdsFromExisting)", { id: ad.id });
          // Cut the worst ad = pause one ad.
          await graphPost(String(ad.id), { status: "PAUSED" });
          ok("Cut the worst ad (pause an ad)");
        } catch (e) {
          fail("New ad from an existing ad", e);
        }
      }
      // 6. Turn it off.
      try {
        await graphPost(campaignId, { status: "PAUSED" });
        ok("Turn it off (pause campaign)");
      } catch (e) {
        fail("Turn it off", e);
      }
    } catch (e) {
      fail("Launch (builder.launchDraft)", e);
    } finally {
      const token = process.env.META_SYSTEM_TOKEN;
      for (const id of made) {
        try {
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
          fail(`delete ${id}`, e);
        }
      }
      await ctx.runMutation(internal.writeProbe.dropDraft, { id: draftId });
    }
    return { account: act, steps };
  },
});
