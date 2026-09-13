import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * One-off after Resend went live (2026-09-13): the password provider now
 * asks for email verification, and every account made before that counts
 * as unverified, so a correct password quietly sent a code instead of
 * signing the person in. The team's existing accounts are real people Aziz
 * added himself; mark them verified so they sign in as before.
 *   bunx convex run --prod verifyAccounts:markAll
 */
export const markAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    let n = 0;
    for (const a of await ctx.db.query("authAccounts").collect()) {
      if (a.provider !== "password" || a.emailVerified) continue;
      await ctx.db.patch(a._id, { emailVerified: a.providerAccountId });
      const user = await ctx.db.get(a.userId);
      if (user && !user.emailVerificationTime)
        await ctx.db.patch(a.userId, { emailVerificationTime: Date.now() });
      n++;
    }
    return n;
  },
});
