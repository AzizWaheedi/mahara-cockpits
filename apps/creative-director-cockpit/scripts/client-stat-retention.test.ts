import { describe, expect, test } from "bun:test";
import { storeClients } from "../convex/sync";
import { statCacheInternal } from "../convex/ingest";

const link = (id: string) =>
  `https://docs.google.com/spreadsheets/d/fixture_sheet_identity_${id}/edit`;
const stats = {
  tab: "Oct 26",
  booked: 5,
  due: 4,
  shows: 3,
  quotes: 2,
  closes: 1,
};
const prior = {
  taskId: "task-a",
  name: "Fixture",
  consultationTypes: [],
  aliases: [],
  sheetLink: link("a"),
  stats,
  statsScannedAt: 123,
  statsStatus: "ready",
  statsCheckedAt: 124,
  syncedAt: 1,
};
function fixture(previous: any[] = [prior]) {
  let rows = previous.map((row, i) => ({ ...row, _id: `row-${i}` }));
  const ctx = {
    db: {
      query: () => ({ collect: async () => structuredClone(rows) }),
      delete: async (id: string) => {
        rows = rows.filter(row => row._id !== id);
      },
      insert: async (_table: string, row: any) => {
        rows.push({
          ...JSON.parse(JSON.stringify(row)),
          _id: `next-${rows.length}`,
        });
      },
    },
  } as any;
  return { ctx, rows: () => rows };
}
const roster = (extra: Record<string, unknown> = {}) => ({
  taskId: "task-a",
  name: "Updated name",
  consultationTypes: [],
  aliases: [],
  sheetLink: link("a"),
  ...extra,
});

describe("creative roster retains only the same client's sheet statistics", () => {
  test("a roster-only update retains stats with the successful timestamp and updated profile", async () => {
    const f = fixture();
    await storeClients._handler(f.ctx, {
      clients: [roster({ sheetLink: link("a") + "#gid=1" })],
    });
    expect(f.rows()[0]).toMatchObject({
      name: "Updated name",
      stats,
      statsScannedAt: 123,
      statsCheckedAt: 124,
      statsStatus: "ready",
    });
    expect(
      (await statCacheInternal._handler(f.ctx, {}))["task-a"],
    ).toMatchObject({
      taskId: "task-a",
      stats,
      statsScannedAt: 123,
      statsStatus: "ready",
    });
  });
  test("changed sheets, missing links, different task IDs and ambiguous prior identities cannot inherit statistics", async () => {
    for (const change of [
      { sheetLink: link("b") },
      { sheetLink: undefined },
      { taskId: "task-b" },
    ]) {
      const f = fixture();
      await storeClients._handler(f.ctx, {
        clients: [roster({ ...change, statsScannedAt: 999 })],
      });
      expect(f.rows()[0].stats).toBeUndefined();
      expect(f.rows()[0].statsScannedAt).toBeUndefined();
      expect(f.rows()[0].statsStatus).toBe("unavailable");
    }
    const duplicate = fixture([prior, { ...prior, name: "Duplicate" }]);
    await storeClients._handler(duplicate.ctx, { clients: [roster()] });
    expect(duplicate.rows()[0].stats).toBeUndefined();
  });
  test("failed reads retain only last verified same-sheet values and a later fresh read replaces them", async () => {
    const f = fixture();
    await storeClients._handler(f.ctx, {
      clients: [roster({ statsStatus: "unavailable", statsCheckedAt: 999 })],
    });
    expect(f.rows()[0]).toMatchObject({
      stats,
      statsScannedAt: 123,
      statsCheckedAt: 999,
      statsStatus: "stale",
    });
    const updated = { ...stats, booked: 8 };
    await storeClients._handler(f.ctx, {
      clients: [
        roster({
          stats: updated,
          statsScannedAt: 1000,
          statsCheckedAt: 1001,
          statsStatus: "ready",
        }),
      ],
    });
    expect(f.rows()[0]).toMatchObject({
      stats: updated,
      statsScannedAt: 1000,
      statsStatus: "ready",
    });
  });
  test("a new unavailable client keeps missing stats absent and never synthesizes zero counts", async () => {
    const f = fixture([]);
    await storeClients._handler(f.ctx, {
      clients: [
        roster({
          statsStatus: "unavailable",
          statsCheckedAt: 999,
          statsScannedAt: 123,
        }),
      ],
    });
    expect(f.rows()[0].stats).toBeUndefined();
    expect(f.rows()[0].statsScannedAt).toBeUndefined();
    expect(f.rows()[0]).toMatchObject({
      statsStatus: "unavailable",
      statsCheckedAt: 999,
    });
  });
});
