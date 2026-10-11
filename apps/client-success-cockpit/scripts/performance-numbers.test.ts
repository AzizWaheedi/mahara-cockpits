import { expect, test } from "bun:test";
import { bucketDays, delta, partialBucket } from "../src/components/TrendChart";
import { byAdIn, periodNumbers, withSheetMonth } from "../src/lib/reportPeriod";

const today = "2026-10-11";

test("This month keeps ad leads and spend, and takes only outcomes from the sheet tab", () => {
  const ads = periodNumbers(
    [],
    [{ date: "2026-10-02", leads: 40, spend: 400 }],
    "2026-10-01",
    "2026-10-31",
    today,
  );
  const sheetTab = {
    leads: 25,
    booked: 12,
    shows: 8,
    noshows: 2,
    closes: 3,
    showRate: 80,
  };
  const m = withSheetMonth(ads, sheetTab);
  expect(m?.leads).toBe(40);
  expect(m?.cpl).toBe(10);
  expect(m?.leadsFrom).toBe("ads");
  expect(m?.booked).toBe(12);
  expect(m?.sheetLeads).toBe(25);
});

test("a never-booked lead is not counted as an appointment with no outcome", () => {
  const appts = [
    { added: "2026-10-02", booked: false, ad: "A" },
    { added: "2026-10-02", booked: true, appAt: "2026-10-03", ad: "A" },
  ];
  const [a] = byAdIn(appts, "2026-10-01", "2026-10-10", today);
  expect(a.unknown).toBe(1);
  expect(
    periodNumbers(appts, [], "2026-10-01", "2026-10-10", today).unknownOutcome,
  ).toBe(1);
});

test("close rate counts closes among the people who came, so it cannot pass 100%", () => {
  const appts = [
    { added: "2026-10-02", booked: true, show: "y", closed: "y" },
    { added: "2026-10-02", booked: true, show: "", closed: "y" },
    { added: "2026-10-02", booked: true, show: "", closed: "y" },
  ];
  const n = periodNumbers(appts, [], "2026-10-01", "2026-10-10", today);
  expect(n.closes).toBe(3);
  expect(n.closeRate).toBe(100);
  expect(byAdIn(appts, "2026-10-01", "2026-10-10", today)[0].closeRate).toBe(
    100,
  );
});

test("a period before the first ad day uses the sheet count, not an ad zero", () => {
  const appts = [{ added: "2026-08-03", booked: true }];
  const adDays = [{ date: "2026-09-15", leads: 5, spend: 50 }];
  const before = periodNumbers(
    appts,
    adDays,
    "2026-08-01",
    "2026-08-31",
    today,
  );
  expect(before.leadsFrom).toBe("sheet");
  expect(before.leads).toBe(1);
  const quiet = periodNumbers([], adDays, "2026-09-20", "2026-09-30", today);
  expect(quiet.leadsFrom).toBe("ads");
  expect(quiet.leads).toBe(0);
});

test("the ad table limit is explicit, so the page can say how many it hides", () => {
  const appts = Array.from({ length: 15 }, (_, i) => ({
    added: "2026-10-02",
    ad: `Ad ${i}`,
  }));
  expect(byAdIn(appts, "2026-10-01", "2026-10-10", today)).toHaveLength(12);
  expect(
    byAdIn(appts, "2026-10-01", "2026-10-10", today, Number.POSITIVE_INFINITY),
  ).toHaveLength(15);
});

test("a ratio trend compares sum over sum, not the average of daily ratios", () => {
  // Thirds of nine days. Days 4-6: $10 for 1 lead each (CPL 10). Days 7-9:
  // one $100 day for 1 lead and two $0 days for 9 leads each. The daily
  // ratios average 33.3 (a 233% rise), but the real CPL is 100 / 19 = 5.26,
  // a 47% fall.
  const pts = [
    ...[1, 2, 3, 4, 5, 6].map(d => ({ x: `d${d}`, y: 10, num: 10, den: 1 })),
    { x: "d7", y: 100, num: 100, den: 1 },
    { x: "d8", y: 0, num: 0, den: 9 },
    { x: "d9", y: 0, num: 0, den: 9 },
  ];
  expect(delta(pts, "avg")).toBe(-47);
});

test("today's half day is left out of the change", () => {
  const pts = [10, 10, 10, 10, 10, 10].map((y, i) => ({ x: `d${i}`, y }));
  pts.push({ x: "today", y: 1, partial: true } as never);
  expect(delta(pts, "sum")).toBe(0);
  expect(partialBucket("2026-10-11", false, today)).toBe(true);
  expect(partialBucket("2026-10-10", false, today)).toBe(false);
  expect(partialBucket("2026-10-06", true, today)).toBe(true);
  expect(partialBucket("2026-09-29", true, today)).toBe(false);
});

test("a quiet day between two days with data stays on the axis as a zero", () => {
  const rows = [
    { date: "2026-10-01", leads: 3 },
    { date: "2026-10-04", leads: 2 },
  ];
  const keys = bucketDays(rows, "2026-09-25", "2026-10-10").map(b => b.key);
  expect(keys).toEqual([
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
});
