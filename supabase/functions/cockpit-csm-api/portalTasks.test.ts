import {describe, expect, test} from 'bun:test';
import {PortalTasksAccessError, runPortalTasks} from './portalTasks.ts';

const scope = {
  actorId: '27f5abf0-2ccd-4cf7-8550-6f8e7e2b5418',
  email: 'csm@maharamedia.com',
  taskId: 'client-1',
  clientName: 'Acme',
  sourceSnapshotAt: '2026-10-07T08:00:00Z',
};
const input = {
  operation: 'portalTasks.forClient',
  args: {taskId: 'client-1'},
  requestId: '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73',
  apply: false,
};
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Task ${id}`,
  status: {status: 'to do', type: 'open'},
  tags: [{name: 'Acme'}],
  due_date: null,
  custom_fields: [],
  url: `https://app.clickup.com/t/${id}`,
  ...extra,
});

type GateResult = {data: unknown; error: {message: string} | null};
function fixture(options: {
  gate?: (read: number) => GateResult;
  respond?: (url: URL, index: number) => unknown | Promise<unknown>;
  healthError?: (row: Record<string, unknown>) => boolean;
  token?: string;
} = {}) {
  const requests: {url: URL; init: RequestInit | undefined}[] = [];
  const receipts: Record<string, unknown>[] = [];
  const environment: string[] = [];
  let gates = 0;
  const client = {
    async rpc(name: string, args: Record<string, unknown>): Promise<GateResult> {
      expect(name).toBe('cockpit_csm_client_gate');
      expect(args).toEqual({p_task_id: 'client-1'});
      gates++;
      return options.gate?.(gates) ?? {data: {...scope}, error: null};
    },
  };
  const admin = {
    from(table: string) {
      expect(table).toBe('cockpit_csm_provider_health');
      return {
        async insert(row: Record<string, unknown>) {
          receipts.push(row);
          return {error: options.healthError?.(row) ? {message: 'Ledger unavailable'} : null};
        },
      };
    },
  };
  const request = (async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : resource);
    requests.push({url, init});
    const body = options.respond
      ? await options.respond(url, requests.length)
      : url.pathname.endsWith('/tag')
        ? {tags: [{name: 'Acme'}]}
        : {tasks: [], last_page: true};
    return body instanceof Response ? body : Response.json(body);
  }) as typeof fetch;
  const env = (name: string) => {
    environment.push(name);
    return name === 'CLICKUP_API_TOKEN' ? (options.token ?? 'test-clickup-token') : undefined;
  };
  return {
    requests, receipts, environment,
    gates: () => gates,
    run: (raw: unknown = input) => runPortalTasks(client, admin, raw, env, request),
  };
}

describe('native portal-task reads', () => {
  test.each([
    {...input, operation: 'portalTasks.create'},
    {...input, args: {}},
    {...input, args: {taskId: '../other'}},
    {...input, args: {taskId: 12}},
    {...input, args: {taskId: 'client-1', clientName: 'Other'}},
    {...input, args: {taskId: 'client-1', tags: ['Other']}},
    {...input, requestId: 'not-a-uuid'},
  ])('rejects invalid operation or task input before accessing providers: %j', async raw => {
    const f = fixture();
    await expect(f.run(raw)).rejects.toThrow();
    expect(f.gates()).toBe(0);
    expect(f.requests).toHaveLength(0);
    expect(f.receipts).toHaveLength(0);
  });

  test.each([
    'Current confirmed client-success access is required',
    'That client is not on your access list',
    'The client roster is incomplete. Refresh its native source',
  ])('honors the current role, client and source gate: %s', async message => {
    const f = fixture({gate: () => ({data: null, error: {message}})});
    await expect(f.run()).rejects.toBeInstanceOf(PortalTasksAccessError);
    expect(f.requests).toHaveLength(0);
    expect(f.receipts).toHaveLength(0);
    expect(f.environment).toHaveLength(0);
  });

  test('rechecks access before the first provider read', async () => {
    const f = fixture({gate: read => read === 1
      ? {data: {...scope}, error: null}
      : {data: null, error: {message: 'Current confirmed client-success access is required'}}});
    await expect(f.run()).rejects.toBeInstanceOf(PortalTasksAccessError);
    expect(f.requests).toHaveLength(0);
    expect(f.receipts).toHaveLength(0);
  });

  test('rejects a gate result for a different task before provider access', async () => {
    const f = fixture({gate: () => ({data: {...scope, taskId: 'other-client'}, error: null})});
    await expect(f.run()).rejects.toBeInstanceOf(PortalTasksAccessError);
    expect(f.requests).toHaveLength(0);
  });

  test('does not use a partial or unrelated client tag', async () => {
    const f = fixture({respond: () => ({tags: [{name: 'Acme Labs'}, {name: 'Other Client'}]})});
    await expect(f.run()).resolves.toEqual({
      clientName: 'Acme', tag: null,
      formUrl: 'https://forms.clickup.com/90182518398/f/2kzmr1ky-7138/OFH93R3P8KGRIC1KVE',
      tasks: [],
    });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].url.pathname).toBe('/api/v2/space/901810248115/tag');
  });

  test('uses the exact normalized client tag without changing its provider spelling', async () => {
    const f = fixture({
      gate: () => ({data: {...scope, clientName: ' ACME   Clinic '}, error: null}),
      respond: url => url.pathname.endsWith('/tag')
        ? {tags: [{name: 'Acme'}, {name: ' acme clinic '}, {name: 'acme clinic south'}]}
        : {tasks: [task('own', {tags: [{name: 'acme clinic'}]})], last_page: true},
    });
    const result = await f.run();
    expect(result.clientName).toBe(' ACME   Clinic ');
    expect(result.tag).toBe(' acme clinic ');
    expect(result.tasks.map(t => t.id)).toEqual(['own']);
    expect(f.requests[1].url.searchParams.getAll('tags[]')).toEqual([' acme clinic ']);
  });

  test('rejects tasks outside the selected tag instead of leaking another client', async () => {
    const f = fixture({respond: url => url.pathname.endsWith('/tag')
      ? {tags: [{name: 'Acme'}, {name: 'Other Client'}]}
      : {tasks: [task('foreign', {tags: [{name: 'Other Client'}]})], last_page: true}});
    await expect(f.run()).rejects.toThrow(/client tag/i);
    expect(f.requests).toHaveLength(2);
  });

  test('reads all pages, normalizes task fields and sorts open tasks before finished tasks', async () => {
    const f = fixture({respond: url => {
      if (url.pathname.endsWith('/tag')) return {tags: [{name: 'Acme'}]};
      if (url.searchParams.get('page') === '0') return {
        tasks: [
          task('closed-old', {status: {status: 'complete', type: 'closed'}, due_date: String(Date.parse('2026-10-01T12:00:00Z'))}),
          task('later', {due_date: String(Date.parse('2026-10-10T12:00:00Z'))}),
        ],
        last_page: false,
      };
      return {
        tasks: [
          task('closed-new', {status: {status: 'archived', type: 'closed'}, due_date: String(Date.parse('2026-10-06T12:00:00Z'))}),
          task('sooner', {
            name: '  Send brand photos  ', due_date: String(Date.parse('2026-10-08T12:00:00Z')),
            custom_fields: [
              {id: '8e4ad7d7-fabf-4fd2-a08d-13c6ac2bda12', value: 1, type_config: {options: [
                {id: 'approval', name: 'Approval', orderindex: 0},
                {id: 'assets', name: 'Assets', orderindex: 1},
              ]}},
              {id: '74518115-b491-42f4-bdec-3eec98f1b629', value: 'true'},
            ],
          }),
        ],
        last_page: true,
      };
    }});
    const result = await f.run({...input, apply: true});
    expect(result.tasks.map(t => t.id)).toEqual(['sooner', 'later', 'closed-new', 'closed-old']);
    expect(result.tasks[0]).toEqual({
      id: 'sooner', name: 'Send brand photos', status: 'to do', done: false,
      due: '2026-10-08T12:00:00.000Z', requestType: 'Assets', published: true,
      url: 'https://app.clickup.com/t/sooner',
    });
    expect(result.tasks[2].done).toBe(true);
    expect(f.requests).toHaveLength(3);
    for (const [index, {url, init}] of f.requests.entries()) {
      expect(url.origin).toBe('https://api.clickup.com');
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('Authorization')).toBe('test-clickup-token');
      if (index > 0) {
        expect(url.pathname).toBe('/api/v2/list/1100530000000279/task');
        expect(Object.fromEntries(url.searchParams)).toEqual({
          page: String(index - 1), include_closed: 'true', subtasks: 'true', 'tags[]': 'Acme',
        });
      }
    }
    expect(f.environment).toEqual(['CLICKUP_API_TOKEN']);
    expect(f.receipts).toHaveLength(6);
    expect(f.receipts.map(row => row.phase)).toEqual(['intent', 'response', 'intent', 'response', 'intent', 'response']);
    expect(f.receipts.every(row => row.provider === 'clickup' && row.method === 'GET' && row.action_id === null)).toBe(true);
    expect(f.gates()).toBe(5);
  });

  test('retains the upstream five-page read cap without requesting a sixth page', async () => {
    const f = fixture({respond: url => url.pathname.endsWith('/tag')
      ? {tags: [{name: 'Acme'}]}
      : {tasks: [task(`page-${url.searchParams.get('page')}`)], last_page: false}});
    const result = await f.run();
    expect(result.tasks.map(t => t.id)).toEqual(['page-0', 'page-1', 'page-2', 'page-3', 'page-4']);
    expect(f.requests).toHaveLength(6);
  });

  test.each([true, false, undefined])('accepts a verified empty task page and stops: last_page=%s', async last_page => {
    const f = fixture({respond: url => url.pathname.endsWith('/tag')
      ? {tags: [{name: 'Acme'}]} : {tasks: [], last_page}});
    const result = await f.run();
    expect(result.tag).toBe('Acme');
    expect(result.tasks).toEqual([]);
    expect(f.requests).toHaveLength(2);
  });

  test('accepts a verified space with no client tags', async () => {
    const f = fixture({respond: () => ({tags: []})});
    const result = await f.run();
    expect(result.tag).toBeNull();
    expect(result.tasks).toEqual([]);
    expect(f.requests).toHaveLength(1);
  });

  test.each([
    {clientName: 'Other Client'},
    {sourceSnapshotAt: '2026-10-07T09:00:00Z'},
    {taskId: 'other-client'},
    {actorId: '21ed4f67-2571-4fab-aa80-cd8b9cba1927'},
    {email: 'other@maharamedia.com'},
  ])('rejects changed source identity before the next page: %j', async change => {
    const f = fixture({
      gate: read => ({data: {...scope, ...(read >= 4 ? change : {})}, error: null}),
      respond: url => url.pathname.endsWith('/tag') ? {tags: [{name: 'Acme'}]}
        : {tasks: [task('first')], last_page: false},
    });
    await expect(f.run()).rejects.toBeInstanceOf(PortalTasksAccessError);
    expect(f.requests).toHaveLength(2);
  });

  test('does not return tasks when access is revoked during the final provider read', async () => {
    const f = fixture({gate: read => read >= 4
      ? {data: null, error: {message: 'That client is not on your access list'}}
      : {data: {...scope}, error: null}});
    await expect(f.run()).rejects.toBeInstanceOf(PortalTasksAccessError);
    expect(f.requests).toHaveLength(2);
  });

  test.each([{}, {tags: null}, {tags: [{}]}, {tags: [{name: 12}]}])('rejects missing or malformed space tags: %j', async body => {
    const f = fixture({respond: () => body});
    await expect(f.run()).rejects.toThrow(/tags/i);
    expect(f.requests).toHaveLength(1);
    expect(f.receipts.map(row => row.phase)).toEqual(['intent', 'response']);
  });

  test.each([
    {}, {tasks: null}, {tasks: [null]}, {tasks: [{}]},
    {tasks: [task('bad', {due_date: 'not-a-date'})]},
    {tasks: [task('bad', {custom_fields: null})]},
    {tasks: [task('bad', {custom_fields: [{id: 'field', type_config: {options: {}}}]})]},
    {tasks: [task('bad', {tags: []})]},
    {tasks: [], last_page: 'false'},
  ])('rejects malformed task pages instead of reporting an empty list: %j', async body => {
    const f = fixture({respond: url => url.pathname.endsWith('/tag') ? {tags: [{name: 'Acme'}]} : body});
    await expect(f.run()).rejects.toThrow();
    expect(f.requests).toHaveLength(2);
  });

  test('fails before provider reads when the named ClickUp key is missing', async () => {
    const f = fixture({token: ''});
    await expect(f.run()).rejects.toThrow('CLICKUP_API_TOKEN');
    expect(f.requests).toHaveLength(0);
  });

  test('records an HTTP failure without retrying or returning partial tasks', async () => {
    const f = fixture({respond: url => url.pathname.endsWith('/tag') ? {tags: [{name: 'Acme'}]}
      : Response.json({err: 'Unavailable'}, {status: 503})});
    await expect(f.run()).rejects.toThrow(/503/);
    expect(f.requests).toHaveLength(2);
    expect(f.receipts.at(-1)).toMatchObject({provider: 'clickup', phase: 'response', http_status: 503});
  });

  test('records an unknown network outcome without another provider request', async () => {
    const f = fixture({respond: () => {throw new TypeError('Network unavailable');}});
    await expect(f.run()).rejects.toThrow(/unknown/i);
    expect(f.requests).toHaveLength(1);
    expect(f.receipts.map(row => row.phase)).toEqual(['intent', 'unknown']);
  });

  test('records an unreadable provider response without fabricating tags', async () => {
    const f = fixture({respond: () => new Response('not json', {status: 200})});
    await expect(f.run()).rejects.toThrow(/could not be read/i);
    expect(f.requests).toHaveLength(1);
    expect(f.receipts.at(-1)).toMatchObject({provider: 'clickup', phase: 'response', http_status: 200});
  });

  test('stops before a provider read when its intent receipt cannot be saved', async () => {
    const f = fixture({healthError: row => row.phase === 'intent'});
    await expect(f.run()).rejects.toThrow(/health/i);
    expect(f.requests).toHaveLength(0);
  });

  test('does not return data when a response receipt cannot be saved', async () => {
    const f = fixture({healthError: row => row.phase === 'response'});
    await expect(f.run()).rejects.toThrow(/health/i);
    expect(f.requests).toHaveLength(1);
  });
});
