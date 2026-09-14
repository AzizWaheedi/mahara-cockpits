import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { clickupCall } from "./dosDonts";
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

/** The Advertising Cities labels field on the Ads Management board. [Aziz, 2026-09-14] */
export const CITIES_FIELD = "b98aa20e-c2d1-4785-baae-67e67506023d";

async function cityOptions(): Promise<
  { id: string; label: string; color?: string }[]
> {
  const r: Any = await callTool("pd_clickup_proxy_get", {
    url: `https://api.clickup.com/api/v2/list/${ADS_LIST}/field`,
  });
  const fields: Any[] = unwrap(r)?.fields ?? r?.fields ?? [];
  const f = fields.find(
    x => x.id === CITIES_FIELD || x.name === "Advertising Cities",
  );
  return (f?.type_config?.options ?? [])
    .map((o: Any) => ({
      id: String(o.id),
      label: String(o.label ?? o.name ?? ""),
      color: o.color ? String(o.color) : undefined,
    }))
    .filter((o: { label: string }) => o.label);
}

/** Every city on the board's Advertising Cities field, in the board's order. */
export const advertisingCityOptions = authenticatedAction({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      label: v.string(),
      color: v.optional(v.string()),
    }),
  ),
  handler: async () => await cityOptions(),
});

export const patchCities = internalMutation({
  args: {
    campaignName: v.string(),
    taskId: v.optional(v.string()),
    cities: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { campaignName, taskId, cities }) => {
    const value = cities.length ? cities : undefined;
    for (const c of await ctx.db.query("campaigns").collect())
      if (c.campaignName === campaignName || (taskId && c.taskId === taskId))
        await ctx.db.patch(c._id, { advertisingCities: value });
    if (taskId)
      for (const card of await ctx.db
        .query("boardCards")
        .withIndex("by_task", q => q.eq("taskId", taskId))
        .collect())
        await ctx.db.patch(card._id, { advertisingCities: value });
    return null;
  },
});

/** Set the card's Advertising Cities on ClickUp (the whole set), then here. */
export const setAdvertisingCities = authenticatedAction({
  args: {
    campaignName: v.string(),
    cities: v.array(v.string()),
    /** A card from the board view that has no campaign row. */
    taskId: v.optional(v.string()),
    clientTag: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, { campaignName, cities, taskId, clientTag }) => {
    const no = await refusal(
      ctx,
      "media_buyer",
      taskId ? { clientName: clientTag } : { campaignName },
    );
    if (no) return { ok: false, error: no };
    try {
      const c: Any = taskId
        ? { taskId }
        : await ctx.runQuery(internal.board.campaignByName, { campaignName });
      if (!c?.taskId)
        return {
          ok: false,
          error: "This campaign has no card on the board yet.",
        };
      const options = await cityOptions();
      const unknown = cities.filter(x => !options.some(o => o.label === x));
      if (unknown.length)
        return {
          ok: false,
          error: `Not an Advertising Cities option on the board: ${unknown.join(", ")}`,
        };
      const picked = options.filter(o => cities.includes(o.label));
      if (picked.length)
        await callTool("pd_clickup_proxy_post", {
          url: `https://api.clickup.com/api/v2/task/${c.taskId}/field/${CITIES_FIELD}`,
          json_body: { value: picked.map(o => o.id) },
        });
      else
        await clickupCall("DELETE", `task/${c.taskId}/field/${CITIES_FIELD}`);
      await ctx.runMutation(internal.board.patchCities, {
        campaignName,
        taskId: String(c.taskId),
        cities: picked.map(o => o.label),
      });
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName,
        text: picked.length
          ? `Advertising cities on the board set to ${picked.map(o => o.label).join(", ")}`
          : "Advertising cities on the board cleared",
        ok: true,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 300) };
    }
  },
});

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
  args: {
    campaignName: v.string(),
    status: v.string(),
    taskId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { campaignName, status, taskId }) => {
    for (const c of await ctx.db.query("campaigns").collect())
      if (c.campaignName === campaignName || (taskId && c.taskId === taskId))
        await ctx.db.patch(c._id, { boardAdStatus: status });
    if (taskId)
      for (const card of await ctx.db
        .query("boardCards")
        .withIndex("by_task", q => q.eq("taskId", taskId))
        .collect())
        await ctx.db.patch(card._id, { adStatus: status });
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

/**
 * The same write as setAdStatus for one card, run from the backend when Aziz
 * asks for a board clean-up (no user session). Logged like a cockpit change.
 */
export const setCardStatus = internalAction({
  args: { taskId: v.string(), cardName: v.string(), status: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, { taskId, cardName, status }) => {
    const opt = (await statusOptions()).find(
      o => o.name.toLowerCase() === status.toLowerCase(),
    );
    if (!opt)
      return { ok: false, error: `"${status}" is not an Ad Status option.` };
    await callTool("pd_clickup_proxy_post", {
      url: `https://api.clickup.com/api/v2/task/${taskId}/field/${AD_STATUS_FIELD}`,
      json_body: { value: opt.id },
    });
    await ctx.runMutation(internal.board.patchStatus, {
      campaignName: cardName,
      status: opt.name,
      taskId,
    });
    await ctx.runMutation(internal.chat.logInternal, {
      campaignName: cardName,
      text: `Ad status on the board set to ${opt.name} (old card, replaced by a newer campaign)`,
      ok: true,
    });
    return { ok: true };
  },
});

/** Set the card's Ad Status on ClickUp, then here, so the list regroups at once. */
export const setAdStatus = authenticatedAction({
  args: {
    campaignName: v.string(),
    status: v.string(),
    /** A card from the board view that has no campaign row. */
    taskId: v.optional(v.string()),
    clientTag: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, { campaignName, status, taskId, clientTag }) => {
    const no = await refusal(
      ctx,
      "media_buyer",
      taskId ? { clientName: clientTag } : { campaignName },
    );
    if (no) return { ok: false, error: no };
    try {
      const c: Any = taskId
        ? { taskId }
        : await ctx.runQuery(internal.board.campaignByName, { campaignName });
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
        taskId: String(c.taskId),
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
        dosDonts: str(r.dosDonts),
        syncedAt: Date.now(),
      });
    return rows.length;
  },
});

/** Replace the board card list; an empty read keeps the old one. */
export const storeBoardCards = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    if (!rows.length) return 0;
    for (const r of await ctx.db.query("boardCards").collect())
      await ctx.db.delete(r._id);
    for (const r of rows)
      await ctx.db.insert("boardCards", { ...r, syncedAt: Date.now() });
    return rows.length;
  },
});

export const recordDismissal = internalMutation({
  args: { campaignName: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignName }) => {
    await ctx.db.insert("offBoardDismissals", { campaignName, at: Date.now() });
    for (const r of await ctx.db
      .query("offBoardCampaigns")
      .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
      .collect())
      await ctx.db.delete(r._id);
    return null;
  },
});

/** "Not our campaign": gone from the missing-card list, and it stays gone. */
export const dismissOffBoard = authenticatedAction({
  args: { campaignName: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, { campaignName }) => {
    const no = await refusal(ctx, "media_buyer");
    if (no) return { ok: false, error: no };
    await ctx.runMutation(internal.board.recordDismissal, { campaignName });
    return { ok: true };
  },
});

export const clearStaleName = internalMutation({
  args: { campaignName: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignName }) => {
    for (const c of await ctx.db.query("campaigns").collect())
      if (c.campaignName === campaignName)
        await ctx.db.patch(c._id, { staleTaskName: undefined });
    return null;
  },
});

/** Rename the card to the campaign it now tracks (a relaunch under a new name). */
export const renameCard = authenticatedAction({
  args: { campaignName: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, { campaignName }) => {
    const no = await refusal(ctx, "media_buyer", { campaignName });
    if (no) return { ok: false, error: no };
    try {
      const c: Any = await ctx.runQuery(internal.board.campaignByName, {
        campaignName,
      });
      if (!c?.taskId) return { ok: false, error: "No card to rename." };
      await callTool("pd_clickup_proxy_put", {
        url: `https://api.clickup.com/api/v2/task/${c.taskId}`,
        json_body: { name: campaignName },
      });
      await ctx.runMutation(internal.board.clearStaleName, { campaignName });
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName,
        text: `Board card renamed to ${campaignName}`,
        ok: true,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 300) };
    }
  },
});

/**
 * A client's Do's & Don'ts from their ClickUp client card, matched by name or
 * alias the same way the cockpit groups campaigns. Null when the card has none.
 */
export async function dosDontsText(
  ctx: QueryCtx,
  name?: string | null,
): Promise<string | null> {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  const tight = key.replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
  const rows = await ctx.db.query("clientLinks").collect();
  const hit =
    rows.find(r => r.name.trim().toLowerCase() === key) ??
    rows.find(r =>
      r.aliases.some(
        a => a === key || a.replace(/[^a-z0-9\u0600-\u06ff]+/g, "") === tight,
      ),
    );
  return hit?.dosDonts ?? null;
}

export const dosDontsFor = internalQuery({
  args: { name: v.optional(v.string()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { name }) => await dosDontsText(ctx, name),
});
