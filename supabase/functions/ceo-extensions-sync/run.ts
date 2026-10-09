// The cron door for the CEO automatic extension pass (Convex ceoExtensions.applyAuto).
//
// cockpit-ceo-api stays behind the Supabase gateway (verify_jwt=true), and
// pg_cron sends x-cron-secret, not a user token. So the scheduled pass has
// its own function, deployed with --no-verify-jwt like the other cron
// targets, that runs only extensionsAuto from cockpit-ceo-api/endpoints.ts.
// The pass is a dry run unless CEO_EXTENSIONS_APPLY is 'true', and its last
// run lands in cockpit_sync_state under 'ceo-extensions-auto'.

import {extensionsAuto} from '../cockpit-ceo-api/endpoints.ts';

type Env = (name: string) => string | undefined;
// deno-lint-ignore no-explicit-any
export type Admin = any;
type Run = typeof extensionsAuto;

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
  return diff === 0;
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_API_TOKEN', 'TYPEFORM_TOKEN'];

export async function handle(req: Request, env: Env, connect: (url: string, key: string) => Admin, run: Run = extensionsAuto): Promise<Response> {
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
      apply: env('CEO_EXTENSIONS_APPLY') === 'true',
      keys: Object.fromEntries(KEYS.map(n => [n, (env(n) ?? '').trim() ? 'set' : 'missing'])),
    });
  if (body.operation !== undefined && body.operation !== 'ceo.extensions.applyAuto')
    return reply({ok: false, note: 'This function runs only ceo.extensions.applyAuto.'}, 403);
  const url = (env('SUPABASE_URL') ?? '').trim(), key = (env('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!url || !key) return reply({ok: false, note: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on this Edge Function.'}, 503);
  const admin = connect(url, key);
  const health = async (row: Record<string, unknown>) => {
    const {error} = await admin.from('cockpit_ceo_provider_health').insert(row);
    if (error) throw Error('CEO provider health receipt could not be saved.');
  };
  try {
    return reply(await run(admin, env, health));
  } catch (e) {
    return reply({ok: false, note: e instanceof Error ? e.message : String(e)}, 500);
  }
}
