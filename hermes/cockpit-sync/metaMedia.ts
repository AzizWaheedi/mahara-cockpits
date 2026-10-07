/**
 * Plain helpers for Meta pictures and previews. No Convex imports, so any
 * module (and a bun test) can use them.
 *
 * Why this exists: Meta's links are not permanent. A preview iframe link
 * lasts 24 hours, and an fbcdn image link carries an `oe` expiry (hex Unix
 * seconds) and dies within days. Nothing may render a stored Meta link
 * without checking its age first. See previews.ts for the saved stills and
 * the on-demand preview.
 */

/** A fetched preview link is used for 20 hours; Meta says it lasts 24. */
export const PREVIEW_MAX_AGE_MS = 20 * 3600_000;

const META_CDN = /(^|\.)(fbcdn\.net|cdninstagram\.com)$/i;

/** ms epoch of a Meta CDN link's signature expiry, from its oe (hex seconds). */
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

/** False for a Meta CDN link that is expired or expires within `marginMs`. */
export function metaImageUsable(
  url?: string | null,
  now = Date.now(),
  marginMs = 10 * 60_000,
): boolean {
  if (!url) return false;
  const exp = metaImageExpiry(url);
  return exp === undefined || exp - marginMs > now;
}

/** The saved still's key: by creative when known (ads share creatives), else by ad. */
export function stillKeyFor(
  creativeId?: string | null,
  adId?: string | null,
): string | undefined {
  return creativeId ? `c:${creativeId}` : adId ? `a:${adId}` : undefined;
}

export function adsManagerUrl(adId: string, accountId?: string | null): string {
  const act = accountId ? `act=${String(accountId).replace(/^act_/, "")}&` : "";
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?${act}selected_ad_ids=${adId}`;
}

/** A Meta ad, creative or account id: digits only. */
export function isMetaId(x: unknown): x is string {
  return typeof x === "string" && /^\d{5,25}$/.test(x);
}

// --- Preview results ----------------------------------------------------------------

export type PreviewReason =
  | "gone"
  | "no_meta_access"
  | "rate_limited"
  | "error"
  | "no_access"
  | "offline";

/** The same shape in all three cockpits. */
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
  /** About 96px. */
  stillTinyUrl?: string;
  /** A fresh Meta CDN still, used only before thumbExpiresAt. */
  thumbUrl?: string;
  thumbExpiresAt?: number;
  accountId?: string;
  reason?: PreviewReason;
  /** Plain words, safe to show. */
  message?: string;
};

/** Meta's ad_format values we allow; anything else falls back to the first. */
export const PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "INSTAGRAM_REELS",
  "FACEBOOK_STORY_MOBILE",
  "FACEBOOK_REELS_MOBILE",
] as const;

export function previewFormat(format?: string | null): string {
  return format && (PREVIEW_FORMATS as readonly string[]).includes(format)
    ? format
    : PREVIEW_FORMATS[0];
}

export const PREVIEW_MESSAGES: Record<PreviewReason, string> = {
  gone: "Meta no longer has this ad. It was deleted, or the ad account was unshared.",
  no_meta_access:
    "Mahara's Meta access does not cover this ad account right now.",
  rate_limited:
    "Meta asked us to slow down. Try the live preview again in a few minutes.",
  error: "Meta did not return a live preview this time.",
  no_access:
    "This client is not on your list, so the live preview is not available to you.",
  offline:
    "The live preview comes through the media buyer system, which is offline right now.",
};

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);

/** Code and subcode out of an error, from graph()'s "Meta <code>/<subcode>: ..." text. */
export function metaErrorCodes(err: unknown): {
  code?: number;
  subcode?: number;
  text: string;
} {
  const text = String(
    err instanceof Error ? err.message : (err ?? ""),
  ).toLowerCase();
  const m = /meta (\d+)(?:\/(\d+))?:/.exec(text);
  return {
    code: m ? Number(m[1]) : undefined,
    subcode: m?.[2] ? Number(m[2]) : undefined,
    text,
  };
}

export function isRateLimit(err: unknown): boolean {
  const { code } = metaErrorCodes(err);
  return code !== undefined && RATE_LIMIT_CODES.has(code);
}

/** Why Meta refused a preview or a details read, in the words the UI knows. */
export function metaErrorReason(
  err: unknown,
): "gone" | "no_meta_access" | "rate_limited" | "error" {
  const { code, subcode, text } = metaErrorCodes(err);
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) return "rate_limited";
  if ((code === 100 && subcode === 33) || text.includes("does not exist"))
    return "gone";
  if (
    code === 10 ||
    code === 200 ||
    code === 294 ||
    text.includes("permission")
  )
    return "no_meta_access";
  return "error";
}

/**
 * How a failed still capture is recorded. `gone` is never retried; a rate
 * limit does not count as an attempt.
 */
export function stillFailure(err: unknown): {
  status: "failed" | "gone";
  countAttempt: boolean;
} {
  const { code, subcode, text } = metaErrorCodes(err);
  if (code !== undefined && RATE_LIMIT_CODES.has(code))
    return { status: "failed", countAttempt: false };
  if (
    (code === 100 && (subcode === 33 || text.includes("does not exist"))) ||
    code === 10 ||
    code === 200
  )
    return { status: "gone", countAttempt: false };
  return { status: "failed", countAttempt: true };
}

/** How long a preview answer is reused, by outcome. */
export function previewTtlMs(reason?: string): number {
  if (!reason) return PREVIEW_MAX_AGE_MS;
  if (reason === "gone" || reason === "no_meta_access") return 24 * 3600_000;
  if (reason === "rate_limited") return 5 * 60_000;
  return 10 * 60_000;
}

/**
 * Whether a cached preview row can be answered without calling Meta: a link
 * with at least five minutes left, or a refusal that has not run out.
 */
export function cachedPreviewUsable(
  row: { src?: string; expiresAt: number } | null | undefined,
  now = Date.now(),
): boolean {
  if (!row) return false;
  if (row.src) return row.expiresAt > now + 5 * 60_000;
  return row.expiresAt > now;
}

/** A cached or fresh preview answer, as stored in previewLinks. */
export type PreviewLink = {
  src?: string;
  width?: number;
  height?: number;
  fetchedAt: number;
  expiresAt: number;
  thumbUrl?: string;
  thumbExpiresAt?: number;
  reason?: string;
  error?: string;
};

function dropEmpty<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, x]) => x !== undefined && x !== null),
  ) as T;
}

/**
 * What the cockpit is told. A link is handed over only while it has time
 * left; otherwise the answer is a refusal with its plain-words message.
 * A fresh Meta still from the answer wins over the row's own only while its
 * signature is still good.
 */
export function previewAnswer(
  base: PreviewResult,
  link: PreviewLink,
  now = Date.now(),
): PreviewResult {
  // The same ten-minute margin as metaImageUsable: a cached answer can be
  // up to 20 hours old, and its picture link may be about to run out.
  const thumbOk = Boolean(
    link.thumbUrl &&
      (link.thumbExpiresAt === undefined ||
        link.thumbExpiresAt - 10 * 60_000 > now),
  );
  const thumb = {
    thumbUrl: thumbOk ? link.thumbUrl : base.thumbUrl,
    thumbExpiresAt: thumbOk ? link.thumbExpiresAt : base.thumbExpiresAt,
  };
  if (link.src && link.expiresAt > now) {
    return dropEmpty({
      ...base,
      ...thumb,
      ok: true,
      src: link.src,
      width: link.width,
      height: link.height,
      fetchedAt: link.fetchedAt,
      expiresAt: link.expiresAt,
      reason: undefined,
      message: undefined,
    });
  }
  const known = link.reason && link.reason in PREVIEW_MESSAGES;
  const reason = (known ? link.reason : "error") as PreviewReason;
  return dropEmpty({
    ...base,
    ...thumb,
    ok: false,
    src: undefined,
    reason,
    message: PREVIEW_MESSAGES[reason],
  });
}

/**
 * Whether opening a preview should also save the ad's still: only when none
 * is saved, the key is due, Meta did not just refuse us for a reason a
 * capture would hit too, and there is time left before the caller gives up.
 */
export function captureOnOpen(a: {
  hasSaved: boolean;
  reason?: string;
  still: StillRowState | null | undefined;
  msLeft: number;
  now?: number;
}): boolean {
  return (
    !a.hasSaved &&
    a.reason !== "rate_limited" &&
    a.reason !== "no_meta_access" &&
    stillCaptureDue(a.still, a.now ?? Date.now()) &&
    a.msLeft > 4_000
  );
}

/** Same stored row, ignoring bookkeeping fields: lets a sync skip unchanged writes. */
export function sameStoredRow(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ignore: readonly string[] = ["_id", "_creationTime", "syncedAt"],
): boolean {
  const skip = new Set(ignore);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    const x = a[k] ?? undefined;
    const y = b[k] ?? undefined;
    if (x === y) continue;
    if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}

/**
 * Meta's own preview pages. The three cockpits mount only these in an
 * iframe (src/lib/metaMedia.ts), so any other link counts as no preview here
 * too, and the person is told why instead of seeing nothing.
 */
const META_PREVIEW_HOST = /(^|\.)(facebook\.com|instagram\.com)$/i;

/** The iframe link and size out of a /previews body. */
export function parsePreviewBody(body: string): {
  src?: string;
  width?: number;
  height?: number;
} {
  const src = /src="([^"]+)"/.exec(body)?.[1]?.replace(/&amp;/g, "&");
  const num = (name: string) => {
    const m = new RegExp(`\\b${name}="(\\d+)"`).exec(body);
    return m ? Number(m[1]) : undefined;
  };
  if (!src) return {};
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" || !META_PREVIEW_HOST.test(u.hostname))
      return {};
  } catch {
    return {};
  }
  return { src, width: num("width"), height: num("height") };
}

/** Meta says the format does not fit this ad, so another format may work. */
export function formatUnsupported(err: unknown): boolean {
  const { text } = metaErrorCodes(err);
  return (
    !text.includes("does not exist") &&
    /ad_format|ad format|format is not supported|placement/.test(text)
  );
}

// --- Saved stills -------------------------------------------------------------------

export const STILL_MAX_ATTEMPTS = 5;
export const STILL_RETRY_WAIT_MS = 7 * 86400_000;
/** A capture in flight holds its key this long, so two runs do not fetch it twice. */
export const STILL_CLAIM_MS = 15 * 60_000;
export const STILL_FULL_MAX_BYTES = 250_000;
export const STILL_TINY_MAX_BYTES = 60_000;
export const STILL_MIN_BYTES = 200;

export type StillRowState = {
  status: "saved" | "failed" | "gone";
  attempts: number;
  lastTriedAt: number;
};

/**
 * Whether a capture should run for this key now. Saved and gone are final.
 * A failed key is retried until five attempts, then once a week. A key
 * tried in the last 15 minutes is left to the run that is trying it.
 */
export function stillCaptureDue(
  row: StillRowState | null | undefined,
  now = Date.now(),
): boolean {
  if (!row) return true;
  if (row.status !== "failed") return false;
  if (now - row.lastTriedAt < STILL_CLAIM_MS) return false;
  if (row.attempts < STILL_MAX_ATTEMPTS) return true;
  return now - row.lastTriedAt >= STILL_RETRY_WAIT_MS;
}

/** Why a winner has no picture, for the daily check. */
export function stillGap(
  row: StillRowState | null | undefined,
  now = Date.now(),
): "saved" | "never_tried" | "failed_eligible" | "failed_waiting" | "gone" {
  if (!row) return "never_tried";
  if (row.status === "saved") return "saved";
  if (row.status === "gone") return "gone";
  return row.attempts < STILL_MAX_ATTEMPTS ||
    now - row.lastTriedAt >= STILL_RETRY_WAIT_MS
    ? "failed_eligible"
    : "failed_waiting";
}

/** A row has a picture the UI can show right now. */
export function hasPicture(
  row: { stillUrl?: string | null; thumbUrl?: string | null },
  now = Date.now(),
): boolean {
  return Boolean(row.stillUrl) || metaImageUsable(row.thumbUrl, now);
}

/**
 * Where a creative's picture can come from when thumbnail_url is missing,
 * best first.
 */
export function creativeImageCandidates(creative: any): {
  url: string;
  source: string;
}[] {
  const spec = creative?.object_story_spec ?? {};
  const out: { url: string; source: string }[] = [];
  const add = (url: unknown, source: string) => {
    if (typeof url === "string" && /^https:\/\//.test(url))
      out.push({ url, source });
  };
  add(creative?.image_url, "image");
  add(spec.video_data?.image_url, "video_picture");
  add(spec.link_data?.picture, "link_picture");
  return out;
}

/** Check a downloaded picture before it is stored. "" when it is fine. */
export function stillProblem(
  status: number,
  contentType: string | null | undefined,
  bytes: number,
  maxBytes: number,
): string {
  if (status !== 200) return `HTTP ${status}`;
  if (!String(contentType ?? "").startsWith("image/"))
    return `not an image (${String(contentType ?? "no type").slice(0, 40)})`;
  if (bytes < STILL_MIN_BYTES) return `too small (${bytes} bytes)`;
  if (bytes > maxBytes) return `too big (${bytes} bytes)`;
  return "";
}

// --- Winners ------------------------------------------------------------------------

type SaveFields = {
  origin?: string;
  autoFirstAt?: number;
  savedAt?: number;
  unsavedAt?: number;
};

/** A person's "Save as winner" that has not been withdrawn. */
export function isSavedWinner(r: SaveFields): boolean {
  return (
    r.savedAt !== undefined &&
    !(r.unsavedAt !== undefined && r.unsavedAt >= r.savedAt)
  );
}

/** The weekly collector's rule picked it (every row before 2026-09-16 counts). */
export function isAutoWinner(r: SaveFields): boolean {
  return r.origin !== "manual" || r.autoFirstAt !== undefined;
}

// --- Creative copy ------------------------------------------------------------------

const CTA_CLEAN: Record<string, string> = {
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  GET_QUOTE: "Get quote",
  CONTACT_US: "Contact us",
  MESSAGE_PAGE: "Message",
  WHATSAPP_MESSAGE: "WhatsApp",
  BOOK_TRAVEL: "Book",
  APPLY_NOW: "Apply now",
  GET_OFFER: "Get offer",
  DOWNLOAD: "Download",
  SUBSCRIBE: "Subscribe",
};

/** Cut a string by characters, never inside an emoji's surrogate pair. */
export function clip(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return Array.from(s).slice(0, n).join("");
}

export function creativeFormat(spec: any): string {
  if (!spec) return "unknown";
  if (spec.video_data) return "video";
  const link = spec.link_data ?? {};
  if (link.child_attachments) return "carousel";
  if (spec.link_data) return "image";
  return "unknown";
}

/** Body, headline and a readable call to action, uncut. */
export function creativeCopyParts(spec: any): {
  body?: string;
  headline?: string;
  cta?: string;
} {
  const block = spec?.video_data ?? spec?.link_data ?? {};
  const cta: string | undefined = block.call_to_action?.type || undefined;
  return {
    body: block.message || undefined,
    headline: block.title || block.name || undefined,
    cta: cta ? (CTA_CLEAN[cta] ?? cta) : undefined,
  };
}

/**
 * What a creative says and what kind of ad it is, cut to the sizes the
 * playbook stores (headline 120, body 300 characters).
 */
export function readCreativeCopy(creative: any): {
  format: string;
  cta?: string;
  headline?: string;
  body?: string;
  videoId?: string;
} {
  const spec = creative?.object_story_spec ?? {};
  const { body, headline, cta } = creativeCopyParts(spec);
  return {
    format: creativeFormat(spec),
    cta,
    headline: clip(headline, 120),
    body: clip(body, 300),
    videoId: spec.video_data?.video_id || undefined,
  };
}
