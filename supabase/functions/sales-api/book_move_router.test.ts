// bun test --timeout 30000 supabase/functions/sales-api/book_move_router.test.ts
//
// Reschedule, book and tell, through sales-api's own door (index.ts
// Deno.serve), 2026-10-11: book.slots, book.move, book.move.check,
// book.create (a follow-up call, "already booked"), book.told and the mark
// against a moved call's old time. HighLevel is testfakes.ts FakeHighLevel,
// built on the shapes recorded from the test contact; the database is
// FakeDb. Nothing leaves this process; every lead and seat is invented.

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { kuwaitWords12, PUT_OK_NOTE } from "./reschedule.ts";
import { CALENDARS_SETTING, FakeDb, FakeHighLevel } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.resched.invalid";
const GHL = "https://services.leadconnectorhq.com";
const MIN = 60_000;
const HOUR = 60 * MIN;

const DEMO_CAL = "jQqXS1YuFnmGZKLkrE62";
const DEMO2_CAL = "NDBNz6Og4yfpdpWmHrue";
const INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI";
const FOLLOW_CAL = "JTNg1Wd62qxuT8W8sroh";

const SETTER = "resched-setter@stress.invalid";
const CLOSER = "resched-closer@stress.invalid";
const OTHER = "resched-other@stress.invalid";
const MANAGER = "resched-manager@stress.invalid";
const LEAD = "resched-lead-mona";
const TAGGED = "resched-lead-tagged";
const DEALT = "resched-lead-dealt";
const DEMO = "resched-demo-1";

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
  "seat-closer": { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" },
  "seat-other": { signed_in: true, seat: true, manager: false, email: OTHER, name: "Olla Other", role: "setter", ghl_user_id: "G-other" },
  "seat-manager": { signed_in: true, seat: true, manager: true, email: MANAGER, name: "Maha Manager", role: "manager", ghl_user_id: "G-boss" },
};

const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
let hl = new FakeHighLevel(() => Date.now());
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
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
      const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const out = hl.answer(method, url.slice(GHL.length), init.body ? JSON.parse(String(init.body)) : undefined);
    if (out === "no_answer") throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    return reply(out.body, out.status);
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-resched",
    SUPABASE_ANON_KEY: "anon-resched",
    SALES_GHL_TOKEN: "ghl-resched",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?book_move_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(seat: "setter" | "closer" | "other" | "manager", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const res = await handler(
    new Request("https://fn.resched.invalid/sales-api", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer seat-${seat}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

/** Background work (the HighLevel note, the owner) finishing. */
async function settleBackground(until: () => boolean = () => false): Promise<void> {
  for (let i = 0; i < 40 && !until(); i++) await new Promise(r => setTimeout(r, 5));
}

/** A whole minute, `h` hours ahead. */
const ahead = (h: number) => Math.ceil((Date.now() + h * HOUR) / MIN) * MIN;
let DEMO_AT = 0;
let T1 = 0;
let T2 = 0;
let T3 = 0;

function seedAppt(row: Row): void {
  db.seed("cockpit_sales_appointments", [{ origin: "b2b", status: "confirmed", mirrored_at: new Date().toISOString(), ...row }]);
}

beforeEach(() => {
  db.tables = {};
  hl = new FakeHighLevel(() => Date.now());
  DEMO_AT = ahead(26);
  T1 = ahead(50);
  T2 = ahead(51);
  T3 = ahead(52);
  db.seed("cockpit_sales_settings", [
    { key: "calendars", value: CALENDARS_SETTING },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
    { key: "pipeline", value: { auto_moves: false } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: OTHER, name: "Olla Other", role: "setter", ghl_user_id: "G-other", active: true },
    { email: "resched-aziz@stress.invalid", name: "Aziz Boss", role: "manager", ghl_user_id: "G-aziz", active: true },
  ]);
  db.seed("cockpit_sales_leads", [
    { contact_id: LEAD, name: "Mona Al Harbi", phone: "+971504127781", lead_class: "qualified", assigned_to: "G-setter", tags: [], dnd: false },
    { contact_id: TAGGED, name: "Tagged Client", phone: "+96550000001", tags: ["client"], dnd: false },
    { contact_id: DEALT, name: "Dealt Client", phone: "+96550000002", tags: [], dnd: false },
  ]);
  db.seed("cockpit_sales_deals", [{ response_id: "r1", contact_id: DEALT, submitted_at: new Date().toISOString(), voided: false, contracted_revenue: 6000 }]);
  hl.calendar(DEMO_CAL, ["G-closer", "G-aziz"]);
  hl.calendar(DEMO2_CAL, ["G-closer"]);
  hl.calendar(INTRO_CAL, ["G-setter"]);
  hl.calendar(FOLLOW_CAL, ["G-closer", "G-aziz"]);
  hl.free.set("G-closer", [T1, T2, T3]);
  hl.free.set("G-aziz", [T3, ahead(53)]);
  hl.free.set("G-setter", [ahead(5), ahead(6)]);
  hl.add({ id: DEMO, contactId: LEAD, calendarId: DEMO_CAL, start: DEMO_AT, assignedUserId: "G-closer", address: "https://us06web.zoom.us/j/81001879864?pwd=abc.1" });
  seedAppt({ appointment_id: DEMO, contact_id: LEAD, contact_name: "Mona Al Harbi", calendar_id: DEMO_CAL, call_type: "demo", start_at: new Date(DEMO_AT).toISOString(), assigned_user_id: "G-closer" });
});

const press = () => crypto.randomUUID();
const move = (seat: "setter" | "closer" | "other" | "manager", over: Row = {}) =>
  call(seat, { action: "book.move", appointment_id: DEMO, start: new Date(T1).toISOString(), reason: "they_asked", request_id: press(), source: "lead", ...over });

describe("book.move: one press reschedules in place", () => {
  test("moved and read back: the copy, the confirmation, one note, the audit, no dialer save", async () => {
    const r = await move("setter");
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("moved");
    expect(r.body.start).toBe(new Date(T1).toISOString());
    expect(r.body.from_start).toBe(new Date(DEMO_AT).toISOString());
    expect(r.body.host_changed).toBe(false);
    expect(r.body.appointment).toEqual({
      id: DEMO,
      kind: "demo",
      start: new Date(T1).toISOString(),
      host_user_id: "G-closer",
      host_name: "Sami Closer",
      meet_url: "https://us06web.zoom.us/j/81001879864?pwd=abc.1",
    });
    // In place: one PUT on the same appointment, HighLevel's own checks on.
    expect(hl.puts).toHaveLength(1);
    expect(hl.puts[0]?.id).toBe(DEMO);
    expect(hl.puts[0]?.body).toMatchObject({ calendarId: DEMO_CAL, assignedUserId: "G-closer", toNotify: true, ignoreFreeSlotValidation: false });
    expect(hl.appts.get(DEMO)?.start).toBe(T1);
    expect(hl.calls.some(c => c.method === "DELETE" || (c.method === "POST" && c.path === "/calendars/events/appointments"))).toBe(false);
    const copy = db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO) as Row;
    expect(Date.parse(String(copy.start_at))).toBe(T1);
    expect(copy.meet_url).toBe("https://us06web.zoom.us/j/81001879864?pwd=abc.1");
    const row = db.t("cockpit_sales_reschedules")[0] as Row;
    expect(row).toMatchObject({ state: "moved", reason: "they_asked", source: "lead", rep_email: SETTER, after_start: false, to_user_id: "G-closer" });
    // They asked: their confirmation of the new time, by the cockpit (no call open).
    const conf = db.t("cockpit_sales_confirmations");
    expect(conf).toHaveLength(1);
    expect(conf[0]).toMatchObject({ appointment_id: DEMO, result: "reschedule", via: "cockpit", call_type: "demo" });
    expect(Date.parse(String(conf[0]?.start_at))).toBe(T1);
    // Not a dialer save (D19).
    expect(db.t("cockpit_sales_attempts")).toHaveLength(0);
    await settleBackground(() => hl.notes.length > 0);
    expect(hl.notes).toHaveLength(1);
    expect(hl.notes[0]?.body).toBe(
      `Rescheduled the demo from ${kuwaitWords12(DEMO_AT)} to ${kuwaitWords12(T1)} (Kuwait time), with Sami Closer. By Tara Setter in the cockpit. Why: they asked.`,
    );
    const audit = db.t("cockpit_audit_log").find(a => a.action === "book.move") as Row;
    expect(audit).toMatchObject({ entity_id: DEMO, actor_email: SETTER });
    expect(audit.metadata).toMatchObject({ reason: "they_asked", source: "lead", verified: true, host_changed: false });
    await settleBackground(() => db.t("cockpit_audit_log").some(a => a.action === "book.move.note"));
    expect(db.t("cockpit_audit_log").find(a => a.action === "book.move.note")?.after).toEqual({ crm_note: "written" });
  });

  test("the same press twice is one move", async () => {
    const id = press();
    const a = await move("setter", { request_id: id });
    const b = await move("setter", { request_id: id });
    expect(b.status).toBe(200);
    expect(b.body.reschedule_id).toBe(a.body.reschedule_id);
    expect(b.body.repeated).toBe(true);
    expect(hl.puts).toHaveLength(1);
    expect(db.t("cockpit_sales_reschedules")).toHaveLength(1);
  });

  test("HighLevel refuses: nothing moved, said with the old time", async () => {
    hl.putMode = "refuse";
    const r = await move("setter");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("refused");
    expect(r.body.error).toBe(
      `HighLevel did not reschedule it: The slot you have selected is no longer available. It is still at ${kuwaitWords12(DEMO_AT)}.`,
    );
    expect(hl.appts.get(DEMO)?.start).toBe(DEMO_AT);
    expect(db.t("cockpit_sales_reschedules")[0]?.state).toBe("failed");
    expect(db.t("cockpit_sales_confirmations")).toHaveLength(0);
    expect(db.t("cockpit_audit_log").some(a => a.action === "book.move" && (a.after as Row).state === "failed")).toBe(true);
  });

  test("no answer, but it landed: moved, and never a second PUT", async () => {
    hl.putMode = "landed_no_answer";
    const r = await move("setter");
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("moved");
    expect(hl.puts).toHaveLength(1);
  });

  test("no answer, and still at the old time: not moved, press again", async () => {
    hl.putMode = "no_answer";
    const r = await move("setter");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("not_moved");
    expect(r.body.error).toBe(`HighLevel did not answer, and the call is still at ${kuwaitWords12(DEMO_AT)}. Press the time again.`);
    expect(db.t("cockpit_sales_reschedules")[0]?.state).toBe("not_moved");
    // The lock is free: the next press moves it.
    const again = await move("setter");
    expect(again.body.result).toBe("moved");
  });

  test("a landed move whose answer was lost: the next press finds it there, with no second PUT", async () => {
    // HighLevel moved it to T1 already (the first press's answer never came back).
    Object.assign(hl.appts.get(DEMO) as object, { start: T1, end: T1 + 45 * MIN });
    const r = await move("setter");
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("moved");
    expect(hl.puts).toHaveLength(0);
    expect((db.t("cockpit_audit_log").find(a => a.action === "book.move")?.metadata as Row).landed).toBe(true);
  });

  test("the read-back cannot be read: checking, then book.move.check says moved", async () => {
    hl.putMode = "ok_unreadable";
    const r = await move("setter");
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("checking");
    expect(db.t("cockpit_sales_reschedules")[0]?.state).toBe("moving");
    const c = await call("setter", { action: "book.move.check", reschedule_id: r.body.reschedule_id });
    expect(c.status).toBe(200);
    expect(c.body.result).toBe("moved");
    expect(c.body.start).toBe(new Date(T1).toISOString());
    expect(db.t("cockpit_sales_reschedules")[0]?.state).toBe("moved");
    const copy = db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO) as Row;
    expect(Date.parse(String(copy.start_at))).toBe(T1);
    // Settled once: one confirmation, and the check's own audit row.
    expect(db.t("cockpit_sales_confirmations")).toHaveLength(1);
    expect(db.t("cockpit_audit_log").some(a => a.action === "book.move.check")).toBe(true);
    // Another seat cannot read someone else's move.
    expect((await call("other", { action: "book.move.check", reschedule_id: r.body.reschedule_id })).status).toBe(403);
  });

  test("a move HighLevel said yes to but still shows at the old time waits, then is left for a person", async () => {
    hl.putMode = "ok";
    // HighLevel answers yes and moves nothing (its copy lags).
    const realAnswer = hl.answer.bind(hl);
    hl.answer = (m, p, b) => {
      if (m === "PUT" && p.startsWith("/calendars/events/appointments/")) return { status: 200, body: { id: DEMO } };
      return realAnswer(m, p, b);
    };
    const r = await move("setter");
    expect(r.body.result).toBe("checking");
    const row = db.t("cockpit_sales_reschedules")[0] as Row;
    expect(row.error).toBe(PUT_OK_NOTE);
    // A minute on, still the old time: unverified, the lock freed.
    row.created_at = new Date(Date.now() - 61_000).toISOString();
    const c = await call("setter", { action: "book.move.check", reschedule_id: r.body.reschedule_id });
    expect(c.body.result).toBe("unverified");
    expect(db.t("cockpit_sales_reschedules")[0]?.state).toBe("unverified");
  });

  test("two seats at once: the second waits (busy)", async () => {
    db.seed("cockpit_sales_reschedules", [
      { request_id: press(), appointment_id: DEMO, contact_id: LEAD, call_type: "demo", calendar_id: DEMO_CAL, from_start: new Date(DEMO_AT).toISOString(), to_start: new Date(T2).toISOString(), reason: "they_asked", source: "lead", rep_email: CLOSER, state: "moving" },
    ]);
    const r = await move("setter");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("busy");
    expect(hl.puts).toHaveLength(0);
  });

  test("a move cut off three minutes ago is settled from HighLevel first, then the new one goes", async () => {
    db.seed("cockpit_sales_reschedules", [
      { request_id: press(), appointment_id: DEMO, contact_id: LEAD, call_type: "demo", calendar_id: DEMO_CAL, from_start: new Date(DEMO_AT).toISOString(), to_start: new Date(T2).toISOString(), reason: "they_asked", source: "lead", rep_email: CLOSER, state: "moving", created_at: new Date(Date.now() - 3 * MIN).toISOString() },
    ]);
    const r = await move("setter");
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("moved");
    const rows = db.t("cockpit_sales_reschedules");
    expect(rows.map(x => x.state).sort()).toEqual(["moved", "not_moved"]);
  });
});

describe("book.move: the guards", () => {
  test("not yours: told whose call it is, before HighLevel is asked", async () => {
    const r = await move("other");
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "not_yours", error: "This call is Sami's. Ask Sami or a manager to reschedule it." });
    expect(hl.calls).toHaveLength(0);
    // The host, the lead's owner and a manager may.
    expect((await move("closer", { start: new Date(T2).toISOString() })).body.result).toBe("moved");
  });

  test("the seat that booked it may, though it neither hosts nor owns", async () => {
    db.seed("cockpit_sales_bookings", [{ contact_id: LEAD, kind: "demo", calendar_id: DEMO_CAL, start_at: new Date(DEMO_AT).toISOString(), rep_email: OTHER, note: "x", state: "booked", appointment_id: DEMO }]);
    expect((await move("other")).body.result).toBe("moved");
  });

  test("an active client by the tag, or by a live deal only", async () => {
    for (const contact of [TAGGED, DEALT]) {
      const id = `appt-${contact}`;
      hl.add({ id, contactId: contact, calendarId: DEMO_CAL, start: DEMO_AT + HOUR, assignedUserId: "G-closer" });
      seedAppt({ appointment_id: id, contact_id: contact, calendar_id: DEMO_CAL, call_type: "demo", start_at: new Date(DEMO_AT + HOUR).toISOString(), assigned_user_id: "G-closer" });
      const r = await move("manager", { appointment_id: id });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("client");
      expect(String(r.body.error)).toContain("Client success looks after them.");
    }
    expect(hl.puts).toHaveLength(0);
  });

  test("over, held on video, and more than 20 minutes late", async () => {
    db.seed("cockpit_sales_dispositions", [{ appointment_id: DEMO, contact_id: LEAD, status: "noshow", marked_by: CLOSER, superseded_at: null }]);
    expect((await move("setter")).body.code).toBe("over");
    db.tables.cockpit_sales_dispositions = [];
    db.seed("cockpit_sales_rooms", [{ contact_id: LEAD, appointment_id: DEMO, state: "ended", lead_in_at: new Date(Date.now() - 10 * MIN).toISOString() }]);
    const held = await move("setter");
    expect(held.body).toMatchObject({ code: "held", error: "Mona joined the video call for this one, so it happened. Mark it instead." });
    db.tables.cockpit_sales_rooms = [];
    const copy = db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO) as Row;
    copy.start_at = new Date(Date.now() - 21 * MIN).toISOString();
    expect((await move("setter")).body.code).toBe("late");
    copy.start_at = new Date(Date.now() - 19 * MIN).toISOString();
    (hl.appts.get(DEMO) as { start: number }).start = Date.now() - 19 * MIN;
    const ok = await move("setter");
    expect(ok.body.result).toBe("moved");
    expect(db.t("cockpit_sales_reschedules")[0]?.after_start).toBe(true);
  });

  test("a time past, taken, or on top of the lead's other call", async () => {
    expect((await move("setter", { start: new Date(Date.now() - MIN).toISOString() })).body.code).toBe("past");
    expect((await move("setter", { start: new Date(ahead(60)).toISOString() })).body.code).toBe("taken");
    hl.add({ id: "intro-x", contactId: LEAD, calendarId: INTRO_CAL, start: T1 + 10 * MIN, assignedUserId: "G-setter" });
    const r = await move("setter");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("clash");
    expect(String(r.body.error)).toContain("That time overlaps their intro on");
    expect(hl.puts).toHaveLength(0);
  });

  test("Other needs a few words", async () => {
    expect((await move("setter", { reason: "other", note: "" })).body.code).toBe("note_needed");
    expect((await move("setter", { reason: "other", note: "Travelling." })).body.result).toBe("moved");
  });
});

describe("book.move: what follows a move", () => {
  test("a call on Demo 2 stays on Demo 2", async () => {
    hl.add({ id: "demo2", contactId: LEAD, calendarId: DEMO2_CAL, start: DEMO_AT + 3 * HOUR, assignedUserId: "G-closer" });
    seedAppt({ appointment_id: "demo2", contact_id: LEAD, calendar_id: DEMO2_CAL, call_type: "demo", start_at: new Date(DEMO_AT + 3 * HOUR).toISOString(), assigned_user_id: "G-closer" });
    db.tables.cockpit_sales_appointments = db.t("cockpit_sales_appointments").filter(a => a.appointment_id !== DEMO);
    hl.appts.delete(DEMO);
    const r = await move("closer", { appointment_id: "demo2" });
    expect(r.body.result).toBe("moved");
    expect(hl.puts[0]?.body.calendarId).toBe(DEMO2_CAL);
  });

  test("a follow-up call moves with follow-up words; the host can't make it writes no confirmation", async () => {
    hl.add({ id: "fu-1", contactId: LEAD, calendarId: FOLLOW_CAL, start: DEMO_AT + 4 * HOUR, assignedUserId: "G-closer" });
    seedAppt({ appointment_id: "fu-1", contact_id: LEAD, calendar_id: FOLLOW_CAL, call_type: "follow_up", start_at: new Date(DEMO_AT + 4 * HOUR).toISOString(), assigned_user_id: "G-closer" });
    const r = await move("closer", { appointment_id: "fu-1", reason: "host_cant" });
    expect(r.body.result).toBe("moved");
    expect((r.body.appointment as Row).kind).toBe("follow_up");
    expect(db.t("cockpit_sales_confirmations")).toHaveLength(0);
    await settleBackground(() => hl.notes.length > 0);
    expect(hl.notes[0]?.body).toContain("Rescheduled the follow-up call from");
    expect(hl.notes[0]?.body).toContain("Why: Sami can't make it.");
  });

  test("from the dialer: the open call is saved as rescheduled, and its note is the one note", async () => {
    db.seed("cockpit_sales_attempts", [{ id: "a1a1a1a1-0000-4000-8000-000000000001", contact_id: LEAD, rep_email: SETTER, state: "placed", manual: false, started_at: new Date().toISOString() }]);
    const r = await move("setter", { source: "dialer", attempt_id: "a1a1a1a1-0000-4000-8000-000000000001", item_kind: "confirm" });
    expect(r.body.result).toBe("moved");
    const a = db.t("cockpit_sales_attempts")[0] as Row;
    expect(a).toMatchObject({ state: "saved", outcome: "rescheduled", item_kind: "confirm", appointment_id: DEMO });
    expect(String(a.note)).toMatch(/^Rescheduled the demo from /);
    expect(db.t("cockpit_sales_confirmations")[0]?.via).toBe("call");
    await settleBackground(() => hl.notes.length > 0);
    await settleBackground();
    expect(hl.notes).toHaveLength(1);
    expect(hl.notes[0]?.body).toBe(String(a.note));
  });

  test("the lead's instant Zoom link is kept past the tidy until the new start plus three hours", async () => {
    db.seed("cockpit_sales_zoom_links", [
      { contact_id: LEAD, seat_email: SETTER, call_kind: "demo", host_kind: "own", host_email: SETTER, meeting_id: "8500", join_url: "https://us06web.zoom.us/j/8500", made_at: new Date(Date.now() - HOUR).toISOString(), deleted_at: null, started_at: null },
    ]);
    await move("setter");
    expect(Date.parse(String(db.t("cockpit_sales_zoom_links")[0]?.keep_until))).toBe(T1 + 3 * HOUR);
  });

  test("a demo moved to another host makes them the lead's owner", async () => {
    // Someone not on the calendar is refused.
    expect((await move("setter", { user_id: "G-stranger" })).body.code).toBe("host");
    const r = await move("setter", { start: new Date(ahead(53)).toISOString(), user_id: "G-aziz" });
    expect(r.body.result).toBe("moved");
    expect(r.body.host_changed).toBe(true);
    expect(hl.puts[0]?.body.assignedUserId).toBe("G-aziz");
    expect(db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO)?.assigned_user_id).toBe("G-aziz");
    await settleBackground(() => hl.calls.some(c => c.method === "PUT" && c.path === `/contacts/${LEAD}`));
    expect(hl.calls.find(c => c.method === "PUT" && c.path === `/contacts/${LEAD}`)?.body).toEqual({ assignedTo: "G-aziz" });
    // The lead is Aziz's now: the setter who no longer owns it is told whose call it is.
    expect((await move("setter", { start: new Date(T3).toISOString() })).body.code).toBe("not_yours");
  });

  test("a no-show against the old time is refused while B2B still shows it", async () => {
    await move("setter");
    // B2B's next copy puts the old time back (the mirror's hold is sales-mirror's own test).
    const copy = db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO) as Row;
    copy.start_at = new Date(Date.now() - 30 * MIN).toISOString();
    const r = await call("closer", { action: "mark", appointment_id: DEMO, status: "noshow" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "rescheduled", error: `This call was rescheduled to ${kuwaitWords12(T1)}. Mark it after then.` });
    // Cancelled is still a mark anyone may make ahead of time.
    expect((await call("closer", { action: "mark", appointment_id: DEMO, status: "cancelled", reason: "asked" })).status).toBe(200);
  });
});

describe("book.slots", () => {
  test("rescheduling: the same host's times, the calendar's reach, the call in words", async () => {
    const r = await call("setter", { action: "book.slots", appointment_id: DEMO });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "demo", with: "same", fallback: false, host: { user_id: "G-closer", name: "Sami Closer" }, existing: null, reschedule_link: null });
    expect((r.body.days as Row[]).flatMap(d => d.slots as string[]).map(s => Date.parse(s))).toEqual([T1, T2, T3]);
    expect(r.body.moving).toMatchObject({ id: DEMO, kind: "demo", words: kuwaitWords12(DEMO_AT), host_name: "Sami Closer", after_start: false });
    expect(typeof r.body.until).toBe("string");
    expect(r.body.slot_hosts).toBeUndefined();
  });

  test("a host with no free time: the team's times, each naming who takes it", async () => {
    hl.free.set("G-closer", []);
    const r = await call("setter", { action: "book.slots", appointment_id: DEMO });
    expect(r.body).toMatchObject({ with: "anyone", fallback: true });
    const hosts = r.body.slot_hosts as Record<string, Row>;
    expect(Object.values(hosts).map(h => h.name)).toEqual(["Aziz Boss", "Aziz Boss"]);
  });

  test("refused before any HighLevel read", async () => {
    const r = await call("other", { action: "book.slots", appointment_id: DEMO });
    expect(r.body.code).toBe("not_yours");
    expect(hl.calls.filter(c => c.path.includes("free-slots"))).toHaveLength(0);
  });

  test("booking a follow-up call: the Follow up call calendar, with me", async () => {
    const r = await call("closer", { action: "book.slots", contact_id: LEAD, kind: "follow_up" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "follow_up", calendar_id: FOLLOW_CAL, with: "me", host: { user_id: "G-closer" }, moving: null });
  });
});

describe("book.create", () => {
  test("a follow-up call is booked, moves no stage and changes no owner", async () => {
    const r = await call("closer", { action: "book.create", contact_id: LEAD, kind: "follow_up", start: new Date(T2).toISOString(), note: "Follow up on the proposal.", source: "script" });
    expect(r.status).toBe(200);
    expect(r.body.words).toBe(`Follow-up call booked for ${kuwaitWords12(T2)} (Kuwait time)`);
    expect(r.body.appointment).toMatchObject({ kind: "follow_up", host_user_id: "G-closer", host_name: "Sami Closer" });
    expect(db.t("cockpit_sales_bookings")[0]).toMatchObject({ kind: "follow_up", source: "script", state: "booked" });
    expect(r.body.owner).toBeNull();
    expect(hl.calls.some(c => c.method === "PUT" && c.path.startsWith("/contacts/"))).toBe(false);
  });

  test("already booked: the code and the call, to reschedule that one", async () => {
    const r = await call("closer", { action: "book.create", contact_id: LEAD, kind: "demo", start: new Date(T1).toISOString(), note: "Second demo?" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("already_booked");
    expect(r.body.existing).toMatchObject({ id: DEMO, kind: "demo", start: new Date(DEMO_AT).toISOString() });
    expect(r.body.error).toBe(`They already have a demo on ${kuwaitWords12(DEMO_AT)} (Kuwait time). Reschedule that one instead of booking a second.`);
  });

  test("a call the cockpit marked no-show seconds ago never blocks booking again", async () => {
    db.seed("cockpit_sales_dispositions", [{ appointment_id: DEMO, contact_id: LEAD, status: "noshow", marked_by: CLOSER, superseded_at: null }]);
    const r = await call("closer", { action: "book.create", contact_id: LEAD, kind: "demo", start: new Date(T1).toISOString(), note: "Booked again." });
    expect(r.status).toBe(200);
    expect(r.body.verified).toBe(true);
  });

  test("an active client is refused", async () => {
    const r = await call("closer", { action: "book.create", contact_id: DEALT, kind: "demo", start: new Date(T1).toISOString(), note: "No." });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("client");
  });
});

describe("book.told", () => {
  test("stamps the reschedule and leaves an audit row; WhatsApp refused under do not disturb", async () => {
    const m = await move("setter");
    const r = await call("setter", { action: "book.told", appointment_id: DEMO, reschedule_id: m.body.reschedule_id, how: "whatsapp", lang: "ar", moment: "rescheduled" });
    expect(r.status).toBe(200);
    expect(db.t("cockpit_sales_reschedules")[0]).toMatchObject({ told_how: "whatsapp", told_lang: "ar" });
    expect(db.t("cockpit_audit_log").find(a => a.action === "book.told")?.metadata).toMatchObject({ moment: "rescheduled" });
    (db.t("cockpit_sales_leads").find(l => l.contact_id === LEAD) as Row).dnd = true;
    const dnd = await call("setter", { action: "book.told", appointment_id: DEMO, how: "whatsapp", lang: "en" });
    expect(dnd.body).toMatchObject({ code: "dnd", error: "Do not disturb is on: no WhatsApp." });
    expect((await call("setter", { action: "book.told", appointment_id: DEMO, how: "copy", lang: "en" })).status).toBe(200);
  });
});

describe("the closer's end of day (D38)", () => {
  test("Rescheduled is HighLevel's stamp, shown beside the question and never typed in", async () => {
    const now = new Date().toISOString();
    seedAppt({ appointment_id: "x1", contact_id: LEAD, calendar_id: DEMO_CAL, call_type: "demo", start_at: now, assigned_user_id: "G-closer", crm_rescheduled_at: now });
    seedAppt({ appointment_id: "x2", contact_id: LEAD, calendar_id: DEMO_CAL, call_type: "demo", start_at: now, assigned_user_id: "G-aziz", crm_rescheduled_at: now });
    seedAppt({ appointment_id: "x3", contact_id: LEAD, calendar_id: DEMO_CAL, call_type: "demo", start_at: now, assigned_user_id: "G-closer", crm_rescheduled_at: null });
    const r = await call("closer", { action: "eod.prefill" });
    expect(r.status).toBe(200);
    expect((r.body.computed as Row).rescheduled).toBe(1);
    expect(String((r.body.notes as Row).rescheduled)).toContain("From HighLevel's reschedule stamp");
    expect(r.body.prefill as string[]).not.toContain("rescheduled");
  });
});
