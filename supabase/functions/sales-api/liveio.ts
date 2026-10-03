// The outside world for the live-call modules (rooms.ts, followupAgent.ts):
// the database through PostgREST, HighLevel, the clock and background work.
// index.ts wires the real one (makeLiveIO); the tests wire testfakes.ts.
//
// Every call has a timeout and a recorded failure: a database read waits at
// most DB_MS, a HighLevel call at most GHL_MS, and a timeout is an error with
// status 0 that says so, never a hang. Nothing here retries: the callers
// decide (a guarded write is read again, an event is left for the sweep).

import { redact } from "./lib.ts";

type Row = Record<string, unknown>;

/** A database call waits this long at most. */
export const DB_MS = 8_000;
/** A HighLevel call waits this long at most. */
export const GHL_MS = 15_000;

const GHL = "https://services.leadconnectorhq.com";
// HighLevel sits behind Cloudflare, which refuses a request with no
// browser-like agent (error 1010).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * A refusal an action answers with: one sentence that says what to do next,
 * an HTTP status, and extra keys for the body (`code`, and for the desk
 * `retry`, `cleanup` or `hold_all`). index.ts's Refusal extends it, so the
 * gateway answers every module's refusals the same way.
 */
export class ApiRefusal extends Error {
  constructor(
    message: string,
    public status = 400,
    public extra: Row = {},
  ) {
    super(message);
  }
}

/** A database answer that was not a success: PostgREST's code and, for a unique violation, the constraint's name. */
export class DbError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null = null,
    public constraint: string | null = null,
  ) {
    super(message);
  }
}

/** A HighLevel answer that was not a success (status 0: no answer in time). */
export class GhlError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface DbInit {
  method?: string;
  body?: unknown;
  prefer?: string;
}

export interface LiveIO {
  now(): number;
  uuid(): string;
  sleep(ms: number): Promise<void>;
  /** Work that may finish after the answer (EdgeRuntime.waitUntil when there is one). */
  background(p: Promise<unknown>): void;
  /** PostgREST with the service key. Throws DbError. */
  db(path: string, init?: DbInit): Promise<Row[]>;
  /** A database function. Throws DbError. */
  rpc(fn: string, args: Row): Promise<unknown>;
  /** HighLevel (the sales sub-account). Throws GhlError. */
  ghl(method: string, path: string, body?: unknown, version?: string): Promise<Row>;
  log(message: string): void;
}

/** The constraint a unique violation names, from PostgREST's message or details. */
export function constraintOf(text: string): string | null {
  const m = /constraint "([a-z0-9_]+)"/i.exec(text);
  return m ? (m[1] ?? null) : null;
}

/** Turns a PostgREST error body into a DbError. */
export function dbErrorOf(status: number, text: string): DbError {
  let code: string | null = null;
  let message = text;
  try {
    const j = JSON.parse(text) as Row;
    code = typeof j.code === "string" ? j.code : null;
    message = [j.message, j.details, j.hint].filter(x => typeof x === "string" && x).join(" ") || text;
  } catch {
    // not JSON
  }
  return new DbError(`database ${status}: ${redact(message)}`, status, code, constraintOf(message));
}

/** A unique violation (PostgREST 409, Postgres 23505). */
export function isUnique(e: unknown, constraint?: string): boolean {
  if (!(e instanceof DbError)) return false;
  const unique = e.code === "23505" || (e.status === 409 && !e.code);
  return unique && (!constraint || e.constraint === constraint);
}

function timedOut(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  return name === "TimeoutError" || name === "AbortError";
}

/** A deterministic UUID from text (SHA-256, version 5 layout): the same seed is always the same request id. */
export async function uuidFrom(seed: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  d[6] = ((d[6] ?? 0) & 0x0f) | 0x50;
  d[8] = ((d[8] ?? 0) & 0x3f) | 0x80;
  const h = [...d.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The real outside world, from the function's environment. */
export function makeLiveIO(o: {
  env: (name: string) => string;
  fetch?: typeof fetch;
  background?: (p: Promise<unknown>) => void;
  log?: (message: string) => void;
}): LiveIO {
  const f = o.fetch ?? fetch;
  const log = o.log ?? ((m: string) => console.error(m));
  const base = () => o.env("SUPABASE_URL");
  const key = () => o.env("SUPABASE_SERVICE_ROLE_KEY");

  async function call(url: string, init: RequestInit, ms: number): Promise<Response> {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(ms) });
    } catch (e) {
      if (timedOut(e)) throw Object.assign(new Error(`no answer within ${Math.round(ms / 1000)} s`), { timeout: true });
      throw e;
    }
  }

  return {
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    background:
      o.background ??
      (p => {
        p.catch(e => log(`background work failed: ${redact(String((e as Error)?.message ?? e))}`));
      }),
    log,
    async db(path, init = {}) {
      let res: Response;
      try {
        res = await call(
          `${base()}/rest/v1/${path}`,
          {
            method: init.method ?? "GET",
            headers: {
              apikey: key(),
              Authorization: `Bearer ${key()}`,
              "Content-Type": "application/json",
              ...(init.prefer ? { Prefer: init.prefer } : {}),
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
          },
          DB_MS,
        );
      } catch (e) {
        throw new DbError(`database: ${redact(String((e as Error)?.message ?? e))}`, 0);
      }
      const text = await res.text();
      if (!res.ok) throw dbErrorOf(res.status, text);
      const out = text ? JSON.parse(text) : [];
      return Array.isArray(out) ? out : [out];
    },
    async rpc(fn, args) {
      let res: Response;
      try {
        res = await call(
          `${base()}/rest/v1/rpc/${fn}`,
          {
            method: "POST",
            headers: { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
            body: JSON.stringify(args),
          },
          DB_MS,
        );
      } catch (e) {
        throw new DbError(`database: ${redact(String((e as Error)?.message ?? e))}`, 0);
      }
      const text = await res.text();
      if (!res.ok) throw dbErrorOf(res.status, text);
      return text ? JSON.parse(text) : null;
    },
    async ghl(method, path, body, version = "2021-04-15") {
      const token = o.env("SALES_GHL_TOKEN");
      if (!token) throw new GhlError("HighLevel is not connected (SALES_GHL_TOKEN is missing)", 0);
      let res: Response;
      try {
        res = await call(
          `${GHL}${path}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              Version: version,
              Accept: "application/json",
              "User-Agent": UA,
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
          GHL_MS,
        );
      } catch (e) {
        throw new GhlError(`HighLevel did not answer: ${redact(String((e as Error)?.message ?? e))}`, 0);
      }
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try {
          const j = JSON.parse(text);
          const m = j.message ?? j.msg ?? j.error ?? text;
          msg = typeof m === "string" ? m : String((m as Row)?.error ?? (m as Row)?.message ?? JSON.stringify(m));
        } catch {
          // not JSON
        }
        throw new GhlError(`HighLevel said ${res.status}: ${redact(msg)}`, res.status);
      }
      return text ? (JSON.parse(text) as Row) : {};
    },
  };
}
