import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PersonInputs, PersonMonth, PriorApproval } from "../src/types/ceo/hoursContract";
import { HOURS_RULE_VERSION } from "../src/types/ceo/hoursContract";
import {
  approvalSnapshot,
  canonicalPersonInputs,
  computeMonth,
  computePersonMonth,
  contextOf,
  dayParts,
  employedOn,
  hashMonth,
  hashPerson,
  netSeconds,
  providerRowsOf,
  recomputeApproved,
  roleDefaults,
  scheduleOn,
  settingsOf,
  shareBySegments,
} from "../src/types/ceo/hoursModel";
import { parseSchedule } from "../src/types/ceo/schedule";
import { adj, booking, fullDays, H, hub, inputs, person, ttDaysFor, WEEK, workingDays } from "./lib/hoursFixtures";

const OCT = workingDays("2026-10");
function one(p: PersonInputs, over: Parameters<typeof inputs>[1] = {}): PersonMonth {
  const month = computeMonth(inputs([p], over));
  const pm = month.people.find(x => x.personId === p.personId);
  if (!pm) throw new Error(`Person ${p.personId} not counted: ${JSON.stringify(month.notCounted)}`);
  return pm;
}
const codes = (pm: PersonMonth) => pm.status.reasons.map(r => r.code);

describe("the 26 worked examples (design 4.8, made-up figures)", () => {
  test("1 full month: 175 h tracked with 5 h manual counted, 1 day of annual leave", () => {
    const leaveDay = OCT[10];
    const b = booking(leaveDay, leaveDay);
    const days = fullDays([leaveDay]);
    days[0] = hub(days[0].day, 7, { manualS: 5 * H });
    const pm = one(person({ hubstaffDays: days, bookings: [b], ttDays: ttDaysFor(b), adjustments: [adj("manual_time", { seconds: 5 * H, decision: "count" })] }));
    expect(pm.hours.counted).toBe(182 * H);
    expect(pm.pay.total).toBe(910);
    expect(pm.status.kind).toBe("ready");
  });

  test("2 short month: 160 h tracked plus 7 h leave pays 853.20 with 3 h 38 min forgiven", () => {
    const leaveDay = OCT[25];
    const b = booking(leaveDay, leaveDay);
    const days = OCT.filter(d => d !== leaveDay).map((d, i) => hub(d, i < 20 ? 7 : 4));
    const pm = one(person({ hubstaffDays: days, bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.counted).toBe(167 * H);
    expect(pm.hours.forgiven).toBe(13_104);
    expect(pm.pay.total).toBe(853.2);
  });

  test("3 inside grace: 179 h counted pays the base", () => {
    const days = OCT.map((d, i) => hub(d, i === 0 ? 4 : 7));
    expect(one(person({ hubstaffDays: days })).pay.total).toBe(910);
  });

  test("4 over hours: 195 h tracked pays the base, 13 h extra not paid", () => {
    const pm = one(person({ hubstaffDays: OCT.map(d => hub(d, 7.5)) }));
    expect(pm.pay.total).toBe(910);
    expect(pm.hours.extra).toBe(13 * H);
    expect(codes(pm)).toContain("extra_hours");
  });

  test("5 overtime on, above target: 6 h at 1.25 pays 947.50", () => {
    const days = OCT.map((d, i) => hub(d, i < 2 ? 10 : 7));
    const ot = [adj("overtime", { day: OCT[0], seconds: 3 * H }), adj("overtime", { day: OCT[1], seconds: 3 * H })];
    const pm = one(person({ hubstaffDays: days, adjustments: ot }), { rules: { fromMonth: "2026-10", settings: { overtime: { on: true, rate: 1.25 } }, savedBy: "x", savedAt: "x" } });
    expect(pm.hours.overtimePaid).toBe(6 * H);
    expect(pm.pay.overtime).toBe(37.5);
    expect(pm.pay.total).toBe(947.5);
  });

  test("6 overtime on, short of target: overtime pays 0 and the month pays 893.20", () => {
    const days = OCT.map((d, i) => hub(d, i < 19 ? 7 : 6));
    const ot = [adj("overtime", { day: OCT[0], seconds: 6 * H })];
    const pm = one(person({ hubstaffDays: days, adjustments: ot }), { rules: { fromMonth: "2026-10", settings: { overtime: { on: true, rate: 1.25 } }, savedBy: "x", savedAt: "x" } });
    expect(pm.hours.counted).toBe(175 * H);
    expect(pm.pay.overtime).toBe(0);
    expect(pm.pay.total).toBe(893.2);
  });

  test("7 joins Thu 15 Oct: 14 working days, 95 h counted pays 484.80", () => {
    const from = OCT.filter(d => d >= "2026-10-15");
    expect(from.length).toBe(14);
    const p = person({ startedOn: "2026-10-15", addedOn: "2026-10-10", employment: [{ kind: "employed", from: "2026-10-15", to: null }],
      hubstaffDays: from.map((d, i) => hub(d, i === 0 ? 4 : 7)) });
    const pm = one(p);
    expect(pm.hours.expected).toBe(98 * H);
    expect(pm.hours.forgiven).toBe(7056);
    expect(pm.pay.total).toBe(484.8);
  });

  test("8 base rises from 16 Oct: shared by target, 455 + 546 = 1,001", () => {
    const first = OCT.filter(d => d <= "2026-10-15");
    const second = OCT.filter(d => d >= "2026-10-16");
    expect(first.length * 7).toBe(91);
    expect(second.length * 7).toBe(91);
    const days = [...first.map((d, i) => hub(d, i === 0 ? 10 : 7)), ...second.map((d, i) => hub(d, i === 0 ? 4 : 7))];
    const pm = one(person({ hubstaffDays: days, payHistory: [
      { effectiveFrom: "2026-01-01", monthlyCost: 910, currency: "USD", source: "seed" },
      { effectiveFrom: "2026-10-16", monthlyCost: 1092, currency: "USD", source: "dated" },
    ] }));
    expect(pm.segments.map(s => s.amount)).toEqual([455, 546]);
    expect(pm.pay.total).toBe(1001);
  });

  test("9 two days of unpaid leave: target 168 h pays 840", () => {
    const b = booking(OCT[3], OCT[4], { leaveTypeId: "unpaid", leaveTypeName: "Unpaid leave" });
    const pm = one(person({ hubstaffDays: fullDays([OCT[3], OCT[4]]), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.target).toBe(168 * H);
    expect(pm.pay.total).toBe(840);
  });

  test("10 unpaid half day: grace never forgives booked leave, 892.50", () => {
    const d = OCT[5];
    const b = booking(d, d, { leaveTypeId: "unpaid", leaveTypeName: "Unpaid leave", startType: "Afternoon", endType: "Afternoon" });
    const days = fullDays([d]).concat([hub(d, 3.5)]);
    const pm = one(person({ hubstaffDays: days, bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.target).toBe(178.5 * H);
    expect(pm.pay.total).toBe(892.5);
  });

  test("11 sync failed for 3 days: 910 provisional, not ready", () => {
    const missing = OCT.slice(4, 7);
    const cover = inputs([]).coverage.hubstaff.filter(d => !missing.includes(d));
    const pm = one(person({ hubstaffDays: fullDays(missing) }), { coverage: { hubstaff: cover, timetastic: inputs([]).coverage.timetastic } });
    expect(pm.pay.total).toBe(910);
    expect(pm.pay.provisional).toBe(true);
    expect(pm.status.kind).toBe("not_ready");
    expect(pm.status.reasons.find(r => r.code === "no_data_days")?.text).toBe("3 days with no Hubstaff data");
  });

  test("12 three days with nothing tracked ask; absent pays 805, counted as worked pays 910", () => {
    const blank = OCT.slice(8, 11);
    const base = person({ hubstaffDays: fullDays(blank) });
    const asked = one(base);
    expect(asked.status.kind).toBe("needs_review");
    expect(asked.status.reasons.filter(r => r.code === "absent_no_leave").length).toBe(3);
    const absent = one({ ...base, adjustments: blank.map(day => adj("absent_unpaid", { day })) });
    expect(absent.hours.target).toBe(161 * H);
    expect(absent.pay.total).toBe(805);
    expect(absent.status.kind).toBe("ready");
    const worked = one({ ...base, adjustments: blank.map(day => adj("excused_paid", { day })) });
    expect(worked.pay.total).toBe(910);
  });

  test("13 half-day Saturdays: a full month pays the base of 835", () => {
    const sched = { ...WEEK, week: { ...WEEK.week, sat: { on: true, start: "12:00", end: "16:00" } } };
    const days = OCT.map(d => hub(d, new Date(`${d}T00:00:00Z`).getUTCDay() === 6 ? 4 : 7));
    const pm = one(person({ schedules: [{ effectiveFrom: "2026-01-01", schedule: sched }], hubstaffDays: days,
      payHistory: [{ effectiveFrom: "2026-01-01", monthlyCost: 835, currency: "USD", source: "seed" }] }));
    expect(pm.hours.fullMonth).toBe(167 * H);
    expect(pm.pay.total).toBe(835);
  });

  test("14 optional role on fixed pay with 1 unpaid day pays 875", () => {
    const b = booking(OCT[2], OCT[2], { leaveTypeId: "unpaid", leaveTypeName: "Unpaid leave" });
    const pm = one(person({ role: "Closer", terms: { ...person().terms, hoursPayFrom: null }, bookings: [b], ttDays: ttDaysFor(b), accounts: person().accounts.filter(a => a.provider === "timetastic") }));
    expect(pm.paysOnHours).toBe(false);
    expect(pm.tracking).toEqual({ value: "optional", from: "role_default" });
    expect(pm.pay.total).toBe(875);
    expect(pm.status.kind).toBe("ready");
  });

  test("15 public holiday Thu 22 Oct with 175 h on the other days pays the base", () => {
    const pm = one(person({ hubstaffDays: fullDays(["2026-10-22"]), holidays: [{ day: "2026-10-22", name: "Public holiday", source: "timetastic" }] }));
    expect(pm.hours.holidays).toBe(7 * H);
    expect(pm.pay.total).toBe(910);
  });

  test("16 day-off work makes up a shortfall: 177 h plus 3 h on Fri 9 Oct", () => {
    const days = OCT.map((d, i) => hub(d, i === 0 ? 2 : 7)).concat([hub("2026-10-09", 3)]);
    const pm = one(person({ hubstaffDays: days }));
    expect(pm.hours.counted).toBe(180 * H);
    expect(pm.pay.total).toBe(910);
    expect(pm.status.reasons.find(r => r.code === "worked_day_off")?.text).toContain("3 h");
  });

  test("17 part-paid type at 50%: 3.5 h paid, 3.5 h unpaid, pays 892.50", () => {
    const d = OCT[12];
    const b = booking(d, d, { leaveTypeId: "half", leaveTypeName: "Half-paid leave" });
    const pm = one(person({ hubstaffDays: fullDays([d]), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.target).toBe(178.5 * H);
    expect(pm.pay.total).toBe(892.5);
  });

  test("18 KWD base 300 with 167 of 182 h pays KWD 281.275", () => {
    const leaveDay = OCT[25];
    const b = booking(leaveDay, leaveDay);
    const days = OCT.filter(d => d !== leaveDay).map((d, i) => hub(d, i < 20 ? 7 : 4));
    const pm = one(person({ hubstaffDays: days, bookings: [b], ttDays: ttDaysFor(b), terms: { ...person().terms, contractCountry: "EG" },
      payHistory: [{ effectiveFrom: "2026-01-01", monthlyCost: 300, currency: "KWD", source: "seed" }] }));
    expect(pm.currency).toBe("KWD");
    expect(pm.pay.total).toBe(281.275);
    expect(pm.pay.totalUsd).toBe(Math.round(281.275 * 3.26 * 100) / 100);
  });

  test("19 shadow month: approved fixed 910; if pay followed hours 818.20", () => {
    const days = OCT.map((d, i) => hub(d, i === 0 ? 10 : 6));
    const pm = one(person({ terms: { ...person().terms, hoursPayFrom: "2026-12" }, hubstaffDays: days }));
    expect(pm.shadow).toBe(true);
    expect(pm.pay.total).toBe(910);
    expect(pm.pay.shadowAmount).toBe(818.2);
    expect(pm.status.kind).toBe("ready");
  });

  test("20 changed after approval: +1 h 30 min, +$7.50 carried once into October", async () => {
    const SEP = workingDays("2026-09");
    const sepDays = SEP.map((d, i) => hub(d, i < 15 ? 7 : i < 25 ? 5.6 : 6));
    const sepPerson = person({ hubstaffDays: sepDays });
    const sepInputs = inputs([sepPerson], { month: "2026-09" });
    const sepCtx = contextOf(sepInputs);
    const sep = computePersonMonth(sepPerson, sepCtx);
    expect(sep.hours.counted).toBe(167 * H);
    expect(sep.pay.total).toBe(853.2);
    const approval = {
      status: "approved" as const, ruleVersion: HOURS_RULE_VERSION, inputsHash: await hashPerson(sepPerson, sepCtx), shadow: false,
      amount: 853.2, currency: "USD", amountUsd: 853.2, payableS: sep.hours.payable ?? 0, approvedAt: "2026-10-03T08:00:00Z",
      approvedBy: "ceo@example.test", paidAt: null, paidNote: null, inputs: approvalSnapshot(sepPerson, sepCtx, []), result: sep,
    };
    const later = sepDays.map((h, i) => (i === 0 ? hub(h.day, 8.5) : h));
    const sepCoverage = { hubstaff: inputs([], { month: "2026-09" }).coverage.hubstaff, timetastic: inputs([], { month: "2026-09" }).coverage.timetastic };
    const prior: PriorApproval = { month: "2026-09", approval, current: { hubstaffDays: later, bookings: [], ttDays: [], holidays: [], coverage: sepCoverage }, carried: 0 };
    const octCtx = contextOf(inputs([]));
    const rec = recomputeApproved(prior, octCtx);
    expect((rec.hours.payable ?? 0) - approval.payableS).toBe(1.5 * H);
    expect(rec.pay.total).toBe(860.7);
    const oct = one(person({ hubstaffDays: fullDays(), priorApprovals: [prior] }));
    expect(oct.pay.corrections.lines).toEqual([{ fromMonth: "2026-09", amount: 7.5, applied: 7.5, carried: true }]);
    expect(oct.pay.total).toBe(917.5);
    expect(oct.status.reasons.find(r => r.code === "changed_since_approved")?.text).toContain("+1 h 30 min, +$7.50");
    const again = one(person({ hubstaffDays: fullDays(), priorApprovals: [{ ...prior, carried: 7.5 }] }));
    expect(again.pay.corrections.lines).toEqual([]);
    expect(again.pay.total).toBe(910);
  });

  test("21 a leave type with no rule blocks with one plain sentence", () => {
    const b = booking(OCT[6], OCT[6], { leaveTypeId: "compassionate", leaveTypeName: "Compassionate" });
    const pm = one(person({ hubstaffDays: fullDays([OCT[6]]), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.status.kind).toBe("not_ready");
    expect(pm.status.reasons.find(r => r.code === "leave_type_without_rule")?.text).toBe("Set a pay rule for Compassionate (1 booking)");
  });

  test("22 paid leave over a holiday counts the holiday once: 910", () => {
    const b = booking("2026-10-20", "2026-10-24");
    const off = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-24"];
    const pm = one(person({ hubstaffDays: fullDays(off), bookings: [b], ttDays: ttDaysFor(b), holidays: [{ day: "2026-10-22", name: "Public holiday", source: "timetastic" }] }));
    expect(pm.hours.holidays).toBe(7 * H);
    expect(pm.hours.paidLeave).toBe(21 * H);
    expect(pm.pay.total).toBe(910);
  });

  test("23 morning leave and a full day worked: the day counts 7 h, leave adds 0", () => {
    const b = booking("2026-10-14", "2026-10-14", { endType: "Morning" });
    const pm = one(person({ hubstaffDays: fullDays(), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.paidLeave).toBe(0);
    expect(pm.hours.counted).toBe(182 * H);
    expect(pm.status.reasons.find(r => r.code === "worked_during_leave")?.text).toContain("Worked 7 h during booked leave");
  });

  test("24 unpaid leave on a day worked costs nothing: 910", () => {
    const b = booking("2026-10-14", "2026-10-14", { leaveTypeId: "unpaid", leaveTypeName: "Unpaid leave" });
    const pm = one(person({ hubstaffDays: fullDays(), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.target).toBe(182 * H);
    expect(pm.pay.total).toBe(910);
  });

  test("25 timer left running: 1 h of idle kept, 808.20 (848.20 without the limits)", () => {
    const days = OCT.map(d => (d === "2026-10-14" ? hub(d, 16, { idleS: 9 * H }) : hub(d, 6)));
    const pm = one(person({ hubstaffDays: days }));
    expect(pm.hours.counted).toBe(158 * H);
    expect(pm.pay.total).toBe(808.2);
    expect(pm.status.reasons.find(r => r.code === "idle_not_counted")?.text).toContain("8 h of idle time not counted");
    const loose = one(person({ hubstaffDays: days }), { rules: { fromMonth: "2026-10", settings: { keptIdleMaxMinutesPerDay: 600, dayLimitHours: 24 }, savedBy: "x", savedAt: "x" } });
    expect(loose.pay.total).toBe(848.2);
  });

  test("26 a negative correction takes 10% of the month; the rest is carried", () => {
    const pm = one(person({ hubstaffDays: fullDays(), payHistory: [{ effectiveFrom: "2026-01-01", monthlyCost: 400, currency: "USD", source: "seed" }],
      adjustments: [adj("correction", { amount: -300, currency: "USD" })] }));
    expect(pm.pay.amount).toBe(400);
    expect(pm.pay.corrections.applied).toBe(-40);
    expect(pm.pay.corrections.carriedOut).toBe(-260);
    expect(pm.pay.total).toBe(360);
    expect(pm.lookAt.find(l => l.code === "correction_capped")).toBeTruthy();
  });
});

describe("the day's fixed order", () => {
  test("unpaid leave over a holiday stays paid", () => {
    const b = booking("2026-10-22", "2026-10-22", { leaveTypeId: "unpaid", leaveTypeName: "Unpaid leave" });
    const pm = one(person({ hubstaffDays: fullDays(["2026-10-22"]), bookings: [b], ttDays: [], holidays: [{ day: "2026-10-22", name: "Holiday", source: "timetastic" }] }));
    expect(pm.hours.unpaid).toBe(0);
    expect(pm.pay.total).toBe(910);
  });
  test("an Hours booking across lunch can't credit more than the day", () => {
    const b = booking("2026-10-14", "2026-10-14", { bookingUnit: "Hours", startType: "Hours", endType: "Hours", startAt: "2026-10-14T08:00:00", endAt: "2026-10-14T20:00:00" });
    const pm = one(person({ hubstaffDays: fullDays(["2026-10-14"]), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.paidLeave).toBe(7 * H);
    expect(pm.hours.counted).toBe(182 * H);
  });
  test("a half day of leave with no work asks", () => {
    const b = booking("2026-10-14", "2026-10-14", { endType: "Morning" });
    const pm = one(person({ hubstaffDays: fullDays(["2026-10-14"]), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.status.kind).toBe("needs_review");
    expect(pm.status.reasons.find(r => r.code === "absent_no_leave")?.seconds).toBe(3.5 * H);
  });
  test("Working from home is not leave: hours come from Hubstaff", () => {
    const b = booking("2026-10-14", "2026-10-14", { leaveTypeId: "wfh", leaveTypeName: "Working from home" });
    const pm = one(person({ hubstaffDays: fullDays(), bookings: [b], ttDays: ttDaysFor(b) }));
    expect(pm.hours.paidLeave).toBe(0);
    expect(pm.pay.total).toBe(910);
  });
});

describe("decisions fill only what is left", () => {
  const day = "2026-10-14";
  test("a late upload after Confirm absent is counted and the decision shrinks", () => {
    const pm = one(person({ hubstaffDays: fullDays([day]).concat([hub(day, 6)]),
      adjustments: [adj("absent_unpaid", { day, snapshot: { trackedS: 0, manualS: 0, covered: true, leaveS: 0 } })] }));
    expect(pm.hours.unpaid).toBe(1 * H);
    expect(codes(pm)).toContain("decision_overtaken");
  });
  test("a late upload after Count as worked never counts the day twice", () => {
    const pm = one(person({ hubstaffDays: fullDays([day]).concat([hub(day, 6)]), adjustments: [adj("excused_paid", { day })] }));
    expect(pm.hours.counted).toBe(182 * H);
    expect(pm.hours.excused).toBe(1 * H);
  });
  test("hours replace on a no-data day, then Hubstaff disagrees: asks", () => {
    const cover = inputs([]).coverage.hubstaff.filter(d => d !== day);
    const entered = adj("hours", { day, seconds: 7 * H, mode: "replace", snapshot: { trackedS: null, manualS: null, covered: false, leaveS: 0 } });
    const before = one(person({ hubstaffDays: fullDays([day]), adjustments: [entered] }), { coverage: { hubstaff: cover, timetastic: cover } });
    expect(before.pay.total).toBe(910);
    expect(codes(before)).not.toContain("no_data_days");
    const after = one(person({ hubstaffDays: fullDays([day]).concat([hub(day, 5)]), adjustments: [entered] }));
    expect(codes(after)).toContain("entered_vs_hubstaff");
  });
  test("hours add on a covered day adds to the work", () => {
    const pm = one(person({ hubstaffDays: fullDays([day]).concat([hub(day, 5)]), adjustments: [adj("hours", { day, seconds: 2 * H, mode: "add" })] }));
    expect(pm.hours.counted).toBe(182 * H);
  });
  test("manual time above the decided minutes asks again", () => {
    const days = fullDays([day]).concat([hub(day, 7, { manualS: 2 * H })]);
    const pm = one(person({ hubstaffDays: days, adjustments: [adj("manual_time", { seconds: 1 * H, decision: "count" })] }));
    expect(pm.status.reasons.find(r => r.code === "manual_time")?.seconds).toBe(1 * H);
    const settled = one(person({ hubstaffDays: days, adjustments: [adj("manual_time", { seconds: 1 * H, decision: "count" }), adj("manual_time", { seconds: 1 * H, decision: "skip" })] }));
    expect(codes(settled)).not.toContain("manual_time");
    expect(settled.hours.counted).toBe(181 * H);
  });
  test("pending leave asks for everyone counted, and Treat as not booked settles it", () => {
    const b = booking(day, day, { status: "Pending" });
    const fixed = person({ role: "Closer", terms: { ...person().terms, hoursPayFrom: null }, bookings: [b], ttDays: ttDaysFor(b) });
    expect(codes(one(fixed))).toContain("pending_leave");
    expect(codes(one({ ...fixed, adjustments: [adj("not_booked", { bookingId: b.bookingId })] }))).not.toContain("pending_leave");
  });
});

describe("segments, limits and corrections", () => {
  test("equal adjacent pay rows merge and shares sum exactly to P", () => {
    const pm = one(person({ hubstaffDays: fullDays(), payHistory: [
      { effectiveFrom: "2026-01-01", monthlyCost: 910, currency: "USD", source: "seed" },
      { effectiveFrom: "2026-10-10", monthlyCost: 910, currency: "USD", source: "roster" },
    ] }));
    expect(pm.segments.length).toBe(1);
    const shares = shareBySegments(100_001, [3, 3, 3]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100_001);
    expect(shares).toEqual([33_334, 33_334, 33_333]);
  });
  test("the 12 h day limit", () => {
    const pm = one(person({ hubstaffDays: fullDays(["2026-10-14"]).concat([hub("2026-10-14", 15)]) }));
    expect(pm.hours.overDayLimit).toBe(3 * H);
    expect(codes(pm)).toContain("over_day_limit");
  });
  test("a currency change inside the month blocks", () => {
    const pm = one(person({ hubstaffDays: fullDays(), payHistory: [
      { effectiveFrom: "2026-01-01", monthlyCost: 910, currency: "USD", source: "seed" },
      { effectiveFrom: "2026-10-16", monthlyCost: 300, currency: "KWD", source: "dated" },
    ] }));
    expect(codes(pm)).toContain("currency_changed");
  });
  test("a correction in another currency blocks", () => {
    const pm = one(person({ hubstaffDays: fullDays(), adjustments: [adj("correction", { amount: 10, currency: "KWD" })] }));
    expect(codes(pm)).toContain("correction_currency");
  });
});

describe("shadow, employment and schedule history", () => {
  test("shadow: gaps and absences never move or block the fixed figure", () => {
    const blank = OCT.slice(0, 5);
    const cover = inputs([]).coverage.hubstaff.filter(d => !OCT.slice(5, 8).includes(d));
    const pm = one(person({ terms: { ...person().terms, hoursPayFrom: null }, hubstaffDays: fullDays([...blank, ...OCT.slice(5, 8)]) }), { coverage: { hubstaff: cover, timetastic: inputs([]).coverage.timetastic } });
    expect(pm.shadow).toBe(true);
    expect(pm.pay.total).toBe(910);
    expect(pm.status.kind).toBe("ready");
    expect(pm.pay.shadowUndecidedDays).toBe(5);
    expect(pm.pay.shadowAmount).not.toBeNull();
  });
  test("paused days are unpaid until resumed; a rehire leaves the gap unemployed", () => {
    const periods = [
      { kind: "employed" as const, from: "2026-01-01", to: "2026-10-10" },
      { kind: "employed" as const, from: "2026-10-20", to: null },
      { kind: "paused" as const, from: "2026-10-25", to: "2026-10-27" },
    ];
    expect(employedOn(periods, "2026-10-12")).toBe(false);
    expect(employedOn(periods, "2026-10-26")).toBe(false);
    expect(employedOn(periods, "2026-10-28")).toBe(true);
    const pm = one(person({ employment: periods, hubstaffDays: fullDays() }));
    expect(pm.hours.expected).toBeLessThan(182 * H);
    expect(pm.pay.total).toBe(Math.round((910 * pm.hours.expected) / (182 * H) * 100) / 100);
  });
  test("a schedule change on 2 Nov doesn't touch October", () => {
    const half = { ...WEEK, week: Object.fromEntries(Object.entries(WEEK.week).map(([k, v]) => [k, { ...v, end: "14:00" }])) };
    const pm = one(person({ hubstaffDays: fullDays(), schedules: [{ effectiveFrom: "2026-01-01", schedule: WEEK }, { effectiveFrom: "2026-11-02", schedule: half }] }));
    expect(pm.hours.fullMonth).toBe(182 * H);
    expect(scheduleOn([{ effectiveFrom: "2026-01-01", schedule: WEEK }, { effectiveFrom: "2026-11-02", schedule: half }], "2026-11-03")?.week.mon.end).toBe("14:00");
  });
  test("an inactive person with no last working day blocks", () => {
    expect(codes(one(person({ active: false, hubstaffDays: fullDays() })))).toContain("last_day_missing");
  });
  test("a person added during the month with no start date counts from the day added, with a note", () => {
    const pm = one(person({ startedOn: null, addedOn: "2026-10-15", employment: [], hubstaffDays: fullDays() }));
    expect(codes(pm)).toContain("start_date_assumed");
    expect(pm.lookAt.map(l => l.code)).toContain("start_date_assumed");
  });
});

describe("small pieces", () => {
  const s = settingsOf(null);
  const sched = parseSchedule(WEEK);
  test("netSeconds: 10:00 to 18:00 nets 7 h; a 4 h Saturday nets 4 h; Friday 0", () => {
    expect(netSeconds(sched, "2026-10-14", s)).toBe(7 * H);
    const sat = parseSchedule({ ...WEEK, week: { ...WEEK.week, sat: { on: true, start: "12:00", end: "16:00" } } });
    expect(netSeconds(sat, "2026-10-10", s)).toBe(4 * H);
    expect(netSeconds(sched, "2026-10-09", s)).toBe(0);
  });
  test("dayParts: full, AM, PM, Hours, several days, across a month boundary, a day off", () => {
    const w = { start: "10:00", end: "18:00" };
    const multi = { startAt: "2026-10-30T00:00:00", startType: "Afternoon" as const, endAt: "2026-11-02T00:00:00", endType: "Morning" as const, bookingUnit: "Days" as const };
    expect(dayParts(multi, "2026-10-30", w, 7 * H)).toEqual({ part: "pm", seconds: 3.5 * H });
    expect(dayParts(multi, "2026-10-31", w, 7 * H)).toEqual({ part: "full", seconds: 7 * H });
    expect(dayParts(multi, "2026-11-02", w, 7 * H)).toEqual({ part: "am", seconds: 3.5 * H });
    expect(dayParts(multi, "2026-11-03", w, 7 * H)).toBeNull();
    expect(dayParts(multi, "2026-10-31", w, 0)).toBeNull();
    const hrs = { startAt: "2026-10-14T09:00:00", startType: "Hours" as const, endAt: "2026-10-14T12:00:00", endType: "Hours" as const, bookingUnit: "Hours" as const };
    expect(dayParts(hrs, "2026-10-14", w, 7 * H)).toEqual({ part: "hours", seconds: 2 * H });
  });
  test("roleDefaults for every row of 4.1", () => {
    const r = (role: string | null, e: PersonInputs["engagement"] = "staff") => { const x = roleDefaults(role, e); return [x.counted, x.noRole, x.tracking, x.payBasis]; };
    expect(r("Call centre agent")).toEqual([true, false, "required", "hours"]);
    expect(r("Media buyer")).toEqual([true, false, "required", "hours"]);
    expect(r("Video editor")).toEqual([true, false, "optional", "fixed"]);
    expect(r("Closer")).toEqual([true, false, "optional", "fixed"]);
    expect(r("B2B setter")).toEqual([true, false, "optional", "fixed"]);
    expect(r("Client success manager")).toEqual([true, false, "optional", "fixed"]);
    expect(r("Creative strategist")).toEqual([true, false, "exempt", "fixed"]);
    expect(r("Systems manager")).toEqual([true, false, "exempt", "fixed"]);
    expect(r("General VA")).toEqual([true, false, "exempt", "fixed"]);
    expect(r("Media buyer", "freelancer")).toEqual([true, false, "exempt", "fixed"]);
    expect(r("Video editor", "agency")).toEqual([true, false, "exempt", "fixed"]);
    expect(r("Call centre agent", "intern")).toEqual([true, false, "required", "hours"]);
    expect(r("CEO")).toEqual([false, false, "exempt", "fixed"]);
    expect(r("Shared inbox", "bot")).toEqual([false, false, "exempt", "fixed"]);
    expect(r(null)).toEqual([true, true, "exempt", "fixed"]);
  });
  test("the CEO and bots are not counted; no role is listed and blocks", () => {
    const month = computeMonth(inputs([person({ personId: 2, role: "CEO" }), person({ personId: 3, role: null })]));
    expect(month.notCounted.map(n => n.why).sort()).toEqual(["ceo", "no_role"]);
    expect(month.people.find(p => p.personId === 3)?.status.kind).toBe("not_ready");
  });
});

describe("no data is never zero", () => {
  test("covered with no rows is a real 0 that asks", () => {
    const pm = one(person({ hubstaffDays: fullDays([OCT[0]]) }));
    expect(pm.days.find(d => d.day === OCT[0])?.tracked).toBe(0);
    expect(codes(pm)).toContain("absent_no_leave");
  });
  test("before member_since, uncovered or unverified is no data and blocks", () => {
    const p = person({ hubstaffDays: fullDays([OCT[5]]).concat([hub(OCT[5], 7, { verified: false })]) });
    p.accounts[0] = { ...p.accounts[0], memberSince: OCT[3] };
    const pm = one(p);
    expect(pm.days.find(d => d.day === OCT[0])?.counted).toBeNull();
    expect(pm.days.find(d => d.day === OCT[0])?.kind).toBe("no_data");
    expect(codes(pm)).toContain("no_data_days");
    expect(codes(pm)).toContain("hours_unverified");
  });
  test("an unlinked required person is no data, never 0 hours", () => {
    const pm = one(person({ accounts: person().accounts.filter(a => a.provider === "timetastic"), hubstaffDays: [] }));
    expect(pm.hours.tracked).toBeNull();
    expect(pm.pay.total).toBe(910);
    expect(pm.pay.provisional).toBe(true);
    expect(codes(pm)).toContain("hubstaff_not_linked");
  });
  test("the current month is in progress and provisional", () => {
    const pm = one(person({ hubstaffDays: fullDays().filter(d => d.day < "2026-10-20") }), { today: "2026-10-20" });
    expect(pm.status.kind).toBe("in_progress");
    expect(pm.pay.provisional).toBe(true);
    expect(pm.pay.total).toBe(910);
  });
});

describe("the hash", () => {
  test("online, allowance and coverage timestamps leave it alone; one tracked second changes it", async () => {
    const base = person({ hubstaffDays: fullDays() });
    const ctx = contextOf(inputs([base]));
    const h0 = await hashPerson(base, ctx);
    const volatile = { ...base, accounts: base.accounts.map(a => ({ ...a, online: true, lastActivityAt: "2026-11-05T09:00:00Z", allowanceRemaining: 3 })) };
    expect(await hashPerson(volatile, ctx)).toBe(h0);
    const otherSource = contextOf(inputs([base], { sources: [{ ...inputs([]).sources[0], lastOkAt: "2026-11-06T00:00:00Z" }, inputs([]).sources[1]] }));
    expect(await hashPerson(base, otherSource)).toBe(h0);
    const moved = { ...base, hubstaffDays: base.hubstaffDays.map((h, i) => (i === 0 ? { ...h, trackedS: h.trackedS + 1 } : h)) };
    expect(await hashPerson(moved, ctx)).not.toBe(h0);
    const month = await hashMonth(computeMonth(inputs([base])));
    expect(month.people[0].inputsHash).toBe(h0);
    expect(canonicalPersonInputs(base, ctx)).not.toContain("allowanceRemaining");
  });
  test("an approved month keeps its approval and reports a change since approval", async () => {
    const p = person({ hubstaffDays: fullDays(OCT.slice(0, 3)).concat(OCT.slice(0, 3).map(d => hub(d, 4))) });
    const ctx = contextOf(inputs([p]));
    const pm = computePersonMonth(p, ctx);
    const approval = { status: "approved" as const, ruleVersion: HOURS_RULE_VERSION, inputsHash: await hashPerson(p, ctx), shadow: false,
      amount: pm.pay.total ?? 0, currency: "USD", amountUsd: null, payableS: pm.hours.payable ?? 0, approvedAt: "2026-11-04T08:00:00Z",
      approvedBy: "ceo@example.test", paidAt: null, paidNote: null, inputs: approvalSnapshot(p, ctx, []), result: pm };
    const later = { ...p, hubstaffDays: fullDays(), approval };
    const view = one(later);
    expect(view.status.kind).toBe("approved");
    expect(view.pay.total).toBe(pm.pay.total);
    expect(view.changedSinceApproval?.seconds).toBeGreaterThan(0);
    expect(providerRowsOf(later, ctx).hubstaffDays.length).toBe(26);
  });
});

describe("pins and privacy", () => {
  test("hoursModel.version.json matches the model's source sha256", () => {
    const dir = new URL("../src/types/ceo/", import.meta.url);
    const source = readFileSync(new URL("hoursModel.ts", dir));
    const pin = JSON.parse(readFileSync(new URL("hoursModel.version.json", dir), "utf8"));
    expect(pin.ruleVersion).toBe(HOURS_RULE_VERSION);
    expect(pin.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
  });
  test("fixtures contain no real addresses", () => {
    const roots = [new URL("./lib/hoursFixtures.ts", import.meta.url).pathname, new URL("../../../supabase/functions/cockpit-hours-sync/fixtures", import.meta.url).pathname];
    const files: string[] = [];
    for (const r of roots) {
      try {
        if (statSync(r).isDirectory()) for (const f of readdirSync(r)) files.push(join(r, f));
        else files.push(r);
      } catch { /* the folder is checked once it exists */ }
    }
    for (const f of files) if (statSync(f).isFile()) expect(readFileSync(f, "utf8")).not.toContain("@maharamedia.com");
  });
});

describe("Timetastic's day list is the second source for leave", () => {
  test("a booking the day list doesn't show, or a listed day no booking explains, blocks", () => {
    const b = booking("2026-10-14", "2026-10-14");
    const missing = one(person({ hubstaffDays: fullDays(["2026-10-14"]), bookings: [b], ttDays: [] }));
    expect(missing.status.reasons.find(r => r.code === "leave_unverified")?.days).toEqual(["2026-10-14"]);
    const stray = one(person({ hubstaffDays: fullDays(), ttDays: [{ day: "2026-10-15", kind: "booking", entityId: "x", detail: null }] }));
    expect(stray.status.reasons.find(r => r.code === "leave_unverified")?.days).toEqual(["2026-10-15"]);
  });
  test("a non-working day in Timetastic's own week explains a missing day", () => {
    const b = booking("2026-10-14", "2026-10-14");
    const pm = one(person({ hubstaffDays: fullDays(["2026-10-14"]), bookings: [b], ttDays: [{ day: "2026-10-14", kind: "non_working", entityId: "nwd", detail: null }] }));
    expect(pm.status.reasons.map(r => r.code)).not.toContain("leave_unverified");
  });
  test("No leave this month stands in for an unlinked Timetastic account", () => {
    const unlinked = person({ hubstaffDays: fullDays(), accounts: person().accounts.filter(a => a.provider === "hubstaff") });
    expect(one(unlinked).status.reasons.map(r => r.code)).toContain("timetastic_not_read");
    const settled = one({ ...unlinked, adjustments: [adj("no_leave_month")] });
    expect(settled.status.kind).toBe("ready");
  });
});

describe("not tracking now (4.7)", () => {
  const now = (minute: number, over: Partial<PersonInputs> = {}, lastOk = "2026-10-14T08:45:00Z") =>
    one(person({ hubstaffDays: fullDays().filter(d => d.day < "2026-10-14"), ...over }),
      { today: "2026-10-14", nowMinute: minute, sources: [{ ...inputs([]).sources[0], lastOkAt: lastOk }, inputs([]).sources[1]] }).now;
  test("no time 30 minutes after the start of the window flags, with the time it started", () => {
    expect(now(12 * 60 + 15)).toEqual({ kind: "not_tracking", since: "10:00", seconds: (2 * 60 + 15) * 60 });
    expect(now(10 * 60 + 20)).toBeNull();
  });
  test("a stale read can't tell; a person online is tracking", () => {
    expect(now(12 * 60, {}, "2026-10-14T06:00:00Z")).toMatchObject({ kind: "cant_tell" });
    const online = { accounts: person().accounts.map(a => (a.provider === "hubstaff" ? { ...a, online: true } : a)) };
    expect(now(12 * 60, online)?.kind).toBe("tracking");
  });
  test("optional, exempt and shadow-less fixed people are never flagged", () => {
    expect(now(12 * 60, { role: "Closer" })).toBeNull();
  });
});
