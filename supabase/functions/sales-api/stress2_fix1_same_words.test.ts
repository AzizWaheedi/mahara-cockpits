// bun test supabase/functions/sales-api/stress2_fix1_same_words.test.ts
//
// Stress series 2, fix round 1: same-words-twice-no-dedupe-pauses-whatsapp.
// index.ts convo.send run end to end through the real handler (Deno.serve's
// function) with the outside world faked at fetch, as
// stress_chaos_r3_template.test.ts does. The same WhatsApp words to one lead
// from two tabs (each its own request id) went twice, and once the WA
// Connector was marked off, the duplicate detector read the cockpit's own two
// sends as the connector's copy and paused WhatsApp for every rep. Now the
// message slot (20261004a, its fake in testfakes.ts) answers the second as
// "this message went a moment ago", and the detector never pauses on a pair
// of the cockpit's own sends.
import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-s2w@stress.invalid";
const LEAD = "stress-s2w-lead-1";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const sent: Row[] = [];
/** The conversation the duplicate detector reads after a send (newest first). */
let conversation: Row[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: REP, name: "Rafi Rep", role: "setter", ghl_user_id: "G-rep" });
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
    if (method === "GET" && path.startsWith("/contacts/"))
      return reply({ contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} } });
    if (method === "GET" && path.startsWith("/conversations/search"))
      return reply({ conversations: [{ id: "cv-s2w", lastInboundWhatsappMessageDate: new Date(Date.now() - 3_600_000).toISOString() }] });
    if (method === "POST" && path === "/conversations/messages") {
      const body = JSON.parse(String(init.body ?? "{}")) as Row;
      const id = `ghl-s2w-${sent.length + 1}`;
      sent.push({ id, ...body });
      return reply({ messageId: id, conversationId: "cv-s2w" });
    }
    if (method === "GET" && path.startsWith("/conversations/messages/")) {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      return reply({ message: { id, status: "delivered", direction: "outbound", messageType: "TYPE_WHATSAPP" } });
    }
    if (method === "GET" && path.startsWith("/conversations/cv-s2w/messages")) return reply({ messages: { messages: conversation } });
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
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?stress2-same-words");
});

function reset(): void {
  db.tables = {};
  sent.length = 0;
  conversation = [];
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    // The WA Connector is off and the single-copy test passed: the duplicate detector watches.
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", dup_window_s: 60 } },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali" }]);
}

async function send(body: string): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts was imported by another test file in this process: run this file on its own");
  const res = await handler(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "convo.send", contact_id: LEAD, channel: "whatsapp", body, request_id: crypto.randomUUID() }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const guard = () => (db.t("cockpit_sales_settings").find(r => r.key === "whatsapp_guard")?.value ?? {}) as Row;

async function settled(): Promise<void> {
  // The duplicate detector runs in the background after a send.
  for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 10));
}

describe("the same WhatsApp words to one lead from two tabs", () => {
  test("the second press is answered as the send that went a moment ago; the lead gets the words once", async () => {
    reset();
    const first = await send("Hi Huda, are you free for a quick call?");
    expect(first.status).toBe(200);
    const second = await send("hi huda,  are you free for a quick call?");
    expect(second.status).toBe(409);
    expect(String(second.body.error)).toMatch(/went to this lead a moment ago/);
    expect(sent).toHaveLength(1);
    expect(db.t("cockpit_sales_messages")).toHaveLength(1);
    // Other words go.
    expect((await send("Or tomorrow at 10?")).status).toBe(200);
    expect(sent).toHaveLength(2);
    await settled();
    expect(guard().dup_paused_at ?? null).toBeNull();
  }, 60_000);

  test("the duplicate detector never pauses WhatsApp for two of the cockpit's own sends, and still does for the connector's copy", async () => {
    reset();
    const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    // Two earlier sends of the cockpit's own, each its own request id (as
    // before the slot answered same words as one), and their conversation.
    db.seed("cockpit_sales_messages", [
      { id: crypto.randomUUID(), request_id: crypto.randomUUID(), contact_id: LEAD, channel: "whatsapp", via: "conversation", body: "See you at 10.", state: "sent", ghl_message_id: "ghl-own-a", sent_by: REP, created_at: at(200) },
      { id: crypto.randomUUID(), request_id: crypto.randomUUID(), contact_id: LEAD, channel: "whatsapp", via: "conversation", body: "See you at 10.", state: "sent", ghl_message_id: "ghl-own-b", sent_by: REP, created_at: at(190) },
    ]);
    conversation = [
      { id: "ghl-own-b", direction: "outbound", messageType: "TYPE_WHATSAPP", body: "See you at 10.", dateAdded: at(5) },
      { id: "ghl-own-a", direction: "outbound", messageType: "TYPE_WHATSAPP", body: "See you at 10.", dateAdded: at(10) },
    ];
    expect((await send("Thanks Huda.")).status).toBe(200);
    await settled();
    expect(guard().dup_paused_at ?? null).toBeNull();
    // The connector's copy of one of them (an id the cockpit never sent): paused.
    conversation = [{ id: "ghl-connector-copy", direction: "outbound", messageType: "TYPE_WHATSAPP", body: "See you at 10.", dateAdded: at(4) }, ...conversation];
    expect((await send("One more thing.")).status).toBe(200);
    await settled();
    expect(guard().dup_paused_at ?? null).not.toBeNull();
  }, 60_000);
});
