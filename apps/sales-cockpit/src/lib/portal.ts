import { supabase } from "./supabase";

/** Cockpits on the production origin share the native Supabase session. */

const PORTAL_URL = "https://cockpit.maharamedia.com";
const OWN_HOSTS = ["mahara-sales.vercel.app"];

export const COCKPIT = "sales";

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
 * The Facebook preview of the ad a lead came from.
 * Reads directly from Supabase cockpit_ads.
 */
export async function adPreview(
  adId: string,
  _format?: string,
): Promise<AdPreview> {
  try {
    const { data: ad, error } = await supabase
      .from("cockpit_ads")
      .select("still_url, thumbnail_url, meta_ad_id, reason")
      .eq("meta_ad_id", adId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (ad && (ad.still_url || ad.thumbnail_url)) {
      return {
        ok: true,
        stillUrl: ad.still_url ?? undefined,
        thumbUrl: ad.thumbnail_url ?? undefined,
        reason: ad.reason ?? undefined,
      };
    }
    return { ok: false, reason: "No preview captured yet for this ad." };
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
      key: "editor",
      label: "Editor desk",
      href: `${portal}/go/editor`,
      show: isAdmin || cockpits.includes("editor"),
    },
  ].filter(d => d.show);
}
