// bun test supabase/functions/sales-api/stress2_journeys_r4_queue.test.ts
//
// Stress series 2, round 4, journeys: the dialer's queue (index.ts dial.queue,
// run end to end through the real handler, Deno.serve's function) while a
// lead's video room is open. The outside world is faked at fetch: PostgREST
// is testfakes.ts FakeDb behind the same URLs, the seat check answers a
// setter. Synthetic only; nothing leaves this process.
//
// The journey. 14:00 the setter rings a new lead; nobody answers (Maqsam saves
// No answer). The setter sends a Meet link (P1) and presses Next lead: the
// lead's room is open and holds the lead out of the queue until its deadline
// (C6, roomlogic roomHolds: lead_by, 10 minutes after the link, plus the open
// grace). 14:02 the lead, who would rather talk on the phone, rings back. The
// setter is on another lead's call, so the call is missed (Maqsam
// "abandoned"). The call centre's rule for that is the queue's tier 1, "Called
// us, missed it", at the top of the dialer (tier 0) with its own urgent strip.
//
// A failing test is a finding: its comment says what the rep sees instead.
import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-r4j@stress.invalid";
const LEAD = "stress-r4j-lead-1";
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
    // The day's stats (index.ts today) read with an or= filter the fake does
    // not parse; they do not decide the queue, so the filter is dropped.
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

const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

// index.ts keeps its heavy reads (leads, calls, the calendar) for 20 s
// (HEAVY_FOR): each world starts half a minute after the last, so no test
// reads the one before's rows.
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

/** The world at 14:02: the setter's missed call at 13:56, the link at 13:57, the lead's call back a minute ago. */
function world(o: { room: boolean; wrote?: boolean }) {
  db.tables = {};
  offset += 30_000;
  const now = Date.now();
  db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        fallback: { scope: "any", auto_on_miss: false, pilot_emails: [] },
      },
    },
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
      lead_created_at: iso(now - 30 * MIN),
      stage_id: "s-new",
      stage_name: "New lead",
      pipeline_id: "p-sales",
      lead_class: "qualified",
      dnd: false,
      contact_type: "lead",
      assigned_to: "G-setter",
      tags: ["roas-qualified"],
    },
  ]);
  db.seed("cockpit_sales_dials", [
    // The setter's call nobody answered, six minutes ago.
    { call_id: "c-out-1", contact_id: LEAD, lead_phone8: "50001234", occurred_at: iso(now - 6 * MIN), state: "no_answer", direction: "outbound" },
    // The lead's call back a minute ago: nobody picked up (Maqsam "abandoned").
    ...(o.wrote
      ? []
      : [{ call_id: "c-in-1", contact_id: LEAD, lead_phone8: "50001234", occurred_at: iso(now - MIN), state: "abandoned", direction: "inbound" }]),
  ]);
  // Or, instead of ringing, the lead wrote on WhatsApp a minute ago ("can you call me instead?").
  if (o.wrote)
    db.seed("cockpit_sales_inbox", [
      { conversation_id: "conv-r4j-1", contact_id: LEAD, last_message_at: iso(now - MIN), last_direction: "inbound", inbound_whatsapp_at: iso(now - MIN) },
    ]);
  db.seed("cockpit_sales_attempts", [
    {
      id: "00000000-0000-4000-8000-00000000a001",
      contact_id: LEAD,
      rep_email: SETTER,
      state: "saved",
      outcome: "no_answer",
      item_kind: "lead",
      started_at: iso(now - 6 * MIN),
      saved_at: iso(now - 5 * MIN),
      auto_saved: true,
    },
  ]);
  db.seed("cockpit_sales_queue_state", [
    { contact_id: LEAD, step: 1, last_outcome: "no_answer", last_outcome_at: iso(now - 5 * MIN), due_at: iso(now + 3 * 3_600_000) },
  ]);
  if (o.room)
    db.seed("cockpit_sales_rooms", [
      {
        id: "00000000-0000-4000-8000-00000000b001",
        request_id: "00000000-0000-4000-8000-00000000c001",
        code: "K7Q2MX",
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        made_by: SETTER,
        state: "open",
        version: 3,
        join_url: "https://meet.google.com/abc-defg-hij",
        requested_at: iso(now - 5 * MIN),
        created_at: iso(now - 5 * MIN),
        opened_at: iso(now - 5 * MIN + 20_000),
        link_claimed_at: iso(now - 5 * MIN + 21_000),
        link_sent_at: iso(now - 5 * MIN + 25_000),
        link_channels: ["whatsapp_text"],
        host_by: iso(now + 10 * MIN),
        lead_by: iso(now + 5 * MIN),
        ends_at: iso(now + 25 * MIN),
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

describe("journey: a missed call, a Meet link, Next lead; the lead rings back while the room is open", () => {
  test("control: with no room open, the lead's call back is at the top of the queue as 'Called us, missed it'", async () => {
    world({ room: false });
    const item = huda(await queue());
    expect(item?.why).toBe("Called us, missed it");
    // Tier 0: the top of the queue (dial now).
    expect(item?.tier).toBe(0);
  }, 30_000);

  test("with the room open, the lead's call back must still reach the setter (the queue's missed-call tier)", async () => {
    world({ room: true });
    const q = await queue();
    const item = huda(q);
    // index.ts candidates drops every lead rooms.held(now) names before it
    // ranks anything (`!roomHeld.has(contact_id)`), so the lead who just rang
    // back is not in the queue at all, nor in its urgent strip, for as long
    // as the room's deadline holds (up to 13 minutes: lead_by plus the open
    // grace). The setter's banner says "Video room: Huda, 4:40 left."; the
    // setter waits for a video join, the lead waits for a call back.
    expect(item?.why ?? null).toBe("Called us, missed it");
  }, 30_000);

  test("control: with no room open, a WhatsApp reply a minute ago puts the lead at the top as 'Wrote back minutes ago'", async () => {
    world({ room: false, wrote: true });
    const item = huda(await queue());
    expect(item?.why).toBe("Wrote back minutes ago");
  }, 30_000);

  test("with the room open, the lead's WhatsApp reply ('can you call me instead?') must still reach the setter", async () => {
    world({ room: true, wrote: true });
    const item = huda(await queue());
    // The same drop: held, the lead is not in the queue at all.
    expect(item?.why ?? null).toBe("Wrote back minutes ago");
  }, 30_000);
});
