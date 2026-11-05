// In-memory node-postgres wire protocol; no listener or real TLS is used.
import {strict as assert} from 'node:assert';
import {pathToFileURL} from 'node:url';
import {nodePostgresOwnedPool} from './pg-driver.ts';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const {createPgConfig}=await import(pathToFileURL(process.env.PGLITE_PG_MODULE).href);
const pg=(await import(pathToFileURL(process.env.PG_MODULE).href)).default;
for(const kind of ['table','sequence','reader-table','reader-sequence','pgx-table','reader-definer']) {
 const db=new PGlite();
 await db.exec(`create role cockpit_native_research_reader nologin noinherit;
 create role synthetic_reader_login login noinherit; grant cockpit_native_research_reader to synthetic_reader_login;
 create schema native_research_private; revoke all on schema native_research_private from public;
 create table native_research_private.capabilities(id int); create table native_research_private.settings(id int); create table native_research_private.gateway_quotas(id int);
 create table public.cockpit_form_responses(id int); create table public.cockpit_form_invites(id int); create table public.cockpit_form_effects(id int);
 create table public.cockpit_clickup_writeback_queue(id int); create table public.cockpit_form_versions(id int); create table public.cockpit_settings(id int);
 create schema synthetic_net; grant usage on schema synthetic_net to public;`);
 const setup={
  'table':'create table synthetic_net.queue(id int); grant select on synthetic_net.queue to public',
  'sequence':'create sequence synthetic_net.queue_id; grant usage on sequence synthetic_net.queue_id to public',
  'reader-table':'create table public.unrelated_sensitive(id int); grant select on public.unrelated_sensitive to cockpit_native_research_reader',
  'reader-sequence':'create sequence public.unrelated_sequence; grant usage on sequence public.unrelated_sequence to cockpit_native_research_reader',
  'pgx-table':'create schema pgx_fixture; create table pgx_fixture.sensitive(id int); grant usage on schema pgx_fixture to public; grant select on pgx_fixture.sensitive to public',
  'reader-definer':"create function public.unrelated_privileged() returns text language sql security definer as $$ select 'fictional'::text $$; revoke all on function public.unrelated_privileged() from public; grant execute on function public.unrelated_privileged() to cockpit_native_research_reader",
 };
 await db.exec(setup[kind]);
 const rawPool=new pg.Pool(createPgConfig(db));const client=await rawPool.connect();
 await client.query('set session authorization synthetic_reader_login');
 Object.assign(client.connection.stream,{encrypted:true,authorized:true,servername:'db.example.invalid'});client.release();
 const owned=nodePostgresOwnedPool(rawPool,'synthetic_reader_login','db.example.invalid');
 await assert.rejects(owned.acquire(new AbortController().signal),/Reader unavailable/,`unsafe ${kind} privilege must fail closed`);
 await rawPool.end();await db.close();
 console.log(`Synthetic unsafe ${kind} access denied.`);
}
