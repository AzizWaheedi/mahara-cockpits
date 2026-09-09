declare const process: { env: Record<string, string | undefined> };

// Deployment env values left behind by the pre-v2 template. The deploy
// pipeline pre-syncs VIKTOR_SPACES_ACCESS_MODE to the v2 mode *before*
// `convex deploy`, so a correctly-run upgrade never analyzes these modules
// with a stale legacy value. This set is the belt-and-suspenders fallback:
// if that pre-sync is ever skipped or fails, treat legacy values as "auth
// enabled" so the push doesn't crash. The strict v2 validation below still
// rejects anything genuinely unknown.
const TRANSIENT_LEGACY_ACCESS_MODES = new Set(["space_auth", "viktor_auth"]);

export function configuredProductAuthEnabled(): boolean {
  const configured =
    process.env.VIKTOR_SPACES_ACCESS_MODE ||
    process.env.VITE_VIKTOR_SPACES_ACCESS_MODE;
  if (configured === "authenticated") return true;
  if (configured === "public") return false;
  if (configured && TRANSIENT_LEGACY_ACCESS_MODES.has(configured)) return true;

  if (!configured) {
    throw new Error(
      "Missing required Viktor Spaces env var: VIKTOR_SPACES_ACCESS_MODE",
    );
  }
  throw new Error(`Invalid VIKTOR_SPACES_ACCESS_MODE: ${configured}`);
}
