import {z} from 'zod';
import {ghlTools,providerTools} from './tools.ts';
import {prepareCsm,executeCsm} from './core.ts';
import {prepareCheckIn,verifySelection,createCheckIn,CLIENT_ACCOUNT,CHECK_IN_CALENDAR} from '../../../apps/client-success-cockpit/src/lib/checkInCore.ts';
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>};
type Admin=RpcClient&{from:(table:string)=>any};
const object=z.record(z.string(),z.unknown());
const context=z.object({actorId:z.string().uuid(),email:z.string(),taskId:z.string(),clientName:z.string(),sourceSnapshotAt:z.string(),bookingWhen:z.string().optional()}).passthrough();
const input=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('checkIns.prepare'),args:z.object({taskId:z.string(),day:z.string()}),apply:z.boolean().optional(),requestId:z.string().uuid()}),
 z.object({operation:z.literal('checkIns.book'),args:z.object({taskId:z.string(),contactId:z.string().min(1),startTime:z.string()}),apply:z.boolean().optional(),requestId:z.string().uuid()}),
]);
const bookingReceipt=z.object({appointmentId:z.string().min(1),startTime:z.string(),endTime:z.string().optional()});
export class CheckInAccessError extends Error {}
export async function runCheckIn(client:RpcClient,admin:Admin,raw:unknown,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const parsed=input.parse(raw);const gate=await client.rpc('cockpit_csm_client_gate',{p_task_id:parsed.args.taskId});if(gate.error)throw new CheckInAccessError(gate.error.message);const scope=context.parse(gate.data);
 if(env('GHL_MAHARA_LOCATION')!==CLIENT_ACCOUNT)throw Error('The Mahara Media client account is not configured for check-in booking.');
 let actionId:string|undefined;
 const health=async(row:Record<string,unknown>)=>{const saved=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:actionId??null});if(saved.error)throw Error('Provider health could not be saved. Stop booking.');};
 const guard=async()=>{if(actionId){const current=await admin.rpc('cockpit_csm_check_in_guard',{p_id:actionId});if(current.error)throw Error(current.error.message);}else{const current=await client.rpc('cockpit_csm_client_gate',{p_task_id:scope.taskId});if(current.error)throw new CheckInAccessError(current.error.message);}};
 const ghl=ghlTools(env('GHL_MAHARA_PIT')??'',health,request);
 const provider=async(method:string,path:string,body?:unknown)=>{if(method!=='GET'&&method!=='POST')throw Error('Unsupported booking provider method.');await guard();return object.parse(await ghl.call(method,path.replace(/^\//,''),body===undefined?undefined:object.parse(body)));};
 if(parsed.operation==='checkIns.prepare')return prepareCheckIn(provider,scope.taskId,parsed.args.day);
 const normalized={...parsed.args,startTime:new Date(parsed.args.startTime).toISOString()};
 const claimed=await client.rpc('cockpit_csm_check_in_begin',{p_args:normalized,p_request_id:parsed.requestId,p_apply:parsed.apply===true});if(claimed.error)throw new CheckInAccessError(claimed.error.message);
 const claim=z.object({id:z.string().uuid().optional(),state:z.string().optional(),result:object.nullable().optional(),dryRun:z.boolean().optional(),context}).parse(claimed.data);
 if(parsed.apply!==true)return {dryRun:true,selection:await verifySelection(provider,scope.taskId,parsed.args.contactId,normalized.startTime)};
 if(claim.state!=='new'){
  const prior=bookingReceipt.safeParse(claim.result);
  if(prior.success)return {...prior.data,...(claim.state!=='confirmed'?{warning:'The call exists in GoHighLevel. Its cockpit update still needs checking. Do not book it again.'}:{})};
  throw Error('This client and time already have an unresolved booking. Check the calendar before trying again.');
 }
 actionId=z.string().uuid().parse(claim.id);
 let captured=false;
 try{
  const selection=await verifySelection(provider,scope.taskId,parsed.args.contactId,normalized.startTime);
  const receipt=await createCheckIn(provider,selection,scope.clientName);
  const stored=await admin.rpc('cockpit_csm_check_in_capture',{p_id:actionId,p_result:{...receipt,contactId:selection.contact.id,calendarId:CHECK_IN_CALENDAR,locationId:CLIENT_ACCOUNT,calendarName:selection.calendar.name}});if(stored.error)throw Error(stored.error.message);captured=true;
  await guard();
  const day=new Date(Date.parse(receipt.startTime)+10800000).toISOString().slice(0,10);
  const clickupBase=providerTools(env('CLICKUP_API_TOKEN')??'',row=>health({...row,provider:'clickup'}),request);
  const clickup={call:async(method:'GET'|'POST',path:string,body?:Record<string,unknown>)=>{await guard();return clickupBase.call(method,path,body);}};
  const actionContext={...scope,day,evidence:'GoHighLevel appointment '+receipt.appointmentId};
  const plan=await prepareCsm('act',{kind:'booked',value:day,action:'Check-in call booked'},actionContext,clickup);
  const confirmed=await executeCsm(plan,clickup);
  const finished=await admin.rpc('cockpit_csm_check_in_finish',{p_id:actionId,p_patch:confirmed.patch});if(finished.error)throw Error(finished.error.message);
  const current=await client.rpc('cockpit_csm_client_gate',{p_task_id:scope.taskId});if(current.error)throw new CheckInAccessError(current.error.message);
  return bookingReceipt.parse(finished.data);
 }catch(error){
  await admin.from('cockpit_csm_actions').update({state:'reconcile',error:captured?'The call exists. Its native update needs reconciliation.':'Booking outcome needs reconciliation before another POST.',finished_at:new Date().toISOString()}).eq('id',actionId).eq('state','sending');
  throw error;
 }
}
