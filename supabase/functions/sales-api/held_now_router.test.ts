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
import { beforeAll, describe, expect, test } from "bun:test";
import { HELD_NOW_AHEAD, HELD_NOW_CALL_AGE, HELD_NOW_LINES, HELD_NOW_MIN_CALL, heldNowCheck, MARK_GRACE } from "./dialer.ts";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.heldnow.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-h@heldnow.invalid";
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
      maqsam_email: SETTER,
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
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-heldnow",
    SUPABASE_ANON_KEY: "anon-heldnow",
    SALES_GHL_TOKEN: "ghl-heldnow",
  };
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

/**
 * A fresh world: the setter's seat, marks written to HighLevel, one lead
 * ("c") with an intro `startIn` from now hosted by the setter, and, unless
 * `attempt` is null, the dialer's open call for its confirm item.
 */
function world(o: { startIn?: number; type?: "intro" | "demo"; host?: string; attempt?: Row | null } = {}) {
  db.tables = {};
  db.faults = [];
  ghlCalls.length = 0;
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
      phone: "+96550004321",
      phone8: "50004321",
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
    booked_at: iso(now - DAY),
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
  test("a save with no call through the dialer (a call made elsewhere)", async () => {
    world({ attempt: null });
    const out = await call("dial.save", held({ attempt_id: undefined, contact_id: "c", request_id: "00000000-0000-4000-8000-0000000000d3" }));
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(ELSEWHERE);
    expect(db.tables.cockpit_sales_attempts ?? []).toHaveLength(0);
    expect(marks()).toHaveLength(0);
    expect(markPuts()).toHaveLength(0);
  });

  test("the dialer's call placed from another item, or for another call", async () => {
    world({ attempt: { item_kind: "lead", appointment_id: null } });
    const lead = await call("dial.save", held());
    expect(lead.status).toBe(403);
    expect(lead.body.error).toBe(ELSEWHERE);
    nothingSaved();
    world({ attempt: { appointment_id: "a-other" } });
    const other = await call("dial.save", held());
    expect(other.status).toBe(403);
    expect(other.body.error).toBe(ELSEWHERE);
    nothingSaved();
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
