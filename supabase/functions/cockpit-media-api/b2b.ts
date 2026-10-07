import {assertObjectScope,budget,type Provider,type Row,type Plan,type MultiPlan} from './core.ts';
export const B2B_OPERATIONS=['inspect','rename','setBudget','setSchedule','setAudience','createAdset','duplicateAdset'].map(x=>`ceo.b2bManage.${x}`);
const metaId=(x:unknown)=>{if(!/^\d{5,}$/.test(String(x??'')))throw new Error('Invalid Meta id');return String(x);};
const kind=(name:string)=>/retarget|remarket|hammer them/i.test(name)?'retargeting':/hiring|recruit/i.test(name)?'unknown':'lead_gen';
const usd=(value:unknown)=>value==null||value===''?null:Number(value)/100;
const fields:Row={campaign:'id,name,account_id,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy',adset:'id,name,account_id,status,effective_status,campaign_id,campaign{id,name,objective,daily_budget,lifetime_budget},daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,start_time,end_time,targeting,promoted_object',ad:'id,name,account_id,status,effective_status,adset_id,campaign_id,creative{id,title,body,object_story_spec,asset_feed_spec}'};
async function own(id:unknown,level:string,s:Row,p:Provider) {if(!fields[level])throw new Error('Invalid object level'); const target=metaId(id),o=await p.call('meta','GET',`${target}?fields=${fields[level]}`);assertObjectScope(o,s,target);return o;}
export function cleanTargeting(input:Row) {
 const t=structuredClone(input??{geo_locations:{countries:['KW']}});delete t.age_range;
 for(const [field,needs,also] of [['instagram_positions','explore_home','explore'],['facebook_positions','facebook_reels_overlay','facebook_reels']]) if(t[field]?.includes(needs)&&!t[field].includes(also))t[field].push(also);
 return t;
}
function audience(t:Row,a:Row) {
 if(a.countries!==undefined){if(!Array.isArray(a.countries)||a.countries.some((c:unknown)=>typeof c!=='string'||! /^[A-Za-z]{2}$/.test(c)))throw new Error('Use two-letter country codes');if(a.countries.length)t.geo_locations={...t.geo_locations,countries:a.countries.map((c:string)=>c.toUpperCase())};}
 for(const [key,target] of [['ageMin','age_min'],['ageMax','age_max']])if(a[key]!==undefined){if(!Number.isInteger(a[key])||a[key]<18||a[key]>65)throw new Error('Ages must be from 18 to 65');t[target]=a[key];}
 if((t.age_min??18)>(t.age_max??65))throw new Error('Youngest age must be below oldest');return t;
}
export async function prepareB2b(operation:string,a:Row,s:Row,p:Provider):Promise<Plan|MultiPlan|{read:unknown}> {
 const op=operation.split('.').at(-1),level=['inspect','rename','setBudget'].includes(op??'')?a.level:'adset';
 const o=await own(op==='createAdset'?a.campaignId:a.metaId??a.adsetId,op==='createAdset'?'campaign':level,s,p);
 const target=String(o.id??a.metaId??a.adsetId);
 if(op==='duplicateAdset') {
  const name=String(a.name??`${o.name??'Ad set'} | copy`).trim();if(!name||name.length>200)throw new Error('Give the copy a name of at most 200 characters');
  const body:Row={campaign_id:o.campaign_id,name,status:'PAUSED',targeting:JSON.stringify(cleanTargeting(o.targeting)),optimization_goal:o.optimization_goal??'OFFSITE_CONVERSIONS',billing_event:o.billing_event??'IMPRESSIONS'};
  if(!(o.campaign?.daily_budget||o.campaign?.lifetime_budget)){if(o.daily_budget)body.daily_budget=o.daily_budget;else if(o.lifetime_budget)body.lifetime_budget=o.lifetime_budget;body.bid_strategy=o.bid_strategy??'LOWEST_COST_WITHOUT_CAP';}
  if(o.promoted_object)body.promoted_object=JSON.stringify(o.promoted_object);
  const steps:Plan[]=[{provider:'meta',method:'POST',path:`act_${s.account}/adsets`,body,verifyPath:'$id?fields=id,name,status,campaign_id',expected:{name,status:'PAUSED',campaign_id:o.campaign_id}}];
  if(a.withAds===true){const list=await p.call('meta','GET',`${target}/ads?fields=id,name,account_id,creative{id}&limit=100`);if(list.paging?.next)throw new Error('This ad set has over 100 ads; duplicate it in smaller batches');if(!Array.isArray(list.data))throw new Error('Meta did not return the source ads');for(const ad of list.data){assertObjectScope(ad,s,String(ad.id));const creative=metaId(ad.creative?.id);steps.push({provider:'meta',method:'POST',path:`act_${s.account}/ads`,body:{name:String(ad.name??ad.id),adset_id:'$step0.id',creative:JSON.stringify({creative_id:creative}),status:'PAUSED'},verifyPath:'$id?fields=id,status,adset_id',expected:{status:'PAUSED',adset_id:'$step0.id'}});}}
  return {steps,result:{id:'$step0.id',name,ads:steps.length-1,note:'Created a paused copy. Review it before switching it on.'}};
 }
 if(op==='inspect') {
  const base={level,id:target,name:o.name??'',status:o.status??'',effectiveStatus:o.effective_status??''};
  if(level==='campaign')return {read:{...base,objective:o.objective??'',kind:kind(o.name??''),dailyBudgetUsd:usd(o.daily_budget),lifetimeBudgetUsd:usd(o.lifetime_budget),budgetIsHere:Boolean(o.daily_budget||o.lifetime_budget),bidStrategy:o.bid_strategy??null}};
  if(level==='adset'){const t=o.targeting??{};return {read:{...base,campaignId:o.campaign_id,campaignName:o.campaign?.name??'',objective:o.campaign?.objective??'',dailyBudgetUsd:usd(o.daily_budget),lifetimeBudgetUsd:usd(o.lifetime_budget),budgetIsOnCampaign:Boolean(o.campaign?.daily_budget||o.campaign?.lifetime_budget),bidStrategy:o.bid_strategy??null,bidAmountUsd:usd(o.bid_amount),optimizationGoal:o.optimization_goal??null,billingEvent:o.billing_event??null,startTime:o.start_time??null,endTime:o.end_time??null,pixelEvent:o.promoted_object?.custom_event_type??null,audience:{countries:t.geo_locations?.countries??[],ageMin:t.age_min??null,ageMax:t.age_max??null,genders:t.genders?.length===1?(t.genders[0]===1?'men':'women'):'everyone',custom:t.custom_audiences?.length??0,excluded:t.excluded_custom_audiences?.length??0,detailed:(t.flexible_spec??[]).reduce((n:number,f:Row)=>n+Object.values(f).reduce((m:number,v:any)=>m+(Array.isArray(v)?v.length:0),0),0)}}};}
  const c=o.creative??{},story=c.object_story_spec?.video_data??c.object_story_spec?.link_data??{};
  return {read:{...base,adsetId:o.adset_id,campaignId:o.campaign_id,headline:c.title??c.asset_feed_spec?.titles?.[0]?.text??story.title??story.name??'',primaryText:c.body??c.asset_feed_spec?.bodies?.[0]?.text??story.message??'',creativeId:c.id??null,canCarryCopy:Boolean(c.object_story_spec?.video_data||c.object_story_spec?.link_data)}};
 }
 let body:Row={},expected:Row={},result:Row={};let path=target,verify=target;
 if(op==='rename') {
  const name=String(a.name??'').trim();if(!name||name.length>200)throw new Error('A name of 1 to 200 characters is required');
  if(level==='campaign'&&kind(o.name??'')!=='unknown'&&kind(name)!==kind(o.name??''))throw new Error('Keep the campaign kind in its name so attribution remains correct');body=expected={name};result={name};
 } else if(op==='setBudget') {
  if(!['campaign','adset'].includes(level)||(a.dailyUsd===undefined)===(a.lifetimeUsd===undefined))throw new Error('Choose either daily or lifetime budget');
  const amount=a.dailyUsd??a.lifetimeUsd;if(typeof amount!=='number'||amount<1||amount>5000)throw new Error('Budget must be between $1 and $5000');
  if(level==='adset'&&(o.campaign?.daily_budget||o.campaign?.lifetime_budget))throw new Error('The campaign holds this budget');
  if(level==='campaign'&&!(o.daily_budget||o.lifetime_budget))throw new Error('This campaign uses ad set budgets');
  body=expected={[a.dailyUsd!==undefined?'daily_budget':'lifetime_budget']:budget(amount)};result={dailyUsd:a.dailyUsd??null};const before=usd(o.daily_budget)??usd(o.lifetime_budget);if(before&&Math.abs(amount-before)/before>0.2)result.warning='A budget change over 20% can restart the learning phase.';
 } else if(op==='setSchedule') {
  const end=String(a.endTime??'').trim();if(end&&(!Number.isFinite(Date.parse(end))||Date.parse(end)<Date.now()))throw new Error('Choose a valid future end date');body={end_time:end};expected={end_time:end};
 } else if(op==='setAudience') {
  const targeting=audience(cleanTargeting(o.targeting),a);body={targeting:JSON.stringify(targeting)};expected={targeting};result={note:'Audience updated. Targeting changes can restart the learning phase.'};
 } else if(op==='createAdset') {
  const source=await own(a.copyFromAdsetId,'adset',s,p),name=String(a.name??'').trim();if(name.length<3||name.length>200)throw new Error('Give the ad set a name of 3 to 200 characters');
  body={name,campaign_id:target,status:'PAUSED',targeting:JSON.stringify(audience(cleanTargeting(source.targeting),a)),optimization_goal:source.optimization_goal??'OFFSITE_CONVERSIONS',billing_event:source.billing_event??'IMPRESSIONS'};
  if(!(o.daily_budget||o.lifetime_budget)){if(a.dailyBudgetUsd<1||a.dailyBudgetUsd>5000)throw new Error('Budget must be between $1 and $5000');body.daily_budget=budget(a.dailyBudgetUsd);body.bid_strategy=source.bid_strategy??'LOWEST_COST_WITHOUT_CAP';}
  if(source.promoted_object)body.promoted_object=JSON.stringify(source.promoted_object);
  path=`act_${s.account}/adsets`;verify='$id';expected={status:'PAUSED',name,campaign_id:target};result={id:'$id',name,note:'Created paused. Add ads and review before switching it on.'};
 } else throw new Error('Unsupported B2B operation');
 return {provider:'meta',method:'POST',path,body,verifyPath:`${verify}?fields=${Object.keys(expected).join(',')}`,expected,result};
}
