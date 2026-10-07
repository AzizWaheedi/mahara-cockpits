// bun test supabase/functions/sales-api/m1_journeys_r6_queue.test.ts
//
// Milestone 1, video-link round 6, END-TO-END JOURNEYS through the dialer's
// queue (index.ts dial.queue, run end to end through the real handler,
// Deno.serve's function). The outside world is faked at fetch: PostgREST is
// testfakes.ts FakeDb behind the same URLs, the seat check answers a setter.
// The pilot's rooms setting (m1-scope.md section 3). Synthetic only
// (stress-m1j6q-..., ...@stress.invalid); nothing leaves this process.
//
// The journey. Huda's intro is booked at 10:30. The dialer's confirmation
// call rings her at 10:00 (half an hour before, dialer.ts) and nobody
// answers; the setter presses Send a Meet link on the confirm item. Its email
// says "I tried to call you just now and couldn't get through. If you have
// 15 minutes, we can talk on video now". Huda joins at 10:03 and the setter
// has the intro with her on video until 10:20, then saves Confirmed the call
// (the joined step's one button for a confirm item). The room was asked for
// the intro (asked_appointment_id) and, being a confirmation call's, never
// carries it (rooms.ts introNow).
//
// A failing test is a finding: its comment says what the setter gets instead.
import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-m1j6q@stress.invalid";
const LEAD = "stress-m1j6q-lead-1";
const APPT = "stress-m1j6q-appt-1";
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
function world(o: { carries: boolean; sinceStart: number; roomAt?: number }) {
  db.tables = {};
  offset += 30_000;
  const now = Date.now();
  const start = now - o.sinceStart;
  // When the room was asked for, against the intro's start: the
  // confirmation call's, half an hour before (default), or the intro's own.
  const r0 = start + (o.roomAt ?? -30 * MIN);
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
    { call_id: "c-out-1", contact_id: LEAD, lead_phone8: "50001234", occurred_at: iso(start - 30 * MIN), state: "no_answer", direction: "outbound" },
  ]);
  db.seed("cockpit_sales_attempts", [
    {
      id: "00000000-0000-4000-8000-00000000a601",
      contact_id: LEAD,
      rep_email: SETTER,
      appointment_id: APPT,
      state: "saved",
      outcome: "confirmed",
      item_kind: "confirm",
      started_at: iso(start - 30 * MIN),
      saved_at: iso(start - 10 * MIN),
      auto_saved: false,
    },
  ]);
  db.seed("cockpit_sales_confirmations", [{ appointment_id: APPT, result: "confirmed", at: iso(start - 10 * MIN) }]);
  db.seed("cockpit_sales_rooms", [
    {
      id: "00000000-0000-4000-8000-00000000b601",
      request_id: "00000000-0000-4000-8000-00000000c601",
      code: "M1J6QA",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      // A confirmation call's room never carries the intro; the control
      // run carries it, as the intro's own call's room would.
      appointment_id: o.carries ? APPT : null,
      appointment_start_at: o.carries ? iso(start) : null,
      asked_appointment_id: APPT,
      attempt_id: "00000000-0000-4000-8000-00000000a601",
      state: "ended",
      result: "joined",
      end_reason: "finished",
      version: 7,
      join_url: "https://meet.google.com/m1j-6qaa-bcd",
      requested_at: iso(r0 + 40 * S),
      created_at: iso(r0 + 40 * S),
      opened_at: iso(r0 + 45 * S),
      link_claimed_at: iso(r0 + 46 * S),
      link_sent_at: iso(r0 + 50 * S),
      link_channels: ["email"],
      host_in_at: iso(r0 + 2 * MIN),
      lead_in_at: iso(r0 + 3 * MIN),
      lead_in_seen_at: iso(r0 + 3 * MIN),
      host_by: iso(r0 + 16 * MIN),
      lead_by: iso(r0 + 11 * MIN),
      ends_at: iso(r0 + 31 * MIN),
      ended_at: iso(r0 + 20 * MIN),
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

describe("journey r6-1q: Huda had her intro on video at 10:03 in the room her 10:00 confirmation call's link invited her to; at 10:31 the setter opens the dialer", () => {
  test("control: the intro had on video in its own call's room (10:30, joined 10:33), the intro is not offered again as 'Intro call now' at 10:44", async () => {
    world({ carries: true, sinceStart: 14 * MIN, roomAt: 0 });
    const item = huda(await queue());
    if (process.env.R6_SHOW) console.log(JSON.stringify(item));
    expect(String(item?.why ?? "(not in the queue)")).not.toMatch(/intro/i);
  }, 30_000);

  test("the intro Huda had on video in her confirmation call's room is not offered again as 'Intro call now'", async () => {
    world({ carries: false, sinceStart: 1 * MIN });
    const item = huda(await queue());
    if (process.env.R6_SHOW) console.log(JSON.stringify(item));
    // What happens: index.ts candidates reads joins only from rooms with an
    // appointment_id (roomJoins), and a confirmation call's room never has
    // one (it keeps the intro only as asked_appointment_id): Huda comes up
    // at the top as the intro due now, and the setter rings her for the
    // intro she had half an hour ago. A miss here is saved as the intro's
    // No-show (m1_journeys_r6_router.test.ts r6-1b), and with crm_writes
    // that is HighLevel's noshow with toNotify.
    expect(String(item?.why ?? "(not in the queue)")).not.toMatch(/intro/i);
  }, 30_000);
});
