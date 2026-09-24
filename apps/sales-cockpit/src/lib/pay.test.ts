import { describe, expect, test } from "bun:test";
import {
  CLOSER_PLAN,
  closerNames,
  dialStats,
  elapsedWorkingDays,
  goalActual,
  goalPeriod,
  goalsFromForm,
  goalsToForm,
  hasPayRule,
  isTheirDeal,
  monthEnd,
  paceVerdict,
  payEstimate,
  payFromForm,
  payToForm,
  payWords,
  projection,
  teamTotal,
  weekStart,
  windowDays,
  workingDays,
} from "./pay";
import type { Scorecard } from "./types";

// 2026-09-24 is a Thursday; 2026-09-19 the Saturday that starts its week.
const THU = Date.parse("2026-09-24T09:00:00Z"); // 12:00 in Kuwait

describe("working days (Saturday to Thursday, Friday off)", () => {
  test("a whole week is six days, with or without its Friday", () => {
    expect(workingDays("2026-09-19", "2026-09-24")).toBe(6);
    expect(workingDays("2026-09-19", "2026-09-25")).toBe(6);
    expect(workingDays("2026-09-25", "2026-09-25")).toBe(0);
  });

  test("September 2026 has 26 working days, August 27", () => {
    expect(workingDays("2026-09-01", "2026-09-30")).toBe(26);
    expect(workingDays("2026-08-01", "2026-08-31")).toBe(27);
  });

  test("an empty or reversed range is zero", () => {
    expect(workingDays("2026-09-24", "2026-09-19")).toBe(0);
    expect(workingDays("not a day", "2026-09-19")).toBe(0);
  });

  test("elapsed counts today, and stops at the period's end", () => {
    expect(elapsedWorkingDays("2026-09-01", "2026-09-24")).toBe(21);
    expect(elapsedWorkingDays("2026-09-19", "2026-09-19")).toBe(1);
    // The Friday after the week: all six days are behind us.
    expect(elapsedWorkingDays("2026-09-19", "2026-09-25", "2026-09-24")).toBe(
      6,
    );
    // Before the period starts nothing has elapsed.
    expect(elapsedWorkingDays("2026-10-01", "2026-09-24")).toBe(0);
  });
});

describe("projection", () => {
  test("actual ÷ elapsed × total", () => {
    expect(projection(12, 5, 6)).toBeCloseTo(14.4, 6);
    expect(projection(21, 21, 26)).toBe(26);
  });

  test("nothing to project before the first working day, or without an actual", () => {
    expect(projection(0, 0, 6)).toBeNull();
    expect(projection(null, 3, 6)).toBeNull();
  });

  test("a finished period projects to what it made", () => {
    expect(projection(5, 6, 6)).toBe(5);
    expect(projection(5, 7, 6)).toBe(5);
  });
});

describe("periods and windows", () => {
  test("the week starts on Saturday", () => {
    expect(weekStart("2026-09-24")).toBe("2026-09-19");
    expect(weekStart("2026-09-25")).toBe("2026-09-19");
    expect(weekStart("2026-09-26")).toBe("2026-09-26");
  });

  test("month ends, leap years included", () => {
    expect(monthEnd("2026-09-01")).toBe("2026-09-30");
    expect(monthEnd("2026-08-14")).toBe("2026-08-31");
    expect(monthEnd("2028-02-01")).toBe("2028-02-29");
    expect(monthEnd("2026-12-05")).toBe("2026-12-31");
  });

  test("goal periods: Saturday to Thursday, or the calendar month", () => {
    expect(goalPeriod("week", "2026-09-19")).toEqual({
      from: "2026-09-19",
      to: "2026-09-24",
      kind: "weekly",
    });
    expect(goalPeriod("month", "2026-09-01")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      kind: "monthly",
    });
    expect(goalPeriod("last_month", "2026-08-01")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      kind: "monthly",
    });
    expect(goalPeriod("today", "2026-09-24")).toBeNull();
    expect(goalPeriod("d30", "2026-08-26")).toBeNull();
    expect(goalPeriod("d90", "2026-06-27")).toBeNull();
  });

  test("window days match the mirror's (Kuwait days)", () => {
    expect(windowDays("today", THU)).toEqual({
      from: "2026-09-24",
      to: "2026-09-24",
    });
    expect(windowDays("week", THU)).toEqual({
      from: "2026-09-19",
      to: "2026-09-24",
    });
    expect(windowDays("month", THU)).toEqual({
      from: "2026-09-01",
      to: "2026-09-24",
    });
    expect(windowDays("last_month", THU)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(windowDays("d30", THU)).toEqual({
      from: "2026-08-26",
      to: "2026-09-24",
    });
    expect(windowDays("d90", THU)).toEqual({
      from: "2026-06-27",
      to: "2026-09-24",
    });
  });

  test("half past midnight in Kuwait is already the next day", () => {
    // 21:30 UTC on Thursday is 00:30 on Friday in Kuwait.
    const t = Date.parse("2026-09-24T21:30:00Z");
    expect(windowDays("today", t)).toEqual({
      from: "2026-09-25",
      to: "2026-09-25",
    });
    expect(windowDays("week", t).from).toBe("2026-09-19");
  });
});

describe("pace verdict", () => {
  test("met, on track, close, behind", () => {
    expect(paceVerdict(25, 25, 25, false)).toEqual({
      tone: "good",
      label: "Met",
    });
    expect(paceVerdict(12, 25, 26, false)).toEqual({
      tone: "good",
      label: "On track",
    });
    expect(paceVerdict(12, 25, 20, false)).toEqual({
      tone: "warning",
      label: "Close",
    });
    expect(paceVerdict(12, 25, 19.9, false)).toEqual({
      tone: "critical",
      label: "Behind",
    });
  });

  test("a finished period is met or missed", () => {
    expect(paceVerdict(24, 25, 24, true)).toEqual({
      tone: "critical",
      label: "Missed",
    });
    expect(paceVerdict(30, 25, 30, true)).toEqual({
      tone: "good",
      label: "Met",
    });
  });

  test("no verdict without an actual, a goal or a projection", () => {
    expect(paceVerdict(null, 25, null, false)).toBeNull();
    expect(paceVerdict(3, 0, 3, false)).toBeNull();
    expect(paceVerdict(3, 25, null, false)).toBeNull();
  });
});

describe("pay estimate (Aziz, 2026-09-24)", () => {
  test("$2,000 upfront of $6,000 at 10%: $200 now, $400 later, no bonus", () => {
    const e = payEstimate(CLOSER_PLAN, [
      { cash_collected: 2000, contracted_revenue: 6000 },
    ]);
    expect(e.earned).toBe(200);
    expect(e.later).toBe(400);
    expect(e.paidInFull).toBe(0);
    expect(e.bonuses).toBe(0);
  });

  test("$6,000 of $6,000: $600 now and the $250 paid-in-full bonus", () => {
    const e = payEstimate(CLOSER_PLAN, [
      { cash_collected: 6000, contracted_revenue: 6000 },
    ]);
    expect(e.earned).toBe(600);
    expect(e.later).toBe(0);
    expect(e.paidInFull).toBe(1);
    expect(e.bonuses).toBe(250);
  });

  test("both deals together, amounts as B2B sends them (strings)", () => {
    const e = payEstimate(CLOSER_PLAN, [
      { cash_collected: "2000", contracted_revenue: "6000" },
      { cash_collected: "6000", contracted_revenue: "6000" },
    ]);
    expect(e).toMatchObject({
      deals: 2,
      cash: 8000,
      owed: 4000,
      earned: 800,
      later: 400,
      bonuses: 250,
    });
  });

  test("a deal missing an amount is counted apart, never as zero", () => {
    const e = payEstimate(CLOSER_PLAN, [
      { cash_collected: null, contracted_revenue: 6000 },
      { cash_collected: 1000, contracted_revenue: null },
    ]);
    expect(e.incomplete).toBe(2);
    expect(e.cash).toBe(1000);
    expect(e.owed).toBe(0);
    expect(e.paidInFull).toBe(0);
  });

  test("a zero contract is not paid in full", () => {
    const e = payEstimate(CLOSER_PLAN, [
      { cash_collected: 0, contracted_revenue: 0 },
    ]);
    expect(e.paidInFull).toBe(0);
  });

  test("an empty rule earns nothing it can name", () => {
    const e = payEstimate({}, [
      { cash_collected: 2000, contracted_revenue: 6000 },
    ]);
    expect(e.earned).toBeNull();
    expect(e.later).toBeNull();
    expect(e.bonuses).toBeNull();
    expect(e.signed).toBeNull();
  });

  test("a fixed amount per signed client", () => {
    const e = payEstimate({ per_signed: 100 }, [
      { cash_collected: 1, contracted_revenue: 2 },
      { cash_collected: 1, contracted_revenue: 2 },
    ]);
    expect(e.signed).toBe(200);
  });
});

describe("pay rules", () => {
  test("{} and a lone currency are not a rule", () => {
    expect(hasPayRule({})).toBe(false);
    expect(hasPayRule({ currency: "USD" })).toBe(false);
    expect(hasPayRule(null)).toBe(false);
    expect(hasPayRule({ per_intro_shown: 25 })).toBe(true);
  });

  test("the closer plan in words", () => {
    expect(payWords({ cash_rate: 0.1, pif_bonus: 250, currency: "USD" })).toBe(
      "10% of the cash collected on your contracts as it is collected, plus $250 when a client pays in full",
    );
    expect(payWords({ cash_rate: 0.075 }, "their")).toBe(
      "7.5% of the cash collected on their contracts as it is collected",
    );
  });

  test("a setter's rule in words", () => {
    expect(payWords({ per_intro_shown: 25, currency: "USD" })).toBe(
      "$25 for each intro you set that shows",
    );
    expect(payWords({ per_intro_shown: 25, per_demo_shown: 10 }, "their")).toBe(
      "$10 for each demo that shows, plus $25 for each intro they set that shows",
    );
    expect(payWords({})).toBeNull();
  });

  test("the form round trip: 10 is sent as 0.10, blanks are left out", () => {
    const f = payToForm({
      cash_rate: 0.1,
      pif_bonus: 250,
      currency: "USD",
      note: "As agreed",
    });
    expect(f.cashPct).toBe("10");
    expect(f.pif).toBe("250");
    expect(f.perIntro).toBe("");
    const back = payFromForm(f);
    expect(back).toEqual({
      ok: true,
      pay: {
        cash_rate: 0.1,
        pif_bonus: 250,
        currency: "USD",
        note: "As agreed",
      },
    });
  });

  test("the form refuses what the server would", () => {
    const base = payToForm({});
    expect(base.currency).toBe("USD");
    expect(payFromForm({ ...base, cashPct: "120" }).ok).toBe(false);
    expect(payFromForm({ ...base, pif: "-5" }).ok).toBe(false);
    expect(payFromForm({ ...base, perSigned: "abc" }).ok).toBe(false);
    expect(payFromForm({ ...base, currency: "EUR" }).ok).toBe(false);
    expect(payFromForm({ ...base, pif: "1,500" })).toEqual({
      ok: true,
      pay: { pif_bonus: 1500, currency: "USD" },
    });
  });
});

describe("goals form", () => {
  test("blank is no goal; keys the page does not edit are kept", () => {
    const f = goalsToForm({
      weekly: { booked: 25, conversations: 40 },
      monthly: { cash: 30000 },
    });
    expect(f.weekly.booked).toBe("25");
    expect(f.monthly.cash).toBe("30000");
    f.weekly.shown = "15";
    f.monthly.cash = "";
    const out = goalsFromForm(f, {
      weekly: { booked: 25, conversations: 40 },
      monthly: { cash: 30000 },
    });
    expect(out).toEqual({
      ok: true,
      goals: { weekly: { booked: 25, conversations: 40, shown: 15 } },
    });
  });

  test("refuses a negative goal", () => {
    const f = goalsToForm({});
    f.weekly.closes = "-1";
    expect(goalsFromForm(f).ok).toBe(false);
  });
});

describe("closer matching", () => {
  const rep = {
    display_name: "Ahmed Saleh",
    closer_aliases: ["Ahmed", " ahmed s "],
  };

  test("aliases and the display name, any case, outer spaces ignored", () => {
    const names = closerNames(rep);
    expect(isTheirDeal("AHMED", names)).toBe(true);
    expect(isTheirDeal(" Ahmed Saleh ", names)).toBe(true);
    expect(isTheirDeal("ahmed s", names)).toBe(true);
    expect(isTheirDeal("Ahmad", names)).toBe(false);
    expect(isTheirDeal(null, names)).toBe(false);
    expect(isTheirDeal("", names)).toBe(false);
  });

  test("no rep, no names", () => {
    expect(closerNames(null)).toEqual([]);
  });
});

function card(p: Partial<Scorecard>): Scorecard {
  return {
    person_key: "x",
    display_name: null,
    role: null,
    is_known: true,
    calls_scheduled: 0,
    calls_due: 0,
    calls_shown: 0,
    calls_qualified: 0,
    demos_scheduled: 0,
    demos_due: 0,
    demos_shown: 0,
    demos_qualified: 0,
    disqualified_count: 0,
    noshow_count: 0,
    cancelled_count: 0,
    show_rate: null,
    noshow_rate: null,
    disqualified_rate: null,
    closes: 0,
    revenue: 0,
    cash_collected: 0,
    new_mrr: 0,
    close_rate: null,
    avg_deal: null,
    ...p,
  };
}

describe("team total", () => {
  test("rates come from the summed counts, never from averaged rates", () => {
    const a = card({
      calls_due: 10,
      calls_shown: 5,
      show_rate: 50,
      noshow_count: 4,
    });
    const b = card({
      calls_due: 30,
      calls_shown: 27,
      show_rate: 90,
      noshow_count: 2,
    });
    const t = teamTotal([a, b]);
    expect(t.calls_due).toBe(40);
    expect(t.calls_shown).toBe(32);
    expect(t.show_rate).toBe(80); // not (50 + 90) ÷ 2 = 70
    expect(t.noshow_rate).toBe(15);
  });

  test("close rate on qualified demos and the average deal, as B2B rounds them", () => {
    const a = card({
      demos_qualified: 2,
      closes: 1,
      revenue: 6000,
      cash_collected: 2000,
    });
    const b = card({
      demos_qualified: 1,
      closes: 1,
      revenue: 3000,
      cash_collected: "3000" as unknown as number,
    });
    const t = teamTotal([a, b]);
    expect(t.close_rate).toBe(66.7);
    expect(t.avg_deal).toBe(4500);
    expect(t.cash_collected).toBe(5000);
  });

  test("with nothing to divide by, a rate is unknown rather than zero", () => {
    const t = teamTotal([]);
    expect(t.calls_scheduled).toBe(0);
    expect(t.show_rate).toBeNull();
    expect(t.close_rate).toBeNull();
    expect(t.avg_deal).toBeNull();
  });

  test("goals read the scorecard, dials read Maqsam", () => {
    const c = card({
      calls_scheduled: 12,
      calls_shown: 7,
      closes: 2,
      cash_collected: 4000,
    });
    expect(goalActual("booked", c, null)).toBe(12);
    expect(goalActual("shown", c, null)).toBe(7);
    expect(goalActual("closes", c, null)).toBe(2);
    expect(goalActual("cash", c, null)).toBe(4000);
    expect(goalActual("dials", c, 55)).toBe(55);
    expect(goalActual("booked", null, 55)).toBeNull();
  });
});

describe("dials", () => {
  test("outbound, connected, talk time and inbound", () => {
    const s = dialStats([
      { direction: "outbound", state: "completed", duration_s: 120 },
      { direction: "outbound", state: "completed", duration_s: 60 },
      { direction: "outbound", state: "no_answer", duration_s: 0 },
      { direction: "outbound", state: "busy", duration_s: null },
      { direction: "inbound", state: "completed", duration_s: 300 },
      { direction: null, state: null, duration_s: null },
    ]);
    expect(s).toEqual({
      outbound: 4,
      connected: 2,
      talkSeconds: 180,
      inbound: 1,
    });
  });
});
