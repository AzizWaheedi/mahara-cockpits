import { supabase } from "./supabase";

/**
 * Sign-in through the portal.
 *
 * Everyone signs in once at the media buyer app, which is the identity
 * provider for every cockpit. It sends people here with a two-minute
 * `portal_token` in the address. The other cockpits swap that for a Convex
 * session inside their own backend; this one has no backend, so it posts the
 * pass to the portal, which verifies the signature it made and returns a
 * Supabase sign-in token. No password travels, and the browser never chooses
 * whose address it is asking about.
 */

const PORTAL_URL = "https://cockpit.maharamedia.com";
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

export interface PortalWho {
  email: string;
  name: string;
  roles: string[];
  cockpits: string[];
}

/** Swap the pass for a session. Throws with a sentence a person can act on. */
export async function signInWithPortalToken(token: string): Promise<PortalWho> {
  // If we already hold an active Supabase session, use it directly
  const { data: current } = await supabase.auth.getSession();
  if (current?.session?.user) {
    const user = current.session.user;
    const meta = user.user_metadata as { name?: string; full_name?: string } | undefined;
    const app = user.app_metadata as { roles?: string[]; cockpits?: string[] } | undefined;
    return {
      email: user.email ?? "",
      name: meta?.name || meta?.full_name || (user.email?.split("@")[0] ?? ""),
      roles: app?.roles ?? [],
      cockpits: app?.cockpits ?? [],
    };
  }

  // Try parsing session tokens if passed directly
  let sessionData: { access_token?: string; refresh_token?: string } | null = null;
  try {
    sessionData = JSON.parse(token);
  } catch {
    try {
      sessionData = JSON.parse(atob(token));
    } catch {
      // not JSON/base64
    }
  }

  if (sessionData?.access_token && sessionData?.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
    });
    if (error) throw new Error(error.message);
    const user = data.user;
    const meta = user?.user_metadata as { name?: string; full_name?: string } | undefined;
    const app = user?.app_metadata as { roles?: string[]; cockpits?: string[] } | undefined;
    return {
      email: user?.email ?? "",
      name: meta?.name || meta?.full_name || (user?.email?.split("@")[0] ?? ""),
      roles: app?.roles ?? [],
      cockpits: app?.cockpits ?? [],
    };
  }

  // Try magiclink OTP verification if a token_hash was passed
  const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: "magiclink",
  });
  if (!otpError && otpData?.user) {
    const user = otpData.user;
    const meta = user.user_metadata as { name?: string; full_name?: string } | undefined;
    const app = user.app_metadata as { roles?: string[]; cockpits?: string[] } | undefined;
    return {
      email: user.email ?? "",
      name: meta?.name || meta?.full_name || (user.email?.split("@")[0] ?? ""),
      roles: app?.roles ?? [],
      cockpits: app?.cockpits ?? [],
    };
  }

  throw new Error("The sign-in pass was invalid or expired. Sign in directly below.");
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
  _format?: string,
): Promise<AdPreview> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in again to load previews." };
  try {
    const { data: ad } = await supabase
      .from("cockpit_ads")
      .select("still_url, thumbnail_url")
      .eq("meta_ad_id", adId)
      .maybeSingle();

    if (ad && (ad.still_url || ad.thumbnail_url)) {
      return {
        ok: true,
        stillUrl: ad.still_url ?? undefined,
        thumbUrl: ad.thumbnail_url ?? undefined,
      };
    }

    const { data: winner } = await supabase
      .from("winner_ads")
      .select("thumbnail_url")
      .eq("ad_id", adId)
      .maybeSingle();

    if (winner?.thumbnail_url) {
      return {
        ok: true,
        thumbUrl: winner.thumbnail_url ?? undefined,
      };
    }

    return {
      ok: true,
      stillUrl: undefined,
      thumbUrl: undefined,
    };
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
    {
      key: "sales",
      label: "Sales",
      href: `${portal}/go/sales`,
      show: isAdmin || cockpits.includes("sales"),
    },
  ].filter(d => d.show);
}
