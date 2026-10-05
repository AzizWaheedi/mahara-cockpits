// bun test supabase/functions/sales-api/stress2_chaos_r6_sends.test.ts
//
// Second series, round 6, chaos: round 5's give-up of an unsent message row
// (index.ts voidUnsent, markAsked's DELETE) is a database write too. When the
// slot's answer is lost (or the stamp fails) on a blip that also takes the
// give-up DELETE, the "sending" row with no ghl_asked_at stands. The rep is
// told "Not sent ... Try again in a minute"; a press again inside 30 s finds
// the row by its request id, unaskedOrphan() is still false (it waits 30 s),
// and the row is answered as a repeat: "That message was already sent." and
// the box is cleared (Conversation.tsx), or the follow-up is saved "sent".
// Nothing reached the lead, and the row stays "sending" for good (the desk
// then reads it as a person's answer: tests/test_stress2_chaos_r6.py).
//
// The harness below is round 5's (stress2_chaos_r5_sends.test.ts), copied so
// this file stands alone, with one more fault: the next N DELETEs of a
// message row fail with a 503.
//
// ORIGINAL HEADER (round 5):
//
// Second series, round 5, chaos: the message slot's answer lost AFTER its
// row landed. index.ts writes every send's message row first
// (cockpit_sales_message_slot, 20261003d/20261004a), then asks HighLevel.
// beforeRowCertain (stress2 round 4) answers any failure before `taken()` as
// a certain "Not sent yet, try again in a minute" (503 not_sent_yet), and
// sendFollowup puts the draft back to draft. But the slot is a database
// write: when its answer is lost (the 20 s timeout fires after the function
// committed, a gateway drops the answer), the "sending" row stands, with
// HighLevel never asked. The retry the answer asks for finds that row by its
// request id and answers it as a repeat ("repeated": the message as it
// stands), so the follow-up is saved "sent" and the rep's message is told
// "That message was already sent." Nothing ever reached the lead.
//
// Run end to end through the real handler (Deno.serve's function) with the
// outside world faked at fetch, as stress_numbers_sendtemplate.test.ts does.
// Synthetic only; nothing leaves this process. A failing test is a finding;
// tests marked HELD pass.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-c2r6@stress.invalid";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string; body: unknown }[] = [];
/** The next N message slots land in the database and their answer is lost (the 20 s timeout fires after the commit). */
let slotLost = 0;
/** HighLevel's answer to the next sends (POST /conversations/messages): "ok", or a 200 that carries no send ("empty": no body; "page": a proxy's object). */
const sendAnswers: ("ok" | "empty" | "page")[] = [];
/** HighLevel answers the next N contact reads with a 502 (nothing went: the send stops before its row). */
let contactBlips = 0;
/** HighLevel's answer to the lead's calendar (GET /contacts/{id}/appointments): their calls, or a 200 that carries none ("empty", "page"). */
let calendarAnswer: "calls" | "empty" | "page" = "calls";
/** The lead's calls as HighLevel has them. */
let calendarCalls: Row[] = [];
/** The next N writes of a follow-up's "sent" land and their answer is lost. */
let sentWriteLost = 0;
/** Database reads whose path starts with one of these answer 200 with an empty body, once each. */
const emptyReads: string[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;
/** Round 6: the next N DELETEs on cockpit_sales_messages answer 503 (the same blip as the slot's lost answer). */
let messageDeleteFails = 0;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function timeout(): Error {
  // What fetch throws when AbortSignal.timeout fires (index.ts fetchWithin reads its name).
  return Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: REP, name: "Rafi Rep", role: "setter", ghl_user_id: "G-rep" });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      const out = await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {});
      if (fn === "cockpit_sales_message_slot" && slotLost > 0) {
        slotLost--;
        // The function committed its "sending" row; its answer never came back.
        throw timeout();
      }
      return reply(out);
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw e;
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    const path = url.slice(`${DB}/rest/v1/`.length);
    const headers = new Headers(init.headers as HeadersInit);
    const prefer = headers.get("prefer") ?? "";
    const empty = method === "GET" ? emptyReads.findIndex(p => path.startsWith(p)) : -1;
    if (empty >= 0) {
      emptyReads.splice(empty, 1);
      return new Response("", { status: 200 });
    }
    if (method === "DELETE" && path.startsWith("cockpit_sales_messages?") && messageDeleteFails > 0) {
      messageDeleteFails--;
      return reply({ message: "upstream connect error or disconnect/reset before headers" }, 503);
    }
    try {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      const rows = await db.db(path, { method, body, prefer });
      if (sentWriteLost > 0 && method === "PATCH" && path.startsWith("cockpit_sales_followups?") && (body as Row | undefined)?.status === "sent") {
        sentWriteLost--;
        throw timeout();
      }
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw e;
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    ghlCalls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && /^\/contacts\/[^/]+\/appointments/.test(path)) {
      if (calendarAnswer === "empty") return new Response("", { status: 200 });
      if (calendarAnswer === "page") return reply({ html: "<html><body>Just a moment...</body></html>" });
      return reply({ events: calendarCalls });
    }
    if (method === "POST" && path === "/calendars/events/appointments") return reply({ id: `live-${ghlCalls.length}` });
    if (method === "GET" && path.startsWith("/calendars/events/appointments/")) {
      const id = decodeURIComponent(path.split("/")[4] ?? "");
      const c = calendarCalls.find(x => x.id === id);
      return reply({ appointment: c ? { ...c } : { id, appointmentStatus: "confirmed" } });
    }
    if (method === "GET" && path.startsWith("/contacts/") && contactBlips > 0) {
      contactBlips--;
      return reply({ message: "Bad Gateway" }, 502);
    }
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({
        contact: { id, firstName: "Huda", name: "Huda Ali", email: "huda@example.com", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    }
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages") {
      const a = sendAnswers.shift() ?? "ok";
      if (a === "empty") return new Response("", { status: 200 });
      if (a === "page") return reply({ html: "<html><body>Please wait while we check your browser</body></html>" });
      return reply({ messageId: `m-${ghlCalls.length}`, conversationId: "conv-1", status: "pending" });
    }
    // The read-back: an email HighLevel took.
    if (method === "GET" && path.startsWith("/conversations/messages/")) return reply({ message: { id: path.split("/")[3], status: "delivered" } });
    return reply({ ok: true });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

const before = { fetch: globalThis.fetch, deno: (globalThis as unknown as { Deno?: unknown }).Deno };

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
  // A module instance of its own (the query string): its live-call modules'
  // IO (liveio.ts makeLiveIO) keeps the fetch it was made with, so another
  // test file that loaded index.ts first in this process never answers for
  // this one, and this one never answers for it.
  await import("./index.ts?stress2_chaos_r6_sends");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
});

const LEAD = "stress-c2r6-lead-0001";

function reset(): void {
  db.tables = {};
  ghlCalls.length = 0;
  slotLost = 0;
  sendAnswers.length = 0;
  contactBlips = 0;
  calendarAnswer = "calls";
  calendarCalls = [];
  sentWriteLost = 0;
  emptyReads.length = 0;
  messageDeleteFails = 0;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "followups", value: { enabled: true, agent: true } },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", role: "setter", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", tags: ["roas-qualified"] }]);
}

/** A rep's reply draft by email (segment reply: no hours apply). */
function seedReplyDraft(): string {
  const id = crypto.randomUUID();
  db.seed("cockpit_sales_followups", [
    {
      id,
      contact_id: LEAD,
      segment: "reply",
      touch: 1,
      channel: "email",
      subject: "Your call with Mahara",
      body: "Hi Huda, yes, Sunday at 4 works. I have booked it for you.",
      status: "draft",
      owner_email: REP,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ]);
  return id;
}

async function call(body: Row): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const sentToLead = () => ghlCalls.filter(c => c.method === "POST" && c.path === "/conversations/messages").length;


describe("chaos2 r6: the slot's answer lost and the give-up DELETE lost on the same blip (convo.send)", () => {
  const send = (rid: string) =>
    call({
      action: "convo.send",
      contact_id: LEAD,
      channel: "email",
      subject: "Your call",
      body: "Hi Huda, here is the recording of our call.",
      request_id: rid,
    });

  test("HELD (round 5): the give-up lands: the same words again go once", async () => {
    reset();
    const rid = crypto.randomUUID();
    slotLost = 1;
    const first = await send(rid);
    expect({ status: first.status, code: first.body.code }).toEqual({ status: 503, code: "not_sent_yet" });
    const second = await send(rid);
    expect({ status: second.status, repeated: second.body.repeated ?? false, went: sentToLead() }).toEqual({ status: 200, repeated: false, went: 1 });
  }, 60_000);

  test("not-sent-yet-retry-says-already-sent-when-give-up-lost: told 'Not sent, try again', the rep presses again at once (the box keeps the id): the words must go, never 'That message was already sent.' with nothing sent", async () => {
    reset();
    const rid = crypto.randomUUID();
    slotLost = 1;
    messageDeleteFails = 2; // voidUnsent's DELETE (and nothing else) fails on the same blip
    const first = await send(rid);
    expect({ status: first.status, code: first.body.code }).toEqual({ status: 503, code: "not_sent_yet" });
    expect(sentToLead()).toBe(0);
    const second = await send(rid);
    // convo.send keys the row on the seat's hash of the id (index.ts seatMessageId): found by the lead.
    const row = db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row | undefined;
    expect({
      status: second.status,
      // Conversation.tsx: repeated -> toast "That message was already sent." and the box is cleared.
      repeated: second.body.repeated ?? false,
      reached_lead: sentToLead(),
      row: row ? `${row.state}/${row.ghl_asked_at ? "asked" : "never asked"}` : "none",
    }).toEqual({ status: 200, repeated: false, reached_lead: 1, row: expect.stringMatching(/^(sent|delivered)\/asked$/) });
  }, 60_000);
});

describe("chaos2 r6: the slot's answer lost and the give-up DELETE lost on the same blip (followup.approve)", () => {
  test("approve-again-saves-unsent-draft-as-sent: the second Approve inside 30 s must send the reply, never save the draft 'sent' on a row HighLevel was never asked about", async () => {
    reset();
    const id = seedReplyDraft();
    slotLost = 1;
    messageDeleteFails = 2;
    const first = await call({ action: "followup.approve", id });
    expect({ status: first.status, code: first.body.code }).toEqual({ status: 503, code: "not_sent_yet" });
    expect(db.t("cockpit_sales_followups").find(f => f.id === id)?.status).toBe("draft");
    const second = await call({ action: "followup.approve", id });
    const f = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
    expect({
      second: second.status,
      draft: f.status,
      reached_lead: sentToLead(),
    }).toEqual({ second: 200, draft: "sent", reached_lead: 1 });
  }, 60_000);
});
