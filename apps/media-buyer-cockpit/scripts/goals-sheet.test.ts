import { describe, expect, test } from "bun:test";
import type { SheetContext } from "../src/lib/ceoGoalSheetClient";
import { project } from "../src/pages/ceo/goalsModel";
import {
  buildSheet,
  inputsFromTargets,
  rowsOf,
  targetRows,
  targetsOf,
} from "../src/pages/ceo/goalsSheetData";
import {
  allColumns,
  COLUMN_BY_KEY,
  colourFor,
  daysOfMonth,
  evenDailyPlan,
  isLevel,
  isWorkingDay,
  onPaceFor,
  type PlanInputs,
  planNumbers,
  rollUp,
  SHEET_COLUMNS,
  solveSpend,
  withComputed,
} from "../src/pages/ceo/goalsSheetModel";

const NOVEMBER: PlanInputs = {
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

const say = { money: String, count: String, pct: String };

describe("the plan works back from the money", () => {
  test("the spend it finds collects the goal when run forward", () => {
    const spend = solveSpend(NOVEMBER) as number;
    const p = project({ ...NOVEMBER, spend });
    expect(p.totalCash as number).toBeCloseTo(43300, 6);
    expect(p.closes as number).toBeCloseTo(10.1, 1);
  });

  test("demos with no held intro are planned on their own line", () => {
    const { p } = planNumbers(NOVEMBER);
    const fromIntros = (p.introsShown as number) * 0.52;
    expect(p.demosBooked as number).toBeCloseTo(fromIntros + 17, 6);
  });

  test("the $15 gate at 25% lead to booking is the $60 gate", () => {
    expect(planNumbers(NOVEMBER).byColumn.clientCpb).toBeCloseTo(60, 6);
  });

  test("an empty rung leaves the spend empty, never zero", () => {
    expect(solveSpend({ ...NOVEMBER, closeRate: null })).toBeNull();
    expect(solveSpend({ ...NOVEMBER, goalCash: null })).toBeNull();
  });

  test("a goal the back end already covers asks for no spend", () => {
    expect(solveSpend({ ...NOVEMBER, goalCash: 8000, directDemos: 100 })).toBe(
      0,
    );
  });

  test("with no goal, the typed spend runs forward", () => {
    const { byColumn } = planNumbers({
      ...NOVEMBER,
      goalCash: null,
      spend: 3000,
    });
    expect(byColumn.spend).toBe(3000);
    expect(byColumn.leads).toBe(200);
  });

  test("profit is the plan's cash less its three expense lines", () => {
    const { byColumn } = planNumbers(NOVEMBER);
    const out = (byColumn.marketingExpenses as number) + 14840 + 5325;
    expect(byColumn.profit as number).toBeCloseTo(43300 - out, 6);
  });

  test("target rows are the catalogue's keys and read back to the same plan", () => {
    const rows = targetRows(NOVEMBER, {}, say);
    const keys = rows.map(r => r.metricKey as string);
    expect(keys).toContain("spend");
    expect(keys).toContain("totalCash");
    for (const k of keys) expect(COLUMN_BY_KEY[k]).toBeDefined();
    const ctx = {
      targets: rows.map((r, i) => ({
        id: i + 1,
        metric_key: r.metricKey,
        target: r.target,
        note: r.note,
      })),
    } as unknown as SheetContext;
    const back = inputsFromTargets(targetsOf(ctx));
    expect(back.goalCash).toBe(43300);
    expect(back.cpl).toBe(15);
    expect(back.directDemos).toBe(17);
    expect(back.overhead).toBe(5325);
  });
});

describe("a column over a run of days", () => {
  const leads = COLUMN_BY_KEY.leads;
  const cpl = COLUMN_BY_KEY.cpl;

  test("a rate divides the totals, it never averages the days", () => {
    const rows = [
      { spend: 100, leads: 1 },
      { spend: 100, leads: 9 },
    ];
    // The mean of $100 and $11.11 would read $55.56.
    expect(rollUp(cpl, rows, 2)).toBe(20);
  });

  test("a part nobody recorded is missing, never zero", () => {
    expect(rollUp(leads, [{}, {}], 2)).toBeNull();
    expect(rollUp(cpl, [{ spend: 100 }], 1)).toBeNull();
    expect(rollUp(leads, [{ leads: 0 }], 1)).toBe(0);
  });

  test("a month's fact wins over its days", () => {
    const clicks = COLUMN_BY_KEY.uniqueLinkClicks;
    expect(
      rollUp(clicks, [{ uniqueLinkClicks: 5 }], 1, { uniqueLinkClicks: 2639 }),
    ).toBe(2639);
  });

  test("a per-day metric is the total over the working days", () => {
    const scripts = COLUMN_BY_KEY.scriptsPerDay;
    expect(rollUp(scripts, [{ scripts: 12 }, { scripts: 7 }], 26)).toBeCloseTo(
      19 / 26,
      6,
    );
  });

  test("profit with no payroll is missing, not bigger", () => {
    const profit = COLUMN_BY_KEY.profit;
    const parts = [{ totalCash: 1000, spend: 100, software: 50 }];
    expect(rollUp(profit, parts, 1)).toBeNull();
    expect(rollUp(profit, [{ ...parts[0], labour: 300 }], 1)).toBe(550);
  });

  test("show rate on the call centre counts only marked appointments", () => {
    const show = COLUMN_BY_KEY.callShowRate;
    const row = withComputed({ callShows: 27, callNoShows: 43 });
    expect(rollUp(show, [row], 1)).toBeCloseTo(27 / 70, 6);
  });
});

describe("pace and colour", () => {
  test("a count paces over working days; a rate is judged whole", () => {
    expect(onPaceFor(COLUMN_BY_KEY.leads, 50, 13, 26)).toBe(100);
    expect(onPaceFor(COLUMN_BY_KEY.cpl, 18, 13, 26)).toBe(18);
    expect(isLevel(COLUMN_BY_KEY.scriptsPerDay)).toBe(true);
    expect(isLevel(COLUMN_BY_KEY.totalContracted)).toBe(false);
  });

  test("on the line is green, within a tenth yellow, further red", () => {
    const leads = COLUMN_BY_KEY.leads;
    expect(colourFor(leads, 100, 100)).toBe("green");
    expect(colourFor(leads, 95, 100)).toBe("yellow");
    expect(colourFor(leads, 80, 100)).toBe("red");
    const cpl = COLUMN_BY_KEY.cpl;
    expect(colourFor(cpl, 12, 15)).toBe("green");
    expect(colourFor(cpl, 16, 15)).toBe("yellow");
    expect(colourFor(cpl, 26.67, 15)).toBe("red");
    expect(colourFor(leads, null, 100)).toBeNull();
    expect(colourFor(leads, 100, null)).toBeNull();
  });

  test("a day's even plan skips Friday and is empty with no target", () => {
    const leads = COLUMN_BY_KEY.leads;
    expect(isWorkingDay("2026-11-06")).toBe(false);
    expect(evenDailyPlan(leads, 260, "2026-11-06", 26)).toBeNull();
    expect(evenDailyPlan(leads, 260, "2026-11-07", 26)).toBe(10);
    expect(evenDailyPlan(leads, null, "2026-11-07", 26)).toBeNull();
    expect(evenDailyPlan(COLUMN_BY_KEY.cpl, 15, "2026-11-07", 26)).toBeNull();
  });
});

describe("his outline is all there", () => {
  const outline = {
    sales_marketing: [
      "Hammer Them ad spend",
      "Lead gen ad spend",
      "Unique link clicks",
      "CPC",
      "Landing page conversion",
      "Leads",
      "CPL",
      "L2B",
      "Intro calls",
      "Cost per intro",
      "Intros showed",
      "Intro show rate",
      "Cost per live intro",
      "Demo calls",
      "Cost per demo",
      "Intro to demo %",
      "Demos showed",
      "Demo show rate",
      "Cost per live demo",
      "Offers made",
      "Offer %",
      "Closed deals",
      "Close rate %",
      "Cash collected",
      "Contracted rev",
      "UF cash %",
      "AOV",
      "FE ROAS",
      "Contracted ROAS",
      "CAC",
    ],
    client_success: [
      "Clients churned",
      "Churn rate",
      "Projected MRR",
      "MRR collection",
      "Client extensions given",
      "Upsells",
      "Upsells cash",
      "Refunds",
      "Refund amount",
      "Referrals",
      "Testimonials",
      "Reviews",
    ],
    sales_x_cs: ["Total new cash", "Total contracted"],
    finances: [
      "Marketing expenses",
      "Labour expenses",
      "Software expenses",
      "Total profit",
      "Margin %",
    ],
    client_media: ["CPM", "Link CTR", "Opt in %", "CPL", "CPB"],
    call_center: [
      "Lead to booking",
      "Show rate %",
      "Avg lead quality",
      "Close rate %",
    ],
    creative: [
      "Scripts per day",
      "New angles tested",
      "Videos per day",
      "Revision per video",
    ],
  } as const;

  for (const [section, labels] of Object.entries(outline)) {
    test(`${section} has every line`, () => {
      const have = SHEET_COLUMNS.filter(c => c.section === section).map(
        c => c.label,
      );
      for (const l of labels) expect(have).toContain(l);
    });
  }

  test("every key is unique, and a day can only be typed where it adds up", () => {
    const keys = SHEET_COLUMNS.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of SHEET_COLUMNS) {
      if (c.rollup.kind === "ratio") expect(c.editable).toBe(false);
    }
  });

  test("a metric he adds lands at the end of its section", () => {
    const cols = allColumns([
      {
        key: "ccases",
        label: "Case studies",
        section: "client_success",
        unit: "count",
        direction: "up",
        rollup: "sum",
        note: null,
      },
    ]);
    const success = cols.filter(c => c.section === "client_success");
    expect(success[success.length - 1].key).toBe("ccases");
  });
});

describe("the tab", () => {
  const ctx = {
    today: "2026-10-30",
    month: "2026-10",
    plan: null,
    plans: [],
    targets: [],
    metrics: [],
    cells: [
      { day: "2026-10-05", key: "leads", kind: "actual", value: 9 },
      { day: "2026-10-05", key: "leads", kind: "plan", value: 4 },
    ],
    growthDaily: [
      { date: "2026-10-05", leads: 3, spend: 30, frontEndPaid: 500 },
      { date: "2026-10-06", leads: 2, spend: 20, frontEndPaid: 0 },
      { date: "2026-09-30", leads: 7, spend: 70, frontEndPaid: 0 },
    ],
    windows: [
      { from: "2026-10-01", raw: { link_clicks: 2639, intros_advanced: 10 } },
      { from: "2026-09-01", raw: { link_clicks: 1768, intros_advanced: 9 } },
    ],
    cashDaily: [{ date: "2026-10-05", usd: 500 }],
    book: {
      month: "2026-10",
      projectedMrr: 14999,
      collected: 7321.2,
      history: [{ month: "2026-09", projected: 14332, collected: 4068 }],
    },
    refundsMonthly: [{ month: "2026-10", refunds: 0 }],
    bankThrough: "2026-10-02",
    deliveryDaily: [],
    mediaDaily: [],
    clientDaily: [],
    churned: [
      { leftOn: "2026-10-22", client: "Alkhalil", reason: "Cancelled" },
    ],
    churnMonths: [{ month: "2026-10", activeAtStart: 20 }],
    softwareMonthly: 5325,
    lockin: [],
    locked: null,
    callDaily: null,
  } as unknown as SheetContext;
  const sheet = buildSheet(ctx);

  test("a typed cell wins for its day; the plan is apart", () => {
    expect(rowsOf(sheet, ["2026-10-05"])[0].leads).toBe(9);
    expect(rowsOf(sheet, ["2026-10-06"])[0].leads).toBe(2);
    expect(rowsOf(sheet, ["2026-10-05"], "plan")[0].leads).toBe(4);
  });

  test("the month's facts come from their own month", () => {
    expect(sheet.facts.uniqueLinkClicks).toBe(2639);
    expect(sheet.prevFacts.uniqueLinkClicks).toBe(1768);
    expect(sheet.facts.mrrProjected).toBe(14999);
    expect(sheet.prevFacts.mrrProjected).toBe(14332);
    expect(sheet.facts.clientsChurned).toBe(1);
    expect(sheet.facts.clientsAtStart).toBe(20);
  });

  test("numbers run to yesterday and pace counts working days", () => {
    expect(sheet.through).toBe("2026-10-29");
    expect(daysOfMonth("2026-10").length).toBe(31);
    expect(sheet.workingDays).toBe(26);
    expect(sheet.workedSoFar).toBe(25);
  });

  test("a month that has not started has no numbers to pace", () => {
    const next = buildSheet({ ...ctx, month: "2026-11" });
    expect(next.through).toBeNull();
    expect(next.workedSoFar).toBe(0);
  });
});
