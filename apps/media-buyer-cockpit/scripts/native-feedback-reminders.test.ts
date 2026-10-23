import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,expect,test} from 'bun:test';
import {cockpitTestDb,migration,owner} from './lib/cockpitTestDb';
import type {PGlite} from '@electric-sql/pglite';
let db:PGlite;
const TOKEN='fictional-test-only-reminder-token-01234567890';
const call=async(token=TOKEN,location='locA')=>(await db.query<{v:any}>('select public.portal_reporting_reminder_gaps($1,$2) v',[token,location])).rows[0].v;
beforeAll(async()=>{
 db=await cockpitTestDb();
 await db.exec(readFileSync(new URL('./fixtures/feedback-test-schema.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./fixtures/canonical-outcome-accept.sql',import.meta.url),'utf8'));
 await db.exec(migration('20261023104525_client_appointment_feedback.sql'));
 await db.exec(`create table portal_data.workspaces(location_id text primary key); insert into portal_data.workspaces values('locA');
 create table public.ghl_clients(location_id text,status text); insert into public.ghl_clients values('locA','Active');
 create schema mahara_reporting;
 create table mahara_reporting.sync_jobs(namespace text,id text,source text,location_id text,kind text,cursor jsonb,run_at timestamptz,due_at timestamptz,lease_owner text,lease_until timestamptz,last_success timestamptz,last_complete timestamptz,error text,failures int default 0,pages int default 0,records int default 0,window_end timestamptz,primary key(namespace,id));
 create table mahara_reporting.facts(namespace text,source text,kind text,external_id text,data jsonb,conflict boolean default false,primary key(namespace,source,kind,external_id));
 create table mahara_reporting.inventory(namespace text,source text,kind text,external_id text,last_seen timestamptz,checked_at timestamptz,present boolean,primary key(namespace,source,kind,external_id));
 insert into mahara_reporting.sync_jobs(namespace,id,source,location_id,kind,last_complete) values('production','ghl:locA:appointments_recent','ghl','locA','appointments_recent',now());
 insert into mahara_reporting.facts(namespace,source,kind,external_id,data) values('production','ghl','calendar','locA:cal',jsonb_build_object('id','cal','locationId','locA','callback',false));
 `);
 await db.exec(readFileSync(new URL('./fixtures/reporting-sync.sql',import.meta.url),'utf8'));
 await db.exec(migration('20261023105854_native_feedback_delivery.sql'));
 await db.exec(migration('20261023111458_native_feedback_reminder_claim.sql'));
 await db.query("insert into portal_data.reporting_reader_config values('weekly-reporting-reminders',encode(sha256(convert_to($1,'UTF8')),'hex'),true,now()+interval '1 day',now())",[TOKEN]);
 for(const [id,status] of [['missing','confirmed'],['showed','showed'],['noshow','noshow'],['canceled','cancelled'],['future','confirmed']]){
  await db.query("insert into mahara_reporting.facts(namespace,source,kind,external_id,data) values('production','ghl','appointment',$1,jsonb_build_object('id',$2::text,'locationId','locA','contactId',$3::text,'calendarId','cal','startAt',now()+$4::interval,'status',$5::text))",['locA:'+id,id,'contact-'+id,id==='future'?'1 day':'-1 day',status]);
 }
 await db.exec("insert into mahara_reporting.inventory select namespace,source,kind,external_id,now(),now(),true from mahara_reporting.facts where kind='appointment'; set role anon");
},30000);
afterAll(async()=>await db?.close());
test('job token cannot be omitted or used for another workspace',async()=>{
 await expect(call('wrong')).rejects.toThrow();await expect(call(TOKEN,'locB')).rejects.toThrow();
 await expect(db.query('select * from portal_data.reporting_reader_config')).rejects.toThrow();
});
test('completion timestamp without verified scan start is incomplete',async()=>{
 expect(await call()).toMatchObject({complete:false,reason:'provider_snapshot_not_ready',showGaps:[],closeGaps:[]});
});
test('completed provider sync preserves its original scan start',async()=>{
 await owner(db);
 await db.exec("update mahara_reporting.sync_jobs set run_at=now()-interval '10 minutes',lease_owner='fictional-owner-at-least-twenty-characters',lease_until=now()+interval '1 minute'");
 await db.query("select public.mahara_reporting_sync('save',$1,'production')",[JSON.stringify({id:'ghl:locA:appointments_recent',owner:'fictional-owner-at-least-twenty-characters',records:[],complete:true})]);
 const row=(await db.query<any>("select source_complete_at < last_complete as real_start,run_at is null as finished from mahara_reporting.sync_jobs")).rows[0];
 expect(row).toEqual({real_start:true,finished:true});await db.exec('set role anon');
 const v=await call();expect(v.complete).toBe(true);expect(v.showGaps.map((x:any)=>x.appointmentId)).toEqual(['missing']);expect(v.closeGaps.map((x:any)=>x.appointmentId)).toEqual(['showed']);
});
test('accepted client feedback immediately stops the corresponding reminder without Sheet delivery',async()=>{
 const oldApproval=(await call()).approvalToken;
 await owner(db);
 await db.exec("insert into portal_data.appointments(location_id,appointment_id,contact_id,start_at) select 'locA',data->>'id',data->>'contactId',(data->>'startAt')::timestamptz from mahara_reporting.facts where kind='appointment' and data->>'id'='missing'");
 await db.exec("select public.portal_feedback_accept('locA','missing','50000000-0000-4000-8000-000000000001','{\"attendance\":\"showed\",\"deal\":\"pending\"}',now(),contact_id,start_at) from portal_data.appointments where location_id='locA' and appointment_id='missing'");
 await db.exec('set role anon');const v=await call();expect(v.showGaps).toEqual([]);expect(v.closeGaps.map((x:any)=>x.appointmentId)).toEqual(['showed']);
 const claim=(await db.query<any>('select public.portal_reporting_reminder_claim($1) v',[oldApproval])).rows[0].v;
 expect(claim).toEqual({allowed:false,reason:'feedback_changed'});
});
test('a reschedule cannot inherit feedback from an earlier occurrence',async()=>{
 await owner(db);await db.exec("update mahara_reporting.facts set data=jsonb_set(data,'{startAt}',to_jsonb(now()-interval '2 days')) where external_id='locA:missing'");await db.exec('set role anon');
 expect((await call()).showGaps.map((x:any)=>x.appointmentId)).toEqual(['missing']);
});
test('stale, failed, conflicting and incomplete source reads never produce reminder targets',async()=>{
 await owner(db);await db.exec("update mahara_reporting.sync_jobs set error='provider unavailable'");await db.exec('set role anon');expect(await call()).toMatchObject({complete:false,showGaps:[],closeGaps:[]});
 await owner(db);await db.exec("update mahara_reporting.sync_jobs set error=null,source_complete_at=now()-interval '3 hours'");await db.exec('set role anon');expect((await call()).complete).toBe(false);
 await owner(db);await db.exec("update mahara_reporting.sync_jobs set source_complete_at=now()-interval '1 hour'; update mahara_reporting.facts set conflict=true where external_id='locA:missing'");await db.exec('set role anon');expect(await call()).toMatchObject({complete:false,showGaps:[],closeGaps:[]});
 await owner(db);await db.exec("update mahara_reporting.facts set conflict=false; update mahara_reporting.inventory set checked_at=null where external_id='locA:missing'");await db.exec('set role anon');expect((await call()).complete).toBe(false);
});
test('approval must be current, fresh, unexpired and single-use even after a lost response',async()=>{
 await owner(db);await db.exec("update mahara_reporting.inventory set checked_at=now(); update mahara_reporting.sync_jobs set source_complete_at=now()-interval '1 hour',error=null");await db.exec('set role anon');
 const first=await call(),second=await call();expect(first.approvalToken).toMatch(/^native-[a-f0-9]{32}$/);expect(second.approvalToken).toBe(first.approvalToken);
 const claim=async(token:string)=>(await db.query<any>('select public.portal_reporting_reminder_claim($1) v',[token])).rows[0].v;
 expect(await claim('report-locA-2026-43')).toEqual({allowed:false,reason:'refresh_review'});
 await owner(db);await db.exec("update mahara_reporting.sync_jobs set error='provider failed'");await db.exec('set role anon');
 expect(await claim(first.approvalToken)).toEqual({allowed:false,reason:'source_unavailable'});
 await owner(db);await db.exec("update mahara_reporting.sync_jobs set error=null");await db.exec('set role anon');
 expect(await claim(first.approvalToken)).toMatchObject({allowed:true,locationId:'locA'});
 expect(await claim(first.approvalToken)).toEqual({allowed:false,reason:'already_claimed'});
 expect((await call()).approvalState).toBe('already_claimed');
});
test('rotated or expired credentials stop access immediately',async()=>{
 await owner(db);await db.exec("update portal_data.reporting_reader_config set expires_at=now()-interval '1 second'");await db.exec('set role anon');await expect(call()).rejects.toThrow();
});
