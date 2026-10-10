/**
 * Hours, leave and pay: the contract between the backend and the screens.
 * Source: scratchpad/hours/design.md section 6 (rule hours-1, 2026-10-09),
 * plus SourceState "firewall_blocked" from the CEO's decision that a
 * Cloudflare 403 (error 1010) is said as a firewall block, not a refused key.
 * Shared by the browser (screens, hoursModel.ts) and the Edge Functions
 * (cockpit-hours-api approval). Types only, plus the defaults and pay-setting list.
 */
export const HOURS_RULE_VERSION = "hours-1" as const;
export type Ymd = string; // "2026-10-14", Kuwait calendar
export type Ym = string; // "2026-10"
export type Seconds = number; // whole seconds ≥ 0; the rule works in seconds
export type Minutes = number; // display only
export type Provider = "hubstaff" | "timetastic";
export type Tracking = "required" | "optional" | "exempt";
export type PayBasis = "hours" | "fixed";

export type HoursSettings = {
  breakMinutes: number; // 60
  breakWhenLongerThanHours: number; // 6
  graceShare: number; // 0.02 of the target may be short and still paid; 0 = off
  overtime: { on: boolean; rate: number }; // { on: false, rate: 1.25 }; paid only above target
  manualTime: "review" | "counts"; // "review"
  countKeptIdle: boolean; // true
  keptIdleMaxMinutesPerDay: number; // 60
  countTrackedBreaks: boolean; // false
  dayLimitHours: number; // 12
  dayOffWork: "counts" | "needs_ok"; // "counts" (toward the month, never above base)
  correctionCapShare: number; // 0.10 of a month's pay, for negative corrections
  notTrackingAfterMinutes: number; // 30
  lowActivityShare: number | null; // null = off
};
export const HOURS_DEFAULTS: HoursSettings = {
  breakMinutes: 60,
  breakWhenLongerThanHours: 6,
  graceShare: 0.02,
  overtime: { on: false, rate: 1.25 },
  manualTime: "review",
  countKeptIdle: true,
  keptIdleMaxMinutesPerDay: 60,
  countTrackedBreaks: false,
  dayLimitHours: 12,
  dayOffWork: "counts",
  correctionCapShare: 0.1,
  notTrackingAfterMinutes: 30,
  lowActivityShare: null,
};
/** Settings that change pay; only these go into the approval hash. */
export const PAY_SETTINGS: (keyof HoursSettings)[] = [
  "breakMinutes",
  "breakWhenLongerThanHours",
  "graceShare",
  "overtime",
  "manualTime",
  "countKeptIdle",
  "keptIdleMaxMinutesPerDay",
  "countTrackedBreaks",
  "dayLimitHours",
  "dayOffWork",
  "correctionCapShare",
];
export type RulesVersion = {
  fromMonth: Ym;
  settings: Partial<HoursSettings>;
  savedBy: string;
  savedAt: string;
};

export type KeyKind = "hubstaff_org" | "hubstaff_personal" | "timetastic";
export type SourceState =
  | "connected"
  | "unchecked"
  | "missing_key"
  | "refused"
  | "plan_blocked"
  | "needs_new_key"
  | "failing"
  | "stale"
  | "expiring"
  | "never_run"
  // Hubstaff's Cloudflare firewall stopped the request (403, error 1010): not
  // the key's fault, never shown as "refused" (CEO decision, 2026-10-09).
  | "firewall_blocked";
export type SourceStatus = {
  provider: Provider;
  state: SourceState;
  note: string | null; // the exact sentence, section 2.7
  key: {
    kind: KeyKind;
    last4: string;
    savedAt: string;
    savedBy: string;
    expiresOn: Ymd | null;
  } | null;
  accountId: string | null; // Hubstaff or Timetastic organisation id
  lastRunAt: string | null;
  lastOkAt: string | null;
  zoneShiftedDays: number; // Hubstaff: days read with another org date
  accounts: number;
  linked: number;
  unlinked: number;
  ignored: number;
};

export type LeaveTypeRule = {
  externalId: string;
  name: string;
  active: boolean;
  deducted: boolean;
  requiresApproval: boolean;
  payRule: "paid" | "unpaid" | "part" | "not_leave" | null;
  paidShare: number | null; // in force for the month
  ruleFromMonth: Ym | null;
  suggested: "paid" | "unpaid" | "not_leave" | null;
  bookingsThisMonth: number;
};
export type HolidayOverride = {
  id: number;
  day: Ymd;
  action: "add" | "remove";
  name: string;
  scope: "all" | "country" | "person";
  scopeValue: string | null;
  reason: string;
};

export type AdjustmentKind =
  | "absent_unpaid"
  | "excused_paid"
  | "hours"
  | "leave"
  | "count_work"
  | "overtime"
  | "manual_time"
  | "not_booked"
  | "no_leave_month"
  | "correction";
export type DaySnapshot = {
  trackedS: Seconds | null;
  manualS: Seconds | null;
  covered: boolean;
  leaveS: Seconds;
};
export type Adjustment = {
  id: number;
  kind: AdjustmentKind;
  month: Ym;
  day: Ymd | null;
  seconds: Seconds | null; // hours, count_work, overtime; manual_time = minutes decided, in seconds
  mode: "replace" | "add" | null; // hours only, fixed when entered
  paidShare: number | null; // leave only
  decision: "count" | "skip" | null; // manual_time only
  bookingId: string | null; // not_booked only (pending or approved bookings)
  amount: number | null;
  currency: string | null;
  fromMonth: Ym | null;
  carried: boolean; // correction
  snapshot: DaySnapshot | null; // day kinds: the day as it was when decided
  reason: string;
  setBy: string;
  setAt: string;
};

export type Booking = {
  bookingId: string;
  ttUserId: string;
  leaveTypeId: string;
  leaveTypeName: string;
  status: "Pending" | "Approved" | "Cancelled" | "Declined";
  startAt: string;
  startType: "Morning" | "Afternoon" | "Hours";
  endAt: string;
  endType: "Morning" | "Afternoon" | "Hours";
  bookingUnit: "Days" | "Hours";
  deduction: number | null;
  requestedById: string | null;
  actionerId: string | null;
  autoApproved: boolean;
};
export type TtDay = {
  day: Ymd;
  kind: "booking" | "public_holiday" | "non_working";
  entityId: string;
  detail: string | null;
};
export type Holiday = {
  day: Ymd;
  name: string;
  source: "timetastic" | "override" | "company";
};
export type HubstaffDay = {
  day: Ymd;
  trackedS: Seconds;
  manualS: Seconds;
  idleS: Seconds;
  breakS: Seconds;
  overallS: Seconds;
  inputTrackedS: Seconds;
  dailyTrackedS: Seconds | null;
  zoneShifted: boolean;
  verified: boolean;
  previousTrackedS: Seconds | null;
  changedAt: string | null;
};
export type ProviderRows = {
  hubstaffDays: HubstaffDay[];
  bookings: Booking[];
  ttDays: TtDay[];
  holidays: Holiday[];
  coverage: Record<Provider, Ymd[]>; // days with a complete read (no timestamps: they change nightly)
};

export type Approval = {
  status: "approved" | "paid";
  ruleVersion: string;
  inputsHash: string;
  shadow: boolean;
  amount: number;
  currency: string;
  amountUsd: number | null;
  payableS: Seconds;
  approvedAt: string;
  approvedBy: string;
  paidAt: string | null;
  paidNote: string | null;
  inputs: PersonInputs; // the snapshot used to recompute "changed since approved"
  result: PersonMonth;
};
export type PriorApproval = {
  month: Ym;
  approval: Approval;
  current: ProviderRows;
  carried: number;
};

/** RPC cockpit_ceo_hours_inputs(p_month) → this, camelCase, built field by field (never to_jsonb(row)). */
export type HoursInputs = {
  month: Ym;
  today: Ymd;
  nowMinute: number; // Kuwait clock
  rules: RulesVersion | null; // in force for M; null = defaults
  sources: SourceStatus[];
  coverage: Record<Provider, Ymd[]>;
  closed: Record<Provider, boolean>; // a complete read after 00:00 KW on the 3rd of M+1
  leaveTypes: LeaveTypeRule[];
  holidayOverrides: HolidayOverride[];
  ceoTtUserId: string | null; // to spot leave the CEO didn't approve
  people: PersonInputs[]; // everyone not deleted; the model decides who counts
  usdPer: Record<string, number>; // the Costs page's fixed rates (display only)
};
export type PersonInputs = {
  personId: number;
  name: string;
  role: string | null;
  engagement: "staff" | "freelancer" | "agency" | "intern" | "bot";
  active: boolean;
  startedOn: Ymd | null;
  endedOn: Ymd | null;
  addedOn: Ymd;
  employment: { kind: "employed" | "paused"; from: Ymd; to: Ymd | null }[];
  terms: {
    tracking: Tracking | null;
    payBasis: PayBasis | null;
    hoursPayFrom: Ym | null;
    termsConfirmedAt: string | null;
    contractCountry: string | null;
    worksIn: string | null;
    kwClauseReviewedAt: string | null;
  };
  schedules: { effectiveFrom: Ymd; schedule: unknown }[]; // rows in force during M; parseSchedule()
  payHistory: {
    effectiveFrom: Ymd;
    monthlyCost: number | null;
    currency: string;
    source: "seed" | "roster" | "dated";
  }[];
  accounts: {
    provider: Provider;
    externalId: string;
    email: string | null;
    name: string | null;
    linkMethod: "payroll_id" | "email" | "manual";
    status: string | null;
    memberSince: Ymd | null;
    removedOn: Ymd | null;
    trackable: boolean | null;
    lastClientActivityOn: Ymd | null;
    online: boolean | null;
    lastActivityAt: string | null; // not hashed
    allowanceRemaining: number | null;
    allowanceUnit: "Days" | "Hours" | null; // not hashed
    scheduleMismatch: string | null;
    emailDiffers: boolean;
  }[];
  hubstaffDays: HubstaffDay[];
  bookings: Booking[]; // overlapping M, any status
  ttDays: TtDay[]; // Timetastic's own per-day list for M
  holidays: Holiday[]; // after overrides
  adjustments: Adjustment[]; // active ones for M, corrections targeting M included
  sickDaysThisYear: number | null; // for the Kuwait note
  approval: Approval | null;
  priorApprovals: PriorApproval[]; // approved months among the 6 before M
};

export type StatusKind =
  | "in_progress"
  | "not_ready"
  | "needs_review"
  | "ready"
  | "approved"
  | "paid";
export type ReasonCode =
  // blocks
  | "no_role"
  | "no_pay"
  | "no_schedule"
  | "last_day_missing"
  | "currency_changed"
  | "correction_currency"
  | "leave_type_without_rule"
  | "timetastic_not_read"
  | "leave_unverified"
  | "hubstaff_not_connected"
  | "hubstaff_not_linked"
  | "no_data_days"
  | "hours_unverified"
  | "final_read_pending"
  // the four questions
  | "absent_no_leave"
  | "manual_time"
  | "pending_leave"
  | "entered_vs_hubstaff"
  // notes
  | "worked_day_off"
  | "day_off_not_counted"
  | "worked_during_leave"
  | "over_day_limit"
  | "idle_not_counted"
  | "extra_hours"
  | "low_activity"
  | "email_differs"
  | "schedule_mismatch"
  | "pay_history_assumed"
  | "start_date_assumed"
  | "zone_shifted"
  | "decision_overtaken"
  | "holiday_on_day_off"
  | "kw_sick_days"
  | "kw_rest_day_work"
  | "changed_since_approved";
export type Reason = {
  code: ReasonCode;
  severity: "blocks" | "decide" | "note";
  text: string;
  days?: Ymd[];
  seconds?: Seconds;
};
export type LookAt = {
  code:
    | "leave_not_ceo_approved"
    | "over_allowance"
    | "start_date_assumed"
    | "hubstaff_dropped"
    | "carried_change"
    | "correction_capped"
    | "zone_shifted";
  text: string;
  amount?: number;
  fromMonth?: Ym;
};

export type DayKind =
  | "not_employed"
  | "off"
  | "future"
  | "today"
  | "worked"
  | "short"
  | "leave_paid"
  | "leave_unpaid"
  | "leave_part"
  | "holiday"
  | "no_data"
  | "unverified"
  | "absent"
  | "absent_confirmed"
  | "excused"
  | "worked_day_off";
export type DayView = {
  day: Ymd;
  kind: DayKind;
  expected: Seconds;
  counted: Seconds | null; // null = no data
  tracked: Seconds | null;
  paidLeave: Seconds;
  unpaid: Seconds;
  holiday: string | null;
  leave: {
    name: string;
    part: "full" | "am" | "pm" | "hours";
    status: Booking["status"];
  }[];
  adjustmentIds: number[];
  label: string; // aria-label sentence
};

export type Segment = {
  from: Ymd;
  to: Ymd;
  /** Null when no pay is set for these days: never shown as a zero. */
  base: number | null;
  target: Seconds;
  payable: Seconds;
  /** Null when the base is unknown. */
  amount: number | null;
};

export type PersonMonth = {
  personId: number;
  name: string;
  role: string | null;
  currency: string;
  tracking: { value: Tracking; from: "set" | "role_default" };
  payBasis: { value: PayBasis; from: "set" | "role_default" };
  paysOnHours: boolean;
  shadow: boolean;
  hours: {
    expected: Seconds;
    fullMonth: Seconds;
    unpaid: Seconds;
    target: Seconds;
    tracked: Seconds | null;
    manual: Seconds | null;
    manualCounted: Seconds | null;
    paidLeave: Seconds;
    holidays: Seconds;
    excused: Seconds;
    entered: Seconds;
    counted: Seconds | null;
    forgiven: Seconds;
    payable: Seconds | null;
    extra: Seconds;
    workedOnDaysOff: Seconds;
    overDayLimit: Seconds;
    idleNotCounted: Seconds;
    overtimePaid: Seconds;
    /** Seconds of no-data days inside `counted` (counted as worked until read). */
    noData: Seconds;
  };
  segments: Segment[];
  pay: {
    amount: number | null;
    overtime: number;
    corrections: {
      applied: number;
      /** The rest of a capped negative correction, carried into next month (0 for someone who has left). */
      carriedOut: number;
      lines: {
        fromMonth: Ym | null;
        amount: number;
        applied: number;
        carried: boolean;
      }[];
    };
    total: number | null;
    provisional: boolean;
    shadowAmount: number | null;
    shadowUndecidedDays: number;
    totalUsd: number | null;
    valuePerHour: number | null;
  };
  status: { kind: StatusKind; reasons: Reason[] };
  lookAt: LookAt[]; // lines for the approve dialog
  days: DayView[];
  activity: { share: number | null; inputSeconds: Seconds };
  leaveLeft: { amount: number; unit: "Days" | "Hours" } | null;
  now: NowFlag | null;
  approval: Approval | null;
  changedSinceApproval: {
    seconds: number;
    amount: number;
    alreadyCarried: number;
  } | null;
  inputsHash: string; // sha256 of canonicalPersonInputs(); "" until hashed
};
export type NowFlag =
  | { kind: "tracking"; trackedToday: Seconds }
  | { kind: "not_tracking"; since: string; seconds: Seconds }
  | { kind: "stopped"; at: string }
  | { kind: "cant_tell"; lastReadAt: string | null };

export type HoursMonth = {
  month: Ym;
  ruleVersion: string;
  settings: HoursSettings;
  sources: SourceStatus[];
  closed: Record<Provider, { ok: boolean; finalReadOn: Ymd }>;
  people: PersonMonth[]; // includes "Owed after leaving" people
  notCounted: {
    personId: number;
    name: string;
    why: "ceo" | "bot" | "no_role" | "not_employed";
  }[];
  totals: {
    expected: Seconds;
    counted: Seconds | null;
    paidLeave: Seconds;
    holidays: Seconds;
    payUsd: number | null;
    payProvisional: boolean;
    payMissing: string[];
    byStatus: Record<StatusKind, number>;
  };
  notTrackingNow: {
    personId: number;
    name: string;
    role: string | null;
    flag: NowFlag;
  }[];
  leaveTypesWithoutRule: {
    externalId: string;
    name: string;
    bookings: number;
  }[];
};

export type ApproveItem = {
  personId: number;
  inputsHash: string;
  amount: number;
  payableS: Seconds;
  ruleVersion: string;
};
export type ApproveResult =
  | {
      personId: number;
      ok: true;
      approvedAt: string;
      amount: number;
      currency: string;
      existing: boolean;
    }
  | {
      personId: number;
      ok: false;
      code: "changed" | "not_ready" | "rule_mismatch";
      text: string;
    };

/**
 * One Hubstaff or Timetastic account from the last read, linked to a person
 * or not: the Link accounts view lists the unlinked ones. Added at
 * integration (not in section 6): `cockpit_ceo_hours_status().accounts`.
 */
export type HoursAccount = {
  provider: Provider;
  externalId: string;
  email: string | null;
  name: string | null;
  status: string | null;
  membershipRole: string | null;
  personId: number | null;
  linkMethod: "payroll_id" | "email" | "manual" | null;
  ignored: boolean;
  emailDiffers: boolean;
};
/** RPC cockpit_ceo_hours_status() → this (no pay, no keys). `accounts` is null when the server sends none. */
export type HoursStatus = {
  sources: SourceStatus[];
  lastRun: {
    id: number;
    mode: string;
    state: string;
    finishedAt: string | null;
  } | null;
  cronScheduled: boolean | null;
  accounts: HoursAccount[] | null;
};
