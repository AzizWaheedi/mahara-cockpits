import { describe, expect, test } from "bun:test";
import {
  aTenthBetter,
  type Drivers,
  driversFromActuals,
  driversFromTargets,
  MODEL_KEYS,
  modelTargets,
  project,
  tidy,
} from "../src/pages/ceo/goalsModel";

// September 2026's plan, as Aziz wrote it.
const SEPTEMBER = {
  spend: 6600,
  spendRetargeting: 600,
  leads: 583,
  cpl: 10,
  bookableLeads: 397,
  introsBooked: 295,
  introShowRate: 0.6,
  introsShown: 177,
  demosBooked: 107,
  demoShowRate: 0.75,
  demosShown: 80,
  demosQualified: 78,
  closeRate: 0.25,
  closes: 20,
  contracted: 120000,
  aov: 6000,
  newCash: 59400,
  backEndCash: 16000,
  mrrCollectionRate: 1,
  upsellCash: 5000,
  totalCash: 80400,
  labour: 26260,
  overhead: 6000,
  processingFees: 3100,
  clientCpl: 15,
  clientLeadToBooking: 0.3,
};

const say = {
  money: (v: number) => `$${Math.round(v)}`,
  count: (v: number) => String(Math.round(v)),
  pct: (v: number) => `${Math.round(v * 100)}%`,
};

describe("the chain", () => {
  test("cost per lead turns ad spend into leads, and every count follows", () => {
    const d = driversFromTargets(SEPTEMBER);
    const p = project(d);
    // $6,600 at $10 a lead is 660, not the 583 typed into September.
    expect(p.leads).toBe(660);
    expect(tidy(p.introsBooked ?? 0, "count")).toBe(334);
    // 295 intros of 583 leads is the plan's own booking rate.
    expect(d.leadToBooked).toBeCloseTo(295 / 583, 6);
    expect(d.introToDemo).toBeCloseTo(107 / 177, 6);
    expect(p.closes).toBeCloseTo(
      660 * (295 / 583) * 0.6 * (107 / 177) * 0.75 * 0.25,
      6,
    );
    expect(p.contracted).toBeCloseTo((p.closes ?? 0) * 6000, 6);
    expect(p.newCash).toBeCloseTo((p.contracted ?? 0) * (59400 / 120000), 6);
  });

  test("the back end and the money add up the way the plan did", () => {
    const d = driversFromTargets(SEPTEMBER);
    expect(d.mrrDue).toBe(16000);
    expect(d.feeRate).toBeCloseTo(3100 / 80400, 9);
    const p = project({ ...d, spend: 6600, cpl: 6600 / 583 });
    // With September's own 583 leads the chain gives September's $80,400,
    // less the rounding the doc did: it wrote 80.25 live demos as 80, so
    // unrounded it is 20.06 clients and $80,586.
    expect(p.closes).toBeCloseTo(20.0625, 6);
    expect(p.totalCash).toBeCloseTo(80585.63, 1);
    expect(p.processingFees).toBeCloseTo(80585.63 * (3100 / 80400), 1);
    // Retargeting is money out too, which the doc's profit left out.
    expect(p.moneyOut).toBeCloseTo(
      6600 + 600 + 26260 + 6000 + (p.processingFees ?? 0),
      6,
    );
    expect(p.profit).toBeCloseTo((p.totalCash ?? 0) - (p.moneyOut ?? 0), 6);
    expect(p.margin).toBeCloseTo((p.profit ?? 0) / (p.totalCash ?? 1), 9);
  });

  test("a booking costs the cost per lead over lead to booking", () => {
    const d = driversFromTargets(SEPTEMBER);
    // The typed client lead to booking carries over as the call centre's.
    expect(d.callLeadToBooking).toBe(0.3);
    const p = project({ ...d, callLeads: 1050, callLeadToBooking: 0.171 });
    expect(p.callBookings).toBeCloseTo(179.55, 6);
    expect(p.clientCpb).toBeCloseTo(15 / 0.171, 6);
    // $15 a lead holds the $60 booking at 25%.
    expect(p.leadToBookingForGate).toBe(0.25);
  });

  test("an empty input is not a zero: what depends on it stays empty", () => {
    const d = { ...driversFromTargets(SEPTEMBER), cpl: null };
    const p = project(d);
    expect(p.leads).toBeNull();
    expect(p.closes).toBeNull();
    expect(p.newCash).toBeNull();
    // The back end still stands on its own.
    expect(p.backEndCash).toBe(16000);
    expect(p.totalCash).toBe(21000);
  });
});

describe("starting points", () => {
  test("a month half done is grown to the whole month for budgets, never for rates", () => {
    const fallback = driversFromTargets(SEPTEMBER);
    const d = driversFromActuals(
      { spend: 2070.42, cpl: 29.16, callLeads: 525, callLeadToBooking: 0.17 },
      0.5,
      fallback,
    );
    expect(d.spend).toBeCloseTo(4140.84, 6);
    expect(d.cpl).toBe(29.16);
    expect(d.callLeads).toBe(1050);
    expect(d.callLeadToBooking).toBe(0.17);
    // Nothing measured: the plan's own input stands.
    expect(d.aov).toBe(6000);
    expect(d.labour).toBe(26260);
  });

  test("a tenth better moves rates up, costs down, and leaves budgets alone", () => {
    const d = aTenthBetter(driversFromTargets(SEPTEMBER));
    expect(d.cpl).toBeCloseTo(9, 9);
    expect(d.closeRate).toBeCloseTo(0.275, 9);
    expect(d.spend).toBe(6600);
    expect(d.mrrCollectionRate).toBe(1);
  });
});

describe("the targets it writes", () => {
  test("each worked-out number says how", () => {
    const d = driversFromTargets(SEPTEMBER) as Drivers;
    const rows = modelTargets(d, project(d), say);
    const leads = rows.find(r => r.key === "leads");
    expect(leads?.value).toBe(660);
    expect(leads?.how).toBe("$6600 at $10 a lead.");
    expect(rows.find(r => r.key === "cpl")?.how).toBeNull();
  });

  test("every metric the model sets is one the catalogue knows", async () => {
    const { METRIC_BY_KEY } = await import("../convex/ceo/scoreboard");
    for (const key of MODEL_KEYS) expect(METRIC_BY_KEY[key]).toBeDefined();
  });
});
