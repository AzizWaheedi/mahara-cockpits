/**
 * The GoHighLevel sub-account that holds Mahara's hiring pipeline.
 *
 * One location, one Private Integration Token, both read by name from the
 * deployment (GHL_HIRING_PIT, GHL_HIRING_LOCATION). The token never leaves
 * this file: it is not returned, not logged and stripped out of every error
 * message, the same rule convex/ceo/data/tap.ts follows for Tap.
 *
 * Why the cockpit talks to GoHighLevel directly rather than through a
 * GoHighLevel workflow (Aziz, 2026-09-22, on his first attempt: "it hasn't
 * really worked the best"): a workflow is a black box that cannot be tested,
 * versioned or explained when it silently stops. Every hiring action here is
 * code in git, leaves an audit row, and lands in the health ledger.
 */

declare const process: { env: Record<string, string | undefined> };

// biome-ignore lint/suspicious/noExplicitAny: GoHighLevel payloads are untyped
export type Any = any;

const BASE = "https://services.leadconnectorhq.com";
const DEFAULT_VERSION = "2021-07-28";
const TIMEOUT_MS = 20_000;
const RETRIES = 2;

export const PIT_NAME = "GHL_HIRING_PIT";
export const LOCATION_NAME = "GHL_HIRING_LOCATION";

/** A token must never reach a note, an error or a log. */
export const redact = (s: string): string =>
  s
    .replace(/\bpit-[0-9a-f-]{8,}/gi, "[token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [token]");

const brief = (x: unknown, max = 300): string =>
  redact(typeof x === "string" ? x : JSON.stringify(x ?? "")).slice(0, max);

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The hiring sub-account, or a sentence naming what to set. */
export function hiringLocation(): string {
  const id = (process.env[LOCATION_NAME] ?? "").trim();
  if (!id)
    throw new Error(
      `${LOCATION_NAME} is not set on this deployment, so the cockpit does not know which GoHighLevel sub-account holds hiring.`,
    );
  return id;
}

function token(): string {
  const t = (process.env[PIT_NAME] ?? "").trim();
  if (!t)
    throw new Error(
      `${PIT_NAME} is not set on this deployment. In GoHighLevel open the hiring sub-account, Settings, Private Integrations, and make a token with contacts, opportunities, custom values, calendars and conversations.`,
    );
  return t;
}

/** True when the rail is configured at all, for a screen that must not throw. */
export function hiringConfigured(): boolean {
  return Boolean(
    (process.env[PIT_NAME] ?? "").trim() &&
      (process.env[LOCATION_NAME] ?? "").trim(),
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `GoHighLevel did not answer within ${Math.round(ms / 1000)} s`,
          ),
        ),
      ms,
    );
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export type Reply = { status: number; body: Any };

/**
 * One call. Retries a rate limit, a server error and a dropped socket; never
 * retries a refusal, which would only be refused again.
 */
export async function ghl(
  method: string,
  path: string,
  init: { body?: unknown; version?: string } = {},
): Promise<Reply> {
  const key = token();
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let failure = "";
    try {
      res = await withTimeout(
        fetch(`${BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${key}`,
            Version: init.version ?? DEFAULT_VERSION,
            Accept: "application/json",
            ...(init.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
        TIMEOUT_MS,
      );
    } catch (e) {
      failure = brief(e instanceof Error ? e.message : String(e), 120);
    }
    if (!res) {
      if (attempt < RETRIES) {
        await wait((attempt + 1) * 2_000);
        continue;
      }
      throw new Error(`GoHighLevel could not be reached: ${failure}`);
    }
    const text = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      await wait((attempt + 1) * 3_000);
      continue;
    }
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text.slice(0, 600) };
    }
  }
}

/** The same call, but anything other than success is an error with a readable sentence. */
export async function ghlOk(
  method: string,
  path: string,
  init: { body?: unknown; version?: string } = {},
): Promise<Any> {
  const r = await ghl(method, path, init);
  if (r.status < 200 || r.status >= 300)
    throw new Error(
      `GoHighLevel ${method} ${path.split("?")[0]} answered ${r.status}: ${brief(r.body)}`,
    );
  return r.body;
}
