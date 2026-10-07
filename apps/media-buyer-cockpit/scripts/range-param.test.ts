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
