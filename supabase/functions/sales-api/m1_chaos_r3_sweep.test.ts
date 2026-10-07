// bun test supabase/functions/sales-api/m1_chaos_r3_sweep.test.ts
//
// Milestone 1, video-link round 3, chaos: one outside call at every step of
// the video link, through the real handler and the real message service
// (index.ts convoSend, its slot, its stamp and its read-back), where round 1
// swept the database with a fake message service. Every fetch the handler
// makes after the worker's worker.ready reaches it (the database's PostgREST
// and functions, and HighLevel) is, in turn:
//   - db fail: a 503 and nothing done;
//   - db lost: the write lands and the answer never comes (a timeout);
//   - db kill: it never answers (a deploy, the wall-clock limit);
//   - hl fail: a 503 and nothing done;
//   - hl lost: HighLevel does it and the answer never comes;
//   - hl garbage: a gateway's HTML page with a 200 (HighLevel did it);
//   - hl 429: HighLevel's rate limit, nothing done.
// Then the cron runs as in production: every minute the sweep replays the
// worker events nobody handled (20 s on) and posts the room's tick.
//
// What must hold for the lead and the rep (the pilot's settings, the test
// lead, short link off):
//   - the link reaches the lead once, never twice;
//   - it goes within two minutes of the room opening, or the room says why;
//   - the room says what happened: link_sent_at when it went, never "sent"
//     about a link that did not go.
//
// Every lead, seat and link is invented; nothing leaves this process.
// M1_R3_SWEEP_MODES=db_lost,hl_lost narrows the modes; M1_R3_SWEEP_GATE=open|shut the gate.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-m1chaos3s@stress.invalid";
const LEAD = "stress-m1chaos3-sweep-0001";
const JOIN = "https://meet.google.com/swp-qrst-uvw";
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
const took: { channel: string; body: string; at: number }[] = [];
let lastInboundAt = 0;

type Mode = "db_fail" | "db_lost" | "db_kill" | "hl_fail" | "hl_lost" | "hl_garbage" | "hl_429";
const fault = { armed: false, at: -1, mode: "db_fail" as Mode, n: 0, hit: "" };
/** The first send of the link lands at HighLevel and its answer is lost (the second sweep's starting point). */
let loseFirstSend = false;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function timeout(): Error {
  return Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
}
const never = () => new Promise<Response>(() => {});

async function dbAnswer(url: string, init: RequestInit, method: string): Promise<Response> {
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

function hlAnswer(url: string, init: RequestInit, method: string): Response {
  const path = url.slice(GHL.length);
  if (method === "GET" && /^\/contacts\/[^/]+\/appointments/.test(path)) return reply({ events: [] });
  if (method === "GET" && path.startsWith("/contacts/")) {
    const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
    return reply({
      contact: { id, firstName: "Huda", name: "Huda Ali", email: "huda@example.com", phone: "+96550000000", tags: [], country: "KW", dnd: false, dndSettings: {} },
    });
  }
  if (method === "GET" && path.startsWith("/conversations/search"))
    return reply({
      conversations: [{ id: "conv-1", contactId: LEAD, lastInboundWhatsappMessageDate: lastInboundAt ? new Date(lastInboundAt).toISOString() : null }],
      total: 1,
    });
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
    if (loseFirstSend) {
      loseFirstSend = false;
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
    const limit = Number(new URL(`${GHL}${path}`).searchParams.get("limit") ?? 20);
    const page = [...convo].sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded)).slice(0, limit);
    return reply({ messages: { messages: page, nextPage: convo.length > limit, lastMessageId: page.at(-1)?.id ?? null } });
  }
  return reply({ ok: true });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const isDb = url.startsWith(`${DB}/rest/v1/`);
  const isHl = url.startsWith(GHL);
  if (!isDb && !isHl) throw new Error(`no fake for ${method} ${url}`);
  const k = fault.n++;
  if (fault.armed && k === fault.at) {
    const m = fault.mode;
    const mine = m.startsWith("db_") ? isDb : isHl;
    if (mine) {
      fault.hit = `${method} ${url.replace(DB, "").replace(GHL, "HL").split("?")[0]}`;
      if (m === "db_fail") return reply({ message: "scripted outage" }, 503);
      if (m === "db_kill") return await never();
      if (m === "db_lost") {
        await dbAnswer(url, init, method);
        shift += 8_000;
        throw timeout();
      }
      if (m === "hl_fail") return reply({ message: "Service Unavailable" }, 503);
      if (m === "hl_429") return reply({ message: "Too many requests" }, 429);
      if (m === "hl_lost") {
        hlAnswer(url, init, method);
        shift += 15_000;
        throw timeout();
      }
      if (m === "hl_garbage") {
        hlAnswer(url, init, method);
        return new Response("<html><body>Bad gateway</body></html>", { status: 200, headers: { "content-type": "text/html" } });
      }
    } else {
      // The fault is for the other side: the next call of that side takes it.
      fault.at = k + 1;
    }
  }
  if (isDb) return await dbAnswer(url, init, method);
  return hlAnswer(url, init, method);
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
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (typeof ms === "number" && ms >= 1000) {
      shift += ms;
      return realSetTimeout(fn, 0, ...args);
    }
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout;
  await import("./index.ts?m1_chaos_r3_sweep");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  Date.now = before.now;
  globalThis.setTimeout = realSetTimeout;
});

function reset(gate: boolean): void {
  db.tables = {};
  convo.length = 0;
  took.length = 0;
  Object.assign(fault, { armed: false, at: -1, n: 0, hit: "" });
  loseFirstSend = false;
  shift = Date.parse("2026-10-06T08:00:00Z") - realNow();
  lastInboundAt = clock.now - 60 * 60_000;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    {
      key: "whatsapp_guard",
      value: gate
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

async function call(body: Row, bearer: string): Promise<void> {
  try {
    const res = await (handler as (req: Request) => Promise<Response>)(
      new Request("https://fn.stress.invalid/sales-api", {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    await res.text();
  } catch {
    /* the answer failed: the cron's re-asks are under test */
  }
}
const SERVICE = `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`;
const desk = (body: Row) => call(body, SERVICE);
const pause = (ms: number) => new Promise(r => realSetTimeout(r, ms));
async function quiet(): Promise<void> {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 300 && still < 8; i++) {
    const n = JSON.stringify(db.tables).length + took.length + convo.length + fault.n;
    still = n === last ? still + 1 : 0;
    last = n;
    await pause(25);
  }
}

function openRoom(): string {
  const id = crypto.randomUUID();
  const at = new Date(clock.now).toISOString();
  db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: crypto.randomUUID(),
      code: "R3SWPX",
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
      provider_meeting_id: "swp-qrst-uvw",
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
const linksToLead = () => took.filter(t => t.body.includes("swp-qrst-uvw"));

/** The sweep's E1: worker events nobody handled, 20 s on, not held. */
async function replay(): Promise<void> {
  const ids = db
    .t("cockpit_sales_room_events")
    .filter(
      e =>
        !e.handled_at &&
        ["worker", "zoom", "claim"].includes(String(e.source)) &&
        (!e.lease_until || Date.parse(String(e.lease_until)) <= clock.now) &&
        Date.parse(String(e.at ?? e.created_at ?? new Date(clock.now).toISOString())) <= clock.now - 20_000,
    )
    .map(e => String(e.id));
  if (ids.length) await desk({ action: "room.event", kind: "sweep.replay", payload: { event_ids: ids } });
}

interface Outcome {
  mode: string;
  k: number;
  hit: string;
  deliveries: number;
  minute: number | null;
  sent: boolean;
  refusal: string;
}

async function journey(gate: boolean, mode: Mode | null, k: number): Promise<Outcome & { calls: number }> {
  reset(gate);
  const id = openRoom();
  const opened = clock.now;
  if (mode) Object.assign(fault, { armed: true, at: k, mode, n: 0, hit: "" });
  await Promise.race([desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } }), pause(150)]);
  await quiet();
  const calls = fault.n;
  fault.armed = false;
  for (let i = 0; i < 10; i++) {
    shift += 60_000;
    await replay();
    await quiet();
    await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } });
    await quiet();
  }
  const r = room(id);
  const first = linksToLead()[0];
  return {
    mode: mode ?? "clean",
    k,
    hit: fault.hit,
    calls,
    deliveries: linksToLead().length,
    minute: first ? Math.round((first.at - opened) / 60_000) : null,
    sent: Boolean(r.link_sent_at),
    refusal: String(r.refusal ?? ""),
  };
}

function judge(o: Outcome): string | null {
  const why: string[] = [];
  if (o.deliveries > 1) why.push(`${o.deliveries} links to the lead`);
  if (o.deliveries >= 1 && !o.sent) why.push(`the link went and the room says "${o.refusal || "nothing"}"`);
  if (o.deliveries === 0 && o.sent) why.push("the room says the link went and nothing went");
  if (o.deliveries === 0 && !o.refusal) why.push("no link and no sentence after ten minutes");
  if (o.minute !== null && o.minute > 2) why.push(`the link went ${o.minute} minutes after the room opened`);
  return why.length ? `${o.mode}@${o.k} (${o.hit}): ${why.join("; ")}` : null;
}

/**
 * The link's first send lands and its answer is lost (the room says it may
 * have gone); then one call at every step of the two minutes of re-asks that
 * read the conversation and decide, is failed, lost or killed.
 */
async function journey2(gate: boolean, mode: Mode | null, k: number): Promise<Outcome & { calls: number }> {
  reset(gate);
  const id = openRoom();
  const opened = clock.now;
  loseFirstSend = true;
  await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await quiet();
  if (mode) Object.assign(fault, { armed: true, at: k, mode, n: 0, hit: "" });
  else fault.n = 0;
  let calls = 0;
  for (let i = 0; i < 10; i++) {
    shift += 60_000;
    await replay();
    await quiet();
    await Promise.race([desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } }), pause(150)]);
    await quiet();
    if (i === 2) {
      calls = fault.n;
      fault.armed = false;
    }
  }
  const r = room(id);
  const first = linksToLead()[0];
  return {
    mode: mode ? `lost-send+${mode}` : "lost-send",
    k,
    hit: fault.hit,
    calls,
    deliveries: linksToLead().length,
    minute: first ? Math.round((first.at - opened) / 60_000) : null,
    sent: Boolean(r.link_sent_at),
    refusal: String(r.refusal ?? ""),
  };
}

const MODES: Mode[] = (process.env.M1_R3_SWEEP_MODES?.split(",") as Mode[] | undefined) ?? [
  "db_fail",
  "db_lost",
  "db_kill",
  "hl_fail",
  "hl_lost",
  "hl_garbage",
  "hl_429",
];
const GATES: boolean[] = process.env.M1_R3_SWEEP_GATE === "open" ? [true] : process.env.M1_R3_SWEEP_GATE === "shut" ? [false] : [false, true];

// About half an hour a gate (a dead run is waited for in real time): M1_CHAOS_DEEP=1 bun test ... runs it.
describe.skipIf(!process.env.M1_CHAOS_DEEP)("m1 chaos r3: one outside call at every step of the video link, through the real message service", () => {
  for (const gate of GATES) {
    test(`${gate ? "the WhatsApp gate open (free text)" : "the WhatsApp gate shut (email, as production is today)"}: once, within two minutes, and said right`, async () => {
      const clean = await journey(gate, null, -1);
      expect({ deliveries: clean.deliveries, minute: clean.minute, sent: clean.sent }).toEqual({ deliveries: 1, minute: 0, sent: true });
      const bad: string[] = [];
      for (const mode of MODES) {
        for (let k = 0; k < clean.calls + 1; k++) {
          const o = await journey(gate, mode, k);
          if (!o.hit) continue;
          const b = judge(o);
          if (b) bad.push(b);
        }
      }
      if (bad.length) console.log(bad.join("\n"));
      expect(bad).toEqual([]);
    }, 3_600_000);
  }
});

// About half an hour a gate: M1_CHAOS_DEEP=1 bun test ... runs it.
describe.skipIf(!process.env.M1_CHAOS_DEEP)("m1 chaos r3: the link's answer lost, then one outside call at every step of the re-asks", () => {
  for (const gate of GATES) {
    test(`${gate ? "the WhatsApp gate open (free text)" : "the WhatsApp gate shut (email)"}: once, and said right`, async () => {
      const clean = await journey2(gate, null, -1);
      expect({ deliveries: clean.deliveries, sent: clean.sent }).toEqual({ deliveries: 1, sent: true });
      const bad: string[] = [];
      for (const mode of MODES) {
        for (let k = 0; k < clean.calls + 1; k++) {
          const o = await journey2(gate, mode, k);
          if (!o.hit) continue;
          const why: string[] = [];
          if (o.deliveries > 1) why.push(`${o.deliveries} links to the lead`);
          if (o.deliveries >= 1 && !o.sent) why.push(`the link went and the room says "${o.refusal || "nothing"}"`);
          if (o.deliveries === 0 && o.sent) why.push("the room says the link went and nothing went");
          if (why.length) bad.push(`${o.mode}@${o.k} (${o.hit}): ${why.join("; ")}`);
        }
      }
      if (bad.length) console.log(bad.join("\n"));
      expect(bad).toEqual([]);
    }, 3_600_000);
  }
});
