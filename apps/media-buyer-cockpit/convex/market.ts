import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * The GCC winning-data database.
 *
 * Every ad set we run is one observation: what was targeted, and what it
 * returned. Aggregated across clients it answers the question that actually
 * compounds — "what works for this service line in this city?" — so a new
 * client inherits everything the last thirty taught us.
 */

/** Enough spend to mean something. Below this, a cheap CPL is just noise. */
const MIN_SPEND = 100;
/** Our working cost-per-lead gate, confirmed by Aziz 2026-09-05. */
const CPL_GATE = 15;

export const store = internalMutation({
  args: { rows: v.array(v.any()), windowDays: v.number() },
  returns: v.object({ written: v.number() }),
  handler: async (ctx, { rows, windowDays }) => {
    let written = 0;
    for (const r of rows) {
      const existing = await ctx.db
        .query("marketPlays")
        .withIndex("by_adset", q => q.eq("adsetId", r.adsetId))
        .unique()
        .catch(() => null);
      const doc: Record<string, unknown> = {
        ...r,
        windowDays,
        syncedAt: Date.now(),
      };
      if (existing) {
        // Transcripts are expensive (a video model per ad) and are written by a
        // separate pass. A plain patch here wipes all of them — it did, once.
        // Carry the read-off-the-video fields across by ad id. [2026-09-07]
        const prior = new Map(
          (existing.creatives ?? []).map(c => [c.adId, c]),
        );
        doc.creatives = (r.creatives ?? []).map(
          (c: { adId: string; transcript?: string }) => {
            const old = prior.get(c.adId);
            if (!old) return c;
            return {
              ...c,
              transcript: c.transcript ?? old.transcript,
              hook: c.transcript ? undefined : old.hook,
              voice: c.transcript ? undefined : old.voice,
            };
          },
        );
        // Convex optional fields reject explicit undefined keys.
        doc.creatives = (doc.creatives as Record<string, unknown>[]).map(c =>
          Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)),
        );
        await ctx.db.patch(existing._id, doc);
      }
      else await ctx.db.insert("marketPlays", doc as never);
      written++;
    }
    return { written };
  },
});

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
      cities: [...new Set(all.map(p => p.city).filter(Boolean) as string[])].sort(),
      plays: all.length,
      clients: new Set(all.map(p => p.client)).size,
    };
  },
});

/**
 * What we know about this client, and what has worked for their service line
 * elsewhere that they are not already running.
 *
 * This is the playbook delivered at the moment of decision — while she is
 * building — rather than on a page she has to remember to open.
 */
export const forClient = query({
  args: { client: v.string() },
  returns: v.object({
    city: v.optional(v.string()),
    serviceLine: v.optional(v.string()),
    running: v.array(v.string()),
    suggestions: v.array(
      v.object({
        city: v.string(),
        playType: v.string(),
        interests: v.array(v.string()),
        cpl: v.number(),
        clients: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { client }) => {
    const all = await ctx.db.query("marketPlays").collect();
    const mine = all.filter(p => p.client === client);
    const city = mine[0]?.city ?? undefined;
    const serviceLine = mine[0]?.serviceLine ?? undefined;
    if (!serviceLine) return { city, serviceLine, running: [], suggestions: [] };

    // What this client already runs, so we never suggest their own setup back.
    const running = [
      ...new Set(
        mine.map(p =>
          p.interests.length ? p.interests.sort().join("|") : p.playType,
        ),
      ),
    ];

    const groups = new Map<
      string,
      { city: string; playType: string; interests: string[]; spend: number; leads: number; clients: Set<string> }
    >();
    for (const p of all) {
      if (p.serviceLine !== serviceLine) continue;
      if (p.client === client) continue;
      const stack = [...p.interests].sort();
      const sig = stack.length ? stack.join("|") : p.playType;
      if (running.includes(sig)) continue;
      const key = `${p.city}::${p.playType}::${sig}`;
      const g = groups.get(key) ?? {
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

    const suggestions = [...groups.values()]
      .filter(g => g.spend >= MIN_SPEND && g.leads > 0)
      .map(g => ({
        city: g.city,
        playType: g.playType,
        interests: g.interests,
        cpl: Number((g.spend / g.leads).toFixed(2)),
        clients: g.clients.size,
      }))
      .filter(g => g.cpl <= CPL_GATE)
      .sort((a, b) => a.cpl - b.cpl)
      .slice(0, 3);

    return { city, serviceLine, running, suggestions };
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
    const add = (kind: string, key: string, spend: number, leads: number, client: string) => {
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
        verdict:
          b.clients.size >= 2 ? "Proven across clients" : "Worked once",
      }))
      .sort((a, b) => a.cpl - b.cpl);
  },
});


/**
 * The individual ads that actually won, with their real copy and script.
 *
 * The aggregate patterns say "question hooks beat urgency". This says "here is
 * the ad that did it, here is what it said, go read it". Aziz's example was
 * ARCWANI: when something performs, we should be able to open it and reuse the
 * angle for the next client in that service line. [aziz, 2026-09-06]
 */
const WINNER_MIN_SPEND = 100;
const WINNER_MAX_CPL = 15;

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
 * Write today's winners into the permanent archive.
 *
 * Nothing is ever deleted here. An ad that stops running keeps its copy,
 * script and preview, and gets `stillLive: false` with the date it went quiet,
 * so a retired winner can still be reused for another client. Numbers are kept
 * at their best: an ad judged on its winning window, not on a tail of dribbling
 * spend. [aziz, 2026-09-07]
 */
export const archiveWinners = internalMutation({
  args: {},
  returns: v.object({
    archived: v.number(),
    added: v.number(),
    retired: v.number(),
  }),
  handler: async ctx => {
    const plays = await ctx.db.query("marketPlays").collect();
    const current = winnersFrom(plays);

    // The window each ad actually ran in, off the daily grain.
    const span = new Map<string, { from: string; to: string }>();
    for (const d of await ctx.db.query("dailyStats").collect()) {
      if (!d.metaAdId || d.spend <= 0) continue;
      const cur = span.get(d.metaAdId);
      if (!cur) span.set(d.metaAdId, { from: d.date, to: d.date });
      else {
        if (d.date < cur.from) cur.from = d.date;
        if (d.date > cur.to) cur.to = d.date;
      }
    }
    // What Meta still reports as running.
    const live = new Set<string>();
    const campaignOf = new Map<string, string>();
    for (const t of await ctx.db.query("metaTree").collect()) {
      if (t.kind !== "ad") continue;
      campaignOf.set(t.metaId, t.campaignName);
      if (!/paused|archived|deleted|disapproved/i.test(t.effectiveStatus ?? t.status))
        live.add(t.metaId);
    }

    const now = Date.now();
    const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
    let added = 0;
    const seen = new Set<string>();

    for (const w of current) {
      const adId = String(w.adId);
      seen.add(adId);
      const window = span.get(adId);
      const existing = await ctx.db
        .query("winnersArchive")
        .withIndex("by_ad", (q: any) => q.eq("adId", adId))
        .unique()
        .catch(() => null);
      const doc: Record<string, unknown> = {
        ...w,
        campaignName: campaignOf.get(adId) ?? existing?.campaignName,
        stillLive: live.has(adId),
        wonFrom:
          existing?.wonFrom && window
            ? existing.wonFrom < window.from
              ? existing.wonFrom
              : window.from
            : (existing?.wonFrom ?? window?.from),
        wonTo:
          existing?.wonTo && window
            ? existing.wonTo > window.to
              ? existing.wonTo
              : window.to
            : (existing?.wonTo ?? window?.to),
        lastSeenAt: now,
        firstArchivedAt: existing?.firstArchivedAt ?? now,
        retiredOn: live.has(adId) ? undefined : (existing?.retiredOn ?? today),
      };
      // Keep the best numbers, and never drop a transcript we already read.
      if (existing) {
        if (existing.spend > Number(doc.spend)) {
          doc.spend = existing.spend;
          doc.leads = existing.leads;
          doc.cpl = existing.cpl;
        }
        doc.transcript = doc.transcript ?? existing.transcript;
        doc.hook = doc.hook ?? existing.hook;
        doc.voice = doc.voice ?? existing.voice;
        doc.previewSrc = doc.previewSrc ?? existing.previewSrc;
        doc.thumbUrl = doc.thumbUrl ?? existing.thumbUrl;
      }
      const clean = Object.fromEntries(
        Object.entries(doc).filter(([, v]) => v !== undefined && v !== null),
      );
      if (existing) await ctx.db.replace(existing._id, clean as never);
      else {
        await ctx.db.insert("winnersArchive", clean as never);
        added++;
      }
    }

    // Anything already archived that no longer shows up live gets marked, not deleted.
    let retired = 0;
    for (const row of await ctx.db.query("winnersArchive").collect()) {
      if (seen.has(row.adId)) continue;
      const isLive = live.has(row.adId);
      if (row.stillLive === isLive && (isLive || row.retiredOn)) continue;
      await ctx.db.patch(row._id, {
        stillLive: isLive,
        retiredOn: isLive ? undefined : (row.retiredOn ?? today),
      });
      if (!isLive) retired++;
    }

    const archived = (await ctx.db.query("winnersArchive").collect()).length;
    return { archived, added, retired };
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

/** Archive counts, for the sync self-check. */
export const archiveStats = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("winnersArchive").collect();
    return {
      total: rows.length,
      live: rows.filter(r => r.stillLive).length,
      retired: rows.filter(r => r.stillLive === false).length,
      withTranscript: rows.filter(r => r.transcript).length,
      withPreview: rows.filter(r => r.previewSrc || r.thumbUrl).length,
      oldestWonFrom: rows.map(r => r.wonFrom).filter(Boolean).sort()[0] ?? null,
    };
  },
});

/**
 * Attach a transcript to one ad inside its play. Called by the transcription
 * pass, which runs separately because it is slow and costs money per video.
 */
export const storeTranscript = internalMutation({
  args: {
    adsetId: v.string(),
    adId: v.string(),
    transcript: v.string(),
    hook: v.optional(v.string()),
    voice: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { adsetId, adId, transcript, hook, voice }) => {
    const play = await ctx.db
      .query("marketPlays")
      .withIndex("by_adset", q => q.eq("adsetId", adsetId))
      .unique()
      .catch(() => null);
    if (!play) return { ok: false };
    const creatives = (play.creatives ?? []).map(c =>
      c.adId === adId ? { ...c, transcript, hook, voice } : c,
    );
    await ctx.db.patch(play._id, { creatives });
    // Keep the permanent archive in step, so a retired winner keeps its script.
    const archived = await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", (q: any) => q.eq("adId", adId))
      .unique()
      .catch(() => null);
    if (archived) {
      await ctx.db.patch(archived._id, {
        transcript,
        ...(hook ? { hook } : {}),
        ...(voice ? { voice } : {}),
      });
    }
    return { ok: true };
  },
});

/** Video ads in the database that have no transcript yet. */
export const untranscribed = query({
  args: { minSpend: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { minSpend }) => {
    const plays = await ctx.db.query("marketPlays").collect();
    const out: Array<Record<string, unknown>> = [];
    for (const p of plays) {
      for (const cr of p.creatives ?? []) {
        if (!cr.videoId || cr.transcript) continue;
        if (cr.spend < (minSpend ?? 100)) continue;
        out.push({
          adsetId: p.adsetId,
          adId: cr.adId,
          adName: cr.adName,
          videoId: cr.videoId,
          client: p.client,
          spend: cr.spend,
          cpl: cr.cpl ?? null,
        });
      }
    }
    return out.sort((a, b) => (b.spend as number) - (a.spend as number));
  },
});

/**
 * Every play, raw.
 *
 * Read by the sync bridge only, to mirror these rows into the creative
 * director's Space so his "What works" page is the same page over the same
 * data rather than a second, drifting implementation. [aziz, 2026-09-07]
 */
export const rawPlays = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("marketPlays").collect();
    return rows.map(({ _id, _creationTime, syncedAt, ...rest }) => rest);
  },
});
