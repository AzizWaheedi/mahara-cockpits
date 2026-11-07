import { describe, expect, test } from "bun:test";
import { isPriorityVideo, priorityFirst } from "../src/lib/videoPriority";

describe("ClickUp video priority", () => {
  test("only urgent is priority; missing data never creates a false priority", () => {
    expect(isPriorityVideo({ priority: "urgent" })).toBe(true);
    for (const priority of ["high", "normal", "low", null, undefined] as const)
      expect(isPriorityVideo({ priority })).toBe(false);
  });
  test("urgent work comes first without disturbing due order within each group", () => {
    const jobs = [
      { id: "normal-early", priority: "normal" as const },
      { id: "urgent-early", priority: "urgent" as const },
      { id: "urgent-later", priority: "urgent" as const },
      { id: "normal-later", priority: null },
    ];
    expect(jobs.sort(priorityFirst).map(job => job.id)).toEqual([
      "urgent-early",
      "urgent-later",
      "normal-early",
      "normal-later",
    ]);
  });
});
