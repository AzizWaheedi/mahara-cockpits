import { v } from "convex/values";
import { authenticatedQuery } from "./functions";

/**
 * Who may open which cockpit.
 *
 * The `members` table (edited in the portal's admin view) is the directory.
 * The static map below is the fallback for the handful of people who were
 * set up before the portal existed, so nothing breaks if the table is empty.
 * Enforced on the server: hiding a menu is not the lock.
 */
const STATIC: Record<string, string[]> = {
  "aziz@maharamedia.com": ["admin", "media_buyer", "csm", "creative"],
  "awaheedi2008@gmail.com": ["admin", "media_buyer", "csm", "creative"],
  "nada@maharamedia.com": ["media_buyer"],
  "abdulelah@maharamedia.com": ["csm"],
  "abdu@maharamedia.com": ["csm"],
};

export const COCKPITS = ["media_buyer", "csm", "creative"] as const;

/** Where each role lands. The portal routes csm and creative to their own apps. */
const HOME: Record<string, string> = {
  admin: "/admin",
  media_buyer: "/dashboard",
  csm: "/go/csm",
  creative: "/go/creative",
};

export function staticRoles(email: string | undefined | null): string[] {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return [];
  if (STATIC[key]) return STATIC[key];
  return [];
}

/**
 * Platform-minted space sessions (screenshot runner, e2e) carry a synthetic
 * @viktor.invalid address. Only an account the space_session provider itself
 * created gets a view; someone who signs up with such an address gets nothing.
 */
// biome-ignore lint/suspicious/noExplicitAny: db ctx
async function spaceSessionRoles(ctx: any, userId: any): Promise<string[]> {
  if (!userId) return [];
  const acct = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q: any) =>
      q.eq("userId", userId).eq("provider", "space_session"),
    )
    .unique();
  return acct ? ["media_buyer", "csm"] : [];
}

export type Access = {
  email: string;
  name?: string;
  roles: string[];
  clients: string[];
  isAdmin: boolean;
  cockpits: string[];
  home: string | null;
};

/** The member row first, the static map second. */
// biome-ignore lint/suspicious/noExplicitAny: db ctx
export async function accessFor(
  ctx: any,
  email: string | null | undefined,
  userId?: any,
): Promise<Access> {
  const key = (email ?? "").trim().toLowerCase();
  const row = key
    ? await ctx.db
        .query("members")
        .withIndex("by_email", (q: any) => q.eq("email", key))
        .unique()
    : null;
  const roles: string[] = row
    ? row.roles
    : key.endsWith("@viktor.invalid")
      ? await spaceSessionRoles(ctx, userId)
      : staticRoles(key);
  const isAdmin = roles.includes("admin");
  const cockpits = isAdmin
    ? [...COCKPITS]
    : COCKPITS.filter(c => roles.includes(c));
  const first = isAdmin ? "admin" : (roles.find(r => HOME[r]) ?? null);
  return {
    email: key,
    name: row?.name,
    roles,
    clients: row?.clients ?? [],
    isAdmin,
    cockpits,
    home: first ? HOME[first] : null,
  };
}

/** Throw rather than return an empty screen, so a wrong link is unmistakable. */
export async function assertRole(
  // biome-ignore lint/suspicious/noExplicitAny: convex ctx
  ctx: any,
  role: string,
): Promise<void> {
  const user = await ctx.db.get(ctx.userId);
  const a = await accessFor(ctx, user?.email, ctx.userId);
  if (!(a.isAdmin || a.roles.includes(role))) {
    throw new Error(
      "This cockpit is not yours. Ask Aziz to give you access in the portal.",
    );
  }
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function assertAdmin(ctx: any): Promise<Access> {
  const user = await ctx.db.get(ctx.userId);
  const a = await accessFor(ctx, user?.email, ctx.userId);
  if (!a.isAdmin) throw new Error("Admins only.");
  return a;
}

/** Clients this person may see; empty means all. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function allowedClients(ctx: any): Promise<Set<string> | null> {
  const user = await ctx.db.get(ctx.userId);
  const a = await accessFor(ctx, user?.email, ctx.userId);
  if (a.isAdmin || a.clients.length === 0) return null;
  return new Set(a.clients.map(c => c.toLowerCase()));
}

export const me = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const user = await ctx.db.get(ctx.userId);
    const a = await accessFor(ctx, user?.email, ctx.userId);
    return {
      email: user?.email ?? null,
      name: user?.name ?? a.name ?? null,
      roles: a.roles,
      cockpits: a.cockpits,
      clients: a.clients,
      isAdmin: a.isAdmin,
      home: a.home,
    };
  },
});
