// The cron door for the CEO automatic extension pass, retired in waves 1 and 2
// (docs/forms/WAVE12-CONTRACT.md 4.11.3).
//
// The ClickUp field 'Current extension (weeks)' has one writer now: the
// billing queue (clickup-writeback, kind `billing`), which writes it with the
// grant from "Give more time" or the billing sheet's Extend and clears it the
// day after the grant ends. So this function writes nothing. It stays deployed
// until pg_cron mahara-ceo-extensions-auto is unscheduled in the C1 window
// (section 9, D-C1.5); until then each call answers the retired sentence and
// marks cockpit_sync_state 'ceo-extensions-auto' with it, so the run state says
// why nothing moved instead of going stale. No ClickUp or Typeform call.

import {RETIRED} from '../cockpit-ceo-api/extensions.ts';

type Env = (name: string) => string | undefined;
// deno-lint-ignore no-explicit-any
export type Admin = any;

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
  return diff === 0;
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

export async function handle(req: Request, env: Env, connect: (url: string, key: string) => Admin, now: () => Date = () => new Date()): Promise<Response> {
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
  if (body.doctor === true)
    return reply({
      ok: KEYS.every(n => (env(n) ?? '').trim() !== ''),
      retired: true,
      note: RETIRED,
      keys: Object.fromEntries(KEYS.map(n => [n, (env(n) ?? '').trim() ? 'set' : 'missing'])),
    });
  if (body.operation !== undefined && body.operation !== 'ceo.extensions.applyAuto')
    return reply({ok: false, note: 'This function runs only ceo.extensions.applyAuto.'}, 403);
  const result = {ok: true, retired: true, note: RETIRED, written: 0, cleared: 0, skipped: 0, errors: [] as string[]};
  const url = (env('SUPABASE_URL') ?? '').trim(), key = (env('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  // Without the service door the answer is still the retired sentence; only the run state is not marked.
  if (!url || !key) return reply({...result, note: `${RETIRED} The run state was not marked: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.`});
  const at = now().toISOString();
  try {
    const {error} = await connect(url, key).from('cockpit_sync_state').upsert(
      {key: 'ceo-extensions-auto', last_run_at: at, last_ok_at: at, ok: true, note: RETIRED, rows_seen: 0, updated_at: at},
      {onConflict: 'key'},
    );
    if (error) throw Error('the run state was not saved');
  } catch (e) {
    return reply({...result, ok: false, note: `${RETIRED} The run state was not marked (${e instanceof Error ? e.message : String(e)}).`}, 500);
  }
  return reply(result);
}
