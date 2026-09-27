import {createHash} from 'node:crypto';
import type {ActionCtx,Row} from './runtime';
import {normalize} from './calculator';
export const REQUIRED_STATE=['onboardings','clients','manualChanges','oldAds','oldTree','stills','offBoardDismissals'] as const;
export const stableId=(kind:string,parts:unknown[])=>`native:${kind}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
export function capture(state:Row){
 for(const key of REQUIRED_STATE)if(!Array.isArray(state[key]))throw new Error(`Source state ${key} has not been initialized; no feed will be published`);
 const tables:Record<string,Row[]>={};const deferred:Row[]=[];const context:ActionCtx={
  async runQuery(name,args){
   switch(name){
    case 'sync.stagedInput':return state.stagedInput?JSON.stringify(state.stagedInput):null;
    case 'sync.onboardingClients':return (tables.onboardings??state.onboardings).map((r:Row)=>({client:r.client,taskUrl:r.taskUrl,status:r.status,accountId:r.accountId,accountName:r.accountName}));
    case 'sync.preLaunchClients':return state.clients.filter((r:Row)=>/launch booked|ready for launch|blueprint|onboarding booked/i.test(r.stage??'')).map((r:Row)=>({name:r.name,stage:r.stage}));
    case 'sync.recentManualChanges':return state.manualChanges.filter((r:Row)=>Number(r.at)>Date.now()-14*86400000);
    default:throw new Error(`Unsupported native query contract: ${name}`);
   }
  },
  async runMutation(name,args){
   switch(name){
    case 'board.storeBoardCards':tables.boardCards=args.rows;return args.rows.length;
    case 'sync.resolveOnboardingAccounts':{
     const rows=structuredClone(tables.onboardings??state.onboardings);let resolved=0,stillMissing=0;
     for(const row of rows){if(row.accountId)continue;let found:string|undefined;for(const name of [row.accountName,row.client].filter(Boolean)){const key=normalize(String(name));const hit=args.accounts.find((a:Row)=>a.name===key)??args.accounts.find((a:Row)=>a.name.length>=5&&(a.name.startsWith(key)||key.startsWith(a.name)));if(hit){found=hit.id;break;}}if(found){row.accountId=found;row.accountIdSource='meta';resolved++;}else stillMissing++;}
     tables.onboardings=rows;return {resolved,stillMissing};
    }
    case 'sync.storeOnboardings':tables.onboardings=args.rows;return args.rows.length;
    case 'sync.storeLaunchWatch':tables.launchWatch=args.rows;return args.rows.length;
    case 'sync.appendLaunchWatch':{const existing=tables.launchWatch??[];let added=0;for(const r of args.rows){const k=normalize(r.client),dup=existing.find(w=>{const a=normalize(w.client);return a===k||(a.length>=5&&(a.startsWith(k)||k.startsWith(a)));});if(dup){if(!dup.issues.some((i:string)=>/ads management board/.test(i))){dup.issues=[...dup.issues,...r.issues];dup.spend7d=Math.max(dup.spend7d,r.spend7d);}continue;}existing.push({...r,syncedAt:Date.now()});added++;}tables.launchWatch=existing;return added;}
    case 'sync.store':{
     if(!args.campaigns.length)throw new Error('Empty upstream campaign snapshot; preserving the previous feed');
     const scoped=args.campaigns.filter((r:Row)=>r.onBoard),names=new Set(scoped.map((r:Row)=>r.campaignName));
     if(!scoped.length)throw new Error('No campaigns matched the board; refusing to activate an empty roster');
     tables.campaigns=scoped;
     const dismissed=new Set(state.offBoardDismissals.map((r:Row)=>r.campaignName??r.campaign_name));
     tables.offBoardCampaigns=args.campaigns.filter((r:Row)=>!r.onBoard&&!r.internal&&Number(r.spend7d??0)>0&&!dismissed.has(r.campaignName)).map((r:Row)=>({campaignName:r.campaignName,accountName:r.accountName,clientName:r.clientName,spend7d:r.spend7d,leads7d:r.leads7d,syncedAt:r.syncedAt}));
     const stills=new Map(state.stills.map((r:Row)=>[r.key,r]));
     const missing:Row[]=[];
     const picture=(row:Row,old:Row|undefined)=>{const next={...row};const saved=stills.get(row.stillKey) as Row|undefined;if(saved?.status==='saved'&&saved.url){next.stillUrl=saved.url;next.stillTinyUrl=saved.tinyUrl;}if(!next.stillUrl&&old?.stillKey&&old.stillUrl&&(!old.creativeId||old.creativeId===row.creativeId)){next.stillKey=old.stillKey;next.stillUrl=old.stillUrl;next.stillTinyUrl=old.stillTinyUrl;}if(next.stillKey&&!next.stillUrl)missing.push({adId:next.metaId??next.metaAdId,creativeId:next.creativeId,accountId:next.accountId,campaignName:next.campaignName});return next;};
     tables.ads=args.ads.filter((r:Row)=>names.has(r.campaignName)).map((r:Row)=>picture(r,state.oldAds.find((x:Row)=>x.metaAdId&&x.metaAdId===r.metaAdId)));
     tables.metaTree=args.metaTree.map((r:Row)=>picture(r,state.oldTree.find((x:Row)=>x.metaId===r.metaId&&x.campaignName===r.campaignName)));
     tables.adChanges=args.adChanges;tables.checkProposals=args.checks;tables.inbox=args.inbox;
     return {campaigns:scoped.length,ads:tables.ads.length,offBoard:tables.offBoardCampaigns.length,missingStills:missing.slice(0,30)};
    }
    case 'sync.syncDailyCampaign':tables.dailyStats=[...(tables.dailyStats??[]),...args.rows];return {written:args.rows.length};
    case 'sync.pruneDaily':tables.dailyStats=tables.dailyStats??[];return null;
    case 'sync.clearBookings':tables.bookingEvents=[];return null;
    case 'sync.storeGrain':tables.bookingEvents=[...(tables.bookingEvents??[]),...args.bookings];return null;
    case 'market.archiveWinners':deferred.push({component:'winner-archive',reason:'Native archive producer is not implemented in media-core'});throw new Error('DEFERRED_COMPONENT: winner-archive');
    default:throw new Error(`Unsupported native mutation contract: ${name}`);
   }
  },
  scheduler:{async runAfter(_delay,name,args){if(!['previews.captureStills','fanout.runFanout'].includes(name))throw new Error(`Unsupported native scheduled contract: ${name}`);deferred.push({component:name==='fanout.runFanout'?'csm-creative-fanout':'still-capture',input:args,reason:'Separate native producer required; no outbound job was executed or marked complete'});return null;}}
 };
 return {context,tables,deferred};
}
export function prepareTables(tables:Record<string,Row[]>){
 const key=(table:string,r:Row)=>{
  switch(table){case 'campaigns':return r.metaCampaignId?['meta',r.metaCampaignId]:['task',r.metaAccountId??r.accountName,r.taskId??r.campaignName];case 'ads':return r.metaAdId?['meta',r.metaAdId]:['name',r.campaignName,r.adName];case 'dailyStats':return [r.campaignName,r.date,r.metaAdId??r.adName,r.adSetName??''];case 'bookingEvents':return [r.campaignName,r.locationId??'',r.eventId??r.id??r.contactId??'',r.date,r.adId??''];case 'metaTree':return [r.campaignName,r.kind,r.metaId];case 'adChanges':return [r.metaId??'',r.at,r.eventType,r.actor??'',r.campaignName];case 'boardCards':case 'onboardings':case 'inbox':return [r.taskId??r.id??r.title,r.kind??''];case 'offBoardCampaigns':case 'launchWatch':return [r.campaignName??r.client,r.accountName??'',r.sheetStatus??''];case 'checkProposals':return [r.key??r.checkKey,r.role??'media_buyer',r.day??''];default:throw new Error(`Unapproved native output table: ${table}`);}
 };
 return Object.fromEntries(Object.entries(tables).map(([table,rows])=>{const seen=new Set<string>();return [table,rows.map(r=>{const _id=stableId(table,key(table,r));if(seen.has(_id))throw new Error(`Duplicate logical identity in ${table}; no feed published`);seen.add(_id);return {...r,_id};})];}));
}
