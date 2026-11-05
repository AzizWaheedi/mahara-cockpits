import { test, expect, describe } from "bun:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mintRestrictedToken, AuthDenied } from "./auth.ts";

// Ephemeral fake keys and values. Nothing reads a credential or calls the network.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const cfg = { appId: "123", installationId: "456", repositoryId: 789, repositoryFullName: "example/research" };
const reply = () => ({ status: 201, body: { token: "fictional-secret-value", expires_at: "2030-01-01T01:00:00.000Z", permissions: { contents: "write", metadata: "read" }, repository_selection: "selected", repositories: [{ id: 789, full_name: "example/research", private: true }] } });
const expected = async (patch: (body: any) => void) => {
  const r = reply(); patch(r.body);
  await expect(mintRestrictedToken(cfg, keys.privateKey, async () => r, NOW)).rejects.toBeInstanceOf(AuthDenied);
};

describe("offline GitHub App token prototype", () => {
  test("signs a short-lived app JWT and requests exactly one repository and Contents write", async () => {
    let calls = 0;
    const out = await mintRestrictedToken(cfg, keys.privateKey, async (url, init) => {
      calls++;
      expect(url).toBe("https://api.github.com/app/installations/456/access_tokens");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ repository_ids: [789], permissions: { contents: "write" } });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const jwt = init.headers.Authorization.replace(/^Bearer /, "");
      const [h,p,s] = jwt.split(".");
      expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
      expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({ iat: NOW / 1000 - 60, exp: NOW / 1000 + 480, iss: "123" });
      const verifier = createVerify("RSA-SHA256"); verifier.update(`${h}.${p}`); verifier.end();
      expect(verifier.verify(keys.publicKey, Buffer.from(s, "base64url"))).toBe(true);
      return reply();
    }, NOW);
    expect(calls).toBe(1); expect(out.token).toBe("fictional-secret-value");
  });
  test("rejects bad configuration or signing key before any request", async () => {
    let calls = 0; const request = async () => { calls++; return reply(); };
    for (const bad of [{ ...cfg, appId: "../1" }, { ...cfg, installationId: "3/other" }, { ...cfg, repositoryId: 0 }, { ...cfg, repositoryFullName: "a/../b" }])
      await expect(mintRestrictedToken(bad, keys.privateKey, request, NOW)).rejects.toBeInstanceOf(AuthDenied);
    await expect(mintRestrictedToken(cfg, "not a private key", request, NOW)).rejects.toBeInstanceOf(AuthDenied);
    expect(calls).toBe(0);
  });
  test("rejects another, additional, public or missing repository", async () => {
    await expected(x => x.repositories[0].id = 987);
    await expected(x => x.repositories[0].full_name = "other/research");
    await expected(x => x.repositories[0].private = false);
    await expected(x => x.repositories.push(x.repositories[0]));
    await expected(x => delete x.repositories);
    await expected(x => x.repository_selection = "all");
  });
  test("rejects missing or extra permissions", async () => {
    await expected(x => x.permissions.contents = "read");
    await expected(x => x.permissions.actions = "write");
    await expected(x => delete x.permissions);
  });
  test("rejects expired, implausible, malformed or unscoped credentials", async () => {
    await expected(x => x.expires_at = "2029-01-01T00:00:00.000Z");
    await expected(x => x.expires_at = "2031-01-01T00:00:00.000Z");
    await expected(x => x.expires_at = "bad");
    await expected(x => x.expires_at = { toString: () => { throw new Error("secret expiry"); } });
    await expected(x => x.token = "");
    await expected(x => x.token = "secret\nother");
  });
  test("sanitizes provider exceptions and refuses HTTP errors, without token fallback", async () => {
    const secret = "do-not-print-provider-secret";
    let error: unknown;
    try { await mintRestrictedToken(cfg, keys.privateKey, async () => { throw new Error(secret); }, NOW); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(AuthDenied);
    expect(String(error)).not.toContain(secret);
    await expect(mintRestrictedToken(cfg, keys.privateKey, async () => ({ status: 403, body: secret }), NOW)).rejects.toBeInstanceOf(AuthDenied);
  });
  test("does not silently use global fetch", async () => {
    await expect(mintRestrictedToken(cfg, keys.privateKey, undefined as any, NOW)).rejects.toBeInstanceOf(AuthDenied);
  });
});
