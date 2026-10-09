import { expect, test } from 'bun:test';
import { loadOptionalWinners } from '../src/lib/optionalWinners';

test('an ownership error makes winners unavailable without throwing or fabricating a list', async () => {
  const outcome = await loadOptionalWinners(async () => { throw new Error('Winner ownership mapping is missing or ambiguous.'); });
  expect(outcome).toEqual({ status: 'unavailable' });
});

test('a valid winners result is passed through unchanged', async () => {
  const rows = { sameLine: [{ _id: 'ad-one' }], rest: [] };
  expect(await loadOptionalWinners(async () => rows)).toEqual({ status: 'ready', rows });
});
