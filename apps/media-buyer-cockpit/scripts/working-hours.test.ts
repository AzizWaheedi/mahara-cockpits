/** The working clock for speed to lead: the pure functions and the SQL builder. */
import { describe, expect, test } from "bun:test";
import {
  clockStart,
  DEFAULT_WORKING_HOURS,
  daysLabel,
  describeWorkingHours,
  normalizeWorkingHours,
  workingHoursFromStored,
  workingMinutesBetween,
  workingMinutesSql,
} from "../convex/ceo/workingHours";

/** An instant in Kuwait wall-clock time (UTC+3, no daylight saving). */
const kw = (y: number, m: number, d: number, h: number, min = 0) =>
  Date.UTC(y, m - 1, d, h, min) - 3 * 3600_000;

// 2026-09-17 is a Thursday, 18 a Friday (the day off), 19 a Saturday.
const H = DEFAULT_WORKING_HOURS;

describe("clockStart", () => {
  test("a lead created Friday night waits for Saturday 10:00", () => {
    expect(clockStart(kw(2026, 9, 18, 22, 30), H)).toBe(kw(2026, 9, 19, 10));
  });
  test("a lead created inside hours starts its clock at once", () => {
    expect(clockStart(kw(2026, 9, 20, 11), H)).toBe(kw(2026, 9, 20, 11));
  });
  test("a lead created at 17:50 starts at once, ten minutes before close", () => {
    expect(clockStart(kw(2026, 9, 20, 17, 50), H)).toBe(
      kw(2026, 9, 20, 17, 50),
    );
  });
  test("a lead created after close on Thursday skips Friday", () => {
    expect(clockStart(kw(2026, 9, 17, 19), H)).toBe(kw(2026, 9, 19, 10));
  });
  test("a lead created before open waits for 10:00 the same day", () => {
    expect(clockStart(kw(2026, 9, 20, 8), H)).toBe(kw(2026, 9, 20, 10));
  });
  test("a lead created exactly at close waits for the next day", () => {
    expect(clockStart(kw(2026, 9, 20, 18), H)).toBe(kw(2026, 9, 21, 10));
  });
});

describe("workingMinutesBetween", () => {
  test("a Friday night lead called Saturday 10:30 took 30 working minutes", () => {
    expect(
      workingMinutesBetween(kw(2026, 9, 18, 22), kw(2026, 9, 19, 10, 30), H),
    ).toBe(30);
  });
  test("created 17:50, called next day 10:05: ten minutes then five", () => {
    expect(
      workingMinutesBetween(kw(2026, 9, 20, 17, 50), kw(2026, 9, 21, 10, 5), H),
    ).toBe(15);
  });
  test("inside hours the working clock is the plain clock", () => {
    expect(
      workingMinutesBetween(kw(2026, 9, 20, 11), kw(2026, 9, 20, 11, 7), H),
    ).toBe(7);
  });
  test("a call before the clock starts counts 0", () => {
    expect(
      workingMinutesBetween(kw(2026, 9, 18, 22), kw(2026, 9, 18, 22, 10), H),
    ).toBe(0);
    expect(
      workingMinutesBetween(kw(2026, 9, 17, 19), kw(2026, 9, 17, 19, 30), H),
    ).toBe(0);
  });
  test("a call the next working day skips the day off", () => {
    // Thursday 17:00 to 18:00 is 60, Friday is off, Saturday 10:00 to 10:30 is 30.
    expect(
      workingMinutesBetween(kw(2026, 9, 17, 17), kw(2026, 9, 19, 10, 30), H),
    ).toBe(90);
  });
  test("a whole working day is 480 minutes", () => {
    expect(
      workingMinutesBetween(kw(2026, 9, 20, 9), kw(2026, 9, 20, 19), H),
    ).toBe(480);
  });
  test("a call before creation, or at it, is 0", () => {
    expect(
      workingMinutesBetween(kw(2026, 9, 20, 11), kw(2026, 9, 20, 10, 59), H),
    ).toBe(0);
    expect(
      workingMinutesBetween(kw(2026, 9, 20, 11), kw(2026, 9, 20, 11), H),
    ).toBe(0);
  });
  test("other hours: a Monday-to-Friday 09:00 to 17:00 week", () => {
    const office = normalizeWorkingHours(
      { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      "settings",
    );
    expect(
      workingMinutesBetween(
        kw(2026, 9, 18, 16, 30),
        kw(2026, 9, 21, 9, 15),
        office,
      ),
    ).toBe(45);
  });
});

describe("normalizeWorkingHours", () => {
  test("keeps good hours and orders the days Saturday first", () => {
    expect(
      normalizeWorkingHours(
        { start: "10:00", end: "18:00", days: [4, 6, 6, 1] },
        "settings",
        5,
      ),
    ).toEqual({
      start: "10:00",
      end: "18:00",
      days: [6, 1, 4],
      timezone: "Asia/Kuwait",
      source: "settings",
      updatedAt: 5,
    });
  });
  test("refuses what it cannot run on", () => {
    const ok = { start: "10:00", end: "18:00", days: [1] };
    expect(() =>
      normalizeWorkingHours({ ...ok, start: "25:00" }, "settings"),
    ).toThrow(/looks like 10:00/);
    expect(() =>
      normalizeWorkingHours({ ...ok, end: "09:00" }, "settings"),
    ).toThrow(/after its start/);
    expect(() =>
      normalizeWorkingHours({ ...ok, days: [] }, "settings"),
    ).toThrow(/at least one/);
    expect(() =>
      normalizeWorkingHours({ ...ok, days: [8] }, "settings"),
    ).toThrow(/ISO weekdays/);
    expect(() =>
      normalizeWorkingHours({ ...ok, timezone: "Europe/London" }, "settings"),
    ).toThrow(/Asia\/Kuwait only/);
  });
});

describe("workingHoursFromStored", () => {
  test("reads a saved row", () => {
    expect(
      workingHoursFromStored(
        { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
        123,
      ),
    ).toEqual({
      start: "09:00",
      end: "17:00",
      days: [1, 2, 3, 4, 5],
      timezone: "Asia/Kuwait",
      source: "settings",
      updatedAt: 123,
    });
  });
  test("a broken row is null, never a guess", () => {
    expect(workingHoursFromStored(null)).toBeNull();
    expect(workingHoursFromStored("10:00")).toBeNull();
    expect(
      workingHoursFromStored({ start: "x", end: "y", days: [1] }),
    ).toBeNull();
    expect(workingHoursFromStored({ start: "10:00", end: "18:00" })).toBeNull();
  });
});

describe("words", () => {
  test("daysLabel", () => {
    expect(daysLabel([6, 7, 1, 2, 3, 4])).toBe("Saturday to Thursday");
    expect(daysLabel([1, 2, 3, 4, 5, 6, 7])).toBe("every day");
    expect(daysLabel([6, 1, 3])).toBe("Saturday, Monday and Wednesday");
    expect(daysLabel([1, 2])).toBe("Monday and Tuesday");
    expect(daysLabel([5])).toBe("Friday");
  });
  test("describeWorkingHours", () => {
    expect(describeWorkingHours(H)).toBe(
      "10:00 to 18:00 Asia/Kuwait, Saturday to Thursday",
    );
  });
});

describe("workingMinutesSql", () => {
  test("embeds the hours, the days, the zone and both expressions", () => {
    const s = workingMinutesSql("l.created_at", "l.first_call", H);
    expect(s).toContain("time '10:00'");
    expect(s).toContain("time '18:00'");
    expect(s).toContain("in (6, 7, 1, 2, 3, 4)");
    expect(s).toContain("at time zone 'Asia/Kuwait'");
    expect(s).toContain("l.created_at");
    expect(s).toContain("l.first_call");
    expect(s).toContain("generate_series");
  });
  test("refuses hours that would not be safe in query text", () => {
    expect(() =>
      workingMinutesSql("a", "b", { ...H, start: "10:00'; drop table x; --" }),
    ).toThrow();
    expect(() => workingMinutesSql("a", "b", { ...H, days: [1.5] })).toThrow();
    expect(() =>
      workingMinutesSql("a", "b", { ...H, timezone: "Asia/Kuwait'--" }),
    ).toThrow();
  });
});
