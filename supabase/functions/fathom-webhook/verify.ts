// Fathom signs every webhook delivery the Standard Webhooks way
// (docs/forms/STAGE2-CONTRACT.md 4.4): webhook-signature holds one or more
// "v1,<signature>" separated by spaces, each base64(HMAC-SHA256(key,
// `${webhook-id}.${webhook-timestamp}.${raw body}`)), and the key is the
// base64 after "whsec_" in the secret Fathom returned when the webhook was
// registered. Checked before anything in the body is trusted. Pure (the clock
// comes in as nowSec) and Web Crypto only, so it runs in Deno and in bun.

export type Verdict = { ok: true } | { ok: false; reason: "missing" | "stale" | "bad_signature" | "bad_secret" };

/** A delivery signed more than this many seconds away from now, either way, is refused. */
export const TOLERANCE_SEC = 300;
/** The shortest key a secret may hold: 16 base64 characters, as cockpit_forms_key_put requires. */
const MIN_KEY_BYTES = 12;

const enc = new TextEncoder();

/** Equal text: the length first, then every character, whatever the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The HMAC key inside a "whsec_" secret (standard or URL-safe base64), or null when it holds none. */
function keyOf(secret: string): BufferSource | null {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return null;
  const b64 = secret.slice(6).replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  let bin: string;
  try {
    bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  } catch {
    return null;
  }
  if (bin.length < MIN_KEY_BYTES) return null;
  const key = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) key[i] = bin.charCodeAt(i);
  return key;
}

async function hmacBase64(key: BufferSource, content: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(content)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The header's v1 signatures, without their "v1," prefix. */
const v1Of = (signatureHeader: string) =>
  signatureHeader
    .split(/\s+/)
    .filter(s => s.startsWith("v1,"))
    .map(s => s.slice(3));

/**
 * What can be refused without the secret: a missing header, a timestamp more
 * than 5 minutes from nowSec, or no v1 signature at all. The handler checks this
 * before it reads the secret, so such a request never costs a vault read.
 */
export function headersVerdict(id: string | null, timestamp: string | null, signatureHeader: string | null, nowSec: number): Verdict {
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing" };
  const sent = /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : Number.NaN;
  if (!Number.isFinite(sent) || Math.abs(nowSec - sent) > TOLERANCE_SEC) return { ok: false, reason: "stale" };
  if (!v1Of(signatureHeader).length) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

/**
 * Whether Fathom signed this delivery: every header present, the timestamp
 * within 5 minutes of nowSec, a usable secret, and one of the header's v1
 * signatures equal to ours. Every signature in the header is compared, each
 * in constant time once its length matches.
 */
export async function verifyFathom(
  secret: string,
  id: string | null,
  timestamp: string | null,
  rawBody: string,
  signatureHeader: string | null,
  nowSec: number,
): Promise<Verdict> {
  const headers = headersVerdict(id, timestamp, signatureHeader, nowSec);
  if (!headers.ok) return headers;
  const key = keyOf(secret);
  if (!key) return { ok: false, reason: "bad_secret" };
  const given = v1Of(signatureHeader as string);
  const expected = await hmacBase64(key, `${id}.${timestamp}.${rawBody}`);
  let match = false;
  for (const s of given) if (sameText(s, expected)) match = true;
  return match ? { ok: true } : { ok: false, reason: "bad_signature" };
}
