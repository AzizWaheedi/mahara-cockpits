import {describe, expect, test} from 'bun:test';
import {WebError, type WebResult, webTools} from './tools.ts';
import {checkSite, classifySite, decodeEntities, logoCandidates, pageTitle, siteAddress, siteDomain} from './upsellSite.ts';

// The site check's verdict per page. The fixtures are cut-down copies of
// what each kind of page carries (the markers the classifier reads: the
// parking lander's scripts and words, the builder's expired or unpublished
// notice, the host's default page), not whole saved pages.

const res = (body: string, status = 200, finalUrl = 'https://acme-interiors.com/', headers: Record<string, string> = {}): WebResult => ({
  status, finalUrl, headers: new Headers({'content-type': 'text/html; charset=utf-8', ...headers}), body: new TextEncoder().encode(body), redirects: [], truncated: false,
});
const START = 'https://acme-interiors.com';

const FIXTURES: Record<string, string> = {
  godaddy: `<!DOCTYPE html><html><head><title>acme-interiors.com</title>
    <script src="https://img1.wsimg.com/parking-lander/static/js/main.d2b1ecbc.js"></script></head>
    <body><div id="root"></div><noscript>Get This Domain</noscript></body></html>`,
  godaddyOld: `<html><head><title>acme-interiors.com</title></head><body><p>This Web page is parked for FREE, courtesy of GoDaddy.com.</p></body></html>`,
  sedo: `<html><head><title>acme-interiors.com</title></head><body>
    <div class="sale">This domain may be for sale!</div>
    <script type="text/javascript" src="https://sedoparking.com/frmpark/acme-interiors.com/IONOSParkingUS/park.js"></script></body></html>`,
  dan: `<html><head><title>acme-interiors.com is for sale</title></head><body><h1>The domain name acme-interiors.com is for sale</h1>
    <a href="https://dan.com/buy-domain/acme-interiors.com?redirected=true">Buy now</a></body></html>`,
  squarespace: `<html><head><title>Website Expired</title></head><body><div class="message"><h1>Website Expired</h1>
    <p>The owner of this website needs to renew their Squarespace subscription.</p></div></body></html>`,
  wix: `<html><head><title>Wix.com - This Site Was Not Published</title></head><body>
    <h1>Looks like this domain isn't connected to a website yet!</h1><a href="https://www.wix.com/">Connect Your Domain</a></body></html>`,
  cpanel: `<!DOCTYPE html><html><head><title>Default Web Site Page</title></head><body>
    <h1>Sorry!</h1><p>If you are the owner of this website, please contact your hosting provider: webmaster@acme-interiors.com</p>
    <p>It is possible you have reached this page because:</p><img src="/img-sys/cpanel_logo.png"></body></html>`,
  nginx: `<html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed.</p></body></html>`,
  comingSoon: `<html><head><title>Acme Interiors</title></head><body><h1>Coming soon</h1><p>Our new website is on its way.</p></body></html>`,
  comingSoonArabic: `<html dir="rtl"><head><title>أكمي</title></head><body><h1>قريباً</h1></body></html>`,
  blank: `<html><head></head><body>   </body></html>`,
  realSite: `<!DOCTYPE html><html lang="en"><head><title>Acme Interiors | Design &amp; Build in Kuwait</title>
    <meta property="og:image" content="https://acme-interiors.com/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="shortcut icon" href="/favicon.ico">
    <link rel="apple-touch-icon" href="https://cdn.acme-interiors.com/apple-touch-icon.png" sizes="180x180"></head>
    <body><header class="top"><a href="/"><img src="/assets/acme-logo.svg" alt="Acme Interiors"></a></header>
    <main><h1>Villas and fit-outs, designed and built</h1><p>From the first sketch to the keys, one team in Kuwait City. Coming soon: our Salmiya showroom.</p>
    <img src="http://acme-interiors.com/uploads/projects/villa.jpg" class="hero"></main></body></html>`,
  spa: `<!doctype html><html><head><title>Acme</title><script type="module" src="/assets/index-4f3b.js"></script></head><body><div id="root"></div></body></html>`,
  challenge: `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`,
  // A working page behind Cloudflare carries its JS detections script; that is not a bot check.
  cloudflareSite: `<!DOCTYPE html><html><head><title>Acme Interiors</title></head><body><h1>Villas and fit-outs</h1><p>Designed and built in Kuwait City.</p>
    <script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.head.appendChild(a);})();</script></body></html>`,
  notFound: `<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>`,
};

describe('classifySite: what the page says wins over its status', () => {
  test('parked pages (GoDaddy, Sedo, Dan) are parked even when they answer 200', () => {
    for (const name of ['godaddy', 'godaddyOld', 'sedo', 'dan']) {
      const out = classifySite(START, res(FIXTURES[name]));
      expect([name, out.status, out.httpStatus]).toEqual([name, 'parked', 200]);
      expect(out.note).toBe('The domain shows a parking or for-sale page.');
    }
  });

  test('a Squarespace site whose plan ran out, and a Wix site never published (answering 404)', () => {
    expect(classifySite(START, res(FIXTURES.squarespace)).status).toBe('expired');
    const wix = classifySite(START, res(FIXTURES.wix, 404));
    expect([wix.status, wix.httpStatus, wix.title]).toEqual(['expired', 404, 'Wix.com - This Site Was Not Published']);
  });

  test('a host default page, a coming soon page and a blank page are empty', () => {
    for (const name of ['cpanel', 'nginx', 'comingSoon', 'comingSoonArabic', 'blank']) expect([name, classifySite(START, res(FIXTURES[name])).status]).toEqual([name, 'empty']);
    // A real site that mentions what is coming soon is not.
    expect(classifySite(START, res(FIXTURES.realSite)).status).toBe('ok');
    // A page built by its scripts has no text until they run: it is not called empty.
    expect(classifySite(START, res(FIXTURES.spa)).status).toBe('ok');
  });

  test('a working site: its title, entities decoded, and where it ended without the query', () => {
    const out = classifySite(START, res(FIXTURES.realSite, 200, 'https://www.acme-interiors.com/en/?utm_source=x#top'));
    expect(out).toEqual({status: 'ok', httpStatus: 200, finalUrl: 'https://www.acme-interiors.com/en/', title: 'Acme Interiors | Design & Build in Kuwait', note: 'The site opened.'});
  });

  test('404, and a server error', () => {
    expect(classifySite(START, res(FIXTURES.notFound, 404))).toMatchObject({status: 'http_error', httpStatus: 404, note: 'The site answered with an error (HTTP 404).'});
    expect(classifySite(START, res('<h1>Bad gateway</h1>', 502)).status).toBe('http_error');
  });

  test('turned away (a firewall, a bot check, a login) is not checked: never ok, never a failure', () => {
    const turned = 'The site turned the automatic check away (HTTP 403). Open it in a browser and take a capture.';
    expect(classifySite(START, res(FIXTURES.challenge, 403, `${START}/`, {'cf-mitigated': 'challenge'}))).toMatchObject({status: 'refused', httpStatus: 403, note: turned});
    expect(classifySite(START, res(FIXTURES.challenge, 503))).toMatchObject({status: 'refused', httpStatus: 503});
    // A plain 403 with no bot check on it, as a firewall answers: still not a verdict on the site.
    expect(classifySite(START, res('<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1></body></html>', 403))).toMatchObject({status: 'refused', httpStatus: 403, note: turned});
    for (const status of [401, 406, 429]) expect([status, classifySite(START, res('<h1>No</h1>', status)).status]).toEqual([status, 'refused']);
    // The challenge header on any status. On a 200 the sentence does not quote the status, which said nothing.
    expect(classifySite(START, res('<p>Checking your browser</p>', 200, `${START}/`, {'cf-mitigated': 'challenge'}))).toMatchObject({
      status: 'refused', httpStatus: 200, note: 'The site showed a bot check instead of its page. Open it in a browser and take a capture.',
    });
    expect(classifySite(START, res(FIXTURES.challenge)).note).toBe('The site showed a bot check instead of its page. Open it in a browser and take a capture.');
    // A working page that loads Cloudflare's detections script is a working page; a 503 without a bot check is an error.
    expect(classifySite(START, res(FIXTURES.cloudflareSite)).status).toBe('ok');
    expect(classifySite(START, res('<h1>Service Unavailable</h1>', 503)).status).toBe('http_error');
  });

  test('an address on file that is Instagram, or that sends visitors to Instagram', () => {
    expect(classifySite('https://www.instagram.com/acme.interiors/', null)).toMatchObject({status: 'instagram', httpStatus: null, note: 'The address is an Instagram page, not a website.'});
    expect(classifySite(START, res('<title>Instagram</title>', 200, 'https://www.instagram.com/acme.interiors/')).status).toBe('instagram');
  });

  test('sent to a link page or a profile: offsite; the same site, or the client\'s other domain that opened, is not', () => {
    const away = classifySite(START, res('<title>Linktree</title><p>Acme links</p>', 200, 'https://linktr.ee/acme'));
    expect([away.status, away.note]).toEqual(['redirect_offsite', 'The address sends visitors to another site (linktr.ee).']);
    expect(classifySite('https://acme.com', res('<title>Acme</title><p>Acme links</p>', 200, 'https://linktr.ee/acme')).status).toBe('redirect_offsite');
    // A profile that turns the check away is still not a site.
    expect(classifySite(START, res('<h1>Forbidden</h1>', 403, 'https://www.tiktok.com/@acme')).status).toBe('redirect_offsite');
    expect(classifySite(START, res(FIXTURES.realSite, 200, 'https://www.acme-interiors.com/ar/')).status).toBe('ok');
    expect(classifySite('https://acme.com.kw', res(FIXTURES.realSite, 200, 'https://www.acme.com.kw/')).status).toBe('ok');
    // A .com that sends visitors to the client's country domain, or a rebrand, which opened: their site works.
    expect(classifySite('https://acme.com', res(FIXTURES.realSite, 200, 'https://www.acme.com.kw/'))).toMatchObject({
      status: 'ok', finalUrl: 'https://www.acme.com.kw/', note: 'The address sends visitors to www.acme.com.kw, which opened.',
    });
    expect(siteDomain('shop.acme.com.kw')).toBe('acme.com.kw');
    expect(siteDomain('www.acme.co.uk')).toBe('acme.co.uk');
    expect(siteDomain('acme-interiors.com')).toBe('acme-interiors.com');
  });

  test('what webTools threw: dns, tls, timeout, a dead connection, a refusal, a hop it would not follow', () => {
    const cases: [WebError, string][] = [
      [new WebError('x', 'dns', 'https://acme-interiors.com/'), 'dns'],
      [new WebError('x', 'tls', 'https://acme-interiors.com/'), 'tls'],
      [new WebError('x', 'timeout', 'https://acme-interiors.com/'), 'timeout'],
      [new WebError('x', 'network', 'https://acme-interiors.com/'), 'http_error'],
      [new WebError('x', 'redirects', 'https://acme-interiors.com/'), 'http_error'],
      [new WebError('That address is inside a private network, so it is not read.', 'refused', 'https://acme-interiors.com/'), 'refused'],
      [new WebError('x', 'refused', 'http://10.0.0.1/'), 'redirect_offsite'],
    ];
    for (const [error, status] of cases) expect([error.kind, classifySite(START, error).status]).toEqual([error.kind, status]);
    expect(classifySite(START, new WebError('x', 'dns', null)).note).toBe('The address does not exist (no DNS record).');
    // The address on file itself is refused: fix it where it came from.
    expect(classifySite('https://localhost', new WebError('That address is inside a private network, so it is not read.', 'refused', 'https://localhost/')).note)
      .toBe('That address is inside a private network, so it is not read. Fix it on the card or in prep.');
    expect(classifySite('https://acme-interiors.com:8443', new WebError('An address on another port is not read.', 'refused', 'https://acme-interiors.com:8443/')).note)
      .toBe('An address on another port is not read. Fix it on the card or in prep.');
    // The site itself sends visitors to an address that is not read (same host, another port): take a capture instead.
    expect(classifySite(START, new WebError('An address on another port is not read.', 'refused', 'https://acme-interiors.com:8443/'))).toMatchObject({
      status: 'refused', note: 'An address on another port is not read. Open it in a browser and take a capture.',
    });
    // A redirect loop reached the site: it is not called unreachable.
    expect(classifySite(START, new WebError('The address redirects more than 5 times.', 'redirects', 'https://acme-interiors.com/a'))).toMatchObject({
      status: 'http_error', note: 'The address redirects more than 5 times, so the check never reached a page. Open it in a browser and take a capture.',
    });
    expect(classifySite(START, new WebError('x', 'network', 'https://acme-interiors.com/')).note).toBe('The site could not be reached.');
  });
});

describe('through webTools, as the check runs', () => {
  const run = async (routes: Record<string, Response | Error | 'hang'>, url: string, timeoutMs = 2000) => {
    const request = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const answer = routes[String(input)];
      if (answer === 'hang') return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      if (!answer) throw new TypeError('client error (Connect): dns error: failed to lookup address information: Name or service not known');
      if (answer instanceof Error) throw answer;
      return answer;
    }) as typeof fetch;
    const rows: Record<string, unknown>[] = [];
    const tools = webTools(async row => {
      rows.push(row);
    }, request, async () => ['93.184.216.34']);
    // checkSite uses its own 12 s deadline; the timeout case runs through webTools directly.
    if (timeoutMs !== 2000) {
      try {
        await tools.get(url, {purpose: 'site', maxBytes: 1000, timeoutMs});
      } catch (error) {
        return {result: classifySite(url, error), html: null, finalUrl: null, rows};
      }
    }
    return {...(await checkSite(tools, url)), rows};
  };

  test('DNS: the name does not exist', async () => {
    const {result, rows} = await run({}, 'https://acme-interiors-gone.com');
    expect(result.status).toBe('dns');
    expect(rows.map(r => r.phase)).toEqual(['intent', 'unknown']);
  });

  test('TLS: a certificate that expired', async () => {
    const {result} = await run({'https://acme-interiors.com/': new TypeError('client error (Connect): invalid peer certificate: Expired')}, START);
    expect(result.status).toBe('tls');
  });

  test('timeout: no answer within the deadline', async () => {
    const {result} = await run({'https://acme-interiors.com/': 'hang'}, START, 30);
    expect(result.status).toBe('timeout');
  });

  test('Instagram on file is never fetched', async () => {
    const {result, rows} = await run({}, 'https://instagram.com/acme.interiors');
    expect(result.status).toBe('instagram');
    expect(rows).toEqual([]);
  });

  test('a redirect to Instagram, and a 404 that follows a redirect', async () => {
    const insta = await run({
      'https://acme-interiors.com/': new Response(null, {status: 301, headers: {location: 'https://www.instagram.com/acme.interiors/'}}),
      'https://www.instagram.com/acme.interiors/': new Response('<title>Instagram</title>', {status: 200}),
    }, START);
    expect(insta.result.status).toBe('instagram');
    const gone = await run({
      'https://acme-interiors.com/': new Response(null, {status: 302, headers: {location: '/home'}}),
      'https://acme-interiors.com/home': new Response(FIXTURES.notFound, {status: 404}),
    }, START);
    expect([gone.result.status, gone.result.httpStatus, gone.result.finalUrl, gone.html]).toEqual(['http_error', 404, 'https://acme-interiors.com/home', null]);
  });

  test('a working page hands its HTML back for logo candidates', async () => {
    const ok = await run({'https://acme-interiors.com/': new Response(FIXTURES.realSite, {status: 200})}, START);
    expect(ok.result.status).toBe('ok');
    expect(ok.html).toContain('acme-logo.svg');
    expect(ok.finalUrl).toBe('https://acme-interiors.com/');
  });
});

describe('logo candidates on the client\'s page', () => {
  test('header and logo pictures first, then the touch icon, og:image and icons; SVG, ICO and GIF skipped; http asked as https', () => {
    expect(logoCandidates(FIXTURES.realSite, 'https://acme-interiors.com/')).toEqual([
      {url: 'https://cdn.acme-interiors.com/apple-touch-icon.png', kind: 'apple', width: 180, height: 180},
      {url: 'https://acme-interiors.com/og.jpg', kind: 'og', width: 1200, height: 630},
    ]);
    const html = `<header><img data-src="/logo-dark.png" width="200" height="60"><img src="data:image/png;base64,AAA"></header>
      <img class="site-logo" src="http://acme-interiors.com/logo-light.webp">
      <meta property="og:image" content="/share.gif"><link rel="icon" type="image/x-icon" href="/favicon.png">
      <link rel="icon" href="https://127.0.0.1/evil.png"><link rel="icon" href="/favicon.png">`;
    expect(logoCandidates(html, 'https://acme-interiors.com/en/')).toEqual([
      {url: 'https://acme-interiors.com/logo-dark.png', kind: 'header', width: 200, height: 60},
      {url: 'https://acme-interiors.com/logo-light.webp', kind: 'header'},
      {url: 'https://acme-interiors.com/favicon.png', kind: 'icon'},
    ]);
  });

  test('an icon declared under 64 pixels is left out (the pick refuses it); a 192 one is kept; a small <img> is not judged by its drawn size', () => {
    const html = `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" sizes="57x57" href="/apple-57.png">
      <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"><img class="logo" src="/logo.png" width="40" height="40">`;
    expect(logoCandidates(html, 'https://acme-interiors.com/')).toEqual([
      {url: 'https://acme-interiors.com/logo.png', kind: 'header', width: 40, height: 40},
      {url: 'https://acme-interiors.com/icon-192.png', kind: 'icon', width: 192, height: 192},
    ]);
  });

  test('at most 8, each once', () => {
    const html = Array.from({length: 20}, (_, i) => `<link rel="icon" href="/i${i}.png"><link rel="icon" href="/i${i}.png">`).join('');
    const out = logoCandidates(html, 'https://acme-interiors.com/');
    expect(out.length).toBe(8);
    expect(new Set(out.map(c => c.url)).size).toBe(8);
  });
});

describe('addresses, titles and entities', () => {
  test('an address on file as the check reads it', () => {
    expect(siteAddress('acme-interiors.com')).toEqual({url: 'https://acme-interiors.com', problem: null});
    expect(siteAddress(' http://acme-interiors.com/ ')).toEqual({url: 'http://acme-interiors.com/', problem: null});
    expect(siteAddress('no website yet').url).toBeNull();
    expect(siteAddress('N/A')).toEqual({url: null, problem: '"N/A" is not a web address. Fix it on the card or in prep.'});
    expect(siteAddress('mailto:info@acme.com').url).toBeNull();
    expect(siteAddress('ftp://acme.com')).toEqual({url: null, problem: 'Only http and https addresses can be checked. Fix it on the card or in prep.'});
    expect(siteAddress('x'.repeat(301)).problem).toBe('The address is over 300 characters. Fix it on the card or in prep.');
  });

  test('a title is one clean line of at most 200 characters', () => {
    expect(pageTitle('<title>\n  Acme &amp; Sons &#8211; Kuwait\u202e </title>')).toBe('Acme & Sons \u2013 Kuwait');
    expect(pageTitle(`<title>${'a'.repeat(300)}</title>`)?.length).toBe(200);
    expect(pageTitle('<p>no title</p>')).toBeNull();
    expect(decodeEntities('&#x627;&#1604;&lt;b&gt;&bogus;')).toBe('ال<b>&bogus;');
  });

  test('an Arabic page in windows-1256 reads as Arabic', () => {
    const body = new Uint8Array([0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, 0xc7, 0xe1, 0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e]);
    const out = classifySite(START, {status: 200, finalUrl: `${START}/`, headers: new Headers({'content-type': 'text/html; charset=windows-1256'}), body, redirects: [], truncated: false});
    expect(out.title).toBe('ال');
  });
});
