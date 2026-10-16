/**
 * Meta Graph reads for meta-ad-days: the one transport, GET only.
 *
 * Every call is receipted before it is sent (intent) and after (response, or
 * unknown when Meta did not answer), the same discipline as
 * cockpit-ceo-api/tools.ts metaGraph and cockpit-media-api/tools.ts. The
 * receipts land in cockpit_meta_ad_day_receipts. The token is the function
 * secret META_SYSTEM_TOKEN, read by name, sent only in the Authorization
 * header (never in a URL, so it cannot reach a receipt or a paging link), and
 * scrubbed from any error text Meta echoes.
 *
 * The version is pinned here and is not read from META_GRAPH_VERSION: the
 * other callers default to v21.0, which Meta's versions page lists as expired
 * for the Marketing API on 2025-09-09 (an expired version is served by a newer
 * one, so its fields can change without notice). v25.0 is the supported
 * Marketing API version. Read-only checks on 2026-10-16: both business edges
 * listed the same 59 ad accounts, 28 with spend over 30 days, on v21.0 and
 * v25.0; a 7-day ad-level read of one account parsed to the same 10 rows on
 * both; and v25.0's ad-level rows summed to Meta's account-level spend,
 * impressions, link clicks and leads to the cent on 5 accounts.
 */

export const GRAPH_VERSION = "v25.0";
export const GRAPH_HOST = "https://graph.facebook.com";
/** Mahara Media's business manager: its owned and client ad accounts. */
export const MAHARA_BUSINESS_ID = "767701513092162";

export type Row = Record<string, unknown>;

export type Receipt = {
  provider: "meta";
  method: "GET";
  resource: string;
  phase: "intent" | "response" | "unknown";
  http_status?: number | null;
  error?: string | null;
};
export type Health = (receipt: Receipt) => Promise<void>;

export type GraphDeps = {
  /** META_SYSTEM_TOKEN, read by name; empty when it is not set. */
  token: () => string;
  fetch: typeof fetch;
  health: Health;
  /** Per call; Meta's heavy insights reads answer in 2 to 15 seconds. */
  timeoutMs?: number;
};

/**
 * What went wrong, in the terms the run acts on:
 *   config      the token is not set or a path is not allowed (nothing was sent)
 *   token       Meta refused the token (190 and its kin): only a new token helps
 *   permission  the account is not shared with the system user (10, 200s, 100/33)
 *   rate        Meta's rate limits (4, 17, 32, 613, 80000s): wait for a later run
 *   heavy       Meta could not build the answer in time (1, 2, a 5xx, or no answer):
 *               ask for fewer days at a time
 *   other       anything else Meta said no to
 */
export type MetaErrorKind = "config" | "token" | "permission" | "rate" | "heavy" | "other";

export class MetaError extends Error {
  kind: MetaErrorKind;
  code: number | null;
  subcode: number | null;
  status: number | null;
  constructor(kind: MetaErrorKind, message: string, extra: { code?: number | null; subcode?: number | null; status?: number | null } = {}) {
    super(message);
    this.name = "MetaError";
    this.kind = kind;
    this.code = extra.code ?? null;
    this.subcode = extra.subcode ?? null;
    this.status = extra.status ?? null;
  }
}

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** The reads this function makes, and nothing else. */
const ALLOWED_PATH = new RegExp(`^(?:me|act_[0-9]{5,25}(?:/insights)?|${MAHARA_BUSINESS_ID}/(?:owned_ad_accounts|client_ad_accounts))$`);

export function classify(code: number | null, subcode: number | null, status: number | null, message: string): MetaErrorKind {
  if (code === 190 || code === 102 || code === 463 || code === 467) return "token";
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== null && code >= 80000 && code <= 80014)) return "rate";
  if (code === 10 || (code !== null && code >= 200 && code <= 299) || (code === 100 && subcode === 33)) return "permission";
  if (code === 1 || code === 2 || /reduce the amount of data/i.test(message) || (status !== null && status >= 500)) return "heavy";
  return "other";
}

/** Meta's error text with the token and any bearer value taken out, cut to fit a receipt. */
export function scrub(text: string, token: string): string {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").slice(0, 240);
}

/** One GET. Throws MetaError; returns Meta's JSON object. */
export async function metaGet(deps: GraphDeps, path: string, params: Record<string, string | number>): Promise<Row> {
  const receipt = { provider: "meta" as const, method: "GET" as const, resource: path };
  const token = deps.token().trim();
  if (!ALLOWED_PATH.test(path)) {
    throw new MetaError("config", "meta-ad-days only reads ad accounts, their insights and the business's account lists.");
  }
  // Nothing is sent without a token, so there is no receipt: the run's note says it.
  if (!token) throw new MetaError("config", "META_SYSTEM_TOKEN is not set on meta-ad-days. Set Mahara's Meta system-user token as a function secret.");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  await deps.health({ ...receipt, phase: "intent" });
  let response: Response;
  try {
    response = await deps.fetch(`${GRAPH_HOST}/${GRAPH_VERSION}/${path}?${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 45_000),
    });
  } catch (e) {
    await deps.health({ ...receipt, phase: "unknown", error: scrub(e instanceof Error ? e.message : String(e), token) });
    throw new MetaError("heavy", `Meta did not answer ${path} in time.`);
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const err = isRow(parsed) && isRow(parsed.error) ? parsed.error : null;
  const code = err && typeof err.code === "number" ? err.code : null;
  const subcode = err && typeof err.error_subcode === "number" ? err.error_subcode : null;
  const message = err && typeof err.message === "string" ? scrub(err.message, token) : "";
  await deps.health({
    ...receipt,
    phase: "response",
    http_status: response.status,
    error: err ? scrub(`${code ?? "?"}${subcode ? `/${subcode}` : ""} ${message}`, token) : !response.ok ? `HTTP ${response.status}` : null,
  });
  if (err || !response.ok) {
    const kind = classify(code, subcode, response.status, message);
    const tag = code !== null ? `code ${code}${subcode ? `/${subcode}` : ""}` : `HTTP ${response.status}`;
    throw new MetaError(kind, `Meta refused ${path} (${tag})${message ? `: ${message}` : ""}.`, { code, subcode, status: response.status });
  }
  if (!isRow(parsed)) throw new MetaError("other", `Meta answered ${path} with something that is not JSON (HTTP ${response.status}).`, { status: response.status });
  return parsed;
}

/**
 * Every page of a list read, by Meta's `after` cursor on the same path and
 * parameters (never by following `paging.next`, which would carry whatever
 * Meta put in it). Stops at `maxPages` with an error rather than a silent
 * partial list.
 */
export async function metaPages(deps: GraphDeps, path: string, params: Record<string, string | number>, maxPages = 40): Promise<Row[]> {
  const out: Row[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const body = await metaGet(deps, path, after ? { ...params, after } : params);
    if (!Array.isArray(body.data)) throw new MetaError("other", `Meta answered ${path} without a data list.`);
    for (const item of body.data) {
      if (!isRow(item)) throw new MetaError("other", `Meta answered ${path} with a row that is not an object.`);
      out.push(item);
    }
    const paging = isRow(body.paging) ? body.paging : null;
    if (!paging?.next) return out;
    const cursors = isRow(paging.cursors) ? paging.cursors : null;
    const next = cursors && typeof cursors.after === "string" && cursors.after ? cursors.after : null;
    if (!next) throw new MetaError("other", `Meta said ${path} has another page but gave no cursor; nothing partial was kept.`);
    if (next === after) throw new MetaError("other", `Meta gave the same cursor twice for ${path}; nothing partial was kept.`);
    after = next;
  }
  throw new MetaError("other", `${path} has more than ${maxPages} pages; nothing partial was kept.`);
}
