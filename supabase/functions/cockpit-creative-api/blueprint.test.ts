import {afterEach,describe,expect,test} from 'bun:test';
import {prepareBlueprint,describePlan,readOnly,assertSafe,rehearseBlueprint,blueprintMembers,type BlueprintPlan} from './blueprint';
import {executeOutbox,prepareOutbox,runClientAction} from './outbox';
import {providerTools} from '../cockpit-media-api/tools';
import type {Provider,Row} from '../cockpit-media-api/core';
import * as B from '../../../apps/client-success-cockpit/src/present/blueprintBrief';
// A fake ClickUp, Slack and Make behind fetch: the real provider tools, the real executor and the
// real read-backs run against it. Every client, task and person is invented.
const CARD='taskA1',CREATIVE_LIST='901818016338',NOW=new Date('2026-10-21T07:00:00Z');// a Wednesday in Kuwait
const FIELD={templated:'e7d158a8-1111-4000-8000-000000000001',self:'39839c9d-1111-4000-8000-000000000002',approval:'dd2253f9-1111-4000-8000-000000000003',offer:'404ba9d5-1111-4000-8000-000000000004',map:'51f49cb1-1111-4000-8000-000000000005',launchDate:'2e744484-1111-4000-8000-000000000006',budget:'539743c2-1111-4000-8000-000000000007'};
const drop=(id:string,name:string,options:string[],value?:number)=>({id,name,type:'drop_down',type_config:{options:options.map((o,i)=>({id:`${id.slice(0,4)}-o${i}`,name:o,orderindex:i}))},...(value!==undefined?{value}:{})});
const HOOK='https://hook.eu1.make.com/abcdefgh12345678';
class Fake{
 tasks=new Map<string,Row>();comments=new Map<string,Row[]>();calls:Row[]=[];slack:Row[]=[];make:Row[]=[];seq=0;nested=true;makeStatus=200;
 members=[{id:12345678,username:'Example Buyer',email:'buyer@tests.invalid'},{id:555,username:'Noura'}];
 lists:Record<string,Row>={[CREATIVE_LIST]:{id:CREATIVE_LIST,statuses:[{status:'to do',type:'open'},{status:'cancelled',type:'closed'},{status:'complete',type:'done'}]}};
 constructor(){
  this.tasks.set(CARD,{id:CARD,name:'Acme Interiors',list:{id:B.CLIENTS_LIST},status:{status:'onboarding',type:'custom'},tags:[],assignees:[],custom_fields:[
   drop(FIELD.templated,'Templated Ads Status',['Approved','Declined','Waiting On Client','Wants To See Them First'],3),
   drop(FIELD.self,'Can Self-Record?',['Yes - studio/cameraman','Yes - phone only','No','Unsure']),
   drop(FIELD.approval,'Ad Approval Needed?',['Yes','No']),
   drop(FIELD.offer,'📈 Offer Creation',['Not Started','In Progress','Done']),
   {id:FIELD.map,name:'Onboarding Map',type:'url',value:'https://mahara-onboarding-map.vercel.app/?phase=4&cid=taskA1'},
   {id:B.CSM_FIELD,name:'CSM',type:'users',value:[{id:555,username:'Noura'}]},
   {id:FIELD.launchDate,name:'Launch Date',type:'date',value:'1790000000000'},{id:FIELD.budget,name:'Daily Budget',type:'currency',value:50}]});
  for(const n of ['2','3','4'])this.tasks.set(`step${n}x`,{id:`step${n}x`,name:`${n} · Step ${n} (example)`,parent:'par1',list:{id:CREATIVE_LIST},status:{status:'to do',type:'open'},tags:[],assignees:[],custom_fields:[]});
 }
 task(id:string,name:string,extra:Row={}){this.tasks.set(id,{id,name,list:{id:B.LAUNCH_LIST},status:{status:'to do',type:'open'},tags:[],assignees:[],custom_fields:[],...extra});}
 writes(){return this.calls.filter(c=>c.method!=='GET');}
 fetch=async(input:string|URL|Request,init:RequestInit={}):Promise<Response>=>{
  const url=String(input),method=init.method??'GET',body=init.body?JSON.parse(String(init.body)):undefined;this.calls.push({method,url,body});
  const ok=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status});
  if(url===HOOK){this.make.push(body);return new Response('Accepted',{status:this.makeStatus});}
  if(url.startsWith('https://slack.com/api/')){const p=url.slice(22);
   if(method==='POST'&&p==='chat.postMessage'){const ts=`1700000000.00010${this.slack.length}`;this.slack.push({ts,channel:body.channel,text:body.text});return ok({ok:true,ts,channel:body.channel});}
   if(p.startsWith('conversations.history')){const ts=new URL(url).searchParams.get('latest');return ok({ok:true,messages:this.slack.filter(m=>m.ts===ts)});}
  }
  const raw=url.replace('https://api.clickup.com/api/v2/','');const [path,query='']=raw.split('?');const q=new URLSearchParams(query);const at=(verb:string,re:RegExp)=>method===verb?path.match(re):null;let m:RegExpMatchArray|null=null;
  m=at('GET',/^task\/([^/]+)\/comment$/);if(m)return ok({comments:this.comments.get(m[1])??[]});
  m=at('GET',/^task\/([^/]+)$/);if(m){const t=this.tasks.get(m[1]);return t?ok(structuredClone(t)):ok({err:'Task not found'},404);}
  m=at('GET',/^list\/([^/]+)\/member$/);if(m)return ok({members:this.members});
  m=at('GET',/^list\/([^/]+)\/task$/);if(m){const tag=q.get('tags[]');const page=Number(q.get('page')??0);
   const all=[...this.tasks.values()].filter(t=>t.list.id===m![1]&&(q.get('include_closed')!=='false'||!['closed','done'].includes(t.status.type))&&(!tag||t.tags.some((x:Row)=>x.name===tag)));
   return ok({tasks:all.slice(page*100,page*100+100),last_page:(page+1)*100>=all.length});}
  m=at('GET',/^list\/([^/]+)$/);if(m)return ok(this.lists[m[1]]??{statuses:[]});
  m=at('POST',/^list\/([^/]+)\/taskTemplate\/([^/]+)$/);if(m){const id=`new${++this.seq}x`;this.task(id,body.name,{list:{id:m[1]}});return ok(this.nested?{task:{id}}:{id});}
  m=at('POST',/^task\/([^/]+)\/tag\/([^/]+)$/);if(m){this.tasks.get(m[1])!.tags.push({name:decodeURIComponent(m[2]).toLowerCase()});return ok({});}
  m=at('PUT',/^task\/([^/]+)$/);if(m){const t=this.tasks.get(m[1])!;
   for(const a of body.assignees?.add??[])t.assignees.push({id:a,username:this.members.find(x=>x.id===a)?.username});
   if(body.due_date!==undefined)t.due_date=String(body.due_date);
   if(body.status)t.status={status:body.status,type:body.status==='complete'?'done':'open'};return ok(t);}
  m=at('POST',/^task\/([^/]+)\/field\/([^/]+)$/);if(m){const f=this.tasks.get(m[1])!.custom_fields.find((x:Row)=>x.id===m![2]);
   f.value=f.type==='drop_down'?f.type_config.options.find((o:Row)=>o.id===body.value).orderindex:body.value;return ok({});}
  m=at('POST',/^task\/([^/]+)\/comment$/);if(m){const id=String(9000+this.calls.length);const list=this.comments.get(m[1])??[];list.push({id,comment_text:body.comment_text,assignee:body.assignee});this.comments.set(m[1],list);return ok({id});}
  return ok({err:`Unexpected ${method} ${path}`},400);
 };
}
const env=(extra:Record<string,string>={})=>(k:string)=>({CLICKUP_API_TOKEN:'pk_test',SLACK_BOT_TOKEN:'xoxb-test',...extra} as Record<string,string>)[k];
const tools=(fake:Fake,extra:Record<string,string>={})=>providerTools(env(extra),async()=>{},fake.fetch as typeof fetch);
const PART1={service:'interior',capacity:'tight',capacity_note:'Two site teams busy until December',starter:'yes',pack_url:'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv',pack_approval:'on_call',daily_budget:{usd:40,said:'$50 a day'},destination:'lead_form',identity:'their_page',red_lines:['No before and after photos','No prices on screen']};
const PART2={approval:'first_batch',camera:'yes_phone',content_rating:'usable',shot_list:true,shot_list_due:'2026-10-24T07:00:00.000Z',minimum:{amount:3000,currency:'KWD'},anchor:{amount:12000,currency:'KWD'},events:'A home show in March (example)',csm_signals:'Asked about a second branch (example)',dna_status:'small_gaps',dna_missing:'Tone of voice'};
function payload(part:1|2|3,answers:Row,extra:Row={}):Row{
 return {v:1,part,press:1,card:{id:CARD,name:'Acme Interiors'},answers,from:{},at:{pack_approval:'2026-10-21T07:11:00Z'},previous:null,launchTaskId:null,sentAt:NOW.toISOString(),sentBy:'Dana',
  links:{drive:'https://drive.google.com/drive/folders/acmeDrive000001',driveFolder:null,brandDna:'https://docs.google.com/document/d/acmeDna',offerSheet:'https://docs.google.com/document/d/acmeOffer',research:null},
  ...(part===1?{kickoff:{budgetSaid:'$50 a day',platforms:'Meta (Facebook/Instagram)',adAccount:'Acme Ads',pageName:'Acme Interiors Page',cardFunded:'Yes',consultTypes:'Free site visit',templatedStatus:'Wants To See Them First',facebookAccess:'Access Confirmed'},cardBudget:45,settings:{assignee:{id:'12345678',label:'Example Buyer'},pack:null},step4:{taskId:'step4x',parentId:'par1'}}:{}),
  ...(part===2?{service:'interior',offer:null,step2:{taskId:'step2x',parentId:'par1'},launchCall:{startsAt:'2026-10-25T07:00:00Z'},closeRoute:'card_only',mapUrl:`https://mahara-onboarding-map.vercel.app/?phase=5&cid=${CARD}`,csmFirstName:'Noura'}:{}),
  ...(part===3?{dna_status:'small_gaps',dna_missing:'Tone of voice',step3:{taskId:'step3x',parentId:'par1'},offerSheet:'https://docs.google.com/document/d/acmeOffer'}:{}),...extra};
}
const row=(part:1|2|3,answers:Row,extra:Row={})=>({id:'20000000-0000-4000-8000-000000000001',kind:['','blueprintLaunch','blueprintClose','blueprintOffer'][part],task_id:CARD,client_name:'Acme Interiors',payload:payload(part,answers,extra),state:'pending'});
const prep=(fake:Fake,r:Row,e:Record<string,string>={})=>prepareBlueprint(r,tools(fake,e),env(e),NOW);
const noForbidden=(plan:BlueprintPlan)=>{const t=JSON.stringify(plan.steps);for(const f of [FIELD.launchDate,FIELD.budget,'669ae046','2e744484','539743c2'])expect(t).not.toContain(f.slice(0,8));};

describe('Send to media',()=>{
 test('no open launch task: creates it from the template, tags, assigns, sets the due date, comments the brief, then the card and step 4',async()=>{
  const fake=new Fake();const plan=await prep(fake,row(1,PART1));
  expect(fake.writes()).toEqual([]);noForbidden(plan);
  expect(plan.steps.map(s=>`${s.method} ${s.path}`)).toEqual([
   `POST list/${B.LAUNCH_LIST}/taskTemplate/${B.LAUNCH_TEMPLATE}`,'POST task/$step0.id/tag/acme%20interiors','PUT task/$step0.id','POST task/$step0.id/comment',
   `POST task/${CARD}/field/${FIELD.templated}`,'PUT task/step4x',`POST task/${CARD}/comment`]);
  const result=await executeOutbox(plan,tools(fake));
  const made=fake.tasks.get(String(result.launchTaskId))!;
  expect(made).toMatchObject({name:'Acme Interiors - New Client Campaign Launch 🚀',list:{id:B.LAUNCH_LIST},tags:[{name:'acme interiors'}],assignees:[{id:12345678}]});
  expect(made.due_date).toBe(String(Date.parse('2026-10-24T09:00:00+03:00')));// Wednesday's press is due Saturday
  const brief=fake.comments.get(made.id)![0].comment_text as string;
  expect(brief.split('\n')[0]).toBe('Brand Blueprint, starter ads');
  expect(brief).toContain('Starter ads: Yes. Pack: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv. Approved on the Blueprint call, 21 Oct 10:11 (Kuwait).');
  expect(brief).toContain('Daily budget: 40 USD a day (the kickoff said "$50 a day"; corrected on the call)');
  expect(brief).toContain('Publishing: Their Page "Acme Interiors Page" · Ad account "Acme Ads" · Card with funds: Yes');
  const card=fake.tasks.get(CARD)!;expect(card.custom_fields.find((f:Row)=>f.id===FIELD.templated).value).toBe(0);// Approved
  expect(fake.tasks.get('step4x')!.status).toEqual({status:'complete',type:'done'});
  expect(fake.comments.get(CARD)![0]).toMatchObject({assignee:555});expect(fake.comments.get(CARD)![0].comment_text).toContain('Capacity: Tight. Two site teams busy until December');
  // Launch Date, Next Payment Date and Daily Budget are untouched.
  expect(card.custom_fields.find((f:Row)=>f.id===FIELD.launchDate).value).toBe('1790000000000');expect(card.custom_fields.find((f:Row)=>f.id===FIELD.budget).value).toBe(50);
  expect(describePlan(plan)[0]).toBe(`Would create "Acme Interiors - New Client Campaign Launch 🚀" on Marketing/ADs from template ${B.LAUNCH_TEMPLATE}.`);
  expect(describePlan(plan)).toContain('Would assign it to Example Buyer, due Sat 24 Oct.');
 });
 test('a template response with the id at the top works the same, and no launch media buyer means due date only, with a loud first line',async()=>{
  const fake=new Fake();fake.nested=false;
  const plan=await prep(fake,row(1,PART1,{settings:{assignee:null,pack:null}}));
  expect(plan.steps[2].body).toEqual({due_date:Date.parse('2026-10-24T09:00:00+03:00'),due_date_time:false});
  const result=await executeOutbox(plan,tools(fake));
  expect(fake.tasks.get(String(result.launchTaskId))!.assignees).toEqual([]);
  expect(fake.comments.get(String(result.launchTaskId))![0].comment_text.split('\n')[0]).toBe('Unassigned: set the launch media buyer in Settings.');
  expect(fake.calls.some(c=>c.url.endsWith('/member'))).toBe(false);
 });
 test('an open task tagged with the client, or named after it, gets a comment and nothing is created',async()=>{
  for(const setup of [(f:Fake)=>f.task('tag1','Acme campaign',{tags:[{name:'acme interiors'}]}),(f:Fake)=>f.task('hand1','Acme Interiors | Launch campaigns after launch call')]){
   const fake=new Fake();setup(fake);const plan=await prep(fake,row(1,PART1));
   expect(plan.steps.some(s=>s.path.includes('taskTemplate'))).toBe(false);
   expect(plan.steps[0].path).toMatch(/^task\/(tag1|hand1)\/comment$/);
   expect(describePlan(plan)[0]).toMatch(/^Would comment on the open task ".*" and create nothing/);
   const result=await executeOutbox(plan,tools(fake));expect(['tag1','hand1']).toContain(String(result.launchTaskId));
  }
 });
 test("a card whose name is inside another client's name never takes that client's launch task",async()=>{
  const fake=new Fake();fake.tasks.get(CARD)!.name='Acme';
  fake.task('other1','Acme Interiors - New Client Campaign Launch 🚀');fake.task('other2','Acmeco | Launch campaigns after launch call');
  const r=row(1,PART1,{card:{id:CARD,name:'Acme'}});
  const plan=await prep(fake,{...r,client_name:'Acme'});
  expect(plan.steps[0].path).toBe(`list/${B.LAUNCH_LIST}/taskTemplate/${B.LAUNCH_TEMPLATE}`);
  expect(plan.steps.some(s=>/other[12]/.test(s.path))).toBe(false);
  // Its own hand-made task still matches: the card's name, a separator, then launch.
  fake.task('own1','Acme - Launch campaigns after launch call');
  const own=await prep(fake,{...r,client_name:'Acme'});
  expect(own.steps[0].path).toBe('task/own1/comment');
 });
 test('two open launch tasks refuse before anything is written',async()=>{
  const fake=new Fake();fake.task('t1','x',{tags:[{name:'acme interiors'}]});fake.task('t2','y',{tags:[{name:'acme interiors'}]});
  await expect(prep(fake,row(1,PART1))).rejects.toThrow('Two open launch tasks match Acme Interiors');
  const named=new Fake();named.task('n1','Acme Interiors launch');named.task('n2','Acme Interiors - New Client Campaign Launch 🚀');
  await expect(prep(named,row(1,PART1))).rejects.toThrow('Close the extra one in ClickUp');
  expect([...fake.writes(),...named.writes()]).toEqual([]);
 });
 test('a later press comments only what changed on the recorded task and creates nothing',async()=>{
  const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
  fake.tasks.get(CARD)!.custom_fields.find((f:Row)=>f.id===FIELD.templated).value=0;fake.tasks.get('step4x')!.status={status:'complete',type:'done'};
  const plan=await prep(fake,row(1,{...PART1,daily_budget:{usd:35}},{press:2,previous:PART1,launchTaskId:'launch01'}));
  expect(plan.steps.map(s=>s.path)).toEqual(['task/launch01/comment']);// templated unchanged, step 4 done, capacity unchanged
  const text=plan.steps[0].body!.comment_text as string;
  expect(text).toBe(['Updated from the Blueprint',`Client: Acme Interiors, https://app.clickup.com/t/${CARD}`,'Daily budget: 40 → 35 USD a day','Sent from the Brand Blueprint by Dana.'].join('\n'));
 });
 test('starter no: Declined, no step 4, the brief says to wait for custom ads; capacity yes: no CSM comment',async()=>{
  const fake=new Fake();const plan=await prep(fake,row(1,{...PART1,starter:'no',capacity:'yes'}));
  expect(plan.steps.some(s=>s.path==='task/step4x')).toBe(false);
  expect(plan.steps.some(s=>s.path===`task/${CARD}/comment`)).toBe(false);
  const templated=plan.steps.find(s=>s.path.includes(FIELD.templated))!;expect(templated.body).toEqual({value:'e7d1-o1'});
  expect(plan.steps.find(s=>s.path==='task/$step0.id/comment')!.body!.comment_text).toContain('No starter ads: build the account and wait for custom ads.');
 });
 test('wants changes sets Wants To See Them First only when the card says otherwise',async()=>{
  const fake=new Fake();const plan=await prep(fake,row(1,{...PART1,pack_approval:'wants_changes',pack_changes:'Brighter photos'}));
  expect(plan.steps.some(s=>s.path.includes(FIELD.templated))).toBe(false);
 });
 test('a renamed or missing card field, a renamed card and a buyer no longer on the list refuse',async()=>{
  const renamed=new Fake();renamed.tasks.get(CARD)!.custom_fields[0].name='Starter Ads';
  await expect(prep(renamed,row(1,PART1))).rejects.toThrow('"Templated Ads Status" field is missing or was renamed');
  const gone=new Fake();gone.tasks.get(CARD)!.custom_fields.shift();
  await expect(prep(gone,row(1,PART1))).rejects.toThrow('missing or was renamed');
  const card=new Fake();card.tasks.get(CARD)!.name='Acme Interiors and Fitout';
  await expect(prep(card,row(1,PART1))).rejects.toThrow("The card's name changed since the press");
  const buyer=new Fake();buyer.members=[];
  await expect(prep(buyer,row(1,PART1))).rejects.toThrow('not on Marketing/ADs any more');
  const other=new Fake();other.tasks.get(CARD)!.list={id:'999'};
  await expect(prep(other,row(1,PART1))).rejects.toThrow('not on the Clients list');
  await expect(prep(new Fake(),{...row(1,PART1),client_name:'Forged'})).rejects.toThrow('not one the cockpit queued');
 });
 test('no plan may name Launch Date, Next Payment Date or Daily Budget, or write fields in bulk',()=>{
  const base={provider:'clickup' as const,method:'POST',verifyPath:'task/x',expected:{}};
  expect(()=>assertSafe({steps:[{...base,path:`task/x/field/${FIELD.budget}`,body:{value:40}}],result:{}})).toThrow('would write Daily Budget');
  expect(()=>assertSafe({steps:[{...base,path:'task/x/field/2e744484-aaaa',body:{value:1}}],result:{}})).toThrow('Launch Date');
  expect(()=>assertSafe({steps:[{...base,path:'task/x',method:'PUT',body:{name:'x'}}],result:{}})).toThrow('only the assignee');
  expect(()=>assertSafe({steps:[{...base,path:'list/x/task',body:{custom_fields:[]}}],result:{}})).toThrow('one by one');
 });
});

describe('Close the call',()=>{
 test('card_only: the card fields, step 2, both comments and the phase 5 paste line; no Slack, no Make',async()=>{
  const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
  const plan=await prep(fake,row(2,PART2,{launchTaskId:'launch01'}));noForbidden(plan);
  expect(plan.steps.map(s=>s.path)).toEqual([`task/${CARD}/field/${FIELD.approval}`,`task/${CARD}/field/${FIELD.self}`,`task/${CARD}/field/${FIELD.map}`,'task/step2x','task/launch01/comment',`task/${CARD}/comment`]);
  expect(plan.blueprint.make).toBeUndefined();
  await executeOutbox(plan,tools(fake));
  const card=fake.tasks.get(CARD)!;const v=(id:string)=>card.custom_fields.find((f:Row)=>f.id===id).value;
  expect([v(FIELD.approval),v(FIELD.self),v(FIELD.map)]).toEqual([0,1,`https://mahara-onboarding-map.vercel.app/?phase=5&cid=${CARD}`]);
  const media=fake.comments.get('launch01')![0].comment_text as string;
  expect(media).toContain('Custom ads approval: The first batch, then we run');expect(media).toContain('Shot list: given, due Sat 24 Oct');expect(media).toContain('Smallest project: 3,000 KWD · Ads point to: 12,000 KWD');
  const csm=fake.comments.get(CARD)![0];expect(csm.assignee).toBe(555);
  expect(csm.comment_text).toContain('For you: Asked about a second branch (example)');expect(csm.comment_text).toContain('Launch call booked for Sun 25 Oct 10:00 (Kuwait).');
  // Make 14 module [7]'s text, with the map link and the card's Drive folder, ready to paste.
  expect(csm.comment_text).toContain(["Paste this in the client's WhatsApp group:",'أكملنا المرحلة الرابعة: بناء الهوية والعرض.','المرحلة التالية: مكالمة الإطلاق.','','اطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:',`https://mahara-onboarding-map.vercel.app/?phase=5&cid=${CARD}`,'',B.CONTENT_FOLDER_BLOCK.replace('{folder}','https://drive.google.com/drive/folders/acmeDrive000001')].join('\n'));
  expect(csm.comment_text).not.toContain('Send the usual phase 5 message');
  expect(fake.slack).toEqual([]);expect(fake.make).toEqual([]);
 });
 test('slack: the cockpit posts to #media-general once, read back; a later press never posts again',async()=>{
  const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
  const plan=await prep(fake,row(2,PART2,{launchTaskId:'launch01',closeRoute:'slack'}));
  await executeOutbox(plan,tools(fake));
  expect(fake.slack).toEqual([{ts:expect.any(String),channel:B.MEDIA_GENERAL,text:'Brand Blueprint completed: Acme Interiors. Scripts and custom creative can start. https://app.clickup.com/t/launch01'}]);
  const later=await prep(fake,row(2,{...PART2,camera:'yes_studio'},{launchTaskId:'launch01',closeRoute:'slack',press:2,previous:PART2}));
  expect(later.steps.some(s=>s.provider==='slack')).toBe(false);
  expect(later.steps.find(s=>s.path===`task/${CARD}/comment`)!.body!.comment_text).not.toContain('WhatsApp');
  expect(later.steps.find(s=>s.path==='task/launch01/comment')!.body!.comment_text).toContain('On camera: Yes, on their phone → Yes, with a cameraman or studio');
 });
 test('make with the flag and both secrets: Make writes Can Self-Record? and the map; one send with exactly seven keys, the key added only when sending',async()=>{
  const live={BLUEPRINT_MAKE_CLOSE:'on',MAKE_BLUEPRINT_HOOK:HOOK,MAKE_BLUEPRINT_KEY:'make-secret'};
  const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
  const plan=await prep(fake,row(2,PART2,{launchTaskId:'launch01',closeRoute:'make'}),live);
  expect(plan.steps.some(s=>s.path.includes(FIELD.self)||s.path.includes(FIELD.map))).toBe(false);
  expect(JSON.stringify(plan)).not.toContain('make-secret');
  expect(plan.steps.find(s=>s.path===`task/${CARD}/comment`)!.body!.comment_text).not.toContain('phase 5');
  const result=await executeOutbox(plan,tools(fake,live));
  expect(result.make).toBe('sent');expect(fake.make.length).toBe(1);
  expect(Object.keys(fake.make[0])).toEqual(['source','key','event','task_id','card_name','can_self_record','slack_text']);
  expect(fake.make[0]).toMatchObject({source:'mahara-cockpit',key:'make-secret',event:'blueprint.call_closed',task_id:CARD,card_name:'Acme Interiors',can_self_record:'Yes - phone only'});
  // The Make post comes last, after every read-back step.
  expect(fake.calls.at(-1)!.url).toBe(HOOK);
  const later=await prep(fake,row(2,PART2,{launchTaskId:'launch01',closeRoute:'make',press:2,previous:PART2}),live);expect(later.blueprint.make).toBeUndefined();
 });
 test('make chosen but not switched on falls back to card_only, and says so',async()=>{
  for(const e of [{},{BLUEPRINT_MAKE_CLOSE:'on',MAKE_BLUEPRINT_HOOK:HOOK},{MAKE_BLUEPRINT_HOOK:HOOK,MAKE_BLUEPRINT_KEY:'k'}]){
   const fake=new Fake();const plan=await prep(fake,row(2,PART2,{closeRoute:'make'}),e as Record<string,string>);
   expect(plan.blueprint.make).toBeUndefined();expect(plan.steps.some(s=>s.path.includes(FIELD.self))).toBe(true);
   expect(describePlan(plan)[0]).toBe('Make close is chosen but not switched on in the server: the CSM pastes the WhatsApp.');
   expect(plan.steps.find(s=>s.path===`task/${CARD}/comment`)!.body!.comment_text).toContain('Make close is chosen but not switched on');
   expect(describePlan(plan)).toContain('No open launch task was found, so the launch-task comment is skipped.');
  }
 });
 test('a Make failure after the send is never retried: the run moves to reconcile',async()=>{
  const live={BLUEPRINT_MAKE_CLOSE:'on',MAKE_BLUEPRINT_HOOK:HOOK,MAKE_BLUEPRINT_KEY:'make-secret'};
  const fake=new Fake();fake.makeStatus=500;const r={...row(2,PART2,{closeRoute:'make'}),id:'20000000-0000-4000-8000-000000000020'};
  const {client,admin,log}=supabaseFakes(r);const original=globalThis.fetch;globalThis.fetch=fake.fetch as typeof fetch;
  try{await expect(runClientAction({args:{id:r.id},apply:true},client,admin,env(live),'actor')).rejects.toThrow('Make rejected the close (500)');}finally{globalThis.fetch=original;}
  expect(fake.make.length).toBe(1);
  expect(log.filter(x=>x.table==='cockpit_creative_outbox'&&x.op==='update').map(x=>x.payload.state)).toEqual(['sending','reconcile']);
 });
});

describe('Lock the offer',()=>{
 const OFFER={offer:{name:'The Site Visit (example)',what:'A measured plan',firstStep:'A free visit by the lead designer'},scripts_status:'in_progress',scripts_date:'2026-10-28'};
 test('Offer Creation Done, Brand DNA gaps go on step 3, and the launch task hears the offer',async()=>{
  const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
  const plan=await prep(fake,row(3,OFFER,{launchTaskId:'launch01'}));
  expect(plan.steps.map(s=>s.path)).toEqual([`task/${CARD}/field/${FIELD.offer}`,'task/step3x/comment','task/launch01/comment']);
  await executeOutbox(plan,tools(fake));
  expect(fake.tasks.get(CARD)!.custom_fields.find((f:Row)=>f.id===FIELD.offer).value).toBe(2);
  expect(fake.comments.get('step3x')![0].comment_text).toContain('Brand DNA still missing: Tone of voice');
  expect(fake.comments.get('launch01')![0].comment_text).toBe('Offer locked: The Site Visit (example): A measured plan. First step: A free visit by the lead designer. Offer sheet: https://docs.google.com/document/d/acmeOffer. Custom ads in production. Custom scripts: In progress, by Wed 28 Oct.\nSent from the Brand Blueprint by Dana.');
 });
 test('Brand DNA complete completes step 3; a later press says the offer was updated and does not set Done twice',async()=>{
  const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
  const plan=await prep(fake,row(3,OFFER,{launchTaskId:'launch01',dna_status:'complete',dna_missing:null}));
  expect(plan.steps.map(s=>s.path)).toEqual([`task/${CARD}/field/${FIELD.offer}`,'task/step3x','task/launch01/comment']);
  await executeOutbox(plan,tools(fake));
  const later=await prep(fake,row(3,{...OFFER,scripts_status:'with_editors'},{launchTaskId:'launch01',dna_status:'complete',press:2,previous:OFFER}));
  expect(later.steps.map(s=>s.path)).toEqual(['task/launch01/comment']);
  expect(later.steps[0].body!.comment_text).toMatch(/^Offer updated: /);
 });
});

describe('reads only',()=>{
 test('the GET-only provider refuses every other method',async()=>{
  const p:Provider={async call(){return {};}};
  for(const m of ['POST','PUT','DELETE','PATCH'])await expect(readOnly(p).call('clickup',m,'task/x')).rejects.toThrow('Rehearsal reads only');
  expect(await readOnly(p).call('clickup','GET','task/x')).toEqual({});
 });
 test('a rehearsal returns the plan and its sentences from GETs only; missing answers return no plan',async()=>{
  const fake=new Fake();const health:Row[]=[];
  const client={rpc:async(name:string,args:Row)=>{expect(name).toBe('cockpit_blueprint_rehearse_payload');return {data:{kind:'blueprintLaunch',taskId:CARD,clientName:'Acme Interiors',missing:args.p_part===3?['offer']:[],payload:payload(1,PART1)},error:null};}};
  const admin={from:(t:string)=>({insert:async(r:Row)=>{health.push({t,...r});return {error:null};}})};
  const r=await rehearseBlueprint({taskId:CARD,part:1,answers:PART1},client,admin,env(),NOW,(e,h)=>providerTools(e,h,fake.fetch as typeof fetch));
  expect(r.dryRun).toBe(true);expect(r.lines[0]).toContain('Would create');expect(r.plan!.steps.length).toBe(7);
  expect(fake.writes()).toEqual([]);expect(health.every(h=>h.method==='GET'&&h.action_id===null&&h.t==='cockpit_media_provider_health')).toBe(true);
  const missing=await rehearseBlueprint({taskId:CARD,part:3,answers:{}},client,admin,env(),NOW);
  expect(missing).toEqual({dryRun:true,missing:['offer'],plan:null,lines:['Still missing: offer.']});
  await expect(rehearseBlueprint({taskId:'bad id',part:1,answers:{}},client,admin,env())).rejects.toThrow('valid ClickUp client ID');
  const refused={rpc:async()=>({data:null,error:{message:'Only an admin or the CEO rehearses the Brand Blueprint'}})};
  await expect(rehearseBlueprint({taskId:CARD,part:1,answers:{}},refused,admin,env())).rejects.toThrow('Only an admin or the CEO');
 });
 test('the members picker lists Marketing/ADs by ID and name, never an address, after the settings read admits the seat',async()=>{
  const fake=new Fake();const admin={from:()=>({insert:async()=>({error:null})})};
  const r=await blueprintMembers({rpc:async()=>({data:{},error:null})},admin,env(),(e,h)=>providerTools(e,h,fake.fetch as typeof fetch));
  expect(r).toEqual({members:[{id:'12345678',name:'Example Buyer'},{id:'555',name:'Noura'}]});
  await expect(blueprintMembers({rpc:async()=>({error:{message:'Current confirmed creative or client-success access is required'}})},admin,env())).rejects.toThrow('access is required');
 });
 test('every preparation reads through the GET-only guard, the real run and its dry run too',async()=>{
  // No preparation path writes today; the guard makes sure a later edit that does fails before any
  // plan is shown or fenced, so the three preparations must be handed the guarded reader.
  const src=await Bun.file(new URL('./blueprint.ts',import.meta.url)).text();
  const body=src.slice(src.indexOf('export async function prepareBlueprint'),src.indexOf('export const describePlan'));
  expect(body).toContain('const reader=readOnly(provider);');
  expect(body).toContain("reader.call('clickup','GET',`task/${row.task_id}`)");
  for(const f of ['prepareLaunch(p,card,reader,','prepareClose(p,card,reader,','prepareOffer(p,card,reader,'])expect(body).toContain(f);
  const code=body.split('\n').slice(1).filter(l=>!l.trim().startsWith('//')).join('\n').replace('readOnly(provider)','');
  expect(code).not.toMatch(/\bprovider\b/);
  for(const part of [1,2,3] as const){const fake=new Fake();fake.task('launch01','Acme Interiors - New Client Campaign Launch 🚀');
   await prepareOutbox(row(part,part===1?PART1:part===2?PART2:{offer:{name:'The Site Visit (example)',what:'A measured plan',firstStep:'A free visit'}}),tools(fake),env(),NOW);expect(fake.writes()).toEqual([]);}
 });
 test('prepareOutbox sends the three kinds to the Blueprint before any source-task check',async()=>{
  const fake=new Fake();const plan=await prepareOutbox(row(1,PART1),tools(fake),env(),NOW);
  expect('blueprint' in plan).toBe(true);
 });
});

describe('the outbox runner, end to end',()=>{
 test('claims the row, runs the plan, settles it done, and names the launch task on the record',async()=>{
  const fake=new Fake();const r=row(1,PART1);const {client,admin,log}=supabaseFakes(r);
  const original=globalThis.fetch;globalThis.fetch=fake.fetch as typeof fetch;
  let out:Row;try{out=await runClientAction({args:{id:r.id},apply:true},client,admin,env(),'actor');}finally{globalThis.fetch=original;}
  expect(out.state).toBe('done');expect(out.result.launchTaskId).toMatch(/^new\dx$/);
  expect(log.filter(x=>x.table==='cockpit_creative_outbox'&&x.op==='update').map(x=>x.payload.state)).toEqual(['sending','done']);
  expect(log.find(x=>x.rpc==='cockpit_blueprint_outbox_settled')!.args).toEqual({p_request_id:r.id,p_launch_task_id:out.result.launchTaskId});
  expect(log.find(x=>x.table==='cockpit_media_actions'&&x.op==='insert')!.payload.operation).toBe('creativeClient.blueprintLaunch');
 });
 test('without apply it returns the plan and its sentences, and writes nothing',async()=>{
  const fake=new Fake();const r=row(1,PART1);const {client,admin,log}=supabaseFakes(r);
  const original=globalThis.fetch;globalThis.fetch=fake.fetch as typeof fetch;
  let out:Row;try{out=await runClientAction({args:{id:r.id}},client,admin,env(),'actor');}finally{globalThis.fetch=original;}
  expect(out.dryRun).toBe(true);expect(out.lines[0]).toContain('Would create');expect(fake.writes()).toEqual([]);
  expect(log.filter(x=>x.op!=='insert'||x.table!=='cockpit_media_provider_health')).toEqual([]);
 });
});
afterEach(()=>{});
function supabaseFakes(r:Row){
 const log:Row[]=[];
 const chain=(table:string,op:string,payload:Row)=>{const q:Row={table,op,payload,filters:[]};log.push(q);const done:any=Promise.resolve({data:{id:r.id},error:null});done.eq=(k:string,v:unknown)=>{q.filters.push([k,v]);return done;};done.select=()=>done;done.single=()=>done;return done;};
 const client={rpc:async(name:string)=>{expect(name).toBe('cockpit_creative_client_action');return {data:{...r,sourceTask:null},error:null};}};
 const admin={from:(t:string)=>({insert:(p:Row)=>chain(t,'insert',p),update:(p:Row)=>chain(t,'update',p)}),rpc:async(name:string,args:Row)=>{log.push({rpc:name,args});return {error:null};}};
 return {client,admin,log};
}
