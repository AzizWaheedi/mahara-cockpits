import { expect, test } from "bun:test";
import { fathomPathAllowed, makeDb, makeTransport, ProviderError, SUPABASE } from "./lib";

test("the transport refuses provider writes and unknown hosts, and names the provider on failure", async () => {
  const fake = (async () => new Response("{\"error\":\"nope\"}", { status: 401 })) as unknown as typeof fetch;
  const t = makeTransport({ GHL_CLIENT_PIT: "x", FATHOM_API_KEY: "y" }, "test", fake, async () => {});
  const err = await t.ghl("calendars/", { locationId: "l" }, "2021-04-15").catch(e => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err.provider).toBe("ghl");
  expect(err.status).toBe(401);
  expect(t.receipts.some(r => r.phase === "response" && r.http_status === 401)).toBe(true);
});

test("an HTTP 200 whose body is an error counts as a failure", async () => {
  const fake = (async () => new Response("{\"error\":{\"message\":\"API access blocked.\"}}", { status: 200 })) as unknown as typeof fetch;
  const t = makeTransport({ META_SYSTEM_TOKEN: "x" }, "test", fake, async () => {});
  await expect(t.meta("act_1/activities", {})).rejects.toBeInstanceOf(ProviderError);
});

test("only Fathom's meetings endpoint is reachable", async () => {
  const t = makeTransport({ FATHOM_API_KEY: "y" }, "test", (async () => new Response("{}")) as unknown as typeof fetch, async () => {});
  await expect(t.fathom(new URLSearchParams())).resolves.toEqual({});
});

test("a missing key is named, not printed", async () => {
  const t = makeTransport({}, "test", (async () => new Response("{}")) as unknown as typeof fetch, async () => {});
  expect(() => t.typeform("forms/x")).toThrow("Missing named key: TYPEFORM_TOKEN");
});

// docs/forms/STAGE2-CONTRACT.md 4.1: the guard allows the meetings list and a
// recording's summary or transcript, nothing else, and never anything but a GET.
test("the Fathom guard allows the meetings list and a recording's summary or transcript only", () => {
  for (const ok of ["/external/v1/meetings", "/external/v1/recordings/196122376/summary", "/external/v1/recordings/196122376/transcript"])
    expect(fathomPathAllowed(ok)).toBe(true);
  for (const no of [
    "/external/v1/webhooks",
    "/external/v1/webhooks/123456789",
    "/external/v1/users",
    "/external/v1/recordings/1/download",
    "/external/v1/recordings/196122376",
    "/external/v1/recordings/abc/transcript",
    "/external/v1/recordings/196122376/transcript/extra",
    "/external/v1/recordings//summary",
    "/external/v1/meetings/196122376",
    "/external/v1/meetings/",
    "/external/v1/teams",
    "/",
    "",
  ])
    expect(fathomPathAllowed(no)).toBe(false);
});

test("every Fathom read is a GET to an allowed path, and a recording's receipt keeps no id", async () => {
  const seen: { url: string; method: string; key: string | null }[] = [];
  const fake = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, method: init.method ?? "GET", key: new Headers(init.headers).get("X-Api-Key") });
    return new Response("{\"transcript\":[]}");
  }) as unknown as typeof fetch;
  const t = makeTransport({ FATHOM_API_KEY: "k-test" }, "run-1", fake, async () => {});
  await t.fathom(new URLSearchParams({ created_after: "2026-10-21T00:00:00Z" }));
  await t.fathomRecording("196122376", "transcript");
  await t.fathomRecording("196122376", "summary");
  expect(seen.map(s => [new URL(s.url).pathname, s.method, s.key])).toEqual([
    ["/external/v1/meetings", "GET", "k-test"],
    ["/external/v1/recordings/196122376/transcript", "GET", "k-test"],
    ["/external/v1/recordings/196122376/summary", "GET", "k-test"],
  ]);
  expect([...new Set(t.receipts.map(r => r.resource))]).toEqual([
    "api.fathom.ai/external/v1/meetings",
    "api.fathom.ai/external/v1/recordings/:id/transcript",
    "api.fathom.ai/external/v1/recordings/:id/summary",
  ]);
  expect(t.receipts.filter(r => r.phase === "intent")).toHaveLength(3);
  expect(t.receipts.every(r => r.method === "GET" && r.provider === "fathom" && r.run_key === "run-1")).toBe(true);
});

test("a recording read needs a numeric id and a summary or transcript, and asks nothing when refused", () => {
  let asked = 0;
  const counted = (async () => {
    asked++;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const t = makeTransport({ FATHOM_API_KEY: "y" }, "test", counted, async () => {});
  for (const id of ["", "12", "abc", "196122376/download", "../users", "1".repeat(21)])
    expect(() => t.fathomRecording(id, "transcript")).toThrow("A Fathom recording id is 3 to 20 digits");
  expect(() => t.fathomRecording("196122376", "download" as "summary")).toThrow("Only a recording's summary or transcript can be read");
  expect(asked).toBe(0);
  expect(t.receipts).toHaveLength(0);
});

test("a refused recording read names Fathom and its status, like any provider read", async () => {
  const fake = (async () => new Response("{\"error\":\"not found\"}", { status: 404 })) as unknown as typeof fetch;
  const t = makeTransport({ FATHOM_API_KEY: "y" }, "test", fake, async () => {});
  const err = await t.fathomRecording("196122376", "transcript").catch(e => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect([err.provider, err.status]).toEqual(["fathom", 404]);
  expect(t.receipts.map(r => [r.phase, r.http_status ?? null])).toEqual([["intent", null], ["response", 404]]);
});

test("storageRemove deletes one transcript object, and an object that is not there counts as removed", async () => {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  let answer: () => Response = () => new Response("{\"message\":\"Successfully deleted\"}");
  const fake = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", auth: new Headers(init.headers).get("Authorization") });
    return answer();
  }) as unknown as typeof fetch;
  const db = makeDb({ SUPABASE_SERVICE_ROLE_KEY: "service-test" }, fake);
  await db.storageRemove("fathom/196122376.txt");
  expect(calls).toEqual([
    { url: `${SUPABASE}/storage/v1/object/csm-call-transcripts/fathom/196122376.txt`, method: "DELETE", auth: "Bearer service-test" },
  ]);
  answer = () => new Response("{\"error\":\"not_found\"}", { status: 404 });
  await expect(db.storageRemove("fathom/196122376.txt")).resolves.toBeUndefined();
  answer = () => new Response("{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\"}", { status: 400 });
  await expect(db.storageRemove("fathom/196122376.txt")).resolves.toBeUndefined();
  answer = () => new Response("{\"statusCode\":\"403\",\"error\":\"Unauthorized\"}", { status: 400 });
  await expect(db.storageRemove("fathom/196122376.txt")).rejects.toThrow("Transcript removal failed (400)");
  answer = () => new Response("down", { status: 503 });
  await expect(db.storageRemove("fathom/196122376.txt")).rejects.toThrow("Transcript removal failed (503)");
});

test("storageRemove refuses anything but a Fathom transcript object, before any request", async () => {
  let asked = 0;
  const counted = (async () => {
    asked++;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const db = makeDb({ SUPABASE_SERVICE_ROLE_KEY: "service-test" }, counted);
  for (const path of ["", "fathom/", "fathom/abc.txt", "fathom/196122376.txt/../x", "../fathom/196122376.txt", "sales/196122376.txt", "fathom/196122376"])
    await expect(db.storageRemove(path)).rejects.toThrow("Only a Fathom transcript object can be removed");
  expect(asked).toBe(0);
});
