import { describe, expect, test } from "bun:test";
import { serveBoard } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CLICKUP_API_TOKEN: "token",
};
const args = {
  locationId: "locFormula0001",
  metric: "cpl",
  lever: "Move budget to the winning ad set",
  department: "media_buyer",
};

function deps(options: { user?: boolean; gate?: { data: unknown; error: { message: string } | null }; env?: Record<string, string> } = {}) {
  const made: { key: string; options: Record<string, unknown> }[] = [];
  return {
    made,
    deps: {
      env: (name: string) => (options.env ?? ENV)[name],
      createClient: (_url: string, key: string, o: Record<string, unknown>) => {
        made.push({ key, options: o });
        return {
          auth: {
            getUser: async () => (options.user === false ? { data: { user: null }, error: { message: "bad" } } : { data: { user: { id: "u" } }, error: null }),
          },
          rpc: async () => options.gate ?? { data: null, error: { message: "This client is not on your board." } },
          from: () => ({ insert: async () => ({ error: null }) }),
        };
      },
      request: (async () => {
        throw new Error("no provider call expected");
      }) as unknown as typeof fetch,
    },
  };
}
const post = (body: unknown, auth = "Bearer seat-token") =>
  new Request("https://example.supabase.co/functions/v1/cockpit-board-api", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("the board function's door", () => {
  test("only POST, only signed in", async () => {
    const d = deps();
    expect((await serveBoard(new Request("https://x/", { method: "GET" }), d.deps)).status).toBe(405);
    expect((await serveBoard(new Request("https://x/", { method: "OPTIONS" }), d.deps)).status).toBe(200);
    expect((await serveBoard(post({ operation: "lever", args }, ""), d.deps)).status).toBe(401);
    expect((await serveBoard(post({ operation: "lever", args }), deps({ user: false }).deps)).status).toBe(401);
  });

  test("the seat's own token reaches the gate; the service key is a separate client", async () => {
    const d = deps();
    const res = await serveBoard(post({ operation: "lever", args }), d.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This client is not on your board." });
    expect(d.made[0]).toEqual({
      key: "anon",
      options: { global: { headers: { Authorization: "Bearer seat-token" } }, auth: { persistSession: false } },
    });
    expect(d.made[1]).toEqual({ key: "service", options: { auth: { persistSession: false } } });
  });

  test("anything but a lever, or no JSON, is refused plainly", async () => {
    const d = deps();
    expect((await serveBoard(post({ operation: "act", args }), d.deps)).status).toBe(400);
    expect((await serveBoard(post("not json"), d.deps)).status).toBe(400);
    const bad = await serveBoard(post({ operation: "lever", args: { ...args, department: "sales" } }), d.deps);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/department that owns it/);
  });

  test("missing Supabase settings say so", async () => {
    const res = await serveBoard(post({ operation: "lever", args }), deps({ env: {} }).deps);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/missing its Supabase settings/);
  });
});
