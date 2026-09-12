import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { refusal } from "./gate";
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
    /** The campaign this object belongs to, so the change is filed under it. */
    campaignName: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    // A session alone is not a seat: only a media buyer, on a client on her
    // list, may flip anything in Meta. Returned rather than thrown, like the
    // other Meta writes, so the toggle shows the refusal itself instead of
    // "could not confirm with Meta" for a change that never happened.
    const no = await refusal(ctx, "media_buyer", {
      campaignName:
        args.campaignName ??
        (args.level === "campaign" ? args.name : undefined),
      clientTag: args.clientTag,
      metaId: args.metaId,
    });
    if (no) return { ok: false, error: no };
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
      campaignName: args.campaignName,
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
    /** The campaign the change belongs to. Callers that know it pass it. */
    campaignName: v.optional(v.string()),
    /** Set by edit.ts, which describes its own change far better than on/off. */
    overrideNote: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const note =
      args.overrideNote ??
      `${args.status === "ACTIVE" ? "Turned on" : "Turned off"} ${args.level} "${args.name}" from the cockpit`;
    // Reflect it immediately so the screen doesn't lie until the next sync.
    const rows = await ctx.db
      .query("metaTree")
      .filter(q => q.eq(q.field("metaId"), args.metaId))
      .collect();

    // The learning-period rule in sync.ts matches manualChanges on the
    // campaign name, and the campaign thread is keyed by it. A campaign-level
    // change has no metaTree row, so it used to be filed under the client tag,
    // which is not a campaign, and neither the rule nor the thread ever saw it.
    const campaignName =
      args.campaignName ??
      rows[0]?.campaignName ??
      (args.level === "campaign" ? args.name : undefined) ??
      args.clientTag ??
      args.name;
    await ctx.db.insert("manualChanges", {
      campaignName,
      adName: args.level === "campaign" ? undefined : args.name,
      what: note,
      by: "cockpit",
      at: Date.now(),
    });

    // And write it into the campaign's own thread, so the history of what was
    // done to a campaign lives next to the conversation about it rather than
    // only in a toast that disappears. [aziz, 2026-09-07]
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
