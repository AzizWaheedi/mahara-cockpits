// comment-watch: the client comment watch, native.
//
// Replaces the media Convex jobs commentWatch.scan and commentWatch.apply
// (apps/media-buyer-cockpit/convex/commentWatch.ts), which stopped with the
// Convex pause on 2026-10-07. pg_cron posts here at minute 7, 22, 37 and 52
// (migration 20261009i). One run:
//
// 1. opens a run row (cockpit_comment_watch_begin; busy if one is open);
// 2. runs the tick (cockpit_ai_watch_tick): Hermes answers into the ledger,
//    new call sets into call_brief jobs, digests and briefs into the feeds;
// 3. adds each new digest's rules to the client card's Do's & Don'ts field.
//    Nothing is written to ClickUp unless COMMENT_WATCH_APPLY is exactly
//    "true"; otherwise the planned write (old value, new value) is kept on the
//    ledger row and on the run. COMMENT_WATCH_ONLY_TASKS (comma-separated
//    task ids) narrows a live run to those cards for a one-card check;
// 4. reads the comments on every current client card (Clients - Mahara) and
//    records the new ones (cockpit_comment_watch_record). Each one worth
//    reading becomes a comment_digest job for Hermes, once per comment id;
// 5. closes the run with its counts and a plain note, and records its
//    freshness in cockpit_sync_state under 'comment-watch'.
//
// Every ClickUp call goes through cockpit-csm-api/tools.ts, so it lands in
// cockpit_csm_provider_health. Calls are spaced under ClickUp's 100 a minute
// per token; reads are retried on a 429 or a 5xx while time allows.

import {cleanDosDonts, CLIENTS_LIST, DOS_DONTS_FIELD, NOTES_MARK} from '../clickup-writeback/rules.ts';
import {providerTools, type Provider} from '../cockpit-csm-api/tools.ts';

// biome-ignore lint/suspicious/noExplicitAny: ClickUp bodies are untyped
type Any = any;
export type Row = Record<string, unknown>;

/** Statuses that mean the client is not current (convex/commentWatch.ts). */
export const NOT_CURRENT = ['stopped', 'sales team to contact'];
/** A comment older than this when first seen is recorded, never digested (the SQL enforces it too). */
export const BACKFILL_DAYS = 21;
/**
 * Prompts built per run. The database queues at most 5 open background jobs
 * (cockpit_ai_watch_room); what does not fit waits, unrecorded, for the next run.
 */
export const DIGEST_LIMIT = 10;
/** Digests whose rules are checked against their card per run. */
export const RULES_LIMIT = 15;
/** About 86 ClickUp calls a minute; ClickUp allows 100 per token. */
export const CLICKUP_GAP_MS = 700;
/** No new card is read after this. */
export const SCAN_BUDGET_MS = 95_000;
/** No call or retry starts after this (the Edge Function stops at 150 s). */
export const HARD_MS = 120_000;
/** Convex read at most ten pages of Clients - Mahara. */
export const MAX_PAGES = 10;
const RETRY_WAITS = [5_000, 15_000];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Clock = {now: () => number; sleep: (ms: number) => Promise<void>};
export const systemClock: Clock = {now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms))};

export class OutOfTime extends Error {
  constructor() {
    super('The comment watch ran out of time.');
  }
}
/** A failure already said in plain words. */
class Plain extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const redact = (s: string) =>
  s.replace(/\b(?:pk|sk)_[A-Za-z0-9_]{4,}/g, '[key]').replace(/\beyJ[A-Za-z0-9_.-]{10,}/g, '[key]').replace(/\s+/g, ' ').trim().slice(0, 300);

// --- The Convex rules, ported -------------------------------------------------------

/** What a comment is, from its text and author. "skip" is never digested. */
export function kindOf(text: string, by: string): string {
  const t = text.trim();
  if (!t || t.startsWith(NOTES_MARK) || /clickbot/i.test(by)) return 'skip';
  if (/^(BILLING_|🎯|🤖)/u.test(t) || /Logged by the CSM via the Client Success Cockpit/i.test(t)) return 'skip';
  if (/^\**\s*CLOSER\s*:?/i.test(t)) return 'skip';
  if (/^\W*(Client Research Report|Market Intelligence Report)/i.test(t)) return 'skip';
  // Handoffs carry a "Call recording: Not provided" line, so they are matched before calls.
  if (/KICKOFF HANDOFF|Kickoff form|Onboarding Form Answers/i.test(t)) return 'kickoff';
  if (/^\W*CALL RECORDING|fathom\.video\/share|To-?Do List|Next Steps from/i.test(t)) return 'call';
  if (/Master Client Brief/i.test(t)) return 'brief';
  return t.length >= 40 ? 'note' : 'skip';
}

export function statusOf(t: Any): string {
  const cf = (t?.custom_fields ?? []).find((f: Any) => f.name === 'Client Status');
  if (cf?.value === undefined || cf?.value === null) return '';
  const opts: Any[] = cf.type_config?.options ?? [];
  const hit = opts.find(o => o.id === cf.value || o.orderindex === cf.value);
  return String(hit?.name ?? '');
}

/** A current client: a Client Status that is not stopped, and not a test account. */
export function isCurrent(t: Any): boolean {
  const status = statusOf(t).trim().toLowerCase();
  return Boolean(status) && !NOT_CURRENT.includes(status) && !/playing account/i.test(String(t?.name ?? ''));
}

export function fieldValue(t: Any): string {
  const cf = (t?.custom_fields ?? []).find((f: Any) => f.id === DOS_DONTS_FIELD);
  return typeof cf?.value === 'string' ? cf.value : '';
}

const KIND_LABEL: Record<string, string> = {
  call: 'a call summary',
  kickoff: 'a kickoff handoff or onboarding form',
  brief: 'a client brief',
  note: 'a comment someone typed',
};

/** The Convex digest prompt (commentWatch.ts digestPrompt), word for word. */
export function digestPrompt(client: string, kind: string, at: number, by: string, text: string, current: string): string {
  return `You are reading one comment from the ClickUp card of Mahara Media's client "${client}". Mahara runs Meta lead-generation ads for construction, architecture, interior design and contracting firms in the Gulf. The team is a media buyer (Meta campaigns), a creative director (scripts and videos) and a client success manager.

The comment is ${KIND_LABEL[kind] ?? 'a comment'}, posted ${new Date(at).toISOString().slice(0, 10)} by ${by || 'someone'}:
---
${text.slice(0, 12000)}
---

The client's current Do's & Don'ts:
${current || '(none yet)'}

Return JSON matching the schema:
- summary: 1 to 3 plain sentences on what this comment says happened or was agreed. Empty string if nothing useful.
- nextSteps: short lines, each starting with who owns it, "Mahara:" or "Client:".
- clientRequests: what the client explicitly asked for.
- risks: anything that threatens the account (unhappy client, payment, lead quality, delays).
- forAds: what the media buyer should act on (targeting, ad budget, platforms, offer, lead forms, lead quality). Never contract value, payment status, Mahara's fees or the client's revenue.
- forCreative: what the creative director should act on (scripts, videos, footage, approvals, brand look). Never contract value, payment status, Mahara's fees or the client's revenue.
- dos and donts: rules for how Mahara markets this client: who to target or exclude, what to say or never say, what to promise or not, how the ads and videos should look, how to handle their leads. Each one must be stated in the comment itself, lasting, and not already covered by the current Do's & Don'ts. Never payment or contract terms, setup tasks, one-off to-dos, or anything you inferred. Short imperative lines, don'ts start with "Don't", no source in the text. When in doubt, leave it out.

Rules: use only what the comment says, never guess or fill gaps. Nothing about other clients. No phone numbers, emails, or names of leads. Plain English, no em dashes. Empty arrays when there is nothing.`;
}

const STOP = new Set('the and for with not are but from that this their them they into than any all only each per its our who what when how'.split(' '));
function words(rule: string): Set<string> {
  return new Set(
    rule
      .replace(/\([^)]*\)\s*$/, '')
      .toLowerCase()
      .replace(/don't|do not|never/g, '')
      .split(/[^a-z0-9؀-ۿ]+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
}
/** A new rule that mostly repeats an existing line (most of its words already there) is dropped. */
export function nearDuplicate(rule: string, existing: string[]): boolean {
  const a = words(rule);
  if (!a.size) return true;
  return existing.some(line => {
    const b = words(line);
    if (!b.size) return false;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / Math.min(a.size, b.size) >= 0.7;
  });
}

export type PendingRule = {commentId: string; taskId: string; clientName: string; kind: string; at: number; dos: string[]; donts: string[]; state: string | null};
export type RulePlan = {dos: string[]; donts: string[]; was: string; merged: string; added: number; notes: string[]; changed: boolean};

/** The card's field after this digest's rules are added, in the clean format (commentWatch.ts apply). */
export function mergeRules(before: string, item: Pick<PendingRule, 'kind' | 'at' | 'dos' | 'donts'>): RulePlan {
  const lines = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(s => s.trim()) : []);
  const label: Record<string, string> = {call: 'Call', kickoff: 'Onboarding', brief: 'Client brief'};
  const source = `${label[item.kind] ?? 'ClickUp comment'}, ${new Date(item.at).toISOString().slice(0, 10)}`;
  const tag = (s: string) => `${s.trim().replace(/[.\s]+$/, '')} (${source})`;
  const current = before.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  const dos = lines(item.dos).filter(r => !nearDuplicate(r, current)).map(tag);
  const donts = lines(item.donts).filter(r => !nearDuplicate(r, current)).map(tag);
  const clean = cleanDosDonts(before);
  const merged = cleanDosDonts([before, 'DO', ...dos.map(s => `- ${s}`), "DON'T", ...donts.map(s => `- ${s}`)].join('\n')).text;
  const count = (s: string) => s.split('\n').filter(l => l.startsWith('- ')).length;
  return {
    dos, donts, was: clean.text, merged, notes: clean.notes,
    added: Math.max(0, count(merged) - count(clean.text)),
    changed: (dos.length > 0 || donts.length > 0) && merged !== clean.text,
  };
}

// --- Gate -------------------------------------------------------------------------

export type Gate = {apply: boolean; only: Set<string>; mode: 'dry_run' | 'apply' | 'apply_limited'; live: (taskId: string) => boolean};

/** Values are used as set: the write gate compares COMMENT_WATCH_APPLY to "true" exactly. */
export function gate(env: (name: string) => string | undefined): Gate {
  const apply = env('COMMENT_WATCH_APPLY') === 'true';
  const only = new Set(String(env('COMMENT_WATCH_ONLY_TASKS') ?? '').split(',').map(s => s.trim()).filter(Boolean));
  return {
    apply,
    only,
    mode: !apply ? 'dry_run' : only.size ? 'apply_limited' : 'apply',
    live: taskId => apply && (only.size === 0 || only.has(taskId)),
  };
}

// --- Store and sources --------------------------------------------------------------

export type RecordItem = {commentId: string; taskId: string; clientName: string; at: string; by: string; kind: string; prompt?: string};
export type Recorded = {recorded: number; queued: number; skipped: number; known: number; deferred: number};
export type Store = {
  begin(mode: Gate['mode']): Promise<{busy: true} | {busy: false; run: number}>;
  tick(): Promise<Row>;
  rulesPending(includePlanned: boolean, limit: number): Promise<PendingRule[]>;
  rulesResult(commentId: string, state: 'dry_run' | 'written' | 'unchanged' | 'failed', rules: Row, added?: number): Promise<void>;
  seen(ids: string[]): Promise<Set<string>>;
  record(items: RecordItem[]): Promise<Recorded>;
  finish(run: number, ok: boolean, note: string, counts: Row, planned: Row[]): Promise<void>;
  /** Read-only extras for a dry run's report. */
  preview?(): Promise<Row>;
};
/** Built inside the run, so a missing key becomes the run's plain note. */
export type Sources = {clickup: () => Provider};

export type Result = {ok: boolean; skipped?: 'busy'; run?: number; mode?: string; counts?: Row; planned?: Row[]; preview?: Row; note: string};

/** One provider's calls, one at a time and spaced; reads retried on a 429 or a 5xx while time allows. */
export function paced(provider: Provider, gapMs: number, clock: Clock, until: number): Provider {
  let last = Number.NEGATIVE_INFINITY;
  return {
    async call(method, path, body) {
      for (let attempt = 0; ; attempt++) {
        if (clock.now() >= until) throw new OutOfTime();
        const wait = last + gapMs - clock.now();
        if (wait > 0) await clock.sleep(wait);
        last = clock.now();
        try {
          return await provider.call(method, path, body);
        } catch (e) {
          const retry = RETRY_WAITS[attempt];
          if (method !== 'GET' || retry === undefined || !/\((?:429|5\d\d)\)/.test(message(e)) || clock.now() + retry >= until) throw e;
          await clock.sleep(retry);
        }
      }
    },
  };
}

/** What happened to one provider error. */
export function classify(e: unknown): 'time' | 'config' | 'ledger' | 'retry' | 'refused' {
  const m = message(e);
  if (e instanceof OutOfTime) return 'time';
  if (/is not configured/.test(m)) return 'config';
  if (/Provider health could not be saved/.test(m)) return 'ledger';
  const status = Number(/rejected the request \((\d{3})\)/.exec(m)?.[1] ?? 0);
  if (status === 429 || status >= 500 || /response is unknown|could not be read/i.test(m)) return 'retry';
  return 'refused';
}

function clickupProblem(e: unknown): string {
  const m = message(e);
  if (e instanceof Plain) return m;
  if (/CLICKUP_API_TOKEN is not configured/.test(m))
    return 'ClickUp cannot be read: CLICKUP_API_TOKEN is not set on the comment-watch Edge Function. Ask an administrator to add it under Edge Functions, Secrets.';
  if (/Provider health could not be saved/.test(m)) return 'The provider health ledger could not be written, so the comment watch stopped.';
  if (e instanceof OutOfTime) return 'The comment watch ran out of time. The next run continues.';
  if (/\((?:401|403)\)/.test(m)) return 'ClickUp refused the key. Ask an administrator to renew CLICKUP_API_TOKEN.';
  return 'The comment watch could not read ClickUp. Check the provider health ledger.';
}

// --- One run -------------------------------------------------------------------------

const NOTES_WAIT = "The field still holds notes the Do's & Don'ts tidy job has not moved to a comment yet, so the rules wait for it.";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function listClientTasks(clickup: Provider): Promise<Any[]> {
  const out: Any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await clickup.call('GET', `list/${CLIENTS_LIST}/task?include_closed=true&subtasks=false&page=${page}`);
    if (!r || !Array.isArray(r.tasks)) throw new Plain('ClickUp returned a page of client cards without its cards. Check the provider health ledger.');
    out.push(...r.tasks);
    if (r.tasks.length < 100 || r.last_page === true) return out;
  }
  return out;
}

type Ctx = {store: Store; clickup: Provider; g: Gate; dryRun: boolean; clock: Clock; start: number; counts: Record<string, number>; planned: Row[]; problems: string[]};

/** Step 3: new rules onto the cards. A transient failure leaves the digest pending for the next run. */
async function applyRules(c: Ctx): Promise<void> {
  const live = (taskId: string) => !c.dryRun && c.g.live(taskId);
  const pending = (await c.store.rulesPending(c.g.apply && !c.dryRun, 100))
    .filter(item => item.state === null || live(item.taskId))
    .slice(0, RULES_LIMIT);
  const read = async (taskId: string) => fieldValue(await c.clickup.call('GET', `task/${taskId}`));
  for (const item of pending) {
    if (c.clock.now() >= c.start + SCAN_BUDGET_MS) {
      c.problems.push('Time ran out before every new rule was checked; the rest wait for the next run.');
      break;
    }
    const entry = {commentId: item.commentId, taskId: item.taskId, clientName: item.clientName, field: "Do's & Don'ts"};
    try {
      let before = await read(item.taskId);
      let plan = mergeRules(before, item);
      if (!live(item.taskId) || !plan.changed || plan.notes.length) {
        if (!plan.changed) {
          await c.store.rulesResult(item.commentId, 'unchanged', {old: before, note: 'Every rule is already on the card.'});
          c.counts.rules_unchanged++;
          c.planned.push({...entry, status: 'unchanged'});
        } else if (plan.notes.length) {
          c.counts.rules_waiting++;
          c.planned.push({...entry, status: 'waiting', note: NOTES_WAIT});
        } else {
          await c.store.rulesResult(item.commentId, 'dry_run', {old: before, new: plan.merged, dos: plan.dos, donts: plan.donts});
          c.counts.rules_planned++;
          c.planned.push({...entry, old: before, new: plan.merged, status: 'planned'});
        }
        continue;
      }
      // Written only if nobody edited the field since it was read (one retry), as in Convex.
      let outcome: 'written' | 'unchanged' | 'waiting' | 'edited' = 'edited';
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          before = await read(item.taskId);
          plan = mergeRules(before, item);
        }
        if (!plan.changed) {
          outcome = 'unchanged';
          break;
        }
        if (plan.notes.length) {
          outcome = 'waiting';
          break;
        }
        if ((await read(item.taskId)).trim() !== before.trim()) continue;
        await c.clickup.call('POST', `task/${item.taskId}/field/${DOS_DONTS_FIELD}`, {value: plan.merged});
        if ((await read(item.taskId)).trim() !== plan.merged.trim()) throw new Plain('ClickUp did not keep the new rules.');
        outcome = 'written';
        break;
      }
      if (outcome === 'written') {
        await c.store.rulesResult(item.commentId, 'written', {old: before, new: plan.merged, dos: plan.dos, donts: plan.donts}, plan.added);
        c.counts.rules_written++;
        c.planned.push({...entry, old: before, new: plan.merged, status: 'written', added: plan.added});
      } else if (outcome === 'unchanged') {
        await c.store.rulesResult(item.commentId, 'unchanged', {old: before, note: 'Every rule is already on the card.'});
        c.counts.rules_unchanged++;
        c.planned.push({...entry, status: 'unchanged'});
      } else if (outcome === 'waiting') {
        c.counts.rules_waiting++;
        c.planned.push({...entry, status: 'waiting', note: NOTES_WAIT});
      } else {
        c.counts.rules_retry++;
        c.planned.push({...entry, status: 'skipped', note: 'Edited in ClickUp while it was being read; tried again next run.'});
      }
    } catch (e) {
      const kind = classify(e);
      if (kind === 'time' || kind === 'config' || kind === 'ledger') throw e;
      const error = redact(message(e));
      if (kind === 'retry') {
        c.counts.rules_retry++;
        c.planned.push({...entry, status: 'retry', note: error});
        continue;
      }
      await c.store.rulesResult(item.commentId, 'failed', {error});
      c.counts.rules_failed++;
      c.planned.push({...entry, status: 'failed', note: error});
    }
  }
}

type Found = {commentId: string; taskId: string; clientName: string; at: number; by: string; text: string; rules: string};

/** Step 4: read every current card's comments and record the new ones. */
async function scan(c: Ctx): Promise<RecordItem[]> {
  const tasks = (await listClientTasks(c.clickup)).filter(t => ID.test(String(t?.id ?? '')) && String(t?.name ?? '').trim());
  const current = tasks.filter(isCurrent);
  c.counts.clients = current.length;
  if (!tasks.length) throw new Plain('ClickUp returned no client cards, so nothing was read. Check that the token can still see the Clients - Mahara list.');
  const found = new Map<string, Found>();
  const errors: string[] = [];
  for (const t of current) {
    if (c.clock.now() >= c.start + SCAN_BUDGET_MS) {
      c.problems.push(`Time ran out after ${plural(c.counts.clients_read, 'client', 'clients')} of ${current.length}; the rest are read next run.`);
      break;
    }
    try {
      const body = await c.clickup.call('GET', `task/${t.id}/comment`);
      if (!body || !Array.isArray(body.comments)) throw new Plain('no comment list');
      c.counts.clients_read++;
      const rules = cleanDosDonts(fieldValue(t)).text;
      for (const cm of body.comments as Any[]) {
        const commentId = String(cm?.id ?? '');
        if (!ID.test(commentId) || found.has(commentId)) continue;
        found.set(commentId, {
          commentId, taskId: String(t.id), clientName: String(t.name).trim(),
          at: Number(cm.date) || c.clock.now(), by: String(cm.user?.username ?? cm.user?.email ?? ''), text: String(cm.comment_text ?? ''), rules,
        });
      }
    } catch (e) {
      if (['time', 'config', 'ledger'].includes(classify(e))) throw e;
      c.counts.card_errors++;
      errors.push(`${String(t.name).slice(0, 60)}: ${redact(message(e)).slice(0, 120)}`);
    }
  }
  if (errors.length)
    c.problems.push(`The comments on ${plural(errors.length, 'card', 'cards')} could not be read and are read again next run (${errors.slice(0, 3).join('; ')}).`);
  c.counts.comments = found.size;
  const all = [...found.values()];
  const seen = new Set<string>();
  for (let i = 0; i < all.length; i += 2000) for (const id of await c.store.seen(all.slice(i, i + 2000).map(f => f.commentId))) seen.add(id);
  const fresh = all.filter(f => !seen.has(f.commentId)).sort((a, b) => a.at - b.at || a.commentId.localeCompare(b.commentId));
  const cutoff = c.clock.now() - BACKFILL_DAYS * 86_400_000;
  const items: RecordItem[] = [];
  let digests = 0;
  for (const f of fresh) {
    const kind = kindOf(f.text, f.by);
    const worth = kind !== 'skip' && f.at >= cutoff;
    if (worth && digests >= DIGEST_LIMIT) {
      c.counts.deferred++;
      continue;
    }
    const item: RecordItem = {commentId: f.commentId, taskId: f.taskId, clientName: f.clientName, at: String(Math.trunc(f.at)), by: f.by.slice(0, 200), kind};
    if (worth) {
      item.prompt = digestPrompt(f.clientName, kind, f.at, f.by, f.text, f.rules);
      digests++;
    }
    items.push(item);
  }
  for (let i = 0; i < items.length; i += 100) {
    const r = await c.store.record(items.slice(i, i + 100));
    c.counts.recorded += r.recorded;
    c.counts.queued += r.queued;
    c.counts.skipped += r.skipped;
    c.counts.deferred += r.deferred;
  }
  if (c.counts.deferred)
    c.problems.push(`${plural(c.counts.deferred, 'comment waits', 'comments wait')} for the next run, so Hermes is never handed more than one run of work at a time.`);
  return items;
}

/** One scheduled run. */
export async function runWatch(store: Store, sources: Sources, g: Gate, clock: Clock = systemClock, dryRun = false): Promise<Result> {
  const start = clock.now();
  const begun = await store.begin(g.mode);
  if (begun.busy) return {ok: true, skipped: 'busy', note: 'Another comment watch run is still open.'};
  const counts: Record<string, number> = {
    clients: 0, clients_read: 0, card_errors: 0, comments: 0, recorded: 0, queued: 0, skipped: 0, deferred: 0,
    rules_written: 0, rules_planned: 0, rules_unchanged: 0, rules_waiting: 0, rules_retry: 0, rules_failed: 0,
  };
  const planned: Row[] = [];
  const problems: string[] = [];
  let ok = true;
  let tick: Row | undefined;
  let items: RecordItem[] = [];
  try {
    tick = await store.tick();
    if (tick?.ok === false) {
      ok = false;
      if (tick.note) problems.push(String(tick.note));
    }
  } catch (e) {
    ok = false;
    problems.push(`The publish step failed: ${redact(message(e))}. Digests stay in the ledger until it works.`);
  }
  let clickup: Provider | undefined;
  try {
    clickup = paced(sources.clickup(), CLICKUP_GAP_MS, clock, start + HARD_MS);
  } catch (e) {
    ok = false;
    problems.push(clickupProblem(e));
  }
  if (clickup) {
    const ctx: Ctx = {store, clickup, g, dryRun, clock, start, counts, planned, problems};
    for (const [step, label] of [[applyRules, 'rules'], [scan, 'comments']] as const) {
      try {
        const out = await step(ctx);
        if (label === 'comments') items = out as RecordItem[];
      } catch (e) {
        ok = false;
        problems.push(
          e instanceof DatabaseError
            ? `The cockpit database refused the ${label} step (${redact(message(e))}). Nothing after it was saved; the next run tries again.`
            : clickupProblem(e),
        );
        if (['config', 'ledger'].includes(classify(e))) break;
      }
    }
  }
  if (counts.rules_failed) ok = false;
  if (counts.rules_retry)
    problems.push(`${plural(counts.rules_retry, 'rules write was', 'rules writes were')} not confirmed and ${counts.rules_retry === 1 ? 'is' : 'are'} tried again next run.`);
  const rulesNote = g.apply && !dryRun
    ? `${plural(counts.rules_written, 'card', 'cards')} got new rules`
    : `${plural(counts.rules_planned, 'card change', 'card changes')} planned, nothing written to ClickUp`;
  const note = `${plural(counts.clients_read, 'client', 'clients')} read, ${plural(counts.recorded, 'new comment', 'new comments')} (${counts.queued} for a digest, ${counts.skipped} skipped); ${rulesNote}; ${Number(tick?.settled ?? 0)} digests settled, ${Number(tick?.commentsPublished ?? 0)} published.${problems.length ? ` ${problems.join(' ')}` : ''}`;
  if (!dryRun) await store.finish((begun as {run: number}).run, ok, note, {...counts, tick: tick ?? null} as Row, planned);
  const result: Result = {ok, run: dryRun ? undefined : (begun as {run: number}).run, mode: dryRun ? 'dry_run' : g.mode, counts: {...counts, tick: tick ?? null} as Row, note};
  if (dryRun) {
    result.planned = planned;
    result.preview = {
      ...(store.preview ? await store.preview().catch(e => ({error: redact(message(e))})) : {}),
      newComments: items.map(i => ({commentId: i.commentId, clientName: i.clientName, kind: i.kind, at: new Date(Number(i.at)).toISOString(), action: i.prompt ? 'digest' : 'record as skipped'})),
    };
  }
  return result;
}

// --- Wiring to Supabase (no I/O of its own; index.ts hands in the client) ---------------

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: {message: string} | null}>;
export type Admin = {rpc: Rpc; from: (table: string) => Any};

export class DatabaseError extends Error {}

async function call<T>(admin: Admin, name: string, args: Record<string, unknown>): Promise<T> {
  const {data, error} = await admin.rpc(name, args);
  if (error) throw new DatabaseError(`${name}: ${error.message}`);
  return data as T;
}
const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);

export function supabaseStore(admin: Admin): Store {
  return {
    async begin(mode) {
      const d = (await call<Row>(admin, 'cockpit_comment_watch_begin', {p_mode: mode})) ?? {};
      if (d.busy === true) return {busy: true};
      const run = count(d.run);
      if (d.busy !== false || run === null) throw new DatabaseError('The run could not start: its run row is unreadable.');
      return {busy: false, run};
    },
    tick: async () => (await call<Row>(admin, 'cockpit_ai_watch_tick', {})) ?? {},
    async rulesPending(includePlanned, limit) {
      const rows = await call<unknown>(admin, 'cockpit_comment_watch_rules_pending', {p_include_planned: includePlanned, p_limit: limit});
      if (!Array.isArray(rows)) throw new DatabaseError('The pending rules could not be read.');
      return rows as PendingRule[];
    },
    async rulesResult(commentId, state, rules, added) {
      await call(admin, 'cockpit_comment_watch_rules_result', {p_comment_id: commentId, p_state: state, p_rules: rules, p_rules_added: added ?? null});
    },
    async seen(ids) {
      const rows = await call<unknown>(admin, 'cockpit_comment_watch_seen', {p_comment_ids: ids});
      if (!Array.isArray(rows)) throw new DatabaseError('The seen comments could not be read.');
      return new Set(rows.map(String));
    },
    async record(items) {
      const d = (await call<Row>(admin, 'cockpit_comment_watch_record', {p_items: items})) ?? {};
      const out = {recorded: count(d.recorded), queued: count(d.queued), skipped: count(d.skipped), known: count(d.known), deferred: count(d.deferred)};
      if (Object.values(out).some(v => v === null) || out.recorded! + out.known! + out.deferred! !== items.length)
        throw new DatabaseError('The save did not account for every comment.');
      return out as Recorded;
    },
    async finish(run, ok, note, counts, planned) {
      await call(admin, 'cockpit_comment_watch_finish', {p_run: run, p_ok: ok, p_note: note, p_counts: counts, p_planned: planned});
    },
    async preview() {
      return {
        callBriefs: await call<Row>(admin, 'cockpit_call_brief_enqueue', {p_limit: 100, p_dry_run: true}),
        database: await call<Row>(admin, 'cockpit_ai_watch_doctor', {}),
      };
    },
  };
}

/** A dry run reads ClickUp and the cockpit database and writes neither (provider receipts still land in the ledger). */
export function dryRunStore(real: Store): Store {
  return {
    begin: async () => ({busy: false, run: 0}),
    tick: async () => ({skipped: 'dry run'}),
    rulesPending: (includePlanned, limit) => real.rulesPending(includePlanned, limit),
    rulesResult: async () => undefined,
    seen: ids => real.seen(ids),
    record: async items => ({recorded: items.length, queued: items.filter(i => i.prompt).length, skipped: items.filter(i => !i.prompt).length, known: 0, deferred: 0}),
    finish: async () => undefined,
    preview: real.preview,
  };
}

export function liveSources(env: (name: string) => string | undefined, admin: Admin, request: typeof fetch = fetch): Sources {
  const health = async (row: Record<string, unknown>) => {
    const {error} = await admin.from('cockpit_csm_provider_health').insert({...row, provider: 'clickup'});
    if (error) throw new Error('Provider health could not be saved. Stop the comment watch.');
  };
  return {clickup: () => providerTools((env('CLICKUP_API_TOKEN') ?? '').trim(), health, request)};
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
  return diff === 0;
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

/**
 * The HTTP door. Only a caller holding CRON_SECRET (pg_cron sends the vault's
 * cockpit_sync_secret) may run it. Body {} runs the watch, {"dryRun":true}
 * reads ClickUp and the database and writes neither, {"doctor":true} says
 * which keys are set and reads the database doctor; it calls no provider.
 */
export async function handle(
  req: Request,
  env: (name: string) => string | undefined,
  connect: (url: string, key: string) => Admin,
  clock: Clock = systemClock,
  request: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== 'POST') return reply({ok: false, note: 'Send a POST.'}, 405);
  const expected = (env('CRON_SECRET') ?? '').trim();
  if (!expected) return reply({ok: false, note: 'CRON_SECRET is not set on this Edge Function. Add it under Edge Functions, Secrets.'}, 503);
  const given = (req.headers.get('x-cron-secret') ?? '').trim();
  if (!given || !timingSafeEqual(given, expected)) return reply({ok: false, note: 'not allowed'}, 401);
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    const parsed = text.trim() ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
  } catch {
    return reply({ok: false, note: 'The body must be JSON.'}, 400);
  }
  const g = gate(env);
  const url = (env('SUPABASE_URL') ?? '').trim(), key = (env('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (body.doctor === true) {
    const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_API_TOKEN', 'CRON_SECRET'];
    const keys = Object.fromEntries(names.map(n => [n, (env(n) ?? '').trim() ? 'set' : 'missing']));
    let database: unknown = 'not read: the Supabase connection variables are missing';
    if (url && key) database = await call(connect(url, key), 'cockpit_ai_watch_doctor', {}).catch(e => ({error: redact(message(e))}));
    return reply({ok: Object.values(keys).every(v => v === 'set'), keys, mode: g.mode, onlyTasks: g.only.size, database});
  }
  if (!url || !key) return reply({ok: false, note: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on this Edge Function.'}, 503);
  const admin = connect(url, key);
  const dryRun = body.dryRun === true;
  const real = supabaseStore(admin);
  try {
    const result = await runWatch(dryRun ? dryRunStore(real) : real, liveSources(env, admin, request), g, clock, dryRun);
    console.log(`comment-watch ${result.ok ? 'ok' : 'FAILED'}${dryRun ? ' (dry run)' : ''}: ${redact(result.note)}`);
    return reply(dryRun ? {...result, dryRun: true} : result);
  } catch (e) {
    const note = redact(message(e));
    console.error(`comment-watch FAILED: ${note}`);
    if (!dryRun) {
      const at = new Date(clock.now()).toISOString();
      await Promise.resolve(admin.from('cockpit_sync_state').upsert({key: 'comment-watch', last_run_at: at, updated_at: at, ok: false, note}, {onConflict: 'key'})).catch(() => undefined);
    }
    return reply({ok: false, note});
  }
}
