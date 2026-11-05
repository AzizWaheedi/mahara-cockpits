import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { makeAppDispatcher, mintPort } from "./integration.ts";
import type { Config } from "../relay.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const now = Date.parse("2030-01-01T00:00:00.000Z");
const app = { appId: "123", installationId: "456", repositoryId: 789, repositoryFullName: "example/research" };
const config: Config = { dispatchOwner: "example", dispatchRepo: "research", dispatchEvent: "market_intel", dispatchNameKey: "name", dispatchIdKey: "id" };
const token = "fictional-secret-never-log";
const response = () => ({ token, expires_at: "2030-01-01T01:00:00.000Z", permissions: { contents: "write", metadata: "read" }, repository_selection: "selected", repositories: [{ id: 789, full_name: "example/research", private: true }] });
const create = (fn: typeof fetch, extra: Record<string, unknown> = {}) => {
  const rows: any[] = [];
  const dispatcher = makeAppDispatcher({ enabled: true, staticTokenPresent: false, config, app, privatePem: keys.privateKey, insert: async (row) => { rows.push(row); }, runKey: "fictional-run", request: fn, now: () => now, ...extra });
  return { dispatcher, rows };
};
const req = (f: (r: Request) => Promise<Response>) => f as typeof fetch;

describe("disconnected App relay candidate with fictional inputs", () => {
  test("mints a scoped credential, records both intents, then uses the existing dispatch ledger", async () => {
    const calls: Request[] = [];
    const f = req(async r => {
      calls.push(r);
      expect(r.redirect).toBe("error");
      if (r.url.endsWith("/access_tokens")) {
        expect(JSON.parse(await r.text())).toEqual({ repository_ids: [789], permissions: { contents: "write" } });
        expect(r.headers.get("authorization")).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
        return Response.json(response(), { status: 201 });
      }
      expect(r.url).toBe("https://api.github.com/repos/example/research/dispatches");
      expect(r.headers.get("authorization")).toBe(`Bearer ${token}`);
      return new Response(null, { status: 204 });
    });
    const { dispatcher, rows } = create(f);
    expect(await dispatcher.dispatch({ event_type: "fictional" })).toEqual({ ok: true, status: 204 });
    expect(calls).toHaveLength(2);
    expect(rows.map(x => x.phase)).toEqual(["intent", "response", "intent", "response"]);
    expect(rows[0].resource).toBe("api.github.com/app/installations/:id/access_tokens");
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(keys.privateKey);
    expect(JSON.stringify(rows)).not.toContain("456");
  });
  test("disabled, mixed, or mismatched configuration makes no provider call", async () => {
    let calls = 0;
    const f = req(async () => { calls++; throw new Error("should not run"); });
    for (const extra of [{ enabled: false }, { staticTokenPresent: true }, { config: { ...config, dispatchRepo: "elsewhere" } }, { privatePem: "bad" }, { app: { ...app, installationId: "../bad" } }]) {
      const { dispatcher, rows } = create(f, extra);
      expect(await dispatcher.dispatch({})).toEqual({ ok: false, status: 0, definite: true });
      expect(rows).toHaveLength(0);
    }
    expect(calls).toBe(0);
  });
  test("an intent failure does not reach GitHub or dispatch", async () => {
    let calls = 0;
    const f = req(async () => { calls++; throw new Error("never"); });
    const { dispatcher } = create(f, { insert: async () => { throw new Error("fictional-provider-secret"); } });
    expect(await dispatcher.dispatch({})).toEqual({ ok: false, status: 0, definite: true });
    expect(calls).toBe(0);
  });
  test("refuses unverified token scope and responses without exposing secrets", async () => {
    for (const bad of [ { ...response(), repositories: [] }, { ...response(), permissions: { contents: "write", actions: "write" } }, { ...response(), token: "" }, { ...response(), expires_at: "2029-01-01T00:00:00Z" }, null ]) {
      let calls = 0;
      const { dispatcher, rows } = create(req(async () => { calls++; return Response.json(bad, { status: 201 }); }));
      expect(await dispatcher.dispatch({})).toEqual({ ok: false, status: 0, definite: true });
      expect(calls).toBe(1);
      expect(JSON.stringify(rows)).not.toContain(token);
    }
  });
  test("mint errors, redirects, unreadable or oversized bodies cannot send a dispatch", async () => {
    const variants = [
      async () => { throw new Error(`provider ${token}`); },
      async () => new Response(null, { status: 302, headers: { location: "https://outside.invalid" } }),
      async () => new Response("secret", { status: 403 }),
      async () => new Response("x", { status: 201, headers: { "content-length": "262145" } }),
      async () => new Response(new ReadableStream({ pull(c) { c.error(new Error(token)); } }), { status: 201 }),
    ];
    for (const variant of variants) {
      let calls = 0;
      const { dispatcher, rows } = create(req(async () => { calls++; return variant(); }));
      expect(await dispatcher.dispatch({})).toEqual({ ok: false, status: 0, definite: true });
      expect(calls).toBe(1);
      expect(JSON.stringify(rows)).not.toContain(token);
    }
  });
  test("dispatch refusal is definite while a dispatch timeout remains unknown and is not retried", async () => {
    for (const result of ["refused", "timeout"]) {
      let calls = 0;
      const { dispatcher, rows } = create(req(async r => {
        calls++;
        if (r.url.endsWith("/access_tokens")) return Response.json(response(), { status: 201 });
        if (result === "refused") return new Response("", { status: 403 });
        throw new Error(token);
      }));
      expect(await dispatcher.dispatch({})).toEqual(result === "refused" ? { ok: false, status: 403, definite: true } : { ok: false, status: 0, definite: false });
      expect(calls).toBe(2);
      expect(rows.at(-1).phase).toBe(result === "refused" ? "response" : "unknown");
      expect(JSON.stringify(rows)).not.toContain(token);
    }
  });
  test("dispatch snapshots its nested payload before waiting for a token", async () => {
    let release!: () => void; let seen: any;
    const { dispatcher } = create(req(async r => {
      if (r.url.endsWith("/access_tokens")) {
        await new Promise<void>(resolve => { release = resolve; });
        return Response.json(response(), { status: 201 });
      }
      seen = JSON.parse(await r.text());
      return new Response(null, { status: 204 });
    }));
    const payload = { event_type: "fictional", client_payload: { item: "before" } };
    const pending = dispatcher.dispatch(payload);
    while (!release) await Promise.resolve();
    payload.event_type = "changed"; payload.client_payload.item = "after";
    release();
    expect(await pending).toEqual({ ok: true, status: 204 });
    expect(seen).toEqual({ event_type: "fictional", client_payload: { item: "before" } });
  });
  test("mint port rejects different endpoint or repository before an intent", async () => {
    const rows: any[] = []; let calls = 0;
    const port = mintPort(app, async r => { rows.push(r); }, "fictional", req(async () => { calls++; return new Response(); }));
    const init = { method: "POST" as const, headers: {}, body: JSON.stringify({ repository_ids: [789], permissions: { contents: "write" } }), signal: new AbortController().signal };
    await expect(port("https://api.github.com/app/installations/999/access_tokens", init)).rejects.toThrow();
    await expect(port("https://api.github.com/app/installations/456/access_tokens", { ...init, body: "{}" })).rejects.toThrow();
    expect(rows).toHaveLength(0); expect(calls).toBe(0);
  });
  test("a stalled intent times out and cannot later begin the provider call", async () => {
    const controller = new AbortController(); let finish!: () => void; let calls = 0;
    const port = mintPort(app, async row => { if (row.phase === "intent") await new Promise<void>(resolve => { finish = resolve; }); }, "fictional", req(async () => { calls++; return new Response(); }));
    const pending = port("https://api.github.com/app/installations/456/access_tokens", { method: "POST", headers: {}, body: JSON.stringify({ repository_ids: [789], permissions: { contents: "write" } }), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    finish(); await Promise.resolve(); expect(calls).toBe(0);
  });
  test("a stalled provider is bounded even if it ignores cancellation", async () => {
    const controller = new AbortController(); let finish!: (r: Response) => void;
    const phases: string[] = [];
    const port = mintPort(app, async row => { phases.push(row.phase); }, "fictional", req(async () => await new Promise<Response>(resolve => { finish = resolve; })));
    const pending = port("https://api.github.com/app/installations/456/access_tokens", { method: "POST", headers: {}, body: JSON.stringify({ repository_ids: [789], permissions: { contents: "write" } }), signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await expect(pending).rejects.toThrow();
    let cancelled = false;
    finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 201 }));
    await Promise.resolve(); await Promise.resolve();
    expect(phases).toEqual(["intent", "unknown"]);
    expect(cancelled).toBe(true);
  });
});
