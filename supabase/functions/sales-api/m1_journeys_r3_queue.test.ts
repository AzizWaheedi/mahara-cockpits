// bun test supabase/functions/sales-api/m1_journeys_r3_queue.test.ts
//
// Milestone 1, video-link round 3, END-TO-END JOURNEYS through the dialer's
// queue (index.ts dial.queue, run end to end through the real handler,
// Deno.serve's function). The outside world is faked at fetch: PostgREST is
// testfakes.ts FakeDb behind the same URLs, the seat check answers a setter.
// The pilot's rooms setting (m1-scope.md section 3). Synthetic only
// (stress-m1j3q-..., ...@stress.invalid); nothing leaves this process.
//
// The journey. The setter's booked intro is at 15:00. The setter rings at
// 15:00:10, nobody answers (Maqsam saves No answer). The setter sends a Meet
// link at 15:00:40; it goes by email at 15:00:50. The setter opens the room
// and presses I'm in at 15:02; Huda knocks, the setter lets her in and
// presses The lead is in at 15:03 (the room's ends_at 15:33). They talk for
// five minutes; Huda has to go and asks to be called back at 15:25 to book
// the demo. The dialer's joined step: Held the intro (15:08), then Set a
// call-back for 15:25 (15:09), then Next lead. Nobody presses Finished on the
// panel (the dialer moved to the next lead and the panel went with it).
//
// A failing test is a finding: its comment says what the setter gets instead.
import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-m1j3q@stress.invalid";
const LEAD = "stress-m1j3q-lead-1";
const APPT = "stress-m1j3q-appt-1";
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

/** The world `sinceStart` after the intro's booked minute (see the journey above). */
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
      name: "Huda Ali",
      phone: "+96550001234",
      phone8: "50001234",
      lead_created_at: iso(start - 3 * 86_400_000),
      stage_id: "s-held",
      stage_name: "Intro held",
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
    // Held the intro at 15:08.
    status: "showed",
    assigned_user_id: "G-setter",
  };
  db.seed("cockpit_sales_calendar", [{ ...appt }]);
  db.seed("cockpit_sales_appointments", [{ ...appt, end_at: iso(start + 30 * MIN), calendar_id: "stress-cal" }]);
  db.seed("cockpit_sales_dials", [
    { call_id: "c-out-1", contact_id: LEAD, lead_phone8: "50001234", occurred_at: iso(start + 10 * S), state: "no_answer", direction: "outbound" },
  ]);
  db.seed("cockpit_sales_attempts", [
    {
      id: "00000000-0000-4000-8000-00000000a301",
      contact_id: LEAD,
      rep_email: SETTER,
      appointment_id: APPT,
      state: "saved",
      outcome: "no_answer",
      item_kind: "intro",
      started_at: iso(start + 10 * S),
      saved_at: iso(start + 30 * S),
      auto_saved: true,
    },
  ]);
  // Set a call-back for 15:25, saved at 15:09 (index.ts dial.save's queue state).
  db.seed("cockpit_sales_queue_state", [
    {
      contact_id: LEAD,
      step: 0,
      due_at: null,
      callback_at: iso(start + 25 * MIN),
      callback_by: SETTER,
      closed: null,
      closed_at: null,
      last_outcome: "callback",
      last_outcome_at: iso(start + 9 * MIN),
      last_rep: SETTER,
      updated_at: iso(start + 9 * MIN),
    },
  ]);
  if (o.room)
    db.seed("cockpit_sales_rooms", [
      {
        id: "00000000-0000-4000-8000-00000000b301",
        request_id: "00000000-0000-4000-8000-00000000c301",
        code: "M1J3QA",
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: APPT,
        appointment_start_at: iso(start),
        attempt_id: "00000000-0000-4000-8000-00000000a301",
        state: "lead_in",
        version: 6,
        join_url: "https://meet.google.com/m1j-3qaa-bcd",
        requested_at: iso(start + 40 * S),
        created_at: iso(start + 40 * S),
        opened_at: iso(start + 45 * S),
        link_claimed_at: iso(start + 46 * S),
        link_sent_at: iso(start + 50 * S),
        link_channels: ["email"],
        host_in_at: iso(start + 2 * MIN),
        lead_in_at: iso(start + 3 * MIN),
        lead_in_seen_at: iso(start + 3 * MIN),
        host_by: iso(start + 15 * MIN + 50 * S),
        lead_by: iso(start + 10 * MIN + 50 * S),
        ends_at: iso(start + 33 * MIN),
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

const huda = (q: Row) => ((q.queue as Row[]) ?? []).find(r => r.contact_id === LEAD) ?? null;

describe("journey r3-q: Huda's intro was had on video (The lead is in at 15:03), held at 15:08, a call-back set for 15:25; nobody pressed Finished", () => {
  test("control: with no room row, at 15:25 Huda is at the top as 'Call back now, as agreed'", async () => {
    world({ room: false, sinceStart: 25 * MIN });
    const item = huda(await queue());
    expect(String(item?.why ?? "(not in the queue)")).toMatch(/^Call back (now|at)/);
  }, 30_000);

  test("with the room still lead_in, the agreed call-back still comes up at 15:25", async () => {
    world({ room: true, sinceStart: 25 * MIN });
    const item = huda(await queue());
    // Found when it fails: index.ts candidates drops every lead a room holds
    // (rooms.heldSince). A lead_in room holds until its no-end-signal time
    // (roomlogic holdUntil: ends_at 15:33 + no_end_signal 30 minutes =
    // 16:03), and only the lead's own missed call or reply, or an intro due,
    // lifts it; the rep's own save after the join does not. Huda's agreed
    // call-back is gone from the dialer from 15:20 (callbackSoon's five
    // minutes ahead) to 16:03, past its ten-minute window: the "Call back
    // now, as agreed" item never shows, and nobody calls her at 15:25.
    expect(String(item?.why ?? "(not in the queue)")).toMatch(/^Call back (now|at)/);
  }, 30_000);

  test("and at 15:35, ten minutes past the agreed time, she is still not offered", async () => {
    world({ room: true, sinceStart: 35 * MIN });
    const item = huda(await queue());
    expect(item).not.toBeNull();
  }, 30_000);
});
