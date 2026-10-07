import type {Provider,Row} from './core.ts';
// One provider request, never an automatic write retry. Credentials never enter a receipt.
export function providerTools(env:(name:string)=>string|undefined,health:(row:Row)=>Promise<void>,request:typeof fetch=fetch):Provider {
 return {async call(provider,method,path,body) {
  const key=provider==='meta'?'META_SYSTEM_TOKEN':provider==='slack'?'SLACK_BOT_TOKEN':provider==='ghl'?'GHL_MAHARA_PIT':'CLICKUP_API_TOKEN';
  const token=env(key);
  if(!token) throw new Error(`${key} is not configured`);
  if(path.includes('://')||path.includes('..')||path.startsWith('/')) throw new Error('Invalid provider resource');
  const base=provider==='meta'?`https://graph.facebook.com/${env('META_GRAPH_VERSION')??'v21.0'}/`:provider==='slack'?'https://slack.com/api/':provider==='ghl'?'https://services.leadconnectorhq.com/':'https://api.clickup.com/api/v2/';
  if(provider==='ghl'&&!(method==='POST'&&path==='conversations/messages'))throw new Error('Unsupported custom WhatsApp provider resource');
  const receipt={provider,method,resource:path.split('?')[0]};
  await health({...receipt,phase:'intent'});
  let response:Response;
  try {
   const encoded=body?(provider==='meta'?new URLSearchParams(Object.fromEntries(Object.entries(body).filter(([,v])=>v!==undefined).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)]))).toString():JSON.stringify(body)):undefined;
   response=await request(base+path,{method,headers:{Authorization:provider==='clickup'?token:`Bearer ${token}`,'Content-Type':provider==='meta'?'application/x-www-form-urlencoded':'application/json',...(provider==='ghl'?{Version:'2023-02-21'}:{})},body:encoded,signal:AbortSignal.timeout(25000)});
  } catch {
   await health({...receipt,phase:'unknown'});
   throw new Error('Provider response is unknown. Reconcile before retrying.');
  }
  const raw=await response.text(); let result:Row={};
  try {result=raw?JSON.parse(raw):{};} catch {await health({...receipt,phase:'response',http_status:response.status});throw new Error('Provider returned an unreadable response. Reconcile before retrying.');}
  const image=Object.values(result.images??{})[0] as Row|undefined;
  await health({...receipt,phase:'response',http_status:response.status,object_id:provider==='ghl'&&typeof result.messageId==='string'?result.messageId:result.id?String(result.id):result.ts?String(result.ts):image?.hash?String(image.hash):null});
  if(!response.ok||result.error||result.ok===false){
   if(provider==='ghl')throw new Error(`The custom WhatsApp provider rejected the request (${response.status}). Review provider health.`);
   const rawDetail=result.error?.error_user_msg??result.error?.message??result.error??result.err;
   const detail=(typeof rawDetail==='string'?rawDetail:'').replaceAll(token,'[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,280);
   const code=result.error?.code?` code ${result.error.code}${result.error.error_subcode?`/${result.error.error_subcode}`:''}`:'';
   throw new Error(`${provider} rejected the request (${response.status}${code})${detail?`: ${detail}`:'. Inspect the provider receipt.'}`);
  }
  return result;
 }};
}
