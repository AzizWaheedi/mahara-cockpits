// bun test supabase/functions/sales-api/m1_time_r2_queue.test.ts
//
// Milestone 1, video-link round 2, the TIME angle: a booked intro near the
// room, through the dialer's queue (index.ts dial.queue, run end to end
// through the real handler, Deno.serve's function). The outside world is
// faked at fetch: PostgREST is testfakes.ts FakeDb behind the same URLs, the
// seat check answers a setter. The pilot's rooms setting (m1-scope.md
// section 3). Synthetic only (stress-m1t2q-..., ...@stress.invalid); nothing
// leaves this process.
//
// The journey. The setter's booked intro is at 15:00. The dialer's intro
// item opens at 14:55 (dialer.ts introWindow); the setter rings at 14:55:10,
// nobody answers. The intro waits five minutes and comes back for the try at
// the booked minute (dialer.ts INTRO_RETRY: "a try at the booked minute, then
// about every five minutes to twenty past"). This time the setter also
// pressed Send a video link at 14:55:40 (the room carries the intro), and the
// link went at 14:55:50, so the room's lead_by is 15:05:50.
//
// A failing test is a finding: its comment says what the setter gets instead.
import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-m1t2q@stress.invalid";
const LEAD = "stress-m1t2q-lead-1";
const APPT = "stress-m1t2q-appt-1";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    // The day's stats and the room talks read with an or= filter the fake does
    // not parse; they do not decide this item, so the filter is dropped.
    const path = url.slice(`${DB}/rest/v1/`.length).replace(/&or=[^&]*/, "");
    const headers = new Headers(init.headers as HeadersInit);
    const prefer = headers.get("prefer") ?? "";
    try {
      const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) return reply({});
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-stress",
    SUPABASE_ANON_KEY: "anon-stress",
    SALES_GHL_TOKEN: "ghl-stress",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

const S = 1000;
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

// index.ts keeps its heavy reads (leads, calls, the calendar) for 20 s
// (HEAVY_FOR): each world starts half a minute after the last.
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

/**
 * The world `sinceStart` after the intro's booked minute: the intro item's
 * first try 5 minutes before it, and (with `room`) the video link pressed
 * after that try, sent at start - 4:10, its lead_by start + 5:50.
 */
function world(o: { room: boolean; sinceStart: number }) {
  db.tables = {};
  offset += 30_000;
  const now = Date.now();
  const start = now - o.sinceStart;
  db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        count_on_join: false,
        settle: false,
        wrap: false,
        short_link: false,
        fallback: { scope: "intro", auto_on_miss: false, pilot_emails: [] },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true, via_portal: true },
  ]);
  db.seed("cockpit_sales_leads", [
    {
      contact_id: LEAD,
      name: "Sam Lee",
      phone: "+96550001234",
      phone8: "50001234",
      lead_created_at: iso(start - 3 * 86_400_000),
      stage_id: "s-booked",
      stage_name: "Intro booked",
      pipeline_id: "p-sales",
      lead_class: "qualified",
      dnd: false,
      contact_type: "lead",
      assigned_to: "G-setter",
      tags: ["roas-qualified"],
      country: "KW",
    },
  ]);
  const appt = {
    appointment_id: APPT,
    contact_id: LEAD,
    call_type: "intro",
    start_at: iso(start),
    booked_at: iso(start - 3 * 86_400_000),
    status: "confirmed",
    assigned_user_id: "G-setter",
  };
  db.seed("cockpit_sales_calendar", [{ ...appt }]);
  db.seed("cockpit_sales_appointments", [{ ...appt, end_at: iso(start + 30 * MIN), calendar_id: "stress-cal" }]);
  db.seed("cockpit_sales_dials", [
    { call_id: "c-out-1", contact_id: LEAD, lead_phone8: "50001234", occurred_at: iso(start - 5 * MIN + 10 * S), state: "no_answer", direction: "outbound" },
  ]);
  db.seed("cockpit_sales_attempts", [
    {
      id: "00000000-0000-4000-8000-00000000a201",
      contact_id: LEAD,
      rep_email: SETTER,
      appointment_id: APPT,
      state: "saved",
      outcome: "no_answer",
      item_kind: "intro",
      started_at: iso(start - 5 * MIN + 10 * S),
      saved_at: iso(start - 5 * MIN + 30 * S),
      auto_saved: true,
    },
  ]);
  if (o.room)
    db.seed("cockpit_sales_rooms", [
      {
        id: "00000000-0000-4000-8000-00000000b201",
        request_id: "00000000-0000-4000-8000-00000000c201",
        code: "M1T2QA",
        contact_id: LEAD,
        contact_first_name: "Sam",
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: APPT,
        appointment_start_at: iso(start),
        state: "host_in",
        version: 4,
        join_url: "https://meet.google.com/m1t-2qaa-bcd",
        requested_at: iso(start - 4 * MIN - 20 * S),
        created_at: iso(start - 4 * MIN - 20 * S),
        opened_at: iso(start - 4 * MIN - 15 * S),
        host_in_at: iso(start - 4 * MIN),
        link_claimed_at: iso(start - 4 * MIN - 14 * S),
        link_sent_at: iso(start - 4 * MIN - 10 * S),
        link_channels: ["email"],
        host_by: iso(start + 10 * MIN),
        lead_by: iso(start + 5 * MIN + 50 * S),
        ends_at: iso(start + 25 * MIN),
      },
    ]);
}

async function queue(): Promise<Row> {
  if (!handler) throw new Error("index.ts did not register its handler (run this file on its own)");
  const res = await handler(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "dial.queue", as: "setter", limit: 25 }),
    }),
  );
  const body = (await res.json()) as Row;
  if (res.status !== 200) throw new Error(`dial.queue ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const sam = (q: Row) => ((q.queue as Row[]) ?? []).find(r => r.contact_id === LEAD) ?? null;

describe("the setter's own intro at 15:00: tried at 14:55:10, a video link at 14:55:50, the dialer at 15:00:30", () => {
  test("control: with no room, the intro is back at the top at its booked minute ('Intro call now')", async () => {
    world({ room: false, sinceStart: 30 * S });
    const item = sam(await queue());
    expect(String(item?.why ?? "")).toMatch(/^Intro call now/);
    expect(item?.tier).toBe(0);
  }, 30_000);

  test("control: at 14:58 (inside the intro's five-minute wait) it is not back yet, room or not", async () => {
    world({ room: false, sinceStart: -2 * MIN });
    expect(sam(await queue())).toBeNull();
  }, 30_000);

  test("with the room's link out, the intro still comes back at its booked minute", async () => {
    world({ room: true, sinceStart: 30 * S });
    const item = sam(await queue());
    // Found when it fails: index.ts candidates drops every lead the room
    // holds (rooms.heldSince, lead_by 15:05:50, and longer with an open or
    // a knock), before appointmentWork ranks the intro. The exceptions are a
    // call back or a reply after the link (stress2 round 4); the lead's own
    // booked intro at its booked minute is not one. The lead who booked a
    // phone call at 15:00 gets no call at 15:00: the intro item is gone from
    // the dialer until about 15:06, and comes back only after the room
    // closes as "nobody joined".
    expect(String(item?.why ?? "(not in the queue)")).toMatch(/^Intro call now/);
  }, 30_000);
});
