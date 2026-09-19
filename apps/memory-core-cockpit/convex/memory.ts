import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { codeIsRight, hasAccessCode, requireOperator } from "./gate";
import { ALERT_AFTER, RUNBOOK, troubleSentence } from "./health";
import { scoreOf } from "./sources";
import { answerModelName } from "./tools";

/**
 * The memory core's own data: what is indexed, what Aziz saved, the chats, and
 * the two logs (audit and health).
 *
 * Two rules from CLAUDE.md run through this file:
 *   — every read and write is gated on the server (requireOperator),
 *   — every write leaves an audit row.
 */

const vSource = v.union(
  v.literal("notion"),
  v.literal("gmail"),
  v.literal("drive"),
  v.literal("note"),
);

/** The four kinds of item, as a plain type the helpers can take. */
type SourceKey = "notion" | "gmail" | "drive" | "note";

const vCitation = v.object({
  n: v.number(),
  source: v.string(),
  title: v.string(),
  externalId: v.string(),
  url: v.optional(v.string()),
  snippet: v.string(),
});

const vDraft = v.object({
  source: vSource,
  externalId: v.string(),
  title: v.string(),
  body: v.string(),
  snippet: v.string(),
  url: v.optional(v.string()),
  author: v.optional(v.string()),
  occurredAt: v.number(),
  via: v.string(),
});

const SOURCE_LABELS: Record<string, string> = {
  notion: "Notion",
  gmail: "Gmail",
  drive: "Google Drive",
  note: "Memories",
};

/** The rows the Sources view always shows, in this order, written or not. */
const SOURCE_ORDER = ["notion", "gmail", "drive", "note"] as const;

// ---------------------------------------------------------------------------
// Reading

/** Is the door open? Never throws, so the unlock screen can show a sentence. */
export const checkAccess = query({
  args: { code: v.optional(v.string()) },
  handler: async (_ctx, { code }) => {
    if (!hasAccessCode()) {
      return {
        ok: false,
        configured: false,
        message:
          "This deployment has no access code yet. Set one with: bunx convex env set MEMORY_CORE_ACCESS_CODE <code>",
      };
    }
    if (!codeIsRight(code)) {
      return {
        ok: false,
        configured: true,
        message:
          "That access code did not work. Check the code, or set a new one on the deployment.",
      };
    }
    return { ok: true, configured: true, message: "" };
  },
});

/** How many items one source has in the index. */
async function countOf(ctx: QueryCtx, source: SourceKey): Promise<number> {
  const rows = await ctx.db
    .query("memory_items")
    .withIndex("by_source_and_occurred", q => q.eq("source", source))
    .take(5000);
  return rows.length;
}

function sourceView(
  row: Doc<"memory_sources"> | null,
  key: SourceKey,
  count: number,
) {
  if (!row) {
    return {
      key,
      label: SOURCE_LABELS[key] ?? key,
      connected: key === "note",
      note:
        key === "note"
          ? "Memories are kept here — nothing to connect."
          : "Never synced yet. Press Sync now to pull the first items in.",
      lastSyncAt: null,
      lastOkAt: null,
      lastCount: null,
      itemCount: count,
      lastError: null,
      neverSynced: key !== "note",
    };
  }
  return {
    key: row.key,
    label: row.label,
    connected: row.connected,
    note: row.note,
    lastSyncAt: row.lastSyncAt ?? null,
    lastOkAt: row.lastOkAt ?? null,
    lastCount: row.lastCount ?? null,
    itemCount: count,
    lastError: row.lastError ?? null,
    neverSynced: false,
  };
}

/**
 * Everything the header tiles and the Sources view read, in one subscription:
 * per-source state, the totals, the answer model, the health tail and the last
 * few audit rows.
 */
export const overview = query({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }) => {
    requireOperator(code);
    const rows = await ctx.db.query("memory_sources").collect();
    const byKey = new Map(rows.map(row => [row.key as string, row]));

    const sources = [];
    for (const key of SOURCE_ORDER) {
      const count = await countOf(ctx, key);
      sources.push(sourceView(byKey.get(key) ?? null, key, count));
    }

    const health = await ctx.db
      .query("memory_health")
      .withIndex("by_source_and_at")
      .order("desc")
      .take(120);

    const systems = new Map<
      string,
      { ok: boolean; at: number; detail: string | null }[]
    >();
    for (const row of health) {
      const list = systems.get(row.source) ?? [];
      if (list.length < 8) {
        list.push({ ok: row.ok, at: row.at, detail: row.detail ?? null });
      }
      systems.set(row.source, list);
    }

    const trouble: string[] = [];
    for (const [source, recent] of systems) {
      const sentence = troubleSentence(source, recent);
      if (sentence) trouble.push(sentence);
    }

    const audit = await ctx.db
      .query("memory_audit")
      .withIndex("by_at")
      .order("desc")
      .take(12);

    const totalItems = sources.reduce((sum, s) => sum + s.itemCount, 0);
    const lastOk = sources
      .map(s => s.lastOkAt)
      .filter((at): at is number => typeof at === "number");

    return {
      sources,
      systems: [...systems.entries()].map(([source, recent]) => ({
        source,
        label: RUNBOOK[source]?.label ?? source,
        alertAfter: ALERT_AFTER,
        recent: recent.slice(0, 5),
      })),
      trouble,
      audit: audit.map(row => ({
        at: row.at,
        actor: row.actor,
        action: row.action,
        detail: row.detail,
      })),
      totals: {
        items: totalItems,
        memories: sources.find(s => s.key === "note")?.itemCount ?? 0,
        lastSyncAt: lastOk.length ? Math.max(...lastOk) : null,
      },
      answerModel: answerModelName(),
      serverNow: Date.now(),
    };
  },
});

/** The newest things in the memory, whatever source they came from. */
export const recentItems = query({
  args: { code: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { code, limit }) => {
    requireOperator(code);
    const rows = await ctx.db
      .query("memory_items")
      .withIndex("by_occurred")
      .order("desc")
      .take(Math.min(limit ?? 8, 40));
    return rows.map(itemView);
  },
});

/** The memories Aziz wrote himself, newest first. */
export const memories = query({
  args: { code: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { code, limit }) => {
    requireOperator(code);
    const rows = await ctx.db
      .query("memory_items")
      .withIndex("by_source_and_occurred", q => q.eq("source", "note"))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return rows.map(itemView);
  },
});

/** The conversations in Ask, most recently used first. */
export const chats = query({
  args: { code: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { code, limit }) => {
    requireOperator(code);
    const rows = await ctx.db
      .query("memory_chats")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(Math.min(limit ?? 20, 100));
    return rows.map(row => ({
      id: row._id,
      title: row.title,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
      groundedBy: row.groundedBy ?? null,
    }));
  },
});

/** One conversation, start to finish. */
export const chatMessages = query({
  args: { code: v.optional(v.string()), chatId: v.id("memory_chats") },
  handler: async (ctx, { code, chatId }) => {
    requireOperator(code);
    const rows = await ctx.db
      .query("memory_messages")
      .withIndex("by_chat_and_at", q => q.eq("chatId", chatId))
      .order("asc")
      .take(200);
    return rows.map(row => ({
      id: row._id,
      role: row.role,
      text: row.text,
      citations: row.citations,
      grounded: row.grounded,
      model: row.model ?? null,
      at: row.at,
    }));
  },
});

function itemView(row: Doc<"memory_items">) {
  return {
    id: row._id,
    source: row.source,
    externalId: row.externalId,
    title: row.title,
    snippet: row.snippet,
    url: row.url ?? null,
    author: row.author ?? null,
    occurredAt: row.occurredAt,
    indexedAt: row.indexedAt,
    via: row.via ?? null,
    pinned: row.pinned === true,
    tags: row.tags ?? [],
  };
}

// ---------------------------------------------------------------------------
// Writing

/** Save a memory: the fact Aziz wants the core to keep. */
export const saveMemory = mutation({
  args: {
    code: v.optional(v.string()),
    text: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { code, text, tags }) => {
    const actor = requireOperator(code);
    const clean = text.trim();
    if (!clean) {
      throw new Error("Write something to remember first.");
    }
    if (clean.length > 4000) {
      throw new Error(
        "That memory is over 4,000 characters. Split it into two.",
      );
    }
    const now = Date.now();
    const title = clean.split("\n")[0].slice(0, 120);
    const id = await ctx.db.insert("memory_items", {
      source: "note",
      externalId: `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      body: clean,
      snippet: clean.slice(0, 240),
      author: actor,
      occurredAt: now,
      indexedAt: now,
      refreshedAt: now,
      hash: `${clean.length}-${now}`,
      tags: (tags ?? [])
        .map(tag => tag.trim())
        .filter(Boolean)
        .slice(0, 8),
      pinned: true,
      via: "typed",
    });
    await ctx.db.insert("memory_audit", {
      at: now,
      actor,
      action: "saved a memory",
      detail: title,
    });
    await writeNoteSourceRow(ctx, now);
    return id;
  },
});

/** Keep the Memories row on the Sources view honest as notes are added. */
async function writeNoteSourceRow(
  ctx: MutationCtx,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("memory_sources")
    .withIndex("by_key", q => q.eq("key", "note"))
    .unique();
  const itemCount = await ctx.db
    .query("memory_items")
    .withIndex("by_source_and_occurred", q => q.eq("source", "note"))
    .take(5000);
  const patch = {
    connected: true,
    note: "Memories are kept here — nothing to connect.",
    lastSyncAt: now,
    lastOkAt: now,
    lastCount: itemCount.length,
    itemCount: itemCount.length,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("memory_sources", {
      key: "note",
      label: SOURCE_LABELS.note,
      ...patch,
    });
  }
}

/** Remove a memory Aziz saved. Synced items are not deletable from here. */
export const forgetMemory = mutation({
  args: { code: v.optional(v.string()), id: v.id("memory_items") },
  handler: async (ctx, { code, id }) => {
    const actor = requireOperator(code);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That memory is already gone.");
    if (row.source !== "note") {
      throw new Error(
        "That item came from a connected source, so the memory core cannot delete it. Open it at the source instead.",
      );
    }
    await ctx.db.delete(id);
    await ctx.db.insert("memory_audit", {
      at: Date.now(),
      actor,
      action: "forgot a memory",
      detail: row.title,
    });
    return true;
  },
});

// ---------------------------------------------------------------------------
// Internals the actions use (never callable from a browser)

/** Full-text hits from the index, optionally narrowed to one source. */
export const indexHits = internalQuery({
  args: {
    query: v.string(),
    source: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { query, source, limit }) => {
    const search = ctx.db
      .query("memory_items")
      .withSearchIndex("search_body", q =>
        source
          ? q.search("body", query).eq("source", source as never)
          : q.search("body", query),
      );
    const rows = await search.take(limit);
    const now = Date.now();
    // Scored here, where the body still is: the list the screen gets carries a
    // score rather than every email whole.
    return rows.map(row => ({
      ...itemView(row),
      score: scoreOf(row, query, now),
    }));
  },
});

/** Items on the same source id, so a re-sync can tell new from unchanged. */
export const itemBySourceAndExternal = internalQuery({
  args: { source: vSource, externalId: v.string() },
  handler: async (ctx, { source, externalId }) => {
    const row = await ctx.db
      .query("memory_items")
      .withIndex("by_source_and_external", q =>
        q.eq("source", source).eq("externalId", externalId),
      )
      .unique();
    if (!row) return null;
    return {
      id: row._id,
      hash: row.hash,
      body: row.body,
      title: row.title,
      url: row.url ?? null,
      occurredAt: row.occurredAt,
    };
  },
});

/**
 * Put the items a search or a sync brought back into the index.
 *
 * Re-indexing is what makes the memory core get better with use: the second
 * time Aziz searches for an invoice, the email that matched is already here and
 * comes back instantly, and it is still there next month.
 */
export const upsertDrafts = internalMutation({
  args: {
    drafts: v.array(vDraft),
    actor: v.string(),
  },
  handler: async (ctx, { drafts, actor }) => {
    const now = Date.now();
    let inserted = 0;
    let refreshed = 0;
    const perSource = new Map<string, number>();
    for (const draft of drafts) {
      const hash = `${draft.title.length}:${draft.body.length}:${draft.occurredAt}`;
      const existing = await ctx.db
        .query("memory_items")
        .withIndex("by_source_and_external", q =>
          q.eq("source", draft.source).eq("externalId", draft.externalId),
        )
        .unique();
      if (existing) {
        // Only write when something actually changed; a sync that finds the
        // same emails again should not spend a write on each one.
        if (
          existing.title !== draft.title ||
          existing.body !== draft.body ||
          existing.snippet !== draft.snippet
        ) {
          await ctx.db.patch(existing._id, {
            title: draft.title,
            body: draft.body,
            snippet: draft.snippet,
            url: draft.url,
            author: draft.author,
            occurredAt: draft.occurredAt,
            refreshedAt: now,
            via: draft.via,
          });
          refreshed++;
        } else {
          await ctx.db.patch(existing._id, { refreshedAt: now });
        }
      } else {
        await ctx.db.insert("memory_items", {
          source: draft.source,
          externalId: draft.externalId,
          title: draft.title,
          body: draft.body,
          snippet: draft.snippet,
          url: draft.url,
          author: draft.author,
          occurredAt: draft.occurredAt,
          indexedAt: now,
          refreshedAt: now,
          hash,
          via: draft.via,
        });
        inserted++;
      }
      perSource.set(draft.source, (perSource.get(draft.source) ?? 0) + 1);
    }
    if (inserted || refreshed) {
      const parts = [...perSource.entries()]
        .map(([source, count]) => `${count} ${SOURCE_LABELS[source] ?? source}`)
        .join(", ");
      await ctx.db.insert("memory_audit", {
        at: now,
        actor,
        action: inserted ? `indexed ${inserted} new items` : "refreshed items",
        detail: `${parts}${refreshed ? ` · ${refreshed} already known` : ""}`,
      });
    }
    return { inserted, refreshed, perSource: Object.fromEntries(perSource) };
  },
});

/** Record how a sync went, on the source's own row. */
export const setSourceStatus = internalMutation({
  args: {
    key: vSource,
    label: v.string(),
    ok: v.boolean(),
    note: v.string(),
    count: v.optional(v.number()),
    error: v.optional(v.string()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("memory_sources")
      .withIndex("by_key", q => q.eq("key", args.key))
      .unique();
    const indexed = await ctx.db
      .query("memory_items")
      .withIndex("by_source_and_occurred", q => q.eq("source", args.key))
      .take(5000);
    const itemCount = indexed.length;
    if (existing) {
      await ctx.db.patch(existing._id, {
        connected: args.ok,
        note: args.note,
        lastSyncAt: now,
        lastOkAt: args.ok ? now : existing.lastOkAt,
        lastCount: args.ok ? (args.count ?? 0) : existing.lastCount,
        itemCount,
        lastError: args.ok ? undefined : args.error,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("memory_sources", {
        key: args.key,
        label: args.label,
        connected: args.ok,
        note: args.note,
        lastSyncAt: now,
        lastOkAt: args.ok ? now : undefined,
        lastCount: args.ok ? (args.count ?? 0) : undefined,
        itemCount,
        lastError: args.ok ? undefined : args.error,
        updatedAt: now,
      });
    }
    await ctx.db.insert("memory_audit", {
      at: now,
      actor: args.actor,
      action: args.ok ? `synced ${args.label}` : `${args.label} sync failed`,
      detail: args.note,
    });
    return true;
  },
});

/** Store one turn of an Ask conversation. Returns the chat id. */
export const saveTurn = internalMutation({
  args: {
    chatId: v.optional(v.id("memory_chats")),
    question: v.string(),
    answer: v.string(),
    citations: v.array(vCitation),
    grounded: v.boolean(),
    model: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let chatId = args.chatId ?? null;
    if (chatId) {
      const chat = await ctx.db.get(chatId);
      if (!chat) chatId = null;
    }
    if (!chatId) {
      chatId = await ctx.db.insert("memory_chats", {
        title: args.question.slice(0, 80),
        createdAt: now,
        lastMessageAt: now,
        groundedBy: args.citations.length,
      });
    } else {
      await ctx.db.patch(chatId, {
        lastMessageAt: now,
        groundedBy: args.citations.length,
      });
    }
    await ctx.db.insert("memory_messages", {
      chatId,
      role: "asker",
      text: args.question,
      citations: [],
      grounded: true,
      at: now,
    });
    await ctx.db.insert("memory_messages", {
      chatId,
      role: "memory",
      text: args.answer,
      citations: args.citations,
      grounded: args.grounded,
      model: args.model,
      at: now + 1,
    });
    await ctx.db.insert("memory_audit", {
      at: now,
      actor: args.actor,
      action: "asked the memory core",
      detail: `${args.question.slice(0, 100)} · answered from ${args.citations.length} item${
        args.citations.length === 1 ? "" : "s"
      }`,
    });
    return { chatId };
  },
});

/** Note in the audit log that a page's text was pulled into the index. */
export const logAudit = internalMutation({
  args: { actor: v.string(), action: v.string(), detail: v.string() },
  handler: async (ctx, { actor, action, detail }) => {
    await ctx.db.insert("memory_audit", {
      at: Date.now(),
      actor,
      action,
      detail: detail.slice(0, 400),
    });
    return true;
  },
});
