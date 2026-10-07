// bun test supabase/functions/sales-api/m1_chaos_r6_kill.test.ts
//
// Milestone 1, video-link round 6 (chaos): the function is killed while it
// waits on HighLevel's answer to the room's link (a deploy of sales-api, the
// edge's wall-clock limit on the tick's background sends), at the moment
// HighLevel is slow, so HighLevel takes the link late (its own queue,
// Cloudflare's 100 s in front of it), as round 3's hung send does.
//
// Round 3 (m1-chaos-r3-hung-send-taken-late-second-link) taught the
// conversation check that a send whose HighLevel call timed out may be taken
// up to five minutes late (hungSend, HUNG_NOT_THERE_MS). A send whose
// function was killed never reaches that code: its message row stays
// "sending" with HighLevel's stamp, and the minute's re-ask marks it
// "The send started and never finished" past a send's budget (90 s), which
// hungSend does not read as a hung call, so the link is "not there" at 90 s
// and the lane's next key sends it again.
//
// Also here, the function killed between two writes elsewhere on the path:
//   - the minute's tick closes a room as moved to the phone (the host rang
//     the lead after the link and they talked): the room's write lands and
//     the function stops before its line or its audit row; the next tick
//     skips a closed room, so neither is ever written;
//   - the panel's read (room.status) of a worker.failed line the worker
//     closed as not true on a room that opened (round 4c's fix): the words
//     still reach the rep's timeline (desk tests/test_m1_chaos_r6.py has the
//     worker side, killed between the line and the failed write).
//
// The world is round 3's (HighLevel keeps the lead's conversation; the
// handler's long sleeps move the fake clock), the pilot's settings (rooms on
// for the test lead, short link off). Every lead, seat and link is invented;
// nothing leaves this process. A failing test is a finding; HELD tests pass.
// M1_R6_DEBUG=1 prints what reached the lead and the room's lines.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-m1chaos6k@stress.invalid";
const LEAD = "stress-m1chaos6k-hl-0001";
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
  /**
   * The next send: the function is killed while it waits on HighLevel (a
   * deploy, the wall-clock limit), so no answer ever comes back; HighLevel
   * takes it this long after it was asked (0: at once; -1: never).
   */
  sendKilledLateMs: null as number | null,
  /** Every send is refused with HighLevel's burst limit (429): nothing goes. */
  send429: false,
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
/** Sends whose function was killed while it waited on HighLevel. */
let killed = 0;
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

/**
 * A database call the function is killed at (a deploy, the wall-clock
 * limit): it lands when `land` is true, and its answer never comes back.
 */
const dbKill: { method: string; url: RegExp; body?: RegExp; land: boolean; hit: number } = { method: "", url: /$^/, land: false, hit: 0 };
/** A database call that fails with a 503 before it lands, `times` times (a blip). */
const dbFail: { method: string; url: RegExp; body?: RegExp; times: number; hit: number } = { method: "", url: /$^/, times: 0, hit: 0 };

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  landLate();
  if (dbFail.times > 0 && dbFail.method === method && dbFail.url.test(url) && (!dbFail.body || dbFail.body.test(String(init.body ?? "")))) {
    dbFail.times--;
    dbFail.hit++;
    return reply({ message: "upstream connect error or disconnect/reset before headers" }, 503);
  }
  if (dbKill.method === method && dbKill.url.test(url) && (!dbKill.body || dbKill.body.test(String(init.body ?? "")))) {
    dbKill.method = "";
    dbKill.hit++;
    if (dbKill.land) {
      const path = url.slice(`${DB}/rest/v1/`.length);
      const headers = new Headers(init.headers as HeadersInit);
      await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer: headers.get("prefer") ?? "" }).catch(() => null);
    }
    return await new Promise<Response>(() => {});
  }
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
    if (method === "POST" && path === "/conversations/messages" && hl.send429) {
      return reply({ statusCode: 429, message: "Too Many Requests" }, 429);
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
      if (hl.sendKilledLateMs !== null) {
        const after = hl.sendKilledLateMs;
        hl.sendKilledLateMs = null;
        if (after === 0) {
          convo.push(msg);
          took.push({ channel, body: String(b.message), at: clock.now });
        } else if (after > 0) late.push({ at: clock.now + after, msg: { ...msg }, channel });
        killed++;
        // The function is gone: nothing after this await ever runs.
        return await new Promise<Response>(() => {});
      }
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
  await import("./index.ts?m1_chaos_r6_kill");
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
  killed = 0;
  Object.assign(dbFail, { method: "", url: /$^/, body: undefined, times: 0, hit: 0 });
  Object.assign(dbKill, { method: "", url: /$^/, body: undefined, land: false, hit: 0 });
  Object.assign(hl, { send429: false, sendLost: 0, sendLateMs: 0, sendKilledLateMs: null, searchEmpty: 0, searchEmptyAlways: false, pageEmpty: 0, byId404: false, byId503: 0, waStatus: "delivered" });
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
      code: "R6KLMX",
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


const sentRow = () => db.t("cockpit_sales_messages").filter(m => String(m.body ?? "").includes("qrs-tuvw-xyz"));

describe("m1 chaos r6: the function is killed while HighLevel takes the room's link", () => {
  test("HELD: killed, and HighLevel never took it: the link goes on the next try, once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendKilledLateMs = -1;
    await start(id);
    for (let i = 0; i < 8; i++) await minute(id);
    expect({ killed, links_to_lead: linksToLead().length, sent: Boolean(room(id).link_sent_at) }).toEqual({ killed: 1, links_to_lead: 1, sent: true });
  }, 120_000);

  test("HELD: killed after HighLevel took it at once: confirmed from the conversation, once", async () => {
    reset({ gate: false });
    const id = await openRoom();
    hl.sendKilledLateMs = 0;
    await start(id);
    for (let i = 0; i < 8; i++) await minute(id);
    expect({ killed, links_to_lead: linksToLead().length, sent: Boolean(room(id).link_sent_at) }).toEqual({ killed: 1, links_to_lead: 1, sent: true });
  }, 120_000);

  for (const lateS of [150, 200, 240, 280]) {
    test(`HELD (round 3's fix): the call timed out at 25 s and HighLevel took it at ${lateS} s: once`, async () => {
      reset({ gate: false });
      const id = await openRoom();
      hl.sendLateMs = lateS * 1000;
      await start(id);
      for (let i = 0; i < 8; i++) await minute(id);
      expect({ links_to_lead: linksToLead().length }).toEqual({ links_to_lead: 1 });
    }, 120_000);
  }

  for (const lateS of [110, 150, 200, 240, 280]) {
    test(`m1-chaos-r6-killed-send-taken-late-second-link (email, the gate shut as production is today): the function is killed while HighLevel holds the email, which it takes ${lateS} s after it was asked: the lead must get the link once`, async () => {
      reset({ gate: false });
      const id = await openRoom();
      hl.sendKilledLateMs = lateS * 1000;
      await start(id);
      for (let i = 0; i < 8; i++) await minute(id);
      if (process.env.M1_R6_DEBUG)
        console.log(JSON.stringify({ took, rows: sentRow().map(m => [m.state, m.error]), ev: events(id).map(e => [e.kind, e.text]) }, null, 1));
      expect({
        killed,
        links_to_lead: linksToLead().length,
        sends: linksToLead().map(t => `${t.channel} at +${Math.round((t.at - Date.parse(String(room(id).opened_at))) / 1000)} s`),
      }).toEqual({ killed: 1, links_to_lead: 1, sends: [expect.any(String)] as unknown as string[] });
    }, 120_000);
  }

  test("m1-chaos-r6-killed-send-taken-late-second-link (free text, the gate open): the function is killed while HighLevel holds the WhatsApp link, taken at 240 s: the lead must get the link once", async () => {
    reset({ gate: true });
    const id = await openRoom();
    hl.sendKilledLateMs = 240_000;
    await start(id);
    for (let i = 0; i < 8; i++) await minute(id);
    if (process.env.M1_R6_DEBUG)
      console.log(JSON.stringify({ took, rows: sentRow().map(m => [m.channel, m.state, m.error]), ev: events(id).map(e => [e.kind, e.text]) }, null, 1));
    expect({ killed, links_to_lead: linksToLead().length, channels: linksToLead().map(t => t.channel) }).toEqual({
      killed: 1,
      links_to_lead: 1,
      channels: ["whatsapp"],
    });
  }, 120_000);
});

describe("m1 chaos r6: an answered call closes the room as moved to the phone, and the function is killed in between", () => {
  /** The link went by email a minute ago; the setter rang the lead after it and they talked for two minutes. */
  async function talked(): Promise<string> {
    const id = await openRoom();
    const sentAt = new Date(clock.now).toISOString();
    Object.assign(room(id), { link_sent_at: sentAt, link_claimed_at: sentAt, link_channels: ["email"], lead_by: new Date(clock.now + 10 * 60_000).toISOString() });
    db.t("cockpit_sales_room_events").find(e => e.room_id === id && e.kind === "worker.ready")!.handled_at = sentAt;
    shift += 60_000;
    db.seed("cockpit_sales_attempts", [
      {
        id: crypto.randomUUID(),
        contact_id: LEAD,
        rep_email: REP,
        started_at: new Date(clock.now - 30_000).toISOString(),
        state: "saved",
        call_state: "completed",
        call_duration_s: 120,
        outcome: "rescheduled",
      },
    ]);
    return id;
  }
  const endAudits = (id: string) => db.t("cockpit_audit_log").filter(a => a.entity_id === id && a.action === "room.end");
  const endLines = (id: string) => events(id).filter(e => e.kind === "room.end");

  test("HELD: nothing killed: the room closes as moved to the phone with its line and its audit row", async () => {
    reset({ gate: false });
    const id = await talked();
    await minute(id);
    expect({ state: room(id).state, result: room(id).result, lines: endLines(id).length, audits: endAudits(id).length }).toEqual({
      state: "cancelled",
      result: "moved_to_phone",
      lines: 1,
      audits: 1,
    });
  }, 120_000);

  for (const at of [
    { what: "its line's insert (it never landed)", url: /cockpit_sales_room_events\?on_conflict=dedupe_key/, body: /"room\.end"/, land: false },
    { what: "the audit row's insert (it never landed)", url: /cockpit_audit_log/, body: /"room\.end"/, land: false },
  ]) {
    test(`m1-chaos-r6-phone-close-killed-after-room-write-no-audit-row: the function is killed at ${at.what} after the room closed as moved to the phone: the close must still leave its audit row and line`, async () => {
      reset({ gate: false });
      const id = await talked();
      Object.assign(dbKill, { method: "POST", url: at.url, body: at.body, land: at.land, hit: 0 });
      await minute(id);
      // Ten more minutes of cron, nothing failing.
      for (let i = 0; i < 10; i++) await minute(id);
      expect({
        killed: dbKill.hit,
        state: room(id).state,
        result: room(id).result,
        lines: endLines(id).length,
        audits: endAudits(id).length,
      }).toEqual({ killed: 1, state: "cancelled", result: "moved_to_phone", lines: 1, audits: 1 });
    }, 120_000);
  }
});

describe("m1 chaos r6: a worker.failed line the worker closed as not true, on a room that opened", () => {
  test("m1-chaos-r6-killed-after-failed-line-room-made-timeline-says-not-made (the panel's read): room.status returns the closed line's words under the open room", async () => {
    reset({ gate: false });
    const id = await openRoom();
    // The worker stored "The room was not made" and closed it once the room
    // opened after all (round 4c's fix: handled, detail.closed_by worker).
    db.seed("cockpit_sales_room_events", [
      {
        room_id: id,
        kind: "worker.failed",
        source: "worker",
        dedupe_key: `worker.failed:${id}`,
        at: new Date(clock.now - 30_000).toISOString(),
        handled_at: new Date(clock.now).toISOString(),
        text: "The room was not made. Zoom did not answer. Try again in a minute, or use Meet.",
        detail: { error: "Zoom did not answer. Try again in a minute, or use Meet.", closed_by: "worker", closed_why: "the room opened after all" },
      },
    ]);
    await start(id);
    const out = await call({ action: "room.status", room_id: id });
    const said = ((out.body.events as Row[] | undefined) ?? []).map(e => String(e.text));
    expect({ status: out.status, state: (out.body.room as Row | undefined)?.state, not_made_lines: said.filter(t => /not made/i.test(t)) }).toEqual({
      status: 200,
      state: "open",
      not_made_lines: [],
    });
  }, 120_000);
});

describe("m1 chaos r6: the link left to the rep at ten minutes, and one blip on the lead's wait", () => {
  // HighLevel takes no send for the link's ten minutes of re-asks (its burst
  // limit, 429), so at the claim + 10 minutes sales-api says it final:
  // "Copy the link and send it another way", and starts the lead's ten
  // minutes for the rep's own delivery (startLeadWait: lead_by now + 10
  // minutes, m1 round 4 and 5). startLeadWait is "never fatal": one 503 on
  // its PATCH and lead_by stays empty, and nothing writes it again (the
  // re-ask stops at a final refusal). The sweep's R4 then closes the room
  // from the open + 10 minutes (already past), as link_not_sent, at its
  // next minute (migrations/tests/m1_chaos_r6.py), and the room worker
  // deletes its Zoom meeting: the link the rep was just told to send by hand
  // is dead.
  async function finalAt10(blip: boolean): Promise<string> {
    reset({ gate: false });
    const id = await openRoom();
    hl.send429 = true;
    await start(id);
    for (let i = 0; i < 12; i++) {
      if (blip && i === 9) Object.assign(dbFail, { method: "PATCH", url: /cockpit_sales_rooms\?id=eq\./, body: /"lead_by"/, times: 1, hit: 0 });
      await minute(id);
    }
    return id;
  }

  test("HELD: no blip: the final refusal starts the lead's ten minutes (lead_by)", async () => {
    const id = await finalAt10(false);
    const r = room(id);
    expect({ final: /send it another way|did not take the link in 10 minutes/i.test(String(r.refusal)), lead_by: Boolean(r.lead_by), sent: Boolean(r.link_sent_at) }).toEqual({
      final: true,
      lead_by: true,
      sent: false,
    });
  }, 120_000);

  test("m1-chaos-r6-final-refusal-lead-wait-blip-room-closed-under-hand-sent-link: one 503 on the lead's wait at the final refusal: lead_by must still be set (the rep's ten minutes to deliver the link)", async () => {
    const id = await finalAt10(true);
    const r = room(id);
    if (process.env.M1_R6_DEBUG) console.log(JSON.stringify({ r, ev: events(id).map(e => [e.kind, e.text]) }, null, 1));
    expect({
      blip: dbFail.hit,
      final: /did not take the link in 10 minutes/i.test(String(r.refusal)),
      lead_by: Boolean(r.lead_by),
    }).toEqual({ blip: 1, final: true, lead_by: true });
  }, 120_000);
});
