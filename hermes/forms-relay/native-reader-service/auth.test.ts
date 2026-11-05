import { beforeAll, describe, expect, test } from "bun:test";
import { authorizeAndRead, base64url, capabilityHash, Denied, parseRequest, verifyGithub, type AtomicReader, type Identity, type Policy, type Request } from "./auth";

const policy: Policy = { audience: "https://test.invalid/native-reader", repositoryId: "1234", ownerId: "5678", workflowRef: "example/research/.github/workflows/market.yml@refs/heads/main", workflowSha: "a".repeat(40), ref: "refs/heads/main", subject: "repo:example/research:environment:research", environment: "research" };
const now = 1_800_000_000;
let pair: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string; alg: string; use: string };
const valid = () => ({ iss: "https://token.actions.githubusercontent.com", aud: policy.audience, sub: policy.subject, repository_id: policy.repositoryId, repository_owner_id: policy.ownerId, workflow_ref: policy.workflowRef, workflow_sha: policy.workflowSha, ref: policy.ref, event_name: "repository_dispatch", environment: policy.environment, iat: now - 3, nbf: now - 3, exp: now + 120, run_id: "112233", run_attempt: "1" });
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
async function issue(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "test-key" }): Promise<string> {
  const signed = `${encode(header)}.${encode(claims)}`;
  return `${signed}.${base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signed))))}`;
}
beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
});
const keys = async () => [jwk];

describe("signed GitHub identity", () => {
  test("accepts only a signed token for the exact intended repository, workflow, event, environment and run", async () => {
    expect(await verifyGithub(await issue(valid()), policy, keys, now)).toEqual({ runId: "112233", attempt: "1" });
  });
  for (const [field, value] of Object.entries({ iss: "https://attacker.invalid", aud: "wrong", sub: "wrong", repository_id: "1235", repository_owner_id: "5679", workflow_ref: "example/research/.github/workflows/other.yml@refs/heads/main", workflow_sha: "b".repeat(40), ref: "refs/heads/other", event_name: "push", environment: "other", run_id: "", run_attempt: "0", iat: now + 31, nbf: now + 31, exp: now - 31 })) {
    test(`rejects signed but wrong ${field}`, async () => {
      await expect(verifyGithub(await issue({ ...valid(), [field]: value }), policy, keys, now)).rejects.toBeInstanceOf(Denied);
    });
  }
  test("rejects old tokens, long lifetimes, malformed IDs, unsupported or attacker-controlled keys", async () => {
    for (const changes of [{ iat: now - 601 }, { exp: now + 601 }, { run_id: 123 }, { run_attempt: "01" }]) {
      await expect(verifyGithub(await issue({ ...valid(), ...changes }), policy, keys, now)).rejects.toBeInstanceOf(Denied);
    }
    for (const header of [{ alg: "none", kid: "test-key" }, { alg: "RS256", kid: "test-key", jku: "https://attacker.invalid" }, { alg: "RS256", kid: "test-key", crit: ["foo"] }]) {
      await expect(verifyGithub(await issue(valid(), header), policy, keys, now)).rejects.toBeInstanceOf(Denied);
    }
    await expect(verifyGithub(await issue(valid()), policy, async () => [jwk, jwk], now)).rejects.toBeInstanceOf(Denied);
  });
  test("rejects modified payloads and unknown signing keys", async () => {
    const original = (await issue(valid())).split(".");
    original[1] = encode({ ...valid(), repository_id: "9999" });
    await expect(verifyGithub(original.join("."), policy, keys, now)).rejects.toBeInstanceOf(Denied);
    await expect(verifyGithub(await issue(valid()), policy, async () => [], now)).rejects.toBeInstanceOf(Denied);
    await expect(verifyGithub(await issue(valid()), policy, async () => { throw Error("provider detail"); }, now)).rejects.toBeInstanceOf(Denied);
    await expect(verifyGithub(await issue(valid()), { ...policy, workflowSha: "" }, keys, now)).rejects.toBeInstanceOf(Denied);
  });
});

const capability = base64url(new Uint8Array(32).fill(7));
const request: Request = { taskId: "test_card", responseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", schemaVersion: 3, commentId: "test_comment", commentSha256: "a".repeat(64), capability };
type RecordState = { hash: string; taskId: string; responseId: string; version: number; commentId: string; digest: string; expires: number; enabled: boolean; native: boolean; submitted: boolean; live: boolean; latest: boolean; delivered: boolean; reads: number; bound?: Identity };
/** In-memory simulation of required atomic behavior; never used by production. */
class FakeAtomicReader implements AtomicReader<{ refs: string[] }> {
  constructor(public row: RecordState) {}
  async consumeAndRead({ request: r, capability, identity, now: time }: Parameters<AtomicReader<{ refs: string[] }>["consumeAndRead"]>[0]) {
    const hash = await capabilityHash(capability);
    const s = this.row;
    if (!s.enabled || time >= s.expires || !s.native || !s.submitted || !s.live || !s.latest || !s.delivered
      || s.hash !== hash || s.taskId !== r.taskId || s.responseId !== r.responseId || s.version !== r.schemaVersion
      || s.commentId !== r.commentId || s.digest !== r.commentSha256 || s.reads >= 2
      || (s.bound && (s.bound.runId !== identity.runId || s.bound.attempt !== identity.attempt))) return null;
    s.bound = identity; s.reads += 1;
    return { refs: ["fictional_test_ref"] };
  }
}
async function fake() { return new FakeAtomicReader({ hash: await capabilityHash(capability), taskId: request.taskId, responseId: request.responseId, version: 3, commentId: request.commentId, digest: request.commentSha256, expires: now + 300, enabled: true, native: true, submitted: true, live: true, latest: true, delivered: true, reads: 0 }); }
const job = { runId: "112233", attempt: "1" };

describe("one-response capability contract", () => {
  test("accepts exactly matched data and bounded retries for the same run", async () => {
    const db = await fake();
    expect(await authorizeAndRead(request, job, db, now)).toEqual({ refs: ["fictional_test_ref"] });
    expect(await authorizeAndRead(request, job, db, now)).toEqual({ refs: ["fictional_test_ref"] });
    await expect(authorizeAndRead(request, job, db, now)).rejects.toBeInstanceOf(Denied);
  });
  test("different jobs cannot concurrently use the same capability", async () => {
    const db = await fake();
    const result = await Promise.allSettled([authorizeAndRead(request, job, db, now), authorizeAndRead(request, { runId: "9988", attempt: "1" }, db, now)]);
    expect(result.filter(x => x.status === "fulfilled")).toHaveLength(1);
  });
  for (const field of ["enabled", "native", "submitted", "live", "latest", "delivered"] as const) {
    test(`denies when ${field} is false`, async () => {
      const db = await fake(); db.row[field] = false;
      await expect(authorizeAndRead(request, job, db, now)).rejects.toBeInstanceOf(Denied);
      expect(db.row.reads).toBe(0);
    });
  }
  test("rejects wrong capability, task, response, version, receipt or expired capability", async () => {
    for (const changes of [{ capability: base64url(new Uint8Array(32).fill(8)) }, { taskId: "other" }, { responseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, { schemaVersion: 2 }, { commentId: "other" }, { commentSha256: "b".repeat(64) }]) {
      const db = await fake(); await expect(authorizeAndRead({ ...request, ...changes }, job, db, now)).rejects.toBeInstanceOf(Denied);
      expect(db.row.reads).toBe(0);
    }
    const db = await fake(); db.row.expires = now;
    await expect(authorizeAndRead(request, job, db, now)).rejects.toBeInstanceOf(Denied);
  });
  test("rejects added data, malformed IDs, unknown version and noncanonical capabilities", () => {
    for (const changes of [{ answers: "private" }, { taskId: "bad/value" }, { responseId: "not-a-uuid" }, { schemaVersion: 4 }, { capability: "a".repeat(42) }]) expect(() => parseRequest({ ...request, ...changes })).toThrow(Denied);
  });
});
