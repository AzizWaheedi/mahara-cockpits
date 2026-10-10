import {destinationLink,dropRedundant,explainMeta,storyOf} from './metaCreative.ts';
import {assertObjectScope,type MultiPlan,type Plan,type Provider,type Row} from './core.ts';
import {fromMeta,problems,toMetaCreate,versionName,type LeadFormSpec} from '../../../apps/media-buyer-cockpit/src/lib/leadForm.ts';

/**
 * Where a campaign's ads send people, and the lead form versions behind them.
 *
 * Aziz, 2026-10-10: "an easy way for each campaign so we can also look at where
 * the ad is leading ... the form with the questions on the form ... make the
 * funnel easily editable if it's a lead form from the cockpit itself."
 *
 * Meta never edits a published form. Publishing makes a new form on the Page,
 * a copy of each ad's creative pointing at it, and swaps the ad onto that copy;
 * every write is read back. The old form and creatives stay, so any version can
 * be switched back to. Before a plan is offered, each creative copy and each
 * swap is validated with Meta (validate_only), which creates nothing.
 */
export const FUNNEL_OPERATIONS=['funnel.read','forms.publish','forms.switch'];
const id=(x:unknown)=>{if(!/^\d{5,}$/.test(String(x??'')))throw new Error('A valid Meta id is required');return String(x);};
const AD_FIELDS='id,name,account_id,campaign_id,effective_status,adset{destination_type},creative{id,name,object_story_spec,asset_feed_spec,link_url,url_tags,degrees_of_freedom_spec,object_type}';
// The full read first; a Graph version that lacks a field falls back to the fields every version has.
const FULL_FORM='id,name,status,locale,created_time,leads_count,questions,context_card,thank_you_page,legal_content,privacy_policy_url,is_optimized_for_quality,question_page_custom_headline,follow_up_action_url';
const BASIC_FORM='id,name,status,locale,created_time,leads_count,questions,privacy_policy_url,question_page_custom_headline,follow_up_action_url';
const VALIDATE='["validate_only"]';
const GONE=new Set(['DELETED','ARCHIVED']);

type Page={token:string;name:string};
/** The Page's own token and name, fetched once per request. The token never reaches the browser or a receipt. */
export function pages(p:Provider){
 const seen=new Map<string,Promise<Page>>();
 return (pageId:string)=>{
  if(!seen.has(pageId))seen.set(pageId,(async()=>{
   let page:Row;
   try{page=await p.call('meta','GET',`${id(pageId)}?fields=id,name,access_token`);}catch(error){throw new Error(pageRefusal(pageId,error));}
   if(typeof page.access_token!=='string'||!page.access_token)throw new Error(pageRefusal(pageId));
   return {token:page.access_token,name:String(page.name??'')};
  })());
  return seen.get(pageId)!;
 };
}
function pageRefusal(pageId:string,error?:unknown){
 const raw=error instanceof Error?error.message:'';
 return `Meta will not let the cockpit act for the client's Facebook Page (${pageId}). The app needs a role on the Page that can manage ads: add it in the client's Business Settings under Pages, then try again.${raw?` Meta said: ${explainMeta(raw)}`:''}`;
}

/** The lead form an ad sends people to, in either creative shape. */
export function formIdOf(creative:Row|undefined):string|null{
 const story=storyOf(creative?.object_story_spec);
 const fromStory=story?.data?.call_to_action?.value?.lead_gen_form_id;
 const fromFeed=(creative?.asset_feed_spec?.call_to_actions??[]).map((c:Row)=>c?.value?.lead_gen_form_id).find(Boolean);
 const found=fromStory??fromFeed;
 return found?String(found):null;
}

export type Destination={kind:'form'|'website'|'whatsapp'|'messenger'|'instagram'|'call'|'unknown';formId?:string;url?:string};
/** What kind of place an ad leads to. A form wins over its placeholder link. */
export function destinationOf(ad:Row):Destination{
 const creative=ad.creative,formId=formIdOf(creative);
 if(formId)return {kind:'form',formId};
 const link=destinationLink(creative)??undefined,type=String(ad.adset?.destination_type??'').toUpperCase();
 const ctaType=String(storyOf(creative?.object_story_spec)?.data?.call_to_action?.type??'');
 if(type.includes('WHATSAPP')||/(wa\.me|whatsapp\.com)/i.test(link??''))return {kind:'whatsapp',url:link};
 if(type.includes('MESSENGER')||/\bm\.me\//i.test(link??''))return {kind:'messenger',url:link};
 if(type.includes('INSTAGRAM'))return {kind:'instagram',url:link};
 if(type.includes('PHONE')||ctaType==='CALL_NOW')return {kind:'call',url:link};
 if(link&&!/^https?:\/\/fb\.me\/?$/i.test(link))return {kind:'website',url:link};
 return {kind:'unknown'};
}

/** The Page that runs an ad. */
function pageOf(creative:Row|undefined):string|null{
 const page=creative?.object_story_spec?.page_id;
 return /^\d{5,}$/.test(String(page??''))?String(page):null;
}

/** A creative body for the same ad, everything kept, sending people to another form. */
export function withForm(creative:Row,formId:string,name:string):{ok:true;body:Row}|{ok:false;why:string}{
 if(!formIdOf(creative))return {ok:false,why:'That ad does not send people to an instant form.'};
 const spec=structuredClone(creative.object_story_spec??{}),feed=creative.asset_feed_spec?structuredClone(creative.asset_feed_spec):null;
 const story=storyOf(spec);
 if(story?.data?.call_to_action?.value?.lead_gen_form_id)story.data.call_to_action.value.lead_gen_form_id=formId;
 for(const cta of feed?.call_to_actions??[])if(cta?.value?.lead_gen_form_id)cta.value.lead_gen_form_id=formId;
 dropRedundant(spec);
 return {ok:true,body:{name:name.slice(0,200),object_story_spec:spec,...(feed?{asset_feed_spec:feed}:{}),...(creative.url_tags?{url_tags:creative.url_tags}:{}),...(creative.degrees_of_freedom_spec?{degrees_of_freedom_spec:creative.degrees_of_freedom_spec}:{})}};
}

async function campaignAds(s:Row,p:Provider):Promise<Row[]>{
 if(!s.campaign||!/^\d{5,}$/.test(String(s.campaign)))throw new Error('This campaign has no verified Meta id yet. Refresh the board.');
 const list=await p.call('meta','GET',`${s.campaign}/ads?fields=${AD_FIELDS}&limit=200`);
 if(list.paging?.next)throw new Error('This campaign has more than 200 ads. Change its forms in Ads Manager.');
 const ads=(list.data??[]).filter((ad:Row)=>!GONE.has(String(ad.effective_status)));
 for(const ad of ads)assertObjectScope(ad,s,String(ad.id));
 return ads;
}

/** A form read in full; with the Page token when the system token is refused. `full` is false when only the basic fields came back. */
async function readForm(p:Provider,page:(id:string)=>Promise<Page>,formId:string,pageId:string|null):Promise<{raw:Row;full:boolean}>{
 let last='';
 for(const as of ['system','page'] as const){
  let token:{token:string}|undefined;
  if(as==='page'){if(!pageId)break;try{token={token:(await page(pageId)).token};}catch(error){last=error instanceof Error?error.message:last;break;}}
  for(const fields of [FULL_FORM,BASIC_FORM]){
   try{return {raw:await p.call('meta','GET',`${id(formId)}?fields=${fields}`,undefined,token),full:fields===FULL_FORM};}
   catch(error){last=error instanceof Error?error.message:'Meta did not return the form';if(!/nonexisting field|Tried accessing/i.test(last))break;}
  }
 }
 throw new Error(last||'Meta did not return the form');
}

export type PageForm={id:string;name:string;status:string;createdTime:string|null;leadsAllTime:number|null};
/** Every form on the Page, for the version list. Empty when Meta will not list them. */
async function pageForms(p:Provider,page:(id:string)=>Promise<Page>,pageId:string):Promise<PageForm[]>{
 try{
  const {token}=await page(pageId);
  const list=await p.call('meta','GET',`${pageId}/leadgen_forms?fields=id,name,status,created_time,leads_count&limit=100`,undefined,{token});
  return (list.data??[]).map((f:Row)=>({id:String(f.id),name:String(f.name??''),status:String(f.status??''),createdTime:f.created_time??null,leadsAllTime:Number.isFinite(Number(f.leads_count))?Number(f.leads_count):null}));
 }catch{return [];}
}

/** Versions share a name stem: "Villa form", "Villa form · v2 · 2026-10-10 14:05". */
export const stem=(name:string)=>name.replace(/\s+·\s+v\d+.*$/,'').trim().toLowerCase();
const versionOf=(name:string)=>Number(/·\s+v(\d+)/.exec(name)?.[1]??1);

/** funnel.read: the campaign's destinations, each form in full, and its versions on the Page. */
export async function readFunnel(s:Row,p:Provider){
 const page=pages(p),ads=await campaignAds(s,p);
 const groups=new Map<string,Row>();
 for(const ad of ads){
  const d=destinationOf(ad),key=`${d.kind}:${d.formId??d.url??''}`;
  const g=groups.get(key)??{...d,pageId:pageOf(ad.creative),ads:[]};
  g.ads.push({id:String(ad.id),name:String(ad.name??ad.id),status:String(ad.effective_status??''),creativeId:ad.creative?.id?String(ad.creative.id):null});
  groups.set(key,g);
 }
 const destinations:Row[]=[];
 for(const g of groups.values()){
  if(g.kind!=='form'){destinations.push(g);continue;}
  try{
   const {raw,full}=await readForm(p,page,g.formId,g.pageId);
   const pageName=g.pageId?await page(g.pageId).then(x=>x.name,()=>null):null;
   const versions=g.pageId?(await pageForms(p,page,g.pageId)).filter(f=>stem(f.name)===stem(String(raw.name??''))).sort((x,y)=>versionOf(y.name)-versionOf(x.name)):[];
   destinations.push({...g,pageName,form:{id:String(raw.id??g.formId),name:String(raw.name??''),status:String(raw.status??''),createdTime:raw.created_time??null,leadsAllTime:Number.isFinite(Number(raw.leads_count))?Number(raw.leads_count):null,followUpUrl:raw.follow_up_action_url??null,spec:fromMeta(raw),full},versions});
  }catch(error){destinations.push({...g,unreadable:explainMeta(error instanceof Error?error.message:'Meta did not return the form')});}
 }
 destinations.sort((a,b)=>b.ads.length-a.ads.length);
 return {campaign:s.campaign,campaignName:s.campaignName,destinations,readAt:new Date().toISOString()};
}

type Swap={ad:Row;body:Row};
/** Validate each creative copy and each swap with Meta. Nothing is created. */
async function rehearse(swaps:Swap[],act:string,p:Provider){
 const out:Row[]=[];
 for(const {ad,body} of swaps){
  try{
   await p.call('meta','POST',`${act}/adcreatives`,{...body,execution_options:VALIDATE});
   await p.call('meta','POST',String(ad.id),{creative:{creative_id:String(ad.creative.id)},execution_options:VALIDATE});
   out.push({adId:String(ad.id),name:String(ad.name??ad.id),status:String(ad.effective_status??''),ok:true});
  }catch(error){out.push({adId:String(ad.id),name:String(ad.name??ad.id),status:String(ad.effective_status??''),ok:false,why:explainMeta(error instanceof Error?error.message:'Meta refused the change')});}
 }
 return out;
}

/** The ads to move: those on `from` (or on any form when none is given), narrowed to the chosen ids. */
function chosen(ads:Row[],from:string|null,adIds:unknown):Row[]{
 if(adIds!==undefined&&(!Array.isArray(adIds)||adIds.some(x=>!/^\d{5,}$/.test(String(x)))))throw new Error('Choose the ads to switch');
 const wanted=Array.isArray(adIds)?new Set(adIds.map(String)):null;
 const picked=ads.filter(ad=>{const f=formIdOf(ad.creative);return f&&(!from||f===from)&&(!wanted||wanted.has(String(ad.id)));});
 if(wanted&&picked.length!==wanted.size)throw new Error('An ad you chose no longer uses that form. Refresh the funnel and try again.');
 if(!picked.length)throw new Error('No ad in this campaign uses that form any more. Refresh the funnel.');
 if(picked.length>25)throw new Error('Switch at most 25 ads at a time.');
 return picked;
}

function samePage(ads:Row[]):string{
 const found=new Set(ads.map(ad=>pageOf(ad.creative)));
 if(found.size!==1||found.has(null))throw new Error('Those ads run on different Facebook Pages, or Meta did not say which. Switch them one Page at a time.');
 return [...found][0] as string;
}

function swapSteps(steps:Plan[],swaps:Swap[],act:string){
 for(const {ad,body} of swaps){
  const n=steps.length;
  steps.push({provider:'meta',method:'POST',path:`${act}/adcreatives`,body,verifyPath:'$id?fields=id',expected:{}});
  steps.push({provider:'meta',method:'POST',path:String(ad.id),body:{creative:{creative_id:`$step${n}.id`}},verifyPath:`${ad.id}?fields=creative{id}`,expected:{creative:{id:`$step${n}.id`}}});
 }
}

const and=(xs:string[])=>xs.length>1?`${xs.slice(0,-1).join(', ')} and ${xs.at(-1)}`:xs[0]??'';
function publishedSentence(spec:LeadFormSpec,ads:number,version:number){
 const extras=[spec.intro?'a greeting':'',spec.higherIntent?'a review step':'',spec.smsVerify?'SMS verification':'',spec.thankYou?'a thank-you screen':''].filter(Boolean);
 return `Published version ${version} of the lead form${extras.length?` with ${and(extras)}`:''}, ${spec.questions.length} question${spec.questions.length===1?'':'s'}, and switched ${ads} ad${ads===1?'':'s'} to it.`;
}

/** forms.publish: a new form version on the Page, then the campaign's ads onto it. */
export async function preparePublish(a:Row,s:Row,p:Provider):Promise<MultiPlan>{
 const spec=a.spec as LeadFormSpec;
 if(!spec||typeof spec!=='object'||!Array.isArray(spec.questions))throw new Error('Send the form you want to publish');
 const wrong=problems(spec);if(wrong.length)throw new Error(wrong[0].message);
 const page=pages(p),from=id(a.fromFormId),ads=chosen(await campaignAds(s,p),from,a.adIds),pageId=samePage(ads),act=`act_${id(s.account)}`;
 const {name:pageName}=await page(pageId);
 const version=Math.max(1,...(await pageForms(p,page,pageId)).filter(f=>stem(f.name)===stem(spec.name)).map(f=>versionOf(f.name)))+1;
 const name=versionName(spec.name,new Date(),version);
 const label=(ad:Row)=>`${ad.creative?.name??ad.name} · form v${version}`;
 // Rehearse with the form the ads use now: the copy has the same shape whichever form it names.
 const rehearsal=await rehearse(ads.map(ad=>{const made=withForm(ad.creative,from,label(ad));if(!made.ok)throw new Error(made.why);return {ad,body:made.body};}),act,p);
 const check={ready:rehearsal.every(r=>r.ok),pageId,pageName,name,version,ads:rehearsal};
 if(!check.ready)return {steps:[],result:{},check};
 const steps:Plan[]=[{provider:'meta',method:'POST',path:`${pageId}/leadgen_forms`,body:toMetaCreate({...spec,name}),verifyPath:'$id?fields=id,name',expected:{name},asPage:pageId}];
 swapSteps(steps,ads.map(ad=>{const made=withForm(ad.creative,'$step0.id',label(ad));if(!made.ok)throw new Error(made.why);return {ad,body:made.body};}),act);
 return {steps,result:{did:publishedSentence(spec,ads.length,version),formId:'$step0.id',formName:name,version,switched:ads.map(ad=>String(ad.id)),from},check};
}

/** forms.switch: move ads onto another form already on the same Page (switch back, or finish a switch). */
export async function prepareSwitch(a:Row,s:Row,p:Provider):Promise<MultiPlan>{
 const page=pages(p),to=id(a.toFormId);
 const ads=chosen(await campaignAds(s,p),a.fromFormId?id(a.fromFormId):null,a.adIds).filter(ad=>formIdOf(ad.creative)!==to);
 if(!ads.length)throw new Error('Those ads already use that form.');
 const pageId=samePage(ads),act=`act_${id(s.account)}`;
 const {raw:target}=await readForm(p,page,to,pageId);
 if(String(target.status??'').toUpperCase()!=='ACTIVE')throw new Error('That form is archived on the Page. Restore it in Meta first, or publish a new version.');
 const formName=String(target.name??to);
 const swaps=ads.map(ad=>{const made=withForm(ad.creative,to,`${ad.creative?.name??ad.name} · ${formName}`);if(!made.ok)throw new Error(made.why);return {ad,body:made.body};});
 const rehearsal=await rehearse(swaps,act,p);
 const check={ready:rehearsal.every(r=>r.ok),pageId,pageName:await page(pageId).then(x=>x.name,()=>null),name:formName,ads:rehearsal};
 if(!check.ready)return {steps:[],result:{},check};
 const steps:Plan[]=[];swapSteps(steps,swaps,act);
 return {steps,result:{did:`Switched ${ads.length} ad${ads.length===1?'':'s'} to the lead form "${formName}".`,formId:to,formName,switched:ads.map(ad=>String(ad.id))},check};
}
