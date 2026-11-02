/**
 * The billing agent's own door (docs/forms/WAVE56-CONTRACT.md 3.4, AG, E17).
 * Deployed with the JWT check off: the agent (Maher, the billing skill on the
 * VPS) holds a key of its own, `mak_` and 43 base64url characters, and the
 * database keeps only its sha256 (cockpit_agent_keys). This door hashes the
 * key, never logs it, its hash or the body, and calls one of two
 * service-only functions with the service key:
 *
 *   {"op":"chase"|"invoice"|"payment"|"note", "body":{...}, "requestId":"<uuid>"}   cockpit_billing_agent_write
 *   {"what":"accounts"|"ladder"|"balances"|"inbox"|"chases", "args":{...}, "requestId":"<uuid>"}   cockpit_billing_agent_read
 *
 * The identity is the key's row, never a field of the body. The database
 * counts the rate limit (60 calls a minute per key), answers a repeated
 * request id with its first result and writes one cockpit_agent_calls row per
 * call. Every call is receipted in cockpit_csm_provider_health as
 * `billing-agent:<op>` with its status, never its body. No op writes ClickUp,
 * LTV, a next payment date or a manual payment.
 *
 * Answers: 401 (no body detail) for a missing or malformed key; the
 * database's sentence for an unknown or revoked key (401), a refusal (422) or
 * the limit (429); 405 for anything but POST; 413 over 32 KB; 400 for a body
 * that names neither an op nor a read.
 *
 * The door is public, so an unknown key costs as little as it can: it writes
 * no receipt (no call row exists for it, and a flood must never bury real
 * agent failures in the health ledger), a key already answered "not known" is
 * refused again from memory for a minute without a database call, and above
 * UNKNOWN_PER_MINUTE unknown-key answers a minute every key this instance has
 * not seen work is answered 429 before the database. The body is read with a
 * hard 32 KB cap, whatever Content-Length says.
 */

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type HealthRow = {
  provider: "billing-agent";
  method: "POST";
  resource: string;
  phase: "response";
  http_status: number | null;
  object_id: null;
  action_id: null;
  run_key: string;
};
export type DoorDeps = {
  rpc: Rpc;
  insertHealth: (row: HealthRow) => Promise<void>;
  sha256Hex: (text: string) => Promise<string>;
  uuid: () => string;
};

export const MAX_BODY = 32 * 1024;
/** Unknown-key answers a minute, per instance, before the door stops asking the database. */
export const UNKNOWN_PER_MINUTE = 20;
const UNKNOWN_SENTENCE = "This key is not known.";
const LIMITED_SENTENCE = "Too many calls with keys this cockpit does not know. Wait a minute and try again.";
const KEY = /^Bearer (mak_[A-Za-z0-9_-]{43})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z_]{0,30}$/;
export const WRITE_OPS = ["chase", "invoice", "payment", "note"] as const;
export const READS = ["accounts", "ladder", "balances", "inbox", "chases"] as const;
export const SEND = 'Send {"op": "chase"|"invoice"|"payment"|"note", "body": {...}} or {"what": "accounts"|"ladder"|"balances"|"inbox"|"chases"}.';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export type Call =
  | { kind: "write"; op: string; body: Record<string, unknown>; requestId: string }
  | { kind: "read"; what: string; args: Record<string, unknown>; requestId: string };

/** The body, strictly: an op with its body, or a read; a sentence otherwise. */
export function readCall(raw: unknown, uuid: () => string): Call | string {
  if (!isObj(raw)) return SEND;
  const requestId = raw.requestId === undefined ? uuid() : typeof raw.requestId === "string" && UUID.test(raw.requestId) ? raw.requestId.toLowerCase() : null;
  if (!requestId) return "Send requestId as a UUID, or leave it out.";
  if (typeof raw.op === "string" && raw.what === undefined) {
    if (!Object.keys(raw).every(k => ["op", "body", "requestId"].includes(k))) return SEND;
    if (!NAME.test(raw.op)) return SEND;
    if (raw.body !== undefined && !isObj(raw.body)) return "Send the body as an object.";
    return { kind: "write", op: raw.op, body: (raw.body as Record<string, unknown>) ?? {}, requestId };
  }
  if (typeof raw.what === "string" && raw.op === undefined) {
    if (!Object.keys(raw).every(k => ["what", "args", "requestId"].includes(k))) return SEND;
    if (!NAME.test(raw.what)) return SEND;
    if (raw.args !== undefined && !isObj(raw.args)) return "Send args as an object.";
    return { kind: "read", what: raw.what, args: (raw.args as Record<string, unknown>) ?? {}, requestId };
  }
  return SEND;
}

/** The database's answer, kept to its known keys. */
function answerOf(v: unknown): { status: number; body: Record<string, unknown> } {
  const a = isObj(v) ? v : {};
  const status = typeof a.status === "number" && [200, 401, 409, 422, 429].includes(a.status) ? a.status : 502;
  const body: Record<string, unknown> = { ok: a.ok === true, outcome: typeof a.outcome === "string" ? a.outcome : "unknown" };
  if (a.result !== undefined) body.result = a.result;
  if (typeof a.error === "string") body.error = a.error;
  if (typeof a.firstCallId === "number") body.firstCallId = a.firstCallId;
  if (status === 502 && !body.error) body.error = "The cockpit did not answer as expected. Try again later.";
  return { status, body };
}

/** The body as text, never more than MAX_BODY bytes read; null when it is longer. */
async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function makeAgentDoor(deps: DoorDeps & { now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  // Per instance, in memory only (hashes, never keys): keys the database said it does not know, keys
  // it answered as known, and the unknown-key answers of the current minute.
  const unknown = new Map<string, number>();
  const known = new Set<string>();
  let window = { minute: -1, misses: 0 };
  const misses = () => {
    const minute = Math.floor(now() / 60_000);
    if (window.minute !== minute) window = { minute, misses: 0 };
    return window;
  };
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const auth = KEY.exec(req.headers.get("Authorization") ?? "");
    if (!auth) return json({ ok: false }, 401);
    const declared = Number(req.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY) return json({ ok: false, error: "Send under 32 KB." }, 413);
    const text = await readCapped(req);
    if (text === null) return json({ ok: false, error: "Send under 32 KB." }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ ok: false, error: SEND }, 400);
    }
    const call = readCall(raw, deps.uuid);
    if (typeof call === "string") return json({ ok: false, error: call }, 400);
    const hash = await deps.sha256Hex(auth[1]);
    // An unknown key: refused from memory for a minute, and no instance asks the database for more than
    // UNKNOWN_PER_MINUTE unknown keys a minute (a key seen working here is never held back).
    const seen = unknown.get(hash);
    if (seen !== undefined && now() - seen < 60_000) {
      misses().misses += 1;
      return json({ ok: false, outcome: "refused", error: UNKNOWN_SENTENCE, requestId: call.requestId }, 401);
    }
    if (!known.has(hash) && misses().misses >= UNKNOWN_PER_MINUTE) {
      return json({ ok: false, outcome: "limited", error: LIMITED_SENTENCE, requestId: call.requestId }, 429);
    }
    const resource = call.kind === "write" ? `billing-agent:${call.op}` : `billing-agent:read:${call.what}`;
    let answer: { status: number; body: Record<string, unknown> };
    try {
      const data =
        call.kind === "write"
          ? await deps.rpc("cockpit_billing_agent_write", { p_key_sha256: hash, p_op: call.op, p_body: call.body, p_request_id: call.requestId })
          : await deps.rpc("cockpit_billing_agent_read", { p_key_sha256: hash, p_what: call.what, p_args: { ...call.args, requestId: call.requestId } });
      answer = answerOf(data);
    } catch {
      // The database's own message can carry nothing the agent needs; the receipt says it failed.
      answer = { status: 502, body: { ok: false, outcome: "unknown", error: "The cockpit did not answer. Try again later with the same requestId." } };
    }
    if (answer.status === 401 && answer.body.error === UNKNOWN_SENTENCE) {
      // No key row, so no call row: no receipt either, or a flood would fill the health ledger.
      misses().misses += 1;
      if (unknown.size > 1000) unknown.clear();
      unknown.set(hash, now());
      return json({ ...answer.body, requestId: call.requestId }, answer.status);
    }
    if (answer.status !== 502) {
      unknown.delete(hash);
      if (known.size > 100) known.clear();
      known.add(hash);
    }
    try {
      await deps.insertHealth({
        provider: "billing-agent", method: "POST", resource, phase: "response", http_status: answer.status,
        object_id: null, action_id: null, run_key: call.requestId,
      });
    } catch {
      // A lost receipt never hides the answer: the call row in cockpit_agent_calls is the record.
    }
    return json({ ...answer.body, requestId: call.requestId }, answer.status);
  };
}

/** sha256 of the key as lower-case hex (the form D-AG stores with cockpit_agent_key_put_owner). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
