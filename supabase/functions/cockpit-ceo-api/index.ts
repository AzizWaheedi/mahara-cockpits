import {createClient} from 'npm:@supabase/supabase-js@2';
import {extractText,getDocumentProxy} from 'npm:unpdf@1.8.1';
import {prepareBank,bankResult,payerList} from './core.ts';
import {runFinanceRefresh} from './financeRefresh.ts';
import {googleDirectoryToken,metaGraph,payerSources} from './tools.ts';
import {financeSources} from './finance/tools.ts';
import {parseFrequencyRead,readFrequencyWindow} from './frequency.ts';
import {readAdsWindow,readContentWindow} from './windows.ts';
import {readDirectoryPages,workspaceSourceHash,type WorkspaceUser} from './workspace.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
type ProviderRow=Record<string,unknown>;
function isProviderRow(value:unknown):value is ProviderRow{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function requiredString(args:ProviderRow,key:string):string{
 const value=args[key];
 if(typeof value!=='string'||!value.trim())throw Error(`Choose a valid ${key}.`);
 return value;
}
function workspaceEmails(args:ProviderRow):string[]{
 const value=args.emails;
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('Choose valid Workspace email addresses.');
 const values:unknown[]=value;
 const emails:string[]=[];
 for(const email of values){
  if(typeof email!=='string'||!email.trim())throw Error('Choose valid Workspace email addresses.');
  emails.push(email.trim());
 }
 return emails;
}
const WORKSPACE_REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('',{headers:cors});
 if(req.method!=='POST')return json({error:'POST required'},405);
 try{
  const authorization=req.headers.get('Authorization')??'';
  if(!authorization.startsWith('Bearer '))return json({error:'Sign in first'},401);
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {error:gate}=await client.rpc('cockpit_ceo_action',{p_action:'settings.get',p_args:{}});
  if(gate)return json({error:gate.message},403);
  if(Number(req.headers.get('content-length')??0)>13000000)throw Error('Choose a file under 8 MB.');
  const input=await req.json(),a=input.args??{};
  const operation:unknown=input.operation;
  if(typeof operation==='string'&&operation.startsWith('ceo.')){
   const rawArgs:unknown=a;
   if(!isProviderRow(rawArgs))throw Error('CEO provider arguments must be an object.');
   const {data:identity,error:identityError}=await client.auth.getUser();
   if(identityError||!identity.user)throw Error('Founder session could not be verified.');
   const supabaseUrl=Deno.env.get('SUPABASE_URL');
   const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
   if(!supabaseUrl||!serviceKey)throw Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for CEO provider health receipts.');
   const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
   const recordHealth=async(row:ProviderRow)=>{
    const {error}=await admin.from('cockpit_ceo_provider_health').insert(row);
    if(error)throw Error('CEO provider health receipt could not be saved.');
   };
   const env=(name:string)=>Deno.env.get(name)??undefined;
   if(operation==='ceo.frequency.forRange'){
    const from=requiredString(rawArgs,'from'),to=requiredString(rawArgs,'to');
    const {data:cached,error:cacheError}=await admin.from('cockpit_ceo_frequency_cache').select('computed_at,payload').eq('from_day',from).eq('to_day',to).maybeSingle();
    if(cacheError)throw Error('Frequency cache is unavailable. Apply supabase/migrations/20261004e_cockpit_ceo_providers.sql.');
    const cacheValue:unknown=cached;
    if(isProviderRow(cacheValue)){
     const read=parseFrequencyRead(cacheValue.payload);
     const cachedAt=typeof cacheValue.computed_at==='string'?Date.parse(cacheValue.computed_at):NaN;
     const age=Date.now()-cachedAt;
     if(read&&read.from===from&&read.to===to&&Number.isFinite(age)&&age>=0&&age<3*60*60_000)return json(read);
    }
    const read=await readFrequencyWindow(from,to,(path,params={})=>metaGraph(env,recordHealth,fetch,path,params));
    const {data:saved,error:saveError}=await admin.rpc('cockpit_ceo_frequency_cache_upsert',{p_actor_id:identity.user.id,p_payload:read});
    if(saveError||!isProviderRow(saved)||saved.ok!==true)throw Error('Meta confirmed frequency, but the CEO cache write was not confirmed.');
    return json(read);
   }
   if(operation==='ceo.windows.ads'||operation==='ceo.windows.content'){
    const from=requiredString(rawArgs,'from'),to=requiredString(rawArgs,'to');
    const readSql=financeSources(env('COCKPIT_MANAGEMENT_TOKEN')??'',recordHealth);
    if(operation==='ceo.windows.ads'){
     const readMeta=(path:string,params:Record<string,string|number>={})=>metaGraph(env,recordHealth,fetch,path,params);
     return json(await readAdsWindow(from,to,{readSql,readMeta}));
    }
    return json(await readContentWindow(from,to,{readSql}));
   }
   if(operation==='ceo.people.workspace'||operation==='ceo.people.importWorkspace'){
    let requestId='';
    let emails:string[]=[];
    const apply=operation==='ceo.people.importWorkspace'&&input.apply===true;
    if(operation==='ceo.people.importWorkspace'){
     requestId=requiredString(rawArgs,'requestId');
     if(!WORKSPACE_REQUEST_ID.test(requestId))throw Error('Workspace import request ID is invalid. Retry from the roster screen.');
     emails=workspaceEmails(rawArgs);
     const {data:prior,error:priorError}=await admin.rpc('cockpit_ceo_workspace_import',{
      p_actor_id:identity.user.id,p_request_id:requestId,p_source_hash:null,p_source_complete:false,p_users:null,p_emails:[],p_apply:false,
     });
     if(priorError)throw Error(priorError.message);
     if(!isProviderRow(prior))throw Error('Workspace import retry status was not confirmed.');
     if(prior.existing===true)return json(prior);
     if(prior.existing!==false)throw Error('Workspace import retry status was not confirmed.');
    }
    const token=await googleDirectoryToken(env,recordHealth,fetch);
    const users:WorkspaceUser[]=await readDirectoryPages(token,recordHealth,fetch);
    if(operation==='ceo.people.workspace')return json({ok:true,users});
    const sourceHash=await workspaceSourceHash(users,emails);
    const {data:imported,error:importError}=await admin.rpc('cockpit_ceo_workspace_import',{
     p_actor_id:identity.user.id,p_request_id:requestId,p_source_hash:sourceHash,p_source_complete:true,
     p_users:users,p_emails:emails,p_apply:apply,
    });
    if(importError)throw Error(importError.message);
    if(!isProviderRow(imported)||imported.ok!==true||!Array.isArray(imported.added)
      ||typeof imported.alreadyThere!=='number'||!Number.isSafeInteger(imported.alreadyThere)
      ||typeof imported.requestId!=='string'||imported.requestId.toLowerCase()!==requestId.toLowerCase()
      ||imported.dryRun!==!apply)throw Error('Workspace import was not confirmed.');
    return json(imported);
   }
   throw Error(`Unsupported CEO provider operation: ${operation}`);
  }
  if(input.operation==='queries.refreshNow'){
   if(a.only!==undefined&&(!Array.isArray(a.only)||a.only.some((key:unknown)=>!['money','expenses'].includes(String(key)))))throw Error('This endpoint refreshes Money and Expenses together.');
   if(input.apply!==true)return json({dryRun:true,sections:['money','expenses'],message:'Preview only; no refresh was queued or snapshot changed.'});
   const {data:job,error}=await client.rpc('cockpit_begin_finance_refresh');if(error)throw Error(error.message);
   if(!job.existing){
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const work=runFinanceRefresh(admin,job.id,k=>Deno.env.get(k));
    const edgeRuntime=globalThis as typeof globalThis & {EdgeRuntime?:{waitUntil?:(promise:Promise<unknown>)=>void}};
    const background=edgeRuntime.EdgeRuntime?.waitUntil;
    if(background)background(work);else await work;
   }
   return json({id:job.id,status:'running',revision:job.revision},202);
  }
  if(input.operation==='payers.list'){
   const {data:context,error}=await client.rpc('cockpit_ceo_action',{p_action:'payers.context',p_args:{}});if(error)throw Error(error.message);
   const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
   const source=await payerSources(k=>Deno.env.get(k),async row=>{const {error}=await admin.from('cockpit_ceo_provider_health').insert(row);if(error)throw Error('Could not save source health receipt');});
   return json(payerList(source,context));
  }
  if(!['bankImport.importStatement','bankPdf.importPdf'].includes(input.operation))throw Error('Unsupported CEO provider operation');
  let text=a.text;
  if(input.operation==='bankPdf.importPdf'){
   if(typeof a.base64!=='string'||a.base64.length>12000000)throw Error('Choose a PDF under 8 MB.');
   const bytes=Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0));if(bytes.length>8388608)throw Error('Choose a PDF under 8 MB.');
   const pdf=await getDocumentProxy(bytes);const parsed=await extractText(pdf,{mergePages:false});text=(parsed.text as string[]).join('\n\f\n');
   if(!text.trim())throw Error('No text could be read from that PDF. Export a text statement from CBK Online.');
  }
  const plan=prepareBank(String(a.fileName??'statement'),text);
  if(input.apply!==true)return json({dryRun:true,statement:plan.body.statement,read:plan.body.lines.length,problems:plan.body.problems});
  const {data,error}=await client.rpc('cockpit_ceo_action',{p_action:'bankImport.commit',p_args:plan.body});
  if(error)throw Error(error.message);
  return json(bankResult(plan,data));
 }catch(e){return json({error:e instanceof Error?e.message:'CEO operation failed'},400);}
});
