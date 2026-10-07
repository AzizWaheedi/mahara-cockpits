import {z} from 'zod';
import {ghlTools,providerTools} from './tools.ts';
import {prepareCsm,executeCsm} from './core.ts';
import {prepareCheckIn,verifySelection,createCheckIn,findContact,callOf,stageAfterBooking,CLIENT_ACCOUNT} from '../../../apps/client-success-cockpit/src/lib/checkInCore.ts';
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>};
type Admin=RpcClient&{from:(table:string)=>any};
const object=z.record(z.string(),z.unknown());
const kind=z.enum(['onboarding','blueprint','launch','checkin']);
const context=z.object({actorId:z.string().uuid(),email:z.string(),taskId:z.string(),clientName:z.string(),sourceSnapshotAt:z.string(),bookingWhen:z.string().optional(),kind:kind.optional(),nextCallAt:z.string().nullable().optional()}).passthrough();
const input=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('checkIns.contact'),args:z.object({taskId:z.string()}).strict(),apply:z.boolean().optional(),requestId:z.string().uuid()}),
 z.object({operation:z.literal('checkIns.prepare'),args:z.object({taskId:z.string(),day:z.string(),kind:kind.optional()}).strict(),apply:z.boolean().optional(),requestId:z.string().uuid()}),
 z.object({operation:z.literal('checkIns.book'),args:z.object({taskId:z.string(),contactId:z.string().min(1),startTime:z.string().datetime({offset:true}),kind:kind.optional()}).strict(),apply:z.boolean().optional(),requestId:z.string().uuid()}),
]);
const bookingReceipt=z.object({appointmentId:z.string().min(1),startTime:z.string(),endTime:z.string().optional(),stage:z.string().nullable().optional()});
const STATUS_FIELD='9368ca9e-3549-4320-84ff-9abd0a2901cb';
function providerStage(task:Record<string,any>,taskId:string){
 if(String(task.id)!==taskId)throw Error('ClickUp returned another client card. Reconcile the booked call.');
 const field=task.custom_fields?.find((f:Record<string,any>)=>f.id===STATUS_FIELD);
 const option=field?.type_config?.options?.find((o:Record<string,any>)=>String(o.id)===String(field.value)||(o.orderindex!==undefined&&String(o.orderindex)===String(field.value)));
 return typeof option?.name==='string'?option.name:typeof option?.label==='string'?option.label:null;
}
export class CheckInAccessError extends Error {}
export async function runCheckIn(client:RpcClient,admin:Admin,raw:unknown,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const parsed=input.parse(raw);const gate=await client.rpc('cockpit_csm_client_gate',{p_task_id:parsed.args.taskId});if(gate.error)throw new CheckInAccessError(gate.error.message);const scope=context.parse(gate.data);
 if(env('GHL_MAHARA_LOCATION')!==CLIENT_ACCOUNT)throw Error('The Mahara Media client account is not configured for call booking.');
 let actionId:string|undefined;
 const health=async(row:Record<string,unknown>)=>{const saved=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:actionId??null});if(saved.error)throw Error('Provider health could not be saved. Stop booking.');};
 const guard=async()=>{
  const current=actionId?await admin.rpc('cockpit_csm_check_in_guard',{p_id:actionId}):await client.rpc('cockpit_csm_client_gate',{p_task_id:scope.taskId});
  if(current.error)throw new CheckInAccessError(current.error.message);
  const fresh=context.parse(current.data);
  if(fresh.actorId!==scope.actorId||fresh.email!==scope.email||fresh.taskId!==scope.taskId||fresh.clientName!==scope.clientName||fresh.sourceSnapshotAt!==scope.sourceSnapshotAt)throw new CheckInAccessError('Client access or source changed. Reopen booking.');
  return fresh;
 };
 const ghl=ghlTools(env('GHL_MAHARA_PIT')??'',health,request);
 const provider=async(method:string,path:string,body?:unknown)=>{if(method!=='GET'&&method!=='POST')throw Error('Unsupported booking provider method.');await guard();return object.parse(await ghl.call(method,path.replace(/^\//,''),body===undefined?undefined:object.parse(body)));};
 if(parsed.operation==='checkIns.contact'){
  const contact=await findContact(provider,scope.taskId);
  await guard();
  return contact;
 }
 const call=callOf(parsed.args.kind);
 if(parsed.operation==='checkIns.prepare'){
  const prepared=await prepareCheckIn(provider,scope.taskId,parsed.args.day,Date.now(),call.kind);
  await guard();
  return prepared;
 }
 const normalized={...parsed.args,kind:call.kind,startTime:new Date(parsed.args.startTime).toISOString()};
 const claimed=await client.rpc('cockpit_csm_check_in_begin',{p_args:normalized,p_request_id:parsed.requestId,p_apply:parsed.apply===true});if(claimed.error)throw new CheckInAccessError(claimed.error.message);
 const claim=z.object({id:z.string().uuid().optional(),state:z.string().optional(),result:object.nullable().optional(),dryRun:z.boolean().optional(),context}).parse(claimed.data);
 if(parsed.apply!==true){
  const selection=await verifySelection(provider,scope.taskId,parsed.args.contactId,normalized.startTime,Date.now(),call.kind);
  await guard();
  return {dryRun:true,selection};
 }
 if(claim.state!=='new'){
  const prior=bookingReceipt.safeParse(claim.result);
  if(prior.success)return {...prior.data,...(claim.state!=='confirmed'?{warning:'The call exists in GoHighLevel. Its cockpit update still needs checking. Do not book it again.'}:{})};
  throw Error('This client and time already have an unresolved booking. Check the calendar before trying again.');
 }
 actionId=z.string().uuid().parse(claim.id);
 let captured=false;
 try{
  const selection=await verifySelection(provider,scope.taskId,parsed.args.contactId,normalized.startTime,Date.now(),call.kind);
  const receipt=await createCheckIn(provider,selection,scope.clientName);
  const stored=await admin.rpc('cockpit_csm_check_in_capture',{p_id:actionId,p_result:{...receipt,kind:call.kind,contactId:selection.contact.id,calendarId:selection.calendar.id,locationId:CLIENT_ACCOUNT,calendarName:selection.calendar.name}});if(stored.error)throw Error(stored.error.message);captured=true;
  const day=new Date(Date.parse(receipt.startTime)+10800000).toISOString().slice(0,10);
  const clickupBase=providerTools(env('CLICKUP_API_TOKEN')??'',row=>health({...row,provider:'clickup'}),request);
  const clickup={call:async(method:'GET'|'POST',path:string,body?:Record<string,unknown>)=>{await guard();return clickupBase.call(method,path,body);}};
  const actionContext={...scope,day,evidence:'GoHighLevel appointment '+receipt.appointmentId};
  const patch:Record<string,unknown>={};
  const fresh=await guard(),next=fresh.nextCallAt?Date.parse(fresh.nextCallAt):NaN;
  if(!Number.isFinite(next)||next<=Date.now()||next>Date.parse(receipt.startTime)){
   const plan=await prepareCsm('act',{kind:'booked',value:day,action:call.label+' booked'},actionContext,clickup);
   Object.assign(patch,(await executeCsm(plan,clickup)).patch);
  }
  if(call.stage){
   const current=providerStage(await clickup.call('GET','task/'+scope.taskId),scope.taskId);
   if(current===null)throw Error('The current ClickUp client stage could not be read. Reconcile the booked call.');
   const stage=stageAfterBooking(current,call.kind);
   if(stage){
    const plan=await prepareCsm('act',{kind:'stage',value:stage,action:'Moved to '+stage},{...actionContext,evidence:call.label+' booked, '+actionContext.evidence},clickup);
    // Re-read immediately before writing so an advanced provider stage never moves back.
    const latest=providerStage(await clickup.call('GET','task/'+scope.taskId),scope.taskId);
    if(latest===null)throw Error('The current ClickUp client stage could not be read. Reconcile the booked call.');
    if(stageAfterBooking(latest,call.kind))Object.assign(patch,(await executeCsm(plan,clickup)).patch);
   }
  }
  const finished=await admin.rpc('cockpit_csm_check_in_finish',{p_id:actionId,p_patch:patch});if(finished.error)throw Error(finished.error.message);
  const current=await client.rpc('cockpit_csm_client_gate',{p_task_id:scope.taskId});if(current.error)throw new CheckInAccessError(current.error.message);
  return bookingReceipt.parse(finished.data);
 }catch(error){
  const saved=await admin.from('cockpit_csm_actions').update({state:'reconcile',error:captured?'The call exists. Its native update needs reconciliation.':'Booking outcome needs reconciliation before another POST.',finished_at:new Date().toISOString()}).eq('id',actionId).eq('state','sending');
  if(saved.error)throw Error('The booking and its failure receipt need reconciliation. Do not book again.');
  throw error;
 }
}
