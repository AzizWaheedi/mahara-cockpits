// bun test supabase/functions/sales-api/m1_chaos_r3_hl.test.ts
//
// Milestone 1, video-link round 3, chaos on HighLevel while a room's link
// goes and while it is read again.
//
// Round 2 made "a read that says nothing" (an answer with no list in it)
// throw, so the conversation check never reads a gateway's `{}` as "not
// there". What HighLevel answers in a real incident is not always `{}`:
//   - the conversation search, while its index rebuilds, answers a proper
//     `{"conversations": [], "total": 0}` for a lead who has one;
//   - a conversation's page answers `{"messages": {"messages": [], ...}}`;
//   - a send hangs at HighLevel past the caller's 25 s and is taken late
//     (HighLevel's own queue, Cloudflare's 100 s in front of it), so it shows
//     in the conversation only after the cockpit has looked.
// Each one is read here as "not there" a send's budget on, and the lead gets
// the room's link a second time, or the room says a link that arrived never
// did.
//
// Run end to end through the real handler (Deno.serve's function) with the
// outside world faked at fetch, as m1_chaos_r2_verdict.test.ts does, with the
// pilot's settings (rooms on, test_only with the test lead, short link off).
// Long sleeps inside the handler (the read-back's 2 s) move the fake clock
// instead of the real one. Every lead, seat and link is invented; nothing
// leaves this process.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-m1chaos3@stress.invalid";
const LEAD = "stress-m1chaos3-hl-0001";
const JOIN = "https://meet.google.com/qrs-tuvw-xyz";
const realNow = Date.now.bind(Date);
const realSetTimeout = globalThis.setTimeout;
let shift = 0;
const clock = {
  get now() {
    return realNow() + shift;
  },
};
const db = new FakeDb(clock as { now: number });
let handler: ((req: Request) => Promise<Response>) | undefined;

interface GhlMsg {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string;
  dateAdded: string;
  status: string;
}
const convo: GhlMsg[] = [];
/** Every send that reached the lead, with when it reached them. */
const took: { channel: string; body: string; at: number }[] = [];
/** HighLevel's chaos, per test. */
const hl = {
  /** The next N sends land and their answers are lost (25 s, then a timeout). */
  sendLost: 0,
  /** The next send hangs: HighLevel takes it this long after it was asked; the caller gives up at 25 s. */
  sendLateMs: 0,
  /** The next N conversation searches answer a proper empty list (the index rebuilding). */
  searchEmpty: 0,
  /** While true, every conversation search answers an empty list. */
  searchEmptyAlways: false,
  /** The next N conversation pages answer with an empty message list. */
  pageEmpty: 0,
  /** Reads of a message by its id answer 404 (an email's id is not always readable this way). */
  byId404: false,
  /** The next N reads of a message by its id answer a 503 (HighLevel's incident). */
  byId503: 0,
  /** What a WhatsApp send's status stays at (a lead whose phone is off: Meta's one grey tick). */
  waStatus: "delivered",
};
/** Sends HighLevel holds and takes later. */
const late: { at: number; msg: GhlMsg; channel: string }[] = [];
let lastInboundAt = 0;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function timeout(): Error {
  return Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
}
/** A held send lands once its time comes. */
function landLate(): void {
  for (let i = late.length - 1; i >= 0; i--) {
    const l = late[i] as (typeof late)[number];
    if (l.at > clock.now) continue;
    late.splice(i, 1);
    convo.push({ ...l.msg, dateAdded: new Date(l.at).toISOString() });
    took.push({ channel: l.channel, body: l.msg.body, at: l.at });
  }
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  landLate();
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
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({
        contact: { id, firstName: "Huda", name: "Huda Ali", email: "huda@example.com", phone: "+96550000000", tags: [], country: "KW", dnd: false, dndSettings: {} },
      });
    }
    if (method === "GET" && path.startsWith("/conversations/search")) {
      if (hl.searchEmptyAlways || hl.searchEmpty > 0) {
        if (hl.searchEmpty > 0) hl.searchEmpty--;
        // A proper answer with nothing in it: the search index rebuilding.
        return reply({ conversations: [], total: 0 });
      }
      return reply({
        conversations: [
          { id: "conv-1", contactId: LEAD, lastInboundWhatsappMessageDate: lastInboundAt ? new Date(lastInboundAt).toISOString() : null },
        ],
        total: 1,
      });
    }
    if (method === "POST" && path === "/conversations/messages") {
      const b = JSON.parse(String(init.body)) as Row;
      const channel = String(b.type) === "Email" ? "email" : "whatsapp";
      const id = `ghl-m-${convo.length + late.length + 1}`;
      const msg: GhlMsg = {
        id,
        direction: "outbound",
        messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
        body: channel === "email" ? String(b.html ?? b.message) : String(b.message),
        dateAdded: new Date(clock.now).toISOString(),
        status: channel === "email" ? "delivered" : hl.waStatus,
      };
      if (hl.sendLateMs > 0) {
        // HighLevel holds the request and takes it later; the caller waited its 25 s.
        late.push({ at: clock.now + hl.sendLateMs, msg: { ...msg, body: msg.body }, channel });
        hl.sendLateMs = 0;
        shift += 25_000;
        throw timeout();
      }
      convo.push(msg);
      took.push({ channel, body: String(b.message), at: clock.now });
      if (hl.sendLost > 0) {
        hl.sendLost--;
        shift += 25_000;
        throw timeout();
      }
      return reply({ messageId: id, conversationId: "conv-1", status: "pending" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) {
      if (hl.byId404) return reply({ statusCode: 404, message: "Message not found" }, 404);
      if (hl.byId503 > 0) {
        hl.byId503--;
        return reply({ message: "Service Unavailable" }, 503);
      }
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const m = convo.find(x => x.id === id);
      return reply({ message: { id, status: m?.status ?? "delivered" } });
    }
    if (method === "GET" && /^\/conversations\/[^/]+\/messages/.test(path)) {
      if (hl.pageEmpty > 0) {
        hl.pageEmpty--;
        return reply({ messages: { messages: [], nextPage: false, lastMessageId: null } });
      }
      const limit = Number(new URL(`${GHL}${path}`).searchParams.get("limit") ?? 20);
      const page = [...convo].sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded)).slice(0, limit);
      return reply({ messages: { messages: page, nextPage: convo.length > limit, lastMessageId: page.at(-1)?.id ?? null } });
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
  // The handler's own long sleeps (the read-back's 2 s) move the fake clock.
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (typeof ms === "number" && ms >= 1000) {
      shift += ms;
      return realSetTimeout(fn, 0, ...args);
    }
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout;
  await import("./index.ts?m1_chaos_r3_hl");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  Date.now = before.now;
  globalThis.setTimeout = realSetTimeout;
});

function reset(o: { gate: boolean; inboundAgoMs?: number }): void {
  db.tables = {};
  convo.length = 0;
  took.length = 0;
  late.length = 0;
  Object.assign(hl, { sendLost: 0, sendLateMs: 0, searchEmpty: 0, searchEmptyAlways: false, pageEmpty: 0, byId404: false, byId503: 0, waStatus: "delivered" });
  // 11:00 in Kuwait on a working day, whatever the machine's clock says.
  shift = Date.parse("2026-10-06T08:00:00Z") - realNow();
  lastInboundAt = clock.now - (o.inboundAgoMs ?? 60 * 60_000);
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
const pause = (ms: number) => new Promise(r => realSetTimeout(r, ms));
async function quiet(): Promise<void> {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 400 && still < 12; i++) {
    const n = JSON.stringify(db.tables).length + took.length + convo.length;
    still = n === last ? still + 1 : 0;
    last = n;
    await pause(40);
  }
}

async function openRoom(): Promise<string> {
  const id = crypto.randomUUID();
  const at = new Date(clock.now).toISOString();
  db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: crypto.randomUUID(),
      code: "R3HLMX",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "manual",
      call_kind: "intro",
      provider: "meet",
      host_email: REP,
      made_by: REP,
      state: "open",
      version: 3,
      join_url: JOIN,
      provider_meeting_id: "qrs-tuvw-xyz",
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
const events = (id: string) => db.t("cockpit_sales_room_events").filter(e => e.room_id === id);
async function minute(id: string, during?: (i: number) => void, i = 0): Promise<void> {
  shift += 60_000;
  landLate();
  during?.(i);
  await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } });
  await quiet();
}
/** The link's sends that reached the lead (their words carry the room's join link). */
const linksToLead = () => took.filter(t => t.body.includes("qrs-tuvw-xyz"));
async function start(id: string): Promise<void> {
  await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await quiet();
}

describe("m1 chaos r3: the link's answer is lost and HighLevel's conversation read answers a proper empty list", () => {
  test("HELD: answer lost, conversation read fine: the email link is confirmed from the conversation, sent once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendLost = 1;
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    expect({ links: linksToLead().length, sent: Boolean(room(id).link_sent_at) }).toEqual({ links: 1, sent: true });
  }, 120_000);

  test("m1-chaos-r3-empty-search-read-as-not-there-second-link (email, the gate shut as production is today): the search index answers {conversations: []} while the lost email is checked: the lead must get the link once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendLost = 1;
    hl.searchEmptyAlways = true;
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    expect({ links_to_lead: linksToLead().length, channels: linksToLead().map(t => t.channel) }).toEqual({ links_to_lead: 1, channels: ["email"] });
  }, 120_000);

  test("m1-chaos-r3-empty-search-read-as-not-there-second-link (free text, the gate open): the search answers an empty list from the minute after the lost send: the lead must get the link once", async () => {
    reset({ gate: true });
    const id = await openRoom();
    hl.sendLost = 1;
    await start(id);
    hl.searchEmptyAlways = true;
    // The index answers again once the room's minutes have mostly run.
    for (let i = 0; i < 6; i++) await minute(id, n => (hl.searchEmptyAlways = n < 2), i);
    expect({ links_to_lead: linksToLead().length }).toEqual({ links_to_lead: 1 });
  }, 120_000);

  test("m1-chaos-r3-empty-page-read-as-not-there-second-link (email): the lead's conversation page answers an empty message list while the lost email is checked: the lead must get the link once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendLost = 1;
    hl.pageEmpty = 1000;
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    expect({ links_to_lead: linksToLead().length, channels: linksToLead().map(t => t.channel) }).toEqual({ links_to_lead: 1, channels: ["email"] });
  }, 120_000);
});

describe("m1 chaos r3: an email link that arrived is read again, and one empty search answer marks it never arrived", () => {
  test("HELD: an email link that went, read again for fifteen minutes with HighLevel answering: never said to have failed", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.byId404 = true;
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    const r = room(id);
    expect({
      links: linksToLead().length,
      unconfirmed: Boolean(r.link_unconfirmed_at),
      failed_late: events(id).filter(e => String(e.kind) === "link.failed_late").length,
    }).toEqual({ links: 1, unconfirmed: false, failed_late: 0 });
  }, 120_000);

  test("m1-chaos-r3-recheck-empty-search-marks-arrived-email-failed (the gate shut): one empty search answer during the minutes' re-reads: the email that arrived must not be marked failed, nor the rep told it did not arrive", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.byId404 = true; // the email's id is not readable by id: the conversation is read instead
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id, n => (hl.searchEmpty = n === 2 ? 1 : 0), i);
    const r = room(id);
    const msg = db.t("cockpit_sales_messages").find(m => String(m.body ?? "").includes("qrs-tuvw-xyz"));
    if (process.env.M1_R3_DEBUG) console.log(JSON.stringify({ r, ev: events(id).map(e => [e.kind, e.text]) }, null, 1));
    expect({
      links: linksToLead().length,
      message_failed: String(msg?.state) === "failed",
      unconfirmed: Boolean(r.link_unconfirmed_at),
      lines: events(id)
        .filter(e => String(e.kind) === "link.failed_late")
        .map(e => String(e.text)),
    }).toEqual({ links: 1, message_failed: false, unconfirmed: false, lines: [] });
  }, 120_000);

  test("m1-chaos-r3-recheck-empty-search-sends-second-link (the gate open, the lead's window opened since): one empty search answer: the lead must not get the link again on WhatsApp", async () => {
    // The lead last wrote three days ago: the window is shut, the template
    // lane needs the short link (off in the pilot), so the link goes by email.
    reset({ gate: true, inboundAgoMs: 3 * 24 * 60 * 60_000 });
    const id = await openRoom();
    hl.byId404 = true;
    await start(id);
    for (let i = 0; i < 6; i++)
      await minute(
        id,
        n => {
          if (n === 1) {
            // The lead writes on WhatsApp: the 24 hours open again.
            lastInboundAt = clock.now - 5_000;
            convo.push({
              id: "ghl-in-1",
              direction: "inbound",
              messageType: "TYPE_WHATSAPP",
              body: "Is the call now?",
              dateAdded: new Date(lastInboundAt).toISOString(),
              status: "delivered",
            });
            db.t("cockpit_sales_inbox")[0]!.inbound_whatsapp_at = new Date(lastInboundAt).toISOString();
          }
          hl.searchEmpty = n === 2 ? 1 : 0;
        },
        i,
      );
    expect({
      links_to_lead: linksToLead().length,
      channels: linksToLead().map(t => t.channel),
    }).toEqual({ links_to_lead: 1, channels: ["email"] });
  }, 120_000);
});

describe("m1 chaos r3: a WhatsApp link that arrived, read again while HighLevel has an incident", () => {
  test("HELD: a free text link that went, read again for six minutes with HighLevel answering: never backed up", async () => {
    reset({ gate: true });
    hl.waStatus = "sent"; // the lead's phone is off: Meta's one grey tick
    const id = await openRoom();
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    expect({ links_to_lead: linksToLead().length, channels: linksToLead().map(t => t.channel) }).toEqual({ links_to_lead: 1, channels: ["whatsapp"] });
  }, 120_000);

  test("m1-chaos-r3-recheck-empty-search-sends-second-link (free text, the gate open): in one minute HighLevel's read by id answers 503 and its search answers an empty list: the lead must not get the link again by email", async () => {
    reset({ gate: true });
    hl.waStatus = "sent"; // the lead's phone is off: Meta's one grey tick
    const id = await openRoom();
    await start(id);
    for (let i = 0; i < 6; i++)
      await minute(
        id,
        n => {
          hl.byId503 = n === 2 ? 1 : 0;
          hl.searchEmpty = n === 2 ? 1 : 0;
        },
        i,
      );
    const r = room(id);
    expect({
      links_to_lead: linksToLead().length,
      channels: linksToLead().map(t => t.channel),
      unconfirmed: Boolean(r.link_unconfirmed_at),
    }).toEqual({ links_to_lead: 1, channels: ["whatsapp"], unconfirmed: false });
  }, 120_000);
});

describe("m1 chaos r3: a send that hangs at HighLevel and is taken late", () => {
  test("HELD: a send HighLevel takes 60 s late (after the caller's 25 s): the lead gets the link once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendLateMs = 60_000;
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    expect({ links_to_lead: linksToLead().length }).toEqual({ links_to_lead: 1 });
  }, 120_000);

  test("m1-chaos-r3-hung-send-taken-late-second-link (email): HighLevel holds the email past its own gateway's 100 s and takes it at 150 s: the lead must get the link once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendLateMs = 150_000;
    await start(id);
    for (let i = 0; i < 6; i++) await minute(id);
    if (process.env.M1_R3_DEBUG) console.log(JSON.stringify({ took, ev: events(id).map(e => [e.kind, e.text]) }, null, 1));
    expect({ links_to_lead: linksToLead().length }).toEqual({ links_to_lead: 1 });
  }, 120_000);
});
