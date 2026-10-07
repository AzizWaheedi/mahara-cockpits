import type { Provider, Row } from './core.ts';
import { isMetaPreviewUrl, PREVIEW_MAX_AGE_MS, type PreviewResult } from '../../../apps/media-buyer-cockpit/src/lib/metaMedia.ts';

const FORMATS = new Set(['MOBILE_FEED_STANDARD', 'DESKTOP_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY', 'INSTAGRAM_REELS', 'FACEBOOK_STORY_MOBILE', 'FACEBOOK_REELS_MOBILE']);
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{5,}$/.test(value)) throw new Error('A valid Meta ad ID is required.');
  return value;
};
export function previewUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !isMetaPreviewUrl(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password && !Array.from(url.searchParams.keys()).some(key => /^(access_token|authorization|api_key|token)$/i.test(key));
}
export function parsePreviewBody(body: unknown): Pick<PreviewResult, 'src' | 'width' | 'height'> {
  if (typeof body !== 'string') return {};
  const iframe = /<iframe\b[^>]*>/i.exec(body)?.[0];
  if (!iframe) return {};
  const src = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(iframe)?.[2]?.replace(/&amp;/g, '&');
  if (!previewUrl(src)) return {};
  const size = (field: string): number | undefined => {
    const text = new RegExp(`\\b${field}\\s*=\\s*(["'])(\\d+)\\1`, 'i').exec(iframe)?.[2];
    const value = text === undefined ? NaN : Number(text);
    return Number.isSafeInteger(value) && value > 0 && value <= 4096 ? value : undefined;
  };
  return { src, width: size('width'), height: size('height') };
}
export function cachedPreview(value: unknown, adId: string, now = Date.now()): PreviewResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Row;
  if (row.ok !== true || row.adId !== adId || !previewUrl(row.src) || typeof row.fetchedAt !== 'number' || typeof row.expiresAt !== 'number') return null;
  if (!Number.isFinite(row.fetchedAt) || !Number.isFinite(row.expiresAt) || row.fetchedAt > now + 60_000 || row.expiresAt <= now || row.expiresAt > row.fetchedAt + PREVIEW_MAX_AGE_MS || row.fetchedAt + PREVIEW_MAX_AGE_MS <= now) return null;
  return { ok: true, adId, src: row.src, accountId: row.accountId, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt,
    ...(typeof row.width === 'number' ? { width: row.width } : {}), ...(typeof row.height === 'number' ? { height: row.height } : {}) };
}
export type NativePreview = { result: PreviewResult; accountId: string; campaignId: string; format: string };
export async function readAdPreview(args: Row, scope: Row, provider: Provider, now: () => number = Date.now): Promise<NativePreview> {
  const adId = id(args.adId);
  const format = args.format === undefined ? 'MOBILE_FEED_STANDARD' : String(args.format);
  if (!FORMATS.has(format)) throw new Error('Unsupported Meta preview format.');
  const object = await provider.call('meta', 'GET', `${adId}?fields=id,account_id,campaign_id`);
  if (String(object.id ?? '') !== adId) throw new Error('Meta returned a different ad.');
  const accountId = id(String(object.account_id ?? ''));
  const campaignId = id(String(object.campaign_id ?? ''));
  if (scope.account && String(scope.account) !== accountId) throw new Error('That ad belongs to another ad account.');
  if (scope.campaign && String(scope.campaign) !== campaignId) throw new Error('That ad belongs to another campaign.');
  const once = async (selected: string) => {
    const answer = await provider.call('meta', 'GET', `${adId}/previews?ad_format=${encodeURIComponent(selected)}`);
    if (!Array.isArray(answer.data)) throw new Error('Meta did not confirm its preview response.');
    return parsePreviewBody(answer.data[0]?.body);
  };
  let parsed: Pick<PreviewResult, 'src' | 'width' | 'height'>;
  try {
    parsed = await once(format);
    if (!parsed.src && format !== 'INSTAGRAM_STANDARD') parsed = await once('INSTAGRAM_STANDARD');
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (format === 'INSTAGRAM_STANDARD' || message.includes('does not exist') || !/ad_format|ad format|format is not supported|placement/.test(message)) throw error;
    parsed = await once('INSTAGRAM_STANDARD');
  }
  const fetchedAt = now();
  const result: PreviewResult = parsed.src
    ? { ok: true, adId, ...parsed, accountId, fetchedAt, expiresAt: fetchedAt + PREVIEW_MAX_AGE_MS }
    : { ok: false, adId, accountId, reason: 'error', message: 'Meta returned no usable live preview. Showing the saved picture.' };
  return { result, accountId, campaignId, format };
}
