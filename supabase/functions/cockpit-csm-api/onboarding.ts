import {z} from 'zod';
import {providerTools,typeformTools} from './tools.ts';
import {LIST_ID,FORMS,cardRow,optionsOf,missingFields,formsFor,type FormData} from '../../../apps/client-success-cockpit/src/lib/onboardingCore.ts';

type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>};
type Admin=RpcClient&{from:(table:string)=>any};
const inputSchema=z.object({operation:z.literal('onboarding.refresh'),args:z.object({taskId:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),taskIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).max(200)}),apply:z.boolean().optional(),requestId:z.string().uuid()});
const contextSchema=z.object({actorId:z.string().uuid(),email:z.string(),taskId:z.string(),clientName:z.string(),sourceSnapshotAt:z.string()}).strict();
const object=z.record(z.string(),z.unknown());

export async function refreshOnboarding(client:RpcClient,admin:Admin,raw:unknown,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const input=inputSchema.parse(raw),gate=await client.rpc('cockpit_csm_client_gate',{p_task_id:input.args.taskId});
 if(gate.error)throw Error(gate.error.message);const context=contextSchema.parse(gate.data);
 // Validate all requested subjects before any provider call, not after publication.
 const initial=await client.rpc('cockpit_csm_onboarding_read',{p_task_ids:input.args.taskIds});if(initial.error)throw Error(initial.error.message);
 if(input.apply!==true)return {dryRun:true,taskId:context.taskId};
 const health=async(row:Record<string,unknown>)=>{const {error}=await admin.from('cockpit_csm_provider_health').insert(row);if(error)throw Error('Provider health could not be saved. Stop the refresh.');};
 const clickup=providerTools(env('CLICKUP_API_TOKEN')??'',row=>health({...row,provider:'clickup'}),request);
 const begun=await admin.from('cockpit_client_onboarding_runs').insert({trigger:'one',actor_email:context.email}).select('id').single();
 if(begun.error||!begun.data||typeof begun.data.id!=='number')throw Error('The client refresh could not start.');
 const runId=begun.data.id;
 try{
  const fields=object.parse(await clickup.call('GET',`list/${LIST_ID}/field`));if(!Array.isArray(fields.fields))throw Error('ClickUp returned no client field definitions.');
  const card=object.parse(await clickup.call('GET',`task/${context.taskId}`));
  const list=z.object({id:z.union([z.string(),z.number()])}).parse(card.list);
  if(String(list.id)!==LIST_ID||String(card.id)!==context.taskId||!Array.isArray(card.custom_fields))throw Error('The provider card identity is missing or changed.');
  const stamp=new Date().toISOString(),row=cardRow(card,optionsOf(fields),stamp);let formsVerified=false;let problem:string|null=null;
  try{
   const typeform=typeformTools(env('TYPEFORM_TOKEN')??'',health,request);const data:FormData={definitions:{},responses:{}};
   for(const key of Object.keys(FORMS) as (keyof typeof FORMS)[]){
    const definition=await typeform.get(`forms/${FORMS[key]}`);if(String(definition.id)!==FORMS[key]||!Array.isArray(definition.fields))throw Error('The Typeform definition is incomplete.');
    data.definitions[key]=definition;const responses:Record<string,unknown>[]=[];const seen=new Set<string>();let before='';let finished=false;
    for(let page=0;page<20;page++){
     const query=new URLSearchParams({page_size:'1000',completed:'true',query:context.taskId});if(before)query.set('before',before);
     const body=await typeform.get(`forms/${FORMS[key]}/responses?${query}`);const items=z.array(object).parse(body.items);
     for(const item of items){const token=z.string().min(1).parse(item.token);if(seen.has(token))throw Error('Typeform response pagination repeated.');seen.add(token);responses.push(item);}
     if(items.length<1000){finished=true;break;}before=z.string().min(1).parse(items[items.length-1].token);
    }
    if(!finished)throw Error('Typeform response coverage is incomplete.');data.responses[key]=responses;
   }
   row.forms=formsFor(context.taskId,data);formsVerified=true;
  }catch{problem='Typeform could not be verified. Existing submitted forms are retained. Check its provider health ledger.';}
  const missing=missingFields(fields);if(missing.length)problem=[problem,'Required ClickUp card fields are missing: '+missing.join(', ')+'. Ask an administrator to restore them.'].filter(Boolean).join(' ');
  const saved=await admin.rpc('cockpit_csm_onboarding_publish',{p_run:runId,p_actor:context.actorId,p_context:context,p_row:row,p_forms_verified:formsVerified,p_problem:problem});if(saved.error)throw Error(saved.error.message);
  const current=await client.rpc('cockpit_csm_onboarding_read',{p_task_ids:input.args.taskIds});if(current.error)throw Error(current.error.message);
  return {...object.parse(current.data),problem};
 }catch(error){
  await admin.from('cockpit_client_onboarding_runs').update({finished_at:new Date().toISOString(),ok:false,problem:'The native client refresh did not finish. Existing links and forms are unchanged.'}).eq('id',runId).is('finished_at',null);
  throw error;
 }
}
