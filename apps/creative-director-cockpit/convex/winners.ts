import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { assertRole } from "./roles";

/**
 * The winning ads database, exactly as the media buyer sees it.
 *
 * Aziz, 2026-09-07: the creative director gets the same view as the media
 * buyer cockpit, not a weaker copy, so a script starts from an ad that already
 * worked, with its hook, its copy, its transcript and its preview.
 *
 * This deployment does not compute winners. The media buyer Space owns that
 * logic and mirrors the rows here through the bridge (ingest.storeWinners),
 * so there is one definition of "winning" in the company, not two that drift.
 *
 * Not cut to the person's client list: these are other clients' ads on
 * purpose, ad copy meant for reuse with nothing client-private in it, and the
 * media buyer's own view is unscoped the same way. `excludeClient` is the only
 * cut.
 */

function norm(x?: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * "Save as winner" in the media buyer cockpit, mirrored here. These rules are
 * copied from the media buyer's market.ts and metaMedia.ts so both cockpits
 * show the same rows. A save counts while it is newer than the last "Remove
 * from What works". A row the weekly check picked is an auto winner,
 * including a manual save that later cleared the bar.
 */
type SaveFields = {
  origin?: string | null;
  autoFirstAt?: number | null;
  savedAt?: number | null;
  unsavedAt?: number | null;
};

export function isSaved(r: SaveFields): boolean {
  return (
    typeof r.savedAt === "number" &&
    !(typeof r.unsavedAt === "number" && r.unsavedAt >= r.savedAt)
  );
}

export function isAuto(r: SaveFields): boolean {
  return r.origin !== "manual" || typeof r.autoFirstAt === "number";
}

export const vOrigin = v.optional(
  v.union(v.literal("all"), v.literal("saved"), v.literal("auto")),
);
export type Origin = "all" | "saved" | "auto";

type WinnerRow = SaveFields & {
  adId: string;
  savedBy?: string | null;
  cpl?: number | null;
  _creationTime?: number;
};

/** One row per ad for display: the newest active save, else the primary row. */
function onePerAd<T extends WinnerRow>(rows: T[]): T[] {
  const byAd = new Map<string, T[]>();
  for (const r of rows) {
    const list = byAd.get(String(r.adId)) ?? [];
    list.push(r);
    byAd.set(String(r.adId), list);
  }
  return [...byAd.values()].map(list => {
    const saved = list
      .filter(r => isSaved(r))
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    if (saved[0]) return saved[0];
    // The primary row: the newest save, even a removed one, else the oldest.
    const marked = list
      .filter(r => typeof r.savedAt === "number")
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    return (
      marked[0] ??
      [...list].sort(
        (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0),
      )[0]
    );
  });
}

/**
 * The rows What works shows, one per ad, in the media buyer's order: every
 * active save first (newest first, never cut by `limit`), then the weekly
 * check's winners by cost per lead until the list holds `limit` rows. The
 * "auto" view is the weekly check's winners by cost per lead only. `keep`
 * applies the page's own filters.
 */
export function orderWinners<T extends WinnerRow>(
  rows: T[],
  opts: {
    origin?: Origin;
    savedBy?: string;
    limit?: number;
    keep?: (r: T) => boolean;
  },
): T[] {
  const origin = opts.origin ?? "all";
  const who = (opts.savedBy ?? "").trim().toLowerCase();
  const shown = onePerAd(
    rows.filter(r => (isSaved(r) || isAuto(r)) && (!opts.keep || opts.keep(r))),
  ).filter(r => {
    if (origin === "saved" && !isSaved(r)) return false;
    if (origin === "auto" && !isAuto(r)) return false;
    if (who && !(isSaved(r) && (r.savedBy ?? "").toLowerCase() === who))
      return false;
    return true;
  });
  const limit = Math.max(0, Math.floor(opts.limit ?? 40));
  const cplOf = (r: T) =>
    typeof r.cpl === "number" ? r.cpl : Number.POSITIVE_INFINITY;
  const byCpl = (a: T, b: T) => cplOf(a) - cplOf(b);
  if (origin === "auto") return shown.sort(byCpl).slice(0, limit);
  const saved = shown
    .filter(r => isSaved(r))
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  const rest = shown
    .filter(r => !isSaved(r))
    .sort(byCpl)
    .slice(0, Math.max(0, limit - saved.length));
  return [...saved, ...rest];
}

const listArgs = {
  serviceLine: v.optional(v.string()),
  excludeClient: v.optional(v.string()),
  liveOnly: v.optional(v.boolean()),
  limit: v.optional(v.number()),
  /** "saved": saved by the team. "auto": found by the weekly check. */
  origin: vOrigin,
  /** Only saves by this person (their email). */
  savedBy: v.optional(v.string()),
};
type ListArgs = {
  serviceLine?: string;
  excludeClient?: string;
  liveOnly?: boolean;
  limit?: number;
  origin?: Origin;
  savedBy?: string;
};

export const list = authenticatedQuery({
  args: listArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    return await buildWinnersList(ctx, args);
  },
});

export async function buildWinnersList(ctx: QueryCtx, args: ListArgs) {
  const all = await ctx.db.query("winnersArchive").collect();
  // Everything What works would show, before the page's filters.
  const shown = orderWinners(all, { limit: all.length });
  const rows = orderWinners(all, {
    origin: args.origin,
    savedBy: args.savedBy,
    limit: args.limit ?? 40,
    keep: r => {
      if (args.serviceLine && r.serviceLine !== args.serviceLine) return false;
      if (args.excludeClient && norm(r.client) === norm(args.excludeClient)) {
        return false;
      }
      if (args.liveOnly && r.stillLive === false) return false;
      return true;
    },
  }).map(({ previewSrc: _dropped, ...r }) => ({
    ...r,
    cpl: typeof r.cpl === "number" ? r.cpl : null,
    isSaved: isSaved(r),
    isAuto: isAuto(r),
  }));

  const serviceLines = Array.from(
    new Set(shown.map(r => r.serviceLine).filter(Boolean) as string[]),
  ).sort();

  return {
    rows,
    serviceLines,
    total: shown.length,
    live: shown.filter(r => r.stillLive).length,
    saved: shown.filter(r => isSaved(r)).length,
    syncedAt: all[0]?.syncedAt ?? null,
  };
}
