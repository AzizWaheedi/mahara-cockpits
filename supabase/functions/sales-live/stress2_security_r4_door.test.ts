// bun test supabase/functions/sales-live/stress2_security_r4_door.test.ts
//
// Second series, round 4 (5 October 2026): security and abuse of the public
// door (sales-live) as it stands after fix round 3. Each `test` held when
// written; the tests named by a finding's key pinned it as `test.failing`
// and are regression tests since fix round 4. No network: an in-memory PostgREST
// and a fake sales-api. Synthetic rows only (stress- names, .invalid hosts).

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler, MISS_CEILING, MISS_WINDOW_MS, MISSES_PER_NET, MISSES_PER_WIDE } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2r4-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2r4-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2r4-never-printed",
  IP_SALT: "salt-stress2r4-never-printed",
  CRON_SECRET: "cron-secret-stress2r4-never-printed",
};
const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type Row = Record<string, any>;

/** Six letters of the code alphabet for guess i (never one of the feeder's codes). */
function guess(i: number): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  let n = i + 7_000_000;
  for (let k = 0; k < 6; k++) {
    s += A[n % 32];
    n = Math.floor(n / 32);
  }
  return s;
}

function room(code: string, over: Row = {}): Row {
  return {
    id: randomUUID(),
    code,
    state: "open",
    provider: "zoom",
    provider_meeting_id: "85099990001",
    join_url: "https://us06web.zoom.us/j/85099990001?pwd=stressr4",
    host_email: "stress2r4-host@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 60 * 60_000).toISOString(),
    requested_at: new Date(NOW - 60_000).toISOString(),
    first_open_at: null,
    purpose: "fallback",
    ...over,
  };
}

function world(rooms: Row[]) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "stress2r4-host@stress.invalid", name: "Stress Host", name_ar: "ستريس" }] as Row[],
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

/** A script's /open: no Origin (or any it likes), a fresh device id each time. */
function openReq(code: string, ip: string, device: string): Request {
  return new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=${device}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip },
  });
}
function goReq(code: string, ip: string): Request {
  return new Request(`${BASE}/functions/v1/sales-live/go/${code}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip },
  });
}

/** The feeder's five made-up codes (never a room), outside the guesser's range. */
const FEED = ["ZZZZZ2", "ZZZZZ3", "ZZZZZ4", "ZZZZZ5", "ZZZZZ6"];

/**
 * Five ordinary IPv4 addresses, each in its own /24, each asking 120 times
 * in the first seconds of a minute for the same five made-up codes: 600
 * lookups that find no room, so the instance is past its miss ceiling for
 * that minute. Each address misses only five distinct codes (its bound is
 * 20 in ten minutes), each code is asked 120 times (its bound is 150 a
 * minute), and each address stays inside its own 120 a minute.
 */
async function feed(handler: (r: Request) => Promise<Response>, minute: number): Promise<number> {
  let misses = 0;
  for (let a = 0; a < 5; a++) {
    const ip = `198.51.${100 + a}.7`;
    for (let k = 0; k < 120; k++) {
      const res = await handler(openReq(FEED[k % 5] as string, ip, `feed-${minute}-${a}-${k}`));
      if (res.status === 404) misses++;
    }
  }
  return misses;
}

/**
 * A real flood (fixed in stress2 round 4, the ceiling counts each network's
 * distinct misses): thirty fresh addresses, each in its own /24, each asking
 * twenty made-up codes nobody else asks, in the first seconds of `minute`.
 * That is MISS_CEILING distinct misses, so the instance is past its ceiling
 * for the rest of that minute.
 */
async function realFlood(handler: (r: Request) => Promise<Response>, minute: number): Promise<number> {
  let misses = 0;
  for (let a = 0; a < 30; a++) {
    const ip = `100.${64 + minute}.${a}.7`;
    for (let k = 0; k < MISSES_PER_NET; k++) {
      const res = await handler(openReq(guess(3_000_000 + minute * 1_000 + a * MISSES_PER_NET + k), ip, `flood-${minute}-${a}-${k}`));
      if (res.status === 404) misses++;
    }
  }
  return misses;
}

describe("stress2 security r4: the miss ceiling and a network's own miss bound", () => {
  test("without a flood, one /64 that misses 20 codes is refused everything, the live code included (the fixture works)", async () => {
    const live = room(guess(500));
    const { w, handler } = world([live]);
    let refused = 0;
    for (let i = 0; i < MISSES_PER_NET + 5; i++) if ((await handler(openReq(guess(i), "2001:db8:4444:1::1", `g-${i}-dev`))).status === 429) refused++;
    expect(refused).toBe(5);
    const res = await handler(openReq(live.code, "2001:db8:4444:1::1", "g-live-dev"));
    expect(res.status).toBe(429);
    await w.settle();
  });

  test("fixed: five addresses repeating five made-up codes no longer hold the instance's ceiling open; a new code from another network is still looked up", async () => {
    const { w, handler } = world([room(guess(500))]);
    const before = w.reads;
    // Every ask is answered "no such link" (404); the repeats from memory, with no lookup.
    expect(await feed(handler, 0)).toBe(MISS_CEILING);
    expect(w.reads - before).toBe(25);
    await w.settle();
    expect((await handler(openReq(guess(1), "203.0.113.9", "x-dev-0001"))).status).toBe(404);
  });

  test("a real flood (thirty networks, twenty distinct misses each) puts one instance past its ceiling: an unknown code is then turned away unread (the fixture works)", async () => {
    const { w, handler } = world([room(guess(500))]);
    expect(await realFlood(handler, 0)).toBe(MISS_CEILING);
    await w.settle();
    expect((await handler(openReq(guess(1), "203.0.113.9", "x-dev-0001"))).status).toBe(429);
  });

  test(
    "flood-ceiling-guesses-uncounted: while five addresses hold the instance past its miss ceiling, one /64 guesses 1,200 codes in ten minutes (60 times its own bound of 20), none is counted against it, and the live room's code is answered 200 with its join link on the 1,200th guess",
    async () => {
      // mayLookUp turns an unknown code away (429) before the lookup, so
      // found() never runs and the guesser's network never collects a miss;
      // a code of a room asked for in the last day is read and answered.
      // 429 = no room, 200 = a live room's join link: the ceiling meant to
      // spare the database is an oracle no network's bound applies to.
      const TOTAL = 1_200;
      const live = room(guess(TOTAL - 1));
      const { w, handler } = world([live]);
      let i = 0;
      let refusedUnread = 0;
      const answered: Row[] = [];
      for (let minute = 0; minute < 10; minute++) {
        w.now = NOW + minute * 61_000;
        await realFlood(handler, minute);
        for (let k = 0; k < 120; k++, i++) {
          const res = await handler(openReq(guess(i), "2001:db8:4444:2::1", `g-${i}-device`));
          if (res.status === 429) refusedUnread++;
          if (res.status === 200) answered.push(await res.json());
        }
      }
      await w.settle();
      // What should hold: a network that has asked for 1,199 codes that are
      // no room is told nothing about the 1,200th, as it would be with no
      // flood (it is refused after its 20th miss).
      expect({
        guessed: i,
        join_links_handed_over: answered.filter(v => typeof v.join_url === "string").length,
      }).toEqual({ guessed: TOTAL, join_links_handed_over: 0 });
      expect(refusedUnread).toBe(TOTAL);
    },
  );

  test(
    "flood-ceiling-guesses-uncounted (/go): the no-script route answers the same way, a 302 to the live room's meeting for a /64 whose 1,199 other guesses were turned away uncounted",
    async () => {
      const TOTAL = 1_200;
      const live = room(guess(TOTAL - 1));
      const { w, handler } = world([live]);
      let i = 0;
      let toMeeting = 0;
      for (let minute = 0; minute < 40; minute++) {
        w.now = NOW + minute * 61_000;
        await realFlood(handler, minute);
        // /go has no device id: 30 a minute per network (the per-device bound).
        for (let k = 0; k < 30 && i < TOTAL; k++, i++) {
          const res = await handler(goReq(guess(i), "2001:db8:4444:3::1"));
          if (res.status === 302 && (res.headers.get("location") ?? "").startsWith("https://us06web.zoom.us/")) toMeeting++;
        }
      }
      await w.settle();
      expect({ guessed: i, redirected_to_meeting: toMeeting }).toEqual({ guessed: TOTAL, redirected_to_meeting: 0 });
    },
  );
});

describe("stress2 security r4: the miss bounds and the leads who share a network", () => {
  test("a lead alone on their network opens their link on /open and on the no-script /go (the fixture works)", async () => {
    const live = room("K7Q2MX");
    const { w, handler } = world([live]);
    expect((await handler(openReq("K7Q2MX", "198.51.100.200", "lead-device-1"))).status).toBe(200);
    expect((await handler(goReq("K7Q2MX", "198.51.100.200"))).status).toBe(302);
    await w.settle();
  });

  test(
    "allocation-miss-bound-locks-out-leads: a guesser behind the same carrier-NAT /24 as a lead (or on the same mobile carrier's IPv6 /48) misses 100 codes; the lead, who never mistyped, then gets 429 'Too many tries from this network' on /open and on the no-script /go the busy page offers, for up to ten minutes",
    async () => {
      // Fix round 3 (code-guess-oracle-per-64) refuses every code, live ones
      // included, from an allocation that missed MISSES_PER_WIDE distinct
      // codes in MISS_WINDOW_MS. A carrier puts thousands of phones behind
      // one IPv4 /24 (carrier NAT) and hands a mobile's /64 out of a shared
      // /48, so one guesser there (a residential proxy exit, or anyone on
      // the same carrier) shuts the call link for every lead in it. The busy
      // page's own way round (call.js: "the door's limits must never keep
      // the lead out of their call", the ?go=1 button) is held by the same
      // bound on /go.
      const live = room("K7Q2MX");
      const { w, handler } = world([live]);
      let i = 0;
      // Five subscribers' public addresses in the carrier's /24, twenty distinct misses each.
      for (let a = 0; a < 5; a++)
        for (let k = 0; k < MISSES_PER_NET; k++, i++)
          await handler(openReq(guess(10_000 + i), `198.51.100.${10 + a}`, `nb-${a}-${k}-dev`));
      expect(i).toBe(MISSES_PER_WIDE);
      // The lead, on another address of that /24, opens the link sent a moment ago, nine minutes later still.
      w.now = NOW + 60_000;
      const first = await handler(openReq("K7Q2MX", "198.51.100.200", "lead-device-1"));
      const viaGo = await handler(goReq("K7Q2MX", "198.51.100.200"));
      w.now = NOW + MISS_WINDOW_MS - 60_000;
      const later = await handler(openReq("K7Q2MX", "198.51.100.200", "lead-device-1"));
      await w.settle();
      expect({ open: first.status, go: viaGo.status, nine_minutes_on: later.status }).toEqual({ open: 200, go: 302, nine_minutes_on: 200 });
    },
  );

  test(
    "allocation-miss-bound-locks-out-leads (IPv6): twenty-odd devices of one mobile carrier's /48 miss five codes each; a lead in the same /48, on their own /64, is refused their live link on /open and /go",
    async () => {
      const live = room("K7Q2MX");
      const { w, handler } = world([live]);
      let i = 0;
      for (let d = 0; d < MISSES_PER_WIDE / 5; d++)
        for (let k = 0; k < 5; k++, i++) await handler(openReq(guess(20_000 + i), `2a03:6f00:1:${(d + 1).toString(16)}::5`, `nb6-${d}-${k}-dev`));
      w.now = NOW + 60_000;
      const open = await handler(openReq("K7Q2MX", "2a03:6f00:1:ffff::9", "lead-device-6"));
      const viaGo = await handler(goReq("K7Q2MX", "2a03:6f00:1:ffff::9"));
      await w.settle();
      expect({ open: open.status, go: viaGo.status }).toEqual({ open: 200, go: 302 });
    },
  );
});
