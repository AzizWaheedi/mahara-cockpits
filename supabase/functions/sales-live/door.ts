// The short link's door: codes, routes, previews, devices, the salted IP
// hash, the per-address limit and what the page is told about a room.
// Pure functions only; index.ts and handler.ts do the I/O.

import { sha256Hex } from "./sign.ts";
import { stripControl } from "./util.ts";

/** Six characters, no I, O, 0 or 1 (1.07 billion codes). */
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** A code as a lead may type it: any case, stray spaces or a slash. */
export function normalizeCode(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const c = x.replace(/[\s/]+/g, "").toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

export type RouteName = "zoom" | "slack" | "open" | "go" | "cron" | "health";
export type Route = { name: RouteName | null; code?: string };

const ROUTES = new Set<RouteName>(["zoom", "slack", "open", "go", "cron", "health"]);

/**
 * The route in a request path. Supabase hands the function its path with the
 * function's name in front ("/sales-live/open/K7Q2MX"); a local run may not.
 */
export function routeOf(pathname: string): Route {
  let path = pathname;
  const at = path.indexOf("/sales-live");
  if (at >= 0) path = path.slice(at + "/sales-live".length);
  const parts = path.split("/").filter(Boolean);
  const name = (parts[0] ?? "").toLowerCase() as RouteName;
  if (!ROUTES.has(name)) return { name: null };
  if (name === "open" || name === "go") {
    let raw = parts[1] ?? "";
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // A broken escape is just an unknown code.
    }
    return { name, code: raw.slice(0, 40) };
  }
  return parts.length === 1 ? { name } : { name: null };
}

// Link previews, crawlers and scripted clients. People never send these.
// Deliberately not here: in-app browsers (FBAN, Instagram, Snapchat, Line's
// browser), which are people, and a bare "bot" inside a word (the CUBOT
// phone brand). A wrong match only costs one counted open, never the call.
const BOT =
  /facebookexternalhit|facebot|meta-external(?:agent|fetcher)|whatsapp\/|telegrambot|twitterbot|slackbot|slack-imgproxy|discordbot|linkedinbot|skypeuripreview|applebot|googlebot|google-pagerenderer|google-inspectiontool|adsbot|mediapartners-google|bingbot|bingpreview|yandex(?:bot|images)|baiduspider|duckduckbot|petalbot|embedly|iframely|pinterestbot|redditbot|vkshare|line-poker|kakaotalk-scrap|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|statuscake|curl\/|wget\/|python-requests|python-urllib|aiohttp|go-http-client|okhttp|node-fetch|undici|axios\/|java\/|libwww-perl|crawler|spider|slurp|[a-z]bot\/|(?:^|[\s(;])bot(?:[\s);/]|$)/i;

/** True for a link preview or crawler (or no user agent at all). */
export function isPreviewBot(ua: string | null | undefined): boolean {
  const s = (ua ?? "").trim();
  if (!s) return true;
  return BOT.test(s);
}

/** The values cockpit_sales_rooms.open_device allows (migration 20261003a). */
export type Device = "phone" | "tablet" | "desktop" | "unknown";

export function deviceOf(ua: string | null | undefined): Device {
  const s = ua ?? "";
  if (!s.trim()) return "unknown";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(s)) return "tablet";
  if (/Android/i.test(s) && !/Mobi/i.test(s)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(s)) return "phone";
  return "desktop";
}

/** The timeline line for an open (room_events.text). */
export function openText(device: Device, afterEnd: boolean): string {
  if (afterEnd) return "The lead opened the link after the room closed.";
  const on = { phone: " on a phone", tablet: " on a tablet", desktop: " on a computer", unknown: "" }[device];
  return `The lead opened the link${on}.`;
}

export type Os = "ios" | "android" | "mac" | "windows" | "other";

export function osOf(ua: string | null | undefined): Os {
  const s = ua ?? "";
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Android/i.test(s)) return "android";
  if (/Macintosh|Mac OS X/i.test(s)) return "mac";
  if (/Windows/i.test(s)) return "windows";
  return "other";
}

/** The caller's address as Supabase's edge passes it on. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || headers.get("cf-connecting-ip")?.trim() || "unknown";
}

/** The only form an address is ever kept in: salted, hashed, cut to 32 hex. */
export async function ipHash(salt: string, ip: string): Promise<string> {
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
}

/** A device id from the page: random, made in the browser, nothing personal. */
export function deviceIdOk(x: string | null): x is string {
  return typeof x === "string" && /^[A-Za-z0-9-]{8,64}$/.test(x);
}

/**
 * At most `limit` hits per key per window, counted per running instance (the
 * same discipline as webinar-events). The map is bounded: when it is full,
 * expired windows go first, then the oldest keys.
 */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(
    readonly limit = 30,
    readonly windowMs = 60_000,
    readonly maxKeys = 10_000,
  ) {}

  hit(key: string, now: number): boolean {
    const s = this.hits.get(key);
    if (!s || now - s.start >= this.windowMs) {
      if (!s && this.hits.size >= this.maxKeys) this.evict(now);
      this.hits.set(key, { start: now, n: 1 });
      return 1 <= this.limit;
    }
    s.n += 1;
    return s.n <= this.limit;
  }

  get size(): number {
    return this.hits.size;
  }

  private evict(now: number): void {
    for (const [k, s] of this.hits)
      if (now - s.start >= this.windowMs) this.hits.delete(k);
    if (this.hits.size < this.maxKeys) return;
    const drop = Math.max(1, Math.ceil(this.maxKeys / 10));
    let i = 0;
    for (const k of this.hits.keys()) {
      if (i++ >= drop) break;
      this.hits.delete(k);
    }
  }
}

/**
 * A join link the page may open: https, and on Zoom's or Google Meet's own
 * hosts. Anything else is refused, so a bad row can never turn the short link
 * into a redirect to somewhere else.
 */
export function safeJoinUrl(x: unknown): string | null {
  if (typeof x !== "string" || x.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(x.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  const ok =
    h === "meet.google.com" ||
    h === "zoom.us" ||
    h.endsWith(".zoom.us") ||
    h === "zoom.com" ||
    h.endsWith(".zoom.com");
  return ok ? u.toString() : null;
}

/** The first word of a name, or null. */
export function firstName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const w = x.trim().split(/\s+/)[0] ?? "";
  const clean = stripControl(w).replace(/[<>&"'`\s]/g, "").slice(0, 40);
  return clean || null;
}

/** A WhatsApp number for the ended page's button: digits only, 8 to 15. */
export function whatsappDigits(x: unknown): string | null {
  if (typeof x !== "string" && typeof x !== "number") return null;
  const d = String(x).replace(/[^\d]/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export const FINAL_STATES = new Set(["ended", "expired", "failed", "cancelled"]);

/** A lead_in room with no end signal is over this long after ends_at (no_end_signal). */
export const NO_END_SIGNAL_MS = 1_800_000;

/** How many replaced rooms the link follows before it gives up. */
export const MAX_HOPS = 3;

export interface RoomRow {
  id: string;
  code: string;
  state: string;
  provider: string | null;
  join_url: string | null;
  host_email: string | null;
  replaced_by: string | null;
  ends_at: string | null;
  first_open_at: string | null;
}

/** The columns the door reads from cockpit_sales_rooms, in one place. */
export const ROOM_COLUMNS =
  "id,code,state,provider,join_url,host_email,replaced_by,ends_at,first_open_at";

export type Rep = { en: string | null; ar: string | null };

export type DoorView =
  | { ok: true; state: "open"; code: string; provider: "zoom" | "meet"; join_url: string; rep: Rep }
  | { ok: true; state: "preparing"; code: string; provider: "zoom" | "meet" | null; rep: Rep; retry_ms: number }
  | { ok: true; state: "ended"; code: string; rep: Rep; whatsapp: string | null }
  | { ok: false; state: "unknown"; code: string | null }
  | { ok: false; state: "broken"; code: string; error: string };

const provider = (p: string | null): "zoom" | "meet" | null =>
  p === "zoom" || p === "meet" ? p : null;

/** Is this room over, as far as the lead's link goes? */
export function roomIsOver(room: RoomRow, nowMs: number): boolean {
  if (FINAL_STATES.has(room.state)) return true;
  const ends = room.ends_at ? Date.parse(room.ends_at) : Number.NaN;
  return Number.isFinite(ends) && nowMs > ends + NO_END_SIGNAL_MS;
}

/**
 * What the page is told. `code` is the code the lead opened, even when the
 * link followed a replaced room. A room that is not over but has no link yet
 * is "preparing"; the page asks again every 2 s.
 */
export function doorView(
  code: string,
  room: RoomRow,
  rep: Rep,
  nowMs: number,
  whatsapp: string | null = null,
): DoorView {
  if (roomIsOver(room, nowMs)) return { ok: true, state: "ended", code, rep, whatsapp };
  if (!room.join_url)
    return { ok: true, state: "preparing", code, provider: provider(room.provider), rep, retry_ms: 2000 };
  const url = safeJoinUrl(room.join_url);
  if (!url)
    return {
      ok: false,
      state: "broken",
      code,
      error: "This room's link is not one the page can open. Reply to our message and we will send a new one.",
    };
  const p = provider(room.provider) ?? (new URL(url).hostname === "meet.google.com" ? "meet" : "zoom");
  return { ok: true, state: "open", code, provider: p, join_url: url, rep };
}

/** Origins whose page may read /open: the live site, its Vercel previews, a local run. */
export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  const host = u.host.toLowerCase();
  if (u.protocol === "https:" && host === "call.maharamedia.com") return origin;
  if (u.protocol === "https:" && /^(mahara-)?call-link(-[a-z0-9-]+)?\.vercel\.app$/.test(host))
    return origin;
  if (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return origin;
  return null;
}
