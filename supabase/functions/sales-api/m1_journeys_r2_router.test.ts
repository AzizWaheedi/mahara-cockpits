// bun test supabase/functions/sales-api/m1_journeys_r2_router.test.ts
//
// Milestone 1, video-link round 2, journeys through sales-api's own doors
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
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1j2r-setter@stress.invalid";
const LEAD = "stress-m1j2r-huda";
const APPT = "stress-m1j2r-intro";
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
          phone: "+96550000000",
          email: "huda@stress.invalid",
          country: "KW",
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
  await import("./index.ts?m1_journeys_r2_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

function serviceToken(): string {
  const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
}

async function call(who: "setter" | "desk", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.authorization = who === "setter" ? "Bearer seat-setter" : `Bearer ${serviceToken()}`;
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
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-setter", phone: "+96550000000" }]);
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

/** The room worker on the VPS: claim, store worker.ready, open the room, then tell sales-api (contract v2 section 7). */
async function workerOpens(id: string): Promise<{ status: number; body: Row }> {
  const room = () => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: new Date().toISOString(), worker_run: "run-1", version: Number(room().version) + 1 },
  });
  await db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
    prefer: "resolution=ignore-duplicates",
  });
  await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: MEET_URL,
      provider_meeting_id: `evt-${id.slice(-4)}`,
      opened_at: new Date().toISOString(),
      host_by: new Date(Date.now() + 15 * 60_000).toISOString(),
      ends_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      version: Number(room().version) + 1,
    },
  });
  return await call("desk", { action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
}

/** Send a Meet link after the missed intro call (the dialer's videoAsk and createAsk), with the worker making the room meanwhile. */
async function sendMeetLink(): Promise<string> {
  const attemptId = crypto.randomUUID();
  db.seed("cockpit_sales_attempts", [
    { id: attemptId, contact_id: LEAD, rep_email: SETTER, started_at: new Date(Date.now() - 40_000).toISOString(), state: "done", item_kind: "intro", appointment_id: APPT },
  ]);
  const press = call("setter", {
    action: "room.create",
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "meet",
    call_kind: "intro",
    purpose: "fallback",
    trigger: "no_answer",
    attempt_id: attemptId,
    appointment_id: APPT,
    item_kind: "intro",
  });
  // The worker's next poll (every second) finds the room.
  let id: string | null = null;
  for (let i = 0; i < 40 && !id; i++) {
    await new Promise(r => setTimeout(r, 100));
    id = (db.t("cockpit_sales_rooms")[0]?.id as string | undefined) ?? null;
  }
  if (!id) throw new Error(`no room was asked for: ${JSON.stringify((await press).body)}`);
  const ready = await workerOpens(id);
  const made = await press;
  expect(made.status).toBe(200);
  expect(ready.status).toBe(200);
  return id;
}

/** room.status, read every half second (the panel reads every 2 to 4 s) until the link went, at most 20 s. */
async function statusOnceSent(id: string): Promise<{ status: number; body: Row }> {
  let out = await call("setter", { action: "room.status", room_id: id });
  for (let i = 0; i < 40 && !(out.body.room as Row | undefined)?.link_sent_at; i++) {
    await new Promise(r => setTimeout(r, 500));
    out = await call("setter", { action: "room.status", room_id: id });
  }
  return out;
}

const linkEmails = () => ghl.filter(g => g.method === "POST" && g.path === "/conversations/messages");
const markWrites = () => ghl.filter(g => g.method === "PUT" && g.path.startsWith("/calendars/events/appointments/"));

describe("journey: the setter's booked intro rings out, a Meet link goes to Huda by email, and the setter saves the call from the dialer's step", () => {
  test("while Huda's room is open and its link went a minute ago, No-show is not written to HighLevel (its automation messages the lead)", async () => {
    // The intro started a minute ago; the setter called, nobody answered.
    reset(Date.now() - 60_000);
    const id = await sendMeetLink();
    // The link went: one email through HighLevel, the room open, waiting for Huda.
    const status = await statusOnceSent(id);
    expect(status.status).toBe(200);
    const room = status.body.room as Row;
    expect(room.state).toBe("open");
    expect(room.link_sent_at).toBeTruthy();
    expect(linkEmails()).toHaveLength(1);
    // The dialer's pane: until Maqsam's record saves the call by itself, the
    // outcome form stays under the room panel (mode "outcomes"), with the
    // intro's outcomes Held it, Not a fit, No answer, No-show and Reschedule
    // (DialerPage OUTCOMES.intro), filtered by nothing; Call again brings it
    // back too. The setter saves No-show for the intro nobody answered.
    const saved = await call("setter", {
      action: "dial.save",
      contact_id: LEAD,
      outcome: "noshow",
      item_kind: "intro",
      appointment_id: APPT,
      request_id: crypto.randomUUID(),
      note: "",
    });
    // What happens: dial.save marks the intro a no-show and writes it to
    // HighLevel with toNotify true (crmDecision "write" for today's call),
    // so HighLevel's no-show automation writes to Huda while she is opening
    // the "I'll wait for you for the next 10 minutes" link; if she then
    // joins, the intro she had stands as a no-show.
    // What should hold: no no-show for an intro whose video room is open
    // (refused with a sentence: wait for the room, or end it first), as the
    // room panel itself never offers No-show while the lead may still come.
    const wrote = markWrites().filter(g => (g.body as Row)?.appointmentStatus === "noshow");
    expect({ status: saved.status, noshowWrites: wrote.length }).toEqual({ status: 409, noshowWrites: 0 });
  }, 60_000);

  test("the same through the intro's own mark (the lead page's marks for a call past its start, the mark action)", async () => {
    reset(Date.now() - 60_000);
    const id = await sendMeetLink();
    const status = await statusOnceSent(id);
    expect((status.body.room as Row).link_sent_at).toBeTruthy();
    const marked = await call("setter", { action: "mark", appointment_id: APPT, status: "noshow" });
    const wrote = markWrites().filter(g => (g.body as Row)?.appointmentStatus === "noshow");
    expect({ status: marked.status, noshowWrites: wrote.length }).toEqual({ status: 409, noshowWrites: 0 });
  }, 60_000);
});
