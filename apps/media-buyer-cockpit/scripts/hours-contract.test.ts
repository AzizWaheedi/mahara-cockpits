/**
 * The screens and the backend agree: the browser's own client
 * (ceoHoursClient.ts, every `api.ceo.hours.<op>` the screens call) runs
 * against the real CEO RPCs in PGlite and the real cockpit-hours-api handler,
 * with the argument shapes the screens send. Providers are the fake Hubstaff
 * and Timetastic of hoursProviders.ts. Made-up people, figures and keys only.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeHoursApi } from "../../../supabase/functions/cockpit-hours-api/handler";
import { claimLease } from "../../../supabase/functions/cockpit-hours-sync/lease";
import { runSync } from "../../../supabase/functions/cockpit-hours-sync/sync";
import { ceoHoursAction, type HoursAccount, type HoursStatus, type HoursView, type SaveKeyResult } from "../src/lib/ceoHoursClient";
import { approveItems } from "../src/pages/ceo/hours/hoursCopy";
import type { Adjustment, ApproveResult, SourceStatus } from "../src/types/ceo/hoursContract";
import { WEEK } from "./lib/hoursFixtures";
import { type FakeOptions, fakeClock, fakeProviders } from "./lib/hoursProviders";
import { actor, call, CEO, hoursTestDb, owner, pgReceipts, pgRpc } from "./lib/hoursTestDb";

let db: PGlite;
let rpc: ReturnType<typeof pgRpc>;
const ids = { one: 0, two: 0, three: 0, four: 0 };
let providers: FakeOptions["override"];
const pending: Promise<unknown>[] = [];
const kwToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const ARG_TYPES: Record<string, string> = { p: "jsonb", p_month: "date" };

/** The CEO's Supabase client as the screens hold it: rpc as the CEO, functions.invoke into the real handler. */
function ceoClient(): SupabaseClient {
  const api = makeHoursApi({
    verifyUser: async () => CEO,
    rpc: (name, args) => rpc(name, args),
    insertReceipt: pgReceipts(db) as never,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fakeProviders({ override: providers }).request(input, init)) as typeof fetch,
    sleep: async () => {},
    now: () => new Date(),
    waitUntil: work => { pending.push(work); },
  });
  return {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      await actor(db, CEO);
      const keys = Object.keys(args);
      const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k] ?? "text"}`).join(", ")}) AS r`;
      try {
        const res = await db.query<{ r: unknown }>(sql, keys.map(k => (ARG_TYPES[k] === "jsonb" ? JSON.stringify(args[k]) : args[k])) as unknown[]);
        return { data: res.rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
      }
    },
    functions: {
      invoke: async (name: string, opts: { body?: unknown } = {}) => {
        if (name !== "cockpit-hours-api") throw new Error(`unexpected function ${name}`);
        const res = await api(new Request("https://edge.test/functions/v1/cockpit-hours-api", {
          method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify(opts.body ?? {}) }));
        const text = await res.text();
        if (!res.ok) return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(text, { status: res.status }) }) };
        return { data: text ? JSON.parse(text) : null, error: null };
      },
    },
  } as unknown as SupabaseClient;
}

let client: SupabaseClient;
const hours = <T>(op: string, args: Record<string, unknown> = {}) => ceoHoursAction(client, op, args) as Promise<T>;
const settle = async () => { while (pending.length) await pending.shift(); };

beforeAll(async () => {
  db = await hoursTestDb();
  rpc = pgRpc(db);
  client = ceoClient();
  await actor(db, CEO);
  const person = async (extra: Record<string, unknown>) => Number((await call(db, "cockpit_ceo_people_save", { startedOn: "2026-01-01", schedule: WEEK, currency: "USD", ...extra })).id);
  ids.one = await person({ name: "Person One", role: "Call centre agent", email: "person1@example.test", monthlyCost: 910 });
  ids.two = await person({ name: "Person Two", role: "Video editor", monthlyCost: 500 });
  ids.three = await person({ name: "Person Three", role: "Media buyer", email: "person3@example.test", monthlyCost: 1000 });
  ids.four = await person({ name: "Person Four", role: "Closer", email: "person4@example.test", monthlyCost: 1200 });
  await rpc("cockpit_hours_key_put", { p: { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0001", savedBy: "ceo@example.test", accountId: "900001", state: "connected" } });
  await rpc("cockpit_hours_key_put", { p: { provider: "timetastic", kind: "timetastic", secret: "ttFixtureTokenNotReal0002", savedBy: "ceo@example.test", accountId: "4242", state: "connected" } });
  const clock = fakeClock("2026-10-08T20:00:00Z");
  const fake = fakeProviders({ now: clock.nowMs, payrollIds: { "7002": String(ids.one), "7003": String(ids.two) } });
  const claim = await claimLease(rpc, { mode: "deep", requestedBy: "cron" });
  if (!claim.ok) throw new Error("lease busy");
  const out = await runSync({ rpc, insertReceipt: pgReceipts(db) as never, fetch: fake.request, sleep: clock.sleep, now: clock.now },
    { runId: claim.runId, leaseToken: claim.leaseToken, mode: "deep" });
  if (out.state !== "ok") throw new Error(`deep read failed: ${JSON.stringify(out)}`);
}, 60000);
afterAll(async () => { await settle(); await db.close(); });

describe("reads", () => {
  test("status: both sources in the contract's shape, and every account in HoursAccount's", async () => {
    const s = await hours<HoursStatus>("status");
    expect(s.sources.map(x => [x.provider, x.state])).toEqual([["hubstaff", "connected"], ["timetastic", "connected"]]);
    const keys: (keyof SourceStatus)[] = ["provider", "state", "note", "key", "accountId", "lastRunAt", "lastOkAt", "zoneShiftedDays", "accounts", "linked", "unlinked", "ignored"];
    for (const src of s.sources) expect(Object.keys(src).sort()).toEqual([...keys].sort());
    expect(s.sources[0].key).toMatchObject({ kind: "hubstaff_org", last4: "0001" });
    expect(JSON.stringify(s)).not.toContain("hsoat_fixtureToken");
    const accountKeys: (keyof HoursAccount)[] = ["provider", "externalId", "email", "name", "status", "membershipRole", "personId", "linkMethod", "ignored", "emailDiffers"];
    expect(s.accounts?.length).toBeGreaterThan(3);
    for (const a of s.accounts ?? []) expect(Object.keys(a).sort()).toEqual([...accountKeys].sort());
    expect(s.accounts?.find(a => a.provider === "hubstaff" && a.externalId === "5002")).toMatchObject({ personId: ids.one, linkMethod: "email" });
    expect(s.accounts?.find(a => a.provider === "timetastic" && a.externalId === "7003")).toMatchObject({ personId: ids.two, linkMethod: "payroll_id" });
    expect(s.lastRun).toMatchObject({ mode: "deep", state: "ok" });
  });

  test("month: the inputs RPC feeds the browser's model, hashed, with the inputs kept for the screens", async () => {
    const v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.month).toBe("2026-10");
    expect(v.inputs.month).toBe("2026-10");
    expect(v.people.map(p => p.personId).sort()).toEqual([ids.one, ids.two, ids.three, ids.four].sort());
    for (const p of v.people) expect(p.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    const one = v.people.find(p => p.personId === ids.one);
    expect(one?.tracking).toEqual({ value: "required", from: "role_default" });
    expect(one?.payBasis).toEqual({ value: "hours", from: "role_default" });
    expect(one?.shadow).toBe(true);
    const two = v.people.find(p => p.personId === ids.two);
    expect(two?.tracking).toEqual({ value: "optional", from: "role_default" });
    expect(two?.payBasis).toEqual({ value: "fixed", from: "role_default" });
    expect(two?.status.reasons.some(r => r.code.startsWith("hubstaff"))).toBe(false);
    expect(v.leaveTypesWithoutRule.map(t => t.name)).toContain("Holiday");
    expect(v.inputs.leaveTypes.find(t => t.name === "Holiday")?.suggested).toBe("paid");
  });

  test("a bad month is refused by the client with a sentence", async () => {
    await expect(hours("month", { month: "2026-13" })).rejects.toThrow("Choose a month");
  });
});

describe("the CEO's writes, as the screens send them", () => {
  test("Leave types: the suggested rule saves on one click, and nothing waits on a rule after", async () => {
    const before = await hours<HoursView>("month", { month: "2026-10" });
    for (const t of before.inputs.leaveTypes.filter(x => x.payRule === null))
      await expect(hours("setLeaveType", { externalId: t.externalId, payRule: t.suggested ?? "paid" })).resolves.toEqual({ ok: true });
    const after = await hours<HoursView>("month", { month: "2026-10" });
    expect(after.leaveTypesWithoutRule).toEqual([]);
    const sick = after.inputs.leaveTypes.find(t => t.name === "Sick");
    expect(sick?.payRule).toBe("paid");
    // A later change asks from which month.
    await expect(hours("setLeaveType", { externalId: sick?.externalId, payRule: "part", paidShare: 0.5, fromMonth: "2026-10" })).resolves.toEqual({ ok: true });
    const later = await hours<HoursView>("month", { month: "2026-10" });
    expect(later.inputs.leaveTypes.find(t => t.name === "Sick")).toMatchObject({ payRule: "part", paidShare: 0.5, ruleFromMonth: "2026-10" });
  });

  test("Link accounts: pick a person, unlink, Not on the roster, and back", async () => {
    const link = (args: Record<string, unknown>) => hours("link", { provider: "hubstaff", externalId: "5003", ...args });
    await expect(link({ personId: ids.three })).resolves.toEqual({ ok: true });
    let s = await hours<HoursStatus>("status");
    expect(s.accounts?.find(a => a.externalId === "5003")).toMatchObject({ personId: ids.three, linkMethod: "manual" });
    await expect(hours("link", { provider: "hubstaff", externalId: "5002", personId: ids.three })).rejects.toThrow("Unlink the other Hubstaff account first");
    await expect(link({ personId: null })).resolves.toEqual({ ok: true });
    await expect(link({ ignored: true })).resolves.toEqual({ ok: true });
    s = await hours<HoursStatus>("status");
    expect(s.accounts?.find(a => a.externalId === "5003")).toMatchObject({ personId: null, ignored: true });
    await expect(link({ ignored: false })).resolves.toEqual({ ok: true });
    await expect(link({ personId: ids.three })).resolves.toEqual({ ok: true });
    const v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.inputs.people.find(p => p.personId === ids.three)?.accounts.map(a => a.externalId)).toEqual(["5003"]);
  });

  test("People and rules: each row control, and the switch dialog", async () => {
    const terms = (personId: number, patch: Record<string, unknown>) => hours("setTerms", { personId, ...patch });
    await expect(terms(ids.four, { tracking: "required" })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { tracking: null })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { payBasis: "hours", tracking: "required" })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { payBasis: null })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { tracking: null })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { contractCountry: "EG" })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { worksIn: "EG" })).resolves.toEqual({ ok: true });
    await expect(terms(ids.four, { worksIn: null })).resolves.toEqual({ ok: true });
    // Pay follows hours for a person whose role already does: the dialog's one tick.
    const next = new Date(Date.parse(`${kwToday().slice(0, 7)}-01T00:00:00Z`) + 40 * 86_400_000).toISOString().slice(0, 7);
    await expect(terms(ids.one, { hoursPayFrom: next, termsConfirmed: true, contractCountry: "KW" })).rejects.toThrow("Kuwaiti lawyer");
    // A Kuwait contract never switches from a month already under way: that cuts pay already earned.
    await expect(terms(ids.one, { hoursPayFrom: kwToday().slice(0, 7), termsConfirmed: true, contractCountry: "KW", kwClauseReviewed: true }))
      .rejects.toThrow("backdated pay cut");
    await expect(terms(ids.one, { hoursPayFrom: next, termsConfirmed: true, contractCountry: "KW", kwClauseReviewed: true })).resolves.toEqual({ ok: true });
    let v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.inputs.people.find(p => p.personId === ids.one)?.terms).toMatchObject({ hoursPayFrom: next, contractCountry: "KW" });
    expect(v.inputs.people.find(p => p.personId === ids.four)?.terms).toMatchObject({ tracking: null, payBasis: null, contractCountry: "EG", worksIn: null });
    await expect(terms(ids.one, { hoursPayFrom: null })).resolves.toEqual({ ok: true });
    v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.inputs.people.find(p => p.personId === ids.one)?.terms.hoursPayFrom).toBeNull();
  });

  test("Rules: only the changed settings, from a month", async () => {
    const v = await hours<HoursView>("month", { month: "2026-10" });
    const from = v.inputs.today.slice(0, 7);
    await expect(hours("saveRules", { fromMonth: from, settings: { graceShare: 0.03, overtime: { on: true, rate: 1.5 } } })).resolves.toEqual({ ok: true });
    const after = await hours<HoursView>("month", { month: from });
    expect(after.settings.graceShare).toBe(0.03);
    expect(after.settings.overtime).toEqual({ on: true, rate: 1.5 });
    expect(after.inputs.rules?.fromMonth).toBe(from);
  });

  test("Holidays: add, then undo", async () => {
    const add = await hours<{ ok: true; id?: number }>("holiday", { day: "2026-10-25", action: "add", name: "Made-up day", scope: "all", reason: "Added by the CEO" });
    expect(add.ok).toBe(true);
    expect(add.id).toBeGreaterThan(0);
    let v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.inputs.holidayOverrides.map(o => o.day)).toContain("2026-10-25");
    expect(v.people.find(p => p.personId === ids.four)?.days.find(d => d.day === "2026-10-25")?.holiday).toBe("Made-up day");
    await expect(hours("holiday", { withdrawId: add.id, reason: "Undone" })).resolves.toMatchObject({ ok: true });
    v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.inputs.holidayOverrides.map(o => o.day)).not.toContain("2026-10-25");
  });

  test("Person sheet: a day decision with the sheet's base shape, then Withdraw", async () => {
    const base: Omit<Adjustment, "id" | "setBy" | "setAt" | "carried" | "snapshot" | "kind" | "reason"> & { personId: number } = {
      personId: ids.one, month: "2026-10", day: "2026-10-05", seconds: null, mode: null, paidShare: null, decision: null,
      bookingId: null, amount: null, currency: null, fromMonth: null,
    };
    const absent = await hours<{ ok: true; id?: number }>("adjust", { ...base, kind: "absent_unpaid", reason: "No time tracked and no leave booked" });
    expect(absent.id).toBeGreaterThan(0);
    // The other choice replaces it, never asks.
    const excused = await hours<{ ok: true; id?: number }>("adjust", { ...base, kind: "excused_paid", reason: "Worked without the timer" });
    let v = await hours<HoursView>("month", { month: "2026-10" });
    const adj = v.inputs.people.find(p => p.personId === ids.one)?.adjustments ?? [];
    expect(adj.map(a => [a.id, a.kind])).toEqual([[excused.id, "excused_paid"]]);
    expect(adj[0].snapshot).toMatchObject({ covered: expect.any(Boolean), leaveS: expect.any(Number) });
    await expect(hours("adjust", { ...base, kind: "hours", seconds: 4 * 3600, reason: "Hours from the person's own record" })).resolves.toMatchObject({ ok: true });
    await expect(hours("adjust", { ...base, day: null, kind: "no_leave_month", reason: "No leave this month" })).resolves.toMatchObject({ ok: true });
    await expect(hours("withdrawAdjustment", { id: excused.id, reason: "Withdrawn" })).resolves.toEqual({ ok: true });
    v = await hours<HoursView>("month", { month: "2026-10" });
    expect(v.inputs.people.find(p => p.personId === ids.one)?.adjustments.map(a => a.kind).sort()).toEqual(["hours", "no_leave_month"]);
    await expect(hours("adjust", { ...base, kind: "absent_unpaid", reason: "x" })).rejects.toThrow("3 to 300");
  });

  test("Roster: pay from a day, a typo fix, hours from a day, clearing hours", async () => {
    const today = kwToday();
    await expect(hours("setPay", { personId: ids.four, monthlyCost: 1300, currency: "USD", effectiveFrom: `${today.slice(0, 8)}01`, mode: "dated" })).resolves.toEqual({ ok: true });
    await expect(hours("setPay", { personId: ids.four, monthlyCost: 1350, currency: "USD", effectiveFrom: today, mode: "replace" })).resolves.toEqual({ ok: true });
    const custom = { ...WEEK, week: { ...WEEK.week, sat: { on: true, start: "12:00", end: "16:00" } } };
    await expect(hours("setSchedule", { personId: ids.four, schedule: custom, effectiveFrom: today })).resolves.toEqual({ ok: true });
    await expect(hours("setSchedule", { personId: ids.four, schedule: null, effectiveFrom: today })).resolves.toEqual({ ok: true });
    await owner(db);
    const pay = (await db.query<{ from: string; source: string }>("select effective_from::text as from, source from cockpit_pay_history where person_id=$1 order by effective_from", [ids.four])).rows;
    expect(pay.at(-1)).toMatchObject({ from: `${today.slice(0, 8)}01`, source: "dated" });
    const sched = (await db.query<{ from: string; empty: boolean }>("select effective_from::text as from, schedule is null as empty from cockpit_schedule_history where person_id=$1 order by effective_from", [ids.four])).rows;
    expect(sched.at(-1)).toEqual({ from: today, empty: true });
    const roster = (await db.query<{ schedule: unknown }>("select schedule from cockpit_people where id=$1", [ids.four])).rows[0];
    expect(roster.schedule).toBeNull();
  });

  test("Roster: paused from a day and back on, left on a day and back", async () => {
    const today = kwToday();
    await expect(hours("employment", { personId: ids.four, event: "paused", on: today, why: "Made-up reason" })).resolves.toEqual({ ok: true });
    await expect(hours("employment", { personId: ids.four, event: "resumed", on: today })).rejects.toThrow("after the pause started");
    await expect(hours("employment", { personId: ids.four, event: "resumed", on: addDays(today, 1) })).resolves.toEqual({ ok: true });
    await expect(hours("employment", { personId: ids.four, event: "left", on: today })).resolves.toEqual({ ok: true });
    await expect(hours("employment", { personId: ids.four, event: "rehired", on: addDays(today, 1) })).resolves.toEqual({ ok: true });
    const v = await hours<HoursView>("month", { month: today.slice(0, 7) });
    const kinds = v.inputs.people.find(p => p.personId === ids.four)?.employment.map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["employed", "paused"]));
  });
});

describe("Connections and reads, through cockpit-hours-api", () => {
  test("Save key: an organisation token is checked, saved, shown by its last 4, and starts the first reads", async () => {
    const out = await hours<SaveKeyResult>("saveKey", { provider: "hubstaff", key: "hsoat_fixtureTokenNotReal0002ZZz9" });
    expect(out).toMatchObject({ ok: true, state: "connected", last4: "ZZz9" });
    expect(out.text).toContain("Connected. Hubstaff shows");
    expect(pending.length).toBe(1);
    await settle();
    const s = await hours<HoursStatus>("status");
    const hub = s.sources.find(x => x.provider === "hubstaff");
    expect(hub?.key).toMatchObject({ kind: "hubstaff_org", last4: "ZZz9", expiresOn: null });
    expect(hub?.state).toBe("connected");
  });

  test("Save key: a refused key changes nothing", async () => {
    providers = url => (url.host === "api.hubstaff.com" ? new Response('{"error":"invalid_token"}', { status: 401 }) : null);
    try {
      const out = await hours<SaveKeyResult>("saveKey", { provider: "hubstaff", key: "hsoat_someOtherFixtureKey99" });
      expect(out).toEqual({ ok: false, state: "refused", text: "Hubstaff refused this key. Nothing was changed." });
    } finally { providers = undefined; }
    const s = await hours<HoursStatus>("status");
    expect(s.sources.find(x => x.provider === "hubstaff")?.key?.last4).toBe("ZZz9");
  });

  test("Save key: Hubstaff's firewall (403, 1010) is said as a firewall block, never as a refused key", async () => {
    providers = url => (url.host === "api.hubstaff.com"
      ? new Response("error code: 1010", { status: 403, headers: { "Content-Type": "text/plain", Server: "cloudflare" } }) : null);
    try {
      const out = await hours<SaveKeyResult>("saveKey", { provider: "hubstaff", key: "hsoat_firewallFixtureKey55" });
      expect(out.ok).toBe(true);
      expect(out.state).toBe("firewall_blocked");
      expect(out.text).toContain("firewall");
      expect(out.text).not.toContain("refused");
      await settle();
    } finally { providers = undefined; }
    const s = await hours<HoursStatus>("status");
    const hub = s.sources.find(x => x.provider === "hubstaff");
    expect(hub?.state).toBe("firewall_blocked");
    expect(hub?.note).toContain("firewall");
    expect(hub?.key?.last4).toBe("ey55");
  });

  test("Sync now: the firewall clears on the next good hourly read, and a second press while busy says so", async () => {
    const first = await hours<{ ok: boolean; runId?: number }>("syncNow", { mode: "recent" });
    expect(first.ok).toBe(true);
    const second = await hours<{ ok: boolean; busy?: boolean }>("syncNow", { mode: "doctor" });
    expect(second).toMatchObject({ ok: false, busy: true });
    await settle();
    const s = await hours<HoursStatus>("status");
    expect(s.sources.find(x => x.provider === "hubstaff")?.state).toBe("connected");
    await expect(hours("syncNow", { mode: "month", month: "2026-13" })).rejects.toThrow("Choose a month");
  });

  test("Key expiry: optional, saved on the key", async () => {
    await expect(hours("keyExpiry", { provider: "hubstaff", expiresOn: "2027-01-07" })).resolves.toEqual({ ok: true });
    const s = await hours<HoursStatus>("status");
    expect(s.sources.find(x => x.provider === "hubstaff")?.key?.expiresOn).toBe("2027-01-07");
  });
});

describe("Approve, mark paid, withdraw, and Costs", () => {
  test("the approve dialog's items are what the server checks; mark paid and withdraw follow", async () => {
    const v = await hours<HoursView>("month", { month: "2026-09" });
    const ready = v.people.filter(p => p.status.kind === "ready");
    expect(ready.map(p => p.personId)).toContain(ids.two);
    const out = await hours<{ results: ApproveResult[] }>("approveMany", { month: "2026-09", items: approveItems(ready, v.ruleVersion) });
    expect(out.results.every(r => r.ok)).toBe(true);
    const again = await hours<{ results: ApproveResult[] }>("approveMany", { month: "2026-09", items: approveItems(ready, v.ruleVersion) });
    expect(again.results.every(r => r.ok && r.existing)).toBe(true);
    const after = await hours<HoursView>("month", { month: "2026-09" });
    expect(after.people.find(p => p.personId === ids.two)?.status.kind).toBe("approved");
    const costs = await hours<{ personId: number; month: string; status: string }[]>("costs");
    expect(costs.find(c => c.personId === ids.two)).toMatchObject({ month: "2026-09", status: "approved" });
    await expect(hours("markPaid", { personId: ids.two, month: "2026-09", paidOn: "2026-10-05", note: undefined })).resolves.toEqual({ ok: true });
    await expect(hours("withdrawApproval", { personId: ids.two, month: "2026-09", reason: "Made-up reason" })).rejects.toThrow("marked paid");
    const others = ready.filter(p => p.personId !== ids.two);
    for (const p of others) await expect(hours("withdrawApproval", { personId: p.personId, month: "2026-09", reason: "Made-up reason" })).resolves.toEqual({ ok: true });
    const end = await hours<HoursView>("month", { month: "2026-09" });
    expect(end.people.find(p => p.personId === ids.two)?.status.kind).toBe("paid");
    for (const p of others) expect(end.people.find(x => x.personId === p.personId)?.status.kind).not.toBe("approved");
  });

  test("no audit row of any of this carries an amount or a key", async () => {
    await owner(db);
    const rows = JSON.stringify((await db.query("select action, after from cockpit_audit_log where action like 'hours.%'")).rows);
    for (const bad of ["monthly_cost", "monthlyCost", "amount", "hsoat_", "ttFixtureToken", "1350", "1300"]) expect(rows).not.toContain(bad);
  });
});
