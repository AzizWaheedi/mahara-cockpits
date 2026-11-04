import { describe, expect, test } from "bun:test";
import type { SheetContext } from "../src/lib/ceoGoalSheetClient";
import { project } from "../src/pages/ceo/goalsModel";
import {
  buildSheet,
  cellKey,
  inputKeyOf,
  isWorkedOut,
  rowsOf,
  targetRows,
} from "../src/pages/ceo/goalsSheetData";
import {
  ADDABLE_SECTIONS,
  allColumns,
  boardLabelOf,
  COLUMN_BY_KEY,
  dayRow,
  onPaceFor,
  type PlanInputs,
  paceFor,
  planNumbers,
  RETIRED_SHEET_KEYS,
  revenueOf,
  rollUp,
  SHEET_COLUMNS,
  SHEET_SECTIONS,
  type SheetColumn,
  sectionOf,
  solveSpend,
  storedSection,
  targetKeyOf,
  unknownFlag,
  withComputed,
  writesTarget,
} from "../src/pages/ceo/goalsSheetModel";

/**
 * The sheet's columns since 2026-11-02: his NOV 2026 tab's metrics, Total
 * revenue by his rule, Total new cash as a mirror of Cash collected, unique
 * link clicks by day, the calls due, one creative count, and the retired
 * metrics kept off the sheet and out of the plan rows it writes.
 */

const C = COLUMN_BY_KEY;
const say = { money: String, count: String, pct: String };

const PLAN: PlanInputs = {
  spend: null,
  cpl: 15,
  qualifiedShare: null,
  leadToBooked: 0.6,
  introShowRate: 0.5,
  introToDemo: 0.52,
  directDemos: 17,
  demoShowRate: 0.65,
  qualifiedDemoShare: null,
  closeRate: 0.3,
  aov: 6000,
  cashShare: 0.56,
  spendRetargeting: null,
  mrrDue: 11333,
  mrrCollectionRate: 0.65,
  upsellCash: 2000,
  refundAmount: null,
  labour: 14840,
  overhead: 5325,
  otherMarketing: null,
  feeRate: null,
  callLeads: null,
  callLeadToBooking: 0.25,
  clientCpl: 15,
  goalCash: 43300,
  hammerShare: 0.126,
  cpc: 0.576,
  offerRate: 0.9,
};

/** October with made-up numbers, in the shape the server sends. */
function october(over: Partial<SheetContext> = {}): SheetContext {
  return {
    today: "2026-10-30",
    month: "2026-10",
    plan: null,
    plans: [],
    targets: [],
    metrics: [],
    cells: [],
    growthDaily: [
      {
        date: "2026-10-05",
        spend: 30,
        leads: 3,
        uniqueLinkClicks: 100,
        introsDue: 4,
        introsShown: 2,
        demosDue: 2,
        demosShown: 1,
        frontEndPaid: 500,
      },
      {
        date: "2026-10-06",
        spend: 20,
        leads: 2,
        uniqueLinkClicks: 50,
        introsDue: 6,
        introsShown: 3,
        demosDue: 1,
        demosShown: 1,
        frontEndPaid: 0,
      },
      // Meta gave no unique count for a lead-gen ad that spent: unknown.
      { date: "2026-10-07", spend: 10, uniqueLinkClicks: null },
      // September's days do not carry it: the release was not live.
      { date: "2026-09-30", spend: 70, leads: 7, frontEndPaid: 0 },
    ],
    windows: [
      { from: "2026-10-01", raw: { link_clicks: 2639, intros_advanced: 10 } },
      { from: "2026-09-01", raw: { link_clicks: 1768, intros_advanced: 9 } },
    ],
    cashDaily: [{ date: "2026-10-05", usd: 900 }],
    book: {
      month: "2026-10",
      projectedMrr: 14999,
      collected: 7321.2,
      history: [{ month: "2026-09", projected: 14332, collected: 4068 }],
    },
    refundsMonthly: [
      { month: "2026-10", refunds: 300 },
      { month: "2026-09", refunds: 0 },
    ],
    bankThrough: "2026-10-02",
    deliveryDaily: [],
    mediaDaily: [],
    clientDaily: [],
    churned: [],
    churnMonths: [],
    softwareMonthly: 5325,
    lockin: [],
    locked: null,
    callDaily: null,
    ...over,
  } as unknown as SheetContext;
}

/** The month so far, as the screen reads it: the days through yesterday with the month's facts. */
function monthOf(ctx: SheetContext) {
  const sheet = buildSheet(ctx);
  const upTo = sheet.days.filter(d => d <= (sheet.through as string));
  const rows = rowsOf(sheet, upTo);
  const facts = withComputed(sheet.facts);
  const at = (c: SheetColumn) => rollUp(c, rows, sheet.workedSoFar, facts);
  return { sheet, rows, facts, at };
}

describe("total revenue (2026-11-02, round 2)", () => {
  const revenue = C.totalCash;
  /** A day as buildSheet writes it: the ledger's new cash, the money in, the hand-logged refunds. */
  const day = (newCash: number, cashIn: number, refundsManual = 0) => ({
    newCash,
    newCashMeasured: newCash,
    cashIn,
    refundsManual,
  });

  test("is new cash plus back-end cash, less hand-logged refunds: the money in, upsells and MRR not added again", () => {
    // Back-end cash over the run is every payment in less the ledger's new
    // cash, so a typed upsell cash or the book's MRR never adds again.
    const days = [
      day(2000, 2000),
      { ...day(5500, 10500, 500), upsellCash: 1000, mrrCollected: 4000 },
    ];
    expect(rollUp(revenue, days, 2)).toBe(12000);
    const r = revenueOf(days, 2);
    expect(r.parts).toEqual({
      newCash: 7500,
      backEndCash: 5000,
      refundsManual: 500,
    });
    expect(r.cashIn).toBe(12500);
    expect(r.missing).toEqual([]);
  });

  test("a part not read leaves revenue missing, never smaller", () => {
    const flagged = { ...day(1000, 1300), [unknownFlag("refundsManual")]: 1 };
    delete (flagged as Record<string, unknown>).refundsManual;
    const r = revenueOf([day(2000, 2000), flagged], 2);
    expect(r.value).toBeNull();
    expect(r.missing).toEqual(["refunds logged by hand"]);
    const noCash = {
      newCash: 500,
      [unknownFlag("cashIn")]: 1,
      refundsManual: 0,
    };
    expect(rollUp(revenue, [noCash], 1)).toBeNull();
    // A month's hand-logged refunds, given whole, complete it.
    expect(
      rollUp(revenue, [day(2000, 2000), flagged], 2, { refundsManual: 100 }),
    ).toBe(3200);
  });

  test("new cash above the money in is said, never set to 0", () => {
    const r = revenueOf([day(3000, 2500)], 1);
    expect(r.parts.backEndCash).toBe(-500);
    expect(r.value).toBe(2500);
    expect(r.notes[0]).toContain("more than every payment in");
    expect(r.notes[0]).toContain("it is not set to 0");
  });

  test("a Cash collected typed over the ledger moves revenue by what it changed", () => {
    const typed = dayRow({ ...day(1000, 1500) }, { newCash: 1600 });
    expect(rollUp(revenue, [typed], 1)).toBe(2100);
    expect(revenueOf([typed], 1).parts.backEndCash).toBe(500);
  });

  test("profit and margin use this revenue", () => {
    const days = [
      { ...day(7500, 12500, 500), spend: 900, spendRetargeting: 100 },
      { ...day(0, 0), labour: 3000 },
    ];
    const facts = { software: 1000 };
    // 12,000 revenue less 1,000 overhead, 3,000 labour and 1,000 marketing.
    expect(rollUp(C.profit, days, 2, facts)).toBe(7000);
    expect(rollUp(C.margin, days, 2, facts)).toBeCloseTo(7000 / 12000, 9);
    expect(rollUp(C.profit, days, 2, { software: null })).toBeNull();
  });

  test("total contracted is the closer form plus upsells contracted, both needed", () => {
    expect(
      rollUp(C.totalContracted, [{ contracted: 6000, upsellContracted: 0 }], 1),
    ).toBe(6000);
    expect(
      rollUp(
        C.totalContracted,
        [{ contracted: 6000, upsellContracted: 1500, upsellCash: 700 }],
        1,
      ),
    ).toBe(7500);
    // Upsell cash is not a contract: it never stands in for the quoted price.
    const notRead = { contracted: 6000, [unknownFlag("upsellContracted")]: 1 };
    expect(rollUp(C.totalContracted, [notRead], 1)).toBeNull();
    // 0 upsells signed that day is 0 upsells contracted, typed or read.
    expect(
      rollUp(C.totalContracted, [dayRow(notRead, { upsells: 0 })], 1),
    ).toBe(6000);
  });
});

describe("on pace for adds up across the business totals", () => {
  // Half the month worked: 13 of 26 working days.
  const rows = [
    {
      newCash: 13000,
      newCashMeasured: 13000,
      cashIn: 14300,
      refundsManual: 260,
      labour: 20000,
      spend: 2600,
    },
  ];
  const facts = withComputed({ software: 5000 });
  const pace = (c: SheetColumn) => paceFor(c, rows, 13, 26, facts);

  test("revenue paces like a count, as on his sheet", () => {
    expect(pace(C.newCash)).toBe(26000);
    expect(pace(C.totalCash)).toBe(2 * (14300 - 260));
    expect(pace(C.totalCash)).toBe(
      onPaceFor(C.totalCash, rollUp(C.totalCash, rows, 13, facts), 13, 26),
    );
  });

  test("profit counts overhead and labour once, and margin divides the paces", () => {
    const revenue = 2 * (14300 - 260);
    const profit = revenue - (5000 + 20000 + 5200);
    expect(pace(C.profit)).toBe(profit);
    expect(pace(C.margin)).toBeCloseTo(profit / revenue, 9);
    // Stretching the month's payroll and overhead too would read far worse.
    const actual = rollUp(C.profit, rows, 13, facts) as number;
    expect(onPaceFor(C.profit, actual, 13, 26)).toBeLessThan(profit);
  });

  test("every other column paces as before, and missing stays missing", () => {
    expect(pace(C.spend)).toBe(onPaceFor(C.spend, 2600, 13, 26));
    expect(pace(C.leads)).toBeNull();
    const noRefunds = [
      {
        ...rows[0],
        refundsManual: undefined,
        [unknownFlag("refundsManual")]: 1,
      },
    ];
    expect(paceFor(C.totalCash, noRefunds, 13, 26, facts)).toBeNull();
    expect(paceFor(C.profit, noRefunds, 13, 26, facts)).toBeNull();
  });
});

describe("total new cash mirrors cash collected", () => {
  const mirror = C.totalNewCash;

  test("same actual, same target, and a typed day types cash collected", () => {
    expect(targetKeyOf(mirror)).toBe("newCash");
    expect(targetKeyOf(C.newCash)).toBe("newCash");
    expect(cellKey(mirror)).toBe("newCash");
    expect(mirror.editable).toBe(true);
    const rows = [dayRow({ newCash: 500 }, { newCash: 650 }), { newCash: 40 }];
    expect(rollUp(mirror, rows, 2)).toBe(690);
    expect(rollUp(mirror, rows, 2)).toBe(rollUp(C.newCash, rows, 2));
    const { at } = monthOf(october());
    expect(at(mirror)).toBe(at(C.newCash));
  });

  test("its target is read-only here and never written under its own key", () => {
    expect(isWorkedOut(mirror, PLAN)).toBe(true);
    expect(inputKeyOf(mirror)).toBeNull();
    const keys = targetRows(PLAN, {}, say).map(r => r.metricKey);
    expect(keys).not.toContain("totalNewCash");
    expect(keys).toContain("newCash");
  });
});

describe("unique link clicks fill in by day", () => {
  test("the days win once they carry it; the window is only the fallback", () => {
    // Every day counted (the day Meta gave no count for has its own test).
    const counted = october().growthDaily.filter(d => d.date !== "2026-10-07");
    const { sheet, at } = monthOf(october({ growthDaily: counted }));
    expect(sheet.facts.uniqueLinkClicks).toBeUndefined();
    expect(at(C.uniqueLinkClicks)).toBe(150);
    // CPC and LPC follow the days: 50 of spend and 5 leads over 150 clicks.
    expect(at(C.cpc)).toBeCloseTo(50 / 150, 9);
    expect(at(C.landingPageConversion)).toBeCloseTo(5 / 150, 9);
    // September's days carry none, so its whole-month window stands in.
    expect(sheet.prevFacts.uniqueLinkClicks).toBe(1768);
  });

  test("a day Meta gave no count for is not known: it and any run over it read missing, never smaller", () => {
    // Repair 2026-11-02: the run used to read 150 clicks under 60 of spend,
    // CPC 0.40 where the counted days say 0.33, coloured against its target.
    const { sheet, at } = monthOf(october());
    const run = (days: string[], c: SheetColumn) =>
      rollUp(c, rowsOf(sheet, days), days.length);
    expect(run(["2026-10-05"], C.uniqueLinkClicks)).toBe(100);
    expect(run(["2026-10-07"], C.uniqueLinkClicks)).toBeNull();
    expect(run(["2026-10-07"], C.cpc)).toBeNull();
    expect(at(C.uniqueLinkClicks)).toBeNull();
    expect(at(C.cpc)).toBeNull();
    expect(at(C.landingPageConversion)).toBeNull();
    // Its spend still counts as spend: only the click measures wait.
    expect(at(C.spend)).toBe(60);
    // A run that does not reach it still reads.
    expect(run(["2026-10-05", "2026-10-06"], C.cpc)).toBeCloseTo(50 / 150, 9);
    expect(sheet.dayWhy["2026-10-07"].uniqueLinkClicks).toContain(
      "Meta gave no unique count",
    );
    // A typed day replaces it, as any read number.
    const typed = buildSheet(
      october({
        cells: [
          {
            day: "2026-10-07",
            key: "uniqueLinkClicks",
            kind: "actual",
            value: 20,
            note: null,
            by: "ceo",
            at: "x",
          },
        ],
      } as Partial<SheetContext>),
    );
    expect(
      rollUp(
        C.uniqueLinkClicks,
        rowsOf(typed, ["2026-10-05", "2026-10-06", "2026-10-07"]),
        3,
      ),
    ).toBe(170);
  });

  test("the month in progress whose days hold only nulls says they were not read, not that they wait on the release", () => {
    const nulls = october().growthDaily.map(d =>
      d.date.startsWith("2026-10") ? { ...d, uniqueLinkClicks: null } : d,
    );
    const { sheet, at } = monthOf(october({ growthDaily: nulls }));
    expect(at(C.uniqueLinkClicks)).toBeNull();
    expect(sheet.monthWhy["2026-10"].uniqueLinkClicks).toContain(
      "Meta gave no unique count",
    );
    expect(sheet.monthWhy["2026-10"].uniqueLinkClicks).not.toContain("release");
  });

  test("an ended month whose days lack it reads the window; the month in progress waits", () => {
    const ctx = october();
    const bare = ctx.growthDaily.map(d => {
      const { uniqueLinkClicks: _, ...rest } = d;
      return rest;
    });
    // On 2 Nov October has ended: B2B's whole-month window stands in.
    const ended = monthOf(october({ today: "2026-11-02", growthDaily: bare }));
    expect(ended.sheet.facts.uniqueLinkClicks).toBe(2639);
    expect(ended.at(C.uniqueLinkClicks)).toBe(2639);
    // Days with only nulls do not count as carrying it either.
    const nulls = ctx.growthDaily.map(d => ({ ...d, uniqueLinkClicks: null }));
    expect(
      buildSheet(october({ today: "2026-11-02", growthDaily: nulls })).facts
        .uniqueLinkClicks,
    ).toBe(2639);
    // On 30 Oct the window runs to today and the days to yesterday, so it
    // read CPC $0.40 against $0.59 (round 1's defect): missing, with the reason.
    const running = monthOf(october({ growthDaily: bare }));
    expect(running.sheet.facts.uniqueLinkClicks).toBeUndefined();
    expect(running.at(C.uniqueLinkClicks)).toBeNull();
    expect(running.at(C.cpc)).toBeNull();
    expect(running.sheet.monthWhy["2026-10"].uniqueLinkClicks).toContain(
      "wait on the CEO refresh release",
    );
  });
});

describe("calls scheduled for the day", () => {
  test("intro and demo calls due add up, and the show rates divide by them", () => {
    const { at } = monthOf(october());
    expect(at(C.introsDue)).toBe(10);
    expect(at(C.introShowRate)).toBeCloseTo(5 / 10, 9);
    expect(at(C.demosDue)).toBe(3);
    expect(at(C.demoShowRate)).toBeCloseTo(2 / 3, 9);
    expect(C.introsDue.editable).toBe(true);
    expect(cellKey(C.introsDue)).toBe("introsDue");
  });

  test("the plan's calls due are its calls booked", () => {
    const { byColumn } = planNumbers(PLAN);
    expect(byColumn.introsDue).toBe(byColumn.introsBooked);
    expect(byColumn.demosDue).toBe(byColumn.demosBooked);
    expect(isWorkedOut(C.introsDue, PLAN)).toBe(true);
  });
});

describe("videos completed", () => {
  test("carries the videos already typed and adds the days up", () => {
    const cells = [
      { day: "2026-10-10", key: "videos", kind: "actual", value: 5 },
      { day: "2026-10-12", key: "videos", kind: "actual", value: 3 },
      { day: "2026-10-12", key: "videos", kind: "plan", value: 9 },
    ];
    const { sheet, at } = monthOf(october({ cells } as never));
    const videos = C.videosCompleted;
    expect(cellKey(videos)).toBe("videos");
    expect(videos.editable).toBe(true);
    expect(at(videos)).toBe(8);
    expect(rollUp(videos, rowsOf(sheet, ["2026-10-10"]), 1)).toBe(5);
    expect(rollUp(videos, rowsOf(sheet, ["2026-10-11"]), 1)).toBeNull();
    // Its target is typed: nothing in the plan works it out.
    expect(isWorkedOut(videos, PLAN)).toBe(false);
  });
});

describe("retired metrics", () => {
  test("are not columns, and no plan row is written for them", () => {
    for (const k of RETIRED_SHEET_KEYS) {
      expect(C[k]).toBeUndefined();
      expect(allColumns([]).some(c => c.key === k)).toBe(false);
    }
    const keys = targetRows(PLAN, {}, say).map(r => r.metricKey as string);
    for (const k of keys) {
      expect(RETIRED_SHEET_KEYS.has(k)).toBe(false);
      expect(C[k]).toBeDefined();
    }
  });

  test("AOV and direct demos still drive the plan from their stored targets", () => {
    const spend = solveSpend(PLAN) as number;
    expect(spend).toBeGreaterThan(0);
    expect(solveSpend({ ...PLAN, aov: null })).toBeNull();
    // More demos straight from a lead need less spend for the same goal.
    expect(solveSpend({ ...PLAN, directDemos: 25 }) as number).toBeLessThan(
      spend,
    );
    expect(planNumbers(PLAN).byColumn.directDemos).toBe(17);
  });
});

describe("the plan's revenue follows the same rule", () => {
  test("its revenue is new cash, upsell cash and MRR collected, less refunds", () => {
    const { byColumn } = planNumbers({ ...PLAN, refundAmount: 1000 });
    const sum =
      (byColumn.newCash as number) +
      (byColumn.upsellCash as number) +
      (byColumn.mrrCollected as number) -
      1000;
    expect(byColumn.totalCash as number).toBeCloseTo(sum, 6);
    // The goal holds: the spend covers the refunds too.
    expect(byColumn.totalCash as number).toBeCloseTo(43300, 6);
    const without = planNumbers(PLAN).byColumn;
    expect(byColumn.newCash as number).toBeCloseTo(
      (without.newCash as number) + 1000,
      6,
    );
    const costs =
      (byColumn.marketingExpenses as number) +
      (byColumn.labour as number) +
      (byColumn.software as number);
    expect(byColumn.profit as number).toBeCloseTo(43300 - costs, 6);
    expect(byColumn.margin as number).toBeCloseTo((43300 - costs) / 43300, 9);
  });

  test("a plan with no MRR to collect has no revenue, not a smaller one", () => {
    const { byColumn } = planNumbers({
      ...PLAN,
      goalCash: null,
      spend: 3000,
      mrrDue: null,
    });
    expect(byColumn.newCash).not.toBeNull();
    expect(byColumn.totalCash).toBeNull();
    expect(byColumn.profit).toBeNull();
    expect(byColumn.margin).toBeNull();
  });

  test("refunds amount is a plan input; its row and the revenue note say so", () => {
    expect(inputKeyOf(C.refundAmount)).toBe("refundAmount");
    expect(isWorkedOut(C.refundAmount, PLAN)).toBe(false);
    const rows = targetRows({ ...PLAN, refundAmount: 1000 }, {}, say);
    const row = (k: string) => rows.find(r => r.metricKey === k);
    expect(row("refundAmount")?.target).toBe(1000);
    expect(row("refundAmount")?.groupKey).toBe("back_end");
    expect(String(row("totalCash")?.note)).toContain("less 1000 refunds");
    expect(row("totalCash")?.groupKey).toBe("money");
    // A kept note wins over the worked-out one.
    const kept = targetRows(PLAN, { totalCash: "Your goal." }, say);
    expect(kept.find(r => r.metricKey === "totalCash")?.note).toBe(
      "Your goal.",
    );
  });

  test("every row goes under its section's group", () => {
    for (const r of targetRows(PLAN, {}, say)) {
      const c = SHEET_COLUMNS.find(x => x.key === r.metricKey) as SheetColumn;
      const want =
        c.section === "business_totals"
          ? "money"
          : ["collections", "customer_success"].includes(c.section)
            ? "back_end"
            : ["lead_gen", "intro_calls", "demo_calls"].includes(c.section)
              ? "front_end"
              : r.groupKey;
      expect(r.groupKey).toBe(want);
    }
  });
});

describe("a metric added under an old section", () => {
  test("lands where that section now ends", () => {
    expect(sectionOf("sales_marketing")).toBe("demo_calls");
    expect(sectionOf("client_success")).toBe("customer_success");
    expect(sectionOf("sales_x_cs")).toBe("business_totals");
    expect(sectionOf("finances")).toBe("business_totals");
    expect(sectionOf("lead_gen")).toBe("lead_gen");
    expect(sectionOf("nothing")).toBe("custom");
    const sheet = buildSheet(
      october({
        metrics: [
          {
            key: "ccases",
            label: "Case studies",
            section: "client_success",
            unit: "count",
            direction: "up",
            rollup: "sum",
            note: null,
          },
        ],
      }),
    );
    const success = sheet.columns.filter(c => c.section === "customer_success");
    expect(success[success.length - 1].key).toBe("ccases");
  });
});

describe("a metric added now", () => {
  test("is saved under a section the stored CHECK allows, and comes back where it was put", () => {
    // cockpit_goal_sheet_metrics.section allows only the keys from before
    // 2026-11-02 until a migration widens it.
    const allowed = new Set([
      "sales_marketing",
      "client_success",
      "sales_x_cs",
      "finances",
      "client_media",
      "call_center",
      "creative",
      "custom",
    ]);
    for (const s of SHEET_SECTIONS)
      expect(allowed.has(storedSection(s.key))).toBe(true);
    for (const s of ADDABLE_SECTIONS)
      expect(sectionOf(storedSection(s.key))).toBe(s.key);
    // Lead gen and intro calls would come back under demo calls: not offered.
    expect(ADDABLE_SECTIONS.map(s => s.key)).toEqual([
      "demo_calls",
      "customer_success",
      "business_totals",
      "client_media",
      "call_center",
      "creative",
      "custom",
    ]);
  });
});

describe("the plan's target rows read right on the board", () => {
  test("no two rows share a name, in a group or across the plan", () => {
    const rows = targetRows({ ...PLAN, refundAmount: 500 }, {}, say);
    const inGroup = rows.map(
      r => `${r.groupKey}|${String(r.label).toLowerCase()}`,
    );
    expect(new Set(inGroup).size).toBe(inGroup.length);
    // The board's "Behind on ..." sentence names rows with no group.
    const names = SHEET_COLUMNS.filter(writesTarget).map(c =>
      boardLabelOf(c).toLowerCase(),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  test("the calls keep the names their stored rows already have", () => {
    const rows = targetRows(PLAN, {}, say);
    const label = (k: string) => rows.find(r => r.metricKey === k)?.label;
    expect(label("introsShown")).toBe("Intros showed");
    expect(label("demosShown")).toBe("Demos showed");
    expect(label("introShowRate")).toBe("Intro show rate");
    expect(label("demoShowRate")).toBe("Demo show rate");
    expect(label("spend")).toBe("Lead gen ad spend");
    expect(label("totalCash")).toBe("Total revenue (with AR)");
    // On the sheet the section header says which; the label stays his.
    expect(C.introsShown.label).toBe("Showed calls");
  });
});

describe("the Goals board's plan and the sheet's plan read one revenue", () => {
  test("refunds come off both, so the board's goal re-solves to its own spend", () => {
    const inputs = { ...PLAN, goalCash: null, spend: 3000, refundAmount: 1000 };
    const { drivers, byColumn } = planNumbers(inputs);
    const board = project(drivers);
    expect(board.totalCash as number).toBeCloseTo(
      byColumn.totalCash as number,
      6,
    );
    // Plan next month writes that total as the goal and carries the refunds:
    // typing anything on the sheet then solves back to the same spend.
    const again = solveSpend({ ...inputs, goalCash: board.totalCash });
    expect(again as number).toBeCloseTo(3000, 6);
  });
});
