import {parseAnyStatement,statementId,lineHash,classifyLine,categorise,KIND_LABEL,type LineKind} from './bank.ts';
export function prepareBank(fileName:string,text:string){
 if(typeof text!=="string"||text.length>4000000) throw Error("Choose a statement under 4 MB.");
 const p=parseAnyStatement(text);
 if(!p.lines.length||!p.account) throw Error("The statement needs an account and transaction lines.");
 return {parsed:p,body:{statement:{id:statementId(p),account:p.account,account_kind:p.accountKind,currency:p.currency,from_day:p.fromDay,to_day:p.toDay??p.lines.at(-1)?.day,closing_balance:p.closingBalance,file_name:fileName.slice(0,120)},lines:p.lines.map(l=>({...l,hash:lineHash(p.account,l),kind:classifyLine(l,p.accountKind,p.account),category:categorise(l.reference)})),problems:p.problems}};
}
export function bankResult(plan:ReturnType<typeof prepareBank>,saved:any){
 const p=plan.parsed;const kinds=new Map<string,{count:number;usd:number}>();
 for(const l of saved.inserted){const row=kinds.get(l.kind)??{count:0,usd:0};row.count++;row.usd+=Number(l.usd);kinds.set(l.kind,row);}
 return {statementId:saved.statementId,account:p.account,accountKind:p.accountKind,currency:p.currency,fromDay:p.fromDay,toDay:p.toDay,read:p.lines.length,kept:saved.kept,skipped:p.lines.length-saved.kept,problems:p.problems.slice(0,10),byKind:[...kinds].map(([kind,r])=>({kind,label:KIND_LABEL[kind as LineKind]??kind,count:r.count,usd:Math.round(r.usd*100)/100})),totals:{debit:p.totalDebit,credit:p.totalCredit,closingBalance:p.closingBalance}};
}

const fold=(x:unknown)=>String(x??'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function payerList(source:{payments:any[];voids:any[]},context:{cards:any[];mappings:any[]}){
 const voids=new Set(source.voids.map(v=>String(v.record_id))),groups=new Map<string,any>();
 for(const p of source.payments){
  if(p.deal_response_id&&!voids.has(String(p.deal_response_id)))continue;
  const payer=String(p.billing_name??'').trim()||p.user_email;if(!payer)continue;
  const usd=Number(p.net_amount);if(p.net_amount===null||!Number.isFinite(usd)||!/^\d{4}-\d{2}/.test(String(p.paid_on)))throw Error('A paid B2B row has an invalid amount or date');
  const month=String(p.paid_on).slice(0,7),r=groups.get(payer)??{payer,payments:0,usd:0,firstMonth:month,lastMonth:month};r.payments++;r.usd+=usd;r.firstMonth=month<r.firstMonth?month:r.firstMonth;r.lastMonth=month>r.lastMonth?month:r.lastMonth;groups.set(payer,r);
 }
 const map=new Map(context.mappings.map(r=>[r.payer_key,r]));let totalUsd=0,mappedUsd=0;
 const payers=[...groups.values()].map(r=>{
  r.usd=Math.round(r.usd*100)/100;const key=fold(r.payer),hit=map.get(key);totalUsd+=r.usd;if(hit)mappedUsd+=r.usd;
  const exact=context.cards.find(c=>fold(c.client)===key),near=key.length>=6?context.cards.find(c=>fold(c.client).length>=6&&(fold(c.client).includes(key)||key.includes(fold(c.client)))):null,c=exact??near;
  return {...r,suggestion:c?{clickupTaskId:c.clickupTaskId,client:c.client,why:exact?"the payer's name and the card's name are the same":"one name contains the other"}:null,mapped:hit?{clickupTaskId:hit.clickup_task_id,client:hit.client_name,note:hit.note??null}:null};
 }).sort((a,b)=>b.usd-a.usd);
 return {payers,canAssign:true,totalUsd:Math.round(totalUsd*100)/100,mappedUsd:Math.round(mappedUsd*100)/100};
}
