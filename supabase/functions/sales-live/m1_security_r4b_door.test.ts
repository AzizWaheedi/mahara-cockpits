// bun test supabase/functions/sales-live/m1_security_r4b_door.test.ts
//
// Milestone 1, video-link round 4 (second pass), security angle (the public
// door): forged and swapped Zoom bodies, the cron door's kinds, lookalike
// origins, and another Zoom meeting named after a room still being made.
// Pilot settings (m1-scope.md section 3): live and Slack off (no
// SLACK_SIGNING_SECRET), rooms on, short_link off. No network: an in-memory
// PostgREST. Every value is invented (stress-..., ...@stress.invalid).
//
// A test named "control" passes and proves the rule holds; any other failing
// test is a finding.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { cronForwardable } from "./cron.ts";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";
import { v0Signature } from "./sign.ts";

type Row = Record<string, any>;

const BASE = "https://proj.supabase.co";
const ENV: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-m1s4b-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-m1s4b-never-printed",
  IP_SALT: "salt-m1s4b-never-printed",
  CRON_SECRET: "cron-secret-m1s4b-never-printed",
};
const NOW = Date.UTC(2026, 9, 6, 8, 0, 0);
const iso = (t: number) => new Date(t).toISOString();
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MEETING = "85066600442";
const CODE = "J6Q4MB";

/** The setter's Zoom room: open with its own meeting, or still being made (no meeting id yet). */
const zoomRoom = (making = false): Row => ({
  id: randomUUID(),
  code: CODE,
  contact_id: "stress-m1s4b-lead",
  purpose: "manual",
  call_kind: "intro",
  state: making ? "creating" : "open",
  provider: "zoom",
  provider_meeting_id: making ? null : MEETING,
  join_url: making ? null : `https://us06web.zoom.us/j/${MEETING}?pwd=lead`,
  host_email: "stress-m1s4b-setter@stress.invalid",
  replaced_by: null,
  requested_at: iso(NOW - 5_000),
  created_at: iso(NOW - 5_000),
  ends_at: null,
  first_open_at: null,
  last_open_at: null,
});

function door(o: { rooms?: Row[] } = {}) {
  const w = {
    rooms: o.rooms ?? [],
    settings: [
      { key: "rooms", value: { enabled: true, test_only: true, short_link: false } },
      { key: "live", value: { enabled: false, slack: false } },
    ] as Row[],
    people: [{ email: "stress-m1s4b-setter@stress.invalid", name: "Tara Setter", name_ar: null }] as Row[],
    events: [] as Row[],
    forwards: [] as Row[],
    pending: [] as Promise<unknown>[],
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
    if (url.pathname === "/functions/v1/sales-api") {
      w.forwards.push(body);
      return Response.json({ ok: true });
    }
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
    const source: Record<string, Row[]> = {
      cockpit_sales_rooms: w.rooms,
      cockpit_sales_people: w.people,
      cockpit_sales_settings: w.settings,
    };
    if (method === "GET" && source[table]) return Response.json(pick(source[table], p).slice(0, Number(p.get("limit") ?? 1000)));
    return new Response(`unexpected ${method} ${table}`, { status: 400 });
  };
  const handler = makeHandler({
    env: n => ENV[n] ?? "",
    fetch: fetcher as typeof fetch,
    now: () => NOW,
    background: p => {
      w.pending.push(p);
    },
    limiter: new RateLimiter(30, 60_000, 10_000),
    wideLimiter: new RateLimiter(120, 60_000, 10_000),
    log: () => {},
  });
  const settle = async () => {
    while (w.pending.length) await Promise.allSettled(w.pending.splice(0));
  };
  return { w, handler, settle };
}

async function signed(secret: string, raw: Uint8Array, ts = String(Math.floor(NOW / 1000))): Promise<string> {
  return await v0Signature(secret, ts, raw);
}

function zoomRequest(raw: Uint8Array, sig: string, ts = String(Math.floor(NOW / 1000))): Request {
  return new Request("http://localhost/sales-live/zoom", {
    method: "POST",
    headers: { "content-type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": sig },
    body: raw,
  });
}

const enc = (o: Row) => new TextEncoder().encode(JSON.stringify(o));

/** Another Zoom user on Mahara's account titles a meeting with the room's code and deletes it. */
const foreignDeleted = (): Row => ({
  event: "meeting.deleted",
  event_ts: NOW,
  payload: {
    account_id: "acct-m1s4b",
    object: { id: "86666666666", uuid: "foreign-instance==", host_id: "Z-other", topic: `Mahara call ${CODE}`, type: 2 },
  },
});

// ---------------------------------------------------------------------------
// 1. Zoom bodies that are not Zoom's
// ---------------------------------------------------------------------------

describe("m1 security r4b: Zoom bodies the door must refuse (controls)", () => {
  test("control: Zoom's signature for one body, sent with another body (a lead join swapped for a meeting end), is refused 401 and nothing is stored", async () => {
    const d = door({ rooms: [zoomRoom()] });
    const signedBody = enc({ event: "meeting.started", event_ts: NOW, payload: { object: { id: MEETING, topic: `Mahara call ${CODE}` } } });
    const swapped = enc({ event: "meeting.ended", event_ts: NOW, payload: { object: { id: MEETING, topic: `Mahara call ${CODE}` } } });
    const res = await d.handler(zoomRequest(swapped, await signed(ENV.ZOOM_WEBHOOK_SECRET, signedBody)));
    expect(res.status).toBe(401);
    await d.settle();
    expect(d.w.events.length).toBe(0);
    expect(d.w.forwards.length).toBe(0);
  });

  test("control: an unsigned or wrongly signed endpoint.url_validation gets no encryptedToken (the door is no HMAC oracle)", async () => {
    const d = door();
    const body = enc({ event: "endpoint.url_validation", payload: { plainToken: "abcDEF123" } });
    for (const sig of ["", "v0=" + "0".repeat(64), await signed("another-secret", body)]) {
      const res = await d.handler(zoomRequest(body, sig));
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).not.toContain("encryptedToken");
    }
  });

  test("control: a signed event for another meeting whose title names an open room's code is kept nowhere and passed on to nobody", async () => {
    const d = door({ rooms: [zoomRoom()] });
    const raw = enc(foreignDeleted());
    const res = await d.handler(zoomRequest(raw, await signed(ENV.ZOOM_WEBHOOK_SECRET, raw)));
    expect(res.status).toBe(200);
    await d.settle();
    expect(d.w.events.length).toBe(0);
    expect(d.w.forwards.length).toBe(0);
  });

  test("zoom-foreign-meeting-deletes-room-being-made (door): the same signed meeting.deleted while the room is being made (no meeting id yet) is stored on the room and passed on as its event", async () => {
    const room = zoomRoom(true);
    const d = door({ rooms: [room] });
    const raw = enc(foreignDeleted());
    const res = await d.handler(zoomRequest(raw, await signed(ENV.ZOOM_WEBHOOK_SECRET, raw)));
    expect(res.status).toBe(200);
    await d.settle();
    // Meeting 86666666666 is not the room's: its host is another Zoom user
    // (Z-other), and the worker has not named any meeting for the room yet.
    expect({
      stored_on_room: d.w.events.filter(e => e.room_id === room.id).length,
      passed_on_for_room: d.w.forwards.filter(f => f.room_id === room.id).length,
    }).toEqual({ stored_on_room: 0, passed_on_for_room: 0 });
  });
});

// ---------------------------------------------------------------------------
// 2. The cron door's kinds and the call page's origins
// ---------------------------------------------------------------------------

describe("m1 security r4b: the cron door and /open's origins (controls)", () => {
  test("control: the cron door refuses room.event kinds named after object keys and every kind that is not the sweep's", () => {
    const id = randomUUID();
    for (const kind of ["__proto__", "constructor", "toString", "hasOwnProperty", "worker.ready", "worker.failed", "zoom.meeting.ended", "live.claimed"]) {
      const out = cronForwardable({ action: "room.event", kind, payload: { room_ids: [id], event_ids: [id] } });
      expect([kind, out.ok]).toEqual([kind, false]);
    }
    for (const action of ["__proto__", "constructor", "live.press", "reply.seen", "contract.sync", "followup.send_due"]) {
      const out = cronForwardable({ action, kind: "tick", payload: { room_ids: [id] } });
      expect([action, out.ok]).toEqual([action, false]);
    }
  });

  test("control: the cron door passes on only the checked fields (a stowaway payload key never reaches sales-api)", () => {
    const id = randomUUID();
    const out = cronForwardable({ action: "room.event", kind: "tick", payload: { room_ids: [id], kind: "worker.ready", room_id: id }, room_id: id, source: "zoom" });
    expect(out).toEqual({ ok: true, body: { action: "room.event", kind: "tick", payload: { room_ids: [id] } } });
  });

  test("control: /open from lookalike origins is refused 403 and records no open", async () => {
    for (const origin of [
      "https://call.maharamedia.com.evil.example",
      "https://evilcall.maharamedia.com",
      "http://call.maharamedia.com",
      "https://call.maharamedia.com:8443",
      "https://CALL.maharamedia.com",
    ]) {
      const d = door({ rooms: [zoomRoom()] });
      const res = await d.handler(new Request(`http://localhost/sales-live/open/${CODE}`, { headers: { origin, "user-agent": DESKTOP } }));
      expect([origin, res.status]).toEqual([origin, 403]);
      await d.settle();
      expect(d.w.events.length).toBe(0);
    }
  });

  test("control: GET /health names routes and missing secrets only, never a value", async () => {
    const d = door();
    const res = await d.handler(new Request("http://localhost/sales-live/health"));
    const text = await res.text();
    for (const v of Object.values(ENV)) if (v.includes("never-printed")) expect(text).not.toContain(v);
  });
});
