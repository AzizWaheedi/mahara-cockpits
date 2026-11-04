import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SheetContext } from "../src/lib/ceoGoalSheetClient";
import { copyGoalPlan, readGoalsBoard } from "../src/lib/ceoGoalsClient";
import { buildGoalsBoard, type GoalContext } from "../src/lib/ceoGoalsModel";
import { buildSheet, readRange } from "../src/pages/ceo/goalsSheetData";
import {
  COLUMN_BY_KEY,
  colourFor,
  SHEET_COLUMNS,
} from "../src/pages/ceo/goalsSheetModel";
import type { TargetRow } from "../src/types/ceo/goals";
import { METRICS, scoreboard } from "../src/types/ceo/scoreboard";

/**
 * The Goals board reads the Goals sheet (2026-11-02, truth/SYNTHESIS.md fix
 * 3). The CEO: "make this one the main source of truth so everything else
 * ties into it." Every key the sheet has is the sheet's own roll-up over the
 * plan's days, its pace and its reasons; the catalogue (scoreboard) reads only
 * the ladder's keys the sheet lacks. Every number here is invented.
 */

const DAY = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;

type Grow = Record<string, number | null | string>;

/** One growth day, invented. */
function grow(date: string, over: Grow = {}): Grow {
  return {
    date,
    spend: 100,
    spendRetargeting: 10,
    leads: 5,
    qualified: 2,
    bookedLeads: 4,
    introsBooked: 3,
    introsShown: 2,
    introsDue: 4,
    demosBooked: 2,
    demosShown: 1,
    demosDue: 2,
    demosQualified: 1,
    closes: 0,
    contracted: 0,
    frontEndPaid: 0,
    uniqueLinkClicks: 250,
    introsAdvanced: 1,
    ...over,
  };
}

const NOV_DAYS = [
  grow(DAY(1), { closes: 1, contracted: 6000, frontEndPaid: 3000 }),
  grow(DAY(2), { spend: 120 }),
  grow(DAY(3), { spend: 80 }),
  grow(DAY(4)),
];

/** November 2026 on 5 Nov (four working days done), every round-2 key read. */
function november(over: Partial<SheetContext> = {}): SheetContext {
  const read = { from: "2026-10-01", through: DAY(4) };
  return {
    today: DAY(5),
    month: "2026-11",
    plan: null,
    plans: [],
    targets: [],
    metrics: [],
    cells: [
      {
        day: DAY(1),
        key: "labour",
        kind: "actual",
        value: 12000,
        note: null,
        by: "ceo",
        at: "2026-11-01T08:00:00Z",
      },
    ],
    growthDaily: NOV_DAYS,
    windows: [
      {
        from: "2026-11-01",
        raw: { link_clicks: 999, intros_advanced: 9 },
        frontEndCash: { paid: 3000, paidOnWindowDeals: 3000 },
      },
    ],
    cashDaily: [
      { date: DAY(1), usd: 3500 },
      { date: DAY(3), usd: 1000 },
    ],
    cashExcluded: [],
    book: {
      month: "2026-11",
      projectedMrr: 9000,
      collected: 1500,
      collectedBackEnd: 1500,
      projectedExisting: 4000,
      projectedOnDeals: 5000,
      history: [
        {
          month: "2026-10",
          projected: 8000,
          collected: 6000,
          collectedBackEnd: 800,
          projectedExisting: 3000,
          projectedOnDeals: 5000,
        },
      ],
    },
    refundsMonthly: [],
    bankThrough: null,
    deliveryDaily: [
      {
        date: DAY(1),
        spend: 500,
        leads: 50,
        spendMeasured: 500,
        confirmed: 5,
        crmSpend: 480,
        crmAdLeads: 40,
      },
      {
        date: DAY(2),
        spend: 300,
        leads: 20,
        spendMeasured: 300,
        confirmed: 3,
        crmSpend: 300,
        crmAdLeads: 25,
      },
    ],
    mediaDaily: [
      { date: DAY(1), spend: 500, impressions: 40000, clicks: 400, leads: 45 },
    ],
    clientDaily: [{ date: DAY(1), qualitySum: 30, qualityCount: 5 }],
    churned: [],
    churnMonths: [],
    softwareMonthly: 5000,
    lockin: [],
    locked: null,
    callDaily: [
      {
        day: DAY(1),
        leads: 20,
        confirmedBookings: 5,
        shows: 3,
        noShow: 1,
        closed: 1,
      },
      {
        day: DAY(2),
        leads: 10,
        confirmedBookings: 2,
        shows: 1,
        noShow: 1,
        closed: 0,
      },
    ],
    winsDaily: {
      ...read,
      ledgerFrom: "2026-11-02",
      rows: [
        { date: DAY(2), kind: "review", count: 2 },
        { date: DAY(3), kind: "upsell_ads", count: 1 },
      ],
    },
    upsellCashDaily: {
      ...read,
      ledgerFrom: "2026-11-02",
      rows: [{ date: DAY(4), usd: 700, payments: 1 }],
    },
    upsellContracted: {
      ...read,
      ledgerFrom: "2026-11-02",
      rows: [{ date: DAY(3), usd: 1200, count: 1 }],
    },
    refundsDaily: {
      ...read,
      rows: [
        {
          date: DAY(2),
          count: 1,
          usd: 200,
          whopCount: 0,
          whopUsd: 0,
          manualCount: 1,
          manualUsd: 200,
        },
      ],
    },
    salesEodDaily: {
      rows: [
        { date: DAY(1), offers: 1, eods: 1 },
        { date: DAY(2), offers: 0, eods: 1 },
        { date: DAY(3), offers: 0, eods: 1 },
        { date: DAY(4), offers: 0, eods: 1 },
      ],
    },
    extensionsDaily: { ...read, logFrom: "2026-09-23", rows: [] },
    softwareByMonth: [
      {
        month: "2026-10",
        usd: 4800,
        basis: "point",
        capturedAt: "2026-10-31T20:00:00Z",
        source: "Kept when October closed.",
      },
      {
        month: "2026-11",
        usd: 5000,
        basis: "lines",
        capturedAt: null,
        source: "Today's lines.",
      },
    ],
    frontEndMonths: [
      { month: "2026-10", paid: 9000, paidOnWindowDeals: 6000 },
      { month: "2026-11", paid: 3000, paidOnWindowDeals: 3000 },
    ],
    readsMissing: [],
    ...over,
  };
}

/** October 2026 read on 2 Nov: a past month, its facts from the book's history. */
function october(): SheetContext {
  const days = Array.from({ length: 31 }, (_, i) =>
    grow(`2026-10-${String(i + 1).padStart(2, "0")}`),
  );
  return november({
    today: "2026-11-02",
    month: "2026-10",
    cells: [],
    growthDaily: days,
    windows: [],
    cashDaily: [{ date: "2026-10-05", usd: 2000 }],
    callDaily: null,
    refundsDaily: { from: "2026-09-01", through: "2026-10-31", rows: [] },
    winsDaily: null,
    upsellCashDaily: null,
    upsellContracted: null,
    extensionsDaily: null,
  });
}

/** An older server: none of the 2 Nov keys (migration 20261102m) at all. */
function olderServer(): SheetContext {
  const ctx = november() as Record<string, unknown>;
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
  return ctx as SheetContext;
}

let nextId = 1;
/** A stored target row on the plan, named as the sheet names it. */
function target(key: string, value: number | null): Record<string, unknown> {
  const c = COLUMN_BY_KEY[key];
  const def = METRICS.find(m => m.key === key);
  return {
    id: nextId++,
    group_key: def?.group ?? "front_end",
    metric_key: key,
    label: c?.label ?? def?.label ?? key,
    unit: c?.unit ?? def?.unit ?? "count",
    direction: c?.direction ?? def?.direction ?? "up",
    target: value,
    stretch: null,
    baseline: null,
    note: null,
    sort: nextId,
    actual_manual: null,
  };
}

function plan(from: string, to: string, id = 6) {
  return {
    id,
    period_kind: "month",
    period_from: from,
    period_to: to,
    title: "Invented plan",
    status: "live",
    working_days: 26,
    mission: null,
    headline: null,
  };
}

/** The goals context the server would send, for one plan and these targets. */
function goals(
  targets: Record<string, unknown>[],
  over: Partial<GoalContext> = {},
): GoalContext {
  const p = plan("2026-11-01", "2026-11-30");
  return {
    plan: p,
    plans: [p],
    targets,
    payloads: {
      growth: { daily: NOV_DAYS } as never,
      money: { mrr: { groups: [{ group: "active", cards: 16 }] } } as never,
    },
    scorecardsDone: 3,
    fingerprint: "0".repeat(32),
    today: DAY(5),
    ...over,
  };
}

function rowOf(board: { groups: { targets: TargetRow[] }[] }, key: string) {
  const row = board.groups
    .flatMap(g => g.targets)
    .find(t => t.metricKey === key);
  if (!row) throw new Error(`no row for ${key}`);
  return row;
}

describe("every key the sheet has is the sheet's number", () => {
  test("the board's actual is the sheet's roll-up over the plan's days, for every column", () => {
    const sheet = buildSheet(november());
    const board = buildGoalsBoard({
      ...goals(SHEET_COLUMNS.map(c => target(c.key, 1))),
      sheet,
    });
    expect(board.pace?.through).toBe(DAY(4));
    for (const c of SHEET_COLUMNS) {
      const r = readRange(sheet, c.key, DAY(1), sheet.through);
      const row = rowOf(board, c.key);
      expect(row.source).toBe("measured");
      if (r?.value === null || r?.value === undefined) {
        expect(row.actual).toBeNull();
        expect(row.sourceText).toStartWith("Missing on the sheet");
        expect(board.measured[c.key]).toBeUndefined();
      } else {
        expect(row.actual as number).toBeCloseTo(r.value, 9);
        expect(board.measured[c.key] as number).toBeCloseTo(r.value, 9);
      }
      // The verdict is the sheet's Colour row: on pace exactly when green.
      if (r?.pace !== null && r?.pace !== undefined && row.actual !== null)
        expect(row.onPace).toBe(colourFor(c, r.pace, 1) === "green");
      expect(row.sourceText).not.toBe("Nothing recorded for this yet.");
    }
    // The invented month's own figures, worked by hand.
    expect(rowOf(board, "spend").actual).toBe(400);
    expect(rowOf(board, "cac").actual).toBe(440);
    expect(rowOf(board, "totalCash").actual).toBe(4300);
    expect(rowOf(board, "totalContracted").actual).toBe(7200);
    expect(rowOf(board, "upsells").actual).toBe(1);
    expect(rowOf(board, "googleReviews").actual).toBe(2);
    expect(rowOf(board, "mrrCollectionRate").actual).toBe(0.375);
    expect(rowOf(board, "software").actual).toBe(5000);
  });

  test("the catalogue reads no key the sheet has, and still reads the ladder's own", () => {
    const rich = {
      growth: { daily: NOV_DAYS } as never,
      money: {
        book: {
          month: "2026-11",
          projectedMrr: 9000,
          collected: 1500,
          collectionRate: 0.17,
          averageRetainer: 1500,
        },
        attribution: {
          transactions: [
            { day: DAY(1), direction: "in", side: "front_end", usd: 3000 },
            { day: DAY(2), direction: "out", usd: 50 },
          ],
        },
        mrr: { groups: [{ group: "active", cards: 16 }] },
      } as never,
      delivery: { daily: november().deliveryDaily } as never,
    };
    const read = scoreboard(rich, DAY(1), DAY(4));
    const sheetKeys = new Set([
      ...SHEET_COLUMNS.map(c => c.key),
      "callLeads",
      "callBookings",
      "backEndCash",
    ]);
    expect(Object.keys(read).filter(k => sheetKeys.has(k))).toEqual([]);
    expect(read).toMatchObject({
      bookableLeads: 8,
      aov: 6000,
      roasContracted: 15,
      activeClients: 16,
      averageRetainer: 1500,
      moneyOut: 50,
    });
  });

  test("the call centre's ladder and back-end cash are the sheet's parts", () => {
    const sheet = buildSheet(november());
    const board = buildGoalsBoard({
      ...goals([
        target("callLeads", 300),
        target("callBookings", 60),
        target("callLeadToBooking", 0.2),
        target("backEndCash", 5000),
      ]),
      sheet,
    });
    expect(board.measured.callLeads).toBe(30);
    expect(board.measured.callBookings).toBe(7);
    expect(rowOf(board, "callLeadToBooking").actual as number).toBeCloseTo(
      7 / 30,
      12,
    );
    // Every payment in (4,500) less the deal ledger's new cash (3,000).
    expect(rowOf(board, "backEndCash").actual).toBe(1500);
    expect(
      readRange(sheet, "totalCash", DAY(1), DAY(4))?.revenue?.parts.backEndCash,
    ).toBe(1500);
  });

  test("the catalogue still answers bookable leads, AOV, contracted ROAS, active clients and scorecards", () => {
    const board = buildGoalsBoard({
      ...goals([
        target("bookableLeads", 50),
        target("aov", 6000),
        target("roasContracted", 10),
        target("activeClients", 20),
        target("scorecardsDone", 5),
      ]),
      sheet: buildSheet(november()),
    });
    expect(board.measured).toMatchObject({
      bookableLeads: 8,
      aov: 6000,
      roasContracted: 15,
      activeClients: 16,
      scorecardsDone: 3,
    });
    expect(rowOf(board, "aov").sourceText).not.toContain("sheet");
  });
});

describe("pace and verdict are the sheet's", () => {
  test("a rate keeps its decimals and is judged as the sheet's Colour judges it", () => {
    const at = (shown: number, due: number) =>
      rowOf(
        buildGoalsBoard({
          ...goals([target("introShowRate", 0.36)]),
          sheet: buildSheet(
            november({
              growthDaily: [
                grow(DAY(1), { introsShown: shown, introsDue: due }),
                grow(DAY(2), { introsShown: 0, introsDue: 0 }),
              ],
            }),
          ),
        }),
        "introShowRate",
      );
    // 35.994%: two places would round it to 36% and call it on pace.
    const under = at(17997, 50000);
    expect(under.actual).toBe(0.35994);
    expect(under.onPace).toBe(false);
    // 35.9996% rounds to 36.00% on 4 decimals, but the sheet's Colour row
    // reads it yellow (0.99999 of the target), so the board says behind too
    // (2026-11-02 review: one verdict, never on pace here and yellow there).
    const nearly = at(89999, 250000);
    expect(nearly.actual).toBe(0.359996);
    expect(colourFor(COLUMN_BY_KEY.introShowRate, nearly.actual, 0.36)).toBe(
      "yellow",
    );
    expect(nearly.onPace).toBe(false);
    // Exactly on the line is green on both.
    const on = at(9, 25);
    expect(on.actual).toBe(0.36);
    expect(on.onPace).toBe(true);
  });

  test("the verdict is the sheet's Colour for every column, against real-looking targets", () => {
    const sheet = buildSheet(november());
    // Targets around each column's own pace: well past, on, a hair short, in
    // the yellow band and far off, for a number wanted up or down.
    const factors = [0.5, 0.95, 0.99999, 1, 1.00001, 1.05, 2];
    let judged = 0;
    for (const f of factors) {
      const targets: Record<string, unknown>[] = [];
      for (const c of SHEET_COLUMNS) {
        const pace = readRange(sheet, c.key, DAY(1), sheet.through)?.pace;
        if (pace === null || pace === undefined || pace === 0) continue;
        targets.push(target(c.key, pace * f));
      }
      const board = buildGoalsBoard({ ...goals(targets), sheet });
      for (const t of targets) {
        const key = String(t.metric_key);
        const pace = readRange(sheet, key, DAY(1), sheet.through)?.pace ?? null;
        const row = rowOf(board, key);
        const want =
          colourFor(COLUMN_BY_KEY[key], pace, Number(t.target)) === "green";
        expect(row.onPace).toBe(want);
        judged += 1;
      }
    }
    expect(judged).toBeGreaterThan(100);
  });

  test("a target of 0 or below follows the sheet's Colour, whatever it reads", () => {
    // Labour typed at 60,000: the month runs at a loss.
    const sheet = buildSheet(
      november({
        cells: [
          {
            day: DAY(1),
            key: "labour",
            kind: "actual",
            value: 60000,
            note: null,
            by: "ceo",
            at: "2026-11-01T08:00:00Z",
          },
        ],
      }),
    );
    const pace = readRange(sheet, "profit", DAY(1), DAY(4))?.pace ?? null;
    expect(pace as number).toBeLessThan(0);
    for (const value of [0, -50000, -500000]) {
      const row = rowOf(
        buildGoalsBoard({ ...goals([target("profit", value)]), sheet }),
        "profit",
      );
      expect(row.onPace).toBe(
        colourFor(COLUMN_BY_KEY.profit, pace, value) === "green",
      );
    }
  });

  test("overhead and labour are the month's, never paced by the days gone", () => {
    const board = buildGoalsBoard({
      ...goals([target("software", 5000), target("labour", 12000)]),
      sheet: buildSheet(november()),
    });
    for (const key of ["software", "labour"]) {
      const row = rowOf(board, key);
      expect(row.level).toBe(true);
      expect(row.pacedTarget).toBe(row.target);
      expect(row.onPace).toBe(true);
    }
  });

  test("profit and margin pace from their parts, as the sheet's Colour does", () => {
    const sheet = buildSheet(november());
    const rows = (profit: number, margin: number) => {
      const board = buildGoalsBoard({
        ...goals([target("profit", profit), target("margin", margin)]),
        sheet,
      });
      return [rowOf(board, "profit"), rowOf(board, "margin")];
    };
    // Revenue 4,300 less overhead 5,000, labour 12,000 and marketing 440.
    const [low, lowMargin] = rows(8000, 0.25);
    expect(low.actual).toBe(-13140);
    // The sheet's pace: revenue's 27,950 less 5,000, 12,000 and marketing's 2,860.
    const pace = readRange(sheet, "profit", DAY(1), DAY(4))?.pace ?? null;
    expect(pace as number).toBeCloseTo(8090, 6);
    expect(low.onPace).toBe(true);
    expect(lowMargin.onPace).toBe(true);
    const [high, highMargin] = rows(9000, 0.3);
    expect(high.onPace).toBe(false);
    // 910 short at the month's end is 140 short after 4 of 26 days.
    expect((high.pacedTarget as number) - (high.actual as number)).toBeCloseTo(
      140,
      6,
    );
    expect(highMargin.onPace).toBe(false);
    expect(colourFor(COLUMN_BY_KEY.profit, pace, 9000)).not.toBe("green");
  });
});

describe("missing is said, never zero", () => {
  test("a past month's MRR comes from the book's history, not blank", () => {
    const p = plan("2026-10-01", "2026-10-31", 2);
    const board = buildGoalsBoard({
      ...goals([target("mrrCollectionRate", 0.8)], {
        plan: p,
        plans: [p],
        today: "2026-11-02",
      }),
      sheet: buildSheet(october()),
    });
    expect(board.pace?.through).toBe("2026-10-31");
    const row = rowOf(board, "mrrCollectionRate");
    expect(row.actual as number).toBeCloseTo(800 / 3000, 12);
    expect(row.onPace).toBe(false);
  });

  test("Total profit with no labour typed says to type it, never $0", () => {
    const board = buildGoalsBoard({
      ...goals([target("profit", 20000), target("labour", 20000)]),
      sheet: buildSheet(november({ cells: [] })),
    });
    const profit = rowOf(board, "profit");
    expect(profit.actual).toBeNull();
    expect(profit.onPace).toBeNull();
    expect(profit.sourceText).toContain("type the month's labour");
    expect(rowOf(board, "labour").sourceText).toContain("Type the days");
    expect(board.measured.profit).toBeUndefined();
  });

  test("a rate over a count that is 0 names the count", () => {
    const board = buildGoalsBoard({
      ...goals([target("cac", 500)]),
      sheet: buildSheet(
        november({ growthDaily: NOV_DAYS.map(d => ({ ...d, closes: 0 })) }),
      ),
    });
    expect(rowOf(board, "cac").actual).toBeNull();
    expect(rowOf(board, "cac").sourceText).toBe(
      "Missing on the sheet: Closed deals is 0 on these days, so there is nothing to divide by yet.",
    );
  });

  test("an unread call centre report leaves the call rows missing, with what to do", () => {
    const board = buildGoalsBoard({
      ...goals([
        target("callLeads", 300),
        target("callLeadToBooking", 0.2),
        target("callShowRate", 0.6),
      ]),
      sheet: buildSheet(november({ callDaily: null })),
    });
    for (const key of ["callLeads", "callLeadToBooking", "callShowRate"]) {
      expect(rowOf(board, key).actual).toBeNull();
      expect(rowOf(board, key).sourceText).toContain(
        "the call centre report was not read",
      );
      expect(board.measured[key]).toBeUndefined();
    }
  });

  test("an older server reads as the sheet reads it: revenue missing with its reason", () => {
    const sheet = buildSheet(olderServer());
    const board = buildGoalsBoard({
      ...goals([target("totalCash", 50000), target("spend", 3900)]),
      sheet,
    });
    const revenue = rowOf(board, "totalCash");
    expect(revenue.actual).toBeNull();
    expect(revenue.sourceText).toContain("20261102m");
    expect(rowOf(board, "spend").actual).toBe(400);
  });

  test("with no sheet, every sheet key reads missing with the reason given", () => {
    const board = buildGoalsBoard({
      ...goals([target("spend", 3900), target("bookableLeads", 50)]),
      sheet: null,
      sheetWhy: "The Goals sheet could not be read (timeout).",
    });
    expect(rowOf(board, "spend")).toMatchObject({
      actual: null,
      source: "measured",
      onPace: null,
      sourceText: "The Goals sheet could not be read (timeout).",
    });
    expect(board.measured.spend).toBeUndefined();
    // The catalogue's own keys still read.
    expect(board.measured.bookableLeads).toBe(8);
  });
});

describe("an older key and a metric added on the sheet read the sheet too", () => {
  /** A target row stored under an older key, as the October plan holds it. */
  function older(
    key: string,
    group: string,
    label: string,
    unit: string,
    direction: string,
    value: number,
  ) {
    return {
      ...target(key, value),
      group_key: group,
      label,
      unit,
      direction,
    };
  }

  test("Client lead to booking and Software and overhead are the sheet's lead to booking and overhead", () => {
    const sheet = buildSheet(november());
    const board = buildGoalsBoard({
      ...goals([
        older(
          "clientLeadToBooking",
          "delivery",
          "Client lead to booking",
          "rate",
          "up",
          0.3,
        ),
        older(
          "overhead",
          "money",
          "Software and overhead",
          "usd",
          "down",
          6000,
        ),
      ]),
      sheet,
    });
    const lead = rowOf(board, "clientLeadToBooking");
    const calls = readRange(sheet, "callLeadToBooking", DAY(1), DAY(4));
    expect(lead.source).toBe("measured");
    expect(lead.actual as number).toBeCloseTo(7 / 30, 12);
    expect(lead.actual as number).toBeCloseTo(calls?.value as number, 9);
    expect(lead.sourceText).toBe(COLUMN_BY_KEY.callLeadToBooking.source);
    expect(lead.onPace).toBe(
      colourFor(COLUMN_BY_KEY.callLeadToBooking, calls?.pace ?? null, 0.3) ===
        "green",
    );
    const overhead = rowOf(board, "overhead");
    expect(overhead.actual).toBe(5000);
    expect(overhead.level).toBe(true);
    expect(overhead.pacedTarget).toBe(6000);
    expect(overhead.onPace).toBe(true);
    expect(overhead.sourceText).not.toBe("Nothing recorded for this yet.");
    // A copied plan's "Was" for them is what the board showed.
    expect(board.measured.clientLeadToBooking).toBe(lead.actual as number);
    expect(board.measured.overhead).toBe(5000);
    // The screen writes and names them from the sheet's own columns (the
    // sheet's copy, which carries this month's source line).
    expect(board.sheetColumns.clientLeadToBooking).toBe(
      sheet.columns.find(c => c.key === "callLeadToBooking"),
    );
    expect(board.sheetColumns.overhead).toMatchObject({
      key: "software",
      label: "Overhead expenses",
    });
  });

  test("an older key reads missing with the sheet's reason when the sheet has no number", () => {
    const board = buildGoalsBoard({
      ...goals([
        older(
          "clientLeadToBooking",
          "delivery",
          "Client lead to booking",
          "rate",
          "up",
          0.3,
        ),
      ]),
      sheet: buildSheet(november({ callDaily: null })),
    });
    const row = rowOf(board, "clientLeadToBooking");
    expect(row.actual).toBeNull();
    expect(row.sourceText).toContain("the call centre report was not read");
    expect(board.measured.clientLeadToBooking).toBeUndefined();
  });

  const REPLY = {
    key: "creply_rate",
    label: "Reply rate",
    section: "custom",
    unit: "rate",
    direction: "up",
    rollup: "avg",
    note: null,
  };
  const replyTarget = () => ({
    ...target("creply_rate", 0.4),
    group_key: "team",
    label: "Reply rate",
    unit: "rate",
    direction: "up",
  });
  const typed = (day: number, value: number) => ({
    day: DAY(day),
    key: "creply_rate",
    kind: "actual",
    value,
    note: null,
    by: "ceo",
    at: "2026-11-02T08:00:00Z",
  });

  test("a metric added on the sheet is the sheet's number, with its column handed to the screen", () => {
    const sheet = buildSheet(
      november({
        metrics: [REPLY],
        cells: [...november().cells, typed(1, 0.3), typed(2, 0.4188)],
      }),
    );
    const board = buildGoalsBoard({ ...goals([replyTarget()]), sheet });
    const row = rowOf(board, "creply_rate");
    const r = readRange(sheet, "creply_rate", DAY(1), DAY(4));
    expect(row.source).toBe("measured");
    expect(row.actual as number).toBeCloseTo(0.3594, 12);
    expect(row.actual as number).toBeCloseTo(r?.value as number, 9);
    expect(board.sheetColumns.creply_rate?.custom).toBe(true);
    expect(board.sheetColumns.creply_rate?.rollup).toEqual({
      kind: "avg",
      part: "creply_rate",
    });
    expect(row.onPace).toBe(
      colourFor(board.sheetColumns.creply_rate, r?.pace ?? null, 0.4) ===
        "green",
    );
  });

  test("with the sheet not read, a metric added on it says why, never 'Nothing recorded'", () => {
    const why =
      "The Goals sheet could not be read (timeout), so this reads missing. Reload the page to try again.";
    const board = buildGoalsBoard({
      ...goals([replyTarget(), target("hires", 2)]),
      sheet: null,
      sheetWhy: why,
    });
    expect(rowOf(board, "creply_rate")).toMatchObject({
      actual: null,
      source: "measured",
      onPace: null,
      sourceText: why,
    });
    // A catalogue key the sheet lacks still reads as the catalogue says.
    expect(rowOf(board, "hires").sourceText).toBe(
      "Nothing recorded for this yet.",
    );
    // A retired key is not taken for one added on the sheet.
    const retired = buildGoalsBoard({
      ...goals([{ ...target("videosPerDay", 5), group_key: "creative" }]),
      sheet: null,
      sheetWhy: why,
    });
    expect(rowOf(retired, "videosPerDay").sourceText).toBe(
      "Nothing recorded for this yet.",
    );
  });
});

// --- The client: the reads the board makes. ---

const ZERO = {
  dials: 0,
  providerDials: 0,
  connections: 0,
  talkSeconds: 0,
  leads: 0,
  leadsDialed: 0,
  leadsContacted: 0,
  noVerifiedDial: 0,
  confirmedBookings: 0,
  provisionalBookings: 0,
  unclassifiedBookings: 0,
  shows: 0,
  noShow: 0,
  closed: 0,
  values: [],
  showRate: null,
  closeRate: null,
  connectionRate: null,
  avgSpeedSeconds: null,
  medianSpeedSeconds: null,
  speedSamples: 0,
  withinTwoMinutes: 0,
  withinTwoMinutesRate: null,
  avgCallGapSeconds: null,
  callGapSamples: 0,
};

/** The call report the server would send for these days, invented. */
function report(from: string, to: string) {
  return {
    version: 1,
    generatedAt: "2026-11-05T03:00:00Z",
    timezone: "Asia/Kuwait",
    from,
    to,
    overall: { ...ZERO, leads: 30, confirmedBookings: 7 },
    callers: [],
    clients: [
      {
        ...ZERO,
        id: "a",
        name: "Made-up Clinic",
        leads: 20,
        confirmedBookings: 5,
      },
      {
        ...ZERO,
        id: "b",
        name: "Invented Homes",
        leads: 10,
        confirmedBookings: 2,
      },
    ],
    daily: (november().callDaily ?? [])
      .filter(d => d.day >= from && d.day <= to)
      .map(d => ({ ...ZERO, ...d })),
    coverage: {},
    warnings: [],
  };
}

function fakeClient(
  goalsContext: GoalContext,
  sheetAnswer: (month: string) => unknown = () => {
    const { callDaily: _c, ...ctx } = november();
    return ctx;
  },
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      switch (name) {
        case "cockpit_ceo_goals_context":
          return { data: goalsContext, error: null };
        case "cockpit_ceo_goal_sheet_context": {
          const data = sheetAnswer(String(args.p_month));
          return data instanceof Error
            ? { data: null, error: { message: data.message } }
            : { data, error: null };
        }
        case "cockpit_ceo_call_center_report":
          return {
            data: report(String(args.p_from), String(args.p_to)),
            error: null,
          };
        case "cockpit_ceo_goal_start_from":
          return {
            data: { id: 77, targets: goalsContext.targets.length },
            error: null,
          };
        default:
          return { data: null, error: { message: `Not answered: ${name}` } };
      }
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("readGoalsBoard reads the plan month's sheet", () => {
  const context = () =>
    goals([
      target("spend", 3900),
      target("callLeadToBooking", 0.2),
      target("totalCash", 50000),
    ]);

  test("the sheet reads its call report over its own days, the client list over the plan's", async () => {
    const { client, calls } = fakeClient(context());
    const board = await readGoalsBoard(client);
    const reports = calls
      .filter(c => c.name === "cockpit_ceo_call_center_report")
      .map(c => `${c.args.p_from}..${c.args.p_to}`)
      .sort();
    // The sheet's own (the month before to today) and the plan's days.
    expect(reports).toEqual([
      "2026-10-01..2026-11-05",
      "2026-11-01..2026-11-04",
    ]);
    expect(rowOf(board, "spend").actual).toBe(400);
    expect(rowOf(board, "totalCash").actual).toBe(4300);
    expect(rowOf(board, "callLeadToBooking").actual as number).toBeCloseTo(
      7 / 30,
      12,
    );
    expect(board.callClients?.map(c => c.name)).toEqual([
      "Made-up Clinic",
      "Invented Homes",
    ]);
    expect(board.calls?.month).toBe("2026-11");
  });

  test("the quiet re-read after a sheet save asks for no call report", async () => {
    const first = fakeClient(context());
    const board = await readGoalsBoard(first.client);
    const again = fakeClient(context());
    const next = await readGoalsBoard(again.client, { calls: board.calls });
    expect(
      again.calls.filter(c => c.name === "cockpit_ceo_call_center_report"),
    ).toEqual([]);
    expect(rowOf(next, "callLeadToBooking").actual).toBe(
      rowOf(board, "callLeadToBooking").actual,
    );
    expect(next.callClients).toEqual(board.callClients);
  });

  test("a sheet that cannot be read leaves its keys missing, with the reason and what to do", async () => {
    const { client } = fakeClient(
      context(),
      () => new Error("canceling statement due to statement timeout"),
    );
    const board = await readGoalsBoard(client);
    expect(rowOf(board, "spend").actual).toBeNull();
    expect(rowOf(board, "spend").sourceText).toBe(
      "The Goals sheet could not be read (canceling statement due to statement timeout), so this reads missing. Reload the page to try again.",
    );
  });

  test("a plan over two months and one not started say so", async () => {
    const spans = plan("2026-10-15", "2026-11-14");
    const two = fakeClient({ ...context(), plan: spans, plans: [spans] });
    const board = await readGoalsBoard(two.client);
    expect(rowOf(board, "spend").sourceText).toContain(
      "runs over more than one month",
    );
    const later = plan("2026-12-01", "2026-12-31");
    const { client, calls } = fakeClient({
      ...context(),
      plan: later,
      plans: [later],
    });
    const notYet = await readGoalsBoard(client);
    expect(rowOf(notYet, "spend").sourceText).toBe(
      "No day of this plan has ended yet: its first numbers come in the day after it starts.",
    );
    expect(calls.map(c => c.name)).not.toContain(
      "cockpit_ceo_goal_sheet_context",
    );
  });

  test("a copied plan's baselines are what the board showed", async () => {
    const { client, calls } = fakeClient(context());
    await copyGoalPlan(client, {
      fromPlanId: 6,
      periodFrom: "2026-12-01",
      periodTo: "2026-12-31",
      title: "December plan",
    });
    const sent = calls.find(c => c.name === "cockpit_ceo_goal_start_from")?.args
      .p_baselines as Record<string, number>;
    expect(sent.spend).toBe(400);
    expect(sent.totalCash).toBe(4300);
    expect(sent.callLeadToBooking).toBeCloseTo(7 / 30, 12);
  });
});

describe("the instalments owed on signed deals (2026-11-02, round 3)", () => {
  test("the board reads the book's on-deal MRR for the plan's own line, and the MRR rows stay back end only", () => {
    const sheet = buildSheet(november());
    const rows = [
      target("mrrProjected", 4000),
      target("mrrCollected", 3600),
      { ...target("onDealDue", 5000), group_key: "back_end" },
    ];
    const board = buildGoalsBoard({ ...goals(rows), sheet });
    expect(board.measured.onDealDue).toBe(5000);
    const line = rowOf(board, "onDealDue");
    expect(line.actual).toBe(5000);
    expect(line.source).toBe("measured");
    expect(line.groupKey).toBe("back_end");
    // The MRR rows are the sheet's back-end numbers, so target and actual mean one thing.
    expect(rowOf(board, "mrrProjected").actual).toBe(4000);
    expect(rowOf(board, "mrrCollected").actual).toBe(1500);
  });

  test("what clients owe is no performance: the line never joins the behind list", () => {
    const sheet = buildSheet(november());
    // Planned far above the book's 5,000, so its paced share is not met.
    const rows = [
      { ...target("onDealDue", 100000), group_key: "back_end" },
      target("leads", 100000),
    ];
    const board = buildGoalsBoard({ ...goals(rows), sheet });
    expect(rowOf(board, "onDealDue").onPace).toBe(false);
    const labels = board.behind.map(b => b.label);
    expect(labels).not.toContain("onDealDue");
    // A real metric behind still is.
    expect(rowOf(board, "leads").onPace).toBe(false);
    expect(labels).toContain(rowOf(board, "leads").label);
  });

  test("with no sheet read, nothing is said to be owed: the line reads nothing, never 0", () => {
    const board = buildGoalsBoard(
      goals([{ ...target("onDealDue", 5000), group_key: "back_end" }]),
    );
    expect(board.measured.onDealDue).toBeUndefined();
    expect(rowOf(board, "onDealDue").actual).toBeNull();
  });
});
