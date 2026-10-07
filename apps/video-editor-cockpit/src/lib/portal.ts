import { supabase } from "./supabase";

/** Cockpits on the production origin share the native Supabase session. */

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
