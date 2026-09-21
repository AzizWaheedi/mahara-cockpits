import { v } from "convex/values";
import { isCeoEmail } from "./ceo/gate";
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
  "aziz@maharamedia.com": [
    "ceo",
    "admin",
    "media_buyer",
    "csm",
    "creative",
    "editor",
  ],
  "awaheedi2008@gmail.com": [
    "ceo",
    "admin",
    "media_buyer",
    "csm",
    "creative",
    "editor",
  ],
  "nada@maharamedia.com": ["media_buyer"],
  "abdulelah@maharamedia.com": ["csm"],
  "abdu@maharamedia.com": ["csm"],
  // The one editor on the Video Pipeline board (Aziz, 2026-09-18).
  "karim@maharamedia.com": ["editor"],
};

export const COCKPITS = ["media_buyer", "csm", "creative", "editor"] as const;

/** Where each role lands. The portal routes the other three to their own apps. */
const HOME: Record<string, string> = {
  ceo: "/ceo",
  admin: "/admin",
  media_buyer: "/dashboard",
  csm: "/go/csm",
  creative: "/go/creative",
  editor: "/go/editor",
};

/** The fallback directory as rows, for the pushes that leave this deployment. */
export function staticPeople(): {
  email: string;
  name: string;
  roles: string[];
}[] {
  return Object.entries(STATIC).map(([email, roles]) => ({
    email,
    name: "",
    roles,
  }));
}

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
  isCeo: boolean;
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
  // The CEO section is its own role now, so it can be given to somebody who
  // should see the business and nothing else. The two founder addresses keep
  // working through the old email list whatever the members table says, so
  // nobody can lock Aziz out of his own numbers by editing a row.
  const isCeo = roles.includes("ceo") || isCeoEmail(key);
  const cockpits = isAdmin
    ? [...COCKPITS]
    : COCKPITS.filter(c => roles.includes(c));
  // Land on the business before the admin screen, and on the admin screen
  // before a working cockpit.
  const first = isCeo
    ? "ceo"
    : isAdmin
      ? "admin"
      : (roles.find(r => HOME[r]) ?? null);
  return {
    email: key,
    name: row?.name,
    roles,
    clients: row?.clients ?? [],
    isAdmin,
    isCeo,
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
      /** One of the founder addresses, whatever the roles say: the changes-and-bugs queue shows only for them. */
      isFounder: isCeoEmail(String(user?.email ?? "")),
      isCeo: a.isCeo,
      home: a.home,
    };
  },
});
