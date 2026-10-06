import type { SupabaseAccess } from "./supabaseAccess";

const COCKPIT_PATHS: Record<string, string> = {
  csm: "/client-success",
  creative: "/creative",
  editor: "/editor",
  sales: "/sales",
  media_buyer: "",
};

/** Same-origin navigation uses the project's persisted Auth session, never URL credentials. */
export function cockpitSwitchPath(access: SupabaseAccess | null, cockpit: string, next = "/dashboard"): string {
  if (!Object.hasOwn(COCKPIT_PATHS, cockpit)) throw new Error("That cockpit does not exist.");
  if (!access || !(access.isAdmin || access.isCeo || access.cockpits.includes(cockpit))) {
    throw new Error("That cockpit is not on your access. Ask Aziz.");
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    throw new Error("That destination is not a cockpit path. Open the cockpit from the portal.");
  }
  const destination = new URL(next, "https://cockpit.invalid");
  if (destination.hash || ["portal_token", "access_token", "refresh_token", "token_hash"].some(key => destination.searchParams.has(key))) {
    throw new Error("Sign-in tokens cannot be used in cockpit navigation. Sign in directly instead.");
  }
  return `${COCKPIT_PATHS[cockpit]}${destination.pathname}${destination.search}`;
}
