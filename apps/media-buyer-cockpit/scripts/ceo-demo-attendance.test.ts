import { describe, expect, test } from "bun:test";
import { demoAttendanceForDays } from "../src/pages/ceo/demoAttendance";
import type { GrowthDay } from "../src/types/ceo/payloads";

const row = (
  date: string,
  demosShown: number,
  demosQualified: number,
): GrowthDay => ({
  date,
  demosShown,
  demosQualified,
  spend: 0,
  leads: 0,
  booked: 0,
  closes: 0,
});

describe("Sales demo totals on Ads", () => {
  test("sums calls by appointment date and shows disqualified separately", () => {
    const days = [
      row("2026-11-01", 2, 1),
      row("2026-11-02", 0, 0),
      row("2026-11-03", 3, 3),
    ];
    expect(demoAttendanceForDays(days, "2026-11-01", "2026-11-03")).toEqual({
      held: 5,
      disqualified: 1,
    });
    expect(demoAttendanceForDays(days, "2026-11-02", "2026-11-03")).toEqual({
      held: 3,
      disqualified: 0,
    });
  });
  test("does not report partial, duplicate or unmeasured days as complete", () => {
    const d = row("2026-11-01", 1, 1);
    expect(demoAttendanceForDays([d], "2026-11-01", "2026-11-02")).toBeNull();
    expect(
      demoAttendanceForDays([d, d], "2026-11-01", "2026-11-01"),
    ).toBeNull();
    expect(
      demoAttendanceForDays(
        [{ ...d, demosShown: undefined }],
        "2026-11-01",
        "2026-11-01",
      ),
    ).toBeNull();
    expect(
      demoAttendanceForDays(
        [row("2026-11-01", 1, 2)],
        "2026-11-01",
        "2026-11-01",
      ),
    ).toBeNull();
    expect(demoAttendanceForDays([], "2026-11-31", "2026-12-01")).toBeNull();
  });
});
