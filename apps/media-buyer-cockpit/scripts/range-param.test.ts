import { describe, expect, test } from "bun:test";
import {
  customRange,
  defaultRange,
  PRESETS,
  rangeFromParam,
  rangeToParam,
} from "../src/lib/range";

/**
 * The board's and a client page's range live in the address (?range=3d), so
 * a 3-day pick no longer snaps back to 7 days on a reload, a trip to another
 * page or opening a client (Nada, 2026-10-01; the simplification audit,
 * 2026-10-06).
 */
describe("the range in the address", () => {
  test("every preset comes back from its key", () => {
    for (const p of PRESETS) {
      const r = p.make();
      expect(rangeToParam(r)).toBe(p.key);
      expect(rangeFromParam(rangeToParam(r))).toEqual(r);
    }
  });

  test("a custom span comes back from its dates, in order", () => {
    const r = customRange("2026-09-14", "2026-09-01");
    expect(rangeToParam(r)).toBe("2026-09-01..2026-09-14");
    expect(rangeFromParam("2026-09-01..2026-09-14")).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-14",
      key: "custom",
    });
  });

  test("anything else is not a range, and the default stays 7 days", () => {
    expect(rangeFromParam(null)).toBeUndefined();
    expect(rangeFromParam("")).toBeUndefined();
    expect(rangeFromParam("5y")).toBeUndefined();
    expect(rangeFromParam("2026-9-1..x")).toBeUndefined();
    expect(defaultRange().key).toBe("7d");
  });
});

/**
 * "Last N days" are the N complete days before today (2026-10-21): the media
 * data runs to yesterday, so a range that ended today held a day fewer than
 * its name and an opened campaign disagreed with its 7-day row.
 */
describe("the presets in Kuwait days", () => {
  const day = (n: number) =>
    new Date(Date.now() + 3 * 3600 * 1000 - n * 86400000)
      .toISOString()
      .slice(0, 10);
  const preset = (key: string) => PRESETS.find(p => p.key === key)?.make();

  test("last 3, 7, 14 and 30 days end yesterday and hold that many days", () => {
    for (const [key, n] of [
      ["3d", 3],
      ["7d", 7],
      ["14d", 14],
      ["30d", 30],
    ] as const) {
      expect(preset(key)).toMatchObject({ start: day(n), end: day(1) });
    }
  });

  test("today is today, and yesterday is yesterday", () => {
    expect(preset("today")).toMatchObject({ start: day(0), end: day(0) });
    expect(preset("yesterday")).toMatchObject({ start: day(1), end: day(1) });
  });
});
