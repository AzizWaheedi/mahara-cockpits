import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
