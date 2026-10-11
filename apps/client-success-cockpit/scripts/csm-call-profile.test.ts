import { expect, test } from "bun:test";
import { readCsmClientProfile } from "../src/lib/csmReadModel";

function client(timeline: unknown, timelineError: string | null = null) {
  const tables = Object.fromEntries(
    ["clients", "csTasks", "kpi", "appointments", "rosterDays", "churnEvents", "syncRuns", "clientProfiles", "decisions", "reportDocs", "outbox"].map(k => [k, []]),
  );
  tables.clients = [{ name: "Test Client", taskId: "task-one", stage: "Active" }];
  tables.clientProfiles = [{ clientName: "Test Client", syncId: "day-1", syncedAt: 1, _creationTime: 1 }];
  return {
    rpc: async (name: string) => {
      if (name === "cockpit_csm_source_read") return { data: { tables, source: { snapshotAt: "2026-10-11T12:00:00Z" } }, error: null };
      if (name === "cockpit_csm_state") return { data: { day: "2026-10-11", month: "2026-10", profiles: [], prefs: [], hotRows: [], dismissed: [], money: null }, error: null };
      if (name === "cockpit_csm_report_history") return { data: [], error: null };
      if (name === "cockpit_csm_client_timeline") return { data: timeline, error: timelineError ? { message: timelineError } : null };
      throw Error(`Unexpected RPC: ${name}`);
    },
  } as any;
}

test("profile read includes dated media buyer changes and next call", async () => {
  const result = await readCsmClientProfile(client({
    changes: [{ day: "2026-10-11", at: "2026-10-11T12:00:00Z", action: "Creative updated" }],
    calls: [{ upcoming: true, startsAt: "2026-10-13T12:00:00Z" }],
    forms: [], health: [{ key: "csm-media-changes", ok: true }],
  }), { clientName: "Test Client" });
  expect(result?.changes).toHaveLength(1);
  expect(result?.changes[0].day).toBe("2026-10-11");
  expect(result?.nextCallAt).toBe("2026-10-13T12:00:00Z");
});

test("profile read never calls an unavailable change source zero", async () => {
  const result = await readCsmClientProfile(client(null, "Meta refused the activity read"), { clientName: "Test Client" });
  expect(result).toHaveProperty("changes");
  expect(result?.changes).toEqual([]);
  expect(result?.changesError).toBe("Meta refused the activity read");
});
