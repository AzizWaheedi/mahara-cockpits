import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";

/**
 * The feed door for the creative director's cockpit, reached over HTTP
 * (`POST /bridge`). The media buyer's backend pushes finished rows in here
 * after every sync; this deployment holds no integration credentials of its
 * own, which is what makes it safe to give the creative director his own URL.
 *
 * Guarded by a bearer token (BRIDGE_TOKEN on the deployment).
 */
declare const process: { env: Record<string, string | undefined> };

export const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? "";

// biome-ignore lint/suspicious/noExplicitAny: payloads are validated by the mutations
type Args = Record<string, any>;

export async function runBridge(
  ctx: ActionCtx,
  fn: string,
  args: Args,
): Promise<unknown> {
  switch (fn) {
    case "storeClients":
      return await ctx.runMutation(internal.sync.storeClients, {
        clients: args.clients,
      });
    case "storeCreative":
      return await ctx.runMutation(internal.sync.storeCreative, {
        tasks: args.tasks ?? [],
        videos: args.videos ?? [],
        posts: args.posts ?? [],
      });
    case "storeAdPerformance":
      return await ctx.runMutation(internal.sync.storeAdPerformance, {
        ads: args.ads,
        campaigns: args.campaigns ?? [],
        tree: args.tree,
      });
    case "storeBlueprints":
      return await ctx.runMutation(internal.sync.storeBlueprints, {
        rows: args.rows,
      });
    case "storeFunnels":
      return await ctx.runMutation(internal.ingest.storeFunnelsInternal, {
        rows: args.rows,
      });
    case "storePlays":
      return await ctx.runMutation(internal.ingest.storePlaysInternal, {
        plays: args.plays,
      });
    case "storeWinners":
      return await ctx.runMutation(internal.ingest.storeWinnersInternal, {
        rows: args.rows,
      });
    case "counts":
      return await ctx.runQuery(internal.sync.counts, {});
    case "driveCache":
      return await ctx.runQuery(internal.ingest.driveCacheInternal, {});
    case "statCache":
      return await ctx.runQuery(internal.ingest.statCacheInternal, {});
    case "outboxPending":
      return await ctx.runQuery(internal.ingest.outboxPendingInternal, {});
    case "outboxSettle":
      return await ctx.runMutation(internal.ingest.outboxSettleInternal, {
        id: args.id,
        ok: args.ok,
        result: args.result,
      });
    case "storeCalendar":
      return await ctx.runMutation(internal.comms.storeCalendar, {
        rows: args.rows ?? [],
        append: Boolean(args.append),
      });
    case "calendarLinks":
      return await ctx.runQuery(internal.comms.calendarLinks, {});
    case "calendarLinkStatus":
      return await ctx.runMutation(internal.comms.calendarLinkStatus, {
        statuses: args.statuses ?? [],
      });
    case "chatPending":
      return await ctx.runQuery(internal.hermes.pending, {});
    case "chatSent":
      return await ctx.runMutation(internal.hermes.markSent, {
        id: args.id,
        jobId: String(args.jobId),
      });
    case "chatReading":
      return await ctx.runMutation(internal.hermes.markReading, {
        id: args.id,
      });
    case "chatAnswer":
      return await ctx.runMutation(internal.hermes.answer, {
        id: args.id,
        text: args.text,
        error: args.error,
      });
    case "storeReplyDraft":
      return await ctx.runMutation(internal.comms.storeReplyDraft, {
        chatId: String(args.chatId),
        draft: String(args.draft),
        draftAt: Number(args.draftAt ?? Date.now()),
      });
    case "markReplied":
      return await ctx.runMutation(internal.comms.markReplied, {
        chatId: String(args.chatId),
        text: String(args.text ?? ""),
      });
    case "smoke":
      return await ctx.runQuery(internal.smoke.run, {});
    case "storeWhatsapp":
      return await ctx.runMutation(internal.comms.storeWhatsapp, {
        threads: args.threads ?? [],
        append: Boolean(args.append),
        clear: Boolean(args.clear),
      });
    default:
      throw new Error(`unknown bridge function: ${fn}`);
  }
}

/** Same bodies as the public `sync.storePlays` / `storeFunnels` / `winners.store`, reachable from the door. */
export const storePlaysInternal = internalMutation({
  args: { plays: v.array(v.any()) },
  returns: v.object({ plays: v.number() }),
  handler: async (ctx, { plays }) => {
    if (plays.length === 0) {
      throw new Error(
        "storePlays received nothing — refusing to wipe the playbook",
      );
    }
    const now = Date.now();
    for (const row of await ctx.db.query("marketPlays").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of plays) {
      await ctx.db.insert("marketPlays", { ...row, syncedAt: now });
    }
    return { plays: plays.length };
  },
});

export const storeFunnelsInternal = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ funnels: v.number() }),
  handler: async (ctx, { rows }) => {
    if (rows.length === 0) {
      throw new Error("storeFunnels received nothing — refusing to wipe");
    }
    const now = Date.now();
    for (const row of await ctx.db.query("funnels").collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of rows) {
      await ctx.db.insert("funnels", { ...row, syncedAt: now });
    }
    return { funnels: rows.length };
  },
});

export const storeWinnersInternal = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, { rows }) => {
    if (rows.length === 0) return { skipped: "empty payload" };
    const now = Date.now();
    const existing = await ctx.db.query("winnersArchive").collect();
    const byAd = new Map(existing.map(r => [r.adId, r]));
    let inserted = 0;
    let patched = 0;
    for (const raw of rows) {
      const row = { ...raw, syncedAt: now };
      const prev = byAd.get(row.adId);
      if (prev) {
        await ctx.db.patch(prev._id, row);
        byAd.delete(row.adId);
        patched += 1;
      } else {
        await ctx.db.insert("winnersArchive", row);
        inserted += 1;
      }
    }
    return { inserted, patched };
  },
});

export const driveCacheInternal = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (await ctx.db.query("clients").collect()).map(c => ({
      name: c.name,
      driveFolderId: c.driveFolderId,
      driveSubfolders: c.driveSubfolders,
      driveScannedAt: c.driveScannedAt,
    })),
});

export const statCacheInternal = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const out: Record<string, unknown> = {};
    for (const c of await ctx.db.query("clients").collect()) {
      out[c.name] = { stats: c.stats, statsScannedAt: c.statsScannedAt };
    }
    return out;
  },
});

export const outboxPendingInternal = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (
      await ctx.db
        .query("creativeOutbox")
        .withIndex("by_state", q => q.eq("state", "pending"))
        .collect()
    ).map(r => ({
      id: r._id,
      kind: r.kind,
      taskId: r.taskId,
      payload: r.payload,
      createdAt: r.createdAt,
    })),
});

export const outboxSettleInternal = internalMutation({
  args: {
    id: v.id("creativeOutbox"),
    ok: v.boolean(),
    result: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ok, result }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, {
      state: ok ? "done" : "failed",
      result: (result ?? "").slice(0, 300),
      settledAt: Date.now(),
    });
    return null;
  },
});
