/**
 * Writes to the cockpit's own tables in Creative Triage through PostgREST
 * with the service key, the same door convex/ceo/people.ts uses. Read-only
 * SQL stays in convex/ceo/sb.ts; this is the one place a cockpit table is
 * written from an action. The key is read from the deployment and never
 * logged, returned or put in an error.
 */

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
export type SbRow = Record<string, any>;

/** True when the deployment can reach Creative Triage with the service key. */
export function sbWritable(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * One PostgREST call. `null` when the table does not exist yet (404 or
 * 42P01), so a screen can say "not set up" instead of failing.
 */
export async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<SbRow[] | null> {
  if (!sbWritable())
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.",
    );
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404 || text.includes("42P01")) return null;
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : [];
}

/** Insert rows, ignoring the ones whose unique key already exists. */
export async function upsertIgnore(
  table: string,
  rows: SbRow[],
  onConflict: string,
): Promise<SbRow[] | null> {
  if (!rows.length) return [];
  return rest(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    body: rows,
    prefer: "resolution=ignore-duplicates,return=representation",
  });
}

/** Insert or replace rows on their unique key. */
export async function upsertMerge(
  table: string,
  rows: SbRow[],
  onConflict: string,
): Promise<SbRow[] | null> {
  if (!rows.length) return [];
  return rest(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}
