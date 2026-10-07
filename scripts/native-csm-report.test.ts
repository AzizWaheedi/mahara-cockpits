import {afterAll,beforeAll,beforeEach,expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';

const UID='51000000-0000-4000-8000-000000000001';
const OTHER='51000000-0000-4000-8000-000000000002';
const args={clientName:'Alpha',from:'2026-09-01',to:'2026-09-30',language:'en',note:'Reviewed facts',extras:[]};
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
async function call(name:string,params:Record<string,unknown>){const keys=Object.keys(params);return (await db.query<{value:any}>(`SELECT ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,Object.values(params))).rows[0].value;}
beforeAll(async()=>{
 db=await nativeFeedDb();
 await db.exec(migration('20260926a_cockpit_decision_details.sql'));
 if(existsSync(new URL('../supabase/migrations/20261007b_csm_report_generation.sql',import.meta.url)))await db.exec(migration('20261007b_csm_report_generation.sql'));
 await member(db,UID,'csm@tests.invalid',['csm']);await member(db,OTHER,'media@tests.invalid',['media_buyer']);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);
 const profile={_id:'profile-alpha',clientName:'Alpha',syncedAt:1,performance:{appointments:[],month:{leads:0,booked:0}},adLeads:{daily:[]}};
 await db.exec("UPDATE cockpit_csm_source_state SET ready=true,row_count=0,source_snapshot_at='2026-10-07T00:00:00Z';INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients','client-alpha',ARRAY['Alpha'],'{\"_id\":\"client-alpha\",\"name\":\"Alpha\",\"taskId\":\"cu-alpha\"}','2026-10-07T00:00:00Z');");
 await db.query("INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clientProfiles','profile-alpha',ARRAY['Alpha'],$1,'2026-10-07T00:00:00Z')",[profile]);
 await db.exec("UPDATE cockpit_csm_source_state SET row_count=1 WHERE table_name IN('clients','clientProfiles')");
});
beforeEach(async()=>{await owner(db);await db.exec('DELETE FROM cockpit_csm_actions');await db.query('UPDATE cockpit_members SET active=true,clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);await db.exec("UPDATE cockpit_csm_source_state SET ready=true,row_count=CASE WHEN table_name IN('clients','clientProfiles') THEN 1 ELSE 0 END");await actor(db,UID);});
afterAll(async()=>{await db?.close();});
test('report context uses the assigned client and confirmed actor',async()=>{
 const c=await call('cockpit_csm_report_context',{p_args:args});expect(c).toMatchObject({actorId:UID,email:'csm@tests.invalid',clientName:'Alpha',taskId:'cu-alpha'});expect(c.profile.performance.appointments).toEqual([]);
});
test('missing source counts cannot authorize a report',async()=>{
 await owner(db);await db.exec("UPDATE cockpit_csm_source_state SET row_count=2 WHERE table_name='clientProfiles'");await actor(db,UID);await expect(call('cockpit_csm_report_context',{p_args:args})).rejects.toThrow();
});
test('wrong role, unassigned client, revoked user and browser identity fields are denied',async()=>{
 await actor(db,OTHER);await expect(call('cockpit_csm_report_context',{p_args:args})).rejects.toThrow();await actor(db,UID);
 await expect(call('cockpit_csm_report_context',{p_args:{...args,clientName:'Beta'}})).rejects.toThrow();
 await expect(call('cockpit_csm_report_context',{p_args:{...args,actorId:OTHER}})).rejects.toThrow();
 await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);await actor(db,UID);await expect(call('cockpit_csm_report_context',{p_args:args})).rejects.toThrow();
});
test('dry-run creates no report intent or audit row',async()=>{
 await owner(db);const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM cockpit_audit_log')).rows[0].n;await actor(db,UID);
 expect(await call('cockpit_csm_report_begin',{p_args:args,p_request_id:crypto.randomUUID(),p_apply:false})).toMatchObject({state:'dry_run'});
 await owner(db);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM cockpit_csm_actions')).rows[0].n).toBe(0);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM cockpit_audit_log')).rows[0].n).toBe(before);
});
test('a lost response and a new browser id reuse the original intent',async()=>{
 const id=crypto.randomUUID();expect(await call('cockpit_csm_report_begin',{p_args:args,p_request_id:id,p_apply:true})).toMatchObject({state:'new',id});
 expect(await call('cockpit_csm_report_begin',{p_args:args,p_request_id:id,p_apply:true})).toMatchObject({state:'sending',id});
 expect(await call('cockpit_csm_report_begin',{p_args:args,p_request_id:crypto.randomUUID(),p_apply:true})).toMatchObject({state:'sending',id});
 await expect(call('cockpit_csm_report_begin',{p_args:{...args,note:'Changed'},p_request_id:id,p_apply:true})).rejects.toThrow();
});
const receipt={ok:true,docId:'document_alpha_123456',docUrl:'https://docs.google.com/document/d/document_alpha_123456/edit',title:'Alpha report',contentReadbackVerified:true,sharingVerified:true};
test('only complete provider evidence can finish and authenticated users cannot finish',async()=>{
 const id=crypto.randomUUID();await call('cockpit_csm_report_begin',{p_args:args,p_request_id:id,p_apply:true});
 await expect(call('cockpit_csm_report_finish',{p_id:id,p_result:receipt})).rejects.toThrow();await owner(db);
 await expect(call('cockpit_csm_report_finish',{p_id:id,p_result:{...receipt,sharingVerified:false}})).rejects.toThrow();
 await expect(call('cockpit_csm_report_finish',{p_id:id,p_result:{...receipt,docUrl:'https://example.com/report'}})).rejects.toThrow();
 expect(await call('cockpit_csm_report_finish',{p_id:id,p_result:receipt})).toMatchObject({ok:true,receiptId:id});
 await actor(db,UID);expect(await call('cockpit_csm_report_begin',{p_args:args,p_request_id:crypto.randomUUID(),p_apply:true})).toMatchObject({state:'confirmed',id});
 const history=await call('cockpit_csm_report_history',{p_client_name:'Alpha'});expect(history[0]).toMatchObject({docUrl:receipt.docUrl,clientName:'Alpha'});expect(history[0].builtAt).toBeGreaterThan(0);
});
test('revocation after document creation prevents confirmation and preserves the checkpoint',async()=>{
 const id=crypto.randomUUID();await call('cockpit_csm_report_begin',{p_args:args,p_request_id:id,p_apply:true});await owner(db);
 await db.query("UPDATE cockpit_csm_actions SET result=$1,state='reconcile' WHERE id=$2",[{phase:'created',docId:receipt.docId},id]);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);
 await expect(call('cockpit_csm_report_finish',{p_id:id,p_result:receipt})).rejects.toThrow();
 expect((await db.query<{state:string,result:any}>('SELECT state,result FROM cockpit_csm_actions WHERE id=$1',[id])).rows[0]).toMatchObject({state:'reconcile',result:{docId:receipt.docId}});
});
