// bun test supabase/functions/sales-api/m1_time_r6_router.test.ts
//
// Milestone 1, video-link round 6, the TIME angle through sales-api's own
// doors (index.ts Deno.serve) and the dialer's own rule for its outcome
// grid (apps/sales-cockpit/src/lib/rooms.ts noShowHold), with the pilot's
// settings (m1-scope.md section 3): rooms on for the test contact, Meet and
// Zoom on, every send channel on, the WhatsApp gate shut, short link off,
// settle, wrap and count_on_join off, live handover and followups.agent off,
// crm_writes on.
//
// The lead's ten minutes (lead_by) one second either side, for a link the
// room never sent: since m1 round 5 (m1-time-r5-final-refusal-ten-minutes-
// cut-by-host-wait) a final refusal starts the lead's ten minutes for the
// rep's own delivery (rooms.ts startLeadWait: lead_by with no link_sent_at).
// Does the dialer's "Didn't show" agree with sales-api's mark while those ten
// minutes run, and is the sentence the grid shows true?
//
// The outside world is faked at fetch (as m1_journeys_r5_router.test.ts
// does); nothing leaves this process, every lead and seat is invented.

import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { applyRoomEvent, DEFAULT_ROOMS_JSON, roomCtx, roomsSetting } from "./roomlogic.ts";
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
const SETTER = "stress-m1t6r-setter@stress.invalid";
const CLOSER = "stress-m1t6r-closer@stress.invalid";
const DEMO = "stress-m1t6r-demo";
const ZOOM_URL = "https://us06web.zoom.us/j/85550000004?pwd=sb";
const LEAD = "stress-m1t6r-huda";
const APPT = "stress-m1t6r-intro";
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

// The dialer's own rule for its outcome grid (apps/sales-cockpit/src/lib/rooms.ts noShowHold).
const COCKPIT = new URL("../../../apps/sales-cockpit/src/lib/", import.meta.url).pathname;
mock.module(`${COCKPIT}supabase.ts`, () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
type Ui = { normalizeRoom: (v: unknown) => unknown; noShowHold: (room: unknown, now: number) => string | null };
let ui: Ui;

beforeAll(async () => {
  ui = (await import(`${COCKPIT}rooms.ts`)) as unknown as Ui;
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
  await import("./index.ts?m1_time_r6_router");
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


/**
 * The dialer's outcome grid for an intro item (DialerPage CallPane
 * `outcomes`): every intro outcome, No-show taken out while the lead's video
 * room is open (`video.open`, the room on show not final) and, since m1
 * round 5, while the closed room still holds it (lib/rooms.ts noShowHold:
 * the wait its link promised, or a knock nobody could answer).
 */
function dialerOffersNoShow(room: Row): boolean {
  if (!["failed", "expired", "ended", "cancelled"].includes(String(room.state))) return false;
  return ui.noShowHold(ui.normalizeRoom({ ...room, link_channels: room.link_channels ?? [] }), Date.now()) === null;
}

const roomRow = (id: string) => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

/** The grid's own sentence for the room (noShowHold), or null when it offers Didn't show. */
function gridSays(room: Row): string | null {
  return ui.noShowHold(ui.normalizeRoom({ ...room, link_channels: room.link_channels ?? [] }), Date.now());
}

const FINAL = "HighLevel did not take the link in 10 minutes (HighLevel said 429: Too Many Requests).";

describe("Huda's 10:00 intro: the setter's Meet link at 10:01 was never taken by HighLevel; at 10:12 sales-api said it final ('Copy the link and send it another way') and started the rep's ten minutes (lead_by 10:22); the setter ended the room at 10:12:30 and at 10:13 saves the intro in the dialer", () => {
  test("control: a room whose link went by email at 10:12 (lead_by 10:22), ended at 10:12:30: the grid holds Didn't show and sales-api refuses it alike", async () => {
    const now = Date.now();
    const T = now - 13 * 60_000; // 10:00
    reset(T);
    const id = seedRoom({
      provider: "meet",
      state: "ended",
      result: "no_join",
      end_reason: "end",
      appointment_id: APPT,
      requested_at: iso(T + 60_000),
      created_at: iso(T + 60_000),
      opened_at: iso(T + 66_000),
      link_claimed_at: iso(T + 66_000),
      link_sent_at: iso(T + 12 * 60_000),
      link_channels: ["email"],
      lead_by: iso(T + 22 * 60_000),
      host_by: iso(T + 25 * 60_000),
      ended_at: iso(T + 12 * 60_000 + 30_000),
      join_url: MEET_URL,
    });
    const said = gridSays(roomRow(id));
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    if (process.env.R6_SHOW) console.log(JSON.stringify({ said, marked }));
    expect({ grid_holds: said !== null, status: marked.status }).toEqual({ grid_holds: true, status: 409 });
  }, 30_000);

  test("the link the room never sent: the grid and sales-api agree on Didn't show, and the grid never says a video link told Huda anything", async () => {
    const now = Date.now();
    const T = now - 13 * 60_000; // 10:00
    reset(T);
    const id = seedRoom({
      provider: "meet",
      state: "ended",
      result: "no_join",
      end_reason: "end",
      appointment_id: APPT,
      requested_at: iso(T + 60_000),
      created_at: iso(T + 60_000),
      opened_at: iso(T + 66_000),
      link_claimed_at: iso(T + 66_000),
      link_sent_at: null,
      link_channels: [],
      refusal: FINAL,
      // rooms.ts startLeadWait at the 10:12:00 re-ask: now + the lead's wait.
      lead_by: iso(T + 22 * 60_000),
      host_by: iso(T + 16 * 60_000 + 6_000),
      ended_at: iso(T + 12 * 60_000 + 30_000),
      join_url: MEET_URL,
    });
    const said = gridSays(roomRow(id));
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    if (process.env.R6_SHOW) console.log(JSON.stringify({ said, marked }));
    // Found when it fails: the cockpit's promisedWaitAhead (lib/rooms.ts)
    // reads lead_by alone, so since round 5's startLeadWait a link that
    // never went holds Didn't show in the dialer's grid (and the lead page's
    // Mark this call) until lead_by, saying "The video link told Huda the
    // room would wait until 10:22, so Didn't show waits until then", above
    // a panel that says the link never reached her; sales-api's
    // videoLinkHoldsNoShow holds a promise only for a link that went
    // (link_sent_at), so the same no-show pressed from anywhere else is
    // marked at once.
    expect({
      grid_holds: said !== null,
      server_holds: marked.status === 409,
      says_link_told: /video link told/i.test(String(said ?? "")),
    }).toEqual({ grid_holds: marked.status === 409, server_holds: marked.status === 409, says_link_told: false });
  }, 30_000);
});

describe("Huda's 10:00 intro: the setter's Zoom link went by email at 10:01:10 (lead_by 10:11:10); the sweep's 10:12:00 run closed the room as the lead's no-show; Huda reached Zoom's waiting room at 10:12:20, one grace inside the close (rooms keep that knock: roomlogic lateKnock); at 10:13 the setter saves the intro in the dialer", () => {
  function knockedAfterClose(knockAt: number | null) {
    const now = Date.now();
    const T = now - 13 * 60_000; // 10:00
    reset(T);
    const id = seedRoom({
      provider: "zoom",
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      appointment_id: APPT,
      requested_at: iso(T + 60_000),
      created_at: iso(T + 60_000),
      opened_at: iso(T + 66_000),
      link_claimed_at: iso(T + 66_000),
      link_sent_at: iso(T + 70_000),
      link_channels: ["email"],
      lead_by: iso(T + 70_000 + 600_000),
      host_by: iso(T + 70_000 + 780_000),
      ended_at: iso(T + 12 * 60_000),
      lead_waiting_at: knockAt === null ? null : iso(knockAt),
      provider_meeting_id: "85550000006",
      join_url: ZOOM_URL,
    });
    return { id, T };
  }

  test("setup: Zoom's waiting-room knock 20 s after the timer's close is kept on the closed room (roomlogic lateKnock)", () => {
    const now = Date.now();
    const { id, T } = knockedAfterClose(null);
    const knock = T + 12 * 60_000 + 20_000;
    const out = applyRoomEvent(
      roomRow(id) as never,
      { kind: "lead_waiting", at: iso(knock) },
      now,
      roomCtx(roomsSetting(DEFAULT_ROOMS_JSON)),
    ) as Row;
    expect({ ok: out.ok, lead_waiting_at: (out.patch as Row | undefined)?.lead_waiting_at ?? null }).toEqual({
      ok: true,
      lead_waiting_at: iso(knock),
    });
  });

  test("control: nobody knocked: the grid offers Didn't show and sales-api marks it", async () => {
    const { id } = knockedAfterClose(null);
    const said = gridSays(roomRow(id));
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    expect({ grid_offers: said === null, status: marked.status }).toEqual({ grid_offers: true, status: 200 });
  }, 30_000);

  test("Huda knocked 20 s after the close: the dialer's grid never offers a Didn't show sales-api refuses", async () => {
    const now = Date.now();
    const { id } = knockedAfterClose(now - 13 * 60_000 + 12 * 60_000 + 20_000);
    const said = gridSays(roomRow(id));
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    if (process.env.R6_SHOW) console.log(JSON.stringify({ said, marked }));
    // Found when it fails: the cockpit's roomHoldsNoShow (lib/rooms.ts,
    // round 5's noShowHold) holds for an open room, a knock nobody could
    // answer (admit_blocked, moved_from) and the link's promised wait, but
    // not for sales-api's own five minutes after a room closed on a knock
    // or an open (index.ts videoLinkHoldsNoShow, NOSHOW_AFTER_KNOCK_MS):
    // a knock a few seconds after the timer's close (kept by lateKnock, the
    // panel above says they knocked and to call them now) leaves Didn't
    // show in the grid, and every press of it is refused 409 for five
    // minutes ("Huda opened the video link a few minutes ago, so the
    // no-show was not marked.").
    expect({ grid_offers: said === null, status: marked.status }).toEqual(
      said === null ? { grid_offers: true, status: 200 } : { grid_offers: false, status: marked.status },
    );
  }, 30_000);
});
