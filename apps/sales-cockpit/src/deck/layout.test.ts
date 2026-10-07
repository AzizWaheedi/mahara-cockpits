import { describe, expect, test } from "bun:test";
import { justify } from "./layout";

const fits = (
  rows: ReturnType<typeof justify>,
  w: number,
  h: number,
  gap: number,
) => {
  const height = rows.reduce((s, r) => s + r[0].h, 0) + gap * (rows.length - 1);
  const widest = Math.max(
    ...rows.map(r => r.reduce((s, p) => s + p.w, 0) + gap * (r.length - 1)),
  );
  return height <= h + 0.01 && widest <= w + 0.01;
};

describe("justify", () => {
  test("keeps every picture, in order, at its own shape", () => {
    const ratios = [1.856, 1.416, 3.318];
    const rows = justify(ratios, 1112, 784, 22);
    const flat = rows.flat();
    expect(flat.map(p => p.i)).toEqual([0, 1, 2]);
    for (const p of flat) expect(p.w / p.h).toBeCloseTo(ratios[p.i], 6);
    expect(fits(rows, 1112, 784, 22)).toBe(true);
  });

  test("a row's pictures share one height", () => {
    for (const row of justify([2.494, 3.402, 2.197, 1.174], 1200, 560, 24))
      for (const p of row) expect(p.h).toBeCloseTo(row[0].h, 6);
  });

  test("three wide alerts stack instead of shrinking into one row", () => {
    const rows = justify([4.396, 4.494, 2.54], 1112, 784, 22);
    expect(rows).toHaveLength(3);
    expect(fits(rows, 1112, 784, 22)).toBe(true);
  });

  test("a tall page beside a wide one stays in one row", () => {
    const rows = justify([0.669, 1.86], 1112, 784, 22);
    expect(rows).toHaveLength(1);
  });

  test("never draws a picture wider than it is", () => {
    const rows = justify([3.318, 1.856], 1112, 784, 22, [909, 1145]);
    for (const p of rows.flat())
      expect(p.w).toBeLessThanOrEqual([909, 1145][p.i] + 0.01);
  });

  test("an empty list or an empty box lays out nothing", () => {
    expect(justify([], 100, 100, 10)).toEqual([]);
    expect(justify([1], 0, 100, 10)).toEqual([]);
  });
});
