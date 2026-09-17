import {
  createAccount,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Set or create a password account from the CLI, the way the media buyer's
 * adminAuth does. Used to seed a sign-in on a dev deployment and as the way
 * back in when the reset email cannot be sent:
 *
 *   bunx convex run adminAuth:setPassword '{"email":"…","password":"…"}'
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
      return `password set for ${id}`;
    } catch {
      await createAccount(ctx, {
        provider: "password",
        account: { id, secret: password },
        profile: { email: id, emailVerificationTime: Date.now() },
        shouldLinkViaEmail: true,
      });
      return `password created for ${id}`;
    }
  },
});
