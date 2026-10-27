import {z} from 'zod';
import {storageStatus} from './tools.ts';
import {type UpsellCtx, UpsellError} from './upsell.ts';

/**
 * Capture files: dated screenshots of a client's gap (their parked page,
 * their name on Google), shown on the offer deck and the proposal
 * (docs/upsell-studio/EDGE.md section 5). Copied from launchAds.ts and cut to
 * one kind, not imported: the launch tray parses its kinds strictly in three
 * places (contract decision 2).
 *
 * The bucket (cockpit-upsell-files) is private and has no browser write
 * policy. A save is: reserve (cockpit_upsell_file_reserve, gated per client,
 * one row per request id; it checks what the picture was searched as through
 * the client copy check), a non-upserting upload URL signed here with the
 * service key, the browser's PUT, then ready: cockpit_upsell_file_accept
 * checks Storage's own size and type inside the transaction before the row
 * turns ready (audited). Reads are signed through the seat's own client, so
 * the bucket's read policy (cockpit_upsell_object_allowed) decides who sees
 * what. Remove keeps the row for the audit and deletes the bytes with the
 * service key; each list also sweeps this client's removed files and
 * day-old unfinished uploads, then records the purge (service key only).
 */
export const UPSELL_BUCKET = 'cockpit-upsell-files';
export const CAPTURE_MAX_BYTES = 10_485_760;
export const CAPTURE_READ_SECONDS = 3600;
export const CAPTURE_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'} as const;
type CaptureMime = keyof typeof CAPTURE_TYPES;

const id = z.string().uuid();
const fileSchema = z.object({
  id, kind: z.literal('capture'), status: z.enum(['uploading', 'ready', 'removed']).optional(), path: z.string(),
  mime: z.enum(Object.keys(CAPTURE_TYPES) as [CaptureMime, ...CaptureMime[]]), bytes: z.number().int().positive(),
}).passthrough();
export type CaptureFile = z.infer<typeof fileSchema>;

/** A row the server returned, inside this client's folder by the bucket's path rule. */
function checkFile(value: unknown, task: string): CaptureFile {
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) throw new UpsellError('The server did not confirm this client\'s capture. Try again.', 502);
  const f = parsed.data;
  if (f.path !== `${task}/${f.id}.${CAPTURE_TYPES[f.mime]}`) throw new UpsellError('The server returned a file path outside this client\'s folder.', 502);
  return f;
}

export type ReserveArgs = {
  taskId: string; kind: 'capture'; mime: CaptureMime; bytes: number; width?: number | null; height?: number | null;
  fileName?: string | null; capturedOn: string; searchedAs?: string | null;
};

export async function runUpsellFiles(ctx: UpsellCtx, operation: string, args: Record<string, unknown>, requestId: string | undefined) {
  const objects = ctx.admin.storage.from(UPSELL_BUCKET);

  /** Read links signed by the seat's own client. A file Storage would not sign stays null: never a guessed link. */
  const signReads = async (files: CaptureFile[]) => {
    const byPath = new Map<string, string>();
    if (files.length) {
      const signed = await ctx.store.call('GET', `${UPSELL_BUCKET}/sign-read`, files.length === 1 ? files[0].id : null, async () => {
        const {data, error} = await ctx.client.storage.from(UPSELL_BUCKET).createSignedUrls(files.map(f => f.path), CAPTURE_READ_SECONDS);
        if (error || !Array.isArray(data)) throw new UpsellError('The captures\' read links were not created. Open it again.', 502);
        return {status: 200, value: data};
      });
      for (const s of signed) if (!s.error && s.path && typeof s.signedUrl === 'string' && s.signedUrl) byPath.set(s.path, s.signedUrl);
    }
    return files.map(f => ({...f, url: byPath.get(f.path) ?? null}));
  };

  /**
   * Deletes the bytes of removed or stale captures with the service key, then
   * records it (service key only). A failure leaves the rows for the next
   * sweep, shows on the health page through its receipt, and never fails the caller.
   */
  const purge = async (task: string, files: {id: string; path: string}[]) => {
    if (!files.length) return false;
    try {
      const ok = await ctx.store.call('DELETE', `${UPSELL_BUCKET}/delete-object`, files.length === 1 ? files[0].id : null, async () => {
        const {error} = await objects.remove(files.map(f => f.path));
        return error ? {status: storageStatus(error), value: false} : {status: 200, value: true};
      });
      if (!ok) return false;
      const {error} = await ctx.admin.rpc('cockpit_upsell_file_purged', {p_task_id: task, p_ids: files.map(f => f.id)});
      return !error;
    } catch {
      return false;
    }
  };

  if (operation === 'upsellFiles.reserve') {
    const a = args as ReserveArgs;
    if (!requestId) throw new UpsellError('An upload request id is required.');
    const f = checkFile(await ctx.rpc('cockpit_upsell_file_reserve', {
      p_request_id: requestId, p_task_id: a.taskId, p_kind: a.kind, p_mime: a.mime, p_bytes: a.bytes,
      p_width: a.width ?? null, p_height: a.height ?? null, p_file_name: a.fileName ?? null,
      p_captured_on: a.capturedOn, p_searched_as: a.searchedAs ?? null,
    }), a.taskId);
    if (f.status === 'removed') throw new UpsellError('This capture was removed. Add it again.', 409);
    if (f.status === 'ready') return {id: f.id, path: f.path, status: 'ready', uploadUrl: null, token: null};
    const link = await ctx.store.call('POST', `${UPSELL_BUCKET}/sign-upload`, f.id, async () => {
      const {data, error} = await objects.createSignedUploadUrl(f.path, {upsert: false});
      if (error || !data?.signedUrl || !data.token) return {status: storageStatus(error), value: null};
      return {status: 200, value: {url: data.signedUrl, token: data.token}};
    });
    if (link) return {id: f.id, path: f.path, status: 'uploading', uploadUrl: link.url, token: link.token};
    // A retry after a PUT whose answer was lost: the object is already there, so there is nothing to sign. Ready checks it.
    const there = await ctx.store.call('GET', `${UPSELL_BUCKET}/sign-upload-check`, f.id, async () => {
      const {data, error} = await objects.info(f.path);
      if (error || !data) {
        const status = storageStatus(error);
        if (status === 404 || status === 400) return {status, value: false};
        throw new UpsellError('Storage could not be checked just now. Try again.', 502);
      }
      return {status: 200, value: true};
    });
    if (there) return {id: f.id, path: f.path, status: 'uploading', uploadUrl: null, token: null, uploaded: true};
    throw new UpsellError('The upload link was not created. Try the same picture again.', 502);
  }

  const task = String(args.taskId);
  if (operation === 'upsellFiles.ready') {
    // The accept checks Storage's own size and type in the same transaction that turns the row ready.
    const f = checkFile(await ctx.rpc('cockpit_upsell_file_accept', {p_task_id: task, p_id: args.id}), task);
    if (f.status !== 'ready') throw new UpsellError('The server did not confirm the capture. Try again.', 502);
    const [signed] = await signReads([f]);
    return {...signed, expiresIn: CAPTURE_READ_SECONDS};
  }

  if (operation === 'upsellFiles.list') {
    const read = z.object({rows: z.array(z.unknown())}).safeParse(await ctx.rpc('cockpit_upsell_files_read', {p_task_id: task}));
    if (!read.success) throw new UpsellError('The server did not return this client\'s captures. Try again.', 502);
    const files = read.data.rows.map(r => checkFile(r, task));
    if (files.some(f => f.status && f.status !== 'ready')) throw new UpsellError('The server returned a capture that is not saved yet.', 502);
    const out = {rows: await signReads(files), expiresIn: CAPTURE_READ_SECONDS, signedAt: new Date(ctx.now()).toISOString()};
    try {
      const stale = z.array(z.object({id, path: z.string()}).passthrough()).safeParse(await ctx.rpc('cockpit_upsell_files_stale', {p_task_id: task}));
      // Only paths inside this client's folder, by the same rule as checkFile.
      if (stale.success) await purge(task, stale.data.filter(f => /^[^/]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(f.path) && f.path.startsWith(`${task}/${f.id}.`)));
    } catch {
      // The list still answers; the next read sweeps again.
    }
    return out;
  }

  // upsellFiles.remove: the row stays for the audit; the bytes go now (or on the next sweep).
  const removed = checkFile(await ctx.rpc('cockpit_upsell_file_remove', {p_task_id: task, p_id: args.id}), task);
  if (removed.status !== 'removed') throw new UpsellError('The server did not confirm the removal. Try again.', 502);
  return {...removed, deleted: await purge(task, [removed])};
}
