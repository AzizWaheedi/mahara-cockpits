// bun test supabase/functions/sales-api/m1_chaos_r1_sends.test.ts
//
// Milestone 1, video-link round 1, chaos on the message service the room's
// link goes through (index.ts convoSend, markAsked). Run end to end through
// the real handler (Deno.serve's function) with the outside world faked at
// fetch, as stress2_chaos_r6_sends.test.ts does.
//
// markAsked stamps the message row's ghl_asked_at right before HighLevel is
// asked: from that stamp on, every reader takes the send as "may have gone".
// When the stamp's PATCH lands and its answer is lost, markAsked reads the
// row back and, failing that, gives the row up with a DELETE. A network blip
// of a second takes all three (the PATCH's answer, the read, the DELETE):
// markAsked throws, beforeRowCertain answers a certain "Not sent yet, try
// again in a minute" (nothing went: HighLevel was never asked), but the row
// stays "sending" WITH its stamp. Every later try on that request id then
// reads the stamped row as a send under way or done:
//   - convo.send: the rep presses again and is answered with the row as a
//     repeat ("That message was already sent.") with nothing sent;
//   - the room's link: the minute's re-ask finds the stamped row, marks it
//     "unclear" after 90 s, and the room says the email may have gone; "Also
//     send by email" uses the same key and is refused the same way. The lead
//     never gets the link from the cockpit.
//
// Synthetic only; nothing leaves this process. A failing test is a finding;
// tests marked HELD pass.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-m1chaos@stress.invalid";
const LEAD = "stress-m1chaos-send-0001";
const realNow = Date.now.bind(Date);
let shift = 0;
const clock = {
  get now() {
    return realNow() + shift;
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string; body: unknown }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;
/** The blip: the next stamp (PATCH ghl_asked_at) lands and its answer is lost; then the next N reads and DELETEs of message rows fail. */
let stampLost = 0;
let messageReadsFail = 0;
let messageDeletesFail = 0;
/** The function dies (a deploy) right after the stamp, before HighLevel is asked: the next send's request never leaves. */
let killBeforeSend = 0;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function timeout(): Error {
  return Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: REP, name: "Rafi Rep", role: "setter", ghl_user_id: "G-rep" });
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
    const headers = new Headers(init.headers as HeadersInit);
    const prefer = headers.get("prefer") ?? "";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const onMessages = path.startsWith("cockpit_sales_messages?");
    if (onMessages && method === "GET" && messageReadsFail > 0) {
      messageReadsFail--;
      return reply({ message: "upstream connect error or disconnect/reset before headers" }, 503);
    }
    if (onMessages && method === "DELETE" && messageDeletesFail > 0) {
      messageDeletesFail--;
      return reply({ message: "upstream connect error or disconnect/reset before headers" }, 503);
    }
    try {
      const rows = await db.db(path, { method, body, prefer });
      if (onMessages && method === "PATCH" && stampLost > 0 && body && "ghl_asked_at" in (body as Row)) {
        stampLost--;
        // The stamp committed; its answer never came back, and the blip goes on for the next calls.
        messageReadsFail = 1;
        messageDeletesFail = 1;
        throw timeout();
      }
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw e;
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    ghlCalls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && /^\/contacts\/[^/]+\/appointments/.test(path)) return reply({ events: [] });
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({
        contact: { id, firstName: "Huda", name: "Huda Ali", email: "huda@example.com", phone: "+96550000000", tags: [], country: "KW", dnd: false, dndSettings: {} },
      });
    }
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages" && killBeforeSend > 0) {
      killBeforeSend--;
      ghlCalls.pop(); // it never left the dead function
      return await new Promise<Response>(() => {});
    }
    if (method === "POST" && path === "/conversations/messages") return reply({ messageId: `m-${ghlCalls.length}`, conversationId: "conv-1", status: "pending" });
    if (method === "GET" && path.startsWith("/conversations/messages/")) return reply({ message: { id: path.split("/")[3], status: "delivered" } });
    if (method === "GET" && path.startsWith("/conversations/")) return reply({ messages: { messages: [] } });
    return reply({ ok: true });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

const before = { fetch: globalThis.fetch, deno: (globalThis as unknown as { Deno?: unknown }).Deno, now: Date.now };

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
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  // The room module's clock (liveio now) and the fake database's read Date.now: moved forward by `shift`.
  Date.now = () => realNow() + shift;
  await import("./index.ts?m1_chaos_r1_sends");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  Date.now = before.now;
});

function reset(): void {
  db.tables = {};
  ghlCalls.length = 0;
  stampLost = 0;
  messageReadsFail = 0;
  messageDeletesFail = 0;
  killBeforeSend = 0;
  // 11:00 in Kuwait on a working day, whatever the machine's clock says.
  shift = Date.parse("2026-10-06T08:00:00Z") - realNow();
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    // The WhatsApp gate as production has it today: shut, so the link goes by email.
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        // One read-back of two seconds (the real wait is 20 s of sleeps).
        waits_s: { ...DEFAULT_ROOMS_JSON.waits_s, unconfirmed: 2 },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", role: "setter", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", tags: [] }]);
  db.seed("cockpit_sales_room_hosts", [{ email: REP, zoom_user_id: "Z-rep", zoom_status: "licensed", google_ok: true }]);
}

async function call(body: Row, bearer = "a-seat-session"): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}
// A service-role token's shape (the handler reads its role claim; the gateway checked the signature).
const SERVICE = `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`;
const desk = (body: Row) => call(body, SERVICE);
const sentToLead = () => ghlCalls.filter(c => c.method === "POST" && c.path === "/conversations/messages").length;
const settle = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Background work (EdgeRuntime is absent here): wait until the fake database is quiet. */
async function quiet(): Promise<void> {
  // The message service reads a send back after a real two-second sleep: quiet means nothing moved for 2.5 s.
  let last = -1;
  let still = 0;
  for (let i = 0; i < 400 && still < 25; i++) {
    const n = JSON.stringify(db.tables).length + ghlCalls.length;
    still = n === last ? still + 1 : 0;
    last = n;
    await settle(100);
  }
}

describe("m1 chaos r1: the stamp lands, its answer is lost, and the blip takes the read-back and the give-up (convo.send)", () => {
  const send = (rid: string) =>
    call({ action: "convo.send", contact_id: LEAD, channel: "email", subject: "Your call", body: "Hi Huda, here is the link for our call.", request_id: rid });

  test("HELD: with no blip the email goes once", async () => {
    reset();
    const out = await send(crypto.randomUUID());
    expect({ status: out.status, went: sentToLead() }).toEqual({ status: 200, went: 1 });
  }, 30_000);

  test("stamped-orphan-retry-says-already-sent: told 'Not sent, try again', the rep presses again: the email must go, never a repeat of a send HighLevel was never asked about", async () => {
    reset();
    const rid = crypto.randomUUID();
    stampLost = 1;
    const first = await send(rid);
    expect({ status: first.status, code: first.body.code, went: sentToLead() }).toEqual({ status: 503, code: "not_sent_yet", went: 0 });
    shift += 60_000; // "Try again in a minute."
    const second = await send(rid);
    const row = db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row | undefined;
    expect({
      status: second.status,
      repeated: second.body.repeated ?? false,
      reached_lead: sentToLead(),
      row: row ? `${row.state}/${row.ghl_asked_at ? "stamped" : "unstamped"}` : "none",
    }).toEqual({ status: 200, repeated: false, reached_lead: 1, row: expect.stringMatching(/^(sent|delivered)\/stamped$/) });
  }, 30_000);
});

describe("m1 chaos r1: the same blip on the room's link (email, the WhatsApp gate shut as today)", () => {
  async function openRoom(): Promise<string> {
    const id = crypto.randomUUID();
    const at = new Date(clock.now).toISOString();
    db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: crypto.randomUUID(),
        code: "K7Q2MX",
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "manual",
        call_kind: "intro",
        provider: "meet",
        host_email: REP,
        made_by: REP,
        state: "open",
        version: 3,
        join_url: "https://meet.google.com/abc-defg-hij",
        provider_meeting_id: "abc-defg-hij",
        requested_at: at,
        claimed_at: at,
        opened_at: at,
        worker_run: "run-1",
        host_by: new Date(clock.now + 15 * 60_000).toISOString(),
        ends_at: new Date(clock.now + 30 * 60_000).toISOString(),
        link_channels: [],
        link_message_ids: {},
      },
    ]);
    db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, text: "Room made on Meet in 2 s.", detail: { worker_run: "run-1" } },
    ]);
    return id;
  }
  const room = (id: string) => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function minute(id: string): Promise<void> {
    shift += 60_000;
    await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } });
    await quiet();
  }

  test("HELD: with no blip the link goes once by email", async () => {
    reset();
    const id = await openRoom();
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    expect({ went: sentToLead(), sent: Boolean(room(id).link_sent_at) }).toEqual({ went: 1, sent: true });
  }, 60_000);

  test("stamped-orphan-room-link-never-goes: the link's email stamp lands on a blip: within the lead's ten minutes the link goes once, or the room says plainly it did not", async () => {
    reset();
    const id = await openRoom();
    stampLost = 1;
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    expect(sentToLead()).toBe(0);
    for (let i = 0; i < 8; i++) await minute(id);
    // The rep presses "Also send by email" after reading the panel.
    const also = await call({ action: "room.send", room_id: id, channel: "email", request_id: crypto.randomUUID() });
    await quiet();
    const r = room(id);
    expect({
      reached_lead: sentToLead(),
      link_sent: Boolean(r.link_sent_at),
      says: String(r.refusal ?? ""),
      also: also.status === 200 ? "sent" : String(also.body.error ?? ""),
    }).toEqual({ reached_lead: 1, link_sent: true, says: "", also: "sent" });
  }, 300_000);

  test("stamped-orphan-after-kill: the function dies between the stamp and HighLevel (a deploy): within the lead's ten minutes the link goes once, or the room says plainly it did not", async () => {
    reset();
    const id = await openRoom();
    killBeforeSend = 1;
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    expect(sentToLead()).toBe(0);
    for (let i = 0; i < 8; i++) await minute(id);
    const also = await call({ action: "room.send", room_id: id, channel: "email", request_id: crypto.randomUUID() });
    await quiet();
    const r = room(id);
    expect({
      reached_lead: sentToLead(),
      link_sent: Boolean(r.link_sent_at),
      says: String(r.refusal ?? ""),
      also: also.status === 200 ? "sent" : String(also.body.error ?? ""),
    }).toEqual({ reached_lead: 1, link_sent: true, says: "", also: "sent" });
  }, 300_000);
});
