// One definition of a reviewed call for EOD. A past confirmation is not attendance.
export type ReviewCall = Record<string, unknown> & {
  appointment_id: string;
  status?: string | null;
  marked_status?: string | null;
};

export const FINAL_OUTCOMES = new Set([
  "showed",
  "completed",
  "noshow",
  "cancelled",
  "invalid",
]);

/**
 * What a held intro or demo still needs after the call (2026-10-29): the
 * lead's quality, and for a held intro (not disqualified, whose mark says
 * why) with no demo after it and no signature, why no demo was booked.
 * cockpit_sales_outcome_missing (20261029a) is the same rule in SQL.
 */
export function outcomeMissing(r: ReviewCall): boolean {
  const type = String(r.call_type ?? "");
  if (type !== "intro" && type !== "demo") return false;
  const status = String(r.marked_status ?? r.status ?? "");
  if (!["showed", "completed", "invalid"].includes(status)) return false;
  if (r.lead_quality == null) return true;
  return (
    type === "intro" &&
    status !== "invalid" &&
    r.demo_after_at == null &&
    r.signed_after !== true &&
    r.no_demo_reason == null
  );
}

export function callReviewed(r: ReviewCall): boolean {
  return FINAL_OUTCOMES.has(String(r.marked_status ?? r.status ?? "")) && !outcomeMissing(r);
}

export function callAttended(r: ReviewCall): boolean {
  return ["showed", "completed", "invalid"].includes(
    String(r.marked_status ?? r.status ?? ""),
  );
}

export function reviewVersion(rows: ReviewCall[]): string {
  return rows
    .map(r =>
      [
        r.appointment_id,
        r.start_at,
        r.assigned_user_id,
        r.marked_status ?? r.status,
        r.mark_id,
        r.mark_note,
      ].join("|"),
    )
    .sort()
    .join("\n");
}

export function dayBounds(day: string): { from: string; to: string } {
  const start = Date.parse(`${day}T00:00:00+03:00`);
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 86_400_000).toISOString(),
  };
}
