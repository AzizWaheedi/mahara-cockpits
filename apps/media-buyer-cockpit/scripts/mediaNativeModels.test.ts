import { describe, expect, it } from "bun:test";
import {
  campaignResults,
  creativeLaunchResult,
  parseRows,
  trackingGroups,
} from "../src/lib/mediaNativeModels";

describe("native media surface contracts", () => {
  it("rejects malformed source rows instead of converting missing figures to zero", () => {
    expect(() => parseRows([null])).toThrow();
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(() =>
      campaignResults(
        {
          adChanges: [],
          manualChanges: [],
          daily: [{ date: "2026-09-20" }],
          bookings: [],
        },
        now,
      ),
    ).toThrow("spend");
  });
  it("shows a buyer note with an inconclusive result when daily history is missing", () => {
    const at = Date.parse("2026-09-25T09:00:00Z");
    const result = campaignResults(
      {
        adChanges: [],
        manualChanges: [
          { _id: "note", at, by: "Buyer", what: "Changed budget" },
        ],
        daily: [],
        bookings: [],
      },
      Date.parse("2026-10-02T09:00:00Z"),
    );
    expect(result.changes[0].label).toBe("Changed budget");
    expect(result.changes[0].result.state).toBe("inconclusive");
  });
  it("filters Meta housekeeping and machine-generated activity", () => {
    const at = Date.parse("2026-09-30T09:00:00Z");
    const result = campaignResults(
      {
        adChanges: [
          { _id: "a", at, actor: "Meta", eventType: "Budget updated" },
          { _id: "b", at, actor: "Buyer", eventType: "Name updated" },
        ],
        manualChanges: [],
        daily: [],
        bookings: [],
      },
      at,
    );
    expect(result.changes).toEqual([]);
  });
  it("rejects invalid future creative launch dates", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(() =>
      creativeLaunchResult(
        { adChanges: [], manualChanges: [], daily: [], bookings: [] },
        { launchedAt: now + 172800000, launchedAdId: "123" },
        now,
      ),
    ).toThrow("launch date");
  });
  it("groups actual tracking issues without manufacturing a zero status", () => {
    expect(
      trackingGroups([
        { client: "A", adName: "One", issue: "No URL parameters" },
        { client: "A", adName: "Two", issue: "No lead form attached" },
      ]),
    ).toEqual([
      {
        client: "A",
        count: 2,
        ads: [
          { adName: "One", issue: "No URL parameters" },
          { adName: "Two", issue: "No lead form attached" },
        ],
      },
    ]);
  });
});
