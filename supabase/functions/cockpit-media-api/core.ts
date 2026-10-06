import {prepareB2b} from './b2b.ts';
import {prepareCreative} from './creative.ts';
const B2B_OPERATIONS=['inspect','rename','setBudget','setSchedule','setAudience','createAdset','duplicateAdset'].map(x=>`ceo.b2bManage.${x}`);
const CREATIVE_OPERATIONS=['edit.newAdsFromExisting','edit.addCreativeToCampaign','ceo.b2bManage.createAds'];
const LAUNCH_OPERATIONS=['ceo.b2bLaunch.list','ceo.b2bLaunch.build','ceo.b2bLaunch.save','ceo.b2bLaunch.discard','ceo.b2bLaunch.launch','ceo.b2bManage.copyIdeas'];
export type Row = Record<string, any>;
export const ADS_LIST = '901817774521';
export const STATUS_FIELD = '7f118f61-34b6-483a-b749-ff9fc31fd423';
export const CITIES_FIELD = 'b98aa20e-c2d1-4785-baae-67e67506023d';
export const OPERATIONS = new Set(['control.setStatus','ceo.b2bControl.setStatus','edit.setAdSetBudget',
 'edit.duplicateAdSet','board.adStatusOptions','board.advertisingCityOptions','board.setAdStatus',
 'board.setAdvertisingCities','board.renameCard','board.addToBoard','board.dismissOffBoard','ceo.ltv.apply','edit.askViktorFor','cockpit.askForDetail','execute.runAction','previews.fresh','comms.sendReply',...B2B_OPERATIONS,...CREATIVE_OPERATIONS,...LAUNCH_OPERATIONS]);
export interface Provider { call(provider:'meta'|'clickup'|'slack'|'ghl', method:string,path:string,body?:Row):Promise<Row> }
export interface Plan { provider:'meta'|'clickup'|'slack'; method:string; path:string; body?:Row; verifyPath:string; expected:Row; result?:Row; imageUpload?:boolean; precondition?:Row; liveAdsGuard?:{path:string;target:string};slackMessage?:boolean;clickupComment?:boolean }
export interface MultiPlan {steps:Plan[]; result:Row}
const id = (x:unknown) => { if(!/^\d{5,}$/.test(String(x??''))) throw new Error('A valid Meta id is required'); return String(x); };
const text = (x:unknown) => { if(typeof x!=='string'||!x.trim()||x.length>500) throw new Error('A name is required'); return x.trim(); };
export function budget(x:unknown) { if(typeof x!=='number'||!Number.isFinite(x)||x<=0||x>100000) throw new Error('Daily budget must be between 0 and 100000'); return Math.round(x*100); }
export async function prepare(operation:string,a:Row,s:Row,p:Provider):Promise<Plan|MultiPlan|{read:unknown}> {
 if(!OPERATIONS.has(operation)) throw new Error(`Unsupported provider operation: ${operation}`);
 if(B2B_OPERATIONS.includes(operation))return prepareB2b(operation,a,s,p);
 if(CREATIVE_OPERATIONS.includes(operation))return prepareCreative(operation,a,s,p);
 if(operation.startsWith('board.')) {
  if(operation.endsWith('Options')||operation==='board.setAdStatus'||operation==='board.setAdvertisingCities'||operation==='board.addToBoard') {
   const fields=(await p.call('clickup','GET',`list/${ADS_LIST}/field`)).fields;
   if(!Array.isArray(fields)) throw new Error('ClickUp did not return board fields');
   const cities=operation==='board.advertisingCityOptions'||operation==='board.setAdvertisingCities';
   const options=fields.find((f:Row)=>f.id===(cities?CITIES_FIELD:STATUS_FIELD))?.type_config?.options;
   if(!Array.isArray(options)||!options.length) throw new Error('Board options are unavailable');
   if(operation.endsWith('Options')) return {read:cities?options.map((o:Row)=>({id:String(o.id),label:o.label,color:o.color})):options.map((o:Row)=>o.name)};
   let value:unknown;let aliases:unknown[]|undefined;
   if(cities) {
    if(!Array.isArray(a.cities)||a.cities.some((x:unknown)=>typeof x!=='string')||a.cities.some((x:string)=>!options.some((o:Row)=>o.label===x))) throw new Error('Choose current Advertising Cities options');
    value=options.filter((o:Row)=>a.cities.includes(o.label)).map((o:Row)=>o.id);
   } else {
    const option=options.find((o:Row)=>String(o.name).toLowerCase()===String(a.status??'Active').toLowerCase());
    if(!option) throw new Error('Choose a current Ad Status option');
    value=option.id;
    aliases=[option.id,...(option.orderindex!==undefined?[option.orderindex]:[])];
   }
   if(operation==='board.addToBoard') {
    if(s.task) throw new Error('This campaign already has a board card');
    return {provider:'clickup',method:'POST',path:`list/${ADS_LIST}/task`,body:{name:text(s.campaignName),tags:[text(s.client).toLowerCase()],custom_fields:[{id:STATUS_FIELD,value}]},verifyPath:'task/$id',expected:{name:s.campaignName,list:{id:ADS_LIST},field:STATUS_FIELD,value,aliases},result:{taskId:'$id',url:'$url'}};
   }
   const task=await checkedTask(s,p); const field=cities?CITIES_FIELD:STATUS_FIELD;
   const empty=cities&&(value as unknown[]).length===0;
   return {provider:'clickup',method:empty?'DELETE':'POST',path:`task/${task}/field/${field}`,body:empty?undefined:{value},verifyPath:`task/${task}`,expected:{field,value,...(aliases?{aliases}:{})}};
  }
  const task=await checkedTask(s,p);
  return {provider:'clickup',method:'PUT',path:`task/${task}`,body:{name:text(s.campaignName)},verifyPath:`task/${task}`,expected:{name:s.campaignName}};
 }
 const target=id(a.metaId??a.adsetId);
 const fields=operation.endsWith('setStatus')
  ? `id,name,account_id${a.level==='campaign'?'':',campaign_id'}`
  : 'id,name,account_id,campaign_id,campaign{id,daily_budget,lifetime_budget},daily_budget,billing_event,optimization_goal,bid_strategy,promoted_object,destination_type,targeting,attribution_spec';
 const obj=await p.call('meta','GET',`${target}?fields=${fields}`);
 assertObjectScope(obj,s,target);
 if(operation.endsWith('setStatus')) {
  if(typeof a.active!=='boolean'||!['campaign','adset','ad'].includes(a.level)) throw new Error('Choose an object level and status');
  return {provider:'meta',method:'POST',path:target,body:{status:a.active?'ACTIVE':'PAUSED'},verifyPath:`${target}?fields=status`,expected:{status:a.active?'ACTIVE':'PAUSED'}};
 }
 const parent=obj.campaign??(obj.campaign_id?await p.call('meta','GET',`${id(obj.campaign_id)}?fields=id,daily_budget,lifetime_budget`):null);
 if(operation==='edit.setAdSetBudget') {
  if(!parent?.id) throw new Error('Meta did not confirm this ad set campaign');
  if(Number(parent.lifetime_budget)>0) throw new Error('This campaign uses a lifetime budget; change it in Ads Manager');
  const where=Number(parent.daily_budget)>0?id(parent.id):target;
  return {provider:'meta',method:'POST',path:where,body:{daily_budget:budget(a.dailyBudget)},verifyPath:`${where}?fields=daily_budget`,expected:{daily_budget:budget(a.dailyBudget)}};
 }
 if(!parent?.id) throw new Error('Meta did not confirm this ad set campaign');
 const targeting=structuredClone(obj.targeting??{});
 if(targeting.instagram_positions?.includes('explore_home')&&!targeting.instagram_positions.includes('explore')) targeting.instagram_positions.push('explore');
 const body:Row={name:text(a.newName),campaign_id:parent.id,billing_event:obj.billing_event,optimization_goal:obj.optimization_goal,targeting:JSON.stringify(targeting),status:'PAUSED'};
 if(!Number(parent.daily_budget)&&!Number(parent.lifetime_budget)) body.daily_budget=a.dailyBudget===undefined?obj.daily_budget??3000:budget(a.dailyBudget);
 for(const key of ['promoted_object','destination_type','attribution_spec','bid_strategy']) if(obj[key]) body[key]=typeof obj[key]==='object'?JSON.stringify(obj[key]):obj[key];
 return {provider:'meta',method:'POST',path:`act_${id(s.account)}/adsets`,body,verifyPath:'$id?fields=status,name,campaign_id',expected:{status:'PAUSED',name:body.name,campaign_id:parent.id},result:{adsetId:'$id'}};
}
export function assertObjectScope(obj:Row,s:Row,target:string) {
 if(!s.account||String(obj.account_id)!==String(s.account)) throw new Error('That object belongs to another ad account');
 if(!s.founder&&(!s.campaign||String(obj.campaign_id??obj.campaign?.id??target)!==String(s.campaign))) throw new Error('That object belongs to another campaign');
}
async function checkedTask(s:Row,p:Provider) {
 if(!/^[a-zA-Z0-9_-]+$/.test(String(s.task??''))) throw new Error('This campaign has no board card');
 const task=await p.call('clickup','GET',`task/${s.task}`);
 if(String(task.list?.id)!==ADS_LIST) throw new Error('That card is not on the Ads Management board');
 return s.task;
}
export function confirmed(actual:Row,expected:Row):boolean {
 if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((value,i)=>value&&typeof value==='object'?confirmed(actual[i],value):String(actual[i])===String(value));
 if(expected.field) {
  const rawValue=actual.custom_fields?.find((f:Row)=>f.id===expected.field)?.value;
  if(expected.numeric&&(rawValue===undefined||rawValue===null||rawValue===''))return false;
  const got=rawValue??[];
  if(expected.numeric? !Number.isFinite(Number(got))||Math.abs(Number(got)-Number(expected.value))>=0.005:expected.aliases? !expected.aliases.some((v:unknown)=>String(v)===String(got)):JSON.stringify(Array.isArray(got)?[...got].sort():String(got))!==JSON.stringify(Array.isArray(expected.value)?[...expected.value].sort():String(expected.value)))return false;
  const {field:_field,value:_value,aliases:_aliases,numeric:_numeric,...rest}=expected;return confirmed(actual,rest);
 }
 return Object.entries(expected).every(([key,value])=>{
  if(key==='end_time')return value?Date.parse(actual[key])===Date.parse(String(value)):!actual[key];
  if(value&&typeof value==='object')return confirmed(actual[key]??{},value as Row);
  return String(actual[key])===String(value);
 });
}
