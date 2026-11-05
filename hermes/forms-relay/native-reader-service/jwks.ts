/** Offline-reviewed component candidate, not wired into a running server. */
import { Denied } from "./auth.ts";

// This is a trusted constant, never read from a JWT header, request or environment.
export const GITHUB_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const MAX_BYTES = 65_536;
const TTL_MS = 300_000;
const TIMEOUT_MS = 5_000;
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || response.redirected) throw new Denied();
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) throw new Denied();
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]{1,8}$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Denied();
  if (!response.body) throw new Denied();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Denied());
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    while (true) {
      const item = await Promise.race([reader.read(), aborted]);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_BYTES) throw new Denied();
      chunks.push(item.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    // No waiting on a potentially unresponsive stream cancellation.
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Denied(); }
}

/**
 * All network access is pinned to GitHub's key endpoint; the injected transport
 * and clock exist for synthetic tests. No request data is sent to the key host.
 * An expired cache is never used after a fetch failure. Key rotation can cause
 * a temporary denial until the short cache lifetime expires.
 */
export function githubKeys(request: typeof fetch = fetch, now: () => number = () => Math.floor(performance.now())): () => Promise<Jwk[]> {
  let cache: { keys: Jwk[]; fetchedAt: number; expires: number } | undefined;
  let pending: Promise<Jwk[]> | undefined;
  async function fetchKeys(): Promise<Jwk[]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Denied()); }, TIMEOUT_MS);
    });
    const work = (async () => {
      const response = await request(GITHUB_JWKS, {
        method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { Accept: "application/json" }, signal: controller.signal,
      });
      const payload = await boundedJson(response, controller.signal);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Denied();
      const keys = (payload as { keys?: unknown }).keys;
      if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100) throw new Denied();
      const ids = new Set<string>();
      for (const key of keys) {
        if (!key || typeof key !== "object" || Array.isArray(key) || typeof key.kid !== "string"
            || !/^[A-Za-z0-9_-]{1,128}$/.test(key.kid) || ids.has(key.kid)
            || "d" in key || "p" in key || "q" in key || "dp" in key || "dq" in key || "qi" in key) throw new Denied();
        ids.add(key.kid);
      }
      return keys as Jwk[];
    })();
    try { return await Promise.race([work, deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
  }
  return async () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) throw new Denied();
    if (cache && time >= cache.fetchedAt && time < cache.expires) return structuredClone(cache.keys);
    if (!pending) {
      pending = fetchKeys().then(keys => {
        const fetchedAt = now();
        if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) throw new Denied();
        if (fetchedAt > Number.MAX_SAFE_INTEGER - TTL_MS) throw new Denied();
        cache = { keys: structuredClone(keys), fetchedAt, expires: fetchedAt + TTL_MS };
        return keys;
      }).finally(() => { pending = undefined; });
    }
    try { return structuredClone(await pending); }
    catch { throw new Denied(); }
  };
}
