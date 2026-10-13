import { useSyncExternalStore } from "react";

/**
 * How the cockpit's reads behave when the database blinks.
 *
 * On 13 October 2026 the Creative Triage database restarted for about a
 * minute. The Ads page's 30-second refresh got a 503, the read threw into
 * the page, and the whole screen said "[object Object]" until a reload.
 * Now a read that already has numbers keeps them and the shell says so in
 * one line; a first read that fails for a passing reason tries again a few
 * times before the screen shows an error.
 */

/** Waits before the 1st, 2nd and 3rd retry of a read that failed for a passing reason. */
export const RETRY_MS = [2_000, 5_000, 10_000];

const NO_ANSWER = "The server did not answer. Try again in a moment.";

/** A Cloudflare or gateway error page arrives as HTML in `message`. */
const looksLikePage = (message: string) => /^\s*</.test(message);

/**
 * An Error with a sentence a person can read. Supabase returns its errors as
 * plain objects ({ message, code, details, hint }), not Errors, and
 * `String(object)` is "[object Object]".
 */
export function toError(err: unknown): Error {
  if (err instanceof Error)
    return looksLikePage(err.message) ? new Error(NO_ANSWER) : err;
  if (err && typeof err === "object") {
    const fields = err as Record<string, unknown>;
    const message =
      typeof fields.message === "string" ? fields.message.trim() : "";
    const error = new Error(
      message && !looksLikePage(message) ? message : NO_ANSWER,
    );
    for (const key of ["code", "details", "hint", "status"])
      if (fields[key] !== undefined && fields[key] !== "")
        Object.assign(error, { [key]: fields[key] });
    return error;
  }
  const text = err === undefined || err === null ? "" : String(err).trim();
  return new Error(text && !looksLikePage(text) ? text : NO_ANSWER);
}

/**
 * True when trying again can fix it: no answer, a restarting or busy
 * database, a timeout, or a token that the client refreshes by itself.
 * A refusal (permission, bad input, a raised exception) is not.
 */
export function isTransient(err: unknown): boolean {
  const fields = (err && typeof err === "object" ? err : {}) as Record<
    string,
    unknown
  >;
  const code = typeof fields.code === "string" ? fields.code : "";
  if (code) return /^(PGRST00\d|PGRST30[13]|08|53|57|40001|40P01)/.test(code);
  const message = String(fields.message ?? err ?? "").trim();
  return (
    message === "" ||
    looksLikePage(message) ||
    /failed to fetch|fetcherror|networkerror|load failed|network request failed|failed to send a request|relay error|timed? ?out|\b(50[234]|52\d)\b/i.test(
      message,
    )
  );
}

/** Milliseconds before the next try, or null when the read should stop retrying. */
export function retryDelay(
  err: unknown,
  failuresInARow: number,
): number | null {
  if (!isTransient(err) || failuresInARow < 1) return null;
  return RETRY_MS[failuresInARow - 1] ?? null;
}

// Reads that are showing their last good numbers because the newest try failed.
const stale = new Set<object>();
const listeners = new Set<() => void>();

export function markStale(read: object, isStale: boolean) {
  if (stale.has(read) === isStale) return;
  if (isStale) stale.add(read);
  else stale.delete(read);
  for (const listener of listeners) listener();
}

export function staleReads(): number {
  return stale.size;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any read on screen is showing old numbers. */
export function useReadsStale(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => stale.size > 0,
    () => false,
  );
}
