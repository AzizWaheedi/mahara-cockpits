/**
 * What is wrong with the Supabase address and key a build carries, as one
 * sentence, or null when they are right. The build refuses to finish on a
 * problem (vite.config.ts) and the page says it instead of opening blank
 * (supabase.ts).
 *
 * 2026-09-24: both values reached Vercel as Vercel's own ciphertext. The
 * build passed, every deploy check said yes, and the cockpit opened on an
 * empty page because the client threw before anything was drawn.
 */
export function supabaseEnvProblem(
  url: string | undefined,
  key: string | undefined,
): string | null {
  if (!url || !key)
    return "This build has no Supabase address or key (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).";
  const project = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url)?.[1];
  if (!project)
    return `VITE_SUPABASE_URL is not a Supabase project address (it begins "${url.slice(0, 12)}").`;
  if (key.startsWith("sb_publishable_")) return null;
  if (key.startsWith("sb_secret_"))
    return "VITE_SUPABASE_ANON_KEY is a secret key. The browser only ever gets the anon key.";
  const claims = jwtClaims(key);
  if (!claims) return "VITE_SUPABASE_ANON_KEY is not a Supabase key.";
  if (claims.role !== "anon")
    return `VITE_SUPABASE_ANON_KEY is a ${String(claims.role ?? "roleless")} key. The browser only ever gets the anon key.`;
  if (claims.ref && claims.ref !== project)
    return "VITE_SUPABASE_ANON_KEY belongs to a different Supabase project than VITE_SUPABASE_URL.";
  return null;
}

function jwtClaims(key: string): Record<string, unknown> | null {
  const parts = key.split(".");
  if (parts.length !== 3 || !key.startsWith("eyJ")) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)),
    );
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}
