declare const process: { env: Record<string, string | undefined> };

/**
 * Integration layer.
 *
 * Every ClickUp, Google Sheets, Typeform, Supabase, Slack and AI call in the app
 * goes through `callTool("<tool_name>", args)`. On Viktor that was a proxy to the
 * Viktor Spaces tool gateway. Outside Viktor each tool name is served here
 * directly, with this deployment's own credentials, and the call sites are
 * untouched. Env vars (set with `bunx convex env set NAME value`):
 *
 *   CLICKUP_API_TOKEN            pd_clickup_proxy_get / pd_clickup_proxy_post
 *   GOOGLE_SERVICE_ACCOUNT_JSON  pd_google_sheets_proxy_get / _post (share the
 *                                sheets with the service account's email)
 *   TYPEFORM_TOKEN               pd_typeform_proxy_get
 *   SUPABASE_ACCESS_TOKEN        mcp_supabase_execute_sql (management API token)
 *   SLACK_BOT_TOKEN              coworker_send_slack_message (chat:write scope)
 *   ANTHROPIC_API_KEY            ai_structured_output, quick_ai_search
 *   ANTHROPIC_MODEL              optional, defaults to claude-opus-5
 *   META_SYSTEM_TOKEN            graph() / graphPost() and the mcp_meta_ads_* tools
 */

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set on this Convex deployment`);
  }
  return value;
}

// biome-ignore lint/suspicious/noExplicitAny: HTTP bodies are untyped
async function bodyOf(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function brief(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return String(s ?? "").slice(0, 400);
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Google Sheets allows 60 reads a minute per user and the service account is
 * one user. A 15-minute run reads about 90 ranges, so a burst can trip it
 * (2026-09-10: every client "lost" its sheet for one run). Wait and retry
 * on 429 and on 5xx instead of failing the whole run.
 */
async function httpGet(url: string, headers: Record<string, string>) {
  const retry = /googleapis\.com/.test(url) ? 4 : 1;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if ((res.status === 429 || res.status >= 500) && attempt < retry - 1) {
      await wait((attempt + 1) * 15_000);
      continue;
    }
    const body = await bodyOf(res);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${brief(body)}`);
    return body;
  }
}

async function httpPost(
  url: string,
  headers: Record<string, string>,
  json: unknown,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(json ?? {}),
  });
  const body = await bodyOf(res);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${brief(body)}`);
  return body;
}

// ---------------------------------------------------------------------------
// Google: service-account JWT → short-lived access token (cached per isolate).

function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

let googleToken: { token: string; expiresAt: number } | null = null;

export async function googleAccessToken(): Promise<string> {
  if (googleToken && googleToken.expiresAt > Date.now() + 60_000) {
    return googleToken.token;
  }
  const sa = JSON.parse(env("GOOGLE_SERVICE_ACCOUNT_JSON")) as {
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope:
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/calendar.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await bodyOf(res);
  if (!res.ok || !json?.access_token) {
    throw new Error(`Google token exchange failed: ${brief(json)}`);
  }
  googleToken = {
    token: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  };
  return googleToken.token;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API (raw HTTP: the Convex default runtime has no Node).

// biome-ignore lint/suspicious/noExplicitAny: API payloads are untyped
async function anthropic(body: Record<string, unknown>): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5",
      max_tokens: 16000,
      ...body,
    }),
  });
  const json = await bodyOf(res);
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${brief(json)}`);
  if (json?.stop_reason === "refusal") {
    throw new Error("Anthropic declined the request");
  }
  return json;
}

// biome-ignore lint/suspicious/noExplicitAny: message content is untyped
function textOf(message: any): string {
  return ((message?.content ?? []) as any[])
    .filter(b => b?.type === "text")
    .map(b => String(b.text ?? ""))
    .join("");
}

/** Structured outputs need every object closed and every property required. */
// biome-ignore lint/suspicious/noExplicitAny: JSON schema
function strictSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(strictSchema);
  const out: Record<string, unknown> = { ...schema };
  if (schema.type === "object" && schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      props[k] = strictSchema(v);
    }
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  if (schema.items) out.items = strictSchema(schema.items);
  return out;
}

// ---------------------------------------------------------------------------

/** Objects and arrays go to the Graph API as JSON strings. */
function graphParams(
  args: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

export async function callTool<T>(
  role: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  // biome-ignore lint/suspicious/noExplicitAny: tool results are untyped
  const result: any = await dispatch(role, args);
  return result as T;
}

async function dispatch(
  role: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (role) {
    // --- ClickUp
    case "pd_clickup_proxy_get":
      return httpGet(String(args.url), {
        Authorization: env("CLICKUP_API_TOKEN"),
      });
    case "pd_clickup_proxy_post":
      return httpPost(
        String(args.url),
        { Authorization: env("CLICKUP_API_TOKEN") },
        args.json_body,
      );
    case "pd_clickup_proxy_put": {
      const res = await fetch(String(args.url), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: env("CLICKUP_API_TOKEN"),
        },
        body: JSON.stringify(args.json_body ?? {}),
      });
      const body = await bodyOf(res);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${args.url}: ${brief(body)}`);
      }
      return body;
    }

    // --- Google Sheets
    case "pd_google_sheets_proxy_get":
      return httpGet(String(args.url), {
        Authorization: `Bearer ${await googleAccessToken()}`,
      });
    case "pd_google_sheets_proxy_post":
      return httpPost(
        String(args.url),
        { Authorization: `Bearer ${await googleAccessToken()}` },
        args.json_body,
      );

    // --- Typeform
    case "pd_typeform_proxy_get":
      return httpGet(String(args.url), {
        Authorization: `Bearer ${env("TYPEFORM_TOKEN")}`,
      });

    // --- Supabase (management API, read-only SQL)
    case "mcp_supabase_execute_sql": {
      const ref = String(args.project_id ?? env("SUPABASE_PROJECT_REF"));
      const rows = await httpPost(
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        { Authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}` },
        { query: String(args.query), read_only: true },
      );
      return { result: JSON.stringify(rows) };
    }

    // --- Meta Marketing API
    case "mcp_meta_ads_list_ad_sets": {
      const parent = String(args.campaign_id ?? args.ad_account_id);
      return graph(`${parent}/adsets`, {
        fields: "id,name,status,campaign_id,daily_budget",
        limit: Number(args.limit ?? 25),
      });
    }
    case "mcp_meta_ads_get_ad_set":
      return graph(String(args.ad_set_id), {
        fields:
          "id,name,status,campaign_id,targeting,optimization_goal,billing_event,promoted_object,daily_budget,bid_strategy",
      });
    case "mcp_meta_ads_create_campaign": {
      const { ad_account_id, ...rest } = args;
      // Meta rejects a campaign create without this flag ("Invalid parameter",
      // subcode 4834011). Every launch from the cockpit failed on it until
      // 2026-09-11. Ad-set budgets stay per ad set, as the builder assumes.
      return graphPost(`${ad_account_id}/campaigns`, {
        is_adset_budget_sharing_enabled: "false",
        ...graphParams(rest),
      });
    }
    case "mcp_meta_ads_create_ad_set": {
      const { ad_account_id, ...rest } = args;
      return graphPost(`${ad_account_id}/adsets`, graphParams(rest));
    }

    // --- Slack
    case "coworker_send_slack_message": {
      if (args.do_send === false) return { skipped: true };
      const json = await httpPost(
        "https://slack.com/api/chat.postMessage",
        { Authorization: `Bearer ${env("SLACK_BOT_TOKEN")}` },
        {
          channel: args.channel_id,
          blocks: args.blocks,
          text: args.text ?? "Message from the cockpit",
        },
      );
      if (!json?.ok) throw new Error(`Slack: ${json?.error ?? brief(json)}`);
      return { ok: true, message_ts: json.ts, channel: json.channel };
    }

    // --- AI
    case "ai_structured_output": {
      const message = await anthropic({
        messages: [{ role: "user", content: String(args.prompt) }],
        output_config: {
          format: {
            type: "json_schema",
            schema: strictSchema(args.output_schema),
          },
        },
      });
      return JSON.parse(textOf(message));
    }
    case "quick_ai_search": {
      const question = String(args.search_question ?? args.query ?? "");
      // biome-ignore lint/suspicious/noExplicitAny: message params
      const messages: any[] = [
        {
          role: "user",
          content: `${question}\n\nSearch the web and answer with the key facts and the sources you used.`,
        },
      ];
      let message = await anthropic({
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        ],
        messages,
      });
      for (let i = 0; i < 3 && message.stop_reason === "pause_turn"; i++) {
        messages.push({ role: "assistant", content: message.content });
        message = await anthropic({
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 5 },
          ],
          messages,
        });
      }
      return { search_response: textOf(message) };
    }
    case "text2im":
      throw new Error("Image generation is not available in the cockpit");

    default:
      throw new Error(`Unknown tool "${role}": no direct client configured`);
  }
}

/** Tool results arrive either as objects or as JSON in a `content` string. */
// biome-ignore lint/suspicious/noExplicitAny: tool payloads are untyped
export function unwrap(raw: any): any {
  let out = raw;
  if (out && typeof out.content === "string") {
    try {
      out = JSON.parse(out.content);
    } catch {
      return out.content;
    }
  } else if (out && typeof out.content === "object" && out.content !== null) {
    out = out.content;
  }
  if (out && typeof out === "object" && "body" in out) {
    out = out.body;
  }
  return out;
}

/**
 * Run read-only SQL against the Creative Triage Supabase project — the systems
 * manager's dashboard database. It is the only source that has Meta account and
 * campaign ids, plus creative thumbnails, for every client account, including the
 * ones not shared with our Meta partner id.
 */
export async function supabaseQuery(
  sql: string,
): Promise<Record<string, unknown>[]> {
  const raw = await callTool<unknown>("mcp_supabase_execute_sql", {
    query: sql,
    project_id: "bldgtotkfmhoxmlzowdx",
  });
  const un = unwrap(raw);
  const text = typeof un?.result === "string" ? un.result : JSON.stringify(un);
  // The tool wraps rows in an <untrusted-data-…> fence; take the JSON array.
  const match = /(\[[\s\S]*\])/.exec(text);
  return match ? JSON.parse(match[1]) : [];
}

/**
 * Direct Meta Graph API call using the MaharaMedia system-user token.
 *
 * The OAuth `meta_ads` connection only ever exposed 13 of the business's ad
 * accounts; the system-user token sees all 45 (3 owned + 42 client). It also
 * bypasses the Viktor tool gateway entirely, so Meta data keeps flowing when
 * the gateway is down. Falls back to the gateway only if the token is unset.
 */
export async function graph<T = any>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN not set");
  const qs = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
    access_token: token,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}?${qs}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(
      `Meta ${json.error.code}${json.error.error_subcode ? `/${json.error.error_subcode}` : ""}: ${json.error.message}${json.error.error_user_msg ? ` — ${json.error.error_user_msg}` : ""}${json.error.error_user_title ? ` (${json.error.error_user_title})` : ""}`,
    );
  }
  return json as T;
}

export const MAHARA_BUSINESS_ID = "767701513092162";

/** Every ad account the business can reach, owned + client. */
export async function allAdAccounts(): Promise<
  { id: string; account_id: string; name: string; timezone_name?: string }[]
> {
  const out: any[] = [];
  for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
    const r = await graph<any>(`${MAHARA_BUSINESS_ID}/${edge}`, {
      fields: "id,name,account_status,timezone_name,currency",
      limit: 200,
    });
    out.push(...(r.data ?? []));
  }
  return out.map(a => ({
    ...a,
    account_id: String(a.id ?? "").replace(/^act_/, ""),
  }));
}

/**
 * Write to the Graph API with the system-user token. Same reasoning as `graph()`:
 * it goes straight to Meta, so turning things on and off keeps working even while
 * the Viktor tool gateway is down.
 */
export async function graphPost<T = any>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN not set");
  const body = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
    access_token: token,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(
      `Meta ${json.error.code}${json.error.error_subcode ? `/${json.error.error_subcode}` : ""}: ${json.error.message}${json.error.error_user_msg ? ` — ${json.error.error_user_msg}` : ""}${json.error.error_user_title ? ` (${json.error.error_user_title})` : ""}`,
    );
  }
  return json as T;
}
