import { afterEach, expect, test } from "bun:test";
import { convexToJson } from "convex/values";
import { list, scope } from "../convex/clientLogos";

const invoke = (fn: unknown, ctx: unknown, args: unknown = {}) => {
  if (
    !fn ||
    (typeof fn !== "function" && typeof fn !== "object") ||
    !("_handler" in fn) ||
    typeof fn._handler !== "function"
  ) {
    throw new Error("Expected a registered Convex function");
  }
  return fn._handler(ctx, args);
};
const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

function context(roles = ["media_buyer"], clients: string[] = []) {
  const db = {
    get: async () => ({ email: "buyer@example.com" }),
    query: () => ({
      withIndex: () => ({ unique: async () => ({ roles, clients }) }),
    }),
  };
  return {
    auth: { getUserIdentity: async () => ({ subject: "buyer|session" }) },
    runQuery: async (_query: unknown, args: unknown) =>
      invoke(scope, { db }, args),
    runMutation: async () => {},
  };
}

function serve(rows: unknown, status = 200) {
  process.env.SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(rows), { status })) as typeof fetch;
}

test("client logos reject unauthenticated and wrong-role callers before fetching", async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("Unexpected fetch");
  }) as typeof fetch;
  await expect(
    invoke(list, { auth: { getUserIdentity: async () => null } }),
  ).rejects.toThrow("Not authenticated");
  await expect(invoke(list, context(["creative"]))).rejects.toThrow(
    "This cockpit is not yours",
  );
  expect(fetched).toBe(false);
});

test("client logos use exact normalized scope and durable bucket URLs", async () => {
  serve([
    {
      client_key: " ACME ",
      storage_path: "verified/acme.png",
      source_url: "https://instagram.com/temporary",
    },
    { client_key: "acme extra", storage_path: "other.png" },
    { client_key: "other", storage_path: "other.png" },
  ]);
  const ctx = context(["media_buyer"], [" AcMe "]);
  expect(await invoke(list, ctx)).toEqual([
    {
      clientKey: "acme",
      url: "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-client-logos/verified/acme.png",
    },
  ]);
});

test("client logos normalize display keys without widening client scope", async () => {
  serve([
    { client_key: " City Wood ", storage_path: "city-wood.png" },
    { client_key: "citywood", storage_path: "not-allowed.png" },
  ]);
  expect(await invoke(list, context(["media_buyer"], [" City Wood "]))).toEqual(
    [
      {
        clientKey: "citywood",
        url: "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-client-logos/city-wood.png",
      },
    ],
  );
});

test("client logos omit unsafe paths and non-raster files", async () => {
  serve([
    ...[
      "https://evil.test/a.png",
      "/a.png",
      "../a.png",
      "a/../b.png",
      "a%2fb.png",
      "a.png?x=1",
      "a.svg",
      "a\\b.png",
    ].map((storage_path, i) => ({ client_key: `bad${i}`, storage_path })),
    { client_key: "valid", storage_path: "client/logo-2.webp" },
  ]);
  expect(await invoke(list, context(["admin"]))).toEqual([
    {
      clientKey: "valid",
      url: "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-client-logos/client/logo-2.webp",
    },
  ]);
});

test("client logo store failures remain errors rather than missing logos", async () => {
  serve({ message: "unavailable" }, 503);
  const ctx = context();
  await expect(invoke(list, ctx)).rejects.toThrow("503");
});

test("Arabic client logos survive Convex serialization without widening scope", async () => {
  serve([
    { client_key: "شركة العلا", storage_path: "alola.png" },
    { client_key: "شركةالعلا", storage_path: "not-allowed.png" },
  ]);
  const result = await invoke(list, context(["media_buyer"], ["شركة العلا"]));
  expect(convexToJson(result)).toEqual([
    {
      clientKey: "شركةالعلا",
      url: "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-client-logos/alola.png",
    },
  ]);
});
