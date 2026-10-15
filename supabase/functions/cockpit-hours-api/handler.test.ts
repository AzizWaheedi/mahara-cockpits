import { describe, expect, test } from "bun:test";
import { fullDays, inputs, person } from "../../../apps/media-buyer-cockpit/scripts/lib/hoursFixtures.ts";
import { fakeProviders } from "../../../apps/media-buyer-cockpit/scripts/lib/hoursProviders.ts";
import { computeMonth, hashMonth } from "../../../apps/media-buyer-cockpit/src/types/ceo/hoursModel.ts";
import type { ReceiptRow } from "../cockpit-hours-sync/db.ts";
import { checkMonth, makeHoursApi } from "./handler.ts";

const CEO_ID = "00000000-0000-4000-8000-0000000000c1";
type Rec = { name: string; args: Record<string, unknown> };
function setup(opts: { key?: unknown; fetch?: typeof fetch; now?: string; inputs?: unknown; actor?: string | null; claim?: (mode: string) => boolean } = {}) {
  const calls: Rec[] = [];
  const receipts: ReceiptRow[] = [];
  const works: Promise<unknown>[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "cockpit_hours_actor") return opts.actor === undefined ? "ceo@example.test" : opts.actor;
    if (name === "cockpit_hours_key_get") return opts.key ?? null;
    if (name === "cockpit_hours_key_put") return { ok: true, version: 2, last4: "x" };
    if (name === "cockpit_hours_lease_claim")
      return opts.claim?.(String((args.p as Record<string, unknown>)?.mode)) ? { ok: true, runId: 9, leaseToken: "lease-token" } : { ok: false, busy: true, since: null };
    if (name === "cockpit_hours_inputs") return opts.inputs ?? null;
    if (name === "cockpit_hours_pay_month_approve") return { ok: true, existing: false, approvedAt: "2026-11-05T09:00:00Z" };
    return { ok: true };
  };
  const handler = makeHoursApi({
    verifyUser: async jwt => (jwt === "good-jwt" ? CEO_ID : null), rpc, insertReceipt: async r => { receipts.push(r); },
    fetch: opts.fetch ?? fakeProviders().request, sleep: async () => {}, now: () => new Date(opts.now ?? "2026-10-09T09:00:00Z"),
    waitUntil: w => { works.push(w); },
  });
  const send = (body: unknown, jwt: string | null = "good-jwt") => handler(new Request("https://x.test/", {
    method: "POST", headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { calls, receipts, works, send };
}

describe("the door", () => {
  test("no JWT, a bad JWT, or a signed-in non-CEO get 403", async () => {
    expect((await setup().send({ op: "syncNow", mode: "recent" }, null)).status).toBe(403);
    expect((await setup().send({ op: "syncNow", mode: "recent" }, "bad-jwt")).status).toBe(403);
    const s = setup({ actor: null });
    const res = await s.send({ op: "syncNow", mode: "recent" });
    expect(res.status).toBe(403);
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_hours_actor"]);
  });
  test("the month is checked on the server", () => {
    const now = new Date("2026-10-09T09:00:00Z");
    expect(checkMonth("2026-10", now)).toBe("2026-10");
    expect(checkMonth("2026-04", now)).toBe("2026-04");
    expect(() => checkMonth("2026-11", now)).toThrow("hasn't started");
    expect(() => checkMonth("2026-03", now)).toThrow("6 months");
    expect(() => checkMonth("2026-1", now)).toThrow("YYYY-MM");
  });
  test("syncNow claims the lease as the verified CEO and says busy when another read holds it", async () => {
    const s = setup();
    const res = await s.send({ op: "syncNow", mode: "month", month: "2026-10", dryRun: true });
    expect(await res.json()).toEqual({ ok: false, busy: true, since: null });
    expect(s.calls[1]).toMatchObject({ name: "cockpit_hours_lease_claim", args: { p: { mode: "month", requestedBy: "ceo@example.test", windowFrom: "2026-10-01", dryRun: true } } });
    expect((await s.send({ op: "syncNow", mode: "month", month: "2027-01" })).status).toBe(400);
  });
});

describe("saveKey", () => {
  const working = { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_currentWorkingKey000", version: 1, accountId: "900001", state: "connected" };
  test("Hubstaff's firewall (403, 1010) saves the key as blocked by the firewall, never refused, and still starts the reads", async () => {
    const s = setup({ key: working, fetch: fakeProviders({ override: url => (url.host === "api.hubstaff.com" ? new Response("error code: 1010", { status: 403 }) : null) }).request });
    const out = await (await s.send({ op: "saveKey", provider: "hubstaff", key: "hsoat_newPastedKeyBBBB" })).json();
    expect(out).toMatchObject({ ok: true, state: "firewall_blocked", last4: "BBBB" });
    expect(out.text).toContain("firewall");
    const put = s.calls.find(c => c.name === "cockpit_hours_key_put")?.args.p as Record<string, unknown>;
    expect(put).toMatchObject({ kind: "hubstaff_org", secret: "hsoat_newPastedKeyBBBB", state: "firewall_blocked", expiresOn: null });
    expect(s.works.length).toBe(1);
  });
  test("a refused key changes nothing: the working key stays", async () => {
    const s = setup({ key: working, fetch: fakeProviders({ override: () => new Response('{"error":"invalid_token"}', { status: 401 }) }).request });
    const out = await (await s.send({ op: "saveKey", provider: "hubstaff", key: "hsoat_newPastedKeyAAAA" })).json();
    expect(out).toEqual({ ok: false, state: "refused", text: "Hubstaff refused this key. Nothing was changed." });
    expect(s.calls.some(c => c.name === "cockpit_hours_key_put")).toBe(false);
    expect(s.works).toEqual([]);
  });
  test("an organisation token is tested, stored with compare-and-swap, and the first reads start", async () => {
    const s = setup({ key: working });
    const out = await (await s.send({ op: "saveKey", provider: "hubstaff", key: "hsoat_newPastedKey7Qx2" })).json();
    expect(out).toEqual({ ok: true, state: "connected", text: "Connected. Hubstaff shows 3 people. The first read is running.", last4: "7Qx2" });
    const put = s.calls.find(c => c.name === "cockpit_hours_key_put")?.args.p as Record<string, unknown>;
    expect(put).toMatchObject({ provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_newPastedKey7Qx2", accountId: "900001", state: "connected", expectVersion: 1, savedBy: "ceo@example.test", expiresOn: null });
    expect(s.works.length).toBe(1);
    expect(JSON.stringify(s.receipts)).not.toContain("hsoat_");
  });
  test("a saved key starts a doctor, then a deep read: the one that loads Timetastic's people and leave types", async () => {
    const s = setup({ key: working, claim: mode => mode === "doctor" });
    await s.send({ op: "saveKey", provider: "hubstaff", key: "hsoat_newPastedKey7Qx2" });
    await Promise.all(s.works);
    const claims = s.calls.filter(c => c.name === "cockpit_hours_lease_claim").map(c => c.args.p as Record<string, unknown>);
    expect(claims.map(c => c.mode)).toEqual(["doctor", "deep"]);
    expect(claims[1]).toMatchObject({ requestedBy: "ceo@example.test", windowFrom: null, dryRun: false });
  });
  test("a personal token: the exchange is the test and its new refresh token is stored at once", async () => {
    const s = setup();
    await s.send({ op: "saveKey", provider: "hubstaff", key: "personalRefreshPasted01" });
    const put = s.calls.find(c => c.name === "cockpit_hours_key_put")?.args.p as Record<string, unknown>;
    expect(put).toMatchObject({ kind: "hubstaff_personal", secret: "refreshTokenInventedNext", accessToken: "accessTokenInventedValue" });
  });
  test("an unreachable provider stores the key as unchecked", async () => {
    const s = setup({ fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    const out = await (await s.send({ op: "saveKey", provider: "timetastic", key: "ttPastedTokenValue01" })).json();
    expect(out.state).toBe("unchecked");
    expect(s.calls.find(c => c.name === "cockpit_hours_key_put")?.args.p).toMatchObject({ kind: "timetastic", state: "unchecked" });
  });
  test("a key with spaces is refused before anything is sent", async () => {
    const s = setup();
    const out = await (await s.send({ op: "saveKey", provider: "timetastic", key: "two words here" })).json();
    expect(out.ok).toBe(false);
    expect(s.receipts).toEqual([]);
  });
});

describe("approveMany", () => {
  const ready = inputs([person({ hubstaffDays: fullDays() })]);
  async function item() {
    const month = await hashMonth(computeMonth(ready));
    const pm = month.people[0];
    return { personId: pm.personId, inputsHash: pm.inputsHash, amount: pm.pay.total as number, payableS: pm.hours.payable as number, ruleVersion: "hours-1" };
  }
  test("stores the server's own figure when everything matches", async () => {
    const s = setup({ inputs: ready, now: "2026-11-05T09:00:00Z" });
    const it = await item();
    const out = await (await s.send({ op: "approveMany", month: "2026-10", items: [it] })).json();
    expect(out.results).toEqual([{ personId: 1, ok: true, approvedAt: "2026-11-05T09:00:00Z", amount: 910, currency: "USD", existing: false }]);
    const saved = s.calls.find(c => c.name === "cockpit_hours_pay_month_approve")?.args as Record<string, unknown>;
    expect(saved.p_actor_id).toBe(CEO_ID);
    expect(saved.p).toMatchObject({ personId: 1, month: "2026-10", amount: 910, currency: "USD", payableS: 182 * 3600, inputsHash: it.inputsHash, carries: [], remainder: null });
  });
  test("refuses hash, amount, payable and rule-version mismatches, and stores nothing for them", async () => {
    const s = setup({ inputs: ready, now: "2026-11-05T09:00:00Z" });
    const it = await item();
    const out = await (await s.send({ op: "approveMany", month: "2026-10", items: [
      { ...it, inputsHash: "0".repeat(64) }, { ...it, amount: 911 }, { ...it, payableS: it.payableS - 1 }, { ...it, ruleVersion: "hours-0" },
    ] })).json();
    expect(out.results.map((r: { code: string }) => r.code)).toEqual(["changed", "changed", "changed", "rule_mismatch"]);
    expect(s.calls.some(c => c.name === "cockpit_hours_pay_month_approve")).toBe(false);
  });
  test("a month that isn't ready is refused with its first reason", async () => {
    const s = setup({ inputs: inputs([person({ hubstaffDays: fullDays(["2026-10-05"]) })]), now: "2026-11-05T09:00:00Z" });
    const it = await item();
    const out = await (await s.send({ op: "approveMany", month: "2026-10", items: [it] })).json();
    expect(out.results[0]).toMatchObject({ ok: false, code: "not_ready" });
  });
  test("more than 50 items are refused", async () => {
    const s = setup({ inputs: ready, now: "2026-11-05T09:00:00Z" });
    const it = await item();
    expect((await s.send({ op: "approveMany", month: "2026-10", items: Array.from({ length: 51 }, () => it) })).status).toBe(400);
  });
});

describe("Hubstaff watch", () => {
  const GOOGLE_KEY = "AIzaPastedKeyNotReal7Qx2";
  /** keys: what cockpit_hours_watch_key_get answers per provider (after the save), for the next-run provider. */
  function watch(opts: { secret?: string; answer?: (url: URL, init?: RequestInit) => Response; keys?: Record<string, unknown> } = {}) {
    const calls: Rec[] = [];
    const receipts: unknown[] = [];
    const sent: { url: URL; init?: RequestInit }[] = [];
    const handler = makeHoursApi({
      verifyUser: async jwt => (jwt === "good-jwt" ? CEO_ID : null),
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "cockpit_hours_watch_key_get") return opts.keys?.[String(args.p_provider)] ?? null;
        return name === "cockpit_hours_actor" ? "ceo@example.test" : { ok: true };
      },
      insertReceipt: async () => {},
      insertWatchReceipt: async r => { receipts.push(r); },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        sent.push({ url, init });
        return opts.answer ? opts.answer(url, init) : new Response("{}", { status: 599 });
      }) as typeof fetch,
      sleep: async () => {}, now: () => new Date("2026-10-13T08:00:00Z"), waitUntil: () => {},
      cronSecret: () => opts.secret ?? "cron-secret-fixture", watchUrl: "https://project.supabase.test/functions/v1/cockpit-hours-watch",
    });
    const send = (body: unknown) => handler(new Request("https://x.test/", { method: "POST", headers: { Authorization: "Bearer good-jwt", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { calls, receipts, sent, send };
  }
  test("watchNow posts the watch job with the cron secret, as the CEO", async () => {
    const s = watch({ answer: () => new Response(JSON.stringify({ ok: true, runId: 44 }), { status: 202 }) });
    const out = await (await s.send({ op: "watchNow" })).json();
    expect(out).toEqual({ ok: true, runId: 44, text: "Checking now. The card updates in about a minute." });
    expect(s.sent[0].url.toString()).toBe("https://project.supabase.test/functions/v1/cockpit-hours-watch");
    expect((s.sent[0].init?.headers as Record<string, string>)["x-cron-secret"]).toBe("cron-secret-fixture");
    expect(JSON.parse(String(s.sent[0].init?.body))).toEqual({ job: "watch", requestedBy: "ceo@example.test" });
  });
  test("watchNow says when a check is already running, and what to do without the secret", async () => {
    const busy = watch({ answer: () => new Response(JSON.stringify({ ok: false, busy: true, since: "2026-10-13T07:58:00Z" }), { status: 200 }) });
    expect(await (await busy.send({ op: "watchNow" })).json()).toMatchObject({ ok: false, busy: true, since: "2026-10-13T07:58:00Z" });
    const unset = watch({ secret: "" });
    const res = await unset.send({ op: "watchNow" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("CRON_SECRET is not set");
    expect(unset.sent).toEqual([]);
  });
  test("watchKey tests the key with one model list call, saves it, and never echoes it", async () => {
    const s = watch({ answer: () => new Response('{"models":[]}', { status: 200 }) });
    const out = await (await s.send({ op: "watchKey", provider: "google_ai", key: GOOGLE_KEY })).json();
    expect(out).toEqual({ ok: true, state: "connected", text: "Connected. The screenshot check uses Google AI from the next run.", last4: "7Qx2" });
    expect(s.sent.map(x => `${x.init?.method} ${x.url.host}${x.url.pathname}`)).toEqual(["GET generativelanguage.googleapis.com/v1beta/models"]);
    expect(s.calls.find(c => c.name === "cockpit_hours_watch_key_put")?.args).toEqual({ p: { provider: "google_ai", secret: GOOGLE_KEY, savedBy: "ceo@example.test", state: "connected", stateNote: "Google AI answered: the key works." } });
    expect(JSON.stringify(out)).not.toContain(GOOGLE_KEY);
    expect(JSON.stringify(s.receipts)).not.toContain(GOOGLE_KEY);
    expect(s.receipts).toEqual([
      expect.objectContaining({ provider: "google-ai", method: "GET", resource: "generativelanguage.googleapis.com/v1beta/models", phase: "intent" }),
      expect.objectContaining({ provider: "google-ai", phase: "response", http_status: 200 }),
    ]);
  });
  test("a refused key stores nothing; an unreachable provider stores it unchecked; a bad shape sends nothing", async () => {
    const refused = watch({ answer: () => new Response('{"error":{"code":401,"type":"invalid_request_error"}}', { status: 401 }) });
    expect(await (await refused.send({ op: "watchKey", provider: "openai", key: "sk-pastedKeyNotReal01" })).json()).toEqual({ ok: false, state: "refused", text: "OpenAI refused this key. Nothing was changed." });
    expect(refused.calls.some(c => c.name === "cockpit_hours_watch_key_put")).toBe(false);
    const down = watch({ answer: () => { throw new Error("offline"); } });
    expect(await (await down.send({ op: "watchKey", provider: "openai", key: "sk-pastedKeyNotReal01" })).json()).toMatchObject({ ok: true, state: "unchecked", last4: "al01" });
    expect(down.calls.find(c => c.name === "cockpit_hours_watch_key_put")?.args.p).toMatchObject({ state: "unchecked" });
    const shape = watch();
    expect(await (await shape.send({ op: "watchKey", provider: "google_ai", key: "two words" })).json()).toMatchObject({ ok: false, state: "missing_key" });
    expect((await shape.send({ op: "watchKey", provider: "anthropic", key: GOOGLE_KEY })).status).toBe(400);
    expect(shape.sent).toEqual([]);
  });
  test("final round: the save message names the provider the next run will actually use", async () => {
    const works = () => new Response('{"models":[]}', { status: 200 });
    const saved = (state: string) => ({ secret: "saved-secret-not-real", state, savedAt: "2026-10-13T07:00:00+00:00" });
    // The reviewers' recheck_4 A: OpenAI refused, a Google AI key pasted: the next run uses Google AI.
    const refusedFirst = watch({ answer: works, keys: { openai: saved("refused"), google_ai: saved("connected") } });
    expect((await (await refusedFirst.send({ op: "watchKey", provider: "google_ai", key: GOOGLE_KEY })).json()).text)
      .toBe("Connected. The screenshot check uses Google AI from the next run.");
    // A working OpenAI key comes first: the pasted Google AI key is saved but not used.
    const openaiFirst = watch({ answer: works, keys: { openai: saved("connected"), google_ai: saved("connected") } });
    expect(await (await openaiFirst.send({ op: "watchKey", provider: "google_ai", key: GOOGLE_KEY })).json()).toEqual({
      ok: true, state: "connected", last4: "7Qx2",
      text: "Connected. The screenshot check keeps using OpenAI, which comes first; this key is used only if that one is refused or removed.",
    });
    const unchecked = watch({ answer: () => { throw new Error("offline"); }, keys: { openai: saved("unchecked"), google_ai: saved("unchecked") } });
    expect((await (await unchecked.send({ op: "watchKey", provider: "google_ai", key: GOOGLE_KEY })).json()).text)
      .toBe("The key is saved, but Google AI couldn't be reached to check it. The screenshot check keeps using OpenAI, which comes first; this key is used only if that one is refused or removed.");
    // An OpenAI key pasted is always the one used.
    const openai = watch({ answer: works, keys: { openai: saved("connected") } });
    expect((await (await openai.send({ op: "watchKey", provider: "openai", key: "sk-pastedKeyNotReal01" })).json()).text).toBe("Connected. The screenshot check uses OpenAI from the next run.");
    // The key read back never reaches the answer.
    expect(JSON.stringify(await (await openaiFirst.send({ op: "watchKey", provider: "google_ai", key: GOOGLE_KEY })).json())).not.toContain("saved-secret");
  });
});
