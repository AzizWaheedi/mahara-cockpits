import {readFile} from 'node:fs/promises';
import {createSign,createHash} from 'node:crypto';
import type {Reads,Row} from './runtime';
export type Env=Record<string,string|undefined>;
const HOSTS=new Set(['graph.facebook.com','api.clickup.com','sheets.googleapis.com','services.leadconnectorhq.com','api.supabase.com','oauth2.googleapis.com','bldgtotkfmhoxmlzowdx.supabase.co']);
export function doctor(env:Env){const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','META_SYSTEM_TOKEN','CLICKUP_API_TOKEN','GOOGLE_APPLICATION_CREDENTIALS'];const missing=required.filter(k=>!env[k]);if(env.SUPABASE_URL&&env.SUPABASE_URL.replace(/\/$/,'')!=='https://bldgtotkfmhoxmlzowdx.supabase.co')missing.push('SUPABASE_URL must identify Creative Triage');return {ok:!missing.length,missing,implemented:['media-core'],remaining:['csm-creative-fanout','winner-archive','still-capture','ceo-section-refresh'],dry_run_default:true};}
export function transport(env:Env,request:typeof fetch=fetch,wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))){
 const receipts:Row[]=[],faults:Row[]=[],logs:Row[]=[];const cache=new Map<string,Response>();let requests=0;let googleToken:string|undefined;
 const needed=(name:string)=>{if(!env[name])throw new Error(`Missing named key: ${name}`);return env[name]!;};
 const fetchRead=async(urlText:string,init:RequestInit={}):Promise<Response>=>{
  const url=new URL(urlText),method=(init.method??'GET').toUpperCase();
  if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.username||url.password)throw new Error('Unapproved provider URL');
  const sqlRead=url.hostname==='api.supabase.com'&&method==='POST'&&JSON.parse(String(init.body??'{}')).read_only===true;
  const oauth=url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'&&method==='POST';
  if(method!=='GET'&&!sqlRead&&!oauth)throw new Error('Feed collection cannot perform provider writes');
  const headers=new Headers(init.headers);if(url.hostname==='services.leadconnectorhq.com')headers.set('User-Agent','Mozilla/5.0 Mahara-Cockpit-Sync');
  const key=createHash('sha256').update(urlText+method+String(init.body??'')+JSON.stringify([...headers])).digest('hex');
  const held=cache.get(key);if(held)return held.clone();
  if(++requests>2000)throw new Error('Read budget exhausted; refusing partial publication');
  const resource=`${url.hostname}${url.pathname}`;
  for(let attempt=1;attempt<=3;attempt++){
   receipts.push({resource,method,phase:'intent',attempt,at:new Date().toISOString()});
   try{
    const response=await request(url.href,{...init,headers,redirect:'error',signal:AbortSignal.timeout(30000)});
    receipts.push({resource,method,phase:'response',http_status:response.status,attempt,at:new Date().toISOString()});
    if((response.status===429||response.status>=500)&&attempt<3){await wait(attempt*1000);continue;}
    if(!response.ok){faults.push({resource,status:response.status});return response;}
    cache.set(key,response.clone());return response;
   }catch(error){receipts.push({resource,method,phase:'unknown',attempt});if(attempt<3){await wait(attempt*1000);continue;}faults.push({resource,error:'Transport unavailable'});throw new Error(`Read unavailable: ${resource}`);}
  }
  throw new Error('Read attempts exhausted');
 };
 const json=async(url:string,init?:RequestInit)=>{const response=await fetchRead(url,init);if(!response.ok)throw new Error(`Read rejected (${response.status}) at ${new URL(url).hostname}`);return response.json();};
 const google=async()=>{if(googleToken)return googleToken;const account=JSON.parse(await readFile(needed('GOOGLE_APPLICATION_CREDENTIALS'),'utf8'));if(account.type!=='service_account'||!account.client_email||!account.private_key)throw new Error('Google service account file required');const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const now=Math.floor(Date.now()/1000),unsigned=`${enc({alg:'RS256',typ:'JWT'})}.${enc({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;const sign=createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');const token=await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${sign}`}).toString()});if(!token.access_token)throw new Error('Google returned no service-account token');return googleToken=token.access_token as string;};
 const graph=async(path:string,params:Row={})=>{
  if(path.includes('://')||path.startsWith('/')||path.includes('..'))throw new Error('Invalid Meta resource');
  const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION??'v21.0'}/${path}`);for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
  let page=await json(url.href,{headers:{Authorization:`Bearer ${needed('META_SYSTEM_TOKEN')}`}});if(page.error){faults.push({resource:'graph.facebook.com',error:'Meta response error'});throw new Error('Meta refused a source read');}
  // All outer pages; truncation is a publication failure rather than a plausible zero.
  if(Array.isArray(page.data)){const data=[...page.data];let next=page.paging?.next;for(let n=0;next;n++){if(n>=100)throw new Error('Meta pagination exceeded100 pages');const urlNext=new URL(next);if(urlNext.hostname!=='graph.facebook.com')throw new Error('Unexpected Meta pagination host');urlNext.searchParams.delete('access_token');page=await json(urlNext.href,{headers:{Authorization:`Bearer ${needed('META_SYSTEM_TOKEN')}`}});if(page.error)throw new Error('Meta page failed');data.push(...(page.data??[]));next=page.paging?.next;}return {...page,data,paging:{}};}
  return page;
 };
 const tool=async(name:string,args:Row)=>{
  if(name==='mcp_supabase_execute_sql'){if(args.project_id!=='bldgtotkfmhoxmlzowdx'||!/^\s*(select|with)\b/i.test(args.query))throw new Error('Only the fixed Creative Triage read-only source is permitted');const data=await json('https://api.supabase.com/v1/projects/bldgtotkfmhoxmlzowdx/database/query',{method:'POST',headers:{Authorization:`Bearer ${needed('SUPABASE_ACCESS_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({query:args.query,read_only:true})});return {result:JSON.stringify(data)};}
  const url=new URL(args.url);if(name==='pd_google_sheets_proxy_get'){if(url.hostname!=='sheets.googleapis.com')throw new Error('Unexpected Sheets host');return json(url.href,{headers:{Authorization:`Bearer ${await google()}`}});}
  if(name==='pd_clickup_proxy_get'){if(url.hostname!=='api.clickup.com')throw new Error('Unexpected ClickUp host');const headers={Authorization:needed('CLICKUP_API_TOKEN')};let page=await json(url.href,{headers});if(/\/list\/[^/]+\/task$/.test(url.pathname)){const tasks=[...(page.tasks??[])];let n=Number(url.searchParams.get('page')??0);while(!page.last_page&&(page.tasks??[]).length>=100){if(n>=100)throw new Error('ClickUp pagination exceeded100 pages');url.searchParams.set('page',String(++n));page=await json(url.href,{headers});tasks.push(...(page.tasks??[]));}return {...page,tasks};}return page;}
  throw new Error(`Unapproved native source tool: ${name}`);
 };
 const reads:Reads={graph,tool,fetch:fetchRead,log:(level,args)=>{const message=args.map(String).join(' ');logs.push({level,message});if(level==='error'&&!message.includes('DEFERRED_COMPONENT:'))faults.push({resource:'calculator',error:message.slice(0,250)});}};
 return {reads,receipts,faults,logs};
}
