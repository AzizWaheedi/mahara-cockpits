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

export function callReviewed(r: ReviewCall): boolean {
  return FINAL_OUTCOMES.has(String(r.marked_status ?? r.status ?? ""));
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
