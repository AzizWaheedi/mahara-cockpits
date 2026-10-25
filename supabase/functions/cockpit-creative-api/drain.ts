import type {Row} from '../cockpit-media-api/core.ts';
import {ClientActionError,runClientAction,serviceLoader} from './outbox.ts';
// The server drain for Brand Blueprint presses (docs/forms/STAGE1-CONTRACT.md 5.2, PLAN.md 1.3 Drain).
// pg_cron's mahara-creative-drain posts {"operation":"cron","job":"drain","apply":true} with the vault's
// cron secret every 2 minutes while a press waits. Each due press runs exactly as the browser runs it:
// the same fence, journal, claim and settle, loaded as its presser, whose seat and client are checked
// again on every load. A refusal while the plan is prepared (nothing sent) counts an attempt; the third
// fails the press. A press that started and then broke is settled to reconcile, never run again.
type Env=(name:string)=>string|undefined;
export type DrainRun={id:string;kind:string;outcome:'done'|'reconcile'|'refused'|'skipped'|'dryRun';attempts?:number;error?:string};
export type DrainResult={ok:true;apply:boolean;failed:number;ran:DrainRun[]};
export async function runDrain(admin:any,env:Env,apply:boolean,run:typeof runClientAction=runClientAction):Promise<DrainResult>{
 const {data,error}=await admin.rpc('cockpit_creative_outbox_due',{p_apply:apply});
 if(error)throw new Error(`The drain could not list the waiting presses: ${error.message}`);
 const rows:Row[]=Array.isArray(data?.rows)?data.rows:[];const ran:DrainRun[]=[];
 for(const row of rows){
  const id=String(row.id),kind=String(row.kind);
  try{
   const out:Row=await run({args:{id},apply},serviceLoader(admin),admin,env,String(row.actorId),{source:'cron'});
   ran.push({id,kind,outcome:out?.skipped?'skipped':out?.dryRun?'dryRun':'done'});
  }catch(e){
   const message=e instanceof Error?e.message:'The press failed';
   if(e instanceof ClientActionError&&e.started){ran.push({id,kind,outcome:'reconcile',error:message});continue;}
   if(!apply){ran.push({id,kind,outcome:'refused',attempts:Number(row.attempts??0),error:message});continue;}
   const counted=await admin.rpc('cockpit_creative_outbox_refused',{p_id:id,p_error:message});
   if(counted.error)ran.push({id,kind,outcome:'refused',error:`${message} The refusal could not be recorded: ${counted.error.message}`});
   else ran.push({id,kind,outcome:'refused',attempts:Number(counted.data?.attempts??0),error:message});
  }
 }
 return {ok:true,apply,failed:Number(data?.failed??0),ran};
}
// Constant time over the bytes, so the comparison takes as long whatever the first wrong byte is. An
// empty expected secret never matches: an unset CREATIVE_CRON_SECRET keeps the door shut.
export function sameSecret(given:string|null|undefined,expected:string|null|undefined):boolean{
 const enc=new TextEncoder(),a=enc.encode(String(given??'')),b=enc.encode(String(expected??''));
 if(!b.length)return false;
 let diff=a.length^b.length;
 for(let i=0;i<b.length;i++)diff|=(a[i]??0)^b[i];
 return diff===0;
}
// The cron door, before any sign-in check: null for every other operation (they go on to getUser()).
// The secret is checked before the job, so a caller without it learns nothing about the bodies.
export async function cronDoor(input:unknown,secret:string|null,env:Env,makeAdmin:()=>any,drain:typeof runDrain=runDrain):Promise<{status:number;body:unknown}|null>{
 if(!input||typeof input!=='object'||(input as Row).operation!=='cron')return null;
 if(!sameSecret(secret,env('CREATIVE_CRON_SECRET')))return {status:401,body:{ok:false,error:'not allowed'}};
 const body=input as Row;
 if(body.job!=='drain')return {status:400,body:{ok:false,error:'Send {"operation":"cron","job":"drain","apply":true}.'}};
 return {status:200,body:await drain(makeAdmin(),env,body.apply===true)};
}
