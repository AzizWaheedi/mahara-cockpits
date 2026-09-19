import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { OPERATOR, requireOperator } from "./gate";
import { drainNotes } from "./health";
import {
  emptyReason,
  type MemoryItemDraft,
  readNotionPage,
  recentFrom,
  snippetFor,
} from "./sources";
import { composioTool } from "./tools";

/**
 * Syncing: pull recent items from each source into the index, so the memory
 * core knows things nobody has searched for yet.
 *
 * A sync is deliberately small and repeatable. It takes the newest handful from
 * each source, indexes anything new, and writes one honest status line per
 * source. It never deletes: an item that drops out of the newest handful stays
 * in the index, because the point of a memory is that it does not forget.
 *
 * The three sources are fetched one after the other rather than all at once —
 * Composio counts calls per toolkit, and a sync is not in a hurry.
 */

/** How many items one sync takes per source. */
export const SYNC_LIMIT = 10;

/** How many Notion pages get their text read in on a sync. */
export const NOTION_PAGES_PER_SYNC = 3;

const LABELS: Record<string, string> = {
  notion: "Notion",
  gmail: "Gmail",
  drive: "Google Drive",
};

type SourceKey = "notion" | "gmail" | "drive";
const SOURCES: SourceKey[] = ["notion", "gmail", "drive"];

/**
 * Sync one source and write its status row. Shared by the buttons on the
 * Sources screen and by the daily run, so both behave identically.
 */
export async function syncOne(
  ctx: ActionCtx,
  source: SourceKey,
  actor: string,
  limit = SYNC_LIMIT,
): Promise<{
  source: SourceKey;
  ok: boolean;
  count: number;
  note: string;
  error: string | null;
}> {
  const result = await recentFrom(source, limit, "sync");

  if (!result.ok) {
    const note = `${LABELS[source]} did not answer, so nothing new was indexed from it. ${
      source === "notion"
        ? "Check the page is shared with the Composio integration."
        : "The connection may need reconnecting in Composio."
    }`;
    await ctx.runMutation(internal.memory.setSourceStatus, {
      key: source,
      label: LABELS[source],
      ok: false,
      note,
      error: result.error ?? "no reason given",
      actor,
    });
    await ctx.runMutation(internal.health.record, { rows: drainNotes() });
    return { source, ok: false, count: 0, note, error: result.error };
  }

  let items = result.items;

  // Notion's search only matches titles, so the newest pages get their text
  // read in here — after this run, the words inside those pages are
  // searchable. Three per sync keeps the run short and the rate limit happy.
  let readIn = 0;
  if (source === "notion") {
    for (const page of items.slice(0, NOTION_PAGES_PER_SYNC)) {
      const already = await ctx.runQuery(
        internal.memory.itemBySourceAndExternal,
        { source: "notion", externalId: page.externalId },
      );
      if (already && already.body.length > 1500) continue;
      const markdown = await readNotionPage(page.externalId);
      if (!markdown) continue;
      readIn++;
      items = items.map(item =>
        item.externalId === page.externalId
          ? {
              ...item,
              body: markdown,
              snippet: snippetFor(markdown, ""),
              occurredAt: Date.now(),
              via: "sync",
            }
          : item,
      );
    }
  }

  const written = items.length
    ? await ctx.runMutation(internal.memory.upsertDrafts, {
        drafts: items.map(toStored),
        actor,
      })
    : { inserted: 0, refreshed: 0 };

  const note = [
    `Indexed ${written.inserted} new item${written.inserted === 1 ? "" : "s"} from ${LABELS[source]}`,
    written.refreshed ? `${written.refreshed} were already known` : "",
    readIn
      ? `${readIn} Notion page${readIn === 1 ? "" : "s"} read in full`
      : "",
    items.length === 0 ? emptyReason(source, 0) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  await ctx.runMutation(internal.memory.setSourceStatus, {
    key: source,
    label: LABELS[source],
    ok: true,
    note,
    count: written.inserted,
    actor,
  });
  await ctx.runMutation(internal.health.record, { rows: drainNotes() });
  return {
    source,
    ok: true,
    count: written.inserted,
    note,
    error: null,
  };
}

function toStored(draft: MemoryItemDraft) {
  return {
    source: draft.source,
    externalId: draft.externalId,
    title: draft.title,
    body: draft.body,
    snippet: draft.snippet,
    url: draft.url,
    author: draft.author,
    occurredAt: draft.occurredAt,
    via: draft.via,
  };
}

/** Sync all three sources, one after the other. */
export async function syncEverything(
  ctx: ActionCtx,
  actor: string,
  limit = SYNC_LIMIT,
) {
  const results = [];
  for (const source of SOURCES) {
    results.push(await syncOne(ctx, source, actor, limit));
  }
  const inserted = results.reduce((sum, result) => sum + result.count, 0);
  await ctx.runMutation(internal.memory.logAudit, {
    actor,
    action: inserted ? `synced ${inserted} new items` : "synced, nothing new",
    detail: results
      .map(result => result.note)
      .join(" | ")
      .slice(0, 400),
  });
  return { results, inserted };
}

/** The button on the Sources screen. */
export const syncAll = action({
  args: { code: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { code, limit }) => {
    const actor = requireOperator(code);
    return await syncEverything(ctx, actor, limit ?? SYNC_LIMIT);
  },
});

/** Sync one source on its own. */
export const syncSource = action({
  args: {
    code: v.optional(v.string()),
    source: v.union(
      v.literal("notion"),
      v.literal("gmail"),
      v.literal("drive"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { code, source, limit }) => {
    const actor = requireOperator(code);
    return await syncOne(ctx, source, actor, limit ?? SYNC_LIMIT);
  },
});

/**
 * The daily run. It is an internal action, so it cannot be called from a
 * browser at all, and it acts as the operator because there is no signed-in
 * person at 4am.
 */
export const dailySync = internalAction({
  args: {},
  handler: async ctx => {
    const result = await syncEverything(ctx, `${OPERATOR} (daily sync)`);
    return result.inserted;
  },
});

/** One live check of each source, used by the smoke script. */
export const probeSources = action({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }) => {
    requireOperator(code);
    const probe = async (
      tool: string,
      args: Record<string, unknown>,
      source: string,
    ) => {
      const outcome = await composioTool(tool, args, source);
      return {
        source,
        tool,
        ok: outcome.ok,
        truncated: outcome.truncated,
        error: outcome.error,
        preview: outcome.ok ? JSON.stringify(outcome.data).slice(0, 300) : null,
      };
    };
    const results = [
      await probe("NOTION_SEARCH_NOTION_PAGE", { page_size: 2 }, "notion"),
      await probe("GMAIL_FETCH_EMAILS", { max_results: 2 }, "gmail"),
      await probe(
        "GOOGLEDRIVE_FIND_FILE",
        { query: "trashed = false", page_size: 2 },
        "drive",
      ),
    ];
    await ctx.runMutation(internal.health.record, { rows: drainNotes() });
    return results;
  },
});
