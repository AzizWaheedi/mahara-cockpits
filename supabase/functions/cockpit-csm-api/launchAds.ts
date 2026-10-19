import {z} from 'zod';
import {storageStatus,storageTools} from './tools.ts';

/**
 * The launch deck's ads tray: creatives the client success manager uploads
 * before or during the call (docs/csm-decks/DESIGN.md section 10).
 *
 * The bucket is private and has no browser write policy. A save is: reserve
 * (cockpit_csm_launch_ad_reserve, gated per client, one row per request id),
 * a non-upserting upload URL signed here with the service key, the browser's
 * PUT, then ready: this function reads the object's size and type from
 * Storage, and cockpit_csm_launch_ad_accept checks Storage's own metadata
 * again inside the transaction before the row turns ready (audited). Reads
 * are signed through the signed-in seat's own client, so the bucket's read
 * policy decides who sees what. A read link stays valid for READ_SECONDS
 * even after its file is removed: Storage does not recheck a signed link.
 * Remove deletes the bytes with the service key; listing a client's tray
 * also sweeps that client's removed files and day-old unfinished uploads.
 * Nothing here writes to Meta.
 */
export const LAUNCH_BUCKET = 'cockpit-launch-ads';
export const LAUNCH_MAX_BYTES = 157286400;
export const POSTER_MAX_BYTES = 5242880;
export const READ_SECONDS = 3600;
export const LAUNCH_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm'} as const;
export const POSTER_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'} as const;
export const LAUNCH_AD_OPERATIONS = ['launchAds.reserve', 'launchAds.ready', 'launchAds.list', 'launchAds.update', 'launchAds.remove'];
export const CTAS = ['LEARN_MORE', 'GET_QUOTE', 'BOOK_NOW', 'CONTACT_US', 'SIGN_UP', 'SEND_WHATSAPP_MESSAGE', 'APPLY_NOW'] as const;

export class LaunchAdsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type RpcError = {message: string; code?: string};
type RpcResult = {data: unknown; error: RpcError | null};
type Signed = {path: string | null; signedUrl: string | null; error: string | null};
export type LaunchBucket = {
  createSignedUploadUrl: (path: string, options?: {upsert: boolean}) => Promise<{data: {signedUrl: string; token: string; path?: string} | null; error: unknown}>;
  info: (path: string) => Promise<{data: unknown; error: unknown}>;
  createSignedUrls: (paths: string[], expiresIn: number) => Promise<{data: Signed[] | null; error: unknown}>;
  remove: (paths: string[]) => Promise<{data: unknown; error: unknown}>;
};
export type LaunchClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: {from: (bucket: string) => Pick<LaunchBucket, 'createSignedUrls'>};
};
export type LaunchAdmin = {
  from: (table: string) => {insert: (row: Record<string, unknown>) => PromiseLike<{error: unknown}>};
  storage: {from: (bucket: string) => Pick<LaunchBucket, 'createSignedUploadUrl' | 'info' | 'remove'>};
};

const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const id = z.string().uuid();
const optionalRequest = {requestId: z.string().uuid().optional(), apply: z.boolean().optional()};
const mimes = Object.keys(LAUNCH_TYPES) as [keyof typeof LAUNCH_TYPES, ...(keyof typeof LAUNCH_TYPES)[]];
const posterMimes = Object.keys(POSTER_TYPES) as [keyof typeof POSTER_TYPES, ...(keyof typeof POSTER_TYPES)[]];
const inputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('launchAds.reserve'), requestId: z.string().uuid(), apply: z.boolean().optional(),
    args: z.object({
      taskId, kind: z.enum(['starter', 'custom', 'logo', 'page']), mime: z.enum(mimes),
      bytes: z.number().int().min(1).max(LAUNCH_MAX_BYTES),
      width: z.number().int().min(1).max(20000).nullish(), height: z.number().int().min(1).max(20000).nullish(),
      seconds: z.number().positive().max(3600).nullish(), fileName: z.string().max(400).nullish(),
      poster: z.object({mime: z.enum(posterMimes), bytes: z.number().int().min(1).max(POSTER_MAX_BYTES)}).strict().nullish(),
    }).strict(),
  }).strict(),
  z.object({operation: z.literal('launchAds.ready'), ...optionalRequest, args: z.object({taskId, id}).strict()}).strict(),
  z.object({operation: z.literal('launchAds.list'), ...optionalRequest, args: z.object({taskId, includeHidden: z.boolean().optional()}).strict()}).strict(),
  z.object({
    operation: z.literal('launchAds.update'), ...optionalRequest,
    args: z.object({
      taskId, id,
      patch: z.object({
        hidden: z.boolean().optional(), kind: z.enum(['starter', 'custom']).optional(),
        placement: z.enum(['feed', 'reels', 'facebook']).nullable().optional(),
        primaryText: z.string().max(2200).nullable().optional(), headline: z.string().max(255).nullable().optional(),
        cta: z.enum(CTAS).nullable().optional(), language: z.enum(['ar', 'en']).nullable().optional(),
      }).strict(),
    }).strict(),
  }).strict(),
  z.object({operation: z.literal('launchAds.remove'), ...optionalRequest, args: z.object({taskId, id}).strict()}).strict(),
]);
export type LaunchAdsInput = z.infer<typeof inputSchema>;

const adSchema = z.object({
  id, taskId, kind: z.enum(['starter', 'custom', 'logo', 'page']), status: z.enum(['uploading', 'ready', 'removed']),
  path: z.string(), mime: z.enum(mimes), bytes: z.number().int().positive(),
  posterPath: z.string().nullable(), posterMime: z.enum(posterMimes).nullable(), posterBytes: z.number().int().positive().nullable(),
}).passthrough();
export type LaunchAd = z.infer<typeof adSchema>;

/** The words a CSM reads in the notes window when a request is not valid. */
function inputProblem(raw: unknown, issues: z.ZodIssue[]): string {
  const operation = typeof raw === 'object' && raw !== null ? String((raw as Record<string, unknown>).operation ?? '') : '';
  const at = (key: string) => issues.some(issue => issue.path.includes(key));
  if (operation === 'launchAds.reserve') {
    if (at('poster')) return 'A video poster is a JPG, PNG or WebP picture up to 5 MB.';
    if (at('mime')) return 'Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM).';
    if (at('bytes')) return 'The file is empty or over 150 MB. Export a smaller copy to keep it.';
    if (at('requestId')) return 'An upload request id is required.';
  }
  if (operation === 'launchAds.update' && at('patch')) return 'Change only the text, placement, language, starter or custom, or hidden.';
  return LAUNCH_AD_OPERATIONS.includes(operation) ? 'Choose a client and one of its files.' : 'Unknown launch ads operation.';
}
function rpcProblem(error: RpcError): LaunchAdsError {
  return new LaunchAdsError(error.message || 'The server did not confirm this file. Try again.', error.code === '42501' ? 403 : 400);
}
/** A row the server returned, checked against the client asked for and its own path rule. */
function checkAd(value: unknown, task: string): LaunchAd {
  const parsed = adSchema.safeParse(value);
  if (!parsed.success || parsed.data.taskId !== task) throw new LaunchAdsError('The server did not confirm this client\'s file. Try again.', 502);
  const ad = parsed.data;
  const poster = ad.posterMime ? `${task}/${ad.id}-poster.${POSTER_TYPES[ad.posterMime]}` : null;
  if (ad.path !== `${task}/${ad.id}.${LAUNCH_TYPES[ad.mime]}` || ad.posterPath !== poster)
    throw new LaunchAdsError('The server returned a file path outside this client\'s folder.', 502);
  return ad;
}

export async function runLaunchAds(client: LaunchClient, admin: LaunchAdmin, raw: unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new LaunchAdsError(inputProblem(raw, parsed.error.issues));
  const input = parsed.data;
  const store = storageTools(async row => {
    const {error} = await admin.from('cockpit_csm_provider_health').insert(row);
    if (error) throw new LaunchAdsError('The storage receipt could not be saved, so nothing was changed. Try again.', 503);
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const {data, error} = await client.rpc(name, args);
    if (error) throw rpcProblem(error);
    return data;
  };
  const objects = admin.storage.from(LAUNCH_BUCKET);

  /** Size and type as Storage holds them, or null when Storage says the object is not there. */
  const inspect = (ad: LaunchAd, path: string, label: string) => store.call('GET', `${LAUNCH_BUCKET}/${label}`, ad.id, async () => {
    const {data, error} = await objects.info(path);
    if (error || !data || typeof data !== 'object') {
      const status = storageStatus(error);
      if (status === 404) return {status, value: null};
      throw new LaunchAdsError('Storage could not be checked just now. Try again.', 502);
    }
    const info = data as Record<string, unknown>;
    const meta = (typeof info.metadata === 'object' && info.metadata ? info.metadata : {}) as Record<string, unknown>;
    return {status: 200, value: {size: Number(info.size ?? meta.size), type: String(info.contentType ?? meta.mimetype ?? '').toLowerCase()}};
  });
  /**
   * Deletes the bytes of removed or stale files with the service key, then
   * records it. A failure leaves the rows unpurged for the next sweep and is
   * on the health page through its receipt; it never fails the caller.
   */
  const purge = async (task: string, files: {id: string; path: string; posterPath: string | null}[]) => {
    if (!files.length) return false;
    try {
      const paths = files.flatMap(f => f.posterPath ? [f.path, f.posterPath] : [f.path]);
      const ok = await store.call('DELETE', `${LAUNCH_BUCKET}/delete-object`, files.length === 1 ? files[0].id : null, async () => {
        const {error} = await objects.remove(paths);
        return error ? {status: storageStatus(error), value: false} : {status: 200, value: true};
      });
      if (!ok) return false;
      await rpc('cockpit_csm_launch_ad_purged', {p_task_id: task, p_ids: files.map(f => f.id)});
      return true;
    } catch {
      return false;
    }
  };
  const staleSchema = z.array(z.object({id, path: z.string(), posterPath: z.string().nullable()}).passthrough());
  /** This client's removed files and day-old unfinished uploads, swept on each tray read. */
  const sweep = async (task: string) => {
    try {
      const stale = staleSchema.safeParse(await rpc('cockpit_csm_launch_ad_stale', {p_task_id: task}));
      if (!stale.success) return;
      // Only paths inside this client's folder, by the same rule as checkAd.
      const own = stale.data.filter(f => f.path.startsWith(`${task}/${f.id}.`) && (!f.posterPath || f.posterPath.startsWith(`${task}/${f.id}-poster.`)));
      await purge(task, own);
    } catch {
      // The tray still lists; the next read sweeps again.
    }
  };
  const verify = async (ad: LaunchAd, path: string, mime: string, bytes: number, label: string, missing: string) => {
    const found = await inspect(ad, path, label);
    if (!found) throw new LaunchAdsError(missing, 409);
    if (!Number.isSafeInteger(found.size) || found.size !== bytes || found.type !== mime)
      throw new LaunchAdsError('The uploaded file does not match what was reserved. Add it again.', 409);
  };
  /** Read links signed by the seat's own client: the bucket's read policy rechecks access. */
  const signReads = async (ads: LaunchAd[]) => {
    const paths = ads.flatMap(ad => ad.posterPath ? [ad.path, ad.posterPath] : [ad.path]);
    const byPath = new Map<string, string>();
    if (paths.length) {
      const signed = await store.call('GET', `${LAUNCH_BUCKET}/sign-read`, ads.length === 1 ? ads[0].id : null, async () => {
        const {data, error} = await client.storage.from(LAUNCH_BUCKET).createSignedUrls(paths, READ_SECONDS);
        if (error || !Array.isArray(data)) throw new LaunchAdsError('The files\' read links were not created. Open the deck again.', 502);
        return {status: 200, value: data};
      });
      for (const s of signed) if (!s.error && s.path && typeof s.signedUrl === 'string' && s.signedUrl) byPath.set(s.path, s.signedUrl);
    }
    // A file Storage would not sign stays null: never a guessed link.
    return ads.map(ad => ({...ad, url: byPath.get(ad.path) ?? null, posterUrl: ad.posterPath ? byPath.get(ad.posterPath) ?? null : null}));
  };

  if (input.operation === 'launchAds.reserve') {
    const a = input.args;
    if (a.poster && !a.mime.startsWith('video/')) throw new LaunchAdsError('Only a video has a poster.');
    const ad = checkAd(await rpc('cockpit_csm_launch_ad_reserve', {
      p_request_id: input.requestId, p_task_id: a.taskId, p_kind: a.kind, p_mime: a.mime, p_bytes: a.bytes,
      p_width: a.width ?? null, p_height: a.height ?? null, p_seconds: a.seconds ?? null, p_file_name: a.fileName ?? null,
      p_poster_mime: a.poster?.mime ?? null, p_poster_bytes: a.poster?.bytes ?? null,
    }), a.taskId);
    if (ad.status === 'removed') throw new LaunchAdsError('This upload was removed. Add the file again.', 409);
    if (ad.status === 'ready') return {ad, upload: null, posterUpload: null};
    const sign = async (path: string, label: string) => {
      const link = await store.call('POST', `${LAUNCH_BUCKET}/${label}`, ad.id, async () => {
        const {data, error} = await objects.createSignedUploadUrl(path, {upsert: false});
        if (error || !data?.signedUrl || !data.token) return {status: storageStatus(error), value: null};
        return {status: 200, value: {path, url: data.signedUrl, token: data.token}};
      });
      if (link) return link;
      // A retry after a PUT whose answer was lost: the object is already there,
      // so there is nothing to sign. Ready checks it.
      if (await inspect(ad, path, `${label}-check`)) return {path, url: null, token: null, uploaded: true};
      throw new LaunchAdsError('The upload link was not created. Try the same file again.', 502);
    };
    const upload = await sign(ad.path, 'sign-upload');
    const posterUpload = ad.posterPath ? await sign(ad.posterPath, 'sign-poster-upload') : null;
    return {ad, upload, posterUpload};
  }

  if (input.operation === 'launchAds.ready') {
    const {taskId: task, id: adId} = input.args;
    const current = await rpc('cockpit_csm_launch_ad_get', {p_task_id: task, p_id: adId});
    let ad = checkAd(current, task);
    if (ad.status === 'removed') throw new LaunchAdsError('This file was removed. Add it again.', 409);
    if (ad.status === 'uploading') {
      if ((current as Record<string, unknown>).mine !== true) throw new LaunchAdsError('Only the person who started this upload can finish it.', 403);
      await verify(ad, ad.path, ad.mime, ad.bytes, 'verify-object', 'The file did not arrive. Add it again.');
      if (ad.posterPath && ad.posterMime && ad.posterBytes)
        await verify(ad, ad.posterPath, ad.posterMime, ad.posterBytes, 'verify-poster', 'The video\'s poster did not arrive. Add the video again.');
      ad = checkAd(await rpc('cockpit_csm_launch_ad_accept', {p_task_id: task, p_id: adId}), task);
      if (ad.status !== 'ready') throw new LaunchAdsError('The server did not confirm the file. Try again.', 502);
    }
    const [signed] = await signReads([ad]);
    return {ad: signed, expiresIn: READ_SECONDS};
  }

  if (input.operation === 'launchAds.list') {
    const {taskId: task, includeHidden} = input.args;
    const data = await rpc('cockpit_csm_launch_ads_read', {p_task_id: task, p_include_hidden: includeHidden ?? true});
    if (!Array.isArray(data)) throw new LaunchAdsError('The server did not return this client\'s files. Try again.', 502);
    const ads = data.map(row => checkAd(row, task));
    if (ads.some(ad => ad.status !== 'ready')) throw new LaunchAdsError('The server returned a file that is not saved yet.', 502);
    const signedAt = new Date().toISOString();
    const out = {ads: await signReads(ads), expiresIn: READ_SECONDS, signedAt};
    await sweep(task);
    return out;
  }

  if (input.operation === 'launchAds.update') {
    const {taskId: task, id: adId, patch} = input.args;
    const names: Record<string, string> = {hidden: 'hidden', kind: 'kind', placement: 'placement', primaryText: 'primary_text', headline: 'headline', cta: 'cta', language: 'language'};
    const p_patch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined).map(([key, value]) => [names[key], value]));
    if (!Object.keys(p_patch).length) throw new LaunchAdsError('Choose something to change.');
    return {ad: checkAd(await rpc('cockpit_csm_launch_ad_update', {p_task_id: task, p_id: adId, p_patch}), task)};
  }

  const {taskId: task, id: adId} = input.args;
  const removed = checkAd(await rpc('cockpit_csm_launch_ad_remove', {p_task_id: task, p_id: adId}), task);
  if (removed.status !== 'removed') throw new LaunchAdsError('The server did not confirm the removal. Try again.', 502);
  // The row stays for the audit; the bytes go now (or on the next sweep).
  const purged = (removed as Record<string, unknown>).purgedAt ? true : await purge(task, [removed]);
  return {ad: removed, deleted: purged};
}
