import {test} from 'node:test';
import assert from 'node:assert/strict';
import {type Reads, withNativeContext} from './runtime';
import {performanceSnapshot} from './csmProducer';

test('retained performance treats a zero timestamp as unknown', async () => {
 const result=await performanceSnapshot('Stopped',undefined,{performance:{sheetId:'fixture-sheet'},syncedAt:0},'2026-10-07',Date.parse('2026-10-07T12:00:00Z'));
 assert.equal(result.performanceSyncedAt,undefined);
});

test('repeated retained history never borrows the current profile refresh date', async () => {
 const now=Date.parse('2026-10-07T12:00:00Z');
 const result=await performanceSnapshot('Stopped',undefined,{performance:{sheetId:'fixture-sheet'},performanceRetained:true,syncedAt:now},'2026-10-07',now);
 assert.equal(result.performanceSyncedAt,undefined);
 const missing=await performanceSnapshot('Stopped',undefined,{syncedAt:now},'2026-10-07',now);
 assert.equal(missing.performanceSyncedAt,undefined);
});

test('performanceSnapshot export exists', () => {
  assert.equal(typeof performanceSnapshot, 'function');
});

test('stopped/offboard/cancelled stages retain exact old performance and timestamps without reading sheets', async () => {
  const oldPerformance = {
    sheetId: 'archived-sheet-id',
    source: 'Appointments tab',
    monthLabel: 'Sep 26',
    lastMonthLabel: 'Aug 26',
    month: {upcoming: 0, noshows: 0, unknownOutcome: 0},
    lastMonth: {upcoming: 0, noshows: 0, unknownOutcome: 0},
    allTime: {upcoming: 0, noshows: 0, unknownOutcome: 0},
    undated: 0,
    stale: [],
    staleCount: 0,
    byAd: {},
    byAdAllTime: {},
    recent: [],
    creativeStats: {tab: 'Sep 26', booked: 10, due: 8, shows: 6, quotes: 3, closes: 1},
    appointments: [],
  };

  const oldProfileWithPerformanceSyncedAt = {
    performance: oldPerformance,
    performanceSyncedAt: 1720000000000,
    syncedAt: 1720000050000,
  };

  let readCount = 0;
  const noReadsContext: Reads = {
    async tool() {
      readCount++;
      throw new Error('No sheet read allowed for lost clients');
    },
    async graph() {
      throw new Error('No Meta read expected');
    },
    async fetch() {
      throw new Error('No raw HTTP read expected');
    },
    log() {},
  };

  const today = '2026-10-07';
  const now = 1729999999999;
  const sheetLink = 'https://docs.google.com/spreadsheets/d/archived-sheet-id/edit';

  const stoppedResult = await withNativeContext(noReadsContext, {receipts: []}, () =>
    performanceSnapshot('Stopped', sheetLink, oldProfileWithPerformanceSyncedAt, today, now)
  );

  assert.equal(readCount, 0);
  assert.deepEqual(stoppedResult.performance, oldPerformance);
  assert.equal(stoppedResult.performanceSyncedAt, 1720000000000);
  assert.equal(stoppedResult.performanceRetained, true);

  const oldProfileWithLegacySyncedAtOnly = {
    performance: oldPerformance,
    syncedAt: 1715000000000,
  };

  const offboardResult = await withNativeContext(noReadsContext, {receipts: []}, () =>
    performanceSnapshot('Offboarded', sheetLink, oldProfileWithLegacySyncedAtOnly, today, now)
  );

  assert.equal(readCount, 0);
  assert.deepEqual(offboardResult.performance, oldPerformance);
  assert.equal(offboardResult.performanceSyncedAt, 1715000000000);
  assert.equal(offboardResult.performanceRetained, true);

  const cancelledResult = await withNativeContext(noReadsContext, {receipts: []}, () =>
    performanceSnapshot('Cancelled', sheetLink, oldProfileWithLegacySyncedAtOnly, today, now)
  );

  assert.equal(readCount, 0);
  assert.deepEqual(cancelledResult.performance, oldPerformance);
  assert.equal(cancelledResult.performanceSyncedAt, 1715000000000);
  assert.equal(cancelledResult.performanceRetained, true);
});

test('stopped stage preserves missing values when no old performance or timestamp exists', async () => {
  let readCount = 0;
  const noReadsContext: Reads = {
    async tool() {
      readCount++;
      throw new Error('No sheet read allowed for lost clients');
    },
    async graph() {
      throw new Error('No Meta read expected');
    },
    async fetch() {
      throw new Error('No raw HTTP read expected');
    },
    log() {},
  };

  const today = '2026-10-07';
  const now = 1729999999999;
  const sheetLink = 'https://docs.google.com/spreadsheets/d/archived-sheet-id/edit';

  const resultNoOldProfile = await withNativeContext(noReadsContext, {receipts: []}, () =>
    performanceSnapshot('Stopped', sheetLink, undefined, today, now)
  );

  assert.equal(readCount, 0);
  assert.equal(resultNoOldProfile.performance, undefined);
  assert.equal(resultNoOldProfile.performanceSyncedAt, undefined);
  assert.equal(resultNoOldProfile.performanceRetained, true);

  const resultEmptyProfile = await withNativeContext(noReadsContext, {receipts: []}, () =>
    performanceSnapshot('Stopped', sheetLink, {}, today, now)
  );

  assert.equal(readCount, 0);
  assert.equal(resultEmptyProfile.performance, undefined);
  assert.equal(resultEmptyProfile.performanceSyncedAt, undefined);
  assert.equal(resultEmptyProfile.performanceRetained, true);
});

test('active and paused clients perform authoritative sheet reads and update performanceSyncedAt to now', async () => {
  const activePast = Array<string>(16).fill('');
  Object.assign(activePast, {0: 'Active lead', 1: '10/1/2026', 2: '10/2/2026', 9: 'Yes', 10: 'Yes'});

  let activeRequests = 0;
  const activeReadsContext: Reads = {
    async tool() {
      activeRequests++;
      return {
        valueRanges: [
          {range: 'Appointments!A1:P600', values: [activePast]},
          {range: 'Oct 26!A1:P600', values: [[], [], activePast]},
          {range: 'Sep 26!A1:P600', values: []},
        ],
      };
    },
    async graph() {
      throw new Error('No Meta read expected');
    },
    async fetch() {
      throw new Error('No raw HTTP read expected');
    },
    log() {},
  };

  const today = '2026-10-07';
  const now = 1729999999999;
  const sheetLink = 'https://docs.google.com/spreadsheets/d/active-sheet-id/edit';

  const activeResult = await withNativeContext(activeReadsContext, {receipts: []}, () =>
    performanceSnapshot('Active', sheetLink, undefined, today, now)
  );

  assert.equal(activeRequests, 1);
  assert.equal(activeResult.performance?.sheetId, 'active-sheet-id');
  assert.equal(activeResult.performanceSyncedAt, now);
  assert.equal(activeResult.performanceRetained, false);

  let pausedRequests = 0;
  const pausedReadsContext: Reads = {
    async tool() {
      pausedRequests++;
      return {
        valueRanges: [
          {range: 'Appointments!A1:P600', values: [activePast]},
          {range: 'Oct 26!A1:P600', values: [[], [], activePast]},
          {range: 'Sep 26!A1:P600', values: []},
        ],
      };
    },
    async graph() {
      throw new Error('No Meta read expected');
    },
    async fetch() {
      throw new Error('No raw HTTP read expected');
    },
    log() {},
  };

  const pausedResult = await withNativeContext(pausedReadsContext, {receipts: []}, () =>
    performanceSnapshot('Paused', sheetLink, undefined, today, now)
  );

  assert.equal(pausedRequests, 1);
  assert.equal(pausedResult.performance?.sheetId, 'active-sheet-id');
  assert.equal(pausedResult.performanceSyncedAt, now);
  assert.equal(pausedResult.performanceRetained, false);
});

test('active and paused clients fail closed on 403 or 404 sheet read errors without swallowing', async () => {
  const forbiddenReadsContext: Reads = {
    async tool() {
      throw new Error('Google Sheets API 403 Forbidden: Caller does not have permission');
    },
    async graph() {
      throw new Error('No Meta read expected');
    },
    async fetch() {
      throw new Error('No raw HTTP read expected');
    },
    log() {},
  };

  const today = '2026-10-07';
  const now = 1729999999999;
  const sheetLink = 'https://docs.google.com/spreadsheets/d/forbidden-sheet-id/edit';

  await assert.rejects(
    async () => {
      await withNativeContext(forbiddenReadsContext, {receipts: []}, () =>
        performanceSnapshot('Active', sheetLink, undefined, today, now)
      );
    },
    /403 Forbidden/
  );

  const notFoundReadsContext: Reads = {
    async tool() {
      throw new Error('Google Sheets API 404 Not Found: Requested entity was not found');
    },
    async graph() {
      throw new Error('No Meta read expected');
    },
    async fetch() {
      throw new Error('No raw HTTP read expected');
    },
    log() {},
  };

  await assert.rejects(
    async () => {
      await withNativeContext(notFoundReadsContext, {receipts: []}, () =>
        performanceSnapshot('Paused', sheetLink, undefined, today, now)
      );
    },
    /404 Not Found/
  );
});
