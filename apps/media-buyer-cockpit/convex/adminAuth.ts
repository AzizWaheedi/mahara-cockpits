import { modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

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
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id, secret: password },
    });
    return `password set for ${id}; they can sign in now`;
  },
});
