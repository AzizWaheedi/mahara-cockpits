import { v } from "convex/values";
import { authenticatedQuery } from "./functions";

/**
 * This app is the Client Success cockpit and nothing else. There is no media buyer
 * screen here to reach, by design: a separate app, a separate link, separate access.
 */
const ALLOWED = new Set([
  "aziz@maharamedia.com",
  "awaheedi2008@gmail.com",
  "abdulelah@maharamedia.com",
  "abdu@maharamedia.com",
]);

export function allowed(email: string | undefined | null): boolean {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return false;
  // Platform-minted space sessions (screenshot runner, e2e) sit behind the app gate.
  return ALLOWED.has(key) || key.endsWith("@viktor.invalid");
}

/** The portal's word on this person, if they came through it. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
async function portalRow(ctx: any, email: string | undefined | null) {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return null;
  return await ctx.db
    .query("portalMembers")
    .withIndex("by_email", (q: any) => q.eq("email", key))
    .unique();
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function hasAccess(
  ctx: any,
  email: string | undefined | null,
): Promise<boolean> {
  const row = await portalRow(ctx, email);
  if (row) return row.roles.includes("csm") || row.roles.includes("admin");
  return allowed(email);
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function assertRole(ctx: any, _role = "csm"): Promise<void> {
  const user = await ctx.db.get(ctx.userId);
  if (!(await hasAccess(ctx, user?.email))) {
    throw new Error(
      "This cockpit is not yours. Ask Aziz to add you in the portal.",
    );
  }
}

/** Clients this person may see; null means all. Set in the portal's admin view. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function allowedClients(ctx: any): Promise<Set<string> | null> {
  const user = await ctx.db.get(ctx.userId);
  const row = await portalRow(ctx, user?.email);
  if (!row || row.roles.includes("admin") || row.clients.length === 0)
    return null;
  return new Set(row.clients.map((c: string) => c.toLowerCase()));
}

/** The signed-in user's email, lowercased. Used to key their own income plan. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function userEmail(ctx: any): Promise<string> {
  const user = await ctx.db.get(ctx.userId);
  return (user?.email ?? "unknown").trim().toLowerCase();
}

export const me = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const user = await ctx.db.get(ctx.userId);
    const ok = await hasAccess(ctx, user?.email);
    const row = await portalRow(ctx, user?.email);
    return {
      email: user?.email ?? null,
      name: user?.name ?? row?.name ?? null,
      roles: ok ? ["csm"] : [],
      isAdmin: Boolean(row?.roles.includes("admin")),
      /** Every seat the portal gave them, for the cockpit switcher. */
      portalRoles: row?.roles ?? [],
      clients: row?.clients ?? [],
      home: ok ? "/dashboard" : null,
    };
  },
});
