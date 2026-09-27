/**
 * The Projections screen's words and shapes, the same file in the client
 * success cockpit (which owns the data) and the media buyer (which shows it
 * on the Sunday meeting's page). scripts/check-shared.sh keeps the two
 * copies identical. No imports: the client success backend reads its types
 * from here too.
 */

export const METRICS = [
  "resell",
  "renewal",
  "cash",
  "review",
  "referral",
] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABEL: Record<Metric, string> = {
  resell: "Re-sells",
  renewal: "Renewals",
  cash: "Cash collected",
  review: "Reviews",
  referral: "Referrals",
};

export const METRIC_UNIT: Record<Metric, "count" | "usd"> = {
  resell: "count",
  renewal: "count",
  cash: "usd",
  review: "count",
  referral: "count",
};

export const STATUSES = [
  "planned",
  "call_booked",
  "renewed",
  "resold",
  "not_this_cycle",
  "lost",
] as const;
export type PlanStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<PlanStatus, string> = {
  planned: "Planned",
  call_booked: "Call booked",
  renewed: "Renewed",
  resold: "Re-sold",
  not_this_cycle: "Not this cycle",
  lost: "Lost",
};

export const LIKELIHOODS = ["high", "medium", "low"] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  high: "Likely",
  medium: "50-50",
  low: "Unlikely",
};

export type RowState =
  | "missed"
  | "red"
  | "outcome_due"
  | "booked"
  | "planned"
  | "done";

export const STATE_LABEL: Record<RowState, string> = {
  missed: "Missed renewal",
  red: "Proactive call not booked",
  outcome_due: "Outcome not logged",
  booked: "Call booked",
  planned: "Plan the call",
  done: "Done",
};

export type WindowFilter = "0-30" | "31-60" | "booked" | "done";

export const FILTER_LABEL: Record<WindowFilter, string> = {
  "0-30": "0-30 days",
  "31-60": "31-60 days",
  booked: "Booked",
  done: "Done",
};

export type Verdict =
  | "unset"
  | "no_actual"
  | "stretch"
  | "hit"
  | "behind"
  | "missed";

export const VERDICT_LABEL: Record<Verdict, string> = {
  unset: "No projection",
  no_actual: "Actual needed",
  stretch: "Stretch hit",
  hit: "Hit",
  behind: "Below blood",
  missed: "Missed",
};

export type ActualFrom = "source" | "manual" | "missing";

export type Fact = { label: string; value: string; source: string };

/** The gold-standard library is full at ten calls. */
export const GOLD_TARGET = 10;

/** What the ClickUp card needs before the renewal window can fill. */
export const RENEWAL_FIELD = {
  name: "Contract end date",
  type: "Date",
  list: "Clients - Mahara",
} as const;

// --- the page ------------------------------------------------------------------------

export type StripRow = {
  metric: Metric;
  label: string;
  unit: "count" | "usd";
  blood: number | null;
  stretch: number | null;
  actual: number | null;
  actualFrom: ActualFrom;
  /** Where the actual comes from, or why it has to be typed in. */
  note: string;
  /** A hand-typed actual is only taken when the source cannot answer. */
  manualAllowed: boolean;
  missReason: string | null;
  verdict: Verdict;
};

export type ProjectionWeek = {
  weekStart: string;
  weekEnd: string;
  over: boolean;
  rows: StripRow[];
};

export type Offer = {
  price: number | null;
  deliverables: string | null;
  durationMonths: number | null;
};

export type WindowRow = {
  taskId: string;
  clientName: string;
  renewalDate: string;
  /** Days until the renewal date; negative once it has passed. */
  days: number;
  state: RowState;
  filters: WindowFilter[];
  planId: string | null;
  status: PlanStatus;
  likelihood: Likelihood | null;
  callBookedFor: string | null;
  notThisCycleReason: string | null;
  angle: string | null;
  objection: string | null;
  objectionAnswer: string | null;
  offer: Offer | null;
  /** Whether an offer can be written this month, and if not, why. */
  offerGate: { ok: boolean; why: string | null };
  outcomeNote: string | null;
  callRecordingUrl: string | null;
  goldStandard: boolean;
  onboardedOn: { day: string; source: string } | null;
  paid: { usd: number; source: string } | null;
  facts: Fact[];
  /** True when the facts are the plan's saved copy, false when read live. */
  factsSaved: boolean;
  updatedAt: number | null;
};

export type GoldRow = {
  planId: string;
  clientName: string;
  renewalDate: string;
  status: PlanStatus;
  outcomeNote: string | null;
  callRecordingUrl: string;
};

export type ProjectionsPage = {
  today: string;
  weekStart: string;
  /** Whose projections these are. */
  owner: string;
  /** Everyone with projections in the last nine weeks. */
  owners: string[];
  thisWeek: ProjectionWeek;
  lastWeek: ProjectionWeek;
  /** The eight weeks before this one, newest first. */
  history: ProjectionWeek[];
  window: {
    /** False while the ClickUp field does not exist. */
    tracked: boolean;
    rows: WindowRow[];
    /** Clients being served with no contract end date on their card. */
    missing: { taskId: string; clientName: string }[];
    field: { name: string; type: string; list: string };
  };
  hardest: WindowRow | null;
  gold: { count: number; target: number; rows: GoldRow[] };
  billing: {
    okAt: number | null;
    ledgerSyncedAt: number | null;
    error: string | null;
  };
  canGold: boolean;
  canEditOthers: boolean;
};

// --- changes -----------------------------------------------------------------------

export type PlanPatch = {
  likelihood?: Likelihood | "";
  angle?: string;
  objection?: string;
  objectionAnswer?: string;
  offer?: {
    price?: number | null;
    deliverables?: string;
    durationMonths?: number | null;
  } | null;
  /** A day or an ISO time; "" takes it off. */
  callBookedFor?: string;
  notThisCycleReason?: string;
  outcomeNote?: string;
  callRecordingUrl?: string;
  /** Read "where they are" again from the sources. */
  refreshFacts?: boolean;
};

export type ProjectionsEdit =
  | {
      kind: "projection";
      weekStart: string;
      metric: Metric;
      blood: number;
      stretch: number;
      forEmail?: string;
    }
  | {
      kind: "actual";
      weekStart: string;
      metric: Metric;
      actual: number | null;
      forEmail?: string;
    }
  | {
      kind: "missReason";
      weekStart: string;
      metric: Metric;
      reason: string;
      forEmail?: string;
    }
  | { kind: "plan"; taskId: string; patch: PlanPatch }
  | {
      kind: "status";
      taskId: string;
      status: PlanStatus;
      reason?: string;
      note?: string;
    }
  | { kind: "gold"; planId: string; on: boolean };

// --- writing numbers and days --------------------------------------------------------

/** "27 Sep", in UTC so a day never slips a date either side of midnight. */
export function shortDay(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

/** "Sun 27 Sep". */
export function weekdayDay(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${d.toLocaleString("en-GB", { weekday: "short", timeZone: "UTC" })} ${shortDay(day)}`;
}

/** A metric's number the way the strip writes it. */
export function metricValue(unit: "count" | "usd", n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (unit === "usd")
    return `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return String(Math.round(n * 10) / 10);
}

/** "in 12 days", "today", "3 days ago". */
export function daysLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** A booked call's time in Kuwait: "Tue 6 Oct, 13:30", or the day alone. */
export function callLabel(when: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return weekdayDay(when);
  const t = Date.parse(when);
  if (Number.isNaN(t)) return when;
  const k = new Date(t + 3 * 3600_000).toISOString();
  return `${weekdayDay(k.slice(0, 10))}, ${k.slice(11, 16)}`;
}
