import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { accessFor } from "./roles";

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

export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({ ok: v.boolean(), email: v.string(), name: v.string() }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const a = await accessFor(ctx, user?.email, userId);
    const ok =
      a.isAdmin ||
      a.roles.includes("media_buyer") ||
      a.roles.includes("creative");
    return {
      ok,
      email: a.email,
      name: String(a.name ?? user?.name ?? a.email.split("@")[0]),
    };
  },
});

// biome-ignore lint/suspicious/noExplicitAny: action ctx
async function who(ctx: any): Promise<{ email: string; name: string }> {
  const g = (await ctx.runQuery(internal.foreplay.gate, {
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
    const at = new Date().toISOString();
    await rest("ideation_posts?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          key: `foreplay:${ad.id}`,
          platform: "meta_ads",
          url: ad.foreplay_url ?? ad.link_url ?? null,
          origin: "foreplay",
          status: "saved",
          at,
          created_at: at,
          updated_at: at,
          industry: "other",
          tags: [
            "via:foreplay",
            ...(ad.board_name ? [`board:${ad.board_name}`] : []),
          ],
          author_name: ad.name ?? null,
          caption: ad.headline ?? ad.description ?? null,
          transcript: ad.full_transcription ?? null,
          thumb_url: ad.thumbnail ?? ad.image ?? null,
          media_url: ad.video ?? null,
          duration_sec: ad.video_duration ?? null,
          running_days: ad.running_duration ?? null,
          ad_active: ad.live ?? null,
          ad_format: ad.display_format ?? null,
          captured_at: at,
          saved_by: email,
          saved_by_name: name,
          saved_at: at,
          attempts: 0,
        },
      ],
    });
    return { key: `foreplay:${ad.id}` };
  },
});
