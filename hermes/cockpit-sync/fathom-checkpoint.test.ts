import {test} from 'node:test';
import assert from 'node:assert/strict';
// Planned helpers to be implemented in csmProducer.ts in the next pass
import {fathomSince, fathomCheckpoint} from './csmProducer';

test('fathomSince rejects future and non-ISO initial seeds before skipping any updates', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  for (const seed of ['2026-10-08T12:00:00.000Z', '2026', 'October 6, 2026']) {
    assert.throws(() => fathomSince([], now, seed), /seed is invalid/);
  }
});

test('fathomSince chooses the newest successful native_fathom checkpoint and returns 24 hours prior', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const t1 = Date.parse('2026-10-05T10:00:00.000Z');
  const t2 = Date.parse('2026-10-06T10:00:00.000Z');
  const syncRuns = [
    {kind: 'native_fathom', ok: true, at: t1},
    {kind: 'native_fathom', ok: true, at: t2},
  ];

  const result = fathomSince(syncRuns, now);
  // Expected: 24h before t2 (2026-10-05T10:00:00.000Z)
  const expectedIso = new Date(t2 - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result, expectedIso);
});

test('fathomSince chooses the newest successful legacy health record when newer than native_fathom', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const tNative = Date.parse('2026-10-04T10:00:00.000Z');
  const tLegacy = Date.parse('2026-10-06T08:00:00.000Z');
  const syncRuns = [
    {kind: 'native_fathom', ok: true, at: tNative},
    {kind: 'health', ok: true, at: tLegacy},
  ];

  const result = fathomSince(syncRuns, now);
  const expectedIso = new Date(tLegacy - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result, expectedIso);
});

test('fathomSince ignores failed runs and unrelated sync runs', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const tGood = Date.parse('2026-10-05T10:00:00.000Z');
  const tFailed = Date.parse('2026-10-06T12:00:00.000Z');
  const tUnrelated = Date.parse('2026-10-06T15:00:00.000Z');

  const syncRuns = [
    {kind: 'native_fathom', ok: true, at: tGood},
    {kind: 'native_fathom', ok: false, at: tFailed},
    {kind: 'other_kind', ok: true, at: tUnrelated},
  ];

  const result = fathomSince(syncRuns, now);
  const expectedIso = new Date(tGood - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result, expectedIso);
});

test('fathomSince falls back to explicit valid ISO seed when no successful checkpoint exists', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const syncRuns = [
    {kind: 'native_fathom', ok: false, at: Date.parse('2026-10-06T00:00:00.000Z')},
    {kind: 'unrelated', ok: true, at: Date.parse('2026-10-06T00:00:00.000Z')},
  ];
  const seed = '2026-09-01T00:00:00.000Z';

  const result = fathomSince(syncRuns, now, seed);
  assert.equal(result, seed);
});

test('fathomSince throws clear verified checkpoint required error if no checkpoint and no seed', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const syncRuns = [
    {kind: 'native_fathom', ok: false, at: Date.parse('2026-10-06T00:00:00.000Z')},
  ];

  assert.throws(
    () => fathomSince(syncRuns, now),
    /verified checkpoint required/i,
  );
  assert.throws(
    () => fathomSince([], now),
    /verified checkpoint required/i,
  );
});

test('fathomSince throws when seed is provided but invalid', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  assert.throws(
    () => fathomSince([], now, 'invalid-date'),
    /verified checkpoint required|invalid seed/i,
  );
});

test('fathomSince fails closed on candidate with future or non-finite timestamp', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const futureRun = [
    {kind: 'native_fathom', ok: true, at: now + 60000},
  ];
  const nonFiniteRun = [
    {kind: 'native_fathom', ok: true, at: NaN},
  ];

  assert.throws(
    () => fathomSince(futureRun, now),
    /future|invalid|closed|checkpoint/i,
  );
  assert.throws(
    () => fathomSince(nonFiniteRun, now),
    /finite|invalid|closed|checkpoint/i,
  );
});

test('fathomSince does not cap an old valid checkpoint to recent days', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const oldAt = Date.parse('2025-01-01T00:00:00.000Z');
  const syncRuns = [
    {kind: 'native_fathom', ok: true, at: oldAt},
  ];

  const result = fathomSince(syncRuns, now);
  const expectedIso = new Date(oldAt - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result, expectedIso);
});

test('fathomSince ignores seed if verified successful checkpoint exists', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const t1 = Date.parse('2026-10-05T10:00:00.000Z');
  const syncRuns = [
    {kind: 'native_fathom', ok: true, at: t1},
  ];
  const seed = '2026-09-01T00:00:00.000Z';

  const result = fathomSince(syncRuns, now, seed);
  const expectedIso = new Date(t1 - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(result, expectedIso);
  assert.notEqual(result, seed);
});

test('fathomSince leaves input arrays unchanged', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const item1 = {kind: 'native_fathom', ok: true, at: Date.parse('2026-10-05T10:00:00.000Z')};
  const item2 = {kind: 'health', ok: false, at: Date.parse('2026-10-06T10:00:00.000Z')};
  const syncRuns = [item1, item2];
  const originalSnapshot = JSON.stringify(syncRuns);

  fathomSince(syncRuns, now);

  assert.equal(JSON.stringify(syncRuns), originalSnapshot);
  assert.equal(syncRuns.length, 2);
  assert.equal(syncRuns[0], item1);
  assert.equal(syncRuns[1], item2);
});

test('fathomCheckpoint creates native_fathom record with ok true and stable ID', () => {
  const at = Date.parse('2026-10-07T12:00:00.000Z');
  const record1 = fathomCheckpoint(at);
  const record2 = fathomCheckpoint(at);

  assert.equal(record1.ok, true);
  assert.equal(record1.kind, 'native_fathom');
  assert.equal(record1.at, at);
  assert.ok(record1._id, 'Record must include stable _id');
  assert.equal(record1._id, record2._id, 'Identity must be stable for identical epoch');
});

test('fathomCheckpoint rejects invalid timestamps', () => {
  assert.throws(() => fathomCheckpoint(NaN), /finite|epoch|timestamp/i);
  assert.throws(() => fathomCheckpoint('2026-10-07' as unknown as number), /finite|number|epoch/i);
});
