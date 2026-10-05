// bun test supabase/functions/sales-api/m1_chaos_r2_verdict.test.ts
//
// Milestone 1, video-link round 2, chaos: HighLevel takes the room's link
// (the email, or the WhatsApp free text once the gate opens) and its answer
// is lost (a timeout at 25 s, a dropped connection). The message row is
// "unclear", and every minute the sweep's tick asks the room again: the
// conversation is read for the link's words (conversationVerdict), and a link
// "not there" 90 s on is marked failed, so the lane moves to its next key and
// sends again.
//
// The question here is what "not there" rests on. whatsappSentSince reads
// GET /conversations/search and then the latest ten messages of at most three
// conversations. Two things HighLevel does under chaos make a link that went
// read as "not there":
//   - the search (or a conversation's page) answers 200 with no list in it
//     (`{}`, a gateway's JSON, a search index that is rebuilding): read as
//     "no conversations", never as "not read";
//   - the lead writes back while the link's answer is lost (a WhatsApp lead
//     sends ten short lines: "hello?", "I'm here", a voice note...): the link
//     falls out of the ten messages read, and is read as never sent.
// Either way the lead gets the same room's link twice.
//
// Run end to end through the real handler (Deno.serve's function) with the
// outside world faked at fetch, as m1_chaos_r1_sends.test.ts does. HighLevel
// is a fake that keeps the conversation it would show. Every lead, seat and
// link is invented; nothing leaves this process.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-m1chaos2@stress.invalid";
const LEAD = "stress-m1chaos2-verdict-0001";
const realNow = Date.now.bind(Date);
let shift = 0;
const clock = {
  get now() {
    return realNow() + shift;
  },
};
const db = new FakeDb(clock as { now: number });
let handler: ((req: Request) => Promise<Response>) | undefined;

/** HighLevel's side: one conversation for the lead, newest message first when read. */
interface GhlMsg {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string;
  dateAdded: string;
  status: string;
}
const convo: GhlMsg[] = [];
/** Every send HighLevel took (what reached the lead). */
const took: { channel: string; body: string; at: number }[] = [];
/** The next N sends land and their answers are lost (a timeout). */
let sendAnswersLost = 0;
/** While true, GET /conversations/search answers 200 `{}` (no list in it). */
let searchGarbage = false;
/** From HighLevel's taking of the next send on, the search answers garbage (it read fine before). */
let garbageFromSend = false;
let lastInboundAt = 0;
/** Until this time, GET /contacts/{id} answers a gateway's 404 page. */
let contactPageUntil = 0;

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
    try {
      const rows = await db.db(path, { method, body, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    if (method === "GET" && /^\/contacts\/[^/]+\/appointments/.test(path)) return reply({ events: [] });
    if (method === "GET" && path.startsWith("/contacts/") && clock.now < contactPageUntil)
      // A gateway's page in front of HighLevel (a deploy, a bad route): 404 with no word about any contact.
      return new Response("<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center></body></html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({
        contact: { id, firstName: "Huda", name: "Huda Ali", email: "huda@example.com", phone: "+96550000000", tags: [], country: "KW", dnd: false, dndSettings: {} },
      });
    }
    if (method === "GET" && path.startsWith("/conversations/search")) {
      if (searchGarbage) return reply({});
      return reply({
        conversations: [
          { id: "conv-1", contactId: LEAD, lastInboundWhatsappMessageDate: lastInboundAt ? new Date(lastInboundAt).toISOString() : null },
        ],
      });
    }
    if (method === "POST" && path === "/conversations/messages") {
      const b = JSON.parse(String(init.body)) as Row;
      const channel = String(b.type) === "Email" ? "email" : "whatsapp";
      const id = `ghl-m-${convo.length + 1}`;
      convo.push({
        id,
        direction: "outbound",
        messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
        body: channel === "email" ? String(b.html ?? b.message) : String(b.message),
        dateAdded: new Date(clock.now).toISOString(),
        status: "delivered",
      });
      took.push({ channel, body: String(b.message), at: clock.now });
      if (garbageFromSend) searchGarbage = true;
      if (sendAnswersLost > 0) {
        sendAnswersLost--;
        // HighLevel took it; the answer never came back: the caller waited its 25 s.
        shift += 25_000;
        throw timeout();
      }
      return reply({ messageId: id, conversationId: "conv-1", status: "pending" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const m = convo.find(x => x.id === id);
      return reply({ message: { id, status: m?.status ?? "delivered" } });
    }
    if (method === "GET" && /^\/conversations\/[^/]+\/messages/.test(path)) {
      // HighLevel's page: the latest `limit` messages, newest first.
      const limit = Number(new URL(`${GHL}${path}`).searchParams.get("limit") ?? 20);
      const page = [...convo].reverse().slice(0, limit);
      return reply({ messages: { messages: page, nextPage: convo.length > limit } });
    }
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
  Date.now = () => realNow() + shift;
  await import("./index.ts?m1_chaos_r2_verdict");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  Date.now = before.now;
});

function reset(o: { gate: boolean }): void {
  db.tables = {};
  convo.length = 0;
  took.length = 0;
  sendAnswersLost = 0;
  searchGarbage = false;
  garbageFromSend = false;
  contactPageUntil = 0;
  // 11:00 in Kuwait on a working day, whatever the machine's clock says.
  shift = Date.parse("2026-10-06T08:00:00Z") - realNow();
  lastInboundAt = clock.now - 60 * 60_000;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    {
      key: "whatsapp_guard",
      value: o.gate
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: false,
        // One read-back of two seconds (the real wait is 20 s of sleeps).
        waits_s: { ...DEFAULT_ROOMS_JSON.waits_s, unconfirmed: 2 },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", role: "setter", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", tags: [] }]);
  db.seed("cockpit_sales_room_hosts", [{ email: REP, zoom_user_id: "Z-rep", zoom_status: "licensed", google_ok: true }]);
  db.seed("cockpit_sales_inbox", [{ conversation_id: "conv-1", contact_id: LEAD, inbound_whatsapp_at: new Date(lastInboundAt).toISOString() }]);
  convo.push({
    id: "ghl-in-0",
    direction: "inbound",
    messageType: "TYPE_WHATSAPP",
    body: "Sorry, I missed your call",
    dateAdded: new Date(lastInboundAt).toISOString(),
    status: "delivered",
  });
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
const SERVICE = `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`;
const desk = (body: Row) => call(body, SERVICE);
const settle = (ms: number) => new Promise(r => setTimeout(r, ms));
async function quiet(): Promise<void> {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 400 && still < 25; i++) {
    const n = JSON.stringify(db.tables).length + took.length + convo.length;
    still = n === last ? still + 1 : 0;
    last = n;
    await settle(100);
  }
}

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
async function minute(id: string, during?: (i: number) => void, i = 0): Promise<void> {
  shift += 60_000;
  during?.(i);
  await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } });
  await quiet();
}
/** The link's sends HighLevel took for this room (its words carry the room's join link). */
const linksToLead = () => took.filter(t => t.body.includes("abc-defg-hij"));

describe("m1 chaos r2: the link went, its answer was lost, and the conversation check reads HighLevel's chaos as 'not there'", () => {
  test("HELD: with no chaos the link goes once by email (the gate shut, as production is today)", async () => {
    reset({ gate: false });
    const id = await openRoom();
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    for (let i = 0; i < 4; i++) await minute(id);
    expect({ links: linksToLead().length, sent: Boolean(room(id).link_sent_at) }).toEqual({ links: 1, sent: true });
  }, 120_000);

  test("HELD: the answer lost and the conversation read fine: the link is confirmed from the conversation, sent once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    sendAnswersLost = 1;
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    for (let i = 0; i < 6; i++) await minute(id);
    expect({ links: linksToLead().length, sent: Boolean(room(id).link_sent_at) }).toEqual({ links: 1, sent: true });
  }, 180_000);

  test("conversation-garbage-read-as-not-there-second-link (email): HighLevel's search answers 200 {} while the lost email is checked: the lead must get the link once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    sendAnswersLost = 1;
    searchGarbage = true; // HighLevel's conversation search answers a 200 with no list in it
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    for (let i = 0; i < 6; i++) await minute(id);
    expect({
      links_to_lead: linksToLead().length,
      channels: linksToLead().map(t => t.channel),
    }).toEqual({ links_to_lead: 1, channels: ["email"] });
  }, 180_000);

  test("conversation-garbage-read-as-not-there-second-link (WhatsApp free text, the gate open): the lead must get the link once", async () => {
    reset({ gate: true });
    const id = await openRoom();
    sendAnswersLost = 1;
    // HighLevel's search goes bad from the send on (the window check before it read fine).
    garbageFromSend = true;
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    for (let i = 0; i < 6; i++) await minute(id);
    if (process.env.M1_R2_DEBUG) console.log(JSON.stringify({ room: room(id), msgs: db.t("cockpit_sales_messages"), ev: db.t("cockpit_sales_room_events").map(e => [e.kind, e.text]) }, null, 1));
    expect({
      links_to_lead: linksToLead().length,
      channels: linksToLead().map(t => t.channel),
    }).toEqual({ links_to_lead: 1, channels: ["whatsapp"] });
  }, 180_000);

  test("lead-chatter-pushes-link-out-of-read-window-second-link (WhatsApp free text, the gate open): the lead's conversation fills (two more rings, eight short lines) in the minute after the lost link: the lead must get the link once", async () => {
    reset({ gate: true });
    const id = await openRoom();
    sendAnswersLost = 1;
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    // In the minute after the link (before the first re-ask), the lead's
    // conversation fills: the rep rings twice more (two call logs), and the
    // lead answers in short WhatsApp lines.
    const burst: [string, string][] = [
      ["TYPE_CALL", ""],
      ["TYPE_WHATSAPP", "Hello?"],
      ["TYPE_WHATSAPP", "Sorry who is this"],
      ["TYPE_CALL", ""],
      ["TYPE_WHATSAPP", "I'm here"],
      ["TYPE_WHATSAPP", "Is the call now?"],
      ["TYPE_WHATSAPP", "?"],
      ["TYPE_WHATSAPP", "I can't hear you"],
      ["TYPE_WHATSAPP", "Which link"],
      ["TYPE_WHATSAPP", "ok"],
    ];
    for (let i = 0; i < 6; i++)
      await minute(
        id,
        n => {
          if (n !== 0) return;
          for (const [type, line] of burst) {
            if (type === "TYPE_WHATSAPP") lastInboundAt = clock.now - 2000;
            convo.push({
              id: `ghl-in-${convo.length + 1}`,
              direction: type === "TYPE_CALL" ? "outbound" : "inbound",
              messageType: type,
              body: line,
              dateAdded: new Date(clock.now - 2000).toISOString(),
              status: type === "TYPE_CALL" ? "completed" : "delivered",
            });
          }
        },
        i,
      );
    expect({
      links_to_lead: linksToLead().length,
      channels: linksToLead().map(t => t.channel),
    }).toEqual({ links_to_lead: 1, channels: ["whatsapp"] });
  }, 180_000);
});

describe("m1 chaos r2: a gateway's 404 page in front of HighLevel while the link is due", () => {
  test("gateway-404-page-read-as-lead-gone-link-never-goes: HighLevel's contact read answers a gateway's 404 page for two minutes: the link must still reach the lead once HighLevel answers", async () => {
    reset({ gate: false });
    const id = await openRoom();
    contactPageUntil = clock.now + 130_000; // two minutes of a gateway's 404 page
    await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await quiet();
    for (let i = 0; i < 8; i++) await minute(id);
    const r = room(id);
    expect({
      links_to_lead: linksToLead().length,
      link_sent: Boolean(r.link_sent_at),
      says: String(r.refusal ?? ""),
    }).toEqual({ links_to_lead: 1, link_sent: true, says: "" });
  }, 180_000);
});
