// bun test supabase/functions/sales-live/stress_security_r2_door.test.ts
//
// Security and abuse stress of the public door (sales-live), round 2,
// 3 October 2026: what the door keeps of a Zoom meeting that is no room
// when its one lookup fails, which room a Zoom event is pinned to when its
// topic and its meeting id disagree, and whether a code's own limit can be
// used to lock the lead out of their room. Each `test` held when written;
// each `test.failing` pins a confirmed finding (its key is in its name) and
// turns red the day the fix lands. No network: an in-memory PostgREST and a
// fake sales-api; every URL the door asked for is kept.

import { describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

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

/** The door against fakes. `lookup` decides how the Zoom room lookup answers. */
function world(rooms: Row[] = [room()], o: { lookup?: "ok" | "503" | "hang" } = {}) {
  const w = {
    now: NOW,
    rooms,
    people: [{ email: "stress-host@stress.invalid", name: "Stress Host", name_ar: "ستريس" }] as Row[],
    settings: [] as Row[],
    events: [] as Row[],
    forwards: [] as Row[],
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
    if (url.origin !== BASE) throw new TypeError(`the door called an outside host: ${url.origin}`);
    if (url.pathname === "/functions/v1/sales-api") {
      w.forwards.push(body);
      return Response.json({ ok: true });
    }
    const table = url.pathname.replace("/rest/v1/", "");
    const p = url.searchParams;
    if (table === "cockpit_sales_rooms" && method === "GET" && p.has("or")) {
      if (o.lookup === "503") return new Response("upstream timeout", { status: 503 });
      if (o.lookup === "hang")
        return await new Promise<Response>((_, reject) => {
          const sig = init.signal;
          sig?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
    }
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
    log: line => w.logs.push(line),
    budget: { zoomFind: 50 },
  });
  return { w, handler };
}

const hmac = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");

function zoomEvent(event: string, object: Row): string {
  return JSON.stringify({ event, event_ts: 1759489330123, payload: { account_id: "acc-1", object } });
}

function zoomReq(body: string): Request {
  const ts = "1759489330";
  return new Request(`${BASE}/functions/v1/sales-live/zoom`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": `v0=${hmac(SECRETS.ZOOM_WEBHOOK_SECRET, `v0:${ts}:${body}`)}` },
    body,
  });
}

/** A webinar attendee joining a meeting on the same Zoom account that is no cockpit room. */
const WEBINAR_JOIN = zoomEvent("meeting.participant_joined", {
  id: 99887766554,
  uuid: "web-1==",
  host_id: "ceo-zoom",
  topic: "Mahara weekly webinar",
  participant: { user_id: "33", user_name: "Attendee Person", participant_uuid: "pu-9", email: "stress-attendee@stress.invalid", join_time: "2026-10-03T11:02:10Z" },
});

function openReq(code: string, ip: string, device: string): Request {
  return new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=${device}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip },
  });
}

// ---------------------------------------------------------------- Zoom

describe("security r2: what the door keeps of a Zoom meeting that is no room", () => {
  test("with the room lookup working, a webinar attendee's join is answered and kept nowhere", async () => {
    const { w, handler } = world();
    const res = await handler(zoomReq(WEBINAR_JOIN));
    await w.settle();
    expect(res.status).toBe(200);
    expect(w.events).toHaveLength(0);
    expect(JSON.stringify(w.forwards)).not.toContain("stress-attendee");
  });

  for (const lookup of ["503", "hang"] as const) {
    test(`zoom-foreign-meeting-attendees-kept (${lookup === "503" ? "the lookup answers 503" : "the lookup runs past its time"}): the attendee's name and email are stored in a table every seat can read`, async () => {
      // handler.ts zoomRoute: when the one room lookup fails or runs out of
      // its 500 ms, the event is stored with room_id null "because it may be
      // a lead joining", whatever the meeting. Its topic carries no room
      // code, so it cannot be a room the worker made; yet the attendee's
      // name, email and Zoom ids land in cockpit_sales_room_events (RLS:
      // every seat reads it), and sales-api's no_room path keeps them. A
      // slow minute during the webinar keeps every attendee who joined in it.
      const { w, handler } = world([room()], { lookup });
      const res = await handler(zoomReq(WEBINAR_JOIN));
      await w.settle();
      expect(res.status).toBeLessThan(500);
      expect(JSON.stringify(w.events)).not.toContain("stress-attendee@stress.invalid");
      expect(JSON.stringify(w.events)).not.toContain("Attendee Person");
    });
  }

  test("with the lookup failing, a join whose topic carries a room code is still kept for sales-api (a lead may be joining)", async () => {
    const { w, handler } = world([room()], { lookup: "503" });
    const body = zoomEvent("meeting.participant_joined", {
      id: 85023456789,
      uuid: "inst-1==",
      host_id: "host-1",
      topic: "Mahara call K7Q2MX",
      participant: { user_id: "16778240", user_name: "Lead Person", participant_uuid: "pu-1", join_time: "2026-10-03T11:02:10Z" },
    });
    const res = await handler(zoomReq(body));
    await w.settle();
    expect(res.status).toBe(200);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]!.room_id).toBeNull();
  });
});

describe("security r2: which room a Zoom event is pinned to", () => {
  test.failing("zoom-topic-code-beats-meeting-id: any meeting on the Zoom account titled with a room's code drives that room, though its meeting id is another", async () => {
    // pickZoomRoom lets the topic's code decide first, even when the room
    // already has its own provider_meeting_id and the event is from another
    // meeting. Anyone with a user on Mahara's Zoom account (every rep, the
    // basic seats) can name a meeting "Mahara call K7Q2MX" and start, join
    // and end it: the door pins those events to another rep's room, and
    // sales-api moves it (host_in, lead_in, which the count reads, or a
    // meeting_ended that closes the room while the real call runs). The code
    // should decide only while the room has no meeting id yet.
    const { w, handler } = world([room()]);
    const forged = zoomEvent("meeting.ended", {
      id: 11122233344,
      uuid: "other-meeting==",
      host_id: "someone-else",
      topic: "Mahara call K7Q2MX",
    });
    await handler(zoomReq(forged));
    await w.settle();
    const pinned = w.events.filter(e => e.room_id === w.rooms[0]!.id);
    expect(pinned).toHaveLength(0);
  });

  test("an event from the room's own meeting is pinned to the room", async () => {
    const { w, handler } = world([room()]);
    await handler(zoomReq(zoomEvent("meeting.started", { id: 85023456789, uuid: "inst-1==", host_id: "host-1", topic: "Mahara call K7Q2MX" })));
    await w.settle();
    expect(w.events.map(e => e.room_id)).toEqual([w.rooms[0]!.id]);
  });
});

// ---------------------------------------------------------------- /open

describe("security r2: one code's own limit", () => {
  test.failing("code-limiter-locks-out-the-lead: two addresses that know the code use up its 150 opens a minute, and the lead's own first open is refused", async () => {
    // handler.ts openRoute checks perCode (150 a minute per code, every
    // address together) after the per-address limits. Two addresses, 75
    // opens each with a fresh device id every time, stay inside their own
    // limits (120 a minute, 30 per device) and spend the code's 150. The
    // lead, on another network with a new device, then gets 429 "Too many
    // tries from this network" for the rest of the minute, and the page's
    // busy state offers only Try again (no "Join the call" through ?go=1,
    // which /go would still open: it has no per-code limit). Repeated every
    // minute, the lead never reaches their call.
    const { w, handler } = world([room()]);
    for (const ip of ["203.0.113.10", "203.0.113.11"])
      for (let i = 0; i < 75; i++) {
        const res = await handler(openReq("K7Q2MX", ip, `attacker-${ip}-${i}`));
        expect(res.status).toBe(200);
      }
    const lead = await handler(openReq("K7Q2MX", "198.51.100.99", "the-leads-own-phone"));
    await w.settle();
    expect(lead.status).toBe(200);
  });

  test("the no-script route still opens the room for the lead while the code's limit is spent (the fallback the busy page could offer)", async () => {
    const { w, handler } = world([room()]);
    for (const ip of ["203.0.113.10", "203.0.113.11"])
      for (let i = 0; i < 75; i++) await handler(openReq("K7Q2MX", ip, `attacker-${ip}-${i}`));
    const go = await handler(
      new Request(`${BASE}/functions/v1/sales-live/go/K7Q2MX`, { headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.99" } }),
    );
    await w.settle();
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://us06web.zoom.us/j/85023456789?pwd=abc");
  });

  test("guessing codes: an unknown code reads as unknown, with nothing about any room, and costs the guesser its own limit only", async () => {
    const { w, handler } = world([room()]);
    let refused = 0;
    for (let i = 0; i < 130; i++) {
      const code = `ABC${String(i).padStart(3, "2").replace(/[01]/g, "2")}`.slice(0, 6);
      const res = await handler(openReq(code, "203.0.113.50", `g-${i}-device`));
      if (res.status === 429) refused++;
      else {
        const body = await res.json();
        expect(Object.keys(body).sort()).toEqual(["code", "ok", "state"]);
        expect(body.state).toBe("unknown");
      }
    }
    await w.settle();
    expect(refused).toBe(10);
    // The lead's own room, from the lead's own network, is untouched by the guesser.
    expect((await handler(openReq("K7Q2MX", "198.51.100.99", "the-leads-own-phone"))).status).toBe(200);
  });
});
