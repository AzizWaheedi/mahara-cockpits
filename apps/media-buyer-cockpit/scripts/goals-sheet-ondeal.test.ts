import { describe, expect, test } from "bun:test";
import type { SheetContext } from "../src/lib/ceoGoalSheetClient";
import {
  driversFromActuals,
  driversFromTargets,
  holdsOnDeal,
  MODEL_KEYS,
  modelTargets,
  ON_DEAL,
  project,
} from "../src/pages/ceo/goalsModel";
import {
  buildSheet,
  inputsFromTargets,
  savedRows,
  targetRows,
  targetsOf,
  withOnDeal,
} from "../src/pages/ceo/goalsSheetData";
import {
  COLUMN_BY_KEY,
  type PlanInputs,
  planNumbers,
  RETIRED_SHEET_KEYS,
  solveSpend,
  writesTarget,
} from "../src/pages/ceo/goalsSheetModel";

/**
 * The instalments owed on signed deals (round 3, 2026-11-02). Round 2 made
 * Projected MRR, MRR collected and Collections % back end only; a card still
 * on its closer-form deal pays an instalment the deal ledger counts in Cash
 * collected. So the plan holds those as their own input (`onDealDue`),
 * collected at the MRR collection rate inside Cash collected's target, and
 * they never move the lead-gen spend: no ad bought them. Every number here
 * is invented.
 */

const say = { money: String, count: String, pct: String };

/** A plan with a goal, so the spend is worked back from it. */
const PLAN: PlanInputs = {
  spend: null,
  cpl: 20,
  qualifiedShare: null,
  leadToBooked: 0.7,
  introShowRate: 0.6,
  introToDemo: 0.6,
  directDemos: 5,
  demoShowRate: 0.7,
  qualifiedDemoShare: null,
  closeRate: 0.2,
  aov: 5000,
  cashShare: 0.6,
  spendRetargeting: null,
  mrrDue: 4000,
  mrrCollectionRate: 0.9,
  onDealDue: 6000,
  upsellCash: 1500,
  refundAmount: 500,
  labour: 12000,
  overhead: 3000,
  otherMarketing: null,
  feeRate: null,
  callLeads: null,
  callLeadToBooking: null,
  clientCpl: null,
  goalCash: 40000,
  hammerShare: 0.1,
  cpc: 0.5,
  offerRate: 0.9,
};

/** The stored rows a plan's targets come back as, for targetsOf. */
function stored(
  rows: { metricKey: unknown; target: unknown; note?: unknown }[],
) {
  return {
    targets: rows.map((r, i) => ({
      id: i + 1,
      metric_key: r.metricKey,
      target: r.target,
      note: r.note ?? null,
    })),
  } as unknown as SheetContext;
}

describe("the on-deal part never goes on the funnel", () => {
  test("the funnel brings the goal less MRR collected, upsell cash and the instalments, plus refunds", () => {
    const { p } = planNumbers(PLAN);
    // 40,000 - 4,000 x 0.9 - 6,000 x 0.9 - 1,500 + 500 = 30,000 from new deals.
    expect(p.dealCash as number).toBeCloseTo(30000, 6);
    expect(p.onDealCash as number).toBeCloseTo(5400, 9);
    // The spend is the one that buys those deals, and nothing for the instalments.
    const alone = solveSpend({
      ...PLAN,
      goalCash: 30000,
      mrrDue: 0,
      onDealDue: null,
      upsellCash: null,
      refundAmount: null,
    }) as number;
    expect(solveSpend(PLAN) as number).toBeCloseTo(alone, 6);
    // Both plans meet the goal.
    expect(planNumbers(PLAN).byColumn.totalCash as number).toBeCloseTo(
      40000,
      6,
    );
    expect(
      planNumbers({ ...PLAN, onDealDue: null }).byColumn.totalCash as number,
    ).toBeCloseTo(40000, 6);
  });

  test("moving MRR from the back end to the deals leaves the spend where it was", () => {
    // The same 10,000 of cards, read on the whole book or split as round 2 reads it.
    const whole = solveSpend({ ...PLAN, mrrDue: 10000, onDealDue: null });
    const split = solveSpend({ ...PLAN, mrrDue: 4000, onDealDue: 6000 });
    expect(split as number).toBeCloseTo(whole as number, 9);
    // On the back end alone, with nothing on the deals, the funnel has to
    // find the 5,400 itself: that is the overstatement the input prevents.
    const backOnly = solveSpend({ ...PLAN, mrrDue: 4000, onDealDue: null });
    expect(backOnly as number).toBeGreaterThan(split as number);
  });
});

describe("the plan's money adds up", () => {
  test("Cash collected is the new deals' cash and the instalments at the MRR rate", () => {
    const { p, byColumn } = planNumbers(PLAN);
    expect(p.onDealCash as number).toBeCloseTo(6000 * 0.9, 9);
    expect(p.dealCash as number).toBeCloseTo((p.contracted as number) * 0.6, 9);
    expect(byColumn.newCash as number).toBeCloseTo(
      (p.dealCash as number) + 5400,
      9,
    );
    // MRR targets are back end only.
    expect(byColumn.mrrProjected).toBe(4000);
    expect(byColumn.mrrCollected as number).toBeCloseTo(3600, 9);
  });

  test("revenue is new cash (instalments in it), MRR collected and upsell cash, less refunds", () => {
    const { drivers, byColumn } = planNumbers(PLAN);
    const sum =
      (byColumn.newCash as number) +
      (byColumn.mrrCollected as number) +
      (byColumn.upsellCash as number) -
      500;
    expect(byColumn.totalCash as number).toBeCloseTo(sum, 6);
    // The Goals model's plan reads the same revenue from the same inputs.
    expect(project(drivers).totalCash as number).toBeCloseTo(
      byColumn.totalCash as number,
      6,
    );
    const costs =
      (byColumn.marketingExpenses as number) +
      (byColumn.labour as number) +
      (byColumn.software as number);
    expect(byColumn.profit as number).toBeCloseTo(40000 - costs, 6);
  });

  test("FE ROAS divides Cash collected, instalments in it, by the ad spend, as the actuals do", () => {
    const { byColumn } = planNumbers(PLAN);
    const ad =
      (byColumn.spend as number) + (byColumn.spendRetargeting as number);
    expect(byColumn.roasFrontEnd as number).toBeCloseTo(
      (byColumn.newCash as number) / ad,
      9,
    );
  });

  test("owed with no collection rate is not known: Cash collected and revenue are missing, never smaller", () => {
    const p = project({
      ...driversFromTargets({}),
      spend: 2000,
      cpl: 20,
      leadToBooked: 0.7,
      introShowRate: 0.6,
      introToDemo: 0.6,
      demoShowRate: 0.7,
      closeRate: 0.2,
      aov: 5000,
      cashShare: 0.6,
      mrrDue: 4000,
      mrrCollectionRate: null,
      onDealDue: 6000,
    });
    expect(p.dealCash).not.toBeNull();
    expect(p.onDealCash).toBeNull();
    expect(p.newCash).toBeNull();
    expect(p.totalCash).toBeNull();
  });

  test("with the funnel empty, the instalments stand on their own as the back end does", () => {
    const p = project({
      ...driversFromTargets({}),
      mrrDue: 4000,
      mrrCollectionRate: 0.9,
      onDealDue: 6000,
      upsellCash: 1000,
    });
    expect(p.newCash).toBeNull();
    expect(p.totalCash as number).toBeCloseTo(3600 + 5400 + 1000, 9);
  });
});

describe("an older plan without the line", () => {
  test("reads as not planned: its cash is the funnel's, nothing invented", () => {
    const old = { ...PLAN, onDealDue: null };
    const { p, byColumn } = planNumbers(old);
    expect(p.onDealCash).toBe(0);
    expect(byColumn.newCash as number).toBeCloseTo(p.dealCash as number, 9);
    // An input object from before the key existed reads the same.
    const { onDealDue: _, ...older } = PLAN;
    const legacy = planNumbers({ ...older, onDealDue: undefined } as never);
    expect(legacy.byColumn.newCash as number).toBeCloseTo(
      byColumn.newCash as number,
      9,
    );
    expect(solveSpend({ ...older } as never) as number).toBeCloseTo(
      solveSpend(old) as number,
      9,
    );
  });

  test("its stored targets read back with no instalments, and no row is written for them", () => {
    const rows = targetRows({ ...PLAN, onDealDue: null }, {}, say);
    expect(rows.some(r => r.metricKey === ON_DEAL.key)).toBe(false);
    const back = inputsFromTargets(targetsOf(stored(rows)));
    expect(back.onDealDue).toBeNull();
    // Cash collected's note says so instead of a number.
    expect(String(rows.find(r => r.metricKey === "newCash")?.note)).toContain(
      "Instalments owed on signed deals are not planned.",
    );
  });

  test("the Goals model reads its share of contracted from Cash collected as it always did", () => {
    const d = driversFromTargets({ newCash: 30000, contracted: 50000 });
    expect(d.onDealDue).toBeNull();
    expect(d.cashShare).toBeCloseTo(0.6, 9);
  });
});

describe("the line is stored and read back", () => {
  test("targetRows writes it under the back end with its own name, and inputsFromTargets reads it back", () => {
    const rows = targetRows(PLAN, {}, say);
    const row = rows.find(r => r.metricKey === ON_DEAL.key);
    expect(row).toMatchObject({
      groupKey: "back_end",
      label: "Instalments owed on signed deals",
      unit: "usd",
      target: 6000,
    });
    expect(String(row?.note)).toContain("collected as Cash collected");
    const newCash = rows.find(r => r.metricKey === "newCash");
    expect(String(newCash?.note)).toContain(
      "plus 0.9 of 6000 instalments owed on signed deals",
    );
    expect(String(rows.find(r => r.metricKey === "totalCash")?.note)).toContain(
      "of it instalments on signed deals",
    );
    // AOV and direct demos are stored rows of their own, as on a real plan.
    const back = inputsFromTargets(
      targetsOf(
        stored([
          ...rows,
          { metricKey: "aov", target: 5000 },
          { metricKey: "directDemos", target: 5 },
        ]),
      ),
    );
    expect(back.onDealDue).toBe(6000);
    expect(back.mrrDue).toBe(4000);
    // Read back, the plan works out the same numbers (targets are rounded).
    const again = planNumbers(back).byColumn;
    const first = planNumbers(PLAN).byColumn;
    expect(again.newCash as number).toBeCloseTo(first.newCash as number, -1);
    expect(again.spend as number).toBeCloseTo(first.spend as number, -1);
    expect(again.totalCash as number).toBeCloseTo(40000, 6);
  });

  test("a kept note wins over the line's own", () => {
    const rows = targetRows(PLAN, { onDealDue: "Typed on the sheet." }, say);
    expect(rows.find(r => r.metricKey === ON_DEAL.key)?.note).toBe(
      "Typed on the sheet.",
    );
  });

  test("it is no column of the sheet, is kept off the board, and the model never writes it", () => {
    expect(COLUMN_BY_KEY[ON_DEAL.key]).toBeUndefined();
    expect(RETIRED_SHEET_KEYS.has(ON_DEAL.key)).toBe(true);
    expect(MODEL_KEYS.has(ON_DEAL.key)).toBe(false);
    const d = driversFromTargets({ onDealDue: 6000, mrrCollectionRate: 0.9 });
    expect(
      modelTargets(d, project(d), say).some(t => t.key === "onDealDue"),
    ).toBe(false);
    // Columns that write a target are unchanged by it.
    expect(
      Object.values(COLUMN_BY_KEY).filter(writesTarget).length,
    ).toBeGreaterThan(0);
  });

  test("the Goals model takes the share of contracted net of the instalments", () => {
    const d = driversFromTargets({
      newCash: 30000 + 5400,
      contracted: 50000,
      onDealDue: 6000,
      mrrCollectionRate: 0.9,
    });
    expect(d.onDealDue).toBe(6000);
    expect(d.cashShare).toBeCloseTo(0.6, 9);
    // A stored share is taken as it is.
    expect(
      driversFromTargets({ cashShare: 0.75, newCash: 1, contracted: 2 })
        .cashShare,
    ).toBe(0.75);
  });

  test("what happened: the book's instalments and the month's own deals' share, never Cash collected over contracted", () => {
    const fallback = driversFromTargets({ cashShare: 0.5, onDealDue: 100 });
    const d = driversFromActuals(
      { newCash: 9000, contracted: 10000, cashShare: 0.55, onDealDue: 7000 },
      0.5,
      fallback,
    );
    // A book number is the month's, never grown by the share of days.
    expect(d.onDealDue).toBe(7000);
    expect(d.cashShare).toBe(0.55);
    // No measured share: the plan's own stands.
    const none = driversFromActuals(
      { newCash: 9000, contracted: 10000 },
      0.5,
      fallback,
    );
    expect(none.cashShare).toBe(0.5);
    expect(none.onDealDue).toBe(100);
  });
});

describe("the sheet says where the instalments are counted and planned", () => {
  /** November with a book that leaves 7,000 out on deals, and a plan. */
  function nov(targets: Record<string, unknown>[], plan: unknown = { id: 6 }) {
    return {
      today: "2026-11-05",
      month: "2026-11",
      plan,
      plans: [],
      targets,
      metrics: [],
      cells: [],
      growthDaily: [],
      windows: [],
      cashDaily: [],
      book: {
        month: "2026-11",
        projectedMrr: 9000,
        collected: 0,
        collectedBackEnd: 0,
        projectedExisting: 2000,
        projectedOnDeals: 7000,
        history: [],
      },
      refundsMonthly: [],
      bankThrough: null,
      deliveryDaily: [],
      mediaDaily: [],
      clientDaily: [],
      churned: [],
      churnMonths: [],
      softwareMonthly: null,
      lockin: [],
      locked: null,
    } as unknown as SheetContext;
  }
  const source = (ctx: SheetContext, key: string) =>
    buildSheet(ctx).columns.find(c => c.key === key)?.source ?? "";

  test("the book's on-deal MRR is a month fact, for Plan next month's box", () => {
    expect(buildSheet(nov([])).facts.onDealDue).toBe(7000);
  });

  test("a plan with the line: MRR and Cash collected name it", () => {
    const ctx = nov([{ id: 1, metric_key: "onDealDue", target: 6500 }]);
    expect(source(ctx, "mrrProjected")).toContain("$7,000 of MRR");
    expect(source(ctx, "mrrProjected")).toContain(
      "this month's plan counts $6,500 of them there, as instalments owed on signed deals",
    );
    expect(source(ctx, "newCash")).toContain(
      "puts the instalments owed on signed deals, $6,500, in its target",
    );
    expect(source(ctx, "totalNewCash")).toContain("$6,500");
  });

  test("a plan without it, its MRR target above the back end: the line names that target and no more", () => {
    const ctx = nov([{ id: 1, metric_key: "mrrProjected", target: 9000 }]);
    expect(source(ctx, "mrrCollected")).toContain(
      "This month's plan does not plan them on a line of their own. Its Projected MRR target, $9,000, is above the book's back end, $2,000, so these columns read harder than they are.",
    );
    // What a typed Cash collected target was meant to hold is not guessed.
    expect(source(ctx, "newCash")).toContain(
      "This month $7,000 of MRR is still on its deal, and this month's plan does not plan those instalments on a line of their own.",
    );
    expect(source(ctx, "newCash")).not.toContain("leaves");
  });

  test("a plan with no MRR target, or one on the back end, is not said to read harder", () => {
    for (const targets of [
      [],
      [{ id: 1, metric_key: "mrrProjected", target: 2000 }],
      [{ id: 2, metric_key: "onDealDue", target: null }],
    ]) {
      const s = source(nov(targets), "mrrProjected");
      expect(s).toContain(
        "This month's plan does not plan them on a line of their own.",
      );
      expect(s).not.toContain("harder");
    }
  });

  test("no plan for the month: where they are counted, and no word on a plan", () => {
    const ctx = nov([], null);
    expect(source(ctx, "mrrProjected")).toContain(
      "Their instalments are counted in Cash collected.",
    );
    expect(source(ctx, "mrrProjected")).not.toContain("this month's plan");
    expect(source(ctx, "newCash")).toContain(
      "This month $7,000 of MRR is still on its deal.",
    );
  });

  test("the spend columns say Meta's day is the ad account's own, not Kuwait's", () => {
    for (const k of ["spend", "spendRetargeting"]) {
      const s = COLUMN_BY_KEY[k].source;
      expect(s).toContain("the ad account's own day, Los Angeles time");
      expect(s).toContain("not Kuwait's");
    }
    expect(COLUMN_BY_KEY.uniqueLinkClicks.source).toContain(
      "the ad account's own Los Angeles day",
    );
  });
});

describe("a Projected MRR target that holds the instalments already (review, 2026-11-02)", () => {
  /** A plan written on the whole book: 10,000 of MRR due, 4,000 of it the back end. */
  const WHOLE: PlanInputs = { ...PLAN, mrrDue: 10000, onDealDue: null };
  const BACK_END = 4000;
  const SAY = {
    money: (v: number) => `$${Math.round(v)}`,
    count: (v: number) => String(Math.round(v)),
    pct: (v: number) => `${Math.round(v * 100)}%`,
  };
  /**
   * The plan's stored rows, AOV and direct demos with them as on a real plan,
   * and some set by hand: a number (null keeps the plan's) and a note.
   */
  function plan(
    inputs: PlanInputs,
    by: Record<string, [number | null, string]>,
  ) {
    const rows: { metricKey: unknown; target: unknown; note?: unknown }[] = [
      ...targetRows(inputs, {}, SAY).map(r => ({ ...r })),
      { metricKey: "aov", target: inputs.aov },
      { metricKey: "directDemos", target: inputs.directDemos },
    ];
    for (const [k, [target, note]] of Object.entries(by)) {
      const hit = rows.find(r => r.metricKey === k);
      if (hit) Object.assign(hit, { target: target ?? hit.target, note });
      else rows.push({ metricKey: k, target, note });
    }
    return targetsOf(stored(rows));
  }

  test("holdsOnDeal: above the back end by at least the instalments, and only with the book", () => {
    expect(holdsOnDeal(10000, 4000, 6000)).toBe(true);
    expect(holdsOnDeal(10000, 4000, 5000)).toBe(true);
    expect(holdsOnDeal(9000, 4000, 6000)).toBe(false);
    expect(holdsOnDeal(4000, 4000, 6000)).toBe(false);
    expect(holdsOnDeal(10000, null, 6000)).toBe(false);
    expect(holdsOnDeal(10000, 4000, 0)).toBe(false);
    expect(holdsOnDeal(null, 4000, 6000)).toBe(false);
  });

  test("saving them takes them out of MRR due, so the spend and revenue stay", () => {
    const { next, moved } = withOnDeal(
      { ...WHOLE, onDealDue: 6000 },
      6000,
      BACK_END,
    );
    expect(moved).toBe(6000);
    expect(next.mrrDue).toBe(4000);
    expect(next.onDealDue).toBe(6000);
    expect(solveSpend(next) as number).toBeCloseTo(
      solveSpend(WHOLE) as number,
      9,
    );
    const a = planNumbers(next).byColumn;
    const b = planNumbers(WHOLE).byColumn;
    expect(a.totalCash as number).toBeCloseTo(b.totalCash as number, 9);
    // The cash moves from MRR collected into Cash collected, 5,400 of it.
    expect((a.newCash as number) - (b.newCash as number)).toBeCloseTo(5400, 9);
    expect((b.mrrCollected as number) - (a.mrrCollected as number)).toBeCloseTo(
      5400,
      9,
    );
    expect(a.mrrProjected).toBe(4000);
  });

  test("on a back-end target nothing moves: the instalments are cash the funnel no longer has to find", () => {
    const back = { ...PLAN, onDealDue: null };
    const { next, moved } = withOnDeal(
      { ...back, onDealDue: 6000 },
      6000,
      BACK_END,
    );
    expect(moved).toBeNull();
    expect(next.mrrDue).toBe(4000);
    expect(solveSpend(next) as number).toBeLessThan(solveSpend(back) as number);
    // Not known without the book's back end: nothing is moved on a guess.
    expect(withOnDeal({ ...WHOLE, onDealDue: 6000 }, 6000, null).moved).toBe(
      null,
    );
  });

  test("a plan holding them in both saves once more and counts them once", () => {
    const both = { ...WHOLE, onDealDue: 6000 };
    const { next, moved } = withOnDeal(both, 6000, BACK_END);
    expect(moved).toBe(6000);
    expect(next.mrrDue).toBe(4000);
    // Counted twice, the funnel was asked for 5,400 too little.
    expect(solveSpend(next) as number).toBeGreaterThan(
      solveSpend(both) as number,
    );
    expect(solveSpend(next) as number).toBeCloseTo(
      solveSpend(WHOLE) as number,
      9,
    );
  });

  test("the save writes only what moves: no spend row, a total typed by hand stays", () => {
    const now = plan(WHOLE, {
      totalContracted: [99999, "Typed by hand."],
      spend: [null, "His own spend note."],
    });
    const before = inputsFromTargets(now);
    const { next } = withOnDeal({ ...before, onDealDue: 6000 }, 6000, BACK_END);
    const rows = savedRows(
      before,
      next,
      now,
      { onDealDue: "Typed on the sheet.", mrrProjected: "The back end." },
      SAY,
    );
    const keys = rows.map(r => r.metricKey).sort();
    expect(keys).toEqual(
      [
        "mrrCollected",
        "mrrProjected",
        "newCash",
        "onDealDue",
        "roasFrontEnd",
        "totalCash",
      ].sort(),
    );
    const row = (k: string) => rows.find(r => r.metricKey === k);
    expect(row("onDealDue")).toMatchObject({
      target: 6000,
      note: "Typed on the sheet.",
    });
    expect(row("mrrProjected")).toMatchObject({
      target: 4000,
      note: "The back end.",
    });
    // The revenue's number stands; only its sentence, the model's own, follows.
    expect(row("totalCash")?.target).toBe(now.totalCash.value);
    expect(String(row("totalCash")?.note)).toContain(
      "of it instalments on signed deals",
    );
    // The rows it leaves alone are not sent: his total and his spend note stand.
    expect(row("totalContracted")).toBeUndefined();
    expect(row("spend")).toBeUndefined();
    expect(now.spend.note).toBe("His own spend note.");
  });

  test("a moved row's old sentence gives way; a hand note stays while its number does", () => {
    const now = plan(
      { ...PLAN, mrrDue: 4000, onDealDue: 6000 },
      { totalCash: [40000, "Your goal."] },
    );
    const before = inputsFromTargets(now);
    const next = { ...before, onDealDue: 3000 };
    const rows = savedRows(before, next, now, { onDealDue: "Typed." }, SAY);
    const row = (k: string) => rows.find(r => r.metricKey === k);
    // Not on the whole book: fewer instalments, so the funnel finds more.
    expect(row("spend")?.target as number).toBeGreaterThan(now.spend.value);
    expect(String(row("newCash")?.note)).toContain("of $3000 instalments");
    expect(String(row("roasFrontEnd")?.note)).toContain(
      `$${Math.round(planNumbers(next).byColumn.newCash as number)} over`,
    );
    // The goal and his note on it stand, so its row is not sent at all.
    expect(row("totalCash")).toBeUndefined();
    // Every row sent says what its number now is: none keeps a sentence about 6000.
    for (const r of rows) expect(String(r.note)).not.toContain("$6000");
  });

  test("revenue adds up after the move, and project() agrees", () => {
    const { next } = withOnDeal({ ...WHOLE, onDealDue: 6000 }, 6000, BACK_END);
    const { p, byColumn } = planNumbers(next);
    expect(byColumn.totalCash as number).toBeCloseTo(
      (byColumn.newCash as number) +
        (byColumn.mrrCollected as number) +
        (byColumn.upsellCash as number) -
        (byColumn.refundAmount as number),
      9,
    );
    expect(p.totalCash as number).toBeCloseTo(byColumn.totalCash as number, 9);
    expect(byColumn.totalCash as number).toBeCloseTo(40000, 6);
  });
});
