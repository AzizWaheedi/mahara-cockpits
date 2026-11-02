import {WebError, type WebGet, type WebResult} from './tools.ts';

/**
 * The anonymous video check for a proposal's own video (docs/upsell-studio/EDGE.md section 3).
 *
 * The link is parsed first by parseVideoLink, the decks' own rule
 * (cockpit_csm_deck_video_parse) line for line, so only the five providers
 * reach here, in their canonical form. The database parser is granted to
 * nobody, so the seat cannot call it; upsellVideo.test.ts runs both on the
 * same links in PGlite and they must agree, and the proposal's save parses
 * the link again in the database. Then one anonymous read, as a client would open it:
 * oEmbed for YouTube, Vimeo, Loom and Wistia (401 or 403 means private, or
 * for YouTube private or not embeddable; 404 means not found), and a
 * cookieless thumbnail read for Drive (a redirect to Google's sign-in, 401,
 * 403 or 404 means private). Vimeo is asked with offer.maharamedia.com as the
 * referring page, so a video locked to other sites says so. The poster comes
 * only from the decks' four poster hosts, and only when it is a picture.
 */
export const PRIVATE_SENTENCE = 'This video is private. Set it to anyone with the link.';
/** YouTube's oEmbed answers 401 or 403 for a private video and for one whose owner turned embedding off: neither plays on the page. */
export const YOUTUBE_PRIVATE_SENTENCE = 'This YouTube video is private or does not allow embedding. Set it to Unlisted and turn on Allow embedding.';
/** A 404 from oEmbed: deleted, a wrong link, or (for some providers) private. */
export const NOT_FOUND_SENTENCE = 'This video was not found. It may be private or deleted. Set it to anyone with the link, or paste another link.';
export const VIMEO_DOMAIN_SENTENCE = 'This Vimeo video plays only on certain sites. Add offer.maharamedia.com to its allowed domains.';
export const OFFER_ORIGIN = 'https://offer.maharamedia.com/';
export const POSTER_HOSTS: Record<string, string> = {loom: 'cdn.loom.com', wistia: 'embed-ssl.wistia.com', vimeo: 'i.vimeocdn.com', youtube: 'i.ytimg.com'};
const PROVIDER_NAME: Record<string, string> = {loom: 'Loom', youtube: 'YouTube', wistia: 'Wistia', vimeo: 'Vimeo', drive: 'Google Drive'};
// The table's own rule for a poster (20261020160200_csm_deck_video_posters.sql).
const POSTER_RE = /^https:\/\/(cdn[.]loom[.]com|embed-ssl[.]wistia[.]com|i[.]vimeocdn[.]com|i[.]ytimg[.]com)\/[A-Za-z0-9/_.~%=&?:+-]+$/;
const OEMBED_MAX_BYTES = 65_536;
const TIMEOUT_MS = 10_000;

export type ParsedVideo = {provider: 'loom' | 'youtube' | 'wistia' | 'vimeo' | 'drive'; url: string; embedUrl: string};
export type VideoCheck = {
  ok: boolean;
  provider: ParsedVideo['provider'] | null;
  url: string | null;
  embedUrl: string | null;
  title: string | null;
  durationSeconds: number | null;
  posterUrl: string | null;
  refusal?: string;
};

export const VIDEO_HOSTS_SENTENCE = 'Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.';

/**
 * cockpit_csm_deck_video_parse (20261020120000_csm_deck_videos.sql), line for
 * line: the provider, the canonical page link and the player link, or the
 * parser's own sentence. Hosts are matched by equality (or the one anchored
 * Wistia account pattern), ids by anchored patterns, and both links are built
 * only from constants and the captured ids. Kept equal to the SQL by the
 * PGlite comparison in upsellVideo.test.ts.
 */
export function parseVideoLink(raw: string): {ok: true; video: ParsedVideo} | {ok: false; refusal: string} {
  const no = (refusal: string) => ({ok: false as const, refusal});
  // btrim: spaces only, as the SQL does (a tab stays and is refused below).
  const v = (raw ?? '').replace(/^ +| +$/g, '');
  if (!v) return no(VIDEO_HOSTS_SENTENCE);
  if (v.length > 500) return no('That link is too long. Copy the video\'s share link.');
  if (/^http:\/\//i.test(v)) return no('Use the https link.');
  // Not https, anything outside printable ASCII, or a backslash.
  if (!/^https:\/\//i.test(v) || !/^[!-~]+$/.test(v) || v.includes('\\')) return no(VIDEO_HOSTS_SENTENCE);
  const m = /^[Hh][Tt][Tt][Pp][Ss]:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(v);
  // A user, a port or an encoded host.
  if (!m || /[@:%]/.test(m[1])) return no(VIDEO_HOSTS_SENTENCE);
  const h = m[1].toLowerCase();
  const p = m[2] ?? '';
  const q = m[3] ?? ''; // with its '?'; the fragment is dropped
  let name = '';
  let provider: ParsedVideo['provider'];
  let url: string | null = null;
  let embedUrl: string | null = null;

  if (h === 'www.loom.com' || h === 'loom.com') {
    provider = 'loom';
    name = 'Loom';
    const x = /^\/(?:share|embed)\/(?:[A-Za-z0-9-]{1,200}-)?([0-9a-f]{32})\/?$/.exec(p);
    if (x) {
      url = `https://www.loom.com/share/${x[1]}`;
      embedUrl = `https://www.loom.com/embed/${x[1]}?hideEmbedTopBar=true`;
    }
  } else if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(h)) {
    provider = 'youtube';
    name = 'YouTube';
    let id: string | undefined;
    if (h === 'youtu.be') id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(p)?.[1];
    else if (h === 'www.youtube-nocookie.com') id = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(p)?.[1];
    else if (/^\/watch\/?$/.test(p)) id = /(?:^\?|&)v=([A-Za-z0-9_-]{11})(?:&|$)/.exec(q)?.[1];
    else id = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(p)?.[1];
    if (id) {
      // The start: plain seconds, else hours, minutes and seconds; kept only between 1 second and 12 hours.
      let start: number | null = null;
      const plain = /(?:^\?|&)(?:t|start)=([0-9]{1,5})s?(?:&|$)/.exec(q);
      if (plain) start = Number(plain[1]);
      else {
        const t = /(?:^\?|&)t=(?:([0-9]{1,2})h)?(?:([0-9]{1,3})m)?(?:([0-9]{1,5})s)?(?:&|$)/.exec(q);
        if (t) start = Number(t[1] ?? 0) * 3600 + Number(t[2] ?? 0) * 60 + Number(t[3] ?? 0);
      }
      if (start !== null && !(start >= 1 && start <= 43200)) start = null;
      url = `https://www.youtube.com/watch?v=${id}${start === null ? '' : `&t=${start}`}`;
      embedUrl = `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1${start === null ? '' : `&start=${start}`}`;
    }
  } else if (h === 'fast.wistia.net' || /^[a-z0-9-]{1,63}\.wistia\.com$/.test(h)) {
    provider = 'wistia';
    name = 'Wistia';
    const x = h === 'fast.wistia.net' ? /^\/embed\/iframe\/([a-z0-9]{10})\/?$/.exec(p) : /^\/medias\/([a-z0-9]{10})\/?$/.exec(p);
    if (x) {
      url = `https://fast.wistia.net/embed/iframe/${x[1]}`;
      embedUrl = `https://fast.wistia.net/embed/iframe/${x[1]}?seo=false`;
    }
  } else if (h === 'vimeo.com' || h === 'www.vimeo.com' || h === 'player.vimeo.com') {
    provider = 'vimeo';
    name = 'Vimeo';
    let id: string | undefined;
    let extra: string | undefined;
    if (h === 'player.vimeo.com') {
      id = /^\/video\/([0-9]{6,12})\/?$/.exec(p)?.[1];
      extra = /(?:^\?|&)h=([0-9a-f]{6,20})(?:&|$)/.exec(q)?.[1];
    } else {
      const x = /^\/([0-9]{6,12})(?:\/([0-9a-f]{6,20}))?\/?$/.exec(p);
      id = x?.[1];
      extra = x?.[2];
    }
    if (id) {
      url = `https://vimeo.com/${id}${extra ? `/${extra}` : ''}`;
      embedUrl = `https://player.vimeo.com/video/${id}?dnt=1${extra ? `&h=${extra}` : ''}`;
    }
  } else if (h === 'drive.google.com') {
    provider = 'drive';
    name = 'Drive';
    if (/^\/drive\/(?:u\/[0-9]+\/)?folders\//.test(p)) return no('That Drive link is a folder. Paste the link to the video file.');
    const x = /^\/file\/d\/([A-Za-z0-9_-]{20,100})(?:\/(?:view|preview))?\/?$/.exec(p);
    if (x) {
      // Files shared before Google's 2021 security update need their key.
      const key = /(?:^\?|&)resourcekey=([A-Za-z0-9_-]{1,100})(?:&|$)/.exec(q)?.[1];
      url = `https://drive.google.com/file/d/${x[1]}/view${key ? `?resourcekey=${key}` : ''}`;
      embedUrl = `https://drive.google.com/file/d/${x[1]}/preview${key ? `?resourcekey=${key}` : ''}`;
    }
  } else {
    return no(VIDEO_HOSTS_SENTENCE);
  }
  if (!url || !embedUrl) return no(`That ${name} link has no video in it. Copy the video's share link.`);
  return {ok: true, video: {provider, url, embedUrl}};
}

export function oembedUrl(v: ParsedVideo): string | null {
  const q = encodeURIComponent(v.url);
  switch (v.provider) {
    case 'loom':
      return `https://www.loom.com/v1/oembed?url=${q}`;
    case 'wistia':
      return `https://fast.wistia.com/oembed?url=${q}`;
    case 'youtube':
      return `https://www.youtube.com/oembed?format=json&url=${q}`;
    case 'vimeo':
      return `https://vimeo.com/api/oembed.json?url=${q}`;
    default:
      return null;
  }
}

/** The Drive file id and resource key in a parsed Drive link. */
export function driveFile(url: string): {id: string; resourceKey: string | null} | null {
  const m = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,100})\/view(?:\?resourcekey=([A-Za-z0-9_-]{1,100}))?$/.exec(url);
  return m ? {id: m[1], resourceKey: m[2] ?? null} : null;
}

/** An oEmbed thumbnail the decks allow as a poster (a Loom GIF becomes its JPEG still), else null. */
export function posterOf(provider: string, thumb: unknown): string | null {
  if (typeof thumb !== 'string' || thumb.length > 500) return null;
  let t = thumb.trim();
  if (provider === 'loom' && t.endsWith('.gif')) t = `${t.slice(0, -4)}.jpg`;
  const host = POSTER_HOSTS[provider];
  const m = POSTER_RE.exec(t);
  return host && m && m[1] === host ? t : null;
}

/** A title the proposal may keep: one line, no control or direction marks, at most 40 characters at a word end. */
export function videoTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  if (t.length <= 40) return t;
  const cut = t.slice(0, 40);
  const space = cut.lastIndexOf(' ');
  return (space >= 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, '');
}

const seconds = (raw: unknown): number | null => {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 10800 ? n : null;
};

function refused(v: ParsedVideo, refusal: string): VideoCheck {
  return {ok: false, provider: v.provider, url: v.url, embedUrl: v.embedUrl, title: null, durationSeconds: null, posterUrl: null, refusal};
}
const unreachable = (v: ParsedVideo) => `${PROVIDER_NAME[v.provider] ?? 'The video site'} did not answer just now, so the link is not checked. Try again in a minute.`;

/** The poster must be a picture: one small read checks its type. Any failure leaves it out. */
async function checkedPoster(web: {get: WebGet}, url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await web.get(url, {purpose: 'thumbnail', maxBytes: 4096, timeoutMs: 6000, accept: 'image/*'});
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return res.status === 200 && ['image/jpeg', 'image/png', 'image/webp'].includes(type) && res.redirects.length === 0 ? url : null;
  } catch {
    return null;
  }
}

export async function checkVideo(web: {get: WebGet}, v: ParsedVideo): Promise<VideoCheck> {
  if (v.provider === 'drive') {
    const file = driveFile(v.url);
    if (!file) return refused(v, 'That Drive link has no video in it. Copy the video\'s share link.');
    const thumb = `https://drive.google.com/thumbnail?id=${file.id}&sz=w640${file.resourceKey ? `&resourcekey=${file.resourceKey}` : ''}`;
    try {
      const res = await web.get(thumb, {purpose: 'thumbnail', maxBytes: 262_144, timeoutMs: TIMEOUT_MS, accept: 'image/*'});
      const signIn = [...res.redirects, res.finalUrl].some(u => /^https:\/\/accounts\.google\.com\//i.test(u));
      if (signIn || res.status === 401 || res.status === 403 || res.status === 404) return refused(v, PRIVATE_SENTENCE);
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (res.status !== 200 || !type.startsWith('image/')) return refused(v, unreachable(v));
      return {ok: true, provider: v.provider, url: v.url, embedUrl: v.embedUrl, title: null, durationSeconds: null, posterUrl: null};
    } catch (error) {
      if (error instanceof WebError) return refused(v, unreachable(v));
      throw error;
    }
  }

  const ask = oembedUrl(v);
  if (!ask) return refused(v, 'Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.');
  let res: WebResult;
  try {
    res = await web.get(ask, {purpose: 'oembed', maxBytes: OEMBED_MAX_BYTES, timeoutMs: TIMEOUT_MS, accept: 'application/json', referer: v.provider === 'vimeo' ? OFFER_ORIGIN : undefined});
  } catch (error) {
    if (error instanceof WebError) return refused(v, unreachable(v));
    throw error;
  }
  if (v.provider === 'youtube' && (res.status === 401 || res.status === 403)) return refused(v, YOUTUBE_PRIVATE_SENTENCE);
  if (res.status === 404) return refused(v, NOT_FOUND_SENTENCE);
  if (res.status === 401 || res.status === 403) return refused(v, PRIVATE_SENTENCE);
  if (res.status !== 200 || res.truncated) return refused(v, unreachable(v));
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(res.body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('not an object');
    data = parsed as Record<string, unknown>;
  } catch {
    return refused(v, unreachable(v));
  }
  // Vimeo answers 200 for a video locked to other sites, with the lock in domain_status_code.
  if (v.provider === 'vimeo' && Number(data.domain_status_code) === 403) return refused(v, VIMEO_DOMAIN_SENTENCE);
  return {
    ok: true,
    provider: v.provider,
    url: v.url,
    embedUrl: v.embedUrl,
    title: videoTitle(data.title),
    durationSeconds: seconds(data.duration),
    posterUrl: await checkedPoster(web, posterOf(v.provider, data.thumbnail_url)),
  };
}
