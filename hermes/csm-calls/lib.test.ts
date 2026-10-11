import { expect, test } from "bun:test";
import { makeTransport, ProviderError } from "./lib";

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
