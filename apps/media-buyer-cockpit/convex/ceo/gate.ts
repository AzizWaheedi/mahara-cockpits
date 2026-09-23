/**
 * Who may open the CEO cockpit.
 *
 * Aziz, 2026-09-22: "Make sure the CEO cockpit is only accessible to Aziz.
 * Even admins can't assign themselves the CEO position."
 *
 * So there is exactly one way in and it is not a database row: the address
 * on the signed-in account has to be one of the two founder addresses below.
 * A `ceo` role in the members table grants nothing, an admin cannot write one
 * (the portal already refuses the word), and nobody can give themselves the
 * money, payroll and client numbers by editing a row. Checked on the server
 * every time; hiding a menu is not the lock.
 *
 * Widening this is a code change, a commit and a deploy, which is the point.
 */
/** Aziz's two addresses. Nothing else opens the CEO cockpit. */
export const CEO_EMAILS = ["aziz@maharamedia.com", "awaheedi2008@gmail.com"];

export function isCeoEmail(email: string | undefined | null): boolean {
  return CEO_EMAILS.includes((email ?? "").trim().toLowerCase());
}

// biome-ignore lint/suspicious/noExplicitAny: convex ctx with userId
export async function requireCeo(ctx: any): Promise<string> {
  const user = await ctx.db.get(ctx.userId);
  const email = String(user?.email ?? "").toLowerCase();
  if (isCeoEmail(email)) return email;
  throw new Error(
    "The CEO cockpit is Aziz's own. Nothing here can be granted to another account.",
  );
}
