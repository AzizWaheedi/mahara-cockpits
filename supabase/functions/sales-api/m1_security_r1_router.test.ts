// bun test supabase/functions/sales-api/m1_security_r1_router.test.ts
//
// Milestone 1, video-link round 1, security angle, through sales-api's own
// door (index.ts Deno.serve): who the door takes as the desk. The room
// worker's handshake (room.event worker.ready, worker.failed) and the
// sweep's replays arrive on the desk's door, so whoever the door takes as
// the desk can make a lead's link go. The outside world is faked at fetch
// (as m1_fence_router.test.ts does); nothing leaves this process, every
// lead is invented.

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1s-setter@stress.invalid";
const LEAD = "stress-m1s-lead";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghl: { method: string; path: string; body?: unknown }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;
/** The lead's first name as HighLevel holds it (a public lead form's field). */
let firstName = "Huda";

const SEATS: Record<string, Row> = {
  "seat-setter": {
    signed_in: true,
    seat: true,
    manager: false,
    email: SETTER,
    name: "Tara Setter",
    role: "setter",
    ghl_user_id: "G-setter",
  },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    // PostgREST checks the token's signature itself: only a real session is a seat.
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    // A token signed with the project's key (this fake's ".sig") is good, and
    // the service role has no seat; an unsigned or forged one is refused.
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
    const prefer = headers.get("prefer") ?? "";
    try {
      const rows = await db.db(path, {
        method,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        prefer,
      });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    ghl.push({
      method,
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (method === "GET" && path.startsWith("/contacts/"))
      return reply({
        contact: {
          id: LEAD,
          firstName,
          name: firstName,
          phone: "+96550000000",
          email: "huda@stress.invalid",
          tags: ["roas-qualified"],
          dnd: false,
          dndSettings: {},
          country: "KW",
        },
      });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") return reply({ messageId: "m-1", conversationId: "c-1", status: "sent" });
    return reply({ ok: true });
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
  await import("./index.ts?m1_security_r1_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
/** Anyone can write this: no key, no signature, just the claim. */
const FORGED = `${b64({ alg: "none", typ: "JWT" })}.${b64({ role: "service_role", iss: "anyone" })}.`;

async function call(token: string, body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const res = await handler(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const ROOM = "9e3c9f4b-0a5d-4b6e-8f7a-8b9c0d1e2f3a";
const EVENT = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";

function reset(): void {
  db.tables = {};
  firstName = "Huda";
  ghl.length = 0;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: false, whatsapp_template: false, email: true },
      },
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "followups", value: { enabled: true, agent: false } },
    {
      key: "whatsapp_guard",
      value: {
        connector_off: true,
        single_copy_ok_at: "2026-10-01T00:00:00Z",
        templates_per_day: 250,
      },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  db.seed("cockpit_sales_people", [
    {
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      active: true,
    },
  ]);
  db.seed("cockpit_sales_room_hosts", [
    {
      email: SETTER,
      zoom_user_id: "Z-setter",
      zoom_status: "licensed",
      google_ok: true,
    },
  ]);
  db.seed("cockpit_sales_leads", [
    {
      contact_id: LEAD,
      name: "Huda Ali",
      country: "KW",
      assigned_to: "G-setter",
    },
  ]);
  db.seed("cockpit_sales_rooms", [
    {
      id: ROOM,
      request_id: crypto.randomUUID(),
      code: "K7Q2MX",
      contact_id: LEAD,
      purpose: "manual",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      state: "open",
      join_url: "https://meet.google.com/abc-defg-hij",
      provider_meeting_id: "evt-1",
      requested_at: iso(-60_000),
      opened_at: iso(-5_000),
      worker_run: "run-1",
      version: 3,
      link_channels: [],
      link_message_ids: {},
    },
  ]);
  db.seed("cockpit_sales_room_events", [
    {
      id: EVENT,
      room_id: ROOM,
      kind: "worker.ready",
      source: "worker",
      dedupe_key: `worker.ready:${ROOM}`,
      at: iso(-5_000),
      detail: { worker_run: "run-1" },
    },
  ]);
}

describe("m1 security r1: who sales-api's door takes as the desk", () => {
  test("control: a seat's token is checked by the database (an unsigned one is not a seat), so seat actions are safe whatever the gateway does", async () => {
    reset();
    const out = await call(`${b64({ alg: "none", typ: "JWT" })}.${b64({ role: "authenticated", email: SETTER })}.`, {
      action: "room.status",
      room_id: ROOM,
    });
    expect(out.status).toBe(401);
  });

  test("forged-service-role-desk: a token nobody signed, claiming role service_role, is taken as the desk, and its worker.ready is handled as the room worker's own handshake (sales-api reads the claim and checks no signature; only the gateway's verify_jwt stands in front)", async () => {
    reset();
    const out = await call(FORGED, {
      action: "room.event",
      kind: "worker.ready",
      room_id: ROOM,
      payload: { worker_run: "run-1" },
    });
    // The handshake is taken: the stored worker.ready is marked handled and
    // the link is due for the lead (in daytime it goes at once).
    const ev = db.t("cockpit_sales_room_events").find((e) => e.id === EVENT) as Row;
    // sales-api must refuse a desk token it cannot verify, whatever the gateway did.
    expect({
      status: out.status,
      handled: out.body.handled ?? null,
      event_handled: Boolean(ev.handled_at),
    }).toEqual({
      status: 401,
      handled: null,
      event_handled: false,
    });
  });

  test("forged-service-role-desk (the deploy): desk.py deploy-check proves sales-api runs with verify_jwt on, as it proves sales-live runs with it off", () => {
    // sales-api's desk door is safe only while the gateway verifies tokens.
    // The function deploy helper (scratchpad sales/deploy_fn.py) sends
    // verify_jwt false unless --verify-jwt is passed; deploy-check is the
    // one place a wrong flag would be caught before the pilot.
    const src = readFileSync(new URL("../../../hermes/sales-desk/desk/deploycheck.py", import.meta.url), "utf8");
    const checksSalesApiJwt = /sales-api[^\n]{0,200}verify_jwt|verify_jwt[^\n]{0,200}sales-api/i.test(src);
    expect(checksSalesApiJwt).toBe(true);
  });
});

describe("m1 security r1: the lead's first name and the message service's own placeholder check", () => {
  const realNow = Date.now;
  // 10:00 in Kuwait: inside the lead's hours, so the link may go now.
  const DAY = Date.parse("2026-10-04T07:00:00Z");
  const run = async (name: string) => {
    reset();
    firstName = name;
    let t = DAY;
    Date.now = () => (t += 5);
    try {
      const desk = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
      const out = await call(desk, {
        action: "room.event",
        kind: "worker.ready",
        room_id: ROOM,
        payload: { worker_run: "run-1" },
      });
      const settled = () =>
        ghl.some((g) => g.method === "POST" && g.path === "/conversations/messages") ||
        Boolean(db.t("cockpit_sales_rooms")[0]?.refusal) ||
        db.t("cockpit_sales_room_events").some((e) => /Not sent|Fill in/.test(String(e.text ?? "")));
      for (let i = 0; i < 120 && !settled(); i++) await new Promise((r) => setTimeout(r, 25));
      const room = db.t("cockpit_sales_rooms")[0] as Row;
      const posts = ghl.filter((g) => g.method === "POST" && g.path === "/conversations/messages");
      return { out, room, posts };
    } finally {
      Date.now = realNow;
    }
  };

  test("control: a plain first name, the worker's handshake sends the room link by email (the fixture works)", async () => {
    const { out, posts } = await run("Huda");
    expect(out.status).toBe(200);
    expect(posts.length).toBe(1);
    expect(String((posts[0]?.body as Row | undefined)?.message ?? "")).toContain("https://meet.google.com/abc-defg-hij");
  });

  test("lead-name-placeholder-blocks-link: a first name HighLevel holds as an unfilled merge tag ({{name}}) stops the room link on every channel, and the rep is told to fill in {name}", async () => {
    const { room, posts } = await run("{{name}}");
    const said = db
      .t("cockpit_sales_room_events")
      .map((e) => String(e.text ?? ""))
      .join(" | ");
    expect({
      posts: posts.length,
      says_fill_in: /Fill in \{name\}/.test(`${said} ${String(room.refusal ?? "")}`),
    }).toEqual({
      posts: 1,
      says_fill_in: false,
    });
  });
});
