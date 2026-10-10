import {assertObjectScope,confirmed,type Plan,type MultiPlan,type Provider,type Row} from './core.ts';
import {pages} from './funnel.ts';
export function resolveRefs(value:any,receipts:Row[]):any {
 if(typeof value==='string')return value.replace(/\$step(\d+)\.id/g,(_,n)=>{const id=receipts[Number(n)]?.id;if(!/^[a-zA-Z0-9_-]+$/.test(String(id??'')))throw new Error('Missing verified intermediate receipt');return String(id);});
 if(Array.isArray(value))return value.map(v=>resolveRefs(v,receipts));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveRefs(v,receipts)]));
 return value;
}
export async function executePlan(plan:Plan|MultiPlan,provider:Provider) {
 const receipts:Row[]=[];let actual:Row={},made:Row={};const page=pages(provider);
 for(const step of 'steps' in plan?plan.steps:[plan]){
  const resolved=resolveRefs(step,receipts) as Plan;
  // A Page object (a lead form) is written and read back as the Page; the token is fetched now and kept only in memory.
  const as=resolved.asPage?{token:(await page(resolved.asPage)).token}:undefined;
  if(resolved.liveAdsGuard){const list=await provider.call('meta','GET',resolved.liveAdsGuard.path);if(list.paging?.next)throw new Error('The live-ad set changed; inspect Ads Manager');const live=(list.data??[]).filter((a:Row)=>a.effective_status==='ACTIVE');if(live.length<=1||!live.some((a:Row)=>String(a.id)===resolved.liveAdsGuard!.target))throw new Error('Refusing to cut the last live ad or an ad that changed since preview');}
  if(resolved.precondition){const before=await provider.call(resolved.provider,'GET',resolved.verifyPath);if(!confirmed(before,resolved.precondition))throw new Error('The provider field changed since preview. Refresh and reconcile before overwriting human edits.');}
  made=await provider.call(resolved.provider,resolved.method,resolved.path,resolved.body,as);
  if(resolved.slackMessage){if(!made.ok||!/^\d+\.\d+$/.test(String(made.ts))||!/^[CDG][A-Z0-9]+$/.test(String(made.channel)))throw new Error('Slack did not return a verifiable message receipt');const history=await provider.call('slack','GET',`conversations.history?channel=${made.channel}&latest=${made.ts}&oldest=${made.ts}&inclusive=true&limit=1`);actual=history.messages?.find((m:Row)=>m.ts===made.ts)??{};if(actual.text!==resolved.expected.text)throw new Error('Slack message read-back could not be confirmed; reconcile before sending again');receipts.push({id:made.ts,channel:made.channel});continue;}
  if(resolved.clickupComment){if(!made.id)throw new Error('ClickUp returned no comment receipt');const comments=await provider.call('clickup','GET',resolved.verifyPath);actual=comments.comments?.find((c:Row)=>String(c.id)===String(made.id))??{};const text=actual.comment_text??(actual.comment??[]).map((x:Row)=>x.text??'').join('');if(text!==resolved.expected.comment_text)throw new Error('ClickUp comment read-back did not confirm delivery');receipts.push({id:made.id});continue;}
  if(resolved.imageUpload){const images=Object.values(made.images??{}) as Row[];if(images.length!==1||!images[0]?.hash)throw new Error('Meta did not return exactly one image hash; reconcile the upload');made={...made,id:images[0].hash};}
  if(resolved.verifyPath.includes('$id')&&!/^[a-zA-Z0-9_-]+$/.test(String(made.id??'')))throw new Error('Provider returned no verifiable object id; reconcile this request');
  actual=await provider.call(resolved.provider,'GET',resolved.verifyPath.replace('$id',String(made.id)),undefined,as);
  if(resolved.imageUpload){const image=actual.data?.find((x:Row)=>String(x.hash)===String(made.id));if(!image)throw new Error('Read-back did not confirm the uploaded image hash');actual={...image,id:made.id};}
  if(resolved.verifyPath.includes('$id')&&String(actual.id)!==String(made.id))throw new Error('Read-back returned a different object; reconcile this request');
  if(!confirmed(actual,resolved.expected))throw new Error('Provider read-back did not confirm the requested change; reconcile this request');
  receipts.push({...actual,id:made.id??actual.id});
 }
 const result:Row=resolveRefs(plan.result??{},receipts);
 for(const [key,value]of Object.entries(result))result[key]=value==='$id'?String(made.id):value==='$url'?actual.url:value;
 return {actual,result,receipts};
}
export async function prepareRecommendation(a:Row,s:Row,p:Provider):Promise<Plan>{
 if(!s.campaign||!/^\d{5,}$/.test(s.campaign))throw new Error('This campaign has no verified Meta id');
 if(a.campaignMetaId&&String(a.campaignMetaId)!==String(s.campaign))throw new Error('Campaign id does not match the selected client campaign');
 const c=await p.call('meta','GET',`${s.campaign}?fields=id,name,account_id,daily_budget,lifetime_budget,status`);assertObjectScope(c,s,String(s.campaign));
 if(a.action==='Turn it off')return {provider:'meta',method:'POST',path:s.campaign,body:{status:'PAUSED'},verifyPath:`${s.campaign}?fields=status`,expected:{status:'PAUSED'},result:{did:`Paused the campaign "${c.name}" in Meta.`}};
 if(a.action==='Scale the winner'||String(a.action).startsWith('Raise to')){
  let holder=c,level='campaign';if(!Number(c.daily_budget)){if(Number(c.lifetime_budget))throw new Error('This campaign uses a lifetime budget; change it in Ads Manager');const sets=await p.call('meta','GET',`${s.campaign}/adsets?fields=id,name,account_id,campaign_id,daily_budget,status&limit=100`);if(sets.paging?.next)throw new Error('Choose an ad set directly for this large campaign');const live=(sets.data??[]).filter((x:Row)=>x.status==='ACTIVE'),pool=live.length?live:sets.data??[];if(pool.length!==1)throw new Error('There is no single ad set budget to raise. Choose the ad set first.');holder=pool[0];level='ad set';assertObjectScope(holder,s,String(holder.id));}
  const current=Number(holder.daily_budget)/100;if(!Number.isFinite(current)||current<=0)throw new Error('Meta did not return a current daily budget');
  if(a.targetBudget!==undefined&&(typeof a.targetBudget!=='number'||!Number.isFinite(a.targetBudget)))throw new Error('Enter a valid target budget');
  const cap=Math.floor(current*1.25*100)/100,wanted=a.targetBudget??cap,next=Math.min(Math.max(wanted,30),cap);
  if(next<30)throw new Error('A 25% step cannot reach the $30 floor. Review this budget in Ads Manager.');if(next<=current)throw new Error('The budget is already at or above that target');
  return {provider:'meta',method:'POST',path:String(holder.id??s.campaign),body:{daily_budget:Math.round(next*100)},verifyPath:`${holder.id??s.campaign}?fields=daily_budget`,expected:{daily_budget:Math.round(next*100)},precondition:{daily_budget:holder.daily_budget},result:{did:`Raised the ${level} budget on "${holder.name}" from $${current.toFixed(2)} to $${next.toFixed(2)} a day${wanted>cap?' (capped at 25% for this step)':''}.`}};
 }
 if(a.action==='Cut the worst ad'){
  const path=`${s.campaign}/ads?fields=id,name,account_id,campaign_id,effective_status,insights.date_preset(last_7d){spend,actions}&limit=100`,list=await p.call('meta','GET',path);if(list.paging?.next)throw new Error('Inspect the ads directly; this campaign has more than 100 ads');const live=(list.data??[]).filter((x:Row)=>x.effective_status==='ACTIVE');if(live.length<=1)throw new Error('Refusing to cut the last live ad');
  const scored=live.map((ad:Row)=>{assertObjectScope(ad,s,String(ad.id));const insight=ad.insights?.data?.[0],spend=Number(insight?.spend??0),leads=Number((insight?.actions??[]).find((x:Row)=>String(x.action_type).includes('lead'))?.value??0);return {ad,spend,leads,cpl:leads>0?spend/leads:Infinity};}).filter((x:Row)=>x.spend>0).sort((x:Row,y:Row)=>y.cpl-x.cpl||y.spend-x.spend);if(!scored.length)throw new Error('No live ad has spent enough to identify the worst one');const worst=scored[0];
  return {provider:'meta',method:'POST',path:String(worst.ad.id),body:{status:'PAUSED'},verifyPath:`${worst.ad.id}?fields=status`,expected:{status:'PAUSED'},liveAdsGuard:{path:`${s.campaign}/ads?fields=id,effective_status&limit=100`,target:String(worst.ad.id)},result:{did:`Paused "${worst.ad.name}": $${worst.spend.toFixed(2)} spent for ${worst.leads} leads in 7 days, the worst in this campaign.`}};
 }
 throw new Error('This recommendation requires judgment and cannot be applied automatically. No provider change was made.');
}
