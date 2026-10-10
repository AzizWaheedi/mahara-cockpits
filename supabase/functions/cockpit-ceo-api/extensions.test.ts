import { expect, test } from 'bun:test';
import {
  applyExtensions, type Card, type ExtensionDeps, FIELD_ASK, fieldIdFrom, type FieldWrite, matchCard,
  parseExtensionResponses, planWrites, writeSentence,
} from './extensions.ts';

const CLIENT_REF = '5145ff0c-009b-4f51-b3a9-4651efc908be';
const DURATION_REF = '278c2f80-88bd-428e-b330-8c6b3175d63f';
const response = (id: string, at: string, client: string, label: string, shape: 'text' | 'choice' = 'text') => ({
  response_id: id,
  submitted_at: at,
  answers: [
    { field: { ref: CLIENT_REF }, type: 'text', text: client },
    shape === 'text' ? { field: { ref: DURATION_REF }, type: 'text', text: label } : { field: { ref: DURATION_REF }, type: 'choice', choice: { label } },
  ],
});

test('form responses become grants dated in Kuwait, with either duration shape, and junk is skipped', () => {
  const grants = parseExtensionResponses([
    response('b', '2026-10-02T22:30:00Z', 'Nahda Clinics', '2 WEEKS', 'choice'),
    response('a', '2026-10-01T08:00:00Z', ' Bloom Dental ', '1 week'),
    response('c', '2026-10-03T08:00:00Z', 'Nobody', '3 WEEKS'),
    response('d', 'not a date', 'Bloom Dental', '1 WEEK'),
    { answers: 'broken' },
  ]);
  expect(grants.map(g => g.id)).toEqual(['a', 'b']);
  expect(grants[0]).toMatchObject({ client: 'Bloom Dental', weeks: 1, day: '2026-10-01', until: '2026-10-08' });
  // 22:30 UTC is already the next day in Kuwait.
  expect(grants[1]).toMatchObject({ weeks: 2, day: '2026-10-03', until: '2026-10-17' });
});

test('a typed client matches the exact card first, then the longest, never under four letters', () => {
  const cards: Card[] = [{ taskId: '1', name: 'Nahda' }, { taskId: '2', name: 'Nahda Clinics' }, { taskId: '3', name: 'Bloom' }];
  expect(matchCard('Nahda Clinics', cards)?.taskId).toBe('2');
  expect(matchCard('nahda', cards)?.taskId).toBe('1');
  expect(matchCard('Blo', cards)).toBeNull();
});

test('writes cover every named card: live weeks, 0 once ended, gone and internal cards left alone', () => {
  const grants = parseExtensionResponses([
    response('1', '2026-09-01T08:00:00Z', 'Bloom Dental', '1 WEEK'),
    response('2', '2026-10-05T08:00:00Z', 'Nahda Clinics', '4 WEEKS'),
    response('3', '2026-10-05T08:00:00Z', 'Old Client', '2 WEEKS'),
    response('4', '2026-10-05T08:00:00Z', 'Playing Account', '2 WEEKS'),
  ]);
  const cards: Card[] = [
    { taskId: 'b', name: 'Bloom Dental', stage: 'Active' },
    { taskId: 'n', name: 'Nahda Clinics', stage: 'Active' },
    { taskId: 'o', name: 'Old Client', stage: 'Stopped' },
    { taskId: 'p', name: 'Playing Account', stage: 'Active' },
  ];
  const { writes, skipped } = planWrites(grants, cards, '2026-10-09');
  expect(skipped).toBe(1);
  expect(writes.map(w => [w.taskId, w.weeks])).toEqual([['b', 0], ['n', 4]]);
  expect(writeSentence(writes[1])).toBe("Set Nahda Clinics's current extension to 4 weeks on ClickUp: granted 5 Oct on the Client Extension Form, cover to 2 Nov.");
  expect(writeSentence(writes[0])).toContain('Cleared Bloom Dental');
});

test('the field is the override, else the list field of that name, else missing', () => {
  expect(fieldIdFrom(' abc-1 ', null)).toBe('abc-1');
  expect(fieldIdFrom(undefined, { fields: [{ id: 'f9', name: ' current extension (weeks) ' }] })).toBe('f9');
  expect(fieldIdFrom(undefined, { fields: [{ id: 'f9', name: 'Other' }] })).toBeNull();
});

function deps(overrides: Partial<ExtensionDeps> = {}) {
  const log: string[] = [];
  const recorded: { write: FieldWrite; what: string }[] = [];
  const base: ExtensionDeps = {
    fieldId: async () => 'field-1',
    readForm: async () => [
      response('1', '2026-10-05T08:00:00Z', 'Nahda Clinics', '4 WEEKS'),
      response('2', '2026-10-06T08:00:00Z', 'Bloom Dental', '1 WEEK'),
    ],
    cards: async () => [{ taskId: 'n', name: 'Nahda Clinics', stage: 'Active' }, { taskId: 'b', name: 'Bloom Dental', stage: 'Active' }],
    lastWritten: async () => ({ n: 4 }),
    write: async (taskId, fieldId, weeks) => { log.push(`${taskId}:${fieldId}:${weeks}`); },
    record: async (write, _fieldId, what) => { recorded.push({ write, what }); },
    today: () => '2026-10-09',
    ...overrides,
  };
  return { deps: base, log, recorded };
}

test('the button writes every card and records each confirmed write', async () => {
  const { deps: d, log, recorded } = deps();
  const result = await applyExtensions(d, { force: true, apply: true });
  expect(log).toEqual(['b:field-1:1', 'n:field-1:4']);
  expect(recorded.length).toBe(2);
  expect(result).toMatchObject({ written: 2, cleared: 0, skipped: 0, errors: [], ok: true });
});

test('the automatic pass sends only changed values and stays a dry run without the apply flag', async () => {
  const dry = deps();
  const preview = await applyExtensions(dry.deps, { force: false, apply: false });
  expect(dry.log).toEqual([]);
  expect(dry.recorded).toEqual([]);
  expect(preview).toMatchObject({ dryRun: true, planned: 1, written: 0, ok: true });
  expect(preview.note).toContain('CEO_EXTENSIONS_APPLY');
  const live = deps();
  const result = await applyExtensions(live.deps, { force: false, apply: true });
  expect(live.log).toEqual(['b:field-1:1']);
  expect(result.written).toBe(1);
});

test('a missing field, an unreadable form or stale cards write nothing and say why', async () => {
  const noField = deps({ fieldId: async () => null });
  expect(await applyExtensions(noField.deps, { force: true, apply: true })).toMatchObject({ ok: false, note: FIELD_ASK, written: 0 });
  const clickupDown = deps({ fieldId: async () => { throw Error('ClickUp could not be reached.'); } });
  expect((await applyExtensions(clickupDown.deps, { force: true, apply: true })).note).toContain('could not be read on ClickUp');
  const formDown = deps({ readForm: async () => { throw Error('Typeform refused the read (401).'); } });
  const formResult = await applyExtensions(formDown.deps, { force: true, apply: true });
  expect(formResult.note).toContain('Typeform refused the read (401)');
  expect(formDown.log).toEqual([]);
  const stale = deps({ cards: async () => { throw Error('the client billing snapshot is more than 24 hours old'); } });
  expect((await applyExtensions(stale.deps, { force: true, apply: true })).note).toContain('more than 24 hours old');
  expect(stale.log).toEqual([]);
});

test('a failed ClickUp write is reported per card; a missing audit row stops further writes', async () => {
  const oneFails = deps({ write: async taskId => { if (taskId === 'b') throw Error('ClickUp refused the request (403).'); } });
  const partial = await applyExtensions(oneFails.deps, { force: true, apply: true });
  expect(partial.errors).toEqual(['Bloom Dental: ClickUp refused the request (403).']);
  expect(partial).toMatchObject({ written: 1, ok: false });
  const auditDown = deps({ record: async () => { throw Error('the audit row was not confirmed'); } });
  const stopped = await applyExtensions(auditDown.deps, { force: true, apply: true });
  expect(auditDown.log).toEqual(['b:field-1:1']);
  expect(stopped.errors[0]).toContain('remaining cards were not written');
  expect(stopped.written).toBe(0);
});
