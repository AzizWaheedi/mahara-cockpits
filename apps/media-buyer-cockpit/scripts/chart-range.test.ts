/**
 * The timeframe control on every CEO chart: presets count back from the
 * newest point, months step on the calendar, custom dates are inclusive and
 * tolerate being empty or reversed, and monthly series are cut on months.
 */
import { describe, expect, test } from "bun:test";
import { filterRange, rangeStart } from "../src/components/ceo/chartKit";

const days = (from: string, n: number) => {
  const out: { date: string; v: number }[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push({
      date: new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
      v: i,
    });
  }
  return out;
};
const none = { from: "", to: "" };

describe("rangeStart", () => {
  test("day presets count back from the newest point, inclusive", () => {
    expect(rangeStart("7d", "2026-09-19")).toBe("2026-09-13");
    expect(rangeStart("30d", "2026-09-19")).toBe("2026-08-21");
    expect(rangeStart("90d", "2026-09-19")).toBe("2026-06-22");
  });
  test("month presets step on the calendar and survive short months", () => {
    expect(rangeStart("6m", "2026-09-19")).toBe("2026-03-20");
    expect(rangeStart("12m", "2026-09-19")).toBe("2025-09-20");
    // 31 March minus six months is 30 September, so the window starts 1 October.
    expect(rangeStart("6m", "2026-03-31")).toBe("2025-10-01");
    expect(rangeStart("6m", "2026-08-31")).toBe("2026-03-01");
    expect(rangeStart("12m", "2028-02-29")).toBe("2027-03-01");
  });
  test("everything and custom have no start", () => {
    expect(rangeStart("all", "2026-09-19")).toBeNull();
    expect(rangeStart("custom", "2026-09-19")).toBeNull();
  });
  test("monthly series cut on whole months", () => {
    expect(rangeStart("7d", "2026-09")).toBe("2026-09");
    expect(rangeStart("90d", "2026-09")).toBe("2026-07");
    expect(rangeStart("12m", "2026-09")).toBe("2025-10");
  });
});

describe("filterRange", () => {
  const data = days("2026-06-01", 111); // through 2026-09-19
  test("presets keep exactly the trailing window", () => {
    expect(filterRange(data, "date", "7d", none)).toHaveLength(7);
    expect(filterRange(data, "date", "30d", none)).toHaveLength(30);
    expect(filterRange(data, "date", "90d", none)).toHaveLength(90);
    expect(filterRange(data, "date", "all", none)).toHaveLength(111);
  });
  test("a preset longer than the data returns everything, never throws", () => {
    expect(filterRange(data, "date", "12m", none)).toHaveLength(111);
    expect(filterRange([], "date", "12m", none)).toHaveLength(0);
    expect(filterRange(data.slice(0, 1), "date", "7d", none)).toHaveLength(1);
  });
  test("custom dates are inclusive and half-open when one side is blank", () => {
    expect(
      filterRange(data, "date", "custom", {
        from: "2026-09-01",
        to: "2026-09-10",
      }),
    ).toHaveLength(10);
    expect(
      filterRange(data, "date", "custom", { from: "2026-09-15", to: "" }),
    ).toHaveLength(5);
    expect(
      filterRange(data, "date", "custom", { from: "", to: "2026-06-03" }),
    ).toHaveLength(3);
    expect(filterRange(data, "date", "custom", none)).toHaveLength(111);
  });
  test("reversed custom dates give nothing rather than everything", () => {
    expect(
      filterRange(data, "date", "custom", {
        from: "2026-09-10",
        to: "2026-09-01",
      }),
    ).toHaveLength(0);
  });
  test("monthly rows compare on the month even when the dates carry a day", () => {
    const months = [
      { month: "2026-04", v: 1 },
      { month: "2026-05", v: 2 },
      { month: "2026-06", v: 3 },
      { month: "2026-07", v: 4 },
      { month: "2026-08", v: 5 },
      { month: "2026-09", v: 6 },
    ];
    expect(filterRange(months, "month", "90d", none).map(r => r.month)).toEqual(
      ["2026-07", "2026-08", "2026-09"],
    );
    expect(
      filterRange(months, "month", "custom", {
        from: "2026-05-14",
        to: "2026-06-30",
      }).map(r => r.month),
    ).toEqual(["2026-05", "2026-06"]);
  });
  test("rows with a missing x are dropped by a preset, kept by everything", () => {
    const odd = [{ v: 1 }, ...days("2026-09-10", 10)];
    expect(filterRange(odd, "date", "7d", none)).toHaveLength(7);
    expect(filterRange(odd, "date", "all", none)).toHaveLength(11);
  });
});
