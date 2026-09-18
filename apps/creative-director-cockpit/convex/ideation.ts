import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { hasAccess } from "./roles";

/**
 * The Ideation tab's backend: Supabase is the home (Aziz, 2026-09-17).
 *
 * Every row lives in the Creative Triage project's `ideation_posts` table,
 * written by the ideation radar on the VPS (scans and captures) and by the
 * functions below (what the creative director pastes, keeps, dismisses and
 * notes). Row security is on and the table has no policies, so only this
 * deployment's service key and the radar's can touch it. The key never
 * reaches the browser: these are actions, and the page calls them.
 *
 * Status of a row: proposed (found by the scan) -> queued (kept or pasted)
 * -> fetching (the radar took it) -> saved (transcript and breakdown in) |
 * failed (with the reason); dismissed at any point.
 */
declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TABLE = "ideation_posts";
const BUCKET = "ideation-stills";
const SIGN_SECONDS = 6 * 3600;
const PAGE_MAX = 200;
const NOTE_MAX = 500;
const LINK_RE =
  /^https?:\/\/(www\.|m\.|vm\.|vt\.|t\.)?(instagram\.com|instagr\.am|tiktok\.com|snapchat\.com)\/\S+$/i;

const TABS: Record<string, string[]> = {
  saved: ["saved"],
  proposed: ["proposed"],
  trends: ["proposed", "queued", "fetching", "saved"],
  working: ["queued", "fetching"],
  failed: ["failed"],
  dismissed: ["dismissed"],
};

/** The list columns; the long fields come with `detail`. */
const LIGHT = [
  "key",
  "platform",
  "post_id",
  "url",
  "origin",
  "status",
  "at",
  "created_at",
  "author_handle",
  "author_name",
  "author_followers",
  "posted_at",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "caption",
  "duration_sec",
  "thumb_url",
  "industry",
  "tags",
  "multiplier",
  "tier",
  "engagement_rate",
  "reach_rate",
  "packaging_only",
  "provisional",
  "checkpoint",
  "baseline_views",
  "baseline_n",
  "baseline_floored",
  "scanned_at",
  "captured_at",
  "language",
  "dialect",
  "voice",
  "format",
  "hook",
  "why_it_works",
  "cta",
  "saved_by",
  "saved_by_name",
  "saved_at",
  "saved_note",
  "pasted_by",
  "pasted_by_name",
  "note",
  "error",
  "attempts",
  "still_path",
  "warnings",
  "format_label",
  "hook_kind",
  "topic",
  "trend_id",
  "trend_label",
  "trend_n",
  "ad_id",
  "advertiser",
  "ad_started_at",
  "ad_last_seen_at",
  "running_days",
  "ad_platforms",
  "ad_format",
  "ad_active",
  "client",
  "spend",
  "leads",
  "cpl",
].join(",");

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

function ready(): void {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error(
      "Ideation is not connected yet: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.",
    );
}

async function rest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    prefer?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ headers: Headers; json: Row[] | Row | null }> {
  ready();
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
      ...(init.headers ?? {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return { headers: res.headers, json: text ? JSON.parse(text) : null };
}

function enc(key: string): string {
  return encodeURIComponent(key);
}

async function one(key: string, select = "*"): Promise<Row | null> {
  const { json } = await rest(
    `${TABLE}?select=${select}&key=eq.${enc(key)}&limit=1`,
  );
  return Array.isArray(json) && json.length ? json[0] : null;
}

async function patch(key: string, body: Row): Promise<void> {
  await rest(`${TABLE}?key=eq.${enc(key)}`, {
    method: "PATCH",
    body,
    prefer: "return=minimal",
  });
}

/** Signed links for the stored stills, six hours, in one call. */
async function signStills(rows: Row[]): Promise<Row[]> {
  const paths = [
    ...new Set(
      rows
        .map(r => r.still_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0),
    ),
  ];
  if (!paths.length) return rows;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths }),
      },
    );
    if (!res.ok) return rows;
    const signed = (await res.json()) as {
      path?: string;
      signedURL?: string;
      error?: string | null;
    }[];
    const map = new Map<string, string>();
    for (const s of signed)
      if (s.path && s.signedURL && !s.error)
        map.set(s.path, `${SUPABASE_URL}/storage/v1${s.signedURL}`);
    return rows.map(r =>
      r.still_path && map.get(r.still_path)
        ? { ...r, still_url: map.get(r.still_path) }
        : r,
    );
  } catch {
    return rows;
  }
}

function clip(x: unknown, max: number): string | undefined {
  if (x === null || x === undefined) return undefined;
  const s = String(x).trim();
  return s ? s.slice(0, max) : undefined;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// The gate: an action has no ctx.db, so the seat check runs in a query.

export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({ ok: v.boolean(), email: v.string(), name: v.string() }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "")
      .trim()
      .toLowerCase();
    const ok = await hasAccess(ctx, email);
    let name = String(user?.name ?? "");
    if (!name && email) {
      const member = await ctx.db
        .query("portalMembers")
        .withIndex("by_email", q => q.eq("email", email))
        .unique();
      name = member?.name ?? email.split("@")[0];
    }
    return { ok, email, name };
  },
});

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

// ---------------------------------------------------------------------------
// Reading

async function fetchList(args: {
  tab?: string;
  platform?: string;
  industry?: string;
  q?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(PAGE_MAX, args.limit ?? 100));
  const statuses = TABS[args.tab ?? "saved"] ?? TABS.saved;
  const params = new URLSearchParams();
  params.set("select", LIGHT);
  params.set("status", `in.(${statuses.map(s => `"${s}"`).join(",")})`);
  if (args.tab === "trends") {
    // The same format on several accounts inside two weeks (radar/trends.py).
    params.set("trend_id", "not.is.null");
    params.set("order", "trend_n.desc,trend_label.asc,at.desc");
  } else {
    params.set("order", "at.desc");
  }
  params.set("limit", String(limit));
  if (args.platform)
    params.set("platform", `eq.${args.platform.toLowerCase()}`);
  if (args.industry)
    params.set("industry", `eq.${args.industry.toLowerCase()}`);
  const q = (args.q ?? "").replace(/[,()"'*\\%]/g, " ").trim();
  if (q.length >= 2) {
    const pat = `*${q}*`;
    params.set(
      "or",
      `(caption.ilike.${pat},author_handle.ilike.${pat},why_it_works.ilike.${pat},note.ilike.${pat},saved_note.ilike.${pat},transcript.ilike.${pat})`,
    );
  }
  const { json } = await rest(`${TABLE}?${params.toString()}`);
  const rows = Array.isArray(json) ? json : [];
  return { rows: await signStills(rows), capped: rows.length >= limit };
}

export const list = authenticatedAction({
  args: {
    tab: v.optional(v.string()),
    platform: v.optional(v.string()),
    industry: v.optional(v.string()),
    q: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await who(ctx);
    return await fetchList(args);
  },
});

export const detail = authenticatedAction({
  args: { key: v.string() },
  returns: v.any(),
  handler: async (ctx, { key }) => {
    await who(ctx);
    const row = await one(key);
    if (!row) return null;
    return (await signStills([row]))[0];
  },
});

/** Exact per-tab counts from the database, six cheap HEAD requests. */
export const counts = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await who(ctx);
    ready();
    const out: Record<string, number> = {};
    for (const [tab, statuses] of Object.entries(TABS)) {
      const params = new URLSearchParams();
      params.set("select", "key");
      params.set("status", `in.(${statuses.map(s => `"${s}"`).join(",")})`);
      if (tab === "trends") params.set("trend_id", "not.is.null");
      params.set("limit", "1");
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?${params.toString()}`,
        {
          method: "HEAD",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "count=exact",
          },
        },
      );
      const range = res.headers.get("content-range") ?? "";
      const total = Number(range.split("/")[1]);
      out[tab] = Number.isFinite(total) ? total : 0;
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Writing

/** He pastes a link: queued for the radar to fetch and read. */
export const paste = authenticatedAction({
  args: {
    url: v.string(),
    note: v.optional(v.string()),
    industry: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email, name } = await who(ctx);
    const url = args.url.trim();
    if (!LINK_RE.test(url))
      throw new Error("Paste an Instagram, TikTok or Snapchat post link.");
    const host = url.toLowerCase();
    const platform = host.includes("tiktok")
      ? "tiktok"
      : host.includes("snapchat")
        ? "snapchat"
        : "instagram";
    const key = `pasted:${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    const stamp = now();
    const note = clip(args.note, NOTE_MAX) ?? null;
    await rest(TABLE, {
      method: "POST",
      prefer: "return=minimal",
      body: {
        key,
        platform,
        url,
        origin: "manual",
        status: "queued",
        at: stamp,
        created_at: stamp,
        updated_at: stamp,
        industry: args.industry === "ours" ? "ours" : "other",
        tags: (args.tags ?? [])
          .map(t => t.trim())
          .filter(Boolean)
          .slice(0, 40),
        note,
        saved_note: note,
        pasted_by: email,
        pasted_by_name: name,
        pasted_at: stamp,
        saved_by: email,
        saved_by_name: name,
        saved_at: stamp,
        attempts: 0,
      },
    });
    return { key };
  },
});

/** Keep a proposal: it is queued so the radar captures the transcript. */
export const keep = authenticatedAction({
  args: { key: v.string(), note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { key, note }) => {
    const { email, name } = await who(ctx);
    const row = await one(
      key,
      "key,status,captured_at,saved_by,saved_by_name,saved_at,saved_note,note,attempts",
    );
    if (!row) throw new Error("That idea is gone.");
    const stamp = now();
    const n = clip(note, NOTE_MAX);
    const already = row.status === "saved" || Boolean(row.captured_at);
    await patch(key, {
      status: already ? "saved" : "queued",
      saved_by: row.saved_by ?? email,
      saved_by_name: row.saved_by_name ?? name,
      saved_at: row.saved_at ?? stamp,
      saved_note: n ?? row.saved_note ?? null,
      note: n ?? row.note ?? null,
      error: null,
      attempts: already ? row.attempts : 0,
      at: stamp,
      updated_at: stamp,
    });
    return { status: already ? "saved" : "queued" };
  },
});

export const dismiss = authenticatedAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const { email } = await who(ctx);
    const stamp = now();
    await patch(key, {
      status: "dismissed",
      dismissed_by: email,
      dismissed_at: stamp,
      at: stamp,
      updated_at: stamp,
    });
    return null;
  },
});

/** Back from dismissed: a capture returns to saved, a scan find to proposed, a paste is fetched again. */
export const restore = authenticatedAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await who(ctx);
    const row = await one(key, "key,origin,captured_at,saved_at");
    if (!row) return null;
    const stamp = now();
    await patch(key, {
      status: row.captured_at
        ? "saved"
        : row.origin === "scan" && !row.saved_at
          ? "proposed"
          : "queued",
      dismissed_by: null,
      dismissed_at: null,
      attempts: 0,
      at: stamp,
      updated_at: stamp,
    });
    return null;
  },
});

export const retry = authenticatedAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await who(ctx);
    const stamp = now();
    await patch(key, {
      status: "queued",
      error: null,
      attempts: 0,
      at: stamp,
      updated_at: stamp,
    });
    return null;
  },
});

export const setNote = authenticatedAction({
  args: { key: v.string(), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, note }) => {
    await who(ctx);
    const n = clip(note, NOTE_MAX) ?? null;
    await patch(key, { note: n, saved_note: n, updated_at: now() });
    return null;
  },
});

// ---------------------------------------------------------------------------
// The watchlist and the scrapes (Aziz, 2026-09-18: "add our people to the
// watchlist", "put a link to any social media", "manually run a scrape of
// the Facebook Ads Library and all of that"). The radar on the VPS reads the
// watchlist every Saturday and the requests every two minutes.

const WATCH_PLATFORMS = ["instagram", "tiktok", "snapchat"];
const WATCH_KINDS = ["account", "hashtag", "search"];
const SCRAPE_KINDS = ["profile", "ads"];
const AD_LIBRARIES = ["meta", "google"];

function cleanHandle(value: string, kind: string): string {
  const v = value.trim();
  if (kind === "search") return v.replace(/\s+/g, " ").slice(0, 80);
  return v
    .replace(/^[@#]+/, "")
    .replace(/\/+$/, "")
    .split(/[/?\s]/)[0]
    .toLowerCase()
    .slice(0, 80);
}

export const watchlistList = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await who(ctx);
    const { json } = await rest(
      "ideation_watchlist?select=key,platform,kind,value,industry,tags,note,source,added_by,last_scanned_at,last_status,baseline_views,baseline_n,followers,added_at&active=eq.true&order=platform.asc,kind.asc,value.asc&limit=500",
    );
    return Array.isArray(json) ? json : [];
  },
});

export const watchlistAdd = authenticatedAction({
  args: {
    platform: v.string(),
    kind: v.string(),
    value: v.string(),
    industry: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email, name } = await who(ctx);
    const platform = args.platform.toLowerCase();
    const kind = args.kind.toLowerCase();
    if (!WATCH_KINDS.includes(kind))
      throw new Error("Pick account, hashtag or keyword search.");
    if (!WATCH_PLATFORMS.includes(platform))
      throw new Error(
        "The weekly scan watches Instagram, TikTok and Snapchat. For a YouTube or Facebook page use Scrape.",
      );
    if (kind === "search" && platform !== "instagram")
      throw new Error("Keyword search is Instagram only for now.");
    const value = cleanHandle(args.value, kind);
    if (!value) throw new Error("Type a handle, a hashtag or a keyword.");
    const key = `${platform}:${kind}:${value.toLowerCase()}`;
    const stamp = now();
    await rest("ideation_watchlist?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          key,
          platform,
          kind,
          value,
          industry: args.industry === "ours" ? "ours" : "other",
          tags: ["via:cockpit"],
          active: true,
          note:
            clip(args.note, NOTE_MAX) ??
            `added from the cockpit by ${name || email} on ${stamp.slice(0, 10)}`,
          source: "cockpit",
          added_by: email,
          updated_at: stamp,
        },
      ],
    });
    return { key };
  },
});

export const watchlistRemove = authenticatedAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await who(ctx);
    await rest(`ideation_watchlist?key=eq.${enc(key)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { active: false, updated_at: now() },
    });
    return null;
  },
});

/** Ask the radar to scrape a page (its best videos and its current ads) or an ad library. */
export const requestScrape = authenticatedAction({
  args: {
    kind: v.string(),
    input: v.string(),
    platform: v.optional(v.string()),
    country: v.optional(v.string()),
    industry: v.optional(v.string()),
    client: v.optional(v.string()),
    watch: v.optional(v.boolean()),
    ads: v.optional(v.boolean()),
    minDays: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email, name } = await who(ctx);
    const kind = args.kind.toLowerCase();
    if (!SCRAPE_KINDS.includes(kind))
      throw new Error("Pick a page scrape or an ad library pull.");
    const input = args.input.trim().slice(0, 300);
    if (!input)
      throw new Error(
        "Paste a page link, or type a page name, advertiser or keyword.",
      );
    const platform = (args.platform ?? "").toLowerCase();
    if (kind === "ads" && !AD_LIBRARIES.includes(platform))
      throw new Error(
        "Pick the Meta Ad Library or Google Ads. TikTok and Snapchat publish no public ad library outside Europe.",
      );
    if (
      kind === "profile" &&
      !/^https?:\/\//i.test(input) &&
      !platform &&
      !/^(instagram|tiktok|youtube|facebook|snapchat):/i.test(input)
    )
      throw new Error(
        "For a bare handle, pick the platform too, or paste the page link.",
      );
    const id = `req_${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    const stamp = now();
    const params: Record<string, unknown> = {
      platform: platform || undefined,
      country:
        (args.country ?? "").trim().toUpperCase().slice(0, 2) || undefined,
      industry: args.industry === "ours" ? "ours" : "other",
      client: clip(args.client, 120),
      watch: args.watch ?? true,
      ads: args.ads ?? true,
      min_days:
        typeof args.minDays === "number" && args.minDays >= 0
          ? Math.floor(args.minDays)
          : undefined,
    };
    for (const k of Object.keys(params))
      if (params[k] === undefined) delete params[k];
    await rest("ideation_requests", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        id,
        kind,
        platform: platform || null,
        input,
        params,
        status: "queued",
        requested_by: email,
        requested_by_name: name,
        created_at: stamp,
        updated_at: stamp,
        attempts: 0,
      },
    });
    return { id };
  },
});

export const requestsList = authenticatedAction({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    await who(ctx);
    const n = Math.max(1, Math.min(50, limit ?? 15));
    const { json } = await rest(
      `ideation_requests?select=id,kind,platform,input,params,status,requested_by_name,created_at,started_at,finished_at,attempts,result,error&order=created_at.desc&limit=${n}`,
    );
    return Array.isArray(json) ? json : [];
  },
});

// ---------------------------------------------------------------------------
// "Save to Ideation" from the scripting database and a client's ads (Aziz,
// 2026-09-18). Our own ads carry their script already, so they land as saved
// ideas, industry ours, tagged with the client.

export const winnerRow = internalQuery({
  args: { adId: v.string() },
  returns: v.any(),
  handler: async (ctx, { adId }) => {
    const rows = await ctx.db
      .query("winnersArchive")
      .withIndex("by_ad", q => q.eq("adId", adId))
      .take(5);
    return rows.find(r => r.savedAt && !r.unsavedAt) ?? rows[0] ?? null;
  },
});

function clientSlug(client: string): string {
  return (
    client
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "client"
  );
}

async function upsertOurs(row: Row): Promise<void> {
  await rest(`${TABLE}?on_conflict=key`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: [row],
  });
}

export const saveFromWinner = authenticatedAction({
  args: { adId: v.string(), note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { adId, note }) => {
    const { email, name } = await who(ctx);
    // biome-ignore lint/suspicious/noExplicitAny: winnersArchive row
    const w = (await ctx.runQuery(internal.ideation.winnerRow, {
      adId,
    })) as any;
    if (!w)
      throw new Error("That ad is not in the scripting database any more.");
    const key = `meta_ads:${adId}`;
    const existing = await one(
      key,
      "key,status,saved_at,saved_by,saved_by_name,note,saved_note,tags",
    );
    const stamp = now();
    const client = String(w.client ?? "");
    const caption = [w.headline, w.body]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3000);
    const n = clip(note, NOTE_MAX);
    const body: Row = {
      key,
      platform: "meta_ads",
      post_id: adId,
      url: w.previewSrc
        ? String(w.previewSrc)
        : `https://www.facebook.com/ads/library/?id=${adId}`,
      origin: "library",
      status:
        existing?.status === "dismissed"
          ? "saved"
          : (existing?.status ?? "saved"),
      at: stamp,
      updated_at: stamp,
      author_handle: clientSlug(client),
      author_name: client,
      advertiser: client,
      client,
      caption,
      transcript: String(w.transcript ?? ""),
      hook: w.hook ? { text: String(w.hook), type: "" } : null,
      voice: w.voice ?? null,
      language:
        w.language === "Arabic"
          ? "ar"
          : w.language === "English"
            ? "en"
            : w.language
              ? "mixed"
              : null,
      cta: w.cta ?? null,
      ad_format: w.format ?? null,
      ad_started_at: w.wonFrom ? new Date(w.wonFrom).toISOString() : null,
      ad_active: w.stillLive ?? null,
      thumb_url: w.stillUrl ?? w.thumbUrl ?? null,
      industry: "ours",
      tags: [
        ...new Set(
          [
            ...(existing?.tags ?? []),
            "ours",
            "winner",
            `client:${clientSlug(client)}`,
            w.serviceLine ? `service:${String(w.serviceLine)}` : "",
          ].filter(Boolean),
        ),
      ],
      spend: typeof w.spend === "number" ? w.spend : null,
      leads: typeof w.leads === "number" ? w.leads : null,
      cpl: typeof w.cpl === "number" ? w.cpl : null,
      why_it_works: w.savedNote ? String(w.savedNote) : "",
      saved_by: existing?.saved_by ?? email,
      saved_by_name: existing?.saved_by_name ?? name,
      saved_at: existing?.saved_at ?? stamp,
      saved_note: n ?? existing?.saved_note ?? null,
      note: n ?? existing?.note ?? null,
      captured_at: w.transcript ? stamp : null,
      method: w.transcript
        ? {
            transcribe: "winners archive",
            on_screen: "none",
            breakdown: "none",
          }
        : {},
    };
    if (!existing) body.created_at = stamp;
    await upsertOurs(body);
    return { key, status: body.status };
  },
});

export const saveFromClientAd = authenticatedAction({
  args: {
    metaAdId: v.string(),
    client: v.string(),
    name: v.optional(v.string()),
    campaignName: v.optional(v.string()),
    thumbUrl: v.optional(v.string()),
    spend: v.optional(v.number()),
    leads: v.optional(v.number()),
    cpl: v.optional(v.number()),
    live: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email, name } = await who(ctx);
    // The scripting database may hold this ad with its script: prefer that copy.
    // biome-ignore lint/suspicious/noExplicitAny: winnersArchive row
    const w = (await ctx.runQuery(internal.ideation.winnerRow, {
      adId: args.metaAdId,
    })) as any;
    if (w) {
      // biome-ignore lint/suspicious/noExplicitAny: action handle
      return await (ctx as any).runAction(api.ideation.saveFromWinner, {
        adId: args.metaAdId,
      });
    }
    const key = `meta_ads:${args.metaAdId}`;
    const existing = await one(
      key,
      "key,status,saved_at,saved_by,saved_by_name,note,saved_note,tags",
    );
    const stamp = now();
    const client = args.client.trim();
    const body: Row = {
      key,
      platform: "meta_ads",
      post_id: args.metaAdId,
      url: `https://www.facebook.com/ads/library/?id=${args.metaAdId}`,
      origin: "library",
      status:
        existing?.status === "dismissed"
          ? "saved"
          : (existing?.status ?? "saved"),
      at: stamp,
      updated_at: stamp,
      author_handle: clientSlug(client),
      author_name: client,
      advertiser: client,
      client,
      caption: [args.name, args.campaignName]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500),
      thumb_url: args.thumbUrl ?? null,
      ad_active: args.live ?? null,
      industry: "ours",
      tags: [
        ...new Set([
          ...(existing?.tags ?? []),
          "ours",
          `client:${clientSlug(client)}`,
        ]),
      ],
      spend: typeof args.spend === "number" ? args.spend : null,
      leads: typeof args.leads === "number" ? args.leads : null,
      cpl: typeof args.cpl === "number" ? args.cpl : null,
      saved_by: existing?.saved_by ?? email,
      saved_by_name: existing?.saved_by_name ?? name,
      saved_at: existing?.saved_at ?? stamp,
      warnings: [
        "Saved from the client's ads: no script on file yet. The scripting database fills it in when the weekly check transcribes this ad.",
      ],
    };
    if (!existing) body.created_at = stamp;
    await upsertOurs(body);
    return { key, status: body.status };
  },
});

/**
 * The smoke check's view, no sign-in: the two lists the page opens on, plus
 * the radar's liveness. A throw here becomes a Slack DM with the fix and a
 * fix job, like any other failing screen (RUNBOOK, "Ideation radar").
 */
export const smokeCheck = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY)
      return {
        skipped: true,
        note: "Ideation is not connected on this deployment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).",
      };
    const saved = await fetchList({ tab: "saved", limit: 20 });
    const proposed = await fetchList({ tab: "proposed", limit: 20 });
    const problems: string[] = [];
    const { json: scans } = await rest(
      "ideation_scans?select=at&dry_run=is.false&order=at.desc&limit=1",
    );
    const lastAt =
      Array.isArray(scans) && scans[0]?.at
        ? Date.parse(String(scans[0].at))
        : Number.NaN;
    if (Number.isFinite(lastAt) && Date.now() - lastAt > 8 * 24 * 3600_000) {
      problems.push(
        `The ideation radar has not scanned since ${new Date(lastAt).toISOString().slice(0, 10)}. Fix: on the VPS as the cron user, run "python3 radar.py doctor" and check "crontab -l" (RUNBOOK, Ideation radar).`,
      );
    }
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    const { json: waiting } = await rest(
      `${TABLE}?select=key&status=in.("queued","fetching")&at=lt.${encodeURIComponent(cutoff)}&limit=50`,
    );
    const n = Array.isArray(waiting) ? waiting.length : 0;
    if (n > 0) {
      problems.push(
        `${n} pasted link${n === 1 ? " has" : "s have"} waited over an hour for the radar: its pending cron is not running or its keys broke. Fix: "python3 radar.py doctor" on the VPS (RUNBOOK, Ideation radar).`,
      );
    }
    if (problems.length) throw new Error(problems.join(" "));
    return {
      saved: saved.rows.length,
      proposed: proposed.rows.length,
      lastScan: Number.isFinite(lastAt) ? new Date(lastAt).toISOString() : null,
    };
  },
});
