// bun test supabase/functions/sales-live/stress_security_r3_door.test.ts
//
// Security and abuse stress of the public door (sales-live), round 3,
// 3 October 2026: whether another site's page can make a visitor's browser
// count an open of a room (the "Opened" step on the rep's room line, and the
// open grace that keeps a room open). Each `test` held when written; each
// `test.failing` pins a confirmed finding (its key is in its name) and turns
// red the day the fix lands. No network: an in-memory PostgREST and a fake
// sales-api; every URL the door asked for is kept.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";
import { redact } from "./util.ts";
import { redact as apiRedact } from "../sales-api/lib.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress-never-printed",
  IP_SALT: "salt-stress-never-printed",
  CRON_SECRET: "cron-secret-stress-never-printed",
};
const NOW = Date.UTC(2026, 9, 3, 11, 0, 0);
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

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
    last_open_at: null,
    ...over,
  };
}

function world(rooms: Row[] = [room()]) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "stress-host@stress.invalid", name: "Stress Host", name_ar: "ستريس" }] as Row[],
    events: [] as Row[],
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

function req(path: string, headers: Record<string, string>): Request {
  return new Request(`https://proj.supabase.co/functions/v1/sales-live${path}`, {
    headers: { "user-agent": CHROME_ANDROID, "x-forwarded-for": "198.51.100.7", ...headers },
  });
}

// What a browser sends (Fetch Metadata) for the call page's own read, and
// for an <img src> or fetch(…, {mode: "no-cors"}) on another site's page.
// A no-cors GET carries no Origin header at all (Fetch standard, "append a
// request Origin header": only CORS requests and non-GET methods get one).
const PAGE_OWN = {
  origin: "https://call.maharamedia.com",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};
const OTHER_SITE_IMG = {
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-dest": "image",
  referer: "https://evil.stress.invalid/",
};

describe("security r3: who can count an open", () => {
  test("the call page's own read counts the open (the fixture works)", async () => {
    const { w, handler } = world();
    const res = await handler(req("/open/K7Q2MX?d=device-stress-0001", PAGE_OWN));
    await w.settle();
    expect(res.status).toBe(200);
    expect(w.events.filter(e => e.kind === "door.open")).toHaveLength(1);
    expect(w.rooms[0].first_open_at).toBeTruthy();
  });

  test.failing("open-counted-from-any-site: an <img> on another site's page (no Origin, no-cors) counts an open and stamps the room's first open", async () => {
    // allowedOrigin keeps another site's page from READING /open, and its
    // comment says why: "a page there could make a visitor's browser count an
    // open". But the door only refuses a request whose Origin it does not
    // know; a no-cors GET (an image, a script tag, fetch with mode no-cors)
    // has no Origin, so it passes, is answered (unreadable to that page) and
    // recorded with the visitor's own address and agent: a door.open on the
    // room's timeline, "Opened" on the rep's room line, first_open_at, and
    // last_open_at, which the sweep's open grace reads to keep the room open.
    // Anyone the link was forwarded to, or any page the code is pasted into,
    // can do it for every visitor of that page.
    const { w, handler } = world();
    await handler(req("/open/K7Q2MX?d=device-stress-0002", OTHER_SITE_IMG));
    await w.settle();
    expect(w.events.filter(e => e.kind === "door.open")).toHaveLength(0);
    expect(w.rooms[0].first_open_at ?? null).toBeNull();
  });
});

describe("security r3: the door's own redaction", () => {
  test.failing("door-redact-misses-zak: the door's redact (its logs, status rows and the alerts the watchdog posts) strips a Zoom host token as sales-api's does", () => {
    // util.ts says its redact follows "the same rules as sales-api's lib.ts
    // redact", but lib.ts gained zak= (contract-v2 section 9) and util.ts
    // did not. Every door log line, every sales-live status row (read into
    // #sales-alerts by the watchdog's failing: alerts) and every config alert
    // goes through util.ts redact, so the day any of them carries a start
    // link (an upstream error that echoes a row, a refused join link), the
    // host's token is written out whole.
    const line = "sales-api refused room.event (500): https://us06web.zoom.us/s/85023456789?zak=eyJ0eXAiOiJKV1Qi.stresshost";
    expect(apiRedact(line)).not.toContain("stresshost");
    expect(redact(line)).not.toContain("stresshost");
  });
});
