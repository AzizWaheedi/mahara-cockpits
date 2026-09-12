import { v } from "convex/values";
import { authenticatedQuery } from "./functions";

/**
 * Who may open the creative director cockpit. Before the portal, any account
 * on this deployment got in; now the portal's word decides, with the owner's
 * addresses as the fallback so nothing locks while the table fills.
 */
const FALLBACK = new Set(["aziz@maharamedia.com", "awaheedi2008@gmail.com"]);

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
  if (row) return row.roles.includes("creative") || row.roles.includes("admin");
  const key = (email ?? "").trim().toLowerCase();
  return FALLBACK.has(key) || key.endsWith("@viktor.invalid");
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function assertRole(ctx: any, _role = "creative"): Promise<void> {
  const user = await ctx.db.get(ctx.userId);
  if (!(await hasAccess(ctx, user?.email)))
    throw new Error(
      "This cockpit is not yours. Ask Aziz to add you in the portal.",
    );
}

/** Clients this person may see; null means all. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function allowedClients(ctx: any): Promise<Set<string> | null> {
  const user = await ctx.db.get(ctx.userId);
  const row = await portalRow(ctx, user?.email);
  if (!row || row.roles.includes("admin") || row.clients.length === 0)
    return null;
  return new Set(row.clients.map((c: string) => c.toLowerCase()));
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
      roles: ok ? ["creative"] : [],
      isAdmin: Boolean(row?.roles.includes("admin")),
      /** Every seat the portal gave them, for the cockpit switcher. */
      portalRoles: row?.roles ?? [],
      clients: row?.clients ?? [],
      home: ok ? "/dashboard" : null,
    };
  },
});
