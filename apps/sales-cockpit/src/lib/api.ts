import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import {
  type ApiBody,
  ApiError,
  answerFailure,
  readFailure,
  SIGNED_OUT,
  sendFailure,
  UNREACHED,
} from "./apiErrors";
import { SUPABASE_URL, supabase } from "./supabase";

export { ApiError, type ApiFailure, uncertain } from "./apiErrors";

/**
 * How long any call waits for the server, as in the call centre's dialer.
 * After that the screen says it may still go through, and no button stays
 * on "Saving…".
 */
export const API_TIMEOUT_MS = 45_000;
let waitMs = API_TIMEOUT_MS;

/** The dev harness shortens the wait, to try the slow path in seconds. */
export function setApiTimeout(ms: number): void {
  waitMs = Number.isFinite(ms) && ms > 0 ? ms : API_TIMEOUT_MS;
}

/**
 * Every change goes through the sales-api function, never straight into a
 * table: it checks the seat, writes the audit row, and is the only thing
 * that talks to HighLevel. The session the cockpit already holds is the
 * proof of who is asking.
 *
 * Throws an ApiError whose message is a sentence a person can act on (the
 * server writes most of them) and whose kind says whether what was asked
 * may have happened anyway (`uncertain`).
 */
export async function api<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
  /**
   * A shorter wait for a read that is safe to ask again (live.status,
   * room.status): a hung read then fails in seconds and the screen says it
   * is old, instead of showing a stale truth for most of a minute.
   */
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const wait =
    opts.timeoutMs && opts.timeoutMs > 0
      ? Math.min(opts.timeoutMs, waitMs)
      : waitMs;
  const stop = new AbortController();
  const timer = window.setTimeout(() => stop.abort(), wait);
  const gaveUp = new Promise<never>((_, reject) =>
    stop.signal.addEventListener("abort", () =>
      reject(sendFailure(true, wait)),
    ),
  );
  // A rejection nobody is waiting on yet must not be reported as unhandled.
  gaveUp.catch(() => undefined);
  try {
    // The session is read inside the wait too: a token refresh that hangs
    // must not hold a button on busy.
    const { data, error } = await Promise.race([
      supabase.auth.getSession(),
      gaveUp,
    ]);
    const token = data.session?.access_token;
    // A laptop that woke with its token expired and the network still down
    // gets no session and a retryable error, while the session stays
    // stored: that is the connection, not a sign-in that ran out.
    if (!token && error && isAuthRetryableFetchError(error))
      throw new ApiError(UNREACHED, "network");
    if (!token) throw new ApiError(SIGNED_OUT, "signin");
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/sales-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          // The function runs beside the database (eu-west-1): a save
          // answers in about half a second instead of two or three.
          "x-region": "eu-west-1",
        },
        body: JSON.stringify({ ...body, action }),
        signal: stop.signal,
      });
    } catch {
      throw sendFailure(stop.signal.aborted, wait);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw readFailure(stop.signal.aborted, res.status, wait);
    }
    let out: (ApiBody & T) | null = null;
    try {
      out = JSON.parse(text) as ApiBody & T;
    } catch {
      out = null;
    }
    const failed = answerFailure(res.status, out);
    if (failed) throw failed;
    return out as T;
  } finally {
    window.clearTimeout(timer);
  }
}
