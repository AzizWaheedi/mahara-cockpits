import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { adAsIdea } from "./adAsIdea";
import { authenticatedAction } from "./functions";

/**
 * The swipe file: what the team saved in Foreplay.
 *
 * Saving happens in Foreplay's extension and their phone app; their API is
 * read-only, so nothing can be pushed in. The worker on the VPS mirrors
 * every ad and every board into Supabase, which means the cockpit needs no
 * Foreplay key, the board still reads when Foreplay is down, and if the
 * subscription ever lapses the ads we already saw are still ours.
 *
 * Same tables and same shapes as the video editor's swipe file, so the page
 * is the same in all three cockpits (Aziz, 2026-09-19).
 */
declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
) {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error(
      "The swipe file is not connected yet: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.",
    );
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Row[] | Row) : null;
}

/**
 * The same seat check the ideation board uses. The swipe file is the same
 * material for the same people, and two gates over one audience is one
 * gate too many -- this way the cockpits' own role rules live in exactly
 * one place each.
 */
// biome-ignore lint/suspicious/noExplicitAny: action ctx
async function who(ctx: any): Promise<{ email: string; name: string }> {
  const g = (await ctx.runQuery(internal.ideation.gate, {
    userId: ctx.userId as Id<"users">,
  })) as { ok: boolean; email: string; name: string };
  if (!g.ok)
    throw new Error(
      "This cockpit is not yours. Ask Aziz to add you in the portal.",
    );
  return { email: g.email, name: g.name };
}

/** Saved ads, longest on air first: the strongest single signal one works. */
export const ads = authenticatedAction({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    await who(ctx);
    const n = Math.max(1, Math.min(500, limit ?? 300));
    const rows = await rest(
      `foreplay_ads?select=*&order=running_duration.desc.nullslast&limit=${n}`,
    );
    return Array.isArray(rows) ? rows : [];
  },
});

/**
 * Every board, including one nobody has saved to yet -- read from the board
 * table rather than counted off the ads, because a board somebody just made
 * still has to appear.
 */
export const boards = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await who(ctx);
    const rows = await rest(
      "foreplay_boards?select=*&order=name.asc&limit=200",
    );
    return Array.isArray(rows) ? rows : [];
  },
});

/**
 * Put a saved ad on the ideation board.
 *
 * The same row the worker writes when an ad lands in the Foreplay drop box,
 * so an ad forwarded by hand and one forwarded automatically are the same
 * thing on the board. `key` is the ad's own id, so pressing twice updates
 * rather than duplicating.
 */
export const toIdeation = authenticatedAction({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const { email, name } = await who(ctx);
    const found = await rest(
      `foreplay_ads?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const ad = Array.isArray(found) && found.length ? found[0] : null;
    if (!ad) throw new Error("That ad is no longer in the swipe file.");
    await rest("ideation_posts?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [adAsIdea(ad, { by: email, byName: name })],
    });
    return { key: `foreplay:${ad.id}` };
  },
});
