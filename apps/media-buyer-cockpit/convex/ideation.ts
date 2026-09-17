import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { accessFor } from "./roles";

/**
 * The Ideation board, mirrored from the creative director cockpit (Aziz,
 * 2026-09-17: "this board can also go to the media buyer"). Same Supabase
 * home, same functions; only the seat check differs.
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
  params.set("order", "at.desc");
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

/** Exact per-tab counts from the database, five cheap HEAD requests. */
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

/** The smoke check's view: the two lists the page opens on, no sign-in. */
export const smokeCheck = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY)
      return {
        skipped: true,
        note: "Ideation is not connected on this deployment.",
      };
    const saved = await fetchList({ tab: "saved", limit: 20 });
    const proposed = await fetchList({ tab: "proposed", limit: 20 });
    return { saved: saved.rows.length, proposed: proposed.rows.length };
  },
});
