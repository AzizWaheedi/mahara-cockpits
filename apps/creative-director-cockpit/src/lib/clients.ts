import type {SupabaseClient} from '@supabase/supabase-js';
const canonical=(value:any):string=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,JSON.parse(canonical(value[k]))]))):value??null);
import {snapshotContext,buildRoster,buildDetail,buildContextPack,buildFunnels,buildScripts,buildScriptQueue,buildCalendar} from './creativeSourceModels';
export {isLive,isPrelaunch} from './creativeSourceModels';
type Any=any;
export interface ClientRosterItem {
  taskId: string;
  name: string;
  url?: string;
  clientStatus: string;
  happiness?: string;
  service?: string;
  launchDate?: number | string | null;
  prelaunch: boolean;
  docs: {
    brandDna?: string | null;
    offerCheatSheet?: string | null;
    blueprintForm?: string | null;
    drive?: string | null;
    history?: string | null;
    research?: string | null;
  };
  docsReady: boolean;
  openScripts: number;
  openVideos: number;
  hisMove: number;
  liveCampaigns: number;
}

export interface ClientRosterResult {
  clients: ClientRosterItem[];
  counts: {
    live: number;
    toContact: number;
    docsMissing: number;
  };
  toContact: string[];
  syncedAt: string | null;
}

async function source(client:SupabaseClient){
 const {data,error}=await client.rpc('cockpit_creative_source_read');
 if(error)throw new Error(error.message);
 if(!data?.tables||!data?.source)throw new Error('Creative source data is unavailable. Refresh and try again.');
 return {ctx:snapshotContext(data.tables),provenance:data.source};
}
const scopeOf=(names?:string[]|null)=>names?.length?new Set(names.map(n=>n.trim().toLowerCase())):null;
export async function fetchClientRoster(client:SupabaseClient,allowedClients?:string[]|null):Promise<ClientRosterResult>{const s=await source(client);return {...await buildRoster(s.ctx,scopeOf(allowedClients)),source:s.provenance};}
export async function fetchClientDetail(client:SupabaseClient,name:string):Promise<Any|null>{const s=await source(client);const data=await buildDetail(s.ctx,name,null);return data?{...data,source:s.provenance}:null;}
export async function fetchContextPack(client:SupabaseClient,name:string){const s=await source(client);const data=await buildContextPack(s.ctx,{name});if(!data)throw new Error('Client is not available for your account.');return {...data,source:s.provenance};}
export async function fetchFunnels(client:SupabaseClient,clientName?:string){const s=await source(client);return {...await buildFunnels(s.ctx,clientName,null),source:s.provenance};}
export async function fetchScriptsList(client:SupabaseClient,opts?:number|{limit?:number}){const s=await source(client);return {...await buildScripts(s.ctx,{limit:typeof opts==='number'?opts:opts?.limit}),source:s.provenance};}
export async function fetchScriptQueue(client:SupabaseClient,allowedClients?:string[]|null):Promise<Any>{const s=await source(client);return {...await buildScriptQueue(s.ctx,scopeOf(allowedClients)),source:s.provenance};}
export async function fetchCalendar(client:SupabaseClient,allowedClients?:string[]|null):Promise<Any>{const s=await source(client);return {...await buildCalendar(s.ctx,scopeOf(allowedClients)),source:s.provenance};}
// Writes use a separate audited operation contract. Never treat a decision-row insert as a task completion.
export async function queueClientAction(client:SupabaseClient,args:Any){
 const {data:auth,error:authError}=await client.auth.getUser();if(authError||!auth.user)throw new Error('Sign in again');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(args))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const key=`cockpit-client-action:${auth.user.id}:${hash}`;const requestId=localStorage.getItem(key)??crypto.randomUUID();localStorage.setItem(key,requestId);
 const {data,error}=await client.rpc('cockpit_creative_client_action',{p_operation:'queue',p_args:{...args,requestId}});if(error)throw new Error(error.message);if(!data?.id)throw new Error('The client action was not queued.');
 const applied=await client.functions.invoke('cockpit-creative-api',{body:{operation:'clientAction',args:{id:data.id},apply:true}});
 if(applied.error){const response=(applied.error as {context?:Response}).context;let detail:Any;try{detail=await response?.json();}catch{}throw new Error(detail?.error??applied.error.message);}
 if(applied.data?.state!=='done')throw new Error(applied.data?.error??'The action was saved but not confirmed. Check its status before retrying.');
 localStorage.removeItem(key);return data.id;
}

export async function fetchClientOutbox(client:SupabaseClient):Promise<Any[]>{const {data,error}=await client.rpc('cockpit_creative_client_action',{p_operation:'outbox',p_args:{}});if(error)throw new Error(error.message);if(!Array.isArray(data))throw new Error('The client action history is unavailable.');return data;}
export async function logClientTouch(client:SupabaseClient,args:Any):Promise<void>{const {error}=await client.rpc('cockpit_creative_client_action',{p_operation:'touch',p_args:args});if(error)throw new Error(error.message);}
