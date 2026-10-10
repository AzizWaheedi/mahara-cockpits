import { describe, expect, test } from "bun:test";
import {
  isDue,
  isShown,
  leftOut,
  parseStats,
  type StatCall,
  totalsFor,
} from "../src/lib/funnelStats";

// Saturday 10 October 2026, 15:00 in Kuwait.
const NOW = Date.parse("2026-10-10T12:00:00Z");

const call = (over: Partial<StatCall>): StatCall => ({
  adId: "120252569770710042",
  status: "confirmed",
  startTime: null,
  appointmentDate: "2026-10-05",
  ...over,
});

describe("a booked call", () => {
  test("is due once its time has passed, by the hour when there is one", () => {
    expect(isDue(call({ startTime: "2026-10-10T14:00:00+03:00" }), NOW)).toBe(
      true,
    );
    expect(isDue(call({ startTime: "2026-10-10T16:00:00+03:00" }), NOW)).toBe(
      false,
    );
  });

  test("with only a day, is due once that day is over in Kuwait", () => {
    expect(isDue(call({ appointmentDate: "2026-10-09" }), NOW)).toBe(true);
    expect(isDue(call({ appointmentDate: "2026-10-10" }), NOW)).toBe(false);
  });

  test("marked showed or no-show is due whatever its date", () => {
    expect(
      isDue(call({ status: "showed", appointmentDate: "2026-10-12" }), NOW),
    ).toBe(true);
    expect(
      isDue(call({ status: "noshow", appointmentDate: "2026-10-12" }), NOW),
    ).toBe(true);
  });

  test("counts as shown when showed, or confirmed or invalid once past (Aziz's rule)", () => {
    expect(isShown(call({ status: "showed" }), NOW)).toBe(true);
    expect(isShown(call({ status: "confirmed" }), NOW)).toBe(true);
    expect(isShown(call({ status: "invalid" }), NOW)).toBe(true);
    expect(
      isShown(
        call({ status: "confirmed", appointmentDate: "2026-10-11" }),
        NOW,
      ),
    ).toBe(false);
    expect(isShown(call({ status: "noshow" }), NOW)).toBe(false);
    expect(isShown(call({ status: "cancelled" }), NOW)).toBe(false);
    expect(isDue(call({ status: "cancelled" }), NOW)).toBe(true);
  });
});

describe("a destination's numbers", () => {
  const stats = parseStats({
    rows: [
      {
        metaAdId: "120252569770710042",
        spend: 7.75,
        impressions: 315,
        linkClicks: 6,
        leads: 0,
      },
      {
        metaAdId: "120252655303730042",
        spend: 24.67,
        impressions: 900,
        linkClicks: 20,
        leads: 3,
      },
      {
        metaAdId: "120252000000000042",
        spend: 40,
        impressions: 1000,
        linkClicks: 10,
        leads: 2,
      },
    ],
    // Arcturus, 4-10 October: every call still marked confirmed, all past.
    bookings: [
      {
        adId: "120252569770710042",
        status: "Confirmed",
        appointmentDate: "2026-10-05",
      },
      {
        adId: "120252569770710042",
        status: "confirmed",
        appointmentDate: "2026-10-07",
      },
      {
        adId: "120252655303730042",
        status: "confirmed",
        appointmentDate: "2026-10-11",
        startTime: "2026-10-11T16:00:00+03:00",
      },
      { adId: null, status: "confirmed", appointmentDate: "2026-10-06" },
    ],
    historical: [],
  });
  const ads = [{ id: "120252569770710042" }, { id: "120252655303730042" }];

  test("adds up only its own ads, by Meta ad id", () => {
    const t = totalsFor(stats, ads, NOW);
    expect(t?.spend).toBeCloseTo(32.42, 2);
    expect(t?.leads).toBe(3);
    expect(t?.linkClicks).toBe(26);
    expect(t?.booked).toBe(3);
  });

  test("counts past confirmed calls as shown and leaves the coming one out of the rate", () => {
    const t = totalsFor(stats, ads, NOW);
    expect(t?.due).toBe(2);
    expect(t?.shown).toBe(2);
  });

  test("is empty, not zero, when none of its ads has a number or a call", () => {
    expect(totalsFor(stats, [{ id: "999" }], NOW)).toBeNull();
    expect(totalsFor(undefined, ads, NOW)).toBeNull();
  });

  test("says what it leaves out: old ads' spend and calls tied to no ad", () => {
    expect(leftOut(stats, ads)).toEqual({ spend: 40, leads: 2, calls: 1 });
  });
});

describe("reading the statistics function", () => {
  test("refuses a shape it does not know", () => {
    expect(() => parseStats(null)).toThrow();
    expect(() => parseStats({ rows: [] })).toThrow();
  });

  test("keeps the call's day and lower-cases its status", () => {
    const s = parseStats({
      rows: [],
      bookings: [
        { adId: "1", status: "NoShow", appointmentDate: "2026-10-05T00:00:00" },
      ],
    });
    expect(s.calls[0]).toEqual({
      adId: "1",
      status: "noshow",
      startTime: null,
      appointmentDate: "2026-10-05",
    });
  });
});
