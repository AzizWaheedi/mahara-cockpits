import { describe, expect, test } from "bun:test";
import { attachStatSheets } from "../convex/fanout";
import { readClientSheetReport } from "../convex/clientSheetReport";

const sheet = (suffix: string) => `fixture_sheet_identity_${suffix}`;
const link = (suffix: string) =>
  `https://docs.google.com/spreadsheets/d/${sheet(suffix)}/edit`;
const header = [
  "Name",
  "Date Added",
  "App Date",
  "Phone",
  "Caller",
  "Confirmed",
  "Deposit",
  "Notes",
  "Type",
  "Show",
  "Quotation Given",
  "Closed",
];
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const ctx = { runQuery: async () => [], runMutation: async () => null } as any;
const oldStats = {
  tab: "Sep 26",
  booked: 7,
  due: 6,
  shows: 4,
  quotes: 3,
  closes: 2,
};

function sources(
  previous: Record<string, unknown> = {},
  failures: string[] = [],
  empty = false,
  oldMonth = false,
) {
  return {
    previous: async () => previous,
    read: ((sid, today, _get, cache, fresh) =>
      readClientSheetReport(
        sid,
        today,
        async url => {
          if (failures.includes(sid))
            throw new Error("Synthetic permission failure");
          const title = oldMonth
            ? "Jan 00"
            : `${months[today.m - 1]} ${String(today.y).slice(-2)}`;
          return url.includes("batchGet")
            ? {
                valueRanges: [
                  {
                    values: [
                      header,
                      ...(empty
                        ? []
                        : [
                            [
                              "Fixture lead",
                              "",
                              `${today.y}-${String(today.m).padStart(2, "0")}-01`,
                              "",
                              "",
                              "Y",
                              "",
                              "",
                              "",
                              "Y",
                              "Y",
                              "N",
                            ],
                          ]),
                    ],
                  },
                ],
              }
            : {
                sheets: [
                  {
                    properties: {
                      title,
                      gridProperties: { rowCount: 2, columnCount: 12 },
                    },
                  },
                ],
              };
        },
        cache,
        fresh,
      )) as typeof readClientSheetReport,
  };
}

describe("creative stat sheet failure isolation", () => {
  test("an inaccessible cancelled client without a snapshot cannot block a readable active client", async () => {
    const roster: any[] = [
      {
        taskId: "cancelled",
        clientStatus: "CANCELLED",
        sheetLink: link("bad"),
      },
      { taskId: "active", clientStatus: "Active", sheetLink: link("good") },
    ];
    const errors = await attachStatSheets(
      ctx,
      roster,
      sources({}, [sheet("bad")]),
    );
    expect(errors).toHaveLength(1);
    expect(roster[0].statsStatus).toBe("unavailable");
    expect(roster[0].stats).toBeUndefined();
    expect(roster[0].statsScannedAt).toBeUndefined();
    expect(roster[1].statsStatus).toBe("ready");
    expect(roster[1].stats).toMatchObject({
      booked: 1,
      shows: 1,
      quotes: 1,
      closes: 0,
    });
    expect(roster[1].statsScannedAt).toBeGreaterThan(0);
  });

  test("only an exact task and sheet retain a stale snapshot and its original successful read time", async () => {
    const roster: any[] = [
      { taskId: "same", sheetLink: link("same") },
      { taskId: "changed", sheetLink: link("new") },
      { taskId: "wrong-task", sheetLink: link("same") },
      { taskId: "missing" },
    ];
    const previous = {
      same: {
        taskId: "same",
        sheetLink: link("same") + "#gid=123",
        stats: oldStats,
        statsScannedAt: 123,
      },
      changed: {
        taskId: "changed",
        sheetLink: link("old"),
        stats: oldStats,
        statsScannedAt: 123,
      },
      "wrong-task": {
        taskId: "another-task",
        sheetLink: link("same"),
        stats: oldStats,
        statsScannedAt: 123,
      },
      missing: {
        taskId: "missing",
        sheetLink: link("same"),
        stats: oldStats,
        statsScannedAt: 123,
      },
    };
    const errors = await attachStatSheets(
      ctx,
      roster,
      sources(previous, [sheet("same"), sheet("new")]),
    );
    expect(errors).toHaveLength(4);
    expect(roster[0]).toMatchObject({
      stats: oldStats,
      statsScannedAt: 123,
      statsStatus: "stale",
    });
    for (const row of roster.slice(1)) {
      expect(row.statsStatus).toBe("unavailable");
      expect(row.stats).toBeUndefined();
      expect(row.statsScannedAt).toBeUndefined();
    }
  });

  test("a failed prior-cache lookup still permits successful source reads", async () => {
    const roster: any[] = [{ taskId: "active", sheetLink: link("good") }];
    const input = sources();
    input.previous = async () => {
      throw new Error("Synthetic cache outage");
    };
    expect(await attachStatSheets(ctx, roster, input)).toHaveLength(1);
    expect(roster[0].statsStatus).toBe("ready");
    expect(roster[0].stats.booked).toBe(1);
  });

  test("missing current-month data stays unavailable while a verified empty month can report zero", async () => {
    const missing: any[] = [
      { taskId: "missing-month", sheetLink: link("old-month") },
    ];
    await attachStatSheets(ctx, missing, sources({}, [], false, true));
    expect(missing[0].statsStatus).toBe("unavailable");
    expect(missing[0].stats).toBeUndefined();
    const empty: any[] = [{ taskId: "empty", sheetLink: link("empty") }];
    expect(await attachStatSheets(ctx, empty, sources({}, [], true))).toEqual(
      [],
    );
    expect(empty[0].statsStatus).toBe("ready");
    expect(empty[0].stats).toMatchObject({
      booked: 0,
      due: 0,
      shows: 0,
      quotes: 0,
      closes: 0,
    });
  });
});
