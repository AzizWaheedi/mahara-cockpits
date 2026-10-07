import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transport } from './transport';

describe('transport', () => {
 const baseEnv = {
  SUPABASE_URL: 'https://bldgtotkfmhoxmlzowdx.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  SUPABASE_ACCESS_TOKEN: 'test-token',
  META_SYSTEM_TOKEN: 'test-meta',
  CLICKUP_API_TOKEN: 'test-clickup',
  GOOGLE_APPLICATION_CREDENTIALS: 'test-creds',
  TYPEFORM_TOKEN: 'test-typeform',
  FATHOM_API_KEY: 'test-fathom',
  GHL_CLIENT_PIT: 'test-ghl',
 };

 it('retries 429 with Retry-After seconds and succeeds', async () => {
  const delays: number[] = [];
  const wait = async (ms: number) => { delays.push(ms); };
  let calls = 0;
  let bodyCanceled = false;

  const mockFetch: typeof fetch = async () => {
   calls++;
   if (calls === 1) {
    return new Response(
     new ReadableStream({
      cancel() { bodyCanceled = true; }
     }),
     { status: 429, headers: { 'Retry-After': '5' } }
    );
   }
   return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  const res = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.equal(bodyCanceled, true);
  assert.deepEqual(delays, [5000]);
  assert.equal(t.faults.length, 0);
  assert.equal(t.receipts.length, 4); // intent, response(429), intent, response(200)
 });

 it('fails when 429 retries are exhausted after 3 attempts', async () => {
  const delays: number[] = [];
  const wait = async (ms: number) => { delays.push(ms); };
  let calls = 0;
  let canceledCount = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   return new Response(
    new ReadableStream({
     cancel() { canceledCount++; }
    }),
    { status: 429, headers: { 'Retry-After': '2' } }
   );
  };

  const t = transport(baseEnv, mockFetch, wait);
  const res = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(res.status, 429);
  assert.equal(calls, 3);
  assert.equal(canceledCount, 2); // canceled before retry 2 and retry 3
  assert.deepEqual(delays, [2000, 2000]);
  assert.equal(t.faults.length, 1);
  assert.equal(t.faults[0].status, 429);
 });

 it('fails immediately without early retry when Retry-After exceeds 60 seconds', async () => {
  const delays: number[] = [];
  const wait = async (ms: number) => { delays.push(ms); };
  let calls = 0;
  let bodyCanceled = false;

  const mockFetch: typeof fetch = async () => {
   calls++;
   return new Response(
    new ReadableStream({
     cancel() { bodyCanceled = true; }
    }),
    { status: 429, headers: { 'Retry-After': '120' } }
   );
  };

  const t = transport(baseEnv, mockFetch, wait);
  const res = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(res.status, 429);
  assert.equal(calls, 1);
  assert.equal(bodyCanceled, true);
  assert.deepEqual(delays, []);
  assert.equal(t.faults.length, 1);
  assert.equal(t.faults[0].status, 429);
 });

 it('parses standard HTTP-date in Retry-After header correctly', async () => {
  const delays: number[] = [];
  const wait = async (ms: number) => { delays.push(ms); };
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   if (calls === 1) {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    return new Response('rate limited', {
     status: 503,
     headers: { 'Retry-After': futureDate }
    });
   }
   return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  const res = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 9000 && delays[0] <= 11000);
 });

 it('falls back to bounded existing backoff on malformed, negative, or fractional Retry-After headers', async () => {
  const badHeaders = ['invalid-date', '-5', '2.5', '2026-10-07T21:30:00Z', 'NaN'];
  for (const bad of badHeaders) {
   const delays: number[] = [];
   const wait = async (ms: number) => { delays.push(ms); };
   let calls = 0;

   const mockFetch: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
     return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': bad }
     });
    }
    return new Response(JSON.stringify({ data: [] }), {
     status: 200,
     headers: { 'Content-Type': 'application/json' }
    });
   };

   const t = transport(baseEnv, mockFetch, wait);
   const res = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
   assert.equal(res.status, 200);
   assert.equal(calls, 2);
   assert.deepEqual(delays, [1000]); // attempt 1 fallback is 1000ms
  }
 });

 it('serializes and paces native Fathom requests with 1500ms spacing', async () => {
  const waitLog: number[] = [];
  const wait = async (ms: number) => { waitLog.push(ms); };
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   return new Response(JSON.stringify({ items: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);

  // Invoke two Fathom calls concurrently with different params to avoid cache
  const [res1, res2] = await Promise.all([
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?cursor=1' }),
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?cursor=2' })
  ]);

  assert.deepEqual(res1, { items: [] });
  assert.deepEqual(res2, { items: [] });
  assert.equal(calls, 2);
  // Each Fathom attempt must be paced with 1500ms
  assert.deepEqual(waitLog, [1500, 1500]);
 });

 it('holds Fathom queue through request so max in-flight Fathom requests is 1', async () => {
  const wait = async () => {};
  let inFlight = 0;
  let maxInFlight = 0;

  const mockFetch: typeof fetch = async (url) => {
   if (new URL(String(url)).hostname === 'api.fathom.ai') {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 20));
    inFlight--;
    return new Response(JSON.stringify({ items: [] }), {
     status: 200,
     headers: { 'Content-Type': 'application/json' }
    });
   }
   return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const t = transport(baseEnv, mockFetch, wait);
  await Promise.all([
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?c=1' }),
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?c=2' }),
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?c=3' }),
  ]);

  assert.equal(maxInFlight, 1);
 });

 it('failure releases Fathom queue so subsequent requests proceed', async () => {
  const wait = async () => {};
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   if (calls <= 3) {
    throw new Error('Network failure');
   }
   return new Response(JSON.stringify({ items: ['recovered'] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  await assert.rejects(
   () => t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?c=1' }),
   /Read unavailable/
  );

  const res = await t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings?c=2' });
  assert.deepEqual(res, { items: ['recovered'] });
 });

 it('concurrent identical Fathom reads make only 1 provider request after cache recheck', async () => {
  const wait = async () => {};
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   await new Promise(r => setTimeout(r, 20));
   return new Response(JSON.stringify({ items: ['shared'] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  const [res1, res2] = await Promise.all([
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings' }),
   t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings' })
  ]);

  assert.deepEqual(res1, { items: ['shared'] });
  assert.deepEqual(res2, { items: ['shared'] });
  assert.equal(calls, 1);
 });

 it('unrelated providers proceed immediately while Fathom request is held', async () => {
  const wait = async () => {};
  let fathomResolvers: (() => void)[] = [];
  let otherFinished = false;
  let markStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { markStarted = resolve; });

  const mockFetch: typeof fetch = async (url) => {
   const parsed = new URL(String(url));
   if (parsed.hostname === 'api.fathom.ai') {
    markStarted();
    return new Promise(resolve => {
     fathomResolvers.push(() => {
      resolve(new Response(JSON.stringify({ items: [] }), {
       status: 200,
       headers: { 'Content-Type': 'application/json' }
      }));
     });
    });
   }
   otherFinished = true;
   return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  const fathomPromise = t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings' });
  await started;

  // While fathom is still pending in fetch:
  const otherRes = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(otherRes.status, 200);
  assert.equal(otherFinished, true);

  // Release fathom
  fathomResolvers.forEach(r => r());
  const fathomRes = await fathomPromise;
  assert.deepEqual(fathomRes, { items: [] });
 });

 it('paces retries on Fathom calls as well', async () => {
  const waitLog: number[] = [];
  const wait = async (ms: number) => { waitLog.push(ms); };
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   if (calls === 1) {
    return new Response('rate limit', { status: 429, headers: { 'Retry-After': '2' } });
   }
   return new Response(JSON.stringify({ items: ['meeting1'] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  const res = await t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings' });

  assert.deepEqual(res, { items: ['meeting1'] });
  assert.equal(calls, 2);
  assert.deepEqual(waitLog, [1500, 2000, 1500]);
 });

 it('cached response avoids provider request and pacing', async () => {
  const waitLog: number[] = [];
  const wait = async (ms: number) => { waitLog.push(ms); };
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   return new Response(JSON.stringify({ items: ['cached'] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  const res1 = await t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings' });
  const res2 = await t.reads.tool('native_fathom_get', { url: 'https://api.fathom.ai/external/v1/meetings' });

  assert.deepEqual(res1, { items: ['cached'] });
  assert.deepEqual(res2, { items: ['cached'] });
  assert.equal(calls, 1);
  assert.deepEqual(waitLog, [1500]);
 });

 it('does not pace other providers', async () => {
  const waitLog: number[] = [];
  const wait = async (ms: number) => { waitLog.push(ms); };
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
   calls++;
   return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
   });
  };

  const t = transport(baseEnv, mockFetch, wait);
  await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  await t.reads.fetch('https://graph.facebook.com/v21.0/other');

  assert.equal(calls, 2);
  assert.deepEqual(waitLog, []);
 });

 it('does not cache error responses or treat 429 as empty data', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => {
   calls++;
   return new Response('rate limited', { status: 429 });
  };

  const t = transport(baseEnv, mockFetch, async () => {});
  const res1 = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(res1.status, 429);
  assert.equal(calls, 3);

  // Subsequent call for same URL must hit fetch again, not cache
  const res2 = await t.reads.fetch('https://graph.facebook.com/v21.0/me');
  assert.equal(res2.status, 429);
  assert.equal(calls, 6);
 });

 it('rejects forbidden outbound writes', async () => {
  const t = transport(baseEnv, async () => new Response('ok'));
  await assert.rejects(
   () => t.reads.fetch('https://graph.facebook.com/v21.0/me', { method: 'POST' }),
   /Feed collection cannot perform provider writes/
  );
  await assert.rejects(
   () => t.reads.fetch('https://api.fathom.ai/external/v1/meetings', { method: 'DELETE' }),
   /Feed collection cannot perform provider writes/
  );
 });
});
