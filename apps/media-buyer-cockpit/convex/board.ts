import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { refusal } from "./gate";
import { callTool, unwrap } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payloads
type Any = any;

/**
 * The Ads Management board is the source of truth for whether a campaign is
 * on or off: its "Ad Status" dropdown. Aziz, 2026-09-14: MOFAG's card said
 * Paused and the cockpit still listed it as active. The media buyer changes
 * the status from the cockpit, and a spending campaign with no card gets one
 * from the cockpit too.
 */

export const ADS_LIST = "901817774521";
export const AD_STATUS_FIELD = "7f118f61-34b6-483a-b749-ff9fc31fd423";
/** Statuses that take a campaign out of the active list. */
export const OFF_STATUSES = ["Paused", "Dead Campaign", "Lost Client"];

async function statusOptions(): Promise<{ id: string; name: string }[]> {
  const r: Any = await callTool("pd_clickup_proxy_get", {
    url: `https://api.clickup.com/api/v2/list/${ADS_LIST}/field`,
  });
  const fields: Any[] = unwrap(r)?.fields ?? r?.fields ?? [];
  const f = fields.find(
    x => x.id === AD_STATUS_FIELD || x.name === "Ad Status",
  );
  return (f?.type_config?.options ?? []).map((o: Any) => ({
    id: String(o.id),
    name: String(o.name),
  }));
}

/** The dropdown's current options, for the status picker. */
export const adStatusOptions = authenticatedAction({
  args: {},
  returns: v.array(v.string()),
  handler: async ctx => {
    const no = await refusal(ctx, "media_buyer");
    if (no) return [];
    return (await statusOptions()).map(o => o.name);
  },
});

export const campaignByName = internalQuery({
  args: { campaignName: v.string() },
  returns: v.any(),
  handler: async (ctx, { campaignName }) =>
    (await ctx.db.query("campaigns").collect()).find(
      c => c.campaignName === campaignName,
    ) ?? null,
});

export const patchStatus = internalMutation({
  args: { campaignName: v.string(), status: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignName, status }) => {
    for (const c of await ctx.db.query("campaigns").collect())
      if (c.campaignName === campaignName)
        await ctx.db.patch(c._id, { boardAdStatus: status });
    return null;
  },
});

export const dropOffBoard = internalMutation({
  args: { campaignName: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignName }) => {
    for (const r of await ctx.db
      .query("offBoardCampaigns")
      .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
      .collect())
      await ctx.db.delete(r._id);
    return null;
  },
});

/** Set the card's Ad Status on ClickUp, then here, so the list regroups at once. */
export const setAdStatus = authenticatedAction({
  args: { campaignName: v.string(), status: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, { campaignName, status }) => {
    const no = await refusal(ctx, "media_buyer", { campaignName });
    if (no) return { ok: false, error: no };
    try {
      const c: Any = await ctx.runQuery(internal.board.campaignByName, {
        campaignName,
      });
      if (!c?.taskId)
        return {
          ok: false,
          error: "This campaign has no card on the board yet.",
        };
      const opt = (await statusOptions()).find(
        o => o.name.toLowerCase() === status.toLowerCase(),
      );
      if (!opt)
        return {
          ok: false,
          error: `"${status}" is not an Ad Status option on the board.`,
        };
      await callTool("pd_clickup_proxy_post", {
        url: `https://api.clickup.com/api/v2/task/${c.taskId}/field/${AD_STATUS_FIELD}`,
        json_body: { value: opt.id },
      });
      await ctx.runMutation(internal.board.patchStatus, {
        campaignName,
        status: opt.name,
      });
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName,
        text: `Ad status on the board set to ${opt.name}`,
        ok: true,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 300) };
    }
  },
});

/**
 * A card for a campaign that spends with none: same shape the new-campaign
 * form creates (card name is the Meta campaign name, the client is the tag).
 */
export const addToBoard = authenticatedAction({
  args: {
    campaignName: v.string(),
    clientName: v.string(),
    status: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { campaignName, clientName, status }) => {
    const no = await refusal(ctx, "media_buyer", { clientName });
    if (no) return { ok: false, error: no };
    try {
      const opt = (await statusOptions()).find(
        o => o.name.toLowerCase() === status.toLowerCase(),
      );
      const r: Any = await callTool("pd_clickup_proxy_post", {
        url: `https://api.clickup.com/api/v2/list/${ADS_LIST}/task`,
        json_body: {
          name: campaignName,
          tags: [clientName.trim().toLowerCase()],
          ...(opt
            ? { custom_fields: [{ id: AD_STATUS_FIELD, value: opt.id }] }
            : {}),
        },
      });
      const task: Any = unwrap(r) ?? r;
      await ctx.runMutation(internal.board.dropOffBoard, { campaignName });
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName,
        text: `Card added to the ads board for ${clientName} (${opt?.name ?? "no status"}). It joins the campaign list on the next sync.`,
        ok: true,
      });
      return { ok: true, url: task?.url ? String(task.url) : undefined };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 300) };
    }
  },
});

/** Replace the client link list; an empty read keeps the old one. */
export const storeClientLinks = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    if (!rows.length) return 0;
    for (const r of await ctx.db.query("clientLinks").collect())
      await ctx.db.delete(r._id);
    const str = (x: unknown) =>
      typeof x === "string" && x.trim() ? x.trim() : undefined;
    for (const r of rows)
      await ctx.db.insert("clientLinks", {
        name: String(r.name),
        aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [],
        url: str(r.url),
        driveLink: str(r.driveLink),
        brandDnaDoc: str(r.brandDnaDoc),
        offerCheatSheet: str(r.offerCheatSheet),
        syncedAt: Date.now(),
      });
    return rows.length;
  },
});
