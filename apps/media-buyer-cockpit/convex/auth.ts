// PHI console redaction (active only on PHI deployments) — imported first
// so the auth library's own logging is shimmed too.
import "./phiLogging";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { accessFor } from "./roles";
import { configuredAuthProviders } from "./viktorSpaceAuthConfig";

declare const process: { env: Record<string, string | undefined> };

export function decodePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.includes("\n")) return key;
  if (key.startsWith("-----BEGIN")) {
    return key
      .replace("-----BEGIN PRIVATE KEY----- ", "-----BEGIN PRIVATE KEY-----\n")
      .replace(" -----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----")
      .split(" ")
      .join("\n");
  }
  try {
    return atob(key);
  } catch {
    return key;
  }
}

const authPrivateKey = process.env.AUTH_PRIVATE_KEY;
if (authPrivateKey) {
  process.env.AUTH_PRIVATE_KEY = decodePrivateKey(authPrivateKey);
}

const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
if (jwtPrivateKey) {
  process.env.JWT_PRIVATE_KEY = decodePrivateKey(jwtPrivateKey);
}

// Providers are resolved from the space's configured provider list
// (email_password / viktor) plus the `space_session` exchange used by
// automation and authenticated-screenshot capture. See viktorSpaceAuthConfig.ts.
const DAY = 86400_000;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: configuredAuthProviders(),
  callbacks: {
    /**
     * Only a person an admin added in the portal may create a password
     * account, so nobody can claim a colleague's seat by typing their email
     * first. Existing users and portal passes are unaffected.
     */
    async createOrUpdateUser(ctx, args) {
      const email = String(args.profile.email ?? "")
        .trim()
        .toLowerCase();
      if (!args.existingUserId && args.provider.id === "password") {
        const a = await accessFor(ctx, email);
        if (a.roles.length === 0)
          throw new Error(
            "This email is not on the team yet. Ask Aziz to add you in the portal, then sign up.",
          );
      }
      if (args.existingUserId) {
        await ctx.db.patch(args.existingUserId, { ...args.profile, email });
        return args.existingUserId;
      }
      return await ctx.db.insert("users", { ...args.profile, email });
    },
  },
  // Aziz, 2026-09-12: "make sure she doesn't get logged out again". A
  // session lasts a year and only lapses after 90 days without a visit.
  session: { totalDurationMs: 365 * DAY, inactiveDurationMs: 90 * DAY },
});

export const currentUser = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});
