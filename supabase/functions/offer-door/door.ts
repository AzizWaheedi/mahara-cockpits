// The offer page's door: routes, codes, the page's origin, the video
// redirect's target and the signing of a proposal's pictures.
// Pure functions only; handler.ts does the I/O. The rate limits, the salted
// address, the device and the preview-bot rule are sales-live's own
// (imported in handler.ts, never copied).

/** A proposal's code: 12 of the 31 characters with no i, l, o, 0 or 1 (cockpit_upsell_code). */
export const PROPOSAL_CODE = /^[a-hj-km-np-z2-9]{12}$/;
/** A pitch's video code: 10 of the same characters. */
export const VIDEO_CODE = /^[a-hj-km-np-z2-9]{10}$/;
/** A live preview token (cockpit_upsell_proposal_preview): 24 of the same characters. */
export const PREVIEW_TOKEN = /^[a-hj-km-np-z2-9]{24}$/;
/** Signed picture links last ten minutes. */
export const SIGN_SECONDS = 600;
export const LIVE_OFFER_SITE = "https://offer.maharamedia.com";
/** The largest event body the page sends ({kind, d}). */
export const EVENT_MAX_BYTES = 1024;

export type DoorRouteName = "p" | "event" | "v" | "health";
export type DoorRoute = { name: DoorRouteName | null; code?: string };

/**
 * The route in a request path. Supabase hands the function its path with the
 * function's name in front ("/offer-door/p/k7q2mxab3cde"); a local run may not.
 */
export function doorRoute(pathname: string): DoorRoute {
  let path = pathname;
  const at = path.indexOf("/offer-door");
  if (at >= 0) path = path.slice(at + "/offer-door".length);
  const parts = path.split("/").filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase();
  const code = (raw: string | undefined) => {
    let c = raw ?? "";
    try {
      c = decodeURIComponent(c);
    } catch {
      // A broken escape is just an unknown code.
    }
    return c.slice(0, 40);
  };
  if (first === "health" && parts.length === 1) return { name: "health" };
  if (first === "p" && parts.length === 2) return { name: "p", code: code(parts[1]) };
  if (first === "p" && parts.length === 3 && parts[2]?.toLowerCase() === "event") return { name: "event", code: code(parts[1]) };
  if (first === "v" && parts.length === 2) return { name: "v", code: code(parts[1]) };
  return { name: null };
}

// Marks a message app can leave inside or after a link that nobody can see.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u061c\ufeff]/g;

/**
 * A code as it may arrive: any case, invisible marks, or punctuation glued
 * on by the sentence around the link. Anything else of another length is
 * refused, so a mistyped code never opens someone else's page.
 */
export function normalizeOfferCode(raw: unknown, re: RegExp): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.replace(INVISIBLE, "").trim().toLowerCase().replace(/[.,;:!?)\]}'"\u060c\u061b\u06d4]+$/, "");
  return re.test(c) ? c : null;
}

/** OFFER_SITE_URL when it is a bare https origin, else the live site. */
export function offerSite(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/i.test(s) ? s.toLowerCase() : LIVE_OFFER_SITE;
}

/** The page's own origin, or a local run on this machine; null for anything else. */
export function allowedOfferOrigin(origin: string | null, site: string): string | null {
  if (!origin) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (origin.toLowerCase() === site.toLowerCase()) return origin;
  if (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host.toLowerCase())) return origin;
  return null;
}

// The provider page each saved video link points to (cockpit_csm_deck_video_parse's canonical url).
const VIDEO_PAGE_HOSTS = new Set(["www.youtube.com", "vimeo.com", "www.loom.com", "fast.wistia.net", "drive.google.com"]);
// The players the page may frame (sites/offer CSP frame-src).
const EMBED_HOSTS = new Set(["www.youtube-nocookie.com", "player.vimeo.com", "www.loom.com", "fast.wistia.net", "drive.google.com"]);
// The decks' poster hosts (sites/offer CSP img-src).
const POSTER_HOSTS = new Set(["cdn.loom.com", "embed-ssl.wistia.com", "i.vimeocdn.com", "i.ytimg.com"]);

function httpsOn(x: unknown, hosts: Set<string>): string | null {
  if (typeof x !== "string" || x.length > 600) return null;
  let u: URL;
  try {
    u = new URL(x.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !hosts.has(u.hostname.toLowerCase())) return null;
  return u.toString();
}

/**
 * Where /v may send a person: the saved video's own page on one of the five
 * providers, https, no user or port. Anything else is refused, so a bad row
 * can never turn the short link into a redirect to somewhere else.
 */
export function videoPageOk(x: unknown): string | null {
  return httpsOn(x, VIDEO_PAGE_HOSTS);
}
export function embedOk(x: unknown): string | null {
  return httpsOn(x, EMBED_HOSTS);
}
export function posterOk(x: unknown): string | null {
  return httpsOn(x, POSTER_HOSTS);
}

export type StorageRef = { bucket: string; path: string };
/** The buckets a page's pictures may come from, and whether each is public. */
export const PICTURE_BUCKETS: Record<string, "public" | "signed"> = {
  "cockpit-client-logos": "public",
  "cockpit-launch-ads": "signed",
  "cockpit-upsell-files": "signed",
};
const PATH_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}){0,3}$/;

/** A storage reference the door may turn into a link: a known bucket and a plain path inside it. */
export function refOk(x: unknown): StorageRef | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.bucket !== "string" || typeof r.path !== "string") return null;
  if (!(r.bucket in PICTURE_BUCKETS) || !PATH_OK.test(r.path) || r.path.includes("..")) return null;
  return { bucket: r.bucket, path: r.path };
}

/** Every picture a PublicProposal names (its logo and each capture), for signing. */
export function pictureRefs(proposal: unknown): StorageRef[] {
  if (!proposal || typeof proposal !== "object") return [];
  const p = proposal as Record<string, unknown>;
  const out: StorageRef[] = [];
  const logo = refOk(p.logo);
  if (logo) out.push(logo);
  for (const f of Array.isArray(p.found) ? p.found : []) {
    const r = refOk(f);
    if (r) out.push(r);
  }
  return out;
}

export const refKey = (r: StorageRef) => `${r.bucket}/${r.path}`;
export function publicUrl(base: string, r: StorageRef): string {
  return `${base}/storage/v1/object/public/${r.bucket}/${r.path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The proposal as the page gets it: each {bucket, path} becomes {url} (a
 * picture with no link is left out: the logo becomes null, a capture is
 * dropped), and a video whose player or poster is not one the page may load
 * is left out. Nothing else changes; cockpit_upsell_public_json already
 * holds only what a client may see.
 */
export function withLinks(proposal: unknown, links: Map<string, string>): unknown {
  if (!proposal || typeof proposal !== "object") return proposal;
  const p = { ...(proposal as Record<string, unknown>) };
  const linkOf = (x: unknown) => {
    const r = refOk(x);
    return r ? (links.get(refKey(r)) ?? null) : null;
  };
  if (p.logo && typeof p.logo === "object") {
    const url = linkOf(p.logo);
    const alt = (p.logo as Record<string, unknown>).alt;
    p.logo = url ? { url, alt: typeof alt === "string" ? alt : null } : null;
  }
  if (Array.isArray(p.found)) {
    p.found = p.found.flatMap(f => {
      const url = linkOf(f);
      if (!url || !f || typeof f !== "object") return [];
      const { bucket: _b, path: _p, ...rest } = f as Record<string, unknown>;
      return [{ url, ...rest }];
    });
  }
  if (p.video && typeof p.video === "object") {
    const v = p.video as Record<string, unknown>;
    const embedUrl = embedOk(v.embedUrl);
    p.video = embedUrl
      ? { provider: typeof v.provider === "string" ? v.provider : null, embedUrl, posterUrl: posterOk(v.posterUrl), title: typeof v.title === "string" ? v.title : null }
      : null;
  }
  return p;
}

/** The secrets each route needs, read by name (never their values). */
export const NEEDS: Record<Exclude<DoorRouteName, "health">, string[]> = {
  p: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OFFER_IP_SALT"],
  event: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OFFER_IP_SALT"],
  v: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OFFER_IP_SALT"],
};

export function missingFor(route: Exclude<DoorRouteName, "health">, env: (name: string) => string): string[] {
  return NEEDS[route].filter(n => !env(n).trim());
}

const WHAT: Record<Exclude<DoorRouteName, "health">, string> = {
  p: "Proposal pages cannot open",
  event: "Plays and Yes presses are not recorded",
  v: "Video links cannot open",
};
/** The plain sentence for a route closed by missing secrets: their names, never their values. */
export function missingSentence(route: Exclude<DoorRouteName, "health">, names: string[]): string {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${WHAT[route]}: ${list} ${names.length === 1 ? "is" : "are"} missing on offer-door. Add ${names.length === 1 ? "it" : "them"} to the function's secrets.`;
}

/** Headers every answer carries: nothing on it may run, frame or be indexed. */
export const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
