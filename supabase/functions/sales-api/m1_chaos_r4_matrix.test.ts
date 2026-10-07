// bun test supabase/functions/sales-api/m1_chaos_r4_matrix.test.ts
//
// Milestone 1, video-link round 4, chaos at every outside call of the link's
// first send, through sales-api's real handler and its real message service
// (index.ts convoSend), not the stand-in round 1's matrix used: the room is
// open and the worker's worker.ready reaches sales-api, and the k-th call
// (the database, an RPC, or HighLevel) on the way to the lead
//   - fails before it lands (a dropped connection),
//   - lands and its answer is lost (a timeout after the work was done),
//   - lands and answers garbage (a gateway's HTML page with a 200), or
//   - never answers (the function killed by a deploy or its wall clock).
// Then the cron runs as it does in production: every minute the sweep
// replays unhandled worker events and posts the room's tick, for ten minutes.
//
// What the lead and the closer need, with the pilot's settings (rooms on,
// test_only with the test contact, short link off; links by email while the
// WhatsApp gate is shut, free text inside the window once it opens):
//   - the link reaches the lead once, never twice;
//   - the room never says "Not sent" (which tells the closer to send it
//     another way) about a link that then goes by itself;
//   - the room says what happened: link_sent_at when it went, a sentence
//     when it did not.
//
// The outside world is faked at fetch with a conversation HighLevel keeps
// (as m1_chaos_r3_hl.test.ts does); the handler's own long sleeps move the
// fake clock. Every lead, seat and link is invented; nothing leaves this
// process.
//
// About twenty minutes (a killed call is waited for in real time):
// M1_CHAOS_R4_MATRIX=1 bun test supabase/functions/sales-api/m1_chaos_r4_matrix.test.ts
// Its one finding at a single fault is m1-chaos-r4-not-sent-then-reask-sends-
// on-top (a contact read that blinks: "Not sent" on the panel, the link a
// minute later); m1_chaos_r4_router.test.ts reproduces it in seconds.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CLOSER = "closer-m1chaos4@stress.invalid";
const LEAD = "stress-m1chaos4-mx-0001";
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
const fault = { k: -1, mode: "fail" as Mode, n: 0, seen: [] as string[], counting: false };

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

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (!fault.counting) return await world(url, init);
  const mine = fault.n++;
  fault.seen.push(`${method} ${url.replace(DB, "db").replace(GHL, "ghl").slice(0, 110)}`);
  if (mine !== fault.k) return await world(url, init);
  if (fault.mode === "fail") throw new TypeError("fetch failed: connection reset");
  if (fault.mode === "kill") return await new Promise<Response>(() => {});
  await world(url, init);
  if (fault.mode === "garbage") return htmlPage();
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
    if (typeof ms === "number" && ms >= 1000) {
      shift += ms;
      return realSetTimeout(fn, 0, ...args);
    }
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout;
  await import("./index.ts?m1_chaos_r4_matrix");
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
  Object.assign(fault, { k: -1, mode: "fail", n: 0, seen: [], counting: false });
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
/** Waits for the handler's background work; a killed one never finishes and is left behind. */
async function drain(): Promise<void> {
  for (let i = 0; i < 40 && waiting.size; i++) await Promise.race([Promise.allSettled([...waiting]), pause(15)]);
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

interface Seen {
  minute: number;
  sent: boolean;
  refusal: string;
}

/** One journey: the k-th call of the first send faulted (k -1: none), then ten minutes of cron. */
async function journey(k: number, mode: Mode, gate: boolean): Promise<{ calls: number; call: string; links: number[]; seen: Seen[]; final: Row }> {
  reset({ gate });
  const id = openRoom();
  const opened = clock.now;
  Object.assign(fault, { k, mode, n: 0, seen: [], counting: true });
  await bounded(desk({ action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } }));
  await drain();
  fault.counting = false;
  const seen: Seen[] = [{ minute: 0, sent: Boolean(room(id).link_sent_at), refusal: String(room(id).refusal ?? "") }];
  for (let m = 1; m <= 10; m++) {
    shift += 60_000;
    // The sweep: worker events unhandled for 20 s and not held go back to room.event, then the room's tick.
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
  return {
    calls: fault.n,
    call: fault.seen[k] ?? "",
    links: linksToLead().map(t => Math.round((t.at - opened) / 60_000)),
    seen,
    final: room(id),
  };
}

function judge(k: number, mode: Mode, o: Awaited<ReturnType<typeof journey>>): string | null {
  const why: string[] = [];
  const n = o.links.length;
  if (n > 1) why.push(`${n} links to the lead (minutes ${o.links.join(", ")})`);
  if (n >= 1 && !o.final.link_sent_at) why.push(`the link went and the room says "${String(o.final.refusal ?? "nothing")}"`);
  if (n === 0 && o.final.link_sent_at) why.push("the room says the link went and nothing went");
  if (n === 0 && !o.final.refusal) why.push("no link and no sentence after ten minutes");
  // "Not sent" (the closer is told to send it another way) and then the link went by itself.
  const first = o.links[0];
  // A refusal the re-ask tries again ("..., tried again in a minute") is said
  // as exactly that, never "Not sent" (round 4 fix): only a final one counts.
  const notSent = o.seen.find(
    s => !s.sent && s.refusal && !MAY.test(s.refusal) && !/tried again in a minute\.?$/i.test(s.refusal) && (first === undefined || s.minute < first),
  );
  if (notSent && first !== undefined) why.push(`said "${notSent.refusal.slice(0, 90)}" at minute ${notSent.minute}, then the link went at minute ${first}`);
  if (first !== undefined && first > 2) why.push(`the link went ${first} minutes after the room opened`);
  return why.length ? `${mode}@${k} (${o.call}): ${why.join("; ")}` : null;
}

describe.skipIf(!process.env.M1_CHAOS_R4_MATRIX)("m1 chaos r4: the closer's Zoom link through the real message service, with one outside call failed, lost, garbled or killed at every step", () => {
  for (const [gate, name] of [
    [false, "WhatsApp gate shut (email, as production is today)"],
    [true, "WhatsApp gate open, inside the window (free text)"],
  ] as const) {
    test(`${name}: once, said right, and never "Not sent" before it goes`, async () => {
      const clean = await journey(-1, "fail", gate);
      expect(clean.links).toEqual([0]);
      const bad: string[] = [];
      for (const mode of ["fail", "lost", "garbage", "kill"] as const) {
        for (let k = 0; k < clean.calls + 2; k++) {
          const o = await journey(k, mode, gate);
          const b = judge(k, mode, o);
          if (b) bad.push(b);
        }
      }
      if (process.env.M1_R4_DEBUG) console.log(bad.join("\n"));
      expect(bad).toEqual([]);
    }, 1_800_000);
  }
});
