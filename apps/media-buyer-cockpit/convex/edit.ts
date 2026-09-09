import { v } from "convex/values";
import { internal } from "./_generated/api";
import { authenticatedAction } from "./functions";
import { callTool, graph, graphPost, unwrap } from "./tools";

/**
 * Editing what already exists: new ad sets, new ads, new budgets.
 *
 * The campaign builder covers "start something new". This covers the far more
 * common day: a campaign is running and she wants another ad set, another few
 * ads, or a different budget — without rebuilding anything.
 *
 * Two rules hold everywhere in this file:
 *  1. Everything new is created PAUSED. Nothing starts spending because she
 *     clicked a button in a dashboard.
 *  2. Every write is logged to the change log, which also restarts the 3-day
 *     "leave it alone" clock so the cockpit stops nagging about an account she
 *     has just touched.
 */

/**
 * Copying targeting verbatim can trip Meta's placement validation, because some
 * placements are only valid alongside another one. Meta accepts these
 * combinations on ad sets that already exist but rejects them on creation, so
 * normalise rather than pass the original through untouched.
 */
function sanitizeTargeting(targeting: any): any {
  const t = JSON.parse(JSON.stringify(targeting ?? {}));
  const ig: string[] | undefined = t.instagram_positions;
  if (Array.isArray(ig)) {
    // "explore_home" is only valid when "explore" is also selected.
    if (ig.includes("explore_home") && !ig.includes("explore")) {
      t.instagram_positions = [...ig, "explore"];
    }
  }
  return t;
}

/** Meta takes budgets in minor units. She types dollars. */
const toMinor = (dollars: number) => Math.round(dollars * 100);

async function logIt(
  ctx: any,
  args: { campaignName: string; adName?: string; what: string },
) {
  await ctx.runMutation(internal.control.recordToggle, {
    metaId: "-",
    level: "edit",
    status: "-",
    name: args.adName ?? args.campaignName,
    clientTag: args.campaignName,
    overrideNote: args.what,
  });
}

/**
 * Copy an existing ad set, keeping its targeting, optimisation goal and lead
 * form, so a new angle can be tested without rebuilding the setup by hand.
 */
export const duplicateAdSet = authenticatedAction({
  args: {
    adsetId: v.string(),
    newName: v.string(),
    dailyBudget: v.optional(v.number()),
    campaignName: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    adsetId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const src = await graph<any>(args.adsetId, {
        fields:
          "name,campaign_id,account_id,daily_budget,billing_event,optimization_goal,bid_strategy,promoted_object,destination_type,targeting,attribution_spec",
      });
      // If the campaign holds the budget (CBO), Meta rejects an ad-set budget
      // outright. Ask the campaign first rather than guessing.
      const parent = await graph<any>(src.campaign_id, {
        fields: "daily_budget,lifetime_budget",
      });
      const campaignHoldsBudget = Boolean(
        parent.daily_budget || parent.lifetime_budget,
      );

      const payload: Record<string, string | number> = {
        name: args.newName,
        campaign_id: src.campaign_id,
        billing_event: src.billing_event,
        optimization_goal: src.optimization_goal,
        targeting: JSON.stringify(sanitizeTargeting(src.targeting)),
        status: "PAUSED",
      };
      if (!campaignHoldsBudget) {
        payload.daily_budget =
          args.dailyBudget !== undefined
            ? toMinor(args.dailyBudget)
            : (src.daily_budget ?? toMinor(30));
      }
      if (src.promoted_object)
        payload.promoted_object = JSON.stringify(src.promoted_object);
      if (src.destination_type) payload.destination_type = src.destination_type;
      if (src.bid_strategy) payload.bid_strategy = src.bid_strategy;

      const made = await graphPost<any>(`act_${src.account_id}/adsets`, payload);
      await logIt(ctx, {
        campaignName: args.campaignName,
        what: `Created ad set "${args.newName}" (paused) by copying the targeting from "${src.name}"`,
      });
      return { ok: true, adsetId: made.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

/** Change an ad set's daily budget. */
export const setAdSetBudget = authenticatedAction({
  args: {
    adsetId: v.string(),
    dailyBudget: v.number(),
    name: v.string(),
    campaignName: v.string(),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    try {
      await graphPost(args.adsetId, {
        daily_budget: toMinor(args.dailyBudget),
      });
      await logIt(ctx, {
        campaignName: args.campaignName,
        adName: args.name,
        what: `Set daily budget on ad set "${args.name}" to $${args.dailyBudget}`,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

/**
 * Make new ads from an ad that already works, swapping in new copy.
 *
 * The creative (video or image), the page, and the lead form are reused exactly
 * as they are — only the primary text and headline change. That is what a copy
 * test actually is, and it means she never has to re-upload a winning video to
 * test a new hook.
 */
export const newAdsFromExisting = authenticatedAction({
  args: {
    sourceAdId: v.string(),
    variants: v.array(v.object({ message: v.string(), headline: v.string() })),
    adsetId: v.optional(v.string()),
    campaignName: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    made: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const src = await graph<any>(args.sourceAdId, {
        fields: "name,adset_id,account_id,creative{id,object_story_spec}",
      });
      const spec = src.creative?.object_story_spec;
      if (!spec) {
        return {
          ok: false,
          error:
            "That ad's creative can't be copied automatically — it uses a dynamic format. Duplicate it in Ads Manager instead.",
        };
      }
      const adsetId = args.adsetId ?? src.adset_id;
      const made: string[] = [];

      for (const [i, variant] of args.variants.entries()) {
        // Only touch the text. Everything else — video, image, CTA, lead form —
        // is carried over untouched so this stays a true copy test.
        const next = JSON.parse(JSON.stringify(spec));
        for (const key of ["video_data", "link_data"]) {
          if (next[key]) {
            next[key].message = variant.message;
            if (next[key].title !== undefined)
              next[key].title = variant.headline;
            if (next[key].name !== undefined) next[key].name = variant.headline;
          }
        }
        const creative = await graphPost<any>(
          `act_${src.account_id}/adcreatives`,
          {
            name: `${variant.headline.slice(0, 40)} — cockpit`,
            object_story_spec: JSON.stringify(next),
          },
        );
        const ad = await graphPost<any>(`act_${src.account_id}/ads`, {
          name: `${src.name} · v${i + 2}`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creative.id }),
          status: "PAUSED",
        });
        made.push(ad.id);
      }

      await logIt(ctx, {
        campaignName: args.campaignName,
        adName: src.name,
        what: `Created ${made.length} new ad${made.length === 1 ? "" : "s"} (paused) from "${src.name}" with new copy`,
      });
      return { ok: true, made };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

/**
 * Draft copy angles for a copy test.
 *
 * This one goes through the Viktor tool gateway rather than straight to Meta, so
 * it is the one thing here that can be unavailable. When it is, the UI falls
 * back to her writing the copy herself — which still creates the ads fine.
 */
export const suggestCopy = authenticatedAction({
  args: {
    clientName: v.string(),
    brief: v.string(),
    language: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    variants: v.optional(
      v.array(v.object({ message: v.string(), headline: v.string() })),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const arabic = (args.language ?? "").toLowerCase().startsWith("ar");
    const prompt = [
      `Write Meta lead-generation ad copy for ${args.clientName}, a construction and design business in the Gulf.`,
      `Language: ${arabic ? "Arabic (Gulf, natural spoken register — not formal MSA, not translated-sounding)" : "English"}.`,
      `What the media buyer asked for: ${args.brief || "new copy angles for an ad that already works"}.`,
      "",
      "Hard rules:",
      "- Never call the audience 'contractors' and never imply one-man teams. They are construction and design businesses, firms or companies.",
      "- Any money figure is in USD. Never dinar, riyal or dirham.",
      "- No emoji walls, no 'unlock', no 'revolutionise', no exclamation stacking.",
      "- Write like one person talking to another. Short sentences. Concrete, not aspirational.",
      "- Headline: under 40 characters. Primary text: 2 to 4 short lines.",
      "",
      `Give ${args.count ?? 3} distinct angles — not rewrites of the same sentence. Vary the hook: outcome, objection, proof, question, direct offer.`,
    ].join("\n");

    try {
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
                },
                required: ["headline", "primaryText"],
              },
            },
          },
          required: ["variants"],
        },
      });
      const parsed: any = unwrap(raw);
      const list = parsed?.variants ?? [];
      if (!Array.isArray(list) || list.length === 0)
        return { ok: false, error: "No copy came back." };
      return {
        ok: true,
        variants: list.map((x: any) => ({
          headline: String(x.headline ?? ""),
          message: String(x.primaryText ?? ""),
        })),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

/**
 * Add a brand-new creative to a campaign that is already running.
 *
 * The common case is the one the video pipeline produces: an editor finishes a
 * video, and she wants it live under the same ad set, against the same lead
 * form and page, without rebuilding anything. So the media is uploaded to the
 * ad account and dropped into a copy of an existing ad's creative spec —
 * everything except the video/image and the copy is carried over untouched.
 *
 * Meta needs a directly downloadable URL. A Google Drive "share" link is a HTML
 * page, not a file, so it is rejected up front with an explanation rather than
 * failing deep inside the Graph call with something unreadable.
 */
export const addCreativeToCampaign = authenticatedAction({
  args: {
    /** An existing ad in the campaign, used as the template. */
    sourceAdId: v.string(),
    campaignName: v.string(),
    /** Exactly one of these. */
    videoUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    /** Already inside the ad account — Viktor pulled it off Drive for her. */
    videoId: v.optional(v.string()),
    imageHash: v.optional(v.string()),
    message: v.optional(v.string()),
    headline: v.optional(v.string()),
    adName: v.optional(v.string()),
    adsetId: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    adId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!args.videoUrl && !args.imageUrl && !args.videoId && !args.imageHash) {
      return { ok: false, error: "Give me a video or an image to use." };
    }
    const url = args.videoUrl ?? args.imageUrl ?? "";
    if (/drive\.google\.com|docs\.google\.com/.test(url)) {
      // Meta downloads the Drive preview page, not the file. She should never
      // have to know that: paste the Drive link in the creative box instead and
      // Viktor fetches it and loads it into the account. [aziz, 2026-09-07]
      return {
        ok: false,
        error:
          "Meta can't read a Drive share link directly. Paste it in the Drive box above instead — " +
          "I'll fetch the file and load it into the ad account, then this will work.",
      };
    }

    try {
      const src = await graph<any>(args.sourceAdId, {
        fields: "name,adset_id,account_id,creative{id,object_story_spec}",
      });
      const spec = src.creative?.object_story_spec;
      if (!spec) {
        return {
          ok: false,
          error:
            "That ad's creative is a dynamic format, so there's no spec to copy. Pick a different ad in the campaign as the template.",
        };
      }

      const act = `act_${src.account_id}`;
      const next = JSON.parse(JSON.stringify(spec));

      if (args.videoUrl || args.videoId) {
        // `videoId` means Viktor already uploaded the file from Drive.
        const video = args.videoId
          ? { id: args.videoId }
          : await graphPost<any>(`${act}/advideos`, {
              file_url: args.videoUrl ?? "",
              name: args.adName ?? `${src.name} — new cut`,
            });
        // Swapping media means the old link_data (a static image post) no
        // longer applies; a video creative must carry video_data.
        const base = next.video_data ?? {};
        const link =
          next.link_data?.call_to_action ?? base.call_to_action ?? undefined;
        next.video_data = {
          ...base,
          video_id: video.id,
          ...(link ? { call_to_action: link } : {}),
        };
        delete next.link_data;
      } else if (args.imageUrl || args.imageHash) {
        const uploaded = args.imageHash
          ? { images: { a: { hash: args.imageHash } } }
          : await graphPost<any>(`${act}/adimages`, { url: args.imageUrl ?? "" });
        // The images response is keyed by filename, not a fixed field.
        const first: any = Object.values(uploaded.images ?? {})[0];
        if (!first?.hash) {
          return { ok: false, error: "Meta accepted the image but returned no hash." };
        }
        next.link_data = { ...(next.link_data ?? {}), image_hash: first.hash };
        delete next.video_data;
      }

      const target = next.video_data ?? next.link_data;
      if (target) {
        if (args.message) target.message = args.message;
        if (args.headline) {
          if (target.title !== undefined) target.title = args.headline;
          if (target.name !== undefined) target.name = args.headline;
        }
      }

      const creative = await graphPost<any>(`${act}/adcreatives`, {
        name: `${args.adName ?? src.name} — cockpit`,
        object_story_spec: JSON.stringify(next),
      });
      const ad = await graphPost<any>(`${act}/ads`, {
        name: args.adName ?? `${src.name} · new creative`,
        adset_id: args.adsetId ?? src.adset_id,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: "PAUSED",
      });

      await logIt(ctx, {
        campaignName: args.campaignName,
        adName: ad.id,
        what: `Added a new ${args.videoUrl || args.videoId ? "video" : "image"} creative (paused) to "${src.name}"'s ad set`,
      });
      return { ok: true, adId: ad.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

/**
 * Free-form: she describes what she wants and it reaches Viktor.
 *
 * Deliberately not an AI text box that pretends to act. The in-app model
 * gateway is down, and a box that silently does nothing is worse than no box.
 * This captures the request against the campaign it belongs to and queues it
 * for delivery, so it lands somewhere a human or Viktor will actually see it.
 */
export const askViktorFor = authenticatedAction({
  args: {
    campaignName: v.optional(v.string()),
    client: v.optional(v.string()),
    request: v.string(),
    askedBy: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const text = args.request.trim();
    if (text.length < 5) {
      return { ok: false, error: "Tell me a bit more about what you want." };
    }
    const where = args.campaignName
      ? ` (campaign: ${args.campaignName})`
      : args.client
        ? ` (client: ${args.client})`
        : "";
    await ctx.runMutation(internal.outbox.enqueue, {
      role: "slack_request",
      args: {
        text: `Request from the media buyer cockpit${where}: ${text}`,
        askedBy: args.askedBy,
        campaignName: args.campaignName,
        client: args.client,
      },
    });
    await logIt(ctx, {
      campaignName: args.campaignName ?? args.client ?? "-",
      what: `Asked Viktor: ${text.slice(0, 160)}`,
    });
    return { ok: true };
  },
});
