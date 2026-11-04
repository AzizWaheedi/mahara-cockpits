/**
 * I/O for the CSM calls worker: keys read by name, one transport for every
 * provider read (receipts land in cockpit_csm_provider_health), and the
 * Supabase REST helpers it publishes through. Providers are read-only here:
 * the transport refuses any non-GET to a provider host.
 */
import type { Row } from "./match";

export type Env = Record<string, string | undefined>;
export const REF = "bldgtotkfmhoxmlzowdx";
export const SUPABASE = `https://${REF}.supabase.co`;
export const REQUIRED = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "GHL_CLIENT_PIT",
  "FATHOM_API_KEY",
  "TYPEFORM_TOKEN",
  "META_SYSTEM_TOKEN",
  "SLACK_BOT_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

const PROVIDERS: Record<string, string> = {
  "services.leadconnectorhq.com": "ghl",
  "api.fathom.ai": "fathom",
  "api.typeform.com": "typeform",
  "graph.facebook.com": "meta",
  "sheets.googleapis.com": "google",
  "slack.com": "slack",
};
/** The EOD Reports sheet: the only spreadsheet this worker may read. */
export const EOD_SHEET = "1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw";

/** The Fathom paths this worker may read: the meetings list, and one recording's summary or transcript. */
export function fathomPathAllowed(pathname: string): boolean {
  return pathname === "/external/v1/meetings" || /^\/external\/v1\/recordings\/\d+\/(summary|transcript)$/.test(pathname);
}

export type Receipt = {
  method: string;
  resource: string;
  phase: string;
  http_status?: number;
  provider: string;
  run_key: string;
};

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function makeTransport(
  env: Env,
  runKey: string,
  request: typeof fetch = fetch,
  wait = (ms: number) => new Promise(r => setTimeout(r, ms)),
) {
  const receipts: Receipt[] = [];
  let fathomChain: Promise<void> = Promise.resolve();
  let requests = 0;
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing named key: ${k}`);
    return v;
  };
  async function get(url: string, headers: Record<string, string>): Promise<any> {
    const u = new URL(url);
    const provider = PROVIDERS[u.hostname];
    if (!provider || u.protocol !== "https:") throw new Error("Unapproved provider URL");
    if (provider === "fathom" && !fathomPathAllowed(u.pathname))
      throw new Error("Only Fathom meetings and recording summaries or transcripts are permitted");
    if (provider === "google" && !u.pathname.startsWith(`/v4/spreadsheets/${EOD_SHEET}`))
      throw new Error("Only the EOD Reports sheet is permitted");
    if (provider === "slack" && u.pathname !== "/api/conversations.history")
      throw new Error("Only Slack conversations.history is permitted");
    if (++requests > 4000) throw new Error("Read budget exhausted");
    const resource = u.hostname + u.pathname.replace(/\/(act_)?\d{6,}/g, "/$1:id").replace(/\/contacts\/[A-Za-z0-9]+/, "/contacts/:id");
    for (let attempt = 1; attempt <= 3; attempt++) {
      let release: (() => void) | undefined;
      if (provider === "fathom") {
        const prior = fathomChain;
        fathomChain = new Promise<void>(r => (release = r));
        await prior;
        await wait(1500);
      }
      receipts.push({ method: "GET", resource, phase: "intent", provider, run_key: runKey });
      try {
        const res = await request(u.href, {
          headers: { ...headers, Accept: "application/json", "User-Agent": "Mozilla/5.0 Mahara-CSM-Calls" },
          redirect: "error",
          signal: AbortSignal.timeout(45_000),
        });
        receipts.push({ method: "GET", resource, phase: "response", http_status: res.status, provider, run_key: runKey });
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await res.body?.cancel().catch(() => {});
          const ra = Number(res.headers.get("retry-after"));
          await wait(Number.isFinite(ra) && ra > 0 && ra < 60 ? ra * 1000 : attempt * 2000);
          continue;
        }
        const text = await res.text();
        if (!res.ok)
          throw new ProviderError(provider, res.status, `${provider} refused ${resource} (${res.status})`);
        let body: any;
        try {
          body = JSON.parse(text);
        } catch {
          throw new ProviderError(provider, res.status, `${provider} answered ${res.status} without JSON at ${resource}`);
        }
        if (body && typeof body === "object" && body.error && provider === "meta")
          throw new ProviderError(provider, res.status, `meta answered 200 with an error at ${resource}`);
        if (provider === "slack" && body?.ok !== true)
          throw new ProviderError(provider, res.status, `slack refused ${resource}: ${String(body?.error ?? "no ok flag")}`);
        return body;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        receipts.push({ method: "GET", resource, phase: "unknown", provider, run_key: runKey });
        if (attempt < 3) {
          await wait(attempt * 1500);
          continue;
        }
        throw new ProviderError(provider, 0, `${provider} unreachable at ${resource}`);
      } finally {
        release?.();
      }
    }
    throw new ProviderError(provider, 0, `${provider} read attempts exhausted`);
  }
  // Google: a read-only service-account token, minted once per run. The token
  // exchange is the only POST this worker makes to a non-Supabase host.
  let googleToken: string | undefined;
  async function google(): Promise<string> {
    if (googleToken) return googleToken;
    const { readFileSync } = await import("node:fs");
    const { createSign } = await import("node:crypto");
    const account = JSON.parse(readFileSync(need("GOOGLE_APPLICATION_CREDENTIALS"), "utf8"));
    if (account.type !== "service_account" || !account.client_email || !account.private_key)
      throw new ProviderError("google", 0, "The Google service account file is not a service account");
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const sig = createSign("RSA-SHA256").update(unsigned).sign(account.private_key).toString("base64url");
    receipts.push({ method: "POST", resource: "oauth2.googleapis.com/token", phase: "intent", provider: "google", run_key: runKey });
    const res = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    receipts.push({ method: "POST", resource: "oauth2.googleapis.com/token", phase: "response", http_status: res.status, provider: "google", run_key: runKey });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.access_token !== "string")
      throw new ProviderError("google", res.status, `google token exchange refused (${res.status})`);
    return (googleToken = body.access_token);
  }
  return {
    receipts,
    sheet: async (range: string) =>
      get(`https://sheets.googleapis.com/v4/spreadsheets/${EOD_SHEET}/values/${encodeURIComponent(range)}`, {
        Authorization: `Bearer ${await google()}`,
      }),
    sheetTabs: async () =>
      get(`https://sheets.googleapis.com/v4/spreadsheets/${EOD_SHEET}?fields=sheets.properties.title`, {
        Authorization: `Bearer ${await google()}`,
      }),
    slackHistory: (params: Record<string, string>) =>
      get(`https://slack.com/api/conversations.history?${new URLSearchParams(params)}`, {
        Authorization: `Bearer ${need("SLACK_BOT_TOKEN")}`,
      }),
    ghl: (path: string, params: Record<string, string>, version: string) =>
      get(`https://services.leadconnectorhq.com/${path}?${new URLSearchParams(params)}`, {
        Authorization: `Bearer ${need("GHL_CLIENT_PIT")}`,
        Version: version,
      }),
    fathom: (params: URLSearchParams) =>
      get(`https://api.fathom.ai/external/v1/meetings?${params}`, { "X-Api-Key": need("FATHOM_API_KEY") }),
    /** One recording's summary or transcript (a heavy read: Fathom allows 10 a minute per key). */
    fathomRecording: (id: string, part: "summary" | "transcript") => {
      if (!/^\d{3,20}$/.test(String(id))) throw new Error("A Fathom recording id is 3 to 20 digits");
      if (part !== "summary" && part !== "transcript") throw new Error("Only a recording's summary or transcript can be read");
      return get(`https://api.fathom.ai/external/v1/recordings/${id}/${part}`, { "X-Api-Key": need("FATHOM_API_KEY") });
    },
    typeform: (path: string, params: Record<string, string> = {}) =>
      get(`https://api.typeform.com/${path}${Object.keys(params).length ? "?" + new URLSearchParams(params) : ""}`, {
        Authorization: `Bearer ${need("TYPEFORM_TOKEN")}`,
      }),
    meta: (path: string, params: Record<string, string>) =>
      get(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams(params)}`, {
        Authorization: `Bearer ${need("META_SYSTEM_TOKEN")}`,
      }),
    metaNext: (next: string) => {
      const u = new URL(next);
      if (u.hostname !== "graph.facebook.com") throw new Error("Unexpected Meta pagination host");
      u.searchParams.delete("access_token");
      return get(u.href, { Authorization: `Bearer ${need("META_SYSTEM_TOKEN")}` });
    },
  };
}
export type Transport = ReturnType<typeof makeTransport>;

/** Service-key REST against Creative Triage. Writes only happen in --apply runs. */
export function makeDb(env: Env, request: typeof fetch = fetch) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing named key: SUPABASE_SERVICE_ROLE_KEY");
  const base = (env.SUPABASE_URL ?? SUPABASE).replace(/\/$/, "");
  if (base !== SUPABASE) throw new Error("SUPABASE_URL must identify Creative Triage");
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await request(`${base}${path}`, {
      method,
      headers: { ...h, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]} failed (${res.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  /** PostgREST bulk writes need one key set; group by it instead of null-filling (which would overwrite). */
  const groups = (rows: Row[]) => {
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      const k = Object.keys(r).sort().join(",");
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.values()];
  };
  return {
    /** Every row of a select, paged by Range so nothing is silently cut. */
    async all(table: string, query: string): Promise<Row[]> {
      const out: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const page = await call("GET", `/rest/v1/${table}?${query}`, undefined, { Range: `${from}-${from + 999}`, "Range-Unit": "items" });
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async upsert(table: string, rows: Row[], onConflict: string) {
      for (const g of groups(rows))
        for (let i = 0; i < g.length; i += 200)
          await call("POST", `/rest/v1/${table}?on_conflict=${onConflict}`, g.slice(i, i + 200), {
            Prefer: "resolution=merge-duplicates,return=minimal",
          });
    },
    async insert(table: string, rows: Row[]) {
      for (const g of groups(rows))
        for (let i = 0; i < g.length; i += 500)
          await call("POST", `/rest/v1/${table}`, g.slice(i, i + 500), { Prefer: "return=minimal" });
    },
    async patch(table: string, filter: string, values: Row) {
      await call("PATCH", `/rest/v1/${table}?${filter}`, values, { Prefer: "return=minimal" });
    },
    async insertReturning(table: string, rows: Row[], onConflict: string): Promise<Row[]> {
      const out: Row[] = [];
      for (const g of groups(rows))
        for (let i = 0; i < g.length; i += 200)
          out.push(
            ...(await call("POST", `/rest/v1/${table}?on_conflict=${onConflict}&select=id,source,source_id`, g.slice(i, i + 200), {
              Prefer: "resolution=merge-duplicates,return=representation",
            })),
          );
      return out;
    },
    async storage(path: string, content: string) {
      const res = await request(`${base}/storage/v1/object/csm-call-transcripts/${path}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "text/plain; charset=utf-8", "x-upsert": "true" },
        body: content,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Transcript upload failed (${res.status})`);
    },
    /** Removes one transcript object. An object that is not there counts as removed. */
    async storageRemove(path: string) {
      if (!/^fathom\/\d{1,20}\.txt$/.test(path)) throw new Error("Only a Fathom transcript object can be removed");
      const res = await request(`${base}/storage/v1/object/csm-call-transcripts/${path}`, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text().catch(() => "");
      // Storage answers a missing object with 404, or with 400 and statusCode 404 in the body.
      if (res.ok || res.status === 404 || (res.status === 400 && /"statusCode"\s*:\s*"?404\b/.test(text))) return;
      throw new Error(`Transcript removal failed (${res.status})`);
    },
    async ping() {
      await call("GET", "/rest/v1/cockpit_sync_state?select=key&limit=1");
      return true;
    },
    /**
     * One cockpit service RPC (POST /rest/v1/rpc/{name}), its answer as JSON. Only cockpit_ functions: the
     * forms record sweep (docs/forms/STAGE2B-CONTRACT.md 4.8) is the first caller.
     */
    async rpc(name: string, args: Row = {}): Promise<any> {
      if (!/^cockpit_[a-z0-9_]+$/.test(name)) throw new Error("Only a cockpit_ function can be called");
      return call("POST", `/rest/v1/rpc/${name}`, args);
    },
  };
}
export type Db = ReturnType<typeof makeDb>;

export type Health = {
  key: string;
  ok: boolean;
  note: string;
  rows: number;
  detail: Row;
};

/** One cockpit_sync_state row per source; last_ok_at moves only on success. */
export async function writeHealth(db: Db, h: Health, now = new Date()) {
  const row: Row = {
    key: h.key,
    last_run_at: now.toISOString(),
    ok: h.ok,
    note: h.note.slice(0, 500),
    rows_seen: h.rows,
    detail: h.detail,
    updated_at: now.toISOString(),
  };
  if (h.ok) row.last_ok_at = now.toISOString();
  await db.upsert("cockpit_sync_state", [row], "key");
}
