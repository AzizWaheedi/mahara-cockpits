import {describe, expect, test} from 'bun:test';
import {handle} from './run.ts';

// The cron door: only the vault's shared secret gets in, only the automatic
// pass runs, and the pass gets the service client and a health writer.

const post = (headers: Record<string, string> = {}, body = '{}') => new Request('https://example.invalid', {method: 'POST', headers, body});
const env = (over: Record<string, string> = {}) => (name: string) =>
  ({CRON_SECRET: 'cron-secret', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', CLICKUP_API_TOKEN: 'cu', TYPEFORM_TOKEN: 'tf', ...over})[name];
const never = () => { throw Error('should not connect'); };
const neverRun = async () => { throw Error('should not run'); };

describe('ceo-extensions-sync', () => {
  test('refuses callers without the cron secret, and says when the secret is missing', async () => {
    expect((await handle(post(), env(), never, neverRun)).status).toBe(401);
    expect((await handle(post({'x-cron-secret': 'cron-secreT'}), env(), never, neverRun)).status).toBe(401);
    expect((await handle(post({'x-cron-secret': 'cron-secret'}), env({CRON_SECRET: ''}), never, neverRun)).status).toBe(503);
    expect((await handle(new Request('https://example.invalid', {method: 'GET'}), env(), never, neverRun)).status).toBe(405);
  });

  test('runs only the automatic pass', async () => {
    const res = await handle(post({'x-cron-secret': 'cron-secret'}, '{"operation":"ceo.bank.import"}'), env(), never, neverRun);
    expect(res.status).toBe(403);
    expect((await handle(post({'x-cron-secret': 'cron-secret'}, 'not json'), env(), never, neverRun)).status).toBe(400);
  });

  test('doctor names missing keys and the apply switch, without values', async () => {
    const res = await handle(post({'x-cron-secret': 'cron-secret'}, '{"doctor":true}'), env({TYPEFORM_TOKEN: ''}), never, neverRun);
    const body = await res.json();
    expect(body).toEqual({ok: false, apply: false, keys: {SUPABASE_URL: 'set', SUPABASE_SERVICE_ROLE_KEY: 'set', CLICKUP_API_TOKEN: 'set', TYPEFORM_TOKEN: 'missing'}});
    expect(JSON.stringify(body)).not.toContain('svc');
  });

  test('hands the pass the service client, the env and a health writer that records receipts', async () => {
    const inserted: unknown[] = [];
    const admin = {from: (t: string) => ({insert: async (row: unknown) => { inserted.push([t, row]); return {error: null}; }})};
    let seen: unknown[] = [];
    const run = (async (a: unknown, e: (n: string) => string | undefined, health: (r: Record<string, unknown>) => Promise<void>) => {
      seen = [a, e('CEO_EXTENSIONS_APPLY')];
      await health({provider: 'clickup', ok: true});
      return {ok: true, note: 'Dry run: 0 changes.', written: 0, cleared: 0};
    }) as never;
    const res = await handle(post({'x-cron-secret': 'cron-secret'}, '{"operation":"ceo.extensions.applyAuto"}'), env(), (url, key) => (url === 'https://x.supabase.co' && key === 'svc' ? admin : never()), run);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true, note: 'Dry run: 0 changes.', written: 0, cleared: 0});
    expect(seen).toEqual([admin, undefined]);
    expect(inserted).toEqual([['cockpit_ceo_provider_health', {provider: 'clickup', ok: true}]]);
  });

  test('a failing pass answers 500 with its message', async () => {
    const run = (async () => { throw Error('ClickUp answered 500.'); }) as never;
    const res = await handle(post({'x-cron-secret': 'cron-secret'}), env(), () => ({}), run);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ok: false, note: 'ClickUp answered 500.'});
  });
});
