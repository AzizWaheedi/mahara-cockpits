import type {Plan,Provider,Row} from '../cockpit-media-api/core.ts';
export const CREATIVE_LIST='901818016338';
const reasons:Record<string,string>={more_ads:'More ads to test',new_angle:'New message, angle, or hook',fatigue:'Refresh a fatigued ad',edit_visuals:'Improve the edit or visuals'};
export async function requestPlan(args:Row,scope:Row,requestId:string,source:Row,provider:Provider):Promise<{row:Row;plan:Plan}> {
 if(!reasons[args.reason])throw new Error('Choose a creative request reason');
 if(!/^\d{5,}$/.test(String(scope.account??'')))throw new Error('The client Meta account has not been synced');
 const note=typeof args.note==='string'?args.note.trim().slice(0,500):null;
 let ad:Row|undefined;
 if(args.sourceAdId){
  if(!/^\d{5,25}$/.test(args.sourceAdId))throw new Error('Choose a valid source ad');
  ad=await provider.call('meta','GET',`${args.sourceAdId}?fields=id,name,account_id,campaign{id}`);
  if(String(ad.id)!==args.sourceAdId||String(ad.campaign?.id)!==String(scope.campaign)||String(ad.account_id).replace(/^act_/,'')!==String(scope.account))throw new Error('That ad is not in this campaign');
 }
 const evidence=String(ad?source.adReason??source.reason??'Buyer requested new creative.':source.reason??'Buyer requested new creative.').slice(0,2000);
 const name=`Creative Request — ${scope.client} — ${reasons[args.reason]}`.slice(0,180);
 const row={id:requestId,campaign_name:scope.campaignName,client_name:scope.client,client_tag:source.clientTag??null,meta_account_id:String(scope.account),source_meta_ad_id:ad?.id??null,source_ad_name:ad?.name??null,request_reason:args.reason,evidence,note};
 return {row,plan:{provider:'clickup',method:'POST',path:`list/${CREATIVE_LIST}/task`,body:{name,markdown_description:[`Requested from the Media Buyer Cockpit.`,`Client: ${scope.client}`,`Campaign: ${scope.campaignName}`,`Reason: ${reasons[args.reason]}`,ad?`Affected ad: ${ad.name} (${ad.id})`:'Campaign request: no specific ad selected.',`Why: ${evidence}`,note?`Buyer note: ${note}`:'',`Creative request: ${requestId}`].filter(Boolean).join('\n\n'),tags:source.clientTag?[source.clientTag]:[]},verifyPath:'task/$id',expected:{name,list:{id:CREATIVE_LIST}},result:{id:'$id',url:'$url'}}};
}
export async function launchLink(args:Row,scope:Row,row:Row,provider:Provider,now=new Date()):Promise<Row> {
 if(!row||row.campaign_name!==scope.campaignName)throw new Error('Creative request not found for this campaign');
 if(!/^\d{5,25}$/.test(String(args.launchedAdId??'')))throw new Error('Choose the launched ad');
 if(row.launched_meta_ad_id){if(row.launched_meta_ad_id===args.launchedAdId)return {};throw new Error('A different launched ad is already linked');}
 if(row.source_meta_ad_id===args.launchedAdId)throw new Error('Select the replacement ad, not the original ad');
 if(['reviewed','cancelled'].includes(row.status))throw new Error('This creative request is closed');
 const day=String(args.launchedOn??'');const date=new Date(`${day}T00:00:00+03:00`);
 const kuwait=(d:Date)=>new Date(d.getTime()+10800000).toISOString().slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(date.getTime())||kuwait(date)!==day||day>kuwait(now)||(row.created_at&&day<kuwait(new Date(row.created_at))))throw new Error('Choose the day the replacement ad went live');
 const ad=await provider.call('meta','GET',`${args.launchedAdId}?fields=id,account_id,campaign{id}`);
 if(String(ad.id)!==args.launchedAdId||String(ad.campaign?.id)!==String(scope.campaign)||String(ad.account_id).replace(/^act_/,'')!==String(scope.account))throw new Error('That ad is not in this campaign');
 return {launched_meta_ad_id:args.launchedAdId,launched_at:date.toISOString(),launch_time_source:'buyer_date',status:'launched'};
}
export function feedbackRange(row:Row){
 if(!row.verdict||!row.launched_meta_ad_id||!row.launched_at)throw new Error('Review the launched ad before sharing its assessment');
 const base=new Date(new Date(row.launched_at).getTime()+10800000).toISOString().slice(0,10);
 const day=(offset:number)=>new Date(Date.parse(base+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
 return {beforeFrom:day(-3),beforeTo:day(-1),afterFrom:day(1),afterTo:day(3)};
}
export function feedbackText(row:Row,source:Row){
 const range=feedbackRange(row);
 const describe=(label:string,adId:string,from:string,to:string)=>{
  const daily=(source.rows??[]).filter((r:Row)=>r.metaAdId===adId&&r.date>=from&&r.date<=to);const days=new Set(daily.map((r:Row)=>r.date)).size;
  if(!days)return `${label}: ad data unavailable for ${from} to ${to}.`;
  const spend=daily.reduce((n:number,r:Row)=>n+Number(r.spend),0),leads=daily.reduce((n:number,r:Row)=>n+Number(r.leads),0);
  const bookings=(source.bookings??[]).filter((r:Row)=>r.adId===adId&&r.date>=from&&r.date<=to).length;
  return `${label} (${from} to ${to}): $${spend.toFixed(2)} spend, ${leads} leads, ${leads?`$${(spend/leads).toFixed(2)} CPL`:'CPL unavailable'}, ${bookings} bookings matched to this ad. ${days} of 3 days had ad records.`;
 };
 return [`Creative request ${row.id}`,'Buyer reviewed the new creative.',row.source_meta_ad_id?`Original ad: ${row.source_ad_name} (${row.source_meta_ad_id})`:'Requested for the campaign without an original ad.',`Launched ad: ${row.launched_meta_ad_id}`,`Assessment: ${String(row.verdict).replaceAll('_',' ')}`,row.source_meta_ad_id?describe('Original ad before',row.source_meta_ad_id,range.beforeFrom,range.beforeTo):'No original ad was linked for comparison.',describe('Replacement ad after',row.launched_meta_ad_id,range.afterFrom,range.afterTo),'These ads ran in different periods. Other changes may have affected the result; matched bookings exclude those without an ad link.'].join('\n');
}
