// bun test supabase/functions/sales-api/m1_chaos_r4_router.test.ts
//
// Milestone 1, video-link round 4, chaos through sales-api's own doors
// (index.ts Deno.serve) with its real message service (convoSend), with the
// pilot's settings (m1-scope.md section 3): rooms on for the test contact,
// Meet and Zoom on, every send channel on, the WhatsApp gate shut (the link
// goes by email), short link off, settle, wrap and count_on_join off, live
// handover and followups.agent off.
//
// HighLevel blinks once at the step that sends the closer's Zoom link by
// email: its gateway answers the send 400 (the "Version header is not valid"
// page HighLevel's own deploys answer, which rooms.ts already reads as
// "says nothing about the contact"), or its contact read answers a JSON 200
// with no contact in it. The room then says "Not sent", and the cockpit's
// panel tells the closer to copy the link and send it another way (a Zoom
// link with its passcode cannot be read out). The closer does. A minute
// later the sweep's re-ask sends the room's own email anyway, on the lane's
// next key: the lead gets the link twice.
//
// The outside world is faked at fetch (as m1_journeys_r2_router.test.ts
// does); the clock is moved by a Date that runs ahead when the test says a
// minute passed. Nothing leaves this process; every lead, seat and link is
// invented (stress-..., @stress.invalid).

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

// ---- a clock the test can move forward ----------------------------------
const before = {
  fetch: globalThis.fetch,
  deno: (globalThis as unknown as { Deno?: unknown }).Deno,
  edge: (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime,
};
const RealDate = Date;
let skew = 0;
class MovableDate extends RealDate {
  constructor(...a: unknown[]) {
    if (a.length === 0) super(RealDate.now() + skew);
    else super(...(a as [string]));
  }
  static override now(): number {
    return RealDate.now() + skew;
  }
}
(globalThis as unknown as { Date: DateConstructor }).Date = MovableDate as unknown as DateConstructor;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const CLOSER = "stress-m1c4r-closer@stress.invalid";
const LEAD = "stress-m1c4r-huda";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=QmFzZTY0c3RyZXNz";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghl: { method: string; path: string; body: unknown; took?: boolean }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;
const pending: Promise<unknown>[] = [];

const SEATS: Record<string, Row> = {
  "seat-closer": { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ---- HighLevel's chaos knobs ----------------------------------------------
/** Answers for the next POST /conversations/messages, in order ("ok" when empty). */
let sendScript: ("ok" | "deploy400")[] = [];
/** The message service's own contact read (right after its leads read) answers a 200 with no contact. */
let garbleServiceContactRead = 0;
let armContactGarble = false;
/** The link's own contact read (rooms.ts sendLinkHeld, the second contact read of the journey) answers 503 once. */
let blinkLinkContactRead = false;
let contactReads = 0;
let sent = 0;

const CONTACT = {
  id: LEAD,
  firstName: "Huda",
  name: "Huda Ali",
  phone: "+96550000000",
  email: "huda@stress.invalid",
  country: "KW",
  tags: ["roas-qualified"],
  dnd: false,
  dndSettings: {},
};

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
    // The message service's own lead read (convoSendOnce): its next contact read is the one that blinks.
    if (method === "GET" && path === `cockpit_sales_leads?contact_id=eq.${LEAD}&select=contact_id,name` && garbleServiceContactRead > 0) {
      garbleServiceContactRead--;
      armContactGarble = true;
    }
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
    const call = { method, path, body, took: undefined as boolean | undefined };
    ghl.push(call);
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}`) && !path.includes("/appointments")) {
      contactReads++;
      // The first read is room.create's; the second is the link's own (sendLinkHeld).
      if (blinkLinkContactRead && contactReads === 2) return reply({ message: "Service Unavailable" }, 503);
      if (armContactGarble) {
        armContactGarble = false;
        // A JSON 200 with no contact in it (HighLevel's contact service
        // blinking behind its gateway); rooms.ts reads this as "not answered".
        return reply({ traceId: "stress-trace-1" });
      }
      return reply({ contact: CONTACT });
    }
    if (method === "GET" && path.includes("/appointments")) return reply({ events: [] });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      const next = sendScript.shift() ?? "ok";
      if (next === "deploy400") {
        call.took = false;
        return reply({ statusCode: 400, message: "Version header is not valid" }, 400);
      }
      call.took = true;
      sent++;
      return reply({ messageId: `m-${sent}`, conversationId: "c-1", status: "sent" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) return reply({ message: { id: path.split("/").pop(), status: "delivered" } });
    return reply({ ok: true });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

// The cockpit's own words for the room (apps/sales-cockpit/src/lib/rooms.ts).
const COCKPIT = new URL("../../../apps/sales-cockpit/src/lib/", import.meta.url).pathname;
mock.module(`${COCKPIT}supabase.ts`, () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
type Ui = {
  normalizeRoom: (v: unknown) => unknown;
  roomSentence: (room: unknown, ctx: { now: number }) => unknown;
  sentenceText: (s: unknown) => string;
};
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
  // waitUntil, so the test can wait for the link's background send.
  (globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?m1_chaos_r4_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime = before.edge;
  (globalThis as unknown as { Date: DateConstructor }).Date = RealDate;
});

function serviceToken(): string {
  const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
}

async function call(who: "closer" | "desk", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.authorization = who === "closer" ? "Bearer seat-closer" : `Bearer ${serviceToken()}`;
  const res = await handler(new Request("https://fn.stress.invalid/sales-api", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Row };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 20 && pending.length; i++) await Promise.allSettled(pending.splice(0));
}

function reset(): void {
  db.tables = {};
  ghl.length = 0;
  sendScript = [];
  garbleServiceContactRead = 0;
  armContactGarble = false;
  blinkLinkContactRead = false;
  contactReads = 0;
  sent = 0;
  pending.length = 0;
  // 11:00 in Kuwait on a Monday: no night rule.
  skew = Date.parse("2026-10-05T08:00:00Z") - RealDate.now();
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
        fallback: { ...((DEFAULT_ROOMS_JSON as Row).fallback as Row), scope: "intro", auto_on_miss: false },
      },
      updated_at: old,
    },
    { key: "live", value: { enabled: false, slack: false, standby: true }, updated_at: old },
    { key: "followups", value: { enabled: true, agent: false, first_hours: [9, 18] }, updated_at: old },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
  ]);
  db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
  db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-closer", phone: "+96550000000" }]);
}

/** The room worker on the VPS: claim, store worker.ready, open the room with a Zoom meeting, then tell sales-api. */
async function workerOpens(id: string): Promise<{ status: number; body: Row }> {
  const room = () => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: new Date().toISOString(), worker_run: "run-1", version: Number(room().version) + 1 },
  });
  await db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made on Zoom in 4.2 s." },
    prefer: "resolution=ignore-duplicates",
  });
  await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: ZOOM_URL,
      provider_meeting_id: "85012345678",
      opened_at: new Date().toISOString(),
      host_by: new Date(Date.now() + 15 * 60_000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      version: Number(room().version) + 1,
    },
  });
  return await call("desk", { action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
}

/** The closer's Send a video link on the lead page (purpose manual, Zoom: the closer's default). */
async function sendZoomLink(): Promise<string> {
  const press = await call("closer", {
    action: "room.create",
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "demo",
    purpose: "manual",
  });
  expect(press.status).toBe(200);
  const id = String((press.body.room as Row).id);
  const ready = await workerOpens(id);
  expect(ready.status).toBe(200);
  await drain();
  return id;
}

/** A minute on the sweep's clock, then the cron's tick for the room (pg_cron, sales-live/cron, room.event tick). */
async function minute(id: string): Promise<void> {
  skew += 61_000;
  const out = await call("desk", { action: "room.event", kind: "tick", payload: { room_ids: [id] } });
  expect(out.status).toBe(200);
  await drain();
}

const room = (id: string) => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
/** Every message to the lead that carries the room's link (HighLevel's send calls that went through). */
const linkMessages = () =>
  ghl.filter(g => g.method === "POST" && g.path === "/conversations/messages" && g.took && JSON.stringify(g.body ?? {}).includes("85012345678"));

describe("m1 chaos r4: HighLevel blinks once at the link's email, the room says Not sent, and the re-ask sends it on top of the closer's own", () => {
  test("HELD: with no blip the Zoom link goes once by email", async () => {
    reset();
    const id = await sendZoomLink();
    for (let i = 0; i < 3; i++) await minute(id);
    expect({ sent: Boolean(room(id).link_sent_at), messages: linkMessages().length }).toEqual({ sent: true, messages: 1 });
  }, 60_000);

  for (const [blip, arm] of [
    ["HighLevel's gateway answers the send 400 (Version header is not valid, as during its deploy)", () => (sendScript = ["deploy400"])],
    ["the message service's contact read answers a JSON 200 with no contact in it", () => (garbleServiceContactRead = 1)],
    // The room says "HighLevel did not answer, so the link has not gone yet. It is tried again in a minute.",
    // and the panel reads every refusal that is not "may have gone" as "Not sent: ... Copy the link and send it another way".
    ["HighLevel's contact read for the link answers 503 once", () => (blinkLinkContactRead = true)],
  ] as const) {
    test(`m1-chaos-r4-not-sent-then-reask-sends-on-top: ${blip}`, async () => {
      reset();
      arm();
      const id = await sendZoomLink();
      // Round 4 fix (the sentence and the re-ask agree): a refusal the
      // minute's re-ask tries again is said as exactly that. The panel says
      // the link has not gone yet and is tried again in a minute, never
      // "Not sent" and never "Copy the link and send it another way", so the
      // closer has nothing to send by hand and the link goes once.
      const told = { link_sent_at: room(id).link_sent_at ?? null, refusal: String(room(id).refusal ?? "") };
      expect(told.link_sent_at).toBeNull();
      expect(told.refusal).toMatch(/tried again in a minute\.?$/);
      const status = await call("closer", { action: "room.status", room_id: id });
      const panel = ui.sentenceText(ui.roomSentence(ui.normalizeRoom(status.body.room), { now: Date.now() }));
      expect(panel).toMatch(/tried again in a minute/);
      expect(panel).not.toMatch(/Not sent|another way|Read it out/);
      // The cron runs on: the sweep posts the room's tick every minute.
      for (let i = 0; i < 3; i++) await minute(id);
      expect({
        link_messages_to_the_lead: linkMessages().length,
        room_link_sent: Boolean(room(id).link_sent_at),
      }).toEqual({
        link_messages_to_the_lead: 1,
        room_link_sent: true,
      });
    }, 60_000);
  }

  test("m1-chaos-r4-not-sent-then-reask-sends-on-top (a final Not sent): once the room said the link did not go and told the closer to send it another way, the re-ask never sends the room's own on top", async () => {
    reset();
    // The lead has no email address in HighLevel and the WhatsApp gate is
    // shut: a final refusal, said as "Not sent ... send it another way".
    (CONTACT as Row).email = undefined;
    try {
      const id = await sendZoomLink();
      expect(String(room(id).refusal ?? "")).toMatch(/no email address/);
      const status = await call("closer", { action: "room.status", room_id: id });
      const panel = ui.sentenceText(ui.roomSentence(ui.normalizeRoom(status.body.room), { now: Date.now() }));
      expect(panel).toMatch(/^Not sent: .*Copy the link and send it another way/);
      // HighLevel gets the email address a minute later (the closer added it):
      // the room still sends nothing on top of what the closer sent.
      (CONTACT as Row).email = "huda@stress.invalid";
      for (let i = 0; i < 3; i++) await minute(id);
      expect({ link_messages_to_the_lead: linkMessages().length, room_link_sent_later: Boolean(room(id).link_sent_at) }).toEqual({
        link_messages_to_the_lead: 0,
        room_link_sent_later: false,
      });
    } finally {
      (CONTACT as Row).email = "huda@stress.invalid";
    }
  }, 60_000);

  test("m1-chaos-r4-contactless-answer-said-as-no-email: a JSON 200 with no contact is read by the message service as a lead with no email address", async () => {
    reset();
    garbleServiceContactRead = 1;
    const id = await sendZoomLink();
    // rooms.ts reads the same answer as "HighLevel did not answer" (tried
    // again in a minute); the message service reads it as a contact with no
    // email, a final reason the closer is shown and acts on.
    expect(String(room(id).refusal ?? "")).not.toMatch(/no email address/);
  }, 60_000);
});
