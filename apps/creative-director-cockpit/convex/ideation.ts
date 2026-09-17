import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertRole, userEmail } from "./roles";

/**
 * The ideation tab's backend.
 *
 * Two doors write here. The signed-in creative director pastes links, saves
 * or dismisses proposals and adds notes (the authenticated functions below).
 * The ideation radar, a scheduled script on the VPS (hermes/ideation-radar),
 * comes in through `POST /ideation` with its own bearer token, pushes the
 * scan's proposals and the captured breakdowns, and pulls the links waiting
 * to be fetched. That door is separate from `/bridge` on purpose: its token
 * can touch this one table and nothing else.
 *
 * Status of a row: proposed (found by the scan) -> queued (he saved it, or he
 * pasted it) -> fetching (the radar took it) -> saved (transcript and
 * breakdown in) | failed (with the reason) ; dismissed at any point.
 *
 * Every read goes through an index with a bounded take: this table is his
 * growing library, and the 2026-09-16 usage overage came from collecting
 * growing tables in reactive queries.
 */
declare const process: { env: Record<string, string | undefined> };

export const IDEATION_TOKEN = process.env.IDEATION_TOKEN ?? "";

const PLATFORMS = new Set(["instagram", "tiktok", "snapchat"]);
const KEY_RE = /^(instagram|tiktok|snapchat):[A-Za-z0-9_.-]{1,120}$/;
const LINK_RE =
  /^https?:\/\/(www\.|m\.|vm\.|vt\.|t\.)?(instagram\.com|instagr\.am|tiktok\.com|snapchat\.com)\/\S+$/i;
/** A fetch older than this is handed out again. */
const FETCH_TTL_MS = 30 * 60_000;
const MAX_ATTEMPTS = 4;
const PAGE_MAX = 200;
const COUNT_CAP = 500;
const NOTE_MAX = 500;

// biome-ignore lint/suspicious/noExplicitAny: radar payloads are validated field by field
type Raw = Record<string, any>;
type Row = Doc<"ideationPosts">;

// ---------------------------------------------------------------------------
// Field mapping from the radar's snake_case JSON

function str(x: unknown, max: number): string | undefined {
  if (x === null || x === undefined) return undefined;
  const s = String(x).trim();
  return s ? s.slice(0, max) : undefined;
}

function num(x: unknown): number | undefined {
  if (x === null || x === undefined || x === "") return undefined;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function strs(x: unknown, max = 40): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x
    .map(s => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, max)
    .map(s => s.slice(0, 300));
}

/** The post and scan fields a proposal or an idea both carry. */
function postFields(raw: Raw): Partial<Row> {
  const platform = str(raw.platform, 20)?.toLowerCase();
  return {
    ...(platform && PLATFORMS.has(platform) ? { platform } : {}),
    postId: str(raw.post_id ?? raw.postId, 120),
    url: str(raw.url, 2000),
    authorHandle: str(raw.author_handle ?? raw.authorHandle, 80)?.toLowerCase(),
    authorName: str(raw.author_name ?? raw.authorName, 120),
    authorFollowers: num(raw.author_followers ?? raw.authorFollowers),
    postedAt: str(raw.posted_at ?? raw.postedAt, 40),
    views: num(raw.views),
    likes: num(raw.likes),
    comments: num(raw.comments),
    shares: num(raw.shares),
    saves: num(raw.saves),
    caption: str(raw.caption, 3000),
    durationSec: num(raw.duration_sec ?? raw.durationSec),
    thumbUrl: str(raw.thumb_url ?? raw.thumbUrl, 2000),
    mediaUrl: str(raw.media_url ?? raw.mediaUrl, 2000),
    industry: str(raw.industry, 20),
    tags: strs(raw.tags),
  };
}

function scanFields(raw: Raw): Partial<Row> {
  return {
    targetKey: str(raw.target_key ?? raw.targetKey, 160),
    baselineViews: num(raw.baseline_views ?? raw.baselineViews),
    baselineN: num(raw.baseline_n ?? raw.baselineN),
    multiplier: num(raw.multiplier),
    tier: str(raw.tier, 30),
    engagementRate: num(raw.engagement_rate ?? raw.engagementRate),
    packagingOnly:
      typeof raw.packaging_only === "boolean"
        ? raw.packaging_only
        : typeof raw.packagingOnly === "boolean"
          ? raw.packagingOnly
          : undefined,
    scannedAt: str(raw.scanned_at ?? raw.scannedAt, 40),
  };
}

function captureFields(raw: Raw): Partial<Row> {
  const hook = raw.hook && typeof raw.hook === "object" ? raw.hook : undefined;
  return {
    capturedAt: str(raw.captured_at ?? raw.capturedAt, 40),
    language: str(raw.language, 10),
    dialect: str(raw.dialect, 60),
    hasSpeech: typeof raw.has_speech === "boolean" ? raw.has_speech : undefined,
    voice: str(raw.voice, 30),
    transcript: str(raw.transcript, 12000) ?? "",
    onScreenText: Array.isArray(raw.on_screen_text)
      ? raw.on_screen_text.slice(0, 200)
      : [],
    format: str(raw.format, 30),
    hook: hook
      ? {
          text: str(hook.text, 400) ?? "",
          type: str(hook.type, 60) ?? "",
          endsAtSec: num(hook.ends_at_sec ?? hook.endsAtSec) ?? null,
        }
      : undefined,
    beats: Array.isArray(raw.beats) ? raw.beats.slice(0, 12) : [],
    cta: str(raw.cta, 300),
    whyItWorks: str(raw.why_it_works ?? raw.whyItWorks, 2000),
    transferable: str(raw.transferable, 2000),
    adaptations: strs(raw.adaptations, 8),
    music: str(raw.music, 300),
    method:
      raw.method && typeof raw.method === "object" ? raw.method : undefined,
    confidence:
      raw.confidence && typeof raw.confidence === "object"
        ? raw.confidence
        : undefined,
    warnings: strs(raw.warnings, 20),
    multiplier: num(raw.multiplier),
    tier: str(raw.tier, 30),
  };
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, x]) => x !== undefined),
  ) as T;
}

async function byKey(ctx: QueryCtx | MutationCtx, key: string) {
  return await ctx.db
    .query("ideationPosts")
    .withIndex("by_key", q => q.eq("key", key))
    .unique();
}

// ---------------------------------------------------------------------------
// The radar's door: POST /ideation {fn, args}

// biome-ignore lint/suspicious/noExplicitAny: payloads are validated by the mutations
export async function runIdeation(
  ctx: ActionCtx,
  fn: string,
  args: Record<string, any>,
): Promise<unknown> {
  switch (fn) {
    case "storeIdeationCandidates":
      return await ctx.runMutation(internal.ideation.storeCandidates, {
        rows: args.rows ?? [],
      });
    case "storeIdeationIdeas":
      return await ctx.runMutation(internal.ideation.storeIdeas, {
        rows: args.rows ?? [],
      });
    case "ideationPending":
      return await ctx.runMutation(internal.ideation.claimPending, {
        limit: Math.max(1, Math.min(25, Number(args.limit) || 10)),
      });
    case "ideationPing":
      return { ok: true, at: Date.now() };
    default:
      throw new Error("unknown ideation function");
  }
}

/**
 * Proposals from a scan. One row per post key; a row he already saved,
 * queued or dismissed keeps its status and only takes the fresh numbers.
 */
export const storeCandidates = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const raw of rows.slice(0, 40) as Raw[]) {
      const key = str(raw?.key, 160);
      if (!key || !KEY_RE.test(key)) {
        skipped += 1;
        continue;
      }
      const fields = clean({ ...postFields(raw), ...scanFields(raw) });
      if (!fields.platform || !fields.url) {
        skipped += 1;
        continue;
      }
      const prev = await byKey(ctx, key);
      if (prev) {
        // Numbers move; his decision does not.
        const patch: Partial<Row> =
          prev.status === "proposed"
            ? { ...fields, at: now }
            : {
                views: fields.views,
                likes: fields.likes,
                comments: fields.comments,
                shares: fields.shares,
                saves: fields.saves,
                multiplier: fields.multiplier,
                tier: fields.tier,
                baselineViews: fields.baselineViews,
                baselineN: fields.baselineN,
                scannedAt: fields.scannedAt,
              };
        await ctx.db.patch(prev._id, clean(patch));
        updated += 1;
      } else {
        await ctx.db.insert("ideationPosts", {
          key,
          platform: fields.platform,
          url: fields.url,
          origin: "scan",
          status: "proposed",
          at: now,
          createdAt: now,
          ...fields,
        });
        inserted += 1;
      }
    }
    return { inserted, updated, skipped };
  },
});

/**
 * Captured ideas and failures from the radar. A row carrying `cockpit_id`
 * is the link he pasted; the radar resolved its real key, so the pasted row
 * takes that key, or merges into a row that already had it.
 */
export const storeIdeas = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    let saved = 0;
    let failed = 0;
    let skipped = 0;
    for (const raw of rows.slice(0, 40) as Raw[]) {
      const key = str(raw?.key, 160);
      const cockpitId = str(raw?.cockpit_id ?? raw?.cockpitId, 60);
      let pasted: Row | null = null;
      if (cockpitId) {
        const id = ctx.db.normalizeId("ideationPosts", cockpitId);
        pasted = id ? await ctx.db.get(id) : null;
      }
      const keyed = key && KEY_RE.test(key) ? await byKey(ctx, key) : null;
      const target = keyed ?? pasted;
      if (!target && !(key && KEY_RE.test(key))) {
        skipped += 1;
        continue;
      }
      const isFailure =
        raw?.status === "failed" ||
        (!raw?.transcript && !raw?.hook && raw?.error);
      const base = clean({
        ...postFields(raw),
        ...(isFailure ? {} : captureFields(raw)),
      });
      const keptNote = target?.note ?? str(raw?.note, NOTE_MAX);
      const who =
        target?.savedBy ??
        target?.pastedBy ??
        str(raw?.saved_by ?? raw?.savedBy, 120);
      if (isFailure) {
        const attempts = (target?.attempts ?? 0) + 1;
        const patch = clean({
          ...base,
          status: "failed",
          error: str(raw?.error, 400) ?? "the radar could not fetch this post",
          warnings: strs(raw?.warnings, 20),
          attempts,
          at: now,
        });
        if (target) await ctx.db.patch(target._id, patch);
        failed += 1;
        if (pasted && keyed && pasted._id !== keyed._id)
          await ctx.db.delete(pasted._id);
        continue;
      }
      const patch = clean({
        ...base,
        key: key && KEY_RE.test(key) ? key : target?.key,
        status: "saved",
        error: undefined,
        at: now,
        savedBy: who,
        savedByName: target?.savedByName ?? target?.pastedByName,
        savedAt: target?.savedAt ?? now,
        note: keptNote,
        savedNote: target?.savedNote ?? keptNote,
        origin: target?.origin ?? (pasted ? "manual" : "manual"),
      });
      if (target) {
        await ctx.db.patch(target._id, patch);
        if (pasted && keyed && pasted._id !== keyed._id)
          await ctx.db.delete(pasted._id);
      } else {
        // biome-ignore lint/suspicious/noExplicitAny: the patch is validated field by field above
        const doc: any = {
          ...patch,
          key: key as string,
          platform: base.platform ?? "instagram",
          url: base.url ?? "",
          origin: "manual",
          status: "saved",
          at: now,
          createdAt: now,
        };
        await ctx.db.insert("ideationPosts", doc);
      }
      saved += 1;
    }
    return { saved, failed, skipped };
  },
});

/** Links waiting for the radar: queued rows, plus fetches that went stale. */
export const claimPending = internalMutation({
  args: { limit: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const queued = await ctx.db
      .query("ideationPosts")
      .withIndex("by_status_at", q => q.eq("status", "queued"))
      .order("asc")
      .take(limit);
    const stale = (
      await ctx.db
        .query("ideationPosts")
        .withIndex("by_status_at", q => q.eq("status", "fetching"))
        .order("asc")
        .take(50)
    ).filter(r => (r.fetchingAt ?? 0) < now - FETCH_TTL_MS);
    const out: Raw[] = [];
    for (const r of [...queued, ...stale].slice(0, limit)) {
      const attempts = (r.attempts ?? 0) + 1;
      if (attempts > MAX_ATTEMPTS) {
        await ctx.db.patch(r._id, {
          status: "failed",
          error: "The radar took this link four times and never answered.",
          attempts,
          at: now,
        });
        continue;
      }
      await ctx.db.patch(r._id, {
        status: "fetching",
        fetchingAt: now,
        attempts,
      });
      out.push({
        id: r._id,
        url: r.url,
        key: r.key,
        savedBy: r.savedBy ?? r.pastedBy ?? "",
        note: r.note ?? "",
        industry: r.industry ?? "other",
        tags: r.tags ?? [],
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// The person-facing side

const TABS: Record<string, string[]> = {
  saved: ["saved"],
  proposed: ["proposed"],
  working: ["queued", "fetching"],
  failed: ["failed"],
  dismissed: ["dismissed"],
};

/** The list rows without the long fields; `detail` loads one row in full. */
function light(r: Row) {
  const { transcript, onScreenText, beats, method, confidence, ...rest } = r;
  return {
    ...rest,
    transcriptChars: transcript?.length ?? 0,
    onScreenLines: Array.isArray(onScreenText) ? onScreenText.length : 0,
  };
}

export async function buildList(
  ctx: QueryCtx,
  args: {
    tab?: string;
    platform?: string;
    industry?: string;
    savedBy?: string;
    limit?: number;
  },
) {
  const limit = Math.max(1, Math.min(PAGE_MAX, args.limit ?? 100));
  const statuses = TABS[args.tab ?? "saved"] ?? TABS.saved;
  const rows: Row[] = [];
  for (const status of statuses) {
    rows.push(
      ...(await ctx.db
        .query("ideationPosts")
        .withIndex("by_status_at", q => q.eq("status", status))
        .order("desc")
        .take(limit)),
    );
  }
  const platform = args.platform?.toLowerCase();
  const industry = args.industry?.toLowerCase();
  const savedBy = args.savedBy?.toLowerCase();
  const filtered = rows
    .filter(r => !platform || r.platform === platform)
    .filter(r => !industry || (r.industry ?? "other") === industry)
    .filter(
      r =>
        !savedBy || (r.savedBy ?? r.pastedBy ?? "").toLowerCase() === savedBy,
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
  return { rows: filtered.map(light), capped: rows.length >= limit };
}

export const list = authenticatedQuery({
  args: {
    tab: v.optional(v.string()),
    platform: v.optional(v.string()),
    industry: v.optional(v.string()),
    savedBy: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    return await buildList(ctx, args);
  },
});

export const detail = authenticatedQuery({
  args: { id: v.id("ideationPosts") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "creative");
    return await ctx.db.get(id);
  },
});

/** Per-status counts, bounded: a tab past the cap reads "500+". */
export const counts = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "creative");
    const out: Record<string, number> = {};
    for (const [tab, statuses] of Object.entries(TABS)) {
      let n = 0;
      for (const status of statuses) {
        n += (
          await ctx.db
            .query("ideationPosts")
            .withIndex("by_status_at", q => q.eq("status", status))
            .take(COUNT_CAP)
        ).length;
      }
      out[tab] = n;
    }
    return { ...out, cap: COUNT_CAP };
  },
});

async function who(ctx: MutationCtx & { userId: Id<"users"> }) {
  const email = await userEmail(ctx);
  const user = await ctx.db.get(ctx.userId);
  const member = await ctx.db
    .query("portalMembers")
    .withIndex("by_email", q => q.eq("email", email))
    .unique();
  return { email, name: user?.name ?? member?.name ?? email.split("@")[0] };
}

/** He pastes a link: it is queued for the radar to fetch and transcribe. */
export const paste = authenticatedMutation({
  args: {
    url: v.string(),
    note: v.optional(v.string()),
    industry: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    const url = args.url.trim();
    if (!LINK_RE.test(url))
      throw new Error("Paste an Instagram, TikTok or Snapchat post link.");
    const { email, name } = await who(ctx);
    const now = Date.now();
    const host = url.toLowerCase();
    const platform = host.includes("tiktok")
      ? "tiktok"
      : host.includes("snapchat")
        ? "snapchat"
        : "instagram";
    const key = `pasted:${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const id = await ctx.db.insert("ideationPosts", {
      key,
      platform,
      url,
      origin: "manual",
      status: "queued",
      at: now,
      createdAt: now,
      industry: args.industry === "ours" ? "ours" : "other",
      tags: strs(args.tags) ?? [],
      note: str(args.note, NOTE_MAX),
      pastedBy: email,
      pastedByName: name,
      pastedAt: now,
      savedBy: email,
      savedByName: name,
      savedAt: now,
      savedNote: str(args.note, NOTE_MAX),
      attempts: 0,
    });
    return { id, key };
  },
});

/** Keep a proposal: it is queued so the radar captures the transcript. */
export const save = authenticatedMutation({
  args: { id: v.id("ideationPosts"), note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { id, note }) => {
    await assertRole(ctx, "creative");
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That idea is gone.");
    const { email, name } = await who(ctx);
    const now = Date.now();
    const n = str(note, NOTE_MAX);
    const already = row.status === "saved";
    await ctx.db.patch(
      id,
      clean({
        status: already ? "saved" : "queued",
        savedBy: row.savedBy ?? email,
        savedByName: row.savedByName ?? name,
        savedAt: row.savedAt ?? now,
        savedNote: n ?? row.savedNote,
        note: n ?? row.note,
        error: undefined,
        attempts: already ? row.attempts : 0,
        at: now,
      }),
    );
    return { status: already ? "saved" : "queued" };
  },
});

export const dismiss = authenticatedMutation({
  args: { id: v.id("ideationPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "creative");
    const { email } = await who(ctx);
    const now = Date.now();
    await ctx.db.patch(id, {
      status: "dismissed",
      dismissedBy: email,
      dismissedAt: now,
      at: now,
    });
    return null;
  },
});

/** Back from dismissed: a scan find returns to proposed, a paste is fetched again. */
export const restore = authenticatedMutation({
  args: { id: v.id("ideationPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "creative");
    const row = await ctx.db.get(id);
    if (!row) return null;
    const now = Date.now();
    const captured = Boolean(row.capturedAt);
    await ctx.db.patch(
      id,
      clean({
        status: captured
          ? "saved"
          : row.origin === "scan" && !row.savedAt
            ? "proposed"
            : "queued",
        dismissedBy: undefined,
        dismissedAt: undefined,
        attempts: 0,
        at: now,
      }),
    );
    return null;
  },
});

export const retry = authenticatedMutation({
  args: { id: v.id("ideationPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "creative");
    const now = Date.now();
    await ctx.db.patch(id, {
      status: "queued",
      error: undefined,
      attempts: 0,
      at: now,
    });
    return null;
  },
});

export const setNote = authenticatedMutation({
  args: { id: v.id("ideationPosts"), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, note }) => {
    await assertRole(ctx, "creative");
    const n = str(note, NOTE_MAX);
    await ctx.db.patch(id, { note: n, savedNote: n });
    return null;
  },
});
