import {writeCopy,type Kind} from './copy.ts';
import {type ModelEnv,type ModelHealth} from './model.ts';
import {assertObjectScope,type Provider,type Row,type MultiPlan,type Plan} from './core.ts';
import {cleanTargeting} from './b2b.ts';
import {CREATIVE_FIELDS,copyableSpec,setCopy,flattenNote} from './metaCreative.ts';
type Any=Row;
const B2B='flwboeijllbtrufxkhts',ACCOUNT='746108264865897',ACT=`act_${ACCOUNT}`;
const KIND_LABEL={lead_gen:'Lead Gen',retargeting:'Retargeting'};
const num=(v:unknown)=>Number(v??0);
const metaId=(v:unknown)=>{if(!/^\d{5,}$/.test(String(v??'')))throw new Error('Invalid Meta id');return String(v);};
export const LAUNCH_OPERATIONS=['ceo.b2bLaunch.list','ceo.b2bLaunch.build','ceo.b2bLaunch.save','ceo.b2bLaunch.discard','ceo.b2bLaunch.launch','ceo.b2bManage.copyIdeas'];
export function checkDraft(a:Row){if(!['lead_gen','retargeting'].includes(a.kind))throw new Error('Choose lead generation or retargeting');if(typeof a.brief!=='string'||a.brief.trim().length<12||a.brief.length>10000)throw new Error('Write a brief of 12 to 10000 characters');if(typeof a.dailyBudgetUsd!=='number'||!Number.isFinite(a.dailyBudgetUsd)||a.dailyBudgetUsd<5||a.dailyBudgetUsd>5000)throw new Error('Budget must be from $5 to $5000');}
export function toDraft(r:Row){return {id:Number(r.id),kind:r.kind,name:r.name,brief:r.brief,dailyBudgetUsd:Number(r.daily_budget_usd),sourceAdsetName:r.source_adset_name??null,sourceReason:r.source_reason??null,cloneAdIds:r.clone_ad_ids??[],variants:r.variants??[],status:r.status,error:r.error??null,metaCampaignId:r.meta_campaign_id??null,metaAdsetId:r.meta_adset_id??null,metaAdIds:r.meta_ad_ids??[],createdAt:r.created_at};}
function copyBody(ad:Row){const c=ad.creative??{};return c.body??c.asset_feed_spec?.bodies?.[0]?.text??c.object_story_spec?.video_data?.message??c.object_story_spec?.link_data?.message??'';}
async function ownAd(id:unknown,p:Provider){const target=metaId(id),ad=await p.call('meta','GET',`${target}?fields=id,name,account_id,campaign_id,${CREATIVE_FIELDS}`);assertObjectScope(ad,{founder:true,account:ACCOUNT},target);return ad;}
function cleanPromoted(p:Row|undefined){if(!p)return undefined;return Object.fromEntries(['pixel_id','custom_event_type','custom_event_str','page_id','application_id','object_store_url','product_set_id','product_catalog_id','event_id','offer_id'].filter(k=>p[k]!=null).map(k=>[k,p[k]]));}
export async function readB2b(_project:string,query:string,env:ModelEnv,health:ModelHealth,request:typeof fetch=fetch){
 if(_project!==B2B||!/^\s*(select|with)\b/i.test(query))throw new Error('Only fixed B2B read-only source queries are allowed');
 const token=env('SUPABASE_ACCESS_TOKEN');if(!token)throw new Error('SUPABASE_ACCESS_TOKEN is required for B2B winner source reads');
 const receipt={provider:'supabase-management',method:'POST',resource:`${B2B}/database/query`};await health({...receipt,phase:'intent'});
 let response:Response;try{response=await request(`https://api.supabase.com/v1/projects/${B2B}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(30000)});}catch{await health({...receipt,phase:'unknown'});throw new Error('B2B source is unavailable; no source values were assumed');}
 await health({...receipt,phase:'response',http_status:response.status});if(!response.ok)throw new Error(`B2B source unavailable (${response.status})`);const rows=await response.json();if(!Array.isArray(rows))throw new Error('B2B source did not return rows');return rows;
}
async function bestAdset(kind: Kind, sql: any): Promise<Any | null> {
  const rows = await sql(
    B2B,
    `with ident as (
       select distinct on (adset_id) adset_id, adset_name, campaign_id, campaign_name
       from public.meta_ad_snapshots order by adset_id, date desc),
     spend as (
       select adset_id, sum(spend) as spend
       from public.meta_ad_snapshots where date >= current_date - 89 group by 1),
     map as (select distinct ad_id, adset_id from public.meta_ad_snapshots),
     leads as (
       select s.adset_id, count(*) as leads from public.leads l join map s on s.ad_id = l.ad_id
       where l.is_lead and l.lead_created_at >= now() - interval '90 days' group by 1),
     demos as (
       select s.adset_id,
              count(*) filter (where c.call_type='demo' and c.status in ('showed','confirmed','invalid')) as demos_shown
       from public.calls c join map s on s.ad_id = c.ad_id
       where c.booked_at >= now() - interval '90 days' group by 1)
     select i.adset_id, i.adset_name, i.campaign_id, i.campaign_name, sp.spend,
            coalesce(le.leads,0) as leads, coalesce(d.demos_shown,0) as demos_shown
     from ident i join spend sp using (adset_id)
     left join leads le using (adset_id) left join demos d using (adset_id)
     where sp.spend > 0 and public.b2b_campaign_type(i.campaign_name) = '${kind}'
     order by demos_shown desc, leads desc, sp.spend desc limit 1`,
  );
  return rows[0] ?? null;
}

/** Top ads of this kind in the last 90 days, for when no winner was ticked. */
async function topAds(kind: Kind, limit: number, sql: any): Promise<string[]> {
  const rows = await sql(
    B2B,
    `with ident as (
       select distinct on (ad_id) ad_id, ad_name, campaign_name
       from public.meta_ad_snapshots order by ad_id, date desc),
     spend as (
       select ad_id, sum(spend) as spend from public.meta_ad_snapshots
       where date >= current_date - 89 group by 1),
     leads as (
       select ad_id, count(*) as leads from public.leads
       where is_lead and ad_id is not null and lead_created_at >= now() - interval '90 days' group by 1),
     demos as (
       select ad_id, count(*) filter (where call_type='demo' and status in ('showed','confirmed','invalid')) as demos_shown
       from public.calls where ad_id is not null and booked_at >= now() - interval '90 days' group by 1)
     select i.ad_id from ident i join spend sp using (ad_id)
     left join leads le using (ad_id) left join demos d using (ad_id)
     where sp.spend > 0 and public.b2b_campaign_type(i.campaign_name) = '${kind}'
     order by coalesce(d.demos_shown,0) desc, coalesce(le.leads,0) desc, sp.spend desc
     limit ${Math.max(1, Math.min(limit, 8))}`,
  );
  return rows.map((r:Row) => String(r.ad_id));
}


export async function buildDraft(a:Row,p:Provider,env:ModelEnv,health:ModelHealth){
 checkDraft(a);const kind=a.kind as Kind,sql=(project:string,query:string)=>readB2b(project,query,env,health);
 const best=await bestAdset(kind,sql);let settings:Row={},reason='';
 if(best){const full=await p.call('meta','GET',`${metaId(best.adset_id)}?fields=id,name,account_id,targeting,optimization_goal,billing_event,promoted_object,campaign{objective}`);assertObjectScope(full,{founder:true,account:ACCOUNT},String(best.adset_id));settings={targeting:cleanTargeting(full.targeting),optimization_goal:full.optimization_goal,billing_event:full.billing_event,promoted_object:cleanPromoted(full.promoted_object),objective:full.campaign?.objective};const why=num(best.demos_shown)>0?`${num(best.demos_shown)} demos shown in 90 days`:num(best.leads)>0?`${num(best.leads)} leads in 90 days`:`the most same-kind spend in 90 days, $${num(best.spend).toFixed(0)}, without attributed calls`;reason=`Settings copied from "${best.adset_name}" (${why}).`;}
 else reason=`No ${KIND_LABEL[kind]} ad set spent in 90 days. The Kuwait default needs review before launch.`;
 if(a.cloneAdIds!==undefined&&(!Array.isArray(a.cloneAdIds)||a.cloneAdIds.length>8))throw new Error('Choose at most eight source ads');
 let cloneIds=(a.cloneAdIds??[]).map(metaId);const automatic=!cloneIds.length;if(automatic)cloneIds=await topAds(kind,2,sql);
 const winners=[];for(const id of cloneIds){const ad=await ownAd(id,p);winners.push({name:String(ad.name??id),body:String(copyBody(ad))});}
 if(winners.length)reason+=` Creatives ${automatic?'selected from same-kind winners':'selected by you'}: ${winners.map(x=>x.name).join('; ')}.`;
 let variants:any[]=[];try{variants=await writeCopy(kind,a.brief.trim(),a.language==='en'?'en':'ar',winners,5,env,health);}catch(error){reason+=` Copy was not written (${error instanceof Error?error.message:'model unavailable'}). Add approved copy or reuse the selected winners.`;}
 if(!cloneIds.length)reason+=' No reusable media was found; select source ads before launching.';
 return {...settings,status:'ready',source_adset_id:best?String(best.adset_id):null,source_adset_name:best?String(best.adset_name):null,source_campaign_id:best?String(best.campaign_id):null,source_reason:reason,objective:settings.objective??'OUTCOME_LEADS',targeting:settings.targeting??null,clone_ad_ids:cloneIds,variants,error:null};
}
export async function copyIdeas(a:Row,p:Provider,env:ModelEnv,health:ModelHealth){
 if(typeof a.brief!=='string'||a.brief.trim().length<12)throw new Error('Write a brief first');
 const target=metaId(a.adsetId),set=await p.call('meta','GET',`${target}?fields=id,account_id,campaign{name}`);assertObjectScope(set,{founder:true,account:ACCOUNT},target);
 const kind=/retarget|remarket|hammer them/i.test(set.campaign?.name??'')?'retargeting':'lead_gen';
 let ids=(a.fromAdIds??[]).slice(0,4).map(metaId);if(!ids.length){const list=await p.call('meta','GET',`${target}/ads?fields=id&limit=4`);ids=(list.data??[]).map((x:Row)=>metaId(x.id));}
 const winners=[];for(const id of ids){const ad=await ownAd(id,p);winners.push({name:String(ad.name??id),body:String(copyBody(ad))});}
 return {kind,ideas:await writeCopy(kind,a.brief,a.language==='en'?'en':'ar',winners,a.count??5,env,health)};
}
export async function prepareLaunch(row:Row,p:Provider):Promise<MultiPlan>{
 if(!['ready','failed'].includes(row.status)||row.meta_campaign_id||row.launch_action_id)throw new Error('This draft is already launching, launched, or needs reconciliation');
 if(!['lead_gen','retargeting'].includes(row.kind)||Number(row.daily_budget_usd)<5||Number(row.daily_budget_usd)>5000)throw new Error('Review the draft kind and budget');
 if(row.kind==='retargeting'&&!/retarget|remarket|hammer them/i.test(row.name))throw new Error('Retargeting must remain in the campaign name');
 if(row.kind==='lead_gen'&&/retarget|remarket|hammer them|hiring|recruit/i.test(row.name))throw new Error('Keep the lead-generation campaign name classified correctly');
 const clones=[];for(const id of row.clone_ad_ids??[])clones.push(await ownAd(id,p));
 if(!clones.length)throw new Error('Select source ads so the campaign has reusable media');
 const variants=row.variants??[];if(!Array.isArray(variants)||variants.length>5)throw new Error('Approve at most five variants');
 const steps:Plan[]=[{provider:'meta',method:'POST',path:`${ACT}/campaigns`,body:{name:row.name,objective:row.objective??'OUTCOME_LEADS',status:'PAUSED',special_ad_categories:[],is_adset_budget_sharing_enabled:'false'},verifyPath:'$id?fields=id,name,status',expected:{name:row.name,status:'PAUSED'}},
 {provider:'meta',method:'POST',path:`${ACT}/adsets`,body:{campaign_id:'$step0.id',name:`${KIND_LABEL[row.kind as Kind]} | ${row.source_adset_name??'fresh'}`,status:'PAUSED',daily_budget:Math.round(Number(row.daily_budget_usd)*100),bid_strategy:'LOWEST_COST_WITHOUT_CAP',targeting:JSON.stringify(cleanTargeting(row.targeting)),optimization_goal:row.optimization_goal??'OFFSITE_CONVERSIONS',billing_event:row.billing_event??'IMPRESSIONS',...(row.promoted_object?{promoted_object:JSON.stringify(cleanPromoted(row.promoted_object))}:{})},verifyPath:'$id?fields=id,status,campaign_id',expected:{status:'PAUSED',campaign_id:'$step0.id'}}];
 const adIds:string[]=[];const addAd=(name:string,creativeId:string)=>{const index=steps.length;steps.push({provider:'meta',method:'POST',path:`${ACT}/ads`,body:{name,adset_id:'$step1.id',status:'PAUSED',creative:JSON.stringify({creative_id:creativeId})},verifyPath:'$id?fields=id,status,adset_id',expected:{status:'PAUSED',adset_id:'$step1.id'}});adIds.push(`$step${index}.id`);};
 for(const ad of clones)addAd(`${ad.name??ad.id} | relaunch`,metaId(ad.creative?.id));
 let rebuilt:any=null,note:string|null=null;for(const ad of clones){const copy=copyableSpec(ad.creative);if(copy.ok){rebuilt=copy.spec;note=flattenNote(copy.flattened);break;}}
 if(variants.length&&!rebuilt)throw new Error('The selected winners cannot carry new copy; choose another media template');
 for(const [i,v] of variants.entries()){if(typeof v.headline!=='string'||typeof v.primaryText!=='string'||!v.headline.trim()||!v.primaryText.trim())throw new Error('Each approved variant needs headline and primary text');const spec=structuredClone(rebuilt);setCopy(spec,{message:v.primaryText,headline:v.headline});const label=`Angle ${i+1} | ${v.headline.slice(0,40)}`,index=steps.length;steps.push({provider:'meta',method:'POST',path:`${ACT}/adcreatives`,body:{name:label,object_story_spec:JSON.stringify(spec)},verifyPath:'$id?fields=id',expected:{}});addAd(label,`$step${index}.id`);}
 return {steps,result:{...toDraft(row),status:'launched',error:note,metaCampaignId:'$step0.id',metaAdsetId:'$step1.id',metaAdIds:adIds}};
}
