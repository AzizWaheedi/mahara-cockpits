import {createClient} from 'npm:@supabase/supabase-js@2';
import {providerTools} from './tools.ts';
import {prepareCsm,executeCsm} from './core.ts';
import {runProjectionOperation,ProjectionAccessError} from './projections.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const canonical=(v:any):string=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('',{headers:cors});if(req.method!=='POST')return json({error:'POST required'},405);
 let admin:any,actionId:string|undefined;
 try{
  const auth=req.headers.get('Authorization')??'';if(!auth.startsWith('Bearer '))return json({error:'Sign in first'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const input=await req.json(),args=input.args??{},operation=input.operation;
  if(operation==='projections.bookCall'||operation==='projections.refreshBillingNow'){
   const providerAdmin=createClient(url,service,{auth:{persistSession:false}});
   return json(await runProjectionOperation(client,providerAdmin,input,name=>Deno.env.get(name)));
  }
  const scope=()=>client.rpc('cockpit_csm_action_context',{p_operation:operation,p_args:args});const {data:context,error:gate}=await scope();if(gate)return json({error:gate.message},403);
  admin=createClient(url,service,{auth:{persistSession:false}});
  if(input.apply===true){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId??''))throw Error('An action request id is required');
   const {data:prior,error:priorError}=await admin.from('cockpit_csm_actions').select('*').eq('id',input.requestId).eq('actor_id',context.actorId).maybeSingle();
   if(priorError)throw Error('Could not inspect the prior action receipt');
   if(prior){if(prior.state==='confirmed'&&prior.operation===operation&&canonical(prior.request)===canonical(args))return json(prior.result);throw Error('This request may have reached ClickUp. Reconcile it before retrying.');}
  }
  const provider=providerTools(Deno.env.get('CLICKUP_API_TOKEN')??'',async row=>{const {error}=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:actionId??null});if(error)throw Error('Could not save provider health receipt');});
  const plan=await prepareCsm(operation,args,context,provider);
  if(input.apply!==true)return json({dryRun:true,plan});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId??''))throw Error('An action request id is required');
  const {data:fresh,error:again}=await scope();if(again||canonical(fresh)!==canonical(context))throw Error('Client access or source changed; refresh before applying');
  const {error:insert}=await admin.from('cockpit_csm_actions').insert({id:input.requestId,operation,actor_id:context.actorId,actor_email:context.email,context,request:args});
  if(insert){const {data:prior}=await admin.from('cockpit_csm_actions').select('*').eq('id',input.requestId).eq('actor_id',context.actorId).maybeSingle();if(prior?.state==='confirmed'&&prior.operation===operation&&canonical(prior.request)===canonical(args))return json(prior.result);throw Error('This request may have reached ClickUp. Reconcile it before retrying.');}
  actionId=input.requestId;const done=await executeCsm(plan,provider);
  const {data:result,error:finish}=await admin.rpc('cockpit_finish_csm_action',{p_id:actionId,p_result:done.result,p_patch:done.patch});if(finish)throw Error('ClickUp changed but its local confirmation failed. Reconcile before retrying.');
  return json(result);
 }catch(error){const message=error instanceof Error?error.message:'Client-success action failed';if(admin&&actionId)await admin.from('cockpit_csm_actions').update({state:'reconcile',error:message.slice(0,1500),finished_at:new Date().toISOString()}).eq('id',actionId).eq('state','sending');return json({error:message},error instanceof ProjectionAccessError?403:400);}
});
