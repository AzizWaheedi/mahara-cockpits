// One client, one row, whatever state a push leaves the table in.
// Run from the client success app directory: bun test scripts/profile-rows.test.ts
import { describe, expect, test } from "bun:test";
import { buildPerformanceOverview } from "../convex/csm";
import { clientKey, onePerClient } from "../convex/profileRows";

const OLD = "2026-09-27-1790500000000";
const NEW = "2026-09-27-1790500600000";

let created = 0;
// biome-ignore lint/suspicious/noExplicitAny: a stored profile, trimmed to what matters here
function profile(clientName: string, syncId: string, over: any = {}): any {
  created += 1;
  return {
    _id: `p${created}`,
    _creationTime: created,
    clientName,
    syncId,
    syncedAt: Number(syncId.split("-").pop()),
    links: {},
    stage: "Live",
    adLeads: { daily: [{ date: "2026-09-26", leads: 10, spend: 100 }] },
    performance: {
      appointments: [{ added: "2026-09-26", booked: true, show: "y" }],
    },
    ...over,
  };
}

/** The table as a push leaves it halfway: the old set, and the first batch of the new. */
function midPush() {
  return [
    profile("Liwan Limited", OLD),
    profile("Ocean Home", OLD),
    profile("North Gulf Systems", OLD, { taskId: "86exfeac7" }),
    profile("North Gulf Systems", OLD, {
      taskId: "86exfedjd",
      links: { sheet: "https://docs.google.com/x" },
    }),
    profile("Liwan Limited", NEW, { stage: "Scaling" }),
  ];
}

describe("onePerClient", () => {
  test("the newest push wins, and a client the push has not reached keeps its row", () => {
    const rows = onePerClient(midPush());
    expect(rows.map(r => r.clientName).sort()).toEqual([
      "Liwan Limited",
      "North Gulf Systems",
      "Ocean Home",
    ]);
    expect(rows.find(r => r.clientName === "Liwan Limited")?.stage).toBe(
      "Scaling",
    );
  });

  test("two cards under one name: the one with a report sheet", () => {
    const north = onePerClient(midPush()).find(
      r => r.clientName === "North Gulf Systems",
    );
    expect(north?.taskId).toBe("86exfedjd");
  });

  test("spacing and case do not make a second client", () => {
    expect(clientKey("  North Gulf  Systems ")).toBe("north gulf systems");
    expect(
      onePerClient([
        profile("North Gulf Systems", OLD),
        profile("north gulf  systems ", NEW),
      ]),
    ).toHaveLength(1);
  });
});

describe("the client performance overview", () => {
  test("lists each client once and counts each client once in the trends", async () => {
    const tables: Record<string, unknown[]> = {
      clientProfiles: midPush(),
      clients: [],
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          collect: async () => tables[table] ?? [],
          withIndex: () => ({ collect: async () => tables[table] ?? [] }),
        }),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in query context
    const out = await buildPerformanceOverview(ctx as any, true);
    const names = out.clients.map((c: { clientName: string }) => c.clientName);
    expect(names).toHaveLength(new Set(names).size);
    expect(names).toHaveLength(3);
    // Three clients with 10 leads on the day, not five rows' worth.
    expect(out.trend).toEqual([
      { date: "2026-09-26", leads: 30, spend: 300, cpl: 10 },
    ]);
    expect(out.weeklyOutcomes[0].booked).toBe(3);
  });
});
