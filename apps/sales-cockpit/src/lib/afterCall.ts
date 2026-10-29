import type { CalendarRow } from "./types";

/**
 * After the call (Aziz, 2026-10-29): the lead's quality from 1 to 10 on every
 * intro or demo held, and on a held intro that booked no demo, a specific
 * reason. The reasons are sales-api's NO_DEMO_REASONS and the migration's
 * check, in the same order: the setter gate's boxes first, then "not now".
 */

export type NoDemoReason =
  | "signed"
  | "no_budget"
  | "too_small"
  | "not_decision_maker"
  | "not_a_fit"
  | "no_need"
  | "not_ready"
  | "has_agency"
  | "price_only"
  | "thinking"
  | "other";

export const REASON_GROUPS: {
  label: string;
  reasons: { key: NoDemoReason; label: string }[];
}[] = [
  {
    label: "Not qualified",
    reasons: [
      { key: "no_budget", label: "No budget" },
      { key: "too_small", label: "Business too small" },
      { key: "not_decision_maker", label: "Not the decision maker" },
      { key: "not_a_fit", label: "Not a fit for what we do" },
    ],
  },
  {
    label: "Not now",
    reasons: [
      { key: "no_need", label: "No real need" },
      { key: "not_ready", label: "Not ready yet" },
      { key: "has_agency", label: "Has an agency already" },
      { key: "price_only", label: "Only wanted the price" },
      { key: "thinking", label: "Wants to think it over" },
    ],
  },
];

const LABELS: Record<string, string> = {
  signed: "Signed on this call",
  other: "Other",
  ...Object.fromEntries(
    REASON_GROUPS.flatMap(g => g.reasons.map(r => [r.key, r.label])),
  ),
};

/** A reason's words; the funnel's own keys too ("none", "disqualified"). */
export function reasonLabel(key: string | null | undefined): string {
  if (!key) return "";
  if (key === "none") return "No reason yet";
  if (key === "disqualified") return "Disqualified";
  return LABELS[key] ?? key;
}

const HELD = ["showed", "completed", "invalid"];

/** The call's outcome as the rep sees it: their mark, else HighLevel's. */
function statusOf(row: CalendarRow): string {
  return String(row.marked_status ?? row.status ?? "");
}

/** An intro or demo marked held (showed, completed or disqualified). */
export function heldCall(row: CalendarRow): boolean {
  return (
    (row.call_type === "intro" || row.call_type === "demo") &&
    HELD.includes(statusOf(row))
  );
}

/** A held intro, not disqualified, with no demo after it and not signed: it is asked why. */
export function asksWhy(row: CalendarRow): boolean {
  return (
    heldCall(row) &&
    row.call_type === "intro" &&
    statusOf(row) !== "invalid" &&
    !row.demo_after_at &&
    row.signed_after !== true
  );
}

/**
 * What a held call still needs. sales-api's dayReview.ts outcomeMissing and
 * cockpit_sales_outcome_missing (20261029a) are the same rule: the end of
 * day waits on it.
 */
export function outcomeMissing(row: CalendarRow): boolean {
  if (!heldCall(row)) return false;
  if (row.lead_quality == null) return true;
  return asksWhy(row) && !row.no_demo_reason;
}

/** The scale's colour: low is a warning, the middle is a watch, high is good. */
export function qualityTone(n: number): "bad" | "watch" | "good" {
  return n <= 3 ? "bad" : n <= 6 ? "watch" : "good";
}

/**
 * A call just marked held in the dialer, as a calendar row for AfterCall:
 * the list's copy has not read the mark yet, and the server reads the call
 * itself when the answer is saved.
 */
export function heldRow(a: {
  id: string;
  type: "intro" | "demo";
  start_at: string | null;
  booked_at: string | null;
  assigned_user_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
}): CalendarRow {
  return {
    appointment_id: a.id,
    contact_id: a.contact_id,
    contact_name: a.contact_name,
    calendar_id: null,
    call_type: a.type,
    start_at: a.start_at,
    booked_at: a.booked_at,
    crm_status: null,
    assigned_user_id: a.assigned_user_id,
    assigned_user_name: null,
    ad_id: null,
    origin: "ghl",
    mirrored_at: "",
    mark_id: null,
    marked_status: "showed",
    mark_reason: null,
    mark_note: null,
    marked_by: null,
    marked_at: null,
    mark_crm: null,
    mark_crm_error: null,
    status: "showed",
    needs_mark: false,
  };
}
