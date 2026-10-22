import type { CalendarRow } from "./types";
export interface DayReview {
  calls: CalendarRow[];
  pending: number;
  version: string;
  linked: boolean;
}
export function reviewed(row: CalendarRow): boolean {
  return ["showed", "completed", "noshow", "cancelled", "invalid"].includes(
    String(row.marked_status ?? row.status),
  );
}
export interface EodDraft {
  values: Record<string, string>;
  manual: Record<string, boolean>;
}
/** Recount after a mark without replacing anything the rep corrected. */
export function refreshDraft(
  draft: EodDraft,
  computed: Record<string, number | null>,
  keys: string[],
): EodDraft {
  const values = { ...draft.values };
  for (const key of keys)
    if (!draft.manual[key])
      values[key] = computed[key] == null ? "" : String(computed[key]);
  return { ...draft, values };
}
