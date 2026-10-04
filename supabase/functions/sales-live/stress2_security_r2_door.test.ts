// bun test supabase/functions/sales-live/stress2_security_r2_door.test.ts
//
// Second series, round 2 (4 October 2026): security and abuse of the public
// door (sales-live) as it stands after fix round 1. Each `test` held when
// written; each `test.failing` pins a reproduced finding (its key is in its
// name) and goes red when the fix lands. No network: an in-memory PostgREST
// and a fake sales-api.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler, MISS_CEILING } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2r2-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2r2-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2r2-never-printed",
  IP_SALT: "salt-stress2r2-never-printed",
  CRON_SECRET: "cron-secret-stress2r2-never-printed",
};
const NOW = Date.UTC(2026, 9, 4, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const PAGE = "https://call.maharamedia.com";

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
    // Every real room has its request time (the column's default).
    requested_at: new Date(NOW).toISOString(),
    first_open_at: null,
    ...over,
  };
}

function world(rooms: Row[] = []) {
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
function goReq(code: string, ip: string): Request {
  return new Request(`${BASE}/functions/v1/sales-live/go/${code}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip, "sec-fetch-mode": "navigate" },
  });
}

/** Six letters of the code alphabet, one per guess, never the rooms' own. */
function guess(i: number): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  let n = i + 2_000_000;
  for (let k = 0; k < 6; k++) {
    s += A[n % 32];
    n = Math.floor(n / 32);
  }
  return s === "K7Q2MX" || s === "N3WR00" ? "ZZZZZZ" : s;
}

/** One minute of guessing from many /64s: the instance's miss ceiling is spent. */
async function flood(handler: (r: Request) => Promise<Response>, from: number, n = MISS_CEILING + 50): Promise<number> {
  let refused = 0;
  for (let i = 0; i < n; i++) {
    const ip = `2001:db8:${(i + from).toString(16)}:1::1`;
    if ((await handler(openReq(guess(i + from), ip, `g-${i}-device`))).status === 429) refused++;
  }
  return refused;
}

// ---------------------------------------------------------------------------

describe("stress2 security r2: a flood of unknown codes against a lead who never opened yet", () => {
  test("before any flood, a brand-new room's first open and its /go both work (the fixture works)", async () => {
    const { w, handler } = world([room({ code: "N3WRPQ" })]);
    const open = await handler(openReq("N3WRPQ", "198.51.100.20", "lead-device-1", PAGE));
    expect(open.status).toBe(200);
    expect(((await open.json()) as Row).state).toBe("open");
    const go = await handler(goReq("N3WRPQ", "198.51.100.21"));
    expect(go.status).toBe(302);
    await w.settle();
  });

  test(
    "door-flood-ceiling-locks-out-new-leads: while someone sends unknown codes past the instance's 600-a-minute ceiling, a lead whose room was made during the flood is refused 'Too many tries from this network' on the page AND on its Join the call fallback (/go), for as long as the flood lasts",
    async () => {
      const { w, handler } = world([]);
      // Minute one: the flood starts (an IPv6 /48 holds 65,536 /64s, so no
      // per-network limit ever trips).
      expect(await flood(handler, 10)).toBeGreaterThan(0);
      // A setter makes a room for a lead now; the lead taps the link as soon
      // as it reaches them (the worker makes the meeting and the link goes:
      // some seconds, fix round 2 reads the day's codes every 5 s at most).
      // This instance has never looked this code up, so it is not "known".
      w.rooms.push(room({ code: "N3WRPQ" }));
      w.now += 6_000;
      const open = await handler(openReq("N3WRPQ", "198.51.100.20", "lead-device-1", PAGE));
      const body = (await open.json()) as Row;
      // The page's busy state offers "Join the call", which is ?go=1, a 302 to /go/{code}.
      const go = await handler(goReq("N3WRPQ", "198.51.100.20"));
      // Minute two: the flood goes on, the lead taps Try again.
      w.now += 61_000;
      await flood(handler, 5_000);
      const again = await handler(openReq("N3WRPQ", "198.51.100.20", "lead-device-1", PAGE));
      await w.settle();
      // The lead's live room opens, whatever strangers send.
      expect({ open: open.status, state: body.state, go: go.status, again: again.status }).toEqual({
        open: 200,
        state: "open",
        go: 302,
        again: 200,
      });
    },
  );
});
