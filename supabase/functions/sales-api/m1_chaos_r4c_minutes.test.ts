// bun test supabase/functions/sales-api/m1_chaos_r4c_minutes.test.ts
//
// Milestone 1, video-link round 4 (chaos, second pass). Round 4's matrix
// (m1_chaos_r4_matrix.test.ts) faults one outside call of the link's FIRST
// send and then lets ten clean minutes run. This file faults the minutes
// after it: the sweep's replay and the room's tick (the re-ask of a link
// that may have gone, the conversation check, the recheck of a link that
// went, the back-up on the other lane), with the k-th outside call of minute
// M (the database, an RPC or HighLevel) failed before it lands, landed with
// its answer lost, answered with a gateway's HTML page, or never answered
// (the function killed by a deploy), on top of a first send that went
// cleanly or whose answer was lost.
//
// The same world as round 4's matrix (HighLevel keeps the lead's
// conversation; the handler's long sleeps move the fake clock), the pilot's
// settings (rooms on for the test contact, short link off, settle, wrap and
// count_on_join off, live handover off), the WhatsApp gate shut (email, as
// production is today) and open (free text inside the window).
//
// What the lead and the closer need: the link once, never twice; the room
// never says the link went when it did not, nor that it did not when it did;
// a sentence when it did not.
//
// Every lead, seat and link is invented; nothing leaves this process.
// M1_CHAOS_R4C=1 bun test supabase/functions/sales-api/m1_chaos_r4c_minutes.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CLOSER = "closer-m1chaos4c@stress.invalid";
const LEAD = "stress-m1chaos4c-mx-0001";
// M1_R4C_PROVIDER=meet: the setter's default, a Meet room (its link can be read out, so a late one still goes).
const MEET = process.env.M1_R4C_PROVIDER === "meet";
const MEETING = MEET ? "kqv-wmzx-pdr" : "85099887766";
const JOIN = MEET ? `https://meet.google.com/${MEETING}` : `https://us06web.zoom.us/j/${MEETING}?pwd=c3RyZXNzcGFzcw`;
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
const waiting = new Set<Promise<unknown>>();

interface GhlMsg {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string;
  dateAdded: string;
  status: string;
}
const convo: GhlMsg[] = [];
/** Every send HighLevel took (it reached the lead), with when. */
const took: { channel: string; body: string; at: number }[] = [];
let lastInboundAt = 0;

type Mode = "fail" | "lost" | "garbage" | "kill";
interface Fault { minute: number; k: number; mode: Mode; match?: RegExp }
/** Everything matching `target` from minute `from` through minute `to` (an outage). */
interface Outage { from: number; to: number; target: RegExp; mode: Mode }
const outages: Outage[] = [];
const fault = { list: [] as Fault[], minute: 0, n: 0, seen: [] as string[][], counting: false, hit: [] as string[] };

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const htmlPage = () => new Response("<html><body>502 Bad Gateway</body></html>", { status: 200, headers: { "content-type": "text/html" } });
function timeout(): Error {
  return Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
}

async function world(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" });
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
      took.push({ channel, body: String(b.message ?? b.html ?? ""), at: clock.now });
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
  throw new Error(`no fake for ${method} ${url}`);
}

let activity = 0;
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  activity++;
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (!fault.counting) return await world(url, init);
  const mine = fault.n++;
  const label = `${method} ${url.replace(DB, "db").replace(GHL, "ghl").slice(0, 120)}`;
  (fault.seen[fault.minute] ??= []).push(label);
  const nth = (m: RegExp) => (fault.seen[fault.minute] ?? []).filter(l => m.test(l)).length - 1;
  const out = outages.find(o => fault.minute >= o.from && fault.minute <= o.to && o.target.test(label));
  const f = out
    ? { minute: fault.minute, k: mine, mode: out.mode }
    : fault.list.find(x => x.minute === fault.minute && (x.match ? x.match.test(label) && nth(x.match) === x.k : x.k === mine));
  if (!f) return await world(url, init);
  fault.hit.push(`${f.mode}@m${f.minute}#${f.k} ${label}`);
  if (f.mode === "fail") throw new TypeError("fetch failed: connection reset");
  if (f.mode === "kill") return await new Promise<Response>(() => {});
  await world(url, init);
  if (f.mode === "garbage") return htmlPage();
  throw timeout();
}

const before = {
  fetch: globalThis.fetch,
  deno: (globalThis as unknown as { Deno?: unknown }).Deno,
  edge: (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime,
  now: Date.now,
};

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
  (globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = {
    waitUntil: (p: Promise<unknown>) => {
      const q = p.finally(() => waiting.delete(q));
      waiting.add(q);
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  Date.now = () => realNow() + shift;
  // The handler's own long sleeps (the read-back's 2 s, a twin's 1 s polls) move the fake clock.
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (typeof ms === "number" && ms >= 200) {
      shift += ms;
      return realSetTimeout(fn, 0, ...args);
    }
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout;
  await import("./index.ts?m1_chaos_r4c_minutes");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime = before.edge;
  Date.now = before.now;
  globalThis.setTimeout = realSetTimeout;
});

function reset(o: { gate: boolean }): void {
  db.tables = {};
  convo.length = 0;
  took.length = 0;
  waiting.clear();
  Object.assign(fault, { list: [], minute: 0, n: 0, seen: [], counting: false, hit: [] });
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
        count_on_join: false,
        settle: false,
        wrap: false,
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
  ]);
  db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Omar Closer", ghl_user_id: "G-closer", role: "closer", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", tags: [] }]);
  db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
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
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Row };
}
const SERVICE = `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`;
const desk = (body: Row) => call(body, SERVICE);
const pause = (ms: number) => new Promise(r => realSetTimeout(r, ms));
/** Waits for the handler's background work; a killed one never finishes and is left behind (no call made for a while). */
async function drain(): Promise<void> {
  let idle = 0;
  let last = activity;
  for (let i = 0; i < 400 && waiting.size && idle < 4; i++) {
    await Promise.race([Promise.allSettled([...waiting]), pause(10)]);
    if (activity === last) idle++;
    else {
      idle = 0;
      last = activity;
    }
  }
}
/** A request that may hang forever (the function killed): given up on after a moment, as the caller's own timeout would. */
async function bounded<T>(p: Promise<T>): Promise<T | null> {
  return await Promise.race([p.catch(() => null), pause(60).then(() => null)]);
}

/** The closer's Zoom room, made and opened by the worker (its worker.ready stored before the open). */
function openRoom(): string {
  const id = crypto.randomUUID();
  const at = new Date(clock.now).toISOString();
  db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: crypto.randomUUID(),
      code: "R4MXZQ",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "manual",
      call_kind: MEET ? "intro" : "demo",
      provider: MEET ? "meet" : "zoom",
      host_email: CLOSER,
      made_by: CLOSER,
      state: "open",
      version: 3,
      join_url: JOIN,
      provider_meeting_id: MEETING,
      requested_at: at,
      claimed_at: at,
      opened_at: at,
      worker_run: "run-1",
      host_by: new Date(clock.now + 15 * 60_000).toISOString(),
      ends_at: new Date(clock.now + 60 * 60_000).toISOString(),
      link_channels: [],
      link_message_ids: {},
    },
  ]);
  db.seed("cockpit_sales_room_events", [
    { room_id: id, kind: "room.asked", source: "sales-api", dedupe_key: `room.asked:${id}`, handled_at: at, text: "A Zoom room was asked for." },
    { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, text: "Room made on Zoom in 4 s.", detail: { worker_run: "run-1" } },
  ]);
  return id;
}
const room = (id: string) => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
const linksToLead = () => took.filter(t => t.body.includes(MEETING));
const MAY = /may have gone/i;


interface Seen {
  minute: number;
  sent: boolean;
  refusal: string;
}

/** One journey: the faults in `list` (by minute and call), the first send at minute 0, then ten minutes of cron. */
async function journey(list: Fault[], gate: boolean, base: "clean" | "lost" = "clean") {
  reset({ gate });
  const id = openRoom();
  const opened = clock.now;
  Object.assign(fault, { list, minute: 0, n: 0, seen: [], counting: true, hit: [] });
  await bounded(desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } }));
  await drain();
  const seen: Seen[] = [{ minute: 0, sent: Boolean(room(id).link_sent_at), refusal: String(room(id).refusal ?? "") }];
  for (let m = 1; m <= 10; m++) {
    shift += 60_000;
    fault.minute = m;
    fault.n = 0;
    const due = db
      .t("cockpit_sales_room_events")
      .filter(
        e =>
          !e.handled_at &&
          ["worker", "zoom", "claim"].includes(String(e.source)) &&
          (!e.lease_until || Date.parse(String(e.lease_until)) <= clock.now),
      )
      .map(e => String(e.id));
    if (due.length) await bounded(desk({ action: "room.event", kind: "sweep.replay", payload: { event_ids: due } }));
    await drain();
    await bounded(desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } }));
    await drain();
    seen.push({ minute: m, sent: Boolean(room(id).link_sent_at), refusal: String(room(id).refusal ?? "") });
  }
  fault.counting = false;
  void base;
  return {
    seen,
    hit: [...fault.hit],
    calls: fault.seen.map(s => s?.length ?? 0),
    log: fault.seen,
    links: linksToLead().map(t => ({ minute: Math.round((t.at - opened) / 60_000), channel: t.channel })),
    final: room(id),
    events: db.t("cockpit_sales_room_events").filter(e => e.room_id === id).map(e => `${String(e.kind)}: ${String(e.text ?? "")}`),
  };
}

/** One journey with an outage instead of a single fault. */
async function outageJourney(o: Outage, gate: boolean) {
  outages.length = 0;
  outages.push(o);
  try {
    return await journey([], gate);
  } finally {
    outages.length = 0;
  }
}

function judge(name: string, o: Awaited<ReturnType<typeof journey>>): string | null {
  const why: string[] = [];
  const n = o.links.length;
  if (n > 1) why.push(`${n} links to the lead (${o.links.map(l => `${l.channel}@${l.minute}`).join(", ")})`);
  if (n >= 1 && !o.final.link_sent_at) why.push(`the link went and the room says "${String(o.final.refusal ?? "nothing")}"`);
  if (n === 0 && o.final.link_sent_at) why.push("the room says the link went and nothing went");
  if (n === 0 && !o.final.refusal) why.push("no link and no sentence after ten minutes");
  const first = o.links[0]?.minute;
  const notSent = o.seen.find(
    s => !s.sent && s.refusal && !MAY.test(s.refusal) && !/tried again in a minute\.?$/i.test(s.refusal) && (first === undefined || s.minute < first),
  );
  if (notSent && first !== undefined) why.push(`said "${notSent.refusal.slice(0, 90)}" at minute ${notSent.minute}, then the link went at minute ${first}`);
  // A link that went and arrived, later said not to have arrived.
  const after = o.seen.find(s => first !== undefined && s.minute > first && s.refusal && !MAY.test(s.refusal));
  if (after && n === 1) why.push(`the link went at minute ${first} and the room said "${after.refusal.slice(0, 90)}" at minute ${after.minute}`);
  return why.length ? `${name} [${o.hit.join(" | ")}]: ${why.join("; ")}` : null;
}

const SEND = /^POST ghl\/conversations\/messages$/;

describe.skipIf(!process.env.M1_CHAOS_R4C)("m1 chaos r4c: a fault in the minutes after the link's first send", () => {
  for (const [gate, gname] of [
    [false, "gate shut (email)"],
    [true, "gate open (free text)"],
  ] as const) {
    test(`${gname}: once, said right, whatever one later minute's call does`, async () => {
      const clean = await journey([], gate);
      if (process.env.M1_R4C_LOG) console.log(gname, "clean calls per minute", clean.calls, "\n", clean.log.map((l, i) => `m${i}: ${(l ?? []).join("\n    ")}`).join("\n"));
      expect(clean.links.length).toBe(1);
      // The first send's own HighLevel send, its answer lost.
      const sendAt = (clean.log[0] ?? []).findIndex(l => SEND.test(l));
      void sendAt;
      const lostBase = await journey([{ minute: 0, k: 0, mode: "lost", match: SEND }], gate);
      if (process.env.M1_R4C_LOG) console.log(gname, "lost-base hit", lostBase.hit, "links", JSON.stringify(lostBase.links), "events", lostBase.events.join(" / "));
      if (process.env.M1_R4C_LOG) console.log(gname, "lost-base calls per minute", lostBase.calls, "\n", lostBase.log.map((l, i) => `m${i}: ${(l ?? []).join("\n    ")}`).join("\n"));
      const bad: string[] = [];
      const bases: [string, Fault[], number[]][] = [
        ["clean", [], clean.calls],
        ["lost-first-send", [{ minute: 0, k: 0, mode: "lost", match: SEND }], lostBase.calls],
        ["garbage-first-send", [{ minute: 0, k: 0, mode: "garbage", match: SEND }], lostBase.calls],
        ["kill-first-send", [{ minute: 0, k: 0, mode: "kill", match: SEND }], lostBase.calls],
      ];
      const minutes = (process.env.M1_R4C_MINUTES ?? "1,2,3").split(",").map(Number);
      const only = process.env.M1_R4C_BASE;
      for (const [bname, bfaults, calls] of bases.filter(b => !only || b[0] === only)) {
        for (const m of minutes) {
          for (const mode of (process.env.M1_R4C_MODES ?? "fail,lost,garbage,kill").split(",") as Mode[]) {
            for (let k = 0; k < (calls[m] ?? 0) + 1; k++) {
              const o = await journey([...bfaults, { minute: m, k, mode }], gate);
              if (process.env.M1_R4C_PROGRESS) console.log(`${gname} ${bname} m${m} ${mode}@${k}: ${o.links.length} links, sent ${Boolean(o.final.link_sent_at)}`);
              const b = judge(`${gname} ${bname}`, o);
              if (b) {
                bad.push(b);
                if (process.env.M1_R4C_LOG) console.log("BAD", b, "\n  links", JSON.stringify(o.links), "\n  seen", JSON.stringify(o.seen), "\n  events", o.events.join("\n    "));
              }
            }
          }
        }
      }
      console.log(`${gname}: ${bad.length} bad journeys`);
      for (const b of bad) console.log(b);
      expect(bad).toEqual([]);
    }, 3_600_000);
  }
});

describe.skipIf(!process.env.M1_CHAOS_R4C)("m1 chaos r4c: an outage of HighLevel or the database for minutes, from the link's first send", () => {
  const targets: [string, RegExp][] = [
    ["HighLevel", /^\w+ ghl\//],
    ["the database (PostgREST)", /^\w+ db\/rest\/v1\/(?!rpc\/cockpit_sales_whoami)/],
    ["HighLevel's sends only", /^POST ghl\/conversations\/messages$/],
    ["HighLevel's reads only", /^GET ghl\//],
  ];
  for (const [gate, gname] of [
    [false, "gate shut (email)"],
    [true, "gate open (free text)"],
  ] as const) {
    test(`${gname}: once, said right, whatever the outage`, async () => {
      const bad: string[] = [];
      for (const [tname, target] of targets)
        for (const mode of (process.env.M1_R4C_MODES ?? "fail,lost,garbage,kill").split(",") as Mode[])
          for (const from of [0, 1])
            for (const len of [1, 2, 3, 5, 8]) {
              const o = await outageJourney({ from, to: from + len - 1, target, mode }, gate);
              const name = `${gname} ${tname} ${mode} minutes ${from}-${from + len - 1}`;
              const b = judge(name, o);
              if (process.env.M1_R4C_PROGRESS) console.log(`${name}: ${o.links.length} links ${JSON.stringify(o.links)}, sent ${Boolean(o.final.link_sent_at)}, says "${String(o.final.refusal ?? "")}"`);
              if (b) {
                bad.push(b);
                if (process.env.M1_R4C_LOG) console.log("BAD", b, "\n  seen", JSON.stringify(o.seen), "\n  events", o.events.join("\n    "));
              }
            }
      console.log(`${gname}: ${bad.length} bad outage journeys`);
      for (const b of bad) console.log(b);
      expect(bad).toEqual([]);
    }, 3_600_000);
  }
});
