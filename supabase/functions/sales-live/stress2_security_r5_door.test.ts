// bun test supabase/functions/sales-live/stress2_security_r5_door.test.ts
//
// Second series, round 5 (5 October 2026), angle: security and abuse of the
// public door as it stands after fix round 4.
//
// Fix round 4 (old-room-link-ended-while-lead-has-open-room) made the door
// follow a final room's code to the lead's newest room that is still open,
// when the old room was never reached by the lead (door.ts leadReached).
// leadReached is false for a join "That was not the lead" took back: the
// person who held that link and joined with it is exactly someone the rep
// said is NOT the lead. Their next tap of the same old link now hands them
// the lead's new room (its join link), and records their open on the new
// room as the lead's ("The lead opened the link", first_open_at), which the
// Opened step, the sweep's open grace and the settle all read.
//
// A failing test is a finding. No network: an in-memory PostgREST.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-stress2r5-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-stress2r5-never-printed",
  SLACK_SIGNING_SECRET: "slack-secret-stress2r5-never-printed",
  IP_SALT: "salt-stress2r5-never-printed",
  CRON_SECRET: "cron-secret-stress2r5-never-printed",
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
    people: [{ email: "stress-r5-setter@stress.invalid", name: "Tara Setter", name_ar: "تارا" }] as Row[],
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

/** The page's own read of a code, from the person holding that link. */
const openReq = (code: string, ip: string, device: string) =>
  new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=${device}`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": ip, origin: "https://call.maharamedia.com" },
  });

describe("stress2 security r5: a link 'That was not the lead' took back, and the lead's next room", () => {
  // 10:00 the setter's Zoom room A for Huda; its link reached someone who
  // is not Huda (the link was forwarded; it could be anyone). That person
  // joined at 10:03 and the setter pressed "That was not the lead" at 10:04.
  // Room A closed at 10:10 with nobody. At 10:20 the setter makes room B
  // for Huda and her own link goes to Huda.
  const LEAD = "stress-r5-two-rooms";
  const roomA = {
    id: randomUUID(),
    code: "A5Q2MX",
    contact_id: LEAD,
    purpose: "fallback",
    call_kind: "intro",
    state: "expired",
    result: "no_join",
    end_reason: "lead_no_show",
    provider: "zoom",
    provider_meeting_id: "85055511111",
    join_url: "https://us06web.zoom.us/j/85055511111?pwd=a",
    host_email: "stress-r5-setter@stress.invalid",
    replaced_by: null,
    requested_at: iso(kw("10:00:00")),
    opened_at: iso(kw("10:00:10")),
    ends_at: iso(kw("10:30:10")),
    ended_at: iso(kw("10:10:00")),
    first_open_at: iso(kw("10:02:00")),
    lead_in_at: iso(kw("10:03:00")),
    count_undo_at: iso(kw("10:04:00")),
  };
  const roomB = {
    ...roomA,
    id: randomUUID(),
    code: "B5Q2MX",
    state: "host_in",
    result: null,
    end_reason: null,
    provider_meeting_id: "85055522222",
    join_url: "https://us06web.zoom.us/j/85055522222?pwd=b",
    requested_at: iso(kw("10:20:00")),
    opened_at: iso(kw("10:20:10")),
    ends_at: iso(kw("10:50:10")),
    ended_at: null,
    first_open_at: null,
    lead_in_at: null,
    count_undo_at: null,
  };

  test("control: a room the lead never reached and nobody joined still leads its link to the lead's waiting room (fix round 4 holds)", async () => {
    const a = { ...roomA, lead_in_at: null, count_undo_at: null };
    const { w, handler } = world([a, { ...roomB }], kw("10:21:00"));
    const body = (await (await handler(openReq("A5Q2MX", "198.51.100.7", "lead-phone-1"))).json()) as Row;
    await w.settle();
    expect(body.state).toBe("open");
    expect(String(body.join_url ?? "")).toContain("85055522222");
  });

  test("not-lead-link-follows-to-leads-new-room: the person the rep took back as not the lead taps room A's link again at 10:21 and is handed Huda's room B, and their open is recorded on B as Huda's", async () => {
    const b = { ...roomB };
    const { w, handler } = world([{ ...roomA }, b], kw("10:21:00"));
    const body = (await (await handler(openReq("A5Q2MX", "203.0.113.50", "not-the-lead-1"))).json()) as Row;
    await w.settle();
    // Room A's link was in the hands of someone who is not the lead: it ends
    // there. It must not open the lead's new room, nor count an open of it.
    expect({
      state: body.state,
      gave_b: String(body.join_url ?? "").includes("85055522222"),
      b_first_open: b.first_open_at ?? null,
      b_open_rows: w.events.filter(e => e.kind === "door.open" && e.room_id === b.id).length,
    }).toEqual({ state: "ended", gave_b: false, b_first_open: null, b_open_rows: 0 });
  });
});

// ---------------------------------------------------------------------------
// Guessing call codes from one IPv6 /48 after fix round 4's WIDE_ANSWERS.
//
// Fix round 3 (code-guess-oracle-per-64) closed the guessing oracle: past an
// allocation's MISSES_PER_WIDE distinct misses, every code from it is
// answered the same 429 "with no database read, live codes and known ones
// included, so a guesser's hit looks exactly like its misses". Fix round 4
// (allocation-miss-bound-locks-out-leads) reopened known codes for networks
// of that allocation "with no misses of their own". A guesser on a free /48
// (a tunnel broker hands one out: 65,536 /64s) uses each /64 once: a miss
// is a 429 (no read, so cheap and fast), a live code is a 200 with the
// room's join link and the rep's name. The allocation's lookup rate (600 a
// minute) is then the only bound, sixty times the round-3 bound.
// ---------------------------------------------------------------------------

import { MISSES_PER_WIDE, MISS_WINDOW_MS } from "./handler.ts";

/** Six letters of the code alphabet for guess i (never the live room's code). */
function guess(i: number): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  let n = i + 9_000_000;
  for (let k = 0; k < 6; k++) {
    s += A[n % 32];
    n = Math.floor(n / 32);
  }
  return s;
}

describe("stress2 security r5: one /48 guessing codes, one fresh /64 a guess", () => {
  const NOW = kw("11:00:00");
  const liveRoom = () => ({
    id: randomUUID(),
    code: "K7Q2MX",
    contact_id: "stress-r5-guessed-lead",
    purpose: "fallback",
    call_kind: "intro",
    state: "open",
    provider: "zoom",
    provider_meeting_id: "85077700001",
    join_url: "https://us06web.zoom.us/j/85077700001?pwd=live",
    host_email: "stress-r5-setter@stress.invalid",
    replaced_by: null,
    requested_at: iso(NOW - 60_000),
    ends_at: iso(NOW + 30 * 60_000),
    first_open_at: null,
  });
  const v6 = (n: number) => `2001:db8:5a5a:${n.toString(16)}::1`;
  const probe = (code: string, ip: string) =>
    new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=g${code}`, { headers: { "user-agent": IPHONE, "cf-connecting-ip": ip } });

  test("control: before the /48 has missed anything, a guess is looked up like any code (the fixture works)", async () => {
    const { w, handler } = world([liveRoom()], NOW);
    expect((await handler(probe(guess(1), v6(1)))).status).toBe(404);
    expect((await handler(probe("K7Q2MX", v6(2)))).status).toBe(200);
    await w.settle();
  });

  test("code-guess-oracle-reopened-by-wide-answers: past the /48's miss bound, a fresh /64 still tells a live code (200, its join link) from a miss (429), at the /48's 600 lookups a minute", async () => {
    const { w, handler } = world([liveRoom()], NOW);
    let n = 1;
    let g = 0;
    // The /48's bound: MISSES_PER_WIDE distinct misses (five /64s, twenty each).
    for (let a = 0; a < MISSES_PER_WIDE / 20; a++, n++)
      for (let k = 0; k < 20; k++, g++) await handler(probe(guess(g), v6(n)));
    // Now 500 guesses in the same ten minutes, each from a fresh /64 of the
    // /48, one every 0.2 s (well inside 600 a minute); the 250th is the live code.
    const answers: { code: string; status: number; link: boolean }[] = [];
    for (let k = 0; k < 500; k++, n++) {
      w.now += 200;
      const code = k === 250 ? "K7Q2MX" : guess(g++);
      const res = await handler(probe(code, v6(n)));
      const body = (await res.json().catch(() => ({}))) as Row;
      answers.push({ code, status: res.status, link: typeof body.join_url === "string" });
    }
    await w.settle();
    expect(w.now - NOW).toBeLessThan(MISS_WINDOW_MS);
    const hit = answers.find(a => a.code === "K7Q2MX")!;
    const missStatuses = [...new Set(answers.filter(a => a.code !== "K7Q2MX").map(a => a.status))];
    // Round 3's promise: from an allocation past its bound, the guesser's hit
    // looks exactly like its misses, and no link is handed over.
    expect({ hit_status: hit.status, hit_link: hit.link, miss_statuses: missStatuses }).toEqual({
      hit_status: 429,
      hit_link: false,
      miss_statuses: [429],
    });
  });
});
