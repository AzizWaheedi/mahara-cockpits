// bun test supabase/functions/sales-live
//
// The whole door, route by route, against an in-memory PostgREST, a fake
// sales-api and a fake Slack. No network. Covers the refusals, retries,
// duplicate and late webhooks, concurrency, timeouts and missing secrets.

import { afterEach, describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { GO_COPY, OPEN_COLUMNS, OPEN_DEVICES, RateLimiter } from "./door.ts";
import { BUDGET, makeHandler, MISSING, NOT_HOOKED } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SERVICE_KEY = "service-key-value-never-printed";
const SECRETS = {
  ZOOM_WEBHOOK_SECRET: "zoom-secret-value-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-value-never-printed",
  IP_SALT: "salt-value-never-printed",
  CRON_SECRET: "cron-secret-value-never-printed",
};
const NOW = Date.UTC(2026, 9, 3, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const RESPONSE_URL = "https://hooks.slack.com/actions/T1/123/abc";

type Row = Record<string, any>;

const SLACK_COPY_DID_NOT = "That did not go through. Try again in a minute, or use the cockpit.";

// --------------------------------------------------------------- the fakes

class AbortErr extends Error {
  name = "AbortError";
}

class World {
  rooms: Row[] = [];
  people: Row[] = [{ email: "setter@maharamedia.com", name: "Sara Al Ali", name_ar: "سارة العلي" }];
  settings: Row[] = [{ key: "rooms", value: { fallback: { ended_page_whatsapp: "+965 9005 4963" } } }];
  events: Row[] = [];
  status = new Map<string, Row>();
  /** cockpit_sales_alerts as cockpit_sales_alert_set leaves them: key -> open or resolved. */
  alerts = new Map<string, { on: boolean; message: string; calls: number }>();
  firstOpenWrites = 0;
  /** Every PATCH on cockpit_sales_rooms, with the keys it wrote. */
  roomPatches: { keys: string[]; versionBefore: number; versionAfter: number }[] = [];
  /** The values the open_device check allows (the agreed set; lc-db's migration must match). */
  deviceCheck: readonly string[] = OPEN_DEVICES;
  /** GETs on cockpit_sales_rooms, to count the door's lookups. */
  roomReads: string[] = [];
  roomsReadDown = false;
  /** sales-api calls that fail with a network error before any answer. */
  salesApiNetworkErrors = 0;
  dbDown = false;
  dbDelayMs = 0;
  /** Headers arrive, then the body never does (until the caller gives up). */
  dbStallBody = false;
  salesApiCalls: { headers: Headers; body: Row }[] = [];
  salesApiReply: (body: Row, n: number) => { status: number; json: Row } = () => ({ status: 200, json: { ok: true } });
  salesApiDelayMs = 0;
  slackPosts: { url: string; body: Row }[] = [];
  env: Record<string, string> = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...SECRETS };
  logs: string[] = [];
  pending: Promise<unknown>[] = [];
  timers = new Set<ReturnType<typeof setTimeout>>();
  now = NOW;
  limiter = new RateLimiter(30, 60_000);
  wideLimiter = new RateLimiter(120, 60_000);
  budget: Record<string, number> | undefined;

  wait(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!ms) return resolve();
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.add(t);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        this.timers.delete(t);
        reject(new AbortErr("aborted"));
      });
    });
  }

  stopTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  async settle() {
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      await Promise.allSettled(batch);
    }
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.hostname === "hooks.slack.com") {
      this.slackPosts.push({ url: url.toString(), body });
      return new Response("ok");
    }
    if (url.pathname === "/functions/v1/sales-api") {
      this.salesApiCalls.push({ headers, body });
      if (this.salesApiNetworkErrors > 0) {
        this.salesApiNetworkErrors--;
        throw new TypeError("connection reset");
      }
      await this.wait(this.salesApiDelayMs, init.signal);
      const r = this.salesApiReply(body, this.salesApiCalls.length);
      return Response.json(r.json, { status: r.status });
    }
    if (!url.pathname.startsWith("/rest/v1/")) return new Response("no such host", { status: 404 });
    if (headers.get("authorization") !== `Bearer ${SERVICE_KEY}`) return new Response("no key", { status: 401 });
    await this.wait(this.dbDelayMs, init.signal);
    if (this.dbDown) return new Response('{"message":"connection refused"}', { status: 503 });
    if (this.dbStallBody) {
      const signal = init.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            signal?.addEventListener("abort", () => c.error(new AbortErr("aborted")));
          },
        }),
        { status: 200 },
      );
    }
    return this.rest(url, method, body);
  };

  /** One PostgREST condition: eq, lt or is.null. */
  private test(r: Row, col: string, cond: string): boolean {
    if (cond === "is.null") return r[col] == null;
    if (cond.startsWith("eq.")) return String(r[col]) === cond.slice(3);
    if (cond.startsWith("lt.")) return r[col] != null && String(r[col]) < cond.slice(3);
    throw new Error(`fake PostgREST does not know ${col}=${cond}`);
  }

  private match(rows: Row[], params: URLSearchParams): Row[] {
    return rows.filter(r => {
      for (const [k, v] of params) {
        if (["select", "limit", "on_conflict", "order"].includes(k)) continue;
        if (k === "or") {
          const parts = v.replace(/^\(|\)$/g, "").split(",");
          const any = parts.some(part => {
            const dot = part.indexOf(".");
            return this.test(r, part.slice(0, dot), part.slice(dot + 1));
          });
          if (!any) return false;
          continue;
        }
        if (!this.test(r, k, v)) return false;
      }
      return true;
    });
  }

  private rest(url: URL, method: string, body: any): Response {
    const table = url.pathname.slice("/rest/v1/".length);
    const p = url.searchParams;
    const limit = Number(p.get("limit") ?? "1000");
    if (table === "cockpit_sales_room_events" && method === "POST") {
      if (this.events.some(e => e.dedupe_key === body.dedupe_key)) return Response.json([], { status: 201 });
      const id = randomUUID();
      this.events.push({ ...body, id, at: new Date(this.now).toISOString() });
      return Response.json([{ id, dedupe_key: body.dedupe_key }], { status: 201 });
    }
    if (table === "cockpit_sales_worker_status" && method === "POST") {
      this.status.set(`${body.worker}/${body.job}`, body);
      return new Response(null, { status: 201 });
    }
    if (table === "rpc/cockpit_sales_alert_set" && method === "POST") {
      const was = this.alerts.get(body.p_key);
      if (body.p_on) this.alerts.set(body.p_key, { on: true, message: body.p_message, calls: (was?.calls ?? 0) + 1 });
      else if (was) this.alerts.set(body.p_key, { ...was, on: false, calls: was.calls + 1 });
      return Response.json(body.p_on && !was?.on ? 1 : 0);
    }
    if (table === "cockpit_sales_rooms" && method === "PATCH") {
      // The rooms check on open_device, then the rooms guard's version rule:
      // a write that changes only the open columns leaves version alone.
      if ("open_device" in body && body.open_device !== null && !this.deviceCheck.includes(body.open_device))
        return Response.json(
          { code: "23514", message: 'new row for relation "cockpit_sales_rooms" violates check constraint' },
          { status: 400 },
        );
      const hits = this.match(this.rooms, p);
      for (const r of hits) {
        const before = r.version ?? 1;
        const changed = Object.keys(body).filter(k => r[k] !== body[k]);
        Object.assign(r, body);
        const quiet = new Set<string>([...OPEN_COLUMNS, "updated_at"]);
        if (changed.some(k => !quiet.has(k))) r.version = before + 1;
        this.roomPatches.push({ keys: Object.keys(body), versionBefore: before, versionAfter: r.version ?? 1 });
      }
      if (hits.length && "first_open_at" in body) this.firstOpenWrites++;
      return new Response(null, { status: 204 });
    }
    if (table === "cockpit_sales_rooms" && method === "GET") {
      this.roomReads.push(url.search);
      if (this.roomsReadDown) return new Response('{"message":"statement timeout"}', { status: 503 });
    }
    const source: Record<string, Row[]> = {
      cockpit_sales_rooms: this.rooms,
      cockpit_sales_people: this.people,
      cockpit_sales_settings: this.settings,
    };
    if (method === "GET" && source[table]) return Response.json(this.match(source[table], p).slice(0, limit));
    return new Response(`unexpected ${method} ${table}`, { status: 400 });
  }

  handler() {
    return makeHandler({
      env: n => this.env[n] ?? "",
      fetch: this.fetch as typeof fetch,
      now: () => this.now,
      background: p => {
        this.pending.push(p);
      },
      limiter: this.limiter,
      wideLimiter: this.wideLimiter,
      log: line => this.logs.push(line),
      budget: this.budget,
    });
  }
}

let world: World;
afterEach(() => world?.stopTimers());

function liveRoom(over: Row = {}): Row {
  return {
    id: "room-1",
    code: "K7Q2MX",
    state: "open",
    provider: "zoom",
    provider_meeting_id: "85023456789",
    join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
    host_email: "setter@maharamedia.com",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    open_device: null,
    version: 1,
    ...over,
  };
}

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// ------------------------------------------------------------- requests

function zoomBody(event: string, participant: Row = {}, object: Row = {}): string {
  return JSON.stringify({
    event,
    event_ts: 1696330800123,
    payload: {
      account_id: "acc-1",
      object: {
        id: 85023456789,
        uuid: "inst-1==",
        host_id: "host-1",
        topic: "Mahara call K7Q2MX",
        type: 2,
        start_time: "2026-10-03T11:00:00Z",
        ...object,
        participant: {
          user_id: "16778240",
          user_name: "Lead Person",
          participant_uuid: "pu-1",
          email: "lead@example.com",
          join_time: "2026-10-03T11:02:10Z",
          phone_number: "+96550000000",
          public_ip: "203.0.113.9",
          ...participant,
        },
      },
    },
  });
}

function zoomRequest(body: string, opts: { secret?: string; ts?: string; sig?: string | null } = {}): Request {
  const ts = opts.ts ?? "1696330800";
  const sig =
    opts.sig === undefined
      ? `v0=${createHmac("sha256", opts.secret ?? SECRETS.ZOOM_WEBHOOK_SECRET).update(`v0:${ts}:${body}`).digest("hex")}`
      : opts.sig;
  const headers: Record<string, string> = { "content-type": "application/json", "x-zm-request-timestamp": ts };
  if (sig !== null) headers["x-zm-signature"] = sig;
  return new Request("http://localhost/sales-live/zoom", { method: "POST", headers, body });
}

function slackRequest(
  body: string,
  opts: { type?: string; ts?: number; secret?: string; sig?: string } = {},
): Request {
  const ts = String(opts.ts ?? Math.floor(NOW / 1000));
  const sig =
    opts.sig ??
    `v0=${createHmac("sha256", opts.secret ?? SECRETS.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;
  return new Request("http://localhost/sales-live/slack", {
    method: "POST",
    headers: {
      "content-type": opts.type ?? "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": ts,
      "x-slack-signature": sig,
    },
    body,
  });
}

const slashCommand = (command: string, user = "U2CERLKJA") =>
  new URLSearchParams({
    team_id: "T1DC2JH3J",
    user_id: user,
    command,
    text: "",
    response_url: RESPONSE_URL,
    trigger_id: `trig-${command}`,
  }).toString();

/** A button on App Home: Slack sends no response_url for these. */
const homePress = (actionId = "live.available", trigger = "trig-home") =>
  new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: "U2CERLKJA", team_id: "T1DC2JH3J" },
      team: { id: "T1DC2JH3J" },
      container: { type: "view", view_id: "V0HOME123" },
      view: { id: "V0HOME123", type: "home" },
      trigger_id: trigger,
      actions: [{ action_id: actionId, value: "available" }],
    }),
  }).toString();

const buttonPress = (actionId = "live.take", trigger = "trig-btn") =>
  new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: "U2CERLKJA" },
      team: { id: "T1DC2JH3J" },
      response_url: RESPONSE_URL,
      trigger_id: trigger,
      actions: [{ action_id: actionId, value: "offer-1" }],
    }),
  }).toString();

function openRequest(code: string, opts: { ua?: string; ip?: string; d?: string; origin?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = {
    "user-agent": opts.ua ?? IPHONE,
    "x-forwarded-for": opts.ip ?? "203.0.113.9",
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? "https://call.maharamedia.com";
  const q = opts.d ? `?d=${opts.d}` : "";
  return new Request(`http://localhost/sales-live/open/${code}${q}`, { method: opts.method ?? "GET", headers });
}

function goRequest(code: string, opts: { ua?: string; ip?: string } = {}) {
  return new Request(`http://localhost/sales-live/go/${code}`, {
    headers: { "user-agent": opts.ua ?? IPHONE, "x-forwarded-for": opts.ip ?? "203.0.113.9" },
  });
}

function cronRequest(body: unknown, secret: string | null = SECRETS.CRON_SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("http://localhost/sales-live/cron", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const fresh = (setup?: (w: World) => void) => {
  world = new World();
  setup?.(world);
  return world.handler();
};

// ------------------------------------------------------------------ zoom

describe("POST /zoom", () => {
  test("url_validation is answered once the signature matches", async () => {
    const h = fresh();
    const body = JSON.stringify({ event: "endpoint.url_validation", event_ts: 1, payload: { plainToken: "qgg8vlvZRS6UYooatFL8Aw" } });
    const res = await h(zoomRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plainToken: "qgg8vlvZRS6UYooatFL8Aw",
      encryptedToken: createHmac("sha256", SECRETS.ZOOM_WEBHOOK_SECRET).update("qgg8vlvZRS6UYooatFL8Aw").digest("hex"),
    });
    expect(world.events).toHaveLength(0);
  });

  test("an unsigned or forged url_validation gets nothing back (no HMAC oracle)", async () => {
    const h = fresh();
    const body = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "v0" } });
    for (const req of [zoomRequest(body, { sig: null }), zoomRequest(body, { secret: "guess" })]) {
      const res = await h(req);
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).not.toContain("encryptedToken");
    }
  });

  test("a join is stored once, against its room, and passed to room.event", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "host_in" })));
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: "new" });
    expect(world.events).toHaveLength(1);
    const ev = world.events[0];
    expect(ev).toMatchObject({
      room_id: "room-1",
      kind: "zoom.meeting.participant_joined",
      source: "zoom",
      text: "Zoom: Lead Person joined.",
    });
    expect(ev.dedupe_key).toBe("zoom:meeting.participant_joined:inst-1==:pu-1:2026-10-03T11:02:10Z");
    expect(ev.handled_at).toBeUndefined();
    expect(JSON.stringify(ev.detail)).not.toContain("+96550000000");
    expect(JSON.stringify(ev.detail)).not.toContain("203.0.113.9");

    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    const call = world.salesApiCalls[0];
    expect(call.headers.get("x-cron-secret")).toBe(SECRETS.CRON_SECRET);
    expect(call.headers.get("authorization")).toBe(`Bearer ${SERVICE_KEY}`);
    expect(call.body).toMatchObject({
      action: "room.event",
      kind: "zoom.meeting.participant_joined",
      source: "zoom",
      event_id: ev.id,
      room_id: "room-1",
      dedupe_key: ev.dedupe_key,
    });
    // room.event claims the stored row by this id; it never works out a key of its own.
    expect(call.body.event_id).toMatch(/^[0-9a-f-]{36}$/);
    // One lookup, by meeting id or topic code together.
    expect(world.roomReads).toHaveLength(1);
    expect(decodeURIComponent(world.roomReads[0])).toContain("or=(provider_meeting_id.eq.85023456789,code.eq.K7Q2MX)");
    expect(call.body.payload.event).toBe("meeting.participant_joined");
    expect(call.body.payload.payload.object.participant.email).toBe("lead@example.com");
    expect(call.body.payload.payload.object.host_id).toBe("host-1");
    expect(world.status.get("sales-live/zoom")).toMatchObject({ ok: true });
  });

  test("Zoom's retry of the same event is stored and passed on only once", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const body = zoomBody("meeting.participant_joined");
    expect(await (await h(zoomRequest(body))).json()).toEqual({ ok: true, stored: "new" });
    expect(await (await h(zoomRequest(body, { ts: "1696331100" }))).json()).toEqual({ ok: true, stored: "duplicate" });
    await world.settle();
    expect(world.events).toHaveLength(1);
    expect(world.salesApiCalls).toHaveLength(1);
  });

  test("fifty copies of one event at once: one row, one forward", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const body = zoomBody("meeting.participant_joined");
    const answers = await Promise.all(Array.from({ length: 50 }, () => h(zoomRequest(body))));
    expect(answers.every(r => r.status === 200)).toBe(true);
    await world.settle();
    expect(world.events).toHaveLength(1);
    expect(world.salesApiCalls).toHaveLength(1);
  });

  test("a rejoin, a leave and a waiting-room knock are separate events", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    await h(zoomRequest(zoomBody("meeting.participant_joined")));
    await h(zoomRequest(zoomBody("meeting.participant_joined", { join_time: "2026-10-03T11:09:00Z" })));
    await h(zoomRequest(zoomBody("meeting.participant_left", { leave_time: "2026-10-03T11:20:00Z" })));
    await h(
      zoomRequest(zoomBody("meeting.participant_joined_waiting_room", { join_time: undefined, date_time: "2026-10-03T11:01:00Z" })),
    );
    await world.settle();
    expect(world.events.map(e => e.kind)).toEqual([
      "zoom.meeting.participant_joined",
      "zoom.meeting.participant_joined",
      "zoom.meeting.participant_left",
      "zoom.meeting.participant_joined_waiting_room",
    ]);
    expect(world.salesApiCalls).toHaveLength(4);
  });

  test("a late event for a room that already ended is still stored; the door never changes the room", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "ended" })));
    const res = await h(zoomRequest(zoomBody("meeting.ended", {}, { end_time: "2026-10-03T11:40:00Z" })));
    expect(res.status).toBe(200);
    await world.settle();
    expect(world.events[0]).toMatchObject({ room_id: "room-1", kind: "zoom.meeting.ended" });
    expect(world.rooms[0].state).toBe("ended");
  });

  test("the room is found by the code in the topic when the meeting id is not saved yet", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ provider_meeting_id: null })));
    await h(zoomRequest(zoomBody("meeting.started", {}, {})));
    expect(world.events[0].room_id).toBe("room-1");
  });

  test("two open rooms on one meeting: the topic's code decides, else sales-api does", async () => {
    let h = fresh(w => {
      w.rooms.push(liveRoom({ id: "room-a", code: "AAAAAA" }));
      w.rooms.push(liveRoom({ id: "room-b", code: "K7Q2MX" }));
    });
    await h(zoomRequest(zoomBody("meeting.started")));
    expect(world.events[0].room_id).toBe("room-b");
    h = fresh(w => {
      w.rooms.push(liveRoom({ id: "room-a", code: "AAAAAA" }));
      w.rooms.push(liveRoom({ id: "room-b", code: "BBBBBB" }));
    });
    await h(zoomRequest(zoomBody("meeting.started", {}, { topic: "Demo with Mahara Media" })));
    expect(world.events[0].room_id).toBeNull();
  });

  test("a meeting that is no cockpit room (the webinar, a client call) is answered and kept nowhere", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const webinar = zoomBody(
      "meeting.participant_joined",
      { user_name: "A Client Of Ours", email: "client@example.com" },
      { id: 81234567890, uuid: "web-inst==", topic: "Mahara webinar: scale your agency" },
    );
    const res = await h(zoomRequest(webinar));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "not a room" });
    const started = await h(zoomRequest(zoomBody("meeting.started", {}, { id: 11111111111, topic: "Weekly sync" })));
    expect(await started.json()).toEqual({ ok: true, ignored: "not a room" });
    await world.settle();
    expect(world.events).toHaveLength(0);
    expect(world.salesApiCalls).toHaveLength(0);
    expect(JSON.stringify([world.logs, [...world.status.values()]])).not.toContain("client@example.com");
  });

  test("an event with neither a meeting id nor a room code is ignored without a lookup", async () => {
    const h = fresh();
    const res = await h(zoomRequest(zoomBody("meeting.ended", {}, { id: undefined, uuid: "x==", topic: "Interview" })));
    expect(await res.json()).toEqual({ ok: true, ignored: "not a room" });
    expect(world.roomReads).toHaveLength(0);
    expect(world.events).toHaveLength(0);
  });

  test("a lookup that fails keeps the event with no room and passes it on, so a lead's join is never lost", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.roomsReadDown = true;
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(await res.json()).toEqual({ ok: true, stored: "new" });
    await world.settle();
    expect(world.events[0].room_id).toBeNull();
    expect(world.salesApiCalls[0].body).toMatchObject({ room_id: null, event_id: world.events[0].id });
    expect(world.logs.some(l => l.includes("the room lookup failed"))).toBe(true);
  });

  test("a lookup that runs past its 500 ms still answers Zoom inside 3 s", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.dbDelayMs = 700;
    });
    const started = performance.now();
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    const took = performance.now() - started;
    expect(res.status).toBe(200);
    expect(took).toBeLessThan(3000);
    expect(world.events[0].room_id).toBeNull();
  });

  test("Zoom's 3 s: the lookup and the store leave a second for a cold start", () => {
    expect(BUDGET.zoomFind).toBeLessThanOrEqual(500);
    expect(BUDGET.zoomFind + BUDGET.zoomStore).toBeLessThanOrEqual(2000);
  });

  test("events outside the seven are acknowledged and not stored", async () => {
    const h = fresh();
    const res = await h(zoomRequest(JSON.stringify({ event: "meeting.created", payload: { object: { id: 1 } } })));
    expect(await res.json()).toEqual({ ok: true, ignored: "meeting.created" });
    expect(world.events).toHaveLength(0);
  });

  test("a bad signature is a 401 and nothing is stored", async () => {
    const h = fresh();
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined"), { secret: "wrong" }));
    expect(res.status).toBe(401);
    expect(world.events).toHaveLength(0);
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("the database being down is a 503, so Zoom retries", async () => {
    const h = fresh(w => {
      w.dbDown = true;
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("The event could not be stored. Zoom will retry it.");
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("a database that hangs still gets Zoom an answer inside 3 s", async () => {
    const h = fresh(w => {
      w.dbDelayMs = 10_000;
    });
    const started = performance.now();
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    const took = performance.now() - started;
    expect(res.status).toBe(503);
    expect(took).toBeLessThan(3000);
    expect(took).toBeGreaterThanOrEqual(BUDGET.zoomStore - 50);
  });

  test("a database that sends headers and then stalls is cut off inside 3 s too", async () => {
    const h = fresh(w => {
      w.dbStallBody = true;
    });
    const started = performance.now();
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(503);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test("a sales-api failure (5xx, sales-api may have half-worked) is not retried: the sweep replays it", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiReply = () => ({ status: 502, json: { ok: false, error: "That did not work: HighLevel 502" } });
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(200);
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    expect(world.events[0].handled_at).toBeUndefined();
    const row = world.status.get("sales-live/zoom");
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("The sweep replays it.");
  });

  test("a network error before any answer is tried once more", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiNetworkErrors = 1;
    });
    await h(zoomRequest(zoomBody("meeting.participant_joined")));
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(2);
    expect(world.salesApiCalls[1].body.event_id).toBe(world.salesApiCalls[0].body.event_id);
    expect(world.status.get("sales-live/zoom")?.ok).toBe(true);
  });

  test("the door's whole forward window ends before the sweep's replay (event_replay 20 s)", () => {
    const EVENT_REPLAY_MS = 20_000;
    expect(2 * BUDGET.forwardZoom + 400).toBeLessThan(EVENT_REPLAY_MS);
  });

  test("a sales-api refusal (4xx) is not retried", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: "This changed a moment ago." } });
    });
    await h(zoomRequest(zoomBody("meeting.participant_joined")));
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
  });

  test("without CRON_SECRET the event is stored, not passed on; the status row and an alert say why", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      delete w.env.CRON_SECRET;
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(200);
    await world.settle();
    expect(world.events).toHaveLength(1);
    expect(world.salesApiCalls).toHaveLength(0);
    expect(world.status.get("sales-live/zoom")?.detail).toContain("CRON_SECRET is missing");
    expect(world.alerts.get("config:sales-live/zoom")).toMatchObject({ on: true, message: MISSING.zoomCron });
  });

  test("without ZOOM_WEBHOOK_SECRET the route answers 503 and raises an alert (missing is never zero)", async () => {
    const h = fresh(w => {
      delete w.env.ZOOM_WEBHOOK_SECRET;
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MISSING.zoom);
    // Zoom keeps retrying: the alert is raised once per instance, not once per event.
    await h(zoomRequest(zoomBody("meeting.participant_left")));
    await world.settle();
    expect(world.alerts.get("config:sales-live/zoom")).toEqual({ on: true, message: MISSING.zoom, calls: 1 });
  });

  test("sales-api's gateway refusing room.event raises an alert; the next success resolves it", async () => {
    let refuse = true;
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiReply = () =>
        refuse ? { status: 403, json: { ok: false, error: "Not an action the desk may take." } } : { status: 200, json: { ok: true } };
    });
    await h(zoomRequest(zoomBody("meeting.participant_joined")));
    await world.settle();
    expect(world.alerts.get("config:sales-live/zoom")).toMatchObject({ on: true, message: NOT_HOOKED("room.event") });
    expect(world.status.get("sales-live/zoom")?.ok).toBe(false);
    refuse = false;
    world.now += 61_000;
    await h(zoomRequest(zoomBody("meeting.participant_left", { leave_time: "2026-10-03T11:30:00Z" })));
    await world.settle();
    expect(world.alerts.get("config:sales-live/zoom")?.on).toBe(false);
    expect(world.status.get("sales-live/zoom")?.ok).toBe(true);
  });

  test("oversized bodies, non-JSON and GET are refused", async () => {
    const h = fresh();
    const big = JSON.stringify({ event: "meeting.started", pad: "x".repeat(300_000) });
    expect((await h(zoomRequest(big))).status).toBe(413);
    expect((await h(zoomRequest("not json"))).status).toBe(400);
    expect((await h(new Request("http://localhost/sales-live/zoom"))).status).toBe(405);
  });
});

// ----------------------------------------------------------------- slack

describe("POST /slack", () => {
  test("Slack's documented example verifies, and its command is answered as unknown", async () => {
    const h = fresh(w => {
      w.env.SLACK_SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
      w.now = 1531420618 * 1000;
    });
    const body =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    const res = await h(
      slackRequest(body, { ts: 1531420618, sig: "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      response_type: "ephemeral",
      text: "The sales app knows two commands: /available and /unavailable.",
    });
  });

  test("/available is acknowledged at once and passed to live.press", async () => {
    const h = fresh();
    const res = await h(slackRequest(slashCommand("/available")));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    expect(world.salesApiCalls[0].body).toMatchObject({
      action: "live.press",
      kind: "command",
      command: "available",
      slack_user_id: "U2CERLKJA",
      response_url: RESPONSE_URL,
    });
    expect(world.salesApiCalls[0].headers.get("x-cron-secret")).toBe(SECRETS.CRON_SECRET);
    expect(world.slackPosts).toHaveLength(0);
  });

  test("/unavailable becomes away", async () => {
    const h = fresh();
    await h(slackRequest(slashCommand("/unavailable")));
    await world.settle();
    expect(world.salesApiCalls[0].body.command).toBe("away");
  });

  test("a slow sales-api does not hold Slack's answer past 3 s", async () => {
    const h = fresh(w => {
      w.salesApiDelayMs = 10_000;
    });
    const started = performance.now();
    const res = await h(slackRequest(buttonPress()));
    expect(res.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("a button press that sales-api refuses gets the refusal in Slack", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: "Someone else took this lead." } });
    });
    await h(slackRequest(buttonPress()));
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    expect(world.salesApiCalls[0].body.actions).toEqual([{ action_id: "live.take", value: "offer-1" }]);
    expect(world.slackPosts).toEqual([
      {
        url: RESPONSE_URL,
        body: { response_type: "ephemeral", replace_original: false, text: "Someone else took this lead." },
      },
    ]);
  });

  test("a press is sent once, never retried, and a failure says to try again", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 500, json: { ok: false, error: "That did not work: boom" } });
    });
    await h(slackRequest(buttonPress()));
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    expect(world.slackPosts[0].body.text).toBe("That did not go through. Try again in a minute, or use the cockpit.");
    expect(world.status.get("sales-live/slack")?.ok).toBe(false);
  });

  test("sales-api's gateway sentences are never shown to a person, and raise an alert", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 400, json: { ok: false, error: "Unknown action." } });
    });
    await h(slackRequest(buttonPress()));
    await world.settle();
    expect(world.slackPosts[0].body.text).toBe("That did not go through. Try again in a minute, or use the cockpit.");
    expect(world.alerts.get("config:sales-live/slack")).toMatchObject({ on: true, message: NOT_HOOKED("live.press") });
  });

  test("a 4xx with no sentence of live.press's (the platform's own gateway) is a red row, not a refusal", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 401, json: { code: 401, message: "Invalid JWT" } });
    });
    await h(slackRequest(buttonPress()));
    await world.settle();
    expect(world.slackPosts[0].body.text).toBe(SLACK_COPY_DID_NOT);
    expect(world.status.get("sales-live/slack")?.ok).toBe(false);
  });

  test("a refusal is said exactly once, by the door; a success is said by live.press, not the door", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: "Someone else took this lead." } });
    });
    await h(slackRequest(buttonPress()));
    await world.settle();
    expect(world.slackPosts).toHaveLength(1);
    expect(world.status.get("sales-live/slack")?.ok).toBe(true);
    world.salesApiReply = () => ({ status: 200, json: { ok: true } });
    await h(slackRequest(buttonPress("live.take", "trig-btn-2")));
    await world.settle();
    expect(world.slackPosts).toHaveLength(1);
  });

  test("an App Home press carries where it came from, so live.press can publish the Home view again", async () => {
    const h = fresh();
    await h(slackRequest(homePress()));
    await world.settle();
    expect(world.salesApiCalls[0].body).toMatchObject({
      action: "live.press",
      kind: "block_actions",
      response_url: null,
      container_type: "view",
      view_id: "V0HOME123",
    });
    expect(world.events).toHaveLength(0);
  });

  test("an App Home press sales-api refuses is kept as a slack.reply for the VPS poster to DM", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: "You are on a call. Press it after the call." } });
    });
    await h(slackRequest(homePress()));
    await world.settle();
    expect(world.slackPosts).toHaveLength(0);
    expect(world.events).toHaveLength(1);
    expect(world.events[0]).toMatchObject({
      room_id: null,
      kind: "slack.reply",
      source: "door",
      text: "You are on a call. Press it after the call.",
      detail: { slack_user_id: "U2CERLKJA", slack_team_id: "T1DC2JH3J", view_id: "V0HOME123", container_type: "view" },
    });
    // Work for the poster, never for the sweep (it replays zoom, slack and worker events only).
    expect(world.events[0].handled_at).toBeUndefined();
    expect(world.events[0].dedupe_key).toBe(`slack.reply:${world.salesApiCalls[0].body.request_id}`);
  });

  test("an App Home press that cannot reach sales-api is told so through slack.reply", async () => {
    const h = fresh(w => {
      w.salesApiDelayMs = 1000;
      w.budget = { forwardSlack: 50 };
    });
    await h(slackRequest(homePress()));
    await world.settle();
    expect(world.events[0]).toMatchObject({ kind: "slack.reply", text: SLACK_COPY_DID_NOT });
  });

  test("opening App Home is not a press: a failure there writes no reply", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 500, json: { ok: false, error: "boom" } });
    });
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1DC2JH3J",
      event_id: "Ev2",
      event: { type: "app_home_opened", user: "U2CERLKJA", tab: "home" },
    });
    await h(slackRequest(body, { type: "application/json" }));
    await world.settle();
    expect(world.events).toHaveLength(0);
    expect(world.slackPosts).toHaveLength(0);
  });

  test("a press that times out leaves a sentence in Slack and a red status row", async () => {
    const h = fresh(w => {
      w.salesApiDelayMs = 1000;
      w.budget = { forwardSlack: 50 };
    });
    expect((await h(slackRequest(buttonPress()))).status).toBe(200);
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    expect(world.slackPosts[0].body.text).toBe("That did not go through. Try again in a minute, or use the cockpit.");
    expect(world.status.get("sales-live/slack")?.detail).toContain("no answer");
  });

  test("a Zoom forward that times out is not retried (sales-api may still be working); the sweep replays it", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiDelayMs = 1000;
      w.budget = { forwardZoom: 50 };
    });
    expect((await h(zoomRequest(zoomBody("meeting.participant_joined")))).status).toBe(200);
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
    expect(world.status.get("sales-live/zoom")?.ok).toBe(false);
  });

  test("url_verification returns the challenge after the signature", async () => {
    const h = fresh();
    const body = JSON.stringify({ type: "url_verification", token: "t", challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" });
    const res = await h(slackRequest(body, { type: "application/json" }));
    expect(await res.json()).toEqual({ challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" });
    const forged = await h(slackRequest(body, { type: "application/json", secret: "wrong" }));
    expect(forged.status).toBe(401);
  });

  test("app_home_opened is passed on as its own kind", async () => {
    const h = fresh();
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1DC2JH3J",
      event_id: "Ev1",
      event: { type: "app_home_opened", user: "U2CERLKJA", tab: "home" },
    });
    expect((await h(slackRequest(body, { type: "application/json" }))).status).toBe(200);
    await world.settle();
    expect(world.salesApiCalls[0].body).toMatchObject({ action: "live.press", kind: "app_home_opened", event_id: "Ev1" });
  });

  test("a request older than 5 minutes, or with a wrong signature, is refused", async () => {
    const h = fresh();
    const stale = await h(slackRequest(slashCommand("/available"), { ts: Math.floor(NOW / 1000) - 301 }));
    expect(stale.status).toBe(401);
    expect((await stale.json()).error).toBe("This Slack request is more than 5 minutes old.");
    const bad = await h(slackRequest(slashCommand("/available"), { secret: "wrong" }));
    expect(bad.status).toBe(401);
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("without CRON_SECRET a command says so at once", async () => {
    const h = fresh(w => {
      delete w.env.CRON_SECRET;
    });
    const res = await h(slackRequest(slashCommand("/available")));
    expect((await res.json()).text).toContain("not set up yet");
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("without CRON_SECRET a button press is answered through response_url", async () => {
    const h = fresh(w => {
      delete w.env.CRON_SECRET;
    });
    expect((await h(slackRequest(buttonPress()))).status).toBe(200);
    await world.settle();
    expect(world.slackPosts[0].body.text).toContain("not set up yet");
  });

  test("without SLACK_SIGNING_SECRET the route answers 503 with a plain sentence", async () => {
    const h = fresh(w => {
      delete w.env.SLACK_SIGNING_SECRET;
    });
    const res = await h(slackRequest(slashCommand("/available")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MISSING.slack);
  });
});

// ------------------------------------------------------------------ open

describe("GET /open/{code}", () => {
  test("a live room gives the link, the provider and the host's first names", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://call.maharamedia.com");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      state: "open",
      code: "K7Q2MX",
      provider: "zoom",
      join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
      rep: { en: "Sara", ar: "سارة" },
    });
  });

  test("an open is recorded once per device, and the room's first open once", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    world.now += 5000;
    await h(openRequest("K7Q2MX", { d: "device-bbbb-2222", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0" }));
    await world.settle();
    const opens = world.events.filter(e => e.kind === "door.open");
    expect(opens).toHaveLength(2);
    expect(opens[0]).toMatchObject({
      room_id: "room-1",
      source: "door",
      text: "The lead opened the link on a phone.",
      detail: { device: "phone", os: "ios" },
    });
    expect(opens[0].handled_at).toBeTruthy();
    expect(opens[0].detail.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(opens)).not.toContain("203.0.113.9");
    expect(world.rooms[0].first_open_at).toBe(new Date(NOW).toISOString());
    expect(world.rooms[0].open_device).toBe("phone");
    expect(opens[1]).toMatchObject({ text: "The lead opened the link on a computer.", detail: { device: "computer", os: "mac" } });
  });

  test("an open never moves the room's version, so a setter's press made just after still counts", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ version: 7 })));
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    await world.settle();
    world.now += 40_000;
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    await world.settle();
    expect(world.roomPatches).toHaveLength(2);
    for (const patch of world.roomPatches) {
      for (const k of patch.keys) expect(OPEN_COLUMNS as readonly string[]).toContain(k);
      expect(patch.versionAfter).toBe(patch.versionBefore);
    }
    expect(world.rooms[0].version).toBe(7);
  });

  test("a computer is a computer: the one device set the room logic and the database use", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    await h(openRequest("K7Q2MX", { d: "device-mac-0001", ua: MAC }));
    await world.settle();
    expect(world.rooms[0].open_device).toBe("computer");
    expect(OPEN_DEVICES).toEqual(["phone", "tablet", "computer"]);
  });

  test("a device that cannot be told apart leaves open_device empty, and the open still counts", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    await h(openRequest("K7Q2MX", { d: "device-tv-0001", ua: "SomeSmartTV/3.1 (compatible)" }));
    await world.settle();
    expect(world.rooms[0].first_open_at).toBe(new Date(NOW).toISOString());
    expect(world.rooms[0].open_device).toBeNull();
    expect(world.events[0].text).toBe("The lead opened the link.");
  });

  test("a database whose check does not know the device yet still gets the open time", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.deviceCheck = ["phone", "tablet", "desktop", "unknown"];
    });
    await h(openRequest("K7Q2MX", { d: "device-mac-0001", ua: MAC }));
    await world.settle();
    expect(world.rooms[0].first_open_at).toBe(new Date(NOW).toISOString());
    expect(world.rooms[0].open_device).toBeNull();
    expect(world.logs.some(l => l.includes('refused open_device "computer"'))).toBe(true);
    expect(world.status.get("sales-live/open")?.ok).toBe(true);
  });

  test("a lead_in room long past ends_at still opens: only the sweep ends a room", async () => {
    const h = fresh(w =>
      w.rooms.push(liveRoom({ state: "lead_in", ends_at: new Date(NOW - 45 * 60_000).toISOString() })),
    );
    const res = await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    expect(await res.json()).toMatchObject({ state: "open", join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc" });
  });

  test("a link with a full stop, an Arabic comma or a right-to-left mark after it still opens", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    for (const tail of [".", "%D8%8C", "%E2%80%8F", ")", "%E2%80%8F."]) {
      const res = await h(openRequest(`K7Q2MX${tail}`, { d: "device-aaaa-1111" }));
      expect([tail, res.status]).toEqual([tail, 200]);
      expect((await res.json()).code).toBe("K7Q2MX");
    }
    expect((await h(openRequest("K7Q2MXA", { d: "device-aaaa-1111" }))).status).toBe(404);
  });

  test("later opens move last_open_at for the open grace, at most every 30 s", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    await world.settle();
    expect(world.rooms[0].last_open_at).toBe(new Date(NOW).toISOString());
    world.now = NOW + 10_000;
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    await world.settle();
    expect(world.rooms[0].last_open_at).toBe(new Date(NOW).toISOString());
    world.now = NOW + 40_000;
    await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    await world.settle();
    expect(world.rooms[0].last_open_at).toBe(new Date(NOW + 40_000).toISOString());
    expect(world.rooms[0].first_open_at).toBe(new Date(NOW).toISOString());
    // A reload is not a second counted open.
    expect(world.events.filter(e => e.kind === "door.open")).toHaveLength(1);
  });

  test("fifty devices opening at once: fifty opens, one first open", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, i) => h(openRequest("K7Q2MX", { d: `device-${String(i).padStart(4, "0")}-x`, ip: `198.51.100.${i}` }))),
    );
    expect(answers.every(r => r.status === 200)).toBe(true);
    await world.settle();
    expect(world.events.filter(e => e.kind === "door.open")).toHaveLength(50);
    expect(world.firstOpenWrites).toBe(1);
  });

  test("without a device id the open is keyed on the address and the browser", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    await h(openRequest("K7Q2MX"));
    await h(openRequest("K7Q2MX"));
    await h(openRequest("K7Q2MX", { ip: "198.51.100.7" }));
    await world.settle();
    expect(world.events.filter(e => e.kind === "door.open")).toHaveLength(2);
  });

  test("a link preview is answered but never counted", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    for (const ua of ["WhatsApp/2.24.20.80 A", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)", ""]) {
      const res = await h(openRequest("K7Q2MX", { ua }));
      expect(res.status).toBe(200);
    }
    await world.settle();
    expect(world.events).toHaveLength(0);
    expect(world.rooms[0].first_open_at).toBeNull();
  });

  test("30 a minute per address; the 31st is told to wait, another address is not", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    for (let i = 0; i < 30; i++) expect((await h(openRequest("K7Q2MX"))).status).toBe(200);
    const refused = await h(openRequest("K7Q2MX"));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect((await refused.json()).error).toBe("Too many tries from this network. Wait a minute, then try again.");
    expect((await h(openRequest("K7Q2MX", { ip: "198.51.100.1" }))).status).toBe(200);
    world.now += 60_000;
    expect((await h(openRequest("K7Q2MX"))).status).toBe(200);
  });

  test("two tabs of one lead, both polling a room still being made, are never told to wait", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "creating", join_url: null })));
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) {
      world.now = NOW + i * 2000;
      for (const d of ["tab-in-app-111", "tab-safari-222"]) statuses.push((await h(openRequest("K7Q2MX", { d }))).status);
    }
    expect(statuses.filter(x => x === 429)).toHaveLength(0);
  });

  test("one address has a wider cap of 120 a minute over all its devices", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    let ok = 0;
    for (let i = 0; i < 150; i++) {
      const res = await h(openRequest("K7Q2MX", { d: `device-${String(i % 6).padStart(4, "0")}-x` }));
      if (res.status === 200) ok++;
    }
    expect(ok).toBe(120);
    expect((await h(openRequest("K7Q2MX", { ip: "198.51.100.77", d: "device-0000-x" }))).status).toBe(200);
  });

  test("guessing codes is limited too", async () => {
    const h = fresh();
    for (let i = 0; i < 30; i++) expect((await h(openRequest("ABCDEF"))).status).toBe(404);
    expect((await h(openRequest("ABCDEG"))).status).toBe(429);
  });

  test("an unknown code and a malformed code are both unknown", async () => {
    const h = fresh();
    const unknown = await h(openRequest("ABCDEF"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ ok: false, state: "unknown", code: "ABCDEF" });
    const malformed = await h(openRequest("K7Q2M0"));
    expect(await malformed.json()).toEqual({ ok: false, state: "unknown", code: null });
  });

  test("a lower-case code works", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    expect(await (await h(openRequest("k7q2mx"))).json()).toMatchObject({ state: "open", code: "K7Q2MX" });
  });

  test("an ended room says ended, with the WhatsApp number and no link; the open is kept as after the end", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "expired" })));
    const res = await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    expect(await res.json()).toEqual({
      ok: true,
      state: "ended",
      code: "K7Q2MX",
      rep: { en: "Sara", ar: "سارة" },
      whatsapp: "96590054963",
    });
    await world.settle();
    expect(world.events[0].detail.after_end).toBe(true);
    expect(world.events[0].text).toBe("The lead opened the link after the room closed.");
    expect(world.rooms[0].first_open_at).toBeNull();
    expect(world.rooms[0].last_open_at).toBeUndefined();
  });

  test("the link follows a replaced room, and the open counts on the new room", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom({ state: "cancelled", replaced_by: "room-2", join_url: "https://us06web.zoom.us/j/1" }));
      w.rooms.push(liveRoom({ id: "room-2", code: "P3W9ZD", join_url: "https://us06web.zoom.us/j/2?pwd=x" }));
    });
    const res = await h(openRequest("K7Q2MX", { d: "device-aaaa-1111" }));
    expect(await res.json()).toMatchObject({ state: "open", code: "K7Q2MX", join_url: "https://us06web.zoom.us/j/2?pwd=x" });
    await world.settle();
    expect(world.events[0]).toMatchObject({ room_id: "room-2", detail: { via_code: "K7Q2MX" } });
    expect(world.rooms[1].first_open_at).toBeTruthy();
  });

  test("a loop of replaced rooms ends as ended, not as a hang", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom({ state: "cancelled", replaced_by: "room-2" }));
      w.rooms.push(liveRoom({ id: "room-2", code: "P3W9ZD", state: "cancelled", replaced_by: "room-1" }));
    });
    expect(await (await h(openRequest("K7Q2MX"))).json()).toMatchObject({ state: "ended" });
  });

  test("a room still being made says preparing", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "creating", join_url: null })));
    expect(await (await h(openRequest("K7Q2MX"))).json()).toMatchObject({ state: "preparing", retry_ms: 2000 });
  });

  test("a link on an untrusted host is refused and never handed out", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ join_url: "https://evil.example/j/1" })));
    const res = await h(openRequest("K7Q2MX"));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("evil.example");
  });

  test("a Vercel page named like the site may not read call links; the one CALL_SITE_URL may", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.env.CALL_SITE_URL = "https://mahara-call-link.vercel.app";
    });
    expect((await h(openRequest("K7Q2MX", { origin: "https://call-link-evil.vercel.app" }))).status).toBe(403);
    expect((await h(openRequest("K7Q2MX", { origin: "https://mahara-call-link-x1y2z3-anyone.vercel.app" }))).status).toBe(403);
    const ok = await h(openRequest("K7Q2MX", { origin: "https://mahara-call-link.vercel.app" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://mahara-call-link.vercel.app");
  });

  test("all of /open's reads share one deadline, inside the page's wait", async () => {
    // Scaled down: 150 ms a read against a 400 ms deadline. A room, then two
    // replaced rooms, would take 450 ms; the deadline stops it at 400.
    const h = fresh(w => {
      w.rooms.push(liveRoom({ state: "cancelled", replaced_by: "room-2" }));
      w.rooms.push(liveRoom({ id: "room-2", code: "P3W9ZD", state: "cancelled", replaced_by: "room-3" }));
      w.rooms.push(liveRoom({ id: "room-3", code: "Q4X8YB" }));
      w.dbDelayMs = 150;
      w.budget = { openTotal: 400 };
    });
    const started = performance.now();
    const res = await h(openRequest("K7Q2MX"));
    const took = performance.now() - started;
    expect(took).toBeLessThan(550);
    expect([200, 503]).toContain(res.status);
  });

  test("when the room read uses the time up, the host's name is left out rather than the answer", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.dbDelayMs = 150;
      w.budget = { openTotal: 200 };
    });
    const started = performance.now();
    const res = await h(openRequest("K7Q2MX"));
    expect(performance.now() - started).toBeLessThan(350);
    expect(await res.json()).toMatchObject({ state: "open", rep: { en: null, ar: null } });
  });

  test("the door's deadline is well inside the page's own wait", () => {
    const core = require("../../../sites/call-link/core.js");
    expect(BUDGET.openTotal + 1000).toBeLessThanOrEqual(core.REQUEST_MS);
  });

  test("another site's page may not read call links; the preflight is answered", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(openRequest("K7Q2MX", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await h(openRequest("K7Q2MX", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://call.maharamedia.com");
  });

  test("a missing IP_SALT or database key answers 503 with a plain sentence", async () => {
    let h = fresh(w => {
      w.rooms.push(liveRoom());
      delete w.env.IP_SALT;
    });
    let res = await h(openRequest("K7Q2MX"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MISSING.salt);
    await world.settle();
    expect(world.alerts.get("config:sales-live/open")).toMatchObject({ on: true, message: MISSING.salt });
    world.env.IP_SALT = "salt-added-later";
    expect((await h(openRequest("K7Q2MX"))).status).toBe(200);
    await world.settle();
    expect(world.alerts.get("config:sales-live/open")?.on).toBe(false);
    h = fresh(w => {
      delete w.env.SUPABASE_SERVICE_ROLE_KEY;
    });
    res = await h(openRequest("K7Q2MX"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MISSING.db);
  });

  test("the database being down is a 503 the page can retry, and a red status row", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.dbDown = true;
    });
    const res = await h(openRequest("K7Q2MX"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, state: "error" });
    expect(world.logs.some(l => l.includes("Call links cannot be read"))).toBe(true);
  });

  test("a failed open record does not stop the lead", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(openRequest("K7Q2MX"));
    world.dbDown = true;
    await world.settle();
    expect(res.status).toBe(200);
    expect(world.logs.some(l => l.includes("An open was not recorded"))).toBe(true);
  });
});

// -------------------------------------------------------------------- go

describe("GET /go/{code}", () => {
  test("a live room is a 302 to the room", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(goRequest("K7Q2MX"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://us06web.zoom.us/j/85023456789?pwd=abc");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    await world.settle();
    // The open is recorded as /open records it (fix round 4): the call
    // page's own fallback comes here when /open could not answer.
    expect(world.events.filter(e => e.kind === "door.open").map(e => e.detail.via)).toEqual(["go"]);
  });

  test("an ended room goes to the ended page with its code only; the page asks the door for the number", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "ended" })));
    const res = await h(goRequest("K7Q2MX"));
    expect(res.headers.get("location")).toBe("https://call.maharamedia.com/ended?c=K7Q2MX");
    expect(res.headers.get("location")).not.toContain("wa=");
  });

  test("a link with punctuation after it works here too", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(goRequest("K7Q2MX%D8%8C"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://us06web.zoom.us/j/85023456789?pwd=abc");
  });

  test("an unknown code goes to the site, which says the link is not valid", async () => {
    const h = fresh();
    expect((await h(goRequest("ABCDEF"))).headers.get("location")).toBe("https://call.maharamedia.com/");
    expect((await h(goRequest("bad!"))).headers.get("location")).toBe("https://call.maharamedia.com/");
  });

  test("a room still being made asks the browser to look again in 3 s", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "requested", join_url: null })));
    const res = await h(goRequest("K7Q2MX"));
    expect(res.status).toBe(200);
    expect(res.headers.get("refresh")).toBe("3");
    expect(await res.text()).toBe(`${GO_COPY.preparing.en}\n${GO_COPY.preparing.ar}`);
  });

  test("a preview bot is not redirected", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(goRequest("K7Q2MX", { ua: "facebookexternalhit/1.1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe(`${GO_COPY.preview.en}\n${GO_COPY.preview.ar}`);
  });

  test("an untrusted link is never a redirect", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ join_url: "https://evil.example/j/1" })));
    const res = await h(goRequest("K7Q2MX"));
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
    // The lead reads it: in both languages, with what to do next.
    expect(await res.text()).toBe(`${GO_COPY.broken.en}\n${GO_COPY.broken.ar}`);
  });

  test("works without IP_SALT, and then keeps no address with the open", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      delete w.env.IP_SALT;
    });
    expect((await h(goRequest("K7Q2MX"))).status).toBe(302);
    await world.settle();
    const opens = world.events.filter(e => e.kind === "door.open");
    expect(opens).toHaveLength(1);
    expect(opens[0].detail.ip_hash).toBeUndefined();
  });
});

// ------------------------------------------------------------------ cron

describe("POST /cron", () => {
  const ID1 = "0b6f2d1e-4c3a-4f7e-9a51-2d8c6b0e7f11";
  const ID2 = "5e9a7c3b-1d2f-4a6e-8b40-7f1c2e3d4a52";

  test("the sweep's replay is answered 202 at once and passed on as exactly its event ids", async () => {
    const h = fresh();
    const res = await h(
      cronRequest({ action: "room.event", kind: "sweep.replay", payload: { event_ids: [ID1, ID2], extra: 1 }, room_id: "room-1" }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, accepted: "room.event", kind: "sweep.replay", events: 2 });
    await world.settle();
    expect(world.salesApiCalls[0].body).toEqual({ action: "room.event", kind: "sweep.replay", payload: { event_ids: [ID1, ID2] } });
    expect(world.salesApiCalls[0].headers.get("x-cron-secret")).toBe(SECRETS.CRON_SECRET);
    expect(world.salesApiCalls[0].headers.get("authorization")).toBe(`Bearer ${SERVICE_KEY}`);
    expect(world.status.get("sales-live/cron")).toMatchObject({ ok: true, detail: "Last room.event passed on." });
  });

  test("the sweep's settle and tick posts are passed on as exactly their room ids (contract-v2 S4)", async () => {
    const h = fresh();
    for (const kind of ["sweep.settle", "tick"]) {
      const res = await h(
        cronRequest({ action: "room.event", kind, room_id: "room-1", payload: { room_ids: [ID1, ID2.toUpperCase(), ID1], event_ids: [ID2] } }),
      );
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true, accepted: "room.event", kind, rooms: 2 });
    }
    await world.settle();
    expect(world.salesApiCalls.map(c => c.body)).toEqual([
      { action: "room.event", kind: "sweep.settle", payload: { room_ids: [ID1, ID2] } },
      { action: "room.event", kind: "tick", payload: { room_ids: [ID1, ID2] } },
    ]);
    expect(world.status.get("sales-live/cron")).toMatchObject({ ok: true, detail: "Last room.event passed on." });
  });

  test("a settle or tick with no room ids, too many, or ids that are not UUIDs is refused", async () => {
    const h = fresh();
    for (const kind of ["sweep.settle", "tick"])
      for (const room_ids of [[], undefined, "x", [ID1, "room-1"], Array.from({ length: 51 }, () => ID1)]) {
        const res = await h(cronRequest({ action: "room.event", kind, payload: { room_ids, event_ids: [ID1] } }));
        expect([kind, res.status]).toEqual([kind, 400]);
      }
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("thread.tick is passed on with nothing but its name", async () => {
    const h = fresh();
    expect((await h(cronRequest({ action: "thread.tick", kind: "zoom.meeting.participant_joined", room_id: "x" }))).status).toBe(202);
    await world.settle();
    expect(world.salesApiCalls[0].body).toEqual({ action: "thread.tick" });
  });

  test("a cron-secret holder cannot post a Zoom join: only sweep replays pass", async () => {
    const h = fresh();
    for (const kind of ["zoom.meeting.participant_joined", "worker.ready", "lead_in", ""]) {
      const res = await h(
        cronRequest({
          action: "room.event",
          kind,
          room_id: "room-1",
          payload: { event: "meeting.participant_joined", payload: { object: { id: "1", participant: { user_name: "Forged" } } } },
        }),
      );
      expect([kind, res.status]).toEqual([kind, 403]);
    }
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(0);
    expect(world.status.get("sales-live/cron")?.ok).toBe(false);
  });

  test("a replay with no ids, too many, or ids that are not UUIDs is refused", async () => {
    const h = fresh();
    for (const event_ids of [[], undefined, "x", [ID1, "room-1"], Array.from({ length: 51 }, () => ID1)]) {
      const res = await h(cronRequest({ action: "room.event", kind: "sweep.replay", payload: { event_ids } }));
      expect(res.status).toBe(400);
    }
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("any other action is refused before sales-api is called", async () => {
    const h = fresh();
    for (const action of ["contract.sync", "live.press", "room.create", "followup.autosend"]) {
      const res = await h(cronRequest({ action, kind: "x" }));
      expect([action, res.status]).toEqual([action, 403]);
    }
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("a slow replay never holds pg_net (10 s): the answer is at once, the outcome lands in the status row", async () => {
    const h = fresh(w => {
      w.salesApiDelayMs = 300;
      w.budget = { forwardCron: 100 };
    });
    const started = performance.now();
    const res = await h(cronRequest({ action: "room.event", kind: "sweep.replay", payload: { event_ids: [ID1] } }));
    expect(performance.now() - started).toBeLessThan(100);
    expect(res.status).toBe(202);
    await world.settle();
    expect(world.status.get("sales-live/cron")).toMatchObject({ ok: false });
    expect(world.status.get("sales-live/cron")?.detail).toContain("sales-api did not answer room.event");
  });

  test("sales-api's refusal goes to the status row, redacted", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: `This changed a moment ago. Bearer ${SERVICE_KEY}` } });
    });
    await h(cronRequest({ action: "room.event", kind: "sweep.replay", payload: { event_ids: [ID1] } }));
    await world.settle();
    const row = world.status.get("sales-live/cron");
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("sales-api refused room.event (409)");
    expect(row?.detail).not.toContain(SERVICE_KEY);
  });

  test("sales-api's gateway refusing the action raises an alert to deploy the hooks commit", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 403, json: { ok: false, error: "Not an action the desk may take." } });
    });
    await h(cronRequest({ action: "thread.tick" }));
    await world.settle();
    expect(world.alerts.get("config:sales-live/cron")).toMatchObject({ on: true, message: NOT_HOOKED("thread.tick") });
  });

  test("a wrong or missing secret is a 401", async () => {
    const h = fresh();
    expect((await h(cronRequest({ action: "thread.tick" }, "wrong"))).status).toBe(401);
    expect((await h(cronRequest({ action: "thread.tick" }, null))).status).toBe(401);
    expect(world.salesApiCalls).toHaveLength(0);
  });

  test("without CRON_SECRET the door is closed with a plain sentence", async () => {
    const h = fresh(w => {
      delete w.env.CRON_SECRET;
    });
    const res = await h(cronRequest({ action: "thread.tick" }, ""));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MISSING.cron);
  });

  test("bad JSON and a room.event with no kind are refused", async () => {
    const h = fresh();
    expect((await h(cronRequest("{not json"))).status).toBe(400);
    expect((await h(cronRequest({ action: "room.event" }))).status).toBe(403);
    expect(world.salesApiCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------- health, rest

describe("health, routing and secrets", () => {
  test("health names what is missing and never shows a value", async () => {
    const h = fresh(w => {
      delete w.env.SLACK_SIGNING_SECRET;
    });
    const res = await h(new Request("http://localhost/sales-live/health"));
    const body = await res.json();
    expect(body.routes).toEqual({
      zoom: "ready",
      slack: "missing SLACK_SIGNING_SECRET",
      open: "ready",
      go: "ready",
      cron: "ready",
    });
    const text = JSON.stringify(body);
    for (const v of [...Object.values(SECRETS), SERVICE_KEY]) expect(text).not.toContain(v);
  });

  test("an unknown path is a 404", async () => {
    const h = fresh();
    expect((await h(new Request("http://localhost/sales-live/admin"))).status).toBe(404);
  });

  test("no secret value ever reaches a log line or a status row", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiReply = () => ({ status: 500, json: { ok: false, error: `boom Bearer ${SERVICE_KEY}` } });
    });
    await h(zoomRequest(zoomBody("meeting.participant_joined")));
    await h(slackRequest(buttonPress()));
    await h(openRequest("K7Q2MX"));
    await h(cronRequest({ action: "thread.tick" }));
    world.dbDown = true;
    await h(openRequest("K7Q2MX", { ip: "198.51.100.3" }));
    await world.settle();
    const all = JSON.stringify([world.logs, [...world.status.values()], world.slackPosts, world.events, [...world.alerts.values()]]);
    for (const v of [...Object.values(SECRETS), SERVICE_KEY]) expect(all).not.toContain(v);
  });
});
