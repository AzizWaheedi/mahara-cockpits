/**
 * The whole backend against the fixtures: the sync reads the fake Hubstaff
 * and Timetastic, writes through the real RPCs into PGlite, the inputs RPC
 * feeds the model, and cockpit-hours-api approves a month on the server.
 * Made-up people, figures and keys only.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { makeHoursApi } from "../../../supabase/functions/cockpit-hours-api/handler";
import { claimLease } from "../../../supabase/functions/cockpit-hours-sync/lease";
import { runSync } from "../../../supabase/functions/cockpit-hours-sync/sync";
import type { HoursInputs } from "../src/types/ceo/hoursContract";
import { computeMonth, hashMonth } from "../src/types/ceo/hoursModel";
import { WEEK } from "./lib/hoursFixtures";
import { fakeClock, fakeProviders } from "./lib/hoursProviders";
import { actor, call, CEO, hoursTestDb, owner, pgReceipts, pgRpc } from "./lib/hoursTestDb";

let db: PGlite;
let one = 0;
let two = 0;
let rpc: ReturnType<typeof pgRpc>;

beforeAll(async () => {
  db = await hoursTestDb();
  rpc = pgRpc(db);
  await actor(db, CEO);
  one = Number((await call(db, "cockpit_ceo_people_save", { name: "Person One", role: "Call centre agent", email: "person1@example.test", monthlyCost: 910, currency: "USD", startedOn: "2026-01-01", schedule: WEEK })).id);
  two = Number((await call(db, "cockpit_ceo_people_save", { name: "Person Two", role: "Video editor", monthlyCost: 500, currency: "USD", startedOn: "2026-01-01", schedule: WEEK })).id);
  await rpc("cockpit_hours_key_put", { p: { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0001", savedBy: "ceo@example.test", accountId: "900001", state: "connected" } });
  await rpc("cockpit_hours_key_put", { p: { provider: "timetastic", kind: "timetastic", secret: "ttFixtureTokenNotReal0002", savedBy: "ceo@example.test", accountId: "4242", state: "connected" } });
}, 60000);
afterAll(async () => { await db.close(); });

async function deepRead() {
  const clock = fakeClock("2026-10-08T20:00:00Z");
  const providers = fakeProviders({ now: clock.nowMs, payrollIds: { "7002": String(one), "7003": String(two) } });
  const claim = await claimLease(rpc, { mode: "deep", requestedBy: "cron" });
  if (!claim.ok) throw new Error("lease busy");
  return runSync({ rpc, insertReceipt: pgReceipts(db) as never, fetch: providers.request, sleep: clock.sleep, now: clock.now },
    { runId: claim.runId, leaseToken: claim.leaseToken, mode: "deep" });
}
const snapshot = async () => {
  await owner(db);
  const q = async (sql: string) => (await db.query(sql)).rows;
  return {
    days: await q("select hubstaff_user_id, day::text, tracked_s, manual_s, verified, gone_at is null as live from cockpit_hubstaff_days order by 1,2"),
    bookings: await q("select booking_id, tt_user_id, status, gone_at is null as live from cockpit_timetastic_bookings order by 1"),
    ttDays: await q("select tt_user_id, day::text, kind, entity_key from cockpit_timetastic_days where gone_at is null order by 1,2,3"),
    links: await q("select provider, external_id, person_id, link_method from cockpit_time_accounts where person_id is not null order by 1,2"),
  };
};

test("a deep read writes allowlisted rows, links by email and payroll id, and stamps coverage", async () => {
  const result = await deepRead();
  expect(result.state).toBe("ok");
  const s = await snapshot();
  expect(s.days).toEqual([
    { hubstaff_user_id: "5002", day: "2026-10-07", tracked_s: 25_200, manual_s: 1_800, verified: true, live: true },
    { hubstaff_user_id: "5002", day: "2026-10-08", tracked_s: 24_000, manual_s: 0, verified: true, live: true },
  ]);
  expect(s.bookings.map(b => (b as { booking_id: string }).booking_id)).toEqual(["9001", "9002", "9003"]);
  expect(s.ttDays).toEqual([
    { tt_user_id: "7002", day: "2026-10-09", kind: "non_working", entity_key: "nwd" },
    { tt_user_id: "7002", day: "2026-10-14", kind: "booking", entity_key: "9001" },
    { tt_user_id: "7002", day: "2026-10-22", kind: "public_holiday", entity_key: "31" },
  ]);
  expect(s.links).toEqual([
    { provider: "hubstaff", external_id: "5002", person_id: one, link_method: "email" },
    { provider: "timetastic", external_id: "7002", person_id: one, link_method: "payroll_id" },
    { provider: "timetastic", external_id: "7003", person_id: two, link_method: "payroll_id" },
  ]);
  const cov = (await db.query<{ provider: string; n: number }>("select provider, count(*)::int n from cockpit_hours_coverage group by 1 order by 1")).rows;
  expect(cov).toEqual([{ provider: "hubstaff", n: 38 }, { provider: "timetastic", n: 61 }]);
  const health = (await db.query<{ n: number; bad: number }>("select count(*)::int n, count(*) filter (where run_id is null or resource ~ '[0-9]{3,}')::int bad from cockpit_hours_provider_health")).rows[0];
  expect(health.n).toBeGreaterThan(20);
  expect(health.bad).toBe(0);
  const state = (await db.query<{ key: string; ok: boolean }>("select key, ok from cockpit_sync_state where key like '%-sync' order by key")).rows;
  expect(state).toEqual([{ key: "hubstaff-sync", ok: true }, { key: "timetastic-sync", ok: true }]);
  const everything = JSON.stringify((await db.query("select * from cockpit_time_accounts")).rows) + JSON.stringify((await db.query("select * from cockpit_timetastic_bookings")).rows)
    + JSON.stringify((await db.query("select * from cockpit_timetastic_days")).rows) + JSON.stringify((await db.query("select after from cockpit_audit_log where action like 'hours.%'")).rows);
  for (const bad of ["pay_rate", "profile", "birthday", "gravatar", "doctor", "fever", "Made-up Street", "emergency", "192.0.2.1", "hsoat_", "ttFixtureToken"]) expect(everything).not.toContain(bad);
});

test("a second identical read leaves the same rows", async () => {
  const before = await snapshot();
  await deepRead();
  expect(await snapshot()).toEqual(before);
});

test("the inputs RPC feeds the model: October shows the tracked days, the holiday and a leave type waiting on a rule", async () => {
  await actor(db, CEO);
  const raw = (await db.query<{ r: HoursInputs }>("select public.cockpit_ceo_hours_inputs('2026-10-01') r")).rows[0].r;
  const month = computeMonth(raw);
  const p = month.people.find(x => x.personId === one);
  expect(p?.shadow).toBe(true);
  expect(p?.days.find(d => d.day === "2026-10-07")?.tracked).toBe(25_200);
  expect(p?.days.find(d => d.day === "2026-10-22")?.holiday).toBe("Made-up holiday");
  expect(month.leaveTypesWithoutRule.map(t => t.name)).toContain("Holiday");
  expect(p?.status.reasons.map(r => r.code)).toContain("leave_type_without_rule");
});

test("cockpit-hours-api approves September on the server and refuses a stale figure", async () => {
  await actor(db, CEO);
  const raw = (await db.query<{ r: HoursInputs }>("select public.cockpit_ceo_hours_inputs('2026-09-01') r")).rows[0].r;
  const month = await hashMonth(computeMonth(raw));
  const p = month.people.find(x => x.personId === two);
  if (!p) throw new Error("missing");
  expect(p.status.kind).toBe("ready");
  const api = makeHoursApi({ verifyUser: async () => CEO, rpc, insertReceipt: pgReceipts(db) as never, fetch: fakeProviders().request,
    sleep: async () => {}, now: () => new Date(), waitUntil: () => {} });
  const send = async (items: unknown[]) => (await api(new Request("https://x.test/", { method: "POST", headers: { Authorization: "Bearer jwt" },
    body: JSON.stringify({ op: "approveMany", month: "2026-09", items }) }))).json();
  const it = { personId: p.personId, inputsHash: p.inputsHash, amount: p.pay.total, payableS: p.hours.payable, ruleVersion: "hours-1" };
  const stale = await send([{ ...it, amount: 1 }]);
  expect(stale.results[0]).toMatchObject({ ok: false, code: "changed" });
  const done = await send([it]);
  expect(done.results[0]).toMatchObject({ ok: true, amount: 500, currency: "USD", existing: false });
  const again = await send([it]);
  expect(again.results[0]).toMatchObject({ ok: true, existing: true });
  await owner(db);
  const row = (await db.query<{ amount: string; status: string; approved_by: string }>("select amount::text, status, approved_by from cockpit_hours_pay_months where person_id=$1", [two])).rows;
  expect(row).toEqual([{ amount: "500.000", status: "approved", approved_by: "aziz@maharamedia.com" }]);
  await actor(db, CEO);
  const view = computeMonth((await db.query<{ r: HoursInputs }>("select public.cockpit_ceo_hours_inputs('2026-09-01') r")).rows[0].r);
  expect(view.people.find(x => x.personId === two)?.status.kind).toBe("approved");
});

test("a key pasted while a read is running keeps its own state when the old key is refused", async () => {
  // Made-up keys. The read starts with version N; the CEO pastes a new key mid-read; Hubstaff then refuses the old one.
  const clock = fakeClock("2026-10-08T20:00:00Z");
  const base = fakeProviders({ now: clock.nowMs });
  let pasted = false;
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "api.hubstaff.com") {
      if (!pasted) {
        pasted = true;
        await rpc("cockpit_hours_key_put", { p: { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0009", savedBy: "ceo@example.test", accountId: "900001", state: "unchecked" } });
      }
      return new Response('{"error":"invalid_token"}', { status: 401 });
    }
    return base.request(input, init);
  }) as typeof fetch;
  const claim = await claimLease(rpc, { mode: "recent", requestedBy: "cron" });
  if (!claim.ok) throw new Error("lease busy");
  const result = await runSync({ rpc, insertReceipt: pgReceipts(db) as never, fetch: request, sleep: clock.sleep, now: clock.now },
    { runId: claim.runId, leaseToken: claim.leaseToken, mode: "recent" });
  expect(result.hubstaff.state).toBe("refused");
  await owner(db);
  const key = (await db.query<{ state: string; last4: string }>("select state, last4 from cockpit_hours_keys where provider='hubstaff'")).rows[0];
  expect(key).toEqual({ state: "unchecked", last4: "0009" });
});
