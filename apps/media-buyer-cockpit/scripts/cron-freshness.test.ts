import { expect, test } from "bun:test";
import { overdueCronRows } from "../convex/cronFreshness";

const min = 60_000;
const day = (t: string) => Date.parse(`2026-09-23T${t}Z`);
const active = new Set(["board KPI columns", "sync", "ceo refresh"]);
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
      active,
    ),
  ).toEqual([]);
  expect(
    overdueCronRows(
      [row("board KPI columns", previous, 60)],
      day("03:51"),
      active,
    ).map(x => x.job),
  ).toEqual(["board KPI columns"]);
  expect(
    overdueCronRows(
      [row("board KPI columns", previous, 60)],
      day("04:05"),
      active,
    ).map(x => x.job),
  ).toEqual(["board KPI columns"]);
});

test("the hourly overnight sync is not judged on daytime 10-minute cadence", () => {
  expect(
    overdueCronRows([row("sync", day("00:00"), 10)], day("00:51"), active),
  ).toEqual([]);
  expect(
    overdueCronRows([row("sync", day("00:00"), 10)], day("01:46"), active).map(
      x => x.job,
    ),
  ).toEqual(["sync"]);
});

test("removed jobs do not poison the aggregate; always-on jobs still go stale", () => {
  const old = day("04:00") - 24 * 60 * min;
  expect(
    overdueCronRows([row("removed job", old, 1)], day("04:00"), active),
  ).toEqual([]);
  expect(
    overdueCronRows([row("ceo refresh", old, 15)], day("04:00"), active).map(
      x => x.job,
    ),
  ).toEqual(["ceo refresh"]);
});
