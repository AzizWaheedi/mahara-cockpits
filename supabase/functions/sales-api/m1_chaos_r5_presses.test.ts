// bun test supabase/functions/sales-api/m1_chaos_r5_presses.test.ts
//
// Milestone 1, video-link round 5 (chaos). The rep's presses round 4c did
// not fault, through sales-api's real handler, with the k-th outside call of
// the press (the seat check, the database, an RPC, HighLevel) failed before
// it lands, landed with its answer lost, answered with a gateway's HTML
// page, or never answered (the function killed by a deploy):
//
//   - Also send by email (room.send) on a room whose link went by WhatsApp;
//   - That was not the lead (room.mark not_lead) after The lead is in;
//   - Cancel (room.end cancel) on a room the worker has not made yet.
//
// The rep then presses once more as the cockpit does (the same request id
// after an answer that may have landed; the version it holds, and the
// room read again after "This changed a moment ago"), the room worker makes
// what is still asked for, and ten minutes of cron run (the sweep's replay
// and the room's tick).
//
// The world is round 4c's (HighLevel keeps the lead's conversation), the
// pilot's settings, the WhatsApp gate open (free text inside the window).
// Every lead, seat and link is invented; nothing leaves this process.
// M1_CHAOS_R5=1 bun test supabase/functions/sales-api/m1_chaos_r5_presses.test.ts
//
// The matrices (behind M1_CHAOS_R5, a few seconds each) found, pinned below
// as single-fault tests that run every time (a failing test is a finding):
//   - m1-chaos-r5-also-send-email-channel-write-blip-room-says-not-emailed
//   - m1-chaos-r5-also-send-email-went-answered-did-not-work-no-audit-row
//   - m1-chaos-r5-send-email-open-check-blip-says-room-closed
//   - m1-chaos-r5-also-send-email-killed-after-highlevel-took-it-never-recorded
//   - m1-chaos-r5-not-lead-killed-after-write-retry-no-audit-row
// Cancel before the room is made and Use Meet held at every fault.
// M1_CHAOS_R4C=1 bun test supabase/functions/sales-api/m1_chaos_r4c_presses.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CLOSER = "closer-m1chaos5p@stress.invalid";
const LEAD = "stress-m1chaos5p-mx-0001";
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
  await import("./index.ts?m1_chaos_r5_presses");
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


const modes = () => (process.env.M1_R5_MODES ?? "fail,lost,garbage,kill").split(",") as Mode[];

const MEET_CODE = "qrs-tuvw-xyz";
const emailsWithLink = () => took.filter(t => t.channel === "email" && t.body.includes(MEET_CODE));
const textsWithLink = () => took.filter(t => t.channel === "whatsapp" && t.body.includes(MEET_CODE));
const audits = (id: string, action: string) => db.t("cockpit_audit_log").filter(a => a.entity_id === id && a.action === action);
const auditBlip = (hit: string[]) => hit.some(h => /POST db\/rest\/v1\/cockpit_audit_log$/.test(h));

// ---- Also send by email -------------------------------------------------------------

async function emailJourney(k: number, mode: Mode) {
  reset({ gate: true });
  seedWorker();
  const id = await meetRoomWithLink();
  const textsBefore = textsWithLink().length;
  const emailsBefore = emailsWithLink().length;
  const body = (rid: string) => ({ action: "room.send", room_id: id, channel: "email", request_id: rid });
  const first = crypto.randomUUID();
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call(body(first)));
  await drain();
  fault.minute = 99;
  // The panel: the held id after an answer that may have landed; a new press after a refusal that says to press again.
  let a2: Answer = null;
  if (!a1 || a1.status !== 200) {
    const again = uncertain(a1) ? first : /again|in a minute|on its way/i.test(said(a1)) ? crypto.randomUUID() : null;
    if (again) {
      shift += 60_000;
      a2 = await bounded(call(body(again)));
      await drain();
    }
  }
  await minutes();
  fault.counting = false;
  const r = room(id);
  return {
    hit: [...fault.hit],
    calls: fault.seen[0]?.length ?? 0,
    a1,
    a2,
    room: r,
    textsBefore,
    emailsBefore,
    texts: textsWithLink().length,
    emails: emailsWithLink().length,
    sendAudits: audits(id, "room.send").length,
    linkAuditsEmail: db
      .t("cockpit_audit_log")
      .filter(a => a.entity_id === id && a.action === "room.link" && JSON.stringify(a.after ?? a.metadata ?? {}).includes("email")).length,
  };
}

function judgeEmail(name: string, o: Awaited<ReturnType<typeof emailJourney>>): string | null {
  const why: string[] = [];
  if (o.textsBefore !== 1) why.push(`the WhatsApp link went ${o.textsBefore} times before the press`);
  if (o.emailsBefore !== 0) why.push(`${o.emailsBefore} emails before the press`);
  if (o.texts !== 1) why.push(`the WhatsApp link went ${o.texts} times in all`);
  if (o.emails > 1) why.push(`${o.emails} emails of the link to the lead`);
  const last = o.a2 ?? o.a1;
  const lastSaid = said(last);
  const channels = Array.isArray(o.room.link_channels) ? (o.room.link_channels as string[]) : [];
  if (o.emails === 1) {
    if (!channels.includes("email")) why.push(`the email went and the room's channels say ${JSON.stringify(channels)}`);
    if (o.sendAudits + o.linkAuditsEmail === 0 && !auditBlip(o.hit)) why.push("the email went with no audit row");
    if (o.sendAudits > 1) why.push(`${o.sendAudits} room.send audit rows for one email`);
    if (last && last.status !== 200 && /^Not sent/i.test(lastSaid) && !MAY.test(lastSaid))
      why.push(`the email went and the rep's last press said "${lastSaid}"`);
  } else {
    if (channels.includes("email")) why.push("no email went and the room's channels say email");
    if (last && last.status === 200) why.push(`no email went and the rep's last press answered 200 "${String(last.body.note ?? "")}"`);
    if (!last || !lastSaid) why.push(`no email went and the rep's last press said ${last ? last.status : "nothing (no answer)"}`);
  }
  return why.length
    ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 90)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 90)}": ${why.join("; ")}`
    : null;
}

describe.skipIf(!process.env.M1_CHAOS_R5)("m1 chaos r5: Also send by email with one outside call faulted", () => {
  test("Also send by email: one email, recorded once, or a sentence", async () => {
    const clean = await emailJourney(-1, "fail");
    if (process.env.M1_R5_LOG) console.log("email calls", clean.calls, "\n  ", (fault.seen[0] ?? []).join("\n   "));
    expect(judgeEmail("clean", clean)).toBeNull();
    const bad: string[] = [];
    for (const mode of modes())
      for (let k = 0; k < clean.calls + 1; k++) {
        const b = judgeEmail(`email ${mode}@${k}`, await emailJourney(k, mode));
        if (b) bad.push(b);
      }
    for (const b of bad) console.log(b);
    expect(bad).toEqual([]);
  }, 3_600_000);
});

// ---- That was not the lead ----------------------------------------------------------

async function notLeadJourney(k: number, mode: Mode) {
  reset({ gate: true });
  seedWorker();
  const id = await meetRoomWithLink();
  const roomNow = () => room(id);
  await call({ action: "room.mark", room_id: id, version: Number(roomNow().version), what: "host_in" });
  await call({ action: "room.mark", room_id: id, version: Number(roomNow().version), what: "lead_in" });
  await drain();
  shift += 30_000;
  const before = { state: String(roomNow().state), version: Number(roomNow().version), links: took.length };
  const body = (v: number) => ({ action: "room.mark", room_id: id, version: v, what: "not_lead" });
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call(body(before.version)));
  await drain();
  fault.minute = 99;
  let a2: Answer = null;
  if (!a1 || a1.status !== 200) {
    a2 = await bounded(call(body(before.version)));
    if (a2 && a2.status === 409 && /changed a moment ago/i.test(said(a2))) a2 = await bounded(call(body(Number(roomNow().version))));
  }
  await drain();
  await minutes(3);
  fault.counting = false;
  return {
    hit: [...fault.hit],
    calls: fault.seen[0]?.length ?? 0,
    a1,
    a2,
    before,
    final: roomNow(),
    audits: audits(id, "room.mark.not_lead").length,
    lines: db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.kind === "room.mark.not_lead").length,
    newLinks: took.length - before.links,
  };
}

function judgeNotLead(name: string, o: Awaited<ReturnType<typeof notLeadJourney>>): string | null {
  const why: string[] = [];
  if (o.before.state !== "lead_in") why.push(`the room was ${o.before.state} before the press`);
  if (String(o.final.state) !== "host_in") why.push(`the room is ${String(o.final.state)}, not host_in`);
  if (!o.final.count_undo_at) why.push("no count_undo_at on the room");
  const last = o.a2 ?? o.a1;
  if (!last || last.status !== 200) why.push(`the rep's last press answered ${last ? `${last.status} "${said(last)}"` : "nothing"}`);
  if (o.audits !== 1 && !(o.audits === 0 && auditBlip(o.hit))) why.push(`${o.audits} room.mark.not_lead audit rows (${o.lines} timeline lines)`);
  if (o.newLinks) why.push(`${o.newLinks} messages to the lead`);
  return why.length
    ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 60)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 60)}": ${why.join("; ")}`
    : null;
}

describe.skipIf(!process.env.M1_CHAOS_R5)("m1 chaos r5: That was not the lead with one outside call faulted", () => {
  test("That was not the lead: back to waiting once, the rep answered, one audit row", async () => {
    const clean = await notLeadJourney(-1, "fail");
    if (process.env.M1_R5_LOG) console.log("not_lead calls", clean.calls, "\n  ", (fault.seen[0] ?? []).join("\n   "));
    expect(judgeNotLead("clean", clean)).toBeNull();
    const bad: string[] = [];
    for (const mode of modes())
      for (let k = 0; k < clean.calls + 1; k++) {
        const b = judgeNotLead(`not_lead ${mode}@${k}`, await notLeadJourney(k, mode));
        if (b) bad.push(b);
      }
    for (const b of bad) console.log(b);
    expect(bad).toEqual([]);
  }, 3_600_000);
});

// ---- Cancel before the room is made ---------------------------------------------------

async function cancelJourney(k: number, mode: Mode) {
  reset({ gate: true });
  seedWorker();
  const made = await call({ action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "manual" });
  await drain();
  const id = String((made.body.room as Row | undefined)?.id ?? "");
  const roomNow = () => room(id);
  const before = { state: String(roomNow()?.state), version: Number(roomNow()?.version), links: took.length };
  const body = (v: number) => ({ action: "room.end", room_id: id, version: v, reason: "cancel" });
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call(body(before.version)));
  await drain();
  fault.minute = 99;
  let a2: Answer = null;
  if (!a1 || a1.status !== 200) {
    a2 = await bounded(call(body(before.version)));
    if (a2 && a2.status === 409 && /changed a moment ago/i.test(said(a2))) a2 = await bounded(call(body(Number(roomNow().version))));
  }
  await drain();
  const worker = await workerMakes();
  await minutes();
  fault.counting = false;
  const rooms = db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD);
  return {
    hit: [...fault.hit],
    calls: fault.seen[0]?.length ?? 0,
    made,
    a1,
    a2,
    before,
    final: roomNow(),
    rooms,
    worker,
    audits: audits(id, "room.end").length,
    newLinks: took.length - before.links,
  };
}

function judgeCancel(name: string, o: Awaited<ReturnType<typeof cancelJourney>>): string | null {
  const why: string[] = [];
  if (o.made.status !== 200) why.push(`the room was not made (${o.made.status} "${said(o.made)}")`);
  if (o.before.state !== "requested") why.push(`the room was ${o.before.state} before the press`);
  const last = o.a2 ?? o.a1;
  const cancelled = String(o.final?.state) === "cancelled";
  if (o.rooms.length !== 1) why.push(`${o.rooms.length} rooms for the lead`);
  if (cancelled) {
    if (o.newLinks) why.push(`the room is cancelled and ${o.newLinks} messages went to the lead`);
    if (!last || last.status !== 200) why.push(`the room is cancelled and the rep's last press answered ${last ? `${last.status} "${said(last)}"` : "nothing"}`);
    if (o.audits !== 1 && !(o.audits === 0 && auditBlip(o.hit))) why.push(`${o.audits} room.end audit rows`);
    if (o.worker.length) why.push("the worker made the cancelled room's meeting");
  } else {
    if (last && last.status === 200) why.push(`the rep was answered 200 and the room is ${String(o.final?.state)}`);
    if (!last || !said(last)) why.push(`the room is ${String(o.final?.state)} and the rep's last press said ${last ? last.status : "nothing"}`);
  }
  return why.length
    ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 60)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 60)}": ${why.join("; ")}`
    : null;
}

describe.skipIf(!process.env.M1_CHAOS_R5)("m1 chaos r5: Cancel before the room is made with one outside call faulted", () => {
  test("Cancel: the room never opens and no link goes, or the rep is told", async () => {
    const clean = await cancelJourney(-1, "fail");
    if (process.env.M1_R5_LOG) console.log("cancel calls", clean.calls, "\n  ", (fault.seen[0] ?? []).join("\n   "));
    expect(judgeCancel("clean", clean)).toBeNull();
    const bad: string[] = [];
    for (const mode of modes())
      for (let k = 0; k < clean.calls + 1; k++) {
        const b = judgeCancel(`cancel ${mode}@${k}`, await cancelJourney(k, mode));
        if (b) bad.push(b);
      }
    for (const b of bad) console.log(b);
    expect(bad).toEqual([]);
  }, 3_600_000);
});

// ---- the findings, one press each ---------------------------------------------------
// Each is the matrix's journey with one named call faulted, written as what
// must hold; a failing test is a finding.

const ROOM_READ = /^GET db\/rest\/v1\/cockpit_sales_rooms\?id=eq\.[^&]+&select=\*$/;
const CHANNELS_WRITE = /^PATCH db\/rest\/v1\/cockpit_sales_rooms\?id=eq\.[^&]+&link_channels=eq\./;
const STATUS_READ = /^GET ghl\/conversations\/messages\/ghl-m-/;
const NOT_LEAD_LINE = /^POST db\/rest\/v1\/cockpit_sales_room_events\?on_conflict=dedupe_key$/;

/** One press of Also send by email with the call matching `match` (its k-th) faulted; then the panel's press again and ten minutes. */
async function emailPress(match: RegExp, k: number, mode: Mode, pressAgain = true) {
  reset({ gate: true });
  seedWorker();
  const id = await meetRoomWithLink();
  const first = crypto.randomUUID();
  Object.assign(fault, { list: [{ minute: 0, k, mode, match }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call({ action: "room.send", room_id: id, channel: "email", request_id: first }));
  await drain();
  fault.minute = 99;
  let a2: Answer = null;
  if (pressAgain && (!a1 || a1.status !== 200)) {
    shift += 60_000;
    a2 = await bounded(call({ action: "room.send", room_id: id, channel: "email", request_id: uncertain(a1) ? first : crypto.randomUUID() }));
    await drain();
  }
  await minutes();
  fault.counting = false;
  const r = room(id);
  return {
    hit: fault.hit,
    a1: a1 && { status: a1.status, said: said(a1) },
    a2: a2 && { status: a2.status, said: said(a2) },
    emails: emailsWithLink().length,
    channels: r.link_channels,
    sendAudits: audits(id, "room.send").length,
    emailLine: db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.dedupe_key === `link.sent:${id}:email`).length,
  };
}

describe("m1 chaos r5: Also send by email, one call faulted (findings)", () => {
  test("m1-chaos-r5-also-send-email-channel-write-blip-room-says-not-emailed: the email went and the press said so; the room must say it went by email", async () => {
    const o = await emailPress(CHANNELS_WRITE, 0, "fail");
    if (process.env.M1_R5_LOG) console.log(JSON.stringify(o));
    expect(o.hit.length).toBe(1);
    expect(o.a1?.status).toBe(200); // the rep's panel says "Sent by email."
    expect(o.emails).toBe(1);
    expect(o.channels).toContain("email");
  });

  test("m1-chaos-r5-also-send-email-went-answered-did-not-work-no-audit-row: a blip after HighLevel took the email; the press says it did not work, the retry is a repeat, no audit row", async () => {
    // The fourth read of the room in the press: recordSent's, after the message row was marked sent.
    const o = await emailPress(ROOM_READ, 3, "fail");
    if (process.env.M1_R5_LOG) console.log(JSON.stringify(o));
    expect(o.hit.length).toBe(1);
    expect(o.emails).toBe(1);
    // What the rep must not be told about an email that went.
    expect(o.a1?.said ?? "").not.toMatch(/did not work/i);
    expect(o.sendAudits).toBe(1);
  });

  for (const [k, where] of [
    [1, "the press's own check that the room is still open"],
    [2, "the message service's check right before HighLevel is asked"],
  ] as const)
    test(`m1-chaos-r5-send-email-open-check-blip-says-room-closed: a blip on ${where} answers the rep "This room has closed." on an open room`, async () => {
      const o = await emailPress(ROOM_READ, k, "fail", false);
      if (process.env.M1_R5_LOG) console.log(JSON.stringify(o));
      expect(o.hit.length).toBe(1);
      expect(o.emails).toBe(0);
      expect(String(room(String(db.t("cockpit_sales_rooms")[0]?.id)).state)).toBe("open");
      // A database that did not answer is never "the room has closed": the rep reads it as no lead to send to.
      expect(o.a1?.said ?? "").not.toMatch(/has closed/i);
    });

  test("control: after that blip, pressed again, the email goes once and is recorded once", async () => {
    const o = await emailPress(ROOM_READ, 2, "fail", true);
    if (process.env.M1_R5_LOG) console.log(JSON.stringify(o));
    // The blip is answered 503 "press it again in a minute" since the fix (m1 round 5), never 409 "This room has closed.".
    expect({ a1: o.a1?.status, a2: o.a2?.status, emails: o.emails, audits: o.sendAudits }).toEqual({ a1: 503, a2: 200, emails: 1, audits: 1 });
  });

  test("m1-chaos-r5-also-send-email-killed-after-highlevel-took-it-never-recorded: the email went, the retry says it is on its way, ten minutes on the room still does not know", async () => {
    const o = await emailPress(STATUS_READ, 0, "kill");
    if (process.env.M1_R5_LOG) console.log(JSON.stringify(o));
    expect(o.hit.length).toBe(1);
    expect(o.emails).toBe(1);
    expect(o.a2?.said ?? "").toMatch(/on its way/i);
    expect({ channels: o.channels, audits: o.sendAudits, line: o.emailLine }).toEqual({ channels: ["whatsapp_text", "email"], audits: 1, line: 1 });
  });
});

describe("m1 chaos r5: That was not the lead, killed after its write (finding)", () => {
  test("m1-chaos-r5-not-lead-killed-after-write-retry-no-audit-row: the press's write landed, the function died; the panel's press again is answered 200 and nothing records the press", async () => {
    reset({ gate: true });
    seedWorker();
    const id = await meetRoomWithLink();
    await call({ action: "room.mark", room_id: id, version: Number(room(id).version), what: "host_in" });
    await call({ action: "room.mark", room_id: id, version: Number(room(id).version), what: "lead_in" });
    await drain();
    shift += 30_000;
    const v = Number(room(id).version);
    Object.assign(fault, { list: [{ minute: 0, k: 0, mode: "kill", match: NOT_LEAD_LINE }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
    const a1 = await bounded(call({ action: "room.mark", room_id: id, version: v, what: "not_lead" }));
    await drain();
    fault.counting = false;
    const a2 = await call({ action: "room.mark", room_id: id, version: v, what: "not_lead" });
    await drain();
    await minutes(3);
    const r = room(id);
    const out = {
      a1: a1?.status ?? null,
      a2: a2.status,
      state: r.state,
      undone: Boolean(r.count_undo_at),
      audits: audits(id, "room.mark.not_lead").length,
      lines: db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.kind === "room.mark.not_lead").length,
    };
    if (process.env.M1_R5_LOG) console.log(JSON.stringify(out), fault.hit);
    expect(out).toEqual({ a1: null, a2: 200, state: "host_in", undone: true, audits: 1, lines: 1 });
  });

  test("control: the same kill on The lead is in, pressed again, leaves its row", async () => {
    reset({ gate: true });
    seedWorker();
    const id = await meetRoomWithLink();
    await call({ action: "room.mark", room_id: id, version: Number(room(id).version), what: "host_in" });
    await drain();
    const v = Number(room(id).version);
    Object.assign(fault, { list: [{ minute: 0, k: 0, mode: "kill", match: NOT_LEAD_LINE }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
    await bounded(call({ action: "room.mark", room_id: id, version: v, what: "lead_in" }));
    await drain();
    fault.counting = false;
    const a2 = await call({ action: "room.mark", room_id: id, version: v, what: "lead_in" });
    await drain();
    expect({ a2: a2.status, state: room(id).state, audits: audits(id, "room.mark.lead_in").length }).toEqual({ a2: 200, state: "lead_in", audits: 1 });
  });
});

// ---- Use Meet on a Zoom room still being made long past its time ----------------------
// The panel's "Use Meet" (retryRequest: replaces the room in one server
// step). The old room is cancelled only when the new one will be made.

async function useMeetJourney(k: number, mode: Mode) {
  reset({ gate: true });
  seedWorker();
  const old = crypto.randomUUID();
  const at = new Date(clock.now - 90_000).toISOString();
  db.seed("cockpit_sales_rooms", [
    {
      id: old,
      request_id: crypto.randomUUID(),
      code: "R5USEM",
      contact_id: LEAD,
      contact_first_name: "Huda",
      purpose: "manual",
      call_kind: "demo",
      provider: "zoom",
      host_email: CLOSER,
      made_by: CLOSER,
      state: "creating",
      version: 2,
      requested_at: at,
      claimed_at: at,
      worker_run: "run-slow",
      link_channels: [],
      link_message_ids: {},
    },
  ]);
  db.seed("cockpit_sales_room_events", [
    { room_id: old, kind: "room.asked", source: "sales-api", dedupe_key: `room.asked:${old}`, handled_at: at, text: "A Zoom room was asked for." },
  ]);
  const body = (rid: string, v: number) => ({
    action: "room.create",
    request_id: rid,
    contact_id: LEAD,
    provider: "meet",
    call_kind: "demo",
    purpose: "manual",
    replaces: old,
    replaces_version: v,
  });
  const first = crypto.randomUUID();
  Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
  const a1: Answer = await bounded(call(body(first, 2)));
  await drain();
  fault.minute = 99;
  let a2: Answer = null;
  if (!a1 || a1.status !== 200) {
    const again = uncertain(a1) ? first : /again|in a minute/i.test(said(a1)) ? crypto.randomUUID() : null;
    if (again) {
      a2 = await bounded(call(body(again, Number(room(old).version))));
      await drain();
    }
  }
  const made = await workerMakes();
  // R2: a room still creating 120 s after its claim is failed by the sweep (the slow run never opens it).
  for (const r of db.t("cockpit_sales_rooms").filter(x => x.state === "creating" && Date.parse(String(x.claimed_at)) + 120_000 < clock.now + 600_000))
    Object.assign(r, { state: "failed", result: "failed", error: "Not made: the room worker did not finish this room in time.", ended_at: new Date(clock.now).toISOString(), version: Number(r.version) + 1 });
  await minutes();
  fault.counting = false;
  const rooms = db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD);
  return { hit: [...fault.hit], calls: fault.seen[0]?.length ?? 0, a1, a2, old: room(old), fresh: rooms.filter(r => r.id !== old), made };
}

function judgeUseMeet(name: string, o: Awaited<ReturnType<typeof useMeetJourney>>): string | null {
  const why: string[] = [];
  const live = o.fresh.filter(r => !["failed", "cancelled", "ended", "expired"].includes(String(r.state)));
  if (o.fresh.length > 1) why.push(`${o.fresh.length} new rooms`);
  for (const r of live) {
    const n = linksOf(r.join_url).length;
    if (n !== 1) why.push(`the Meet room's link went ${n} times`);
  }
  const last = o.a2 ?? o.a1;
  if (!live.length && String(o.old.state) === "cancelled")
    why.push(`the lead's Zoom room was cancelled and no Meet room was made; the rep's last press said ${last ? `${last.status} "${said(last)}"` : "nothing"}`);
  if (!live.length && (!last || last.status === 200 || !said(last))) why.push(`no Meet room and the rep's last press said ${last ? last.status : "nothing"}`);
  return why.length
    ? `${name} [${o.hit.join(" | ")}] a1=${o.a1?.status ?? "none"} "${said(o.a1).slice(0, 80)}" a2=${o.a2?.status ?? "-"} "${said(o.a2).slice(0, 80)}": ${why.join("; ")}`
    : null;
}

describe.skipIf(!process.env.M1_CHAOS_R5)("m1 chaos r5: Use Meet with one outside call faulted", () => {
  test("Use Meet: one Meet room and its link, or the Zoom room kept and a sentence", async () => {
    const clean = await useMeetJourney(-1, "fail");
    if (process.env.M1_R5_LOG) console.log("use meet calls", clean.calls, "\n  ", (fault.seen[0] ?? []).join("\n   "));
    expect(judgeUseMeet("clean", clean)).toBeNull();
    const bad: string[] = [];
    for (const mode of modes())
      for (let k = 0; k < clean.calls + 1; k++) {
        const b = judgeUseMeet(`use_meet ${mode}@${k}`, await useMeetJourney(k, mode));
        if (b) bad.push(b);
      }
    for (const b of bad) console.log(b);
    expect(bad).toEqual([]);
  }, 3_600_000);
});
