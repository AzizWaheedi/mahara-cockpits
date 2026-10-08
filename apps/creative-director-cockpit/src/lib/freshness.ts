/** Minutes after which data counts as stale during Kuwait working hours. */
export const STALE_MINUTES = 50;

type SourceBlock =
  | { tables?: Record<string, { snapshotAt?: string | null } | null> }
  | null
  | undefined;

/**
 * Newest publish time across a source projection's tables, in ms, or null.
 * The native worker republishes the live tables every cycle and writes no
 * syncRuns row; imported history keeps its 7 Oct snapshot. So the newest
 * table, not the oldest, says when data last landed (8 Oct 2026).
 */
export function newestPublish(source: SourceBlock): number | null {
  let best: number | null = null;
  for (const table of Object.values(source?.tables ?? {})) {
    const ms = table?.snapshotAt ? Date.parse(table.snapshotAt) : Number.NaN;
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
}

/** Nothing has landed, or nothing for 50 minutes during Kuwait working hours. */
export function isStale(at: number | null, now = Date.now()): boolean {
  if (!at) return true;
  const hour = Number(
    new Date(now).toLocaleString("en-GB", {
      timeZone: "Asia/Kuwait",
      hour: "2-digit",
      hour12: false,
    }),
  );
  return hour >= 7 && hour < 21 && (now - at) / 60000 > STALE_MINUTES;
}
