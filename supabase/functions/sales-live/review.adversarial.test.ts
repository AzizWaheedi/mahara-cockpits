// bun test supabase/functions/sales-live/review.adversarial.test.ts
//
// Adversarial review of the lc-door lane (2026-10-03). Each test here was a
// `test.failing` that pinned a defect found in review; the fixes landed and
// they are plain `test`s now, kept as regression checks. No network.

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { deviceOf, isPreviewBot, RateLimiter } from "./door.ts";
import { BUDGET, makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const KEY = "service-key-value-never-printed";
const ZOOM_SECRET = "zoom-secret-value-never-printed";
const NOW = Date.UTC(2026, 9, 3, 11, 0, 0);
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

type Row = Record<string, any>;

/** A small PostgREST + sales-api stand-in: enough for the cases below. */
function world(rooms: Row[] = []) {
  const w = {
    now: NOW,
    rooms,
    events: [] as Row[],
    forwards: [] as Row[],
    pending: [] as Promise<unknown>[],
    async settle() {
      while (w.pending.length) await Promise.allSettled(w.pending.splice(0));
    },
    fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (url.pathname === "/functions/v1/sales-api") {
        w.forwards.push(body);
        return Response.json({ ok: true });
      }
      const table = url.pathname.replace("/rest/v1/", "");
      const method = init.method ?? "GET";
      if (table === "cockpit_sales_room_events" && method === "POST") {
        if (w.events.some(e => e.dedupe_key === body.dedupe_key)) return Response.json([], { status: 201 });
        w.events.push(body);
        return Response.json([{ dedupe_key: body.dedupe_key }], { status: 201 });
      }
      if (table === "cockpit_sales_worker_status") return new Response(null, { status: 201 });
      if (table === "cockpit_sales_rooms" && method === "GET") {
        const p = url.searchParams;
        const out = w.rooms.filter(r =>
          [...p].every(([k, v]) => ["select", "limit"].includes(k) || String(r[k]) === v.replace(/^eq\./, "")),
        );
        return Response.json(out);
      }
      if (table === "cockpit_sales_rooms" && method === "PATCH") return new Response(null, { status: 204 });
      if (method === "GET") return Response.json([]);
      return new Response("unexpected", { status: 400 });
    },
  };
  const handler = makeHandler({
    env: n =>
      ({
        SUPABASE_URL: BASE,
        SUPABASE_SERVICE_ROLE_KEY: KEY,
        ZOOM_WEBHOOK_SECRET: ZOOM_SECRET,
        IP_SALT: "salt",
        CRON_SECRET: "cron",
        SLACK_SIGNING_SECRET: "slack",
      })[n] ?? "",
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => w.fetch(input, init)) as typeof fetch,
    now: () => w.now,
    background: p => {
      w.pending.push(p);
    },
    limiter: new RateLimiter(30, 60_000),
    log: () => {},
  });
  return { w, handler };
}

function signedZoom(body: string): Request {
  const ts = "1759489200";
  const sig = `v0=${createHmac("sha256", ZOOM_SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;
  return new Request("http://localhost/sales-live/zoom", {
    method: "POST",
    headers: { "content-type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": sig },
    body,
  });
}

describe("review: Zoom events for meetings that are not rooms", () => {
  // The S2S app's subscription is account-wide: the webinar (a Zoom meeting,
  // hermes/webinar-pull/pull.py:401), the CEO's client calls and recruiting
  // interviews all send participant events here. room_events is readable by
  // every seat (20261003a: cockpit_sales_room_events_seat_read).
  const webinarJoin = JSON.stringify({
    event: "meeting.participant_joined",
    event_ts: 1759489200123,
    payload: {
      account_id: "acc-1",
      object: {
        id: "81234567890",
        uuid: "web-inst==",
        host_id: "ceo-zoom-id",
        topic: "Mahara webinar: scale your agency",
        participant: {
          user_id: "33554432",
          participant_uuid: "pu-web-1",
          user_name: "A Client Of Ours",
          email: "client@example.com",
          join_time: "2026-10-03T11:00:00Z",
        },
      },
    },
  });

  test("an attendee of a non-room meeting is not stored with their name and email", async () => {
    const { w, handler } = world([]);
    const res = await handler(signedZoom(webinarJoin));
    await w.settle();
    expect(res.status).toBe(200);
    const leaked = w.events.filter(e => JSON.stringify(e.detail ?? {}).includes("client@example.com"));
    expect(leaked.length).toBe(0);
  });

  test("a non-room meeting's event is not passed to sales-api (no replay, no watchdog noise)", async () => {
    const { w, handler } = world([]);
    await handler(signedZoom(webinarJoin));
    await w.settle();
    expect(w.forwards.length).toBe(0);
  });
});

describe("review: timing budgets against the other lanes", () => {
  test("the door's own forward (2 tries) is over before the sweep replays the event (event_replay 20 s)", () => {
    const EVENT_REPLAY_MS = 20_000; // rooms.waits_s.event_replay
    const doorWindow = 2 * BUDGET.forwardZoom + 400; // handler.ts salesApi: tries 2, sleep 400 * attempt
    expect(doorWindow).toBeLessThan(EVENT_REPLAY_MS);
  });

  test("the cron door answers inside pg_net's timeout in mahara-sales-rooms-sweep (10 s)", async () => {
    // Fixed by answering 202 at once and forwarding in the background, so
    // the replay may take as long as it needs; its outcome goes to the
    // status row. Here sales-api never answers at all.
    const PG_NET_TIMEOUT_MS = 10_000; // 20261003a_sales_rooms.sql: timeout_milliseconds := 10000
    const { w, handler } = world([]);
    const real = w.fetch;
    w.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname === "/functions/v1/sales-api" ? new Promise<Response>(() => {}) : real(input, init);
    const started = performance.now();
    const res = await handler(
      new Request("http://localhost/sales-live/cron", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": "cron" },
        body: JSON.stringify({
          action: "room.event",
          kind: "sweep.replay",
          payload: { event_ids: ["0b6f2d1e-4c3a-4f7e-9a51-2d8c6b0e7f11"] },
        }),
      }),
    );
    expect(res.status).toBe(202);
    expect(performance.now() - started).toBeLessThan(Math.min(PG_NET_TIMEOUT_MS, 1000));
    expect(BUDGET.forwardCron).toBeGreaterThan(0);
  });
});

describe("review: the page's own polling against the door's limit", () => {
  // call.js polls /open every retry_ms (2000) while the room is "preparing",
  // for up to PREPARING_FOR_MS (90 s). One tab alone sits exactly on the
  // limit (30 in the first 58 s), so a second tab (the WhatsApp in-app
  // browser plus Safari) or a second phone on the same Wi-Fi goes over it.
  test("one tab polling a preparing room stays exactly inside 30 a minute", async () => {
    const { w, handler } = world([
      { id: "room-2", code: "K7Q2MX", state: "creating", provider: "zoom", join_url: null, host_email: "closer@maharamedia.com", replaced_by: null, ends_at: null, first_open_at: null },
    ]);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      w.now = NOW + i * 2000;
      const res = await handler(
        new Request("http://localhost/sales-live/open/K7Q2MX?d=device-abc-123", {
          headers: { "user-agent": IPHONE, "x-forwarded-for": "198.51.100.7", origin: "https://call.maharamedia.com" },
        }),
      );
      statuses.push(res.status);
      await w.settle();
    }
    expect(statuses.filter(s => s === 429).length).toBe(0);
  });

  test("two tabs of one lead polling a preparing room are never told 'Too many tries'", async () => {
    const { w, handler } = world([
      { id: "room-2", code: "K7Q2MX", state: "creating", provider: "zoom", join_url: null, host_email: "closer@maharamedia.com", replaced_by: null, ends_at: null, first_open_at: null },
    ]);
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) {
      for (const d of ["tab-in-app-111", "tab-safari-222"]) {
        w.now = NOW + i * 2000;
        const res = await handler(
          new Request(`http://localhost/sales-live/open/K7Q2MX?d=${d}`, {
            headers: { "user-agent": IPHONE, "x-forwarded-for": "198.51.100.7", origin: "https://call.maharamedia.com" },
          }),
        );
        statuses.push(res.status);
        await w.settle();
      }
    }
    expect(statuses.filter(s => s === 429).length).toBe(0);
  });
});

describe("review: names shared with the other lanes", () => {
  test("a computer's open uses the room logic's device name (DEVICES = phone, tablet, computer)", () => {
    const LOGIC_DEVICES = ["phone", "tablet", "computer"]; // lc-logic roomlogic.ts DEVICES
    expect(LOGIC_DEVICES).toContain(deviceOf(MAC));
  });

  test("a person's browser whose agent merely contains 'WhatsApp/' is not a preview", () => {
    // roomlogic.ts anchors this rule (^whatsapp\/); door.ts matches it anywhere.
    expect(isPreviewBot("Mozilla/5.0 (Linux; Android 13; SM-A536B) Chrome/120 Mobile Safari/537.36 WhatsApp/2.24")).toBe(false);
  });
});

describe("review: the cron door's allow-list", () => {
  // Glossary C9: sales-live forwards "thread.tick and room.event replays".
  // A CRON_SECRET holder (vault, sales-mirror, sales-api, sales-live) can
  // otherwise post a Zoom join with no Zoom signature, and room.event would
  // set lead_in and, with count_on_join, book and mark it shown.
  test("a room.event that is not a sweep replay is refused before sales-api", async () => {
    const { w, handler } = world([]);
    const res = await handler(
      new Request("http://localhost/sales-live/cron", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": "cron" },
        body: JSON.stringify({
          action: "room.event",
          kind: "zoom.meeting.participant_joined",
          room_id: "room-1",
          payload: { event: "meeting.participant_joined", payload: { object: { id: "1", participant: { user_name: "Forged" } } } },
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(w.forwards.length).toBe(0);
  });
});

describe("review: links as leads really receive them", () => {
  // An Arabic message often leaves a right-to-left mark (U+200F) or an Arabic
  // comma right after the link; English email text leaves a full stop.
  test("a code followed by a full stop, an Arabic comma or an RTL mark still opens the call", async () => {
    const { normalizeCode, routeOf } = await import("./door.ts");
    for (const tail of [".", "%D8%8C", "%E2%80%8F", ")"]) {
      expect(normalizeCode(routeOf(`/sales-live/open/K7Q2MX${tail}`).code)).toBe("K7Q2MX");
    }
  });
});
