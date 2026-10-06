// bun test supabase/functions/sales-api/m1_chaos_r5_zoom.test.ts
//
// Milestone 1, video-link round 5 (chaos): the end of a Zoom call, through
// sales-api's real handler. The closer's Zoom room is open, its link went,
// the closer and the lead came in (clean). Then the call ends the way Zoom
// says it (the lead's participant_left, the host's participant_left,
// meeting.ended), or the host steps out before the lead came (the host's
// participant_left, then meeting.ended on the empty meeting, then the lead
// joins after the host is back). The k-th outside call while sales-api
// reads one of those events fails before it lands, lands with its answer
// lost, answers a gateway's page, or never answers (the function killed by
// a deploy); then the sweep replays what is left unhandled and ticks the
// room every minute.
//
// Every lead, seat and link is invented; nothing leaves this process.
// M1_CHAOS_R5=1 bun test supabase/functions/sales-api/m1_chaos_r5_zoom.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CLOSER = "closer-m1chaos5z@stress.invalid";
const LEAD = "stress-m1chaos5z-mx-0001";
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
  await import("./index.ts?m1_chaos_r5_zoom");
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
      code: "R4ZMJN",
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



const S = 1000;
interface Hook { event: string; at: number; participant?: Row }
const hostP = (t: number): Row => ({ id: "Z-closer", user_id: "16778240", participant_uuid: "puuid-host-1", user_name: "Omar Closer", email: CLOSER, join_time: new Date(t).toISOString() });
const leadP = (t: number, what: "join" | "wait"): Row => ({
  id: "",
  user_id: what === "join" ? "16779264" : "16779000",
  participant_uuid: "puuid-lead-1",
  user_name: "Huda Ali",
  ...(what === "join" ? { join_time: new Date(t).toISOString() } : { date_time: new Date(t).toISOString() }),
});

/** The door: the event stored once (its dedupe key), then passed to sales-api's room.event. */
async function doorStores(roomId: string, h: Hook): Promise<string> {
  const p = h.participant;
  const who = p ? String(p.participant_uuid ?? p.user_id ?? "") : "";
  const when = p ? String(p.join_time ?? p.date_time ?? h.at) : "";
  const key = p ? `zoom:${h.event}:inst-1:${who}:${when}` : `zoom:${h.event}:inst-1`;
  const have = db.t("cockpit_sales_room_events").find(e => e.dedupe_key === key);
  if (have) return String(have.id);
  const id = crypto.randomUUID();
  db.seed("cockpit_sales_room_events", [
    {
      id,
      room_id: roomId,
      kind: `zoom.${h.event}`,
      source: "zoom",
      dedupe_key: key,
      at: new Date(h.at).toISOString(),
      text: `Zoom: ${h.event}.`,
      detail: {
        event: h.event,
        event_ts: h.at,
        payload: { object: { id: MEETING, uuid: "inst-1", host_id: "Z-closer", topic: "Mahara call R4ZMJN", ...(p ? { participant: p } : {}) } },
      },
    },
  ]);
  return id;
}
async function doorForwards(roomId: string, h: Hook): Promise<void> {
  const id = await doorStores(roomId, h);
  await bounded(desk({ action: "room.event", kind: `zoom.${h.event}`, source: "zoom", event_id: id, room_id: roomId }));
  await drain();
}

async function minuteOfCron(id: string): Promise<void> {
  shift += 60_000;
  const due = db
    .t("cockpit_sales_room_events")
    .filter(e => !e.handled_at && ["worker", "zoom", "claim"].includes(String(e.source)) && (!e.lease_until || Date.parse(String(e.lease_until)) <= clock.now))
    .map(e => String(e.id));
  if (due.length) await bounded(desk({ action: "room.event", kind: "sweep.replay", payload: { event_ids: due } }));
  await drain();
  await bounded(desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } }));
  await drain();
}

const leadLeft = (joined: number, t: number): Row => ({ ...leadP(joined, "join"), leave_time: new Date(t).toISOString(), leave_reason: "left the meeting" });
const hostLeft = (joined: number, t: number): Row => ({ ...hostP(joined), leave_time: new Date(t).toISOString(), leave_reason: "left the meeting" });

type Step5 = "end" | "host_out";

/** The call with one step faulted: the end of the call, or the host stepping out before the lead came. */
async function journey(step: Step5 | null, k: number, mode: Mode, gate: boolean) {
  reset({ gate });
  db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
  const id = openRoom();
  await bounded(desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } }));
  await drain();
  const run = async (s: Step5 | "clean", hooks: Hook[]) => {
    if (step === s) Object.assign(fault, { list: [{ minute: 0, k, mode }], minute: 0, n: 0, seen: [], counting: true, hit: [] });
    for (const h of hooks) await doorForwards(id, h);
    fault.counting = false;
  };
  shift += 40 * S;
  const hostAt = clock.now;
  await run("clean", [{ event: "meeting.started", at: hostAt }, { event: "meeting.participant_joined", at: hostAt, participant: hostP(hostAt) }]);
  let endAt = 0;
  if (step === "host_out") {
    // The host steps out before the lead came; Zoom ends the empty meeting.
    shift += 30 * S;
    const out = clock.now;
    await run("host_out", [
      { event: "meeting.participant_left", at: out, participant: hostLeft(hostAt, out) },
      { event: "meeting.ended", at: out + 1000 },
    ]);
    // The host is back a minute later, and the lead joins.
    shift += 60 * S;
    const back = clock.now;
    await run("clean", [
      { event: "meeting.started", at: back },
      { event: "meeting.participant_joined", at: back, participant: { ...hostP(back), participant_uuid: "puuid-host-2" } },
    ]);
    shift += 20 * S;
    const leadAt = clock.now;
    await run("clean", [{ event: "meeting.participant_joined", at: leadAt, participant: leadP(leadAt, "join") }]);
  } else {
    shift += 50 * S;
    const leadAt = clock.now;
    await run("clean", [{ event: "meeting.participant_joined", at: leadAt, participant: leadP(leadAt, "join") }]);
    shift += 20 * 60 * S;
    endAt = clock.now;
    await run("end", [
      { event: "meeting.participant_left", at: endAt, participant: leadLeft(leadAt, endAt) },
      { event: "meeting.participant_left", at: endAt + 2000, participant: hostLeft(hostAt, endAt + 2000) },
      { event: "meeting.ended", at: endAt + 3000 },
    ]);
  }
  const calls = fault.seen[0]?.length ?? 0;
  for (let m = 0; m < 6; m++) await minuteOfCron(id);
  const final = db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const zoomEvents = db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.source === "zoom");
  return {
    hit: [...fault.hit],
    calls,
    endAt,
    final,
    unhandled: zoomEvents.filter(e => !e.handled_at).map(e => String(e.kind)),
    gaveUp: zoomEvents.filter(e => (e.detail as Row | undefined)?.gave_up).map(e => String(e.kind)),
    links: linksToLead().length,
    secret: db.t("cockpit_sales_room_secrets").filter(s => s.room_id === id).length,
    events: db.t("cockpit_sales_room_events").filter(e => e.room_id === id).map(e => `${String(e.kind)}${e.handled_at ? "" : " (unhandled)"}: ${String(e.text ?? "").slice(0, 80)}`),
  };
}

function judge(name: string, step: Step5, o: Awaited<ReturnType<typeof journey>>): string | null {
  const why: string[] = [];
  if (step === "end") {
    if (o.final.state !== "ended") why.push(`the room is ${String(o.final.state)}, not ended`);
    if (o.final.result !== "joined") why.push(`its result is ${String(o.final.result)}, not joined`);
    const ended = Date.parse(String(o.final.ended_at ?? ""));
    if (o.final.state === "ended" && (Number.isNaN(ended) || Math.abs(ended - (o.endAt + 3000)) > 60_000))
      why.push(`ended_at ${String(o.final.ended_at)} is not the meeting's end`);
  } else {
    if (o.final.state !== "lead_in") why.push(`the room is ${String(o.final.state)}${o.final.result ? ` (${String(o.final.result)})` : ""}, not lead_in`);
    if (!o.final.lead_in_at) why.push("no lead_in_at");
  }
  if (o.unhandled.length) why.push(`unhandled: ${o.unhandled.join(", ")}`);
  if (o.gaveUp.length) why.push(`given up: ${o.gaveUp.join(", ")}`);
  if (o.links !== 1) why.push(`${o.links} links`);
  return why.length ? `${name} [${o.hit.join(" | ")}]: ${why.join("; ")}` : null;
}

describe.skipIf(!process.env.M1_CHAOS_R5)("m1 chaos r5: the end of a Zoom call with one outside call faulted", () => {
  for (const step of ["end", "host_out"] as Step5[])
    test(`${step}: the room says what Zoom said, whatever one call does`, async () => {
      const clean = await journey(step, -1, "fail", true);
      if (process.env.M1_R5_LOG) console.log("clean", clean.events.join("\n  "));
      expect(judge("clean", step, clean)).toBeNull();
      const probe = await journey(step, 999, "fail", true);
      if (process.env.M1_R5_LOG) console.log(`${step}: ${probe.calls} calls\n   ${(fault.seen[0] ?? []).join("\n   ")}`);
      const bad: string[] = [];
      for (const mode of (process.env.M1_R5_MODES ?? "fail,lost,garbage,kill").split(",") as Mode[])
        for (let k = 0; k < probe.calls + 1; k++) {
          const o = await journey(step, k, mode, true);
          const b = judge(`${step} ${mode}@${k}`, step, o);
          if (b) {
            bad.push(b);
            if (process.env.M1_R5_LOG) console.log("BAD", b, "\n  ", o.events.join("\n   "));
          }
        }
      console.log(`${step}: ${bad.length} bad journeys`);
      for (const b of bad) console.log(b);
      expect(bad).toEqual([]);
    }, 3_600_000);
});
