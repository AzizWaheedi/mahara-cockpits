import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * "What works" — the media buyer's playbook, mirrored.
 *
 * These are the cockpit's own queries, copied unchanged, running over the
 * `marketPlays` and `winnersArchive` rows the sync mirrors across. If the media
 * buyer's definition of a proven play changes, this file gets recopied rather
 * than reinvented. [aziz, 2026-09-07]
 */

/** Enough spend to mean something. Below this, a cheap CPL is just noise. */
const MIN_SPEND = 100;
/** Our working cost-per-lead gate, confirmed by Aziz 2026-09-05. */
const CPL_GATE = 15;
const WINNER_MIN_SPEND = 100;
const WINNER_MAX_CPL = 15;

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
        previewSrc: cr.previewSrc,
        thumbUrl: cr.thumbUrl,
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
export const playbook = query({
  args: {
    serviceLine: v.optional(v.string()),
    city: v.optional(v.string()),
    exclude: v.optional(v.string()),
  },
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
    const all = await ctx.db.query("marketPlays").collect();
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
  },
});

/** The service lines and cities we actually hold data for. */
export const dimensions = query({
  args: {},
  returns: v.object({
    serviceLines: v.array(v.string()),
    cities: v.array(v.string()),
    plays: v.number(),
    clients: v.number(),
  }),
  handler: async ctx => {
    const all = await ctx.db.query("marketPlays").collect();
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
  },
});

/**
 * What has worked on the creative side, independent of targeting.
 *
 * Aziz's point: an interest stack is only half the lesson. If short Arabic copy
 * with a question hook on video carries interior design in Riyadh, that pattern
 * should be reusable for another interior design client in Manama. This groups
 * the ad-level rows by format, CTA and copy trait so the pattern is visible.
 * [aziz, 2026-09-06]
 */
export const creativePatterns = query({
  args: {
    serviceLine: v.optional(v.string()),
    exclude: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const plays = await ctx.db.query("marketPlays").collect();
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
  },
});

/**
 * The winning ads, read from the permanent archive so switched-off winners are
 * still there. Falls back to the live plays only if the archive is empty.
 */
export const winners = query({
  args: {
    serviceLine: v.optional(v.string()),
    exclude: v.optional(v.string()),
    limit: v.optional(v.number()),
    /** Default false: retired winners are still worth reusing. */
    liveOnly: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("winnersArchive").collect();
    const source: Record<string, any>[] = rows.length
      ? rows.map(r => ({ ...r }))
      : winnersFrom(await ctx.db.query("marketPlays").collect());

    const out = source.filter(r => {
      if (args.serviceLine && r.serviceLine !== args.serviceLine) return false;
      if (args.exclude && r.client === args.exclude) return false;
      if (args.liveOnly && r.stillLive === false) return false;
      return true;
    });
    out.sort((a, b) => (a.cpl as number) - (b.cpl as number));
    return out.slice(0, args.limit ?? 40).map(r => ({
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
      previewSrc: r.previewSrc ?? null,
      thumbUrl: r.thumbUrl ?? null,
      language: r.language ?? null,
      copyTraits: r.copyTraits ?? [],
      playType: r.playType ?? null,
      interests: r.interests ?? [],
      spend: r.spend,
      leads: r.leads,
      cpl: r.cpl,
      wonFrom: r.wonFrom ?? null,
      wonTo: r.wonTo ?? null,
      stillLive: r.stillLive ?? null,
      retiredOn: r.retiredOn ?? null,
    }));
  },
});
