import { describe, expect, test } from "bun:test";
import type { SheetContext } from "../src/lib/ceoGoalSheetClient";
import { project } from "../src/pages/ceo/goalsModel";
import { freshHint, revenueWords } from "../src/pages/ceo/goalsSheetCells";
import {
  buildSheet,
  monthBefore,
  monthSoFar,
  notesFor,
  rangeOf,
  readRange,
  revenueFor,
  rowsOf,
  type SheetData,
} from "../src/pages/ceo/goalsSheetData";
import {
  COLUMN_BY_KEY,
  lineLabel,
  type PlanInputs,
  partsOf,
  planNumbers,
  rollUp,
  solveSpend,
} from "../src/pages/ceo/goalsSheetModel";

/**
 * The Goals sheet, round 2 (2026-11-02, hw-notes/goals-sheet/SPEC-ROUND2.md):
 * every number from its system of record. The CEO: "make this one the main
 * source of truth so everything else ties into it." Each rule is checked on
 * made-up numbers, with the new server keys (migration 20261102m, CEO refresh
 * release goal1102) and without them, as an older server sends the context.
 */

const C = COLUMN_BY_KEY;

/** October 2026 on 2 Nov, every round-2 key present, invented numbers. */
function october(over: Record<string, unknown> = {}): SheetContext {
  const g = (date: string, more: Record<string, unknown> = {}) => ({
    date,
    spend: 100,
    spendRetargeting: 10,
    leads: 4,
    bookedLeads: 3,
    introsBooked: 3,
    introsShown: 2,
    introsDue: 4,
    demosBooked: 1,
    demosShown: 1,
    demosDue: 2,
    closes: 0,
    contracted: 0,
    frontEndPaid: 0,
    uniqueLinkClicks: 200,
    introsAdvanced: 1,
    ...more,
  });
  return {
    today: "2026-11-02",
    month: "2026-10",
    plan: null,
    plans: [],
    targets: [],
    metrics: [],
    cells: [],
    growthDaily: [
      g("2026-09-30"),
      g("2026-10-01", { frontEndPaid: 3000, contracted: 6000, closes: 1 }),
      g("2026-10-02", { frontEndPaid: 1000, contracted: 4000, closes: 1 }),
      g("2026-10-03"),
    ],
    windows: [
      {
        from: "2026-11-01",
        raw: { link_clicks: 99, intros_advanced: 1 },
        frontEndCash: { paid: 0, paidOnWindowDeals: 0 },
      },
      {
        from: "2026-10-01",
        raw: { link_clicks: 900, intros_advanced: 7 },
        frontEndCash: { paid: 4000, paidOnWindowDeals: 3300 },
      },
    ],
    // The CEO's own test payment is already out of the money in.
    cashDaily: [
      { date: "2026-10-01", usd: 3000 },
      { date: "2026-10-02", usd: 1800 },
    ],
    cashExcluded: [
      {
        date: "2026-10-02",
        id: "ecom:INV_TEST",
        rail: "ecom",
        usd: 3.26,
        reason: "other",
        note: 'The CEO\'s own 1 KWD Ecom test ("test", 2 Oct): not client money.',
      },
    ],
    book: {
      month: "2026-11",
      projectedMrr: 9000,
      collected: 0,
      collectedBackEnd: 0,
      projectedExisting: 2000,
      projectedOnDeals: 7000,
      history: [
        {
          month: "2026-09",
          projected: 8000,
          collected: 5000,
          collectedBackEnd: null,
          projectedExisting: null,
          projectedOnDeals: null,
        },
        {
          month: "2026-10",
          projected: 10000,
          collected: 6000,
          collectedBackEnd: 800,
          projectedExisting: 3000,
          projectedOnDeals: 7000,
        },
      ],
    },
    refundsMonthly: [{ month: "2026-10", refunds: 250 }],
    bankThrough: null,
    deliveryDaily: [
      {
        date: "2026-10-01",
        spend: 500,
        leads: 50,
        spendMeasured: 500,
        confirmed: 5,
        crmSpend: 450,
        crmAdLeads: 30,
      },
      {
        date: "2026-10-02",
        spend: 300,
        leads: 20,
        spendMeasured: 300,
        confirmed: 3,
        crmSpend: null,
        crmAdLeads: null,
      },
    ],
    mediaDaily: [],
    clientDaily: [],
    churned: [
      { leftOn: "2026-10-02", client: "Made-up Co", reason: "Cancelled" },
    ],
    churnMonths: [],
    softwareMonthly: 4000,
    lockin: [],
    locked: null,
    callDaily: [
      {
        day: "2026-10-01",
        leads: 10,
        confirmedBookings: 3,
        shows: 4,
        noShow: 1,
        closed: 1,
      },
      {
        day: "2026-10-02",
        leads: 10,
        confirmedBookings: 2,
        shows: 6,
        noShow: 0,
        closed: 0,
      },
    ],
    winsDaily: {
      from: null,
      through: null,
      ledgerFrom: "2026-11-02",
      rows: [],
      source: "wins",
    },
    upsellCashDaily: {
      from: null,
      through: null,
      ledgerFrom: "2026-11-02",
      rows: [],
      source: "upsell cash",
    },
    upsellContracted: {
      from: null,
      through: null,
      ledgerFrom: "2026-11-02",
      rows: [],
      source: "upsell contracted",
    },
    refundsDaily: {
      from: "2026-09-01",
      through: "2026-10-31",
      rows: [
        {
          date: "2026-10-02",
          count: 2,
          usd: 250,
          whopCount: 1,
          whopUsd: 200,
          manualCount: 1,
          manualUsd: 50,
        },
      ],
      source: "refunds",
    },
    salesEodDaily: {
      rows: [
        { date: "2026-10-01", offers: 2, eods: 1 },
        { date: "2026-10-02", offers: null, eods: 1 },
      ],
      source: "eods",
    },
    extensionsDaily: {
      from: "2026-09-23",
      through: "2026-10-31",
      logFrom: "2026-09-23",
      rows: [
        {
          date: "2026-10-02",
          count: 1,
          grants: [
            { grantId: 1, client: "Made-up Co", weeks: 2, state: "live" },
          ],
        },
      ],
      source: "ext",
    },
    softwareByMonth: [
      {
        month: "2026-09",
        usd: null,
        basis: "missing",
        capturedAt: null,
        source: "No month point was kept for September 2026.",
      },
      {
        month: "2026-10",
        usd: 4200,
        basis: "point",
        capturedAt: "2026-10-31T20:00:00Z",
        source:
          "What software ran at in October 2026: the lines as kept on 31 Oct.",
      },
    ],
    frontEndMonths: [
      { month: "2026-09", paid: 900, paidOnWindowDeals: 600 },
      { month: "2026-10", paid: 4000, paidOnWindowDeals: 3300 },
    ],
    readsMissing: [],
    ...over,
  } as unknown as SheetContext;
}

/** The same month from a server older than 20261102m and the 2 Nov release. */
function olderServer(): SheetContext {
  const ctx = october() as unknown as Record<string, unknown>;
  for (const k of [
    "cashExcluded",
    "winsDaily",
    "upsellCashDaily",
    "upsellContracted",
    "refundsDaily",
    "salesEodDaily",
    "extensionsDaily",
    "softwareByMonth",
    "frontEndMonths",
    "readsMissing",
  ])
    delete ctx[k];
  ctx.windows = (ctx.windows as Record<string, unknown>[]).map(
    ({ frontEndCash: _, ...w }) => w,
  );
  ctx.growthDaily = (ctx.growthDaily as Record<string, unknown>[]).map(
    ({ uniqueLinkClicks: _a, introsAdvanced: _b, ...d }) => d,
  );
  ctx.deliveryDaily = (ctx.deliveryDaily as Record<string, unknown>[]).map(
    ({ crmSpend: _a, crmAdLeads: _b, ...d }) => d,
  );
  const book = ctx.book as Record<string, unknown>;
  ctx.book = {
    month: book.month,
    projectedMrr: book.projectedMrr,
    collected: book.collected,
    history: (book.history as Record<string, unknown>[]).map(h => ({
      month: h.month,
      projected: h.projected,
      collected: h.collected,
    })),
  };
  return ctx as unknown as SheetContext;
}

const month = (sheet: SheetData, key: string) =>
  readRange(sheet, key, `${sheet.month}-01`, sheet.through);

describe("1. total revenue (with AR)", () => {
  const sheet = buildSheet(october());

  test("is new cash plus back-end cash less the refunds logged by hand", () => {
    // 4,800 in on the rails (the test payment already out), 4,000 of it new
    // cash, 800 back end; 50 of refunds logged by hand. The 200 Whop refund
    // is already net in Whop's cash, so it does not come off again.
    const r = month(sheet, "totalCash");
    expect(r?.value).toBe(4750);
    expect(r?.revenue?.parts).toEqual({
      newCash: 4000,
      backEndCash: 800,
      refundsManual: 50,
    });
    expect(r?.revenue?.leftOut).toEqual([
      "the CEO's own 1 KWD Ecom test $3.26 (2 Oct)",
    ]);
    const words = revenueWords(r?.revenue as never);
    expect(words).toContain(
      "Leaves out the CEO's own 1 KWD Ecom test $3.26 (2 Oct)",
    );
    expect(words).toContain("less $50 of refunds logged by hand");
  });

  test("works for a day and a rolling run, the same rule", () => {
    expect(
      readRange(sheet, "totalCash", "2026-10-02", "2026-10-02")?.value,
    ).toBe(1750);
    expect(
      readRange(sheet, "totalCash", "2026-09-28", "2026-10-03")?.value,
    ).toBe(4750);
    // A day with nothing in and no refund is 0, read, not missing.
    expect(
      readRange(sheet, "totalCash", "2026-10-03", "2026-10-03")?.value,
    ).toBe(0);
  });

  test("profit and margin: revenue less overhead, labour and marketing, paced from the parts", () => {
    const typed = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-03",
            key: "labour",
            kind: "actual",
            value: 300,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    // 4,750 less overhead 4,200 (the month's point), labour 300 and marketing 330.
    const p = month(typed, "profit");
    expect(p?.value).toBeCloseTo(4750 - (4200 + 300 + 330), 6);
    expect(month(typed, "margin")?.value).toBeCloseTo((4750 - 4830) / 4750, 9);
    // The pace comes from the parts (paceFor), not by stretching the profit.
    expect(p?.pace).not.toBeNull();
    // Without labour, profit says what it waits on.
    expect(month(sheet, "profit")?.value).toBeNull();
    expect(month(sheet, "profit")?.waits.join(" ")).toContain(
      "Labour expenses are typed",
    );
  });

  test("a day outside the money refresh's window is not known, so the run is missing", () => {
    const narrow = buildSheet(
      october({
        refundsDaily: { from: "2026-10-02", through: "2026-10-31", rows: [] },
      }),
    );
    const r = readRange(narrow, "totalCash", "2026-10-01", "2026-10-03");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "Money in was read from 2 Oct to 31 Oct",
    );
  });

  test("an older server: revenue waits on the hand-logged refunds, never a smaller number", () => {
    const old = buildSheet(olderServer());
    const r = month(old, "totalCash");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "Refunds logged by hand, by day, wait on",
    );
    // Once the money refresh hands the month's hand-logged part over, the month completes.
    const later = olderServer();
    later.refundsMonthly = [
      { month: "2026-10", refunds: 250, refundsManual: 50 },
    ];
    expect(month(buildSheet(later), "totalCash")?.value).toBe(4750);
    // Refunds amount keeps reading the month's number, as before.
    expect(month(old, "refundAmount")?.value).toBe(250);
  });

  test("the plan does not move: its revenue is the goal and the spend solves the same", () => {
    const inputs: PlanInputs = {
      spend: null,
      cpl: 20,
      qualifiedShare: null,
      leadToBooked: 0.7,
      introShowRate: 0.6,
      introToDemo: 0.7,
      directDemos: 10,
      demoShowRate: 0.7,
      qualifiedDemoShare: null,
      closeRate: 0.2,
      aov: 6000,
      cashShare: 0.75,
      spendRetargeting: null,
      mrrDue: 10000,
      mrrCollectionRate: 0.8,
      upsellCash: 3000,
      refundAmount: 0,
      labour: 15000,
      overhead: 5000,
      otherMarketing: null,
      feeRate: null,
      callLeads: null,
      callLeadToBooking: null,
      clientCpl: null,
      goalCash: 50000,
      hammerShare: 0.1,
      cpc: 0.6,
      offerRate: 0.9,
    };
    const { byColumn } = planNumbers(inputs);
    expect(byColumn.totalCash as number).toBeCloseTo(50000, 6);
    expect(byColumn.spend as number).toBeCloseTo(
      solveSpend(inputs) as number,
      9,
    );
  });
});

describe("2. MRR is back end only", () => {
  test("projected, collected and Collections % from the book's back-end fields, history for a past month", () => {
    const sheet = buildSheet(october());
    expect(month(sheet, "mrrProjected")?.value).toBe(3000);
    expect(month(sheet, "mrrCollected")?.value).toBe(800);
    expect(month(sheet, "mrrCollectionRate")?.value).toBeCloseTo(800 / 3000, 9);
    const source = sheet.columns.find(c => c.key === "mrrCollected")?.source;
    expect(source).toContain("clients who were clients before the month");
    expect(source).toContain(
      "New clients' first payments are in Cash collected",
    );
    expect(source).toContain("$7,000 of MRR");
  });

  test("a month with no back-end snapshot is missing with the reason, never 0", () => {
    const sheet = buildSheet(october());
    const sep = monthBefore(sheet);
    const r = readRange(sheet, "mrrCollected", sep.from, sep.through);
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "needs that month's last billing snapshot",
    );
  });

  test("an older worker's book is not used: it holds new clients' first payments", () => {
    const r = month(buildSheet(olderServer()), "mrrCollected");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain("$6,000 collected of $10,000");
  });

  test("a day or a rolling run has none of its own", () => {
    const sheet = buildSheet(october());
    const r = readRange(sheet, "mrrCollected", "2026-10-01", "2026-10-03");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain("A whole-month number");
  });
});

describe("3. UF cash % is this month's deals only", () => {
  test("the month's deals' cash over the month's contracted", () => {
    const sheet = buildSheet(october());
    // 3,300 paid on October's own deals over 10,000 contracted.
    expect(month(sheet, "cashShare")?.value).toBeCloseTo(0.33, 9);
    // Cash collected still holds every front-end payment.
    expect(month(sheet, "newCash")?.value).toBe(4000);
  });

  test("a month measure: days and rolling runs read missing and say so", () => {
    const sheet = buildSheet(october());
    const r = readRange(sheet, "cashShare", "2026-10-01", "2026-10-03");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain("a month measure");
  });

  test("absent before the migration: missing with the reason, never the old all-cash ratio", () => {
    const r = month(buildSheet(olderServer()), "cashShare");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "waits on the sheet's server update of 2 Nov 2026 (20261102m)",
    );
  });

  test("the release live and the migration not (2 Nov): it waits on the migration, not the release", () => {
    // Repair 2026-11-02: the growth days, the book and the delivery days
    // carry the release's fields, but only 20261102m passes the months'
    // front-end cash to the sheet, so naming the live release was wrong.
    const ctx = october() as unknown as Record<string, unknown>;
    delete ctx.frontEndMonths;
    ctx.windows = (ctx.windows as Record<string, unknown>[]).map(
      ({ frontEndCash: _, ...w }) => w,
    );
    const r = month(buildSheet(ctx as unknown as SheetContext), "cashShare");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain("(20261102m)");
    expect(r?.waits.join(" ")).not.toContain("CEO refresh release");
  });

  test("the migration live and the list not published (null): it waits on the release", () => {
    const ctx = october({ frontEndMonths: null }) as unknown as Record<
      string,
      unknown
    >;
    ctx.windows = (ctx.windows as Record<string, unknown>[]).map(w => ({
      ...w,
      frontEndCash: null,
    }));
    const r = month(buildSheet(ctx as unknown as SheetContext), "cashShare");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "waits on the CEO refresh release of 2 Nov 2026",
    );
    expect(r?.waits.join(" ")).not.toContain("20261102m");
  });

  test("a month the list lacks is not known; the window's own number stands in when it has one", () => {
    const listed = buildSheet(october({ frontEndMonths: [] }));
    // The October window still carries paidOnWindowDeals.
    expect(month(listed, "cashShare")?.value).toBeCloseTo(0.33, 9);
    const neither = october({ frontEndMonths: [] }) as unknown as Record<
      string,
      unknown
    >;
    neither.windows = [];
    const r = month(
      buildSheet(neither as unknown as SheetContext),
      "cashShare",
    );
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "is not in the growth refresh's months",
    );
  });

  test("in the month in progress both sides run to today", () => {
    const nov = october({
      month: "2026-11",
      growthDaily: [
        { date: "2026-11-01", contracted: 5000, frontEndPaid: 0 },
        { date: "2026-11-02", contracted: 5000, frontEndPaid: 2000 },
      ],
      frontEndMonths: [
        { month: "2026-11", paid: 2000, paidOnWindowDeals: 2000 },
      ],
    });
    const sheet = buildSheet(nov);
    expect(sheet.through).toBe("2026-11-01");
    expect(month(sheet, "cashShare")?.value).toBeCloseTo(2000 / 10000, 9);
  });
});

describe("4. extensions: the billing log; a typed day replaces it", () => {
  test("a typed day replaces that day's grants, never adds", () => {
    const sheet = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-02",
            key: "extensionsGiven",
            kind: "actual",
            value: 3,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    expect(month(sheet, "extensionsGiven")?.value).toBe(3);
    // A read day with none is 0, not empty.
    expect(
      readRange(sheet, "extensionsGiven", "2026-10-03", "2026-10-03")?.value,
    ).toBe(0);
  });

  test("a rolling run reaching before the log's first day is missing with the reason", () => {
    const sheet = buildSheet(october());
    const r = readRange(sheet, "extensionsGiven", "2026-09-20", "2026-10-03");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "The billing log began on 23 Sep 2026",
    );
    expect(
      readRange(sheet, "extensionsGiven", "2026-09-23", "2026-10-03")?.value,
    ).toBe(1);
  });

  test("an older server reads the month's grants, 0 on its days, and the month before not known", () => {
    const old = olderServer() as unknown as Record<string, unknown>;
    old.lifecycle = {
      extensions: [
        {
          grantId: 1,
          taskId: "t",
          client: "Made-up Co",
          grantedOn: "2026-10-02",
          weeks: 2,
          from: null,
          until: "2026-10-16",
          state: "live",
          reason: null,
          source: "s",
        },
      ],
      latePayments: [],
      departures: [],
      missing: [],
    };
    const sheet = buildSheet(old as unknown as SheetContext);
    expect(month(sheet, "extensionsGiven")?.value).toBe(1);
    const r = readRange(sheet, "extensionsGiven", "2026-09-28", "2026-10-03");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "Extensions in the month before wait on",
    );
  });
});

describe("5. wins, upsell cash and total contracted from the wins ledger", () => {
  const november = (over: Record<string, unknown> = {}) =>
    october({
      month: "2026-11",
      today: "2026-11-04",
      growthDaily: [
        { date: "2026-11-01", contracted: 6000 },
        { date: "2026-11-02", contracted: 0 },
        { date: "2026-11-03", contracted: 4000 },
      ],
      winsDaily: {
        from: "2026-11-02",
        through: "2026-11-04",
        ledgerFrom: "2026-11-02",
        rows: [
          { date: "2026-11-02", kind: "upsell_website", count: 1 },
          { date: "2026-11-03", kind: "review", count: 2 },
          { date: "2026-11-03", kind: "video_testimonial", count: 1 },
          { date: "2026-11-03", kind: "referral", count: 1 },
          // Dated before the days read: not counted, that day stays not known.
          { date: "2026-11-01", kind: "review", count: 5 },
        ],
      },
      upsellCashDaily: {
        from: "2026-11-02",
        through: "2026-11-04",
        rows: [{ date: "2026-11-03", usd: 1200, payments: 1 }],
      },
      upsellContracted: {
        from: "2026-11-02",
        through: "2026-11-04",
        rows: [{ date: "2026-11-02", usd: 2500, count: 1 }],
      },
      ...over,
    });

  test("each kind counts in its column; 0 on a read day", () => {
    const sheet = buildSheet(november());
    const run = (k: string) =>
      readRange(sheet, k, "2026-11-02", "2026-11-03")?.value;
    expect(run("upsells")).toBe(1);
    expect(run("googleReviews")).toBe(2);
    expect(run("testimonials")).toBe(1);
    expect(run("referrals")).toBe(1);
    expect(run("upsellCash")).toBe(1200);
    expect(run("totalContracted")).toBe(4000 + 2500);
  });

  test("a day before the ledger opened is not known: the month waits, and typing it completes it", () => {
    const sheet = buildSheet(november());
    const r = month(sheet, "googleReviews");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "The wins ledger opened on 2 Nov 2026",
    );
    expect(r?.waits.join(" ")).toContain("Type the day's count");
    const typed = buildSheet(
      november({
        cells: [
          {
            day: "2026-11-01",
            key: "googleReviews",
            kind: "actual",
            value: 0,
            note: null,
            by: "ceo",
            at: "x",
          },
          {
            day: "2026-11-01",
            key: "upsells",
            kind: "actual",
            value: 0,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    expect(month(typed, "googleReviews")?.value).toBe(2);
    // 0 upsells typed for 1 Nov makes its upsells contracted 0 too.
    expect(month(typed, "totalContracted")?.value).toBe(10000 + 2500);
  });

  test("a typed day replaces the ledger's count", () => {
    const sheet = buildSheet(
      november({
        cells: [
          {
            day: "2026-11-03",
            key: "googleReviews",
            kind: "actual",
            value: 1,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    expect(
      readRange(sheet, "googleReviews", "2026-11-02", "2026-11-03")?.value,
    ).toBe(1);
  });

  test("October reads missing: the wins ledger began 2 Nov 2026", () => {
    const sheet = buildSheet(october());
    for (const k of [
      "upsells",
      "upsellCash",
      "referrals",
      "testimonials",
      "googleReviews",
      "totalContracted",
    ]) {
      const r = month(sheet, k);
      expect(r?.value).toBeNull();
      expect(r?.waits.join(" ")).toContain(
        "The wins ledger opened on 2 Nov 2026",
      );
    }
  });

  test("an older server: wins stay typed only, and total contracted waits on the update", () => {
    const old = buildSheet(olderServer());
    expect(month(old, "upsells")?.value).toBeNull();
    const r = month(old, "totalContracted");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "Upsells contracted (their quoted price) wait on",
    );
  });

  test("readsMissing comes through for the top of the sheet; an older server sends none", () => {
    const sheet = buildSheet(
      november({ readsMissing: ["The wins ledger was not read (timeout)."] }),
    );
    expect(sheet.readsMissing).toEqual([
      "The wins ledger was not read (timeout).",
    ]);
    expect(buildSheet(olderServer()).readsMissing).toBeNull();
  });

  test("a store that was not read leaves its days not known", () => {
    const sheet = buildSheet(november({ winsDaily: null }));
    const r = readRange(sheet, "upsells", "2026-11-02", "2026-11-03");
    expect(r?.value).toBeNull();
  });
});

describe("6. refunds and refunds amount by day", () => {
  test("count and amount from the money refresh's rows, 0 on a read day", () => {
    const sheet = buildSheet(october());
    expect(month(sheet, "refunds")?.value).toBe(2);
    expect(month(sheet, "refundAmount")?.value).toBe(250);
    expect(readRange(sheet, "refunds", "2026-10-03", "2026-10-03")?.value).toBe(
      0,
    );
    const typed = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-02",
            key: "refunds",
            kind: "actual",
            value: 1,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    expect(month(typed, "refunds")?.value).toBe(1);
  });
});

describe("7. offers made from the closer's EOD; a typed day wins", () => {
  test("the EOD fills its days, a typed day wins, and an empty day says why", () => {
    const sheet = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-03",
            key: "offersMade",
            kind: "actual",
            value: 4,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    // 2 on the 1st from the EOD, the 2nd's EOD has no number, 4 typed on the 3rd.
    expect(month(sheet, "offersMade")?.value).toBe(6);
    const second = readRange(sheet, "offersMade", "2026-10-02", "2026-10-02");
    expect(second?.value).toBeNull();
    expect(second?.waits).toEqual([
      "The closer's EOD that day has no offers number.",
    ]);
    const fourth = readRange(sheet, "offersMade", "2026-10-04", "2026-10-04");
    expect(fourth?.waits).toEqual(["No closer EOD was filed that day."]);
    expect(C.offersMade.source).toContain("The closer's EOD");
    expect(C.offersMade.source).toContain("a typed day wins");
  });

  test("a typed day beats the EOD on the same day; an older server stays typed only", () => {
    const sheet = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-01",
            key: "offersMade",
            kind: "actual",
            value: 5,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    expect(
      readRange(sheet, "offersMade", "2026-10-01", "2026-10-01")?.value,
    ).toBe(5);
    expect(month(buildSheet(olderServer()), "offersMade")?.value).toBeNull();
  });
});

describe("8. overhead: the month's own point, today's lines for this month", () => {
  test("a past month reads its point and says where it came from", () => {
    const sheet = buildSheet(october());
    expect(month(sheet, "software")?.value).toBe(4200);
    expect(sheet.columns.find(c => c.key === "software")?.source).toContain(
      "the lines as kept on 31 Oct",
    );
    const sep = monthBefore(sheet);
    const r = readRange(sheet, "software", sep.from, sep.through);
    expect(r?.value).toBeNull();
    expect(r?.waits).toEqual(["No month point was kept for September 2026."]);
  });

  test("an older server: the current month reads today's lines, a past month waits", () => {
    const old = buildSheet(olderServer());
    const r = month(old, "software");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain(
      "Today's lines ($4,000) were repriced on 1 Nov",
    );
    const nov = olderServer();
    nov.month = "2026-11";
    expect(buildSheet(nov).facts.software).toBe(4000);
  });
});

describe("9. intro to demo % from the days", () => {
  test("introsAdvanced over intros held, any run; the window fact is not used", () => {
    const sheet = buildSheet(october());
    expect(sheet.facts.introsAdvanced).toBeUndefined();
    expect(month(sheet, "introToDemo")?.value).toBeCloseTo(3 / 6, 9);
    expect(
      readRange(sheet, "introToDemo", "2026-09-30", "2026-10-02")?.value,
    ).toBeCloseTo(3 / 6, 9);
  });

  test("an ended month whose days lack it reads the window; the month in progress waits", () => {
    const old = buildSheet(olderServer());
    expect(month(old, "introToDemo")?.value).toBeCloseTo(7 / 6, 9);
    const running = olderServer();
    running.today = "2026-10-20";
    const r = month(buildSheet(running), "introToDemo");
    expect(r?.value).toBeNull();
    expect(r?.waits.join(" ")).toContain("Intro to demo by day waits on");
  });
});

describe("11. call centre close rate from the report alone", () => {
  test("the report's closed over its shows; 0 means 0 recorded", () => {
    const sheet = buildSheet(october());
    expect(month(sheet, "callCloseRate")?.value).toBeCloseTo(1 / 10, 9);
    const day = readRange(sheet, "callCloseRate", "2026-10-02", "2026-10-02");
    expect(day?.value).toBe(0);
    expect(day?.leaves.join(" ")).toContain("0 recorded");
  });
});

describe("12. client CPL on the clients' CRM ad leads, paired", () => {
  test("paired spend over CRM ad leads, a day with no pair skipped, the unpaired spend named", () => {
    const sheet = buildSheet(october());
    const r = month(sheet, "clientCpl");
    expect(r?.value).toBeCloseTo(450 / 30, 9);
    // 50 unpaired on the 1st and all 300 of the 2nd.
    expect(r?.leaves.join(" ")).toContain("Leaves out $350 of client spend");
    expect(sheet.columns.find(c => c.key === "clientCpl")?.label).toBe("CPL");
  });

  test("before the release: Meta's form leads, and the label says so", () => {
    const sheet = buildSheet(olderServer());
    expect(month(sheet, "clientCpl")?.value).toBeCloseTo(800 / 70, 9);
    const c = sheet.columns.find(x => x.key === "clientCpl");
    expect(c?.label).toBe("CPL (Meta form leads)");
    expect(c?.source).toContain("until the CEO refresh release");
  });
});

describe("13. FE ROAS and CPA on the plan side divide by Meta ad spend", () => {
  test("lead gen plus Hammer Them, never other marketing", () => {
    const inputs = {
      ...({} as PlanInputs),
      spend: 3000,
      spendRetargeting: 300,
      otherMarketing: 700,
      cpl: 15,
      leadToBooked: 0.6,
      introShowRate: 0.5,
      introToDemo: 0.5,
      directDemos: 0,
      demoShowRate: 0.6,
      closeRate: 0.3,
      aov: 6000,
      cashShare: 0.6,
      hammerShare: null,
      goalCash: null,
      cpc: null,
      offerRate: null,
    } as PlanInputs;
    const { byColumn } = planNumbers(inputs);
    const closes = byColumn.closes as number;
    expect(byColumn.cac as number).toBeCloseTo(3300 / closes, 9);
    expect(byColumn.roasFrontEnd as number).toBeCloseTo(
      (byColumn.newCash as number) / 3300,
      9,
    );
    // Marketing expenses still carry other marketing.
    expect(byColumn.marketingExpenses).toBe(4000);
    // The Goals model's CPA is the same rule.
    const p = project({ ...inputs, spendRetargeting: 300 } as never);
    expect(p.cac as number).toBeCloseTo(3300 / (p.closes as number), 9);
  });
});

describe("14. wording, the churn register and the newest days", () => {
  test("clients churned is read-only: 0 on a read day, a typed cell is not used", () => {
    expect(C.clientsChurned.editable).toBe(false);
    const sheet = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-03",
            key: "clientsChurned",
            kind: "actual",
            value: 4,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      }),
    );
    expect(
      readRange(sheet, "clientsChurned", "2026-10-03", "2026-10-03")?.value,
    ).toBe(0);
    expect(
      readRange(sheet, "clientsChurned", "2026-10-02", "2026-10-02")?.value,
    ).toBe(1);
  });

  test("the round's sentences", () => {
    expect(C.introsShown.source).toContain(
      "confirmed or invalid (held, not a fit)",
    );
    expect(C.demosShown.source).toContain("Invalid calls count as shown");
    expect(C.leadToBooked.source).toContain("a past month can still rise");
    expect(C.landingPageConversion.source).toContain(
      "ROAS leads (CRM) over unique link clicks (Meta)",
    );
    expect(C.introToDemo.source).toContain(
      "Not the old sheet's demos booked ÷ intros scheduled",
    );
    expect(C.callLeadToBooking.source).toContain(
      "Client Performance board's booking rate",
    );
  });

  test("the newest days: Meta can still adjust, and today's scheduled counts only calls past", () => {
    expect(
      freshHint(C.spend, "2026-11-01", "2026-11-02", partsOf(C.spend)),
    ).toContain("Meta can still adjust its last 3 days");
    expect(
      freshHint(C.spend, "2026-10-20", "2026-11-02", partsOf(C.spend)),
    ).toBe("");
    expect(
      freshHint(C.introsDue, "2026-11-02", "2026-11-02", partsOf(C.introsDue)),
    ).toContain("only the calls whose time has passed");
    expect(
      freshHint(C.leads, "2026-11-01", "2026-11-02", partsOf(C.leads)),
    ).toBe("");
  });
});

describe("15. the lock-in names a line as the sheet does", () => {
  test("October's 'Total new cash' line under totalCash reads Total revenue (with AR)", () => {
    expect(
      lineLabel({ label: "Total new cash", metric_key: "totalCash" }),
    ).toBe("Total revenue (with AR)");
    expect(lineLabel({ label: "Labour expenses", metric_key: null })).toBe(
      "Labour expenses",
    );
    expect(lineLabel({ label: "Show rate", metric_key: "introShowRate" })).toBe(
      "Intro show rate",
    );
  });
});

describe("the board's contract: one roll-up per key", () => {
  test("the month so far uses the month's facts; a shorter run never does", () => {
    const old = buildSheet(olderServer());
    // Unique link clicks: October's window stands in for the whole month only.
    expect(
      readRange(old, "uniqueLinkClicks", "2026-10-01", "2026-10-31")?.value,
    ).toBe(900);
    expect(
      readRange(old, "uniqueLinkClicks", "2026-10-01", "2026-10-02")?.value,
    ).toBeNull();
    const range = monthSoFar(old);
    expect(range.facts).toBeDefined();
    expect(rangeOf(old, "2026-10-02", "2026-10-31").facts).toBeUndefined();
    expect(readRange(old, "nothing", "2026-10-01", "2026-10-31")).toBeNull();
  });

  test("readRange agrees with rollUp and gives revenue's parts for revenue, profit and margin", () => {
    const sheet = buildSheet(october());
    const range = monthSoFar(sheet);
    for (const c of sheet.columns) {
      const r = readRange(sheet, c.key, range.from, range.through);
      expect(r?.value ?? null).toBe(
        rollUp(c, range.rows, range.worked, range.facts),
      );
    }
    expect(month(sheet, "profit")?.revenue?.parts.newCash).toBe(4000);
    expect(month(sheet, "leads")?.revenue).toBeNull();
    expect(revenueFor(sheet, range).value).toBe(4750);
    expect(notesFor(sheet, C.leads, range, 12).waits).toEqual([]);
    expect(rowsOf(sheet, ["2026-10-02"])[0].cashIn).toBe(1800);
  });

  test("a growth day with null unique clicks leaves the run missing with the reason, CPC never stretched", () => {
    // Repair 2026-11-02, the finding's own numbers: 100 of spend on 50
    // clicks, then 100 of spend Meta gave no unique count for. It read 50
    // clicks and CPC 4.00; now both wait, and say why.
    const sheet = buildSheet(
      october({
        growthDaily: [
          { date: "2026-10-01", spend: 100, uniqueLinkClicks: 50 },
          { date: "2026-10-02", spend: 100, uniqueLinkClicks: null },
        ],
      }),
    );
    for (const key of ["uniqueLinkClicks", "cpc", "landingPageConversion"]) {
      const r = readRange(sheet, key, "2026-10-01", "2026-10-02");
      expect(r?.value).toBeNull();
      expect(r?.waits.join(" ")).toContain("Meta gave no unique count");
    }
    expect(readRange(sheet, "spend", "2026-10-01", "2026-10-02")?.value).toBe(
      200,
    );
    expect(readRange(sheet, "cpc", "2026-10-01", "2026-10-01")?.value).toBe(2);
    // The month so far holds the null day too.
    expect(month(sheet, "cpc")?.value).toBeNull();
    expect(month(sheet, "cpc")?.pace).toBeNull();
  });
});
