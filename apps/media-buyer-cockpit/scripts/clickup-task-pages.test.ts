import { describe, expect, test } from "bun:test";
import { collectClickUpTaskPages } from "../convex/clickupTaskPages";

describe("ClickUp creative board pagination", () => {
  test("keeps a batch created after the first 100 tasks", async () => {
    const calls: number[] = [];
    const tasks = await collectClickUpTaskPages(async page => {
      calls.push(page);
      return page === 0
        ? { tasks: Array.from({ length: 100 }, (_, i) => ({ id: `${i}` })) }
        : { tasks: [{ id: "new-batch" }], last_page: true };
    });
    expect(calls).toEqual([0, 1]);
    expect(tasks).toHaveLength(101);
    expect(tasks.at(-1)?.id).toBe("new-batch");
  });

  test("fails closed if a list exceeds the scan limit", async () => {
    await expect(
      collectClickUpTaskPages(
        async () => ({ tasks: Array.from({ length: 100 }, () => 1) }),
        2,
      ),
    ).rejects.toThrow("exceeds 2 pages");
  });
});
