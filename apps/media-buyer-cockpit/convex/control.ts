import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { graphPost } from "./tools";

/**
 * Turn a campaign, ad set or ad on and off from the cockpit.
 *
 * This is a real write to the live ad account, so it is deliberately narrow: it
 * only ever sets ACTIVE or PAUSED, and it records what happened in the change log
 * so the 3-day "leave it alone" clock starts and the team can see who did what.
 */
export const setStatus = authenticatedAction({
  args: {
    metaId: v.string(),
    level: v.union(v.literal("campaign"), v.literal("adset"), v.literal("ad")),
    active: v.boolean(),
    name: v.string(),
    clientTag: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const status = args.active ? "ACTIVE" : "PAUSED";
    try {
      await graphPost(args.metaId, { status });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await ctx.runMutation(internal.control.recordToggle, {
      metaId: args.metaId,
      level: args.level,
      status,
      name: args.name,
      clientTag: args.clientTag,
    });
    return { ok: true };
  },
});

export const recordToggle = internalMutation({
  args: {
    metaId: v.string(),
    level: v.string(),
    status: v.string(),
    name: v.string(),
    clientTag: v.optional(v.string()),
    /** Set by edit.ts, which describes its own change far better than on/off. */
    overrideNote: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const note =
      args.overrideNote ??
      `${args.status === "ACTIVE" ? "Turned on" : "Turned off"} ${args.level} "${args.name}" from the cockpit`;
    await ctx.db.insert("manualChanges", {
      campaignName: args.clientTag ?? args.name,
      adName: args.level === "campaign" ? undefined : args.name,
      what: note,
      by: "cockpit",
      at: Date.now(),
    });
    // Reflect it immediately so the screen doesn't lie until the next sync.
    const rows = await ctx.db
      .query("metaTree")
      .filter(q => q.eq(q.field("metaId"), args.metaId))
      .collect();

    // And write it into the campaign's own thread, so the history of what was
    // done to a campaign lives next to the conversation about it rather than
    // only in a toast that disappears. [aziz, 2026-09-07]
    const campaignName = rows[0]?.campaignName ?? args.clientTag ?? args.name;
    if (campaignName) {
      await ctx.db.insert("campaignChat", {
        campaignId: campaignName,
        campaignName,
        client: args.clientTag,
        author: "her",
        text: note,
        pending: false,
        status: "done",
        kind: "action",
        ok: true,
        at: Date.now(),
      });
    }
    for (const r of rows) {
      await ctx.db.patch(r._id, {
        status: args.status,
        effectiveStatus: args.status,
      });
    }
    return null;
  },
});
