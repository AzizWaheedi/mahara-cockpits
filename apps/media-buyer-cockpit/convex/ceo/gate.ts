/**
 * Who may open the CEO cockpit.
 *
 * Two ways in, and both are checked on the server: hiding a menu is not the
 * lock. Money, team and client numbers all sit behind this.
 *
 * The `ceo` role in the members table is the way to give somebody the business
 * view and nothing else. The two founder addresses below always pass whatever
 * that table says, so no edit to a row can lock Aziz out of his own numbers.
 */
export const CEO_EMAILS = ["aziz@maharamedia.com", "awaheedi2008@gmail.com"];

export function isCeoEmail(email: string | undefined | null): boolean {
  return CEO_EMAILS.includes((email ?? "").trim().toLowerCase());
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx with userId
export async function requireCeo(ctx: any): Promise<string> {
  const user = await ctx.db.get(ctx.userId);
  const email = String(user?.email ?? "").toLowerCase();
  if (isCeoEmail(email)) return email;
  const row = email
    ? await ctx.db
        .query("members")
        // biome-ignore lint/suspicious/noExplicitAny: index builder
        .withIndex("by_email", (q: any) => q.eq("email", email))
        .unique()
    : null;
  if ((row?.roles ?? []).includes("ceo")) return email;
  throw new Error("The CEO cockpit needs the CEO role.");
}
