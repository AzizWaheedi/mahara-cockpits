import {createClient} from 'npm:@supabase/supabase-js@2';
import {providerTools} from '../cockpit-media-api/tools.ts';
import {executePlan} from '../cockpit-media-api/execute.ts';
import {requestPlan,launchLink,feedbackRange,feedbackText} from './lib.ts';
import {runClientAction,executeOutbox} from './outbox.ts';
import {runBuild} from './build.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const canonical=(value:any):string=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value??null);
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('',{headers:cors});
 if(req.method!=='POST')return json({error:'POST required'},405);
 let admin:any;let actionId:string|undefined;let rowId:string|undefined;
 try{
  const env=(name:string)=>Deno.env.get(name);const url=env('SUPABASE_URL'),key=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key||!service)throw new Error('Server connection is not configured');
  const authorization=req.headers.get('Authorization')??'';
  const client=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:auth,error:authError}=await client.auth.getUser();if(authError||!auth.user)return json({error:'Sign in again'},401);
  const input=await req.json(),args=input.args??{},operation=input.operation;
  if(operation==='clientAction'){
   admin=createClient(url,service,{auth:{persistSession:false}});
   return json(await runClientAction(input,client,admin,env,auth.user.id));
  }
  if(['requestBuild','launchBuild'].includes(operation)){
   admin=createClient(url,service,{auth:{persistSession:false}});
   return json(await runBuild(input,client,admin,env,auth.user));
  }
  if(!['request','linkLaunch','retryFeedback'].includes(operation))throw new Error('Unsupported creative operation');
  const scopeRead=async()=>{const {data,error}=await client.rpc('cockpit_media_scope',{p_operation:`creativeRequests.${operation}`,p_campaign:args.campaignName});if(error)throw new Error(error.message);return data;};
  const scope=await scopeRead();const email=auth.user.email!.toLowerCase().trim();
  admin=createClient(url,service,{auth:{persistSession:false}});
  const checkScope=async()=>{if(canonical(await scopeRead())!==canonical(scope))throw new Error('Access or campaign mapping changed. Reconcile before retrying.');};
  const provider=providerTools(env,async(row)=>{
   if(row.phase==='intent'&&row.method!=='GET')await checkScope();
   const {error}=await admin.from('cockpit_media_provider_health').insert({...row,action_id:actionId??null});if(error)throw new Error('Could not save provider receipt');
  });
  let existing:any=null;let prepared:any;let patch:any;
  if(operation==='request'){
   let query=admin.from('cockpit_creative_requests').select('*').eq('campaign_name',args.campaignName).not('status','in','(reviewed,cancelled)');
   query=args.sourceAdId?query.eq('source_meta_ad_id',args.sourceAdId):query.is('source_meta_ad_id',null).eq('request_reason',args.reason);
   const found=await query.limit(1).maybeSingle();if(found.error)throw new Error(found.error.message);existing=found.data;
   if(existing){if(existing.script_task_id)return json({...existing,already_open:true});throw new Error('This request already exists but its ClickUp task is unconfirmed. Reconcile the request before retrying.');}
   const {data:campaign,error}=await admin.from('cockpit_campaigns').select('raw_data').eq('raw_data->>campaignName',args.campaignName).eq('source_deleted',false).single();if(error)throw new Error(error.message);
   prepared=await requestPlan(args,scope,input.requestId??'preview',campaign.raw_data??{},provider);
  }else{
   const found=await admin.from('cockpit_creative_requests').select('*').eq('id',args.id).eq('campaign_name',scope.campaignName).single();if(found.error)throw new Error('Creative request not found');existing=found.data;
   if(operation==='linkLaunch')patch=await launchLink(args,scope,existing,provider);
   else{
    if(existing.feedback_posted_at)return json(existing);
    const range=feedbackRange(existing);const stats=await client.rpc('cockpit_media_statistics',{p_kind:'range',p_campaign:scope.campaignName,p_start:range.beforeFrom,p_end:range.afterTo});if(stats.error)throw new Error(stats.error.message);
    const targets=[...new Set([existing.script_task_id,existing.editor_task_id].filter(Boolean))];if(!targets.length)throw new Error('There is no linked ClickUp task for this assessment');
    prepared={targets,text:feedbackText(existing,stats.data)};
   }
  }
  if(input.apply!==true)return json({dryRun:true,plan:prepared?.plan??prepared??patch});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId??''))throw new Error('A request id is required');
  await checkScope();
  const journal=await admin.from('cockpit_media_actions').insert({id:input.requestId,actor_id:auth.user.id,operation:`creativeRequests.${operation}`,campaign_name:scope.campaignName,request:{args}});
  if(journal.error){const {data:old}=await admin.from('cockpit_media_actions').select('*').eq('id',input.requestId).eq('actor_id',auth.user.id).maybeSingle();if(old?.state==='confirmed'&&old.operation===`creativeRequests.${operation}`&&canonical(old.request.args)===canonical(args))return json(old.result);throw new Error('This action needs reconciliation before retrying');}
  actionId=input.requestId;
  let result:any;
  if(operation==='request'){
   const inserted=await admin.from('cockpit_creative_requests').insert({...prepared.row,requested_by:email,last_actor:email}).select().single();if(inserted.error)throw new Error(inserted.error.message);rowId=inserted.data.id;
   const confirmed=await executePlan(prepared.plan,provider);
   await checkScope();
   const saved=await admin.from('cockpit_creative_requests').update({script_task_id:confirmed.result.id,script_task_url:confirmed.result.url??`https://app.clickup.com/t/${confirmed.result.id}`,last_actor:email,last_error:null,updated_at:new Date().toISOString()}).eq('id',rowId).is('script_task_id',null).select().single();if(saved.error)throw new Error('ClickUp task exists but its link was not saved. Reconcile before retrying.');result=saved.data;
  }else if(operation==='linkLaunch'){
   await checkScope();rowId=existing.id;
   if(Object.keys(patch).length===0)result=existing;
   else{const saved=await admin.from('cockpit_creative_requests').update({...patch,last_actor:email,updated_at:new Date().toISOString()}).eq('id',existing.id).is('launched_meta_ad_id',null).select().single();if(saved.error)throw new Error('The creative request changed while linking. Refresh and reconcile.');result=saved.data;}
  }else{
   rowId=existing.id;
   for(const task of prepared.targets){
    const old=await provider.call('clickup','GET',`task/${task}/comment`);const marker=`Creative request ${existing.id}`;
    if(!Array.isArray(old.comments))throw new Error('ClickUp comment history could not be checked');
    if(old.comments.some((c:any)=>String(c.comment_text??c.text??c.comment?.map((p:any)=>p.text??'').join('')??'').includes(marker)))continue;
    await executeOutbox({comment:{task,text:prepared.text}},provider);
   }
   await checkScope();const saved=await admin.from('cockpit_creative_requests').update({feedback_posted_at:new Date().toISOString(),feedback_error:null,last_actor:email,updated_at:new Date().toISOString()}).eq('id',rowId).eq('verdict',existing.verdict).select().single();if(saved.error)throw new Error('Feedback was posted but its receipt was not saved');result=saved.data;
  }
  const done=await admin.from('cockpit_media_actions').update({state:'confirmed',result,completed_at:new Date().toISOString()}).eq('id',actionId).eq('state','pending');if(done.error)throw new Error('Action completed but its receipt was not saved. Reconcile before retrying.');return json(result);
 }catch(error){
  const message=error instanceof Error?error.message:'Creative action failed';
  if(actionId&&admin){await admin.from('cockpit_media_actions').update({state:'reconcile',result:{error:message},completed_at:new Date().toISOString()}).eq('id',actionId).eq('state','pending');if(rowId)await admin.from('cockpit_creative_requests').update({last_error:message.slice(0,250),updated_at:new Date().toISOString()}).eq('id',rowId);}
  return json({ok:false,error:message,receiptId:actionId},400);
 }
});
