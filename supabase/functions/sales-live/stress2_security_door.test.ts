// bun test supabase/functions/sales-live/stress2_security_door.test.ts
//
// Second series, round 1 (4 October 2026): security and abuse of the public
// door (sales-live) as it stands after the first series' fixes. Each `test`
// held when written; each test that was `test.failing` pinned a reproduced
// finding (its key is in its name) and is a plain regression test since the
// fix landed (fix round 1). No network: an in-memory PostgREST and a fake
// sales-api.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { limitNet, RateLimiter } from "./door.ts";
import { FLOOD_LINE, makeHandler, MISS_CEILING } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2-never-printed",
  IP_SALT: "salt-stress2-never-printed",
  CRON_SECRET: "cron-secret-stress2-never-printed",
};
const NOW = Date.UTC(2026, 9, 4, 11, 0, 0);
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
    host_email: "stress2-host@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    ...over,
  };
}

function world(rooms: Row[] = [room()]) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "stress2-host@stress.invalid", name: "Stress Host", name_ar: "ستريس" }] as Row[],
    settings: [] as Row[],
    events: [] as Row[],
    statuses: [] as Row[],
    reads: 0,
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
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.origin !== BASE) throw new TypeError(`the door called an outside host: ${url.origin}`);
    if (url.pathname === "/functions/v1/sales-api") return Response.json({ ok: true });
    const table = url.pathname.replace("/rest/v1/", "");
    const p = url.searchParams;
    if (table === "cockpit_sales_room_events" && method === "POST") {
      if (w.events.some(e => e.dedupe_key === body.dedupe_key)) return Response.json([], { status: 201 });
      const id = randomUUID();
      w.events.push({ ...body, id });
      return Response.json([{ id, dedupe_key: body.dedupe_key }], { status: 201 });
    }
    if (table === "cockpit_sales_worker_status") {
      w.statuses.push(body);
      return new Response(null, { status: 201 });
    }
    if (table === "rpc/cockpit_sales_alert_set") return new Response(null, { status: 201 });
    if (table === "cockpit_sales_rooms" && method === "PATCH") {
      for (const r of pick(w.rooms, p)) Object.assign(r, body);
      return new Response(null, { status: 204 });
    }
    const source: Record<string, Row[]> = { cockpit_sales_rooms: w.rooms, cockpit_sales_people: w.people, cockpit_sales_settings: w.settings };
    if (method === "GET" && table === "cockpit_sales_rooms") w.reads++;
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

function openReq(code: string, ip: string, device: string, origin?: string): Request {
  return new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=${device}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip, ...(origin ? { origin } : {}) },
  });
}

/** Six letters of the code alphabet, one per guess, none of them the room's. */
function guess(i: number): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  let n = i + 1_000_000;
  for (let k = 0; k < 6; k++) {
    s += A[n % 32];
    n = Math.floor(n / 32);
  }
  return s === "K7Q2MX" ? "ZZZZZZ" : s;
}

// ---------------------------------------------------------------------------

describe("stress2 security: guessing codes from one IPv6 network", () => {
  test("one IPv4 address is held to 120 a minute (the fixture works)", async () => {
    const { w, handler } = world();
    let refused = 0;
    for (let i = 0; i < 300; i++) if ((await handler(openReq(guess(i), "203.0.113.50", `g-${i}-device`))).status === 429) refused++;
    await w.settle();
    // Fix round 3: past 20 distinct misses the address is refused outright,
    // so at most 120 a minute are ever read, and far fewer while guessing.
    expect(refused).toBeGreaterThanOrEqual(180);
  });

  test(
    "door-limit-per-full-ipv6-address: one host on one /64 rotates its address every request and is never limited, so guessing codes and flooding /open cost one database read each without end",
    async () => {
      // clientIp keys the limits on the whole address. Every IPv6 home line
      // and every cloud machine holds at least a /64 (2^64 addresses), so a
      // guesser takes a new address per request: the 30-a-device and
      // 120-an-address limits never trip, each guess is a read of
      // cockpit_sales_rooms inside /open's 4.5 s, and a hit hands over a
      // live room's join link (and, with the page's Origin, counts as the
      // lead's open). Nothing caps the door as a whole.
      const { w, handler } = world();
      let refused = 0;
      for (let i = 0; i < 1000; i++) {
        const ip = `2001:db8:1:2::${(i + 1).toString(16)}`;
        if ((await handler(openReq(guess(i), ip, `g-${i}-device`))).status === 429) refused++;
      }
      await w.settle();
      // One network, one minute: held to about what one address may do.
      expect(refused).toBeGreaterThanOrEqual(1000 - 120);
    },
  );
});

describe("stress2 security fix round 1: the network key and the door's own ceiling", () => {
  test("an IPv6 address is limited as its /64, an IPv4 address as itself", () => {
    expect(limitNet("2001:db8:1:2::1")).toBe(limitNet("2001:0db8:0001:0002:ffff:eeee:dddd:cccc"));
    expect(limitNet("2001:db8:1:2::1")).not.toBe(limitNet("2001:db8:1:3::1"));
    expect(limitNet("203.0.113.50")).toBe("203.0.113.50");
    expect(limitNet("::ffff:203.0.113.50")).toBe("203.0.113.50");
    expect(limitNet("unknown")).toBe("unknown");
  });

  test("guesses spread over many networks: past the ceiling unknown codes are refused unread, a code with a live room still opens, and the status row says so", async () => {
    const { w, handler } = world();
    // The lead opened their link a moment ago: this instance has seen the room.
    expect((await handler(openReq("K7Q2MX", "198.51.100.7", "lead-device-1", "https://call.maharamedia.com"))).status).toBe(200);
    await w.settle();
    let refused = 0;
    for (let i = 0; i < MISS_CEILING + 200; i++) {
      // A new /64 every guess: no per-network limit trips.
      const ip = `2001:db8:${(i + 10).toString(16)}:1::1`;
      if ((await handler(openReq(guess(i), ip, `g-${i}-device`))).status === 429) refused++;
    }
    await w.settle();
    expect(refused).toBe(200);
    // The 200 past the ceiling cost no read of a room by its code: only one
    // read of the last day's room codes (fix round 2, at most one each
    // LIVE_CODES_TTL_MS), so a room made during a flood still opens.
    expect(w.reads).toBeLessThanOrEqual(MISS_CEILING + 2);
    // The lead's own code still reads and opens.
    expect((await handler(openReq("K7Q2MX", "198.51.100.7", "lead-device-1"))).status).toBe(200);
    // The flood is red on the door's status row, never silent.
    expect(w.statuses.some(r => r.job === "open" && r.ok === false && r.detail === FLOOD_LINE)).toBe(true);
    // A minute on, unknown codes are read again.
    w.now += 61_000;
    expect((await handler(openReq(guess(5_000), "2001:db8:ffff:1::1", "g-late"))).status).toBe(404);
  });
});
