import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { allAdAccounts } from "./tools";

/** Clear test rows out of the assist queue. Kept for future stress tests. */
export const clearAssist = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const rows = await ctx.db.query("assistRequests").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

/** Every Meta ad account the system-user token can see: name and id. For audits. */
export const visibleAdAccounts = internalAction({
  args: {},
  returns: v.array(v.object({ name: v.string(), id: v.string() })),
  handler: async () =>
    (await allAdAccounts()).map(a => ({
      name: String(a.name ?? ""),
      id: String(a.account_id ?? ""),
    })),
});
