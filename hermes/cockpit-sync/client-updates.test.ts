import {test} from 'node:test';
import assert from 'node:assert/strict';
import {latestUpdates} from './clientUpdates';

// The CSM profiles and creative clients carry a card's newest digests in the
// shape ClientUpdates.tsx reads, never the raw clientComments rows.

const NOW = Date.parse('2026-10-09T12:00:00Z');
const DAY = 86_400_000;
const row = (id: string, at: number, extra: Record<string, unknown> = {}) => ({
  _id: id, taskId: 't1', clientName: 'Acme', commentId: id, at, kind: 'call', status: 'done', by: 'Sara',
  digest: {summary: `Summary ${id}`, nextSteps: ['Mahara: send the script'], clientRequests: [], risks: [], forAds: ['Target villa owners'], forCreative: [], dos: ['Show villas'], donts: []},
  ...extra,
});

test('newest done digests for the card, flattened, three at most', () => {
  const rows = [
    row('a', NOW - 5 * DAY), row('b', NOW - DAY), row('c', NOW - 2 * DAY), row('d', NOW - 3 * DAY),
    row('other-card', NOW, {taskId: 't2'}),
    row('queued', NOW, {status: 'queued', digest: undefined}),
    row('skipped', NOW, {status: 'skipped', kind: 'skip', digest: undefined}),
    row('old', NOW - 61 * DAY),
    row('empty', NOW, {digest: {summary: ' ', nextSteps: [], clientRequests: [], risks: [], forAds: [' '], forCreative: []}}),
  ];
  const updates = latestUpdates(rows, 't1', NOW);
  assert.deepEqual(updates.map(u => u.summary), ['Summary b', 'Summary c', 'Summary d']);
  assert.deepEqual(updates[0], {
    clientName: 'Acme', taskId: 't1', at: NOW - DAY, kind: 'call', summary: 'Summary b',
    nextSteps: ['Mahara: send the script'], clientRequests: [], risks: [], forAds: ['Target villa owners'], forCreative: [],
  });
  assert.equal('dos' in updates[0], false);
});

test('a missing feed or card id gives no updates, never someone else\'s', () => {
  assert.deepEqual(latestUpdates(undefined, 't1', NOW), []);
  assert.deepEqual(latestUpdates([row('a', NOW, {taskId: undefined})], undefined, NOW), []);
  assert.deepEqual(latestUpdates([row('a', Number.NaN)], 't1', NOW), []);
});
