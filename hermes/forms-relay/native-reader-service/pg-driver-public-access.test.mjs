// In-memory node-postgres wire protocol; no listener or real TLS is used.
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {nodePostgresOwnedPool} from './pg-driver.ts';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const {createPgConfig}=await import(pathToFileURL(process.env.PGLITE_PG_MODULE).href);
const pg=(await import(pathToFileURL(process.env.PG_MODULE).href)).default;
const source=await readFile(new URL('./source-reader.test.mjs',import.meta.url),'utf8');
const fixture=source.match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
const sourceMigration=await readFile(new URL('../../../supabase/migrations/20261105162937_native_research_source_reader_candidate.sql',import.meta.url),'utf8');
const gatewayMigration=await readFile(new URL('../../../supabase/migrations/20261105164639_native_research_gateway_reservations_candidate.sql',import.meta.url),'utf8');
for(const kind of ['baseline','table','sequence','reader-table','reader-sequence','pgx-table','reader-definer','reader-membership','reader-login','reader-create-schema','helper-body','helper-owner']) {
 const db=new PGlite();
 await db.exec(fixture); await db.exec(sourceMigration); await db.exec(gatewayMigration);
 await db.exec(`create role synthetic_reader_login login noinherit; grant cockpit_native_research_reader to synthetic_reader_login;
 create schema synthetic_net; grant usage on schema synthetic_net to public;`);
 const setup={
  'baseline':'select 1',
  'table':'create table synthetic_net.queue(id int); grant select on synthetic_net.queue to public',
  'sequence':'create sequence synthetic_net.queue_id; grant usage on sequence synthetic_net.queue_id to public',
  'reader-table':'create table public.unrelated_sensitive(id int); grant select on public.unrelated_sensitive to cockpit_native_research_reader',
  'reader-sequence':'create sequence public.unrelated_sequence; grant usage on sequence public.unrelated_sequence to cockpit_native_research_reader',
  'pgx-table':'create schema pgx_fixture; create table pgx_fixture.sensitive(id int); grant usage on schema pgx_fixture to public; grant select on pgx_fixture.sensitive to public',
  'reader-definer':"create function public.unrelated_privileged() returns text language sql security definer as $$ select 'fictional'::text $$; revoke all on function public.unrelated_privileged() from public; grant execute on function public.unrelated_privileged() to cockpit_native_research_reader",
  'reader-membership':'create role synthetic_extra nologin; grant synthetic_extra to cockpit_native_research_reader',
  'reader-login':'alter role cockpit_native_research_reader login',
  'reader-create-schema':'grant create on schema synthetic_net to cockpit_native_research_reader',
  'helper-owner':'create role synthetic_owner nologin; alter function native_research_private.reserve_source(text,text,uuid,integer,text,text,text,integer) owner to synthetic_owner',
 };
 if(kind==='helper-body') {
  const r=await db.query("select pg_get_functiondef('native_research_private.reserve_source(text,text,uuid,integer,text,text,text,integer)'::regprocedure) definition");
  const changed=r.rows[0].definition.replace(/AS \$function\$[\s\S]*?\$function\$/, 'AS $function$ BEGIN RETURN NULL; END $function$');
  assert.notEqual(changed,r.rows[0].definition);await db.exec(changed);
 } else await db.exec(setup[kind]);
 const rawPool=new pg.Pool(createPgConfig(db));const client=await rawPool.connect();
 await client.query('set session authorization synthetic_reader_login');
 Object.assign(client.connection.stream,{encrypted:true,authorized:true,servername:'db.example.invalid'});client.release();
 const owned=nodePostgresOwnedPool(rawPool,'synthetic_reader_login','db.example.invalid');
 if(kind==='baseline') { const lease=await owned.acquire(new AbortController().signal);await lease.release({discard:false}); }
 else await assert.rejects(owned.acquire(new AbortController().signal),/Reader unavailable/,`unsafe ${kind} must fail closed`);
 await rawPool.end();await db.close();
 console.log(`Synthetic ${kind} check passed.`);
}
