import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { authenticatedAction } from "./functions";
import { recordManyDirect } from "./health";
import {
  cachedPreviewUsable,
  captureOnOpen,
  creativeImageCandidates,
  formatUnsupported,
  hasPicture,
  isAutoWinner,
  isMetaId,
  isSavedWinner,
  metaErrorCodes,
  metaErrorReason,
  metaImageExpiry,
  metaImageUsable,
  PREVIEW_MESSAGES,
  type PreviewLink,
  type PreviewResult,
  parsePreviewBody,
  previewAnswer,
  previewFormat,
  previewTtlMs,
  readCreativeCopy,
  STILL_FULL_MAX_BYTES,
  STILL_TINY_MAX_BYTES,
  stillCaptureDue,
  stillFailure,
  stillGap,
  stillKeyFor,
  stillProblem,
} from "./metaMedia";
import { accessFor } from "./roles";

/**
 * Ad previews that never break.
 *
 * Meta's preview links last a day and its image links a few days, so no
 * stored Meta link is trusted. Two things replace them:
 *
 * 1. A live preview fetched when someone opens one (`fresh`, and the
 *    `/bridge/preview` door for the other two cockpits). The answer is
 *    cached for 20 hours per ad in `previewLinks`, shared by all three.
 * 2. One small still per creative saved in our own file storage
 *    (`adStills`, about 320px and 96px), fetched once and kept, so a
 *    winner keeps its picture after the ad is deleted in Meta.
 *
 * Captures run from the existing sync, the daily winners pass, a manual
 * "Save as winner" and the first time someone opens a preview. There is no
 * schedule of its own. A daily check inside the smoke check (`rotCheck`)
 * says when pictures are missing or do not load.
 *
 * Never log a preview link or a storage link: both work for anyone who has
 * them. Logs carry counts only.
 */

export type { PreviewResult } from "./metaMedia";

declare const process: { env: Record<string, string | undefined> };

type Any = any;

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

const vCaptureItem = v.object({
  adId: v.optional(v.string()),
  creativeId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  campaignName: v.optional(v.string()),
  /** A Meta CDN picture already in hand (a row's thumbnail), used before any Graph call. */
  sourceUrl: v.optional(v.string()),
  /** Used by a winner: never pruned. */
  keep: v.optional(v.boolean()),
});
export type CaptureItem = {
  adId?: string;
  creativeId?: string;
  accountId?: string;
  campaignName?: string;
  sourceUrl?: string;
  keep?: boolean;
};

const vStatus = v.union(
  v.literal("saved"),
  v.literal("failed"),
  v.literal("gone"),
);

const vOutcome = v.object({
  key: v.string(),
  /** The key the caller asked for, when the capture found the creative id. */
  requestedKey: v.optional(v.string()),
  adId: v.optional(v.string()),
  creativeId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  campaignName: v.optional(v.string()),
  status: vStatus,
  countAttempt: v.boolean(),
  error: v.optional(v.string()),
  source: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  url: v.optional(v.string()),
  tinyStorageId: v.optional(v.id("_storage")),
  tinyUrl: v.optional(v.string()),
  bytes: v.optional(v.number()),
  tinyBytes: v.optional(v.number()),
  contentType: v.optional(v.string()),
  keep: v.optional(v.boolean()),
  /** The key was already settled: only point the rows at it. */
  linkOnly: v.optional(v.boolean()),
});
type Outcome = {
  key: string;
  requestedKey?: string;
  adId?: string;
  creativeId?: string;
  accountId?: string;
  campaignName?: string;
  status: "saved" | "failed" | "gone";
  countAttempt: boolean;
  error?: string;
  source?: string;
  storageId?: Id<"_storage">;
  url?: string;
  tinyStorageId?: Id<"_storage">;
  tinyUrl?: string;
  bytes?: number;
  tinyBytes?: number;
  contentType?: string;
  keep?: boolean;
  linkOnly?: boolean;
};

const vStillResult = v.object({
  key: v.string(),
  status: vStatus,
  url: v.optional(v.string()),
  tinyUrl: v.optional(v.string()),
});
type StillResult = {
  key: string;
  status: "saved" | "failed" | "gone";
  url?: string;
  tinyUrl?: string;
};

const vLink = v.object({
  src: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  fetchedAt: v.number(),
  expiresAt: v.number(),
  thumbUrl: v.optional(v.string()),
  thumbExpiresAt: v.optional(v.number()),
  reason: v.optional(v.string()),
  error: v.optional(v.string()),
});
type Link = PreviewLink;

const MAX_PER_RUN = 30;
const IN_FLIGHT = 4;
const RUN_BUDGET_MS = 55_000;
/** The child cockpits give up after 20 seconds, so a preview answers within 16. */
const PREVIEW_BUDGET_MS = 16_000;

const REFUSED =
  "This cockpit is not yours. Ask Aziz to give you access in the portal.";

/** Drop undefined and null fields: Convex validators reject null for optionals. */
function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, x]) => x !== undefined && x !== null),
  ) as T;
}

// --- Outside calls ----------------------------------------------------------------

/**
 * One Graph read with a hard time limit. Not graph() from tools.ts: that one
 * notes every refusal in the health ledger, and a deleted ad or an unshared
 * account is an answer here, not an outage. Token failures are recorded by
 * the callers (`noteTokenFailure`). The link carries the token, so it never
 * goes into an error.
 */
async function metaGet<T = Any>(
  path: string,
  params: Record<string, string | number>,
  timeoutMs: number,
): Promise<T> {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN not set");
  const qs = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, x]) => [k, String(x)]),
    ),
    access_token: token,
  });
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        ac.abort();
        reject(new Error("Meta did not answer in time"));
      },
      Math.max(500, timeoutMs),
    );
  });
  try {
    const res = await Promise.race([
      fetch(`https://graph.facebook.com/v21.0/${path}?${qs}`, {
        signal: ac.signal,
      }).catch(() => {
        throw new Error(
          ac.signal.aborted
            ? "Meta did not answer in time"
            : "Meta request failed (network)",
        );
      }),
      timeout,
    ]);
    const json: Any = await Promise.race([
      res.json().catch(() => ({
        error: { code: 0, message: `HTTP ${res.status}, not JSON` },
      })),
      timeout,
    ]);
    if (json?.error) {
      const e = json.error;
      throw new Error(
        `Meta ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}: ${String(e.message ?? "").slice(0, 200)}${e.error_user_msg ? ` (${String(e.error_user_msg).slice(0, 120)})` : ""}`,
      );
    }
    return json as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A dead token is an outage the ledger must see; a deleted ad is not. */
async function noteTokenFailure(ctx: ActionCtx, err: unknown): Promise<void> {
  const { code, text } = metaErrorCodes(err);
  if (code !== 190) return;
  try {
    await recordManyDirect(ctx, [
      { source: "meta", ok: false, error: text.slice(0, 160) },
    ]);
  } catch (e) {
    console.error(`previews: ledger write failed: ${String(e).slice(0, 80)}`);
  }
}

type Download =
  | { ok: true; blob: Blob; type: string; bytes: number }
  | { ok: false; error: string };

/** Fetch a picture and check it is a real image of a sane size. */
async function download(
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<Download> {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: "not https" };
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Download>(resolve => {
    timer = setTimeout(
      () => {
        ac.abort();
        resolve({ ok: false, error: "download timed out" });
      },
      Math.max(500, timeoutMs),
    );
  });
  const run = async (): Promise<Download> => {
    let res: Response;
    try {
      res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    } catch {
      return { ok: false, error: "download failed (network)" };
    }
    const type = String(res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (res.status === 200 && declared > maxBytes) {
      ac.abort();
      return { ok: false, error: `too big (${declared} bytes)` };
    }
    let buf: ArrayBuffer;
    try {
      buf = await res.arrayBuffer();
    } catch {
      return { ok: false, error: "download cut off" };
    }
    const problem = stillProblem(res.status, type, buf.byteLength, maxBytes);
    if (problem) return { ok: false, error: problem };
    return {
      ok: true,
      blob: new Blob([buf], { type }),
      type,
      bytes: buf.byteLength,
    };
  };
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Delete files that no row will point at. Never throws. */
async function dropFiles(
  ctx: ActionCtx,
  outcomes: { storageId?: Id<"_storage">; tinyStorageId?: Id<"_storage"> }[],
): Promise<void> {
  for (const o of outcomes)
    for (const id of [o.storageId, o.tinyStorageId]) {
      if (!id) continue;
      try {
        await ctx.storage.delete(id);
      } catch (e) {
        console.error(`stills: file cleanup failed: ${String(e).slice(0, 80)}`);
      }
    }
}

/** Run `fn` over `items`, `n` at a time. */
async function pool<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// --- Capturing one still ------------------------------------------------------------

type Captured = Outcome & {
  /** A fresh Meta CDN picture seen on the way, for the preview's fallback. */
  seenUrl?: string;
};

/**
 * Save one creative's still: the 320px file, and the 96px one when Meta
 * gives it. Stores the files and reads their links; the database is written
 * by `recordStills`, which also throws away a duplicate.
 */
async function captureOne(
  ctx: ActionCtx,
  item: CaptureItem,
  deadline: number,
): Promise<Captured | null> {
  const left = () => deadline - Date.now();
  const step = (ms: number) => Math.min(ms, Math.max(0, left()));
  if (left() < 2_000) return null;
  const requestedKey = stillKeyFor(item.creativeId, item.adId);
  if (!requestedKey) return null;
  let creativeId = item.creativeId;
  let accountId = item.accountId;
  let seenUrl: string | undefined;
  const base = () => ({
    requestedKey:
      requestedKey !== stillKeyFor(creativeId, item.adId)
        ? requestedKey
        : undefined,
    adId: item.adId,
    creativeId,
    accountId,
    campaignName: item.campaignName,
    keep: item.keep,
  });
  const fail = (err: unknown): Captured => {
    const f = stillFailure(err);
    return clean({
      ...base(),
      key: stillKeyFor(creativeId, item.adId) ?? requestedKey,
      status: f.status,
      countAttempt: f.countAttempt,
      error: String(err instanceof Error ? err.message : err).slice(0, 160),
      seenUrl,
    });
  };
  const store = async (
    full: { blob: Blob; type: string; bytes: number },
    tiny: { blob: Blob; bytes: number } | undefined,
    source: string,
  ): Promise<Captured> => {
    let storageId: Id<"_storage"> | undefined;
    let url: string | undefined;
    let tinyStorageId: Id<"_storage"> | undefined;
    let tinyUrl: string | undefined;
    try {
      storageId = await ctx.storage.store(full.blob);
      url = (await ctx.storage.getUrl(storageId)) ?? undefined;
      if (tiny) {
        tinyStorageId = await ctx.storage.store(tiny.blob);
        tinyUrl = (await ctx.storage.getUrl(tinyStorageId)) ?? undefined;
      }
      if (!url) throw new Error("file storage gave no link");
    } catch (e) {
      // A file stored without a row pointing at it would never be cleaned up.
      await dropFiles(ctx, [{ storageId, tinyStorageId }]);
      return fail(
        new Error(
          `file storage: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`,
        ),
      );
    }
    return clean({
      ...base(),
      key: stillKeyFor(creativeId, item.adId) ?? requestedKey,
      status: "saved" as const,
      countAttempt: false,
      source,
      storageId,
      url,
      tinyStorageId,
      tinyUrl,
      bytes: full.bytes,
      tinyBytes: tiny?.bytes,
      contentType: full.type,
      seenUrl,
    });
  };

  // A picture already in hand, with no creative id to go on: no Graph call.
  if (!creativeId && item.sourceUrl && metaImageUsable(item.sourceUrl)) {
    seenUrl = item.sourceUrl;
    const got = await download(
      item.sourceUrl,
      STILL_FULL_MAX_BYTES,
      step(10_000),
    );
    if (got.ok) return await store(got, undefined, "row_url");
  }

  try {
    if (!creativeId) {
      if (!item.adId) throw new Error("no ad or creative id");
      if (left() < 2_000) return null;
      const ad = await metaGet(
        item.adId,
        { fields: "account_id,creative{id}" },
        step(8_000),
      );
      creativeId = ad?.creative?.id ? String(ad.creative.id) : undefined;
      accountId =
        accountId ??
        (ad?.account_id
          ? String(ad.account_id).replace(/^act_/, "")
          : undefined);
      if (!creativeId) throw new Error("Meta returned no creative for the ad");
      // Another ad with this creative may have settled it already.
      const key = `c:${creativeId}`;
      const known = await ctx.runQuery(internal.previews.stillState, { key });
      if (known && !stillCaptureDue(known, Date.now()))
        return clean({
          ...base(),
          key,
          status: known.status,
          countAttempt: false,
          linkOnly: true,
          url: known.url,
          tinyUrl: known.tinyUrl,
          seenUrl,
        });
    }

    if (left() < 2_000) return null;
    const sized = async (px: number) =>
      (
        await metaGet(
          creativeId as string,
          {
            fields: "thumbnail_url",
            thumbnail_width: px,
            thumbnail_height: px,
          },
          step(8_000),
        )
      )?.thumbnail_url as string | undefined;

    const fullUrl = await sized(320);
    if (fullUrl) {
      seenUrl = fullUrl;
      const full = await download(fullUrl, STILL_FULL_MAX_BYTES, step(10_000));
      if (!full.ok) throw new Error(`picture: ${full.error}`);
      let tiny: Download | undefined;
      if (left() > 3_000) {
        try {
          const tinyUrl = await sized(96);
          if (tinyUrl)
            tiny = await download(tinyUrl, STILL_TINY_MAX_BYTES, step(8_000));
        } catch {
          // The small file is optional; the UI uses the 320px one instead.
        }
      }
      return await store(full, tiny?.ok ? tiny : undefined, "thumbnail");
    }

    // No thumbnail: the creative's own image, the video's cover, the link picture.
    if (left() < 2_000) return null;
    const cr = await metaGet(
      creativeId,
      {
        fields:
          "image_url,object_story_spec{video_data{image_url},link_data{picture}}",
      },
      step(8_000),
    );
    let lastError = "Meta has no picture for this creative";
    for (const c of creativeImageCandidates(cr).slice(0, 2)) {
      seenUrl = seenUrl ?? c.url;
      const got = await download(c.url, STILL_FULL_MAX_BYTES, step(10_000));
      if (got.ok) return await store(got, undefined, c.source);
      lastError = `picture: ${got.error}`;
    }
    throw new Error(lastError);
  } catch (e) {
    await noteTokenFailure(ctx, e);
    return fail(e);
  }
}

// --- Writing stills ------------------------------------------------------------------

async function stillRow(
  db: QueryCtx["db"],
  key: string,
): Promise<Doc<"adStills"> | null> {
  return await db
    .query("adStills")
    .withIndex("by_key", q => q.eq("key", key))
    .first();
}

/** One key's state, for a capture that has just learned the creative id. */
export const stillState = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: vStatus,
      attempts: v.number(),
      lastTriedAt: v.number(),
      url: v.optional(v.string()),
      tinyUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { key }) => {
    const row = await stillRow(ctx.db, key);
    return row
      ? clean({
          status: row.status,
          attempts: row.attempts,
          lastTriedAt: row.lastTriedAt,
          url: row.url,
          tinyUrl: row.tinyUrl,
        })
      : null;
  },
});

/**
 * Saved stills by key, for any query or mutation. Indexed reads only.
 * Rows that were never tried are simply absent.
 */
export async function lookupStills(
  db: QueryCtx["db"],
  keys: string[],
): Promise<Map<string, { status: string; url?: string; tinyUrl?: string }>> {
  const out = new Map<
    string,
    { status: string; url?: string; tinyUrl?: string }
  >();
  for (const key of new Set(keys)) {
    if (!key) continue;
    const row = await stillRow(db, key);
    if (row)
      out.set(key, { status: row.status, url: row.url, tinyUrl: row.tinyUrl });
  }
  return out;
}

/** The newest saved still's savedAt (0 when none), so a feed can skip an up-to-date cockpit. */
export async function latestStillAt(db: QueryCtx["db"]): Promise<number> {
  const last = await db
    .query("adStills")
    .withIndex("by_saved")
    .order("desc")
    .first();
  return last?.savedAt ?? 0;
}

/** Patch a row only when something actually changes (fewer re-runs downstream). */
async function patchIfChanged(
  ctx: MutationCtx,
  row: any,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const diff = Object.fromEntries(
    Object.entries(patch).filter(
      ([k, x]) => x !== undefined && x !== null && row[k] !== x,
    ),
  );
  if (Object.keys(diff).length === 0) return false;
  await ctx.db.patch(row._id, diff);
  return true;
}

/** Give every row that shows this ad its still (or at least its key). */
async function linkRows(
  ctx: MutationCtx,
  o: {
    key: string;
    requestedKey?: string;
    adId?: string;
    creativeId?: string;
    accountId?: string;
    campaignName?: string;
  },
  url: string | undefined,
  tinyUrl: string | undefined,
): Promise<void> {
  const pictures = url ? { stillUrl: url, stillTinyUrl: tinyUrl } : {};
  if (o.adId) {
    const adId = o.adId;
    for (const node of await ctx.db
      .query("metaTree")
      .withIndex("by_meta", q => q.eq("metaId", adId))
      .collect()) {
      if (node.kind !== "ad") continue;
      await patchIfChanged(ctx, node, {
        stillKey:
          url || !node.stillKey || node.stillKey === o.requestedKey
            ? o.key
            : undefined,
        creativeId: node.creativeId ? undefined : o.creativeId,
        accountId: node.accountId ? undefined : o.accountId,
        ...pictures,
      });
    }
    for (const w of await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", q => q.eq("adId", adId))
      .collect()) {
      await patchIfChanged(ctx, w, {
        stillKey:
          url || !w.stillKey || w.stillKey === o.requestedKey
            ? o.key
            : undefined,
        creativeId: w.creativeId ? undefined : o.creativeId,
        accountId: w.accountId ? undefined : o.accountId,
        ...pictures,
      });
    }
  }
  // Performance rows. With no picture, a row only learns the key the capture
  // found (an ad id that turned out to be a known creative), so the next
  // sync stops asking for the ad id again.
  const renamed = o.requestedKey !== undefined && o.requestedKey !== o.key;
  if (o.campaignName && (url || renamed)) {
    const campaignName = o.campaignName;
    for (const a of await ctx.db
      .query("ads")
      .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
      .collect()) {
      const mine =
        a.stillKey === o.key ||
        (o.requestedKey !== undefined && a.stillKey === o.requestedKey) ||
        (o.adId !== undefined && a.metaAdId === o.adId);
      if (!mine) continue;
      if (url) await patchIfChanged(ctx, a, { stillKey: o.key, ...pictures });
      else if (!a.stillUrl && (!a.stillKey || a.stillKey === o.requestedKey))
        await patchIfChanged(ctx, a, { stillKey: o.key });
    }
  }
}

/** The next savedAt: strictly increasing, so the other cockpits' watermark never skips one. */
async function savedAtClock(ctx: MutationCtx): Promise<() => number> {
  let t = Math.max(Date.now(), (await latestStillAt(ctx.db)) + 1);
  return () => t++;
}

async function applyOutcomes(
  ctx: MutationCtx,
  outcomes: Outcome[],
): Promise<StillResult[]> {
  const now = Date.now();
  const nextSavedAt = await savedAtClock(ctx);
  const results: StillResult[] = [];
  for (const o of outcomes) {
    const existing = await stillRow(ctx.db, o.key);
    let url: string | undefined;
    let tinyUrl: string | undefined;
    let status = o.status;
    if (o.linkOnly) {
      status = existing?.status ?? o.status;
      if (existing?.status === "saved") {
        url = existing.url;
        tinyUrl = existing.tinyUrl;
      }
    } else if (existing?.status === "saved" && existing.url) {
      // Someone saved it first: keep theirs, drop the copy made here.
      if (o.storageId) await ctx.storage.delete(o.storageId);
      if (o.tinyStorageId) await ctx.storage.delete(o.tinyStorageId);
      url = existing.url;
      tinyUrl = existing.tinyUrl;
      status = "saved";
      if (o.keep && !existing.keep)
        await ctx.db.patch(existing._id, { keep: true });
    } else if (o.status === "saved" && o.storageId && o.url) {
      url = o.url;
      tinyUrl = o.tinyUrl;
      const doc = clean({
        key: o.key,
        creativeId: o.creativeId ?? existing?.creativeId,
        adId: existing?.adId ?? o.adId,
        accountId: o.accountId ?? existing?.accountId,
        status: "saved" as const,
        storageId: o.storageId,
        url: o.url,
        tinyStorageId: o.tinyStorageId,
        tinyUrl: o.tinyUrl,
        bytes: o.bytes,
        tinyBytes: o.tinyBytes,
        contentType: o.contentType,
        source: o.source,
        keep: o.keep || existing?.keep ? true : undefined,
        attempts: existing?.attempts ?? 0,
        lastTriedAt: now,
        savedAt: nextSavedAt(),
      });
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("adStills", doc);
    } else {
      const doc = clean({
        key: o.key,
        creativeId: o.creativeId ?? existing?.creativeId,
        adId: existing?.adId ?? o.adId,
        accountId: o.accountId ?? existing?.accountId,
        status: o.status === "gone" ? ("gone" as const) : ("failed" as const),
        keep: o.keep || existing?.keep ? true : undefined,
        attempts: (existing?.attempts ?? 0) + (o.countAttempt ? 1 : 0),
        lastError: o.error,
        lastTriedAt: now,
      });
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("adStills", doc);
    }
    // The capture found the creative: the placeholder row for the ad key
    // (a claim that was never a real attempt) is not needed once the
    // creative has a picture. While it has none, the ad key counts a try, so
    // a row that still names the ad key reaches the weekly wait instead of
    // asking again on every sync.
    if (o.requestedKey && o.requestedKey !== o.key) {
      const stale = await stillRow(ctx.db, o.requestedKey);
      if (stale && stale.status === "failed" && !stale.storageId) {
        if (url) await ctx.db.delete(stale._id);
        else
          await ctx.db.patch(stale._id, {
            attempts: stale.attempts + 1,
            lastError: `the creative has no saved picture (${status})`,
            lastTriedAt: now,
          });
      }
    }
    await linkRows(ctx, o, url, tinyUrl);
    results.push(clean({ key: o.key, status, url, tinyUrl }));
  }
  return results;
}

type Claim = {
  key: string;
  due: boolean;
  status?: "saved" | "failed" | "gone";
  url?: string;
  tinyUrl?: string;
};

/**
 * Hold the keys a capture run is about to fetch, so a second run started
 * by the next sync leaves them alone. Returns what each key needs.
 */
export const claimStills = internalMutation({
  args: {
    items: v.array(v.object({ key: v.string(), item: vCaptureItem })),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      due: v.boolean(),
      status: v.optional(vStatus),
      url: v.optional(v.string()),
      tinyUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { items }) => {
    const now = Date.now();
    const out: Claim[] = [];
    for (const { key, item } of items) {
      const row = await stillRow(ctx.db, key);
      const due = stillCaptureDue(row, now);
      if (due) {
        if (row) await ctx.db.patch(row._id, { lastTriedAt: now });
        else
          await ctx.db.insert(
            "adStills",
            clean({
              key,
              creativeId: item.creativeId,
              adId: item.adId,
              accountId: item.accountId,
              status: "failed" as const,
              keep: item.keep ? true : undefined,
              attempts: 0,
              lastError: "not tried yet",
              lastTriedAt: now,
            }),
          );
      } else if (row && item.keep && !row.keep) {
        await ctx.db.patch(row._id, { keep: true });
      }
      out.push(
        clean({
          key,
          due,
          status: row?.status,
          url: row?.url,
          tinyUrl: row?.tinyUrl,
        }),
      );
    }
    return out;
  },
});

export const recordStills = internalMutation({
  args: { outcomes: v.array(vOutcome) },
  returns: v.array(vStillResult),
  handler: async (ctx, { outcomes }) => await applyOutcomes(ctx, outcomes),
});

function toOutcome(c: Captured): Outcome {
  const { seenUrl: _seen, ...rest } = c;
  return clean(rest);
}

/**
 * captureOne, but an unexpected throw becomes a counted failure: a key that
 * keeps throwing must reach the weekly wait like any other failure, not be
 * fetched again on every sync.
 */
async function captureSafely(
  ctx: ActionCtx,
  plan: { key: string; item: CaptureItem },
  deadline: number,
): Promise<Captured | null> {
  try {
    return await captureOne(ctx, plan.item, deadline);
  } catch (e) {
    return clean({
      key: plan.key,
      adId: plan.item.adId,
      creativeId: plan.item.creativeId,
      accountId: plan.item.accountId,
      campaignName: plan.item.campaignName,
      keep: plan.item.keep,
      status: "failed" as const,
      countAttempt: true,
      error: String(e instanceof Error ? e.message : e).slice(0, 160),
    });
  }
}

/** Write capture outcomes; if the write fails, delete the files they stored. */
async function record(
  ctx: ActionCtx,
  outcomes: Outcome[],
): Promise<StillResult[]> {
  try {
    return await ctx.runMutation(internal.previews.recordStills, { outcomes });
  } catch (e) {
    await dropFiles(ctx, outcomes);
    throw e;
  }
}

/** Normalise, drop items with no id, and merge duplicates by key. */
function planItems(items: CaptureItem[]): { key: string; item: CaptureItem }[] {
  const byKey = new Map<string, CaptureItem>();
  for (const raw of items) {
    const item = clean({
      adId: isMetaId(raw.adId) ? raw.adId : undefined,
      creativeId: isMetaId(raw.creativeId) ? raw.creativeId : undefined,
      accountId: raw.accountId
        ? String(raw.accountId).replace(/^act_/, "")
        : undefined,
      campaignName: raw.campaignName,
      sourceUrl: raw.sourceUrl,
      keep: raw.keep ? true : undefined,
    });
    const key = stillKeyFor(item.creativeId, item.adId);
    if (!key) continue;
    const prev = byKey.get(key);
    byKey.set(
      key,
      prev
        ? clean({
            ...item,
            ...prev,
            keep: prev.keep || item.keep ? true : undefined,
          })
        : item,
    );
  }
  return [...byKey.entries()].map(([key, item]) => ({ key, item }));
}

/**
 * Save stills for up to 30 creatives per run, four at a time, within a
 * minute. Anything past 30 goes to one follow-up run.
 */
export const captureStills = internalAction({
  args: { items: v.array(vCaptureItem) },
  returns: v.array(vStillResult),
  handler: async (ctx, { items }): Promise<StillResult[]> => {
    const deadline = Date.now() + RUN_BUDGET_MS;
    const planned = planItems(items);
    const batch = planned.slice(0, MAX_PER_RUN);
    const later = planned.slice(MAX_PER_RUN, MAX_PER_RUN * 2);
    if (batch.length === 0) return [];
    const claims: Claim[] = await ctx.runMutation(
      internal.previews.claimStills,
      { items: batch },
    );
    const results: StillResult[] = claims
      .filter(c => !c.due && c.status)
      .map(c =>
        clean({
          key: c.key,
          status: c.status as StillResult["status"],
          url: c.url,
          tinyUrl: c.tinyUrl,
        }),
      );
    const due = batch.filter((_, i) => claims[i]?.due);
    const captured = await pool(due, IN_FLIGHT, p =>
      captureSafely(ctx, p, deadline),
    );
    const outcomes = captured.filter((c): c is Captured => c !== null);
    if (outcomes.length)
      results.push(...(await record(ctx, outcomes.map(toOutcome))));
    if (later.length)
      await ctx.scheduler.runAfter(30_000, internal.previews.captureStills, {
        items: later.map(p => p.item),
      });
    const count = (s: string) => outcomes.filter(o => o.status === s).length;
    console.log(
      `stills: ${count("saved")} saved, ${count("failed")} failed, ${count("gone")} gone, ` +
        `${claims.length - due.length} already settled, ${due.length - outcomes.length} left for later` +
        (later.length ? `, ${later.length} queued` : ""),
    );
    return results;
  },
});

/** One ad's still, now: for "Save as winner". Returns the saved links when there are any. */
export const ensureStill = internalAction({
  args: {
    adId: v.string(),
    creativeId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    campaignName: v.optional(v.string()),
    keep: v.optional(v.boolean()),
  },
  returns: v.object({
    key: v.optional(v.string()),
    status: v.string(),
    url: v.optional(v.string()),
    tinyUrl: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    key?: string;
    status: string;
    url?: string;
    tinyUrl?: string;
  }> => {
    const [plan] = planItems([args]);
    if (!plan) return { status: "failed" };
    const [claim]: Claim[] = await ctx.runMutation(
      internal.previews.claimStills,
      { items: [plan] },
    );
    if (!claim?.due)
      return clean({
        key: plan.key,
        status: claim?.status ?? "failed",
        url: claim?.url,
        tinyUrl: claim?.tinyUrl,
      });
    const got = await captureSafely(ctx, plan, Date.now() + 40_000);
    if (!got) return { key: plan.key, status: "failed" };
    const [res]: StillResult[] = await record(ctx, [toOutcome(got)]);
    return clean({
      key: res?.key ?? got.key,
      status: res?.status ?? got.status,
      url: res?.url,
      tinyUrl: res?.tinyUrl,
    });
  },
});

/** Saved stills after a watermark, oldest first: the other cockpits copy these. */
export const stillsSince = internalQuery({
  args: { since: v.number(), limit: v.number() },
  returns: v.array(
    v.object({
      key: v.string(),
      url: v.string(),
      tinyUrl: v.optional(v.string()),
      savedAt: v.number(),
      contentType: v.optional(v.string()),
      bytes: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { since, limit }) => {
    const rows = await ctx.db
      .query("adStills")
      .withIndex("by_saved", q => q.gt("savedAt", since))
      .order("asc")
      .take(Math.max(1, Math.min(limit, 100)));
    return rows
      .filter(r => r.status === "saved" && r.url && r.savedAt !== undefined)
      .map(r =>
        clean({
          key: r.key,
          url: r.url as string,
          tinyUrl: r.tinyUrl,
          savedAt: r.savedAt as number,
          contentType: r.contentType,
          bytes: r.bytes,
        }),
      );
  },
});

// --- Who may open a preview ------------------------------------------------------------

async function refusalFor(
  ctx: QueryCtx,
  a: { adId: string; role: string; userId?: Id<"users">; email?: string },
): Promise<string> {
  let email = a.email;
  if (a.userId) {
    const user = await ctx.db.get(a.userId);
    email = user?.email ?? undefined;
  }
  if (!email) return REFUSED;
  const acc = await accessFor(ctx, email, a.userId);
  if (!(acc.isAdmin || acc.roles.includes(a.role))) return REFUSED;
  if (acc.isAdmin || acc.clients.length === 0) return "";
  // What works is company-wide, like market.winners.
  const winner = await ctx.db
    .query("winnersArchive")
    .withIndex("by_ad", q => q.eq("adId", a.adId))
    .first();
  if (winner) return "";
  const node = await ctx.db
    .query("metaTree")
    .withIndex("by_meta", q => q.eq("metaId", a.adId))
    .first();
  if (!node) return PREVIEW_MESSAGES.no_access;
  const scope = new Set(acc.clients.map(c => c.trim().toLowerCase()));
  const campaign = (await ctx.db.query("campaigns").collect()).find(
    c => c.campaignName === node.campaignName,
  );
  const client = String(campaign?.clientName ?? campaign?.accountName ?? "")
    .trim()
    .toLowerCase();
  return campaign && scope.has(client) ? "" : PREVIEW_MESSAGES.no_access;
}

/** "" when this person may open this ad's preview, else the reason. */
export const allowed = internalQuery({
  args: {
    adId: v.string(),
    role: v.string(),
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, a) => await refusalFor(ctx, a),
});

// --- The live preview -----------------------------------------------------------------

type Context = {
  refused: string;
  link: Link | null;
  node: {
    campaignName?: string;
    accountId?: string;
    creativeId?: string;
    stillKey?: string;
    stillUrl?: string;
    stillTinyUrl?: string;
    thumbUrl?: string;
  } | null;
  still: {
    key: string;
    status: "saved" | "failed" | "gone";
    url?: string;
    tinyUrl?: string;
    attempts: number;
    lastTriedAt: number;
  } | null;
};

/** Everything one preview needs, in one read: access, the cached answer, the ad, its still. */
export const previewContext = internalQuery({
  args: {
    adId: v.string(),
    format: v.string(),
    access: v.optional(
      v.object({
        role: v.string(),
        userId: v.optional(v.id("users")),
        email: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { adId, format, access }): Promise<Context> => {
    const refused = access ? await refusalFor(ctx, { adId, ...access }) : "";
    if (refused) return { refused, link: null, node: null, still: null };
    const cached = await ctx.db
      .query("previewLinks")
      .withIndex("by_ad", q => q.eq("adId", adId).eq("format", format))
      .first();
    const tree = await ctx.db
      .query("metaTree")
      .withIndex("by_meta", q => q.eq("metaId", adId))
      .first();
    const winner = await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", q => q.eq("adId", adId))
      .first();
    const node =
      tree || winner
        ? clean({
            campaignName: tree?.campaignName ?? winner?.campaignName,
            accountId: tree?.accountId ?? winner?.accountId,
            creativeId: tree?.creativeId ?? winner?.creativeId,
            stillKey: tree?.stillKey ?? winner?.stillKey,
            stillUrl: tree?.stillUrl ?? winner?.stillUrl,
            stillTinyUrl: tree?.stillTinyUrl ?? winner?.stillTinyUrl,
            thumbUrl: tree?.thumbUrl ?? winner?.thumbUrl,
          })
        : null;
    let row: Doc<"adStills"> | null = null;
    const key = node?.stillKey ?? stillKeyFor(node?.creativeId, adId);
    if (key) row = await stillRow(ctx.db, key);
    if (row?.status !== "saved" && key !== `a:${adId}`) {
      const byAd = await stillRow(ctx.db, `a:${adId}`);
      if (byAd?.status === "saved" || !row) row = byAd ?? row;
    }
    return {
      refused: "",
      link: cached
        ? clean({
            src: cached.src,
            width: cached.width,
            height: cached.height,
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.expiresAt,
            thumbUrl: cached.thumbUrl,
            thumbExpiresAt: cached.thumbExpiresAt,
            reason: cached.reason,
            error: cached.error,
          })
        : null,
      node,
      still: row
        ? clean({
            key: row.key,
            status: row.status,
            url: row.url,
            tinyUrl: row.tinyUrl,
            attempts: row.attempts,
            lastTriedAt: row.lastTriedAt,
          })
        : null,
    };
  },
});

/** Store the preview answer (one row per ad and format) and any still captured with it. */
export const cacheWrite = internalMutation({
  args: {
    adId: v.string(),
    format: v.string(),
    link: vLink,
    outcome: v.optional(vOutcome),
  },
  returns: v.object({
    stillUrl: v.optional(v.string()),
    stillTinyUrl: v.optional(v.string()),
    stillKey: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    { adId, format, link, outcome },
  ): Promise<{
    stillUrl?: string;
    stillTinyUrl?: string;
    stillKey?: string;
  }> => {
    const doc = clean({ adId, format, ...link });
    const row = await ctx.db
      .query("previewLinks")
      .withIndex("by_ad", q => q.eq("adId", adId).eq("format", format))
      .first();
    if (row) await ctx.db.replace(row._id, doc);
    else await ctx.db.insert("previewLinks", doc);
    if (!outcome) return {};
    const [res] = await applyOutcomes(ctx, [outcome]);
    return clean({
      stillKey: res?.key,
      stillUrl: res?.url,
      stillTinyUrl: res?.tinyUrl,
    });
  },
});

/** Ask Meta for the preview, trying the Instagram format once if the feed one does not fit. */
async function fetchPreview(
  adId: string,
  format: string,
  deadline: number,
): Promise<{ src?: string; width?: number; height?: number }> {
  const once = async (fmt: string) => {
    const res = await metaGet<{ data?: { body?: string }[] }>(
      `${adId}/previews`,
      { ad_format: fmt },
      Math.min(8_000, Math.max(0, deadline - Date.now())),
    );
    return parsePreviewBody(String(res?.data?.[0]?.body ?? ""));
  };
  const fallback = "INSTAGRAM_STANDARD";
  try {
    const got = await once(format);
    if (got.src || format === fallback || deadline - Date.now() < 3_000)
      return got;
    return await once(fallback);
  } catch (e) {
    if (
      format !== fallback &&
      formatUnsupported(e) &&
      deadline - Date.now() > 3_000
    )
      return await once(fallback);
    throw e;
  }
}

/**
 * The live preview for one ad, shared by the media buyer's `fresh`, the
 * `/bridge/preview` door and `freshFor`. Calls Meta only when the cached
 * answer has run out; saves the still in the same call when there is none.
 */
export async function previewFor(
  ctx: ActionCtx,
  a: {
    adId: string;
    format?: string;
    caller: string;
    access?: { role: string; userId?: Id<"users">; email?: string };
  },
): Promise<PreviewResult> {
  const start = Date.now();
  const adId = String(a.adId ?? "").trim();
  if (!isMetaId(adId))
    return {
      ok: false,
      adId: String(adId ?? "").slice(0, 30),
      reason: "error",
      message: "That is not a Meta ad id.",
    };
  const format = previewFormat(a.format);
  const c = (await ctx.runQuery(internal.previews.previewContext, {
    adId,
    format,
    access: a.access,
  })) as Context;
  if (c.refused)
    return {
      ok: false,
      adId,
      reason: "no_access",
      message: c.refused,
    };
  const saved = c.still?.status === "saved" && c.still.url ? c.still : null;
  const nodeThumb =
    c.node?.thumbUrl && metaImageUsable(c.node.thumbUrl)
      ? c.node.thumbUrl
      : undefined;
  const base: PreviewResult = clean({
    ok: false,
    adId,
    accountId: c.node?.accountId,
    stillKey: saved?.key ?? c.node?.stillKey,
    stillUrl: saved?.url ?? c.node?.stillUrl,
    stillTinyUrl: saved ? saved.tinyUrl : c.node?.stillTinyUrl,
    thumbUrl: nodeThumb,
    thumbExpiresAt: metaImageExpiry(nodeThumb),
  });

  if (c.link && cachedPreviewUsable(c.link, Date.now()))
    return previewAnswer(base, c.link, Date.now());

  const deadline = start + PREVIEW_BUDGET_MS;
  const fetchedAt = Date.now();
  let link: Link;
  try {
    const got = await fetchPreview(adId, format, deadline);
    link = got.src
      ? clean({
          src: got.src,
          width: got.width,
          height: got.height,
          fetchedAt,
          expiresAt: fetchedAt + previewTtlMs(),
        })
      : {
          fetchedAt,
          expiresAt: fetchedAt + previewTtlMs("error"),
          reason: "error",
          error: "Meta returned no preview",
        };
  } catch (e) {
    await noteTokenFailure(ctx, e);
    const reason = metaErrorReason(e);
    link = {
      fetchedAt,
      expiresAt: fetchedAt + previewTtlMs(reason),
      reason,
      error: String(e instanceof Error ? e.message : e).slice(0, 160),
    };
  }

  // No saved still yet: save one now, so the next opening has a picture.
  let outcome: Captured | null = null;
  if (
    captureOnOpen({
      hasSaved: Boolean(saved),
      reason: link.reason,
      still: c.still,
      msLeft: deadline - Date.now(),
    })
  ) {
    const item: CaptureItem = clean({
      adId,
      creativeId: isMetaId(c.node?.creativeId) ? c.node?.creativeId : undefined,
      accountId: c.node?.accountId,
      campaignName: c.node?.campaignName,
      sourceUrl: nodeThumb,
    });
    const key = stillKeyFor(item.creativeId, adId) as string;
    outcome = await captureSafely(ctx, { key, item }, deadline);
    if (
      outcome &&
      outcome.status !== "saved" &&
      outcome.seenUrl &&
      metaImageUsable(outcome.seenUrl)
    ) {
      link.thumbUrl = outcome.seenUrl;
      link.thumbExpiresAt = metaImageExpiry(outcome.seenUrl);
    }
    if (outcome?.accountId && !base.accountId)
      base.accountId = outcome.accountId;
  }

  // The answer is good even if storing it fails; only the files are undone.
  const stored = outcome ? toOutcome(outcome) : undefined;
  let written: { stillUrl?: string; stillTinyUrl?: string; stillKey?: string } =
    {};
  try {
    written = await ctx.runMutation(internal.previews.cacheWrite, {
      adId,
      format,
      link,
      outcome: stored,
    });
  } catch (e) {
    console.error(`preview cache write failed: ${String(e).slice(0, 120)}`);
    if (stored) await dropFiles(ctx, [stored]);
  }
  if (written.stillUrl) {
    base.stillKey = written.stillKey;
    base.stillUrl = written.stillUrl;
    base.stillTinyUrl = written.stillTinyUrl;
  }
  console.log(
    `preview for ${a.caller}: ${link.src ? "live" : link.reason}` +
      (outcome ? `, still ${outcome.status}` : "") +
      ` in ${Date.now() - start} ms`,
  );
  return previewAnswer(base, link, Date.now());
}

/** The media buyer cockpit opens a preview. */
export const fresh = authenticatedAction({
  args: { adId: v.string(), format: v.optional(v.string()) },
  returns: vPreviewResult,
  handler: async (ctx, { adId, format }): Promise<PreviewResult> =>
    await previewFor(ctx, {
      adId,
      format,
      caller: "media_buyer",
      access: { role: "media_buyer", userId: ctx.userId },
    }),
});

/** The same, for trusted callers inside this backend. */
export const freshFor = internalAction({
  args: {
    adId: v.string(),
    format: v.optional(v.string()),
    caller: v.string(),
  },
  returns: vPreviewResult,
  handler: async (ctx, a): Promise<PreviewResult> => await previewFor(ctx, a),
});

const vDetails = v.object({
  ok: v.boolean(),
  reason: v.optional(v.string()),
  creativeId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  adsetId: v.optional(v.string()),
  campaignId: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  format: v.optional(v.string()),
  cta: v.optional(v.string()),
  headline: v.optional(v.string()),
  body: v.optional(v.string()),
  videoId: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
});

export type AdDetails = Infer<typeof vDetails>;

/** One ad's identity and copy, straight from Meta (for "Save as winner"). */
export const adDetails = internalAction({
  args: { adId: v.string() },
  returns: vDetails,
  handler: async (ctx, { adId }): Promise<AdDetails> => {
    if (!isMetaId(adId)) return { ok: false, reason: "error" };
    try {
      const ad = await metaGet(
        adId,
        {
          fields:
            "id,name,status,effective_status,adset_id,campaign_id,account_id," +
            "creative{id,thumbnail_url,image_url,object_story_spec}",
        },
        12_000,
      );
      const cr = ad?.creative ?? {};
      const str = (x: unknown) =>
        x === undefined || x === null || x === "" ? undefined : String(x);
      return clean({
        ok: true,
        creativeId: str(cr.id),
        accountId: str(ad?.account_id)?.replace(/^act_/, ""),
        adsetId: str(ad?.adset_id),
        campaignId: str(ad?.campaign_id),
        name: str(ad?.name),
        status: str(ad?.effective_status ?? ad?.status),
        ...readCreativeCopy(cr),
        thumbUrl: str(cr.thumbnail_url ?? creativeImageCandidates(cr)[0]?.url),
      });
    } catch (e) {
      await noteTokenFailure(ctx, e);
      return { ok: false, reason: metaErrorReason(e) };
    }
  },
});

// --- The daily check ------------------------------------------------------------------

const STORAGE_WARN_BYTES = 500 * 1024 * 1024;
const LIVE_PICTURE_SHARE = 0.9;

const vRotStats = v.object({
  winners: v.object({
    shown: v.number(),
    missing: v.number(),
    neverTried: v.number(),
    failedEligible: v.number(),
    failedWaiting: v.number(),
    gone: v.number(),
    savedNotLinked: v.number(),
  }),
  live: v.object({ ads: v.number(), withPicture: v.number() }),
  stills: v.object({
    saved: v.number(),
    failed: v.number(),
    gone: v.number(),
    bytes: v.number(),
  }),
  samples: v.array(v.string()),
  heal: v.array(vCaptureItem),
});
type RotStats = Infer<typeof vRotStats>;

/** Counts for the daily check: winners and live ads without a picture, and storage. */
export const rotStats = internalQuery({
  args: {},
  returns: vRotStats,
  handler: async (ctx): Promise<RotStats> => {
    const now = Date.now();
    const stills = await ctx.db.query("adStills").collect();
    const byKey = new Map(stills.map(s => [s.key, s]));

    const shown = new Map<string, Doc<"winnersArchive">>();
    for (const w of await ctx.db.query("winnersArchive").collect()) {
      if (!(isSavedWinner(w) || isAutoWinner(w))) continue;
      const prev = shown.get(w.adId);
      if (!prev || (!prev.stillUrl && w.stillUrl)) shown.set(w.adId, w);
    }
    const winners = {
      shown: shown.size,
      missing: 0,
      neverTried: 0,
      failedEligible: 0,
      failedWaiting: 0,
      gone: 0,
      savedNotLinked: 0,
    };
    const heal: CaptureItem[] = [];
    for (const w of shown.values()) {
      if (w.stillUrl) continue;
      winners.missing++;
      const key = w.stillKey ?? stillKeyFor(w.creativeId, w.adId);
      const row =
        (key ? byKey.get(key) : undefined) ?? byKey.get(`a:${w.adId}`);
      const gap = stillGap(row, now);
      if (gap === "saved") winners.savedNotLinked++;
      else if (gap === "never_tried") winners.neverTried++;
      else if (gap === "failed_eligible") winners.failedEligible++;
      else if (gap === "failed_waiting") winners.failedWaiting++;
      else winners.gone++;
      if (
        (gap === "never_tried" || gap === "failed_eligible") &&
        heal.length < 40 &&
        stillCaptureDue(row, now)
      )
        heal.push(
          clean({
            adId: w.adId,
            creativeId: w.creativeId,
            accountId: w.accountId,
            campaignName: w.campaignName,
            sourceUrl: metaImageUsable(w.thumbUrl, now)
              ? w.thumbUrl
              : undefined,
            keep: true,
          }),
        );
    }

    const liveAds = (await ctx.db.query("metaTree").collect()).filter(
      t =>
        t.kind === "ad" &&
        String(t.effectiveStatus ?? t.status).toUpperCase() === "ACTIVE",
    );

    const saved = stills
      .filter(s => s.status === "saved" && (s.tinyUrl ?? s.url))
      .sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
    const picks = saved.length
      ? [...new Set([0, Math.floor(saved.length / 2), saved.length - 1])].map(
          i => String(saved[i].tinyUrl ?? saved[i].url),
        )
      : [];

    return {
      winners,
      live: {
        ads: liveAds.length,
        withPicture: liveAds.filter(t => hasPicture(t, now)).length,
      },
      stills: {
        saved: saved.length,
        failed: stills.filter(s => s.status === "failed").length,
        gone: stills.filter(s => s.status === "gone").length,
        bytes: stills.reduce(
          (sum, s) => sum + (s.bytes ?? 0) + (s.tinyBytes ?? 0),
          0,
        ),
      },
      samples: picks,
      heal,
    };
  },
});

/** Remove preview answers that ran out more than an hour ago. */
export const cleanup = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async ctx => {
    const old = await ctx.db
      .query("previewLinks")
      .withIndex("by_expires", q => q.lt("expiresAt", Date.now() - 3600_000))
      .take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return { deleted: old.length };
  },
});

type Check = { name: string; ok: boolean; error?: string };

/** The words for the winners line. */
function winnersProblem(w: RotStats["winners"]): string {
  const fixable =
    w.neverTried + w.failedEligible + w.failedWaiting + w.savedNotLinked;
  if (fixable === 0) return "";
  const parts = [
    w.failedEligible + w.failedWaiting
      ? `${w.failedEligible + w.failedWaiting} failed`
      : "",
    w.neverTried ? `${w.neverTried} not tried` : "",
    w.savedNotLinked ? `${w.savedNotLinked} saved but not linked yet` : "",
  ].filter(Boolean);
  const gone = w.gone
    ? `; ${w.gone} more ${w.gone === 1 ? "was" : "were"} deleted in Meta before we saved them`
    : "";
  return `${fixable} of ${w.shown} winners have no saved picture (${parts.join(", ")}${gone})`;
}

/**
 * The daily preview check, run from the smoke check at 03:07 UTC. Loads a
 * few saved pictures, counts what is missing, clears old preview answers
 * and retries the winners that can still get a picture.
 */
export async function runRotCheck(
  ctx: ActionCtx,
): Promise<{ ok: boolean; checks: Check[] }> {
  const stats = await ctx.runQuery(internal.previews.rotStats, {});
  const checks: Check[] = [];

  let loaded = 0;
  let firstError = "";
  for (const url of stats.samples) {
    const got = await download(url, STILL_FULL_MAX_BYTES, 10_000);
    if (got.ok) loaded++;
    else firstError = firstError || got.error;
  }
  checks.push(
    clean({
      name: "previews saved pictures load",
      ok: loaded === stats.samples.length,
      error:
        loaded === stats.samples.length
          ? undefined
          : `${stats.samples.length - loaded} of ${stats.samples.length} saved pictures did not load (${firstError})`,
    }),
  );

  const winnersError = winnersProblem(stats.winners);
  checks.push(
    clean({
      name: "previews winners with a picture",
      ok: !winnersError,
      error: winnersError || undefined,
    }),
  );

  const live = stats.live;
  const liveOk =
    live.ads === 0 || live.withPicture / live.ads >= LIVE_PICTURE_SHARE;
  checks.push(
    clean({
      name: "previews live ads with a picture",
      ok: liveOk,
      error: liveOk
        ? undefined
        : `Only ${live.withPicture} of ${live.ads} live ads have a picture`,
    }),
  );

  const mb = Math.round(stats.stills.bytes / (1024 * 1024));
  const storageOk = stats.stills.bytes < STORAGE_WARN_BYTES;
  checks.push(
    clean({
      name: "previews storage",
      ok: storageOk,
      error: storageOk
        ? undefined
        : `Saved pictures use ${mb} MB, over the 500 MB warning line`,
    }),
  );

  let deleted = 0;
  try {
    deleted = (await ctx.runMutation(internal.previews.cleanup, {})).deleted;
  } catch (e) {
    console.error(`previews cleanup: ${String(e).slice(0, 120)}`);
  }
  if (stats.heal.length)
    await ctx.scheduler.runAfter(0, internal.previews.captureStills, {
      items: stats.heal,
    });

  const ok = checks.every(x => x.ok);
  try {
    await recordManyDirect(ctx, [
      clean({
        source: "previews",
        ok,
        error: checks.find(x => !x.ok)?.error,
      }),
    ]);
  } catch (e) {
    console.error(`previews ledger: ${String(e).slice(0, 120)}`);
  }
  console.log(
    `previews check: ${ok ? "ok" : "FAILED"}; winners ${stats.winners.shown} ` +
      `(${stats.winners.missing} without a picture, ${stats.winners.gone} gone); ` +
      `live ads ${live.withPicture}/${live.ads} with a picture; ` +
      `${stats.stills.saved} saved, ${stats.stills.failed} failed, ${stats.stills.gone} gone, ${mb} MB; ` +
      `${loaded}/${stats.samples.length} samples loaded; ${deleted} old answers removed; ` +
      `${stats.heal.length} winners retried`,
  );
  return { ok, checks };
}

export const rotCheck = internalAction({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    checks: v.array(
      v.object({
        name: v.string(),
        ok: v.boolean(),
        error: v.optional(v.string()),
      }),
    ),
  }),
  handler: async ctx => await runRotCheck(ctx),
});
