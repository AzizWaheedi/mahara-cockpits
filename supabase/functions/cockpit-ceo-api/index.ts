import {createClient} from 'npm:@supabase/supabase-js@2';
import {extractText,getDocumentProxy} from 'npm:unpdf@1.8.1';
import {prepareBank,bankResult,payerList} from './core.ts';
import {runFinanceRefresh} from './financeRefresh.ts';
import {payerSources} from './tools.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
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
  if(input.operation==='queries.refreshNow'){
   if(a.only!==undefined&&(!Array.isArray(a.only)||a.only.some((key:unknown)=>!['money','expenses'].includes(String(key)))))throw Error('This endpoint refreshes Money and Expenses together.');
   if(input.apply!==true)return json({dryRun:true,sections:['money','expenses'],message:'Preview only; no refresh was queued or snapshot changed.'});
   const {data:job,error}=await client.rpc('cockpit_begin_finance_refresh');if(error)throw Error(error.message);
   if(!job.existing){
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const work=runFinanceRefresh(admin,job.id,k=>Deno.env.get(k));
    const background=(globalThis as any).EdgeRuntime?.waitUntil;
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
