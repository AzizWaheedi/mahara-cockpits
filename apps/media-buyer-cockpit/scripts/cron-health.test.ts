import { expect, test } from "bun:test";
import { scheduledJobHealth } from "../convex/cronFreshness";

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

test("zero overdue jobs produce exactly one recovery sample", () => {
  expect(scheduledJobHealth([])).toEqual([{ source: "jobs", ok: true }]);
});
