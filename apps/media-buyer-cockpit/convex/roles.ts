import { v } from "convex/values";
import { authenticatedQuery } from "./functions";

/**
 * Who may open which cockpit. Aziz's rule: the two cockpits are never one link and
 * never one view — a media buyer must not see client success, and the CSM must not
 * see ad accounts. Enforced here on the server, so hiding the menu is not the lock.
 */
const ROLES: Record<string, string[]> = {
  "aziz@maharamedia.com": ["media_buyer", "csm"],
  "awaheedi2008@gmail.com": ["media_buyer", "csm"],
  "nada@maharamedia.com": ["media_buyer"],
  "abdulelah@maharamedia.com": ["csm"],
  "abdu@maharamedia.com": ["csm"],
};

const HOME: Record<string, string> = {
  media_buyer: "/dashboard",
  csm: "/csm",
};

export function rolesForEmail(email: string | undefined | null): string[] {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return [];
  if (ROLES[key]) return ROLES[key];
  // Platform-minted space sessions (screenshot runner, e2e) are not real people and
  // only exist behind the app's own access gate; they get the owner's view.
  if (key.endsWith("@viktor.invalid")) return ["media_buyer", "csm"];
  return [];
}

/** Throw rather than return an empty screen, so a wrong link is unmistakable. */
export async function assertRole(
  // biome-ignore lint/suspicious/noExplicitAny: convex ctx
  ctx: any,
  role: string,
): Promise<void> {
  const user = await ctx.db.get(ctx.userId);
  const allowed = rolesForEmail(user?.email);
  if (!allowed.includes(role)) {
    throw new Error(
      "This cockpit is not yours. Each role has its own link — ask Aziz for the right one.",
    );
  }
}

export const me = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const user = await ctx.db.get(ctx.userId);
    const roles = rolesForEmail(user?.email);
    return {
      email: user?.email ?? null,
      name: user?.name ?? null,
      roles,
      home: roles.length > 0 ? HOME[roles[0]] : null,
    };
  },
});
