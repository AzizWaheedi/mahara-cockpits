// bun test --timeout 30000 supabase/functions/sales-api/closer_pick_router.test.ts
//
// The demo's closer picker (2026-11-07, closers.ts), through sales-api's own
// door (index.ts Deno.serve). The CEO, verbatim: "He should also be able to
// pick the specific closer he wants to book the demo on their calendar
// for." book.slots with `closers: true` (the list, each with their soonest
// time) and `closer_id` (that closer's own times), book.check and
// book.create with `closer_id`, the refusals, and the pin that a request
// without the new fields reads and writes exactly as before.
//
// HighLevel is testfakes.ts FakeHighLevel with its public window on (it
// honours userId on free-slots); the database is FakeDb. Nothing leaves this
// process; every lead, seat and time is invented.

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closerOrder, closerRefusal, closersOn, soonestOf } from "./closers.ts";
import { addDays, dayStartMs } from "./farout.ts";
import type { DbError } from "./liveio.ts";
import { kuwaitDay } from "./reschedule.ts";
import { CALENDARS_SETTING, FakeDb, FakeHighLevel } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.closerpick.invalid";
const GHL = "https://services.leadconnectorhq.com";
const MIN = 60_000;

const DEMO_CAL = "jQqXS1YuFnmGZKLkrE62";
const INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI";
const FOLLOW_CAL = "JTNg1Wd62qxuT8W8sroh";

const SETTER = "pick-setter@stress.invalid";
const CLOSER = "pick-closer@stress.invalid";
const LEAD = "pick-lead-hana";
const LEAD2 = "pick-lead-yara";

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
  "seat-closer": { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" },
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
    SUPABASE_SERVICE_ROLE_KEY: "service-closerpick",
    SUPABASE_ANON_KEY: "anon-closerpick",
    SALES_GHL_TOKEN: "ghl-closerpick",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?closer_pick_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(seat: "setter" | "closer", body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const res = await handler(
    new Request("https://fn.closerpick.invalid/sales-api", {
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
const kw = (t: number) => `${new Date(t + 3 * 3_600_000).toISOString().slice(0, 19)}+03:00`;
const all = (r: Row) => (r.days as { slots: string[] }[]).flatMap(d => d.slots.map(s => Date.parse(s)));
const press = () => crypto.randomUUID();

const EVERY_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(d => ({
  type: "wday",
  day: d,
  intervals: [{ from: "09:00", to: "18:00" }],
}));

// Five days out: past the Demo calendar's three-day booking page.
const FAR = 5;

/** The free-slots reads of the Demo calendar's own window (not the extended reads past it). */
const windowReads = () =>
  hl.calls.filter(c => c.method === "GET" && c.path.startsWith(`/calendars/${DEMO_CAL}/free-slots?`) && !c.path.includes("ignoreDateRange"));
const userOf = (path: string) => new URLSearchParams(path.split("?")[1] ?? "").get("userId");
const auditOf = (action: string) => db.t("cockpit_audit_log").filter(a => a.action === action);

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
    { email: "pick-rana@stress.invalid", name: "Rana Both", role: "both", ghl_user_id: "G-both", active: true },
    // The CEO's HighLevel user on two manager seats: listed once.
    { email: "pick-boss@stress.invalid", name: "Aziz Boss", role: "manager", ghl_user_id: "G-aziz", active: true },
    { email: "pick-boss2@stress.invalid", name: "Aziz Second", role: "manager", ghl_user_id: "G-aziz", active: true },
    // A leaver still on the Demo calendar's team in HighLevel.
    { email: "pick-lina@stress.invalid", name: "Lina Left", role: "closer", ghl_user_id: "G-leaver", active: false },
    // A setter on the Demo calendar's team: not a closer.
    { email: "pick-sara@stress.invalid", name: "Sara Two", role: "setter", ghl_user_id: "G-setter2", active: true },
    // A closer who is not on the Demo calendar's team.
    { email: "pick-omar@stress.invalid", name: "Omar Outside", role: "closer", ghl_user_id: "G-outside", active: true },
  ]);
  db.seed("cockpit_sales_leads", [
    { contact_id: LEAD, name: "Hana Al Ali", phone: "+96550000011", lead_class: "qualified", assigned_to: "G-setter", tags: [], dnd: false },
    { contact_id: LEAD2, name: "Yara Al Saleh", phone: "+96550000012", lead_class: "qualified", assigned_to: "G-setter", tags: [], dnd: false },
  ]);
  // The Demo calendar's team in HighLevel's order: the manager user first.
  hl.calendar(DEMO_CAL, ["G-aziz", "G-closer", "G-leaver", "G-setter2", "G-both"]);
  hl.calendar(INTRO_CAL, ["G-setter"]);
  hl.calendar(FOLLOW_CAL, ["G-closer", "G-aziz"]);
  hl.schedules = [
    { id: "s-closer", userId: "G-closer", calendarIds: [DEMO_CAL, FOLLOW_CAL], rules: EVERY_DAY, timezone: "Asia/Kuwait", deleted: false },
    { id: "s-both", userId: "G-both", calendarIds: [DEMO_CAL], rules: EVERY_DAY, timezone: "Asia/Kuwait", deleted: false },
    { id: "s-aziz", userId: "G-aziz", calendarIds: [], rules: EVERY_DAY, timezone: "Asia/Kuwait", deleted: false },
  ];
  // Inside the window: HighLevel's own times per person.
  hl.free.set("G-closer", [at(1, "10:00"), at(2, "11:00")]);
  hl.free.set("G-both", [at(1, "12:00"), at(2, "14:00")]);
  hl.free.set("G-leaver", [at(1, "09:00")]);
  hl.free.set("G-setter2", [at(1, "08:00")]);
  hl.extFree.set("G-both", [at(1, "12:00"), at(2, "14:00"), at(FAR, "10:00"), at(FAR, "11:00")]);
  hl.extFree.set("G-closer", [at(1, "10:00"), at(2, "11:00"), at(FAR, "10:00")]);
});

describe("closers.ts, the pure rules", () => {
  const seats = [
    { ghl_user_id: "A", name: "Sami Kareem", role: "closer", active: true },
    { ghl_user_id: "B", name: "Sami Nasser", role: "both", active: true },
    { ghl_user_id: "C", name: "Aziz Boss", role: "manager", active: true },
    { ghl_user_id: "C", name: "Aziz Boss", role: "manager", active: true },
    { ghl_user_id: "D", name: "Lina Left", role: "closer", active: false },
    { ghl_user_id: "E", name: "Sara Two", role: "setter", active: true },
  ];

  test("closersOn: closers before managers, a leaver and a setter left out, one user once, same first names with a last initial", () => {
    expect(closersOn(["C", "A", "D", "E", "B", "A"], seats)).toEqual([
      { user_id: "A", name: "Sami Kareem", kind: "closer", first: "Sami K." },
      { user_id: "B", name: "Sami Nasser", kind: "closer", first: "Sami N." },
      { user_id: "C", name: "Aziz Boss", kind: "manager", first: "Aziz" },
    ]);
  });

  test("a user with a manager and a closer seat lists as a closer", () => {
    const both = [
      { ghl_user_id: "C", name: "Aziz Boss", role: "manager", active: true },
      { ghl_user_id: "C", name: "Aziz Closing", role: "closer", active: true },
    ];
    expect(closersOn(["C"], both)).toEqual([{ user_id: "C", name: "Aziz Closing", kind: "closer", first: "Aziz" }]);
  });

  test("closerOrder: soonest first in a group, no time next, a failed read last; managers after closers", () => {
    const rows = [
      { user_id: "M", kind: "manager" as const, soonest: "2026-11-08T09:00:00+03:00", state: "ok" as const },
      { user_id: "U", kind: "closer" as const, soonest: null, state: "unread" as const },
      { user_id: "N", kind: "closer" as const, soonest: null, state: "ok" as const },
      { user_id: "L", kind: "closer" as const, soonest: "2026-11-09T10:00:00+03:00", state: "ok" as const },
      { user_id: "S", kind: "closer" as const, soonest: "2026-11-08T16:30:00+03:00", state: "ok" as const },
    ];
    expect(closerOrder(rows).map(r => r.user_id)).toEqual(["S", "L", "N", "U", "M"]);
  });

  test("soonestOf: the first start still ahead, as HighLevel wrote it", () => {
    const now = Date.parse("2026-11-08T08:00:00+03:00");
    expect(
      soonestOf(
        [
          { slots: ["2026-11-08T07:00:00+03:00", "2026-11-08T11:00:00+03:00"] },
          { slots: ["2026-11-08T09:00:00+03:00"] },
        ],
        now,
      ),
    ).toBe("2026-11-08T09:00:00+03:00");
    expect(soonestOf([], now)).toBeNull();
  });

  test("closerRefusal: the sentences and codes", () => {
    const team = ["A", "C", "D", "E"];
    expect(closerRefusal({ id: "A", kind: "demo", team, seats })).toBeNull();
    expect(closerRefusal({ id: "A", kind: "intro", team, seats })).toEqual({
      code: "host",
      status: 400,
      message: "Only a demo can go on a picked closer's calendar.",
    });
    expect(closerRefusal({ id: "B", kind: "demo", team, seats })).toEqual({
      code: "host",
      status: 409,
      message: "Sami is not on the Demo calendar in HighLevel. Pick another closer, or Anyone free.",
    });
    expect(closerRefusal({ id: "Z", kind: "demo", team: [...team, "Z"], seats })?.code).toBe("not_closer");
    expect(closerRefusal({ id: "D", kind: "demo", team, seats })).toEqual({
      code: "not_closer",
      status: 409,
      message: "Lina has no active closer or manager seat in the cockpit, so the demo can't go on their calendar. Pick another closer, or Anyone free.",
    });
    expect(closerRefusal({ id: "E", kind: "demo", team, seats })?.code).toBe("not_closer");
    expect(closerRefusal({ id: "A", kind: "demo", team, seats, userId: "C" })).toEqual({
      code: "host",
      status: 400,
      message: "That time is another closer's. Pick one of Sami's times.",
    });
    expect(closerRefusal({ id: "A", kind: "demo", team, seats, userId: "A" })).toBeNull();
  });
});

describe("book.slots without the new fields: exactly as before", () => {
  test("a setter's demo read: the round robin's times (free-slots with no userId), the whole team under Custom time, no closers", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo" });
    expect(r.status).toBe(200);
    expect(r.body.with).toBe("anyone");
    expect("closers" in r.body).toBe(false);
    expect("closer" in r.body).toBe(false);
    // One window read, for the whole calendar: HighLevel's round robin picks.
    expect(windowReads().map(c => userOf(c.path))).toEqual([null]);
    // Every team member's free start, the leaver's and the setter's included, as HighLevel's union gives them.
    expect(all(r.body).filter(t => t < dayStartMs(day(3)))).toEqual([
      at(1, "08:00"),
      at(1, "09:00"),
      at(1, "10:00"),
      at(1, "12:00"),
      at(2, "11:00"),
      at(2, "14:00"),
    ]);
    expect((r.body.custom as Row).hosts).toEqual([
      { user_id: "G-aziz", name: "Aziz Boss" },
      { user_id: "G-closer", name: "Sami Closer" },
      { user_id: "G-leaver", name: "Lina Left" },
      { user_id: "G-setter2", name: "Sara Two" },
      { user_id: "G-both", name: "Rana Both" },
    ]);
    // No seats read for the picker.
    expect(db.calls.some(c => c.path.includes("select=ghl_user_id,name,role,active"))).toBe(false);
  });

  test("closers: true adds the list and the closers-only Custom time list; the tiles and everything else are the same", async () => {
    // A HighLevel read's path without its clock-dependent numbers.
    const shape = (p: string) => p.replace(/(start|end)(Date|Time)=\d+/g, "$1$2=T");
    const plain = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo" });
    const plainCalls = hl.calls.map(c => shape(c.path));
    hl.calls = [];
    const listed = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closers: true });
    expect(listed.status).toBe(200);
    const strip = (r: Row) => {
      const { closers: _c, custom, ...rest } = r;
      return { ...rest, custom: { ...(custom as Row), hosts: null } };
    };
    expect(strip(listed.body)).toEqual(strip(plain.body));
    // The same HighLevel reads, plus one free-slots read per listed closer.
    const extra = hl.calls.map(c => shape(c.path));
    for (const p of plainCalls) {
      const i = extra.indexOf(p);
      expect(i).toBeGreaterThanOrEqual(0);
      extra.splice(i, 1);
    }
    expect(extra.map(p => [p.split("?")[0], userOf(p)]).sort()).toEqual([
      [`/calendars/${DEMO_CAL}/free-slots`, "G-aziz"],
      [`/calendars/${DEMO_CAL}/free-slots`, "G-both"],
      [`/calendars/${DEMO_CAL}/free-slots`, "G-closer"],
    ]);
    expect((listed.body.custom as Row).hosts).toEqual([
      { user_id: "G-closer", name: "Sami Closer" },
      { user_id: "G-both", name: "Rana Both" },
      { user_id: "G-aziz", name: "Aziz Boss" },
    ]);
  });
});

describe("book.slots with closers: true", () => {
  test("only the team's active closer, both and manager seats; closers first, soonest first; a leaver out; one user on two seats once", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closers: true });
    expect(r.body.closers).toEqual([
      { user_id: "G-closer", name: "Sami Closer", kind: "closer", soonest: kw(at(1, "10:00")), state: "ok" },
      { user_id: "G-both", name: "Rana Both", kind: "closer", soonest: kw(at(1, "12:00")), state: "ok" },
      { user_id: "G-aziz", name: "Aziz Boss", kind: "manager", soonest: null, state: "ok" },
    ]);
  });

  test("the soonest time first within closers", async () => {
    hl.free.set("G-both", [at(1, "09:30")]);
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closers: true });
    expect((r.body.closers as Row[]).map(c => c.user_id)).toEqual(["G-both", "G-closer", "G-aziz"]);
  });

  test("a closer whose free slots could not be read is unread, never 'no free time'", async () => {
    const real = hl.answer.bind(hl);
    hl.answer = (method, path, body) =>
      method === "GET" && path.includes("/free-slots?") && path.includes("userId=G-closer") && !path.includes("ignoreDateRange")
        ? { status: 500, body: { message: "Internal server error" } }
        : real(method, path, body);
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closers: true });
    expect(r.status).toBe(200);
    expect(r.body.closers).toEqual([
      { user_id: "G-both", name: "Rana Both", kind: "closer", soonest: kw(at(1, "12:00")), state: "ok" },
      { user_id: "G-closer", name: "Sami Closer", kind: "closer", soonest: null, state: "unread" },
      { user_id: "G-aziz", name: "Aziz Boss", kind: "manager", soonest: null, state: "ok" },
    ]);
    // The round robin's tiles still came.
    expect(all(r.body).length).toBeGreaterThan(0);
  });

  test("the seats unread: the tiles as today, the list null (said, never empty); a closer_id is refused 503", async () => {
    const real = db.db.bind(db);
    db.db = (path, opts) =>
      path.includes("select=ghl_user_id,name,role,active")
        ? Promise.reject(Object.assign(new Error("database 503: down"), { status: 503 }))
        : real(path, opts);
    try {
      const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closers: true });
      expect(r.status).toBe(200);
      expect(r.body.closers).toBeNull();
      expect(all(r.body).length).toBeGreaterThan(0);
      const one = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-both" });
      expect(one.status).toBe(503);
      expect(one.body.code).toBe("unread");
    } finally {
      db.db = real;
    }
  });
});

describe("book.slots with closer_id", () => {
  test("every window read carries the closer; the days are theirs, every time named, Custom time fixed to them", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-both" });
    expect(r.status).toBe(200);
    expect(windowReads().map(c => userOf(c.path))).toEqual(["G-both"]);
    const times = all(r.body);
    expect(times.filter(t => t < dayStartMs(day(3)))).toEqual([at(1, "12:00"), at(2, "14:00")]);
    // Past the booking page: Rana's own far times, no one else's calendar read.
    expect(times).toContain(at(FAR, "10:00"));
    expect(hl.calls.filter(c => c.path.startsWith("/calendars/events?")).map(c => userOf(c.path))).toEqual(["G-both"]);
    const hosts = r.body.slot_hosts as Record<string, Row>;
    for (const d of r.body.days as { slots: string[] }[])
      for (const s of d.slots) expect(hosts[s]).toEqual({ user_id: "G-both", name: "Rana Both" });
    expect(r.body).toMatchObject({
      closer: { user_id: "G-both", name: "Rana Both" },
      custom: { host: { user_id: "G-both", name: "Rana Both" } },
      host_hours: { user_id: "G-both" },
      far: { state: "ok" },
    });
    expect("closers" in r.body).toBe(false);
  });

  test("with closers: true too, the list comes and the closer's own read is not made twice", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-both", closers: true });
    expect((r.body.closers as Row[]).map(c => [c.user_id, c.soonest])).toEqual([
      ["G-closer", kw(at(1, "10:00"))],
      ["G-both", kw(at(1, "12:00"))],
      ["G-aziz", null],
    ]);
    expect(
      windowReads()
        .map(c => userOf(c.path))
        .sort(),
    ).toEqual(["G-aziz", "G-both", "G-closer"]);
  });

  test("a later page (from) reads the closer's times only", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-both", from: day(14) });
    expect(r.status).toBe(200);
    expect((r.body.page as Row).from).toBe(day(14));
    expect(windowReads().map(c => userOf(c.path))).toEqual(["G-both"]);
  });
});

describe("the refusals", () => {
  test("not on the Demo calendar's team: 409 host, named", async () => {
    const r = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-outside" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "host", error: "Omar is not on the Demo calendar in HighLevel. Pick another closer, or Anyone free." });
    const nobody = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-nobody" });
    expect(nobody.body).toMatchObject({ code: "host", error: "That person is not on the Demo calendar in HighLevel. Pick another closer, or Anyone free." });
    // Refused before any free time is read.
    expect(windowReads()).toHaveLength(0);
  });

  test("a leaver's seat, or a setter's: 409 not_closer", async () => {
    const left = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-leaver" });
    expect(left.status).toBe(409);
    expect(left.body).toMatchObject({
      code: "not_closer",
      error: "Lina has no active closer or manager seat in the cockpit, so the demo can't go on their calendar. Pick another closer, or Anyone free.",
    });
    const setter = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "demo", closer_id: "G-setter2" });
    expect(setter.body.code).toBe("not_closer");
    expect(windowReads()).toHaveLength(0);
  });

  test("not a demo: 400 host, for the list and for a closer", async () => {
    const one = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "intro", closer_id: "G-closer" });
    expect(one.status).toBe(400);
    expect(one.body).toMatchObject({ code: "host", error: "Only a demo can go on a picked closer's calendar." });
    const list = await call("setter", { action: "book.slots", contact_id: LEAD, kind: "intro", closers: true });
    expect(list.status).toBe(400);
    const create = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "intro",
      closer_id: "G-closer",
      start: iso(at(1, "10:00")),
      note: "Intro.",
      request_id: press(),
    });
    expect(create.status).toBe(400);
    expect(hl.posts).toHaveLength(0);
  });

  test("book.create refuses the same way, and nothing is written", async () => {
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      closer_id: "G-leaver",
      start: iso(at(1, "09:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("not_closer");
    expect(hl.posts).toHaveLength(0);
    expect(db.t("cockpit_sales_bookings")).toHaveLength(0);
  });
});

describe("book.create with closer_id", () => {
  test("in the window: assignedUserId is the closer, HighLevel's checks on; the row, the copy and the owner are theirs; audited", async () => {
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      with: "anyone",
      closer_id: "G-both",
      user_id: "G-both",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
      source: "dialer",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, placement: "window", owner: "G-both" });
    expect(hl.posts).toHaveLength(1);
    expect(hl.posts[0]).toMatchObject({ calendarId: DEMO_CAL, assignedUserId: "G-both", ignoreDateRange: false, ignoreFreeSlotValidation: false });
    // The window judged by Rana's own free times.
    expect(windowReads().map(c => userOf(c.path))).toEqual(["G-both"]);
    expect(db.t("cockpit_sales_bookings")[0]).toMatchObject({ state: "booked", assigned_user_id: "G-both" });
    expect(db.t("cockpit_sales_appointments")[0]).toMatchObject({ contact_id: LEAD, call_type: "demo", assigned_user_id: "G-both" });
    expect((r.body.appointment as Row).host_name).toBe("Rana Both");
    await settleBackground(() => hl.calls.some(c => c.method === "PUT" && c.path === `/contacts/${LEAD}`));
    expect(hl.calls.find(c => c.method === "PUT" && c.path === `/contacts/${LEAD}`)?.body).toEqual({ assignedTo: "G-both" });
    expect((auditOf("book.create")[0] as Row).metadata).toMatchObject({
      closer_picked: true,
      closer_id: "G-both",
      owner: "G-both",
      placement: "window",
    });
    expect("closer_mismatch" in ((auditOf("book.create")[0] as Row).metadata as Row)).toBe(false);
  });

  test("HighLevel reads back another host than the closer picked: the owner follows the read-back, the audit flags it", async () => {
    const real = hl.answer.bind(hl);
    hl.answer = (method, path, body) => {
      const out = real(method, path, body);
      if (method === "GET" && /^\/calendars\/events\/appointments\/[^/?]+$/.test(path) && out !== "no_answer" && out.status === 200) {
        const b = out.body as Row;
        ((b.appointment ?? b.event ?? b) as Row).assignedUserId = "G-closer";
      }
      return out;
    };
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      with: "anyone",
      closer_id: "G-both",
      user_id: "G-both",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, owner: "G-closer" });
    expect((r.body.appointment as Row).host_name).toBe("Sami Closer");
    expect((auditOf("book.create")[0] as Row).metadata).toMatchObject({ closer_picked: true, closer_id: "G-both", closer_mismatch: true });
    await settleBackground();
  });

  test("without closer_id the audit carries no closer fields and the round robin picks (no assignedUserId), as before", async () => {
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      with: "anyone",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(200);
    expect(hl.posts[0]?.assignedUserId).toBeUndefined();
    expect(windowReads().map(c => userOf(c.path))).toEqual([null]);
    const meta = (auditOf("book.create")[0] as Row).metadata as Row;
    expect("closer_picked" in meta).toBe(false);
    expect("closer_id" in meta).toBe(false);
    await settleBackground();
  });

  test("a time free only for another closer: 409 taken, nothing posted to HighLevel", async () => {
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      closer_id: "G-both",
      start: iso(at(1, "10:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "taken", error: "That time was just taken. Pick another." });
    expect(hl.posts).toHaveLength(0);
    expect(db.t("cockpit_sales_bookings")).toHaveLength(0);
  });

  test("HighLevel says the closer's time is gone at the write: 409 taken (the picker reads again), the row failed, audited", async () => {
    const real = hl.answer.bind(hl);
    hl.answer = (method, path, body) => {
      if (method === "POST" && path === "/calendars/events/appointments") {
        hl.posts.push(body as Row);
        return { status: 422, body: { message: "The slot you have selected is no longer available." } };
      }
      return real(method, path, body);
    };
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      closer_id: "G-both",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "taken", error: "That time was just taken. Pick another." });
    expect(db.t("cockpit_sales_bookings")[0]).toMatchObject({ state: "failed" });
    expect((auditOf("book.create")[0] as Row).metadata).toMatchObject({ closer_picked: true, closer_id: "G-both" });
  });

  test("another HighLevel refusal with a closer picked is said in HighLevel's words, not as taken (502 refused)", async () => {
    const real = hl.answer.bind(hl);
    hl.answer = (method, path, body) =>
      method === "POST" && path === "/calendars/events/appointments"
        ? { status: 422, body: { message: "The selected user is not available for this calendar." } }
        : real(method, path, body);
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      closer_id: "G-both",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("refused");
    expect(String(r.body.error)).toContain("The selected user is not available for this calendar.");
  });

  test("the same HighLevel answer without closer_id is HighLevel's refusal, as before (502 refused)", async () => {
    const real = hl.answer.bind(hl);
    hl.answer = (method, path, body) =>
      method === "POST" && path === "/calendars/events/appointments"
        ? { status: 422, body: { message: "The slot you have selected is no longer available." } }
        : real(method, path, body);
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("refused");
  });

  test("closer_id with another host's user_id: 400 host, nothing written", async () => {
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD,
      kind: "demo",
      closer_id: "G-closer",
      user_id: "G-both",
      start: iso(at(2, "14:00")),
      note: "Booked on the call.",
      request_id: press(),
    });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "host", error: "That time is another closer's. Pick one of Sami's times." });
    expect(hl.posts).toHaveLength(0);
    expect(db.t("cockpit_sales_bookings")).toHaveLength(0);
  });

  test("a far-out time: placed on that closer only, HighLevel's slot check on", async () => {
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD2,
      kind: "demo",
      closer_id: "G-both",
      user_id: "G-both",
      start: iso(at(FAR, "10:00")),
      note: "After their trip.",
      request_id: press(),
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, placement: "far_out", owner: "G-both" });
    expect(hl.posts[0]).toMatchObject({ assignedUserId: "G-both", ignoreDateRange: true, ignoreFreeSlotValidation: false });
    // Only Rana's calendar was read for the far time, though Sami is free then too.
    expect(hl.calls.filter(c => c.path.startsWith("/calendars/events?")).map(c => userOf(c.path))).toEqual(["G-both"]);
    expect((auditOf("book.create")[0] as Row).metadata).toMatchObject({ placement: "far_out", closer_picked: true, closer_id: "G-both" });
    await settleBackground();
  });

  test("a custom time: book.check judges the closer's hours, and book.create books it on them", async () => {
    const check = await call("setter", { action: "book.check", contact_id: LEAD2, kind: "demo", closer_id: "G-both", start: iso(at(FAR, "10:05")) });
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ host: { user_id: "G-both", name: "Rana Both" }, outside_hours: false, clash: null, placement: "custom" });
    expect(hl.calls.filter(c => c.path.startsWith("/calendars/events?")).map(c => userOf(c.path))).toEqual(["G-both"]);
    const late = await call("setter", { action: "book.check", contact_id: LEAD2, kind: "demo", closer_id: "G-both", start: iso(at(FAR, "20:00")) });
    expect(late.body).toMatchObject({ host: { user_id: "G-both" }, outside_hours: true });
    expect(String(late.body.line)).toContain("Rana");
    // Without closer_id a setter's check still asks who takes it.
    const plain = await call("setter", { action: "book.check", contact_id: LEAD2, kind: "demo", start: iso(at(FAR, "10:05")) });
    expect(plain.body).toMatchObject({ host: null, line: "Pick who takes the call." });
    const r = await call("setter", {
      action: "book.create",
      contact_id: LEAD2,
      kind: "demo",
      closer_id: "G-both",
      user_id: "G-both",
      custom: true,
      start: iso(at(FAR, "10:05")),
      note: "Their time.",
      request_id: press(),
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ placement: "custom", owner: "G-both" });
    expect(hl.posts[0]).toMatchObject({ assignedUserId: "G-both", ignoreDateRange: true, ignoreFreeSlotValidation: true });
    await settleBackground();
  });

  test("book.check refuses a closer who cannot take a demo, as book.create does", async () => {
    const r = await call("setter", { action: "book.check", contact_id: LEAD2, kind: "demo", closer_id: "G-leaver", start: iso(at(FAR, "10:05")) });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("not_closer");
  });
});
