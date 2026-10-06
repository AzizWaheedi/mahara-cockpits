// bun test supabase/functions/sales-api/m1_numbers_r5_router.test.ts
//
// Milestone 1, video-link round 5, NUMBERS AND RECORDS, through sales-api's
// own doors (index.ts Deno.serve), with the pilot's settings (m1-scope.md
// section 3) and crm_writes on (marks go to HighLevel with its automations,
// as today).
//
// No show-rate number moves because of a room. Round 4c made a person's
// no-show wait for "a lead who knocked on this call's room (a room closed
// admit_blocked or its replacement)" (index.ts videoLinkHoldsNoShow). The
// check reads every room of the LEAD in the last three hours, whatever call
// it was for: a knock the setter could not let in on the morning's intro
// room holds the closer's no-show on a different call (the demo booked
// after it) for up to three hours, with words that blame the knock. The
// demo stays "confirmed", which B2B's show rule ("confirmed or showed counts
// as shown") reads as a show once its time has passed, and HighLevel's
// no-show automation never runs.
//
// The outside world is faked at fetch (as m1_numbers_r4_router.test.ts
// does); nothing leaves this process, every lead and seat is invented.
// A test that fails here is a finding; tests named "control" pass.

import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const COUNTRY = "KW";
const PHONE = "+96550000000";

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1n5r-setter@stress.invalid";
const CLOSER = "stress-m1n5r-closer@stress.invalid";
const INTRO = "stress-m1n5r-intro";
const DEMO = "stress-m1n5r-demo";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85550000005?pwd=sb";
const LEAD = "stress-m1n5r-huda";
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
  await import("./index.ts?m1_numbers_r5_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(who: "closer" | "setter", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer seat-${who}` };
  const res = await handler(new Request("https://fn.stress.invalid/sales-api", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Row };
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/**
 * The morning: the setter's intro at -170 min did not connect, so the setter
 * sent a Meet link. The lead knocked at the Meet door, the setter could not
 * let her in ("I can't let them in": the Meet room ended admit_blocked and a
 * Zoom room was made in its place, night_cleared "replacing"); the lead never
 * reached the Zoom room either, and the sweep closed it. The setter phoned
 * her afterwards, and she booked a demo with the closer at -40 min (a
 * different call, a different rep). She did not come to the demo and did
 * not answer the closer's call. No room was ever made for the demo.
 *
 * `roomsAgo` moves the morning's rooms: 160 (inside the three hours the
 * check reads) or 200 (outside them, the control).
 */
function reset(roomsAgo: number): void {
  db.tables = {};
  ghl.length = 0;
  const old = ago(1);
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
        fallback: { ...((DEFAULT_ROOMS_JSON as Row).fallback as Row), scope: "intro", auto_on_miss: false },
      },
      updated_at: old,
    },
    { key: "live", value: { enabled: false, slack: false }, updated_at: old },
    { key: "followups", value: { enabled: true, agent: false, first_hours: [9, 18] }, updated_at: old },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: COUNTRY, assigned_to: "G-closer", phone: PHONE }]);
  db.seed("cockpit_sales_appointments", [
    {
      appointment_id: INTRO,
      contact_id: LEAD,
      call_type: "intro",
      start_at: ago(roomsAgo + 10),
      status: "showed",
      assigned_user_id: "G-setter",
      calendar_id: "cal-intro",
    },
    {
      appointment_id: DEMO,
      contact_id: LEAD,
      call_type: "demo",
      start_at: ago(40),
      status: "confirmed",
      assigned_user_id: "G-closer",
      calendar_id: "cal-demo",
    },
  ]);
  db.seed("cockpit_sales_rooms", [
    {
      id: "00000000-0000-4000-8000-000000000b51",
      request_id: crypto.randomUUID(),
      code: "N5RM01",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "fallback",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: INTRO,
      state: "ended",
      end_reason: "admit_blocked",
      result: "admit_blocked",
      join_url: MEET_URL,
      requested_at: ago(roomsAgo),
      opened_at: ago(roomsAgo - 1),
      link_sent_at: ago(roomsAgo - 1),
      link_channels: ["email"],
      lead_by: ago(roomsAgo - 11),
      host_in_at: ago(roomsAgo - 2),
      first_open_at: ago(roomsAgo - 3),
      ended_at: ago(roomsAgo - 4),
      version: 6,
    },
    {
      id: "00000000-0000-4000-8000-000000000b52",
      request_id: crypto.randomUUID(),
      code: "N5RZ02",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "fallback",
      call_kind: "intro",
      provider: "zoom",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: INTRO,
      night_cleared: "replacing",
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      join_url: ZOOM_URL,
      provider_meeting_id: "85550000005",
      requested_at: ago(roomsAgo - 4),
      opened_at: ago(roomsAgo - 5),
      link_sent_at: ago(roomsAgo - 5),
      link_channels: ["email"],
      lead_by: ago(roomsAgo - 15),
      host_in_at: ago(roomsAgo - 6),
      ended_at: ago(roomsAgo - 18),
      version: 6,
    },
  ]);
}

const hlNoShows = (id: string) =>
  ghl.filter(c => c.method === "PUT" && c.path.startsWith(`/calendars/events/appointments/${id}`) && (c.body as Row)?.appointmentStatus === "noshow").length;
const demoMarks = () => db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === DEMO && !d.superseded_at);

describe("a knock on one call's room never holds the no-show of another call", () => {
  test("control: the morning's rooms more than three hours ago: the closer marks the demo a no-show, and it reaches HighLevel", async () => {
    reset(200);
    const marked = await call("closer", { action: "mark", appointment_id: DEMO, status: "noshow" });
    expect({ status: marked.status, marks: demoMarks().map(d => d.status), highlevel_noshows: hlNoShows(DEMO) }).toEqual({
      status: 200,
      marks: ["noshow"],
      highlevel_noshows: 1,
    });
  }, 30_000);

  test("the setter's intro room the lead knocked on 160 minutes ago holds the closer's no-show of the demo booked after it", async () => {
    reset(160);
    const marked = await call("closer", { action: "mark", appointment_id: DEMO, status: "noshow" });
    // Found: 409 "Huda knocked on the video room and could not be let in, so
    // the no-show was not marked. Call them, or mark how the call went."
    // The demo is left confirmed (a show by B2B's rule once past), no
    // disposition, no HighLevel no-show, for up to three hours.
    expect({
      status: marked.status,
      said: String(marked.body.error ?? ""),
      marks: demoMarks().map(d => d.status),
      highlevel_noshows: hlNoShows(DEMO),
    }).toEqual({
      status: 200,
      said: "",
      marks: ["noshow"],
      highlevel_noshows: 1,
    });
  }, 30_000);
});
