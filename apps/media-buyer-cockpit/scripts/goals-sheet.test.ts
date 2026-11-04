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
  fixedHintOf,
  isLevel,
  isWorkingDay,
  onPaceFor,
  type PlanInputs,
  planNumbers,
  rollUp,
  SHEET_COLUMNS,
  SHEET_SECTIONS,
  type SheetColumn,
  solveSpend,
  withComputed,
} from "../src/pages/ceo/goalsSheetModel";

// A per-working-day column. None is on his sheet since 2026-11-02 (Scripts per
// day retired), but the rollup stays for a metric he adds.
const PER_DAY: SheetColumn = {
  key: "scriptsPerDay",
  label: "Scripts per day",
  section: "custom",
  unit: "count",
  direction: "up",
  rollup: { kind: "perWorkingDay", part: "scripts" },
  editable: true,
  source: "Typed.",
};

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
    // AOV and direct demos are off the sheet (2026-11-02): their stored rows
    // stay on the plan untouched and still feed it.
    const kept = [
      { metric_key: "directDemos", target: 17, note: null },
      { metric_key: "aov", target: 6000, note: null },
    ];
    const ctx = {
      targets: [
        ...rows.map(r => ({
          metric_key: r.metricKey,
          target: r.target,
          note: r.note,
        })),
        ...kept,
      ].map((t, i) => ({ id: i + 1, ...t })),
    } as unknown as SheetContext;
    const back = inputsFromTargets(targetsOf(ctx));
    expect(back.goalCash).toBe(43300);
    expect(back.cpl).toBe(15);
    expect(back.directDemos).toBe(17);
    expect(back.aov).toBe(6000);
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
    expect(rollUp(PER_DAY, [{ scripts: 12 }, { scripts: 7 }], 26)).toBeCloseTo(
      19 / 26,
      6,
    );
  });

  test("profit with no payroll is missing, not bigger", () => {
    const profit = COLUMN_BY_KEY.profit;
    // 2026-11-02: revenue is the money in (1,400) less the refunds logged by hand.
    const days = [
      {
        newCash: 1000,
        newCashMeasured: 1000,
        cashIn: 1400,
        refundsManual: 0,
        spend: 100,
      },
    ];
    const facts = { software: 50 };
    expect(rollUp(profit, days, 1, facts)).toBeNull();
    // Revenue 1,400 less overhead 50, labour 300 and marketing 100.
    expect(rollUp(profit, [{ ...days[0], labour: 300 }], 1, facts)).toBe(950);
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
    expect(isLevel(PER_DAY)).toBe(true);
    expect(isLevel(COLUMN_BY_KEY.totalContracted)).toBe(false);
    expect(isLevel(COLUMN_BY_KEY.totalCash)).toBe(false);
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
  // His NOV 2026 tab (2026-11-02), plus customer success's four extra lines,
  // the cockpit's client media buying and call center, and one creative count.
  const outline: Record<string, [string, string][]> = {
    lead_gen: [
      ["spendRetargeting", "Hammer Them ad spend"],
      ["spend", "Ad spend"],
      ["uniqueLinkClicks", "Unique link clicks"],
      ["cpc", "CPC"],
      ["landingPageConversion", "LPC (lead per click)"],
      ["leads", "Leads"],
      ["cpl", "CPL"],
      ["leadToBooked", "L2B %"],
    ],
    intro_calls: [
      ["introsBooked", "Intro calls booked"],
      ["costPerIntroBooked", "Cost per intro call"],
      ["introsDue", "Intro calls scheduled for the day"],
      ["introsShown", "Showed calls"],
      ["introShowRate", "Show rate %"],
      ["costPerIntroShown", "Cost per live intro call"],
    ],
    demo_calls: [
      ["demosBooked", "Demo calls booked"],
      ["costPerDemoBooked", "Cost per demo call"],
      ["introToDemo", "Intro to demo %"],
      ["demosDue", "Demo calls scheduled for the day"],
      ["demosShown", "Showed calls"],
      ["demoShowRate", "Show rate %"],
      ["costPerDemoShown", "Cost per live demo"],
      ["offersMade", "Offers made"],
      ["offerRate", "Offer %"],
      ["closes", "Closed deals"],
      ["closeRate", "Close rate %"],
      ["newCash", "Cash collected"],
      ["contracted", "Contracted revenue"],
      ["cashShare", "UF cash %"],
      ["roasFrontEnd", "FE ROAS"],
      ["cac", "CPA"],
    ],
    collections: [
      ["mrrProjected", "Projected MRR to collect"],
      ["mrrCollected", "MRR collected"],
      ["mrrCollectionRate", "Collections %"],
    ],
    customer_success: [
      ["clientsChurned", "Clients churned"],
      ["upsells", "Upsells"],
      ["upsellCash", "Upsell cash"],
      ["refunds", "Refunds"],
      ["refundAmount", "Refunds amount"],
      ["extensionsGiven", "Extensions given"],
      ["referrals", "Referrals"],
      ["testimonials", "Testimonials"],
      ["googleReviews", "Reviews"],
    ],
    business_totals: [
      ["totalNewCash", "Total new cash"],
      ["totalCash", "Total revenue (with AR)"],
      ["totalContracted", "Total contracted"],
      ["software", "Overhead expenses"],
      ["labour", "Labour expenses"],
      ["marketingExpenses", "Marketing expenses"],
      ["profit", "Total profit"],
      ["margin", "Margin %"],
    ],
    client_media: [
      ["clientCpm", "CPM"],
      ["clientLinkCtr", "Link CTR"],
      ["clientOptIn", "Opt in %"],
      ["clientCpl", "CPL"],
      ["clientCpb", "CPB"],
    ],
    call_center: [
      ["callLeadToBooking", "Lead to booking"],
      ["callShowRate", "Show rate %"],
      ["callLeadQuality", "Avg lead quality"],
      ["callCloseRate", "Close rate %"],
    ],
    creative: [["videosCompleted", "Videos completed"]],
  };

  test("the sections are his, in his order", () => {
    expect(SHEET_SECTIONS.map(s => s.key)).toEqual([
      ...Object.keys(outline),
      "custom",
    ]);
  });

  for (const [section, lines] of Object.entries(outline)) {
    test(`${section} has exactly his lines, in order`, () => {
      const have = SHEET_COLUMNS.filter(c => c.section === section).map(c => [
        c.key,
        c.label,
      ]);
      expect(have).toEqual(lines);
    });
  }

  test("nothing else is on the sheet", () => {
    expect(SHEET_COLUMNS.map(c => c.key)).toEqual(
      Object.values(outline).flatMap(l => l.map(([k]) => k)),
    );
  });

  test("a metric keeps the target group its stored rows are under", () => {
    const group = (key: string) =>
      SHEET_SECTIONS.find(s => s.key === COLUMN_BY_KEY[key].section)?.group;
    for (const k of ["spend", "uniqueLinkClicks", "introsBooked", "cac"])
      expect(group(k)).toBe("front_end");
    for (const k of ["mrrProjected", "mrrCollected", "upsellCash", "refunds"])
      expect(group(k)).toBe("back_end");
    for (const k of ["totalCash", "totalContracted", "software", "profit"])
      expect(group(k)).toBe("money");
    expect(group("clientCpb")).toBe("delivery");
    expect(group("callShowRate")).toBe("calls");
    expect(group("videosCompleted")).toBe("creative");
  });

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
        section: "customer_success",
        unit: "count",
        direction: "up",
        rollup: "sum",
        note: null,
      },
    ]);
    const success = cols.filter(c => c.section === "customer_success");
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
    // October is the month in progress here (today is 30 Oct): its window runs
    // to today and its days to yesterday, so it never stands in (2026-11-02).
    expect(sheet.facts.uniqueLinkClicks).toBeUndefined();
    expect(sheet.monthWhy["2026-10"].uniqueLinkClicks).toContain(
      "wait on the CEO refresh release",
    );
    // September has ended: its whole-month window still stands in for its days.
    expect(sheet.prevFacts.uniqueLinkClicks).toBe(1768);
    // MRR is back end only: a book from before the release says why it is not used.
    expect(sheet.facts.mrrProjected).toBeUndefined();
    expect(sheet.monthWhy["2026-10"].mrrCollected).toContain(
      "holds new clients' first payments",
    );
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

describe("older plan keys and read-only columns (2026-11-02)", () => {
  test("an older plan's overhead and client lead to booking show on the sheet's columns", () => {
    // Made-up numbers in October's shape: the plan stores the older keys only.
    const older = [
      { id: 1, metric_key: "overhead", target: 6000, note: null },
      { id: 2, metric_key: "clientLeadToBooking", target: 0.3, note: null },
    ];
    const both = [
      ...older,
      { id: 3, metric_key: "software", target: 5000, note: null },
      { id: 4, metric_key: "callLeadToBooking", target: 0.4, note: null },
    ];
    const only = targetsOf({ targets: older } as unknown as SheetContext);
    expect(only.software?.value).toBe(6000);
    expect(only.callLeadToBooking?.value).toBe(0.3);
    // The sheet's own key wins when the plan has both.
    const mixed = targetsOf({ targets: both } as unknown as SheetContext);
    expect(mixed.software?.value).toBe(5000);
    expect(mixed.callLeadToBooking?.value).toBe(0.4);
  });

  test("a column that cannot be typed says why in its own words", () => {
    expect(fixedHintOf(COLUMN_BY_KEY.clientsChurned)).toContain(
      "churn register",
    );
    expect(fixedHintOf(COLUMN_BY_KEY.totalCash)).toContain(
      "Added up from its parts",
    );
    expect(fixedHintOf(COLUMN_BY_KEY.cpl)).toContain("divides");
  });
});
