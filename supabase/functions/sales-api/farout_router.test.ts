// bun test --timeout 30000 supabase/functions/sales-api/farout_router.test.ts
//
// Booking past the lead's booking page, a custom time, and the lead's own
// reschedule link, through sales-api's own door (index.ts Deno.serve),
// 2026-10-11: book.slots (far days, the page, far.state, the custom hosts),
// book.check, book.create and book.move (far and custom: the flags, the host,
// the re-check, the audit rows) and book.links. HighLevel is testfakes.ts
// FakeHighLevel with its public window on (windowed), the hosts' schedules,
// calls and blocked time; the database is FakeDb. Nothing leaves this
// process; every lead, seat and time is invented.

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { addDays, dayStartMs, dayWords } from "./farout.ts";
import type { DbError } from "./liveio.ts";
import { kuwaitDay } from "./reschedule.ts";
import { CALENDARS_SETTING, FakeDb, FakeHighLevel } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.farout.invalid";
const GHL = "https://services.leadconnectorhq.com";
const MIN = 60_000;

const DEMO_CAL = "jQqXS1YuFnmGZKLkrE62";
const INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI";
const FOLLOW_CAL = "JTNg1Wd62qxuT8W8sroh";

const SETTER = "farout-setter@stress.invalid";
const CLOSER = "farout-closer@stress.invalid";
const OTHER = "farout-other@stress.invalid";
const LEAD = "farout-lead-mona";
const LEAD2 = "farout-lead-noor";
const CLIENT = "farout-lead-client";
const DEMO = "farout-demo-1";
const INTRO = "farout-intro-1";
const FOLLOW = "farout-follow-1";

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
  "seat-closer": { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" },
  "seat-other": { signed_in: true, seat: true, manager: false, email: OTHER, name: "Olla Other", role: "setter", ghl_user_id: "G-other" },
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
    if (!headers.get("user-agent")) throw new Error("HighLevel was called without a User-Agent");
    const out = hl.answer(method, url.slice(GHL.length), init.body ? JSON.parse(String(init.body)) : undefined);
    if (out === "no_answer") throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    return reply(out.body, out.status);
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-farout",
    SUPABASE_ANON_KEY: "anon-farout",
    SALES_GHL_TOKEN: "ghl-farout",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?farout_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(seat: "setter" | "closer" | "other", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const res = await handler(
    new Request("https://fn.farout.invalid/sales-api", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer seat-${seat}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

async function settleBackground(until: () => boolean = () => false): Promise<void> {
  for (let i = 0; i < 40 && !until(); i++) await new Promise(r => setTimeout(r, 5));
}

/** Today in Kuwait plus n days, and a Kuwait wall time on it. */
const day = (n: number) => addDays(kuwaitDay(Date.now()), n);
const at = (n: number, hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return dayStartMs(day(n)) + (h * 60 + m) * MIN;
};
const iso = (t: number) => new Date(t).toISOString();
const all = (r: Row) => (r.days as { day: string; slots: string[]; far?: boolean }[]).flatMap(d => d.slots.map(s => Date.parse(s)));
const press = () => crypto.randomUUID();

/** Every weekday 09:00 to 18:00, so a test reads the same whatever day it runs. */
const EVERY_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(d => ({
  type: "wday",
  day: d,
  intervals: [{ from: "09:00", to: "18:00" }],
}));

// The far day the tests book on: five days out, past every window (the demo
// opens three days, the intro two).
const FAR = 5;

beforeEach(() => {
  db.tables = {};
  hl = new FakeHighLevel(() => Date.now());
  hl.windowed = true;
  db.seed("cockpit_sales_settings", [
    { key: "calendars", value: CALENDARS_SETTING },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
    { key: "pipeline", value: { auto_moves: false } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: OTHER, name: "Olla Other", role: "setter", ghl_user_id: "G-other", active: true },
    { email: "farout-aziz@stress.invalid", name: "Aziz Boss", role: "manager", ghl_user_id: "G-aziz", active: true },
  ]);
  db.seed("cockpit_sales_leads", [
    { contact_id: LEAD, name: "Mona Al Harbi", phone: "+971504127781", lead_class: "qualified", assigned_to: "G-setter", tags: [], dnd: false },
    { contact_id: LEAD2, name: "Noor Al Sabah", phone: "+96550001234", lead_class: "qualified", assigned_to: null, tags: [], dnd: false },
    { contact_id: CLIENT, name: "Client Co", phone: "+96550000001", tags: ["client"], dnd: false },
  ]);
  hl.calendar(DEMO_CAL, ["G-closer", "G-aziz"]);
  hl.calendar(INTRO_CAL, ["G-setter"]);
  hl.calendar(FOLLOW_CAL, ["G-closer", "G-aziz"]);
  // Sami's "Work Hours" are linked to the calendars he takes; Aziz's to none,
  // so HighLevel offers him nothing on them (as read 2026-10-11).
  hl.schedules = [
    { id: "s-closer", userId: "G-closer", calendarIds: [DEMO_CAL, FOLLOW_CAL], rules: EVERY_DAY, timezone: "Asia/Kuwait", deleted: false },
    { id: "s-setter", userId: "G-setter", calendarIds: [INTRO_CAL], rules: EVERY_DAY, timezone: "Asia/Kuwait", deleted: false },
    { id: "s-aziz", userId: "G-aziz", calendarIds: [], rules: EVERY_DAY, timezone: "Asia/Kuwait", deleted: false },
  ];
  // Inside the windows: HighLevel's own times.
  hl.free.set("G-closer", [at(1, "10:00"), at(2, "11:00")]);
  hl.free.set("G-setter", [at(1, "10:00")]);
  // HighLevel's extended answer agrees with Sami's own hours on some far times only.
  hl.extFree.set("G-closer", [at(1, "10:00"), at(2, "11:00"), at(FAR, "10:00"), at(FAR, "11:00"), at(FAR + 1, "14:00")]);
  hl.add({ id: DEMO, contactId: LEAD, calendarId: DEMO_CAL, start: at(1, "16:00"), assignedUserId: "G-closer", address: "https://us06web.zoom.us/j/81001879864?pwd=abc.1" });
  hl.add({ id: INTRO, contactId: LEAD2, calendarId: INTRO_CAL, start: at(1, "12:00"), assignedUserId: "G-setter" });
  hl.add({ id: FOLLOW, contactId: LEAD2, calendarId: FOLLOW_CAL, start: at(2, "15:00"), assignedUserId: "G-closer" });
  const seed = (id: string, contact: string, cal: string, kind: string, start: number, host: string) =>
    db.seed("cockpit_sales_appointments", [
      { appointment_id: id, contact_id: contact, calendar_id: cal, call_type: kind, start_at: iso(start), assigned_user_id: host, origin: "b2b", status: "confirmed", mirrored_at: iso(Date.now()) },
    ]);
  seed(DEMO, LEAD, DEMO_CAL, "demo", at(1, "16:00"), "G-closer");
  seed(INTRO, LEAD2, INTRO_CAL, "intro", at(1, "12:00"), "G-setter");
  seed(FOLLOW, LEAD2, FOLLOW_CAL, "follow_up", at(2, "15:00"), "G-closer");
});

const move = (seat: "setter" | "closer" | "other", start: number, over: Row = {}) =>
  call(seat, { action: "book.move", appointment_id: DEMO, start: iso(start), reason: "they_asked", request_id: press(), source: "lead", ...over });
const auditOf = (action: string) => db.t("cockpit_audit_log").filter(a => a.action === action);

describe("book.slots past the booking page", () => {
  test("the window's days as HighLevel gives them, then the far days marked, up to the reach", async () => {
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO });
    expect(r.status).toBe(200);
    const days = r.body.days as { day: string; slots: string[]; far?: boolean }[];
    expect(days.filter(d => !d.far).flatMap(d => d.slots).map(s => Date.parse(s))).toEqual([at(1, "10:00"), at(2, "11:00")]);
    expect(days.filter(d => d.far)).toEqual([
      { day: day(FAR), slots: [`${day(FAR)}T10:00:00+03:00`, `${day(FAR)}T11:00:00+03:00`], far: true },
      { day: day(FAR + 1), slots: [`${day(FAR + 1)}T14:00:00+03:00`], far: true },
    ]);
    expect(r.body).toMatchObject({
      with: "same",
      window_until: day(2),
      reach_until: day(59),
      until: day(59),
      page: { from: day(0), to: day(13), prev: null, next: day(14) },
      far: { state: "ok", agreed: true, note: null },
      custom: { host: { user_id: "G-closer", name: "Sami Closer" }, step_min: 5 },
      reschedule_link: null,
    });
    expect((r.body.custom as Row).hosts).toEqual([
      { user_id: "G-closer", name: "Sami Closer" },
      { user_id: "G-aziz", name: "Aziz Boss" },
    ]);
    const hours = r.body.host_hours as { user_id: string; week: Record<string, [string, string][]> };
    expect(hours.user_id).toBe("G-closer");
    expect(hours.week.wed).toEqual([["09:00", "18:00"]]);
    // The host's own tiles name nobody.
    expect(r.body.slot_hosts).toBeUndefined();
    // The far part read the host's calls and blocked time, and HighLevel's extended answer.
    expect(hl.calls.some(c => c.path.startsWith("/calendars/events?") && c.path.includes("userId=G-closer"))).toBe(true);
    expect(hl.calls.some(c => c.path.startsWith("/calendars/blocked-slots?"))).toBe(true);
    expect(hl.calls.some(c => c.path.includes("/free-slots?") && c.path.includes("ignoreDateRange=true"))).toBe(true);
  });

  test("the window's days are the same, byte for byte, when the far part cannot be read", async () => {
    const withFar = await call("closer", { action: "book.slots", appointment_id: DEMO });
    hl.fails.events = true;
    const without = await call("closer", { action: "book.slots", appointment_id: DEMO });
    const windowOf = (r: Row) => (r.days as Row[]).filter(d => !d.far);
    expect(JSON.stringify(windowOf(without.body))).toBe(JSON.stringify(windowOf(withFar.body)));
    expect(without.body.far).toEqual({
      state: "unread",
      agreed: null,
      note: `Times past ${dayWords(day(2))} could not be checked just now: Sami's calendar did not answer. The booking page's days are below.`,
    });
    expect((without.body.days as Row[]).some(d => d.far)).toBe(false);
    // Unread is never "no free time": until stays the window's last day.
    expect(without.body.until).toBe(day(2));
  });

  test("the booking setting unread: no far times, said; its reach read when set", async () => {
    const real = db.db.bind(db);
    db.db = (path, opts) => {
      if (path.startsWith("cockpit_sales_settings?key=eq.booking"))
        return Promise.reject(Object.assign(new Error("database 503: down"), { status: 503 }));
      return real(path, opts);
    };
    try {
      const r = await call("closer", { action: "book.slots", appointment_id: DEMO });
      expect(r.status).toBe(200);
      expect((r.body.far as Row).state).toBe("unread");
      expect(String((r.body.far as Row).note)).toContain("the cockpit's booking setting did not answer");
    } finally {
      db.db = real;
    }
    db.seed("cockpit_sales_settings", [{ key: "booking", value: { reach_days: 20 } }]);
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO, from: day(14) });
    expect(r.body).toMatchObject({ reach_until: day(19), until: day(19), page: { from: day(14), to: day(19), prev: day(0), next: null } });
  });

  test("a later page: only that page's days, far ones; the window is still HighLevel's own", async () => {
    hl.extFree.set("G-closer", [at(16, "09:00"), at(30, "09:00")]);
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO, from: day(14) });
    expect(r.body).toMatchObject({ window_until: day(2), page: { from: day(14), to: day(27), prev: day(0), next: day(28) } });
    expect(all(r.body)).toEqual([at(16, "09:00")]);
    // The window part was still read from today.
    const normal = hl.calls.filter(c => c.path.includes("/free-slots?") && !c.path.includes("ignoreDateRange"));
    expect(normal.length).toBeGreaterThan(0);
  });

  test("a host with no hours on the calendar (Aziz on the demo): none, said; the window's days still work", async () => {
    (hl.appts.get(DEMO) as { assignedUserId: string }).assignedUserId = "G-aziz";
    (db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO) as Row).assigned_user_id = "G-aziz";
    hl.free.set("G-aziz", [at(1, "11:00")]);
    hl.extFree.set("G-aziz", [at(1, "11:00"), at(FAR, "10:00")]);
    // The setter owns the lead, so may reschedule Aziz's demo.
    const r = await call("setter", { action: "book.slots", appointment_id: DEMO });
    expect(r.body.far).toEqual({
      state: "none",
      agreed: null,
      note: "Aziz has no working hours on this calendar in HighLevel, so only the booking page's days are offered.",
    });
    expect(all(r.body)).toEqual([at(1, "11:00")]);
    expect(r.body.until).toBe(day(1));
  });

  test("Show anyone free: each far tile names who takes it (Aziz has no hours, so Sami)", async () => {
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO, with: "anyone" });
    expect(r.body.with).toBe("anyone");
    const hosts = r.body.slot_hosts as Record<string, Row>;
    expect(hosts[`${day(FAR)}T10:00:00+03:00`]).toEqual({ user_id: "G-closer", name: "Sami Closer" });
  });

  test("booking with anyone (a setter booking a demo): far tiles named; no custom host until one is picked", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD2, kind: "demo" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ with: "anyone", far: { state: "ok" }, custom: { host: null }, host_hours: null, reschedule_link: null });
    expect((r.body.slot_hosts as Record<string, Row>)[`${day(FAR + 1)}T14:00:00+03:00`]).toEqual({ user_id: "G-closer", name: "Sami Closer" });
  });

  test("HighLevel's extended answer lacks a time the host's hours allow: not offered", async () => {
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO });
    expect(all(r.body)).not.toContain(at(FAR, "12:00"));
  });

  test("HighLevel's extended answer unreadable: the host's own times, said as not agreed", async () => {
    hl.fails.extended = true;
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO });
    expect(r.body.far).toMatchObject({ state: "ok", agreed: false });
    expect(all(r.body)).toContain(at(FAR, "12:00"));
  });

  test("a blocked hour (a Google event) and another call are not offered", async () => {
    hl.fails.extended = true;
    hl.blocks.push({ userId: "G-closer", start: at(FAR, "12:00"), end: at(FAR, "12:30") });
    hl.add({ id: "other-call", contactId: "someone", calendarId: FOLLOW_CAL, start: at(FAR, "14:00"), assignedUserId: "G-closer" });
    const r = await call("closer", { action: "book.slots", appointment_id: DEMO });
    const t = all(r.body);
    expect(t).not.toContain(at(FAR, "12:00"));
    expect(t).not.toContain(at(FAR, "14:00"));
    expect(t).toContain(at(FAR, "15:00"));
  });
});

describe("book.create and book.move past the booking page", () => {
  test("book.create far: ignoreDateRange on, HighLevel's slot check on, the host named; audited", async () => {
    const r = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "10:00")), note: "After their trip." });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, placement: "far_out", reschedule_link: null });
    expect(hl.posts[0]).toMatchObject({ assignedUserId: "G-closer", ignoreDateRange: true, ignoreFreeSlotValidation: false });
    const a = auditOf("book.create")[0] as Row;
    expect(a.metadata).toMatchObject({
      placement: "far_out",
      window_until: day(2),
      reach_days: 60,
      flags: { ignoreDateRange: true, ignoreFreeSlotValidation: false },
      agreed_by_highlevel: true,
    });
    await settleBackground();
  });

  test("book.create inside the window: exactly as before (both flags off)", async () => {
    const r = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(1, "10:00")), note: "Tomorrow." });
    expect(r.body).toMatchObject({ verified: true, placement: "window" });
    expect(hl.posts[0]).toMatchObject({ ignoreDateRange: false, ignoreFreeSlotValidation: false, assignedUserId: "G-closer" });
    expect((auditOf("book.create")[0] as Row).metadata).toMatchObject({ placement: "window", flags: { ignoreDateRange: false, ignoreFreeSlotValidation: false } });
    await settleBackground();
  });

  test("book.create far, refused when HighLevel's extended answer lacks the time; past the reach refused", async () => {
    const r = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "12:00")), note: "Noon." });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("taken");
    const far = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(70, "10:00")), note: "Later." });
    expect(far.status).toBe(400);
    expect(far.body).toMatchObject({ code: "beyond_reach", error: `Pick a day up to ${dayWords(day(59))}.` });
    expect(hl.posts).toHaveLength(0);
  });

  test("book.create far with HighLevel's extended answer unreadable: booked on the host's own rule, HighLevel still checks the slot", async () => {
    hl.fails.extended = true;
    const r = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "12:00")), note: "Noon." });
    expect(r.body).toMatchObject({ verified: true, placement: "far_out" });
    expect(hl.posts[0]).toMatchObject({ ignoreFreeSlotValidation: false, ignoreDateRange: true });
    expect((auditOf("book.create")[0] as Row).metadata).toMatchObject({ agreed_by_highlevel: false });
    await settleBackground();
  });

  test("book.create far with anyone: the far tile's host, or the first teammate free", async () => {
    const r = await call("setter", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR + 1, "14:00")), note: "Next week.", with: "anyone" });
    expect(r.body).toMatchObject({ verified: true, placement: "far_out" });
    expect(hl.posts[0]?.assignedUserId).toBe("G-closer");
    expect((await call("setter", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "10:00")), note: "Later.", user_id: "G-stranger" })).body.code).toBe("host");
    await settleBackground();
  });

  test("book.create with the host's calendar unread: far_unread, nothing written", async () => {
    hl.fails.blocks = true;
    const r = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "10:00")), note: "Later." });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: "far_unread", error: "Sami's calendar could not be read just now, so that time can't be checked. Try again in a minute." });
    expect(hl.posts).toHaveLength(0);
    expect(db.t("cockpit_sales_bookings")).toHaveLength(0);
  });

  test("book.move far: the PUT carries ignoreDateRange, HighLevel's slot check stays on; the audit says so", async () => {
    const r = await move("closer", at(FAR, "11:00"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: "moved", placement: "far_out", reschedule_link: null });
    expect(hl.puts[0]?.body).toMatchObject({ assignedUserId: "G-closer", ignoreDateRange: true, ignoreFreeSlotValidation: false, toNotify: true });
    expect(hl.appts.get(DEMO)?.start).toBe(at(FAR, "11:00"));
    const a = auditOf("book.move").find(x => (x.after as Row).state === "moved") as Row;
    expect(a.metadata).toMatchObject({ placement: "far_out", window_until: day(2), reach_days: 60, agreed_by_highlevel: true, verified: true });
    await settleBackground(() => hl.notes.length > 0);
  });

  test("book.move inside the window: the PUT exactly as before", async () => {
    const r = await move("closer", at(2, "11:00"));
    expect(r.body).toMatchObject({ result: "moved", placement: "window" });
    expect(hl.puts[0]?.body).toEqual({
      calendarId: DEMO_CAL,
      startTime: iso(at(2, "11:00")),
      endTime: iso(at(2, "11:45")),
      assignedUserId: "G-closer",
      ignoreFreeSlotValidation: false,
      toNotify: true,
    });
    await settleBackground(() => hl.notes.length > 0);
  });

  test("a far time HighLevel refuses at the write: failed, said, audited with the placement", async () => {
    hl.putMode = "refuse";
    const r = await move("closer", at(FAR, "10:00"));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("refused");
    const a = auditOf("book.move").find(x => (x.after as Row).state === "failed") as Row;
    expect(a.metadata).toMatchObject({ placement: "far_out", flags: { ignoreDateRange: true, ignoreFreeSlotValidation: false } });
  });
});

describe("a custom time", () => {
  test("book.move custom: both flags, the host always named, the clash re-read right before the write", async () => {
    const r = await move("closer", at(FAR, "10:05"), { custom: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: "moved", placement: "custom" });
    expect(hl.puts[0]?.body).toMatchObject({ assignedUserId: "G-closer", ignoreDateRange: true, ignoreFreeSlotValidation: true });
    const a = auditOf("book.move").find(x => (x.after as Row).state === "moved") as Row;
    expect(a.metadata).toMatchObject({ placement: "custom", outside_hours: false, flags: { ignoreDateRange: true, ignoreFreeSlotValidation: true } });
    expect(typeof (a.metadata as Row).host_checked_at).toBe("string");
    // Two reads of the host's calls: the check, and again right before the PUT.
    const reads = hl.calls.filter(c => c.path.startsWith("/calendars/events?"));
    expect(reads.length).toBeGreaterThanOrEqual(2);
    const lastRead = hl.calls.lastIndexOf(reads[reads.length - 1] as (typeof hl.calls)[number]);
    const put = hl.calls.findIndex(c => c.method === "PUT" && c.path.startsWith("/calendars/events/appointments/"));
    expect(lastRead).toBeLessThan(put);
    await settleBackground(() => hl.notes.length > 0);
  });

  test("on top of the host's busy time or another call: 409 host_busy, nothing written", async () => {
    hl.blocks.push({ userId: "G-closer", start: at(FAR, "15:00"), end: at(FAR, "15:30") });
    hl.add({ id: "x-call", contactId: "someone", calendarId: INTRO_CAL, start: at(FAR, "13:00"), assignedUserId: "G-closer" });
    const busy = await move("closer", at(FAR, "15:10"), { custom: true });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ code: "host_busy", error: "Sami's calendar is busy from 3:00 pm to 3:30 pm (Kuwait time). Pick another time." });
    const call2 = await move("closer", at(FAR, "13:15"), { custom: true });
    expect(call2.body).toMatchObject({ code: "host_busy", error: "Sami has another call from 1:00 pm to 1:15 pm (Kuwait time). Pick another time." });
    expect(hl.puts).toHaveLength(0);
    expect(db.t("cockpit_sales_reschedules")).toHaveLength(0);
  });

  test("a clash that appears between the check and the write: refused, the move settled failed", async () => {
    const real = hl.answer.bind(hl);
    let reads = 0;
    hl.answer = (m, p, b) => {
      if (m === "GET" && p.startsWith("/calendars/blocked-slots?") && ++reads === 2)
        hl.blocks.push({ userId: "G-closer", start: at(FAR, "10:00"), end: at(FAR, "11:00") });
      return real(m, p, b);
    };
    const r = await move("closer", at(FAR, "10:05"), { custom: true });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("host_busy");
    expect(hl.puts).toHaveLength(0);
    expect(db.t("cockpit_sales_reschedules")[0]?.state).toBe("failed");
    expect((auditOf("book.move")[0] as Row).metadata).toMatchObject({ placement: "custom" });
  });

  test("outside working hours: 409 with the hours, then Book anyway keeps it and the audit says so", async () => {
    const r = await move("closer", at(FAR, "20:00"), { custom: true });
    expect(r.status).toBe(409);
    const weekday = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][new Date(`${day(FAR)}T00:00:00Z`).getUTCDay()];
    expect(r.body).toMatchObject({
      code: "outside_hours",
      hours_words: "9:00 am to 6:00 pm",
      error: `That's outside Sami's working hours (9:00 am to 6:00 pm on ${weekday}). Press Book anyway to keep it, or pick another time.`,
    });
    expect(hl.puts).toHaveLength(0);
    const ok = await move("closer", at(FAR, "20:00"), { custom: true, outside_hours_ok: true });
    expect(ok.body).toMatchObject({ result: "moved", placement: "custom" });
    const a = auditOf("book.move").find(x => (x.after as Row).state === "moved") as Row;
    expect(a.metadata).toMatchObject({ placement: "custom", outside_hours: true });
    await settleBackground(() => hl.notes.length > 0);
  });

  test("past, off the 5-minute mark, beyond the reach, and a call with no host", async () => {
    const soon = Math.ceil((Date.now() + 2 * MIN) / (5 * MIN)) * 5 * MIN;
    expect((await move("closer", soon, { custom: true })).body.code).toBe("past");
    expect((await move("closer", at(FAR, "10:03"), { custom: true })).body.code).toBe("step");
    expect((await move("closer", at(70, "10:00"), { custom: true })).body.code).toBe("beyond_reach");
    (hl.appts.get(DEMO) as { assignedUserId: string | null }).assignedUserId = null;
    (db.t("cockpit_sales_appointments").find(a => a.appointment_id === DEMO) as Row).assigned_user_id = null;
    const r = await call("setter", { action: "book.move", appointment_id: DEMO, start: iso(at(FAR, "10:05")), custom: true, request_id: press() });
    expect(r.body).toMatchObject({ code: "host_needed", error: "Pick who takes the call." });
    expect(hl.puts).toHaveLength(0);
  });

  test("on top of the lead's own other call: the clash refusal, as for any time", async () => {
    hl.add({ id: "lead-intro", contactId: LEAD, calendarId: INTRO_CAL, start: at(FAR, "10:00"), assignedUserId: "G-setter" });
    const r = await move("closer", at(FAR, "10:05"), { custom: true });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("clash");
    expect(hl.puts).toHaveLength(0);
  });

  test("a custom time that is one of HighLevel's own offered times goes as a window time (both flags off)", async () => {
    const r = await move("closer", at(2, "11:00"), { custom: true });
    expect(r.body).toMatchObject({ result: "moved", placement: "window" });
    expect(hl.puts[0]?.body.ignoreFreeSlotValidation).toBe(false);
    expect(hl.puts[0]?.body.ignoreDateRange).toBeUndefined();
    await settleBackground(() => hl.notes.length > 0);
  });

  test("book.create custom: HighLevel would refuse it without the host (422), so the host is always sent", async () => {
    const r = await call("closer", { action: "book.create", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "16:35")), note: "Their time.", custom: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, placement: "custom" });
    expect(hl.posts[0]).toMatchObject({ assignedUserId: "G-closer", ignoreDateRange: true, ignoreFreeSlotValidation: true });
    const a = auditOf("book.create")[0] as Row;
    expect(a.metadata).toMatchObject({ placement: "custom", outside_hours: false, reach_days: 60 });
    // A setter not on the demo calendar names who takes it.
    const s = await call("setter", { action: "book.create", contact_id: CLIENT, kind: "demo", start: iso(at(FAR, "16:35")), note: "Their time.", custom: true });
    expect(s.body.code).toBe("client");
    await settleBackground();
  });
});

describe("book.check: the custom time's live line", () => {
  const check = (seat: "closer" | "other", start: number, over: Row = {}) => call(seat, { action: "book.check", appointment_id: DEMO, start: iso(start), ...over });

  test("free, busy, outside, a window time, and the refusals in words", async () => {
    hl.blocks.push({ userId: "G-closer", start: at(FAR, "15:00"), end: at(FAR, "15:30") });
    const free = await check("closer", at(FAR, "10:05"));
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({
      start: iso(at(FAR, "10:05")),
      host: { user_id: "G-closer", name: "Sami Closer" },
      placement: "custom",
      clash: null,
      outside_hours: false,
      hours_words: "9:00 am to 6:00 pm",
      beyond_reach: false,
      past: false,
      step: false,
      line: "Free for Sami, inside working hours.",
    });
    const busy = await check("closer", at(FAR, "15:10"));
    expect(busy.body).toMatchObject({
      clash: { start: iso(at(FAR, "15:00")), end: iso(at(FAR, "15:30")), what: "busy" },
      line: "Sami's calendar is busy from 3:00 pm to 3:30 pm (Kuwait time). Pick another time.",
    });
    const out = await check("closer", at(FAR, "20:00"));
    expect(out.body.outside_hours).toBe(true);
    expect(String(out.body.line)).toStartWith("That's outside Sami's working hours (9:00 am to 6:00 pm on ");
    expect((await check("closer", at(2, "11:00"))).body).toMatchObject({ placement: "window", outside_hours: false });
    expect((await check("closer", at(FAR, "10:03"))).body).toMatchObject({ step: true, line: "Pick a time on the 5-minute mark." });
    expect((await check("closer", at(70, "10:00"))).body).toMatchObject({ beyond_reach: true, line: `Pick a day up to ${dayWords(day(59))}.` });
    // Reading only: nothing written anywhere.
    expect(hl.puts).toHaveLength(0);
    expect(hl.posts).toHaveLength(0);
  });

  test("gated as book.slots is; a booking with nobody named asks who", async () => {
    expect((await check("other", at(FAR, "10:05"))).body.code).toBe("not_yours");
    const r = await call("setter", { action: "book.check", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "10:05")) });
    expect(r.body).toMatchObject({ host: null, line: "Pick who takes the call." });
    const named = await call("setter", { action: "book.check", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "10:05")), user_id: "G-closer" });
    expect(named.body.line).toBe("Free for Sami, inside working hours.");
  });
});

describe("the lead's own reschedule link", () => {
  const LINK = (cal: string, id: string) => `https://link.maharamedia.com/widget/booking/${cal}?event_id=${id}`;

  test("book.slots: on an intro and a Follow up call, after the gate; never for a demo or a booking", async () => {
    const intro = await call("setter", { action: "book.slots", appointment_id: INTRO });
    expect(intro.body.reschedule_link).toBe(LINK(INTRO_CAL, INTRO));
    const follow = await call("closer", { action: "book.slots", appointment_id: FOLLOW });
    expect(follow.body.reschedule_link).toBe(LINK(FOLLOW_CAL, FOLLOW));
    expect((await call("closer", { action: "book.slots", appointment_id: DEMO })).body.reschedule_link).toBeNull();
    const refused = await call("other", { action: "book.slots", appointment_id: INTRO });
    expect(refused.body.code).toBe("not_yours");
    expect(refused.body.reschedule_link).toBeUndefined();
    expect((await call("closer", { action: "book.slots", contact_id: LEAD2, kind: "follow_up" })).body.reschedule_link).toBeNull();
  });

  test("book.move and book.create answer with it where the calendar allows it", async () => {
    const moved = await call("closer", { action: "book.move", appointment_id: FOLLOW, start: iso(at(FAR, "10:00")), reason: "they_asked", request_id: press(), custom: true });
    expect(moved.body).toMatchObject({ result: "moved", reschedule_link: LINK(FOLLOW_CAL, FOLLOW) });
    const made = await call("closer", { action: "book.create", contact_id: LEAD, kind: "follow_up", start: iso(at(FAR + 1, "14:00")), note: "Check in.", custom: true });
    expect(made.body.verified).toBe(true);
    const id = String((made.body.appointment as Row).id);
    expect(made.body.reschedule_link).toBe(LINK(FOLLOW_CAL, id));
    await settleBackground(() => hl.notes.length > 0);
  });

  test("book.links: the lead page's rows, for the calls this seat may reschedule", async () => {
    const setter = await call("setter", { action: "book.links", contact_id: LEAD2 });
    expect(setter.body.links).toEqual({ [INTRO]: LINK(INTRO_CAL, INTRO) });
    const closer = await call("closer", { action: "book.links", contact_id: LEAD2 });
    expect(closer.body.links).toEqual({ [FOLLOW]: LINK(FOLLOW_CAL, FOLLOW) });
    // A demo has no link; another seat's calls none; a call marked over none.
    expect((await call("closer", { action: "book.links", contact_id: LEAD })).body.links).toEqual({});
    expect((await call("other", { action: "book.links", contact_id: LEAD2 })).body.links).toEqual({});
    db.seed("cockpit_sales_dispositions", [{ appointment_id: INTRO, contact_id: LEAD2, status: "cancelled", marked_by: SETTER, superseded_at: null }]);
    expect((await call("setter", { action: "book.links", contact_id: LEAD2 })).body.links).toEqual({});
    expect((await call("setter", { action: "book.links", contact_id: CLIENT })).body).toMatchObject({ links: {}, client: true });
  });
});
