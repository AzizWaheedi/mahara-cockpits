import { v } from "convex/values";
import { internalAction } from "../_generated/server";

declare const process: { env: Record<string, string | undefined> };

/**
 * Run a migration against a Supabase project.
 *
 * Why this is separate. `tools.ts mcp_supabase_execute_sql` sends
 * `read_only: true` on every call, which is what makes the management API
 * connect as `supabase_read_only_user`. Every adapter in the cockpit reads
 * through that path and it must stay exactly as it is: a reporting query has
 * no business being able to write, and a single shared helper that could would
 * be one typo away from changing production data.
 *
 * So migrations get their own door, named for what it does, used deliberately,
 * and never called by an adapter.
 *
 * What it refuses. Additive schema only. Anything that drops a table, a schema,
 * a database or a column, truncates, or deletes rows is rejected before it is
 * sent — this exists to create tables, not to lose them. `drop trigger if
 * exists` is allowed, because recreating a trigger is part of defining one.
 * Data changes belong in an ordinary mutation with an audit row, not here.
 */

/** Verbs that can destroy data. Checked on the statement, not the whole script. */
const DESTRUCTIVE =
  /\b(drop\s+(table|schema|database|column|view|materialized)|truncate|delete\s+from|alter\s+table\s+\S+\s+drop\s+column)\b/i;

export const applySql = internalAction({
  args: {
    projectId: v.string(),
    sql: v.string(),
    /** Say what this is, so the log says why the database changed. */
    label: v.string(),
  },
  returns: v.any(),
  handler: async (
    _ctx,
    { projectId, sql, label },
  ): Promise<{ ok: boolean; label: string; rows: unknown }> => {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token)
      throw new Error("SUPABASE_ACCESS_TOKEN is not set on this deployment.");

    const offending = sql
      .split(/;\s*\n/)
      .find(stmt => DESTRUCTIVE.test(stmt.replace(/--[^\n]*/g, "")));
    if (offending)
      throw new Error(
        `Refused: this runner only adds schema, and that script drops or deletes something — "${offending.trim().slice(0, 120)}". Run a destructive change by hand, deliberately, with a backup.`,
      );

    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectId}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql, read_only: false }),
      },
    );
    const text = await res.text();
    if (!res.ok)
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 400)}`);
    const rows = text ? JSON.parse(text) : null;
    console.log(`migration applied to ${projectId}: ${label}`);
    return { ok: true, label, rows };
  },
});
