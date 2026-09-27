import type {SupabaseClient} from '@supabase/supabase-js';
import {readCsmClientProfile,readCsmPerformance} from './csmReadModel';
import {executeCsmAction} from './csmActionClient';
export async function fetchPerformanceOverview(client:SupabaseClient,_allowedClients?:string[]|null){return readCsmPerformance(client);}
export async function fetchClientProfile(client:SupabaseClient,clientName:string){return readCsmClientProfile(client,{clientName});}
export async function fetchTasksAdded(client:SupabaseClient,taskId:string):Promise<any[]>{
 const {data,error}=await client.rpc('cockpit_csm_tasks_added',{p_task_id:taskId});if(error)throw Error(error.message);if(!Array.isArray(data))throw Error('Task history was not confirmed');return data;
}
export async function addTask(client:SupabaseClient,_userEmail:string,args:{taskId:string;clientName:string;title:string;note?:string;department?:string;due?:number}):Promise<string>{
 const result=await executeCsmAction(client,'act',{taskId:args.taskId,kind:'ticket',action:args.title.trim().slice(0,140),note:args.note,department:args.department||'client_success',due:args.due,taskOrigin:'client_profile'});return result.receiptId;
}
export async function requestReportDoc(client:SupabaseClient,userEmailOrArgs:string|{clientName:string;month?:string;language?:string;note?:string;extras?:string[]},maybeArgs?:{clientName:string;month?:string;language?:string;note?:string;extras?:string[]}):Promise<{status:string;id:string}>{
 const args=typeof userEmailOrArgs==='object'?userEmailOrArgs:(maybeArgs??{clientName:''});
 // Verify client access before reporting the unavailable producer. A decision row is not a report job.
 const profile=await readCsmClientProfile(client,{clientName:args.clientName});if(!profile)throw Error('Choose an assigned client');
 throw Error('The report-document worker is not connected yet. No report request was queued.');
}
