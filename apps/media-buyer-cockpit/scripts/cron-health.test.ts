import { expect, test } from "bun:test";
import { overdueCronRows, scheduledJobHealth } from "../convex/cronFreshness";

test("one smoke tick counts once even if several jobs are overdue", () => {
  const health = scheduledJobHealth([
    { job: "ceo refresh", minutes: 82 },
    { job: "hermes relay", minutes: 76 },
  ]);
  expect(health).toHaveLength(1);
  expect(health[0]?.source).toBe("jobs");
  expect(health[0]?.ok).toBe(false);
  expect(health[0]?.error).toContain("ceo refresh");
  expect(health[0]?.error).toContain("hermes relay");
});

test("never-beaten expected jobs cannot emit a healthy smoke recovery", () => {
  const stale = overdueCronRows(
    [],
    Date.parse("2026-09-23T04:00:00Z"),
    new Set(["ceo refresh", "board KPI columns"]),
  );
  const health = scheduledJobHealth(stale);
  expect(health).toHaveLength(1);
  expect(health[0]?.ok).toBe(false);
  expect(health[0]?.error).toContain('"ceo refresh" has never run');
  expect(health[0]?.error).toContain('"board KPI columns" has never run');
});

test("zero overdue jobs produce exactly one recovery sample", () => {
  expect(scheduledJobHealth([])).toEqual([{ source: "jobs", ok: true }]);
});
