// page-form-events: see handler.ts. Deployed with verify_jwt false (public).
// The service role key is the one Supabase gives every function. It is never
// logged or returned.
import { handle, type Row } from "./handler.ts";

const base = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

// A page's hosts, kept a minute per running instance.
const hostCache = new Map<string, { at: number; hosts: string[] | null }>();
async function hosts(slug: string): Promise<string[] | null> {
  const hit = hostCache.get(slug);
  if (hit && Date.now() - hit.at < 60_000) return hit.hosts;
  const res = await rest(
    `cockpit_page_forms?select=event_hosts&slug=eq.${encodeURIComponent(slug)}`,
  );
  if (!res.ok) {
    console.error(`page-form-events host read failed ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { event_hosts?: string[] }[];
  const found = Array.isArray(data) && data[0] ? (data[0].event_hosts ?? []) : null;
  if (hostCache.size > 200) hostCache.clear();
  hostCache.set(slug, { at: Date.now(), hosts: found });
  return found;
}

async function insert(rows: Row[]) {
  const res = await rest(
    "cockpit_page_form_events?on_conflict=slug,session_id,screen",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    },
  );
  return { ok: res.ok, status: res.status, detail: res.ok ? "" : await res.text() };
}

Deno.serve(req => handle(req, { hosts, insert }));
