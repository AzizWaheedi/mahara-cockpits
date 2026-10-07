// bun test supabase/functions/sales-live/stress_security_door.test.ts
//
// Security and abuse stress of the public door (sales-live), round 1,
// 3 October 2026. Each `test` is a property that held when this file was
// written; each `test.failing` pins a confirmed finding (the key in its name
// is the finding's key) and turns red the day the fix lands, so the fix flips
// it to `test`. No network: an in-memory PostgREST, a fake sales-api and a
// fake Slack, and every URL the door asked for is kept, so a test can prove
// that nothing an attacker typed reached a query or an outside host.

import { describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { RateLimiter, safeJoinUrl } from "./door.ts";
import { makeHandler } from "./handler.ts";
import { zoomText } from "./zoom.ts";

const BASE = "https://proj.supabase.co";
const SECRETS = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress-never-printed",
  IP_SALT: "salt-stress-never-printed",
  CRON_SECRET: "cron-secret-stress-never-printed",
};
const NOW = Date.UTC(2026, 9, 3, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type Row = Record<string, any>;

function room(over: Row = {}): Row {
  return {
    id: randomUUID(),
    code: "K7Q2MX",
    state: "open",
    provider: "zoom",
    provider_meeting_id: "85023456789",
    join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
    host_email: "stress-host@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    ...over,
  };
}

/** The door against fakes, with every outgoing URL recorded. */
function world(rooms: Row[] = [room()], opts: { limiter?: RateLimiter; wide?: RateLimiter } = {}) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "stress-host@stress.invalid", name: "Stress Host", name_ar: "ستريس" }] as Row[],
    settings: [{ key: "rooms", value: { fallback: { ended_page_whatsapp: "+965 9005 4963" } } }] as Row[],
    events: [] as Row[],
    status: [] as Row[],
    alerts: [] as Row[],
    forwards: [] as { headers: Headers; body: Row }[],
    slackPosts: [] as { url: string; body: Row }[],
    urls: [] as string[],
    logs: [] as string[],
    pending: [] as Promise<unknown>[],
    async settle() {
      while (w.pending.length) await Promise.allSettled(w.pending.splice(0));
    },
  };
  const cond = (r: Row, col: string, c: string): boolean => {
    if (c === "is.null") return r[col] == null;
    if (c.startsWith("eq.")) return String(r[col]) === c.slice(3);
    if (c.startsWith("lt.")) return r[col] != null && String(r[col]) < c.slice(3);
    throw new Error(`fake PostgREST: ${col}=${c}`);
  };
  const pick = (rows: Row[], p: URLSearchParams) =>
    rows.filter(r =>
      [...p].every(([k, v]) => {
        if (["select", "limit", "order", "on_conflict"].includes(k)) return true;
        if (k === "or")
          return v
            .replace(/^\(|\)$/g, "")
            .split(",")
            .some(part => cond(r, part.slice(0, part.indexOf(".")), part.slice(part.indexOf(".") + 1)));
        return cond(r, k, v);
      }),
    );
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const raw = String(input);
    w.urls.push(raw);
    const url = new URL(raw);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.hostname === "hooks.slack.com") {
      w.slackPosts.push({ url: raw, body });
      return new Response("ok");
    }
    if (url.origin !== BASE) throw new TypeError(`the door called an outside host: ${url.origin}`);
    if (url.pathname === "/functions/v1/sales-api") {
      w.forwards.push({ headers: new Headers(init.headers), body });
      return Response.json({ ok: true });
    }
    const table = url.pathname.replace("/rest/v1/", "");
    const p = url.searchParams;
    if (table === "cockpit_sales_room_events" && method === "POST") {
      if (w.events.some(e => e.dedupe_key === body.dedupe_key)) return Response.json([], { status: 201 });
      const id = randomUUID();
      w.events.push({ ...body, id, at: new Date(w.now).toISOString() });
      return Response.json([{ id, dedupe_key: body.dedupe_key }], { status: 201 });
    }
    if (table === "cockpit_sales_worker_status") {
      w.status.push(body);
      return new Response(null, { status: 201 });
    }
    if (table === "rpc/cockpit_sales_alert_set") {
      w.alerts.push(body);
      return Response.json(1);
    }
    if (table === "cockpit_sales_rooms" && method === "PATCH") {
      for (const r of pick(w.rooms, p)) Object.assign(r, body);
      return new Response(null, { status: 204 });
    }
    const source: Record<string, Row[]> = {
      cockpit_sales_rooms: w.rooms,
      cockpit_sales_people: w.people,
      cockpit_sales_settings: w.settings,
    };
    if (method === "GET" && source[table]) return Response.json(pick(source[table], p).slice(0, Number(p.get("limit") ?? 1000)));
    return new Response(`unexpected ${method} ${table}`, { status: 400 });
  };
  const handler = makeHandler({
    env: n => (SECRETS as Record<string, string>)[n] ?? "",
    fetch: fetcher as typeof fetch,
    now: () => w.now,
    background: p => {
      w.pending.push(p);
    },
    limiter: opts.limiter ?? new RateLimiter(30, 60_000, 10_000),
    wideLimiter: opts.wide ?? new RateLimiter(120, 60_000, 10_000),
    log: line => w.logs.push(line),
  });
  return { w, handler };
}

const hmac = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");

function zoomJoin(over: Row = {}, participant: Row = {}): string {
  return JSON.stringify({
    event: "meeting.participant_joined",
    event_ts: 1759489330123,
    payload: {
      account_id: "acc-1",
      object: {
        id: 85023456789,
        uuid: "inst-1==",
        host_id: "host-1",
        topic: "Mahara call K7Q2MX",
        participant: {
          user_id: "16778240",
          user_name: "Lead Person",
          participant_uuid: "pu-1",
          email: "stress-lead@stress.invalid",
          join_time: "2026-10-03T11:02:10Z",
          ...participant,
        },
        ...over,
      },
    },
  });
}

function zoomReq(body: string, o: { secret?: string; ts?: string; sig?: string | null; signedBody?: string } = {}): Request {
  const ts = o.ts ?? "1759489330";
  const sig = o.sig === undefined ? `v0=${hmac(o.secret ?? SECRETS.ZOOM_WEBHOOK_SECRET, `v0:${ts}:${o.signedBody ?? body}`)}` : o.sig;
  const headers: Record<string, string> = { "content-type": "application/json", "x-zm-request-timestamp": ts };
  if (sig !== null) headers["x-zm-signature"] = sig;
  return new Request("https://proj.supabase.co/functions/v1/sales-live/zoom", { method: "POST", headers, body });
}

function slackReq(body: string, o: { ts?: number; secret?: string; type?: string } = {}): Request {
  const ts = String(o.ts ?? Math.floor(NOW / 1000));
  return new Request("https://proj.supabase.co/functions/v1/sales-live/slack", {
    method: "POST",
    headers: {
      "content-type": o.type ?? "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": ts,
      "x-slack-signature": `v0=${hmac(o.secret ?? SECRETS.SLACK_SIGNING_SECRET, `v0:${ts}:${body}`)}`,
    },
    body,
  });
}

const homePress = (responseUrl: unknown, trigger = "trig-1") =>
  new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: "U2CERLKJA", team_id: "T1DC2JH3J" },
      team: { id: "T1DC2JH3J" },
      response_url: responseUrl,
      trigger_id: trigger,
      container: { type: "message", message_ts: "1.2" },
      actions: [{ action_id: "live.take", value: "x" }],
    }),
  }).toString();

function openReq(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://proj.supabase.co/functions/v1/sales-live${path}`, {
    headers: { "user-agent": IPHONE, "x-forwarded-for": "198.51.100.7", ...headers },
  });
}

function cronReq(body: unknown, secret: string | null = SECRETS.CRON_SECRET, method = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("https://proj.supabase.co/functions/v1/sales-live/cron", {
    method,
    headers,
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

/** Everything the door wrote or said, as one string, to look for a secret in. */
function everything(w: ReturnType<typeof world>["w"], answers: string[] = []): string {
  return JSON.stringify([w.events, w.status, w.alerts, w.logs, w.slackPosts.map(p => p.body), answers]);
}

// ---------------------------------------------------------------- Zoom

describe("security: forged and replayed Zoom callbacks", () => {
  test("a body signed with another secret, a body changed after signing, a missing or malformed signature: 401, nothing kept, nothing passed on", async () => {
    const { w, handler } = world();
    const body = zoomJoin();
    const forged = [
      zoomReq(body, { secret: "not-the-secret" }),
      zoomReq(body, { signedBody: zoomJoin({}, { user_name: "Someone Else" }) }),
      zoomReq(body, { sig: null }),
      zoomReq(body, { sig: "v0=" }),
      zoomReq(body, { sig: `v1=${hmac(SECRETS.ZOOM_WEBHOOK_SECRET, `v0:1759489330:${body}`)}` }),
      zoomReq(body, { sig: `v0=${hmac(SECRETS.ZOOM_WEBHOOK_SECRET, `v0:1759489330:${body}`)}00` }),
      zoomReq(body, { ts: "1759489330x" }),
      zoomReq(body, { ts: "" }),
      // The signature of a different timestamp: the timestamp is part of what is signed.
      zoomReq(body, { ts: "1759489331", sig: `v0=${hmac(SECRETS.ZOOM_WEBHOOK_SECRET, `v0:1759489330:${body}`)}` }),
    ];
    for (const req of forged) expect((await handler(req)).status).toBe(401);
    await w.settle();
    expect(w.events).toEqual([]);
    expect(w.forwards).toEqual([]);
  });

  test("an unsigned url_validation never gets an HMAC back (the door is no signing oracle)", async () => {
    const { handler } = world();
    const body = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "attacker-chosen" } });
    const res = await handler(zoomReq(body, { secret: "guess" }));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(hmac(SECRETS.ZOOM_WEBHOOK_SECRET, "attacker-chosen"));
  });

  test("one captured, correctly signed join replayed 200 times (in a row and at once) is kept once and passed on once", async () => {
    const { w, handler } = world();
    const body = zoomJoin();
    for (let i = 0; i < 100; i++) await handler(zoomReq(body));
    await Promise.all(Array.from({ length: 100 }, () => handler(zoomReq(body))));
    await w.settle();
    expect(w.events.filter(e => e.kind === "zoom.meeting.participant_joined").length).toBe(1);
    expect(w.forwards.length).toBe(1);
  });

  test("a signed event whose fields are oversized or hostile is cut down before it is stored; no phone or IP is kept", async () => {
    const { w, handler } = world();
    const body = zoomJoin({}, {
      user_name: `${"A".repeat(5000)}\u0000\u001b[31m`,
      email: `${"x".repeat(500)}@stress.invalid`,
      participant_uuid: "p".repeat(5000),
      join_time: "9".repeat(5000),
      phone_number: "+96550000000",
      public_ip: "203.0.113.9",
      customer_key: "secret-ck",
    });
    expect((await handler(zoomReq(body))).status).toBe(200);
    await w.settle();
    const e = w.events[0];
    expect(e.dedupe_key.length).toBeLessThanOrEqual(300);
    expect(String(e.text).length).toBeLessThanOrEqual(500);
    const kept = JSON.stringify(e);
    expect(kept).not.toContain("\u0000");
    expect(kept).not.toContain("\u001b");
    for (const gone of ["+96550000000", "203.0.113.9", "secret-ck"]) expect(kept).not.toContain(gone);
  });

  test("zoom-name-link-in-timeline: a lead's Zoom display name is never put into the timeline as a link or markup (contract-v2 section 15: no links in room_events.text)", () => {
    // Anyone with the join link picks their own Zoom name. The door writes
    // it into room_events.text, which every seat's room timeline shows.
    const text = zoomText({
      event: "meeting.participant_joined",
      payload: { object: { participant: { user_name: "Pay here https://evil.example/pay <b>now</b>" } } },
    } as never);
    expect(text).not.toMatch(/https?:\/\/|<[a-z]/i);
  });
});

// ---------------------------------------------------------------- Slack

describe("security: Slack callbacks", () => {
  test("a press whose response_url is not Slack's own host is never called back (no SSRF)", async () => {
    const { w, handler } = world();
    const evil = [
      "https://hooks.slack.com.evil.example/actions/1",
      "https://evil.example/hooks.slack.com/actions/1",
      "https://hooks.slack.com@evil.example/actions/1",
      "https://evil.example\\@hooks.slack.com/actions/1",
      "http://hooks.slack.com/actions/1",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ];
    let n = 0;
    for (const url of evil) {
      // sales-api refuses, so the door says the refusal to the presser.
      const res = await handler(slackReq(homePress(url, `trig-${n++}`)));
      expect(res.status).toBe(200);
    }
    await w.settle();
    for (const u of w.urls) expect(new URL(u).hostname === "hooks.slack.com" || new URL(u).origin === BASE).toBe(true);
    for (const f of w.forwards) expect(f.body.response_url).toBeNull();
  });

  test("a signed request outside the 5-minute window, either way, is refused; one inside is passed on with the same request id every time", async () => {
    const { w, handler } = world();
    const body = homePress("https://hooks.slack.com/actions/T1/1/abc", "trig-replay");
    expect((await handler(slackReq(body, { ts: Math.floor(NOW / 1000) - 301 }))).status).toBe(401);
    expect((await handler(slackReq(body, { ts: Math.floor(NOW / 1000) + 301 }))).status).toBe(401);
    await handler(slackReq(body, { ts: Math.floor(NOW / 1000) - 10 }));
    await handler(slackReq(body, { ts: Math.floor(NOW / 1000) - 5 }));
    await w.settle();
    expect(w.forwards.length).toBe(2);
    // A replay inside the window is the same press: live.press must dedupe on it.
    expect(w.forwards[0]?.body.request_id).toBe(w.forwards[1]?.body.request_id);
  });

  test("the body passed to sales-api is rebuilt: fields an attacker adds to a signed payload never reach it", async () => {
    const { w, handler } = world();
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        user: { id: "U2CERLKJA", team_id: "T1DC2JH3J", email: "boss@maharamedia.com" },
        action: "room.event",
        kind: "zoom.meeting.participant_joined",
        email: "boss@maharamedia.com",
        actions: [{ action_id: "live.take", value: "x", url: "https://evil.example" }],
        trigger_id: "trig-x",
      }),
    }).toString();
    await handler(slackReq(body));
    await w.settle();
    const sent = w.forwards[0]?.body ?? {};
    expect(sent.action).toBe("live.press");
    expect(sent.kind).toBe("block_actions");
    expect(JSON.stringify(sent)).not.toContain("boss@maharamedia.com");
    expect(JSON.stringify(sent)).not.toContain("evil.example");
  });
});

// ---------------------------------------------------------------- /open and /go

describe("security: the short link's door", () => {
  test("whatever is typed after /open/ or /go/, the only room query the door builds is code=eq. and six letters of the alphabet", async () => {
    const { w, handler } = world([room({ code: "K7Q2MX" })]);
    const hostile = [
      "/open/K7Q2MX&select=*",
      "/open/K7Q2MX%26or%3D(id.neq.0)",
      "/open/K7Q2MX,code.neq.x",
      "/open/k7q2mx%22%29%3Bdrop%20table%20x--",
      "/open/%2e%2e%2fcron",
      "/open/K7Q2MX%0d%0aset-cookie:x",
      "/open/K7Q2MX%E2%80%8F.",
      "/go/K7Q2MX&order=id",
      "/go/K7Q2MX%3Fselect%3D*",
      `/open/${"A".repeat(10_000)}`,
    ];
    for (const p of hostile) await handler(openReq(p, { origin: "https://call.maharamedia.com" }));
    await w.settle();
    const roomReads = w.urls.filter(u => u.includes("/rest/v1/cockpit_sales_rooms?") && !u.includes("id=eq."));
    expect(roomReads.length).toBeGreaterThan(0);
    for (const u of roomReads) expect(new URL(u).search).toMatch(/^\?code=eq\.[A-HJ-NP-Z2-9]{6}&select=[a-z_,]+&limit=1$/);
  });

  test("another site's page may not read call links; Slack-style lookalike origins are refused too", async () => {
    const { handler } = world();
    for (const origin of [
      "https://call.maharamedia.com.evil.example",
      "https://evil.example",
      "null",
      "https://call.maharamedia.com:8443",
      "http://call.maharamedia.com",
      "https://CALL.maharamedia.com/",
    ]) {
      const res = await handler(openReq("/open/K7Q2MX", { origin }));
      expect([origin, res.status]).toEqual([origin, 403]);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    const ok = await handler(openReq("/open/K7Q2MX", { origin: "https://call.maharamedia.com" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://call.maharamedia.com");
  });

  test("the page is told the room's link and first names only: never the host's email, the contact, a host link or any other column", async () => {
    const { handler } = world([room({ contact_id: "stress-lead-1", start_url: "https://us06web.zoom.us/s/1?zak=HOST" })]);
    const res = await handler(openReq("/open/K7Q2MX", { origin: "https://call.maharamedia.com" }));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["code", "join_url", "ok", "provider", "rep", "state"]);
    expect(JSON.stringify(body)).not.toMatch(/stress-host@|stress-lead|zak=|start_url/);
  });

  test("/go never redirects anywhere but Zoom's or Meet's own https hosts, whatever the row holds", async () => {
    const bad = [
      "https://zoom.us.evil.example/j/1",
      "https://evil.example/?next=https://zoom.us/j/1",
      "https://zoom.us@evil.example/j/1",
      "https://user:pw@us06web.zoom.us/j/1",
      "https://us06web.zoom.us:8443/j/1",
      "http://us06web.zoom.us/j/1",
      "javascript:alert(document.domain)",
      "data:text/html,<script>alert(1)</script>",
      "https://evilzoom.us/j/1",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "//evil.example/j/1",
      "https://evil.example\\.zoom.us/j/1",
    ];
    for (const join_url of bad) {
      const { handler } = world([room({ join_url })]);
      const res = await handler(openReq("/go/K7Q2MX"));
      const loc = res.headers.get("location");
      expect([join_url, res.status === 302 && loc ? new URL(loc).hostname : "no redirect"]).toEqual([join_url, "no redirect"]);
    }
  });

  test("door-hands-out-host-link: a Zoom start link (zak= or /s/) in join_url is never handed to the page or redirected to (defence in depth: the database only checks https)", async () => {
    // rooms.join_url's only check is ~ '^https://'. Any service-role writer
    // that stores a start link by mistake would have the door hand the
    // host's own login to whoever holds the code; safeJoinUrl checks the
    // host name only. roomlogic.ts isHostLink already knows both shapes.
    const startLinks = [
      "https://us06web.zoom.us/s/85023456789?zak=eyJhbGciOiJIUzI1NiJ9.stress.sig",
      "https://us06web.zoom.us/j/85023456789?pwd=abc&zak=stress",
    ];
    for (const join_url of startLinks) {
      expect(safeJoinUrl(join_url)).toBeNull();
      const { handler } = world([room({ join_url })]);
      const res = await handler(openReq("/go/K7Q2MX"));
      expect(res.status).not.toBe(302);
    }
  });

  test("open-xff-spoof: one client rotating the first X-Forwarded-For value is still limited (the edge appends the real address; the door keys on the first)", async () => {
    // clientIp() takes the FIRST x-forwarded-for entry, which the client
    // writes itself; a proxy in front (Cloudflare, Supabase's edge) appends
    // the real address after it. 1,000 requests a minute from one machine,
    // each with a made-up first entry and a made-up device id:
    const { handler } = world();
    let limited = 0;
    for (let i = 0; i < 1000; i++) {
      const res = await handler(
        openReq(`/open/K7Q2MX?d=dev-${i.toString().padStart(8, "0")}`, {
          origin: "https://call.maharamedia.com",
          "x-forwarded-for": `10.${(i >> 8) & 255}.${i & 255}.1, 198.51.100.7`,
          "cf-connecting-ip": "198.51.100.7",
          "x-real-ip": "198.51.100.7",
        }),
      );
      if (res.status === 429) limited++;
    }
    // The per-address cap is 120 a minute: at least 880 should be told to wait.
    expect(limited).toBeGreaterThanOrEqual(880);
  });

  test("door-open-rows-unbounded: opens of one room from new device ids are bounded, so the room's timeline cannot be flooded", async () => {
    // Every new ?d= is a new door.open row (the dedupe key is the device id
    // the client sends). From ONE address, staying under the 120-a-minute
    // cap, ten minutes of opens:
    const { w, handler } = world();
    for (let minute = 0; minute < 10; minute++) {
      w.now = NOW + minute * 61_000;
      for (let i = 0; i < 120; i++)
        await handler(openReq(`/open/K7Q2MX?d=m${minute}-dev-${String(i).padStart(6, "0")}`, { origin: "https://call.maharamedia.com" }));
    }
    await w.settle();
    const opens = w.events.filter(e => e.kind === "door.open").length;
    // room.status shows the newest 20 events: past 20, the real Zoom join,
    // "Link sent" and the sweep's lines are pushed off the rep's timeline.
    expect(opens).toBeLessThanOrEqual(20);
  });

  test("a code that is not a room answers unknown with nothing else, and an ended room never gives a link", async () => {
    const { handler } = world([room({ code: "ENDED2", state: "ended", join_url: "https://us06web.zoom.us/j/1?pwd=x" })]);
    const unknown = await (await handler(openReq("/open/ZZZZZZ", { origin: "https://call.maharamedia.com" }))).json();
    expect(unknown).toEqual({ ok: false, state: "unknown", code: "ZZZZZZ" });
    const ended = await (await handler(openReq("/open/ENDED2", { origin: "https://call.maharamedia.com" }))).json();
    expect(ended.state).toBe("ended");
    expect(JSON.stringify(ended)).not.toContain("zoom.us");
    const go = await handler(openReq("/go/ENDED2"));
    expect(go.headers.get("location")).toBe("https://call.maharamedia.com/ended?c=ENDED2");
  });
});

// ---------------------------------------------------------------- bodies

describe("abuse: request bodies", () => {
  /** A chunked body (no content-length) of `total` bytes that counts what the door pulled. */
  function chunked(total: number) {
    const seen = { pulled: 0 };
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (seen.pulled >= total) return c.close();
        seen.pulled += chunk.length;
        c.enqueue(chunk);
      },
    });
    return { seen, body };
  }

  test("door-body-unbounded-read: an unsigned chunked body far over the cap is cut off near the cap, not read whole into memory", async () => {
    // readBody() checks content-length, then awaits req.arrayBuffer(): a
    // chunked POST has no content-length, so /zoom and /slack buffer the
    // WHOLE body before the size check and before the signature check. Any
    // client, with no secret, can make an instance hold tens of megabytes
    // per request.
    for (const path of ["zoom", "slack"]) {
      const { handler } = world();
      const { seen, body } = chunked(16 * 1024 * 1024);
      const res = await handler(
        new Request(`https://proj.supabase.co/functions/v1/sales-live/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-zm-request-timestamp": "1", "x-zm-signature": `v0=${"0".repeat(64)}` },
          body,
          duplex: "half",
        } as RequestInit),
      );
      expect(res.status).toBe(413);
      expect([path, seen.pulled]).toEqual([path, expect.any(Number)]);
      expect(seen.pulled).toBeLessThanOrEqual(512 * 1024);
    }
  });

  test("the cron door checks its secret before it reads a byte of the body", async () => {
    const { handler } = world();
    const { seen, body } = chunked(4 * 1024 * 1024);
    const res = await handler(
      new Request("https://proj.supabase.co/functions/v1/sales-live/cron", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": "wrong" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(401);
    expect(seen.pulled).toBeLessThanOrEqual(256 * 1024);
  });
});

// ---------------------------------------------------------------- /cron

describe("security: the cron door", () => {
  test("no secret, a wrong one, one with a byte more or less, or a GET: refused before anything is read", async () => {
    const { w, handler } = world();
    const body = { action: "room.event", kind: "tick", payload: { room_ids: [randomUUID()] } };
    for (const s of [null, "", "x", `${SECRETS.CRON_SECRET}x`, SECRETS.CRON_SECRET.slice(0, -1), SECRETS.CRON_SECRET.toUpperCase()])
      expect((await handler(cronReq(body, s))).status).toBe(401);
    expect((await handler(cronReq(body, SECRETS.CRON_SECRET, "GET"))).status).toBe(405);
    await w.settle();
    expect(w.forwards).toEqual([]);
  });

  test("with the secret, a kind outside the sweep's three (prototype names included) is refused, and a Zoom join can never be posted", async () => {
    const { w, handler } = world();
    for (const kind of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "zoom.meeting.participant_joined",
      "worker.ready",
      "worker.failed",
      "live.claimed",
      "TICK",
    ]) {
      const res = await handler(cronReq({ action: "room.event", kind, payload: { room_ids: [randomUUID()], event_ids: [randomUUID()] } }));
      expect([kind, res.status]).toEqual([kind, 403]);
    }
    for (const action of ["live.press", "reply.seen", "contract.sync", "room.create", "room.open", "followup.send_due"])
      expect((await handler(cronReq({ action }))).status).toBe(403);
    await w.settle();
    expect(w.forwards).toEqual([]);
  });

  test("what is passed on is rebuilt from the checked ids only: extra fields, a room id, an event body or a lead never reach sales-api", async () => {
    const { w, handler } = world();
    const id = randomUUID();
    const res = await handler(
      cronReq({
        action: "room.event",
        kind: "sweep.replay",
        source: "zoom",
        event_id: randomUUID(),
        room_id: randomUUID(),
        payload: { event_ids: [id.toUpperCase(), id], room_ids: [randomUUID()], participant: { email: "boss@maharamedia.com" } },
        contact_id: "stress-lead-1",
      }),
    );
    expect(res.status).toBe(202);
    await w.settle();
    expect(w.forwards.map(f => f.body)).toEqual([{ action: "room.event", kind: "sweep.replay", payload: { event_ids: [id] } }]);
  });

  test("ids that are not UUIDs, more than 50, a payload that is a list, or a body that is not an object are refused", async () => {
    const { w, handler } = world();
    const bad: unknown[] = [
      { action: "room.event", kind: "tick", payload: { room_ids: ["1 or 1=1"] } },
      { action: "room.event", kind: "tick", payload: { room_ids: [`${randomUUID()}&select=*`] } },
      { action: "room.event", kind: "tick", payload: { room_ids: Array.from({ length: 51 }, () => randomUUID()) } },
      { action: "room.event", kind: "tick", payload: [randomUUID()] },
      { action: "room.event", kind: "tick", payload: { room_ids: [] } },
      [{ action: "thread.tick" }],
      "null",
      "\"room.event\"",
    ];
    for (const b of bad) expect((await handler(cronReq(b))).status).toBeGreaterThanOrEqual(400);
    const big = JSON.stringify({ action: "thread.tick", pad: "x".repeat(70_000) });
    expect((await handler(cronReq(big))).status).toBe(413);
    await w.settle();
    expect(w.forwards).toEqual([]);
  });
});

// ---------------------------------------------------------------- secrets

describe("security: no secret value ever leaves the door", () => {
  test("after a battery of good, forged and failing requests, no secret is in a stored row, a status row, an alert, a log line, a Slack post or an answer", async () => {
    const { w, handler } = world();
    const answers: string[] = [];
    const reqs = [
      zoomReq(zoomJoin()),
      zoomReq(zoomJoin(), { secret: "wrong" }),
      slackReq(homePress("https://hooks.slack.com/actions/T1/1/abc")),
      slackReq(homePress("https://hooks.slack.com/actions/T1/1/abc"), { secret: "wrong" }),
      openReq("/open/K7Q2MX", { origin: "https://call.maharamedia.com" }),
      openReq("/go/K7Q2MX"),
      cronReq({ action: "thread.tick" }),
      cronReq({ action: "thread.tick" }, "wrong"),
      new Request("https://proj.supabase.co/functions/v1/sales-live/health"),
    ];
    for (const r of reqs) answers.push(await (await handler(r)).text());
    await w.settle();
    const all = everything(w, answers);
    for (const [name, value] of Object.entries(SECRETS)) if (name !== "SUPABASE_URL") expect([name, all.includes(value)]).toEqual([name, false]);
    // The forward to sales-api carries the secret in a header, never in a body.
    for (const f of w.forwards) expect(JSON.stringify(f.body)).not.toContain(SECRETS.CRON_SECRET);
  });
});
