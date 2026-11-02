import {describe, expect, test} from 'bun:test';
import {handle} from './run.ts';

// The cron door, retired (WAVE12-CONTRACT 4.11.3): only the vault's shared
// secret gets in, and whatever it asks, nothing reaches ClickUp or Typeform;
// the answer is the retired sentence and the run state says it.

const RETIRED = 'Retired: the billing sheet writes the extension field.';
const post = (headers: Record<string, string> = {}, body = '{}') => new Request('https://example.invalid', {method: 'POST', headers, body});
const env = (over: Record<string, string> = {}) => (name: string) =>
  ({CRON_SECRET: 'cron-secret', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...over})[name];
const never = () => { throw Error('should not connect'); };
const NOW = () => new Date('2026-11-10T09:47:00Z');

function admin(error: unknown = null) {
  const upserts: unknown[] = [];
  return {upserts, client: {from: (t: string) => ({upsert: async (row: unknown, opts: unknown) => { upserts.push([t, row, opts]); return {error}; }})}};
}

describe('ceo-extensions-sync', () => {
  test('refuses callers without the cron secret, and says when the secret is missing', async () => {
    expect((await handle(post(), env(), never)).status).toBe(401);
    expect((await handle(post({'x-cron-secret': 'cron-secreT'}), env(), never)).status).toBe(401);
    expect((await handle(post({'x-cron-secret': 'cron-secret'}), env({CRON_SECRET: ''}), never)).status).toBe(503);
    expect((await handle(new Request('https://example.invalid', {method: 'GET'}), env(), never)).status).toBe(405);
  });

  test('answers only the automatic pass', async () => {
    expect((await handle(post({'x-cron-secret': 'cron-secret'}, '{"operation":"ceo.bank.import"}'), env(), never)).status).toBe(403);
    expect((await handle(post({'x-cron-secret': 'cron-secret'}, 'not json'), env(), never)).status).toBe(400);
  });

  test('doctor says it is retired and names missing keys without values', async () => {
    const body = await (await handle(post({'x-cron-secret': 'cron-secret'}, '{"doctor":true}'), env({SUPABASE_SERVICE_ROLE_KEY: ''}), never)).json();
    expect(body).toEqual({ok: false, retired: true, note: RETIRED, keys: {SUPABASE_URL: 'set', SUPABASE_SERVICE_ROLE_KEY: 'missing'}});
  });

  test('a call writes nothing anywhere but its own run state, and answers the retired sentence', async () => {
    const a = admin();
    const res = await handle(post({'x-cron-secret': 'cron-secret'}, '{"operation":"ceo.extensions.applyAuto"}'), env({CEO_EXTENSIONS_APPLY: 'true'}), (url, key) => (url === 'https://x.supabase.co' && key === 'svc' ? a.client : never()), NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true, retired: true, note: RETIRED, written: 0, cleared: 0, skipped: 0, errors: []});
    expect(a.upserts).toEqual([['cockpit_sync_state', {key: 'ceo-extensions-auto', last_run_at: '2026-11-10T09:47:00.000Z', last_ok_at: '2026-11-10T09:47:00.000Z', ok: true, note: RETIRED, rows_seen: 0, updated_at: '2026-11-10T09:47:00.000Z'}, {onConflict: 'key'}]]);
  });

  test('a run state that will not save answers 500 with the reason; no service door still answers retired', async () => {
    const a = admin({message: 'denied'});
    const res = await handle(post({'x-cron-secret': 'cron-secret'}), env(), () => a.client, NOW);
    expect(res.status).toBe(500);
    expect((await res.json()).note).toBe(`${RETIRED} The run state was not marked (the run state was not saved).`);
    const bare = await handle(post({'x-cron-secret': 'cron-secret'}), env({SUPABASE_URL: ''}), never, NOW);
    expect(bare.status).toBe(200);
    expect((await bare.json()).note).toContain(RETIRED);
  });
});
