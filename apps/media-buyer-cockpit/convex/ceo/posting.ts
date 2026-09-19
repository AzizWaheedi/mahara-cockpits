import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { graph, graphPost } from "../tools";

declare const process: { env: Record<string, string | undefined> };

/**
 * The posting desk: Mahara's own reels and videos, from a finished file to
 * a published post, with Aziz's approval in between.
 *
 * The worker on the VPS (`radar.py posts`) fetches the video, listens to it,
 * writes the copy in Aziz's voice, renders the thumbnail and the cover, and
 * uploads to YouTube. This side creates posts and jobs, lets him read and
 * change every word, and publishes the Instagram reel itself through the
 * Meta system token (the worker never holds that token). Nothing is
 * published before `approve`, and every publish leaves an audit row.
 *
 * Tables and the private `posting` bucket live in Creative Triage; the
 * browser never talks to Supabase directly, it gets short signed links.
 */

const IG = "17841473441237528";
const BUCKET = "posting";
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TARGETS = ["instagram", "youtube", "facebook", "tiktok", "linkedin", "x"];
/** Where the cockpit can publish today; the rest are carried but refused. */
const LIVE_TARGETS = ["instagram", "youtube"];

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows and Graph payloads are untyped here
type Any = Record<string, any>;

export type Post = {
  id: number;
  kind: "reel" | "video";
  titleWorking: string | null;
  sourceKind: string;
  sourceRef: string;
  videoPath: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  language: string | null;
  status: string;
  targets: string[];
  transcript: Any | null;
  chapters: { at_sec: number; title: string }[];
  ytTitle: string | null;
  ytTitleOptions: string[];
  ytDescription: string | null;
  ytTags: string[];
  igCaption: string | null;
  igHashtags: string[];
  thumbText: string | null;
  thumbTextOptions: string[];
  thumbFrameMs: number | null;
  thumbPath: string | null;
  coverPath: string | null;
  frames: { ms: number; path: string; sharpness?: number }[];
  method: Any;
  scheduledAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  published: Any;
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Short signed links, minted on read. */
  urls: {
    video?: string;
    thumb?: string;
    cover?: string;
    frames?: Record<string, string>;
  };
};

function ready(): void {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
}

async function sb(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Any> {
  ready();
  const res = await fetch(`${SUPABASE_URL}${path}`, {
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
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : [];
}

const rest = (path: string, init: Parameters<typeof sb>[1] = {}) =>
  sb(`/rest/v1/${path}`, init) as Promise<Any[]>;

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** A link Meta or the browser can fetch for a while; the bucket stays private. */
async function sign(path: string, expiresSec: number): Promise<string> {
  const out = await sb(`/storage/v1/object/sign/${BUCKET}/${enc(path)}`, {
    method: "POST",
    body: { expiresIn: expiresSec },
  });
  const signed = out?.signedURL ?? out?.signedUrl;
  if (!signed) throw new Error(`No signed link for ${path}`);
  return `${SUPABASE_URL}/storage/v1${signed}`;
}

async function signOrNull(
  path: string | null | undefined,
  expiresSec: number,
): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await sign(path, expiresSec);
  } catch {
    return undefined;
  }
}

function toPost(r: Any): Omit<Post, "urls"> {
  const strs = (x: unknown): string[] =>
    Array.isArray(x) ? x.map(String) : [];
  return {
    id: Number(r.id),
    kind: r.kind === "video" ? "video" : "reel",
    titleWorking: r.title_working ?? null,
    sourceKind: String(r.source_kind ?? ""),
    sourceRef: String(r.source_ref ?? ""),
    videoPath: r.video_path ?? null,
    durationSec:
      r.duration_sec === null || r.duration_sec === undefined
        ? null
        : Number(r.duration_sec),
    width: r.width ?? null,
    height: r.height ?? null,
    language: r.language ?? null,
    status: String(r.status ?? "new"),
    targets: strs(r.targets),
    transcript: r.transcript ?? null,
    chapters: Array.isArray(r.chapters) ? r.chapters : [],
    ytTitle: r.yt_title ?? null,
    ytTitleOptions: strs(r.yt_title_options),
    ytDescription: r.yt_description ?? null,
    ytTags: strs(r.yt_tags),
    igCaption: r.ig_caption ?? null,
    igHashtags: strs(r.ig_hashtags),
    thumbText: r.thumb_text ?? null,
    thumbTextOptions: strs(r.thumb_text_options),
    thumbFrameMs: r.thumb_frame_ms ?? null,
    thumbPath: r.thumb_path ?? null,
    coverPath: r.cover_path ?? null,
    frames: Array.isArray(r.frames) ? r.frames : [],
    method: r.method ?? {},
    scheduledAt: r.scheduled_at ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    published: r.published ?? {},
    error: r.error ?? null,
    createdBy: String(r.created_by ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

async function withUrls(r: Any, full: boolean): Promise<Post> {
  const p = toPost(r);
  const urls: Post["urls"] = {
    thumb: await signOrNull(p.thumbPath, 3600),
  };
  if (full) {
    urls.video = await signOrNull(p.videoPath, 2 * 3600);
    urls.cover = await signOrNull(p.coverPath, 3600);
    const frames: Record<string, string> = {};
    for (const f of p.frames) {
      const u = await signOrNull(f.path, 3600);
      if (u) frames[String(f.ms)] = u;
    }
    urls.frames = frames;
  }
  return { ...p, urls };
}

async function one(id: number): Promise<Any> {
  const [row] = await rest(`cockpit_posts?id=eq.${id}&select=*`);
  if (!row) throw new Error("That post is gone.");
  return row;
}

async function patch(id: number, body: Any): Promise<Any> {
  const rows = await rest(`cockpit_posts?id=eq.${id}`, {
    method: "PATCH",
    body,
    prefer: "return=representation",
  });
  if (!rows[0]) throw new Error("That post is gone.");
  return rows[0];
}

async function queue(
  kind: string,
  postId: number | null,
  params: Any = {},
): Promise<number> {
  const rows = await rest("cockpit_post_jobs", {
    method: "POST",
    body: { kind, post_id: postId, params },
    prefer: "return=representation",
  });
  return Number(rows[0]?.id ?? 0);
}

function allDone(targets: string[], published: Any): boolean {
  return targets.length > 0 && targets.every(t => Boolean(published?.[t]?.id));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const record = internalMutation({
  args: {
    action: v.string(),
    rowId: v.string(),
    what: v.string(),
    after: v.any(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: a.action,
      table: "cockpit_posts",
      rowId: a.rowId,
      what: a.what,
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

// biome-ignore lint/suspicious/noExplicitAny: action ctx
async function gate(ctx: any): Promise<string> {
  return (await ctx.runQuery(internal.ceo.b2bControl.gate, {
    userId: ctx.userId,
  })) as string;
}

export const channels = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await gate(ctx);
    const rows = await rest("cockpit_channels?select=*&order=platform.asc");
    return rows.map(r => ({
      platform: String(r.platform),
      handle: r.handle ?? null,
      externalId: r.external_id ?? null,
      connected: Boolean(r.connected),
      connectedAt: r.connected_at ?? null,
      authUrl: r.auth_url ?? null,
      note: r.note ?? null,
      checkedAt: r.checked_at ?? null,
      live: LIVE_TARGETS.includes(String(r.platform)),
    }));
  },
});

export const list = authenticatedAction({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }): Promise<Post[]> => {
    await gate(ctx);
    const rows = await rest(
      `cockpit_posts?select=*&status=neq.discarded&order=created_at.desc&limit=${Math.min(60, Math.max(1, limit ?? 30))}`,
    );
    const out: Post[] = [];
    for (const r of rows) out.push(await withUrls(r, false));
    return out;
  },
});

export const get = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Post> => {
    await gate(ctx);
    return withUrls(await one(id), true);
  },
});

/** A place in the bucket the browser may PUT one file into, once. */
export const uploadUrl = authenticatedAction({
  args: { filename: v.string() },
  returns: v.any(),
  handler: async (
    ctx,
    { filename },
  ): Promise<{ path: string; url: string }> => {
    await gate(ctx);
    const safe = filename.replace(/[^\w.-]+/g, "_").slice(-80) || "video.mp4";
    const path = `uploads/${Date.now().toString(36)}-${safe}`;
    const out = await sb(
      `/storage/v1/object/upload/sign/${BUCKET}/${enc(path)}`,
      { method: "POST" },
    );
    const url = out?.url;
    if (!url) throw new Error("Supabase gave no upload link.");
    return { path, url: `${SUPABASE_URL}/storage/v1${url}` };
  },
});

export const create = authenticatedAction({
  args: {
    kind: v.union(v.literal("reel"), v.literal("video")),
    sourceKind: v.union(
      v.literal("upload"),
      v.literal("drive"),
      v.literal("url"),
    ),
    sourceRef: v.string(),
    titleWorking: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<Post> => {
    const by = await gate(ctx);
    const ref = a.sourceRef.trim();
    if (!ref) throw new Error("Point at a file, a Drive link or a link first.");
    if (
      a.sourceKind !== "upload" &&
      !/^(https?:\/\/|[A-Za-z0-9_-]{20,}$)/.test(ref)
    )
      throw new Error("That does not look like a link.");
    const targets = (a.targets ?? ["instagram", "youtube"]).filter(t =>
      TARGETS.includes(t),
    );
    if (!targets.length) throw new Error("Pick at least one place to post.");
    const rows = await rest("cockpit_posts", {
      method: "POST",
      body: {
        kind: a.kind,
        title_working: a.titleWorking?.trim().slice(0, 200) || null,
        source_kind: a.sourceKind,
        source_ref: ref,
        targets,
        status: "new",
        created_by: by,
      },
      prefer: "return=representation",
    });
    const row = rows[0];
    await queue("prepare", Number(row.id));
    await ctx.runMutation(internal.ceo.posting.record, {
      action: "posting.create",
      rowId: String(row.id),
      what: `Queued ${a.kind} "${a.titleWorking?.trim() || ref.slice(0, 60)}" for ${targets.join(" and ")}`,
      after: { sourceKind: a.sourceKind, targets },
      by,
    });
    return withUrls(row, false);
  },
});

export const save = authenticatedAction({
  args: {
    id: v.number(),
    titleWorking: v.optional(v.string()),
    ytTitle: v.optional(v.string()),
    ytDescription: v.optional(v.string()),
    ytTags: v.optional(v.array(v.string())),
    igCaption: v.optional(v.string()),
    igHashtags: v.optional(v.array(v.string())),
    thumbText: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
    scheduledAt: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<Post> => {
    await gate(ctx);
    const row = await one(a.id);
    if (!["ready", "failed", "new"].includes(String(row.status)))
      throw new Error(`A ${row.status} post cannot be edited any more.`);
    const body: Any = {};
    if (a.titleWorking !== undefined)
      body.title_working = a.titleWorking.trim().slice(0, 200) || null;
    if (a.ytTitle !== undefined)
      body.yt_title = a.ytTitle.trim().slice(0, 100) || null;
    if (a.ytDescription !== undefined)
      body.yt_description = a.ytDescription.slice(0, 5000) || null;
    if (a.ytTags !== undefined)
      body.yt_tags = a.ytTags
        .map(t => t.replace(/^#/, "").trim().slice(0, 30))
        .filter(Boolean)
        .slice(0, 30);
    if (a.igCaption !== undefined)
      body.ig_caption = a.igCaption.slice(0, 2200) || null;
    if (a.igHashtags !== undefined)
      body.ig_hashtags = a.igHashtags
        .map(h => `#${h.replace(/^#/, "").replace(/[^\w؀-ۿ]/g, "")}`)
        .filter(h => h.length > 1)
        .slice(0, 30);
    if (a.thumbText !== undefined)
      body.thumb_text = a.thumbText.trim().slice(0, 60) || null;
    if (a.targets !== undefined) {
      const t = a.targets.filter(x => TARGETS.includes(x));
      if (!t.length) throw new Error("Pick at least one place to post.");
      body.targets = t;
    }
    if (a.scheduledAt !== undefined) body.scheduled_at = a.scheduledAt;
    return withUrls(
      Object.keys(body).length ? await patch(a.id, body) : row,
      true,
    );
  },
});

/** A new thumbnail and cover: another line, or another frame. */
export const rerender = authenticatedAction({
  args: {
    id: v.number(),
    thumbText: v.optional(v.string()),
    frameMs: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ jobId: number }> => {
    await gate(ctx);
    const row = await one(a.id);
    if (!["ready", "failed"].includes(String(row.status)))
      throw new Error(`A ${row.status} post is not being re-rendered.`);
    if (a.thumbText !== undefined)
      await patch(a.id, {
        thumb_text: a.thumbText.trim().slice(0, 60) || null,
      });
    const jobId = await queue("render", a.id, {
      ...(a.thumbText !== undefined
        ? { thumb_text: a.thumbText.trim().slice(0, 60) }
        : {}),
      ...(a.frameMs !== undefined ? { frame_ms: Math.round(a.frameMs) } : {}),
    });
    return { jobId };
  },
});

/** Run the whole preparation again (a failed fetch, a changed working title). */
export const reprepare = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<{ jobId: number }> => {
    await gate(ctx);
    const row = await one(id);
    if (["approved", "publishing", "published"].includes(String(row.status)))
      throw new Error(`A ${row.status} post is not prepared again.`);
    await patch(id, { status: "new", error: null });
    return { jobId: await queue("prepare", id) };
  },
});

export const discard = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Post> => {
    await gate(ctx);
    const row = await one(id);
    if (String(row.status) === "published")
      throw new Error("A published post stays on the list.");
    return withUrls(await patch(id, { status: "discarded" }), false);
  },
});

/**
 * Publish the reel on Instagram: a container from a signed link to the
 * video, wait for Meta to process it, publish, keep the permalink. If Meta
 * is still processing when this gives up, the container is kept and
 * `checkInstagram` finishes the job later.
 */
async function publishInstagram(
  row: Any,
  log: (m: string) => void,
): Promise<Any> {
  const id = Number(row.id);
  const targets: string[] = Array.isArray(row.targets)
    ? row.targets.map(String)
    : [];
  if (!targets.includes("instagram")) return row;
  const published: Any = { ...(row.published ?? {}) };
  if (published.instagram?.id) return row;
  let container: string = String(published.instagram?.container ?? "");
  if (!container) {
    if (!row.video_path) throw new Error("The video is not in the bucket yet.");
    const videoUrl = await sign(String(row.video_path), 48 * 3600);
    const coverUrl = await signOrNull(row.cover_path, 48 * 3600);
    const hashtags: string[] = Array.isArray(row.ig_hashtags)
      ? row.ig_hashtags
      : [];
    const caption = [String(row.ig_caption ?? "").trim(), hashtags.join(" ")]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 2200);
    const made: Any = await graphPost(`${IG}/media`, {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: "true",
      ...(coverUrl ? { cover_url: coverUrl } : {}),
    });
    container = String(made?.id ?? "");
    if (!container) throw new Error("Meta gave no container for the reel.");
    published.instagram = { container, at: new Date().toISOString() };
    row = await patch(id, { published, status: "publishing" });
    log(`container ${container}`);
  }
  // Meta transcodes for a minute or five; a reel is rarely longer.
  let status = "";
  for (let i = 0; i < 84; i++) {
    const s: Any = await graph(container, { fields: "status_code,status" });
    status = String(s?.status_code ?? "");
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED")
      throw new Error(
        `Meta could not take the reel: ${String(s?.status ?? status).slice(0, 200)}`,
      );
    await sleep(5000);
  }
  if (status !== "FINISHED") {
    log("still processing; will finish on check");
    return row;
  }
  const out: Any = await graphPost(`${IG}/media_publish`, {
    creation_id: container,
  });
  const mediaId = String(out?.id ?? "");
  if (!mediaId) throw new Error("Meta published nothing.");
  let permalink: string | null = null;
  try {
    const m: Any = await graph(mediaId, { fields: "permalink" });
    permalink = m?.permalink ?? null;
  } catch {
    permalink = null;
  }
  published.instagram = {
    id: mediaId,
    permalink,
    container,
    at: new Date().toISOString(),
  };
  const done = allDone(targets, published);
  return patch(id, {
    published,
    status: done ? "published" : "publishing",
    error: null,
  });
}

export const approve = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Post> => {
    const by = await gate(ctx);
    let row = await one(id);
    if (String(row.status) !== "ready")
      throw new Error(`A ${row.status} post cannot be approved.`);
    const targets: string[] = (row.targets ?? []).map(String);
    const notLive = targets.filter(t => !LIVE_TARGETS.includes(t));
    if (notLive.length)
      throw new Error(
        `${notLive.join(", ")} cannot be published from here yet; take them off the targets first.`,
      );
    if (targets.includes("youtube") && !row.yt_title)
      throw new Error("YouTube needs a title.");
    if (targets.includes("instagram") && !row.ig_caption)
      throw new Error("Instagram needs a caption.");
    row = await patch(id, {
      status: "approved",
      approved_by: by,
      approved_at: new Date().toISOString(),
      error: null,
    });
    await ctx.runMutation(internal.ceo.posting.record, {
      action: "posting.approve",
      rowId: String(id),
      what: `Approved "${row.yt_title ?? row.title_working ?? id}" for ${targets.join(" and ")}`,
      after: { targets },
      by,
    });
    const problems: string[] = [];
    if (targets.includes("youtube"))
      await queue("publish_youtube", id, { privacy: "public" });
    if (targets.includes("instagram")) {
      try {
        row = await publishInstagram(row, () => undefined);
      } catch (e) {
        problems.push(String(e instanceof Error ? e.message : e).slice(0, 300));
      }
    }
    if (problems.length) row = await patch(id, { error: problems.join(" · ") });
    if (row.published?.instagram?.id)
      await ctx.runMutation(internal.ceo.posting.record, {
        action: "posting.publish",
        rowId: String(id),
        what: `Published on Instagram: ${row.published.instagram.permalink ?? row.published.instagram.id}`,
        after: row.published,
        by,
      });
    return withUrls(row, true);
  },
});

/** Finish an Instagram publish Meta was still processing, or retry a failed one. */
export const checkInstagram = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Post> => {
    const by = await gate(ctx);
    let row = await one(id);
    if (!["approved", "publishing", "failed"].includes(String(row.status)))
      throw new Error(`A ${row.status} post has nothing to finish.`);
    if (String(row.status) === "failed")
      row = await patch(id, { status: "publishing", error: null });
    try {
      row = await publishInstagram(row, () => undefined);
    } catch (e) {
      row = await patch(id, {
        error: String(e instanceof Error ? e.message : e).slice(0, 300),
      });
    }
    if (row.published?.instagram?.id)
      await ctx.runMutation(internal.ceo.posting.record, {
        action: "posting.publish",
        rowId: String(id),
        what: `Published on Instagram: ${row.published.instagram.permalink ?? row.published.instagram.id}`,
        after: row.published,
        by,
      });
    return withUrls(row, true);
  },
});

/** Aziz pasted the address Google sent him to; the worker exchanges the code. */
export const youtubeConnect = authenticatedAction({
  args: { redirectUrl: v.string() },
  returns: v.any(),
  handler: async (ctx, { redirectUrl }): Promise<{ jobId: number }> => {
    const by = await gate(ctx);
    const v2 = redirectUrl.trim();
    if (!/code=|^4\//.test(v2))
      throw new Error(
        "Paste the whole address of the page Google sent you to; it carries a code=.",
      );
    const jobId = await queue("youtube_auth", null, { redirect_url: v2, by });
    return { jobId };
  },
});
