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

const listArgs = {
  serviceLine: v.optional(v.string()),
  excludeClient: v.optional(v.string()),
  liveOnly: v.optional(v.boolean()),
  limit: v.optional(v.number()),
};
type ListArgs = {
  serviceLine?: string;
  excludeClient?: string;
  liveOnly?: boolean;
  limit?: number;
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
  const rows = all
    .filter(r => {
      if (args.serviceLine && r.serviceLine !== args.serviceLine) return false;
      if (args.excludeClient && norm(r.client) === norm(args.excludeClient)) {
        return false;
      }
      if (args.liveOnly && r.stillLive === false) return false;
      return true;
    })
    .sort((a, b) => a.cpl - b.cpl)
    .slice(0, args.limit ?? 40);

  const serviceLines = Array.from(
    new Set(all.map(r => r.serviceLine).filter(Boolean) as string[]),
  ).sort();

  return {
    rows,
    serviceLines,
    total: all.length,
    live: all.filter(r => r.stillLive).length,
    syncedAt: all[0]?.syncedAt ?? null,
  };
}
