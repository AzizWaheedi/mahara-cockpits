import {expect, test} from 'bun:test';
import {captureStills} from './stills';
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
