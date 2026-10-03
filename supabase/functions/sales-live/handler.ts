// sales-live: the one public door of the live-call work (verify_jwt off).
// Every route checks its own key first. index.ts wires this to Deno.serve
// with the real environment; the tests wire it to fakes.
//
//   POST /zoom        Zoom's meeting events. Signature, then url_validation,
//                     then stored once (dedupe key) and answered 200 inside
//                     Zoom's 3 s; passed to sales-api room.event afterwards.
//   POST /slack       The "Mahara Sales" app: /available, /unavailable,
//                     button presses and app_home_opened, passed to
//                     sales-api live.press. Answered inside Slack's 3 s.
//   GET  /open/{code} The short page's script: where the room is, recorded
//                     once per device.
//   GET  /go/{code}   The no-script fallback: a 302 to the room or the
//                     ended page. Records nothing.
//   POST /cron        pg_cron's way in to sales-api (allow-list only).
//   GET  /health      Which routes are ready, by name only, never a value.

import { cronForwardable, CRON_MAX_BYTES } from "./cron.ts";
import {
  allowedOrigin,
  clientIp,
  deviceIdOk,
  deviceOf,
  doorView,
  FINAL_STATES,
  firstName,
  ipHash,
  isPreviewBot,
  MAX_HOPS,
  normalizeCode,
  osOf,
  type RateLimiter,
  type Rep,
  ROOM_COLUMNS,
  type RoomRow,
  roomIsOver,
  routeOf,
  whatsappDigits,
} from "./door.ts";
import {
  plainTokenOk,
  sha256Hex,
  slackSignatureOk,
  timingSafeEqual,
  zoomSignatureOk,
  zoomValidationAnswer,
} from "./sign.ts";
import { type Press, parseSlack, pressFor, SLACK_COPY } from "./slack.ts";
import { fetchWithin, redact, sleep, Timeout } from "./util.ts";
import {
  cleanZoom,
  codeFromTopic,
  VALIDATION_EVENT,
  ZOOM_EVENTS,
  type ZoomDetail,
  zoomDedupeKey,
  zoomKind,
} from "./zoom.ts";

export interface Deps {
  env: (name: string) => string;
  fetch: typeof fetch;
  now: () => number;
  /** Work that may finish after the answer (EdgeRuntime.waitUntil when present). */
  background: (p: Promise<unknown>) => void;
  limiter: RateLimiter;
  log: (line: string) => void;
  /** Shorter waits for tests; production uses BUDGET as it stands. */
  budget?: Partial<Record<keyof typeof BUDGET, number>>;
}

type Row = Record<string, unknown>;

export const MISSING = {
  zoom: "Zoom events cannot be checked yet: ZOOM_WEBHOOK_SECRET is missing on sales-live. Add it to the function's secrets.",
  slack: "Slack requests cannot be checked yet: SLACK_SIGNING_SECRET is missing on sales-live. Add it to the function's secrets.",
  salt: "Opens cannot be recorded yet: IP_SALT is missing on sales-live. Add it to the function's secrets.",
  cron: "The cron door is closed: CRON_SECRET is missing on sales-live. Add it to the function's secrets.",
  db: "sales-live cannot reach the database: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.",
} as const;

/** Budgets, in ms. Zoom and Slack want an answer within 3 s. */
export const BUDGET = {
  zoomFind: 500,
  zoomStore: 1800,
  roomRead: 2000,
  repRead: 1500,
  settingRead: 1000,
  record: 3000,
  forwardZoom: 15_000,
  forwardSlack: 20_000,
  forwardCron: 25_000,
  slackReply: 5000,
  status: 3000,
} as const;

const ZOOM_MAX_BYTES = 256_000;
const SLACK_MAX_BYTES = 64_000;
const STATUS_EVERY_MS = 60_000;
const DEFAULT_SITE = "https://call.maharamedia.com";

/** Answers that are the sales-api gateway's own, not a sentence for a person. */
const GATEWAY_ERRORS = new Set([
  "Unknown action.",
  "Not an action the desk may take.",
  "Sign in again.",
  "Send a JSON body.",
  "Send a POST.",
  "Not an allowed origin.",
]);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** Plain text, for the no-script route: Supabase serves function HTML as text. */
function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...headers,
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

/** The raw body, or null when it is larger than `max`. */
async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  return bytes.length > max ? null : bytes;
}

const decoder = new TextDecoder();

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const env = (n: string) => (deps.env(n) ?? "").trim();
  const B: Record<keyof typeof BUDGET, number> = { ...BUDGET, ...(deps.budget ?? {}) };
  const statusMemo = new Map<string, { ok: boolean; at: number }>();

  function db(): { base: string; key: string } | null {
    const base = env("SUPABASE_URL").replace(/\/+$/, "");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    return base && key ? { base, key } : null;
  }

  function site(): string {
    const s = env("CALL_SITE_URL");
    return /^https:\/\/[a-z0-9.-]+$/i.test(s) ? s.replace(/\/+$/, "") : DEFAULT_SITE;
  }

  /** PostgREST with the service key. Throws a redacted error on any failure. */
  async function rest(
    path: string,
    init: { method?: string; body?: unknown; prefer?: string; ms: number },
  ): Promise<unknown> {
    const cfg = db();
    if (!cfg) throw new Error(MISSING.db);
    let res: Response;
    try {
      res = await fetchWithin(
        deps.fetch,
        `${cfg.base}/rest/v1/${path}`,
        {
          method: init.method ?? "GET",
          headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            "Content-Type": "application/json",
            ...(init.prefer ? { Prefer: init.prefer } : {}),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        },
        init.ms,
      );
    } catch (e) {
      throw new Error(`database ${e instanceof Timeout ? e.message : redact((e as Error)?.message ?? e)} on ${path.split("?")[0]}`);
    }
    const body = await res.text();
    if (!res.ok) throw new Error(`database ${res.status} on ${path.split("?")[0]}: ${redact(body)}`);
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  /**
   * The last outcome of each route in cockpit_sales_worker_status (worker
   * sales-live), so a door that stopped working is a red row, never a zero.
   * Written when the outcome changes, else at most once a minute.
   */
  function noteStatus(job: string, ok: boolean, detail: string): void {
    const now = deps.now();
    const last = statusMemo.get(job);
    if (last && last.ok === ok && now - last.at < STATUS_EVERY_MS) return;
    statusMemo.set(job, { ok, at: now });
    if (!ok) deps.log(`sales-live ${job}: ${detail}`);
    if (!db()) return;
    deps.background(
      rest("cockpit_sales_worker_status?on_conflict=worker,job", {
        method: "POST",
        body: { worker: "sales-live", job, ok, detail: redact(detail), at: new Date(now).toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
        ms: B.status,
      }).catch(e => deps.log(`sales-live status ${job} not written: ${redact((e as Error).message)}`)),
    );
  }

  /** Inserts one room event; true when it is new, false when its key was there. */
  async function insertEvent(row: Row, ms: number): Promise<boolean> {
    const out = await rest("cockpit_sales_room_events?on_conflict=dedupe_key&select=dedupe_key", {
      method: "POST",
      body: row,
      prefer: "resolution=ignore-duplicates,return=representation",
      ms,
    });
    return Array.isArray(out) && out.length > 0;
  }

  /**
   * A call to sales-api the way sales-mirror makes it: the project key for
   * the gateway, the cron secret for the action. Retries only a network
   * failure, a timeout or a 5xx, and only `tries` times in all.
   */
  async function salesApi(
    body: Row,
    opts: { ms: number; tries: number },
  ): Promise<{ ok: boolean; status: number; text: string; json: Row | null }> {
    const cfg = db();
    const cron = env("CRON_SECRET");
    if (!cfg || !cron) return { ok: false, status: 0, text: "", json: null };
    let last = { ok: false, status: 0, text: "", json: null as Row | null };
    for (let attempt = 1; attempt <= Math.max(1, opts.tries); attempt++) {
      try {
        const res = await fetchWithin(
          deps.fetch,
          `${cfg.base}/functions/v1/sales-api`,
          {
            method: "POST",
            headers: {
              apikey: cfg.key,
              Authorization: `Bearer ${cfg.key}`,
              "x-cron-secret": cron,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
          opts.ms,
        );
        const t = await res.text();
        let j: Row | null = null;
        try {
          j = JSON.parse(t) as Row;
        } catch {
          j = null;
        }
        last = { ok: res.ok && j?.ok !== false, status: res.status, text: t, json: j };
        if (res.status < 500) return last;
      } catch (e) {
        last = { ok: false, status: 0, text: redact((e as Error)?.message ?? e), json: null };
      }
      if (attempt < opts.tries) await sleep(400 * attempt);
    }
    return last;
  }

  // ------------------------------------------------------------------ zoom

  async function findZoomRoom(d: ZoomDetail): Promise<string | null> {
    const id = d.meeting.id;
    if (id && /^\d{6,20}$/.test(id)) {
      const rows = (await rest(
        `cockpit_sales_rooms?provider_meeting_id=eq.${id}&select=id,state&limit=10`,
        { ms: B.zoomFind },
      )) as { id: string; state: string }[] | null;
      const all = Array.isArray(rows) ? rows : [];
      const live = all.filter(r => !FINAL_STATES.has(r.state));
      if (live.length === 1) return live[0].id;
      if (live.length === 0 && all.length === 1) return all[0].id;
      // None, or several (a booked room re-wraps the same meeting): the topic may say.
    }
    const code = codeFromTopic(d.meeting.topic);
    if (code) {
      const rows = (await rest(`cockpit_sales_rooms?code=eq.${code}&select=id&limit=1`, {
        ms: B.zoomFind,
      })) as { id: string }[] | null;
      if (Array.isArray(rows) && rows[0]?.id) return rows[0].id;
    }
    return null;
  }

  async function forwardZoom(kind: string, roomId: string | null, key: string, d: ZoomDetail) {
    if (!env("CRON_SECRET")) {
      noteStatus("zoom", false, "Zoom events are stored but not passed on: CRON_SECRET is missing on sales-live.");
      return;
    }
    const res = await salesApi(
      { action: "room.event", kind, source: "zoom", room_id: roomId, dedupe_key: key, payload: d },
      { ms: B.forwardZoom, tries: 2 },
    );
    if (res.ok) noteStatus("zoom", true, `Last Zoom event (${d.event}) stored and passed on.`);
    else
      noteStatus(
        "zoom",
        false,
        `A Zoom event (${d.event}) was stored, but sales-api did not take it (${res.status || "no answer"}). The sweep replays it.`,
      );
  }

  async function zoomRoute(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "Send a POST." }, 405);
    const secret = env("ZOOM_WEBHOOK_SECRET");
    if (!secret) {
      noteStatus("zoom", false, MISSING.zoom);
      return json({ ok: false, error: MISSING.zoom }, 503);
    }
    const bytes = await readBody(req, ZOOM_MAX_BYTES);
    if (!bytes) return json({ ok: false, error: "That body is too large." }, 413);
    const signed = await zoomSignatureOk(
      secret,
      req.headers.get("x-zm-request-timestamp"),
      bytes,
      req.headers.get("x-zm-signature"),
    );
    if (!signed) return json({ ok: false, error: "The Zoom signature does not match." }, 401);

    let body: Row;
    try {
      body = JSON.parse(decoder.decode(bytes)) as Row;
    } catch {
      return json({ ok: false, error: "Send a JSON body." }, 400);
    }
    if (body?.event === VALIDATION_EVENT) {
      const token = (body.payload as Row | undefined)?.plainToken;
      if (!plainTokenOk(token)) return json({ ok: false, error: "The plainToken is missing." }, 400);
      noteStatus("zoom", true, "Zoom validated this endpoint.");
      return json(await zoomValidationAnswer(secret, token));
    }
    const detail = cleanZoom(body);
    if (!detail) return json({ ok: false, error: "That is not a Zoom event." }, 400);
    if (!ZOOM_EVENTS.has(detail.event)) return json({ ok: true, ignored: detail.event });
    if (!db()) {
      noteStatus("zoom", false, MISSING.db);
      return json({ ok: false, error: MISSING.db }, 503);
    }

    const key = await zoomDedupeKey(detail);
    const kind = zoomKind(detail.event);
    const roomId = await findZoomRoom(detail).catch(e => {
      deps.log(`sales-live zoom: room not found in time: ${redact((e as Error).message)}`);
      return null;
    });
    let inserted: boolean;
    try {
      inserted = await insertEvent(
        { room_id: roomId, kind, source: "zoom", dedupe_key: key, detail },
        B.zoomStore,
      );
    } catch (e) {
      noteStatus("zoom", false, `Zoom events cannot be stored: ${redact((e as Error).message)}. Zoom retries in 5 minutes.`);
      // A 5xx makes Zoom retry (5, 20 and 60 minutes later).
      return json({ ok: false, error: "The event could not be stored. Zoom will retry it." }, 503);
    }
    if (inserted) deps.background(forwardZoom(kind, roomId, key, detail));
    return json({ ok: true, stored: inserted ? "new" : "duplicate" });
  }

  // ----------------------------------------------------------------- slack

  async function replySlack(responseUrl: string | null | undefined, message: string) {
    if (!responseUrl) return;
    try {
      await fetchWithin(
        deps.fetch,
        responseUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text: message }),
        },
        B.slackReply,
      );
    } catch (e) {
      deps.log(`sales-live slack reply failed: ${redact((e as Error)?.message ?? e)}`);
    }
  }

  async function forwardPress(press: Press) {
    // One try: a second "Take it" after a slow first one would read as lost.
    const res = await salesApi(press, { ms: B.forwardSlack, tries: 1 });
    if (res.ok) {
      noteStatus("slack", true, `Last Slack ${press.kind} passed on.`);
      return;
    }
    const said = typeof res.json?.error === "string" ? (res.json.error as string) : "";
    const forPerson =
      said && res.status >= 400 && res.status < 500 && !GATEWAY_ERRORS.has(said)
        ? said
        : SLACK_COPY.didNotGoThrough;
    await replySlack(press.response_url as string | null, forPerson);
    noteStatus("slack", false, `A Slack ${press.kind} did not reach sales-api (${res.status || "no answer"}).`);
  }

  async function slackRoute(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "Send a POST." }, 405);
    const secret = env("SLACK_SIGNING_SECRET");
    if (!secret) {
      noteStatus("slack", false, MISSING.slack);
      return json({ ok: false, error: MISSING.slack }, 503);
    }
    const bytes = await readBody(req, SLACK_MAX_BYTES);
    if (!bytes) return json({ ok: false, error: "That body is too large." }, 413);
    const verdict = await slackSignatureOk(
      secret,
      req.headers.get("x-slack-request-timestamp"),
      bytes,
      req.headers.get("x-slack-signature"),
      Math.floor(deps.now() / 1000),
    );
    if (verdict === "stale") return json({ ok: false, error: "This Slack request is more than 5 minutes old." }, 401);
    if (verdict !== "ok") return json({ ok: false, error: "The Slack signature does not match." }, 401);

    const inbound = parseSlack(req.headers.get("content-type") ?? "", decoder.decode(bytes));
    if (inbound.type === "url_verification") return json({ challenge: inbound.challenge });
    if (inbound.type === "ssl_check" || inbound.type === "ignored") return new Response(null, { status: 200 });
    if (inbound.type === "command" && !inbound.command)
      return json({ response_type: "ephemeral", text: SLACK_COPY.unknownCommand });

    const press = await pressFor(inbound, deps.now());
    if (!press) {
      deps.log(`sales-live slack: a ${inbound.type} came without a usable user id`);
      return new Response(null, { status: 200 });
    }
    if (!db() || !env("CRON_SECRET")) {
      noteStatus("slack", false, SLACK_COPY.notSetUp);
      if (inbound.type === "command") return json({ response_type: "ephemeral", text: SLACK_COPY.notSetUp });
      deps.background(replySlack(press.response_url as string | null, SLACK_COPY.notSetUp));
      return new Response(null, { status: 200 });
    }
    deps.background(forwardPress(press));
    // An empty 200 inside Slack's 3 s; live.press answers through response_url.
    return new Response(null, { status: 200 });
  }

  // ------------------------------------------------------------- open / go

  async function resolveRoom(code: string): Promise<RoomRow | null> {
    const rows = (await rest(`cockpit_sales_rooms?code=eq.${code}&select=${ROOM_COLUMNS}&limit=1`, {
      ms: B.roomRead,
    })) as RoomRow[] | null;
    const first = Array.isArray(rows) ? rows[0] : undefined;
    if (!first) return null;
    let room: RoomRow = first;
    const seen = new Set([room.id]);
    // The link follows a replaced room (a handover re-routed after it went out).
    for (let hop = 0; hop < MAX_HOPS && FINAL_STATES.has(room.state) && room.replaced_by; hop++) {
      const found = (await rest(
        `cockpit_sales_rooms?id=eq.${encodeURIComponent(room.replaced_by)}&select=${ROOM_COLUMNS}&limit=1`,
        { ms: B.roomRead },
      )) as RoomRow[] | null;
      const next: RoomRow | undefined = Array.isArray(found) ? found[0] : undefined;
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      room = next;
    }
    return room;
  }

  async function repFor(email: string | null): Promise<Rep> {
    if (!email) return { en: null, ar: null };
    const rows = (await rest(
      `cockpit_sales_people?email=eq.${encodeURIComponent(email.toLowerCase())}&select=name,name_ar&limit=1`,
      { ms: B.repRead },
    )) as { name: string | null; name_ar: string | null }[] | null;
    const p = Array.isArray(rows) ? rows[0] : undefined;
    return { en: firstName(p?.name), ar: firstName(p?.name_ar) };
  }

  /** The official WhatsApp number for the ended page (rooms.fallback.ended_page_whatsapp). */
  async function endedWhatsapp(): Promise<string | null> {
    const rows = (await rest("cockpit_sales_settings?key=eq.rooms&select=value&limit=1", {
      ms: B.settingRead,
    })) as { value: Row | null }[] | null;
    const fallback = (Array.isArray(rows) ? rows[0]?.value?.fallback : null) as Row | null | undefined;
    return whatsappDigits(fallback?.ended_page_whatsapp);
  }

  /**
   * One door.open event per room and device (dedupe key), then the room's
   * first open, written once whoever wins (first_open_at=is.null).
   */
  async function recordOpen(room: RoomRow, code: string, ua: string, hash: string, deviceId: string | null) {
    const now = deps.now();
    const at = new Date(now).toISOString();
    const device = deviceOf(ua);
    const over = roomIsOver(room, now);
    const deviceKey = deviceIdOk(deviceId) ? `d:${deviceId}` : `h:${hash}:${await sha256Hex(ua)}`;
    const dedupe = `open:${room.id}:${(await sha256Hex(deviceKey)).slice(0, 32)}`;
    try {
      await insertEvent(
        {
          room_id: room.id,
          kind: "door.open",
          source: "door",
          dedupe_key: dedupe,
          handled_at: at,
          detail: {
            device,
            os: osOf(ua),
            ip_hash: hash,
            room_state: room.state,
            ...(over ? { after_end: true } : {}),
            ...(code !== room.code ? { via_code: code } : {}),
          },
        },
        B.record,
      );
      if (!over && !room.first_open_at)
        await rest(`cockpit_sales_rooms?id=eq.${encodeURIComponent(room.id)}&first_open_at=is.null`, {
          method: "PATCH",
          body: { first_open_at: at, open_device: device },
          prefer: "return=minimal",
          ms: B.record,
        });
    } catch (e) {
      noteStatus("open", false, `An open was not recorded: ${redact((e as Error).message)}`);
    }
  }

  function corsFor(origin: string | null): Record<string, string> {
    return origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-max-age": "86400",
          vary: "Origin",
        }
      : { vary: "Origin" };
  }

  async function openRoute(req: Request, rawCode: string | undefined, url: URL): Promise<Response> {
    const origin = req.headers.get("origin");
    const allowed = allowedOrigin(origin);
    const cors = corsFor(allowed);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ ok: false, error: "Send a GET." }, 405, cors);
    if (origin && !allowed) return json({ ok: false, error: "This page may not read call links." }, 403, cors);
    if (!db()) {
      noteStatus("open", false, MISSING.db);
      return json({ ok: false, state: "error", error: MISSING.db }, 503, cors);
    }
    const salt = env("IP_SALT");
    if (!salt) {
      noteStatus("open", false, MISSING.salt);
      return json({ ok: false, state: "error", error: MISSING.salt }, 503, cors);
    }
    const code = normalizeCode(rawCode);
    if (!code) return json({ ok: false, state: "unknown", code: null }, 404, cors);

    const ua = req.headers.get("user-agent") ?? "";
    const hash = await ipHash(salt, clientIp(req.headers));
    if (!deps.limiter.hit(hash, deps.now()))
      return json(
        { ok: false, state: "busy", error: "Too many tries from this network. Wait a minute, then try again." },
        429,
        { ...cors, "retry-after": "60" },
      );

    let room: RoomRow | null;
    try {
      room = await resolveRoom(code);
    } catch (e) {
      noteStatus("open", false, `Call links cannot be read: ${redact((e as Error).message)}`);
      return json(
        { ok: false, state: "error", error: "The call link could not be read just now. Try again in a moment." },
        503,
        cors,
      );
    }
    if (!room) return json({ ok: false, state: "unknown", code }, 404, cors);

    const now = deps.now();
    const [rep, whatsapp] = await Promise.all([
      repFor(room.host_email).catch(() => ({ en: null, ar: null })),
      roomIsOver(room, now) ? endedWhatsapp().catch(() => null) : Promise.resolve(null),
    ]);
    const view = doorView(code, room, rep, now, whatsapp);
    if (!isPreviewBot(ua)) deps.background(recordOpen(room, code, ua, hash, url.searchParams.get("d")));
    if (view.state === "broken") noteStatus("open", false, `Room ${room.id} has a join link the door refuses to open.`);
    else noteStatus("open", true, "Last call link read and opened.");
    return json(view, view.ok ? 200 : 502, cors);
  }

  async function goRoute(req: Request, rawCode: string | undefined): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return text("Send a GET.", 405);
    const home = site();
    const code = normalizeCode(rawCode);
    if (!code) return redirect(`${home}/`);
    if (!db()) {
      noteStatus("go", false, MISSING.db);
      return text("This call link cannot be opened right now. Reply to our message and we will send it again.", 503);
    }
    const ua = req.headers.get("user-agent") ?? "";
    // Nothing is stored here, so the limit can key on any salt.
    const hash = await ipHash(env("IP_SALT") || "sales-live", clientIp(req.headers));
    if (!deps.limiter.hit(hash, deps.now()))
      return text("Too many tries from this network. Wait a minute, then open the link again.", 429, {
        "retry-after": "60",
      });
    if (isPreviewBot(ua)) return text("Open this link on your phone to join the call.\nافتح هاللينك من تلفونك عشان تدخل المكالمة.");

    let room: RoomRow | null;
    try {
      room = await resolveRoom(code);
    } catch (e) {
      noteStatus("go", false, `Call links cannot be read: ${redact((e as Error).message)}`);
      return text("This call link could not be read just now. Try again in a moment.", 503);
    }
    if (!room) return redirect(`${home}/`);
    const now = deps.now();
    if (roomIsOver(room, now)) {
      const wa = await endedWhatsapp().catch(() => null);
      return redirect(`${home}/ended${wa ? `?wa=${wa}` : ""}`);
    }
    const view = doorView(code, room, { en: null, ar: null }, now);
    if (view.state === "open") return redirect(view.join_url);
    if (view.state === "preparing")
      return text(
        "Your call is almost ready. This page opens it by itself.\nمكالمتك قاعدة تتجهز.. بنفتحها لك أول ما تجهز.",
        200,
        { refresh: "3" },
      );
    return text("This room's link cannot be opened. Reply to our message and we will send a new one.", 502);
  }

  // ------------------------------------------------------------------ cron

  async function cronRoute(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "Send a POST." }, 405);
    const secret = env("CRON_SECRET");
    if (!secret) {
      noteStatus("cron", false, MISSING.cron);
      return json({ ok: false, error: MISSING.cron }, 503);
    }
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!given || !timingSafeEqual(given, secret)) return json({ ok: false, error: "Not allowed." }, 401);
    if (!db()) {
      noteStatus("cron", false, MISSING.db);
      return json({ ok: false, error: MISSING.db }, 503);
    }
    const bytes = await readBody(req, CRON_MAX_BYTES);
    if (!bytes) return json({ ok: false, error: "That body is too large." }, 413);
    let body: unknown;
    try {
      body = JSON.parse(decoder.decode(bytes));
    } catch {
      return json({ ok: false, error: "Send a JSON body." }, 400);
    }
    const check = cronForwardable(body);
    if (!check.ok) return json({ ok: false, error: check.error }, check.status);
    const res = await salesApi(check.body, { ms: B.forwardCron, tries: 1 });
    const action = String(check.body.action);
    if (res.status === 0) {
      noteStatus("cron", false, `sales-api did not answer ${action}.`);
      return json({ ok: false, error: `sales-api did not answer ${action}. The next run tries again.` }, 504);
    }
    noteStatus("cron", res.ok, res.ok ? `Last ${action} passed on.` : `sales-api refused ${action} (${res.status}).`);
    return new Response(res.text || JSON.stringify({ ok: res.ok }), {
      status: res.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // ---------------------------------------------------------------- health

  function healthRoute(): Response {
    const has = (n: string) => Boolean(env(n));
    const dbOk = Boolean(db());
    const need = (names: string[]) => {
      const missing = names.filter(n => !has(n));
      if (!dbOk) missing.push("SUPABASE_SERVICE_ROLE_KEY");
      return missing.length ? `missing ${missing.join(", ")}` : "ready";
    };
    return json({
      ok: true,
      function: "sales-live",
      routes: {
        zoom: need(["ZOOM_WEBHOOK_SECRET", "CRON_SECRET"]),
        slack: need(["SLACK_SIGNING_SECRET", "CRON_SECRET"]),
        open: need(["IP_SALT"]),
        go: need([]),
        cron: need(["CRON_SECRET"]),
      },
    });
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const route = routeOf(url.pathname);
    try {
      switch (route.name) {
        case "zoom":
          return await zoomRoute(req);
        case "slack":
          return await slackRoute(req);
        case "open":
          return await openRoute(req, route.code, url);
        case "go":
          return await goRoute(req, route.code);
        case "cron":
          return await cronRoute(req);
        case "health":
          return healthRoute();
        default:
          return json({ ok: false, error: "Not a sales-live route." }, 404);
      }
    } catch (e) {
      deps.log(`sales-live ${route.name ?? "?"} failed: ${redact((e as Error)?.message ?? e)}`);
      // A 5xx: Zoom and Slack retry; the page offers Try again.
      return json({ ok: false, error: "sales-live hit an error. Try again in a minute." }, 500);
    }
  };
}
