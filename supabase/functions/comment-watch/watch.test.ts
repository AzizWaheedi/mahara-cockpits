import {describe, expect, test} from 'bun:test';
import {cardCommentText} from '../clickup-writeback/requests.ts';
import {CLIENTS_LIST, DOS_DONTS_FIELD, NOTES_MARK} from '../clickup-writeback/rules.ts';
import {
  type Admin, CLICKUP_GAP_MS, type Clock, DatabaseError, DIGEST_LIMIT, digestPrompt, gate, handle, isCurrent, kindOf, liveSources, mergeRules,
  nearDuplicate, type PendingRule, type RecordItem, rotation, RULES_BUDGET_MS, runWatch, SCAN_BUDGET_MS, type Store, supabaseStore,
} from './watch.ts';

// The native comment watch: which comments it reads, what it queues for
// Hermes, how it adds rules to the card (only when COMMENT_WATCH_APPLY is
// exactly "true"), and what it says when something is missing.

const NOW = Date.parse('2026-10-09T12:00:00Z');
const HOUR = 3_600_000;

function virtualClock(): Clock & {t: number} {
  const clock = {t: NOW, now: () => clock.t, sleep: async (ms: number) => {clock.t += ms;}};
  return clock;
}

const OPTIONS = [{id: 'o-active', orderindex: 0, name: 'Active'}, {id: 'o-stopped', orderindex: 1, name: 'Stopped'}];
function card(id: string, name: string, opts: {status?: 'Active' | 'Stopped' | null; rules?: string} = {}) {
  const fields: Record<string, unknown>[] = [{id: DOS_DONTS_FIELD, name: "Do's & Don'ts", value: opts.rules ?? ''}];
  if (opts.status !== null) fields.push({name: 'Client Status', value: opts.status === 'Stopped' ? 1 : 0, type_config: {options: OPTIONS}});
  return {id, name, custom_fields: fields};
}
const cmt = (id: string, text: string, at = NOW - HOUR, by = 'sara') => ({id, comment_text: text, date: String(at), user: {username: by}});
const CALL = 'CALL RECORDING: https://fathom.video/share/abc\nThey want villa owners only and no prices in the ads.';

type WorldOptions = {
  cards?: ReturnType<typeof card>[];
  comments?: Record<string, unknown[]>;
  respond?: (method: string, url: URL, n: number) => Response | undefined;
  env?: Record<string, string>;
};
function world(options: WorldOptions = {}) {
  const clock = virtualClock();
  const cards = options.cards ?? [card('t1', 'Acme Interiors', {rules: 'DO\n- Show finished villas'}), card('t2', 'Old Client', {status: 'Stopped'})];
  const fieldValues = new Map(cards.map(c => [c.id, String(c.custom_fields[0].value)]));
  const calls: {method: string; url: URL; body?: unknown}[] = [];
  const receipts: Record<string, unknown>[] = [];
  const request = (async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : resource);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({method, url, body});
    clock.t += 100;
    const custom = options.respond?.(method, url, calls.length);
    if (custom) return custom;
    const ok = (b: unknown) => new Response(JSON.stringify(b), {status: 200});
    const path = url.pathname.replace('/api/v2/', '');
    if (path === `list/${CLIENTS_LIST}/task`) return ok({tasks: cards.map(c => ({...c, custom_fields: c.custom_fields.map(f => (f.id === DOS_DONTS_FIELD ? {...f, value: fieldValues.get(c.id)} : f))})), last_page: true});
    const comments = /^task\/([^/]+)\/comment$/.exec(path);
    if (comments) return ok({comments: options.comments?.[comments[1]] ?? []});
    const field = /^task\/([^/]+)\/field\/(.+)$/.exec(path);
    if (field && method === 'POST') {
      fieldValues.set(field[1], String(body.value));
      return ok({});
    }
    const task = /^task\/([^/]+)$/.exec(path);
    if (task) return ok({id: task[1], custom_fields: [{id: DOS_DONTS_FIELD, value: fieldValues.get(task[1]) ?? ''}]});
    return new Response('{"err":"not found"}', {status: 404});
  }) as typeof fetch;
  const admin: Admin = {
    rpc: async () => ({data: null, error: {message: 'not used'}}),
    from: (table: string) => {
      expect(table).toBe('cockpit_csm_provider_health');
      return {insert: async (row: Record<string, unknown>) => {receipts.push(row); return {error: null};}};
    },
  };
  const env = {CLICKUP_API_TOKEN: 'pk_123_ABCDEFG', ...options.env};
  const sources = liveSources(name => env[name as keyof typeof env], admin, request);
  return {clock, calls, receipts, sources, fieldValues, env, request, posts: () => calls.filter(c => c.method === 'POST')};
}

function memoryStore(options: {seen?: string[]; pending?: PendingRule[]; busy?: boolean; tick?: Record<string, unknown>; room?: number} = {}) {
  const state = {
    recorded: [] as RecordItem[], results: [] as {id: string; state: string; rules: Record<string, unknown>; added?: number}[],
    finished: undefined as undefined | {ok: boolean; note: string; counts: Record<string, unknown>; planned: Record<string, unknown>[]},
    ticks: 0, mode: '',
  };
  const pending = [...(options.pending ?? [])];
  const store: Store = {
    begin: async mode => (options.busy ? {busy: true} : ((state.mode = mode), {busy: false, run: 7})),
    tick: async () => {
      state.ticks++;
      return options.tick ?? {ok: true, settled: 2, commentsPublished: 2};
    },
    rulesPending: async (includePlanned, limit) => pending.filter(p => p.state === null || (includePlanned && p.state === 'dry_run')).slice(0, limit),
    rulesResult: async (id, st, rules, added) => {
      state.results.push({id, state: st, rules, added});
      const row = pending.find(p => p.commentId === id);
      if (row) row.state = st;
    },
    seen: async ids => new Set(ids.filter(id => (options.seen ?? []).includes(id))),
    record: async items => {
      // The database defers digests beyond its room, as cockpit_comment_watch_record does.
      let room = options.room ?? Number.POSITIVE_INFINITY;
      const kept = items.filter(i => !i.prompt || room-- > 0);
      state.recorded.push(...kept);
      return {recorded: kept.length, queued: kept.filter(i => i.prompt).length, skipped: kept.filter(i => !i.prompt).length, known: 0, deferred: items.length - kept.length};
    },
    finish: async (_run, ok, note, counts, planned) => {
      state.finished = {ok, note, counts, planned};
    },
  };
  return {store, state};
}
const rule = (extra: Partial<PendingRule> = {}): PendingRule => ({
  commentId: 'c1', taskId: 't1', clientName: 'Acme Interiors', kind: 'call', at: NOW - HOUR,
  dos: ['Target villa owners only'], donts: ["Don't show prices in the ads"], state: null, ...extra,
});

describe('the Convex rules, ported', () => {
  test('kindOf reads calls, handoffs, briefs and notes, and skips system and cockpit comments', () => {
    expect(kindOf(CALL, 'sara')).toBe('call');
    expect(kindOf('KICKOFF HANDOFF\nCall recording: Not provided', 'sara')).toBe('kickoff');
    expect(kindOf('Master Client Brief for Acme, the full version', 'sara')).toBe('brief');
    expect(kindOf('The client called and asked us to pause the Riyadh campaign until Sunday.', 'sara')).toBe('note');
    expect(kindOf('ok thanks', 'sara')).toBe('skip');
    expect(kindOf('🎯 Cockpit · CHANGE MADE — budget raised to $40 a day for the villas campaign', 'mb')).toBe('skip');
    expect(kindOf('🤖 Hermes summary of something long enough to count as a note anyway', 'hermes')).toBe('skip');
    expect(kindOf('BILLING_EVENT paid in full for October, nothing else to add here', 'sara')).toBe('skip');
    expect(kindOf(`${NOTES_MARK}:\n- a note that was moved out of the field`, 'sara')).toBe('skip');
    expect(kindOf('A long enough comment written by the automation bot user', 'ClickBot')).toBe('skip');
    expect(kindOf('**CLOSER: Omar, phone 555, the full sales handoff with personal details', 'omar')).toBe('skip');
    expect(kindOf('📊 Client Research Report for Acme with all the background', 'sara')).toBe('skip');
  });

  test('the cockpit\'s own request link comment on a card is never digested, nor any comment with a Cockpit ref', () => {
    // As the requests writer posts it on the client card, from the API user's (the CEO's) account.
    const link = cardCommentText(
      {requesterLabel: 'the CSM', listName: 'Call Center', typeLabel: 'Low schedule rate', ref: 'R-1a2b3c4d5e-call_center'},
      'https://app.clickup.com/t/86new0001',
    );
    expect(link).toStartWith('Cockpit · The CSM asked Call Center: Low schedule rate');
    expect(kindOf(link, 'Abdulaziz Waheedi')).toBe('skip');
    // A focus view comment and the CSM cockpit's older marker.
    expect(kindOf('The CSM wrote in the cockpit: the client wants the villas campaign paused.\n\nCockpit ref T-9f8e7d6c5b', 'Abdulaziz Waheedi')).toBe('skip');
    expect(kindOf('The client asked to move the shoot to Sunday morning instead.\n\nCockpit ref 67f0089f7e-l', 'sara')).toBe('skip');
    // A person who only mentions the cockpit is still read.
    expect(kindOf('Asked in the cockpit for the new script; the client wants it by Thursday.', 'sara')).toBe('note');
  });

  test('a current client has a Client Status that is not stopped and is not a test account', () => {
    expect(isCurrent(card('t1', 'Acme'))).toBe(true);
    expect(isCurrent(card('t2', 'Acme', {status: 'Stopped'}))).toBe(false);
    expect(isCurrent(card('t3', 'Acme', {status: null}))).toBe(false);
    expect(isCurrent(card('t4', 'Playing Account (test)'))).toBe(false);
  });

  test('the digest prompt is the Convex prompt with the comment, its author and the current rules', () => {
    const p = digestPrompt('Acme', 'call', NOW, 'sara', 'x'.repeat(13_000), 'DO\n- Show villas');
    expect(p).toContain('ClickUp card of Mahara Media\'s client "Acme"');
    expect(p).toContain('The comment is a call summary, posted 2026-10-09 by sara:');
    expect(p).toContain('The client\'s current Do\'s & Don\'ts:\nDO\n- Show villas');
    expect(p).toContain('x'.repeat(12_000) + '\n---');
    expect(p).not.toContain('x'.repeat(12_001));
    expect(digestPrompt('Acme', 'note', NOW, '', 'Hello', '')).toContain('a comment someone typed, posted 2026-10-09 by someone');
    expect(digestPrompt('Acme', 'note', NOW, '', 'Hello', '')).toContain('(none yet)');
  });

  test('new rules are tagged with their source, merged in the clean format, and repeats are dropped', () => {
    const plan = mergeRules('DO\n- Show finished villas', {kind: 'call', at: NOW, dos: ['Show finished villas.', 'Target villa owners only.'], donts: ["Don't show prices"]});
    expect(plan.dos).toEqual(['Target villa owners only (Call, 2026-10-09)']);
    expect(plan.merged).toBe("DO\n- Show finished villas\n- Target villa owners only (Call, 2026-10-09)\n\nDON'T\n- Don't show prices (Call, 2026-10-09)");
    expect(plan.added).toBe(2);
    expect(plan.changed).toBe(true);
    expect(mergeRules(plan.merged, {kind: 'call', at: NOW, dos: ['Target villa owners only'], donts: ["Don't show prices"]}).changed).toBe(false);
    expect(nearDuplicate('Never show the prices in any ad', ["Don't show prices in ads (Call, 2026-10-01)"])).toBe(true);
    expect(mergeRules('NOTES\n- Call on Sundays\nDO\n- Show villas', {kind: 'note', at: NOW, dos: ['Use Arabic captions'], donts: []}).notes).toEqual(['Call on Sundays']);
  });

  test('the write gate opens only when COMMENT_WATCH_APPLY is exactly "true"', () => {
    for (const value of [undefined, 'TRUE', ' true', '1', 'yes']) expect(gate(n => (n === 'COMMENT_WATCH_APPLY' ? value : undefined)).mode).toBe('dry_run');
    const limited = gate(n => ({COMMENT_WATCH_APPLY: 'true', COMMENT_WATCH_ONLY_TASKS: ' t1 ,t9'})[n]);
    expect(limited.mode).toBe('apply_limited');
    expect(limited.live('t1')).toBe(true);
    expect(limited.live('t2')).toBe(false);
    expect(gate(n => ({COMMENT_WATCH_APPLY: 'true'})[n]).live('t2')).toBe(true);
  });
});

describe('one run', () => {
  test('with the gate closed it records new comments, plans the rules, and writes nothing to ClickUp', async () => {
    const w = world({comments: {t1: [cmt('c-seen', CALL), cmt('c1', CALL), cmt('c2', 'ok'), cmt('c3', 'An old note that is long enough to be read by Hermes.', NOW - 30 * 86_400_000)], t2: [cmt('c9', CALL)]}});
    const {store, state} = memoryStore({seen: ['c-seen'], pending: [rule()]});
    const result = await runWatch(store, w.sources, gate(n => w.env[n as keyof typeof w.env]), w.clock);
    expect(result.ok).toBe(true);
    expect(state.mode).toBe('dry_run');
    expect(state.ticks).toBe(1);
    // The stopped client's card is never read.
    expect(w.calls.some(c => c.url.pathname.endsWith('task/t2/comment'))).toBe(false);
    expect(state.recorded.map(i => [i.commentId, i.kind, Boolean(i.prompt)])).toEqual([['c3', 'note', false], ['c1', 'call', true], ['c2', 'skip', false]]);
    expect(state.recorded[1]).toMatchObject({taskId: 't1', clientName: 'Acme Interiors', at: String(NOW - HOUR), by: 'sara'});
    expect(state.recorded[1].prompt).toContain('DO\n- Show finished villas');
    expect(w.posts()).toHaveLength(0);
    expect(state.results).toEqual([{id: 'c1', state: 'dry_run', rules: expect.objectContaining({old: 'DO\n- Show finished villas', new: expect.stringContaining("DON'T\n- Don't show prices in the ads (Call, 2026-10-09)")}), added: undefined}]);
    expect(w.fieldValues.get('t1')).toBe('DO\n- Show finished villas');
    expect(state.finished?.note).toContain('nothing written to ClickUp');
    expect(state.finished?.planned[0]).toMatchObject({taskId: 't1', status: 'planned', old: 'DO\n- Show finished villas'});
    // Every ClickUp call left an intent and a response receipt.
    expect(w.receipts.length).toBe(w.calls.length * 2);
    expect(w.receipts.every(r => r.provider === 'clickup')).toBe(true);
  });

  test('with the gate open it writes the merged rules, reads them back and records how many were added', async () => {
    const w = world({env: {COMMENT_WATCH_APPLY: 'true'}});
    const {store, state} = memoryStore({pending: [rule({state: 'dry_run'}), rule({commentId: 'c2', dos: ['Show finished villas'], donts: []})]});
    const result = await runWatch(store, w.sources, gate(n => w.env[n as keyof typeof w.env]), w.clock);
    expect(result.ok).toBe(true);
    expect(w.posts()).toHaveLength(1);
    expect(w.posts()[0].url.pathname).toBe(`/api/v2/task/t1/field/${DOS_DONTS_FIELD}`);
    expect(w.fieldValues.get('t1')).toBe("DO\n- Show finished villas\n- Target villa owners only (Call, 2026-10-09)\n\nDON'T\n- Don't show prices in the ads (Call, 2026-10-09)");
    expect(state.results.map(r => [r.id, r.state, r.added])).toEqual([['c1', 'written', 2], ['c2', 'unchanged', undefined]]);
    expect(state.finished?.note).toContain('1 card got new rules');
  });

  test('a one-card live check writes only that card; others stay planned', async () => {
    const w = world({env: {COMMENT_WATCH_APPLY: 'true', COMMENT_WATCH_ONLY_TASKS: 't9'}});
    const {store, state} = memoryStore({pending: [rule()]});
    await runWatch(store, w.sources, gate(n => w.env[n as keyof typeof w.env]), w.clock);
    expect(state.mode).toBe('apply_limited');
    expect(w.posts()).toHaveLength(0);
    expect(state.results.map(r => r.state)).toEqual(['dry_run']);
  });

  test('rules wait while the field holds notes, and an edit made meanwhile is never overwritten', async () => {
    const notes = world({cards: [card('t1', 'Acme', {rules: 'NOTES\n- Call on Sundays'})], env: {COMMENT_WATCH_APPLY: 'true'}});
    const a = memoryStore({pending: [rule()]});
    await runWatch(a.store, notes.sources, gate(n => notes.env[n as keyof typeof notes.env]), notes.clock);
    expect(notes.posts()).toHaveLength(0);
    expect(a.state.results).toEqual([]);
    expect(a.state.finished?.planned[0]).toMatchObject({status: 'waiting'});

    let reads = 0;
    const busy = world({
      env: {COMMENT_WATCH_APPLY: 'true'},
      respond: (method, url) => {
        if (method !== 'GET' || url.pathname !== '/api/v2/task/t1') return undefined;
        reads++;
        return new Response(JSON.stringify({id: 't1', custom_fields: [{id: DOS_DONTS_FIELD, value: `DO\n- Edit number ${reads}`}]}), {status: 200});
      },
    });
    const b = memoryStore({pending: [rule()]});
    await runWatch(b.store, busy.sources, gate(n => busy.env[n as keyof typeof busy.env]), busy.clock);
    expect(busy.posts()).toHaveLength(0);
    expect(b.state.results).toEqual([]);
    expect(b.state.finished?.counts.rules_retry).toBe(1);
  });

  test('a refused write is recorded as failed; a server error leaves the rules for the next run', async () => {
    for (const [status, expected] of [[400, 'failed'], [502, undefined]] as const) {
      const w = world({env: {COMMENT_WATCH_APPLY: 'true'}, respond: method => (method === 'POST' ? new Response('{"err":"no"}', {status}) : undefined)});
      const {store, state} = memoryStore({pending: [rule()]});
      const result = await runWatch(store, w.sources, gate(n => w.env[n as keyof typeof w.env]), w.clock);
      expect(state.results[0]?.state).toBe(expected);
      expect(result.ok).toBe(expected !== 'failed');
      expect(w.posts()).toHaveLength(1);
    }
  });

  test(`at most ${DIGEST_LIMIT} digests are queued per run; the rest wait unrecorded`, async () => {
    const many = Array.from({length: DIGEST_LIMIT + 5}, (_, i) => cmt(`n${i}`, `A note about the account number ${i} that is long enough to read.`, NOW - HOUR + i));
    const w = world({comments: {t1: many}});
    const {store, state} = memoryStore();
    const result = await runWatch(store, w.sources, gate(() => undefined), w.clock);
    expect(state.recorded.filter(i => i.prompt)).toHaveLength(DIGEST_LIMIT);
    expect(state.recorded.map(i => i.commentId)).not.toContain(`n${DIGEST_LIMIT}`);
    expect(result.counts?.deferred).toBe(5);
    expect(result.note).toContain('5 comments wait for the next run');
  });

  test('digests the database has no room for wait, unrecorded, for the next run', async () => {
    const notes = Array.from({length: 4}, (_, i) => cmt(`r${i}`, `A note about the account number ${i} that is long enough to read.`, NOW - HOUR + i));
    const w = world({comments: {t1: [...notes, cmt('s1', 'ok')]}});
    const {store, state} = memoryStore({room: 2});
    const result = await runWatch(store, w.sources, gate(() => undefined), w.clock);
    expect(state.recorded.map(i => i.commentId).sort()).toEqual(['r0', 'r1', 's1']);
    expect(result.counts).toMatchObject({queued: 2, skipped: 1, deferred: 2});
    expect(result.note).toContain('2 comments wait for the next run');
  });

  test('a busy read is retried, a missing card is reported, and the rest of the cards are read', async () => {
    let first = true;
    const w = world({
      cards: [card('t1', 'Acme'), card('t3', 'Beta')],
      comments: {t3: [cmt('b1', CALL)]},
      respond: (_m, url) => {
        if (url.pathname.endsWith('task/t3/comment') && first) {
          first = false;
          return new Response('{}', {status: 429});
        }
        if (url.pathname.endsWith('task/t1/comment')) return new Response('{"err":"gone"}', {status: 404});
        return undefined;
      },
    });
    const {store, state} = memoryStore();
    const result = await runWatch(store, w.sources, gate(() => undefined), w.clock);
    expect(state.recorded.map(i => i.commentId)).toEqual(['b1']);
    expect(result.counts?.card_errors).toBe(1);
    expect(result.note).toContain('could not be read');
  });

  test('30 calls a minute: 28 current cards on two list pages are read 2 s apart, inside the scan budget', async () => {
    // ClickUp Business allows 100 a minute for the token the VPS shares (docs/requests/CLICKUP-DOWNGRADE.md 1.4).
    expect(CLICKUP_GAP_MS).toBe(2_000);
    const current = Array.from({length: 28}, (_, i) => card(`a${i}`, `Client ${i}`));
    const stopped = Array.from({length: 80}, (_, i) => card(`s${i}`, `Former ${i}`, {status: 'Stopped'}));
    const all = [...current, ...stopped];
    const at: {path: string; t: number}[] = [];
    const w: ReturnType<typeof world> = world({
      cards: all,
      respond: (_m, url) => {
        at.push({path: url.pathname.replace('/api/v2/', ''), t: w.clock.t});
        if (!url.pathname.endsWith(`list/${CLIENTS_LIST}/task`)) return undefined;
        const page = Number(url.searchParams.get('page'));
        const tasks = all.slice(page * 100, page * 100 + 100);
        return new Response(JSON.stringify({tasks, last_page: page === 1}), {status: 200});
      },
    });
    const start = w.clock.t;
    const {store, state} = memoryStore();
    const result = await runWatch(store, w.sources, gate(() => undefined), w.clock);
    expect(result.ok).toBe(true);
    expect(at.filter(c => c.path === `list/${CLIENTS_LIST}/task`).length).toBe(2);
    expect(result.counts).toMatchObject({clients: 28, clients_read: 28, card_errors: 0});
    expect(at.length).toBe(30);
    const gaps = at.slice(1).map((c, i) => c.t - at[i].t);
    expect(gaps.every(g => g === CLICKUP_GAP_MS)).toBe(true);
    expect(at.at(-1)!.t - start).toBeLessThan(SCAN_BUDGET_MS);
    expect(state.finished?.note ?? '').not.toContain('Time ran out');
  });

  test('28 cards and 15 new rules to write: the rules take their share and every card is still read', async () => {
    const current = Array.from({length: 28}, (_, i) => card(`a${String(i).padStart(2, '0')}`, `Client ${i}`));
    const w = world({cards: current, env: {COMMENT_WATCH_APPLY: 'true'}});
    const pending = current.slice(0, 15).map((c, i) => rule({commentId: `r${i}`, taskId: c.id, clientName: c.name}));
    const {store, state} = memoryStore({pending});
    const start = w.clock.t;
    const result = await runWatch(store, w.sources, gate(n => w.env[n as keyof typeof w.env]), w.clock);
    expect(result.counts).toMatchObject({clients: 28, clients_read: 28, card_errors: 0});
    // A written rule is 4 calls, 2 s apart: 3 or 4 fit the rules step's 25 s; the rest wait for the next run.
    const written = Number(result.counts?.rules_written);
    expect(written).toBeGreaterThanOrEqual(3);
    expect(written).toBeLessThanOrEqual(4);
    expect(state.results.filter(r => r.state === 'written').length).toBe(written);
    expect(pending.filter(p => p.state === null).length).toBe(15 - written);
    expect(result.note).toContain(`${15 - written} cards wait for their new rules until the next run, so the comment scan keeps its time.`);
    expect(result.note).not.toContain('Time ran out');
    const firstScan = w.calls.findIndex(c => c.url.pathname.endsWith(`list/${CLIENTS_LIST}/task`));
    expect(firstScan).toBe(written * 4);
    expect(w.clock.t - start).toBeLessThan(SCAN_BUDGET_MS);
    expect(RULES_BUDGET_MS).toBe(25_000);
  });

  test('50 cards: a run that runs out of time names the cards left, and the next run reads them first', async () => {
    const current = Array.from({length: 50}, (_, i) => card(`a${String(i).padStart(2, '0')}`, `Client ${i}`));
    const w = world({cards: current});
    const {store, state} = memoryStore();
    let place: string | null = null;
    const places: (string | null)[] = [];
    const rotating: Store = {
      ...store,
      resumeAfter: async () => place,
      finish: async (run, ok, note, counts, planned) => {
        await store.finish(run, ok, note, counts, planned);
        place = (counts.resume_after as string | null) ?? null;
        places.push(place);
      },
    };
    const reads = () => w.calls.map(c => /task\/([^/]+)\/comment$/.exec(c.url.pathname)?.[1]).filter((id): id is string => Boolean(id));
    const first = await runWatch(rotating, w.sources, gate(() => undefined), w.clock);
    const firstReads = reads();
    expect(firstReads.length).toBeLessThan(50);
    const left = current.map(c => c.id).filter(id => !firstReads.includes(id));
    expect(first.note).toContain(`Time ran out after ${firstReads.length} clients of 50;`);
    const named = left.map(id => `Client ${Number(id.slice(1))}`);
    const list = named.length > 3 ? `${named.slice(0, 3).join(', ')} and ${named.length - 3} more` : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
    expect(left.length).toBeGreaterThan(1);
    expect(first.note).toContain(`Time ran out after ${firstReads.length} clients of 50; ${list} are read first next run.`);
    expect(places[0]).toBe(firstReads.at(-1));
    w.clock.t += 15 * 60_000;
    const before = w.calls.length;
    await runWatch(rotating, w.sources, gate(() => undefined), w.clock);
    const secondReads = reads().slice(firstReads.length);
    // The cards the first run left are the first ones read, and two runs between them read every card.
    expect(secondReads.slice(0, left.length)).toEqual(left);
    expect(new Set([...firstReads, ...secondReads]).size).toBe(50);
    expect(w.calls.length).toBeGreaterThan(before);
    expect(state.finished?.counts.resume_after).toBe(secondReads.at(-1));
  });

  test('a failed save keeps the place, so the same cards are read again next run', async () => {
    const current = Array.from({length: 3}, (_, i) => card(`a${i}`, `Client ${i}`));
    const w = world({cards: current, comments: {a1: [cmt('c1', CALL)]}});
    const {store, state} = memoryStore();
    const failing: Store = {...store, resumeAfter: async () => 'a0', record: async () => {throw new DatabaseError('cockpit_comment_watch_record: down');}};
    const result = await runWatch(failing, w.sources, gate(() => undefined), w.clock);
    expect(result.ok).toBe(false);
    expect(state.finished?.counts.resume_after).toBe('a0');
  });

  test('the card order is fixed by id and starts after the last card read, wrapping round', () => {
    const cards = ['c3', 'a1', 'b2', 'd4'].map(id => ({id}));
    expect(rotation(cards, null).map(c => c.id)).toEqual(['a1', 'b2', 'c3', 'd4']);
    expect(rotation(cards, 'b2').map(c => c.id)).toEqual(['c3', 'd4', 'a1', 'b2']);
    expect(rotation(cards, 'd4').map(c => c.id)).toEqual(['a1', 'b2', 'c3', 'd4']);
    // A card that is no longer current: the next one after it in the order.
    expect(rotation(cards, 'b9').map(c => c.id)).toEqual(['c3', 'd4', 'a1', 'b2']);
  });

  test('the store reads the place from the newest finished run that kept one', async () => {
    const asked: unknown[][] = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const m of ['select', 'not', 'order']) chain[m] = (...args: unknown[]) => (asked.push([m, ...args]), chain);
    chain.limit = async (...args: unknown[]) => (asked.push(['limit', ...args]), {data: [{counts: {resume_after: '86abc12'}}], error: null});
    const admin: Admin = {rpc: async () => ({data: null, error: null}), from: (table: string) => (asked.push(['from', table]), chain)};
    expect(await supabaseStore(admin).resumeAfter!()).toBe('86abc12');
    expect(asked).toEqual([
      ['from', 'cockpit_comment_watch_runs'], ['select', 'counts'], ['not', 'finished_at', 'is', null], ['not', 'counts->>resume_after', 'is', null],
      ['order', 'started_at', {ascending: false}], ['limit', 1],
    ]);
    chain.limit = async () => ({data: [{counts: {resume_after: '../x'}}], error: null});
    expect(await supabaseStore(admin).resumeAfter!()).toBeNull();
  });

  test('a missing ClickUp key is said plainly; the publish step still runs', async () => {
    const w = world({env: {CLICKUP_API_TOKEN: ''}});
    const {store, state} = memoryStore({pending: [rule()]});
    const result = await runWatch(store, w.sources, gate(() => undefined), w.clock);
    expect(result.ok).toBe(false);
    expect(state.ticks).toBe(1);
    expect(w.calls).toHaveLength(0);
    expect(state.finished?.note).toContain('CLICKUP_API_TOKEN is not set');
  });

  test('a run that finds another one open does nothing', async () => {
    const w = world();
    const {store, state} = memoryStore({busy: true});
    expect(await runWatch(store, w.sources, gate(() => undefined), w.clock)).toMatchObject({ok: true, skipped: 'busy'});
    expect(state.ticks).toBe(0);
    expect(w.calls).toHaveLength(0);
  });
});

describe('the HTTP door', () => {
  function door(rpcData: Record<string, unknown> = {}) {
    const names: string[] = [];
    const admin: Admin = {
      rpc: async name => {
        names.push(name);
        return name in rpcData ? {data: rpcData[name], error: null} : {data: null, error: {message: `${name} is not part of this test`}};
      },
      from: () => ({insert: async () => ({error: null}), upsert: async () => ({error: null})}),
    };
    return {admin, names};
  }
  const env = (extra: Record<string, string> = {}) => (n: string) =>
    ({CRON_SECRET: 's3cret', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service', CLICKUP_API_TOKEN: 'pk_1_ABCDEF', ...extra})[n];
  const post = (body: unknown, secret = 's3cret') => new Request('https://fn.invalid/comment-watch', {method: 'POST', headers: {'x-cron-secret': secret}, body: JSON.stringify(body)});

  test('only the cron secret opens it', async () => {
    const {admin} = door();
    expect((await handle(new Request('https://fn.invalid', {method: 'GET'}), env(), () => admin)).status).toBe(405);
    expect((await handle(post({}), env({CRON_SECRET: ''}), () => admin)).status).toBe(503);
    expect((await handle(post({}, 'wrong'), env(), () => admin)).status).toBe(401);
  });

  test('doctor names the keys and reads the database doctor, with no provider call', async () => {
    const {admin, names} = door({cockpit_ai_watch_doctor: {comments: {queued: 0}}});
    let fetched = 0;
    const res = await handle(post({doctor: true}), env({CLICKUP_API_TOKEN: ''}), () => admin, virtualClock(), (async () => {fetched++; return new Response('{}');}) as unknown as typeof fetch);
    const body = await res.json();
    expect(body).toMatchObject({ok: false, keys: {CLICKUP_API_TOKEN: 'missing', CRON_SECRET: 'set'}, mode: 'dry_run', database: {comments: {queued: 0}}});
    expect(JSON.stringify(body)).not.toContain('s3cret');
    expect(names).toEqual(['cockpit_ai_watch_doctor']);
    expect(fetched).toBe(0);
  });

  test('a dry run reads ClickUp and the database, writes neither, and shows what it would do', async () => {
    const {admin, names} = door({
      cockpit_comment_watch_rules_pending: [rule()],
      cockpit_comment_watch_seen: [],
      cockpit_call_brief_enqueue: {ok: true, queued: 0, planned: [{clientName: 'Acme Interiors', calls: 2}]},
      cockpit_ai_watch_doctor: {comments: {done: 1}},
    });
    const w = world({comments: {t1: [cmt('c1', CALL)]}, env: {COMMENT_WATCH_APPLY: 'true'}});
    const res = await handle(post({dryRun: true}), env({COMMENT_WATCH_APPLY: 'true'}), () => admin, w.clock, w.request);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.mode).toBe('dry_run');
    expect(body.preview.newComments).toEqual([{commentId: 'c1', clientName: 'Acme Interiors', kind: 'call', at: new Date(NOW - HOUR).toISOString(), action: 'digest'}]);
    expect(body.preview.callBriefs.planned[0].clientName).toBe('Acme Interiors');
    expect(body.planned[0]).toMatchObject({taskId: 't1', status: 'planned'});
    expect(names.sort()).toEqual(['cockpit_ai_watch_doctor', 'cockpit_call_brief_enqueue', 'cockpit_comment_watch_rules_pending', 'cockpit_comment_watch_seen']);
    expect(w.posts()).toHaveLength(0);
  });
});
