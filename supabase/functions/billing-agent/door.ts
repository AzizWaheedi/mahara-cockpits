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
 * The door is public, so an unknown or revoked key costs as little as it
 * can: it writes no receipt (a flood, or a leaked key the CEO revoked, must
 * never bury real agent failures in the health ledger), and a key already
 * answered "not known" or "revoked" is refused again from memory for a minute
 * without a database call (it never joins the keys seen working). Above
 * UNKNOWN_PER_MINUTE database answers of "not known" or "revoked" a minute,
 * a key this instance has not seen work is checked against the key list
 * (read at most once a minute, hashes only): a live key goes on to the
 * database, a revoked one gets its sentence from memory, any other key 429.
 * A random-key flood therefore never locks the real agent out of a fresh
 * instance, and an answer from memory spends none of the minute's budget.
 * The body is read with a hard 32 KB cap, whatever Content-Length says.
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
export type KeyRow = { key_sha256: string; revoked_at: string | null };
export type DoorDeps = {
  rpc: Rpc;
  insertHealth: (row: HealthRow) => Promise<void>;
  sha256Hex: (text: string) => Promise<string>;
  uuid: () => string;
  /** The agent keys' hashes and revocation (cockpit_agent_keys), read only while the miss window is full. */
  listKeys?: () => Promise<KeyRow[]>;
};

export const MAX_BODY = 32 * 1024;
/** Unknown- or revoked-key answers from the database a minute, per instance, before unseen keys are checked against the key list. */
export const UNKNOWN_PER_MINUTE = 20;
const UNKNOWN_SENTENCE = "This key is not known.";
const REVOKED_SENTENCE = "This key was revoked.";
const HEX64 = /^[0-9a-f]{64}$/;
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
  // Per instance, in memory only (hashes, never keys): keys the database refused (not known or
  // revoked) with its sentence, keys it answered as working, the database's refusals of the current
  // minute, and the key list when the miss window made the door read it.
  const refused = new Map<string, { at: number; error: string }>();
  const known = new Set<string>();
  let window = { minute: -1, misses: 0 };
  const misses = () => {
    const minute = Math.floor(now() / 60_000);
    if (window.minute !== minute) window = { minute, misses: 0 };
    return window;
  };
  let list: { at: number; live: Set<string>; revoked: Set<string> } | null = null;
  let listTriedAt = -Infinity;
  const keyList = async () => {
    if (!deps.listKeys) return null;
    if (list && now() - list.at < 60_000) return list;
    if (now() - listTriedAt < 60_000) return null;
    listTriedAt = now();
    try {
      const rows = await deps.listKeys();
      const live = new Set<string>();
      const revoked = new Set<string>();
      for (const r of Array.isArray(rows) ? rows : []) {
        const h = typeof r?.key_sha256 === "string" ? r.key_sha256.toLowerCase() : "";
        if (HEX64.test(h)) (r.revoked_at == null ? live : revoked).add(h);
      }
      list = { at: now(), live, revoked };
      return list;
    } catch {
      return null;
    }
  };
  const remember = (hash: string, error: string) => {
    known.delete(hash);
    if (refused.size > 1000) refused.clear();
    refused.set(hash, { at: now(), error });
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
    // An unknown or revoked key: refused from memory for a minute (no database call, nothing spent).
    const seen = refused.get(hash);
    if (seen !== undefined && now() - seen.at < 60_000) {
      return json({ ok: false, outcome: "refused", error: seen.error, requestId: call.requestId }, 401);
    }
    // Over UNKNOWN_PER_MINUTE refusals this minute, a key not seen working here is checked against the
    // key list instead of the database: the real agent goes on, a revoked key is refused, the rest wait.
    if (!known.has(hash) && misses().misses >= UNKNOWN_PER_MINUTE) {
      const keys = await keyList();
      if (keys?.revoked.has(hash)) {
        remember(hash, REVOKED_SENTENCE);
        return json({ ok: false, outcome: "refused", error: REVOKED_SENTENCE, requestId: call.requestId }, 401);
      }
      if (!keys?.live.has(hash)) {
        return json({ ok: false, outcome: "limited", error: LIMITED_SENTENCE, requestId: call.requestId }, 429);
      }
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
    if (answer.status === 401) {
      // Not known (no key row) or revoked (a leaked key's flood): no receipt, or the health ledger
      // would fill; refused from memory for a minute, and never counted as a key seen working.
      misses().misses += 1;
      remember(hash, typeof answer.body.error === "string" ? answer.body.error : UNKNOWN_SENTENCE);
      return json({ ...answer.body, requestId: call.requestId }, answer.status);
    }
    if (answer.status !== 502) {
      refused.delete(hash);
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
