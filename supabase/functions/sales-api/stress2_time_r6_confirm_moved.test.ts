// bun test supabase/functions/sales-api/stress2_time_r6_confirm_moved.test.ts
//
// TIME stress, second series, round 6: the confirmation message the desk
// writes the evening before, and the intro moved before anyone sends it.
//
// The desk writes a "confirm" draft from 18:00 the evening before a morning
// call (followups.py confirm_from, at its :07 and :37 runs), naming the
// call's day and time (GOAL["confirm"]: "name the day and time from
// the_call"), and stores the call's start in context.start_at. A call moved
// (or cancelled) since is caught only by the desk's close_gone at its next
// run (gone_reason: "The call this confirms was moved; a confirmation for
// the new time is written when it is due."), up to half an hour later. In
// between the draft sits on the Follow-ups page (open while expires_at, the
// OLD start less an hour, is ahead) and sales-api's sendFollowup sends it as
// written: it reads the lead's country, the hours, the expiry and whether the
// conversation moved on, never the call the draft confirms.
//
// Run end to end through the real handler (Deno.serve's function) with the
// outside world faked at fetch, as stress2_chaos_r5_sends.test.ts does.
// Synthetic only; nothing leaves this process. A failing test is a finding.
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "setter-t2r6c@stress.invalid";
const LEAD = "stress-t2r6-confirm-0001";
const APPT = "stress-t2r6-intro-0001";
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string; body: unknown }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: REP, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" });
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
    ghlCalls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && /^\/contacts\/[^/]+\/appointments/.test(path)) return reply({ events: [] });
    if (method === "GET" && path.startsWith("/calendars/events/appointments/")) {
      const a = db.t("cockpit_sales_appointments").find(x => x.appointment_id === APPT);
      return reply({ appointment: { id: APPT, contactId: LEAD, appointmentStatus: a?.status, startTime: a?.start_at } });
    }
    if (method === "GET" && path.startsWith("/contacts/")) {
      return reply({
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", email: "huda@example.com", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} },
      });
    }
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages")
      return reply({ messageId: `m-${ghlCalls.length}`, conversationId: "conv-1", status: "pending" });
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
  await import("./index.ts?stress2_time_r6_confirm_moved");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
  setSystemTime();
});

/** The intro, booked on Monday for Thursday 8 October 10:00 Kuwait. */
const START = kw("2026-10-08T10:00:00");
const BODY =
  "Hi Huda, it's Tara from Mahara Media. Just checking you can still make our call tomorrow, Thursday 8 October at 10:00. Reply to confirm, or tell me if another time suits you better.";

/**
 * Wednesday 7 October 18:07 Kuwait: the desk's run writes the confirmation
 * (email: the lead has not written on WhatsApp). `now` the appointment as it
 * stands when the setter presses Approve.
 */
function reset(appt: { start: number; status: string }): string {
  db.tables = {};
  ghlCalls.length = 0;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "followups", value: { enabled: true, agent: true } },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Tara Setter", ghl_user_id: "G-setter", role: "setter", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", tags: ["roas-qualified"] }]);
  const row = {
    appointment_id: APPT,
    contact_id: LEAD,
    call_type: "intro",
    status: appt.status,
    start_at: iso(appt.start),
    booked_at: iso(kw("2026-10-05T12:00:00")),
    assigned_user_id: "G-setter",
    calendar_id: "stress-cal",
  };
  // Both copies of the calendar the cockpit keeps (B2B's mirror).
  db.seed("cockpit_sales_appointments", [{ ...row }]);
  db.seed("cockpit_sales_calendar", [{ ...row }]);
  const id = crypto.randomUUID();
  db.seed("cockpit_sales_followups", [
    {
      id,
      contact_id: LEAD,
      segment: "confirm",
      touch: 1,
      channel: "email",
      subject: "Our call tomorrow at 10:00",
      body: BODY,
      status: "draft",
      owner_email: REP,
      appointment_id: APPT,
      created_at: iso(kw("2026-10-07T18:07:00")),
      // followups.py: min(now + 48 h, the call's start - 1 h), from the start it read.
      expires_at: iso(START - 3_600_000),
      context: { start_at: iso(START), the_call: { day: "Thursday 08 October", relative: "tomorrow", time_24h: "10:00" } },
    },
  ]);
  return id;
}

async function approve(id: string): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "followup.approve", id }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const sentToLead = () =>
  ghlCalls.filter(c => c.method === "POST" && c.path === "/conversations/messages").map(c => String((c.body as Row)?.html ?? (c.body as Row)?.message ?? ""));

describe("Wednesday 18:25 Kuwait: the setter approves the desk's 18:07 confirmation of Thursday's 10:00 intro", () => {
  test("HELD (control): the intro still at 10:00: the confirmation goes", async () => {
    setSystemTime(new Date(kw("2026-10-07T18:25:00")));
    const id = reset({ start: START, status: "confirmed" });
    const out = await approve(id);
    expect({ status: out.status, went: sentToLead().length }).toEqual({ status: 200, went: 1 });
  }, 60_000);

  test("the lead moved the intro to Sunday 14:00 at 18:15 (the copy caught up at 18:18): no message saying 'tomorrow at 10:00' goes", async () => {
    setSystemTime(new Date(kw("2026-10-07T18:25:00")));
    const id = reset({ start: kw("2026-10-11T14:00:00"), status: "confirmed" });
    const out = await approve(id);
    const f = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
    const recorded = db.t("cockpit_sales_confirmations").map(c => `${String(c.result)} for ${String(c.start_at)}`);
    // Found: 200, the email "...our call tomorrow, Thursday 8 October at
    // 10:00. Reply to confirm..." goes to a lead whose call is now on Sunday
    // at 14:00, and the follow-up is saved sent (a confirmation recorded
    // against the moved call, so the dialer's confirmation call waits too).
    // And the send is recorded as the moved call's confirmation (message_sent
    // for Sunday 14:00), so the desk never writes a real one for Sunday.
    expect({ status: out.status, went: sentToLead().length, draft: f.status, recorded }).toEqual({
      status: 409,
      went: 0,
      draft: expect.stringMatching(/^(expired|draft)$/),
      recorded: [],
    });
  }, 60_000);

  test("the lead cancelled the intro at 18:15: no 'can you still make our call' goes", async () => {
    setSystemTime(new Date(kw("2026-10-07T18:25:00")));
    const id = reset({ start: START, status: "cancelled" });
    const out = await approve(id);
    // Found: 200 and the confirmation goes for a call the lead cancelled.
    expect({ status: out.status, went: sentToLead().length }).toEqual({ status: 409, went: 0 });
  }, 60_000);

  test("moved earlier, to today 18:30, and held: at 18:50 no confirmation of 'tomorrow at 10:00' goes after the call", async () => {
    setSystemTime(new Date(kw("2026-10-07T18:50:00")));
    const id = reset({ start: kw("2026-10-07T18:30:00"), status: "showed" });
    const out = await approve(id);
    // Found: 200: expires_at is still the old start less an hour (Thursday
    // 09:00), so the page shows the draft and the send takes it.
    expect({ status: out.status, went: sentToLead().length }).toEqual({ status: 409, went: 0 });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The lead's midnight between the draft and the send
//
// A call before noon is confirmed from 18:00 the evening before (confirm_from),
// so the desk's 18:07 run writes "tomorrow". Its expiry is the call's start
// less an hour (followups.py: min(now + 48 h, start - 1 h)), and quiet hours
// end at 09:00: for every call from 10:01 to 11:59 Kuwait (74 of the last 60
// days' intros started at 10:xx or 11:xx) the draft is on the page, and sent
// as written, on the morning of the call itself.
// ---------------------------------------------------------------------------

describe("Thursday 09:15 Kuwait: the setter approves the confirmation the desk wrote at 18:07 on Wednesday for today's 11:00 intro", () => {
  test("no message saying 'our call tomorrow at 11:00' goes on the day of the call", async () => {
    setSystemTime(new Date(kw("2026-10-08T09:15:00")));
    const start = kw("2026-10-08T11:00:00");
    const id = reset({ start, status: "confirmed" });
    // The desk's draft as written at 18:07 on Wednesday (call_words: relative "tomorrow").
    const f0 = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
    f0.body = "Hi Huda, it's Tara from Mahara Media. Just checking you can still make our call tomorrow at 11:00. Reply to confirm, or tell me if another time suits you better.";
    f0.subject = "Our call tomorrow at 11:00";
    f0.expires_at = iso(start - 3_600_000);
    f0.context = { start_at: iso(start), the_call: { day: "Thursday 08 October", relative: "tomorrow", time_24h: "11:00" } };
    const out = await approve(id);
    // Found: 200, the email "...our call tomorrow at 11:00..." reaches the
    // lead at 09:15 on Thursday, the day of the call: nothing in the send
    // reads the lead's day against the day the draft was written for, and its
    // expiry (10:00, the start less an hour) keeps it open on the page.
    expect({ status: out.status, went: sentToLead() }).toEqual({ status: 409, went: [] });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The two evening-before flows at once: the dialer's confirmation call (from
// 18:00, dialer.ts confirmFrom) and the desk's confirmation message (its
// 18:07 run). The lead confirms on the phone at 18:20 (a confirmations row,
// result confirmed); the desk's draft stays open (followups.py close_gone
// reads the calendar, never the confirmations) and sendFollowup reads neither.
// ---------------------------------------------------------------------------

describe("Wednesday 18:30 Kuwait: the lead confirmed Thursday's intro on the setter's 18:20 confirmation call; a rep approves the desk's 18:07 confirmation", () => {
  test("no 'can you still make our call? Reply to confirm' goes to a lead who confirmed ten minutes ago", async () => {
    setSystemTime(new Date(kw("2026-10-07T18:30:00")));
    const id = reset({ start: START, status: "confirmed" });
    db.seed("cockpit_sales_confirmations", [
      {
        appointment_id: APPT,
        contact_id: LEAD,
        call_type: "intro",
        start_at: iso(START),
        result: "confirmed",
        via: "call",
        by_email: REP,
        at: iso(kw("2026-10-07T18:20:00")),
      },
    ]);
    const out = await approve(id);
    // Found: 200, the email asking the lead to confirm goes after they
    // confirmed by phone; the desk's next run (18:37) does not close the draft
    // either (gone_reason has no confirmation check).
    expect({ status: out.status, went: sentToLead().length }).toEqual({ status: 409, went: 0 });
  }, 60_000);
});
