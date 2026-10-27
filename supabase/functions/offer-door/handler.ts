// offer-door's routes (README.md). Everything that touches the network or
// the clock comes in through Deps, so `bun test` runs it with no network.
//
//   GET  /p/{code}?d={device}&pv={token}  the offer page asks for its proposal
//   POST /p/{code}/event                  the page's play and Yes presses ({kind, d, pv?})
//   GET  /v/{code}                        a pitch's video link (WhatsApp), 302
//   GET  /health                          the doctor: which routes are open
//
// The database decides what a code shows (cockpit_upsell_door_open,
// _event, _video: service key only) and counts each open, play, Yes and
// video view. The door adds the page's origin check, sales-live's rate
// limits, its preview-bot rule and its salted address, and turns each
// picture's storage path into a link that lasts SIGN_SECONDS. No client
// data goes into any URL it answers with.

import { clientIp, deviceIdOk, deviceOf, ipHash, isPreviewBot, limitNet, type RateLimiter } from "../sales-live/door.ts";
import { sha256Hex } from "../sales-live/sign.ts";
import { fetchTextWithin, redact, Timeout } from "../sales-live/util.ts";
import {
  allowedOfferOrigin,
  BASE_HEADERS,
  type DoorRouteName,
  doorRoute,
  EVENT_MAX_BYTES,
  missingFor,
  missingSentence,
  NEEDS,
  normalizeOfferCode,
  offerSite,
  PICTURE_BUCKETS,
  PREVIEW_TOKEN,
  PROPOSAL_CODE,
  pictureRefs,
  publicUrl,
  refKey,
  SIGN_SECONDS,
  type StorageRef,
  VIDEO_CODE,
  videoPageOk,
  withLinks,
} from "./door.ts";

export interface Deps {
  env: (name: string) => string;
  fetch: typeof fetch;
  /** Wall-clock time (rate-limit windows, the status memo). */
  now: () => number;
  /** Work that may finish after the answer (EdgeRuntime.waitUntil when present). */
  background: (p: Promise<unknown>) => void;
  /** Per salted address and device: 30 a minute. */
  limiter: RateLimiter;
  /** Per salted address, every device together: 120 a minute. */
  wideLimiter: RateLimiter;
  log: (line: string) => void;
  /** Shorter waits for tests. */
  budget?: Partial<Record<keyof typeof BUDGET, number>>;
}

/** Budgets in ms. The page waits about 6 s for /p. */
export const BUDGET = { open: 3000, sign: 1500, event: 2500, video: 2500, status: 3000 } as const;
const STATUS_EVERY_MS = 60_000;
const STATES = new Set(["open", "expired", "archived", "unknown"]);
/** What the page reads when its proposal cannot be given: one shape for every cause, no operator words. */
const PAGE_ERROR = { state: "error", proposal: null, contact: null } as const;
const NOT_RECORDED = { error: "Not recorded." } as const;

type Route = Exclude<DoorRouteName, "health">;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}
function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, ...headers } });
}
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, location } });
}

/** A database or Storage answer that was not 2xx; `status` 0 when there was no answer. */
class DbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The raw body, or null when it is larger than `max` (read a chunk at a time, never whole). */
async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const env = (n: string) => (deps.env(n) ?? "").trim();
  const B: Record<keyof typeof BUDGET, number> = { ...BUDGET, ...(deps.budget ?? {}) };
  const statusMemo = new Map<Route, { ok: boolean; at: number }>();

  function db(): { base: string; key: string } | null {
    const base = env("SUPABASE_URL").replace(/\/+$/, "");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    return base && key ? { base, key } : null;
  }

  /** One call to Supabase with the service key. Throws a redacted DbError on any failure. */
  async function call(path: string, body: unknown, ms: number): Promise<unknown> {
    const cfg = db();
    if (!cfg) throw new DbError("offer-door cannot reach the database: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.", 0);
    const where = path.split("?")[0];
    let res: { ok: boolean; status: number; text: string };
    try {
      res = await fetchTextWithin(
        deps.fetch,
        `${cfg.base}/${path}`,
        {
          method: "POST",
          headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        ms,
      );
    } catch (e) {
      throw new DbError(`database ${e instanceof Timeout ? e.message : redact((e as Error)?.message ?? e)} on ${where}`, 0);
    }
    if (!res.ok) throw new DbError(`database ${res.status} on ${where}: ${redact(res.text)}`, res.status);
    if (!res.text) return null;
    try {
      return JSON.parse(res.text);
    } catch {
      throw new DbError(`database answered something that is not JSON on ${where}`, 0);
    }
  }
  const rpc = (name: string, args: Record<string, unknown>, ms: number) => call(`rest/v1/rpc/${name}`, args, ms);

  /**
   * Each route's last outcome in cockpit_upsell_door_status, so a door that
   * stopped working reads "Opens unknown" on the proposal cards, never zero.
   * Sent when the outcome changes, else at most once a minute (the function
   * applies the same rule again on its side).
   */
  function noteStatus(route: Route, ok: boolean, sentence: string): void {
    const now = deps.now();
    const last = statusMemo.get(route);
    if (last && last.ok === ok && now - last.at < STATUS_EVERY_MS) return;
    statusMemo.set(route, { ok, at: now });
    if (!ok) deps.log(`offer-door ${route}: ${sentence}`);
    if (!db()) return;
    deps.background(
      rpc("cockpit_upsell_door_status_set", { p_route: route, p_ok: ok, p_sentence: ok ? null : redact(sentence).slice(0, 200) }, B.status).catch(e =>
        deps.log(`offer-door status ${route} not written: ${redact((e as Error).message)}`),
      ),
    );
  }

  /** A route closed by missing secrets: their names in the status row and the log (and /health), never their values or a client's screen. */
  function closed(route: Route): string | null {
    const missing = missingFor(route, env);
    if (!missing.length) return null;
    const sentence = missingSentence(route, missing);
    noteStatus(route, false, sentence);
    return sentence;
  }

  /** Who is asking, as the door keeps it: the limit's key, the stored hash and the device kind. */
  async function visitor(req: Request): Promise<{ limitKey: string; stored: string; kind: string | null }> {
    const salt = env("OFFER_IP_SALT");
    const net = limitNet(clientIp(req.headers));
    return {
      limitKey: await ipHash(salt, net),
      // cockpit_upsell_views keeps a whole sha256 (64 hex), salted for this door alone.
      stored: await sha256Hex(`${salt}:offer-door:${net}`),
      kind: deviceOf(req.headers.get("user-agent")),
    };
  }

  /** sales-live's limits: 30 a minute per address and device, 120 per address. */
  function overLimit(scope: string, limitKey: string, device: string | null): boolean {
    const now = deps.now();
    const wide = deps.wideLimiter.hit(`${scope}:${limitKey}`, now);
    const narrow = deps.limiter.hit(`${scope}:${limitKey}:${device ?? "-"}`, now);
    return !(wide && narrow);
  }

  /** Links for a proposal's pictures: the verified logos' public address, the rest signed for SIGN_SECONDS. */
  async function links(refs: StorageRef[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const cfg = db();
    if (!cfg) return out;
    const signed = new Map<string, string[]>();
    for (const r of refs) {
      if (PICTURE_BUCKETS[r.bucket] === "public") out.set(refKey(r), publicUrl(cfg.base, r));
      else signed.set(r.bucket, [...(signed.get(r.bucket) ?? []), r.path]);
    }
    for (const [bucket, paths] of signed) {
      try {
        const answer = await call(`storage/v1/object/sign/${bucket}`, { expiresIn: SIGN_SECONDS, paths: [...new Set(paths)] }, B.sign);
        for (const s of Array.isArray(answer) ? answer : []) {
          const row = s as { path?: unknown; signedURL?: unknown; error?: unknown };
          if (row.error || typeof row.path !== "string" || typeof row.signedURL !== "string") continue;
          if (!row.signedURL.startsWith(`/object/sign/${bucket}/`)) continue;
          out.set(`${bucket}/${row.path}`, `${cfg.base}/storage/v1${row.signedURL}`);
        }
      } catch (e) {
        // The page still opens; a picture with no link is left out, never guessed.
        deps.log(`offer-door pictures in ${bucket} not signed: ${redact((e as Error).message)}`);
      }
    }
    return out;
  }

  async function openRoute(req: Request, url: URL, rawCode: string | undefined, cors: Record<string, string>): Promise<Response> {
    // The page gets the same shape as any other error; the missing secret's name goes to the status row,
    // the log and /health (closed() writes it), never to a client's browser.
    if (closed("p")) return json(PAGE_ERROR, 503, cors);
    const code = normalizeOfferCode(rawCode, PROPOSAL_CODE);
    const unknown = { state: "unknown", proposal: null, contact: null };
    if (!code) return json(unknown, 200, cors);
    // A link preview or a crawler (or a HEAD): told nothing, counted nowhere.
    if (isPreviewBot(req.headers.get("user-agent"), req.method)) return json(unknown, 200, cors);
    const rawDevice = url.searchParams.get("d");
    const device = deviceIdOk(rawDevice) ? rawDevice : null;
    const pv = (url.searchParams.get("pv") ?? "").trim().toLowerCase();
    const who = await visitor(req);
    if (overLimit("p", who.limitKey, device)) return json({ state: "busy", proposal: null, contact: null }, 429, { ...cors, "retry-after": "60" });
    let answer: unknown;
    try {
      answer = await rpc(
        "cockpit_upsell_door_open",
        { p_code: code, p_device: device, p_ip_hash: who.stored, p_device_kind: who.kind, p_preview: PREVIEW_TOKEN.test(pv) ? pv : null },
        B.open,
      );
    } catch (e) {
      noteStatus("p", false, `The proposal page could not be read: ${(e as Error).message}`);
      return json(PAGE_ERROR, 502, cors);
    }
    const a = (answer ?? {}) as { state?: unknown; proposal?: unknown; contact?: { whatsapp?: unknown } | null };
    if (typeof a.state !== "string" || !STATES.has(a.state)) {
      noteStatus("p", false, "The database answered the proposal page with no state.");
      return json(PAGE_ERROR, 502, cors);
    }
    noteStatus("p", true, "");
    const digits = typeof a.contact?.whatsapp === "string" && /^[0-9]{8,15}$/.test(a.contact.whatsapp) ? a.contact.whatsapp : null;
    const proposal = a.state === "open" && a.proposal ? withLinks(a.proposal, await links(pictureRefs(a.proposal))) : null;
    return json({ state: a.state, proposal, contact: { whatsapp: digits } }, 200, cors);
  }

  async function eventRoute(req: Request, rawCode: string | undefined, cors: Record<string, string>): Promise<Response> {
    if (closed("event")) return json(NOT_RECORDED, 503, cors);
    const raw = await readBody(req, EVENT_MAX_BYTES);
    if (!raw) return json({ error: "The event is larger than 1 KB." }, 413, cors);
    let body: { kind?: unknown; d?: unknown; pv?: unknown };
    try {
      body = JSON.parse(new TextDecoder().decode(raw) || "{}");
    } catch {
      return json({ error: "Send the event as JSON." }, 400, cors);
    }
    if (!body || typeof body !== "object" || (body.kind !== "play" && body.kind !== "cta")) return json({ error: "An event is play or cta." }, 400, cors);
    // A live preview (the CSM checking the page) plays and presses Yes too: never counted as the client.
    if (typeof body.pv === "string" && PREVIEW_TOKEN.test(body.pv.trim().toLowerCase())) return empty(204, cors);
    const code = normalizeOfferCode(rawCode, PROPOSAL_CODE);
    if (!code || isPreviewBot(req.headers.get("user-agent"), req.method)) return empty(204, cors);
    const device = typeof body.d === "string" && deviceIdOk(body.d) ? body.d : null;
    const who = await visitor(req);
    if (overLimit("event", who.limitKey, device)) return json({ error: "Too many presses. Wait a minute." }, 429, { ...cors, "retry-after": "60" });
    try {
      await rpc("cockpit_upsell_door_event", { p_code: code, p_kind: body.kind, p_device: device, p_ip_hash: who.stored, p_device_kind: who.kind }, B.event);
    } catch (e) {
      noteStatus("event", false, `A press on the proposal page was not recorded: ${(e as Error).message}`);
      return json(NOT_RECORDED, 502, cors);
    }
    noteStatus("event", true, "");
    return empty(204, cors);
  }

  async function videoRoute(req: Request, rawCode: string | undefined): Promise<Response> {
    const site = offerSite(env("OFFER_SITE_URL"));
    // The client taps this in WhatsApp: a closed door sends them to the offer site's own error page. The
    // missing secret's name goes to the status row, the log and /health, never to their screen.
    if (closed("v")) return redirect(`${site}/?error=1`);
    const code = normalizeOfferCode(rawCode, VIDEO_CODE);
    if (!code) return redirect(`${site}/?gone=1`);
    // WhatsApp's own preview fetch and link checkers: sent to the site's front page, not counted.
    if (isPreviewBot(req.headers.get("user-agent"), req.method)) return redirect(`${site}/`);
    const who = await visitor(req);
    if (overLimit("v", who.limitKey, null)) return redirect(`${site}/?busy=1`);
    let answer: unknown;
    try {
      answer = await rpc("cockpit_upsell_door_video", { p_code: code, p_device: null, p_ip_hash: who.stored, p_device_kind: who.kind }, B.video);
    } catch (e) {
      noteStatus("v", false, `A video link could not be read: ${(e as Error).message}`);
      return redirect(`${site}/?error=1`);
    }
    noteStatus("v", true, "");
    const a = (answer ?? {}) as { state?: unknown; url?: unknown };
    const target = a.state === "open" ? videoPageOk(a.url) : null;
    return redirect(target ?? `${site}/?gone=1`);
  }

  function health(): Response {
    const routes = Object.fromEntries(
      (Object.keys(NEEDS) as Route[]).map(r => {
        const missing = missingFor(r, env);
        return [r, { ok: !missing.length, missing }];
      }),
    ) as Record<Route, { ok: boolean; missing: string[] }>;
    const ok = Object.values(routes).every(r => r.ok);
    return json({ ok, site: offerSite(env("OFFER_SITE_URL")), routes }, ok ? 200 : 503);
  }

  return async (req: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return json({ error: "Not found." }, 404);
    }
    const route = doorRoute(url.pathname);
    const method = req.method.toUpperCase();
    const pageRoute = route.name === "p" || route.name === "event";
    // Only the offer page (or a local run of it) may read a proposal or record a press. Worked out before
    // anything can throw, so even the last-resort answer below is one the page can read.
    const origin = pageRoute ? allowedOfferOrigin(req.headers.get("origin"), offerSite(env("OFFER_SITE_URL"))) : null;
    const cors: Record<string, string> = origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
    try {
      if (route.name === "health") return method === "GET" || method === "HEAD" ? health() : json({ error: "Use GET." }, 405);
      if (route.name === "v") return method === "GET" || method === "HEAD" ? await videoRoute(req, route.code) : text("Use GET.", 405);
      if (pageRoute) {
        if (!origin) return json({ error: "Not an allowed origin." }, 403);
        if (method === "OPTIONS") {
          return empty(204, {
            ...cors,
            "access-control-allow-methods": route.name === "p" ? "GET" : "POST",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "600",
          });
        }
        if (route.name === "p") return method === "GET" || method === "HEAD" ? await openRoute(req, url, route.code, cors) : json({ error: "Use GET." }, 405, cors);
        return method === "POST" ? await eventRoute(req, route.code, cors) : json({ error: "Use POST." }, 405, cors);
      }
      return json({ error: "Not found." }, 404);
    } catch (e) {
      deps.log(`offer-door ${route.name ?? "unknown"} failed: ${redact((e as Error)?.message ?? e)}`);
      if (route.name === "v") return redirect(`${offerSite(env("OFFER_SITE_URL"))}/?error=1`);
      if (route.name === "p") return json(PAGE_ERROR, 500, cors);
      if (route.name === "event") return json(NOT_RECORDED, 500, cors);
      return json({ error: "Not answered." }, 500);
    }
  };
}
