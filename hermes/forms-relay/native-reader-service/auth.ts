/** Isolated experiment only. This file is not an Edge Function or a release. */

const ISSUER = "https://token.actions.githubusercontent.com";
const MAX_JWT = 16_384;
const SKEW_SECONDS = 30;
const MAX_AGE_SECONDS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK = /^[A-Za-z0-9_-]{1,40}$/;
const HEX256 = /^[0-9a-f]{64}$/;
const CAP = /^[A-Za-z0-9_-]{43}$/;

export class Denied extends Error {
  constructor() { super("Request denied"); }
}

function decode(segment: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Denied();
  try {
    const encoded = segment.replaceAll("-", "+").replaceAll("_", "/");
    const raw = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    if (base64url(bytes) !== segment) throw new Denied();
    return bytes;
  } catch { throw new Denied(); }
}

export function base64url(data: Uint8Array): string {
  let binary = "";
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function json(segment: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(segment)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Denied();
    return value as Record<string, unknown>;
  } catch { throw new Denied(); }
}

export type Policy = {
  audience: string;
  repositoryId: string;
  ownerId: string;
  workflowRef: string;
  workflowSha: string;
  ref: string;
  subject: string;
  environment: string;
};
export type Identity = { runId: string; attempt: string };
type Key = JsonWebKey & { kid?: string; alg?: string; use?: string };

/** `getKeys` must be hardwired to GitHub's HTTPS JWKS in a real adapter, never caller supplied. */
export async function verifyGithub(token: string, policy: Policy, getKeys: () => Promise<Key[]>, now: number): Promise<Identity> {
  if (typeof token !== "string" || !token || token.length > MAX_JWT || !Number.isSafeInteger(now) || !policy
      || ![policy.audience, policy.workflowRef, policy.ref, policy.subject, policy.environment].every(v => typeof v === "string" && v.length > 0 && v.length <= 512)
      || typeof policy.repositoryId !== "string" || !/^[1-9][0-9]{0,19}$/.test(policy.repositoryId)
      || typeof policy.ownerId !== "string" || !/^[1-9][0-9]{0,19}$/.test(policy.ownerId)
      || typeof policy.workflowSha !== "string" || !/^[0-9a-f]{40}$/.test(policy.workflowSha)) throw new Denied();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Denied();
  const header = json(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)
      || (header.typ !== undefined && header.typ !== "JWT") || header.jku !== undefined || header.x5u !== undefined
      || header.crit !== undefined) throw new Denied();
  let keys: Key[];
  try {
    const fetched = await getKeys();
    if (!Array.isArray(fetched) || fetched.length > 100) throw new Denied();
    keys = fetched.filter(k => k && k.kid === header.kid && k.kty === "RSA" && k.alg === "RS256" && k.use === "sig"
      && typeof k.n === "string" && typeof k.e === "string");
  } catch { throw new Denied(); }
  if (keys.length !== 1 || decode(keys[0].n!).length < 256) throw new Denied();
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", keys[0], { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { throw new Denied(); }
  if (!ok) throw new Denied();
  const c = json(parts[1]);
  const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
  if (!integer(c.iat) || !integer(c.exp) || !integer(c.nbf) || c.iat > now + SKEW_SECONDS || c.nbf > now + SKEW_SECONDS
      || c.exp <= now - SKEW_SECONDS || c.exp <= c.iat || c.exp - c.iat > MAX_AGE_SECONDS
      || now - c.iat > MAX_AGE_SECONDS || c.iss !== ISSUER || c.aud !== policy.audience || c.sub !== policy.subject
      || c.repository_id !== policy.repositoryId || c.repository_owner_id !== policy.ownerId || c.workflow_ref !== policy.workflowRef || c.workflow_sha !== policy.workflowSha
      || c.ref !== policy.ref || c.event_name !== "repository_dispatch" || c.environment !== policy.environment
      || typeof c.run_id !== "string" || !/^[1-9][0-9]{0,19}$/.test(c.run_id)
      || typeof c.run_attempt !== "string" || !/^[1-9][0-9]{0,9}$/.test(c.run_attempt)) throw new Denied();
  return { runId: c.run_id, attempt: c.run_attempt };
}

export type Request = { taskId: string; responseId: string; schemaVersion: number; commentId: string; commentSha256: string; capability: string };
export function parseRequest(value: unknown): Request {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Denied();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).sort().join(",") !== "capability,commentId,commentSha256,responseId,schemaVersion,taskId"
      || typeof obj.taskId !== "string" || !TASK.test(obj.taskId)
      || typeof obj.responseId !== "string" || !UUID.test(obj.responseId)
      || (obj.schemaVersion !== 2 && obj.schemaVersion !== 3)
      || typeof obj.commentId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(obj.commentId)
      || typeof obj.commentSha256 !== "string" || !HEX256.test(obj.commentSha256)
      || typeof obj.capability !== "string" || !CAP.test(obj.capability)) throw new Denied();
  return obj as Request;
}

export async function capabilityHash(value: string): Promise<string> {
  if (!CAP.test(value) || decode(value).length !== 32) throw new Denied();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", decode(value)));
  return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Production MUST implement this as one database transaction under row locks. The transaction must check the
 * OFF switch, a short expiry, response/card/version/receipt bindings, native + submitted + live mode, the latest
 * eligible submission, and atomically bind the first run identity. Bounded retry may use only that same run.
 * It must return only approved fields from the version-aware printer and nothing on a failure. This experiment
 * deliberately supplies no database adapter or endpoint.
 */
export interface AtomicReader<T> {
  consumeAndRead(input: { request: Omit<Request, "capability">; capabilityHash: string; identity: Identity; now: number }): Promise<T | null>;
}

export async function authorizeAndRead<T>(raw: unknown, identity: Identity, reader: AtomicReader<T>, now: number): Promise<T> {
  const req = parseRequest(raw);
  const hash = await capabilityHash(req.capability);
  const { capability: _, ...bound } = req;
  const value = await reader.consumeAndRead({ request: bound, capabilityHash: hash, identity, now });
  if (value === null) throw new Denied();
  return value;
}
