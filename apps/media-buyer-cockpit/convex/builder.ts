import { v } from "convex/values";

// biome-ignore lint/suspicious/noExplicitAny: Meta payloads
type Any = any;

declare const process: { env: Record<string, string | undefined> };

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { allAdAccounts, callTool, graph, unwrap } from "./tools";

/**
 * Building a campaign for her.
 *
 * The rule that makes this accurate: we never assemble a campaign from Meta's
 * defaults. We copy the settings off the account's own best-performing ad set —
 * targeting, placements, pixel, lead form, optimisation goal — and change only
 * the creative and the copy. A campaign built from scratch spends its first week
 * relearning what the account already knew.
 */

/** Accounts our Meta token can actually write to. Everything else needs partner access. */
export const WRITABLE_ACCOUNTS: Record<string, string> = {
  "854779610674376": "AEA Designs",
  "1910040802988539": "AIVE Designs",
  "1034584029438250": "ARCWANI",
  "290802986": "Ahmed Salama USD (Atlantis)",
  "672175680458249": "Architecture Harmony",
  "3658852461068269": "Arcturus World",
  "750052678056652": "Art Vision",
  "971153818910775": "Bayt Al imarah",
  "1557828282750961": "Castello industries",
  "912269544891805": "City Wood",
  "1041319501689281": "Evan Home",
  "2657701377920261": "Grandiocity Projects",
  "1212579773720236": "Harmony architect",
  "26640544315554478": "JG Designs",
  "955658453671990": "Joe And Sera Interiors",
  "2441363879610593": "Kesan Engineering",
  "2378944772609634": "Life depth construction",
  "1938709086836136": "Liwan Construction",
  "1009665871644699": "Mahara - Ideal Elite",
  "37532169989703452": "Mahara Mass Design",
  "1790433979003370": "MofaGE Mahara",
  "1298343058123107": "Mofage",
  "1962841671042195": "NGCC KW",
  "1923309945035375": "Olivar Design",
  "1348995560617825": "Overview Construction",
  "4213612038920415": "Phoenix",
  "2356955368166341": "Phoenix Building",
  "134992869555229": "Pidco Group for Construction",
  "985366551096162": "RM Designs",
  "774492648699300": "Safad Consulting",
  "1464523644563656": "The last step",
  "2002793296961811": "Triple Edge Building Construction",
  "525706182457820": "alhussaini",
  "568262692064148": "ocean home",
  "239558908010870": "plus decor",
  "1258656558338362": "الحساب الإعلاني للمعرض",
  "1498726280839864": "تحديث المباني",
  "872454488592849": "تحديث المباني - Mahara Media",
  "1434819351855972": "حول العمران",
  "827972432407411": "ريبالو",
  "1275190574533155": "منشآت خالدة",
  "1326793265986543": "نهوض نجد للمقاولات",
  "1988430024784828": "artist.. airbrush & graffiti",
};

/** Live check: the account is one the system user can reach. Falls back to the static list if Meta is unreachable. */
export async function canWriteLive(
  accountId?: string | null,
): Promise<boolean> {
  if (!accountId) return false;
  const id = accountId.replace(/^act_/, "");
  try {
    const all = await allAdAccounts();
    if (all.some(a => String(a.account_id) === id)) return true;
  } catch {
    // fall through to the static list
  }
  return canWrite(id);
}

export function canWrite(accountId?: string | null): boolean {
  if (!accountId) return false;
  return Boolean(WRITABLE_ACCOUNTS[accountId.replace(/^act_/, "")]);
}

export const getDraft = internalQuery({
  args: { id: v.id("campaignDrafts") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const patchDraft = internalMutation({
  args: { id: v.id("campaignDrafts"), patch: v.any() },
  returns: v.null(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
    return null;
  },
});

/** The campaigns we already track for this client, cheapest cost per lead first. */
export const bestCampaignFor = internalQuery({
  args: { clientTag: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientTag }) => {
    const rows = await ctx.db
      .query("campaigns")
      .filter(q => q.eq(q.field("clientTag"), clientTag))
      .collect();
    return rows
      .filter(r => (r.leads7d ?? 0) > 0 && r.cpl)
      .sort((a, b) => (a.cpl ?? 999) - (b.cpl ?? 999));
  },
});

const ACCOUNT_FROM_NAME = (raw?: string | null) =>
  raw ? raw.replace(/^act_/, "") : undefined;

/**
 * Step one: work out what to copy, then write the ad copy.
 * Leaves the draft in "ready" for her to review — nothing touches Meta yet.
 */
export const buildDraft = internalAction({
  args: { id: v.id("campaignDrafts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const draft = await ctx.runQuery(internal.builder.getDraft, { id });
    if (!draft) return null;
    try {
      const accountId = ACCOUNT_FROM_NAME(draft.accountId);
      let sourceAdSetId: string | undefined;
      let sourceAdSetName: string | undefined;
      let sourceReason = "";
      let targeting: unknown;
      let optimizationGoal: string | undefined;
      let billingEvent: string | undefined;
      let promotedObject: unknown;

      // Find the ad set worth copying: the one under the client's best campaign.
      const best = await ctx.runQuery(internal.builder.bestCampaignFor, {
        clientTag: draft.clientTag,
      });
      const winner = best?.[0];
      if (accountId && winner?.metaCampaignId) {
        const listed = unwrap(
          await callTool("mcp_meta_ads_list_ad_sets", {
            ad_account_id: `act_${accountId}`,
            campaign_id: winner.metaCampaignId,
            limit: 10,
          }),
        );
        const adSet = listed?.data?.[0];
        if (adSet?.id) {
          const full = unwrap(
            await callTool("mcp_meta_ads_get_ad_set", { ad_set_id: adSet.id }),
          );
          sourceAdSetId = adSet.id;
          sourceAdSetName = full?.name ?? adSet.name;
          targeting = full?.targeting;
          optimizationGoal = full?.optimization_goal;
          billingEvent = full?.billing_event;
          promotedObject = full?.promoted_object;
          sourceReason = `Copied from “${sourceAdSetName}” — the ad set under ${winner.campaignName}, this client's cheapest at $${(winner.cpl ?? 0).toFixed(2)} a lead over the last 7 days.`;
        }
      }
      if (!sourceAdSetId) {
        sourceReason =
          "No existing ad set with leads to copy from, so this one is built fresh — worth a closer look at the targeting before you launch it.";
      }

      // Copy needs a model. If none is reachable, the build still goes ahead
      // with the settings copied and she writes the copy herself.
      let variants: Awaited<ReturnType<typeof writeCopy>> = [];
      let copyNote: string | undefined;
      if (!process.env.ANTHROPIC_API_KEY) {
        // No model here: the outside Ask AI worker writes it and the draft
        // fills in on its own. See askAi.ts.
        await ctx.runMutation(internal.askAi.enqueue, {
          kind: "draft_copy",
          refId: id,
          prompt: copyPrompt(draft, winner),
        });
        copyNote =
          "The copy is being written. It appears here on its own, usually within a few minutes.";
      } else {
        try {
          variants = await writeCopy(draft, winner);
        } catch (e) {
          copyNote = `Copy could not be written (${String(e).slice(0, 120)}). Add your own below.`;
        }
      }

      await ctx.runMutation(internal.builder.patchDraft, {
        id,
        patch: {
          sourceAdSetId,
          sourceAdSetName,
          sourceReason: copyNote ? `${sourceReason} ${copyNote}` : sourceReason,
          targeting,
          optimizationGoal,
          billingEvent,
          promotedObject,
          variants,
          status: "ready",
        },
      });
    } catch (e) {
      await ctx.runMutation(internal.builder.patchDraft, {
        id,
        patch: { status: "failed", error: String(e).slice(0, 400) },
      });
    }
    return null;
  },
});

/**
 * Ad copy in the client's language. Aziz's rules are not optional here: never
 * "contractors", money in USD only, and it has to read like a person wrote it.
 */
function copyPrompt(
  // biome-ignore lint/suspicious/noExplicitAny: draft row
  draft: any,
  // biome-ignore lint/suspicious/noExplicitAny: campaign row
  winner: any,
): string {
  const arabic = (draft.language ?? "").toLowerCase().startsWith("ar");
  return [
    `Write Meta lead-generation ad copy for ${draft.clientName}, a construction and design business in the Gulf.`,
    `Language: ${arabic ? "Arabic (Gulf, natural spoken register — not formal MSA, not translated-sounding)" : "English"}.`,
    `What the media buyer asked for: ${draft.brief || "a new lead generation campaign"}.`,
    draft.serviceOther
      ? `What this client actually sells: ${draft.serviceOther}. Write to that specifically, not to a generic construction offer.`
      : "",
    draft.contextDocs
      ? `Their brand DNA and offer cheat sheet — use the positioning and the offer in it rather than inventing one:\n${String(draft.contextDocs).slice(0, 4000)}`
      : "",
    winner
      ? `Their best current campaign is "${winner.campaignName}" at $${(winner.cpl ?? 0).toFixed(2)} per lead — stay in that territory rather than inventing a new angle.`
      : "",
    "",
    "Hard rules:",
    "- Never call the audience 'contractors' and never imply one-man teams. They are construction and design businesses, firms or companies.",
    "- Any money figure is in USD. Never dinar, riyal or dirham.",
    "- No emoji walls, no 'unlock', no 'revolutionise', no exclamation stacking.",
    "- Write like one person talking to another. Short sentences. Concrete, not aspirational.",
    "- Headline: under 40 characters. Primary text: 2 to 4 short lines.",
    "",
    "Give 5 distinct angles — not 5 rewrites of the same sentence. Vary the hook: outcome, objection, proof, question, direct offer.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function writeCopy(
  // biome-ignore lint/suspicious/noExplicitAny: draft row
  draft: any,
  // biome-ignore lint/suspicious/noExplicitAny: campaign row
  winner: any,
): Promise<
  Array<{ headline: string; primaryText: string; description?: string }>
> {
  const prompt = copyPrompt(draft, winner);
  const raw = await callTool("ai_structured_output", {
    prompt,
    intelligence_level: "smart",
    output_schema: {
      type: "object",
      properties: {
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              headline: { type: "string" },
              primaryText: { type: "string" },
              description: { type: "string" },
            },
            required: ["headline", "primaryText"],
          },
        },
      },
      required: ["variants"],
    },
  });
  const parsed = unwrap(raw);
  const out =
    parsed?.variants ??
    parsed?.output?.variants ??
    (typeof parsed === "string" ? JSON.parse(parsed)?.variants : null) ??
    [];
  // biome-ignore lint/suspicious/noExplicitAny: model output
  return (out as any[]).slice(0, 5).map(v => ({
    headline: String(v.headline ?? "").slice(0, 120),
    primaryText: String(v.primaryText ?? "").slice(0, 1200),
    description: v.description
      ? String(v.description).slice(0, 300)
      : undefined,
  }));
}

/**
 * Step two: put it up on Meta — paused. She still has to open Ads Manager and
 * turn it on, so a bad build costs nothing.
 */
export const launchDraft = internalAction({
  args: { id: v.id("campaignDrafts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const draft = await ctx.runQuery(internal.builder.getDraft, { id });
    if (!draft) return null;
    const accountId = ACCOUNT_FROM_NAME(draft.accountId);
    // Writable = any account the system user can reach, not the hardcoded
    // list from 2026-09-06. New accounts (Castello, City Wood, Al Ola, Ardon,
    // Alkhalil, Atlantis's "Ahmed Salama USD") were being refused. [2026-09-11]
    if (!(await canWriteLive(accountId))) {
      await ctx.runMutation(internal.builder.patchDraft, {
        id,
        patch: {
          status: "failed",
          error:
            "No write access to this ad account yet — it needs partner access before anything can be created in it.",
        },
      });
      return null;
    }
    try {
      const act = `act_${accountId}`;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "\\");

      const campaign = unwrap(
        await callTool("mcp_meta_ads_create_campaign", {
          ad_account_id: act,
          name: `${draft.clientName} |MAHARA|${stamp}`,
          objective: "OUTCOME_LEADS",
          status: "PAUSED",
          special_ad_categories: [],
        }),
      );
      const campaignId = campaign?.id;
      if (!campaignId) throw new Error("Meta did not return a campaign id");
      let promotedObject: unknown = draft.promotedObject;
      if (!promotedObject) {
        try {
          const pages: Any = await graph(`${act}/promote_pages`, {
            fields: "id,name",
            limit: "5",
          });
          const page = (pages?.data ?? [])[0];
          if (page) promotedObject = { page_id: String(page.id) };
        } catch (e) {
          console.warn(`promote_pages: ${String(e).slice(0, 120)}`);
        }
      }

      const adSet = unwrap(
        await callTool("mcp_meta_ads_create_ad_set", {
          ad_account_id: act,
          campaign_id: campaignId,
          name: `${draft.clientName} — ${draft.kind === "refresh" ? "creative refresh" : "new build"}`,
          status: "PAUSED",
          daily_budget: String(Math.round(draft.dailyBudget * 100)),
          // Meta needs an explicit bid strategy or it asks for a bid amount
          // (subcode 2490487); lowest cost is what every campaign here runs.
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          targeting: draft.targeting ?? {
            geo_locations: { countries: ["KW"] },
          },
          optimization_goal: draft.optimizationGoal ?? "LEAD_GENERATION",
          billing_event: draft.billingEvent ?? "IMPRESSIONS",
          // A lead-generation ad set needs the client's page. Copied from the
          // winner when there is one, otherwise the page connected to the
          // account. [2026-09-11]
          ...(promotedObject ? { promoted_object: promotedObject } : {}),
        }),
      );
      const adSetId = adSet?.id;
      if (!adSetId) throw new Error("Meta did not return an ad set id");

      await ctx.runMutation(internal.builder.patchDraft, {
        id,
        patch: {
          metaCampaignId: campaignId,
          metaAdSetId: adSetId,
          status: "launched",
          launchedAt: Date.now(),
          note: "Built paused on Meta. Attach the creative files in Ads Manager, then turn it on.",
        },
      });

      await ctx.runMutation(internal.cockpit.recordBuild, {
        clientTag: draft.clientTag,
        clientName: draft.clientName,
        what: `Built a new campaign — ${draft.variants.length} copy variants, $${draft.dailyBudget}/day, ${draft.sourceAdSetName ? `settings copied from ${draft.sourceAdSetName}` : "fresh targeting"}. Paused on Meta.`,
      });
    } catch (e) {
      await ctx.runMutation(internal.builder.patchDraft, {
        id,
        patch: { status: "failed", error: String(e).slice(0, 400) },
      });
    }
    return null;
  },
});
