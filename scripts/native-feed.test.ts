import type {PGlite as Db} from '../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite';
import {test, expect} from 'bun:test';
import {randomUUID, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from '../apps/media-buyer-cockpit/node_modules/zod';
import {migration, actor, member, owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import type {Row} from '../hermes/cockpit-sync/runtime';
import {calculate} from '../hermes/cockpit-sync/worker';
import {collectCsm} from '../hermes/cockpit-sync/csmProducer';
import {collectCreative} from '../hermes/cockpit-sync/creativeProducer';
import {CF} from '../hermes/cockpit-sync/csmCadence';
import {storeStills} from '../hermes/cockpit-sync/stills';
import type {Reads} from '../hermes/cockpit-sync/runtime';
import {transport} from '../hermes/cockpit-sync/transport';
import {collectMarket} from '../hermes/cockpit-sync/marketProducer';
import {archiveWinners} from '../hermes/cockpit-sync/winners';
import {withNativeContext} from '../hermes/cockpit-sync/runtime';
import {nativeFeedDb as fixture} from './lib/nativeFeedDb';

async function service(db:Db){await db.exec('RESET ROLE; SET ROLE service_role');}
async function initialize(db:Db){
 await owner(db);
 for(const family of ['media','csm','creative'])await db.exec(`UPDATE public.cockpit_${family}_source_state SET ready=true,row_count=0,source_snapshot_at=now()-interval '1 second'`);
 await db.exec("UPDATE public.cockpit_media_feed_state SET ready=true,source_rows=0,source_snapshot_at=now()-interval '1 second'");
 await service(db);
}
async function state(db:Db){return (await db.query<{r:Row}>('SELECT public.cockpit_native_media_state() r')).rows[0].r;}
async function claim(db:Db){return (await db.query<{r:Row}>('SELECT public.cockpit_native_media_claim($1) r',[randomUUID()])).rows[0].r;}
function plan(s:Row):Row {
 const now=Date.now(),stamp=new Date(now).toISOString(),day=stamp.slice(0,10);
 const campaigns=[{_id:'native:campaign:1',metaCampaignId:'111',metaAccountId:'222',campaignName:'Alpha campaign',accountName:'Alpha',clientName:'Alpha',syncedAt:now,spend7d:120,leads7d:10}];
 const ads=[{_id:'native:ad:1',metaAdId:'333',metaAccountId:'222',campaignName:'Alpha campaign',adName:'One',spend:120,leads:10,syncedAt:now}];
 const p:Row={producer:'media-core',version:1,begun_at:stamp,source_snapshot_at:stamp,working_day:day,window_since:day,expected:s.expected,
 tables:{...s.media,campaigns,ads,metaTree:[{_id:'tree:1',campaignName:'Alpha campaign',clientName:'Alpha',kind:'ad',metaId:'333'}],dailyStats:[{_id:'daily:1',campaignName:'Alpha campaign',date:day,metaAdId:'333',spend:120,leads:10,impressions:1000,linkClicks:20}],bookingEvents:[],checkProposals:[],adStills:[],winnersArchive:s.winners},
 csm:{...s.csm,clients:[{_id:'client:1',taskId:'cu1',name:'Alpha',stage:'Active'}],clientProfiles:[{_id:'profile:1',taskId:'cu1',clientName:'Alpha',adLeads:{month:10},syncedAt:now}],checks:[]},
 creative:{...s.creative,clients:[{_id:'creative:1',taskId:'cu1',name:'Alpha'}],campaigns,ads},counts:{}};
 recount(p);return p;
}
function recount(p:Row){for(const [family,rows]of Object.entries({tables:p.tables,csm:p.csm,creative:p.creative}) as [string,Record<string,Row[]>][])for(const [key,value]of Object.entries(rows))p.counts[(family==='tables'?'':family+'_')+key]=value.length;}
const sha=(p:Row)=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
async function publish(db:Db,c:Row,p:Row,receipts:Row[]=[]){return (await db.query<{r:Row}>('SELECT public.cockpit_native_media_publish($1,$2,$3,$4,$5) r',[c.run_id,c.lease_token,p,sha(p),receipts])).rows[0].r;}

test('canonical sources require initialized, exact complete counts; RPC permissions execute as real roles',async()=>{
 const db=await fixture();try{
  await service(db);await expect(state(db)).rejects.toThrow(/not initialized|not ready/i);
  await initialize(db);await state(db);
  await owner(db);await db.exec("UPDATE cockpit_media_source_state SET row_count=1 WHERE table_name='inbox'");await service(db);
  await expect(state(db)).rejects.toThrow(/count|complete/i);
  for(const role of ['anon','authenticated']){
   await db.exec(`RESET ROLE;SET ROLE ${role}`);
   await expect(claim(db)).rejects.toMatchObject({code:'42501'});
   await expect(state(db)).rejects.toMatchObject({code:'42501'});
   await expect(db.query('SELECT public.cockpit_native_media_fence($1,$2)',[randomUUID(),randomUUID()])).rejects.toMatchObject({code:'42501'});
   await expect(db.query('SELECT public.cockpit_native_media_release($1,$2,$3,$4)',[randomUUID(),randomUUID(),'failed',[]])).rejects.toMatchObject({code:'42501'});
  }
 }finally{await db.close();}
},30000);

test('publish updates actual consumer rows, preserves human state/history, reconciles deletions, retries exactly',async()=>{
 const db=await fixture();try{
  await initialize(db);await owner(db);
  await db.exec("INSERT INTO cockpit_client_profiles(client_name,notes,overview) VALUES('Alpha','[\"Keep this human note\"]','{\"language\":\"ar\"}')");
  await db.exec("INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES('legacy','history','Alpha campaign','2020-01-01','{\"campaignName\":\"Alpha campaign\",\"date\":\"2020-01-01\",\"spend\":7,\"leads\":2,\"impressions\":50,\"linkClicks\":3}')");
  await db.exec("UPDATE cockpit_media_feed_state SET source_rows=1 WHERE feed='dailyStats'");await service(db);
  const p=plan(await state(db)),c=await claim(db);
  const receipts=[{resource:'graph.facebook.com/v21.0/222',method:'GET',phase:'intent',attempt:1},{resource:'graph.facebook.com/v21.0/222',method:'GET',phase:'response',http_status:200,attempt:1}];
  const result=await publish(db,c,p,receipts);expect(result.status).toBe('published');expect(await publish(db,c,p,receipts)).toEqual(result);
  await expect(publish(db,c,{...p,working_day:'2000-01-01'})).rejects.toThrow(/retry/i);
  await owner(db);
  expect((await db.query<{n:number}>('SELECT spend_7d::float n FROM cockpit_campaigns')).rows[0].n).toBe(120);
  expect((await db.query<{n:number}>('SELECT sum((data->>\'leads\')::int)::int n FROM cockpit_media_daily_stats')).rows[0].n).toBe(12);
  expect((await db.query<{notes:unknown}>('SELECT notes FROM cockpit_client_profiles')).rows[0].notes).toEqual(['Keep this human note']);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM cockpit_media_provider_health WHERE native_run_id=$1',[c.run_id])).rows[0].n).toBe(2);
  const id='00000000-0000-4000-8000-000000000021';await member(db,id,'buyer@tests.invalid',['media_buyer']);
  await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],id]);await actor(db,id);
  expect((await db.query<{r:Row}>('SELECT cockpit_media_source_read() r')).rows[0].r.tables.metaTree).toHaveLength(1);
  await owner(db);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Other'],id]);await actor(db,id);
  expect((await db.query<{r:Row}>('SELECT cockpit_media_source_read() r')).rows[0].r.tables.metaTree).toEqual([]);
  await service(db);const next=plan(await state(db));next.tables.ads=[];next.tables.metaTree=[];next.creative.ads=[];recount(next);await publish(db,await claim(db),next);
  await owner(db);expect((await db.query<{source_deleted:boolean}>('SELECT source_deleted FROM cockpit_ads')).rows[0].source_deleted).toBe(true);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_media_daily_stats WHERE day='2020-01-01'")).rows[0].n).toBe(1);
 }finally{await db.close();}
},30000);

test('atomic rollback, duplicate identity, missing output, wrong counts, stale snapshots and source revision conflicts',async()=>{
 const db=await fixture();try{
  await initialize(db);const s=await state(db),c=await claim(db);
  for(const mutate of [
   (p:Row)=>{delete p.csm.clients;},
   (p:Row)=>{p.tables.ads.push({...p.tables.ads[0]});recount(p);},
   (p:Row)=>{p.counts.ads=9;},
   (p:Row)=>{p.source_snapshot_at='2000-01-01T00:00:00Z';},
   (p:Row)=>{p.tables.dailyStats[0].spend=-1;},
  ]){const p=plan(s);mutate(p);await expect(publish(db,c,p)).rejects.toThrow();expect((await state(db)).media.metaTree).toEqual([]);}
  const p=plan(s);await owner(db);await db.exec("UPDATE cockpit_csm_source_state SET source_snapshot_at=now() WHERE table_name='clients'");await service(db);
  await expect(publish(db,c,p)).rejects.toThrow(/revision/i);
  const fresh=plan(await state(db));await owner(db);await db.exec("INSERT INTO cockpit_offboard_dismissals(campaign_name,actor_id) VALUES('Human dismissal','00000000-0000-4000-8000-000000000001')");await service(db);
  await expect(publish(db,c,fresh)).rejects.toThrow(/revision/i);
 }finally{await db.close();}
},30000);

test('atomic first claim, expiry, stale fencing, release and sanitized failure receipts',async()=>{
 const db=await fixture();try{
  await initialize(db);const claims=await Promise.allSettled([claim(db),claim(db)]);
  expect(claims.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const held=claims.find((r):r is PromiseFulfilledResult<Row>=>r.status==='fulfilled')!.value;
  await expect(db.query('SELECT cockpit_native_media_fence($1,$2)',[held.run_id,randomUUID()])).rejects.toThrow(/fence/i);
  await owner(db);await db.query("UPDATE cockpit_native_media_runs SET lease_expires_at=now()-interval '1 second' WHERE run_id=$1",[held.run_id]);await service(db);
  await expect(publish(db,held,plan(await state(db)))).rejects.toThrow(/expired|fence/i);
  const next=await claim(db);await expect(db.query('SELECT cockpit_native_media_release($1,$2,$3,$4)',[held.run_id,held.lease_token,'failed',[]])).rejects.toThrow(/expired|fence/i);
  await db.query('SELECT cockpit_native_media_release($1,$2,$3,$4)',[next.run_id,next.lease_token,'token=secret https://host/?key=secret',[{resource:'https://graph.facebook.com/v21.0/1?access_token=secret',method:'GET',phase:'unknown',headers:{Authorization:'secret'},error:'secret'}]]);
  await owner(db);const rows=(await db.query<Row>('SELECT * FROM cockpit_media_provider_health WHERE native_run_id=$1',[next.run_id])).rows;
  expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain('secret');
  expect((await db.query<{error:string}>('SELECT error FROM cockpit_native_media_runs WHERE run_id=$1',[next.run_id])).rows[0].error).toBe('Native feed failed; inspect sanitized provider receipts');
 }finally{await db.close();}
},30000);

test('bootstrap uses real source ledgers, exact inventory CAS, owned deletions and immutable tombstones',async()=>{
 const db=await fixture();try{
  await service(db);
  const inventory=async()=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r;
  const make=async(rows:Row[])=>({project_ref:'bldgtotkfmhoxmlzowdx',created_at:new Date().toISOString(),scope:['media-buyer/inbox'],scope_complete:true,blockers:[],expected_tables:(await inventory()).tables,operations:[{app:'media-buyer',table:'inbox',kind:'source',source_sha256:'a'.repeat(64),table_sha256:sha(rows.map(row=>row.data)),source_snapshot_at:new Date().toISOString(),source_count:rows.length,rows}]});
  const send=async(c:Row,p:Row)=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4) r',[c.run_id,c.lease_token,p,sha(p)])).rows[0].r;
  const row={source_id:'legacy-inbox',data:{_id:'legacy-inbox',taskId:'cu1',title:'Keep',clientName:'Alpha'},client_names:['Alpha']};
  let p=await make([row]),c=await claim(db);const result=await send(c,p);expect(await send(c,p)).toEqual(result);
  expect((await inventory()).tables.cockpit_media_sources[0].source_id).toBe('legacy-inbox');
  p=await make([]);c=await claim(db);await send(c,p);
  expect((await inventory()).tables.cockpit_media_sources).toEqual([]);
  expect((await inventory()).tables.cockpit_runtime_imports[0].tombstone).toBe(true);
  p=await make([row]);c=await claim(db);await expect(send(c,p)).rejects.toThrow(/tombstone/i);
  await db.query('SELECT cockpit_native_media_release($1,$2,$3,$4)',[c.run_id,c.lease_token,'rejected',[]]);
  p=await make([]);c=await claim(db);
  await owner(db);await db.exec("UPDATE cockpit_media_source_state SET source_snapshot_at=now() WHERE table_name='inbox'");await service(db);
  await expect(send(c,p)).rejects.toThrow(/inventory revision/i);
 }finally{await db.close();}
},30000);
test('bootstrap persists real staffing and daily plan state, audits it, and protects newer native edits',async()=>{
 const db=await fixture();try{
  await service(db);
  const inventory=async()=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r;
  const stamp=new Date().toISOString();
  const sourceStatus={_id:'original-status',personKey:'media_buyer:test',status:'paused',since:'2026-09-16',note:'Keep original note',setBy:'founder@tests.invalid',setAt:1790208000000};
  const status={person_key:sourceStatus.personKey,status:sourceStatus.status,since:sourceStatus.since,note:sourceStatus.note,set_by:sourceStatus.setBy,set_at:'2026-09-24T00:00:00Z',source_deployment:'legacy-mb',source_id:sourceStatus._id,source_record:sourceStatus};
  const sourcePlan={_id:'original-plan',role:'media_buyer',day:'2026-10-04',text:'Finish original plan',listName:'Media Buyer',dueDate:'2026-10-05',createdAt:1790208000000,confirmed:true};
  const daily={role:sourcePlan.role,day:sourcePlan.day,text:sourcePlan.text,reason:null,client_name:null,list_name:sourcePlan.listName,due_date:sourcePlan.dueDate,created_at:'2026-09-24T00:00:00Z',confirmed:true,source_deployment:'legacy-mb',source_id:sourcePlan._id,source_row:sourcePlan};
  const make=async()=>({project_ref:'bldgtotkfmhoxmlzowdx',created_at:new Date().toISOString(),scope:['media-buyer/ceoTeamStatus','media-buyer/planItems'],scope_complete:true,blockers:[],expected_tables:(await inventory()).tables,operations:[
   {app:'media-buyer',table:'ceoTeamStatus',kind:'durable',target:'cockpit_team_status',source_sha256:'a'.repeat(64),table_sha256:'b'.repeat(64),deployment:'legacy-mb',source_snapshot_at:stamp,source_count:1,rows:[{source_id:sourceStatus._id,data:status,ledger_data:{...status,set_at:'2026-09-24T00:00:00.000000Z'},client_names:[],action:'insert'}],retirements:[]},
   {app:'media-buyer',table:'planItems',kind:'durable',target:'cockpit_plan_items',source_sha256:'c'.repeat(64),table_sha256:'d'.repeat(64),deployment:'legacy-mb',source_snapshot_at:stamp,source_count:1,rows:[{source_id:sourcePlan._id,data:daily,ledger_data:{...daily,created_at:'2026-09-24T00:00:00.000000Z'},client_names:[],action:'insert'}],retirements:[]},
  ]});
  const send=async(c:Row,p:Row)=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4) r',[c.run_id,c.lease_token,p,sha(p)])).rows[0].r;
  const p=await make(),c=await claim(db),result=await send(c,p);
  await owner(db);
  expect((await db.query<{person_key:string;status:string;note:string;source_record:Row}>('SELECT person_key,status,note,source_record FROM cockpit_team_status')).rows[0]).toEqual({person_key:'media_buyer:test',status:'paused',note:'Keep original note',source_record:sourceStatus});
  expect((await db.query<{text:string;confirmed:boolean;due_date:string}>('SELECT text,confirmed,due_date::text FROM cockpit_plan_items')).rows[0]).toEqual({text:'Finish original plan',confirmed:true,due_date:'2026-10-05'});
  expect((await db.query<{history_ready:boolean}>('SELECT history_ready FROM cockpit_team_status_state')).rows[0].history_ready).toBe(true);
  const audits=(await db.query<{entity_type:string}>("SELECT entity_type FROM cockpit_audit_log WHERE action='bootstrap.insert' ORDER BY entity_type")).rows.map(r=>r.entity_type);
  expect(audits).toEqual(['cockpit_plan_items','cockpit_team_status']);
  const before=(await db.query('SELECT * FROM cockpit_audit_log ORDER BY id')).rows;await service(db);
  expect(await send(c,p)).toEqual(result);await owner(db);
  expect((await db.query('SELECT * FROM cockpit_audit_log ORDER BY id')).rows).toEqual(before);
  await db.exec("UPDATE cockpit_team_status SET note='Newer human note' WHERE person_key='media_buyer:test'");await service(db);
  const newer=await make(),next=await claim(db);
  await expect(send(next,newer)).rejects.toThrow(/drifted|protected/i);await owner(db);
  expect((await db.query<{note:string}>('SELECT note FROM cockpit_team_status')).rows[0].note).toBe('Newer human note');
 }finally{await db.close();}
},30000);
test('bootstrap retains real original money baseline in canonical metric history without overwriting a newer value',async()=>{
 const db=await fixture();try{
  await service(db);
  const inventory=async()=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r;
  const source={_id:'original-ltv',date:'2026-09-24',metric:'money.ltv.card',scope:'client:original-card',value:123.5,at:1790208000000};
  const data={day:source.date,metric:source.metric,scope:source.scope,value:source.value,captured_at:'2026-09-24T00:00:00.000000Z',source_deployment:'legacy-mb',source_id:source._id,source_record:source};
  const make=async()=>({project_ref:'bldgtotkfmhoxmlzowdx',created_at:new Date().toISOString(),scope:['media-buyer/ceoDaily'],scope_complete:true,blockers:[],expected_tables:(await inventory()).tables,operations:[
   {app:'media-buyer',table:'ceoDaily',kind:'durable',target:'cockpit_metric_days',source_sha256:'a'.repeat(64),table_sha256:'b'.repeat(64),deployment:'legacy-mb',source_snapshot_at:new Date().toISOString(),source_count:1,rows:[{source_id:source._id,data,ledger_data:data,client_names:[],action:'insert'}],retirements:[]},
  ]});
  const send=async(c:Row,p:Row)=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4) r',[c.run_id,c.lease_token,p,sha(p)])).rows[0].r;
  await send(await claim(db),await make());await owner(db);
  expect((await db.query<{day:string;metric:string;scope:string;value:number;source_record:Row}>('SELECT day::text,metric,scope,value,source_record FROM cockpit_metric_days')).rows[0]).toEqual({day:'2026-09-24',metric:'money.ltv.card',scope:'client:original-card',value:123.5,source_record:source});
  expect((await db.query<{entity_type:string}>("SELECT entity_type FROM cockpit_audit_log WHERE action='bootstrap.insert'")).rows.map(r=>r.entity_type)).toEqual(['cockpit_metric_days']);
  await service(db);const repeated=await make();await send(await claim(db),repeated);await owner(db);
  expect((await db.query<{value:number}>('SELECT value FROM cockpit_metric_days')).rows.map(r=>r.value)).toEqual([123.5]);
  await db.exec("UPDATE cockpit_metric_days SET value=500 WHERE metric='money.ltv.card'");await service(db);
  const protectedPlan=await make(),next=await claim(db);
  await expect(send(next,protectedPlan)).rejects.toThrow(/drifted|protected/i);await owner(db);
  expect((await db.query<{value:number}>('SELECT value FROM cockpit_metric_days')).rows[0].value).toBe(500);
  await actor(db,null);
  await expect(db.query('SELECT * FROM cockpit_metric_days')).rejects.toMatchObject({code:'42501'});
 }finally{await db.close();}
},30000);

test('bootstrap preserves original audit authors, edits and immutable evidence across repeats',async()=>{
 const db=await fixture();try{
  await service(db);
  const source={_id:'original-audit',action:'people.edit',table:'cockpit_people',rowId:'20',by:'founder@tests.invalid',at:1790208000000,before:{name:'Original'},after:{name:'Updated'}};
  const data={action:source.action,entity_type:source.table,entity_id:source.rowId,actor_email:source.by,source_app:'media-buyer',source_system:'convex',before:source.before,after:source.after,created_at:'2026-09-24T00:00:00.000000Z',metadata:{source_table:'ceoAudit',source_deployment:'legacy-mb',source_id:source._id,source_record:source}};
  const make=async()=>({project_ref:'bldgtotkfmhoxmlzowdx',created_at:new Date().toISOString(),scope:['media-buyer/ceoAudit'],scope_complete:true,blockers:[],expected_tables:(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r.tables,operations:[
   {app:'media-buyer',table:'ceoAudit',kind:'durable',target:'cockpit_audit_log',source_sha256:'a'.repeat(64),table_sha256:'b'.repeat(64),deployment:'legacy-mb',source_snapshot_at:new Date().toISOString(),source_count:1,rows:[{source_id:source._id,data,ledger_data:data,client_names:[],action:'insert'}],retirements:[]},
  ]});
  const send=async(c:Row,p:Row)=>db.query('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4)',[c.run_id,c.lease_token,p,sha(p)]);
  await send(await claim(db),await make());await owner(db);
  const original=(await db.query<Row>("SELECT * FROM cockpit_audit_log WHERE metadata->>'source_id'='original-audit'")).rows;
  expect(original).toHaveLength(1);expect(original[0]).toMatchObject({action:'people.edit',entity_type:'cockpit_people',entity_id:'20',actor_email:source.by,before:source.before,after:source.after,metadata:data.metadata});
  await service(db);await send(await claim(db),await make());await owner(db);
  expect((await db.query<Row>("SELECT * FROM cockpit_audit_log WHERE metadata->>'source_id'='original-audit'")).rows).toEqual(original);
  await expect(db.query("UPDATE cockpit_audit_log SET actor_email='invented' WHERE id=$1",[original[0].id])).rejects.toThrow(/immutable/i);
  await expect(db.query('DELETE FROM cockpit_audit_log WHERE id=$1',[original[0].id])).rejects.toThrow(/immutable/i);
 }finally{await db.close();}
},30000);

test('bootstrap retains original client billing amounts, missing fields and closed lifecycle without overwriting native edits',async()=>{
 const db=await fixture();try{
  await service(db);
  const source={_id:'billing-source',taskId:'original-client',name:'Client A',stage:'Stopped',mrrUsd:0,ltvUsd:123.5,currency:'USD',paymentPlan:'Paid In Full',churnDate:'2026-09-15',syncedAt:1790298000000};
  const data={...Object.fromEntries(['next_payment_usd','next_payment_date','signup_date','launch_date','paused_on','next_renewal_date','payment_method','contract_status','churn_reason','churn_type','closer','lead_source'].map(field=>[field,null])),
   day:'2026-09-25',clickup_task_id:source.taskId,client_name:source.name,stage:source.stage,mrr_usd:source.mrrUsd,ltv_usd:source.ltvUsd,source_currency:source.currency,payment_plan:source.paymentPlan,churn_date:source.churnDate,captured_at:'2026-09-25T01:00:00.000000Z',source_deployment:'legacy-mb',source_id:source._id,source_record:source};
  const make=async()=>({project_ref:'bldgtotkfmhoxmlzowdx',created_at:new Date().toISOString(),scope:['media-buyer/ceoClientBilling'],scope_complete:true,blockers:[],expected_tables:(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r.tables,operations:[
   {app:'media-buyer',table:'ceoClientBilling',kind:'durable',target:'cockpit_client_billing_days',source_sha256:'a'.repeat(64),table_sha256:'b'.repeat(64),deployment:'legacy-mb',source_snapshot_at:new Date().toISOString(),source_count:1,rows:[{source_id:source._id,data,ledger_data:data,client_names:[],action:'insert'}],retirements:[]},
  ]});
  const send=async(c:Row,p:Row)=>db.query('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4)',[c.run_id,c.lease_token,p,sha(p)]);
  await send(await claim(db),await make());await owner(db);
  expect((await db.query<Row>('SELECT day::text,clickup_task_id,stage,mrr_usd::float8,ltv_usd::float8,next_payment_usd::float8,payment_plan,churn_date::text,source_record FROM cockpit_client_billing_days')).rows).toEqual([
   {day:'2026-09-25',clickup_task_id:'original-client',stage:'Stopped',mrr_usd:0,ltv_usd:123.5,next_payment_usd:null,payment_plan:'Paid In Full',churn_date:'2026-09-15',source_record:source},
  ]);
  await service(db);await send(await claim(db),await make());await owner(db);
  await db.exec("UPDATE cockpit_client_billing_days SET ltv_usd=500 WHERE clickup_task_id='original-client'");await service(db);
  await expect(send(await claim(db),await make())).rejects.toThrow(/drifted|protected/i);await owner(db);
  expect((await db.query<{ltv:number}>("SELECT ltv_usd::float8 ltv FROM cockpit_client_billing_days WHERE clickup_task_id='original-client'")).rows[0].ltv).toBe(500);
  await actor(db,null);await expect(db.query('SELECT * FROM cockpit_client_billing_days')).rejects.toMatchObject({code:'42501'});
 }finally{await db.close();}
},30000);

test('bootstrap reconciles durable EOD and member rows without source-cache substitution or human overwrites',async()=>{
 const db=await fixture();try{
  await initialize(db);await owner(db);
  const inventory=async()=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r;
  const stamp=new Date().toISOString(),day=stamp.slice(0,10);
  const eodData={role:'media_buyer',day,submitted_at:null,energy:null,answers:{note:'Original report'},computed:{leads:4},slack_ts:null,source_system:'convex',source_deployment:'legacy-mb',source_id:'legacy-eod',source_row:{_id:'legacy-eod',role:'media_buyer',day,energy:'steady',answers:{note:'Original report'},computed:{leads:4}}};
  const eod={source_id:'legacy-eod',data:eodData,ledger_data:eodData,client_names:[],action:'insert'};
  const rawCheck={_id:'legacy-check',role:'media_buyer',day,key:'review',label:'Review',done:false};
  const checkData={role:'media_buyer',owner_app:'media-buyer',day,check_key:'review',label:'Review',detail:null,phase:null,block:null,display_order:null,href:null,done:false,done_at:null,source_system:'convex',source_deployment:'legacy-mb',source_id:'legacy-check',source_created_at:null,source_snapshot_ts:stamp,source_row:rawCheck,changed_by:'migration@maharamedia.com',source_revision:1,source_deleted:false};
  const checkLedger={role:'media_buyer',owner_app:'media-buyer',day,check_key:'review',label:'Review',detail:null,phase:null,block:null,display_order:null,href:null,source_system:'convex',source_deployment:'legacy-mb',source_id:'legacy-check',source_created_at:null,source_row:rawCheck};
  const check={source_id:'legacy-check',data:checkData,ledger_data:checkLedger,client_names:[],action:'insert'};
  const decisionData={role:'media_buyer',day,subject:'Acme',action:'Keep running',evidence:null,kind:null,clickup_task_id:null,clickup_task_url:null,metric_at_decision:null,logged_at:null,source_system:'convex',source_deployment:'legacy-mb',source_id:'legacy-decision',source_row:{_id:'legacy-decision',role:'media_buyer',day,subject:'Acme',action:'Keep running'}};
  const decision={source_id:'legacy-decision',data:decisionData,ledger_data:decisionData,client_names:['Acme'],action:'insert'};
  const memberData={email:'new@example.test',name:'New member',roles:['media_buyer'],clients:['Acme'],active:true,sales_role:'setter',note:'Keep note',added_by:'Aziz',added_at:'2026-10-02T00:00:00+00:00',source_updated_at:null,last_seen_at:null,last_cockpit:null,source_deployment:'legacy-mb',source_id:'legacy-member'};
  const newMember={source_id:'legacy-member',data:memberData,ledger_data:memberData,client_names:[],action:'insert'};
  const memberId='00000000-0000-4000-8000-000000000031';
  await member(db,memberId,'existing@example.test',['admin']);
  await owner(db);await db.exec("UPDATE cockpit_members SET name='Human name',clients=ARRAY['Human client'],active=false,note='Human note' WHERE email='existing@example.test'");await service(db);
  const existingData={email:'existing@example.test',name:'Archived name',roles:['media_buyer'],clients:['Acme'],active:true,sales_role:null,note:'Archived note',added_by:null,added_at:'2026-10-02T00:00:00+00:00',source_updated_at:null,last_seen_at:null,last_cockpit:null,source_deployment:'legacy-mb',source_id:'legacy-existing-member'};
  const existingMember={source_id:'legacy-existing-member',data:existingData,ledger_data:existingData,client_names:[],action:'preserve'};
  const make=async(eodRows:Row[],memberRows:Row[],retirements:Row[]=[],checkRows:Row[]=[check],decisionRows:Row[]=[decision]):Promise<Row>=>({project_ref:'bldgtotkfmhoxmlzowdx',created_at:new Date().toISOString(),scope:['media-buyer/eodReports','media-buyer/members','media-buyer/checks','media-buyer/decisions'],scope_complete:true,blockers:[],expected_tables:(await inventory()).tables,operations:[
   {app:'media-buyer',table:'eodReports',kind:'durable',target:'cockpit_eod_reports',source_sha256:'a'.repeat(64),table_sha256:'b'.repeat(64),deployment:'legacy-mb',source_snapshot_at:stamp,source_count:eodRows.length,rows:eodRows,retirements},
   {app:'media-buyer',table:'members',kind:'durable',target:'cockpit_members',source_sha256:'c'.repeat(64),table_sha256:'d'.repeat(64),deployment:'legacy-mb',source_snapshot_at:stamp,source_count:memberRows.length,rows:memberRows,retirements:[]},
   {app:'media-buyer',table:'checks',kind:'durable',target:'cockpit_daily_checks',source_sha256:'e'.repeat(64),table_sha256:'f'.repeat(64),deployment:'legacy-mb',source_snapshot_at:stamp,source_count:checkRows.length,rows:checkRows,retirements:[]},
   {app:'media-buyer',table:'decisions',kind:'durable',target:'cockpit_decisions',source_sha256:'1'.repeat(64),table_sha256:'2'.repeat(64),deployment:'legacy-mb',source_snapshot_at:stamp,source_count:decisionRows.length,rows:decisionRows,retirements:[]},
  ]});
  const send=async(c:Row,p:Row)=>(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4) r',[c.run_id,c.lease_token,p,sha(p)])).rows[0].r;
  await send(await claim(db),await make([eod],[newMember,existingMember]));
  await owner(db);
  expect((await db.query<{answers:Row}>("SELECT answers FROM cockpit_eod_reports WHERE source_id='legacy-eod'")).rows[0].answers).toEqual({note:'Original report'});
  expect((await db.query<{energy:number|null;source_row:Row}>("SELECT energy,source_row FROM cockpit_eod_reports WHERE source_id='legacy-eod'")).rows[0]).toMatchObject({energy:null,source_row:{energy:'steady'}});
  expect((await db.query<{email:string;auth_user_id:string|null;name:string;clients:string[];active:boolean;note:string}>("SELECT email,auth_user_id,name,clients,active,note FROM cockpit_members WHERE email='existing@example.test'")).rows[0]).toMatchObject({auth_user_id:memberId,name:'Human name',clients:['Human client'],active:false,note:'Human note'});
  expect((await db.query<{source_deployment:string;source_id:string;note:string}>("SELECT source_deployment,source_id,note FROM cockpit_members WHERE email='new@example.test'")).rows[0]).toMatchObject({source_deployment:'legacy-mb',source_id:'legacy-member',note:'Keep note'});
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_media_sources WHERE source_id IN('legacy-eod','legacy-member')")).rows[0].n).toBe(0);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_runtime_imports WHERE source_id IN('legacy-eod','legacy-member','legacy-existing-member')")).rows[0].n).toBe(3);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='cockpit_eod_reports'")).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_daily_checks WHERE source_id='legacy-check'")).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_decisions WHERE source_id='legacy-decision'")).rows[0].n).toBe(1);
  await db.exec("UPDATE cockpit_daily_checks SET done=true,changed_by='human@tests.invalid'");await service(db);
  let p=await make([],[existingMember],[{source_id:'legacy-eod'}]);
  await send(await claim(db),p);
  await owner(db);
  expect((await db.query<{done:boolean}>("SELECT done FROM cockpit_daily_checks WHERE source_id='legacy-check'")).rows[0].done).toBe(true);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_eod_reports WHERE source_id='legacy-eod'")).rows[0].n).toBe(1);
  expect((await db.query<{tombstone:boolean}>("SELECT tombstone FROM cockpit_runtime_imports WHERE source_id='legacy-eod'")).rows[0].tombstone).toBe(true);
  p=await make([eod],[existingMember]);
  await expect(send(await claim(db),p)).rejects.toThrow(/tombstone/i);
 }finally{await db.close();}
},30000);

test('still uploader checks live SQL fence before provider writes',async()=>{
 const db=await fixture();try{
  await initialize(db);const c=await claim(db),receipts:Row[]=[];let uploads=0;
  const fence=async()=>{await db.query('SELECT cockpit_native_media_fence($1,$2)',[c.run_id,c.lease_token]);};
  await owner(db);await db.query("UPDATE cockpit_native_media_runs SET lease_expires_at=now()-interval '1 second' WHERE run_id=$1",[c.run_id]);await service(db);
  const assets=[{key:'creative:1',path:'file',contentType:'image/png',bytes:new Uint8Array([1]),sha256:'a'.repeat(64)}];
  const request:typeof fetch=async()=>{uploads++;return new Response('',{status:200});};
  await expect(storeStills(assets,{adStills:[],ads:[],metaTree:[],winnersArchive:[]},{SUPABASE_URL:'https://bldgtotkfmhoxmlzowdx.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'},fence,receipts,request)).rejects.toThrow(/expired/i);
  expect(uploads).toBe(0);expect(receipts).toEqual([]);
 }finally{await db.close();}
},30000);

test('CSM and creative source collectors stop at a stale fence in their async run context',async()=>{
 let reads=0;
 const reader:Reads={
  async graph(){reads++;return {data:[]};},
  async tool(){reads++;return {};},
  async fetch(){reads++;return new Response('{}');},
  log(){},
 };
 const fence=async()=>{throw new Error('expired worker fence');};
 const context={receipts:[],fence};
 await expect(withNativeContext(reader,context,()=>collectCsm({},{}))).rejects.toThrow(/expired worker fence/);
 await expect(withNativeContext(reader,context,()=>collectCreative({}, {}, {}))).rejects.toThrow(/expired worker fence/);
 expect(reads).toBe(0);
});

test('real worker calculations from raw provider fixture publish campaign, CSM and creative facts',async()=>{
 const db=await fixture();try{
  await initialize(db);await owner(db);
  await db.query("INSERT INTO cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'campaigns','legacy-creative-campaign',ARRAY['Alpha'],$1,source_snapshot_at FROM cockpit_creative_source_state WHERE table_name='campaigns'",[{_id:'legacy-creative-campaign',metaCampaignId:'111111',metaAccountId:'222222',campaignName:'Alpha campaign',accountName:'Alpha',clientName:'Alpha'}]);
  await db.query("INSERT INTO cockpit_media_call_briefs(client_name,key,status,overall,per_call,at,source_deployment,source_id) VALUES('Alpha','original-set','done','Original recorded overall summary',$1,'2026-09-24T00:00:00Z','original-mb','original-brief')",[[{url:'https://fathom.video/manual-call',brief:'Generated text must not replace the annotation'},{url:'https://fathom.video/recorded-call',brief:'Original recorded per-call brief'}]]);
  await db.query("INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clientProfiles','old-profile',ARRAY['Alpha'],$1,source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clientProfiles'",[{_id:'old-profile',taskId:'cu1',clientName:'Alpha',calls:[{title:'Alpha recorded call',at:new Date().toISOString(),url:'https://fathom.video/manual-call',brief:'Keep original manual annotation'}]}]);
  await db.exec("UPDATE cockpit_csm_source_state SET row_count=1 WHERE table_name='clientProfiles'");
  await db.exec("UPDATE cockpit_creative_source_state SET row_count=1 WHERE table_name='campaigns'");await service(db);
  const s=await state(db),c=await claim(db);
  const yesterday=new Date(Date.now()+10800000-86400000).toISOString().slice(0,10);
  const grid=Array<string>(25).fill('');Object.assign(grid,{0:yesterday,1:'Alpha',2:'Alpha campaign',3:'Set',4:'120',5:'10',7:'1000',8:'40',10:'1.2',16:'333333',17:'One',18:'PAUSED',24:'USD'});
  const headers=['Client Name','Clickup ID','Service Mode','GHL ID','GHL API','WA GROUP ID','Sheet Link','Google Drive Link','Ad Account - Meta','Status','Country','City'];
  const clientData=[headers,['Alpha','cu1','DWY','','','','','','Alpha','Active','Kuwait','Kuwait']];
  const rawClient={id:'cu1',name:'Alpha',url:'https://app.clickup.com/t/cu1',custom_fields:[{id:CF.status,name:'Client Status',type:'drop_down',value:0,type_config:{options:[{orderindex:0,name:'Active'}]}}]};
  const monthName=new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'Asia/Kuwait'}).format(new Date());
  const call={id:'appt1',contactId:'contact1',title:'Call with Alpha',startTime:`${yesterday}T10:00:00+03:00`,endTime:`${yesterday}T11:00:00+03:00`,appointmentStatus:'confirmed'};
  const insights={data:[{spend:'120',actions:[{action_type:'lead',value:'10'}]}]};
  const reads:Reads={
   async graph(path){
    if(path.endsWith('/owned_ad_accounts'))return {data:[{id:'act_222222',name:'Alpha',account_status:1,currency:'USD'}]};
    if(path.endsWith('/client_ad_accounts'))return {data:[]};
    if(path==='act_222222/campaigns')return {data:[{id:'111111',name:'Alpha campaign'}]};
    if(path==='act_222222/adsets')return {data:[{id:'555555',name:'Set',targeting:{age_min:25,age_max:55},insights}]};
    if(path==='555555/ads')return {data:[{id:'333333',name:'One',creative:{id:'444444'},insights}]};
    if(path==='111111')return {daily_budget:'3000',adsets:{data:[{id:'555555',name:'Set',status:'PAUSED',effective_status:'PAUSED'}]}};
    if(path==='111111/ads')return {data:[{id:'333333',name:'One',adset_id:'555555',status:'PAUSED',effective_status:'PAUSED',creative:{id:'444444'}}]};
    if(path==='444444')return {id:'444444'};
    if(path==='333333')return {creative:{id:'444444'}};
    throw new Error(`Unexpected fixture Graph resource ${path}`);
   },
   async tool(name,args){
    if(name==='mcp_supabase_execute_sql'){
     if(args.query.includes('select distinct s.campaign_name'))return {result:JSON.stringify([{campaign_name:'Alpha campaign',campaign_id:'111111',meta_ad_account_id:'222222'}])};
     if(args.query.includes('thumbnail_url')||args.query.includes('ad_account_activities'))return {result:'[]'};
     throw new Error('Unexpected fixture SQL source');
    }
    const url=new URL(args.url);
    if(name==='pd_typeform_proxy_get')return {items:[],total_items:0};
    if(name==='native_fathom_get')return {items:[{title:'Alpha recorded call',scheduled_start_time:new Date().toISOString(),url:'https://fathom.video/manual-call',default_summary:{markdown_formatted:'Current factual provider summary'}},{title:'Alpha second call',scheduled_start_time:new Date().toISOString(),url:'https://fathom.video/recorded-call'}]};
    if(name==='native_csm_ghl_get'){
     if(url.pathname==='/calendars/')return {calendars:[{id:'cal1',name:'Client Success Check-In'}]};
     if(url.pathname==='/calendars/events'){const at=Date.parse(call.startTime);return {events:at>=Number(url.searchParams.get('startTime'))&&at<Number(url.searchParams.get('endTime'))?[call]:[]};}
     if(url.pathname==='/contacts/contact1')return {contact:{id:'contact1',contactName:'Alpha contact',companyName:'Alpha'}};
     throw new Error('Unexpected fixture staff calendar resource');
    }
    if(name==='pd_google_sheets_proxy_get'){
     if(url.pathname.includes('1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU')){
      return url.pathname.includes('/values/')?{range:'01: Churn Tracker!A1:K20',values:[[monthName,'10','2','','20.00%']]}:{sheets:[{properties:{title:'01: Churn Tracker',sheetId:1}}]};
     }
     if(url.pathname.includes('1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0'))return {range:'Client Data!A1:Z200',values:clientData};
     if(url.pathname.includes('10vGT2Jw43eCsSi5UfGY6O35_6pq-rjaEDi-fN86yZ-A'))return {range:'A1:Z200',values:[['Client','Ad account','Country','City','Service'],['Alpha','222222','Kuwait','Kuwait','Construction']]};
     if(decodeURIComponent(url.pathname).includes('data_fb'))return {range:'data_fb!A3:Y11005',values:[grid]};
     throw new Error('Unexpected fixture sheet');
    }
    if(name==='pd_clickup_proxy_get'){
     if(url.pathname.endsWith('/field'))return {fields:[]};
     if(url.pathname.endsWith('/comment'))return {comments:[]};
     if(url.pathname.includes('/list/901816559981/'))return {tasks:[rawClient],last_page:true};
     if(url.pathname.includes('/list/901817774521/'))return {tasks:[{id:'board1',name:'Alpha campaign',tags:[{name:'Alpha'}],custom_fields:[],assignees:[]}],last_page:true};
     if(/\/list\/(901816723211|901816723196|901818016338|901816720767|901818697220)\/task/.test(url.pathname))return {tasks:[],last_page:true};
     throw new Error(`Unexpected fixture ClickUp resource ${url.pathname}`);
    }
    throw new Error(`Unexpected fixture provider ${name}`);
   },
   async fetch(){throw new Error('Fixture must not download or call a live provider');},
   log(level){if(level==='error')throw new Error('Fixture calculation reported a source failure');},
  };
  const {stillAssets,...p}=await calculate(s,reads,{receipts:[]},{});
  expect(stillAssets).toEqual([]);
  expect(p.tables.campaigns[0].spend7d).toBe(120);
  expect(p.tables.campaigns[0].leads7d).toBe(10);
  expect(p.tables.campaigns[0].cpl).toBe(12);
  expect(p.tables.marketPlays[0].cpl).toBe(12);
  expect(p.tables.winnersArchive[0].adId).toBe('333333');
  expect(p.creative.campaigns[0]._id).toBe('legacy-creative-campaign');
  expect(p.tables.campaigns[0]._id).not.toBe('legacy-creative-campaign');
  expect(p.csm.clientProfiles[0].adLeads.allTime).toBe(10);
  expect(p.csm.kpi.find(r=>r.key==='churn')?.numeric).toBe(20);
  expect(p.csm.appointments).toHaveLength(1);
  expect(p.csm.appointments[0]).toMatchObject({apptId:'appt1',clientName:'Alpha',kind:'checkin',status:'confirmed'});
  expect(p.csm.clientProfiles[0].callsBrief).toBe('Original recorded overall summary');
  expect(p.csm.clientProfiles[0].calls.find((call:Row)=>call.url==='https://fathom.video/manual-call').brief).toBe('Keep original manual annotation');
  expect(p.csm.clientProfiles[0].calls.find((call:Row)=>call.url==='https://fathom.video/recorded-call').brief).toBe('Original recorded per-call brief');
  expect(p.creative.clients[0].name).toBe('Alpha');
  expect(p.creative.clients[0].daily[0].leads).toBe(10);
  await publish(db,c,p);
  await owner(db);
  expect((await db.query<{spend:string}>('SELECT spend_7d::text spend FROM cockpit_campaigns')).rows[0].spend).toBe('120');
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM cockpit_csm_sources WHERE table_name='clientProfiles'")).rows[0].n).toBe(1);
  const stored=(await db.query<{data:Row}>("SELECT data FROM cockpit_csm_sources WHERE table_name='clientProfiles'")).rows[0].data;
  expect(stored.callsBrief).toBe('Original recorded overall summary');
  expect(stored.calls.find((call:Row)=>call.url==='https://fathom.video/manual-call').brief).toBe('Keep original manual annotation');
 }finally{await db.close();}
},30000);

test('provider failures settle sanitized receipts after expiry without advancing publication freshness',async()=>{
 const db=await fixture();try{
  await initialize(db);const c=await claim(db);
  const request:typeof fetch=async()=>new Response(JSON.stringify({error:{message:'provider-secret'}}),{status:503,headers:{'content-type':'application/json'}});
  const reader=transport({META_SYSTEM_TOKEN:'fixture-secret'},request,async()=>{});
  await expect(reader.reads.graph('act_222222/insights',{access_token:'query-secret'})).rejects.toThrow();
  expect(reader.receipts.filter(r=>r.phase==='intent')).toHaveLength(3);
  expect(reader.faults.length).toBeGreaterThan(0);
  await owner(db);await db.query("UPDATE cockpit_native_media_runs SET lease_expires_at=now()-interval '1 second' WHERE run_id=$1",[c.run_id]);await service(db);
  for(let i=0;i<2;i++)await db.query('SELECT cockpit_native_media_record_receipts($1,$2,$3)',[c.run_id,c.lease_token,reader.receipts]);
  await owner(db);
  const receipts=(await db.query<Row>('SELECT * FROM cockpit_media_provider_health WHERE native_run_id=$1',[c.run_id])).rows;
  expect(receipts).toHaveLength(6);expect(JSON.stringify(receipts)).not.toContain('secret');
  expect((await db.query<{published_at:string|null}>('SELECT published_at FROM cockpit_native_media_runs WHERE run_id=$1',[c.run_id])).rows[0].published_at).toBeNull();
 }finally{await db.close();}
},30000);

test('market provider insight math feeds permanent winners and keeps human annotations',async()=>{
 const insight:{data?:{spend:string;actions:{action_type:string;value:string}[]}[]}={data:[{spend:'120',actions:[{action_type:'lead',value:'10'}]}]};
 const reads:Reads={
  async graph(path){
   if(path.endsWith('/owned_ad_accounts'))return {data:[{id:'act_222222',name:'Alpha'}]};
   if(path.endsWith('/client_ad_accounts'))return {data:[]};
   if(path==='act_222222/adsets')return {data:[{id:'555555',name:'Broad',targeting:{age_min:25,age_max:55},insights:insight}]};
   if(path==='555555/ads')return {data:[{id:'333333',name:'One',creative:{id:'444444',object_story_spec:{link_data:{message:'Build your home',name:'Construction'}}},insights:insight}]};
   throw new Error('Unexpected market provider resource');
  },
  async tool(_name,args){
   return {values:[['Client Name','Ad Account - Meta','Country','City','Service'],['Alpha','222222','Kuwait','Kuwait','Construction']]};
  },
  async fetch(){throw new Error('No image request expected');},
  log(level){if(level==='error')throw new Error('Market source failed');},
 };
 const s={media:{marketPlays:[]},winners:[{_id:'legacy-winner',adId:'333333',origin:'manual',savedAt:1,firstArchivedAt:1,note:'Keep my annotation',spend:100,leads:5,cpl:20,client:'Human label'}],dailyStats:[]};
 const market=await withNativeContext(reads,{receipts:[]},()=>collectMarket(s));
 expect(market[0].spend).toBe(120);expect(market[0].cpl).toBe(12);
 const tables:Record<string,Row[]>={marketPlays:market,metaTree:[],dailyStats:[]};archiveWinners(s,tables);
 expect(tables.winnersArchive).toHaveLength(1);
 expect(tables.winnersArchive[0]).toMatchObject({_id:'legacy-winner',note:'Keep my annotation',firstArchivedAt:1,client:'Human label',spend:120,leads:10,cpl:12});
 delete insight.data;
 await expect(withNativeContext(reads,{receipts:[]},()=>collectMarket(s))).rejects.toThrow(/insight/i);
});

test('market provider never calls obsolete labels sheet, prefers exact account-ID over mismatched name, and fails closed on unreadable or ambiguous registry',async()=>{
 const insight={data:[{spend:'100',actions:[{action_type:'lead',value:'5'}]}]};
 const mockMeta=(accountName='Meta Name')=>({
  async graph(path:string){
   if(path.endsWith('/owned_ad_accounts'))return {data:[{id:'act_999888',name:accountName}]};
   if(path.endsWith('/client_ad_accounts'))return {data:[]};
   if(path==='act_999888/adsets')return {data:[{id:'adset_1',name:'Play 1',targeting:{age_min:20},insights:insight}]};
   if(path==='adset_1/ads')return {data:[{id:'ad_1',name:'Ad 1',creative:{id:'cr_1'},insights:insight}]};
   throw new Error(`Unexpected graph path ${path}`);
  },
  async fetch(){throw new Error('No image fetch');},
  log(){},
 });

 // 1. Obsolete sheet is never called, and canonical account-ID mapping wins over mismatched Meta display name
 {
  let obsoleteCalled = false;
  const reads:Reads={
   ...mockMeta('Confusing Meta Display Name'),
   async tool(_name,args){
    if(String(args?.url).includes('10vGT2Jw43eCsSi5UfGY6O35_6pq-rjaEDi-fN86yZ-A')){
     obsoleteCalled=true;
     throw new Error('Obsolete labels sheet must not be called');
    }
    return {values:[
     ['Client Name','Ad Account - Meta','Country','City','Service'],
     ['Authoritative Canonical Client','act_999888','UAE','Dubai','Interior design'],
    ]};
   },
  };
  const plays=await withNativeContext(reads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}));
  expect(obsoleteCalled).toBe(false);
  expect(plays).toHaveLength(1);
  expect(plays[0].client).toBe('Authoritative Canonical Client');
  expect(plays[0].accountId).toBe('999888');
  expect(plays[0].country).toBe('UAE');
  expect(plays[0].city).toBe('Dubai');
  expect(plays[0].serviceLine).toBe('Interior design');
 }

 // 2. Old fixtures lacking Ad Account - Meta header retain existing name matching
 {
  const reads:Reads={
   ...mockMeta('Alpha Interior'),
   async tool(){
    return {values:[
     ['Client Name','Country','City','Service'],
     ['Alpha Interior','Kuwait','Kuwait City','Interior design'],
    ]};
   },
  };
  const plays=await withNativeContext(reads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}));
  expect(plays).toHaveLength(1);
  expect(plays[0].client).toBe('Alpha Interior');
  expect(plays[0].country).toBe('Kuwait');
  expect(plays[0].city).toBe('Kuwait City');
  expect(plays[0].serviceLine).toBe('Interior design');
 }

 // 3. Empty/unreadable registry or missing Client Name header must fail closed
 {
  const unreadableReads:Reads={
   ...mockMeta(),
   async tool(){throw new Error('Network error loading Client Data');},
  };
  await expect(withNativeContext(unreadableReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}))).rejects.toThrow();

  const emptyReads:Reads={
   ...mockMeta(),
   async tool(){return {values:[]};},
  };
  await expect(withNativeContext(emptyReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}))).rejects.toThrow(/Client Data/i);

  const headerOnlyReads:Reads={
   ...mockMeta(),
   async tool(){return {values:[['Client Name','Ad Account - Meta','Country','City','Service']]};},
  };
  await expect(withNativeContext(headerOnlyReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}))).rejects.toThrow(/Client Data/i);

  const blankClientReads:Reads={
   ...mockMeta(),
   async tool(){return {values:[['Client Name','Ad Account - Meta'],['   ','999888']]};},
  };
  await expect(withNativeContext(blankClientReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}))).rejects.toThrow(/Client Data/i);

  const missingHeaderReads:Reads={
   ...mockMeta(),
   async tool(){return {values:[['No Client Name Here','Ad Account - Meta']]};},
  };
  await expect(withNativeContext(missingHeaderReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}))).rejects.toThrow(/Client Name/i);
 }

 // 4. Duplicate account-ID mapping must reject or fail closed
 {
  const duplicateIdReads:Reads={
   ...mockMeta(),
   async tool(){
    return {values:[
     ['Client Name','Ad Account - Meta','Country','City','Service'],
     ['Client First','999888','UAE','Dubai','Interior design'],
     ['Client Second','act_999888','KSA','Riyadh','Construction and contracting'],
    ]};
   },
  };
  await expect(withNativeContext(duplicateIdReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}))).rejects.toThrow(/ambiguous|duplicate/i);
 }

 // 5. Ambiguous name mapping (when no account ID is provided) must reject ambiguous match rather than attaching wrong client
 {
  const ambiguousNameReads:Reads={
   ...mockMeta('Alpha Global Projects'),
   async tool(){
    return {values:[
     ['Client Name','Country','City','Service'],
     ['Alpha One','Kuwait','Kuwait','Fit-out'],
     ['Alpha Two','Kuwait','Kuwait','Interior'],
    ]};
   },
  };
  const plays=await withNativeContext(ambiguousNameReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}));
  expect(plays[0].client).toBe('Alpha Global Projects');
  expect(plays[0].country).toBeUndefined();
  expect(plays[0].city).toBeUndefined();
  expect(plays[0].serviceLine).toBe('Unknown');

  const duplicateNormalizedNameReads:Reads={
   ...mockMeta('Beta Group'),
   async tool(){
    return {values:[
     ['Client Name','Country','City','Service'],
     ['Beta Group','Kuwait','Kuwait','Fit-out'],
     ['beta group','UAE','Dubai','Interior'],
    ]};
   },
  };
  const dupPlays=await withNativeContext(duplicateNormalizedNameReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}));
  expect(dupPlays[0].client).toBe('Beta Group');
  expect(dupPlays[0].country).toBeUndefined();
  expect(dupPlays[0].city).toBeUndefined();
  expect(dupPlays[0].serviceLine).toBe('Unknown');
 }

 // 6. Identical duplicate account-ID mappings deduplicate safely
 {
  const identicalIdReads:Reads={
   ...mockMeta('Any Meta Name'),
   async tool(){
    return {values:[
     ['Client Name','Ad Account - Meta','Country','City','Service'],
     ['Exact Client','999888','UAE','Dubai','Interior design'],
     ['Exact Client','act_999888','UAE','Dubai','Interior design'],
    ]};
   },
  };
  const plays=await withNativeContext(identicalIdReads,{receipts:[]},()=>collectMarket({media:{marketPlays:[]}}));
  expect(plays).toHaveLength(1);
  expect(plays[0].client).toBe('Exact Client');
  expect(plays[0].country).toBe('UAE');
 }
});


test('native refresh retains canonical legacy IDs, human fields and completed checklist work',async()=>{
 const db=await fixture();try{
  await initialize(db);
  const initial=plan(await state(db)),source={...initial.tables.campaigns[0],_id:'legacy-campaign'};
  await owner(db);
  const projected=(await db.query<{r:Row}>("SELECT cockpit_snapshot_projection('cockpit_campaigns',$1,'legacy-deployment') r",[source])).rows[0].r;
  const after={...projected,raw_data:source,synced_at:new Date(source.syncedAt).toISOString(),source_deleted:false,source_deleted_at:null};
  await service(db);
  const imported=(await db.query<{r:Row}>("SELECT cockpit_reconcile_snapshot('cockpit_campaigns',NULL,$1,$2,$3,true) r",[after,source,'a'.repeat(64)])).rows[0].r.row;
  const clientId='00000000-0000-4000-8000-000000000099';
  await owner(db);await db.query('INSERT INTO clients(id) VALUES($1)',[clientId]);
  await db.query("UPDATE cockpit_campaigns SET client_id=$2,raw_data=raw_data||'{\"human_note\":\"Keep my annotation\",\"staleTaskName\":\"Old source value\"}'::jsonb WHERE id=$1",[imported.id,clientId]);await service(db);
  const p=plan(await state(db));
  p.csm.checks=[{_id:'check-1',key:'review',label:'Review work',role:'csm',day:p.working_day}];recount(p);
  await publish(db,await claim(db),p);
  await owner(db);
  const current=(await db.query<Row>('SELECT * FROM cockpit_campaigns')).rows[0];
  expect(current).toMatchObject({id:imported.id,source_id:'legacy-campaign',source_deployment:'legacy-deployment',client_id:clientId});
  expect(current.raw_data.human_note).toBe('Keep my annotation');
  expect(current.raw_data).not.toHaveProperty('staleTaskName');
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM cockpit_campaigns')).rows[0].n).toBe(1);
  await db.exec("UPDATE cockpit_daily_checks SET done=true,changed_by='human@tests.invalid'");
  await db.query("INSERT INTO cockpit_eod_reports(role,day,answers,computed,source_system) VALUES('csm',$1,'{\"note\":\"Keep my report\"}','{\"calls\":5}','supabase')",[p.working_day]);
  await service(db);
  const next=plan(await state(db));next.csm.checks=[{...p.csm.checks[0],label:'Review refreshed work'}];recount(next);
  await publish(db,await claim(db),next);
  await owner(db);
  expect((await db.query<{done:boolean}>('SELECT done FROM cockpit_daily_checks')).rows[0].done).toBe(true);
  expect((await db.query<{answers:Row}>('SELECT answers FROM cockpit_eod_reports')).rows[0].answers).toEqual({note:'Keep my report'});
 }finally{await db.close();}
},30000);

test('source-owned human edits are explicit conflicts and never get hidden by a refresh',async()=>{
 const db=await fixture();try{
  await initialize(db);await publish(db,await claim(db),plan(await state(db)));
  await owner(db);await db.exec("UPDATE cockpit_campaigns SET reason='Human assessment'");await service(db);
  const p=plan(await state(db)),c=await claim(db);
  await expect(publish(db,c,p)).rejects.toThrow(/Human or untracked source field/i);
  await owner(db);
  expect((await db.query<{reason:string}>('SELECT reason FROM cockpit_campaigns')).rows[0].reason).toBe('Human assessment');
 }finally{await db.close();}
},30000);

test('actual finite importer publishes nonempty CSM human history with original times, owners and guarded repeats',async()=>{
 const db=await fixture();try{
  const uid='00000000-0000-4000-8000-000000000041',peer='00000000-0000-4000-8000-000000000042';
  await owner(db);await member(db,uid,'original-csm@example.test',['csm']);await member(db,peer,'peer-csm@example.test',['csm']);
  await db.query("UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id=$1",[peer]);
  await db.exec("INSERT INTO cockpit_client_profiles(client_name) VALUES('Alpha')");
  const at=1790208000000,records={
   clients:[{_id:'client-row',name:'Alpha',taskId:'client-alpha'}],
   clientPrefs:[{_id:'original-pref',_creationTime:at,clientName:'Alpha',language:null}],
   hotList:[{_id:'original-hot',key:'client-alpha:resell',clientName:'Alpha',type:'resell',manual:true,hidden:true,notes:'Keep original note',celebratedAt:at,at}],
   looseDismissed:[{_id:'original-dismissal',clientName:'Alpha',text:'  Original invoice note  ',key:'Alpha|invoice',by:'original-csm@example.test',at}],
   moneyGoals:[{_id:'original-goal',byEmail:'original-csm@example.test',month:'2026-09',target:0,clients:0.0,counts:{renewal:1},at}],
   projections:[{_id:'original-projection',weekStart:'2026-09-20',byEmail:'original-csm@example.test',metric:'cash',blood:0,stretch:100,actual:0,missReason:'  Original reason  ',at}],
   renewalPlans:[{_id:'old-renewal',taskId:'client-alpha',clientName:'Alpha',renewalDate:'2026-08-24',status:'renewed',outcomeNote:'Previous cycle retained',callRecordingUrl:'https://fathom.video/original-cycle',updatedBy:'original-csm@example.test',updatedAt:at},
    {_id:'new-renewal',taskId:'client-alpha',clientName:'Alpha',renewalDate:'2026-09-24',status:'planned',offer:{price:0,deliverables:'Original offer',durationMonths:3},updatedBy:'original-csm@example.test',updatedAt:at}],
  };
  const scope=Object.keys(records).filter(table=>table!=='clients').map(table=>`client-success/${table}`);
  const make=async()=>{
   await service(db);const inventory=(await db.query<{r:Row}>('SELECT cockpit_native_bootstrap_inventory() r')).rows[0].r;
   const script=`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('imp','scripts/import-cockpit-runtime-sources.py')\nimp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)\nx=json.load(sys.stdin)\ns={'app':'client-success','deployment':'original-csm','sha256':'a'*64,'captured_at':x['inventory']['captured_at'],'tables':x['records'],'table_hashes':{k:imp.content_hash(v) for k,v in x['records'].items()}}\nprint(json.dumps(imp.build_plan([s],x['inventory'],x['scope'])))`;
   const proc=Bun.spawn(['python','-c',script],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdin:'pipe',stdout:'pipe',stderr:'pipe'});
   proc.stdin.write(JSON.stringify({inventory,records,scope}));proc.stdin.end();
   const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
   if(code!==0)throw new Error(err);
   return z.object({scope_complete:z.boolean(),blockers:z.array(z.string()),scope:z.array(z.string()),operations:z.array(z.record(z.unknown())),expected_tables:z.record(z.unknown())}).passthrough().parse(JSON.parse(out));
  };
  const p=await make();expect(p.scope_complete).toBe(true);
  const send=async(c:Row,p:Row)=>db.query('SELECT cockpit_native_bootstrap_publish($1,$2,$3,$4)',[c.run_id,c.lease_token,p,sha(p)]);
  await send(await claim(db),p);await owner(db);
  expect((await db.query<Row>('SELECT language,updated_at,source_record FROM cockpit_csm_client_preferences')).rows[0]).toMatchObject({language:null,source_record:records.clientPrefs[0]});
  expect((await db.query<{at:string}>("SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') at FROM cockpit_csm_hot_rows")).rows[0].at).toBe('2026-09-24T00:00:00Z');
  expect((await db.query<Row>('SELECT data,source_record FROM cockpit_csm_hot_rows')).rows[0]).toMatchObject({data:{manual:true,hidden:true,celebratedAt:at,notes:'Keep original note'},source_record:records.hotList[0]});
  expect((await db.query<Row>('SELECT loose_text,cleared_by FROM cockpit_csm_loose_dismissals')).rows[0]).toEqual({loose_text:'  Original invoice note  ',cleared_by:uid});
  expect((await db.query<Row>('SELECT owner_id,target::float8,clients FROM cockpit_csm_money_goals')).rows[0]).toEqual({owner_id:uid,target:0,clients:0});
  expect((await db.query<Row>('SELECT data FROM cockpit_csm_projections')).rows[0].data).toMatchObject({actual:0,missReason:'  Original reason  '});
  expect((await db.query<Row>('SELECT renewal_date::text,data FROM cockpit_csm_renewal_plans ORDER BY renewal_date')).rows).toEqual([{renewal_date:'2026-08-24',data:{status:'renewed',outcomeNote:'Previous cycle retained',callRecordingUrl:'https://fathom.video/original-cycle',updatedBy:'original-csm@example.test'}},{renewal_date:'2026-09-24',data:{status:'planned',offer:{price:0,deliverables:'Original offer',durationMonths:3},updatedBy:'original-csm@example.test'}}]);
  await actor(db,uid);const own=(await db.query<{r:Row}>("SELECT cockpit_csm_state('2026-09') r")).rows[0].r;
  expect(own.money.target).toBe(0);expect(own.hotRows[0].celebratedAt).toBe(at);
  await actor(db,peer);const denied=(await db.query<{r:Row}>("SELECT cockpit_csm_state('2026-09') r")).rows[0].r;expect(denied.hotRows).toEqual([]);expect(denied.money).toBeNull();
  const repeated=await make();if(!repeated.scope_complete)throw new Error(`Repeated CSM plan is blocked: ${JSON.stringify(repeated.blockers)}`);await send(await claim(db),repeated);
  await owner(db);await db.exec('UPDATE cockpit_csm_money_goals SET target=500');
  const protectedPlan=await make();expect(protectedPlan.scope_complete).toBe(false);expect(protectedPlan.blockers.some((reason:string)=>reason.includes('Protected'))).toBe(true);
  await owner(db);expect((await db.query<{target:number}>('SELECT target::float8 FROM cockpit_csm_money_goals')).rows[0].target).toBe(500);
 }finally{await db.close();}
},30000);
