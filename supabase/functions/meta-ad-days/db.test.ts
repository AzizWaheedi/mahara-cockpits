import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NOT_ALLOWED, NOT_SET, RPCS, RpcError, restRpc } from "./db.ts";
import { retryable } from "./run.ts";

describe("the RPC door", () => {
  test("every RPC run.ts and door.ts call is on the list (cockpit_meta_lead_ids_apply was not, until 2026-10-17)", () => {
    const called = new Set<string>();
    for (const file of ["run.ts", "door.ts"]) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const m of src.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) called.add(m[1]);
    }
    expect(called.size).toBeGreaterThanOrEqual(11);
    for (const name of called) expect({ name, listed: RPCS.has(name) }).toEqual({ name, listed: true });
    for (const name of ["cockpit_meta_lead_ids_apply", "cockpit_meta_budgets_apply", "cockpit_meta_budget_history_apply"]) {
      expect(called.has(name)).toBe(true);
    }
  });

  test("a name not on the list is refused before any request, and no later try is made", async () => {
    let requests = 0;
    const rpc = restRpc("https://x.supabase.co", "service-key", (async () => {
      requests += 1;
      return new Response("{}");
    }) as unknown as typeof fetch);
    let caught: unknown = null;
    try {
      await rpc("cockpit_board_read", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect((caught as RpcError).code).toBe(NOT_ALLOWED);
    expect((caught as RpcError).message).toContain("add it to RPCS");
    expect(retryable(caught)).toBe(false);
    expect(requests).toBe(0);
    const unset = restRpc("", "", (async () => new Response("{}")) as unknown as typeof fetch);
    const e2 = await unset("cockpit_meta_ad_days_status", {}).catch(e => e);
    expect((e2 as RpcError).code).toBe(NOT_SET);
    expect(retryable(e2)).toBe(false);
    // The database not answering is still worth another try.
    expect(retryable(new RpcError("The database answered 503", null))).toBe(true);
  });
});
