import {z} from 'zod';
export type Provider={call:(method:'GET'|'POST',path:string,body?:Record<string,unknown>)=>Promise<any>};
export function providerTools(token:string,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch):Provider{
 if(!token)throw Error('CLICKUP_API_TOKEN is not configured');
 return {async call(method,path,body){
  if(path.includes('://')||path.includes('..')||path.startsWith('/'))throw Error('Invalid ClickUp resource');
  const row={method,resource:path.split('?')[0]};await health({...row,phase:'intent'});
  let response:Response;try{response=await request('https://api.clickup.com/api/v2/'+path,{method,headers:{Authorization:token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});}catch{await health({...row,phase:'unknown'});throw Error('ClickUp response is unknown. Reconcile this action before retrying.');}
  const text=await response.text();let data:any;try{data=text?JSON.parse(text):{};}catch{await health({...row,phase:'response',http_status:response.status});throw Error('ClickUp response could not be read. Reconcile before retrying.');}
  await health({...row,phase:'response',http_status:response.status,object_id:data.id?String(data.id):null});
  if(!response.ok||data.err)throw Error(`ClickUp rejected the request (${response.status}); inspect its receipt.`);return data;
 }};
}

/** Client check-in appointments, and the CEO's read-only WhatsApp probe. No automatic retries after any response. */
export function ghlTools(token:string,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch):{call:(method:'GET'|'POST',path:string,body?:Record<string,unknown>)=>Promise<unknown>}{
 if(!token)throw Error('GHL_MAHARA_PIT is not configured');
 return {async call(method,path,body){
  const conversationRead=method==='GET'&&(/^conversations\/search\?[^/]*$/.test(path)||/^conversations\/[A-Za-z0-9_-]{1,64}\/messages(\?[^/]*)?$/.test(path));
  if((!path.startsWith('calendars/')&&!(method==='POST'&&path==='contacts/search')&&!conversationRead)||path.includes('://')||path.includes('..'))throw Error('Invalid GoHighLevel resource');
  const row={provider:'ghl',method,resource:path.split('?')[0]};await health({...row,phase:'intent'});
  let response:Response;
  try{response=await request('https://services.leadconnectorhq.com/'+path,{method,headers:{Authorization:'Bearer '+token,Version:'2021-04-15',Accept:'application/json','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});}
  catch{await health({...row,phase:'unknown'});throw Error('GoHighLevel delivery is unknown. Reconcile this booking before retrying.');}
  let data:unknown;try{data=await response.json();}catch{await health({...row,phase:'unknown',http_status:response.status});throw Error('GoHighLevel returned an unreadable receipt. Reconcile this booking before retrying.');}
  const receipt=z.object({id:z.string().optional(),appointment:z.object({id:z.string().optional()}).optional(),event:z.object({id:z.string().optional()}).optional()}).safeParse(data);
  await health({...row,phase:'response',http_status:response.status,object_id:receipt.success?(receipt.data.id??receipt.data.appointment?.id??receipt.data.event?.id??null):null});
  if(!response.ok)throw Error('GoHighLevel refused the request ('+response.status+'). Inspect its provider receipt.');
  return data;
 }};
}

/**
 * Supabase Storage calls for the launch-ads bucket (signing an upload, reading
 * an object's size and type, signing reads). Receipts carry a label, the
 * upload's id and Storage's HTTP status only: never a signed URL, a token or a
 * storage error text. `run` reports the status Storage answered with; a call
 * that throws, or answers with no status, is a failed receipt, which the
 * native monitor shows until the next good one.
 */
export function storageTools(health:(row:Record<string,unknown>)=>Promise<void>){
 return {async call<T>(method:'GET'|'POST'|'DELETE',resource:string,objectId:string|null,run:()=>Promise<{status:number|null;value:T}>):Promise<T>{
  const receipt={provider:'supabase-storage',method,resource,object_id:objectId};
  await health({...receipt,phase:'intent'});
  let out:{status:number|null;value:T};
  try{out=await run();}catch(error){await health({...receipt,phase:'failed'});throw error;}
  await health(out.status===null?{...receipt,phase:'failed'}:{...receipt,phase:'response',http_status:out.status});
  return out.value;
 }};
}
/** The HTTP status a Storage error carries (its API code first), or null. */
export function storageStatus(error:unknown):number|null{
 if(!error||typeof error!=='object')return null;
 const e=error as {statusCode?:unknown;status?:unknown};
 for(const raw of [e.statusCode,e.status]){const n=Number(raw);if(Number.isInteger(n)&&n>=100&&n<600)return n;}
 return null;
}

/** Onboarding forms are provider-owned reads, never browser writes. */
export function typeformTools(token:string,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch):{get:(path:string)=>Promise<Record<string,unknown>>}{
 if(!token)throw Error('TYPEFORM_TOKEN is not configured');
 return {async get(path){
  if(!/^forms\/[A-Za-z0-9_-]+(?:\/responses(?:\?.*)?)?$/.test(path)||path.includes('..')||path.includes('://'))throw Error('Invalid Typeform resource');
  const receipt={provider:'typeform',method:'GET',resource:path.split('?')[0]};await health({...receipt,phase:'intent'});
  let response:Response;
  try{response=await request('https://api.typeform.com/'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(25000)});}
  catch{await health({...receipt,phase:'unknown'});throw Error('Typeform could not be read. Existing forms remain unchanged.');}
  await health({...receipt,phase:'response',http_status:response.status});
  if(!response.ok)throw Error('Typeform refused the read ('+response.status+'). Existing forms remain unchanged.');
  return z.record(z.string(),z.unknown()).parse(await response.json());
 }};
}

/**
 * Slack Web API calls for the cockpit's notices (supabase/functions/cockpit-notices), written on
 * eod-radar/slack.ts. The token is the function secret SLACK_BOT_TOKEN (mahara-club-bot), read by name
 * by the caller and never written anywhere. Every call writes an intent row before it leaves and one
 * response or unknown row after; a row that cannot be saved throws, so no call goes out without one.
 * The resource is slack.com/api/{method} only: never a channel, a person, an email or the text. The
 * object id is the ts of a post, else null. Slack answers 200 with ok:false on a refusal, so both are
 * checked; a 5xx, a timeout or an unreadable 200 is unknown (it may have posted), never a refusal. So
 * are internal_error and fatal_error, which Slack documents as "some aspect of the operation may have
 * succeeded": a refusal would let a person requeue a post that is already in the channel.
 * service_unavailable and request_timeout stay refusals (Slack did not take the request). Nothing here
 * retries.
 */
export type SlackHealthRow={provider:'slack';method:'GET'|'POST';resource:string;phase:'intent'|'response'|'unknown';http_status?:number|null;object_id?:string|null};
export type SlackAnswer=
 |{kind:'ok';body:Record<string,unknown>;scopes:string|null}
 |{kind:'refused';code:string;status:number;retryAfter:number|null;scopes:string|null}
 |{kind:'unknown';code?:string};
export type SlackPost=
 |{state:'posted';ts:string;channel:string;botId:string|null}
 |{state:'ratelimited';retryAfter:number}
 |{state:'failed';code:string}
 |{state:'unknown';error:string};
export type SlackResource='chat.postMessage'|'chat.getPermalink'|'conversations.history'|'conversations.replies'|'conversations.info'|'users.lookupByEmail'|'auth.test';
const SLACK_RESOURCES=new Set<string>(['chat.postMessage','chat.getPermalink','conversations.history','conversations.replies','conversations.info','users.lookupByEmail','auth.test']);
/** Slack's own codes for an answer that may have done what was asked. */
export const SLACK_MAYBE_DONE=new Set<string>(['internal_error','fatal_error']);
const slackObj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const slackStr=(v:unknown):string|null=>typeof v==='string'&&v?v:null;
export function slackTools(token:string,health:(row:SlackHealthRow)=>Promise<void>,request:typeof fetch=fetch){
 if(!token)throw Error('SLACK_BOT_TOKEN is not configured');
 async function call(method:'GET'|'POST',resource:SlackResource,input:Record<string,unknown>,onSend?:()=>void):Promise<SlackAnswer>{
  if(!SLACK_RESOURCES.has(resource))throw Error('Invalid Slack resource');
  const row={provider:'slack' as const,method,resource:`slack.com/api/${resource}`};
  await health({...row,phase:'intent'});
  const fields=Object.entries(input).filter(([,v])=>v!==undefined&&v!==null);
  const query=method==='GET'&&fields.length?`?${new URLSearchParams(fields.map(([k,v])=>[k,String(v)]))}`:'';
  let response:Response;
  try{
   onSend?.();
   response=await request(`https://slack.com/api/${resource}${query}`,{method,redirect:'error',
    headers:{Authorization:`Bearer ${token}`,...(method==='POST'?{'Content-Type':'application/json; charset=utf-8'}:{})},
    body:method==='POST'?JSON.stringify(Object.fromEntries(fields)):undefined,signal:AbortSignal.timeout(15000)});
  }catch{await health({...row,phase:'unknown'});return {kind:'unknown'};}
  let body:Record<string,unknown>|null=null;
  try{const parsed:unknown=await response.json();body=slackObj(parsed)?parsed:null;}catch{body=null;}
  const scopes=response.headers.get('x-oauth-scopes');
  const code=typeof body?.error==='string'?(body.error.toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,60)||null):null;
  const ok=response.ok&&body?.ok===true;
  const limited=response.status===429||code==='ratelimited';
  const unknown=!ok&&!limited&&(response.status>=500||(response.ok&&body===null)||(code!==null&&SLACK_MAYBE_DONE.has(code)));
  const ts=ok&&resource==='chat.postMessage'?slackStr(body?.ts):null;
  await health({...row,phase:unknown?'unknown':'response',http_status:response.status,object_id:ts});
  if(ok&&body)return {kind:'ok',body,scopes};
  if(limited){const after=Number(response.headers.get('retry-after'));return {kind:'refused',code:'ratelimited',status:response.status,retryAfter:Number.isFinite(after)&&after>0?Math.ceil(after):null,scopes};}
  if(unknown)return code?{kind:'unknown',code}:{kind:'unknown'};
  return {kind:'refused',code:code??`http_${response.status}`,status:response.status,retryAfter:null,scopes};
 }
 const read=(resource:SlackResource,input:Record<string,unknown>)=>call('GET',resource,input);
 return {
  call,
  /** One post. Always unfurl_links and unfurl_media false. A throw (a receipt that could not be saved) is left to the caller, which knows from onSend whether the request had left. */
  async postMessage(input:{channel:string;text:string;blocks?:unknown[];thread_ts?:string},onSend?:()=>void):Promise<SlackPost>{
   const answer=await call('POST','chat.postMessage',{channel:input.channel,text:input.text,...(input.blocks?{blocks:input.blocks}:{}),...(input.thread_ts?{thread_ts:input.thread_ts}:{}),unfurl_links:false,unfurl_media:false},onSend);
   if(answer.kind==='unknown')return {state:'unknown',error:answer.code?`Slack answered ${answer.code}, which can mean the post went through; it is not sent again in case it arrived.`:'Slack did not confirm the post; it is not sent again in case it arrived.'};
   if(answer.kind==='refused')return answer.code==='ratelimited'?{state:'ratelimited',retryAfter:answer.retryAfter??30}:{state:'failed',code:answer.code};
   const ts=slackStr(answer.body.ts)??'';
   if(!/^\d+\.\d+$/.test(ts))return {state:'unknown',error:"Slack answered without the message's timestamp; it is not sent again in case it arrived."};
   const message=slackObj(answer.body.message)?answer.body.message:{};
   return {state:'posted',ts,channel:slackStr(answer.body.channel)??'',botId:slackStr(message.bot_id)};
  },
  history(channel:string,opts:{oldest?:string;latest?:string;inclusive?:boolean;limit?:number;cursor?:string}){
   return read('conversations.history',{channel,oldest:opts.oldest,latest:opts.latest,inclusive:opts.inclusive===undefined?undefined:String(opts.inclusive),limit:opts.limit,cursor:opts.cursor||undefined});
  },
  replies(channel:string,ts:string,opts:{oldest?:string;limit?:number;cursor?:string}){
   return read('conversations.replies',{channel,ts,oldest:opts.oldest,limit:opts.limit,cursor:opts.cursor||undefined});
  },
  async info(channel:string):Promise<{ok:true;id:string;name:string|null;isPrivate:boolean;isMember:boolean;isArchived:boolean;scopes:string|null}|{ok:false;code:string;scopes:string|null}>{
   const answer=await read('conversations.info',{channel});
   if(answer.kind==='unknown')return {ok:false,code:'no_answer',scopes:null};
   if(answer.kind==='refused')return {ok:false,code:answer.code,scopes:answer.scopes};
   const c=slackObj(answer.body.channel)?answer.body.channel:{};
   return {ok:true,id:slackStr(c.id)??channel,name:slackStr(c.name),isPrivate:c.is_private===true||c.is_group===true,isMember:c.is_member===true,isArchived:c.is_archived===true,scopes:answer.scopes};
  },
  /** Best effort: any refusal, break or odd link is null, never a throw. */
  async permalink(channel:string,ts:string):Promise<string|null>{
   try{
    const answer=await read('chat.getPermalink',{channel,message_ts:ts});
    const link=answer.kind==='ok'?slackStr(answer.body.permalink):null;
    return link&&/^https:\/\/[a-z0-9.-]+\.slack\.com\//.test(link)?link:null;
   }catch{return null;}
  },
  async lookupByEmail(email:string):Promise<{state:'ok';id:string}|{state:'not_found'}|{state:'refused';code:string}|{state:'unknown'}>{
   const answer=await read('users.lookupByEmail',{email});
   if(answer.kind==='unknown')return {state:'unknown'};
   if(answer.kind==='refused')return answer.code==='users_not_found'?{state:'not_found'}:{state:'refused',code:answer.code};
   const user=slackObj(answer.body.user)?answer.body.user:{};
   const id=slackStr(user.id);
   if(!id||!/^[UW][A-Z0-9]{8,12}$/.test(id)||user.deleted===true)return {state:'not_found'};
   return {state:'ok',id};
  },
  async authTest():Promise<{ok:true;userId:string|null;teamUrl:string|null;scopes:string|null}|{ok:false;code:string}>{
   const answer=await call('POST','auth.test',{});
   if(answer.kind==='unknown')return {ok:false,code:'no_answer'};
   if(answer.kind==='refused')return {ok:false,code:answer.code};
   return {ok:true,userId:slackStr(answer.body.user_id),teamUrl:slackStr(answer.body.url),scopes:answer.scopes};
  },
 };
}
export type SlackTools=ReturnType<typeof slackTools>;

/**
 * Outside web reads for the upsell studio (docs/upsell-studio/EDGE.md): a
 * client's own site, a video's oEmbed, a logo picture and a Drive thumbnail.
 * Only https on the default port, plus http for a site (tried as https
 * first). User info, IP literals, single-label hosts, localhost and the
 * private suffixes are refused before anything leaves; every redirect hop is
 * checked again, five at most. DNS validation is required before each request.
 * Missing, failed or partial lookups stop the read, as do private addresses.
 * The body is read up to `maxBytes`, and one deadline covers every hop.
 * Receipts carry the purpose and the host only, never a path or a query; a
 * receipt that cannot be saved stops the call before it leaves.
 */
export type WebPurpose='site'|'oembed'|'logo'|'thumbnail';
export type WebErrorKind='refused'|'dns'|'tls'|'timeout'|'network'|'redirects';
export class WebError extends Error{constructor(message:string,readonly kind:WebErrorKind,readonly url:string|null=null){super(message);}}
/** The check service is unavailable; this is not evidence that the client site failed. */
export class WebValidationError extends Error{constructor(){super('The address could not be checked safely. Try again later.');}}
export type WebResult={status:number;finalUrl:string;headers:Headers;body:Uint8Array;redirects:string[];truncated:boolean};
/** Every A and AAAA address of a host; [] when the name does not exist; null when it could not be looked up here. */
export type WebResolver=(host:string)=>Promise<string[]|null>;
export type WebGet=(url:string,options:{purpose:WebPurpose;maxBytes:number;timeoutMs:number;accept?:string;referer?:string})=>Promise<WebResult>;
export const WEB_MAX_REDIRECTS=5;
const WEB_AGENT='Mozilla/5.0 (compatible; MaharaSiteCheck/1.0; +https://maharamedia.com)';
const PRIVATE_SUFFIX=/(^|\.)(localhost|local|internal|lan|home|corp|intranet|arpa|test|invalid|example)$/;

/** True for an address no outside read may reach: loopback, private, link-local, shared, documentation, multicast and the rest. */
export function privateAddress(ip:string):boolean{
 const a=ip.trim().toLowerCase().replace(/^\[|\]$/g,'').split('%')[0];
 const v4=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
 if(v4){
  const [p,q,r]=[Number(v4[1]),Number(v4[2]),Number(v4[3])];
  if([p,q,r,Number(v4[4])].some(n=>n>255))return true;
  return p===0||p===10||p===127||p>=224||(p===100&&q>=64&&q<=127)||(p===169&&q===254)||(p===172&&q>=16&&q<=31)||(p===192&&q===168)
   ||(p===192&&q===0&&(r===0||r===2))||(p===198&&(q===18||q===19))||(p===198&&q===51&&r===100)||(p===203&&q===0&&r===113);
 }
 if(!a.includes(':'))return true;
 const mapped=/^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
 if(mapped)return privateAddress(mapped[1]);
 const [head='',tail='']=a.split('::',2);
 const left=head?head.split(':'):[],right=a.includes('::')?(tail?tail.split(':'):[]):[];
 const groups=a.includes('::')?[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right]:left;
 if(groups.length!==8||groups.some(g=>!/^[0-9a-f]{1,4}$/.test(g)))return true;
 const n=groups.map(g=>parseInt(g,16));
 if(n.every(x=>x===0)||(n.slice(0,7).every(x=>x===0)&&n[7]===1))return true;
 if(n.slice(0,5).every(x=>x===0)&&n[5]===0xffff)return privateAddress(`${n[6]>>8}.${n[6]&255}.${n[7]>>8}.${n[7]&255}`);
 if(n[0]===0x64&&n[1]===0xff9b&&n.slice(2,6).every(x=>x===0))return privateAddress(`${n[6]>>8}.${n[6]&255}.${n[7]>>8}.${n[7]&255}`);
 return (n[0]&0xfe00)===0xfc00||(n[0]&0xffc0)===0xfe80||(n[0]&0xff00)===0xff00||(n[0]===0x2001&&n[1]===0x0db8)||(n[0]===0x2002);
}

/** Why an address may not be read for this purpose, or null when it may. Pure: nothing leaves. */
export function webRefusal(raw:string|URL,purpose:WebPurpose):string|null{
 let u:URL;try{u=typeof raw==='string'?new URL(raw):raw;}catch{return 'That is not a web address.';}
 const http=u.protocol==='http:';
 if(u.protocol!=='https:'&&!(http&&purpose==='site'))return purpose==='site'?'Only http and https addresses can be checked.':'Only https addresses can be read.';
 if(u.username||u.password)return 'An address with a user name or password is not read.';
 if(u.port&&u.port!==(http?'80':'443'))return 'An address on another port is not read.';
 const host=u.hostname.toLowerCase().replace(/\.$/,'');
 if(!host||host.startsWith('[')||/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||host.includes(':'))return 'An address written as an IP number is not read.';
 if(!host.includes('.')||PRIVATE_SUFFIX.test(host)||host.startsWith('metadata.')||/^[\d.]+$/.test(host))return 'That address is inside a private network, so it is not read.';
 return null;
}

/** Everything an error carries (name, message, code, causes), for sorting it into dns, tls, timeout or network. */
function webErrorText(error:unknown,depth=0):string{
 if(!error||typeof error!=='object'||depth>3)return String(error??'');
 const e=error as {name?:unknown;message?:unknown;code?:unknown;cause?:unknown};
 return [e.name,e.message,e.code].map(x=>String(x??'')).join(' ')+' '+webErrorText(e.cause,depth+1);
}
export function webFailureKind(error:unknown,timedOut:boolean):WebErrorKind{
 if(timedOut)return 'timeout';
 const t=webErrorText(error).toLowerCase();
 if(/dns error|failed to lookup|getaddrinfo|enotfound|eai_again|eai_noname|name or service not known|no such host|nodename nor servname|could not resolve|failed to resolve|dns lookup/.test(t))return 'dns';
 if(/certificate|cert_|\btls\b|\bssl\b|handshake|unknownissuer|notvalidforname|self[ -]signed|x509|altname|unable_to_verify/.test(t))return 'tls';
 if(/timed? ?out|timeout|aborterror|operation was aborted/.test(t))return 'timeout';
 return 'network';
}
const WEB_SENTENCE:Record<WebErrorKind,string>={refused:'That address is not read.',dns:'The address does not exist (no DNS record).',tls:'The site\'s security certificate failed.',
 timeout:'The site did not answer in time.',network:'The site could not be reached.',redirects:'The address redirects more than 5 times.'};

export function webTools(health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch,resolve?:WebResolver):{get:WebGet}{
 async function capped(res:Response,max:number,signal:AbortSignal):Promise<{body:Uint8Array;truncated:boolean}>{
  if(!res.body)return {body:new Uint8Array(0),truncated:false};
  const reader=res.body.getReader();const parts:Uint8Array[]=[];let size=0,truncated=false;
  try{
   for(;;){
    const {done,value}=await reader.read();if(done)break;
    if(size+value.byteLength>max){parts.push(value.subarray(0,max-size));size=max;truncated=true;await reader.cancel().catch(()=>{});break;}
    parts.push(value);size+=value.byteLength;
   }
  }catch(error){throw new WebError(WEB_SENTENCE[webFailureKind(error,signal.aborted)],webFailureKind(error,signal.aborted));}
  const body=new Uint8Array(size);let at=0;for(const p of parts){body.set(p,at);at+=p.byteLength;}
  return {body,truncated};
 }
 async function follow(start:URL,o:Parameters<WebGet>[1],signal:AbortSignal):Promise<WebResult>{
  let current=start;const redirects:string[]=[];
  for(;;){
   const problem=webRefusal(current,o.purpose);if(problem)throw new WebError(problem,'refused',current.toString());
   const host=current.hostname.toLowerCase().replace(/\.$/,'');
   const receipt={provider:'web',method:'GET',resource:`${o.purpose}:${host}`};
   await health({...receipt,phase:'intent'});
   // A failed/partial resolver must never fall through to fetch. The deadline
   // also bounds DNS itself; runtimes may leave a lookup promise pending.
   let found:string[]|null=null;
   if(resolve&&!signal.aborted){
    let abort:()=>void=()=>{};
    try{
     found=await Promise.race([Promise.resolve().then(()=>resolve(host)),new Promise<null>(done=>{
      abort=()=>done(null);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
     })]);
    }catch{found=null;}finally{signal.removeEventListener('abort',abort);}
   }
   if(found===null||signal.aborted){await health({...receipt,phase:'unknown'});throw new WebValidationError();}
   if(!found.length){await health({...receipt,phase:'unknown'});throw new WebError(WEB_SENTENCE.dns,'dns',current.toString());}
   if(found.some(privateAddress)){await health({...receipt,phase:'unknown'});throw new WebError('That address leads inside a private network, so it is not read.','refused',current.toString());}
   let res:Response;
   try{res=await request(current.toString(),{method:'GET',redirect:'manual',credentials:'omit',signal,
    headers:{'User-Agent':WEB_AGENT,Accept:o.accept??'*/*','Accept-Language':'en,ar;q=0.8',...(o.referer?{Referer:o.referer}:{})}});}
   catch(error){await health({...receipt,phase:'unknown'});const kind=webFailureKind(error,signal.aborted);throw new WebError(WEB_SENTENCE[kind],kind,current.toString());}
   await health({...receipt,phase:'response',http_status:res.status});
   const location=res.status>=300&&res.status<400?res.headers.get('location'):null;
   if(location){
    await res.body?.cancel().catch(()=>{});
    if(redirects.length>=WEB_MAX_REDIRECTS)throw new WebError(WEB_SENTENCE.redirects,'redirects',current.toString());
    let next:URL;try{next=new URL(location,current);}catch{throw new WebError('The site redirects to an address that cannot be read.','refused',current.toString());}
    redirects.push(next.toString());current=next;continue;
   }
   const {body,truncated}=await capped(res,o.maxBytes,signal);
   return {status:res.status,finalUrl:current.toString(),headers:res.headers,body,redirects,truncated};
  }
 }
 return {async get(raw,o){
  if(!Number.isSafeInteger(o.maxBytes)||o.maxBytes<1||o.maxBytes>20_000_000||!Number.isSafeInteger(o.timeoutMs)||o.timeoutMs<1||o.timeoutMs>30_000)throw Error('A web read needs a byte cap and a deadline');
  let start:URL;try{start=new URL(raw);}catch{throw new WebError('That is not a web address.','refused',null);}
  const problem=webRefusal(start,o.purpose);if(problem)throw new WebError(problem,'refused',start.toString());
  const deadline=new AbortController();const timer=setTimeout(()=>deadline.abort(),o.timeoutMs);
  try{
   if(o.purpose!=='site'||start.protocol!=='http:')return await follow(start,o,deadline.signal);
   // A site on file as http: its https address first; the http one when that fails or answers an error.
   const secure=new URL(start.toString());secure.protocol='https:';
   let upgraded:WebResult|null=null;
   try{upgraded=await follow(secure,o,deadline.signal);if(upgraded.status<400)return upgraded;}
   catch(error){if(!(error instanceof WebError)||(error.kind!=='tls'&&error.kind!=='network'))throw error;}
   try{return await follow(start,o,deadline.signal);}catch(error){if(upgraded)return upgraded;throw error;}
  }finally{clearTimeout(timer);}
 }};
}

/**
 * Fathom reads for the 1-1 notes (docs/forms/STAGE2-CONTRACT.md 6.3): the
 * meetings list, one recording's summary or transcript, and the users list
 * that proves the key is an admin's. GET only, on four fixed paths. The query
 * is written by hand so teams[] and recorded_by[] keep their brackets (Fathom
 * ignores a filter without them and answers with the CEO's private meetings),
 * and only values are encoded. Every call writes an intent row before it
 * leaves and one response or unknown row after; a row that cannot be saved
 * throws, so no call goes out without one. The resource is the worker's form
 * (api.fathom.ai/external/v1/recordings/:id/summary), so its good receipts and
 * these clear the same native monitor rows. A 4xx (429 included) is a refusal
 * with Fathom's rate headers; a 5xx, a timeout or a body that is not a JSON
 * object is unknown. meetings() also drops every item outside the teams or
 * recorders asked for, and says how many it dropped (body.dropped).
 */
export type FathomHealthRow={provider:'fathom';method:'GET';resource:string;phase:'intent'|'response'|'unknown';http_status?:number|null;object_id?:string|null};
export type FathomLimit={limit:number|null;remaining:number|null;reset:number|null};
export type FathomAnswer=
 |{kind:'ok';body:Record<string,unknown>;limit:FathomLimit}
 |{kind:'refused';status:number;retryAfter:number|null;limit:FathomLimit}
 |{kind:'unknown'};
const FATHOM_API='https://api.fathom.ai/external/v1';
const FATHOM_PATH=/^\/(?:meetings|users|recordings\/\d{3,20}\/(?:summary|transcript))$/;
const fathomObj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const fathomNum=(v:string|null):number|null=>{if(v===null||v.trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
export function fathomTools(key:string,health:(row:FathomHealthRow)=>Promise<void>,request:typeof fetch=fetch){
 if(!key)throw Error('FATHOM key is not configured');
 async function get(path:string,query:[string,string][]):Promise<FathomAnswer>{
  if(!FATHOM_PATH.test(path))throw Error('Invalid Fathom resource');
  const row={provider:'fathom' as const,method:'GET' as const,resource:`api.fathom.ai/external/v1${path.replace(/\/\d{3,20}(?=\/)/,'/:id')}`,object_id:null};
  await health({...row,phase:'intent'});
  const qs=query.map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  let response:Response;
  try{response=await request(`${FATHOM_API}${path}${qs?`?${qs}`:''}`,{method:'GET',redirect:'error',headers:{'X-Api-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(25000)});}
  catch{await health({...row,phase:'unknown'});return {kind:'unknown'};}
  const limit={limit:fathomNum(response.headers.get('ratelimit-limit')),remaining:fathomNum(response.headers.get('ratelimit-remaining')),reset:fathomNum(response.headers.get('ratelimit-reset'))};
  if(response.status>=400&&response.status<500){
   await response.body?.cancel().catch(()=>{});
   await health({...row,phase:'response',http_status:response.status});
   const after=fathomNum(response.headers.get('retry-after'));
   return {kind:'refused',status:response.status,retryAfter:after!==null&&after>0?Math.ceil(after):null,limit};
  }
  let body:unknown=null;
  if(response.ok){try{body=await response.json();}catch{body=null;}}else await response.body?.cancel().catch(()=>{});
  if(!response.ok||!fathomObj(body)){await health({...row,phase:'unknown',http_status:response.status});return {kind:'unknown'};}
  await health({...row,phase:'response',http_status:response.status});
  return {kind:'ok',body,limit};
 }
 return {
  async meetings(q:{createdAfter:string;createdBefore?:string;teams?:string[];recordedBy?:string[];includeActionItems?:boolean;includeSummary?:boolean;includeTranscript?:boolean;cursor?:string}):Promise<FathomAnswer>{
   const query:[string,string][]=[['created_after',q.createdAfter]];
   if(q.createdBefore)query.push(['created_before',q.createdBefore]);
   for(const t of q.teams??[])query.push(['teams[]',t]);
   for(const e of q.recordedBy??[])query.push(['recorded_by[]',e]);
   if(q.includeActionItems)query.push(['include_action_items','true']);
   if(q.includeSummary)query.push(['include_summary','true']);
   if(q.includeTranscript)query.push(['include_transcript','true']);
   if(q.cursor)query.push(['cursor',q.cursor]);
   const answer=await get('/meetings',query);
   if(answer.kind!=='ok')return answer;
   const teams=q.teams?.length?new Set(q.teams):null,people=q.recordedBy?.length?new Set(q.recordedBy.map(e=>e.trim().toLowerCase())):null;
   const items=Array.isArray(answer.body.items)?answer.body.items:[];
   const kept=items.filter(m=>{
    const by=fathomObj(m)&&fathomObj(m.recorded_by)?m.recorded_by:{};
    return (!teams||teams.has(String(by.team??'')))&&(!people||people.has(String(by.email??'').trim().toLowerCase()));
   });
   return {...answer,body:{...answer.body,items:kept,dropped:items.length-kept.length}};
  },
  recording(id:string,part:'summary'|'transcript'):Promise<FathomAnswer>{
   if(!/^\d{3,20}$/.test(id)||(part!=='summary'&&part!=='transcript'))throw Error('Invalid Fathom resource');
   return get(`/recordings/${id}/${part}`,[]);
  },
  users():Promise<FathomAnswer>{return get('/users',[]);},
 };
}
export type FathomTools=ReturnType<typeof fathomTools>;
