import { expect, test } from 'bun:test';
import { kuwaitDay } from '../src/lib/format';

for (const [instant, expected] of [
  ['2026-10-04T20:59:59.999Z', '2026-10-04'],
  ['2026-10-04T21:00:00.000Z', '2026-10-05'],
  ['2026-12-31T21:00:00.000Z', '2027-01-01'],
  ['2028-02-28T21:00:00.000Z', '2028-02-29'],
]) {
  test(`EOD filing day for ${instant} follows Kuwait midnight`, () => {
    expect(kuwaitDay(new Date(instant))).toBe(expected);
  });
}
