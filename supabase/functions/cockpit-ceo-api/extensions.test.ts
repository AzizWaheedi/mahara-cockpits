import { expect, test } from 'bun:test';
import { applyExtensions, type ExtensionDeps, fieldIdFrom, grantSentence, grantsFromView, RETIRED } from './extensions.ts';

/** cockpit_extensions_v rows as the view returns them (WAVE12-CONTRACT 3.2). */
const row = (over: Record<string, unknown> = {}) => ({
  grant_id: 115,
  clickup_task_id: '86ewvnqj5',
  client_name: 'Liwan Limited',
  granted_on: '2026-10-19',
  weeks: 2,
  from_date: '2026-10-19',
  until: '2026-11-02',
  state: 'ended',
  seat_role: null,
  ...over,
});

test('view rows become grants by card id, oldest first, with the seat role and no typed-name guess', () => {
  const grants = grantsFromView([
    row({ grant_id: 301, clickup_task_id: '86eyurepc', client_name: 'Ardon', granted_on: '2026-11-03', until: '2026-12-11', state: 'live', seat_role: 'csm', from_date: '2026-11-27' }),
    row(),
  ]);
  expect(grants.map(g => g.grantId)).toEqual([115, 301]);
  expect(grants[0]).toEqual({ grantId: 115, taskId: '86ewvnqj5', client: 'Liwan Limited', grantedOn: '2026-10-19', weeks: 2, from: '2026-10-19', until: '2026-11-02', state: 'ended', seatRole: null });
  expect(grants[1]).toMatchObject({ taskId: '86eyurepc', state: 'live', seatRole: 'csm', from: '2026-11-27' });
});

test('a row without its card, days, weeks of 1, 2 or 4, or a known state is refused, never read as no extension', () => {
  for (const bad of [
    row({ clickup_task_id: '' }),
    row({ until: null }),
    row({ granted_on: 'soon' }),
    row({ weeks: 3 }),
    row({ state: 'cleared' }),
    row({ grant_id: 'x' }),
    'not a row',
  ])
    expect(() => grantsFromView([bad])).toThrow(/extension grant/);
});

test('one sentence per grant: running, ended, replaced', () => {
  const [ended, live, replaced] = grantsFromView([
    row(),
    row({ grant_id: 301, granted_on: '2026-11-03', until: '2026-12-11', state: 'live', weeks: 1 }),
    row({ grant_id: 302, granted_on: '2026-11-04', until: '2026-11-18', state: 'replaced' }),
  ]);
  expect(grantSentence(ended, '2026-11-10')).toBe('Liwan Limited: 2 weeks, given 19 Oct, ended 2 Nov.');
  expect(grantSentence(live, '2026-11-10')).toBe('Liwan Limited: 1 week, given 3 Nov, runs to 11 Dec.');
  expect(grantSentence(replaced, '2026-11-10')).toBe('Liwan Limited: 2 weeks, given 4 Nov, replaced by a longer one.');
});

test('the field is the override, else the list field of that name, else missing', () => {
  expect(fieldIdFrom(' abc-1 ', null)).toBe('abc-1');
  expect(fieldIdFrom(undefined, { fields: [{ id: 'f9', name: ' current extension (weeks) ' }] })).toBe('f9');
  expect(fieldIdFrom(undefined, { fields: [{ id: 'f9', name: 'Other' }] })).toBeNull();
});

/** Deps whose form, field and write members fail the test if the retired pass ever touches them. */
function deps(overrides: Partial<ExtensionDeps> = {}) {
  const touched: string[] = [];
  const trap = (name: string) => async () => { touched.push(name); throw Error(`${name} must not be called`); };
  const base: ExtensionDeps = {
    fieldId: trap('fieldId'),
    readForm: trap('readForm'),
    cards: trap('cards'),
    lastWritten: trap('lastWritten'),
    write: trap('write'),
    record: trap('record'),
    today: () => '2026-11-10',
    ...overrides,
  };
  return { deps: base, touched };
}

test('retired: the button and the hourly pass write nothing to ClickUp, in every mode, and say so', async () => {
  for (const mode of [{ force: true, apply: true }, { force: false, apply: true }, { force: false, apply: false }]) {
    const { deps: d, touched } = deps();
    const out = await applyExtensions(d, mode);
    expect(touched).toEqual([]);
    expect(out).toEqual({ written: 0, cleared: 0, skipped: 0, errors: [], retired: true, ok: true, live: null, note: RETIRED });
  }
  expect(RETIRED).toBe('Retired: the billing sheet writes the extension field.');
});

test('with the view wired, it counts the grants running today from cockpit_extensions_v and still writes nothing', async () => {
  const { deps: d, touched } = deps({
    liveGrants: async () => [
      row(),
      row({ grant_id: 301, clickup_task_id: '86eyurepc', client_name: 'Ardon', granted_on: '2026-11-03', until: '2026-12-11', state: 'live' }),
    ],
  });
  const out = await applyExtensions(d, { force: true, apply: true });
  expect(touched).toEqual([]);
  expect(out).toMatchObject({ ok: true, retired: true, written: 0, live: 1 });
  expect(out.note).toBe(`${RETIRED} 1 grant runs today: Ardon: 2 weeks, given 3 Nov, runs to 11 Dec.`);
  const none = await applyExtensions(deps({ liveGrants: async () => [row()] }).deps, { force: false, apply: false });
  expect(none.note).toBe(`${RETIRED} No grant runs today.`);
});

test('an unreadable view is a failed read with its reason, not zero grants', async () => {
  const out = await applyExtensions(deps({ liveGrants: async () => { throw Error('relation "cockpit_extensions_v" does not exist'); } }).deps, { force: true, apply: true });
  expect(out).toMatchObject({ ok: false, live: null, written: 0 });
  expect(out.note).toContain('could not be read from cockpit_extensions_v');
});
