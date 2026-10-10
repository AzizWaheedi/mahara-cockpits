import {afterEach,beforeEach,expect,test} from 'bun:test';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';

// The scheduled onboarding sync's database side (20261009b): one cron run at a
// time, resume, and the merge rules of the bulk publish. Run:
// bun test scripts/native-onboarding-sync.test.ts

const UID='50000000-0000-4000-8000-000000000002';
// pg_cron is not in the test engine; this stands in for cron.schedule/unschedule only.
const CRON_STUB=`CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text,schedule text,command text);
CREATE OR REPLACE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid$$;
CREATE OR REPLACE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=p_id RETURNING true$$;`;
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
beforeEach(async()=>{
 db=await nativeFeedDb();
 for(const name of ['20260921e_tap_charges.sql','20261005a_client_onboarding.sql','20261006c_csm_onboarding_checkins.sql'])await db.exec(migration(name));
 await db.exec(CRON_STUB);await db.exec(migration('20261009b_onboarding_native_sync.sql'));
 await member(db,UID,'onboarding-sync@tests.invalid',['csm']);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha','Beta'],UID]);
 await db.exec(`UPDATE cockpit_csm_source_state SET ready=true,row_count=2,source_snapshot_at=now() WHERE table_name='clients';
  INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients',x.id,ARRAY[x.name],jsonb_build_object('_id',x.id,'name',x.name,'taskId',x.task),source_snapshot_at
   FROM cockpit_csm_source_state,(VALUES('alpha','Alpha','cu-alpha'),('beta','Beta','cu-beta')) x(id,name,task) WHERE table_name='clients';
  INSERT INTO cockpit_client_onboarding(clickup_task_id,client_name,links) VALUES('cu-alpha','Alpha','{"drive":"https://drive.google.com/fixture"}')`);
});
afterEach(async()=>{await db.close();});

type Json=Record<string,any>;
async function service<T=Json>(sql:string,params:unknown[]=[]):Promise<T>{await db.exec('RESET ROLE');await db.exec('SET ROLE service_role');try{return (await db.query<{v:T}>(sql,params)).rows[0].v;}finally{await db.exec('RESET ROLE');}}
const begin=()=>service('SELECT public.cockpit_csm_onboarding_cron_begin() v');
const publish=(run:number,rows:unknown[],verified:boolean)=>service('SELECT public.cockpit_csm_onboarding_cron_publish($1,$2::jsonb,$3) v',[run,JSON.stringify(rows),verified]);
const row=(id:string,name:string,extra:Json={})=>({clickup_task_id:id,client_name:name,clickup_status:'on boarding',client_status:'Needs Contacting',in_onboarding:true,csm:null,signup_on:'2026-10-01',onboarding_call_on:null,launch_on:null,links:{clickup:`https://app.clickup.com/t/${id}`},handover:{},sales_transcript:null,card_updated_at:'2026-10-08T10:00:00.000Z',seen_at:'2026-10-09T10:04:00.000Z',synced_at:'2026-10-09T10:04:00.000Z',...extra});
async function one<T=Json>(sql:string,params:unknown[]=[]):Promise<T>{await owner(db);return (await db.query<T>(sql,params)).rows[0];}
const audits=async()=>(await one<{n:number}>("SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='cockpit_client_onboarding'")).n;

test('one scheduled run at a time, and a dead run is closed as failed',async()=>{
 const first=await begin();expect(first).toMatchObject({busy:false,resumePage:0});
 expect(await begin()).toEqual({busy:true});
 await one("UPDATE cockpit_client_onboarding_runs SET started_at=now()-interval '6 minutes' WHERE id=$1 RETURNING id",[first.run]);
 const second=await begin();expect(second).toMatchObject({busy:false,resumePage:0});
 expect(await one('SELECT ok,problem,finished_at IS NOT NULL closed,trigger FROM cockpit_client_onboarding_runs WHERE id=$1',[first.run])).toEqual({ok:false,closed:true,trigger:'cron',problem:'The scheduled onboarding sync stopped before it finished. The next run starts again from the first page.'});
});

test('a run continues from the page where a recent run ran out of time, never an old one',async()=>{
 const first=await begin();
 await one(`UPDATE cockpit_client_onboarding_runs SET finished_at=now(),ok=false,counts=counts||'{"resume_page":4}' WHERE id=$1 RETURNING id`,[first.run]);
 const second=await begin();expect(second.resumePage).toBe(4);
 expect(await one('SELECT counts FROM cockpit_client_onboarding_runs WHERE id=$1',[second.run])).toEqual({counts:{start_page:4}});
 await one(`UPDATE cockpit_client_onboarding_runs SET finished_at=now()-interval '31 minutes',ok=false,counts='{"resume_page":2}' WHERE id=$1 RETURNING id`,[second.run]);
 expect((await begin()).resumePage).toBe(0);
});

test('new rows are written, unchanged rows are not rewritten, and forms change only when Typeform was read',async()=>{
 const {run}=await begin();const before=await audits();
 const forms={onboarding:{form_id:'KFRCXPFx',response_id:'r1',submitted_at:'2026-10-01T10:00:00Z',answers:[]}};
 expect(await publish(run,[row('cu-alpha','Alpha',{forms}),row('cu-gamma','Gamma',{forms:{}})],true)).toEqual({written:2,unchanged:0,identitySkipped:0});
 expect(await audits()).toBe(before+2);
 expect(await publish(run,[row('cu-alpha','Alpha',{forms}),row('cu-gamma','Gamma',{forms:{}})],true)).toEqual({written:0,unchanged:2,identitySkipped:0});
 expect(await audits()).toBe(before+2);
 // Typeform unread: the card change lands, the forms stay.
 expect(await publish(run,[row('cu-alpha','Alpha',{csm:'Sara'})],false)).toMatchObject({written:1});
 expect(await one("SELECT csm,forms,links FROM cockpit_client_onboarding WHERE clickup_task_id='cu-alpha'")).toEqual({csm:'Sara',forms,links:{clickup:'https://app.clickup.com/t/cu-alpha'}});
 expect(await publish(run,[row('cu-alpha','Alpha',{csm:'Sara',forms:{}})],false)).toMatchObject({written:0,unchanged:1});
 // Typeform read in full: an empty answer set replaces the old one.
 expect(await publish(run,[row('cu-alpha','Alpha',{csm:'Sara',forms:{}})],true)).toMatchObject({written:1});
 expect((await one<{forms:Json}>("SELECT forms FROM cockpit_client_onboarding WHERE clickup_task_id='cu-alpha'")).forms).toEqual({});
 // A new card while Typeform is unread starts with no forms rather than unverified ones.
 await publish(run,[row('cu-delta','Delta',{forms})],false);
 expect((await one<{forms:Json}>("SELECT forms FROM cockpit_client_onboarding WHERE clickup_task_id='cu-delta'")).forms).toEqual({});
});

test('a card the roster names differently is not written, so the CSM read keeps working',async()=>{
 const {run}=await begin();
 expect(await publish(run,[row('cu-alpha','Alpha Renamed'),row('cu-beta','beta '),row('cu-omega','Omega')],true)).toEqual({written:2,unchanged:0,identitySkipped:1});
 expect(await one("SELECT client_name,links FROM cockpit_client_onboarding WHERE clickup_task_id='cu-alpha'")).toEqual({client_name:'Alpha',links:{drive:'https://drive.google.com/fixture'}});
 await actor(db,UID);const read=(await db.query<{v:Json}>('SELECT public.cockpit_csm_onboarding_read($1) v',[['cu-alpha','cu-beta']])).rows[0].v;
 expect(read.rows.map((r:Json)=>r.client_name)).toEqual(['Alpha','beta ']);
});

test('the publish refuses a closed run, a one-card run, repeated cards and unreadable rows',async()=>{
 const {run}=await begin();
 await expect(publish(run,[row('cu-x','X'),row('cu-x','X')],true)).rejects.toThrow('appears twice');
 await expect(publish(run,[row('bad id!','X')],true)).rejects.toThrow('card id and a name');
 await expect(publish(run,[row('cu-x','  ')],true)).rejects.toThrow('card id and a name');
 await expect(publish(run,[],true)).rejects.toThrow('between 1 and 100');
 await expect(publish(run,Array.from({length:101},(_,i)=>row(`cu-${i}`,`C${i}`)),true)).rejects.toThrow('between 1 and 100');
 const manual=(await one<{id:number}>("INSERT INTO cockpit_client_onboarding_runs(trigger,actor_email) VALUES('one','csm@tests.invalid') RETURNING id")).id;
 await expect(publish(manual,[row('cu-x','X')],true)).rejects.toThrow('not open');
 await one('UPDATE cockpit_client_onboarding_runs SET finished_at=now(),ok=true WHERE id=$1 RETURNING id',[run]);
 await expect(publish(run,[row('cu-x','X')],true)).rejects.toThrow('not open');
 expect((await one<{n:number}>("SELECT count(*)::int n FROM cockpit_client_onboarding WHERE clickup_task_id='cu-x'")).n).toBe(0);
});

test('only the service role may run the scheduled sync',async()=>{
 await actor(db,UID);await expect(db.query('SELECT public.cockpit_csm_onboarding_cron_begin()')).rejects.toThrow();
 await actor(db,null);await expect(db.query("SELECT public.cockpit_csm_onboarding_cron_publish(1,'[]'::jsonb,true)")).rejects.toThrow();
});

test('the schedule is installed once, every 10 minutes, with the vault secret',async()=>{
 await owner(db);await db.exec(migration('20261009b_onboarding_native_sync.sql'));
 const jobs=(await db.query<{schedule:string;command:string}>("SELECT schedule,command FROM cron.job WHERE jobname='mahara-onboarding-sync'")).rows;
 expect(jobs.length).toBe(1);expect(jobs[0].schedule).toBe('4-59/10 * * * *');
 for(const part of ["https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/onboarding-sync","'x-cron-secret'","name='cockpit_sync_secret'","body := '{}'::jsonb","timeout_milliseconds := 150000"])expect(jobs[0].command).toContain(part);
});
