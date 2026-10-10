import {describe, expect, test} from 'bun:test';
import {F, FORMS, LIST_ID, formsFor, type FormData, type OnboardingRow} from '../../../apps/client-success-cockpit/src/lib/onboardingCore.ts';
import {TYPEFORM_UNVERIFIED} from '../cockpit-csm-api/onboarding.ts';
import {BATCH, BUDGET_MS, CLICKUP_GAP_MS, TYPEFORM_GAP_MS, dryRunStore, handle, liveSources, newestOnly, redact, supabaseStore, syncAll, type Admin, type Clock, type Published, type StateRow, type Store} from './sync.ts';

// The scheduled bulk sync: how it walks every card, joins the forms, spaces
// and retries provider calls, stops in time and resumes, and what it says.

const fields = {fields: [F.clientStatus, F.kickoffForm, F.salesCall, F.onboardingMap].map(id => ({id, type_config: id === F.clientStatus ? {options: [{id: 'o-nc', orderindex: 6, name: 'Needs Contacting'}, {id: 'o-ac', orderindex: 0, name: 'Active'}]} : {}}))};
const card = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `cu-${i}`, name: `Client ${i}`, url: `https://app.clickup.com/t/cu-${i}`, list: {id: LIST_ID}, status: {status: 'on boarding'},
  date_updated: '1759900000000', custom_fields: [{id: F.clientStatus, value: i % 2 ? 6 : 0}], ...extra,
});
const cards = (from: number, n: number) => Array.from({length: n}, (_, i) => card(from + i));
const definition = (id: string) => ({id, fields: [{ref: 'q1', title: 'Business name | اسم النشاط', type: 'short_text'}]});
const response = (form: string, taskId: string, at: string, text = 'answer') => ({token: `${form}-${taskId}-${at}`, response_id: `${form}-${taskId}-${at}`, submitted_at: at, hidden: {onboarding_client_id: taskId}, answers: [{field: {ref: 'q1'}, type: 'text', text}]});

function virtualClock(): Clock & {t: number; sleeps: number[]} {
  const clock = {t: 1_000_000, sleeps: [] as number[], now: () => clock.t, sleep: async (ms: number) => {clock.sleeps.push(ms); clock.t += ms;}};
  return clock;
}

type WorldOptions = {
  pages?: {tasks: unknown[]; last_page?: boolean}[];
  responses?: Partial<Record<string, unknown[]>>;
  respond?: (url: URL, n: number) => Response | undefined;
  latency?: (url: URL) => number;
  env?: Record<string, string>;
};
function world(options: WorldOptions = {}) {
  const clock = virtualClock();
  const calls: {at: number; url: URL}[] = [];
  const receipts: Record<string, unknown>[] = [];
  const pages = options.pages ?? [{tasks: cards(1, 3), last_page: true}];
  const request = (async (resource: string | URL | Request) => {
    const url = new URL(resource instanceof Request ? resource.url : resource);
    calls.push({at: clock.now(), url});
    const custom = options.respond?.(url, calls.length);
    clock.t += options.latency?.(url) ?? 200;
    if (custom) return custom;
    const ok = (body: unknown) => new Response(JSON.stringify(body), {status: 200});
    if (url.hostname === 'api.clickup.com') {
      if (url.pathname.endsWith(`/list/${LIST_ID}/field`)) return ok(fields);
      if (url.pathname.endsWith(`/list/${LIST_ID}/task`)) return ok(pages[Number(url.searchParams.get('page'))] ?? {tasks: [], last_page: true});
    }
    if (url.hostname === 'api.typeform.com') {
      const id = url.pathname.split('/')[2];
      if (url.pathname.endsWith('/responses')) return ok({items: options.responses?.[id] ?? []});
      return ok(definition(id));
    }
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  const admin: Admin = {
    rpc: async () => ({data: null, error: {message: 'not used'}}),
    from: (table: string) => {
      expect(table).toBe('cockpit_csm_provider_health');
      return {insert: async (row: Record<string, unknown>) => {receipts.push(row); return {error: null};}};
    },
  };
  const env = {CLICKUP_API_TOKEN: 'pk_123_ABCDEFG', TYPEFORM_TOKEN: 'tfp_abcdef', ...options.env};
  const sources = liveSources(name => env[name as keyof typeof env], admin, request);
  return {clock, calls, receipts, sources};
}

function memoryStore(options: {begin?: Awaited<ReturnType<Store['begin']>>; publish?: (rows: OnboardingRow[]) => Published | Promise<Published>} = {}) {
  const batches: {run: number; rows: OnboardingRow[]; formsVerified: boolean}[] = [];
  const finished: {run: number; ok: boolean; counts: Record<string, number>; problem: string | null}[] = [];
  const states: StateRow[] = [];
  const store: Store = {
    begin: async () => options.begin ?? {busy: false, run: 7, resumePage: 0},
    publish: async (run, rows, formsVerified) => {batches.push({run, rows, formsVerified}); return options.publish ? options.publish(rows) : {written: rows.length, unchanged: 0, identitySkipped: 0};},
    finish: async (run, ok, counts, problem) => {finished.push({run, ok, counts, problem});},
    state: async row => {states.push(row);},
  };
  return {store, batches, finished, states};
}

const paths = (calls: {url: URL}[]) => calls.map(c => c.url.hostname.replace('api.', '').replace('.com', '') + ' ' + c.url.pathname.replace('/api/v2/', '/') + (c.url.search ? c.url.search : ''));

describe('bulk iteration', () => {
  test('reads the fields, every form in full, then every card page, and writes them in batches', async () => {
    const w = world({pages: [{tasks: cards(1, 100), last_page: false}, {tasks: cards(101, 30), last_page: true}], responses: {[FORMS.onboarding]: [response(FORMS.onboarding, 'cu-1', '2026-10-01T10:00:00Z')]}});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    const r = (form: string) => `typeform /forms/${form}/responses?page_size=1000&completed=true`;
    const task = (page: number) => `clickup /list/${LIST_ID}/task?page=${page}&include_closed=true&subtasks=false&archived=false`;
    expect(paths(w.calls)).toEqual([
      `clickup /list/${LIST_ID}/field`,
      `typeform /forms/${FORMS.onboarding}`, r(FORMS.onboarding), `typeform /forms/${FORMS.kickoff}`, r(FORMS.kickoff),
      `typeform /forms/${FORMS.kickoffOld}`, r(FORMS.kickoffOld), `typeform /forms/${FORMS.blueprint}`, r(FORMS.blueprint),
      task(0), task(1),
    ]);
    expect(w.receipts.length).toBe(2 * w.calls.length);
    expect(w.receipts.filter(x => x.provider === 'clickup').length).toBe(6);
    expect(m.batches.map(b => b.rows.length)).toEqual([20, 20, 20, 20, 20, 20, 10]);
    expect(m.batches.every(b => b.run === 7 && b.formsVerified && b.rows.length <= BATCH)).toBe(true);
    const first = m.batches[0].rows[0];
    expect(first).toMatchObject({clickup_task_id: 'cu-1', client_name: 'Client 1', client_status: 'Needs Contacting', in_onboarding: true, links: {clickup: 'https://app.clickup.com/t/cu-1'}});
    expect(first.forms?.onboarding).toMatchObject({form_id: FORMS.onboarding, answers: [{title: 'Business name', value: 'answer'}]});
    expect(m.batches[0].rows[1].forms).toEqual({});
    expect(result).toMatchObject({ok: true, run: 7, problem: null});
    expect(m.finished).toEqual([{run: 7, ok: true, problem: null, counts: {start_page: 0, pages: 2, cards: 130, written: 130, unchanged: 0, identity_skipped: 0, unreadable: 0, in_onboarding: 65, onboarding_forms: 1, kickoff_forms: 0, blueprint_forms: 0}}]);
    expect(m.states).toEqual([{ok: true, note: '130 cards, 130 changed, from page 1', rows_seen: 130}]);
  });

  test('the newest kickoff wins across both kickoff forms, joined by card id only', async () => {
    const w = world({responses: {
      [FORMS.kickoff]: [response(FORMS.kickoff, 'cu-1', '2026-09-20T10:00:00Z', 'new form')],
      [FORMS.kickoffOld]: [response(FORMS.kickoffOld, 'cu-1', '2026-09-25T10:00:00Z', 'old form, newer answer'), response(FORMS.kickoffOld, 'cu-2', '2026-08-01T10:00:00Z', 'two')],
    }});
    const m = memoryStore();
    await syncAll(m.store, w.sources, w.clock);
    const rows = m.batches[0].rows;
    expect(rows[0].forms?.kickoff).toMatchObject({form_id: FORMS.kickoffOld, answers: [{value: 'old form, newer answer'}]});
    expect(rows[1].forms?.kickoff).toMatchObject({form_id: FORMS.kickoffOld, answers: [{value: 'two'}]});
    expect(rows[2].forms).toEqual({});
  });

  test('keeping only the newest response per card changes no card forms', () => {
    const data: FormData = {
      definitions: {onboarding: definition(FORMS.onboarding), kickoff: definition(FORMS.kickoff), kickoffOld: definition(FORMS.kickoffOld), blueprint: definition(FORMS.blueprint)},
      responses: {
        onboarding: [response(FORMS.onboarding, 'a', '2026-10-01T00:00:00Z', 'old'), response(FORMS.onboarding, 'a', '2026-10-02T00:00:00Z', 'new'), response(FORMS.onboarding, 'b', '2026-10-01T00:00:00Z')],
        kickoff: [response(FORMS.kickoff, 'a', '2026-10-03T00:00:00Z')],
        kickoffOld: [response(FORMS.kickoffOld, 'a', '2026-10-03T00:00:00Z'), response(FORMS.kickoffOld, 'b', '2026-10-03T00:00:00Z')],
        blueprint: [],
      },
    };
    for (const id of ['a', 'b', 'c']) expect(formsFor(id, newestOnly(data))).toEqual(formsFor(id, data));
    expect(newestOnly(data).responses.onboarding?.length).toBe(2);
  });

  test('cards without a name, fields or this list are left as before and said', async () => {
    const w = world({pages: [{tasks: [card(1), card(2, {custom_fields: undefined}), card(3, {name: '  '}), card(4, {list: {id: '1'}}), card(1)], last_page: true}]});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(m.batches.flatMap(b => b.rows.map(r => r.clickup_task_id))).toEqual(['cu-1']);
    expect(result.counts).toMatchObject({cards: 1, unreadable: 3});
    expect(result.problem).toBe('ClickUp returned 3 cards with no name, no fields or another list, so they were left as before.');
    expect(result.ok).toBe(true);
  });

  test('no readable cards is a failure, never zero', async () => {
    const w = world({pages: [{tasks: [], last_page: true}]});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(m.batches).toEqual([]);
    expect(result.ok).toBe(false);
    expect(m.finished[0]).toMatchObject({ok: false, problem: 'ClickUp returned no readable client cards, so nothing changed. Check that the ClickUp token can still see the Clients - Mahara list.'});
    expect(m.states[0]).toEqual({ok: false, note: 'ClickUp returned no readable client cards, so nothing changed. Check that the ClickUp token can still see the Clients - Mahara list.', rows_seen: 0});
  });

  test('another open run means this one does nothing', async () => {
    const w = world();
    const m = memoryStore({begin: {busy: true}});
    expect(await syncAll(m.store, w.sources, w.clock)).toMatchObject({ok: true, skipped: 'busy'});
    expect(w.calls).toEqual([]);
    expect(m.finished).toEqual([]);
    expect(m.states).toEqual([]);
  });

  test('cards the roster names differently are counted and said', async () => {
    const w = world();
    const m = memoryStore({publish: rows => ({written: rows.length - 1, unchanged: 0, identitySkipped: 1})});
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(result.counts).toMatchObject({written: 2, identity_skipped: 1});
    expect(result.problem).toBe('1 card was not updated because the card name differs from the client roster. They update after the roster refreshes.');
  });
});

describe('forms are kept when Typeform cannot be read', () => {
  test('a Typeform outage keeps every row\'s forms and says so; the cards still update', async () => {
    const w = world({respond: url => (url.hostname === 'api.typeform.com' && url.pathname.endsWith('/responses') ? new Response('{}', {status: 503}) : undefined)});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(m.batches[0].formsVerified).toBe(false);
    expect(m.batches[0].rows.every(r => r.forms === undefined)).toBe(true);
    expect(result).toMatchObject({ok: true, problem: TYPEFORM_UNVERIFIED});
    expect(result.counts).not.toHaveProperty('onboarding_forms');
    expect(w.clock.sleeps.filter(ms => ms >= 5_000)).toEqual([5_000, 15_000]);
  });

  test('a missing Typeform token makes no Typeform call and names the key', async () => {
    const w = world({env: {TYPEFORM_TOKEN: ''}});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(w.calls.some(c => c.url.hostname === 'api.typeform.com')).toBe(false);
    expect(result.problem).toContain('TYPEFORM_TOKEN is not set');
    expect(m.batches[0].formsVerified).toBe(false);
  });
});

describe('ClickUp failures leave the rows unchanged', () => {
  test('a missing ClickUp token makes no call and names the key', async () => {
    const w = world({env: {CLICKUP_API_TOKEN: ''}});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(w.calls).toEqual([]);
    expect(m.batches).toEqual([]);
    expect(result.ok).toBe(false);
    expect(m.finished[0].problem).toContain('CLICKUP_API_TOKEN is not set');
  });

  test('a refused key is said plainly and the state note keeps the redacted detail', async () => {
    const w = world({respond: url => (url.hostname === 'api.clickup.com' ? new Response('{"err":"Token invalid"}', {status: 401}) : undefined)});
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(result.ok).toBe(false);
    expect(m.finished[0].problem).toBe('ClickUp refused the key. Existing links and forms are unchanged. Ask an administrator to renew CLICKUP_API_TOKEN.');
    expect(m.states[0].note).toContain('(401)');
    expect(w.calls.length).toBe(1);
  });

  test('a failed save stops the run and says rows saved before it stay', async () => {
    const w = world({pages: [{tasks: cards(1, 50), last_page: true}]});
    let n = 0;
    const m = memoryStore({publish: rows => {if (++n === 2) throw Error('duplicate key value with eyJhbGciOiJIUzI1NiJ9.secretpayload'); return {written: rows.length, unchanged: 0, identitySkipped: 0};}});
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(result.ok).toBe(false);
    expect(m.finished[0]).toMatchObject({ok: false, problem: 'The scheduled onboarding sync could not save the cards. Rows saved before the failure stay. Check the function log.', counts: {written: 20}});
    expect(m.states[0].note).not.toContain('eyJhbGci');
  });
});

describe('rate limits and the time limit', () => {
  test('calls to each provider are spaced and a 429 is tried again', async () => {
    let limited = false;
    const w = world({
      pages: [{tasks: cards(1, 100), last_page: false}, {tasks: cards(101, 100), last_page: false}, {tasks: cards(201, 5), last_page: true}],
      latency: () => 50,
      respond: url => {if (url.pathname.endsWith('/task') && url.searchParams.get('page') === '1' && !limited) {limited = true; return new Response('{}', {status: 429});} return undefined;},
    });
    const m = memoryStore();
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({cards: 205, pages: 3});
    const gaps = (host: string) => {const at = w.calls.filter(c => c.url.hostname === host).map(c => c.at); return at.slice(1).map((t, i) => t - at[i]);};
    expect(Math.min(...gaps('api.clickup.com'))).toBeGreaterThanOrEqual(CLICKUP_GAP_MS);
    expect(Math.min(...gaps('api.typeform.com'))).toBeGreaterThanOrEqual(TYPEFORM_GAP_MS);
    expect(w.clock.sleeps).toContain(5_000);
    expect(w.receipts.some(x => x.provider === 'clickup' && x.http_status === 429)).toBe(true);
  });

  test('a slow run stops starting pages at the budget and the next run continues from there', async () => {
    const pages = Array.from({length: 6}, (_, p) => ({tasks: cards(p * 100 + 1, 100), last_page: p === 5}));
    const slow = (url: URL) => (url.pathname.endsWith('/task') ? 30_000 : 200);
    const w = world({pages, latency: slow});
    const m = memoryStore();
    const first = await syncAll(m.store, w.sources, w.clock);
    expect(first.ok).toBe(false);
    expect(first.counts?.resume_page).toBe(4);
    expect(first.counts?.cards).toBe(400);
    expect(first.problem).toBe('This run read 400 cards before its time ran out. The next run continues from page 5.');
    expect(w.clock.t - 1_000_000).toBeLessThan(BUDGET_MS + 31_000);

    const w2 = world({pages, latency: slow});
    const m2 = memoryStore({begin: {busy: false, run: 8, resumePage: 4}});
    const second = await syncAll(m2.store, w2.sources, w2.clock);
    expect(w2.calls.filter(c => c.url.pathname.endsWith('/task')).map(c => c.url.searchParams.get('page'))).toEqual(['4', '5']);
    expect(second).toMatchObject({ok: true, problem: null});
    expect(second.counts).toMatchObject({start_page: 4, cards: 200});
    expect(m2.states[0].note).toBe('200 cards, 200 changed, from page 5');
  });

  test('a resumed run that finds its page empty finishes without calling it a failure', async () => {
    const w = world({pages: [{tasks: cards(1, 100), last_page: false}]});
    const m = memoryStore({begin: {busy: false, run: 9, resumePage: 3}});
    const result = await syncAll(m.store, w.sources, w.clock);
    expect(result).toMatchObject({ok: true, counts: {cards: 0}});
  });
});

describe('the Supabase store', () => {
  function fakeAdmin(rpc: (name: string, args: Record<string, unknown>) => {data: unknown; error: {message: string} | null}) {
    const writes: {table: string; op: string; row: unknown; filters: unknown[]}[] = [];
    const admin: Admin = {
      rpc: async (name, args) => rpc(name, args),
      from: (table: string) => ({
        update: (row: unknown) => {const w = {table, op: 'update', row, filters: [] as unknown[]}; writes.push(w); const chain = {eq: (...f: unknown[]) => {w.filters.push(f); return chain;}, is: async (...f: unknown[]) => {w.filters.push(f); return {error: null};}}; return chain;},
        upsert: async (row: unknown, opts: unknown) => {writes.push({table, op: 'upsert', row, filters: [opts]}); return {error: null};},
      }),
    };
    return {admin, writes};
  }
  const clock = {now: () => Date.parse('2026-10-09T10:04:00Z'), sleep: async () => undefined};

  test('begin and publish read their RPC answers strictly', async () => {
    const {admin} = fakeAdmin(name => (name === 'cockpit_csm_onboarding_cron_begin' ? {data: {busy: false, run: 12, resumePage: 0}, error: null} : {data: {written: 1, unchanged: 1, identitySkipped: 0}, error: null}));
    const store = supabaseStore(admin, clock);
    expect(await store.begin()).toEqual({busy: false, run: 12, resumePage: 0});
    expect(await store.publish(12, [{} as OnboardingRow, {} as OnboardingRow], true)).toEqual({written: 1, unchanged: 1, identitySkipped: 0});
    await expect(store.publish(12, [{} as OnboardingRow], true)).rejects.toThrow('did not account for every card');
    const busy = supabaseStore(fakeAdmin(() => ({data: {busy: true}, error: null})).admin, clock);
    expect(await busy.begin()).toEqual({busy: true});
    const missing = supabaseStore(fakeAdmin(() => ({data: null, error: {message: 'function does not exist'}})).admin, clock);
    await expect(missing.begin()).rejects.toThrow('could not start: function does not exist');
  });

  test('finish closes only the open run; state keeps last_ok_at for good runs only', async () => {
    const {admin, writes} = fakeAdmin(() => ({data: null, error: null}));
    const store = supabaseStore(admin, clock);
    await store.finish(12, true, {cards: 3}, null);
    await store.state({ok: true, note: 'fine', rows_seen: 3});
    await store.state({ok: false, note: 'bad', rows_seen: null});
    expect(writes[0]).toEqual({table: 'cockpit_client_onboarding_runs', op: 'update', row: {finished_at: '2026-10-09T10:04:00.000Z', ok: true, counts: {cards: 3}, problem: null}, filters: [['id', 12], ['finished_at', null]]});
    expect(writes[1].row).toEqual({key: 'onboarding-sync', last_run_at: '2026-10-09T10:04:00.000Z', updated_at: '2026-10-09T10:04:00.000Z', ok: true, note: 'fine', rows_seen: 3, last_ok_at: '2026-10-09T10:04:00.000Z'});
    expect(writes[2].row).not.toHaveProperty('last_ok_at');
    expect(writes[1].filters).toEqual([{onConflict: 'key'}]);
  });
});

describe('the HTTP door', () => {
  const env = (extra: Record<string, string> = {}) => (name: string) => ({CRON_SECRET: 'cron-secret', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service', CLICKUP_API_TOKEN: 'pk_1', TYPEFORM_TOKEN: '', ...extra} as Record<string, string>)[name];
  const post = (headers: Record<string, string>, body = '{}') => new Request('https://example.invalid/functions/v1/onboarding-sync', {method: 'POST', headers, body});
  const never = () => {throw Error('must not connect');};
  const noFetch = (async () => {throw Error('must not call a provider');}) as unknown as typeof fetch;

  test('only the cron secret opens it', async () => {
    expect((await handle(post({}), env(), never)).status).toBe(401);
    expect((await handle(post({'x-cron-secret': 'cron-secreT'}), env(), never)).status).toBe(401);
    expect((await handle(post({'x-cron-secret': 'cron-secret'}), env({CRON_SECRET: ''}), never)).status).toBe(503);
    expect((await handle(new Request('https://example.invalid', {method: 'GET'}), env(), never)).status).toBe(405);
  });

  test('doctor names missing keys and calls nothing', async () => {
    const res = await handle(post({'x-cron-secret': 'cron-secret'}, '{"doctor":true}'), env(), never, undefined, noFetch);
    expect(await res.json()).toEqual({ok: false, keys: {SUPABASE_URL: 'set', SUPABASE_SERVICE_ROLE_KEY: 'set', CLICKUP_API_TOKEN: 'set', TYPEFORM_TOKEN: 'missing'}});
  });

  test('a dry run writes no cockpit rows', async () => {
    const tables: string[] = [];
    const rpcs: string[] = [];
    const admin: Admin = {rpc: async name => {rpcs.push(name); return {data: null, error: null};}, from: table => {tables.push(table); return {insert: async () => ({error: null})};}};
    const request = (async (resource: string | URL | Request) => {
      const url = new URL(resource instanceof Request ? resource.url : resource);
      if (url.pathname.endsWith('/field')) return new Response(JSON.stringify(fields));
      return new Response(JSON.stringify({tasks: cards(1, 2), last_page: true}));
    }) as typeof fetch;
    const clock = virtualClock();
    const res = await handle(post({'x-cron-secret': 'cron-secret'}, '{"dryRun":true}'), env(), () => admin, clock, request);
    expect(await res.json()).toMatchObject({ok: true, dryRun: true, counts: {cards: 2, written: 0, unchanged: 2}});
    expect(rpcs).toEqual([]);
    expect(new Set(tables)).toEqual(new Set(['cockpit_csm_provider_health']));
  });

  test('a missing begin RPC is said and recorded, not thrown', async () => {
    const states: unknown[] = [];
    const admin: Admin = {
      rpc: async () => ({data: null, error: {message: 'Could not find the function public.cockpit_csm_onboarding_cron_begin'}}),
      from: table => ({upsert: async (row: unknown) => {states.push({table, row}); return {error: null};}}),
    };
    const res = await handle(post({'x-cron-secret': 'cron-secret'}), env(), () => admin, virtualClock(), noFetch);
    expect(await res.json()).toMatchObject({ok: false, note: expect.stringContaining('could not start')});
    expect(states).toMatchObject([{table: 'cockpit_sync_state', row: {key: 'onboarding-sync', ok: false}}]);
  });
});

test('redaction removes provider keys and tokens', () => {
  expect(redact('pk_12345_ABCDEF and tfp_abcdefgh and eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe('[key] and [key] and [key]');
  expect(dryRunStore()).toBeDefined();
});
