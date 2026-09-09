// PHI console redaction (active only on PHI deployments) — imported first
// so the auth library's own logging is shimmed too.
import "./phiLogging";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { configuredAuthProviders } from "./viktorSpaceAuthConfig";

declare const process: { env: Record<string, string | undefined> };

function decodePrivateKey(key: string | undefined): string | undefined {
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
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: configuredAuthProviders(),
});

export const currentUser = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});
