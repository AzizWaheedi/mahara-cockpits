import { describe, expect, test } from "bun:test";
import { notCalledByTask } from "../src/lib/notCalled";

/** The Today rows' "not called" count (Muhammed, 22 October 2026), from invented links and counts. */
const morning = {
  clients: [
    { locationId: "loc-a", neverCalled: 4 },
    { locationId: "loc-b", neverCalled: 0 },
    { locationId: "loc-c", neverCalled: 2 },
  ],
} as never;

describe("leads not called on the Today rows", () => {
  test("each ClickUp task gets the never-called count of its CRM locations", () => {
    const links = {
      clients: [
        { taskId: "task-a", locationId: "loc-a" },
        { taskId: "task-b", locationId: "loc-b" },
        { taskId: "task-two", locationId: "loc-a" },
        { taskId: "task-two", locationId: "loc-c" },
      ],
    };
    const map = notCalledByTask(links, morning);
    expect(map.get("task-a")).toBe(4);
    expect(map.get("task-b")).toBe(0);
    expect(map.get("task-two")).toBe(6);
  });

  test("a client off the list, a missing task id or a repeated link adds nothing", () => {
    const links = {
      clients: [
        { taskId: "task-dwy", locationId: "loc-dwy" },
        { taskId: null, locationId: "loc-a" },
        { taskId: " task-a ", locationId: "loc-a" },
        { taskId: "task-a", locationId: "loc-a" },
      ],
    };
    const map = notCalledByTask(links, morning);
    expect(map.has("task-dwy")).toBe(false);
    expect(map.get("task-a")).toBe(4);
    expect(map.size).toBe(1);
  });

  test("an answer in a shape this page cannot read shows no counts", () => {
    expect(notCalledByTask({ nope: true }, morning).size).toBe(0);
    expect(notCalledByTask(null, morning).size).toBe(0);
  });
});
