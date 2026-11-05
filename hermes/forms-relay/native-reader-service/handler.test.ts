import { beforeAll, describe, expect, test } from "bun:test";
import { base64url, type Policy } from "./auth.ts";
import { candidateHandler, type Snapshot } from "./handler.ts";

const seconds = 1_800_000_000;
const policy: Policy = { audience: "https://example.invalid", repositoryId: "1", ownerId: "2", workflowRef: "example/research/.github/workflows/test.yml@refs/heads/main", workflowSha: "a".repeat(40), ref: "refs/heads/main", subject: "repo:example/research:environment:test", environment: "test" };
const pins = { 2: { schema: "a".repeat(64), printer: "b".repeat(64), allowedRefs: { ref_2: "Different version question" } }, 3: { schema: "c".repeat(64), printer: "d".repeat(64), allowedRefs: { ref_1: "Fictional question" } } };
const config = { enabled: true, policy, pins };
const text = new TextEncoder().encode("fictional delivered text");
let hash = ""; let jwt = ""; let key: JsonWebKey & { kid: string; alg: string; use: string };
const encode = (x: unknown) => base64url(new TextEncoder().encode(JSON.stringify(x)));
let binding: Record<string, unknown>;
let snapshot: Snapshot;
beforeAll(async () => {
  hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", text)), n => n.toString(16).padStart(2, "0")).join("");
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  key = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "test", alg: "RS256", use: "sig" };
  const head = encode({ alg: "RS256", typ: "JWT", kid: "test" });
  const claims = encode({ iss: "https://token.actions.githubusercontent.com", aud: policy.audience, sub: policy.subject, repository_id: "1", repository_owner_id: "2", workflow_ref: policy.workflowRef, workflow_sha: policy.workflowSha, ref: policy.ref, event_name: "repository_dispatch", environment: policy.environment, iat: seconds - 3, nbf: seconds - 3, exp: seconds + 120, run_id: "10", run_attempt: "1" });
  const signing = `${head}.${claims}`;
  jwt = `${signing}.${base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signing))))}`;
  binding = { taskId: "synthetic", responseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", schemaVersion: 3, commentId: "synthetic_comment", commentSha256: hash, capability: base64url(new Uint8Array(32).fill(7)) };
  snapshot = { taskId: String(binding.taskId), responseId: String(binding.responseId), schemaVersion: 3, commentId: String(binding.commentId), commentSha256: hash,
    submittedAt: "2026-01-01T00:00:00.000Z", schemaHash: pins[3].schema, printerHash: pins[3].printer, source: "native", state: "submitted", mode: "live", latest: true, verifiedReceipt: true, complete: true,
    answers: [{ ref: "ref_1", title: "Fictional question", value: "Fictional answer" }] };
});
function setup(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const ports = {
    githubKeys: async () => { calls.push("keys"); return [key]; },
    permit: async () => { calls.push("rate"); return true; },
    comment: async (taskId: string, commentId: string) => { calls.push("comment"); return { taskId, commentId, bytes: text }; },
    readAtomic: async () => { calls.push("atomic"); return snapshot; },
    recheckAtomic: async () => { calls.push("recheck"); return true; }, ...overrides,
  };
  return { handler: candidateHandler(config, ports, () => seconds), calls, ports };
}
function req(payload: unknown = binding, token = jwt, extra: Record<string, string> = {}) {
  return new Request("https://reader.invalid", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra }, body: JSON.stringify(payload) });
}

describe("reader HTTP boundary, isolated fakes", () => {
  test("is off by default without accessing dependencies", async () => {
    const { calls } = setup(); const r = await candidateHandler(null, null)(req());
    expect(r.status).toBe(404); expect(calls).toEqual([]); expect(r.headers.get("cache-control")).toContain("no-store");
  });
  test("a truthy string cannot enable the feature", async () => {
    const { calls, ports } = setup();
    const misconfigured = { ...config, enabled: "false" } as unknown as typeof config;
    expect((await candidateHandler(misconfigured, ports)(req())).status).toBe(404); expect(calls).toEqual([]);
  });
  test("emits only selected response fields after identity, receipt and atomic checks", async () => {
    const { handler, calls } = setup(); const r = await handler(req());
    expect(r.status).toBe(200); expect(calls).toEqual(["rate", "keys", "atomic", "comment", "recheck"]);
    expect(await r.json()).toEqual({ taskId: snapshot.taskId, responseId: snapshot.responseId, schemaVersion: 3, submittedAt: snapshot.submittedAt, answers: snapshot.answers });
  });
  test("denies a fake identity before reading a comment or response", async () => {
    const { handler, calls } = setup(); expect((await handler(req(binding, "not.a.jwt"))).status).toBe(403);
    expect(calls).not.toContain("comment"); expect(calls).not.toContain("atomic");
  });
  test("denies a provider receipt mismatch before returning data", async () => {
    const { handler, calls } = setup({ comment: async () => ({ taskId: "another", commentId: binding.commentId, bytes: text }) });
    expect((await handler(req())).status).toBe(403); expect(calls).toContain("atomic");
  });
  test("denies modified provider text", async () => {
    const { handler, calls } = setup({ comment: async () => ({ taskId: binding.taskId, commentId: binding.commentId, bytes: new TextEncoder().encode("different") }) });
    expect((await handler(req())).status).toBe(403); expect(calls).toContain("atomic");
  });
  test("does not call the privileged provider when the capability check fails", async () => {
    const { handler, calls } = setup({ readAtomic: async () => null });
    expect((await handler(req())).status).toBe(403); expect(calls).not.toContain("comment");
  });
  test("does not return a response superseded during the provider read", async () => {
    const { handler } = setup({ recheckAtomic: async () => false }); expect((await handler(req())).status).toBe(403);
  });
  test("denies provider failures without leaking exception content", async () => {
    const { handler } = setup({ comment: async () => { throw Error("synthetic secret"); } });
    const r = await handler(req()); expect(r.status).toBe(403); expect(await r.text()).toBe('{"error":"Request denied"}');
  });
  test("denies a failed rate gate before identity verification", async () => {
    const { handler, calls } = setup({ permit: async () => false }); expect((await handler(req())).status).toBe(403); expect(calls).toEqual([]);
  });
  test.each(["taskId", "responseId", "schemaVersion", "commentId", "commentSha256", "schemaHash", "printerHash", "source", "state", "mode", "latest", "verifiedReceipt", "complete"])("denies a mismatch in %s", async field => {
    const { handler, calls } = setup({ readAtomic: async () => ({ ...snapshot, [field]: null }) }); expect((await handler(req())).status).toBe(403); expect(calls).not.toContain("comment");
  });
  test("denies extra source fields and blank answers before querying the comment provider", async () => {
    const samples = [
      { ...snapshot, unreviewed: "private synthetic sample" },
      { ...snapshot, answers: [{ ...snapshot.answers[0], value: "  \n " }] },
    ];
    for (const sample of samples) {
      const { handler, calls } = setup({ readAtomic: async () => sample });
      const result = await handler(req());
      expect(result.status).toBe(403);
      expect(await result.text()).not.toContain("private synthetic sample");
      expect(calls).not.toContain("comment");
    }
  });
  test("rejects unexpected request properties and oversize input before provider calls", async () => {
    for (const payload of [{ ...binding, answers: "private" }, { ...binding, extra: "a".repeat(9000) }]) {
      const { handler, calls } = setup(); expect((await handler(req(payload))).status).toBe(403); expect(calls).not.toContain("comment");
    }
  });
  test("rejects duplicate or unexpected answer fields", async () => {
    for (const answers of [[...snapshot.answers, ...snapshot.answers], [{ ...snapshot.answers[0], extra: "private" }]]) {
      const { handler } = setup({ readAtomic: async () => ({ ...snapshot, answers }) }); expect((await handler(req())).status).toBe(403);
    }
  });
  test("rejects unapproved and contact refs and version-mismatched titles", async () => {
    for (const answer of [{ ref: "ref_1", title: "Changed title", value: "fictional" },
      { ref: "contact_phone", title: "Phone", value: "fictional" },
      { ref: "ref_2", title: "Different version question", value: "fictional" }]) {
      const { handler, calls } = setup({ readAtomic: async () => ({ ...snapshot, answers: [answer] }) });
      expect((await handler(req())).status).toBe(403); expect(calls).not.toContain("comment");
    }
  });
  test("requires a real canonical UTC instant", async () => {
    for (const submittedAt of ["2026-02-30T00:00:00.000Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00+00:00", "invalid"]) {
      const { handler } = setup({ readAtomic: async () => ({ ...snapshot, submittedAt }) });
      expect((await handler(req())).status).toBe(403);
    }
  });
  test("times out stalled provider and database ports and aborts them", async () => {
    const observed: AbortSignal[] = [];
    const stalledDb = setup({ readAtomic: async (_r: unknown, _h: unknown, _i: unknown, signal: AbortSignal) => {
      observed.push(signal); return await new Promise<Snapshot>(() => {});
    } });
    const stalledProvider = setup({ comment: async (_task: unknown, _id: unknown, signal: AbortSignal) => {
      observed.push(signal); return await new Promise<never>(() => {});
    } });
    const result = await Promise.all([stalledDb.handler(req()), stalledProvider.handler(req())]);
    expect(result.map(r => r.status)).toEqual([403, 403]);
    expect(observed).toHaveLength(2); expect(observed.every(s => s.aborted)).toBe(true);
    expect(stalledDb.calls).not.toContain("comment"); expect(stalledProvider.calls).not.toContain("recheck");
  }, 10_000);
});
