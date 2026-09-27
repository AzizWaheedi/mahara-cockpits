import type {SupabaseClient} from '@supabase/supabase-js';
import {buildSnapshot,buildOnboardings,buildLaunchWatch,buildTrackingIssues,buildMarketForClient,buildChangeResults,buildCreativeLaunchResult} from './mediaSourceModels';
import {kuwaitDay,shiftDay} from './changeResultsCore';
type Row=Record<string,any>;
export function mediaContext(tables:Record<string,Row[]>){
 const query=(rows:Row[],sortField='_creationTime',descending=false):any=>({
  withIndex(name:string,filter?:(q:any)=>unknown){let kept=rows;const q:any={};for(const [method,predicate]of Object.entries({eq:(a:any,b:any)=>a===b,gte:(a:any,b:any)=>a>=b,lte:(a:any,b:any)=>a<=b,gt:(a:any,b:any)=>a>b,lt:(a:any,b:any)=>a<b}))q[method]=(field:string,value:unknown)=>{kept=kept.filter(r=>predicate(r[field],value));return q;};filter?.(q);return query(kept,name==='by_rank'?'rank':name==='by_at'?'at':name.includes('date')?'date':sortField,descending);},
  order(direction:string){return query(rows,sortField,direction==='desc');},
  async collect(){return [...rows].sort((a,b)=>{const x=a[sortField]??0,y=b[sortField]??0;return(x<y?-1:x>y?1:0)*(descending?-1:1);});},
  async first(){return(await this.collect())[0]??null;},async take(n:number){return(await this.collect()).slice(0,n);}
 });
 return {db:{query(name:string){if(!Array.isArray(tables[name]))throw new Error(`Verified media source missing: ${name}`);return query(tables[name]);}}};
}
const required=(v:unknown,label:string)=>{if(typeof v!=='number'||!Number.isFinite(v))throw new Error(`Campaign ${label} is missing from the verified source`);return v;};
export function normalizeMediaCampaign(row:Row):Row{
 const raw=row.raw_data??{};
 return {...raw,_id:row.source_id??raw._id??String(row.id),id:row.id,
  campaignName:raw.campaignName??row.campaign_name,clientName:raw.clientName??raw.accountName??row.client_name,
  spend7d:required(raw.spend7d??(row.spend_7d==null?undefined:Number(row.spend_7d)),'spend'),leads7d:required(raw.leads7d??(row.leads_7d==null?undefined:Number(row.leads_7d)),'leads'),
  cpl:raw.cpl??(row.cpl==null?undefined:Number(row.cpl)),rank:row.rank??raw.rank,metaAccountId:raw.metaAccountId??row.meta_account_id,metaCampaignId:raw.metaCampaignId??row.meta_campaign_id,
  lastChangeAt:raw.lastChangeAt,findings:raw.findings};
}
export function normalizeMediaAd(row:Row):Row{
 const raw=row.raw_data??{};return {...raw,_id:row.source_id??raw._id??String(row.id),id:row.id,campaignName:raw.campaignName??row.campaign_name,adName:raw.adName??row.ad_name,metaAdId:raw.metaAdId??row.meta_ad_id,
 spend:raw.spend??(row.spend==null?undefined:Number(row.spend)),leads:raw.leads??(row.leads==null?undefined:Number(row.leads)),frequency:raw.frequency??(row.frequency==null?undefined:Number(row.frequency)),stillUrl:raw.stillUrl??row.still_url,thumbnailUrl:raw.thumbnailUrl??row.thumbnail_url};
}
export async function readMediaSources(client:SupabaseClient){
 const {data,error}=await client.rpc('cockpit_media_source_read');if(error)throw new Error(error.message);if(!data?.tables)throw new Error('Verified media source is unavailable');return data as {tables:Record<string,Row[]>;source:Row};
}
export async function readMediaSnapshot(client:SupabaseClient,day:string,checks:Row[],decisions:Row[],plan:Row[],eod:Row|null){
 const [source,campaignResult,adResult,prefsResult]=await Promise.all([readMediaSources(client),client.rpc('cockpit_media_live_campaigns'),client.from('cockpit_ads').select('*').eq('source_deleted',false),client.rpc('cockpit_media_preferences',{})]);
 for(const result of [campaignResult,adResult,prefsResult])if(result.error)throw new Error(result.error.message);
 if(!Array.isArray(campaignResult.data)||!Array.isArray(adResult.data)||!Array.isArray(prefsResult.data))throw new Error('The media source response is incomplete');
 const campaigns=campaignResult.data.map(normalizeMediaCampaign),names=new Set(campaigns.map(c=>c.campaignName));
 const ads=adResult.data.map(normalizeMediaAd).filter(a=>names.has(a.campaignName));
 const prefs=new Map<string,Row>();for(const p of [...source.tables.clientPrefs,...prefsResult.data])prefs.set(String(p.clientName).toLowerCase().trim(),p);
 const tables={...source.tables,campaigns,ads,clientPrefs:[...prefs.values()],checks:checks.map((r,i)=>({...r,role:'media_buyer',day,order:r.displayOrder??i})),decisions:decisions.map(r=>({...r,day})),planItems:plan.map(r=>({...r,role:'media_buyer',day})),eodReports:eod?[{...eod,role:'media_buyer',day}]:[]};
 return {...await buildSnapshot(mediaContext(tables),true),source:source.source};
}
export async function mediaSourceAction(client:SupabaseClient,operation:string,args:Row={}){
 const source=await readMediaSources(client);const tables={...source.tables};
 if(operation==='cockpit.onboardings')return buildOnboardings(mediaContext(tables));
 if(operation==='cockpit.launchWatch')return buildLaunchWatch(mediaContext(tables));
 if(operation==='tracking.issues')return buildTrackingIssues(mediaContext(tables));
 if(operation==='market.forClient')return buildMarketForClient(mediaContext(tables),args);
 if(operation==='campaignChat.read'||operation==='campaignChat.messages'){
  const {data,error}=await client.rpc('cockpit_media_campaign_history',{p_campaign:args.campaignName??args.campaignId});if(error)throw new Error(error.message);
  const rows=[...(tables.campaignChat??[]).filter(r=>(r.campaignName??r.campaignId)===(args.campaignName??args.campaignId)),...(data??[])];return [...new Map(rows.map(r=>[String(r._id),r])).values()].sort((a,b)=>a.at-b.at);
 }
 if(operation.startsWith('changeResults.')){
  const start=operation==='changeResults.forCreativeLaunch'?shiftDay(kuwaitDay(Number(args.launchedAt)),-3):shiftDay(kuwaitDay(Date.now()),-18);
  const end=operation==='changeResults.forCreativeLaunch'?shiftDay(kuwaitDay(Number(args.launchedAt)),3):kuwaitDay(Date.now());
  const {data,error}=await client.rpc('cockpit_media_statistics',{p_kind:'range',p_campaign:args.campaignName,p_start:start,p_end:end});if(error)throw new Error(error.message);
  const ctx=mediaContext({...tables,dailyStats:data.rows,bookingEvents:data.bookings});
  if(operation==='changeResults.forCampaign')return buildChangeResults(ctx,args);
  if(operation==='changeResults.forCreativeLaunch')return buildCreativeLaunchResult(ctx,args);
 }
 throw new Error(`Unsupported media read: ${operation}`);
}
