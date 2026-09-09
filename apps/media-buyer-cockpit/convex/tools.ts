declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

export async function callTool<T>(
  role: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(
    `${VIKTOR_API_URL}/api/viktor-spaces/tools/call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_name: PROJECT_NAME,
        project_secret: PROJECT_SECRET,
        role,
        arguments: args,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error ?? "Tool call failed");
  }
  return json.result as T;
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
    throw new Error(`Meta ${json.error.code}: ${json.error.message}`);
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
  return out.map((a) => ({
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
    throw new Error(`Meta ${json.error.code}: ${json.error.message}`);
  }
  return json as T;
}
