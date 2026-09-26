import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchWebinarTargetContext,
  saveWebinarTargets,
} from "../src/lib/webinarTargetsClient";
import {
  WEBINAR_TARGETS,
  type TargetEditorState,
  type TargetVersion,
  type WebinarTargets,
} from "../src/types/ceo/webinarTargetsModel";

function createMockSupabaseClient(
  rpcHandler: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
): SupabaseClient {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => rpcHandler(fn, args),
  } as unknown as SupabaseClient;
}

const validVersion: TargetVersion = {
  scope_key: "defaults",
  revision: 1,
  values: structuredClone(WEBINAR_TARGETS),
  changed_at: "2026-09-26T10:00:00Z",
  changed_by: "founder@maharamedia.com",
};

describe("webinarTargetsClient contract and pure logic", () => {
  test("throws when client is null", async () => {
    // @ts-expect-error testing null client
    await expect(fetchWebinarTargetContext(null, "defaults")).rejects.toThrow(
      "Supabase client is required",
    );
    // @ts-expect-error testing null client
    await expect(
      saveWebinarTargets(null, {
        scope: "defaults",
        expectedRevision: 0,
        values: WEBINAR_TARGETS,
        requestId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow("Supabase client is required");
  });

  test("fetchWebinarTargetContext calls cockpit_ceo_webinar_target_context RPC and parses valid response", async () => {
    let calledRpc = "";
    let calledArgs: Record<string, unknown> = {};

    const client = createMockSupabaseClient(async (fn, args) => {
      calledRpc = fn;
      calledArgs = args;
      return {
        data: {
          scope: "defaults",
          startedAt: null,
          own: [validVersion],
          inherited: [],
        },
        error: null,
      };
    });

    const result = await fetchWebinarTargetContext(client, "defaults");
    expect(calledRpc).toBe("cockpit_ceo_webinar_target_context");
    expect(calledArgs).toEqual({ p_scope: "defaults" });
    expect(result.scope).toBe("defaults");
    expect(result.selection.revision).toBe(1);
    expect(result.selection.basis).toBe("defaults");
    expect(result.history).toHaveLength(1);
  });

  test("fetchWebinarTargetContext handles round scope inheritance correctly", async () => {
    const startedAt = Date.parse("2026-09-26T12:00:00Z");
    const inheritedDefault: TargetVersion = {
      scope_key: "defaults",
      revision: 2,
      values: { ...WEBINAR_TARGETS, plannedSpend: 3500 },
      changed_at: "2026-09-26T08:00:00Z",
      changed_by: "founder@maharamedia.com",
    };

    const client = createMockSupabaseClient(async () => ({
      data: {
        scope: "round:webby-oct-2026",
        startedAt,
        own: [],
        inherited: [inheritedDefault],
      },
      error: null,
    }));

    const result = await fetchWebinarTargetContext(client, "round:webby-oct-2026");
    expect(result.scope).toBe("round:webby-oct-2026");
    expect(result.selection.revision).toBe(0);
    expect(result.selection.basis).toBe("defaults");
    expect(result.selection.values.plannedSpend).toBe(3500);
    expect(result.history).toHaveLength(0);
  });

  test("fetchWebinarTargetContext throws on RPC error or unrecognized payload", async () => {
    const errorClient = createMockSupabaseClient(async () => ({
      data: null,
      error: { message: "Permission denied" },
    }));

    await expect(fetchWebinarTargetContext(errorClient, "defaults")).rejects.toThrow(
      "Permission denied",
    );

    const emptyClient = createMockSupabaseClient(async () => ({
      data: null,
      error: null,
    }));

    await expect(fetchWebinarTargetContext(emptyClient, "defaults")).rejects.toThrow(
      "Unrecognized target context response",
    );
  });

  test("saveWebinarTargets validates input schema before invoking RPC", async () => {
    const client = createMockSupabaseClient(async () => ({
      data: { status: "saved", version: validVersion },
      error: null,
    }));

    const invalidValues = {
      ...WEBINAR_TARGETS,
      plannedSpend: -100, // Invalid spend
    };

    await expect(
      saveWebinarTargets(client, {
        scope: "defaults",
        expectedRevision: 0,
        // @ts-expect-error invalid spend
        values: invalidValues,
        requestId: "00000000-0000-0000-0000-000000000002",
      }),
    ).rejects.toThrow();
  });

  test("saveWebinarTargets handles conflict: true response", async () => {
    const client = createMockSupabaseClient(async () => ({
      data: { status: "conflict", startedAt: null },
      error: null,
    }));

    const result = await saveWebinarTargets(client, {
      scope: "defaults",
      expectedRevision: 0,
      values: WEBINAR_TARGETS,
      requestId: "00000000-0000-0000-0000-000000000003",
    });

    expect(result.conflict).toBe(true);
  });

  test("saveWebinarTargets builds confirmed success without secondary read", async () => {
    let saveArgs: Record<string, unknown> = {};
    const client = createMockSupabaseClient(async (fn, args) => {
      saveArgs = args;
      return {
        data: {
          status: "saved",
          version: {
            ...validVersion,
            revision: 2,
            changed_at: "2026-09-26T12:00:00Z",
          },
          startedAt: null,
        },
        error: null,
      };
    });

    const result = await saveWebinarTargets(client, {
      scope: "defaults",
      expectedRevision: 1,
      values: WEBINAR_TARGETS,
      requestId: "00000000-0000-0000-0000-000000000004",
    });

    expect(saveArgs).toEqual({
      p_scope: "defaults",
      p_expected_revision: 1,
      p_values: WEBINAR_TARGETS,
      p_request_id: "00000000-0000-0000-0000-000000000004",
    });

    expect(result.conflict).toBe(false);
    if (!result.conflict) {
      expect(result.version.revision).toBe(2);
      expect(result.selection.revision).toBe(2);
      expect(result.selection.basis).toBe("defaults");
      expect(result.selection.savedAt).toBe("2026-09-26T12:00:00Z");
    }
  });

  test("saveWebinarTargets throws on missing version in saved response", async () => {
    const client = createMockSupabaseClient(async () => ({
      data: { status: "saved" }, // missing version
      error: null,
    }));

    await expect(
      saveWebinarTargets(client, {
        scope: "defaults",
        expectedRevision: 0,
        values: WEBINAR_TARGETS,
        requestId: "00000000-0000-0000-0000-000000000005",
      }),
    ).rejects.toThrow("Missing saved version in RPC response");
  });
});
