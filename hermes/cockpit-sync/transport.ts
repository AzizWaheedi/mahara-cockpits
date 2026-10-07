import {readFile} from 'node:fs/promises';
import {createSign,createHash} from 'node:crypto';
import type {Reads,Row} from './runtime';
import {z} from 'zod';
import {fetchCalendarEvents} from '../media-native/tools';
export type Env=Record<string,string|undefined>;
const HOSTS:Record<string,true>={'graph.facebook.com':true,'api.clickup.com':true,'sheets.googleapis.com':true,'www.googleapis.com':true,'services.leadconnectorhq.com':true,'api.supabase.com':true,'oauth2.googleapis.com':true,'bldgtotkfmhoxmlzowdx.supabase.co':true,'api.typeform.com':true,'api.fathom.ai':true};
export function doctor(env:Env){
 const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','META_SYSTEM_TOKEN','CLICKUP_API_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','TYPEFORM_TOKEN','FATHOM_API_KEY','GHL_CLIENT_PIT'];
 const missing=required.filter(k=>!env[k]);
 if(env.SUPABASE_URL&&env.SUPABASE_URL.replace(/\/$/,'')!=='https://bldgtotkfmhoxmlzowdx.supabase.co')missing.push('SUPABASE_URL must identify Creative Triage');
 return {ok:!missing.length,missing,check:'named-environment-only',unverified:['credential validity','canonical source readiness and exact counts','publication RPCs and service grants','storage bucket and policies','provider response completeness'],next:'Run doctor --sources for read-only repository prerequisites; run a protected dry run before activation',dry_run_default:true};
}
export function transport(env:Env,request:typeof fetch=fetch,wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))){
 const receipts:Row[]=[],faults:Row[]=[],logs:Row[]=[];const cache=new Map<string,Response>();let requests=0;let googleToken:string|undefined;let googleEmail:string|undefined;
 const needed=(name:string)=>{if(!env[name])throw new Error(`Missing named key: ${name}`);return env[name]!;};
 let fathomQueue: Promise<void> = Promise.resolve();
 const HTTP_DATE_REGEX=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s\d{2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT$/;
 const parseRetryAfter=(header:string|null):number|undefined=>{
  if(!header)return undefined;
  const trimmed=header.trim();
  if(/^\d+$/.test(trimmed)){
   const sec=parseInt(trimmed,10);
   return Number.isFinite(sec)&&sec>=0?sec*1000:undefined;
  }
  if(HTTP_DATE_REGEX.test(trimmed)){
   const parsedDate=Date.parse(trimmed);
   if(!Number.isNaN(parsedDate)){
    const diff=parsedDate-Date.now();
    return Math.max(0,diff);
   }
  }
  return undefined;
 };
 const fetchRead:typeof fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),method=(init.method??'GET').toUpperCase();
  if(url.protocol!=='https:'||(!Object.hasOwn(HOSTS,url.hostname)&&!/(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com)$/.test(url.hostname))||url.username||url.password||url.port)throw new Error('Unapproved provider URL');
  const sqlRead=url.hostname==='api.supabase.com'&&method==='POST'&&JSON.parse(String(init.body??'{}')).read_only===true;
  const oauth=url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'&&method==='POST';
  if(method!=='GET'&&!sqlRead&&!oauth)throw new Error('Feed collection cannot perform provider writes');
  const headers=new Headers(init.headers);if(url.hostname==='services.leadconnectorhq.com')headers.set('User-Agent','Mozilla/5.0 Mahara-Cockpit-Sync');
  const key=createHash('sha256').update(url.href+method+String(init.body??'')+JSON.stringify([...headers])).digest('hex');
  const held=cache.get(key);if(held)return held.clone();
  if(++requests>2000)throw new Error('Read budget exhausted; refusing partial publication');
  const resource=`${url.hostname}${url.pathname}`;
  const isFathom=url.hostname==='api.fathom.ai';
  for(let attempt=1;attempt<=3;attempt++){
   receipts.push({resource,method,phase:'intent',attempt,at:new Date().toISOString()});
   let releaseFathom: (()=>void)|undefined;
   try{
    if(isFathom){
     const current=fathomQueue;
     fathomQueue=new Promise<void>(resolve=>{releaseFathom=resolve;});
     await current;
     const cachedAfterLock=cache.get(key);
     if(cachedAfterLock){
      return cachedAfterLock.clone();
     }
     await wait(1500);
    }
    const response=await request(url.href,{...init,headers,redirect:'error',signal:AbortSignal.timeout(30000)});
    receipts.push({resource,method,phase:'response',http_status:response.status,attempt,at:new Date().toISOString()});
    if(response.status===429||response.status===503||response.status>=500){
     const retryMs=parseRetryAfter(response.headers.get('retry-after'));
     if(retryMs!==undefined&&retryMs>60000){
      try{await response.body?.cancel();}catch{}
      faults.push({resource,status:response.status});
      return response;
     }
     if(attempt<3){
      try{await response.body?.cancel();}catch{}
      await wait(retryMs!==undefined?retryMs:attempt*1000);
      continue;
     }
    }
    if(!response.ok){faults.push({resource,status:response.status});return response;}
    if(!response.headers.get('content-type')?.startsWith('image/'))cache.set(key,response.clone());return response;
   }catch(error){
    receipts.push({resource,method,phase:'unknown',attempt});
    if(attempt<3){
     await wait(attempt*1000);
     continue;
    }
    faults.push({resource,error:'Transport unavailable'});
    throw new Error(`Read unavailable: ${resource}`);
   }finally{
    releaseFathom?.();
   }
  }
  throw new Error('Read attempts exhausted');
 };
 const json=async(url:string,init?:RequestInit)=>{const response=await fetchRead(url,init);if(!response.ok)throw new Error(`Read rejected (${response.status}) at ${new URL(url).hostname}`);return response.json();};
 const google=async(expectedEmail?:string)=>{
  if(googleToken){if(expectedEmail&&googleEmail?.toLowerCase()!==expectedEmail.toLowerCase())throw new Error('Google service-account identity differs from verified calendar configuration');return googleToken;}
  const account=z.object({type:z.literal('service_account'),client_email:z.string().email(),private_key:z.string().min(1)}).parse(JSON.parse(await readFile(needed('GOOGLE_APPLICATION_CREDENTIALS'),'utf8')));
  if(expectedEmail&&account.client_email.toLowerCase()!==expectedEmail.toLowerCase())throw new Error('Google service-account identity differs from verified calendar configuration');
  googleEmail=account.client_email;
  const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const now=Math.floor(Date.now()/1000),unsigned=`${enc({alg:'RS256',typ:'JWT'})}.${enc({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
  const sign=createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
  const token=z.object({access_token:z.string().min(1),token_type:z.literal('Bearer')}).parse(await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${sign}`}).toString()}));
  return googleToken=token.access_token;
 };
 const graph=async(path:string,params:Row={})=>{
  if(path.includes('://')||path.startsWith('/')||path.includes('..'))throw new Error('Invalid Meta resource');
  const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION??'v21.0'}/${path}`);for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
  let page=await json(url.href,{headers:{Authorization:`Bearer ${needed('META_SYSTEM_TOKEN')}`}});if(page.error){faults.push({resource:'graph.facebook.com',error:'Meta response error'});throw new Error('Meta refused a source read');}
  if(/\/(owned_ad_accounts|client_ad_accounts|campaigns|adsets|ads|insights)$/.test(path)&&!Array.isArray(page.data))throw new Error('Meta collection is unavailable');
  if(String(params.fields??'').includes('adsets.')&&!Array.isArray(page.adsets?.data))throw new Error('Meta ad set expansion is unavailable');
  if(params.ids)for(const id of String(params.ids).split(','))if(!page[id]||page[id].error)throw new Error('Meta batch is incomplete');
  // All outer pages; truncation is a publication failure rather than a plausible zero.
  const edge=Array.isArray(page.data)?page:page.adsets;
  if(edge){
   if(!Array.isArray(edge.data))throw new Error('Meta collection missing');
   const data=[...edge.data];let next=edge.paging?.next;
   for(let n=0;next;n++){
    if(n>=100)throw new Error('Meta pagination incomplete');
    const nextUrl=new URL(next);if(nextUrl.hostname!=='graph.facebook.com')throw new Error('Unexpected Meta pagination host');nextUrl.searchParams.delete('access_token');
    const following=await json(nextUrl.href,{headers:{Authorization:`Bearer ${needed('META_SYSTEM_TOKEN')}`}});
    if(following.error||!Array.isArray(following.data))throw new Error('Meta page failed');
    data.push(...following.data);next=following.paging?.next;
   }
   if(edge===page)return {...page,data,paging:{}};
   page={...page,adsets:{...edge,data,paging:{}}};
  }
  return page;
 };
 const tool=async(name:string,args:Row)=>{
  if(name==='native_google_calendar_events'){
   const input=z.object({calendarId:z.string().min(1),serviceAccountEmail:z.string().email(),timeMin:z.number().finite(),timeMax:z.number().finite(),clientNames:z.array(z.string())}).strict().parse(args);
   const token=await google(input.serviceAccountEmail);
   const events=await fetchCalendarEvents(input.calendarId,token,{timeMin:input.timeMin,timeMax:input.timeMax,clientNames:input.clientNames,fetchImpl:fetchRead});
   return {events,checkedAt:Date.now()};
  }
  if(name==='mcp_supabase_execute_sql'){
   if(args.project_id!=='bldgtotkfmhoxmlzowdx'||!/^\s*(select|with)\b/i.test(args.query))throw new Error('Only the fixed Creative Triage read-only source is permitted');
   const data=await json('https://api.supabase.com/v1/projects/bldgtotkfmhoxmlzowdx/database/query',{method:'POST',headers:{Authorization:`Bearer ${needed('SUPABASE_ACCESS_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({query:args.query,read_only:true})});
   const limit=/\blimit\s+(\d+)/i.exec(args.query)?.[1];
   if(!Array.isArray(data)||(limit&&data.length>=Number(limit)))throw new Error('SQL source missing or reached its coverage limit');
   return {result:JSON.stringify(data)};
  }
  if(name==='native_fathom_checkpoint_get'){
   if(Object.keys(args).length||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://bldgtotkfmhoxmlzowdx.supabase.co')throw new Error('Native checkpoint requires Creative Triage and no query overrides');
   const url=new URL('https://bldgtotkfmhoxmlzowdx.supabase.co/rest/v1/cockpit_native_media_runs');
   url.search=new URLSearchParams({status:'eq.published','plan->>producer':'eq.media-core',select:'started_at:plan->>begun_at',order:'published_at.desc',limit:'1'}).toString();
   return json(url.href,{headers:{apikey:needed('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${needed('SUPABASE_SERVICE_ROLE_KEY')}`}});
  }
  const url=new URL(args.url);
  if(name==='pd_google_sheets_proxy_get'){
   if(url.hostname!=='sheets.googleapis.com')throw new Error('Unexpected Sheets host');
   const result=await json(url.href,{headers:{Authorization:`Bearer ${await google()}`}});
   if(/^\/v4\/spreadsheets\/[^/]+$/.test(url.pathname)){if(!Array.isArray(result.sheets))throw new Error('Sheets metadata missing');return result;}
   const range=(r:Row)=>{
    if(typeof r.range!=='string'||(r.values!==undefined&&!Array.isArray(r.values)))throw new Error('Unverified Sheets range');
    const values:unknown[][]=r.values??[];
    if(values.some(row=>!Array.isArray(row)||row.some(cell=>cell!==null&&!['string','number','boolean'].includes(typeof cell))))throw new Error('Malformed Sheets cells');
    return {...r,values};
   };
   if(url.pathname.endsWith('/values:batchGet')){if(!Array.isArray(result.valueRanges))throw new Error('Unverified Sheets batch');return {...result,valueRanges:result.valueRanges.map(range)};}
   return range(result);
  }
  if(name==='native_google_drive_get'){if(url.hostname!=='www.googleapis.com'||!url.pathname.startsWith('/drive/v3/'))throw new Error('Unexpected Drive resource');return json(url.href,{headers:{Authorization:`Bearer ${await google()}`}});}
  if(name==='native_fathom_get'){if(url.hostname!=='api.fathom.ai'||url.pathname!=='/external/v1/meetings')throw new Error('Unexpected Fathom resource');return json(url.href,{headers:{'X-Api-Key':needed('FATHOM_API_KEY')}});}
  if(name==='native_csm_ghl_get'){
   if(url.hostname!=='services.leadconnectorhq.com')throw new Error('Unexpected staff calendar host');
   const calendar=/^\/calendars\/(?:events)?$/.test(url.pathname);
   if((calendar&&url.searchParams.get('locationId')!=='wwG426bwruWWv9W3fazQ')||(!calendar&&!/^\/contacts\/[A-Za-z0-9_-]+$/.test(url.pathname)))throw new Error('Unexpected staff calendar resource');
   if(!['2021-04-15','2021-07-28'].includes(args.version))throw new Error('Unsupported staff calendar API version');
   return json(url.href,{headers:{Authorization:`Bearer ${needed('GHL_CLIENT_PIT')}`,Version:args.version,Accept:'application/json'}});
  }
  if(name==='pd_typeform_proxy_get'){
   if(url.hostname!=='api.typeform.com'||!/^\/forms\/(fRokTITH|gqBcyK6g)\/responses$/.test(url.pathname))throw new Error('Unexpected Typeform resource');
   const items:Row[]=[];let previous:string|undefined;
   for(let page=0;page<100;page++){
    const result=await json(url.href,{headers:{Authorization:`Bearer ${needed('TYPEFORM_TOKEN')}`}});
    if(!Array.isArray(result.items)||!Number.isFinite(Number(result.total_items)))throw new Error('Incomplete Typeform collection');
    items.push(...result.items);
    if(result.items.length<Number(url.searchParams.get('page_size')??25))return {...result,items};
    const before=result.items.at(-1)?.token;
    if(!before||before===previous)throw new Error('Typeform pagination did not advance');
    previous=before;url.searchParams.set('before',before);
   }
   throw new Error('Typeform pagination incomplete');
  }
  if(name==='pd_clickup_proxy_get'){
   if(url.hostname!=='api.clickup.com')throw new Error('Unexpected ClickUp host');
   const headers={Authorization:needed('CLICKUP_API_TOKEN')};let page=await json(url.href,{headers});
   if(/\/list\/[^/]+\/task$/.test(url.pathname)){
    if(!Array.isArray(page.tasks))throw new Error('ClickUp task collection missing');
    const tasks=[...page.tasks];let n=Number(url.searchParams.get('page')??0);
    while(page.last_page===false||(page.last_page!==true&&page.tasks.length>=100)){
     if(n>=100)throw new Error('ClickUp pagination incomplete');url.searchParams.set('page',String(++n));page=await json(url.href,{headers});
     if(!Array.isArray(page.tasks))throw new Error('ClickUp page missing');tasks.push(...page.tasks);
    }
    if(tasks.some(task=>!task||typeof task.id!=='string'||!task.id))throw new Error('ClickUp task identity missing');
    return {...page,tasks};
   }
   return page;
  }
  throw new Error(`Unapproved native source tool: ${name}`);
 };
 const reads:Reads={
  graph:async(path,params)=>{try{return await graph(path,params);}catch(error){faults.push({resource:'meta',error:'Provider collection failed'});throw error;}},
  tool:async(name,args)=>{try{return await tool(name,args);}catch(error){faults.push({resource:name,error:'Provider collection failed'});throw error;}},
  fetch:fetchRead,
  log:(level)=>{logs.push({level,message:'Native calculator diagnostic; detailed provider bodies omitted'});if(level==='error')faults.push({resource:'calculator',error:'Calculator reported incomplete source'});},
 };
 return {reads,receipts,faults,logs};
}
