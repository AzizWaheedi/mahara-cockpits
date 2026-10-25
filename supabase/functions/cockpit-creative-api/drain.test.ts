import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {cronDoor,runDrain,sameSecret} from './drain';
import type {Row} from '../cockpit-media-api/core';
import * as B from '../../../apps/client-success-cockpit/src/present/blueprintBrief';
// The drain against a stand-in service client (an outbox, a journal and a receipt ledger in memory, the
// four RPCs as 20261025o and 20261024a define them) and a fake ClickUp behind fetch. The real runner,
// provider tools and executor run. Every client, task and person is invented.
const CARD='taskA1',PRESSER='00000000-0000-4000-8000-0000000000d1',OFFER_FIELD='404ba9d5-1111-4000-8000-000000000004';
const MIN=60000;
const BLUEPRINT=['blueprintLaunch','blueprintClose','blueprintOffer'];
class ClickUp{
 card:Row={id:CARD,name:'Acme Interiors',list:{id:B.CLIENTS_LIST},status:{status:'onboarding',type:'custom'},tags:[],assignees:[],
  custom_fields:[{id:OFFER_FIELD,name:'📈 Offer Creation',type:'drop_down',type_config:{options:['Not Started','In Progress','Done'].map((name,orderindex)=>({id:`4040-o${orderindex}`,name,orderindex}))}}]};
 comments:Row[]=[];calls:Row[]=[];failComment=false;
 writes(){return this.calls.filter(c=>c.method!=='GET');}
 fetch=async(input:string|URL|Request,init:RequestInit={}):Promise<Response>=>{
  const url=String(input),method=init.method??'GET',body=init.body?JSON.parse(String(init.body)):undefined;this.calls.push({method,url,body});
  const ok=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status});
  const path=url.replace('https://api.clickup.com/api/v2/','').split('?')[0];
  if(method==='GET'&&path===`task/${CARD}`)return ok(structuredClone(this.card));
  if(method==='GET'&&path===`list/${B.LAUNCH_LIST}/task`)return ok({tasks:[],last_page:true});
  if(method==='POST'&&path===`task/${CARD}/field/${OFFER_FIELD}`){const f=this.card.custom_fields[0];f.value=f.type_config.options.find((o:Row)=>o.id===body.value).orderindex;return ok({});}
  if(method==='POST'&&path===`task/${CARD}/comment`){if(this.failComment)return ok({err:'Something broke'},500);const id=String(7000+this.comments.length);this.comments.push({id,comment_text:body.comment_text});return ok({id});}
  if(method==='GET'&&path===`task/${CARD}/comment`)return ok({comments:this.comments});
  return ok({err:`Unexpected ${method} ${path}`},400);
 };
}
// The service client: from(table).insert/update with eq/neq/select/single, and rpc(name, args).
class Service{
 outbox=new Map<string,Row>();journal=new Map<string,Row>();health:Row[]=[];rpcs:Row[]=[];updates:Row[]=[];gateLost=false;beforeLoad?:(id:string)=>void;
 press(id:string,ageMin:number,extra:Row={}){
  const payload={v:1,part:3,press:1,card:{id:CARD,name:'Acme Interiors'},answers:{offer:{name:'The Site Visit (example)',what:'A measured plan',firstStep:'A free visit'}},previous:null,launchTaskId:null,sentBy:'Dana',dna_status:'complete'};
  this.outbox.set(id,{id,client_name:'Acme Interiors',kind:'blueprintOffer',task_id:CARD,payload,actor_id:PRESSER,actor_email:'cd-a@tests.invalid',state:'pending',result:null,error:null,attempts:0,created_at:new Date(Date.now()-ageMin*MIN).toISOString(),settled_at:null,...extra});
  return this.outbox.get(id)!;
 }
 admin={
  from:(table:string)=>({insert:(payload:Row)=>this.insert(table,payload),update:(payload:Row)=>this.update(table,payload)}),
  rpc:async(name:string,args:Row)=>{this.rpcs.push({name,args});return this.rpc(name,args);},
 };
 async insert(table:string,payload:Row){
  if(table==='cockpit_media_provider_health'){this.health.push(payload);return {error:null};}
  if(table==='cockpit_media_actions'){if(this.journal.has(payload.id))return {error:{message:'duplicate key value violates unique constraint'}};this.journal.set(payload.id,{...structuredClone(payload),state:'pending'});return {error:null};}
  return {error:{message:`Unexpected insert into ${table}`}};
 }
 update(table:string,payload:Row){
  const filters:[string,string,unknown][]=[];let single=false;const store=table==='cockpit_creative_outbox'?this.outbox:table==='cockpit_media_actions'?this.journal:null;
  const run=()=>{
   if(!store)return {data:null,error:{message:`Unexpected update of ${table}`}};
   const hits=[...store.values()].filter(r=>filters.every(([k,op,v])=>op==='eq'?r[k]===v:r[k]!==v));
   for(const r of hits){Object.assign(r,structuredClone(payload));this.updates.push({table,payload,id:r.id});}
   if(single&&hits.length!==1)return {data:null,error:{message:'JSON object requested, multiple (or no) rows returned'}};
   return {data:single?{id:hits[0].id}:null,error:null};
  };
  const q:any={eq:(k:string,v:unknown)=>{filters.push([k,'eq',v]);return q;},neq:(k:string,v:unknown)=>{filters.push([k,'neq',v]);return q;},select:()=>q,single:()=>{single=true;return q;},
   then:(resolve:(x:unknown)=>void,reject:(e:unknown)=>void)=>{try{resolve(run());}catch(e){reject(e);}}};
  return q;
 }
 rpc(name:string,args:Row){
  const now=Date.now(),age=(r:Row)=>now-Date.parse(r.created_at);
  if(name==='cockpit_creative_outbox_due'){
   const apply=args.p_apply===true;let failed=0;
   for(const r of this.outbox.values())if(r.state==='pending'&&BLUEPRINT.includes(r.kind)&&age(r)>30*MIN){failed++;if(apply)Object.assign(r,{state:'failed',error:'This press did not finish within 30 minutes. Press again.',settled_at:new Date().toISOString()});}
   const rows=[...this.outbox.values()].filter(r=>r.state==='pending'&&BLUEPRINT.includes(r.kind)&&age(r)>=2*MIN&&age(r)<=30*MIN&&r.attempts<3)
    .sort((x,y)=>x.created_at.localeCompare(y.created_at)).slice(0,5)
    .map(r=>({id:r.id,kind:r.kind,taskId:r.task_id,clientName:r.client_name,actorId:r.actor_id,attempts:r.attempts,createdAt:r.created_at}));
   return {data:{apply,failed,rows},error:null};
  }
  if(name==='cockpit_creative_outbox_load_for_actor'){
   this.beforeLoad?.(args.p_id);
   const r=this.outbox.get(args.p_id);
   if(!r||!BLUEPRINT.includes(r.kind))return {data:null,error:{message:'This press is not a Brand Blueprint press.'}};
   if(this.gateLost)return {data:null,error:{message:'That client is not on your access list'}};
   return {data:{...structuredClone(r),sourceTask:null},error:null};
  }
  if(name==='cockpit_creative_outbox_refused'){
   const r=this.outbox.get(args.p_id)!;
   if(r.state==='pending'){r.attempts=Math.min(r.attempts+1,3);r.error=String(args.p_error).slice(0,1000);if(r.attempts>=3){r.state='failed';r.settled_at=new Date().toISOString();}}
   return {data:{id:r.id,state:r.state,attempts:r.attempts},error:null};
  }
  return {data:null,error:{message:`Unexpected rpc ${name}`}};
 }
 written(){return this.updates.filter(u=>u.table==='cockpit_creative_outbox').length+this.journal.size+this.rpcs.filter(r=>r.name==='cockpit_creative_outbox_refused').length;}
}
const env=(k:string)=>({CLICKUP_API_TOKEN:'pk_test',CREATIVE_CRON_SECRET:'cron-secret-123'} as Record<string,string>)[k];
const uuid=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let clickup:ClickUp;let original:typeof fetch;
beforeEach(()=>{clickup=new ClickUp();original=globalThis.fetch;globalThis.fetch=clickup.fetch as typeof fetch;});
afterEach(()=>{globalThis.fetch=original;});

describe('the drain',()=>{
 test('a due press runs as its presser through the same journal, claim and settle, and the journal says cron',async()=>{
  const db=new Service();db.press(uuid(1),5);db.press(uuid(2),1);// the second is not due yet
  const out=await runDrain(db.admin,env,true);
  expect(out).toEqual({ok:true,apply:true,failed:0,ran:[{id:uuid(1),kind:'blueprintOffer',outcome:'done'}]});
  expect(db.rpcs[0]).toEqual({name:'cockpit_creative_outbox_due',args:{p_apply:true}});
  expect(db.rpcs.filter(r=>r.name==='cockpit_creative_outbox_load_for_actor').every(r=>r.args.p_id===uuid(1))).toBe(true);
  const row=db.outbox.get(uuid(1))!;
  expect(row.state).toBe('done');expect(row.result).toEqual({kind:'blueprintOffer',launchTaskId:null});
  expect(db.updates.filter(u=>u.table==='cockpit_creative_outbox').map(u=>u.payload.state)).toEqual(['sending','done']);
  const journal=db.journal.get(uuid(1))!;
  expect(journal).toMatchObject({actor_id:PRESSER,operation:'creativeClient.blueprintOffer',state:'confirmed',request:{source:'cron',outbox:{id:uuid(1),state:'pending'}}});
  expect(db.outbox.get(uuid(2))!.state).toBe('pending');
  // ClickUp: Offer Creation set to Done and the offer on the card, each read back; receipts name the press.
  expect(clickup.card.custom_fields[0].value).toBe(2);
  expect(clickup.comments[0].comment_text).toContain('Offer locked: The Site Visit (example)');
  expect(db.health.filter(h=>h.method!=='GET').every(h=>h.action_id===uuid(1))).toBe(true);
  expect(db.health.length).toBeGreaterThan(0);
 });
 test('a press pending over 30 minutes is failed by the due list, never run',async()=>{
  const db=new Service();db.press(uuid(3),45);
  const out=await runDrain(db.admin,env,true);
  expect(out).toEqual({ok:true,apply:true,failed:1,ran:[]});
  expect(db.outbox.get(uuid(3))).toMatchObject({state:'failed',error:'This press did not finish within 30 minutes. Press again.'});
  expect(clickup.calls).toEqual([]);
 });
 test('a refusal while the plan is prepared counts an attempt; the third fails the press; nothing is written to ClickUp',async()=>{
  const db=new Service();db.press(uuid(4),5);clickup.card.name='Acme Interiors and Fitout';
  for(const n of [1,2,3]){
   const out=await runDrain(db.admin,env,true);
   expect(out.ran).toEqual([{id:uuid(4),kind:'blueprintOffer',outcome:'refused',attempts:n,error:"The card's name changed since the press. Refresh, then send again."}]);
   expect(db.outbox.get(uuid(4))!.state).toBe(n<3?'pending':'failed');
  }
  expect(db.outbox.get(uuid(4))!.error).toBe("The card's name changed since the press. Refresh, then send again.");
  expect((await runDrain(db.admin,env,true)).ran).toEqual([]);
  expect(db.journal.size).toBe(0);expect(clickup.writes()).toEqual([]);
 });
 test('a presser who lost the creative seat or the client is refused before ClickUp is read',async()=>{
  const db=new Service();db.press(uuid(5),5);db.gateLost=true;
  const out=await runDrain(db.admin,env,true);
  expect(out.ran).toEqual([{id:uuid(5),kind:'blueprintOffer',outcome:'refused',attempts:1,error:'That client is not on your access list'}]);
  expect(clickup.calls).toEqual([]);expect(db.journal.size).toBe(0);
  expect(db.outbox.get(uuid(5))).toMatchObject({state:'pending',attempts:1,error:'That client is not on your access list'});
 });
 test('with apply false it writes nothing: no fail, no claim, no journal, no attempt, and ClickUp is only read',async()=>{
  const db=new Service();db.press(uuid(6),5);db.press(uuid(8),45);
  // A press for a card whose name changed since: refused, but with apply false the attempt is not counted.
  const renamed=db.press(uuid(7),6);renamed.client_name='Someone Else';renamed.payload.card.name='Someone Else';
  const out=await runDrain(db.admin,env,false);
  expect(out.apply).toBe(false);expect(out.failed).toBe(1);
  expect(out.ran).toEqual([
   {id:uuid(7),kind:'blueprintOffer',outcome:'refused',attempts:0,error:"The card's name changed since the press. Refresh, then send again."},
   {id:uuid(6),kind:'blueprintOffer',outcome:'dryRun'}]);
  expect(db.rpcs[0]).toEqual({name:'cockpit_creative_outbox_due',args:{p_apply:false}});
  expect(db.written()).toBe(0);
  expect([...db.outbox.values()].map(r=>[r.state,r.attempts])).toEqual([['pending',0],['pending',0],['pending',0]]);
  expect(clickup.writes()).toEqual([]);
  expect(db.health.every(h=>h.method==='GET'&&h.action_id===null)).toBe(true);
 });
 test('a press no longer pending when it is loaded is skipped: no journal, no ClickUp call',async()=>{
  for(const state of ['sending','done','failed','reconcile']){
   clickup.calls=[];const db=new Service();db.press(uuid(9),5);db.beforeLoad=id=>{db.outbox.get(id)!.state=state;};
   const out=await runDrain(db.admin,env,true);
   expect(out.ran).toEqual([{id:uuid(9),kind:'blueprintOffer',outcome:'skipped'}]);
   expect(db.journal.size).toBe(0);expect(clickup.calls).toEqual([]);expect(db.rpcs.some(r=>r.name==='cockpit_creative_outbox_refused')).toBe(false);
  }
 });
 test('a break after the claim settles the press to reconcile; it is not counted as a refusal or run again',async()=>{
  const db=new Service();db.press(uuid(10),5);clickup.failComment=true;
  const out=await runDrain(db.admin,env,true);
  expect(out.ran).toHaveLength(1);expect(out.ran[0]).toMatchObject({id:uuid(10),outcome:'reconcile'});expect(out.ran[0].error).toContain('clickup rejected the request (500)');
  expect(db.outbox.get(uuid(10))).toMatchObject({state:'reconcile',attempts:0});
  expect(db.journal.get(uuid(10))!.state).toBe('reconcile');
  expect(db.rpcs.some(r=>r.name==='cockpit_creative_outbox_refused')).toBe(false);
  expect((await runDrain(db.admin,env,true)).ran).toEqual([]);
 });
 test('a press the due list names twice (two drains at once) runs once: the journal keeps the second out',async()=>{
  const db=new Service();db.press(uuid(11),5);db.journal.set(uuid(11),{id:uuid(11),state:'pending'});
  const out=await runDrain(db.admin,env,true);
  expect(out.ran).toEqual([{id:uuid(11),kind:'blueprintOffer',outcome:'refused',attempts:1,error:'This client action needs reconciliation before retrying'}]);
  expect(clickup.writes()).toEqual([]);
 });
 test('a due list it cannot read stops the run with a sentence',async()=>{
  const db=new Service();db.admin.rpc=async()=>({data:null,error:{message:'permission denied for function cockpit_creative_outbox_due'}});
  await expect(runDrain(db.admin,env,true)).rejects.toThrow('The drain could not list the waiting presses: permission denied');
 });
});

describe('the cron door',()=>{
 const door=(input:unknown,secret:string|null,e=env)=>{
  const seen={admin:0,drain:[] as boolean[]};
  const drain=async(_admin:any,_env:any,apply:boolean)=>{seen.drain.push(apply);return {ok:true as const,apply,failed:0,ran:[]};};
  return cronDoor(input,secret,e,()=>{seen.admin++;return {};},drain).then(r=>({r,seen}));
 };
 test('a wrong, missing or unset secret is 401 before anything else is read or built',async()=>{
  for(const [secret,e] of [['wrong',env],[null,env],['cron-secret-12',env],['cron-secret-1234',env],['',(k:string)=>k==='CREATIVE_CRON_SECRET'?'':env(k)],['cron-secret-123',(k:string)=>k==='CREATIVE_CRON_SECRET'?undefined:env(k)]] as const){
   const {r,seen}=await door({operation:'cron',job:'nope'},secret,e as (k:string)=>string|undefined);
   expect(r).toEqual({status:401,body:{ok:false,error:'not allowed'}});expect(seen).toEqual({admin:0,drain:[]});
  }
 });
 test('the right secret with another job is 400 with the body to send; drain runs with apply only when it is true',async()=>{
  const bad=await door({operation:'cron',job:'sweep'},'cron-secret-123');
  expect(bad.r).toEqual({status:400,body:{ok:false,error:'Send {"operation":"cron","job":"drain","apply":true}.'}});expect(bad.seen.admin).toBe(0);
  expect((await door({operation:'cron'},'cron-secret-123')).r!.status).toBe(400);
  for(const [apply,want] of [[true,true],[false,false],['true',false],[undefined,false]] as const){
   const {r,seen}=await door({operation:'cron',job:'drain',apply},'cron-secret-123');
   expect(r!.status).toBe(200);expect(seen).toEqual({admin:1,drain:[want]});
  }
 });
 test('every other body goes on to the sign-in check',async()=>{
  for(const input of [{operation:'clientAction',args:{id:'x'}},{operation:'request'},null,'cron',[],{}]){
   const {r,seen}=await door(input,'cron-secret-123');
   expect(r).toBeNull();expect(seen).toEqual({admin:0,drain:[]});
  }
 });
 test('the secret is compared in full, in constant time, and an empty one never matches',()=>{
  expect(sameSecret('cron-secret-123','cron-secret-123')).toBe(true);
  for(const given of ['cron-secret-12','cron-secret-1234','Cron-secret-123','',null,undefined])expect(sameSecret(given,'cron-secret-123')).toBe(false);
  expect(sameSecret('','')).toBe(false);expect(sameSecret(null,undefined)).toBe(false);
 });
 test('index.ts reads the body once, asks the cron door before getUser(), and gives the drain the cron header',async()=>{
  const src=await Bun.file(new URL('./index.ts',import.meta.url)).text();
  const door=src.indexOf('cronDoor(input,req.headers.get(\'x-cron-secret\')'),user=src.indexOf('client.auth.getUser()'),json=src.indexOf('req.json()');
  expect(door).toBeGreaterThan(0);expect(user).toBeGreaterThan(door);expect(json).toBeGreaterThan(0);expect(json).toBeLessThan(door);
  expect(src.split('req.json()').length).toBe(2);
  expect(src).toContain("global:{headers:{'x-cockpit-source':'cron'}}");
  expect(src).toContain('runClientAction(input,browserLoader(client),admin,env,auth.user.id)');
 });
});
