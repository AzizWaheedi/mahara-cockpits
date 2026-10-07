import { expect, test } from 'bun:test';
import { financeSources } from './finance/tools.ts';
import { googleDirectoryToken, metaGraph } from './tools.ts';

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
