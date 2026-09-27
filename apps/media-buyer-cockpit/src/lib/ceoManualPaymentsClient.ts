import type {SupabaseClient} from "@supabase/supabase-js";
export const MANUAL_PAYMENTS_CHANGED="cockpit-manual-payments-changed";
export class ManualPaymentError extends Error {
 data:{code:"repeat"|"refused";message:string};
 constructor(message:string,code:"repeat"|"refused"="refused"){super(message);this.data={code,message};}
}
async function rpc(client:SupabaseClient,name:string,args?:Record<string,unknown>):Promise<any>{
 const {data,error}=await client.rpc(name,args);
 if(error){
  let code:"repeat"|"refused"="refused";
  try{if(JSON.parse(error.details)?.code==="repeat")code="repeat";}catch{}
  throw new ManualPaymentError(error.message,code);
 }
 return data;
}
function changed(){if(typeof window!=="undefined")window.dispatchEvent(new Event(MANUAL_PAYMENTS_CHANGED));}
function finite(value:unknown):number{
 if((typeof value!=="number" && typeof value!=="string") || String(value).trim()==="" || !Number.isFinite(Number(value)))throw new Error("Invalid payment amount in server receipt.");
 return Number(value);
}
function stamp(value:unknown):number{
 const t=Date.parse(String(value));if(!Number.isFinite(t))throw new Error("Invalid payment timestamp in server receipt.");return t;
}
function label(email:string|null){if(!email)return "unknown";if(["aziz@maharamedia.com","awaheedi2008@gmail.com"].includes(email.toLowerCase()))return "Aziz";
 const name=email.split("@")[0];return name?name.charAt(0).toUpperCase()+name.slice(1):"unknown";}
export function maskPaymentText(text:string):string{
 return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,"[email]").replace(/\+?\d[\d\s-]{6,}\d/g,
  m=>/^\d{4}-\d{1,2}-\d{1,2}$/.test(m)||m.replace(/\D/g,"").length<8?m:"[number]");
}
export async function manualPaymentList(client:SupabaseClient,args:{month?:string}={}){
 const data=await rpc(client,"cockpit_ceo_manual_payment_list",{p_month:args.month??null});
 if(!Array.isArray(data))throw new Error("The payment log was not confirmed.");
 return data.map(r=>{
  if(!r || typeof r.id!=="string" || typeof r.client_name!=="string" || !["USD","KWD"].includes(r.currency) ||
    !["bank_transfer","cheque","cash","tap","other"].includes(r.rail) || !["payment","refund"].includes(r.kind))throw new Error("Invalid payment row.");
  return {id:r.id,day:r.day,amount:finite(r.amount),currency:r.currency,amountUsd:finite(r.amount_usd),usdPerUnit:finite(r.usd_per_unit),
   client:maskPaymentText(r.client_name),clickupTaskId:r.clickup_task_id??null,rail:r.rail,kind:r.kind,
   dealContracted:r.deal_contracted===null?null:finite(r.deal_contracted),dealContractedUsd:r.deal_contracted_usd===null?null:finite(r.deal_contracted_usd),
   note:r.note?maskPaymentText(r.note):null,addedBy:label(r.added_by),addedAt:stamp(r.added_at),
   deletedAt:r.deleted_at===null?null:stamp(r.deleted_at),deletedBy:r.deleted_at===null?null:label(r.deleted_by)};
 });
}
export async function manualPaymentInfo(client:SupabaseClient){
 const data=await rpc(client,"cockpit_ceo_manual_payment_info");
 if(!data || typeof data.today!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.today) ||
  ![true,false,null].includes(data.tapLive) || typeof data.historyReady!=="boolean" || typeof data.totalsNeedRefresh!=="boolean")throw new Error("Payment configuration is unavailable.");
 return {...data,usdPerKwd:finite(data.usdPerKwd)} as {today:string;usdPerKwd:number;tapLive:boolean|null;historyReady:boolean;totalsNeedRefresh:boolean};
}
export async function manualPaymentClients(client:SupabaseClient){
 const data=await rpc(client,"cockpit_ceo_manual_payment_clients");
 if(!Array.isArray(data) || data.some(r=>!r || typeof r.name!=="string" || typeof r.clickupTaskId!=="string"))throw new Error("The client roster was not confirmed.");
 return data as {name:string;clickupTaskId:string;bucket:string|null}[];
}
export async function addManualPayment(client:SupabaseClient,args:Record<string,unknown>){
 const {requestId,...input}=args;
 const data=await rpc(client,"cockpit_ceo_manual_payment_add",{p_input:input,p_request_id:requestId??crypto.randomUUID()});
 if(typeof data!=="string" || !/^[A-Za-z0-9_-]{10,200}$/.test(data))throw new Error("The payment save was not confirmed.");
 changed();return data;
}
export async function changeManualPayment(client:SupabaseClient,args:Record<string,unknown>,removed:boolean){
 const data=await rpc(client,"cockpit_ceo_manual_payment_status",{p_id:args.id,p_removed:removed,p_reason:args.reason??null,p_allow_repeat:args.allowRepeat??false});
 if(!data || data.ok!==true || typeof data.changed!=="boolean")throw new Error("The payment change was not confirmed.");
 changed();return null;
}
export async function manualPaymentHistory(client:SupabaseClient,args:{id:string}){
 const data=await rpc(client,"cockpit_ceo_manual_payment_history",{p_id:args.id});
 if(!Array.isArray(data))throw new Error("The payment history was not confirmed.");
 return data.map(r=>({action:r.action,table:"ceoManualPayments",rowId:r.entity_id,
  what:maskPaymentText(typeof r.metadata?.what==="string"?r.metadata.what:"Payment history details unavailable"),
  by:label(r.actor_email),at:stamp(r.created_at)}));
}
