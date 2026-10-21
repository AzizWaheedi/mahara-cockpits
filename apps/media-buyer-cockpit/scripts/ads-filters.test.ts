/**
 * The Ads management filters follow the picked time frame (Aziz, 2026-10-21:
 * "the filters for cost per booking ... with the different time frames ...
 * are not showing that correctly"). A filter on spend, leads or bookings reads
 * the numbers its row shows for the range; the Call and the day average stay
 * on 7 days. Every figure here is made up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADS_FILTERS,
  adsFilterPasses,
  boardNumbers,
  type RowNumbers,
} from "../src/lib/adsFilters";

const CPB = "Cost per booking over $60";

/** A campaign whose 7-day snapshot says one thing. */
const campaign = (over: Record<string, unknown> = {}) => ({
  campaignName: "EXAMPLE-ONE",
  verdict: "hold",
  spend7d: 280,
  leads7d: 20,
  cpl: 14,
  bookings7d: 7,
  bookingRate: 35,
  costPerBooking: 40,
  dayRate: 40,
  daysLive: 3,
  daysSinceTouch: 1,
  ...over,
});

/** A range read as api.stats.range returns it. */
const read = (spend: number, leads: number, bookings: number) => ({
  total: { spend, leads, bookings },
  bookingsTotal: bookings,
});

const ok = (n: ReturnType<typeof boardNumbers>): RowNumbers | undefined =>
  n.state === "ok" ? n : undefined;

describe("cost per booking over $60 follows the time frame", () => {
  test("on 7 days it reads the snapshot's cost per booking", () => {
    const c = campaign({ costPerBooking: 75 });
    expect(adsFilterPasses(CPB, c, ok(boardNumbers(c, false, undefined)))).toBe(
      true,
    );
    const fine = campaign({ costPerBooking: 40 });
    expect(
      adsFilterPasses(CPB, fine, ok(boardNumbers(fine, false, undefined))),
    ).toBe(false);
  });

  test("on another range it reads that range's cost per booking, not the 7-day one", () => {
    // 7 days: $40 a booking. Last 30 days: $900 for 9 bookings = $100.
    const c = campaign({ costPerBooking: 40 });
    const n = ok(boardNumbers(c, true, read(900, 60, 9)));
    expect(n?.costPerBooking).toBe(100);
    expect(adsFilterPasses(CPB, c, n)).toBe(true);
    // And the other way: $90 over 7 days, $30 over the month.
    const d = campaign({ costPerBooking: 90 });
    expect(
      adsFilterPasses(CPB, d, ok(boardNumbers(d, true, read(300, 30, 10)))),
    ).toBe(false);
  });

  test("today and yesterday too: no bookings in the range is not a cost per booking", () => {
    const c = campaign({ costPerBooking: 75 });
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(45, 2, 0)))),
    ).toBe(false);
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(130, 4, 2)))),
    ).toBe(true);
  });

  test("a row still being read, or not read, is not counted on the range's numbers", () => {
    const c = campaign({ costPerBooking: 75 });
    expect(boardNumbers(c, true, undefined).state).toBe("loading");
    expect(adsFilterPasses(CPB, c, ok(boardNumbers(c, true, undefined)))).toBe(
      false,
    );
    expect(
      adsFilterPasses(
        CPB,
        c,
        ok(boardNumbers(c, true, new Error("read failed"))),
      ),
    ).toBe(false);
  });
});

test("a cost per booking the cell shows as $60 is not over $60", () => {
  // $1,812 for 30 bookings is $60.40, shown "$60"; $1,815 is $60.50, shown "$61".
  const c = campaign();
  expect(
    adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(1812, 90, 30)))),
  ).toBe(false);
  expect(
    adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(1815, 90, 30)))),
  ).toBe(true);
});

describe("the other filters on spend, leads and bookings follow it as well", () => {
  test("No bookings reads the range's bookings and spend", () => {
    const c = campaign({ bookings7d: 3 });
    expect(
      adsFilterPasses(
        "No bookings",
        c,
        ok(boardNumbers(c, true, read(60, 5, 0))),
      ),
    ).toBe(true);
    const booked = campaign({ bookings7d: 0, spend7d: 100 });
    expect(
      adsFilterPasses(
        "No bookings",
        booked,
        ok(boardNumbers(booked, true, read(60, 5, 2))),
      ),
    ).toBe(false);
  });

  test("a done-with-you campaign has no bookings to judge on any range", () => {
    const dwy = campaign({ bookings7d: undefined, costPerBooking: undefined });
    const n = ok(boardNumbers(dwy, true, read(500, 10, 0)));
    expect(n?.bookings).toBeUndefined();
    expect(adsFilterPasses("No bookings", dwy, n)).toBe(false);
    expect(adsFilterPasses(CPB, dwy, n)).toBe(false);
  });

  test("Critical: the Call stays on 7 days; no leads reads the range", () => {
    const kill = campaign({ verdict: "kill" });
    expect(adsFilterPasses("Critical", kill, undefined)).toBe(true);
    const c = campaign({ leads7d: 4 });
    expect(
      adsFilterPasses("Critical", c, ok(boardNumbers(c, true, read(50, 0, 0)))),
    ).toBe(true);
    const quiet = campaign({ leads7d: 0, spend7d: 60 });
    expect(
      adsFilterPasses(
        "Critical",
        quiet,
        ok(boardNumbers(quiet, true, read(60, 3, 0))),
      ),
    ).toBe(false);
  });

  test("Below KPI judges the range's cost per lead and cost per booking", () => {
    // 7 days in KPI ($14 a lead, $40 a booking); the month is a kill: $25 a lead, $250 a booking.
    const c = campaign();
    expect(
      adsFilterPasses("Below KPI", c, ok(boardNumbers(c, false, undefined))),
    ).toBe(false);
    expect(
      adsFilterPasses(
        "Below KPI",
        c,
        ok(boardNumbers(c, true, read(1000, 40, 4))),
      ),
    ).toBe(true);
  });

  test("Under the floor stays on the 7-day day average its column shows", () => {
    const c = campaign({ dayRate: 20 });
    expect(
      adsFilterPasses(
        "Under the floor",
        c,
        ok(boardNumbers(c, true, read(3000, 90, 30))),
      ),
    ).toBe(true);
  });
});

test("every filter on the range's numbers says so, and the page applies the module's rule", () => {
  const ranged = ADS_FILTERS.filter(f => f.ranged).map(f => f.label);
  expect(ranged).toEqual(["Critical", "Below KPI", CPB, "No bookings"]);
  const page = readFileSync(
    join(import.meta.dir, "../src/pages/CockpitPage.tsx"),
    "utf8",
  );
  // The page has no filter list of its own any more.
  expect(page).not.toContain("const FILTERS");
  expect(page).toContain("adsFilterPasses(label, c, rowNumbers(c))");
});
