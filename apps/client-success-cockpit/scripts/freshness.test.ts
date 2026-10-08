import { expect, test } from "bun:test";
import { buildCsmReadModel } from "../src/lib/csmReadModel";
import { isStale, newestPublish } from "../src/lib/freshness";

// 8 Oct 2026: the native worker republishes the live tables every cycle and
// writes no syncRuns row, so the Today header and the banner read 7 Oct 13:52.
const source = {
  snapshotAt: "2026-10-07T13:52:25+03:00",
  tables: {
    syncRuns: { rows: 3998, snapshotAt: "2026-10-07T13:52:25+03:00" },
    clients: { rows: 52, snapshotAt: "2026-10-08T16:13:44+03:00" },
    clientProfiles: { rows: 52, snapshotAt: "2026-10-08T16:13:44+03:00" },
  },
};
const published = Date.parse("2026-10-08T16:13:44+03:00");

test("the newest table publish is the data's freshness, not the oldest imported table", () => {
  expect(newestPublish(source)).toBe(published);
  expect(newestPublish({ tables: {} })).toBeNull();
  expect(newestPublish(undefined)).toBeNull();
  expect(
    newestPublish({ tables: { a: { snapshotAt: "not a date" } } }),
  ).toBeNull();
});

test("data counts as stale only after 50 minutes during Kuwait working hours, or when nothing landed", () => {
  const noonKuwait = Date.parse("2026-10-08T12:00:00+03:00");
  expect(isStale(noonKuwait - 49 * 60000, noonKuwait)).toBe(false);
  expect(isStale(noonKuwait - 51 * 60000, noonKuwait)).toBe(true);
  expect(isStale(null, noonKuwait)).toBe(true);
  const nightKuwait = Date.parse("2026-10-08T23:30:00+03:00");
  expect(isStale(nightKuwait - 300 * 60000, nightKuwait)).toBe(false);
});

const emptyTables = {
  clients: [],
  clientProfiles: [],
  appointments: [],
  churnEvents: [],
  csTasks: [],
  rosterDays: [],
  kpi: [],
  decisions: [],
  reportDocs: [],
  outbox: [],
  liveDecisions: [],
  clientOverrides: [],
};
const local = {
  checks: [],
  decisions: [],
  plan: [],
  eod: null,
  eodOwner: "a@b",
  eodDay: "2026-10-08",
};
const state = {
  day: "2026-10-08",
  month: "2026-10",
  profiles: [],
  prefs: [],
  hotRows: [],
  dismissed: [],
  money: null,
} as never;

test("the Today header and sync health use the native publish when it is newer than the last syncRuns row", () => {
  const legacy = Date.parse("2026-10-07T13:52:25+03:00");
  const model = buildCsmReadModel(
    {
      tables: {
        ...emptyTables,
        syncRuns: [
          {
            _id: "h",
            at: legacy,
            kind: "health",
            ok: false,
            errors: ["old feed error"],
          },
          { _id: "f", at: legacy, role: "csm", ok: true },
        ],
      },
      source,
    } as never,
    state,
    local,
  );
  expect(model.lastSyncAt).toBe(published);
  expect(model.syncHealth?.at).toBe(published);
  expect(model.syncHealth?.ok).toBe(true);
  expect(model.syncHealth?.errors).toEqual([]);
});

test("a newer syncRuns row still wins, with its own errors", () => {
  const later = Date.parse("2026-10-08T17:00:00+03:00");
  const model = buildCsmReadModel(
    {
      tables: {
        ...emptyTables,
        syncRuns: [
          {
            _id: "h",
            at: later,
            kind: "health",
            ok: false,
            errors: ["sheet not shared"],
          },
          { _id: "f", at: later, role: "csm", ok: true },
        ],
      },
      source,
    } as never,
    state,
    local,
  );
  expect(model.lastSyncAt).toBe(later);
  expect(model.syncHealth?.ok).toBe(false);
  expect(model.syncHealth?.errors).toEqual(["sheet not shared"]);
});
