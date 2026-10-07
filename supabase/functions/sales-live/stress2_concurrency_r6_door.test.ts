// bun test supabase/functions/sales-live/stress2_concurrency_r6_door.test.ts
//
// Second series, round 6, dimension: concurrency and idempotency. The same
// lead's two opens of one link: one while the room waited, one after it
// closed.
//
// The door keeps one door.open event per room and device (handler.ts
// recordOpen: dedupe key open:{room}:{hash of the salted address and the
// device kind}), inserted with resolution=ignore-duplicates. Round 5
// (late-open-after-close-reaches-nobody) made an open after the room closed
// a fact of its own: the event's detail.after_end, which sales-api's
// lateOpens reads for the panel and the banner ("Huda opened the link at
// 10:20, after the room closed. Call them now"), live.status holds the room
// for, and the settle reads as a doubt.
//
// The usual late lead opened the link while the room waited (Meet's "Ask to
// join", nobody let her in, or she closed it to finish something), the room
// closed at its lead wait, and she taps the same link again from the same
// phone. That open has the same dedupe key as her first one, so it is
// dropped as a duplicate: no after_end event, nothing on the panel or the
// banner, and the setter never hears that she is at the link now.
//
// A failing test is a finding for the fix agent. No network: an in-memory
// PostgREST; every lead is invented.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-r6-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-r6-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-r6-never-printed",
  IP_SALT: "salt-r6-never-printed",
  CRON_SECRET: "cron-secret-r6-never-printed",
};
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
    people: [{ email: "setter@stress.invalid", name: "Sara Setter", name_ar: "سارة" }] as Row[],
    // The short link in use (rooms on, short_link on): with it off the door follows no code and records no open (m1 round 5).
    settings: [{ key: "rooms", value: { enabled: true, short_link: true } }] as Row[],
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
      // resolution=ignore-duplicates on the dedupe key, as PostgREST answers it.
      if (w.events.some(e => e.dedupe_key === body.dedupe_key)) return Response.json([], { status: 201 });
      const id = randomUUID();
      w.events.push({ ...body, id, at: iso(w.now) });
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

/** The setter's Meet fallback room for Huda, waiting for her (link sent at 10:02). */
function waitingRoom(): Row {
  return {
    id: randomUUID(),
    code: "K7Q2MX",
    contact_id: "stress-r6-late-open",
    purpose: "fallback",
    call_kind: "intro",
    state: "open",
    provider: "meet",
    join_url: "https://meet.google.com/abc-defg-hij",
    host_email: "setter@stress.invalid",
    replaced_by: null,
    requested_at: iso(kw("10:01:00")),
    opened_at: iso(kw("10:01:20")),
    link_sent_at: iso(kw("10:02:00")),
    lead_by: iso(kw("10:12:00")),
    ends_at: iso(kw("10:31:20")),
    first_open_at: null,
    open_device: null,
    version: 3,
  };
}

describe("concurrency r6: the same phone opens the link in the room's time and again after it closed", () => {
  test("late-open-after-earlier-open-deduped-away: the open after the close is kept as after_end", async () => {
    const room = waitingRoom();
    const { w, handler } = world([room], kw("10:03:00"));
    // 10:03: Huda taps the link; the room is open, she waits at Meet's "Ask to join".
    const first = await handler(openReq("K7Q2MX"));
    expect((await first.json()).state).toBe("open");
    await w.settle();
    expect(w.events.filter(e => e.kind === "door.open")).toHaveLength(1);
    // Nobody let her in. The sweep's R4 closes the room at her wait plus the open grace.
    Object.assign(room, { state: "expired", result: "no_join", end_reason: "lead_no_show", ended_at: iso(kw("10:15:00")), version: 4 });
    // 10:20: she taps the same link again, from the same phone.
    w.now = kw("10:20:00");
    const late = await handler(openReq("K7Q2MX"));
    expect((await late.json()).state).toBe("ended");
    await w.settle();
    const after = w.events.filter(e => e.kind === "door.open" && e.detail?.after_end === true);
    expect(
      { after_end_opens: after.length, door_opens: w.events.filter(e => e.kind === "door.open").map(e => ({ at: e.at, after_end: Boolean(e.detail?.after_end) })) },
      "the 10:20 open after the room closed shares the 10:03 open's dedupe key and is dropped: sales-api's lateOpens finds no after_end open, so the panel and the banner never say she is at the link now",
    ).toMatchObject({ after_end_opens: 1 });
  });

  test("HELD (control): a first open after the close is kept as after_end", async () => {
    const room = { ...waitingRoom(), state: "expired", result: "no_join", end_reason: "lead_no_show", ended_at: iso(kw("10:15:00")) };
    const { w, handler } = world([room], kw("10:20:00"));
    await handler(openReq("K7Q2MX"));
    await w.settle();
    expect(w.events.filter(e => e.kind === "door.open" && e.detail?.after_end === true)).toHaveLength(1);
  });
});
