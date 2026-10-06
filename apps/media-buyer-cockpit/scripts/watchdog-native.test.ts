import {afterEach, expect, test} from 'bun:test';
import {GET, judge, parseSummary, REQUIRED_CHECKS} from '../api/watchdog';

const now = Date.parse('2026-10-04T12:00:00Z');
const fixture = () => ({version: 1, checked_at: new Date(now).toISOString(), checks: REQUIRED_CHECKS.map(key => ({key, name: key, ok: true, error: null, at: new Date(now).toISOString(), max_age_min: 45}))});
test('native state requires every producer and section, not just a recent machine section', () => {
  const s = fixture(); s.checks = s.checks.filter(c => c.key !== 'worker:media-core');
  expect(judge(parseSummary(s), now).some(p => p.key.includes('missing'))).toBe(true);
});
test('45 minute boundary stays strict and future timestamps cannot prove freshness', () => {
  const s = fixture(); s.checks[0].at = new Date(now - 45 * 60000).toISOString();
  expect(judge(parseSummary(s), now)).toEqual([]);
  s.checks[0].at = new Date(now - 45 * 60000 - 1).toISOString();
  expect(judge(parseSummary(s), now)).toHaveLength(1);
  s.checks[0].at = new Date(now + 60001).toISOString();
  expect(judge(parseSummary(s), now)).toHaveLength(1);
});
test('failed doctor or producer remains failed with a recent timestamp', () => {
  const s = fixture(); s.checks[0].ok = false;
  expect(judge(parseSummary(s), now)).toHaveLength(1);
});
test('invalid, duplicated, or empty summary cannot report all clear', () => {
  expect(() => parseSummary({version: 1, checks: []})).toThrow();
  const s = fixture(); s.checks.push(s.checks[0]);
  expect(() => parseSummary(s)).toThrow();
});
const saved = {...process.env}; const originalFetch = globalThis.fetch;
afterEach(() => {process.env = {...saved}; globalThis.fetch = originalFetch;});
test('CRON_SECRET rejects before any network call', async () => {
  process.env.CRON_SECRET = 'test-secret';
  globalThis.fetch = (() => {throw Error('must not call');}) as typeof fetch;
  expect((await GET(new Request('https://example.com/api/watchdog?dry=1'))).status).toBe(401);
});
test('dry plus test cannot send Slack; missing service setup explicitly fails', async () => {
  process.env.CRON_SECRET = 'test-secret'; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = (() => {throw Error('must not call');}) as typeof fetch;
  const r = await GET(new Request('https://example.com/api/watchdog?dry=1&test=1', {headers: {authorization: 'Bearer test-secret'}}));
  expect((await r.json()).ok).toBe(false);
});
