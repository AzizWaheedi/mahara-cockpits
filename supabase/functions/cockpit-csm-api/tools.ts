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
