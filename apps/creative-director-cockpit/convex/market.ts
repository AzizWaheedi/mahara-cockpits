import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { assertRole } from "./roles";
import { isAuto, isSaved, type Origin, orderWinners, vOrigin } from "./winners";

/**
 * "What works" — the media buyer's playbook, mirrored.
 *
 * These are the cockpit's own queries, copied unchanged, running over the
 * `marketPlays` and `winnersArchive` rows the sync mirrors across. If the media
 * buyer's definition of a proven play changes, this file gets recopied rather
 * than reinvented. [aziz, 2026-09-07]
 *
 * Not cut to the person's client list: the page exists to learn from other
 * clients' ads, the rows hold ad copy meant for reuse and nothing
 * client-private, and the media buyer's own playbook is unscoped the same
 * way. `exclude` (the client being built for) is the only cut.
 */

/** Enough spend to mean something. Below this, a cheap CPL is just noise. */
const MIN_SPEND = 100;
/** Our working cost-per-lead gate, confirmed by Aziz 2026-09-05. */
const CPL_GATE = 15;
const WINNER_MIN_SPEND = 100;
const WINNER_MAX_CPL = 15;

/** The mirrored plays, every client's. */
async function playsFor(ctx: QueryCtx) {
  return await ctx.db.query("marketPlays").collect();
}

type Group = {
  key: string;
  serviceLine: string;
  city: string;
  playType: string;
  interests: string[];
  spend: number;
  leads: number;
  clients: Set<string>;
};

/** Every ad in `marketPlays` that clears the winner bar right now. */
// biome-ignore lint/suspicious/noExplicitAny: play/creative shapes
function winnersFrom(plays: any[]): Record<string, any>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of plays) {
    for (const cr of p.creatives ?? []) {
      if (cr.spend < WINNER_MIN_SPEND) continue;
      if (cr.cpl === undefined || cr.cpl === null || cr.cpl > WINNER_MAX_CPL)
        continue;
      out.push({
        adId: cr.adId,
        adName: cr.adName,
        client: p.client,
        serviceLine: p.serviceLine ?? "Unknown",
        city: p.city ?? "Unknown",
        country: p.country,
        format: cr.format,
        cta: cr.cta,
        headline: cr.headline,
        body: cr.body,
        transcript: cr.transcript,
        hook: cr.hook,
        voice: cr.voice,
        thumbUrl: cr.thumbUrl,
        creativeId: cr.creativeId,
        stillKey: cr.stillKey,
        language: p.language,
        copyTraits: p.copyTraits ?? [],
        playType: p.playType,
        interests: p.interests,
        adsetName: p.adsetName,
        spend: Math.round(cr.spend),
        leads: cr.leads,
        cpl: cr.cpl,
      });
    }
  }
  return out as Record<string, any>[];
}

/**
 * What has actually worked, grouped by service line, city and play.
 *
 * `exclude` is the client you are building for: their own history is removed so
 * the answer is "what worked ELSEWHERE that you have not tried here yet".
 */
const playbookArgs = {
  serviceLine: v.optional(v.string()),
  city: v.optional(v.string()),
  exclude: v.optional(v.string()),
};
type PlaybookArgs = {
  serviceLine?: string;
  city?: string;
  exclude?: string;
};

export const playbook = authenticatedQuery({
  args: playbookArgs,
  returns: v.array(
    v.object({
      serviceLine: v.string(),
      city: v.string(),
      playType: v.string(),
      interests: v.array(v.string()),
      spend: v.number(),
      leads: v.number(),
      cpl: v.number(),
      clients: v.number(),
      verdict: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    return await buildPlaybook(ctx, args);
  },
});

export async function buildPlaybook(ctx: QueryCtx, args: PlaybookArgs) {
  const all = await playsFor(ctx);
  const groups = new Map<string, Group>();

  for (const p of all) {
    if (args.serviceLine && p.serviceLine !== args.serviceLine) continue;
    if (args.city && p.city !== args.city) continue;
    if (args.exclude && p.client === args.exclude) continue;

    // Interests define the play; broad and lookalike are plays in their own right.
    const stack = [...p.interests].sort();
    const key = [
      p.serviceLine ?? "?",
      p.city ?? "?",
      p.playType,
      stack.join("|"),
    ].join("::");

    const g = groups.get(key) ?? {
      key,
      serviceLine: p.serviceLine ?? "Unknown",
      city: p.city ?? "Unknown",
      playType: p.playType,
      interests: stack,
      spend: 0,
      leads: 0,
      clients: new Set<string>(),
    };
    g.spend += p.spend;
    g.leads += p.leads;
    g.clients.add(p.client);
    groups.set(key, g);
  }

  return [...groups.values()]
    .filter(g => g.spend >= MIN_SPEND && g.leads > 0)
    .map(g => {
      const cpl = g.spend / g.leads;
      return {
        serviceLine: g.serviceLine,
        city: g.city,
        playType: g.playType,
        interests: g.interests,
        spend: Math.round(g.spend),
        leads: g.leads,
        cpl: Number(cpl.toFixed(2)),
        clients: g.clients.size,
        // Two clients beating the gate is a pattern; one is an anecdote.
        verdict:
          cpl <= CPL_GATE && g.clients.size > 1
            ? "Proven"
            : cpl <= CPL_GATE
              ? "Worked once"
              : "Expensive",
      };
    })
    .sort((a, b) => a.cpl - b.cpl);
}

/** The service lines and cities we actually hold data for. */
export const dimensions = authenticatedQuery({
  args: {},
  returns: v.object({
    serviceLines: v.array(v.string()),
    cities: v.array(v.string()),
    plays: v.number(),
    clients: v.number(),
  }),
  handler: async ctx => {
    await assertRole(ctx, "creative");
    return await buildDimensions(ctx);
  },
});

export async function buildDimensions(ctx: QueryCtx) {
  const all = await playsFor(ctx);
  return {
    serviceLines: [
      ...new Set(all.map(p => p.serviceLine).filter(Boolean) as string[]),
    ].sort(),
    cities: [
      ...new Set(all.map(p => p.city).filter(Boolean) as string[]),
    ].sort(),
    plays: all.length,
    clients: new Set(all.map(p => p.client)).size,
  };
}

/**
 * What has worked on the creative side, independent of targeting.
 *
 * Aziz's point: an interest stack is only half the lesson. If short Arabic copy
 * with a question hook on video carries interior design in Riyadh, that pattern
 * should be reusable for another interior design client in Manama. This groups
 * the ad-level rows by format, CTA and copy trait so the pattern is visible.
 * [aziz, 2026-09-06]
 */
const patternArgs = {
  serviceLine: v.optional(v.string()),
  exclude: v.optional(v.string()),
};
type PatternArgs = { serviceLine?: string; exclude?: string };

export const creativePatterns = authenticatedQuery({
  args: patternArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    return await buildCreativePatterns(ctx, args);
  },
});

export async function buildCreativePatterns(ctx: QueryCtx, args: PatternArgs) {
  const plays = await playsFor(ctx);
  const rows = plays.filter(
    p =>
      (!args.serviceLine || p.serviceLine === args.serviceLine) &&
      (!args.exclude || p.client !== args.exclude),
  );

  type Bucket = {
    key: string;
    kind: string;
    spend: number;
    leads: number;
    clients: Set<string>;
    ads: number;
  };
  const buckets = new Map<string, Bucket>();
  const add = (
    kind: string,
    key: string,
    spend: number,
    leads: number,
    client: string,
  ) => {
    if (!key) return;
    const id = `${kind}::${key}`;
    const b = buckets.get(id) ?? {
      key,
      kind,
      spend: 0,
      leads: 0,
      clients: new Set<string>(),
      ads: 0,
    };
    b.spend += spend;
    b.leads += leads;
    b.clients.add(client);
    b.ads += 1;
    buckets.set(id, b);
  };

  for (const p of rows) {
    for (const cr of p.creatives ?? []) {
      add("format", cr.format, cr.spend, cr.leads, p.client);
      if (cr.cta) add("cta", cr.cta, cr.spend, cr.leads, p.client);
    }
    // Copy traits and language are properties of the ad set's creative mix, so
    // they carry the ad set's totals rather than a single ad's.
    for (const t of p.copyTraits ?? [])
      add("copy", t, p.spend, p.leads, p.client);
    if (p.language) add("language", p.language, p.spend, p.leads, p.client);
  }

  // Below this there is not enough money behind a pattern to trust it.
  const MIN = 100;
  return [...buckets.values()]
    .filter(b => b.spend >= MIN && b.leads > 0)
    .map(b => ({
      kind: b.kind,
      key: b.key,
      spend: Math.round(b.spend),
      leads: b.leads,
      cpl: Math.round((b.spend / b.leads) * 100) / 100,
      clients: b.clients.size,
      ads: b.ads,
      verdict: b.clients.size >= 2 ? "Proven across clients" : "Worked once",
    }))
    .sort((a, b) => a.cpl - b.cpl);
}

/**
 * The winning ads, read from the permanent archive so switched-off winners are
 * still there. Falls back to the live plays only if the archive is empty.
 *
 * Ads the team saved with "Save as winner" come first, newest first, and are
 * never cut by `limit`; then the weekly check's winners by cost per lead. The
 * rules live in winners.ts and match the media buyer's.
 */
const winnerArgs = {
  serviceLine: v.optional(v.string()),
  exclude: v.optional(v.string()),
  limit: v.optional(v.number()),
  /** Default false: retired winners are still worth reusing. */
  liveOnly: v.optional(v.boolean()),
  /** "saved": saved by the team. "auto": found by the weekly check. */
  origin: vOrigin,
  /** Only saves by this person (their email). */
  savedBy: v.optional(v.string()),
};
type WinnerArgs = {
  serviceLine?: string;
  exclude?: string;
  limit?: number;
  liveOnly?: boolean;
  origin?: Origin;
  savedBy?: string;
};

export const winners = authenticatedQuery({
  args: winnerArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    return await buildMarketWinners(ctx, args);
  },
});

export async function buildMarketWinners(ctx: QueryCtx, args: WinnerArgs) {
  const rows = await ctx.db.query("winnersArchive").collect();
  const source: Record<string, any>[] = rows.length
    ? rows.map(r => ({ ...r }))
    : winnersFrom(await playsFor(ctx));

  // Archive rows and play rows differ in shape; both carry what is read here.
  const out: any[] = orderWinners(source as any[], {
    origin: args.origin,
    savedBy: args.savedBy,
    limit: args.limit ?? 40,
    keep: r => {
      if (args.serviceLine && r.serviceLine !== args.serviceLine) return false;
      if (args.exclude && r.client === args.exclude) return false;
      if (args.liveOnly && r.stillLive === false) return false;
      return true;
    },
  });
  return out.map(r => ({
    adId: r.adId,
    adName: r.adName,
    client: r.client,
    serviceLine: r.serviceLine ?? "Unknown",
    city: r.city ?? "Unknown",
    format: r.format,
    cta: r.cta ?? null,
    headline: r.headline ?? null,
    body: r.body ?? null,
    transcript: r.transcript ?? null,
    hook: r.hook ?? null,
    voice: r.voice ?? null,
    thumbUrl: r.thumbUrl ?? null,
    language: r.language ?? null,
    copyTraits: r.copyTraits ?? [],
    playType: r.playType ?? null,
    interests: r.interests ?? [],
    spend: r.spend,
    leads: r.leads,
    cpl: typeof r.cpl === "number" ? r.cpl : null,
    wonFrom: r.wonFrom ?? null,
    wonTo: r.wonTo ?? null,
    stillLive: r.stillLive ?? null,
    retiredOn: r.retiredOn ?? null,
    origin: r.origin ?? "auto",
    isSaved: isSaved(r),
    isAuto: isAuto(r),
    savedBy: r.savedBy ?? null,
    savedByName: r.savedByName ?? null,
    savedAt: r.savedAt ?? null,
    savedNote: r.savedNote ?? null,
    savedRange: r.savedRange ?? null,
    savedStats: r.savedStats ?? null,
    stillKey: r.stillKey ?? null,
    stillUrl: r.stillUrl ?? null,
    stillTinyUrl: r.stillTinyUrl ?? null,
    accountId: r.accountId ?? null,
    campaignName: r.campaignName ?? null,
  }));
}
