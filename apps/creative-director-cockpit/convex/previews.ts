import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { authenticatedAction, authenticatedQuery } from "./functions";
import { allowedClients, hasAccess, inScope } from "./roles";

/**
 * Ad pictures and live previews for the creative director's cockpit.
 *
 * Meta's links expire (a preview iframe after about a day, an image after a
 * few days), so this cockpit keeps two things instead:
 * - its own copy of every still the media buyer saved (`adStills`), pushed
 *   through the bridge (`storeStills`), so pictures keep showing while the
 *   media buyer's backend is down;
 * - no preview links at all. A live preview is fetched when someone opens an
 *   ad, through the media buyer's `/bridge/preview` route, with the bridge
 *   token this deployment already holds.
 *
 * Nothing here logs a preview link or a storage URL: both work for anyone
 * who has them.
 */

declare const process: { env: Record<string, string | undefined> };

/** Same default as portalAuth.ts: the media buyer deployment's site URL. */
const PORTAL_SITE_URL =
  process.env.PORTAL_SITE_URL || "https://adorable-seahorse-418.convex.site";

/** The token the media buyer uses on this cockpit's bridge, the same one it accepts back. */
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? "";

/** This cockpit's name on the media buyer's preview route. */
const COCKPIT = "creative";

const AD_ID = /^\d{5,25}$/;
const REASONS = new Set([
  "gone",
  "no_meta_access",
  "rate_limited",
  "error",
  "no_access",
  "offline",
]);

/** What `fresh` returns. The same shape in all three cockpits. */
export type PreviewResult = {
  ok: boolean;
  adId: string;
  src?: string;
  width?: number;
  height?: number;
  fetchedAt?: number;
  expiresAt?: number;
  stillKey?: string;
  stillUrl?: string;
  stillTinyUrl?: string;
  thumbUrl?: string;
  thumbExpiresAt?: number;
  accountId?: string;
  reason?: string;
  message?: string;
};

export const vPreviewResult = v.object({
  ok: v.boolean(),
  adId: v.string(),
  src: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  fetchedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  stillKey: v.optional(v.string()),
  stillUrl: v.optional(v.string()),
  stillTinyUrl: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  thumbExpiresAt: v.optional(v.number()),
  accountId: v.optional(v.string()),
  reason: v.optional(v.string()),
  message: v.optional(v.string()),
});

// This module's own internal functions, by name, so it compiles before the
// generated api lists the module. They can become internal.previews.* after
// the next codegen.
const gateRef = makeFunctionReference<
  "query",
  {
    userId: Id<"users">;
    adId: string;
    campaignName?: string;
    clientName?: string;
  },
  { email: string; allowed: boolean }
>("previews:gate");

type StillState = {
  key: string;
  status: string;
  settled: boolean;
  attempts: number;
  sourceSavedAt: number;
};
const stillRowsRef = makeFunctionReference<
  "query",
  { keys: string[] },
  StillState[]
>("previews:stillRows");

type StillWrite = {
  key: string;
  sourceSavedAt: number;
  sourceUrl: string;
  ok: boolean;
  storageId?: Id<"_storage">;
  tinyStorageId?: Id<"_storage">;
  error?: string;
};
const recordStillsRef = makeFunctionReference<
  "mutation",
  { rows: StillWrite[] },
  { copied: number; failed: number; settledFailures: number }
>("previews:recordStills");

/* ---------------------------------------------------------------------------
 * Live preview, on demand
 * ------------------------------------------------------------------------ */

/**
 * Who is asking, and may they see this ad. Winners are company-wide, like
 * the rest of What works. Any other ad needs its campaign's client on the
 * person's list; the page passes the campaign so this stays a few indexed
 * reads rather than a scan.
 */
export const gate = internalQuery({
  args: {
    userId: v.id("users"),
    adId: v.string(),
    campaignName: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  returns: v.object({ email: v.string(), allowed: v.boolean() }),
  handler: async (ctx, { userId, adId, campaignName }) => {
    const user = await ctx.db.get(userId);
    let email = String(user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) {
      const identity = await ctx.auth.getUserIdentity();
      email = String(identity?.email ?? "")
        .trim()
        .toLowerCase();
    }
    if (!email || !(await hasAccess(ctx, email)))
      return { email, allowed: false };
    const scope = await allowedClients({ db: ctx.db, userId });
    if (!scope) return { email, allowed: true };

    const winner = await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", q => q.eq("adId", adId))
      .first();
    if (winner) return { email, allowed: true };

    if (!campaignName) return { email, allowed: false };
    const nodes = await ctx.db
      .query("metaTree")
      .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
      .collect();
    let found = nodes.some(n => n.metaId === adId);
    if (!found) {
      const ads = await ctx.db
        .query("ads")
        .withIndex("by_ad", q => q.eq("campaignName", campaignName))
        .collect();
      found = ads.some(a => a.metaAdId === adId);
    }
    if (!found) return { email, allowed: false };
    const campaign = await ctx.db
      .query("campaigns")
      .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
      .first();
    return {
      email,
      allowed: inScope(scope, campaign?.clientName ?? campaign?.accountName),
    };
  },
});

/**
 * Meta's live preview of one ad, fetched through the media buyer system.
 * This cockpit caches nothing: the media buyer keeps each link for 20 hours,
 * and the browser keeps answers for the page's life.
 */
export const fresh = authenticatedAction({
  args: {
    adId: v.string(),
    campaignName: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  returns: vPreviewResult,
  handler: async (ctx, args): Promise<PreviewResult> => {
    const adId = args.adId.trim();
    if (!AD_ID.test(adId))
      return {
        ok: false,
        adId,
        reason: "error",
        message: "That is not a Meta ad id.",
      };
    const who = await ctx.runQuery(gateRef, {
      userId: ctx.userId,
      adId,
      campaignName: args.campaignName,
      clientName: args.clientName,
    });
    if (!who.allowed)
      return {
        ok: false,
        adId,
        reason: "no_access",
        message:
          "This client is not on your list, so the live preview is not available to you.",
      };
    return await askMediaBuyer(adId, who.email);
  },
});

async function askMediaBuyer(
  adId: string,
  email: string,
): Promise<PreviewResult> {
  const offline: PreviewResult = {
    ok: false,
    adId,
    reason: "offline",
    message:
      "The live preview comes through the media buyer system, which is offline right now.",
  };
  if (!BRIDGE_TOKEN) return offline;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${PORTAL_SITE_URL}/bridge/preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BRIDGE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ adId, email, cockpit: COCKPIT }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status >= 500) return offline;
    const body: unknown = await res.json().catch(() => null);
    // Anything that is not a preview answer (for example Convex's own error
    // for a disabled or missing deployment) means the system is not there.
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as { ok?: unknown }).ok !== "boolean"
    )
      return offline;
    return cleanResult(body as Record<string, unknown>, adId);
  } catch {
    return offline;
  } finally {
    clearTimeout(timer);
  }
}

function httpsUrl(x: unknown): string | undefined {
  if (typeof x !== "string" || x.length > 4000) return undefined;
  try {
    return new URL(x).protocol === "https:" ? x : undefined;
  } catch {
    return undefined;
  }
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function str(x: unknown, max = 300): string | undefined {
  return typeof x === "string" && x ? x.slice(0, max) : undefined;
}

/**
 * Error text with any link taken out. A storage link works for anyone who
 * has it, and these texts end up in the daily check's Slack alert.
 */
function withoutLinks(text: unknown, max = 120): string {
  return String(text)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "(link)")
    .slice(0, max);
}

/** Only the known fields, each checked, so a bad answer cannot reach the page. */
function cleanResult(
  body: Record<string, unknown>,
  adId: string,
): PreviewResult {
  const src = httpsUrl(body.src);
  const ok = body.ok === true && Boolean(src);
  const reason = str(body.reason, 40);
  const out: PreviewResult = {
    ok,
    adId,
    src: ok ? src : undefined,
    width: num(body.width),
    height: num(body.height),
    fetchedAt: num(body.fetchedAt),
    expiresAt: num(body.expiresAt),
    stillKey: str(body.stillKey, 200),
    stillUrl: httpsUrl(body.stillUrl),
    stillTinyUrl: httpsUrl(body.stillTinyUrl),
    thumbUrl: httpsUrl(body.thumbUrl),
    thumbExpiresAt: num(body.thumbExpiresAt),
    accountId: str(body.accountId, 40),
    reason: ok ? undefined : reason && REASONS.has(reason) ? reason : "error",
    message: ok ? undefined : str(body.message),
  };
  return Object.fromEntries(
    Object.entries(out).filter(([, x]) => x !== undefined),
  ) as PreviewResult;
}

/* ---------------------------------------------------------------------------
 * Saved stills, this cockpit's own copies
 * ------------------------------------------------------------------------ */

/**
 * The saved pictures for the rows a page shows, keyed by still key. Pages
 * call this once with every key they render; it only re-runs when one of
 * those rows changes, not on every feed.
 */
export const stillUrls = authenticatedQuery({
  args: { keys: v.array(v.string()) },
  returns: v.record(
    v.string(),
    v.object({ url: v.optional(v.string()), tinyUrl: v.optional(v.string()) }),
  ),
  handler: async (ctx, { keys }) => {
    const user = await ctx.db.get(ctx.userId);
    if (!(await hasAccess(ctx, user?.email))) return {};
    const out: Record<string, { url?: string; tinyUrl?: string }> = {};
    const wanted = [...new Set(keys)]
      .filter(k => /^[ac]:\d{1,30}$/.test(k))
      .slice(0, 400);
    for (const key of wanted) {
      const row = await ctx.db
        .query("adStills")
        .withIndex("by_key", q => q.eq("key", key))
        .first();
      if (row?.status !== "copied" || !row.url) continue;
      out[key] = row.tinyUrl
        ? { url: row.url, tinyUrl: row.tinyUrl }
        : { url: row.url };
    }
    return out;
  },
});

/**
 * The media buyer sends every still saved after this. It is the newest
 * settled copy (copied, or given up after three tries), so a still that
 * failed once is sent again on the next push.
 */
export async function stillsWatermark(ctx: QueryCtx): Promise<number> {
  const row = await ctx.db
    .query("adStills")
    .withIndex("by_settled", q => q.eq("settled", true))
    .order("desc")
    .first();
  return row?.sourceSavedAt ?? 0;
}

/** Tries before a still is given up on and the watermark moves past it. */
const MAX_ATTEMPTS = 3;
/** Stop copying after this long and leave the rest for the next push. */
const BUDGET_MS = 45_000;
const FULL_MAX_BYTES = 250_000;
const TINY_MAX_BYTES = 60_000;
const MIN_BYTES = 200;

export const stillRows = internalQuery({
  args: { keys: v.array(v.string()) },
  returns: v.array(
    v.object({
      key: v.string(),
      status: v.string(),
      settled: v.boolean(),
      attempts: v.number(),
      sourceSavedAt: v.number(),
    }),
  ),
  handler: async (ctx, { keys }) => {
    const out: StillState[] = [];
    for (const key of keys) {
      const row = await ctx.db
        .query("adStills")
        .withIndex("by_key", q => q.eq("key", key))
        .first();
      if (row)
        out.push({
          key,
          status: row.status,
          settled: row.settled,
          attempts: row.attempts,
          sourceSavedAt: row.sourceSavedAt,
        });
    }
    return out;
  },
});

/** One write per push: the copies made and the tries that failed. */
export const recordStills = internalMutation({
  args: {
    rows: v.array(
      v.object({
        key: v.string(),
        sourceSavedAt: v.number(),
        sourceUrl: v.string(),
        ok: v.boolean(),
        storageId: v.optional(v.id("_storage")),
        tinyStorageId: v.optional(v.id("_storage")),
        error: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    copied: v.number(),
    failed: v.number(),
    settledFailures: v.number(),
  }),
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    let copied = 0;
    let failed = 0;
    let settledFailures = 0;
    for (const r of rows) {
      const prev = await ctx.db
        .query("adStills")
        .withIndex("by_key", q => q.eq("key", r.key))
        .first();
      if (r.ok && r.storageId) {
        const url = (await ctx.storage.getUrl(r.storageId)) ?? undefined;
        const tinyUrl = r.tinyStorageId
          ? ((await ctx.storage.getUrl(r.tinyStorageId)) ?? undefined)
          : undefined;
        const doc = {
          key: r.key,
          status: "copied" as const,
          storageId: r.storageId,
          url,
          tinyStorageId: r.tinyStorageId,
          tinyUrl,
          sourceSavedAt: r.sourceSavedAt,
          sourceUrl: r.sourceUrl,
          settled: true,
          attempts: (prev?.attempts ?? 0) + 1,
          lastError: undefined,
          copiedAt: now,
        };
        if (prev) {
          // A replaced copy leaves no orphan file behind.
          for (const old of [prev.storageId, prev.tinyStorageId]) {
            if (old && old !== r.storageId && old !== r.tinyStorageId)
              await ctx.storage.delete(old);
          }
          await ctx.db.replace(prev._id, doc);
        } else {
          await ctx.db.insert("adStills", doc);
        }
        copied++;
        continue;
      }
      if (prev?.status === "copied") {
        // A newer save of a still we already hold failed to copy. The older
        // copy is still a good picture, so keep it and move on.
        await ctx.db.patch(prev._id, {
          lastError: r.error,
          sourceSavedAt: Math.max(prev.sourceSavedAt, r.sourceSavedAt),
        });
        failed++;
        continue;
      }
      const attempts = (prev?.attempts ?? 0) + 1;
      const settled = attempts >= MAX_ATTEMPTS;
      if (prev) {
        await ctx.db.patch(prev._id, {
          status: "failed",
          attempts,
          settled,
          lastError: r.error,
          sourceSavedAt: r.sourceSavedAt,
          sourceUrl: r.sourceUrl,
        });
      } else {
        await ctx.db.insert("adStills", {
          key: r.key,
          status: "failed",
          sourceSavedAt: r.sourceSavedAt,
          sourceUrl: r.sourceUrl,
          settled,
          attempts,
          lastError: r.error,
        });
      }
      failed++;
      if (settled) settledFailures++;
    }
    return { copied, failed, settledFailures };
  },
});

type IncomingStill = {
  key: string;
  url: string;
  tinyUrl?: string;
  savedAt: number;
};

/** Download one image and keep it, or say why not. */
async function fetchImage(
  ctx: ActionCtx,
  url: string,
  maxBytes: number,
): Promise<{ id?: Id<"_storage">; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!type.startsWith("image/")) return { error: "not an image" };
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength < MIN_BYTES || bytes.byteLength > maxBytes)
      return { error: `unexpected size ${bytes.byteLength}` };
    const id = await ctx.storage.store(new Blob([bytes], { type }));
    return { id };
  } catch (e) {
    return {
      error: controller.signal.aborted ? "timed out" : withoutLinks(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The bridge's `storeStills`: copy the media buyer's saved stills into this
 * deployment's file storage, oldest first. The first failure that is not yet
 * given up on stops the run, so the watermark stays before it and the same
 * still comes again on the next push. Runs in the HTTP action, which can
 * store files.
 */
export async function copyStills(
  ctx: ActionCtx,
  raw: unknown,
): Promise<{ copied: number; failed: number }> {
  const started = Date.now();
  const latest = new Map<string, IncomingStill>();
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key : "";
    const url = httpsUrl(o.url);
    const savedAt = num(o.savedAt);
    if (!/^[ac]:\d{1,30}$/.test(key) || !url || savedAt === undefined) continue;
    const prev = latest.get(key);
    if (prev && prev.savedAt >= savedAt) continue;
    latest.set(key, { key, url, tinyUrl: httpsUrl(o.tinyUrl), savedAt });
  }
  const stills = [...latest.values()]
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(0, 100);
  if (stills.length === 0) return { copied: 0, failed: 0 };

  const known = new Map(
    (await ctx.runQuery(stillRowsRef, { keys: stills.map(s => s.key) })).map(
      r => [r.key, r],
    ),
  );
  const writes: StillWrite[] = [];
  for (const s of stills) {
    if (Date.now() - started > BUDGET_MS) break;
    const prev = known.get(s.key);
    // Already copied from this save or a later one.
    if (prev?.status === "copied" && prev.sourceSavedAt >= s.savedAt) continue;
    const full = await fetchImage(ctx, s.url, FULL_MAX_BYTES);
    if (!full.id) {
      writes.push({
        key: s.key,
        sourceSavedAt: s.savedAt,
        sourceUrl: s.url,
        ok: false,
        error: full.error,
      });
      // Stop at a failure that will be tried again, so nothing after it
      // moves the watermark past it.
      if (prev?.status !== "copied" && (prev?.attempts ?? 0) + 1 < MAX_ATTEMPTS)
        break;
      continue;
    }
    // A missing or oversized small copy is not a failure: pages use the
    // full copy in its place.
    const tiny = s.tinyUrl
      ? await fetchImage(ctx, s.tinyUrl, TINY_MAX_BYTES)
      : {};
    writes.push({
      key: s.key,
      sourceSavedAt: s.savedAt,
      sourceUrl: s.url,
      ok: true,
      storageId: full.id,
      tinyStorageId: tiny.id,
    });
  }
  if (writes.length === 0) return { copied: 0, failed: 0 };
  try {
    const done = await ctx.runMutation(recordStillsRef, { rows: writes });
    return { copied: done.copied, failed: done.failed };
  } catch (e) {
    // Nothing points at the files stored above, and the same stills come
    // again on the next push: remove them so storage does not fill up.
    for (const w of writes) {
      for (const id of [w.storageId, w.tinyStorageId]) {
        if (id) await ctx.storage.delete(id).catch(() => undefined);
      }
    }
    throw e;
  }
}

/**
 * For the daily smoke check: stills saved in the last seven days that this
 * cockpit gave up copying. Empty when everything arrived.
 */
export async function stillsCopyProblem(
  ctx: QueryCtx,
  now = Date.now(),
): Promise<string | null> {
  const rows = await ctx.db
    .query("adStills")
    .withIndex("by_settled", q =>
      q.eq("settled", true).gte("sourceSavedAt", now - 7 * 86_400_000),
    )
    .collect();
  const failed = rows.filter(r => r.status === "failed");
  if (failed.length === 0) return null;
  return `${failed.length} saved ${failed.length === 1 ? "picture" : "pictures"} from the last 7 days could not be copied into this cockpit (last error: ${withoutLinks(failed[failed.length - 1].lastError ?? "unknown", 80)})`;
}
