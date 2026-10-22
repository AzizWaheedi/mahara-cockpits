// page-form-events: where visitors stop on a client's own form page
// (olivar-landing step-form pages, Merge Studio first), into
// public.cockpit_page_form_events (Creative Triage bldgtotkfmhoxmlzowdx).
//
// The page sends one small event per screen a visit reaches, with
// sendBeacon (text/plain, so no preflight). The function is public
// (verify_jwt false): a browser has no key to send. So everything is checked
// here instead, as in webinar-events:
//
// - only the page's own hosts (cockpit_page_forms.event_hosts) and localhost
//   may post; each row keeps its host, and the funnel counts only the page's
//   own hosts;
// - every field is whitelisted, trimmed and capped; anything else is dropped;
// - crawlers and link previews are dropped;
// - at most 10 events per request and 60 per minute per address (per running
//   instance, which is enough against a stuck page);
// - one row per visit and screen (a repeat is ignored);
// - nothing personal and no answers are stored. The visit id is random and
//   lives in the visitor's tab.

export const SCREEN = /^(intro|contact|send|thanks|q:[a-z][a-z0-9_]{1,39})$/;
const SLUG = /^[a-z][a-z0-9-]{1,40}$/;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,20}$/;
const DIGITS = /^\d{1,30}$/;
const BOT =
  /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|embedly|preview|headless|lighthouse|pingdom|uptime|curl\/|python-requests|wget/i;
const MAX_BATCH = 10;
const PER_MINUTE = 60;
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

export type Row = Record<string, unknown>;
export type Deps = {
  /** The hosts that may post for a page, or null when there is no such page. */
  hosts(slug: string): Promise<string[] | null>;
  insert(rows: Row[]): Promise<{ ok: boolean; status: number; detail?: string }>;
};

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const text = (x: unknown, max: number): string | null => {
  if (typeof x !== "string") return null;
  const t = x.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

function device(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

/** One event, checked field by field; null when it cannot be stored. */
export function clean(e: unknown, host: string, ua: string): Row | null {
  if (!e || typeof e !== "object") return null;
  const x = e as Record<string, unknown>;
  const slug = text(x.slug, 41);
  const session = text(x.session_id, 64);
  const version = text(x.form_version, 20);
  const screen = text(x.screen, 42);
  if (!slug || !SLUG.test(slug)) return null;
  if (!session || !ID.test(session)) return null;
  if (!version || !VERSION.test(version)) return null;
  if (!screen || !SCREEN.test(screen)) return null;
  const step =
    Number.isInteger(x.step) && (x.step as number) >= 0 && (x.step as number) <= 40
      ? (x.step as number)
      : null;
  const id = (v: unknown) => {
    const t = text(v, 30);
    return t && DIGITS.test(t) ? t : null;
  };
  return {
    slug,
    origin_host: host,
    session_id: session,
    form_version: version,
    screen,
    step,
    utm_source: text(x.utm_source, 200),
    utm_medium: text(x.utm_medium, 200),
    utm_campaign: text(x.utm_campaign, 200),
    utm_content: text(x.utm_content, 200),
    ad_id: id(x.ad_id),
    campaign_id: id(x.campaign_id),
    has_fbclid: x.has_fbclid === true,
    device: device(ua),
  };
}

// Per running instance: events per address in the current minute.
const seen = new Map<string, { minute: number; n: number }>();
function allow(ip: string, n: number): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const s = seen.get(ip);
  if (!s || s.minute !== minute) {
    if (seen.size > 5000) seen.clear();
    seen.set(ip, { minute, n });
    return n <= PER_MINUTE;
  }
  s.n += n;
  return s.n <= PER_MINUTE;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin") ?? "";
  let host = "";
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    host = "";
  }
  const headers = cors(host ? origin : null);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  if (!host) return new Response(null, { status: 403, headers });
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204, headers });

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return new Response(null, { status: 413, headers });
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const list = Array.isArray((body as { events?: unknown })?.events)
    ? (body as { events: unknown[] }).events.slice(0, MAX_BATCH)
    : [body];
  const rows = list.map(e => clean(e, host, ua)).filter((r): r is Row => r !== null);
  if (!rows.length) return new Response(null, { status: 204, headers });

  // Every event in a request must be for a page this host may post for.
  const slugs = [...new Set(rows.map(r => String(r.slug)))];
  for (const slug of slugs) {
    const hosts = await deps.hosts(slug);
    if (!hosts || !(hosts.includes(host) || LOCAL.test(host)))
      return new Response(null, { status: 403, headers });
  }

  // The address the edge saw, never the first X-Forwarded-For entry (the
  // client writes that one): Cloudflare's header, else the last hop.
  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  const ip = req.headers.get("cf-connecting-ip")?.trim() || hops.at(-1) || "unknown";
  if (!allow(ip, rows.length)) return new Response(null, { status: 429, headers });

  const res = await deps.insert(rows);
  if (!res.ok) {
    console.error(`page-form-events insert failed ${res.status}: ${(res.detail ?? "").slice(0, 200)}`);
    return new Response(null, { status: 502, headers });
  }
  return new Response(null, { status: 204, headers });
}
