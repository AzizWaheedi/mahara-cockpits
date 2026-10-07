import {createHash} from 'node:crypto';
import type {ActionCtx,Row} from './runtime';
import {normalize,kuwaitToday} from './calculator';
import {archiveWinners} from './winners';
export const REQUIRED_STATE=['onboardings','clients','manualChanges','oldCampaigns','oldAds','oldTree','stills','offBoardDismissals'] as const;
export const stableId=(kind:string,parts:unknown[])=>`native:${kind}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
export function capture(state:Row){
 for(const key of REQUIRED_STATE)if(!Array.isArray(state[key]))throw new Error(`Source state ${key} has not been initialized; no feed will be published`);
 const tables:Record<string,Row[]>={dailyStats:[],bookingEvents:[]};const context:ActionCtx={
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
     const scoped=args.campaigns.filter((r:Row)=>r.onBoard),names=new Set(scoped.map((r:Row)=>r.campaignName));
     tables.campaigns=scoped;
     const dismissed=new Set(state.offBoardDismissals.map((r:Row)=>r.campaignName??r.campaign_name));
     tables.offBoardCampaigns=args.campaigns.filter((r:Row)=>!r.onBoard&&!r.internal&&Number(r.spend7d??0)>0&&!dismissed.has(r.campaignName)).map((r:Row)=>({campaignName:r.campaignName,accountName:r.accountName,clientName:r.clientName,spend7d:r.spend7d,leads7d:r.leads7d,syncedAt:r.syncedAt}));
     const stills=new Map(state.stills.map((r:Row)=>[r.key,r]));
     const missing:Row[]=[];
     const picture=(row:Row,old:Row|undefined)=>{const next={...row};const saved=stills.get(row.stillKey) as Row|undefined;if(saved?.status==='saved'&&saved.url){next.stillUrl=saved.url;next.stillTinyUrl=saved.tinyUrl;}if(!next.stillUrl&&old?.stillKey&&old.stillUrl&&(!old.creativeId||old.creativeId===row.creativeId)){next.stillKey=old.stillKey;next.stillUrl=old.stillUrl;next.stillTinyUrl=old.stillTinyUrl;}if(next.stillKey&&!next.stillUrl)missing.push({adId:next.metaId??next.metaAdId,creativeId:next.creativeId,accountId:next.accountId,campaignName:next.campaignName});return next;};
     tables.ads=args.ads.filter((r:Row)=>names.has(r.campaignName)).map((r:Row)=>picture(r,state.oldAds.find((x:Row)=>x.metaAdId&&x.metaAdId===r.metaAdId)));
     tables.metaTree=args.metaTree.map((r:Row)=>picture(r,state.oldTree.find((x:Row)=>x.metaId===r.metaId&&x.campaignName===r.campaignName)));
     if(!Array.isArray(state.media?.adChanges))throw new Error('Change history is not initialized');
     const changes=new Map<string,Row>(state.media.adChanges.map((r:Row)=>[r._id,r]));
     for(const row of prepareTables({adChanges:args.adChanges},{adChanges:state.media.adChanges}).adChanges)changes.set(row._id,row);
     tables.adChanges=[...changes.values()];tables.checkProposals=args.checks.map((c:Row)=>({...c,role:'media_buyer',day:kuwaitToday()}));tables.inbox=args.inbox;
     return {campaigns:scoped.length,ads:tables.ads.length,offBoard:tables.offBoardCampaigns.length,missingStills:missing.slice(0,30)};
    }
    case 'sync.syncDailyCampaign':tables.dailyStats=[...(tables.dailyStats??[]),...args.rows];return {written:args.rows.length};
    case 'sync.pruneDaily':tables.dailyStats=tables.dailyStats??[];return null;
    case 'sync.clearBookings':tables.bookingEvents=[];return null;
    case 'sync.storeGrain':tables.bookingEvents=[...(tables.bookingEvents??[]),...args.bookings];return null;
    case 'market.archiveWinners':{if(Array.isArray(tables.marketPlays)&&Array.isArray(state.winners)){return archiveWinners(state,tables);}return {archived:0,added:0,retired:0};}
    default:throw new Error(`Unsupported native mutation contract: ${name}`);
   }
  },
  scheduler:{async runAfter(_delay,name,_args){if(!['previews.captureStills','fanout.runFanout'].includes(name))throw new Error(`Unsupported native scheduled contract: ${name}`);return null;}}
 };
 return {context,tables};
}
export function prepareTables(tables:Record<string,Row[]>, prior:Record<string,Row[]> = {}){
 const key=(table:string,r:Row):unknown[]=>{
  switch(table){
   case 'campaigns':return r.metaCampaignId?['meta',r.metaCampaignId]:['task',r.metaAccountId??r.accountName,r.taskId??r.campaignName];
   case 'ads':return r.metaAdId?['meta',r.metaAdId]:['name',r.campaignName,r.adName];
   case 'dailyStats':return [r.campaignName,r.date,r.metaAdId??r.adName,r.adSetName??''];
   case 'bookingEvents':return [r.campaignName,r.locationId??'',r.eventId??r.id??r.contactId,r.startTime??r.date];
   case 'metaTree':return [r.campaignName,r.kind,r.metaId];
   case 'adChanges':return r.activityHash?[r.activityHash]:[r.objectId??r.metaId??'',r.at,r.eventType,r.actor??'',r.campaignName];
   case 'boardCards':case 'onboardings':return [r.taskId??r.id??r.title,r.kind??''];
   case 'inbox':return r.kind==='mention'?[r.taskId,'mention',r.commentId??r.at,r.commentId?'':r.author??'']:[r.taskId,'task'];
   case 'offBoardCampaigns':case 'launchWatch':return [r.campaignName??r.client,r.accountName??''];
   case 'checks':case 'checkProposals':return [r.key??r.checkKey,r.role??'',r.day??''];
   case 'marketPlays':return [r.adsetId??r.id??r.name];
   case 'winnersArchive':return [r.adId??r.metaAdId??r.id];
   case 'adStills':return [r.key??r.adId??r.id];
   case 'clientLinks':return [r.taskId??/^https:\/\/app\.clickup\.com\/t\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(String(r.url??''))?.[1]??r.name??r.id];
   case 'clients':return [r.taskId??r.name??r.id];
   case 'clientProfiles':return [r.taskId??r.clientName];
   case 'csTasks':case 'creativeTasks':case 'videoJobs':case 'contentPosts':return [r.taskId??r.id];
   case 'funnels':return [r.account,r.kind,r.formId??r.url??r.kind];
   case 'rosterDays':return [r.day];
   case 'churnEvents':return r._id?[r._id]:[r.day,r.key,r.from,r.to,r.kind];
   case 'appointments':return [r.apptId];
   case 'kpi':return [r.key,r.month??''];
   default:if(r._id)return [r._id];throw new Error(`Unapproved native output table: ${table}`);
  }
 };
 return Object.fromEntries(Object.entries(tables).map(([table,rows])=>{
  // Unchanged imported tables retain every original row and identity.
  if(rows===prior[table]){
   if(rows.some(r=>typeof r._id!=='string'||!r._id))throw new Error(`Missing source identity in ${table}`);
   if(new Set(rows.map(r=>r._id)).size!==rows.length)throw new Error(`Duplicate source identity in ${table}`);
   return [table,rows];
  }
  const old=new Map<string,string>();
  for(const row of prior[table]??[]){
   const identity=JSON.stringify(key(table,row));
   if(old.has(identity))throw new Error(`Ambiguous prior logical identity in ${table}`);
   if(row._id)old.set(identity,row._id);
  }
  const seen=new Set<string>(),ids=new Set<string>();
  return [table,rows.map(r=>{
   const parts=key(table,r);
   if(parts.some(p=>p===undefined||p===null))throw new Error(`Missing logical identity in ${table}`);
   const identity=JSON.stringify(parts);
   const legacyMention=table==='inbox'&&r.kind==='mention'?old.get(JSON.stringify([r.taskId,'mention',r.at,r.author??''])):undefined;
   const _id=old.get(identity)??legacyMention??r._id??stableId(table,parts);
   if(seen.has(identity)||ids.has(_id))throw new Error(`Duplicate logical identity in ${table}; no feed published`);
   seen.add(identity);ids.add(_id);return {...r,_id};
  })];
 }));
}
