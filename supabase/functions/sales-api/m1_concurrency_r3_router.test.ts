// bun test supabase/functions/sales-api/m1_concurrency_r3_router.test.ts
//
// Milestone 1, round 3, angle: concurrency and idempotency, through
// sales-api's own doors (index.ts Deno.serve) with the real message service
// (convoSend: the request id's earlier try and its adopt, the switches, the
// sender's ceiling, the lead's row, HighLevel's contact, the message slot,
// the caller's last check, the stamp, then HighLevel's send).
//
// The send slot under two callers on one link key: the room's own email
// (the pilot's lane while the WhatsApp gate is locked) and the panel's Send
// by email, which rooms.ts sends on the same key. The message service lets
// a second try adopt an earlier try's unstamped row with the same words, and
// the stamp decides which of the two sends; the other must be told the
// truth (the email went, or is on its way), never "the email has not gone".
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
const SETTER = "stress-m1c3r-setter@stress.invalid";
const LEAD = "stress-m1c3r-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const posts: { at: number; body: Row; roomState: string }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

/** A country whose every clock is in the day now (the router runs on the real clock). */
const COUNTRY =
  ["KW", "GB", "US", "BR", "JP", "AU", "NZ", "IN", "DE", "MX"].find(
    c => hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now(), followups: {} }) === null &&
      hoursRefusal({ segment: "confirm", touch: 2, country: c, now: Date.now() + 10 * 60_000, followups: {} }) === null,
  ) ?? "KW";

/** The lead's number on that country's clock: Kuwait's own, else one outside the Gulf (no clock of its own). */
const PHONE = COUNTRY === "KW" ? "+96550000000" : "+447700900123";

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const roomState = () => String((db.t("cockpit_sales_rooms")[0] ?? {}).state ?? "none");

/**
 * The two stamps on one link key (index.ts markAsked: the row's
 * ghl_asked_at, written only while unstamped). Armed, the first stamp waits
 * until the second arrives; `first` names which one lands first then.
 */
let stamps: {
  first: "held" | "second";
  held?: { release: () => void; wait: Promise<void>; applied: Promise<void>; markApplied: () => void };
  reached: () => void;
  atFirst: Promise<void>;
  count: number;
} | null = null;

function armStamps(first: "held" | "second") {
  let reached!: () => void;
  const atFirst = new Promise<void>(r => {
    reached = r;
  });
  stamps = { first, reached, atFirst, count: 0 };
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
    const prefer = headers.get("prefer") ?? "";
    const body = init.body ? (JSON.parse(String(init.body)) as Row) : null;
    const isStamp = method === "PATCH" && path.startsWith("cockpit_sales_messages?id=eq.") && body && typeof body.ghl_asked_at === "string";
    if (isStamp && stamps) {
      const s = stamps;
      s.count += 1;
      if (s.count === 1) {
        let release!: () => void;
        let markApplied!: () => void;
        const wait = new Promise<void>(r => {
          release = r;
        });
        const applied = new Promise<void>(r => {
          markApplied = r;
        });
        s.held = { release, wait, applied, markApplied };
        s.reached();
        await wait;
        const out = await dbAnswer(path, method, init, prefer);
        markApplied();
        return out;
      }
      if (s.count === 2 && s.held) {
        const held = s.held;
        if (s.first === "held") {
          // The held stamp lands first, then this one.
          held.release();
          await held.applied;
          return await dbAnswer(path, method, init, prefer);
        }
        // This stamp lands first, then the held one.
        const out = await dbAnswer(path, method, init, prefer);
        held.release();
        await held.applied;
        return out;
      }
    }
    return await dbAnswer(path, method, init, prefer);
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    if (method === "GET" && path.startsWith(`/contacts/${LEAD}`))
      return reply({
        // A number that keeps the chosen country's clock (m1 round 3: a Gulf number's own clock comes first).
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: PHONE, email: "huda@example.com", country: COUNTRY, tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      posts.push({ at: Date.now(), body: JSON.parse(String(init.body ?? "{}")), roomState: roomState() });
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
  await import("./index.ts?m1_concurrency_r3_router");
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
  stamps = null;
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

/** Send by email pressed while the room's own email sits between its slot and its stamp. */
async function race(first: "held" | "second") {
  reset();
  armStamps(first);
  const pressed = call("setter", { action: "room.create", request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
  const id = await worker();
  const made = await pressed;
  expect([made.status, (made.body.room as Row).state]).toEqual([200, "open"]);
  // The room's own email took its slot and passed the room's last check: its stamp is next.
  const got = await Promise.race([(stamps as NonNullable<typeof stamps>).atFirst.then(() => "stamp"), new Promise<string>(r => setTimeout(() => r("never"), 20_000))]);
  if (got !== "stamp")
    throw new Error(`the room's email never reached its stamp: ${JSON.stringify({ room: db.t("cockpit_sales_rooms")[0], lines: db.t("cockpit_sales_room_events").map(e => e.text) })}`);
  // The setter presses Send by email in the panel (the room shows no channel yet).
  const press = await call("setter", { action: "room.send", room_id: id, request_id: crypto.randomUUID(), channel: "email" });
  // A press that never reached a stamp of its own: the held one goes on.
  stamps?.held?.release();
  for (let i = 0; i < 800 && !posts.length; i++) await tick();
  // The send's read-back (2 s) and the room's record of it.
  const sentAt = () => (db.t("cockpit_sales_rooms").find(r => r.id === id) as Row).link_sent_at;
  for (let i = 0; i < 1600 && !sentAt(); i++) await tick();
  for (let i = 0; i < 200; i++) await tick();
  const room = db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const lines = db.t("cockpit_sales_room_events").filter(e => e.room_id === id).map(e => String(e.text ?? ""));
  return { id, press, room, lines };
}

describe("m1 concurrency r3 (router): Send by email beside the room's own email, on one link key", () => {
  test("send-by-email-adopt-race-says-not-gone (the room's email stamps first): the setter presses Send by email while the room's own email sits between its slot and its stamp; the press adopts that unsent row and loses the stamp: one email reaches the lead, and the press must not say the email has not gone", async () => {
    const { press, room } = await race("held");
    expect({
      emails_to_lead: posts.length,
      link_sent: Boolean(room.link_sent_at),
      press_status: press.status,
      press_says_not_gone: /has not gone/i.test(String(press.body.error ?? press.body.note ?? "")),
    }).toEqual({ emails_to_lead: 1, link_sent: true, press_status: 200, press_says_not_gone: false });
  }, 60_000);

  test("send-by-email-adopt-race-says-not-gone (the press stamps first): the press's adopted row wins the stamp and the room's own email loses it: one email, and the room's timeline must not say the link has not gone", async () => {
    const { press, room, lines } = await race("second");
    expect({
      emails_to_lead: posts.length,
      link_sent: Boolean(room.link_sent_at),
      press_status: press.status,
      timeline_says_not_gone: lines.filter(l => /has not gone/i.test(l)),
    }).toEqual({ emails_to_lead: 1, link_sent: true, press_status: 200, timeline_says_not_gone: [] });
  }, 60_000);
});
