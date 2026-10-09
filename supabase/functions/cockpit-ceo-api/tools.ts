// This credential is read-only. The host and resources are fixed; no mutation API exists.
export async function payerSources(env:(name:string)=>string|undefined,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch){
 const token=env('B2B_READ_ONLY_KEY');
 if(!token){
  await health({provider:'b2b',method:'GET',resource:'read-only-source',phase:'failed'});
  throw Error('B2B_READ_ONLY_KEY is not configured');
 }
 async function rows(resource:string,query:string):Promise<JsonObject[]>{
  const out:JsonObject[]=[];let total:number|null=null;
  for(let offset=0;offset<100000;offset+=1000){
   const receipt={provider:'b2b',method:'GET',resource};await health({...receipt,phase:'intent'});
   let response:Response;
   try{
    response=await request(`https://flwboeijllbtrufxkhts.supabase.co/rest/v1/${resource}?${query}&offset=${offset}&limit=1000`,{
     method:'GET',
     headers:{apikey:token,Authorization:`Bearer ${token}`,Prefer:'count=exact'},
     redirect:'error',
     signal:AbortSignal.timeout(25000),
    });
   }catch{
    await health({...receipt,phase:'unknown'});
    throw Error('B2B payer source could not be reached; no source values were assumed');
   }
   await health({...receipt,phase:'response',http_status:response.status});
   if(!response.ok)throw Error(`B2B payer source returned ${response.status}`);
   const countText=response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
   const count=countText===undefined?NaN:Number(countText);
   if(!Number.isSafeInteger(count)||count<0)throw Error('B2B payer source did not confirm its row count');
   if(total!==null&&count!==total)throw Error('B2B payer source changed during the read; refresh again');
   total=count;
   let data:unknown;
   try{data=await response.json();}catch{throw Error('B2B payer source returned an unreadable response');}
   if(!Array.isArray(data))throw Error('Invalid B2B payer source response');
   const batch:unknown[]=data;
   for(const value of batch){
    if(!isJsonObject(value))throw Error('Invalid B2B payer source row');
    out.push(value);
   }
   if(out.length===total){
    const ids=out.map(row=>String(resource==='whop_payments'?row.payment_id??'':row.record_id??''));
    if(new Set(ids).size!==ids.length||ids.some(id=>!id))throw Error('B2B payer rows changed during pagination');
    return out;
   }
   if(batch.length!==1000||out.length>total)throw Error('B2B payer source was incomplete');
  }
  throw Error('B2B payer source exceeds the safe read limit');
 }
 const payments=await rows('whop_payments','select=payment_id,billing_name,user_email,net_amount,paid_on,deal_response_id&status=eq.paid&order=payment_id');
 const voids=await rows('record_voids','select=record_id&entity=eq.closed_deal&order=record_id');
 return {payments,voids};
}
type ProviderHealth = (row: Record<string, unknown>) => Promise<void>;
type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
 return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function metaGraph(
 env:(name:string)=>string|undefined,
 health:ProviderHealth,
 request:typeof fetch,
 path:string,
 params:Record<string,string|number>,
):Promise<JsonObject> {
 const resource=path.split('?')[0];
 const receipt={provider:'meta',method:'GET',resource};
 const token=env('META_SYSTEM_TOKEN');
 if(!token){await health({...receipt,phase:'failed'});throw Error('META_SYSTEM_TOKEN is not configured. Configure Mahara’s Meta system-user access before reading ad metrics.');}
 const version=env('META_GRAPH_VERSION')??'v21.0';
 if(!/^v\d+(?:\.\d+)?$/.test(version)||!path||path.includes('..')||path.startsWith('/')||path.includes('://')||path.includes('?')){
  await health({...receipt,phase:'failed'});
  throw Error('Invalid Meta Graph resource.');
 }
 const query=new URLSearchParams();
 for(const [key,value] of Object.entries(params))query.set(key,String(value));
 query.set('access_token',token);
 await health({...receipt,phase:'intent'});
 let response:Response;
 try{
  response=await request(`https://graph.facebook.com/${version}/${path}?${query}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)});
 }catch{
  await health({...receipt,phase:'unknown'});
  throw Error('Meta could not confirm the read. Check the provider receipt before retrying.');
 }
 await health({...receipt,phase:'response',http_status:response.status});
 let parsed:unknown;
 try{parsed=JSON.parse(await response.text());}catch{throw Error(`Meta returned an unreadable response (${response.status}).`);}
 if(!isJsonObject(parsed))throw Error(`Meta returned an invalid response (${response.status}).`);
 if(!response.ok||isJsonObject(parsed.error)){
  const providerError=isJsonObject(parsed.error)?parsed.error:{};
  const code=providerError.code===undefined?'':` code ${String(providerError.code).replaceAll(token,'[redacted]').slice(0,40)}`;
  const message=typeof providerError.message==='string'?providerError.message.replaceAll(token,'[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,180):'';
  throw Error(`Meta rejected the request (${response.status}${code})${message?`: ${message}`:''}. Check the META_SYSTEM_TOKEN scopes and account access.`);
 }
 return parsed;
}

function base64Url(value:Uint8Array):string {
 let binary='';
 for(const byte of value)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

export async function googleDirectoryToken(
 env:(name:string)=>string|undefined,
 health:ProviderHealth,
 request:typeof fetch,
):Promise<string> {
 const receipt={provider:'google-directory-auth',method:'POST',resource:'oauth2.googleapis.com/token'};
 const raw=env('GOOGLE_SERVICE_ACCOUNT_JSON');
 if(!raw){await health({...receipt,phase:'failed'});throw Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured. Configure the service account and authorize admin.directory.user.readonly domain-wide delegation for the configured subject.');}
 let service:unknown;
 try{service=JSON.parse(raw);}catch{await health({...receipt,phase:'failed'});throw Error('GOOGLE_SERVICE_ACCOUNT_JSON is invalid. Repair the service-account configuration.');}
 if(!isJsonObject(service)||typeof service.client_email!=='string'||typeof service.private_key!=='string'){
  await health({...receipt,phase:'failed'});
  throw Error('The Google service account is incomplete. Configure its client email and private key.');
 }
 const subject=env('GOOGLE_SERVICE_ACCOUNT_SUBJECT')??'aziz@maharamedia.com';
 if(!/^[^\s@]+@[^\s@]+$/.test(subject)){await health({...receipt,phase:'failed'});throw Error('GOOGLE_SERVICE_ACCOUNT_SUBJECT must be the delegated Workspace administrator email.');}
 const now=Math.floor(Date.now()/1000);
 const header=base64Url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
 const claims=base64Url(new TextEncoder().encode(JSON.stringify({
  iss:service.client_email,
  sub:subject,
  scope:'https://www.googleapis.com/auth/admin.directory.user.readonly',
  aud:'https://oauth2.googleapis.com/token',
  iat:now,
  exp:now+3600,
 })));
 const signing=`${header}.${claims}`;
 let key:CryptoKey;
 try{
  const der=Uint8Array.from(atob(service.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),character=>character.charCodeAt(0));
  key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 }catch{await health({...receipt,phase:'failed'});throw Error('The Google service-account private key is invalid. Repair GOOGLE_SERVICE_ACCOUNT_JSON.');}
 let signature:ArrayBuffer;
 try{signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signing));}
 catch{await health({...receipt,phase:'failed'});throw Error('Google could not sign the delegated directory request. Repair the service-account key.');}
 await health({...receipt,phase:'intent'});
 let response:Response;
 try{
  response=await request('https://oauth2.googleapis.com/token',{redirect:'error',
   method:'POST',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({
    grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:`${signing}.${base64Url(new Uint8Array(signature))}`,
   }),
   signal:AbortSignal.timeout(25000),
  });
 }catch{
  await health({...receipt,phase:'unknown'});
  throw Error('Google did not confirm delegated authentication. Check the provider receipt before retrying.');
 }
 await health({...receipt,phase:'response',http_status:response.status});
 let payload:unknown;
 try{payload=await response.json();}catch{throw Error(`Google authentication returned an unreadable response (${response.status}).`);}
 if(!response.ok||!isJsonObject(payload)||typeof payload.access_token!=='string'){
  throw Error(`Google refused delegated Workspace access (${response.status}). Confirm domain-wide delegation for admin.directory.user.readonly and the configured subject.`);
 }
 return payload.access_token;
}

// ---------------------------------------------------------------------------
// Hours: Hubstaff and Timetastic (design.md 2.4 to 2.6). The key is an
// argument, read from cockpit_hours_keys by the caller, never from the
// environment. Every call leaves an intent receipt and then a response (with
// the HTTP status) or unknown receipt, with a host-qualified path template:
// no ids, no query values. Errors carry only the HTTP status and the
// provider's error code, never a response body, and never the key. Hubstaff
// is GET only, except the one token exchange; anything else throws before a
// byte is sent. Pay fields are dropped from every Hubstaff response before
// anything else touches it.

export type HoursReceipt = {
 provider:'hubstaff'|'hubstaff-auth'|'timetastic';
 method:'GET'|'POST';
 resource:string;
 phase:'intent'|'response'|'unknown';
 http_status?:number;
 error?:string;
};
export type HoursHealth=(row:HoursReceipt)=>Promise<void>;
export type HoursErrorKind='missing_key'|'refused'|'plan_blocked'|'firewall_blocked'|'rate_limited'|'unreadable'|'unreachable'|'http'|'invalid';

export class HoursProviderError extends Error {
 kind:HoursErrorKind; status:number|null; code:string|null;
 constructor(kind:HoursErrorKind,message:string,status:number|null=null,code:string|null=null){
  super(message);this.name='HoursProviderError';this.kind=kind;this.status=status;this.code=code;
 }
}

const HUBSTAFF_PAY_FIELDS=new Set(['pay_rate','bill_rate','fixed_pay_rate','pay_rates','bill_rates','hourly_rate','salary','profile','ip_address','project_members']);
/** Pay, profile and address fields never leave the helper: dropped at every depth. */
export function dropHubstaffPay(value:unknown):unknown{
 if(Array.isArray(value))return value.map(dropHubstaffPay);
 if(!isJsonObject(value))return value;
 const out:JsonObject={};
 for(const [k,v] of Object.entries(value))if(!HUBSTAFF_PAY_FIELDS.has(k))out[k]=dropHubstaffPay(v);
 return out;
}

/** A provider error code, safe to show: letters, digits, dot, dash, underscore; never longer than 40. */
function safeCode(value:unknown,secret:string):string|null{
 if(value===undefined||value===null)return null;
 const text=String(value).replaceAll(secret,'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40);
 return text||null;
}

const sleepFor=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

/**
 * Hubstaff sits behind Cloudflare, which refuses a request without a
 * User-Agent (403, error 1010) before the API sees it (CEO decision,
 * 2026-10-09). Every Hubstaff call sends this one.
 */
export const HUBSTAFF_USER_AGENT='mahara-cockpit/1.0';

/**
 * A 403 from Cloudflare rather than from Hubstaff: a body that is not JSON
 * and carries a Cloudflare error code (1010: no or refused User-Agent), or a
 * Cloudflare server header. Not the key's fault, so never "refused".
 */
function firewallCode(status:number,raw:string,headers:Headers,readable:boolean):string|null{
 if(status!==403||readable)return null;
 const hit=raw.match(/error(?:\s+code)?:?\s*(1\d{3})\b/i)??raw.match(/\b(1010)\b/);
 if(hit)return hit[1];
 return /cloudflare/i.test(headers.get('server')??'')||headers.has('cf-ray')?'cloudflare':null;
}
function firewallError(code:string):HoursProviderError{
 return new HoursProviderError('firewall_blocked',`Hubstaff's firewall blocked the request (403${code==='cloudflare'?'':`, error ${code}`}). The key was not checked.`,403,code==='cloudflare'?null:code);
}
export type HoursCallOptions={sleep?:(ms:number)=>Promise<void>};

const HUBSTAFF_PATHS:{test:RegExp;template:string}[]=[
 {test:/^organizations$/,template:'organizations'},
 {test:/^users\/me$/,template:'users/me'},
 {test:/^organizations\/\d{1,12}\/members$/,template:'organizations/{org}/members'},
 {test:/^organizations\/\d{1,12}\/activities$/,template:'organizations/{org}/activities'},
 {test:/^organizations\/\d{1,12}\/activities\/daily$/,template:'organizations/{org}/activities/daily'},
 {test:/^organizations\/\d{1,12}\/last_activities$/,template:'organizations/{org}/last_activities'},
];

/**
 * The one door to the Hubstaff API. Only GET is ever sent: an owner token
 * could invite members, delete time or change rates, so anything but GET
 * throws here, before the request exists.
 */
export async function hubstaffCall(
 method:string,
 token:string,
 health:HoursHealth,
 request:typeof fetch,
 path:string,
 params:Record<string,string|number>,
 options:HoursCallOptions={},
):Promise<JsonObject>{
 if(method!=='GET')throw new HoursProviderError('invalid','The cockpit only reads from Hubstaff. Nothing was sent.');
 const hit=HUBSTAFF_PATHS.find(p=>p.test.test(path));
 if(!hit)throw new HoursProviderError('invalid','That Hubstaff resource is not one the cockpit reads. Nothing was sent.');
 if(!token)throw new HoursProviderError('missing_key','Hubstaff isn\'t connected. Paste its key in Connections.');
 const receipt={provider:'hubstaff' as const,method:'GET' as const,resource:`api.hubstaff.com/v2/${hit.template}`};
 const query=new URLSearchParams();
 for(const [k,v] of Object.entries(params))query.set(k,String(v));
 const url=`https://api.hubstaff.com/v2/${path}${query.size?`?${query}`:''}`;
 const sleep=options.sleep??sleepFor;
 for(let attempt=0;;attempt++){
  await health({...receipt,phase:'intent'});
  let response:Response;
  try{
   response=await request(url,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','User-Agent':HUBSTAFF_USER_AGENT},signal:AbortSignal.timeout(25000)});
  }catch{
   await health({...receipt,phase:'unknown'});
   throw new HoursProviderError('unreachable','Hubstaff could not be reached. The next read tries again.');
  }
  await health({...receipt,phase:'response',http_status:response.status});
  if(response.status===429&&attempt===0){
   // No Retry-After: wait 2 seconds rather than asking again at once.
   const header=response.headers.get('retry-after');
   const wait=header===null||header.trim()===''?2:Number(header);
   if(Number.isFinite(wait)&&wait>=0&&wait<=30){await sleep(wait*1000);continue;}
  }
  let parsed:unknown=null;
  let readable=true;
  const raw=await response.text().catch(()=>'');
  try{parsed=JSON.parse(raw);}catch{readable=false;}
  if(!response.ok){
   const blocked=firewallCode(response.status,raw,response.headers,readable);
   if(blocked)throw firewallError(blocked);
   const body=isJsonObject(parsed)?parsed:{};
   const code=safeCode(body.code??body.error_code??(isJsonObject(body.error)?body.error.code:undefined),token);
   const words=[body.error,body.message,isJsonObject(body.error)?body.error.message:undefined].filter(x=>typeof x==='string').join(' ');
   if(response.status===401)throw new HoursProviderError('refused',`Hubstaff refused the key (401${code?` ${code}`:''}).`,401,code);
   if(response.status===403&&(code==='10006'||/active plan/i.test(words)))
    throw new HoursProviderError('plan_blocked',`Hubstaff says this plan doesn't include API access (403${code?` ${code}`:''}).`,403,code);
   if(response.status===403)throw new HoursProviderError('refused',`Hubstaff refused the key (403${code?` ${code}`:''}).`,403,code);
   if(response.status===429)throw new HoursProviderError('rate_limited','Hubstaff asked the cockpit to slow down (429). The next read tries again.',429,code);
   throw new HoursProviderError('http',`Hubstaff answered ${response.status}${code?` ${code}`:''}.`,response.status,code);
  }
  if(!readable||!isJsonObject(parsed))throw new HoursProviderError('unreadable',`Hubstaff returned an unreadable response (${response.status}).`,response.status);
  return dropHubstaffPay(parsed) as JsonObject;
 }
}

export function hubstaffGet(token:string,health:HoursHealth,request:typeof fetch,path:string,params:Record<string,string|number>={},options:HoursCallOptions={}){
 return hubstaffCall('GET',token,health,request,path,params,options);
}

/**
 * Mode B only: swap a personal refresh token for an access token and the next
 * refresh token. The only non-GET call in this build. A thrown request is an
 * unknown outcome (the refresh token may already be spent), which the caller
 * turns into "paste a new personal token".
 */
export async function hubstaffExchange(refreshToken:string,health:HoursHealth,request:typeof fetch):Promise<{accessToken:string;refreshToken:string;expiresIn:number}>{
 if(!refreshToken)throw new HoursProviderError('missing_key','Hubstaff isn\'t connected. Paste its key in Connections.');
 const receipt={provider:'hubstaff-auth' as const,method:'POST' as const,resource:'account.hubstaff.com/access_tokens'};
 await health({...receipt,phase:'intent'});
 let response:Response;
 try{
  response=await request('https://account.hubstaff.com/access_tokens',{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json','User-Agent':HUBSTAFF_USER_AGENT},
   body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}),signal:AbortSignal.timeout(25000)});
 }catch{
  await health({...receipt,phase:'unknown'});
  throw new HoursProviderError('unreachable','Hubstaff did not confirm the token exchange; the personal token may already be used.');
 }
 await health({...receipt,phase:'response',http_status:response.status});
 let parsed:unknown=null;
 let readable=true;
 const raw=await response.text().catch(()=>'');
 try{parsed=JSON.parse(raw);}catch{readable=false;}
 const body=isJsonObject(parsed)?parsed:{};
 if(!response.ok){
  // Stopped by Cloudflare before Hubstaff saw it: the token was not used.
  const blocked=firewallCode(response.status,raw,response.headers,readable);
  if(blocked)throw firewallError(blocked);
  const code=safeCode(body.error,refreshToken);
  throw new HoursProviderError(response.status===400||response.status===401?'refused':'http',`Hubstaff refused the personal token (${response.status}${code?` ${code}`:''}).`,response.status,code);
 }
 if(typeof body.access_token!=='string'||typeof body.refresh_token!=='string')
  throw new HoursProviderError('unreadable',`Hubstaff's token exchange returned an unreadable response (${response.status}).`,response.status);
 const expires=Number(body.expires_in);
 return {accessToken:body.access_token,refreshToken:body.refresh_token,expiresIn:Number.isFinite(expires)&&expires>0?expires:86400};
}

const TIMETASTIC_PATHS:{test:RegExp;template:string}[]=[
 {test:/^users$/,template:'users'},
 {test:/^users\/\d{1,12}$/,template:'users/{id}'},
 {test:/^users\/contact\/\d{1,12}$/,template:'users/contact/{id}'},
 {test:/^leavetypes$/,template:'leavetypes'},
 {test:/^holidays$/,template:'holidays'},
 {test:/^absences$/,template:'absences'},
];

/**
 * Timetastic, GET only. `path` is a resource ("holidays") or, for the next
 * page, the absolute nextPageLink Timetastic gave, which must stay on
 * https://app.timetastic.co.uk/api/.
 */
export async function timetasticGet(
 token:string,
 health:HoursHealth,
 request:typeof fetch,
 path:string,
 params:Record<string,string|number|boolean>={},
 options:HoursCallOptions={},
):Promise<unknown>{
 let url:URL;
 if(/^https?:\/\//i.test(path)){
  try{url=new URL(path);}catch{throw new HoursProviderError('invalid','Timetastic gave a page link the cockpit can\'t read. Nothing was sent.');}
  if(url.protocol!=='https:'||url.host!=='app.timetastic.co.uk'||!url.pathname.startsWith('/api/')||url.username||url.password)
   throw new HoursProviderError('invalid','Timetastic gave a page link to another host. Nothing was sent.');
 }else url=new URL(`https://app.timetastic.co.uk/api/${path}`);
 const rel=url.pathname.replace(/^\/api\//,'').replace(/\/$/,'');
 const hit=TIMETASTIC_PATHS.find(p=>p.test.test(rel));
 if(!hit)throw new HoursProviderError('invalid','That Timetastic resource is not one the cockpit reads. Nothing was sent.');
 if(!token)throw new HoursProviderError('missing_key','Timetastic isn\'t connected. Paste its key in Connections.');
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 const receipt={provider:'timetastic' as const,method:'GET' as const,resource:`app.timetastic.co.uk/api/${hit.template}`};
 const sleep=options.sleep??sleepFor;
 for(let attempt=0;;attempt++){
  await health({...receipt,phase:'intent'});
  let response:Response;
  try{
   response=await request(url.toString(),{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),headers:{
    Authorization:`Bearer ${token}`,Accept:'application/json','User-Agent':'mahara-cockpit-hours/1','X-Client-ID':'mahara-cockpit'}});
  }catch{
   await health({...receipt,phase:'unknown'});
   throw new HoursProviderError('unreachable','Timetastic could not be reached. The next read tries again.');
  }
  await health({...receipt,phase:'response',http_status:response.status});
  if(response.status===429&&attempt===0){
   const reset=Date.parse(response.headers.get('x-rate-limit-reset')??'');
   const wait=Number.isFinite(reset)?Math.max(0,reset-Date.now()):1000;
   if(wait<=10_000){await sleep(wait);continue;}
  }
  let parsed:unknown=null;
  let readable=true;
  try{parsed=JSON.parse(await response.text());}catch{readable=false;}
  if(!response.ok){
   const body=isJsonObject(parsed)?parsed:{};
   const code=safeCode(body.code??body.errorCode??body.title,token);
   if(response.status===401||response.status===403)throw new HoursProviderError('refused',`Timetastic refused the key (${response.status}${code?` ${code}`:''}).`,response.status,code);
   if(response.status===429)throw new HoursProviderError('rate_limited','Timetastic asked the cockpit to slow down (429). The next read tries again.',429,code);
   throw new HoursProviderError('http',`Timetastic answered ${response.status}${code?` ${code}`:''}.`,response.status,code);
  }
  if(!readable)throw new HoursProviderError('unreadable',`Timetastic returned an unreadable response (${response.status}).`,response.status);
  return parsed;
 }
}
