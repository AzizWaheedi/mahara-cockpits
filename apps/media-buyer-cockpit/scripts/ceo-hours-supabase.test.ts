import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { HoursInputs } from "../src/types/ceo/hoursContract";
import { computeMonth, contextOf, hashPerson } from "../src/types/ceo/hoursModel";
import { WEEK, workingDays } from "./lib/hoursFixtures";
import { ADMIN, actor, call, CEO, hoursTestDb, MEMBER, owner, service } from "./lib/hoursTestDb";
import { migration } from "./lib/cockpitTestDb";

let db: PGlite;
const ids: Record<string, number> = {};

const TABLES = ["cockpit_hours_terms", "cockpit_pay_history", "cockpit_schedule_history", "cockpit_employment_periods", "cockpit_hours_rules",
  "cockpit_leave_types", "cockpit_leave_type_rules", "cockpit_hours_holiday_overrides", "cockpit_time_accounts", "cockpit_hubstaff_days",
  "cockpit_hours_coverage", "cockpit_timetastic_bookings", "cockpit_timetastic_days", "cockpit_time_adjustments", "cockpit_hours_pay_months",
  "cockpit_hours_sync_runs", "cockpit_hours_keys", "cockpit_hours_provider_health"];
const CEO_RPCS = ["cockpit_ceo_hours_inputs('2026-10-01')", "cockpit_ceo_hours_status()", "cockpit_ceo_hours_costs()",
  ...["terms_save", "link", "leave_type_save", "holiday_override", "adjust", "adjust_withdraw", "rules_save", "set_pay", "schedule_save",
    "employment", "key_expiry", "withdraw_approval", "mark_paid"].map(n => `cockpit_ceo_hours_${n}('{}'::jsonb)`)];
const SERVICE_RPCS = ["cockpit_hours_inputs('2026-10-01')", "cockpit_hours_actor('00000000-0000-4000-8000-0000000000c1')", "cockpit_hours_prune()",
  "cockpit_hours_key_get('hubstaff')", "cockpit_hours_account_links('timetastic')", "cockpit_hours_pay_month_approve('00000000-0000-4000-8000-0000000000c1','{}'::jsonb)",
  ...["lease_claim", "lease_renew", "run_finish", "sync_apply", "key_put", "key_exchange_begin", "key_rotate", "key_state"].map(n => `cockpit_hours_${n}('{}'::jsonb)`)];

async function person(name: string, extra: Record<string, unknown>) {
  await actor(db, CEO);
  const r = await call(db, "cockpit_ceo_people_save", { name, startedOn: "2026-01-01", ...extra });
  ids[name] = Number(r.id);
  return ids[name];
}
async function claim(mode = "recent", by = "cron") {
  await service(db);
  return call(db, "cockpit_hours_lease_claim", { mode, requestedBy: by, windowFrom: "2026-10-01", windowTo: "2026-10-31" });
}
async function finish(run: Record<string, unknown>, state = "ok") {
  await service(db);
  return call(db, "cockpit_hours_run_finish", { runId: run.runId, leaseToken: run.leaseToken, state,
    hubstaff: { state: "ok", rows: 1 }, timetastic: { state: "ok", rows: 1 } });
}
async function auditCount(action: string) {
  await owner(db);
  return Number((await db.query<{ n: number }>("select count(*)::int n from cockpit_audit_log where action=$1", [action])).rows[0].n);
}
const OCT = workingDays("2026-10");
const hubRows = (user: string, days: string[], hours = 7) => days.map(day => ({ hubstaffUserId: user, day, trackedS: hours * 3600, manualS: 0, idleS: 0,
  breakS: 0, overallS: hours * 1800, inputTrackedS: hours * 3600, dailyTrackedS: hours * 3600, zoneShifted: false, verified: true, slots: hours * 6 }));
const allDays = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
};

beforeAll(async () => {
  db = await hoursTestDb();
  await person("Person A", { role: "Call centre agent", monthlyCost: 910, currency: "USD", email: "person1@example.test", schedule: WEEK });
  await person("Person B", { role: "Closer", monthlyCost: 1200, currency: "USD", email: "person2@example.test", schedule: WEEK });
  await person("Person K", { role: "Call centre agent", monthlyCost: 300, currency: "KWD", email: "person3@example.test", schedule: WEEK });
  await person("Person C", { role: "Media buyer", monthlyCost: 1000, currency: "USD", email: "person4@example.test", schedule: WEEK });
}, 60000);
afterAll(async () => { await db.close(); });

describe("access", () => {
  test("anon and a signed-in member are refused on every table, CEO RPC and service RPC", async () => {
    for (const who of [null, MEMBER, ADMIN]) {
      await actor(db, who);
      for (const t of TABLES) await expect(db.query(`select * from public.${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
      for (const sql of [...CEO_RPCS, ...SERVICE_RPCS]) await expect(db.query(`select public.${sql}`)).rejects.toMatchObject({ code: "42501" });
    }
  });
  test("the CEO is refused on service RPCs and on the tables", async () => {
    await actor(db, CEO);
    for (const sql of SERVICE_RPCS) await expect(db.query(`select public.${sql}`)).rejects.toMatchObject({ code: "42501" });
    for (const t of TABLES) await expect(db.query(`select * from public.${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
  });
  test("nobody, service_role included, can read the keys table", async () => {
    await service(db);
    await expect(db.query("select * from public.cockpit_hours_keys")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from public.cockpit_hubstaff_days limit 1")).resolves.toBeTruthy();
  });
});

describe("keys", () => {
  test("put is compare-and-swap; the browser only ever sees the last 4 characters", async () => {
    await service(db);
    const put = await call(db, "cockpit_hours_key_put", { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_madeUpFixtureKey7Qx2", savedBy: "aziz@maharamedia.com", accountId: "705266", state: "connected", expiresOn: "2027-01-07" });
    expect(put).toMatchObject({ ok: true, version: 1, last4: "7Qx2" });
    await expect(call(db, "cockpit_hours_key_put", { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_otherFixtureKeyAAAA", savedBy: "aziz@maharamedia.com", expectVersion: 7 })).rejects.toMatchObject({ code: "40001" });
    const got = await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_key_get('hubstaff') r");
    expect(got.rows[0].r.secret).toBe("hsoat_madeUpFixtureKey7Qx2");
    await actor(db, CEO);
    const status = JSON.stringify((await db.query("select public.cockpit_ceo_hours_status() r")).rows);
    const inputs = JSON.stringify((await db.query("select public.cockpit_ceo_hours_inputs('2026-10-01') r")).rows);
    for (const text of [status, inputs]) {
      expect(text).not.toContain("hsoat_madeUpFixtureKey");
      expect(text).toContain("7Qx2");
    }
    expect(await auditCount("hours.keySaved")).toBe(1);
  });
  test("rotate refuses a stale version; exchange_begin refuses while one is in flight", async () => {
    await service(db);
    await call(db, "cockpit_hours_key_put", { provider: "hubstaff", kind: "hubstaff_personal", secret: "refreshFixture0001", savedBy: "aziz@maharamedia.com", expectVersion: 1 });
    expect(await call(db, "cockpit_hours_key_exchange_begin", { provider: "hubstaff", version: 1 })).toMatchObject({ ok: false, reason: "version_changed" });
    expect(await call(db, "cockpit_hours_key_exchange_begin", { provider: "hubstaff", version: 2 })).toMatchObject({ ok: true });
    expect(await call(db, "cockpit_hours_key_exchange_begin", { provider: "hubstaff", version: 2 })).toMatchObject({ ok: false, reason: "in_flight" });
    expect(await call(db, "cockpit_hours_key_rotate", { provider: "hubstaff", version: 1, secret: "refreshFixture0002", accessToken: "accessFixture" })).toMatchObject({ ok: false });
    expect(await call(db, "cockpit_hours_key_rotate", { provider: "hubstaff", version: 2, secret: "refreshFixture0002", accessToken: "accessFixture" })).toMatchObject({ ok: true, version: 3 });
    // The stored secret changed, so it leaves one audit row: the provider and version, never a token. A refused rotate leaves none.
    expect(await auditCount("hours.keyRotated")).toBe(1);
    await owner(db);
    const rotated = JSON.stringify((await db.query("select entity_id, actor_email, after from cockpit_audit_log where action='hours.keyRotated'")).rows);
    expect(rotated).toContain('"version":3');
    for (const bad of ["refreshFixture", "accessFixture"]) expect(rotated).not.toContain(bad);
    // A personal token renews itself: the card offers no expiry date and the server refuses one.
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_key_expiry", { provider: "hubstaff", expiresOn: "2027-01-07" })).rejects.toMatchObject({ code: "22023" });
    await service(db);
    // Back to the organisation token for the rest of the tests.
    await call(db, "cockpit_hours_key_put", { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_madeUpFixtureKey7Qx2", savedBy: "aziz@maharamedia.com", accountId: "705266", state: "connected" });
    await call(db, "cockpit_hours_key_put", { provider: "timetastic", kind: "timetastic", secret: "ttFixtureToken0000ABCD", savedBy: "aziz@maharamedia.com", accountId: "101643", state: "connected" });
  });
});

describe("the firewall state", () => {
  test("a firewall block is its own key state; an aborted exchange may run again; the card's sentence says it isn't the key", async () => {
    await service(db);
    const put = await call(db, "cockpit_hours_key_put", { provider: "hubstaff", kind: "hubstaff_personal", secret: "refreshFixture0100", savedBy: "aziz@maharamedia.com" });
    const v = Number(put.version);
    expect(await call(db, "cockpit_hours_key_exchange_begin", { provider: "hubstaff", version: v })).toMatchObject({ ok: true });
    expect(await call(db, "cockpit_hours_key_state", { provider: "hubstaff", state: "firewall_blocked", note: "made-up", exchangeAborted: true, version: v })).toMatchObject({ ok: true });
    expect(await call(db, "cockpit_hours_key_exchange_begin", { provider: "hubstaff", version: v })).toMatchObject({ ok: true });
    await actor(db, CEO);
    const status = (await db.query<{ r: { sources: { provider: string; state: string; note: string }[] } }>("select public.cockpit_ceo_hours_status() r")).rows[0].r;
    const hub = status.sources.find(x => x.provider === "hubstaff");
    expect(hub?.state).toBe("firewall_blocked");
    expect(hub?.note).toContain("isn't a problem with the key");
    await service(db);
    await expect(call(db, "cockpit_hours_key_state", { provider: "hubstaff", state: "blocked_somehow" })).rejects.toMatchObject({ code: "22023" });
    await call(db, "cockpit_hours_key_put", { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_madeUpFixtureKey7Qx2", savedBy: "aziz@maharamedia.com", accountId: "705266", state: "connected" });
  });
});

describe("history triggers", () => {
  test("a note, schedule or pause edit writes no pay row; a real change writes one at Kuwait today", async () => {
    const id = ids["Person B"];
    await owner(db);
    const before = (await db.query("select * from cockpit_pay_history where person_id=$1", [id])).rows.length;
    expect(before).toBe(1);
    await actor(db, CEO);
    await call(db, "cockpit_ceo_people_save", { id, note: "Made-up note" });
    await call(db, "cockpit_ceo_people_save", { id, schedule: { ...WEEK, week: { ...WEEK.week, sat: { on: false, start: "10:00", end: "18:00" } } } });
    await call(db, "cockpit_ceo_people_save", { id, monthlyCost: 1200 });
    await owner(db);
    expect((await db.query("select * from cockpit_pay_history where person_id=$1", [id])).rows.length).toBe(1);
    await actor(db, CEO);
    await call(db, "cockpit_ceo_people_save", { id, monthlyCost: 1250 });
    await owner(db);
    const rows = (await db.query<{ effective_from: Date; monthly_cost: string; source: string }>(
      "select effective_from, monthly_cost::text, source from cockpit_pay_history where person_id=$1 order by effective_from", [id])).rows;
    expect(rows.length).toBe(2);
    const today = (await db.query<{ d: string }>("select public.cockpit_hours_kw_today()::text d")).rows[0].d;
    expect(new Date(rows[1].effective_from).toISOString().slice(0, 10)).toBe(today);
    expect(rows[1].source).toBe("roster");
  });
  test("set_pay writes at effectiveFrom and is refused before a later row and for a backdated cut on a Kuwait contract", async () => {
    const id = ids["Person K"];
    await actor(db, CEO);
    await call(db, "cockpit_ceo_hours_set_pay", { personId: id, monthlyCost: 320, currency: "KWD", effectiveFrom: "2026-09-01", mode: "dated" });
    await owner(db);
    const r = (await db.query<{ d: string }>("select effective_from::text d from cockpit_pay_history where person_id=$1 and monthly_cost=320", [id])).rows;
    expect(r.map(x => x.d)).toEqual(["2026-09-01"]);
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_set_pay", { personId: id, monthlyCost: 330, currency: "KWD", effectiveFrom: "2026-08-01", mode: "dated" }))
      .rejects.toThrow("already recorded");
    await call(db, "cockpit_ceo_hours_terms_save", { personId: id, contractCountry: "KW" });
    await expect(call(db, "cockpit_ceo_hours_set_pay", { personId: id, monthlyCost: 280, currency: "KWD", effectiveFrom: "2026-10-01", mode: "dated" }))
      .rejects.toThrow("backdated pay cut");
    expect(await auditCount("hours.setPay")).toBe(1);
  });
  test("an empty pay GUC after a local set_config doesn't break a later save on the same connection", async () => {
    await actor(db, CEO);
    await call(db, "cockpit_ceo_people_save", { id: ids["Person C"], monthlyCost: 1010 });
    await call(db, "cockpit_ceo_people_save", { id: ids["Person C"], monthlyCost: 1000 });
    await owner(db);
    expect((await db.query("select * from cockpit_pay_history where person_id=$1", [ids["Person C"]])).rows.length).toBe(2);
  });
  test("employment events open and close periods", async () => {
    const id = await person("Person L", { role: "Video editor", monthlyCost: 500, currency: "USD" });
    await actor(db, CEO);
    await call(db, "cockpit_ceo_hours_employment", { personId: id, event: "paused", on: "2026-09-10", why: "Made-up pause" });
    // A request with no event is refused: it never falls through to "resumed".
    await expect(call(db, "cockpit_ceo_hours_employment", { personId: id, on: "2026-09-15" })).rejects.toMatchObject({ code: "22023" });
    await call(db, "cockpit_ceo_hours_employment", { personId: id, event: "resumed", on: "2026-09-20" });
    await call(db, "cockpit_ceo_hours_employment", { personId: id, event: "left", on: "2026-09-30" });
    await call(db, "cockpit_ceo_hours_employment", { personId: id, event: "rehired", on: "2026-10-12" });
    await owner(db);
    const p = (await db.query<{ kind: string; f: string; t: string | null }>(
      "select kind, from_day::text f, to_day::text t from cockpit_employment_periods where person_id=$1 order by kind, from_day", [id])).rows;
    expect(p).toEqual([
      { kind: "employed", f: "2026-01-01", t: "2026-09-30" },
      { kind: "employed", f: "2026-10-12", t: null },
      { kind: "paused", f: "2026-09-10", t: "2026-09-19" },
    ]);
    expect(await auditCount("hours.employment")).toBe(4);
  });
});

describe("sync apply, links and coverage", () => {
  test("payroll id first, then email; a second account for one person is refused", async () => {
    const run = await claim("deep");
    expect(run.ok).toBe(true);
    const tt = await call(db, "cockpit_hours_sync_apply", {
      runId: run.runId, leaseToken: run.leaseToken, provider: "timetastic", readStartedAt: new Date().toISOString(),
      window: { from: "2026-10-01", to: "2026-10-31" },
      accounts: [
        { externalId: "tt-1", email: "someone-else@example.test", name: "Person A", status: "active", payrollId: String(ids["Person A"]), extra: { allowanceRemaining: 12.5, allowanceUnit: "Days", countryCode: "EG" } },
        { externalId: "tt-2", email: "person2@example.test", name: "Person B", status: "active", extra: {} },
        { externalId: "tt-ceo", email: "aziz@maharamedia.com", name: "CEO", status: "active", extra: {} },
      ],
      leaveTypes: [{ externalId: "annual", name: "Annual leave", active: true, deducted: true, requiresApproval: true },
        { externalId: "compassionate", name: "Compassionate", active: true, deducted: true, requiresApproval: true }],
      bookings: [{ bookingId: "b-1", ttUserId: "tt-1", leaveTypeId: "annual", leaveTypeName: "Annual leave", status: "Approved", startAt: "2026-10-14T00:00:00",
        startType: "Morning", endAt: "2026-10-14T00:00:00", endType: "Afternoon", bookingUnit: "Days", duration: 1, deduction: 1, requestedById: "tt-1", actionerId: "tt-ceo", autoApproved: false }],
      bookingsRange: { from: "2026-06-01", to: "2026-10-31" }, archivedUserIds: [],
      ttDays: [{ ttUserId: "tt-1", day: "2026-10-14", kind: "booking", entityKey: "b-1", detail: "Annual leave" },
        { ttUserId: "tt-ceo", day: "2026-10-22", kind: "public_holiday", entityKey: "ph-1", detail: "Made-up holiday" },
        { ttUserId: "tt-1", day: "2026-10-22", kind: "public_holiday", entityKey: "ph-1", detail: "Made-up holiday" }],
      ttDaysRange: { from: "2026-10-01", to: "2026-10-31" },
      coverageDays: allDays("2026-10-01", "2026-10-31"),
    });
    expect(tt).toMatchObject({ ok: true, accounts: 3, bookings: 1, ttDays: 3, autolinked: 2 });
    await owner(db);
    const links = (await db.query<{ external_id: string; person_id: number; link_method: string }>(
      "select external_id, person_id, link_method from cockpit_time_accounts where provider='timetastic' and person_id is not null order by external_id")).rows;
    expect(links).toEqual([{ external_id: "tt-1", person_id: ids["Person A"], link_method: "payroll_id" }, { external_id: "tt-2", person_id: ids["Person B"], link_method: "email" }]);
    expect(await auditCount("hours.autolink")).toBe(2);
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_link", { provider: "timetastic", externalId: "tt-ceo", personId: ids["Person A"] })).rejects.toThrow("Unlink the other Timetastic account first");
    await finish(run);
  });

  test("Hubstaff: running twice gives the same rows; drops keep the earlier figure; sweeps skip removed accounts", async () => {
    const read = new Date().toISOString();
    const payload = (run: Record<string, unknown>, rows: unknown[], active: string[]) => ({
      runId: run.runId, leaseToken: run.leaseToken, provider: "hubstaff", readStartedAt: read, window: { from: "2026-10-01", to: "2026-10-31" },
      accounts: [
        { externalId: "hs-1", email: "person1@example.test", name: "Person A", status: "active", membershipRole: "user", trackable: true, memberSince: "2026-01-01" },
        { externalId: "hs-9", email: "gone@example.test", name: "Leaver", status: "removed", membershipRole: "user", trackable: true, memberSince: "2026-01-01", removedOn: "2026-10-20" },
      ],
      activeAccountIds: active, hubstaffDays: rows, coverageDays: allDays("2026-10-01", "2026-10-31"),
    });
    const rows = [...hubRows("hs-1", OCT.filter(d => d !== "2026-10-14")), ...hubRows("hs-9", OCT.slice(0, 5))];
    let run = await claim("month", "aziz@maharamedia.com");
    const first = await call(db, "cockpit_hours_sync_apply", payload(run, rows, ["hs-1"]));
    const second = await call(db, "cockpit_hours_sync_apply", payload(run, rows, ["hs-1"]));
    expect(first).toMatchObject({ ok: true, days: 30, swept: 0, autolinked: 1 });
    expect(second).toMatchObject({ ok: true, days: 30, swept: 0 });
    await finish(run);
    await owner(db);
    expect(Number((await db.query<{ n: number }>("select count(*)::int n from cockpit_hubstaff_days where gone_at is null")).rows[0].n)).toBe(30);
    // A later read: hs-1 drops 6 h 40 min on the 1st and loses the 3rd; the removed hs-9 is absent but never swept.
    run = await claim();
    const later = hubRows("hs-1", OCT.filter(d => d !== "2026-10-14" && d !== OCT[1])).map(r => (r.day === OCT[0] ? { ...r, trackedS: 1200 } : r));
    const res = await call(db, "cockpit_hours_sync_apply", { ...payload(run, later, ["hs-1"]), readStartedAt: new Date().toISOString() });
    expect(res).toMatchObject({ ok: true, swept: 1 });
    await finish(run);
    await owner(db);
    const day1 = (await db.query<{ tracked_s: number; previous_tracked_s: number }>("select tracked_s, previous_tracked_s from cockpit_hubstaff_days where hubstaff_user_id='hs-1' and day=$1", [OCT[0]])).rows[0];
    expect(day1).toEqual({ tracked_s: 1200, previous_tracked_s: 7 * 3600 });
    expect(Number((await db.query<{ n: number }>("select count(*)::int n from cockpit_hubstaff_days where hubstaff_user_id='hs-9' and gone_at is null")).rows[0].n)).toBe(5);
    // The day comes back: the upsert clears gone_at.
    run = await claim();
    await call(db, "cockpit_hours_sync_apply", { ...payload(run, hubRows("hs-1", OCT.filter(d => d !== "2026-10-14")), ["hs-1"]), readStartedAt: new Date().toISOString() });
    await finish(run);
    await owner(db);
    expect((await db.query("select * from cockpit_hubstaff_days where hubstaff_user_id='hs-1' and day=$1 and gone_at is null", [OCT[1]])).rows.length).toBe(1);
  });

  test("a wrong lease token or an older read is refused; coverage is stamped only for the days given; over 20,000 rows is refused", async () => {
    const run = await claim();
    const base = { runId: run.runId, leaseToken: run.leaseToken, provider: "hubstaff", window: { from: "2026-11-01", to: "2026-11-02" }, accounts: [], activeAccountIds: [], hubstaffDays: [] };
    await expect(call(db, "cockpit_hours_sync_apply", { ...base, leaseToken: "00000000-0000-4000-8000-000000000000", readStartedAt: new Date().toISOString() })).rejects.toMatchObject({ code: "40001" });
    await expect(call(db, "cockpit_hours_sync_apply", { ...base, window: { from: "2026-10-01", to: "2026-10-31" }, readStartedAt: "2026-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "40001" });
    await call(db, "cockpit_hours_sync_apply", { ...base, readStartedAt: new Date().toISOString(), coverageDays: ["2026-11-01"] });
    await owner(db);
    expect((await db.query("select day::text from cockpit_hours_coverage where provider='hubstaff' and day>='2026-11-01'")).rows).toEqual([{ day: "2026-11-01" }]);
    await service(db);
    const big = Array.from({ length: 20_001 }, (_, i) => `2026-11-${String((i % 2) + 1).padStart(2, "0")}`);
    await expect(call(db, "cockpit_hours_sync_apply", { ...base, readStartedAt: new Date().toISOString(), coverageDays: big })).rejects.toThrow("20,000");
    await finish(run);
  });

  test("bookings outside the queried range and of archived users are not swept", async () => {
    await owner(db);
    await db.query(`insert into cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,leave_type_name,status,start_at,start_type,end_at,end_type,booking_unit)
      values ('b-old','tt-1','annual','Annual leave','Approved','2026-03-01','Morning','2026-03-01','Afternoon','Days'),
             ('b-arch','tt-2','annual','Annual leave','Approved','2026-10-05','Morning','2026-10-05','Afternoon','Days')`);
    const run = await claim();
    const res = await call(db, "cockpit_hours_sync_apply", { runId: run.runId, leaseToken: run.leaseToken, provider: "timetastic", readStartedAt: new Date().toISOString(),
      window: { from: "2026-10-01", to: "2026-10-31" }, accounts: [], leaveTypes: [], bookings: [{ bookingId: "b-1", ttUserId: "tt-1", leaveTypeId: "annual", leaveTypeName: "Annual leave",
        status: "Approved", startAt: "2026-10-14T00:00:00", startType: "Morning", endAt: "2026-10-14T00:00:00", endType: "Afternoon", bookingUnit: "Days", actionerId: "tt-ceo", requestedById: "tt-1", autoApproved: false }],
      bookingsRange: { from: "2026-06-01", to: "2026-10-31" }, archivedUserIds: ["tt-2"], ttDays: [], coverageDays: [] });
    expect(res.swept).toBe(0);
    await finish(run);
  });

  test("a busy lease returns busy, and an expired one is marked abandoned at the next claim", async () => {
    const first = await claim();
    const second = await claim();
    expect(second).toMatchObject({ ok: false, busy: true });
    await owner(db);
    await db.query("update cockpit_hours_sync_runs set lease_until=now()-interval '1 minute' where id=$1", [first.runId]);
    const third = await claim();
    expect(third.ok).toBe(true);
    await owner(db);
    expect((await db.query<{ state: string }>("select state from cockpit_hours_sync_runs where id=$1", [first.runId])).rows[0].state).toBe("abandoned");
    await finish(third);
  });
});

describe("CEO writes, inputs, approval", () => {
  test("terms, leave type, holiday and rules: one audit row each, never an amount", async () => {
    const before: Record<string, number> = {};
    for (const a of ["hours.terms", "hours.leaveType", "hours.holiday", "hours.rules"]) before[a] = await auditCount(a);
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_terms_save", { personId: ids["Person A"], hoursPayFrom: "2026-10" })).rejects.toThrow("Confirm the signed contract");
    await call(db, "cockpit_ceo_hours_terms_save", { personId: ids["Person A"], hoursPayFrom: "2026-10", termsConfirmed: true, contractCountry: "EG" });
    await expect(call(db, "cockpit_ceo_hours_terms_save", { personId: ids["Person B"], payBasis: "hours" })).rejects.toThrow("tracking is required");
    await call(db, "cockpit_ceo_hours_leave_type_save", { externalId: "annual", payRule: "paid" });
    await call(db, "cockpit_ceo_hours_holiday_override", { day: "2026-10-29", action: "add", name: "Made-up day", scope: "all", reason: "Made-up reason" });
    await call(db, "cockpit_ceo_hours_rules_save", { fromMonth: "2026-10", settings: { graceShare: 0.02 } });
    await owner(db);
    const rule = (await db.query<{ from_month: string }>("select from_month::text from cockpit_leave_type_rules where external_id='annual'")).rows[0];
    expect(rule.from_month).toBe("2000-01-01");
    for (const a of ["hours.terms", "hours.leaveType", "hours.holiday", "hours.rules"]) expect(await auditCount(a) - before[a]).toBe(1);
  });

  test("inputs feed the model end to end; the month is computed from rows the sync wrote", async () => {
    await actor(db, CEO);
    const raw = (await db.query<{ r: HoursInputs }>("select public.cockpit_ceo_hours_inputs('2026-10-01') r")).rows[0].r;
    expect(raw.month).toBe("2026-10");
    expect(raw.ceoTtUserId).toBe("tt-ceo");
    const a = raw.people.find(p => p.personId === ids["Person A"]);
    expect(a?.accounts.map(x => x.provider).sort()).toEqual(["hubstaff", "timetastic"]);
    expect(a?.hubstaffDays.length).toBe(25);
    expect(a?.bookings.map(b => b.bookingId)).toEqual(["b-1"]);
    expect(a?.holidays.map(h => h.day)).toEqual(["2026-10-22", "2026-10-29"]);
    expect(a?.terms.hoursPayFrom).toBe("2026-10");
    const month = computeMonth({ ...raw, today: "2026-11-05", closed: { hubstaff: true, timetastic: true } });
    const pm = month.people.find(p => p.personId === ids["Person A"]);
    expect(pm?.paysOnHours).toBe(true);
    // 25 days tracked (one of them the holiday on the 22nd, one the made-up holiday on the 29th) plus 1 day of paid leave.
    expect(pm?.hours.paidLeave).toBe(7 * 3600);
    expect(pm?.pay.total).toBe(910);
  });

  test("adjustments: an approved month is refused, a correction in another currency is refused, and withdrawing never deletes", async () => {
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_adjust", { personId: ids["Person A"], kind: "correction", month: "2026-10", amount: 10, currency: "KWD", reason: "Made-up reason" }))
      .rejects.toThrow("must be in USD");
    const made = await call(db, "cockpit_ceo_hours_adjust", { personId: ids["Person A"], kind: "absent_unpaid", day: "2026-10-05", month: "2026-10", reason: "No time tracked and no leave booked" });
    await call(db, "cockpit_ceo_hours_adjust_withdraw", { id: made.id, reason: "Made-up undo" });
    await owner(db);
    const row = (await db.query<{ withdrawn_at: Date | null; snapshot: Record<string, unknown> }>("select withdrawn_at, snapshot from cockpit_time_adjustments where id=$1", [made.id])).rows[0];
    expect(row.withdrawn_at).not.toBeNull();
    expect(row.snapshot).toMatchObject({ covered: true });
    expect(await auditCount("hours.adjust")).toBe(1);
    expect(await auditCount("hours.adjustWithdraw")).toBe(1);
  });

  test("approval: service only, verified actor, repeat returns the existing one, figures lock, withdraw refused while a later month carries", async () => {
    await actor(db, CEO);
    const raw = (await db.query<{ r: HoursInputs }>("select public.cockpit_ceo_hours_inputs('2026-10-01') r")).rows[0].r;
    const inputs = { ...raw, today: "2026-11-05" };
    const ctx = contextOf(inputs);
    const p = inputs.people.find(x => x.personId === ids["Person A"]);
    if (!p) throw new Error("missing");
    const hash = await hashPerson(p, ctx);
    const body = { personId: p.personId, month: "2026-10", inputsHash: hash, ruleVersion: "hours-1", inputs: p, result: { made: "up" }, amount: 910, currency: "USD",
      amountUsd: 910, usdRate: 1, payableS: 182 * 3600, shadow: false, carries: [], remainder: -50 };
    await expect(db.query("select public.cockpit_hours_pay_month_approve($1,$2::jsonb)", [CEO, JSON.stringify(body)])).rejects.toMatchObject({ code: "42501" });
    await service(db);
    await expect(db.query("select public.cockpit_hours_pay_month_approve($1,$2::jsonb)", [ADMIN, JSON.stringify(body)])).rejects.toMatchObject({ code: "42501" });
    const first = (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_pay_month_approve($1,$2::jsonb) r", [CEO, JSON.stringify(body)])).rows[0].r;
    const again = (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_pay_month_approve($1,$2::jsonb) r", [CEO, JSON.stringify(body)])).rows[0].r;
    expect(first).toMatchObject({ ok: true, existing: false });
    expect(again).toMatchObject({ ok: true, existing: true });
    await owner(db);
    await expect(db.query("update cockpit_hours_pay_months set amount=1 where person_id=$1", [p.personId])).rejects.toThrow("lock");
    // The negative remainder went to November; an approved November carrying from October blocks withdrawing October.
    expect((await db.query("select * from cockpit_time_adjustments where person_id=$1 and month='2026-11-01' and carry_kind='remainder'", [p.personId])).rows.length).toBe(1);
    await service(db);
    await db.query("select public.cockpit_hours_pay_month_approve($1,$2::jsonb)", [CEO, JSON.stringify({ ...body, month: "2026-11", remainder: null,
      carries: [{ fromMonth: "2026-10", amount: 7.5 }] })]);
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_withdraw_approval", { personId: p.personId, month: "2026-10", reason: "Made-up reason" })).rejects.toThrow("Withdraw November first");
    await call(db, "cockpit_ceo_hours_withdraw_approval", { personId: p.personId, month: "2026-11", reason: "Made-up reason" });
    await call(db, "cockpit_ceo_hours_withdraw_approval", { personId: p.personId, month: "2026-10", reason: "Made-up reason" });
    await owner(db);
    expect((await db.query("select * from cockpit_time_adjustments where person_id=$1 and carry_kind is not null and withdrawn_at is null", [p.personId])).rows.length).toBe(0);
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_adjust", { personId: p.personId, kind: "absent_unpaid", day: "2026-10-06", month: "2026-10", reason: "Made-up" })).resolves.toMatchObject({ ok: true });
    expect(await auditCount("hours.approve")).toBe(2);
    expect(await auditCount("hours.withdrawApproval")).toBe(2);
  });

  test("an approved month refuses day decisions; mark paid locks withdraw", async () => {
    await service(db);
    const raw = (await db.query<{ r: HoursInputs }>("select public.cockpit_hours_inputs('2026-09-01') r")).rows[0].r;
    const p = raw.people.find(x => x.personId === ids["Person B"]);
    if (!p) throw new Error("missing");
    const hash = await hashPerson(p, contextOf(raw));
    await db.query("select public.cockpit_hours_pay_month_approve($1,$2::jsonb)", [CEO, JSON.stringify({ personId: p.personId, month: "2026-09", inputsHash: hash,
      ruleVersion: "hours-1", inputs: p, result: {}, amount: 1200, currency: "USD", payableS: 0, shadow: false })]);
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_adjust", { personId: p.personId, kind: "absent_unpaid", day: "2026-09-08", month: "2026-09", reason: "Made-up" })).rejects.toThrow("is approved");
    await call(db, "cockpit_ceo_hours_mark_paid", { personId: p.personId, month: "2026-09", paidOn: "2026-10-01" });
    await expect(call(db, "cockpit_ceo_hours_withdraw_approval", { personId: p.personId, month: "2026-09", reason: "Made-up" })).rejects.toThrow("marked paid");
    const costs = (await db.query<{ r: unknown[] }>("select public.cockpit_ceo_hours_costs() r")).rows[0].r;
    expect(costs).toEqual(expect.arrayContaining([expect.objectContaining({ personId: p.personId, month: "2026-09", status: "paid" })]));
  });

  test("status: cronScheduled is null in PGlite, with no error", async () => {
    await actor(db, CEO);
    const s = (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_ceo_hours_status() r")).rows[0].r;
    expect(s.cronScheduled).toBeNull();
    expect((s.sources as { provider: string }[]).map(x => x.provider)).toEqual(["hubstaff", "timetastic"]);
    expect(Array.isArray(s.accounts)).toBe(true);
  });

  test("no hours.* audit row carries an amount, a cost or a key", async () => {
    await owner(db);
    const rows = (await db.query<{ action: string; before: unknown; after: unknown }>("select action, before, after from cockpit_audit_log where action like 'hours.%'")).rows;
    expect(rows.length).toBeGreaterThan(10);
    const text = JSON.stringify(rows);
    for (const bad of ["\"amount\"", "monthly_cost", "monthlyCost", "\"secret\"", "hsoat_", "ttFixtureToken", "refreshFixture", "accessFixture"]) expect(text).not.toContain(bad);
  });

  test("prune deletes only receipts and finished runs older than 90 days, and says so in one audit row", async () => {
    await owner(db);
    await db.query("insert into cockpit_hours_provider_health(provider,method,resource,phase,created_at) values('timetastic','GET','app.timetastic.co.uk/api/users','intent',now()-interval '91 days'),('timetastic','GET','app.timetastic.co.uk/api/users','intent',now())");
    const before = Number((await db.query<{ n: number }>("select count(*)::int n from cockpit_hours_provider_health")).rows[0].n);
    await service(db);
    expect((await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_prune() r")).rows[0].r).toMatchObject({ ok: true, receipts: 1, runs: 0 });
    await owner(db);
    expect(Number((await db.query<{ n: number }>("select count(*)::int n from cockpit_hours_provider_health")).rows[0].n)).toBe(before - 1);
    expect(await auditCount("hours.prune")).toBe(1);
    await service(db);
    await db.query("select public.cockpit_hours_prune()");
    expect(await auditCount("hours.prune")).toBe(1);
  });

  test("DELETE and TRUNCATE are refused on the guarded tables", async () => {
    await owner(db);
    for (const t of ["cockpit_hours_pay_months", "cockpit_time_adjustments", "cockpit_pay_history", "cockpit_schedule_history", "cockpit_employment_periods", "cockpit_hours_terms"]) {
      const n = Number((await db.query<{ n: number }>(`select count(*)::int n from public.${t}`)).rows[0].n);
      expect(n).toBeGreaterThan(0);
      await expect(db.query(`delete from public.${t}`)).rejects.toThrow("kept for good");
      await expect(db.query(`truncate public.${t}`)).rejects.toThrow("kept for good");
    }
  });

  test("applying the migration a second time changes nothing", async () => {
    await owner(db);
    const before = (await db.query<{ n: number }>("select (select count(*) from cockpit_pay_history)+(select count(*) from cockpit_employment_periods)+(select count(*) from cockpit_schedule_history) n")).rows[0].n;
    await db.exec(migration("20261009a_cockpit_team_hours.sql"));
    const after = (await db.query<{ n: number }>("select (select count(*) from cockpit_pay_history)+(select count(*) from cockpit_employment_periods)+(select count(*) from cockpit_schedule_history) n")).rows[0].n;
    expect(after).toBe(before);
  });
});

describe("20261009b: the scheduled reads, against stub vault, net and cron schemas", () => {
  let jobs: PGlite;
  const STUBS = `
    CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
    CREATE SCHEMA net; CREATE TABLE net.calls(id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
    CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
      RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url,body,headers,timeout_milliseconds) VALUES(url,body,headers,timeout_milliseconds) RETURNING id $$;
    CREATE SCHEMA cron; CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
    CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
      $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid=job_id RETURNING true $$;`;
  beforeAll(async () => {
    jobs = await hoursTestDb();
    await jobs.exec(STUBS);
    await jobs.exec(migration("20261009b_cockpit_team_hours_jobs.sql"));
    await jobs.exec(migration("20261009b_cockpit_team_hours_jobs.sql"));
  }, 60000);
  afterAll(async () => { await jobs.close(); });

  test("both jobs are scheduled once, under the expected names", async () => {
    const rows = (await jobs.query<{ jobname: string; schedule: string; command: string }>("select jobname, schedule, command from cron.job order by jobname")).rows;
    expect(rows).toEqual([
      { jobname: "mahara-hours-deep", schedule: "40 23 * * *", command: "SELECT public.cockpit_hours_kick('deep');" },
      { jobname: "mahara-hours-sync", schedule: "17 * * * *", command: "SELECT public.cockpit_hours_kick('recent');" },
    ]);
    await actor(jobs, CEO);
    expect((await jobs.query<{ r: { cronScheduled: boolean } }>("select public.cockpit_ceo_hours_status() r")).rows[0].r.cronScheduled).toBe(true);
  });
  test("without the vault secret nothing is posted and the state row says so", async () => {
    await owner(jobs);
    expect((await jobs.query<{ r: number | null }>("select public.cockpit_hours_kick('recent') r")).rows[0].r).toBeNull();
    expect((await jobs.query("select * from net.calls")).rows).toEqual([]);
    expect((await jobs.query<{ note: string }>("select note from cockpit_sync_state where key='hours-kick'")).rows[0].note).toContain("no cockpit_sync_secret");
  });
  test("the kick sends the secret header with a 5-second timeout", async () => {
    await owner(jobs);
    await jobs.query("insert into vault.decrypted_secrets values ('cockpit_sync_secret','cron-secret-fixture')");
    await jobs.query("select public.cockpit_hours_kick('deep')");
    const call = (await jobs.query<{ url: string; body: unknown; headers: Record<string, string>; timeout_milliseconds: number }>("select url, body, headers, timeout_milliseconds from net.calls")).rows[0];
    expect(call).toEqual({ url: "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-hours-sync", body: { mode: "deep" },
      headers: { "Content-Type": "application/json", "x-cron-secret": "cron-secret-fixture" }, timeout_milliseconds: 5000 });
    await expect(jobs.query("select public.cockpit_hours_kick('month')")).rejects.toMatchObject({ code: "22023" });
  });
  test("Not connected asks for an organisation token; never read promises the hourly read only while its job is on", async () => {
    type Src = { provider: string; state: string; note: string | null };
    const sources = async () => {
      await actor(jobs, CEO);
      const r = (await jobs.query<{ r: { sources: Src[]; cronScheduled: boolean | null } }>("select public.cockpit_ceo_hours_status() r")).rows[0].r;
      return { ...r, hub: r.sources.find(x => x.provider === "hubstaff"), tt: r.sources.find(x => x.provider === "timetastic") };
    };
    const none = await sources();
    expect(none.hub?.state).toBe("missing_key");
    expect(none.hub?.note).toContain("make an organisation token (it starts hsoat_)");
    expect(none.hub?.note).not.toContain("your own account");
    await service(jobs);
    await call(jobs, "cockpit_hours_key_put", { provider: "timetastic", kind: "timetastic", secret: "ttFixtureToken0000WXYZ", savedBy: "aziz@maharamedia.com", state: "connected" });
    const on = await sources();
    expect(on.cronScheduled).toBe(true);
    expect(on.tt?.state).toBe("never_run");
    expect(on.tt?.note).toContain("17 minutes past the hour");
    await owner(jobs);
    await jobs.query("update cron.job set active=false where jobname='mahara-hours-sync'");
    const off = await sources();
    expect(off.cronScheduled).toBe(false);
    expect(off.tt?.note).toBe("Nothing has been read yet. Press Sync now to read it.");
    await owner(jobs);
    await jobs.query("update cron.job set active=true where jobname='mahara-hours-sync'");
    // The helper is internal: no role calls it directly.
    for (const who of [null, CEO]) {
      await actor(jobs, who);
      await expect(jobs.query("select public.cockpit_hours_cron_on()")).rejects.toMatchObject({ code: "42501" });
    }
    await service(jobs);
    await expect(jobs.query("select public.cockpit_hours_cron_on()")).rejects.toMatchObject({ code: "42501" });
  });
  test("the roster's own save of a last day before the roster date never fails when there is no start date", async () => {
    await actor(jobs, CEO);
    const made = await call(jobs, "cockpit_ceo_people_save", { name: "Person N", role: "Video editor" });
    const id = Number(made.id);
    await call(jobs, "cockpit_ceo_people_save", { id, active: false, endedOn: "2026-01-15" });
    await owner(jobs);
    const row = (await jobs.query<{ f: string; t: string }>("select from_day::text f, to_day::text t from cockpit_employment_periods where person_id=$1 and kind='employed'", [id])).rows[0];
    // The period starts on the day they were added, a guess; it ends the day before, so it holds no days.
    expect(Date.parse(row.t) - Date.parse(row.f)).toBe(-86_400_000);
  });
  test("nobody but the owner can run the kick", async () => {
    for (const who of [null, CEO]) {
      await actor(jobs, who);
      await expect(jobs.query("select public.cockpit_hours_kick('recent')")).rejects.toMatchObject({ code: "42501" });
    }
    await service(jobs);
    await expect(jobs.query("select public.cockpit_hours_kick('recent')")).rejects.toMatchObject({ code: "42501" });
  });
});
