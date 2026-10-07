// bun test supabase/functions/sales-api/m1_numbers_r4_router.test.ts
//
// Milestone 1, video-link round 4, NUMBERS AND RECORDS, through sales-api's
// own doors (index.ts Deno.serve), with the pilot's settings (m1-scope.md
// section 3) and crm_writes on (marks go to HighLevel with its
// automations, as today).
//
// No show-rate number moves because of a room: a person's no-show while the
// lead's video link is out is held (index.ts videoLinkHoldsNoShow, m1 round
// 2, noshow-mark-while-video-link-out): a room open, or one closed in the
// last five minutes after the lead opened its link or knocked. The knock
// check reads the room's raw lead_in_at ("!r.lead_in_at"): a join "That was
// not the lead" took back keeps its time there as evidence, so a room whose
// only join was taken back and whose real lead then knocked in Zoom's
// waiting room (the sweep's R4 close: not_admitted, result admit_blocked)
// holds nothing, and the closer's no-show goes to HighLevel and B2B a minute
// after the lead knocked.
//
// The outside world is faked at fetch (as m1_journeys_r4_router.test.ts
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
const SETTER = "stress-m1n4r-setter@stress.invalid";
const CLOSER = "stress-m1n4r-closer@stress.invalid";
const DEMO = "stress-m1n4r-demo";
const ZOOM_URL = "https://us06web.zoom.us/j/85550000004?pwd=sb";
const LEAD = "stress-m1n4r-huda";
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
  await import("./index.ts?m1_numbers_r4_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(who: "closer", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer seat-${who}` };
  const res = await handler(new Request("https://fn.stress.invalid/sales-api", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Row };
}

const DEMO_START = () => Date.now() - 20 * 60_000;

function reset(o: { takenBack: boolean }): void {
  db.tables = {};
  ghl.length = 0;
  const old = new Date(Date.now() - 60_000).toISOString();
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
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
  db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: COUNTRY, assigned_to: "G-closer", phone: PHONE }]);
  db.seed("cockpit_sales_appointments", [
    {
      appointment_id: DEMO,
      contact_id: LEAD,
      call_type: "demo",
      start_at: new Date(DEMO_START()).toISOString(),
      end_at: new Date(DEMO_START() + 60 * 60_000).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-closer",
      calendar_id: "cal-demo",
    },
  ]);
  // The closer's Zoom room after the missed demo call (the worker makes every
  // meeting with the waiting room on for people outside the account): with
  // takenBack, someone knocked at -10 min (lead_waiting_at keeps the first
  // knock only), was let in at -9 min (Zoom's join, lead_in), and the closer
  // pressed That was not the lead at -8 min. The real lead knocked at -3 min
  // and was never let in; the sweep closed the room a minute ago (R4
  // not_admitted, result admit_blocked). The control: the lead knocked at
  // -10 min and was never let in.
  db.seed("cockpit_sales_rooms", [
    {
      id: "00000000-0000-4000-8000-000000000a41",
      request_id: crypto.randomUUID(),
      code: "N4RZ01",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "fallback",
      call_kind: "demo",
      provider: "zoom",
      host_email: CLOSER,
      made_by: CLOSER,
      state: "expired",
      end_reason: "not_admitted",
      result: "admit_blocked",
      join_url: ZOOM_URL,
      provider_meeting_id: "85550000004",
      requested_at: ago(16),
      opened_at: ago(15),
      link_sent_at: ago(14),
      link_channels: ["email"],
      host_in_at: ago(12),
      lead_waiting_at: ago(10),
      ended_at: ago(1),
      version: 7,
      ...(o.takenBack ? { lead_in_at: ago(9), lead_in_seen_at: ago(9), count_undo_at: ago(8), taken_back_join_at: ago(9) } : {}),
    },
  ]);
}

const hlNoShows = () =>
  ghl.filter(c => c.method === "PUT" && c.path.startsWith(`/calendars/events/appointments/${DEMO}`) && (c.body as Row)?.appointmentStatus === "noshow").length;

describe("a no-show a minute after the lead knocked at the video room is held", () => {
  test("control: the lead knocked in Zoom's waiting room and the room closed a minute ago: the closer's no-show is held", async () => {
    reset({ takenBack: false });
    const marked = await call("closer", { action: "mark", appointment_id: DEMO, status: "noshow" });
    expect(marked.status).toBe(409);
    // Since m1 round 4 a room closed on the lead's knock (admit_blocked) holds it with the knock's own words.
    expect(String(marked.body.error ?? "")).toMatch(/(knocked on the video room and could not be let in|opened the video link a few minutes ago), so the no-show was not marked/);
    expect(hlNoShows()).toBe(0);
  }, 30_000);

  test("the same knock on a room whose only join was taken back (That was not the lead): the no-show is held too, never sent to HighLevel and B2B", async () => {
    reset({ takenBack: true });
    const marked = await call("closer", { action: "mark", appointment_id: DEMO, status: "noshow" });
    const said = String(marked.body.error ?? "");
    expect({ status: marked.status, held: /so the no-show was not marked/.test(said), highlevel_noshows: hlNoShows(), dispositions: db.t("cockpit_sales_dispositions").length }).toEqual({
      status: 409,
      held: true,
      highlevel_noshows: 0,
      dispositions: 0,
    });
  }, 30_000);
});
