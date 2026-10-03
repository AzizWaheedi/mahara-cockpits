// bun test supabase/functions/sales-live
//
// The whole door, route by route, against an in-memory PostgREST, a fake
// sales-api and a fake Slack. No network. Covers the refusals, retries,
// duplicate and late webhooks, concurrency, timeouts and missing secrets.

import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { BUDGET, makeHandler, MISSING } from "./handler.ts";

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
  firstOpenWrites = 0;
  dbDown = false;
  dbDelayMs = 0;
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
      await this.wait(this.salesApiDelayMs, init.signal);
      const r = this.salesApiReply(body, this.salesApiCalls.length);
      return Response.json(r.json, { status: r.status });
    }
    if (!url.pathname.startsWith("/rest/v1/")) return new Response("no such host", { status: 404 });
    if (headers.get("authorization") !== `Bearer ${SERVICE_KEY}`) return new Response("no key", { status: 401 });
    await this.wait(this.dbDelayMs, init.signal);
    if (this.dbDown) return new Response('{"message":"connection refused"}', { status: 503 });
    return this.rest(url, method, body);
  };

  private match(rows: Row[], params: URLSearchParams): Row[] {
    return rows.filter(r => {
      for (const [k, v] of params) {
        if (["select", "limit", "on_conflict", "order"].includes(k)) continue;
        if (v === "is.null" ? r[k] != null : v.startsWith("eq.") ? String(r[k]) !== v.slice(3) : true) return false;
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
      this.events.push({ ...body, at: new Date(this.now).toISOString() });
      return Response.json([{ dedupe_key: body.dedupe_key }], { status: 201 });
    }
    if (table === "cockpit_sales_worker_status" && method === "POST") {
      this.status.set(`${body.worker}/${body.job}`, body);
      return new Response(null, { status: 201 });
    }
    if (table === "cockpit_sales_rooms" && method === "PATCH") {
      const hits = this.match(this.rooms, p);
      for (const r of hits) Object.assign(r, body);
      if (hits.length && "first_open_at" in body) this.firstOpenWrites++;
      return new Response(null, { status: 204 });
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
    ...over,
  };
}

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
    expect(ev).toMatchObject({ room_id: "room-1", kind: "zoom.meeting.participant_joined", source: "zoom" });
    expect(ev.dedupe_key).toMatch(/^zoom:meeting\.participant_joined:/);
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
      room_id: "room-1",
      dedupe_key: ev.dedupe_key,
    });
    expect(call.body.payload.participant.email).toBe("lead@example.com");
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

  test("a meeting the cockpit does not know is stored with no room", async () => {
    const h = fresh();
    const res = await h(zoomRequest(zoomBody("meeting.started", {}, { id: 11111111111, topic: "Weekly sync" })));
    expect(res.status).toBe(200);
    expect(world.events[0].room_id).toBeNull();
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

  test("sales-api failing is retried once, then left for the sweep with a red status row", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      w.salesApiReply = () => ({ status: 502, json: { ok: false, error: "That did not work: HighLevel 502" } });
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(200);
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(2);
    expect(world.events[0].handled_at).toBeUndefined();
    const row = world.status.get("sales-live/zoom");
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("The sweep replays it.");
  });

  test("a sales-api refusal (4xx) is not retried", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: "This changed a moment ago." } });
    });
    await h(zoomRequest(zoomBody("meeting.participant_joined")));
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(1);
  });

  test("without CRON_SECRET the event is stored, not passed on, and the status row says why", async () => {
    const h = fresh(w => {
      delete w.env.CRON_SECRET;
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(200);
    await world.settle();
    expect(world.events).toHaveLength(1);
    expect(world.salesApiCalls).toHaveLength(0);
    expect(world.status.get("sales-live/zoom")?.detail).toContain("CRON_SECRET is missing");
  });

  test("without ZOOM_WEBHOOK_SECRET the route answers 503 with a plain sentence", async () => {
    const h = fresh(w => {
      delete w.env.ZOOM_WEBHOOK_SECRET;
    });
    const res = await h(zoomRequest(zoomBody("meeting.participant_joined")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MISSING.zoom);
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

  test("sales-api's gateway sentences are never shown to a person", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 400, json: { ok: false, error: "Unknown action." } });
    });
    await h(slackRequest(buttonPress()));
    await world.settle();
    expect(world.slackPosts[0].body.text).toBe("That did not go through. Try again in a minute, or use the cockpit.");
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

  test("a Zoom forward that times out is retried once, then left for the sweep", async () => {
    const h = fresh(w => {
      w.salesApiDelayMs = 1000;
      w.budget = { forwardZoom: 50 };
    });
    expect((await h(zoomRequest(zoomBody("meeting.participant_joined")))).status).toBe(200);
    await world.settle();
    expect(world.salesApiCalls).toHaveLength(2);
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
    expect(opens[0]).toMatchObject({ room_id: "room-1", source: "door", detail: { device: "mobile", os: "ios" } });
    expect(opens[0].handled_at).toBeTruthy();
    expect(opens[0].detail.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(opens)).not.toContain("203.0.113.9");
    expect(world.rooms[0].first_open_at).toBe(new Date(NOW).toISOString());
    expect(world.rooms[0].open_device).toBe("mobile");
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
    expect(world.rooms[0].first_open_at).toBeNull();
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
    expect(world.events).toHaveLength(0);
  });

  test("an ended room goes to the ended page, with the WhatsApp number", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ state: "ended" })));
    const res = await h(goRequest("K7Q2MX"));
    expect(res.headers.get("location")).toBe("https://call.maharamedia.com/ended?wa=96590054963");
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
    expect(await res.text()).toContain("almost ready");
  });

  test("a preview bot is not redirected", async () => {
    const h = fresh(w => w.rooms.push(liveRoom()));
    const res = await h(goRequest("K7Q2MX", { ua: "facebookexternalhit/1.1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  test("an untrusted link is never a redirect", async () => {
    const h = fresh(w => w.rooms.push(liveRoom({ join_url: "https://evil.example/j/1" })));
    const res = await h(goRequest("K7Q2MX"));
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
  });

  test("works without IP_SALT, because it stores nothing", async () => {
    const h = fresh(w => {
      w.rooms.push(liveRoom());
      delete w.env.IP_SALT;
    });
    expect((await h(goRequest("K7Q2MX"))).status).toBe(302);
  });
});

// ------------------------------------------------------------------ cron

describe("POST /cron", () => {
  test("room.event and thread.tick go to sales-api with the key and the secret", async () => {
    const h = fresh(w => {
      w.salesApiReply = b => ({ status: 200, json: { ok: true, replayed: b.kind } });
    });
    const res = await h(cronRequest({ action: "room.event", kind: "sweep.replay", room_id: "room-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replayed: "sweep.replay" });
    expect(world.salesApiCalls[0].headers.get("x-cron-secret")).toBe(SECRETS.CRON_SECRET);
    expect(world.salesApiCalls[0].headers.get("authorization")).toBe(`Bearer ${SERVICE_KEY}`);
    expect((await h(cronRequest({ action: "thread.tick" }))).status).toBe(200);
    expect(world.salesApiCalls).toHaveLength(2);
  });

  test("any other action is refused before sales-api is called", async () => {
    const h = fresh();
    for (const action of ["contract.sync", "live.press", "room.create", "followup.autosend"]) {
      const res = await h(cronRequest({ action, kind: "x" }));
      expect([action, res.status]).toEqual([action, 403]);
    }
    expect(world.salesApiCalls).toHaveLength(0);
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

  test("sales-api's own refusal comes back as it was", async () => {
    const h = fresh(w => {
      w.salesApiReply = () => ({ status: 409, json: { ok: false, error: "This changed a moment ago." } });
    });
    const res = await h(cronRequest({ action: "room.event", kind: "sweep.replay" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This changed a moment ago.");
  });

  test("bad JSON and a room.event with no kind are refused", async () => {
    const h = fresh();
    expect((await h(cronRequest("{not json"))).status).toBe(400);
    expect((await h(cronRequest({ action: "room.event" }))).status).toBe(400);
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
    const all = JSON.stringify([world.logs, [...world.status.values()], world.slackPosts, world.events]);
    for (const v of [...Object.values(SECRETS), SERVICE_KEY]) expect(all).not.toContain(v);
  });
});
