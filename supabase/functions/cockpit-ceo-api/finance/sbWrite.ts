import {runtime} from './runtime.ts';
export function sbWritable(){return true;}
// Stage derived rows. Only the final revision-fenced database transaction writes them.
export async function upsertMerge(table:string,rows:any[],conflict:string){
 if(conflict!=='payment_id')throw Error('Unexpected finance output');
 if(table==='cockpit_client_payments'){runtime().payments.push(...rows);return rows;}
 // The deal ledger (2026-10-18): front-end payments, written with the client payments by cockpit_finish_finance_refresh.
 if(table==='cockpit_deal_payments'){const r=runtime();(r.dealPayments??=[]).push(...rows);return rows;}
 throw Error('Unexpected finance output');
}
