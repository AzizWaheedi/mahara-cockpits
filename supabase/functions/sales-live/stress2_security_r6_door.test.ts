// bun test supabase/functions/sales-live/stress2_security_r6_door.test.ts
//
// Second series, round 6 (5 October 2026), angle: security and abuse of the
// public door as it stands after fix round 5.
//
// 1. A HEAD request is never a person. roomlogic.ts isPreviewBot says so
//    ("a HEAD request ... a link preview or another machine, not a person"),
//    but the door's own isPreviewBot takes no method, and /go accepts HEAD
//    and records it as the lead's open whenever it carries no Fetch Metadata
//    (link checkers, mail scanners and preview fetchers send none).
// 2. A standby room has no lead and its link went to nobody, yet its code is
//    answered with the closer's join link and an open of it is recorded as
//    "The lead opened the link" (first_open_at). A Take then adopts that very
//    row (cockpit_sales_live_claim keeps every open column), so the handed-
//    over lead's room says the lead opened the link before it was sent.
//
// A failing test is a finding. No network: an in-memory PostgREST.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2r6-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2r6-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2r6-never-printed",
  IP_SALT: "salt-stress2r6-never-printed",
  CRON_SECRET: "cron-secret-stress2r6-never-printed",
};
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** Sunday 11 October 2026 in Kuwait (UTC+3). */
const kw = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

type Row = Record<string, any>;

function world(rooms: Row[], now: number) {
  const w = {
    now,
    rooms,
    people: [{ email: "stress-r6-closer@stress.invalid", name: "Omar Closer", name_ar: "عمر" }] as Row[],
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

const NOW = kw("10:05:00");

/** A setter's fallback room for a lead, its link sent at 10:01, nobody opened it yet. */
const leadRoom = (): Row => ({
  id: randomUUID(),
  code: "H6Q2MX",
  contact_id: "stress-r6-lead",
  purpose: "fallback",
  call_kind: "intro",
  state: "host_in",
  provider: "zoom",
  provider_meeting_id: "85066600001",
  join_url: "https://us06web.zoom.us/j/85066600001?pwd=lead",
  host_email: "stress-r6-closer@stress.invalid",
  replaced_by: null,
  requested_at: iso(kw("10:00:00")),
  link_sent_at: iso(kw("10:01:00")),
  ends_at: iso(kw("10:30:00")),
  first_open_at: null,
  last_open_at: null,
});

/** A closer's standby room: Available, waiting for a handover. No lead, its link sent to nobody. */
const standbyRoom = (): Row => ({
  id: randomUUID(),
  code: "S6Q2MX",
  contact_id: null,
  purpose: "standby",
  call_kind: "demo",
  state: "host_in",
  provider: "zoom",
  provider_meeting_id: "85066600002",
  join_url: "https://us06web.zoom.us/j/85066600002?pwd=standby",
  host_email: "stress-r6-closer@stress.invalid",
  replaced_by: null,
  requested_at: iso(kw("09:50:00")),
  link_sent_at: null,
  ends_at: iso(kw("11:50:00")),
  first_open_at: null,
  last_open_at: null,
});

const go = (code: string, method: "GET" | "HEAD", headers: Record<string, string>) =>
  new Request(`${BASE}/functions/v1/sales-live/go/${code}`, {
    method,
    headers: { "user-agent": DESKTOP, "cf-connecting-ip": "198.51.100.61", ...headers },
  });

describe("stress2 security r6: a HEAD request on the no-script link", () => {
  test("control: the lead's own page load of /go (navigate) is recorded once, and is redirected to the room (the fixture works)", async () => {
    const room = leadRoom();
    const { w, handler } = world([room], NOW);
    const res = await handler(go("H6Q2MX", "GET", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }));
    await w.settle();
    expect(res.status).toBe(302);
    expect(w.events.filter(e => e.kind === "door.open")).toHaveLength(1);
    expect(room.first_open_at).toBeTruthy();
  });

  test(
    "go-head-request-counted-as-lead-open: a link checker or mail scanner sends HEAD /go/{code} with a browser's user agent and no Fetch Metadata; " +
      "the door records it as the lead opening the link (door.open, first_open_at), which the Opened step, the sweep's open grace and the settle's 'the lead opened the link' all read",
    async () => {
      const room = leadRoom();
      const { w, handler } = world([room], NOW);
      const res = await handler(go("H6Q2MX", "HEAD", {}));
      await w.settle();
      // No browser navigates with HEAD: it is never the lead.
      expect({
        status: res.status,
        open_rows: w.events.filter(e => e.kind === "door.open").length,
        first_open_at: room.first_open_at ?? null,
      }).toEqual({ status: 302, open_rows: 0, first_open_at: null });
    },
  );
});

describe("stress2 security r6: how old a link may be and still lead to the lead's room today", () => {
  // 9 September: the setter's missed-call link went to the WhatsApp number
  // HighLevel then had for Huda (a typo, or a recycled number: it reached
  // someone else). Nobody opened it and the room expired. 11 October 10:05:
  // Huda is handed over live; the closer's room waits for her with its link
  // just sent. Whoever holds the September message taps it.
  const LEAD = "stress-r6-old-link";
  const september = (): Row => ({
    id: randomUUID(),
    code: "P6Q2MX",
    contact_id: LEAD,
    purpose: "fallback",
    call_kind: "intro",
    state: "expired",
    result: "no_join",
    end_reason: "lead_no_show",
    provider: "zoom",
    provider_meeting_id: "85066600010",
    join_url: "https://us06web.zoom.us/j/85066600010?pwd=old",
    host_email: "stress-r6-setter@stress.invalid",
    replaced_by: null,
    requested_at: "2026-09-09T07:00:00.000Z",
    ends_at: "2026-09-09T07:30:00.000Z",
    ended_at: "2026-09-09T07:12:00.000Z",
    first_open_at: null,
    lead_in_at: null,
    count_undo_at: null,
  });
  const today = (): Row => ({
    ...leadRoom(),
    id: randomUUID(),
    code: "T6Q2MX",
    contact_id: LEAD,
    purpose: "handover",
    call_kind: "demo",
    state: "host_in",
    provider_meeting_id: "85066600011",
    join_url: "https://us06web.zoom.us/j/85066600011?pwd=today",
    requested_at: iso(kw("10:04:00")),
    link_sent_at: iso(kw("10:05:00")),
  });
  const tap = (code: string) =>
    new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=old-message-r6`, {
      headers: { "user-agent": IPHONE, "cf-connecting-ip": "203.0.113.77", origin: "https://call.maharamedia.com" },
    });

  test("control: the lead's own link from this morning, whose room closed, leads to her room now (fix round 4 holds)", async () => {
    const morning = { ...september(), requested_at: iso(kw("09:00:00")), ends_at: iso(kw("09:30:00")), ended_at: iso(kw("09:12:00")) };
    const now = today();
    const { w, handler } = world([morning, now], NOW);
    const body = (await (await handler(tap("P6Q2MX"))).json()) as Row;
    await w.settle();
    expect(String(body.join_url ?? "")).toContain("85066600011");
  });

  test(
    "old-link-follows-to-todays-room-unbounded: a link from a room that closed 32 days ago, never opened, is handed the join link of " +
      "the lead's live handover room today, and its open is recorded on that room as the lead's ('The lead opened the link', first_open_at)",
    async () => {
      const now = today();
      const { w, handler } = world([september(), now], NOW);
      const body = (await (await handler(tap("P6Q2MX"))).json()) as Row;
      await w.settle();
      expect({
        state: body.state,
        handed_todays_room: String(body.join_url ?? "").includes("85066600011"),
        todays_first_open: now.first_open_at ?? null,
        todays_open_rows: w.events.filter(e => e.kind === "door.open" && e.room_id === now.id).length,
      }).toEqual({ state: "ended", handed_todays_room: false, todays_first_open: null, todays_open_rows: 0 });
    },
  );
});

describe("stress2 security r6: a standby room's code at the door", () => {
  const page = (code: string, ip: string, device: string) =>
    new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=${device}`, {
      headers: { "user-agent": IPHONE, "cf-connecting-ip": ip, origin: "https://call.maharamedia.com" },
    });

  test("control: a lead's room's code opens it and the lead's open is recorded (the fixture works)", async () => {
    const room = leadRoom();
    const { w, handler } = world([room], NOW);
    const body = (await (await handler(page("H6Q2MX", "198.51.100.62", "lead-phone-r6"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("open");
    expect(w.events.filter(e => e.kind === "door.open" && e.room_id === room.id)).toHaveLength(1);
  });

  test(
    "standby-code-open-recorded-as-lead: a closer's standby room (no lead, its link sent to nobody) is opened by its code at 09:58 " +
      "(the closer tapping their own room's short link, or anyone who guessed it); the door hands over the closer's join link and records " +
      "'The lead opened the link on a phone.' and first_open_at on a room that has no lead; the Take that adopts this row at 10:05 keeps both, " +
      "so the handed-over lead's panel reads 'opened the link at 09:58' before their link was sent",
    async () => {
      const room = standbyRoom();
      const { w, handler } = world([room], kw("09:58:00"));
      const res = await handler(page("S6Q2MX", "203.0.113.66", "someone-r6"));
      const body = (await res.json()) as Row;
      await w.settle();
      const opens = w.events.filter(e => e.kind === "door.open" && e.room_id === room.id);
      // A room with no lead has no lead to open it: nothing is recorded as the
      // lead's open, and the link of a room no lead was sent is handed to nobody.
      expect({
        handed_join_link: typeof body.join_url === "string",
        lead_open_rows: opens.map(e => String(e.text)),
        first_open_at: room.first_open_at ?? null,
      }).toEqual({ handed_join_link: false, lead_open_rows: [], first_open_at: null });
    },
  );
});
