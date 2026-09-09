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

// biome-ignore lint/suspicious/noExplicitAny: convex ctx
export async function assertRole(ctx: any, _role = "csm"): Promise<void> {
  const user = await ctx.db.get(ctx.userId);
  if (!allowed(user?.email)) {
    throw new Error("This cockpit is not yours. Ask your manager for access.");
  }
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
    const ok = allowed(user?.email);
    return {
      email: user?.email ?? null,
      name: user?.name ?? null,
      roles: ok ? ["csm"] : [],
      home: ok ? "/dashboard" : null,
    };
  },
});
