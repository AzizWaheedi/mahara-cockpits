import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { CPL_GATE } from "./constants";
import { authenticatedQuery } from "./functions";
import {
  isAutoWinner,
  isSavedWinner,
  metaImageExpiry,
  metaImageUsable,
  stillKeyFor,
} from "./metaMedia";
import { type CaptureItem, lookupStills } from "./previews";
import { assertRole } from "./roles";

/**
 * "Save as winner" rules, shared by the collector, the What works queries and
 * winnerSaves.ts. The creative cockpit copies the same rules.
 */

/**
 * A save counts while it is newer than any "Remove from What works". The rule
 * itself lives in metaMedia.ts, next to the daily picture check that uses it.
 */
export const isSaved = isSavedWinner;

/** Picked by the weekly check's rule. Rows written before 2026-09-16 have no origin. */
export const isAuto = isAutoWinner;

/**
 * The one row a save marks and the collector updates when an ad has more
 * than one: the saved row (the newest save), else the oldest row.
 */
export function primaryRow<
  T extends { savedAt?: number; _creationTime?: number },
>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const saved = rows
    .filter(r => r.savedAt !== undefined)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  if (saved.length > 0) return saved[0];
  return [...rows].sort(
    (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0),
  )[0];
}

/** Meta still delivers it: the test the archive has always used. */
export function adIsLive(status: string | undefined): boolean {
  return !/paused|archived|deleted|disapproved/i.test(status ?? "");
}

/** Keeps one row per ad for display: an active save first, else the primary row. */
function onePerAd(rows: Record<string, any>[]): Record<string, any>[] {
  const byAd = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const list = byAd.get(String(r.adId)) ?? [];
    list.push(r);
    byAd.set(String(r.adId), list);
  }
  return [...byAd.values()].map(list => {
    const saved = list
      .filter(isSaved)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    return saved[0] ?? primaryRow(list) ?? list[0];
  });
}

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === "object" &&
    typeof b === "object" &&
    JSON.stringify(a) === JSON.stringify(b));

/**
 * The GCC winning-data database.
 *
 * Every ad set we run is one observation: what was targeted, and what it
 * returned. Aggregated across clients it answers the question that actually
 * compounds ("what works for this service line in this city?"), so a new
 * client inherits everything the last thirty taught us.
 */

/** Enough spend to mean something. Below this, a cheap CPL is just noise. */
const MIN_SPEND = 100;

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
        // separate pass. A plain patch here wipes all of them; it did, once.
        // Carry the read-off-the-video fields across by ad id. [2026-09-07]
        const prior = new Map((existing.creatives ?? []).map(c => [c.adId, c]));
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
          Object.fromEntries(
            Object.entries(c).filter(([, v]) => v !== undefined),
          ),
        );
        await ctx.db.patch(existing._id, doc);
      } else await ctx.db.insert("marketPlays", doc as never);
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
export const playbook = authenticatedQuery({
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
    await assertRole(ctx, "media_buyer");
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
export const dimensions = authenticatedQuery({
  args: {},
  returns: v.object({
    serviceLines: v.array(v.string()),
    cities: v.array(v.string()),
    plays: v.number(),
    clients: v.number(),
  }),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
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
 * What we know about this client, and what has worked for their service line
 * elsewhere that they are not already running.
 *
 * This is the playbook delivered at the moment of decision, while she is
 * building, rather than on a page she has to remember to open.
 */
export const forClient = authenticatedQuery({
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
    await assertRole(ctx, "media_buyer");
    const all = await ctx.db.query("marketPlays").collect();
    const mine = all.filter(p => p.client === client);
    const city = mine[0]?.city ?? undefined;
    const serviceLine = mine[0]?.serviceLine ?? undefined;
    if (!serviceLine)
      return { city, serviceLine, running: [], suggestions: [] };

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
      {
        city: string;
        playType: string;
        interests: string[];
        spend: number;
        leads: number;
        clients: Set<string>;
      }
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
export const creativePatterns = authenticatedQuery({
  args: {
    serviceLine: v.optional(v.string()),
    exclude: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
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
        // No preview link: those die within a day and are fetched on open.
        thumbUrl: cr.thumbUrl,
        creativeId: cr.creativeId,
        accountId: p.accountId
          ? String(p.accountId).replace(/^act_/, "")
          : undefined,
        stillKey: cr.stillKey ?? stillKeyFor(cr.creativeId, cr.adId),
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
 * script and picture, and gets `stillLive: false` with the date it went quiet,
 * so a retired winner can still be reused for another client. Numbers are kept
 * at their best: an ad judged on its winning window, not on a tail of dribbling
 * spend. [aziz, 2026-09-07]
 *
 * A person's "Save as winner" (winnerSaves.ts) is never overwritten or removed
 * here: the collector patches rows field by field, never touches the saved
 * fields or `origin`, and leaves the labels of a saved row alone. A row a
 * person saved first gets `autoFirstAt` the first time the rule also picks it.
 * [aziz, 2026-09-16]
 *
 * Runs after the weekly collector and once a day from the sync, not on every
 * sync: it reads four whole tables.
 */
export const archiveWinners = internalMutation({
  args: {},
  returns: v.object({
    archived: v.number(),
    added: v.number(),
    retired: v.number(),
    updated: v.number(),
    stillsQueued: v.number(),
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
    // What Meta still reports as running. `treeCampaigns` is every campaign
    // Meta answered for this run: an ad missing from a campaign that did
    // answer is off, while an ad whose account could not be read keeps its
    // state (this stops the retire-and-come-back flip).
    const live = new Set<string>();
    const campaignOf = new Map<string, string>();
    const treeCampaigns = new Set<string>();
    for (const t of await ctx.db.query("metaTree").collect()) {
      treeCampaigns.add(t.campaignName);
      if (t.kind !== "ad") continue;
      campaignOf.set(t.metaId, t.campaignName);
      if (adIsLive(t.effectiveStatus ?? t.status)) live.add(t.metaId);
    }
    const canJudge = (adId: string, campaign: string | undefined) =>
      live.has(adId) || (campaign !== undefined && treeCampaigns.has(campaign));

    const now = Date.now();
    const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
    let added = 0;
    let updated = 0;
    const seen = new Set<string>();

    for (const w of current) {
      const adId = String(w.adId);
      seen.add(adId);
      const window = span.get(adId);
      const existing = primaryRow(
        await ctx.db
          .query("winnersArchive")
          .withIndex("by_ad", q => q.eq("adId", adId))
          .collect(),
      );
      const campaign = campaignOf.get(adId) ?? existing?.campaignName;
      const judged = canJudge(adId, campaign);
      const isLive = live.has(adId);

      if (!existing) {
        const doc: Record<string, unknown> = {
          ...w,
          origin: "auto",
          campaignName: campaign,
          stillLive: judged ? isLive : undefined,
          retiredOn: judged && !isLive ? today : undefined,
          wonFrom: window?.from,
          wonTo: window?.to,
          lastSeenAt: now,
          firstArchivedAt: now,
        };
        await ctx.db.insert("winnersArchive", stripEmpty(doc) as never);
        added++;
        continue;
      }

      const old = existing as Record<string, any>;
      const patch: Record<string, unknown> = {};
      const set = (field: string, value: unknown) => {
        if (value === undefined || value === null) return;
        if (!same(old[field], value)) patch[field] = value;
      };

      // Keep the best numbers.
      if (Number(w.spend) >= existing.spend) {
        set("spend", w.spend);
        set("leads", w.leads);
        set("cpl", w.cpl);
      }
      // Copy: only filled in, never replaced, so a saved row keeps what was saved.
      for (const f of [
        "headline",
        "body",
        "cta",
        "transcript",
        "hook",
        "voice",
      ]) {
        if (old[f] === undefined) set(f, w[f]);
      }
      if ((!old.format || old.format === "unknown") && w.format !== "unknown") {
        set("format", w.format);
      }
      // A saved row keeps the labels it was saved with.
      if (existing.savedAt === undefined) {
        for (const f of [
          "client",
          "adName",
          "serviceLine",
          "city",
          "country",
        ]) {
          set(f, w[f]);
        }
      }
      for (const f of [
        "language",
        "copyTraits",
        "playType",
        "interests",
        "adsetName",
      ]) {
        set(f, w[f]);
      }
      // The winning window, widened.
      set(
        "wonFrom",
        existing.wonFrom && window
          ? existing.wonFrom < window.from
            ? existing.wonFrom
            : window.from
          : (existing.wonFrom ?? window?.from),
      );
      set(
        "wonTo",
        existing.wonTo && window
          ? existing.wonTo > window.to
            ? existing.wonTo
            : window.to
          : (existing.wonTo ?? window?.to),
      );
      if (judged) {
        set("stillLive", isLive);
        const retiredOn = isLive ? undefined : (existing.retiredOn ?? today);
        if (retiredOn !== existing.retiredOn) patch.retiredOn = retiredOn;
      }
      if (w.thumbUrl && w.thumbUrl !== existing.thumbUrl) {
        const next = metaImageExpiry(w.thumbUrl);
        const prev = metaImageExpiry(existing.thumbUrl);
        const newer =
          !existing.thumbUrl ||
          (next ?? 0) > (prev ?? 0) ||
          (next === undefined && prev === undefined);
        if (newer) patch.thumbUrl = w.thumbUrl;
      }
      set("creativeId", w.creativeId);
      set("accountId", w.accountId);
      // The key names the saved picture; once a picture is saved under one key,
      // the key stays with it.
      // A key by ad id never replaces one by creative id (a save may know the
      // creative when the collected play does not).
      if (!existing.stillUrl && (w.creativeId || !existing.stillKey)) {
        set("stillKey", w.stillKey);
      }
      if (!existing.campaignName) set("campaignName", campaign);
      if (now - existing.lastSeenAt > 20 * 3600_000) patch.lastSeenAt = now;
      if (existing.origin === "manual" && existing.autoFirstAt === undefined) {
        patch.autoFirstAt = now;
      }
      // Preview links die within a day; they are fetched on open now.
      if (existing.previewSrc !== undefined) patch.previewSrc = undefined;

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
        updated++;
      }
    }

    // Everything else in the archive: mark what went quiet (never delete,
    // manual saves included), and find winners that still need a saved picture.
    const all = await ctx.db.query("winnersArchive").collect();
    const primaries = new Map<string, (typeof all)[number]>();
    for (const [adId, rows] of groupByAd(all)) {
      const p = primaryRow(rows);
      if (p) primaries.set(adId, p);
    }
    const keyOf = (r: (typeof all)[number]) =>
      r.stillKey ?? stillKeyFor(r.creativeId, r.adId);
    const wantPicture = [...primaries.values()].filter(
      r => !r.stillUrl && (isSaved(r) || isAuto(r)) && keyOf(r),
    );
    const stills = await lookupStills(
      ctx.db,
      wantPicture.map(r => keyOf(r) as string),
    );

    let retired = 0;
    const capture: CaptureItem[] = [];
    for (const row of primaries.values()) {
      const patch: Record<string, unknown> = {};
      if (!seen.has(row.adId)) {
        const isLive = live.has(row.adId);
        if (canJudge(row.adId, row.campaignName)) {
          if (row.stillLive !== isLive) {
            patch.stillLive = isLive;
            if (!isLive) retired++;
          }
          const retiredOn = isLive ? undefined : (row.retiredOn ?? today);
          if (retiredOn !== row.retiredOn) patch.retiredOn = retiredOn;
        }
        if (row.previewSrc !== undefined) patch.previewSrc = undefined;
      }
      if (!row.stillUrl && (isSaved(row) || isAuto(row))) {
        const key = keyOf(row);
        if (key) {
          if (!row.stillKey) patch.stillKey = key;
          const still = stills.get(key);
          if (still?.status === "saved" && still.url) {
            patch.stillUrl = still.url;
            if (still.tinyUrl) patch.stillTinyUrl = still.tinyUrl;
          } else if (still?.status !== "gone" && capture.length < 40) {
            capture.push(
              stripEmpty({
                adId: row.adId,
                creativeId: row.creativeId,
                accountId: row.accountId,
                campaignName: row.campaignName,
                sourceUrl: metaImageUsable(row.thumbUrl)
                  ? row.thumbUrl
                  : undefined,
                keep: true,
              }),
            );
          }
        }
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(row._id, patch);
      }
    }
    if (capture.length > 0) {
      await ctx.scheduler.runAfter(0, internal.previews.captureStills, {
        items: capture,
      });
    }

    return {
      archived: all.length,
      added,
      retired,
      updated,
      stillsQueued: capture.length,
    };
  },
});

/** Drops undefined and null fields: Convex optional fields reject them. */
function stripEmpty<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(
    Object.entries(doc).filter(([, x]) => x !== undefined && x !== null),
  ) as T;
}

function groupByAd<T extends { adId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.adId) ?? [];
    list.push(r);
    out.set(r.adId, list);
  }
  return out;
}

/**
 * The winning ads, read from the permanent archive so switched-off winners are
 * still there. Falls back to the live plays only if the archive is empty.
 *
 * Shows the weekly check's winners and the ads the team saved. A saved row
 * comes first (newest save first) and is never cut by `limit`; the rest follow
 * by cost per lead until the list holds `limit` rows. An ad a person saved and
 * then removed, which the rule never picked, is hidden (the row is kept).
 */
export const winners = authenticatedQuery({
  args: {
    serviceLine: v.optional(v.string()),
    exclude: v.optional(v.string()),
    limit: v.optional(v.number()),
    /** Default false: retired winners are still worth reusing. */
    liveOnly: v.optional(v.boolean()),
    /** "saved": the team's saves only. "auto": the weekly check's only. */
    origin: v.optional(
      v.union(v.literal("all"), v.literal("saved"), v.literal("auto")),
    ),
    /** Only saves by this person (their email). */
    savedBy: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    const rows = await ctx.db.query("winnersArchive").collect();
    const source: Record<string, any>[] = rows.length
      ? rows.map(r => ({ ...r }))
      : winnersFrom(await ctx.db.query("marketPlays").collect());

    const origin = args.origin ?? "all";
    const savedBy = args.savedBy?.trim().toLowerCase();
    const shown = onePerAd(
      source.filter(r => {
        if (!(isSaved(r) || isAuto(r))) return false;
        if (args.serviceLine && r.serviceLine !== args.serviceLine)
          return false;
        if (args.exclude && r.client === args.exclude) return false;
        if (args.liveOnly && r.stillLive === false) return false;
        return true;
      }),
    ).filter(r => {
      if (origin === "saved" && !isSaved(r)) return false;
      if (origin === "auto" && !isAuto(r)) return false;
      if (savedBy && !(isSaved(r) && r.savedBy === savedBy)) return false;
      return true;
    });

    const limit = Math.max(0, Math.floor(args.limit ?? 40));
    const cplOf = (r: { cpl?: unknown }) =>
      typeof r.cpl === "number" ? r.cpl : Number.POSITIVE_INFINITY;
    const byCpl = (a: { cpl?: unknown }, b: { cpl?: unknown }) =>
      cplOf(a) - cplOf(b);
    let ordered: typeof shown;
    if (origin === "auto") {
      ordered = shown.sort(byCpl).slice(0, limit);
    } else {
      const saved = shown
        .filter(isSaved)
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
      const rest = shown
        .filter(r => !isSaved(r))
        .sort(byCpl)
        .slice(0, Math.max(0, limit - saved.length));
      ordered = [...saved, ...rest];
    }

    return ordered.map(r => ({
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
      stillKey: r.stillKey ?? null,
      stillUrl: r.stillUrl ?? null,
      stillTinyUrl: r.stillTinyUrl ?? null,
      accountId: r.accountId ?? null,
      campaignName: r.campaignName ?? null,
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
    }));
  },
});

/** Archive counts, for the sync self-check. */
export const archiveStats = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const rows = await ctx.db.query("winnersArchive").collect();
    return {
      total: rows.length,
      live: rows.filter(r => r.stillLive).length,
      retired: rows.filter(r => r.stillLive === false).length,
      withTranscript: rows.filter(r => r.transcript).length,
      withPreview: rows.filter(r => r.stillUrl || metaImageUsable(r.thumbUrl))
        .length,
      withSavedPicture: rows.filter(r => r.stillUrl).length,
      /** Active saves by the team. */
      saved: rows.filter(isSaved).length,
      /** Saved by the team and never picked by the weekly check. */
      savedOnly: rows.filter(
        r => r.origin === "manual" && r.autoFirstAt === undefined,
      ).length,
      oldestWonFrom:
        rows
          .map(r => r.wonFrom)
          .filter(Boolean)
          .sort()[0] ?? null,
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
      .first();
    if (!play) return { ok: false };
    const creatives = (play.creatives ?? []).map(c =>
      c.adId === adId ? { ...c, transcript, hook, voice } : c,
    );
    await ctx.db.patch(play._id, { creatives });
    // Keep the permanent archive in step, so a retired winner keeps its script.
    const archived = await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", q => q.eq("adId", adId))
      .first();
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
export const untranscribed = authenticatedQuery({
  args: { minSpend: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { minSpend }) => {
    await assertRole(ctx, "media_buyer");
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
export const rawPlays = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const rows = await ctx.db.query("marketPlays").collect();
    return rows.map(({ _id, _creationTime, syncedAt, ...rest }) => rest);
  },
});
