import { expect, test } from 'bun:test';
import { financeSources } from './finance/tools.ts';
import { googleDirectoryToken, HoursProviderError, hubstaffCall, hubstaffExchange, hubstaffGet, metaGraph, timetasticGet, type HoursReceipt } from './tools.ts';

test('Meta Graph read uses the named system token and records only safe request metadata', async () => {
  const healthRows: Record<string, unknown>[] = [];
  let calledUrl: URL | null = null;
  const result = await metaGraph(name => name === 'META_SYSTEM_TOKEN' ? 'meta-secret-fixture' : undefined, async row => { healthRows.push(row); }, async input => {
    calledUrl = new URL(String(input));
    return new Response(JSON.stringify({ data: [{ id: 'ad-1' }] }), { status: 200 });
  }, 'act_746108264865897/campaigns', { fields: 'id,name', limit: 200 });

  expect(calledUrl?.origin).toBe('https://graph.facebook.com');
  expect(calledUrl?.pathname).toMatch(/\/act_746108264865897\/campaigns$/);
  expect(calledUrl?.searchParams.get('fields')).toBe('id,name');
  expect(calledUrl?.searchParams.get('access_token')).toBe('meta-secret-fixture');
  expect(result).toEqual({ data: [{ id: 'ad-1' }] });
  expect(healthRows.map(row => row.phase)).toEqual(['intent', 'response']);
  expect(JSON.stringify(healthRows)).not.toContain('meta-secret-fixture');
});

test('Meta permission failure is recorded and never returned as a zero-valued source result', async () => {
  const healthRows: Record<string, unknown>[] = [];
  await expect(metaGraph(name => name === 'META_SYSTEM_TOKEN' ? 'meta-secret-fixture' : undefined, async row => { healthRows.push(row); }, async () => new Response(JSON.stringify({ error: { code: 10, message: 'missing permission' } }), { status: 403 }), 'act_746108264865897/insights', { fields: 'reach' })).rejects.toThrow('permission');
  expect(healthRows.at(-1)).toMatchObject({ provider: 'meta', phase: 'response', http_status: 403 });
});

test('missing Meta credentials create a failed receipt before returning an actionable error', async () => {
  const healthRows: Record<string, unknown>[] = [];
  let requested = false;
  await expect(metaGraph(() => undefined, async row => { healthRows.push(row); }, async () => {
    requested = true;
    return new Response('{}');
  }, 'act_746108264865897/campaigns', {})).rejects.toThrow('META_SYSTEM_TOKEN');
  expect(requested).toBe(false);
  expect(healthRows).toEqual([{ provider: 'meta', method: 'GET', resource: 'act_746108264865897/campaigns', phase: 'failed' }]);
});

test('B2B window source reads are fixed to the read-only database endpoint and require confirmed row counts', async () => {
  const receipts: Record<string, unknown>[] = [];
  let body: Record<string, unknown> | null = null;
  const read = financeSources('management-token-fixture', async row => { receipts.push(row); }, async (input, init) => {
    expect(String(input)).toBe('https://api.supabase.com/v1/projects/flwboeijllbtrufxkhts/database/query');
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify([{ rows: [{ total: 7 }], row_count: 1 }]), { status: 200 });
  });
  expect(await read('flwboeijllbtrufxkhts', 'select 7 as total')).toEqual([{ total: 7 }]);
  expect(body?.read_only).toBe(true);
  expect(receipts.map(row => row.phase)).toEqual(['intent', 'response']);
  await expect(read('other-project', 'select 1')).rejects.toThrow('not allowed');
});

test('missing Workspace service-account configuration records a failure and gives the DWD prerequisite', async () => {
  const receipts: Record<string, unknown>[] = [];
  let requested = false;
  await expect(googleDirectoryToken(() => undefined, async row => { receipts.push(row); }, async () => {
    requested = true;
    return new Response('{}');
  })).rejects.toThrow('admin.directory.user.readonly');
  expect(requested).toBe(false);
  expect(receipts).toEqual([{ provider: 'google-directory-auth', method: 'POST', resource: 'oauth2.googleapis.com/token', phase: 'failed' }]);
});

// --- Hours: Hubstaff and Timetastic (made-up tokens and figures) ---

const HS_TOKEN = 'hsoat_fixtureTokenNotReal0001';
const TT_TOKEN = 'ttFixtureTokenNotReal0002';
function recorder() {
  const rows: HoursReceipt[] = [];
  return { rows, health: async (row: HoursReceipt) => { rows.push(row); } };
}

test('Hubstaff reads leave host-qualified template receipts and drop pay fields at every depth', async () => {
  const { rows, health } = recorder();
  let called = '';
  const out = await hubstaffGet(HS_TOKEN, health, async (input, init) => {
    called = String(input);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${HS_TOKEN}`);
    return new Response(JSON.stringify({ members: [{ user_id: 11, pay_rate: 9.5, bill_rate: 20, profile: { phone: '000' }, membership_role: 'user' }] }), { status: 200 });
  }, 'organizations/705266/members', { page_limit: 500, include_removed: 'true' });
  expect(new URL(called).pathname).toBe('/v2/organizations/705266/members');
  expect(JSON.stringify(out)).not.toContain('pay_rate');
  expect(JSON.stringify(out)).not.toContain('bill_rate');
  expect(JSON.stringify(out)).not.toContain('profile');
  expect(rows).toEqual([
    { provider: 'hubstaff', method: 'GET', resource: 'api.hubstaff.com/v2/organizations/{org}/members', phase: 'intent' },
    { provider: 'hubstaff', method: 'GET', resource: 'api.hubstaff.com/v2/organizations/{org}/members', phase: 'response', http_status: 200 },
  ]);
  expect(JSON.stringify(rows)).not.toContain('705266');
});

test('no key means no call and no receipt', async () => {
  const { rows, health } = recorder();
  let requested = false;
  const fetchSpy = async () => { requested = true; return new Response('{}'); };
  await expect(hubstaffGet('', health, fetchSpy, 'organizations')).rejects.toMatchObject({ kind: 'missing_key' });
  await expect(timetasticGet('', health, fetchSpy, 'users')).rejects.toMatchObject({ kind: 'missing_key' });
  expect(requested).toBe(false);
  expect(rows).toEqual([]);
});

test('401, 403 plan (10006), 429 with Retry-After, and unreadable JSON', async () => {
  const { health } = recorder();
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('{"error":"invalid_token"}', { status: 401 }), 'organizations')).rejects.toMatchObject({ kind: 'refused', status: 401 });
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('{"code":10006,"error":"Organization does not have an active plan"}', { status: 403 }), 'organizations'))
    .rejects.toMatchObject({ kind: 'plan_blocked', code: '10006' });
  let calls = 0;
  const waits: number[] = [];
  const ok = await hubstaffGet(HS_TOKEN, health, async () => (++calls === 1
    ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
    : new Response('{"organizations":[]}', { status: 200 })), 'organizations', {}, { sleep: async ms => { waits.push(ms); } });
  expect(ok).toEqual({ organizations: [] });
  expect(waits).toEqual([2000]);
  calls = 0;
  await expect(hubstaffGet(HS_TOKEN, health, async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }); }, 'organizations', {}, { sleep: async () => {} }))
    .rejects.toMatchObject({ kind: 'rate_limited' });
  expect(calls).toBe(1);
  // A 429 without Retry-After waits 2 seconds before its one retry, rather than asking again at once.
  calls = 0;
  const bare: number[] = [];
  await expect(hubstaffGet(HS_TOKEN, health, async () => { calls++; return new Response('{}', { status: 429 }); }, 'organizations', {}, { sleep: async ms => { bare.push(ms); } }))
    .rejects.toMatchObject({ kind: 'rate_limited' });
  expect(calls).toBe(2);
  expect(bare).toEqual([2000]);
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('<html>', { status: 200 }), 'organizations')).rejects.toMatchObject({ kind: 'unreadable' });
});

test('errors carry only the status and the code: never the body, pay or the token', async () => {
  const { health } = recorder();
  const body = JSON.stringify({ code: `bad${HS_TOKEN}`, error: `token ${HS_TOKEN} for member with pay_rate 12.5 and email someone@example.test` });
  const failure = await hubstaffGet(HS_TOKEN, health, async () => new Response(body, { status: 500 }), 'organizations').catch(e => e);
  expect(failure).toBeInstanceOf(HoursProviderError);
  const text = `${failure.message} ${failure.code}`;
  expect(text).not.toContain(HS_TOKEN);
  expect(text).not.toContain('pay_rate');
  expect(text).not.toContain('someone@example.test');
  expect(failure.message).toContain('500');
});

test('anything but GET throws before a request exists (except the token exchange)', async () => {
  const { rows, health } = recorder();
  let requested = false;
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
    await expect(hubstaffCall(m, HS_TOKEN, health, async () => { requested = true; return new Response('{}'); }, 'organizations', {})).rejects.toMatchObject({ kind: 'invalid' });
  await expect(hubstaffGet(HS_TOKEN, health, async () => { requested = true; return new Response('{}'); }, 'organizations/705266/members/invite')).rejects.toMatchObject({ kind: 'invalid' });
  expect(requested).toBe(false);
  expect(rows).toEqual([]);
  let method = '';
  const swapped = await hubstaffExchange('refreshFixture0001', health, async (_input, init) => {
    method = String(init?.method);
    return new Response(JSON.stringify({ access_token: 'accessFixture', refresh_token: 'refreshFixture0002', expires_in: 86400 }), { status: 200 });
  });
  expect(method).toBe('POST');
  expect(swapped).toEqual({ accessToken: 'accessFixture', refreshToken: 'refreshFixture0002', expiresIn: 86400 });
  expect(rows.map(r => r.resource)).toEqual(['account.hubstaff.com/access_tokens', 'account.hubstaff.com/access_tokens']);
  const lost = recorder();
  await expect(hubstaffExchange('refreshFixture0003', lost.health, async () => { throw new Error('timeout'); })).rejects.toMatchObject({ kind: 'unreachable' });
  expect(lost.rows.map(r => r.phase)).toEqual(['intent', 'unknown']);
});

test('Timetastic sends its identifying headers, follows its own page links only, and waits on a short 429', async () => {
  const { rows, health } = recorder();
  let headers: Record<string, string> = {};
  await timetasticGet(TT_TOKEN, health, async (_input, init) => { headers = init?.headers as Record<string, string>; return new Response('[]', { status: 200 }); }, 'users', { includeArchivedUsers: true });
  expect(headers['User-Agent']).toBe('mahara-cockpit-hours/1');
  expect(headers['X-Client-ID']).toBe('mahara-cockpit');
  expect(rows[0].resource).toBe('app.timetastic.co.uk/api/users');
  let requested = false;
  await expect(timetasticGet(TT_TOKEN, health, async () => { requested = true; return new Response('{}'); }, 'https://evil.example.test/api/holidays?PageNumber=2'))
    .rejects.toMatchObject({ kind: 'invalid' });
  await expect(timetasticGet(TT_TOKEN, health, async () => { requested = true; return new Response('{}'); }, 'http://app.timetastic.co.uk/api/holidays?PageNumber=2'))
    .rejects.toMatchObject({ kind: 'invalid' });
  expect(requested).toBe(false);
  const page = await timetasticGet(TT_TOKEN, health, async input => {
    expect(String(input)).toBe('https://app.timetastic.co.uk/api/holidays?PageNumber=2');
    return new Response('{"holidays":[],"totalRecords":0}', { status: 200 });
  }, 'https://app.timetastic.co.uk/api/holidays?PageNumber=2');
  expect(page).toEqual({ holidays: [], totalRecords: 0 });
  let calls = 0;
  const waits: number[] = [];
  await timetasticGet(TT_TOKEN, health, async () => (++calls === 1
    ? new Response('{}', { status: 429, headers: { 'X-Rate-Limit-Reset': new Date(Date.now() + 1500).toISOString() } })
    : new Response('[]', { status: 200 })), 'leavetypes', {}, { sleep: async ms => { waits.push(ms); } });
  expect(calls).toBe(2);
  expect(waits[0]).toBeGreaterThan(0);
  expect(waits[0]).toBeLessThanOrEqual(1500);
  await expect(timetasticGet(TT_TOKEN, health, async () => new Response('{"title":"Unauthorized"}', { status: 401 }), 'users')).rejects.toMatchObject({ kind: 'refused' });
});

test('every Hubstaff call sends a User-Agent: Cloudflare refuses a request without one (403, 1010)', async () => {
  const { health } = recorder();
  const agents: string[] = [];
  const spy = async (_input: RequestInfo | URL, init?: RequestInit) => {
    agents.push((init?.headers as Record<string, string>)['User-Agent']);
    return new Response(JSON.stringify({ organizations: [], access_token: 'accessFixture', refresh_token: 'refreshFixture0002' }), { status: 200 });
  };
  await hubstaffGet(HS_TOKEN, health, spy, 'organizations');
  await hubstaffExchange('refreshFixture0001', health, spy);
  expect(agents).toEqual(['mahara-cockpit/1.0', 'mahara-cockpit/1.0']);
});

test("a 403 from Hubstaff's firewall is its own kind, never a refused key; Hubstaff's own 403 still is", async () => {
  const { health } = recorder();
  const firewall = await hubstaffGet(HS_TOKEN, health, async () => new Response('error code: 1010', { status: 403, headers: { 'Content-Type': 'text/plain' } }), 'organizations').catch(e => e);
  expect(firewall).toMatchObject({ kind: 'firewall_blocked', status: 403, code: '1010' });
  expect(firewall.message).toContain('firewall');
  expect(firewall.message).not.toContain('refused');
  const page = '<!DOCTYPE html><html><head><title>Access denied | api.hubstaff.com used Cloudflare to restrict access</title></head><body><h1>Error 1010</h1></body></html>';
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response(page, { status: 403, headers: { 'Content-Type': 'text/html', Server: 'cloudflare' } }), 'organizations'))
    .rejects.toMatchObject({ kind: 'firewall_blocked', code: '1010' });
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('Forbidden', { status: 403, headers: { 'CF-RAY': '0000000000000000-KWI' } }), 'organizations'))
    .rejects.toMatchObject({ kind: 'firewall_blocked', code: null });
  await expect(hubstaffExchange('refreshFixture0001', health, async () => new Response('error code: 1010', { status: 403 })))
    .rejects.toMatchObject({ kind: 'firewall_blocked' });
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('{"error":"forbidden"}', { status: 403 }), 'organizations')).rejects.toMatchObject({ kind: 'refused', status: 403 });
  // Cloudflare answering in JSON: its 4-digit 1xxx code marks it, on the API and on the token exchange.
  const cfJson = () => new Response('{"title":"Access denied","status":403,"error_code":1010}', { status: 403, headers: { 'Content-Type': 'application/json', 'CF-RAY': '0000000000000000-KWI' } });
  await expect(hubstaffGet(HS_TOKEN, health, async () => cfJson(), 'organizations')).rejects.toMatchObject({ kind: 'firewall_blocked', code: '1010' });
  await expect(hubstaffExchange('refreshFixture0001', health, async () => cfJson())).rejects.toMatchObject({ kind: 'firewall_blocked' });
  // Hubstaff's own JSON 403s pass Cloudflare too (its headers on them): still a refused key, or no API plan.
  const viaCf = { 'Content-Type': 'application/json', 'CF-RAY': '0000000000000000-KWI', Server: 'cloudflare' };
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('{"error":"forbidden"}', { status: 403, headers: viaCf }), 'organizations')).rejects.toMatchObject({ kind: 'refused' });
  await expect(hubstaffGet(HS_TOKEN, health, async () => new Response('{"code":10006,"error":"Organization does not have an active plan with API access"}', { status: 403, headers: viaCf }), 'organizations')).rejects.toMatchObject({ kind: 'plan_blocked' });
});
