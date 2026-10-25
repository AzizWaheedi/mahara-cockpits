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
 * checked; a 5xx, a timeout or an unreadable 200 is unknown (it may have posted), never a refusal.
 * Nothing here retries.
 */
export type SlackHealthRow={provider:'slack';method:'GET'|'POST';resource:string;phase:'intent'|'response'|'unknown';http_status?:number|null;object_id?:string|null};
export type SlackAnswer=
 |{kind:'ok';body:Record<string,unknown>;scopes:string|null}
 |{kind:'refused';code:string;status:number;retryAfter:number|null;scopes:string|null}
 |{kind:'unknown'};
export type SlackPost=
 |{state:'posted';ts:string;channel:string;botId:string|null}
 |{state:'ratelimited';retryAfter:number}
 |{state:'failed';code:string}
 |{state:'unknown';error:string};
export type SlackResource='chat.postMessage'|'chat.getPermalink'|'conversations.history'|'conversations.replies'|'conversations.info'|'users.lookupByEmail'|'auth.test';
const SLACK_RESOURCES=new Set<string>(['chat.postMessage','chat.getPermalink','conversations.history','conversations.replies','conversations.info','users.lookupByEmail','auth.test']);
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
  const unknown=!ok&&!limited&&(response.status>=500||(response.ok&&body===null));
  const ts=ok&&resource==='chat.postMessage'?slackStr(body?.ts):null;
  await health({...row,phase:unknown?'unknown':'response',http_status:response.status,object_id:ts});
  if(ok&&body)return {kind:'ok',body,scopes};
  if(limited){const after=Number(response.headers.get('retry-after'));return {kind:'refused',code:'ratelimited',status:response.status,retryAfter:Number.isFinite(after)&&after>0?Math.ceil(after):null,scopes};}
  if(unknown)return {kind:'unknown'};
  return {kind:'refused',code:code??`http_${response.status}`,status:response.status,retryAfter:null,scopes};
 }
 const read=(resource:SlackResource,input:Record<string,unknown>)=>call('GET',resource,input);
 return {
  call,
  /** One post. Always unfurl_links and unfurl_media false. A throw (a receipt that could not be saved) is left to the caller, which knows from onSend whether the request had left. */
  async postMessage(input:{channel:string;text:string;blocks?:unknown[];thread_ts?:string},onSend?:()=>void):Promise<SlackPost>{
   const answer=await call('POST','chat.postMessage',{channel:input.channel,text:input.text,...(input.blocks?{blocks:input.blocks}:{}),...(input.thread_ts?{thread_ts:input.thread_ts}:{}),unfurl_links:false,unfurl_media:false},onSend);
   if(answer.kind==='unknown')return {state:'unknown',error:'Slack did not confirm the post; it is not sent again in case it arrived.'};
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
