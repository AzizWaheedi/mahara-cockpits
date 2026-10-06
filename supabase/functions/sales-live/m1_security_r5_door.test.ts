// bun test supabase/functions/sales-live/m1_security_r5_door.test.ts
//
// Milestone 1, video-link round 5, security angle (the public door): what a
// room code read off a closed room's own screen (its Zoom topic is "Mahara
// call {code}") still opens while rooms.short_link is off and no lead's
// message carries a code; and the line the door stores for a Zoom join when
// the person in the meeting picks a display name that draws nothing. The
// door writes room_events.text from Zoom's display name (zoom.ts zoomText,
// plainZoomName); sales-api's room.status passes that line to the rep's
// timeline as it stands (rooms.ts eventText). Pilot settings (m1-scope.md
// section 3): rooms on, short_link off, live and Slack off. No network: an
// in-memory PostgREST. Every value is invented (stress-..., ...@stress.invalid).
//
// A test named "control" passes and proves the rule holds; any other failing
// test is a finding.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";
import { cleanZoom, plainZoomName, zoomText } from "./zoom.ts";

type Row = Record<string, any>;

const joined = (name: string) =>
  cleanZoom({
    event: "meeting.participant_joined",
    event_ts: 1_791_500_000_000,
    payload: {
      account_id: "acct-m1s5",
      object: {
        id: "81234567895",
        uuid: "m1s5-81234567895==",
        host_id: "Z-setter",
        topic: "Mahara call K7Q5MB",
        participant: { participant_uuid: "pu-m1s5", user_name: name, join_time: "2026-10-06T08:00:00Z" },
      },
    },
  });

describe("m1 security r5: a Zoom display name that draws nothing (door)", () => {
  test("control: zero-width spaces, joiners and direction marks are no name (m1 round 4 holds)", () => {
    for (const name of ["​​", "‍⁠", "‮⁦", "﻿"]) {
      expect([JSON.stringify(name), plainZoomName(name)]).toEqual([JSON.stringify(name), "Someone"]);
      expect(zoomText(joined(name)!)).toBe("Zoom: Someone joined.");
    }
  });

  test("control: a real name in any script stays (Arabic, Korean, an initial)", () => {
    expect(plainZoomName("هدى")).toBe("هدى");
    expect(plainZoomName("한지민")).toBe("한지민");
    expect(plainZoomName("J. R.")).toBe("J. R.");
  });

  for (const [label, name] of [
    ["Hangul fillers (U+3164)", "ㅤㅤㅤ"],
    ["Hangul choseong and jungseong fillers (U+115F U+1160)", "ᅟᅠ"],
    ["a halfwidth Hangul filler and a braille blank (U+FFA0 U+2800)", "ﾠ⠀"],
    ["soft hyphens and a combining grapheme joiner (U+00AD U+034F)", "­­͏"],
    ["Mongolian vowel separators (U+180E)", "᠎᠎"],
  ] as const) {
    test(`m1-security-r5-zoom-blank-name-on-timeline (door): a display name of ${label} is kept as the name, so the stored line reads "Zoom: <nothing> joined."`, () => {
      expect(plainZoomName(name)).toBe("Someone");
      expect(zoomText(joined(name)!)).toBe("Zoom: Someone joined.");
    });
  }
});

// ---------------------------------------------------------------------------
// 2. A closed room's code, with the short link off (the pilot)
// ---------------------------------------------------------------------------

const BASE = "https://proj.supabase.co";
const ENV: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-m1s5-never-printed",
  ZOOM_WEBHOOK_SECRET: "zoom-secret-m1s5-never-printed",
  IP_SALT: "salt-m1s5-never-printed",
  CRON_SECRET: "cron-secret-m1s5-never-printed",
};
const NOW = Date.UTC(2026, 9, 6, 8, 0, 0);
const iso = (t: number) => new Date(t).toISOString();
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const LEAD = "stress-m1s5-lead";
const OLD_CODE = "J6Q5MB";
const NEW_MEET = "https://meet.google.com/stq-mfiv-hij";

/**
 * The lead's missed-call Zoom room from 08:00 Kuwait less 35 minutes: its
 * link went (the Zoom join link itself, short_link off), somebody other
 * than the lead knocked in its waiting room, nobody was let in, and the
 * sweep closed it at the lead's ten minutes. Then the lead's next room: a
 * closer's Meet room for the same lead, open now.
 */
function rooms(o: { takenBack?: boolean } = {}): Row[] {
  return [
    {
      id: randomUUID(),
      code: OLD_CODE,
      contact_id: LEAD,
      purpose: "fallback",
      call_kind: "intro",
      state: "expired",
      provider: "zoom",
      join_url: "https://us06web.zoom.us/j/85066600551?pwd=old",
      host_email: "stress-m1s5-setter@stress.invalid",
      replaced_by: null,
      requested_at: iso(NOW - 35 * 60_000),
      ended_at: iso(NOW - 20 * 60_000),
      end_reason: "lead_no_show",
      ends_at: null,
      first_open_at: null,
      lead_in_at: o.takenBack ? iso(NOW - 25 * 60_000) : null,
      count_undo_at: o.takenBack ? iso(NOW - 24 * 60_000) : null,
      taken_back_join_at: o.takenBack ? iso(NOW - 25 * 60_000) : null,
    },
    {
      id: randomUUID(),
      code: "K8R5NC",
      contact_id: LEAD,
      purpose: "manual",
      call_kind: "demo",
      state: "open",
      provider: "meet",
      join_url: NEW_MEET,
      host_email: "stress-m1s5-closer@stress.invalid",
      replaced_by: null,
      requested_at: iso(NOW - 2 * 60_000),
      ended_at: null,
      end_reason: null,
      ends_at: null,
      first_open_at: null,
      lead_in_at: null,
      count_undo_at: null,
      taken_back_join_at: null,
    },
  ];
}

function door(roomRows: Row[]) {
  const w = {
    rooms: roomRows,
    settings: [
      // The pilot (m1-scope.md section 3): rooms on, short_link off, live off.
      { key: "rooms", value: { enabled: true, test_only: true, short_link: false, fallback: { ended_page_whatsapp: null } } },
      { key: "live", value: { enabled: false, slack: false } },
    ] as Row[],
    people: [
      { email: "stress-m1s5-setter@stress.invalid", name: "Tara Setter", name_ar: null },
      { email: "stress-m1s5-closer@stress.invalid", name: "Colin Closer", name_ar: null },
    ] as Row[],
    events: [] as Row[],
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

const go = (code: string) =>
  new Request(`http://localhost/sales-live/go/${code}`, {
    headers: { "user-agent": PHONE, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "x-forwarded-for": "203.0.113.77" },
  });
const open = (code: string) =>
  new Request(`http://localhost/sales-live/open/${code}?d=dev-m1s5-0001`, {
    headers: { origin: "https://call.maharamedia.com", "user-agent": PHONE, "x-forwarded-for": "203.0.113.77" },
  });

describe("m1 security r5: a closed room's code while the short link is off", () => {
  test("control: a closed room's code whose join 'That was not the lead' took back never leads to the lead's newer room (stress2 round 5 holds)", async () => {
    const d = door(rooms({ takenBack: true }));
    const res = await d.handler(go(OLD_CODE));
    await d.settle();
    expect(res.headers.get("location") ?? "").not.toContain(NEW_MEET);
  });

  test("m1-security-r5-closed-code-opens-leads-next-room-with-short-link-off (GET /go): with rooms.short_link off no lead's message carries a code, yet the old room's code (shown in its Zoom waiting room as 'Mahara call J6Q5MB') is redirected to the lead's new Meet room on another rep's meeting, and the open is recorded on it as the lead's", async () => {
    const d = door(rooms());
    const res = await d.handler(go(OLD_CODE));
    await d.settle();
    const opened = d.w.rooms[1].first_open_at ?? null;
    expect({ status: res.status, location: res.headers.get("location"), new_room_opened: opened }).toEqual({
      status: 302,
      location: "https://call.maharamedia.com/ended?c=J6Q5MB",
      new_room_opened: null,
    });
  });

  test("m1-security-r5-closed-code-opens-leads-next-room-with-short-link-off (GET /open): the call page's read of the old code answers the new room's join link", async () => {
    const d = door(rooms());
    const res = await d.handler(open(OLD_CODE));
    const body = (await res.json()) as Row;
    await d.settle();
    expect(JSON.stringify(body)).not.toContain(NEW_MEET);
  });
});
