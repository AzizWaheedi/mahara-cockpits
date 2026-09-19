import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The memory core's tables.
 *
 * One table holds everything the memory core can recall — a synced Notion
 * page, an email, a Drive file, or a memory Aziz typed himself. Keeping manual
 * memories in the same table as the synced sources is what makes one search
 * box work: they share one full-text index, and a saved memory is never a
 * second-class citizen behind the synced ones.
 *
 * Convex tables here are named `memory_*` rather than `cockpit_*`: the
 * `cockpit_*` prefix and the RLS/grants rule in CLAUDE.md govern Supabase
 * tables, and this app keeps its data in Convex. Nothing is written to
 * Supabase by this app.
 */

/** The three outside sources, plus the memories Aziz writes himself. */
export const SOURCE_KEYS = ["notion", "gmail", "drive", "note"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_LABELS: Record<SourceKey, string> = {
  notion: "Notion",
  gmail: "Gmail",
  drive: "Google Drive",
  note: "Memories",
};

const vSource = v.union(
  v.literal("notion"),
  v.literal("gmail"),
  v.literal("drive"),
  v.literal("note"),
);

/** One item the answer was grounded in, in citation order. */
const vCitation = v.object({
  /** The number shown beside the claim, starting at 1. */
  n: v.number(),
  source: v.string(),
  title: v.string(),
  externalId: v.string(),
  url: v.optional(v.string()),
  snippet: v.string(),
});

const schema = defineSchema({
  /**
   * Every recallable item: synced from Notion, Gmail or Drive, or written by
   * hand. `body` is the searchable text — the full email body, the page's
   * markdown, the file's description, or the memory's own words.
   */
  memory_items: defineTable({
    source: vSource,
    /** The id that source gave it: Notion page id, Gmail message id, Drive file id, note id. */
    externalId: v.string(),
    title: v.string(),
    /** Everything searchable about the item, flattened into one string. */
    body: v.string(),
    /** The short preview the results list shows. */
    snippet: v.string(),
    /** Where to open the item, when the source gives a link. */
    url: v.optional(v.string()),
    /** Who wrote it: the sender, the Notion author, the Drive owner. */
    author: v.optional(v.string()),
    /** When it happened at the source: sent, edited, created. Epoch ms. */
    occurredAt: v.number(),
    /** First and last time the memory core saw this item. Epoch ms. */
    indexedAt: v.number(),
    refreshedAt: v.number(),
    /** Hash of title+body, so a re-sync can skip an unchanged item. */
    hash: v.string(),
    /** Tags on a hand-written memory. */
    tags: v.optional(v.array(v.string())),
    /** True for a memory Aziz wrote; the Memories view reads only these. */
    pinned: v.optional(v.boolean()),
    /** Where the item came from when it was pulled live: "search", "sync", "asked". */
    via: v.optional(v.string()),
  })
    .index("by_source_and_external", ["source", "externalId"])
    .index("by_source_and_occurred", ["source", "occurredAt"])
    .index("by_occurred", ["occurredAt"])
    .searchIndex("search_body", {
      searchField: "body",
      filterFields: ["source"],
    }),

  /**
   * One row per connected source: whether it answered, when it last synced
   * without an error, how many items it has put in the index, and a plain
   * sentence about what happened. Missing is never zero — a source that has
   * never synced says so instead of showing 0.
   */
  memory_sources: defineTable({
    key: vSource,
    label: v.string(),
    /** False when the last sync could not reach the source. */
    connected: v.boolean(),
    /** Plain sentence for the person reading the screen. */
    note: v.string(),
    /** When a sync last ran, good or bad. Epoch ms. */
    lastSyncAt: v.optional(v.number()),
    /** When a sync last succeeded. Epoch ms. */
    lastOkAt: v.optional(v.number()),
    /** How many items the last successful sync indexed. */
    lastCount: v.optional(v.number()),
    /** Total items from this source currently in the index. */
    itemCount: v.number(),
    /** What the source said when it failed, for the Details disclosure. */
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** One row per conversation in Ask. */
  memory_chats: defineTable({
    /** The first question, trimmed — used as the list label. */
    title: v.string(),
    createdAt: v.number(),
    lastMessageAt: v.number(),
    /** How many items grounded the last answer in this chat. */
    groundedBy: v.optional(v.number()),
  }).index("by_lastMessageAt", ["lastMessageAt"]),

  /** The questions and the grounded answers in a chat. */
  memory_messages: defineTable({
    chatId: v.id("memory_chats"),
    role: v.union(v.literal("asker"), v.literal("memory")),
    text: v.string(),
    citations: v.array(vCitation),
    /** False when nothing relevant was found and the answer says so. */
    grounded: v.boolean(),
    /** The model that wrote the answer, e.g. "OpenAI gpt-4.1-mini". */
    model: v.optional(v.string()),
    /** The question this answer belongs to, on asker rows. */
    at: v.number(),
  }).index("by_chat_and_at", ["chatId", "at"]),

  /** Every write leaves a row here, including what a sync indexed. */
  memory_audit: defineTable({
    at: v.number(),
    actor: v.string(),
    /** "saved a memory", "synced Notion", "indexed 42 items". */
    action: v.string(),
    detail: v.string(),
  }).index("by_at", ["at"]),

  /** One row per outbound answer from an outside system, good or bad. */
  memory_health: defineTable({
    source: v.string(),
    ok: v.boolean(),
    /** HTTP status or the error body, trimmed. */
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_source_and_at", ["source", "at"]),
});

export default schema;
