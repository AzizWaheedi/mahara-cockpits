import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import {
  createAccount,
  invalidateSessions,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * Sign-in through the portal.
 *
 * The portal (the media buyer deployment) is the identity provider for every
 * cockpit. It mints a two-minute RS256 token for a person who is signed in
 * there; this provider verifies it against the portal's published JWKS,
 * links or creates the account (by verified email, so someone who already
 * had a password here keeps one user), and remembers the roles and client
 * access the portal sent. No password ever passes through this app.
 */

declare const process: { env: Record<string, string | undefined> };

const PORTAL_SITE_URL =
  process.env.PORTAL_SITE_URL || "https://adorable-seahorse-418.convex.site";
const AUDIENCE = "mahara-portal";
const jwks = createRemoteJWKSet(
  new URL(`${PORTAL_SITE_URL}/.well-known/jwks.json`),
);

const provider = ConvexCredentials<DataModel>({
  id: "portal",
  authorize: async (params, ctx) => {
    const token = String(params.token ?? "");
    if (!token) throw new Error("Missing portal token");
    const { payload } = await jwtVerify(token, jwks, {
      issuer: PORTAL_SITE_URL,
      audience: AUDIENCE,
    });
    if (payload.cockpit !== "creative")
      throw new Error("This pass is for a different cockpit");
    const email = String(payload.email ?? payload.sub ?? "")
      .trim()
      .toLowerCase();
    if (!email.includes("@")) throw new Error("Portal token has no email");
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    const clients = Array.isArray(payload.clients)
      ? payload.clients.map(String)
      : [];
    const name = payload.name ? String(payload.name) : undefined;
    await ctx.runMutation(internal.portalAuth.remember, {
      email,
      name,
      roles,
      clients,
    });
    try {
      const existing = await retrieveAccount(ctx, {
        provider: "portal",
        account: { id: email },
      });
      return { userId: existing.user._id };
    } catch {
      // First time through the portal: create it below.
    }
    const { user } = await createAccount(ctx, {
      provider: "portal",
      account: { id: email },
      profile: name
        ? { email, name, emailVerificationTime: Date.now() }
        : { email, emailVerificationTime: Date.now() },
      // Same verified email as an existing password account: one user.
      shouldLinkViaEmail: true,
    });
    return { userId: user._id };
  },
});

export const remember = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    roles: v.array(v.string()),
    clients: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("portalMembers")
      .withIndex("by_email", q => q.eq("email", args.email))
      .unique();
    const doc = { ...args, at: Date.now() };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("portalMembers", doc);
    return null;
  },
});

// ConvexCredentials hard-codes the top-level id to "credentials"; surface ours.
export const PortalCredentials = { ...provider, id: "portal" };

/** The portal removed this person: forget them here and end their sessions. */
export const forget = internalMutation({
  args: { email: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, { email }) => {
    const key = email.trim().toLowerCase();
    const row = await ctx.db
      .query("portalMembers")
      .withIndex("by_email", q => q.eq("email", key))
      .unique();
    if (row) await ctx.db.delete(row._id);
    const user = await ctx.db
      .query("users")
      .withIndex("email", q => q.eq("email", key))
      .first();
    return user?._id ?? null;
  },
});

export const revoke = internalAction({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const userId = await ctx.runMutation(internal.portalAuth.forget, { email });
    // Sessions end now, not at their natural expiry a year on.
    if (userId) await invalidateSessions(ctx, { userId });
    return null;
  },
});
