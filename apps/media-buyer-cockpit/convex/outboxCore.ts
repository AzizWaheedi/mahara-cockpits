/**
 * The rules of the outbox (convex/outbox.ts), kept apart so they can be tested.
 *
 * Found 2026-10-06: the 50 oldest rows had each failed five times and were
 * never closed, so `pending` (the 50 oldest open rows, minus the exhausted
 * ones) came back empty on every run from 12 September. Nothing queued after
 * that was ever retried: 1,927 writes sat there while the drain reported ok.
 */

/** Tries before a write is set aside with its error, out of the queue's way. */
export const MAX_TRIES = 5;
/** A write nobody could deliver for two days is stale; replaying it would mislead. */
export const STALE_MS = 48 * 3600_000;
/** A write still waiting after this long means ClickUp is not taking them. */
export const LATE_MS = 15 * 60_000;

type Row = { tries: number; at: number; doneAt?: number };

/** Which open rows a drain should try now: never one that is exhausted. */
export function deliverable<T extends Row>(rows: T[], limit = 50): T[] {
  return rows
    .filter(r => r.doneAt === undefined && r.tries < MAX_TRIES)
    .slice(0, limit);
}

/** What settling an attempt does to a row. */
export function settled(
  row: { tries: number },
  ok: boolean,
  now: number,
  error?: string,
): { doneAt?: number; tries: number; lastError?: string; gaveUpAt?: number } {
  const tries = row.tries + 1;
  if (ok) return { doneAt: now, tries, lastError: error?.slice(0, 300) };
  if (tries >= MAX_TRIES)
    return {
      doneAt: now,
      gaveUpAt: now,
      tries,
      lastError:
        `gave up after ${tries} tries: ${error ?? "no error text"}`.slice(
          0,
          300,
        ),
    };
  return { tries, lastError: error?.slice(0, 300) };
}

/**
 * ClickUp said no in a way a retry cannot change: a deleted task, a field
 * that does not take that value, a method it does not allow. Queuing these
 * only hides them. A rate limit, a timeout, a 5xx, or a missing or revoked
 * token (fixed by setting a new one) is worth a retry.
 */
export function isRefusal(error: string): boolean {
  const m = /HTTP (\d{3})/.exec(error);
  if (!m) return false;
  const status = Number(m[1]);
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

/** The health line for the queue: ok, or what is stuck and why. */
export function backlogNote(
  open: { at: number; lastError?: string }[],
  now: number,
): { ok: boolean; error?: string } {
  // Older than two days is closed unsent on the next pass, not waiting.
  const late = open.filter(r => now - r.at > LATE_MS && now - r.at <= STALE_MS);
  if (late.length === 0) return { ok: true };
  const oldest = Math.min(...late.map(r => r.at));
  const minutes = Math.round((now - oldest) / 60_000);
  const why = late.find(r => r.lastError)?.lastError;
  return {
    ok: false,
    error: `${late.length} media buyer change${late.length === 1 ? " is" : "s are"} waiting to reach ClickUp, the oldest for ${minutes} min${why ? `. Last error: ${why}` : ""}`,
  };
}
