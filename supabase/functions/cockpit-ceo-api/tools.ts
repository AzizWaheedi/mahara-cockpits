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
