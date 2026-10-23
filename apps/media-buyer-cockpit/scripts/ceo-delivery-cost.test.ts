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
import { renderToStaticMarkup } from "react-dom/server";
import { notMeasuredLine } from "../src/pages/ceo/DeliveryTab";
import { DoneWithYouCell, dwyCell } from "../src/pages/ceo/DoneWithYouCell";
import {
  BEFORE_CONFIRMED,
  CPB_CONFIRMED_LABEL,
  cpbConfirmedOf,
  cpbConfirmedOfDays,
  DWY_BOOKINGS_LEFT_OUT,
  daysHaveConfirmed,
  doneWithYouBookingsLine,
  doneWithYouLine,
  doneWithYouOf,
  doneWithYouOfDays,
  FALLBACK_CONFIRMED,
  NOT_STORED,
  windowHasConfirmed,
} from "../src/pages/ceo/deliveryCost";
import {
  cplOnlyOf,
  cplOnlyRule,
  DWY_BOOKINGS,
  DWY_RULE,
  noLeadClauses,
  statusRule,
  tooFewNote,
} from "../src/pages/ceo/deliveryStatus";
import type { DeliveryDay, DeliveryWindow } from "../src/types/ceo/payloads";
import { METRICS, scoreboard } from "../src/types/ceo/scoreboard";

const APP = join(import.meta.dir, "..");

/**
 * The 14 to 20 Oct 2026 series as the refresh computes it from production (R2
 * check, read on 22 Oct): spend per day to four places. Since the CEO's
 * decision 2 of 23 Oct 2026 the measured spend leaves out نهوض نجد, the one
 * Done With You client ($192.33 these days, read live on 23 Oct), which is
 * carried apart: $3,092.14 over 49 becomes $2,899.81 over 49 = $59.18.
 */
const WEEK: DeliveryDay[] = [
  {
    date: "2026-10-14",
    spend: 614.8272,
    leads: 37,
    bookings: 7,
    confirmed: 6,
    provisional: 1,
    spendMeasured: 547.6017,
    spendDoneWithYou: 24.97,
  },
  {
    date: "2026-10-15",
    spend: 622.8656,
    leads: 36,
    bookings: 8,
    confirmed: 8,
    provisional: 0,
    spendMeasured: 558.6392,
    spendDoneWithYou: 21.99,
  },
  {
    date: "2026-10-16",
    spend: 489.2332,
    leads: 43,
    bookings: 0,
    confirmed: 0,
    provisional: 0,
    spendMeasured: 418.452,
    spendDoneWithYou: 26.68,
  },
  {
    date: "2026-10-17",
    spend: 425.986,
    leads: 27,
    bookings: 5,
    confirmed: 4,
    provisional: 1,
    spendMeasured: 374.1212,
    spendDoneWithYou: 25.13,
  },
  {
    date: "2026-10-18",
    spend: 350.6726,
    leads: 36,
    bookings: 4,
    confirmed: 4,
    provisional: 0,
    spendMeasured: 313.7626,
    spendDoneWithYou: 34.68,
  },
  {
    date: "2026-10-19",
    spend: 356.7034,
    leads: 33,
    bookings: 8,
    confirmed: 8,
    provisional: 0,
    spendMeasured: 296.7041,
    spendDoneWithYou: 26.07,
  },
  {
    date: "2026-10-20",
    spend: 446.7025,
    leads: 46,
    bookings: 20,
    confirmed: 19,
    provisional: 1,
    spendMeasured: 390.5326,
    spendDoneWithYou: 32.81,
  },
];
const LAST7: DeliveryWindow = {
  spend: 3306.99,
  leads: 258,
  cpl: 12.82,
  bookings: 52,
  cpb: 55.77,
  confirmed: 49,
  provisional: 3,
  spendMeasured: 2899.81,
  cpbConfirmed: 59.18,
  notMeasured: [
    {
      client: "Pidco Group",
      spend: 200.23,
      why: "The card is cancelled: the board stores no booking days for it in these days.",
    },
    {
      client: "Triple Edge Building Construction",
      spend: 14.62,
      why: "This is a churned client's ad account, so its bookings are not read.",
    },
  ],
  doneWithYou: [{ client: "نهوض نجد", spend: 192.33 }],
};

describe("a window's cost per confirmed booking", () => {
  test("reads the refresh's confirmed figure and what it divides", () => {
    expect(cpbConfirmedOf(LAST7)).toEqual({
      value: 59.18,
      confirmed: 49,
      spend: 2899.81,
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
  test("the 7 days add up to the refresh's own window, to the cent: $2,899.81 over 49 = $59.18", () => {
    const c = cpbConfirmedOfDays(WEEK, "2026-10-14", "2026-10-20");
    expect(c).toEqual({
      value: 59.18,
      confirmed: 49,
      spend: 2899.81,
      why: null,
      daysNotMeasured: 0,
    });
    expect(c.value).toBe(cpbConfirmedOf(LAST7).value);
    expect(c.spend).toBe(cpbConfirmedOf(LAST7).spend);
  });

  test("yesterday alone: 19 bookings made on $390.53", () => {
    expect(cpbConfirmedOfDays(WEEK, "2026-10-20", "2026-10-20")).toMatchObject({
      value: 20.55,
      confirmed: 19,
      spend: 390.53,
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
      value: Math.round(((547.6017 + 558.6392) / 14) * 100) / 100,
      confirmed: 14,
      spend: 1106.24,
      why: null,
      daysNotMeasured: 1,
    });
    expect(
      cpbConfirmedOfDays(rows.slice(2), "2026-10-16", "2026-10-16"),
    ).toMatchObject({ value: null, confirmed: null, daysNotMeasured: 1 });
  });

  test("rows from before the board's counts are n/a for the whole window", () => {
    const old = WEEK.map(
      ({
        confirmed: _c,
        provisional: _p,
        spendMeasured: _s,
        spendDoneWithYou: _d,
        ...r
      }) => r,
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
    expect(s.clientCpb).toBe(59.18);
    expect(s.clientSpend).toBe(3306.99);
    const label = (key: string) => METRICS.find(m => m.key === key)?.label;
    expect(label("clientCpb")).toBe("Client cost per confirmed booking");
    expect(label("clientBookings")).toBe("Client confirmed bookings");
  });

  test("an older payload leaves both unscored, never the old total", () => {
    const old = WEEK.map(
      ({
        confirmed: _c,
        provisional: _p,
        spendMeasured: _s,
        spendDoneWithYou: _d,
        ...r
      }) => r,
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

// The CEO, 23 Oct 2026 (cost per booking decisions, 2): "No keep the CPL but
// ignore CPB". Every tab's cost per booking leaves done-with-you spend out
// and says how much.
describe("done-with-you spend is named wherever a cost per booking is", () => {
  test("a window and a run of days carry the same left-out spend", () => {
    expect(doneWithYouOf(LAST7)).toEqual({
      spend: 192.33,
      clients: [{ client: "نهوض نجد", spend: 192.33 }],
    });
    expect(doneWithYouOfDays(WEEK, "2026-10-14", "2026-10-20")).toEqual({
      spend: 192.33,
      clients: [],
    });
    // The series still adds to the headline spend: measured, not measured and done with you.
    const spend = WEEK.reduce((n, r) => n + r.spend, 0);
    expect(Math.round(spend * 100) / 100).toBe(LAST7.spend);
  });

  test("a payload from before the decision is not known, never zero, and the hint says nothing", () => {
    const { doneWithYou: _d, ...old } = LAST7;
    expect(doneWithYouOf(old)).toBeNull();
    const oldDays = WEEK.map(({ spendDoneWithYou: _s, ...r }) => r);
    expect(doneWithYouOfDays(oldDays, "2026-10-14", "2026-10-20")).toBeNull();
    expect(doneWithYouLine(null)).toBe("");
  });

  test("the sentence names the client and the amount", () => {
    expect(doneWithYouLine(doneWithYouOf(LAST7))).toBe(
      " $192.33 of نهوض نجد's spend is left out: done with you, the client books its own meetings.",
    );
    expect(
      doneWithYouLine(doneWithYouOfDays(WEEK, "2026-10-14", "2026-10-20")),
    ).toBe(
      " $192.33 of done-with-you clients' spend is left out: they book their own meetings.",
    );
    // No done-with-you spend in the days: nothing left out to name, and the
    // payload cannot tell whether such a client exists, so it says nothing.
    expect(doneWithYouLine({ spend: 0, clients: [] })).toBe("");
    expect(doneWithYouLine(doneWithYouOf({ ...LAST7, doneWithYou: [] }))).toBe(
      "",
    );
  });

  test("a company booking count says the rule, on any current payload", () => {
    expect(DWY_BOOKINGS_LEFT_OUT).toBe(
      " Done-with-you clients' bookings are not counted here: they book their own meetings.",
    );
    expect(doneWithYouBookingsLine(doneWithYouOf(LAST7))).toBe(
      DWY_BOOKINGS_LEFT_OUT,
    );
    // The rule holds whether or not one spent in these days.
    expect(
      doneWithYouBookingsLine(doneWithYouOf({ ...LAST7, doneWithYou: [] })),
    ).toBe(DWY_BOOKINGS_LEFT_OUT);
    // A payload from before the decision still counted them: nothing said.
    const { doneWithYou: _d, ...old } = LAST7;
    expect(doneWithYouBookingsLine(doneWithYouOf(old))).toBe("");
    const read = (path: string) => readFileSync(join(APP, path), "utf8");
    for (const path of [
      "src/pages/ceo/TodayTab.tsx",
      "src/pages/ceo/BackendTab.tsx",
      "src/pages/ceo/DeliveryTab.tsx",
      "src/pages/ceo/timeframeCards.tsx",
    ])
      expect(read(path)).toContain("doneWithYouBookingsLine(");
    // Plain copy: no pronoun with nothing before it, no nested brackets.
    expect(read("src/pages/ceo/BackendTab.tsx")).not.toContain(
      "Their bookings are not counted here",
    );
  });

  test("the over-all aside adds back only spend the board does not store, never done-with-you spend", () => {
    const line = notMeasuredLine(LAST7);
    // $2,899.81 + $200.23 + $14.62 = $3,114.66 over 49.
    expect(line).toContain(
      "It leaves out $215 of spend whose bookings the board does not store",
    );
    expect(line).toContain(
      "over all $3,115, done-with-you spend still left out, it would read $63.56.",
    );
    expect(line).not.toMatch(/\([^()]*\(/);
    // No done-with-you spend in the window: no aside about it.
    const none = notMeasuredLine({ ...LAST7, doneWithYou: [] });
    expect(none).toContain("over all $3,115 it would read $63.56.");
    expect(none).not.toContain("done-with-you");
    expect(line).toContain("$192.33 of نهوض نجد's spend is left out");
    // Nothing unmeasured: only the done-with-you sentence.
    expect(notMeasuredLine({ ...LAST7, notMeasured: [] })).toBe(
      doneWithYouLine(doneWithYouOf(LAST7)),
    );
  });

  test("a done-with-you row's booking cells read Done with you, never n/a", () => {
    const row = (cplOnly: "dwy" | null) =>
      ({
        client: "نهوض نجد",
        clickupTaskId: null,
        spend7d: 205.15,
        leads7d: 17,
        cpl7d: 12.07,
        bookings7d: null,
        cpb7d: null,
        campaigns: 1,
        status: "good",
        rates30: null,
        cplOnly,
      }) as unknown as Parameters<typeof dwyCell>[0];
    const cell = dwyCell(row("dwy"));
    expect(cell).not.toBeNull();
    const html = renderToStaticMarkup(
      cell as Parameters<typeof renderToStaticMarkup>[0],
    );
    expect(html).toContain(">Done with you</button>");
    expect(html).toContain(`aria-label="${DWY_BOOKINGS}"`);
    expect(html).not.toContain("n/a");
    expect(renderToStaticMarkup(DoneWithYouCell({}))).toBe(html);
    // Any other row keeps its own cell.
    expect(dwyCell(row(null))).toBeNull();
    // Delivery's Bookings, Cost per confirmed booking and Lead to booking
    // cells, and Today's Confirmed bookings cell, start with it.
    const read = (path: string) => readFileSync(join(APP, path), "utf8");
    const delivery = read("src/pages/ceo/DeliveryTab.tsx");
    expect(delivery.match(/dwyCell\(r\) \?\?/g)?.length).toBe(2);
    expect(delivery).toContain("const dwy = dwyCell(r);");
    expect(delivery).not.toContain("<Na hint={DWY_BOOKINGS} />");
    const today = read("src/pages/ceo/TodayTab.tsx");
    expect(today.match(/dwyCell\(r\) \?\?/g)?.length).toBe(1);
    expect(today).not.toMatch(/value=\{cplOnlyOf\(r\) === "dwy" \? null/);
  });

  test("every tab's cost per booking hint names it", () => {
    const read = (path: string) => readFileSync(join(APP, path), "utf8");
    for (const path of [
      "src/pages/ceo/TodayTab.tsx",
      "src/pages/ceo/BackendTab.tsx",
      "src/pages/ceo/DeliveryTab.tsx",
      "src/pages/ceo/timeframeCards.tsx",
    ])
      expect(read(path)).toContain("doneWithYouLine(");
  });
});

// The CEO, 23 Oct 2026 (cost per booking decisions, 4): "Depends on how much
// spend if 2x target cpl then yes bad if below that then not enough data".
describe("spend with no lead in the status hints", () => {
  type Row = Parameters<typeof tooFewNote>[0];
  const row = (x: Partial<Row>): Row =>
    ({
      client: "مدانة العمرانية",
      clickupTaskId: null,
      spend7d: 11.09,
      leads7d: 0,
      cpl7d: null,
      bookings7d: 0,
      cpb7d: null,
      campaigns: 1,
      status: "watch",
      rates30: null,
      ...x,
    }) as Row;

  test("the clauses are 2 x the gate, computed", () => {
    expect(noLeadClauses()).toEqual({
      bad: "no lead after $30 of spend (2 x the $15 gate)",
      watch: "no lead yet on under $30 (not enough data)",
    });
    expect(noLeadClauses(40).bad).toBe(
      "no lead after $40 of spend (2 x the $20 cost per lead line)",
    );
    expect(statusRule("bad")).toContain(
      "No lead after $30 of spend (2 x the $15 gate) counts as a cost per lead over $22.50",
    );
    expect(statusRule("bad")).toContain(DWY_RULE);
    expect(statusRule("watch")).toContain(
      "no lead yet on under $30 (not enough data), which is too few to judge and never off track on leads",
    );
    expect(cplOnlyRule("bad", "not measured")).toContain(
      "no lead after $30 of spend (2 x the $15 gate)",
    );
    expect(cplOnlyRule("watch", "dwy", 40)).toContain(
      "no lead yet on under $40 (not enough data)",
    );
    expect(cplOnlyRule("good", "dwy")).toContain(
      "whatever bookings GoHighLevel holds for it",
    );
    expect(DWY_BOOKINGS).toBe(
      "Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.",
    );
  });

  test("Madana's row: too few to judge on its own line", () => {
    expect(tooFewNote(row({ tooFew: true, noLeadLine: 30 }))).toBe(
      "Too few to judge: no lead yet on $11.09, under $30.00 (2 x the $15.00 cost per lead line).",
    );
    expect(
      tooFewNote(row({ tooFew: true, noLeadLine: 40, spend7d: 39.99 })),
    ).toBe(
      "Too few to judge: no lead yet on $39.99, under $40.00 (2 x the $20.00 cost per lead line).",
    );
    // A payload without the flag says nothing.
    expect(tooFewNote(row({}))).toBe("");
    expect(tooFewNote(row({ tooFew: false, noLeadLine: 30 }))).toBe("");
  });

  test("no dollar line is typed in the screens", () => {
    const read = (path: string) => readFileSync(join(APP, path), "utf8");
    for (const path of [
      "src/pages/ceo/deliveryStatus.ts",
      "src/pages/ceo/DeliveryTab.tsx",
    ])
      expect(read(path)).not.toMatch(/\$30\b|\$20\b|\b30\.00\b/);
  });
});
