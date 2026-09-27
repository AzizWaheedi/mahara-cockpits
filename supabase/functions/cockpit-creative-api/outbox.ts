import type {Provider,Plan,MultiPlan,Row} from '../cockpit-media-api/core.ts';
import {providerTools} from '../cockpit-media-api/tools.ts';
import {executePlan} from '../cockpit-media-api/execute.ts';
const VIDEO_LIST='901816720767',CREATIVE_LIST='901818016338',FOOTAGE_FIELD='d37a6747-c4a1-43c5-bb73-e1725ecec982';
const due=(value:unknown)=>{const s=String(value??'');const d=new Date(`${s}T09:00:00+03:00`);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||new Date(d.getTime()+10800000).toISOString().slice(0,10)!==s)throw new Error('Choose a valid due date');return d.getTime();};
export async function prepareOutbox(row:Row,provider:Provider):Promise<Plan|MultiPlan|{comment:{task:string;text:string}}> {
 const p=row.payload??{};
 if(['videoRequest','planScript'].includes(row.kind)){
  const list=row.kind==='videoRequest'?VIDEO_LIST:CREATIVE_LIST;
  if(typeof p.brief!=='string'||!p.brief.trim())throw new Error('Write the brief first');
  const name=String(row.kind==='videoRequest'?p.type||'New Video Request':p.title||'New Script Request').slice(0,180);
  const body:Row={name,description:p.brief.slice(0,50000),tags:[row.client_name.toLowerCase()]};
  if(p.due){body.due_date=due(p.due);body.due_date_time=false;}
  const steps:Plan[]=[{provider:'clickup',method:'POST',path:`list/${list}/task`,body,verifyPath:'task/$id',expected:{name,list:{id:list},...(body.due_date?{due_date:String(body.due_date)}:{})},result:{taskId:'$id',url:'$url'}}];
  if(row.kind==='videoRequest'&&p.footage)steps.push({provider:'clickup',method:'POST',path:`task/$step0.id/field/${FOOTAGE_FIELD}`,body:{value:String(p.footage)},verifyPath:'task/$step0.id',expected:{field:FOOTAGE_FIELD,value:String(p.footage)}});
  return {steps,result:{taskId:'$step0.id'}};
 }
 if(!row.task_id||!row.sourceTask)throw new Error('The source task is unavailable. Refresh the board first');
 const task=await provider.call('clickup','GET',`task/${row.task_id}`);
 if(String(task.id)!==row.task_id)throw new Error('ClickUp did not return the selected task');
 const tags=(v:unknown)=>(Array.isArray(v)?v:[]).map((x:any)=>String(typeof x==='string'?x:x.name).toLowerCase()).sort();
 if(JSON.stringify(tags(task.tags))!==JSON.stringify(tags(row.sourceTask.tags)))throw new Error('Task tags changed since the source refresh. Refresh before editing it');
 if(row.kind==='comment'){if(typeof p.text!=='string'||!p.text.trim()||p.text.length>10000)throw new Error('Write a comment of at most 10000 characters');return {comment:{task:row.task_id,text:p.text.trim()}};}
 if(row.kind==='schedule'){const day=due(p.due);return {provider:'clickup',method:'PUT',path:`task/${row.task_id}`,body:{due_date:day,due_date_time:false},verifyPath:`task/${row.task_id}`,expected:{due_date:String(day)},precondition:{due_date:task.due_date??null}};}
 if(row.kind==='complete'){
  const list=await provider.call('clickup','GET',`list/${task.list?.id}`);const done=list.statuses?.find((s:Row)=>s.type==='done')?.status;if(!done)throw new Error('This list has no done status; a cancelled status will not be used');
  return {provider:'clickup',method:'PUT',path:`task/${row.task_id}`,body:{status:done},verifyPath:`task/${row.task_id}`,expected:{status:{status:done}},precondition:{status:{status:task.status?.status}}};
 }
 throw new Error('Unsupported client action');
}
export async function executeOutbox(plan:Awaited<ReturnType<typeof prepareOutbox>>,provider:Provider){
 if(!('comment' in plan))return (await executePlan(plan,provider)).result;
 const {task,text}=plan.comment;const made=await provider.call('clickup','POST',`task/${task}/comment`,{comment_text:text,notify_all:false});
 if(!made.id)throw new Error('Comment outcome is unknown. Reconcile before retrying');
 const read=await provider.call('clickup','GET',`task/${task}/comment`);const found=read.comments?.find((c:Row)=>String(c.id)===String(made.id));const actual=found?.comment_text??found?.comment?.map((part:Row)=>part.text??'').join('');
 if(actual!==text)throw new Error('Comment was not confirmed by read-back. Reconcile before retrying');return {taskId:task,commentId:String(made.id)};
}
export async function runClientAction(input:Row,client:any,admin:any,env:(key:string)=>string|undefined,userId:string){
 let started=false;const id=input.args?.id;
 const load=async()=>{const {data,error}=await client.rpc('cockpit_creative_client_action',{p_operation:'get',p_args:{id}});if(error)throw new Error(error.message);return data;};
 const row=await load();if(row.state==='done')return {id,state:'done',result:row.result};
 if(row.state!=='pending')throw new Error('This client action needs reconciliation before retrying');
 const fence=JSON.stringify([row.client_name,row.task_id,row.actor_id,row.payload,row.sourceTask]);
 const check=async()=>{const current=await load();if(JSON.stringify([current.client_name,current.task_id,current.actor_id,current.payload,current.sourceTask])!==fence)throw new Error('Client access or task source changed. Refresh and reconcile this request');};
 const provider=providerTools(env,async(event)=>{if(event.phase==='intent'&&event.method!=='GET')await check();const {error}=await admin.from('cockpit_media_provider_health').insert({...event,action_id:started?id:null});if(error)throw new Error('Could not save provider receipt');});
 try{
  const plan=await prepareOutbox(row,provider);if(input.apply!==true)return {dryRun:true,plan};await check();
  const journal=await admin.from('cockpit_media_actions').insert({id,actor_id:userId,operation:`creativeClient.${row.kind}`,campaign_name:null,request:{outbox:row}});if(journal.error)throw new Error('This client action needs reconciliation before retrying');started=true;
  const claimed=await admin.from('cockpit_creative_outbox').update({state:'sending'}).eq('id',id).eq('state','pending').select('id').single();if(claimed.error)throw new Error('Client action was already claimed');
  const result=await executeOutbox(plan,provider);
  const done=await admin.from('cockpit_creative_outbox').update({state:'done',result,settled_at:new Date().toISOString()}).eq('id',id).eq('state','sending');if(done.error)throw new Error('Provider action completed but its result was not saved');
  const final=await admin.from('cockpit_media_actions').update({state:'confirmed',result,completed_at:new Date().toISOString()}).eq('id',id).eq('state','pending');if(final.error)throw new Error('Provider action completed but its receipt was not saved');
  return {id,state:'done',result};
 }catch(error){const message=error instanceof Error?error.message:'Client action failed';if(started){await admin.from('cockpit_creative_outbox').update({state:'reconcile',error:message.slice(0,1000)}).eq('id',id);await admin.from('cockpit_media_actions').update({state:'reconcile',result:{error:message},completed_at:new Date().toISOString()}).eq('id',id).eq('state','pending');}throw error;}
}
