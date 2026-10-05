// The short link's door: codes, routes, previews, devices, the salted IP
// hash, the per-address limit and what the page is told about a room.
// Pure functions only; index.ts and handler.ts do the I/O.

import { sha256Hex } from "./sign.ts";
import { stripControl } from "./util.ts";

/** Six characters, no I, O, 0 or 1 (1.07 billion codes). */
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/**
 * Marks a message app can leave inside or right after a link and that nobody
 * can see: zero-width spaces and joiners, the left-to-right and right-to-left
 * marks (common after a link in an Arabic message), the bidi embeddings and
 * isolates, the Arabic letter mark and the byte order mark.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u061C\uFEFF]/g;

/** The code at the start, when what follows it is not another letter or digit of the alphabet. */
const LEADING_CODE = /^([A-HJ-NP-Z2-9]{6})(?![A-Z0-9])/;

/**
 * A code as a lead may type or tap it: any case, stray spaces or a slash,
 * invisible marks, and punctuation glued to the end of the link by the
 * sentence around it ("Join here: {link}." or an Arabic comma). A seventh
 * letter or digit is still refused, so a mistyped code never opens a room.
 * sites/call-link/core.js codeFromPath follows the same rule.
 */
export function normalizeCode(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const c = x.replace(INVISIBLE, "").replace(/[\s/]+/g, "").toUpperCase();
  const m = LEADING_CODE.exec(c);
  return m ? m[1] : null;
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
// WhatsApp's preview fetcher is matched only at the start of the agent
// ("WhatsApp/2.x"), as roomlogic.ts does: a person's browser may carry
// "WhatsApp/" further along.
const WHATSAPP_PREVIEW = /^whatsapp\//i;
const BOT =
  /facebookexternalhit|facebot|meta-external(?:agent|fetcher)|telegrambot|twitterbot|slackbot|slack-imgproxy|discordbot|linkedinbot|skypeuripreview|applebot|googlebot|google-pagerenderer|google-inspectiontool|adsbot|mediapartners-google|bingbot|bingpreview|yandex(?:bot|images)|baiduspider|duckduckbot|petalbot|embedly|iframely|pinterestbot|redditbot|vkshare|line-poker|kakaotalk-scrap|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|statuscake|curl\/|wget\/|python-requests|python-urllib|aiohttp|go-http-client|okhttp|node-fetch|undici|axios\/|java\/|libwww-perl|crawler|spider|slurp|[a-z]bot\/|(?:^|[\s(;])bot(?:[\s);/]|$)/i;

/** True for a link preview or crawler (or no user agent at all). */
export function isPreviewBot(ua: string | null | undefined): boolean {
  const s = (ua ?? "").trim();
  if (!s) return true;
  return WHATSAPP_PREVIEW.test(s) || BOT.test(s);
}

/**
 * The one set of device names (roomlogic.ts DEVICES): what
 * cockpit_sales_rooms.open_device may hold, with null for "not known".
 */
export const OPEN_DEVICES = ["phone", "tablet", "computer"] as const;
export type Device = (typeof OPEN_DEVICES)[number];

/** What the lead opened the link on, by roomlogic.ts deviceOf's rules; null when not known. */
export function deviceOf(ua: string | null | undefined): Device | null {
  const s = ua ?? "";
  if (!s.trim()) return null;
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) return "tablet";
  if (/iPhone|iPod|Android|Mobile|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile/i.test(s)) return "phone";
  if (/Windows NT|Macintosh|Mac OS X|X11|Linux|CrOS/i.test(s)) return "computer";
  return null;
}

/** The timeline line for an open (room_events.text). */
export function openText(device: Device | null, afterEnd: boolean): string {
  if (afterEnd) return "The lead opened the link after the room closed.";
  const on = device === "phone" ? " on a phone" : device === "tablet" ? " on a tablet" : device === "computer" ? " on a computer" : "";
  return `The lead opened the link${on}.`;
}

/**
 * The only cockpit_sales_rooms columns the door ever writes. An open is not a
 * change a person acted on, so the rooms guard (lc-db) must not raise
 * `version` when nothing else changed; otherwise a setter's press made just
 * after the lead tapped the link reads "This changed a moment ago."
 */
export const OPEN_COLUMNS = ["first_open_at", "last_open_at", "open_device"] as const;

export type Os = "ios" | "android" | "mac" | "windows" | "other";

export function osOf(ua: string | null | undefined): Os {
  const s = ua ?? "";
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Android/i.test(s)) return "android";
  if (/Macintosh|Mac OS X/i.test(s)) return "mac";
  if (/Windows/i.test(s)) return "windows";
  return "other";
}

/**
 * The caller's address as the edge in front of the door sees it, never one
 * the caller wrote: cf-connecting-ip when Cloudflare set it, else the LAST
 * X-Forwarded-For entry (the one the edge appended; a client can put anything
 * in front of it), else x-real-ip. Which of these Supabase's edge sets is
 * checked on the first deploy (README).
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  return hops.at(-1) || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * The network an address is limited as (stress2, round 1): an IPv6 address's
 * /64 (every home line and cloud machine holds at least one, so a host can
 * take a new address for every request), an IPv4 address (or one mapped
 * into IPv6) as itself. Anything else is kept as it came.
 */
export function limitNet(ip: string): string {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] as string;
  if (!a.includes(":")) return a;
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return mapped[1] as string;
  const [head = "", tail = ""] = a.split("::", 2) as [string, string?];
  const left = head ? head.split(":") : [];
  const right = a.includes("::") ? (tail ? tail.split(":") : []) : [];
  if (!a.includes("::") && left.length !== 8) return a;
  const groups = a.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${groups
    .slice(0, 4)
    .map(g => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * The wider allocation an address belongs to (stress2 round 3,
 * code-guess-oracle-per-64): an IPv6 address's /48 (a tunnel broker hands
 * one out free, 65,536 /64s), an IPv4 address's /24 (carrier NAT puts many
 * leads behind one, so its bound is higher). Anything else as it came.
 */
export function widePrefix(ip: string): string {
  const net = limitNet(ip);
  const v6 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(net);
  if (v6) return `${v6[1]}:${v6[2]}:${v6[3]}::/48`;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(net);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  return net;
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

  /** Whether this key has used its window's hits, without counting one. */
  full(key: string, now: number): boolean {
    const s = this.hits.get(key);
    return Boolean(s && now - s.start < this.windowMs && s.n >= this.limit);
  }

  /** The hits this key has in its current window, without counting one. */
  used(key: string, now: number): number {
    const s = this.hits.get(key);
    return s && now - s.start < this.windowMs ? s.n : 0;
  }

  /** Gives back one hit that turned out not to need counting (a duplicate). */
  giveBack(key: string): void {
    const s = this.hits.get(key);
    if (s && s.n > 0) s.n -= 1;
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
 * A Zoom host's start link, in the shapes roomlogic.ts isHostLink knows: a
 * zak= token anywhere, a /s/ path, or the web client's /wc/.../start.
 */
export function isHostStartLink(u: URL): boolean {
  if (/[?&;#]zak=/i.test(`${u.search}${u.hash}`)) return true;
  return /^\/s\//i.test(u.pathname) || /^\/wc\/.*\/start(\/|$)/i.test(u.pathname);
}

/**
 * A join link the page may open: https, and on Zoom's or Google Meet's own
 * hosts. Anything else is refused, so a bad row can never turn the short link
 * into a redirect to somewhere else. A host's start link is refused too
 * (defence in depth: the database only checks https), so whoever holds the
 * code can never be handed the host's own login; the page then reads
 * "broken" and the lead is asked to reply for a new link.
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
  if (!ok || isHostStartLink(u)) return null;
  return u.toString();
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
/** A room a lead can still be let into, or one being made for them (its page says preparing). */
export const LIVE_STATES = new Set(["requested", "creating", "open", "host_in", "lead_in"]);

/** How many replaced rooms the link follows before it gives up (each is one read inside /open's deadline). */
export const MAX_HOPS = 2;

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
  /** booked: the closer's own meeting, whose link works until ends_at (C14). */
  purpose?: string | null;
  /** The lead's own rooms (a newer one the old link leads to) and the call's end in the books (stress2 round 4). */
  contact_id?: string | null;
  requested_at?: string | null;
  ended_at?: string | null;
  end_reason?: string | null;
  lead_in_at?: string | null;
  count_undo_at?: string | null;
}

/** The columns the door reads from cockpit_sales_rooms, in one place. */
export const ROOM_COLUMNS =
  "id,code,state,provider,join_url,host_email,replaced_by,ends_at,first_open_at,purpose,contact_id,requested_at,ended_at,end_reason,lead_in_at,count_undo_at";

/**
 * How long a call the sweep closed only in the books (R7's no_end_signal,
 * the lead in it) still opens: the room worker keeps such a meeting open and
 * checks it this long (desk rooms.py HOLD_GIVE_UP_S).
 */
export const BOOKS_CLOSE_OPEN_MS = 3 * 3600_000;

/** The lead was in the room, and "That was not the lead" did not take it back. */
export function leadReached(room: Partial<Pick<RoomRow, "lead_in_at" | "count_undo_at">>): boolean {
  const joined = Date.parse(String(room.lead_in_at ?? ""));
  if (!Number.isFinite(joined)) return false;
  const undo = Date.parse(String(room.count_undo_at ?? ""));
  return !Number.isFinite(undo) || joined > undo;
}

export type Rep = { en: string | null; ar: string | null };

export type DoorView =
  | { ok: true; state: "open"; code: string; provider: "zoom" | "meet"; join_url: string; rep: Rep }
  | { ok: true; state: "preparing"; code: string; provider: "zoom" | "meet" | null; rep: Rep; retry_ms: number }
  | { ok: true; state: "ended"; code: string; rep: Rep; whatsapp: string | null }
  | { ok: false; state: "unknown"; code: string | null }
  | { ok: false; state: "broken"; code: string; error: string };

const provider = (p: string | null): "zoom" | "meet" | null =>
  p === "zoom" || p === "meet" ? p : null;

/**
 * Is this room over, as far as the lead's link goes? Only a final state says
 * so. The time rules (lead, no_end_signal, standby_max) belong to the sweep,
 * which writes the final state; the door never adds one of its own, so a long
 * demo past ends_at still opens for a lead who reopens the link. A booked
 * room wraps the closer's own meeting, which we never end (C14,
 * roomlogic.ts shortLinkTarget): its link works until ends_at even after the
 * room closed, unless it was cancelled (stress2 round 3).
 */
export function roomIsOver(
  room: Pick<RoomRow, "state"> &
    Partial<Pick<RoomRow, "purpose" | "join_url" | "ends_at" | "ended_at" | "end_reason" | "lead_in_at" | "count_undo_at">>,
  nowMs?: number,
): boolean {
  if (!FINAL_STATES.has(room.state)) return false;
  // Closed only in the books (stress2 round 4, overrun-call-rejoin-link-says-ended):
  // the sweep's R7 wrote "no end signal" on a call the lead is in, Zoom said
  // nothing, and the worker keeps that meeting open. A lead whose phone
  // dropped gets back in, for the worker's own hold window.
  const closed = Date.parse(String(room.ended_at ?? ""));
  if (
    room.state === "ended" &&
    room.end_reason === "no_end_signal" &&
    leadReached(room) &&
    safeJoinUrl(room.join_url) &&
    Number.isFinite(closed) &&
    nowMs !== undefined &&
    nowMs < closed + BOOKS_CLOSE_OPEN_MS
  )
    return false;
  const ends = Date.parse(String(room.ends_at ?? ""));
  if (
    room.purpose === "booked" &&
    room.state !== "cancelled" &&
    safeJoinUrl(room.join_url) &&
    Number.isFinite(ends) &&
    nowMs !== undefined &&
    nowMs < ends
  )
    return false;
  return true;
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

export const LIVE_SITE = "https://call.maharamedia.com";

/**
 * Origins whose page may read /open: the live site, the one extra site named
 * in CALL_SITE_URL (exactly that origin), and a local run. No wildcard on
 * vercel.app: anyone can name a Vercel project "call-link-something", and a
 * page there could make a visitor's browser count an open. A preview build
 * points its mm-door meta at a local fake door instead.
 */
export function allowedOrigin(origin: string | null, extra: string | null = null): string | null {
  if (!origin) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (u.protocol === "https:" && u.host.toLowerCase() === "call.maharamedia.com") return origin;
  if (extra && u.protocol === "https:" && origin === extra) return origin;
  if (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host.toLowerCase())) return origin;
  return null;
}

/**
 * The no-script route's plain answers (GET /go). The Arabic lines are DRAFT:
 * new for this route, written under aziz-kuwaiti-voice and waiting for the
 * CEO's review (README "Arabic still to approve"). `preparing` is the same
 * pair as the page's own (sites/call-link/core.js COPY.preparing); a test
 * keeps the two equal.
 */
export const GO_COPY = {
  preview: {
    en: "Open this link on your phone to join the call.",
    ar: "افتح هاللينك من تلفونك عشان تدخل المكالمة.", // DRAFT
  },
  preparing: {
    en: "Your call is almost ready. This page opens it by itself.",
    ar: "مكالمتك قاعدة تتجهز.. بنفتحها لك أول ما تجهز.", // DRAFT
  },
  // The lead reads these when the no-script link cannot open the room, so
  // each says what to do next, in both languages (the page's own pattern).
  unavailable: {
    en: "This call link cannot be opened right now. Reply to our message and we will send it again.",
    ar: "ما نقدر نفتح لينك المكالمة الحين. رد على رسالتنا ونرسله لك مرة ثانية.", // DRAFT
  },
  busy: {
    en: "Too many tries from this network. Wait a minute, then open the link again.",
    ar: "محاولات كثيرة من نفس الشبكة. انطر دقيقة وبعدين افتح اللينك مرة ثانية.", // DRAFT
  },
  unread: {
    en: "This call link could not be read just now. Try again in a moment.",
    ar: "ما قدرنا نقرا لينك المكالمة الحين. حاول مرة ثانية بعد شوي.", // DRAFT
  },
  broken: {
    en: "This room's link cannot be opened. Reply to our message and we will send a new one.",
    ar: "هاللينك مو شغال. رد على رسالتنا ونرسل لك لينك يديد.",
  },
} as const;
