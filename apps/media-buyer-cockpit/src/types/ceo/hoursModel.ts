/**
 * Hours, leave and pay: the pure rule, `hours-1` (design.md section 4).
 *
 * No I/O and no clock: `today` and `nowMinute` come in with the inputs. All
 * arithmetic is in whole seconds, summed for the month and converted to money
 * once; money is rounded once per line to the currency's minor unit (3
 * decimals for KWD, 2 otherwise). The same file runs in the browser (the Team
 * & payroll screens) and on the server (cockpit-hours-api, at approval), so
 * what the CEO approves is exactly what he saw. hoursModel.version.json pins
 * this file's sha256 to the rule version; a test fails when one moves alone.
 *
 * The hash (`hashMonth`, `hashPerson`) is the only async part.
 */
import {
  type Adjustment,
  type Approval,
  type Booking,
  type DayKind,
  type DayView,
  HOURS_DEFAULTS,
  HOURS_RULE_VERSION,
  type HolidayOverride,
  type HoursInputs,
  type HoursMonth,
  type HoursSettings,
  type HubstaffDay,
  type LeaveTypeRule,
  type LookAt,
  type NowFlag,
  PAY_SETTINGS,
  type PayBasis,
  type PersonInputs,
  type PersonMonth,
  type PriorApproval,
  type Provider,
  type ProviderRows,
  type Reason,
  type ReasonCode,
  type RulesVersion,
  type Seconds,
  type Segment,
  type SourceStatus,
  type StatusKind,
  type Tracking,
  type Ym,
  type Ymd,
} from "./hoursContract.ts";
import {
  defaultSchedule,
  minutesOf,
  parseSchedule,
  type Schedule,
  windowOn,
} from "./schedule.ts";

// ---------------------------------------------------------------------------
// Context

/** Everything about the month that is not one person. */
export type MonthCtx = {
  month: Ym;
  today: Ymd;
  nowMinute: number;
  ruleVersion: string;
  rules: RulesVersion | null;
  settings: HoursSettings;
  sources: SourceStatus[];
  coverage: Record<Provider, Ymd[]>;
  closed: Record<Provider, boolean>;
  leaveTypes: LeaveTypeRule[];
  holidayOverrides: HolidayOverride[];
  ceoTtUserId: string | null;
  usdPer: Record<string, number>;
};

/** The settings in force: the saved version merged over the defaults. */
export function settingsOf(
  rules: RulesVersion | null | undefined,
): HoursSettings {
  const saved = (rules?.settings ?? {}) as Partial<HoursSettings>;
  return {
    ...HOURS_DEFAULTS,
    ...saved,
    overtime: { ...HOURS_DEFAULTS.overtime, ...(saved.overtime ?? {}) },
  };
}

export function contextOf(inputs: HoursInputs): MonthCtx {
  return {
    month: inputs.month,
    today: inputs.today,
    nowMinute: inputs.nowMinute,
    ruleVersion: HOURS_RULE_VERSION,
    rules: inputs.rules ?? null,
    settings: settingsOf(inputs.rules),
    sources: inputs.sources ?? [],
    coverage: {
      hubstaff: inputs.coverage?.hubstaff ?? [],
      timetastic: inputs.coverage?.timetastic ?? [],
    },
    closed: {
      hubstaff: inputs.closed?.hubstaff === true,
      timetastic: inputs.closed?.timetastic === true,
    },
    leaveTypes: inputs.leaveTypes ?? [],
    holidayOverrides: inputs.holidayOverrides ?? [],
    ceoTtUserId: inputs.ceoTtUserId ?? null,
    usdPer: inputs.usdPer ?? {},
  };
}

// ---------------------------------------------------------------------------
// Calendar helpers (Kuwait calendar days as "YYYY-MM-DD")

export function addDays(day: Ymd, n: number): Ymd {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
export function monthOf(day: Ymd): Ym {
  return day.slice(0, 7);
}
export function firstDay(month: Ym): Ymd {
  return `${month}-01`;
}
export function lastDay(month: Ym): Ymd {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function nextMonth(month: Ym): Ym {
  return monthOf(addDays(lastDay(month), 1));
}
export function prevMonth(month: Ym): Ym {
  return monthOf(addDays(firstDay(month), -1));
}
export function daysOfMonth(month: Ym): Ymd[] {
  const out: Ymd[] = [];
  for (
    let d = firstDay(month), end = lastDay(month);
    d <= end;
    d = addDays(d, 1)
  )
    out.push(d);
  return out;
}
const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function weekday(day: Ymd): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
/** "Tue 6 Oct". */
export function shortDay(day: Ymd): string {
  const [, m, d] = day.split("-").map(Number);
  return `${WEEKDAY[weekday(day)].slice(0, 3)} ${d} ${MONTH[m - 1].slice(0, 3)}`;
}
/** "Tuesday 6 October". */
export function longDay(day: Ymd): string {
  const [, m, d] = day.split("-").map(Number);
  return `${WEEKDAY[weekday(day)]} ${d} ${MONTH[m - 1]}`;
}
/** "October". */
export function monthName(month: Ym): string {
  return MONTH[Number(month.slice(5, 7)) - 1];
}

// ---------------------------------------------------------------------------
// Words and money

/** "3 h 38 min", "7 h", "45 min", "0 h". Seconds below a minute are dropped. */
export function hoursText(seconds: Seconds): string {
  const sign = seconds < 0 ? "−" : "";
  const minutes = Math.floor(Math.abs(seconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h && !m) return "0 h";
  return (
    sign + [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ")
  );
}
export function minorDigits(currency: string): number {
  return currency.toUpperCase() === "KWD" ? 3 : 2;
}
/** Round half away from zero to the currency's minor unit. */
export function roundMinor(value: number, currency: string): number {
  const f = 10 ** minorDigits(currency);
  const scaled = value * f;
  const r = Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-9);
  return (r === 0 ? 0 : r) / f;
}
export function moneyText(value: number, currency: string): string {
  const digits = minorDigits(currency);
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = value < 0 ? "−" : "";
  return currency.toUpperCase() === "USD"
    ? `${sign}$${abs}`
    : `${sign}${currency.toUpperCase()} ${abs}`;
}

// ---------------------------------------------------------------------------
// Role defaults (4.1)

export type RoleDefault = {
  /** False for the CEO and bots: listed under "Not counted". */
  counted: boolean;
  why: "ceo" | "bot" | null;
  /** No role set: blocked until one is. */
  noRole: boolean;
  tracking: Tracking;
  payBasis: PayBasis;
  /** The role matched a row of the table; false falls back to optional and fixed. */
  known: boolean;
};

const ROLE_TABLE: { test: RegExp; tracking: Tracking; payBasis: PayBasis }[] = [
  { test: /call\s*cent(re|er)/i, tracking: "required", payBasis: "hours" },
  { test: /media\s*buy/i, tracking: "required", payBasis: "hours" },
  { test: /video\s*edit|\beditor\b/i, tracking: "optional", payBasis: "fixed" },
  { test: /\bcloser\b/i, tracking: "optional", payBasis: "fixed" },
  { test: /setter/i, tracking: "optional", payBasis: "fixed" },
  {
    test: /client\s*success|\bcsm\b/i,
    tracking: "optional",
    payBasis: "fixed",
  },
  { test: /creative\s*strateg/i, tracking: "exempt", payBasis: "fixed" },
  { test: /systems?\s*manag/i, tracking: "exempt", payBasis: "fixed" },
  { test: /\bva\b|virtual\s*assist/i, tracking: "exempt", payBasis: "fixed" },
];

/**
 * Null terms mean the role default. Order: not counted (CEO, bot), then no
 * role, then freelancer or agency (exempt, fixed: paid on invoice), then the
 * role table. Interns follow their role. A role not in the table is optional
 * and fixed: hours shown, pay never moved by them.
 */
export function roleDefaults(
  role: string | null,
  engagement: PersonInputs["engagement"],
): RoleDefault {
  const r = (role ?? "").trim();
  if (engagement === "bot" || /\bbot\b/i.test(r))
    return {
      counted: false,
      why: "bot",
      noRole: false,
      tracking: "exempt",
      payBasis: "fixed",
      known: true,
    };
  if (/\bceo\b|founder|chief executive/i.test(r))
    return {
      counted: false,
      why: "ceo",
      noRole: false,
      tracking: "exempt",
      payBasis: "fixed",
      known: true,
    };
  if (!r)
    return {
      counted: true,
      why: null,
      noRole: true,
      tracking: "exempt",
      payBasis: "fixed",
      known: false,
    };
  if (engagement === "freelancer" || engagement === "agency")
    return {
      counted: true,
      why: null,
      noRole: false,
      tracking: "exempt",
      payBasis: "fixed",
      known: true,
    };
  const hit = ROLE_TABLE.find(x => x.test.test(r));
  if (hit)
    return {
      counted: true,
      why: null,
      noRole: false,
      tracking: hit.tracking,
      payBasis: hit.payBasis,
      known: true,
    };
  return {
    counted: true,
    why: null,
    noRole: false,
    tracking: "optional",
    payBasis: "fixed",
    known: false,
  };
}

// ---------------------------------------------------------------------------
// Small pure pieces exported for tests and screens

/** The schedule in force on `day`: the latest row with effectiveFrom ≤ day. Null when none (or unreadable). */
export function scheduleOn(
  schedules: PersonInputs["schedules"],
  day: Ymd,
): Schedule | null {
  let best: PersonInputs["schedules"][number] | null = null;
  for (const row of schedules)
    if (
      row.effectiveFrom <= day &&
      (!best || row.effectiveFrom > best.effectiveFrom)
    )
      best = row;
  return best ? parseSchedule(best.schedule) : null;
}

/** Net expected seconds on a day: the window, less the unpaid break on days longer than the threshold. */
export function netSeconds(
  schedule: Schedule | null,
  day: Ymd,
  settings: HoursSettings,
): Seconds {
  if (!schedule) return 0;
  const w = windowOn(schedule, day);
  if (!w) return 0;
  const span = (minutesOf(w.end) - minutesOf(w.start)) * 60;
  return span > settings.breakWhenLongerThanHours * 3600
    ? Math.max(0, span - settings.breakMinutes * 60)
    : span;
}

export type Period = PersonInputs["employment"][number];

/** Inside an employed period and outside every paused one (both ends inclusive). */
export function employedOn(periods: Period[], day: Ymd): boolean {
  const inside = (p: Period) => p.from <= day && (p.to === null || day <= p.to);
  return (
    periods.some(p => p.kind === "employed" && inside(p)) &&
    !periods.some(p => p.kind === "paused" && inside(p))
  );
}

/** Largest-remainder split of P across targets, so the shares sum exactly to P. Ties go to the earlier segment. */
export function shareBySegments(P: Seconds, targets: Seconds[]): Seconds[] {
  const total = targets.reduce((a, b) => a + b, 0);
  if (total <= 0 || P <= 0) return targets.map(() => 0);
  const raw = targets.map(t => (P * t) / total);
  const out = raw.map(x => Math.floor(x));
  let left = P - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--)
    out[order[k].i] += 1;
  return out;
}

/** Seconds since midnight of a local "YYYY-MM-DDTHH:MM[:SS]" (any zone suffix ignored: Timetastic sends local times). */
function clockSeconds(at: string): number | null {
  const m = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(at);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
}

export type DayPart = {
  part: "full" | "am" | "pm" | "hours";
  seconds: Seconds;
};

/**
 * What one booking covers on one day, before the day's order fills it: the
 * full expected day, half of it (an Afternoon start on the first day, a
 * Morning end on the last), or, for an Hours booking, its overlap with the
 * working window. Null when the booking does not cover the day or the day
 * has no expected hours.
 */
export function dayParts(
  booking: Pick<
    Booking,
    "startAt" | "startType" | "endAt" | "endType" | "bookingUnit"
  >,
  day: Ymd,
  window: { start: string; end: string } | null,
  expected: Seconds,
): DayPart | null {
  const from = booking.startAt.slice(0, 10);
  const to = booking.endAt.slice(0, 10);
  if (day < from || day > to || expected <= 0) return null;
  if (
    booking.bookingUnit === "Hours" ||
    booking.startType === "Hours" ||
    booking.endType === "Hours"
  ) {
    if (!window) return null;
    const s = day === from ? clockSeconds(booking.startAt) : 0;
    const e = day === to ? clockSeconds(booking.endAt) : 86_400;
    if (s === null || e === null) return { part: "hours", seconds: expected };
    const ws = minutesOf(window.start) * 60;
    const we = minutesOf(window.end) * 60;
    const overlap = Math.max(0, Math.min(e, we) - Math.max(s, ws));
    return overlap > 0
      ? { part: "hours", seconds: Math.min(overlap, expected) }
      : null;
  }
  const half = Math.floor(expected / 2);
  const pmOnly = day === from && booking.startType === "Afternoon";
  const amOnly = day === to && booking.endType === "Morning";
  if (pmOnly && amOnly) return { part: "pm", seconds: half };
  if (pmOnly) return { part: "pm", seconds: half };
  if (amOnly) return { part: "am", seconds: half };
  return { part: "full", seconds: expected };
}

// ---------------------------------------------------------------------------
// One person and month

type DayCalc = {
  day: Ymd;
  employed: boolean;
  net: Seconds;
  e: Seconds;
  window: { start: string; end: string } | null;
  holiday: string | null;
  H: Seconds;
  hub:
    | "not_connected"
    | "not_linked"
    | "not_covered"
    | "unverified"
    | "covered";
  past: boolean;
  tracked: Seconds | null;
  manual: Seconds;
  /** Work as counted for the day, or null when there is no data. */
  w: Seconds | null;
  Win: Seconds;
  Wx: Seconds;
  WxCounted: Seconds;
  offDay: boolean;
  PL: Seconds;
  UL: Seconds;
  rem: Seconds;
  Ex: Seconds;
  A: Seconds;
  undecided: Seconds;
  noData: Seconds;
  overLimit: Seconds;
  idleNC: Seconds;
  entered: Seconds;
  leave: DayView["leave"];
  leaveSeconds: Seconds;
  pendingBookings: Booking[];
  question: boolean;
  adjustmentIds: number[];
  decisionOvertaken: boolean;
};

type PassOpts = {
  /** Count Hubstaff work. False for fixed pay: the figure moves only with booked unpaid leave. */
  useWork: boolean;
  /** Count all manual time (shadow, or manualTime = counts). */
  manualAll: boolean;
  /** Undecided days with nothing tracked count as absent. */
  undecidedAbsent: boolean;
};

type Pass = {
  days: DayCalc[];
  E: Seconds;
  U: Seconds;
  T: Seconds;
  C: Seconds;
  noData: Seconds;
  missingRules: Map<string, { name: string; bookings: Set<string> }>;
  manualTotal: Seconds;
  manualUndecided: Seconds;
  manualCounted: Seconds;
};

const DAY_KINDS = new Set([
  "absent_unpaid",
  "excused_paid",
  "hours",
  "leave",
  "count_work",
  "overtime",
]);
const PROVIDER_DOWN = new Set<SourceStatus["state"]>([
  "missing_key",
  "refused",
  "plan_blocked",
  "needs_new_key",
]);

type Prepared = {
  p: PersonInputs;
  ctx: MonthCtx;
  days: Ymd[];
  periods: Period[];
  startAssumed: boolean;
  lastDayMissing: boolean;
  noSchedule: boolean;
  companyWeek: boolean;
  netByDay: Map<
    Ymd,
    { net: Seconds; window: { start: string; end: string } | null }
  >;
  F: Seconds;
  hubAccount: PersonInputs["accounts"][number] | null;
  ttAccount: PersonInputs["accounts"][number] | null;
  hubByDay: Map<Ymd, HubstaffDay>;
  hubCoverage: Set<Ymd>;
  hubConnected: boolean;
  dayAdjustments: Map<Ymd, Adjustment[]>;
  notBooked: Set<string>;
  noLeaveMonth: boolean;
  manualCountS: Seconds;
  manualSkipS: Seconds;
  rules: Map<string, LeaveTypeRule>;
};

function prepare(p: PersonInputs, ctx: MonthCtx, payBasis: PayBasis): Prepared {
  const days = daysOfMonth(ctx.month);
  const first = days[0];
  const last = days[days.length - 1];
  let periods: Period[] = p.employment ?? [];
  let lastDayMissing = false;
  if (!periods.length) {
    const from = p.startedOn ?? p.addedOn;
    periods = [{ kind: "employed", from, to: p.endedOn ?? null }];
  }
  if (
    !p.active &&
    !p.endedOn &&
    periods.some(x => x.kind === "employed" && x.to === null)
  )
    lastDayMissing = true;
  const startAssumed =
    !p.startedOn && !!p.addedOn && p.addedOn >= first && p.addedOn <= last;

  let noSchedule = false;
  let companyWeek = false;
  const netByDay = new Map<
    Ymd,
    { net: Seconds; window: { start: string; end: string } | null }
  >();
  let F = 0;
  for (const d of days) {
    let s = scheduleOn(p.schedules ?? [], d);
    if (!s) {
      if (payBasis === "fixed") {
        s = defaultSchedule();
        companyWeek = true;
      } else noSchedule = true;
    }
    const net = netSeconds(s, d, ctx.settings);
    netByDay.set(d, { net, window: s ? windowOn(s, d) : null });
    F += net;
  }

  const hubAccount = p.accounts.find(a => a.provider === "hubstaff") ?? null;
  const ttAccount = p.accounts.find(a => a.provider === "timetastic") ?? null;
  const hubSource = ctx.sources.find(s => s.provider === "hubstaff");
  const hubConnected =
    !!hubSource &&
    hubSource.key !== null &&
    !PROVIDER_DOWN.has(hubSource.state);
  const hubByDay = new Map<Ymd, HubstaffDay>();
  for (const h of p.hubstaffDays ?? []) hubByDay.set(h.day, h);

  const dayAdjustments = new Map<Ymd, Adjustment[]>();
  const notBooked = new Set<string>();
  let noLeaveMonth = false;
  let manualCountS = 0;
  let manualSkipS = 0;
  for (const a of p.adjustments ?? []) {
    if (a.day && DAY_KINDS.has(a.kind)) {
      const list = dayAdjustments.get(a.day) ?? [];
      list.push(a);
      dayAdjustments.set(a.day, list);
    } else if (a.kind === "not_booked" && a.bookingId)
      notBooked.add(a.bookingId);
    else if (a.kind === "no_leave_month" && a.month === ctx.month)
      noLeaveMonth = true;
    else if (a.kind === "manual_time" && a.month === ctx.month) {
      if (a.decision === "skip") manualSkipS += Math.max(0, a.seconds ?? 0);
      else manualCountS += Math.max(0, a.seconds ?? 0);
    }
  }
  const rules = new Map<string, LeaveTypeRule>();
  for (const t of ctx.leaveTypes) rules.set(String(t.externalId), t);

  return {
    p,
    ctx,
    days,
    periods,
    startAssumed,
    lastDayMissing,
    noSchedule,
    companyWeek,
    netByDay,
    F,
    hubAccount,
    ttAccount,
    hubByDay,
    hubCoverage: new Set(ctx.coverage.hubstaff),
    hubConnected,
    dayAdjustments,
    notBooked,
    noLeaveMonth,
    manualCountS,
    manualSkipS,
    rules,
  };
}

function hubStateOf(x: Prepared, d: Ymd): DayCalc["hub"] {
  const acc = x.hubAccount;
  if (!acc) return x.hubConnected ? "not_linked" : "not_connected";
  if (!x.hubCoverage.has(d))
    return x.hubConnected ? "not_covered" : "not_connected";
  if (acc.memberSince && d < acc.memberSince) return "not_covered";
  if (acc.removedOn && d >= acc.removedOn) return "not_covered";
  const row = x.hubByDay.get(d);
  const tracked = row?.trackedS ?? 0;
  // Time may still be waiting to upload: no data, not zero.
  if (
    d >= addDays(x.ctx.today, -1) &&
    acc.lastClientActivityOn === d &&
    tracked === 0
  )
    return "not_covered";
  if (row && !row.verified) return "unverified";
  return "covered";
}

function runPass(x: Prepared, opts: PassOpts): Pass {
  const { ctx, p } = x;
  const s = ctx.settings;
  const holidayByDay = new Map<Ymd, string>();
  for (const h of p.holidays ?? [])
    if (!holidayByDay.has(h.day)) holidayByDay.set(h.day, h.name);
  const missingRules = new Map<
    string,
    { name: string; bookings: Set<string> }
  >();

  // Manual time decided as counted is allocated to days in date order.
  let manualLeft = x.manualCountS;
  let manualTotal = 0;
  const out: DayCalc[] = [];
  for (const d of x.days) {
    const employed = employedOn(x.periods, d);
    const { net, window } = x.netByDay.get(d) ?? { net: 0, window: null };
    const e = employed ? net : 0;
    const holiday = holidayByDay.get(d) ?? null;
    const H = holiday && employed ? e : 0;
    const past = d < ctx.today;
    const hub = hubStateOf(x, d);
    const adj = x.dayAdjustments.get(d) ?? [];
    const find = (k: Adjustment["kind"]) => adj.find(a => a.kind === k) ?? null;
    const row = x.hubByDay.get(d) ?? null;

    let tracked: Seconds | null = null;
    let manual = 0;
    let w: Seconds | null = null;
    let overLimit = 0;
    let idleNC = 0;
    let entered = 0;
    let decisionOvertaken = false;
    const hasData = hub === "covered" && d <= ctx.today;
    if (hasData) {
      tracked = row?.trackedS ?? 0;
      manual = row?.manualS ?? 0;
      manualTotal += manual;
    }
    if (opts.useWork) {
      if (hasData && d < ctx.today) {
        const t = tracked ?? 0;
        let work = t;
        if (!s.countTrackedBreaks) work -= row?.breakS ?? 0;
        idleNC = s.countKeptIdle
          ? Math.max(0, (row?.idleS ?? 0) - s.keptIdleMaxMinutesPerDay * 60)
          : (row?.idleS ?? 0);
        work -= idleNC;
        let manualNC = 0;
        if (!opts.manualAll && s.manualTime === "review") {
          const counted = Math.min(manual, manualLeft);
          manualLeft -= counted;
          manualNC = manual - counted;
        }
        work -= manualNC;
        work = Math.max(0, work);
        const cap = s.dayLimitHours * 3600;
        overLimit = Math.max(0, work - cap);
        work = Math.min(work, cap);
        const cw = find("count_work");
        if (cw && (cw.seconds ?? 0) > 0 && overLimit + idleNC > 0) {
          const back = Math.min(cw.seconds ?? 0, overLimit + idleNC);
          work += back;
        }
        w = work;
      }
      const hours = find("hours");
      if (hours && hours.seconds !== null) {
        if (hours.mode === "add" && w !== null) {
          w += hours.seconds;
          entered += hours.seconds;
        } else if (hours.mode !== "add") {
          w = hours.seconds;
          entered += hours.seconds;
        }
      }
    }

    // The fixed order: holiday, then work, then paid leave, then unpaid leave, then decisions.
    const work = opts.useWork ? (w ?? 0) : 0;
    const Win = Math.min(work, Math.max(0, e - H));
    const Wx = work - Win;
    const offDay = e - H === 0;
    let WxCounted = Wx;
    if (offDay && Wx > 0 && s.dayOffWork === "needs_ok") {
      const cw = find("count_work");
      WxCounted = Math.min(Wx, Math.max(0, cw?.seconds ?? 0));
    }
    const gap1 = Math.max(0, e - H - Win);

    let paid = 0;
    let unpaid = 0;
    const leave: DayView["leave"] = [];
    const pendingBookings: Booking[] = [];
    let leaveSeconds = 0;
    if (e > 0 && H === 0) {
      for (const b of p.bookings ?? []) {
        if (x.notBooked.has(b.bookingId)) continue;
        if (b.status !== "Approved" && b.status !== "Pending") continue;
        const part = dayParts(b, d, window, e);
        if (!part) continue;
        const rule = x.rules.get(String(b.leaveTypeId));
        if (rule?.payRule === "not_leave") continue;
        if (b.status === "Pending") {
          pendingBookings.push(b);
          leave.push({
            name: b.leaveTypeName,
            part: part.part,
            status: b.status,
          });
          continue;
        }
        let share = 1;
        if (!rule || rule.payRule === null) {
          const m = missingRules.get(String(b.leaveTypeId)) ?? {
            name: rule?.name ?? b.leaveTypeName,
            bookings: new Set<string>(),
          };
          m.bookings.add(b.bookingId);
          missingRules.set(String(b.leaveTypeId), m);
        } else
          share =
            rule.payRule === "paid"
              ? 1
              : rule.payRule === "unpaid"
                ? 0
                : Math.min(1, Math.max(0, rule.paidShare ?? 0));
        const pd = Math.floor(part.seconds * share);
        paid += pd;
        unpaid += part.seconds - pd;
        leaveSeconds += part.seconds;
        leave.push({
          name: b.leaveTypeName,
          part: part.part,
          status: b.status,
        });
      }
      const la = find("leave");
      if (la) {
        const share = Math.min(1, Math.max(0, la.paidShare ?? 1));
        const pd = Math.floor(e * share);
        paid += pd;
        unpaid += e - pd;
        leaveSeconds += e;
        leave.push({
          name: "Leave (entered)",
          part: "full",
          status: "Approved",
        });
      }
    }
    const PL = Math.min(paid, gap1);
    const UL = Math.min(unpaid, gap1 - PL);
    const rem = gap1 - PL - UL;
    const absentAdj = find("absent_unpaid");
    const excusedAdj = find("excused_paid");
    let Ex = 0;
    let A = 0;
    let undecided = 0;
    let noData = 0;
    let question = false;
    if (opts.useWork) {
      if (excusedAdj) Ex = rem;
      else if (absentAdj) A = rem;
      const decided = !!excusedAdj || !!absentAdj;
      const dataKnown = w !== null;
      if (decided) {
        const snap = (excusedAdj ?? absentAdj)?.snapshot;
        if (snap && (snap.trackedS ?? 0) < (tracked ?? 0) && Win > 0)
          decisionOvertaken = true;
      } else if (rem > 0) {
        // Entering hours answers the day too, 0 h included: the rest is a
        // short day, like any other.
        if (
          dataKnown &&
          past &&
          w === 0 &&
          hub === "covered" &&
          !find("hours")
        ) {
          question = true;
          if (opts.undecidedAbsent) undecided = rem;
        } else if (!dataKnown) noData = rem;
      }
    }
    out.push({
      day: d,
      employed,
      net,
      e,
      window,
      holiday,
      H,
      hub,
      past,
      tracked,
      manual,
      w,
      Win,
      Wx,
      WxCounted: opts.useWork ? WxCounted : 0,
      offDay,
      PL,
      UL,
      rem,
      Ex,
      A,
      undecided,
      noData,
      overLimit,
      idleNC,
      entered,
      leave,
      leaveSeconds,
      pendingBookings,
      question,
      adjustmentIds: adj.map(a => a.id),
      decisionOvertaken,
    });
  }
  let E = 0,
    U = 0,
    C = 0,
    noData = 0;
  for (const c of out) {
    E += c.e;
    U += c.UL + c.A + c.undecided;
    C += c.Win + c.WxCounted + c.H + c.PL + c.Ex;
    noData += c.noData;
  }
  const manualDecided = x.manualCountS + x.manualSkipS;
  return {
    days: out,
    E,
    U,
    T: E - U,
    C: C + noData,
    noData,
    missingRules,
    manualTotal,
    manualUndecided: Math.max(0, manualTotal - manualDecided),
    manualCounted:
      opts.manualAll || ctx.settings.manualTime === "counts"
        ? manualTotal
        : Math.min(manualTotal, x.manualCountS),
  };
}

type DayBase = { base: number | null; currency: string; assumed: boolean };

function baseByDay(p: PersonInputs, days: Ymd[]): Map<Ymd, DayBase> {
  const rows = [...(p.payHistory ?? [])].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const out = new Map<Ymd, DayBase>();
  for (const d of days) {
    let hit: (typeof rows)[number] | null = null;
    for (const r of rows) if (r.effectiveFrom <= d) hit = r;
    if (hit)
      out.set(d, {
        base: hit.monthlyCost === null ? null : Number(hit.monthlyCost),
        currency: hit.currency,
        assumed: false,
      });
    else if (rows.length)
      out.set(d, {
        base: rows[0].monthlyCost === null ? null : Number(rows[0].monthlyCost),
        currency: rows[0].currency,
        assumed: true,
      });
    else out.set(d, { base: null, currency: "USD", assumed: true });
  }
  return out;
}

type Figure = {
  T: Seconds;
  C: Seconds;
  g: Seconds;
  P: Seconds;
  X: Seconds;
  OT: Seconds;
  segments: Segment[];
  amount: number | null;
  overtime: number;
  currency: string;
};

function figureOf(
  pass: Pass,
  x: Prepared,
  bases: Map<Ymd, DayBase>,
  hoursRule: boolean,
): Figure {
  const s = x.ctx.settings;
  const T = pass.T;
  const C = hoursRule ? pass.C : T;
  const g = Math.floor(s.graceShare * T);
  const P = hoursRule ? Math.max(0, Math.min(T, C + g)) : T;
  const X = Math.max(0, C - T);
  let otApproved = 0;
  const otDays: { day: Ymd; seconds: Seconds }[] = [];
  for (const [day, list] of [...x.dayAdjustments.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  ))
    for (const a of list)
      if (a.kind === "overtime" && (a.seconds ?? 0) > 0) {
        otApproved += a.seconds ?? 0;
        otDays.push({ day, seconds: a.seconds ?? 0 });
      }
  const OT = hoursRule && s.overtime.on ? Math.min(otApproved, X) : 0;

  // Segments: runs of days with the same base and currency.
  type Seg = {
    from: Ymd;
    to: Ymd;
    base: number | null;
    currency: string;
    target: Seconds;
  };
  const segs: Seg[] = [];
  for (const c of pass.days) {
    const b = bases.get(c.day) ?? {
      base: null,
      currency: "USD",
      assumed: true,
    };
    const target = c.e - c.UL - c.A - c.undecided;
    const lastSeg = segs[segs.length - 1];
    if (lastSeg && lastSeg.base === b.base && lastSeg.currency === b.currency) {
      lastSeg.to = c.day;
      lastSeg.target += target;
    } else
      segs.push({
        from: c.day,
        to: c.day,
        base: b.base,
        currency: b.currency,
        target,
      });
  }
  // The month's currency is the one its paid days are in: a pay row changed
  // after someone's last day (target 0) never relabels the month.
  const worked = segs.filter(z => z.target > 0);
  const currency = worked.length
    ? worked[worked.length - 1].currency
    : segs.length
      ? segs[segs.length - 1].currency
      : "USD";
  const shares = shareBySegments(
    P,
    segs.map(z => z.target),
  );
  const F = x.F;
  let amount: number | null = 0;
  const segments: Segment[] = segs.map((z, i) => {
    const value =
      z.base === null || F <= 0
        ? null
        : roundMinor((z.base * shares[i]) / F, z.currency);
    if (value === null) {
      if (z.target > 0 || shares[i] > 0) amount = null;
    } else if (amount !== null) amount += value;
    return {
      from: z.from,
      to: z.to,
      base: z.base,
      target: z.target,
      payable: shares[i],
      amount: value,
    };
  });
  if (amount !== null) amount = roundMinor(amount, currency);
  let overtime = 0;
  if (OT > 0 && F > 0) {
    let left = OT;
    let money = 0;
    for (const o of otDays) {
      if (left <= 0) break;
      const sec = Math.min(o.seconds, left);
      left -= sec;
      const b = bases.get(o.day)?.base ?? 0;
      money += (b * sec * s.overtime.rate) / F;
    }
    overtime = roundMinor(money, currency);
  }
  return { T, C, g, P, X, OT, segments, amount, overtime, currency };
}

// ---------------------------------------------------------------------------
// Corrections and carries

type CarryLine = { fromMonth: Ym; amount: number; text: string };

/** The provider data an approved month now has, for "changed since approved". */
export function providerRowsOf(p: PersonInputs, ctx: MonthCtx): ProviderRows {
  return {
    hubstaffDays: p.hubstaffDays ?? [],
    bookings: p.bookings ?? [],
    ttDays: p.ttDays ?? [],
    holidays: p.holidays ?? [],
    coverage: {
      hubstaff: ctx.coverage.hubstaff,
      timetastic: ctx.coverage.timetastic,
    },
  };
}

/** What is stored with an approval: the person's inputs plus the month's rule context, without nested approvals. */
export type ApprovalSnapshot = PersonInputs & {
  snapshotCtx: {
    month: Ym;
    ruleVersion: string;
    rules: RulesVersion | null;
    leaveTypes: LeaveTypeRule[];
    holidayOverrides: HolidayOverride[];
    ceoTtUserId: string | null;
    usdPer: Record<string, number>;
  };
};

/**
 * Recompute an approved month with the approval's own snapshot (its rules,
 * schedule, pay, employment and decisions), changing only the provider data
 * to what is read now. The carry lines that were part of the approval are in
 * the snapshot as plain corrections, so the gap is the provider change alone.
 */
export function recomputeApproved(
  prior: PriorApproval,
  ctx: MonthCtx,
): PersonMonth {
  const snap = prior.approval.inputs as ApprovalSnapshot;
  const sc = snap.snapshotCtx;
  const month = sc?.month ?? prior.month;
  const rctx: MonthCtx = {
    month,
    today: ctx.today > lastDay(month) ? ctx.today : addDays(lastDay(month), 1),
    nowMinute: 0,
    ruleVersion: sc?.ruleVersion ?? HOURS_RULE_VERSION,
    rules: sc?.rules ?? null,
    settings: settingsOf(sc?.rules ?? null),
    sources: ctx.sources,
    coverage: prior.current.coverage,
    closed: { hubstaff: true, timetastic: true },
    leaveTypes: sc?.leaveTypes ?? ctx.leaveTypes,
    holidayOverrides: sc?.holidayOverrides ?? [],
    ceoTtUserId: sc?.ceoTtUserId ?? ctx.ceoTtUserId,
    usdPer: sc?.usdPer ?? ctx.usdPer,
  };
  const person: PersonInputs = {
    ...snap,
    hubstaffDays: prior.current.hubstaffDays,
    bookings: prior.current.bookings,
    ttDays: prior.current.ttDays,
    holidays: prior.current.holidays,
    approval: null,
    priorApprovals: [],
  };
  return computeCore(person, rctx);
}

function carryLines(
  p: PersonInputs,
  ctx: MonthCtx,
  notes: Reason[],
): CarryLine[] {
  const out: CarryLine[] = [];
  for (const prior of p.priorApprovals ?? []) {
    if (!prior?.approval || prior.month >= ctx.month) continue;
    const rec = recomputeApproved(prior, ctx);
    // Provisional here means pay by hours with days Hubstaff hasn't read.
    if (rec.pay.provisional || rec.pay.total === null) {
      notes.push({
        code: "changed_since_approved",
        severity: "note",
        text: `${monthName(prior.month)} can't be rechecked until Hubstaff has every day again.`,
      });
      continue;
    }
    const delta = roundMinor(
      rec.pay.total - prior.approval.amount - (prior.carried ?? 0),
      prior.approval.currency,
    );
    if (Math.abs(delta) < 10 ** -minorDigits(prior.approval.currency) / 2)
      continue;
    const seconds = (rec.hours.payable ?? 0) - prior.approval.payableS;
    out.push({
      fromMonth: prior.month,
      amount: delta,
      text: `Changed since ${monthName(prior.month)} was approved: ${seconds >= 0 ? "+" : ""}${hoursText(seconds)}, ${delta >= 0 ? "+" : ""}${moneyText(delta, prior.approval.currency)}. Carried into ${monthName(ctx.month)} when you approve it.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The person's month

/** Canonical strings for hashing, kept beside each computed PersonMonth. */
const CANONICAL = new WeakMap<PersonMonth, string>();

export function computePersonMonth(
  p: PersonInputs,
  ctx: MonthCtx,
): PersonMonth {
  if (p.approval) return approvedView(p, ctx);
  const pm = computeCore(p, ctx);
  CANONICAL.set(pm, canonicalPersonInputs(p, ctx));
  return pm;
}

function approvedView(p: PersonInputs, ctx: MonthCtx): PersonMonth {
  const approval = p.approval as Approval & { carriedSoFar?: number };
  const stored = approval.result;
  const current = computeCore(
    { ...p, approval: null, priorApprovals: [] },
    ctx,
  );
  const rec = recomputeApproved(
    {
      month: ctx.month,
      approval,
      current: providerRowsOf(p, ctx),
      carried: approval.carriedSoFar ?? 0,
    },
    ctx,
  );
  const seconds = (rec.hours.payable ?? 0) - approval.payableS;
  const amount =
    rec.pay.total === null
      ? 0
      : roundMinor(rec.pay.total - approval.amount, approval.currency);
  // Only a recompute with a figure and every day read says what changed.
  const changed =
    (seconds !== 0 || amount !== 0) &&
    rec.pay.total !== null &&
    !rec.pay.provisional
      ? { seconds, amount, alreadyCarried: approval.carriedSoFar ?? 0 }
      : null;
  const reasons: Reason[] = [];
  if (
    changed &&
    Math.abs(changed.amount - changed.alreadyCarried) >=
      10 ** -minorDigits(approval.currency) / 2
  )
    reasons.push({
      code: "changed_since_approved",
      severity: "note",
      seconds: changed.seconds,
      text: `Changed since approved: ${seconds >= 0 ? "+" : ""}${hoursText(seconds)}, ${amount >= 0 ? "+" : ""}${moneyText(amount, approval.currency)}, carried into ${monthName(nextMonth(ctx.month))} when you approve it.`,
    });
  const base: PersonMonth =
    stored && typeof stored === "object" ? { ...stored } : current;
  const out: PersonMonth = {
    ...base,
    name: p.name,
    role: p.role,
    status: { kind: approval.status === "paid" ? "paid" : "approved", reasons },
    approval,
    changedSinceApproval: changed,
    now: current.now,
    inputsHash: approval.inputsHash,
  };
  CANONICAL.set(out, canonicalPersonInputs(p, ctx));
  return out;
}

function computeCore(p: PersonInputs, ctx: MonthCtx): PersonMonth {
  const s = ctx.settings;
  const rd = roleDefaults(p.role, p.engagement);
  const tracking: Tracking = p.terms?.tracking ?? rd.tracking;
  const payBasis: PayBasis = p.terms?.payBasis ?? rd.payBasis;
  const t = p.terms;
  const paysOnHours =
    !rd.noRole &&
    payBasis === "hours" &&
    tracking === "required" &&
    !!t?.hoursPayFrom &&
    t.hoursPayFrom <= ctx.month &&
    !!t.termsConfirmedAt &&
    !!t.contractCountry &&
    (t.contractCountry.toUpperCase() !== "KW" || !!t.kwClauseReviewedAt);
  const shadow = !rd.noRole && payBasis === "hours" && !paysOnHours;

  const x = prepare(p, ctx, payBasis);
  const bases = baseByDay(p, x.days);
  const manualAll = s.manualTime === "counts";
  const payPass = paysOnHours
    ? runPass(x, { useWork: true, manualAll, undecidedAbsent: true })
    : runPass(x, { useWork: false, manualAll: true, undecidedAbsent: false });
  const shadowPass = shadow
    ? runPass(x, { useWork: true, manualAll: true, undecidedAbsent: true })
    : null;
  const viewPass = paysOnHours
    ? payPass
    : tracking !== "exempt"
      ? (shadowPass ??
        runPass(x, { useWork: true, manualAll: true, undecidedAbsent: false }))
      : payPass;

  const fig = figureOf(payPass, x, bases, paysOnHours);
  const shadowFig = shadowPass ? figureOf(shadowPass, x, bases, true) : null;

  const reasons: Reason[] = [];
  const lookAt: LookAt[] = [];
  const block = (code: ReasonCode, text: string, extra: Partial<Reason> = {}) =>
    reasons.push({ code, severity: "blocks", text, ...extra });
  const decide = (
    code: ReasonCode,
    text: string,
    extra: Partial<Reason> = {},
  ) => reasons.push({ code, severity: "decide", text, ...extra });
  const note = (code: ReasonCode, text: string, extra: Partial<Reason> = {}) =>
    reasons.push({ code, severity: "note", text, ...extra });

  const employedDays = payPass.days.filter(c => c.employed);
  const carries = carryLines(p, ctx, reasons);
  const owedOnly = employedDays.length === 0;

  // --- Blocking reasons
  if (rd.noRole) block("no_role", "Set a role to work out pay.");
  const segmentsWithWork = fig.segments.filter(
    z => z.target > 0 || z.payable > 0,
  );
  const missingBase = payPass.days.some(
    c => c.e > 0 && bases.get(c.day)?.base === null,
  );
  const payUnknown = !owedOnly && (missingBase || !(p.payHistory ?? []).length);
  const scheduleUnknown =
    !owedOnly && (x.F <= 0 || (payBasis === "hours" && x.noSchedule));
  if (payUnknown) block("no_pay", "No pay is set. Add it in the roster.");
  if (scheduleUnknown)
    block(
      "no_schedule",
      "No working hours are set for this month. Add them in the roster.",
    );
  if (x.lastDayMissing)
    block(
      "last_day_missing",
      "Marked as left without a last working day. Set the last working day in the roster.",
    );
  const currencies = new Set(
    segmentsWithWork.map(z => bases.get(z.from)?.currency ?? fig.currency),
  );
  if (currencies.size > 1)
    block(
      "currency_changed",
      `Pay changes currency during ${monthName(ctx.month)}. Record the new currency from the 1st of a month.`,
    );
  for (const [, m] of payPass.missingRules)
    block(
      "leave_type_without_rule",
      `Set a pay rule for ${m.name} (${m.bookings.size} booking${m.bookings.size === 1 ? "" : "s"})`,
    );

  // Timetastic
  const ttSource = ctx.sources.find(z => z.provider === "timetastic");
  const ttConnected =
    !!ttSource && ttSource.key !== null && !PROVIDER_DOWN.has(ttSource.state);
  const ttUsed = !x.noLeaveMonth && !owedOnly;
  if (ttUsed && !ttConnected && !x.ttAccount)
    block(
      "timetastic_not_read",
      "Timetastic isn't connected, so leave is unknown. Paste its key in Connections, or choose No leave this month.",
    );
  else if (ttUsed && !x.ttAccount)
    block(
      "timetastic_not_read",
      "No Timetastic account is linked. Link one in Link accounts, or choose No leave this month.",
    );
  if (ttUsed && x.ttAccount) {
    const unexplained = leaveMismatchDays(p, ctx, x, payPass);
    if (unexplained.length)
      block(
        "leave_unverified",
        `Timetastic's day list and its bookings differ on ${unexplained.length} day${unexplained.length === 1 ? "" : "s"}. The next read usually settles it.`,
        { days: unexplained },
      );
  }

  // Hubstaff, only for people whose pay follows hours.
  if (paysOnHours && !owedOnly) {
    const pastNoData = payPass.days.filter(c => c.past && c.noData > 0);
    const byHub = (k: DayCalc["hub"]) => pastNoData.filter(c => c.hub === k);
    if (byHub("not_connected").length)
      block(
        "hubstaff_not_connected",
        "Hubstaff isn't connected, so hours show as no data.",
        { days: byHub("not_connected").map(c => c.day) },
      );
    if (byHub("not_linked").length)
      block(
        "hubstaff_not_linked",
        "No Hubstaff account is linked. Link one in Link accounts.",
        { days: byHub("not_linked").map(c => c.day) },
      );
    const nc = byHub("not_covered");
    if (nc.length)
      block(
        "no_data_days",
        `${nc.length} day${nc.length === 1 ? "" : "s"} with no Hubstaff data`,
        {
          days: nc.map(c => c.day),
          seconds: nc.reduce((a, c) => a + c.noData, 0),
        },
      );
    const uv = byHub("unverified");
    if (uv.length)
      block(
        "hours_unverified",
        `Hubstaff's daily totals and its 10-minute records differ on ${uv.length} day${uv.length === 1 ? "" : "s"}. Approval waits for the next read to settle them.`,
        { days: uv.map(c => c.day) },
      );
  }

  // --- The four questions
  if (paysOnHours) {
    for (const c of payPass.days.filter(z => z.question))
      decide(
        "absent_no_leave",
        `${shortDay(c.day)}: nothing tracked${c.leaveSeconds ? ", part of the day on leave" : ", no leave booked"}.`,
        { days: [c.day], seconds: c.rem },
      );
    if (s.manualTime === "review" && payPass.manualUndecided > 0)
      decide(
        "manual_time",
        `${hoursText(payPass.manualUndecided)} of manual time to decide.`,
        { seconds: payPass.manualUndecided },
      );
    for (const c of payPass.days) {
      const h = (x.dayAdjustments.get(c.day) ?? []).find(
        a => a.kind === "hours" && a.mode !== "add",
      );
      if (!h || c.hub !== "covered" || c.tracked === null) continue;
      const snap = h.snapshot;
      const moved = !snap || !snap.covered || snap.trackedS !== c.tracked;
      if (moved && c.tracked !== h.seconds && c.tracked > 0)
        decide(
          "entered_vs_hubstaff",
          `You entered ${hoursText(h.seconds ?? 0)} for ${shortDay(c.day)}; Hubstaff now shows ${hoursText(c.tracked)}.`,
          { days: [c.day], seconds: c.tracked },
        );
    }
  }
  const pendingSeen = new Set<string>();
  for (const c of payPass.days)
    for (const b of c.pendingBookings)
      if (c.past && !pendingSeen.has(b.bookingId)) {
        pendingSeen.add(b.bookingId);
        decide(
          "pending_leave",
          `${b.leaveTypeName} from ${shortDay(b.startAt.slice(0, 10))} is still pending in Timetastic. Approve or decline it there, or treat it as not booked.`,
          { days: [c.day] },
        );
      }

  // --- Notes (never block)
  const view = viewPass.days;
  const dayOff = view.filter(c => c.offDay && c.Wx > 0 && c.employed);
  const dayOffS = dayOff.reduce((a, c) => a + c.WxCounted, 0);
  // With "needs your OK", work on a day off counts only once counted: each
  // such day says so, with the time to count.
  const waiting =
    paysOnHours || shadow ? dayOff.filter(c => c.WxCounted < c.Wx) : [];
  const countedOff = dayOff.filter(c => c.WxCounted > 0);
  if (countedOff.length)
    note(
      "worked_day_off",
      `Worked on a day off: ${hoursText(dayOffS)}, counted toward the month (never above base).`,
      { days: countedOff.map(c => c.day), seconds: dayOffS },
    );
  for (const c of waiting)
    note(
      "day_off_not_counted",
      `Worked ${hoursText(c.Wx - c.WxCounted)} on ${shortDay(c.day)}, a day off: not counted unless you count it.`,
      { days: [c.day], seconds: c.Wx },
    );
  const duringLeave = view.filter(c => c.leaveSeconds > 0 && c.Win > 0);
  for (const c of duringLeave)
    note(
      "worked_during_leave",
      `Worked ${hoursText(c.Win)} during booked leave on ${shortDay(c.day)}: Timetastic still deducts it.`,
      { days: [c.day], seconds: c.Win },
    );
  for (const c of view.filter(z => z.overLimit > 0))
    note(
      "over_day_limit",
      `${hoursText(c.tracked ?? 0)} tracked on ${shortDay(c.day)}: ${hoursText(c.overLimit)} above the ${s.dayLimitHours} h daily limit not counted.`,
      { days: [c.day], seconds: c.overLimit },
    );
  for (const c of view.filter(z => z.idleNC > 0))
    note(
      "idle_not_counted",
      `${hoursText(c.tracked ?? 0)} tracked on ${shortDay(c.day)}: ${hoursText(c.idleNC)} of idle time not counted.`,
      { days: [c.day], seconds: c.idleNC },
    );
  const viewFig =
    viewPass === payPass ? fig : figureOf(viewPass, x, bases, true);
  if (paysOnHours && fig.X > 0)
    note("extra_hours", `${hoursText(fig.X)} extra, not paid.`, {
      seconds: fig.X,
    });
  else if (
    !paysOnHours &&
    tracking !== "exempt" &&
    viewFig.X > 0 &&
    viewPass.C > 0
  )
    note(
      "extra_hours",
      `${hoursText(viewFig.X)} above the month's hours (shown, not paid).`,
      { seconds: viewFig.X },
    );
  if (x.startAssumed) {
    note(
      "start_date_assumed",
      `No start date: counted from ${shortDay(p.addedOn)}, the day they were added.`,
      { days: [p.addedOn] },
    );
    lookAt.push({
      code: "start_date_assumed",
      text: `${p.name}: no start date, so pay counts from ${shortDay(p.addedOn)}, the day they were added.`,
    });
  }
  if (
    (p.payHistory ?? []).length &&
    payPass.days.some(c => c.e > 0 && bases.get(c.day)?.assumed)
  )
    note(
      "pay_history_assumed",
      "Pay before the first recorded change is assumed to be the earliest recorded figure.",
    );
  if (x.companyWeek)
    note(
      "schedule_mismatch",
      "No working hours on the roster: the company week (Saturday to Thursday, 10:00 to 18:00) is assumed.",
    );
  for (const a of p.accounts) {
    if (a.emailDiffers)
      note(
        "email_differs",
        `The ${a.provider === "hubstaff" ? "Hubstaff" : "Timetastic"} email differs from the roster.`,
      );
    if (a.scheduleMismatch)
      note(
        "schedule_mismatch",
        `Timetastic's working week differs from the roster's (${a.scheduleMismatch}). The roster decides pay.`,
      );
  }
  const zoneDays = (p.hubstaffDays ?? []).filter(
    h => h.zoneShifted && h.day.startsWith(ctx.month),
  );
  if (zoneDays.length) {
    note(
      "zone_shifted",
      "Hubstaff's time zone isn't Kuwait. The cockpit sorts time into Kuwait days itself, so pay is right. Hubstaff's own reports will show different days.",
    );
    lookAt.push({
      code: "zone_shifted",
      text: "Hubstaff's time zone isn't Kuwait: the cockpit sorted its time into Kuwait days.",
    });
  }
  for (const c of view.filter(z => z.decisionOvertaken))
    note(
      "decision_overtaken",
      `Hubstaff now shows ${hoursText(c.tracked ?? 0)} on ${shortDay(c.day)}, a day you decided earlier. That time is counted.`,
      { days: [c.day] },
    );
  for (const c of view.filter(z => z.holiday && z.employed && z.net === 0))
    note(
      "holiday_on_day_off",
      `Holiday on a day off (${shortDay(c.day)}). If a substitute day was given, add it under Holidays.`,
      { days: [c.day] },
    );
  const kw = t?.contractCountry?.toUpperCase() === "KW";
  if (kw && (p.sickDaysThisYear ?? 0) > 15)
    note(
      "kw_sick_days",
      "Kuwait law steps sick pay down after 15 days a year (Art. 69). Check this month's sick days with the accountant.",
    );
  if (kw && dayOff.length)
    note(
      "kw_rest_day_work",
      "Kuwait law pays extra for work on the weekly rest day or a public holiday (Art. 67, 68). This figure doesn't include it: check with the accountant whether it applies.",
    );

  // Activity
  let overall = 0,
    input = 0;
  for (const h of p.hubstaffDays ?? [])
    if (h.day.startsWith(ctx.month)) {
      overall += h.overallS;
      input += h.inputTrackedS;
    }
  const activity = {
    share: input > 0 ? overall / input : null,
    inputSeconds: input,
  };
  if (
    s.lowActivityShare !== null &&
    activity.share !== null &&
    activity.share < s.lowActivityShare
  )
    note(
      "low_activity",
      `Activity ${Math.round(activity.share * 100)}% this month (phone and web timer time has no activity level). It never changes pay.`,
    );

  // Approve-dialog lines
  for (const b of p.bookings ?? []) {
    if (
      b.status !== "Approved" ||
      x.notBooked.has(b.bookingId) ||
      !ctx.ceoTtUserId
    )
      continue;
    if (
      b.startAt.slice(0, 10) > lastDay(ctx.month) ||
      b.endAt.slice(0, 10) < firstDay(ctx.month)
    )
      continue;
    const byOther =
      b.actionerId !== ctx.ceoTtUserId ||
      (b.autoApproved && b.requestedById !== ctx.ceoTtUserId);
    if (byOther)
      lookAt.push({
        code: "leave_not_ceo_approved",
        text: `${p.name}: ${b.leaveTypeName} from ${shortDay(b.startAt.slice(0, 10))} was not approved by you in Timetastic.`,
      });
  }
  const tta = x.ttAccount;
  if (tta && tta.allowanceRemaining !== null && tta.allowanceRemaining < 0)
    lookAt.push({
      code: "over_allowance",
      text: `${p.name}: leave is over the allowance by ${Math.abs(tta.allowanceRemaining)} ${tta.allowanceUnit === "Hours" ? "hours" : "days"}.`,
    });
  for (const h of p.hubstaffDays ?? [])
    if (
      h.day.startsWith(ctx.month) &&
      h.previousTrackedS !== null &&
      h.previousTrackedS - h.trackedS > 900
    )
      lookAt.push({
        code: "hubstaff_dropped",
        text: `${p.name}: Hubstaff now shows ${hoursText(h.previousTrackedS - h.trackedS)} less on ${shortDay(h.day)} than an earlier read.`,
      });

  // --- Corrections
  const lines: {
    fromMonth: Ym | null;
    amount: number;
    applied: number;
    carried: boolean;
    currency: string;
  }[] = [];
  for (const a of p.adjustments ?? []) {
    if (
      a.kind !== "correction" ||
      a.month !== ctx.month ||
      a.decision === "skip" ||
      a.amount === null
    )
      continue;
    lines.push({
      fromMonth: a.fromMonth,
      amount: Number(a.amount),
      applied: 0,
      carried: a.carried,
      currency: (a.currency ?? fig.currency).toUpperCase(),
    });
  }
  for (const c of carries) {
    lines.push({
      fromMonth: c.fromMonth,
      amount: c.amount,
      applied: 0,
      carried: true,
      currency: fig.currency,
    });
    note("changed_since_approved", c.text);
    lookAt.push({
      code: "carried_change",
      text: `${p.name}: ${c.text}`,
      amount: c.amount,
      fromMonth: c.fromMonth,
    });
  }
  const badCurrency = lines.filter(
    l => l.currency !== fig.currency.toUpperCase(),
  );
  if (badCurrency.length)
    block(
      "correction_currency",
      `A correction is in ${badCurrency[0].currency}, not ${fig.currency}. Withdraw it and enter it in ${fig.currency}.`,
    );
  const good = lines.filter(l => l.currency === fig.currency.toUpperCase());
  const baseMoney = (fig.amount ?? 0) + fig.overtime;
  const positive = good
    .filter(l => l.amount > 0)
    .reduce((a, l) => a + l.amount, 0);
  const negative = good
    .filter(l => l.amount < 0)
    .reduce((a, l) => a + l.amount, 0);
  const capMoney = roundMinor(
    s.correctionCapShare * Math.max(0, baseMoney),
    fig.currency,
  );
  const negApplied = Math.max(negative, -capMoney);
  const rest = roundMinor(negative - negApplied, fig.currency);
  // Someone with no employed day after this month has no later pay to take
  // it from: it is not recovered, and nothing is carried (a carry would open
  // a new month for them every month). A pause still carries (they come
  // back), and so does a month before a leaver's last one.
  const monthEnd = lastDay(ctx.month);
  const leaver = !x.periods.some(
    per => per.kind === "employed" && (per.to === null || per.to > monthEnd),
  );
  const carriedOut = leaver ? 0 : rest;
  for (const l of good) if (l.amount > 0) l.applied = l.amount;
  let negLeft = negApplied;
  for (const l of good
    .filter(z => z.amount < 0)
    .sort((a, b) => String(a.fromMonth).localeCompare(String(b.fromMonth)))) {
    const take = Math.max(l.amount, negLeft);
    l.applied = roundMinor(take, fig.currency);
    negLeft = roundMinor(negLeft - take, fig.currency);
  }
  const applied = roundMinor(positive + negApplied, fig.currency);
  if (rest < 0) {
    const text = leaver
      ? `Not recovered: ${moneyText(-rest, fig.currency)}. Negative corrections take at most ${Math.round(s.correctionCapShare * 100)}% of a month's pay.`
      : `Only ${moneyText(-negApplied, fig.currency)} of ${moneyText(-negative, fig.currency)} is taken this month (${Math.round(s.correctionCapShare * 100)}% of pay); ${moneyText(-rest, fig.currency)} is carried into ${monthName(nextMonth(ctx.month))}.`;
    lookAt.push({
      code: "correction_capped",
      text: `${p.name}: ${text}`,
      amount: rest,
    });
  }

  // No figure rather than a wrong one: with no pay, no working hours or two
  // currencies in the month, the sum would be $0 or a mix of currencies.
  const amount =
    rd.noRole || payUnknown || scheduleUnknown || currencies.size > 1
      ? null
      : fig.amount;
  const total =
    amount === null
      ? null
      : roundMinor(amount + fig.overtime + applied, fig.currency);
  const lastBase =
    [...fig.segments].reverse().find(z => z.base !== null)?.base ?? null;
  const valuePerHour =
    lastBase !== null && x.F > 0 && amount !== null
      ? roundMinor(lastBase / (x.F / 3600), fig.currency)
      : null;
  const rate = ctx.usdPer[fig.currency.toUpperCase()];
  const totalUsd =
    total === null || rate === undefined
      ? null
      : Math.round(total * rate * 100) / 100;

  // --- Status
  const reasonsBlock = reasons.some(r => r.severity === "blocks");
  const reasonsDecide = reasons.some(r => r.severity === "decide");
  const monthOver = ctx.today > lastDay(ctx.month);
  const sourcesUsed: Provider[] = owedOnly
    ? []
    : [
        ...(paysOnHours ? (["hubstaff"] as Provider[]) : []),
        ...(ttUsed ? (["timetastic"] as Provider[]) : []),
      ];
  const notClosed = sourcesUsed.filter(pv => !ctx.closed[pv]);
  let kind: StatusKind;
  if (!monthOver || notClosed.length) {
    kind = "in_progress";
    const finalRead = `${nextMonth(ctx.month)}-03`;
    reasons.unshift({
      code: "final_read_pending",
      severity: "blocks",
      text: monthOver
        ? `${monthName(ctx.month)} closes after the final ${notClosed.map(v => (v === "hubstaff" ? "Hubstaff" : "Timetastic")).join(" and ")} read on ${shortDay(finalRead)}.`
        : `${monthName(ctx.month)} is still running. It closes after the final read on ${shortDay(finalRead)}.`,
    });
  } else if (reasonsBlock) kind = "not_ready";
  else if (reasonsDecide) kind = "needs_review";
  else kind = "ready";
  const provisional =
    kind === "in_progress" || (paysOnHours && payPass.noData > 0);

  // --- Days
  const days: DayView[] = view.map(c =>
    dayView(c, ctx, paysOnHours || tracking !== "exempt", x),
  );

  // --- Hours
  // Null unless Hubstaff has at least one day of this person: a link with
  // no day read (not a member yet, removed, not covered) is no data, not 0 h.
  const tracked =
    x.hubAccount &&
    ctx.coverage.hubstaff.length &&
    view.some(c => c.tracked !== null)
      ? view.reduce((a, c) => a + (c.tracked ?? 0), 0)
      : null;
  const manualTotal = viewPass.manualTotal;
  const hours: PersonMonth["hours"] = {
    expected: payPass.E,
    fullMonth: x.F,
    unpaid: payPass.U,
    target: payPass.T,
    tracked,
    manual: tracked === null ? null : manualTotal,
    manualCounted:
      tracked === null
        ? null
        : paysOnHours
          ? payPass.manualCounted
          : manualTotal,
    paidLeave: payPass.days.reduce((a, c) => a + c.PL, 0),
    holidays: payPass.days.reduce((a, c) => a + c.H, 0),
    excused: payPass.days.reduce((a, c) => a + c.Ex, 0),
    entered: viewPass.days.reduce((a, c) => a + c.entered, 0),
    counted: paysOnHours
      ? fig.C
      : tracking === "exempt"
        ? null
        : tracked === null
          ? null
          : viewPass.C,
    forgiven: paysOnHours ? Math.max(0, fig.P - Math.min(fig.T, fig.C)) : 0,
    payable: rd.noRole ? null : fig.P,
    extra: paysOnHours ? fig.X : viewFig.X,
    workedOnDaysOff: dayOffS,
    overDayLimit: view.reduce((a, c) => a + c.overLimit, 0),
    idleNotCounted: view.reduce((a, c) => a + c.idleNC, 0),
    overtimePaid: fig.OT,
    // The no-data time inside `counted`: the pay pass's for pay by hours, the
    // shown pass's (shadow or optional) otherwise.
    noData: paysOnHours ? payPass.noData : viewPass.noData,
  };

  const shadowUndecidedDays = shadowPass
    ? shadowPass.days.filter(c => c.question).length
    : 0;
  const pm: PersonMonth = {
    personId: p.personId,
    name: p.name,
    role: p.role,
    currency: fig.currency,
    tracking: {
      value: tracking,
      from: p.terms?.tracking ? "set" : "role_default",
    },
    payBasis: {
      value: payBasis,
      from: p.terms?.payBasis ? "set" : "role_default",
    },
    paysOnHours,
    shadow,
    hours,
    segments: fig.segments,
    pay: {
      amount,
      overtime: fig.overtime,
      corrections: {
        applied,
        carriedOut,
        lines: good.map(l => ({
          fromMonth: l.fromMonth,
          amount: l.amount,
          applied: l.applied,
          carried: l.carried,
        })),
      },
      total,
      provisional,
      // No comparison without data: a shadow figure resting on no Hubstaff
      // day at all would just be the base again.
      shadowAmount:
        shadowFig && amount !== null && tracked !== null
          ? shadowFig.amount
          : null,
      shadowUndecidedDays,
      totalUsd,
      valuePerHour,
    },
    status: { kind, reasons },
    lookAt,
    days,
    activity,
    leaveLeft:
      tta && tta.allowanceRemaining !== null
        ? { amount: tta.allowanceRemaining, unit: tta.allowanceUnit ?? "Days" }
        : null,
    now: nowFlag(p, ctx, x, tracking, payPass),
    approval: null,
    changedSinceApproval: null,
    inputsHash: "",
  };
  return pm;
}

/**
 * Booking days Timetastic's per-day list and the bookings disagree on, that no
 * holiday or working-week difference explains. Compared by user and day, not
 * by the list's entity id, so the check never depends on what that id names.
 */
function leaveMismatchDays(
  p: PersonInputs,
  ctx: MonthCtx,
  x: Prepared,
  pass: Pass,
): Ymd[] {
  const covered = new Set(ctx.coverage.timetastic);
  const listed = new Set<Ymd>();
  const explained = new Set<Ymd>();
  for (const t of p.ttDays ?? []) {
    if (t.kind === "booking") listed.add(t.day);
    else explained.add(t.day);
  }
  const covers = (b: Booking, d: Ymd) =>
    b.startAt.slice(0, 10) <= d && d <= b.endAt.slice(0, 10);
  const out = new Set<Ymd>();
  for (const c of pass.days) {
    if (!covered.has(c.day)) continue;
    const live = (p.bookings ?? []).filter(
      b =>
        (b.status === "Approved" || b.status === "Pending") && covers(b, c.day),
    );
    if (listed.has(c.day) && live.length === 0) out.add(c.day);
    const counted = live.filter(
      b =>
        b.status === "Approved" &&
        !x.notBooked.has(b.bookingId) &&
        x.rules.get(String(b.leaveTypeId))?.payRule !== "not_leave",
    );
    if (
      counted.length &&
      !listed.has(c.day) &&
      c.e > 0 &&
      c.H === 0 &&
      !c.holiday &&
      !explained.has(c.day)
    )
      out.add(c.day);
  }
  return [...out].sort();
}

function dayView(
  c: DayCalc,
  ctx: MonthCtx,
  showWork: boolean,
  x: Prepared,
): DayView {
  let kind: DayKind;
  const counted =
    c.w === null && c.noData > 0
      ? null
      : c.Win + c.WxCounted + c.H + c.PL + c.Ex;
  const paidLeave = c.PL;
  const unpaid = c.UL + c.A;
  if (!c.employed && !(c.w ?? 0)) kind = "not_employed";
  else if (c.day > ctx.today) kind = "future";
  else if (c.day === ctx.today) kind = "today";
  else if (c.holiday && c.e > 0) kind = "holiday";
  else if (c.e === 0 && (c.w ?? 0) > 0) kind = "worked_day_off";
  else if (c.e === 0) kind = "off";
  else if (c.A > 0) kind = "absent_confirmed";
  else if (c.Ex > 0) kind = "excused";
  else if (c.question) kind = "absent";
  else if (
    c.leaveSeconds > 0 &&
    c.PL + c.UL >= c.e - c.Win - c.H &&
    c.Win === 0
  )
    kind =
      c.UL === 0 ? "leave_paid" : c.PL === 0 ? "leave_unpaid" : "leave_part";
  else if (showWork && c.w === null && c.noData > 0)
    kind = c.hub === "unverified" ? "unverified" : "no_data";
  else if (!showWork)
    kind =
      c.leaveSeconds > 0
        ? c.UL === 0
          ? "leave_paid"
          : c.PL === 0
            ? "leave_unpaid"
            : "leave_part"
        : "worked";
  else if ((counted ?? 0) >= c.e) kind = "worked";
  else
    kind =
      c.leaveSeconds > 0 ? (c.UL > 0 ? "leave_part" : "leave_paid") : "short";
  const parts: string[] = [];
  if (kind === "not_employed") parts.push("not employed");
  else if (kind === "off") parts.push("day off");
  else if (kind === "future") parts.push(`${hoursText(c.e)} expected`);
  else {
    if (c.holiday) parts.push(`holiday (${c.holiday})`);
    if (showWork)
      parts.push(
        c.tracked === null
          ? "no Hubstaff data"
          : c.tracked === 0
            ? "nothing tracked"
            : `${hoursText(c.tracked)} tracked`,
      );
    for (const l of c.leave)
      parts.push(
        `${l.name}${l.part === "full" ? "" : l.part === "am" ? " (morning)" : l.part === "pm" ? " (afternoon)" : " (hours)"}${l.status === "Pending" ? ", pending" : ""}`,
      );
    if (c.e > 0) parts.push(`${hoursText(c.e)} expected`);
    if (c.question) parts.push("needs a decision");
    if (kind === "absent_confirmed") parts.push("confirmed absent");
    if (kind === "excused") parts.push("counted as worked");
  }
  void x;
  return {
    day: c.day,
    kind,
    expected: c.e,
    counted: showWork ? counted : c.e > 0 ? c.e - c.UL - c.A : 0,
    tracked: c.tracked,
    paidLeave,
    unpaid,
    holiday: c.holiday,
    leave: c.leave,
    adjustmentIds: c.adjustmentIds,
    label: `${longDay(c.day)}: ${parts.join(", ")}`,
  };
}

function nowFlag(
  p: PersonInputs,
  ctx: MonthCtx,
  x: Prepared,
  tracking: Tracking,
  pass: Pass,
): NowFlag | null {
  if (tracking !== "required" || monthOf(ctx.today) !== ctx.month) return null;
  const c = pass.days.find(z => z.day === ctx.today);
  if (!c || !c.employed || c.e <= 0 || c.H > 0 || !c.window) return null;
  if (
    (p.bookings ?? []).some(
      b =>
        (b.status === "Pending" || b.status === "Approved") &&
        !x.notBooked.has(b.bookingId) &&
        b.startAt.slice(0, 10) <= ctx.today &&
        ctx.today <= b.endAt.slice(0, 10),
    )
  )
    return null;
  // The schedule's own timezone: Kuwait is UTC+3 with no daylight saving.
  const tz =
    scheduleOn(p.schedules ?? [], ctx.today)?.timezone ?? "Asia/Kuwait";
  const startKw =
    minutesOf(c.window.start) + zoneShiftToKuwaitMinutes(tz, ctx.today);
  const endKw =
    minutesOf(c.window.end) + zoneShiftToKuwaitMinutes(tz, ctx.today);
  if (
    ctx.nowMinute < startKw + ctx.settings.notTrackingAfterMinutes ||
    ctx.nowMinute >= endKw
  )
    return null;
  const hub = ctx.sources.find(z => z.provider === "hubstaff");
  const nowMs =
    Date.parse(`${ctx.today}T00:00:00+03:00`) + ctx.nowMinute * 60_000;
  const lastOk = hub?.lastOkAt ? Date.parse(hub.lastOkAt) : NaN;
  if (!Number.isFinite(lastOk) || nowMs - lastOk > 75 * 60_000)
    return { kind: "cant_tell", lastReadAt: hub?.lastOkAt ?? null };
  const acc = x.hubAccount;
  const trackedToday = x.hubByDay.get(ctx.today)?.trackedS ?? 0;
  if (acc?.online) return { kind: "tracking", trackedToday };
  if (trackedToday > 0) {
    if (acc?.lastActivityAt) {
      const at = Date.parse(acc.lastActivityAt);
      if (
        Number.isFinite(at) &&
        nowMs - at > ctx.settings.notTrackingAfterMinutes * 60_000
      )
        return {
          kind: "stopped",
          at: new Date(at + 3 * 3600_000).toISOString().slice(11, 16),
        };
    }
    return { kind: "tracking", trackedToday };
  }
  const since = `${String(Math.floor(startKw / 60)).padStart(2, "0")}:${String(startKw % 60).padStart(2, "0")}`;
  return {
    kind: "not_tracking",
    since,
    seconds: (ctx.nowMinute - startKw) * 60,
  };
}

/** Minutes to add to a wall-clock time in `tz` on `day` to get Kuwait wall-clock time. */
function zoneShiftToKuwaitMinutes(tz: string, day: Ymd): number {
  if (!tz || tz === "Asia/Kuwait") return 0;
  try {
    const at = new Date(`${day}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const h = Number(parts.find(q => q.type === "hour")?.value ?? 12);
    const m = Number(parts.find(q => q.type === "minute")?.value ?? 0);
    const offset = h * 60 + m - 12 * 60; // the zone's offset from UTC, in minutes
    return 180 - offset;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// The month

const STATUS_ORDER: Record<StatusKind, number> = {
  not_ready: 0,
  needs_review: 1,
  in_progress: 2,
  ready: 3,
  approved: 4,
  paid: 5,
};

export function computeMonth(inputs: HoursInputs): HoursMonth {
  const ctx = contextOf(inputs);
  const people: PersonMonth[] = [];
  const notCounted: HoursMonth["notCounted"] = [];
  for (const p of inputs.people ?? []) {
    const rd = roleDefaults(p.role, p.engagement);
    if (!rd.counted) {
      notCounted.push({
        personId: p.personId,
        name: p.name,
        why: rd.why ?? "bot",
      });
      continue;
    }
    const pm = computePersonMonth(p, ctx);
    const employed =
      pm.hours.expected > 0 || pm.days.some(d => d.kind !== "not_employed");
    const owed = pm.pay.corrections.lines.length > 0;
    if (!employed && !owed && !p.approval) {
      notCounted.push({
        personId: p.personId,
        name: p.name,
        why: "not_employed",
      });
      continue;
    }
    if (rd.noRole)
      notCounted.push({ personId: p.personId, name: p.name, why: "no_role" });
    people.push(pm);
  }
  people.sort(
    (a, b) =>
      STATUS_ORDER[a.status.kind] - STATUS_ORDER[b.status.kind] ||
      a.name.localeCompare(b.name),
  );
  const byStatus: Record<StatusKind, number> = {
    in_progress: 0,
    not_ready: 0,
    needs_review: 0,
    ready: 0,
    approved: 0,
    paid: 0,
  };
  let expected = 0,
    counted: number | null = null,
    paidLeave = 0,
    holidays = 0,
    payUsd = 0,
    payProvisional = false;
  const payMissing: string[] = [];
  for (const pm of people) {
    byStatus[pm.status.kind]++;
    expected += pm.hours.expected;
    // Counted from real data, for the people whose pay follows hours or is in
    // shadow: no-data days are left out, and nobody with no data adds hours.
    if (
      (pm.paysOnHours || pm.shadow) &&
      pm.hours.counted !== null &&
      pm.hours.tracked !== null
    )
      counted =
        (counted ?? 0) + Math.max(0, pm.hours.counted - pm.hours.noData);
    paidLeave += pm.hours.paidLeave;
    holidays += pm.hours.holidays;
    if (pm.pay.totalUsd === null) payMissing.push(pm.name);
    else payUsd += pm.pay.totalUsd;
    if (pm.pay.provisional) payProvisional = true;
  }
  const without = new Map<
    string,
    { externalId: string; name: string; bookings: number }
  >();
  for (const t of ctx.leaveTypes)
    if (t.payRule === null && t.bookingsThisMonth > 0)
      without.set(t.externalId, {
        externalId: t.externalId,
        name: t.name,
        bookings: t.bookingsThisMonth,
      });
  const finalReadOn = `${nextMonth(ctx.month)}-03`;
  return {
    month: ctx.month,
    ruleVersion: HOURS_RULE_VERSION,
    settings: ctx.settings,
    sources: ctx.sources,
    closed: {
      hubstaff: { ok: ctx.closed.hubstaff, finalReadOn },
      timetastic: { ok: ctx.closed.timetastic, finalReadOn },
    },
    people,
    notCounted,
    totals: {
      expected,
      counted,
      paidLeave,
      holidays,
      payUsd: payMissing.length ? null : Math.round(payUsd * 100) / 100,
      payProvisional,
      payMissing,
      byStatus,
    },
    notTrackingNow: people
      .filter(pm => pm.now && pm.now.kind !== "tracking")
      .map(pm => ({
        personId: pm.personId,
        name: pm.name,
        role: pm.role,
        flag: pm.now as NowFlag,
      })),
    leaveTypesWithoutRule: [...without.values()],
  };
}

// ---------------------------------------------------------------------------
// The hash

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number")
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

/**
 * The canonical JSON the approval hash covers: the rule version, the pay
 * settings in force, the person's inputs without the volatile fields
 * (online, last activity, allowance), coverage as day lists and the closed
 * flags (no timestamps), the leave rules their bookings use, and the prior
 * approvals (their hashes plus today's provider rows).
 */
export function canonicalPersonInputs(p: PersonInputs, ctx: MonthCtx): string {
  const settings: Record<string, unknown> = {};
  for (const k of PAY_SETTINGS) settings[k] = ctx.settings[k];
  const used = new Set((p.bookings ?? []).map(b => String(b.leaveTypeId)));
  const leaveRules = ctx.leaveTypes
    .filter(t => used.has(String(t.externalId)))
    .map(t => ({
      externalId: t.externalId,
      payRule: t.payRule,
      paidShare: t.paidShare,
      ruleFromMonth: t.ruleFromMonth,
    }));
  const person = {
    ...p,
    accounts: (p.accounts ?? []).map(
      ({
        online: _o,
        lastActivityAt: _l,
        allowanceRemaining: _a,
        allowanceUnit: _u,
        ...rest
      }) => rest,
    ),
    approval: null,
    priorApprovals: (p.priorApprovals ?? []).map(pa => ({
      month: pa.month,
      inputsHash: pa.approval?.inputsHash ?? null,
      current: pa.current,
      carried: pa.carried,
    })),
  };
  return canonical({
    ruleVersion: HOURS_RULE_VERSION,
    month: ctx.month,
    settings,
    person,
    coverage: {
      hubstaff: [...ctx.coverage.hubstaff].sort(),
      timetastic: [...ctx.coverage.timetastic].sort(),
    },
    closed: ctx.closed,
    leaveRules,
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPerson(
  p: PersonInputs,
  ctx: MonthCtx,
): Promise<string> {
  return sha256Hex(canonicalPersonInputs(p, ctx));
}

/** Fills each person's inputsHash. Approved people keep their approval's hash. */
export async function hashMonth(month: HoursMonth): Promise<HoursMonth> {
  const people = await Promise.all(
    month.people.map(async pm => {
      if (pm.approval) return pm;
      const text = CANONICAL.get(pm);
      if (!text) return pm;
      const hashed = { ...pm, inputsHash: await sha256Hex(text) };
      CANONICAL.set(hashed, text);
      return hashed;
    }),
  );
  return { ...month, people };
}

// ---------------------------------------------------------------------------
// Approval helpers (used by cockpit-hours-api)

/** The changes carried from earlier approved months, worked out now and not yet written as rows. */
export function computedCarries(
  p: PersonInputs,
  ctx: MonthCtx,
): { fromMonth: Ym; amount: number }[] {
  return carryLines(p, ctx, []).map(c => ({
    fromMonth: c.fromMonth,
    amount: c.amount,
  }));
}

/**
 * The snapshot stored with an approval: the person's inputs and the month's
 * rule context, with the computed carry lines folded in as corrections (so a
 * later recompute reproduces the approved figure) and no nested approvals.
 */
export function approvalSnapshot(
  p: PersonInputs,
  ctx: MonthCtx,
  computedCarries: { fromMonth: Ym; amount: number; stored: boolean }[],
): ApprovalSnapshot {
  let nextId = -1;
  const folded: Adjustment[] = computedCarries
    .filter(c => !c.stored)
    .map(c => ({
      id: nextId--,
      kind: "correction",
      month: ctx.month,
      day: null,
      seconds: null,
      mode: null,
      paidShare: null,
      decision: null,
      bookingId: null,
      amount: c.amount,
      currency: null,
      fromMonth: c.fromMonth,
      carried: true,
      snapshot: null,
      reason: "Carried at approval",
      setBy: "approval",
      setAt: "",
    }));
  return {
    ...p,
    adjustments: [...(p.adjustments ?? []), ...folded],
    approval: null,
    priorApprovals: [],
    snapshotCtx: {
      month: ctx.month,
      ruleVersion: ctx.ruleVersion,
      rules: ctx.rules,
      leaveTypes: ctx.leaveTypes,
      holidayOverrides: ctx.holidayOverrides,
      ceoTtUserId: ctx.ceoTtUserId,
      usdPer: ctx.usdPer,
    },
  };
}
