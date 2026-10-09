import {describe, expect, test} from 'bun:test';
import {refreshOnboarding} from './onboarding.ts';
import {F, FORMS, LIST_ID} from '../../../apps/client-success-cockpit/src/lib/onboardingCore.ts';

// The one-card refresh (trigger 'one'), pinned so the bulk sync can share its reads
// without changing what a CSM's Refresh press does.

const context = {actorId: '27f5abf0-2ccd-4cf7-8550-6f8e7e2b5418', email: 'csm@maharamedia.com', taskId: 'cu-alpha', clientName: 'Alpha', sourceSnapshotAt: '2026-10-07T08:00:00Z'};
const input = {operation: 'onboarding.refresh', args: {taskId: 'cu-alpha', taskIds: ['cu-alpha']}, apply: true, requestId: '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73'};
const fields = {fields: [F.clientStatus, F.kickoffForm, F.salesCall, F.onboardingMap].map(id => ({id, type_config: id === F.clientStatus ? {options: [{id: 'o-nc', orderindex: 6, name: 'Needs Contacting'}]} : {}}))};
const card = {id: 'cu-alpha', name: 'Alpha', url: 'https://app.clickup.com/t/cu-alpha', list: {id: LIST_ID}, status: {status: 'on boarding'}, date_updated: '1759900000000', custom_fields: [{id: F.clientStatus, value: 6}, {id: F.kickoffForm, value: 'https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=cu-alpha'}]};
const definition = (id: string) => ({id, fields: [{ref: 'q1', title: 'Business name | اسم النشاط', type: 'short_text'}]});
const response = (token: string, at: string) => ({token, response_id: token, submitted_at: at, hidden: {onboarding_client_id: 'cu-alpha'}, answers: [{field: {ref: 'q1'}, type: 'text', text: 'Alpha Co'}]});

function fixture(options: {typeform?: (url: URL) => {status: number; body: unknown} | undefined; fieldList?: unknown; typeformToken?: string} = {}) {
  const requests: string[] = [];
  const receipts: Record<string, unknown>[] = [];
  const published: Record<string, unknown>[] = [];
  const runs: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const reads: unknown[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === 'cockpit_csm_client_gate') return {data: {...context}, error: null};
      if (name === 'cockpit_csm_onboarding_read') {reads.push(args); return {data: {rows: [], last: null, lastOk: null, now: '2026-10-09T00:00:00Z'}, error: null};}
      throw Error('unexpected rpc ' + name);
    },
  };
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe('cockpit_csm_onboarding_publish');
      published.push(args);
      return {data: null, error: null};
    },
    from(table: string) {
      if (table === 'cockpit_csm_provider_health') return {async insert(row: Record<string, unknown>) {receipts.push(row); return {error: null};}};
      expect(table).toBe('cockpit_client_onboarding_runs');
      return {
        insert(row: Record<string, unknown>) {runs.push(row); return {select: () => ({single: async () => ({data: {id: 41}, error: null})})};},
        update(row: Record<string, unknown>) {updates.push(row); const chain = {eq: () => chain, is: async () => ({error: null})}; return chain;},
      };
    },
  };
  const request = (async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : resource);
    requests.push(`${init?.method ?? 'GET'} ${url.href}`);
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status});
    if (url.hostname === 'api.clickup.com') {
      if (url.pathname.endsWith(`/list/${LIST_ID}/field`)) return reply(200, options.fieldList ?? fields);
      if (url.pathname.endsWith('/task/cu-alpha')) return reply(200, card);
    }
    if (url.hostname === 'api.typeform.com') {
      const custom = options.typeform?.(url);
      if (custom) return reply(custom.status, custom.body);
      const id = url.pathname.split('/')[2];
      if (!url.pathname.endsWith('/responses')) return reply(200, definition(id));
      return reply(200, {items: id === FORMS.onboarding ? [response('tok-1', '2026-10-01T10:00:00Z')] : []});
    }
    return reply(404, {err: 'unexpected'});
  }) as typeof fetch;
  const env = (name: string) => ({CLICKUP_API_TOKEN: 'pk_test', TYPEFORM_TOKEN: options.typeformToken ?? 'tfp_test'} as Record<string, string>)[name];
  return {client, admin, request, env, requests, receipts, published, runs, updates, reads};
}

describe('one-card onboarding refresh', () => {
  test('a dry run checks access and reads nothing from providers', async () => {
    const f = fixture();
    expect(await refreshOnboarding(f.client, f.admin, {...input, apply: false}, f.env, f.request)).toEqual({dryRun: true, taskId: 'cu-alpha'});
    expect(f.requests).toEqual([]);
    expect(f.runs).toEqual([]);
  });

  test('reads the card and the forms for one card, in order, and publishes one row', async () => {
    const f = fixture();
    const result = await refreshOnboarding(f.client, f.admin, input, f.env, f.request);
    expect(result).toMatchObject({rows: [], problem: null});
    expect(f.runs).toEqual([{trigger: 'one', actor_email: 'csm@maharamedia.com'}]);
    const q = (form: string) => `GET https://api.typeform.com/forms/${form}/responses?page_size=1000&completed=true&query=cu-alpha`;
    expect(f.requests).toEqual([
      `GET https://api.clickup.com/api/v2/list/${LIST_ID}/field`,
      'GET https://api.clickup.com/api/v2/task/cu-alpha',
      `GET https://api.typeform.com/forms/${FORMS.onboarding}`, q(FORMS.onboarding),
      `GET https://api.typeform.com/forms/${FORMS.kickoff}`, q(FORMS.kickoff),
      `GET https://api.typeform.com/forms/${FORMS.kickoffOld}`, q(FORMS.kickoffOld),
      `GET https://api.typeform.com/forms/${FORMS.blueprint}`, q(FORMS.blueprint),
    ]);
    expect(f.receipts.length).toBe(20);
    expect(f.receipts.filter(r => r.provider === 'clickup').length).toBe(4);
    expect(f.receipts.filter(r => r.provider === 'typeform').length).toBe(16);
    expect(f.published.length).toBe(1);
    const saved = f.published[0] as {p_run: number; p_forms_verified: boolean; p_problem: string | null; p_row: Record<string, any>; p_context: unknown};
    expect(saved.p_run).toBe(41);
    expect(saved.p_forms_verified).toBe(true);
    expect(saved.p_problem).toBeNull();
    expect(saved.p_context).toEqual(context);
    expect(saved.p_row).toMatchObject({clickup_task_id: 'cu-alpha', client_name: 'Alpha', client_status: 'Needs Contacting', in_onboarding: true, links: {kickoff_form: card.custom_fields[1].value, clickup: card.url}});
    expect(saved.p_row.forms.onboarding).toMatchObject({form_id: FORMS.onboarding, response_id: 'tok-1', answers: [{ref: 'q1', title: 'Business name', value: 'Alpha Co'}]});
    expect(saved.p_row.forms.kickoff).toBeUndefined();
    expect(f.reads.length).toBe(2);
  });

  test('a Typeform failure keeps the existing forms and says so, with missing card fields named', async () => {
    const f = fixture({typeform: url => (url.pathname.endsWith('/responses') ? {status: 503, body: {}} : undefined), fieldList: {fields: [{id: F.clientStatus, type_config: {options: []}}]}});
    const result = await refreshOnboarding(f.client, f.admin, input, f.env, f.request) as {problem: string};
    const saved = f.published[0] as {p_forms_verified: boolean; p_problem: string; p_row: Record<string, unknown>};
    expect(saved.p_forms_verified).toBe(false);
    expect(saved.p_row.forms).toBeUndefined();
    expect(saved.p_problem).toBe('Typeform could not be verified. Existing submitted forms are retained. Check its provider health ledger. Required ClickUp card fields are missing: Kickoff Form Link, Sales Meeting Link, Onboarding Map. Ask an administrator to restore them.');
    expect(result.problem).toBe(saved.p_problem);
  });

  test('a repeated Typeform page token is treated as unverified forms', async () => {
    const items = Array.from({length: 1000}, (_, i) => response(i === 999 ? 'tok-0' : `tok-${i}`, '2026-10-01T10:00:00Z'));
    const f = fixture({typeform: url => (url.pathname.endsWith('/responses') ? {status: 200, body: {items}} : undefined)});
    await refreshOnboarding(f.client, f.admin, input, f.env, f.request);
    expect((f.published[0] as {p_forms_verified: boolean}).p_forms_verified).toBe(false);
  });

  test('a missing Typeform token keeps the forms and makes no Typeform call', async () => {
    const f = fixture({typeformToken: ''});
    await refreshOnboarding(f.client, f.admin, input, f.env, f.request);
    expect(f.requests.some(r => r.includes('typeform'))).toBe(false);
    expect((f.published[0] as {p_forms_verified: boolean}).p_forms_verified).toBe(false);
  });

  test('a card from another list fails the run and leaves the rows unchanged', async () => {
    const f = fixture();
    const wrong = {...card, list: {id: '1'}};
    const request = (async (resource: string | URL | Request, init?: RequestInit) => {
      const url = new URL(resource instanceof Request ? resource.url : resource);
      if (url.pathname.endsWith('/task/cu-alpha')) return new Response(JSON.stringify(wrong), {status: 200});
      return f.request(resource, init);
    }) as typeof fetch;
    await expect(refreshOnboarding(f.client, f.admin, input, f.env, request)).rejects.toThrow('The provider card identity is missing or changed.');
    expect(f.published).toEqual([]);
    expect(f.updates).toMatchObject([{ok: false, problem: 'The native client refresh did not finish. Existing links and forms are unchanged.'}]);
  });
});
