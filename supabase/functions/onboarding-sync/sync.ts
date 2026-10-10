// onboarding-sync: every client's onboarding links and forms, on a schedule.
//
// The native replacement for the Convex cron "onboarding links and forms"
// (apps/client-success-cockpit/convex/onboarding.ts syncAll), which stopped
// with the Convex pause on 2026-10-07. pg_cron posts here every 10 minutes
// (migration 20261009b). One run:
//
// 1. opens a 'cron' row in cockpit_client_onboarding_runs
//    (cockpit_csm_onboarding_cron_begin; busy if another run is open);
// 2. reads the Clients - Mahara field definitions and every onboarding
//    Typeform in full, with the same reads as the one-card Refresh
//    (cockpit-csm-api/onboarding.ts). When Typeform cannot be read in full,
//    every row keeps its last forms and the run says why;
// 3. reads the list's cards a page (100 cards) at a time and writes each
//    page through cockpit_csm_onboarding_cron_publish, which skips unchanged
//    rows and cards whose name disagrees with the client roster;
// 4. closes the run with its counts and plain problem, and records its
//    freshness in cockpit_sync_state under key 'onboarding-sync'.
//
// Every ClickUp and Typeform call goes through cockpit-csm-api/tools.ts, so it
// lands in cockpit_csm_provider_health. Calls are spaced (ClickUp allows 100
// a minute per token, Typeform 2 a second) and retried on 429 or 5xx while
// time allows. A run starts no new card page after BUDGET_MS; the next run
// continues from that page. This function reads providers and writes only the
// cockpit database: it makes no provider writes.

import {cardRow, formsFor, LIST_ID, newestByCard, optionsOf, type FormData, type OnboardingRow} from '../../../apps/client-success-cockpit/src/lib/onboardingCore.ts';
import {missingFieldsProblem, readFieldDefinitions, readFormData, TYPEFORM_UNVERIFIED, type TypeformReader} from '../cockpit-csm-api/onboarding.ts';
import {providerTools, typeformTools, type Provider} from '../cockpit-csm-api/tools.ts';

/** No new card page starts after this; the next run continues from it. */
export const BUDGET_MS = 100_000;
/** Typeform reading stops after this; the rows keep their last forms. */
export const TYPEFORM_BUDGET_MS = 50_000;
/** No call or retry starts after this (the Edge Function stops at 150 s). */
export const HARD_MS = 115_000;
/** At most about 86 ClickUp calls a minute from this run; ClickUp allows 100 per token. */
export const CLICKUP_GAP_MS = 700;
/** Under Typeform's 2 calls a second. */
export const TYPEFORM_GAP_MS = 600;
/** 2,000 cards, as the Convex sync read. */
export const MAX_PAGES = 20;
/** Rows per publish call, as the Convex sync wrote them. */
export const BATCH = 20;
const RETRY_WAITS = [5_000, 15_000];
const ID = /^[A-Za-z0-9_-]{1,40}$/;

// biome-ignore lint/suspicious/noExplicitAny: ClickUp bodies are untyped
type Any = any;
export type Clock = {now: () => number; sleep: (ms: number) => Promise<void>};
export const systemClock: Clock = {now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms))};
export type Published = {written: number; unchanged: number; identitySkipped: number};
export type StateRow = {ok: boolean; note: string; rows_seen: number | null};
export type Store = {
  begin(): Promise<{busy: true} | {busy: false; run: number; resumePage: number}>;
  publish(run: number, rows: OnboardingRow[], formsVerified: boolean): Promise<Published>;
  finish(run: number, ok: boolean, counts: Record<string, number>, problem: string | null): Promise<void>;
  state(row: StateRow): Promise<void>;
};
/** Built inside the run, so a missing key becomes the run's plain problem. */
export type Sources = {clickup: () => Provider; typeform: () => TypeformReader};
export type Result = {ok: boolean; skipped?: 'busy'; run?: number; counts?: Record<string, number>; problem?: string | null; note?: string};

export class OutOfTime extends Error {
  constructor() {super('The scheduled onboarding sync ran out of time.');}
}
/** A failure already said in plain words for the screen. */
class Plain extends Error {}

export const redact = (s: string) =>
  s.replace(/\b(?:pk|tfp|sk)_[A-Za-z0-9_]{4,}/g, '[key]').replace(/\beyJ[A-Za-z0-9_.-]{10,}/g, '[key]').replace(/\s+/g, ' ').trim().slice(0, 300);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One provider's calls, one at a time, at least `gapMs` apart, tried again
 * on a 429 or a 5xx while there is time. Every attempt is its own call, so
 * every attempt lands in the health ledger.
 */
export function paced<A extends unknown[], R>(call: (...args: A) => Promise<R>, gapMs: number, clock: Clock, until: number): (...args: A) => Promise<R> {
  let last = Number.NEGATIVE_INFINITY;
  return async (...args: A) => {
    for (let attempt = 0; ; attempt++) {
      if (clock.now() >= until) throw new OutOfTime();
      const wait = last + gapMs - clock.now();
      if (wait > 0) await clock.sleep(wait);
      last = clock.now();
      try {
        return await call(...args);
      } catch (e) {
        const retry = RETRY_WAITS[attempt];
        if (retry === undefined || !/\((?:429|5\d\d)\)/.test(message(e)) || clock.now() + retry >= until) throw e;
        await clock.sleep(retry);
      }
    }
  };
}

/** Only the newest response per card is ever used (formsFor); keep just those. */
export function newestOnly(data: FormData): FormData {
  const responses: FormData['responses'] = {};
  for (const key of Object.keys(data.responses) as (keyof FormData['responses'])[])
    responses[key] = [...newestByCard(data.responses[key] ?? []).values()];
  return {definitions: data.definitions, responses};
}

/** A card the list endpoint returned whole: an id, a name, its list, its fields. */
export function readable(t: Any): boolean {
  return Boolean(t) && typeof t === 'object' && ID.test(String(t.id ?? '')) && String(t.name ?? '').trim() !== '' &&
    String(t.list?.id ?? '') === LIST_ID && Array.isArray(t.custom_fields);
}

function clickupProblem(e: unknown): string {
  const m = message(e);
  if (e instanceof Plain) return m;
  if (/CLICKUP_API_TOKEN is not configured/.test(m))
    return 'ClickUp cannot be read: CLICKUP_API_TOKEN is not set for the onboarding sync. Existing links and forms are unchanged. Ask an administrator to add it to the Edge Function secrets.';
  if (/Provider health could not be saved/.test(m))
    return 'The provider health ledger could not be written, so the onboarding sync stopped. Existing links and forms are unchanged.';
  if (e instanceof OutOfTime) return 'The scheduled onboarding sync ran out of time before reading ClickUp. Existing links and forms are unchanged. The next run tries again.';
  if (/\((?:401|403)\)/.test(m)) return 'ClickUp refused the key. Existing links and forms are unchanged. Ask an administrator to renew CLICKUP_API_TOKEN.';
  return 'The scheduled onboarding sync could not read ClickUp. Existing links and forms are unchanged. Check the provider health ledger.';
}

function typeformProblem(e: unknown): string {
  const m = message(e);
  if (/TYPEFORM_TOKEN is not configured/.test(m))
    return 'The forms cannot be read: TYPEFORM_TOKEN is not set for the onboarding sync. Existing submitted forms are retained. Ask an administrator to add it to the Edge Function secrets.';
  if (e instanceof OutOfTime) return 'Typeform did not finish reading in time. Existing submitted forms are retained. The next run reads them again.';
  if (/\((?:401|403)\)/.test(m)) return 'Typeform refused the key. Existing submitted forms are retained. Ask an administrator to renew TYPEFORM_TOKEN.';
  return TYPEFORM_UNVERIFIED;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One scheduled run over every card on Clients - Mahara. */
export async function syncAll(store: Store, sources: Sources, clock: Clock = systemClock): Promise<Result> {
  const start = clock.now();
  const begun = await store.begin();
  if (begun.busy) return {ok: true, skipped: 'busy', note: 'Another scheduled onboarding run is still open.'};
  const {run, resumePage} = begun;
  const counts: Record<string, number> = {start_page: resumePage, pages: 0, cards: 0, written: 0, unchanged: 0, identity_skipped: 0, unreadable: 0, in_onboarding: 0};
  const withForms = {onboarding_forms: 0, kickoff_forms: 0, blueprint_forms: 0};
  let problem: string | null = null;
  let ok = false;
  let detail = '';
  try {
    let clickupTools: Provider;
    try {
      clickupTools = sources.clickup();
    } catch (e) {
      throw new Plain(clickupProblem(e));
    }
    const clickup: Provider = {call: paced((method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) => clickupTools.call(method, path, body), CLICKUP_GAP_MS, clock, start + HARD_MS)};
    let fields: Record<string, unknown>;
    try {
      fields = await readFieldDefinitions(clickup);
    } catch (e) {
      detail = message(e);
      throw new Plain(clickupProblem(e));
    }
    const options = optionsOf(fields);

    let forms: FormData | null = null;
    let formsProblem: string | null = null;
    try {
      const typeformTool = sources.typeform();
      const typeform: TypeformReader = {get: paced((path: string) => typeformTool.get(path), TYPEFORM_GAP_MS, clock, start + TYPEFORM_BUDGET_MS)};
      forms = newestOnly(await readFormData(typeform));
    } catch (e) {
      formsProblem = typeformProblem(e);
    }

    const stamp = new Date(clock.now()).toISOString();
    const seen = new Set<string>();
    let page = resumePage;
    let reachedEnd = false;
    for (; page < MAX_PAGES; page++) {
      if (page > resumePage && clock.now() >= start + BUDGET_MS) break;
      let body: Any;
      try {
        body = await clickup.call('GET', `list/${LIST_ID}/task?page=${page}&include_closed=true&subtasks=false&archived=false`);
      } catch (e) {
        detail = message(e);
        throw new Plain(clickupProblem(e));
      }
      if (!body || !Array.isArray(body.tasks)) throw new Plain('ClickUp returned a card page without its cards. Existing links and forms are unchanged. Check the provider health ledger.');
      const tasks = body.tasks as Any[];
      counts.pages++;
      const rows: OnboardingRow[] = [];
      for (const t of tasks) {
        if (!readable(t)) {
          counts.unreadable++;
          continue;
        }
        if (seen.has(String(t.id))) continue;
        seen.add(String(t.id));
        const row = cardRow(t, options, stamp);
        if (forms) row.forms = formsFor(row.clickup_task_id, forms);
        rows.push(row);
      }
      for (let i = 0; i < rows.length; i += BATCH) {
        let saved: Published;
        try {
          saved = await store.publish(run, rows.slice(i, i + BATCH), forms !== null);
        } catch (e) {
          detail = message(e);
          throw new Plain('The scheduled onboarding sync could not save the cards. Rows saved before the failure stay. Check the function log.');
        }
        counts.written += saved.written;
        counts.unchanged += saved.unchanged;
        counts.identity_skipped += saved.identitySkipped;
      }
      counts.cards += rows.length;
      counts.in_onboarding += rows.filter(r => r.in_onboarding).length;
      withForms.onboarding_forms += rows.filter(r => r.forms?.onboarding).length;
      withForms.kickoff_forms += rows.filter(r => r.forms?.kickoff).length;
      withForms.blueprint_forms += rows.filter(r => r.forms?.blueprint).length;
      if (body.last_page !== false || tasks.length === 0) {
        reachedEnd = true;
        break;
      }
    }
    if (resumePage === 0 && reachedEnd && counts.cards === 0)
      throw new Plain('ClickUp returned no readable client cards, so nothing changed. Check that the ClickUp token can still see the Clients - Mahara list.');
    // Missing is never zero: form counts only when every form was read.
    if (forms) Object.assign(counts, withForms);
    const notes: (string | null)[] = [missingFieldsProblem(fields), formsProblem];
    if (counts.identity_skipped)
      notes.push(`${plural(counts.identity_skipped, 'card was', 'cards were')} not updated because the card name differs from the client roster. They update after the roster refreshes.`);
    if (counts.unreadable)
      notes.push(`ClickUp returned ${plural(counts.unreadable, 'card', 'cards')} with no name, no fields or another list, so ${counts.unreadable === 1 ? 'it was' : 'they were'} left as before.`);
    if (!reachedEnd && page < MAX_PAGES) {
      counts.resume_page = page;
      notes.push(`This run read ${plural(counts.cards, 'card', 'cards')} before its time ran out. The next run continues from page ${page + 1}.`);
    } else if (!reachedEnd) {
      notes.push(`Clients - Mahara has more than ${MAX_PAGES * 100} cards. Cards past that were not read. Ask an administrator to raise the limit.`);
    }
    problem = notes.filter(Boolean).join(' ') || null;
    ok = reachedEnd;
  } catch (e) {
    ok = false;
    if (!detail && !(e instanceof Plain)) detail = message(e);
    problem = e instanceof Plain ? e.message : 'The scheduled onboarding sync did not finish. Existing links and forms are unchanged. Check the function log.';
  }
  const note = ok
    ? `${plural(counts.cards, 'card', 'cards')}, ${counts.written} changed, from page ${resumePage + 1}${problem ? `. ${problem}` : ''}`
    : `${problem ?? 'The run failed.'}${detail ? ` (${detail})` : ''}`;
  try {
    await store.finish(run, ok, counts, problem);
  } catch (e) {
    await store.state({ok: false, note: redact(`The run could not be closed: ${message(e)}`), rows_seen: counts.cards}).catch(() => undefined);
    return {ok: false, run, counts, problem, note: redact(`The run could not be closed: ${message(e)}`)};
  }
  await store.state({ok, note: redact(note), rows_seen: counts.cards}).catch(() => undefined);
  return {ok, run, counts, problem, note: redact(note)};
}

// --- wiring to Supabase (no I/O of its own; index.ts hands in the client) ------

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: {message: string} | null}>;
export type Admin = {rpc: Rpc; from: (table: string) => Any};

export function supabaseStore(admin: Admin, clock: Clock = systemClock): Store {
  const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
  return {
    async begin() {
      const {data, error} = await admin.rpc('cockpit_csm_onboarding_cron_begin', {});
      if (error) throw Error(`The scheduled run could not start: ${error.message}`);
      const d = (data ?? {}) as Record<string, unknown>;
      if (d.busy === true) return {busy: true};
      const run = count(d.run), resumePage = count(d.resumePage);
      if (d.busy !== false || run === null || resumePage === null) throw Error('The scheduled run could not start: its run row is unreadable.');
      return {busy: false, run, resumePage};
    },
    async publish(run, rows, formsVerified) {
      const {data, error} = await admin.rpc('cockpit_csm_onboarding_cron_publish', {p_run: run, p_rows: rows, p_forms_verified: formsVerified});
      if (error) throw Error(error.message);
      const d = (data ?? {}) as Record<string, unknown>;
      const written = count(d.written), unchanged = count(d.unchanged), identitySkipped = count(d.identitySkipped);
      if (written === null || unchanged === null || identitySkipped === null || written + unchanged + identitySkipped !== rows.length)
        throw Error('The save did not account for every card.');
      return {written, unchanged, identitySkipped};
    },
    async finish(run, ok, counts, problem) {
      const {error} = await admin.from('cockpit_client_onboarding_runs')
        .update({finished_at: new Date(clock.now()).toISOString(), ok, counts, problem: problem ? problem.slice(0, 500) : null})
        .eq('id', run).is('finished_at', null);
      if (error) throw Error(error.message);
    },
    async state(row) {
      const at = new Date(clock.now()).toISOString();
      const {error} = await admin.from('cockpit_sync_state')
        .upsert({key: 'onboarding-sync', last_run_at: at, updated_at: at, ...row, ...(row.ok ? {last_ok_at: at} : {})}, {onConflict: 'key'});
      if (error) throw Error(error.message);
    },
  };
}

/** The same tools and the same ledger as the one-card Refresh. */
export function liveSources(env: (name: string) => string | undefined, admin: Admin, request: typeof fetch = fetch): Sources {
  const health = async (row: Record<string, unknown>) => {
    const {error} = await admin.from('cockpit_csm_provider_health').insert(row);
    if (error) throw Error('Provider health could not be saved. Stop the sync.');
  };
  return {
    clickup: () => providerTools((env('CLICKUP_API_TOKEN') ?? '').trim(), row => health({...row, provider: 'clickup'}), request),
    typeform: () => typeformTools((env('TYPEFORM_TOKEN') ?? '').trim(), health, request),
  };
}

/** A dry run reads the providers and writes no cockpit rows (provider receipts still land in the ledger). */
export function dryRunStore(): Store {
  return {
    begin: async () => ({busy: false, run: 0, resumePage: 0}),
    publish: async (_run, rows) => ({written: 0, unchanged: rows.length, identitySkipped: 0}),
    finish: async () => undefined,
    state: async () => undefined,
  };
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
 * cockpit_sync_secret) may run it. Body {} runs the sync, {"dryRun":true}
 * reads without writing rows, {"doctor":true} says which keys are set and
 * calls nothing.
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
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_API_TOKEN', 'TYPEFORM_TOKEN'];
  if (body.doctor === true)
    return reply({ok: names.every(n => (env(n) ?? '').trim() !== ''), keys: Object.fromEntries(names.map(n => [n, (env(n) ?? '').trim() ? 'set' : 'missing']))});
  const url = (env('SUPABASE_URL') ?? '').trim(), key = (env('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!url || !key) return reply({ok: false, note: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on this Edge Function.'}, 503);
  const admin = connect(url, key);
  const store = body.dryRun === true ? dryRunStore() : supabaseStore(admin, clock);
  try {
    const result = await syncAll(store, liveSources(env, admin, request), clock);
    return reply(body.dryRun === true ? {...result, dryRun: true} : result);
  } catch (e) {
    const note = redact(message(e));
    await store.state({ok: false, note, rows_seen: null}).catch(() => undefined);
    return reply({ok: false, note});
  }
}
