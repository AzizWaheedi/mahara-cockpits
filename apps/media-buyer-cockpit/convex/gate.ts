import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { type Access, accessFor } from "./roles";

/**
 * The checks roles.ts does not cover: actions (which have no ctx.db), "any of
 * these roles", the signed-in person's email, and whether a campaign or client
 * is inside the client access set in the portal. Hiding a button is not the
 * lock; every public function that reads or writes goes through here or
 * through roles.ts.
 */

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
type Ctx = any;

const REFUSED =
  "This cockpit is not yours. Ask Aziz to give you access in the portal.";
const OUT_OF_SCOPE =
  "That client is not on your list. Ask Aziz to widen your client access in the portal.";

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

async function access(ctx: Ctx, userId: Id<"users">): Promise<Access> {
  const user = await ctx.db.get(userId);
  return await accessFor(ctx, user?.email, userId);
}

/** Any one of these roles opens the door; admin always does. */
export async function assertAnyRole(
  ctx: Ctx,
  roles: readonly string[],
): Promise<void> {
  const a = await access(ctx, ctx.userId);
  if (!(a.isAdmin || roles.some(r => a.roles.includes(r)))) {
    throw new Error(REFUSED);
  }
}

/**
 * The signed-in person's email, lower-cased. Convex Auth's JWT carries no
 * email claim (only "<userId>|<sessionId>"), so anything keyed on
 * getUserIdentity() was keyed on the session and reset at every sign-in.
 */
export async function emailOf(ctx: Ctx): Promise<string> {
  const user = await ctx.db.get(ctx.userId);
  const email = norm(user?.email);
  if (!email) throw new Error("Sign in first.");
  return email;
}

export type Scope = {
  campaignName?: string;
  clientName?: string;
  /** The normalised ClickUp tag the UI carries, e.g. "castelloindustries". */
  clientTag?: string;
  /** A Meta id from the tree; resolved to its campaign. */
  metaId?: string;
};

/** Client names (lower-cased) this person may see; null when unrestricted. */
function clientSet(a: Access): Set<string> | null {
  if (a.isAdmin || a.clients.length === 0) return null;
  return new Set(a.clients.map(c => c.toLowerCase()));
}

async function matches(
  ctx: Ctx,
  scope: Set<string>,
  s: Scope,
): Promise<boolean> {
  if (s.clientName && scope.has(norm(s.clientName))) return true;
  let campaignName = s.campaignName;
  if (!campaignName && s.metaId) {
    const node = await ctx.db
      .query("metaTree")
      .withIndex("by_meta", (q: Ctx) => q.eq("metaId", s.metaId))
      .first();
    campaignName = node?.campaignName;
  }
  if (!campaignName && !s.clientTag) return false;
  const campaigns = await ctx.db.query("campaigns").collect();
  const row = campaigns.find(
    (c: Ctx) =>
      (campaignName && c.campaignName === campaignName) ||
      (s.clientTag && c.clientTag === s.clientTag),
  );
  return Boolean(row && scope.has(norm(row.clientName ?? row.accountName)));
}

/** True when the person may touch this campaign or client. */
export async function inScope(ctx: Ctx, s: Scope): Promise<boolean> {
  const scope = clientSet(await access(ctx, ctx.userId));
  if (!scope) return true;
  return await matches(ctx, scope, s);
}

export async function assertScope(ctx: Ctx, s: Scope): Promise<void> {
  if (!(await inScope(ctx, s))) throw new Error(OUT_OF_SCOPE);
}

/**
 * A row filter for lists: keeps rows whose campaign or client is on the
 * person's list, everything for an unrestricted member. One read, then
 * cheap per row.
 */
export async function scopeFilter(
  ctx: Ctx,
): Promise<
  (row: {
    campaignName?: string;
    client?: string;
    clientName?: string;
  }) => boolean
> {
  const scope = clientSet(await access(ctx, ctx.userId));
  if (!scope) return () => true;
  const names = new Set<string>(
    (await ctx.db.query("campaigns").collect())
      .filter((c: Ctx) => scope.has(norm(c.clientName ?? c.accountName)))
      .map((c: Ctx) => c.campaignName),
  );
  return row =>
    (row.campaignName !== undefined && names.has(row.campaignName)) ||
    scope.has(norm(row.client ?? row.clientName));
}

/**
 * Actions have no ctx.db, so the same checks run as a query. Returns the
 * refusal text, or "" when the person may go ahead.
 */
export const check = internalQuery({
  args: {
    userId: v.id("users"),
    role: v.string(),
    campaignName: v.optional(v.string()),
    clientName: v.optional(v.string()),
    clientTag: v.optional(v.string()),
    metaId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { userId, role, ...s }) => {
    const a = await access(ctx, userId);
    if (!(a.isAdmin || a.roles.includes(role))) return REFUSED;
    const scope = clientSet(a);
    if (!scope) return "";
    if (!s.campaignName && !s.clientName && !s.clientTag && !s.metaId) {
      return "";
    }
    return (await matches(ctx, scope, s)) ? "" : OUT_OF_SCOPE;
  },
});

type ActionLike = { userId: Id<"users">; runQuery: ActionCtx["runQuery"] };

/** The refusal for an action, "" when allowed. */
export async function refusal(
  ctx: ActionLike,
  role: string,
  scope: Scope = {},
): Promise<string> {
  return await ctx.runQuery(internal.gate.check, {
    userId: ctx.userId,
    role,
    ...scope,
  });
}

/** Throw rather than act: the role check for actions. */
export async function assertRoleAction(
  ctx: ActionLike,
  role: string,
  scope: Scope = {},
): Promise<void> {
  const no = await refusal(ctx, role, scope);
  if (no) throw new Error(no);
}
