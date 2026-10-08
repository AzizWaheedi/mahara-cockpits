import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { linkCtrTargetNote, scoreCtrAsLinkCtr, type TargetRow, targetItems } from './targets.ts';

// The CEO, 2026-10-08: the CTR on the ads is link CTR, never CTR (all).
// b2b_window_metrics returns both in percent: `ctr` counts every click and
// `ctr_link` only link clicks. October 2026 to the 8th read 3.08 and 1.96.
const WINDOW = { ctr: 3.08, ctr_link: 1.96, spend: 1200, close_rate: 21.3 };
const monthName = (month: string) => ({ '2026-08': 'August 2026', '2026-10': 'October 2026' })[month] ?? month;

test('the ctr target is scored on link CTR, never on CTR (all)', () => {
  const actuals = scoreCtrAsLinkCtr({ ...WINDOW });
  expect(actuals.ctr).toBe(1.96);
  const [ctr] = targetItems([{ metric: 'ctr', projection: 1.8 }], actuals);
  expect(ctr.metric).toBe('ctr');
  expect(ctr.target).toBeCloseTo(0.018, 10);
  expect(ctr.actual).toBeCloseTo(0.0196, 10);
  // A regression to the all-clicks key reads 3.08% and would pass this target.
  expect(ctr.actual).toBeLessThan(0.02);
});

test('without a link CTR the ctr actual is not known, not 0 and not CTR (all)', () => {
  const actuals = scoreCtrAsLinkCtr({ ctr: 3.08, spend: 1200 });
  expect('ctr' in actuals).toBe(false);
  expect(targetItems([{ metric: 'ctr', projection: 1.8 }], actuals)[0].actual).toBeNull();
  const nonFinite = scoreCtrAsLinkCtr({ ctr: 3.08, ctr_link: Number.NaN });
  expect('ctr' in nonFinite).toBe(false);
});

test('rates are fractions, counts and money are not, and a ctr_link target replaces ctr', () => {
  const actuals = scoreCtrAsLinkCtr({ ...WINDOW });
  const items = targetItems(
    [
      { metric: 'close_rate', projection: 25 },
      { metric: 'ctr', projection: 1.8 },
      { metric: 'ctr_link', projection: 1.3 },
      { metric: 'spend', projection: 5000 },
      { metric: 'cost_per_intro', projection: 60 },
    ],
    actuals,
  );
  const expected = [
    { metric: 'close_rate', target: 0.25, actual: 0.213 },
    { metric: 'ctr_link', target: 0.013, actual: 0.0196 },
    { metric: 'spend', target: 5000, actual: 1200 },
    { metric: 'cost_per_intro', target: 60, actual: null },
  ];
  expect(items.map(item => item.metric)).toEqual(expected.map(item => item.metric));
  items.forEach((item, i) => {
    expect(item.target).toBeCloseTo(expected[i].target, 10);
    if (expected[i].actual === null) expect(item.actual).toBeNull();
    else expect(item.actual).toBeCloseTo(expected[i].actual as number, 10);
  });
});

test('a CTR target set before link CTR is named so the CEO can reset it', () => {
  const august: TargetRow[] = [
    { month: '2026-08', metric: 'cac', projection: 500, updatedMs: Date.parse('2026-08-25T12:10:43Z') },
    { month: '2026-08', metric: 'ctr', projection: 1.8, updatedMs: Date.parse('2026-08-25T12:10:43Z') },
  ];
  const note = linkCtrTargetNote(august, monthName);
  expect(note?.level).toBe('warn');
  expect(note?.text).toContain('scored as link CTR');
  expect(note?.text).toContain('Not CTR (all).');
  expect(note?.text).toContain('The August 2026 CTR target, 1.8%');
  expect(note?.text).toContain('Reset it');

  const filedAfter = linkCtrTargetNote(
    [{ month: '2026-10', metric: 'ctr', projection: 1.2, updatedMs: Date.parse('2026-10-09T09:00:00Z') }],
    monthName,
  );
  expect(filedAfter).toEqual({ level: 'info', text: 'CTR targets are scored as link CTR: link clicks divided by impressions. Not CTR (all).' });
  expect(linkCtrTargetNote([august[0]], monthName)).toBeNull();
});

test('an old ctr target filed beside a ctr_link one is not shown, so it is not called out for a reset', () => {
  const rows: TargetRow[] = [
    { month: '2026-08', metric: 'ctr', projection: 1.8, updatedMs: Date.parse('2026-08-25T12:10:43Z') },
    { month: '2026-08', metric: 'ctr_link', projection: 1.2, updatedMs: Date.parse('2026-08-25T12:10:43Z') },
  ];
  // The card shows the ctr_link meter only.
  expect(targetItems(rows, scoreCtrAsLinkCtr({ ...WINDOW })).map(item => item.metric)).toEqual(['ctr_link']);
  const note = linkCtrTargetNote(rows, monthName);
  expect(note).toEqual({ level: 'info', text: 'CTR targets are scored as link CTR: link clicks divided by impressions. Not CTR (all).' });
  // A ctr_link target alone still says how it is scored.
  expect(linkCtrTargetNote([rows[1]], monthName)?.level).toBe('info');
});

test('the money adapter scores its targets through these rules', () => {
  const money = readFileSync(new URL('./adapters/money.ts', import.meta.url), 'utf8');
  expect(money).toContain('scoreCtrAsLinkCtr(actuals);');
  expect(money).toContain('targets.items = targetItems(targetRows, actuals);');
  expect(money).toContain('linkCtrTargetNote(targetRows, monthName)');
  // The rules live in targets.ts only, so a second copy cannot drift back to CTR (all).
  expect(money).not.toContain('PERCENT_METRICS');
});
