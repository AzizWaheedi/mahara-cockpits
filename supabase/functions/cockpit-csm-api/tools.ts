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

/** Client check-in appointments only. No automatic retries after any response. */
export function ghlTools(token:string,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch):{call:(method:'GET'|'POST',path:string,body?:Record<string,unknown>)=>Promise<unknown>}{
 if(!token)throw Error('GHL_MAHARA_PIT is not configured');
 return {async call(method,path,body){
  if(!path.startsWith('calendars/')||path.includes('://')||path.includes('..'))throw Error('Invalid GoHighLevel resource');
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
