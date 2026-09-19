import { IDEA_STILLS_BUCKET, supabase } from "./supabase";

/**
 * The ideation board's verbs, for a cockpit with no backend.
 *
 * The creative director's and the media buyer's Ideation page calls Convex
 * actions that hold the Supabase service key. This cockpit has no Convex:
 * it is the browser talking to PostgREST with the editor's own session. So
 * the same functions are implemented here against the same tables, with the
 * same names, arguments and return shapes -- which is what lets the page
 * itself be the same file in all three (Aziz, 2026-09-19: "it should be the
 * exact same ideation section for all 3").
 *
 * What the service key did by bypassing row security, an editor's session
 * does through policies: `supabase/migrations/20260919c_ideation_for_editors.sql`
 * grants exactly these verbs to `is_editor()` and nothing else. There is no
 * delete anywhere, here or there -- dismissing and unwatching are both a
 * status change, so nothing in a browser can drop a row.
 *
 * Status of a row: proposed (found by the scan) -> queued (kept or pasted)
 * -> fetching (the radar took it) -> saved (transcript and breakdown in) |
 * failed (with the reason); dismissed at any point.
 */
const TABLE = "ideation_posts";
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

const WATCH_PLATFORMS = ["instagram", "tiktok", "snapchat"];
const WATCH_KINDS = ["account", "hashtag", "search"];
const SCRAPE_KINDS = ["profile", "ads"];
const AD_LIBRARIES = ["meta", "google"];

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

function now(): string {
  return new Date().toISOString();
}

function clip(x: unknown, max: number): string | undefined {
  if (x === null || x === undefined) return undefined;
  const s = String(x).trim();
  return s ? s.slice(0, max) : undefined;
}

/** A short unique suffix, the same shape the other two cockpits write. */
function stamp36(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

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

/**
 * Turn a PostgREST failure into a sentence.
 *
 * The two ways a missing seat shows up are "permission denied for table X"
 * and a row-security violation, and neither is a sentence anybody can act
 * on. Both mean the same thing and both say it here. Everything else is
 * passed through rather than flattened, because a fault reported as a
 * permission is how a day got lost on the editor sign-in.
 */
export function boom(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const why = error.message ?? "";
  if (
    error.code === "42501" ||
    /permission denied/i.test(why) ||
    /row-level security/i.test(why)
  )
    throw new Error(
      "This board is not yours. Ask Aziz for a seat in the portal.",
    );
  throw new Error(why || "That did not go through.");
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
    const { data } = await supabase.storage
      .from(IDEA_STILLS_BUCKET)
      .createSignedUrls(paths, SIGN_SECONDS);
    const map = new Map<string, string>();
    for (const s of data ?? [])
      if (s.path && s.signedUrl && !s.error) map.set(s.path, s.signedUrl);
    return rows.map(r =>
      r.still_path && map.get(r.still_path)
        ? { ...r, still_url: map.get(r.still_path) }
        : r,
    );
  } catch {
    return rows;
  }
}

async function one(key: string, select = "*"): Promise<Row | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(select)
    .eq("key", key)
    .maybeSingle();
  boom(error);
  return (data as Row) ?? null;
}

async function patch(key: string, body: Row): Promise<void> {
  const { error } = await supabase.from(TABLE).update(body).eq("key", key);
  boom(error);
}

// ---------------------------------------------------------------------------
// Who is doing this. The page calls the verbs without passing an identity,
// exactly as it does over Convex, so the verbs ask the session themselves.
//
// Read at the moment of writing rather than stashed when the page rendered:
// a stashed copy can be stale, can be empty if a verb runs before the render
// that set it, and writing it during render is a side effect React is
// allowed to throw away. getSession() is local -- it reads the stored token,
// not the network -- so this costs nothing.

export async function who(): Promise<{ email: string; name: string }> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  const email = user?.email ?? "";
  const meta = user?.user_metadata as
    | { name?: string; full_name?: string }
    | undefined;
  return {
    email,
    name: meta?.name || meta?.full_name || email.split("@")[0] || "",
  };
}

// ---------------------------------------------------------------------------

async function list(args: {
  tab?: string;
  platform?: string;
  industry?: string;
  q?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(PAGE_MAX, args.limit ?? 100));
  const statuses = TABS[args.tab ?? "saved"] ?? TABS.saved;
  let query = supabase.from(TABLE).select(LIGHT).in("status", statuses);
  if (args.tab === "trends") {
    // The same format on several accounts inside two weeks (radar/trends.py).
    query = query
      .not("trend_id", "is", null)
      .order("trend_n", { ascending: false })
      .order("trend_label", { ascending: true })
      .order("at", { ascending: false });
  } else {
    query = query.order("at", { ascending: false });
  }
  if (args.platform) query = query.eq("platform", args.platform.toLowerCase());
  if (args.industry) query = query.eq("industry", args.industry.toLowerCase());
  const q = (args.q ?? "").replace(/[,()"'*\\%]/g, " ").trim();
  if (q.length >= 2) {
    const pat = `*${q}*`;
    query = query.or(
      `caption.ilike.${pat},author_handle.ilike.${pat},why_it_works.ilike.${pat},note.ilike.${pat},saved_note.ilike.${pat},transcript.ilike.${pat}`,
    );
  }
  const { data, error } = await query.limit(limit);
  boom(error);
  const rows = (data as Row[]) ?? [];
  return { rows: await signStills(rows), capped: rows.length >= limit };
}

async function detail({ key }: { key: string }) {
  const row = await one(key);
  if (!row) return null;
  return (await signStills([row]))[0];
}

/**
 * Exact per-tab counts from the database, six cheap head requests.
 *
 * A failure is raised rather than counted as zero. Six tabs all reading
 * "0" because the request was refused looks exactly like an empty board,
 * and a board that lies about being empty is worse than one that says it
 * could not be read.
 */
async function counts(
  _args: Record<string, never> = {},
): Promise<Record<string, number>> {
  const pairs = await Promise.all(
    Object.entries(TABS).map(async ([tab, statuses]) => {
      let query = supabase
        .from(TABLE)
        .select("key", { count: "exact", head: true })
        .in("status", statuses);
      if (tab === "trends") query = query.not("trend_id", "is", null);
      const { count, error } = await query;
      boom(error);
      return [tab, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

/** A link is pasted: queued for the radar to fetch and read. */
async function paste(args: {
  url: string;
  note?: string;
  industry?: string;
  tags?: string[];
}) {
  const { email, name } = await who();
  const url = args.url.trim();
  if (!LINK_RE.test(url))
    throw new Error("Paste an Instagram, TikTok or Snapchat post link.");
  const host = url.toLowerCase();
  const platform = host.includes("tiktok")
    ? "tiktok"
    : host.includes("snapchat")
      ? "snapchat"
      : "instagram";
  const key = `pasted:${stamp36()}`;
  const at = now();
  const note = clip(args.note, NOTE_MAX) ?? null;
  const { error } = await supabase.from(TABLE).insert({
    key,
    platform,
    url,
    origin: "manual",
    status: "queued",
    at,
    created_at: at,
    updated_at: at,
    industry: args.industry === "ours" ? "ours" : "other",
    tags: (args.tags ?? [])
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 40),
    note,
    saved_note: note,
    pasted_by: email,
    pasted_by_name: name,
    pasted_at: at,
    saved_by: email,
    saved_by_name: name,
    saved_at: at,
    attempts: 0,
  });
  boom(error);
  return { key };
}

/** Keep a proposal: it is queued so the radar captures the transcript. */
async function keep({ key, note }: { key: string; note?: string }) {
  const { email, name } = await who();
  const row = await one(
    key,
    "key,status,captured_at,saved_by,saved_by_name,saved_at,saved_note,note,attempts",
  );
  if (!row) throw new Error("That idea is gone.");
  const at = now();
  const n = clip(note, NOTE_MAX);
  const already = row.status === "saved" || Boolean(row.captured_at);
  await patch(key, {
    status: already ? "saved" : "queued",
    saved_by: row.saved_by ?? email,
    saved_by_name: row.saved_by_name ?? name,
    saved_at: row.saved_at ?? at,
    saved_note: n ?? row.saved_note ?? null,
    note: n ?? row.note ?? null,
    error: null,
    attempts: already ? row.attempts : 0,
    at,
    updated_at: at,
  });
  return { status: already ? "saved" : "queued" };
}

async function dismiss({ key }: { key: string }) {
  const { email } = await who();
  const at = now();
  await patch(key, {
    status: "dismissed",
    dismissed_by: email,
    dismissed_at: at,
    at,
    updated_at: at,
  });
  return null;
}

/** Back from dismissed: a capture returns to saved, a scan find to proposed, a paste is fetched again. */
async function restore({ key }: { key: string }) {
  const row = await one(key, "key,origin,captured_at,saved_at");
  if (!row) return null;
  const at = now();
  await patch(key, {
    status: row.captured_at
      ? "saved"
      : row.origin === "scan" && !row.saved_at
        ? "proposed"
        : "queued",
    dismissed_by: null,
    dismissed_at: null,
    attempts: 0,
    at,
    updated_at: at,
  });
  return null;
}

async function retry({ key }: { key: string }) {
  const at = now();
  await patch(key, {
    status: "queued",
    error: null,
    attempts: 0,
    at,
    updated_at: at,
  });
  return null;
}

async function setNote({ key, note }: { key: string; note: string }) {
  const n = clip(note, NOTE_MAX) ?? null;
  await patch(key, { note: n, saved_note: n, updated_at: now() });
  return null;
}

// ---------------------------------------------------------------------------
// The watchlist and the scrapes. The radar on the VPS reads the watchlist
// every Saturday and the requests every two minutes; nothing here runs a
// scrape itself, it only asks.

async function watchlistList(_args: Record<string, never> = {}) {
  const { data, error } = await supabase
    .from("ideation_watchlist")
    .select(
      "key,platform,kind,value,industry,tags,note,source,added_by,last_scanned_at,last_status,baseline_views,baseline_n,followers,added_at",
    )
    .eq("active", true)
    .order("platform", { ascending: true })
    .order("kind", { ascending: true })
    .order("value", { ascending: true })
    .limit(500);
  boom(error);
  return data ?? [];
}

async function watchlistAdd(args: {
  platform: string;
  kind: string;
  value: string;
  industry?: string;
  note?: string;
}) {
  const { email, name } = await who();
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
  const at = now();
  const { error } = await supabase.from("ideation_watchlist").upsert(
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
        `added from the cockpit by ${name || email} on ${at.slice(0, 10)}`,
      source: "cockpit",
      added_by: email,
      updated_at: at,
    },
    { onConflict: "key" },
  );
  boom(error);
  return { key };
}

async function watchlistRemove({ key }: { key: string }) {
  const { error } = await supabase
    .from("ideation_watchlist")
    .update({ active: false, updated_at: now() })
    .eq("key", key);
  boom(error);
  return null;
}

/** Ask the radar to scrape a page (its best videos and its current ads) or an ad library. */
async function requestScrape(args: {
  kind: string;
  input: string;
  platform?: string;
  country?: string;
  industry?: string;
  client?: string;
  watch?: boolean;
  ads?: boolean;
  minDays?: number;
}) {
  const { email, name } = await who();
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
  const id = `req_${stamp36()}`;
  const at = now();
  const params: Record<string, unknown> = {
    platform: platform || undefined,
    country: (args.country ?? "").trim().toUpperCase().slice(0, 2) || undefined,
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
  const { error } = await supabase.from("ideation_requests").insert({
    id,
    kind,
    platform: platform || null,
    input,
    params,
    status: "queued",
    requested_by: email,
    requested_by_name: name,
    created_at: at,
    updated_at: at,
    attempts: 0,
  });
  boom(error);
  return { id };
}

async function requestsList({ limit }: { limit?: number } = {}) {
  const n = Math.max(1, Math.min(50, limit ?? 15));
  const { data, error } = await supabase
    .from("ideation_requests")
    .select(
      "id,kind,platform,input,params,status,requested_by_name,created_at,started_at,finished_at,attempts,result,error",
    )
    .order("created_at", { ascending: false })
    .limit(n);
  boom(error);
  return data ?? [];
}

/**
 * The same shape the page imports from Convex in the other two cockpits, so
 * the page file itself does not have to know which one it is running in.
 */
export const api = {
  ideation: {
    list,
    detail,
    counts,
    paste,
    keep,
    dismiss,
    restore,
    retry,
    setNote,
    watchlistList,
    watchlistAdd,
    watchlistRemove,
    requestScrape,
    requestsList,
  },
};

/**
 * Convex's hook, minus Convex. It returns the function unchanged -- the
 * references above are module constants, so they are stable across renders
 * and safe in the dependency arrays the page already has. It does nothing
 * else on purpose: the verbs read the session themselves, so there is no
 * order in which the page can call them wrongly.
 */
export function useAction<T>(fn: T): T {
  return fn;
}
