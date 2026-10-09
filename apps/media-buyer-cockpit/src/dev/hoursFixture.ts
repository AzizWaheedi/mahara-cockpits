/**
 * Hand-made hours months for the layout harness (`bun run harness`), so the
 * Hours and pay screens render in every state before any backend exists.
 * Every name, email, id and amount here is invented; no real person or pay
 * appears in this file (design section 7: a test fails on any company
 * address). Never imported by the production app.
 *
 * Scenarios, picked with `?hours=` on the harness address:
 *   full     both keys connected; September closed with every status, October in progress
 *   none     nothing connected
 *   never    keys saved, never read
 *   keys     Hubstaff key expiring, Timetastic key refused
 *   blocked  Hubstaff plan has no API access, Timetastic not checked
 *   firewall Hubstaff's firewall (Cloudflare 1010) stopped the last read, Timetastic connected
 *   stale    Hubstaff key used up (personal token), Timetastic not read lately
 * Months other than September and October 2026 come back unread.
 */
import type { HoursAccount, HoursStatus } from "../lib/ceoHoursClient";
import {
  type Approval,
  type DayKind,
  type DayView,
  HOURS_DEFAULTS,
  HOURS_RULE_VERSION,
  type HoursInputs,
  type HoursMonth,
  type LookAt,
  type NowFlag,
  type PersonInputs,
  type PersonMonth,
  type Reason,
  type SourceStatus,
  type StatusKind,
  type Ym,
  type Ymd,
} from "../types/ceo/hoursContract";

export type HoursScenario =
  | "full"
  | "none"
  | "never"
  | "keys"
  | "blocked"
  | "firewall"
  | "stale";

const H = 3600;
const DAY = 7 * H;
const USD_PER: Record<string, number> = { USD: 1, KWD: 3.26, EGP: 0.0206 };
const TODAY: Ymd = "2026-10-08";
const NOW_ISO = "2026-10-08T08:15:00Z"; // 11:15 in Kuwait

const r2 = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (minsAgo: number) =>
  new Date(Date.parse(NOW_ISO) - minsAgo * 60_000).toISOString();

const LONG_DAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const LONG_MONTH = [
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

function dow(day: Ymd): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysIn(ym: Ym): Ymd[] {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`);
}
function hText(s: number): string {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`;
}

function label(d: Omit<DayView, "label">): string {
  const [, m, dd] = d.day.split("-").map(Number);
  const when = `${LONG_DAY[dow(d.day)]} ${dd} ${LONG_MONTH[m - 1]}`;
  const what: Record<DayKind, string> = {
    not_employed: "not on the team",
    off: d.counted ? `day off, ${hText(d.counted)} worked` : "day off",
    future: "still ahead",
    today: `today, ${hText(d.tracked ?? 0)} tracked so far`,
    worked: `${hText(d.counted ?? 0)} counted of ${hText(d.expected)}`,
    short: `${hText(d.counted ?? 0)} counted of ${hText(d.expected)}, short`,
    leave_paid: `paid leave, ${hText(d.paidLeave)}`,
    leave_unpaid: `unpaid leave, ${hText(d.unpaid)}`,
    leave_part: "part-paid leave",
    holiday: `public holiday, ${d.holiday ?? ""}`,
    no_data: `no Hubstaff data, ${hText(d.expected)} expected`,
    unverified: "Hubstaff's totals disagree, waiting for the next read",
    absent: `nothing tracked, ${hText(d.expected)} expected, needs a decision`,
    absent_confirmed: "confirmed absent",
    excused: "counted as worked",
    worked_day_off: `day off, ${hText(d.counted ?? 0)} worked`,
  };
  return `${when}: ${what[d.kind]}`;
}

/**
 * A month of days: Fridays off, Saturday to Thursday at 7 h, days after
 * `today` still ahead. `over` changes single days by their day of the month.
 */
function month(
  ym: Ym,
  today: Ymd | null,
  over: Record<number, Partial<DayView>> = {},
  opts: { fixed?: boolean; employedFrom?: Ymd; employedTo?: Ymd } = {},
): DayView[] {
  return daysIn(ym).map(day => {
    const n = Number(day.slice(8));
    const friday = dow(day) === 5;
    let base: Omit<DayView, "label">;
    const shared = {
      day,
      paidLeave: 0,
      unpaid: 0,
      holiday: null,
      leave: [],
      adjustmentIds: [],
    };
    if (
      (opts.employedFrom && day < opts.employedFrom) ||
      (opts.employedTo && day > opts.employedTo)
    )
      base = {
        ...shared,
        kind: "not_employed",
        expected: 0,
        counted: 0,
        tracked: null,
      };
    else if (friday)
      base = { ...shared, kind: "off", expected: 0, counted: 0, tracked: 0 };
    else if (today && day > today)
      base = {
        ...shared,
        kind: "future",
        expected: DAY,
        counted: null,
        tracked: null,
      };
    else if (today && day === today)
      base = {
        ...shared,
        kind: "today",
        expected: DAY,
        counted: opts.fixed ? 0 : 2.25 * H,
        tracked: opts.fixed ? null : 2.25 * H,
      };
    else
      base = {
        ...shared,
        kind: "worked",
        expected: DAY,
        counted: opts.fixed ? 0 : DAY,
        tracked: opts.fixed ? null : DAY,
      };
    const d = { ...base, ...(over[n] ?? {}) } as Omit<DayView, "label">;
    return { ...d, label: label(d) };
  });
}

type PersonSpec = {
  id: number;
  name: string;
  role: string;
  tracking: "required" | "optional" | "exempt";
  basis: "hours" | "fixed";
  set?: boolean;
  paysOnHours: boolean;
  shadow: boolean;
  base: number;
  currency: string;
  days: DayView[];
  status: StatusKind;
  reasons?: Reason[];
  lookAt?: LookAt[];
  manual?: number;
  manualCounted?: number | null;
  activity?: number | null;
  leaveLeft?: number;
  now?: NowFlag | null;
  approval?: Partial<Approval> | null;
  changed?: PersonMonth["changedSinceApproval"];
  corrections?: PersonMonth["pay"]["corrections"];
  shadowUndecided?: number;
};

/** Hours and pay from the days, by the rule's shape: one month sum, grace, the cap at target. */
function person(s: PersonSpec): PersonMonth {
  const days = s.days;
  const fixed = !s.paysOnHours && !s.shadow;
  const sum = (f: (d: DayView) => number) => days.reduce((n, d) => n + f(d), 0);
  const fullMonth = sum(d =>
    d.kind === "not_employed" ? DAY_IF_WORK(d) : d.expected,
  );
  const expected = sum(d => (d.kind === "not_employed" ? 0 : d.expected));
  const unpaid = sum(d => d.unpaid);
  const target = expected - unpaid;
  const noData = sum(d =>
    d.kind === "no_data" || d.kind === "unverified" ? d.expected : 0,
  );
  const holidays = sum(d => (d.kind === "holiday" ? d.expected : 0));
  const paidLeave = sum(d => d.paidLeave);
  const excused = sum(d => (d.kind === "excused" ? d.expected : 0));
  const tracked = fixed ? null : sum(d => d.tracked ?? 0);
  // An open month counts what is known so far; the days still ahead are paid
  // as worked until they happen, so the figure is provisional.
  const ahead = sum(d => (d.kind === "future" ? d.expected : 0));
  const counted = fixed
    ? target
    : sum(d => (d.kind === "future" ? 0 : (d.counted ?? 0)));
  const grace = Math.floor(HOURS_DEFAULTS.graceShare * target);
  const short = Math.max(0, target - counted - noData - ahead);
  const forgiven = s.paysOnHours ? Math.min(grace, short) : 0;
  const payable = s.paysOnHours
    ? Math.min(target, counted + noData + ahead + forgiven)
    : target;
  const extra = fixed ? 0 : Math.max(0, counted - target);
  const amountRaw = fullMonth ? r2((s.base * payable) / fullMonth) : 0;
  const corrections = s.corrections ?? { applied: 0, carriedOut: 0, lines: [] };
  const blocked = s.status === "not_ready" && !noData;
  const total = blocked ? null : r2(amountRaw + corrections.applied);
  const shadowCounted = counted + ahead - (s.shadowUndecided ?? 0) * DAY;
  const shadowPayable = Math.min(
    target,
    shadowCounted + Math.min(grace, Math.max(0, target - shadowCounted)),
  );
  const approval: Approval | null = s.approval
    ? ({
        status: "approved",
        ruleVersion: HOURS_RULE_VERSION,
        inputsHash: `fixture-${s.id}`,
        shadow: s.shadow,
        amount: total ?? 0,
        currency: s.currency,
        amountUsd:
          total === null ? null : r2(total * (USD_PER[s.currency] ?? 1)),
        payableS: payable,
        approvedAt: "2026-10-03T07:40:00Z",
        approvedBy: "ceo@example.test",
        paidAt: null,
        paidNote: null,
        inputs: {} as PersonInputs,
        result: {} as PersonMonth,
        ...s.approval,
      } as Approval)
    : null;
  return {
    personId: s.id,
    name: s.name,
    role: s.role,
    currency: s.currency,
    tracking: { value: s.tracking, from: s.set ? "set" : "role_default" },
    payBasis: { value: s.basis, from: s.set ? "set" : "role_default" },
    paysOnHours: s.paysOnHours,
    shadow: s.shadow,
    hours: {
      expected,
      fullMonth,
      unpaid,
      target,
      tracked,
      manual: fixed ? null : (s.manual ?? 0),
      manualCounted: fixed
        ? null
        : s.manualCounted === undefined
          ? (s.manual ?? 0)
          : s.manualCounted,
      paidLeave,
      holidays,
      excused,
      entered: 0,
      counted: fixed ? null : counted,
      forgiven,
      payable: blocked ? null : payable,
      extra,
      workedOnDaysOff: sum(d =>
        d.kind === "worked_day_off" ? (d.counted ?? 0) : 0,
      ),
      overDayLimit: 0,
      idleNotCounted: 0,
      overtimePaid: 0,
      noData,
    },
    segments: fullMonth
      ? [
          {
            from: days[0].day,
            to: days[days.length - 1].day,
            base: s.base,
            target,
            payable,
            amount: amountRaw,
          },
        ]
      : [],
    pay: {
      amount: blocked ? null : amountRaw,
      overtime: 0,
      corrections,
      total,
      provisional: noData > 0 || (ahead > 0 && !fixed),
      shadowAmount: s.shadow
        ? r2((s.base * Math.max(0, shadowPayable)) / fullMonth)
        : null,
      shadowUndecidedDays: s.shadowUndecided ?? 0,
      totalUsd: total === null ? null : r2(total * (USD_PER[s.currency] ?? 1)),
      valuePerHour: fullMonth ? r2((s.base / fullMonth) * H) : null,
    },
    status: { kind: s.status, reasons: s.reasons ?? [] },
    lookAt: s.lookAt ?? [],
    days,
    activity: {
      share: fixed ? null : (s.activity ?? 0.46),
      inputSeconds: tracked ?? 0,
    },
    leaveLeft:
      s.leaveLeft === undefined ? null : { amount: s.leaveLeft, unit: "Days" },
    now: s.now ?? null,
    approval,
    changedSinceApproval: s.changed ?? null,
    inputsHash: `fixture-hash-${s.id}`,
  };
}

/** A working day's hours, for the full-month figure of someone who joined or left. */
function DAY_IF_WORK(d: DayView): number {
  return dow(d.day) === 5 ? 0 : DAY;
}

const leave = (
  name: string,
  status: "Approved" | "Pending" = "Approved",
  part: "full" | "am" | "pm" | "hours" = "full",
) => [{ name, part, status }];

// --- September 2026: closed, every status at once ---

function september(): PersonMonth[] {
  const ym = "2026-09";
  return [
    person({
      id: 101,
      name: "Hala Mansour",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      paysOnHours: true,
      shadow: false,
      base: 910,
      currency: "USD",
      status: "not_ready",
      manual: 0,
      activity: 0.52,
      leaveLeft: 17,
      days: month(ym, null, {
        3: { kind: "short", counted: 5 * H, tracked: 5 * H },
        14: { kind: "no_data", counted: null, tracked: null },
        15: { kind: "no_data", counted: null, tracked: null },
        24: {
          kind: "leave_paid",
          counted: DAY,
          tracked: 0,
          paidLeave: DAY,
          leave: leave("Annual leave"),
        },
      }),
      reasons: [
        {
          code: "no_data_days",
          severity: "blocks",
          text: "2 days with no Hubstaff data (14 and 15 Sep). Approval waits for the next read.",
          days: ["2026-09-14", "2026-09-15"],
        },
      ],
    }),
    person({
      id: 102,
      name: "Omar Fayed",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      paysOnHours: true,
      shadow: false,
      base: 910,
      currency: "USD",
      status: "needs_review",
      manual: 100 * 60,
      manualCounted: null,
      activity: 0.41,
      leaveLeft: 12.5,
      days: month(ym, null, {
        8: { kind: "absent", counted: 0, tracked: 0 },
        16: { kind: "worked", counted: 12 * H, tracked: 16 * H },
        20: {
          kind: "leave_paid",
          counted: DAY,
          tracked: 0,
          paidLeave: DAY,
          leave: leave("Annual leave"),
        },
        11: { kind: "worked_day_off", counted: 3 * H, tracked: 3 * H },
      }),
      reasons: [
        {
          code: "absent_no_leave",
          severity: "decide",
          text: "Nothing tracked and no leave booked on Tue 8 Sep.",
          days: ["2026-09-08"],
        },
        {
          code: "manual_time",
          severity: "decide",
          text: "1 h 40 min of manual time is waiting for your OK.",
          seconds: 100 * 60,
        },
        {
          code: "over_day_limit",
          severity: "note",
          text: "16 h tracked on 16 Sep: 4 h above the 12 h limit not counted.",
          days: ["2026-09-16"],
          seconds: 4 * H,
        },
        {
          code: "worked_day_off",
          severity: "note",
          text: "Worked on a day off: 3 h on Fri 11 Sep, counted toward the month.",
          days: ["2026-09-11"],
          seconds: 3 * H,
        },
      ],
    }),
    person({
      id: 103,
      name: "Sara Kanaan",
      role: "Media buyer",
      tracking: "required",
      basis: "hours",
      paysOnHours: false,
      shadow: true,
      base: 1200,
      currency: "USD",
      status: "ready",
      shadowUndecided: 1,
      activity: 0.58,
      leaveLeft: 19,
      days: month(ym, null, {
        23: { kind: "absent", counted: 0, tracked: 0 },
        9: { kind: "short", counted: 4.5 * H, tracked: 4.5 * H },
        29: { kind: "short", counted: 5 * H, tracked: 5 * H },
      }),
      reasons: [
        {
          code: "extra_hours",
          severity: "note",
          text: "Shadow month: the approved figure is fixed pay. Hubstaff never holds it back.",
        },
      ],
      lookAt: [
        {
          code: "hubstaff_dropped",
          text: "Hubstaff now shows 1 h 10 min less on 17 Sep than on the 20 Sep read.",
        },
      ],
    }),
    person({
      id: 104,
      name: "Yousef Darwish",
      role: "Closer",
      tracking: "optional",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 1500,
      currency: "USD",
      status: "ready",
      leaveLeft: 18,
      days: month(
        ym,
        null,
        {
          22: {
            kind: "leave_paid",
            counted: DAY,
            paidLeave: DAY,
            leave: leave("Annual leave"),
          },
          23: {
            kind: "leave_unpaid",
            counted: 0,
            unpaid: DAY,
            leave: leave("Unpaid leave"),
          },
        },
        { fixed: true },
      ),
      lookAt: [
        {
          code: "leave_not_ceo_approved",
          text: "Annual leave on 22 Sep was approved by someone else in Timetastic.",
        },
      ],
    }),
    person({
      id: 105,
      name: "Mona Haddad",
      role: "Client success manager",
      tracking: "optional",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 300,
      currency: "KWD",
      status: "approved",
      leaveLeft: 21,
      days: month(ym, null, {}, { fixed: true }),
      approval: {},
    }),
    person({
      id: 106,
      name: "Tala Odeh",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      set: true,
      paysOnHours: true,
      shadow: false,
      base: 910,
      currency: "USD",
      status: "approved",
      activity: 0.49,
      days: month(ym, null, {
        2: { kind: "short", counted: 5.5 * H, tracked: 5.5 * H },
        17: { kind: "absent_confirmed", counted: 0, tracked: 0, unpaid: DAY },
      }),
      approval: { amount: 867.5, amountUsd: 867.5, payableS: 173.5 * H },
      changed: { seconds: 1.5 * H, amount: 7.5, alreadyCarried: 0 },
    }),
    person({
      id: 107,
      name: "Fadi Nassar",
      role: "Systems manager",
      tracking: "exempt",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 1800,
      currency: "USD",
      status: "paid",
      days: month(ym, null, {}, { fixed: true }),
      approval: {
        status: "paid",
        paidAt: "2026-10-05T09:00:00Z",
        paidNote: "Bank transfer",
      },
    }),
    person({
      id: 108,
      name: "Jad Salem",
      role: "Creative strategist",
      tracking: "exempt",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 1100,
      currency: "USD",
      status: "not_ready",
      days: month(ym, null, {}, { fixed: true }),
      reasons: [
        {
          code: "timetastic_not_read",
          severity: "blocks",
          text: "Timetastic has no user linked to this person, so leave can't be checked. Link them, or record no leave this month.",
        },
      ],
    }),
    person({
      id: 109,
      name: "Rana Saeed",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      paysOnHours: true,
      shadow: false,
      base: 0,
      currency: "USD",
      status: "ready",
      days: month(ym, null, {}, { employedTo: "2026-08-31" }),
      corrections: {
        applied: 42,
        carriedOut: 0,
        lines: [
          { fromMonth: "2026-08", amount: 42, applied: 42, carried: true },
        ],
      },
      lookAt: [
        {
          code: "carried_change",
          text: "Carried from August: Hubstaff added 8 h 24 min after it was approved.",
          amount: 42,
          fromMonth: "2026-08",
        },
      ],
    }),
  ];
}

// --- October 2026: in progress, today Thursday 8 October ---

function october(): PersonMonth[] {
  const ym = "2026-10";
  const progress: Reason = {
    code: "final_read_pending",
    severity: "blocks",
    text: "October closes once it is read on or after 3 November.",
  };
  return [
    person({
      id: 101,
      name: "Hala Mansour",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      paysOnHours: true,
      shadow: false,
      base: 910,
      currency: "USD",
      status: "in_progress",
      leaveLeft: 16,
      now: { kind: "tracking", trackedToday: 2.25 * H },
      days: month(ym, TODAY, {
        6: { kind: "short", counted: 6 * H, tracked: 6 * H },
      }),
      reasons: [progress],
    }),
    person({
      id: 102,
      name: "Omar Fayed",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      paysOnHours: true,
      shadow: false,
      base: 910,
      currency: "USD",
      status: "in_progress",
      leaveLeft: 12.5,
      now: { kind: "not_tracking", since: "10:00", seconds: 75 * 60 },
      days: month(ym, TODAY, {
        8: { kind: "today", counted: 0, tracked: 0 },
        5: { kind: "absent", counted: 0, tracked: 0 },
      }),
      reasons: [
        progress,
        {
          code: "absent_no_leave",
          severity: "decide",
          text: "Nothing tracked and no leave booked on Mon 5 Oct.",
          days: ["2026-10-05"],
        },
      ],
    }),
    person({
      id: 103,
      name: "Sara Kanaan",
      role: "Media buyer",
      tracking: "required",
      basis: "hours",
      paysOnHours: false,
      shadow: true,
      base: 1200,
      currency: "USD",
      status: "in_progress",
      now: { kind: "stopped", at: "10:40" },
      days: month(ym, TODAY, {
        8: { kind: "today", counted: 0.6 * H, tracked: 0.6 * H },
        1: {
          kind: "leave_paid",
          counted: DAY,
          tracked: 0,
          paidLeave: DAY,
          leave: leave("Sick"),
        },
      }),
      reasons: [progress],
    }),
    person({
      id: 104,
      name: "Yousef Darwish",
      role: "Closer",
      tracking: "optional",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 1500,
      currency: "USD",
      status: "in_progress",
      days: month(
        ym,
        TODAY,
        {
          13: {
            kind: "future",
            leave: leave("Compassionate", "Approved"),
            paidLeave: 0,
          },
        },
        { fixed: true },
      ),
      reasons: [
        progress,
        {
          code: "leave_type_without_rule",
          severity: "blocks",
          text: "Set a pay rule for Compassionate (1 booking).",
        },
      ],
    }),
    person({
      id: 105,
      name: "Mona Haddad",
      role: "Client success manager",
      tracking: "optional",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 300,
      currency: "KWD",
      status: "in_progress",
      days: month(
        ym,
        TODAY,
        { 4: { kind: "holiday", holiday: "Company day off" } },
        { fixed: true },
      ),
      reasons: [progress],
    }),
    person({
      id: 106,
      name: "Tala Odeh",
      role: "Call centre agent",
      tracking: "required",
      basis: "hours",
      set: true,
      paysOnHours: true,
      shadow: false,
      base: 910,
      currency: "USD",
      status: "in_progress",
      days: month(ym, TODAY, {
        7: { kind: "unverified", counted: null, tracked: 5 * H },
      }),
      reasons: [
        progress,
        {
          code: "hours_unverified",
          severity: "blocks",
          text: "Hubstaff's daily totals and its 10-minute records differ on 1 day. Approval waits for the next read to settle it.",
          days: ["2026-10-07"],
        },
      ],
    }),
    person({
      id: 107,
      name: "Fadi Nassar",
      role: "Systems manager",
      tracking: "exempt",
      basis: "fixed",
      paysOnHours: false,
      shadow: false,
      base: 1800,
      currency: "USD",
      status: "in_progress",
      days: month(ym, TODAY, {}, { fixed: true }),
      reasons: [progress],
    }),
  ];
}

function totals(people: PersonMonth[]): HoursMonth["totals"] {
  const by: Record<StatusKind, number> = {
    in_progress: 0,
    not_ready: 0,
    needs_review: 0,
    ready: 0,
    approved: 0,
    paid: 0,
  };
  for (const p of people) by[p.status.kind] += 1;
  const tracked = people.filter(p => p.paysOnHours || p.shadow);
  const counted = tracked.some(p => p.hours.counted === null)
    ? null
    : tracked.reduce((n, p) => n + (p.hours.counted ?? 0), 0);
  const usd = people.map(
    p =>
      p.approval?.amountUsd ??
      (p.pay.totalUsd === null ? null : p.pay.totalUsd),
  );
  return {
    expected: people.reduce((n, p) => n + p.hours.expected, 0),
    counted,
    paidLeave: people.reduce((n, p) => n + p.hours.paidLeave, 0),
    holidays: people.reduce((n, p) => n + p.hours.holidays, 0),
    payUsd: usd.some(v => v === null)
      ? null
      : r2(usd.reduce<number>((n, v) => n + (v ?? 0), 0)),
    payProvisional: people.some(p => p.pay.provisional),
    payMissing: [],
    byStatus: by,
  };
}

// --- Sources, accounts and inputs ---

function source(
  provider: "hubstaff" | "timetastic",
  state: SourceStatus["state"],
  over: Partial<SourceStatus> = {},
): SourceStatus {
  const missing = state === "missing_key";
  const never = state === "never_run" || missing;
  return {
    provider,
    state,
    note: null,
    key: missing
      ? null
      : {
          kind: provider === "hubstaff" ? "hubstaff_org" : "timetastic",
          last4: provider === "hubstaff" ? "7Qx2" : "a91F",
          savedAt: "2026-10-08T06:10:00Z",
          savedBy: "ceo@example.test",
          expiresOn: null,
        },
    accountId: missing ? null : provider === "hubstaff" ? "900001" : "900002",
    lastRunAt: never ? null : iso(14),
    lastOkAt: never ? null : iso(14),
    zoneShiftedDays: 0,
    accounts: never ? 0 : provider === "hubstaff" ? 5 : 11,
    linked: never ? 0 : provider === "hubstaff" ? 4 : 10,
    unlinked: never ? 0 : 1,
    ignored: 0,
    ...over,
  };
}

const SOURCES: Record<HoursScenario, SourceStatus[]> = {
  full: [source("hubstaff", "connected"), source("timetastic", "connected")],
  none: [
    source("hubstaff", "missing_key"),
    source("timetastic", "missing_key"),
  ],
  never: [
    source("hubstaff", "never_run"),
    source("timetastic", "unchecked", {
      lastRunAt: null,
      lastOkAt: null,
      accounts: 0,
      linked: 0,
      unlinked: 0,
    }),
  ],
  keys: [
    source("hubstaff", "expiring", {
      key: {
        kind: "hubstaff_org",
        last4: "7Qx2",
        savedAt: "2026-07-12T06:10:00Z",
        savedBy: "ceo@example.test",
        expiresOn: "2026-10-10",
      },
    }),
    source("timetastic", "refused", { lastOkAt: iso(60 * 26) }),
  ],
  firewall: [
    source("hubstaff", "firewall_blocked", { lastOkAt: iso(130) }),
    source("timetastic", "connected"),
  ],
  blocked: [
    source("hubstaff", "plan_blocked", {
      lastOkAt: null,
      accounts: 0,
      linked: 0,
      unlinked: 0,
    }),
    source("timetastic", "unchecked"),
  ],
  stale: [
    source("hubstaff", "needs_new_key", {
      key: {
        kind: "hubstaff_personal",
        last4: "k3Lm",
        savedAt: "2026-09-20T06:10:00Z",
        savedBy: "ceo@example.test",
        expiresOn: null,
      },
      lastOkAt: iso(200),
    }),
    source("timetastic", "stale", { lastOkAt: iso(185) }),
  ],
};

function accounts(): HoursAccount[] {
  const hub = (
    externalId: string,
    email: string | null,
    name: string,
    personId: number | null,
    linkMethod: HoursAccount["linkMethod"],
    extra: Partial<HoursAccount> = {},
  ): HoursAccount => ({
    provider: "hubstaff",
    externalId,
    email,
    name,
    status: "active",
    membershipRole: personId === 1 ? "owner" : "user",
    personId,
    linkMethod,
    ignored: false,
    emailDiffers: false,
    ...extra,
  });
  const tt = (
    externalId: string,
    name: string,
    personId: number | null,
    extra: Partial<HoursAccount> = {},
  ): HoursAccount => ({
    provider: "timetastic",
    externalId,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
    name,
    status: "active",
    membershipRole: null,
    personId,
    linkMethod: personId ? "payroll_id" : null,
    ignored: false,
    emailDiffers: false,
    ...extra,
  });
  return [
    hub("4401", "owner@example.test", "The CEO", 1, "email"),
    hub("4402", "hala.mansour@example.test", "Hala Mansour", 101, "email"),
    hub("4403", "omar.fayed@example.test", "Omar Fayed", 102, "email"),
    hub("4404", "tala.o@example.test", "Tala O.", 106, "manual", {
      emailDiffers: true,
    }),
    hub("4411", null, "A. Agent", null, null),
    tt("8801", "Hala Mansour", 101),
    tt("8802", "Omar Fayed", 102),
    tt("8803", "Sara Kanaan", 103),
    tt("8804", "Yousef Darwish", 104),
    tt("8805", "Mona Haddad", 105),
    tt("8806", "Tala Odeh", 106),
    tt("8807", "Fadi Nassar", 107),
    tt("8809", "Old Test User", null, { ignored: true }),
  ];
}

const TERMS: Record<number, Partial<PersonInputs["terms"]>> = {
  101: {
    hoursPayFrom: "2026-09",
    termsConfirmedAt: "2026-08-25T08:00:00Z",
    contractCountry: "EG",
    worksIn: "EG",
  },
  102: {
    hoursPayFrom: "2026-09",
    termsConfirmedAt: "2026-08-25T08:00:00Z",
    contractCountry: "EG",
    worksIn: "EG",
  },
  106: {
    tracking: "required",
    payBasis: "hours",
    hoursPayFrom: "2026-09",
    termsConfirmedAt: "2026-08-25T08:00:00Z",
    contractCountry: "JO",
    worksIn: "JO",
  },
  105: { contractCountry: "KW", worksIn: "KW" },
};

function inputsFor(m: HoursMonth, scenario: HoursScenario): HoursInputs {
  const ym = m.month;
  const read =
    scenario === "full" ||
    scenario === "keys" ||
    scenario === "stale" ||
    scenario === "blocked" ||
    scenario === "firewall";
  const known = ym === "2026-09" || ym === "2026-10";
  const cov = read && known ? daysIn(ym).filter(d => d <= TODAY) : [];
  const accts = accounts();
  const people: PersonInputs[] = m.people.map(p => {
    const holidays = p.days
      .filter(d => d.kind === "holiday")
      .map(d => ({
        day: d.day,
        name: d.holiday ?? "Holiday",
        source: "timetastic" as const,
      }));
    return {
      personId: p.personId,
      name: p.name,
      role: p.role,
      engagement: "staff",
      active: p.personId !== 109,
      startedOn: "2025-03-01",
      endedOn: p.personId === 109 ? "2026-08-31" : null,
      addedOn: "2025-03-01",
      employment: [
        {
          kind: "employed",
          from: "2025-03-01",
          to: p.personId === 109 ? "2026-08-31" : null,
        },
      ],
      terms: {
        tracking: null,
        payBasis: null,
        hoursPayFrom: null,
        termsConfirmedAt: null,
        contractCountry: null,
        worksIn: null,
        kwClauseReviewedAt: null,
        ...(TERMS[p.personId] ?? {}),
      },
      schedules: [],
      payHistory: [],
      accounts: accts
        .filter(a => a.personId === p.personId)
        .map(a => ({
          provider: a.provider,
          externalId: a.externalId,
          email: a.email,
          name: a.name,
          linkMethod: a.linkMethod ?? "manual",
          status: a.status,
          memberSince: "2026-03-01",
          removedOn: null,
          trackable: true,
          lastClientActivityOn: null,
          online: null,
          lastActivityAt: null,
          allowanceRemaining: null,
          allowanceUnit: null,
          scheduleMismatch: null,
          emailDiffers: a.emailDiffers,
        })),
      hubstaffDays: [],
      bookings: p.personId === 103 && ym === "2026-09" ? [] : [],
      ttDays: [],
      holidays,
      adjustments:
        p.personId === 106 && ym === "2026-09"
          ? [
              {
                id: 9001,
                kind: "absent_unpaid",
                month: ym,
                day: "2026-09-17",
                seconds: null,
                mode: null,
                paidShare: null,
                decision: null,
                bookingId: null,
                amount: null,
                currency: null,
                fromMonth: null,
                carried: false,
                snapshot: { trackedS: 0, manualS: 0, covered: true, leaveS: 0 },
                reason: "No time tracked and no leave booked",
                setBy: "ceo@example.test",
                setAt: "2026-10-03T07:30:00Z",
              },
            ]
          : [],
      sickDaysThisYear: 2,
      approval: p.approval,
      priorApprovals: [],
    };
  });
  return {
    month: ym,
    today: TODAY,
    nowMinute: 11 * 60 + 15,
    rules: null,
    sources: m.sources,
    coverage: { hubstaff: cov, timetastic: cov },
    closed: { hubstaff: ym < "2026-10", timetastic: ym < "2026-10" },
    leaveTypes: [
      {
        externalId: "1",
        name: "Annual leave",
        active: true,
        deducted: true,
        requiresApproval: true,
        payRule: "paid",
        paidShare: null,
        ruleFromMonth: "2000-01",
        suggested: "paid",
        bookingsThisMonth: ym === "2026-09" ? 3 : 0,
      },
      {
        externalId: "2",
        name: "Sick",
        active: true,
        deducted: false,
        requiresApproval: true,
        payRule: "paid",
        paidShare: null,
        ruleFromMonth: "2000-01",
        suggested: "paid",
        bookingsThisMonth: ym === "2026-10" ? 1 : 0,
      },
      {
        externalId: "3",
        name: "Unpaid leave",
        active: true,
        deducted: false,
        requiresApproval: true,
        payRule: "unpaid",
        paidShare: null,
        ruleFromMonth: "2000-01",
        suggested: "unpaid",
        bookingsThisMonth: ym === "2026-09" ? 1 : 0,
      },
      {
        externalId: "4",
        name: "Compassionate",
        active: true,
        deducted: false,
        requiresApproval: true,
        payRule: null,
        paidShare: null,
        ruleFromMonth: null,
        suggested: "paid",
        bookingsThisMonth: ym === "2026-10" ? 1 : 0,
      },
      {
        externalId: "5",
        name: "Working from home",
        active: true,
        deducted: false,
        requiresApproval: false,
        payRule: null,
        paidShare: null,
        ruleFromMonth: null,
        suggested: "not_leave",
        bookingsThisMonth: 0,
      },
    ],
    holidayOverrides:
      ym === "2026-10"
        ? [
            {
              id: 7001,
              day: "2026-10-04",
              action: "add",
              name: "Company day off",
              scope: "country",
              scopeValue: "KW",
              reason: "Added by the CEO",
            },
          ]
        : [],
    ceoTtUserId: "8800",
    people,
    usdPer: USD_PER,
  };
}

function notCounted(): HoursMonth["notCounted"] {
  return [
    { personId: 1, name: "The CEO", why: "ceo" },
    { personId: 2, name: "Shared inbox", why: "bot" },
    { personId: 110, name: "Dina Samir", why: "no_role" },
  ];
}

/** The worked-out month the screens show, for one scenario and month. */
export function hoursFixtureMonth(
  scenario: HoursScenario,
  ym: Ym,
): HoursMonth & { inputs: HoursInputs } {
  const sources = SOURCES[scenario];
  const read = !["none", "never"].includes(scenario);
  const people = !read
    ? []
    : ym === "2026-09"
      ? september()
      : ym === "2026-10"
        ? october()
        : [];
  const m: HoursMonth = {
    month: ym,
    ruleVersion: HOURS_RULE_VERSION,
    settings: HOURS_DEFAULTS,
    sources,
    closed: {
      hubstaff: {
        ok: ym < "2026-10",
        finalReadOn: `${ym === "2026-09" ? "2026-10" : "2026-11"}-03`,
      },
      timetastic: {
        ok: ym < "2026-10",
        finalReadOn: `${ym === "2026-09" ? "2026-10" : "2026-11"}-03`,
      },
    },
    people,
    notCounted: read ? notCounted() : [],
    totals: totals(people),
    notTrackingNow:
      ym === "2026-10" && read
        ? people
            .filter(p => p.now && p.now.kind !== "tracking")
            .map(p => ({
              personId: p.personId,
              name: p.name,
              role: p.role,
              flag: p.now as NowFlag,
            }))
        : [],
    leaveTypesWithoutRule:
      ym === "2026-10" && read
        ? [{ externalId: "4", name: "Compassionate", bookings: 1 }]
        : [],
  };
  return { ...m, inputs: inputsFor(m, scenario) };
}

/** The connection status for a scenario (`cockpit_ceo_hours_status`). */
export function hoursFixtureStatus(scenario: HoursScenario): HoursStatus {
  return {
    sources: SOURCES[scenario],
    lastRun:
      scenario === "none" || scenario === "never"
        ? null
        : { id: 412, mode: "recent", state: "ok", finishedAt: iso(14) },
    cronScheduled: scenario !== "never",
    accounts: scenario === "none" || scenario === "never" ? [] : accounts(),
  };
}

/** Approved pay for the Costs page (`cockpit_ceo_hours_costs`): September's approvals. */
export function hoursFixtureCosts() {
  return september()
    .filter(p => p.approval)
    .map(p => ({
      personId: p.personId,
      month: "2026-09",
      status: p.approval?.status ?? "approved",
      amount: p.approval?.amount ?? 0,
      currency: p.currency,
      amountUsd: p.approval?.amountUsd ?? null,
      shadow: p.shadow,
    }));
}
