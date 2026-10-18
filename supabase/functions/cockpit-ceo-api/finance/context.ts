import type {FinanceContext} from './types.ts';
import type {ManualRow,ManualLoad} from './data/money.ts';
import type {BillingRow} from './billing.ts';
import {cleanText} from './attribution.ts';
type Row=Record<string,any>;
const stamp=(x:unknown)=>x?Date.parse(String(x)):null;
const number=(x:unknown)=>{const n=Number(x);if(x===null||x===undefined||!Number.isFinite(n))throw Error('Finance source contains an invalid number');return n;};
// A hand-logged entry, its client and note cleaned as native normalizeManual cleans them (money.js cleanText).
function manual(r:Row):ManualRow{return {id:r.id,day:r.day,amount:number(r.amount),currency:r.currency,amountUsd:number(r.amount_usd),usdPerUnit:number(r.usd_per_unit),client:cleanText(r.client_name,120),clickupTaskId:r.clickup_task_id??null,rail:r.rail,kind:r.kind,dealContracted:r.deal_contracted===null?null:number(r.deal_contracted),dealContractedUsd:r.deal_contracted_usd===null?null:number(r.deal_contracted_usd),note:r.note?cleanText(r.note,300):null,addedBy:'Aziz',addedAt:stamp(r.added_at)!,deletedAt:stamp(r.deleted_at),deletedBy:r.deleted_at?'Aziz':null};}
export function financeContext(source:Row):FinanceContext{
 const billing:BillingRow[]=source.billing.map((r:Row)=>{
  const out:any={taskId:r.clickup_task_id,name:r.client_name,syncedAt:stamp(r.captured_at)};
  const keys={stage:'stage',mrrUsd:'mrr_usd',ltvUsd:'ltv_usd',nextPaymentAmountUsd:'next_payment_usd',currency:'source_currency',nextPaymentDate:'next_payment_date',signupDate:'signup_date',launchDate:'launch_date',pausedOn:'paused_on',churnDate:'churn_date',nextContractRenewal:'next_renewal_date',paymentPlan:'payment_plan',paymentMethod:'payment_method',contractStatus:'contract_status',churnReason:'churn_reason',churnType:'churn_type',closer:'closer',leadSource:'lead_source'};
  for(const [key,col]of Object.entries(keys))if(r[col]!==null&&r[col]!==undefined)out[key]=['mrrUsd','ltvUsd','nextPaymentAmountUsd'].includes(key)?number(r[col]):r[col];return out;
 });
 if(!billing.length)throw Error('Client billing source is empty; refresh the mirror first');
 // The client cards as the native worker builds them (money.js cardReferences): every billing card first, so a new
 // client is matched before it has an alias row, then the alias names. First CSM named wins (2026-10-18 parity).
 const byTask=new Map<string,{taskId:string;names:string[];csm:string|null}>();
 const add=(taskId:unknown,name:unknown,aliases:unknown,csm:unknown)=>{
  if(!taskId)return;const id=String(taskId);const card=byTask.get(id)??{taskId:id,names:[],csm:null};
  for(const value of [name,...(Array.isArray(aliases)?aliases:[])]){const text=cleanText(value,120);if(text&&!card.names.includes(text))card.names.push(text);}
  if(csm&&!card.csm)card.csm=String(csm).trim().split(/\s+/)[0]||null;byTask.set(id,card);
 };
 for(const r of source.billing)add(r.clickup_task_id,r.client_name,[],r.csm);
 for(const r of source.aliases)add(r.task_id,r.name,r.aliases,r.csm);
 const cards=[...byTask.values()].filter(c=>c.names.length>0);
 return {async runQuery(ref:string,args:Row){
  if(ref==='billing')return billing;
  if(ref==='series')return source.series.filter((r:Row)=>r.metric===args.metric&&r.scope===args.scope&&r.day>=args.since).map((r:Row)=>({date:r.day,value:number(r.value)}));
  if(ref==='manual'){
   const live=source.manual.filter((r:Row)=>!r.deleted_at&&r.day>=args.from).sort((a:Row,b:Row)=>a.day.localeCompare(b.day)||String(a.added_at).localeCompare(b.added_at));
   if(live.length>=5000)throw Error('Manual history exceeds the original verified row limit');
   return {live:live.map(manual),removedThisMonth:source.manual.filter((r:Row)=>r.deleted_at&&r.day.slice(0,7)===args.month).map(manual),anyLive:source.manual.some((r:Row)=>!r.deleted_at),truncated:false,newestChangeAt:stamp(source.newestManualChange),cards} satisfies ManualLoad;
  }
  // The CEO's ties and the hand-kept payer mapping, from the same fenced snapshot the native worker reads.
  if(ref==='ties'||ref==='payers'){if(!Array.isArray(source[ref]))throw Error(`Canonical finance snapshot is missing ${ref}`);return source[ref];}
  throw Error('Unknown finance source');
 }} as FinanceContext;
}
