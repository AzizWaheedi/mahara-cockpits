// bun test supabase/functions/sales-api/m1_chaos_r4c_presses.test.ts
//
// Milestone 1, video-link round 4 (chaos, second pass): the rep's own
// presses on the video-link path, through sales-api's real handler, with
// the k-th outside call of the press (the seat check, the database, an RPC,
// HighLevel) failed before it lands, landed with its answer lost, answered
// with a gateway's HTML page, or never answered (the function killed by a
// deploy). The rep then presses once more as the cockpit does (the same
// request id after an answer that may have landed, a new one after a
// refusal), the room worker makes what was asked for, and ten minutes of
// cron run (the sweep's replay and the room's tick).
//
//   - Send a video link (room.create, the closer's Zoom room from the lead
//     page): one room, one meeting, the link once, and a sentence when no
//     room was made.
//   - I can't let them in (room.end admit_blocked on the closer's Meet room
//     whose link went): the lead's room closed once, one replacement on
//     Zoom, its link once, and a sentence when no replacement was made.
//
// The world is round 4's matrix world (HighLevel keeps the lead's
// conversation), the pilot's settings, the WhatsApp gate shut (email, as
// production is today) and open. Every lead, seat and link is invented.
// M1_CHAOS_R4C=1 bun test supabase/functions/sales-api/m1_chaos_r4c_presses.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CLOSER = "closer-m1chaos4p@stress.invalid";
const LEAD = "stress-m1chaos4p-mx-0001";
const MEETING = "85099887766";
const JOIN = `https://us06web.zoom.us/j/${MEETING}?pwd=c3RyZXNzcGFzcw`;
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
  const f = fault.list.find(x => x.minute === fault.minute && (x.match ? x.match.test(label) && nth(x.match) === x.k : x.k === mine));
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
  await import("./index.ts?m1_chaos_r4c_presses");
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
      code: "R4PRSQ",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "manual",
      call_kind: "demo",
      provider: "zoom",
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



const S = (n: number) => n * 1000;
type Answer = { status: number; body: Row } | null;

function seedWorker(): void {
  db.seed("cockpit_sales_worker_status", [
    { worker: "sales-desk", job: "rooms", ok: true, at: new Date(clock.now).toISOString(), detail: "Made 0 rooms." },
  ]);
}

/** The room worker on the VPS: every requested room is claimed, made and opened, then sales-api is told (as the worker does). */
async function workerMakes(): Promise<string[]> {
  const made: string[] = [];
  for (const r of db.t("cockpit_sales_rooms").filter(x => x.state === "requested")) {
    const id = String(r.id);
    const zoom = r.provider === "zoom";
    const meeting = zoom ? `8509${String(made.length + 1).padStart(7, "0")}` : `abc-defg-h${made.length}j`;
    const join = zoom ? `https://us06web.zoom.us/j/${meeting}?pwd=c3RyZXNz${made.length}` : `https://meet.google.com/${meeting}`;
    await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: new Date(clock.now).toISOString(), worker_run: "run-p", version: Number(r.version) + 1 },
      prefer: "return=representation",
    });
    await db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-p" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    const cur = db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
    await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-p`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: join,
        provider_meeting_id: meeting,
        opened_at: new Date(clock.now).toISOString(),
        host_by: new Date(clock.now + 15 * 60_000).toISOString(),
        ends_at: new Date(clock.now + 60 * 60_000).toISOString(),
        version: Number(cur.version) + 1,
      },
      prefer: "return=representation",
    });
    made.push(id);
    await bounded(desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-p" } }));
    await drain();
  }
  return made;
}

/** Ten minutes of cron: the sweep replays unhandled worker events, fails rooms nobody made, and ticks every room of the lead. */
async function minutes(n = 10): Promise<void> {
  for (let m = 1; m <= n; m++) {
    shift += 60_000;
    const due = db
      .t("cockpit_sales_room_events")
      .filter(e => !e.handled_at && ["worker", "zoom", "claim"].includes(String(e.source)) && (!e.lease_until || Date.parse(String(e.lease_until)) <= clock.now))
      .map(e => String(e.id));
    if (due.length) await bounded(desk({ action: "room.event", kind: "sweep.replay", payload: { event_ids: due } }));
    await drain();
    // R1: a room still requested at 60 s is failed by the sweep.
    for (const r of db.t("cockpit_sales_rooms").filter(x => x.state === "requested" && Date.parse(String(x.requested_at)) + S(60) < clock.now))
      Object.assign(r, { state: "failed", result: "failed", error: "Not made: the room worker did not pick this room up in time.", ended_at: new Date(clock.now).toISOString(), version: Number(r.version) + 1 });
    const ids = db.t("cockpit_sales_rooms").filter(x => x.contact_id === LEAD).map(x => String(x.id));
    if (ids.length) await bounded(desk({ action: "room.event", kind: "tick", payload: { room_ids: ids } }));
    await drain();
  }
}

const uncertain = (a: Answer) => a === null || a.status === 0 || a.status >= 500;
const said = (a: Answer) => (a ? String(a.body.error ?? a.body.message ?? a.body.replacement_refusal ?? "") : "");
const linksOf = (join: unknown) => took.filter(t => typeof join === "string" && join && t.body.includes(String(join).split("?")[0].split("/").pop() as string));

// ---- Send a video link ------------------------------------------------------------

async function createJourney(k: number, mode: Mode, gate: boolean) {
  reset({ gate });
  seedWorker();
  const body = (rid: string) => ({ action: "room.create", request_id: rid, contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "manual" });
  const first = crypto.randomUUID();
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call(body(first)));
  await drain();
  fault.minute = 99;
  // The rep presses once more: the held id after an answer that may have landed, a new one after a refusal.
  const again = a1 && a1.status === 200 ? null : uncertain(a1) ? first : crypto.randomUUID();
  const a2: Answer = again ? await bounded(call(body(again))) : null;
  await drain();
  const made = await workerMakes();
  await minutes();
  fault.counting = false;
  const rooms = db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD);
  return {
    hit: [...fault.hit],
    calls: fault.seen[0]?.length ?? 0,
    a1,
    a2,
    rooms,
    made,
    links: rooms.map(r => linksOf(r.join_url).length),
    audits: db.t("cockpit_audit_log").filter(a => a.action === "room.create").length,
  };
}

function judgeCreate(name: string, o: Awaited<ReturnType<typeof createJourney>>): string | null {
  const why: string[] = [];
  if (o.rooms.length > 1) why.push(`${o.rooms.length} rooms for one press (${o.rooms.map(r => r.state).join(", ")})`);
  if (o.made.length > 1) why.push(`${o.made.length} meetings made`);
  const total = took.filter(t => t.body.includes("zoom.us/j/")).length;
  if (total > 1) why.push(`${total} links to the lead`);
  const room = o.rooms.find(r => r.state !== "failed");
  if (room && linksOf(room.join_url).length === 0 && !room.refusal) why.push("a room was made and no link went, with no sentence");
  // A room made with no room.create audit row when the audit insert itself
  // blips is round 3's audit-insert-blip-leaves-zero-rows (known): not judged here.
  const last = o.a2 ?? o.a1;
  if (!room && (!last || last.status === 200 || !said(last))) why.push(`no room and the rep's last press said ${last ? `"${said(last) || last.status}"` : "nothing (no answer)"}`);
  return why.length ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 80)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 80)}": ${why.join("; ")}` : null;
}

// ---- I can't let them in ----------------------------------------------------------

/** The closer's Meet room for the lead (lead page), its link sent by email, open. */
async function meetRoomWithLink(): Promise<string> {
  const id = crypto.randomUUID();
  const at = new Date(clock.now).toISOString();
  db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: crypto.randomUUID(),
      code: "R4MEET",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "manual",
      call_kind: "demo",
      provider: "meet",
      host_email: CLOSER,
      made_by: CLOSER,
      state: "open",
      version: 3,
      join_url: "https://meet.google.com/qrs-tuvw-xyz",
      provider_meeting_id: "qrs-tuvw-xyz",
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
    { room_id: id, kind: "room.asked", source: "sales-api", dedupe_key: `room.asked:${id}`, handled_at: at, text: "A Meet room was asked for." },
    { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, text: "Room made on Meet in 3 s.", detail: { worker_run: "run-1" } },
  ]);
  await desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await drain();
  shift += 90_000;
  return id;
}

async function admitJourney(k: number, mode: Mode, gate: boolean) {
  reset({ gate });
  seedWorker();
  const id = await meetRoomWithLink();
  const before = took.length;
  const meetLinks = linksOf("https://meet.google.com/qrs-tuvw-xyz").length;
  const version = Number((db.t("cockpit_sales_rooms").find(r => r.id === id) as Row).version);
  const press = () => call({ action: "room.end", room_id: id, version, reason: "admit_blocked" });
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(press());
  await drain();
  fault.minute = 99;
  // No replacement in the answer: the panel offers the press again (Try Zoom) or the rep presses again.
  const again = !(a1 && a1.status === 200 && a1.body.replacement);
  const a2: Answer = again ? await bounded(press()) : null;
  await drain();
  const made = await workerMakes();
  await minutes();
  fault.counting = false;
  const rooms = db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD);
  const old = rooms.find(r => r.id === id) as Row;
  const repl = rooms.filter(r => r.id !== id);
  return { hit: [...fault.hit], calls: fault.seen[0]?.length ?? 0, a1, a2, old, repl, made, meetLinks, newLinks: took.length - before };
}

function judgeAdmit(name: string, o: Awaited<ReturnType<typeof admitJourney>>): string | null {
  const why: string[] = [];
  if (o.meetLinks !== 1) why.push(`the Meet link went ${o.meetLinks} times before the press`);
  if (o.repl.length > 1) why.push(`${o.repl.length} replacement rooms`);
  const live = o.repl.filter(r => r.state !== "failed");
  for (const r of live) {
    const n = linksOf(r.join_url).length;
    if (n > 1) why.push(`the replacement's link went ${n} times`);
    if (n === 0 && !r.refusal) why.push(`the replacement (${String(r.state)}) has no link and no sentence`);
  }
  if (o.newLinks > live.length) why.push(`${o.newLinks} messages to the lead after the press for ${live.length} replacement(s)`);
  const last = o.a2 ?? o.a1;
  if (!live.length && ["ended", "expired", "cancelled"].includes(String(o.old.state)) && (!last || !said(last)))
    why.push(`the lead's room is ${String(o.old.state)} with no replacement, and the rep's last press said ${last ? `"${said(last) || last.status}"` : "nothing"}`);
  if (live.length && !["ended", "expired", "cancelled"].includes(String(o.old.state))) why.push(`a replacement exists and the lead's Meet room is still ${String(o.old.state)}`);
  return why.length ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 80)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 80)}": ${why.join("; ")}` : null;
}

const modes = () => (process.env.M1_R4C_MODES ?? "fail,lost,garbage,kill").split(",") as Mode[];

describe.skipIf(!process.env.M1_CHAOS_R4C)("m1 chaos r4c: the rep's presses with one outside call faulted", () => {
  for (const [gate, gname] of [
    [false, "gate shut (email)"],
    [true, "gate open (free text)"],
  ] as const) {
    test(`Send a video link, ${gname}: one room, one link, or a sentence`, async () => {
      const clean = await createJourney(-1, "fail", gate);
      expect(judgeCreate("clean", clean)).toBeNull();
      if (process.env.M1_R4C_LOG) console.log("create calls", clean.calls, "\n  ", (fault.seen[0] ?? []).join("\n   "));
      const bad: string[] = [];
      for (const mode of modes())
        for (let k = 0; k < clean.calls + 1; k++) {
          const b = judgeCreate(`create ${gname} ${mode}@${k}`, await createJourney(k, mode, gate));
          if (b) bad.push(b);
        }
      for (const b of bad) console.log(b);
      expect(bad).toEqual([]);
    }, 3_600_000);

    test(`I can't let them in, ${gname}: one replacement, its link once, or a sentence`, async () => {
      const clean = await admitJourney(-1, "fail", gate);
      expect(judgeAdmit("clean", clean)).toBeNull();
      if (process.env.M1_R4C_LOG) console.log("admit calls", clean.calls, "\n  ", (fault.seen[0] ?? []).join("\n   "));
      const bad: string[] = [];
      for (const mode of modes())
        for (let k = 0; k < clean.calls + 1; k++) {
          const b = judgeAdmit(`admit ${gname} ${mode}@${k}`, await admitJourney(k, mode, gate));
          if (b) bad.push(b);
        }
      for (const b of bad) console.log(b);
      expect(bad).toEqual([]);
    }, 3_600_000);
  }
});

// ---- the worker's status row after a settings blip at its run's start --------------
// hermes/sales-desk/tests/test_m1_chaos_r4c.py SettingsBlipAtRunStart: a run
// whose first read of the rooms setting failed fast wrote "Not making rooms"
// in its first second and kept it for 25 s, while its next tick read the
// setting and made rooms. sales-api reads that row at every press and cannot
// tell a blip's row from a real one, so the fix is the worker's: a run whose
// reads all failed writes no row for its first SETTINGS_GRACE_S (the last
// run's row stands), reads again at once, and writes again as soon as a read
// works. This test was corrected to seed what the fixed worker leaves in that
// moment; a "Not making rooms" row past the grace is still refused (control).
describe("m1 chaos r4c: the worker's 'Not making rooms' row from a settings blip at its run's start", () => {
  test("m1-chaos-r4c-settings-blip-at-run-start-refuses-presses: in a blip at a run's start the last run's row stands, and the press makes a room", async () => {
    reset({ gate: false });
    db.seed("cockpit_sales_worker_status", [
      {
        worker: "sales-desk",
        job: "rooms",
        ok: true,
        at: new Date(clock.now - 27_000).toISOString(),
        detail: "Working. No rooms were asked for in the last 25 seconds.",
      },
    ]);
    const out = await call({ action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "manual" });
    await drain();
    expect({ status: out.status, said: String(out.body.error ?? "") }).toEqual({ status: 200, said: "" });
  });

  test("control: a run that could not read the setting past its grace says so, and the press is refused", async () => {
    reset({ gate: false });
    db.seed("cockpit_sales_worker_status", [
      {
        worker: "sales-desk",
        job: "rooms",
        ok: false,
        at: new Date(clock.now - 3_000).toISOString(),
        detail:
          "Not making rooms: The rooms setting could not be read, so no new room is made until it can be. Working. No rooms were asked for in the last 11 seconds. The database did not answer 11 times; the worker kept trying.",
      },
    ]);
    const out = await call({ action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "manual" });
    await drain();
    expect(out.status).toBe(503);
  });
});

// ---- the rep's other presses on a Meet room whose link went -----------------------
// I'm in the room, The lead is in, then End / We are on the phone / Finished,
// each with one outside call faulted and pressed again as the panel does
// (the version it holds; a stale answer reads the room again and presses once more).

type Press = { action: "room.mark"; what: "host_in" | "lead_in" } | { action: "room.end"; reason: "end" | "on_phone" | "finished" };

async function pressJourney(press: Press, k: number, mode: Mode, gate: boolean) {
  reset({ gate });
  seedWorker();
  const id = await meetRoomWithLink();
  const roomNow = () => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  // The presses before this one, clean.
  if (press.action === "room.end" || press.what === "lead_in")
    await call({ action: "room.mark", room_id: id, version: Number(roomNow().version), what: "host_in" });
  if (press.action === "room.end") await call({ action: "room.mark", room_id: id, version: Number(roomNow().version), what: "lead_in" });
  await drain();
  const before = { state: String(roomNow().state), version: Number(roomNow().version), links: took.length };
  const body = (v: number) =>
    press.action === "room.mark"
      ? { action: "room.mark", room_id: id, version: v, what: press.what }
      : { action: "room.end", room_id: id, version: v, reason: press.reason, confirm: true };
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call(body(before.version)));
  await drain();
  fault.minute = 99;
  let a2: Answer = null;
  if (!a1 || a1.status !== 200) {
    a2 = await bounded(call(body(before.version)));
    // Stale: the panel reads the room again and presses once more on what it shows.
    if (a2 && a2.status === 409 && /changed a moment ago/i.test(said(a2))) a2 = await bounded(call(body(Number(roomNow().version))));
  }
  await drain();
  await minutes(3);
  fault.counting = false;
  const audits = db.t("cockpit_audit_log").filter(a => a.entity_id === id && (String(a.action) === `room.mark.${(press as { what?: string }).what}` || String(a.action) === "room.end"));
  return { hit: [...fault.hit], calls: fault.seen[0]?.length ?? 0, a1, a2, final: roomNow(), before, audits: audits.length, newLinks: took.length - before.links };
}

function judgePress(name: string, press: Press, o: Awaited<ReturnType<typeof pressJourney>>): string | null {
  const why: string[] = [];
  const want = press.action === "room.mark" ? press.what : "ended";
  if (String(o.final.state) !== want) why.push(`the room is ${String(o.final.state)}, not ${want}`);
  const last = o.a2 ?? o.a1;
  if (!last || last.status !== 200) why.push(`the rep's last press answered ${last ? `${last.status} "${said(last)}"` : "nothing"}`);
  // The audit insert's own blip leaving no row is round 3's audit-insert-blip-leaves-zero-rows (known).
  const auditBlip = o.hit.some(h => /POST db\/rest\/v1\/cockpit_audit_log$/.test(h));
  if (o.audits !== 1 && !(o.audits === 0 && auditBlip)) why.push(`${o.audits} audit rows for the press`);
  if (o.newLinks) why.push(`${o.newLinks} messages to the lead`);
  return why.length ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 60)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 60)}": ${why.join("; ")}` : null;
}

describe.skipIf(!process.env.M1_CHAOS_R4C)("m1 chaos r4c: the room panel's presses with one outside call faulted", () => {
  const presses: [string, Press][] = [
    ["I'm in the room", { action: "room.mark", what: "host_in" }],
    ["The lead is in", { action: "room.mark", what: "lead_in" }],
    ["End room", { action: "room.end", reason: "end" }],
    ["We are on the phone", { action: "room.end", reason: "on_phone" }],
    ["Finished", { action: "room.end", reason: "finished" }],
  ];
  for (const [pname, press] of presses)
    test(`${pname}: the room moves once, the rep is answered, one audit row`, async () => {
      const clean = await pressJourney(press, -1, "fail", false);
      expect(judgePress("clean", press, clean)).toBeNull();
      const bad: string[] = [];
      for (const mode of modes())
        for (let k = 0; k < clean.calls + 1; k++) {
          const b = judgePress(`${pname} ${mode}@${k}`, press, await pressJourney(press, k, mode, false));
          if (b) bad.push(b);
        }
      for (const b of bad) console.log(b);
      expect(bad).toEqual([]);
    }, 3_600_000);
});
