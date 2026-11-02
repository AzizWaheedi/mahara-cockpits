/**
 * The relay's doors: the database (PostgREST with the service key; the relay RPCs, the provider ledger and the
 * health row only), the ledger every provider call goes through, Google Sheets with the shared service account,
 * and GitHub's repository_dispatch with a token read by name. Never a key, a token or a value in a log line.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
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

const PROVIDERS: Record<string, string> = {
  "sheets.googleapis.com": "google",
  "oauth2.googleapis.com": "google",
  "api.github.com": "github",
};

/** Host and path with every id collapsed: never a sheet id, a repository, a card or a token. */
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

/**
 * Every provider call writes an intent receipt before it leaves (no receipt, no call) and a response or unknown
 * receipt after. Only the three hosts, and only GET and the three POSTs this worker makes (the token exchange,
 * the sheet append and the dispatch).
 */
export function ledgerFetch(
  insert: (r: Row) => Promise<void>,
  runKey: string,
  request: typeof fetch = fetch,
) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    const provider = PROVIDERS[url.host];
    if (!provider || url.protocol !== "https:")
      throw new NotSent("Only Google and GitHub are called from this worker.");
    const method = String(init?.method ?? "GET").toUpperCase();
    const allowedPost =
      method === "POST" &&
      (url.href === "https://oauth2.googleapis.com/token" ||
        /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+:append$/.test(
          url.pathname,
        ) ||
        /^\/repos\/[^/]+\/[^/]+\/dispatches$/.test(url.pathname));
    if (method !== "GET" && !allowedPost)
      throw new NotSent(
        "Only GET reads and the three named POSTs leave this worker.",
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
      res = await request(input, init);
    } catch (e) {
      await insert({ ...base, phase: "unknown", http_status: null }).catch(
        () => {},
      );
      throw e;
    }
    const body = await res.text();
    await insert({ ...base, phase: "response", http_status: res.status }).catch(
      () => {},
    );
    return new Response(res.status === 204 ? null : body, {
      status: res.status,
      headers: res.headers,
    });
  }) as typeof fetch;
}

/** Client Data through the shared service account (read and append), every call through the ledger. */
export function makeSheet(env: Env, config: Config, request: typeof fetch) {
  let token: string | null = null;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}/values`;
  const range = encodeURIComponent(`${config.tab}!A:ZZ`);
  async function auth(): Promise<string> {
    if (token) return token;
    const path = env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!path)
      throw new Error("Missing named key: GOOGLE_APPLICATION_CREDENTIALS");
    const account = JSON.parse(readFileSync(path, "utf8"));
    const enc = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(account.private_key)
      .toString("base64url");
    const res = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as Row;
    if (!res.ok || typeof j.access_token !== "string")
      throw new Error(`Google gave no credential (${res.status}).`);
    token = j.access_token;
    return token;
  }
  return {
    async read(): Promise<unknown[][]> {
      const res = await request(`${base}/${range}`, {
        headers: { Authorization: `Bearer ${await auth()}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok)
        throw new Error(
          `Google answered the Client Data read with ${res.status}.`,
        );
      const j = (await res.json()) as Row;
      if (!Array.isArray(j.values))
        throw new Error("Client Data came back without its rows.");
      return j.values;
    },
    async append(row: string[]): Promise<Answer> {
      let res: Response;
      try {
        res = await request(
          `${base}/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${await auth()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ values: [row] }),
            signal: AbortSignal.timeout(20_000),
          },
        );
      } catch (e) {
        if (e instanceof NotSent)
          return { ok: false, status: 0, definite: true };
        return { ok: false, status: 0, definite: false };
      }
      if (res.ok) return { ok: true, status: res.status };
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
  };
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
