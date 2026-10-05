// bun test supabase/functions/sales-live/stress2_chaos_r4_door.test.ts
//
// Second series, round 4, chaos on the door: the database answers garbage.
// The door's rest() reads a 200 whose body is empty, is not JSON, or is not
// the list PostgREST sends as null (handler.ts rest: "if (!body) return
// null", and a JSON.parse failure is null too). Every reader then takes
// null as "no such room":
// - /open answers 404 state "unknown": the call page shows "This link is not
//   valid. Reply to our message and we will send a new one." with no Join
//   button (its error state offers the /go fallback; unknown offers nothing);
// - /go redirects the lead to the site's home page;
// - the Zoom webhook answers Zoom 200 "ignored: not a room" and stores
//   nothing, so Zoom never retries the lead's join (a 5xx would have been
//   retried, and a failed lookup is stored with no room for the sweep).
// A database read that failed outright (a 503, a timeout) is handled as
// "could not read" everywhere; the same read answered with garbage is not.
//
// No network: an in-memory PostgREST and a fake sales-api. Synthetic rows only.

import { describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-chaos2r4-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-chaos2r4-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-chaos2r4-never-printed",
  IP_SALT: "salt-chaos2r4-never-printed",
  CRON_SECRET: "cron-secret-chaos2r4-never-printed",
};
const NOW = Date.UTC(2026, 9, 5, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MEETING = "81234567890";

type Row = Record<string, any>;
type Garbage = "none" | "down" | "empty" | "html" | "object";

function zoomRoomRow(over: Row = {}): Row {
  return {
    id: randomUUID(),
    code: "K7Q2MX",
    state: "open",
    provider: "zoom",
    provider_meeting_id: MEETING,
    join_url: `https://us06web.zoom.us/j/${MEETING}?pwd=stress`,
    host_email: "chaos2r4-host@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    last_open_at: null,
    created_at: new Date(NOW - 60_000).toISOString(),
    requested_at: new Date(NOW - 60_000).toISOString(),
    ...over,
  };
}

function world(rooms: Row[] = [zoomRoomRow()]) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "chaos2r4-host@stress.invalid", name: "Chaos Host", name_ar: "كايوس" }] as Row[],
    events: [] as Row[],
    forwarded: [] as Row[],
    pending: [] as Promise<unknown>[],
    /** How the database answers a read of cockpit_sales_rooms. */
    roomRead: "none" as Garbage,
    async settle() {
      while (w.pending.length) await Promise.allSettled(w.pending.splice(0));
    },
  };
  const cond = (r: Row, col: string, c: string): boolean => {
    if (c === "is.null") return r[col] == null;
    if (c.startsWith("eq.")) return String(r[col]) === c.slice(3);
    if (c.startsWith("lt.")) return r[col] != null && String(r[col]) < c.slice(3);
    if (c.startsWith("gte.")) return r[col] != null && String(r[col]) >= c.slice(4);
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
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.origin !== BASE) throw new TypeError(`the door called an outside host: ${url.origin}`);
    if (url.pathname === "/functions/v1/sales-api") {
      w.forwarded.push(body);
      return Response.json({ ok: true, handled: true });
    }
    const table = url.pathname.replace("/rest/v1/", "");
    const p = url.searchParams;
    if (table === "cockpit_sales_room_events" && method === "POST") {
      if (w.events.some(e => e.dedupe_key === body.dedupe_key)) return Response.json([], { status: 201 });
      const id = randomUUID();
      w.events.push({ ...body, id });
      return Response.json([{ id, dedupe_key: body.dedupe_key }], { status: 201 });
    }
    if (table === "cockpit_sales_worker_status" || table === "rpc/cockpit_sales_alert_set") return new Response(null, { status: 201 });
    if (table === "cockpit_sales_rooms" && method === "PATCH") {
      for (const r of pick(w.rooms, p)) Object.assign(r, body);
      return new Response(null, { status: 204 });
    }
    if (table === "cockpit_sales_rooms" && method === "GET" && w.roomRead !== "none") {
      if (w.roomRead === "down") return new Response('{"message":"canceling statement due to statement timeout"}', { status: 503 });
      if (w.roomRead === "empty") return new Response("", { status: 200 });
      if (w.roomRead === "html") return new Response("<html><body>upstream page</body></html>", { status: 200 });
      return Response.json({}, { status: 200 });
    }
    const source: Record<string, Row[]> = { cockpit_sales_rooms: w.rooms, cockpit_sales_people: w.people, cockpit_sales_settings: [] };
    if (method === "GET" && source[table]) return Response.json(pick(source[table], p).slice(0, Number(p.get("limit") ?? 1000)));
    return new Response(`unexpected ${method} ${table}`, { status: 400 });
  };
  const handler = makeHandler({
    env: n => SECRETS[n] ?? "",
    fetch: fetcher as typeof fetch,
    now: () => w.now,
    background: p => {
      w.pending.push(p);
    },
    limiter: new RateLimiter(30, 60_000, 10_000),
    wideLimiter: new RateLimiter(120, 60_000, 10_000),
    log: () => {},
  });
  return { w, handler };
}

const PAGE = "https://call.maharamedia.com";
function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/functions/v1/sales-live${path}`, {
    headers: { "user-agent": IPHONE, "x-forwarded-for": "198.51.100.71", ...headers },
  });
}

const hmac = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("hex");
/** The lead's join, signed as Zoom signs it. */
function leadJoin(): Request {
  const ts = String(Math.floor(NOW / 1000));
  const body = JSON.stringify({
    event: "meeting.participant_joined",
    event_ts: NOW,
    payload: {
      account_id: "acct-stress",
      object: {
        id: MEETING,
        uuid: "inst-chaos2r4==",
        host_id: "zoom-host-stress",
        topic: "Mahara call K7Q2MX",
        participant: { user_name: "Huda Ali", participant_uuid: "p-lead-chaos2r4", join_time: new Date(NOW).toISOString() },
      },
    },
  });
  return new Request(`${BASE}/functions/v1/sales-live/zoom`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-request-timestamp": ts,
      "x-zm-signature": `v0=${hmac(SECRETS.ZOOM_WEBHOOK_SECRET, `v0:${ts}:${body}`)}`,
    },
    body,
  });
}

describe("chaos2 r4: the call page's /open while the database answers garbage", () => {
  test("HELD: the room read fails outright (503): /open answers state error, so the page offers Join the call", async () => {
    const { w, handler } = world();
    w.roomRead = "down";
    const res = await handler(req("/open/K7Q2MX?d=device-chaos2r4-01", { origin: PAGE }));
    expect([res.status, (await res.json()).state]).toEqual([503, "error"]);
  });

  for (const g of ["empty", "html", "object"] as const) {
    test(`door-garbage-read-as-unknown-link (/open, ${g}): a 200 with an ${g} body for the lead's real room must read as 'could not read' (error, with the Join fallback), never 'This link is not valid'`, async () => {
      const { w, handler } = world();
      w.roomRead = g;
      const res = await handler(req("/open/K7Q2MX?d=device-chaos2r4-01", { origin: PAGE }));
      const b = await res.json();
      expect({ status: res.status, state: b.state }).toEqual({ status: 503, state: "error" });
    });
  }
});

describe("chaos2 r4: the no-script /go while the database answers garbage", () => {
  test("HELD: the room read fails outright (503): /go says the link could not be read (503), never the home page", async () => {
    const { w, handler } = world();
    w.roomRead = "down";
    const res = await handler(req("/go/K7Q2MX"));
    expect(res.status).toBe(503);
  });

  for (const g of ["empty", "html", "object"] as const) {
    test(`door-garbage-read-as-unknown-link (/go, ${g}): the lead's tap on the page's own fallback must not be sent to the home page`, async () => {
      const { w, handler } = world();
      w.roomRead = g;
      const res = await handler(req("/go/K7Q2MX"));
      expect({ status: res.status, location: res.headers.get("location") }).toEqual({ status: 503, location: null });
    });
  }
});

describe("chaos2 r4: Zoom's join of the lead while the room lookup answers garbage", () => {
  test("HELD: the lookup fails outright (503 twice): the join is stored with no room, for sales-api and the sweep to place", async () => {
    const { w, handler } = world();
    w.roomRead = "down";
    const res = await handler(leadJoin());
    await w.settle();
    expect(res.status).toBe(200);
    expect(w.events.filter(e => e.kind === "zoom.meeting.participant_joined")).toHaveLength(1);
  });

  for (const g of ["empty", "html", "object"] as const) {
    test(`zoom-garbage-lookup-drops-lead-join (${g}): the lead's join on a real room's meeting must be stored (or refused 5xx so Zoom retries), never answered 'not a room' and dropped`, async () => {
      const { w, handler } = world();
      w.roomRead = g;
      const res = await handler(leadJoin());
      await w.settle();
      const stored = w.events.filter(e => e.kind === "zoom.meeting.participant_joined").length;
      const body = await res.json();
      expect(
        { stored_or_retried: stored === 1 || res.status >= 500 },
        `door answered ${res.status} ${JSON.stringify(body)}; stored=${stored}`,
      ).toEqual({ stored_or_retried: true });
    });
  }
});
