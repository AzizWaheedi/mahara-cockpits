/**
 * The words of the Hours and pay card, in one place: the connection
 * sentences of design section 2.7 (exact copy), the status chips, and the
 * plain names of roles and settings. Anything shown here names roles and
 * says what to do next.
 */
import type { StatusTone } from "@/components/ceo/StatusChip";
import type {
  ApproveItem,
  PersonMonth,
  Provider,
  Reason,
  ReasonCode,
  SourceState,
  SourceStatus,
  StatusKind,
} from "@/types/ceo/hoursContract";
import { dayLabel } from "./hoursFormat";

export const PROVIDER_NAME: Record<Provider, string> = {
  hubstaff: "Hubstaff",
  timetastic: "Timetastic",
};

/** The chip beside each connection. */
export const SOURCE_CHIP: Record<
  SourceState,
  { tone: StatusTone; label: string }
> = {
  connected: { tone: "good", label: "Connected" },
  unchecked: { tone: "warning", label: "Not checked yet" },
  missing_key: { tone: "neutral", label: "Not connected" },
  refused: { tone: "serious", label: "Key refused" },
  plan_blocked: { tone: "serious", label: "Plan has no API access" },
  needs_new_key: { tone: "serious", label: "Needs a new key" },
  firewall_blocked: { tone: "serious", label: "Firewall blocked" },
  failing: { tone: "serious", label: "Reads failing" },
  stale: { tone: "warning", label: "Not read lately" },
  expiring: { tone: "warning", label: "Key expires soon" },
  never_run: { tone: "neutral", label: "Not read yet" },
};

/**
 * The sentence for a connection when the server sends none (design 2.7).
 * `ago` is "3 h ago"; `expires` is "7 Jan".
 */
export function sourceSentence(
  s: Pick<SourceStatus, "provider" | "state" | "note">,
  words: { ago?: string; expires?: string } = {},
): string | null {
  if (s.note) return s.note;
  const hub = s.provider === "hubstaff";
  switch (s.state) {
    case "missing_key":
      return hub
        ? "Hubstaff isn't connected, so hours show as no data. In Hubstaff, open Settings, Organization, API tokens, make a token for your own account, and paste it here."
        : "Timetastic isn't connected, so the cockpit doesn't know about leave or public holidays. As a Timetastic admin, copy the token from app.timetastic.co.uk/api and paste it here.";
    case "unchecked":
      return `The key is saved, but ${hub ? "Hubstaff" : "Timetastic"} couldn't be reached to check it. The next hourly read tries again.`;
    case "refused":
      return hub
        ? "Hubstaff refused the saved key. It may have expired or been revoked. Paste a new one here."
        : "Timetastic refused the saved key. An admin can renew it at app.timetastic.co.uk/api. Paste the new one here.";
    case "plan_blocked":
      return "Hubstaff says this plan doesn't include API access. Check the plan in Hubstaff under Settings, Billing.";
    case "needs_new_key":
      return "Hubstaff's personal key was used up and can't be renewed. Make a new personal token in Hubstaff and paste it here.";
    case "firewall_blocked":
      return "Hubstaff's firewall blocked the cockpit's last request (error 1010), so nothing new was read. This isn't a problem with the key. The next hourly read tries again, or press Sync now.";
    case "expiring":
      return `The ${hub ? "Hubstaff" : "Timetastic"} key expires about ${words.expires ?? "soon"}. Make a new one in ${hub ? "Hubstaff" : "Timetastic"} and paste it here before then.`;
    case "stale":
      return `${hub ? "Hubstaff" : "Timetastic"} was last read ${words.ago ?? "a while ago"}. Press Sync now. If it fails, this card says why.`;
    case "never_run":
      return "Nothing has been read yet. The hourly read runs at 17 minutes past the hour, or press Sync now.";
    case "failing":
      return `The last ${hub ? "Hubstaff" : "Timetastic"} read failed. Press Sync now; if it fails again, this card says why.`;
    default:
      return null;
  }
}

export const ZONE_NOTE =
  "Hubstaff's time zone isn't Kuwait. The cockpit sorts time into Kuwait days itself, so pay is right. Hubstaff's own reports will show different days.";

export const CRON_MISSING =
  "The hourly read isn't scheduled yet. It is switched on when this build is deployed.";

/** States where the key field shows without pressing Replace key. */
export const NEEDS_KEY = new Set<SourceState>([
  "missing_key",
  "refused",
  "plan_blocked",
  "needs_new_key",
  "expiring",
]);

/** The status chip of a person's month (design 5.1). */
export function statusChip(p: PersonMonth): {
  tone: StatusTone;
  label: string;
} {
  const first = p.status.reasons.find(r => r.severity !== "note");
  const decide = p.status.reasons.filter(r => r.severity === "decide");
  const kind: StatusKind = p.status.kind;
  if (kind === "paid") return { tone: "good", label: "Paid" };
  if (kind === "approved")
    return p.changedSinceApproval
      ? { tone: "warning", label: "Changed since approved" }
      : { tone: "good", label: "Approved" };
  if (kind === "in_progress")
    return {
      tone: "neutral",
      label: p.shadow ? "Shadow · In progress" : "In progress",
    };
  if (kind === "not_ready") {
    if (first?.code === "hubstaff_not_linked")
      return { tone: "serious", label: "Not linked" };
    return {
      tone: "serious",
      label: first ? `Not ready: ${chipReason(first)}` : "Not ready",
    };
  }
  if (kind === "needs_review")
    return {
      tone: "warning",
      label:
        decide.length === 1
          ? "Needs 1 decision"
          : `Needs ${decide.length || "a"} decision${decide.length === 1 ? "" : "s"}`,
    };
  return {
    tone: p.shadow ? "neutral" : "good",
    label: p.shadow ? "Shadow · Ready" : "Ready to approve",
  };
}

/** Each blocking reason in a few words, for the chip; the sheet has the sentence. */
const CHIP_REASON: Partial<Record<ReasonCode, string>> = {
  no_role: "no role",
  no_pay: "no pay set",
  no_schedule: "no hours set",
  last_day_missing: "last day missing",
  currency_changed: "currency changed",
  correction_currency: "correction currency",
  leave_type_without_rule: "leave needs a rule",
  timetastic_not_read: "leave not read",
  leave_unverified: "leave unverified",
  hubstaff_not_connected: "Hubstaff not connected",
  hours_unverified: "days unverified",
  final_read_pending: "final read pending",
};

export function chipReason(r: Reason): string {
  if (r.code === "no_data_days") {
    const n = r.days?.length ?? 0;
    return n === 1 ? "1 day no data" : n ? `${n} days no data` : "no data";
  }
  return CHIP_REASON[r.code] ?? shortReason(r.text);
}

/** A reason short enough for a chip: the first clause, lower-cased start. */
export function shortReason(text: string): string {
  const clause = text.split(/[.:;]/)[0]?.trim() ?? text;
  const short =
    clause.length > 34 ? `${clause.slice(0, 33).trimEnd()}…` : clause;
  return short.charAt(0).toLowerCase() + short.slice(1);
}

/** Sort: not ready, then needs review, then ready, then approved and paid; by name within. */
export const STATUS_ORDER: Record<StatusKind, number> = {
  not_ready: 0,
  needs_review: 1,
  in_progress: 2,
  ready: 3,
  approved: 4,
  paid: 5,
};

export function sortPeople(people: PersonMonth[]): PersonMonth[] {
  return [...people].sort(
    (a, b) =>
      STATUS_ORDER[a.status.kind] - STATUS_ORDER[b.status.kind] ||
      a.name.localeCompare(b.name),
  );
}

export const TRACKING_LABEL = {
  required: "Required",
  optional: "Optional",
  exempt: "Exempt",
} as const;

export const BASIS_LABEL = {
  hours: "Follows hours",
  fixed: "Fixed",
} as const;

/** The one tick that switches a person's pay to hours (design 4.1). */
export const TERMS_TICK =
  "Their signed contract says pay follows tracked hours, and they agreed to Hubstaff tracking";
export const KW_TICK = "A Kuwaiti lawyer has reviewed the clause";
export const EGYPT_NOTE =
  "Egypt's labour law (14/2025) gives remote workers the same rights and limits deductions. Keep the contract in step.";

/** Pre-filled reasons, so every decision is one click. */
export const DECISION_REASON = {
  absent: "No time tracked and no leave booked",
  excused: "Worked without the timer",
  hours: "Hours from the person's own record",
  manualCount: "Manual time checked",
  manualSkip: "Manual time not supported",
  notBooked: "Leave was not taken",
  keepEntered: "Keeping the hours entered",
  useHubstaff: "Using Hubstaff's time",
  noLeave: "No leave this month",
} as const;

/** "Tuesday 6 October" style sentence for a day, from the model's label or the date. */
export function daySentence(day: string, label?: string): string {
  return label || dayLabel(day);
}

/** What the browser sends: the figure it showed, so the server can refuse a different one. */
/**
 * Days whose pay follows hours, with nothing tracked and nothing decided yet.
 * Until the CEO decides them the rule counts them as absent (the cautious
 * figure), so the target and pay shown are not final: the screens say so
 * beside the figure instead of showing a bare low number.
 */
export function undecidedDays(p: PersonMonth): {
  days: number;
  seconds: number;
} {
  if (!p.paysOnHours || p.approval) return { days: 0, seconds: 0 };
  let days = 0;
  let seconds = 0;
  for (const d of p.days)
    if (d.kind === "absent") {
      days += 1;
      seconds += Math.max(0, d.expected - (d.counted ?? 0) - d.unpaid);
    }
  return { days, seconds };
}

export function approveItems(
  people: PersonMonth[],
  ruleVersion: string,
): ApproveItem[] {
  return people.map(p => ({
    personId: p.personId,
    inputsHash: p.inputsHash,
    amount: p.pay.total ?? 0,
    payableS: p.hours.payable ?? 0,
    ruleVersion,
  }));
}
