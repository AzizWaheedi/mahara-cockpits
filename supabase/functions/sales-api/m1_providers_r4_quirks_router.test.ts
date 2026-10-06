// bun test supabase/functions/sales-api/m1_providers_r4_quirks_router.test.ts
//
// Milestone 1, video-link round 4 (second pass), provider quirks through
// sales-api's own doors (index.ts Deno.serve) with the real message service
// (convoSend, its read-back and its repeat of a request id) and the real
// rooms.ts. The pilot's settings with the WhatsApp gate open: the link goes
// as a free text inside the lead's 24 hours.
//
// The rep presses Also send by email after the free text went (the link on
// both lanes). Meta then fails the free text (131026, not on WhatsApp) and
// the address bounces. The minute's recheck reads the email lane only (the
// one that went last), finds the bounce, and emailBounced sends "the free
// text instead" on the free text's own request id: convoSend answers it as
// the repeat of the free text that Meta failed, nothing new goes, and the
// room says "The email bounced, so the link went on WhatsApp."
//
// The outside world is faked at fetch; nothing leaves this process, every
// lead and seat is invented (stress-..., @stress.invalid).

import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { hoursRefusal } from "./sendrules.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "stress-m1p4qr-setter@stress.invalid";
const LEAD = "stress-m1p4qr-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
/** Every POST /conversations/messages HighLevel was asked for, with the id it gave. */
const posts: { type: string; id: string; at: number }[] = [];
/** HighLevel's status for each message id now (Meta's and the mail service's word). */
const status = new Map<string, Row>();
const jobs: Promise<unknown>[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

const COUNTRY =
  ["KW", "GB", "US", "BR", "JP", "AU", "NZ", "IN", "DE", "MX"].find(
    c => hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now(), followups: {} }) === null &&
      hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now() + 10 * 60_000, followups: {} }) === null,
  ) ?? "KW";
const PHONE = COUNTRY === "KW" ? "+96550000000" : "+447700900123";

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
};

function reply(body: unknown, code = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
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
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}`) && !path.includes("/appointments"))
      return reply({
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: PHONE, email: "huda@gmial.com", country: COUNTRY, tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}/appointments`)) return reply({ events: [] });
    // The lead wrote on WhatsApp two hours ago: the window is open.
    if (method === "GET" && path.startsWith("/conversations/search"))
      return reply({ conversations: [{ id: "conv-1", contactId: LEAD, lastInboundWhatsappMessageDate: new Date(Date.now() - 2 * 3_600_000).toISOString() }] });
    if (method === "POST" && path === "/conversations/messages") {
      const body = JSON.parse(String(init.body ?? "{}")) as Row;
      const type = String(body.type);
      const id = `${type === "Email" ? "em" : "wa"}-${posts.length + 1}`;
      posts.push({ type, id, at: Date.now() });
      status.set(id, type === "Email" ? { status: "delivered", messageType: "TYPE_EMAIL" } : { status: "sent", messageType: "TYPE_WHATSAPP" });
      return reply(type === "Email" ? { messageId: id, emailMessageId: id, conversationId: "conv-1" } : { messageId: id, conversationId: "conv-1" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) {
      const id = decodeURIComponent(path.split("/").pop() as string);
      const now = status.get(id);
      return now ? reply({ message: { id, direction: "outbound", ...now } }) : reply({ message: "not found" }, 404);
    }
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
    CRON_SECRET: "cron-secret-stress",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  // index.ts background(): kept, so the test waits for the minute's work.
  (globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => void jobs.push(p) };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?m1_providers_r4_quirks_router");
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

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const now = jobs.splice(0);
    if (!now.length) {
      await new Promise(r => setTimeout(r, 20));
      if (!jobs.length) return;
      continue;
    }
    await Promise.allSettled(now);
  }
}

function reset(): void {
  db.tables = {};
  posts.length = 0;
  status.clear();
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
        // One read-back of 2 s, so the test runs in seconds.
        waits_s: { ...((DEFAULT_ROOMS_JSON as Row).waits_s as Row), unconfirmed: 2 },
      },
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "basic", google_ok: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: COUNTRY, assigned_to: "G-setter" }]);
  db.seed("cockpit_sales_inbox", [{ conversation_id: "conv-1", contact_id: LEAD, inbound_whatsapp_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }]);
}

const pause = () => new Promise<void>(r => setTimeout(r, 5));

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
        body: {
          state: "open",
          join_url: MEET_URL,
          provider_meeting_id: `evt-${id.slice(-4)}`,
          opened_at: new Date().toISOString(),
          host_by: new Date(Date.now() + 15 * 60_000).toISOString(),
          ends_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          version: Number(cur.version) + 1,
        },
      });
      await call("desk", { action: "room.event", kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
      return id;
    }
    await pause();
  }
  throw new Error("no room was asked for");
}

describe("m1 providers r4 quirks (router): the bounce's WhatsApp backup answered by the old free text", () => {
  test("bounce-backup-answered-by-unread-earlier-text: index.ts answers the 'backup' free text as the repeat Meta failed, and the room says the link went on WhatsApp", async () => {
    reset();
    const pressed = call("setter", { action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = await worker();
    expect((await pressed).status).toBe(200);
    const room = () => db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    for (let i = 0; i < 2000 && !room().link_sent_at; i++) await pause();
    await settle();
    expect(room().link_channels).toEqual(["whatsapp_text"]);
    // The rep sends it by email as well.
    const sent = await call("setter", { action: "room.send", room_id: id, request_id: crypto.randomUUID(), channel: "email" });
    await settle();
    expect([sent.status, room().link_channels]).toEqual([200, ["whatsapp_text", "email"]]);
    const wa = posts.find(p => p.type === "WhatsApp") as { id: string };
    const em = posts.find(p => p.type === "Email") as { id: string };
    // Meta fails the free text (not on WhatsApp); the mistyped address bounces.
    status.set(wa.id, { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    status.set(em.id, { status: "bounced", messageType: "TYPE_EMAIL" });
    for (let n = 0; n < 3; n++) {
      await call("desk", { action: "room.event", kind: "tick", payload: { room_ids: [id] } });
      await settle();
    }
    const lines = db.t("cockpit_sales_room_events").filter(e => e.room_id === id).map(e => String(e.text ?? ""));
    const waPosts = posts.filter(p => p.type === "WhatsApp").length;
    expect(
      { saysWentOnWhatsApp: lines.includes("The email bounced, so the link went on WhatsApp."), whatsappPosts: waPosts },
      `Meta failed the only WhatsApp message (131026) and the email bounced; HighLevel was asked for ${waPosts} WhatsApp message(s) in all; ` +
        `the room's lines: ${JSON.stringify(lines.filter(l => /link|bounced|WhatsApp/i.test(l)))}`,
    ).toEqual({ saysWentOnWhatsApp: false, whatsappPosts: 1 });
  }, 90_000);
});
