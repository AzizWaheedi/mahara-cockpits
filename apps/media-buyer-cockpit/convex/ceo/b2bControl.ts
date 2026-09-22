import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { graphPost } from "../tools";
import { requireCeo } from "./gate";

/**
 * Switch a campaign, ad set or ad on Mahara's own account on or off.
 *
 * This is a real write to the live account, so it is as narrow as the client
 * version in convex/control.ts: it only ever sets ACTIVE or PAUSED. It differs
 * in who may press it. The client screen asks whether the person is a media
 * buyer on that client's list; this account has no client, it is Mahara's own
 * money, so the gate is the one in gate.ts: Aziz's own address, which no row
 * in any table can grant to anybody else.
 *
 * Every flip writes an audit row naming the object, the direction and who did
 * it, and the next refresh re-reads Meta rather than trusting the write.
 */

/** The only account this file may touch. Anything else is refused before Meta is asked. */
const ACCOUNT = "746108264865897";

export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => requireCeo({ ...ctx, userId }),
});

export const record = internalMutation({
  args: {
    metaId: v.string(),
    level: v.string(),
    name: v.string(),
    status: v.string(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: "b2bAds.toggle",
      table: "meta",
      rowId: a.metaId,
      what: `${a.status === "ACTIVE" ? "Turned on" : "Turned off"} ${a.level} "${a.name}" on Mahara's own ad account`,
      before: { status: a.status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
      after: { status: a.status },
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

export const setStatus = authenticatedAction({
  args: {
    metaId: v.string(),
    level: v.union(v.literal("campaign"), v.literal("adset"), v.literal("ad")),
    active: v.boolean(),
    name: v.string(),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, a): Promise<{ ok: boolean; error?: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    if (!/^\d{5,}$/.test(a.metaId))
      return { ok: false, error: "That is not a Meta id." };
    // Refuse to act on anything that is not on our own account. Meta ids are
    // global, so a pasted client id would otherwise go straight through.
    // biome-ignore lint/suspicious/noExplicitAny: Graph API payload
    let owner: any;
    try {
      const { graph } = await import("../tools");
      owner = await graph(a.metaId, { fields: "account_id" });
    } catch (e) {
      return {
        ok: false,
        error: `Meta would not describe ${a.metaId}: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
      };
    }
    if (String(owner?.account_id ?? "") !== ACCOUNT)
      return {
        ok: false,
        error:
          "That object is not on Mahara's own ad account, so this screen will not touch it.",
      };
    const status = a.active ? "ACTIVE" : "PAUSED";
    try {
      await graphPost(a.metaId, { status });
    } catch (e) {
      return {
        ok: false,
        error: String(e instanceof Error ? e.message : e).slice(0, 200),
      };
    }
    await ctx.runMutation(internal.ceo.b2bControl.record, {
      metaId: a.metaId,
      level: a.level,
      name: a.name,
      status,
      by,
    });
    return { ok: true };
  },
});
