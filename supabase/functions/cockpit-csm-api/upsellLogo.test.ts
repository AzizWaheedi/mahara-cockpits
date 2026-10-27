import {describe, expect, test} from 'bun:test';
import {runUpsell, UpsellError} from './upsell.ts';
import {checkLogoBytes, inspectPicture, LOGO_MAX_BYTES, PictureRefusal, sniff, stripMetadata} from './upsellLogo.ts';

// Logo pictures built byte by byte (PNG chunks, JPEG segments, WebP RIFF
// chunks), then the pick's chain against mocked RPCs, Storage and fetch.

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const has = (b: Uint8Array, s: string) => new TextDecoder('latin1').decode(b).includes(s);

const CRC = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => cat(be32(data.length), enc(type), data, be32(crc32(cat(enc(type), data))));
function png(w: number, h: number, extra: Uint8Array[] = [], idat = new Uint8Array(32).fill(7)) {
  const ihdr = cat(be32(w), be32(h), new Uint8Array([8, 6, 0, 0, 0]));
  return cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
}
const seg = (marker: number, data: Uint8Array) => cat(new Uint8Array([0xff, marker, ((data.length + 2) >> 8) & 255, (data.length + 2) & 255]), data);
function jpeg(w: number, h: number, extra: Uint8Array[] = []) {
  const sof = seg(0xc0, new Uint8Array([8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  return cat(
    new Uint8Array([0xff, 0xd8]), seg(0xe0, cat(enc('JFIF\0'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]))), ...extra,
    seg(0xdb, new Uint8Array(65).fill(1)), sof, seg(0xc4, new Uint8Array(20).fill(2)),
    seg(0xda, new Uint8Array([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])), new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56]), new Uint8Array([0xff, 0xd9]),
  );
}
const riffChunk = (fourcc: string, data: Uint8Array) => cat(enc(fourcc), le32(data.length), data, data.length & 1 ? new Uint8Array([0]) : new Uint8Array(0));
function webp(chunks: Uint8Array[]) {
  const body = cat(enc('WEBP'), ...chunks);
  return cat(enc('RIFF'), le32(body.length), body);
}
const vp8x = (w: number, h: number, flags: number) =>
  riffChunk('VP8X', new Uint8Array([flags, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255]));
const vp8l = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riffChunk('VP8L', cat(new Uint8Array([0x2f]), le32(bits), new Uint8Array(9).fill(3)));
};
const vp8 = (w: number, h: number) => riffChunk('VP8 ', new Uint8Array([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 255, h & 255, (h >> 8) & 255, 0, 0, 0, 0]));
const EXIF_JPEG = seg(0xe1, cat(enc('Exif\0\0MM\0*'), new Uint8Array(40).fill(9), enc('GPS 29.3759N 47.9774E')));
const XMP_JPEG = seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>Someone</dc:creator></x:xmpmeta>'));
const COMMENT_JPEG = seg(0xfe, enc('Made with CameraApp by Someone'));

async function refusal(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof PictureRefusal || error instanceof UpsellError) return error.message;
    throw error;
  }
  throw new Error('Expected a refusal');
}

describe('what the bytes are', () => {
  test('PNG, JPEG and WebP (extended, lossless and lossy) with their sizes', () => {
    expect(inspectPicture(png(512, 256))).toEqual({mime: 'image/png', width: 512, height: 256});
    expect(inspectPicture(jpeg(800, 600))).toEqual({mime: 'image/jpeg', width: 800, height: 600});
    expect(inspectPicture(webp([vp8x(300, 120, 0x10), vp8l(300, 120)]))).toEqual({mime: 'image/webp', width: 300, height: 120});
    expect(inspectPicture(webp([vp8l(1000, 70)]))).toEqual({mime: 'image/webp', width: 1000, height: 70});
    expect(inspectPicture(webp([vp8(640, 480)]))).toEqual({mime: 'image/webp', width: 640, height: 480});
  });

  test('SVG, GIF, animated WebP and APNG are refused, whatever the file claims to be', async () => {
    expect(await refusal(() => inspectPicture(enc('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text>Acme</text></svg>')))).toBe('That logo is an SVG drawing. Pick a PNG, JPG or WebP picture.');
    expect(await refusal(() => inspectPicture(enc('\ufeff<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 10 10"></svg>')))).toContain('SVG');
    expect(await refusal(() => inspectPicture(cat(enc('GIF89a'), new Uint8Array(30))))).toBe('That logo is a GIF. Pick a PNG, JPG or WebP picture.');
    expect(await refusal(() => inspectPicture(webp([vp8x(200, 200, 0x12), riffChunk('ANIM', new Uint8Array(6)), riffChunk('ANMF', new Uint8Array(20))])))).toBe('That logo moves (an animated WebP). Pick a still picture.');
    expect(await refusal(() => inspectPicture(webp([vp8x(200, 200, 0x02), vp8l(200, 200)])))).toBe('That logo moves (an animated WebP). Pick a still picture.');
    expect(await refusal(() => inspectPicture(png(200, 200, [chunk('acTL', cat(be32(2), be32(0)))])))).toBe('That logo moves (an animated PNG). Pick a still picture.');
    expect(await refusal(() => inspectPicture(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16])))).toBe('That file is not a PNG, JPG or WebP picture. Pick another one.');
    expect(await refusal(() => inspectPicture(enc('<!doctype html><html>Not found</html>')))).toContain('not a PNG, JPG or WebP');
    expect(sniff(enc('<svg/>'))).toBe('svg');
  });

  test('a cut or broken picture is refused, never guessed', async () => {
    const whole = png(200, 200);
    expect(await refusal(() => inspectPicture(whole.subarray(0, whole.length - 10)))).toBe('That picture could not be read. Pick another one.');
    expect(await refusal(() => inspectPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])))).toBe('That picture could not be read. Pick another one.');
    expect(await refusal(() => inspectPicture(cat(enc('RIFF'), le32(4), enc('WEBP'))))).toBe('That picture could not be read. Pick another one.');
  });
});

describe('the caps', () => {
  test('at most 2 MB, at least 64 by 64, at most 4000 by 4000', async () => {
    expect(await refusal(() => checkLogoBytes(png(500, 500, [], new Uint8Array(LOGO_MAX_BYTES))))).toBe('That logo is over 2 MB. Pick a smaller one, or upload a smaller copy.');
    expect(await refusal(() => checkLogoBytes(png(63, 200)))).toBe('That logo is smaller than 64 by 64 pixels. Pick a larger one.');
    expect(await refusal(() => checkLogoBytes(jpeg(4001, 300)))).toBe('That logo is larger than 4000 by 4000 pixels. Upload a smaller copy.');
    expect(checkLogoBytes(png(64, 64)).picture).toEqual({mime: 'image/png', width: 64, height: 64});
    expect(checkLogoBytes(jpeg(4000, 4000)).picture.width).toBe(4000);
    expect(await refusal(() => checkLogoBytes(new Uint8Array(0)))).toBe('That picture is empty. Pick another one.');
  });
});

describe('EXIF and XMP stripped', () => {
  test('JPEG: APP1 (EXIF and XMP), IPTC and comments go; the frame, tables and scan stay byte for byte', () => {
    const iptc = seg(0xed, enc('Photoshop 3.0\x008BIM caption'));
    const original = jpeg(320, 200, [EXIF_JPEG, XMP_JPEG, iptc, COMMENT_JPEG]);
    expect(has(original, 'Exif')).toBe(true);
    const {bytes, picture} = checkLogoBytes(original);
    for (const word of ['Exif', 'xmpmeta', 'GPS', 'Photoshop', 'CameraApp']) expect([word, has(bytes, word)]).toEqual([word, false]);
    expect(has(bytes, 'JFIF')).toBe(true);
    expect(picture).toEqual({mime: 'image/jpeg', width: 320, height: 200});
    expect(Array.from(bytes)).toEqual(Array.from(jpeg(320, 200)));
  });

  test('PNG: eXIf, tEXt, iTXt and zTXt go; every other chunk keeps its bytes and CRC', () => {
    const original = png(256, 256, [
      chunk('eXIf', cat(enc('MM\0*'), new Uint8Array(20))), chunk('tEXt', enc('Comment\0Exif data from the camera')),
      chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')), chunk('zTXt', enc('Raw profile type exif\0\0abc')),
      chunk('pHYs', new Uint8Array([0, 0, 11, 19, 0, 0, 11, 19, 1])),
    ]);
    const {bytes} = checkLogoBytes(original);
    for (const word of ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'Exif', 'xmpmeta']) expect([word, has(bytes, word)]).toEqual([word, false]);
    expect(Array.from(bytes)).toEqual(Array.from(png(256, 256, [chunk('pHYs', new Uint8Array([0, 0, 11, 19, 0, 0, 11, 19, 1]))])));
  });

  test('WebP: EXIF and XMP chunks go, the header\'s flags and the RIFF size are fixed', () => {
    const original = webp([vp8x(400, 160, 0x10 | 0x08 | 0x04), vp8l(400, 160), riffChunk('EXIF', cat(enc('Exif\0\0MM\0*'), new Uint8Array(11))), riffChunk('XMP ', enc('<x:xmpmeta/>'))]);
    const {bytes, picture} = checkLogoBytes(original);
    expect(has(bytes, 'Exif') || has(bytes, 'XMP ') || has(bytes, 'xmpmeta')).toBe(false);
    expect(picture).toEqual({mime: 'image/webp', width: 400, height: 160});
    expect(bytes[20] & 0x0c).toBe(0);
    expect(bytes[20] & 0x10).toBe(0x10);
    expect(bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)).toBe(bytes.length - 8);
    expect(Array.from(bytes)).toEqual(Array.from(webp([vp8x(400, 160, 0x10), vp8l(400, 160)])));
  });

  test('a picture with nothing to strip comes back the same', () => {
    for (const b of [png(100, 100), jpeg(100, 100), webp([vp8(100, 100)])]) expect(Array.from(stripMetadata(b, inspectPicture(b).mime))).toEqual(Array.from(b));
  });
});

// ---- Find and pick, through the router -------------------------------------

const TASK = 'taskA1';
const AD = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const SECOND = '11111111-2222-4333-8444-555555555555';
const REQUEST = '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73';
type Rpc = (args: Record<string, unknown>) => {data: unknown; error: {message: string; code?: string} | null};
const ad = (extra: Record<string, unknown> = {}) => ({
  id: AD, taskId: TASK, kind: 'logo', status: 'uploading', path: `${TASK}/${AD}.png`, mime: 'image/png', bytes: 0, width: 512, height: 256,
  posterPath: null, posterMime: null, posterBytes: null, fileName: 'logo-acme-interiors.com.png', ...extra,
});
const SITE = '<html><head><title>Acme</title><link rel="apple-touch-icon" href="/apple.png" sizes="180x180"></head><body><header><img src="https://static.wixstatic.com/media/acme_logo.png" width="300" height="100"></header><p>Kitchens and villas across Kuwait.</p></body></html>';

function pick(options: {
  rpc?: Record<string, Rpc>; routes?: Record<string, {status: number; headers?: Record<string, string>; body?: Uint8Array | string}>;
  storage?: {info?: () => {data: unknown; error: unknown}; signRead?: (paths: string[]) => {data: unknown; error: unknown}};
} = {}) {
  const receipts: Record<string, unknown>[] = [];
  const events: string[] = [];
  const calls: {name: string; args: Record<string, unknown>}[] = [];
  const uploads: {path: string; token: string; body: Uint8Array; options?: Record<string, unknown>}[] = [];
  const request = (async (input: string | URL | Request) => {
    const url = String(input);
    events.push(`fetch:${url}`);
    const a = options.routes?.[url];
    if (!a) throw new TypeError('dns error: failed to lookup address information');
    return new Response((a.body ?? null) as BodyInit | null, {status: a.status, headers: a.headers});
  }) as typeof fetch;
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      events.push(`rpc:${name}`);
      calls.push({name, args});
      const h = options.rpc?.[name];
      if (!h) throw new Error(`unexpected rpc ${name}`);
      return h(args);
    },
    storage: {from: (bucket: string) => ({async createSignedUrls(paths: string[], expiresIn: number) {
      events.push(`user:sign-read:${bucket}:${expiresIn}`);
      if (options.storage?.signRead) return options.storage.signRead(paths) as {data: {path: string | null; signedUrl: string | null; error: string | null}[] | null; error: unknown};
      return {data: paths.map(path => ({path, signedUrl: `https://storage.test/sign/${path}?token=read`, error: null})), error: null};
    }})},
  };
  const admin = {
    from: () => ({insert: async (row: Record<string, unknown>) => {
      receipts.push(row);
      return {error: null};
    }}),
    async rpc() {
      throw new Error('unexpected admin rpc');
    },
    storage: {from: (bucket: string) => ({
      async createSignedUploadUrl(path: string, opts?: {upsert: boolean}) {
        events.push(`admin:sign-upload:${bucket}:${opts?.upsert}`);
        return {data: {signedUrl: `https://storage.test/upload/${path}?token=up`, token: 'up', path}, error: null};
      },
      async uploadToSignedUrl(path: string, token: string, body: Uint8Array, opts?: Record<string, unknown>) {
        events.push('admin:upload');
        uploads.push({path, token, body, options: opts});
        return {data: {path}, error: null};
      },
      async info() {
        events.push('admin:info');
        return options.storage?.info?.() ?? {data: {size: uploads[0]?.body.length ?? 0, contentType: 'image/png'}, error: null};
      },
      async remove() {
        return {data: [], error: null};
      },
    })},
  };
  const run = (input: unknown) => runUpsell(client, admin, input, name => (name === 'SUPABASE_URL' ? 'https://db.test' : undefined), {request, resolve: async () => ['93.184.216.34']});
  return {run, events, calls, uploads, receipts};
}
const sitesOnFile = () => ({data: {mode: 'refused', site: {verdict: 'ok', urls: [{url: 'https://acme-interiors.com', from: 'card'}]}}, error: null});
const LOGO = png(512, 256, [chunk('eXIf', cat(enc('MM\0*'), new Uint8Array(20))), chunk('tEXt', enc('Comment\0Exif from the designer'))]);
const pickInput = (url: string) => ({operation: 'upsell.logoPick', requestId: REQUEST, args: {taskId: TASK, url}});

describe('upsell.logoPick', () => {
  test('a picture on the client\'s own site: fetched, checked, stripped, then reserve, upload, check and accept, in that order', async () => {
    let reserved = 0;
    const p = pick({
      rpc: {
        cockpit_csm_offer_sources: sitesOnFile,
        cockpit_csm_launch_ad_reserve: args => {
          reserved = Number(args.p_bytes);
          return {data: ad({bytes: reserved}), error: null};
        },
        cockpit_csm_launch_ad_accept: () => ({data: ad({bytes: reserved, status: 'ready'}), error: null}),
      },
      routes: {'https://acme-interiors.com/img/logo.png': {status: 200, headers: {'content-type': 'image/png'}, body: LOGO}},
    });
    const out = await p.run(pickInput('https://acme-interiors.com/img/logo.png')) as Record<string, unknown>;
    expect(p.events).toEqual([
      'rpc:cockpit_csm_offer_sources', 'fetch:https://acme-interiors.com/img/logo.png', 'rpc:cockpit_csm_launch_ad_reserve',
      'admin:sign-upload:cockpit-launch-ads:false', 'admin:upload', 'admin:info', 'rpc:cockpit_csm_launch_ad_accept', 'user:sign-read:cockpit-launch-ads:3600',
    ]);
    const reserve = p.calls.find(c => c.name === 'cockpit_csm_launch_ad_reserve')?.args;
    expect(reserve).toEqual({
      p_request_id: REQUEST, p_task_id: TASK, p_kind: 'logo', p_mime: 'image/png', p_bytes: reserved, p_width: 512, p_height: 256,
      p_seconds: null, p_file_name: 'logo-acme-interiors.com.png', p_poster_mime: null, p_poster_bytes: null,
    });
    expect(reserved).toBeLessThan(LOGO.length);
    expect(p.uploads[0].body.length).toBe(reserved);
    expect(has(p.uploads[0].body, 'Exif') || has(p.uploads[0].body, 'eXIf')).toBe(false);
    expect(p.uploads[0].options).toEqual({contentType: 'image/png', upsert: false});
    expect(out).toMatchObject({id: AD, kind: 'logo', status: 'ready', url: `https://storage.test/sign/${TASK}/${AD}.png?token=read`});
    // It never writes the verified logos.
    expect(p.calls.map(c => c.name).some(n => n.includes('client_logo'))).toBe(false);
  });

  test('a builder\'s picture host is fine when the client\'s page names the picture', async () => {
    const p = pick({
      rpc: {
        cockpit_csm_offer_sources: sitesOnFile,
        cockpit_csm_launch_ad_reserve: args => ({data: ad({bytes: args.p_bytes}), error: null}),
        cockpit_csm_launch_ad_accept: () => ({data: ad({status: 'ready', bytes: 1}), error: null}),
      },
      routes: {
        'https://acme-interiors.com/': {status: 200, headers: {'content-type': 'text/html'}, body: SITE},
        'https://static.wixstatic.com/media/acme_logo.png': {status: 200, headers: {'content-type': 'image/png'}, body: png(300, 100)},
      },
    });
    await p.run(pickInput('https://static.wixstatic.com/media/acme_logo.png'));
    expect(p.events).toContain('rpc:cockpit_csm_launch_ad_accept');
  });

  test('anything else is refused before it is read or saved', async () => {
    const p = pick({
      rpc: {cockpit_csm_offer_sources: sitesOnFile},
      routes: {'https://acme-interiors.com/': {status: 200, headers: {'content-type': 'text/html'}, body: SITE}},
    });
    expect(await refusal(() => p.run(pickInput('https://cdn.someone-else.com/logo.png')))).toBe('Pick a picture found on the client\'s own site. The verified logo and the launch tray\'s logos need no saving.');
    expect(await refusal(() => p.run(pickInput('https://db.test/storage/v1/object/public/cockpit-client-logos/acme.png')))).toContain('client\'s own site');
    expect(p.events.filter(e => e.startsWith('fetch:')).every(e => e === 'fetch:https://acme-interiors.com/')).toBe(true);
    expect(p.calls.map(c => c.name).includes('cockpit_csm_launch_ad_reserve')).toBe(false);
  });

  test('bytes that fail the checks are refused with the sentence; nothing is reserved', async () => {
    for (const [body, words] of [
      [enc('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'SVG drawing'],
      [png(20, 20), 'smaller than 64 by 64'],
      [cat(enc('GIF89a'), new Uint8Array(40)), 'is a GIF'],
    ] as [Uint8Array, string][]) {
      const p = pick({rpc: {cockpit_csm_offer_sources: sitesOnFile}, routes: {'https://acme-interiors.com/logo.png': {status: 200, headers: {'content-type': 'image/png'}, body}}});
      expect(await refusal(() => p.run(pickInput('https://acme-interiors.com/logo.png')))).toContain(words);
      expect(p.calls.map(c => c.name)).toEqual(['cockpit_csm_offer_sources']);
    }
    const big = pick({rpc: {cockpit_csm_offer_sources: sitesOnFile}, routes: {'https://acme-interiors.com/logo.png': {status: 200, body: png(500, 500, [], new Uint8Array(LOGO_MAX_BYTES + 10))}}});
    expect(await refusal(() => big.run(pickInput('https://acme-interiors.com/logo.png')))).toBe('That logo is over 2 MB. Pick a smaller one, or upload a smaller copy.');
    const gone = pick({rpc: {cockpit_csm_offer_sources: sitesOnFile}, routes: {'https://acme-interiors.com/logo.png': {status: 404}}});
    expect(await refusal(() => gone.run(pickInput('https://acme-interiors.com/logo.png')))).toBe('The client\'s site did not give that picture (HTTP 404). Pick another one, or upload the logo.');
  });

  test('a pick with no request id is refused before anything is read or reserved', async () => {
    const p = pick({rpc: {cockpit_csm_offer_sources: sitesOnFile}, routes: {'https://acme-interiors.com/img/logo.png': {status: 200, body: LOGO}}});
    expect(await refusal(() => p.run({operation: 'upsell.logoPick', args: {taskId: TASK, url: 'https://acme-interiors.com/img/logo.png'}}))).toBe('A request id is required to save a logo.');
    expect(p.events).toEqual([]);
  });

  test('the same pick again after it saved: no second upload', async () => {
    const p = pick({
      rpc: {cockpit_csm_offer_sources: sitesOnFile, cockpit_csm_launch_ad_reserve: () => ({data: ad({status: 'ready', bytes: 10}), error: null})},
      routes: {'https://acme-interiors.com/img/logo.png': {status: 200, body: LOGO}},
    });
    expect(await p.run(pickInput('https://acme-interiors.com/img/logo.png'))).toMatchObject({status: 'ready'});
    expect(p.events.some(e => e.startsWith('admin:'))).toBe(false);
  });

  test('a saved object that does not match the reservation is not accepted', async () => {
    const p = pick({
      rpc: {cockpit_csm_offer_sources: sitesOnFile, cockpit_csm_launch_ad_reserve: args => ({data: ad({bytes: args.p_bytes}), error: null})},
      routes: {'https://acme-interiors.com/img/logo.png': {status: 200, body: LOGO}},
      storage: {info: () => ({data: {size: 1, contentType: 'image/png'}, error: null})},
    });
    expect(await refusal(() => p.run(pickInput('https://acme-interiors.com/img/logo.png')))).toBe('The saved logo does not match what was reserved. Pick it again.');
    expect(p.calls.map(c => c.name)).not.toContain('cockpit_csm_launch_ad_accept');
  });
});

describe('upsell.logoFind', () => {
  test('the verified logo, the tray\'s logos, then the pictures on their site, in that order', async () => {
    const p = pick({
      rpc: {
        cockpit_csm_deck_sources: () => ({data: {logo: {bucket: 'cockpit-client-logos', path: 'acme-interiors/logo.png', verifiedAt: '2026-10-03'}}, error: null}),
        cockpit_csm_launch_ads_read: () => ({data: [ad({status: 'ready', bytes: 900}), ad({id: '11111111-2222-4333-8444-555555555555', path: `${TASK}/11111111-2222-4333-8444-555555555555.mp4`, kind: 'custom', mime: 'video/mp4', status: 'ready', bytes: 9})], error: null}),
        cockpit_csm_offer_sources: sitesOnFile,
      },
      routes: {'https://acme-interiors.com/': {status: 200, headers: {'content-type': 'text/html'}, body: SITE}},
    });
    const out = await p.run({operation: 'upsell.logoFind', args: {taskId: TASK}});
    expect(out).toEqual({
      candidates: [
        {source: 'verified', url: 'https://db.test/storage/v1/object/public/cockpit-client-logos/acme-interiors/logo.png'},
        {source: 'upload', url: `https://storage.test/sign/${TASK}/${AD}.png?token=read`, adId: AD, width: 512, height: 256},
        {source: 'site', url: 'https://static.wixstatic.com/media/acme_logo.png', width: 300, height: 100},
        {source: 'site', url: 'https://acme-interiors.com/apple.png', width: 180, height: 180},
      ],
      note: null,
    });
  });

  test('nothing anywhere says what to do next, and which "none" it read: no site on file, a site that did not open, or none on it', async () => {
    const empty = {
      cockpit_csm_deck_sources: () => ({data: {logo: null}, error: null}),
      cockpit_csm_launch_ads_read: () => ({data: [], error: null}),
    };
    const none = pick({rpc: {...empty, cockpit_csm_offer_sources: () => ({data: {site: {verdict: 'none_on_file', urls: []}}, error: null})}});
    expect(await none.run({operation: 'upsell.logoFind', args: {taskId: TASK}})).toEqual({
      candidates: [], note: 'No logo found: none verified, none in the launch tray, and no website on file. Upload one, or leave the logo off.',
    });
    // The website offer is pitched to clients whose site is broken: a parked domain is not "none on their site".
    const parked = pick({
      rpc: {...empty, cockpit_csm_offer_sources: sitesOnFile},
      routes: {'https://acme-interiors.com/': {status: 200, headers: {'content-type': 'text/html'}, body: '<html><title>acme-interiors.com</title><body>This domain may be for sale! Buy this domain.</body></html>'}},
    });
    expect(await parked.run({operation: 'upsell.logoFind', args: {taskId: TASK}})).toEqual({
      candidates: [], note: 'No logo found: none verified, none in the launch tray, and their site did not open. Upload one, or leave the logo off.',
    });
    // A site that does not answer at all reads the same.
    const dead = pick({rpc: {...empty, cockpit_csm_offer_sources: sitesOnFile}});
    expect((await dead.run({operation: 'upsell.logoFind', args: {taskId: TASK}}) as {note: string}).note).toBe(
      'No logo found: none verified, none in the launch tray, and their site did not open. Upload one, or leave the logo off.',
    );
    // A site that opened with no usable picture on it: none on their site.
    const plain = pick({
      rpc: {...empty, cockpit_csm_offer_sources: sitesOnFile},
      routes: {'https://acme-interiors.com/': {status: 200, headers: {'content-type': 'text/html'}, body: '<html><title>Acme</title><body><p>Kitchens and villas across Kuwait.</p></body></html>'}},
    });
    expect((await plain.run({operation: 'upsell.logoFind', args: {taskId: TASK}}) as {note: string}).note).toBe(
      'No logo found: none verified, none in the launch tray and none on their site. Upload one, or leave the logo off.',
    );
  });

  test('tray logos Storage did not sign are said, never shown as none; the failed signing leaves its receipt', async () => {
    const rpc = {
      cockpit_csm_deck_sources: () => ({data: {logo: null}, error: null}),
      cockpit_csm_launch_ads_read: () => ({data: [ad({status: 'ready', bytes: 900})], error: null}),
      cockpit_csm_offer_sources: () => ({data: {site: {verdict: 'none_on_file', urls: []}}, error: null}),
    };
    const p = pick({rpc, storage: {signRead: () => ({data: null, error: {statusCode: '500', message: 'Internal'}})}});
    expect(await p.run({operation: 'upsell.logoFind', args: {taskId: TASK}})).toEqual({
      candidates: [], note: 'One logo in the launch tray could not be opened just now. Try again.',
    });
    expect(p.receipts.filter(r => r.provider === 'supabase-storage').map(r => [r.resource, r.phase, r.http_status ?? null])).toEqual([
      ['cockpit-launch-ads/sign-read', 'intent', null], ['cockpit-launch-ads/sign-read', 'response', 500],
    ]);
    // A row-level refusal for one of two logos: the other is shown, and the note still counts the missing one.
    const two = pick({
      rpc: {...rpc, cockpit_csm_launch_ads_read: () => ({data: [ad({status: 'ready', bytes: 900}), ad({id: SECOND, path: `${TASK}/${SECOND}.png`, status: 'ready', bytes: 800})], error: null})},
      storage: {signRead: paths => ({data: paths.map(path => (path.includes(SECOND) ? {path, signedUrl: null, error: 'Object not found'} : {path, signedUrl: `https://storage.test/sign/${path}?token=read`, error: null})), error: null})},
    });
    expect(await two.run({operation: 'upsell.logoFind', args: {taskId: TASK}})).toEqual({
      candidates: [{source: 'upload', url: `https://storage.test/sign/${TASK}/${AD}.png?token=read`, adId: AD, width: 512, height: 256}],
      note: 'One logo in the launch tray could not be opened just now. Try again.',
    });
  });

  test('an answer about their site that cannot be read is a 502, not "no website on file"', async () => {
    const p = pick({
      rpc: {
        cockpit_csm_deck_sources: () => ({data: {logo: null}, error: null}),
        cockpit_csm_launch_ads_read: () => ({data: [], error: null}),
        cockpit_csm_offer_sources: () => ({data: {mode: 'proactive'}, error: null}),
      },
    });
    try {
      await p.run({operation: 'upsell.logoFind', args: {taskId: TASK}});
      throw new Error('expected a refusal');
    } catch (error) {
      expect([(error as UpsellError).status, (error as UpsellError).message]).toEqual([502, 'The server did not return this client\'s site. Try again.']);
    }
  });

  test('the gate refuses another client with a 403', async () => {
    const p = pick({rpc: {cockpit_csm_deck_sources: () => ({data: null, error: {message: 'That client is not on your access list', code: '42501'}})}});
    try {
      await p.run({operation: 'upsell.logoFind', args: {taskId: TASK}});
      throw new Error('expected a refusal');
    } catch (error) {
      expect([(error as UpsellError).status, (error as UpsellError).message]).toEqual([403, 'That client is not on your access list']);
    }
  });
});
