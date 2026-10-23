import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,expect,test} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
import type {PGlite} from '@electric-sql/pglite';
let db:PGlite;
const USER='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002',OFF='00000000-0000-4000-8000-000000000003';
const FILE='20261023104525_client_appointment_feedback.sql';
const read=async(args:any[]=['locA',null,null,25,0,null])=>(await db.query<{v:any}>('select public.cockpit_client_appointment_feedback($1,$2,$3,$4,$5,$6) v',args)).rows[0].v;
beforeAll(async()=>{
 db=await cockpitTestDb({supabaseDefaultPrivileges:true});
 const seat=migration('20261007d_cockpit_team_rpc_restore.sql').match(/create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/)![0];
 const access=migration('20261017b_team_only_seats.sql');
 await db.exec(seat);
 await db.exec(access.match(/CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/)![0]);
 await db.exec(access.match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?\$function\$;/)![0]);
 await db.exec(`create schema portal_data;
 create table public.cockpit_board_clients(location_id text primary key,clickup_id text,client_name text);
 create table portal_data.appointments(location_id text,appointment_id text,contact_id text,start_at timestamptz,calendar_id text,deleted_at timestamptz,ad_name text,campaign_name text,primary key(location_id,appointment_id));
 create table portal_data.contacts(location_id text,contact_id text,name text,primary key(location_id,contact_id));
 create table portal_data.appointment_outcomes(location_id text,appointment_id text,revision bigint,attendance text,deal text,lead_quality numeric,feedback text,consultation_feedback text,not_closed_reason text,captured_at timestamptz default now(),source text,request_id text,quotation boolean,project_value numeric,currency text,source_record_id text,source_updated_at timestamptz,primary key(location_id,appointment_id,revision));
 create table portal_data.outbox(location_id text,request_id text,operation text,object_id text,expected_revision text,state text,payload jsonb,next_attempt_at timestamptz,created_at timestamptz,last_error text);
 create table portal_data.journey_outcome_bindings(location_id text,appointment_id text,revision bigint,start_at timestamptz,contact_id text);
 insert into public.cockpit_board_clients values('locA','taskA','Client A'),('locB','taskB','Client B');
 insert into portal_data.appointments values('locA','same-id','leadA','2026-10-20T10:00Z',null,null,'Ad A','Campaign A'),('locB','same-id','leadB','2026-10-20T10:00Z',null,null,null,null);
 insert into portal_data.contacts values('locA','leadA','Fictional A'),('locB','leadB','Fictional B');
 insert into portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,lead_quality,feedback,source,request_id) values
 ('locA','same-id',1,'showed',7,'Original client words','portal-capture',null),
 ('locA','same-id',2,null,9,'ملاحظة العميل','portal','req2'),
 ('locA','same-id',3,null,null,'STALE CAPTURE MUST NOT REPLACE','reporting-capture',null),
 ('locA','same-id',4,'no_show',1,'UNBOUND MUST NOT APPEAR','portal','missing'),
 ('locB','same-id',1,'no_show',10,'Other client words','portal-capture',null);
 insert into portal_data.journey_outcome_bindings select location_id,appointment_id,revision,'2026-10-20T10:00Z',case when location_id='locA' then 'leadA' else 'leadB' end from portal_data.appointment_outcomes;
 insert into portal_data.outbox(location_id,request_id,operation,object_id,expected_revision,state) values('locA','req2','appointment-outcome','same-id','2','pending');
 `);
 await db.exec(readFileSync(new URL('./fixtures/canonical-outcome-accept.sql',import.meta.url),'utf8'));
 await db.exec(migration(FILE));
 await member(db,USER,'csm@tests.invalid',['csm']);
 await member(db,OTHER,'other@tests.invalid',['creative']);
 await member(db,OFF,'off@tests.invalid',['media_buyer'],false);
 await db.query('update public.cockpit_members set clients=$1 where auth_user_id=$2',[['Client A'],USER]);
 await db.query('update public.cockpit_members set clients=$1 where auth_user_id=$2',[['Client B'],OTHER]);
 await actor(db,USER);
},30000);
afterAll(async()=>{await db?.close()});
test('pending client feedback is immediate, sparse fields persist, captures do not overwrite',async()=>{
 const v=await read();expect(v.locationId).toBe('locA');expect(v.total).toBe(1);
 expect(v.items[0]).toMatchObject({appointmentId:'same-id',contactName:'Fictional A',attendance:'showed',leadQuality:9,feedback:'ملاحظة العميل',deliveryState:'pending',source:'portal'});
});
test('exact ClickUp ID resolves, contradictory IDs and other client are refused',async()=>{
 expect((await read([null,null,null,25,0,'taskA'])).locationId).toBe('locA');
 await expect(read(['locA',null,null,25,0,'taskB'])).rejects.toThrow();
 await expect(read(['locB',null,null,25,0,null])).rejects.toThrow();
});
test('no-show ratings never appear and client IDs cannot collide',async()=>{
 await actor(db,OTHER);const v=await read(['locB',null,null,25,0,null]);expect(v.items[0].leadQuality).toBeNull();expect(v.items[0].feedback).toBe('Other client words');await actor(db,USER);
});
test('empty period is distinct from denied access and page bounds enforced',async()=>{
 expect((await read(['locA','2026-10-21','2026-10-22',25,0,null])).items).toEqual([]);
 expect((await read(['locA',null,null,1,1,null])).total).toBe(1);
 for(const args of [['locA',null,null,101,0,null],['locA',null,null,0,0,null],['locA','2026-10-22','2026-10-21',25,0,null]]) await expect(read(args)).rejects.toThrow();
});
test('anonymous, inactive, and direct private table reads are denied',async()=>{
 await expect(db.query('select * from portal_data.appointment_outcomes')).rejects.toThrow();
 await actor(db,null);await expect(read()).rejects.toThrow();
 await actor(db,OFF);await expect(read()).rejects.toThrow();await actor(db,USER);
});
test('review status remains visible without claiming delivery',async()=>{
 await owner(db);await db.exec("update portal_data.outbox set state='review' where request_id='req2'");await actor(db,USER);expect((await read()).items[0].deliveryState).toBe('review');
});
test('duplicate task mapping fails closed',async()=>{
 await owner(db);await db.exec("insert into public.cockpit_board_clients values('locC','taskA','Client C')");await actor(db,USER);await expect(read([null,null,null,25,0,'taskA'])).rejects.toThrow();
});

test('direct acceptance is atomic, exact occurrence bound and safe after lost response',async()=>{
 await owner(db);
 await db.exec("insert into portal_data.appointments(location_id,appointment_id,contact_id,start_at) values('locA','direct','leadA','2026-10-20T10:00Z')");
 const args=['locA','direct','10000000-0000-4000-8000-000000000001',JSON.stringify({feedback:'A direct report',attendance:'showed',lead_quality:8}),new Date().toISOString(),'leadA','2026-10-20T10:00Z'];
 const accept=async(a:any[]=args)=>(await db.query<{v:any}>('select public.portal_feedback_accept($1,$2,$3,$4,$5,$6,$7) v',a)).rows[0].v;
 const first=await accept();expect(first).toMatchObject({revision:1,state:'pending',unchanged:false});
 expect(await accept()).toMatchObject({revision:1,unchanged:true});
 await expect(accept([...args.slice(0,5),'another-lead',args[6]])).rejects.toThrow('outcome_binding_changed');
 await expect(accept([args[0],args[1],args[2],JSON.stringify({feedback:'Different'}),...args.slice(4)])).rejects.toThrow('outcome_idempotency_conflict');
 await db.exec("update portal_data.appointments set start_at='2026-10-22T10:00Z' where appointment_id='direct'");
 expect(await accept()).toMatchObject({revision:1,unchanged:true});
 await expect(accept([args[0],args[1],'10000000-0000-4000-8000-000000000002',...args.slice(3)])).rejects.toThrow('outcome_binding_changed');
 expect((await db.query('select count(*)::int n from portal_data.outcome_occurrences')).rows[0]).toEqual({n:1});
 await actor(db,USER);const report=(await read()).items.find((i:any)=>i.appointmentId==='direct');
 expect(report.startAt).toBe('2026-10-20T10:00:00+00:00');expect(report.feedback).toBe('A direct report');
 await expect(accept()).rejects.toThrow();
});
test('direct acceptance refuses missing/deleted/cross-client appointments and no-show score',async()=>{
 await owner(db);
 await db.exec("insert into portal_data.appointments(location_id,appointment_id,contact_id,start_at,deleted_at) values('locA','deleted','leadA','2026-10-20T10:00Z',now()),('locA','noscore','leadA','2026-10-20T10:00Z',null)");
 const accept=(location:string,id:string,payload:any)=>db.query('select public.portal_feedback_accept($1,$2,$3,$4,now(),$5,$6)',[location,id,'20000000-0000-4000-8000-000000000001',JSON.stringify(payload),'leadA','2026-10-20T10:00Z']);
 await expect(accept('locB','noscore',{feedback:'wrong client'})).rejects.toThrow('appointment_not_in_canonical_store');
 await expect(accept('locA','deleted',{feedback:'deleted'})).rejects.toThrow('outcome_binding_changed');
 await expect(accept('locA','noscore',{attendance:'no_show',lead_quality:7})).rejects.toThrow('invalid_outcome_payload');
 expect((await db.query("select count(*)::int n from portal_data.appointment_outcomes where appointment_id in('deleted','noscore')")).rows[0]).toEqual({n:0});
 await actor(db,USER);
});

test('historical unbound feedback is retained without borrowing a rescheduled occurrence',async()=>{
 await owner(db);
 await db.exec("insert into portal_data.appointments(location_id,appointment_id,contact_id,start_at) values('locA','history','leadA','2026-10-22T10:00Z'); insert into portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,feedback,source) values('locA','history',1,'no_show','Historical words','portal-capture')");
 await actor(db,USER);
 const historical=(await read()).items.find((i:any)=>i.appointmentId==='history');
 expect(historical).toMatchObject({startAt:null,contactId:null,occurrenceVerified:false,feedback:'Historical words'});
 await owner(db);
 // An old, unbound no-show must not veto a score for a different occurrence.
 await db.query('select public.portal_feedback_accept($1,$2,$3,$4,now(),$5,$6)', ['locA','history','30000000-0000-4000-8000-000000000001',JSON.stringify({lead_quality:8}),'leadA','2026-10-22T10:00Z']);
 await actor(db,USER);
 const rows=(await read()).items.filter((i:any)=>i.appointmentId==='history');
 expect(rows.length).toBe(2);expect(rows.find((i:any)=>i.occurrenceVerified)).toMatchObject({leadQuality:8,attendance:null,feedback:null});
});

test('quality-only update cannot score a confirmed no-show and malformed patches are rejected',async()=>{
 await owner(db);
 await db.exec("insert into portal_data.appointments(location_id,appointment_id,contact_id,start_at) values('locA','confirmed-noshow','leadA','2026-10-20T10:00Z')");
 const accept=(request:string,payload:any)=>db.query('select public.portal_feedback_accept($1,$2,$3,$4,now(),$5,$6)',['locA','confirmed-noshow',request,JSON.stringify(payload),'leadA','2026-10-20T10:00Z']);
 await accept('40000000-0000-4000-8000-000000000001',{attendance:'no_show'});
 await db.exec("update portal_data.outbox set state='succeeded' where object_id='confirmed-noshow'");
 await expect(accept('40000000-0000-4000-8000-000000000002',{lead_quality:4})).rejects.toThrow('invalid_outcome_payload');
 for(const payload of [null,{},[],{feedback:null}]) await expect(accept('40000000-0000-4000-8000-000000000003',payload)).rejects.toThrow('invalid_outcome_payload');
 await actor(db,USER);
});
