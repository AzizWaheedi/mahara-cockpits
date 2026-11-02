import {describe, expect, test} from 'bun:test';
import {cockpitTestDb, migration} from '../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import {webTools} from './tools.ts';
import {
  checkVideo, driveFile, NOT_FOUND_SENTENCE, oembedUrl, type ParsedVideo, PRIVATE_SENTENCE, parseVideoLink, posterOf, VIDEO_HOSTS_SENTENCE, VIMEO_DOMAIN_SENTENCE, videoTitle,
  YOUTUBE_PRIVATE_SENTENCE,
} from './upsellVideo.ts';

// The anonymous video check against a mocked fetch. The links come in as
// cockpit_csm_deck_video_parse returns them (canonical url and embedUrl).

const V: Record<string, ParsedVideo> = {
  youtube: {provider: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&playsinline=1&enablejsapi=1'},
  vimeo: {provider: 'vimeo', url: 'https://vimeo.com/123456789/abcdef1234', embedUrl: 'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234'},
  loom: {provider: 'loom', url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef', embedUrl: 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef?hideEmbedTopBar=true'},
  wistia: {provider: 'wistia', url: 'https://fast.wistia.net/embed/iframe/abc123defg', embedUrl: 'https://fast.wistia.net/embed/iframe/abc123defg?seo=false'},
  drive: {provider: 'drive', url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', embedUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview'},
};
const THUMB: Record<string, string> = {
  youtube: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  vimeo: 'https://i.vimeocdn.com/video/1234567-abcdef_640',
  loom: 'https://cdn.loom.com/sessions/thumbnails/0123456789abcdef0123456789abcdef-with-play.gif',
  wistia: 'https://embed-ssl.wistia.com/deliveries/0a1b2c3d4e5f.jpg?image_crop_resized=960x540',
};

type Answer = {status: number; headers?: Record<string, string>; body?: string} | Error;
function harness(routes: Record<string, Answer>) {
  const calls: {url: string; init: RequestInit}[] = [];
  const request = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({url, init});
    const a = routes[url];
    if (!a) throw new TypeError('client error (Connect): tcp connect error: Connection refused');
    if (a instanceof Error) throw a;
    return new Response(a.body ?? null, {status: a.status, headers: a.headers});
  }) as typeof fetch;
  const rows: Record<string, unknown>[] = [];
  return {web: webTools(async row => {
    rows.push(row);
  }, request, async () => ['93.184.216.34']), calls, rows};
}
const picture = {status: 200, headers: {'content-type': 'image/jpeg'}, body: 'jpeg'};

describe('oEmbed providers', () => {
  for (const provider of ['youtube', 'vimeo', 'loom', 'wistia'] as const) {
    test(`${provider}: a public video is ok, with its title, length and poster`, async () => {
      const v = V[provider];
      const ask = oembedUrl(v) as string;
      const poster = provider === 'loom' ? THUMB.loom.replace(/\.gif$/, '.jpg') : THUMB[provider];
      const h = harness({
        [ask]: {status: 200, headers: {'content-type': 'application/json'}, body: JSON.stringify({title: 'The website we build for you', duration: 61.4, thumbnail_url: THUMB[provider]})},
        [poster]: picture,
      });
      const out = await checkVideo(h.web, v);
      expect(out).toEqual({ok: true, provider, url: v.url, embedUrl: v.embedUrl, title: 'The website we build for you', durationSeconds: 61, posterUrl: poster});
      expect(h.rows.every(r => r.resource === `oembed:${new URL(ask).hostname}` || String(r.resource).startsWith('thumbnail:'))).toBe(true);
    });

    for (const status of [401, 403, 404]) {
      // 401 and 403 are private (YouTube: private, or embedding turned off); 404 is not found, which may be private or deleted.
      const sentence = status === 404 ? NOT_FOUND_SENTENCE : provider === 'youtube' ? YOUTUBE_PRIVATE_SENTENCE : PRIVATE_SENTENCE;
      test(`${provider}: ${status} is refused with the exact sentence`, async () => {
        const h = harness({[oembedUrl(V[provider]) as string]: {status, body: 'Unauthorized'}});
        const out = await checkVideo(h.web, V[provider]);
        expect(out).toEqual({ok: false, provider, url: V[provider].url, embedUrl: V[provider].embedUrl, title: null, durationSeconds: null, posterUrl: null, refusal: sentence});
        expect(PRIVATE_SENTENCE).toBe('This video is private. Set it to anyone with the link.');
        expect(YOUTUBE_PRIVATE_SENTENCE).toBe('This YouTube video is private or does not allow embedding. Set it to Unlisted and turn on Allow embedding.');
        expect(NOT_FOUND_SENTENCE).toBe('This video was not found. It may be private or deleted. Set it to anyone with the link, or paste another link.');
      });
    }
  }

  test('a provider that is down, or answers something unreadable, is not called private', async () => {
    for (const answer of [{status: 500, body: 'oops'}, {status: 200, body: '<html>not json</html>'}, new TypeError('connection reset')] as Answer[]) {
      const h = harness({[oembedUrl(V.youtube) as string]: answer});
      const out = await checkVideo(h.web, V.youtube);
      expect(out.ok).toBe(false);
      expect(out.refusal).toBe('YouTube did not answer just now, so the link is not checked. Try again in a minute.');
    }
  });

  test('Vimeo is asked as the offer page; a video locked to other sites says how to fix it', async () => {
    const ask = oembedUrl(V.vimeo) as string;
    const h = harness({[ask]: {status: 200, body: JSON.stringify({title: 'Locked', domain_status_code: 403, thumbnail_url: THUMB.vimeo})}});
    const out = await checkVideo(h.web, V.vimeo);
    expect([out.ok, out.refusal]).toEqual([false, VIMEO_DOMAIN_SENTENCE]);
    expect(VIMEO_DOMAIN_SENTENCE).toBe('This Vimeo video plays only on certain sites. Add offer.maharamedia.com to its allowed domains.');
    expect((h.calls[0].init.headers as Record<string, string>).Referer).toBe('https://offer.maharamedia.com/');
    // Other providers are asked with no referring page.
    const y = harness({[oembedUrl(V.youtube) as string]: {status: 404}});
    await checkVideo(y.web, V.youtube);
    expect((y.calls[0].init.headers as Record<string, string>).Referer).toBeUndefined();
  });

  test('the poster comes only from the decks\' four poster hosts, and only when it is a picture', async () => {
    expect(posterOf('youtube', THUMB.youtube)).toBe(THUMB.youtube);
    expect(posterOf('youtube', 'https://evil.example.com/x.jpg')).toBeNull();
    expect(posterOf('youtube', THUMB.vimeo)).toBeNull();
    expect(posterOf('vimeo', 'http://i.vimeocdn.com/video/1.jpg')).toBeNull();
    expect(posterOf('loom', THUMB.loom)).toBe(THUMB.loom.replace(/\.gif$/, '.jpg'));
    expect(posterOf('wistia', 'https://embed-ssl.wistia.com/deliveries/a b.jpg')).toBeNull();
    expect(posterOf('drive', 'https://lh3.googleusercontent.com/x')).toBeNull();
    expect(posterOf('youtube', 42)).toBeNull();
    // A poster host that answers with a page, not a picture, leaves the poster out but keeps the video.
    const ask = oembedUrl(V.youtube) as string;
    const h = harness({[ask]: {status: 200, body: JSON.stringify({title: 'x', thumbnail_url: THUMB.youtube})}, [THUMB.youtube]: {status: 200, headers: {'content-type': 'text/html'}, body: '<html>'}});
    expect(await checkVideo(h.web, V.youtube)).toMatchObject({ok: true, posterUrl: null});
    const other = harness({[ask]: {status: 200, body: JSON.stringify({title: 'x', thumbnail_url: 'https://tracker.example.net/t.jpg'})}});
    expect(await checkVideo(other.web, V.youtube)).toMatchObject({ok: true, posterUrl: null});
    expect(other.calls.length).toBe(1);
  });
});

describe('Google Drive', () => {
  const thumb = 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345&sz=w640';

  test('a file shared with anyone opens its thumbnail without cookies: ok', async () => {
    const h = harness({
      [thumb]: {status: 302, headers: {location: 'https://lh3.googleusercontent.com/drive-storage/abc=w640'}},
      'https://lh3.googleusercontent.com/drive-storage/abc=w640': picture,
    });
    expect(await checkVideo(h.web, V.drive)).toEqual({ok: true, provider: 'drive', url: V.drive.url, embedUrl: V.drive.embedUrl, title: null, durationSeconds: null, posterUrl: null});
    expect(h.calls.every(c => !(c.init.headers as Record<string, string>).Cookie)).toBe(true);
  });

  test('a private file sends the visitor to Google\'s sign-in: private', async () => {
    const signIn = 'https://accounts.google.com/ServiceLogin?service=wise&continue=https%3A%2F%2Fdrive.google.com';
    const h = harness({[thumb]: {status: 302, headers: {location: signIn}}, [signIn]: {status: 200, headers: {'content-type': 'text/html'}, body: '<html>Sign in</html>'}});
    expect(await checkVideo(h.web, V.drive)).toMatchObject({ok: false, refusal: PRIVATE_SENTENCE});
  });

  test('a 404 is private or gone; the resource key goes along', async () => {
    const keyed: ParsedVideo = {...V.drive, url: `${V.drive.url}?resourcekey=0-AbC`, embedUrl: `${V.drive.embedUrl}?resourcekey=0-AbC`};
    expect(driveFile(keyed.url)).toEqual({id: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', resourceKey: '0-AbC'});
    const h = harness({[`${thumb}&resourcekey=0-AbC`]: {status: 404}});
    expect(await checkVideo(h.web, keyed)).toMatchObject({ok: false, refusal: PRIVATE_SENTENCE});
  });
});

describe('the title a proposal keeps', () => {
  test('one line, no control or direction marks, at most 40 characters at a word end', () => {
    expect(videoTitle('  Your new website\n')).toBe('Your new website');
    expect(videoTitle('A website that answers your clients before they call you')).toBe('A website that answers your clients');
    expect(videoTitle('x'.repeat(60))).toBe('x'.repeat(40));
    expect(videoTitle('Hello\u202eworld')).toBe('Hello world');
    expect(videoTitle('   ')).toBeNull();
    expect(videoTitle(null)).toBeNull();
  });
});

// ---- The link rule: parseVideoLink against the database's own parser -------

const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const LOOM_ID = '0123456789abcdef0123456789abcdef';
/** Links a CSM may paste: every accepted shape and every refusal of cockpit_csm_deck_video_parse. */
const LINKS = [
  '', '   ', '\thttps://youtu.be/abcdefghijk', ' https://youtu.be/abcdefghijk ', 'https://youtu.be/abcdefghijk\u200b',
  'http://youtu.be/abcdefghijk', 'HTTP://youtu.be/abcdefghijk', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://youtu.be/abcdefghijk',
  'https://youtu.be/abc defghijk', 'https://youtu.be/abcdefghijk\\', 'https://user@youtu.be/abcdefghijk', 'https://youtu.be:443/abcdefghijk',
  'https://you%74u.be/abcdefghijk', 'https://example.com/video', 'https://', `https://youtu.be/${'a'.repeat(490)}`,
  'https://youtu.be/abcdefghijk', 'HTTPS://YOUTU.BE/abcdefghijk', 'https://youtu.be/abcdefghijk/', 'https://youtu.be/abcdefghijk#t=5',
  'https://youtu.be/abcdefghijk?t=1m', 'https://youtu.be/abcdefghijk?si=x_y&t=45s', 'https://www.youtube.com/watch?v=abcdefghijk&t=90',
  'https://youtube.com/watch?feature=share&v=abcdefghijk&t=1m30s', 'https://m.youtube.com/watch/?v=abcdefghijk&t=1h',
  'https://youtube.com/watch?v=abcdefghijk&t=1h2m3s', 'https://www.youtube.com/watch?v=abcdefghijk&t=0', 'https://www.youtube.com/watch?v=abcdefghijk&t=99999',
  'https://www.youtube.com/watch?v=abcdefghijk&t=', 'https://www.youtube.com/watch?t=10&v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&v=zzzzzzzzzzz',
  'https://www.youtube.com/embed/abcdefghijk?start=30', 'https://www.youtube-nocookie.com/embed/abcdefghijk', 'https://www.youtube.com/shorts/abcdefghijk',
  'https://www.youtube.com/watch?v=abcdefghij', 'https://www.youtube.com/', `https://www.loom.com/share/${LOOM_ID}`,
  `https://loom.com/share/my-demo-video-${LOOM_ID}?sid=x`, `https://www.loom.com/embed/${LOOM_ID}/`, 'https://www.loom.com/share/0123456789ABCDEF0123456789abcdef',
  'https://fast.wistia.net/embed/iframe/abc123defg', 'https://mahara.wistia.com/medias/abc123defg', 'https://mahara.wistia.com/medias/abc123def',
  'https://evil.com.wistia.com/medias/abc123defg', 'https://fast.wistia.com/medias/abc123defg', 'https://vimeo.com/123456789',
  'https://vimeo.com/123456789/abcdef1234', 'https://www.vimeo.com/123456789/', 'https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0',
  'https://player.vimeo.com/video/123456789', 'https://vimeo.com/12345', 'https://vimeo.com/channels/staffpicks/123456789',
  `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`, `https://drive.google.com/file/d/${DRIVE_ID}/preview?resourcekey=0-abcDEF`,
  `https://drive.google.com/file/d/${DRIVE_ID}`, 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz', 'https://drive.google.com/drive/u/0/folders/abc',
  `https://drive.google.com/open?id=${DRIVE_ID}`, 'https://docs.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view',
];

describe('the link rule', () => {
  test('the decks\' parser and parseVideoLink agree on every link: the same three links, or the same sentence', async () => {
    const db = await cockpitTestDb();
    const sql = migration('20261020120000_csm_deck_videos.sql');
    const parser = /CREATE OR REPLACE FUNCTION public\.cockpit_csm_deck_video_parse\(p_url text\)[\s\S]*?\nEND \$\$;/.exec(sql)?.[0];
    expect(parser).toBeTruthy();
    await db.exec(parser as string);
    let accepted = 0;
    for (const link of LINKS) {
      let want: unknown;
      try {
        const r = await db.query<{j: Record<string, string>}>('SELECT public.cockpit_csm_deck_video_parse($1) AS j', [link]);
        want = {ok: true, video: r.rows[0].j};
        accepted++;
      } catch (error) {
        const e = error as {code?: string; message?: string};
        expect([link, e.code]).toEqual([link, '22023']);
        want = {ok: false, refusal: e.message};
      }
      expect([link, parseVideoLink(link)]).toEqual([link, want]);
    }
    // Both kinds are in the table: 32 accepted shapes and 29 refusals.
    expect([accepted, LINKS.length - accepted]).toEqual([32, 29]);
    await db.close();
  });

  test('the canonical forms, the start time and the sentences', () => {
    expect(parseVideoLink('https://youtu.be/abcdefghijk?si=x_y&t=45s')).toEqual({ok: true, video: {
      provider: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk&t=45',
      embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&playsinline=1&enablejsapi=1&start=45',
    }});
    expect(parseVideoLink(`https://drive.google.com/file/d/${DRIVE_ID}/preview?resourcekey=0-abcDEF`)).toEqual({ok: true, video: {
      provider: 'drive', url: `https://drive.google.com/file/d/${DRIVE_ID}/view?resourcekey=0-abcDEF`, embedUrl: `https://drive.google.com/file/d/${DRIVE_ID}/preview?resourcekey=0-abcDEF`,
    }});
    expect(parseVideoLink('https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0')).toEqual({ok: true, video: {
      provider: 'vimeo', url: 'https://vimeo.com/123456789/abcdef1234', embedUrl: 'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234',
    }});
    expect(parseVideoLink('http://youtu.be/abcdefghijk')).toEqual({ok: false, refusal: 'Use the https link.'});
    expect(parseVideoLink('https://www.youtube.com/shorts/abcdefghijk')).toEqual({ok: false, refusal: 'That YouTube link has no video in it. Copy the video\'s share link.'});
    expect(parseVideoLink('https://drive.google.com/drive/folders/x')).toEqual({ok: false, refusal: 'That Drive link is a folder. Paste the link to the video file.'});
    expect(parseVideoLink('https://example.com/v')).toEqual({ok: false, refusal: VIDEO_HOSTS_SENTENCE});
  });

  test('a canonical link parses to itself', () => {
    for (const link of LINKS) {
      const once = parseVideoLink(link);
      if (once.ok) expect([link, parseVideoLink(once.video.url)]).toEqual([link, once]);
    }
  });
});
