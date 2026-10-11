import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { fetchPerformancePeriod } from "../src/lib/performance";

function clientFor(profile: Record<string, unknown>) {
  const tables = Object.fromEntries(
    [
      "clients",
      "csTasks",
      "kpi",
      "appointments",
      "rosterDays",
      "churnEvents",
      "syncRuns",
      "clientProfiles",
      "decisions",
      "reportDocs",
      "outbox",
    ].map(name => [name, []]),
  );
  tables.clients = [
    { name: "Assigned client", taskId: "client-one" },
  ] as never[];
  tables.clientProfiles = [
    { clientName: "Assigned client", syncedAt: 1, ...profile },
  ] as never[];
  return createClient("https://period-regression.invalid", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async () =>
        new Response(
          JSON.stringify({
            tables,
            source: { snapshotAt: "2026-10-07T00:00:00Z" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  });
}

test("missing period series is unavailable rather than fabricated zero totals", async () => {
  // No ad series: leads, spend and cost per lead are unknown, sheet counts stand.
  const [noAds] = await fetchPerformancePeriod(
    clientFor({ performance: { appointments: [] } }),
    "2026-10-01",
    "2026-10-07",
  );
  expect(noAds.spend).toBeNull();
  expect(noAds.cpl).toBeNull();
  expect(noAds.booked).toBe(0);
  // No sheet series: every outcome count is unknown, and so is a sheet-based lead count.
  const [noSheet] = await fetchPerformancePeriod(
    clientFor({ adLeads: { daily: [] } }),
    "2026-10-01",
    "2026-10-07",
  );
  for (const k of ["leads", "booked", "shows", "closes", "unknownOutcome"])
    expect((noSheet as Record<string, unknown>)[k]).toBeNull();
  // Neither: a row of unknowns, and the rest of the list still loads.
  const [none] = await fetchPerformancePeriod(
    clientFor({}),
    "2026-10-01",
    "2026-10-07",
  );
  expect(none.leads).toBeNull();
  expect(none.spend).toBeNull();
});

test("verified empty period series remains a measured zero", async () => {
  const result = await fetchPerformancePeriod(
    clientFor({ performance: { appointments: [] }, adLeads: { daily: [] } }),
    "2026-10-01",
    "2026-10-07",
  );
  expect(result).toEqual([
    {
      clientName: "Assigned client",
      leads: 0,
      leadsFrom: "sheet",
      spend: 0,
      cpl: null,
      sheetLeads: 0,
      booked: 0,
      shows: 0,
      noshows: 0,
      quotes: 0,
      closes: 0,
      unknownOutcome: 0,
      showRate: null,
      closeRate: null,
    },
  ]);
});
