import { supabase } from "./supabase";

/**
 * Sign-in through the portal.
 *
 * Everyone signs in once at the media buyer app, which is the identity
 * provider for all four cockpits. It sends people here with a two-minute
 * `portal_token` in the address. The other cockpits swap that for a Convex
 * session inside their own backend; this one has no backend, so it posts the
 * pass to the portal, which verifies the signature it made and returns a
 * Supabase sign-in token. No password travels, and the browser never chooses
 * whose address it is asking about.
 */

const PORTAL_URL = "https://cockpit.maharamedia.com";
const PORTAL_SITE = "https://adorable-seahorse-418.convex.site";
const OWN_HOSTS = ["mahara-video-editor.vercel.app"];

export const COCKPIT = "editor";

export function portalUrl(): string {
  const env = (import.meta.env.VITE_PORTAL_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return PORTAL_URL;
  // Proxied under the portal's own domain: the portal is this origin.
  if (
    !OWN_HOSTS.includes(window.location.host) &&
    !window.location.host.startsWith("localhost")
  )
    return window.location.origin;
  return PORTAL_URL;
}

function portalSite(): string {
  const env = (
    import.meta.env.VITE_PORTAL_SITE_URL as string | undefined
  )?.trim();
  return (env || PORTAL_SITE).replace(/\/$/, "");
}

export interface PortalWho {
  email: string;
  name: string;
  roles: string[];
  cockpits: string[];
}

/** Swap the pass for a session. Throws with a sentence a person can act on. */
export async function signInWithPortalToken(token: string): Promise<PortalWho> {
  const res = await fetch(`${portalSite()}/portal/editor-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = (await res.json().catch(() => null)) as
    | ({
        ok: boolean;
        error?: string;
        token_hash?: string;
      } & Partial<PortalWho>)
    | null;
  if (!res.ok || !body?.ok || !body.token_hash)
    throw new Error(body?.error ?? `the portal answered ${res.status}`);

  const { error } = await supabase.auth.verifyOtp({
    token_hash: body.token_hash,
    type: "magiclink",
  });
  if (error) throw new Error(error.message);
  return {
    email: body.email ?? "",
    name: body.name ?? "",
    roles: body.roles ?? [],
    cockpits: body.cockpits ?? [],
  };
}

export interface AdPreview {
  ok: boolean;
  error?: string;
  /** Meta's own preview frame. Good for hours, not days. */
  src?: string;
  width?: number;
  height?: number;
  /** A picture we captured, which does not expire. */
  stillUrl?: string;
  thumbUrl?: string;
  /** Meta's own words when it will not render one. */
  reason?: string;
  message?: string;
}

/**
 * The Facebook preview of one winning ad.
 *
 * Meta's preview links die within a day, which is why none is stored. The
 * media buyer deployment fetches a fresh one on demand; this asks it, proving
 * who is asking with the Supabase session the cockpit already holds.
 */
export async function adPreview(
  adId: string,
  format?: string,
): Promise<AdPreview> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in again to load previews." };
  try {
    const res = await fetch(`${portalSite()}/portal/editor-preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ adId, format }),
    });
    const body = (await res.json().catch(() => null)) as AdPreview | null;
    if (!res.ok || !body?.ok)
      return {
        ok: false,
        error: body?.error ?? `the portal answered ${res.status}`,
      };
    return body;
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

/** Where to send someone who needs a pass. */
export function portalDoor(next: string): string {
  return `${portalUrl()}/go/${COCKPIT}?next=${encodeURIComponent(next)}`;
}

/** The other cockpits this person may open, for the switcher. */
export function otherCockpits(cockpits: string[], isAdmin: boolean) {
  const portal = portalUrl();
  return [
    { key: "admin", label: "Admin", href: `${portal}/admin`, show: isAdmin },
    {
      key: "media_buyer",
      label: "Media buyer",
      href: `${portal}/dashboard`,
      show: isAdmin || cockpits.includes("media_buyer"),
    },
    {
      key: "csm",
      label: "Client success",
      href: `${portal}/go/csm`,
      show: isAdmin || cockpits.includes("csm"),
    },
    {
      key: "creative",
      label: "Creative director",
      href: `${portal}/go/creative`,
      show: isAdmin || cockpits.includes("creative"),
    },
  ].filter(d => d.show);
}
