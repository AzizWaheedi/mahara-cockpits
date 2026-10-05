// bun test supabase/functions/sales-api/m1_concurrency_r1_router.test.ts
//
// Milestone 1, round 1, angle: concurrency and idempotency, through
// sales-api's own doors (index.ts Deno.serve) with the real message service
// (convoSend: the request id's earlier try, the switches, the sender's
// ceiling, the lead's row, HighLevel's contact, the message slot, the stamp,
// then HighLevel's send). The room's link asks stillOpen once, in rooms.ts
// sendOn, before it hands the send to the message service; everything the
// message service reads after that runs with the room unchecked.
//
// The pilot's settings (m1-scope.md section 3): the WhatsApp gate locked, so
// the link goes by email. The outside world is faked at fetch; nothing
// leaves this process, every lead is invented.

import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1c1r-setter@stress.invalid";
const LEAD = "stress-m1c1r-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const posts: { at: number; path: string; body: Row; roomState: string }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;
/** Armed: the message slot's answer waits until it is opened (the database slow, or HighLevel's contact read before it). */
let slotGate: { reached: () => void; wait: Promise<void> } | null = null;

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const roomState = () => String((db.t("cockpit_sales_rooms")[0] ?? {}).state ?? "none");

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    // A token signed with the project's key (this fake's ".sig") is good, and
    // the service role has no seat; an unsigned or forged one is refused.
    if (/^[^.]+\.[^.]+\.sig$/.test(token) && !SEATS[token]) return reply({ signed_in: false });
    return SEATS[token] ? reply(SEATS[token]) : reply({ message: "JWT invalid" }, 401);
  }
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    if (fn === "cockpit_sales_message_slot" && slotGate) {
      const g = slotGate;
      slotGate = null;
      g.reached();
      await g.wait;
    }
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    const path = url.slice(`${DB}/rest/v1/`.length);
    const prefer = headers.get("prefer") ?? "";
    try {
      const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}`))
      return reply({
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", country: "US", tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      posts.push({ at: Date.now(), path, body: JSON.parse(String(init.body ?? "{}")), roomState: roomState() });
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
  await import("./index.ts?m1_concurrency_r1_router");
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
  slotGate = null;
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
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "US", assigned_to: "G-setter" }]);
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

describe("m1 concurrency r1 (router): We are on the phone while the link is on its way", () => {
  test("link-sent-after-end-inside-message-service: the lead calls back and the setter presses We are on the phone while the email's slot is being taken; no email may reach the lead for the room that just closed", async () => {
    reset();
    let reached!: () => void;
    const atSlot = new Promise<void>(r => {
      reached = r;
    });
    let open!: () => void;
    slotGate = { reached, wait: new Promise<void>(r => (open = r)) };
    const pressed = call("setter", { action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = await worker();
    const made = await pressed;
    expect([made.status, (made.body.room as Row).state]).toEqual([200, "open"]);
    // The link's send passed rooms.ts's last check (the room open) and is in the message service.
    const got = await Promise.race([atSlot.then(() => "slot"), new Promise<string>(r => setTimeout(() => r("never"), 20_000))]);
    if (got !== "slot")
      throw new Error(`the link never reached the message slot: ${JSON.stringify({ room: db.t("cockpit_sales_rooms")[0], lines: db.t("cockpit_sales_room_events").map(e => e.text) })}`);
    const room = db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    const end = await call("setter", { action: "room.end", room_id: id, version: Number(room.version), reason: "on_phone" });
    expect([end.status, (end.body.room as Row).state]).toEqual([200, "cancelled"]);
    open();
    for (let i = 0; i < 600 && !posts.length; i++) await tick();
    // Give a send that is still on its way the time to land.
    for (let i = 0; i < 100; i++) await tick();
    expect({
      room: (db.t("cockpit_sales_rooms").find(r => r.id === id) as Row).state,
      emails_after_close: posts.filter(p => p.roomState !== "open" && p.roomState !== "host_in" && p.roomState !== "lead_in").length,
    }).toEqual({ room: "cancelled", emails_after_close: 0 });
  }, 60_000);
});
