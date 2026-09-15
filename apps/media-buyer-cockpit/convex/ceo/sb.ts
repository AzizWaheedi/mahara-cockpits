import { callTool } from "../tools";

/**
 * Read-only SQL against Mahara's Supabase projects, through the management
 * token the backend already holds (the same call sync.ts uses for Creative
 * Triage). Only SELECT and WITH are allowed here.
 */
export const B2B = "flwboeijllbtrufxkhts";
export const TRIAGE = "bldgtotkfmhoxmlzowdx";

// biome-ignore lint/suspicious/noExplicitAny: SQL rows
export type Row = Record<string, any>;

export async function sql<T extends Row = Row>(
  project: string,
  query: string,
): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(query))
    throw new Error("ceo sql: read-only queries only (SELECT or WITH)");
  // biome-ignore lint/suspicious/noExplicitAny: tool result
  const raw: any = await callTool("mcp_supabase_execute_sql", {
    project_id: project,
    query,
  });
  const text =
    typeof raw?.result === "string" ? raw.result : JSON.stringify(raw ?? []);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // fall through to the fenced form
  }
  const m = /(\[[\s\S]*\])/.exec(text);
  if (!m) throw new Error(`ceo sql: no rows in reply: ${text.slice(0, 160)}`);
  return JSON.parse(m[1]) as T[];
}

/** A number from a SQL cell (Postgres numerics arrive as strings). */
export function num(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Epoch ms from a timestamp cell, or undefined. */
export function ms(x: unknown): number | undefined {
  if (x === null || x === undefined || x === "") return undefined;
  const t = new Date(String(x).replace(" ", "T")).getTime();
  return Number.isFinite(t) ? t : undefined;
}
