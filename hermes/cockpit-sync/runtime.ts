import {AsyncLocalStorage} from 'node:async_hooks';
export type Row=Record<string,any>;
export interface ActionCtx{runQuery:(name:string,args:Row)=>Promise<any>;runMutation:(name:string,args:Row)=>Promise<any>;scheduler:{runAfter:(delay:number,name:string,args:Row)=>Promise<any>}}
export interface Reads{graph:(path:string,params?:Row)=>Promise<any>;tool:(name:string,args:Row)=>Promise<any>;fetch:(url:string,init?:RequestInit)=>Promise<Response>;log:(level:string,args:unknown[])=>void}
const context=new AsyncLocalStorage<Reads>();
function reads(){const r=context.getStore();if(!r)throw new Error('Native read context required');return r;}
export const withReads=<T>(r:Reads,fn:()=>Promise<T>)=>context.run(r,fn);
export const graph=<T=any>(path:string,params:Row={}):Promise<T>=>reads().graph(path,params);
export const callTool=<T=any>(name:string,args:Row):Promise<T>=>reads().tool(name,args);
export const providerFetch=(url:string,init?:RequestInit)=>reads().fetch(url,init);
export const recordLog=(level:string,...args:unknown[])=>reads().log(level,args);
export const MAHARA_BUSINESS_ID='767701513092162';
export const unwrap=(raw:any)=>{let out=raw;for(let i=0;i<5;i++){if(typeof out==='string'){try{out=JSON.parse(out);continue;}catch{return out;}}if(out&&typeof out==='object'&&'content'in out){out=out.content;continue;}if(out&&typeof out==='object'&&'body'in out){out=out.body;continue;}break;}return out;};
export async function supabaseQuery(query:string):Promise<Row[]>{const raw=unwrap(await callTool('mcp_supabase_execute_sql',{project_id:'bldgtotkfmhoxmlzowdx',query}));const parsed=typeof raw?.result==='string'?JSON.parse(raw.result):raw;if(!Array.isArray(parsed))throw new Error('Supabase source did not return rows');return parsed;}
export async function allAdAccounts(){const out:Row[]=[];for(const edge of ['owned_ad_accounts','client_ad_accounts']){const r=await graph(`${MAHARA_BUSINESS_ID}/${edge}`,{fields:'id,name,account_status,timezone_name,currency',limit:200});out.push(...(r.data??[]));}return out.map(a=>({...a,account_id:String(a.id??'').replace(/^act_/, '')}));}
// Explicit route names, not a remote generated API proxy. Unknown contracts fail closed.
const sync=['stagedInput','onboardingClients','preLaunchClients','recentManualChanges','resolveOnboardingAccounts','storeLaunchWatch','storeOnboardings','appendLaunchWatch','store','syncDailyCampaign','pruneDaily','clearBookings','storeGrain'];
export const internal:any={sync:Object.fromEntries(sync.map(n=>[n,`sync.${n}`])),board:{storeBoardCards:'board.storeBoardCards'},market:{archiveWinners:'market.archiveWinners'},fanout:{runFanout:'fanout.runFanout'},previews:{captureStills:'previews.captureStills'}};
