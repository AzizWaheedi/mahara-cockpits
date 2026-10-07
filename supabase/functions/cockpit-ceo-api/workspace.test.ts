import { expect, test } from 'bun:test';
import { googleDirectoryToken } from './tools.ts';
import { readDirectoryPages, workspaceSourceHash } from './workspace.ts';

test('Workspace directory returns every page with normalized identity fields and private health receipts', async () => {
  const healthRows: Record<string, unknown>[] = [];
  const requests: URL[] = [];
  const users = await readDirectoryPages('directory-token-fixture', async row => { healthRows.push(row); }, async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer directory-token-fixture');
    if (url.searchParams.get('pageToken') === 'page-2') {
      return new Response(JSON.stringify({ users: [{ primaryEmail: 'Mina@MaharaMedia.com', name: { fullName: 'Mina Noor' }, suspended: false, organizations: [{ title: 'Media Buyer' }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ users: [{ primaryEmail: 'sara@maharamedia.com', name: { fullName: 'Sara Ali' }, suspended: true, organizations: [{ title: 'Editor' }] }], nextPageToken: 'page-2' }), { status: 200 });
  });

  expect(users).toEqual([
    { name: 'Sara Ali', email: 'sara@maharamedia.com', suspended: true, title: 'Editor' },
    { name: 'Mina Noor', email: 'Mina@MaharaMedia.com', suspended: false, title: 'Media Buyer' },
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[0].origin).toBe('https://admin.googleapis.com');
  expect(requests[0].pathname).toBe('/admin/directory/v1/users');
  expect(requests[0].searchParams.get('customer')).toBe('my_customer');
  expect(requests[1].searchParams.get('pageToken')).toBe('page-2');
  expect(healthRows.map(row => row.phase)).toEqual(['intent', 'response', 'intent', 'response']);
  expect(JSON.stringify(healthRows)).not.toContain('directory-token-fixture');
});

test('Workspace permission failure rejects the entire directory read with the DWD repair action', async () => {
  const healthRows: Record<string, unknown>[] = [];
  let calls = 0;
  await expect(readDirectoryPages('directory-token-fixture', async row => { healthRows.push(row); }, async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ users: [{ primaryEmail: 'sara@maharamedia.com' }], nextPageToken: 'page-2' }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 });
  })).rejects.toThrow('domain-wide delegation');
  expect(calls).toBe(2);
  expect(healthRows.slice(-1)[0]).toMatchObject({ phase: 'response', http_status: 403 });
});

test('Workspace source hash is stable across provider page ordering and changes with the selected roster subset', async () => {
  const alice = { name: 'Alice Noor', email: 'alice@maharamedia.com', suspended: false, title: 'Editor' };
  const bob = { name: 'Bob Ali', email: 'bob@maharamedia.com', suspended: false, title: null };
  const first = await workspaceSourceHash([alice, bob], ['ALICE@maharamedia.com']);
  const replay = await workspaceSourceHash([bob, alice], ['alice@maharamedia.com']);
  const differentSelection = await workspaceSourceHash([alice, bob], ['bob@maharamedia.com']);
  expect(replay).toBe(first);
  expect(differentSelection).not.toBe(first);
});

test('unreadable Workspace service-account configuration fails before any directory request', async () => {
  const healthRows: Record<string, unknown>[] = [];
  await expect(googleDirectoryToken(name => name === 'GOOGLE_SERVICE_ACCOUNT_JSON' ? '{broken' : undefined, async row => { healthRows.push(row); }, async () => new Response('{}'))).rejects.toThrow('GOOGLE_SERVICE_ACCOUNT_JSON is invalid');
  expect(healthRows).toEqual([{ provider: 'google-directory-auth', method: 'POST', resource: 'oauth2.googleapis.com/token', phase: 'failed' }]);
});
