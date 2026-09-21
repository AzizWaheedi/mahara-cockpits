/** Working hours per person: the shape, the checks and the sentence. */
import { describe, expect, test } from "bun:test";
import {
  DAY_KEYS,
  defaultSchedule,
  hoursOn,
  hoursPerWeek,
  normaliseSchedule,
  normaliseTime,
  parseSchedule,
  type Schedule,
  scheduleSummary,
  windowOn,
} from "../convex/ceo/schedule";

const withDays = (
  patch: Partial<
    Record<(typeof DAY_KEYS)[number], Partial<Schedule["week"]["mon"]>>
  >,
  exceptions: Schedule["exceptions"] = [],
): Schedule => {
  const s = defaultSchedule();
  for (const [k, v] of Object.entries(patch))
    s.week[k as (typeof DAY_KEYS)[number]] = {
      ...s.week[k as (typeof DAY_KEYS)[number]],
      ...v,
    };
  s.exceptions = exceptions;
  return s;
};

describe("defaultSchedule", () => {
  test("Saturday to Thursday 10:00 to 18:00, off on Friday, Kuwait time", () => {
    const s = defaultSchedule();
    expect(s.timezone).toBe("Asia/Kuwait");
    expect(Object.keys(s.week)).toEqual([...DAY_KEYS]);
    for (const k of DAY_KEYS) {
      expect(s.week[k].on).toBe(k !== "fri");
      expect(s.week[k].start).toBe("10:00");
      expect(s.week[k].end).toBe("18:00");
    }
    expect(s.exceptions).toEqual([]);
    expect(hoursPerWeek(s)).toBe(48);
  });
  test("is a fresh object each time", () => {
    const a = defaultSchedule();
    a.week.mon.on = false;
    expect(defaultSchedule().week.mon.on).toBe(true);
  });
});

describe("normaliseTime", () => {
  test("pads and refuses", () => {
    expect(normaliseTime("9:00")).toBe("09:00");
    expect(normaliseTime(" 18:30 ")).toBe("18:30");
    expect(normaliseTime("24:00")).toBeNull();
    expect(normaliseTime("10:60")).toBeNull();
    expect(normaliseTime("10")).toBeNull();
    expect(normaliseTime("")).toBeNull();
    expect(normaliseTime(null)).toBeNull();
  });
});

describe("normaliseSchedule", () => {
  test("the default passes through unchanged", () => {
    const s = defaultSchedule();
    expect(normaliseSchedule(s)).toEqual(s);
    expect(normaliseSchedule(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  test("fills what is missing: timezone, days, exceptions, padded times", () => {
    const s = normaliseSchedule({
      week: { mon: { on: true, start: "9:00", end: "17:30" }, tue: {} },
    });
    expect(s.timezone).toBe("Asia/Kuwait");
    expect(s.week.mon).toEqual({ on: true, start: "09:00", end: "17:30" });
    expect(s.week.tue).toEqual({ on: false, start: "10:00", end: "18:00" });
    expect(s.week.sun).toEqual({ on: false, start: "10:00", end: "18:00" });
    expect(s.exceptions).toEqual([]);
  });
  test("returns a fresh object in the stored shape", () => {
    const input = {
      timezone: "Asia/Kuwait",
      week: defaultSchedule().week,
      exceptions: [],
      extra: 1,
    };
    const s = normaliseSchedule(input);
    expect("extra" in s).toBe(false);
    expect(s.week).not.toBe(input.week);
  });
  test("a day that ends before it starts, in plain words", () => {
    expect(() =>
      normaliseSchedule(withDays({ tue: { start: "18:00", end: "10:00" } })),
    ).toThrow("Tuesday ends before it starts.");
    expect(() =>
      normaliseSchedule(withDays({ sat: { start: "10:00", end: "10:00" } })),
    ).toThrow("Saturday ends when it starts.");
  });
  test("an off day keeps its times and is not checked for order", () => {
    const s = normaliseSchedule(
      withDays({ fri: { on: false, start: "18:00", end: "10:00" } }),
    );
    expect(s.week.fri).toEqual({ on: false, start: "18:00", end: "10:00" });
  });
  test("refuses times that are not times", () => {
    expect(() =>
      normaliseSchedule(withDays({ wed: { start: "ten" } })),
    ).toThrow("Wednesday's start is not a time like 09:00.");
    expect(() =>
      normaliseSchedule(withDays({ wed: { end: "25:00" } })),
    ).toThrow("Wednesday's end is not a time like 09:00.");
    expect(() =>
      // @ts-expect-error on must be a boolean
      normaliseSchedule(withDays({ mon: { on: "yes" } })),
    ).toThrow("Monday is either on or off.");
  });
  test("refuses shapes that are not a week", () => {
    expect(() => normaliseSchedule(null)).toThrow("Hours need a week of days.");
    expect(() => normaliseSchedule({})).toThrow("Hours need a week of days.");
    expect(() => normaliseSchedule({ week: [] })).toThrow(
      "Hours need a week of days.",
    );
    expect(() => normaliseSchedule({ week: { mon: 5 } })).toThrow(
      "Monday needs on or off, a start and an end.",
    );
    expect(() =>
      normaliseSchedule({ ...defaultSchedule(), timezone: "Kuwait time" }),
    ).toThrow("The timezone should be a name like Asia/Kuwait.");
  });
  test("exceptions: sorted, one per date, off or a window", () => {
    const s = normaliseSchedule(
      withDays({}, [
        { date: "2026-09-27", start: "12:00", end: "16:00" },
        { date: "2026-09-25", off: true },
      ]),
    );
    expect(s.exceptions).toEqual([
      { date: "2026-09-25", off: true },
      { date: "2026-09-27", start: "12:00", end: "16:00" },
    ]);
    expect(() =>
      normaliseSchedule(
        withDays({}, [
          { date: "2026-09-25", off: true },
          { date: "2026-09-25", start: "12:00", end: "16:00" },
        ]),
      ),
    ).toThrow("25 Sep is listed twice.");
    expect(() =>
      normaliseSchedule(
        withDays({}, [{ date: "2026-09-25", start: "16:00", end: "12:00" }]),
      ),
    ).toThrow("The 25 Sep exception ends before it starts.");
    expect(() =>
      // @ts-expect-error an exception without off or a window
      normaliseSchedule(withDays({}, [{ date: "2026-09-25" }])),
    ).toThrow(
      "The 25 Sep exception needs a start and an end like 12:00 to 16:00, or off.",
    );
    expect(() =>
      normaliseSchedule(withDays({}, [{ date: "2026-02-30", off: true }])),
    ).toThrow('An exception needs a date like 2026-09-25, not "2026-02-30".');
    expect(() =>
      // @ts-expect-error off must be true or absent
      normaliseSchedule(withDays({}, [{ date: "2026-09-25", off: "no" }])),
    ).toThrow("The 25 Sep exception is either off, or a start and an end.");
    expect(() =>
      normaliseSchedule({ ...defaultSchedule(), exceptions: {} }),
    ).toThrow("Exceptions are a list of dates.");
  });
});

describe("parseSchedule", () => {
  test("null for nothing stored or a shape that no longer fits", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule(undefined)).toBeNull();
    expect(
      parseSchedule({ week: { mon: { on: true, start: "x" } } }),
    ).toBeNull();
    expect(parseSchedule(defaultSchedule())).toEqual(defaultSchedule());
  });
});

describe("hoursPerWeek", () => {
  test("sums the on days only", () => {
    expect(hoursPerWeek(defaultSchedule())).toBe(48);
    expect(
      hoursPerWeek(withDays({ thu: { on: false }, wed: { end: "14:30" } })),
    ).toBe(36.5);
    const none = defaultSchedule();
    for (const k of DAY_KEYS) none.week[k].on = false;
    expect(hoursPerWeek(none)).toBe(0);
  });
  test("exceptions do not change the weekly figure", () => {
    expect(
      hoursPerWeek(withDays({}, [{ date: "2026-09-21", off: true }])),
    ).toBe(48);
  });
});

describe("hoursOn and windowOn", () => {
  const s = withDays({ thu: { start: "10:00", end: "14:00" } }, [
    { date: "2026-09-22", off: true },
    { date: "2026-09-26", start: "12:00", end: "15:30" },
  ]);
  test("a normal weekday reads the week line", () => {
    // 2026-09-21 is a Monday, 2026-09-24 a Thursday, 2026-09-25 a Friday.
    expect(hoursOn(s, "2026-09-21")).toBe(8);
    expect(hoursOn(s, "2026-09-24")).toBe(4);
    expect(hoursOn(s, "2026-09-25")).toBe(0);
    expect(windowOn(s, "2026-09-25")).toBeNull();
    expect(windowOn(s, "2026-09-21")).toEqual({ start: "10:00", end: "18:00" });
  });
  test("an exception replaces the weekday line", () => {
    expect(hoursOn(s, "2026-09-22")).toBe(0);
    expect(hoursOn(s, "2026-09-26")).toBe(3.5);
    expect(windowOn(s, "2026-09-26")).toEqual({ start: "12:00", end: "15:30" });
  });
  test("a day that is not a day is 0 hours, not a crash", () => {
    expect(hoursOn(s, "next Tuesday")).toBe(0);
    expect(windowOn(s, "2026-13-01")).toBeNull();
  });
});

describe("scheduleSummary", () => {
  test("the default week", () => {
    expect(scheduleSummary(defaultSchedule())).toBe(
      "Sat to Thu 10:00 to 18:00, 48 h a week",
    );
  });
  test("exceptions are counted", () => {
    expect(
      scheduleSummary(
        withDays({}, [
          { date: "2026-09-25", off: true },
          { date: "2026-09-27", start: "12:00", end: "16:00" },
        ]),
      ),
    ).toBe("Sat to Thu 10:00 to 18:00, 48 h a week, 2 exceptions");
    expect(
      scheduleSummary(withDays({}, [{ date: "2026-09-25", off: true }])),
    ).toBe("Sat to Thu 10:00 to 18:00, 48 h a week, 1 exception");
  });
  test("a second window gets its own clause", () => {
    expect(
      scheduleSummary(withDays({ thu: { start: "10:00", end: "14:00" } })),
    ).toBe("Sat to Wed 10:00 to 18:00, Thu 10:00 to 14:00, 44 h a week");
  });
  test("scattered days are listed, runs of three or more are ranges", () => {
    expect(
      scheduleSummary(
        withDays({
          sun: { on: false },
          tue: { on: false },
          thu: { on: false },
        }),
      ),
    ).toBe("Sat, Mon and Wed 10:00 to 18:00, 24 h a week");
    expect(scheduleSummary(withDays({ mon: { on: false } }))).toBe(
      "Sat, Sun and Tue to Thu 10:00 to 18:00, 40 h a week",
    );
  });
  test("half hours read as decimals", () => {
    expect(
      scheduleSummary(
        withDays({
          thu: { on: false },
          wed: { on: false },
          tue: { end: "14:30" },
        }),
      ),
    ).toBe("Sat to Mon 10:00 to 18:00, Tue 10:00 to 14:30, 28.5 h a week");
  });
  test("no days on", () => {
    const none = defaultSchedule();
    for (const k of DAY_KEYS) none.week[k].on = false;
    expect(scheduleSummary(none)).toBe("No working days, 0 h a week");
    none.exceptions = [{ date: "2026-09-25", start: "10:00", end: "12:00" }];
    expect(scheduleSummary(none)).toBe(
      "No working days, 0 h a week, 1 exception",
    );
  });
});
