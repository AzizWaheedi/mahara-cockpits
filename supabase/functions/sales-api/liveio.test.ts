// bun test supabase/functions/sales-api/liveio.test.ts
import { describe, expect, test } from "bun:test";
import { ApiRefusal, constraintOf, DbError, dbErrorOf, GhlError, isUnique, makeLiveIO, uuidFrom } from "./liveio.ts";

const env = (n: string) =>
  ({ SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service-key", SALES_GHL_TOKEN: "pit-abc-123" })[n] ?? "";

describe("errors", () => {
  test("a unique violation names its constraint, so a refusal is read by name, never guessed", () => {
    const e = dbErrorOf(409, JSON.stringify({ code: "23505", message: 'duplicate key value violates unique constraint "cockpit_sales_rooms_one_per_lead"' }));
    expect([e.status, e.code, e.constraint]).toEqual([409, "23505", "cockpit_sales_rooms_one_per_lead"]);
    expect(isUnique(e)).toBe(true);
    expect(isUnique(e, "cockpit_sales_rooms_one_per_lead")).toBe(true);
    expect(isUnique(e, "cockpit_sales_rooms_one_per_host")).toBe(false);
    expect(isUnique(new Error("x"))).toBe(false);
    expect(constraintOf("nothing here")).toBeNull();
  });
  test("an error body never carries a key", () => {
    const e = dbErrorOf(500, "Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijk failed");
    expect(e.message).not.toContain("eyJ");
  });
  test("ApiRefusal carries its extra keys", () => {
    const r = new ApiRefusal("Try again.", 503, { code: "busy", retry: true });
    expect([r.message, r.status, r.extra.retry]).toEqual(["Try again.", 503, true]);
  });
});

describe("makeLiveIO", () => {
  test("a call that runs out of time is a DbError with status 0 that says so", async () => {
    const timedOut = (async () => {
      throw Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const io = makeLiveIO({ env, fetch: timedOut });
    const e = (await io.db("x").catch(x => x)) as DbError;
    expect(e).toBeInstanceOf(DbError);
    expect([e.status, e.message]).toEqual([0, "database: no answer within 8 s"]);
    const g = (await io.ghl("GET", "/contacts/x").catch(x => x)) as GhlError;
    expect([g.status, g.message]).toEqual([0, "HighLevel did not answer: no answer within 15 s"]);
  });

  test("every call carries a deadline (an AbortSignal)", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      signals.push(init.signal);
      return new Response("[]");
    }) as unknown as typeof fetch;
    const io = makeLiveIO({ env, fetch: f });
    await io.db("x");
    await io.rpc("f", {});
    await io.ghl("GET", "/y");
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true);
    expect(signals).toHaveLength(3);
  });

  test("the service key goes in both headers; Prefer passes through; a 409 is a DbError with its constraint", async () => {
    const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(JSON.stringify({ code: "23505", message: 'violates unique constraint "cockpit_sales_rooms_request_id_key"' }), { status: 409 });
    }) as unknown as typeof fetch;
    const io = makeLiveIO({ env, fetch: f });
    const e = (await io.db("cockpit_sales_rooms", { method: "POST", body: { a: 1 }, prefer: "return=representation" }).catch(x => x)) as DbError;
    expect(e.constraint).toBe("cockpit_sales_rooms_request_id_key");
    expect(seen[0]?.url).toBe("https://db.example/rest/v1/cockpit_sales_rooms");
    expect(seen[0]?.headers).toMatchObject({ apikey: "service-key", Authorization: "Bearer service-key", Prefer: "return=representation" });
  });

  test("an rpc answers its JSON; HighLevel's failure is a GhlError with its status and no token", async () => {
    const f = (async (url: string) => {
      if (url.includes("/rpc/")) return new Response('"7b0b3140-0000-4000-8000-000000000001"', { status: 200 });
      return new Response(JSON.stringify({ message: "token pit-abc-123 is not allowed" }), { status: 401 });
    }) as unknown as typeof fetch;
    const io = makeLiveIO({ env, fetch: f });
    expect(await io.rpc("cockpit_sales_room_event_lease", { p_event_id: "x" })).toBe("7b0b3140-0000-4000-8000-000000000001");
    const e = (await io.ghl("GET", "/contacts/x").catch(x => x)) as GhlError;
    expect(e).toBeInstanceOf(GhlError);
    expect(e.status).toBe(401);
    expect(e.message).not.toContain("pit-abc-123");
  });

  test("HighLevel with no token says so and calls nothing", async () => {
    let called = false;
    const io = makeLiveIO({ env: () => "", fetch: (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch });
    const e = (await io.ghl("GET", "/contacts/x").catch(x => x)) as GhlError;
    expect([e.status, called]).toEqual([0, false]);
  });
});

test("uuidFrom: the same seed is the same id, a valid version 5 UUID; a different seed differs", async () => {
  const a = await uuidFrom("mahara-room/link/r1/email");
  expect(a).toBe(await uuidFrom("mahara-room/link/r1/email"));
  expect(a).not.toBe(await uuidFrom("mahara-room/link/r1/whatsapp_text"));
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
