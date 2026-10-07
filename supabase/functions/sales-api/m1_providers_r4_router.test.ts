// bun test supabase/functions/sales-api/m1_providers_r4_router.test.ts
//
// Milestone 1, video-link round 4, provider quirks, through sales-api's own
// doors (index.ts Deno.serve) with the real message service (convoSend and
// its read-back) and the real rooms.ts. The pilot's settings with the
// WhatsApp gate locked, as production has it: the link goes by email.
//
// HighLevel takes the email (a message id) and its read-back of the
// message reads "bounced": a mistyped address bounces within seconds.
// rooms.ts reads that status as a failure (statusById); the message
// service's read-back does not break on it and lib.ts stateOf has no word
// for it, so the row is stored "sending" and the room says nothing.
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
const CRON = "cron-secret-stress";
const SETTER = "stress-m1p4r-setter@stress.invalid";
const LEAD = "stress-m1p4r-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const posts: Row[] = [];
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
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: PHONE, email: "huda@gmial.com", country: COUNTRY, tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      posts.push(JSON.parse(String(init.body ?? "{}")));
      return reply({ messageId: `m-${posts.length}`, emailMessageId: `e-${posts.length}`, conversationId: "conv-1" });
    }
    // The mail service's hard bounce for a mistyped address lands at once.
    if (method === "GET" && path.startsWith("/conversations/messages/"))
      return reply({ message: { id: path.split("/").pop(), status: "bounced", messageType: "TYPE_EMAIL", direction: "outbound" } });
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
  await import("./index.ts?m1_providers_r4_router");
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
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "basic", google_ok: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: COUNTRY, assigned_to: "G-setter" }]);
}

const tick = () => new Promise<void>(r => setTimeout(r, 5));

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

describe("m1 providers r4 (router): an email link that bounces inside the read-back", () => {
  test("readback-bounced-stored-as-sending: index.ts stores the bounced link email as 'sending', and the room says nothing about it", async () => {
    reset();
    const pressed = call("setter", { action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = await worker();
    const made = await pressed;
    expect([made.status, (made.body.room as Row).state]).toEqual([200, "open"]);
    // The email goes; its read-back (rooms read back for 20 s) runs out.
    const row = () => db.t("cockpit_sales_messages").find(m => m.channel === "email" && m.source === "room") as Row | undefined;
    for (let i = 0; i < 6000 && !row()?.provider_status; i++) await tick();
    for (let i = 0; i < 100; i++) await tick();
    const m = row() as Row;
    const room = db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    const lines = db.t("cockpit_sales_room_events").filter(e => e.room_id === id).map(e => String(e.text ?? ""));
    expect(posts.length).toBe(1);
    expect(
      { state: m.state, saidOnRoom: Boolean(room.link_sent_at) || Boolean(room.refusal) || lines.some(l => /bounced|did not|not sent|Not sent/i.test(l)) },
      `HighLevel read the link email "bounced" (rooms.ts statusById's own word for a failed email); the message service stored state ` +
        `${JSON.stringify(m.state)} provider_status ${JSON.stringify(m.provider_status)}, and the room has link_sent_at ${JSON.stringify(room.link_sent_at ?? null)}, ` +
        `refusal ${JSON.stringify(room.refusal ?? null)}, lines ${JSON.stringify(lines)}`,
    ).toEqual({ state: "failed", saidOnRoom: true });
  }, 90_000);
});
