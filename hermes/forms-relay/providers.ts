/**
 * The relay's doors: the database (PostgREST with the service key; the relay RPCs, the provider ledger and the
 * health row only), the ledger every provider call goes through, and GitHub's repository_dispatch with a token
 * read by name. No Google door: the relay writes nothing to Client Data (20261102l). Never a key, a token or a
 * value in a log line.
 */
import type { Answer, Config, Row } from "./relay.ts";

export const SUPABASE = "https://bldgtotkfmhoxmlzowdx.supabase.co";
export const RPC_NAME = /^cockpit_form_relay_[a-z]+$/;
export type Env = Record<string, string | undefined>;

export function makeDb(env: Env, request: typeof fetch = fetch) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing named key: SUPABASE_SERVICE_ROLE_KEY");
  const base = String(env.SUPABASE_URL ?? "").replace(/\/$/, "");
  if (base !== SUPABASE)
    throw new Error(
      "SUPABASE_URL must be the Creative Triage project (bldgtotkfmhoxmlzowdx).",
    );
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  async function call(
    path: string,
    body: unknown,
    prefer: string | null,
  ): Promise<any> {
    const res = await request(`${base}${path}`, {
      method: "POST",
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `The database refused ${path.split("?")[0]} (${res.status}).`;
      try {
        const j = JSON.parse(text);
        if (typeof j?.message === "string" && j.message)
          message = j.message.slice(0, 240);
      } catch {}
      throw new Error(message);
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    rpc: async <T = any>(name: string, args: Row = {}): Promise<T> => {
      if (!RPC_NAME.test(name))
        throw new Error("Only the relay RPCs are called from this worker.");
      return call(`/rest/v1/rpc/${name}`, args, null);
    },
    receipt: async (row: Row) => {
      await call("/rest/v1/cockpit_csm_provider_health", row, "return=minimal");
    },
    health: async (h: {
      key: string;
      ok: boolean;
      note: string;
      detail: Row;
    }) => {
      const at = new Date().toISOString();
      await call(
        "/rest/v1/cockpit_sync_state?on_conflict=key",
        [
          {
            key: h.key,
            last_run_at: at,
            ...(h.ok ? { last_ok_at: at } : {}),
            ok: h.ok,
            note: h.note.slice(0, 500),
            detail: h.detail,
            updated_at: at,
          },
        ],
        "resolution=merge-duplicates,return=minimal",
      );
    },
  };
}

/** Host and path with every id collapsed: never a repository id, a card or a token. */
export function resourceOf(url: URL): string {
  const parts = url.pathname.split("/").map(seg => {
    if (!seg) return seg;
    const s = decodeURIComponent(seg);
    if (/\d/.test(s) && s.length >= 5) return ":id";
    return seg;
  });
  return `${url.host}${parts.join("/")}`.slice(0, 200);
}

/** A call the ledger stopped before it left. */
export class NotSent extends Error {}

const MAX_PROVIDER_BODY = 256 * 1024;

/** Bound provider bodies before decoding; never persist the contents. */
export async function providerBody(res: Response, signal: AbortSignal): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_PROVIDER_BODY)) {
    void res.body?.cancel().catch(() => {});
    throw new Error("Invalid provider body size.");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let stop: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(new Error("Provider body read aborted."));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_PROVIDER_BODY) throw new Error("Provider body too large.");
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Every provider call writes an intent receipt before it leaves (no receipt, no call) and a response or unknown
 * receipt after. Only GitHub, and only GET and the one POST this worker makes (the dispatch).
 */
export function ledgerFetch(
  insert: (r: Row) => Promise<void>,
  runKey: string,
  request: typeof fetch = fetch,
) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Snapshot target, method, headers and the current caller's string body
    // before awaiting the receipt. A streamed body can still produce later data.
    // URL and init objects supplied by a caller can otherwise change mid-call.
    const requestSnapshot = new Request(input, { ...init, redirect: "error" });
    const url = new URL(requestSnapshot.url);
    if (url.host !== "api.github.com" || url.protocol !== "https:")
      throw new NotSent("Only GitHub is called from this worker.");
    const provider = "github";
    const method = requestSnapshot.method.toUpperCase();
    const allowedPost =
      method === "POST" &&
      /^\/repos\/[^/]+\/[^/]+\/dispatches$/.test(url.pathname);
    if (method !== "GET" && !allowedPost)
      throw new NotSent(
        "Only GET reads and the dispatch POST leave this worker.",
      );
    const base = {
      provider,
      method,
      resource: resourceOf(url),
      action_id: null,
      run_key: runKey,
      object_id: null,
    };
    try {
      await insert({ ...base, phase: "intent", http_status: null });
    } catch {
      throw new NotSent(
        "The health ledger did not take the intent receipt, so the call was not made.",
      );
    }
    let res: Response;
    try {
      res = await request(requestSnapshot);
    } catch {
      await insert({ ...base, phase: "unknown", http_status: null }).catch(
        () => {},
      );
      throw new Error("The GitHub request did not return a response.");
    }
    let body: string;
    try {
      // A 204 response already confirms delivery and has no body. Do not let a
      // broken body reader turn that known result into an ambiguous retry.
      body = res.status === 204 ? "" : await providerBody(res, requestSnapshot.signal);
    } catch {
      await insert({ ...base, phase: "unknown", http_status: null }).catch(
        () => {},
      );
      throw new Error("The GitHub response body could not be read.");
    }
    await insert({ ...base, phase: "response", http_status: res.status }).catch(
      () => {},
    );
    return new Response(res.status === 204 ? null : body, {
      status: res.status,
      headers: res.headers,
    });
  }) as typeof fetch;
}

/** GitHub's repository_dispatch with GITHUB_DISPATCH_TOKEN, through the ledger. 204 is the only yes. */
export function makeGithub(env: Env, config: Config, request: typeof fetch) {
  const headers = () => {
    const token = env.GITHUB_DISPATCH_TOKEN;
    if (!token) throw new NotSent("Missing named key: GITHUB_DISPATCH_TOKEN");
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mahara-forms-relay",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  };
  const repo = `https://api.github.com/repos/${encodeURIComponent(config.dispatchOwner)}/${encodeURIComponent(config.dispatchRepo)}`;
  return {
    async dispatch(body: Row): Promise<Answer> {
      let res: Response;
      try {
        res = await request(`${repo}/dispatches`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        if (e instanceof NotSent)
          return { ok: false, status: 0, definite: true };
        return { ok: false, status: 0, definite: false };
      }
      if (res.status === 204) return { ok: true, status: 204 };
      return {
        ok: false,
        status: res.status,
        definite:
          res.status >= 400 &&
          res.status < 500 &&
          res.status !== 408 &&
          res.status !== 429,
      };
    },
    /** The doctor's one read: the repository answers to the token. */
    async repoReadable(): Promise<number> {
      const res = await request(repo, {
        headers: headers(),
        signal: AbortSignal.timeout(20_000),
      });
      return res.status;
    },
  };
}
