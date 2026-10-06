import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {KitsPage} from './onboardingCore';
const text=z.string(),nullable=text.nullable();
const form=z.object({form_id:text,response_id:text,submitted_at:text,answers:z.array(z.object({ref:text,title:text,value:text})),recording:nullable.optional(),payment:nullable.optional()});
const row=z.object({clickup_task_id:text,client_name:text,clickup_status:nullable,client_status:nullable,in_onboarding:z.boolean(),csm:nullable,signup_on:nullable,onboarding_call_on:nullable,launch_on:nullable,links:z.record(text,text),handover:z.object({closer:text.optional(),closer_notes:text.optional(),handoff_risks:text.optional(),go_live:text.optional(),billing_notes:text.optional(),client_profile:text.optional(),payment_plan:text.optional(),contract_status:text.optional(),contract_signed:text.optional(),daily_budget:z.number().optional(),service:text.optional()}).passthrough(),sales_transcript:nullable,forms:z.object({onboarding:form.optional(),kickoff:form.optional(),blueprint:form.optional()}).optional(),card_updated_at:nullable,seen_at:text,synced_at:text});
const run=z.object({started_at:text,finished_at:nullable,ok:z.boolean().nullable(),problem:nullable,trigger:text});
const page=z.object({rows:z.array(row),last:run.nullable(),lastOk:run.nullable(),now:text,problem:nullable.optional()});
async function guard(client:SupabaseClient){const {data,error}=await client.auth.getUser();if(error||!data.user)throw Error('Sign in before reading client links.');const uid=data.user.id;let changed=false;const sub=client.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==uid)changed=true;}).data.subscription;return {check:async()=>{const current=await client.auth.getSession();if(changed||current.error||current.data.session?.user.id!==uid)throw Error('The signed-in account changed. Reload client links.');},release:()=>sub.unsubscribe()};}
export async function readOnboardingKits(client:SupabaseClient|null,taskIds:string[]):Promise<KitsPage>{
 if(!client)throw Error('Sign in before reading client links.');const actor=await guard(client);
 try{await actor.check();const {data,error}=await client.rpc('cockpit_csm_onboarding_read',{p_task_ids:Array.from(new Set(taskIds))});await actor.check();if(error)throw Error(error.message);return page.parse(data);}finally{actor.release();}
}
export async function refreshOnboardingKits(client:SupabaseClient|null,taskId:string,taskIds:string[]):Promise<KitsPage>{
 if(!client)throw Error('Sign in before refreshing client links.');const actor=await guard(client);
 try{await actor.check();const {data,error}=await client.functions.invoke('cockpit-csm-api',{body:{operation:'onboarding.refresh',args:{taskId,taskIds:Array.from(new Set(taskIds))},apply:true,requestId:crypto.randomUUID()}});await actor.check();if(error)throw Error(error.message);return page.parse(data);}finally{actor.release();}
}
