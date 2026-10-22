import type {Row} from './core.ts';
import {clean,describeChange,problems,type PageFormSpec} from '../../../apps/media-buyer-cockpit/src/lib/pageForm.ts';

/**
 * The questions on a client's own form page (Merge Studio first), read and
 * published from the media buyer's client page (Lead page).
 *
 * Muhammed, 2026-10-22: the media buyer adds and removes questions without a
 * developer, and an edit goes live at once. Publishing records a version
 * (cockpit_page_form_record), writes the page's public file, reads it back
 * through the public address, and only then marks the version live
 * (cockpit_page_form_go_live). Every version stays, so any one can be switched
 * back. A write whose read-back fails is left pending and the receipt goes to
 * reconcile; the page keeps whatever the public file holds.
 */
export const PAGE_FORM_OPERATIONS=['pageForms.read','pageForms.publish','pageForms.switch','pageForms.funnel'];
const SLUG=/^[a-z][a-z0-9-]{1,40}$/;

export type FormRow={slug:string;client_name:string;title:string;site_url:string;object_path:string;photos:string[];bindings:Record<string,string>;live_version:number|null};
export type VersionRow={version:number;spec:PageFormSpec;summary:string;source:'build'|'cockpit';actor_email:string|null;created_at:string;first_live_at:string|null};
/** cockpit_page_form_funnel: visits per screen for one version, visits per version, the last event, the hosts counted. */
export type FunnelData={screens:Record<string,number>;versions:{version:string;visits:number}[];lastAt:string|null;hosts:string[]|null};

/** Everything the operations touch, so tests can run them without Supabase. */
export interface PageFormStore {
 forms(slugs:string[]):Promise<FormRow[]>;
 versions(slug:string):Promise<VersionRow[]>;
 record(a:{slug:string;spec:PageFormSpec;summary:string;base:number;baseline:PageFormSpec|null;actor:string;email:string;action:string}):Promise<number>;
 goLive(slug:string,version:number,base:number):Promise<void>;
 upload(path:string,body:string):Promise<void>;
 /** The stored file itself, past any cache. */
 download(path:string):Promise<string>;
 publicUrl(path:string):string;
 /** The receipt, before any write. Returns the earlier result when this exact request already finished. */
 begin(row:{id:string;operation:string;args:Row;plan:Row}):Promise<Row|null>;
 finish(id:string,result:Row):Promise<void>;
 reconcile(id:string,message:string):Promise<void>;
 /** The page's drop-off events (page-form-events), counted per visit. */
 funnel(slug:string,version:string,since:Date):Promise<FunnelData>;
}
export type PageFormDeps={store:PageFormStore;scope:(slug:string|null,client:string|null)=>Promise<Row>;fetch:typeof fetch;health:(row:Row)=>Promise<void>;now?:()=>Date};

const label=(n:number)=>`v${n}`;
const fail=(message:string):never=>{throw new Error(message);};
const sorted=(value:any):any=>value&&typeof value==='object'?(Array.isArray(value)?value.map(sorted):Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sorted(value[k])]))):value;
const canonical=(value:unknown)=>JSON.stringify(sorted(value));
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run the writes behind a receipt; any failure after it leaves the receipt to reconcile. */
async function underReceipt(id:string,d:PageFormDeps,work:()=>Promise<Row>){
 try{const result=await work();await d.store.finish(id,result);return result;}
 catch(error){const message=error instanceof Error?error.message:'Page form publish failed';await d.store.reconcile(id,message).catch(()=>{});throw new Error(`${message} (receipt ${id})`);}
}

/** The questions the page was built with: its /form.json, read before the first publish. */
export async function builtQuestions(form:FormRow,d:PageFormDeps):Promise<PageFormSpec|null>{
 const resource=`${form.site_url}/form.json`;
 await d.health({provider:'page',method:'GET',resource,phase:'intent'});
 let response:Response;
 try{response=await d.fetch(resource,{signal:AbortSignal.timeout(10000),headers:{'Cache-Control':'no-cache'}});}
 catch{await d.health({provider:'page',method:'GET',resource,phase:'unknown'});return null;}
 await d.health({provider:'page',method:'GET',resource,phase:'response',http_status:response.status});
 if(!response.ok)return null;
 try{const data=await response.json();return Array.isArray(data?.questions)?{version:String(data.version??'v1'),questions:data.questions}:null;}catch{return null;}
}

/** Keys of questions removed in an earlier version: never reused for a new question. */
export function retiredKeys(versions:VersionRow[],live:PageFormSpec|null){
 const now=new Set((live?.questions??[]).map(q=>q.key));
 return [...new Set(versions.flatMap(v=>(v.spec?.questions??[]).map(q=>q.key)))].filter(k=>!now.has(k));
}

/** pageForms.read: the client's pages, each with its live questions and history. */
export async function readPageForms(args:Row,d:PageFormDeps){
 const client=typeof args.client==='string'&&args.client.trim()?args.client.trim():fail('Name the client');
 const scope=await d.scope(null,client);
 const forms=await d.store.forms(Array.isArray(scope.slugs)?scope.slugs:[]);
 return {pages:await Promise.all(forms.map(async form=>{
  const versions=await d.store.versions(form.slug);
  const live=versions.find(v=>v.version===form.live_version)??null;
  const built=live?null:await builtQuestions(form,d);
  return {
   slug:form.slug,title:form.title,siteUrl:form.site_url,photos:form.photos,
   publicUrl:d.store.publicUrl(form.object_path),
   bindings:form.bindings,
   liveVersion:form.live_version??0,
   // What the editor starts from: the live version, or the built questions before any publish.
   current:live?{version:label(live.version),questions:live.spec.questions}:built,
   currentUnreadable:!live&&!built?'The page did not return the questions it was built with. Check that the page is deployed, then reload.':undefined,
   retired:retiredKeys(versions,live?.spec??built),
   versions:versions.map(v=>({version:v.version,label:label(v.version),summary:v.summary,source:v.source,by:v.actor_email,at:v.created_at,wentLive:v.first_live_at,live:v.version===form.live_version})),
  };
 }))};
}

async function pageInScope(args:Row,d:PageFormDeps){
 const slug=typeof args.slug==='string'&&SLUG.test(args.slug)?args.slug:fail('Choose a page');
 const scope=await d.scope(slug,null);
 const [form]=await d.store.forms([slug]);
 if(!form)fail('Unknown page');
 const base=Number.isInteger(args.base)&&args.base>=0?args.base as number:fail('Reload the editor: the version this draft started from is missing');
 if((form.live_version??0)!==base)fail('Someone published a newer version of these questions. Reload the editor to see it.');
 return {scope,form,base};
}

/** The public file: what the page reads. */
export function liveFile(slug:string,version:number,spec:PageFormSpec,at:Date){
 return {slug,version:label(version),publishedAt:at.toISOString(),questions:spec.questions};
}

/**
 * Write the public file and read it back. The stored file must hold exactly
 * this version; the public address must answer with a question file (its CDN
 * copy may still be the previous version for up to a minute, which is the
 * page's own delay too).
 */
async function writeLive(form:FormRow,version:number,spec:PageFormSpec,d:PageFormDeps){
 const file=liveFile(form.slug,version,spec,(d.now??(()=>new Date()))());
 const resource=form.object_path;
 await d.health({provider:'storage',method:'PUT',resource,phase:'intent'});
 try{await d.store.upload(resource,JSON.stringify(file));}
 catch(error){await d.health({provider:'storage',method:'PUT',resource,phase:'unknown'});throw new Error(`The page's question file was not saved: ${error instanceof Error?error.message:'unknown error'}. Reconcile before retrying.`);}
 await d.health({provider:'storage',method:'PUT',resource,phase:'response',http_status:200});
 let stored:Row|null=null;
 try{stored=JSON.parse(await d.store.download(resource));}catch{stored=null;}
 if(stored?.version!==file.version||canonical(stored?.questions)!==canonical(file.questions))
  throw new Error('The question file was saved, but reading it back did not show this version. Reconcile before retrying.');
 const url=d.store.publicUrl(resource);
 await d.health({provider:'storage',method:'GET',resource:url,phase:'intent'});
 let ok=false;
 try{
  const r=await d.fetch(url,{signal:AbortSignal.timeout(10000)});
  await d.health({provider:'storage',method:'GET',resource:url,phase:'response',http_status:r.status});
  ok=r.ok&&Array.isArray((await r.json())?.questions);
 }catch{await d.health({provider:'storage',method:'GET',resource:url,phase:'unknown'});}
 if(!ok)throw new Error('The question file was saved, but its public address does not serve it, so the page cannot read it. Reconcile before retrying.');
 return file;
}

/**
 * pageForms.publish: a new version from the editor. Without apply it only
 * checks the draft and says what would change.
 */
export async function publishPageForm(args:Row,apply:boolean,requestId:string|undefined,d:PageFormDeps){
 const {scope,form,base}=await pageInScope(args,d);
 const versions=await d.store.versions(form.slug);
 const live=versions.find(v=>v.version===form.live_version)??null;
 const baseline=live?null:await builtQuestions(form,d);
 if(!live&&!baseline)fail('The page did not return the questions it was built with, so the first publish cannot keep them as version 1. Check that the page is deployed.');
 const draft=args.spec as PageFormSpec;
 const wrong=problems(draft,{photos:form.photos,retired:retiredKeys(versions,live?.spec??baseline)});
 if(wrong.length)return {ok:false,dryRun:!apply,problems:wrong,error:wrong[0]};
 const spec=clean(draft,form.bindings);
 // Both sides cleaned the same way, so a field the build carries (ghl_field) is not read as an edit.
 const summary=describeChange(clean((live?.spec??baseline) as PageFormSpec,form.bindings),spec);
 if(summary==='No change to the questions')return {ok:false,dryRun:!apply,problems:[],error:'Nothing changed. Edit a question before you publish.'};
 if(!apply)return {ok:false,dryRun:true,problems:[],summary,message:'Checked. Nothing was published.'};
 const id=requestId&&REQUEST_ID.test(requestId)?requestId:fail('A request id is required');
 const prior=await d.store.begin({id,operation:'pageForms.publish',args,plan:{slug:form.slug,base,summary}});
 if(prior)return prior;
 return underReceipt(id,d,async()=>{
  const version=await d.store.record({slug:form.slug,spec,summary,base,baseline:live?null:baseline,actor:String(scope.actor),email:String(scope.email??''),action:id});
  await writeLive(form,version,spec,d);
  await d.store.goLive(form.slug,version,base);
  return {ok:true,receiptId:id,version,label:label(version),did:`${form.title}: ${summary} (${label(version)})`};
 });
}

/** pageForms.switch: make an earlier version live again. No new version is made. */
export async function switchPageForm(args:Row,apply:boolean,requestId:string|undefined,d:PageFormDeps){
 const {form,base}=await pageInScope(args,d);
 const target=Number.isInteger(args.version)?args.version as number:fail('Choose a version');
 if(target===form.live_version)return {ok:false,dryRun:!apply,error:`${label(target)} is already live.`};
 const versions=await d.store.versions(form.slug);
 const chosen=versions.find(v=>v.version===target)??fail('Unknown version');
 const wrong=problems(chosen.spec,{photos:form.photos});
 if(wrong.length)return {ok:false,dryRun:!apply,problems:wrong,error:`${label(target)} cannot go live again: ${wrong[0]}`};
 const summary=`Switched back to ${label(target)}`;
 if(!apply)return {ok:false,dryRun:true,summary,message:'Checked. Nothing was changed.'};
 const id=requestId&&REQUEST_ID.test(requestId)?requestId:fail('A request id is required');
 const prior=await d.store.begin({id,operation:'pageForms.switch',args,plan:{slug:form.slug,base,summary}});
 if(prior)return prior;
 return underReceipt(id,d,async()=>{
  await writeLive(form,target,chosen.spec,d);
  await d.store.goLive(form.slug,target,base);
  return {ok:true,receiptId:id,version:target,label:label(target),did:`${form.title}: ${summary}`};
 });
}

const FUNNEL_DAYS=[7,30,90];

/**
 * pageForms.funnel: where visitors stop, for one version of a page. The steps
 * follow that version's own questions, so a key that stays the same keeps its
 * count across edits. Muhammed, 2026-10-22: "detects if the leads are falling
 * during the completion of the form".
 */
export async function readFunnel(args:Row,d:PageFormDeps){
 const slug=typeof args.slug==='string'&&SLUG.test(args.slug)?args.slug:fail('Choose a page');
 await d.scope(slug,null);
 const [form]=await d.store.forms([slug]);
 if(!form)fail('Unknown page');
 const days=FUNNEL_DAYS.includes(args.days as number)?args.days as number:30;
 const versions=await d.store.versions(slug);
 const liveLabel=label(form.live_version??1);
 const wanted=typeof args.version==='string'&&/^v\d{1,4}$/.test(args.version)?args.version:liveLabel;
 const stored=versions.find(v=>label(v.version)===wanted);
 // v1 before the first publish is the built page; its questions come from the page itself.
 const spec=stored?.spec??(wanted==='v1'?await builtQuestions(form,d):null);
 if(!spec)fail(`${wanted} is not a version of this page`);
 const since=new Date((d.now??(()=>new Date()))().getTime()-days*86_400_000);
 const data=await d.store.funnel(slug,wanted,since);
 const visits=(screen:string)=>Number(data.screens?.[screen]??0);
 const steps=[
  {screen:'intro',label:'Opened the page',visits:visits('intro')},
  ...(spec as PageFormSpec).questions.map(q=>({screen:`q:${q.key}`,label:q.label,name:q.name||null,visits:visits(`q:${q.key}`)})),
  {screen:'contact',label:'Reached the contact step',visits:visits('contact')},
  {screen:'send',label:'Pressed send',visits:visits('send')},
  {screen:'thanks',label:'Saw the thank-you page',visits:visits('thanks')},
 ];
 return {slug,version:wanted,liveVersion:liveLabel,days,since:since.toISOString(),steps,versions:data.versions??[],lastAt:data.lastAt??null,hosts:data.hosts??[]};
}

/**
 * The store over Supabase: the two page-form tables through their functions,
 * the public bucket page-forms, and the media actions receipt every cockpit
 * write already leaves (cockpit_media_actions, then the audit log through
 * cockpit_finish_media_action). Health rows carry the receipt's id.
 */
export function supabasePageForms(admin:any,supabaseUrl:string,actor:string){
 let actionId:string|null=null;
 const BUCKET='page-forms';
 const MISSING='The page forms are not set up yet. Apply 20261022q_cockpit_page_forms.sql in the coordinated release.';
 const store:PageFormStore={
  async forms(slugs){
   if(!slugs.length)return [];
   const {data,error}=await admin.from('cockpit_page_forms').select('slug,client_name,title,site_url,object_path,photos,bindings,live_version').in('slug',slugs).order('slug');
   if(error)throw new Error(MISSING);
   return data as FormRow[];
  },
  async versions(slug){
   const {data,error}=await admin.from('cockpit_page_form_versions').select('version,spec,summary,source,actor_email,created_at,first_live_at').eq('slug',slug).order('version',{ascending:false}).limit(60);
   if(error)throw new Error(MISSING);
   return data as VersionRow[];
  },
  async record(a){
   const {data,error}=await admin.rpc('cockpit_page_form_record',{p_slug:a.slug,p_spec:a.spec,p_summary:a.summary,p_base:a.base,p_baseline:a.baseline,p_actor:a.actor,p_email:a.email,p_action:a.action});
   if(error||!Number.isInteger(data))throw new Error(error?.message??'The new version was not recorded');
   return data as number;
  },
  async goLive(slug,version,base){
   const {error}=await admin.rpc('cockpit_page_form_go_live',{p_slug:slug,p_version:version,p_base:base});
   if(error)throw new Error(error.message);
  },
  async upload(path,body){
   const {error}=await admin.storage.from(BUCKET).upload(path,new Blob([body],{type:'application/json'}),{upsert:true,contentType:'application/json',cacheControl:'60'});
   if(error)throw new Error(error.message);
  },
  async download(path){
   const {data,error}=await admin.storage.from(BUCKET).download(path);
   if(error||!data)throw new Error(error?.message??'not found');
   return await data.text();
  },
  publicUrl(path){return `${supabaseUrl.replace(/\/$/,'')}/storage/v1/object/public/${BUCKET}/${path}`;},
  async begin(row){
   const {error}=await admin.from('cockpit_media_actions').insert({id:row.id,actor_id:actor,operation:row.operation,campaign_name:null,request:{args:row.args,plan:row.plan}});
   if(error){
    const {data:prior}=await admin.from('cockpit_media_actions').select('*').eq('id',row.id).eq('actor_id',actor).maybeSingle();
    if(prior?.operation===row.operation&&canonical(prior.request?.args)===canonical(row.args)&&prior.state==='confirmed')return prior.result as Row;
    throw new Error('This request may already have been applied. Reconcile it before retrying.');
   }
   actionId=row.id;
   return null;
  },
  async finish(id,result){
   const {error}=await admin.rpc('cockpit_finish_media_action',{p_id:id,p_result:result,p_actual:{}});
   if(error)throw new Error('The page changed, but its receipt was not finalized. Reconcile before retrying.');
  },
  async reconcile(id,message){
   await admin.from('cockpit_media_actions').update({state:'reconcile',result:{ok:false,error:message},completed_at:new Date().toISOString()}).eq('id',id).eq('state','pending');
  },
  async funnel(slug,version,since){
   const {data,error}=await admin.rpc('cockpit_page_form_funnel',{p_slug:slug,p_version:version,p_since:since.toISOString()});
   if(error)throw new Error(/cockpit_page_form_funnel/.test(error.message)?'The drop-off counts are not set up yet. Apply 20261022r_cockpit_page_form_events.sql in the coordinated release.':error.message);
   return (data??{screens:{},versions:[],lastAt:null,hosts:[]}) as FunnelData;
  },
 };
 const health=async(row:Row)=>{
  const {error}=await admin.from('cockpit_media_provider_health').insert({...row,action_id:actionId});
  if(error)throw new Error('Could not save provider health receipt');
 };
 return {store,health};
}

export async function pageFormOperation(operation:string,args:Row,apply:boolean,requestId:string|undefined,d:PageFormDeps){
 if(operation==='pageForms.read')return readPageForms(args,d);
 if(operation==='pageForms.publish')return publishPageForm(args,apply,requestId,d);
 if(operation==='pageForms.switch')return switchPageForm(args,apply,requestId,d);
 if(operation==='pageForms.funnel')return readFunnel(args,d);
 throw new Error(`Unsupported page form operation: ${operation}`);
}
