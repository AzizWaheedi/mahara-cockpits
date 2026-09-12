import { v } from "convex/values";
import { internal } from "./_generated/api";
import { authenticatedMutation } from "./functions";

/** A screen that crashed reports itself here; Hermes gets the fix job. */
export const report = authenticatedMutation({
  args: { title: v.string(), detail: v.string() },
  returns: v.null(),
  handler: async (ctx, { title, detail }) => {
    const user = await ctx.db.get(ctx.userId);
    await ctx.runMutation(internal.fixRequests.file, {
      source: `media buyer cockpit (${user?.email ?? "unknown"})`,
      app: "media-buyer",
      title: title.slice(0, 120),
      detail: detail.slice(0, 4000),
    });
    return null;
  },
});
