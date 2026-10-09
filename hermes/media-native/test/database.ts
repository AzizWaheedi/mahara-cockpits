import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { cockpitTestDb, member, actor, owner } from '../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import { row, type Row } from '../tools';
export { actor, owner };
export const BUYER = '10000000-0000-4000-8000-000000000001';
export const OTHER = '10000000-0000-4000-8000-000000000002';
export const WRONG_ROLE = '10000000-0000-4000-8000-000000000003';
export const UNCONFIRMED = '10000000-0000-4000-8000-000000000004';
export const FOUNDER = '10000000-0000-4000-8000-000000000005';
function sql(name: string): string { return readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'); }
function definition(source: string, expression: RegExp): string {
  const match = source.match(expression); if (!match) throw new Error(`Missing canonical SQL definition: ${expression}`); return match[0];
}
export async function database() {
  const db = await cockpitTestDb();
  try {
    // External Creative Triage FK target, not a repository-owned cockpit table.
    await db.exec('CREATE TABLE public.clients(id uuid PRIMARY KEY)');
    const domain = sql('20260923o_cockpit_domain_tables.sql');
    for (const name of ['cockpit_campaigns', 'cockpit_ads']) await db.exec(definition(domain, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\([\\s\\S]*?\\n\\);`)));
    const reconcile = sql('20260927k_cockpit_snapshot_reconcile.sql');
    for (const alter of reconcile.matchAll(/ALTER TABLE public\.cockpit_(?:campaigns|ads) ADD COLUMN[^;]+;/g)) await db.exec(alter[0]);
    const ai = sql('20260927a_cockpit_ask_ai_jobs.sql');
    await db.exec(definition(ai, /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/));
    const workflow = sql('20260927u_cockpit_media_workflows.sql');
    await db.exec(definition(workflow, /CREATE OR REPLACE FUNCTION public\.cockpit_media_scope\([\s\S]*?\$\$;/));
    await db.exec(definition(workflow, /CREATE FUNCTION public\.cockpit_media_request_scope\([\s\S]*?\$\$;/));
    const actions = sql('20260927g_cockpit_media_actions.sql');
    await db.exec(actions.slice(0, actions.indexOf('CREATE FUNCTION public.cockpit_media_scope')) + 'COMMIT;');
    await db.exec(workflow.slice(workflow.indexOf('CREATE TABLE public.cockpit_campaign_action_messages'), workflow.indexOf('CREATE FUNCTION public.cockpit_media_action_effects')));
    await db.exec(definition(workflow, /CREATE FUNCTION public\.cockpit_media_campaign_history\([\s\S]*?\$\$;/));
    for (const grant of workflow.matchAll(/(?:REVOKE ALL|GRANT EXECUTE) ON FUNCTION public\.cockpit_media_(?:scope|request_scope|campaign_history)\([^;]+;/g)) await db.exec(grant[0]);
    // Install original table definitions, RLS and grants, not a parallel test schema.
    const media = sql('20260927w_media_read_models.sql');
    await db.exec(media.slice(0, media.indexOf('CREATE OR REPLACE FUNCTION public.cockpit_media_source_read')) + 'COMMIT;');
    const creative = sql('20260927s_creative_read_models.sql');
    await db.exec(creative.slice(0, creative.indexOf('CREATE OR REPLACE FUNCTION public.cockpit_creative_source_current')) + 'COMMIT;');
    await db.exec(sql('20260927j_cockpit_media_statistics.sql'));
    await db.exec(sql('20261004d_media_native_surface.sql'));
    await db.exec(sql('20261004e_media_native_worker_contracts.sql'));
    await db.exec(sql('20261009a_media_winner_native_identity.sql'));
    await member(db, BUYER, 'buyer@example.com', ['media_buyer']);
    await member(db, OTHER, 'other@example.com', ['media_buyer']);
    await member(db, WRONG_ROLE, 'sales@example.com', ['sales']);
    await member(db, UNCONFIRMED, 'unconfirmed@example.com', ['media_buyer'], true, false);
    await member(db, FOUNDER, 'aziz@maharamedia.com', []);
    await db.query('UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2', [['Alpha'], BUYER]);
    await db.query('UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2', [['Beta'], OTHER]);
    for (const name of ['Alpha', 'Beta']) await db.query('INSERT INTO public.cockpit_campaigns(client_name,meta_account_id,raw_data) VALUES($1,$2,$3)', [name, 'act_123', JSON.stringify({ _id: `${name}-campaign`, campaignName: `${name}-Campaign`, clientName: name, metaAccountId: '123', serviceType: 'Offices' })]);
    await db.exec("UPDATE public.cockpit_media_source_state SET ready=true,row_count=0,source_snapshot_at='2026-10-04T00:00:00Z'");
    return db;
  } catch (error) { await db.close(); throw error; }
}
export type Database = PGlite;
export async function call(db: Database, name: string, args: Row = {}): Promise<unknown> {
  if (!/^cockpit_media_[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error('Unsafe test RPC identifier');
  const parameters = Object.keys(args).map((key, index) => `${key} => $${index + 1}`).join(',');
  const result = await db.query<{ result: unknown }>(`SELECT public.${name}(${parameters}) AS result`, Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value));
  return result.rows[0].result;
}
export async function enqueue(db: Database, operation = 'chat.ask', args: Row = { campaignId: 'Alpha-Campaign', campaignName: 'Alpha-Campaign', client: 'Alpha', text: 'Should we review the campaign?' }) {
  await actor(db, BUYER); const id = crypto.randomUUID();
  await call(db, 'cockpit_media_native_write', { p_operation: operation, p_args: operation.startsWith('personalCalendars.') ? { ...args, app: 'media-buyer' } : args, p_request_id: id, p_apply: true });
  await db.exec('RESET ROLE; SET ROLE service_role'); return id;
}
export async function claim(db: Database) {
  await db.exec('RESET ROLE; SET ROLE service_role');
  const value = row(await call(db, 'cockpit_media_native_claim', { p_apply: true }));
  return { job: row(value.job), record: row(value.record) };
}
/** Real Supabase SDK at a local PostgREST transport boundary; every RPC executes PostgreSQL. */
export function sdk(db: Database, afterRpc?: (name: string, result: unknown) => Promise<void>) {
  return createClient('http://database.invalid', 'offline-fixture-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const name = url.pathname.match(/^\/rest\/v1\/rpc\/(cockpit_media_[a-z_]+)$/)?.[1];
    if (!name) throw new Error(`Unexpected offline transport route: ${url.pathname}`);
    try {
      const result = await call(db, name, row(JSON.parse(String(init?.body ?? '{}'))));
      await afterRpc?.(name, result);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }
    catch (error) { return new Response(JSON.stringify({ message: String(error), code: 'P0001' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
  } } });
}
