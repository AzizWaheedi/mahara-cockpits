import { describe, expect, test } from "bun:test";
import {
  batchBrief,
  batchKey,
  batchTitle,
  nextCreativeCycle,
} from "../convex/creativeCadenceLogic";

describe("fortnightly creative batch planning", () => {
  test("uses Kuwait's date and one stable fortnight across repeated daily runs", () => {
    expect(nextCreativeCycle(Date.parse("2026-09-24T20:30:00Z"))).toBe(
      "2026-09-28",
    );
    expect(nextCreativeCycle(Date.parse("2026-09-27T21:30:00Z"))).toBe(
      "2026-09-28",
    );
    expect(nextCreativeCycle(Date.parse("2026-09-29T04:00:00Z"))).toBe(
      "2026-10-12",
    );
    expect(nextCreativeCycle(Date.parse("2026-10-08T05:00:00Z"))).toBe(
      "2026-10-12",
    );
  });

  test("keys the batch to the exact ClickUp client and cycle", () => {
    expect(batchKey("client-123", "2026-09-28")).toBe(
      "creative-batch:client-123:2026-09-28",
    );
    expect(batchKey("client-456", "2026-09-28")).not.toBe(
      batchKey("client-123", "2026-09-28"),
    );
    expect(batchTitle("Safad", "2026-09-28")).toContain("Creative batch ");
    expect(
      batchBrief("Safad", "2026-09-28", batchKey("client-123", "2026-09-28")),
    ).toContain("Intended first launch window: 2026-10-12");
    expect(
      batchBrief("Safad", "2026-09-28", batchKey("client-123", "2026-09-28")),
    ).toContain("Client approval target: 2026-10-05");
  });
});
