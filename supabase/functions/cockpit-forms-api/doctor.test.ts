import { describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { runDoctor } from "./doctor.ts";
import { NOT_A_KEY, saveKey } from "./keys.ts";
import { answer, ceoActor, fakeDeps, fathomApi, keyRow, meeting, opOf } from "./testkit.ts";

const models = (o: { deepseek?: string[]; anthropic?: string[]; status?: number } = {}) => (url: URL) => {
  if (url.host === "api.deepseek.com") return o.status ? answer({}, o.status) : answer({ data: (o.deepseek ?? ["deepseek-flash", "deepseek-v4-pro"]).map(id => ({ id })) });
  if (url.host === "api.anthropic.com") return o.status ? answer({}, o.status) : answer({ data: (o.anthropic ?? ["claude-opus-5-5", "claude-opus-5"]).map(id => ({ id })) });
  return null;
};
const STORE = { csRecordings24h: 3, candidates7d: 2, lastPull: "2026-10-28T08:59:00Z", lastDelivery: null };

describe("the doctor", () => {
  test("its receipts carry the strings that clear the monitor: the Fathom paths and the bare model hosts", async () => {
    const f = fakeDeps({
      rpc: { cockpit_forms_key_get: (a: Record<string, any>) => keyRow(a.p_provider), cockpit_forms_doctor_store: STORE },
      routes: [fathomApi({ pages: [[meeting()]] }), models()],
    });
    const d = await runDoctor({ deps: f.deps });
    expect(f.keyChecks).toHaveLength(0);
    expect(f.health.every(r => r.run_key === "doctor" && r.action_id === null)).toBe(true);
    expect([...new Set(f.health.map(r => `${r.provider} ${r.resource}`))]).toEqual([
      "fathom api.fathom.ai/external/v1/users",
      "fathom api.fathom.ai/external/v1/meetings",
      "deepseek api.deepseek.com",
      "anthropic api.anthropic.com",
    ]);
    expect(f.health.map(r => r.phase)).toEqual(["intent", "response", "intent", "response", "intent", "response", "intent", "response"]);
    expect(d).toMatchObject({ ok: true, fathom: { admin: true, csList: true, limit: { limit: 60, remaining: 55 } }, models: { deepseek: true, anthropic: true }, store: STORE });
    const meetings = new URL(f.sent.find(s => s.url.includes("/meetings"))?.url ?? "");
    expect(meetings.searchParams.get("teams[]")).toBe("Customer Success");
  });

  test("never a secret; a missing model key is reported, not a failure; the webhook's registration from its meta", async () => {
    const f = fakeDeps({
      rpc: {
        cockpit_forms_key_get: (a: Record<string, any>) =>
          a.p_provider === "fathom" ? keyRow("fathom") : a.p_provider === "fathom_webhook" ? { ...keyRow("fathom_webhook", "whsec_testwebhooksecret123456"), state: "unchecked", meta: { webhookId: "wh-1" } } : null,
        cockpit_forms_doctor_store: STORE,
      },
      routes: [fathomApi({ pages: [[meeting()]] }), models()],
    });
    const d = await runDoctor({ deps: f.deps });
    const text = JSON.stringify(d);
    expect(text).not.toContain("test-fathom-key");
    expect(text).not.toContain("whsec_");
    expect(d.ok).toBe(true);
    expect(d.keys).toEqual({
      fathom: { state: "connected", saved: true },
      fathom_webhook: { state: "unchecked", registered: true },
      deepseek: { state: "missing", saved: false },
      anthropic: { state: "missing", saved: false },
    });
    expect(d.models).toEqual({ deepseek: false, anthropic: false });
    expect(d.note).toContain("No Anthropic key");
    expect(f.sent.some(s => s.url.includes("deepseek") || s.url.includes("anthropic"))).toBe(false);
  });

  test("not ok without a working Fathom key: missing, refused, or a team list that is not clean", async () => {
    const none = await runDoctor({ deps: fakeDeps({ rpc: { cockpit_forms_key_get: null, cockpit_forms_doctor_store: STORE } }).deps });
    expect(none).toMatchObject({ ok: false, fathom: { admin: false, csList: false } });
    expect(none.note).toContain("Fathom isn't connected.");
    const refused = await runDoctor({ deps: fakeDeps({ rpc: { cockpit_forms_key_get: (a: Record<string, any>) => (a.p_provider === "fathom" ? keyRow("fathom") : null), cockpit_forms_doctor_store: STORE }, routes: [fathomApi({ usersStatus: 401 })] }).deps });
    expect(refused.ok).toBe(false);
    expect(refused.note).toContain("Fathom refused the key (401).");
    const dirty = await runDoctor({
      deps: fakeDeps({
        rpc: { cockpit_forms_key_get: (a: Record<string, any>) => (a.p_provider === "fathom" ? keyRow("fathom") : null), cockpit_forms_doctor_store: STORE },
        routes: [fathomApi({ pages: [[meeting({ recorded_by: { email: "ceo.seat@maharamedia.com", team: "Sales" } })]] })],
      }).deps,
    });
    expect(dirty).toMatchObject({ ok: false, fathom: { admin: true, csList: false } });
  });
});

describe("keys.save", () => {
  const put = (a: Record<string, any>) => ({ ok: true, provider: a.p.provider, last4: String(a.p.secret).slice(-4), state: a.p.state });

  test("a good Fathom key: tested, saved connected by the CEO with its meta; receipts only in the key-check ledger", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_key_put: put }, routes: [fathomApi({ users: 4, pages: [[meeting()]] })] });
    const out = await saveKey(opOf(f.deps, ceoActor), { provider: "fathom", key: "fathom-key-for-tests-abcd1234" });
    expect(out).toEqual({ ok: true, state: "connected", text: "Connected. Fathom shows 4 people.", last4: "1234" });
    expect(f.health).toHaveLength(0);
    expect(f.keyChecks.map(r => `${r.phase} ${r.resource}`)).toEqual([
      "intent api.fathom.ai/external/v1/users",
      "response api.fathom.ai/external/v1/users",
      "intent api.fathom.ai/external/v1/meetings",
      "response api.fathom.ai/external/v1/meetings",
    ]);
    expect(f.keyChecks.every(r => r.provider === "fathom" && r.method === "GET" && /^keys:[0-9a-f-]{36}$/.test(String(r.run_key)))).toBe(true);
    expect(Object.keys(f.keyChecks[0]).sort()).toEqual(["http_status", "method", "phase", "provider", "resource", "run_key"]);
    expect(f.service.named("cockpit_forms_key_put")[0].args.p).toEqual({
      provider: "fathom",
      secret: "fathom-key-for-tests-abcd1234",
      savedBy: ceoActor.email,
      state: "connected",
      meta: { users: 4, adminOk: true, csFilterOk: true },
    });
  });

  test("a refused key changes nothing; an unreachable provider keeps the key unchecked", async () => {
    const refused = fakeDeps({ rpc: { cockpit_forms_key_put: put }, routes: [fathomApi({ usersStatus: 401 })] });
    expect(await saveKey(opOf(refused.deps, ceoActor), { provider: "fathom", key: "fathom-key-for-tests-abcd1234" })).toEqual({ ok: false, state: "refused", text: "Fathom refused this key. Nothing was changed.", last4: null });
    expect(refused.service.named("cockpit_forms_key_put")).toHaveLength(0);
    const down = fakeDeps({ rpc: { cockpit_forms_key_put: put }, routes: [models({ status: 503 })] });
    const out = await saveKey(opOf(down.deps, ceoActor), { provider: "deepseek", key: "sk-abcdefghijklmnopqrstuvwxyz123456" });
    expect(out).toEqual({ ok: true, state: "unchecked", text: "The key is saved, but DeepSeek couldn't be reached to check it.", last4: "3456" });
    expect(down.keyChecks.map(r => `${r.phase} ${r.resource} ${r.http_status}`)).toEqual(["intent api.deepseek.com/models null", "unknown api.deepseek.com/models 503"]);
  });

  test("a Fathom key whose team page is not clean is refused", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_key_put: put }, routes: [fathomApi({ pages: [[meeting({ recorded_by: { email: "ceo.seat@maharamedia.com", team: "Sales" } })]] })] });
    expect((await saveKey(opOf(f.deps, ceoActor), { provider: "fathom", key: "fathom-key-for-tests-abcd1234" })).state).toBe("refused");
    expect(f.service.named("cockpit_forms_key_put")).toHaveLength(0);
  });

  test("DeepSeek and Anthropic keys are checked by their model lists, and a key that cannot see the drafts' model says so", async () => {
    const ds = fakeDeps({ rpc: { cockpit_forms_key_put: put }, routes: [models()] });
    expect(await saveKey(opOf(ds.deps, ceoActor), { provider: "deepseek", key: "sk-abcdefghijklmnopqrstuvwxyz123456" })).toMatchObject({ ok: true, state: "connected", text: "Connected." });
    expect(ds.sent[0].headers.authorization).toBe("Bearer sk-abcdefghijklmnopqrstuvwxyz123456");
    const an = fakeDeps({ rpc: { cockpit_forms_key_put: put }, routes: [models({ anthropic: ["claude-opus-5"] })] });
    const out = await saveKey(opOf(an.deps, ceoActor), { provider: "anthropic", key: "sk-ant-abcdefghijklmnopqrstuvwxyz" });
    expect(out).toMatchObject({ ok: true, state: "connected", text: "Connected. This key cannot see claude-opus-5-5." });
    expect(an.service.named("cockpit_forms_key_put")[0].args.p).toMatchObject({ provider: "anthropic", state: "connected", stateNote: "This key cannot see claude-opus-5-5." });
    expect(an.keyChecks[0]).toMatchObject({ provider: "anthropic", resource: "api.anthropic.com/v1/models" });
    expect(an.sent[0].headers["x-api-key"]).toBe("sk-ant-abcdefghijklmnopqrstuvwxyz");
  });

  test("not a key: nothing is called; the vault's own format refusal comes back as its sentence; only last4 ever returns", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_key_put: put } });
    for (const key of ["short", "has a space in it and is long enough", "x".repeat(401), 42]) {
      expect(await saveKey(opOf(f.deps, ceoActor), { provider: "fathom", key })).toEqual({ ok: false, state: "refused", text: NOT_A_KEY, last4: null });
    }
    expect(f.sent).toHaveLength(0);
    const vault = fakeDeps({
      rpc: {
        cockpit_forms_key_put: () => {
          throw new RpcError("That doesn't look like a deepseek key. Nothing was changed.", "22023");
        },
      },
      routes: [models()],
    });
    const out = await saveKey(opOf(vault.deps, ceoActor), { provider: "deepseek", key: "not-the-deepseek-shape-1234567890" });
    expect(out).toEqual({ ok: false, state: "refused", text: "That doesn't look like a deepseek key. Nothing was changed.", last4: null });
    expect(JSON.stringify(out)).not.toContain("not-the-deepseek-shape");
  });

  test("a key-check receipt that cannot be saved stops the test call", async () => {
    const f = fakeDeps({ routes: [fathomApi()] });
    f.deps.keyChecks = async () => {
      throw new Error("ledger down");
    };
    await expect(saveKey(opOf(f.deps, ceoActor), { provider: "fathom", key: "fathom-key-for-tests-abcd1234" })).rejects.toThrow("ledger down");
    expect(f.sent).toHaveLength(0);
  });
});

describe("the doctor: the 1-1 notes sweep's secret (2b build 0)", () => {
  test("NOTICES_CRON_SECRET is a boolean, never a value; missing is said, not a failure", async () => {
    const rpc = { cockpit_forms_key_get: (a: Record<string, any>) => keyRow(a.p_provider), cockpit_forms_doctor_store: STORE };
    const set = fakeDeps({ env: { NOTICES_CRON_SECRET: "invented-secret-xyz" }, rpc, routes: [fathomApi({ pages: [[meeting()]] }), models()] });
    const on = await runDoctor({ deps: set.deps });
    expect(on.secrets).toEqual({ NOTICES_CRON_SECRET: true });
    expect(JSON.stringify(on)).not.toContain("invented-secret-xyz");
    expect(on.note).not.toContain("NOTICES_CRON_SECRET");
    const unset = fakeDeps({ rpc, routes: [fathomApi({ pages: [[meeting()]] }), models()] });
    const off = await runDoctor({ deps: unset.deps });
    expect(off).toMatchObject({ ok: true, secrets: { NOTICES_CRON_SECRET: false } });
    expect(off.note).toContain("No NOTICES_CRON_SECRET: the 1-1 notes sweep cannot start drafts.");
  });

  test("NOTICES_CRON_SECRET is read trimmed, as the door compares it: only whitespace is no secret, a trailing newline is one", async () => {
    // Review round 3: the doctor said true for a value the door could never match.
    const rpc = { cockpit_forms_key_get: (a: Record<string, any>) => keyRow(a.p_provider), cockpit_forms_doctor_store: STORE };
    const blank = fakeDeps({ env: { NOTICES_CRON_SECRET: " \n" }, rpc, routes: [fathomApi({ pages: [[meeting()]] }), models()] });
    const off = await runDoctor({ deps: blank.deps });
    expect(off.secrets).toEqual({ NOTICES_CRON_SECRET: false });
    expect(off.note).toContain("No NOTICES_CRON_SECRET: the 1-1 notes sweep cannot start drafts.");
    const newline = fakeDeps({ env: { NOTICES_CRON_SECRET: "invented-secret-xyz\n" }, rpc, routes: [fathomApi({ pages: [[meeting()]] }), models()] });
    expect((await runDoctor({ deps: newline.deps })).secrets).toEqual({ NOTICES_CRON_SECRET: true });
  });
});
