import {WebError, type WebGet, type WebResult, webRefusal} from './tools.ts';

/**
 * The website offer's site check (docs/upsell-studio/EDGE.md section 2).
 *
 * One address at a time, as an anonymous visitor through tools.ts webTools:
 * the page's own words decide parked, expired or empty before its HTTP status
 * does, so a parked page that answers 200 is parked and a Wix page that
 * answers 404 is "not published". Nothing here writes; upsell.ts records each
 * result through cockpit_client_site_check_record, as the signed-in seat.
 *
 * Statuses (the table's own list): ok, parked, expired, dns, tls,
 * http_error, timeout, redirect_offsite, instagram, empty, refused. `refused`
 * means the check was not made (the address is not one webTools reads) or the
 * site turned the automatic check away (401, 403, 406, 429 or a bot check),
 * and counts for neither verdict: missing is never a failure.
 */
export const SITE_STATUSES = ['ok', 'parked', 'expired', 'dns', 'tls', 'http_error', 'timeout', 'redirect_offsite', 'instagram', 'empty', 'refused'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];
export type SiteResult = {status: SiteStatus; httpStatus: number | null; finalUrl: string | null; title: string | null; note: string};
export type LogoCandidate = {url: string; kind: 'og' | 'apple' | 'icon' | 'header'; width?: number; height?: number};

export const SITE_MAX_BYTES = 1_500_000;
export const SITE_TIMEOUT_MS = 12_000;
const INSTAGRAM = /^(?:www\.|m\.)?(?:instagram\.com|instagr\.am)$/;
/** Where an address may land that is not a website of the client's own: link pages, social profiles, chat links, a registrar's or builder's home page. */
const NOT_A_SITE = /^(?:www\.|m\.)?(?:linktr\.ee|beacons\.ai|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|snapchat\.com|wa\.me|api\.whatsapp\.com|youtube\.com|godaddy\.com|namecheap\.com|wix\.com|squarespace\.com)$/;
/** The statuses a site uses to turn an automatic visitor away; they say nothing about whether people can open it. */
const TURNED_AWAY = new Set([401, 403, 406, 429]);
/** The smallest logo the pick takes (LOGO_MIN_SIDE in upsellLogo.ts; importing it here would make a cycle). */
const LOGO_MIN = 64;

/**
 * An address on file as a URL to check: a bare "example.com" gets https://.
 * Null with a sentence when it is not a web address at all ("N/A", "no site").
 */
export function siteAddress(raw: string): {url: string | null; problem: string | null} {
  const v = raw.trim();
  if (!v) return {url: null, problem: 'No address was given.'};
  if (v.length > 300) return {url: null, problem: 'The address is over 300 characters. Fix it on the card or in prep.'};
  if (/\s/.test(v)) return {url: null, problem: `"${v.slice(0, 60)}" is not a web address. Fix it on the card or in prep.`};
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return {url: null, problem: `"${v.slice(0, 60)}" is not a web address. Fix it on the card or in prep.`};
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return {url: null, problem: 'Only http and https addresses can be checked. Fix it on the card or in prep.'};
  // "N/A", "none" or "soon" on the card: a word, not a site. "mailto:x@y.com" reads as a user and a host.
  if (!u.hostname.includes('.') || u.username || u.password) return {url: null, problem: `"${v.slice(0, 60)}" is not a web address. Fix it on the card or in prep.`};
  return {url: withScheme, problem: null};
}

export function isInstagram(host: string): boolean {
  return INSTAGRAM.test(host.toLowerCase().replace(/\.$/, ''));
}

/** The registrable part of a host, near enough: example.com, example.com.kw, example.co.uk. */
export function siteDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const second = labels[labels.length - 2];
  const top = labels[labels.length - 1];
  const keep = top.length === 2 && /^(com|net|org|co|gov|edu|ac|sch|med|ltd|plc|biz|info|name)$/.test(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'"};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}|#39);/gi, (all, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    const n = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : lower.startsWith('#') ? Number(lower.slice(1)) : Number.NaN;
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  });
}

/** The page's text as the browser would decode it: the declared charset when the runtime knows it, else UTF-8. */
export function pageText(body: Uint8Array, headers: Headers | null): string {
  const declared = /charset=["']?([A-Za-z0-9_-]{2,40})/i.exec(headers?.get('content-type') ?? '')?.[1];
  const sniffed = declared ?? /<meta[^>]+charset=["']?([A-Za-z0-9_-]{2,40})/i.exec(new TextDecoder('latin1').decode(body.subarray(0, 4096)))?.[1];
  try {
    return new TextDecoder(sniffed ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** The page's <title>, one line, at most 200 characters; null when it has none. */
export function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,2000}?)<\/title>/i.exec(html);
  if (!m) return null;
  // Control, direction and invisible marks become spaces; the table refuses them.
  const t = decodeEntities(m[1])
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.slice(0, 200) : null;
}

/** What a person would read: no scripts, styles, tags or entities. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// The page's own words. Each list is matched against the raw HTML (scripts,
// links and markup included), lower-cased, within the first 1.5 MB.
const PARKED = [
  /sedoparking\.com|sedo\.com\/(?:search|checkout)|parkingcrew\.net|bodis\.com|above\.com\/marketplace|parklogic|domainparking|dsparking|\/parking-lander\/|wsimg\.com\/parking|afternic\.com|hugedomains\.com|undeveloped\.com|dan\.com\/(?:buy-domain|lander)|domainmarket\.com|sav\.com\/(?:domain|lander)|namecheap\.com\/(?:domains\/)?(?:marketplace|parking)|parkingpage\.namecheap\.com/,
  /\b(?:this|the) domain(?: name)?(?: [a-z0-9.-]{1,80})? (?:is|may be) for sale\b/,
  /\bbuy this domain\b|\bget this domain\b|\bthis domain is parked\b|\bthis (?:web )?page is parked\b|\bparked free\b|\bcourtesy of godaddy\b|\bdomain (?:is )?parked\b/,
];
const EXPIRED = [
  /\bwebsite (?:has )?expired\b|\bthis (?:website|site|domain) (?:has )?expired\b|\bsite (?:is )?no longer available\b|\bsubscription (?:has )?expired\b/,
  /\bsite (?:was|is|has been) (?:not |un)published\b|\bisn['\u2019]?t connected to a website yet\b|\bnot connected to a website\b|\bthis site is not published\b/,
  /\b(?:this )?account (?:has been )?suspended\b|\bthis (?:store|shop) is (?:currently )?unavailable\b|\bstore is unavailable\b/,
];
const DEFAULT_PAGE =
  /default web site page|there is no website configured at this address|if you are the owner of this website, please contact your hosting provider|welcome to nginx!|apache2 (?:ubuntu|debian) default page|test page for the (?:apache|nginx)|<title>\s*index of \/|<title>\s*iis windows server|<h1>\s*it works!\s*<\/h1>|cpanel[^<]{0,80}(?:default|placeholder) page/;
const COMING_SOON = /\b(?:coming soon|under construction|launching soon|site is being built|website is being built)\b|قريبا|قريباً|تحت الإنشاء|تحت الانشاء/;
// A bot check's own page. Cloudflare's script for its JS detections (/cdn-cgi/challenge-platform/scripts/jsd/)
// sits on ordinary working pages too, so only the challenge page's own markers count.
const CHALLENGE = /challenge-platform\/h\/|orchestrate\/(?:chl|managed|jsch)_|cf-chl-|cf_chl_opt|<title>\s*(?:just a moment\.\.\.|attention required! \| cloudflare|ddos-guard)|\.well-known\/ddos-guard\//;

const note = (s: SiteStatus, http: number | null, finalHost: string | null): string =>
  ({
    ok: 'The site opened.',
    parked: 'The domain shows a parking or for-sale page.',
    expired: 'The site\'s plan has expired or the site is not published.',
    dns: 'The address does not exist (no DNS record).',
    tls: 'The site\'s security certificate failed.',
    http_error: http ? `The site answered with an error (HTTP ${http}).` : 'The site could not be reached.',
    timeout: 'The site did not answer within 12 seconds.',
    redirect_offsite: finalHost ? `The address sends visitors to another site (${finalHost}).` : 'The address sends visitors to another site.',
    instagram: 'The address is an Instagram page, not a website.',
    empty: 'The site has no content: a blank, default or "coming soon" page.',
    refused: 'The address was not checked.',
  })[s];

/** Where the check ended, without its query or fragment (they can carry tokens). */
function finalOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

/** One check's verdict from what webTools answered (a page, or the error it threw). */
export function classifySite(start: string, out: WebResult | WebError | unknown): SiteResult {
  const startHost = (() => {
    try {
      return new URL(start).hostname;
    } catch {
      return '';
    }
  })();
  if (isInstagram(startHost)) return {status: 'instagram', httpStatus: null, finalUrl: finalOf(start), title: null, note: note('instagram', null, null)};
  if (out instanceof WebError) {
    // Refused at a later hop on another host: the site sends visitors somewhere webTools will not follow.
    const refusedHost = (() => {
      try {
        return out.url ? new URL(out.url).hostname : startHost;
      } catch {
        return startHost;
      }
    })();
    const status: SiteStatus =
      out.kind === 'refused' ? (refusedHost !== startHost && webRefusal(start, 'site') === null ? 'redirect_offsite' : 'refused')
      : out.kind === 'redirects' || out.kind === 'network' ? 'http_error'
      : out.kind;
    // A refused address on file is fixed where it came from; a refusal at a later hop (where the site sends
    // visitors) is the site's own doing, so a capture from a browser is the way forward.
    const refusedNote = webRefusal(start, 'site') !== null ? `${out.message} Fix it on the card or in prep.` : `${out.message} Open it in a browser and take a capture.`;
    const said =
      out.kind === 'redirects' ? 'The address redirects more than 5 times, so the check never reached a page. Open it in a browser and take a capture.'
      : status === 'refused' ? refusedNote
      : note(status, null, null);
    return {status, httpStatus: null, finalUrl: finalOf(out.url), title: null, note: said};
  }
  if (!out || typeof out !== 'object' || !('status' in out) || !('body' in out)) {
    return {status: 'http_error', httpStatus: null, finalUrl: null, title: null, note: note('http_error', null, null)};
  }
  const res = out as WebResult;
  const finalHost = (() => {
    try {
      return new URL(res.finalUrl).hostname;
    } catch {
      return '';
    }
  })();
  const html = pageText(res.body, res.headers);
  const lower = html.toLowerCase();
  const title = pageTitle(html);
  const made = (status: SiteStatus): SiteResult => ({status, httpStatus: res.status, finalUrl: finalOf(res.finalUrl), title, note: note(status, res.status, finalHost)});

  if (isInstagram(finalHost)) return made('instagram');
  if (PARKED.some(re => re.test(lower))) return made('parked');
  if (EXPIRED.some(re => re.test(lower))) return made('expired');
  // Sent to another domain: a link page or a social profile is not a site, whatever it answered.
  const offsite = !!startHost && !!finalHost && siteDomain(startHost) !== siteDomain(finalHost);
  if (offsite && NOT_A_SITE.test(finalHost)) return made('redirect_offsite');
  // Turned away (a firewall, a bot check, a login): the check saw nothing, so it is neither working nor broken.
  if (TURNED_AWAY.has(res.status) || res.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' || CHALLENGE.test(lower))
    return {
      ...made('refused'),
      // A bot check can answer 200: then the status says nothing, and the sentence does not quote it.
      note: res.status >= 400
        ? `The site turned the automatic check away (HTTP ${res.status}). Open it in a browser and take a capture.`
        : 'The site showed a bot check instead of its page. Open it in a browser and take a capture.',
    };
  if (res.status >= 400) return made('http_error');
  if (res.status >= 300) return made('http_error');
  if (DEFAULT_PAGE.test(lower)) return made('empty');
  const text = visibleText(html);
  // "Coming soon" as the page's own headline on a short page; a site that mentions what is coming soon is not empty.
  const headlines = [title ?? '', ...(html.match(/<h[12]\b[^>]*>[\s\S]{0,300}?<\/h[12]>/gi) ?? []).map(visibleText)].join(' ').toLowerCase();
  if (text.length < 400 && COMING_SOON.test(headlines)) return made('empty');
  const hasMedia = /<(?:script[^>]+src|img|video|iframe|picture)\b/i.test(html);
  if (!text && !hasMedia) return made('empty');
  // The client's other domain (a country domain, a rebrand) that opened is their site.
  if (offsite) return {...made('ok'), note: `The address sends visitors to ${finalHost}, which opened.`};
  return made('ok');
}

/** The value of one attribute in a tag, entities decoded. */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
  return v === null ? null : decodeEntities(v).trim();
}
const dims = (s: string | null): {width?: number; height?: number} => {
  const m = /^(\d{1,5})x(\d{1,5})$/i.exec((s ?? '').trim().split(/\s+/).pop() ?? '');
  return m ? {width: Number(m[1]), height: Number(m[2])} : {};
};
const num = (s: string | null): number | undefined => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : undefined;
};

/**
 * Logo candidates on the client's own page: a header or "logo" picture, the
 * Apple touch icon, the og:image and the icons. SVG, ICO and GIF files are
 * skipped (the pick refuses them), and so is an icon whose declared size is
 * under 64 pixels a side (the pick refuses that too). An http picture is
 * asked for over https, and each address is absolute. At most 8, best first.
 */
export function logoCandidates(html: string, base: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null, kind: LogoCandidate['kind'], size: {width?: number; height?: number} = {}, type: string | null = null) => {
    if (!raw || raw.startsWith('data:') || out.length >= 8) return;
    if (type && !/^image\/(png|jpe?g|webp)$/i.test(type.trim())) return;
    // Only an icon's declared `sizes` count: an <img> width is the size it is drawn at, not the picture's own.
    if ((kind === 'icon' || kind === 'apple') && ((size.width !== undefined && size.width < LOGO_MIN) || (size.height !== undefined && size.height < LOGO_MIN))) return;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      return;
    }
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:' || webRefusal(u, 'logo') !== null) return;
    if (/\.(svg|svgz|ico|gif|bmp|tiff?|avif|heic)$/i.test(u.pathname)) return;
    const key = u.toString();
    if (key.length > 2000 || seen.has(key)) return;
    seen.add(key);
    out.push({url: key, kind, ...(size.width ? {width: size.width} : {}), ...(size.height ? {height: size.height} : {})});
  };
  const head = html.slice(0, 600_000);
  // Header pictures first: the first images inside <header>, then any image named a logo.
  const header = /<header\b[\s\S]{0,40000}?<\/header>/i.exec(head)?.[0] ?? '';
  for (const tag of (header.match(/<img\b[^>]*>/gi) ?? []).slice(0, 2)) {
    add(attr(tag, 'src') ?? attr(tag, 'data-src'), 'header', {width: num(attr(tag, 'width')), height: num(attr(tag, 'height'))});
  }
  for (const tag of (head.match(/<img\b[^>]*>/gi) ?? []).filter(t => /logo/i.test(t)).slice(0, 2)) {
    add(attr(tag, 'src') ?? attr(tag, 'data-src'), 'header', {width: num(attr(tag, 'width')), height: num(attr(tag, 'height'))});
  }
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of links.filter(t => /rel\s*=\s*["']?[^"'>]*apple-touch-icon/i.test(t))) add(attr(tag, 'href'), 'apple', dims(attr(tag, 'sizes')), attr(tag, 'type'));
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (name: string) => metas.find(t => new RegExp(`(?:property|name)\\s*=\\s*["']?${name.replace(/[.:]/g, '\\$&')}["'\\s>]`, 'i').test(t));
  const og = meta('og:image:secure_url') ?? meta('og:image');
  if (og) add(attr(og, 'content'), 'og', {width: num(attr(meta('og:image:width') ?? '', 'content')), height: num(attr(meta('og:image:height') ?? '', 'content'))}, attr(meta('og:image:type') ?? '', 'content'));
  for (const tag of links.filter(t => /rel\s*=\s*["']?(?:shortcut )?icon\b/i.test(t))) add(attr(tag, 'href'), 'icon', dims(attr(tag, 'sizes')), attr(tag, 'type'));
  return out;
}

/** One address checked: the result, plus the page's HTML when it opened (for logo candidates). */
export async function checkSite(web: {get: WebGet}, url: string): Promise<{result: SiteResult; html: string | null; finalUrl: string | null}> {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // classifySite says so.
  }
  // An Instagram page is not fetched: it is not a website, and Instagram turns automated visits away.
  if (isInstagram(host)) return {result: classifySite(url, null), html: null, finalUrl: null};
  let out: WebResult | WebError;
  try {
    out = await web.get(url, {purpose: 'site', maxBytes: SITE_MAX_BYTES, timeoutMs: SITE_TIMEOUT_MS, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'});
  } catch (error) {
    if (!(error instanceof WebError)) throw error;
    out = error;
  }
  const result = classifySite(url, out);
  const html = !(out instanceof WebError) && result.status === 'ok' ? pageText(out.body, out.headers) : null;
  return {result, html, finalUrl: out instanceof WebError ? null : out.finalUrl};
}
