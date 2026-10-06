import { createClient } from '@supabase/supabase-js';
import { actor, BUYER, call, type Database } from './database';
import { row, type Row } from '../tools';

export async function browserDatabase(db: Database, options: { afterRpc?: (name: string, args: Row, result: unknown) => Promise<void>; response?: (name: string, result: unknown) => unknown } = {}) {
  const user = { id: BUYER, aud: 'authenticated', role: 'authenticated', email: 'buyer@example.com', email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' };
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: BUYER, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.offline`;
  const client = createClient('http://browser-database.invalid', 'offline-fixture-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    const name = url.pathname.match(/^\/rest\/v1\/rpc\/(cockpit_media_[a-z_]+)$/)?.[1];
    if (!name) throw new Error(`Unexpected offline SDK route ${url.pathname}`);
    const args = row(JSON.parse(String(init?.body ?? '{}')));
    await actor(db, BUYER);
    let result: unknown;
    try { result = await call(db, name, args); }
    catch (error) { return Response.json({ message: String(error), code: 'P0001' }, { status: 400 }); }
    await options.afterRpc?.(name, args, result);
    return Response.json(options.response ? options.response(name, result) : result);
  } } });
  const session = await client.auth.setSession({ access_token: jwt, refresh_token: 'offline-refresh-token' });
  if (session.error) throw session.error;
  return client;
}
