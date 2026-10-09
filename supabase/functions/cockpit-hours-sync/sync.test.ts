import { describe, expect, test } from "bun:test";
import { fakeClock, fakeProviders } from "../../../apps/media-buyer-cockpit/scripts/lib/hoursProviders.ts";
import type { ReceiptRow } from "./db.ts";
import { makeSyncDoor, sameSecret } from "./door.ts";
import { hubstaffWindows, runSync } from "./sync.ts";

type Rec = { name: string; args: Record<string, unknown> };
function fakeDb(keys: Record<string, unknown> = {}, extra: Partial<Record<string, (args: Record<string, unknown>) => unknown>> = {}) {
  const calls: Rec[] = [];
  const receipts: ReceiptRow[] = [];
  const store: Record<string, unknown> = {
    hubstaff: { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0001", version: 1, accountId: "900001", accessToken: null, accessExpiresAt: null, exchangeStartedAt: null, state: "connected", expiresOn: null },
    timetastic: { provider: "timetastic", kind: "timetastic", secret: "ttFixtureTokenNotReal0002", version: 1, accountId: "4242", accessToken: null, accessExpiresAt: null, exchangeStartedAt: null, state: "connected", expiresOn: null },
    ...keys,
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (extra[name]) return extra[name]?.(args);
    if (name === "cockpit_hours_key_get") return store[String(args.p_provider)] ?? null;
    if (name === "cockpit_hours_lease_claim") return { ok: true, runId: 7, leaseToken: "lease-token" };
    if (name === "cockpit_hours_lease_renew") return { ok: true };
    if (name === "cockpit_hours_account_links") return [];
    if (name === "cockpit_hours_key_exchange_begin") return { ok: true };
    if (name === "cockpit_hours_key_rotate") return { ok: true, version: 2 };
    return { ok: true };
  };
  return { rpc, calls, receipts, insertReceipt: async (row: ReceiptRow) => { receipts.push(row); }, applies: () => calls.filter(c => c.name === "cockpit_hours_sync_apply").map(c => c.args.p as Record<string, unknown>) };
}
const run = { runId: 7, leaseToken: "lease-token" };

describe("a recent read against the fixtures", () => {
  test("applies Hubstaff and Timetastic with only allowlisted fields and template receipts", async () => {
    const clock = fakeClock("2026-10-08T20:00:00Z");
    const db = fakeDb();
    const providers = fakeProviders({ now: clock.nowMs });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.state).toBe("ok");
    const [hs, tt] = db.applies();
    expect(hs.provider).toBe("hubstaff");
    expect(hs.window).toEqual({ from: "2026-10-07", to: "2026-10-08" });
    expect((hs.hubstaffDays as { day: string; trackedS: number }[]).map(d => [d.day, d.trackedS])).toEqual([["2026-10-07", 25_200], ["2026-10-08", 24_000]]);
    expect(hs.activeAccountIds).toEqual(["5001", "5002", "5003"]);
    expect(hs.coverageDays).toEqual(["2026-10-07", "2026-10-08"]);
    expect(tt.provider).toBe("timetastic");
    expect((tt.bookings as unknown[]).length).toBe(3);
    expect(tt.bookingsRange).toEqual({ from: "2026-01-01", to: "2026-10-31" });
    const payloads = JSON.stringify(db.applies());
    for (const bad of ["pay_rate", "bill_rate", "profile", "192.0.2.1", "doctor", "fever", "birthday", "gravatar", "Made-up Street", "hsoat_", "ttFixtureToken"])
      expect(payloads).not.toContain(bad);
    for (const r of db.receipts) {
      expect(r.run_id).toBe(7);
      expect(r.resource).toMatch(/^(api\.hubstaff\.com\/v2|app\.timetastic\.co\.uk\/api)\/[a-z_/{}]+$/);
      expect(r.resource).not.toMatch(/\d{3,}/);
    }
    expect(db.receipts.map(r => r.receipt_index)).toEqual(db.receipts.map((_, i) => i + 1));
    const finish = db.calls.find(c => c.name === "cockpit_hours_run_finish")?.args.p as Record<string, unknown>;
    expect(finish).toMatchObject({ state: "ok", hubstaff: { state: "ok" }, timetastic: { state: "ok" } });
  });

  test("dryRun reads and counts but writes nothing", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: fakeProviders().request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent", dryRun: true });
    expect(db.applies()).toEqual([]);
    expect(db.calls.some(c => c.name === "cockpit_hours_key_state")).toBe(false);
    expect(result.hubstaff.rows).toBe(2);
    expect(db.calls.some(c => c.name === "cockpit_hours_run_finish")).toBe(true);
  });
});

describe("complete or nothing", () => {
  test("the page cap fails the Hubstaff window; Timetastic is still written", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    let next = 1;
    const providers = fakeProviders({ override: url => (url.pathname.endsWith("/members")
      ? new Response(JSON.stringify({ members: [], users: [], pagination: { next_page_start_id: next++ } }), { status: 200 }) : null) });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.hubstaff.state).toBe("failed");
    expect(result.hubstaff.note).toContain("more than 50 pages");
    expect(providers.calls.filter(c => c.url.pathname.endsWith("/members")).length).toBe(50);
    expect(db.applies().map(a => a.provider)).toEqual(["timetastic"]);
  });

  test("a Timetastic read short of totalRecords fails the window; Hubstaff is still written", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    const providers = fakeProviders({ override: url => (url.pathname === "/api/holidays"
      ? new Response(JSON.stringify({ holidays: [], totalRecords: 5, pageNumber: 1, nextPageLink: null }), { status: 200 }) : null) });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.timetastic.state).toBe("failed");
    expect(result.timetastic.note).toContain("listed 5 bookings but sent 0");
    expect(db.applies().map(a => a.provider)).toEqual(["hubstaff"]);
  });

  test("a refused Hubstaff key records refused and writes no Hubstaff rows", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    const providers = fakeProviders({ override: url => (url.host === "api.hubstaff.com" ? new Response('{"error":"invalid_token"}', { status: 401 }) : null) });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.hubstaff.state).toBe("refused");
    expect(db.calls.find(c => c.name === "cockpit_hours_key_state")?.args.p).toMatchObject({ provider: "hubstaff", state: "refused" });
    expect(db.applies().map(a => a.provider)).toEqual(["timetastic"]);
  });

  test("Hubstaff's firewall (403, 1010) is recorded as a firewall block, never a refused key; Timetastic is still written", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    const providers = fakeProviders({ override: url => (url.host === "api.hubstaff.com" ? new Response("error code: 1010", { status: 403 }) : null) });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.hubstaff.state).toBe("firewall_blocked");
    expect(db.calls.filter(c => c.name === "cockpit_hours_key_state").map(c => (c.args.p as Record<string, unknown>).state)).toEqual(["firewall_blocked"]);
    expect(db.applies().map(a => a.provider)).toEqual(["timetastic"]);
    const finish = db.calls.find(c => c.name === "cockpit_hours_run_finish")?.args.p as Record<string, unknown>;
    expect(finish).toMatchObject({ hubstaff: { state: "firewall_blocked" }, timetastic: { state: "ok" } });
  });

  test("a key saved unchecked, or blocked by the firewall, is marked connected by the next good read, for that key's version only", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb({
      hubstaff: { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0001", version: 4, accountId: "900001", accessToken: null, accessExpiresAt: null, exchangeStartedAt: null, state: "firewall_blocked", expiresOn: null },
      timetastic: { provider: "timetastic", kind: "timetastic", secret: "ttFixtureTokenNotReal0002", version: 2, accountId: "4242", accessToken: null, accessExpiresAt: null, exchangeStartedAt: null, state: "unchecked", expiresOn: null },
    });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: fakeProviders().request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.state).toBe("ok");
    expect(db.calls.filter(c => c.name === "cockpit_hours_key_state").map(c => c.args.p)).toEqual([
      { provider: "hubstaff", state: "connected", version: 4 },
      { provider: "timetastic", state: "connected", version: 2 },
    ]);
  });

  test("no key: no call, no receipt, a plain state", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb({ hubstaff: null, timetastic: null });
    const providers = fakeProviders();
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.hubstaff.state).toBe("no_key");
    expect(result.timetastic.state).toBe("no_key");
    expect(providers.calls).toEqual([]);
    expect(db.receipts).toEqual([]);
  });
});

describe("pacing and windows", () => {
  test("Timetastic: at most 4 calls a second, and 1.1 seconds around absences", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    const providers = fakeProviders({ now: clock.nowMs, payrollIds: { "7002": "1" } });
    await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "deep" });
    const tt = providers.calls.filter(c => c.url.host === "app.timetastic.co.uk");
    expect(tt.length).toBeGreaterThan(8);
    for (let i = 1; i < tt.length; i++) expect(tt[i].at - tt[i - 1].at).toBeGreaterThanOrEqual(250);
    const absences = tt.map((c, i) => ({ c, i })).filter(x => x.c.url.pathname === "/api/absences");
    expect(absences.length).toBe(2);
    for (const { i } of absences) if (i > 0) expect(tt[i].at - tt[i - 1].at).toBeGreaterThanOrEqual(1100);
    // Contact cards only for users not linked yet, and only payroll id and job title kept.
    const ttApply = db.applies().find(a => a.provider === "timetastic") as { accounts: { externalId: string; payrollId?: string | null; extra?: Record<string, unknown> }[] };
    expect(ttApply.accounts.find(a => a.externalId === "7002")?.payrollId).toBe("1");
    expect(JSON.stringify(ttApply)).not.toContain("emergency");
    expect(ttApply.accounts.find(a => a.externalId === "7002")?.extra?.workDays).toBeTruthy();
  });

  test("deep reads last month and this month; on Saturdays the six months before as well", () => {
    expect(hubstaffWindows("deep", "2026-10-08")).toEqual([{ from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-08" }]);
    const saturday = hubstaffWindows("deep", "2026-10-10");
    expect(saturday.length).toBe(8);
    expect(saturday[0]).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(hubstaffWindows("recent", "2026-10-08")).toEqual([{ from: "2026-10-07", to: "2026-10-08" }]);
    expect(hubstaffWindows("month", "2026-10-08", "2026-10")).toEqual([{ from: "2026-10-01", to: "2026-10-08" }]);
  });

  test("a deep read of a 31-day month uses 7-day chunks for records and 31-day chunks for totals", async () => {
    const clock = fakeClock("2026-11-02T00:30:00Z");
    const db = fakeDb();
    const providers = fakeProviders({ now: clock.nowMs });
    await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "month", month: "2026-10" });
    const acts = providers.calls.filter(c => c.url.pathname.endsWith("/activities"));
    const daily = providers.calls.filter(c => c.url.pathname.endsWith("/activities/daily"));
    expect(acts.length).toBe(5);
    expect(daily.length).toBe(2);
    for (const c of acts) {
      const span = Date.parse(c.url.searchParams.get("time_slot[stop]") ?? "") - Date.parse(c.url.searchParams.get("time_slot[start]") ?? "");
      expect(span).toBeLessThanOrEqual(7 * 86_400_000);
    }
  });
});

describe("personal tokens (Mode B)", () => {
  test("the rotated token is stored by compare-and-swap before it is used", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb({ hubstaff: { provider: "hubstaff", kind: "hubstaff_personal", secret: "refreshFixture0001", version: 4, accountId: "900001", accessToken: null, accessExpiresAt: null, exchangeStartedAt: null, state: "connected", expiresOn: null } });
    const order: string[] = [];
    const providers = fakeProviders({ override: url => { order.push(url.host); return null; } });
    const rpc = async (name: string, args: Record<string, unknown>) => { if (name === "cockpit_hours_key_rotate") order.push("rotate"); return db.rpc(name, args); };
    await runSync({ rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    const rotate = db.calls.find(c => c.name === "cockpit_hours_key_rotate")?.args.p as Record<string, unknown>;
    expect(rotate).toMatchObject({ provider: "hubstaff", version: 4, secret: "refreshTokenInventedNext", accessToken: "accessTokenInventedValue" });
    expect(order.indexOf("rotate")).toBeLessThan(order.indexOf("api.hubstaff.com"));
    expect(order.indexOf("account.hubstaff.com")).toBeLessThan(order.indexOf("rotate"));
  });
  test("an exchange that times out becomes needs_new_key and is never retried", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb({ hubstaff: { provider: "hubstaff", kind: "hubstaff_personal", secret: "refreshFixture0001", version: 4, accountId: "900001", accessToken: null, accessExpiresAt: null, exchangeStartedAt: null, state: "connected", expiresOn: null } });
    const providers = fakeProviders({ override: url => { if (url.host === "account.hubstaff.com") throw new Error("timeout"); return null; } });
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(result.hubstaff.state).toBe("needs_new_key");
    expect(db.calls.find(c => c.name === "cockpit_hours_key_state")?.args.p).toMatchObject({ state: "needs_new_key" });
    expect(providers.calls.filter(c => c.url.host === "api.hubstaff.com")).toEqual([]);
    const again = fakeDb({ hubstaff: { provider: "hubstaff", kind: "hubstaff_personal", secret: "refreshFixture0001", version: 4, accountId: "900001", accessToken: null, accessExpiresAt: null, exchangeStartedAt: "2026-10-08T11:00:00Z", state: "connected", expiresOn: null } });
    const p2 = fakeProviders();
    await runSync({ rpc: again.rpc, insertReceipt: again.insertReceipt, fetch: p2.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "recent" });
    expect(p2.calls.filter(c => c.url.host.endsWith("hubstaff.com"))).toEqual([]);
  });
});

describe("the cron door", () => {
  const deps = (db: ReturnType<typeof fakeDb>, works: Promise<unknown>[]) => ({
    cronSecret: () => "cron-secret-fixture", rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: fakeProviders().request,
    sleep: async () => {}, now: () => new Date("2026-10-08T12:00:00Z"), waitUntil: (w: Promise<unknown>) => { works.push(w); },
  });
  test("a wrong secret gets 401 and the body is never read", async () => {
    const db = fakeDb();
    let read = false;
    const touched = () => { read = true; return Promise.resolve({}); };
    const req = { method: "POST", headers: new Headers({ "x-cron-secret": "wrong" }), json: touched, text: touched, arrayBuffer: touched, get body() { read = true; return null; } } as unknown as Request;
    const res = await makeSyncDoor(deps(db, []))(req);
    expect(res.status).toBe(401);
    expect(read).toBe(false);
    expect(db.calls).toEqual([]);
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
  });
  test("202 at once, the work in waitUntil, requested_by always cron", async () => {
    const db = fakeDb();
    const works: Promise<unknown>[] = [];
    const res = await makeSyncDoor(deps(db, works))(new Request("https://x.test/", { method: "POST", headers: { "x-cron-secret": "cron-secret-fixture" },
      body: JSON.stringify({ mode: "recent", requested_by: "someone@example.test" }) }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, runId: 7 });
    expect(works.length).toBe(1);
    expect(db.calls[0]).toMatchObject({ name: "cockpit_hours_lease_claim", args: { p: { mode: "recent", requestedBy: "cron" } } });
    await Promise.all(works);
    expect(db.calls.some(c => c.name === "cockpit_hours_run_finish")).toBe(true);
  });
  test("a busy lease returns busy", async () => {
    const db = fakeDb({}, { cockpit_hours_lease_claim: () => ({ ok: false, busy: true, since: "2026-10-08T11:59:00Z" }) });
    const res = await makeSyncDoor(deps(db, []))(new Request("https://x.test/", { method: "POST", headers: { "x-cron-secret": "cron-secret-fixture" }, body: "{}" }));
    expect(await res.json()).toEqual({ ok: false, busy: true, since: "2026-10-08T11:59:00Z" });
  });
});

describe("doctor", () => {
  test("records the token holder's role: an owner's key is connected, a member's key is refused with its own note", async () => {
    const clock = fakeClock("2026-10-08T12:00:00Z");
    const db = fakeDb();
    const result = await runSync({ rpc: db.rpc, insertReceipt: db.insertReceipt, fetch: fakeProviders().request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "doctor" });
    expect(result.hubstaff).toMatchObject({ state: "ok", accounts: 3 });
    expect(db.applies()).toEqual([]);
    const member = fakeDb();
    const providers = fakeProviders({ override: url => (url.pathname === "/v2/users/me" ? new Response('{"user":{"id":5002}}', { status: 200 }) : null) });
    const refused = await runSync({ rpc: member.rpc, insertReceipt: member.insertReceipt, fetch: providers.request, sleep: clock.sleep, now: clock.now }, { ...run, mode: "doctor" });
    expect(refused.hubstaff.state).toBe("refused");
    expect(member.calls.find(c => c.name === "cockpit_hours_key_state")?.args.p).toMatchObject({ provider: "hubstaff", state: "refused", note: "role_not_manager" });
    expect(providers.calls.some(c => c.url.pathname.endsWith("/activities"))).toBe(false);
  });
});
