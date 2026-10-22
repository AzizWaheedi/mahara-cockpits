/**
 * One cost per booking in the CEO cockpit (R10, 2026-10-22): every tab
 * divides spend on the days the Client Performance board stores bookings by
 * the confirmed bookings made on them, through src/pages/ceo/deliveryCost.ts,
 * and a payload computed before the board's counts reads n/a, never the old
 * figure under the new label.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BEFORE_CONFIRMED,
  CPB_CONFIRMED_LABEL,
  cpbConfirmedOf,
  cpbConfirmedOfDays,
  daysHaveConfirmed,
  FALLBACK_CONFIRMED,
  NOT_STORED,
  windowHasConfirmed,
} from "../src/pages/ceo/deliveryCost";
import {
  cplOnlyOf,
  cplOnlyRule,
  DWY_BOOKINGS,
  statusRule,
} from "../src/pages/ceo/deliveryStatus";
import type { DeliveryDay, DeliveryWindow } from "../src/types/ceo/payloads";
import { METRICS, scoreboard } from "../src/types/ceo/scoreboard";

const APP = join(import.meta.dir, "..");

/** The 14 to 20 Oct 2026 series as the refresh computes it from production (R2 check, read on 22 Oct): spend per day to four places. */
const WEEK: DeliveryDay[] = [
  {
    date: "2026-10-14",
    spend: 614.8272,
    leads: 37,
    bookings: 7,
    confirmed: 6,
    provisional: 1,
    spendMeasured: 572.5717,
  },
  {
    date: "2026-10-15",
    spend: 622.8656,
    leads: 36,
    bookings: 8,
    confirmed: 8,
    provisional: 0,
    spendMeasured: 580.6292,
  },
  {
    date: "2026-10-16",
    spend: 489.2332,
    leads: 43,
    bookings: 0,
    confirmed: 0,
    provisional: 0,
    spendMeasured: 445.132,
  },
  {
    date: "2026-10-17",
    spend: 425.986,
    leads: 27,
    bookings: 5,
    confirmed: 4,
    provisional: 1,
    spendMeasured: 399.2512,
  },
  {
    date: "2026-10-18",
    spend: 350.6726,
    leads: 36,
    bookings: 4,
    confirmed: 4,
    provisional: 0,
    spendMeasured: 348.4426,
  },
  {
    date: "2026-10-19",
    spend: 356.7034,
    leads: 33,
    bookings: 8,
    confirmed: 8,
    provisional: 0,
    spendMeasured: 322.7741,
  },
  {
    date: "2026-10-20",
    spend: 446.7025,
    leads: 46,
    bookings: 20,
    confirmed: 19,
    provisional: 1,
    spendMeasured: 423.3426,
  },
];
const LAST7: DeliveryWindow = {
  spend: 3306.99,
  leads: 258,
  cpl: 12.82,
  bookings: 52,
  cpb: 59.46,
  confirmed: 49,
  provisional: 3,
  spendMeasured: 3092.14,
  cpbConfirmed: 63.1,
  notMeasured: [
    {
      client: "Pidco Group",
      spend: 200.23,
      why: "The card is cancelled: the board stores no booking days for it in these days.",
    },
    {
      client: "Triple Edge Building Construction",
      spend: 14.62,
      why: "This ad account is tied to no client card or board row, so its bookings are not read.",
    },
  ],
};

describe("a window's cost per confirmed booking", () => {
  test("reads the refresh's confirmed figure and what it divides", () => {
    expect(cpbConfirmedOf(LAST7)).toEqual({
      value: 63.1,
      confirmed: 49,
      spend: 3092.14,
      why: null,
    });
    expect(windowHasConfirmed(LAST7)).toBe(true);
  });

  test("a payload from before the board's counts is n/a with the reason, never its old figure", () => {
    const old: DeliveryWindow = {
      spend: 3285.5,
      leads: 250,
      cpl: 13.14,
      bookings: 49,
      cpb: 67.05,
      confirmed: 47,
      provisional: 2,
      cpbConfirmed: 69.9,
    };
    expect(windowHasConfirmed(old)).toBe(false);
    expect(cpbConfirmedOf(old)).toEqual({
      value: null,
      confirmed: null,
      spend: null,
      why: BEFORE_CONFIRMED,
    });
    expect(BEFORE_CONFIRMED).toContain("predates the confirmed count");
  });

  test("a refresh that fell back to the media sync says so instead", () => {
    const old: DeliveryWindow = {
      spend: 400,
      leads: 40,
      cpl: 10,
      bookings: 4,
      cpb: 100,
    };
    expect(cpbConfirmedOf(old, "media sync").why).toBe(FALLBACK_CONFIRMED);
    expect(cpbConfirmedOf(old, "board").why).toBe(BEFORE_CONFIRMED);
    expect(
      cpbConfirmedOfDays(
        [{ date: "2026-10-20", spend: 1, leads: 1, bookings: 1 }],
        "2026-10-20",
        "2026-10-20",
        "media sync",
      ).why,
    ).toBe(FALLBACK_CONFIRMED);
  });

  test("a window the board stores no day of is not measured: n/a with that reason, never zero bookings", () => {
    const none: DeliveryWindow = {
      ...LAST7,
      confirmed: null,
      provisional: null,
      bookings: null,
      cpbConfirmed: null,
      cpb: null,
      spendMeasured: 0,
    };
    expect(windowHasConfirmed(none)).toBe(false);
    expect(cpbConfirmedOf(none, "board")).toEqual({
      value: null,
      confirmed: null,
      spend: null,
      why: NOT_STORED,
    });
    expect(NOT_STORED).toBe(
      "The Client Performance board stores no bookings for these days.",
    );
  });

  test("no confirmed booking is n/a with its own reason, never a zero or a divide by zero", () => {
    const none = { ...LAST7, confirmed: 0, cpbConfirmed: null };
    expect(cpbConfirmedOf(none)).toMatchObject({
      value: null,
      confirmed: 0,
      why: "No confirmed booking was made in these days.",
    });
    expect(cpbConfirmedOf(null).why).toBe(
      "Delivery numbers are not computed yet.",
    );
  });
});

describe("any run of days from the daily series", () => {
  test("the 7 days add up to the refresh's own window, to the cent: $3,092.14 over 49 = $63.10", () => {
    const c = cpbConfirmedOfDays(WEEK, "2026-10-14", "2026-10-20");
    expect(c).toEqual({
      value: 63.1,
      confirmed: 49,
      spend: 3092.14,
      why: null,
      daysNotMeasured: 0,
    });
    expect(c.value).toBe(cpbConfirmedOf(LAST7).value);
    expect(c.spend).toBe(cpbConfirmedOf(LAST7).spend);
  });

  test("yesterday alone: 19 bookings made on $423.34", () => {
    expect(cpbConfirmedOfDays(WEEK, "2026-10-20", "2026-10-20")).toMatchObject({
      value: 22.28,
      confirmed: 19,
      spend: 423.34,
    });
  });

  test("a day the board stores nothing for is left out and counted, never read as zero", () => {
    const rows: DeliveryDay[] = [
      ...WEEK.slice(0, 2),
      {
        date: "2026-10-16",
        spend: 100,
        leads: 3,
        bookings: 0,
        confirmed: null,
        provisional: null,
        spendMeasured: null,
      },
    ];
    expect(cpbConfirmedOfDays(rows, "2026-10-14", "2026-10-16")).toEqual({
      value: Math.round(((572.5717 + 580.6292) / 14) * 100) / 100,
      confirmed: 14,
      spend: 1153.2,
      why: null,
      daysNotMeasured: 1,
    });
    expect(
      cpbConfirmedOfDays(rows.slice(2), "2026-10-16", "2026-10-16"),
    ).toMatchObject({ value: null, confirmed: null, daysNotMeasured: 1 });
  });

  test("rows from before the board's counts are n/a for the whole window", () => {
    const old = WEEK.map(
      ({ confirmed: _c, provisional: _p, spendMeasured: _s, ...r }) => r,
    );
    expect(daysHaveConfirmed(old)).toBe(false);
    expect(cpbConfirmedOfDays(old, "2026-10-14", "2026-10-20")).toMatchObject({
      value: null,
      confirmed: null,
      why: BEFORE_CONFIRMED,
    });
    expect(cpbConfirmedOfDays([], "2026-10-14", "2026-10-20").value).toBeNull();
  });
});

describe("Goals reads the same numbers", () => {
  test("client bookings are confirmed and client cost per booking is per confirmed booking", () => {
    const delivery = { daily: WEEK } as never;
    const s = scoreboard({ delivery }, "2026-10-14", "2026-10-20");
    expect(s.clientBookings).toBe(49);
    expect(s.clientCpb).toBe(63.1);
    expect(s.clientSpend).toBe(3306.99);
    const label = (key: string) => METRICS.find(m => m.key === key)?.label;
    expect(label("clientCpb")).toBe("Client cost per confirmed booking");
    expect(label("clientBookings")).toBe("Client confirmed bookings");
  });

  test("an older payload leaves both unscored, never the old total", () => {
    const old = WEEK.map(
      ({ confirmed: _c, provisional: _p, spendMeasured: _s, ...r }) => r,
    );
    const s = scoreboard(
      { delivery: { daily: old } as never },
      "2026-10-14",
      "2026-10-20",
    );
    expect(s.clientBookings).toBeUndefined();
    expect(s.clientCpb).toBeUndefined();
    expect(s.clientSpend).toBe(3306.99);
  });
});

describe("every CEO tab uses the one helper and the one label", () => {
  const read = (path: string) => readFileSync(join(APP, path), "utf8");
  test("Today, Backend, Delivery and the timeframe card read deliveryCost, never a window's total cpb", () => {
    for (const path of [
      "src/pages/ceo/TodayTab.tsx",
      "src/pages/ceo/BackendTab.tsx",
      "src/pages/ceo/DeliveryTab.tsx",
      "src/pages/ceo/timeframeCards.tsx",
    ]) {
      const text = read(path);
      expect(text).toContain("./deliveryCost");
      expect(text).toContain("CPB_CONFIRMED_LABEL");
      // A window's `cpb` divides by provisional bookings too: no tab shows it as the cost per booking.
      expect(text).not.toMatch(
        /\b(?:d|w|p|m|y)\.(?:last7|mtd|yesterday|prevLast7)\.cpb\b/,
      );
      expect(text).not.toMatch(/label="Cost per booking"/);
    }
    expect(CPB_CONFIRMED_LABEL).toBe("Cost per confirmed booking");
  });
});

describe("the status hints say the rule that judged the row", () => {
  type Row = Parameters<typeof cplOnlyOf>[0];
  const row = (x: Partial<Row>): Row =>
    ({
      client: "x",
      clickupTaskId: null,
      spend7d: 100,
      leads7d: 10,
      cpl7d: 10,
      bookings7d: 0,
      cpb7d: null,
      campaigns: 1,
      status: "good",
      rates30: null,
      ...x,
    }) as Row;

  test("the watch line names every way a client reads watch", () => {
    const watch = statusRule("watch");
    // Cost per confirmed booking within $60 with a high cost per lead or a low show rate.
    expect(watch).toContain("within $60 with a cost per lead over $15");
    // $60 to $80.
    expect(watch).toContain(
      "from $60 to $80 with a cost per lead within $22.50",
    );
    // No booking yet on $60 to $80 of spend (and up to $60, too early).
    expect(watch).toContain("no confirmed booking yet on spend up to $80");
    expect(watch).toContain("too early to judge");
    // Bookings not measured.
    expect(watch).toContain(
      "bookings not measured with a cost per lead within $22.50",
    );
    // Done With You.
    expect(watch).toContain(
      "Done With You client with a cost per lead over $15",
    );
    const bad = statusRule("bad");
    expect(bad).toContain("no confirmed booking after more than $80 of spend");
    expect(bad).toContain("for a Done With You client");
    expect(statusRule("good")).toContain("A Done With You client is on track");
  });

  test("a row judged on cost per lead alone says so and never quotes the booking gates", () => {
    expect(cplOnlyOf(row({ cplOnly: "dwy" }))).toBe("dwy");
    expect(cplOnlyOf(row({ cplOnly: null, confirmed7d: 3 }))).toBeNull();
    // A payload stored before cplOnly: not measured is read from the count.
    expect(cplOnlyOf(row({ confirmed7d: null }))).toBe("not measured");
    for (const why of ["dwy", "no service mode", "not measured"] as const)
      for (const status of ["good", "watch", "bad"] as const) {
        const text = cplOnlyRule(status, why);
        expect(text.toLowerCase()).toContain("judged on cost per lead alone");
        expect(text).not.toContain("$60");
        expect(text).not.toContain("show rate");
      }
    expect(cplOnlyRule("good", "dwy")).toContain(DWY_BOOKINGS);
    expect(cplOnlyRule("watch", "not measured")).toContain(
      "never on track while its bookings are not measured",
    );
    expect(cplOnlyRule("good", "no service mode")).toContain(
      "No client card or Service Mode",
    );
  });

  test("the hints come from the shared rule, never a narrower copy", () => {
    const read = (path: string) => readFileSync(join(APP, path), "utf8");
    for (const path of [
      "src/pages/ceo/DeliveryTab.tsx",
      "src/pages/ceo/BackendTab.tsx",
    ])
      expect(read(path)).toContain("./deliveryStatus");
    // Backend's month runs to today so far and says so.
    expect(read("src/pages/ceo/BackendTab.tsx")).toContain(
      'kicker="Month to date, today so far"',
    );
    expect(read("src/pages/ceo/DeliveryTab.tsx")).toContain(
      "This month, today so far",
    );
  });
});
