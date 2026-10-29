/**
 * One more try after ClickUp's 429, for the interactive ClickUp helpers
 * (docs/requests/CLICKUP-DOWNGRADE.md section 2).
 *
 * ClickUp Business allows 100 calls a minute for the one token the Supabase
 * functions and the VPS workers share. ClickUp answers 429 before it does
 * anything, so one more try is safe for a read and for a write. A helper that
 * opts in (`retry429`) records the 429 response as it always did, waits as long
 * as ClickUp asks (at least 1 s, at most 5 s), records a new intent and sends
 * the same request again. A second 429 throws the helper's own sentence
 * followed by CLICKUP_BUSY, so every pattern that reads
 * "rejected the request (429)" still matches. CLICKUP_BUSY speaks only for the
 * call it covers: a press can make several calls in a row (a field, a ticket,
 * a comment), so it never says the action changed nothing, nor that a second
 * press will work (the press's own receipt rules decide that). When an earlier
 * write by the same helper already went through, CLICKUP_BUSY_LANDED follows
 * and says to check it first. Any other status, a timeout or an unreadable
 * answer behaves as it did before. Background writers keep their own retries
 * and never opt in.
 *
 * Import-free, so every bundle that carries a ClickUp helper carries it as is.
 */

/** After a second 429 on one call. It covers that call only, never the whole action. */
export const CLICKUP_BUSY =
  "ClickUp is at its limit of calls this minute and refused this step.";
/** Added when an earlier write through the same helper went through, so part of the action is already in place. */
export const CLICKUP_BUSY_LANDED =
  "An earlier step of this action already went through, so check what it changed before you try again.";
/** The shortest and the longest wait before the second try. */
export const CLICKUP_RETRY_MIN_MS = 1_000;
export const CLICKUP_RETRY_MAX_MS = 5_000;

export type RetryOptions = {
  /** Try once more after ClickUp's 429. Only callers a person is waiting on pass it. */
  retry429?: boolean;
  /** The wait before the second try (the tests pass a fake clock). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export const realSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const clamp = (ms: number) =>
  Math.min(CLICKUP_RETRY_MAX_MS, Math.max(CLICKUP_RETRY_MIN_MS, Math.ceil(ms)));

const header = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * How long to wait before the second try: Retry-After in seconds when it is
 * positive; else X-RateLimit-Reset (epoch seconds when above 1e9, as ClickUp
 * sends it, otherwise seconds from now); else 1 s. Always 1 s to 5 s.
 */
export function clickupRetryWait(headers: Headers, now: number): number {
  const after = header(headers, "retry-after");
  if (after !== null && after > 0) return clamp(after * 1000);
  const reset = header(headers, "x-ratelimit-reset");
  if (reset !== null && reset > 0)
    return clamp(reset > 1e9 ? reset * 1000 - now : reset * 1000);
  return CLICKUP_RETRY_MIN_MS;
}

/**
 * The helper's own refusal sentence, then CLICKUP_BUSY, then CLICKUP_BUSY_LANDED
 * when `landed`: an earlier non-GET call through the same helper (one press)
 * got a success answer.
 */
export function clickupBusy(sentence: string, landed = false): string {
  const s = sentence.trimEnd();
  return `${s}${/[.!?]$/.test(s) ? "" : "."} ${CLICKUP_BUSY}${landed ? ` ${CLICKUP_BUSY_LANDED}` : ""}`;
}
