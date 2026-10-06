import {createClient} from 'npm:@supabase/supabase-js@2';
import {confirmed,OPERATIONS,prepare,type Row} from './core.ts';
import {providerTools} from './tools.ts';
import {executePlan,prepareRecommendation} from './execute.ts';
import {prepareLtv} from './ltv.ts';
import {buildDraft,copyIdeas,prepareLaunch,toDraft,checkDraft} from './launch.ts';
import {prepareSlack,prepareDetail} from './slack.ts';
import {cachedPreview,readAdPreview} from './preview.ts';
import {executeWhatsappReply} from './whatsapp.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const sorted=(value:any):any=>value&&typeof value==='object'?(Array.isArray(value)?value.map(sorted):Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sorted(value[k])]))):value;
const canonical=(value:any):string=>JSON.stringify(sorted(value));
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS') return new Response('',{headers:cors});
 if(req.method!=='POST') return json({ok:false,error:'POST required'},405);
 let actionId:string|undefined; let admin:any;
 try {
  const env=(key:string)=>Deno.env.get(key);
  const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service) throw new Error('Server connection is not configured');
  const authorization=req.headers.get('Authorization')??'';
  if(!authorization.startsWith('Bearer ')) return json({ok:false,error:'Sign in first'},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:auth,error:authError}=await userClient.auth.getUser();
  if(authError||!auth.user) return json({ok:false,error:'Sign in again'},401);
  const input=await req.json(); const operation=input.operation; const args=input.args??{};
  if(!OPERATIONS.has(operation)) return json({ok:false,error:`Unsupported provider operation: ${String(operation)}`},400);
  if(operation==='comms.sendReply'){
   admin=createClient(url,service,{auth:{persistSession:false}});
   return json(await executeWhatsappReply(userClient,admin,args,env));
  }
  const scopeCall=()=>operation==='previews.fresh'?userClient.rpc('cockpit_ad_preview_scope',{p_ad:args.adId}):operation==='cockpit.askForDetail'?userClient.rpc('cockpit_media_task_scope',{p_task:args.taskId}):operation==='edit.askViktorFor'?userClient.rpc('cockpit_media_request_scope',{p_campaign:args.campaignName??null,p_client:args.client??null}):userClient.rpc('cockpit_media_scope',{p_operation:operation,p_campaign:args.campaignName??(args.level==='campaign'?args.name:null)});
  const {data:scope,error:scopeError}=await scopeCall();
  if(scopeError) return json({ok:false,error:scopeError.message},403);
  let serverPreview:Row|null=null;
  const ltvPreview=async()=>{const {data,error}=await userClient.rpc('cockpit_ceo_action',{p_action:'ltv.preview',p_args:{}});if(error)throw new Error(error.message);return data as Row;};
  if(operation==='ceo.ltv.apply')serverPreview=await ltvPreview();
  admin=createClient(url,service,{auth:{persistSession:false}});
  const health=async(row:Row)=>{
   if(row.phase==='intent'&&row.method!=='GET'){
    const {data:current,error:currentError}=await scopeCall();
    if(currentError||canonical(current)!==canonical(scope))throw new Error('Access or campaign mapping changed before the provider write. Reconcile this request.');
    if(serverPreview&&canonical(await ltvPreview())!==canonical(serverPreview))throw new Error('The LTV source changed while applying. Refresh and reconcile this request.');
   }
   const {error}=await admin.from('cockpit_media_provider_health').insert({...row,action_id:actionId??null});
   if(error) throw new Error('Could not save provider health receipt');
  };
  const provider=providerTools(env,health);
  if(operation==='previews.fresh'){
   const format=args.format??'MOBILE_FEED_STANDARD';
   const {data:cached,error:cacheError}=await admin.from('cockpit_ad_preview_cache').select('payload,account_id,campaign_id').eq('ad_id',args.adId).eq('format',format).maybeSingle();
   if(cacheError)throw new Error('The native preview cache is unavailable. Apply 20261005c_cockpit_ad_previews.sql in the coordinated release.');
   const reusable=cached&&(!scope.account||scope.account===cached.account_id)&&(!scope.campaign||scope.campaign===cached.campaign_id)?cachedPreview(cached.payload,args.adId):null;
   const fresh=reusable?null:await readAdPreview(args,scope,provider);
   const finalScope=await scopeCall();
   if(finalScope.error||canonical(finalScope.data)!==canonical(scope))throw new Error('Access or ad ownership changed. The preview was discarded.');
   if(fresh?.result.ok){
    const {data:saved,error:saveError}=await admin.rpc('cockpit_ad_preview_cache_save',{p_actor:auth.user.id,p_ad:args.adId,p_format:fresh.format,p_account:fresh.accountId,p_campaign:fresh.campaignId,p_payload:fresh.result});
    if(saveError||saved?.ok!==true)throw new Error('Meta confirmed the preview, but its native cache receipt was not confirmed.');
   }
   return json(reusable??fresh!.result);
  }
  const draftRpc=async(action:string,params:Row)=>{const {data,error}=await userClient.rpc('cockpit_b2b_draft_action',{p_action:action,p_args:params});if(error)throw new Error(error.message);return data;};
  if(input.apply===true&&/^[0-9a-f-]{36}$/i.test(input.requestId??'')){
   const {data:prior}=await admin.from('cockpit_media_actions').select('*').eq('id',input.requestId).eq('actor_id',auth.user.id).maybeSingle();
   if(prior){if(prior.operation===operation&&canonical(prior.request.args)===canonical(args)&&prior.state==='confirmed')return json(prior.result);throw new Error('This request already has a provider intent. Reconcile it before retrying.');}
  }
  if(operation==='ceo.b2bLaunch.list')return json((await draftRpc('list',{})).map(toDraft));
  if(operation==='ceo.b2bLaunch.save'||operation==='ceo.b2bLaunch.discard'){
   if(input.apply!==true)return json({ok:false,dryRun:true,message:'No draft was changed'});
   return json({...toDraft(await draftRpc(operation.endsWith('save')?'save':'discard',args)),ok:true});
  }
  if(operation==='board.dismissOffBoard'){
   if(input.apply!==true)return json({ok:false,dryRun:true,message:'No campaign was dismissed'});
   const {data,error}=await userClient.rpc('cockpit_dismiss_offboard',{p_campaign:args.campaignName});if(error)throw new Error(error.message);return json(data);
  }
  if(operation==='ceo.b2bManage.copyIdeas'){
   if(input.apply!==true)return json({ok:false,dryRun:true,message:'No model was called'});
   const generated=await copyIdeas(args,provider,env,health);const finalScope=await scopeCall();if(finalScope.error||canonical(finalScope.data)!==canonical(scope))throw new Error('Access changed while generating copy');return json({...generated,ok:true});
  }
  if(operation==='ceo.b2bLaunch.build'){
   checkDraft(args);if(input.apply!==true)return json({ok:false,dryRun:true,message:'No draft was created or model called'});
   if(!/^[0-9a-f-]{36}$/i.test(input.requestId??''))throw new Error('A request id is required');
   const started=await draftRpc('begin',{...args,requestId:input.requestId}),draft=started.draft;
   if(!started.created){if(draft.status==='building')throw new Error('This draft is still building or was interrupted. Refresh the list; discard it before rebuilding.');return json({...toDraft(draft),ok:true});}
   try{
    const patch=await buildDraft(args,provider,env,health);const finalScope=await scopeCall();if(finalScope.error||canonical(finalScope.data)!==canonical(scope))throw new Error('Access changed while building this draft');const {data,error}=await admin.from('cockpit_ad_drafts').update(patch).eq('id',draft.id).eq('status','building').select('*').single();if(error)throw new Error('The draft changed while building; refresh the list');return json({...toDraft(data),ok:true});
   }catch(error){const message=error instanceof Error?error.message:'Draft build failed';const {data,error:updateError}=await admin.from('cockpit_ad_drafts').update({status:'failed',error:message}).eq('id',draft.id).eq('status','building').select('*').maybeSingle();if(updateError||!data)throw new Error(message);return json({...toDraft(data),ok:true});}
  }
  let launchDraft:Row|null=null;if(operation==='ceo.b2bLaunch.launch')launchDraft=await draftRpc('get',{id:args.id});
  // Explicit apply is required. An omitted flag always rehearses without a provider write.
  const plan=launchDraft?await prepareLaunch(launchDraft,provider):operation==='execute.runAction'?await prepareRecommendation(args,scope,provider):operation==='edit.askViktorFor'?prepareSlack(args,scope,auth.user.email??'the signed-in media buyer',env):operation==='cockpit.askForDetail'?await prepareDetail(args,scope,auth.user.email??'the signed-in media buyer',provider):serverPreview?await prepareLtv(args,serverPreview,provider):await prepare(operation,args,scope,provider);
  if('read' in plan) return json(plan.read);
  if(input.apply!==true) return json({ok:false,dryRun:true,plan,message:'Preview only; no provider change was made'});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId??'')) throw new Error('A request id is required');
  const {data:latest,error:latestError}=await scopeCall();
  if(latestError||canonical(latest)!==canonical(scope)) throw new Error('Access or campaign mapping changed. Refresh before applying.');
  const request={args,plan,...(serverPreview?{source:serverPreview}:{})};
  const {error:insertError}=await admin.from('cockpit_media_actions').insert({id:input.requestId,actor_id:auth.user.id,operation,campaign_name:scope.campaignName??null,request});
  if(insertError) {
   const {data:prior}=await admin.from('cockpit_media_actions').select('*').eq('id',input.requestId).eq('actor_id',auth.user.id).maybeSingle();
   if(prior?.operation===operation&&canonical(prior.request.args)===canonical(args)&&prior.state==='confirmed') return json(prior.result);
   throw new Error('This request may already have reached the provider. Reconcile it before retrying.');
  }
  actionId=input.requestId;
  if(launchDraft){const {error}=await admin.rpc('cockpit_claim_b2b_launch',{p_action_id:actionId,p_draft_id:launchDraft.id,p_expected:launchDraft});if(error)throw new Error(error.message);}
  const executed=await executePlan(plan,provider),actual=executed.actual;
  const result:Row={...executed.result,ok:true,receiptId:actionId};
  const {error:finishError}=await admin.rpc('cockpit_finish_media_action',{p_id:actionId,p_result:result,p_actual:actual});
  if(finishError) throw new Error('Provider changed, but the local receipt was not finalized. Reconcile before retrying.');
  return json(result);
 } catch(error) {
  const message=error instanceof Error?error.message:'Provider action failed';
  if(actionId&&admin) await admin.from('cockpit_media_actions').update({state:'reconcile',result:{ok:false,error:message},completed_at:new Date().toISOString()}).eq('id',actionId).eq('state','pending');
  return json({ok:false,error:message,receiptId:actionId},400);
 }
});
