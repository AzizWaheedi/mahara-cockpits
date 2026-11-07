// bun test --timeout 30000 supabase/functions/sales-api/held_now_router.test.ts
//
// "Did the intro now" on a confirmation call (the CEO, 2026-11-07: "If he
// gets them on the phone, he should be able to book them for the demo then
// and there if he confirms"). The dialer's confirm item saves showed with
// held_now; sales-api marks the intro held before its booked time, in
// HighLevel too, and the page opens the held step with Book the demo.
//
// End to end through the real handler (index.ts, Deno.serve's function), as
// setter_queue_router.test.ts does: PostgREST is testfakes.ts FakeDb behind
// the same URLs, the seat check answers a setter, HighLevel answers {} and is
// recorded. Synthetic names only; nothing leaves this process.
//
// Pinned here: without held_now every save is as before, the "mark" action
// (the lead page's Calls card) is untouched, and every refusal is one plain
// sentence said before anything is saved.
//
// Fix pass 2 (2026-11-07): with no dialer call for the confirmation (the
// setter calls from the Maqsam softphone and saves by hand), dial.save asks
// Maqsam's GET /v3/calls, faked here behind the same URL, whether the seat
// had a call of 3 minutes or more with this lead in the last two hours,
// since the intro was booked (dialer.ts softphoneHeld). The review of that
// pass: the read sends end_time, stops at a short page, has a deadline, and
// takes an answer with no list as "could not be read".
import { beforeAll, describe, expect, test } from "bun:test";
import {
  HELD_NOW_AHEAD,
  HELD_NOW_CALL_AGE,
  HELD_NOW_LINES,
  HELD_NOW_LIVE_MAX,
  HELD_NOW_MIN_CALL,
  heldNowCheck,
  MARK_GRACE,
  type MaqsamCall,
  softphoneHeld,
} from "./dialer.ts";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.heldnow.invalid";
const GHL = "https://services.leadconnectorhq.com";
const MQ = "https://api.mq.maqsam.com";
const SETTER = "setter-h@heldnow.invalid";
/** The seat's Maqsam address as the seat check answers it (null: the seat has none). */
const seat: { maqsam_email: string | null } = { maqsam_email: SETTER };
/**
 * What Maqsam's GET /v3/calls answers: the seat's calls on page 1 (or a page
 * each), a failure status, an answer whose message is not a list, or a
 * request that runs out of time.
 */
let maqsamAnswer: { status?: number; calls?: Row[]; pages?: Row[][]; message?: unknown; timeout?: boolean } = { calls: [] };
/** Every request that reached Maqsam, for "was Maqsam asked at all". */
const maqsamAsks: string[] = [];
/** Whether each Maqsam request carried a deadline (an AbortSignal). */
const maqsamSignals: boolean[] = [];
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; url: string; body: unknown }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({
      signed_in: true,
      seat: true,
      manager: false,
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      maqsam_email: seat.maqsam_email,
    });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    // The fake does not parse or= filters; every world here has one lead per question.
    const path = url.slice(`${DB}/rest/v1/`.length).replace(/&or=[^&]*/, "");
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
    ghlCalls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    return reply({});
  }
  if (url.startsWith(`${MQ}/v3/calls`) && method === "GET") {
    maqsamAsks.push(url);
    maqsamSignals.push(init.signal instanceof AbortSignal);
    if (maqsamAnswer.timeout) throw new DOMException("The operation timed out.", "TimeoutError");
    if (maqsamAnswer.status) return reply({ result: "failure", message: "Maqsam is down" }, maqsamAnswer.status);
    if ("message" in maqsamAnswer) return reply({ result: "success", message: maqsamAnswer.message });
    // Newest page first; one page holds every call here, unless pages are given.
    const page = Number(new URL(url).searchParams.get("page"));
    if (maqsamAnswer.pages) return reply({ result: "success", message: maqsamAnswer.pages[page - 1] ?? [] });
    return reply({ result: "success", message: page === 1 ? (maqsamAnswer.calls ?? []) : [] });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

const env: Record<string, string> = {
  SUPABASE_URL: DB,
  SUPABASE_SERVICE_ROLE_KEY: "service-heldnow",
  SUPABASE_ANON_KEY: "anon-heldnow",
  SALES_GHL_TOKEN: "ghl-heldnow",
  SALES_MAQSAM_ACCESS_KEY: "mq-key-heldnow",
  SALES_MAQSAM_SECRET: "mq-secret-heldnow",
};

beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

// index.ts keeps its heavy reads for 20 s: each world starts two minutes
// after the last, so no test reads the one before's rows.
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

async function call(action: string, body: Row = {}): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler (run this file on its own)");
  const res = await handler(
    new Request("https://fn.heldnow.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const ATTEMPT = "00000000-0000-4000-8000-0000000000c1";
const EARLY = "This call has not happened yet. Mark it once its time has passed, or mark it cancelled.";
const ELSEWHERE = "Do the intro from the dialer's call with them. A call made elsewhere is marked at the intro's time.";
const NOT_CONNECTED =
  "Maqsam's record says this call did not connect, so the intro cannot be marked held from it. Save No answer, and mark the intro at its time.";
const GONE = "This call is no longer open, so the intro cannot be marked held from it. Save Confirmed, and mark the intro at its time.";
const NO_TALK =
  "Maqsam's record shows no talk time on this call, so the intro cannot be marked held from it. If you did talk, press Save again in a minute, once the record is complete.";
const SHORT =
  "Under 3 minutes on this call is too short for the intro. Do the intro, then press Did the intro now, or save Confirmed and mark the intro at its time.";
const NO_SEAT =
  "Your seat has no Maqsam address, so this call cannot be checked. Save Confirmed, and mark the intro at its time.";
const NO_PHONE =
  "This lead has no phone number in the cockpit, so this call cannot be checked. Save Confirmed, and mark the intro at its time.";
const UNREAD = "Maqsam could not be read just now, so this call cannot be checked. Try again in a minute.";
const NO_CALL =
  "Maqsam shows no call between your seat and this lead in the last two hours. Do the intro on a call with them, then press Did the intro now.";
const LEAD_PHONE = "+96550004321";

/**
 * A fresh world: the setter's seat, marks written to HighLevel, one lead
 * ("c") with an intro `startIn` from now hosted by the setter, and, unless
 * `attempt` is null, the dialer's open call for its confirm item.
 */
function world(
  o: {
    startIn?: number;
    type?: "intro" | "demo";
    host?: string;
    attempt?: Row | null;
    phone?: string | null;
    /** How long ago the intro was booked (default a day). */
    bookedAgo?: number;
  } = {},
) {
  db.tables = {};
  db.faults = [];
  ghlCalls.length = 0;
  maqsamAsks.length = 0;
  maqsamSignals.length = 0;
  maqsamAnswer = { calls: [] };
  seat.maqsam_email = SETTER;
  env.SALES_MAQSAM_ACCESS_KEY = "mq-key-heldnow";
  offset += 2 * MIN;
  const now = Date.now();
  db.seed("cockpit_sales_settings", [
    { key: "pipeline", value: { auto_moves: true, id: "p-sales", roles: { "s-new": "new", "s-long": "nurture_long" } } },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", name_ar: "تارا", role: "setter", ghl_user_id: "G-setter", active: true, via_portal: true },
    { email: "closer-h@heldnow.invalid", name: "Cole Closer", role: "closer", ghl_user_id: "G-closer", active: true, via_portal: true },
  ]);
  db.seed("cockpit_sales_leads", [
    {
      contact_id: "c",
      name: "Casey Lead",
      phone: o.phone === undefined ? LEAD_PHONE : o.phone,
      phone8: o.phone === undefined ? "50004321" : null,
      lead_created_at: iso(now - 3 * DAY),
      stage_id: "s-new",
      stage_name: "Intro Call REQUESTED",
      pipeline_id: "p-sales",
      lead_class: "qualified",
      dnd: false,
      contact_type: "lead",
      assigned_to: null,
      tags: ["roas-qualified"],
      country: "KW",
    },
  ]);
  const appt = {
    appointment_id: "a-c",
    contact_id: "c",
    call_type: o.type ?? "intro",
    start_at: iso(now + (o.startIn ?? 150 * MIN)),
    booked_at: iso(now - (o.bookedAgo ?? DAY)),
    status: "confirmed",
    assigned_user_id: o.host ?? "G-setter",
  };
  db.seed("cockpit_sales_appointments", [appt]);
  db.seed("cockpit_sales_calendar", [{ ...appt }]);
  if (o.attempt !== null)
    db.seed("cockpit_sales_attempts", [
      {
        id: ATTEMPT,
        contact_id: "c",
        rep_email: SETTER,
        maqsam_email: SETTER,
        phone: "96550004321",
        state: "placed",
        manual: false,
        item_kind: "confirm",
        appointment_id: "a-c",
        // The intro has been going five minutes: long enough (HELD_NOW_MIN_CALL).
        started_at: iso(now - 5 * MIN),
        call_checked_at: iso(now - 10_000),
        call_state: null,
        ...o.attempt,
      },
    ]);
  return appt;
}

const held = (over: Row = {}) => ({
  attempt_id: ATTEMPT,
  outcome: "showed",
  note: "Had the intro on the call, booking the demo now",
  item_kind: "confirm",
  appointment_id: "a-c",
  as: "setter",
  held_now: true,
  ...over,
});

const marks = () => (db.tables.cockpit_sales_dispositions ?? []).filter(d => !d.superseded_at);
const attemptRow = () => (db.tables.cockpit_sales_attempts ?? []).find(a => a.id === ATTEMPT) ?? null;
const audits = (action: string) => (db.tables.cockpit_audit_log ?? []).filter(a => a.action === action);
const markPuts = () => ghlCalls.filter(c => c.method === "PUT" && /\/calendars\/events\/appointments\/a-c$/.test(c.url));

/** Nothing was written: no mark, the call still open, no confirmation, nothing to HighLevel. */
function nothingSaved() {
  expect(marks()).toHaveLength(0);
  expect(attemptRow()?.state).toBe("placed");
  expect(db.tables.cockpit_sales_confirmations ?? []).toHaveLength(0);
  expect(markPuts()).toHaveLength(0);
}

/** A save by hand that was refused: no attempt row at all, no mark, no confirmation, nothing to HighLevel. */
function nothingSavedByHand() {
  expect(db.tables.cockpit_sales_attempts ?? []).toHaveLength(0);
  expect(marks()).toHaveLength(0);
  expect(db.tables.cockpit_sales_confirmations ?? []).toHaveLength(0);
  expect(markPuts()).toHaveLength(0);
}

/** The setter's softphone call with the lead as Maqsam lists it: outbound, answered, 4 minutes of talk, placed 6 minutes ago. */
const mqCall = (o: Row = {}): Row => ({
  id: "mq-1",
  referenceId: "77001",
  type: "outbound",
  direction: "outbound",
  state: "completed",
  duration: 240,
  timestamp: Math.floor((Date.now() - 6 * MIN) / 1000),
  callerNumber: "96522060000",
  calleeNumber: "96550004321",
  caller: "+96522060000",
  callee: "+96550004321",
  agents: [{ email: SETTER, identifier: "7", name: "Tara Setter" }],
  ...o,
});

/** A Did the intro now saved by hand (no dialer call): the softphone path. */
const byHand = (id: string, over: Row = {}) =>
  held({ attempt_id: undefined, contact_id: "c", request_id: `00000000-0000-4000-8000-0000000000${id}`, ...over });

// ---------------------------------------------------------------------------
// The rule, on its own (dialer.ts heldNowCheck)
// ---------------------------------------------------------------------------

describe("heldNowCheck: when a confirmation call may mark its intro held now", () => {
  const now = Date.parse("2026-11-08T09:00:00Z");
  const attempt = {
    manual: false,
    item_kind: "confirm",
    appointment_id: "a1",
    state: "placed",
    call_state: null,
    started_at: iso(now - 5 * MIN),
  };
  const intro = (aheadMs: number) => ({ call_type: "intro", start_at: iso(now + aheadMs) });
  const base = { asked: true, kind: "confirm" as const, outcome: "showed", attempt, appointmentId: "a1", appt: intro(150 * MIN), now };

  test("the dialer's own call, an intro 2.5 hours ahead, Maqsam with nothing against it: held now", () => {
    expect(heldNowCheck(base)).toEqual({ heldNow: true, refusal: null });
    // Talking (Maqsam has no final record yet), answered with ten minutes of
    // talk, or a call Maqsam could not confirm (it may still ring).
    for (const call_state of ["completed", "serviced"])
      expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state, call_duration_s: 600 } }).heldNow).toBe(true);
    for (const call_state of ["uncertain", "in_progress"])
      expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state } }).heldNow).toBe(true);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, state: "failed", call_state: "uncertain" } }).heldNow).toBe(true);
    // The refusals say what to do next, and the server's lines are these.
    expect(HELD_NOW_LINES).toMatchObject({ elsewhere: ELSEWHERE, notConnected: NOT_CONNECTED, gone: GONE, noTalk: NO_TALK, short: SHORT });
  });

  test("not asked, not a confirm item's showed, or the intro ten minutes away or started: nothing changes", () => {
    const none = { heldNow: false, refusal: null };
    expect(heldNowCheck({ ...base, asked: false })).toEqual(none);
    expect(heldNowCheck({ ...base, kind: "intro" })).toEqual(none);
    expect(heldNowCheck({ ...base, kind: "lead" })).toEqual(none);
    expect(heldNowCheck({ ...base, outcome: "confirmed" })).toEqual(none);
    expect(heldNowCheck({ ...base, appt: null })).toEqual(none);
    expect(heldNowCheck({ ...base, appt: { call_type: "intro", start_at: null } })).toEqual(none);
    // At the grace (refuseMark already allows it) and after the start, even from a manual save.
    for (const ahead of [MARK_GRACE, 5 * MIN, 0, -30 * MIN])
      expect(heldNowCheck({ ...base, attempt: null, appt: intro(ahead) })).toEqual(none);
    expect(heldNowCheck({ ...base, attempt: null, appt: intro(MARK_GRACE + 1000) }).refusal).toBe(ELSEWHERE);
  });

  test("a call made elsewhere, from another item or for another call: refused", () => {
    expect(heldNowCheck({ ...base, attempt: null }).refusal).toBe(ELSEWHERE);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, manual: true } }).refusal).toBe(ELSEWHERE);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, item_kind: "lead" } }).refusal).toBe(ELSEWHERE);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, appointment_id: "a2" } }).refusal).toBe(ELSEWHERE);
    expect(heldNowCheck({ ...base, appointmentId: null }).refusal).toBe(ELSEWHERE);
  });

  test("no dialer call: the answer says to ask Maqsam (softphone), and only then", () => {
    // Fix pass 2: dial.save reads `softphone` and asks Maqsam instead of refusing.
    for (const a of [null, { ...attempt, manual: true }, { ...attempt, item_kind: "lead" }, { ...attempt, appointment_id: "a2" }])
      expect(heldNowCheck({ ...base, attempt: a })).toEqual({ heldNow: false, refusal: ELSEWHERE, softphone: true });
    // The dialer's own call never goes to the softphone path, refused or not.
    expect(heldNowCheck(base)).not.toHaveProperty("softphone");
    for (const call_state of ["no_answer", "completed"])
      expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state, call_duration_s: 0 } })).not.toHaveProperty("softphone");
    expect(heldNowCheck({ ...base, attempt: { ...attempt, state: "released" } })).not.toHaveProperty("softphone");
  });

  test("the intro's own checks come before the call's: a demo or an intro more than a day away, with no dialer call", () => {
    // Fix pass 2: so the softphone path is asked only for an intro at most a day ahead.
    const demo = { call_type: "demo", start_at: iso(now + HOUR) };
    expect(heldNowCheck({ ...base, attempt: null, appt: demo })).toEqual({ heldNow: false, refusal: HELD_NOW_LINES.demo });
    expect(heldNowCheck({ ...base, attempt: { ...attempt, manual: true }, appt: demo }).refusal).toBe(HELD_NOW_LINES.demo);
    expect(heldNowCheck({ ...base, attempt: null, appt: intro(HELD_NOW_AHEAD + MIN) })).toEqual({
      heldNow: false,
      refusal: HELD_NOW_LINES.far,
    });
    expect(heldNowCheck({ ...base, attempt: null, appt: intro(HELD_NOW_AHEAD) }).softphone).toBe(true);
    // Ten minutes away or less, nothing changes, demo or not.
    expect(heldNowCheck({ ...base, attempt: null, appt: { call_type: "demo", start_at: iso(now + 5 * MIN) } })).toEqual({
      heldNow: false,
      refusal: null,
    });
  });

  test("a demo, an intro more than a day away, a call that did not connect: refused", () => {
    expect(heldNowCheck({ ...base, appt: { call_type: "demo", start_at: iso(now + HOUR) } }).refusal).toBe(
      "Only an intro can be marked held on its confirmation call. Mark a demo at its time.",
    );
    expect(heldNowCheck({ ...base, appt: intro(HELD_NOW_AHEAD) }).heldNow).toBe(true);
    expect(heldNowCheck({ ...base, appt: intro(HELD_NOW_AHEAD + MIN) }).refusal).toMatch(/^This intro is more than a day away/);
    for (const call_state of ["no_answer", "no-answer", "unanswered", "busy", "failed", "blocked", "abandoned", "BUSY"])
      expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state } }).refusal).toBe(NOT_CONNECTED);
    // Maqsam refused to place it (failed, not uncertain).
    expect(heldNowCheck({ ...base, attempt: { ...attempt, state: "failed", call_state: null } }).refusal).toBe(NOT_CONNECTED);
  });

  test("a call too short for the intro: a zero-second answer, a minute of talk, or placed moments ago", () => {
    // Connected with no talk time (the dialer's "Connected, no talk time"): said apart.
    expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state: "completed", call_duration_s: 0 } }).refusal).toBe(NO_TALK);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state: "serviced" } }).refusal).toBe(NO_TALK);
    // A one-minute "see you at 2:30", hung up before the save.
    expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state: "completed", call_duration_s: 60 } }).refusal).toBe(SHORT);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state: "serviced", call_duration_s: 179 } }).refusal).toBe(SHORT);
    // Exactly three minutes of talk is enough.
    const talk = HELD_NOW_MIN_CALL / 1000;
    expect(heldNowCheck({ ...base, attempt: { ...attempt, call_state: "completed", call_duration_s: talk } }).heldNow).toBe(true);
    // Rang once, saved before Maqsam's record came: twenty seconds since it was placed.
    expect(heldNowCheck({ ...base, attempt: { ...attempt, started_at: iso(now - 20_000) } }).refusal).toBe(SHORT);
    expect(heldNowCheck({ ...base, attempt: { ...attempt, started_at: iso(now - HELD_NOW_MIN_CALL) } }).heldNow).toBe(true);
    // A call whose start is not known is never taken as long enough.
    expect(heldNowCheck({ ...base, attempt: { ...attempt, started_at: null } }).refusal).toBe(SHORT);
  });

  test("a call that is no longer the open one: let go when its page closed, or placed hours ago", () => {
    // Yesterday evening's confirmation call, let go, saved the next morning.
    expect(
      heldNowCheck({ ...base, attempt: { ...attempt, state: "released", started_at: iso(now - 20 * HOUR) } }).refusal,
    ).toBe(GONE);
    // Let go a moment ago: still not the open call.
    expect(heldNowCheck({ ...base, attempt: { ...attempt, state: "released" } }).refusal).toBe(GONE);
    // Placed more than two hours ago, even with a long answered record.
    const old = { ...attempt, started_at: iso(now - HELD_NOW_CALL_AGE - MIN), call_state: "completed", call_duration_s: 900 };
    expect(heldNowCheck({ ...base, attempt: old }).refusal).toBe(GONE);
    expect(heldNowCheck({ ...base, attempt: { ...old, started_at: iso(now - HELD_NOW_CALL_AGE + MIN) } }).heldNow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Through the handler
// ---------------------------------------------------------------------------

describe("dial.save with held_now: the intro marked held on the confirmation call, 2.5 hours early", () => {
  test("marked showed and written to HighLevel with its automations; saved as showed and confirmed; the hot list offered; audited", async () => {
    world();
    const out = await call("dial.save", held());
    expect(out.status).toBe(200);
    expect(out.body.attempt).toMatchObject({ id: ATTEMPT, state: "saved", outcome: "showed", item_kind: "confirm", appointment_id: "a-c" });
    expect(out.body.hot_offer).toMatchObject({ action: "dial.hot" });
    // The one current mark: showed, by the setter, written with HighLevel's
    // automations (not quiet). The fake's ids are not numbers, so the row's
    // own crm column stays pending; the mark's answer carries it.
    expect(marks()).toHaveLength(1);
    expect(marks()[0]).toMatchObject({ appointment_id: "a-c", status: "showed", marked_by: SETTER });
    expect(audits("mark")[0]?.after).toMatchObject({ status: "showed", crm: "written" });
    expect(markPuts()).toHaveLength(1);
    expect(markPuts()[0]?.body).toEqual({ appointmentStatus: "showed", toNotify: true });
    // It was confirmed by being had.
    expect(db.tables.cockpit_sales_confirmations ?? []).toHaveLength(1);
    expect((db.tables.cockpit_sales_confirmations ?? [])[0]).toMatchObject({ appointment_id: "a-c", result: "confirmed", via: "call" });
    // The early mark is flagged in the audit, for the manager's view.
    expect(audits("mark")).toHaveLength(1);
    expect(audits("mark")[0]?.metadata).toMatchObject({ held_now: true });
    expect(audits("mark")[0]?.metadata).not.toHaveProperty("quiet");
    expect(audits("dial.save")[0]?.metadata).toMatchObject({ kind: "confirm", mark: "showed", held_now: true });
    // Had on the dialer's own call: said so, and Maqsam was not asked again.
    expect(audits("dial.save")[0]?.metadata).toMatchObject({ held_now_via: "dialer" });
    expect(audits("dial.save")[0]?.metadata).not.toHaveProperty("maqsam_call_id");
    expect(maqsamAsks).toHaveLength(0);
  });

  test("saving it again is the same save", async () => {
    world();
    expect((await call("dial.save", held())).status).toBe(200);
    const again = await call("dial.save", held());
    expect(again.status).toBe(200);
    expect(again.body.repeated).toBe(true);
    expect(marks()).toHaveLength(1);
    expect(markPuts()).toHaveLength(1);
  });

  test("an intro the evening before (20 hours ahead) may be marked; one more than a day ahead may not", async () => {
    world({ startIn: 20 * HOUR });
    expect((await call("dial.save", held())).status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
    world({ startIn: DAY + 30 * MIN });
    const far = await call("dial.save", held());
    expect(far.status).toBe(403);
    expect(String(far.body.error)).toMatch(/^This intro is more than a day away/);
    nothingSaved();
  });

  test("after the mark, the confirmation and the intro's own minute do not come up, nor the call to mark", async () => {
    const appt = world({ startIn: 2 * HOUR });
    const before = await call("dial.queue", { as: "setter", limit: 25 });
    const mine = (b: Row) => ((b.queue as Row[]) ?? []).find(i => i.contact_id === "c") ?? null;
    expect(mine(before.body)?.code).toBe("confirm");
    expect((await call("dial.save", held())).status).toBe(200);
    // The calendar view reads the cockpit's mark first (coalesce(d.status,
    // a.status)); the fake has no views, so its row is set as the view reads.
    const row = (db.tables.cockpit_sales_calendar ?? []).find(r => r.appointment_id === "a-c") as Row;
    row.status = "showed";
    offset += 30 * MIN;
    expect(String(mine((await call("dial.queue", { as: "setter", limit: 25 })).body)?.code ?? "none")).not.toMatch(/^confirm/);
    // Two minutes before the start: no "Intro call now".
    offset = offset + (Date.parse(String(appt.start_at)) - Date.now()) - 2 * MIN;
    expect(mine((await call("dial.queue", { as: "setter", limit: 25 })).body)?.code ?? "none").not.toBe("intro_now");
    // Twenty-five minutes after: no "Mark the intro".
    offset += 27 * MIN;
    expect(mine((await call("dial.queue", { as: "setter", limit: 25 })).body)?.code ?? "none").not.toBe("mark_call");
  });
});

describe("without held_now, or where it does not fit, everything is as before", () => {
  test("the same save without held_now is refused by the early-mark rule, and nothing is saved", async () => {
    world();
    const { held_now: _, ...plain } = held();
    const out = await call("dial.save", plain);
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(EARLY);
    nothingSaved();
    expect(maqsamAsks).toHaveLength(0);
  });

  test("a save by hand without held_now never asks Maqsam, with a long softphone call on it or not", async () => {
    world({ attempt: null });
    maqsamAnswer = { calls: [mqCall()] };
    const { held_now: _, ...plain } = byHand("e1");
    const out = await call("dial.save", plain);
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(EARLY);
    nothingSavedByHand();
    expect(maqsamAsks).toHaveLength(0);
    // Confirmed by hand: saved as before.
    const confirmed = await call("dial.save", { ...plain, outcome: "confirmed", request_id: "00000000-0000-4000-8000-0000000000e2" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.attempt).toMatchObject({ outcome: "confirmed", manual: true });
    expect(marks()).toHaveLength(0);
    expect(maqsamAsks).toHaveLength(0);
  });

  test("the mark action (the lead page's Calls card) is still refused 2.5 hours early, held_now or not", async () => {
    world();
    for (const body of [
      { appointment_id: "a-c", status: "showed" },
      { appointment_id: "a-c", status: "showed", held_now: true },
    ]) {
      const out = await call("mark", body);
      expect(out.status).toBe(403);
      expect(out.body.error).toBe(EARLY);
    }
    nothingSaved();
  });

  test("held_now on the intro's own item or a lead item changes nothing", async () => {
    world({ attempt: { item_kind: "intro" } });
    const intro = await call("dial.save", held({ item_kind: "intro" }));
    expect(intro.status).toBe(403);
    expect(intro.body.error).toBe(EARLY);
    nothingSaved();
    world({ attempt: { item_kind: "lead", appointment_id: null } });
    const lead = await call("dial.save", held({ outcome: "callback", item_kind: "lead", appointment_id: null, callback_at: iso(Date.now() + DAY) }));
    expect(lead.status).toBe(200);
    expect(lead.body.attempt).toMatchObject({ outcome: "callback", item_kind: "lead" });
    expect(marks()).toHaveLength(0);
  });

  test("ten minutes before the intro or less, a manual save with held_now goes as it does today", async () => {
    world({ startIn: 8 * MIN, attempt: null });
    const out = await call("dial.save", held({ attempt_id: undefined, contact_id: "c", request_id: "00000000-0000-4000-8000-0000000000d1" }));
    expect(out.status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
    expect(audits("mark")[0]?.metadata).not.toHaveProperty("held_now");
  });

  test("a lead who joined the video room before the page knew: a save that sent held_now passes on the join, as without it", async () => {
    world({ attempt: null });
    const now = Date.now();
    db.seed("cockpit_sales_rooms", [
      { id: "r-c", contact_id: "c", appointment_id: null, asked_appointment_id: "a-c", state: "lead_in", lead_in_at: iso(now - 4 * MIN) },
    ]);
    // A manual save with held_now alone is refused (ELSEWHERE); the join lets it through.
    const out = await call("dial.save", held({ attempt_id: undefined, contact_id: "c", request_id: "00000000-0000-4000-8000-0000000000d4" }));
    expect(out.status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
    expect(audits("mark")[0]?.metadata).not.toHaveProperty("held_now");
    expect(audits("dial.save_manual")).toHaveLength(1);
    expect(audits("dial.save_manual")[0]?.metadata).not.toHaveProperty("held_now");
  });

  test("a lead who joined the confirmation call's video room: the save without held_now passes as today", async () => {
    world({ attempt: null });
    const now = Date.now();
    // The confirmation call's room (no appointment of its own), the lead in it now.
    db.seed("cockpit_sales_rooms", [
      { id: "r-c", contact_id: "c", appointment_id: null, asked_appointment_id: "a-c", state: "lead_in", lead_in_at: iso(now - 4 * MIN) },
    ]);
    const { held_now: _, attempt_id: __, ...plain } = held();
    const out = await call("dial.save", { ...plain, contact_id: "c", request_id: "00000000-0000-4000-8000-0000000000d2" });
    expect(out.status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
    expect(audits("mark")[0]?.metadata).not.toHaveProperty("held_now");
  });
});

describe("held_now refused: one plain sentence, before anything is saved", () => {
  test("a save with no call through the dialer, and no softphone call with the lead on Maqsam", async () => {
    world({ attempt: null });
    const out = await call("dial.save", byHand("d3"));
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(NO_CALL);
    nothingSavedByHand();
    expect(maqsamAsks).toHaveLength(1);
  });

  test("the dialer's call placed from another item, or for another call: Maqsam is asked, and has no call with them", async () => {
    world({ attempt: { item_kind: "lead", appointment_id: null } });
    const lead = await call("dial.save", held());
    expect(lead.status).toBe(403);
    expect(lead.body.error).toBe(NO_CALL);
    nothingSaved();
    world({ attempt: { appointment_id: "a-other" } });
    const other = await call("dial.save", held());
    expect(other.status).toBe(403);
    expect(other.body.error).toBe(NO_CALL);
    nothingSaved();
    expect(maqsamAsks).toHaveLength(1);
  });

  test("Maqsam's record says no answer, busy or failed; or Maqsam refused to place the call", async () => {
    for (const attempt of [
      { call_state: "no_answer", call_duration_s: 4 },
      { call_state: "busy" },
      { call_state: "failed" },
      { call_state: "abandoned" },
    ]) {
      world({ attempt });
      const out = await call("dial.save", held());
      expect(out.status).toBe(403);
      expect(out.body.error).toBe(NOT_CONNECTED);
      nothingSaved();
    }
    world({ attempt: { state: "failed", error: "Maqsam did not accept the call", call_state: null } });
    const refused = await call("dial.save", held());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(NOT_CONNECTED);
    expect(marks()).toHaveLength(0);
    expect(attemptRow()?.state).toBe("failed");
  });

  test("a call too short for the intro: a zero-second answer, or rung once and saved at once", async () => {
    // Maqsam's record: connected, no talk time.
    world({ attempt: { call_state: "completed", call_duration_s: 0 } });
    const zero = await call("dial.save", held());
    expect(zero.status).toBe(403);
    expect(zero.body.error).toBe(NO_TALK);
    nothingSaved();
    // Placed twenty seconds ago, no record yet.
    world({ attempt: { started_at: iso(Date.now() - 20_000) } });
    const ring = await call("dial.save", held());
    expect(ring.status).toBe(403);
    expect(ring.body.error).toBe(SHORT);
    nothingSaved();
    // Ten minutes of talk on Maqsam's record: held now.
    world({ attempt: { call_state: "completed", call_duration_s: 600, started_at: iso(Date.now() - 12 * MIN) } });
    expect((await call("dial.save", held())).status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
  });

  test("yesterday evening's confirmation call, let go when its page closed, saved the next morning", async () => {
    world({ attempt: { state: "released", started_at: iso(Date.now() - 20 * HOUR) } });
    const out = await call("dial.save", held());
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(GONE);
    expect(marks()).toHaveLength(0);
    expect(attemptRow()?.state).toBe("released");
    expect(db.tables.cockpit_sales_confirmations ?? []).toHaveLength(0);
    expect(markPuts()).toHaveLength(0);
  });

  test("a demo's confirmation", async () => {
    world({ type: "demo" });
    const out = await call("dial.save", held());
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("Only an intro can be marked held on its confirmation call. Mark a demo at its time.");
    nothingSaved();
  });

  test("the other refusals of a mark stand: another rep's intro, and a call being moved", async () => {
    world({ host: "G-closer" });
    const theirs = await call("dial.save", held());
    expect(theirs.status).toBe(403);
    expect(theirs.body.error).toBe("This call is booked with another rep. Only they or a manager can mark it.");
    nothingSaved();
    world();
    db.seed("cockpit_sales_reschedules", [
      { id: "m-1", appointment_id: "a-c", state: "moving", created_at: iso(Date.now() - 20_000), released_at: null },
    ]);
    const moving = await call("dial.save", held());
    expect(moving.status).toBe(409);
    expect(moving.body.error).toBe("This call is being rescheduled right now. Mark it in a moment.");
    nothingSaved();
  });
});

// ---------------------------------------------------------------------------
// The softphone rule, on its own (dialer.ts softphoneHeld, fix pass 2)
// ---------------------------------------------------------------------------

describe("softphoneHeld: an intro had on a Maqsam softphone call with the lead", () => {
  const now = Date.parse("2026-11-08T09:00:00Z");
  const sec = (msAgo: number) => Math.floor((now - msAgo) / 1000);
  const PHONE = "+965 5000 4321";
  const mine = [{ email: SETTER, identifier: "7", name: "Tara Setter" }];
  const c = (o: Partial<MaqsamCall> & Row = {}): MaqsamCall =>
    ({
      id: "mq-1",
      type: "outbound",
      direction: "outbound",
      state: "completed",
      duration: 240,
      timestamp: sec(6 * MIN),
      callerNumber: "96522060000",
      calleeNumber: "96550004321",
      caller: "+96522060000",
      callee: "+96550004321",
      agents: mine,
      ...o,
    }) as MaqsamCall;
  const judge = (
    calls: MaqsamCall[],
    over: Partial<{ phone: string; email: string; now: number; bookedAt: number | null }> = {},
  ) => softphoneHeld({ calls, phone: PHONE, email: SETTER, now, ...over });
  const talk = HELD_NOW_MIN_CALL / 1000;

  test("answered with 3 minutes of talk or more: held, with the call it went by", () => {
    expect(judge([c()])).toEqual({ held: true, refusal: null, call: { id: "mq-1", ref: null, state: "completed", seconds: 240 } });
    // Maqsam's reference id (the dial log's key) goes with it when Maqsam gives one.
    expect(judge([c({ referenceId: "77001" })]).call).toEqual({ id: "mq-1", ref: "77001", state: "completed", seconds: 240 });
    expect(judge([c({ duration: talk })]).held).toBe(true);
    expect(judge([c({ state: "serviced", duration: String(talk + 60) })]).held).toBe(true);
    // One second under 3 minutes is too short.
    expect(judge([c({ duration: talk - 1 })])).toMatchObject({ held: false, refusal: SHORT });
    // No phone number leaves it.
    expect(JSON.stringify(judge([c()]))).not.toContain("50004321");
  });

  test("still going (Maqsam says in_progress): held from 3 minutes after it started to an hour, too short before", () => {
    for (const state of ["in_progress", "IN_PROGRESS", "in-progress"])
      expect(judge([c({ state, duration: null, timestamp: sec(HELD_NOW_MIN_CALL) })])).toMatchObject({ held: true });
    expect(judge([c({ state: "in_progress", duration: 0, timestamp: sec(HELD_NOW_MIN_CALL) })]).call).toEqual({
      id: "mq-1",
      ref: null,
      state: "in_progress",
      seconds: 0,
    });
    // Two minutes and fifty-nine seconds since it started.
    expect(judge([c({ state: "in_progress", duration: 0, timestamp: sec(HELD_NOW_MIN_CALL - 1000) })])).toMatchObject({
      held: false,
      refusal: SHORT,
    });
    // An hour since it started still counts; a second more is a record that never finished.
    expect(judge([c({ state: "in_progress", duration: null, timestamp: sec(HELD_NOW_LIVE_MAX) })]).held).toBe(true);
    expect(judge([c({ state: "in_progress", duration: null, timestamp: sec(HELD_NOW_LIVE_MAX + 1000) })])).toMatchObject({
      held: false,
      refusal: NO_TALK,
    });
  });

  test("a state that is not Maqsam's word for a live call, or none: never held, no talk", () => {
    for (const state of ["ringing", "missed", "voicemail", "", undefined])
      expect(judge([c({ state, duration: 0, timestamp: sec(10 * MIN) })])).toMatchObject({ held: false, refusal: NO_TALK });
    // Even with seconds on it: only completed or serviced is an answered call.
    expect(judge([c({ state: "voicemail", duration: 400 })])).toMatchObject({ held: false, refusal: NO_TALK });
  });

  test("a call that started before the intro was booked (the call it was booked on) is no candidate", () => {
    const booking = c({ id: "mq-booking", duration: 300, timestamp: sec(30 * MIN) });
    expect(judge([booking], { bookedAt: now - 20 * MIN })).toEqual({ held: false, refusal: NO_CALL, call: null });
    // A call that started at the booking's second, or after it, counts.
    expect(judge([booking], { bookedAt: now - 30 * MIN }).held).toBe(true);
    const after = c({ id: "mq-after", duration: 400, timestamp: sec(10 * MIN) });
    expect(judge([booking, after], { bookedAt: now - 20 * MIN }).call?.id).toBe("mq-after");
    // A booking time not known (null or not a number): every call in the two hours is a candidate.
    expect(judge([booking], { bookedAt: null }).held).toBe(true);
    expect(judge([booking], { bookedAt: Number.NaN }).held).toBe(true);
  });

  test("Maqsam's start in seconds or in milliseconds reads the same", () => {
    expect(judge([c({ timestamp: now - 6 * MIN })]).held).toBe(true);
    expect(judge([c({ timestamp: String(sec(6 * MIN)) })]).held).toBe(true);
    expect(judge([c({ state: "in_progress", duration: 0, timestamp: now - 2 * MIN })]).refusal).toBe(SHORT);
    expect(judge([c({ state: "in_progress", duration: 0, timestamp: now - 4 * MIN })]).held).toBe(true);
    // A start Maqsam does not give is no candidate.
    expect(judge([c({ timestamp: undefined })]).refusal).toBe(NO_CALL);
    expect(judge([c({ timestamp: "soon" })]).refusal).toBe(NO_CALL);
  });

  test("outbound carries the lead as callee, inbound as caller; with no direction, either", () => {
    // The lead called the setter back on the softphone.
    const inbound = { type: "inbound", direction: "inbound", callerNumber: "96550004321", calleeNumber: "96522060000", caller: "+96550004321", callee: "+96522060000" };
    expect(judge([c(inbound)]).held).toBe(true);
    // The lead's number on the wrong side for the direction is not this lead's call.
    expect(judge([c({ ...inbound, type: "outbound", direction: "outbound" })]).refusal).toBe(NO_CALL);
    expect(judge([c({ type: "inbound", direction: "inbound" })]).refusal).toBe(NO_CALL);
    // `direction` alone, or neither: read as such, or either side.
    expect(judge([c({ ...inbound, type: undefined })]).held).toBe(true);
    expect(judge([c({ ...inbound, type: undefined, direction: undefined })]).held).toBe(true);
    expect(judge([c({ type: undefined, direction: undefined })]).held).toBe(true);
    // Only `callee` / `caller` (no ...Number field): read as a fallback.
    expect(judge([c({ calleeNumber: undefined })]).held).toBe(true);
    expect(judge([c({ ...inbound, callerNumber: null })]).held).toBe(true);
    // The last 8 digits match, whatever the prefix.
    expect(judge([c({ calleeNumber: "0096550004321" })]).held).toBe(true);
    expect(judge([c()], { phone: "50004321" }).held).toBe(true);
  });

  test("another seat's call, or a call with another number: none", () => {
    expect(judge([c({ agents: [{ email: "closer-h@heldnow.invalid" }] })]).refusal).toBe(NO_CALL);
    expect(judge([c({ agents: [] })]).refusal).toBe(NO_CALL);
    expect(judge([c({ agents: undefined })]).refusal).toBe(NO_CALL);
    expect(judge([c({ calleeNumber: "96550009999", callee: "+96550009999" })]).refusal).toBe(NO_CALL);
    // The seat as Maqsam spells it: a plain address, any case.
    expect(judge([c({ agents: [SETTER.toUpperCase()] })]).held).toBe(true);
    expect(judge([c()], { email: ` ${SETTER.toUpperCase()} ` }).held).toBe(true);
    // No seat address, or a lead number too short to match: never a call.
    expect(judge([c()], { email: "" }).refusal).toBe(NO_CALL);
    expect(judge([c({ calleeNumber: "4321", callee: "4321" })], { phone: "4321" }).refusal).toBe(NO_CALL);
    expect(judge([])).toEqual({ held: false, refusal: NO_CALL, call: null });
  });

  test("only the last two hours count, and a start at most a minute ahead", () => {
    expect(judge([c({ timestamp: sec(HELD_NOW_CALL_AGE) })]).held).toBe(true);
    expect(judge([c({ timestamp: sec(HELD_NOW_CALL_AGE + 1000) })]).refusal).toBe(NO_CALL);
    // A clock a little ahead: a candidate, still too short to be the intro.
    expect(judge([c({ state: "in_progress", duration: 0, timestamp: sec(-30_000) })]).refusal).toBe(SHORT);
    expect(judge([c({ state: "in_progress", duration: 0, timestamp: sec(-2 * MIN) })]).refusal).toBe(NO_CALL);
  });

  test("two calls where only the older one was long enough: held, by the older one", () => {
    const older = c({ id: "mq-old", duration: 600, timestamp: sec(40 * MIN) });
    const newer = c({ id: "mq-new", duration: 50, timestamp: sec(5 * MIN) });
    expect(judge([newer, older])).toEqual({
      held: true,
      refusal: null,
      call: { id: "mq-old", ref: null, state: "completed", seconds: 600 },
    });
    expect(judge([older, newer]).call?.id).toBe("mq-old");
    // Another seat's long call does not lend its minutes.
    expect(judge([newer, { ...older, agents: [{ email: "other@heldnow.invalid" }] }]).refusal).toBe(SHORT);
  });

  test("refused in the words for the newest call: did not connect, no talk, too short", () => {
    for (const state of ["no_answer", "no-answer", "unanswered", "busy", "failed", "blocked", "abandoned", "BUSY"])
      expect(judge([c({ state, duration: 0 })])).toMatchObject({ held: false, refusal: NOT_CONNECTED });
    expect(judge([c({ state: "no_answer", duration: 12 })]).refusal).toBe(NOT_CONNECTED);
    expect(judge([c({ state: "completed", duration: 0 })]).refusal).toBe(NO_TALK);
    expect(judge([c({ state: "serviced", duration: null })]).refusal).toBe(NO_TALK);
    expect(judge([c({ duration: 60 })]).refusal).toBe(SHORT);
    // The newest decides: a ring that went unanswered after a one-minute talk.
    const talked = c({ id: "mq-a", duration: 60, timestamp: sec(30 * MIN) });
    const rang = c({ id: "mq-b", state: "no_answer", duration: 0, timestamp: sec(2 * MIN) });
    expect(judge([talked, rang])).toEqual({
      held: false,
      refusal: NOT_CONNECTED,
      call: { id: "mq-b", ref: null, state: "no_answer", seconds: 0 },
    });
    expect(judge([c({ ...rang, timestamp: sec(40 * MIN) }), talked]).refusal).toBe(SHORT);
  });
});

// ---------------------------------------------------------------------------
// The softphone path through the handler (fix pass 2)
// ---------------------------------------------------------------------------

describe("dial.save with held_now and no dialer call: Maqsam's word on the softphone call", () => {
  test("a 4-minute answered softphone call with the lead: marked held, written to HighLevel, audited as the softphone's", async () => {
    world({ attempt: null });
    maqsamAnswer = { calls: [mqCall()] };
    const out = await call("dial.save", byHand("f1"));
    expect(out.status).toBe(200);
    expect(out.body.attempt).toMatchObject({ state: "saved", outcome: "showed", manual: true, item_kind: "confirm", appointment_id: "a-c" });
    expect(out.body.hot_offer).toMatchObject({ action: "dial.hot" });
    expect(marks()).toHaveLength(1);
    expect(marks()[0]).toMatchObject({ appointment_id: "a-c", status: "showed", marked_by: SETTER });
    expect(markPuts()).toHaveLength(1);
    expect(markPuts()[0]?.body).toEqual({ appointmentStatus: "showed", toNotify: true });
    expect((db.tables.cockpit_sales_confirmations ?? [])[0]).toMatchObject({ appointment_id: "a-c", result: "confirmed" });
    expect(audits("mark")[0]?.metadata).toMatchObject({ held_now: true });
    const meta = audits("dial.save_manual")[0]?.metadata as Row;
    expect(meta).toMatchObject({
      kind: "confirm",
      mark: "showed",
      held_now: true,
      held_now_via: "softphone",
      maqsam_call_id: "mq-1",
      maqsam_ref: "77001",
      maqsam_state: "completed",
      maqsam_seconds: 240,
    });
    // No phone number in the audit row.
    expect(JSON.stringify(meta)).not.toContain("50004321");
    // Maqsam was asked once for the seat's calls of the last two hours, up to
    // a minute from now, as the desk's reader asks: a page under a hundred
    // calls is the last, and the request had a deadline.
    expect(maqsamAsks).toHaveLength(1);
    expect(maqsamSignals).toEqual([true]);
    const asked = new URL(String(maqsamAsks[0]));
    expect(asked.searchParams.get("email")).toBe(SETTER);
    const from = Number(asked.searchParams.get("start_time")) * 1000;
    expect(Math.abs(from - (Date.now() - HELD_NOW_CALL_AGE))).toBeLessThan(5_000);
    const to = Number(asked.searchParams.get("end_time")) * 1000;
    expect(Math.abs(to - (Date.now() + MIN))).toBeLessThan(5_000);
  });

  test("a full page of a hundred calls: the next page is read, and the long call on it counts", async () => {
    world({ attempt: null });
    const other = (i: number) =>
      mqCall({ id: `mq-x${i}`, calleeNumber: "96599990000", callee: "+96599990000", duration: 20 });
    maqsamAnswer = { pages: [Array.from({ length: 100 }, (_, i) => other(i)), [mqCall({ id: "mq-p2" })]] };
    const out = await call("dial.save", byHand("fg"));
    expect(out.status).toBe(200);
    expect(maqsamAsks).toHaveLength(2);
    expect(audits("dial.save_manual")[0]?.metadata).toMatchObject({ held_now_via: "softphone", maqsam_call_id: "mq-p2" });
  });

  test("the call the intro was booked on is not the intro: refused, nothing saved", async () => {
    world({ attempt: null, bookedAgo: 20 * MIN });
    maqsamAnswer = { calls: [mqCall({ duration: 300, timestamp: Math.floor((Date.now() - 30 * MIN) / 1000) })] };
    const out = await call("dial.save", byHand("fh"));
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(NO_CALL);
    nothingSavedByHand();
    // A call made after the booking counts.
    world({ attempt: null, bookedAgo: 20 * MIN });
    maqsamAnswer = { calls: [mqCall({ duration: 300, timestamp: Math.floor((Date.now() - 10 * MIN) / 1000) })] };
    expect((await call("dial.save", byHand("fi"))).status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
  });

  test("a call still going for 4 minutes, and one the lead made to the setter: held", async () => {
    world({ attempt: null });
    maqsamAnswer = { calls: [mqCall({ state: "in_progress", duration: 0, timestamp: Math.floor((Date.now() - 4 * MIN) / 1000) })] };
    expect((await call("dial.save", byHand("f2"))).status).toBe(200);
    expect(audits("dial.save_manual")[0]?.metadata).toMatchObject({ held_now_via: "softphone", maqsam_state: "in_progress" });
    world({ attempt: null });
    maqsamAnswer = {
      calls: [mqCall({ type: "inbound", direction: "inbound", callerNumber: "96550004321", calleeNumber: "96522060000", caller: "+96550004321", callee: "+96522060000" })],
    };
    expect((await call("dial.save", byHand("f3"))).status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
  });

  test("the dialer's call for another item, with a long softphone call: held by the softphone's word", async () => {
    world({ attempt: { item_kind: "lead", appointment_id: null } });
    maqsamAnswer = { calls: [mqCall()] };
    const out = await call("dial.save", held());
    expect(out.status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
    expect(audits("dial.save")[0]?.metadata).toMatchObject({ held_now: true, held_now_via: "softphone", maqsam_call_id: "mq-1" });
  });

  test("a softphone call under 3 minutes: too short, nothing saved", async () => {
    world({ attempt: null });
    maqsamAnswer = { calls: [mqCall({ duration: 90 })] };
    const out = await call("dial.save", byHand("f4"));
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(SHORT);
    nothingSavedByHand();
  });

  test("no call with this lead on Maqsam: another seat's, another number's, or none", async () => {
    for (const calls of [[], [mqCall({ agents: [{ email: "closer-h@heldnow.invalid" }] })], [mqCall({ calleeNumber: "96599990000", callee: "+96599990000" })]]) {
      world({ attempt: null });
      maqsamAnswer = { calls };
      const out = await call("dial.save", byHand("f5"));
      expect(out.status).toBe(403);
      expect(out.body.error).toBe(NO_CALL);
      nothingSavedByHand();
    }
  });

  test("a softphone call that did not connect, or connected with no talk", async () => {
    world({ attempt: null });
    maqsamAnswer = { calls: [mqCall({ state: "no_answer", duration: 0 })] };
    expect((await call("dial.save", byHand("f6"))).body.error).toBe(NOT_CONNECTED);
    world({ attempt: null });
    maqsamAnswer = { calls: [mqCall({ state: "completed", duration: 0 })] };
    expect((await call("dial.save", byHand("f7"))).body.error).toBe(NO_TALK);
    nothingSavedByHand();
  });

  test("Maqsam cannot be read (down, slow-down, not connected, no list, out of time): refused, never accepted", async () => {
    for (const status of [500, 429, 401]) {
      world({ attempt: null });
      maqsamAnswer = { status };
      const out = await call("dial.save", byHand("f8"));
      expect(out.status).toBe(403);
      expect(out.body.error).toBe(UNREAD);
      nothingSavedByHand();
    }
    // An answer whose message is not a list of calls is not "no calls": missing is never zero.
    for (const message of ["Agent not found", null, { calls: [] }]) {
      world({ attempt: null });
      maqsamAnswer = { message };
      const out = await call("dial.save", byHand("f8"));
      expect(out.status).toBe(403);
      expect(out.body.error).toBe(UNREAD);
      nothingSavedByHand();
    }
    // The deadline ran out (AbortSignal.timeout's TimeoutError).
    world({ attempt: null });
    maqsamAnswer = { timeout: true, calls: [mqCall()] };
    const late = await call("dial.save", byHand("f8"));
    expect(late.status).toBe(403);
    expect(late.body.error).toBe(UNREAD);
    nothingSavedByHand();
    world({ attempt: null });
    env.SALES_MAQSAM_ACCESS_KEY = "";
    maqsamAnswer = { calls: [mqCall()] };
    const off = await call("dial.save", byHand("f9"));
    expect(off.status).toBe(403);
    expect(off.body.error).toBe(UNREAD);
    expect(maqsamAsks).toHaveLength(0);
    nothingSavedByHand();
  });

  test("a seat with no Maqsam address, or a lead with no phone number: refused before Maqsam is asked", async () => {
    world({ attempt: null });
    seat.maqsam_email = null;
    maqsamAnswer = { calls: [mqCall()] };
    const noSeat = await call("dial.save", byHand("fa"));
    expect(noSeat.status).toBe(403);
    expect(noSeat.body.error).toBe(NO_SEAT);
    nothingSavedByHand();
    for (const phone of [null, "", "12-34"]) {
      world({ attempt: null, phone });
      maqsamAnswer = { calls: [mqCall()] };
      const noPhone = await call("dial.save", byHand("fb"));
      expect(noPhone.status).toBe(403);
      expect(noPhone.body.error).toBe(NO_PHONE);
      nothingSavedByHand();
    }
    expect(maqsamAsks).toHaveLength(0);
  });

  test("a demo's confirmation or an intro more than a day away: refused as such, Maqsam not asked", async () => {
    world({ attempt: null, type: "demo" });
    maqsamAnswer = { calls: [mqCall()] };
    expect((await call("dial.save", byHand("fc"))).body.error).toBe(HELD_NOW_LINES.demo);
    world({ attempt: null, startIn: DAY + 30 * MIN });
    maqsamAnswer = { calls: [mqCall()] };
    expect((await call("dial.save", byHand("fd"))).body.error).toBe(HELD_NOW_LINES.far);
    nothingSavedByHand();
    expect(maqsamAsks).toHaveLength(0);
  });

  test("the other refusals of a mark still stand on the softphone: another rep's intro", async () => {
    world({ attempt: null, host: "G-closer" });
    maqsamAnswer = { calls: [mqCall()] };
    const out = await call("dial.save", byHand("fe"));
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("This call is booked with another rep. Only they or a manager can mark it.");
    nothingSavedByHand();
  });

  test("refused by Maqsam, but the lead joined this call's video room: the join passes the save, without held_now", async () => {
    world({ attempt: null });
    maqsamAnswer = { status: 500 };
    db.seed("cockpit_sales_rooms", [
      { id: "r-c", contact_id: "c", appointment_id: null, asked_appointment_id: "a-c", state: "lead_in", lead_in_at: iso(Date.now() - 4 * MIN) },
    ]);
    const out = await call("dial.save", byHand("ff"));
    expect(out.status).toBe(200);
    expect(marks()[0]?.status).toBe("showed");
    expect(audits("dial.save_manual")[0]?.metadata).not.toHaveProperty("held_now");
    expect(audits("dial.save_manual")[0]?.metadata).not.toHaveProperty("held_now_via");
  });
});
