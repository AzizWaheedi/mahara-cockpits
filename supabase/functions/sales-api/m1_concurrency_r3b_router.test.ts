// bun test supabase/functions/sales-api/m1_concurrency_r3b_router.test.ts
//
// Milestone 1, video-link round 3 (second pass), angle: concurrency and
// idempotency, through sales-api's own doors (index.ts Deno.serve) with the
// real message service (convoSend: the sender's ceiling of 30 messages in
// ten minutes, checked again inside the message slot under the sender's
// lock).
//
// The send slot under parallel callers: the room's link goes out as its
// host (rooms.ts sendOn, sender = the host), so it shares the rep's own
// ceiling with everything else the rep sends at the same time from another
// tab (the follow-up drafts the rep approves one by one, live since 26
// September: followups.enabled). The ceiling passes within minutes; the
// room's link must be tried again (or said as tried again), never said as
// a final "Not sent ... send it another way" that stops the re-ask.
//
// The outside world is faked at fetch; nothing leaves this process, every
// lead and seat is invented (stress-..., @stress.invalid).

import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, linkRefusalFinal } from "./roomlogic.ts";
import { hoursRefusal } from "./sendrules.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1c3br-setter@stress.invalid";
const LEAD = "stress-m1c3br-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const posts: { at: number; body: Row }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

/** A country whose every clock is in the day now (the router runs on the real clock). */
const COUNTRY =
  ["KW", "GB", "US", "BR", "JP", "AU", "NZ", "IN", "DE", "MX"].find(
    c => hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now(), followups: {} }) === null &&
      hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now() + 10 * 60_000, followups: {} }) === null,
  ) ?? "KW";
const PHONE = COUNTRY === "KW" ? "+96550000000" : "+447700900123";

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function dbAnswer(path: string, method: string, init: RequestInit, prefer: string): Promise<Response> {
  try {
    const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
    return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
  } catch (e) {
    const err = e as DbError;
    return reply({ code: err.code, message: err.message }, err.status ?? 500);
  }
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (/^[^.]+\.[^.]+\.sig$/.test(token) && !SEATS[token]) return reply({ signed_in: false });
    return SEATS[token] ? reply(SEATS[token]) : reply({ message: "JWT invalid" }, 401);
  }
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
    return await dbAnswer(path, method, init, headers.get("prefer") ?? "");
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}`))
      return reply({
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: PHONE, email: "huda@example.com", country: COUNTRY, tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      posts.push({ at: Date.now(), body: JSON.parse(String(init.body ?? "{}")) });
      return reply({ messageId: `m-${posts.length}`, emailMessageId: `e-${posts.length}`, conversationId: "conv-1" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) return reply({ message: { id: path.split("/").pop(), status: "delivered", messageType: "TYPE_EMAIL" } });
    return reply({ message: "not faked" }, 404);
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-stress",
    SUPABASE_ANON_KEY: "anon-stress",
    SALES_GHL_TOKEN: "ghl-stress",
    CRON_SECRET: CRON,
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?m1_concurrency_r3b_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

function serviceToken(): string {
  const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
}

async function call(who: "setter" | "desk", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.authorization = who === "setter" ? "Bearer seat-setter" : `Bearer ${serviceToken()}`;
  const res = await handler(new Request("https://fn.stress.invalid/sales-api", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Row };
}

function reset(): void {
  db.tables = {};
  posts.length = 0;
  db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        count_on_join: false,
        settle: false,
        wrap: false,
        short_link: false,
      },
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    // The pilot's start: the WhatsApp gate is locked, so the link goes by email.
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "basic", google_ok: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: COUNTRY, assigned_to: "G-setter" }]);
}

const tick = () => new Promise<void>(r => setTimeout(r, 5));

/** The room worker beside the press: claims the requested room, stores worker.ready, opens it, tells sales-api. */
async function worker(): Promise<string> {
  for (let i = 0; i < 400; i++) {
    const r = db.t("cockpit_sales_rooms").find(x => x.state === "requested");
    if (r) {
      const id = String(r.id);
      await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
        method: "PATCH",
        body: { state: "creating", claimed_at: new Date().toISOString(), worker_run: "run-1", version: Number(r.version) + 1 },
      });
      await db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
        method: "POST",
        body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made on Meet." },
        prefer: "resolution=ignore-duplicates",
      });
      const cur = db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
      await db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
        method: "PATCH",
        body: { state: "open", join_url: MEET_URL, provider_meeting_id: `evt-${id.slice(-4)}`, opened_at: new Date().toISOString(), version: Number(cur.version) + 1 },
      });
      await call("desk", { action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
      return id;
    }
    await tick();
  }
  throw new Error("no room was asked for");
}

/** The setter's own sends of the last minutes from the Follow-ups tab (approved drafts to other leads). */
function sentByTheSetter(n: number): void {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++)
    rows.push({
      request_id: crypto.randomUUID(),
      contact_id: `stress-m1c3br-other-${i}`,
      channel: "whatsapp",
      via: "conversation",
      body: `Draft ${i}`,
      source: "followup",
      sent_by: SETTER,
      state: "sent",
      ghl_asked_at: new Date(Date.now() - (9 - (i % 9)) * 60_000).toISOString(),
      created_at: new Date(Date.now() - (9 - (i % 9)) * 60_000).toISOString(),
    });
  db.seed("cockpit_sales_messages", rows);
}

describe("m1 concurrency r3b (router): the room's link and the rep's own sends from another tab, one sender's ceiling", () => {
  test("control: 29 of the setter's own sends in the last ten minutes: the room's link (the 30th) goes by email", async () => {
    reset();
    sentByTheSetter(29);
    const pressed = call("setter", { action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = await worker();
    await pressed;
    const room = () => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    for (let i = 0; i < 1600 && !room().link_sent_at; i++) await tick();
    expect({ emails: posts.length, link_sent: Boolean(room().link_sent_at) }).toEqual({ emails: 1, link_sent: true });
  }, 60_000);

  test("m1-conc-r3b-sender-ceiling-from-other-tab-said-final: the setter approves follow-up drafts in the Follow-ups tab (30 sends in the last nine minutes) and, in the dialer tab, sends a missed lead a video link: the room's email goes as the setter and meets the setter's ceiling, which passes within minutes; the room must say the link is tried again (and the minute's re-ask must send it), never a final Not sent that tells the rep to send it another way and stops the re-ask", async () => {
    reset();
    sentByTheSetter(30);
    const pressed = call("setter", { action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = await worker();
    await pressed;
    const room = () => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    for (let i = 0; i < 1600 && !room().refusal && !room().link_sent_at; i++) await tick();
    for (let i = 0; i < 100; i++) await tick();
    const r = room();
    const status = await call("setter", { action: "room.status", room_id: id });
    const lines = ((status.body.events as Row[] | undefined) ?? []).map(e => String(e.text ?? ""));
    expect({
      emails: posts.length,
      refusal: r.refusal ?? null,
      said_final: linkRefusalFinal(r.refusal),
      timeline_says_send_another_way: lines.some(l => /another way|read (it|the link) out/i.test(l)),
    }).toEqual({
      emails: 0,
      refusal: expect.stringMatching(/tried again in a minute\.?$/) as unknown as string,
      said_final: false,
      timeline_says_send_another_way: false,
    });
  }, 60_000);
});
