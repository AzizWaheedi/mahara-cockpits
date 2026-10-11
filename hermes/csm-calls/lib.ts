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
];

const PROVIDERS: Record<string, string> = {
  "services.leadconnectorhq.com": "ghl",
  "api.fathom.ai": "fathom",
  "api.typeform.com": "typeform",
  "graph.facebook.com": "meta",
};

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
    if (provider === "fathom" && u.pathname !== "/external/v1/meetings")
      throw new Error("Only Fathom /external/v1/meetings is permitted");
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
  return {
    receipts,
    ghl: (path: string, params: Record<string, string>, version: string) =>
      get(`https://services.leadconnectorhq.com/${path}?${new URLSearchParams(params)}`, {
        Authorization: `Bearer ${need("GHL_CLIENT_PIT")}`,
        Version: version,
      }),
    fathom: (params: URLSearchParams) =>
      get(`https://api.fathom.ai/external/v1/meetings?${params}`, { "X-Api-Key": need("FATHOM_API_KEY") }),
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
    async ping() {
      await call("GET", "/rest/v1/cockpit_sync_state?select=key&limit=1");
      return true;
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
