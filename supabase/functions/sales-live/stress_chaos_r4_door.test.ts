// bun test supabase/functions/sales-live/stress_chaos_r4_door.test.ts
//
// Chaos round 4 (3 October 2026), the door's side: what the room is left
// knowing when the database is slow at the moment the lead taps the link.
//
// The call page asks /open for the room. When that read fails (the database
// slow or down: /open answers 503, or the page's 6 s run out), the page shows
// its own fallback, "Join the call" (?go=1), which Vercel sends to
// sales-live/go/{code}, and /go redirects the lead to the meeting. /go stores
// nothing ("Nothing is stored here"). For a Meet room the lead's open of the
// short link is the only sign from the lead that the room ever gets (Meet
// sends no join signal), and the settle reads "the short link went and was
// never opened" as evidence that nobody came (roomlogic noShowDoubt, the
// sweep's S1): the intro is marked a no-show in HighLevel, a hard number in
// B2B's show rate, for a lead who came through the page's own fallback.
//
// No network: an in-memory PostgREST and a fake sales-api.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-chaos-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-chaos-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-chaos-never-printed",
  IP_SALT: "salt-chaos-never-printed",
  CRON_SECRET: "cron-secret-chaos-never-printed",
};
const NOW = Date.UTC(2026, 9, 3, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type Row = Record<string, any>;

function meetRoom(over: Row = {}): Row {
  return {
    id: randomUUID(),
    code: "K7Q2MX",
    state: "open",
    provider: "meet",
    provider_meeting_id: "abc-defg-hij",
    join_url: "https://meet.google.com/abc-defg-hij",
    host_email: "chaos-r4-host@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    last_open_at: null,
    ...over,
  };
}

function world(rooms: Row[] = [meetRoom()]) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "chaos-r4-host@stress.invalid", name: "Chaos Host", name_ar: "كايوس" }] as Row[],
    events: [] as Row[],
    pending: [] as Promise<unknown>[],
    /** The room read fails (a slow database: statement timeout). */
    roomReadDown: false,
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
    if (table === "cockpit_sales_rooms" && method === "GET" && w.roomReadDown)
      return new Response('{"message":"canceling statement due to statement timeout"}', { status: 503 });
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

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://proj.supabase.co/functions/v1/sales-live${path}`, {
    headers: { "user-agent": IPHONE, "x-forwarded-for": "198.51.100.7", ...headers },
  });
}

describe("chaos r4: the page's own fallback when /open fails", () => {
  test("HELD: the call page's /open fails while the database is slow: the page is told to show its fallback (state error)", async () => {
    const { w, handler } = world();
    w.roomReadDown = true;
    const res = await handler(req("/open/K7Q2MX?d=device-chaos-0001", { origin: "https://call.maharamedia.com" }));
    expect(res.status).toBe(503);
    expect((await res.json()).state).toBe("error");
  });

  test("the lead then taps the fallback's Join the call (/go): they reach the Meet room, and the room must know the lead opened its link", async () => {
    const { w, handler } = world();
    // A moment later the database answers again; /go reads the room and redirects.
    const res = await handler(req("/go/K7Q2MX"));
    await w.settle();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://meet.google.com/abc-defg-hij");
    // Today /go stores nothing: no door.open, no first_open_at. The room
    // reads "short link never opened", and the settle takes that as evidence
    // the lead stayed away (a Meet room has no other sign from the lead).
    const opened = w.events.some(e => e.kind === "door.open") || Boolean(w.rooms[0].first_open_at);
    expect(opened).toBe(true);
  });
});
