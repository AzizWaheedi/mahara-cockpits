import type {FinanceContext} from './types.ts';
import type {ManualRow,ManualLoad} from './data/money.ts';
import type {BillingRow} from './billing.ts';
type Row=Record<string,any>;
const mask=(s:unknown)=>String(s??'').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,'[email]').replace(/\+?\d[\d\s-]{6,}\d/g,m=>/^\d{4}-\d{1,2}-\d{1,2}$/.test(m)||m.replace(/\D/g,'').length<8?m:'[number]');
const stamp=(x:unknown)=>x?Date.parse(String(x)):null;
const number=(x:unknown)=>{const n=Number(x);if(x===null||x===undefined||!Number.isFinite(n))throw Error('Finance source contains an invalid number');return n;};
function manual(r:Row):ManualRow{return {id:r.id,day:r.day,amount:number(r.amount),currency:r.currency,amountUsd:number(r.amount_usd),usdPerUnit:number(r.usd_per_unit),client:mask(r.client_name),clickupTaskId:r.clickup_task_id??null,rail:r.rail,kind:r.kind,dealContracted:r.deal_contracted===null?null:number(r.deal_contracted),dealContractedUsd:r.deal_contracted_usd===null?null:number(r.deal_contracted_usd),note:r.note?mask(r.note):null,addedBy:'Aziz',addedAt:stamp(r.added_at)!,deletedAt:stamp(r.deleted_at),deletedBy:r.deleted_at?'Aziz':null};}
export function financeContext(source:Row):FinanceContext{
 const billing:BillingRow[]=source.billing.map((r:Row)=>{
  const out:any={taskId:r.clickup_task_id,name:r.client_name,syncedAt:stamp(r.captured_at)};
  const keys={stage:'stage',mrrUsd:'mrr_usd',ltvUsd:'ltv_usd',nextPaymentAmountUsd:'next_payment_usd',currency:'source_currency',nextPaymentDate:'next_payment_date',signupDate:'signup_date',launchDate:'launch_date',pausedOn:'paused_on',churnDate:'churn_date',nextContractRenewal:'next_renewal_date',paymentPlan:'payment_plan',paymentMethod:'payment_method',contractStatus:'contract_status',churnReason:'churn_reason',churnType:'churn_type',closer:'closer',leadSource:'lead_source'};
  for(const [key,col]of Object.entries(keys))if(r[col]!==null&&r[col]!==undefined)out[key]=['mrrUsd','ltvUsd','nextPaymentAmountUsd'].includes(key)?number(r[col]):r[col];return out;
 });
 if(!billing.length)throw Error('Client billing source is empty; refresh the mirror first');
 const names=new Map<string,Set<string>>(),csms=new Map<string,string>();
 for(const r of source.aliases){if(!r.task_id)continue;const values=[r.name,...(r.aliases??[])].map((x:unknown)=>String(x??'').trim()).filter(Boolean);const set=names.get(r.task_id)??new Set<string>();values.forEach((x:string)=>set.add(x));names.set(r.task_id,set);if(r.csm)csms.set(r.task_id,String(r.csm).trim().split(/\s+/)[0]);}
 const cards=[...names].map(([taskId,set])=>({taskId,names:[...set],csm:csms.get(taskId)??null}));
 return {async runQuery(ref:string,args:Row){
  if(ref==='billing')return billing;
  if(ref==='series')return source.series.filter((r:Row)=>r.metric===args.metric&&r.scope===args.scope&&r.day>=args.since).map((r:Row)=>({date:r.day,value:number(r.value)}));
  if(ref==='manual'){
   const live=source.manual.filter((r:Row)=>!r.deleted_at&&r.day>=args.from).sort((a:Row,b:Row)=>a.day.localeCompare(b.day)||String(a.added_at).localeCompare(b.added_at));
   if(live.length>=5000)throw Error('Manual history exceeds the original verified row limit');
   return {live:live.map(manual),removedThisMonth:source.manual.filter((r:Row)=>r.deleted_at&&r.day.slice(0,7)===args.month).map(manual),anyLive:source.manual.some((r:Row)=>!r.deleted_at),truncated:false,newestChangeAt:stamp(source.newestManualChange),cards} satisfies ManualLoad;
  }
  throw Error('Unknown finance source');
 }} as FinanceContext;
}
