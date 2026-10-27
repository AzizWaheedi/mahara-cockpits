import {describe, expect, test} from 'bun:test';
import {privateAddress, WEB_MAX_REDIRECTS, WebError, WebValidationError, type WebResolver, webFailureKind, webRefusal, webTools} from './tools.ts';
import {denoResolver, runUpsell, UPSELL_OPERATIONS, UpsellError} from './upsell.ts';

// The upsell router and tools.ts webTools against a mocked fetch, mocked RPCs
// and a mocked receipts table. The SQL side (the gate, the site verdict, the
// hourly cap, the captures) is pinned in
// apps/media-buyer-cockpit/scripts/upsell-*-supabase.test.ts.

type Answer = {status: number; headers?: Record<string, string>; body?: string | Uint8Array} | Error | 'hang';
function web(routes: Record<string, Answer | Answer[]>) {
  const calls: {url: string; init: RequestInit}[] = [];
  const seen: Record<string, number> = {};
  const request = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({url, init});
    const entry = routes[url];
    if (!entry) throw new TypeError(`error sending request for url (${url}): client error (Connect): dns error: failed to lookup address information: Name or service not known`);
    const list = Array.isArray(entry) ? entry : [entry];
    const answer = list[Math.min(seen[url] ?? 0, list.length - 1)];
    seen[url] = (seen[url] ?? 0) + 1;
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
    }
    if (answer instanceof Error) throw answer;
    return new Response((answer.body ?? null) as BodyInit | null, {status: answer.status, headers: answer.headers});
  }) as typeof fetch;
  return {request, calls};
}
function ledger(fail: (row: Record<string, unknown>) => boolean = () => false) {
  const rows: Record<string, unknown>[] = [];
  return {rows, health: async (row: Record<string, unknown>) => {
    if (fail(row)) throw new Error('ledger down');
    rows.push(row);
  }};
}
async function webFailure(p: Promise<unknown>): Promise<WebError> {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(WebError);
    return error as WebError;
  }
  throw new Error('Expected a WebError');
}
const page = (body: string, status = 200) => ({status, headers: {'content-type': 'text/html; charset=utf-8'}, body});
const publicDns: WebResolver = async () => ['93.184.216.34'];
const opts = {purpose: 'site' as const, maxBytes: 100_000, timeoutMs: 2000};

describe('webTools: what may be read', () => {
  test('SSRF refusals leave nothing: no fetch and no receipt', async () => {
    for (const [url, purpose] of [
      ['http://example.com/', 'oembed'], ['http://example.com/', 'logo'], ['ftp://example.com/', 'site'], ['javascript:alert(1)', 'site'],
      ['https://user:pw@example.com/', 'site'], ['https://example.com:8443/', 'site'], ['http://example.com:8080/', 'site'],
      ['https://127.0.0.1/', 'site'], ['https://10.0.0.5/', 'logo'], ['http://2130706433/', 'site'], ['http://0x7f.1/', 'site'],
      ['https://[::1]/', 'site'], ['https://[fd00::1]/', 'site'], ['https://localhost/', 'site'], ['https://app.localhost/', 'site'],
      ['https://printer.local/', 'site'], ['https://metadata.google.internal/computeMetadata/v1/', 'site'], ['https://metadata.example.com/', 'site'],
      ['https://intranet/', 'site'], ['https://nas.lan/', 'site'], ['https://demo.example/', 'site'], ['not a url', 'site'],
    ] as const) {
      const f = web({});
      const l = ledger();
      const error = await webFailure(webTools(l.health, f.request, publicDns).get(url, {...opts, purpose}));
      expect([url, error.kind]).toEqual([url, 'refused']);
      expect(f.calls).toEqual([]);
      expect(l.rows).toEqual([]);
    }
  });

  test('a public https address passes the guard; http passes only for a site', () => {
    expect(webRefusal('https://acme-interiors.com/about', 'logo')).toBeNull();
    expect(webRefusal('http://acme-interiors.com/', 'site')).toBeNull();
    expect(webRefusal('http://acme-interiors.com/', 'thumbnail')).toBe('Only https addresses can be read.');
    expect(webRefusal('https://acme.com.kw:443/', 'oembed')).toBeNull();
  });

  test('private, loopback, link-local, shared and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', 'nonsense'])
      expect([ip, privateAddress(ip)]).toEqual([ip, true]);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect([ip, privateAddress(ip)]).toEqual([ip, false]);
  });
});

describe('webTools: hops, bytes and receipts', () => {
  test('each hop is checked again: a redirect into a private address is refused before it is fetched', async () => {
    const f = web({'https://acme.com/': {status: 302, headers: {location: 'http://127.0.0.1/admin'}}});
    const l = ledger();
    const error = await webFailure(webTools(l.health, f.request, publicDns).get('https://acme.com/', opts));
    expect(error.kind).toBe('refused');
    expect(f.calls.map(c => c.url)).toEqual(['https://acme.com/']);
    expect(l.rows).toEqual([
      {provider: 'web', method: 'GET', resource: 'site:acme.com', phase: 'intent'},
      {provider: 'web', method: 'GET', resource: 'site:acme.com', phase: 'response', http_status: 302},
    ]);
  });

  test('a logo may not be sent down to http; a site may', async () => {
    const f = web({'https://acme.com/logo.png': {status: 301, headers: {location: 'http://acme.com/logo.png'}}});
    expect((await webFailure(webTools(ledger().health, f.request, publicDns).get('https://acme.com/logo.png', {...opts, purpose: 'logo'}))).kind).toBe('refused');
    const g = web({'https://acme.com/': {status: 301, headers: {location: 'http://www.acme.com/'}}, 'http://www.acme.com/': page('<title>Acme</title>')});
    const out = await webTools(ledger().health, g.request, publicDns).get('https://acme.com/', opts);
    expect([out.status, out.finalUrl, out.redirects]).toEqual([200, 'http://www.acme.com/', ['http://www.acme.com/']]);
  });

  test(`at most ${WEB_MAX_REDIRECTS} redirects`, async () => {
    const routes: Record<string, Answer> = {};
    for (let i = 0; i < 7; i++) routes[`https://acme.com/${i}`] = {status: 302, headers: {location: `/${i + 1}`}};
    const f = web(routes);
    expect((await webFailure(webTools(ledger().health, f.request, publicDns).get('https://acme.com/0', opts))).kind).toBe('redirects');
    expect(f.calls.length).toBe(WEB_MAX_REDIRECTS + 1);
  });

  test('the byte cap reads no further and says it cut', async () => {
    const f = web({'https://acme.com/big': {status: 200, body: new Uint8Array(5000).fill(65)}});
    const out = await webTools(ledger().health, f.request, publicDns).get('https://acme.com/big', {...opts, maxBytes: 1200});
    expect([out.body.length, out.truncated]).toEqual([1200, true]);
    const small = await webTools(ledger().health, f.request, publicDns).get('https://acme.com/big', {...opts, maxBytes: 9000});
    expect([small.body.length, small.truncated]).toEqual([5000, false]);
  });

  test('receipts carry the purpose and the host only, never the path or the query', async () => {
    const f = web({'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc': {status: 200, body: '{}'}});
    const l = ledger();
    await webTools(l.health, f.request, publicDns).get('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc', {...opts, purpose: 'oembed'});
    expect(l.rows).toEqual([
      {provider: 'web', method: 'GET', resource: 'oembed:www.youtube.com', phase: 'intent'},
      {provider: 'web', method: 'GET', resource: 'oembed:www.youtube.com', phase: 'response', http_status: 200},
    ]);
    expect(JSON.stringify(l.rows)).not.toContain('watch');
  });

  test('no answer writes unknown: a dead name, a bad certificate, a deadline', async () => {
    const tls = new TypeError('error sending request for url (https://bad-cert.com/): client error (Connect): invalid peer certificate: Expired');
    const f = web({'https://bad-cert.com/': tls, 'https://slow.com/': 'hang'});
    for (const [url, kind] of [['https://no-such-name.com/', 'dns'], ['https://bad-cert.com/', 'tls'], ['https://slow.com/', 'timeout']] as const) {
      const l = ledger();
      const error = await webFailure(webTools(l.health, f.request, publicDns).get(url, {...opts, timeoutMs: 50}));
      expect([url, error.kind]).toEqual([url, kind]);
      expect(l.rows.map(r => r.phase)).toEqual(['intent', 'unknown']);
    }
  });

  test('a receipt that cannot be saved stops the call before it leaves', async () => {
    const f = web({'https://acme.com/': page('<title>Acme</title>')});
    const l = ledger(row => row.phase === 'intent');
    await expect(webTools(l.health, f.request, publicDns).get('https://acme.com/', opts)).rejects.toThrow('ledger down');
    expect(f.calls).toEqual([]);
  });

  test('a resolver turns a private answer into a refusal and no answer into dns', async () => {
    const f = web({'https://rebind.com/': page('x'), 'https://gone.com/': page('x'), 'https://fine.com/': page('<title>Fine</title>')});
    const resolve = async (host: string) => (host === 'rebind.com' ? ['93.184.216.34', '10.0.0.7'] : host === 'gone.com' ? [] : ['93.184.216.34']);
    const l = ledger();
    const tools = webTools(l.health, f.request, resolve);
    expect((await webFailure(tools.get('https://rebind.com/', opts))).kind).toBe('refused');
    expect((await webFailure(tools.get('https://gone.com/', opts))).kind).toBe('dns');
    expect((await tools.get('https://fine.com/', opts)).status).toBe(200);
    expect(f.calls.map(c => c.url)).toEqual(['https://fine.com/']);

  });

  test('missing, failed and timed-out DNS validation never fetches or falls back to http', async () => {
    for (const resolve of [undefined, async () => null, async () => { throw Error('resolver unavailable'); },
      async () => new Promise<string[] | null>(() => {})] as (WebResolver | undefined)[]) {
      const f = web({'https://fine.com/': page('x'), 'http://fine.com/': page('x')});
      const l = ledger();
      await expect(webTools(l.health, f.request, resolve).get('http://fine.com/', {...opts, timeoutMs: 20})).rejects.toBeInstanceOf(WebValidationError);
      expect(f.calls).toEqual([]);
      expect(l.rows.map(r => r.phase)).toEqual(['intent', 'unknown']);
    }
  });

  test('DNS is validated again after a redirect, including another path on the same host', async () => {
    for (const second of [null, ['10.0.0.7']]) {
      const f = web({'https://fine.com/': {status: 302, headers: {location: '/next'}}, 'https://fine.com/next': page('x')});
      let lookups = 0;
      const l = ledger();
      await expect(webTools(l.health, f.request, async () => ++lookups === 1 ? ['93.184.216.34'] : second).get('https://fine.com/', opts)).rejects.toThrow();
      expect(lookups).toBe(2);
      expect(f.calls.map(c => c.url)).toEqual(['https://fine.com/']);
      expect(l.rows.map(r => r.phase)).toEqual(['intent', 'response', 'intent', 'unknown']);
    }
  });

  test('Deno requires complete A and AAAA answers; a partial answer is unavailable', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    try {
      Object.defineProperty(globalThis, 'Deno', {configurable: true, value: {}});
      expect(denoResolver()).toBeUndefined();
      for (const a of [['93.184.216.34'], ['10.0.0.7']]) {
        const types: string[] = [];
        Object.defineProperty(globalThis, 'Deno', {configurable: true, value: {resolveDns: async (_host: string, type: string) => {
          types.push(type);
          if (type === 'AAAA') throw Object.assign(Error('blocked'), {name: 'PermissionDenied'});
          return a;
        }}});
        expect(await denoResolver()!('fine.com')).toBeNull();
        expect(types).toEqual(['A', 'AAAA']);
      }
      Object.defineProperty(globalThis, 'Deno', {configurable: true, value: {resolveDns: async (_host: string, type: string) => {
        if (type === 'AAAA') throw Object.assign(Error('no record'), {name: 'NotFound'});
        return ['93.184.216.34'];
      }}});
      expect(await denoResolver()!('fine.com')).toEqual(['93.184.216.34']);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'Deno', saved);
      else Reflect.deleteProperty(globalThis, 'Deno');
    }
  });

  test('a site on file as http is tried as https first, then as http', async () => {
    const tls = new TypeError('client error (Connect): invalid peer certificate: UnknownIssuer');
    const f = web({'https://old-site.com/': tls, 'http://old-site.com/': page('<title>Old site</title>')});
    const l = ledger();
    const out = await webTools(l.health, f.request, publicDns).get('http://old-site.com/', opts);
    expect([out.status, out.finalUrl]).toEqual([200, 'http://old-site.com/']);
    expect(f.calls.map(c => c.url)).toEqual(['https://old-site.com/', 'http://old-site.com/']);
    expect(l.rows.map(r => r.phase)).toEqual(['intent', 'unknown', 'intent', 'response']);
    // A working https answer wins at once.
    const g = web({'https://new-site.com/': page('<title>New</title>')});
    expect((await webTools(ledger().health, g.request, publicDns).get('http://new-site.com/', opts)).finalUrl).toBe('https://new-site.com/');
  });

  test('sent without cookies, with the honest agent and the referring page when asked', async () => {
    const f = web({'https://vimeo.com/api/oembed.json?url=x': {status: 200, body: '{}'}});
    await webTools(ledger().health, f.request, publicDns).get('https://vimeo.com/api/oembed.json?url=x', {...opts, purpose: 'oembed', referer: 'https://offer.maharamedia.com/'});
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.Referer).toBe('https://offer.maharamedia.com/');
    expect(headers['User-Agent']).toContain('MaharaSiteCheck');
    expect(headers.Cookie).toBeUndefined();
    expect(f.calls[0].init.redirect).toBe('manual');
  });

  test('error texts from Deno and Bun sort into their kinds', () => {
    expect(webFailureKind(new TypeError('client error (Connect): dns error: failed to lookup address information: nodename nor servname provided'), false)).toBe('dns');
    expect(webFailureKind(Object.assign(new Error('Unable to connect'), {code: 'ENOTFOUND'}), false)).toBe('dns');
    expect(webFailureKind(Object.assign(new Error('fetch failed'), {cause: {code: 'CERT_HAS_EXPIRED'}}), false)).toBe('tls');
    expect(webFailureKind(new TypeError('received fatal alert: HandshakeFailure'), false)).toBe('tls');
    expect(webFailureKind(new Error('tcp connect error: Connection refused (os error 111)'), false)).toBe('network');
    expect(webFailureKind(new Error('anything'), true)).toBe('timeout');
  });
});

// ---- The router ------------------------------------------------------------

const TASK = 'taskA1';
type Rpc = (args: Record<string, unknown>) => {data: unknown; error: {message: string; code?: string} | null};
function router(options: {rpc?: Record<string, Rpc>; routes?: Record<string, Answer | Answer[]>; healthFails?: boolean; resolve?: WebResolver} = {}) {
  const calls: {name: string; args: Record<string, unknown>}[] = [];
  const receipts: Record<string, unknown>[] = [];
  const f = web(options.routes ?? {});
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({name, args});
      const handler = options.rpc?.[name];
      if (!handler) throw new Error(`unexpected rpc ${name}`);
      return handler(args);
    },
    storage: {from: () => ({createSignedUrls: async (paths: string[]) => ({data: paths.map(path => ({path, signedUrl: `https://storage.test/${path}?token=t`, error: null})), error: null})})},
  };
  const admin = {
    from(table: string) {
      expect(table).toBe('cockpit_csm_provider_health');
      return {async insert(row: Record<string, unknown>) {
        receipts.push(row);
        return {error: options.healthFails ? {message: 'down'} : null};
      }};
    },
    async rpc() {
      throw new Error('unexpected admin rpc');
    },
    storage: {from: () => ({
      createSignedUploadUrl: async () => ({data: null, error: null}), uploadToSignedUrl: async () => ({data: null, error: null}),
      info: async () => ({data: null, error: null}), remove: async () => ({data: null, error: null}),
    })},
  };
  const run = (input: unknown) => runUpsell(client, admin, input, name => (name === 'SUPABASE_URL' ? 'https://db.test' : undefined), {request: f.request, resolve: options.resolve ?? publicDns, now: () => NOW});
  return {run, calls, receipts, fetches: f.calls};
}
async function refusal(p: Promise<unknown>): Promise<UpsellError> {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(UpsellError);
    return error as UpsellError;
  }
  throw new Error('Expected a refusal');
}
type SiteOut = {checks: {url: string; source: string; status: string; recorded: boolean; note?: string}[]; verdict: unknown; logoCandidates: unknown[]; note: string | null};
const sources = (urls: {url: string; from: string}[], checks: {checkedAt: string}[] = []) => () => ({data: {mode: 'proactive', site: {verdict: urls.length ? 'not_checked' : 'none_on_file', urls, checks}}, error: null});
const NOW = Date.parse('2026-10-26T10:00:00Z');
// As to_jsonb(timestamptz) writes it: microseconds and an offset.
const minutesAgo = (m: number) => ({checkedAt: new Date(NOW - m * 60_000).toISOString().replace('Z', '123+00:00')});
const recordOk = (args: Record<string, unknown>) => ({data: {check: {id: 1, ...(args.p_result as object)}, verdict: {verdict: 'failing', note: 'The site failed on 26 Oct.'}}, error: null});

const REQ = '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73';
const CAPTURE = {taskId: TASK, kind: 'capture', mime: 'image/png', bytes: 10, capturedOn: '2026-10-26'};

describe('runUpsell', () => {
  test('unavailable DNS reports a service problem without recording a false failing site', async () => {
    const r = router({resolve: async () => null, routes: {'https://acme.com/': page('<title>Acme</title>')},
      rpc: {cockpit_csm_offer_sources: sources([{url: 'https://acme.com/', from: 'card'}])}});
    const error = await refusal(r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}));
    expect(error.status).toBe(503);
    expect(error.message).toBe('The address could not be checked safely. Try again later.');
    expect(r.fetches).toEqual([]);
    expect(r.calls.map(c => c.name)).toEqual(['cockpit_csm_offer_sources']);
    expect(r.receipts.map(c => c.phase)).toEqual(['intent', 'unknown']);
  });

  test('the eight operations, and requests outside the rules refused before any call', async () => {
    expect(UPSELL_OPERATIONS).toEqual(['upsell.siteCheck', 'upsell.videoCheck', 'upsell.logoFind', 'upsell.logoPick', 'upsellFiles.reserve', 'upsellFiles.ready', 'upsellFiles.list', 'upsellFiles.remove']);
    for (const [input, words] of [
      [{operation: 'upsell.siteCheck', args: {taskId: '../x'}}, 'Open this from the client\'s page and try again.'],
      [{operation: 'upsell.logoFind', args: {}}, 'Open this from the client\'s page and try again.'],
      [{operation: 'upsellFiles.list', args: {taskId: '../x'}}, 'Choose a client and one of its captures.'],
      [{operation: 'upsell.siteCheck', args: {taskId: TASK, url: 'x'.repeat(301)}}, 'over 300 characters'],
      [{operation: 'upsell.videoCheck', args: {url: ''}}, 'Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.'],
      [{operation: 'upsell.logoPick', requestId: '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73', args: {taskId: TASK}}, 'Pick one of the pictures'],
      // Saving a logo is a write: without a request id a retry would save it twice.
      [{operation: 'upsell.logoPick', args: {taskId: TASK, url: 'https://acme-interiors.com/logo.png'}}, 'A request id is required to save a logo.'],
      [{operation: 'upsellFiles.reserve', args: {taskId: TASK, kind: 'capture', mime: 'image/png', bytes: 10, capturedOn: '2026-10-26'}}, 'An upload request id is required.'],
      // A full-page capture on a retina screen runs past 20,000 pixels: the sentence says how to fix it.
      [{operation: 'upsellFiles.reserve', requestId: REQ, args: {...CAPTURE, height: 24_000}}, 'The picture is over 20,000 pixels on a side. Crop it to the part that shows the gap, then add it again.'],
      [{operation: 'upsellFiles.reserve', requestId: REQ, args: {...CAPTURE, width: 0}}, 'The picture\'s size could not be read. Add it again.'],
      [{operation: 'upsellFiles.reserve', requestId: REQ, args: {...CAPTURE, fileName: `${'x'.repeat(401)}.png`}}, 'The file name is too long. Rename the file, then add it again.'],
      [{operation: 'upsell.videoCheck', args: {url: `https://youtu.be/${'x'.repeat(2000)}`}}, 'That link is too long. Copy the video\'s share link.'],
      [{operation: 'upsell.nope', args: {}}, 'Unknown upsell operation.'],
    ] as [unknown, string][]) {
      const r = router();
      const error = await refusal(r.run(input));
      expect([error.status, error.message]).toEqual([400, expect.stringContaining(words)]);
      expect([r.calls, r.fetches, r.receipts]).toEqual([[], [], []]);
    }
  });

  test('siteCheck: the gate refuses another client with a 403 before anything is read', async () => {
    const r = router({rpc: {cockpit_csm_offer_sources: () => ({data: null, error: {message: 'That client is not on your access list', code: '42501'}})}});
    const error = await refusal(r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}));
    expect([error.status, error.message]).toEqual([403, 'That client is not on your access list']);
    expect(r.fetches).toEqual([]);
  });

  test('siteCheck checks each address on file once, records each as the seat, and finds logos on the page that opened', async () => {
    const r = router({
      rpc: {
        cockpit_csm_offer_sources: sources([{url: 'acme-interiors.com', from: 'card'}, {url: 'https://www.acme-interiors.com/', from: 'onboarding'}, {url: 'https://acme-build.com', from: 'prep'}]),
        cockpit_client_site_check_record: recordOk,
      },
      routes: {
        'https://acme-interiors.com/': page('<html><title>acme-interiors.com</title><body>This domain may be for sale! <a href="https://sedo.com/search/details/?domain=acme-interiors.com">Buy</a></body></html>'),
        'https://acme-build.com/': page('<html><head><title>Acme Build</title><link rel="apple-touch-icon" sizes="180x180" href="/apple.png"></head><body><header><img src="/img/logo.webp" width="240" height="80"></header><p>We design and build homes across Kuwait.</p></body></html>'),
      },
    });
    const out = await r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}) as SiteOut;
    // The onboarding address is the card's own once www. and the slash are dropped: checked once.
    expect(out.checks.map(c => [c.url, c.source, c.status, c.recorded])).toEqual([
      ['https://acme-interiors.com', 'card', 'parked', true], ['https://acme-build.com', 'prep', 'ok', true],
    ]);
    expect(r.calls.filter(c => c.name === 'cockpit_client_site_check_record').map(c => c.args)).toEqual([
      {p_task_id: TASK, p_url: 'https://acme-interiors.com', p_source: 'card', p_result: {status: 'parked', httpStatus: 200, finalUrl: 'https://acme-interiors.com/', title: 'acme-interiors.com'}},
      {p_task_id: TASK, p_url: 'https://acme-build.com', p_source: 'prep', p_result: {status: 'ok', httpStatus: 200, finalUrl: 'https://acme-build.com/', title: 'Acme Build'}},
    ]);
    expect(out.verdict).toEqual({verdict: 'failing', note: 'The site failed on 26 Oct.'});
    expect(out.logoCandidates).toEqual([
      {url: 'https://acme-build.com/img/logo.webp', kind: 'header', width: 240, height: 80},
      {url: 'https://acme-build.com/apple.png', kind: 'apple', width: 180, height: 180},
    ]);
    expect(r.receipts.every(row => /^site:[a-z.-]+$/.test(String(row.resource)))).toBe(true);
  });

  test('siteCheck: a typed address keeps the source it has on file, else prep; a non-address is not checked or recorded', async () => {
    const r = router({
      rpc: {cockpit_csm_offer_sources: sources([{url: 'N/A', from: 'card'}]), cockpit_client_site_check_record: recordOk},
      routes: {'https://acme-new.com/': page('<title>Acme</title><p>Kitchens and villas, designed and built for families in Kuwait City.</p>')},
    });
    const out = await r.run({operation: 'upsell.siteCheck', args: {taskId: TASK, url: 'acme-new.com'}}) as SiteOut;
    expect(out.checks.map(c => [c.url, c.source, c.status, c.recorded])).toEqual([['https://acme-new.com', 'prep', 'ok', true], ['N/A', 'card', 'refused', false]]);
    expect(out.checks[1].note).toBe('"N/A" is not a web address. Fix it on the card or in prep.');
    expect(r.calls.filter(c => c.name === 'cockpit_client_site_check_record').map(c => c.args.p_url)).toEqual(['https://acme-new.com']);
  });

  test('siteCheck: the hourly cap after a recorded check returns what was checked, with the sentence', async () => {
    let n = 0;
    const r = router({
      rpc: {
        cockpit_csm_offer_sources: sources([{url: 'https://a-site.com', from: 'card'}, {url: 'https://b-site.com', from: 'onboarding'}]),
        cockpit_client_site_check_record: args => (n++ === 0 ? recordOk(args) : {data: null, error: {message: 'Checked 6 times this hour. Try again later.', code: '22023'}}),
      },
      routes: {'https://a-site.com/': page('<title>A</title><p>Our projects</p>'), 'https://b-site.com/': page('<title>B</title><p>Our projects</p>')},
    });
    const out = await r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}) as SiteOut;
    expect(out.checks.map(c => c.recorded)).toEqual([true, false]);
    expect(out.note).toBe('Checked 6 times this hour. Try again later.');
    // The cap on the first check is the answer itself.
    const first = router({
      rpc: {cockpit_csm_offer_sources: sources([{url: 'https://a-site.com', from: 'card'}]), cockpit_client_site_check_record: () => ({data: null, error: {message: 'Checked 6 times this hour. Try again later.', code: '22023'}})},
      routes: {'https://a-site.com/': page('<title>A</title><p>Our projects</p>')},
    });
    expect((await refusal(first.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}))).message).toBe('Checked 6 times this hour. Try again later.');
  });

  test('siteCheck: 6 checks this hour already means no outside read and no receipt; fewer left means fewer addresses read', async () => {
    const onFile = [{url: 'https://a-site.com', from: 'card'}, {url: 'https://b-site.com', from: 'onboarding'}, {url: 'https://c-site.com', from: 'prep'}];
    const routes = {'https://a-site.com/': page('<title>A</title><p>Our projects</p>'), 'https://b-site.com/': page('<title>B</title><p>Our projects</p>'), 'https://c-site.com/': page('<title>C</title><p>Our projects</p>')};
    let r = router({rpc: {cockpit_csm_offer_sources: sources(onFile, [1, 5, 10, 20, 30, 59].map(minutesAgo)), cockpit_client_site_check_record: recordOk}, routes});
    const recordCalls = () => r.calls.filter(c => c.name === 'cockpit_client_site_check_record').length;
    const capped = await r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}) as SiteOut;
    expect([capped.checks, capped.logoCandidates, capped.note]).toEqual([[], [], 'Checked 6 times this hour. Try again later.']);
    expect(capped.verdict).toMatchObject({verdict: 'not_checked'});
    expect([r.fetches, r.receipts, recordCalls()]).toEqual([[], [], 0]);
    // Four this hour (and older ones that no longer count): two addresses are read, not three.
    r = router({rpc: {cockpit_csm_offer_sources: sources(onFile, [...[2, 3, 4, 50].map(minutesAgo), ...[61, 90, 300].map(minutesAgo)]), cockpit_client_site_check_record: recordOk}, routes});
    const two = await r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}) as SiteOut;
    expect(two.checks.map(c => c.url)).toEqual(['https://a-site.com', 'https://b-site.com']);
    expect(r.fetches.map(f => f.url)).toEqual(['https://a-site.com/', 'https://b-site.com/']);
    expect(recordCalls()).toBe(2);
  });

  test('siteCheck with no address on file says so and reads nothing', async () => {
    const r = router({rpc: {cockpit_csm_offer_sources: sources([])}});
    const out = await r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}) as SiteOut;
    expect([out.checks, out.note]).toEqual([[], 'No website on file: not on the card, the onboarding form or prep. Type one in prep to check it.']);
    expect(r.fetches).toEqual([]);
  });

  test('videoCheck is for client success seats: the price list\'s read checks the seat first, and a refused seat reads nothing outside', async () => {
    const r = router({rpc: {cockpit_upsell_catalog_read: () => ({data: null, error: {message: 'Active client-success access required', code: '42501'}})}});
    const error = await refusal(r.run({operation: 'upsell.videoCheck', args: {url: 'https://youtu.be/abcdefghijk'}}));
    expect([error.status, error.message]).toEqual([403, 'Active client-success access required']);
    expect(r.calls).toEqual([{name: 'cockpit_upsell_catalog_read', args: {}}]);
    expect([r.fetches, r.receipts]).toEqual([[], []]);
  });

  test('videoCheck: a link the decks\' rule refuses comes back as a refusal with nothing read; a public one is checked', async () => {
    const seat = () => ({data: {rows: [], settings: {}, videos: [], isCeo: false}, error: null});
    const bad = router({rpc: {cockpit_upsell_catalog_read: seat}});
    expect(await bad.run({operation: 'upsell.videoCheck', args: {url: 'https://example.com/v'}})).toEqual({
      ok: false, provider: null, url: null, embedUrl: null, title: null, durationSeconds: null, posterUrl: null, refusal: 'Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.',
    });
    expect([bad.fetches, bad.receipts]).toEqual([[], []]);
    // Over the parser's 500 but under the request's own cap: the parser's own sentence, still nothing read.
    const long = router({rpc: {cockpit_upsell_catalog_read: seat}});
    expect(await long.run({operation: 'upsell.videoCheck', args: {url: `https://www.youtube.com/watch?v=abcdefghijk&${'x'.repeat(600)}`}})).toMatchObject({ok: false, refusal: 'That link is too long. Copy the video\'s share link.'});
    expect([long.fetches, long.receipts]).toEqual([[], []]);
    const folder = router({rpc: {cockpit_upsell_catalog_read: seat}});
    expect(await folder.run({operation: 'upsell.videoCheck', args: {url: 'https://drive.google.com/drive/folders/abc'}})).toMatchObject({ok: false, refusal: 'That Drive link is a folder. Paste the link to the video file.'});
    const good = router({
      rpc: {cockpit_upsell_catalog_read: seat},
      routes: {
        'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabcdefghijk': {status: 200, body: JSON.stringify({title: 'Your new website', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'})},
        'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg': {status: 200, headers: {'content-type': 'image/jpeg'}, body: new Uint8Array(10)},
      },
    });
    expect(await good.run({operation: 'upsell.videoCheck', args: {url: 'https://youtu.be/abcdefghijk'}})).toEqual({
      ok: true, provider: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&playsinline=1&enablejsapi=1',
      title: 'Your new website', durationSeconds: null, posterUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    });
    expect(good.calls.map(c => c.name)).toEqual(['cockpit_upsell_catalog_read']);
    // Host-only receipts: the oEmbed host and the poster host, never a path or the video's id.
    expect([...new Set(good.receipts.map(x => x.resource))]).toEqual(['oembed:www.youtube.com', 'thumbnail:i.ytimg.com']);
  });

  test('a database without the offers functions says so in a plain sentence', async () => {
    const r = router({rpc: {cockpit_csm_offer_sources: () => ({data: null, error: {message: 'Could not find the function public.cockpit_csm_offer_sources', code: 'PGRST202'}})}});
    const error = await refusal(r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}));
    expect([error.status, error.message]).toEqual([503, 'Offers are not set up on the server yet. Tell the CEO.']);
    // The video check before migration u: the price list's read is missing too, and nothing is read outside.
    const v = router({rpc: {cockpit_upsell_catalog_read: () => ({data: null, error: {message: 'Could not find the function public.cockpit_upsell_catalog_read', code: 'PGRST202'}})}});
    expect((await refusal(v.run({operation: 'upsell.videoCheck', args: {url: 'https://youtu.be/abcdefghijk'}}))).status).toBe(503);
    expect(v.fetches).toEqual([]);
  });

  test('a receipt that cannot be saved stops the check: 503, nothing fetched, nothing recorded', async () => {
    const r = router({
      healthFails: true,
      rpc: {cockpit_csm_offer_sources: sources([{url: 'https://a-site.com', from: 'card'}]), cockpit_client_site_check_record: recordOk},
      routes: {'https://a-site.com/': page('<title>A</title>')},
    });
    const error = await refusal(r.run({operation: 'upsell.siteCheck', args: {taskId: TASK}}));
    expect([error.status, error.message]).toEqual([503, 'The cockpit could not log this check, so nothing was read or changed. Try again in a minute. If it keeps happening, tell the CEO.']);
    expect(r.fetches).toEqual([]);
    expect(r.calls.map(c => c.name)).toEqual(['cockpit_csm_offer_sources']);
  });
});
