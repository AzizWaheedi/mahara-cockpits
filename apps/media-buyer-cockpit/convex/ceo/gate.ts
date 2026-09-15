/**
 * Who may open the CEO cockpit (decision 1 default, CEO_COCKPIT_PLAN.md):
 * Aziz's two addresses only. Enforced on the server; hiding the menu is not
 * the lock. Money, team and client numbers all sit behind this.
 */
export const CEO_EMAILS = ["aziz@maharamedia.com", "awaheedi2008@gmail.com"];

export function isCeoEmail(email: string | undefined | null): boolean {
  return CEO_EMAILS.includes((email ?? "").trim().toLowerCase());
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx with userId
export async function requireCeo(ctx: any): Promise<string> {
  const user = await ctx.db.get(ctx.userId);
  const email = String(user?.email ?? "").toLowerCase();
  if (!isCeoEmail(email)) throw new Error("The CEO cockpit is Aziz's only.");
  return email;
}
