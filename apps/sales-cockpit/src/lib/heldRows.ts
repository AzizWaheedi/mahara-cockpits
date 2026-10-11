/**
 * A call row with a panel open under it (a picker, Tell them, or book it
 * again) stays where it was until the panel closes (2026-10-11 review).
 * Without this, a call marked missed left the owed list, a call moved past
 * Today's 36 hours left Coming up, and a call moved to another day changed
 * the Calendar's day card, and each time the panel went with the row: the
 * book-again picker vanished after Didn't happen, and the done state with
 * Tell them vanished after a move.
 */

interface RowLike {
  appointment_id: string;
  start_at: string | null;
}

function at(r: RowLike): number {
  const t = r.start_at ? Date.parse(r.start_at) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Today: the list with the open panel's row still in it, as it was when the
 * panel opened, when the panel belongs to this list and a read dropped it.
 * Owed reads newest first; Coming up soonest first.
 */
export function keepOpenRow<T extends RowLike, F extends string>(
  rows: T[],
  open: { id: string; from: F; row: T } | null,
  from: F,
  newestFirst: boolean,
): T[] {
  if (!open || open.from !== from) return rows;
  if (rows.some(r => r.appointment_id === open.id)) return rows;
  return [...rows, open.row].sort((a, b) =>
    newestFirst ? at(b) - at(a) : at(a) - at(b),
  );
}

/** The Calendar: every held row a read dropped, added back at the end. */
export function withHeld<T extends RowLike>(
  rows: T[],
  held: Record<string, { row: T }>,
): T[] {
  const ids = new Set(rows.map(r => r.appointment_id));
  const gone = Object.values(held)
    .map(h => h.row)
    .filter(r => !ids.has(r.appointment_id));
  return gone.length ? [...rows, ...gone] : rows;
}

/** Day keys (YYYY-MM-DD) in order, "" (no time set) last either way. */
export function orderDays(keys: string[], newestFirst: boolean): string[] {
  return [...keys].sort((a, b) =>
    !a ? 1 : !b ? -1 : newestFirst ? b.localeCompare(a) : a.localeCompare(b),
  );
}
