// bun test supabase/functions/sales-live/m1_security_r4_door.test.ts
//
// Milestone 1, video-link round 4, security angle (the public door,
// verify_jwt off): what anyone on the internet can make the door do with
// the pilot's settings (m1-scope.md section 3: live.enabled and live.slack
// off, so SLACK_SIGNING_SECRET is not set; rooms on for the test contact;
// short_link off), and what a lead can put on the rep's screen through
// Zoom's own fields.
//
// A test named "control" passes and proves the fixture; any other failing
// test is a finding. No network: an in-memory PostgREST. Every value is
// invented (stress-..., ...@stress.invalid).

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter, safeJoinUrl } from "./door.ts";
import { makeHandler } from "./handler.ts";
import { v0Signature } from "./sign.ts";
import { cleanZoom, plainZoomName, zoomText } from "./zoom.ts";

type Row = Record<string, any>;

const BASE = "https://proj.supabase.co";
const PILOT_ENV: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-m1s4-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-m1s4-never-printed",
  IP_SALT: "salt-m1s4-never-printed",
  CRON_SECRET: "cron-secret-m1s4-never-printed",
  // SLACK_SIGNING_SECRET: not set. Slack is fenced off in Milestone 1.
};
const NOW = Date.UTC(2026, 9, 6, 8, 0, 0);
const iso = (t: number) => new Date(t).toISOString();
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MEETING = "85066600441";

/** The setter's Zoom room for the test contact, its link sent, the host in. */
const zoomRoom = (): Row => ({
  id: randomUUID(),
  code: "H6Q4MX",
  contact_id: "stress-m1s4-lead",
  purpose: "manual",
  call_kind: "intro",
  state: "host_in",
  provider: "zoom",
  provider_meeting_id: MEETING,
  join_url: `https://us06web.zoom.us/j/${MEETING}?pwd=lead`,
  host_email: "stress-m1s4-setter@stress.invalid",
  replaced_by: null,
  requested_at: iso(NOW - 4 * 60_000),
  link_sent_at: iso(NOW - 3 * 60_000),
  ends_at: iso(NOW + 30 * 60_000),
  first_open_at: null,
  last_open_at: null,
});

function door(o: { env?: Record<string, string>; rooms?: Row[] } = {}) {
  const env = o.env ?? PILOT_ENV;
  const w = {
    rooms: o.rooms ?? [],
    settings: [
      { key: "rooms", value: { enabled: true, test_only: true, short_link: false } },
      { key: "live", value: { enabled: false, slack: false } },
    ] as Row[],
    people: [{ email: "stress-m1s4-setter@stress.invalid", name: "Tara Setter", name_ar: null }] as Row[],
    events: [] as Row[],
    reads: [] as string[],
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
    w.reads.push(`${method} ${table}`);
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
    env: n => env[n] ?? "",
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
  const settingReads = () => w.reads.filter(r => r === "GET cockpit_sales_settings").length;
  return { w, handler, settle, settingReads };
}

async function signedZoom(secret: string, body: Row, ts = String(Math.floor(NOW / 1000))): Promise<Request> {
  const raw = new TextEncoder().encode(JSON.stringify(body));
  return new Request("http://localhost/sales-live/zoom", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-request-timestamp": ts,
      "x-zm-signature": await v0Signature(secret, ts, raw),
    },
    body: raw,
  });
}

const leadJoin = (name: string): Row => ({
  event: "meeting.participant_joined",
  event_ts: NOW,
  payload: {
    account_id: "acct-m1s4",
    object: {
      id: MEETING,
      uuid: "m1s4-instance==",
      host_id: "Z-setter",
      topic: "Mahara call H6Q4MX",
      participant: { user_name: name, id: "", participant_uuid: "pu-lead-m1s4", join_time: iso(NOW) },
    },
  },
});

// ---------------------------------------------------------------------------
// 1. Anyone can make POST /slack read the database, once per request
// ---------------------------------------------------------------------------

describe("m1 security r4: an unsigned flood of POST /slack while Slack is fenced off", () => {
  const stray = (n: number) =>
    new Request("http://localhost/sales-live/slack", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `198.51.100.${n % 250}` },
      body: "command=%2Favailable&user_id=U0FLOOD",
    });

  test("control: every unsigned POST /slack is turned away 503 'Slack presses are switched off.' (the fence holds)", async () => {
    const d = door();
    const res = await d.handler(stray(1));
    expect(res.status).toBe(503);
    expect(((await res.json()) as Row).error).toBe("Slack presses are switched off.");
  });

  test("control: the door's other unsigned route that reads a switch (/open with IP_SALT missing) reads it at most once a minute, whatever the flood", async () => {
    const env = { ...PILOT_ENV };
    delete env.IP_SALT;
    const d = door({ env });
    for (let i = 0; i < 200; i++) {
      const res = await d.handler(new Request(`http://localhost/sales-live/open/H6Q4MX?d=dev${i}`, { headers: { "user-agent": DESKTOP } }));
      expect(res.status).toBe(503);
    }
    await d.settle();
    expect(d.settingReads()).toBeLessThanOrEqual(1);
  });

  test("slack-fenced-flood-reads-database-per-request: 200 unsigned POST /slack from anyone make 200 reads of cockpit_sales_settings (no memo, no limit, before any key is checked)", async () => {
    const d = door();
    for (let i = 0; i < 200; i++) {
      const res = await d.handler(stray(i));
      expect(res.status).toBe(503);
    }
    await d.settle();
    // The door's own rule for a switch read on an unsigned route
    // (shortLinkSwitchedOn): "Read at most once a minute (a flood of
    // requests never floods the database)".
    expect({ settings_reads: d.settingReads() }).toEqual({ settings_reads: 1 });
  });
});

// ---------------------------------------------------------------------------
// 2. Zoom's webhook: forged, replayed, re-timed
// ---------------------------------------------------------------------------

describe("m1 security r4: forged and replayed Zoom webhooks (controls)", () => {
  test("control: a body signed with another secret is refused 401, nothing stored, nothing passed on", async () => {
    const d = door({ rooms: [zoomRoom()] });
    const res = await d.handler(await signedZoom("not-the-secret", leadJoin("Huda")));
    expect(res.status).toBe(401);
    await d.settle();
    expect(d.w.events.length).toBe(0);
    expect(d.w.forwards.length).toBe(0);
  });

  test("control: Zoom's signature replayed with another timestamp is refused 401", async () => {
    const d = door({ rooms: [zoomRoom()] });
    const good = await signedZoom(PILOT_ENV.ZOOM_WEBHOOK_SECRET, leadJoin("Huda"));
    const raw = new Uint8Array(await good.arrayBuffer());
    const retimed = new Request("http://localhost/sales-live/zoom", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zm-request-timestamp": String(Math.floor(NOW / 1000) + 3600),
        "x-zm-signature": String(good.headers.get("x-zm-signature")),
      },
      body: raw,
    });
    expect((await d.handler(retimed)).status).toBe(401);
  });

  test("control: the same signed join replayed ten times is stored once and passed on once", async () => {
    const d = door({ rooms: [zoomRoom()] });
    const body = leadJoin("Huda");
    for (let i = 0; i < 10; i++) expect((await d.handler(await signedZoom(PILOT_ENV.ZOOM_WEBHOOK_SECRET, body))).status).toBe(200);
    await d.settle();
    expect(d.w.events.filter(e => e.kind === "zoom.meeting.participant_joined").length).toBe(1);
    expect(d.w.forwards.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. The lead's Zoom display name on the rep's room timeline
// ---------------------------------------------------------------------------

describe("m1 security r4: what a lead's Zoom display name puts on the room's timeline", () => {
  test("control: a link in the display name never reaches the timeline line (the fixture works)", async () => {
    const d = door({ rooms: [zoomRoom()] });
    await d.handler(await signedZoom(PILOT_ENV.ZOOM_WEBHOOK_SECRET, leadJoin("https://evil.example/pay Huda")));
    await d.settle();
    const line = String(d.w.events[0]?.text ?? "");
    expect(line).toBe("Zoom: Huda joined.");
  });

  test("zoom-name-bidi-spoofs-room-timeline: a right-to-left override in the lead's Zoom name is kept on the stored line, so the rest of the rep's line reads backwards (here as 'The host left.')", async () => {
    // What the lead types as their Zoom name: an RLO, then text written backwards.
    const name = "‮.tfel tsoh ehT";
    const d = door({ rooms: [zoomRoom()] });
    await d.handler(await signedZoom(PILOT_ENV.ZOOM_WEBHOOK_SECRET, leadJoin(name)));
    await d.settle();
    const line = String(d.w.events[0]?.text ?? "");
    // The pure pieces agree with the stored row.
    const clean = cleanZoom(leadJoin(name));
    expect(clean && zoomText(clean)).toBe(line);
    expect({ line_has_bidi_control: /[‪-‮⁦-⁩]/.test(line) }).toEqual({ line_has_bidi_control: false });
  });

  test("zoom-name-bidi-spoofs-room-timeline (invisible name): a Zoom name of zero-width spaces is no name, yet the line reads 'Zoom: \\u200b joined.' instead of 'Zoom: Someone joined.'", () => {
    const shown = plainZoomName("​​​");
    expect(shown).toBe("Someone");
  });
});

// ---------------------------------------------------------------------------
// 4. /open and /go: where the door may send the code's holder (controls)
// ---------------------------------------------------------------------------

describe("m1 security r4: /open and /go never send the code's holder off Zoom and Meet (controls)", () => {
  test("control: lookalike hosts and tricks are never a join link the door opens", () => {
    for (const bad of [
      "https://zoom.us.evil.example/j/1",
      "https://evil.example/zoom.us/j/1",
      "https://evil.example\\@zoom.us/j/1",
      "https://zoom.us@evil.example/j/1",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "https://zoom.us:8443/j/1",
      "http://zoom.us/j/1",
      "javascript:alert(1)//zoom.us",
      "https://xn--zoom-xyz.us/j/1",
    ])
      expect([bad, safeJoinUrl(bad)]).toEqual([bad, null]);
  });

  test("control: /go for a room whose stored link is a lookalike answers broken and redirects nowhere", async () => {
    const room = { ...zoomRoom(), join_url: "https://zoom.us.evil.example/j/1" };
    const d = door({ rooms: [room] });
    const res = await d.handler(new Request("http://localhost/sales-live/go/H6Q4MX", { headers: { "user-agent": DESKTOP } }));
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
  });

  test("control: /open from a page whose Origin is 'null' (a sandboxed frame, a file) is refused and records no open", async () => {
    const d = door({ rooms: [zoomRoom()] });
    const res = await d.handler(
      new Request("http://localhost/sales-live/open/H6Q4MX", { headers: { origin: "null", "user-agent": DESKTOP } }),
    );
    expect(res.status).toBe(403);
    await d.settle();
    expect(d.w.events.length).toBe(0);
    expect(d.w.rooms[0].first_open_at).toBeNull();
  });
});
