import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
const prepared=z.object({contact:z.object({id:z.string(),name:z.string()}),calendar:z.object({id:z.string(),name:z.string(),minutes:z.number().positive()}),slots:z.array(z.string()),day:z.string(),timezone:z.literal('Asia/Kuwait')});
const receipt=z.object({appointmentId:z.string().min(1),startTime:z.string(),warning:z.string().optional()});
const pending=new Map<string,string>();
async function run(client:SupabaseClient|null,operation:'checkIns.prepare'|'checkIns.book',args:Record<string,string>){
 if(!client)throw Error('Sign in before booking a client check-in.');
 const {data:user,error:authError}=await client.auth.getUser();if(authError||!user.user)throw Error('Sign in before booking a client check-in.');
 const uid=user.user.id;let changed=false;const sub=client.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==uid)changed=true;}).data.subscription;
 const key=JSON.stringify([uid,operation,args]),requestId=pending.get(key)??crypto.randomUUID();pending.set(key,requestId);
 try{
  const {data,error}=await client.functions.invoke('cockpit-csm-api',{body:{operation,args,requestId,apply:operation==='checkIns.book'}});
  const current=await client.auth.getSession();if(changed||current.error||current.data.session?.user.id!==uid)throw Error('The signed-in account changed. Reload booking.');
  let response:unknown=data;if(error&&'context' in error&&error.context instanceof Response){try{response=await error.context.json();}catch{throw Error(error.message);}}
  const failure=z.object({error:z.string()}).safeParse(response);if(error||failure.success)throw Error(failure.success?failure.data.error:error?.message??'Booking needs checking. Do not create another appointment.');
  const verified=operation==='checkIns.prepare'?prepared.parse(response):receipt.parse(response);pending.delete(key);return verified;
 }finally{sub.unsubscribe();}
}
export async function prepareClientCheckIn(client:SupabaseClient|null,args:{taskId:string;day:string}){return prepared.parse(await run(client,'checkIns.prepare',args));}
export async function bookClientCheckIn(client:SupabaseClient|null,args:{taskId:string;contactId:string;startTime:string}){return receipt.parse(await run(client,'checkIns.book',args));}
