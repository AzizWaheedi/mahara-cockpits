import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import { requireOperator } from "./gate";
import { drainNotes } from "./health";
import {
  federatedSearch,
  type MemoryItemDraft,
  readNotionPage,
  type SourceResult,
  scoreOf,
  snippetFor,
} from "./sources";

/**
 * Federated search: one box, three sources, one ranked list.
 *
 * The order of work matters and is deliberate:
 *
 *   1. Ask Notion, Gmail and Drive at the same time (one Composio call).
 *   2. Index whatever came back, so the next search is faster and the memory
 *      core grows instead of starting from nothing every time.
 *   3. Search the index too — that is where memories Aziz typed and everything
 *      synced earlier live.
 *   4. Rank both together: his own memories first among equals, a title match
 *      above a body match, recent above old.
 *
 * A source that fails returns a sentence, not an empty list: "nothing in Gmail
 * matched" and "Gmail did not answer" are different things to be told.
 */

export type SearchResult = {
  key: string;
  source: string;
  externalId: string;
  title: string;
  snippet: string;
  url: string | null;
  author: string | null;
  occurredAt: number;
  score: number;
  fromIndex: boolean;
  /** Set when the item has a Notion page whose text is not in the index yet. */
  canRead: boolean;
};

export type Retrieval = {
  query: string;
  results: SearchResult[];
  perSource: SourceResult[];
  indexed: { inserted: number; refreshed: number };
  error: string | null;
  usedLive: boolean;
  tookMs: number;
};

/** How many items each source is asked for on one search. */
export const PER_SOURCE = 12;

/**
 * The shared retrieval step: live fan-out, index the answers, then search the
 * index and rank everything together. Ask and Search both call this, so a chat
 * answer is grounded in exactly what the search screen shows.
 */
export async function retrieveContext(
  ctx: ActionCtx,
  opts: {
    query: string;
    actor: string;
    per?: number;
    live?: boolean;
    via: string;
  },
): Promise<Retrieval> {
  const started = Date.now();
  const query = opts.query.trim();
  const per = Math.min(opts.per ?? PER_SOURCE, 25);
  const wantLive = opts.live !== false;

  let perSource: SourceResult[] = [];
  let error: string | null = null;
  if (wantLive) {
    try {
      perSource = await federatedSearch(query, per, opts.via);
    } catch (e) {
      // Composio itself is down: the index still answers, and the screen says
      // why the live half is missing rather than showing nothing.
      error = String(e).slice(0, 300);
    }
  }

  const drafts = perSource.flatMap(result => result.items);
  let indexed = { inserted: 0, refreshed: 0 };
  if (drafts.length) {
    indexed = await ctx.runMutation(internal.memory.upsertDrafts, {
      drafts: drafts.map(toStoredDraft),
      actor: opts.actor,
    });
  }

  const indexRows = await ctx.runQuery(internal.memory.indexHits, {
    query,
    limit: 40,
  });

  const results = mergeResults(indexRows, drafts, query, Date.now(), per * 2);
  await ctx.runMutation(internal.health.record, { rows: drainNotes() });

  return {
    query,
    results,
    perSource,
    indexed: { inserted: indexed.inserted, refreshed: indexed.refreshed },
    error,
    usedLive: wantLive,
    tookMs: Date.now() - started,
  };
}

function toStoredDraft(draft: MemoryItemDraft) {
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

type IndexRow = {
  id: string;
  source: string;
  externalId: string;
  title: string;
  snippet: string;
  url: string | null;
  author: string | null;
  occurredAt: number;
  score: number;
  pinned: boolean;
  tags: string[];
};

/**
 * One merged list: everything the index already knew plus everything the live
 * search just found, best first, no item twice.
 */
function mergeResults(
  indexRows: IndexRow[],
  live: MemoryItemDraft[],
  query: string,
  now: number,
  limit: number,
): SearchResult[] {
  const merged = new Map<string, SearchResult>();
  const keyOf = (source: string, externalId: string) =>
    `${source}:${externalId}`;

  for (const row of indexRows) {
    merged.set(keyOf(row.source, row.externalId), {
      key: keyOf(row.source, row.externalId),
      source: row.source,
      externalId: row.externalId,
      title: row.title,
      snippet: row.snippet,
      url: row.url,
      author: row.author,
      occurredAt: row.occurredAt,
      score: row.score,
      fromIndex: true,
      canRead: false,
    });
  }

  for (const item of live) {
    const key = keyOf(item.source, item.externalId);
    const score = scoreOf(item, query, now);
    const existing = merged.get(key);
    const result: SearchResult = {
      key,
      source: item.source,
      externalId: item.externalId,
      title: item.title,
      snippet: item.snippet || (existing?.snippet ?? ""),
      url: item.url ?? existing?.url ?? null,
      author: item.author ?? existing?.author ?? null,
      occurredAt: item.occurredAt,
      score: Math.max(score, existing?.score ?? 0),
      fromIndex: false,
      canRead: false,
    };
    merged.set(key, result);
  }

  const ranked = [...merged.values()]
    .filter(item => item.score > 0 || item.source === "note")
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.occurredAt - a.occurredAt;
    })
    .slice(0, limit);

  // A Notion hit whose text was never pulled in can be read into the index on
  // the spot; the button only appears when it would actually add something.
  return ranked.map(item => ({
    ...item,
    canRead: item.source === "notion",
  }));
}

export const search = action({
  args: {
    code: v.optional(v.string()),
    query: v.string(),
    limit: v.optional(v.number()),
    /** false searches only what is already in the index (fast, no outside calls). */
    live: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Retrieval> => {
    const actor = requireOperator(args.code);
    const query = args.query.trim();
    if (query.length < 2) {
      throw new Error("Type at least two characters to search.");
    }
    return await retrieveContext(ctx, {
      query,
      actor,
      per: args.limit,
      live: args.live,
      via: "search",
    });
  },
});

/**
 * Pull one Notion page's actual text into the index.
 *
 * Notion's own search only matches page titles, so a page whose title says
 * nothing about what is inside it is invisible to search until this runs once.
 * After it does, the words inside the page are searchable like an email body —
 * and they stay searchable.
 */
export const readNotionPageIntoMemory = action({
  args: {
    code: v.optional(v.string()),
    pageId: v.string(),
    /** The page's title, as the search result showed it. */
    title: v.optional(v.string()),
    url: v.optional(v.string()),
    /** Read it again even though text is already in the index. */
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { code, pageId, title, url, force },
  ): Promise<{
    ok: boolean;
    alreadyRead: boolean;
    characters: number;
    inserted: number;
  }> => {
    const actor = requireOperator(code);
    const existing = await ctx.runQuery(
      internal.memory.itemBySourceAndExternal,
      { source: "notion", externalId: pageId },
    );
    if (existing && existing.body.length > 1500 && force !== true) {
      return {
        ok: true,
        alreadyRead: true,
        characters: existing.body.length,
        inserted: 0,
      };
    }
    const markdown = await readNotionPage(pageId);
    if (!markdown) {
      await ctx.runMutation(internal.health.record, { rows: drainNotes() });
      throw new Error(
        "Notion did not send that page's text. Check the page is still shared with the Composio integration, then try again.",
      );
    }
    const pageTitle = title ?? existing?.title ?? "Notion page";
    const draft: MemoryItemDraft = {
      source: "notion",
      externalId: pageId,
      title: pageTitle,
      body: markdown,
      snippet: snippetFor(markdown, title ?? ""),
      url: url ?? existing?.url ?? undefined,
      occurredAt: Date.now(),
      via: "read",
    };
    const written = await ctx.runMutation(internal.memory.upsertDrafts, {
      drafts: [toStoredDraft(draft)],
      actor,
    });
    await ctx.runMutation(internal.memory.logAudit, {
      actor,
      action: "read a Notion page into memory",
      detail: `${pageTitle} · ${markdown.length} characters`,
    });
    await ctx.runMutation(internal.health.record, { rows: drainNotes() });
    return {
      ok: true,
      alreadyRead: false,
      characters: markdown.length,
      inserted: written.inserted,
    };
  },
});
