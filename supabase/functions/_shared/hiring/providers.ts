/**
 * The two outside services the hiring jobs call: GoHighLevel (the hiring
 * sub-account) and Typeform (the careers forms).
 *
 * Every call writes a receipt to cockpit_hiring_provider_health before it
 * starts and another when it answers, so the health ledger shows each one.
 * A receipt that cannot be written stops the call before it is made.
 *
 * Three gates live here, inside the client, so a caller cannot forget them:
 * - read: always allowed.
 * - write (contacts, opportunities, notes): only when HIRING_APPLY is
 *   exactly "true". Otherwise it throws GateError and writes nothing.
 * - send (email, SMS, WhatsApp to a candidate): only when
 *   HIRING_SEND_ENABLED is exactly "true", and never retried on a server
 *   error, because the message may already have gone.
 *
 * Tokens are read by name (GHL_HIRING_PIT, TYPEFORM_TOKEN), never returned,
 * never logged, and stripped from every error.
 */

// deno-lint-ignore no-explicit-any
export type Any = any;

export const GHL_BASE = "https://services.leadconnectorhq.com";
export const TYPEFORM_BASE = "https://api.typeform.com";
export const PIT_NAME = "GHL_HIRING_PIT";
export const LOCATION_NAME = "GHL_HIRING_LOCATION";
export const TYPEFORM_NAME = "TYPEFORM_TOKEN";
export const APPLY_NAME = "HIRING_APPLY";
export const SEND_NAME = "HIRING_SEND_ENABLED";

const GHL_VERSION = "2021-07-28";
const RETRIES = 2;

/** HIRING_APPLY must be exactly "true". Anything else is a dry run. */
export const applyEnabled = (env: (n: string) => string | undefined) =>
  env(APPLY_NAME) === "true";
/** HIRING_SEND_ENABLED must be exactly "true". Anything else sends nothing. */
export const sendEnabled = (env: (n: string) => string | undefined) =>
  env(SEND_NAME) === "true";

/** A token must never reach a note, an error or a log. */
export const redact = (s: unknown): string =>
  String(s ?? "")
    .replace(/\bpit-[0-9a-f-]{8,}/gi, "[token]")
    .replace(/\btfp_[A-Za-z0-9_-]{8,}/g, "[token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [token]");

const brief = (x: unknown, max = 300): string =>
  redact(typeof x === "string" ? x : JSON.stringify(x ?? "")).slice(0, max);

/** A gate held: nothing left the building. */
export class GateError extends Error {
  status = 409;
}

export type HealthRow = {
  provider: "gohighlevel" | "typeform";
  method: string;
  resource: string;
  phase: "intent" | "response" | "failed" | "blocked";
  http_status?: number;
  error?: string;
};
export type Health = (row: HealthRow) => Promise<void>;

export type Reply = { status: number; body: Any };

type ClientDeps = {
  health: Health;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type Ghl = ReturnType<typeof ghlClient>;

export function ghlClient(
  o: ClientDeps & {
    token: string;
    location: string;
    apply: boolean;
    sendEnabled: boolean;
  },
) {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? realSleep;
  const receipt = (method: string, path: string) => ({
    provider: "gohighlevel" as const,
    method,
    // The query string carries the location id and paging, not the token,
    // but the ledger keeps the path alone.
    resource: path.split("?")[0],
  });

  async function call(
    method: string,
    path: string,
    body?: unknown,
    retryServerErrors = true,
  ): Promise<Reply> {
    const r = receipt(method, path);
    for (let attempt = 0; ; attempt++) {
      await o.health({ ...r, phase: "intent" });
      let res: Response | null = null;
      let failure = "";
      try {
        res = await doFetch(`${GHL_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${o.token}`,
            Version: GHL_VERSION,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        });
      } catch (e) {
        failure = brief(e instanceof Error ? e.message : String(e), 120);
      }
      if (!res) {
        await o.health({ ...r, phase: "failed", error: failure });
        if (retryServerErrors && attempt < RETRIES) {
          await sleep((attempt + 1) * 2_000);
          continue;
        }
        throw new Error(`GoHighLevel could not be reached: ${failure}`);
      }
      const text = await res.text().catch(() => "");
      await o.health({ ...r, phase: "response", http_status: res.status });
      // A rate limit was not processed, so it is always safe to try again.
      // A server error may have been processed, so a send never retries it.
      const again =
        res.status === 429 || (retryServerErrors && res.status >= 500);
      if (again && attempt < RETRIES) {
        await sleep((attempt + 1) * 3_000);
        continue;
      }
      try {
        return { status: res.status, body: text ? JSON.parse(text) : null };
      } catch {
        return { status: res.status, body: text.slice(0, 600) };
      }
    }
  }

  const ok = (r: Reply, method: string, path: string): Any => {
    if (r.status < 200 || r.status >= 300)
      throw new Error(
        `GoHighLevel ${method} ${path.split("?")[0]} answered ${r.status}: ${brief(r.body)}`,
      );
    return r.body;
  };

  return {
    location: o.location,
    apply: o.apply,
    sendEnabled: o.sendEnabled,
    /** A read that returns whatever GoHighLevel answered. */
    read: (path: string) => call("GET", path),
    /** A read that must succeed. */
    readOk: async (path: string) => ok(await call("GET", path), "GET", path),
    /** A contact, opportunity or note write. Dry run unless HIRING_APPLY. */
    async write(method: "POST" | "PUT", path: string, body: unknown): Promise<Any> {
      if (!o.apply) {
        await o.health({ ...receipt(method, path), phase: "blocked" });
        throw new GateError(
          "Dry run: GoHighLevel writes are off on the server (HIRING_APPLY is not true), so nothing was written.",
        );
      }
      return ok(await call(method, path, body), method, path);
    },
    /** One message to one candidate. Refused unless HIRING_SEND_ENABLED. */
    async send(
      type: "Email" | "SMS" | "WhatsApp",
      contactId: string,
      payload: Record<string, unknown>,
    ): Promise<Any> {
      const path = "/conversations/messages";
      if (!o.sendEnabled) {
        await o.health({ ...receipt("POST", path), phase: "blocked" });
        throw new GateError(
          "Sending is off on the server (HIRING_SEND_ENABLED is not true), so nothing was sent.",
        );
      }
      return ok(
        await call("POST", path, { type, contactId, ...payload }, false),
        "POST",
        path,
      );
    },
  };
}

export type Typeform = ReturnType<typeof typeformClient>;

/** Typeform is only ever read. */
export function typeformClient(o: ClientDeps & { token: string }) {
  const doFetch = o.fetch ?? fetch;
  return {
    async get(path: string): Promise<Any> {
      const r = {
        provider: "typeform" as const,
        method: "GET",
        resource: path.split("?")[0],
      };
      await o.health({ ...r, phase: "intent" });
      let res: Response;
      try {
        res = await doFetch(`${TYPEFORM_BASE}${path}`, {
          headers: { Authorization: `Bearer ${o.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        });
      } catch (e) {
        const failure = brief(e instanceof Error ? e.message : String(e), 120);
        await o.health({ ...r, phase: "failed", error: failure });
        throw new Error(`Typeform could not be reached: ${failure}`);
      }
      const text = await res.text().catch(() => "");
      await o.health({ ...r, phase: "response", http_status: res.status });
      if (!res.ok)
        throw new Error(`Typeform GET ${r.resource} answered ${res.status}: ${brief(text)}`);
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Typeform GET ${r.resource} returned something that is not JSON.`);
      }
    },
  };
}
