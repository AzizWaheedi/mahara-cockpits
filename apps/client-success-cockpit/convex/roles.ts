import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
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
  // No suffix shortcuts: nothing on this deployment mints the old
  // platform (`@viktor.invalid`) sessions, and the smoke check needs no user.
  return ALLOWED.has(key);
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
  if (row)
    return (
      !row.revokedAt &&
      (row.roles.includes("csm") || row.roles.includes("admin"))
    );
  return allowed(email);
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function assertRole(ctx: any, _role = "csm"): Promise<void> {
  const user = await ctx.db.get(ctx.userId);
  if (!(await hasAccess(ctx, user?.email))) {
    throw new Error(
      "Your cockpit access has ended or has not been granted. Ask an admin to check your access.",
    );
  }
}

/** Clients this person may see; null means all. Set in the portal's admin view. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function allowedClients(ctx: any): Promise<Set<string> | null> {
  await assertRole(ctx);
  const user = await ctx.db.get(ctx.userId);
  const row = await portalRow(ctx, user?.email);
  if (!row || row.roles.includes("admin") || row.clients.length === 0)
    return null;
  return new Set(row.clients.map((c: string) => c.trim().toLowerCase()));
}

/**
 * Whether the signed-in person is the CEO, by the flag the portal signed
 * into their pass (portalAuth). Nothing typed into this app can set it.
 */
export async function isCeo(ctx: any): Promise<boolean> {
  const user = await ctx.db.get(ctx.userId);
  const row = await portalRow(ctx, user?.email);
  return Boolean(row?.isCeo && !row.revokedAt);
}

/**
 * Who is asking, in one read: their address, the portal's CEO flag, whether
 * the portal made them an admin, and the clients they may see (null: all).
 */
export async function seatOf(ctx: any): Promise<{
  email: string;
  isCeo: boolean;
  isAdmin: boolean;
  scope: Set<string> | null;
}> {
  const user = await ctx.db.get(ctx.userId);
  const email = String(user?.email ?? "unknown")
    .trim()
    .toLowerCase();
  const row = await portalRow(ctx, email);
  const live = Boolean(row && !row.revokedAt);
  return {
    email,
    isCeo: live && Boolean(row?.isCeo),
    isAdmin: live && Boolean(row?.roles.includes("admin")),
    scope: await allowedClients(ctx),
  };
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
      isAdmin: Boolean(!row?.revokedAt && row?.roles.includes("admin")),
      isCeo: Boolean(row?.isCeo && !row.revokedAt),
      /** Every seat the portal gave them, for the cockpit switcher. */
      portalRoles: row?.revokedAt ? [] : (row?.roles ?? []),
      clients: row?.clients ?? [],
      /** When the portal last told us about them; stale rows are refreshed through the portal. */
      memberAt: row?.at ?? null,
      home: ok ? "/dashboard" : null,
    };
  },
});

/** Resolve identity on the server. A display name never authorizes a different task ID. */
export async function requireClient(
  ctx: any,
  input: { taskId?: string; clientName?: string },
) {
  await assertRole(ctx);
  const rows = input.taskId
    ? await ctx.db
        .query("clients")
        .withIndex("by_taskId", (q: any) => q.eq("taskId", input.taskId))
        .collect()
    : (await ctx.db.query("clients").collect()).filter(
        (c: any) =>
          c.name.trim().toLowerCase() ===
          input.clientName?.trim().toLowerCase(),
      );
  const scope = await allowedClients(ctx);
  const client = rows.length === 1 ? rows[0] : null;
  if (
    !client ||
    (scope && !scope.has(client.name.trim().toLowerCase())) ||
    (input.clientName &&
      client.name.trim().toLowerCase() !==
        input.clientName.trim().toLowerCase())
  )
    throw new Error(
      "That client is not on your list. Reopen the client and try again.",
    );
  return client;
}

/** Actions cannot read the database directly. This is their server-owned access context. */
export const actionSeat = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const auth = { ...ctx, userId };
    await assertRole(auth);
    const seat = await seatOf(auth);
    const clients = (await ctx.db.query("clients").collect())
      .filter(c => !seat.scope || seat.scope.has(c.name.trim().toLowerCase()))
      .map(c => ({ taskId: c.taskId, name: c.name }));
    return { email: seat.email, isAdmin: seat.isAdmin, clients };
  },
});
