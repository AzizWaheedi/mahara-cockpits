import { describe, expect, it } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  executeAct,
  executeToggleCheck as executeCsmToggleCheck,
  fetchDailyChecksRpc as fetchCsmDailyChecksRpc,
  normalizeChecks as normalizeCsmChecks,
  normalizeDecisions as normalizeCsmDecisions,
} from "../../client-success-cockpit/src/lib/useCsmSnapshot";
import {
  executeDecide,
  executeToggleCheck as executeMbToggleCheck,
  fetchDailyChecksRpc as fetchMbDailyChecksRpc,
  normalizeChecks as normalizeMbChecks,
  normalizeDecisions as normalizeMbDecisions,
} from "../src/lib/useMediaBuyerSnapshot";

interface MockClientOptions {
  rpcResult?: { data: unknown; error: unknown };
  onRpc?: (fn: string, args: Record<string, unknown>) => void;
  onFrom?: (table: string) => void;
}

function createMockSupabaseClient(options?: MockClientOptions): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  fromCalls: string[];
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (options?.onRpc) {
        options.onRpc(fn, args);
      }
      return options?.rpcResult ?? { data: null, error: null };
    },
    from: (table: string) => {
      fromCalls.push(table);
      if (options?.onFrom) {
        options.onFrom(table);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;

  return { client, rpcCalls, fromCalls };
}

describe("Snapshot RPC contracts", () => {
  describe("Defect 1: Daily checks RPC read (cockpit_get_daily_checks)", () => {
    it("Media Buyer fetchDailyChecksRpc uses cockpit_get_daily_checks RPC with role/day and never queries cockpit_daily_checks table", async () => {
      const mock = createMockSupabaseClient({
        rpcResult: {
          data: [
            { id: 1, check_key: "spend", label: "Check Spend", done: false },
          ],
          error: null,
        },
      });

      const checks = await fetchMbDailyChecksRpc(
        mock.client,
        "media_buyer",
        "2026-09-26",
      );

      expect(mock.rpcCalls).toHaveLength(1);
      expect(mock.rpcCalls[0].fn).toBe("cockpit_get_daily_checks");
      expect(mock.rpcCalls[0].args).toEqual({
        p_role: "media_buyer",
        p_day: "2026-09-26",
      });
      expect(mock.fromCalls).toHaveLength(0);
      expect(checks).toEqual([
        { id: 1, check_key: "spend", label: "Check Spend", done: false },
      ]);
    });

    it("CSM fetchDailyChecksRpc uses cockpit_get_daily_checks RPC with role/day and never queries cockpit_daily_checks table", async () => {
      const mock = createMockSupabaseClient({
        rpcResult: {
          data: [
            {
              id: 2,
              check_key: "sprint_am",
              label: "Morning Sprint",
              done: true,
            },
          ],
          error: null,
        },
      });

      const checks = await fetchCsmDailyChecksRpc(
        mock.client,
        "csm",
        "2026-09-26",
      );

      expect(mock.rpcCalls).toHaveLength(1);
      expect(mock.rpcCalls[0].fn).toBe("cockpit_get_daily_checks");
      expect(mock.rpcCalls[0].args).toEqual({
        p_role: "csm",
        p_day: "2026-09-26",
      });
      expect(mock.fromCalls).toHaveLength(0);
      expect(checks).toEqual([
        { id: 2, check_key: "sprint_am", label: "Morning Sprint", done: true },
      ]);
    });

    it("normalizeChecks preserves display order and maps RPC schema fields exactly", () => {
      const rawRows = [
        {
          id: 101,
          day: "2026-09-26",
          check_key: "morning_check",
          label: "First Check",
          detail: "Verify campaigns",
          phase: "sod",
          block: "sprint_am",
          display_order: 1,
          href: "/ads",
          done: false,
          done_at: null,
        },
        {
          id: 55,
          day: "2026-09-26",
          check_key: "evening_check",
          label: "Second Check",
          detail: "Log EOD",
          phase: "eod",
          block: "sprint_pm",
          display_order: 2,
          href: "/eod",
          done: true,
          done_at: "2026-09-26T18:00:00Z",
        },
      ];

      for (const normalize of [normalizeMbChecks, normalizeCsmChecks]) {
        const normalized = normalize(rawRows);
        expect(normalized).toHaveLength(2);

        expect(normalized[0]).toEqual({
          _id: "101",
          id: 101,
          key: "morning_check",
          label: "First Check",
          detail: "Verify campaigns",
          phase: "sod",
          block: "sprint_am",
          displayOrder: 1,
          href: "/ads",
          done: false,
          doneAt: null,
        });

        expect(normalized[1]).toEqual({
          _id: "55",
          id: 55,
          key: "evening_check",
          label: "Second Check",
          detail: "Log EOD",
          phase: "eod",
          block: "sprint_pm",
          displayOrder: 2,
          href: "/eod",
          done: true,
          doneAt: "2026-09-26T18:00:00Z",
        });
      }
    });

    it("surfaces RPC errors on fetch failure and rejects missing client", async () => {
      const rpcError = new Error("Checklist access denied (42501)");
      const failingMock = createMockSupabaseClient({
        rpcResult: { data: null, error: rpcError },
      });

      await expect(
        fetchMbDailyChecksRpc(failingMock.client, "media_buyer", "2026-09-26"),
      ).rejects.toThrow("Checklist access denied (42501)");

      await expect(
        fetchCsmDailyChecksRpc(failingMock.client, "csm", "2026-09-26"),
      ).rejects.toThrow("Checklist access denied (42501)");

      await expect(
        fetchMbDailyChecksRpc(null, "media_buyer", "2026-09-26"),
      ).rejects.toThrow(/Supabase client is required/);

      await expect(
        fetchCsmDailyChecksRpc(null, "csm", "2026-09-26"),
      ).rejects.toThrow(/Supabase client is required/);
    });
  });

  describe("Defect 2: Toggle check (cockpit_set_daily_check) & optimistic concurrency", () => {
    it("checking an item sends expectedCurrent: false and done: true", async () => {
      const mockMb = createMockSupabaseClient();
      await executeMbToggleCheck(mockMb.client, {
        id: 7,
        expectedCurrent: false,
        done: true,
      });

      expect(mockMb.rpcCalls).toHaveLength(1);
      expect(mockMb.rpcCalls[0].fn).toBe("cockpit_set_daily_check");
      expect(mockMb.rpcCalls[0].args).toEqual({
        p_id: 7,
        p_expected_done: false,
        p_done: true,
      });

      const mockCsm = createMockSupabaseClient();
      await executeCsmToggleCheck(mockCsm.client, {
        id: "7",
        expectedCurrent: false,
        done: true,
      });
      expect(mockCsm.rpcCalls[0].args).toEqual({
        p_id: 7,
        p_expected_done: false,
        p_done: true,
      });
    });

    it("unchecking an item sends expectedCurrent: true and done: false", async () => {
      const mockMb = createMockSupabaseClient();
      await executeMbToggleCheck(mockMb.client, {
        id: 12,
        expectedCurrent: true,
        done: false,
      });

      expect(mockMb.rpcCalls).toHaveLength(1);
      expect(mockMb.rpcCalls[0].fn).toBe("cockpit_set_daily_check");
      expect(mockMb.rpcCalls[0].args).toEqual({
        p_id: 12,
        p_expected_done: true,
        p_done: false,
      });

      const mockCsm = createMockSupabaseClient();
      await executeCsmToggleCheck(mockCsm.client, {
        id: "12",
        expectedCurrent: true,
        done: false,
      });
      expect(mockCsm.rpcCalls[0].args).toEqual({
        p_id: 12,
        p_expected_done: true,
        p_done: false,
      });
    });

    it("propagates optimistic concurrency rejection from RPC (ERRCODE 40001)", async () => {
      const concurrencyErr = {
        code: "40001",
        message: "Checklist changed; reload before trying again",
      };
      const mock = createMockSupabaseClient({
        rpcResult: { data: null, error: concurrencyErr },
      });

      await expect(
        executeMbToggleCheck(mock.client, {
          id: 15,
          expectedCurrent: false,
          done: true,
        }),
      ).rejects.toMatchObject({ code: "40001" });

      await expect(
        executeCsmToggleCheck(mock.client, {
          id: 15,
          expectedCurrent: true,
          done: false,
        }),
      ).rejects.toMatchObject({ code: "40001" });
    });

    it("rejects missing client, missing/invalid id, or missing/invalid done boolean", async () => {
      const mock = createMockSupabaseClient();

      // Missing client
      await expect(
        executeMbToggleCheck(null, {
          id: 1,
          done: true,
          expectedCurrent: false,
        }),
      ).rejects.toThrow(/Supabase client is required/);
      await expect(
        executeCsmToggleCheck(null, {
          id: 1,
          done: true,
          expectedCurrent: false,
        }),
      ).rejects.toThrow(/Supabase client is required/);

      // Invalid or missing ID
      await expect(
        executeMbToggleCheck(mock.client, {
          id: null as unknown as number,
          done: true,
        }),
      ).rejects.toThrow(/Missing checklist item id/);
      await expect(
        executeMbToggleCheck(mock.client, { id: "not-a-number", done: true }),
      ).rejects.toThrow(/Invalid checklist item id/);
      await expect(
        executeMbToggleCheck(mock.client, { id: 0, done: true }),
      ).rejects.toThrow(/Invalid checklist item id/);
      await expect(
        executeMbToggleCheck(mock.client, { id: -5, done: true }),
      ).rejects.toThrow(/Invalid checklist item id/);

      // Missing or invalid done boolean
      await expect(
        executeMbToggleCheck(mock.client, { id: 1 } as unknown as {
          id: number;
          done: boolean;
        }),
      ).rejects.toThrow(/Missing or invalid 'done' boolean/);
      await expect(
        executeMbToggleCheck(mock.client, {
          id: 1,
          done: "true" as unknown as boolean,
        }),
      ).rejects.toThrow(/Missing or invalid 'done' boolean/);
      await expect(
        executeCsmToggleCheck(mock.client, {
          id: 1,
          done: null as unknown as boolean,
        }),
      ).rejects.toThrow(/Missing or invalid 'done' boolean/);

      // Invalid expectedCurrent
      await expect(
        executeMbToggleCheck(mock.client, {
          id: 1,
          done: true,
          expectedCurrent: "no" as unknown as boolean,
        }),
      ).rejects.toThrow(/Invalid 'expectedCurrent' boolean/);
    });
  });

  describe("Defect 3: Decisions & actions (cockpit_log_decision) parameter names and metadata roundtrip", () => {
    it("executeDecide sends exact supported parameters, preserving numeric metricAtDecision=0 and reason", async () => {
      const mock = createMockSupabaseClient({
        rpcResult: { data: 999, error: null },
      });

      await executeDecide(mock.client, {
        subject: "Summer Campaign",
        action: "Modify targeting",
        evidence: "High CPC",
        kind: "rerouted",
        reason: "Need creative update",
        metricAtDecision: 0, // Explicit zero preserved as 0, not null
        reroutedTo: "creative",
        amount: 0,
      });

      expect(mock.rpcCalls).toHaveLength(1);
      const call = mock.rpcCalls[0];
      expect(call.fn).toBe("cockpit_log_decision");

      // Verify exact supported parameter names
      expect(call.args.p_role).toBe("media_buyer");
      expect(typeof call.args.p_day).toBe("string");
      expect(call.args.p_subject).toBe("Summer Campaign");
      expect(call.args.p_action).toBe("Modify targeting");
      expect(call.args.p_kind).toBe("rerouted");
      expect(call.args.p_evidence).toBe("High CPC");
      expect(call.args.p_reason).toBe("Need creative update");
      expect(call.args.p_metric_at_decision).toBe(0);

      // Verify nonexistent parameters are NOT passed at root
      expect("p_rerouted_to" in call.args).toBe(false);
      expect("p_amount" in call.args).toBe(false);

      // Verify metadata preserves reroutedTo and amount including 0
      expect(call.args.p_metadata).toEqual({
        reroutedTo: "creative",
        amount: 0,
      });
    });

    it("executeDecide passes non-zero numeric metricAtDecision and reason properly", async () => {
      const mock = createMockSupabaseClient({
        rpcResult: { data: 999, error: null },
      });

      await executeDecide(mock.client, {
        subject: "Scale Campaign",
        action: "Raise to $150",
        evidence: "CPL $12 under target",
        kind: "decision",
        reason: "High performer",
        metricAtDecision: 12.45,
      });

      const call = mock.rpcCalls[0];
      expect(call.args.p_metric_at_decision).toBe(12.45);
      expect(call.args.p_reason).toBe("High performer");
    });

    it("executeAct sends exact supported parameters, preserves metricAtDecision=0, and sets reroutedTo for tickets", async () => {
      const mock = createMockSupabaseClient({
        rpcResult: { data: 1001, error: null },
      });

      await executeAct(mock.client, {
        clientName: "Alpha Clinic",
        action: "Raise ticket",
        details: "Page broken",
        kind: "ticket",
        reason: "404 form",
        metricAtDecision: 0,
        department: "tech",
        amount: 0,
      });

      expect(mock.rpcCalls).toHaveLength(1);
      const call = mock.rpcCalls[0];
      expect(call.fn).toBe("cockpit_log_decision");

      expect(call.args.p_role).toBe("csm");
      expect(call.args.p_subject).toBe("Alpha Clinic");
      expect(call.args.p_action).toBe("Raise ticket");
      expect(call.args.p_kind).toBe("ticket");
      expect(call.args.p_evidence).toBe("Page broken");
      expect(call.args.p_reason).toBe("404 form");
      expect(call.args.p_metric_at_decision).toBe(0);

      // Verify nonexistent parameters are NOT passed at root
      expect("p_rerouted_to" in call.args).toBe(false);
      expect("p_amount" in call.args).toBe(false);

      // Verify metadata preserves reroutedTo and amount including 0
      expect(call.args.p_metadata).toEqual({
        reroutedTo: "tech",
        amount: 0,
      });
    });

    it("executeAct does NOT invent reroutedTo from unrelated department when kind is not ticket or rerouted", async () => {
      const mock = createMockSupabaseClient({
        rpcResult: { data: 1002, error: null },
      });

      await executeAct(mock.client, {
        clientName: "Beta Dental",
        action: "Held a call",
        details: "Discussed offer",
        kind: "call",
        department: "sales", // Unrelated department
      });

      const call = mock.rpcCalls[0];
      expect(
        (call.args.p_metadata as Record<string, unknown>).reroutedTo,
      ).toBeUndefined();
    });

    it("normalizeDecisions roundtrip: reads reason, metric_at_decision=0, reroutedTo, and amount=0 from persisted row", () => {
      const rows = [
        {
          id: 1,
          day: "2026-09-26",
          subject: "Campaign A",
          action: "Cut ad",
          evidence: "High CPL",
          kind: "decision",
          reason: "Tired creative",
          metric_at_decision: 0,
          metadata: { reroutedTo: "creative", amount: 0 },
          rerouted_to: null,
          amount: null,
        },
      ];

      for (const normalize of [normalizeMbDecisions, normalizeCsmDecisions]) {
        const [d] = normalize(rows);
        expect(d._id).toBe("1");
        expect(d.id).toBe(1);
        expect(d.subject).toBe("Campaign A");
        expect(d.action).toBe("Cut ad");
        expect(d.reason).toBe("Tired creative");
        expect(d.metricAtDecision).toBe(0);
        expect(d.reroutedTo).toBe("creative");
        expect(d.amount).toBe(0);
      }
    });

    it("normalizeDecisions preserves legacy provenance fields when metadata is absent, null, or empty", () => {
      const legacyRows = [
        {
          id: 2,
          day: "2026-09-26",
          subject: "Campaign B",
          action: "Raise budget",
          kind: "scale",
          reason: "Consistent positive ROI",
          metric_at_decision: 15.2,
          metadata: null, // genuine null metadata
          rerouted_to: "media_buyer",
          amount: 350,
        },
        {
          id: 3,
          day: "2026-09-26",
          subject: "Campaign C",
          action: "Transfer task",
          kind: "rerouted",
          metadata: {}, // empty metadata
          rerouted_to: "creative",
          amount: 0, // legacy 0 preserved
        },
      ];

      for (const normalize of [normalizeMbDecisions, normalizeCsmDecisions]) {
        const normalized = normalize(legacyRows);
        expect(normalized[0].reroutedTo).toBe("media_buyer");
        expect(normalized[0].amount).toBe(350);
        expect(normalized[0].reason).toBe("Consistent positive ROI");
        expect(normalized[0].metricAtDecision).toBe(15.2);

        expect(normalized[1].reroutedTo).toBe("creative");
        expect(normalized[1].amount).toBe(0);
      }
    });

    it("normalizeDecisions ensures genuine absent or null metadata cannot overwrite legacy provenance", () => {
      const nullMetaRows = [
        {
          id: 4,
          day: "2026-09-26",
          subject: "Campaign D",
          action: "Review",
          reason: "Legacy reason",
          metadata: { amount: null, reroutedTo: null }, // explicit null inside metadata
          rerouted_to: "editor",
          amount: 500,
        },
      ];

      for (const normalize of [normalizeMbDecisions, normalizeCsmDecisions]) {
        const [d] = normalize(nullMetaRows);
        expect(d.amount).toBe(500); // Not overwritten by null!
        expect(d.reroutedTo).toBe("editor"); // Not overwritten by null!
        expect(d.reason).toBe("Legacy reason");
      }
    });

    it("normalizeDecisions never invents a rerouting destination from unrelated department", () => {
      const rowsWithDept = [
        {
          id: 5,
          day: "2026-09-26",
          subject: "Campaign E",
          action: "Review status",
          kind: "decision",
          department: "sales", // Unrelated table column
          metadata: { department: "sales" }, // Unrelated meta field
          rerouted_to: null,
        },
      ];

      for (const normalize of [normalizeMbDecisions, normalizeCsmDecisions]) {
        const [d] = normalize(rowsWithDept);
        expect(d.reroutedTo).toBeUndefined();
      }
    });

    it("normalizeDecisions prioritizes metadata amount=0 over legacy non-zero amount", () => {
      const mixedRows = [
        {
          id: 6,
          day: "2026-09-26",
          subject: "Campaign F",
          action: "Test zero",
          metadata: { amount: 0, reroutedTo: "tech" },
          rerouted_to: "legacy_team",
          amount: 999,
        },
      ];

      for (const normalize of [normalizeMbDecisions, normalizeCsmDecisions]) {
        const [d] = normalize(mixedRows);
        expect(d.amount).toBe(0);
        expect(d.reroutedTo).toBe("tech");
      }
    });

    it("rejects missing client or invalid inputs in decide and act, propagating RPC errors", async () => {
      const failingMock = createMockSupabaseClient({
        rpcResult: { data: null, error: new Error("RPC execution failed") },
      });

      // Missing client
      await expect(
        executeDecide(null, { subject: "Sub", action: "Act" }),
      ).rejects.toThrow(/Supabase client is required/);
      await expect(
        executeAct(null, { clientName: "Client", action: "Act" }),
      ).rejects.toThrow(/Supabase client is required/);

      // Missing subject or action
      await expect(
        executeDecide(failingMock.client, { subject: "", action: "Act" }),
      ).rejects.toThrow(/Subject and action cannot be empty/);
      await expect(
        executeAct(failingMock.client, { clientName: "", action: "Act" }),
      ).rejects.toThrow(/Subject and action cannot be empty/);

      // Propagate RPC error
      await expect(
        executeDecide(failingMock.client, { subject: "Sub", action: "Act" }),
      ).rejects.toThrow("RPC execution failed");
      await expect(
        executeAct(failingMock.client, { clientName: "Client", action: "Act" }),
      ).rejects.toThrow("RPC execution failed");
    });
  });
});
