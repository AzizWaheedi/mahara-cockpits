// webinar-events: page events from the live training's site into
// public.cockpit_webinar_page_events (Creative Triage bldgtotkfmhoxmlzowdx).
//
// webinar.maharamedia.com loads /mm-track.js (sites/webinar/mm-track.js in
// the repo), which posts small batches here with sendBeacon or fetch. The
// function is public (verify_jwt false): a browser has no key to send. So
// everything is checked here instead:
//
// - only the live site, its Vercel previews and localhost may post, and each
//   row keeps the host it came from; the cockpit counts only the live site;
// - every field is whitelisted, trimmed and capped; unknown events are
//   dropped, never stored;
// - crawlers and link previews are dropped;
// - at most 20 events per request and 120 per minute per address (per
//   running instance, which is enough against a stuck page);
// - nothing personal is stored: no IP, no name, email or phone. The visitor
//   id is random and lives in the visitor's browser.
//
// The service role key is the one Supabase gives every function. It is never
// logged or returned.

const EVENTS = new Set([
  "page_view",
  "page_leave",
  "scroll",
  "cta_click",
  "form_view",
  "form_focus",
  "form_submit",
  "video_play",
  "video_progress",
  "calendar_add",
  "whatsapp_click",
  "survey_start",
  "survey_submit",
  "join_click",
  "pitch_click",
]);
const PAGES = new Set(["landing", "thank_you", "live", "pitch"]);
const LIVE_HOST = "webinar.maharamedia.com";
const BOT =
  /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|embedly|preview|headless|lighthouse|pingdom|uptime|curl\/|python-requests|wget/i;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_BATCH = 20;
const PER_MINUTE = 120;

/** The host a request came from, when it is one that may post here. */
function allowedHost(origin: string): string | null {
  let host = "";
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
  if (host === LIVE_HOST) return host;
  if (/^mahara-webinar(-[a-z0-9-]+)?\.vercel\.app$/.test(host)) return host;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return host;
  return null;
}

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? `https://${LIVE_HOST}`,
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

type Row = Record<string, unknown>;

/** One event, checked field by field; null when it cannot be stored. */
function clean(e: unknown, originHost: string, ua: string, now: number): Row | null {
  if (!e || typeof e !== "object") return null;
  const x = e as Record<string, unknown>;
  const event = text(x.event, 30);
  const page = text(x.page, 20);
  const eventId = text(x.event_id, 64);
  const visitor = text(x.visitor_id, 64);
  const session = text(x.session_id, 64);
  if (!event || !EVENTS.has(event)) return null;
  if (!page || !PAGES.has(page)) return null;
  if (!eventId || !ID.test(eventId)) return null;
  if (!visitor || !ID.test(visitor) || !session || !ID.test(session)) return null;
  const value =
    typeof x.value === "number" && Number.isFinite(x.value)
      ? Math.max(0, Math.min(100_000, x.value))
      : null;
  const clientAt = typeof x.client_at === "string" ? Date.parse(x.client_at) : NaN;
  const lang = text(x.lang, 5);
  let referrer = text(x.referrer_host, 200);
  if (referrer && !/^[a-z0-9.-]+$/i.test(referrer)) referrer = null;
  const path = text(x.path, 200);
  return {
    event_id: eventId,
    client_at:
      Number.isFinite(clientAt) && Math.abs(clientAt - now) < 86_400_000
        ? new Date(clientAt).toISOString()
        : null,
    origin_host: originHost,
    page,
    event,
    visitor_id: visitor,
    session_id: session,
    label: text(x.label, 80),
    value,
    utm_source: text(x.utm_source, 200),
    utm_medium: text(x.utm_medium, 200),
    utm_campaign: text(x.utm_campaign, 200),
    utm_content: text(x.utm_content, 200),
    utm_term: text(x.utm_term, 200),
    has_fbclid: x.has_fbclid === true,
    referrer_host: referrer ? referrer.toLowerCase() : null,
    lang: lang === "ar" || lang === "en" ? lang : null,
    device: device(ua),
    path: path && path.startsWith("/") ? path : null,
  };
}

// Per running instance: requests per address in the current minute.
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

Deno.serve(async req => {
  const origin = req.headers.get("origin") ?? "";
  const host = allowedHost(origin);
  const headers = cors(host ? origin : null);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  if (!host) return new Response(null, { status: 403, headers });
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204, headers });

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 32_000) return new Response(null, { status: 413, headers });
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const list = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: unknown[] }).events).slice(0, MAX_BATCH)
    : [body];
  const now = Date.now();
  const rows = list
    .map(e => clean(e, host, ua, now))
    .filter((r): r is Row => r !== null);
  if (!rows.length) return new Response(null, { status: 204, headers });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!allow(ip, rows.length))
    return new Response(null, { status: 429, headers });

  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(
    `${base}/rest/v1/cockpit_webinar_page_events?on_conflict=event_id`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    console.error(`insert failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Response(null, { status: 502, headers });
  }
  return new Response(null, { status: 204, headers });
});
