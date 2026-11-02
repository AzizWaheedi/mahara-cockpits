import {z} from 'zod';
import {storageStatus, WebError, type WebResult} from './tools.ts';
import {type UpsellCtx, UpsellError} from './upsell.ts';
import {checkSite, logoCandidates, siteAddress, siteDomain} from './upsellSite.ts';

/**
 * The proposal's client logo (docs/upsell-studio/EDGE.md section 4).
 *
 * Find: the verified logo (cockpit_client_logos, through the decks' own
 * sources read), the logos uploaded to the launch deck's tray, and the
 * pictures on the client's own site. Nothing from Meta, Brand DNA, ClickUp
 * or Instagram yet (contract decision 10).
 *
 * Pick: a picture from the client's own site is read once, checked from its
 * bytes (PNG, JPEG or WebP; no SVG, GIF, animated WebP or APNG; at most
 * 2 MB; 64 to 4000 pixels a side), stripped of EXIF and XMP, then saved in the
 * launch tray as kind logo through the tray's own chain: reserve as the seat,
 * a non-upserting signed upload, Storage's size and type checked, accept as
 * the seat (which checks Storage again and audits). It never writes
 * cockpit_client_logos: marking a logo verified stays the CEO's step.
 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_SIDE = 64;
export const LOGO_MAX_SIDE = 4000;
export const LAUNCH_BUCKET = 'cockpit-launch-ads';
export const LOGO_READ_SECONDS = 3600;
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'} as const;
export type LogoMime = keyof typeof EXT;
export type Picture = {mime: LogoMime; width: number; height: number};

export class PictureRefusal extends Error {}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + ((b[at + 3] << 24) >>> 0);
const unreadable = () => new PictureRefusal('That picture could not be read. Pick another one.');

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The kind of file from its first bytes, whatever its name or header says. */
export function sniff(b: Uint8Array): LogoMime | 'svg' | 'gif' | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'gif';
  const head = new TextDecoder('utf-8', {fatal: false}).decode(b.subarray(0, 1024)).replace(/^\ufeff/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || (head.startsWith('<!doctype svg'))) return 'svg';
  return null;
}

// ---- PNG -------------------------------------------------------------------

type PngChunk = {type: string; start: number; end: number};
function pngChunks(b: Uint8Array): PngChunk[] {
  const out: PngChunk[] = [];
  let at = 8;
  while (at + 12 <= b.length) {
    const len = be32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    if (len > 0x7fffffff || end > b.length || !/^[A-Za-z]{4}$/.test(type)) throw unreadable();
    out.push({type, start: at, end});
    at = end;
    if (type === 'IEND') return out;
  }
  throw unreadable();
}
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);

// ---- JPEG ------------------------------------------------------------------

type JpegSegment = {marker: number; start: number; end: number};
/** The segments up to and including the start of scan; the rest is copied as it is. */
function jpegSegments(b: Uint8Array): {segments: JpegSegment[]; scanEnd: number} {
  const segments: JpegSegment[] = [];
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) throw unreadable();
    let m = at + 1;
    while (m < b.length && b[m] === 0xff) m++;
    const marker = b[m];
    if (marker === undefined) break;
    const start = at;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({marker, start, end: m + 1});
      at = m + 1;
      continue;
    }
    if (marker === 0xd9) {
      segments.push({marker, start, end: m + 1});
      return {segments, scanEnd: m + 1};
    }
    if (m + 3 > b.length) throw unreadable();
    const len = be16(b, m + 1);
    const end = m + 1 + len;
    if (len < 2 || end > b.length) throw unreadable();
    segments.push({marker, start, end});
    at = end;
    if (marker === 0xda) return {segments, scanEnd: end};
  }
  throw unreadable();
}
// APP1 holds EXIF and XMP, APP13 Photoshop's IPTC block, COM free text.
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

// ---- WebP ------------------------------------------------------------------

type RiffChunk = {fourcc: string; start: number; end: number; dataAt: number; size: number};
function webpChunks(b: Uint8Array): RiffChunk[] {
  if (b.length < 20) throw unreadable();
  const out: RiffChunk[] = [];
  const limit = Math.min(b.length, 8 + le32(b, 4));
  let at = 12;
  while (at + 8 <= limit) {
    const fourcc = ascii(b, at, 4);
    const size = le32(b, at + 4);
    const end = at + 8 + size + (size & 1);
    if (end > b.length + (size & 1)) throw unreadable();
    out.push({fourcc, start: at, end: Math.min(end, b.length), dataAt: at + 8, size});
    at = end;
  }
  if (!out.length) throw unreadable();
  return out;
}

/** What the picture is and its size, or a refusal in plain words. */
export function inspectPicture(b: Uint8Array): Picture {
  const kind = sniff(b);
  if (kind === 'svg') throw new PictureRefusal('That logo is an SVG drawing. Pick a PNG, JPG or WebP picture.');
  if (kind === 'gif') throw new PictureRefusal('That logo is a GIF. Pick a PNG, JPG or WebP picture.');
  if (!kind) throw new PictureRefusal('That file is not a PNG, JPG or WebP picture. Pick another one.');
  let width = 0;
  let height = 0;
  if (kind === 'image/png') {
    const chunks = pngChunks(b);
    if (chunks[0]?.type !== 'IHDR') throw unreadable();
    if (chunks.some(c => c.type === 'acTL')) throw new PictureRefusal('That logo moves (an animated PNG). Pick a still picture.');
    width = be32(b, chunks[0].start + 8);
    height = be32(b, chunks[0].start + 12);
  } else if (kind === 'image/jpeg') {
    const sof = jpegSegments(b).segments.find(s => isSof(s.marker));
    if (!sof) throw unreadable();
    // After the marker byte, a frame header: length(2) precision(1) height(2) width(2).
    let m = sof.start + 1;
    while (b[m] === 0xff) m++;
    if (m + 8 > sof.end) throw unreadable();
    height = be16(b, m + 4);
    width = be16(b, m + 6);
  } else {
    const chunks = webpChunks(b);
    if (chunks.some(c => c.fourcc === 'ANIM' || c.fourcc === 'ANMF')) throw new PictureRefusal('That logo moves (an animated WebP). Pick a still picture.');
    const x = chunks.find(c => c.fourcc === 'VP8X');
    if (x) {
      if (b[x.dataAt] & 0x02) throw new PictureRefusal('That logo moves (an animated WebP). Pick a still picture.');
      width = le24(b, x.dataAt + 4) + 1;
      height = le24(b, x.dataAt + 7) + 1;
    } else {
      const lossy = chunks.find(c => c.fourcc === 'VP8 ');
      const lossless = chunks.find(c => c.fourcc === 'VP8L');
      if (lossy && b[lossy.dataAt + 3] === 0x9d && b[lossy.dataAt + 4] === 0x01 && b[lossy.dataAt + 5] === 0x2a) {
        width = le16(b, lossy.dataAt + 6) & 0x3fff;
        height = le16(b, lossy.dataAt + 8) & 0x3fff;
      } else if (lossless && b[lossless.dataAt] === 0x2f) {
        const bits = le32(b, lossless.dataAt + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      } else throw unreadable();
    }
  }
  if (!width || !height) throw unreadable();
  return {mime: kind, width, height};
}

/** The same picture without its EXIF and XMP (and PNG text, JPEG comments and IPTC). Pixels are untouched. */
export function stripMetadata(b: Uint8Array, mime: LogoMime): Uint8Array {
  if (mime === 'image/png') {
    const keep = pngChunks(b).filter(c => !PNG_DROP.has(c.type));
    return concat([b.subarray(0, 8), ...keep.map(c => b.subarray(c.start, c.end))]);
  }
  if (mime === 'image/jpeg') {
    const {segments, scanEnd} = jpegSegments(b);
    return concat([b.subarray(0, 2), ...segments.filter(s => !JPEG_DROP.has(s.marker)).map(s => b.subarray(s.start, s.end)), b.subarray(scanEnd)]);
  }
  const chunks = webpChunks(b).filter(c => c.fourcc !== 'EXIF' && c.fourcc !== 'XMP ');
  const body = concat(chunks.map(c => {
    const part = b.slice(c.start, c.end);
    // The extended header says which extra chunks follow: EXIF (0x08) and XMP (0x04) no longer do.
    if (c.fourcc === 'VP8X') part[8] &= ~0x0c;
    return part;
  }));
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12), 0);
  const size = 4 + body.length;
  out[4] = size & 255;
  out[5] = (size >>> 8) & 255;
  out[6] = (size >>> 16) & 255;
  out[7] = (size >>> 24) & 255;
  out.set(body, 12);
  return out;
}

/** The checks a logo passes before it is saved, then the stripped bytes. */
export function checkLogoBytes(b: Uint8Array): {picture: Picture; bytes: Uint8Array} {
  if (!b.length) throw new PictureRefusal('That picture is empty. Pick another one.');
  if (b.length > LOGO_MAX_BYTES) throw new PictureRefusal('That logo is over 2 MB. Pick a smaller one, or upload a smaller copy.');
  const picture = inspectPicture(b);
  if (picture.width < LOGO_MIN_SIDE || picture.height < LOGO_MIN_SIDE) throw new PictureRefusal('That logo is smaller than 64 by 64 pixels. Pick a larger one.');
  if (picture.width > LOGO_MAX_SIDE || picture.height > LOGO_MAX_SIDE) throw new PictureRefusal('That logo is larger than 4000 by 4000 pixels. Upload a smaller copy.');
  const bytes = stripMetadata(b, picture.mime);
  // The stripped file must still read as the same picture.
  const again = inspectPicture(bytes);
  if (again.mime !== picture.mime || again.width !== picture.width || again.height !== picture.height) throw unreadable();
  return {picture, bytes};
}

// ---- Find and pick ---------------------------------------------------------

export type LogoFindCandidate = {source: 'verified' | 'upload' | 'site'; url: string; adId?: string; width?: number; height?: number};
const adSchema = z.object({
  id: z.string().uuid(), taskId: z.string(), kind: z.string(), status: z.enum(['uploading', 'ready', 'removed']), path: z.string(),
  mime: z.string(), bytes: z.number().int().positive(), width: z.number().int().nullable().optional(), height: z.number().int().nullable().optional(),
}).passthrough();
type Ad = z.infer<typeof adSchema>;
const offerSiteSchema = z.object({site: z.object({urls: z.array(z.object({url: z.string(), from: z.string()}).passthrough())}).passthrough()}).passthrough();

/** A tray row the server returned, checked against the client asked for and the tray's path rule. */
function checkAd(value: unknown, task: string): Ad {
  const parsed = adSchema.safeParse(value);
  if (!parsed.success || parsed.data.taskId !== task) throw new UpsellError('The server did not confirm this client\'s logo. Try again.', 502);
  const ext = EXT[parsed.data.mime as LogoMime];
  if (!ext || parsed.data.path !== `${task}/${parsed.data.id}.${ext}`) throw new UpsellError('The server returned a file path outside this client\'s folder.', 502);
  return parsed.data;
}

/** The addresses on file for the client's site (card, onboarding form, prep), as URLs to read. */
async function siteUrls(ctx: UpsellCtx, task: string): Promise<string[]> {
  const sources = offerSiteSchema.safeParse(await ctx.rpc('cockpit_csm_offer_sources', {p_task_id: task, p_offer: 'website'}));
  // An answer that cannot be read is not "no site on file".
  if (!sources.success) throw new UpsellError('The server did not return this client\'s site. Try again.', 502);
  return sources.data.site.urls.map(u => siteAddress(u.url).url).filter((u): u is string => !!u).slice(0, 3);
}

/**
 * Pictures on the client's own site: the first two addresses on file. `opened` says whether any of them
 * opened at all, so "none on their site" is never said of a site that did not open.
 */
async function siteCandidates(ctx: UpsellCtx, urls: string[]): Promise<{found: {url: string; width?: number; height?: number}[]; opened: boolean}> {
  const found: {url: string; width?: number; height?: number}[] = [];
  let opened = false;
  for (const url of urls.slice(0, 2)) {
    try {
      const {html, finalUrl} = await checkSite(ctx.web, url);
      if (html && finalUrl) {
        opened = true;
        for (const c of logoCandidates(html, finalUrl)) if (!found.some(o => o.url === c.url)) found.push({url: c.url, width: c.width, height: c.height});
      }
    } catch (error) {
      if (error instanceof UpsellError) throw error;
      // One site not opening leaves the others.
    }
  }
  return {found: found.slice(0, 6), opened};
}

/**
 * Read links signed by the seat's own client: the bucket's read policy rechecks access. A logo Storage did
 * not sign is left out of the map, and the callers say so (a missing reading is never "none"); the failed
 * signing still leaves its receipt.
 */
async function signTray(ctx: UpsellCtx, ads: Ad[]): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();
  if (!ads.length) return byPath;
  const signed = await ctx.store.call('GET', `${LAUNCH_BUCKET}/sign-read`, ads.length === 1 ? ads[0].id : null, async () => {
    const {data, error} = await ctx.client.storage.from(LAUNCH_BUCKET).createSignedUrls(ads.map(a => a.path), LOGO_READ_SECONDS);
    if (error || !Array.isArray(data)) return {status: storageStatus(error), value: []};
    return {status: 200, value: data};
  });
  for (const s of signed) if (!s.error && s.path && typeof s.signedUrl === 'string' && s.signedUrl) byPath.set(s.path, s.signedUrl);
  return byPath;
}

export async function runLogoFind(ctx: UpsellCtx, task: string): Promise<{candidates: LogoFindCandidate[]; note: string | null}> {
  const candidates: LogoFindCandidate[] = [];
  const deck = z.object({logo: z.object({bucket: z.literal('cockpit-client-logos'), path: z.string().regex(/^[A-Za-z0-9._/-]{1,300}$/)}).passthrough().nullable().optional()}).passthrough()
    .safeParse(await ctx.rpc('cockpit_csm_deck_sources', {p_task_id: task}));
  const base = (ctx.env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  if (deck.success && deck.data.logo && base && !deck.data.logo.path.includes('..')) {
    // The verified logos' bucket is public: its address needs no signing.
    candidates.push({source: 'verified', url: `${base}/storage/v1/object/public/cockpit-client-logos/${deck.data.logo.path.split('/').map(encodeURIComponent).join('/')}`});
  }
  const tray = await ctx.rpc('cockpit_csm_launch_ads_read', {p_task_id: task, p_include_hidden: true});
  const logos = (Array.isArray(tray) ? tray : []).filter(r => r && typeof r === 'object' && (r as Record<string, unknown>).kind === 'logo').map(r => checkAd(r, task)).filter(a => a.status === 'ready');
  const signed = await signTray(ctx, logos);
  let unsigned = 0;
  for (const ad of logos) {
    const url = signed.get(ad.path);
    if (url) candidates.push({source: 'upload', url, adId: ad.id, ...(ad.width ? {width: ad.width} : {}), ...(ad.height ? {height: ad.height} : {})});
    else unsigned++;
  }
  const urls = await siteUrls(ctx, task);
  const site = await siteCandidates(ctx, urls);
  for (const c of site.found) {
    candidates.push({source: 'site', url: c.url, ...(c.width ? {width: c.width} : {}), ...(c.height ? {height: c.height} : {})});
  }
  // Each "none" is said only when it was read: tray logos that did not open, no site on file and a site
  // that did not open are each their own sentence.
  const note = unsigned
    ? `${unsigned === 1 ? 'One logo' : `${unsigned} logos`} in the launch tray could not be opened just now. Try again.`
    : candidates.length ? null
    : !urls.length ? 'No logo found: none verified, none in the launch tray, and no website on file. Upload one, or leave the logo off.'
    : !site.opened ? 'No logo found: none verified, none in the launch tray, and their site did not open. Upload one, or leave the logo off.'
    : 'No logo found: none verified, none in the launch tray and none on their site. Upload one, or leave the logo off.';
  return {candidates, note};
}

/** A picture may be picked when it sits on the client's own site (its domain), or the site's page names it. */
async function pickAllowed(ctx: UpsellCtx, task: string, url: URL): Promise<boolean> {
  const urls = await siteUrls(ctx, task);
  const domains = new Set(urls.map(u => siteDomain(new URL(u).hostname)));
  if (domains.has(siteDomain(url.hostname))) return true;
  // Builders keep pictures on their own hosts (Wix, Squarespace, Shopify): the page itself must name it.
  return (await siteCandidates(ctx, urls)).found.some(c => c.url === url.toString());
}

export async function runLogoPick(ctx: UpsellCtx, task: string, raw: string, requestId: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpsellError('Pick one of the pictures found on the client\'s site.');
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new UpsellError('Pick one of the pictures found on the client\'s site.');
  if (!(await pickAllowed(ctx, task, url)))
    throw new UpsellError('Pick a picture found on the client\'s own site. The verified logo and the launch tray\'s logos need no saving.', 400);

  let res: WebResult;
  try {
    res = await ctx.web.get(url.toString(), {purpose: 'logo', maxBytes: LOGO_MAX_BYTES + 1, timeoutMs: 10_000, accept: 'image/png,image/jpeg,image/webp;q=0.9,*/*;q=0.1'});
  } catch (error) {
    if (error instanceof WebError) throw new UpsellError(`That picture could not be read: ${error.message} Pick another one, or upload the logo.`, 502);
    throw error;
  }
  if (res.status !== 200) throw new UpsellError(`The client's site did not give that picture (HTTP ${res.status}). Pick another one, or upload the logo.`, 502);
  if (res.truncated) throw new UpsellError('That logo is over 2 MB. Pick a smaller one, or upload a smaller copy.');
  let checked: {picture: Picture; bytes: Uint8Array};
  try {
    checked = checkLogoBytes(res.body);
  } catch (error) {
    if (error instanceof PictureRefusal) throw new UpsellError(error.message);
    throw error;
  }
  const {picture, bytes} = checked;
  const fileName = `logo-${url.hostname.replace(/^www\./, '')}.${EXT[picture.mime]}`.slice(0, 200);

  let ad = checkAd(await ctx.rpc('cockpit_csm_launch_ad_reserve', {
    p_request_id: requestId, p_task_id: task, p_kind: 'logo', p_mime: picture.mime, p_bytes: bytes.length,
    p_width: picture.width, p_height: picture.height, p_seconds: null, p_file_name: fileName, p_poster_mime: null, p_poster_bytes: null,
  }), task);
  if (ad.kind !== 'logo') throw new UpsellError('The server did not confirm this client\'s logo. Try again.', 502);
  if (ad.status === 'removed') throw new UpsellError('This logo was removed. Pick it again.', 409);
  const objects = ctx.admin.storage.from(LAUNCH_BUCKET);
  if (ad.status === 'uploading') {
    const present = async (label: string) => ctx.store.call('GET', `${LAUNCH_BUCKET}/${label}`, ad.id, async () => {
      const {data, error} = await objects.info(ad.path);
      if (error || !data || typeof data !== 'object') {
        const status = storageStatus(error);
        if (status === 404 || status === 400) return {status, value: null};
        throw new UpsellError('Storage could not be checked just now. Try again.', 502);
      }
      const info = data as Record<string, unknown>;
      const meta = (typeof info.metadata === 'object' && info.metadata ? info.metadata : {}) as Record<string, unknown>;
      return {status: 200, value: {size: Number(info.size ?? meta.size), type: String(info.contentType ?? meta.mimetype ?? '').toLowerCase()}};
    });
    const link = await ctx.store.call('POST', `${LAUNCH_BUCKET}/sign-upload`, ad.id, async () => {
      const {data, error} = await objects.createSignedUploadUrl(ad.path, {upsert: false});
      if (error || !data?.token) return {status: storageStatus(error), value: null};
      return {status: 200, value: data.token};
    });
    if (link) {
      await ctx.store.call('POST', `${LAUNCH_BUCKET}/upload`, ad.id, async () => {
        const {error} = await objects.uploadToSignedUrl(ad.path, link, bytes, {contentType: picture.mime, upsert: false});
        // Storage refuses a second upload of the same object: a retry after a lost answer. The check below decides.
        return {status: error ? storageStatus(error) : 200, value: null};
      });
    }
    const found = await present('verify-object');
    if (!found) throw new UpsellError('The logo did not arrive. Pick it again.', 409);
    if (!Number.isSafeInteger(found.size) || found.size !== ad.bytes || found.type !== ad.mime)
      throw new UpsellError('The saved logo does not match what was reserved. Pick it again.', 409);
    ad = checkAd(await ctx.rpc('cockpit_csm_launch_ad_accept', {p_task_id: task, p_id: ad.id}), task);
    if (ad.status !== 'ready') throw new UpsellError('The server did not confirm the logo. Try again.', 502);
  }
  const signed = await signTray(ctx, [ad]);
  return {...ad, url: signed.get(ad.path) ?? null};
}
