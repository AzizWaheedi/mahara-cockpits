import {afterEach,beforeEach,expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
const UID='50000000-0000-4000-8000-000000000001';let db:Awaited<ReturnType<typeof nativeFeedDb>>;
beforeEach(async()=>{
 db=await nativeFeedDb();await db.exec(migration('20261005a_client_onboarding.sql'));await member(db,UID,'onboarding@tests.invalid',['csm']);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);
 await db.exec("UPDATE cockpit_csm_source_state SET ready=true,row_count=1,source_snapshot_at=now() WHERE table_name='clients';INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','alpha',ARRAY['Alpha'],'{\"_id\":\"alpha\",\"name\":\"Alpha\",\"taskId\":\"cu-alpha\"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';INSERT INTO cockpit_client_onboarding(clickup_task_id,client_name,links) VALUES('cu-alpha','Alpha','{\"drive\":\"https://drive.google.com/fixture\"}')");
 if(existsSync(new URL('../supabase/migrations/20261006c_csm_onboarding_checkins.sql',import.meta.url)))await db.exec(migration('20261006c_csm_onboarding_checkins.sql'));
});
afterEach(async()=>{await db.close();});
async function call(name:string,args:Record<string,unknown>){const keys=Object.keys(args);return(await db.query<{value:unknown}>(`SELECT ${name}(${keys.map((key,index)=>`${key}=>$${index+1}`).join(',')}) value`,Object.values(args))).rows[0].value;}
test('assigned client retains its original links and unavailable sync evidence',async()=>{
 await actor(db,UID);let result:unknown;try{result=await call('cockpit_csm_onboarding_read',{p_task_ids:['cu-alpha']});}catch{result=null;}
 expect(result).toMatchObject({rows:[{client_name:'Alpha',links:{drive:'https://drive.google.com/fixture'}}],last:null,lastOk:null});
});
test('another client and revoked actor cannot read onboarding links',async()=>{
 await owner(db);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Beta'],UID]);await actor(db,UID);await expect(call('cockpit_csm_onboarding_read',{p_task_ids:['cu-alpha']})).rejects.toThrow();
 await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);await actor(db,UID);await expect(call('cockpit_csm_onboarding_read',{p_task_ids:[]})).rejects.toThrow();
});
test('incomplete client roster cannot authorize a refresh',async()=>{
 await owner(db);await db.exec("UPDATE cockpit_csm_source_state SET row_count=2 WHERE table_name='clients'");await actor(db,UID);await expect(call('cockpit_csm_client_gate',{p_task_id:'cu-alpha'})).rejects.toThrow();
});
test('ordinary booking scope does not require a renewal date',async()=>{
 await actor(db,UID);let result:unknown;try{result=await call('cockpit_csm_client_gate',{p_task_id:'cu-alpha'});}catch{result=null;}
 expect(result).toMatchObject({actorId:UID,taskId:'cu-alpha',clientName:'Alpha'});
});
test('same booking intent is retained and another request cannot create the same slot',async()=>{
 await actor(db,UID);const requestId=crypto.randomUUID(),args={taskId:'cu-alpha',contactId:'contact-alpha',startTime:'2026-10-07T09:00:00Z'};
 let claimed:unknown;try{claimed=await call('cockpit_csm_check_in_begin',{p_args:args,p_request_id:requestId,p_apply:true});}catch{claimed=null;}
 expect(claimed).toMatchObject({state:'new',id:requestId});
 expect(await call('cockpit_csm_check_in_begin',{p_args:args,p_request_id:crypto.randomUUID(),p_apply:true})).toMatchObject({state:'sending',id:requestId});
});
test('a late real booking receipt stays private after client access is revoked',async()=>{
 await actor(db,UID);const requestId=crypto.randomUUID(),args={taskId:'cu-alpha',contactId:'contact-alpha',startTime:'2026-10-07T09:00:00Z'};
 await call('cockpit_csm_check_in_begin',{p_args:args,p_request_id:requestId,p_apply:true});
 await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);
 await db.exec('SET ROLE service_role');
 await call('cockpit_csm_check_in_capture',{p_id:requestId,p_result:{appointmentId:'real-provider-appointment',startTime:args.startTime,endTime:'2026-10-07T09:30:00Z',contactId:args.contactId,calendarId:'SHjlq0UjeR11maltYNyh',locationId:'wwG426bwruWWv9W3fazQ'}});
 await owner(db);const saved=(await db.query<{state:string;result:{appointmentId:string}}>('SELECT state,result FROM cockpit_csm_actions WHERE id=$1',[requestId])).rows[0];
 expect(saved.state).toBe('reconcile');expect(saved.result.appointmentId).toBe('real-provider-appointment');
 expect((await db.query<{count:number}>('SELECT count(*)::int count FROM cockpit_csm_client_overrides')).rows[0].count).toBe(0);
});
