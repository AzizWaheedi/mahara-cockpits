import type { Cta, Lang } from "./content";
import type { LaunchAd, MetaAd } from "./sources";

/**
 * One creative as the phones draw it, from an upload in the ads tray or a
 * built Meta ad's still (DESIGN 10). Words the creative does not carry are
 * null: the phone draws grey bars there, never invented text.
 */
export interface Creative {
  id: string;
  /** Where it came from: an upload, or a Meta ad. */
  from: "upload" | "meta";
  name: string;
  url: string | null;
  poster: string | null;
  video: boolean;
  /** Width over height, when known. */
  ratio: number | null;
  primaryText: string | null;
  headline: string | null;
  cta: Cta | null;
  language: Lang | null;
  placement: "feed" | "reels" | "facebook" | null;
  starter: boolean;
  seconds: number | null;
}

export type Shape = "9:16" | "4:5" | "1:1" | "16:9";

/** The nearest shape Meta uses for a width over height. */
export function shapeOf(ratio: number | null | undefined): Shape {
  if (!ratio || !Number.isFinite(ratio)) return "4:5";
  if (ratio < 0.68) return "9:16";
  if (ratio < 0.9) return "4:5";
  if (ratio < 1.4) return "1:1";
  return "16:9";
}

/** The phone a creative suits: tall ones to Reels, the rest to the feed. */
export function phoneFor(c: Pick<Creative, "ratio" | "placement">) {
  if (c.placement) return c.placement;
  return shapeOf(c.ratio) === "9:16" ? "reels" : "feed";
}

const CTAS = new Set<Cta>([
  "LEARN_MORE",
  "GET_QUOTE",
  "BOOK_NOW",
  "CONTACT_US",
  "SIGN_UP",
  "SEND_WHATSAPP_MESSAGE",
  "APPLY_NOW",
]);
const asCta = (v: unknown): Cta | null =>
  typeof v === "string" && CTAS.has(v as Cta) ? (v as Cta) : null;
const text = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function creativeOf(ad: LaunchAd): Creative {
  const video = ad.mime.startsWith("video/");
  const w = Number(ad.width) || 0;
  const h = Number(ad.height) || 0;
  return {
    id: ad.id,
    from: "upload",
    name: ad.fileName ?? (video ? "Video" : "Picture"),
    url: ad.url ?? null,
    poster: video ? (ad.posterUrl ?? null) : (ad.url ?? null),
    video,
    ratio: w && h ? w / h : null,
    primaryText: text(ad.primaryText),
    headline: text(ad.headline),
    cta: asCta(ad.cta),
    language: ad.language ?? null,
    placement: ad.placement ?? null,
    starter: ad.kind === "starter",
    seconds: ad.seconds == null ? null : Number(ad.seconds) || null,
  };
}

/** A built Meta ad's still. Its words live in prep (`meta_ad_text`). */
export function creativeOfMeta(
  ad: MetaAd,
  words?: Record<string, unknown> | null,
): Creative | null {
  const url = ad.still?.url ?? null;
  if (!url) return null;
  const w = words ?? {};
  return {
    id: ad.id,
    from: "meta",
    name: ad.name ?? "Meta ad",
    url,
    poster: url,
    video: false,
    ratio: null,
    primaryText: text(w.primary_text),
    headline: text(w.headline),
    cta: asCta(w.cta),
    language: w.language === "ar" || w.language === "en" ? w.language : null,
    placement:
      w.placement === "feed" ||
      w.placement === "reels" ||
      w.placement === "facebook"
        ? w.placement
        : null,
    starter: false,
    seconds: null,
  };
}

/**
 * The app language for every phone on a slide (DESIGN 7.1): the language
 * most of the client's creatives are written in, else the deck's.
 */
export function appLanguage(creatives: Creative[], deck: Lang): Lang {
  let ar = 0;
  let en = 0;
  for (const c of creatives) {
    if (c.language === "ar") ar++;
    else if (c.language === "en") en++;
  }
  if (ar === en) return deck;
  return ar > en ? "ar" : "en";
}
