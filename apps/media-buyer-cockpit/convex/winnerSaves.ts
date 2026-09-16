import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertScope, emailOf } from "./gate";
import { adIsLive, isAuto, isSaved, primaryRow } from "./market";
import { classifyServiceLine } from "./marketCollect";
import { metaImageUsable, stillKeyFor } from "./metaMedia";
import { lookupStills } from "./previews";
import { assertRole } from "./roles";
import schema from "./schema";

/**
 * "Save as winner", from the Ads table in Ads management.
 *
 * The weekly check only keeps ads that spent at least $100 at $15 or less a
 * lead. A media buyer often knows an ad is worth keeping before that, or for a
 * reason the rule cannot see. Saving marks the ad's row in the winners
 * archive (or adds one), with who saved it, why, and the ad's own numbers over
 * the range she was looking at. The collector never overwrites or removes a
 * save (market.ts), and the save travels to the creative cockpit with the
 * other winners.
 *
 * Numbers are always worked out here from the ad's own daily rows, never taken
 * from the browser. A save is logged to the campaign thread and to usage, never
 * to manualChanges: a row there would restart the campaign's learning clock and
 * post a false change to ClickUp. [aziz, 2026-09-16]
 */

const AD_ID = /^\d{5,25}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 500;
/** Below these, link CTR, CPM and opt-in rate are noise. Matches stats.ts. */
const MIN_IMPRESSIONS_FOR_RATES = 1000;
const MIN_LINK_CLICKS_FOR_OPTIN = 50;

/** A mutation context is also a query context, so helpers take this. */
type Ctx = QueryCtx;
type Stats = NonNullable<Doc<"winnersArchive">["savedStats"]>;
type Tree = Doc<"metaTree">;

/** The saved-numbers shape, straight from the schema so the two never drift. */
const vStats = schema.tables.winnersArchive.validator.fields.savedStats;

/** A refusal the person can read. Plain Errors lose their text in production. */
function refuse(message: string): never {
  throw new ConvexError(message);
}

function asConvexError(e: unknown): unknown {
  if (e instanceof ConvexError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ConvexError(msg || "The save did not go through.");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const usd = (n: number | undefined) =>
  n === undefined
    ? "n/a"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const bareAccount = (id: unknown) =>
  id === undefined || id === null || id === ""
    ? undefined
    : String(id).replace(/^act_/, "");

/** Drops undefined and null fields: Convex optional fields reject them. */
function strip<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(
    Object.entries(doc).filter(([, x]) => x !== undefined && x !== null),
  ) as T;
}

function checkRange(start: string, end: string) {
  if (
    !DAY.test(start) ||
    !DAY.test(end) ||
    Number.isNaN(Date.parse(start)) ||
    Number.isNaN(Date.parse(end))
  ) {
    refuse("Pick a date range first.");
  }
  if (start > end) refuse("That date range ends before it starts.");
}

function checkAdId(adId: string) {
  if (!AD_ID.test(adId)) refuse("That is not a Meta ad id.");
}

/** The role and client checks every public function here starts with. */
async function gate(ctx: Ctx, campaignName: string) {
  await assertRole(ctx, "media_buyer");
  await assertScope(ctx, { campaignName });
}

/** The saver's email and the name the team knows them by. */
async function saver(ctx: Ctx): Promise<{ email: string; name: string }> {
  const email = await emailOf(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_email", q => q.eq("email", email))
    .first();
  const name = member?.name?.trim() || email.split("@")[0];
  return { email, name };
}

/** The ad in Meta's tree, preferring the node under this campaign. */
async function treeAd(
  ctx: Ctx,
  adId: string,
  campaignName?: string,
): Promise<Tree | null> {
  const nodes = (
    await ctx.db
      .query("metaTree")
      .withIndex("by_meta", q => q.eq("metaId", adId))
      .take(10)
  ).filter(n => n.kind === "ad");
  return nodes.find(n => n.campaignName === campaignName) ?? nodes[0] ?? null;
}

/** Tree ads in this campaign with this exact name. */
async function adsNamed(
  ctx: Ctx,
  campaignName: string,
  adName: string,
): Promise<Tree[]> {
  return (
    await ctx.db
      .query("metaTree")
      .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
      .collect()
  ).filter(t => t.kind === "ad" && t.name === adName);
}

type Acc = {
  rows: number;
  spend: number;
  leads: number;
  impressions: number;
  linkClicks: number;
  frequency?: number;
  adSetName?: string;
};

const emptyAcc = (): Acc => ({
  rows: 0,
  spend: 0,
  leads: 0,
  impressions: 0,
  linkClicks: 0,
});

function addRow(a: Acc, r: Doc<"dailyStats">) {
  a.rows += 1;
  a.spend += r.spend;
  a.leads += r.leads;
  a.impressions += r.impressions;
  a.linkClicks += r.linkClicks;
  if (r.frequency !== undefined) {
    a.frequency = Math.max(a.frequency ?? 0, r.frequency);
  }
  if (r.adSetName) a.adSetName = r.adSetName;
}

/**
 * One ad's numbers over a range, from the daily grain and the bookings.
 *
 * Rows carrying the ad id count. When `byName` is set, rows with no ad id and
 * this ad name count too: only safe when this is the one ad in the campaign
 * with that name, which the caller checks.
 */
async function foldAd(
  ctx: Ctx,
  a: {
    campaignName: string;
    adId: string;
    start: string;
    end: string;
    byName?: string;
  },
): Promise<{
  stats: Stats;
  rows: number;
  rowsWithId: number;
  adSetName?: string;
}> {
  const daily = await ctx.db
    .query("dailyStats")
    .withIndex("by_campaign_date", q =>
      q
        .eq("campaignName", a.campaignName)
        .gte("date", a.start)
        .lte("date", a.end),
    )
    .collect();
  const bookings = await ctx.db
    .query("bookingEvents")
    .withIndex("by_campaign_date", q =>
      q
        .eq("campaignName", a.campaignName)
        .gte("date", a.start)
        .lte("date", a.end),
    )
    .collect();

  const acc = emptyAcc();
  let rowsWithId = 0;
  for (const r of daily) {
    if (r.metaAdId === a.adId) {
      addRow(acc, r);
      rowsWithId++;
    } else if (a.byName && !r.metaAdId && r.adName === a.byName) {
      addRow(acc, r);
    }
  }
  const mine = bookings.filter(b => b.adId === a.adId);
  const booked = mine.length;
  const rateable = acc.impressions >= MIN_IMPRESSIONS_FOR_RATES;
  const stats = strip({
    spend: round2(acc.spend),
    leads: acc.leads,
    cpl: acc.leads > 0 ? round2(acc.spend / acc.leads) : undefined,
    impressions: acc.impressions,
    linkClicks: acc.linkClicks,
    linkCtr: rateable
      ? round2((acc.linkClicks / acc.impressions) * 100)
      : undefined,
    cpm: rateable ? round2((acc.spend / acc.impressions) * 1000) : undefined,
    optInRate:
      acc.linkClicks >= MIN_LINK_CLICKS_FOR_OPTIN
        ? round2((acc.leads / acc.linkClicks) * 100)
        : undefined,
    frequency: acc.frequency !== undefined ? round2(acc.frequency) : undefined,
    bookings: booked,
    showed: mine.filter(b => b.status === "showed").length,
    costPerBooking: booked > 0 ? round2(acc.spend / booked) : undefined,
    // Same rule as the range table: per-ad bookings only mean something when
    // bookings in this range could be traced to an ad at all.
    bookingsAttributed: bookings.some(b => Boolean(b.adId)),
  }) as Stats;
  return { stats, rows: acc.rows, rowsWithId, adSetName: acc.adSetName };
}

/**
 * The ad's numbers, with the no-id fallback applied when it is safe: the rows
 * lack the id, the tree has this ad under this name, and no other ad in the
 * campaign shares the name.
 */
async function numbersFor(
  ctx: Ctx,
  a: {
    campaignName: string;
    adId: string;
    adName: string;
    start: string;
    end: string;
    node: Tree | null;
  },
) {
  const byId = await foldAd(ctx, a);
  if (
    byId.rowsWithId > 0 ||
    !a.node ||
    a.node.campaignName !== a.campaignName ||
    a.node.name !== a.adName
  ) {
    return byId;
  }
  const named = await adsNamed(ctx, a.campaignName, a.adName);
  if (named.length !== 1) return byId;
  return await foldAd(ctx, { ...a, byName: a.adName });
}

/** The saved picture for an ad: the tree node's, else the stills table's. */
async function pictureFor(
  ctx: Ctx,
  key: string | undefined,
  node: { stillUrl?: string; stillTinyUrl?: string } | null,
): Promise<{ stillUrl?: string; stillTinyUrl?: string }> {
  if (node?.stillUrl) {
    return { stillUrl: node.stillUrl, stillTinyUrl: node.stillTinyUrl };
  }
  if (!key) return {};
  const still = (await lookupStills(ctx.db, [key])).get(key);
  if (still?.status === "saved" && still.url) {
    return { stillUrl: still.url, stillTinyUrl: still.tinyUrl };
  }
  return {};
}

const vCandidate = v.object({
  adId: v.string(),
  name: v.string(),
  status: v.optional(v.string()),
  live: v.optional(v.boolean()),
  accountId: v.optional(v.string()),
  stillUrl: v.optional(v.string()),
  stillTinyUrl: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
});
type Candidate = Infer<typeof vCandidate>;

/**
 * What the save dialog shows, with no writes: which ad ids the row can mean,
 * and the picked ad's own numbers over the range (the same numbers `save`
 * stores). A refusal comes back as `refusal` so the dialog never breaks.
 */
export const preview = authenticatedQuery({
  args: {
    campaignName: v.string(),
    /** The Ads table row's name. Used to find the ad when the row has no ids. */
    adName: v.string(),
    /** Every Meta id the row covers (several ads can share a name). */
    adIds: v.optional(v.array(v.string())),
    /** The id she picked; optional when the row covers exactly one ad. */
    adId: v.optional(v.string()),
    start: v.string(),
    end: v.string(),
  },
  returns: v.object({
    refusal: v.optional(v.string()),
    candidates: v.array(vCandidate),
    adId: v.optional(v.string()),
    stats: vStats,
    /** Why this ad cannot be saved for this range, when it cannot. */
    problem: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      await gate(ctx, args.campaignName);
      checkRange(args.start, args.end);
    } catch (e) {
      const err = asConvexError(e);
      return {
        refusal:
          err instanceof ConvexError
            ? String(err.data)
            : "You cannot save ads in this campaign.",
        candidates: [],
      };
    }

    const ids = [...new Set(args.adIds ?? [])]
      .filter(id => AD_ID.test(id))
      .slice(0, 20);
    const candidates: Candidate[] = [];
    const nodes = new Map<string, Tree | null>();
    if (ids.length > 0) {
      for (const id of ids) {
        // Only this campaign's node: the scope check above covered this
        // campaign, not whatever campaign an id sent from the browser is in.
        const node = await treeAd(ctx, id, args.campaignName);
        nodes.set(id, node?.campaignName === args.campaignName ? node : null);
      }
    } else {
      for (const n of await adsNamed(ctx, args.campaignName, args.adName)) {
        if (!nodes.has(n.metaId)) nodes.set(n.metaId, n);
      }
    }
    const keyOf = (id: string, n: Tree | null) =>
      n && !n.stillUrl
        ? (n.stillKey ?? stillKeyFor(n.creativeId, id))
        : undefined;
    const keys = [...nodes.entries()]
      .map(([id, n]) => keyOf(id, n))
      .filter((k): k is string => Boolean(k));
    const stills = keys.length ? await lookupStills(ctx.db, keys) : new Map();
    for (const [id, n] of nodes) {
      const key = keyOf(id, n);
      const still = key ? stills.get(key) : undefined;
      const saved = still?.status === "saved" ? still : undefined;
      const status = n ? (n.effectiveStatus ?? n.status) : undefined;
      candidates.push(
        strip({
          adId: id,
          name: n?.name ?? args.adName,
          status,
          live: n ? adIsLive(status) : undefined,
          accountId: bareAccount(n?.accountId),
          stillUrl: n?.stillUrl ?? saved?.url,
          stillTinyUrl: n?.stillUrl ? n.stillTinyUrl : saved?.tinyUrl,
          thumbUrl: metaImageUsable(n?.thumbUrl) ? n?.thumbUrl : undefined,
        }),
      );
    }

    const picked =
      args.adId && candidates.some(c => c.adId === args.adId)
        ? args.adId
        : candidates.length === 1
          ? candidates[0].adId
          : undefined;
    if (!picked) {
      return {
        candidates,
        problem:
          candidates.length === 0
            ? "We do not have this ad's Meta id yet. Try again after the next refresh."
            : undefined,
      };
    }

    const node = nodes.get(picked) ?? null;
    const { stats, rowsWithId } = await numbersFor(ctx, {
      campaignName: args.campaignName,
      adId: picked,
      adName: args.adName,
      start: args.start,
      end: args.end,
      node,
    });
    const belongs = node?.campaignName === args.campaignName || rowsWithId > 0;
    return {
      candidates,
      adId: picked,
      stats,
      problem: !belongs
        ? "That ad is not in this campaign."
        : stats.leads === 0
          ? `This ad had no leads between ${args.start} and ${args.end}, so there is no cost per lead to save.`
          : undefined,
    };
  },
});

/** Copy fields a save fills in on an existing row only when they are missing. */
const FILL_IF_MISSING = [
  "campaignName",
  "creativeId",
  "accountId",
  "stillKey",
  "stillUrl",
  "stillTinyUrl",
  "headline",
  "body",
  "cta",
  "adsetName",
] as const;

export const save = authenticatedMutation({
  args: {
    campaignName: v.string(),
    adId: v.string(),
    adName: v.string(),
    start: v.string(),
    end: v.string(),
    rangeLabel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    adId: v.string(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    try {
      return await saveWinner(ctx, args);
    } catch (e) {
      throw asConvexError(e);
    }
  },
});

async function saveWinner(
  ctx: MutationCtx,
  args: {
    campaignName: string;
    adId: string;
    adName: string;
    start: string;
    end: string;
    rangeLabel?: string;
    note?: string;
  },
): Promise<{ ok: true; adId: string; created: boolean }> {
  // 1. Who and what.
  const { campaignName, adId, start, end } = args;
  await gate(ctx, campaignName);
  checkAdId(adId);
  checkRange(start, end);
  const adName = args.adName.trim().slice(0, 300);
  if (!adName) refuse("That ad has no name.");
  const note = (args.note ?? "").trim().slice(0, NOTE_MAX) || undefined;
  const label = (args.rangeLabel ?? "").trim().slice(0, 60) || undefined;
  const { email, name } = await saver(ctx);

  // 2. The ad's own numbers, worked out here.
  const node = await treeAd(ctx, adId, campaignName);
  const { stats, rowsWithId, adSetName } = await numbersFor(ctx, {
    campaignName,
    adId,
    adName,
    start,
    end,
    node,
  });
  if (!(node?.campaignName === campaignName || rowsWithId > 0)) {
    refuse("That ad is not in this campaign.");
  }
  if (stats.leads === 0 || stats.cpl === undefined) {
    refuse(
      `This ad had no leads between ${start} and ${end}, so there is no cost per lead to save.`,
    );
  }

  // 3. Context: the campaign card, the tree node, the collected play.
  const campaign = (
    await ctx.db.query("campaigns").withIndex("by_rank").collect()
  ).find(c => c.campaignName === campaignName);
  const play = node?.adsetId
    ? await ctx.db
        .query("marketPlays")
        .withIndex("by_adset", q => q.eq("adsetId", node.adsetId as string))
        .first()
    : null;
  const creative = play?.creatives?.find(c => c.adId === adId);
  const adsetNode = node?.adsetId
    ? (
        await ctx.db
          .query("metaTree")
          .withIndex("by_meta", q => q.eq("metaId", node.adsetId as string))
          .take(5)
      ).find(n => n.kind === "adset")
    : undefined;

  // 4. The row this ad already has, if any.
  const rows = await ctx.db
    .query("winnersArchive")
    .withIndex("by_ad", q => q.eq("adId", adId))
    .collect();
  const existing = primaryRow(rows);

  const now = Date.now();
  const creativeId = node?.creativeId ?? creative?.creativeId;
  const accountId =
    bareAccount(node?.accountId) ??
    bareAccount(play?.accountId) ??
    bareAccount(campaign?.metaAccountId);
  const stillKey =
    existing?.stillKey ??
    node?.stillKey ??
    creative?.stillKey ??
    stillKeyFor(creativeId, adId);
  const picture = existing?.stillUrl
    ? {}
    : await pictureFor(ctx, stillKey, node);
  const savedRange = strip({ start, end, label });
  // A save counts only while it is newer than the last removal, so a save
  // made in the same millisecond as a removal must still land after it.
  const savedAt = Math.max(now, (existing?.unsavedAt ?? 0) + 1);
  const saveFields = {
    savedBy: email,
    savedByName: name,
    savedAt,
    savedNote: note,
    savedRange,
    savedStats: stats,
  };

  let created = false;
  let finalRow: Partial<Doc<"winnersArchive">>;
  if (existing) {
    // A double click, or the same save sent twice: nothing new to record.
    if (
      isSaved(existing) &&
      existing.savedBy === email &&
      now - (existing.savedAt ?? 0) < 60_000 &&
      existing.savedNote === note &&
      JSON.stringify(existing.savedRange ?? null) === JSON.stringify(savedRange)
    ) {
      return { ok: true, adId, created: false };
    }
    // 5. Mark it. The collector's numbers, origin and labels stay as they are.
    const fill: Record<string, unknown> = {
      campaignName,
      creativeId,
      accountId,
      stillKey,
      stillUrl: picture.stillUrl,
      stillTinyUrl: picture.stillUrl ? picture.stillTinyUrl : undefined,
      headline: creative?.headline,
      body: creative?.body,
      cta: creative?.cta,
      adsetName: play?.adsetName ?? adsetNode?.name ?? adSetName,
    };
    const patch: Record<string, unknown> = { ...saveFields };
    for (const f of FILL_IF_MISSING) {
      if (
        existing[f] === undefined &&
        fill[f] !== undefined &&
        fill[f] !== ""
      ) {
        patch[f] = fill[f];
      }
    }
    // A row only a person ever picked has no collector numbers: its main
    // numbers are the save's, so a new save replaces them too.
    if (!isAuto(existing)) {
      patch.spend = stats.spend;
      patch.leads = stats.leads;
      patch.cpl = stats.cpl;
      patch.wonFrom = start;
      patch.wonTo = end;
    }
    await ctx.db.patch(existing._id, patch);
    finalRow = { ...existing, ...patch };
  } else {
    // 6. A new row, marked as the team's pick.
    const client =
      play?.client ??
      campaign?.clientName ??
      campaign?.accountName ??
      campaignName;
    const status = node ? (node.effectiveStatus ?? node.status) : undefined;
    const thumbUrl = [node?.thumbUrl, creative?.thumbUrl].find(u =>
      metaImageUsable(u),
    );
    const doc = strip({
      adId,
      adName,
      client,
      serviceLine:
        play?.serviceLine ??
        classifyServiceLine(client, campaign?.serviceType ?? ""),
      city: play?.city ?? campaign?.advertisingCities?.[0] ?? "Unknown",
      country: play?.country,
      language: play?.language,
      format: creative?.format ?? "unknown",
      cta: creative?.cta,
      headline: creative?.headline,
      body: creative?.body,
      transcript: creative?.transcript,
      hook: creative?.hook,
      voice: creative?.voice,
      playType: play?.playType,
      interests: play?.interests,
      copyTraits: play?.copyTraits,
      adsetName: play?.adsetName ?? adsetNode?.name ?? adSetName,
      campaignName,
      creativeId,
      accountId,
      stillKey,
      stillUrl: picture.stillUrl,
      stillTinyUrl: picture.stillUrl ? picture.stillTinyUrl : undefined,
      thumbUrl,
      spend: stats.spend,
      leads: stats.leads,
      cpl: stats.cpl as number,
      stillLive: node ? adIsLive(status) : undefined,
      wonFrom: start,
      wonTo: end,
      firstArchivedAt: now,
      lastSeenAt: now,
      origin: "manual" as const,
      ...saveFields,
    });
    // The check above and this insert are one transaction, so two clicks
    // cannot make two rows.
    await ctx.db.insert("winnersArchive", doc);
    created = true;
    finalRow = doc;
  }

  // 7. Logged where the team sees cockpit work: the campaign thread.
  const numbers = `${label ?? `${start} to ${end}`}: ${usd(stats.spend)} spent, ${plural(stats.leads, "lead")}, ${usd(stats.cpl)} a lead`;
  await ctx.db.insert("campaignChat", {
    campaignId: campaignName,
    campaignName,
    client: campaign?.clientTag,
    author: "her",
    authorName: name,
    text: `Saved ${adName} to What works (${numbers}).${note ? ` Why: ${note}` : ""}`,
    pending: false,
    status: "done",
    kind: "action",
    ok: true,
    at: now,
  });
  await ctx.db.insert("usage", {
    email,
    role: "media_buyer",
    event: "winner.save",
    detail: adId,
    at: now,
  });

  // 8. Fill in what Meta can still tell us, after this write.
  if (
    !finalRow.format ||
    finalRow.format === "unknown" ||
    (!finalRow.headline && !finalRow.body) ||
    !finalRow.stillUrl
  ) {
    await ctx.scheduler.runAfter(0, internal.winnerSaves.enrich, { adId });
  }
  return { ok: true, adId, created };
}

/** "Remove from What works": the save is withdrawn, the row is kept. */
export const unsave = authenticatedMutation({
  args: { adId: v.string() },
  returns: v.object({ ok: v.literal(true), changed: v.boolean() }),
  handler: async (ctx, { adId }) => {
    try {
      await assertRole(ctx, "media_buyer");
      checkAdId(adId);
      const rows = await ctx.db
        .query("winnersArchive")
        .withIndex("by_ad", q => q.eq("adId", adId))
        .collect();
      const active = rows.filter(isSaved);
      const row = active[0] ?? primaryRow(rows);
      if (!row) return { ok: true as const, changed: false };
      await assertScope(
        ctx,
        row.campaignName
          ? { campaignName: row.campaignName }
          : { clientName: row.client },
      );
      if (active.length === 0) return { ok: true as const, changed: false };

      const { email, name } = await saver(ctx);
      const now = Date.now();
      for (const r of active) {
        // Never earlier than the save it withdraws, or the save would still count.
        await ctx.db.patch(r._id, {
          unsavedBy: email,
          unsavedAt: Math.max(now, r.savedAt ?? 0),
        });
      }
      if (row.campaignName) {
        const campaign = (
          await ctx.db.query("campaigns").withIndex("by_rank").collect()
        ).find(c => c.campaignName === row.campaignName);
        await ctx.db.insert("campaignChat", {
          campaignId: row.campaignName,
          campaignName: row.campaignName,
          client: campaign?.clientTag,
          author: "her",
          authorName: name,
          text: `Removed ${row.adName} from the team's saved winners.`,
          pending: false,
          status: "done",
          kind: "action",
          ok: true,
          at: now,
        });
      }
      await ctx.db.insert("usage", {
        email,
        role: "media_buyer",
        event: "winner.unsave",
        detail: adId,
        at: now,
      });
      return { ok: true as const, changed: true };
    } catch (e) {
      throw asConvexError(e);
    }
  },
});

/**
 * Which of these ads are in What works, for the buttons in one Ads table.
 * One read per id; ids with no row, or only a withdrawn save, are left out.
 */
export const savedIn = authenticatedQuery({
  args: { adIds: v.array(v.string()) },
  returns: v.record(
    v.string(),
    v.object({
      saved: v.boolean(),
      savedBy: v.optional(v.string()),
      savedByName: v.optional(v.string()),
      savedAt: v.optional(v.number()),
      auto: v.boolean(),
    }),
  ),
  handler: async (ctx, { adIds }) => {
    await assertRole(ctx, "media_buyer");
    const ids = [...new Set(adIds)].filter(id => AD_ID.test(id)).slice(0, 300);
    const found = await Promise.all(
      ids.map(async id => ({
        id,
        rows: await ctx.db
          .query("winnersArchive")
          .withIndex("by_ad", q => q.eq("adId", id))
          .take(5),
      })),
    );
    const out: Record<
      string,
      {
        saved: boolean;
        savedBy?: string;
        savedByName?: string;
        savedAt?: number;
        auto: boolean;
      }
    > = {};
    for (const { id, rows } of found) {
      if (rows.length === 0) continue;
      const saved = rows
        .filter(isSaved)
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
      const auto = rows.some(isAuto);
      if (!saved && !auto) continue;
      out[id] = strip({
        saved: Boolean(saved),
        savedBy: saved?.savedBy,
        savedByName: saved?.savedByName,
        savedAt: saved?.savedAt,
        auto,
      });
    }
    return out;
  },
});

const vDetails = v.object({
  creativeId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  format: v.optional(v.string()),
  cta: v.optional(v.string()),
  headline: v.optional(v.string()),
  body: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
});

/**
 * After a save: fill in the copy and the saved picture from Meta, for rows
 * saved before the weekly check ever read the ad. A deleted ad keeps what the
 * save captured.
 */
export const enrich = internalAction({
  args: { adId: v.string() },
  returns: v.null(),
  handler: async (ctx, { adId }) => {
    let details: Infer<typeof vDetails> | undefined;
    let gone = false;
    try {
      const d: {
        ok: boolean;
        reason?: string;
        creativeId?: string;
        accountId?: string;
        format?: string;
        cta?: string;
        headline?: string;
        body?: string;
        thumbUrl?: string;
      } = await ctx.runAction(internal.previews.adDetails, { adId });
      gone = d.reason === "gone";
      if (d.ok) {
        details = strip({
          creativeId: d.creativeId,
          accountId: bareAccount(d.accountId),
          format: d.format,
          cta: d.cta,
          headline: d.headline,
          body: d.body,
          thumbUrl: d.thumbUrl,
        });
      }
    } catch (e) {
      console.warn(
        `winner enrich: ad details failed (${String(e).slice(0, 120)})`,
      );
    }
    const row = await ctx.runMutation(internal.winnerSaves.fill, {
      adId,
      details,
    });
    if (gone || !row || !row.needsStill) return null;
    try {
      const still = await ctx.runAction(internal.previews.ensureStill, {
        adId,
        ...strip({
          creativeId: row.creativeId,
          accountId: row.accountId,
          campaignName: row.campaignName,
        }),
        keep: true,
      });
      if (still.status === "saved" && still.url) {
        await ctx.runMutation(internal.winnerSaves.fill, {
          adId,
          still: strip({
            key: still.key,
            url: still.url,
            tinyUrl: still.tinyUrl,
          }),
        });
      }
    } catch (e) {
      console.warn(
        `winner enrich: saving the picture failed (${String(e).slice(0, 120)})`,
      );
    }
    return null;
  },
});

/** Fills only what a winner row is missing. Returns what the picture step needs. */
export const fill = internalMutation({
  args: {
    adId: v.string(),
    details: v.optional(vDetails),
    still: v.optional(
      v.object({
        key: v.optional(v.string()),
        url: v.string(),
        tinyUrl: v.optional(v.string()),
      }),
    ),
  },
  returns: v.union(
    v.null(),
    v.object({
      needsStill: v.boolean(),
      creativeId: v.optional(v.string()),
      accountId: v.optional(v.string()),
      campaignName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { adId, details, still }) => {
    const rows = await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", q => q.eq("adId", adId))
      .collect();
    if (rows.length === 0) return null;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      if (details) {
        if ((!r.format || r.format === "unknown") && details.format) {
          if (details.format !== "unknown") patch.format = details.format;
        }
        for (const f of ["cta", "headline", "body"] as const) {
          if (!r[f] && details[f]) patch[f] = details[f];
        }
        if (!r.creativeId && details.creativeId) {
          patch.creativeId = details.creativeId;
        }
        if (!r.accountId && details.accountId) {
          patch.accountId = details.accountId;
        }
        if (
          details.thumbUrl &&
          metaImageUsable(details.thumbUrl) &&
          !metaImageUsable(r.thumbUrl)
        ) {
          patch.thumbUrl = details.thumbUrl;
        }
        if (!r.stillKey && !r.stillUrl) {
          const key = stillKeyFor(details.creativeId ?? r.creativeId, adId);
          if (key) patch.stillKey = key;
        }
      }
      if (still && !r.stillUrl) {
        patch.stillUrl = still.url;
        if (still.tinyUrl) patch.stillTinyUrl = still.tinyUrl;
        if (still.key) patch.stillKey = still.key;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(r._id, patch);
    }
    const fresh = primaryRow(
      await ctx.db
        .query("winnersArchive")
        .withIndex("by_ad", q => q.eq("adId", adId))
        .collect(),
    );
    if (!fresh) return null;
    return strip({
      needsStill: !fresh.stillUrl,
      creativeId: fresh.creativeId,
      accountId: fresh.accountId,
      campaignName: fresh.campaignName,
    });
  },
});
