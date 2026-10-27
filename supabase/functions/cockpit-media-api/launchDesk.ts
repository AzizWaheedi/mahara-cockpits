import {launchCatalog} from './launchCatalog.ts';
import {assertObjectScope, ADS_LIST, STATUS_FIELD, type Provider, type Row, type Plan, type MultiPlan} from './core.ts';
import {cardDefaults,cardNamed,kuwaitDay,launchCardStep,liveCard,prepareLog} from './cardDetails.ts';
import {budgetToUsd,budgetWords,usdToBudget,HUNDREDTHS} from './currency.ts';
import {cleanTargeting} from './b2b.ts';
import {copyableSpec,CREATIVE_FIELDS,storyOf,explainMeta} from './metaCreative.ts';
import {fromMeta,problems,toMetaCreate} from '../../../apps/media-buyer-cockpit/src/lib/leadForm.ts';
import {pages} from './funnel.ts';
import {CPL_GATE} from '../../../apps/media-buyer-cockpit/src/lib/kpi.ts';
export const DESK_OPERATIONS=['launch.readiness','launch.importCreatives','launch.copyIdeas','launch.switchOn','launch.copy','launch.rebuild','launch.new','launch.attachAccount','launch.logCampaign'];
export const REHEARSAL='Rehearsal. No changes will be made to Meta or ClickUp.';
export const UNPAID='This ad account owes Meta a payment. Meta refuses every change on it, pausing included, until the client pays in Ads Manager.';
export const id=(v:unknown)=>{if(!/^[0-9]{5,25}$/.test(String(v??'')))throw Error('Choose a valid Meta object');return String(v);};
const list=(r:Row,label:string):Row[]=>{if(r.paging?.next)throw Error(`${label} has more results. Refresh its complete source before launching.`);if(!Array.isArray(r.data))throw Error(`Meta did not return ${label}`);return r.data;};
export function launchEnabled(env:(k:string)=>string|undefined,rehearse:unknown){return env('LAUNCH_APPLY')==='on'&&rehearse!==true&&rehearse!==1&&rehearse!=='1';}
export function statusIssue(status:unknown):string|null{
 if(Number(status)===3)return UNPAID;
 if(Number(status)===2)return "Meta has disabled this ad account. Nothing can run on it until the client's appeal is accepted.";
 if([100,101].includes(Number(status)))return 'This ad account is closed. Choose another account for this client.';
 if(![1,7,8,9].includes(Number(status)))return 'Meta has not confirmed that this ad account is available. Check its access before launching.';
 return null;
}
export function campaignOwner(campaign:Row,client:Row,activities:Row[]){
 // A confirmed cockpit build is stronger evidence than a lagging activity feed.
 if((client.launches??[]).some((l:Row)=>l.meta_campaign_id===campaign.id&&l.state!=='reconcile'))return {kind:'mahara',name:'Mahara cockpit'};
 const events=activities.filter(a=>String(a.object_id)===String(campaign.id)&&/create/i.test(a.event_type??'')).sort((a,b)=>String(a.event_time).localeCompare(String(b.event_time)));
 const name=events[0]?.actor_name;const person=(client.people??[]).find((p:Row)=>p.name===name);
 return {kind:person?.kind??(name?'outsider':'unknown'),name:name??'Creator not recorded'};
}
export function bestCampaign(rows:Row[]){const eligible=rows.filter(r=>r.owner?.kind==='mahara'&&Number(r.leads)>=3&&Number.isFinite(r.cpl));const under=eligible.filter(r=>r.cpl<CPL_GATE);return (under.length?under.sort((a,b)=>b.leads-a.leads):eligible.sort((a,b)=>a.cpl-b.cpl))[0]??null;}
export function budgetLimit(s:Row){return s.founder?5000:s.contractedUsd?Math.min(5000,Number(s.contractedUsd)*2):100;}
export function budgetCheck(value:unknown,s:Row,cur:string){const n=Number(value);if(!HUNDREDTHS.has(cur))throw Error(`This ad account is in ${cur||'an unknown currency'}. Change the budget in Ads Manager.`);if(!Number.isFinite(n)||n<5||n>budgetLimit(s))throw Error(`Choose a daily budget from $5 to $${budgetLimit(s)}${s.founder?'':s.contractedUsd?' (twice the contracted budget)':' until a contracted budget is recorded'}.`);return usdToBudget(n,cur);}
export function campaignName(client:string,existing:Row[],now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuwait',day:'numeric',month:'numeric'}).formatToParts(now);const day=parts.find(x=>x.type==='day')!.value,month=parts.find(x=>x.type==='month')!.value;
 const base=`${client} |MAHARA| ${day}\\${month}`;let name=base;let n=1;while(existing.some(c=>c.name===name)){n++;name=`${base} ${String.fromCharCode(96+n)}`;if(n>26)throw Error('Too many campaign names today. Review the existing launches.');}return name;
}
export async function readiness(s:Row,client:Row,p:Provider,applyEnabled=false):Promise<Row>{
 const account=id(s.account);let live:Row;try{live=await p.call('meta','GET',`act_${account}?fields=id,name,account_status,disable_reason,currency,is_prepay_account,balance,spend_cap,amount_spent,funding_source_details,business`);}catch(e){throw Error(explainMeta(e instanceof Error?e.message:String(e)));}
 if(String(live.id).replace(/^act_/,'')!==account)throw Error('Meta returned another ad account. Nothing can be launched.');
 // The mirror omits Daily Ad Spend. Read the actual card before setting a cap.
 let contract=s.contractedUsd,contractSource=s.contractSource;
 for(const card of [...(client.cards??[])].sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')))){
  if(!card.taskId)continue;
  const task=await p.call('clickup','GET',`task/${card.taskId}`);
  if(String(task.list?.id)!==ADS_LIST||!(task.tags??[]).some((t:Row)=>String(t.name).toLowerCase()===String(s.client).toLowerCase()))throw Error('The Ads card no longer belongs to this client. Refresh the client book.');
  const field=task.custom_fields?.find((f:Row)=>f.name==='Daily Ad Spend');
  if(Number(field?.value)>0){contract=Number(field.value);contractSource='Ads card';break;}
 }
 const budgetScope={...s,contractedUsd:contract};
 const checks:Row[]=[];const check=(key:string,state:string,sentence:string,owner:string,fix:string)=>checks.push({key,state,sentence,owner,fix});
 const issue=statusIssue(live.account_status);check('account',issue?'block':[7,8,9].includes(Number(live.account_status))?'warn':'ok',issue??(Number(live.account_status)===9?'Meta could not charge this account. Ads still run for now; ask the client to fix the payment method.':[7,8].includes(Number(live.account_status))?'Meta is reviewing a payment on this account.':'Meta confirms this account is available.'),'Client','Open Ads Manager');
 check('currency',HUNDREDTHS.has(live.currency)?'ok':'block',HUNDREDTHS.has(live.currency)?`${live.currency} account. Budgets are entered in dollars.`:`This ad account is in ${live.currency??'an unknown currency'}. Change the budget in Ads Manager.`,'Media buyer','Choose another account');
 const funded=!!live.funding_source_details?.id&&(!live.is_prepay_account||Number(live.balance)>0);
 check('funding',funded?'ok':'warn',funded?'A payment method is recorded.':'This account has no way to pay. Ask the client to add a card in Ads Manager.','Client','Add a payment method');
 check('caller',client.serviceMode==='DWY'||client.caller===true?'ok':client.caller===null?'unknown':'warn',client.serviceMode==='DWY'?'The client’s team handles new enquiries.':client.caller===true?'A caller is assigned.':client.caller===null?'Caller assignments could not be read. Check the dialer before switching on.':`No caller is assigned to ${s.client} yet, so we cannot call new enquiries within 5 minutes. Assign one in the dialer first.`,'CSM','Assign a caller in the dialer');
 check('brief',client.brief?.sentAt?'ok':'warn',client.brief?.sentAt?'Blueprint part 1 has been sent to media.':'Blueprint part 1 has not been sent to media.','Creative director','Send Blueprint part 1');
 const campaigns=list(await p.call('meta','GET',`act_${account}/campaigns?fields=id,name,account_id,status,effective_status,daily_budget,lifetime_budget,objective,created_time&limit=200`),'campaigns');
 let activities:Row[]=(client.activities??[]).filter((a:Row)=>a.account_id===account);
 try{activities=[...list(await p.call('meta','GET',`act_${account}/activities?fields=actor_name,event_type,event_time,object_id,object_name&limit=500`),'account activities'),...activities];}catch{/* The mirrored creator log remains evidence; missing creators stay unknown. */}
 const candidates=campaigns.map(c=>{assertObjectScope(c,{account,campaign:id(c.id)},id(c.id));const h=(client.history??[]).find((r:Row)=>r.campaign_id===c.id&&r.account_id===account);return {...c,owner:campaignOwner(c,client,activities),leads:h?.leads??null,cpl:h?.cpl??null,lastRan:h?.last_ran??null};});
 const outsiders=candidates.filter(c=>c.status==='ACTIVE'&&c.owner.kind!=='mahara');
 check('ownership',outsiders.length?'block':'ok',outsiders.length?`People outside Mahara or with no verified creator record made ${outsiders.length} switched-on campaigns on this account. Relaunching here would let them run too. Move the client to a clean ad account first.`:'No switched-on campaign has an unverified creator.','CEO','Move to a clean account');
 const duplicates=candidates.filter((c,i,all)=>all.findIndex(x=>x.name===c.name)!==i);if(duplicates.length)check('names','warn','Some campaigns share a name. Choose by campaign ID.','Media buyer','Review campaign IDs');
 const blocked=checks.find(c=>c.state==='block')?.sentence;const callerReady=client.serviceMode==='DWY'||client.caller===true;
 const readonly=client.readOnly?'This client is stopped. Its launch history is read-only.':null;
 const routes=[{id:'switchOn',label:'Switch back on',reason:readonly??blocked??(!funded?'Add a payment method before switching on.':!callerReady?'Confirm the caller assignment before switching on.':!candidates.some(c=>c.owner.kind==='mahara')?'No campaign has a verified Mahara creator.':null)},{id:'copy',label:'Copy a past campaign',reason:readonly??blocked??(!candidates.some(c=>c.owner.kind==='mahara')?'No campaign has a verified Mahara creator.':null)},{id:'rebuild',label:'Rebuild on a clean account',reason:readonly??blocked??(!client.accounts?.some((a:Row)=>a.id!==account)?'Link a clean account and select it as the target.':null)},{id:'new',label:'New from the brief',reason:readonly??blocked??(!client.brief?.sentAt?'Send Blueprint part 1 first.':client.brief?.answers?.starter==='yes'&&!client.starterPack&&!client.brief?.answers?.pack_url?'The creative director needs to set the starter pack.':null)}].map(r=>({...r,available:!r.reason}));
 return {ok:true,account:live,checks,candidates,best:bestCampaign(candidates),routes,budget:{contractedUsd:contract,source:contractSource,cap:budgetLimit(budgetScope),currency:live.currency},applyEnabled,readAt:new Date().toISOString(),waitingBudgets:candidates.filter(c=>c.status==='ACTIVE').map(c=>({id:c.id,name:c.name,usd:budgetToUsd(Number(c.daily_budget),live.currency),owner:c.owner})),message:applyEnabled?null:REHEARSAL};
}
const metaCreate=(account:string,edge:string,body:Row,expected:Row):Plan=>({provider:'meta',method:'POST',path:`act_${account}/${edge}`,body,verifyPath:`$id?fields=id,${Object.keys(expected).join(',')}`,expected});
function checkedList(rows:Row[],scope:Row){for(const r of rows)assertObjectScope(r,scope,id(r.id));return rows;}
function promoted(raw:Row){return Object.fromEntries(['page_id','pixel_id','custom_event_type','custom_event_str','application_id'].filter(k=>raw?.[k]!=null).map(k=>[k,raw[k]]));}
async function verifyPages(ads:Row[],p:Provider){const get=pages(p);for(const page of new Set(ads.map(a=>a.creative?.object_story_spec?.page_id).filter(Boolean))){await get(id(page));}}
export async function prepareDesk(operation:string,a:Row,s:Row,client:Row,p:Provider,enabled=false):Promise<MultiPlan|{read:Row}>{
 if(operation==='launch.attachAccount'){
  const visible=list(await p.call('meta','GET','767701513092162/client_ad_accounts?fields=id,name,account_id,account_status,currency&limit=200'),'shared ad accounts');
  const found=visible.find(x=>String(x.account_id??x.id).replace(/^act_/,'')===s.account);if(!found)throw Error('This account is not shared with Mahara. Ask the client to share it first.');
  const current=await p.call('meta','GET',`act_${s.account}?fields=id,name,account_status,currency,business`);if(String(current.id).replace(/^act_/,'')!==s.account)throw Error('Meta returned a different account.');const issue=statusIssue(current.account_status);if(issue)throw Error(issue);
  return {steps:[],result:{clickupId:s.clickupId,locationId:s.locationId,accountId:s.account,clientName:s.client,campaignName:null,evidence:`Shared with Mahara business 767701513092162; ${String(found.name).slice(0,200)}`,did:'Linked the client ad account'}};
 }
 if(operation==='launch.readiness'&&a.cardDetails)return {read:await cardDefaults(s,client,a,p)};
 if(operation==='launch.logCampaign')return prepareLog(a,s,client,p);
 if(operation==='launch.readiness'&&a.sourceCampaignId){const source=id(a.sourceCampaignId);const sets=checkedList(list(await p.call('meta','GET',`${source}/adsets?fields=id,name,account_id,campaign_id&limit=100`),'ad sets'),{account:s.account,campaign:source});return {read:{ok:true,adsets:sets.map(x=>({id:x.id,name:x.name}))}};}
 if(operation==='launch.readiness'&&a.catalog)return {read:await launchCatalog(s,a,p)};
 const ready=await readiness(s,client,p,enabled);
 const budgetScope={...s,contractedUsd:ready.budget.contractedUsd};
 if(operation==='launch.readiness')return {read:ready};
 if((client.launches??[]).some((l:Row)=>l.state==='reconcile'&&l.account_id===s.account))throw Error('This launch may have reached Meta. Do not launch again; the CEO reconciles it.');
 const route=ready.routes.find((r:Row)=>`launch.${r.id}`===operation);if(!route?.available)throw Error(route?.reason??'Choose an available launch route');
 const cur=ready.account.currency,steps:Plan[]=[];let campaign:Row|null=null,adset:Row|null=null,ads:Row[]=[];let sourceScope:Row={account:s.account};
 if(operation!=='launch.new'){
  const sourceId=id(s.launch?.meta_campaign_id??a.sourceCampaignId);const sourceAccount=id(operation==='launch.rebuild'?a.sourceAccountId:s.account);
  if(!client.accounts.some((x:Row)=>x.id===sourceAccount))throw Error('The source account is not linked to this client');
  if(operation==='launch.rebuild'&&sourceAccount===s.account)throw Error('Choose a different clean target account');
  sourceScope={account:sourceAccount,campaign:sourceId};
  campaign=await p.call('meta','GET',`${sourceId}?fields=id,name,account_id,status,objective,daily_budget,lifetime_budget,special_ad_categories`);assertObjectScope(campaign,{account:sourceAccount,campaign:sourceId},sourceId);
  let sourceActivities=(client.activities??[]).filter((x:Row)=>x.account_id===sourceAccount);if(sourceAccount!==s.account){try{sourceActivities=[...list(await p.call('meta','GET',`act_${sourceAccount}/activities?fields=actor_name,event_type,event_time,object_id,object_name&limit=500`),'account activities'),...sourceActivities];}catch{}}const owner=campaignOwner(campaign,client,sourceActivities);
  const liveOwner=ready.candidates.find((x:Row)=>x.id===sourceId)?.owner;
  if((liveOwner??owner).kind!=='mahara')throw Error('This campaign has no verified Mahara creator. Its name is not proof.');
  if(Number(campaign.lifetime_budget)>0)throw Error('This campaign uses a lifetime budget. Review it in Ads Manager.');
  const sets=checkedList(list(await p.call('meta','GET',`${sourceId}/adsets?fields=id,name,account_id,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,targeting,promoted_object,destination_type,attribution_spec,status&limit=100`),'ad sets'),sourceScope);
  if(!sets.length)throw Error('This campaign has no ad set to reuse');
  if(sets.some(x=>Number(x.lifetime_budget)>0))throw Error('This campaign uses a lifetime budget. Review it in Ads Manager.');
  // Source ad set is an explicit ID, or the only set. Ambiguity never chooses arbitrary targeting.
  adset=sets.find(x=>x.id===a.sourceAdsetId)??(sets.length===1||operation==='launch.switchOn'?sets[0]:null);if(!adset)throw Error('Choose the source ad set for this campaign.');
  ads=checkedList(list(await p.call('meta','GET',`${operation==='launch.switchOn'?sourceId:adset.id}/ads?fields=id,name,account_id,campaign_id,adset_id,status,effective_status,ad_review_feedback,${CREATIVE_FIELDS}&limit=100`),'ads'),sourceScope);
  if(operation==='launch.switchOn'&&ads.some(x=>x.effective_status==='DISAPPROVED'||x.effective_status==='WITH_ISSUES'))throw Error('Meta has refused an ad in this campaign. Review it in Ads Manager before switching on.');
  const excluded=new Set(client.excludedAds??[]);
  if(operation==='launch.switchOn'&&ads.some(x=>excluded.has(x.id)))throw Error('This campaign includes an excluded ad. Review it before switching on.');
  ads=ads.filter(x=>!excluded.has(x.id));if(!ads.length)throw Error('There are no approved ads to use.');await verifyPages(ads,p);
  if(operation==='launch.switchOn'){
   const value=a.dailyBudgetUsd??(Number(campaign.daily_budget)>0?budgetToUsd(Number(campaign.daily_budget),cur):sets.reduce((n,x)=>n+(budgetToUsd(Number(x.daily_budget),cur)??0),0));budgetCheck(value,budgetScope,cur);
   if(a.dailyBudgetUsd!==undefined){if(!Number(campaign.daily_budget)&&sets.length!==1)throw Error('This campaign has several ad-set budgets. Review them individually in Ads Manager.');const holder=Number(campaign.daily_budget)>0?campaign:sets[0];steps.push({provider:'meta',method:'POST',path:holder.id,body:{daily_budget:budgetCheck(value,budgetScope,cur)},verifyPath:`${holder.id}?fields=id,daily_budget`,expected:{daily_budget:budgetCheck(value,budgetScope,cur)},precondition:{daily_budget:holder.daily_budget}});}
   for(const obj of [...ads,...sets,campaign])steps.push({provider:'meta',method:'POST',path:id(obj.id),body:{status:'ACTIVE'},verifyPath:`${obj.id}?fields=id,status`,expected:{id:obj.id,status:'ACTIVE'},precondition:{status:obj.status}});
   let cardId=s.launch?.card_task_id??cardNamed(client,campaign.name)?.taskId??await liveCard(client,s,campaign.name,p);
   if(cardId){const fields=(await p.call('clickup','GET',`list/${ADS_LIST}/field`)).fields;const option=fields?.find((x:Row)=>x.id===STATUS_FIELD)?.type_config?.options?.find((x:Row)=>x.name==='Live');if(!option)throw Error('ClickUp Live status is unavailable');const actual=await p.call('clickup','GET',`task/${cardId}`);if(actual.list?.id!==ADS_LIST)throw Error('The card is not on Ads Management');steps.push({provider:'clickup',method:'POST',path:`task/${cardId}/field/${STATUS_FIELD}`,body:{value:option.id},verifyPath:`task/${cardId}`,expected:{field:STATUS_FIELD,value:option.id,aliases:[option.id,option.orderindex]}});}
   // No card yet: the card is made now, with every launch form answer, so Make sees the launch when it goes live.
   else {cardId=`$step${steps.length}.id`;steps.push(await launchCardStep({name:campaign.name,s,client,details:a.details,spendUsd:Number(value),day:kuwaitDay(),campaignId:campaign.id},p));}
   // Snapshot today's real delivery so an old impression cannot mark a relaunch live.
   const delivery=list(await p.call('meta','GET',`${campaign.id}/insights?date_preset=today&fields=impressions,date_start&level=campaign&limit=1`),'campaign delivery');
   const baseline=delivery.reduce((n,x)=>n+Number(x.impressions??0),0);if(!Number.isFinite(baseline)||baseline<0)throw Error('Meta did not confirm current delivery. Refresh before switching on.');
   return {steps,result:{impressionsAtSwitch:baseline,impressionDay:delivery[0]?.date_start??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuwait'}).format(new Date()),clickupId:s.clickupId,locationId:s.locationId,clientName:s.client,accountId:s.account,campaignName:campaign.name,budgetUsd:value,budgetLevel:Number(campaign.daily_budget)>0?'campaign':'adset',metaCampaignId:campaign.id,metaAdsetIds:sets.map(x=>x.id),metaAdIds:ads.map(x=>x.id),cardTaskId:cardId,did:'Switched on. Waiting for first impressions.'}};
  }
 }
 const value=a.dailyBudgetUsd??budgetScope.contractedUsd;const minor=budgetCheck(value,budgetScope,cur);const name=campaignName(s.client,ready.candidates);const cbo=Number(campaign?.daily_budget)>0;
 steps.push(metaCreate(s.account,'campaigns',{name,objective:campaign?.objective??'OUTCOME_LEADS',status:'PAUSED',special_ad_categories:campaign?.special_ad_categories??[],...(cbo?{daily_budget:minor,bid_strategy:'LOWEST_COST_WITHOUT_CAP'}:{is_adset_budget_sharing_enabled:false})},{name,status:'PAUSED',account_id:s.account}));
 let formStep:Plan|undefined;let destinationType=adset?.destination_type;let optimization=adset?.optimization_goal??'LEAD_GENERATION';
 let targeting=adset?cleanTargeting(adset.targeting):null;let promotedObject=adset?promoted(adset.promoted_object):null;
 if(operation==='launch.rebuild'){targeting={...targeting};delete targeting.custom_audiences;delete targeting.excluded_custom_audiences;delete targeting.lookalike_spec;}
 if(operation==='launch.new'){
  const brief=client.brief?.answers??{};if(!client.brief?.sentAt)throw Error('Send Blueprint part 1 first.');
  if(!['lead_form','landing_page'].includes(brief.destination))throw Error('Choose a lead form or landing page in Blueprint part 1.');
  // These are imported account assets, not Drive URLs. Their ownership is verified below.
  if(!Array.isArray(a.media)||!a.media.length||a.media.length>6)throw Error('Import one to six client creatives into this account first.');
  const page=id(a.pageId);await pages(p)(page);const available=await launchCatalog(s,{pageId:page},p);
  const cities=await launchCatalog(s,{geoQuery:a.geoQuery,country:a.country},p);
  const city=cities.cities?.find((x:Row)=>String(x.key)===String(a.cityKey));if(!city)throw Error('Choose a verified city from the audience search.');
  const geo={cities:[{key:String(city.key),radius:25,distance_unit:'kilometer'}]};
  targeting={geo_locations:geo,age_min:Math.max(18,Number(client.handover?.age_min??25)),age_max:Math.min(65,Number(client.handover?.age_max??65)),targeting_automation:{advantage_audience:1}};promotedObject={page_id:page};destinationType='ON_AD';
  if(brief.destination==='landing_page'){const pixel=id(a.pixelId);const pixels=list(await p.call('meta','GET',`act_${s.account}/adspixels?fields=id,name&limit=100`),'account pixels');if(!pixels.some(x=>x.id===pixel))throw Error('Choose this account’s conversion pixel.');promotedObject={pixel_id:pixel,custom_event_type:'LEAD'};optimization='OFFSITE_CONVERSIONS';destinationType='WEBSITE';}
  if(!Array.isArray(a.variants)||a.variants.length!==a.media.length)throw Error('Approve a headline and primary text for each creative.');
  let form:string|undefined;if(brief.destination==='lead_form'&&a.templateFormId){
   const template=id(a.templateFormId);if(!available.forms?.some((f:Row)=>f.id===template))throw Error('Choose a template from this Page.');
   const token=(await pages(p)(page)).token;
   const raw=await p.call('meta','GET',`${template}?fields=id,name,locale,questions,context_card,privacy_policy,thank_you_page,question_page_custom_headline,follow_up_action_url`,undefined,{token});
   const spec=fromMeta(raw);spec.name=`${name} form`;const errors=problems(spec);if(errors.length)throw Error(`Review the template in Forms first: ${errors.map(e=>e.message).join('. ')}`);
   formStep={provider:'meta',method:'POST',path:`${page}/leadgen_forms`,body:toMetaCreate(spec),verifyPath:'$id?fields=id,name',expected:{name:spec.name},asPage:page};form='$step2.id';
  }else if(brief.destination==='lead_form'){form=id(a.formId);const token=(await pages(p)(page)).token;const f=await p.call('meta','GET',`${form}?fields=id,page,status`,undefined,{token});if(String(f.page?.id??f.page)!==page||f.status!=='ACTIVE')throw Error('Choose an active lead form belonging to this Page.');}
  const link=brief.destination==='landing_page'?String(a.landingUrl??''):'https://fb.me/';if(!/^https:\/\//.test(link))throw Error('Choose the approved HTTPS landing page.');
  ads=[];for(let n=0;n<a.media.length;n++){const media=a.media[n],copy=a.variants[n];if(!copy?.headline?.trim()||!copy?.primaryText?.trim()||copy.headline.length>120||copy.primaryText.length>1200)throw Error('Review the copy for each creative.');let data:Row={message:copy.primaryText,name:copy.headline,call_to_action:{type:'LEARN_MORE',value:{link,...(form?{lead_gen_form_id:form}:{})}}};let story:Row;
   if(media.videoId){const videos=list(await p.call('meta','GET',`act_${s.account}/advideos?fields=id,picture,status&limit=200`),'account videos');const video=videos.find(x=>x.id===id(media.videoId)&&x.status?.video_status==='ready');if(!video)throw Error('This video is not ready in the selected account.');story={video_data:{...data,video_id:media.videoId,image_url:video.picture}};}
   else {const hash=String(media.imageHash??'');if(!/^[a-zA-Z0-9]+$/.test(hash))throw Error('Choose an imported image');const images=list(await p.call('meta','GET',`act_${s.account}/adimages?hashes=${encodeURIComponent(JSON.stringify([hash]))}&fields=hash&limit=10`),'images');if(!images.some(x=>x.hash===hash))throw Error('The image is not in this account');story={link_data:{...data,link,image_hash:hash}};}
   ads.push({name:copy.headline,creative:{object_story_spec:{page_id:page,...story}}});
  }
 }
 if(!targeting||!promotedObject||!Object.keys(promotedObject).length)throw Error('The source has no verified audience and Page settings.');
 steps.push(metaCreate(s.account,'adsets',{campaign_id:'$step0.id',name:`${s.client} | launch`,status:'PAUSED',...(cbo?{}:{daily_budget:minor,bid_strategy:'LOWEST_COST_WITHOUT_CAP'}),targeting:JSON.stringify(targeting),promoted_object:JSON.stringify(promotedObject),optimization_goal:optimization,billing_event:adset?.billing_event??'IMPRESSIONS',...(destinationType?{destination_type:destinationType}:{}),...(adset?.attribution_spec?{attribution_spec:adset.attribution_spec}:{})},{status:'PAUSED',campaign_id:'$step0.id',account_id:s.account}));
 if(formStep)steps.push(formStep);
 const madeAds:string[]=[];
 for(const ad of ads.slice(0,6)){
  let creativeId:string;
  if(operation==='launch.copy')creativeId=id(ad.creative?.id);
  else {const copied=copyableSpec(ad.creative);if(!copied.ok)throw Error(copied.why);const spec=copied.spec;const story=storyOf(spec);if(!story)throw Error('This creative format cannot be rebuilt.');
   if(operation==='launch.rebuild'){
    if(story.data.video_id){const v=await p.call('meta','GET',`${id(story.data.video_id)}?fields=id,source,picture`);if(!/^https:\/\//.test(v.source??''))throw Error('The source video is unavailable. Import the original client file.');const at=steps.length;steps.push(metaCreate(s.account,'advideos',{file_url:v.source},{status:{video_status:'ready'}}));story.data.video_id=`$step${at}.id`;delete story.data.image_hash;story.data.image_url=v.picture;}
    else if(story.data.image_hash){const hash=story.data.image_hash,at=steps.length;steps.push({provider:'meta',method:'POST',path:`act_${s.account}/adimages`,body:{copy_from:JSON.stringify({source_account_id:sourceScope.account,hash})},imageUpload:true,verifyPath:`act_${s.account}/adimages?hashes=["$id"]&fields=hash,url`,expected:{}});story.data.image_hash=`$step${at}.id`;delete story.data.image_url;delete story.data.picture;}
    else throw Error('The source media cannot be copied. Import the original client file.');
   }
   const at=steps.length;steps.push(metaCreate(s.account,'adcreatives',{name:ad.name,object_story_spec:JSON.stringify(spec)},{account_id:s.account}));creativeId=`$step${at}.id`;
  }
  const at=steps.length;steps.push(metaCreate(s.account,'ads',{name:ad.name,adset_id:'$step1.id',status:'PAUSED',creative:JSON.stringify({creative_id:creativeId})},{status:'PAUSED',adset_id:'$step1.id',account_id:s.account}));madeAds.push(`$step${at}.id`);
 }
 // A paused build has no card. Switch on makes it, so Make never announces a campaign that is not running.
 const plan:MultiPlan={steps,result:{clickupId:s.clickupId,locationId:s.locationId,clientName:s.client,accountId:s.account,campaignName:name,budgetUsd:Number(value),budgetLevel:cbo?'campaign':'adset',sourceAccountId:campaign?sourceScope.account:null,sourceCampaignId:campaign?.id??null,metaCampaignId:'$step0.id',metaAdsetIds:['$step1.id'],metaAdIds:madeAds,cardTaskId:null,did:'Created paused. Review the campaign before switching on. Its ClickUp card is made at switch on.',budgetWords:budgetWords(Number(value),cur)}};
 // Both the server flag and explicit check are required. Rehearsal never sends validate_only POSTs.
 if(a.check===true&&enabled)plan.check=await checkPlan(plan,p,campaign,adset,ads[0]);
 return plan;
}
export async function checkPlan(plan:MultiPlan,p:Provider,campaign:Row|null,adset:Row|null,ad:Row|undefined){
 const checked:Row[]=[];for(const step of plan.steps.filter(x=>x.provider==='meta'&&x.path.match(/\/(campaigns|adsets|adcreatives|ads)$/))){
  let body=JSON.parse(JSON.stringify(step.body));
  const replace=(value:any):any=>typeof value==='string'?value.replace(/\$step(\d+)\.id/g,(_,n)=>{
   const target=plan.steps[Number(n)];if(target?.path.endsWith('/campaigns'))return campaign?.id??'$unavailable';if(target?.path.endsWith('/adsets'))return adset?.id??'$unavailable';if(target?.path.endsWith('/adcreatives')&&campaign?.account_id===plan.result?.accountId)return ad?.creative?.id??'$unavailable';return '$unavailable';
  }):Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)])):value;
  const serialized=JSON.stringify(replace(body));
  if(serialized.includes('$unavailable')){checked.push({path:step.path,ok:false,message:'This step needs its new parent or uploaded media before Meta can validate it. Review the paused build plan.'});continue;}
  body=JSON.parse(serialized);try{await p.call('meta','POST',step.path,{...body,execution_options:['validate_only']});checked.push({path:step.path,ok:true});}catch(e){checked.push({path:step.path,ok:false,message:explainMeta(e instanceof Error?e.message:String(e))});}
 }
 return {ready:checked.length>0&&checked.every(x=>x.ok),steps:checked};
}
