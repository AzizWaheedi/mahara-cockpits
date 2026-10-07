import { expect, test } from 'bun:test';
import { pictureTools } from './tools';

test('storage health logs labels, not signed URL credentials or raw errors', async () => {
  const rows: unknown[] = [];
  const tools = pictureTools(async row => { rows.push(row); });
  const secret = 'https://storage.example/object?token=do-not-log';
  expect(await tools.storage('sign-read', async () => ({ url: secret }))).toEqual({ url: secret });
  await expect(tools.storage('sign-upload', async () => { throw new Error(secret); })).rejects.toThrow('could not confirm');
  expect(JSON.stringify(rows)).not.toContain('do-not-log');
  expect(rows).toEqual([
    { provider: 'supabase-storage', resource: 'sign-read', phase: 'intent' },
    { provider: 'supabase-storage', resource: 'sign-read', phase: 'response' },
    { provider: 'supabase-storage', resource: 'sign-upload', phase: 'intent' },
    { provider: 'supabase-storage', resource: 'sign-upload', phase: 'failed' },
  ]);
});
test('missing health persistence refuses a storage call before it starts', async () => {
  let called = false;
  const tools = pictureTools(async () => { throw new Error('health unavailable'); });
  await expect(tools.storage('import-upload', async () => { called = true; })).rejects.toThrow('health unavailable');
  expect(called).toBe(false);
});
test('literal private import addresses are rejected before DNS or network work', async () => {
  const rows: unknown[] = [];
  const tools = pictureTools(async row => { rows.push(row); });
  await expect(tools.download('https://127.0.0.1/private?token=secret')).rejects.toThrow('public HTTPS');
  expect(rows).toHaveLength(0);
});
