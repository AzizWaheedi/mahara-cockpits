// sales-live: the one public door of the live-call work (verify_jwt off).
// Every route checks its own key first. index.ts wires this to Deno.serve
// with the real environment; the tests wire it to fakes.
//
//   POST /zoom        Zoom's meeting events. Signature, then url_validation,
//                     then the room lookup (one quick retry): an event for a
//                     meeting that is not a cockpit room is answered 200 and
//                     kept nowhere (when the lookup fails, kept with no room
//                     and, without a room code in its topic, no names);
//                     a room's event is stored once (dedupe key) and
//                     answered 200 inside Zoom's 3 s, then passed to
//                     sales-api room.event with the stored row's id.
//   POST /slack       The "Mahara Sales" app: /available, /unavailable,
//                     button presses and app_home_opened, passed to
//                     sales-api live.press. Answered inside Slack's 3 s.
//   GET  /open/{code} The short page's script: where the room is, recorded
//                     once per device. One deadline for all its reads.
//   GET  /go/{code}   The no-script fallback: a 302 to the room or the
//                     ended page. Records nothing.
//   POST /cron        pg_cron's way in to sales-api: the sweep's room.event
//                     posts (sweep.replay, sweep.settle, tick) and
//                     thread.tick only, answered 202 at once.
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
  GO_COPY,
  ipHash,
  isPreviewBot,
  LIVE_SITE,
  MAX_HOPS,
  normalizeCode,
  openText,
  osOf,
  RateLimiter,
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
import { fetchTextWithin, fetchWithin, redact, sleep, Timeout } from "./util.ts";
import {
  cleanZoom,
  pickZoomRoom,
  VALIDATION_EVENT,
  ZOOM_EVENTS,
  type ZoomDetail,
  zoomDedupeKey,
  zoomKind,
  zoomLookup,
  type ZoomRoomRow,
  withoutPerson,
  zoomRoomQuery,
  zoomText,
} from "./zoom.ts";

export interface Deps {
  env: (name: string) => string;
  fetch: typeof fetch;
  /** Wall-clock time (stored times, rate-limit windows). */
  now: () => number;
  /** Work that may finish after the answer (EdgeRuntime.waitUntil when present). */
  background: (p: Promise<unknown>) => void;
  /** Per address and device: 30 opens a minute. */
  limiter: RateLimiter;
  /** Per address, all devices together: 120 a minute (two tabs, a family on one Wi-Fi). */
  wideLimiter?: RateLimiter;
  /** Opens of one room code a minute, from every address (150). */
  codeLimiter?: RateLimiter;
  log: (line: string) => void;
  /** Shorter waits for tests; production uses BUDGET as it stands. */
  budget?: Partial<Record<keyof typeof BUDGET, number>>;
  /** A monotonic clock in ms for deadlines (performance.now by default). */
  clock?: () => number;
}

type Row = Record<string, unknown>;

export const MISSING = {
  zoom: "Zoom events cannot be checked yet: ZOOM_WEBHOOK_SECRET is missing on sales-live. Add it to the function's secrets.",
  zoomCron:
    "Zoom events are stored but not passed on: CRON_SECRET is missing on sales-live. Add it to the function's secrets.",
  slack: "Slack requests cannot be checked yet: SLACK_SIGNING_SECRET is missing on sales-live. Add it to the function's secrets.",
  salt: "Opens cannot be recorded yet: IP_SALT is missing on sales-live. Add it to the function's secrets.",
  cron: "The cron door is closed: CRON_SECRET is missing on sales-live. Add it to the function's secrets.",
  db: "sales-live cannot reach the database: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.",
} as const;

/** The sentence for an alert when sales-api's gateway refuses what the door passes on. */
export const NOT_HOOKED = (action: string) =>
  `sales-api does not take ${action} from sales-live yet. Deploy the hooks commit: room.event, live.press and thread.tick in CRON_ACTIONS and DESK_ACTIONS.`;

/** Budgets, in ms. Zoom and Slack want an answer within 3 s; the page waits 6 s. */
export const BUDGET = {
  /** The room lookup for a Zoom event. */
  zoomFind: 500,
  /** Its one quick retry. zoomFind + zoomFindRetry + zoomStore leaves 0.7 s of Zoom's 3 s for a cold start. */
  zoomFindRetry: 300,
  /** Storing a Zoom event. */
  zoomStore: 1500,
  /** Every read /open makes, together (the page gives up at 6 s, call.js REQUEST_MS). */
  openTotal: 4500,
  roomRead: 2000,
  repRead: 1500,
  settingRead: 1000,
  record: 3000,
  /**
   * One forward of a Zoom event. A second try follows only a network error
   * (never a timeout or an answer), so the door's whole window, 2 × 8 s +
   * 0.4 s, ends before the sweep's replay at rooms.waits_s.event_replay (20 s).
   */
  forwardZoom: 8000,
  forwardSlack: 20_000,
  /** In the background, after the cron door has answered 202. */
  forwardCron: 25_000,
  slackReply: 5000,
  status: 3000,
  alert: 3000,
} as const;

const ZOOM_MAX_BYTES = 256_000;
const SLACK_MAX_BYTES = 64_000;
const STATUS_EVERY_MS = 60_000;
const ALERT_REFRESH_MS = 600_000;
const LAST_OPEN_EVERY_MS = 30_000;

/** Answers that are the sales-api gateway's own, not a sentence for a person. */
const GATEWAY_ERRORS = new Set([
  "Unknown action.",
  "Not an action the desk may take.",
  "Sign in again.",
  "Send a JSON body.",
  "Send a POST.",
  "Not an allowed origin.",
]);

/** The (worker, job) rows the door writes in cockpit_sales_worker_status. */
export const STATUS_JOBS = ["zoom", "slack", "open", "go", "cron"] as const;
type Job = (typeof STATUS_JOBS)[number];

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

const both = (pair: { en: string; ar: string }) => `${pair.en}\n${pair.ar}`;

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

/**
 * The raw body, or null when it is larger than `max`. Read a chunk at a time
 * with a running count, so a body with no content-length (chunked) or a false
 * one is cut off just past the cap, never held whole in memory.
 */
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

/** A database answer that was not 2xx; `status` 0 when there was no answer. */
class DbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const decoder = new TextDecoder();

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const env = (n: string) => (deps.env(n) ?? "").trim();
  const B: Record<keyof typeof BUDGET, number> = { ...BUDGET, ...(deps.budget ?? {}) };
  const clock = deps.clock ?? (() => performance.now());
  const wide = deps.wideLimiter ?? new RateLimiter(120, 60_000, 10_000);
  // One room code is opened by one lead: 150 a minute from every address
  // together is far past that, and stops one room being hammered from many
  // addresses. It sits above one address's own 120, so a single address can
  // never use up a lead's room for them.
  const perCode = deps.codeLimiter ?? new RateLimiter(150, 60_000, 10_000);
  const statusMemo = new Map<string, { ok: boolean; at: number }>();
  const alertMemo = new Map<string, { on: boolean; at: number }>();
  let ignoredZoom = 0;

  function db(): { base: string; key: string } | null {
    const base = env("SUPABASE_URL").replace(/\/+$/, "");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    return base && key ? { base, key } : null;
  }

  /** CALL_SITE_URL when it is a bare https origin, else null. */
  function extraSite(): string | null {
    const s = env("CALL_SITE_URL").replace(/\/+$/, "");
    return /^https:\/\/[a-z0-9.-]+$/i.test(s) ? s.toLowerCase() : null;
  }

  function site(): string {
    return extraSite() ?? LIVE_SITE;
  }

  /** PostgREST with the service key. Throws a redacted DbError on any failure. */
  async function rest(
    path: string,
    init: { method?: string; body?: unknown; prefer?: string; ms: number },
  ): Promise<unknown> {
    const cfg = db();
    if (!cfg) throw new DbError(MISSING.db, 0);
    const where = path.split("?")[0];
    if (init.ms <= 0) throw new DbError(`database no time left on ${where}`, 0);
    let res: { ok: boolean; status: number; text: string };
    try {
      res = await fetchTextWithin(
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
      throw new DbError(`database ${e instanceof Timeout ? e.message : redact((e as Error)?.message ?? e)} on ${where}`, 0);
    }
    const body = res.text;
    if (!res.ok) throw new DbError(`database ${res.status} on ${where}: ${redact(body)}`, res.status);
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
  function noteStatus(job: Job, ok: boolean, detail: string): void {
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

  /**
   * A setup problem nobody would otherwise hear about (a missing secret, or
   * sales-api's gateway refusing what the door passes on) as an alert in
   * cockpit_sales_alerts, which the SQL watchdog posts to #sales-alerts in
   * working hours. Key `config:sales-live/{job}`; raised while the problem
   * lasts (refreshed at most every 10 minutes), resolved the next time the
   * route works. These do not flap: every instance reads the same secrets.
   */
  function configAlert(job: Job, on: boolean, message = ""): void {
    const key = `config:sales-live/${job}`;
    const now = deps.now();
    const last = alertMemo.get(key);
    if (last && last.on === on && (!on || now - last.at < ALERT_REFRESH_MS)) return;
    alertMemo.set(key, { on, at: now });
    if (!db()) return;
    deps.background(
      rest("rpc/cockpit_sales_alert_set", {
        method: "POST",
        body: {
          p_key: key,
          p_on: on,
          p_kind: "config",
          p_subject: `sales-live/${job}`,
          p_message: redact(message || `sales-live/${job} works again.`).slice(0, 1000),
          p_detail: { worker: "sales-live", job },
        },
        ms: B.alert,
      }).catch(e => deps.log(`sales-live alert ${job} not written: ${redact((e as Error).message)}`)),
    );
  }

  /**
   * Inserts one room event. `{id}` when it is new (the row's uuid, which
   * room.event claims it by), null when its dedupe key was already there.
   */
  async function insertEvent(row: Row, ms: number): Promise<{ id: string | null } | null> {
    const out = await rest("cockpit_sales_room_events?on_conflict=dedupe_key&select=id,dedupe_key", {
      method: "POST",
      body: row,
      prefer: "resolution=ignore-duplicates,return=representation",
      ms,
    });
    const first = Array.isArray(out) ? (out[0] as Row | undefined) : undefined;
    if (!first) return null;
    return { id: typeof first.id === "string" && first.id ? first.id : null };
  }

  type ApiAnswer = { ok: boolean; status: number; text: string; json: Row | null };

  /**
   * A call to sales-api the way sales-mirror makes it: the project key for
   * the gateway, the cron secret for the action. A second try follows only a
   * network error before any answer. Never a timeout (sales-api may still be
   * working, and the sweep replays it) and never an answer, 5xx included
   * (sales-api answers 502 when HighLevel failed half-way).
   */
  async function salesApi(body: Row, opts: { ms: number; tries: number }): Promise<ApiAnswer> {
    const cfg = db();
    const cron = env("CRON_SECRET");
    if (!cfg || !cron) return { ok: false, status: 0, text: "", json: null };
    let last: ApiAnswer = { ok: false, status: 0, text: "", json: null };
    for (let attempt = 1; attempt <= Math.max(1, opts.tries); attempt++) {
      try {
        const res = await fetchTextWithin(
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
        let j: Row | null = null;
        try {
          j = JSON.parse(res.text) as Row;
        } catch {
          j = null;
        }
        return { ok: res.ok && j?.ok !== false, status: res.status, text: res.text, json: j };
      } catch (e) {
        last = { ok: false, status: 0, text: redact((e as Error)?.message ?? e), json: null };
        if (e instanceof Timeout) return last;
      }
      if (attempt < opts.tries) await sleep(400 * attempt);
    }
    return last;
  }

  /** sales-api's gateway turned the action away: the hooks commit is not deployed. */
  const gatewayRefused = (res: ApiAnswer) =>
    res.status >= 400 && res.status < 500 && typeof res.json?.error === "string" && GATEWAY_ERRORS.has(res.json.error as string);

  // ------------------------------------------------------------------ zoom

  async function forwardZoom(kind: string, eventId: string | null, roomId: string | null, key: string, d: ZoomDetail) {
    if (!env("CRON_SECRET")) {
      noteStatus("zoom", false, MISSING.zoomCron);
      configAlert("zoom", true, MISSING.zoomCron);
      return;
    }
    const res = await salesApi(
      { action: "room.event", kind, source: "zoom", event_id: eventId, room_id: roomId, dedupe_key: key, payload: d },
      { ms: B.forwardZoom, tries: 2 },
    );
    if (res.ok) {
      const other = ignoredZoom ? ` ${ignoredZoom} events from other Zoom meetings ignored since this instance started.` : "";
      noteStatus("zoom", true, `Last Zoom event (${d.event}) stored and passed on.${other}`);
      configAlert("zoom", false);
      return;
    }
    if (gatewayRefused(res)) {
      noteStatus("zoom", false, NOT_HOOKED("room.event"));
      configAlert("zoom", true, NOT_HOOKED("room.event"));
      return;
    }
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
      configAlert("zoom", true, MISSING.zoom);
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

    // One lookup with a known outcome. The subscription covers every meeting
    // on the Zoom account (the webinar, client calls, interviews): an event
    // for a meeting that is no cockpit room is answered and kept nowhere, so
    // none of its attendees' names or emails reach a table seats can read.
    const look = zoomLookup(detail);
    const query = zoomRoomQuery(look);
    if (!query) {
      ignoredZoom++;
      return json({ ok: true, ignored: "not a room" });
    }
    let roomId: string | null = null;
    let kept: ZoomDetail = detail;
    let found = false;
    let lastError = "";
    // The lookup, and one quick retry: a slow moment of the database should
    // not leave a lead's join unplaced.
    for (const ms of [B.zoomFind, B.zoomFindRetry]) {
      try {
        const pick = pickZoomRoom((await rest(query, { ms })) as ZoomRoomRow[] | null, look);
        if (!pick.room) {
          ignoredZoom++;
          return json({ ok: true, ignored: "not a room" });
        }
        roomId = pick.room_id;
        found = true;
        break;
      } catch (e) {
        lastError = redact((e as Error).message);
      }
    }
    if (!found) {
      // Both tries failed: the event is kept with no room for sales-api (and
      // the sweep, by its meeting id) to place, because it may be a lead
      // joining. A meeting whose topic carries no room code may be no room
      // at all (the webinar, a client call, an interview on the same Zoom
      // account): its people's names and emails are not kept, only their
      // Zoom ids and times, which is all the room logic needs to tell the
      // host from the lead.
      if (!look.code) kept = withoutPerson(detail);
      deps.log(`sales-live zoom: the room lookup failed twice, stored with no room: ${lastError}`);
    }

    const key = zoomDedupeKey(detail);
    const kind = zoomKind(detail.event);
    let stored: { id: string | null } | null;
    try {
      stored = await insertEvent(
        { room_id: roomId, kind, source: "zoom", dedupe_key: key, text: zoomText(kept), detail: kept },
        B.zoomStore,
      );
    } catch (e) {
      noteStatus("zoom", false, `Zoom events cannot be stored: ${redact((e as Error).message)}. Zoom retries in 5 minutes.`);
      // A 5xx makes Zoom retry (5, 20 and 60 minutes later).
      return json({ ok: false, error: "The event could not be stored. Zoom will retry it." }, 503);
    }
    if (stored) deps.background(forwardZoom(kind, stored.id, roomId, key, kept));
    return json({ ok: true, stored: stored ? "new" : "duplicate" });
  }

  // ----------------------------------------------------------------- slack

  async function replySlack(responseUrl: string, message: string) {
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

  /**
   * Says `message` to the person who pressed. Through response_url when Slack
   * gave one; a button on App Home has none, so the sentence goes into a
   * `slack.reply` room event (handled_at null, source door) that the VPS
   * Slack poster (sales-desk-rooms, which holds the bot token) sends as a DM
   * and marks handled. Opening App Home is not a press: nothing is said.
   */
  async function tellPresser(press: Press, message: string) {
    const url = typeof press.response_url === "string" ? press.response_url : "";
    if (url) return replySlack(url, message);
    if (press.kind !== "block_actions") return;
    try {
      await insertEvent(
        {
          room_id: null,
          kind: "slack.reply",
          source: "door",
          dedupe_key: `slack.reply:${press.request_id}`,
          text: message,
          detail: {
            slack_user_id: press.slack_user_id,
            slack_team_id: press.slack_team_id ?? null,
            view_id: press.view_id ?? null,
            container_type: press.container_type ?? null,
          },
        },
        B.record,
      );
    } catch (e) {
      deps.log(`sales-live slack: the reply for an App Home press was not kept: ${redact((e as Error).message)}`);
    }
  }

  async function forwardPress(press: Press) {
    // One try: a second "Take it" after a slow first one would read as lost.
    const res = await salesApi(press, { ms: B.forwardSlack, tries: 1 });
    if (res.ok) {
      noteStatus("slack", true, `Last Slack ${press.kind} passed on.`);
      configAlert("slack", false);
      return;
    }
    if (gatewayRefused(res)) {
      configAlert("slack", true, NOT_HOOKED("live.press"));
      noteStatus("slack", false, NOT_HOOKED("live.press"));
      await tellPresser(press, SLACK_COPY.didNotGoThrough);
      return;
    }
    const said = typeof res.json?.error === "string" ? (res.json.error as string) : "";
    // A refusal (4xx with live.press's own sentence; live.press posted
    // nothing itself) is said as it is, once, and the door is working.
    // Anything else is the door's own sentence and a red status row.
    const refused = Boolean(said) && res.status >= 400 && res.status < 500;
    await tellPresser(press, refused ? said : SLACK_COPY.didNotGoThrough);
    if (refused) noteStatus("slack", true, `Last Slack ${press.kind} was refused by live.press.`);
    else noteStatus("slack", false, `A Slack ${press.kind} did not reach sales-api (${res.status || "no answer"}).`);
  }

  async function slackRoute(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "Send a POST." }, 405);
    const secret = env("SLACK_SIGNING_SECRET");
    if (!secret) {
      noteStatus("slack", false, MISSING.slack);
      configAlert("slack", true, MISSING.slack);
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
      configAlert("slack", true, MISSING.cron);
      if (inbound.type === "command") return json({ response_type: "ephemeral", text: SLACK_COPY.notSetUp });
      deps.background(tellPresser(press, SLACK_COPY.notSetUp));
      return new Response(null, { status: 200 });
    }
    deps.background(forwardPress(press));
    // An empty 200 inside Slack's 3 s; live.press answers through response_url.
    return new Response(null, { status: 200 });
  }

  // ------------------------------------------------------------- open / go

  /** ms left before `until` on the monotonic clock, at most `cap`. */
  const leftOf = (until: number) => (cap: number) => Math.max(0, Math.min(cap, Math.floor(until - clock())));

  async function resolveRoom(code: string, left: (cap: number) => number): Promise<RoomRow | null> {
    const rows = (await rest(`cockpit_sales_rooms?code=eq.${code}&select=${ROOM_COLUMNS}&limit=1`, {
      ms: left(B.roomRead),
    })) as RoomRow[] | null;
    const first = Array.isArray(rows) ? rows[0] : undefined;
    if (!first) return null;
    let room: RoomRow = first;
    const seen = new Set([room.id]);
    // The link follows a replaced room (a handover re-routed after it went out).
    for (let hop = 0; hop < MAX_HOPS && FINAL_STATES.has(room.state) && room.replaced_by; hop++) {
      const found = (await rest(
        `cockpit_sales_rooms?id=eq.${encodeURIComponent(room.replaced_by)}&select=${ROOM_COLUMNS}&limit=1`,
        { ms: left(B.roomRead) },
      )) as RoomRow[] | null;
      const next: RoomRow | undefined = Array.isArray(found) ? found[0] : undefined;
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      room = next;
    }
    return room;
  }

  async function repFor(email: string | null, ms: number): Promise<Rep> {
    if (!email || ms < 50) return { en: null, ar: null };
    const rows = (await rest(
      `cockpit_sales_people?email=eq.${encodeURIComponent(email.toLowerCase())}&select=name,name_ar&limit=1`,
      { ms },
    )) as { name: string | null; name_ar: string | null }[] | null;
    const p = Array.isArray(rows) ? rows[0] : undefined;
    return { en: firstName(p?.name), ar: firstName(p?.name_ar) };
  }

  /** The official WhatsApp number for the ended page (rooms.fallback.ended_page_whatsapp). */
  async function endedWhatsapp(ms: number): Promise<string | null> {
    if (ms < 50) return null;
    const rows = (await rest("cockpit_sales_settings?key=eq.rooms&select=value&limit=1", { ms })) as
      | { value: Row | null }[]
      | null;
    const fallback = (Array.isArray(rows) ? rows[0]?.value?.fallback : null) as Row | null | undefined;
    return whatsappDigits(fallback?.ended_page_whatsapp);
  }

  /**
   * One door.open event per room and device (dedupe key: the counted open),
   * then the room's open columns only (door.ts OPEN_COLUMNS): first_open_at
   * once, whoever wins (first_open_at=is.null), and last_open_at on any later
   * open at most every 30 s, which the sweep's open grace reads (an open in
   * the last 3 minutes keeps the room open). The rooms guard (lc-db) leaves
   * `version` alone when only these columns change.
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
          text: openText(device, over),
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
      const id = encodeURIComponent(room.id);
      if (!over && !room.first_open_at) {
        const first = `cockpit_sales_rooms?id=eq.${id}&first_open_at=is.null`;
        const times = { first_open_at: at, last_open_at: at };
        try {
          await rest(first, {
            method: "PATCH",
            body: device ? { ...times, open_device: device } : times,
            prefer: "return=minimal",
            ms: B.record,
          });
        } catch (e) {
          // A database that does not know this device name yet (its check
          // still lists other names) must not lose the open itself.
          if (!(device && e instanceof DbError && e.status >= 400 && e.status < 500)) throw e;
          deps.log(`sales-live open: the database refused open_device "${device}"; the open time is kept without it`);
          await rest(first, { method: "PATCH", body: times, prefer: "return=minimal", ms: B.record });
        }
      } else if (!over) {
        const since = encodeURIComponent(new Date(now - LAST_OPEN_EVERY_MS).toISOString());
        await rest(`cockpit_sales_rooms?id=eq.${id}&or=(last_open_at.is.null,last_open_at.lt.${since})`, {
          method: "PATCH",
          body: { last_open_at: at },
          prefer: "return=minimal",
          ms: B.record,
        });
      }
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

  /** Both limits: 30 a minute per address and device, 120 a minute per address. */
  function withinLimits(hash: string, deviceId: string | null): boolean {
    const now = deps.now();
    const perDevice = deps.limiter.hit(`${hash}:${deviceIdOk(deviceId) ? deviceId : "-"}`, now);
    const perAddress = wide.hit(hash, now);
    return perDevice && perAddress;
  }

  async function openRoute(req: Request, rawCode: string | undefined, url: URL): Promise<Response> {
    const until = clock() + B.openTotal;
    const left = leftOf(until);
    const origin = req.headers.get("origin");
    const allowed = allowedOrigin(origin, extraSite());
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
      configAlert("open", true, MISSING.salt);
      return json({ ok: false, state: "error", error: MISSING.salt }, 503, cors);
    }
    const code = normalizeCode(rawCode);
    if (!code) return json({ ok: false, state: "unknown", code: null }, 404, cors);

    const ua = req.headers.get("user-agent") ?? "";
    const deviceId = url.searchParams.get("d");
    const hash = await ipHash(salt, clientIp(req.headers));
    if (!withinLimits(hash, deviceId) || !perCode.hit(code, deps.now()))
      return json(
        { ok: false, state: "busy", error: "Too many tries from this network. Wait a minute, then try again." },
        429,
        { ...cors, "retry-after": "60" },
      );

    let room: RoomRow | null;
    try {
      room = await resolveRoom(code, left);
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
      repFor(room.host_email, left(B.repRead)).catch(() => ({ en: null, ar: null })),
      roomIsOver(room, now) ? endedWhatsapp(left(B.settingRead)).catch(() => null) : Promise.resolve(null),
    ]);
    const view = doorView(code, room, rep, now, whatsapp);
    if (!isPreviewBot(ua)) deps.background(recordOpen(room, code, ua, hash, deviceId));
    if (view.state === "broken") noteStatus("open", false, `Room ${room.id} has a join link the door refuses to open.`);
    else noteStatus("open", true, "Last call link read and opened.");
    configAlert("open", false);
    return json(view, view.ok ? 200 : 502, cors);
  }

  async function goRoute(req: Request, rawCode: string | undefined): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return text("Send a GET.", 405);
    const until = clock() + B.openTotal;
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
    if (!withinLimits(hash, null))
      return text("Too many tries from this network. Wait a minute, then open the link again.", 429, {
        "retry-after": "60",
      });
    if (isPreviewBot(ua)) return text(both(GO_COPY.preview));

    let room: RoomRow | null;
    try {
      room = await resolveRoom(code, leftOf(until));
    } catch (e) {
      noteStatus("go", false, `Call links cannot be read: ${redact((e as Error).message)}`);
      return text("This call link could not be read just now. Try again in a moment.", 503);
    }
    if (!room) return redirect(`${home}/`);
    const now = deps.now();
    // The ended page asks /open for the room itself (and its WhatsApp
    // number); nothing it shows is taken from the address bar.
    if (roomIsOver(room, now)) return redirect(`${home}/ended?c=${code}`);
    noteStatus("go", true, "Last no-script link opened.");
    const view = doorView(code, room, { en: null, ar: null }, now);
    if (view.state === "open") return redirect(view.join_url);
    if (view.state === "preparing") return text(both(GO_COPY.preparing), 200, { refresh: "3" });
    return text("This room's link cannot be opened. Reply to our message and we will send a new one.", 502);
  }

  // ------------------------------------------------------------------ cron

  async function forwardCron(body: Row) {
    const action = String(body.action);
    const res = await salesApi(body, { ms: B.forwardCron, tries: 1 });
    if (res.ok) {
      noteStatus("cron", true, `Last ${action} passed on.`);
      configAlert("cron", false);
      return;
    }
    if (gatewayRefused(res)) {
      noteStatus("cron", false, NOT_HOOKED(action));
      configAlert("cron", true, NOT_HOOKED(action));
      return;
    }
    const said = typeof res.json?.error === "string" ? `: ${res.json.error}` : "";
    noteStatus(
      "cron",
      false,
      res.status === 0
        ? `sales-api did not answer ${action} in ${Math.round(B.forwardCron / 1000)} s. The next run tries again.`
        : `sales-api refused ${action} (${res.status})${redact(said)}`,
    );
  }

  async function cronRoute(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "Send a POST." }, 405);
    const secret = env("CRON_SECRET");
    if (!secret) {
      noteStatus("cron", false, MISSING.cron);
      configAlert("cron", true, MISSING.cron);
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
    if (!check.ok) {
      noteStatus("cron", false, `The cron door refused a body: ${check.error}`);
      return json({ ok: false, error: check.error }, check.status);
    }
    // Answered at once, inside pg_net's 10 s: the replay itself may take
    // longer, and its outcome goes to the status row (sales-live/cron).
    deps.background(forwardCron(check.body));
    const payload = check.body.payload as { event_ids?: string[]; room_ids?: string[] } | undefined;
    const ids = payload?.event_ids;
    const rooms = payload?.room_ids;
    return json(
      {
        ok: true,
        accepted: check.body.action,
        ...(check.body.kind ? { kind: check.body.kind } : {}),
        ...(ids ? { events: ids.length } : {}),
        ...(rooms ? { rooms: rooms.length } : {}),
      },
      202,
    );
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
