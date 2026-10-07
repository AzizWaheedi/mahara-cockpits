import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { fetchPerformancePeriod } from "../src/lib/performance";

function clientFor(profile: Record<string, unknown>) {
  const tables = Object.fromEntries([
    "clients", "csTasks", "kpi", "appointments", "rosterDays", "churnEvents",
    "syncRuns", "clientProfiles", "decisions", "reportDocs", "outbox",
  ].map(name => [name, []]));
  tables.clients = [{ name: "Assigned client", taskId: "client-one" }] as never[];
  tables.clientProfiles = [{ clientName: "Assigned client", syncedAt: 1, ...profile }] as never[];
  return createClient("https://period-regression.invalid", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({
      tables, source: { snapshotAt: "2026-10-07T00:00:00Z" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }) },
  });
}

test("missing period series is unavailable rather than fabricated zero totals", async () => {
  for (const profile of [
    { performance: { appointments: [] } },
    { adLeads: { daily: [] } },
  ]) {
    await expect(fetchPerformancePeriod(clientFor(profile), "2026-10-01", "2026-10-07")).rejects.toThrow();
  }
});

test("verified empty period series remains a measured zero", async () => {
  const result = await fetchPerformancePeriod(clientFor({ performance: { appointments: [] }, adLeads: { daily: [] } }), "2026-10-01", "2026-10-07");
  expect(result).toEqual([{ clientName: "Assigned client", leads: 0, leadsFrom: "sheet", spend: 0, cpl: null, sheetLeads: 0, booked: 0, shows: 0, noshows: 0, quotes: 0, closes: 0, unknownOutcome: 0, showRate: null, closeRate: null }]);
});
