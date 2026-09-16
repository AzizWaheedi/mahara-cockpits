/**
 * Helpers for pictures and previews of Meta ads.
 *
 * Meta's links do not last. A preview iframe link is good for about a day, and
 * an fbcdn image link carries its own expiry in the `oe` parameter (hex Unix
 * seconds). Nothing here trusts a stored Meta link without checking its age.
 * The backend keeps a copy of these helpers in convex/metaMedia.ts.
 */

/** A fetched preview link is used for at most this long. */
export const PREVIEW_MAX_AGE_MS = 20 * 3600_000;

const META_CDN = /(^|\.)(fbcdn\.net|cdninstagram\.com)$/i;
const META_PREVIEW_HOST = /(^|\.)(facebook\.com|instagram\.com)$/i;

/** When a Meta CDN link stops working (ms epoch), read from its `oe`. */
export function metaImageExpiry(url?: string | null): number | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!META_CDN.test(u.hostname)) return undefined;
    const oe = u.searchParams.get("oe");
    if (!oe || !/^[0-9a-f]{6,10}$/i.test(oe)) return undefined;
    return Number.parseInt(oe, 16) * 1000;
  } catch {
    return undefined;
  }
}

/**
 * False for a Meta CDN link that has expired or expires within `marginMs`.
 * A link with no `oe` is allowed; the image's onError still guards it.
 */
export function metaImageUsable(
  url?: string | null,
  now = Date.now(),
  marginMs = 10 * 60_000,
): boolean {
  if (!url) return false;
  const exp = metaImageExpiry(url);
  return exp === undefined || exp - marginMs > now;
}

/** The key a saved still is filed under: the creative when known, else the ad. */
export function stillKeyFor(
  creativeId?: string | null,
  adId?: string | null,
): string | undefined {
  return creativeId ? `c:${creativeId}` : adId ? `a:${adId}` : undefined;
}

/** Straight to one ad in Ads Manager. */
export function adsManagerUrl(adId: string, accountId?: string | null): string {
  const act = accountId
    ? `act=${encodeURIComponent(String(accountId).replace(/^act_/, ""))}&`
    : "";
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?${act}selected_ad_ids=${encodeURIComponent(adId)}`;
}

/**
 * Only Meta's own https preview pages may go into an iframe. Anything else
 * that arrives as a preview link is ignored.
 */
export function isMetaPreviewUrl(url?: string | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && META_PREVIEW_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export type PreviewReason =
  | "gone"
  | "no_meta_access"
  | "rate_limited"
  | "error"
  | "no_access"
  | "offline";

/** What previews.fresh returns, in all three cockpits. */
export type PreviewResult = {
  ok: boolean;
  adId: string;
  /** Meta preview iframe link, only when ok. */
  src?: string;
  width?: number;
  height?: number;
  fetchedAt?: number;
  /** Do not render src after this. */
  expiresAt?: number;
  stillKey?: string;
  /** The media buyer's saved copy, about 320px. */
  stillUrl?: string;
  /** The same still at about 96px. */
  stillTinyUrl?: string;
  /** A fresh Meta CDN still. */
  thumbUrl?: string;
  thumbExpiresAt?: number;
  accountId?: string;
  reason?: PreviewReason | string;
  /** Plain words, safe to show. */
  message?: string;
};
