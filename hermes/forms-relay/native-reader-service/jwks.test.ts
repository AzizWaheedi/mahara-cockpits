import { describe, expect, test } from "bun:test";
import { GITHUB_JWKS, githubKeys } from "./jwks.ts";

const key = { kty: "RSA", kid: "test-key", use: "sig", alg: "RS256", n: "test", e: "AQAB" };
const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: 200, ...init, headers: { "content-type": "application/json", ...init.headers },
});
const transport = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;

describe("GitHub key fetching, synthetic transport only", () => {
  test("pins the URL, disables redirects and credentials, caches, and returns independent copies", async () => {
    let calls = 0; let now = 1000;
    const get = githubKeys(transport(async (input, init) => {
      calls++;
      expect(String(input)).toBe(GITHUB_JWKS);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeDefined();
      return jsonResponse({ keys: [key] });
    }), () => now);
    const first = await get(); first[0].kid = "tampered";
    expect((await get())[0].kid).toBe("test-key");
    expect(calls).toBe(1);
    now += 300_000;
    expect((await get())[0].kid).toBe("test-key");
    expect(calls).toBe(2);
  });

  test("coalesces concurrent refreshes", async () => {
    let calls = 0;
    const get = githubKeys(transport(async () => { calls++; await Promise.resolve(); return jsonResponse({ keys: [key] }); }), () => 1000);
    const results = await Promise.all([get(), get(), get()]);
    expect(calls).toBe(1);
    expect(results.every(v => v[0].kid === key.kid)).toBe(true);
  });

  test("never returns an expired cache when refresh fails", async () => {
    let now = 1000; let calls = 0;
    const get = githubKeys(transport(async () => ++calls === 1 ? jsonResponse({ keys: [key] }) : new Response("fail", { status: 503 })), () => now);
    await get(); now += 300_000;
    await expect(get()).rejects.toThrow("Request denied");
  });

  test("a clock moving backwards cannot extend the cached key lifetime", async () => {
    let now = 1000; let calls = 0;
    const get = githubKeys(transport(async () => { calls++; return jsonResponse({ keys: [key] }); }), () => now);
    await get(); now = 999; await get();
    expect(calls).toBe(2);
  });

  test.each([
    ["non-200", new Response("{}", { status: 500, headers: { "content-type": "application/json" } })],
    ["wrong content type", new Response("{}", { headers: { "content-type": "text/plain" } })],
    ["deceptive content type", new Response("{}", { headers: { "content-type": "application/jsonp" } })],
    ["declared oversized", new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } })],
    ["actual oversized", new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } })],
    ["invalid JSON", new Response("{", { headers: { "content-type": "application/json" } })],
    ["missing keys", jsonResponse({})],
    ["duplicate IDs", jsonResponse({ keys: [key, key] })],
    ["private key material", jsonResponse({ keys: [{ ...key, d: "private" }] })],
    ["too many keys", jsonResponse({ keys: Array.from({ length: 101 }, (_, i) => ({ ...key, kid: `k${i}` })) })],
  ])("denies %s", async (_name, response) => {
    const get = githubKeys(transport(async () => response), () => 1000);
    await expect(get()).rejects.toThrow("Request denied");
  });

  test("does not expose provider exception text", async () => {
    const get = githubKeys(transport(async () => { throw new Error("synthetic secret"); }), () => 1000);
    await expect(get()).rejects.toThrow("Request denied");
  });

  test("denies stalled headers and bodies within the fixed deadline", async () => {
    let cancelled = false;
    const noHeaders = githubKeys(transport(async () => new Promise<Response>(() => {})), () => 1000);
    const stalledBody = githubKeys(transport(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode("{")); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "application/json" } })), () => 1000);
    const results = await Promise.allSettled([noHeaders(), stalledBody()]);
    expect(results.every(r => r.status === "rejected")).toBe(true);
    expect(cancelled).toBe(true);
  }, 7000);
});
