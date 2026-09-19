import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * The health ledger: one row per outbound answer from an outside system.
 *
 * Every Composio call and every model call lands here (see `note`, called from
 * the helpers in tools.ts). The Sources view reads the last rows per system and
 * turns three failures in a row into one plain sentence with the fix attached —
 * so a red line on the screen always says what to do about it, not just that
 * something broke.
 */

/** Failures in a row that turn into a "still broken" sentence on the screen. */
export const ALERT_AFTER = 3;

/** What to do when a system keeps failing. Plain words, no engineer needed. */
export const RUNBOOK: Record<
  string,
  { label: string; fix: string; owner: string }
> = {
  composio: {
    label: "Composio — the one door to Notion, Gmail and Google Drive",
    fix: "A 401 means the consumer key changed: open the Composio dashboard, Sessions & API Key, make a new key, then set COMPOSIO_API_KEY on this deployment. A 429 clears on its own — the app waits and retries. If Composio answers but one source fails, reconnect that account in Composio.",
    owner: "Aziz",
  },
  notion: {
    label: "Notion",
    fix: "Notion search only sees pages that were shared with the Composio integration: open the page in Notion, press the share menu, Connections, and add the integration. A 401 means the Notion connection dropped in Composio and needs reconnecting.",
    owner: "Aziz",
  },
  gmail: {
    label: "Gmail",
    fix: "A 401 means the Gmail connection expired: reconnect aziz@maharamedia.com in Composio. A 429 means Google is throttling; the sync waits and retries on its own.",
    owner: "Aziz",
  },
  drive: {
    label: "Google Drive",
    fix: "A 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT means the Drive connection needs re-authorising with the broader scope in Composio. Files that were never shared with the account cannot appear at all.",
    owner: "Aziz",
  },
  anthropic: {
    label: "Claude (answer writing)",
    fix: "Set ANTHROPIC_API_KEY on the deployment, then answers are written by Claude. Until it is set, answers are written by the fallback model and the Ask screen says which one.",
    owner: "Aziz",
  },
  openai: {
    label: "OpenAI (fallback answer writing)",
    fix: "A 401 means the OpenAI key was replaced: make a new one and set OPENAI_API_KEY on the deployment. A 429 means the account is out of quota for the moment; wait a minute and ask again.",
    owner: "Aziz",
  },
};

/** Which ledger row a URL's failures belong to. */
export function sourceFor(url: string): string {
  if (/connect\.composio\.dev/.test(url)) return "composio";
  if (/api\.anthropic\.com/.test(url)) return "anthropic";
  if (/api\.openai\.com/.test(url)) return "openai";
  if (/openrouter\.ai/.test(url)) return "openai";
  return "composio";
}

/** A rate limit or a blip is not a system down; only count real failures. */
export function transient(status: number): boolean {
  return (
    status === 429 ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

export type HealthNote = { source: string; ok: boolean; detail?: string };

/**
 * In-flight notes, flushed by the action that made the calls. The last note per
 * source in one action wins, so a retry that succeeds records a success rather
 * than leaving a stale failure behind.
 */
const pending = new Map<string, HealthNote>();

/** Remember how a call went. Called by every helper in tools.ts. */
export function note(source: string, ok: boolean, detail?: string): void {
  pending.set(source, {
    source,
    ok,
    detail: detail ? detail.slice(0, 400) : undefined,
  });
}

/** Take the notes this action collected and clear them. */
export function drainNotes(): HealthNote[] {
  const rows = [...pending.values()];
  pending.clear();
  return rows;
}

/** Write this action's notes to the ledger. Safe to call with nothing pending. */
export const record = internalMutation({
  args: {
    rows: v.array(
      v.object({
        source: v.string(),
        ok: v.boolean(),
        detail: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const at = Date.now();
    for (const row of rows) {
      await ctx.db.insert("memory_health", {
        source: row.source,
        ok: row.ok,
        detail: row.detail,
        at,
      });
    }
    return rows.length;
  },
});

/**
 * The one sentence a person reads about a system that keeps failing. Returns
 * null while the ledger looks healthy, so the screen stays quiet.
 */
export function troubleSentence(
  source: string,
  recent: { ok: boolean }[],
): string | null {
  const streak = recent.findIndex(row => row.ok);
  const failures = streak === -1 ? recent.length : streak;
  if (failures < ALERT_AFTER) return null;
  const entry = RUNBOOK[source];
  const label = entry?.label ?? source;
  const fix = entry?.fix ?? "Nobody has written the fix for this one yet.";
  return `${label} has not answered for ${failures} tries in a row. ${fix}`;
}
