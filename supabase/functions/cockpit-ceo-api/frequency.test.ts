import { expect, test } from 'bun:test';
import { ACCOUNT_TIME_ZONE_FALLBACK, accountDay, metaUntil, parseFrequencyRead, readFrequencyWindow, readLevelFrequency } from './frequency.ts';

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
    if (params.level === 'campaign') return { data: [
      { campaign_id: '101', impressions: '180', reach: '120' },
      { campaign_id: '102', impressions: '70', reach: '20' },
    ], paging: {} };
    const ids = JSON.parse(String(params.filtering))[0].value;
    return { data: [{ impressions: ids[0] === '101' ? '180' : '70', reach: ids[0] === '101' ? '120' : '20', frequency: ids[0] === '101' ? '1.5' : null, spend: ids[0] === '101' ? '27.45' : '8.10' }] };
  }, () => Date.parse('2026-10-01T00:00:00Z'));

  expect(result.leadGen).toEqual({ campaigns: 1, listed: 1, impressions: 180, reach: 120, frequency: 1.5, spend: 27.45 });
  expect(result.retargeting).toEqual({ campaigns: 1, listed: 1, impressions: 70, reach: 20, frequency: 3.5, spend: 8.1 });
  expect(calls).toHaveLength(4);
  expect(calls[1].params.level).toBe('campaign');
  for (const call of calls.slice(1)) expect(JSON.parse(String(call.params.time_range))).toEqual({ since: '2026-09-01', until: '2026-09-30' });
  for (const call of calls.slice(2)) expect(call.params.level).toBe('account');
  expect(JSON.parse(String(calls[2].params.filtering))[0].value).toEqual(['101']);
  expect(JSON.parse(String(calls[3].params.filtering))[0].value).toEqual(['102']);
});

// Audit 2026-10-16: the Marketing card read "10 campaigns" where 4 delivered.
test('the campaign count is the campaigns that delivered in the window; the totals are unchanged', async () => {
  const result = await readFrequencyWindow('2026-07-18', '2026-10-15', async (path, params = {}) => {
    if (path.endsWith('/campaigns')) return { data: [
      { id: '1', name: 'MaharaMedia | Lead Gen | 4-12-25' },
      { id: '2', name: 'MaharaMedia | Lead Gen | 8-9-26 | CBO' },
      { id: '3', name: 'MaharaMedia | Lead Gen | 7-8-26 | CBO' },
      { id: '4', name: 'MaharaMedia | Lead Gen | 19-9-26 | TEST' },
      { id: '5', name: '[MhM] Hammer Them Strategy [SFC] | 24-5-26' },
      { id: '6', name: '[MhM] Hammer Them Strategy [LFC] | 24-5-26' },
    ], paging: {} };
    // Meta returns delivered campaigns, and can return one at 0 impressions.
    if (params.level === 'campaign') return { data: [
      { campaign_id: '1', impressions: '16983', reach: '8379' },
      { campaign_id: '2', impressions: '4100', reach: '2000' },
      { campaign_id: '3', impressions: '0', reach: '0' },
      { campaign_id: '5', impressions: '1272', reach: '151' },
    ], paging: {} };
    const ids = JSON.parse(String(params.filtering))[0].value as string[];
    return { data: [ids.includes('1')
      ? { impressions: '21083', reach: '9000', frequency: '2.3426', spend: '612.5' }
      : { impressions: '1272', reach: '151', frequency: '8.4238', spend: '54.71' }] };
  }, () => Date.parse('2026-10-16T05:00:00Z'));
  expect(result.leadGen).toEqual({ campaigns: 2, listed: 4, impressions: 21083, reach: 9000, frequency: 2.34, spend: 612.5 });
  expect(result.retargeting).toEqual({ campaigns: 1, listed: 2, impressions: 1272, reach: 151, frequency: 8.42, spend: 54.71 });
  expect(result.note).toContain('2 of 4 lead-gen and 1 of 2 retargeting campaigns on the account delivered');
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
  const valid = { from: '2026-09-01', to: '2026-09-30', computedAt: 1790800000000, leadGen: { campaigns: 1, listed: 3, impressions: 180, reach: 120, frequency: 1.5, spend: 27.45 }, retargeting: null, note: 'whole-window source' };
  expect(parseFrequencyRead(valid)).toEqual(valid);
  expect(parseFrequencyRead({ ...valid, leadGen: { campaigns: 1, listed: 3, impressions: 180, frequency: null, spend: 27.45 } })).toBeNull();
  // A read cached before the delivered count (no `listed`) counted every campaign: it is read again.
  expect(parseFrequencyRead({ ...valid, leadGen: { campaigns: 10, impressions: 180, reach: 120, frequency: 1.5, spend: 27.45 } })).toBeNull();
});

// The CEO, 2026-10-16: the Ads tab's frequency is Meta's own, per level, for
// the whole window, the number Ads Manager shows for those dates.
test('level frequency pages with an after parameter and keeps Meta\'s whole-window figure per row', async () => {
  const calls: { path: string; params: Record<string, string | number> }[] = [];
  const result = await readLevelFrequency(async (path, params = {}) => {
    calls.push({ path, params });
    if (!params.after) return {
      data: [
        { campaign_id: '120001', impressions: '1272', reach: '151', frequency: '8.423841' },
        { campaign_id: '120002', impressions: '1993', reach: '184' },
      ],
      paging: { cursors: { after: 'CURSOR-2' }, next: 'https://graph.facebook.com/next' },
    };
    return { data: [{ campaign_id: 120003, impressions: 0, reach: 0, frequency: null }], paging: { cursors: { after: 'END' } } };
  }, 'campaign', '2026-10-10', '2026-10-15');

  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.path).toBe('act_746108264865897/insights');
    expect(call.path).not.toContain('?');
    expect(call.params.level).toBe('campaign');
    expect(call.params.fields).toBe('campaign_id,impressions,reach,frequency');
    expect(call.params.limit).toBe(500);
    expect(JSON.parse(String(call.params.time_range))).toEqual({ since: '2026-10-10', until: '2026-10-15' });
  }
  expect(calls[0].params.after).toBeUndefined();
  expect(calls[1].params.after).toBe('CURSOR-2');
  // Meta's figure rounded to 2 decimals; impressions over reach when Meta leaves it out; null without reach.
  expect(result.get('120001')).toEqual({ impressions: 1272, reach: 151, frequency: 8.42 });
  expect(result.get('120002')).toEqual({ impressions: 1993, reach: 184, frequency: 10.83 });
  expect(result.get('120003')).toEqual({ impressions: 0, reach: 0, frequency: null });
});

test('level frequency throws on a malformed row, a duplicate, a broken page or a runaway pager', async () => {
  const one = (data: unknown[], paging: unknown = {}) => async () => ({ data, paging });
  await expect(readLevelFrequency(one([{ ad_id: '1', impressions: '10' }]), 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('reach');
  await expect(readLevelFrequency(one([{ impressions: '10', reach: '5' }]), 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('without an ID');
  await expect(readLevelFrequency(one([{ adset_id: '1', impressions: '10', reach: '5', frequency: 'many' }]), 'adset', '2026-10-10', '2026-10-15')).rejects.toThrow('frequency');
  await expect(readLevelFrequency(one(['row']), 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('invalid');
  await expect(readLevelFrequency(one([{ ad_id: '1', impressions: 1, reach: 1 }, { ad_id: '1', impressions: 1, reach: 1 }]), 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('twice');
  await expect(readLevelFrequency(async () => ({ error: { code: 17 } }), 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('did not confirm');
  await expect(readLevelFrequency(one([], { next: 'more' }), 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('incomplete');
  let pages = 0;
  await expect(readLevelFrequency(async () => { pages += 1; return { data: [], paging: { next: 'more', cursors: { after: `c${pages}` } } }; }, 'ad', '2026-10-10', '2026-10-15')).rejects.toThrow('safe page limit');
  expect(pages).toBe(20);
  await expect(readLevelFrequency(one([]), 'ad', '2026-10-16', '2026-10-15')).rejects.toThrow('ends before');
});

test('Meta\'s days are the account\'s days: a Kuwait morning is still yesterday in Los Angeles', () => {
  const now = Date.parse('2026-10-16T05:00:00Z');
  expect(ACCOUNT_TIME_ZONE_FALLBACK).toBe('America/Los_Angeles');
  expect(accountDay(now, 'Asia/Kuwait')).toBe('2026-10-16');
  expect(accountDay(now, 'America/Los_Angeles')).toBe('2026-10-15');
  expect(metaUntil('2026-10-16', now, 'America/Los_Angeles')).toBe('2026-10-15');
  // Once the day has started in Los Angeles (07:00 Pacific), Meta can report it.
  expect(metaUntil('2026-10-16', Date.parse('2026-10-16T14:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-16');
  // A window that ended before the account's today is left alone.
  expect(metaUntil('2026-10-12', now, 'America/Los_Angeles')).toBe('2026-10-12');
});
