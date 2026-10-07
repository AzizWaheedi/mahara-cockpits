// Signatures for the two signed doors of sales-live: Zoom's webhook and
// Slack's interactivity. Pure Web Crypto, so the same code runs in Supabase's
// Deno runtime and under `bun test`.
//
// Zoom (developers.zoom.us/docs/api/webhooks): x-zm-signature is
// "v0=" + hex(HMAC-SHA256(secret, "v0:{x-zm-request-timestamp}:{raw body}")).
// No timestamp window: Zoom retries a failed delivery 5, 20 and 60 minutes
// later with the original timestamp, so a window would refuse the retries.
// The url_validation request is signed too, and is answered only after the
// signature matches, so the door is never an HMAC oracle for a forged body.
//
// Slack (docs.slack.dev/authentication/verifying-requests-from-slack):
// X-Slack-Signature is "v0=" + hex(HMAC-SHA256(secret,
// "v0:{X-Slack-Request-Timestamp}:{raw body}")), and a timestamp more than
// 300 s from now is refused (replay protection).

const encoder = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function hmacHex(
  secret: string,
  message: string | Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = typeof message === "string" ? encoder.encode(message) : message;
  return toHex(await crypto.subtle.sign("HMAC", key, data as BufferSource));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/**
 * Compares two strings in time that depends only on their length, so a wrong
 * signature cannot be found a byte at a time. Different lengths are simply
 * unequal; every signature this door checks has a fixed length.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  // A length mismatch still walks the first input, so it costs about the same.
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
  return diff === 0;
}

const SIG = /^v0=[0-9a-f]{64}$/;
const TS = /^\d{1,20}$/;

/** "v0=" + hex HMAC of "v0:{ts}:{body}", the format Zoom and Slack share. */
export async function v0Signature(
  secret: string,
  timestamp: string,
  body: Uint8Array,
): Promise<string> {
  const message = concatBytes(encoder.encode(`v0:${timestamp}:`), body);
  return `v0=${await hmacHex(secret, message)}`;
}

/** True only when x-zm-signature matches the raw body. No time window. */
export async function zoomSignatureOk(
  secret: string,
  timestamp: string | null,
  body: Uint8Array,
  header: string | null,
): Promise<boolean> {
  if (!secret || !timestamp || !header) return false;
  const ts = timestamp.trim();
  const given = header.trim().toLowerCase();
  if (!TS.test(ts) || !SIG.test(given)) return false;
  return timingSafeEqual(await v0Signature(secret, ts, body), given);
}

/** The answer Zoom expects to endpoint.url_validation. */
export async function zoomValidationAnswer(
  secret: string,
  plainToken: string,
): Promise<{ plainToken: string; encryptedToken: string }> {
  return { plainToken, encryptedToken: await hmacHex(secret, plainToken) };
}

/** A plainToken shaped like Zoom's (base64url, short). Anything else is refused. */
export function plainTokenOk(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_=+/-]{1,128}$/.test(token);
}

export const SLACK_WINDOW_S = 300;

export type SlackVerdict = "ok" | "stale" | "bad";

/** Slack's v0 signature, with the 300 s replay window. */
export async function slackSignatureOk(
  secret: string,
  timestamp: string | null,
  body: Uint8Array,
  header: string | null,
  nowSeconds: number,
): Promise<SlackVerdict> {
  if (!secret || !timestamp || !header) return "bad";
  const ts = timestamp.trim();
  const given = header.trim().toLowerCase();
  if (!TS.test(ts) || !SIG.test(given)) return "bad";
  if (Math.abs(nowSeconds - Number(ts)) > SLACK_WINDOW_S) return "stale";
  const ok = timingSafeEqual(await v0Signature(secret, ts, body), given);
  return ok ? "ok" : "bad";
}
