import type {Provider,Plan,MultiPlan,Row} from '../cockpit-media-api/core.ts';
import {providerTools} from '../cockpit-media-api/tools.ts';
import * as B from '../../../apps/client-success-cockpit/src/present/blueprintBrief.ts';
// The Brand Blueprint's three presses (docs/brand-blueprint/SPEC.md 3.3 to 3.7), run by the creative
// outbox exactly as a video request is: prepare reads ClickUp with GETs only and returns a plan;
// executePlan writes it step by step, each step read back. Nothing here writes Launch Date, Next
// Payment Date or Daily Budget (assertSafe refuses a plan that names one).
export const BLUEPRINT_KINDS=['blueprintLaunch','blueprintClose','blueprintOffer'] as const;
export const isBlueprint=(kind:unknown)=>typeof kind==='string'&&(BLUEPRINT_KINDS as readonly string[]).includes(kind);
export interface BlueprintPlan extends MultiPlan {blueprint:{kind:string;lines:string[];make?:Row}}
type Env=(name:string)=>string|undefined;
const ID=/^[A-Za-z0-9]{4,20}$/,CARD=/^[A-Za-z0-9_-]{1,40}$/;
const norm=(s:unknown)=>String(s??'').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLowerCase();
const loose=(s:unknown)=>String(s??'').toLowerCase().replace(/\s+/g,'');
const open=(t:Row)=>!['closed','done'].includes(String(t.status?.type??''))&&t.archived!==true;
// The GET-only guard: a rehearsal, the members picker and every preparation (the real run's and its dry
// run's too) read through it; only executePlan, given the real provider, writes.
export function readOnly(p:Provider):Provider{return {call(provider,method,path,body,as){if(method!=='GET')return Promise.reject(new Error('Rehearsal reads only'));return p.call(provider,method,path,body,as);}};}
// A card field by its known ID prefix AND its name; a renamed or missing field refuses.
function field(card:Row,key:B.CardFieldKey):Row{
 const want=B.CARD_FIELDS[key];const hits=(Array.isArray(card.custom_fields)?card.custom_fields:[]).filter((f:Row)=>String(f.id??'').startsWith(want.prefix));
 if(hits.length!==1||norm(hits[0].name)!==norm(want.name))throw new Error(`The client card's "${want.name}" field is missing or was renamed in ClickUp. Nothing was sent.`);
 return hits[0];
}
const options=(f:Row):Row[]=>Array.isArray(f.type_config?.options)?f.type_config.options:[];
const current=(f:Row)=>{const v=f.value;if(v===undefined||v===null||v==='')return null;return options(f).find(o=>String(o.orderindex)===String(v)||String(o.id)===String(v))??null;};
const aliases=(o:Row)=>[o.id,...(o.orderindex!==undefined?[o.orderindex]:[])];
function dropdown(cardId:string,f:Row,label:string):Plan|null{
 const o=options(f).find(x=>norm(x.name??x.label)===norm(label));if(!o)throw new Error(`ClickUp's "${f.name}" field has no "${label}" option. Nothing was sent.`);
 const cur=current(f);if(cur&&String(cur.id)===String(o.id))return null;
 return {provider:'clickup',method:'POST',path:`task/${cardId}/field/${f.id}`,body:{value:o.id},verifyPath:`task/${cardId}`,expected:{field:f.id,value:o.id,aliases:aliases(o)},precondition:cur?{field:f.id,value:cur.id,aliases:aliases(cur)}:{field:f.id,value:[]}};
}
const comment=(task:string,text:string,assignee?:number):Plan=>({provider:'clickup',method:'POST',path:`task/${task}/comment`,body:{comment_text:text,notify_all:false,...(assignee!==undefined?{assignee}:{})},verifyPath:`task/${task}/comment`,expected:{comment_text:text},clickupComment:true});
const csmOf=(card:Row)=>{const v=(card.custom_fields??[]).find((f:Row)=>f.id===B.CSM_FIELD)?.value;const u=Array.isArray(v)?v.find((x:Row)=>x&&/^\d+$/.test(String(x.id))):null;return u?{id:Number(u.id),name:String(u.username??'the CSM')}:null;};
const twoMatches=(name:string,tasks:Row[])=>new Error(`Two open launch tasks match ${name}: ${tasks.map(t=>B.cardUrl(String(t.id))).join(', ')}. Close the extra one in ClickUp, then press Send to media again.`);
// The open launch task: the record's, else one tagged with the card's name, else one whose name starts
// with the card's name, then a separator or "launch", and holds "launch" ("{card} - New Client Campaign
// Launch 🚀", "{client} | Launch campaigns after launch call"; never "{card} Interiors - … Launch" for
// a card whose name is inside another's). Two or more refuse before anything is written.
export async function findLaunch(provider:Provider,p:B.BlueprintPayload):Promise<Row|null>{
 if(p.launchTaskId&&ID.test(p.launchTaskId)){const t=await provider.call('clickup','GET',`task/${p.launchTaskId}`);if(String(t.id)===p.launchTaskId&&String(t.list?.id)===B.LAUNCH_LIST&&open(t))return t;}
 const tag=B.launchTag(p.card.name);
 const tagged=((await provider.call('clickup','GET',`list/${B.LAUNCH_LIST}/task?tags[]=${encodeURIComponent(tag)}&include_closed=false`)).tasks??[]).filter((t:Row)=>open(t)&&(t.tags??[]).some((x:Row)=>String(x?.name??x).toLowerCase()===tag));
 if(tagged.length>1)throw twoMatches(p.card.name,tagged);if(tagged.length===1)return tagged[0];
 const card=String(p.card.name??'').normalize('NFKC').trim().toLowerCase();const named:Row[]=[];
 for(let page=0;page<3;page++){const res=await provider.call('clickup','GET',`list/${B.LAUNCH_LIST}/task?include_closed=false&page=${page}`);const tasks:Row[]=Array.isArray(res.tasks)?res.tasks:[];for(const t of tasks){const raw=String(t.name??'').normalize('NFKC').trim().toLowerCase();if(open(t)&&card&&raw.startsWith(card)&&/^\s*([-|:–—(]|launch\b)/.test(raw.slice(card.length))&&/\blaunch\b/.test(norm(t.name)))named.push(t);}if(res.last_page===true||tasks.length<100)break;}
 if(named.length>1)throw twoMatches(p.card.name,named);return named[0]??null;
}
// A Creative Onboarding step as the record names it: the right parent and the "n ·" name, read now.
async function stepTask(provider:Provider,step:B.Step|undefined,n:string):Promise<Row|null>{
 if(!step||!/^[A-Za-z0-9]{4,20}$/.test(String(step.taskId)))return null;
 const t=await provider.call('clickup','GET',`task/${step.taskId}`);
 return String(t.id)===String(step.taskId)&&String(t.parent??'')===String(step.parentId)&&new RegExp(`^\\s*${n}\\s*[·.:)-]`).test(String(t.name??''))?t:null;
}
async function doneStep(provider:Provider,t:Row):Promise<Plan|null>{
 if(['done','closed'].includes(String(t.status?.type??'')))return null;
 if(!/^\d+$/.test(String(t.list?.id??'')))throw new Error('ClickUp did not say which list the onboarding step is on');
 const list=await provider.call('clickup','GET',`list/${t.list.id}`);const done=list.statuses?.find((s:Row)=>s.type==='done')?.status;
 if(!done)throw new Error('This list has no done status; a cancelled status will not be used');
 return {provider:'clickup',method:'PUT',path:`task/${t.id}`,body:{status:done},verifyPath:`task/${t.id}`,expected:{status:{status:done}},precondition:{status:{status:t.status?.status}}};
}
// No press writes Launch Date, Next Payment Date or Daily Budget, and a task PUT only ever carries
// the assignee, the due date or a status.
export function assertSafe(plan:MultiPlan){
 for(const s of plan.steps){
  const text=JSON.stringify([s.path,s.body??null,s.expected??null,s.precondition??null]);
  for(const f of B.NEVER_WRITTEN)if(text.includes(f.prefix))throw new Error(`This plan would write ${f.name}. No Blueprint press may; nothing was sent.`);
  if(s.body&&'custom_fields' in s.body)throw new Error('A Blueprint press writes card fields one by one, never in bulk. Nothing was sent.');
  if(s.method==='PUT'&&/^task\//.test(s.path)&&Object.keys(s.body??{}).some(k=>!['assignees','due_date','due_date_time','status'].includes(k)))throw new Error('A Blueprint press changes only the assignee, the due date or a status on a task. Nothing was sent.');
 }
}
async function prepareLaunch(p:B.BlueprintPayload,card:Row,provider:Provider,now:Date,lines:string[]):Promise<MultiPlan>{
 const a=p.answers,steps:Plan[]=[],first=!p.previous,csm=csmOf(card);
 const found=await findLaunch(provider,p);
 const notes:string[]=[];let step4:Plan|null=null;let step4Name='';
 if(a.starter==='yes'){
  const t=await stepTask(provider,p.step4,'4');
  if(t){step4=await doneStep(provider,t);step4Name=String(t.name);if(!step4)lines.push(`"${t.name}" is already done.`);}
  else{const n='Creative Onboarding step 4 was not found, so it is left as it is.';notes.push(n);lines.push(n);}
 }
 let launch:string;
 if(!found){
  const assignee=p.settings?.assignee&&/^\d{3,12}$/.test(String(p.settings.assignee.id))?p.settings.assignee:null;
  if(assignee){const m=await provider.call('clickup','GET',`list/${B.LAUNCH_LIST}/member`);if(!(m.members??[]).some((x:Row)=>String(x.id)===String(assignee.id)))throw new Error('The launch media buyer in Settings is not on Marketing/ADs any more. Choose another in Settings.');}
  const name=B.launchName(p.card.name),tag=B.launchTag(p.card.name),due=B.launchDue(now);
  steps.push({provider:'clickup',method:'POST',path:`list/${B.LAUNCH_LIST}/taskTemplate/${B.LAUNCH_TEMPLATE}`,body:{name},verifyPath:'task/$id',expected:{name,list:{id:B.LAUNCH_LIST}},idFrom:'task.id'});
  lines.push(`Would create "${name}" on Marketing/ADs from template ${B.LAUNCH_TEMPLATE}.`);
  steps.push({provider:'clickup',method:'POST',path:`task/$step0.id/tag/${encodeURIComponent(tag)}`,verifyPath:'task/$step0.id',expected:{},has:[{path:'tags',key:'name',value:tag}]});
  lines.push(`Would tag it "${tag}".`);
  steps.push({provider:'clickup',method:'PUT',path:'task/$step0.id',body:{...(assignee?{assignees:{add:[Number(assignee.id)]}}:{}),due_date:due.ms,due_date_time:false},verifyPath:'task/$step0.id',expected:{due_date:String(due.ms)},...(assignee?{has:[{path:'assignees' as const,key:'id' as const,value:String(assignee.id)}]}:{})});
  lines.push(assignee?`Would assign it to ${assignee.label??'the launch media buyer'}, due ${B.kuwaitDay(due.ms)}.`:`Would leave it unassigned (no launch media buyer in Settings, so nobody is pinged), due ${B.kuwaitDay(due.ms)}.`);
  const brief=B.launchBrief(p,{assigned:Boolean(assignee),notes});
  steps.push(comment('$step0.id',brief));lines.push(`Would comment the brief (${brief.split('\n').length} lines).`);
  launch='$step0.id';
 }else{
  const text=first?B.launchBrief(p,{assigned:true,notes}):B.launchUpdate(p);
  steps.push(comment(String(found.id),text));
  lines.push(`Would comment on the open task "${found.name}" and create nothing (${first?'the brief':'what changed'}, ${text.split('\n').length} lines).`);
  launch=String(found.id);
 }
 const target=B.templatedStatus(a);
 if(target){const f=field(card,'templatedAds');const s=dropdown(card.id,f,target);if(s){steps.push(s);lines.push(`Would set Templated Ads Status: ${current(f)?.name??'empty'} → ${target}.`);}}
 if(step4){steps.push(step4);lines.push(`Would complete "${step4Name}".`);}
 const cap=B.capacityComment(p);
 if(cap&&(first||B.changedKeys(['capacity','capacity_note'],p.previous,a).length)){steps.push(comment(String(card.id),cap,csm?.id));lines.push(`Would comment on the client card for ${csm?.name??'the CSM'}: capacity is ${String(a.capacity)}.`);}
 return {steps,result:{kind:'blueprintLaunch',launchTaskId:launch}};
}
async function prepareClose(p:B.BlueprintPayload,card:Row,provider:Provider,env:Env,lines:string[]):Promise<MultiPlan&{make?:Row}>{
 const a=p.answers,steps:Plan[]=[],first=!p.previous,csm=csmOf(card);
 const route=['card_only','slack','make'].includes(String(p.closeRoute))?String(p.closeRoute):'card_only';
 const makeLive=route==='make'&&env('BLUEPRINT_MAKE_CLOSE')==='on'&&Boolean(env('MAKE_BLUEPRINT_HOOK'))&&Boolean(env('MAKE_BLUEPRINT_KEY'));
 const fallback=route==='make'&&!makeLive,effective=fallback?'card_only':route;
 if(fallback)lines.push('Make close is chosen but not switched on in the server: the CSM pastes the WhatsApp.');
 const found=await findLaunch(provider,p);
 const approval=B.adApprovalNeeded(a.approval);
 if(approval){const s=dropdown(card.id,field(card,'adApproval'),approval);if(s){steps.push(s);lines.push(`Would set Ad Approval Needed?: ${approval}.`);}}
 if(effective!=='make'){
  const label=B.canSelfRecord(a.camera);if(label){const s=dropdown(card.id,field(card,'canSelfRecord'),label);if(s){steps.push(s);lines.push(`Would set Can Self-Record?: ${label}.`);}}
  if(first){const f=field(card,'onboardingMap'),url=p.mapUrl??B.mapUrl(card.id);if(String(f.value??'')!==url){steps.push({provider:'clickup',method:'POST',path:`task/${card.id}/field/${f.id}`,body:{value:url},verifyPath:`task/${card.id}`,expected:{field:f.id,value:url},precondition:{field:f.id,value:typeof f.value==='string'&&f.value?f.value:[]}});lines.push('Would set the Onboarding Map to phase 5.');}}
 }
 const t=await stepTask(provider,p.step2,'2');
 if(t){const s=await doneStep(provider,t);if(s){steps.push(s);lines.push(`Would complete "${t.name}".`);}}else lines.push('Creative Onboarding step 2 was not found, so it is left as it is.');
 if(found){const text=B.closeLaunchComment(p);steps.push(comment(String(found.id),text));lines.push(`Would comment on the launch task "${found.name}" (${text.split('\n').length} lines).`);}
 else lines.push('No open launch task was found, so the launch-task comment is skipped.');
 const whatsapp=first&&effective!=='make';
 const note=B.closeCsmComment(p,{whatsapp,launchFound:Boolean(found),makeFallback:fallback});
 steps.push(comment(String(card.id),note,csm?.id));
 lines.push(`Would comment on the client card for ${csm?.name??'the CSM'}${whatsapp?', with the phase 5 WhatsApp to paste':''}.`);
 const slackText=B.slackCloseText(p,found?String(found.id):null);
 if(first&&effective==='slack'){steps.push({provider:'slack',method:'POST',path:'chat.postMessage',body:{channel:B.MEDIA_GENERAL,text:slackText},verifyPath:'conversations.history',expected:{text:slackText},slackMessage:true});lines.push(`Would post to #media-general: "${slackText}"`);}
 let make:Row|undefined;
 if(first&&effective==='make'){make=B.makeClose(p,slackText);lines.push('Would send the close to Make 14 once (no read-back): it posts to Slack, writes Can Self-Record? and the Onboarding Map, and sends the phase 5 WhatsApp.');}
 return {steps,result:{kind:'blueprintClose',launchTaskId:found?String(found.id):null,closeRoute:effective},...(make?{make}:{})};
}
async function prepareOffer(p:B.BlueprintPayload,card:Row,provider:Provider,lines:string[]):Promise<MultiPlan>{
 const steps:Plan[]=[],first=!p.previous,csm=csmOf(card);
 const found=await findLaunch(provider,p);
 const s=dropdown(card.id,field(card,'offerCreation'),'Done');if(s){steps.push(s);lines.push('Would set Offer Creation: Done.');}
 const t=await stepTask(provider,p.step3,'3');
 if(!t)lines.push('Creative Onboarding step 3 was not found, so it is left as it is.');
 else if(p.dna_status==='complete'){const d=await doneStep(provider,t);if(d){steps.push(d);lines.push(`Would complete "${t.name}".`);}}
 else if(first){steps.push(comment(String(t.id),B.dnaMissingComment(p)));lines.push(`Would comment on "${t.name}": Brand DNA still missing.`);}
 const text=B.offerLaunchComment(p);
 if(found){steps.push(comment(String(found.id),text));lines.push(`Would comment on the launch task "${found.name}": ${first?'offer locked':'offer updated'}.`);}
 else{steps.push(comment(String(card.id),text,csm?.id));lines.push('No open launch task was found, so the offer goes on the client card.');}
 return {steps,result:{kind:'blueprintOffer',launchTaskId:found?String(found.id):null}};
}
export async function prepareBlueprint(row:Row,provider:Provider,env:Env,now=new Date()):Promise<BlueprintPlan>{
 if(!isBlueprint(row.kind))throw new Error('Unsupported client action');
 const part=({blueprintLaunch:1,blueprintClose:2,blueprintOffer:3} as Record<string,number>)[row.kind];
 const p=row.payload as B.BlueprintPayload;
 if(p?.v!==1||p.part!==part||!p.card||!CARD.test(String(row.task_id??''))||String(p.card.id)!==String(row.task_id)||String(p.card.name)!==String(row.client_name)||!p.answers||typeof p.answers!=='object')throw new Error('This Blueprint request is not one the cockpit queued. Reconcile it.');
 // Preparation reads only, whoever calls it: a stray write in a later edit fails here, before any plan
 // is shown or fenced. executeOutbox keeps the real provider for the writes.
 const reader=readOnly(provider);
 const card=await reader.call('clickup','GET',`task/${row.task_id}`);
 if(String(card.id)!==String(row.task_id))throw new Error('ClickUp did not return the client card');
 if(String(card.list?.id??'')!==B.CLIENTS_LIST)throw new Error('That task is not on the Clients list');
 if(loose(card.name)!==loose(row.client_name))throw new Error("The card's name changed since the press. Refresh, then send again.");
 const lines:string[]=[];
 const plan=part===1?await prepareLaunch(p,card,reader,now,lines):part===2?await prepareClose(p,card,reader,env,lines):await prepareOffer(p,card,reader,lines);
 assertSafe(plan);
 const {make,...rest}=plan as MultiPlan&{make?:Row};
 return {...rest,blueprint:{kind:row.kind,lines,...(make?{make}:{})}};
}
// Plain sentences for the notes window, the CD cockpit and a rehearsal.
export const describePlan=(plan:BlueprintPlan)=>[...plan.blueprint.lines];
// Rehearsal (admins and the CEO): the seat and the payload come from cockpit_blueprint_rehearse_payload,
// which refuses anyone else and writes nothing; the plan is built from ClickUp GETs only.
export async function rehearseBlueprint(args:Row,client:any,admin:any,env:Env,now=new Date(),tools=providerTools){
 const part=Number(args?.part);if(![1,2,3].includes(part))throw new Error('Choose part 1, 2 or 3');
 if(!CARD.test(String(args?.taskId??'')))throw new Error('Choose a valid ClickUp client ID');
 if(!args.answers||typeof args.answers!=='object'||Array.isArray(args.answers))throw new Error('The rehearsal needs the answers it holds');
 const {data,error}=await client.rpc('cockpit_blueprint_rehearse_payload',{p_task_id:args.taskId,p_part:part,p_answers:args.answers});if(error)throw new Error(error.message);
 const missing:string[]=Array.isArray(data?.missing)?data.missing:[];
 if(missing.length)return {dryRun:true,missing,plan:null,lines:[`Still missing: ${missing.join(', ')}.`]};
 const provider=readOnly(tools(env,async(event:Row)=>{const {error}=await admin.from('cockpit_media_provider_health').insert({...event,action_id:null});if(error)throw new Error('Could not save provider receipt');}));
 const plan=await prepareBlueprint({id:'rehearsal',kind:data.kind,task_id:data.taskId,client_name:data.clientName,payload:data.payload},provider,env,now);
 return {dryRun:true,missing,plan,lines:describePlan(plan)};
}
// The Settings picker: the members of Marketing/ADs, by ClickUp ID and name, read only.
export async function blueprintMembers(client:any,admin:any,env:Env,tools=providerTools){
 const {error}=await client.rpc('cockpit_blueprint_settings_read');if(error)throw new Error(error.message);
 const provider=readOnly(tools(env,async(event:Row)=>{const {error}=await admin.from('cockpit_media_provider_health').insert({...event,action_id:null});if(error)throw new Error('Could not save provider receipt');}));
 const res=await provider.call('clickup','GET',`list/${B.LAUNCH_LIST}/member`);
 const members=(Array.isArray(res.members)?res.members:[]).filter((m:Row)=>m&&/^\d{3,12}$/.test(String(m.id))).map((m:Row)=>({id:String(m.id),name:String(m.username??m.initials??'').trim()||'Unnamed member'}));
 return {members:members.sort((x:Row,y:Row)=>x.name.localeCompare(y.name))};
}
