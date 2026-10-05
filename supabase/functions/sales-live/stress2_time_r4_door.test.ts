// bun test supabase/functions/sales-live/stress2_time_r4_door.test.ts
//
// TIME stress, second series, round 4: a lead who drops out of a call that
// ran past its planned end, and taps the link again.
//
// A room with the lead in it is closed "in the books" by the sweep's R7 at
// ends_at + no_end_signal (30 min): state ended, result joined, end_reason
// no_end_signal. That is no end of the call: Zoom has said nothing (the
// meeting is still running), and the room worker never closes the meeting of
// a room the lead reached (hermes/sales-desk/desk/rooms.py _scan_finals:
// "Never a room a lead reached"). The door (door.ts roomIsOver) reads only
// the final state, and its own comment promises "a long demo past ends_at
// still opens for a lead who reopens the link".
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

const openReq = (code: string) =>
  new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=lead-phone-1`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.7", origin: "https://call.maharamedia.com" },
  });
const goReq = (code: string) =>
  new Request(`${BASE}/functions/v1/sales-live/go/${code}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.7" },
  });


/** A Zoom room the lead joined, as R7 left it: closed in the books with no end signal from Zoom. */
function overrunRoom(over: Row): Row {
  return {
    id: randomUUID(),
    code: "K7Q2MX",
    purpose: "manual",
    call_kind: "demo",
    state: "ended",
    result: "joined",
    end_reason: "no_end_signal",
    provider: "zoom",
    provider_meeting_id: "85023456789",
    join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
    host_email: "closer@stress.invalid",
    replaced_by: null,
    requested_at: iso(kw("14:58:00")),
    opened_at: iso(kw("14:58:10")),
    host_in_at: iso(kw("14:59:00")),
    lead_in_at: iso(kw("15:01:00")),
    // lengths_min.demo (60) from the open; R7 closed it 30 minutes after.
    ends_at: iso(kw("15:58:10")),
    ended_at: iso(kw("16:29:00")),
    first_open_at: iso(kw("15:00:40")),
    ...over,
  };
}

describe("Sunday 16:31: the closer's demo on video (a lead-page room, the lead in since 15:01) is still going; R7 closed the room at 16:29", () => {
  test("the lead's phone drops the call and they tap the link again: the page opens the meeting, never 'This call has ended'", async () => {
    const { w, handler } = world([overrunRoom({})], kw("16:31:00"));
    const body = (await (await handler(openReq("K7Q2MX"))).json()) as Row;
    await w.settle();
    // Found {"state":"ended"}: the lead reads that the call has ended while
    // the closer waits for them in the live Zoom meeting the worker kept open.
    expect(body.state).toBe("open");
    expect(String(body.join_url ?? "")).toContain("zoom.us/j/85023456789");
  });

  test("the no-script link (/go) sends the lead back to the meeting, not to the ended page", async () => {
    const { w, handler } = world([overrunRoom({})], kw("16:31:00"));
    const res = await handler(goReq("K7Q2MX"));
    await w.settle();
    expect(String(res.headers.get("location") ?? "")).not.toContain("/ended");
  });

  test("the same for a booked demo (15:00 to 16:00) that ran on: R7 closed its room at 16:30, the lead taps the link at 16:35", async () => {
    const booked = overrunRoom({
      purpose: "booked",
      requested_at: iso(kw("14:35:00")),
      opened_at: iso(kw("14:35:00")),
      ends_at: iso(kw("16:00:00")),
      ended_at: iso(kw("16:30:30")),
    });
    const { w, handler } = world([booked], kw("16:35:00"));
    const body = (await (await handler(openReq("K7Q2MX"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("open");
  });

  test("control: a room ended by the rep (finished) says the call has ended", async () => {
    const { w, handler } = world([overrunRoom({ end_reason: "finished" })], kw("16:31:00"));
    const body = (await (await handler(openReq("K7Q2MX"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("ended");
  });
});

describe("Sunday 10:13: the lead taps the link of the setter's 10:00 room, closed at 10:10, while the 10:12 retry room waits for them", () => {
  // The setter's 10:00 intro call rang out; room A's link went at 10:00 and
  // nobody came (R4 closed it at 10:10). The setter rang again at 10:12 and
  // sent room B's link. The lead, back at their phone, taps the first link
  // in the chat (or the one in the evening-before confirmation message).
  const LEAD = "stress-t2r4-two-links";
  const roomA = {
    id: randomUUID(),
    code: "A7Q2MX",
    contact_id: LEAD,
    purpose: "fallback",
    call_kind: "intro",
    state: "expired",
    result: "no_join",
    end_reason: "lead_no_show",
    provider: "zoom",
    provider_meeting_id: "85011111111",
    join_url: "https://us06web.zoom.us/j/85011111111?pwd=a",
    host_email: "closer@stress.invalid",
    replaced_by: null,
    requested_at: iso(kw("10:00:00")),
    opened_at: iso(kw("10:00:10")),
    ends_at: iso(kw("10:30:10")),
    ended_at: iso(kw("10:10:00")),
    first_open_at: null,
  };
  const roomB = {
    ...roomA,
    id: randomUUID(),
    code: "B7Q2MX",
    state: "host_in",
    result: null,
    end_reason: null,
    provider_meeting_id: "85022222222",
    join_url: "https://us06web.zoom.us/j/85022222222?pwd=b",
    requested_at: iso(kw("10:12:00")),
    opened_at: iso(kw("10:12:10")),
    ends_at: iso(kw("10:42:10")),
    ended_at: null,
  };

  test("the old link takes the lead to the room that is waiting for them, never 'This call has ended'", async () => {
    const { w, handler } = world([roomA, roomB], kw("10:13:00"));
    const body = (await (await handler(openReq("A7Q2MX"))).json()) as Row;
    await w.settle();
    // Found {"state":"ended"}: the lead reads that the call has ended while
    // the setter waits for them in room B; replaced_by is set for handovers only.
    expect(body.state).toBe("open");
    expect(String(body.join_url ?? "")).toContain("85022222222");
  });

  test("control: B's own link opens B", async () => {
    const { w, handler } = world([roomA, roomB], kw("10:13:00"));
    const body = (await (await handler(openReq("B7Q2MX"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("open");
  });
});
