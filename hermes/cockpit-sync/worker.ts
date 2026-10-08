import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {syncOnce,kuwaitToday,daysAgo} from './calculator';
import {capture,prepareTables} from './capture';
import {withNativeContext,assertNativeFence,type NativeRunContext,type Reads,type Row} from './runtime';
import {doctor,transport,type Env} from './transport';
import {archiveWinners} from './winners';
import {captureStills,storeStills,attachStoredStills} from './stills';
import {collectMarket} from './marketProducer';
import {collectCsm} from './csmProducer';
import {collectCreative} from './creativeProducer';
import {collectSharedGoogleCalendars} from './clientCalendars';

export const DRY_RUN=true;
export function bookingsInWindow(rows:Row[],from:string,to:string){
 for(const row of rows)if(typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date)))throw new Error('Booking date is unverified; no feed published');
 return rows.filter(row=>row.date>=from&&row.date<=to);
}
export async function calculate(state:Row,reads:Reads,runContext:NativeRunContext,env:Env){
 return withNativeContext(reads,runContext,async()=>{
  await assertNativeFence();
  const begun=new Date().toISOString(),captured=capture(state);
  captured.tables.marketPlays=await collectMarket(state);
  const result=await syncOnce(captured.context);
  archiveWinners(state,captured.tables);
  const stillAssets=await captureStills(state,captured.tables,reads);
  const csmResult=await collectCsm(state,captured.tables,env.FATHOM_CREATED_AFTER),csm=prepareTables(csmResult.tables,state.csm);
  const googleCalendars=await collectSharedGoogleCalendars(state,env);
  const creative=prepareTables({...state.creative,...await collectCreative(state,captured.tables,csm)},state.creative);
  const tables={...state.media,...prepareTables(captured.tables,{...state.media,campaigns:state.oldCampaigns,ads:state.oldAds,winnersArchive:state.winners,adStills:state.stills})};
  const workingDay=kuwaitToday(),windowSince=daysAgo(30);
  // Each consumer retains its imported IDs; uploads attach by provider creative identity.
  for(const table of ['campaigns','ads','metaTree','adChanges','inbox','boardCards','offBoardCampaigns','onboardings','launchWatch','dailyStats','bookingEvents','checkProposals','marketPlays','winnersArchive','adStills','clientLinks'])if(!Array.isArray(tables[table]))throw new Error(`Incomplete producer output: ${table}`);
  for(const b of tables.bookingEvents)if(!b.eventId&&!(b.contactId&&b.startTime))throw new Error('Booking event lacks stable provider identity; no publication');
  // Only refresh the declared complete window. SQL retains earlier imported history.
  tables.bookingEvents=bookingsInWindow(tables.bookingEvents,windowSince,workingDay);
  const unavailable=tables.campaigns.filter((c:Row)=>!c.internal&&c.serviceMode==='DFY'&&!c.hasGhl);
  if(unavailable.length)throw new Error(`${unavailable.length} DFY campaigns lack verified GHL source; preserve prior bookings`);
  const counts:Record<string,number>={};
  for(const [family,rows]of Object.entries({tables,csm,creative}))for(const [key,value]of Object.entries(rows) as [string,Row[]][])counts[(family==='tables'?'':family+'_')+key]=value.length;
  return {producer:'media-core',version:1,begun_at:begun,source_snapshot_at:new Date().toISOString(),working_day:workingDay,window_since:windowSince,tables,csm,creative,csmCalendar:csmResult.calendarWindow,googleCalendars,counts,result,expected:state.expected,stillAssets};
 });
}

export async function rpc(env:Env,name:string,args:Row,request:typeof fetch=fetch){
 const allowed:Record<string,true>={cockpit_native_media_state:true,cockpit_native_media_claim:true,cockpit_native_media_fence:true,cockpit_native_media_publish:true,cockpit_native_media_release:true,cockpit_native_media_doctor:true,cockpit_native_media_record_receipts:true};
 if(!Object.hasOwn(allowed,name))throw new Error('Unapproved repository operation');
 if(env.SUPABASE_URL?.replace(/\/$/,'')!=='https://bldgtotkfmhoxmlzowdx.supabase.co'||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Creative Triage service connection required');
 const send=()=>request(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});
 // A dropped pooled connection never reaches the repository. Reads and the
 // lease release are safe to resend; claims and publications never are.
 const resendable=name==='cockpit_native_media_state'||name==='cockpit_native_media_fence'||name==='cockpit_native_media_release'||name==='cockpit_native_media_doctor';
 let response:Response;
 for(let attempt=1;;attempt++){
  try{response=await send();break;}
  catch(error){if(!resendable||attempt>=3||(error as Error)?.name==='TimeoutError')throw error;await new Promise(r=>setTimeout(r,250*attempt));}
 }
 if(!response.ok)throw new Error(`Repository ${name} failed (${response.status}); no automatic write retry`);
 return response.json();
}
function outputPath(path:string){
 const absolute=resolve(path),root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),within=relative(root,absolute);
 if(!within.startsWith('..')&&!within.startsWith('/'))throw new Error('Save protected run reports outside the repository');return absolute;
}
export async function run(options:{apply?:boolean;report:string},env:Env=process.env){
 const check=doctor(env);if(!check.ok)throw new Error(`Doctor failed: ${check.missing.join(', ')}`);
 const path=outputPath(options.report);await mkdir(dirname(path),{recursive:true,mode:0o700});
 const runId=randomUUID(),reader=transport(env);let claim:Row|undefined;
 try{
  if(options.apply===true)claim=await rpc(env,'cockpit_native_media_claim',{p_run_id:runId});
  const fence:NativeRunContext['fence']=claim?async()=>{
   if(!claim?.lease_token)throw new Error('Native run lacks a live lease token');
   const live=await rpc(env,'cockpit_native_media_fence',{p_run_id:runId,p_lease_token:claim.lease_token});
   if(Date.parse(live.lease_expires_at)-Date.now()<45000)throw new Error('Insufficient live lease for storage upload');
  }:undefined;
  const runContext:NativeRunContext={receipts:reader.receipts,...(fence?{fence}:{})};
  const state=await rpc(env,'cockpit_native_media_state',{});
  const {stillAssets,...plan}=await calculate(state,reader.reads,runContext,env);
  const unhandled=reader.faults.filter(f=>f.retained_history!==true);
  if(unhandled.length)throw new Error(`${unhandled.length} source reads failed; refusing partial publication`);
  if(options.apply===true){
   if(!fence)throw new Error('Still upload lacks a live lease context');
   const savedStills=await storeStills(stillAssets,plan.tables,env,fence,reader.receipts);
   attachStoredStills(plan.creative,savedStills);
   const pictures=new Map<string,Row>(plan.tables.metaTree.filter((r:Row)=>r.kind==='ad').map((r:Row)=>[r.metaId,r]));
   for(const profile of plan.csm.clientProfiles)for(const campaign of profile.ads??[])for(const adset of campaign.adsets??[])for(const ad of adset.ads??[]){
    const picture=pictures.get(ad.metaId);
    if(picture?.stillUrl)Object.assign(ad,{stillKey:picture.stillKey,stillUrl:picture.stillUrl,stillTinyUrl:picture.stillTinyUrl});
   }
  }
  const hash=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const report:Row={dry_run:options.apply!==true,run_id:runId,lease_token:claim?.lease_token,plan_sha256:hash,plan,provider_receipts:reader.receipts,logs:reader.logs};
  await writeFile(path,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  if(options.apply===true){
   const applied=claim;if(!applied?.lease_token)throw new Error('Apply run lacks a publication fence');
   report.publication=await rpc(env,'cockpit_native_media_publish',{p_run_id:runId,p_lease_token:applied.lease_token,p_plan:plan,p_plan_sha:hash,p_receipts:reader.receipts});
   await writeFile(path,JSON.stringify(report,null,2),{mode:0o600});
  }
  return {status:options.apply?'media-core-published':'dry-run',counts:plan.counts,report:path,plan_sha256:hash};
 }catch(error){
  if(claim){
   try{await rpc(env,'cockpit_native_media_release',{p_run_id:runId,p_lease_token:claim.lease_token,p_error:'Native feed failed',p_receipts:reader.receipts});}
   catch{
    let receiptsSettled=false;
    try{await rpc(env,'cockpit_native_media_record_receipts',{p_run_id:runId,p_lease_token:claim.lease_token,p_receipts:reader.receipts});receiptsSettled=true;}catch{/* The protected failure report retains the unacknowledged receipts. */}
    await writeFile(path+'.failure.json',JSON.stringify({run_id:runId,lease_token:claim.lease_token,receipts_settled:receiptsSettled,error:'Release not confirmed; inspect fence and publication receipt before retry',provider_receipts:reader.receipts}),{flag:'wx',mode:0o600});
   }
  }
  throw error;
 }
}
if(import.meta.main){
 const args=process.argv.slice(2);
 if(args.includes('doctor')){
  const local=doctor(process.env);
  const result=args.includes('--sources')&&local.ok?{...local,repository:await rpc(process.env,'cockpit_native_media_doctor',{})}:local;
  process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.ok&&(!('repository'in result)||result.repository.ok)?0:1;
 }else{
  const index=args.indexOf('--report');if(index<0||!args[index+1])throw new Error('--report outside-repository-path is required');
  run({apply:args.includes('--apply'),report:args[index+1]}).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(error=>{process.stderr.write(`Native feed failed; inspect private report and provider health ledger. Cause: ${String((error as Error)?.name??'Error')}: ${String((error as Error)?.message??error).replace(/eyJ[\w.-]+|sb_secret_\w+/g,'[redacted]').slice(0,300)}\n`);process.exitCode=1;});
 }
}
