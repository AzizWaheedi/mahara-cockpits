/**
 * A range read counts bookings only through the last day the media data has
 * spend for (2026-10-21). Meta's numbers run to yesterday while a booking
 * lands the moment it is made, so Month to date on 21 Oct set City Wood's 7
 * bookings to 21 Oct against spend to 20 Oct: $674.63 / 7 = $96.38, where
 * the 3 bookings to 20 Oct give $224.88. The day is one for the whole read,
 * never a campaign's own last day. Spend windows stay as picked.
 */
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStats, totalsFor } from "../src/lib/funnelStats";
import {
  bookingsCap,
  computeMediaRange,
  everyBookingPlaced,
  mediaDataThrough,
  readMediaStats,
} from "../src/lib/mediaStatsClient";

const campaignName = "CITY-WOOD-EXAMPLE";
const day = (date: string, spend: number, leads = 1) => ({
  campaignName,
  date,
  adSetName: "Leads",
  adName: "Ad 1",
  metaAdId: "ad-1",
  spend,
  leads,
  impressions: 2000,
  linkClicks: 60,
});
const booking = (date: string, adId: string | null = "ad-1") => ({
  campaignName,
  date,
  status: "confirmed",
  adId,
  startTime: null,
  appointmentDate: null,
});

// Month to date on 21 Oct: spend to 20 Oct, 3 bookings to 20 Oct, 4 made on 21 Oct.
const mtd = {
  rows: [
    day("2026-10-01", 300),
    day("2026-10-12", 200),
    day("2026-10-20", 174.63),
  ],
  historical: [],
  bookings: [
    booking("2026-10-05"),
    booking("2026-10-14"),
    booking("2026-10-20"),
    booking("2026-10-21"),
    booking("2026-10-21"),
    booking("2026-10-21"),
    booking("2026-10-21", null),
  ],
};

/** A client whose rpc answers each kind, counting the calls. */
function fakeClient(answers: {
  coverage: () => { data: unknown; error: unknown };
  range?: () => { data: unknown; error: unknown };
}) {
  const calls: string[] = [];
  const client = {
    rpc: async (_name: string, args: { p_kind: string }) => {
      calls.push(args.p_kind);
      return args.p_kind === "coverage"
        ? answers.coverage()
        : (answers.range?.() ?? { data: mtd, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("the range's bookings stop where its spend stops", () => {
  test("City Wood, month to date on 21 Oct: $224.88, not $96.38", async () => {
    const uncapped = await computeMediaRange(mtd, {
      campaignName,
      start: "2026-10-01",
      end: "2026-10-21",
    });
    expect(uncapped.bookingsTotal).toBe(7);
    expect(uncapped.total.costPerBooking).toBeCloseTo(96.38, 2);

    const capped = await computeMediaRange(mtd, {
      campaignName,
      start: "2026-10-01",
      end: "2026-10-21",
      bookingsThrough: "2026-10-20",
    });
    expect(capped.total.spend).toBeCloseTo(674.63, 2);
    expect(capped.bookingsTotal).toBe(3);
    expect(capped.total.bookings).toBe(3);
    expect(capped.total.costPerBooking).toBeCloseTo(224.88, 2);
    // Every booking left is traced, so the ad's own count agrees.
    expect(capped.bookingsAttributed).toBe(3);
    expect(capped.ads[0].bookings).toBe(3);
    expect(capped.bookingsThrough).toBe("2026-10-20");
  });

  test("one day for the whole read: a campaign that stopped spending keeps its later bookings", async () => {
    // Atlantis 7\10 last spent on 17 Oct and bought bookings on 18-20 Oct.
    const stopped = {
      rows: [day("2026-10-14", 60), day("2026-10-17", 40)],
      historical: [],
      bookings: [
        booking("2026-10-15"),
        booking("2026-10-18"),
        booking("2026-10-20"),
        booking("2026-10-21"),
      ],
    };
    const r = await computeMediaRange(stopped, {
      campaignName,
      start: "2026-10-14",
      end: "2026-10-21",
      bookingsThrough: "2026-10-20",
    });
    expect(r.bookingsTotal).toBe(3);
    expect(r.total.costPerBooking).toBeCloseTo(100 / 3, 5);
  });

  test("a range that ends on or before the day is not touched", async () => {
    const r = await computeMediaRange(mtd, {
      campaignName,
      start: "2026-10-14",
      end: "2026-10-20",
      bookingsThrough: "2026-10-20",
    });
    expect(r.bookingsTotal).toBe(2);
    expect(r.bookingsThrough).toBeUndefined();
    expect(r.spendNotIn).toBeUndefined();
  });

  test("a range wholly after the day keeps its real bookings and says the spend is not in", async () => {
    // Today on 21 Oct, Meta's numbers to 20 Oct: 4 bookings made today. They
    // are real, so never 0 and never "None yet"; their cost waits.
    const today = await computeMediaRange(mtd, {
      campaignName,
      start: "2026-10-21",
      end: "2026-10-21",
      bookingsThrough: "2026-10-20",
    });
    expect(today.hasData).toBe(false);
    expect(today.bookingsTotal).toBe(4);
    expect(today.total.bookings).toBe(4);
    expect(today.total.spend).toBe(0);
    expect(today.total.costPerBooking).toBeUndefined();
    expect(today.bookingsThrough).toBeUndefined();
    expect(today.spendNotIn).toBe("2026-10-20");
  });

  test("bookingsCap: untouched, capped inside the range, or kept with the spend not in", () => {
    const range = { start: "2026-10-01", end: "2026-10-21" };
    expect(bookingsCap(range, null)).toEqual({});
    expect(bookingsCap(range, "2026-10-21")).toEqual({});
    expect(bookingsCap(range, "2026-10-22")).toEqual({});
    expect(bookingsCap(range, "2026-10-20")).toEqual({ through: "2026-10-20" });
    // The range's first day is the media data's last: still capped there.
    expect(bookingsCap(range, "2026-10-01")).toEqual({ through: "2026-10-01" });
    const today = { start: "2026-10-22", end: "2026-10-22" };
    expect(bookingsCap(today, "2026-10-21")).toEqual({
      spendNotIn: "2026-10-21",
    });
  });
});

describe("the day comes from one coverage read, shared", () => {
  test("several range reads share one coverage read and each is capped", async () => {
    const { client, calls } = fakeClient({
      coverage: () => ({
        data: { first: "2026-08-13", last: "2026-10-20", rows: null },
        error: null,
      }),
    });
    const args = { campaignName, start: "2026-10-01", end: "2026-10-21" };
    const reads = await Promise.all([
      readMediaStats(client, "range", args),
      readMediaStats(client, "range", args),
      readMediaStats(client, "range", args),
    ]);
    for (const r of reads) {
      expect(r.bookingsTotal).toBe(3);
      expect(r.total.costPerBooking).toBeCloseTo(224.88, 2);
    }
    expect(calls.filter(k => k === "coverage")).toHaveLength(1);
    expect(calls.filter(k => k === "range")).toHaveLength(3);
    // The page's note reads the same answer.
    expect((await readMediaStats(client, "coverage")).last).toBe("2026-10-20");
    expect(await mediaDataThrough(client)).toBe("2026-10-20");
    expect(calls.filter(k => k === "coverage")).toHaveLength(1);
  });

  test("a failed coverage read fails the range read, and is not kept", async () => {
    let fail = true;
    const { client, calls } = fakeClient({
      coverage: () =>
        fail
          ? { data: null, error: new Error("coverage read failed") }
          : { data: { first: null, last: "2026-10-20" }, error: null },
    });
    const args = { campaignName, start: "2026-10-01", end: "2026-10-21" };
    await expect(readMediaStats(client, "range", args)).rejects.toThrow(
      "coverage read failed",
    );
    fail = false;
    const r = await readMediaStats(client, "range", args);
    expect(r.bookingsTotal).toBe(3);
    expect(calls.filter(k => k === "coverage")).toHaveLength(2);
  });

  test("no media data at all leaves the bookings as read", async () => {
    const { client } = fakeClient({
      coverage: () => ({
        data: { first: null, last: null, rows: null },
        error: null,
      }),
    });
    expect(await mediaDataThrough(client)).toBeNull();
    const r = await readMediaStats(client, "range", {
      campaignName,
      start: "2026-10-01",
      end: "2026-10-21",
    });
    expect(r.bookingsTotal).toBe(7);
  });

  test("Today through the shared read: the bookings stay, with the day the spend stops", async () => {
    const { client } = fakeClient({
      coverage: () => ({
        data: { first: "2026-08-13", last: "2026-10-20" },
        error: null,
      }),
    });
    const r = await readMediaStats(client, "range", {
      campaignName,
      start: "2026-10-21",
      end: "2026-10-21",
    });
    expect(r.bookingsTotal).toBe(4);
    expect(r.spendNotIn).toBe("2026-10-20");
    expect(r.total.costPerBooking).toBeUndefined();
  });
});

describe("an ad with no booking is judged only when every booking was placed", () => {
  test("a booking whose ad id maps to no row leaves the others unjudged", async () => {
    // ad-old spent more than 30 days before the range, so the range has no
    // row for it: its booking carries an ad id but sits on no listed ad.
    const r = await computeMediaRange(
      {
        rows: [day("2026-10-14", 120)],
        historical: [],
        bookings: [booking("2026-10-15", "ad-old")],
      },
      { campaignName, start: "2026-10-14", end: "2026-10-20" },
    );
    expect(r.bookingsAttributed).toBe(r.bookingsTotal);
    expect(r.ads[0].bookings).toBe(0);
    expect(everyBookingPlaced(r)).toBe(false);
    const placed = await computeMediaRange(
      {
        rows: [day("2026-10-14", 120)],
        historical: [],
        bookings: [booking("2026-10-15")],
      },
      { campaignName, start: "2026-10-14", end: "2026-10-20" },
    );
    expect(everyBookingPlaced(placed)).toBe(true);
    expect(everyBookingPlaced(undefined)).toBe(false);
    expect(everyBookingPlaced({ bookingsTotal: 0, ads: [] })).toBe(false);
  });
});

test("the funnel's booked calls stop on the same day, and say so", () => {
  const stats = parseStats(mtd, "2026-10-20");
  expect(stats.calls).toHaveLength(3);
  expect(stats.callsThrough).toBe("2026-10-20");
  expect(stats.spendNotIn).toBeUndefined();
  expect(totalsFor(stats, [{ id: "ad-1" }])?.booked).toBe(3);
  expect(parseStats(mtd).calls).toHaveLength(7);
  expect(parseStats(mtd).callsThrough).toBeUndefined();
  expect(parseStats(mtd, null).calls).toHaveLength(7);
});

test("the funnel on Today keeps its calls and names the day the spend stops", () => {
  // useFunnelStats passes bookingsCap's answer straight through.
  const cap = bookingsCap(
    { start: "2026-10-21", end: "2026-10-21" },
    "2026-10-20",
  );
  const stats = parseStats(mtd, cap.through, cap.spendNotIn);
  expect(stats.calls).toHaveLength(7);
  expect(stats.callsThrough).toBeUndefined();
  expect(stats.spendNotIn).toBe("2026-10-20");
});
