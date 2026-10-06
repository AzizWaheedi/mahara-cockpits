// bun test supabase/functions/sales-live/stress2_security_r3_door.test.ts
//
// Second series, round 3 (4 October 2026): security and abuse of the public
// door (sales-live) as it stands after fix round 2. Each `test` held when
// written; the tests named for a finding (its key in the name) were
// test.failing until fix round 3 landed, and are regression tests now. No network: an in-memory PostgREST
// and a fake sales-api. Synthetic rows only (stress- names, .invalid hosts).

import { describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { limitNet, RateLimiter } from "./door.ts";
import { makeHandler, MISS_CEILING } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2r3-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2r3-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2r3-never-printed",
  IP_SALT: "salt-stress2r3-never-printed",
  CRON_SECRET: "cron-secret-stress2r3-never-printed",
};
const NOW = Date.UTC(2026, 9, 4, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** What a script sends to pass as the call page: any Origin header it likes. */
const PAGE = "https://call.maharamedia.com";

type Row = Record<string, any>;

/** Six letters of the code alphabet for guess i. */
function guess(i: number): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  let n = i + 3_000_000;
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
    provider_meeting_id: String(85_000_000_000 + Math.floor(Math.random() * 1e9)),
    join_url: `https://us06web.zoom.us/j/8502345${Math.floor(Math.random() * 1e4)}?pwd=stress`,
    host_email: "stress2r3-host@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    requested_at: new Date(NOW - 2 * 60_000).toISOString(),
    first_open_at: null,
    ...over,
  };
}

function world(rooms: Row[]) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "stress2r3-host@stress.invalid", name: "Stress Host", name_ar: "ستريس" }] as Row[],
    // The short link in use (rooms on, short_link on): with it off the door follows no code and records no open (m1 round 5).
    settings: [{ key: "rooms", value: { enabled: true, short_link: true } }] as Row[],
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
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip },
  });
}

/** The i-th /64 of one attacker's /48 (2001:db8:abcd::/48), one address in it. */
const inOne48 = (i: number) => `2001:db8:abcd:${i.toString(16)}::1`;

// ---------------------------------------------------------------------------

describe("stress2 security r3: guessing call codes from one IPv6 allocation", () => {
  test("one /64 is held to 120 lookups a minute (the fixture works)", async () => {
    const { w, handler } = world([room("K7Q2MX")]);
    let refused = 0;
    for (let i = 0; i < 300; i++) if ((await handler(openReq(guess(i), inOne48(1), `g-${i}-dev`))).status === 429) refused++;
    await w.settle();
    // Fix round 3: past MISSES_PER_NET misses the /64 is refused outright,
    // so far fewer than 120 of its guesses are ever read.
    expect(refused).toBeGreaterThanOrEqual(180);
    // Every /64 of a /48 is its own network to the door.
    expect(limitNet(inOne48(1))).not.toBe(limitNet(inOne48(2)));
  });

  test(
    "code-guess-oracle-per-64: one attacker with one /56 (256 /64s; a /48 is free from a tunnel broker) guesses 30,720 codes a minute per instance, and every live room whose code it reaches is handed over with its join link and the lead's open recorded, though that /56 has just missed tens of thousands of codes",
    async () => {
      // The door limits a network (an IPv6 /64) to 120 lookups a minute and
      // the instance to 600 misses a minute. Past that ceiling an unknown
      // code is answered 429 unread, but a code of any room asked for in the
      // last day is still read and answered 200 with its join_url: the
      // ceiling turns the door into a free oracle (429 = no room, 200 = a
      // room) at no database cost, and nothing counts a prefix's misses.
      // 1.07 billion codes / ~10 rooms live at once = ~1e8 guesses per hit:
      // with a /48 (65,536 /64s x 120 = 7.8 million guesses a minute per
      // instance) about 14 minutes, faster with more instances.
      const hits = [4_000, 9_000, 15_000, 22_000, 30_000];
      const rooms = hits.map(i => room(guess(i)));
      const { w, handler } = world(rooms);
      let i = 0;
      const found: Row[] = [];
      for (let net = 0; net < 256; net++) {
        for (let k = 0; k < 120; k++, i++) {
          // A fresh device id each request (the page's own `d`, any 8 to 64 letters).
          const res = await handler(openReq(guess(i), inOne48(net + 16), `g-${i}-device`, PAGE));
          if (res.status === 200) found.push(await res.json());
        }
      }
      await w.settle();
      const opened = rooms.filter(r => r.first_open_at !== null);
      // What should hold: a prefix that has missed thousands of codes in a
      // minute (a lead mistypes once or twice) is told nothing about any
      // room, and its requests never count as the lead opening the link.
      expect({
        guessed: i,
        join_links_handed_over: found.filter(v => typeof v.join_url === "string").length,
        rooms_marked_opened: opened.length,
      }).toEqual({ guessed: 30_720, join_links_handed_over: 0, rooms_marked_opened: 0 });
    },
  );

  test(
    "code-guess-oracle-per-64 (/go): the no-script route answers the same oracle (302 to the meeting for a live code, a redirect home for any other), and past the ceiling a live code still redirects to its join link for a /56 that has missed every other guess",
    async () => {
      // /go has no device id, so each /64 gets 30 lookups a minute there:
      // 7,680 a minute for the /56. The live code is the 6th guess of the
      // 251st network, after 30,005 guesses in all.
      const target = room(guess(250 * 120 + 5));
      const { w, handler } = world([target]);
      let i = 0;
      let joined = 0;
      for (let net = 0; net < 256; net++) {
        for (let k = 0; k < 120; k++, i++) {
          const res = await handler(goReq(guess(i), inOne48(net + 16)));
          const to = res.headers.get("location") ?? "";
          if (res.status === 302 && to.startsWith("https://us06web.zoom.us/")) joined++;
        }
      }
      await w.settle();
      expect({ guessed: i, redirected_to_meeting: joined }).toEqual({
        guessed: 30_720,
        redirected_to_meeting: 0,
      });
    },
  );

  test("a lead who mistypes a few times, then opens the right code, is answered (any fix must keep this)", async () => {
    const lead = room("K7Q2MX");
    const { w, handler } = world([lead]);
    for (let k = 0; k < 3; k++) expect((await handler(openReq(guess(k), "198.51.100.23", "lead-dev-1", PAGE))).status).toBe(404);
    const res = await handler(openReq("K7Q2MX", "198.51.100.23", "lead-dev-1", PAGE));
    expect(res.status).toBe(200);
    expect((await res.json()).join_url).toBe(lead.join_url);
    await w.settle();
    expect(lead.first_open_at).not.toBeNull();
    // The ceiling is the instance's, not the lead's.
    expect(MISS_CEILING).toBe(600);
  });
});

// ---------------------------------------------------------------------------

const hmac = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("hex");

/** A correctly signed Zoom event, as Zoom itself would post it. */
function zoomReq(event: string, meetingId: string, participant: Row, ts: string): Request {
  const body = JSON.stringify({
    event,
    event_ts: Number(ts) * 1000,
    payload: {
      account_id: "acct-stress",
      object: { id: meetingId, uuid: "inst-stress==", host_id: "zoom-host-stress", topic: "Mahara call K7Q2MX", participant },
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

describe("stress2 security r3: one person in a room's meeting, over and over", () => {
  test(
    "zoom-rejoin-flood-unbounded: whoever holds a room's join link (the lead, or anyone it was forwarded to) knocks on the waiting room 300 times in ten minutes; every knock is a new stored row on the room's timeline and a new sales-api call, so the panel's last 20 lines are all knocks and the link and open lines are gone",
    async () => {
      // The door caps a room's open rows (12 in 10 minutes per instance:
      // door-open-rows-unbounded), but a Zoom event has no cap: each knock
      // or join has its own date_time, so its own dedupe key, a row on the
      // timeline every seat reads (text "Zoom: <name> is in the waiting
      // room."), a forward to sales-api (an Edge Function call, and a room
      // read, a staff read and a write there), and nothing bounds them.
      const r = room("K7Q2MX", { provider_meeting_id: "85023456789" });
      const { w, handler } = world([r]);
      let forwards = 0;
      const t0 = Math.floor(NOW / 1000);
      for (let k = 0; k < 300; k++) {
        const at = new Date(NOW + k * 2_000).toISOString().replace(".000", "");
        const res = await handler(
          zoomReq(
            "meeting.participant_joined_waiting_room",
            "85023456789",
            { user_name: "Stress Knocker", participant_uuid: "pu-knocker", id: "", date_time: at },
            String(t0 + k * 2),
          ),
        );
        if (res.status === 200 && ((await res.json()) as Row).stored === "new") forwards++;
      }
      await w.settle();
      const rows = w.events.filter(e => e.room_id === r.id && String(e.kind).startsWith("zoom."));
      // At most what the door allows one room's opens: a dozen in ten
      // minutes (fix round 3: the first knock, then one a minute).
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.length).toBeLessThanOrEqual(12);
      expect(forwards).toBe(rows.length);
    },
  );
});
