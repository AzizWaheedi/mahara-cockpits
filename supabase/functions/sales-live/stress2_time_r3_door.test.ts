// bun test supabase/functions/sales-live/stress2_time_r3_door.test.ts
//
// TIME stress, second series, round 3: a booked demo's short link after its
// room's own deadlines.
//
// room.wrap stores a booked call's own meeting (the closer's Zoom from
// HighLevel) as a room, open, with host_by = start + 15 min, lead_by = start
// + 20 min and ends_at = the appointment's end (roomlogic.ts wrapPlan). The
// panel offers "Copy link" on it (apps/sales-cockpit lib/rooms.ts
// momentActions: shortLink(room) whatever the purpose). The sweep closes the
// room at host_by when nobody pressed I'm in, or at lead_by when the lead has
// not joined (R3, R4). C14 (roomlogic.ts shortLinkTarget): "A booked room
// wraps the closer's own meeting, which we never end, so its link works
// until ends_at even after the room closed." The door that serves the link
// (door.ts roomIsOver) reads only the state.
//
// A test that fails here is a finding. No network: an in-memory PostgREST.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2-never-printed",
  IP_SALT: "salt-stress2-never-printed",
  CRON_SECRET: "cron-secret-stress2-never-printed",
};
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** Sunday 11 October 2026 in Kuwait (UTC+3). */
const kw = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const START = kw("15:00:00");

type Row = Record<string, any>;

function world(rooms: Row[], now: number) {
  const w = {
    now,
    rooms,
    people: [{ email: "closer@stress.invalid", name: "Cody Closer", name_ar: "كودي" }] as Row[],
    settings: [] as Row[],
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
    if (c.startsWith("gte.")) return r[col] != null && String(r[col]) >= c.slice(4);
    if (c.startsWith("gt.")) return r[col] != null && String(r[col]) > c.slice(3);
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
    if (table === "cockpit_sales_worker_status") return new Response(null, { status: 201 });
    if (table === "rpc/cockpit_sales_alert_set") return new Response(null, { status: 201 });
    if (table === "cockpit_sales_rooms" && method === "PATCH") {
      for (const r of pick(w.rooms, p)) Object.assign(r, body);
      return new Response(null, { status: 204 });
    }
    const source: Record<string, Row[]> = { cockpit_sales_rooms: w.rooms, cockpit_sales_people: w.people, cockpit_sales_settings: w.settings };
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

/** The closer's booked 15:00 demo (to 16:00), wrapped at 14:35, as the sweep left it. */
function bookedRoom(over: Row): Row {
  return {
    id: randomUUID(),
    code: "K7Q2MX",
    purpose: "booked",
    call_kind: "demo",
    state: "open",
    provider: "zoom",
    provider_meeting_id: "85023456789",
    join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
    host_email: "closer@stress.invalid",
    replaced_by: null,
    requested_at: iso(kw("14:35:00")),
    opened_at: iso(kw("14:35:00")),
    host_by: iso(START + 15 * 60_000),
    lead_by: iso(START + 20 * 60_000),
    ends_at: iso(START + 60 * 60_000),
    first_open_at: null,
    ...over,
  };
}

const openReq = (code: string) =>
  new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=lead-phone-1`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.7", origin: "https://call.maharamedia.com" },
  });
const goReq = (code: string) =>
  new Request(`${BASE}/functions/v1/sales-live/go/${code}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.7" },
  });

describe("15:22: the lead, 22 minutes late to the 15:00 demo (on to 16:00), taps the short link the closer copied to them", () => {
  // R4 closed the booked room at lead_by (15:20): the lead had not joined.
  const expired = { state: "expired", result: "no_join", end_reason: "lead_no_show", ended_at: iso(kw("15:20:30")) };

  test("the page opens the closer's meeting (C14: a booked room's link works until ends_at)", async () => {
    const { w, handler } = world([bookedRoom(expired)], kw("15:22:00"));
    const res = await handler(openReq("K7Q2MX"));
    const body = (await res.json()) as Row;
    await w.settle();
    // Found: {"state":"ended"}: the lead reads "This call has ended. Reply
    // to our last message and we will find a new time." while the demo is
    // booked to 16:00 and the closer is in their own Zoom meeting.
    expect(body.state).toBe("open");
    expect(String(body.join_url ?? "")).toContain("zoom.us/j/85023456789");
  });

  test("the no-script link (/go) sends the lead to the meeting, not to the ended page", async () => {
    const { w, handler } = world([bookedRoom(expired)], kw("15:22:00"));
    const res = await handler(goReq("K7Q2MX"));
    await w.settle();
    expect(String(res.headers.get("location") ?? "")).not.toContain("/ended");
  });

  test("15:16, the closer forgot to press I'm in (R3 closed it at host_by 15:15): the lead on time-ish still gets the meeting", async () => {
    const { w, handler } = world(
      [bookedRoom({ state: "expired", result: "no_join", end_reason: "host_not_in", ended_at: iso(kw("15:15:30")) })],
      kw("15:16:00"),
    );
    const body = (await (await handler(openReq("K7Q2MX"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("open");
  });

  test("control: at 16:01, past the appointment's end, the page says the call has ended", async () => {
    const { w, handler } = world([bookedRoom(expired)], kw("16:01:00"));
    const body = (await (await handler(openReq("K7Q2MX"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("ended");
  });
});
