import {executeCsmAction} from '../src/lib/csmActionClient';
import {beforeAll,afterAll,expect,test} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from '../../media-buyer-cockpit/scripts/lib/cockpitTestDb';
import {buildCsmReadModel,csmChurn,currentCsmProfiles} from '../src/lib/csmReadModel';
import {prepareCsm,executeCsm} from '../../../supabase/functions/cockpit-csm-api/core';
let db:Awaited<ReturnType<typeof cockpitTestDb>>;
const A='00000000-0000-4000-8000-000000000001',ALL='00000000-0000-4000-8000-000000000002',ADMIN='00000000-0000-4000-8000-000000000003',OTHER='00000000-0000-4000-8000-000000000004';
const at='2026-09-27T12:00:00Z';
async function source(table:string,data:any,names:string[]=[],stamp=at){await db.query('INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,$5)',[table,data._id,names,data,stamp]);}
async function read(){return (await db.query<any>('SELECT cockpit_csm_source_read() AS result')).rows[0].result;}
beforeAll(async()=>{
 db=await cockpitTestDb();await db.exec('CREATE TABLE public.clients(id uuid PRIMARY KEY)');
 const domain=migration('20260923o_cockpit_domain_tables.sql');
 for(const name of ['cockpit_client_profiles','cockpit_campaigns','cockpit_ads','cockpit_decisions']){const ddl=domain.match(new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+name+' \\([\\s\\S]*?\\n\\);'));expect(ddl).not.toBeNull();await db.exec(ddl![0]);await db.exec('ALTER TABLE '+name+' ENABLE ROW LEVEL SECURITY');}
 const plan=migration('20260923p_cockpit_actions_and_rpcs.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_plan_items \([\s\S]*?\n\);/);await db.exec(plan![0]);await db.exec('ALTER TABLE cockpit_plan_items ENABLE ROW LEVEL SECURITY');
 await db.exec(migration('20260926m_cockpit_csm_state.sql'));await db.exec(migration('20260926a_cockpit_decision_details.sql'));await db.exec(migration('20260927v_csm_read_models.sql'));
 await member(db,A,'csm-a@tests.invalid',['csm','media_buyer']);await member(db,ALL,'csm-all@tests.invalid',['csm','media_buyer']);await member(db,ADMIN,'admin@tests.invalid',['admin']);await member(db,OTHER,'other@tests.invalid',['sales']);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[[' client a '],A]);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Client B'],ADMIN]);
 for(const [n,key] of [['Client A','a'],['Client B','b']]){
  await source('clients',{_id:'client-'+key,name:n,taskId:'task-'+key,stage:'Paused',rank:10,level:'red',hot:[{kind:'review'}],loose:['Arrange call','Invoice overdue'],newSignup:false,bucket:'management',syncedAt:100},[n]);
  await db.query('INSERT INTO cockpit_client_profiles(client_name) VALUES($1)',[n]);await db.query('INSERT INTO cockpit_campaigns(client_name,raw_data) VALUES($1,$2)',[n,{name:'Campaign '+key}]);await db.query('INSERT INTO cockpit_ads(campaign_name,ad_name) VALUES($1,$2)',['Campaign '+key,'Ad '+key]);
 }
 await db.exec("INSERT INTO cockpit_ads(campaign_name,ad_name) VALUES('Unmapped','Unknown')");
 await source('csTasks',{_id:'task-global',name:'A team task',taskId:'team-task',status:'open'});
 await source('rosterDays',{_id:'day1',day:'2026-09-01',month:'2026-09',clients:[{key:'task-a',name:'Client A',paying:true,status:'Active'},{key:'task-b',name:'Client B',paying:true,status:'Active'}],total:2,paying:2});
 await source('rosterDays',{_id:'day2',day:'2026-09-27',month:'2026-09',clients:[{key:'task-a',name:'Client A',paying:false,status:'Paused'},{key:'task-b',name:'Client B',paying:false,status:'Stopped'}],total:2,paying:0});
 await source('churnEvents',{_id:'event-b',month:'2026-09',key:'task-b',name:'Client B',day:'2026-09-27',kind:'lost'},['Client B']);
 await source('syncRuns',{_id:'run',at:100,role:'csm',kind:'health',ok:true,profiles:2,errors:[]});
 await source('decisions',{_id:'decision-a',role:'csm',day:'2026-09-05',subject:'Client A',action:'review conversation had',kind:'approved'},['Client A']);
 await db.query('UPDATE cockpit_csm_source_state s SET ready=true,row_count=(SELECT count(*) FROM cockpit_csm_sources r WHERE r.table_name=s.table_name),source_snapshot_at=$1',[at]);
},15000);
afterAll(async()=>{await db.close();});
test('client scopes protect direct ads, campaigns, profiles and nested roster',async()=>{
 await actor(db,A);expect((await db.query<any>('SELECT client_name FROM cockpit_campaigns')).rows.map(r=>r.client_name)).toEqual(['Client A']);expect((await db.query<any>('SELECT ad_name FROM cockpit_ads')).rows.map(r=>r.ad_name)).toEqual(['Ad a']);expect((await db.query<any>('SELECT client_name FROM cockpit_client_profiles')).rows.map(r=>r.client_name)).toEqual(['Client A']);
 const data=await read();expect(data.tables.clients.map((r:any)=>r.name)).toEqual(['Client A']);expect(data.tables.rosterDays.every((r:any)=>r.clients.length===1&&r.total===1)).toBe(true);expect(data.tables.churnEvents).toEqual([]);expect(data.tables.csTasks).toEqual([]);expect(data.tables.kpi).toEqual([]);expect(data.source.tables.kpi.rows).toBe(0);expect(data.tables.syncRuns[0].profiles).toBeUndefined();
 await actor(db,ALL);expect((await db.query('SELECT * FROM cockpit_ads')).rows.length).toBe(3);expect((await read()).tables.csTasks.length).toBe(1);
 await actor(db,ADMIN);expect((await read()).tables.clients.length).toBe(2);
 await actor(db,OTHER);await expect(read()).rejects.toThrow('access');expect((await db.query('SELECT * FROM cockpit_ads')).rows.length).toBe(0);
});
test('source lifecycle retains previous raw rows but activates only exact snapshot',async()=>{
 await owner(db);await source('clients',{_id:'old-client',name:'Old Client',taskId:'old'},['Old Client'],'2026-09-01T00:00:00Z');await actor(db,ALL);expect((await read()).tables.clients.length).toBe(2);
 await owner(db);await db.exec("UPDATE cockpit_csm_source_state SET ready=false WHERE table_name='clients'");await actor(db,A);await expect(read()).rejects.toThrow('not ready');
 await owner(db);await db.exec("UPDATE cockpit_csm_source_state SET ready=true WHERE table_name='clients'");await actor(db,A);expect((await read()).tables.clients.length).toBe(1);
});
test('source model keeps real clocks, hot usage and scoped churn without inventing paying',async()=>{
 await actor(db,A);const data=await read();const state:any={day:'2026-09-27',month:'2026-09',profiles:[],prefs:[],hotRows:[{key:'human'}],dismissed:[{clientName:'Client A',text:'Arrange call'},{clientName:'Client A',text:'Invoice overdue'}],money:null};
 const result=buildCsmReadModel(data,state,{checks:[],decisions:[],plan:[],eod:null,eodOwner:A,eodDay:'2026-09-27'});
 expect(result.clients[0].paying).toBeUndefined();expect(result.clients[0].stage).toBe('Paused');expect(result.clients[0].hotBlocked).toBe(true);expect(result.totals.hot).toBe(0);expect(result.clients[0].loose).toEqual(['Invoice overdue']);expect(result.churn?.baseline).toBe(1);expect(result.churn?.lost).toBe(0);expect(result.churn?.stillPaused[0].days).toBeNull();expect(result.hotRows).toEqual([{key:'human'}]);expect(result.appointments).toEqual([]);
});
test('profile selection prefers newest push then report sheet and never duplicates client',()=>{
 const rows:any[]=[{clientName:'Client A',syncId:'day-100',_creationTime:50,syncedAt:100,links:{sheet:'old'}},{clientName:' client a ',syncId:'day-200',_creationTime:60,syncedAt:200,links:{}},{clientName:'Client A',syncId:'day-200',_creationTime:40,syncedAt:200,links:{sheet:'chosen'}}];expect(currentCsmProfiles(rows).length).toBe(1);expect(currentCsmProfiles(rows)[0].links.sheet).toBe('chosen');
});
test('action server derives client and rejects wrong role, scope and dates',async()=>{
 await actor(db,A);const sql='SELECT cockpit_csm_action_context($1,$2) AS context';
 const context=(await db.query<any>(sql,['act',{taskId:'task-a',clientName:'Client B',kind:'call',action:'Logged call'}])).rows[0].context;expect(context.clientName).toBe('Client A');
 await expect(db.query(sql,['act',{taskId:'task-b',kind:'call',action:'Logged call'}])).rejects.toThrow('assigned');await expect(db.query(sql,['act',{taskId:'task-a',kind:'booked',action:'Booked',value:'2026-02-31'}])).rejects.toThrow();
 await expect(db.query(sql,['plan',{items:[{text:'Task',clientName:'Client B'}]}])).rejects.toThrow('outside');
 await actor(db,OTHER);await expect(db.query(sql,['act',{taskId:'task-a',kind:'call',action:'Logged call'}])).rejects.toThrow('access');
});
test('ClickUp transport verifies fields and comment before successful result',async()=>{
 const fields:any[]=[];let text='',calls:string[]=[];
 const provider:any={async call(method:string,path:string,body:any){calls.push(method+' '+path);if(method==='POST'&&path.includes('/field/')){fields.push({id:path.split('/').at(-1),value:body.value});return{};}if(path==='task/task-a'&&method==='GET')return {custom_fields:fields};if(method==='POST'&&path.endsWith('/comment')){text=body.comment_text;return{id:'comment1'};}if(method==='GET'&&path.endsWith('/comment'))return{comments:[{id:'comment1',comment_text:text}]};throw Error('Unexpected request');}};
 const plan=await prepareCsm('act',{kind:'call',action:'Call logged'},{day:'2026-09-27',taskId:'task-a',clientName:'Client A',evidence:'Needs call'},provider);expect(calls).toEqual([]);
 const done=await executeCsm(plan,provider);expect(done.result.ok).toBe(true);expect(done.patch.callDays).toBe(0);expect(done.result.commentId).toBe('comment1');expect(calls.filter(c=>c.startsWith('POST')).length).toBe(3);
 const bad:any={call:async(method:string,path:string)=>method==='GET'?{custom_fields:[]}:({})};await expect(executeCsm(plan,bad)).rejects.toThrow('read-back');
});

test('confirmed CSM actions write decisions only after provider proof and refuse revoked scope',async()=>{
 await actor(db,A);const args={taskId:'task-a',kind:'call',action:'Call logged',note:'Human note'};const context=(await db.query<any>("SELECT cockpit_csm_action_context('act',$1) AS context",[args])).rows[0].context;
 await owner(db);await db.exec('SET ROLE service_role');const actionId='10000000-0000-4000-8000-000000000001';await db.query("INSERT INTO cockpit_csm_actions(id,operation,actor_id,actor_email,context,request) VALUES($1,'act',$2,$3,$4,$5)",[actionId,A,context.email,context,args]);
 await db.exec('RESET ROLE');expect((await db.query('SELECT * FROM cockpit_decisions')).rows.length).toBe(0);await actor(db,A);await expect(db.query('SELECT cockpit_finish_csm_action($1,$2,$3)',[actionId,{ok:true,commentId:'one'},{lastCall:'2026-09-27'}])).rejects.toThrow('permission');
 await owner(db);await db.exec('SET ROLE service_role');await expect(db.query('SELECT cockpit_finish_csm_action($1,$2,$3)',[actionId,{ok:true},{lastCall:'2026-09-27'}])).rejects.toThrow('comment');
 const result=(await db.query<any>('SELECT cockpit_finish_csm_action($1,$2,$3) AS result',[actionId,{ok:true,commentId:'one'},{lastCall:'2026-09-27',callDays:0}])).rows[0].result;expect(result.receiptId).toBe(actionId);
 await db.query('SELECT cockpit_finish_csm_action($1,$2,$3)',[actionId,{ok:true,commentId:'one'},{lastCall:'2026-09-27'}]);await owner(db);expect((await db.query('SELECT * FROM cockpit_decisions')).rows.length).toBe(1);expect((await db.query<any>('SELECT reason,logged_at FROM cockpit_decisions')).rows[0].reason).toBe('Human note');
 const second='10000000-0000-4000-8000-000000000002';await db.query("INSERT INTO cockpit_csm_actions(id,operation,actor_id,actor_email,context,request) VALUES($1,'act',$2,$3,$4,$5)",[second,A,context.email,context,args]);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Client B'],A]);await db.exec('SET ROLE service_role');await expect(db.query('SELECT cockpit_finish_csm_action($1,$2)',[second,{ok:true,commentId:'two'}])).rejects.toThrow('access changed');await owner(db);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Client A'],A]);
});
test('planned task readback must confirm intended board, name and due date',async()=>{
 const context={actorId:A,email:'csm-a@tests.invalid',day:'2026-09-27'};let saved:any;
 const provider:any={async call(method:string,path:string,body:any){if(method==='POST'){saved=body;return{id:'new-task'};}return{id:'new-task',name:saved.name,list:{id:'901816723211'},due_date:saved.due_date,url:'https://app.clickup.com/t/new-task'};}};
 const plan=await prepareCsm('plan',{items:[{text:'Follow up',clientName:'Client A'}]},context,provider);const done=await executeCsm(plan,provider);expect(done.result.tasks?.length).toBe(1);expect(new Date(saved.due_date).toISOString().slice(0,10)).toBe('2026-09-28');
 const wrong:any={async call(method:string){return method==='POST'?{id:'bad-task'}:{id:'bad-task',name:'Follow up',list:{id:'another-board'},due_date:saved.due_date};}};await expect(executeCsm(plan,wrong)).rejects.toThrow('read-back');
});

test('client retains request identity after an uncertain provider outcome',async()=>{
 const requests:any[]=[];let success=false;
 const client:any={auth:{getSession:async()=>({data:{session:{user:{id:A}}}})},functions:{invoke:async(_name:string,input:any)=>{requests.push(input.body);return success?{data:{ok:true,receiptId:input.body.requestId},error:null}:{data:null,error:new Error('Reconcile before retrying')};}}};
 const args={taskId:'task-a',kind:'call',action:'Call logged'};await expect(executeCsmAction(client,'act',args)).rejects.toThrow('Reconcile');success=true;await executeCsmAction(client,'act',args);expect(requests[0].requestId).toBe(requests[1].requestId);expect(requests[0].apply).toBe(true);
});
