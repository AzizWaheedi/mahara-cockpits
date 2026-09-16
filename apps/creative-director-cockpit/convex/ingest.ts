import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { copyStills } from "./previews";

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
    // The media buyer's saved ad stills, copied into this deployment's own
    // file storage so pictures keep showing while its backend is down.
    case "storeStills":
      return await copyStills(ctx, args.stills);
    case "counts":
      return await ctx.runQuery(internal.sync.counts, {});
    case "driveCache":
      return await ctx.runQuery(internal.ingest.driveCacheInternal, {});
    case "statCache":
      return await ctx.runQuery(internal.ingest.statCacheInternal, {});
    // The outbox lives in clients.ts: claim before acting, bounded retries.
    case "outboxPending":
      return await ctx.runQuery(internal.clients.outboxPending, {});
    case "outboxSettle":
      return await ctx.runMutation(internal.clients.outboxSettle, {
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
    case "outboxClaim":
      return await ctx.runMutation(internal.clients.outboxClaim, {
        id: args.id,
      });
    case "sendFailed":
      return await ctx.runMutation(internal.comms.sendFailed, {
        chatId: String(args.chatId),
        error: String(args.error ?? "send failed"),
      });
    case "upsertMember":
      // A seat or client-list change in the portal's admin view.
      return await ctx.runMutation(internal.portalAuth.remember, {
        email: String(args.email),
        name: args.name ? String(args.name) : undefined,
        roles: Array.isArray(args.roles) ? args.roles.map(String) : [],
        clients: Array.isArray(args.clients) ? args.clients.map(String) : [],
      });
    case "storeMembers":
      return await ctx.runMutation(internal.portalAuth.storeMembers, {
        members: (Array.isArray(args.members) ? args.members : []).map(
          (m: Record<string, unknown>) => ({
            email: String(m.email ?? ""),
            name: m.name ? String(m.name) : undefined,
            roles: Array.isArray(m.roles) ? m.roles.map(String) : [],
            clients: Array.isArray(m.clients) ? m.clients.map(String) : [],
          }),
        ),
      });
    case "revokeMember":
      return await ctx.runAction(internal.portalAuth.revoke, {
        email: String(args.email),
      });
    case "markReplied":
      return await ctx.runMutation(internal.comms.markReplied, {
        chatId: String(args.chatId),
        text: String(args.text ?? ""),
      });
    // An action: every screen gets its own transaction, see smoke.ts.
    case "smoke":
      return await ctx.runAction(internal.smoke.run, {});
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

/** The only way plays, funnels and winners get written: through the door. */
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

/** Winner fields the media buyer can remove from a row it keeps. */
const CLEARED_WHEN_MISSING = [
  "retiredOn",
  "savedBy",
  "savedByName",
  "savedAt",
  "savedNote",
  "savedRange",
  "savedStats",
  "unsavedBy",
  "unsavedAt",
] as const;

/** The same value, whatever the key order of nested objects. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(norm)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>)
              .filter(([, y]) => y !== undefined)
              .sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))
              .map(([k, y]) => [k, norm(y)]),
          )
        : x;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * The media buyer's winners archive, mirrored. Rows are patched or inserted,
 * never deleted, so a "Save as winner" that was taken back arrives as
 * `unsavedAt` and the row stays. Preview links are no longer kept: a stored
 * one is cleared, and pages fetch a fresh preview when an ad is opened.
 *
 * The media buyer sends up to 500 rows after every sync. Only rows that
 * changed are written, plus one row that carries this push's time for the
 * freshness check, instead of rewriting every row on every push.
 */
export const storeWinnersInternal = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, { rows }) => {
    if (rows.length === 0) return { skipped: "empty payload" };
    const now = Date.now();
    // One row per ad. When the media buyer holds two, the saved one wins.
    const incoming = new Map<string, any>();
    for (const raw of rows) {
      if (!raw || typeof raw.adId !== "string" || !raw.adId) continue;
      const prev = incoming.get(raw.adId);
      if (!prev || (raw.savedAt ?? 0) > (prev.savedAt ?? 0))
        incoming.set(raw.adId, raw);
    }
    const existing = await ctx.db.query("winnersArchive").collect();
    const byAd = new Map<string, (typeof existing)[number]>();
    for (const r of existing) {
      const prev = byAd.get(r.adId);
      // Duplicates here are left alone; the saved one is the one kept up to date.
      if (!prev || (r.savedAt ?? 0) > (prev.savedAt ?? 0)) byAd.set(r.adId, r);
    }
    let inserted = 0;
    let patched = 0;
    let unchanged = 0;
    // The freshness check reads the newest syncedAt in the table.
    let stamped = false;
    for (const [adId, raw] of incoming) {
      const { previewSrc: _dropped, ...rest } = raw;
      const row = { ...rest, syncedAt: now };
      const prev = byAd.get(adId);
      if (prev) {
        // The media buyer leaves out a field it has removed (a note dropped on
        // a new save, the retired date of an ad that came back). A patch alone
        // would keep the old value here, so clear what it no longer sends.
        const gone: Record<string, undefined> = {};
        for (const f of CLEARED_WHEN_MISSING) {
          if (row[f] === undefined && prev[f] !== undefined)
            gone[f] = undefined;
        }
        const patch: Record<string, unknown> = {
          ...row,
          ...gone,
          ...(prev.previewSrc !== undefined ? { previewSrc: undefined } : {}),
        };
        const changed = Object.entries(patch).some(
          ([k, x]) =>
            k !== "syncedAt" &&
            !sameValue((prev as Record<string, unknown>)[k], x),
        );
        if (changed) {
          await ctx.db.patch(prev._id, patch);
          patched += 1;
        } else if (!stamped) {
          await ctx.db.patch(prev._id, { syncedAt: now });
          unchanged += 1;
        } else {
          unchanged += 1;
          continue;
        }
        stamped = true;
      } else {
        await ctx.db.insert("winnersArchive", row);
        inserted += 1;
        stamped = true;
      }
    }
    return { inserted, patched, unchanged };
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
