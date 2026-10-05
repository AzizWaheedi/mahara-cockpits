// bun test supabase/functions/sales-api/stress2_chaos_r5_sends.test.ts
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
const REP = "rep-c2r5@stress.invalid";
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
  await import("./index.ts?stress2_chaos_r5_sends");
});

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
});

const LEAD = "stress-c2r5-lead-0001";

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
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "followups", value: { enabled: true } },
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

describe("chaos2 r5: the message slot lands and its answer is lost (followup.approve)", () => {
  test("HELD: the database answers: the reply goes once and the draft is sent", async () => {
    reset();
    const id = seedReplyDraft();
    const out = await call({ action: "followup.approve", id });
    expect(out.status).toBe(200);
    expect({ sent: sentToLead(), status: db.t("cockpit_sales_followups").find(f => f.id === id)?.status }).toEqual({ sent: 1, status: "sent" });
  }, 60_000);

  test("slot-lost-answer-retry-closes-draft-unsent: the first press is told 'Not sent, try again'; the second press must send the reply, never close the draft as 'the conversation has moved on' on its own unsent row", async () => {
    reset();
    const id = seedReplyDraft();
    slotLost = 1;
    const first = await call({ action: "followup.approve", id });
    // The first answer is right: nothing went, try again.
    expect({ status: first.status, code: first.body.code }).toEqual({ status: 503, code: "not_sent_yet" });
    expect(sentToLead()).toBe(0);
    expect(db.t("cockpit_sales_followups").find(f => f.id === id)?.status).toBe("draft");
    // The rep does as told and presses Approve again.
    const second = await call({ action: "followup.approve", id });
    const f = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
    const msg = db.t("cockpit_sales_messages").find(m => m.request_id === id) as Row;
    expect({
      second_status: second.status,
      second_says: second.status === 200 ? null : second.body.error,
      draft: f.status,
      message_state: msg?.state,
      reached_lead: sentToLead(),
    }).toEqual({ second_status: 200, second_says: null, draft: "sent", message_state: expect.stringMatching(/^(sent|delivered)$/), reached_lead: 1 });
  }, 60_000);
});

describe("chaos2 r5: the message slot lands and its answer is lost (convo.send, the rep's own message)", () => {
  test("slot-lost-answer-retry-says-already-sent: the rep is told 'Not sent, try again'; the same words again (the box keeps their id) must go, never 'already sent'", async () => {
    reset();
    const rid = crypto.randomUUID();
    const send = () =>
      call({
        action: "convo.send",
        contact_id: LEAD,
        channel: "email",
        subject: "Your call",
        body: "Hi Huda, here is the recording of our call.",
        request_id: rid,
      });
    slotLost = 1;
    const first = await send();
    expect({ status: first.status, code: first.body.code }).toEqual({ status: 503, code: "not_sent_yet" });
    const second = await send();
    // Conversation.tsx: repeated -> "That message was already sent." and the box is cleared.
    expect({ status: second.status, repeated: second.body.repeated ?? false, went: sentToLead() }).toEqual({ status: 200, repeated: false, went: 1 });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The room's link: the same lost slot answer, through room.event tick
// ---------------------------------------------------------------------------

/** The desk's service key (index.ts jwtRole reads the role claim the gateway verified). */
const SERVICE_JWT = `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`;

async function desk(body: Row): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_JWT}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

describe("chaos2 r5: the message slot lands and its answer is lost (a room's link, the minute's re-ask)", () => {
  const waits: Promise<unknown>[] = [];
  async function settle(): Promise<void> {
    for (let i = 0; i < 20 && waits.length; i++) await Promise.allSettled(waits.splice(0));
  }
  function seedRoom(now: number): string {
    const id = crypto.randomUUID();
    db.seed("cockpit_sales_settings", [
      {
        key: "rooms",
        value: {
          enabled: true,
          test_only: false,
          providers: { zoom: true, meet: true },
          // Email only, so the cascade is one channel.
          send: { whatsapp_text: false, whatsapp_template: false, email: true },
          short_link: false,
          waits_s: { unconfirmed: 20 },
        },
      },
      { key: "live", value: { enabled: false } },
    ]);
    db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: crypto.randomUUID(),
        code: "K7Q2MX",
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "fallback",
        call_kind: "intro",
        provider: "meet",
        host_email: REP,
        made_by: REP,
        state: "open",
        version: 2,
        send_on: "open",
        join_url: "https://meet.google.com/abc-defg-hij",
        provider_meeting_id: "abc-defg-hij",
        requested_at: new Date(now - 3 * 60_000).toISOString(),
        created_at: new Date(now - 3 * 60_000).toISOString(),
        opened_at: new Date(now - 2 * 60_000).toISOString(),
        link_claimed_at: new Date(now - 70_000).toISOString(),
        host_by: new Date(now + 8 * 60_000).toISOString(),
        lead_by: new Date(now + 8 * 60_000).toISOString(),
        ends_at: new Date(now + 50 * 60_000).toISOString(),
        link_channels: [],
        link_message_ids: {},
      },
    ]);
    return id;
  }

  test("slot-lost-answer-room-link-stuck-may-have-gone: the email's slot lands and its answer is lost: by three minutes on the lead has the link, never 'may have gone' for a link HighLevel was never asked to send", async () => {
    const { setSystemTime } = await import("bun:test");
    (globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waits.push(p) };
    reset();
    const t0 = Date.parse("2026-10-05T08:00:00Z");
    setSystemTime(new Date(t0));
    try {
      const id = seedRoom(t0);
      slotLost = 1;
      expect((await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } })).status).toBe(200);
      await settle();
      // The first answer: HighLevel was never asked, and the room is told the link has not gone yet.
      expect(sentToLead()).toBe(0);
      // The minute's re-asks, as the SQL tick posts them.
      for (const s of [65, 130, 195]) {
        setSystemTime(new Date(t0 + s * 1000));
        await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } });
        await settle();
      }
      const room = db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
      const rows = db.t("cockpit_sales_messages").filter(m => m.contact_id === LEAD);
      expect({
        link_reached_lead: sentToLead(),
        link_sent_at: Boolean(room.link_sent_at),
        room_says: room.refusal ?? null,
        message_states: rows.map(r => r.state),
      }).toEqual({ link_reached_lead: 1, link_sent_at: true, room_says: null, message_states: [expect.stringMatching(/^(sent|delivered)$/)] });
    } finally {
      setSystemTime();
      delete (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime;
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// HighLevel answers the send with a 200 that carries no send
// ---------------------------------------------------------------------------

describe("chaos2 r5: HighLevel answers the send 200 with no message in it", () => {
  for (const shape of ["empty", "page"] as const) {
    test(`send-200-without-message-id-recorded-sent (${shape}): a 200 with no messageId is no proof the email went: never a certain sent, never the lead taken out of the old automation on it`, async () => {
      reset();
      // The reply kind takes over from HighLevel's own automation once its send is seen to have gone.
      db.t("cockpit_sales_settings").find(r => r.key === "followups")!.value = { enabled: true, takeover: { reply: true }, replaces: { reply: ["wf-old-reply"] } };
      const id = seedReplyDraft();
      sendAnswers.push(shape);
      const out = await call({ action: "followup.approve", id });
      const msg = db.t("cockpit_sales_messages").find(m => m.request_id === id) as Row;
      const takenOut = ghlCalls.filter(c => c.method === "DELETE" && c.path.includes("/workflow/wf-old-reply")).length;
      // Fix round 5: the send answers "may have gone" (502, unclear), never 200 sent.
      expect({ status: out.status, has_highlevel_id: Boolean(msg?.ghl_message_id) }).toEqual({ status: 502, has_highlevel_id: false });
      // The finding: a send HighLevel never acknowledged is recorded as gone, and the lead leaves the old automation on it.
      expect({ message_state: msg?.state, lead_taken_out_of_old_automation: takenOut }).toEqual({ message_state: "unclear", lead_taken_out_of_old_automation: 0 });
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------
// The desk's paced send meets a blip before anything went
// ---------------------------------------------------------------------------

describe("chaos2 r5: followup.send_due when HighLevel blinks before the message row", () => {
  const BOSS = "boss-c2r5@stress.invalid";
  function seedOpener(): { id: string; wave: string } {
    const id = crypto.randomUUID();
    const wave = crypto.randomUUID();
    db.t("cockpit_sales_settings").find(r => r.key === "whatsapp_guard")!.value = {
      templates_per_day: 250,
      template_budget_usd_month: 100,
      connector_off: true,
      single_copy_ok_at: "2026-10-01T00:00:00Z",
    };
    db.seed("cockpit_sales_settings", [{ key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } }]);
    db.seed("cockpit_sales_wa_templates", [
      { key: "opener_en", name: "cockpit_opener_en", language: "en", preview: "Hi {{1}}, it's {{2}} from Mahara Media. How are things going?", variables: ["first_name", "rep_name"], workflow_id: "wf-opener-en", active: true },
    ]);
    db.seed("cockpit_sales_followup_waves", [{ id: wave, pool: "never_booked", state: "running", per_day: 40, made_by: BOSS }]);
    db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: LEAD,
        segment: "reactivate",
        touch: 1,
        channel: "whatsapp_template",
        template_key: "opener_en",
        body: "Hi Huda, it's Rafi from Mahara Media. How are things going?",
        status: "draft",
        owner_email: REP,
        context: { wave_id: wave, language: "en", pool: "never_booked", arm: "wave" },
        created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
    ]);
    db.seed("cockpit_sales_followup_meta", [
      { followup_id: id, wave_id: wave, kind_key: "reactivate.en.whatsapp_template", send_after: new Date(Date.now() - 60_000).toISOString(), approved_by: BOSS, held_by: null },
    ]);
    return { id, wave };
  }

  test("not-sent-yet-sets-opener-aside: HighLevel's contact read answers 502 once (nothing went, 'try again in a minute'): the approved opener must wait in the queue for the next run, never be set aside for a person", async () => {
    const { setSystemTime } = await import("bun:test");
    reset();
    // Monday 11:00 in Kuwait: inside the first-message hours, not the day off.
    setSystemTime(new Date("2026-10-05T08:00:00Z"));
    try {
      const { id } = seedOpener();
      contactBlips = 1;
      const out = await desk({ action: "followup.send_due", id });
      // Fix round 5: answered as an outage for this run (hold_all), as the desk's waves read it.
      expect({ status: out.status, code: out.body.code, hold_all: out.body.hold_all }).toEqual({ status: 503, code: "outage", hold_all: true });
      const meta = db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row;
      const f = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
      expect({ draft: f.status, held_by: meta.held_by ?? null, send_after_kept: Boolean(meta.send_after) }).toEqual({
        draft: "draft",
        held_by: null,
        send_after_kept: true,
      });
      // HighLevel answers again: the next run sends it.
      const again = await desk({ action: "followup.send_due", id });
      expect(again.status).toBe(200);
    } finally {
      setSystemTime();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The live count reads the lead's calendar from HighLevel (index.ts upcoming)
// ---------------------------------------------------------------------------

describe("chaos2 r5: the live count's read of the lead's booked calls answers 200 with none in it", () => {
  const waits: Promise<unknown>[] = [];
  async function settle(): Promise<void> {
    for (let i = 0; i < 30 && waits.length; i++) await Promise.allSettled(waits.splice(0));
  }
  const INTRO_CAL = "cal-intro-c2r5";
  const LIVE_CAL = "cal-live-c2r5";
  function seedJoinedRoom(now: number): string {
    const id = crypto.randomUUID();
    const meeting = "85012345678";
    db.seed("cockpit_sales_settings", [
      {
        key: "rooms",
        value: {
          enabled: true,
          test_only: false,
          providers: { zoom: true, meet: true },
          send: { whatsapp_text: false, whatsapp_template: false, email: false },
          short_link: false,
          count_on_join: true,
          live_calendar_id: LIVE_CAL,
        },
      },
      { key: "live", value: { enabled: false } },
      { key: "calendars", value: { [INTRO_CAL]: { type: "intro" } } },
    ]);
    db.t("cockpit_sales_people").find(p => p.email === REP)!.role = "setter";
    db.seed("cockpit_sales_room_hosts", [{ email: REP, zoom_user_id: "Z-rep", zoom_status: "licensed", google_ok: true }]);
    db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: crypto.randomUUID(),
        code: "K7Q2MZ",
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "fallback",
        call_kind: "intro",
        provider: "zoom",
        provider_meeting_id: meeting,
        host_email: REP,
        made_by: REP,
        state: "lead_in",
        version: 4,
        send_on: "open",
        join_url: `https://us06web.zoom.us/j/${meeting}?pwd=stress`,
        requested_at: new Date(now - 6 * 60_000).toISOString(),
        created_at: new Date(now - 6 * 60_000).toISOString(),
        opened_at: new Date(now - 5 * 60_000).toISOString(),
        host_in_at: new Date(now - 4 * 60_000).toISOString(),
        lead_in_at: new Date(now - 90_000).toISOString(),
        lead_in_seen_at: new Date(now - 90_000).toISOString(),
        link_claimed_at: new Date(now - 5 * 60_000).toISOString(),
        link_sent_at: new Date(now - 5 * 60_000).toISOString(),
        link_channels: ["whatsapp_text"],
        link_message_ids: {},
        host_by: new Date(now + 5 * 60_000).toISOString(),
        lead_by: new Date(now + 5 * 60_000).toISOString(),
        ends_at: new Date(now + 40 * 60_000).toISOString(),
      },
    ]);
    // Zoom's join of someone outside the team on the room's own meeting: the lead's own evidence.
    const at = new Date(now - 90_000).toISOString();
    db.seed("cockpit_sales_room_events", [
      {
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: `zoom:meeting.participant_joined:${meeting}:lead:${at}:${id}`,
        at,
        handled_at: at,
        text: "Zoom: the lead joined.",
        detail: { event: "meeting.participant_joined", role: "lead", payload: { object: { id: meeting, participant: { user_name: "Huda Ali", join_time: at } } } },
      },
    ]);
    // The lead's intro, booked for tomorrow with this setter (a dialer room today, before it).
    calendarCalls = [
      {
        id: "intro-tomorrow-c2r5",
        calendarId: INTRO_CAL,
        contactId: LEAD,
        startTime: new Date(now + 24 * 3_600_000).toISOString(),
        endTime: new Date(now + 24 * 3_600_000 + 30 * 60_000).toISOString(),
        appointmentStatus: "confirmed",
        assignedUserId: "G-rep",
        dateAdded: new Date(now - 2 * 86_400_000).toISOString(),
      },
    ];
    return id;
  }
  async function runTick(id: string, t0: number): Promise<void> {
    const { setSystemTime } = await import("bun:test");
    setSystemTime(new Date(t0));
    expect((await desk({ action: "room.event", kind: "tick", payload: { room_ids: [id] } })).status).toBe(200);
    await settle();
  }
  const booked = () => ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  const moved = () => ghlCalls.filter(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-tomorrow-c2r5");

  for (const shape of ["calls", "empty", "page"] as const) {
    test(`${shape === "calls" ? "HELD: HighLevel answers the lead's calls" : `upcoming-garbage-read-as-nothing-booked (${shape})`}: the lead with an intro booked tomorrow joins a dialer room: their intro is moved to the join, never a Live call booked beside it`, async () => {
      const { setSystemTime } = await import("bun:test");
      (globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waits.push(p) };
      reset();
      const t0 = Date.parse("2026-10-05T08:00:00Z");
      try {
        setSystemTime(new Date(t0));
        const id = seedJoinedRoom(t0);
        calendarAnswer = shape;
        await runTick(id, t0);
        const room = db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
        const say = { live_bookings: booked().length, intro_moved: moved().length > 0, count_result: room.count_result ?? null };
        if (shape === "calls") expect(say).toEqual({ live_bookings: 0, intro_moved: true, count_result: "moved" });
        // Unreadable is never "nothing booked": no Live call beside the lead's intro (the count waits, or a person is told).
        else expect(say.live_bookings).toBe(0);
      } finally {
        setSystemTime();
        delete (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime;
      }
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------
// A follow-up's "sent" write lands and its answer is lost
// ---------------------------------------------------------------------------

describe("chaos2 r5: the follow-up's sent write lands and its answer is lost", () => {
  for (const lost of [false, true]) {
    test(`${lost ? "followup-sent-write-lost-skips-takeover" : "HELD: the database answers"}: the reply went by email: the lead leaves the old HighLevel automation it replaces${lost ? ", whatever became of the write's answer" : ""}`, async () => {
      reset();
      db.t("cockpit_sales_settings").find(r => r.key === "followups")!.value = { enabled: true, takeover: { reply: true }, replaces: { reply: ["wf-old-reply"] } };
      const id = seedReplyDraft();
      sentWriteLost = lost ? 1 : 0;
      const out = await call({ action: "followup.approve", id });
      const f = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
      const takenOut = ghlCalls.filter(c => c.method === "DELETE" && c.path.includes("/workflow/wf-old-reply")).length;
      expect(sentToLead()).toBe(1);
      expect({ draft: f.status, lead_taken_out_of_old_automation: takenOut }).toEqual({ draft: "sent", lead_taken_out_of_old_automation: 1 });
      if (lost) {
        // And the rep is not told it failed: the reply went.
        expect({ status: out.status, said: out.body.error ?? null }).toEqual({ status: 200, said: null });
      }
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------
// index.ts svc reads an empty 200 as "no rows" (liveio and the door do not)
// ---------------------------------------------------------------------------

describe("chaos2 r5: a template send whose queued-templates read answers 200 with an empty body", () => {
  function seedTemplate(): void {
    db.t("cockpit_sales_settings").find(r => r.key === "whatsapp_guard")!.value = {
      templates_per_day: 250,
      template_budget_usd_month: 100,
      connector_off: true,
      single_copy_ok_at: "2026-10-01T00:00:00Z",
    };
    db.seed("cockpit_sales_settings", [{ key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } }]);
    db.seed("cockpit_sales_wa_templates", [
      { key: "line_en", name: "cockpit_line_en", language: "en", preview: "Hi {{1}}, {{2}} - {{3}}", variables: ["first_name", "line", "rep_name"], workflow_id: "wf-line-en", active: true },
    ]);
    // The first template, three minutes ago: HighLevel took the enrolment and nobody has seen it go yet
    // (its delayed workflow reads the contact's line field when it runs).
    db.seed("cockpit_sales_messages", [
      {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        channel: "whatsapp",
        via: "workflow",
        template_key: "line_en",
        workflow_id: "wf-line-en",
        body: "Hi Huda, your call is at 3 pm today - Rafi",
        source: "rep",
        sent_by: REP,
        state: "sent",
        provider_status: "enrolled",
        created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
      },
    ]);
  }
  const send = (line: string) => call({ action: "wa.template.send", contact_id: LEAD, template_key: "line_en", line, request_id: crypto.randomUUID() });
  const enrolments = () => ghlCalls.filter(c => c.method === "POST" && c.path.includes("/workflow/")).length;

  for (const empty of [false, true]) {
    test(`${empty ? "svc-empty-200-read-as-no-rows" : "HELD: the database answers"}: a second template while the first is still in HighLevel's queue is refused (the queued one would send the new words)`, async () => {
      reset();
      seedTemplate();
      if (empty) emptyReads.push(`cockpit_sales_messages?contact_id=eq.${LEAD}&via=eq.workflow&state=in.(sent,unclear,sending)`);
      const out = await send("the room is ready, join now");
      expect({ status: out.status, code: out.body.code ?? null, enrolments: enrolments() }).toEqual({ status: 409, code: "template_waiting", enrolments: 0 });
    }, 60_000);
  }
});
