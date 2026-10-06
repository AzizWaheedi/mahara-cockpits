import { expect, test } from 'bun:test';
import { parseFrequencyRead, readFrequencyWindow } from './frequency.ts';

test('frequency reads use whole-window account reach and exclude webinar and hiring campaigns', async () => {
  const calls: { path: string; params: Record<string, string | number> }[] = [];
  const result = await readFrequencyWindow('2026-09-01', '2026-09-30', async (path, params) => {
    calls.push({ path, params });
    if (path.endsWith('/campaigns')) return { data: [
      { id: '101', name: 'September lead generation' },
      { id: '102', name: 'Remarketing - warm audience' },
      { id: '103', name: 'Recruiting' },
      { id: '104', name: 'Webinar September' },
    ], paging: {} };
    const ids = JSON.parse(String(params.filtering))[0].value;
    return { data: [{ impressions: ids[0] === '101' ? '180' : '70', reach: ids[0] === '101' ? '120' : '20', frequency: ids[0] === '101' ? '1.5' : null, spend: ids[0] === '101' ? '27.45' : '8.10' }] };
  }, () => Date.parse('2026-10-01T00:00:00Z'));

  expect(result.leadGen).toEqual({ campaigns: 1, impressions: 180, reach: 120, frequency: 1.5, spend: 27.45 });
  expect(result.retargeting).toEqual({ campaigns: 1, impressions: 70, reach: 20, frequency: 3.5, spend: 8.1 });
  expect(calls).toHaveLength(3);
  for (const call of calls.slice(1)) {
    expect(call.params.level).toBe('account');
    expect(JSON.parse(String(call.params.time_range))).toEqual({ since: '2026-09-01', until: '2026-09-30' });
  }
  expect(JSON.parse(String(calls[1].params.filtering))[0].value).toEqual(['101']);
  expect(JSON.parse(String(calls[2].params.filtering))[0].value).toEqual(['102']);
});

test('frequency rejects a future window before making a Meta request', async () => {
  let called = false;
  await expect(readFrequencyWindow('2026-10-05', '2026-10-06', async () => {
    called = true;
    return { data: [] };
  }, () => Date.parse('2026-10-04T00:00:00Z'))).rejects.toThrow('future');
  expect(called).toBe(false);
});

test('malformed persisted frequency payloads are rejected instead of reusing zero-filled cache rows', () => {
  const valid = { from: '2026-09-01', to: '2026-09-30', computedAt: 1790800000000, leadGen: { campaigns: 1, impressions: 180, reach: 120, frequency: 1.5, spend: 27.45 }, retargeting: null, note: 'whole-window source' };
  expect(parseFrequencyRead(valid)).toEqual(valid);
  expect(parseFrequencyRead({ ...valid, leadGen: { campaigns: 1, impressions: 180, frequency: null, spend: 27.45 } })).toBeNull();
});
