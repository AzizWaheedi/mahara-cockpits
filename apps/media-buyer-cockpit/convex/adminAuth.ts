import {
  createAccount,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { upsertTeamUser } from "./auth";

/**
 * Reset someone's password from the CLI. There is no mail transport on this
 * deployment (no RESEND_API_KEY), so "Forgot password" cannot email a code;
 * this is the way back in. Aziz runs, then tells the person to sign in and
 * change it under Settings:
 *
 *   bunx convex run --prod adminAuth:setPassword '{"email":"nada@maharamedia.com","password":"..."}'
 */
export const setPassword = internalAction({
  args: { email: v.string(), password: v.string() },
  returns: v.string(),
  handler: async (ctx, { email, password }) => {
    if (password.length < 8) throw new Error("Use at least 8 characters.");
    const id = email.trim().toLowerCase();
    try {
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: { id, secret: password },
      });
      return `password set for ${id}; they can sign in now`;
    } catch {
      // No password account yet (they only ever came in through a portal
      // pass): create one, linked to their existing user by email.
      await createAccount(ctx, {
        provider: "password",
        account: { id, secret: password },
        profile: { email: id, emailVerificationTime: Date.now() },
        shouldLinkViaEmail: true,
      });
      return `password created for ${id}; they can sign in now`;
    }
  },
});

/**
 * Self-test for the sign-in save step, with no lasting effect: it runs the
 * exact save a reset or sign-up code triggers, then throws, and Convex rolls
 * the whole mutation back. "ROLLED BACK OK" means the save would succeed.
 *   bunx convex run --prod adminAuth:dryRunUpsert '{"email":"nada@maharamedia.com"}'
 */
export const dryRunUpsert = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { email, name }) => {
    const key = email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", q => q.eq("email", key))
      .first();
    const acct = user
      ? await ctx.db
          .query("authAccounts")
          .withIndex("userIdAndProvider", q =>
            q.eq("userId", user._id).eq("provider", "password"),
          )
          .unique()
      : null;
    await upsertTeamUser(ctx, {
      existingUserId: acct?.userId ?? null,
      provider: { id: "password", type: "credentials" },
      type: "credentials",
      profile: { email: key, emailVerified: true, ...(name ? { name } : {}) },
    });
    throw new Error(
      `ROLLED BACK OK: ${acct ? "existing account updated" : user ? "linked to existing user" : "new user created"}`,
    );
  },
});
