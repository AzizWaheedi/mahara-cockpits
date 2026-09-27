import {runtime} from './runtime.ts';
export function sbWritable(){return true;}
// Stage derived rows. Only the final revision-fenced database transaction writes them.
export async function upsertMerge(table:string,rows:any[],conflict:string){
 if(table!=='cockpit_client_payments'||conflict!=='payment_id')throw Error('Unexpected finance output');
 runtime().payments.push(...rows);return rows;
}
