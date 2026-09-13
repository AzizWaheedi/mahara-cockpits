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

const USER_FIELDS = ["email", "name", "image", "phone"] as const;

/**
 * Save the user behind a sign-in, a sign-up code or a reset code.
 *
 * Mirrors Convex Auth's default: the provider's `emailVerified` /
 * `phoneVerified` flags become verification times (the users table has no
 * such flags, and passing them through made every reset and sign-up code
 * fail on 2026-09-13), and a new sign-in links to an existing user with the
 * same verified email. On top of that, a brand-new password account is only
 * created for someone an admin added in the portal.
 */
// biome-ignore lint/suspicious/noExplicitAny: Convex Auth callback shapes
export async function upsertTeamUser(ctx: any, args: any): Promise<any> {
  const profile = (args.profile ?? {}) as Record<string, unknown>;
  const email =
    typeof profile.email === "string"
      ? profile.email.trim().toLowerCase()
      : undefined;
  const data: Record<string, string | number> = {};
  for (const k of USER_FIELDS)
    if (typeof profile[k] === "string" && profile[k])
      data[k] = k === "email" && email ? email : (profile[k] as string);
  if (profile.emailVerified) data.emailVerificationTime = Date.now();
  if (profile.phoneVerified) data.phoneVerificationTime = Date.now();

  let userId = args.existingUserId ?? null;
  if (!userId && email) {
    const same = (
      await ctx.db
        .query("users")
        .withIndex("email", (q: any) => q.eq("email", email))
        .collect()
    ).filter((u: any) => u.emailVerificationTime !== undefined);
    if (same.length === 1) userId = same[0]._id;
  }
  if (!userId && args.provider?.id === "password") {
    const a = await accessFor(ctx, email);
    if (a.roles.length === 0)
      throw new Error(
        "This email is not on the team yet. Ask Aziz to add you in the portal, then sign up.",
      );
  }
  if (userId) {
    await ctx.db.patch(userId, data);
    return userId;
  }
  return await ctx.db.insert("users", data);
}

const DAY = 86400_000;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: configuredAuthProviders(),
  callbacks: {
    // Only a person an admin added in the portal may create a password
    // account; everything else is the library's own behaviour (see
    // upsertTeamUser).
    createOrUpdateUser: upsertTeamUser,
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
