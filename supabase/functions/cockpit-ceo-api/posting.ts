/**
 * The posting desk on Supabase. Ported from
 * apps/media-buyer-cockpit/convex/ceo/posting.ts.
 *
 * The worker on the VPS (`radar.py posts`, hermes/ideation-radar) drains
 * cockpit_post_jobs: it fetches the video, listens, writes the copy, renders
 * the thumbnail and the cover, uploads to YouTube and exchanges the YouTube
 * consent code. This side reads posts, mints short signed links to the
 * private `posting` bucket, and changes rows only through service-only RPCs
 * that check the founder and write the audit row in the same transaction.
 * Instagram publishes from here through the Meta system token, and only
 * after Aziz presses approve.
 */

type Row = Record<string, unknown>;

export const POSTING_BUCKET = 'posting';
export const IG_USER = '17841473441237528';
export const TARGETS = ['instagram', 'youtube', 'facebook', 'tiktok', 'linkedin', 'x'];
/** Where the cockpit can publish today; the rest are carried but refused at approval. */
export const LIVE_TARGETS = ['instagram', 'youtube'];
export const POSTING_READS = new Set(['list', 'get', 'channels']);
export const POSTING_WRITES = new Set(['uploadUrl', 'create', 'save', 'rerender', 'reprepare', 'approve', 'checkInstagram', 'discard', 'youtubeConnect']);
export const DEFAULT_TARGETS: Record<string, string[]> = { reel: ['instagram', 'youtube'], video: ['youtube'], post: ['instagram'] };
const LINK_HOURS = 48;
const POLL_EVERY_MS = 5000;

export interface PostingStore {
  list(limit: number): Promise<Row[]>;
  one(id: number): Promise<Row | null>;
  channels(): Promise<Row[]>;
  /** A service-only RPC; throws with the database's plain sentence. */
  rpc(name: string, args: Row): Promise<unknown>;
  /** Signed links per path; a path that could not be signed is absent. */
  sign(paths: string[], expiresIn: number): Promise<Map<string, string>>;
  /** A link the browser may PUT one file into, once. */
  uploadUrl(path: string): Promise<string>;
}
export interface Graph {
  get(path: string, params: Record<string, string | number>, label: string): Promise<Row>;
  post(path: string, params: Record<string, string | number>, label: string): Promise<Row>;
}
export interface PostingDeps {
  store: PostingStore;
  graph: Graph;
  actorId: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** How long one request waits for Meta to finish a container. */
  pollBudgetMs: number;
}

const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : []);
const text = (x: unknown): string | null => (x === null || x === undefined ? null : String(x));
const num = (x: unknown): number | null => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

function postId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Error('Choose a post.');
  return id;
}
function optionalString(args: Row, key: string, max = 20000): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw Error(`Choose a valid ${key}.`);
  return value;
}
function optionalStrings(args: Row, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 500)) throw Error(`Choose a valid ${key} list.`);
  return value as string[];
}

/** The row as the Posting tab reads it, without links. */
export function toPost(r: Row) {
  return {
    id: Number(r.id),
    kind: r.kind === 'video' ? 'video' : r.kind === 'post' ? 'post' : 'reel',
    titleWorking: text(r.title_working),
    images: strs(r.images),
    brief: text(r.brief),
    sourceKind: String(r.source_kind ?? ''),
    sourceRef: String(r.source_ref ?? ''),
    videoPath: text(r.video_path),
    durationSec: num(r.duration_sec),
    width: num(r.width),
    height: num(r.height),
    language: text(r.language),
    status: String(r.status ?? 'new'),
    targets: strs(r.targets),
    transcript: r.transcript ?? null,
    chapters: Array.isArray(r.chapters) ? r.chapters : [],
    ytTitle: text(r.yt_title),
    ytTitleOptions: strs(r.yt_title_options),
    ytDescription: text(r.yt_description),
    ytTags: strs(r.yt_tags),
    igCaption: text(r.ig_caption),
    igHashtags: strs(r.ig_hashtags),
    thumbText: text(r.thumb_text),
    thumbTextOptions: strs(r.thumb_text_options),
    thumbFrameMs: num(r.thumb_frame_ms),
    thumbPath: text(r.thumb_path),
    coverPath: text(r.cover_path),
    frames: Array.isArray(r.frames) ? r.frames.filter(isRow) : [],
    method: isRow(r.method) ? r.method : {},
    scheduledAt: text(r.scheduled_at),
    approvedBy: text(r.approved_by),
    approvedAt: text(r.approved_at),
    published: isRow(r.published) ? r.published : {},
    error: text(r.error),
    createdBy: String(r.created_by ?? ''),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  };
}
type Post = ReturnType<typeof toPost> & { urls: Row };

/** Posts with their short links: thumbnails only for the list, everything for one post. */
export async function withUrls(rows: Row[], full: boolean, store: PostingStore): Promise<Post[]> {
  const posts = rows.map(toPost);
  const hour = new Set<string>();
  const twoHours = new Set<string>();
  for (const p of posts) {
    if (p.thumbPath) hour.add(p.thumbPath);
    if (!full) continue;
    if (p.coverPath) hour.add(p.coverPath);
    for (const path of p.images) hour.add(path);
    for (const f of p.frames) if (typeof f.path === 'string') hour.add(f.path);
    if (p.videoPath) twoHours.add(p.videoPath);
  }
  const [h1, h2] = await Promise.all([
    hour.size ? store.sign([...hour], 3600) : Promise.resolve(new Map<string, string>()),
    twoHours.size ? store.sign([...twoHours], 2 * 3600) : Promise.resolve(new Map<string, string>()),
  ]);
  return posts.map(p => {
    const urls: Row = { thumb: p.thumbPath ? h1.get(p.thumbPath) : undefined };
    if (full) {
      urls.video = p.videoPath ? h2.get(p.videoPath) : undefined;
      urls.cover = p.coverPath ? h1.get(p.coverPath) : undefined;
      urls.images = p.images.map(path => h1.get(path)).filter((u): u is string => typeof u === 'string');
      const frames: Record<string, string> = {};
      for (const f of p.frames) {
        const u = typeof f.path === 'string' ? h1.get(f.path) : undefined;
        if (u) frames[String(f.ms)] = u;
      }
      urls.frames = frames;
    }
    return { ...p, urls };
  });
}

/** The bucket path an upload goes to: unique, readable, no directory tricks. */
export function uploadPath(filename: string, at: number): string {
  const safe = filename.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'file';
  return `uploads/${at.toString(36)}-${safe}`;
}

/** The create arguments, checked and trimmed the way the Convex desk did. */
export function createArgs(a: Row): Row {
  const kind = a.kind;
  if (kind !== 'reel' && kind !== 'video' && kind !== 'post') throw Error('Choose a reel, a video or a post.');
  const sourceKind = a.sourceKind;
  if (!['upload', 'drive', 'url', 'image'].includes(String(sourceKind))) throw Error('Choose where the file comes from.');
  const sourceRef = optionalString(a, 'sourceRef', 2000);
  if (sourceRef === undefined) throw Error('Point at a file, a Drive link or a link first.');
  const images = (optionalStrings(a, 'images') ?? []).map(x => x.trim()).filter(Boolean);
  const brief = optionalString(a, 'brief')?.trim().slice(0, 2000) || null;
  const titleWorking = optionalString(a, 'titleWorking', 2000)?.trim().slice(0, 200) || null;
  const targets = a.targets === undefined || a.targets === null ? DEFAULT_TARGETS[kind] : optionalStrings(a, 'targets')!;
  return { kind, sourceKind, sourceRef: sourceRef.trim(), images, brief, titleWorking, targets: targets.filter(t => TARGETS.includes(t)) };
}

/** The editable fields, normalised as the Convex desk did, in the column names the RPC applies. */
export function savePatch(a: Row): Row {
  const body: Row = {};
  const titleWorking = optionalString(a, 'titleWorking');
  if (titleWorking !== undefined) body.title_working = titleWorking.trim().slice(0, 200) || null;
  const ytTitle = optionalString(a, 'ytTitle');
  if (ytTitle !== undefined) body.yt_title = ytTitle.trim().slice(0, 100) || null;
  const ytDescription = optionalString(a, 'ytDescription');
  if (ytDescription !== undefined) body.yt_description = ytDescription.slice(0, 5000) || null;
  const ytTags = optionalStrings(a, 'ytTags');
  if (ytTags !== undefined)
    body.yt_tags = ytTags.map(t => t.replace(/^#/, '').trim().slice(0, 30)).filter(Boolean).slice(0, 30);
  const igCaption = optionalString(a, 'igCaption');
  if (igCaption !== undefined) body.ig_caption = igCaption.slice(0, 2200) || null;
  const igHashtags = optionalStrings(a, 'igHashtags');
  if (igHashtags !== undefined)
    body.ig_hashtags = igHashtags
      .map(h => `#${h.replace(/^#/, '').replace(/[^\w؀-ۿ]/g, '')}`)
      .filter(h => h.length > 1)
      .slice(0, 30);
  const thumbText = optionalString(a, 'thumbText');
  if (thumbText !== undefined) body.thumb_text = thumbText.trim().slice(0, 60) || null;
  const targets = optionalStrings(a, 'targets');
  if (targets !== undefined) {
    const kept = targets.filter(t => TARGETS.includes(t));
    if (!kept.length) throw Error('Pick at least one place to post.');
    body.targets = kept;
  }
  if (a.scheduledAt !== undefined) {
    if (a.scheduledAt !== null && (typeof a.scheduledAt !== 'string' || !Number.isFinite(Date.parse(a.scheduledAt))))
      throw Error('Choose a valid time to post.');
    body.scheduled_at = a.scheduledAt;
  }
  return body;
}

const instagramOf = (row: Row): Row => (isRow(row.published) && isRow(row.published.instagram) ? row.published.instagram : {});

class ContainerFailed extends Error {}

/**
 * Publish on Instagram: a container from signed links (a reel from its video
 * and cover, a post from its images), wait for Meta to process it, publish,
 * keep the permalink. If Meta is still processing when the budget runs out,
 * the container is kept and checkInstagram finishes the job later.
 */
async function publishInstagram(row: Row, deps: PostingDeps): Promise<Row> {
  const { store, graph } = deps;
  const id = Number(row.id);
  const stage = async (name: string, value: Row = {}) =>
    (await store.rpc('cockpit_ceo_posting_instagram', { p_actor_id: deps.actorId, p_id: id, p_stage: name, p_value: value })) as Row;
  let container = String(instagramOf(row).container ?? '');
  const isPost = String(row.kind) === 'post';
  if (!container) {
    const hashtags = strs(row.ig_hashtags);
    const caption = [String(row.ig_caption ?? '').trim(), hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200);
    const signAll = async (paths: string[]) => {
      const links = await store.sign(paths, LINK_HOURS * 3600);
      return paths.map(path => {
        const link = links.get(path);
        if (!link) throw Error(`No signed link for ${path}. Check that the file is still in the posting bucket.`);
        return link;
      });
    };
    if (isPost) {
      const paths = strs(row.images);
      if (!paths.length) throw Error('The post has no images.');
      const urls = await signAll(paths);
      if (urls.length === 1) {
        container = String((await graph.post(`${IG_USER}/media`, { image_url: urls[0], caption }, 'instagram/media')).id ?? '');
      } else {
        const children: string[] = [];
        for (const url of urls) {
          const child = String((await graph.post(`${IG_USER}/media`, { image_url: url, is_carousel_item: 'true' }, 'instagram/media')).id ?? '');
          if (!child) throw Error('Meta gave no container for an image.');
          children.push(child);
        }
        container = String((await graph.post(`${IG_USER}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, 'instagram/media')).id ?? '');
      }
      if (!container) throw Error('Meta gave no container for the post.');
    } else {
      if (!row.video_path) throw Error('The video is not in the bucket yet.');
      const [videoUrl] = await signAll([String(row.video_path)]);
      const cover = row.cover_path ? (await store.sign([String(row.cover_path)], LINK_HOURS * 3600)).get(String(row.cover_path)) : undefined;
      container = String((await graph.post(`${IG_USER}/media`, {
        media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true', ...(cover ? { cover_url: cover } : {}),
      }, 'instagram/media')).id ?? '');
      if (!container) throw Error('Meta gave no container for the reel.');
    }
    row = await stage('container', { container });
  }
  // Meta transcodes for a minute or five. The rest is finished by checkInstagram.
  const deadline = deps.now() + deps.pollBudgetMs;
  let status = '';
  for (;;) {
    const s = await graph.get(container, { fields: 'status_code,status' }, 'instagram/container');
    status = String(s.status_code ?? '');
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED')
      throw new ContainerFailed(`Meta could not take the ${isPost ? 'post' : 'reel'}: ${String(s.status ?? status).slice(0, 200)}`);
    if (deps.now() + POLL_EVERY_MS > deadline) break;
    await deps.sleep(POLL_EVERY_MS);
  }
  if (status !== 'FINISHED') return stage('release', {});
  const mediaId = String((await graph.post(`${IG_USER}/media_publish`, { creation_id: container }, 'instagram/media_publish')).id ?? '');
  if (!mediaId) throw Error('Meta published nothing.');
  let permalink: string | null = null;
  try {
    const m = await graph.get(mediaId, { fields: 'permalink' }, 'instagram/media-permalink');
    permalink = typeof m.permalink === 'string' ? m.permalink : null;
  } catch {
    permalink = null;
  }
  return stage('published', { id: mediaId, permalink, container });
}

/** Claim the post, publish, and always give the claim back with what happened. */
async function instagramPass(id: number, deps: PostingDeps): Promise<Row> {
  const claimed = (await deps.store.rpc('cockpit_ceo_posting_instagram', { p_actor_id: deps.actorId, p_id: id, p_stage: 'claim', p_value: {} })) as Row;
  if (instagramOf(claimed).id) return claimed;
  try {
    return await publishInstagram(claimed, deps);
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e).slice(0, 300);
    return (await deps.store.rpc('cockpit_ceo_posting_instagram', {
      p_actor_id: deps.actorId, p_id: id, p_stage: 'release', p_value: { error: message, dropContainer: e instanceof ContainerFailed },
    })) as Row;
  }
}

/** One Posting tab operation. Reads need no apply; writes are refused without it. */
export async function postingOperation(op: string, args: Row, deps: PostingDeps, apply: boolean): Promise<unknown> {
  const { store } = deps;
  if (!POSTING_READS.has(op) && !POSTING_WRITES.has(op)) throw Error(`Unknown posting operation: ${op}`);
  if (POSTING_WRITES.has(op) && !apply)
    return { dryRun: true, operation: `ceo.posting.${op}`, message: 'Preview only; nothing was changed.' };
  const one = async (id: number) => {
    const row = await store.one(id);
    if (!row) throw Error('That post is gone.');
    return row;
  };
  const rowOf = (value: unknown): Row => {
    if (!isRow(value) || !Number.isSafeInteger(Number(value.id))) throw Error('The server did not confirm the post.');
    return value;
  };
  const jobOf = (value: unknown) => {
    const jobId = isRow(value) ? Number(value.jobId) : NaN;
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw Error('The job was not queued.');
    return { jobId };
  };
  const rpc = (name: string, extra: Row) => store.rpc(name, { p_actor_id: deps.actorId, ...extra });
  switch (op) {
    case 'channels':
      return (await store.channels()).map(r => ({
        platform: String(r.platform),
        handle: text(r.handle),
        externalId: text(r.external_id),
        connected: r.connected === true,
        connectedAt: text(r.connected_at),
        authUrl: text(r.auth_url),
        note: text(r.note),
        checkedAt: text(r.checked_at),
        live: LIVE_TARGETS.includes(String(r.platform)),
      }));
    case 'list': {
      const limit = Math.min(60, Math.max(1, Math.trunc(Number(args.limit ?? 30)) || 30));
      return withUrls(await store.list(limit), false, store);
    }
    case 'get':
      return (await withUrls([await one(postId(args.id))], true, store))[0];
    case 'uploadUrl': {
      const filename = optionalString(args, 'filename', 500);
      if (filename === undefined) throw Error('Choose a file first.');
      const path = uploadPath(filename, deps.now());
      return { path, url: await store.uploadUrl(path) };
    }
    case 'create':
      return (await withUrls([rowOf(await rpc('cockpit_ceo_posting_create', { p_args: createArgs(args) }))], false, store))[0];
    case 'save':
      return (await withUrls([rowOf(await rpc('cockpit_ceo_posting_save', { p_id: postId(args.id), p_patch: savePatch(args) }))], true, store))[0];
    case 'rerender': {
      const params: Row = {};
      const thumbText = optionalString(args, 'thumbText');
      if (thumbText !== undefined) params.thumb_text = thumbText.trim().slice(0, 60);
      if (args.frameMs !== undefined) {
        const frame = Number(args.frameMs);
        if (!Number.isFinite(frame) || frame < 0) throw Error('Choose a frame from the strip.');
        params.frame_ms = Math.round(frame);
      }
      return jobOf(await rpc('cockpit_ceo_posting_queue', { p_id: postId(args.id), p_kind: 'render', p_params: params }));
    }
    case 'reprepare':
      return jobOf(await rpc('cockpit_ceo_posting_queue', { p_id: postId(args.id), p_kind: 'prepare', p_params: {} }));
    case 'youtubeConnect': {
      const redirectUrl = optionalString(args, 'redirectUrl', 4000)?.trim() ?? '';
      if (!/code=|^4\//.test(redirectUrl)) throw Error('Paste the whole address of the page Google sent you to; it carries a code=.');
      return jobOf(await rpc('cockpit_ceo_posting_queue', { p_id: null, p_kind: 'youtube_auth', p_params: { redirect_url: redirectUrl } }));
    }
    case 'discard':
      return (await withUrls([rowOf(await rpc('cockpit_ceo_posting_discard', { p_id: postId(args.id) }))], false, store))[0];
    case 'approve': {
      const id = postId(args.id);
      let row = rowOf(await rpc('cockpit_ceo_posting_approve', { p_id: id }));
      if (strs(row.targets).includes('instagram')) row = rowOf(await instagramPass(id, deps));
      return (await withUrls([row], true, store))[0];
    }
    case 'checkInstagram':
      return (await withUrls([rowOf(await instagramPass(postId(args.id), deps))], true, store))[0];
  }
  throw Error(`Unknown posting operation: ${op}`);
}
