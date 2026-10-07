import { describe, expect, test } from "bun:test";
import { profileForPeriod, requestedPeriod } from "../convex/reportDocs";

/**
 * The Google Doc report follows the reporting period picked on the Client
 * performance page (Aziz, 2026-10-06), from the same rows and rules as the
 * page (src/lib/reportPeriod.ts).
 */

const profile = {
  clientName: "Ola",
  taskId: "86eywcnhy",
  adLeads: {
    daily: [
      { date: "2026-09-02", leads: 4, spend: 40 },
      { date: "2026-08-15", leads: 2, spend: 30 },
    ],
  },
  performance: {
    month: { leads: 99, booked: 99 },
    lastMonth: { leads: 98 },
    monthLabel: "October 2026",
    lastMonthLabel: "September 2026",
    byAd: [{ ad: "stale two-month table" }],
    appointments: [
      { added: "2026-09-02", booked: true, show: "y", closed: "y", ad: "Ad 1" },
      { added: "2026-09-03", booked: true, show: "n", ad: "Ad 2" },
      { added: "2026-08-15", booked: true, show: "y", ad: "Ad 1" },
    ],
    recent: [
      { added: "2026-09-02", name: "A" },
      { added: "2026-10-02", name: "B" },
    ],
  },
};

describe("the report's period", () => {
  test("a request made before periods keeps the old month report", () => {
    expect(requestedPeriod({ month: "2026-10" })).toBeUndefined();
    expect(
      requestedPeriod({ month: "x", from: "2026-10-09", to: "2026-10-01" }),
    ).toBeUndefined();
  });

  test("a calendar month is compared with the month before it", () => {
    const per = requestedPeriod({
      month: "September 2026",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(per).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      month: "2026-09",
      prevLabel: "August 2026",
    });
  });

  test("a span keeps the page's name and is compared with the span before", () => {
    const per = requestedPeriod({
      month: "Last 7 days",
      from: "2026-09-30",
      to: "2026-10-06",
    });
    expect(per).toMatchObject({
      label: "Last 7 days",
      prevFrom: "2026-09-23",
      prevTo: "2026-09-29",
    });
    expect(
      requestedPeriod({
        month: "All time",
        from: "2026-01-01",
        to: "2026-10-06",
      })?.prevFrom,
    ).toBeUndefined();
  });

  test("the profile is reshaped so the report reads the period", () => {
    const per = requestedPeriod({
      month: "September 2026",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    if (!per) throw new Error("no period");
    const en = profileForPeriod(profile, per, "en").performance;
    expect(en.period).toBe(true);
    expect(en.monthLabel).toBe("September 2026");
    expect(en.lastMonthLabel).toBe("August 2026");
    expect(en.month).toMatchObject({
      leads: 4,
      booked: 2,
      shows: 1,
      closes: 1,
    });
    expect(en.lastMonth).toMatchObject({ leads: 2, booked: 1, shows: 1 });
    expect(en.byAd.map((a: { ad: string }) => a.ad)).toEqual(["Ad 1", "Ad 2"]);
    expect(en.recent.map((r: { name: string }) => r.name)).toEqual(["A"]);
    // An Arabic report names the month in Arabic.
    const ar = profileForPeriod(profile, per, "ar").performance;
    expect(ar.monthLabel).toBe("سبتمبر 2026");
  });
});
