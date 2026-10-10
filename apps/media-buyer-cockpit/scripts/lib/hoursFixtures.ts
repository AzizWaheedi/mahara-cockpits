/**
 * Made-up people and figures for the hours rule tests. Every name, email and
 * amount here is invented; no real person or salary appears.
 */
import type {
  Adjustment,
  Booking,
  HoursInputs,
  HubstaffDay,
  LeaveTypeRule,
  PersonInputs,
  SourceStatus,
  TtDay,
  Ym,
  Ymd,
} from "../../src/types/ceo/hoursContract";
import { daysOfMonth } from "../../src/types/ceo/hoursModel";

export const H = 3600;

export const WEEK = {
  timezone: "Asia/Kuwait",
  week: {
    mon: { on: true, start: "10:00", end: "18:00" },
    tue: { on: true, start: "10:00", end: "18:00" },
    wed: { on: true, start: "10:00", end: "18:00" },
    thu: { on: true, start: "10:00", end: "18:00" },
    fri: { on: false, start: "10:00", end: "18:00" },
    sat: { on: true, start: "10:00", end: "18:00" },
    sun: { on: true, start: "10:00", end: "18:00" },
  },
  exceptions: [],
};

export function workingDays(month: Ym): Ymd[] {
  return daysOfMonth(month).filter(d => new Date(`${d}T00:00:00Z`).getUTCDay() !== 5);
}

export function hub(day: Ymd, hours: number, extra: Partial<HubstaffDay> = {}): HubstaffDay {
  const trackedS = Math.round(hours * H);
  return {
    day, trackedS, manualS: 0, idleS: 0, breakS: 0, overallS: Math.round(trackedS * 0.5), inputTrackedS: trackedS,
    dailyTrackedS: trackedS, zoneShifted: false, verified: true, previousTrackedS: null, changedAt: null, ...extra,
  };
}

let bookingSeq = 1000;
export function booking(start: Ymd, end: Ymd, extra: Partial<Booking> = {}): Booking {
  bookingSeq++;
  return {
    bookingId: String(bookingSeq), ttUserId: "tt-1", leaveTypeId: "annual", leaveTypeName: "Annual leave",
    status: "Approved", startAt: `${start}T00:00:00`, startType: "Morning", endAt: `${end}T00:00:00`, endType: "Afternoon",
    bookingUnit: "Days", deduction: 1, requestedById: "tt-1", actionerId: "tt-ceo", autoApproved: false, ...extra,
  };
}

/** Timetastic's own per-day list for a booking, on the roster's working days. */
export function ttDaysFor(b: Booking): TtDay[] {
  const out: TtDay[] = [];
  for (let d = b.startAt.slice(0, 10); d <= b.endAt.slice(0, 10); d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 5) out.push({ day: d, kind: "booking", entityId: b.bookingId, detail: b.leaveTypeName });
  return out;
}

let adjSeq = 1;
export function adj(kind: Adjustment["kind"], over: Partial<Adjustment> = {}): Adjustment {
  return {
    id: adjSeq++, kind, month: "2026-10", day: null, seconds: null, mode: null, paidShare: null, decision: null,
    bookingId: null, amount: null, currency: null, fromMonth: null, carried: false, snapshot: null,
    reason: "Made-up test decision", setBy: "ceo@example.test", setAt: "2026-11-02T08:00:00Z", ...over,
  };
}

export const LEAVE_TYPES: LeaveTypeRule[] = [
  { externalId: "annual", name: "Annual leave", active: true, deducted: true, requiresApproval: true, payRule: "paid", paidShare: null, ruleFromMonth: "2000-01", suggested: "paid", bookingsThisMonth: 0 },
  { externalId: "unpaid", name: "Unpaid leave", active: true, deducted: false, requiresApproval: true, payRule: "unpaid", paidShare: null, ruleFromMonth: "2000-01", suggested: "unpaid", bookingsThisMonth: 0 },
  { externalId: "half", name: "Half-paid leave", active: true, deducted: true, requiresApproval: true, payRule: "part", paidShare: 0.5, ruleFromMonth: "2000-01", suggested: null, bookingsThisMonth: 0 },
  { externalId: "wfh", name: "Working from home", active: true, deducted: false, requiresApproval: false, payRule: "not_leave", paidShare: null, ruleFromMonth: "2000-01", suggested: "not_leave", bookingsThisMonth: 0 },
  { externalId: "compassionate", name: "Compassionate", active: true, deducted: true, requiresApproval: true, payRule: null, paidShare: null, ruleFromMonth: null, suggested: "paid", bookingsThisMonth: 1 },
];

export function source(provider: "hubstaff" | "timetastic", over: Partial<SourceStatus> = {}): SourceStatus {
  return {
    provider, state: "connected", note: null,
    key: { kind: provider === "hubstaff" ? "hubstaff_org" : "timetastic", last4: "x9Qa", savedAt: "2026-10-09T08:00:00Z", savedBy: "ceo@example.test", expiresOn: null },
    accountId: provider === "hubstaff" ? "900001" : "900002", lastRunAt: "2026-11-05T09:17:00Z", lastOkAt: "2026-11-05T09:17:00Z",
    zoneShiftedDays: 0, accounts: 1, linked: 1, unlinked: 0, ignored: 0, ...over,
  };
}

/** An hours-paid call centre agent with a made-up $910 base, switched over from October 2026. */
export function person(over: Partial<PersonInputs> = {}): PersonInputs {
  return {
    personId: 1, name: "Person A", role: "Call centre agent", engagement: "staff", active: true,
    startedOn: "2026-01-01", endedOn: null, addedOn: "2026-01-01",
    employment: [{ kind: "employed", from: "2026-01-01", to: null }],
    terms: { tracking: null, payBasis: null, hoursPayFrom: "2026-09", termsConfirmedAt: "2026-08-20T08:00:00Z", contractCountry: "EG", worksIn: "EG", kwClauseReviewedAt: null },
    schedules: [{ effectiveFrom: "2026-01-01", schedule: WEEK }],
    payHistory: [{ effectiveFrom: "2026-01-01", monthlyCost: 910, currency: "USD", source: "seed" }],
    accounts: [
      { provider: "hubstaff", externalId: "hs-1", email: "person1@example.test", name: "Person A", linkMethod: "email", status: "active", memberSince: "2026-01-01", removedOn: null, trackable: true, lastClientActivityOn: null, online: false, lastActivityAt: null, allowanceRemaining: null, allowanceUnit: null, scheduleMismatch: null, emailDiffers: false },
      { provider: "timetastic", externalId: "tt-1", email: "person1@example.test", name: "Person A", linkMethod: "payroll_id", status: "active", memberSince: null, removedOn: null, trackable: null, lastClientActivityOn: null, online: null, lastActivityAt: null, allowanceRemaining: 12.5, allowanceUnit: "Days", scheduleMismatch: null, emailDiffers: false },
    ],
    hubstaffDays: [], bookings: [], ttDays: [], holidays: [], adjustments: [],
    sickDaysThisYear: 0, approval: null, priorApprovals: [],
    ...over,
  };
}

export function inputs(people: PersonInputs[], over: Partial<HoursInputs> = {}): HoursInputs {
  const month = over.month ?? "2026-10";
  const all = daysOfMonth(month);
  return {
    month, today: "2026-11-05", nowMinute: 12 * 60, rules: null,
    sources: [source("hubstaff"), source("timetastic")],
    coverage: { hubstaff: all, timetastic: all },
    closed: { hubstaff: true, timetastic: true },
    leaveTypes: LEAVE_TYPES, holidayOverrides: [], ceoTtUserId: "tt-ceo", people,
    usdPer: { USD: 1, KWD: 3.26, AED: 0.2723, SAR: 0.2666, QAR: 0.2747 },
    ...over,
  };
}

/** Full 7 h days on every working day of October except the ones listed. */
export function fullDays(except: Ymd[] = [], hours = 7, month: Ym = "2026-10"): HubstaffDay[] {
  return workingDays(month).filter(d => !except.includes(d)).map(d => hub(d, hours));
}
