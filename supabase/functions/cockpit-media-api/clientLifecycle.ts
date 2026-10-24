import {type Row,type Provider,type Plan,assertObjectScope} from './core.ts';
import {campaignOwner,id,launchEnabled,REHEARSAL} from './launchDesk.ts';
import {executePlan} from './execute.ts';
export const LIFECYCLE_OPERATIONS=['client.stopReview','client.pause','client.offboard'];
const REQUEST_LIST='901816723190',REQUEST_FIELD='e9fd8024-8abe-4094-ac08-e6c0e736ad7e';
function complete(r:Row,label:string):Row[]{if(!Array.isArray(r.data)||r.paging?.next)throw Error(`The complete ${label} list is unavailable. Check it in Ads Manager before continuing.`);return r.data;}
const fingerprint=(rows:Row[])=>JSON.stringify(rows.map(x=>[x.accountId,x.id,x.name,x.status,x.owner.kind]).sort((a,b)=>String(a).localeCompare(String(b))));
export async function stopReview(s:Row,c:Row,p:Provider){
 const campaigns:Row[]=[],accounts:Row[]=[],errors:Row[]=[];
 for(const account of s.accounts){
  const accountId=id(account);try { const live=await p.call('meta','GET',`act_${accountId}?fields=id,name,account_status`);
  if(String(live.id)!==`act_${accountId}`)throw Error('Meta returned another account. Refresh the client mapping.');
  let activities=(c.activities??[]).filter((a:Row)=>a.account_id===accountId);
  try{activities=[...complete(await p.call('meta','GET',`act_${accountId}/activities?fields=actor_name,event_type,event_time,object_id&limit=500`),'creator'),...activities];}catch{/* Missing creator evidence never grants ownership. */}
  const rows=complete(await p.call('meta','GET',`act_${accountId}/campaigns?fields=id,name,account_id,status,effective_status&limit=200`),'campaign');
  for(const x of rows){assertObjectScope(x,{account:accountId,campaign:id(x.id)},id(x.id));campaigns.push({...x,accountId,owner:campaignOwner(x,c,activities)});}
  accounts.push({id:accountId,name:live.name,status:live.account_status});
  }catch(e){errors.push({accountId,message:e instanceof Error?e.message:String(e)});}
 }
 const active=campaigns.filter(x=>x.status==='ACTIVE');
 return {ok:true,accounts,errors,campaigns,active:active.filter(x=>x.owner.kind==='mahara'),unverified:active.filter(x=>x.owner.kind!=='mahara'),fingerprint:fingerprint(campaigns),checkedAt:new Date().toISOString()};
}
export async function prepareStop(operation:string,a:Row,s:Row,c:Row,p:Provider){
 if(!['client.pause','client.offboard'].includes(operation))throw Error('Choose pause or offboarding.');
 if(operation==='client.pause'&&!s.accounts.length)throw Error('Link and check the client ad accounts before pausing.');
 const reason=String(a.reason??'').trim();if(reason.length<5||reason.length>1000)throw Error('Add a short reason, up to 1000 characters.');
 const reviewed=await stopReview(s,c,p);
 if(reviewed.errors.length)throw Error('One or more accounts could not be checked. Review their access in Ads Manager first.');
 if(a.fingerprint!==reviewed.fingerprint)throw Error('The campaigns changed since your review. Check them again before pausing.');
 if(reviewed.active.length>20)throw Error('More than 20 campaigns need pausing. Pause them in Ads Manager and check again.');
 const steps:Plan[]=reviewed.active.map(x=>({provider:'meta',method:'POST',path:x.id,body:{status:'PAUSED'},verifyPath:`${x.id}?fields=id,name,account_id,status`,expected:{id:x.id,account_id:x.accountId,status:'PAUSED'},precondition:{id:x.id,account_id:x.accountId,status:'ACTIVE'}}));
 return {reviewed,steps,reason};
}
// The access steps are assigned work, never a claim that a ticket revoked access.
export async function offboardTask(s:Row,a:Row,p:Provider):Promise<Plan>{
 const fields=(await p.call('clickup','GET',`list/${REQUEST_LIST}/field`)).fields;
 const opt=fields?.find((x:Row)=>x.id===REQUEST_FIELD)?.type_config?.options?.find((x:Row)=>x.name==='Client Offboarding Request 🔴');
 if(!opt)throw Error('ClickUp did not return its client offboarding request type.');
 const name=`${s.client} - Full offboarding`;
 const description=[`Requested from the media buyer cockpit. Client ID: ${s.clickupId}`,`Reason: ${a.reason}`,`Client: https://app.clickup.com/t/${s.clickupId}`,`Cockpit: https://cockpit.maharamedia.com/clients?client=${s.clickupId}&tab=service`,'',
 'Complete these steps and record evidence in the cockpit:',
 '1. Verify every client campaign is paused. Review any campaign with an unknown creator in Ads Manager.',
 '2. Remove the client team from Mahara OS and the Academy. Keep the agreed handover and business records.',
 '3. Remove Mahara people, partners and system-user access from the client Meta accounts, Pages, Instagram and connected assets. Confirm the client retains an administrator.',
 '4. Review GoHighLevel, calendars, Drive sharing and other client connections. Remove only the access approved for offboarding. Record what was removed or not applicable.',
 'No automatic deletion of accounts, leads, recordings, files or history. A completed request is a team confirmation, not a provider access check.',
 `Linked ad accounts: ${s.accounts.join(', ')||'None, confirm manually'}`].join('\n');
 return {provider:'clickup',method:'POST',path:`list/${REQUEST_LIST}/task`,body:{name,description,tags:[s.client.toLowerCase()],custom_fields:[{id:REQUEST_FIELD,value:opt.id}]},verifyPath:'task/$id',expected:{name,list:{id:REQUEST_LIST},field:REQUEST_FIELD,value:opt.id,aliases:[opt.id,opt.orderindex]},has:[{path:'tags',key:'name',value:s.client.toLowerCase()}]};
}
export function identity(s:Row){return JSON.stringify([s.actor,s.clickupId,s.client,s.locationId,[...s.accounts].sort()]);}
export async function lifecycleOperation(operation:string,a:Row,apply:boolean,requestId:string,dep:{scope:()=>Promise<Row>;client:()=>Promise<Row>;provider:Provider;env:(k:string)=>string|undefined;prior:(id:string)=>Promise<Row|null>;begin:(id:string,operation:string,args:Row,scope:Row)=>Promise<Row>;finish:(id:string,result:Row)=>Promise<void>;fail:(id:string,message:string)=>Promise<void>}){
 const enabled=launchEnabled(dep.env,a.rehearse),s=await dep.scope(),c=await dep.client();
 if(operation==='client.stopReview')return {...await stopReview(s,c,dep.provider),lifecycle:s.lifecycle,applyEnabled:enabled,canRelease:s.canRelease};
 if(!apply||!enabled)return {ok:false,dryRun:true,message:REHEARSAL};
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId??''))throw Error('A request id is required.');
 const prior=await dep.prior(requestId);if(prior)return prior;
 // Scope and freshness are checked before intent, then before every provider write.
 const plan=await prepareStop(operation,a,s,c,dep.provider);
 const task=operation==='client.offboard'&&(!s.lifecycle?.task_id||s.lifecycle.state==='released')?await offboardTask(s,{reason:plan.reason},dep.provider):null;
 const begun=await dep.begin(requestId,operation,a,s);if(begun.reused)return begun.result;
 try{
  const guarded:Provider={call:async(prov,method,path,body,as)=>{if(method!=='GET'&&identity(await dep.scope())!==identity(s))throw Error('Client access or account mapping changed. Review this request before continuing.');return dep.provider.call(prov,method,path,body,as);}};
  const paused=await executePlan({steps:plan.steps,result:{}},guarded);
  const final=await stopReview(s,c,guarded);
  if(final.errors.length)throw Error('An account could not be checked after pausing. Review the receipts.');
  if(final.active.length)throw Error('Meta still reports a Mahara campaign switched on. Check the pause receipts before trying again.');
  let taskId=s.lifecycle?.state==='released'?null:s.lifecycle?.task_id??null;
  if(task){const created=await executePlan(task,guarded);taskId=created.actual.id;}
  const result={ok:true,clickupId:s.clickupId,paused:paused.receipts.map(x=>({id:x.id,name:x.name,accountId:x.account_id})),unverified:final.unverified.map(x=>({id:x.id,name:x.name,accountId:x.accountId})),taskId,checkedAt:final.accounts.length?final.checkedAt:null,did:operation==='client.offboard'?(final.accounts.length?'Campaign pause checked. Offboarding request saved; access removal is still pending.':'Offboarding request saved. The team needs to confirm campaign status and remove access.'):'Mahara campaigns checked and paused. Client access is unchanged.',receiptId:requestId};
  if(identity(await dep.scope())!==identity(s))throw Error('Client access or mapping changed before completion. Review the receipts.');
  await dep.finish(requestId,result);return result;
 }catch(e){await dep.fail(requestId,e instanceof Error?e.message:String(e));throw e;}
}
