/** Campaign sorting and window checks for the Meta reach and frequency read. */
import { describe, expect, test } from "bun:test";
import {
  campaignType,
  checkRange,
  MAX_SPAN_DAYS,
} from "../convex/ceo/frequency";

describe("campaignType", () => {
  test("follows the B2B dashboard's rule", () => {
    expect(campaignType("Hiring - Setters KSA")).toBe("excluded");
    expect(campaignType("Recruitment ad")).toBe("excluded");
    expect(campaignType("Hammer Them - Retargeting")).toBe("retargeting");
    expect(campaignType("Remarketing Q3")).toBe("retargeting");
    expect(campaignType("ROAS Form Leads KSA")).toBe("lead_gen");
    expect(campaignType(null)).toBe("lead_gen");
  });
});

describe("checkRange", () => {
  test("refuses a bad, backwards, future or overlong window", () => {
    expect(() => checkRange("2026-8-1", "2026-08-31")).toThrow();
    expect(() => checkRange("2026-08-31", "2026-08-01")).toThrow();
    expect(() => checkRange("2099-01-01", "2099-01-02")).toThrow();
    expect(() => checkRange("2024-01-01", "2026-01-01")).toThrow(
      `${MAX_SPAN_DAYS}`,
    );
    expect(() => checkRange("2026-08-01", "2026-08-31")).not.toThrow();
  });
});
