import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { rest } from "./sbWrite";

/**
 * Take a client off the dashboards, or put it back.
 *
 * Aziz, 2026-09-22 about ريبالو: "I don't think that's a client or on the ads
 * management dashboard. Why is it here? You can remove them for now."
 *
 * An ad account can exist in Creative Triage without ever having been a
 * client: somebody connected it to look at it, or a trial was never cleaned
 * up. Those rows carry spend and no results, so they drag every client
 * average down and read as a failing client on the delivery screens.
 *
 * Hiding is not deleting. The row keeps its history, `is_active` is left
 * alone, and `hidden_from_dashboard` is the one field that changes, so the
 * decision can be undone from here with nothing lost. Both directions leave
 * an audit row saying who did it and why.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const record = internalMutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    hidden: v.boolean(),
    why: v.string(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: "clients.visibility",
      table: "clients",
      rowId: a.clientId,
      what: a.hidden
        ? `Took "${a.name}" off the dashboards: ${a.why}`
        : `Put "${a.name}" back on the dashboards`,
      before: { hiddenFromDashboard: !a.hidden },
      after: { hiddenFromDashboard: a.hidden, why: a.why },
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

async function setHidden(
  clientId: string,
  hidden: boolean,
): Promise<{ id: string; name: string }> {
  if (!UUID.test(clientId)) throw new Error("That is not a client id.");
  const rows = await rest(`clients?id=eq.${clientId}`, {
    method: "PATCH",
    body: { hidden_from_dashboard: hidden },
    prefer: "return=representation",
  });
  const row = rows?.[0];
  if (!row) throw new Error("No client with that id.");
  return { id: String(row.id), name: String(row.name ?? clientId) };
}

export const hide = authenticatedAction({
  args: { clientId: v.string(), why: v.string() },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true; name: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const why = a.why.trim();
    if (why.length < 4)
      throw new Error("Say why, so the decision reads back in six months.");
    const row = await setHidden(a.clientId, true);
    await ctx.runMutation(internal.ceo.clientVisibility.record, {
      clientId: row.id,
      name: row.name,
      hidden: true,
      why,
      by,
    });
    return { ok: true, name: row.name };
  },
});

export const show = authenticatedAction({
  args: { clientId: v.string() },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true; name: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const row = await setHidden(a.clientId, false);
    await ctx.runMutation(internal.ceo.clientVisibility.record, {
      clientId: row.id,
      name: row.name,
      hidden: false,
      why: "",
      by,
    });
    return { ok: true, name: row.name };
  },
});

/** Everything currently taken off the dashboards, so nothing stays hidden by accident. */
export const hidden = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (
    ctx,
  ): Promise<{ id: string; name: string; adAccount: string | null }[]> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    const rows =
      (await rest(
        "clients?hidden_from_dashboard=is.true&select=id,name,meta_ad_account_id&order=name",
      )) ?? [];
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
      adAccount: r.meta_ad_account_id ? String(r.meta_ad_account_id) : null,
    }));
  },
});
