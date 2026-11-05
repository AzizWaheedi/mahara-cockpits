/**
 * Disabled HTTP-boundary candidate, synthetic tests only. No real server,
 * database adapter, provider adapter, secrets or deployment configuration.
 */
import { capabilityHash, Denied, parseRequest, verifyGithub, type Identity, type Policy, type Request as Binding } from "./auth.ts";

const LIMIT = 8192;
const COMMENT_LIMIT = 256 * 1024;
const REQUEST_TIMEOUT_MS = 8000;
type Answer = { ref: string; title: string; value: string };
export type Snapshot = {
  taskId: string; responseId: string; schemaVersion: number; commentId: string; commentSha256: string;
  submittedAt: string; schemaHash: string; printerHash: string; source: string; state: string;
  mode: string; latest: boolean; verifiedReceipt: boolean; complete: boolean; answers: Answer[];
};
type Ports = {
  githubKeys: () => Promise<(JsonWebKey & { kid?: string; alg?: string; use?: string })[]>;
  // The actual provider adapter must independently verify the task association and enforce its own byte/time limits.
  comment: (task: string, id: string, signal: AbortSignal) => Promise<{ taskId: string; commentId: string; bytes: Uint8Array } | null>;
  // The actual implementation must perform all bindings, freshness, receipt, schema and capability checks atomically.
  readAtomic: (request: Omit<Binding, "capability">, capability: string, identity: Identity, signal: AbortSignal) => Promise<Snapshot | null>;
  // The second transaction must verify that the same claim remains current after the external provider read.
  recheckAtomic: (request: Omit<Binding, "capability">, capability: string, identity: Identity, signal: AbortSignal) => Promise<Snapshot | null>;
  // Production must use an effective trusted rate limiter; callers must not supply their own identities.
  permit: (signal: AbortSignal) => Promise<boolean>;
};
type Config = { enabled: boolean; policy: Policy; pins: Record<2 | 3, { schema: string; printer: string; allowedRefs: Record<string, string> }> };

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0", "pragma": "no-cache", "x-content-type-options": "nosniff" } });
}
async function body(req: globalThis.Request, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get("content-type") ?? "")) throw new Denied();
  const length = req.headers.get("content-length");
  if (length !== null && (!/^[0-9]{1,8}$/.test(length) || Number(length) > LIMIT)) throw new Denied();
  if (!req.body) throw new Denied();
  const stream = req.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Denied());
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    for (;;) {
      const part = await Promise.race([stream.read(), aborted]); if (part.done) break;
      total += part.value.byteLength; if (total > LIMIT) throw new Denied(); chunks.push(part.value);
    }
  } finally { signal.removeEventListener("abort", onAbort); void stream.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Denied(); }
}
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
}
function validSnapshot(s: Snapshot, req: Binding, config: Config): boolean {
  const pins = config.pins[req.schemaVersion as 2 | 3];
  if (!pins || !/^[0-9a-f]{64}$/.test(pins.schema) || !/^[0-9a-f]{64}$/.test(pins.printer)
      || !pins.allowedRefs || typeof pins.allowedRefs !== "object" || Array.isArray(pins.allowedRefs)
      || Object.keys(pins.allowedRefs).length < 1 || Object.keys(pins.allowedRefs).length > 50
      || !s || typeof s !== "object" || Array.isArray(s)
      || Object.keys(s).sort().join(",") !== "answers,commentId,commentSha256,complete,latest,mode,printerHash,responseId,schemaHash,schemaVersion,source,state,submittedAt,taskId,verifiedReceipt"
      || s.taskId !== req.taskId || s.responseId !== req.responseId || s.schemaVersion !== req.schemaVersion
      || s.commentId !== req.commentId || s.commentSha256 !== req.commentSha256
      || s.schemaHash !== pins.schema || s.printerHash !== pins.printer
      || s.source !== "native" || (s.state !== "submitted" && s.state !== "confirmed") || s.mode !== "live"
      || s.latest !== true || s.verifiedReceipt !== true || s.complete !== true
      || typeof s.submittedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.submittedAt)
      || !Number.isFinite(Date.parse(s.submittedAt)) || new Date(s.submittedAt).toISOString() !== s.submittedAt
      || !Array.isArray(s.answers) || !s.answers.length || s.answers.length > 50) return false;
  const refs = new Set<string>(); let bytes = 0;
  for (const answer of s.answers) {
    if (!answer || typeof answer !== "object" || Object.keys(answer).sort().join(",") !== "ref,title,value"
        || typeof answer.ref !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(answer.ref) || refs.has(answer.ref)
        || !Object.prototype.hasOwnProperty.call(pins.allowedRefs, answer.ref)
        || typeof answer.title !== "string" || !answer.title || answer.title.length > 2000 || pins.allowedRefs[answer.ref] !== answer.title
        || typeof answer.value !== "string" || !answer.value.trim() || answer.value.length > 100_000) return false;
    refs.add(answer.ref); bytes += new TextEncoder().encode(answer.title + answer.value).length;
    if (bytes > 800_000) return false;
  }
  return true;
}

// Compare only validated fields, in a fixed order, without logging private data.
function comparable(s: Snapshot): string {
  return JSON.stringify([s.taskId,s.responseId,s.schemaVersion,s.commentId,s.commentSha256,s.submittedAt,
    s.schemaHash,s.printerHash,s.source,s.state,s.mode,s.latest,s.verifiedReceipt,s.complete,
    s.answers.map(a => [a.ref,a.title,a.value])]);
}

/** This is not an installation entry point and has no production ports. */
export function candidateHandler(config: Config | null, ports: Ports | null, now: () => number = () => Math.floor(Date.now() / 1000)) {
  return async (request: globalThis.Request): Promise<Response> => {
    // Missing or incomplete setup cannot make the reader live.
    if (config?.enabled !== true || !ports) return response(404, { error: "Not found" });
    if (request.method !== "POST") return response(405, { error: "Method not allowed" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let onAbort = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Denied());
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const work = (async () => {
      const check = () => { if (controller.signal.aborted) throw new Denied(); };
      if (await ports.permit(controller.signal) !== true) throw new Denied(); check();
      const auth = request.headers.get("authorization") ?? "";
      if (!/^Bearer [A-Za-z0-9_.-]{1,16384}$/.test(auth)) throw new Denied();
      const identity = await verifyGithub(auth.slice(7), config.policy, ports.githubKeys, now());
      check();
      const data = parseRequest(await body(request, controller.signal)); check();
      // Validate canonical encoding; the narrowly scoped DB function hashes
      // the secret itself. A hash is not accepted as a bearer credential.
      await capabilityHash(data.capability);
      // Authorize and bind the capability *before* invoking a privileged comment
      // provider, so a workflow cannot use the reader to probe unrelated tasks.
      // A later provider failure must be recovered by a bounded same-run retry.
      const { capability: _cap, ...binding } = data;
      check();
      const snapshot = await ports.readAtomic(binding, data.capability, identity, controller.signal); check();
      if (!snapshot || !validSnapshot(snapshot, data, config)) throw new Denied();
      const receipt = await ports.comment(data.taskId, data.commentId, controller.signal); check();
      if (!receipt || receipt.taskId !== data.taskId || receipt.commentId !== data.commentId
          || !(receipt.bytes instanceof Uint8Array) || receipt.bytes.byteLength > COMMENT_LIMIT
          || await digest(receipt.bytes) !== data.commentSha256) throw new Denied();
      const current = await ports.recheckAtomic(binding, data.capability, identity, controller.signal); check();
      if (!current || !validSnapshot(current, data, config) || comparable(current) !== comparable(snapshot)) throw new Denied();
      // Deliberately select output fields, never return unreviewed database columns.
      return response(200, { taskId: snapshot.taskId, responseId: snapshot.responseId, schemaVersion: snapshot.schemaVersion,
        submittedAt: snapshot.submittedAt, answers: snapshot.answers });
      })();
      return await Promise.race([work, deadline]);
    } catch { return response(403, { error: "Request denied" }); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort); controller.abort(); }
  };
}
