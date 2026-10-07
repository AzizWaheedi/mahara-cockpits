import type {MultiPlan,Provider,Row,Plan} from './core.ts';
export const LTV_FIELD='11d70e58-20e7-4ff0-85c6-51de42f044d2';
/** The preview is fetched by index.ts with the caller JWT; never accept this object from browser args. */
export async function prepareLtv(args:Row,preview:Row,p:Provider):Promise<MultiPlan> {
 if(!Array.isArray(preview.rows))throw new Error('The authoritative LTV preview is unavailable');
 if(args.taskIds!==undefined&&(!Array.isArray(args.taskIds)||args.taskIds.some((x:unknown)=>typeof x!=='string')))throw new Error('Choose valid client cards');
 const pick=args.taskIds?.length?new Set(args.taskIds):null,steps:Plan[]=[];let skipped=0;
 const eligible=new Set(preview.rows.map((r:Row)=>r.clickupTaskId));
 if(pick&&[...pick].some(id=>!eligible.has(id)))throw new Error('A selected card is no longer eligible for LTV updates');
 for(const row of preview.rows){
  if(pick&&!pick.has(row.clickupTaskId))continue;
  if(!/^[a-zA-Z0-9_-]+$/.test(row.clickupTaskId)||typeof row.target!=='number'||!Number.isFinite(row.target)||typeof row.delta!=='number'||!Number.isFinite(row.delta))throw new Error('LTV preview contains an invalid card or amount');
  if(Math.abs(row.delta)<0.01){skipped++;continue;}
  if(row.current===null||typeof row.current!=='number'||!Number.isFinite(row.current))throw new Error(`Preserve ${row.client??'this client'}: no current LTV baseline is available`);
  const task=await p.call('clickup','GET',`task/${row.clickupTaskId}`),field=task.custom_fields?.find((f:Row)=>f.id===LTV_FIELD);
  if(!field||field.value===null||field.value===undefined||field.value===''||!Number.isFinite(Number(field.value)))throw new Error(`Preserve ${row.client??'this client'}: the live LTV field is empty`);
  const actual=Number(field.value);
  if(Math.abs(actual-row.target)<0.005){skipped++;continue;}
  if(Math.abs(actual-row.current)>=0.005)throw new Error(`The LTV on ${row.client??'this client'} changed after the source refresh. Refresh before applying.`);
  steps.push({provider:'clickup',method:'POST',path:`task/${row.clickupTaskId}/field/${LTV_FIELD}`,body:{value:row.target},verifyPath:`task/${row.clickupTaskId}`,expected:{field:LTV_FIELD,value:row.target,numeric:true},precondition:{field:LTV_FIELD,value:actual,numeric:true}});
 }
 return {steps,result:{written:steps.length,skipped,errors:[]}};
}
