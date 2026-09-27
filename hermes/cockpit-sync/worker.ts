import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {syncOnce,kuwaitToday} from './calculator';
import {capture,prepareTables} from './capture';
import {withReads,type Reads,type Row} from './runtime';
import {doctor,transport,type Env} from './transport';
export const DRY_RUN=true;
export async function calculate(state:Row,reads:Reads){
 const begun=new Date().toISOString(),captured=capture(state);
 const result=await withReads(reads,()=>syncOnce(captured.context));
 const tables=prepareTables(captured.tables);
 for(const table of ['campaigns','ads','metaTree','adChanges','inbox','boardCards','offBoardCampaigns','onboardings','launchWatch','dailyStats','bookingEvents','checkProposals'])if(!Array.isArray(tables[table]))throw new Error(`Incomplete producer output: ${table}`);
 for(const b of tables.bookingEvents)if(!b.eventId&&!(b.contactId&&b.startTime))throw new Error('Booking event lacks stable provider identity; no publication');
 const unavailable=tables.campaigns.filter(c=>!c.internal&&c.serviceMode==='DFY'&&!c.hasGhl);
 if(unavailable.length)throw new Error(`${unavailable.length} DFY campaigns lack their verified GHL source; preserve prior bookings`);
 return {producer:'media-core',version:1,begun_at:begun,source_snapshot_at:new Date().toISOString(),working_day:kuwaitToday(),window_since:new Date(Date.now()+3*3600000-30*86400000).toISOString().slice(0,10),tables,counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length])),result,deferred:captured.deferred,expected:state.expected};
}
export async function rpc(env:Env,name:string,args:Row,request:typeof fetch=fetch){
 if(!['cockpit_native_media_state','cockpit_native_media_claim','cockpit_native_media_publish','cockpit_native_media_release'].includes(name))throw new Error('Unapproved repository operation');
 if(env.SUPABASE_URL?.replace(/\/$/,'')!=='https://bldgtotkfmhoxmlzowdx.supabase.co'||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Creative Triage service connection required');
 const r=await request(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw new Error(`Repository ${name} failed (${r.status}); no automatic write retry`);return r.json();
}
function outputPath(path:string){const absolute=resolve(path),root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),within=relative(root,absolute);if(!within.startsWith('..')&&!within.startsWith('/'))throw new Error('Save protected run reports outside the repository');return absolute;}
export async function run(options:{apply?:boolean;report:string},env:Env=process.env){
 const check=doctor(env);if(!check.ok)throw new Error(`Doctor failed: ${check.missing.join(', ')}`);
 const path=outputPath(options.report);await mkdir(dirname(path),{recursive:true,mode:0o700});const runId=randomUUID();let claim:Row|undefined;
 try{
  if(options.apply===true)claim=await rpc(env,'cockpit_native_media_claim',{p_run_id:runId});
  const state=await rpc(env,'cockpit_native_media_state',{}),reader=transport(env),plan=await calculate(state,reader.reads);
  if(reader.faults.length)throw new Error(`${reader.faults.length} source reads failed; refusing partial publication`);
  const hash=createHash('sha256').update(JSON.stringify(plan)).digest('hex');const report:Row={dry_run:options.apply!==true,run_id:runId,plan_sha256:hash,plan,provider_receipts:reader.receipts,logs:reader.logs,overall_migration_complete:false};
  await writeFile(path,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  if(options.apply===true){report.publication=await rpc(env,'cockpit_native_media_publish',{p_run_id:runId,p_lease_token:claim!.lease_token,p_plan:plan,p_plan_sha:hash,p_receipts:reader.receipts});await writeFile(path,JSON.stringify(report,null,2),{mode:0o600});}
  return {status:options.apply?'media-core-published':'dry-run',counts:plan.counts,deferred:plan.deferred.map(d=>d.component),report:path,plan_sha256:hash};
 }catch(error){if(claim){try{await rpc(env,'cockpit_native_media_release',{p_run_id:runId,p_lease_token:claim.lease_token,p_error:error instanceof Error?error.message:'Native sync failed'});}catch{/* Original failure remains authoritative. */}}throw error;}
}
if(import.meta.main){const args=process.argv.slice(2);if(args.includes('doctor')){const result=doctor(process.env);process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.ok?0:1;}else{const index=args.indexOf('--report');if(index<0||!args[index+1])throw new Error('--report outside-repository-path is required');run({apply:args.includes('--apply'),report:args[index+1]}).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(`${e.message}\n`);process.exitCode=1;});}}
