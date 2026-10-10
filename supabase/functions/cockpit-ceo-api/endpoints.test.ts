import { expect, test } from 'bun:test';
import { ceoEndpoint, extensionDeps, extensionsAuto } from './endpoints.ts';
import { clickupRequest, metaGraph, metaGraphPost, typeformRead } from './tools.ts';

type Row = Record<string, unknown>;
const env = (values: Record<string, string>) => (name: string) => values[name];

test('Meta writes send the token in the body only and label one-off objects in the ledger', async () => {
  const receipts: Row[] = [];
  let body = '';
  let url = '';
  const out = await metaGraphPost(env({ META_SYSTEM_TOKEN: 'meta-secret-fixture' }), async r => { receipts.push(r); }, async (input, init) => {
    url = String(input);
    body = String(init?.body);
    return new Response(JSON.stringify({ id: '101' }), { status: 200 });
  }, '17841473441237528/media', { media_type: 'REELS', caption: 'Hi' }, 'instagram/media');
  expect(out).toEqual({ id: '101' });
  expect(url).toBe('https://graph.facebook.com/v21.0/17841473441237528/media');
  expect(new URLSearchParams(body).get('access_token')).toBe('meta-secret-fixture');
  expect(receipts).toEqual([
    { provider: 'meta', method: 'POST', resource: 'instagram/media', phase: 'intent' },
    { provider: 'meta', method: 'POST', resource: 'instagram/media', phase: 'response', http_status: 200 },
  ]);
  await metaGraph(env({ META_SYSTEM_TOKEN: 't' }), async r => { receipts.push(r); }, async () => new Response('{"status_code":"FINISHED"}'), '1789', { fields: 'status_code' }, 'instagram/container');
  expect(receipts.at(-1)).toMatchObject({ method: 'GET', resource: 'instagram/container' });
});

test('a refused Meta write is an error with the token redacted', async () => {
  const receipts: Row[] = [];
  await expect(metaGraphPost(env({ META_SYSTEM_TOKEN: 'tok-123' }), async r => { receipts.push(r); }, async () =>
    new Response(JSON.stringify({ error: { code: 10, message: 'bad tok-123' } }), { status: 403 }), '1/media', {})).rejects.toThrow('bad [redacted]');
  expect(receipts.at(-1)).toMatchObject({ phase: 'response', http_status: 403 });
});

test('ClickUp and Typeform helpers record intent and response, and refuse without their tokens', async () => {
  const receipts: Row[] = [];
  const health = async (r: Row) => { receipts.push(r); };
  let sent: RequestInit | undefined;
  await clickupRequest(env({ CLICKUP_API_TOKEN: 'pk_fixture' }), health, async (_input, init) => { sent = init; return new Response('{}', { status: 200 }); }, 'POST', 'task/abc/field/f1', { value: 2 }, 'task/field');
  expect(sent?.method).toBe('POST');
  expect(sent?.body).toBe('{"value":2}');
  expect((sent?.headers as Record<string, string>).Authorization).toBe('pk_fixture');
  expect(receipts.map(r => [r.provider, r.resource, r.phase])).toEqual([['clickup', 'task/field', 'intent'], ['clickup', 'task/field', 'response']]);
  await expect(clickupRequest(env({ CLICKUP_API_TOKEN: 'pk' }), health, async () => new Response('{"err":"Field not found"}', { status: 400 }), 'GET', 'list/1/field')).rejects.toThrow('Field not found');
  await expect(clickupRequest(env({}), health, async () => new Response('{}'), 'GET', 'list/1/field')).rejects.toThrow('CLICKUP_API_TOKEN');
  expect(receipts.at(-1)).toMatchObject({ provider: 'clickup', phase: 'failed' });

  const form = await typeformRead(env({ TYPEFORM_TOKEN: 'tf' }), health, async input => {
    expect(String(input)).toBe('https://api.typeform.com/forms/gqBcyK6g/responses?page_size=200');
    return new Response('{"items":[]}', { status: 200 });
  }, 'forms/gqBcyK6g/responses?page_size=200');
  expect(form).toEqual({ items: [] });
  expect(receipts.at(-1)).toMatchObject({ provider: 'typeform', resource: 'forms/gqBcyK6g/responses', http_status: 200 });
  await expect(typeformRead(env({ TYPEFORM_TOKEN: 'tf' }), health, async () => new Response('{}'), 'workspaces/x')).rejects.toThrow('Invalid Typeform');
});

function fakeAdmin(opts: { cards?: unknown; recordOk?: boolean } = {}) {
  const calls: { kind: string; name: string; args?: unknown }[] = [];
  const admin = {
    async rpc(name: string, args: unknown) {
      calls.push({ kind: 'rpc', name, args });
      if (name === 'cockpit_ceo_extension_cards') return { data: opts.cards ?? [{ taskId: 'n1', name: 'Nahda Clinics', stage: 'Active' }], error: null };
      if (name === 'cockpit_ceo_extension_write_record') return { data: { ok: opts.recordOk ?? true }, error: null };
      return { data: null, error: { message: 'unexpected rpc' } };
    },
    from(name: string) {
      const chain = {
        select: () => chain,
        eq: async () => ({ data: [{ clickup_task_id: 'n1', weeks: 4 }], error: null }),
        upsert: async (row: unknown) => { calls.push({ kind: 'upsert', name, args: row }); return { error: null }; },
      };
      return chain;
    },
  };
  return { admin, calls };
}

const formFetch = (paths: string[]) => async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  paths.push(`${init?.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+\//, '')}`);
  if (url.includes('typeform')) return new Response(JSON.stringify({ items: [{
    response_id: 'r1', submitted_at: new Date(Date.now() - 86_400_000).toISOString(),
    answers: [{ field: { ref: '5145ff0c-009b-4f51-b3a9-4651efc908be' }, text: 'Nahda Clinics' }, { field: { ref: '278c2f80-88bd-428e-b330-8c6b3175d63f' }, text: '2 WEEKS' }],
  }] }), { status: 200 });
  if (url.endsWith('/field') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ fields: [{ id: 'fld-9', name: 'Current extension (weeks)' }] }), { status: 200 });
  return new Response('{}', { status: 200 });
};

test('the button path finds the field by name, writes the card and records the founder write', async () => {
  const { admin, calls } = fakeAdmin();
  const paths: string[] = [];
  const out = await ceoEndpoint('ceo.extensions.applyToClickUp', {}, {
    admin, env: env({ CLICKUP_API_TOKEN: 'pk', TYPEFORM_TOKEN: 'tf' }), health: async () => {}, actorId: 'founder-id', apply: true, request: formFetch(paths),
  }) as Row;
  expect(paths).toEqual(['GET api/v2/list/901816559981/field', 'GET forms/gqBcyK6g/responses?page_size=200', 'POST api/v2/task/n1/field/fld-9']);
  expect(out).toMatchObject({ written: 1, ok: true });
  const record = calls.find(c => c.name === 'cockpit_ceo_extension_write_record');
  expect(record?.args).toMatchObject({ p_actor_id: 'founder-id', p_write: { taskId: 'n1', weeks: 2, fieldId: 'fld-9' } });
});

test('the cron pass is a dry run without CEO_EXTENSIONS_APPLY and records its run state', async () => {
  const { admin, calls } = fakeAdmin();
  const paths: string[] = [];
  const out = await extensionsAuto(admin, env({ CLICKUP_API_TOKEN: 'pk', TYPEFORM_TOKEN: 'tf', CLICKUP_EXTENSION_FIELD: 'fld-9' }), async () => {}, formFetch(paths));
  expect(out).toMatchObject({ dryRun: true, planned: 1, written: 0 });
  expect(paths.some(p => p.startsWith('POST'))).toBe(false);
  expect(calls.find(c => c.kind === 'upsert')?.args).toMatchObject({ key: 'ceo-extensions-auto', ok: true });

  const live = fakeAdmin();
  const livePaths: string[] = [];
  const applied = await extensionsAuto(live.admin, env({ CLICKUP_API_TOKEN: 'pk', TYPEFORM_TOKEN: 'tf', CLICKUP_EXTENSION_FIELD: 'fld-9', CEO_EXTENSIONS_APPLY: 'true' }), async () => {}, formFetch(livePaths));
  expect(applied.written).toBe(1);
  expect(live.calls.find(c => c.name === 'cockpit_ceo_extension_write_record')?.args).toMatchObject({ p_actor_id: null });
});

test('task and field IDs are checked before a ClickUp path is built', async () => {
  const { admin } = fakeAdmin();
  const deps = extensionDeps(admin, env({ CLICKUP_API_TOKEN: 'pk' }), async () => {}, 'founder-id', async () => new Response('{}'));
  await expect(deps.write('../list', 'fld', 1)).rejects.toThrow('invalid');
});

test('operations this module does not own fall through', async () => {
  const { admin } = fakeAdmin();
  expect(await ceoEndpoint('ceo.people.remove', {}, { admin, env: env({}), health: async () => {}, actorId: 'x', apply: true })).toBeUndefined();
});
