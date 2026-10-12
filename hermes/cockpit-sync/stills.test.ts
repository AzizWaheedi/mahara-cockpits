import {expect, test} from 'bun:test';
import {captureStills, HISTORY_STILLS_PER_RUN} from './stills';
import type {Reads, Row} from './runtime';

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0]);
const dead = 'https://adorable-seahorse-418.convex.cloud/api/storage/d0adff4c-7578';

function reads(ok: Set<string>, calls: {graph: number; fetched: string[]}): Reads {
  return {
    graph: async () => {
      calls.graph++;
      return {thumbnail_url: 'https://scontent.xx.fbcdn.net/thumb.jpg', image_url: 'https://scontent.xx.fbcdn.net/full.jpg'};
    },
    tool: async () => ({}),
    fetch: async (url: string) => {
      calls.fetched.push(url);
      if (!ok.has(url)) return new Response('gone', {status: 404});
      return new Response(jpeg, {status: 200, headers: {'content-type': 'image/jpeg'}});
    },
    log: () => {},
  };
}

function tables(stillUrl?: string): Record<string, Row[]> {
  return {ads: [], metaTree: [{kind: 'ad', metaId: '333333', creativeId: '444444', stillUrl}], winnersArchive: []};
}

test('a still left on the retired Convex store is captured again', async () => {
  const calls = {graph: 0, fetched: [] as string[]};
  const t = tables(dead);
  const assets = await captureStills({stills: []}, t, reads(new Set(['https://scontent.xx.fbcdn.net/thumb.jpg']), calls));
  expect(assets.map(a => a.key)).toEqual(['c:444444']);
});

test('when the first picture fails, the next one is tried', async () => {
  const calls = {graph: 0, fetched: [] as string[]};
  const assets = await captureStills({stills: []}, tables(), reads(new Set(['https://scontent.xx.fbcdn.net/full.jpg']), calls));
  expect(calls.fetched).toEqual(['https://scontent.xx.fbcdn.net/thumb.jpg', 'https://scontent.xx.fbcdn.net/full.jpg']);
  expect(assets).toHaveLength(1);
});

test('a failed capture records lastTriedAt, so the next run waits instead of retrying at once', async () => {
  const calls = {graph: 0, fetched: [] as string[]};
  const first = tables();
  await captureStills({stills: []}, first, reads(new Set(), calls));
  const failed = first.adStills.find(row => row.key === 'c:444444');
  expect(failed?.status).toBe('failed');
  expect(typeof failed?.lastTriedAt).toBe('number');
  const before = calls.graph;
  await captureStills({stills: first.adStills}, tables(), reads(new Set(), calls));
  expect(calls.graph).toBe(before);
});

test('after five attempts a failed still waits a week, not forever', async () => {
  const calls = {graph: 0, fetched: [] as string[]};
  const old = {key: 'c:444444', status: 'failed', attempts: 7, lastTriedAt: Date.now() - 8 * 86400_000};
  await captureStills({stills: [old]}, tables(), reads(new Set(), calls));
  expect(calls.graph).toBe(1);
});

// An ad from an ended campaign is only in the stored daily history.
function historyReads(creativeOf: Record<string, string>, calls: {graph: string[]; fetched: string[]}): Reads {
  return {
    graph: async (id: string) => {
      calls.graph.push(id);
      if (creativeOf[id]) return {creative: {id: creativeOf[id]}};
      return {thumbnail_url: 'https://scontent.xx.fbcdn.net/thumb.jpg'};
    },
    tool: async () => ({}),
    fetch: async (url: string) => {
      calls.fetched.push(url);
      return new Response(jpeg, {status: 200, headers: {'content-type': 'image/jpeg'}});
    },
    log: () => {},
  };
}
const day = (metaAdId: string, spend = 5) => ({campaignName: 'Ended campaign', date: '2026-09-01', metaAdId, spend, impressions: 100});
const empty = (): Record<string, Row[]> => ({ads: [], metaTree: [], winnersArchive: []});

test('an ad only in the daily history gets a picture under its creative, listing the ad', async () => {
  const calls = {graph: [] as string[], fetched: [] as string[]};
  const t = empty();
  const assets = await captureStills({stills: [], dailyStats: [day('555555')]}, t, historyReads({'555555': '666666'}, calls));
  expect(assets.map(a => a.key)).toEqual(['c:666666']);
  expect(t.adStills.find(row => row.key === 'c:666666')?.adIds).toEqual(['555555']);
});

test('an ad whose creative is already saved is added to that picture without a download', async () => {
  const calls = {graph: [] as string[], fetched: [] as string[]};
  const saved = {key: 'c:666666', status: 'saved', url: 'https://x/y', adId: '111111'};
  const t = empty();
  const assets = await captureStills({stills: [saved], dailyStats: [day('555555')]}, t, historyReads({'555555': '666666'}, calls));
  expect(assets).toEqual([]);
  expect(calls.fetched).toEqual([]);
  expect(t.adStills.find(row => row.key === 'c:666666')?.adIds).toEqual(['111111', '555555']);
});

test('an ad already listed on a saved picture is not looked up again', async () => {
  const calls = {graph: [] as string[], fetched: [] as string[]};
  const saved = {key: 'c:666666', status: 'saved', url: 'https://x/y', adId: '111111', adIds: ['111111', '555555']};
  await captureStills({stills: [saved], dailyStats: [day('555555'), day('111111')]}, empty(), historyReads({}, calls));
  expect(calls.graph).toEqual([]);
});

test('history ads that never spent, or that the board already lists, are skipped', async () => {
  const calls = {graph: [] as string[], fetched: [] as string[]};
  const t = {...empty(), ads: [{metaAdId: '777777', stillUrl: 'https://x/z'}]};
  await captureStills({stills: [], dailyStats: [{...day('888888', 0), impressions: 0}, day('777777')]}, t, historyReads({}, calls));
  expect(calls.graph).toEqual([]);
});

test('a history ad that failed waits like any other failed picture', async () => {
  const calls = {graph: [] as string[], fetched: [] as string[]};
  const failed = {key: 'a:555555', adId: '555555', status: 'failed', attempts: 1, lastTriedAt: Date.now()};
  await captureStills({stills: [failed], dailyStats: [day('555555')]}, empty(), historyReads({}, calls));
  expect(calls.graph).toEqual([]);
});

test('the history backlog is looked up a few ads per run', async () => {
  const calls = {graph: [] as string[], fetched: [] as string[]};
  const rows = Array.from({length: HISTORY_STILLS_PER_RUN + 5}, (_, i) => day(String(900000 + i)));
  await captureStills({stills: [], dailyStats: rows}, empty(), historyReads({}, calls));
  expect(new Set(calls.graph).size).toBe(HISTORY_STILLS_PER_RUN);
});
