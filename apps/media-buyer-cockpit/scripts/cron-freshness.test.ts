import { expect, test } from "bun:test";
import { overdueCronRows } from "../convex/cronFreshness";

const min = 60_000;
const day = (t: string) => Date.parse(`2026-09-23T${t}Z`);
const board = new Set(["board KPI columns"]);
const sync = new Set(["sync"]);
const ceo = new Set(["ceo refresh"]);
const row = (job: string, at: number, everyMin: number) => ({
  job,
  at,
  everyMin,
});

test("the working-hours board job is not falsely stale overnight", () => {
  const previous = day("00:05") - 6 * 60 * min; // preceding day at 18:05 UTC
  expect(
    overdueCronRows(
      [row("board KPI columns", previous, 60)],
      day("02:59"),
      board,
    ),
  ).toEqual([]);
  expect(
    overdueCronRows(
      [row("board KPI columns", previous, 60)],
      day("03:51"),
      board,
    ).map(x => x.job),
  ).toEqual(["board KPI columns"]);
  expect(
    overdueCronRows(
      [row("board KPI columns", previous, 60)],
      day("04:05"),
      board,
    ).map(x => x.job),
  ).toEqual(["board KPI columns"]);
});

test("the hourly overnight sync is not judged on daytime 10-minute cadence", () => {
  expect(
    overdueCronRows([row("sync", day("00:00"), 10)], day("00:51"), sync),
  ).toEqual([]);
  expect(
    overdueCronRows([row("sync", day("00:00"), 10)], day("01:46"), sync).map(
      x => x.job,
    ),
  ).toEqual(["sync"]);
});

test("a missing always-on job beat is overdue, not a healthy recovery", () => {
  expect(overdueCronRows([], day("04:00"), new Set(["ceo refresh"]))).toEqual([
    { job: "ceo refresh", at: undefined, minutes: undefined },
  ]);
});

test("an absent board beat stays overdue after its 03:05 UTC slot", () => {
  expect(overdueCronRows([], day("03:51"), board)).toEqual([
    { job: "board KPI columns", at: undefined, minutes: undefined },
  ]);
  expect(overdueCronRows([], day("23:59"), board)).toHaveLength(1);
});

test("missing hourly overnight sync beat is overdue after its scheduled slot", () => {
  expect(overdueCronRows([], day("01:46"), new Set(["sync"]))).toHaveLength(1);
});

test("weekly market play beat is expected Friday at 02:00 UTC, not three weeks later", () => {
  const friday = Date.parse("2026-09-25T02:00:00Z");
  const previous = friday - 7 * 24 * 60 * min;
  const market = new Set(["market plays"]);
  expect(
    overdueCronRows(
      [row("market plays", previous, 10080)],
      friday + 45 * min,
      market,
    ),
  ).toEqual([]);
  expect(
    overdueCronRows(
      [row("market plays", previous, 10080)],
      friday + 46 * min,
      market,
    ).map(x => x.job),
  ).toEqual(["market plays"]);
});

test("removed jobs do not poison the aggregate; always-on jobs still go stale", () => {
  const old = day("04:00") - 24 * 60 * min;
  expect(
    overdueCronRows([row("removed job", old, 1)], day("04:00"), new Set()),
  ).toEqual([]);
  expect(
    overdueCronRows([row("ceo refresh", old, 15)], day("04:00"), ceo).map(
      x => x.job,
    ),
  ).toEqual(["ceo refresh"]);
});
