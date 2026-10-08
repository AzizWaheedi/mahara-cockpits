import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financePublication } from './worker.ts';

test('a non-finance refresh omits finance rather than sending JSON null', () => {
  assert.equal(JSON.stringify({ finance: financePublication(null, null, null) }), '{}');
});

test('a failed finance job omits output but keeps its actionable error', () => {
  assert.deepEqual(financePublication('job-1', null, 'bank statement missing'), { id: 'job-1', error: 'bank statement missing' });
});

test('a confirmed finance job includes its output', () => {
  const output = { sections: [{key:'money'}, {key:'expenses'}], payments: [] };
  assert.deepEqual(financePublication('job-2', output, null), { id: 'job-2', output });
});
