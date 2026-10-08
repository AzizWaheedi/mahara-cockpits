import {expect, test} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cockpitTestDb, migration, owner} from './lib/cockpitTestDb';
import {PGlite} from '@electric-sql/pglite';

const archive='/opt/data/backups/cockpit-runtime-private/ceo-staffing-current-prod-1791461734394759922.zip';
const manifest='/opt/data/backups/cockpit-runtime-private/ceo-staffing-current-prod-manifest.json';
const fixtureAvailable=existsSync(archive)&&existsSync(manifest);
const python=`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('staffing','../../scripts/import-ceo-staffing.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.prepare(sys.argv[1],sys.argv[2])))`;
function source(){return JSON.parse(execFileSync('python3',['-c',python,archive,manifest],{encoding:'utf8'}));}
const priorSha='75941c6d9015053af9ae2abde87fe2605f363927935e45582da80a265888ac5e';
function evidence(payload:any){return {current_sha256:payload.source_sha256,prior_sha256:priorSha,deployment:payload.deployment,status_count:3,audit_count:40,staffing_audit_count:5,source_rows_equal:true};}
async function fixture(){
 const db=await cockpitTestDb();
 await db.exec(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;`);
 const sql=migration('20260927h_cockpit_ceo_actions.sql');
 const state=sql.match(/CREATE TABLE IF NOT EXISTS public\.cockpit_team_status_state\([^;]+;/)?.[0];
 const status=sql.match(/CREATE TABLE IF NOT EXISTS public\.cockpit_team_status \([\s\S]*?\n\);/)?.[0];
 if(!state||!status)throw Error('Canonical staffing DDL missing');
 await db.exec(state+'\n'+status);
 await db.exec('INSERT INTO cockpit_team_status_state(id) VALUES(true)');
 await db.exec(`ALTER TABLE cockpit_team_status ADD COLUMN source_deployment text, ADD COLUMN source_id text;
 CREATE UNIQUE INDEX cockpit_team_status_source_identity ON cockpit_team_status(source_deployment,source_id) WHERE source_id IS NOT NULL;
 CREATE UNIQUE INDEX cockpit_original_audit_source_identity ON cockpit_audit_log ((metadata->>'source_deployment'),(metadata->>'source_id')) WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit' AND metadata->>'source_id' IS NOT NULL;`);
 await db.exec(migration('20261008g_cockpit_ceo_staffing_import.sql'));
 await db.exec(migration('20261008i_cockpit_ceo_staffing_finalize.sql'));
 await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)");
 return db;
}
async function rpc(db:PGlite, p:any, e:any){return (await db.query<any>('SELECT public.cockpit_ceo_staffing_finalize($1::jsonb,$2::jsonb) AS result',[JSON.stringify(p),JSON.stringify(e)])).rows[0].result;}
async function imported(){const db=await fixture();const p=source();await db.query('SELECT public.cockpit_ceo_staffing_import($1::jsonb)',[JSON.stringify(p)]);return {db,p,e:evidence(p)};}

test.skipIf(!fixtureAvailable)('imported original status events are visible to the native history action',async()=>{const {db,p}=await imported();try{
  for(const status of p.statuses){
    const count=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM cockpit_audit_log WHERE entity_type='cockpit_team_status' AND entity_id=$1",[status.personKey])).rows[0].n;
    expect(count).toBe(p.audits.filter((a:any)=>a.rowId===status.personKey).length);
  }
}finally{await db.close();}});

test('finalizer does not block every writer on the large audit log',()=>{
  expect(migration('20261008i_cockpit_ceo_staffing_finalize.sql')).not.toMatch(/LOCK TABLE[^;]*cockpit_audit_log/i);
});

test.skipIf(!fixtureAvailable)('red: finalization requires exact frozen import and opens once',async()=>{const {db,p,e}=await imported();try{
 expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(false);
 expect(await rpc(db,p,e)).toEqual({history_ready:true,statuses:3,source_audits:5});
 expect(await rpc(db,p,e)).toEqual({history_ready:true,statuses:3,source_audits:5});
 expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(true);
 }finally{await db.close();}});

test.skipIf(!fixtureAvailable)('does not open before the scoped import',async()=>{const db=await fixture();try{
 const p=source();await expect(rpc(db,p,evidence(p))).rejects.toThrow();
 expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(false);
 }finally{await db.close();}});

test.skipIf(!fixtureAvailable)('parallel finalization calls are idempotent',async()=>{const {db,p,e}=await imported();try{
 const results=await Promise.all([rpc(db,p,e),rpc(db,p,e)]);
 expect(results).toEqual([{history_ready:true,statuses:3,source_audits:5},{history_ready:true,statuses:3,source_audits:5}]);
 expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(true);
 }finally{await db.close();}});

test.skipIf(!fixtureAvailable)('unrelated imported CEO audits do not block staffing finalization',async()=>{const {db,p,e}=await imported();try{
 await db.exec(`INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES('settings.setWorkingHours','settings','working_hours','test','media-buyer','convex',
 '{"source_table":"ceoAudit","source_record":{"table":"ceoSettings"},"source_id":"other-audit"}')`);
 expect(await rpc(db,p,e)).toEqual({history_ready:true,statuses:3,source_audits:5});
 }finally{await db.close();}});

test.skipIf(!fixtureAvailable)('rejects missing or inconsistent freeze evidence without opening',async()=>{const {db,p,e}=await imported();try{
 for(const bad of [{...e,prior_sha256:'0'.repeat(64)},{...e,audit_count:39},{...e,source_rows_equal:false},{...e,current_sha256:'0'.repeat(64)}])
  await expect(rpc(db,p,bad)).rejects.toThrow();
 expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(false);
 }finally{await db.close();}});

test.skipIf(!fixtureAvailable)('rejects tampered source payload, even with matching imported IDs',async()=>{const {db,p,e}=await imported();try{
 const bad=structuredClone(p);bad.statuses[0].note='not the frozen record';
 await expect(rpc(db,bad,e)).rejects.toThrow();
 expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(false);
 }finally{await db.close();}});

test.skipIf(!fixtureAvailable)('rejects extra, missing and contradictory rows and audits',async()=>{for(const change of [
  async(db:PGlite)=>db.exec("INSERT INTO cockpit_team_status(person_key,status,since,set_by) VALUES('other:person','active','2026-10-01','test')"),
  async(db:PGlite)=>db.exec("DELETE FROM cockpit_team_status WHERE person_key=(SELECT person_key FROM cockpit_team_status LIMIT 1)"),
  async(db:PGlite)=>db.exec("UPDATE cockpit_team_status SET note='contradiction' WHERE person_key=(SELECT person_key FROM cockpit_team_status LIMIT 1)"),
  async(db:PGlite)=>db.exec("INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('teamStatus.set','ceoTeamStatus','other:person','test','media-buyer','convex','{}')"),
  async(db:PGlite)=>db.exec("INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('teamStatus.set','ceoTeamStatus','other:person','test','media-buyer','convex','{\"source_table\":\"ceoAudit\"}')"),
 ]){const {db,p,e}=await imported();try{await owner(db);await change(db);await expect(rpc(db,p,e)).rejects.toThrow();expect((await db.query<any>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(false);}finally{await db.close();}}});

test.skipIf(!fixtureAvailable)('service role only, not authenticated, anon, or forged claim',async()=>{const {db,p,e}=await imported();try{
 for(const role of ['authenticated','anon']){await db.exec(`SET ROLE ${role}`);await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)");await expect(rpc(db,p,e)).rejects.toThrow();await owner(db);}
 await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)");await expect(rpc(db,p,e)).rejects.toThrow();
 }finally{await db.close();}});
