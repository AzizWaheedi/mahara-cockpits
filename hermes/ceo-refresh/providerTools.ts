import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderTools, Row, Runtime } from "./runtime.ts";

export type Environment = Record<string, string | undefined>;
export type ProviderReceipt = {
  provider: string;
  method: "GET" | "POST";
  resource: string;
  phase: "response" | "failure";
  http_status: number | null;
  error?: string;
  section?: string;
};
export type ProviderDriverOptions = {
  env: Environment;
  fetcher: typeof fetch;
  apply: boolean;
};

const TRIAGE = "bldgtotkfmhoxmlzowdx";
const B2B = "flwboeijllbtrufxkhts";
const TRIAGE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const sectionContext = new AsyncLocalStorage<string>();
const WRITE_RPCS: Record<string, true> = {
  cockpit_ceo_refresh_claim: true,
  cockpit_ceo_worker_begin_finance_refresh: true,
  cockpit_ceo_refresh_publish: true,
  cockpit_ceo_refresh_fail: true,
};
const READ_POST_RPCS: Record<string, true> = {
  mahara_call_center_report: true,
  cockpit_finance_refresh_input: true,
};
const API_GET_HOSTS: Record<string, true> = {
  "api.clickup.com": true,
  "api.typeform.com": true,
  "graph.facebook.com": true,
  "services.leadconnectorhq.com": true,
  "www.googleapis.com": true,
  "youtube.googleapis.com": true,
  "bldgtotkfmhoxmlzowdx.supabase.co": true,
};

function actionableMissing(name: string, purpose: string): Error {
  return new Error(`${name} is missing. Configure ${name} for ${purpose}.`);
}

function safeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/https?:\/\/\S+/gi, "[provider]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [credential]")
    .replace(/\b(access_token|refresh_token|api_?key|secret|password|signature|sig)=([^&\s"']+)/gi, "$1=[credential]")
    .replace(/\b(?:sk_(?:test|live)_|eyJ)[A-Za-z0-9._-]{8,}/gi, "[credential]")
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .slice(0, 240);
}
function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

function resourceOf(url: URL): string {
  return `${url.hostname}${url.pathname}`.slice(0, 500);
}

function safePath(path: string, label: string): string {
  const clean = path.trim().replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\") || /[\r\n]/.test(clean)) {
    throw new Error(`${label} resource is not an approved read path`);
  }
  return clean;
}

function queryIsReadOnly(query: string): string {
  const sql = query.trim().replace(/;+\s*$/, "");
  const statement = sql.replace(/^(?:\s|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$))*/, "");
  if (!/^(select|with)\b/i.test(statement) || sql.includes(";")) {
    throw new Error("SQL source accepts one read-only SELECT statement");
  }
  return sql;
}

function decodeJson(response: Response, resource: string): Promise<unknown> {
  if (response.status === 204) return Promise.resolve(null);
  return response.json().catch(() => {
    throw new Error(`Provider returned invalid JSON for ${resource}`);
  });
}

export function withProviderSection<T>(section: string, run: () => Promise<T>): Promise<T> {
  return sectionContext.run(section, run);
}

export function createProviderDriver(options: ProviderDriverOptions): {
  tools: ProviderTools;
  read: Runtime["read"];
  env: Runtime["env"];
  receipts: ProviderReceipt[];
} {
  const { env, fetcher, apply } = options;
  const receipts: ProviderReceipt[] = [];
  let googleToken: { value: string; expiresAt: number } | null = null;

  const key = (name: string, purpose: string): string => {
    const value = env[name]?.trim();
    if (!value) throw actionableMissing(name, purpose);
    return value;
  };

  const saveReceipt = (receipt: ProviderReceipt): void => {
    const section = sectionContext.getStore();
    receipts.push(section ? { ...receipt, section } : receipt);
  };

  const send = async (
    provider: string,
    input: string | URL | Request,
    init: RequestInit | undefined,
    allowedPost?: { host: string; path: string; retryable?: boolean },
  ): Promise<Response> => {
    const requestUrl = input instanceof Request ? new URL(input.url) : new URL(String(input));
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const resource = resourceOf(requestUrl);
    if (requestUrl.protocol !== "https:" || requestUrl.username || requestUrl.password || requestUrl.port) {
      throw new Error("Provider URL is not an approved HTTPS endpoint");
    }
    const postAllowed = allowedPost?.host === requestUrl.hostname && allowedPost.path === requestUrl.pathname && method === "POST";
    const retryable = method === "GET" || (postAllowed && allowedPost?.retryable === true);
    if (method !== "GET" && !postAllowed) throw new Error("CEO refresh provider tools allow reads only");
    if (!API_GET_HOSTS[requestUrl.hostname] && !postAllowed) throw new Error("Provider host is not on the CEO read allowlist");
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetcher(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
      } catch (error) {
        const message = safeError(error);
        if (retryable && attempt < 2) {
          await delay(500 * (attempt + 1));
          continue;
        }
        saveReceipt({ provider, method: method as "GET" | "POST", resource, phase: "failure", http_status: null, error: message });
        throw new Error(message);
      }
      saveReceipt({ provider, method: method as "GET" | "POST", resource, phase: "response", http_status: response.status });
      if (response.ok) return response;
      const message = `${provider} returned HTTP ${response.status} for ${resource}`;
      if (retryable && attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        await delay(500 * (attempt + 1));
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      saveReceipt({ provider, method: method as "GET" | "POST", resource, phase: "failure", http_status: response.status, error: message });
      throw new Error(message);
    }
    throw new Error(`${provider} exhausted its bounded retry policy`);
  };

  const managementRead: Runtime["read"] = async (project, query): Promise<Row[]> => {
    if (project !== TRIAGE && project !== B2B) throw new Error("SQL source project is not approved");
    const token = key("SUPABASE_ACCESS_TOKEN", "read-only Supabase SQL access");
    const sql = queryIsReadOnly(query);
    const url = `https://api.supabase.com/v1/projects/${project}/database/query`;
    const resource = `api.supabase.com/v1/projects/${project}/database/query`;
    let response: Response | null = null;
    let lastError = "Supabase read-only SQL failed";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetcher(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: sql, read_only: true }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        lastError = safeError(error);
        if (attempt < 2) {
          await delay(500 * (attempt + 1));
          continue;
        }
        saveReceipt({ provider: "supabase-management", method: "POST", resource, phase: "failure", http_status: null, error: lastError });
        throw new Error(lastError);
      }
      saveReceipt({ provider: "supabase-management", method: "POST", resource, phase: "response", http_status: response.status });
      if (response.ok) break;
      lastError = `Supabase read-only SQL returned HTTP ${response.status}`;
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        response = null;
        await delay(500 * (attempt + 1));
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      saveReceipt({ provider: "supabase-management", method: "POST", resource, phase: "failure", http_status: response.status, error: lastError });
      throw new Error(lastError);
    }
    if (!response?.ok) throw new Error(lastError);
    let raw: unknown;
    try { raw = await decodeJson(response, resource); }
    catch (error) {
      const message = safeError(error);
      saveReceipt({ provider: "supabase-management", method: "POST", resource, phase: "failure", http_status: response.status, error: message });
      throw new Error(message);
    }
    if (!Array.isArray(raw) || raw.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
      const message = "Supabase read-only SQL returned no row collection";
      saveReceipt({ provider: "supabase-management", method: "POST", resource, phase: "failure", http_status: response.status, error: message });
      throw new Error(message);
    }
    return raw as Row[];
  };

  const graph: ProviderTools["graph"] = async (resource, params = {}): Promise<Row> => {
    const token = key("META_SYSTEM_TOKEN", "read-only Meta Graph access");
    const path = safePath(resource, "Meta");
    if (/[?#]/.test(path)) throw new Error("Meta resource must not contain query parameters");
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) query.set(name, String(value));
    query.set("access_token", token);
    const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
    url.search = query.toString();
    const response = await send("meta", url, { method: "GET", headers: { Accept: "application/json" } });
    const body = await decodeJson(response, "Meta Graph API");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Meta Graph API returned no object");
    const row = body as Row;
    if (row.error && typeof row.error === "object") {
      const code = (row.error as Row).code;
      throw new Error(`Meta Graph API error ${String(code ?? "unknown")}`);
    }
    return row;
  };

  const request: ProviderTools["request"] = async (input, init): Promise<Response> => {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const response = await send(url.hostname === "graph.facebook.com" ? "meta" : "google", input, init);
    if (method !== "GET") throw new Error("CEO refresh provider tools allow reads only");
    return response;
  };

  const clickup: ProviderTools["clickup"] = async (resource): Promise<Row> => {
    const token = key("CLICKUP_API_TOKEN", "read-only ClickUp board access");
    const path = safePath(resource, "ClickUp");
    const response = await send("clickup", `https://api.clickup.com/api/v2/${path}`, {
      method: "GET", headers: { Authorization: token, Accept: "application/json" },
    });
    const body = await decodeJson(response, "ClickUp API");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("ClickUp returned no object");
    return body as Row;
  };

  const typeform: ProviderTools["typeform"] = async (resource): Promise<Row> => {
    const token = key("TYPEFORM_TOKEN", "read-only Typeform response access");
    const url = new URL(resource);
    if (url.hostname !== "api.typeform.com" || !/^\/forms\/[A-Za-z0-9]+\/responses$/.test(url.pathname)) {
      throw new Error("Typeform resource is not an approved response read");
    }
    const response = await send("typeform", url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const body = await decodeJson(response, "Typeform API");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Typeform returned no object");
    return body as Row;
  };

  const hiring: ProviderTools["hiring"] = async (resource): Promise<Row> => {
    const token = key("GHL_HIRING_PIT", "read-only GoHighLevel hiring access");
    key("GHL_HIRING_LOCATION", "GoHighLevel hiring location");
    const path = safePath(resource, "GoHighLevel");
    const response = await send("ghl", `https://services.leadconnectorhq.com${path.startsWith("/") ? path : `/${path}`}`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
    });
    const body = await decodeJson(response, "GoHighLevel API");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("GoHighLevel returned no object");
    return body as Row;
  };

  const youtubeToken: ProviderTools["youtubeToken"] = async (): Promise<string> => {
    if (googleToken && googleToken.expiresAt - Date.now() > 60_000) return googleToken.value;
    const raw = key("GOOGLE_SERVICE_ACCOUNT_JSON", "read-only YouTube channel access");
    let account: { client_email?: string; private_key?: string };
    try { account = JSON.parse(raw) as typeof account; }
    catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON; replace it with the service-account JSON contents"); }
    if (!account.client_email || !account.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key fields");
    const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
    const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    let keyBytes: Uint8Array;
    try { keyBytes = Buffer.from(pem, "base64"); }
    catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON private_key is malformed"); }
    const now = Math.floor(Date.now() / 1000);
    const head = encode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claim = encode(new TextEncoder().encode(JSON.stringify({
      iss: account.client_email,
      scope: GOOGLE_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })));
    const signingInput = `${head}.${claim}`;
    let cryptoKey: CryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON private_key cannot be imported"); }
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput));
    const assertion = `${signingInput}.${encode(new Uint8Array(signature))}`;
    const response = await send("google-oauth", "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    }, { host: "oauth2.googleapis.com", path: "/token" });
    const body = await decodeJson(response, "Google OAuth token endpoint");
    if (!body || typeof body !== "object" || typeof (body as Row).access_token !== "string") {
      throw new Error("Google OAuth did not return an access token");
    }
    const token = String((body as Row).access_token);
    googleToken = { value: token, expiresAt: Date.now() + Number((body as Row).expires_in ?? 3600) * 1000 };
    return token;
  };

  const rest: ProviderTools["rest"] = async (resource, body): Promise<unknown> => {
    const base = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
    if (base !== TRIAGE_URL) throw actionableMissing("SUPABASE_URL", `the fixed Creative Triage project ${TRIAGE}`);
    const serviceKey = key("SUPABASE_SERVICE_ROLE_KEY", "native Creative Triage reads and writes");
    const path = safePath(resource, "Supabase REST");
    const isRpc = path.startsWith("rpc/");
    const rpcName = isRpc ? path.slice(4).split("?", 1)[0] : "";
    const method = body === undefined ? "GET" : "POST";
    if (!isRpc && !/^cockpit_[A-Za-z0-9_]+(?:\?|$)/.test(path)) throw new Error("Supabase REST resource is not an approved cockpit relation");
    if (method === "POST" && !READ_POST_RPCS[rpcName] && !WRITE_RPCS[rpcName]) throw new Error("Supabase REST writes are not approved for this worker");
    if (method === "POST" && WRITE_RPCS[rpcName] && !apply) throw new Error("Native CEO writes require explicit --apply");
    const url = `${base}/rest/v1/${path}`;
    const init: RequestInit = {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    const response = await send("supabase", url, init, method === "POST" ? { host: "bldgtotkfmhoxmlzowdx.supabase.co", path: new URL(url).pathname, retryable: true } : undefined);
    return decodeJson(response, resource);
  };

  const tools: ProviderTools = { graph, request, clickup, typeform, hiring, youtubeToken, rest };
  const runtimeEnv: Runtime["env"] = name => env[name];
  return { tools, read: managementRead, env: runtimeEnv, receipts };
}
