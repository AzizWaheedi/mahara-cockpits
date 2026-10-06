// bun test supabase/functions/sales-api/m1_journeys_r4x_router.test.ts
//
// Milestone 1, video-link round 4, journeys through sales-api's own doors
// (index.ts Deno.serve), with the pilot's settings (m1-scope.md section 3):
// rooms on for the test contact, Meet and Zoom on, every send channel on,
// the WhatsApp gate shut (the link goes by email), short link off, settle,
// wrap and count_on_join off, live handover and followups.agent off, and
// crm_writes on (marks go to HighLevel with its automations, as today).
//
// The setter's booked intro rings out; the setter presses Send a Meet link
// (room.create, the seat's session), the room worker opens the room and
// tells sales-api (room.event worker.ready, the desk's service key), and
// sales-api's own message service emails the link through HighLevel. Then
// the setter works the dialer's step under the room panel.
//
// The outside world is faked at fetch (as m1_fence_router.test.ts does);
// nothing leaves this process, every lead and seat is invented.

import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { hoursRefusal } from "./sendrules.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

/**
 * A country where it is day now and in ten minutes (a manual room's link
 * keeps the lead's 09:00 to 21:00), with a number on its clock (m1 round 3:
 * a Gulf number's own clock comes first).
 */
const COUNTRY =
  ["KW", "GB", "US", "BR", "JP", "AU", "NZ", "IN", "DE", "MX"].find(
    c =>
      hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now(), followups: {} }) === null &&
      hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now() + 10 * 60_000, followups: {} }) === null,
  ) ?? "KW";
const PHONE = COUNTRY === "KW" ? "+96550000000" : "+447700900123";

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1j4xr-setter@stress.invalid";
const CLOSER = "stress-m1j4xr-closer@stress.invalid";
const DEMO = "stress-m1j4xr-demo";
const ZOOM_URL = "https://us06web.zoom.us/j/85550000004?pwd=sb";
const LEAD = "stress-m1j4xr-huda";
const APPT = "stress-m1j4xr-intro";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghl: { method: string; path: string; body: unknown }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
  "seat-closer": { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let sentMessages = 0;
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (/^[^.]+\.[^.]+\.sig$/.test(token) && !SEATS[token]) return reply({ signed_in: false });
    return SEATS[token] ? reply(SEATS[token]) : reply({ message: "JWT invalid" }, 401);
  }
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    const path = url.slice(`${DB}/rest/v1/`.length);
    const prefer = headers.get("prefer") ?? "";
    try {
      const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    ghl.push({ method, path, body });
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}`) && !path.includes("/appointments"))
      return reply({
        contact: {
          id: LEAD,
          firstName: "Huda",
          name: "Huda Ali",
          phone: PHONE,
          email: "huda@stress.invalid",
          country: COUNTRY,
          tags: ["roas-qualified"],
          dnd: false,
          dndSettings: {},
        },
      });
    if (method === "GET" && path.includes("/appointments")) return reply({ events: [] });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      sentMessages++;
      return reply({ messageId: `m-${sentMessages}`, conversationId: "c-1", status: "sent" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) return reply({ message: { id: path.split("/").pop(), status: "delivered" } });
    return reply({ ok: true });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-stress",
    SUPABASE_ANON_KEY: "anon-stress",
    SALES_GHL_TOKEN: "ghl-stress",
    CRON_SECRET: CRON,
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?m1_journeys_r4x_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

function serviceToken(): string {
  const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
}

async function call(who: "setter" | "closer" | "desk", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.authorization = who === "desk" ? `Bearer ${serviceToken()}` : `Bearer seat-${who}`;
  const res = await handler(new Request("https://fn.stress.invalid/sales-api", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Row };
}

/** The pilot's settings (m1-scope.md section 3), with the intro booked at `start`. */
function reset(start: number): void {
  db.tables = {};
  ghl.length = 0;
  const old = new Date(Date.now() - 60_000).toISOString();
  db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        count_on_join: false,
        settle: false,
        wrap: false,
        short_link: false,
        fallback: { ...(DEFAULT_ROOMS_JSON as Row).fallback as Row, scope: "intro", auto_on_miss: false },
      },
      updated_at: old,
    },
    { key: "live", value: { enabled: false, slack: false, standby: true }, updated_at: old },
    { key: "followups", value: { enabled: true, agent: false, first_hours: [9, 18] }, updated_at: old },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
  ]);
  db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "basic", google_ok: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: COUNTRY, assigned_to: "G-setter", phone: PHONE }]);
  db.seed("cockpit_sales_appointments", [
    {
      appointment_id: APPT,
      contact_id: LEAD,
      call_type: "intro",
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 30 * 60_000).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-setter",
      calendar_id: "cal-intro",
    },
  ]);
}

const markWrites = () => ghl.filter(g => g.method === "PUT" && g.path.startsWith("/calendars/events/appointments/"));

/** A closed room of Huda's, as 20261004a's close and room.end leave it. */
function seedRoom(r: Row): string {
  const id = crypto.randomUUID();
  db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: crypto.randomUUID(),
      code: `K${String(Math.floor(Math.random() * 1e5)).padStart(5, "2")}`.slice(0, 6),
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "fallback",
      call_kind: "intro",
      host_email: SETTER,
      made_by: SETTER,
      version: 4,
      link_channels: ["email"],
      ...r,
    },
  ]);
  return id;
}

const iso = (t: number) => new Date(t).toISOString();

describe("journey r4x-2 through index.ts: Huda knocked on the Meet room at 10:03, I can't let them in moved her to Zoom, the Zoom room closed at 10:14 with nobody in it; at 10:15 the setter presses the panel's No-show", () => {
  test("the no-show of a lead who knocked on this call's Meet room is not written to HighLevel", async () => {
    const T = Date.now() - 15 * 60_000; // 10:00
    reset(T);
    const meet = seedRoom({
      provider: "meet",
      state: "cancelled",
      result: "admit_blocked",
      appointment_id: APPT,
      requested_at: iso(T + 40_000),
      created_at: iso(T + 40_000),
      opened_at: iso(T + 40_000),
      link_sent_at: iso(T + 40_000),
      host_in_at: iso(T + 70_000),
      ended_at: iso(T + 210_000),
      join_url: "https://meet.google.com/abc-defg-hij",
    });
    void meet;
    seedRoom({
      provider: "zoom",
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      error: "Closed: the lead did not join in 10 minutes.",
      appointment_id: APPT,
      night_cleared: "replacing",
      requested_at: iso(T + 211_000),
      created_at: iso(T + 211_000),
      opened_at: iso(T + 215_000),
      link_sent_at: iso(T + 216_000),
      host_in_at: iso(T + 250_000),
      lead_by: iso(T + 216_000 + 600_000),
      ended_at: iso(T + 14 * 60_000),
      join_url: "https://us06web.zoom.us/j/85550000009?pwd=sb",
    });
    const before = markWrites().length;
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    // What happens: 200, and HighLevel's appointment is PUT as noshow (its
    // automation then writes to Huda), twelve minutes after she came to her
    // intro and knocked: index.ts holds a no-show for five minutes after a
    // room closed on a knock (NOSHOW_AFTER_KNOCK_MS), and the Zoom room that
    // replaced the knocked one carries no knock of its own.
    expect({ status: marked.status, wrote: markWrites().length - before }).toEqual({ status: 409, wrote: 0 });
  }, 30_000);
});

describe("journey r4x-5 through index.ts: the setter's Zoom link went by email at 10:00:40 ('I'll wait for you for the next 10 minutes'); End room at 10:01:30; No-show at 10:01:35", () => {
  test("a no-show five seconds after a person ended the room, inside the lead's promised ten minutes, is not written to HighLevel", async () => {
    const now = Date.now();
    const T = now - 95_000; // 10:00
    reset(T);
    seedRoom({
      provider: "zoom",
      state: "ended",
      result: "no_join",
      appointment_id: APPT,
      requested_at: iso(T + 30_000),
      created_at: iso(T + 30_000),
      opened_at: iso(T + 38_000),
      link_sent_at: iso(T + 40_000),
      lead_by: iso(T + 40_000 + 600_000),
      host_by: iso(T + 40_000 + 900_000),
      ended_at: iso(T + 90_000),
      join_url: "https://us06web.zoom.us/j/85550000011?pwd=sb",
    });
    const before = markWrites().length;
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    // What happens: 200 and HighLevel's appointment PUT as noshow, 55
    // seconds after the email told Huda the setter would wait ten minutes.
    expect({ status: marked.status, wrote: markWrites().length - before }).toEqual({ status: 409, wrote: 0 });
  }, 30_000);
});
