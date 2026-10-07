/**
 * What a failed call to the cockpit's server means, said so a person can
 * act on it, and whether what they asked for may have happened anyway. The
 * call centre's rule (mahara-power-dialer): no answer in 45 seconds, or a
 * connection that broke, may still have gone through, so the screen says
 * "check before you do it again" instead of "try again".
 */

export type ApiFailure =
  /** No session: sign in again. */
  | "signin"
  /** The request did not get an answer at all: the connection or the server was not there. */
  | "network"
  /** The cockpit gave up waiting; the server may still be working on it. */
  | "timeout"
  /** An answer began to arrive and broke off; what was asked may have happened. */
  | "cut"
  /** The server said no, in a sentence of its own. */
  | "refused"
  /** The server failed (5xx), or answered something that is not an answer. */
  | "server";

export class ApiError extends Error {
  readonly kind: ApiFailure;
  /** The HTTP status, when an answer came back. */
  readonly status: number | null;
  /**
   * The refusal's code (`stale`, `confirm_end`, `disabled` and the rest),
   * when the server sent one: screens read it before they match words.
   */
  readonly code: string | null;
  constructor(
    message: string,
    kind: ApiFailure,
    status: number | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** The body every sales-api answer has. */
export interface ApiBody {
  ok?: boolean;
  error?: string;
  /** A refusal's code (contract v2 section 3), when the server sends one. */
  code?: string;
}

/** A code is a short snake_case word; anything else is not one. */
function codeOf(v: unknown): string | null {
  return typeof v === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(v) ? v : null;
}

export const UNREACHED =
  "The cockpit could not reach its server. Check the connection and try again.";
export const CUT =
  "The connection dropped before the cockpit's answer arrived. Check whether it went through before you do it again.";

export function timeoutWords(waitMs: number): string {
  return `The cockpit did not answer within ${Math.max(1, Math.round(waitMs / 1000))} seconds. It may still go through, so check before you try again.`;
}

/** The request itself failed: the cockpit's own timeout, or no connection. */
export function sendFailure(timedOut: boolean, waitMs: number): ApiError {
  return timedOut
    ? new ApiError(timeoutWords(waitMs), "timeout")
    : new ApiError(UNREACHED, "network");
}

/** The answer began (a status came back) but its body did not arrive. */
export function readFailure(
  timedOut: boolean,
  status: number,
  waitMs: number,
): ApiError {
  return timedOut
    ? new ApiError(timeoutWords(waitMs), "timeout", status)
    : new ApiError(CUT, "cut", status);
}

/** A sign-in that ran out, said the same way whatever refused it. */
export const SIGNED_OUT = "Your sign-in ran out. Sign in again.";

/** Longest server sentence shown as it is; anything longer is cut. */
const ERROR_MAX = 300;

/**
 * The server's own sentence, when it sent one a person can read: a string
 * with words in it, cut to 300 characters. Anything else (an object, a
 * number, an empty string) is no sentence, so "[object Object]" never shows.
 */
function errorWords(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > ERROR_MAX ? `${s.slice(0, ERROR_MAX - 3).trimEnd()}...` : s;
}

/** What a whole answer says: nothing when it is a yes, else the server's sentence. */
export function answerFailure(
  status: number,
  body: ApiBody | null,
): ApiError | null {
  if (status >= 200 && status < 300 && body?.ok) return null;
  const words = errorWords(body?.error);
  // Any 401 is a sign-in that ran out: sales-api's "Sign in again." and the
  // gateway's "Invalid JWT" alike, so the screens offer a sign-in, never a
  // "Try again" that cannot work.
  if (status === 401)
    return new ApiError(
      words && /sign in/i.test(words) ? words : SIGNED_OUT,
      "signin",
      status,
      codeOf(body?.code),
    );
  return new ApiError(
    words ?? `The server answered ${status}. Try again.`,
    status >= 500 || !words ? "server" : "refused",
    status,
    codeOf(body?.code),
  );
}

/**
 * True when the thing asked for may have happened although no clear answer
 * came back: a call may be ringing, a save may have landed.
 */
export function uncertain(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    (e.kind === "network" ||
      e.kind === "timeout" ||
      e.kind === "cut" ||
      e.kind === "server")
  );
}
