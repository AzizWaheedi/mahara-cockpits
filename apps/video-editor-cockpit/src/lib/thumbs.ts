/**
 * Which picture a winning ad shows on its card.
 *
 * The stored `thumb_url` is a Meta CDN link, and Meta signs each one with an
 * expiry: the `oe` parameter, seconds since 1970 in hex. The automatic copy
 * from the ad accounts stopped on 2026-10-08, the last of those links ran out
 * the same day, and Meta now answers every one with 403 "URL signature
 * expired". So a card reaches for pictures that last first: a still in our
 * own storage, then the opening frame of our own copy of the video. A Meta
 * link is used only while it is still signed (and it is 64px wide), and with
 * none of these the card says plainly that no picture is saved.
 */

export type Picture =
  | { kind: "image"; src: string }
  /** The opening frame of our own copy of the video. */
  | { kind: "frame"; src: string }
  /** Our copy exists and its signed link is still on its way. */
  | { kind: "wait" }
  | { kind: "none" };

/** When Meta stops serving a CDN link, or null when it carries no expiry. */
export function metaExpiry(url: string): Date | null {
  let oe: string | null;
  try {
    oe = new URL(url).searchParams.get("oe");
  } catch {
    return null;
  }
  if (!oe || !/^[0-9a-f]+$/i.test(oe)) return null;
  return new Date(Number.parseInt(oe, 16) * 1000);
}

/** Is this a Meta picture link whose signature has run out? */
export function metaLinkExpired(url: string, now: Date = new Date()): boolean {
  const at = metaExpiry(url);
  return at !== null && at.getTime() <= now.getTime();
}

/**
 * A still in our own Supabase Storage. Stills kept on Convex stopped
 * answering when Convex was retired (2026-10-08), so they do not count.
 */
export function isOwnStill(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.endsWith(".supabase.co") &&
      u.pathname.startsWith("/storage/v1/object/")
    );
  } catch {
    return false;
  }
}

/** One second in, past the black or fading first frame many ads open on. */
export const FRAME_AT = "#t=1";

export function pickPicture({
  still,
  thumbUrl,
  ourCopy,
  copyPending = false,
  failed = new Set<string>(),
  now = new Date(),
}: {
  still?: string | null;
  thumbUrl?: string | null;
  /** A signed link to our own copy of the video. */
  ourCopy?: string;
  copyPending?: boolean;
  /** Links that already failed to load in this browser. */
  failed?: ReadonlySet<string>;
  now?: Date;
}): Picture {
  if (still && isOwnStill(still) && !failed.has(still))
    return { kind: "image", src: still };
  if (ourCopy && !failed.has(ourCopy)) return { kind: "frame", src: ourCopy };
  if (copyPending) return { kind: "wait" };
  if (thumbUrl && !metaLinkExpired(thumbUrl, now) && !failed.has(thumbUrl))
    return { kind: "image", src: thumbUrl };
  return { kind: "none" };
}
