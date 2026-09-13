import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * A 25-minute cache of client stat-sheet reads, kept in `docCache`.
 *
 * The sync runs every 10 minutes and used to re-read every client's sheet
 * each time: ninety Sheets reads a minute against a quota of sixty, so the
 * whole account (including Hermes's morning sheet) got rate-limited. The
 * sheets change a few times a day, so a read that is younger than 25
 * minutes is served from here; each cycle now re-reads only what expired.
 */

export const TTL_MS = 25 * 60_000;
export type SheetCache = Map<string, { at: number; data: unknown }>;

export const all = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx =>
    (await ctx.db.query("docCache").collect())
      .filter(r => r.docId.startsWith("sheet:"))
      .map(r => ({ key: r.docId, at: r.at, text: r.text })),
});

export const save = internalMutation({
  args: { entries: v.array(v.object({ key: v.string(), text: v.string() })) },
  returns: v.null(),
  handler: async (ctx, { entries }) => {
    for (const e of entries) {
      const row = await ctx.db
        .query("docCache")
        .withIndex("by_doc", q => q.eq("docId", e.key))
        .unique();
      const doc = {
        docId: e.key,
        title: "sheet read",
        text: e.text,
        at: Date.now(),
      };
      if (row) await ctx.db.patch(row._id, doc);
      else await ctx.db.insert("docCache", doc);
    }
    return null;
  },
});

/** Load the cache into a Map an action can consult; entries past TTL are dropped. */
// biome-ignore lint/suspicious/noExplicitAny: action ctx
export async function loadSheetCache(ctx: any): Promise<SheetCache> {
  const map: SheetCache = new Map();
  try {
    // biome-ignore lint/suspicious/noExplicitAny: rows
    const rows: any[] = await ctx.runQuery(
      (await import("./_generated/api")).internal.sheetCache.all,
      {},
    );
    for (const r of rows)
      if (Date.now() - r.at < TTL_MS) {
        try {
          map.set(r.key, { at: r.at, data: JSON.parse(r.text) });
        } catch {
          // a bad row is simply not a hit
        }
      }
  } catch (e) {
    console.warn(`sheet cache load: ${String(e).slice(0, 120)}`);
  }
  return map;
}

/** Persist the entries an action fetched fresh (marked with at = 0 by the caller). */
// biome-ignore lint/suspicious/noExplicitAny: action ctx
export async function saveSheetCache(
  ctx: any,
  fresh: SheetCache,
): Promise<void> {
  const entries = [...fresh.entries()].map(([key, v]) => ({
    key,
    text: JSON.stringify(v.data),
  }));
  if (!entries.length) return;
  try {
    for (let i = 0; i < entries.length; i += 20)
      await ctx.runMutation(
        (await import("./_generated/api")).internal.sheetCache.save,
        { entries: entries.slice(i, i + 20) },
      );
  } catch (e) {
    console.warn(`sheet cache save: ${String(e).slice(0, 120)}`);
  }
}
